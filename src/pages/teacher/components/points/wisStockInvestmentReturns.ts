import type { WisStockInvestmentBoardViewRow } from "../../../../../functions/wisStockInvestmentBoard.mjs";

import type { WisStockReturnObservation } from "../../../../lib/wisStockInvestmentHistoryClient";
export type { WisStockReturnObservation } from "../../../../lib/wisStockInvestmentHistoryClient";

/** Preserve actual observation times. A closed position is a gap, never 0% ROI. */
export function wisStockReturnObservations(
  observations: readonly WisStockReturnObservation[],
) {
  const points = new Map<number, WisStockReturnObservation>();
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
