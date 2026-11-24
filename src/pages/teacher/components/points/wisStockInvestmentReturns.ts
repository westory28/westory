import type { WisStockInvestmentBoardViewRow } from "../../../../../functions/wisStockInvestmentBoard.mjs";

import type { WisStockReturnObservation } from "../../../../lib/wisStockInvestmentHistoryClient";
export type { WisStockReturnObservation } from "../../../../lib/wisStockInvestmentHistoryClient";

/** Preserve actual observation times. A closed position is a gap, never 0% ROI. */
export function wisStockReturnObservations(observations: readonly RankPoint[]) {
  const points = new Map<number, RankPoint>();
  for (const point of observations) {
    if (
      Number.isSafeInteger(point.atMs) &&
      point.atMs > 0 &&
      point.atMs <= 8_640_000_000_000_000 &&
      ((point.holdingValue === null && point.holdingCostBasis === null) ||
        (typeof point.holdingValue === "number" &&
          Number.isSafeInteger(point.holdingValue) &&
          point.holdingValue >= 0 &&
          typeof point.holdingCostBasis === "number" &&
          Number.isSafeInteger(point.holdingCostBasis) &&
          point.holdingCostBasis >= 0))
    )
      points.set(point.atMs, point);
  }
  return [...points.values()]
    .sort((a, b) => a.atMs - b.atMs)
    .map((point) => ({
      ...point,
      returnPercent:
        point.holdingCostBasis !== null &&
        point.holdingValue !== null &&
        point.holdingCostBasis > 0
          ? ((point.holdingValue - point.holdingCostBasis) /
              point.holdingCostBasis) *
            100
          : null,
    }));
}

/** Current holdings only: cash transfers and realized gains have no shared cost basis here. */
export function topWisStockHoldingReturns(
  rows: readonly WisStockInvestmentBoardViewRow[],
) {
  return rows
    .filter((row) => row.holdingCount > 0 && row.holdingCostBasis > 0)
    .sort((a, b) => {
      // Compare exact fractions before formatting; large amounts and rounded ties stay ordered.
      const left = BigInt(a.unrealizedPnl) * BigInt(b.holdingCostBasis);
      const right = BigInt(b.unrealizedPnl) * BigInt(a.holdingCostBasis);
      return (
        (left === right ? 0 : left > right ? -1 : 1) ||
        Number(a.grade) - Number(b.grade) ||
        Number(a.classNumber) - Number(b.classNumber) ||
        Number(a.studentNumber) - Number(b.studentNumber) ||
        a.studentKey.localeCompare(b.studentKey)
      );
    })
    .slice(0, 5)
    .map((row) => ({
      ...row,
      returnPercent: (row.unrealizedPnl / row.holdingCostBasis) * 100,
    }));
}

type RankPoint = WisStockReturnObservation & { breakBefore?: boolean };
export interface HoldingReturnSeries {
  studentKey: string;
  studentName: string;
  studentLabel: string;
  returnPercent: number | null;
  observations: readonly RankPoint[];
  formerLeader?: boolean;
}
export function withRankTrace(
  current: HoldingReturnSeries[],
  rows: readonly WisStockInvestmentBoardViewRow[],
  samples: readonly import("../../../../lib/wisStockInvestmentHistoryClient").WisStockRankSample[],
) {
  if (!samples.length) return current;
  const roster = new Map(rows.map((row) => [row.studentKey, row]));
  const history = new Map<string, RankPoint[]>();
  let previous = new Set<string>();
  for (const { atMs, leaders } of samples) {
    const present = new Set<string>();
    for (const { studentKey, holdingValue, holdingCostBasis } of leaders) {
      if (!roster.has(studentKey)) continue;
      const line = history.get(studentKey) || [];
      line.push({
        atMs,
        holdingValue,
        holdingCostBasis,
        breakBefore: line.length > 0 && !previous.has(studentKey),
      });
      history.set(studentKey, line);
      present.add(studentKey);
    }
    previous = present;
  }
  const activeKeys = new Set(current.map((row) => row.studentKey));
  const archived: HoldingReturnSeries[] = [];
  for (const [key, observations] of history) {
    if (activeKeys.has(key)) continue;
    const row = roster.get(key)!;
    const last = observations.at(-1)!;
    archived.push({
      studentKey: key,
      studentName: row.displayName,
      studentLabel: `${row.grade}-${row.classNumber} · ${row.studentNumber}번`,
      returnPercent: (last.holdingValue! / last.holdingCostBasis! - 1) * 100,
      observations,
      formerLeader: true,
    });
  }
  const firstAtMs = samples[0].atMs;
  return [
    ...current.map((line) => ({
      ...line,
      observations: [
        // Before ranking snapshots existed, keep the original ledger chart for today's leaders.
        ...line.observations.filter((point) => point.atMs < firstAtMs),
        ...(history.get(line.studentKey) || []).map((point, index) =>
          index === 0 && point.atMs !== firstAtMs
            ? { ...point, breakBefore: true }
            : point,
        ),
      ],
    })),
    ...archived,
  ];
}
