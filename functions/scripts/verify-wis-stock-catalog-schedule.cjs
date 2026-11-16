const assert = require('node:assert/strict');
const { test } = require('node:test');
const catalog = require('../wisStockCatalog.json');
const { normalizeCatalogPlan, catalogScheduleState, applyDueCatalogListings } = require('../wisStockCatalogSchedule');
const { normalizeWisStockMarketRules } = require('../wisStockMarketRules');
const { normalizeSettings, reservedMarketBytes, MAX_MARKET_BYTES } = require('../wisStocks');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const start = Date.parse('2026-11-16T09:00:00+09:00');
const plan = () => ({ version: 1, startsAtMs: start });
const market = overrides => ({ schemaVersion: 1, semesterId: '2026-2', revision: 1,
  studentOpen: true, rules: normalizeWisStockMarketRules(), stocks: [], updatedAtMs: start - HOUR,
  catalogPlan: plan(), ...overrides });
const dueAt = entry => {
  const day = Math.floor((entry.listingSession - 1) / 7);
  return start + (Math.floor(day / 5) * 7 + day % 5) * DAY + ((entry.listingSession - 1) % 7) * HOUR;
};

test('the canonical catalog keeps 80 distinct valid IDs and six weekday listing weeks', () => {
  assert.equal(catalog.length, 80);
  assert.equal(new Set(catalog.map(entry => entry.id)).size, 80);
  assert.equal(new Set(catalog.map(entry => entry.name)).size, 80);
  for (const entry of catalog) {
    assert.match(entry.id, /^stock_[a-f0-9]{24}$/);
    assert(Number.isInteger(entry.listingSession) && entry.listingSession >= 1 && entry.listingSession <= 210);
    const date = new Date(dueAt(entry) + 9 * HOUR);
    assert(date.getUTCDay() >= 1 && date.getUTCDay() <= 5);
    assert(date.getUTCHours() >= 9 && date.getUTCHours() <= 15);
    if (entry.week) assert.equal(Math.floor((entry.listingSession - 1) / 35) + 1, entry.week);
  }
});

test('only explicit valid Monday 09:00 KST plans activate listings', () => {
  assert.equal(normalizeCatalogPlan(undefined), null);
  assert.equal(normalizeCatalogPlan(null), null);
  assert.deepEqual(normalizeCatalogPlan(plan()), plan());
  assert.notEqual(normalizeCatalogPlan(plan()), plan());
  for (const input of [{}, [], false, { ...plan(), version: 2 }, { ...plan(), extra: true },
    { ...plan(), startsAtMs: String(start) }, { ...plan(), startsAtMs: start + 1 },
    { ...plan(), startsAtMs: start + HOUR }, { ...plan(), startsAtMs: start + DAY },
    { ...plan(), startsAtMs: -1 }, { ...plan(), startsAtMs: NaN },
    { ...plan(), startsAtMs: Number.MAX_SAFE_INTEGER }]) {
    assert.throws(() => normalizeCatalogPlan(input), error => error.reason === 'WIS_STOCK_CATALOG_PLAN_INVALID');
  }
  for (const catalogPlan of [null, undefined]) {
    const current = market({ catalogPlan });
    const result = applyDueCatalogListings(current, start + 42 * DAY);
    assert.equal(result.market, current);
    assert.deepEqual(result.addedIds, []);
    assert.equal(catalogScheduleState(current, start).nextListingAtMs, null);
  }
});

test('the first opening adds only due stocks with one actual observation and no future prices', () => {
  const current = market();
  const original = structuredClone(current);
  assert.equal(applyDueCatalogListings(current, start - 1).market, current);
  assert.equal(catalogScheduleState(current, start - 1).nextListingAtMs, start);
  const result = applyDueCatalogListings(current, start);
  const expected = catalog.filter(entry => entry.listingSession === 1);
  assert.equal(expected.length, 11);
  assert.deepEqual(result.addedIds, expected.map(entry => entry.id));
  assert.deepEqual(current, original, 'The original market must not be mutated');
  assert.equal(result.market.revision, current.revision, 'Revision belongs to the calling transaction');
  assert.equal(result.market.updatedAtMs, current.updatedAtMs);
  for (const stock of result.market.stocks) {
    assert.deepEqual(normalizeSettings(stock.settings), stock.settings);
    assert.equal(stock.settings.automatic, true);
    assert.equal(stock.settings.tradingStatus, 'ACTIVE');
    assert.deepEqual(stock.history, [{ atMs: start, price: stock.settings.initialPrice }]);
    assert.deepEqual(stock.priceModel, { version: 1, anchorAtMs: start, anchorPrice: stock.settings.initialPrice });
    assert.equal(stock.nextTickAtMs, start + HOUR);
    assert.equal(stock.updatedAtMs, start);
    assert.equal(stock.dayKey, '2026-11-16');
    assert.equal(stock.haltedUntilMs, 0);
  }
  const state = catalogScheduleState(result.market, start);
  assert.deepEqual(state, { plan: plan(), totalCount: 80, listedCount: 11,
    pendingCount: 69, dueCount: 0, nextListingAtMs: start + HOUR });
  const next = applyDueCatalogListings(result.market, start + HOUR);
  assert.deepEqual(next.addedIds, catalog.filter(entry => entry.listingSession === 2).map(entry => entry.id));
});

test('retries, renamed matching IDs and manually registered matching names cannot duplicate or overwrite stocks', () => {
  const initial = applyDueCatalogListings(market(), start).market;
  const sameId = { ...initial.stocks[0], settings: { ...initial.stocks[0].settings, name: '교사가 바꾼 이름', automatic: false } };
  const sameName = { ...initial.stocks[1], id: 'stock_ffffffffffffffffffffffff',
    price: 321, history: [{ atMs: start - 1000, price: 321 }],
    settings: { ...initial.stocks[1].settings, issuedShares: 200_000 } };
  const custom = { ...initial.stocks[2], id: 'stock_eeeeeeeeeeeeeeeeeeeeeeee',
    settings: { ...initial.stocks[2].settings, name: '교사의 독립 종목' } };
  const current = market({ stocks: [sameId, sameName, custom] });
  const result = applyDueCatalogListings(current, start);
  assert.equal(result.addedIds.length, 9);
  assert.equal(result.market.stocks[0], sameId);
  assert.equal(result.market.stocks[1], sameName);
  assert.equal(result.market.stocks[2], custom);
  assert.equal(result.market.stocks.filter(stock => stock.settings.name === sameName.settings.name).length, 1);
  assert.equal(catalogScheduleState(result.market, start).listedCount, 11);
  for (let retry = 0; retry < 8; retry++) {
    const repeat = applyDueCatalogListings(result.market, start);
    assert.equal(repeat.market, result.market);
    assert.deepEqual(repeat.addedIds, []);
  }
});

test('closed, unpublished and halted markets defer listings and catch up at the actual reopened time', () => {
  for (const current of [market({ studentOpen: false }), market({ rules: normalizeWisStockMarketRules({ halted: true }) })]) {
    assert.equal(applyDueCatalogListings(current, start).market, current);
    assert.equal(catalogScheduleState(current, start).nextListingAtMs, null);
  }
  const close = start + 7 * HOUR;
  assert.equal(applyDueCatalogListings(market(), close).addedIds.length, 0);
  assert.equal(catalogScheduleState(market(), close).nextListingAtMs, start + DAY);
  const saturday = start + 5 * DAY;
  assert.equal(applyDueCatalogListings(market(), saturday).addedIds.length, 0);
  assert.equal(catalogScheduleState(market(), saturday).nextListingAtMs, start + 7 * DAY);
  const reopen = start + 7 * DAY + HOUR + 12_345;
  const result = applyDueCatalogListings(market(), reopen);
  assert.deepEqual(result.addedIds, catalog.filter(entry => dueAt(entry) <= reopen).map(entry => entry.id));
  for (const stock of result.market.stocks) {
    assert.deepEqual(stock.history, [{ atMs: reopen, price: stock.settings.initialPrice }]);
    assert.equal(stock.priceModel.anchorAtMs, reopen);
    assert.equal(stock.nextTickAtMs, start + 7 * DAY + 2 * HOUR);
  }
});

test('listing uses current trading days and minute boundaries, independently of automatic price updates', () => {
  const rules = normalizeWisStockMarketRules({ tradingDays: [2, 4], openMinuteKst: 615,
    closeMinuteKst: 645, automaticPrices: false });
  const current = market({ rules });
  const open = start + DAY + 75 * 60_000;
  assert.equal(applyDueCatalogListings(current, start).market, current);
  assert.equal(catalogScheduleState(current, start).nextListingAtMs, open);
  assert.equal(applyDueCatalogListings(current, open - 1).addedIds.length, 0);
  const active = applyDueCatalogListings(current, open);
  assert(active.addedIds.length > 0);
  assert.equal(applyDueCatalogListings(current, open + 30 * 60_000).addedIds.length, 0);
  assert.equal(catalogScheduleState(current, open + 30 * 60_000).nextListingAtMs, open + 2 * DAY);
});

test('all 80 listings fit the existing history reservation and retain past plan exits as active stocks', () => {
  const atMs = start + 42 * DAY;
  const result = applyDueCatalogListings(market(), atMs);
  assert.equal(result.addedIds.length, 80);
  assert.equal(catalogScheduleState(result.market, atMs).nextListingAtMs, null);
  assert.equal(catalogScheduleState(result.market, atMs).pendingCount, 0);
  assert(reservedMarketBytes(result.market, { year: '2026', semester: '2' }) < MAX_MARKET_BYTES);
  for (const stock of result.market.stocks) {
    assert.equal(stock.settings.tradingStatus, 'ACTIVE', 'Exits and mergers are planning-only in this patch');
    assert.equal(stock.history.length, 1);
    assert.equal(stock.history[0].atMs, atMs);
  }
});
