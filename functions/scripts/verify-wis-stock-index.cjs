const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BASE_VALUE, INDEX_HISTORY_LIMIT, reconstructWisStockIndex, updateWisStockIndex,
  wisStockIndexState, validWisStockIndex } = require('../wisStockIndex');
const HOUR = 3_600_000;
const start = Date.parse('2026-11-16T00:00:00Z');
const stock = (id, prices, shares = 100, times = prices.map((_, i) => start + i * HOUR)) => ({
  id, settings: { issuedShares: shares }, price: prices.at(-1), updatedAtMs: times.at(-1),
  history: prices.map((price, i) => ({ atMs: times[i], price })),
});
const near = (actual, expected) => assert(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-12), `${actual} != ${expected}`);

test('an empty market has a stable 1000 baseline and no invented observation', () => {
  assert.deepEqual(wisStockIndexState({ stocks: [] }, start), { baseValue: BASE_VALUE,
    baseAtMs: 0, value: BASE_VALUE, previousClose: BASE_VALUE, updatedAtMs: 0, history: [] });
});

test('legacy index reconstructs actual timestamps with capitalization weights and simultaneous prints', () => {
  const market = { stocks: [stock('a', [100, 120], 100), stock('b', [100, 110], 300)] };
  const before = JSON.stringify(market), index = reconstructWisStockIndex(market, start + HOUR);
  near(index.value, 1125);
  assert.deepEqual(index.history, [{ atMs: start, value: 1000 }, { atMs: start + HOUR, value: 1125 }]);
  assert(validWisStockIndex(index));
  assert.equal(JSON.stringify(market), before);
});

test('historical and live new listings are neutral, including listing plus a price tick in one transaction', () => {
  const existing = stock('a', [100, 120], 100);
  const newcomer = stock('b', [1_000_000], 1_000_000_000, [start + HOUR]);
  const historical = reconstructWisStockIndex({ stocks: [existing, newcomer] }, start + HOUR);
  near(historical.value, 1200);
  const first = { stocks: [stock('a', [100], 100)] };
  const live = updateWisStockIndex(first, { stocks: [existing, newcomer] }, start + HOUR);
  near(live.marketIndex.value, historical.value);
  const onlyListing = updateWisStockIndex(live, { ...live,
    stocks: [...live.stocks, stock('c', [999999], 1_000_000_000, [start + 2 * HOUR])] }, start + 2 * HOUR);
  near(onlyListing.marketIndex.value, live.marketIndex.value);
});

test('issuance changes are neutral and new issuance controls subsequent price weights', () => {
  const old = { stocks: [stock('a', [100], 100), stock('b', [100], 100)] };
  const reweighted = updateWisStockIndex(old, { stocks: [stock('a', [100], 900), stock('b', [100], 100)] }, start + HOUR);
  assert.equal(reweighted.marketIndex.value, 1000);
  const next = updateWisStockIndex(reweighted, { ...reweighted,
    stocks: [stock('a', [100, 200], 900, [start, start + 2 * HOUR]), stock('b', [100], 100)] }, start + 2 * HOUR);
  near(next.marketIndex.value, 1900);
});

test('persisted accumulation and original base survive truncating every stock history', () => {
  let market = updateWisStockIndex({ stocks: [] }, { stocks: [stock('a', [100])] }, start);
  for (let i = 1; i <= 200; i++) {
    const next = stock('a', [100 + i], 100, [start + i * HOUR]);
    market = updateWisStockIndex(market, { ...market, stocks: [next] }, start + i * HOUR);
  }
  near(market.marketIndex.value, 3000);
  assert.equal(market.marketIndex.history.length, INDEX_HISTORY_LIMIT);
  assert.equal(market.marketIndex.baseAtMs, start);
  assert(validWisStockIndex(market.marketIndex));
  near(wisStockIndexState(market, start + 201 * HOUR).value, 3000);
});

test('low-priced instruments and aggregate capitalization beyond safe Number integers remain finite', () => {
  const old = { stocks: Array.from({ length: 100 }, (_, i) => stock(String(i), [999999], 1_000_000_000)) };
  const next = { stocks: old.stocks.map((entry, i) => ({ ...entry, price: i ? 999999 : 1_000_000 })) };
  const index = updateWisStockIndex(old, next, start + HOUR).marketIndex;
  near(index.value, 1000 * (99_999_901 / 99_999_900));
  const low = updateWisStockIndex({ stocks: [stock('low', [1])] }, { stocks: [stock('low', [2])] }, start + HOUR);
  near(low.marketIndex.value, 2000);
});

test('KST previous close rolls over without adding a synthetic history point or mutating stored state', () => {
  const dayOne = updateWisStockIndex({ stocks: [stock('a', [100])] }, { stocks: [stock('a', [100, 120])] }, start + HOUR);
  const before = JSON.stringify(dayOne);
  const nextMorning = wisStockIndexState(dayOne, start + 24 * HOUR);
  near(nextMorning.previousClose, 1200);
  assert.equal(nextMorning.history.length, 2);
  assert.equal(JSON.stringify(dayOne), before);
  const dayTwo = updateWisStockIndex(dayOne, { ...dayOne,
    stocks: [stock('a', [100, 120, 132], 100, [start, start + HOUR, start + 24 * HOUR])] }, start + 24 * HOUR);
  near(dayTwo.marketIndex.value, 1320);
  near(dayTwo.marketIndex.previousClose, 1200);
});

test('future points are excluded and a stored current quote is only used at its actual observation time', () => {
  const market = { stocks: [stock('a', [100, 999], 100, [start, start + HOUR])] };
  const index = reconstructWisStockIndex(market, start);
  assert.deepEqual(index.history, [{ atMs: start, value: 1000 }]);
});

test('same-time observations coalesce, and deterministic retries do not apply returns twice', () => {
  const old = { stocks: [stock('a', [100])] }, next = { stocks: [stock('a', [100, 120])] };
  const one = updateWisStockIndex(old, next, start + HOUR);
  assert.deepEqual(one, updateWisStockIndex(old, next, start + HOUR));
  assert.deepEqual(one, updateWisStockIndex(one, one, start + HOUR));
  const revised = updateWisStockIndex(one, { ...one, stocks: [stock('a', [100, 130])] }, start + HOUR);
  near(revised.marketIndex.value, 1300);
  assert.equal(revised.marketIndex.history.length, 2);
  assert(validWisStockIndex(revised.marketIndex));
});

test('corrupt stored index data is rejected instead of silently resetting the accumulated index', () => {
  const valid = reconstructWisStockIndex({ stocks: [stock('a', [100, 120])] }, start + HOUR);
  for (const patch of [{ value: NaN }, { previousClose: 0 }, { baseValue: 0 }, { history: [] },
    { updatedAtMs: start }, { dayKey: '2026-11-17' }, { history: [...valid.history].reverse() }]) {
    assert.equal(validWisStockIndex({ ...valid, ...patch }), false);
    assert.throws(() => wisStockIndexState({ stocks: [], marketIndex: { ...valid, ...patch } }, start + HOUR));
  }
});
