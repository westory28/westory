const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), vm = require('node:vm');
const { normalizeWisStockMarketRules: rules, normalizeWisStockTradingSettings: settings } = require('../wisStockMarketRules');
const { acceptWisStockOrder: accept, finalizeWisStockOrder: fill, cancelWisStockOrder: cancel, EMPTY_WIS_STOCK_RESERVATIONS: empty } = require('../wisStockOrderLifecycle');
const at = Date.parse('2026-11-16T01:00:00Z'), stockId = `stock_${'a'.repeat(24)}`;
const accountId = 'example_account', semesterId = '2026-2';
const execution = () => ({ serviceAllowed: true, authorized: true, scopeActive: true, marketHalted: false, tradingStatus: 'ACTIVE', haltedUntilMs: 0 });
const state = () => ({ portfolio: { cashBalance: 10000, holdingQuantity: 0, holdingPrincipal: 0, holdingCostBasis: 0,
  portfolioValue: 10000, dayKey: '2026-11-16', dailyBuyAmount: 0, dailyOrderCount: 0, lastOrderAtMs: 0,
  cumulativeRealizedPnl: 0, profitHighWatermark: 0 }, reservations: { ...empty },
  supply: { issuedShares: 100000, availableShares: 100000, reservedBuyQuantity: 0 } });
const request = (s, patch = {}) => ({ orderId: 'order_000001', accountId, semesterId, delaySeconds: 60,
  reservations: s.reservations, supplyReservedBuyQuantity: s.supply.reservedBuyQuantity,
  quoteInput: { rules: rules({ cooldownSeconds: 0 }), side: 'BUY', quantity: 10, nowMs: at, marketRevision: 3,
    stock: { id: stockId, price: 100, settings: settings(), haltedUntilMs: 0, availableShares: s.supply.availableShares },
    quote: { stockId, price: 100, atMs: at, marketRevision: 3 }, portfolio: s.portfolio, ...patch } });
const context = (s, order, nowMs = order.dueAtMs) => ({ accountId, semesterId, order, nowMs, ...s, execution: execution() });
const reason = expected => error => error.reason === expected;
function apply(s, transition) {
  const e = transition.effects, p = s.portfolio, r = s.reservations;
  for (const [target, key] of Object.entries({ cashBalance: 'stockCashDelta', holdingQuantity: 'holdingQuantityDelta', holdingPrincipal: 'holdingPrincipalDelta', holdingCostBasis: 'holdingCostBasisDelta', dailyBuyAmount: 'dailyBuyAmountDelta', dailyOrderCount: 'dailyOrderCountDelta', cumulativeRealizedPnl: 'cumulativeRealizedPnlDelta', profitHighWatermark: 'profitHighWatermarkDelta' })) p[target] += e[key];
  for (const [target, key] of Object.entries({ cash: 'reservedCashDelta', buyQuantity: 'reservedBuyQuantityDelta', buyFees: 'reservedBuyFeesDelta', sellQuantity: 'reservedSellQuantityDelta', sellPrincipal: 'reservedSellPrincipalDelta', sellCostBasis: 'reservedSellCostBasisDelta' })) r[target] += e[key];
  s.supply.availableShares += e.availableSharesDelta; s.supply.reservedBuyQuantity += e.marketReservedBuyQuantityDelta;
  if (e.counterDayKey !== null) p.dayKey = e.counterDayKey;
  if (e.lastOrderAtMs !== null) p.lastOrderAtMs = e.lastOrderAtMs;
  p.portfolioValue = p.cashBalance + p.holdingQuantity * 100;
}
function sellRequest(s, quantity = 1, price = 400) {
  const input = request(s, { side: 'SELL', quantity }); input.quoteInput.stock.price = input.quoteInput.quote.price = price;
  s.portfolio.portfolioValue = s.portfolio.cashBalance + s.portfolio.holdingQuantity * price; return input;
}
test('acceptance freezes confirmed price and fee, reserves money and central supply, and changes no cash or earnings', () => {
  const s = state(), input = request(s), before = structuredClone(input), result = accept(input); apply(s, result);
  assert.deepEqual(before.quoteInput.stock, input.quoteInput.stock);
  assert.equal(result.order.status, 'PENDING'); assert.equal(result.order.unitPrice, 100); assert.equal(result.order.fee, 10);
  assert.equal(result.order.dueAtMs, at + 60000); assert.equal(s.portfolio.cashBalance, 10000);
  assert.equal(s.reservations.cash, 1010); assert.equal(s.supply.availableShares, 99990); assert.equal(s.supply.reservedBuyQuantity, 10);
  assert.equal(result.effects.mainCashDelta, 0); assert.equal(result.effects.earnedDelta, 0); assert.equal(result.effects.rankEarnedDelta, 0);
  assert.equal(result.executable, false);
  const changed = request(state()); changed.quoteInput.stock.price = 101;
  assert.throws(() => accept(changed), reason('WIS_STOCK_FIRM_QUOTE_CHANGED'));
  for (const delaySeconds of [0, 4, 61, 5.1]) assert.throws(() => accept({ ...request(state()), delaySeconds }), reason('WIS_STOCK_ORDER_INVALID'));
});
test('early fill fails and exact due fills at the accepted price despite quote expiry or session closing', () => {
  const s = state(), input = request(s), nearClose = Date.parse('2026-11-16T06:59:50Z');
  input.quoteInput.nowMs = input.quoteInput.quote.atMs = nearClose;
  const pending = accept(input); apply(s, pending);
  assert.throws(() => fill(context(s, pending.order, pending.order.dueAtMs - 1)), reason('WIS_STOCK_ORDER_NOT_DUE'));
  // An unrelated credit arrives during the wait; only a debit delta is applied.
  s.portfolio.cashBalance += 777;
  input.quoteInput.stock.price = 999; input.quoteInput.rules.buyFeeBps = 1000; input.quoteInput.marketRevision = 99;
  const result = fill(context(s, pending.order)); apply(s, result);
  assert.equal(result.order.status, 'FILLED'); assert.equal(result.effects.stockCashDelta, -1010);
  assert.equal(s.portfolio.cashBalance, 9767); assert.equal(s.portfolio.holdingQuantity, 10);
  assert.equal(s.portfolio.holdingCostBasis, 1010); assert.equal(s.reservations.cash, 0);
  assert.equal(s.supply.availableShares, 99990); assert.equal(s.supply.reservedBuyQuantity, 0);
});
test('accept replay, fill replay and cancel replay have zero effects independent of later balances', () => {
  const s = state(), input = request(s), pending = accept(input); apply(s, pending);
  const duplicate = accept({ ...input, quoteInput: { ...input.quoteInput, portfolio: null }, existingOrder: pending.order });
  assert.equal(duplicate.changed, false); assert.equal(duplicate.effects.reservedCashDelta, 0);
  assert.throws(() => accept({ ...input, quoteInput: { ...input.quoteInput, quantity: 11 }, existingOrder: pending.order }), reason('WIS_STOCK_ORDER_CONFLICT'));
  const terminal = cancel(context(s, pending.order, at + 1)); apply(s, terminal);
  assert.equal(s.reservations.cash, 0); assert.equal(s.supply.availableShares, 100000);
  for (const operation of [fill, cancel]) {
    const replay = operation({ accountId, semesterId, order: terminal.order });
    assert.equal(replay.changed, false);
    for (const value of Object.values(replay.effects)) assert.ok(value === 0 || value === null);
  }
  const s2 = state(), p2 = accept(request(s2)); apply(s2, p2); const terminal2 = fill(context(s2, p2.order));
  assert.equal(fill({ accountId, semesterId, order: terminal2.order }).changed, false);
});
test('execution restrictions cancel and return reservations, with SELL_ONLY allowing an accepted sell', () => {
  for (const patch of [{ serviceAllowed: false }, { authorized: false }, { scopeActive: false }, { marketHalted: true },
    { tradingStatus: 'HALTED' }, { tradingStatus: 'SELL_ONLY' }, { haltedUntilMs: at + 60001 }]) {
    const s = state(), pending = accept(request(s)); apply(s, pending);
    const result = fill({ ...context(s, pending.order), execution: { ...execution(), ...patch } }); apply(s, result);
    assert.equal(result.order.status, 'CANCELLED'); assert.equal(s.portfolio.cashBalance, 10000);
    assert.equal(s.reservations.cash, 0); assert.equal(s.supply.availableShares, 100000);
  }
  const s = state(); Object.assign(s.portfolio, { holdingQuantity: 3, holdingPrincipal: 990, holdingCostBasis: 1001 }); s.supply.availableShares -= 3;
  const pending = accept(sellRequest(s)); apply(s, pending);
  const result = fill({ ...context(s, pending.order), execution: { ...execution(), tradingStatus: 'SELL_ONLY', haltedUntilMs: pending.order.dueAtMs } });
  assert.equal(result.order.status, 'FILLED'); assert.equal(result.effects.earnedDelta, 0);
});
test('aggregated buy reservations prevent cash, holding and supply reuse across pending orders', () => {
  const s = state(); s.portfolio.cashBalance = s.portfolio.portfolioValue = 2200;
  const first = accept(request(s)); apply(s, first);
  const second = request(s); second.orderId = 'order_000002';
  assert.throws(() => accept(second), reason('WIS_STOCK_INSUFFICIENT_CASH'));
  const s2 = state(), first2 = accept(request(s2)); apply(s2, first2);
  const cap = request(s2); cap.orderId = 'order_000002'; cap.quoteInput.rules.maxOrderQuantity = cap.quoteInput.rules.maxHoldingQuantity = 15;
  assert.throws(() => accept(cap), reason('WIS_STOCK_HOLDING_LIMIT'));
  const scarce = request(state()); scarce.quoteInput.stock.availableShares = 9;
  assert.throws(() => accept(scarce), reason('WIS_STOCK_ISSUED_LIMIT'));
});
test('three simultaneous sell reservations retain every unit of cost when filled in reverse order', () => {
  const s = state(); Object.assign(s.portfolio, { holdingQuantity: 3, holdingPrincipal: 990, holdingCostBasis: 1001 }); s.supply.availableShares -= 3;
  const orders = [];
  for (let index = 0; index < 3; index++) {
    const input = sellRequest(s); input.orderId = `order_00000${index + 1}`;
    const pending = accept(input); orders.push(pending.order); apply(s, pending);
  }
  assert.equal(s.reservations.sellQuantity, 3); assert.equal(s.reservations.sellCostBasis, 1001);
  assert.throws(() => accept(sellRequest(s)), reason('WIS_STOCK_INSUFFICIENT_HOLDING'));
  for (const order of orders.reverse()) { const result = fill(context(s, order)); apply(s, result); assert.equal(result.effects.earnedDelta, 0); }
  assert.equal(s.portfolio.holdingQuantity, 0); assert.equal(s.portfolio.holdingPrincipal, 0); assert.equal(s.portfolio.holdingCostBasis, 0);
  assert.equal(s.portfolio.cumulativeRealizedPnl, 187); assert.equal(s.portfolio.cashBalance, 11188);
  assert.equal(s.supply.availableShares, 100000); assert.equal(s.reservations.sellCostBasis, 0);
});
test('cancel releases same-day buy budget but retains accepted order count and cooldown', () => {
  const s = state(), pending = accept(request(s)); apply(s, pending);
  const terminal = cancel(context(s, pending.order, at + 1)); apply(s, terminal);
  assert.equal(s.portfolio.dailyBuyAmount, 0); assert.equal(s.portfolio.dailyOrderCount, 1); assert.equal(s.portfolio.lastOrderAtMs, at);
  const s2 = state(), p2 = accept(request(s2)); apply(s2, p2); s2.portfolio.dayKey = '2026-11-17'; s2.portfolio.dailyBuyAmount = 77;
  const nextDay = cancel(context(s2, p2.order, at + 86400000)); apply(s2, nextDay);
  assert.equal(s2.portfolio.dailyBuyAmount, 77); assert.equal(nextDay.effects.counterDayKey, null);
});
test('scope, impossible supply and missing reservation backing fail closed', () => {
  const s = state(), pending = accept(request(s)); apply(s, pending);
  assert.throws(() => fill({ ...context(s, pending.order), accountId: 'another_account' }), reason('WIS_STOCK_ORDER_INVALID'));
  assert.throws(() => fill({ ...context(s, pending.order), order: { ...pending.order, cashDebit: 1 } }), reason('WIS_STOCK_ORDER_INVALID'));
  assert.throws(() => fill({ ...context(s, pending.order), reservations: { ...s.reservations, cash: 0 } }), reason('WIS_STOCK_RESERVATION_INVALID'));
  assert.throws(() => accept({ ...request(state()), supplyReservedBuyQuantity: 1 }), reason('WIS_STOCK_RESERVATION_INVALID'));
  s.portfolio.cashBalance = 1000;
  assert.equal(fill(context(s, pending.order)).order.cancellationReason, 'CASH_BACKING_CHANGED');
});
test('trusted server random delay uses crypto bounds 5 inclusive and 61 exclusive', () => {
  const calls = [], sandbox = { module: { exports: {} }, require: name => name === 'node:crypto'
    ? { randomInt: (...args) => { calls.push(args); return 60; } } : {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../wisStockOrderLifecycle.js'), 'utf8'), sandbox);
  assert.equal(sandbox.module.exports.createWisStockOrderDelaySeconds(), 60); assert.deepEqual(calls, [[5, 61]]);
});
