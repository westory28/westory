import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import type { WisStockScope } from "./studentWisStockTypes";

interface RankingDate {
  semesterId: string;
  dayKey: string;
  asOfMs: number;
}
export interface RankingRow {
  rank: number;
  displayName: string;
  returnPercent: number;
}
export interface StockRanking extends RankingDate {
  status: "READY" | "NOT_READY";
  rows: RankingRow[];
}
export interface StockRankingDetail extends RankingDate {
  rank: number;
  displayName: string;
  points: { atMs: number; returnPercent: number | null }[];
  holdings: { name: string; quantity: number }[];
}

async function request<T extends RankingDate>(
  scope: WisStockScope,
  fields: { dayKey?: string; rank?: number },
  signal: AbortSignal,
) {
  const call = await getHistoryDictionaryCallable<
    WisStockScope & typeof fields,
    T
  >("getStudentWisStockRanking", {
    beforeDispatch: () => signal.throwIfAborted(),
  });
  signal.throwIfAborted();
  const { data } = await call({ ...scope, ...fields });
  signal.throwIfAborted();
  if (
    !data ||
    data.semesterId !== `${scope.year}-${scope.semester}` ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.dayKey) ||
    !Number.isSafeInteger(data.asOfMs) ||
    data.asOfMs !== Date.parse(`${data.dayKey}T23:59:00+09:00`)
  )
    throw new Error("랭킹 기준일을 확인하지 못했습니다.");
  return data;
}

export async function getStockRanking(
  scope: WisStockScope,
  signal: AbortSignal,
) {
  const data = await request<StockRanking>(scope, {}, signal);
  if (
    !["READY", "NOT_READY"].includes(data.status) ||
    !Array.isArray(data.rows) ||
    data.rows.length > 5 ||
    (data.status === "NOT_READY" && data.rows.length > 0) ||
    data.rows.some(
      (row, index) =>
        !Number.isInteger(row?.rank) ||
        row.rank < 1 ||
        row.rank > 5 ||
        (index > 0 && row.rank <= data.rows[index - 1].rank) ||
        typeof row.displayName !== "string" ||
        !row.displayName.trim() ||
        !Number.isFinite(row.returnPercent),
    )
  )
    throw new Error("랭킹을 확인하지 못했습니다.");
  return data;
}

export async function getStockRankingDetail(
  scope: WisStockScope,
  ranking: StockRanking,
  row: RankingRow,
  signal: AbortSignal,
) {
  const data = await request<StockRankingDetail>(
    scope,
    { dayKey: ranking.dayKey, rank: row.rank },
    signal,
  );
  if (
    data.dayKey !== ranking.dayKey ||
    data.asOfMs !== ranking.asOfMs ||
    data.rank !== row.rank ||
    data.displayName !== row.displayName ||
    !Array.isArray(data.holdings) ||
    data.holdings.some(
      (holding) =>
        typeof holding?.name !== "string" ||
        !holding.name.trim() ||
        !Number.isSafeInteger(holding.quantity) ||
        holding.quantity < 1,
    ) ||
    !Array.isArray(data.points) ||
    data.points.some(
      (point, index) =>
        !Number.isSafeInteger(point?.atMs) ||
        point.atMs <= 0 ||
        point.atMs > data.asOfMs ||
        (index > 0 && point.atMs <= data.points[index - 1].atMs) ||
        (point.returnPercent !== null && !Number.isFinite(point.returnPercent)),
    )
  )
    throw new Error("랭킹 상세 기록을 확인하지 못했습니다.");
  return data;
}
