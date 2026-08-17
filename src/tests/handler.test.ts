import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import * as Sentry from '@sentry/cloudflare';
import { worker, staleAlertState } from '../index';
import {
  shouldHardFail,
  CACHE_TTL_MS,
  MAX_STALE_AGE_MS,
  REFRESH_INTERVAL_MS,
  STALE_WARNING_AGE_MS,
} from '../policy';
import { refreshCache, CACHE_URI, type Env } from '../refresh';

vi.mock('@sentry/cloudflare', () => ({
  withSentry: vi.fn((_options: unknown, handler: unknown) => handler),
  setTag: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  startSpan: vi.fn((_options: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../refresh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../refresh')>();
  return {
    ...actual,
    refreshCache: vi.fn(),
  };
});

// setup.ts replaces Request/Response/Headers with vi.fn() mocks for the older
// serializer tests; the handler builds real Responses, so restore the natives.
const RealRequest = Request;
const RealResponse = Response;
const RealHeaders = Headers;

beforeAll(() => {
  (globalThis as any).Request = RealRequest;
  (globalThis as any).Response = RealResponse;
  (globalThis as any).Headers = RealHeaders;
});

const mockRefreshCache = vi.mocked(refreshCache);

interface BucketStub {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

const makeBucket = (blob: unknown | null): BucketStub => ({
  get: vi.fn(async () => blob === null ? null : ({ json: async () => blob })),
  put: vi.fn(async () => undefined),
});

const makeEnv = (bucket: BucketStub): Env => ({
  MY_BUCKET: bucket as unknown as R2Bucket,
  BASE_RPC_URL: 'https://rpc.example.test',
  CF_VERSION_METADATA: { id: 'test', tag: 'test', timestamp: '' } as WorkerVersionMetadata,
});

const yields = { markets: { MOONWELL_USDC: { baseSupplyApy: 4.4 } }, vaults: {} };
const request = new Request('https://yield.test/');
const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
const controller = {} as ScheduledController;

const runFetch = async (env: Env): Promise<Response> =>
  (worker.fetch as (r: Request, e: Env, c: ExecutionContext) => Promise<Response>)(request, env, ctx);

const runScheduled = async (env: Env): Promise<void> =>
  (worker.scheduled as (c: ScheduledController, e: Env, x: ExecutionContext) => Promise<void>)(controller, env, ctx);

beforeEach(() => {
  mockRefreshCache.mockReset();
  // Per-isolate throttle state; reset so tests don't throttle each other.
  staleAlertState.lastAlertMs = 0;
});

describe('fetch handler', () => {
  it('serves a fresh cache with stale:false and does not refresh inline', async () => {
    const uploaded = new Date(Date.now() - 30_000).toISOString();
    const env = makeEnv(makeBucket({ uploaded, data: yields }));

    const res = await runFetch(env);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.stale).toBe(false);
    expect(body.uploaded).toBe(uploaded);
    expect(body.markets).toEqual(yields.markets);
    expect(res.headers.get('X-Cache-Status')).toBe('fresh');
    expect(Number(res.headers.get('Age'))).toBeGreaterThanOrEqual(29);
    expect(mockRefreshCache).not.toHaveBeenCalled();
  });

  it('does not flag a blob as stale just because the next cron tick is due', async () => {
    // A healthy worker's blob routinely reaches one refresh interval in age in the
    // gap before the next tick lands; that must not read as stale.
    const uploaded = new Date(Date.now() - REFRESH_INTERVAL_MS - 20_000).toISOString();
    const env = makeEnv(makeBucket({ uploaded, data: yields }));

    const res = await runFetch(env);
    const body = await res.json() as Record<string, unknown>;

    expect(body.stale).toBe(false);
    expect(res.headers.get('X-Cache-Status')).toBe('fresh');
  });

  it('serves a stale cache with stale:true and leaves refreshing to the cron', async () => {
    const uploaded = new Date(Date.now() - CACHE_TTL_MS - 60_000).toISOString();
    const env = makeEnv(makeBucket({ uploaded, data: yields }));

    const res = await runFetch(env);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.stale).toBe(true);
    expect(res.headers.get('X-Cache-Status')).toBe('stale');
    expect(mockRefreshCache).not.toHaveBeenCalled();
  });

  it('serves a cache with an unparseable uploaded timestamp as stale', async () => {
    const env = makeEnv(makeBucket({ uploaded: 'not-a-date', data: yields }));

    const res = await runFetch(env);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.stale).toBe(true);
    expect(res.headers.get('X-Cache-Status')).toBe('stale');
  });

  it('refreshes inline when the cache is missing and serves the live payload', async () => {
    const bucket = makeBucket(null);
    const env = makeEnv(bucket);
    const uploaded = new Date().toISOString();
    mockRefreshCache.mockResolvedValue({ uploaded, data: yields });

    const res = await runFetch(env);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.stale).toBe(false);
    expect(body.uploaded).toBe(uploaded);
    expect(res.headers.get('X-Cache-Status')).toBe('live');
    expect(mockRefreshCache).toHaveBeenCalledOnce();
  });

  it('returns 503 when the cache is missing and the refresh fails', async () => {
    const env = makeEnv(makeBucket(null));
    mockRefreshCache.mockRejectedValue(new Error('upstream down'));

    const res = await runFetch(env);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(503);
    expect(body.error).toBe('Service temporarily unavailable');
  });

  it('treats an unparseable cache blob as missing and refreshes inline', async () => {
    const bucket: BucketStub = {
      get: vi.fn(async () => ({ json: async () => { throw new Error('bad json'); } })),
      put: vi.fn(),
    };
    const env = makeEnv(bucket);
    mockRefreshCache.mockResolvedValue({ uploaded: new Date().toISOString(), data: yields });

    const res = await runFetch(env);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache-Status')).toBe('live');
  });

  it('refreshes inline instead of failing when the R2 read throws', async () => {
    const bucket: BucketStub = {
      get: vi.fn(async () => { throw new Error('r2 unavailable'); }),
      put: vi.fn(),
    };
    const env = makeEnv(bucket);
    mockRefreshCache.mockResolvedValue({ uploaded: new Date().toISOString(), data: yields });

    const res = await runFetch(env);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache-Status')).toBe('live');
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
  });

  it('alerts from the request path when a very stale cache is served, then throttles', async () => {
    const uploaded = new Date(Date.now() - MAX_STALE_AGE_MS - 60_000).toISOString();
    const env = makeEnv(makeBucket({ uploaded, data: yields }));

    await runFetch(env);

    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith(
      'yields cache stale beyond 6h',
      expect.objectContaining({ level: 'error' }),
    );

    vi.mocked(Sentry.captureMessage).mockClear();
    await runFetch(env);
    expect(vi.mocked(Sentry.captureMessage)).not.toHaveBeenCalled();
  });

  it('does not alert from the request path for a mildly stale cache', async () => {
    const uploaded = new Date(Date.now() - CACHE_TTL_MS - 60_000).toISOString();
    const env = makeEnv(makeBucket({ uploaded, data: yields }));

    await runFetch(env);

    expect(vi.mocked(Sentry.captureMessage)).not.toHaveBeenCalled();
  });
});

describe('shouldHardFail', () => {
  it('never hard-fails with the default policy', () => {
    expect(shouldHardFail(MAX_STALE_AGE_MS * 100)).toBe(false);
  });

  it('hard-fails past the max stale age when the policy flag is on', () => {
    expect(shouldHardFail(MAX_STALE_AGE_MS + 1, true)).toBe(true);
    expect(shouldHardFail(MAX_STALE_AGE_MS - 1, true)).toBe(false);
  });
});

describe('scheduled handler', () => {
  it('refreshes the cache and stays quiet on success', async () => {
    const env = makeEnv(makeBucket(null));
    mockRefreshCache.mockResolvedValue({ uploaded: new Date().toISOString(), data: yields });

    await runScheduled(env);

    expect(mockRefreshCache).toHaveBeenCalledOnce();
    expect(vi.mocked(Sentry.captureMessage)).not.toHaveBeenCalled();
  });

  it('warns when the refresh fails and the cache is older than the warning age', async () => {
    const uploaded = new Date(Date.now() - STALE_WARNING_AGE_MS - 60_000).toISOString();
    const env = makeEnv(makeBucket({ uploaded, data: yields }));
    mockRefreshCache.mockRejectedValue(new Error('upstream down'));

    await runScheduled(env);

    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith(
      'yields cache stale beyond 30m',
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('errors when the refresh fails and the cache is older than the max stale age', async () => {
    const uploaded = new Date(Date.now() - MAX_STALE_AGE_MS - 60_000).toISOString();
    const env = makeEnv(makeBucket({ uploaded, data: yields }));
    mockRefreshCache.mockRejectedValue(new Error('upstream down'));

    await runScheduled(env);

    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith(
      'yields cache stale beyond 6h',
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('stays quiet when the refresh fails but the cache is still fresh enough', async () => {
    const uploaded = new Date(Date.now() - 60_000).toISOString();
    const env = makeEnv(makeBucket({ uploaded, data: yields }));
    mockRefreshCache.mockRejectedValue(new Error('upstream down'));

    await runScheduled(env);

    expect(vi.mocked(Sentry.captureMessage)).not.toHaveBeenCalled();
  });
});

describe('fetchFreshYields config guard', () => {
  it('throws a self-diagnosing error when BASE_RPC_URL is missing', async () => {
    const { fetchFreshYields } = await vi.importActual<typeof import('../refresh')>('../refresh');

    await expect(fetchFreshYields({ BASE_RPC_URL: '' })).rejects.toThrow(/BASE_RPC_URL/);
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith(
      expect.stringContaining('BASE_RPC_URL'),
      expect.objectContaining({ level: 'fatal' }),
    );
  });
});

describe('cache key', () => {
  it('keeps the R2 object name stable', () => {
    expect(CACHE_URI).toBe('market-vault-yields.json');
  });
});
