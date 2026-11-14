export interface WisStockAccountSnapshot {
  mainCash: number; stockCash: number; reservedCash: number; lastDepositAtMs: number;
  /** All deposited principal not yet returned, retained even after a loss. */
  outstandingPrincipal: number;
}
export interface WisStockFundingLimits {
  maximumDeposit: number; maximumWithdrawal: number; depositLimitBeforeCooldown: number;
  nextDepositAtMs: number; remainingCooldownMs: number; hardCapBps: 5000;
}
export interface WisStockTransferReceipt {
  schemaVersion: 1; id: string; accountId: string; semesterId: string;
  direction: 'DEPOSIT' | 'WITHDRAW'; amount: number; appliedAtMs: number; status: 'APPLIED';
  principalReturned: number; withdrawnProfit: number; outstandingPrincipalDelta: number;
}
export function getWisStockFundingLimits(snapshot: WisStockAccountSnapshot, nowMs: number): WisStockFundingLimits;
export function planWisStockTransfer(input: {
  transferId: string; accountId: string; semesterId: string; direction: 'DEPOSIT' | 'WITHDRAW'; amount: number;
  nowMs: number; snapshot: WisStockAccountSnapshot; existingReceipt?: WisStockTransferReceipt | null;
}): {
  changed: boolean; receipt: WisStockTransferReceipt; limits: WisStockFundingLimits | null;
  effects: { mainCashDelta: number; stockCashDelta: number; outstandingPrincipalDelta: number;
    earnedDelta: number; rankEarnedDelta: 0; lastDepositAtMs: number | null }; executable: false;
};
