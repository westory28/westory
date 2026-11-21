const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { createWisStockDailyRanking, previousRankingTime } = require('../wisStockDailyRanking');
const { accountIdFor } = require('../studentWisWallet');
const { blankMarket, normalizeSettings } = require('../wisStocks');
const { buildWisStockInvestmentBoard } = require('../wisStockInvestmentBoard');

const now = Date.parse('2026-11-21T09:10:00+09:00');
const cutoff = Date.parse('2026-11-20T23:59:00+09:00');
const scope = { year: '2026', semester: '2', semesterId: '2026-2' };
const root = 'years/2026/semesters/2', head = root + '/wis_stock_student_rankings/current';
const stockId = 'stock_' + '1'.repeat(24);
const hash = value => createHash('sha256').update(value).digest('hex');
const slotOf = uid => 'slot_' + hash(scope.semesterId + '\n' + uid).slice(0, 40);
const snapshot = (path, value) => ({ id: path.split('/').at(-1), exists: value !== undefined, data: () => structuredClone(value) });

function fixture({ stale = false } = {}) {
  let clock = now;
  const config = { year: scope.year, semester: scope.semester };
  const active = { semesterId: scope.semesterId, revision: 1 };
  const current = { 'site_settings/config': config, 'site_settings/semester_active': active,
    'semester_manifests/2026-2': { ...active, status: 'ACTIVE' }, 'users/viewer': { role: 'student' },
    'student_identities/viewer': { studentUid: 'viewer' },
    ['semester_enrollment_slots/' + slotOf('viewer')]: { studentUid: 'viewer', semesterId: scope.semesterId, activeEnrollmentId: 'enr' },
    'semester_enrollments/enr': { enrollmentId: 'enr', semesterId: scope.semesterId, studentUid: 'viewer', enrollmentStatus: 'ACTIVE', classId: 'class' },
    'semester_classes/class': { classId: 'class', semesterId: scope.semesterId, status: 'ACTIVE' },
    [root + '/wis_stock_public/current']: { semesterId: scope.semesterId, studentOpen: true, halted: false } };
  const history = structuredClone(current), marketPath = root + '/wis_stock_markets/current';
  history[marketPath] = { ...blankMarket(scope), revision: 2, updatedAtMs: cutoff - 1000, stocks: [{ id: stockId, price: 120,
    settings: normalizeSettings({ name: '전날 종목', description: '', period: '', initialPrice: 100, minimumPrice: 1,
      maximumPrice: 1000, volatilityBps: 100, trendBps: 0, intervalHours: 1, automatic: true }), updatedAtMs: cutoff - 1000,
    nextTickAtMs: cutoff + 1000, history: [{ atMs: cutoff - 4_000_000, price: 100 }, { atMs: cutoff - 1000, price: 120 }] }] };
  const rows = [];
  for (let i = 1; i <= 7; i++) {
    const studentUid = 'synthetic_' + i, studentKey = 'student_' + hash(studentUid).slice(0, 24);
    const accountId = accountIdFor(scope.semesterId, studentUid), enrollmentId = 'enrollment_' + i;
    const cost = i === 2 ? 101 : 99 + i;
    const holding = i < 7, positions = holding ? { [stockId]: { quantity: 2, costBasis: cost * 2, reservedSellQuantity: 1 } } : {};
    history[root + '/wis_stock_accounts/' + accountId] = { schemaVersion: 1, accountId, semesterId: scope.semesterId, revision: 1,
      studentKey, studentUid, enrollmentId, positions };
    if (holding) history[root + '/wis_stock_history/fill_' + i] = { semesterId: scope.semesterId, accountId, studentUid, sequence: 1,
      atMs: cutoff - 3_900_000, kind: 'ORDER_FILLED', stockId, side: 'BUY', fee: 0, quantity: 2, unitPrice: cost,
      stockCashDelta: -2 * cost, realizedPnl: 0 };
    rows.push({ studentKey, displayName: '검증학생' + i, grade: '3', classNumber: '1', studentNumber: String(i), holdingCount: holding ? 1 : 0,
      stockCash: 0, reservedCash: 0, holdingValue: holding ? (stale && i !== 6 ? 120 : 240) : 0,
      holdingCostBasis: holding ? cost * 2 : 0, realizedPnl: 0 });
    current['semester_enrollment_slots/' + slotOf(studentUid)] = { semesterId: scope.semesterId, activeEnrollmentId: enrollmentId };
  }
  history[root + '/wis_stock_investment_boards/all'] = buildWisStockInvestmentBoard({ scope, asOfMs: cutoff - 100,
    revision: 1, sourceRevision: 1, priceRevision: stale ? 1 : 2, rows, classes: [{ grade: '3', classNumber: '1' }] });
  current[marketPath] = { privateCurrentMarker: '오늘 시세' };
  const accesses = [], writes = [], queries = [];
  const doc = path => ({ path, collection: id => ({ doc: child => doc(path + '/' + id + '/' + child) }),
    get: async () => { accesses.push(['current', path]); return snapshot(path, current[path]); } });
  class Query {
    constructor(path) { this.path = path; this.filters = []; }
    where(field, op, value) { this.filters.push({ field, op, value }); return this; }
    select(...fields) { this.fields = fields; return this; }
  }
  const db = { doc, collection: path => new Query(path), runTransaction: async (fn, opts) => {
    const historic = Boolean(opts?.readTime);
    if (historic) { assert.equal(opts.readOnly, true); assert.equal(opts.readTime.toMillis(), cutoff); }
    const docs = historic ? history : current, stage = [], kind = historic ? 'historical' : 'current';
    const read = async ref => {
      if (!(ref instanceof Query)) { accesses.push([kind, ref.path]); return snapshot(ref.path, docs[ref.path]); }
      assert(historic); assert(ref.fields.length > 0); queries.push(ref);
      const result = Object.entries(docs).filter(([path, entry]) => path.startsWith(ref.path + '/')
        && ref.filters.every(({ field, op, value }) => op === 'in' ? value.includes(entry[field]) : op === '==' && entry[field] === value))
        .map(([path, entry]) => { accesses.push([kind, path]); return snapshot(path, entry); });
      return { docs: result, size: result.length };
    };
    const value = await fn({ get: read, getAll: (...refs) => Promise.all(refs.filter(r => !r.fieldMask).map(read)),
      set: (ref, data) => stage.push([ref.path, structuredClone(data)]), delete: ref => stage.push([ref.path, undefined]) });
    for (const [path, data] of stage) { assert(!opts?.readOnly); writes.push(path); if (data) current[path] = data; else delete current[path]; }
    return value;
  } };
  const api = createWisStockDailyRanking({ db, now: () => clock, assertSession: async req => {
    if (req.data._session?.revision !== 'trusted') throw Error('invalid session');
    return { uid: 'viewer' };
  } });
  const read = extra => api.getStudentWisStockRanking({ auth: { uid: 'viewer' },
    data: { year: scope.year, semester: scope.semester, _session: { revision: 'trusted' }, ...extra } });
  return { api, read, current, history, accesses, writes, queries, advance: ms => { clock += ms; } };
}

test('previous KST whole-minute snapshot covers midnight, weekends and month/year rollover', () => {
  for (const [at, day] of [['2026-11-21T00:00:00+09:00', '2026-11-20'], ['2027-01-01T23:59:59+09:00', '2026-12-31']]) {
    assert.deepEqual(previousRankingTime(Date.parse(at)), { dayKey: day, asOfMs: Date.parse(day + 'T23:59:00+09:00') });
  }
});
for (const stale of [false, true]) test('publish only previous holdings and prices, asynchronous quote lag ' + stale, async () => {
  const f = fixture({ stale });
  assert.equal((await f.read()).status, 'NOT_READY');
  assert.deepEqual(await f.api.publishWisStockDailyRanking(), { changed: true, students: 5 });
  assert.equal(f.writes.length, 6);
  const expectedAccounts = stale ? 6 : 5;
  assert.equal(f.accesses.filter(([kind, path]) => kind === 'historical' && path.includes('/wis_stock_accounts/')).length, expectedAccounts);
  assert.equal(f.queries.filter(q => q.path.endsWith('/wis_stock_history')).length, 5);
  assert.deepEqual(await f.api.publishWisStockDailyRanking(), { changed: false });
  const before = f.accesses.length;
  const list = await f.read();
  assert.equal(f.accesses.length - before, 15, 'viewer scope, list and five active enrollment slots');
  assert.deepEqual(list.rows.map(r => r.displayName), [1, 2, 3, 4, 5].map(i => '검증학생' + i));
  assert.equal(list.rows[0].returnPercent, 20); assert.equal(list.asOfMs, cutoff);
  assert.deepEqual(Object.keys(list.rows[0]).sort(), ['displayName', 'rank', 'returnPercent']);
  const start = f.accesses.length, detail = await f.read({ rank: 1, dayKey: list.dayKey });
  assert.equal(f.accesses.length - start, 12, 'one selected detail and one selected slot');
  assert.deepEqual(detail.holdings, [{ name: '전날 종목', quantity: 2 }]);
  assert.equal(detail.points.at(-1).returnPercent, 20); assert(detail.points.every(p => p.atMs <= cutoff));
  assert(!JSON.stringify([list, detail]).includes('wisacct_'));
  assert(!f.accesses.slice(before).some(([kind, path]) => kind === 'historical' || /wis_stock_(markets|history|accounts|investment_boards)\//.test(path)));
  assert.equal(f.writes.length, 6);
  f.current['semester_enrollment_slots/' + slotOf('synthetic_1')].status = 'RETIRED';
  assert.deepEqual((await f.read()).rows.map(r => r.rank), [2, 3, 4, 5]); await assert.rejects(f.read({ rank: 1, dayKey: list.dayKey }));
  await assert.rejects(f.read({ rank: 6, dayKey: list.dayKey }));
  await assert.rejects(f.read({ studentKey: 'synthetic_6' }));
  await assert.rejects(f.read({ dayKey: '2026-11-21', rank: 1 }));
  f.advance(86_400_000); assert.equal((await f.read()).status, 'NOT_READY');
  await assert.rejects(f.read({ rank: 2, dayKey: list.dayKey }));
});
test('current school, enrollment, market, menu, proof and active profile protect both projections', async () => {
  for (const [path, patch] of [['users/viewer', { role: 'teacher' }], ['users/viewer', { registrationApprovalStatus: 'PENDING' }],
    ['users/viewer', { disabled: true }], ['student_identities/viewer', { accountStatus: 'RETIRED' }],
    ['semester_enrollments/enr', { readOnly: true }], ['semester_classes/class', { status: 'RETIRED' }],
    ['site_settings/config', { studentMenuVisibility: { wispi: false } }], ['site_settings/semester_active', { revision: 2 }],
    [root + '/wis_stock_public/current', { studentOpen: false }], [root + '/wis_stock_public/current', { halted: true }]]) {
    const f = fixture(); Object.assign(f.current[path], patch);
    for (const extra of [{}, { dayKey: '2026-11-20', rank: 1 }]) await assert.rejects(f.read(extra), error => error.code === 'permission-denied');
    assert.equal(f.queries.length, 0); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); await assert.rejects(f.read({ _session: { revision: 'bad' } })); assert.equal(f.accesses.length, 0);
});
test('invalid historical reconciliation and future detail observations fail closed', async () => {
  const f = fixture(); f.history[root + '/wis_stock_history/fill_2'].quantity = 8;
  await assert.rejects(f.api.publishWisStockDailyRanking()); assert.equal(f.writes.length, 0);
  f.history[root + '/wis_stock_history/fill_2'].quantity = 2;
  await f.api.publishWisStockDailyRanking();
  f.current[head + '/entries/1'].points.push({ atMs: now, returnPercent: 99 });
  await assert.rejects(f.read({ dayKey: '2026-11-20', rank: 1 }));
});
