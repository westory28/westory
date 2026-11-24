const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { createWisStockHandlers, marketPath, publicStockPath, publicStockMarket, publicStockStatus, HISTORY_LIMIT, MAX_STOCKS, MAX_MARKET_BYTES, reservedMarketBytes, normalizeSettings, advanceMarket, blankMarket } = require('../wisStocks');
const { normalizeWisStockMarketRules } = require('../wisStockMarketRules');
const { drawListingPrice } = require('../wisStockCatalogSchedule');
const TEN_MINUTES = 10 * 60_000;
const scope = { year: '2026', semester: '2', semesterId: '2026-2' };
const initial = () => ({ name: '합성 역사 종목', description: '시험용 배경', period: '시험 시대', initialPrice: 100, minimumPrice: 1,
  maximumPrice: 10000, volatilityBps: 300, trendBps: 0, intervalHours: 1, automatic: false });
const req = data => ({ auth: { uid: 'manager', token: { email: 'manager@yongshin-ms.ms.kr' } }, data: { year: scope.year, semester: scope.semester, ...data } });
const saveInput = (settings = initial(), expectedRevision = 0, stockId = '', requestId = 'stock-request-00000001') => req({ settings, expectedRevision, stockId, requestId });
const reason = value => error => error.details?.reason === value;
function fixture({ optimisticRetries = false, beforeRead = () => {}, openingPrice = (_seed, _semester, _id, minimum) => minimum } = {}) {
  let clock = Date.parse('2026-11-16T00:00:00Z'); // Monday 09:00 KST.
  const documents = new Map([
    ['users/manager', { role: 'teacher', teacherPortalEnabled: true, staffPermissions: ['point_manage'] }],
    ['site_settings/config', { year: '2026', semester: '2' }], ['site_settings/semester_active', { semesterId: '2026-2' }],
    ['semester_manifests/2026-2', { status: 'ACTIVE' }],
  ]);
  const reads = [], writes = [], sessions = [];
  let transactionVersion = 0;
  const db = { doc: path => ({ path }), runTransaction: async callback => {
    for (;;) {
      const observedVersion = transactionVersion;
      const changes = [];
      const result = await callback({
        get: async ref => { reads.push(ref.path); beforeRead(ref.path); return { exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) }; },
        set: (ref, data) => changes.push({ path: ref.path, data: structuredClone(data) }),
        update: (ref, patch) => {
          assert(documents.has(ref.path));
          const data = structuredClone(documents.get(ref.path));
          for (const [key, value] of Object.entries(patch)) {
            const parts = key.split('.'); let target = data;
            for (const part of parts.slice(0, -1)) target = target[part] ||= {};
            target[parts.at(-1)] = value;
          }
          changes.push({ path: ref.path, data });
        },
        create: (ref, data) => { assert(!documents.has(ref.path)); changes.push({ path: ref.path, data: structuredClone(data) }); },
      });
      if (optimisticRetries && observedVersion !== transactionVersion) continue;
      changes.forEach(change => { documents.set(change.path, change.data); writes.push(change); });
      if (changes.length) transactionVersion++;
      return result;
    }
  } };
  const api = createWisStockHandlers({ db, openingPrice, assertSession: async (request, options) => { sessions.push(options); return { uid: request.auth?.uid, email: request.auth?.token?.email }; }, now: () => clock });
  return { api, documents, reads, writes, sessions, advance: (ms = 3600000) => clock += ms };
}

test('teacher forecast matches delayed ten-minute workers, private index feedback, event closes and scoped rights', async () => {
  const f = fixture(), start = Date.parse('2026-12-15T18:00:00+09:00');
  let clock = f.advance(start - Date.parse('2026-11-16T09:00:00+09:00'));
  const rules = normalizeWisStockMarketRules({ openMinuteKst: 600, closeMinuteKst: 650, dailyPriceLimitBps: 400, circuitBreakerBps: 380 });
  const make = (n, name, overrides, price = 1003) => {
    const settings = normalizeSettings({ ...initial(), name, automatic: true, initialPrice: price,
      minimumPrice: 1, maximumPrice: 100000, ...overrides });
    return { id: 'stock_' + String(n).padStart(24, '0'), settings, price, updatedAtMs: start - 86400000,
      nextTickAtMs: start, dayKey: '2026-12-15', dayOpenPrice: price, history: [{ atMs: start - 86400000, price }] };
  };
  const stocks = [make(1, '한양건설', {}), make(2, '새금융', { growthProfile: 'VALUE' }), make(3, '한도주',
    { automatic: false, minimumPrice: 1000, maximumPrice: 1004, tradingStatus: 'SELL_ONLY' }),
    make(4, '매매 정지', { tradingStatus: 'HALTED' })];
  const raw = { ...blankMarket(scope), rules, revision: 11, studentOpen: true, updatedAtMs: start - 86400000,
    lastPriceSlot: Math.floor((start - 86400000) / 1800000), priceSeed: 'd'.repeat(64), stocks };
  f.documents.set(marketPath(scope), raw);
  const before = JSON.stringify(raw);
  const previews = await Promise.all(stocks.map(stock => f.api.getWisStockManagement(req({ forecastStockId: stock.id }))));
  assert.equal(f.reads.length, stocks.length * 5); assert.equal(f.writes.length, 0);
  assert.equal(JSON.stringify(raw), before); assert(!JSON.stringify(previews).includes(raw.priceSeed));
  assert.deepEqual(previews[3].history, []);
  assert.deepEqual(previews[0].specialSessions.map(item => item.changeBps), [-2000, 1000, 1000]);
  const expected = previews.map(series => new Map(series.history.map(point => [point.atMs, point.price])));
  const events = new Map([['2026-12-16', -20], ['2026-12-23', 10], ['2026-12-24', 10]]);
  for (let day = 16; day <= 25; day++) {
    const dayKey = '2026-12-' + day, open = Date.parse(dayKey + 'T10:00:00+09:00');
    if ([0, 6].includes(new Date(open).getUTCDay())) continue;
    const prior = f.documents.get(marketPath(scope)).stocks.map(stock => stock.price);
    for (let i = 0; i < 5; i++) {
      const atMs = open + i * TEN_MINUTES, event = { scheduleTime: new Date(atMs).toISOString() };
      clock = f.advance(atMs + (i % 3 + 1) * 19000 - clock);
      await f.api.advanceWisStockPrices(event);
      const result = f.documents.get(marketPath(scope));
      result.stocks.forEach((stock, index) => {
        const quoted = expected[index].get(atMs);
        if (quoted !== undefined) assert.equal(stock.price, quoted, dayKey + ' / ' + stock.settings.name + ' / ' + i);
        assert.deepEqual(stock.history[0], stocks[index].history[0]);
      });
      assert.equal((await f.api.advanceWisStockPrices(event)).changed, false);
    }
    const prices = f.documents.get(marketPath(scope)).stocks.map(stock => stock.price);
    if (events.has(dayKey)) {
      prices.slice(0, 3).forEach((price, i) => assert.equal(price, events.get(dayKey) < 0
        ? Math.round(prior[i] * 0.8) : Math.ceil(prior[i] * 110 / 100)));
      assert.equal(prices[3], prior[3]);
    } else assert.equal(prices[2], prior[2], 'Manual price never snaps back to its old bounds');
  }
  f.documents.set('users/manager', { role: 'student' });
  await assert.rejects(f.api.getWisStockManagement(req({ forecastStockId: stocks[0].id })), reason('WIS_STOCK_TEACHER_REQUIRED'));
  f.documents.set('users/manager', { role: 'teacher' });
  await assert.rejects(f.api.getWisStockManagement(req({ forecastStockId: [stocks[0].id] })), reason('WIS_STOCK_INPUT_INVALID'));
});

function catalogExitFixture(options) {
  const f = fixture(options), start = Date.parse('2026-11-16T00:00:00Z');
  const { applyDueCatalogListings } = require('../wisStockCatalogSchedule');
  const { catalogExitAtMs } = require('../wisStockCatalogTimeline');
  const catalog = require('../wisStockCatalog.json');
  const plan = { version: 1, startsAtMs: start };
  const base = { ...blankMarket(scope), revision: 1, studentOpen: true, catalogPlan: plan,
    rules: normalizeWisStockMarketRules({ automaticPrices: false }) };
  const listed = applyDueCatalogListings(base, start + 42 * 86400000).market;
  // All canonical IDs are registered beforehand so this fixture can count
  // lifecycle writes without unrelated listing writes at the same boundary.
  listed.stocks = listed.stocks.map(stock => ({ ...stock, listedAtMs: start, updatedAtMs: start,
    history: [{ atMs: start, price: stock.price }], priceModel: { ...stock.priceModel, anchorAtMs: start } }));
  f.documents.set(marketPath(scope), listed);
  f.advance(7 * 86400000);
  const exitOverrides = Object.fromEntries(catalog.filter(entry => entry.exitKind !== 'survive'
    && catalogExitAtMs(entry, plan) <= start + 7 * 86400000)
    .map(entry => [entry.id, catalogExitAtMs(entry, plan) + 4 * 86400000]));
  const request = req({ expectedRevision: 1, requestId: 'catalog-exits-activate-01', exitOverrides });
  f.reads.length = 0; f.writes.length = 0;
  return { ...f, start, exitOverrides, request };
}

test('catalog exit activation only stores reviewed future dates, with authority, revision and zero-write replay', async () => {
  const f = catalogExitFixture();
  const result = await f.api.activateWisStockCatalogExits(f.request);
  assert.equal(result.changed, true); assert.equal(f.reads.length, 6); assert.equal(f.writes.length, 3);
  assert.equal(result.catalogSchedule.plan.exitsEnabledAtMs, f.start + 7 * 86400000);
  assert.deepEqual(result.catalogSchedule.plan.exitOverrides, f.exitOverrides);
  assert.deepEqual(f.documents.get(marketPath(scope)).catalogPlan, { version: 1, startsAtMs: f.start });
  assert.deepEqual(f.documents.get(marketPath(scope)).catalogExits,
    { enabledAtMs: f.start + 7 * 86400000, overrides: f.exitOverrides });
  assert.equal(result.stocks.filter(stock => stock.settings.tradingStatus === 'GRADUATED').length, 0);
  assert(![...f.documents.keys()].some(path => path.startsWith('wis_stock_graduations/')));
  f.writes.length = 0;
  assert.equal((await f.api.activateWisStockCatalogExits(f.request)).duplicate, true);
  assert.equal(f.writes.length, 0);
  await assert.rejects(f.api.activateWisStockCatalogExits(req({ ...f.request.data, exitOverrides: {} })), reason('WIS_STOCK_REQUEST_CONFLICT'));
  assert.equal((await f.api.activateWisStockCatalogExits(req({ ...f.request.data, requestId: 'catalog-exits-same-0001', expectedRevision: 2 }))).changed, false);
  await assert.rejects(f.api.activateWisStockCatalogExits(req({ ...f.request.data, requestId: 'catalog-exits-different1', expectedRevision: 2, exitOverrides: {} })), reason('WIS_STOCK_CATALOG_EXITS_LOCKED'));
  const other = catalogExitFixture();
  await assert.rejects(other.api.activateWisStockCatalogExits(req({ ...other.request.data, exitOverrides: {} })), reason('WIS_STOCK_CATALOG_EXIT_PAST'));
  await assert.rejects(other.api.activateWisStockCatalogExits(req({ ...other.request.data, expectedRevision: 0 })), reason('WIS_STOCK_REVISION_CONFLICT'));
  other.documents.set('users/manager', { role: 'student' });
  await assert.rejects(other.api.activateWisStockCatalogExits(other.request), reason('WIS_STOCK_TEACHER_REQUIRED'));
  assert.equal(other.writes.length, 0);
});

test('scheduled exits freeze the last actual quote before pricing and create atomic jobs once without account reads', async () => {
  const f = catalogExitFixture({ optimisticRetries: true });
  await f.api.activateWisStockCatalogExits(f.request);
  f.advance(86400000 + 2 * 3600000); // November 24, 11:00 KST, two deferred exits.
  const market = f.documents.get(marketPath(scope));
  market.rules.automaticPrices = true;
  for (const stock of market.stocks) stock.settings.automatic = false;
  const exiting = market.stocks.filter(stock => f.exitOverrides[stock.id] === f.start + 8 * 86400000 + 2 * 3600000);
  for (const stock of exiting) { stock.settings.automatic = true; stock.settings.trendBps = 300; stock.nextTickAtMs = f.start; }
  const originals = structuredClone(exiting);
  f.reads.length = 0; f.writes.length = 0;
  const results = await Promise.all([f.api.advanceWisStockPrices(), f.api.advanceWisStockPrices()]);
  assert.equal(results.filter(result => result.changed).length, 1);
  const updated = f.documents.get(marketPath(scope));
  for (const old of originals) {
    const stock = updated.stocks.find(stock => stock.id === old.id);
    assert.equal(stock.settings.tradingStatus, 'GRADUATED'); assert.equal(stock.price, old.price);
    assert.deepEqual(stock.history, old.history);
    const job = f.documents.get(`wis_stock_graduations/${scope.semesterId}_${old.id}`);
    assert.equal(job.status, 'PENDING'); assert.equal(job.unitPrice, old.price);
    assert.equal(job.plannedAtMs, f.exitOverrides[old.id]); assert.equal(job.atMs, f.exitOverrides[old.id]);
    assert.equal(f.documents.get(publicStockPath(scope, 'market')).stocks.find(stock => stock.id === old.id).settings.tradingStatus, 'GRADUATED');
  }
  assert.equal(f.writes.length, 5); // market, public projection, two jobs, one audit receipt.
  assert(!f.reads.some(path => /accounts|orders|supplies/.test(path)));
  f.reads.length = 0; f.writes.length = 0;
  assert.equal((await f.api.advanceWisStockPrices()).changed, false);
  assert.equal(f.reads.length, 2); assert.equal(f.writes.length, 0);
});

test('scheduled exits require explicit activation and recover after a halt or closed session', async () => {
  const inactive = catalogExitFixture();
  inactive.advance(86400000 + 2 * 3600000);
  assert.equal((await inactive.api.advanceWisStockPrices()).changed, false);
  assert.equal(inactive.writes.length, 0);
  const f = catalogExitFixture();
  await f.api.activateWisStockCatalogExits(f.request);
  f.advance(86400000 + 2 * 3600000);
  const raw = f.documents.get(marketPath(scope)); raw.rules.halted = true;
  f.writes.length = 0;
  assert.equal((await f.api.advanceWisStockPrices()).changed, false); assert.equal(f.writes.length, 0);
  const resumed = await f.api.setWisStockMarketHalted(req({ requestId: 'resume-catalog-exits-01', expectedRevision: raw.revision, halted: false }));
  assert.equal(resumed.stocks.filter(stock => stock.settings.tradingStatus === 'GRADUATED').length, 2);
  f.advance(10 * 3600000); // Session closed: remaining three exits wait.
  f.writes.length = 0;
  assert.equal((await f.api.advanceWisStockPrices()).changed, false); assert.equal(f.writes.length, 0);
  f.advance(12 * 3600000); // Next morning's first trading slot.
  assert.equal((await f.api.advanceWisStockPrices()).changed, true);
  assert.equal(f.documents.get(marketPath(scope)).stocks.filter(stock => stock.settings.tradingStatus === 'GRADUATED').length, 5);
});
test('management requires point authority, forbids students even with portal flags, and reads a single market without writes', async () => {
  const f = fixture(), value = await f.api.getWisStockManagement(req({}));
  assert.equal(value.studentOpen, false); assert.deepEqual(value.stocks, []); assert.equal(value.maxStocks, MAX_STOCKS);
  assert.equal(f.reads.length, 5); assert.equal(f.reads.filter(path => path === marketPath(scope)).length, 1); assert.equal(f.writes.length, 0);
  for (const profile of [{ role: 'student', teacherPortalEnabled: true, staffPermissions: ['point_manage'] },
    { role: 'staff', teacherPortalEnabled: true, staffPermissions: [] },
    { role: 'teacher', disabled: true, teacherPortalEnabled: true, staffPermissions: ['point_manage'] }]) {
    f.documents.set('users/manager', profile);
    await assert.rejects(f.api.getWisStockManagement(req({})), reason('WIS_STOCK_TEACHER_REQUIRED'));
    await assert.rejects(f.api.saveWisStock(saveInput()), reason('WIS_STOCK_TEACHER_REQUIRED'));
  }
});

test('index reconstruction remains read-only, while actual stock updates atomically persist it with no additional document access', async () => {
  const f = fixture(), created = await f.api.saveWisStock(saveInput());
  const raw = f.documents.get(marketPath(scope));
  delete raw.marketIndex;
  const legacy = JSON.stringify(raw);
  f.reads.length = 0; f.writes.length = 0;
  const read = await f.api.getWisStockManagement(req({}));
  assert.equal(read.marketIndex.value, 1000); assert.equal(read.marketIndex.history.length, 1);
  assert.equal(f.reads.length, 5); assert.equal(f.writes.length, 0);
  assert.equal(JSON.stringify(f.documents.get(marketPath(scope))), legacy);
  const stockId = created.stocks[0].id;
  await f.api.saveWisStock(saveInput(initial(), 1, stockId, 'index-noop-request-01'));
  assert.equal(f.writes.length, 0); assert.equal(f.documents.get(marketPath(scope)).marketIndex, undefined);
  f.reads.length = 0;
  await f.api.saveWisStock(saveInput({ ...initial(), description: '실제 설명 수정' }, 1, stockId, 'index-edit-request-01'));
  assert.equal(f.reads.length, 6); assert.equal(f.writes.length, 2);
  assert.deepEqual(f.documents.get(marketPath(scope)).marketIndex.history, read.marketIndex.history);
  assert.equal(Object.hasOwn(publicStockMarket(f.documents.get(marketPath(scope))), 'marketIndex'), false);
});

test('concurrent scheduler transactions retry against the committed index and apply a return once', async () => {
  const f = fixture({ optimisticRetries: true });
  await f.api.saveWisStock(saveInput({ ...initial(), automatic: true, volatilityBps: 0, trendBps: 300 }));
  f.advance(TEN_MINUTES); f.reads.length = 0; f.writes.length = 0;
  const results = await Promise.all([f.api.advanceWisStockPrices(), f.api.advanceWisStockPrices()]);
  assert.equal(results.filter(result => result.changed).length, 1);
  assert.equal(f.writes.length, 1);
  assert.equal(f.reads.length, 10); // Two four-read attempts, then a two-read no-op retry.
  const market = f.documents.get(marketPath(scope));
  assert.equal(market.stocks[0].price, 103);
  assert.equal(market.marketIndex.value, 1030);
  assert.equal(market.marketIndex.history.length, 2);
  assert.equal((await f.api.advanceWisStockPrices()).changed, false);
  assert.equal(f.writes.length, 1);
});

test('invalid persisted index rejects reads and writes without touching balances or public prices', async () => {
  const f = fixture();
  await f.api.saveWisStock(saveInput());
  f.documents.get(marketPath(scope)).marketIndex.value = 0;
  const writes = f.writes.length;
  await assert.rejects(f.api.getWisStockManagement(req({})), reason('WIS_STOCK_MARKET_INVALID'));
  f.advance();
  await assert.rejects(f.api.advanceWisStockPrices(), reason('WIS_STOCK_MARKET_INVALID'));
  assert.equal(f.writes.length, writes);
});
test('late deliveries expire with zero reads; a failed current-slot read can retry and commit only once', async () => {
  let failNextMarketRead = false;
  const failure = new Error('Synthetic unavailable market read');
  const f = fixture({ beforeRead: path => {
    if (failNextMarketRead && path === marketPath(scope)) { failNextMarketRead = false; throw failure; }
  } });
  const saved = await f.api.saveWisStock(saveInput({ ...initial(), automatic: true, trendBps: 300, volatilityBps: 0 }));
  const start = saved.stocks[0].updatedAtMs;
  const event = atMs => ({ scheduleTime: new Date(atMs).toISOString() });
  const delayedAtMs = f.advance(TEN_MINUTES + 45_000);
  f.reads.length = 0; f.writes.length = 0;
  assert.equal((await f.api.advanceWisStockPrices(event(start))).changed, false);
  assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  failNextMarketRead = true;
  const current = event(start + TEN_MINUTES);
  await assert.rejects(f.api.advanceWisStockPrices(current), failure);
  assert.deepEqual(f.reads, ['site_settings/config', marketPath(scope)]); assert.equal(f.writes.length, 0);
  f.reads.length = 0;
  assert.equal((await f.api.advanceWisStockPrices(current)).changed, true);
  assert.equal(f.reads.length, 4); assert.equal(f.writes.length, 1);
  const stock = f.documents.get(marketPath(scope)).stocks[0];
  assert.deepEqual(stock.history.at(-1), { price: 103, atMs: delayedAtMs });
  assert.equal(stock.nextTickAtMs, start + 2 * TEN_MINUTES);
  f.reads.length = 0; f.writes.length = 0;
  f.advance(1);
  assert.equal((await f.api.advanceWisStockPrices(current)).changed, false);
  assert.equal(f.reads.length, 2); assert.equal(f.writes.length, 0);
});
test('due prices cannot publish across a semester switch or an inactive manifest', async () => {
  const f = fixture();
  await f.api.saveWisStock(saveInput({ ...initial(), automatic: true, trendBps: 300, volatilityBps: 0 }));
  f.advance(TEN_MINUTES); f.writes.length = 0;
  for (const [path, replacement] of [
    ['site_settings/semester_active', { semesterId: '2027-1' }],
    ['semester_manifests/2026-2', { status: 'ARCHIVED' }],
  ]) {
    const original = f.documents.get(path);
    f.documents.set(path, replacement); f.reads.length = 0;
    assert.equal((await f.api.advanceWisStockPrices()).changed, false);
    assert.equal(f.reads.length, 4); assert.equal(f.writes.length, 0);
    assert.equal(f.documents.get(marketPath(scope)).stocks[0].price, 100);
    f.documents.set(path, original);
  }
  assert.equal((await f.api.advanceWisStockPrices()).changed, true);
});
test('turning automatic prices on waits for the next boundary, even on a late delivery', async () => {
  const f = fixture(), saved = await f.api.saveWisStock(saveInput());
  const start = saved.stocks[0].updatedAtMs;
  f.advance(TEN_MINUTES + 5 * 60_000);
  const enabled = await f.api.saveWisStock(saveInput({ ...initial(), automatic: true, volatilityBps: 0, trendBps: 300 },
    saved.revision, saved.stocks[0].id, 'ten-minute-enable-auto'));
  assert.equal(enabled.stocks[0].nextTickAtMs, start + 2 * TEN_MINUTES);
  f.reads.length = 0; f.writes.length = 0;
  assert.equal((await f.api.advanceWisStockPrices({ scheduleTime: new Date(start + TEN_MINUTES).toISOString() })).changed, false);
  assert.equal(f.reads.length, 2); assert.equal(f.writes.length, 0);
  f.advance(25 * 60_000);
  assert.equal((await f.api.advanceWisStockPrices()).changed, true);
  assert.equal(f.documents.get(marketPath(scope)).stocks[0].price, 103);
});
test('delayed jobs respect custom opening and closing minutes as well as the scheduled boundary', async () => {
  const f = fixture();
  const saved = await f.api.saveWisStock(saveInput({ ...initial(), automatic: true, trendBps: 300, volatilityBps: 0 }));
  const market = f.documents.get(marketPath(scope)), start = saved.stocks[0].updatedAtMs;
  market.rules = normalizeWisStockMarketRules({ openMinuteKst: 555, closeMinuteKst: 585 });
  market.stocks[0].nextTickAtMs = start;
  for (const [elapsed, scheduled] of [[16, 10], [29, 40]]) {
    f.advance(elapsed * 60_000); f.reads.length = 0; f.writes.length = 0;
    assert.equal((await f.api.advanceWisStockPrices({ scheduleTime: new Date(start + scheduled * 60_000).toISOString() })).changed, false);
    assert.deepEqual(f.reads, ['site_settings/config', marketPath(scope)]); assert.equal(f.writes.length, 0);
  }
});
test('teacher role alone retains read and management authority while disabled and deleted teachers remain blocked', async () => {
  const f = fixture();
  f.documents.set('users/manager', { role: 'teacher' });
  assert.equal((await f.api.getWisStockManagement(req({}))).revision, 0);
  const created = await f.api.saveWisStock(saveInput());
  assert.equal(created.stocks.length, 1); assert.equal(f.writes.length, 2);
  for (const patch of [{ disabled: true }, { isDeleted: true }, { deletedAt: 1 }, { weplayDeletionPending: true }]) {
    f.documents.set('users/manager', { role: 'teacher', ...patch });
    await assert.rejects(f.api.getWisStockManagement(req({})), reason('WIS_STOCK_TEACHER_REQUIRED'));
    await assert.rejects(f.api.saveWisStock(saveInput()), reason('WIS_STOCK_TEACHER_REQUIRED'));
  }
  assert.equal(f.writes.length, 2);
});
test('create is atomic with a compact audit receipt, retries reuse the receipt, and conflicting payloads are rejected', async () => {
  const f = fixture(), input = saveInput();
  const created = await f.api.saveWisStock(input);
  assert.equal(created.revision, 1); assert.equal(created.stocks.length, 1); assert.equal(created.stocks[0].settings.automatic, false);
  assert.equal(f.reads.length, 6); assert.equal(f.writes.length, 2); assert.deepEqual(f.sessions[0], { highRisk: true, recentAuth: true });
  const repeated = await f.api.saveWisStock(input);
  assert.equal(repeated.duplicate, true); assert.equal(repeated.stocks[0].id, created.stocks[0].id); assert.equal(f.writes.length, 2);
  await assert.rejects(f.api.saveWisStock(saveInput({ ...initial(), name: '변경된 내용' })), reason('WIS_STOCK_REQUEST_CONFLICT'));
  assert.equal(f.writes.length, 2);
});
test('no-op edits do not write, stale revision and changed semester do not write, read-only staff cannot save', async () => {
  const f = fixture(), created = await f.api.saveWisStock(saveInput()), id = created.stocks[0].id;
  const noOp = await f.api.saveWisStock(saveInput(initial(), 1, id, 'stock-request-00000002'));
  assert.equal(noOp.changed, false); assert.equal(f.writes.length, 2);
  await assert.rejects(f.api.saveWisStock(saveInput({ ...initial(), name: '새 이름' }, 0, id, 'stock-request-00000003')), reason('WIS_STOCK_REVISION_CONFLICT'));
  f.documents.set('users/manager', { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['point_read'] });
  assert.equal((await f.api.getWisStockManagement(req({}))).stocks.length, 1);
  await assert.rejects(f.api.saveWisStock(saveInput()), reason('WIS_STOCK_TEACHER_REQUIRED'));
  f.documents.set('site_settings/semester_active', { semesterId: '2027-1' });
  await assert.rejects(f.api.getWisStockManagement(req({})), reason('WIS_STOCK_SCOPE_CHANGED'));
  assert.equal((await f.api.advanceWisStockPrices()).changed, false); assert.equal(f.writes.length, 2);
});
test('direct listings commit one server draw, including bounded endpoints and old-client receipt retries', async () => {
  const f = fixture({ openingPrice: drawListingPrice });
  let revision = 0;
  for (const [minimumPrice, maximumPrice] of [[1, 100], [500, 1000], [310, 420]]) {
    const input = saveInput({ ...initial(), initialPrice: 9999, minimumPrice, maximumPrice }, revision, '', `opening-range-request-${revision}`);
    f.reads.length = 0; f.writes.length = 0;
    const result = await f.api.saveWisStock(input);
    revision = result.revision;
    const stock = result.stocks.find(item => item.id === result.savedStockId);
    assert.equal(f.reads.length, 6); assert.equal(f.writes.length, 2);
    assert.equal(f.documents.get(marketPath(scope)).stocks.at(-1).listedAtMs, stock.updatedAtMs);
    assert(Number.isInteger(stock.price) && stock.price >= Math.max(100, minimumPrice) && stock.price <= Math.min(500, maximumPrice));
    assert.equal(stock.settings.initialPrice, stock.price); assert.equal(stock.priceModel.anchorPrice, stock.price);
    assert.equal(stock.dayOpenPrice, stock.price); assert.deepEqual(stock.history, [{ atMs: stock.updatedAtMs, price: stock.price }]);
    assert.equal(f.writes[1].data.settings.initialPrice, stock.price);
    assert.equal((await f.api.saveWisStock(input)).duplicate, true); assert.equal(f.writes.length, 2);
    await assert.rejects(f.api.saveWisStock(req({ ...input.data, settings: { ...input.data.settings, initialPrice: 9876 } })), reason('WIS_STOCK_REQUEST_CONFLICT'));
    const unchanged = await f.api.saveWisStock(saveInput(stock.settings, revision, stock.id, 'unchanged-opening-price'));
    assert.equal(unchanged.changed, false); assert.equal(f.writes.length, 2);
    f.advance(1000);
    const edited = await f.api.saveWisStock(saveInput({ ...stock.settings, description: '상장 후 편집' }, revision, stock.id, `edited-opening-price-${revision}`));
    revision = edited.revision;
    assert.equal(f.documents.get(marketPath(scope)).stocks.at(-1).listedAtMs, stock.updatedAtMs);
  }
  const before = structuredClone(f.documents.get(marketPath(scope)));
  for (const range of [{ minimumPrice: 1, maximumPrice: 99 }, { minimumPrice: 501, maximumPrice: 10000 }])
    await assert.rejects(f.api.saveWisStock(saveInput({ ...initial(), ...range }, revision, '', 'disjoint-opening-price')), reason('WIS_STOCK_LISTING_RANGE_INVALID'));
  assert.deepEqual(f.documents.get(marketPath(scope)), before);
});
test('previously listed high-price instruments retain their receipts, opening quote and subsequent history', async () => {
  const f = fixture(), original = await f.api.saveWisStock(saveInput());
  const oldSettings = normalizeSettings({ ...initial(), initialPrice: 1200, minimumPrice: 800 });
  const market = f.documents.get(marketPath(scope)), stock = market.stocks[0];
  delete stock.listedAtMs;
  stock.settings = oldSettings;
  stock.price = 1300; stock.dayOpenPrice = 1200; stock.priceModel.anchorPrice = 1200;
  stock.history = [{ atMs: stock.updatedAtMs, price: 1200 }, { atMs: stock.updatedAtMs + TEN_MINUTES, price: 1300 }];
  stock.updatedAtMs += TEN_MINUTES;
  const receipt = [...f.documents.entries()].find(([key]) => key.includes('/wis_stock_receipts/'))[1];
  receipt.settings = oldSettings;
  receipt.payloadHash = createHash('sha256').update(JSON.stringify([scope.semesterId, 0, '', oldSettings])).digest('hex');
  const before = structuredClone(stock);
  f.writes.length = 0;
  assert.equal((await f.api.saveWisStock(saveInput(oldSettings))).duplicate, true);
  assert.equal((await f.api.saveWisStock(saveInput(oldSettings, original.revision, stock.id, 'high-priced-legacy-edit'))).changed, false);
  assert.deepEqual(f.documents.get(marketPath(scope)).stocks[0], before);
  assert.equal(f.writes.length, 0);
});
test('invalid and public/trading payloads are rejected, prices stay integer and bounded', async () => {
  const f = fixture();
  for (const patch of [{ initialPrice: 0 }, { initialPrice: 1.5 }, { volatilityBps: 1001 }, { trendBps: -301 },
    { maximumPrice: 0 }, { intervalHours: 2 }, { name: ' ' }, { studentOpen: true }, { automatic: 'true' }]) {
    await assert.rejects(f.api.saveWisStock(saveInput({ ...initial(), ...patch })), reason('WIS_STOCK_INPUT_INVALID'));
  }
  await assert.rejects(f.api.saveWisStock({ ...saveInput(), data: { ...saveInput().data, studentOpen: true } }), reason('WIS_STOCK_INPUT_INVALID'));
  assert.equal(f.writes.length, 0);
});
test('automatic prices advance once per interval and preserve historical prices; unchanged and paused markets never write', async () => {
  const f = fixture(), settings = { ...initial(), volatilityBps: 0, trendBps: 300, automatic: true, maximumPrice: 110 };
  await f.api.saveWisStock(saveInput(settings));
  f.reads.length = 0;
  assert.equal((await f.api.advanceWisStockPrices()).changed, false); assert.equal(f.reads.length, 2); assert.equal(f.writes.length, 2);
  f.advance(); assert.equal((await f.api.advanceWisStockPrices()).changed, true); assert.equal(f.writes.length, 3);
  assert.equal(f.documents.get(marketPath(scope)).stocks[0].price, 103);
  assert.equal((await f.api.advanceWisStockPrices()).changed, false); assert.equal(f.writes.length, 3);
  for (let i = 0; i < 5; i++) { f.advance(); await f.api.advanceWisStockPrices(); }
  const capped = f.documents.get(marketPath(scope)); assert.equal(capped.stocks[0].price, 110);
  const writeCount = f.writes.length; f.advance(); await f.api.advanceWisStockPrices(); assert.equal(f.writes.length, writeCount);
  assert.deepEqual(capped.stocks[0].history[0].price, 100);
  const flat = fixture(); await flat.api.saveWisStock(saveInput({ ...initial(), volatilityBps: 0, automatic: true }));
  flat.advance(); await flat.api.advanceWisStockPrices(); assert.equal(flat.writes.length, 2);
});
test('history and catalog capacity are enforced rather than silently truncating instruments', async () => {
  const f = fixture(), created = await f.api.saveWisStock(saveInput({ ...initial(), volatilityBps: 1000, automatic: true }));
  let market = f.documents.get(marketPath(scope)), at = market.stocks[0].nextTickAtMs;
  market = { ...market, priceSeed: 'c'.repeat(64), rules: normalizeWisStockMarketRules({ tradingDays: [0, 1, 2, 3, 4, 5, 6],
    openMinuteKst: 0, closeMinuteKst: 1440, dailyPriceLimitBps: 3000, circuitBreakerBps: 3000 }) };
  for (let i = 0; i < 300; i++) { market = advanceMarket(market, at); at += 3600000; }
  assert.equal(market.stocks[0].history.length, HISTORY_LIMIT);
  assert.equal(JSON.stringify(advanceMarket(market, at)), JSON.stringify(advanceMarket(market, at)));
  assert(market.stocks[0].history.every(point => Number.isSafeInteger(point.price) && point.price >= 1 && point.price <= 10000));
  market.stocks = Array.from({ length: MAX_STOCKS }, (_, index) => ({ ...created.stocks[0], id: `stock_${index.toString(16).padStart(24, '0')}` }));
  f.documents.set(marketPath(scope), market);
  await assert.rejects(f.api.saveWisStock(saveInput(initial(), market.revision, '', 'stock-request-capacity')), reason('WIS_STOCK_CAPACITY'));
  assert.equal(f.documents.get(marketPath(scope)).stocks.length, MAX_STOCKS);
});

test('legacy defaults normalize without migration writes; an actual edit atomically installs a server-only seed', async () => {
  const f = fixture(), created = await f.api.saveWisStock(saveInput());
  const raw = f.documents.get(marketPath(scope));
  delete raw.rules; delete raw.priceSeed;
  for (const key of ['issuedShares', 'lotSize', 'tradingStatus', 'growthProfile']) delete raw.stocks[0].settings[key];
  delete raw.stocks[0].priceModel;
  for (const key of ['dayKey', 'dayOpenPrice', 'haltedUntilMs']) delete raw.stocks[0][key];
  const before = JSON.stringify(raw), writes = f.writes.length;
  const read = await f.api.getWisStockManagement(req({}));
  assert.equal(read.rules.buyFeeBps, 100); assert.equal(read.stocks[0].settings.lotSize, 1);
  assert.equal(read.stocks[0].settings.growthProfile, 'HISTORICAL'); assert.equal(read.stocks[0].priceModel, undefined);
  assert.equal((await f.api.saveWisStock(saveInput(initial(), created.revision, created.stocks[0].id, 'legacy-no-op-request'))).changed, false);
  assert.equal(JSON.stringify(f.documents.get(marketPath(scope))), before); assert.equal(f.writes.length, writes);
  const edited = await f.api.saveWisStock(saveInput({ ...initial(), name: '최신 설정' }, created.revision, created.stocks[0].id, 'legacy-new-edit-request'));
  assert.equal(f.writes.length, writes + 2); assert.match(f.documents.get(marketPath(scope)).priceSeed, /^[a-f0-9]{64}$/);
  assert(!JSON.stringify(edited).includes('priceSeed'));
});

test('a pre-rules stock receipt replays the unchanged ten-field payload but rejects added fields and cross-command reuse', async () => {
  const f = fixture(), request = saveInput(), created = await f.api.saveWisStock(request);
  const receipt = [...f.documents.entries()].find(([path]) => path.includes('/wis_stock_receipts/'))[1];
  receipt.settings = initial();
  receipt.payloadHash = createHash('sha256').update(JSON.stringify([scope.semesterId, 0, '', initial()])).digest('hex');
  const before = JSON.stringify([...f.documents]);
  const replay = await f.api.saveWisStock(request);
  assert.equal(replay.duplicate, true); assert.equal(replay.savedStockId, created.stocks[0].id);
  assert.equal(f.writes.length, 2); assert.equal(JSON.stringify([...f.documents]), before);
  await assert.rejects(f.api.saveWisStock(saveInput({ ...initial(), issuedShares: 100000, lotSize: 1, tradingStatus: 'ACTIVE' })), reason('WIS_STOCK_REQUEST_CONFLICT'));
  await assert.rejects(f.api.saveWisStockMarketRules(req({ rules: normalizeWisStockMarketRules({ halted: true }), expectedRevision: 0,
    requestId: request.data.requestId })), reason('WIS_STOCK_REQUEST_CONFLICT'));
  assert.equal(f.writes.length, 2);
});

test('market rule save preserves authority, CAS, receipt idempotency and exact read/write budgets', async () => {
  const f = fixture(), rules = normalizeWisStockMarketRules({ buyFeeBps: 200 });
  const input = req({ rules, expectedRevision: 0, requestId: 'market-rules-request-0001' });
  const saved = await f.api.saveWisStockMarketRules(input);
  assert.equal(saved.rules.buyFeeBps, 200); assert.equal(saved.studentOpen, false);
  assert.equal(f.reads.length, 6); assert.equal(f.writes.length, 2); assert.equal(saved.revision, 1);
  assert.deepEqual(f.sessions[0], { highRisk: true, recentAuth: true });
  const seed = f.documents.get(marketPath(scope)).priceSeed;
  assert.equal((await f.api.saveWisStockMarketRules(input)).duplicate, true);
  assert.equal((await f.api.saveWisStockMarketRules(req({ rules, expectedRevision: 1, requestId: 'market-rules-noop-0001' }))).changed, false);
  assert.equal(f.writes.length, 2); assert.equal(f.documents.get(marketPath(scope)).priceSeed, seed);
  await assert.rejects(f.api.saveWisStockMarketRules(req({ ...input.data, rules: { ...rules, halted: true } })), reason('WIS_STOCK_REQUEST_CONFLICT'));
  await assert.rejects(f.api.saveWisStockMarketRules(req({ rules: { ...rules, halted: true }, expectedRevision: 0, requestId: 'market-rules-stale-001' })), reason('WIS_STOCK_REVISION_CONFLICT'));
  for (const profile of [{ role: 'student', teacherPortalEnabled: true, staffPermissions: ['point_manage'] },
    { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['point_read'] }, { role: 'teacher', disabled: true }]) {
    f.documents.set('users/manager', profile);
    await assert.rejects(f.api.saveWisStockMarketRules(input), reason('WIS_STOCK_TEACHER_REQUIRED'));
  }
  assert.equal(f.writes.length, 2);
  assert(f.writes.every(write => /wis_stock_(markets|receipts)/.test(write.path)));
  assert(f.reads.every(path => !/wis_accounts|wis_ledger|point_wallet|wis_balance/.test(path)));
  assert(!JSON.stringify(saved).includes('priceSeed'));
});

test('global automatic switch, manual halt, stock halt and closed sessions cost zero writes', async () => {
  const f = fixture();
  await f.api.saveWisStock(saveInput({ ...initial(), automatic: true, trendBps: 300, volatilityBps: 0 }));
  const base = structuredClone(f.documents.get(marketPath(scope))), due = base.stocks[0].nextTickAtMs;
  for (const patch of [{ automaticPrices: false }, { halted: true }]) {
    const market = { ...base, rules: { ...base.rules, ...patch } };
    assert.equal(advanceMarket(market, due), market);
  }
  const stockHalt = structuredClone(base); stockHalt.stocks[0].settings.tradingStatus = 'HALTED';
  assert.equal(advanceMarket(stockHalt, due), stockHalt);
  assert.equal(advanceMarket(base, Date.parse('2026-11-21T01:00:00Z')), base);
  assert.equal(advanceMarket(base, Date.parse('2026-11-16T07:00:00Z')), base); // close exclusive
  f.documents.get(marketPath(scope)).rules.halted = true; f.advance(); f.reads.length = 0;
  const writes = f.writes.length; assert.equal((await f.api.advanceWisStockPrices()).changed, false);
  assert.equal(f.reads.length, 2); assert.equal(f.writes.length, writes);
  f.documents.get(marketPath(scope)).rules.halted = false;
  f.advance(6 * 3600000 + TEN_MINUTES); // 16:30 KST
  f.reads.length = 0;
  assert.equal((await f.api.advanceWisStockPrices()).changed, false);
  assert.deepEqual(f.reads, ['site_settings/config', marketPath(scope)]); assert.equal(f.writes.length, writes);
});

test('daily limits anchor to KST opening and circuit trips reject a jump without fabricating a trade/history', async () => {
  const f = fixture();
  await f.api.saveWisStock(saveInput({ ...initial(), automatic: true, trendBps: 300, volatilityBps: 0 }));
  let market = f.documents.get(marketPath(scope)), at = market.stocks[0].nextTickAtMs;
  for (let index = 0; index < 6; index++) { market = advanceMarket(market, at); at += 3600000; }
  assert.equal(market.stocks[0].price, 110); assert.equal(market.stocks[0].dayOpenPrice, 100);
  const nextDay = advanceMarket(market, Date.parse('2026-11-17T00:00:00Z'));
  assert.equal(nextDay.stocks[0].dayOpenPrice, 110); assert.equal(nextDay.stocks[0].price, 113);
  const circuit = { ...nextDay, rules: { ...nextDay.rules, circuitBreakerBps: 200, circuitBreakerMinutes: 120 } };
  const due = nextDay.stocks[0].nextTickAtMs, halted = advanceMarket(circuit, due);
  assert.equal(halted.stocks[0].price, circuit.stocks[0].price);
  assert.deepEqual(halted.stocks[0].history, circuit.stocks[0].history);
  assert.equal(halted.stocks[0].haltedUntilMs, due + 7200000);
  assert.equal(advanceMarket(halted, due), halted);
  assert.equal(advanceMarket(halted, due + 3600000), halted);
  const resumed = advanceMarket(halted, due + 7200000);
  assert.equal(resumed.revision, halted.revision + 1); assert(resumed.stocks[0].price > halted.stocks[0].price);
  assert.equal(resumed.stocks[0].haltedUntilMs, 0); assert.equal(resumed.stocks[0].history.at(-1).atMs, due + 7200000);
  assert.equal(advanceMarket(resumed, due + 7200000), resumed);
});

test('a short circuit breaker expiring inside the slot cannot wake prices twice', async () => {
  const f = fixture(), created = await f.api.saveWisStock(saveInput({ ...initial(), automatic: true,
    volatilityBps: 0, trendBps: 300 }));
  const raw = f.documents.get(marketPath(scope));
  raw.rules = normalizeWisStockMarketRules({ circuitBreakerBps: 200, circuitBreakerMinutes: 1 });
  const due = f.advance(TEN_MINUTES), event = { scheduleTime: new Date(due).toISOString() };
  assert.equal((await f.api.advanceWisStockPrices(event)).changed, true);
  const paused = f.documents.get(marketPath(scope)).stocks[0];
  assert.equal(paused.haltedUntilMs, due + 60_000);
  assert.deepEqual(paused.history, created.stocks[0].history);
  f.advance(60_000); f.reads.length = 0; f.writes.length = 0;
  assert.equal((await f.api.advanceWisStockPrices(event)).changed, false);
  assert.equal(f.reads.length, 2); assert.equal(f.writes.length, 0);
  f.advance(TEN_MINUTES - 60_000);
  assert.equal((await f.api.advanceWisStockPrices()).changed, true);
  assert.deepEqual(f.documents.get(marketPath(scope)).stocks[0].history.at(-1), { atMs: due + TEN_MINUTES, price: 103 });
});

test('rule and issuance failures are closed and cannot open student trading or alter wallet totals', async () => {
  const f = fixture();
  for (const rules of [{ dailyPriceLimitBps: 300, circuitBreakerBps: 700 }, { openMinuteKst: 960, closeMinuteKst: 540 },
    { tradingDays: [1, 1] }, { studentOpen: true }, { buyFeeBps: 1.5 }, { maxOrderAmount: 50000, dailyBuyLimit: 10000 }]) {
    await assert.rejects(f.api.saveWisStockMarketRules(req({ rules, expectedRevision: 0, requestId: 'invalid-rules-request' })), reason('WIS_STOCK_RULES_INVALID'));
  }
  for (const settings of [{ issuedShares: 0 }, { issuedShares: 5, lotSize: 2 }, { tradingStatus: 'OPEN_STUDENTS' }])
    await assert.rejects(f.api.saveWisStock(saveInput({ ...initial(), ...settings })), reason('WIS_STOCK_INPUT_INVALID'));
  assert.equal(f.writes.length, 0);
  assert.equal(typeof f.api.placeOrder, 'undefined');
});

test('emergency stop ignores stale revisions and advances the halt epoch without changing prices or wallet data', async () => {
  const f = fixture(); await f.api.saveWisStock(saveInput());
  const before = structuredClone(f.documents.get(marketPath(scope)));
  f.reads.length = 0; f.writes.length = 0;
  const input = req({ halted: true, expectedRevision: 0, requestId: 'market-emergency-0001' });
  const stopped = await f.api.setWisStockMarketHalted(input);
  assert.equal(stopped.rules.halted, true); assert.equal(stopped.revision, 2); assert.equal(stopped.studentOpen, false);
  assert.equal(f.reads.length, 6); assert.equal(f.writes.length, 2);
  assert.deepEqual(f.sessions.at(-1), { highRisk: true, recentAuth: true });
  const after = f.documents.get(marketPath(scope));
  assert.deepEqual(after, { ...before, rules: { ...before.rules, halted: true }, revision: 2, updatedAtMs: after.updatedAtMs,
    tradingEpoch: 1, publicationRevision: 1, publicationUpdatedAtMs: after.updatedAtMs });
  assert.equal((await f.api.setWisStockMarketHalted(input)).duplicate, true);
  const newStop = await f.api.setWisStockMarketHalted(req({ halted: true, expectedRevision: 0, requestId: 'market-emergency-fence' }));
  assert.equal(newStop.changed, true); assert.equal(newStop.revision, 3);
  assert.equal(f.writes.length, 4);
  assert(f.reads.every(path => !/wis_accounts|wis_ledger|point_wallet|wis_balance/.test(path)));
  assert(f.writes.every(write => /wis_stock_(markets|receipts)/.test(write.path)));
});

test('general rule saves and legacy payloads cannot stop or resume the market', async () => {
  const f = fixture(); const defaults = normalizeWisStockMarketRules();
  assert.equal((await f.api.saveWisStockMarketRules(req({ rules: { ...defaults, halted: true }, expectedRevision: 0, requestId: 'market-rules-stop-001' }))).changed, false);
  assert.equal(f.writes.length, 0);
  await f.api.setWisStockMarketHalted(req({ halted: true, expectedRevision: 0, requestId: 'market-emergency-0001' }));
  await assert.rejects(f.api.saveWisStockMarketRules(req({ rules: { ...defaults, buyFeeBps: 200 }, expectedRevision: 0, requestId: 'market-rules-stale-01' })), reason('WIS_STOCK_REVISION_CONFLICT'));
  const omitted = { ...defaults, buyFeeBps: 200 }; delete omitted.halted;
  const changed = await f.api.saveWisStockMarketRules(req({ rules: omitted, expectedRevision: 1, requestId: 'market-rules-edit-001' }));
  assert.equal(changed.rules.halted, true); assert.equal(changed.rules.buyFeeBps, 200);
  const noop = await f.api.saveWisStockMarketRules(req({ rules: { ...changed.rules, halted: false }, expectedRevision: 2, requestId: 'market-rules-noop-001' }));
  assert.equal(noop.changed, false); assert.equal(noop.rules.halted, true); assert.equal(f.writes.length, 4);
});

test('resume requires the observed revision and receipt replay cannot undo a subsequent stop', async () => {
  const f = fixture();
  await f.api.setWisStockMarketHalted(req({ halted: true, expectedRevision: 0, requestId: 'market-emergency-0001' }));
  await assert.rejects(f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: 0, requestId: 'market-resume-stale01' })), reason('WIS_STOCK_REVISION_CONFLICT'));
  const resume = req({ halted: false, expectedRevision: 1, requestId: 'market-resume-0000001' });
  assert.equal((await f.api.setWisStockMarketHalted(resume)).rules.halted, false);
  await f.api.setWisStockMarketHalted(req({ halted: true, expectedRevision: 0, requestId: 'market-emergency-0002' }));
  const replay = await f.api.setWisStockMarketHalted(resume);
  assert.equal(replay.duplicate, true); assert.equal(replay.rules.halted, true); assert.equal(f.writes.length, 10);
  await assert.rejects(f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: 1, requestId: 'market-resume-stale02' })), reason('WIS_STOCK_REVISION_CONFLICT'));
  const fresh = req({ halted: false, expectedRevision: 3, requestId: 'market-resume-0000002' });
  assert.equal((await f.api.setWisStockMarketHalted(fresh)).rules.halted, false);
  assert.equal((await f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: 4, requestId: 'market-resume-noop001' }))).changed, false);
  assert.equal(f.writes.length, 14);
});

test('a new stop fences an old resume even if the market was already halted', async () => {
  const f = fixture();
  const stopped = await f.api.setWisStockMarketHalted(req({ halted: true, expectedRevision: 0, requestId: 'market-first-stop-001' }));
  const delayedResume = req({ halted: false, expectedRevision: stopped.revision, requestId: 'market-delayed-resume1' });
  const newStop = req({ halted: true, expectedRevision: 0, requestId: 'market-second-stop01' });
  const fenced = await f.api.setWisStockMarketHalted(newStop);
  assert.equal(fenced.rules.halted, true); assert.equal(fenced.revision, stopped.revision + 1);
  assert.equal(f.writes.length, 4);
  await assert.rejects(f.api.setWisStockMarketHalted(delayedResume), reason('WIS_STOCK_REVISION_CONFLICT'));
  const retry = await f.api.setWisStockMarketHalted(newStop);
  assert.equal(retry.duplicate, true); assert.equal(retry.revision, fenced.revision); assert.equal(f.writes.length, 4);
  assert.equal(f.documents.get(marketPath(scope)).rules.halted, true);
});

test('emergency command keeps authority, active scope, receipt isolation and input validation fail-closed', async () => {
  const f = fixture(), input = req({ halted: true, expectedRevision: 0, requestId: 'market-emergency-0001' });
  for (const profile of [{ role: 'student', teacherPortalEnabled: true, staffPermissions: ['point_manage'] },
    { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['point_read'] }, { role: 'teacher', disabled: true }]) {
    f.documents.set('users/manager', profile);
    await assert.rejects(f.api.setWisStockMarketHalted(input), reason('WIS_STOCK_TEACHER_REQUIRED'));
  }
  f.documents.set('users/manager', { role: 'teacher' });
  for (const patch of [{ halted: 1 }, { expectedRevision: -1 }, { studentOpen: true }, { rules: {} }])
    await assert.rejects(f.api.setWisStockMarketHalted(req({ ...input.data, ...patch })), reason('WIS_STOCK_INPUT_INVALID'));
  assert.equal(f.writes.length, 0);
  await f.api.saveWisStock(saveInput(initial(), 0, '', input.data.requestId));
  await assert.rejects(f.api.setWisStockMarketHalted(input), reason('WIS_STOCK_REQUEST_CONFLICT'));
  const stop = req({ ...input.data, requestId: 'market-emergency-0002' });
  await f.api.setWisStockMarketHalted(stop);
  await assert.rejects(f.api.setWisStockMarketHalted(req({ ...stop.data, halted: false })), reason('WIS_STOCK_REQUEST_CONFLICT'));
  f.documents.set('site_settings/semester_active', { semesterId: '2027-1' });
  await assert.rejects(f.api.setWisStockMarketHalted(stop), reason('WIS_STOCK_SCOPE_CHANGED'));
  assert.equal(f.writes.length, 4);
});

test('growth profiles normalize legacy settings without writes, reject invalid values and anchor profile changes once', async () => {
  const f = fixture();
  for (const growthProfile of [null, 'GROWTH', 1, false]) {
    await assert.rejects(f.api.saveWisStock(saveInput({ ...initial(), growthProfile })), reason('WIS_STOCK_INPUT_INVALID'));
  }
  const created = await f.api.saveWisStock(saveInput());
  const id = created.stocks[0].id, original = created.stocks[0].priceModel;
  assert.equal(created.stocks[0].settings.growthProfile, 'HISTORICAL');
  f.advance();
  const value = await f.api.saveWisStock(saveInput({ ...initial(), growthProfile: 'VALUE' }, 1, id, 'value-profile-change-01'));
  assert.equal(value.stocks[0].settings.growthProfile, 'VALUE');
  assert.equal(value.stocks[0].priceModel.anchorPrice, 100);
  assert.equal(value.stocks[0].priceModel.anchorAtMs, original.anchorAtMs + 3600000);
  const writes = f.writes.length;
  assert.equal((await f.api.saveWisStock(saveInput({ ...initial(), growthProfile: 'VALUE' }, 2, id, 'value-profile-noop-0001'))).changed, false);
  assert.equal(f.writes.length, writes); assert.equal(value.studentOpen, false);
});

test('a pre-profile thirteen-field receipt replays unchanged input, but adding a profile is a different request', async () => {
  const f = fixture(), input = saveInput({ ...initial(), issuedShares: 100000, lotSize: 1, tradingStatus: 'ACTIVE' });
  const created = await f.api.saveWisStock(input);
  const receipt = [...f.documents.entries()].find(([path]) => path.includes('/wis_stock_receipts/'))[1];
  delete receipt.settings.growthProfile;
  receipt.payloadHash = createHash('sha256').update(JSON.stringify([scope.semesterId, 0, '', receipt.settings])).digest('hex');
  const before = JSON.stringify([...f.documents]);
  assert.equal((await f.api.saveWisStock(input)).duplicate, true);
  assert.equal(JSON.stringify([...f.documents]), before); assert.equal(f.writes.length, 2);
  await assert.rejects(f.api.saveWisStock(saveInput({ ...input.data.settings, growthProfile: 'HISTORICAL' })), reason('WIS_STOCK_REQUEST_CONFLICT'));
  assert.equal(f.documents.get(marketPath(scope)).stocks[0].id, created.stocks[0].id);
});

test('model anchors persist with the first real tick only; stationary legacy markets have no migration writes', async () => {
  for (const trendBps of [0, 300]) {
    const f = fixture(); await f.api.saveWisStock(saveInput({ ...initial(), automatic: true, volatilityBps: 0, trendBps }));
    const raw = f.documents.get(marketPath(scope)); delete raw.stocks[0].priceModel;
    f.reads.length = 0; f.advance();
    const result = await f.api.advanceWisStockPrices();
    assert.equal(f.reads.length, trendBps ? 4 : 2);
    assert.equal(f.writes.length, trendBps ? 3 : 2);
    assert.equal(result.changed, !!trendBps);
    if (trendBps) assert.equal(f.documents.get(marketPath(scope)).stocks[0].priceModel.anchorPrice, 100);
    else assert.equal(f.documents.get(marketPath(scope)).stocks[0].priceModel, undefined);
  }
});

test('VALUE sustained downward pressure pauses once, resumes at a bounded price and can reach a daily lower limit', () => {
  const rules = normalizeWisStockMarketRules({ circuitBreakerBps: 200, circuitBreakerMinutes: 60 });
  const first = Date.parse('2026-11-16T00:00:00Z'), settings = normalizeSettings({ ...initial(), initialPrice: 10000,
    maximumPrice: 1000000, growthProfile: 'VALUE', automatic: true, volatilityBps: 0, trendBps: -300 });
  let market = { ...blankMarket(scope), rules, revision: 1, priceSeed: 'a'.repeat(64), stocks: [{ id: 'stock_' + 'a'.repeat(24),
    settings, price: 10000, updatedAtMs: first, nextTickAtMs: first + 3600000, dayKey: '2026-11-16', dayOpenPrice: 10000,
    haltedUntilMs: 0, priceModel: { version: 1, anchorAtMs: first, anchorPrice: 10000 }, history: [{ atMs: first, price: 10000 }] }] };
  for (let hour = 1; hour <= 6; hour++) {
    const prior = market, at = first + hour * 3600000;
    market = advanceMarket(market, at);
    assert.equal(market.stocks[0].dayOpenPrice, 10000);
    assert(market.stocks[0].price >= 9000);
    assert.equal(advanceMarket(market, at), market);
    if (hour % 2 === 0) assert(market.stocks[0].price < prior.stocks[0].price);
  }
  const limit = { ...market, rules: { ...rules, circuitBreakerBps: 1000 }, stocks: market.stocks.map(s => ({ ...s, haltedUntilMs: 0 })) };
  const beforeClose = first + 6 * 3600000 + 1800000;
  const limited = advanceMarket({ ...limit, stocks: limit.stocks.map(s => ({ ...s, nextTickAtMs: beforeClose })) }, beforeClose);
  assert.equal(limited.stocks[0].price, 9000);
  const nextDay = advanceMarket(limited, first + 24 * 3600000);
  assert.equal(nextDay.stocks[0].dayOpenPrice, 9000);
  assert.equal(nextDay.stocks[0].history.at(-1).atMs, first + 24 * 3600000);
});

test('saved market limit changes scale scheduled prices without extra I/O or duplicate ticks', async () => {
  const f = fixture();
  await f.api.saveWisStock(saveInput({ ...initial(), initialPrice: 10000, maximumPrice: 1000000, automatic: true }));
  const original = structuredClone(f.documents.get(marketPath(scope)));
  // This existing high-priced stock makes one basis point observable as one Wis.
  const stock = original.stocks[0];
  Object.assign(stock, { price: 10000, dayOpenPrice: 10000 });
  stock.settings.initialPrice = 10000;
  stock.priceModel.anchorPrice = 10000;
  stock.history[0].price = 10000;
  f.advance();
  let rises = 0, falls = 0;
  for (let seed = 0; seed < 24; seed++) {
    const deltas = [];
    for (const limit of [1000, 2000, 6000]) {
      const market = structuredClone(original);
      market.priceSeed = createHash('sha256').update(`market-scale-${seed}`).digest('hex');
      market.rules.dailyPriceLimitBps = limit;
      market.rules.circuitBreakerBps = limit;
      f.documents.set(marketPath(scope), market);
      f.reads.length = 0; f.writes.length = 0;
      await f.api.advanceWisStockPrices();
      const updated = f.documents.get(marketPath(scope));
      assert.equal(f.reads.length, updated.stocks[0].price === 10000 ? 2 : 4);
      assert.equal(f.writes.length, updated.stocks[0].price === 10000 ? 0 : 1);
      assert.equal(updated.stocks[0].haltedUntilMs || 0, 0);
      assert(updated.stocks[0].price >= 10000 - limit && updated.stocks[0].price <= 10000 + limit);
      deltas.push(updated.stocks[0].price - 10000);
      const writes = f.writes.length;
      assert.equal((await f.api.advanceWisStockPrices()).changed, false);
      assert.equal(f.writes.length, writes);
      assert.deepEqual(updated.stocks[0].settings, original.stocks[0].settings);
    }
    if (deltas[0] > 0) rises++;
    if (deltas[0] < 0) falls++;
    assert(Math.abs(deltas[1] - deltas[0] * 2) <= 2);
    assert(Math.abs(deltas[2] - deltas[0] * 6) <= 4);
  }
  assert(rises > 0 && falls > 0);
});

function fullMarket(count, descriptionLength) {
  const settings = normalizeSettings({ ...initial(), name: '가'.repeat(60), description: '가'.repeat(descriptionLength),
    period: '가'.repeat(80), initialPrice: 1000000, maximumPrice: 1000000 });
  return { ...blankMarket(scope), revision: 1, priceSeed: 'f'.repeat(64),
    stocks: Array.from({ length: count }, (_, index) => ({ id: `stock_${index.toString(16).padStart(24, '0')}`, settings,
      price: 1000000, updatedAtMs: Number.MAX_SAFE_INTEGER, nextTickAtMs: Number.MAX_SAFE_INTEGER,
      dayKey: '9999-12-31', dayOpenPrice: 1000000, haltedUntilMs: Number.MAX_SAFE_INTEGER,
      priceModel: { version: 1, anchorAtMs: Number.MAX_SAFE_INTEGER, anchorPrice: 1000000 },
      history: Array.from({ length: HISTORY_LIMIT }, () => ({ atMs: Number.MAX_SAFE_INTEGER, price: 1000000 })) })) };
}
test('100 instrument cap reserves full 120-point histories and enforces Firestore storage size, not only JSON/protobuf size', async () => {
  const { Firestore } = require('@google-cloud/firestore');
  const proto = require('protobufjs').Root.fromJSON(require('@google-cloud/firestore/build/protos/v1.json')).lookupType('google.firestore.v1.Document');
  const db = new Firestore({ projectId: 'demo-wispi-document-size' });
  const worst80 = fullMarket(80, 1000), usual100 = fullMarket(100, 500), tooLarge100 = fullMarket(100, 1000);
  assert.equal(MAX_STOCKS, 100); assert.equal(HISTORY_LIMIT, 120);
  assert(reservedMarketBytes(worst80, scope) < MAX_MARKET_BYTES);
  assert(reservedMarketBytes(usual100, scope) < MAX_MARKET_BYTES);
  assert(reservedMarketBytes(tooLarge100, scope) > 1048576);
  const wire = proto.encode({ name: `projects/demo-wispi-document-size/databases/(default)/documents/${marketPath(scope)}`,
    fields: db._serializer.encodeFields(tooLarge100) }).finish().length;
  assert(wire < 1048576); // A wire-only check would have missed this storage limit.
  const f = fixture();
  f.documents.set(marketPath(scope), fullMarket(100, 1000));
  const edits = { ...tooLarge100.stocks[0].settings, name: '더 긴 내용은 저장하지 않습니다' };
  await assert.rejects(f.api.saveWisStock(saveInput(edits, 1, tooLarge100.stocks[0].id, 'storage-capacity-test')), reason('WIS_STOCK_STORAGE_CAPACITY'));
  assert.equal(f.writes.length, 0);
  f.documents.set(marketPath(scope), fullMarket(99, 500));
  const saved = await f.api.saveWisStock(saveInput(initial(), 1, '', 'hundredth-stock-create'));
  assert.equal(saved.stocks.length, 100); assert.equal(f.reads.length, 12); assert.equal(f.writes.length, 2);
  const trimmed = fullMarket(80, 1000); trimmed.stocks.forEach(s => s.history = s.history.slice(0, 1));
  assert.equal(reservedMarketBytes(trimmed, scope), reservedMarketBytes(worst80, scope));
  console.log(JSON.stringify({ maxStocks: 100, historyLimit: 120, reservedBytes80: reservedMarketBytes(worst80, scope),
    reservedBytes100: reservedMarketBytes(usual100, scope), rejectedWorst100Bytes: reservedMarketBytes(tooLarge100, scope), worst100WireBytes: wire, budgetBytes: MAX_MARKET_BYTES }));
});

test('80 legacy instruments share one ten-minute tick, scope validation and public market write', async () => {
  const f = fixture(), created = await f.api.saveWisStock(saveInput({ ...initial(), automatic: true, volatilityBps: 0, trendBps: 300 }));
  await f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: created.revision, requestId: 'ten-minute-first-open' }));
  const raw = f.documents.get(marketPath(scope));
  const start = raw.stocks[0].updatedAtMs;
  raw.stocks = Array.from({ length: 80 }, (_, index) => {
    const original = structuredClone(created.stocks[0]);
    const intervalHours = [1, 6, 24][index % 3];
    return { ...original, id: `stock_${index.toString(16).padStart(24, '0')}`,
      settings: { ...original.settings, intervalHours }, nextTickAtMs: start + intervalHours * 3600000 };
  });
  f.reads.length = 0; f.writes.length = 0; f.advance(TEN_MINUTES - 1);
  assert.equal((await f.api.advanceWisStockPrices()).changed, false);
  assert.deepEqual(f.reads, ['site_settings/config', marketPath(scope)]); assert.equal(f.writes.length, 0);
  f.advance(1);
  for (const [slot, price] of [[1, 103], [2, 106]]) {
    f.reads.length = 0; f.writes.length = 0;
    assert.equal((await f.api.advanceWisStockPrices()).changed, true);
    assert.deepEqual(f.reads.toSorted(), ['site_settings/config', marketPath(scope), 'site_settings/semester_active',
      'semester_manifests/2026-2'].toSorted());
    assert.deepEqual(f.writes.map(write => write.path).toSorted(), [marketPath(scope), publicStockPath(scope, 'market')].toSorted());
    assert(f.documents.get(marketPath(scope)).stocks.every(stock => stock.price === price && stock.history.length === slot + 1
      && stock.nextTickAtMs === start + (slot + 1) * TEN_MINUTES));
    f.reads.length = 0; f.writes.length = 0;
    assert.equal((await f.api.advanceWisStockPrices()).changed, false);
    assert.deepEqual(f.reads, ['site_settings/config', marketPath(scope)]); assert.equal(f.writes.length, 0);
    f.advance(TEN_MINUTES);
  }
});

test('disjoint daily/instrument bounds and malformed model anchors never write a price', async () => {
  const f = fixture(); await f.api.saveWisStock(saveInput({ ...initial(), automatic: true, trendBps: 300, volatilityBps: 0 }));
  const base = structuredClone(f.documents.get(marketPath(scope))), due = base.stocks[0].nextTickAtMs;
  const crossed = structuredClone(base); crossed.stocks[0].dayOpenPrice = 1; crossed.stocks[0].settings.minimumPrice = 10;
  assert.equal(advanceMarket(crossed, due), crossed);
  for (const priceModel of [null, { version: 2, anchorAtMs: 0, anchorPrice: 100 },
    { version: 1, anchorAtMs: -1, anchorPrice: 100 }, { version: 1, anchorAtMs: 0, anchorPrice: 0 },
    { version: 1, anchorAtMs: 0, anchorPrice: 100, gainGuarantee: true }]) {
    const invalid = structuredClone(base); invalid.stocks[0].priceModel = priceModel;
    f.documents.set(marketPath(scope), invalid);
    await assert.rejects(f.api.getWisStockManagement(req({})), reason('WIS_STOCK_MARKET_INVALID'));
    await assert.rejects(f.api.advanceWisStockPrices(), reason('WIS_STOCK_MARKET_INVALID'));
  }
  assert.equal(f.writes.length, 2);
});

test('first opening atomically publishes safe prices and a permanent launch latch; closing fences orders without hiding the menu', async () => {
  const f = fixture(), currentPath = publicStockPath(scope, 'current'), pricesPath = publicStockPath(scope, 'market');
  assert.equal(publicStockStatus(blankMarket(scope)).halted, true);
  await f.api.saveWisStock(saveInput());
  assert(!f.documents.has(currentPath)); assert(!f.documents.has(pricesPath));
  const open = req({ halted: false, expectedRevision: 1, requestId: 'first-public-open-001' });
  f.reads.length = 0; f.writes.length = 0;
  const opened = await f.api.setWisStockMarketHalted(open);
  assert.equal(opened.studentOpen, true); assert.equal(opened.rules.halted, false); assert.equal(opened.tradingEpoch, 0);
  assert.equal(f.reads.length, 6); assert.equal(f.writes.length, 4);
  assert.deepEqual(f.documents.get(currentPath), { schemaVersion: 1, semesterId: '2026-2', studentOpen: true,
    halted: false, tradingEpoch: 0, revision: 1, updatedAtMs: opened.updatedAtMs });
  assert.equal(f.documents.get(pricesPath).revision, opened.revision);
  assert(!JSON.stringify(f.documents.get(pricesPath)).includes('priceSeed'));
  assert(!JSON.stringify(f.documents.get(pricesPath)).includes('priceModel'));
  assert.equal((await f.api.setWisStockMarketHalted(open)).duplicate, true); assert.equal(f.writes.length, 4);
  const close = req({ halted: true, expectedRevision: 0, requestId: 'first-public-close01' });
  const closed = await f.api.setWisStockMarketHalted(close);
  assert.equal(closed.studentOpen, true); assert.equal(closed.rules.halted, true); assert.equal(closed.tradingEpoch, 1);
  assert.equal(f.documents.get(currentPath).studentOpen, true); assert.equal(f.documents.get(currentPath).halted, true);
  const reopened = await f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: closed.revision, requestId: 'public-market-reopen1' }));
  assert.equal(reopened.tradingEpoch, 1, 'Opening never resurrects an order accepted in an earlier epoch');
  assert.equal(f.documents.get(currentPath).revision, 3);
  const writes = f.writes.length;
  assert.equal((await f.api.setWisStockMarketHalted(close)).duplicate, true);
  assert.equal(f.documents.get(currentPath).halted, false); assert.equal(f.writes.length, writes);
});

test('opened market saves and ticks publish only page prices; the menu signal does not change or incur extra reads', async () => {
  const f = fixture();
  const created = await f.api.saveWisStock(saveInput({ ...initial(), automatic: true, volatilityBps: 0, trendBps: 300 }));
  const opened = await f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: created.revision, requestId: 'public-prices-open01' }));
  const signal = structuredClone(f.documents.get(publicStockPath(scope, 'current')));
  f.reads.length = 0; f.writes.length = 0; f.advance();
  assert.equal((await f.api.advanceWisStockPrices()).changed, true);
  assert.equal(f.reads.length, 4); assert.equal(f.writes.length, 2);
  assert.equal(f.documents.get(publicStockPath(scope, 'market')).stocks[0].price, 103);
  assert.deepEqual(f.documents.get(publicStockPath(scope, 'current')), signal);
  assert(!f.writes.some(write => write.path === publicStockPath(scope, 'current')));
  const before = f.writes.length;
  assert.equal((await f.api.advanceWisStockPrices()).changed, false); assert.equal(f.writes.length, before);
  const market = f.documents.get(marketPath(scope));
  f.reads.length = 0; f.writes.length = 0;
  const saved = await f.api.saveWisStock(saveInput({ ...opened.stocks[0].settings, name: '공개 이름 변경' }, market.revision, market.stocks[0].id, 'public-prices-edit01'));
  assert.equal(f.reads.length, 6); assert.equal(f.writes.length, 3); assert.equal(saved.studentOpen, true);
  assert.equal(f.documents.get(publicStockPath(scope, 'market')).stocks[0].settings.name, '공개 이름 변경');
  assert.deepEqual(f.documents.get(publicStockPath(scope, 'current')), signal);
  f.reads.length = 0; f.writes.length = 0;
  const rules = await f.api.saveWisStockMarketRules(req({ rules: { ...saved.rules, buyFeeBps: 200, halted: true }, expectedRevision: saved.revision, requestId: 'public-rules-edit001' }));
  assert.equal(rules.studentOpen, true); assert.equal(rules.rules.halted, false);
  assert.equal(f.reads.length, 6); assert.equal(f.writes.length, 3);
  assert.equal(f.documents.get(publicStockPath(scope, 'market')).rules.buyFeeBps, 200);
  assert.deepEqual(f.documents.get(publicStockPath(scope, 'current')), signal);
});

test('first open creates a private seed for a seedless market and strict public projection strips nested private fields', async () => {
  const f = fixture(); const created = await f.api.saveWisStock(saveInput());
  const raw = f.documents.get(marketPath(scope)); delete raw.priceSeed;
  raw.stocks[0].privateNote = 'never-publish'; raw.stocks[0].history[0].privateNote = 'never-publish';
  const opened = await f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: created.revision, requestId: 'seedless-first-open01' }));
  assert.match(f.documents.get(marketPath(scope)).priceSeed, /^[a-f0-9]{64}$/);
  const published = f.documents.get(publicStockPath(scope, 'market'));
  assert(!JSON.stringify(published).includes('never-publish')); assert(!JSON.stringify(published).includes('priceSeed'));
  assert.deepEqual(Object.keys(published.stocks[0].settings).sort(), ['name', 'description', 'period', 'issuedShares', 'lotSize', 'tradingStatus'].sort());
  for (const field of ['growthProfile', 'volatilityBps', 'trendBps', 'automatic', 'intervalHours', 'initialPrice', 'minimumPrice', 'maximumPrice'])
    assert.equal(published.stocks[0].settings[field], undefined);
  assert.deepEqual(Object.keys(published).sort(), ['schemaVersion', 'semesterId', 'studentOpen', 'tradingEpoch', 'revision', 'updatedAtMs', 'rules', 'stocks'].sort());
  assert.equal(opened.studentOpen, true);
});

test('issuance and lot size are immutable after first opening, including while stopped; unrelated edits remain possible', async () => {
  const f = fixture(); const created = await f.api.saveWisStock(saveInput());
  const opened = await f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: created.revision, requestId: 'issuance-first-open01' }));
  for (const patch of [{ issuedShares: 200000 }, { lotSize: 2 }]) {
    const writes = f.writes.length;
    await assert.rejects(f.api.saveWisStock(saveInput({ ...opened.stocks[0].settings, ...patch }, opened.revision, opened.stocks[0].id, 'issuance-invalid-0001')), reason('WIS_STOCK_SUPPLY_LOCKED'));
    assert.equal(f.writes.length, writes);
  }
  const stopped = await f.api.setWisStockMarketHalted(req({ halted: true, expectedRevision: 0, requestId: 'issuance-market-stop1' }));
  await assert.rejects(f.api.saveWisStock(saveInput({ ...opened.stocks[0].settings, issuedShares: 200000 }, stopped.revision, opened.stocks[0].id, 'issuance-invalid-0002')), reason('WIS_STOCK_SUPPLY_LOCKED'));
  const saved = await f.api.saveWisStock(saveInput({ ...opened.stocks[0].settings, description: '설명만 변경' }, stopped.revision, opened.stocks[0].id, 'issuance-safe-edit01'));
  assert.equal(saved.studentOpen, true); assert.equal(saved.rules.halted, true);
});

test('dedicated WisPI interface guard is independent of other menus and never implies market opening', () => {
  const { assertStudentWispiMenuVisible } = require('../studentMenuVisibility');
  assert.doesNotThrow(() => assertStudentWispiMenuVisible({ studentMenuVisibility: { wispi: true, mypage: false, avatar_shop: false } }));
  assert.doesNotThrow(() => assertStudentWispiMenuVisible({}));
  for (const value of [false, 1, 'true', null]) assert.throws(() => assertStudentWispiMenuVisible({ studentMenuVisibility: { wispi: value } }), reason('STUDENT_MENU_HIDDEN'));
  for (const studentMenuVisibility of [null, [], false]) assert.throws(() => assertStudentWispiMenuVisible({ studentMenuVisibility }), reason('STUDENT_MENU_HIDDEN'));
});

const catalogStart = Date.parse('2026-11-16T09:00:00+09:00');
const catalogCommand = (expectedRevision, requestId = 'catalog-activation-0001', startsAtMs = catalogStart) =>
  req({ expectedRevision, requestId, startsAtMs });

test('catalog activation lists only due stocks with six reads and three atomic writes; replay and unchanged plan write zero', async () => {
  const f = fixture();
  const opened = await f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: 0, requestId: 'catalog-open-market01' }));
  const input = catalogCommand(opened.revision), signal = structuredClone(f.documents.get(publicStockPath(scope, 'current')));
  f.reads.length = 0; f.writes.length = 0;
  const activated = await f.api.activateWisStockCatalogPlan(input);
  assert.equal(activated.stocks.length, 11); assert.equal(activated.revision, opened.revision + 1);
  assert.equal(f.reads.length, 6); assert.equal(f.writes.length, 3);
  assert.equal(activated.catalogSchedule.pendingCount, 69);
  assert.equal(activated.catalogSchedule.nextListingAtMs, catalogStart + 3600000);
  assert(activated.stocks.every(stock => stock.history.length === 1 && stock.history[0].atMs === catalogStart));
  assert.deepEqual(f.documents.get(publicStockPath(scope, 'current')), signal);
  const publicMarket = f.documents.get(publicStockPath(scope, 'market'));
  assert.equal(publicMarket.stocks.length, 11); assert.equal(publicMarket.catalogPlan, undefined);
  assert.equal(publicMarket.catalogSchedule, undefined); assert.equal(publicMarket.priceSeed, undefined);
  f.reads.length = 0;
  assert.equal((await f.api.activateWisStockCatalogPlan(input)).duplicate, true);
  assert.equal(f.reads.length, 6); assert.equal(f.writes.length, 3);
  assert.equal((await f.api.activateWisStockCatalogPlan(catalogCommand(activated.revision, 'catalog-fresh-noop001'))).changed, false);
  assert.equal(f.writes.length, 3);
  await assert.rejects(f.api.activateWisStockCatalogPlan(catalogCommand(activated.revision, input.data.requestId, catalogStart + 7 * 86400000)), reason('WIS_STOCK_REQUEST_CONFLICT'));
  await assert.rejects(f.api.activateWisStockCatalogPlan(catalogCommand(activated.revision, 'catalog-plan-locked01', catalogStart + 7 * 86400000)), reason('WIS_STOCK_CATALOG_PLAN_LOCKED'));
  assert.equal(f.writes.length, 3);
});

test('catalog activation preserves teacher permission, session, revision and active-semester boundaries', async () => {
  const f = fixture();
  await assert.rejects(f.api.activateWisStockCatalogPlan(catalogCommand(1)), reason('WIS_STOCK_REVISION_CONFLICT'));
  for (const startsAtMs of [catalogStart + 1, catalogStart + 3600000, catalogStart + 86400000, '2026-11-16']) {
    await assert.rejects(f.api.activateWisStockCatalogPlan(catalogCommand(0, 'catalog-invalid-time1', startsAtMs)), reason('WIS_STOCK_CATALOG_PLAN_INVALID'));
  }
  await assert.rejects(f.api.activateWisStockCatalogPlan(catalogCommand(0, 'catalog-other-year01', Date.parse('2027-01-04T09:00:00+09:00'))), reason('WIS_STOCK_INPUT_INVALID'));
  const initialProfile = structuredClone(f.documents.get('users/manager'));
  for (const profile of [{ role: 'student', teacherPortalEnabled: true, staffPermissions: ['point_manage'] },
    { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['point_read'] }, { role: 'teacher', disabled: true }]) {
    f.documents.set('users/manager', profile);
    await assert.rejects(f.api.activateWisStockCatalogPlan(catalogCommand(0)), reason('WIS_STOCK_TEACHER_REQUIRED'));
  }
  f.documents.set('users/manager', initialProfile);
  await assert.rejects(f.api.activateWisStockCatalogPlan(req({ ...catalogCommand(0).data, semester: '1' })), reason('WIS_STOCK_SCOPE_CHANGED'));
  f.documents.set('site_settings/semester_active', { semesterId: '2027-1' });
  await assert.rejects(f.api.activateWisStockCatalogPlan(catalogCommand(0)), reason('WIS_STOCK_SCOPE_CHANGED'));
  assert.equal(f.writes.length, 0);
  const failure = new Error('session rejected');
  const denied = createWisStockHandlers({ db: { runTransaction: () => assert.fail('Session denial must precede I/O') },
    assertSession: async (_request, options) => { assert.deepEqual(options, { highRisk: true, recentAuth: true }); throw failure; } });
  await assert.rejects(denied.activateWisStockCatalogPlan(catalogCommand(0)), failure);
});

test('catalog scheduler registers the next due stock once with four reads and three writes while preserving the menu signal', async () => {
  const f = fixture();
  const opened = await f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: 0, requestId: 'catalog-tick-open001' }));
  const activated = await f.api.activateWisStockCatalogPlan(catalogCommand(opened.revision));
  const signal = structuredClone(f.documents.get(publicStockPath(scope, 'current')));
  f.reads.length = 0; f.writes.length = 0; f.advance();
  assert.equal((await f.api.advanceWisStockPrices()).changed, true);
  assert.equal(f.reads.length, 4); assert.equal(f.writes.length, 3);
  const actual = f.documents.get(marketPath(scope));
  assert.equal(actual.stocks.length, 12); assert.equal(actual.revision, activated.revision + 1);
  assert.equal(f.documents.get(publicStockPath(scope, 'market')).stocks.length, 12);
  assert.deepEqual(f.documents.get(publicStockPath(scope, 'current')), signal);
  const added = actual.stocks.find(stock => !activated.stocks.some(old => old.id === stock.id));
  assert.deepEqual(added.history, [{ atMs: catalogStart + 3600000, price: added.settings.initialPrice }]);
  assert(f.writes.some(write => write.data.commandType === 'applyWisStockCatalogListings'));
  for (let retry = 0; retry < 8; retry++) assert.equal((await f.api.advanceWisStockPrices()).changed, false);
  assert.equal(f.writes.length, 3);
  assert(f.reads.every(path => !/wis_accounts|wis_ledger|point_wallet|wis_balance/.test(path)));
});

test('activation and reopening preserve manually registered template settings and defer private or halted markets', async () => {
  const catalog = require('../wisStockCatalog.json');
  const f = fixture(), created = await f.api.saveWisStock(saveInput({ ...initial(), name: catalog[0].name }));
  const manual = structuredClone(created.stocks[0]);
  const planned = await f.api.activateWisStockCatalogPlan(catalogCommand(created.revision));
  assert.equal(planned.studentOpen, false); assert.equal(planned.stocks.length, 1);
  const writes = f.writes.length;
  assert.equal((await f.api.advanceWisStockPrices()).changed, false); assert.equal(f.writes.length, writes);
  const opened = await f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: planned.revision, requestId: 'catalog-due-open-001' }));
  assert.equal(opened.stocks.length, 11);
  assert.deepEqual(opened.stocks.find(stock => stock.id === manual.id), manual);
  assert.equal(opened.stocks.filter(stock => stock.settings.name === manual.settings.name).length, 1);
  const stopped = await f.api.setWisStockMarketHalted(req({ halted: true, expectedRevision: 0, requestId: 'catalog-due-stop-001' }));
  f.advance(); const stopWrites = f.writes.length;
  assert.equal((await f.api.advanceWisStockPrices()).changed, false); assert.equal(f.writes.length, stopWrites);
  const resumed = await f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: stopped.revision, requestId: 'catalog-due-resume01' }));
  assert.equal(resumed.stocks.length, 12);
  assert.equal(f.documents.get(publicStockPath(scope, 'market')).stocks.length, 12);
});

test('catalog activation reserves future count and subsequent manual registrations cannot consume reserved slots', async () => {
  const f = fixture(), created = await f.api.saveWisStock(saveInput());
  const original = structuredClone(f.documents.get(marketPath(scope)));
  const stocks = Array.from({ length: 21 }, (_, index) => ({ ...structuredClone(created.stocks[0]),
    id: `stock_${index.toString(16).padStart(24, '0')}`, settings: { ...created.stocks[0].settings, name: `개별 종목 ${index}` } }));
  f.documents.set(marketPath(scope), { ...original, stocks });
  f.writes.length = 0;
  await assert.rejects(f.api.activateWisStockCatalogPlan(catalogCommand(created.revision)), reason('WIS_STOCK_CAPACITY'));
  assert.equal(f.writes.length, 0); assert.equal(f.documents.get(marketPath(scope)).catalogPlan, undefined);
  f.documents.set(marketPath(scope), { ...original, stocks: stocks.slice(0, 20) });
  const planned = await f.api.activateWisStockCatalogPlan(catalogCommand(created.revision));
  assert.equal(planned.stocks.length, 20, 'Private market must reserve but not publish future stocks');
  const before = f.writes.length;
  await assert.rejects(f.api.saveWisStock(saveInput({ ...initial(), name: '예약 한도 초과 종목' }, planned.revision, '', 'catalog-reservation21')), reason('WIS_STOCK_CAPACITY'));
  assert.equal(f.writes.length, before);
});
