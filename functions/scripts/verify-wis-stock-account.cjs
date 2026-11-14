const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getWisStockFundingLimits: limits, planWisStockTransfer: transfer } = require('../wisStockAccount');
const at = Date.parse('2026-11-16T01:00:00Z'), DAY = 86400000;
const snapshot = () => ({ mainCash: 10000, stockCash: 0, reservedCash: 0, outstandingPrincipal: 0, lastDepositAtMs: 0 });
const request = (state, amount, direction = 'DEPOSIT', nowMs = at, transferId = 'transfer_0001') => ({
  transferId, accountId: 'example_account', semesterId: '2026-2', direction, amount, nowMs, snapshot: state,
});
const apply = (state, result) => {
  state.mainCash += result.effects.mainCashDelta; state.stockCash += result.effects.stockCashDelta;
  state.outstandingPrincipal += result.effects.outstandingPrincipalDelta;
  if (result.effects.lastDepositAtMs !== null) state.lastDepositAtMs = result.effects.lastDepositAtMs;
};
const reason = expected => error => error.reason === expected;
test('deposit limit uses only current general Wis, floors odd values and ignores stock assets', () => {
  const state = { ...snapshot(), mainCash: 1001, stockCash: 900000, outstandingPrincipal: 500000, holdingCostBasis: 700000 };
  assert.equal(limits(state, at).maximumDeposit, 500);
  assert.throws(() => transfer(request(state, 501)), reason('WIS_STOCK_DEPOSIT_LIMIT'));
  const result = transfer(request(state, 500)); apply(state, result);
  assert.equal(state.mainCash, 501); assert.equal(state.stockCash, 900500);
  assert.equal(result.effects.earnedDelta, 0); assert.equal(result.effects.rankEarnedDelta, 0);
  assert.equal(result.effects.mainCashDelta + result.effects.stockCashDelta, 0);
  assert.equal(state.outstandingPrincipal, 500500); assert.equal(result.executable, false);
});
test('even a small successful deposit starts exactly 24 hours and recalculates from later main cash', () => {
  const state = { ...snapshot(), mainCash: 1001 }; apply(state, transfer(request(state, 1)));
  assert.equal(limits(state, at).maximumDeposit, 0); assert.equal(limits(state, at).nextDepositAtMs, at + DAY);
  assert.throws(() => transfer(request(state, 1, 'DEPOSIT', at + DAY - 1, 'transfer_0002')), reason('WIS_STOCK_DEPOSIT_COOLDOWN'));
  state.mainCash += 234; // General-Wis activity during the waiting day changes the next limit.
  assert.equal(limits(state, at + DAY).maximumDeposit, 617);
  apply(state, transfer(request(state, 617, 'DEPOSIT', at + DAY, 'transfer_0002')));
  assert.equal(state.lastDepositAtMs, at + DAY); assert.equal(limits(state, at + DAY + 1).maximumDeposit, 0);
});
test('receipt replay does not move funds or extend cooldown and conflicts are rejected', () => {
  const state = snapshot(), input = request(state, 5000), first = transfer(input); apply(state, first);
  const replay = transfer({ ...input, nowMs: at + DAY, snapshot: null, existingReceipt: first.receipt });
  assert.equal(replay.changed, false); assert.deepEqual(replay.receipt, first.receipt);
  assert.equal(replay.effects.lastDepositAtMs, null);
  for (const [key, value] of Object.entries(replay.effects)) if (key !== 'lastDepositAtMs') assert.equal(value, 0);
  assert.equal(state.lastDepositAtMs, at);
  assert.throws(() => transfer({ ...input, amount: 4999, existingReceipt: first.receipt }), reason('WIS_STOCK_TRANSFER_CONFLICT'));
  assert.throws(() => transfer({ ...input, existingReceipt: { ...first.receipt, withdrawnProfit: 1 } }), reason('WIS_STOCK_TRANSFER_CONFLICT'));
});
test('withdrawal returns principal first and recognizes only withdrawn profit with no rank credit', () => {
  const state = snapshot(); apply(state, transfer(request(state, 5000))); state.stockCash = 6000;
  const first = transfer(request(state, 3000, 'WITHDRAW', at + 1, 'withdraw_001')); apply(state, first);
  assert.equal(first.effects.earnedDelta, 0); assert.equal(state.outstandingPrincipal, 2000);
  const last = transfer(request(state, 3000, 'WITHDRAW', at + 2, 'withdraw_002')); apply(state, last);
  assert.equal(last.receipt.principalReturned, 2000); assert.equal(last.receipt.withdrawnProfit, 1000);
  assert.equal(last.effects.mainCashDelta, 3000); assert.equal(last.effects.earnedDelta, 1000);
  assert.equal(last.effects.rankEarnedDelta, 0); assert.equal(state.outstandingPrincipal, 0);
  assert.equal(state.mainCash, 11000); assert.equal(state.stockCash, 0); assert.equal(state.lastDepositAtMs, at);
  const replay = transfer({ ...request(state, 3000, 'WITHDRAW', at + 100, 'withdraw_002'), existingReceipt: last.receipt });
  assert.equal(replay.effects.earnedDelta, 0); assert.equal(replay.effects.mainCashDelta, 0);
});
test('unreturned loss principal survives an empty stock account and prevents recovery being counted twice', () => {
  const state = snapshot(); apply(state, transfer(request(state, 5000))); state.stockCash = 4000;
  const loss = transfer(request(state, 4000, 'WITHDRAW', at + 1, 'withdraw_001')); apply(state, loss);
  assert.equal(state.stockCash, 0); assert.equal(state.outstandingPrincipal, 1000); assert.equal(loss.effects.earnedDelta, 0);
  state.mainCash = 10000; apply(state, transfer(request(state, 5000, 'DEPOSIT', at + DAY, 'transfer_0002')));
  state.stockCash = 6000;
  const recovery = transfer(request(state, 6000, 'WITHDRAW', at + DAY + 1, 'withdraw_002')); apply(state, recovery);
  assert.equal(recovery.effects.earnedDelta, 0); assert.equal(state.outstandingPrincipal, 0);
  // A previously earned profit subsequently redeposited is principal again.
  apply(state, transfer(request(state, 5000, 'DEPOSIT', at + 2 * DAY, 'transfer_0003')));
  const again = transfer(request(state, 5000, 'WITHDRAW', at + 2 * DAY + 1, 'withdraw_003'));
  assert.equal(again.effects.earnedDelta, 0);
});
test('reserved cash is not withdrawable, and withdrawals never reset deposit cooldown', () => {
  const state = { ...snapshot(), mainCash: 500, stockCash: 500, reservedCash: 200, outstandingPrincipal: 500, lastDepositAtMs: at };
  assert.equal(limits(state, at + 1).maximumWithdrawal, 300);
  assert.throws(() => transfer(request(state, 301, 'WITHDRAW', at + 1)), reason('WIS_STOCK_WITHDRAWAL_LIMIT'));
  apply(state, transfer(request(state, 300, 'WITHDRAW', at + 1)));
  assert.equal(state.stockCash, 200); assert.equal(state.lastDepositAtMs, at);
  assert.throws(() => transfer(request(state, 1, 'DEPOSIT', at + 2)), reason('WIS_STOCK_DEPOSIT_COOLDOWN'));
});
test('invalid clocks, amounts, scope, backing and safe-integer overflows fail before any posting', () => {
  const state = snapshot(), before = structuredClone(state);
  for (const patch of [{ amount: 0 }, { amount: -1 }, { amount: 1.5 }, { nowMs: 0 }, { nowMs: -1 }, { semesterId: 'legacy' }, { accountId: 'bad' }])
    assert.throws(() => transfer({ ...request(state, 1), ...patch }), reason('WIS_STOCK_TRANSFER_INVALID'));
  assert.throws(() => limits({ ...state, reservedCash: 1 }, at), reason('WIS_STOCK_ACCOUNT_INVALID'));
  assert.throws(() => limits({ ...state, lastDepositAtMs: at + 1 }, at), reason('WIS_STOCK_ACCOUNT_INVALID'));
  for (const key of ['stockCash', 'outstandingPrincipal']) assert.throws(() => transfer(request({ ...state, [key]: Number.MAX_SAFE_INTEGER }, 1)), reason('WIS_STOCK_UNSAFE_TOTAL'));
  assert.throws(() => transfer(request({ ...state, mainCash: Number.MAX_SAFE_INTEGER, stockCash: 1 }, 1, 'WITHDRAW')), reason('WIS_STOCK_UNSAFE_TOTAL'));
  assert.deepEqual(state, before);
});
