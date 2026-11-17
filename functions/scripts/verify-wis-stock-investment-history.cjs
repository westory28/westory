const assert = require('node:assert/strict');
const path = require('node:path');
const { buildWisStockInvestmentHistorySeries: build } = require(process.env.WIS_STOCK_HISTORY_SOURCE_DIR
  ? path.join(process.env.WIS_STOCK_HISTORY_SOURCE_DIR, 'wisStockInvestmentHistorySeries.mjs') : '../wisStockInvestmentHistorySeries.mjs');
const id = 'stock_' + 'a'.repeat(24), other = 'stock_' + 'b'.repeat(24);
const stock = { id, price: 150, history: [{ atMs: 100, price: 100 }, { atMs: 200, price: 120 }, { atMs: 300, price: 150 }] };
const buy = { sequence: 2, atMs: 150, stockId: id, side: 'BUY', quantity: 10, unitPrice: 100, fee: 10, stockCashDelta: -1010, realizedPnl: 0 };
const sell = { sequence: 4, atMs: 250, stockId: id, side: 'SELL', quantity: 4, unitPrice: 120, fee: 5, stockCashDelta: 475, realizedPnl: 71 };
const account = (quantity, costBasis, revision = 4) => ({ revision, positions: { [id]: { quantity, costBasis } } });
const input = { account: account(6, 606), fills: [buy, sell], stocks: [stock], asOfMs: 400 };
const tests = [];
function test(name, fn) { fn(); tests.push(name); console.log(`PASS ${name}`); }
const invalid = value => assert.throws(() => build(value), error => error.reason === 'WIS_STOCK_INVESTMENT_HISTORY_INVALID');
test('Actual filled quantity and fee-inclusive cost produce chronological holding returns', () => {
  assert.deepEqual(build(input), { incompleteBeforeMs: null, points: [
    { atMs: 150, holdingValue: 1000, holdingCostBasis: 1010 },
    { atMs: 200, holdingValue: 1200, holdingCostBasis: 1010 },
    { atMs: 250, holdingValue: 720, holdingCostBasis: 606 },
    { atMs: 300, holdingValue: 900, holdingCostBasis: 606 },
    { atMs: 400, holdingValue: 900, holdingCostBasis: 606 },
  ] });
});
test('No position is extrapolated backwards before its first actual purchase', () => assert.equal(build(input).points[0].atMs, buy.atMs));
test('Same timestamp fills apply by source sequence independent of query order', () => {
  const result = build({ ...input, fills: [{ ...sell, atMs: 150 }, buy] });
  assert.deepEqual(result.points[0], { atMs: 150, holdingValue: 600, holdingCostBasis: 606 });
});
test('Full liquidation breaks the return line with zero holdings, without a false zero return', () => {
  const finalSell = { ...sell, sequence: 5, atMs: 350, quantity: 6, unitPrice: 150, fee: 9, stockCashDelta: 891, realizedPnl: 285 };
  const result = build({ ...input, account: account(0, 0, 5), fills: [buy, sell, finalSell] });
  assert.deepEqual(result.points.at(-1), { atMs: 400, holdingValue: 0, holdingCostBasis: 0 });
});
test('Truncated price history is null until an actual stored quote becomes available', () => {
  const result = build({ ...input, stocks: [{ ...stock, history: stock.history.slice(1) }] });
  assert.deepEqual(result.points[0], { atMs: 150, holdingValue: null, holdingCostBasis: null });
  assert.equal(result.incompleteBeforeMs, 150);
  assert.deepEqual(result.points[1], { atMs: 200, holdingValue: 1200, holdingCostBasis: 1010 });
});
test('Removed instrument produces a gap, never a fabricated zero price', () => {
  const result = build({ ...input, stocks: [] });
  assert.equal(result.points.at(-1).holdingValue, null); assert.equal(result.incompleteBeforeMs, 400);
});
test('A missing sold instrument does not prevent valid later zero-holding observation', () => {
  const result = build({ ...input, account: account(0, 0), stocks: [], fills: [buy,
    { ...sell, quantity: 10, fee: 12, stockCashDelta: 1188, realizedPnl: 178 }] });
  assert.deepEqual(result.points.at(-1), { atMs: 400, holdingValue: 0, holdingCostBasis: 0 });
});
test('Unrelated instruments do not add points to a student timeline', () => {
  assert.deepEqual(build({ ...input, stocks: [...input.stocks, { id: other, price: 100, history: [{ atMs: 175, price: 100 }] }] }), build(input));
});
test('Unchanged quotation boundaries remain flat until the next actual change', () => {
  const result = build({ ...input, stocks: [{ ...stock, history: [stock.history[0], { atMs: 180, price: 100 }, ...stock.history.slice(1)] }] });
  assert.deepEqual(result.points.find(point => point.atMs === 180), { atMs: 180, holdingValue: 1000, holdingCostBasis: 1010 });
});
test('No-trade account has a truthful current no-holding observation', () => {
  assert.deepEqual(build({ ...input, account: { revision: 1, positions: {} }, fills: [] }).points,
    [{ atMs: 400, holdingValue: 0, holdingCostBasis: 0 }]);
});
test('Current quantity and cost are independently reconciled with all filled trades', () => {
  invalid({ ...input, account: account(7, 606) }); invalid({ ...input, account: account(6, 605) });
  invalid({ ...input, fills: [] });
});
test('Duplicate/misordered source sequence and future observations are rejected', () => {
  invalid({ ...input, fills: [buy, { ...sell, sequence: 2 }] });
  invalid({ ...input, fills: [buy, { ...sell, atMs: 149 }] });
  invalid({ ...input, fills: [buy, { ...sell, atMs: 401 }] });
});
test('Bad cash/cost arithmetic and negative quantities never produce a plausible graph', () => {
  invalid({ ...input, fills: [{ ...buy, stockCashDelta: -1000 }, sell] });
  invalid({ ...input, fills: [buy, { ...sell, realizedPnl: 99999 }] });
  invalid({ ...input, fills: [buy, { ...sell, quantity: 11, stockCashDelta: 1315 }] });
});
test('A current price absent from history appears only at the actual read time', () => {
  const result = build({ ...input, stocks: [{ ...stock, price: 160 }] });
  assert.equal(result.points.find(point => point.atMs === 300).holdingValue, 900);
  assert.deepEqual(result.points.at(-1), { atMs: 400, holdingValue: 960, holdingCostBasis: 606 });
});
test('Conflicting same-time quotations and unsafe arithmetic fail closed', () => {
  invalid({ ...input, stocks: [{ ...stock, history: [...stock.history, { atMs: 200, price: 121 }] }] });
  invalid({ ...input, fills: [{ ...buy, quantity: Number.MAX_SAFE_INTEGER }, sell] });
});
console.log(`PASS ${tests.length} investment history groups; server reads/writes 0`);
