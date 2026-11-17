export type WisStockCandleInterval = "hour" | "day" | "week";
export interface WisStockCandle {
  startAtMs: number;
  endAtMs: number;
  firstAtMs: number;
  lastAtMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  observations: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KST = 9 * HOUR;
const MAX_DATE = 8_640_000_000_000_000;
export const WIS_STOCK_CANDLE_INTERVALS = [
  { key: "hour", label: "시간봉", duration: HOUR },
  { key: "day", label: "일봉", duration: DAY },
  { key: "week", label: "주봉", duration: 7 * DAY },
] as const;

/** Aggregate only sanitized observations; never carry prices into empty periods. */
export function buildWisStockCandles(
  points: readonly { atMs: number; price: number }[],
  interval: WisStockCandleInterval,
): WisStockCandle[] {
  const duration = WIS_STOCK_CANDLE_INTERVALS.find(
    (item) => item.key === interval,
  )!.duration;
  // Korean weeks start on Monday. Unix epoch's local calendar date is Thursday.
  const weekOffset = interval === "week" ? 3 * DAY : 0;
  const candles = new Map<number, WisStockCandle>();
  for (const point of points) {
    const startAtMs =
      Math.floor((point.atMs + KST + weekOffset) / duration) * duration -
      KST -
      weekOffset;
    const current = candles.get(startAtMs);
    if (!current) {
      candles.set(startAtMs, {
        startAtMs,
        endAtMs: Math.min(MAX_DATE, startAtMs + duration),
        firstAtMs: point.atMs,
        lastAtMs: point.atMs,
        open: point.price,
        high: point.price,
        low: point.price,
        close: point.price,
        observations: 1,
      });
      continue;
    }
    current.high = Math.max(current.high, point.price);
    current.low = Math.min(current.low, point.price);
    current.observations += 1;
    if (point.atMs < current.firstAtMs) {
      current.firstAtMs = point.atMs;
      current.open = point.price;
    }
    if (point.atMs >= current.lastAtMs) {
      current.lastAtMs = point.atMs;
      current.close = point.price;
    }
  }
  return [...candles.values()].sort((a, b) => a.startAtMs - b.startAtMs);
}
