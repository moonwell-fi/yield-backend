// Cache freshness policy. The cron refresh (wrangler.toml [triggers]) rewrites the
// blob every 3 minutes; requests always serve R2 and only flag staleness. Flip
// HARD_FAIL_AFTER_MAX_STALE to return 503 instead of very old data.
export const CACHE_TTL_MS = 180_000;
export const MAX_STALE_AGE_MS = 6 * 3_600_000;
export const HARD_FAIL_AFTER_MAX_STALE = false;
export const STALE_WARNING_AGE_MS = 30 * 60_000;

export const shouldHardFail = (ageMs: number, hardFail: boolean = HARD_FAIL_AFTER_MAX_STALE): boolean =>
  hardFail && ageMs > MAX_STALE_AGE_MS;
