import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { withStudentWisStockReadRetry } from "./studentWisStockReadRetry";
import type { WisStockScope } from "./studentWisStockTypes";

interface RankingDate {
  semesterId: string;
  dayKey: string;
  asOfMs: number;
}
export interface RankingRow {
  entryId: string;
  rank: number;
  displayName: string;
  returnPercent: number;
}
export interface StockRanking extends RankingDate {
  status: "READY" | "NOT_READY";
  filter: string;
  myClassKey: string;
  classes: { key: string; label: string }[];
  rows: RankingRow[];
  charts: StockRankingDetail[];
  nextCursor: string | null;
  hasMore: boolean;
}
export interface StockRankingDetail extends RankingDate {
  entryId: string;
  rank: number;
  displayName: string;
  points: { atMs: number; returnPercent: number | null }[];
}
export interface StockRankingOptions {
  filter?: string;
  cursor?: string;
  chartCount?: number;
}

async function request<T extends RankingDate>(
  scope: WisStockScope,
  fields: StockRankingOptions & { dayKey?: string; entryId?: string },
  signal: AbortSignal,
) {
  const call = await getHistoryDictionaryCallable<
    WisStockScope & typeof fields,
    T
  >("getStudentWisStockRanking", {
    beforeDispatch: () => signal.throwIfAborted(),
  });
  signal.throwIfAborted();
  const { data } = await withStudentWisStockReadRetry(
    () => call({ ...scope, ...fields }),
    signal,
  );
  signal.throwIfAborted();
  if (
    !data ||
    data.semesterId !== `${scope.year}-${scope.semester}` ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.dayKey) ||
    !Number.isSafeInteger(data.asOfMs) ||
    data.asOfMs !== Date.parse(`${data.dayKey}T23:59:00+09:00`)
  )
    throw new Error(
      "랭킹 기준일을 확인하고 있습니다. 잠시 후 다시 연결해 주세요.",
    );
  return data;
}
function validChart(data: StockRankingDetail, ranking: RankingDate) {
  return (
    data.dayKey === ranking.dayKey &&
    data.asOfMs === ranking.asOfMs &&
    Array.isArray(data.points) &&
    data.points.every(
      (point, index) =>
        Number.isSafeInteger(point?.atMs) &&
        point.atMs > 0 &&
        point.atMs <= data.asOfMs &&
        (index === 0 || point.atMs > data.points[index - 1].atMs) &&
        (point.returnPercent === null || Number.isFinite(point.returnPercent)),
    )
  );
}
export async function getStockRanking(
  scope: WisStockScope,
  signal: AbortSignal,
  options: StockRankingOptions = {},
) {
  const data = await request<StockRanking>(
    scope,
    { filter: "all", ...options },
    signal,
  );
  if (
    !["READY", "NOT_READY"].includes(data.status) ||
    !Array.isArray(data.rows) ||
    data.rows.length > 10 ||
    (data.status === "NOT_READY" && data.rows.length > 0) ||
    typeof data.filter !== "string" ||
    !/^[1-3]_[1-9][0-9]?$/.test(data.myClassKey) ||
    !Array.isArray(data.classes) ||
    data.classes.some(
      (c) => !/^[1-3]_[1-9][0-9]?$/.test(c.key) || typeof c.label !== "string",
    ) ||
    typeof data.hasMore !== "boolean" ||
    (data.hasMore
      ? typeof data.nextCursor !== "string"
      : data.nextCursor !== null) ||
    data.rows.some(
      (row, index) =>
        !/^[1-9][0-9]{0,5}$/.test(row?.entryId) ||
        !Number.isInteger(row.rank) ||
        row.rank < 1 ||
        (data.filter === "all" && row.rank > 50) ||
        (index > 0 && row.rank <= data.rows[index - 1].rank) ||
        typeof row.displayName !== "string" ||
        !row.displayName.trim() ||
        !Number.isFinite(row.returnPercent),
    ) ||
    !Array.isArray(data.charts) ||
    data.charts.length > 5 ||
    data.charts.some(
      (chart) =>
        !validChart(chart, data) ||
        !data.rows.some(
          (row) =>
            row.entryId === chart.entryId &&
            row.rank === chart.rank &&
            row.displayName === chart.displayName,
        ),
    )
  )
    throw new Error("랭킹 연결을 확인해 주세요. 다시 연결할 수 있습니다.");
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
    { dayKey: ranking.dayKey, entryId: row.entryId, filter: ranking.filter },
    signal,
  );
  if (
    data.entryId !== row.entryId ||
    data.rank !== row.rank ||
    data.displayName !== row.displayName ||
    !validChart(data, ranking)
  )
    throw new Error("그래프 연결을 확인해 주세요. 다시 연결할 수 있습니다.");
  return data;
}
