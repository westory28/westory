const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeWisStockMarketRules: rules, normalizeWisStockTradingSettings: trading,
  quoteWisStockOrder: quote, wisStockKstSession, isWisStockTradingSession, wisStockDailyBounds } = require('../wisStockMarketRules');
const at = Date.parse('2026-11-16T01:00:00Z'); // Monday, 10:00 KST.
const id = `stock_${'a'.repeat(24)}`;
const input = () => ({ rules: rules(), side: 'BUY', quantity: 10, nowMs: at, marketRevision: 3,
  stock: { id, price: 100, settings: trading(), haltedUntilMs: 0, availableShares: 100000 },
  quote: { stockId: id, price: 100, atMs: at, marketRevision: 3 },
  portfolio: { cashBalance: 10000, holdingQuantity: 0, holdingPrincipal: 0, holdingCostBasis: 0,
    portfolioValue: 10000, dayKey: '2026-11-16', dailyBuyAmount: 0, dailyOrderCount: 0,
    lastOrderAtMs: 0, cumulativeRealizedPnl: 0, profitHighWatermark: 0 } });
const reason = expected => error => error.reason === expected;
const reject = (change, expected) => { const value = input(); change(value); assert.throws(() => quote(value), reason(expected)); };
const sale = (price = 150, quantity = 5) => {
  const value = input(); value.side = 'SELL'; value.quantity = quantity;
  value.stock.price = value.quote.price = price; value.stock.availableShares -= 10;
  Object.assign(value.portfolio, { holdingQuantity: 10, holdingPrincipal: 1000, holdingCostBasis: 1010,
    portfolioValue: 10000 + 10 * price }); return value;
};

test('safe defaults normalize legacy fields without mutation and reject impossible rule combinations', () => {
  assert.equal(rules().minimumCashReserve, 500); assert.equal(rules().maxConcentrationBps, 5000);
  assert.deepEqual(trading(), { issuedShares: 100000, lotSize: 1, tradingStatus: 'ACTIVE' });
  const original = { tradingDays: [5, 1] }; assert.deepEqual(rules(original).tradingDays, [1, 5]);
  assert.deepEqual(original.tradingDays, [5, 1]);
  for (const value of [{ tradingDays: [] }, { tradingDays: [1, 1] }, { openMinuteKst: 960, closeMinuteKst: 540 },
    { circuitBreakerBps: 1100 }, { maxOrderQuantity: 1001 }, { buyFeeBps: -1 }, { dailyBuyLimit: 9999 },
    { studentOpen: true }, { quoteTtlSeconds: 0 }, { automaticPrices: 1 }]) assert.throws(() => rules(value));
  assert.throws(() => trading({ issuedShares: 7, lotSize: 2 }));
});

test('KST weekdays and half-open session boundaries are independent of the host timezone', () => {
  assert.deepEqual(wisStockKstSession(Date.parse('2026-11-15T15:00:00Z')), { dayKey: '2026-11-16', dayOfWeek: 1, minute: 0 });
  for (const [stamp, open] of [['2026-11-16T00:00:00Z', true], ['2026-11-16T06:59:59Z', true],
    ['2026-11-16T07:00:00Z', false], ['2026-11-15T23:59:59Z', false], ['2026-11-21T01:00:00Z', false]])
    assert.equal(isWisStockTradingSession(rules(), Date.parse(stamp)), open);
  assert.deepEqual(wisStockDailyBounds(101, 1000), { minimum: 91, maximum: 111 });
});

test('a buy separately reports gross, ceil fee, cash debit and cost basis with zero earned/rank effects', () => {
  const value = input(), before = structuredClone(value), result = quote(value);
  assert.equal(result.gross, 1000); assert.equal(result.fee, 10); assert.equal(result.cashDebit, 1010);
  assert.equal(result.nextCashBalance, 8990); assert.equal(result.nextHoldingPrincipal, 1000);
  assert.equal(result.nextHoldingCostBasis, 1010); assert.equal(result.earnedDelta, 0); assert.equal(result.rankEarnedDelta, 0);
  assert.equal(result.nextAvailableShares, 99990); assert.equal(result.executable, false); assert.equal(result.studentOpen, false);
  assert.deepEqual(value, before);
  value.quantity = 1; value.stock.price = value.quote.price = 1;
  assert.equal(quote(value).fee, 1, 'A non-zero fractional Wis fee rounds up, never silently disappears');
});

test('a sell distinguishes recovered principal, capitalized buy fee, sell fee and realized profit', () => {
  const result = quote(sale());
  assert.equal(result.gross, 750); assert.equal(result.fee, 8); assert.equal(result.cashCredit, 742);
  assert.equal(result.principalRemoved, 500); assert.equal(result.buyFeesRemoved, 5);
  assert.equal(result.costBasisRemoved, 505); assert.equal(result.principalRecovered, 500);
  assert.equal(result.realizedPnl, 237); assert.equal(result.earnedDelta, 0); assert.equal(result.rankEarnedDelta, 0);
  assert.equal(result.nextHoldingPrincipal, 500); assert.equal(result.nextHoldingCostBasis, 505);
});

test('internal profit high-watermark tracks recovery without changing general cumulative Wis', () => {
  let cumulative = 0, high = 0, earnings = 0;
  for (const [price, expectedPnl, expectedEarned] of [[200, 100, 0], [20, -80, 0], [180, 80, 0]]) {
    const value = sale(price, 1); value.rules.sellFeeBps = 0;
    Object.assign(value.portfolio, { holdingQuantity: 1, holdingPrincipal: 100, holdingCostBasis: 100,
      cumulativeRealizedPnl: cumulative, profitHighWatermark: high });
    value.stock.availableShares = 99999;
    const result = quote(value); assert.equal(result.realizedPnl, expectedPnl); assert.equal(result.earnedDelta, expectedEarned);
    cumulative = result.cumulativeRealizedPnl; high = result.profitHighWatermark; earnings += result.earnedDelta;
  }
  assert.equal(cumulative, 100); assert.equal(high, 100); assert.equal(earnings, 0);
});

test('fractional average cost remainders survive partial sells and are fully removed on the final share', () => {
  let remaining = 3, principal = 990, basis = 1001, cash = 10000, cumulative = 0, high = 0;
  let removed = 0, recovered = 0, pnl = 0;
  for (let index = 0; index < 3; index++) {
    const value = sale(400, 1);
    Object.assign(value.portfolio, { cashBalance: cash, holdingQuantity: remaining, holdingPrincipal: principal,
      holdingCostBasis: basis, portfolioValue: cash + remaining * 400, cumulativeRealizedPnl: cumulative, profitHighWatermark: high });
    value.stock.availableShares = 100000 - remaining;
    const result = quote(value);
    removed += result.costBasisRemoved; recovered += result.principalRemoved; pnl += result.realizedPnl;
    remaining = result.nextHoldingQuantity; principal = result.nextHoldingPrincipal; basis = result.nextHoldingCostBasis;
    cash = result.nextCashBalance; cumulative = result.cumulativeRealizedPnl; high = result.profitHighWatermark;
  }
  assert.equal(removed, 1001); assert.equal(recovered, 990); assert.equal(principal, 0); assert.equal(basis, 0);
  assert.equal(remaining, 0); assert.equal(pnl, 187);
});

test('halted, expired, changed and stale quotes fail closed before returning a posting plan', () => {
  reject(v => { v.rules.halted = true; }, 'WIS_STOCK_MARKET_HALTED');
  reject(v => { v.stock.settings.tradingStatus = 'HALTED'; }, 'WIS_STOCK_INSTRUMENT_HALTED');
  reject(v => { v.stock.haltedUntilMs = at + 1; }, 'WIS_STOCK_INSTRUMENT_HALTED');
  reject(v => { v.stock.settings.tradingStatus = 'SELL_ONLY'; }, 'WIS_STOCK_SELL_ONLY');
  reject(v => { v.quote.atMs -= 30001; }, 'WIS_STOCK_QUOTE_EXPIRED');
  reject(v => { v.quote.marketRevision--; }, 'WIS_STOCK_QUOTE_CHANGED');
  reject(v => { v.quote.price = 98; }, 'WIS_STOCK_SLIPPAGE');
  const value = input(); value.quote.atMs -= 30000; assert.equal(quote(value).cashDebit, 1010);
});

test('quantity, per-order, reserve, holdings, concentration, daily caps and cooldown apply independently', () => {
  reject(v => { v.quantity = 0; }, 'WIS_STOCK_TRADE_INPUT_INVALID');
  reject(v => { v.quantity = 1.5; }, 'WIS_STOCK_TRADE_INPUT_INVALID');
  reject(v => { v.stock.settings.lotSize = 3; v.stock.settings.issuedShares = 99999; v.stock.availableShares = 99999; }, 'WIS_STOCK_ORDER_LIMIT');
  reject(v => { v.quantity = 101; }, 'WIS_STOCK_ORDER_LIMIT');
  reject(v => { v.portfolio.cashBalance = 1509; }, 'WIS_STOCK_INSUFFICIENT_CASH');
  reject(v => { v.rules.maxHoldingQuantity = 100; v.stock.availableShares -= 95; Object.assign(v.portfolio, {
    holdingQuantity: 95, holdingPrincipal: 9500, holdingCostBasis: 9500, portfolioValue: 19500 }); }, 'WIS_STOCK_HOLDING_LIMIT');
  reject(v => { v.quantity = 60; }, 'WIS_STOCK_CONCENTRATION_LIMIT');
  reject(v => { v.portfolio.dailyBuyAmount = 19500; }, 'WIS_STOCK_DAILY_LIMIT');
  reject(v => { v.portfolio.dailyOrderCount = 20; }, 'WIS_STOCK_DAILY_LIMIT');
  reject(v => { v.portfolio.lastOrderAtMs = at - 9999; }, 'WIS_STOCK_COOLDOWN');
  const value = input(); value.portfolio.dayKey = '2026-11-15'; value.portfolio.dailyBuyAmount = 20000; value.portfolio.dailyOrderCount = 20;
  assert.equal(quote(value).nextDailyBuyAmount, 1010); assert.equal(quote(value).nextDailyOrderCount, 1);
});

test('short selling, impossible supply, missing snapshots and invalid or future accounting dates are rejected', () => {
  reject(v => { v.side = 'SELL'; }, 'WIS_STOCK_INSUFFICIENT_HOLDING');
  reject(v => { v.stock.availableShares = 9; }, 'WIS_STOCK_ISSUED_LIMIT');
  reject(v => { v.portfolio.holdingQuantity = 1; }, 'WIS_STOCK_TRADE_INPUT_INVALID');
  reject(v => { v.portfolio.dayKey = '2026-02-30'; }, 'WIS_STOCK_TRADE_INPUT_INVALID');
  reject(v => { v.portfolio.dayKey = '2026-11-17'; }, 'WIS_STOCK_TRADE_INPUT_INVALID');
  reject(v => { delete v.marketRevision; }, 'WIS_STOCK_TRADE_INPUT_INVALID');
  reject(v => { delete v.stock.settings; }, 'WIS_STOCK_TRADE_INPUT_INVALID');
  reject(v => { v.rules = {}; }, 'WIS_STOCK_TRADE_INPUT_INVALID');
  reject(v => { v.quote.atMs++; }, 'WIS_STOCK_TRADE_INPUT_INVALID');
});

test('BigInt protects intermediate products and rejects unsafe final balances or realized totals', () => {
  const value = sale(1, 100); value.stock.availableShares = 99900;
  Object.assign(value.portfolio, { holdingQuantity: 100, holdingPrincipal: Number.MAX_SAFE_INTEGER,
    holdingCostBasis: Number.MAX_SAFE_INTEGER, portfolioValue: 10100 });
  assert.equal(quote(value).costBasisRemoved, Number.MAX_SAFE_INTEGER);
  const overflow = sale(200, 1); overflow.rules.sellFeeBps = 0;
  Object.assign(overflow.portfolio, { holdingQuantity: 1, holdingPrincipal: 100, holdingCostBasis: 100,
    cumulativeRealizedPnl: Number.MAX_SAFE_INTEGER, profitHighWatermark: Number.MAX_SAFE_INTEGER });
  overflow.stock.availableShares = 99999;
  assert.throws(() => quote(overflow), reason('WIS_STOCK_UNSAFE_TOTAL'));
});
