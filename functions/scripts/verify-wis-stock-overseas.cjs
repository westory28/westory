'use strict';

process.env.GCLOUD_PROJECT ||= 'demo-westory-session-overseas';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { createFakeFirestore } = require('./wisStockFakeFirestore.cjs');
const overseasCatalog = require('../wisStockOverseasCatalog.json');
const domesticCatalog = require('../wisStockCatalog.json');
const { catalogHistoryTrendBps, catalogHistoryPhase, HISTORY_TREND } = require('../wisStockCatalogSchedule');
const { catalogSessionAtMs, catalogSessionIndexAt, catalogExitAtMs } = require('../wisStockCatalogTimeline');
const { DOMESTIC, OVERSEAS } = require('../wisStockVenues');
const { createWisStockHandlers, blankMarket, marketPath, advanceMarket } = require('../wisStocks');
const { createWisStockTrading } = require('../wisStockTrading');
const { createWisStockFxRefresh } = require('../wisStockFxRefresh');
const { normalizeWisStockMarketRules } = require('../wisStockMarketRules');
const fx = require('../wisStockFx');

const hash = value => createHash('sha256').update(value).digest('hex');
const scope = { year: '2026', semester: '2', semesterId: '2026-2' };
const root = 'years/2026/semesters/2';
const MONDAY = Date.parse('2026-11-30T07:00:00Z'); // 16:00 KST, the overseas open
const THURSDAY_NOON = Date.parse('2026-11-26T03:00:00Z');
const reason = value => error => (error.details?.reason || error.reason) === value;

test('overseas catalog is a complete four-era history timeline with logos and lifecycle order', () => {
  assert.equal(overseasCatalog.length, 30);
  const ids = new Set(), names = new Set(domesticCatalog.map(entry => entry.name));
  const domesticIds = new Set(domesticCatalog.map(entry => entry.id));
  for (const entry of overseasCatalog) {
    assert.match(entry.id, /^stock_[a-f0-9]{24}$/);
    assert.ok(!ids.has(entry.id) && !domesticIds.has(entry.id), entry.name);
    assert.ok(!names.has(entry.name), `duplicate name ${entry.name}`);
    ids.add(entry.id); names.add(entry.name);
    assert.ok([1, 2, 3, 4].includes(entry.week));
    const first = (entry.week - 1) * 35 + 1;
    assert.ok(entry.listingSession >= first && entry.listingSession <= first + 34, entry.name);
    assert.ok(entry.listingSession < entry.riseSession && entry.riseSession < entry.fallSession, entry.name);
    assert.ok(entry.fallSession <= 140);
    if (entry.exitKind === 'survive') assert.equal(entry.exitSession, null);
    else assert.ok(entry.exitSession > entry.fallSession + 9 && entry.exitSession <= 140, entry.name);
    for (const key of ['riseReason', 'fallReason', 'exitReason']) assert.match(entry[key], /^게임 설정: /);
    assert.ok(entry.fact.length > 30 && entry.tagline.length > 0);
    assert.ok(fs.existsSync(path.join(__dirname, '../../public', entry.logoUrl)), entry.logoUrl);
  }
  // The student logo map is generated from both catalogs and must stay in step.
  const logoMap = fs.readFileSync(path.join(__dirname, '../../src/lib/wisStockLogos.ts'), 'utf8');
  const stems = Object.fromEntries([...logoMap.matchAll(/^\s+(stock_[a-f0-9]{24}): "([a-z0-9-]+)",\r?$/gm)].map(match => [match[1], match[2]]));
  assert.deepEqual(stems, Object.fromEntries([...domesticCatalog, ...overseasCatalog]
    .map(entry => [entry.id, entry.logoUrl.slice('/wispi/catalog/'.length, -'.svg'.length)])));
  const delisted = overseasCatalog.filter(entry => entry.exitKind === 'delist').map(entry => entry.name);
  assert.ok(delisted.includes('암스테르담동인도홀딩스') && delisted.includes('파나마캐널컴퍼니'));
});

test('session inverse and history phases match the reviewed preview boundaries', () => {
  for (const session of [1, 7, 8, 35, 36, 140])
    assert.equal(catalogSessionIndexAt(catalogSessionAtMs(session, MONDAY) + 30 * 60_000, MONDAY), session);
  assert.equal(catalogSessionIndexAt(MONDAY - 60 * 60_000, MONDAY), 1); // 15:00 belongs to the first session
  assert.equal(catalogSessionIndexAt(MONDAY + 5 * 86_400_000, MONDAY), null); // Saturday
  const armada = overseasCatalog.find(entry => entry.name === '아르마다디펜스');
  assert.equal(catalogHistoryPhase(armada, 37), 'steady');
  assert.equal(catalogHistoryPhase(armada, 38), 'rise');
  assert.equal(catalogHistoryPhase(armada, 42), 'fall');
  assert.equal(catalogHistoryPhase(armada, 52), 'recovery');
  assert.equal(catalogHistoryPhase(armada, 57), 'exited');
  const plan = { version: 1, startsAtMs: MONDAY };
  const at = session => catalogSessionAtMs(session, MONDAY) + 10 * 60_000;
  assert.ok(catalogHistoryTrendBps(armada, plan, at(41)) > 0);
  assert.ok(catalogHistoryTrendBps(armada, plan, at(44)) < 0);
  assert.equal(catalogHistoryTrendBps(armada, plan, at(53)), HISTORY_TREND.exit);
  const survivor = overseasCatalog.find(entry => entry.exitKind === 'survive');
  assert.equal(catalogHistoryTrendBps(survivor, plan, at(survivor.fallSession + 12)), HISTORY_TREND.survive);
});

test('daily exchange rate math rounds down, keeps one rate per KST day and refuses implausible jumps', () => {
  const first = fx.nextWisStockFxDocument(null, { krwPerUsd: 1345.4, sourceDate: '2026-11-25', source: 'test', fetchedAtMs: THURSDAY_NOON });
  assert.equal(first.rate, 1345); assert.equal(first.dayKey, '2026-11-26');
  assert.equal(fx.parseWisStockFxRate(first, THURSDAY_NOON).current, true);
  assert.equal(fx.parseWisStockFxRate(first, THURSDAY_NOON + 86_400_000).current, false);
  assert.equal(fx.nextWisStockFxDocument(first, { krwPerUsd: 1400, sourceDate: '2026-11-26', source: 'test', fetchedAtMs: THURSDAY_NOON + 60_000 }), null);
  assert.throws(() => fx.nextWisStockFxDocument(first, { krwPerUsd: 1600, sourceDate: '2026-11-26', source: 'test', fetchedAtMs: THURSDAY_NOON + 86_400_000 }), reason('WIS_STOCK_FX_JUMP'));
  const second = fx.nextWisStockFxDocument(first, { krwPerUsd: 1351.6, sourceDate: '2026-11-26', source: 'test', fetchedAtMs: THURSDAY_NOON + 86_400_000 });
  assert.deepEqual(second.history.map(point => point.rate), [1345, 1352]);
  // A reference whose fraction rounds differently before and after the stored
  // two decimals still yields a readable document.
  const edge = fx.nextWisStockFxDocument(null, { krwPerUsd: 1470.4951, sourceDate: '2026-11-25', source: 'test', fetchedAtMs: THURSDAY_NOON });
  assert.equal(edge.krwPerUsd, 1470.5); assert.equal(edge.rate, 1471);
  assert.equal(fx.parseWisStockFxRate(edge, THURSDAY_NOON).rate, 1471);
  // A stored rate older than a week no longer blocks a large move.
  const later = fx.nextWisStockFxDocument(first, { krwPerUsd: 1600, sourceDate: '2026-12-04', source: 'test', fetchedAtMs: THURSDAY_NOON + 8 * 86_400_000 });
  assert.equal(later.rate, 1600);
  assert.deepEqual(fx.quoteWisStockExchange({ direction: 'WIS_TO_YUS', amount: 1345, rate: 1345, available: 2000 }),
    { direction: 'WIS_TO_YUS', debit: 1345, credit: 1000, rate: 1345, debitUnit: 'WIS', creditUnit: 'YUS' });
  assert.equal(fx.quoteWisStockExchange({ direction: 'WIS_TO_YUS', amount: 100, rate: 1345, available: 100 }).credit, 74);
  assert.equal(fx.quoteWisStockExchange({ direction: 'YUS_TO_WIS', amount: 74, rate: 1345, available: 74 }).credit, 99);
  assert.throws(() => fx.quoteWisStockExchange({ direction: 'WIS_TO_YUS', amount: 1, rate: 1345, available: 10 }), reason('WIS_STOCK_FX_TOO_SMALL'));
  assert.throws(() => fx.quoteWisStockExchange({ direction: 'WIS_TO_YUS', amount: 11, rate: 1345, available: 10 }), reason('WIS_STOCK_FX_INSUFFICIENT'));
  assert.throws(() => fx.wisStockFxRateFromKrwPerUsd(12), reason('WIS_STOCK_FX_SOURCE_INVALID'));
});

test('the daily job falls back between providers and skips the network once today is stored', async () => {
  const db = createFakeFirestore();
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.includes('frankfurter')) return { ok: false, status: 503, text: async () => '' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: 'success', base_code: 'USD',
      time_last_update_unix: Math.floor(THURSDAY_NOON / 1000) - 3600, rates: { KRW: 1343.04 } }) };
  };
  const job = createWisStockFxRefresh({ db, now: () => THURSDAY_NOON, fetchImpl });
  assert.deepEqual(await job.refreshWisStockFxRate(), { changed: true, rate: 1343, dayKey: '2026-11-26', source: 'ExchangeRate-API 공개 환율' });
  assert.equal(calls.length, 2);
  assert.deepEqual(await job.refreshWisStockFxRate(), { changed: false });
  assert.equal(calls.length, 2);
  const failing = createWisStockFxRefresh({ db: createFakeFirestore(), now: () => THURSDAY_NOON,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"base":"USD","rates":{"KRW":9}}' }) });
  await assert.rejects(failing.refreshWisStockFxRate(), reason('WIS_STOCK_FX_UNAVAILABLE'));
});

function managementFixture(initialNow = THURSDAY_NOON) {
  let clock = initialNow;
  const domestic = { ...blankMarket(scope), revision: 3, studentOpen: true, publicationRevision: 1,
    rules: normalizeWisStockMarketRules({ openMinuteKst: 480, closeMinuteKst: 1080, minimumCashReserve: 500, dailyPriceLimitBps: 3000, circuitBreakerBps: 3000 }) };
  const db = createFakeFirestore({
    'users/manager': { role: 'teacher', teacherPortalEnabled: true, staffPermissions: ['point_manage'] },
    'site_settings/config': { year: '2026', semester: '2' },
    'site_settings/semester_active': { semesterId: '2026-2', revision: 1 },
    'semester_manifests/2026-2': { semesterId: '2026-2', status: 'ACTIVE', revision: 1 },
    [marketPath(scope)]: domestic,
  });
  const options = { db, assertSession: async () => ({ uid: 'manager' }), now: () => clock, openingPrice: () => 200 };
  const overseas = createWisStockHandlers({ ...options, venue: OVERSEAS });
  const home = createWisStockHandlers(options);
  const req = data => ({ auth: { uid: 'manager', token: { email: 'teacher@example.com' } }, data: { year: '2026', semester: '2', ...data } });
  return { db, overseas, home, req, setNow: value => { clock = value; }, now: () => clock, domestic };
}

test('overseas launch keeps the 16:00-23:00 time difference, lifts the cash floor, enables history exits and keeps domestic untouched', async () => {
  const f = managementFixture();
  await assert.rejects(f.overseas.activateWisStockCatalogPlan(f.req({ requestId: 'overseas-plan-past-00001', expectedRevision: 0,
    startsAtMs: Date.parse('2026-11-16T07:00:00Z') })), reason('WIS_STOCK_CATALOG_EXIT_PAST'));
  const result = await f.overseas.activateWisStockCatalogPlan(f.req({ requestId: 'overseas-plan-00000001', expectedRevision: 0, startsAtMs: MONDAY }));
  assert.equal(result.changed, true); assert.equal(result.venue, 'OVERSEAS'); assert.equal(result.unit, '유스');
  const stored = f.db.documents.get(marketPath(scope, OVERSEAS));
  assert.equal(stored.rules.openMinuteKst, 960); assert.equal(stored.rules.closeMinuteKst, 1380);
  assert.equal(stored.rules.minimumCashReserve, 0); assert.equal(stored.rules.halted, false);
  assert.equal(stored.studentOpen, false); assert.equal(stored.stocks.length, 0);
  assert.deepEqual(stored.catalogExits, { enabledAtMs: THURSDAY_NOON, overrides: {} });
  assert.equal(result.catalogSchedule.totalCount, 30);
  assert.deepEqual(f.db.documents.get(marketPath(scope)), f.domestic);
  assert.equal(f.db.documents.has(`${root}/wis_stock_public/overseas_market`), false);
  const management = await f.overseas.getWisStockManagement(f.req({}));
  assert.equal(management.fx, null);
  await assert.rejects(f.overseas.getWisStockManagement(f.req({ forecastStockId: overseasCatalog[0].id })), reason('WIS_STOCK_INPUT_INVALID'));
});

test('opening lists due overseas stocks; ticks follow history, delist on schedule and publish separately', async () => {
  const f = managementFixture();
  await f.overseas.activateWisStockCatalogPlan(f.req({ requestId: 'overseas-plan-00000001', expectedRevision: 0, startsAtMs: MONDAY }));
  f.setNow(MONDAY + 5 * 60_000);
  const before = f.db.documents.get(marketPath(scope, OVERSEAS));
  const opened = await f.overseas.setWisStockMarketHalted(f.req({ requestId: 'overseas-open-000000001', expectedRevision: before.revision, halted: false }));
  assert.equal(opened.studentOpen, true);
  assert.deepEqual(opened.stocks.map(stock => stock.settings.name), ['희망봉마린']);
  assert.equal(opened.stocks[0].settings.period, '신항로 개척');
  const publicMarket = f.db.documents.get(`${root}/wis_stock_public/overseas_market`);
  assert.equal(publicMarket.stocks.length, 1); assert.equal(publicMarket.stocks[0].listedAtMs, MONDAY + 5 * 60_000);
  // The rest of the catalog is published as upcoming listings in listing
  // order, without the scenario reasons that reveal future price moves.
  assert.equal(publicMarket.upcoming.length, 29);
  assert.deepEqual(Object.keys(publicMarket.upcoming[0]).sort(), ['id', 'listingAtMs', 'name', 'period', 'tagline']);
  assert.ok(publicMarket.upcoming.every((item, index, list) => index === 0 || list[index - 1].listingAtMs <= item.listingAtMs));
  assert.ok(!publicMarket.upcoming.some(item => item.id === publicMarket.stocks[0].id));
  const second = overseasCatalog.find(entry => entry.id === publicMarket.upcoming[0].id);
  assert.equal(publicMarket.upcoming[0].listingAtMs, catalogSessionAtMs(second.listingSession, MONDAY));
  assert.equal(publicMarket.upcoming[0].period, '신항로 개척');
  assert.ok(!JSON.stringify(publicMarket.upcoming).includes('게임 설정'));
  assert.equal(f.db.documents.get(`${root}/wis_stock_public/overseas_current`).studentOpen, true);
  assert.equal(f.db.documents.has(`${root}/wis_stock_public/market`), false);
  const domesticBefore = structuredClone(f.db.documents.get(marketPath(scope)));
  // Every ten-minute tick from Monday 16:10 to Friday 19:00 KST.
  const end = MONDAY + 4 * 86_400_000 + 3 * 3_600_000;
  for (let at = MONDAY + 10 * 60_000; at <= end; at += 10 * 60_000) {
    f.setNow(at + 2000);
    await f.overseas.advanceWisStockPrices({ scheduleTime: new Date(at).toISOString() });
  }
  const market = f.db.documents.get(marketPath(scope, OVERSEAS));
  const listed = overseasCatalog.filter(entry => catalogSessionAtMs(entry.listingSession, MONDAY) <= end);
  assert.deepEqual(new Set(market.stocks.map(stock => stock.id)), new Set(listed.map(entry => entry.id)));
  const santa = market.stocks.find(stock => stock.settings.name === '산타마리아익스플로러');
  const santaEntry = overseasCatalog.find(entry => entry.id === santa.id);
  assert.equal(santa.settings.tradingStatus, 'GRADUATED');
  assert.equal(santa.graduation.exitKind, 'merge');
  assert.equal(santa.graduation.plannedAtMs, catalogExitAtMs(santaEntry, { version: 1, startsAtMs: MONDAY }));
  const job = f.db.documents.get(`${OVERSEAS.graduations}/2026-2_${santa.id}`);
  assert.equal(job.status, 'PENDING'); assert.equal(job.unitPrice, santa.price);
  assert.equal(f.db.documents.has(`${DOMESTIC.graduations}/2026-2_${santa.id}`), false);
  const exitPublic = f.db.documents.get(`${root}/wis_stock_public/overseas_market`).stocks.find(stock => stock.id === santa.id);
  assert.deepEqual(exitPublic.exit, { atMs: santa.graduation.atMs, kind: 'merge' });
  const survivors = market.stocks.filter(stock => stock.settings.tradingStatus === 'ACTIVE');
  assert.ok(survivors.every(stock => stock.history.length > 1), 'every active stock has moved');
  assert.deepEqual(f.db.documents.get(marketPath(scope)), domesticBefore);
  assert.equal(f.db.documents.has(`${root}/wis_stock_public/market`), false);
});

test('history-led drift lowers the same seeded path in a fall and lifts it in a rise', () => {
  const entry = overseasCatalog.find(item => item.name === '포토시실버');
  const plan = { version: 1, startsAtMs: MONDAY };
  const settings = { name: entry.name, description: '', period: '신항로 개척', initialPrice: 300, minimumPrice: 1, maximumPrice: 1_000_000,
    volatilityBps: 300, trendBps: 0, intervalHours: 1, automatic: true, growthProfile: 'HISTORICAL', issuedShares: 100000, lotSize: 1, tradingStatus: 'ACTIVE' };
  const run = (venue, fromSession, toSession) => {
    const startAt = catalogSessionAtMs(fromSession, MONDAY);
    let market = { ...blankMarket(scope, venue), revision: 1, studentOpen: true, priceSeed: 'a'.repeat(64), catalogPlan: plan,
      catalogExits: { enabledAtMs: 1, overrides: {} },
      rules: normalizeWisStockMarketRules({ openMinuteKst: 960, closeMinuteKst: 1380, dailyPriceLimitBps: 3000, circuitBreakerBps: 3000 }),
      stocks: [{ id: entry.id, settings, price: 300, listedAtMs: startAt, dayKey: '', dayOpenPrice: 300, haltedUntilMs: 0,
        updatedAtMs: startAt, nextTickAtMs: startAt + 600_000, history: [{ atMs: startAt, price: 300 }] }] };
    const endAt = catalogSessionAtMs(toSession, MONDAY);
    for (let at = startAt + 600_000; at <= endAt; at += 600_000) market = advanceMarket(market, at, new Map(), venue);
    return market.stocks[0].price;
  };
  const flatVenue = { ...OVERSEAS, historyTrend: false };
  const rising = run(OVERSEAS, entry.riseSession, entry.riseSession + 7), risingFlat = run(flatVenue, entry.riseSession, entry.riseSession + 7);
  const falling = run(OVERSEAS, entry.fallSession, entry.fallSession + 8), fallingFlat = run(flatVenue, entry.fallSession, entry.fallSession + 8);
  assert.ok(rising > risingFlat, `rise ${rising} > ${risingFlat}`);
  assert.ok(falling < fallingFlat, `fall ${falling} < ${fallingFlat}`);
});

// ---------------------------------------------------------------- trading
const UID = 'student', AUTH_TIME = 1_700_000_000, SESSION = 'a'.repeat(64);
const accountId = 'wisacct_' + hash(`2026-2\n${UID}`);
const slotId = 'slot_' + hash(`2026-2\n${UID}`).slice(0, 40);
const stockSettings = name => ({ name, description: '', period: '시험', initialPrice: 200, minimumPrice: 1, maximumPrice: 1_000_000,
  volatilityBps: 300, trendBps: 0, intervalHours: 1, automatic: false, growthProfile: 'HISTORICAL', issuedShares: 100000, lotSize: 1, tradingStatus: 'ACTIVE' });
const stock = (id, name, atMs) => ({ id, settings: stockSettings(name), price: 200, listedAtMs: atMs, dayKey: '', dayOpenPrice: 200,
  haltedUntilMs: 0, updatedAtMs: atMs, nextTickAtMs: atMs + 600_000, history: [{ atMs, price: 200 }] });
function tradingFixture({ rate = 1345, fxDayAtMs, overseasOpen = true, balance = 10000 } = {}) {
  let clock = MONDAY + 3_600_000; // Monday 17:00 KST, both markets in session
  const rules = normalizeWisStockMarketRules({ openMinuteKst: 480, closeMinuteKst: 1080 });
  const domesticStock = 'stock_' + 'd'.repeat(24), overseasStock = overseasCatalog[0].id;
  const db = createFakeFirestore({
    'site_settings/config': { year: '2026', semester: '2' },
    'site_settings/semester_active': { semesterId: '2026-2', revision: 1 },
    'semester_manifests/2026-2': { semesterId: '2026-2', status: 'ACTIVE', revision: 1 },
    'semester_wis_economies/2026-2': { semesterId: '2026-2', status: 'ACTIVE_OPEN', revision: 1, ledgerEntryCount: 0 },
    [`semester_wis_accounts/${accountId}`]: { accountId, studentUid: UID, semesterId: '2026-2', schemaVersion: 1, policyVersion: 'w7-v1',
      status: 'ACTIVE', enrollmentId: 'enr1', classId: 'class1', revision: 1, balance, earnedTotal: balance, rankEarnedTotal: balance,
      spentTotal: 0, adjustedTotal: 0, recentLedgerEntries: [], grade: '1', classNumber: '1', studentNumber: '1', displayName: '학생' },
    [`users/${UID}`]: { role: 'student' },
    [`student_identities/${UID}`]: { studentUid: UID },
    [`semester_enrollment_slots/${slotId}`]: { studentUid: UID, semesterId: '2026-2', activeEnrollmentId: 'enr1' },
    'semester_enrollments/enr1': { enrollmentId: 'enr1', semesterId: '2026-2', studentUid: UID, enrollmentStatus: 'ACTIVE', classId: 'class1' },
    'semester_classes/class1': { classId: 'class1', semesterId: '2026-2', status: 'ACTIVE' },
    [`application_sessions/${UID}/sessions/${AUTH_TIME}`]: { uid: UID, authTime: AUTH_TIME, status: 'active', schemaVersion: 2,
      authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, sessionRevision: SESSION,
      generalExpiresAt: Timestamp.fromMillis(MONDAY + 30 * 86_400_000), authorityModeAtOpen: 'ENFORCE' },
    [marketPath(scope)]: { ...blankMarket(scope), revision: 5, studentOpen: true, rules, stocks: [stock(domesticStock, '국내 시험 종목', clock)] },
    [marketPath(scope, OVERSEAS)]: { ...blankMarket(scope, OVERSEAS), revision: 7, studentOpen: overseasOpen,
      rules: { ...rules, minimumCashReserve: 0, openMinuteKst: 960, closeMinuteKst: 1380 }, stocks: [stock(overseasStock, overseasCatalog[0].name, clock)] },
    [fx.WIS_STOCK_FX_PATH]: fx.nextWisStockFxDocument(null, { krwPerUsd: rate, sourceDate: '2026-11-27', source: 'test', fetchedAtMs: fxDayAtMs ?? clock }),
  });
  const common = { db, assertSession: async () => ({ uid: UID }), now: () => clock, delaySeconds: () => 5, enqueueTask: async () => {} };
  const home = createWisStockTrading({ ...common, exchangeVenue: OVERSEAS });
  const abroad = createWisStockTrading({ ...common, venue: OVERSEAS });
  let request = 0;
  const call = (handler, data = {}, withRequest = true) => handler({ auth: { uid: UID, token: { auth_time: AUTH_TIME } },
    data: { year: '2026', semester: '2', _session: { revision: SESSION }, ...(withRequest ? { requestId: `request-${String(++request).padStart(12, '0')}` } : {}), ...data } });
  return { db, home, abroad, call, domesticStock, overseasStock, advance: ms => { clock += ms; }, now: () => clock };
}

test('exchange moves only unreserved Wis into a separate 유스 account at the day rate, idempotently', async () => {
  const f = tradingFixture();
  await assert.rejects(f.call(f.home.exchangeStudentWisStockCurrency, { direction: 'WIS_TO_YUS', amount: 1345, rate: 1345 }), reason('WIS_STOCK_ACCOUNT_REQUIRED'));
  const deposit = await f.call(f.home.transferStudentWisStock, { direction: 'DEPOSIT', amount: 3000 });
  assert.equal(deposit.state.account.stockCash, 3000);
  await assert.rejects(f.call(f.home.exchangeStudentWisStockCurrency, { direction: 'WIS_TO_YUS', amount: 1345, rate: 1300 }), reason('WIS_STOCK_FX_RATE_CHANGED'));
  await assert.rejects(f.call(f.home.exchangeStudentWisStockCurrency, { direction: 'WIS_TO_YUS', amount: 3001, rate: 1345 }), reason('WIS_STOCK_FX_INSUFFICIENT'));
  const input = { direction: 'WIS_TO_YUS', amount: 1345, rate: 1345, requestId: 'exchange-request-000001' };
  const first = await f.call(f.home.exchangeStudentWisStockCurrency, input, false);
  assert.equal(first.changed, true);
  assert.deepEqual({ debit: first.receipt.debit, credit: first.receipt.credit, rate: first.receipt.rate }, { debit: 1345, credit: 1000, rate: 1345 });
  assert.equal(first.state.account.stockCash, 1655);
  assert.deepEqual(first.peer, { revision: 1, stockCash: 1000, reservedCash: 0 });
  const overseasAccount = f.db.documents.get(`${root}/${OVERSEAS.accounts}/${accountId}`);
  assert.equal(overseasAccount.stockCash, 1000); assert.equal(overseasAccount.outstandingPrincipal, 1000);
  assert.equal(f.db.documents.get(`semester_wis_accounts/${accountId}`).balance, 7000, 'general Wis only changed by the deposit');
  const replay = await f.call(f.home.exchangeStudentWisStockCurrency, input, false);
  assert.equal(replay.duplicate, true); assert.equal(replay.state.account.stockCash, 1655);
  assert.equal(f.db.documents.get(`${root}/${OVERSEAS.accounts}/${accountId}`).stockCash, 1000);
  await assert.rejects(f.call(f.home.exchangeStudentWisStockCurrency, { ...input, amount: 1346 }, false), reason('WIS_STOCK_REQUEST_CONFLICT'));
  const homeHistory = [...f.db.documents.entries()].filter(([key, value]) => key.startsWith(`${root}/wis_stock_history/`) && value.kind === 'EXCHANGE');
  const abroadHistory = [...f.db.documents.entries()].filter(([key, value]) => key.startsWith(`${root}/${OVERSEAS.history}/`) && value.kind === 'EXCHANGE');
  assert.equal(homeHistory.length, 1); assert.equal(abroadHistory.length, 1);
  assert.equal(homeHistory[0][1].stockCashDelta, -1345); assert.equal(abroadHistory[0][1].stockCashDelta, 1000);
  const board = f.db.documents.get(`${root}/wis_stock_investment_boards/all`);
  assert.equal(board.rows[0].stockCash, 1655, 'domestic board reflects the exchanged cash');
  const state = await f.call(f.abroad.getStudentWisStockState, {}, false);
  assert.equal(state.venue, 'OVERSEAS'); assert.equal(state.unit, '유스');
  assert.equal(state.account.stockCash, 1000); assert.equal(state.funding.maximumWithdrawal, 1000);
  assert.match(state.accountPath, new RegExp(`^${root}/${OVERSEAS.accounts}/wisacct_[a-f0-9]{64}$`));
  const back = await f.call(f.home.exchangeStudentWisStockCurrency, { direction: 'YUS_TO_WIS', amount: 500, rate: 1345 });
  assert.equal(back.receipt.credit, 672); assert.equal(back.state.account.stockCash, 2327);
  assert.equal(f.db.documents.get(`${root}/${OVERSEAS.accounts}/${accountId}`).outstandingPrincipal, 500);
});

test('overseas orders reserve and settle 유스 in overseas documents only; transfers stay domestic', async () => {
  const f = tradingFixture();
  await f.call(f.home.transferStudentWisStock, { direction: 'DEPOSIT', amount: 3000 });
  await f.call(f.home.exchangeStudentWisStockCurrency, { direction: 'WIS_TO_YUS', amount: 1345, rate: 1345 });
  await assert.rejects(f.call(f.abroad.transferStudentWisStock, { direction: 'DEPOSIT', amount: 100 }), reason('WIS_STOCK_VENUE_UNSUPPORTED'));
  await assert.rejects(f.call(f.abroad.claimStudentWisStockBonus, {}), reason('WIS_STOCK_VENUE_UNSUPPORTED'));
  const market = f.db.documents.get(marketPath(scope, OVERSEAS));
  await assert.rejects(f.call(f.abroad.placeStudentWisStockOrder, { stockId: f.overseasStock, side: 'BUY', quantity: 3,
    quote: { price: 200, atMs: f.now(), marketRevision: market.revision } }), reason('WIS_STOCK_CONCENTRATION_LIMIT'));
  const placed = await f.call(f.abroad.placeStudentWisStockOrder, { stockId: f.overseasStock, side: 'BUY', quantity: 2,
    quote: { price: 200, atMs: f.now(), marketRevision: market.revision } });
  assert.equal(placed.order.status, 'PENDING'); assert.equal(placed.order.cashDebit, 404);
  assert.equal(placed.state.account.reservedCash, 404);
  assert.ok(f.db.documents.has(`${root}/${OVERSEAS.orders}/${placed.order.id}`));
  assert.ok(f.db.documents.has(`${root}/${OVERSEAS.supplies}/${f.overseasStock}`));
  assert.equal(f.db.documents.has(`${root}/wis_stock_orders/${placed.order.id}`), false);
  await assert.rejects(f.call(f.home.exchangeStudentWisStockCurrency, { direction: 'YUS_TO_WIS', amount: 597, rate: 1345 }), reason('WIS_STOCK_FX_INSUFFICIENT'));
  f.advance(6000);
  const settled = await f.abroad.settleWisStockOrderTask({ data: { kind: 'ORDER', year: '2026', semester: '2', orderId: placed.order.id } });
  assert.equal(settled.order.status, 'FILLED');
  const account = f.db.documents.get(`${root}/${OVERSEAS.accounts}/${accountId}`);
  assert.equal(account.stockCash, 596); assert.equal(account.reservedCash, 0); assert.equal(account.positions[f.overseasStock].quantity, 2);
  assert.equal(f.db.documents.has(`${root}/wis_stock_display_trades/${placed.order.id}`), false);
  const domestic = f.db.documents.get(`${root}/wis_stock_accounts/${accountId}`);
  assert.deepEqual(domestic.positions, {}); assert.equal(domestic.stockCash, 1655);
});

test('exchange is closed when the overseas market is stopped or the day rate is stale', async () => {
  const closed = tradingFixture({ overseasOpen: false });
  await closed.call(closed.home.transferStudentWisStock, { direction: 'DEPOSIT', amount: 3000 });
  await assert.rejects(closed.call(closed.home.exchangeStudentWisStockCurrency, { direction: 'WIS_TO_YUS', amount: 1345, rate: 1345 }), reason('WIS_STOCK_MARKET_CLOSED'));
  const stale = tradingFixture({ fxDayAtMs: MONDAY - 3 * 86_400_000 });
  await stale.call(stale.home.transferStudentWisStock, { direction: 'DEPOSIT', amount: 3000 });
  await assert.rejects(stale.call(stale.home.exchangeStudentWisStockCurrency, { direction: 'WIS_TO_YUS', amount: 1345, rate: 1345 }), reason('WIS_STOCK_FX_UNAVAILABLE'));
});

test('delisting settles 유스 holders into the overseas account without fees', async () => {
  const f = tradingFixture();
  await f.call(f.home.transferStudentWisStock, { direction: 'DEPOSIT', amount: 3000 });
  await f.call(f.home.exchangeStudentWisStockCurrency, { direction: 'WIS_TO_YUS', amount: 1345, rate: 1345 });
  const market = f.db.documents.get(marketPath(scope, OVERSEAS));
  const placed = await f.call(f.abroad.placeStudentWisStockOrder, { stockId: f.overseasStock, side: 'BUY', quantity: 2,
    quote: { price: 200, atMs: f.now(), marketRevision: market.revision } });
  f.advance(6000);
  await f.abroad.settleWisStockOrderTask({ data: { kind: 'ORDER', year: '2026', semester: '2', orderId: placed.order.id } });
  const current = f.db.documents.get(marketPath(scope, OVERSEAS));
  const atMs = f.now();
  current.stocks = current.stocks.map(item => item.id === f.overseasStock ? { ...item, price: 150,
    settings: { ...item.settings, tradingStatus: 'GRADUATED' }, graduation: { unitPrice: 150, atMs, plannedAtMs: atMs, exitKind: 'delist' } } : item);
  current.revision += 1;
  f.db.documents.set(marketPath(scope, OVERSEAS), current);
  f.db.documents.set(`${OVERSEAS.graduations}/2026-2_${f.overseasStock}`, { schemaVersion: 1, ...scope, stockId: f.overseasStock,
    unitPrice: 150, atMs, plannedAtMs: atMs, exitKind: 'delist', status: 'PENDING' });
  const swept = await f.abroad.settleWisStockOrderTask({ data: { kind: 'GRADUATION', year: '2026', semester: '2', stockId: f.overseasStock } });
  assert.equal(swept.changed, 1);
  const account = f.db.documents.get(`${root}/${OVERSEAS.accounts}/${accountId}`);
  assert.equal(account.positions[f.overseasStock], undefined);
  assert.equal(account.stockCash, 1000 - 404 + 300);
  assert.equal(account.cumulativeRealizedPnl, 300 - 404);
  assert.equal(f.db.documents.get(`${OVERSEAS.graduations}/2026-2_${f.overseasStock}`).status, 'COMPLETE');
  assert.ok([...f.db.documents.keys()].some(key => key.startsWith(`${root}/${OVERSEAS.graduationReceipts}/`)));
});
