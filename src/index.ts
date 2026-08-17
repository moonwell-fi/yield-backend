import * as Sentry from '@sentry/cloudflare';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { createSentryOptions } from './sentry';
import { logEvent, cacheAgeBucket } from './log';
import { CACHE_URI, refreshCache, type CachedPayload, type Env } from './refresh';
import { CACHE_TTL_MS, MAX_STALE_AGE_MS, STALE_WARNING_AGE_MS, shouldHardFail } from './policy';

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

export const worker: ExportedHandler<Env> = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const object = await env.MY_BUCKET.get(CACHE_URI);
    const cachedPayload = await parseCachedPayload(object);
    const nowMs = Date.now();

    if (cachedPayload) {
      const uploadedMs = new Date(cachedPayload.uploaded).getTime();
      // An unparseable timestamp counts as maximally stale rather than fresh.
      const ageMs = Number.isNaN(uploadedMs) ? Number.MAX_SAFE_INTEGER : Math.max(0, nowMs - uploadedMs);
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
      const payload = await refreshCache(env);
      Sentry.setTag('response_source', 'live');
      return respond(payload.data, 200, {
        uploaded: payload.uploaded,
        stale: false,
        cacheStatus: 'live',
        ageSeconds: 0,
      });
    } catch {
      // refreshCache already reported the upstream error to Sentry.
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
      // page before users notice. Fixed messages keep Sentry issue grouping stable.
      const object = await env.MY_BUCKET.get(CACHE_URI).catch(() => null);
      const cachedPayload = await parseCachedPayload(object);
      const uploadedMs = cachedPayload ? new Date(cachedPayload.uploaded).getTime() : Number.NaN;
      const ageMs = Number.isNaN(uploadedMs) ? Number.MAX_SAFE_INTEGER : Date.now() - uploadedMs;
      logEvent('scheduled_refresh_failed', {
        uri: CACHE_URI,
        cache_age_ms: ageMs,
        cache_age_bucket: cacheAgeBucket(ageMs),
      });
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
    }
  },
};

export default Sentry.withSentry<Env>(createSentryOptions, worker);
