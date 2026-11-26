// Pure classroom exchange rules shared by the server and the student screen.
// No clock, I/O, credentials or wallet mutation belongs in this module.
//
// One rate is applied per KST day. The rate is the day's KRW-per-USD reference
// rounded to a whole number and read as "1,000 유스 = rate 위스", so a
// 1,345.4 KRW/USD day gives 1 유스 ≈ 1.345 위스. Amounts stay integers.
export const WIS_STOCK_FX_PATH = 'wis_stock_fx/current';
export const WIS_STOCK_FX_UNIT = 1000;
export const WIS_STOCK_FX_RATE_RANGE = Object.freeze([500, 3000]);
export const WIS_STOCK_FX_HISTORY_LIMIT = 30;
export const WIS_STOCK_FX_DIRECTIONS = Object.freeze(['WIS_TO_YUS', 'YUS_TO_WIS']);
const KST_OFFSET = 9 * 3_600_000;
const MAX = Number.MAX_SAFE_INTEGER;
const int = (value, min = 0, max = MAX) => Number.isSafeInteger(value) && value >= min && value <= max;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export class WisStockFxError extends Error {
  constructor(reason, message) { super(message); this.name = 'WisStockFxError'; this.reason = reason; }
}
const reject = (reason, message) => { throw new WisStockFxError(reason, message); };

export const wisStockFxDayKey = atMs => new Date(atMs + KST_OFFSET).toISOString().slice(0, 10);

export function wisStockFxRateFromKrwPerUsd(krwPerUsd) {
  if (typeof krwPerUsd !== 'number' || !Number.isFinite(krwPerUsd)) reject('WIS_STOCK_FX_SOURCE_INVALID', '환율 자료를 확인하지 못했습니다.');
  const rate = Math.round(krwPerUsd);
  if (!int(rate, ...WIS_STOCK_FX_RATE_RANGE)) reject('WIS_STOCK_FX_SOURCE_INVALID', '환율 자료가 허용 범위를 벗어났습니다.');
  return rate;
}

/** Validates the stored daily rate. `current` is true only on its own KST day. */
export function parseWisStockFxRate(raw, nowMs) {
  if (!record(raw) || raw.schemaVersion !== 1 || raw.pair !== 'USD/KRW' || !int(raw.rate, ...WIS_STOCK_FX_RATE_RANGE)
    || typeof raw.krwPerUsd !== 'number' || !Number.isFinite(raw.krwPerUsd) || Math.round(raw.krwPerUsd) !== raw.rate
    || typeof raw.dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.dayKey)
    || typeof raw.sourceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.sourceDate)
    || typeof raw.source !== 'string' || !raw.source || raw.source.length > 80
    || !int(raw.fetchedAtMs, 1) || !Array.isArray(raw.history) || raw.history.length > WIS_STOCK_FX_HISTORY_LIMIT
    || raw.history.some(point => !record(point) || typeof point.dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(point.dayKey)
      || !int(point.rate, ...WIS_STOCK_FX_RATE_RANGE)))
    reject('WIS_STOCK_FX_INVALID', '오늘의 환율을 확인하지 못했습니다.');
  return { rate: raw.rate, krwPerUsd: raw.krwPerUsd, dayKey: raw.dayKey, sourceDate: raw.sourceDate, source: raw.source,
    fetchedAtMs: raw.fetchedAtMs, history: raw.history.map(point => ({ dayKey: point.dayKey, rate: point.rate })),
    current: int(nowMs) && wisStockFxDayKey(nowMs) === raw.dayKey };
}

/** The next stored document. Re-applying the same day is a no-op (null). */
export function nextWisStockFxDocument(previous, { krwPerUsd, sourceDate, source, fetchedAtMs }) {
  wisStockFxRateFromKrwPerUsd(krwPerUsd);
  // The applied rate is derived from the stored (two-decimal) reference so the
  // stored document always satisfies parseWisStockFxRate's rounding check.
  const storedKrwPerUsd = Math.round(krwPerUsd * 100) / 100;
  const rate = wisStockFxRateFromKrwPerUsd(storedKrwPerUsd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate || '') || typeof source !== 'string' || !source || !int(fetchedAtMs, 1))
    reject('WIS_STOCK_FX_SOURCE_INVALID', '환율 자료를 확인하지 못했습니다.');
  const dayKey = wisStockFxDayKey(fetchedAtMs);
  if (previous && previous.dayKey === dayKey) return null;
  // A provider glitch must not reprice every account. A larger jump from a rate
  // stored within the last week is held for review (new exchanges stop until a
  // plausible rate arrives); an older stored rate no longer blocks the update.
  const previousAgeDays = previous
    ? (Date.parse(`${dayKey}T00:00:00Z`) - Date.parse(`${previous.dayKey}T00:00:00Z`)) / 86_400_000 : NaN;
  if (previous && previousAgeDays <= 7 && Math.abs(rate - previous.rate) * 100 > previous.rate * 15)
    reject('WIS_STOCK_FX_JUMP', '전일 대비 환율 변동이 너무 커서 반영을 보류했습니다.');
  const history = [...(previous?.history || []).filter(point => point.dayKey !== dayKey), { dayKey, rate }]
    .slice(-WIS_STOCK_FX_HISTORY_LIMIT);
  return { schemaVersion: 1, pair: 'USD/KRW', rate, krwPerUsd: storedKrwPerUsd, dayKey,
    sourceDate, source, fetchedAtMs, history };
}

export const wisToYus = (wis, rate) => Number(BigInt(wis) * BigInt(WIS_STOCK_FX_UNIT) / BigInt(rate));
export const yusToWis = (yus, rate) => Number(BigInt(yus) * BigInt(rate) / BigInt(WIS_STOCK_FX_UNIT));

/** Converts the entered source amount. Both directions round down. */
export function quoteWisStockExchange({ direction, amount, rate, available }) {
  if (!WIS_STOCK_FX_DIRECTIONS.includes(direction) || !int(amount, 1, 1_000_000_000_000)
    || !int(rate, ...WIS_STOCK_FX_RATE_RANGE) || !int(available))
    reject('WIS_STOCK_FX_INPUT_INVALID', '환전 금액을 확인해 주세요.');
  if (amount > available) reject('WIS_STOCK_FX_INSUFFICIENT', direction === 'WIS_TO_YUS'
    ? '환전할 수 있는 위스가 부족합니다. 매수 예약금과 이벤트 지원금 원금은 환전할 수 없습니다.'
    : '환전할 수 있는 유스가 부족합니다. 매수 예약금은 환전할 수 없습니다.');
  const credit = direction === 'WIS_TO_YUS' ? wisToYus(amount, rate) : yusToWis(amount, rate);
  if (credit < 1) reject('WIS_STOCK_FX_TOO_SMALL', '환전 후 받을 금액이 1보다 작습니다. 금액을 늘려 주세요.');
  return { direction, debit: amount, credit, rate,
    debitUnit: direction === 'WIS_TO_YUS' ? 'WIS' : 'YUS', creditUnit: direction === 'WIS_TO_YUS' ? 'YUS' : 'WIS' };
}

/** Whole-Wis value of a Yus amount at today's rate, for display totals only. */
export const wisStockYusValueInWis = (yus, rate) => (int(yus) && int(rate, 1) ? yusToWis(yus, rate) : 0);
