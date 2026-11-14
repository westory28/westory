const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createWisStockHandlers, marketPath, HISTORY_LIMIT, MAX_STOCKS, advanceMarket } = require('../wisStocks');
const scope = { year: '2026', semester: '2', semesterId: '2026-2' };
const initial = () => ({ name: '합성 역사 종목', description: '시험용 배경', period: '시험 시대', initialPrice: 100, minimumPrice: 1,
  maximumPrice: 10000, volatilityBps: 300, trendBps: 0, intervalHours: 1, automatic: false });
const req = data => ({ auth: { uid: 'manager', token: { email: 'manager@yongshin-ms.ms.kr' } }, data: { year: scope.year, semester: scope.semester, ...data } });
const saveInput = (settings = initial(), expectedRevision = 0, stockId = '', requestId = 'stock-request-00000001') => req({ settings, expectedRevision, stockId, requestId });
const reason = value => error => error.details?.reason === value;
function fixture() {
  let clock = 1794643200000;
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
  for (let i = 0; i < 300; i++) { market = advanceMarket(market, at); at += 3600000; }
  assert.equal(market.stocks[0].history.length, HISTORY_LIMIT);
  assert.equal(JSON.stringify(advanceMarket(market, at)), JSON.stringify(advanceMarket(market, at)));
  assert(market.stocks[0].history.every(point => Number.isSafeInteger(point.price) && point.price >= 1 && point.price <= 10000));
  market.stocks = Array.from({ length: MAX_STOCKS }, (_, index) => ({ ...created.stocks[0], id: `stock_${index.toString(16).padStart(24, '0')}` }));
  f.documents.set(marketPath(scope), market);
  await assert.rejects(f.api.saveWisStock(saveInput(initial(), market.revision, '', 'stock-request-capacity')), reason('WIS_STOCK_CAPACITY'));
  assert.equal(f.documents.get(marketPath(scope)).stocks.length, MAX_STOCKS);
});
