// Cache freshness policy. The cron refresh (wrangler.toml [triggers]) rewrites the
// blob every 3 minutes; requests always serve R2 and only flag staleness. Flip
// HARD_FAIL_AFTER_MAX_STALE to return 503 instead of very old data.

// Keep in sync with `crons` in wrangler.toml.
export const REFRESH_INTERVAL_MS = 180_000;

// `stale` must mean "the refresh pipeline is broken", not "a refresh is due". At
// exactly one refresh interval every request landing between "the blob turns 3
// minutes old" and "the next cron tick finishes writing" would be flagged stale on
// a perfectly healthy worker — Cloudflare does not guarantee to-the-second cron
// firing either. Tolerate one fully missed tick plus refresh time instead.
export const CACHE_TTL_MS = 2 * REFRESH_INTERVAL_MS + 60_000;
export const MAX_STALE_AGE_MS = 6 * 3_600_000;
export const HARD_FAIL_AFTER_MAX_STALE = false;
export const STALE_WARNING_AGE_MS = 30 * 60_000;

// Bound the inline (cold-cache) refresh path: per isolate, at most one refresh
// attempt per this interval, so an R2 outage at full traffic costs one upstream
// refresh per isolate per minute instead of one per request.
export const INLINE_REFRESH_MIN_INTERVAL_MS = 60_000;

export const shouldHardFail = (ageMs: number, hardFail: boolean = HARD_FAIL_AFTER_MAX_STALE): boolean =>
  hardFail && ageMs > MAX_STALE_AGE_MS;
