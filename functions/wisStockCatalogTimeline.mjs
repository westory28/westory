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

// Inverse of catalogSessionAtMs for live pricing: the 1-based session whose
// hour contains atMs. Sessions start at the plan's KST hour (09:00 domestic,
// 16:00 overseas); before the first or after the seventh hour on a weekday the
// nearest session of that day applies; weekends and dates before the plan
// return null.
export function catalogSessionIndexAt(atMs, startsAtMs) {
  if (!Number.isSafeInteger(atMs) || !Number.isSafeInteger(startsAtMs) || startsAtMs < 0 || atMs < startsAtMs - 60 * 60_000)
    return null;
  const kstDay = Math.floor((atMs + 9 * HOUR) / DAY), startDay = Math.floor((startsAtMs + 9 * HOUR) / DAY);
  const days = kstDay - startDay, week = Math.floor(days / 7), weekday = days % 7;
  if (days < 0 || weekday > 4) return null;
  const minute = Math.floor(((atMs + 9 * HOUR) % DAY) / 60_000);
  const firstMinute = Math.floor(((startsAtMs + 9 * HOUR) % DAY) / 60_000);
  const hour = Math.max(0, Math.min(6, Math.floor((minute - firstMinute) / 60)));
  const session = (week * 5 + weekday) * 7 + hour + 1;
  return session <= 210 ? session : null;
}
