export const logEvent = (event: string, details: Record<string, unknown> = {}): void => {
  console.log(JSON.stringify({
    event,
    ts: new Date().toISOString(),
    ...details,
  }));
};

export const cacheAgeBucket = (ageMs: number | null): string => {
  if (ageMs === null || Number.isNaN(ageMs)) return 'unknown';
  if (ageMs < 60_000) return 'lt_1m';
  if (ageMs < 180_000) return '1m_3m';
  if (ageMs < 600_000) return '3m_10m';
  if (ageMs < 3_600_000) return '10m_1h';
  if (ageMs < 21_600_000) return '1h_6h';
  if (ageMs < 86_400_000) return '6h_24h';
  return 'gt_24h';
};
