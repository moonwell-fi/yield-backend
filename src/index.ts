import * as Sentry from '@sentry/cloudflare';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { createSentryOptions } from './sentry';
import { logEvent, cacheAgeBucket } from './log';
import { CACHE_URI, refreshCache, type CachedPayload, type Env } from './refresh';
import { CACHE_TTL_MS, INLINE_REFRESH_MIN_INTERVAL_MS, MAX_STALE_AGE_MS, STALE_WARNING_AGE_MS, shouldHardFail } from './policy';

export type { Env };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type,sentry-trace,baggage',
  'Access-Control-Expose-Headers': 'Age, X-Cache-Status',
  'Access-Control-Max-Age': '86400',
  'content-type': 'application/json'
}

interface ResponseMeta {
  uploaded: string;
  stale: boolean;
  cacheStatus: 'live' | 'fresh' | 'stale';
  ageSeconds: number;
}

const respond = (response: Record<string, unknown>, code: number = 200, meta?: ResponseMeta): Response => {
  const body = JSON.stringify(
    meta ? { uploaded: meta.uploaded, stale: meta.stale, ...response } : response,
    null,
    2,
  );
  const init = {
    status: code,
    headers: meta
      ? { ...corsHeaders, 'Age': String(meta.ageSeconds), 'X-Cache-Status': meta.cacheStatus }
      : corsHeaders,
    statusText: code === 200 ? 'OK' : 'Error'
  };
  return new Response(body, init);
}

const parseCachedPayload = async (object: R2ObjectBody | null): Promise<CachedPayload | null> => {
  if (!object) return null;
  try {
    return await object.json() as CachedPayload;
  } catch (error) {
    console.error('Failed to parse cached payload from R2:', error);
    logEvent('cache_parse_error', { uri: CACHE_URI });
    Sentry.captureException(error, {
      tags: {
        component: 'r2',
        operation: 'cache_parse',
      },
      extra: { uri: CACHE_URI },
    });
    return null;
  }
};

// A failed R2 read must not 500 the endpoint: report it and treat the cache as
// absent so the caller falls through to a live refresh.
const readCachedPayload = async (env: Env): Promise<CachedPayload | null> => {
  const object = await env.MY_BUCKET.get(CACHE_URI).catch((error: unknown) => {
    console.error('Failed to read cached payload from R2:', error);
    logEvent('cache_read_error', { uri: CACHE_URI });
    Sentry.captureException(error, {
      tags: {
        component: 'r2',
        operation: 'cache_read',
      },
      extra: { uri: CACHE_URI },
    });
    return null;
  });
  return parseCachedPayload(object);
};

const cacheAgeMs = (payload: CachedPayload | null, nowMs: number): number => {
  const uploadedMs = payload ? new Date(payload.uploaded).getTime() : Number.NaN;
  // No cache, or an unparseable timestamp, counts as maximally stale rather than fresh.
  return Number.isNaN(uploadedMs) ? Number.MAX_SAFE_INTEGER : Math.max(0, nowMs - uploadedMs);
};

// Fixed messages so Sentry issue grouping (and the dashboard alert rules in the
// README) stay stable across both handlers.
const captureStaleness = (ageMs: number): void => {
  if (ageMs > MAX_STALE_AGE_MS) {
    Sentry.captureMessage('yields cache stale beyond 6h', {
      level: 'error',
      tags: { component: 'freshness' },
    });
  } else if (ageMs > STALE_WARNING_AGE_MS) {
    Sentry.captureMessage('yields cache stale beyond 30m', {
      level: 'warning',
      tags: { component: 'freshness' },
    });
  }
};

// The cron's failure path escalates on its own, but a cron that never runs at all
// (trigger dropped by a deploy, R2 writes failing silently) produces no cron
// failure to escalate — that was MOO-776's exact symptom. So the request path
// alerts too, throttled per isolate so traffic volume cannot flood Sentry.
const STALE_ALERT_THROTTLE_MS = 5 * 60_000;
export const staleAlertState = { lastAlertMs: 0 };

const captureStalenessThrottled = (ageMs: number, nowMs: number): void => {
  if (ageMs <= STALE_WARNING_AGE_MS) return;
  if (staleAlertState.lastAlertMs && nowMs - staleAlertState.lastAlertMs < STALE_ALERT_THROTTLE_MS) return;
  staleAlertState.lastAlertMs = nowMs;
  captureStaleness(ageMs);
};

// Bound the inline refresh path: without this, an R2 outage sends every request
// down the cold-start branch and each one fans out a full upstream refresh
// (dozens of RPC subrequests). Per isolate: remember the last payload served and
// fall back to it when R2 reads fail, share one in-flight refresh between
// concurrent requests, and attempt at most one refresh per
// INLINE_REFRESH_MIN_INTERVAL_MS — requests inside the throttle window get a 503
// instead of stampeding upstream.
export const inlineRefreshState: {
  inFlight: Promise<CachedPayload> | null;
  lastAttemptMs: number;
  lastPayload: CachedPayload | null;
} = { inFlight: null, lastAttemptMs: 0, lastPayload: null };

const inlineRefresh = (env: Env, nowMs: number): Promise<CachedPayload> => {
  if (inlineRefreshState.inFlight) return inlineRefreshState.inFlight;
  if (inlineRefreshState.lastAttemptMs && nowMs - inlineRefreshState.lastAttemptMs < INLINE_REFRESH_MIN_INTERVAL_MS) {
    logEvent('inline_refresh_throttled', { uri: CACHE_URI });
    return Promise.reject(new Error('Inline refresh throttled after a recent attempt'));
  }
  inlineRefreshState.lastAttemptMs = nowMs;
  const refresh = refreshCache(env)
    .then((payload) => {
      inlineRefreshState.lastPayload = payload;
      return payload;
    })
    .finally(() => {
      inlineRefreshState.inFlight = null;
    });
  inlineRefreshState.inFlight = refresh;
  return refresh;
};

export const worker: ExportedHandler<Env> = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    let cachedPayload = await readCachedPayload(env);
    const nowMs = Date.now();

    if (cachedPayload) {
      inlineRefreshState.lastPayload = cachedPayload;
    } else if (inlineRefreshState.lastPayload) {
      // R2 read failed (or the blob vanished) but this isolate has served data
      // before — reuse it rather than fanning out an upstream refresh.
      cachedPayload = inlineRefreshState.lastPayload;
      logEvent('cache_memory_fallback', { uri: CACHE_URI });
    }

    if (cachedPayload) {
      const ageMs = cacheAgeMs(cachedPayload, nowMs);
      const stale = ageMs >= CACHE_TTL_MS;
      Sentry.setTag('cache_state', stale ? 'stale' : 'fresh');
      Sentry.setTag('cache_age_bucket', cacheAgeBucket(ageMs));

      if (stale && shouldHardFail(ageMs)) {
        logEvent('cache_too_stale', { uri: CACHE_URI, cache_age_ms: ageMs });
        Sentry.setTag('response_source', 'unavailable');
        return respond({ error: 'Service temporarily unavailable', message: 'Cached data exceeded the maximum stale age' }, 503);
      }

      logEvent(stale ? 'cache_hit_stale' : 'cache_hit_fresh', {
        uri: CACHE_URI,
        cache_age_ms: ageMs,
        cache_age_bucket: cacheAgeBucket(ageMs),
      });
      Sentry.setTag('response_source', stale ? 'stale_cache' : 'fresh_cache');
      if (stale) captureStalenessThrottled(ageMs, nowMs);
      return respond(cachedPayload.data, 200, {
        uploaded: cachedPayload.uploaded,
        stale,
        cacheStatus: stale ? 'stale' : 'fresh',
        ageSeconds: Math.round(ageMs / 1000),
      });
    }

    // Cold start: no cache blob at all (new bucket or wiped). Refresh inline so
    // the first-ever request still gets data; afterwards the cron owns refreshes.
    Sentry.setTag('cache_state', 'missing');
    logEvent('cache_miss', { uri: CACHE_URI });
    try {
      const payload = await inlineRefresh(env, nowMs);
      Sentry.setTag('response_source', 'live');
      return respond(payload.data, 200, {
        uploaded: payload.uploaded,
        stale: false,
        cacheStatus: 'live',
        ageSeconds: 0,
      });
    } catch {
      // refreshCache reports upstream errors to Sentry itself; a throttled
      // inline attempt only logs.
      logEvent('cache_fallback_unavailable', { uri: CACHE_URI });
      Sentry.setTag('response_source', 'unavailable');
      return respond({ error: 'Service temporarily unavailable', message: 'Unable to fetch data and no cached data available' }, 503);
    }
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    try {
      await refreshCache(env);
      logEvent('scheduled_refresh_success', { uri: CACHE_URI });
    } catch {
      // refreshCache already reported the upstream error to Sentry; escalate
      // here based on how stale the served data is getting so alert rules can
      // page before users notice.
      const cachedPayload = await readCachedPayload(env);
      const ageMs = cacheAgeMs(cachedPayload, Date.now());
      logEvent('scheduled_refresh_failed', {
        uri: CACHE_URI,
        cache_age_ms: ageMs,
        cache_age_bucket: cacheAgeBucket(ageMs),
        cache_present: cachedPayload !== null,
      });
      captureStaleness(ageMs);
    }
  },
};

export default Sentry.withSentry<Env>(createSentryOptions, worker);
