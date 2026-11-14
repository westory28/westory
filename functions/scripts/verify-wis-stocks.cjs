const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { createWisStockHandlers, marketPath, HISTORY_LIMIT, MAX_STOCKS, MAX_MARKET_BYTES, reservedMarketBytes, normalizeSettings, advanceMarket, blankMarket } = require('../wisStocks');
const { normalizeWisStockMarketRules } = require('../wisStockMarketRules');
const scope = { year: '2026', semester: '2', semesterId: '2026-2' };
const initial = () => ({ name: '합성 역사 종목', description: '시험용 배경', period: '시험 시대', initialPrice: 100, minimumPrice: 1,
  maximumPrice: 10000, volatilityBps: 300, trendBps: 0, intervalHours: 1, automatic: false });
const req = data => ({ auth: { uid: 'manager', token: { email: 'manager@yongshin-ms.ms.kr' } }, data: { year: scope.year, semester: scope.semester, ...data } });
const saveInput = (settings = initial(), expectedRevision = 0, stockId = '', requestId = 'stock-request-00000001') => req({ settings, expectedRevision, stockId, requestId });
const reason = value => error => error.details?.reason === value;
function fixture() {
  let clock = Date.parse('2026-11-16T00:00:00Z'); // Monday 09:00 KST.
  const documents = new Map([
    ['users/manager', { role: 'teacher', teacherPortalEnabled: true, staffPermissions: ['point_manage'] }],
    ['site_settings/config', { year: '2026', semester: '2' }], ['site_settings/semester_active', { semesterId: '2026-2' }],
    ['semester_manifests/2026-2', { status: 'ACTIVE' }],
  ]);
  const reads = [], writes = [], sessions = [];
  const db = { doc: path => ({ path }), runTransaction: async callback => {
    const changes = [];
    const result = await callback({
      get: async ref => { reads.push(ref.path); return { exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) }; },
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
    changes.forEach(change => { documents.set(change.path, change.data); writes.push(change); });
    return result;
  } };
  const api = createWisStockHandlers({ db, assertSession: async (request, options) => { sessions.push(options); return { uid: request.auth?.uid, email: request.auth?.token?.email }; }, now: () => clock });
  return { api, documents, reads, writes, sessions, advance: (ms = 3600000) => clock += ms };
}
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
test('invalid and public/trading payloads are rejected, prices stay integer and bounded', async () => {
  const f = fixture();
  for (const patch of [{ initialPrice: 0 }, { initialPrice: 1.5 }, { volatilityBps: 1001 }, { trendBps: -301 },
    { maximumPrice: 99 }, { intervalHours: 2 }, { name: ' ' }, { studentOpen: true }, { automatic: 'true' }]) {
    await assert.rejects(f.api.saveWisStock(saveInput({ ...initial(), ...patch })), reason('WIS_STOCK_INPUT_INVALID'));
  }
  await assert.rejects(f.api.saveWisStock({ ...saveInput(), data: { ...saveInput().data, studentOpen: true } }), reason('WIS_STOCK_INPUT_INVALID'));
  assert.equal(f.writes.length, 0);
});
test('automatic prices advance once per interval and preserve historical prices; unchanged and paused markets never write', async () => {
  const f = fixture(), settings = { ...initial(), volatilityBps: 0, trendBps: 300, automatic: true, maximumPrice: 110 };
  await f.api.saveWisStock(saveInput(settings));
  f.reads.length = 0;
  assert.equal((await f.api.advanceWisStockPrices()).changed, false); assert.equal(f.reads.length, 4); assert.equal(f.writes.length, 2);
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
  assert.equal(f.reads.length, 4); assert.equal(f.writes.length, writes);
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

test('emergency stop ignores stale revisions and changes only the halt flag, revision and audit metadata', async () => {
  const f = fixture(); await f.api.saveWisStock(saveInput());
  const before = structuredClone(f.documents.get(marketPath(scope)));
  f.reads.length = 0; f.writes.length = 0;
  const input = req({ halted: true, expectedRevision: 0, requestId: 'market-emergency-0001' });
  const stopped = await f.api.setWisStockMarketHalted(input);
  assert.equal(stopped.rules.halted, true); assert.equal(stopped.revision, 2); assert.equal(stopped.studentOpen, false);
  assert.equal(f.reads.length, 6); assert.equal(f.writes.length, 2);
  assert.deepEqual(f.sessions.at(-1), { highRisk: true, recentAuth: true });
  const after = f.documents.get(marketPath(scope));
  assert.deepEqual(after, { ...before, rules: { ...before.rules, halted: true }, revision: 2, updatedAtMs: after.updatedAtMs });
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
  assert.equal(replay.duplicate, true); assert.equal(replay.rules.halted, true); assert.equal(f.writes.length, 6);
  await assert.rejects(f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: 1, requestId: 'market-resume-stale02' })), reason('WIS_STOCK_REVISION_CONFLICT'));
  const fresh = req({ halted: false, expectedRevision: 3, requestId: 'market-resume-0000002' });
  assert.equal((await f.api.setWisStockMarketHalted(fresh)).rules.halted, false);
  assert.equal((await f.api.setWisStockMarketHalted(req({ halted: false, expectedRevision: 4, requestId: 'market-resume-noop001' }))).changed, false);
  assert.equal(f.writes.length, 8);
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
    assert.equal(f.reads.length, 4);
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

test('80 active instruments still use four reads and at most one market write per scheduled run', async () => {
  const f = fixture(), created = await f.api.saveWisStock(saveInput({ ...initial(), automatic: true, volatilityBps: 0, trendBps: 300 }));
  const raw = f.documents.get(marketPath(scope));
  raw.stocks = Array.from({ length: 80 }, (_, index) => ({ ...structuredClone(created.stocks[0]), id: `stock_${index.toString(16).padStart(24, '0')}` }));
  f.reads.length = 0; f.writes.length = 0; f.advance();
  const result = await f.api.advanceWisStockPrices();
  assert.equal(result.changed, true); assert.equal(f.reads.length, 4); assert.equal(f.writes.length, 1);
  assert(f.documents.get(marketPath(scope)).stocks.every(s => s.price === 103));
  f.reads.length = 0;
  assert.equal((await f.api.advanceWisStockPrices()).changed, false);
  assert.equal(f.reads.length, 4); assert.equal(f.writes.length, 1);
  assert(f.reads.every(path => !/wis_accounts|wis_ledger|point_wallet|wis_balance/.test(path)));
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
