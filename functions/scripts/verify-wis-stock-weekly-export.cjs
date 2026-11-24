const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Timestamp } = require('firebase-admin/firestore');
const { createWisStockWeeklyExport } = require('../wisStockWeeklyExport');
const { normalizeSettings, blankMarket, createWisStockHandlers } = require('../wisStocks');
const { normalizeWisStockMarketRules } = require('../wisStockMarketRules');
const catalog = require('../wisStockCatalog.json');

const scope = { semesterId: '2026-2', year: '2026', semester: '2' };
const root = 'years/2026/semesters/2', DAY = 86400000, HALF = DAY / 2;
const start = Date.parse('2026-12-14T00:00:00+09:00'), weekStart = '2026-12-14';
const ids = ['stock_aaaaaaaaaaaaaaaaaaaaaaaa', 'stock_bbbbbbbbbbbbbbbbbbbbbbbb', catalog[0].id];
function stock(id) {
  return { id, settings: normalizeSettings({ name: '종목 ' + id.slice(-4), period: '합성 시대', description: '', initialPrice: 100,
    minimumPrice: 1, maximumPrice: 10000, volatilityBps: 10, trendBps: 0, intervalHours: 1, automatic: true }),
    price: 80, listedAtMs: start - DAY, updatedAtMs: start + 2 * DAY + HALF, nextTickAtMs: start + 2 * DAY + HALF + 600000,
    history: [{ atMs: start - DAY, price: 100 }, { atMs: start + 10, price: 105 },
      { atMs: start + DAY + HALF, price: 100 }, { atMs: start + 2 * DAY + HALF, price: 80 }] };
}
function fixture({ clock = start + 8 * DAY, batchSize, seed = true } = {}) {
  const markets = { ...blankMarket(scope), schemaVersion: 1, revision: 1, stocks: ids.map(stock),
    ...(seed ? { priceSeed: '1'.repeat(64) } : {}), rules: normalizeWisStockMarketRules(), studentOpen: false, updatedAtMs: clock - 1 };
  const docs = new Map([
    ['users/t', { role: 'teacher' }], ['users/t2', { role: 'teacher' }], ['users/s', { role: 'student' }],
    ['users/staff', { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['point_manage'] }],
    ['site_settings/config', { year: 2026, semester: 2 }], ['site_settings/semester_active', { semesterId: scope.semesterId, revision: 9 }],
    ['semester_manifests/2026-2', { semesterId: scope.semesterId, revision: 9, status: 'ACTIVE' }], [root + '/wis_stock_markets/current', markets],
  ]);
  const fills = [], queries = [], writes = [], times = [], accesses = [];
  const snap = (id, value, when = Timestamp.fromMillis(clock)) => ({ id, exists: !!value, data: () => structuredClone(value), readTime: when });
  const getDoc = (path, when) => { accesses.push(path); return snap(path.split('/').at(-1), docs.get(path), when); };
  const create = (path, data) => { if (docs.has(path)) throw Object.assign(new Error('already exists'), { code: 6 }); docs.set(path, structuredClone(data)); writes.push(path); };
  class Query {
    constructor(filter = [], fields = [], after = null, limit = NaN) { Object.assign(this, { filter, fields, after, max: limit }); }
    where(...field) { return new Query([...this.filter, field], this.fields, this.after, this.max); }
    orderBy() { return this; }
    select(...fields) { return new Query(this.filter, fields, this.after, this.max); }
    startAfter(...cursor) { return new Query(this.filter, this.fields, cursor, this.max); }
    limit(limit) { return new Query(this.filter, this.fields, this.after, limit); }
  }
  const db = { doc: path => ({ path, create: value => create(path, value), get: () => getDoc(path) }),
    collection(path) { assert.equal(path, root + '/wis_stock_history'); return new Query(); },
    runTransaction: async (fn, opts = {}) => { times.push(opts); return fn({
      async get(ref) {
        if (!(ref instanceof Query)) return getDoc(ref.path, opts.readTime);
        queries.push(ref); assert(ref.max <= 400); assert.deepEqual(ref.filter.map(v => v.slice(0, 2)), [['kind', '=='], ['atMs', '>='], ['atMs', '<']]);
        const rows = fills.filter(r => r.kind === ref.filter[0][2] && r.atMs >= ref.filter[1][2] && r.atMs < ref.filter[2][2]
          && (!ref.after || r.atMs > ref.after[0] || (r.atMs === ref.after[0] && r.id > ref.after[1])))
          .sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id)).slice(0, ref.max);
        return { docs: rows.map(r => snap(r.id, Object.fromEntries(ref.fields.filter(k => Object.hasOwn(r, k)).map(k => [k, r[k]])))), size: rows.length }; },
      async getAll(...refs) { return refs.filter(r => r.path).map(r => getDoc(r.path, opts.readTime)); },
      create(ref, value) { assert.notEqual(opts.readOnly, true); create(ref.path, value); },
    }); } };
  const assertSession = async req => { if (!req.auth) throw new Error('unauthenticated'); return { uid: req.auth.uid }; };
  const services = createWisStockWeeklyExport({ db, assertSession, now: () => clock, batchSize });
  const request = (data, uid = 't') => ({ auth: { uid }, data: { year: '2026', semester: '2', weekStart, ...data } });
  const call = (data, uid = 't') => services.exportWisStockWeeklyReportData(request(data, uid));
  const fill = (account, stockId = ids[0], atMs = start + 60, side = 'BUY', other = {}) =>
    fills.push({ semesterId: scope.semesterId, kind: 'ORDER_FILLED', id: 'fill_' + String(fills.length).padStart(6, '0'),
      accountId: 'account_private_' + account, studentUid: 'DO_NOT_RETURN_ME', stockId, atMs, quantity: 2, unitPrice: 125, side, ...other });
  const all = async data => { let response = await call(data); while (response.continuation) response = await call({ ...data, continuation: response.continuation }); return response; };
  return { call, all, request, services, fill, fills, times, docs, accesses, queries, writes, markets, db, assertSession,
    setClock: n => { clock = n; } };
}

test('one active semester, teacher role and exact Monday are required before matching fills', async () => {
  const f = fixture();
  for (const uid of ['s', 'staff', 'unknown']) await assert.rejects(f.call({}, uid), { code: 'permission-denied' });
  await assert.rejects(f.call({ weekStart: '2026-12-15' }), { code: 'invalid-argument' });
  await assert.rejects(f.call({ stockId: ids[0] }), { code: 'invalid-argument' });
  await assert.rejects(f.call({ semester: '1' }), { code: 'failed-precondition' });
  assert.equal(f.queries.length, 0);
  f.docs.get('semester_manifests/2026-2').revision = 7;
  await assert.rejects(f.call({}), { code: 'failed-precondition' }); assert.equal(f.queries.length, 0);
});

test('lossless sealed continuation covers 4,000+ tied receipts without leaking or accepting tampering and other scopes', async () => {
  const f = fixture();
  for (let i = 0; i < 4003; i++) f.fill(i % 6);
  const res = await f.call({});
  assert.deepEqual(Object.keys(res), ['continuation']); assert.match(res.continuation, /^s\./);
  await assert.rejects(f.call({ continuation: res.continuation }, 't2'), { code: 'invalid-argument' });
  await assert.rejects(f.call({ continuation: res.continuation, weekStart: '2026-12-07' }), { code: 'invalid-argument' });
  await assert.rejects(f.call({ continuation: res.continuation.slice(0, 20) + 'XX' }), { code: 'invalid-argument' });
  f.docs.get('users/t').role = 'student';
  await assert.rejects(f.call({ continuation: res.continuation }), { code: 'permission-denied' }); f.docs.get('users/t').role = 'teacher';
  const final = await f.call({ continuation: res.continuation });
  const first = final.stocks[0].flows.cells[0];
  assert.deepEqual([first.count, first.shares, first.valueWis], [4003, 8006, 1000750]);
  assert.deepEqual(f.writes, []); assert(!JSON.stringify(final).match(/account_private|studentUid|DO_NOT_RETURN_ME|priceSeed|11111111111111111111111111111111/));
  assert(f.queries.every(q => !q.fields.includes('studentUid') && !q.fields.includes('orderId')));
  f.setClock(start + 8 * DAY + 51 * 60_000);
  await assert.rejects(f.call({ continuation: res.continuation }), { code: 'invalid-argument' });
});

test('legacy key writes once and remains valid if a price seed is assigned during an export', async () => {
  const f = fixture({ batchSize: 3, seed: false });
  for (let i = 0; i < 5; i++) f.fill(i);
  const first = await f.call({}); assert.match(first.continuation, /^r\./);
  assert.deepEqual(f.writes, [root + '/wis_stock_report_keys/continuations']);
  f.markets.priceSeed = '8'.repeat(64);
  const final = await f.call({ continuation: first.continuation });
  assert.equal(final.stocks[0].flows.cells[0].count, 5);
  assert(!JSON.stringify(final).includes(f.docs.get(f.writes[0]).key));
});

test('complete KST days release disjoint stock, sector and market cells with five distinct accounts, preserving unreported remainders', async () => {
  const f = fixture({ clock: start + 3 * DAY + HALF });
  for (let i = 0; i < 5; i++) f.fill(i);
  for (let i = 0; i < 3; i++) f.fill(i, ids[1]);
  for (let i = 3; i < 6; i++) f.fill(i, ids[2]);
  for (let i = 0; i < 5; i++) f.fill(i, ids[0], start + 300, 'SELL');
  for (let i = 0; i < 15; i++) f.fill('one', ids[0], start + 300, 'SELL', { automaticSettlement: 'GRADUATION' });
  for (let i = 0; i < 3; i++) f.fill(i, ids[0], start + DAY);
  for (let i = 3; i < 6; i++) f.fill(i, ids[1], start + DAY);
  for (let i = 0; i < 6; i++) f.fill(i, ids[1], start + 3 * DAY);
  f.fill('invalid_accepted', ids[0], start, 'BUY', { kind: 'ORDER_ACCEPTED' });
  f.fill('outside', ids[0], start - 1); f.fill('future', ids[0], start + 7 * DAY);
  const result = await f.call({});
  assert.equal(result.flowEndsAtMsExclusive, start + 3 * DAY);
  assert.deepEqual(result.stocks[0].flows.cells.map(v => [v.side, v.count]), [['BUY', 5], ['SELL', 5]]);
  assert.equal(result.stocks[0].flows.publishedBuyMinusSellShares, 0);
  assert.deepEqual(result.pooledFlows.map(v => [v.level, v.count]), [['MARKET_REMAINDER', 6], ['SECTOR_REMAINDER', 6]]);
  assert.equal(result.stocks[1].flows.cells.length, 0);
  assert.equal(result.stocks[0].specialSessionComparisons[0].differenceWis, 0);
});

test('half-day archive excludes upper boundary quotes, does not infer missing history, suppresses small holder changes and is idempotent', async () => {
  const f = fixture();
  const snap = async end => f.services.archiveWisStockReportPrices({ scheduleTime: new Date(end + 3 * 60000).toISOString() });
  function supply(count) {
    f.docs.set(root + '/wis_stock_supplies/' + ids[0], { semesterId: scope.semesterId, stockId: ids[0],
      holders: Object.fromEntries(Array.from({ length: count }, (_, i) => ['private-holder-' + i, 3])) });
  }
  supply(7); await snap(start); await snap(start + HALF); assert.deepEqual(await snap(start + HALF), { changed: false });
  const a = f.docs.get(root + '/wis_stock_report_intervals/2026-12-14_AM');
  assert.deepEqual([a.prices[ids[0]].open, a.prices[ids[0]].observations], [105, 1]);
  for (const stock of f.markets.stocks) {
    stock.history = Array.from({ length: 120 }, (_, i) => ({ atMs: start + 5 * DAY + i, price: 90 + i % 5 }));
    stock.price = stock.history.at(-1).price; stock.updatedAtMs = stock.history.at(-1).atMs;
  }
  supply(12); await snap(start + 7 * DAY);
  const result = await f.call({});
  assert.equal(result.stocks[0].prices.daily[0].open, 105);
  assert.equal(result.stocks[0].prices.weekly.coverage, 'PARTIAL');
  assert.equal(result.stocks[0].prices.weekly.returnPercent, null);
  assert.deepEqual(result.stocks[0].shareholders, { start: 7, end: 12, netChange: 5 });
  const final = f.docs.get(root + '/wis_stock_report_intervals/2026-12-20_PM');
  final.holderCounts[ids[0]] = 10;
  assert.equal((await f.call({})).stocks[0].shareholders, null);
  assert(!JSON.stringify(final).includes('private-holder')); assert(f.writes.every(p => p.includes('/wis_stock_report_intervals/')));
});

test('next week outlook matches exact management forecast by day with market closed and historical forecasts omitted', async () => {
  const clock = start + 3 * DAY;
  const f = fixture({ clock });
  f.markets.studentOpen = true;
  const report = await f.call({});
  const manager = createWisStockHandlers({ db: f.db, now: () => clock, assertSession: f.assertSession });
  const req = f.request({ forecastStockId: ids[0] }); delete req.data.weekStart;
  const forecast = await manager.getWisStockManagement(req);
  const expected = forecast.history.filter(p => p.atMs >= start + 7 * DAY && p.atMs < start + 14 * DAY);
  assert(expected.length > 0); const actual = report.stocks[0].outlook;
  assert.equal(actual.reduce((n, day) => n + day.slots, 0), expected.length);
  assert.equal(actual.at(-1).close, expected.at(-1).price);
  assert.deepEqual(report.outlook.events.map(v => v.dayKey), ['2026-12-23', '2026-12-24']);
  f.markets.studentOpen = false; f.markets.revision++; assert.equal((await f.call({})).stocks[0].outlook.length, 0);
  f.markets.studentOpen = true; f.markets.revision++; f.setClock(start + 16 * DAY);
  const old = await f.call({}); assert.equal(old.stocks[0].outlook.length, 0);
  assert.equal(old.stocks[0].specialSessionComparisons[0].targetClose, 80);
});

test('new midweek listings, legacy issuance, dated index observations and missing prelisting prices carry distinct evidence', async () => {
  const f = fixture();
  const fresh = f.markets.stocks[0], listed = start + 3 * DAY + 60000;
  fresh.listedAtMs = listed; fresh.updatedAtMs = listed + 60000; fresh.price = 110;
  fresh.history = [{ atMs: listed, price: 100 }, { atMs: listed + 60000, price: 110 }];
  delete fresh.settings.issuedShares;
  f.markets.marketIndex = { version: 1, baseValue: 1000, baseAtMs: start - DAY, value: 1010, previousClose: 1001,
    dayKey: '2026-12-17', updatedAtMs: listed, history: [{ atMs: start - DAY, value: 1000 }, { atMs: listed, value: 1010 }] };
  const result = await f.call({});
  assert.equal(result.stocks[0].prices.daily[0].coverage, 'BEFORE_LISTING');
  assert.equal(result.stocks[0].prices.daily[3].coverage, 'COMPLETE');
  assert.equal(result.stocks[0].prices.weekly.open, 100); assert.equal(result.stocks[0].prices.weekly.returnPercent, null);
  assert.equal(result.stocks[0].listedAtMs, listed); assert(result.stocks[0].issuedSharesAsOfExport > 0);
  assert.equal(result.marketIndex.weekly.closeAtEnd, 1010);
  assert(Math.abs(result.marketIndex.weekly.returnPercent - 1) < 1e-8);
  delete f.markets.marketIndex;
  assert.equal((await f.call({})).marketIndex.weekly.coverage, 'UNAVAILABLE');
});
