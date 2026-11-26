export const WIS_STOCK_FX_PATH: 'wis_stock_fx/current';
export const WIS_STOCK_FX_UNIT: 1000;
export const WIS_STOCK_FX_RATE_RANGE: readonly [number, number];
export const WIS_STOCK_FX_HISTORY_LIMIT: number;
export type WisStockFxDirection = 'WIS_TO_YUS' | 'YUS_TO_WIS';
export const WIS_STOCK_FX_DIRECTIONS: readonly WisStockFxDirection[];
export class WisStockFxError extends Error { reason: string; }
export interface WisStockFxRate {
  rate: number;
  krwPerUsd: number;
  dayKey: string;
  sourceDate: string;
  source: string;
  fetchedAtMs: number;
  history: { dayKey: string; rate: number }[];
  current: boolean;
}
export function wisStockFxDayKey(atMs: number): string;
export function wisStockFxRateFromKrwPerUsd(krwPerUsd: number): number;
export function parseWisStockFxRate(raw: unknown, nowMs: number): WisStockFxRate;
export function nextWisStockFxDocument(previous: Record<string, unknown> | null, input: {
  krwPerUsd: number; sourceDate: string; source: string; fetchedAtMs: number;
}): Record<string, unknown> | null;
export function wisToYus(wis: number, rate: number): number;
export function yusToWis(yus: number, rate: number): number;
export function quoteWisStockExchange(input: {
  direction: WisStockFxDirection; amount: number; rate: number; available: number;
}): { direction: WisStockFxDirection; debit: number; credit: number; rate: number; debitUnit: 'WIS' | 'YUS'; creditUnit: 'WIS' | 'YUS' };
export function wisStockYusValueInWis(yus: number, rate: number): number;
