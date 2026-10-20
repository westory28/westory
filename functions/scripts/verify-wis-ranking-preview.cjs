const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { createWisQueryCore, accountIdFor } = require('../productionGateway/wisEconomyQuery');
const { createFirestoreStore } = require('../productionGateway/commandGateway');
const { buildEnrollmentSlotId } = require('../productionGateway/archiveEnrollment');

const publicId = (scope, uid) => `wispublic_${createHash('sha256').update(`${scope}\n${uid}`).digest('hex').slice(0, 24)}`;
const slotPath = (scope, uid) => `semester_enrollment_slots/${buildEnrollmentSlotId(scope, uid)}`;
const accountPath = (scope, uid) => `semester_wis_accounts/${accountIdFor(scope, uid)}`;
const rankingPath = (scope, uid) => `semester_wis_rankings/${accountIdFor(scope, uid)}`;
const previewPath = (scope, uid) => `semester_wis_preview_entries/${accountIdFor(scope, uid)}`;
const policyPath = scope => `years/${scope.split('-')[0]}/semesters/${scope.split('-')[1]}/point_policies/current`;
const entries = state => Object.values(state.hallOfFame?.gradeLeaderboardByGrade || {}).flat();

class MemoryStore {
  constructor() { this.docs = new Map(); this.resetStats(); this.failRankingQueries = 0; this.delayRanking = null; }
  resetStats() { this.reads = []; this.queries = []; this.writes = 0; }
  set(path, data) { this.docs.set(path, structuredClone(data)); }
  patch(path, data) { this.set(path, { ...this.docs.get(path), ...data }); }
  async get(path) {
    this.reads.push(path);
    return { path, exists: this.docs.has(path), data: this.docs.has(path) ? structuredClone(this.docs.get(path)) : null };
  }
  async getAll(paths) { return Promise.all(paths.map(path => this.get(path))); }
  async query(collection, filter) {
    const stats = { collection, ...filter };
    this.queries.push(stats);
    if (['semester_wis_rankings', 'semester_wis_preview_entries'].includes(collection)) {
      if (this.failRankingQueries > 0) { this.failRankingQueries--; throw new Error('synthetic read failure'); }
      if (this.delayRanking) await this.delayRanking;
    }
    const filters = filter?.filters || (filter?.field ? [filter] : []);
    const orderBy = Array.isArray(filter?.orderBy) ? filter.orderBy : filter?.orderBy ? [filter.orderBy] : [];
    const compareValue = (left, right) => typeof left === 'string' && typeof right === 'string'
      ? left < right ? -1 : left > right ? 1 : 0 : left < right ? -1 : left > right ? 1 : 0;
    const compare = (left, right) => {
      for (const ordering of orderBy) {
        const value = compareValue(left[1][ordering.field], right[1][ordering.field]);
        if (value) return ordering.direction === 'desc' ? -value : value;
      }
      const value = compareValue(left[0], right[0]);
      return filter?.documentIdOrder === 'desc' ? -value : value;
    };
    const matches = (data, clause) => {
      const value = data[clause.field];
      if (clause.operator === '==') return value === clause.value;
      if (clause.operator === '!=') return value !== undefined && value !== clause.value;
      if (clause.operator === 'in') return clause.value.includes(value);
      if (clause.operator === '>') return value > clause.value;
      if (clause.operator === '>=') return value >= clause.value;
      if (clause.operator === '<') return value < clause.value;
      if (clause.operator === '<=') return value <= clause.value;
      throw new Error(`Unsupported fixture filter ${clause.operator}`);
    };
    let rows = [...this.docs].filter(([path, data]) => path.startsWith(`${collection}/`) &&
      !path.slice(collection.length + 1).includes('/') && filters.every(clause => matches(data, clause)) &&
      orderBy.every(ordering => data[ordering.field] !== undefined)).sort(compare);
    if (filter?.startAfterPath) {
      const cursor = this.docs.get(filter.startAfterPath);
      rows = cursor ? rows.filter(row => compare(row, [filter.startAfterPath, cursor]) > 0) : [];
    } else if (filter?.startAfterId) {
      rows = rows.filter(([path]) => compareValue(path.slice(collection.length + 1), filter.startAfterId) *
        (filter.documentIdOrder === 'desc' ? -1 : 1) > 0);
    }
    rows = rows.slice(0, filter?.limit || rows.length);
    stats.returned = rows.length;
    stats.returnedPaths = rows.map(([path]) => path);
    return rows.map(([path, data]) => ({ path, exists: true, data: structuredClone(data) }));
  }
  runTransaction(callback) { return callback({ get: path => this.get(path), getAll: paths => this.getAll(paths),
    query: (...args) => this.query(...args), set: () => { this.writes++; throw new Error('unexpected write'); },
    create: () => { this.writes++; throw new Error('unexpected write'); },
    delete: () => { this.writes++; throw new Error('unexpected write'); } }); }
}

const addScope = (store, scope = '2026-2') => {
  store.set(`semester_manifests/${scope}`, { semesterId: scope, status: 'ACTIVE', revision: 3 });
  store.set(`semester_wis_economies/${scope}`, { semesterId: scope, status: 'ACTIVE_OPEN', revision: 1 });
  store.set('site_settings/semester_active', { semesterId: scope });
};
const addStudent = (store, index, { scope = '2026-2', grade = '3', score = 1000 - index, name = `학생 ${index}`, status = 'ACTIVE' } = {}) => {
  const uid = `student-${index}`;
  const enrollmentId = `enrollment-${scope}-${index}`;
  const classId = `class-${scope}-${grade}`;
  const accountId = accountIdFor(scope, uid);
  store.set(`users/${uid}`, { role: 'student', profileEmojiId: 'trophy' });
  store.set(slotPath(scope, uid), { semesterId: scope, studentUid: uid, activeEnrollmentId: enrollmentId });
  store.set(`semester_enrollments/${enrollmentId}`, { enrollmentId, semesterId: scope, studentUid: uid,
    enrollmentStatus: 'ACTIVE', classId, displayName: name, studentNumber: String(index + 1),
    snapshot: { grade, classNumber: '1' } });
  store.set(`semester_classes/${classId}`, { classId, semesterId: scope, status: 'ACTIVE', grade, classNumber: '1' });
  const fields = { accountId, studentUid: uid, semesterId: scope, enrollmentId, classId,
    grade, classNumber: '1', displayName: name, rankEarnedTotal: score, status };
  store.set(accountPath(scope, uid), { ...fields, studentNumber: String(index + 1),
    balance: score, recentLedgerEntries: Array.from({ length: 100 }, (_, n) => ({ reason: `large transaction ${n}` })) });
  const { status: _status, ...ranking } = fields;
  store.set(rankingPath(scope, uid), ranking);
  // Simulate canonical writer output independently: never import the index
  // writer into this query test, otherwise the same bug could seed and read it.
  store.set(previewPath(scope, uid), { schemaVersion: 1, ...ranking, publicId: publicId(scope, uid), hallZeroEligible: status === 'ACTIVE',
    eligible: (score > 0 || status === 'ACTIVE') && Number.isSafeInteger(score) && score >= 0 &&
      !['방테스트', 'bangtest'].includes(name.toLowerCase().replace(/[\s._-]+/g, '')) });
  return uid;
};
const teacher = { uid: 'teacher', role: 'teacher', staffPermissions: ['point_read'] };
const setup = (count = 12) => {
  const store = new MemoryStore(); addScope(store); store.set('users/teacher', teacher);
  for (let i = 0; i < count; i++) addStudent(store, i);
  let clock = 1_000_000; let deniedSession = false;
  const core = createWisQueryCore({ store, now: () => clock,
    assertSession: async request => { if (deniedSession) throw new Error('session revoked'); return { uid: request.auth.uid }; } });
  const request = ({ uid = 'student-11', audience = 'student', scope = '2026-2', source = 'CURRENT', ...data } = {}) =>
    core.getWisEconomyState({ auth: { uid }, data: { audience, semesterId: scope, source, projection: 'ranking-preview', ...data } });
  return { store, core, request, advance: ms => { clock += ms; }, denySession: () => { deniedSession = true; } };
};
const assertBoundedResponse = state => {
  assert.ok(entries(state).length <= 5);
  assert.deepEqual(state.hallOfFame.classLeaderboardByClassKey, {});
  assert.deepEqual(state.hallOfFame.classTop3ByClassKey, {});
  for (const key of ['accounts', 'ledger', 'products', 'inventory', 'orders', 'rankings']) assert.deepEqual(state[key], []);
  assert.equal(state.account, null); assert.equal(state.writeCount, 0);
  assert.equal(JSON.stringify(state).includes('large transaction'), false);
  assert.equal(JSON.stringify(state).includes('studentUid'), false);
};

const run = async () => {
  let cases = 0;
  const checks = [];
  const metrics = {};
  const check = async (name, run) => { await run(); cases++; checks.push(name); };
  const previewQueries = store => store.queries.filter(query => query.collection === 'semester_wis_preview_entries');
  const accountReads = store => store.reads.filter(path => path.startsWith('semester_wis_accounts/'));
  const assertIndexOnly = (store, { pages = 1, grade = '3' } = {}) => {
    const queries = previewQueries(store);
    assert.equal(store.queries.length, pages, 'Current preview must not scan another collection');
    assert.equal(queries.length, pages);
    for (const query of queries) {
      assert.ok(query.limit > 0 && query.limit <= 20);
      assert.equal(query.documentIdOrder, 'asc');
      assert.deepEqual(query.orderBy, [
        { field: 'grade', direction: 'asc' }, { field: 'rankEarnedTotal', direction: 'desc' },
        { field: 'publicId', direction: 'asc' },
      ]);
      const clauses = query.filters;
      assert.ok(clauses.some(clause => clause.field === 'semesterId' && clause.operator === '==' && clause.value === '2026-2'));
      assert.ok(clauses.some(clause => clause.field === 'eligible' && clause.operator === '==' && clause.value === true));
      assert.equal(clauses.some(clause => clause.field === 'grade' && clause.value === grade), grade !== null);
    }
    assert.equal(store.writes, 0);
  };
  await check('current preview reads one ordered 20-entry index page and only final five canonical accounts', async () => {
    const ctx = setup(80); ctx.store.resetStats();
    const started = process.hrtime.bigint();
    const cold = await ctx.request({ uid: 'student-79' });
    metrics.normalCurrentQueryMs = Number(process.hrtime.bigint() - started) / 1e6;
    assertBoundedResponse(cold); assert.equal(entries(cold).length, 5); assertIndexOnly(ctx.store);
    assert.equal(previewQueries(ctx.store)[0].returned, 20);
    assert.equal(new Set(accountReads(ctx.store)).size, 6);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('users/') && path !== 'users/student-79').length, 5);
    ctx.store.resetStats(); const warm = await ctx.request({ uid: 'student-79' }); assertBoundedResponse(warm);
    assertIndexOnly(ctx.store); assert.equal(accountReads(ctx.store).length, 6);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('semester_enrollment_slots/')).length, 6);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('semester_enrollments/')).length, 6);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('semester_classes/')).length, 1);
    assert.equal(ctx.store.reads.length, new Set(ctx.store.reads).size);
  });
  await check('current failures retry explicitly without ranking-cache scans', async () => {
    const ctx = setup(); ctx.store.failRankingQueries = 1;
    await assert.rejects(() => ctx.request(), /synthetic read failure/);
    assert.equal(entries(await ctx.request()).length, 5);
    assertIndexOnly(ctx.store, { pages: 2 });
  });
  await check('archive alone retains 30-second TTL and simultaneous cold-build deduplication', async () => {
    const ctx = setup(); let release; ctx.store.delayRanking = new Promise(resolve => { release = resolve; });
    const request = () => ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT' });
    const requests = Array.from({ length: 8 }, request);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    release(); await Promise.all(requests);
    assert.equal(ctx.store.queries.length, 1);
    assert.equal(ctx.store.queries[0].collection, 'semester_wis_rankings');
    assert.equal(ctx.store.queries[0].limit, 2001);
    ctx.advance(29_999); await request(); assert.equal(ctx.store.queries.length, 1);
    ctx.advance(1); await request(); assert.equal(ctx.store.queries.length, 2);
  });
  await check('archive failed builders are retryable and the cache retains only four scopes', async () => {
    const ctx = setup(); ctx.store.failRankingQueries = 1;
    const explicit = scope => ctx.request({ uid: 'teacher', audience: 'teacher', scope, source: 'EXPLICIT' });
    await assert.rejects(() => explicit('2026-2'), /synthetic read failure/);
    assert.equal(entries(await explicit('2026-2')).length, 5);
    for (const scope of ['2025-1', '2025-2', '2026-1', '2026-2', '2027-1']) {
      addScope(ctx.store, scope); addStudent(ctx.store, 100, { scope }); await explicit(scope);
    }
    const before = ctx.store.queries.length; await explicit('2025-1');
    assert.equal(ctx.store.queries.length, before + 1);
  });
  await check('fresh canonical deletion, placement, withdrawal and names override stale index metadata', async () => {
    const ctx = setup(); await ctx.request();
    ctx.store.docs.delete(accountPath('2026-2', 'student-0'));
    ctx.store.patch('semester_enrollments/enrollment-2026-2-1', { snapshot: { grade: '2', classNumber: '1' }, displayName: '이동 후 이름' });
    ctx.store.patch('semester_enrollments/enrollment-2026-2-2', { enrollmentStatus: 'WITHDRAWN' });
    ctx.store.patch('semester_enrollments/enrollment-2026-2-3', { displayName: '최신 이름' });
    ctx.store.resetStats(); const state = await ctx.request(); const rows = entries(state);
    assert.equal(rows.length, 5); assert.ok(rows.every(row => row.grade === '3'));
    assert.ok(!rows.some(row => [0, 1, 2].some(i => row.uid === publicId('2026-2', `student-${i}`))));
    assert.equal(rows.find(row => row.uid === publicId('2026-2', 'student-3')).studentName, '최신 이름');
    assertIndexOnly(ctx.store); assert.equal(ctx.store.reads.length, new Set(ctx.store.reads).size);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('users/') && path !== 'users/student-11').length, 5);
  });
  await check('actor class semester is validated before any index query', async () => {
    const ctx = setup(); ctx.store.patch('semester_classes/class-2026-2-3', { semesterId: '2026-1' });
    const state = await ctx.request(); assert.equal(state.reason, 'WIS_ACTIVE_ENROLLMENT_REQUIRED');
    assert.equal(state.hallOfFame, null); assert.equal(ctx.store.queries.length, 0);
  });
  await check('current policy and final five profiles are freshly applied on every request', async () => {
    const ctx = setup(); await ctx.request();
    ctx.store.patch(policyPath('2026-2'), { rankPolicy: { emojiRegistry: [
      { id: 'smile', emoji: '😀', enabled: true }, { id: 'trophy', emoji: '🏆', enabled: false },
    ] } });
    ctx.store.patch('users/student-0', { profileEmojiId: 'smile', profileIcon: '😀' });
    ctx.store.resetStats(); const state = await ctx.request();
    assert.equal(state.rankPolicy.emojiRegistry[1].enabled, false);
    assert.ok(entries(state).every(row => row.profileIcon === '😀')); assertIndexOnly(ctx.store);
    assert.equal(ctx.store.reads.filter(path => path === policyPath('2026-2')).length, 1);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('users/') && path !== 'users/student-11').length, 5);
  });
  await check('fresh account score cannot preserve a stale high index rank', async () => {
    const ctx = setup(); ctx.store.patch(accountPath('2026-2', 'student-0'), { rankEarnedTotal: 1 });
    const state = await ctx.request(); const rows = entries(state);
    assert.equal(rows.length, 5);
    assert.ok(!rows.some(row => row.uid === publicId('2026-2', 'student-0')));
    assert.ok(rows.some(row => row.uid === publicId('2026-2', 'student-5')));
    assert.deepEqual(rows.map(row => row.cumulativeEarned), [999, 998, 997, 996, 995]);
    assertIndexOnly(ctx.store);
  });
  await check('fresh score decreases across an entire first page trigger bounded next-page replacement', async () => {
    const ctx = setup(80);
    for (let i = 0; i < 20; i++) ctx.store.patch(accountPath('2026-2', `student-${i}`), { rankEarnedTotal: 0 });
    ctx.store.resetStats(); const state = await ctx.request({ uid: 'student-79' });
    assert.equal(entries(state).length, 5); assertIndexOnly(ctx.store, { pages: 2 });
    assert.deepEqual(entries(state).map(row => row.cumulativeEarned), [980, 979, 978, 977, 976]);
    assert.ok(entries(state).some(row => row.uid === publicId('2026-2', 'student-20')));
    assert.equal(new Set(accountReads(ctx.store)).size, 26);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('users/') && path !== 'users/student-79').length, 5);
  });
  await check('freshly renamed test accounts remain hidden despite eligible old index entries', async () => {
    const ctx = setup(); ctx.store.patch('semester_enrollments/enrollment-2026-2-0', { displayName: '방테스트' });
    const state = await ctx.request(); assert.ok(!entries(state).some(row => row.uid === publicId('2026-2', 'student-0')));
    assert.equal(entries(state).length, 5); assertIndexOnly(ctx.store);
  });
  await check('permissions and application sessions are rechecked on every request', async () => {
    const ctx = setup(); await ctx.request({ uid: 'teacher', audience: 'teacher' });
    ctx.store.patch('users/teacher', { staffPermissions: [] });
    await assert.rejects(() => ctx.request({ uid: 'teacher', audience: 'teacher' }), error => error.details?.reason === 'WIS_MANAGE_REQUIRED');
    ctx.store.patch('users/teacher', teacher); ctx.denySession();
    await assert.rejects(() => ctx.request(), /session revoked/);
  });
  await check('preparing semesters and inactive actor enrollment do not expose index data', async () => {
    const ctx = setup(); ctx.store.patch('semester_manifests/2026-2', { status: 'PREPARING' });
    assert.equal((await ctx.request()).reason, 'PREPARING_STUDENT_DATA_HIDDEN');
    ctx.store.patch('semester_manifests/2026-2', { status: 'ACTIVE' });
    ctx.store.patch(slotPath('2026-2', 'student-11'), { activeEnrollmentId: '' });
    assert.equal((await ctx.request()).reason, 'WIS_ACTIVE_ENROLLMENT_REQUIRED');
    assert.equal(ctx.store.queries.length, 0);
  });
  await check('teacher keeps the first eligible grade even when it contains fewer than five students', async () => {
    const ctx = setup(80);
    for (let i = 100; i < 103; i++) addStudent(ctx.store, i, { grade: '1', score: 1 });
    const state = await ctx.request({ uid: 'teacher', audience: 'teacher' });
    assert.equal(state.hallOfFame.primaryGradeKey, '1'); assert.equal(entries(state).length, 3);
    assert.ok(entries(state).every(row => row.grade === '1'));
    assertIndexOnly(ctx.store, { grade: null });
    ctx.store.resetStats(); const studentState = await ctx.request();
    assert.equal(studentState.hallOfFame.primaryGradeKey, '3');
    assert.ok(entries(studentState).every(row => row.grade === '3')); assertIndexOnly(ctx.store);
  });
  await check('teacher advances past a wholly stale first grade to the next eligible grade', async () => {
    const ctx = setup();
    for (let i = 100; i < 103; i++) {
      addStudent(ctx.store, i, { grade: '1', score: 1 }); ctx.store.docs.delete(accountPath('2026-2', `student-${i}`));
    }
    const state = await ctx.request({ uid: 'teacher', audience: 'teacher' });
    assert.equal(state.hallOfFame.primaryGradeKey, '3'); assert.equal(entries(state).length, 5);
    assertIndexOnly(ctx.store, { grade: null });
  });
  await check('foreign-semester index entries cannot influence current teacher or student ordering', async () => {
    const ctx = setup();
    for (let i = 100; i < 105; i++) addStudent(ctx.store, i, { scope: '2026-1', grade: '1', score: 100_000 });
    const state = await ctx.request({ uid: 'teacher', audience: 'teacher' });
    assert.equal(state.hallOfFame.primaryGradeKey, '3'); assert.equal(entries(state).length, 5);
    assert.ok(entries(state).every(row => row.cumulativeEarned <= 1000)); assertIndexOnly(ctx.store, { grade: null });
    ctx.store.resetStats(); const studentState = await ctx.request();
    assert.equal(studentState.hallOfFame.primaryGradeKey, '3'); assert.equal(entries(studentState).length, 5);
    assert.ok(entries(studentState).every(row => row.cumulativeEarned <= 1000)); assertIndexOnly(ctx.store);
  });
  await check('twenty leading invalid candidates require exactly two cursor-bounded index pages', async () => {
    const ctx = setup(80);
    for (let i = 0; i < 20; i++) ctx.store.docs.delete(accountPath('2026-2', `student-${i}`));
    ctx.store.resetStats(); const started = process.hrtime.bigint();
    const state = await ctx.request({ uid: 'student-79' });
    metrics.stale20CurrentQueryMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(entries(state).length, 5); assertIndexOnly(ctx.store, { pages: 2 });
    const queries = previewQueries(ctx.store);
    assert.equal(queries[1].startAfterPath, queries[0].returnedPaths.at(-1));
    assert.equal(queries[0].returned, 20); assert.equal(queries[1].returned, 20);
    assert.equal(new Set(accountReads(ctx.store)).size, 26);
    assert.ok(entries(state).some(row => row.uid === publicId('2026-2', 'student-20')));
    assert.equal(ctx.store.reads.filter(path => path.startsWith('users/') && path !== 'users/student-79').length, 5);
  });
  await check('eligible=false index entries are never exposed or read as candidates', async () => {
    const ctx = setup(); ctx.store.patch(previewPath('2026-2', 'student-0'), { eligible: false });
    const state = await ctx.request(); assert.equal(entries(state).length, 5);
    assert.ok(!entries(state).some(row => row.uid === publicId('2026-2', 'student-0')));
    assert.ok(!ctx.store.reads.includes(accountPath('2026-2', 'student-0'))); assertIndexOnly(ctx.store);
  });
  await check('index tie ordering, public rank limits and one-page stopping remain deterministic', async () => {
    const ctx = setup(0); addStudent(ctx.store, 100, { score: 0 });
    for (let i = 0; i < 45; i++) addStudent(ctx.store, i, { score: 100 });
    for (const includeTies of [false, true]) for (const limit of [4, 5, 10, 20]) {
      ctx.store.set('site_settings/interface_config', { hallOfFame: { publicRange: {
        gradeRankLimit: limit, classRankLimit: 10, includeTies,
      } } });
      ctx.store.resetStats(); const state = await ctx.request({ uid: 'student-100' });
      assert.equal(entries(state).length, includeTies ? 5 : Math.min(5, limit));
      assert.ok(entries(state).every(row => row.rank === 1));
      const ids = entries(state).map(row => row.uid); assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));
      const eligibleIds = Array.from({ length: 45 }, (_, i) => publicId('2026-2', `student-${i}`)).sort((a, b) => a.localeCompare(b));
      assert.deepEqual(ids, eligibleIds.slice(0, ids.length));
      assertBoundedResponse(state); assertIndexOnly(ctx.store);
    }
  });
  await check('public four with positive ties fills the fifth place across a stale page boundary', async () => {
    const ctx = setup(0); addStudent(ctx.store, 100, { score: 0 });
    for (let i = 0; i < 45; i++) addStudent(ctx.store, i, { score: 100 });
    const ordered = Array.from({ length: 45 }, (_, i) => `student-${i}`)
      .sort((a, b) => publicId('2026-2', a).localeCompare(publicId('2026-2', b)));
    for (const uid of ordered.slice(0, 16)) ctx.store.patch(slotPath('2026-2', uid), { activeEnrollmentId: '' });
    ctx.store.set('site_settings/interface_config', { hallOfFame: { publicRange: {
      gradeRankLimit: 4, classRankLimit: 10, includeTies: true,
    } } });
    const state = await ctx.request({ uid: 'student-100' });
    assert.equal(entries(state).length, 5);
    assert.deepEqual(entries(state).map(row => row.uid), ordered.slice(16, 21).map(uid => publicId('2026-2', uid)));
    assert.ok(entries(state).every(row => row.rank === 1));
    assertIndexOnly(ctx.store, { pages: 2 });
  });
  await check('zero score fills only the allowed five or four places and excludes closed accounts', async () => {
    const ctx = setup(0); addStudent(ctx.store, 100, { score: 0 });
    for (let i = 0; i < 12; i++) addStudent(ctx.store, i, { score: 0, status: i < 2 ? 'CLOSED' : 'ACTIVE' });
    let state = await ctx.request({ uid: 'student-100' }); assert.equal(entries(state).length, 5);
    assert.ok(!entries(state).some(row => [0, 1].some(i => row.uid === publicId('2026-2', `student-${i}`))));
    assert.ok(entries(state).every(row => row.cumulativeEarned === 0));
    ctx.store.patch('site_settings/interface_config', { hallOfFame: { publicRange: { gradeRankLimit: 4, classRankLimit: 10, includeTies: true } } });
    ctx.store.resetStats(); state = await ctx.request({ uid: 'student-100' });
    assert.equal(entries(state).length, 4); assertIndexOnly(ctx.store);
  });
  await check('current input inspection never exceeds 2000 entries or repeats a cursor', async () => {
    const ctx = setup(0);
    for (let i = 0; i < 2005; i++) addStudent(ctx.store, i, { score: 3000 - i });
    for (let i = 0; i < 2000; i++) ctx.store.docs.delete(accountPath('2026-2', `student-${i}`));
    ctx.store.resetStats();
    let state; const started = process.hrtime.bigint();
    try { state = await ctx.request({ uid: 'student-2004' }); }
    catch (error) { assert.equal(error.details?.reason, 'WIS_HALL_ACCOUNT_LIMIT_EXCEEDED'); }
    metrics.stale2000CurrentQueryMs = Number(process.hrtime.bigint() - started) / 1e6;
    if (state) assert.equal(entries(state).length, 0, 'Entries beyond the cap must not be exposed');
    assertIndexOnly(ctx.store, { pages: 100 });
    const queries = previewQueries(ctx.store);
    assert.equal(queries.reduce((sum, query) => sum + query.returned, 0), 2000);
    assert.equal(new Set(queries.slice(1).map(query => query.startAfterPath)).size, 99);
    assert.equal(accountReads(ctx.store).length, 2001);
    assert.ok(!ctx.store.reads.includes(accountPath('2026-2', 'student-2000')));
    assert.equal(ctx.store.reads.filter(path => path.startsWith('users/') && path !== 'users/student-2004').length, 0);
  });
  await check('malformed or foreign canonical metadata cannot publish an indexed candidate', async () => {
    const ctx = setup();
    ctx.store.patch(previewPath('2026-2', 'student-0'), { accountId: 'forged' });
    ctx.store.patch(previewPath('2026-2', 'student-1'), { rankEarnedTotal: Number.NaN });
    ctx.store.patch(accountPath('2026-2', 'student-2'), { semesterId: '2026-1' });
    ctx.store.patch(previewPath('2026-2', 'student-3'), { publicId: 'forged' });
    const state = await ctx.request(); assert.equal(entries(state).length, 5);
    assert.ok(!entries(state).some(row => [0, 1, 2, 3].some(i => row.uid === publicId('2026-2', `student-${i}`))));
    assertIndexOnly(ctx.store);
  });
  await check('explicit archive keeps bounded full-cache semantics and ignores active slots', async () => {
    const ctx = setup(); ctx.store.patch('semester_manifests/2026-2', { status: 'ARCHIVED' });
    for (let i = 0; i < 12; i++) ctx.store.docs.delete(slotPath('2026-2', `student-${i}`));
    const canonical = await ctx.request({ uid: 'teacher', audience: 'teacher' }); assert.equal(entries(canonical).length, 0);
    const archive = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT' });
    assert.equal(entries(archive).length, 5); assert.equal(archive.readOnly, true); assert.equal(archive.provenance, 'EXPLICIT');
    assert.equal(ctx.store.queries.filter(query => query.collection === 'semester_wis_rankings').length, 1);
    ctx.store.patch(accountPath('2026-2', 'student-0'), { displayName: '보관된 최신 이름' });
    const refreshed = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT' });
    assert.equal(entries(refreshed).find(row => row.uid === publicId('2026-2', 'student-0')).studentName, '보관된 최신 이름');
  });
  await check('archive writer-shape compatibility preserves prior placement and missing fields', async () => {
    const ctx = setup(); ctx.store.patch('semester_manifests/2026-2', { status: 'ARCHIVED' });
    for (let i = 0; i < 12; i++) {
      const path = rankingPath('2026-2', `student-${i}`), row = { ...ctx.store.docs.get(path) };
      if (i % 2) { row.grade = '2'; row.classNumber = '8'; row.displayName = '과거 투영 이름'; }
      else { delete row.grade; delete row.classNumber; }
      ctx.store.set(path, row); ctx.store.docs.delete(slotPath('2026-2', `student-${i}`));
    }
    const preview = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT' });
    assert.equal(entries(preview).length, 5); assert.equal(preview.hallOfFame.primaryGradeKey, '3');
    assertBoundedResponse(preview);
    const full = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT', projection: 'hall-of-fame' });
    assert.deepEqual(entries(preview), full.hallOfFame.gradeLeaderboardByGrade['3'].slice(0, 5));
    ctx.store.resetStats();
    const warm = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT' });
    assert.deepEqual(entries(warm), entries(preview)); assert.equal(ctx.store.queries.length, 0);
    assert.equal(accountReads(ctx.store).length, 5);
  });
  await check('archive preserves earned-score-only semantics and its original 2000 bound', async () => {
    const ctx = setup(0); addStudent(ctx.store, 100, { score: 0 });
    for (let i = 0; i < 8; i++) addStudent(ctx.store, i, { score: i < 2 ? 100 : 0 });
    ctx.store.patch('semester_manifests/2026-2', { status: 'ARCHIVED' });
    const preview = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT' });
    const full = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT', projection: 'hall-of-fame' });
    assert.equal(entries(preview).length, 2);
    assert.deepEqual(entries(preview), full.hallOfFame.gradeLeaderboardByGrade['3'].slice(0, 5));
    const capped = setup(2001);
    await assert.rejects(() => capped.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT' }), error => error.details?.reason === 'WIS_HALL_ACCOUNT_LIMIT_EXCEEDED');
    assert.equal(capped.store.queries.length, 1); assert.equal(capped.store.queries[0].limit, 2001);
    assert.equal(accountReads(capped.store).length, 0);
  });
  {
    const options = [];
    const snapshot = ref => ({ exists: true, ref, data: () => ({ value: 'fixture' }) });
    const db = { doc: path => ({ path }), runTransaction: (callback, transactionOptions) => {
      options.push(transactionOptions);
      return callback({ get: async ref => snapshot(ref), getAll: async (...refs) => refs.map(snapshot) });
    } };
    const read = transaction => transaction.getAll(['fixtures/one', 'fixtures/two']);
    const readonly = await createFirestoreStore(db, { readOnly: true }).runTransaction(read);
    const ordinary = await createFirestoreStore(db).runTransaction(read);
    assert.deepEqual(options, [{ readOnly: true }, undefined]);
    assert.deepEqual(readonly, ordinary); assert.equal(readonly[0].data.value, 'fixture'); cases++;
  }
  {
    let received; let receivedStoreOptions;
    const source = fs.readFileSync(require.resolve('../wisRankingPreview'), 'utf8');
    const exports = {};
    vm.runInNewContext(source, { exports, require: name => {
      if (name === 'firebase-admin/firestore') return { getFirestore: () => ({}) };
      if (name === './productionGateway/commandGateway') return { createFirestoreStore: (_db, options) => {
        receivedStoreOptions = options; return {};
      } };
      if (name === './productionGateway/wisEconomyQuery') return { createWisQueryCore: () => ({
        getWisEconomyState: request => { received = request; return { verified: true }; },
      }) };
      if (name === './productionGateway/studentMaintenance') return { onCallWithStudentMaintenance: (_options, callback) => callback };
      throw new Error(`unexpected dependency: ${name}`);
    } });
    const request = { auth: { uid: 'actor' }, data: { source: 'CURRENT', semesterId: '2026-2',
      projection: 'catalog', _session: { id: 'proof' } } };
    assert.equal((await exports.getWisRankingPreview(request)).verified, true);
    assert.equal(received.data.projection, 'ranking-preview');
    assert.equal(received.data._session, request.data._session);
    assert.equal(received.auth, request.auth); assert.equal(request.data.projection, 'catalog');
    assert.equal(receivedStoreOptions.readOnly, true); cases++;
  }
  {
    const app = initializeApp({ projectId: 'demo-westory-ranking-preview' });
    const endpoint = require('../wisRankingPreview');
    assert.deepEqual(Object.keys(endpoint), ['getWisRankingPreview']);
    assert.deepEqual(endpoint.getWisRankingPreview.__endpoint.region, ['us-central1']);
    assert.equal(typeof endpoint.getWisRankingPreview.__endpoint.minInstances === 'number' &&
      endpoint.getWisRankingPreview.__endpoint.minInstances > 0, false);
    const source = fs.readFileSync(require.resolve('../wisRankingPreview'), 'utf8');
    assert.match(source, /readOnly: true/); assert.match(source, /projection: 'ranking-preview'/);
    assert.match(source, /onCallWithStudentMaintenance/);
    const querySource = fs.readFileSync(require.resolve('../productionGateway/wisEconomyQuery'), 'utf8');
    assert.equal(/setInterval|setTimeout/.test(querySource), false);
    await deleteApp(app); cases++;
  }
  console.log(JSON.stringify({ passed: true, cases, network: 0, metrics,
    checks, guarantees: ['current ordered materialized index pages of 20; no ranking/account/ledger collection scans', 'EXPLICIT archive alone retains 30s TTL, pending dedup, four-entry cache and failed-build retry',
      'fresh session, permissions, semester, actor and candidate canonical scope', 'fresh profiles and policy only for final five',
      'ties, public limits, zero score, test identities, archive semantics and 2000 cap', 'no polling, timers, writes or reserved instances'] }));
};
run().catch(error => { console.error(error); process.exitCode = 1; });
