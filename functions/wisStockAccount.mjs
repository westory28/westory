import { WisStockRuleError } from './wisStockMarketRules.mjs';
const MAX = Number.MAX_SAFE_INTEGER;
const valid = value => Number.isSafeInteger(value) && value >= 0;
const fail = (reason, message) => { throw new WisStockRuleError(reason, message); };
const safe = value => {
  if (value > BigInt(MAX) || value < -BigInt(MAX)) fail('WIS_STOCK_UNSAFE_TOTAL', '계산 가능한 자산 범위를 넘었습니다.');
  return Number(value);
};
export function getWisStockFundingLimits(snapshot, nowMs) {
  if (!snapshot || !['mainCash', 'stockCash', 'reservedCash', 'lastDepositAtMs', 'outstandingPrincipal'].every(key => valid(snapshot[key]))
    || !valid(nowMs) || snapshot.lastDepositAtMs > nowMs
    || snapshot.reservedCash > snapshot.stockCash) fail('WIS_STOCK_ACCOUNT_INVALID', '일반 위스·주식 계좌·예약 금액을 확인해 주세요.');
  // Only current general Wis is the denominator. Stock cash, reserved cash,
  // purchase cost and mark-to-market gains never increase this deposit limit.
  const nextDepositAtMs = snapshot.lastDepositAtMs === 0 ? 0 : safe(BigInt(snapshot.lastDepositAtMs) + 86400000n);
  const remainingCooldownMs = Math.max(0, nextDepositAtMs - nowMs), depositLimitBeforeCooldown = Math.floor(snapshot.mainCash / 2);
  return { maximumDeposit: remainingCooldownMs ? 0 : depositLimitBeforeCooldown,
    maximumWithdrawal: snapshot.stockCash - snapshot.reservedCash, depositLimitBeforeCooldown,
    nextDepositAtMs, remainingCooldownMs, hardCapBps: 5000 };
}
// Pure plan, not a transfer endpoint. A future server transaction must bind
// the authenticated account and semester, re-read both cash balances, global
// reservations and unrecovered principal, and commit deltas plus this receipt
// atomically. Never route a transfer through the general GRANT wallet writer.
export function planWisStockTransfer(input) {
  if (!input || !/^[A-Za-z0-9_-]{8,120}$/.test(input.transferId || '') || !/^[A-Za-z0-9_-]{8,160}$/.test(input.accountId || '')
    || !/^20\d{2}-[12]$/.test(input.semesterId || '') || !['DEPOSIT', 'WITHDRAW'].includes(input.direction)
    || !valid(input.amount) || input.amount === 0 || !valid(input.nowMs) || input.nowMs === 0) fail('WIS_STOCK_TRANSFER_INVALID', '입출금 요청을 확인해 주세요.');
  const { existingReceipt: previous } = input;
  if (previous) {
    if (previous.schemaVersion !== 1 || previous.status !== 'APPLIED' || !valid(previous.appliedAtMs) || previous.appliedAtMs === 0
      || previous.id !== input.transferId || previous.accountId !== input.accountId || previous.semesterId !== input.semesterId
      || previous.direction !== input.direction || previous.amount !== input.amount
      || !valid(previous.principalReturned) || !valid(previous.withdrawnProfit)
      || (previous.direction === 'DEPOSIT' ? (previous.principalReturned !== 0 || previous.withdrawnProfit !== 0 || previous.outstandingPrincipalDelta !== previous.amount)
        : (BigInt(previous.principalReturned) + BigInt(previous.withdrawnProfit) !== BigInt(previous.amount) || previous.outstandingPrincipalDelta !== -previous.principalReturned)))
      fail('WIS_STOCK_TRANSFER_CONFLICT', '같은 입출금 요청의 내용이 달라졌습니다.');
    return { changed: false, receipt: { ...previous }, limits: null,
      effects: { mainCashDelta: 0, stockCashDelta: 0, outstandingPrincipalDelta: 0, earnedDelta: 0, rankEarnedDelta: 0, lastDepositAtMs: null }, executable: false };
  }
  const limits = getWisStockFundingLimits(input.snapshot, input.nowMs);
  if (input.direction === 'DEPOSIT' && limits.remainingCooldownMs) fail('WIS_STOCK_DEPOSIT_COOLDOWN', '입금 후 24시간이 지나야 다시 입금할 수 있습니다.');
  if (input.direction === 'DEPOSIT' && input.amount > limits.maximumDeposit) fail('WIS_STOCK_DEPOSIT_LIMIT', '현재 일반 위스의 50% 이내에서 입금해 주세요.');
  if (input.direction === 'WITHDRAW' && input.amount > limits.maximumWithdrawal) fail('WIS_STOCK_WITHDRAWAL_LIMIT', '예약되지 않은 주식 계좌 잔액 안에서 출금해 주세요.');
  const delta = input.direction === 'DEPOSIT' ? input.amount : -input.amount;
  // General Wis recognizes only withdrawn profit, after all unrecovered
  // deposits (including earlier losses) have been returned. Trading itself
  // never changes general cumulative Wis or its activity-based rank.
  const principalReturned = input.direction === 'WITHDRAW' ? Math.min(input.amount, input.snapshot.outstandingPrincipal) : 0;
  const withdrawnProfit = input.direction === 'WITHDRAW' ? input.amount - principalReturned : 0;
  const outstandingPrincipalDelta = input.direction === 'DEPOSIT' ? input.amount : -principalReturned;
  // Per-field increments preserve other transfers or grants in a transaction.
  safe(BigInt(input.snapshot.stockCash) + BigInt(delta)); safe(BigInt(input.snapshot.mainCash) - BigInt(delta));
  safe(BigInt(input.snapshot.outstandingPrincipal) + BigInt(outstandingPrincipalDelta));
  return { changed: true, receipt: { schemaVersion: 1, id: input.transferId, accountId: input.accountId,
    semesterId: input.semesterId, direction: input.direction, amount: input.amount, appliedAtMs: input.nowMs, status: 'APPLIED',
    principalReturned, withdrawnProfit, outstandingPrincipalDelta },
    limits, effects: { mainCashDelta: -delta, stockCashDelta: delta, outstandingPrincipalDelta, earnedDelta: withdrawnProfit, rankEarnedDelta: 0,
      lastDepositAtMs: input.direction === 'DEPOSIT' ? input.nowMs : null }, executable: false };
}
