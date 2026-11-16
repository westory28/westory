import type { WisStock } from "../../../../lib/wisStocksClient";
import { stockObservations } from "../../../../components/common/WisStockPriceChart";

/** Display-only daily return: prior KST close, or the first real observation. */
export function wisStockQuote(stock: WisStock, asOfMs: number) {
  const points = stockObservations(stock);
  const atMs = Math.max(asOfMs, stock.updatedAtMs, points.at(-1)?.atMs || 0);
  const dayStart =
    Math.floor((atMs + 9 * 3_600_000) / 86_400_000) * 86_400_000 -
    9 * 3_600_000;
  const previous =
    points.filter((point) => point.atMs < dayStart).at(-1) || points[0];
  if (!previous) return { change: null, percent: null };
  const change = stock.price - previous.price;
  return { change, percent: (change / previous.price) * 100 };
}

export const quoteNumber = (value: number, digits = 0) =>
  value.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
export const signedQuote = (value: number, digits = 0) =>
  `${value > 0 ? "+" : ""}${quoteNumber(value, digits)}`;
export const quoteDirection = (value: number | null) =>
  value && value > 0 ? "is-up" : value && value < 0 ? "is-down" : "is-flat";
