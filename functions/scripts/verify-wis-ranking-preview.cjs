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
    this.queries.push({ collection, ...filter });
    if (collection === 'semester_wis_rankings') {
      if (this.failRankingQueries > 0) { this.failRankingQueries--; throw new Error('synthetic read failure'); }
      if (this.delayRanking) await this.delayRanking;
    }
    return [...this.docs].filter(([path, data]) => path.startsWith(`${collection}/`) &&
      !path.slice(collection.length + 1).includes('/') && data[filter.field] === filter.value)
      .slice(0, filter.limit).map(([path, data]) => ({ path, exists: true, data: structuredClone(data) }));
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
  {
    const ctx = setup(80); ctx.store.resetStats();
    const cold = await ctx.request({ uid: 'student-79' });
    assertBoundedResponse(cold); assert.equal(entries(cold).length, 5);
    assert.equal(ctx.store.queries.length, 1); assert.equal(ctx.store.queries[0].collection, 'semester_wis_rankings');
    assert.equal(ctx.store.queries[0].limit, 2001);
    assert.equal(new Set(ctx.store.reads.filter(path => path.startsWith('semester_wis_accounts/'))).size, 6);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('users/') && path !== 'users/student-79').length, 5);
    ctx.store.resetStats(); const warm = await ctx.request({ uid: 'student-79' }); assertBoundedResponse(warm);
    assert.equal(ctx.store.queries.length, 0);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('semester_wis_accounts/')).length, 6);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('semester_enrollment_slots/')).length, 6);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('semester_enrollments/')).length, 6);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('semester_classes/')).length, 1);
    assert.equal(ctx.store.reads.length, new Set(ctx.store.reads).size);
    assert.equal(ctx.store.writes, 0); cases++;
  }
  {
    const ctx = setup(); let release; ctx.store.delayRanking = new Promise(resolve => { release = resolve; });
    const requests = Array.from({ length: 8 }, () => ctx.request());
    for (let i = 0; i < 20; i++) await Promise.resolve();
    release(); await Promise.all(requests);
    assert.equal(ctx.store.queries.length, 1, 'simultaneous cold requests share one builder');
    ctx.advance(29_999); await ctx.request(); assert.equal(ctx.store.queries.length, 1);
    ctx.advance(1); await ctx.request(); assert.equal(ctx.store.queries.length, 2);
    cases++;
  }
  {
    const ctx = setup(); ctx.store.failRankingQueries = 1;
    await assert.rejects(() => ctx.request(), /synthetic read failure/);
    assert.equal(entries(await ctx.request()).length, 5); assert.equal(ctx.store.queries.length, 2);
    cases++;
  }
  {
    const ctx = setup();
    for (const scope of ['2025-1', '2025-2', '2026-1', '2026-2', '2027-1']) {
      addScope(ctx.store, scope); addStudent(ctx.store, 100, { scope });
      await ctx.request({ uid: 'teacher', audience: 'teacher', scope });
    }
    const before = ctx.store.queries.length;
    await ctx.request({ uid: 'teacher', audience: 'teacher', scope: '2025-1' });
    assert.equal(ctx.store.queries.length, before + 1, 'only four scope entries retained'); cases++;
  }
  {
    const ctx = setup(); await ctx.request();
    ctx.store.docs.delete(accountPath('2026-2', 'student-0'));
    ctx.store.patch('semester_enrollments/enrollment-2026-2-1', { snapshot: { grade: '2', classNumber: '1' }, displayName: '이동 후 이름' });
    ctx.store.patch('semester_enrollments/enrollment-2026-2-2', { enrollmentStatus: 'WITHDRAWN' });
    ctx.store.patch('semester_enrollments/enrollment-2026-2-3', { displayName: '최신 이름' });
    ctx.store.resetStats(); const state = await ctx.request(); const rows = entries(state);
    assert.equal(rows.length, 5); assert.ok(rows.every(row => row.grade === '3'));
    assert.ok(!rows.some(row => [0, 1, 2].some(i => row.uid === publicId('2026-2', `student-${i}`))));
    assert.equal(rows.find(row => row.uid === publicId('2026-2', 'student-3')).studentName, '최신 이름');
    assert.equal(ctx.store.queries.length, 0); assert.equal(ctx.store.reads.length, new Set(ctx.store.reads).size);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('users/') && path !== 'users/student-11').length, 5);
    cases++;
  }
  {
    const ctx = setup(); await ctx.request();
    ctx.store.patch('semester_classes/class-2026-2-3', { semesterId: '2026-1' });
    const state = await ctx.request(); assert.equal(state.reason, 'WIS_ACTIVE_ENROLLMENT_REQUIRED');
    assert.equal(state.hallOfFame, null); cases++;
  }
  {
    const ctx = setup(); await ctx.request();
    ctx.store.patch(accountPath('2026-2', 'student-0'), { rankEarnedTotal: 0 });
    ctx.store.patch(policyPath('2026-2'), { rankPolicy: { emojiRegistry: [
      { id: 'smile', emoji: '😀', enabled: true }, { id: 'trophy', emoji: '🏆', enabled: false },
    ] } });
    const state = await ctx.request(); assert.equal(state.rankPolicy.emojiRegistry[1].enabled, false);
    assert.ok(entries(state).every(row => row.profileIcon === '😀'));
    assert.ok(entries(state).some(row => row.uid === publicId('2026-2', 'student-0') && row.cumulativeEarned === 0),
      'fresh account score is returned without treating a cache mismatch as invalid');
    assert.equal(ctx.store.queries.length, 1); cases++;
  }
  {
    const ctx = setup(); await ctx.request();
    ctx.store.patch(accountPath('2026-2', 'student-0'), { rankEarnedTotal: 1 });
    const state = await ctx.request();
    assert.equal(entries(state).find(row => row.uid === publicId('2026-2', 'student-0')).profileIcon, '😀',
      'profile eligibility uses fresh account score'); cases++;
  }
  {
    const ctx = setup(); await ctx.request();
    ctx.store.patch('semester_enrollments/enrollment-2026-2-0', { displayName: '방테스트' });
    const state = await ctx.request(); assert.ok(!entries(state).some(row => row.uid === publicId('2026-2', 'student-0')));
    assert.equal(entries(state).length, 5); cases++;
  }
  {
    const ctx = setup(); await ctx.request({ uid: 'teacher', audience: 'teacher' });
    ctx.store.patch('users/teacher', { staffPermissions: [] });
    await assert.rejects(() => ctx.request({ uid: 'teacher', audience: 'teacher' }), error => error.details?.reason === 'WIS_MANAGE_REQUIRED');
    ctx.store.patch('users/teacher', teacher); ctx.denySession();
    await assert.rejects(() => ctx.request(), /session revoked/); cases++;
  }
  {
    const ctx = setup(); await ctx.request();
    ctx.store.patch('semester_manifests/2026-2', { status: 'PREPARING' });
    assert.equal((await ctx.request()).reason, 'PREPARING_STUDENT_DATA_HIDDEN');
    ctx.store.patch('semester_manifests/2026-2', { status: 'ACTIVE' });
    ctx.store.patch(slotPath('2026-2', 'student-11'), { activeEnrollmentId: '' });
    assert.equal((await ctx.request()).reason, 'WIS_ACTIVE_ENROLLMENT_REQUIRED'); cases++;
  }
  {
    const ctx = setup(); addStudent(ctx.store, 100, { grade: '1', score: 1 });
    const teacherState = await ctx.request({ uid: 'teacher', audience: 'teacher' });
    assert.equal(teacherState.hallOfFame.primaryGradeKey, '1'); assert.equal(entries(teacherState).length, 1);
    const studentState = await ctx.request(); assert.equal(studentState.hallOfFame.primaryGradeKey, '3');
    assert.ok(entries(studentState).every(row => row.grade === '3')); cases++;
  }
  {
    const ctx = setup(); addStudent(ctx.store, 100, { grade: '1', score: 0, status: 'CLOSED' });
    const state = await ctx.request({ uid: 'teacher', audience: 'teacher' });
    assert.equal(state.hallOfFame.primaryGradeKey, '3'); assert.equal(entries(state).length, 5); cases++;
  }
  {
    const ctx = setup(80); await ctx.request({ uid: 'student-79' });
    for (let i = 0; i < 79; i++) ctx.store.patch(slotPath('2026-2', `student-${i}`), { activeEnrollmentId: '' });
    ctx.store.resetStats(); const state = await ctx.request({ uid: 'student-79' });
    assert.equal(entries(state).length, 1); assert.equal(ctx.store.queries.length, 0);
    const accounts = ctx.store.reads.filter(path => path.startsWith('semester_wis_accounts/'));
    assert.equal(accounts.length, 80); assert.equal(accounts.length, new Set(accounts).size);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('users/') && path !== 'users/student-79').length, 0);
    cases++;
  }
  {
    const ctx = setup(); ctx.store.patch('semester_manifests/2026-2', { status: 'ARCHIVED' });
    for (let i = 0; i < 12; i++) ctx.store.docs.delete(slotPath('2026-2', `student-${i}`));
    const canonical = await ctx.request({ uid: 'teacher', audience: 'teacher' }); assert.equal(entries(canonical).length, 0);
    const archive = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT' });
    assert.equal(entries(archive).length, 5); assert.equal(archive.readOnly, true); assert.equal(archive.provenance, 'EXPLICIT');
    assert.equal(ctx.store.queries.length, 2, 'explicit historical metadata uses a separate cache');
    ctx.store.patch(accountPath('2026-2', 'student-0'), { displayName: '보관된 최신 이름' });
    const refreshed = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT' });
    assert.equal(entries(refreshed).find(row => row.uid === publicId('2026-2', 'student-0')).studentName, '보관된 최신 이름');
    cases++;
  }
  {
    // Match real writer shapes: createWisAccounts omits grade/classNumber;
    // older projections may retain a placement that differs from the account.
    const ctx = setup(12); ctx.store.patch('semester_manifests/2026-2', { status: 'ARCHIVED' });
    for (let i = 0; i < 12; i++) {
      const path = rankingPath('2026-2', `student-${i}`);
      const row = { ...ctx.store.docs.get(path) };
      if (i % 2) { row.grade = '2'; row.classNumber = '8'; row.displayName = '과거 투영 이름'; }
      else { delete row.grade; delete row.classNumber; }
      ctx.store.set(path, row);
      ctx.store.docs.delete(slotPath('2026-2', `student-${i}`));
    }
    ctx.store.resetStats();
    const preview = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT' });
    assert.equal(entries(preview).length, 5); assert.equal(preview.hallOfFame.primaryGradeKey, '3');
    assert.equal(ctx.store.reads.filter(path => path.startsWith('semester_wis_accounts/')).length, 12);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('users/') && path !== 'users/teacher').length, 5);
    assertBoundedResponse(preview);
    const full = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT', projection: 'hall-of-fame' });
    assert.deepEqual(entries(preview), full.hallOfFame.gradeLeaderboardByGrade['3'].slice(0, 5));
    ctx.store.resetStats();
    const warm = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT' });
    assert.deepEqual(entries(warm), entries(preview)); assert.equal(ctx.store.queries.length, 0);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('semester_wis_accounts/')).length, 5); cases++;
  }
  {
    const ctx = setup(0); addStudent(ctx.store, 100, { score: 0 });
    for (let i = 0; i < 8; i++) addStudent(ctx.store, i, { score: i < 2 ? 100 : 0 });
    ctx.store.patch('semester_manifests/2026-2', { status: 'ARCHIVED' });
    const preview = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT' });
    const full = await ctx.request({ uid: 'teacher', audience: 'teacher', source: 'EXPLICIT', projection: 'hall-of-fame' });
    assert.equal(entries(preview).length, 2);
    assert.deepEqual(entries(preview), full.hallOfFame.gradeLeaderboardByGrade['3'].slice(0, 5)); cases++;
  }
  {
    const ctx = setup(0); addStudent(ctx.store, 100, { score: 0 });
    for (let i = 0; i < 9; i++) addStudent(ctx.store, i, { score: 100 });
    for (const includeTies of [false, true]) for (const limit of [4, 5, 10, 20]) {
      ctx.store.set('site_settings/interface_config', { hallOfFame: { publicRange: {
        gradeRankLimit: limit, classRankLimit: 10, includeTies,
      } } });
      const state = await ctx.request({ uid: 'student-100' });
      assert.equal(entries(state).length, includeTies ? 5 : Math.min(5, limit));
      assert.ok(entries(state).every(row => row.rank === 1));
      const ids = entries(state).map(row => row.uid); assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));
      assertBoundedResponse(state); cases++;
    }
  }
  {
    const ctx = setup(0); addStudent(ctx.store, 100, { score: 0 });
    for (let i = 0; i < 12; i++) addStudent(ctx.store, i, { score: 0, status: i < 2 ? 'CLOSED' : 'ACTIVE' });
    let state = await ctx.request({ uid: 'student-100' }); assert.equal(entries(state).length, 5);
    assert.ok(!entries(state).some(row => [0, 1].some(i => row.uid === publicId('2026-2', `student-${i}`))));
    assert.ok(entries(state).every(row => row.cumulativeEarned === 0));
    ctx.store.patch('site_settings/interface_config', { hallOfFame: { publicRange: { gradeRankLimit: 4, classRankLimit: 10, includeTies: true } } });
    state = await ctx.request({ uid: 'student-100' }); assert.equal(entries(state).length, 4); cases++;
  }
  {
    const ctx = setup(2001);
    await assert.rejects(() => ctx.request(), error => error.details?.reason === 'WIS_HALL_ACCOUNT_LIMIT_EXCEEDED');
    assert.equal(ctx.store.queries.length, 1); assert.equal(ctx.store.queries[0].limit, 2001);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('semester_wis_accounts/')).length, 1);
    cases++;
  }
  {
    const ctx = setup();
    ctx.store.patch(rankingPath('2026-2', 'student-0'), { accountId: 'forged' });
    ctx.store.patch(rankingPath('2026-2', 'student-1'), { rankEarnedTotal: Number.NaN });
    ctx.store.patch(accountPath('2026-2', 'student-2'), { semesterId: '2026-1' });
    const state = await ctx.request(); assert.equal(entries(state).length, 5);
    assert.ok(!entries(state).some(row => [0, 1, 2].some(i => row.uid === publicId('2026-2', `student-${i}`)))); cases++;
  }
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
  console.log(JSON.stringify({ passed: true, cases, network: 0,
    guarantees: ['ranking projection only; no account/ledger collection scans', '30s TTL, pending dedup, four-entry cache and failed-build retry',
      'fresh session, permissions, semester, actor and candidate canonical scope', 'fresh profiles and policy only for final five',
      'ties, public limits, zero score, test identities, archive semantics and 2000 cap', 'no polling, timers, writes or reserved instances'] }));
};
run().catch(error => { console.error(error); process.exitCode = 1; });
