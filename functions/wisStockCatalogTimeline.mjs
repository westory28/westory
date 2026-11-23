// Shared catalog dates only. No clock, storage, private seed, or trade mutation.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_DATE = 8_640_000_000_000_000;

export function catalogSessionAtMs(session, startsAtMs) {
  if (!Number.isSafeInteger(session) || session < 1 || session > 210
    || !Number.isSafeInteger(startsAtMs) || startsAtMs < 0) {
    throw new RangeError('Invalid catalog session');
  }
  const index = session - 1;
  const tradingDay = Math.floor(index / 7);
  const atMs = startsAtMs + (Math.floor(tradingDay / 5) * 7 + tradingDay % 5) * DAY
    + (index % 7) * HOUR;
  if (!Number.isSafeInteger(atMs) || atMs > MAX_DATE) throw new RangeError('Invalid catalog date');
  return atMs;
}

export function catalogExitAtMs(entry, plan) {
  if (!plan || entry.exitSession === null) return null;
  const override = plan.exitOverrides?.[entry.id];
  if (override !== undefined) {
    if (!Number.isSafeInteger(override) || override < 0 || override > MAX_DATE)
      throw new RangeError('Invalid catalog exit override');
    return override;
  }
  return catalogSessionAtMs(entry.exitSession, plan.startsAtMs);
}
