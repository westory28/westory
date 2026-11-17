const assert = require('node:assert/strict');
const test = require('node:test');
const { grantWisStockRestrictedBonus, tagWisStockBonusOrder, applyWisStockBonusOrder,
  validateWisStockBonusAccount, wisStockBonusFunding, assertWisStockBonusReady } = require('../wisStockBonusAccounting');
const { getWisStockFundingLimits, planWisStockTransfer } = require('../wisStockAccount');
let serial = 0;
const pos = () => ({ quantity: 0, principal: 0, costBasis: 0, reservedBuyQuantity: 0, reservedSellQuantity: 0,
  reservedSellPrincipal: 0, reservedSellCostBasis: 0 });
function account(cash = 0) { return { schemaVersion: 1, revision: 1, stockCash: cash, reservedCash: 0,
  outstandingPrincipal: cash, positions: { stock: pos() }, pendingOrders: {} }; }
function limits(a) { return getWisStockFundingLimits({ mainCash: 0, lastDepositAtMs: 0, ...a, ...wisStockBonusFunding(a) }, 100); }
function accept(a, side, quantity, cash) {
  const previous = structuredClone(a), p = a.positions.stock;
  const order = tagWisStockBonusOrder(previous, { id: `stockord_${String(++serial).padStart(64, '0')}`, side, quantity,
    stockId: 'stock', cashDebit: side === 'BUY' ? cash : 0, cashCredit: side === 'SELL' ? cash : 0, status: 'PENDING',
    reservedCostBasis: side === 'SELL' ? Math.floor((p.costBasis - p.reservedSellCostBasis) * quantity / (p.quantity - p.reservedSellQuantity)) : 0 });
  a.pendingOrders[order.id] = order;
  if (side === 'BUY') { a.reservedCash += cash; p.reservedBuyQuantity += quantity; }
  else { p.reservedSellQuantity += quantity; p.reservedSellCostBasis += order.reservedCostBasis; }
  a.revision++; applyWisStockBonusOrder(previous, a, { order }); return order.id;
}
function finish(a, id, cancelled = false) {
  const previous = structuredClone(a), order = { ...a.pendingOrders[id], status: cancelled ? 'CANCELLED' : 'FILLED' }, p = a.positions.stock;
  delete a.pendingOrders[id];
  if (order.side === 'BUY') {
    a.reservedCash -= order.cashDebit; p.reservedBuyQuantity -= order.quantity;
    if (!cancelled) { a.stockCash -= order.cashDebit; p.quantity += order.quantity; p.costBasis += order.cashDebit; }
  } else {
    p.reservedSellQuantity -= order.quantity; p.reservedSellCostBasis -= order.reservedCostBasis;
    if (!cancelled) { a.stockCash += order.cashCredit; p.quantity -= order.quantity; p.costBasis -= order.reservedCostBasis; }
  }
  a.revision++; applyWisStockBonusOrder(previous, a, { order }); validateWisStockBonusAccount(a); return order;
}
const buy = (a, q, cost) => finish(a, accept(a, 'BUY', q, cost));
const sell = (a, q, net) => finish(a, accept(a, 'SELL', q, net));
test('support principal stays locked while personal cash and realized net profit can be withdrawn', () => {
  const a = account(1000); grantWisStockRestrictedBonus(a, 500);
  assert.equal(a.schemaVersion, 2); assert.equal(a.outstandingPrincipal, 1000); assert.equal(limits(a).maximumWithdrawal, 1000);
  const id = accept(a, 'BUY', 5, 500);
  assert.equal(a.eventBonusReservedCash, 500); assert.equal(limits(a).maximumWithdrawal, 1000);
  finish(a, id); assert.equal(a.eventBonusRestrictedCash, 0); assert.equal(limits(a).maximumWithdrawal, 1000);
  sell(a, 5, 600); assert.equal(a.eventBonusRestrictedCash, 500); assert.equal(limits(a).maximumWithdrawal, 1100);
});
test('old personal holdings losses cannot be repaid from the support principal', () => {
  const a = account(); a.outstandingPrincipal = 1000; a.positions.stock = { ...pos(), quantity: 100, principal: 1000, costBasis: 1000 };
  grantWisStockRestrictedBonus(a, 500); buy(a, 500, 500); sell(a, 600, 600);
  assert.equal(a.eventBonusRestrictedCash, 500); assert.equal(a.eventBonusLossCarryforward, 0);
  assert.equal(limits(a).maximumWithdrawal, 100);
});
test('fees and losses are carried forward; a round trip that only recovers the loss unlocks no grant', () => {
  const a = account(); grantWisStockRestrictedBonus(a, 500);
  buy(a, 5, 500); sell(a, 5, 480);
  assert.equal(a.eventBonusRestrictedCash, 480); assert.equal(a.eventBonusLossCarryforward, 20);
  buy(a, 4, 400); sell(a, 4, 420);
  assert.equal(a.eventBonusRestrictedCash, 500); assert.equal(a.eventBonusLossCarryforward, 0); assert.equal(limits(a).maximumWithdrawal, 0);
  buy(a, 5, 500); sell(a, 5, 550); assert.equal(limits(a).maximumWithdrawal, 50);
});
test('personal deposits remain withdrawable after the entire support is lost', () => {
  const a = account(); grantWisStockRestrictedBonus(a, 500); buy(a, 5, 500); sell(a, 5, 0);
  assert.equal(a.eventBonusLossCarryforward, 500); a.stockCash += 700; a.outstandingPrincipal += 700;
  assert.equal(limits(a).maximumWithdrawal, 700); buy(a, 7, 700); sell(a, 7, 710);
  assert.equal(limits(a).maximumWithdrawal, 710); assert.equal(a.eventBonusRestrictedCash, 0);
});
test('mixed funding has a separate purchase source and proportionate fees', () => {
  const a = account(500); grantWisStockRestrictedBonus(a, 500); buy(a, 10, 1000); sell(a, 10, 900);
  assert.equal(a.eventBonusRestrictedCash, 450); assert.equal(a.eventBonusLossCarryforward, 50); assert.equal(limits(a).maximumWithdrawal, 450);
});
test('multiple reservations, reverse fills and cancellations conserve exact source quantities and principal', () => {
  const a = account(1000); grantWisStockRestrictedBonus(a, 500);
  const first = accept(a, 'BUY', 3, 303), second = accept(a, 'BUY', 2, 202);
  assert.equal(a.eventBonusReservedCash, 500); finish(a, second); finish(a, first);
  const s1 = accept(a, 'SELL', 1, 100), s2 = accept(a, 'SELL', 1, 100), s3 = accept(a, 'SELL', 3, 300);
  finish(a, s2, true); finish(a, s3); finish(a, s1); sell(a, 1, 100);
  assert.equal(a.positions.stock.quantity, 0); assert.equal(a.positions.stock.eventBonusLots, undefined);
  assert.equal(a.eventBonusRestrictedCash + a.eventBonusLossCarryforward, 500);
  assert.equal(a.eventBonusReservedCash, 0); assert.equal(a.reservedCash, 0);
});
test('splitting mixed lots into unit sales cannot unlock grant principal through integer rounding', () => {
  for (const quantity of [3, 7, 11, 101]) {
    const a = account(500); grantWisStockRestrictedBonus(a, 500); buy(a, quantity, 1000);
    let through = 0;
    for (let i = 1; i <= quantity; i++) { const next = Math.floor(1000 * i / quantity); sell(a, 1, next - through); through = next; }
    assert.equal(a.stockCash, 1000); assert.equal(a.eventBonusRestrictedCash, 500);
    assert.equal(a.eventBonusLossCarryforward, 0); assert.equal(limits(a).maximumWithdrawal, 500);
  }
});
test('a small grant fraction cannot lock personal funds through repeated rounding or reverse settlements', () => {
  const prepare = () => { const a = account(99500); grantWisStockRestrictedBonus(a, 500); buy(a, 1000, 100000); return a; };
  const whole = prepare(), split = prepare(), reversed = prepare();
  sell(whole, 1000, 50000);
  for (let index = 0; index < 1000; index++) sell(split, 1, 50);
  const pending = Array.from({ length: 20 }, () => accept(reversed, 'SELL', 1, 50));
  for (const id of pending.reverse()) finish(reversed, id);
  sell(reversed, 980, 49000);
  for (const a of [whole, split, reversed]) {
    assert.equal(a.eventBonusRestrictedCash, 250); assert.equal(a.eventBonusLossCarryforward, 250);
    assert.equal(limits(a).maximumWithdrawal, 49750);
  }
});
test('legacy orders predating the grant remain personal funds, while policy upgrade blocks unknown event balances', () => {
  const a = account(1000), id = accept(a, 'BUY', 2, 200); grantWisStockRestrictedBonus(a, 500); finish(a, id);
  assert.equal(a.positions.stock.eventBonusLots, undefined); assert.equal(a.eventBonusRestrictedCash, 500);
  const old = { ...account(1000), eventBonusTotal: 500 };
  assert.throws(() => assertWisStockBonusReady(old), error => error.reason === 'WIS_STOCK_BONUS_RESTRICTION_PENDING');
  assert.equal(limits(old).maximumWithdrawal, 0);
});
test('withdrawal cannot consume restricted cash and an existing applied receipt remains replayable', () => {
  const a = account(100); grantWisStockRestrictedBonus(a, 500);
  const input = { transferId: 'transfer_bonus_001', accountId: 'account_bonus_001', semesterId: '2026-2', direction: 'WITHDRAW', amount: 101,
    nowMs: 100, snapshot: { mainCash: 0, lastDepositAtMs: 0, ...a, ...wisStockBonusFunding(a) } };
  assert.throws(() => planWisStockTransfer(input), error => error.reason === 'WIS_STOCK_WITHDRAWAL_LIMIT');
  const old = { schemaVersion: 1, id: input.transferId, accountId: input.accountId, semesterId: input.semesterId,
    direction: 'WITHDRAW', amount: 101, principalReturned: 101, withdrawnProfit: 0, outstandingPrincipalDelta: -101, status: 'APPLIED', appliedAtMs: 90 };
  assert.equal(planWisStockTransfer({ ...input, existingReceipt: old }).changed, false);
});
