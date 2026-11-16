import type { WisStockInvestmentBoardViewRow } from "../../../../../functions/wisStockInvestmentBoard.mjs";

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
