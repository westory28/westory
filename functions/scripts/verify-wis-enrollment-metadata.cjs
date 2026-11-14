const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const projectId = 'demo-westory-session-enrollment-wis';
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:1';
const enrollment = require('../productionGateway/archiveEnrollment');
const gateway = require('../productionGateway/commandGateway');
const { queryWisOverviewPage } = require('../wisOverviewQuery');
const { setup, accountPath, publicId, slotPath } = require('./verify-wis-ranking-preview.cjs');
const scope = '2026-2', uid = 'student-0', stamp = '2026-11-14T10:00:00.000Z';
const metadata = ['enrollmentId', 'classId', 'grade', 'classNumber', 'studentNumber', 'displayName', 'updatedAt', 'updatedBy'];
const withoutMetadata = value => Object.fromEntries(Object.entries(value).filter(([key]) => !metadata.includes(key)));
const fixture = (count = 2) => {
  const ctx = setup(count), store = ctx.store;
  const original = store.docs.get(accountPath(scope, uid));
  const accountId = original.accountId;
  const projections = ['semester_wis_accounts', 'semester_wis_balances', 'semester_wis_rankings'].map(collection => `${collection}/${accountId}`);
  store.patch(projections[0], { revision: 4, earnedTotal: 1100, rankEarnedTotal: 1100, spentTotal: 100, adjustedTotal: 0 });
  const account = store.docs.get(projections[0]);
  store.set(projections[1], { ...account, ledgerRevision: 4 });
  store.set(projections[2], { ...account, ledgerRevision: 4 });
  store.patch(`semester_enrollments/${original.enrollmentId}`, { revision: 1 });
  store.patch(slotPath(scope, uid), { revision: 1, status: 'ACTIVE' });
  store.set(`student_identities/${uid}`, { studentUid: uid, displayName: '이동 학생', accountStatus: 'ACTIVE', revision: 1 });
  store.set('semester_classes/next-class', { classId: 'next-class', semesterId: scope, status: 'ACTIVE', grade: '3', classNumber: '2', displayName: '3학년 2반' });
  store.set('semester_wis_ledger/immutable', { accountId, amount: 1000, revision: 4 });
  let queue = Promise.resolve();
  const commandStore = { get: path => store.get(path), runTransaction(callback) {
    const task = queue.then(async () => {
      const next = structuredClone(store.docs);
      const stats = { reads: [], readBatches: [], writes: [] };
      let writing = false;
      const transaction = {
        async get(path) { assert.equal(writing, false, 'all Firestore reads precede writes'); stats.reads.push(path); return { path, exists: next.has(path), data: structuredClone(next.get(path)) }; },
        getAll(paths) { stats.readBatches.push([...paths]); return Promise.all(paths.map(path => transaction.get(path))); },
        set(path, value, options) { writing = true; stats.writes.push(path); next.set(path, structuredClone(options?.merge ? { ...next.get(path), ...value } : value)); },
        create(path, value) { assert.equal(next.has(path), false); transaction.set(path, value); },
      };
      const result = await callback(transaction); store.docs = next; store.lastTransactionStats = stats; return result;
    });
    queue = task.catch(() => {}); return task;
  } };
  const sessions = [];
  const core = gateway.createCommandGatewayCore({ store: commandStore, projectId,
    assertSession: async (request, options) => {
      sessions.push(options);
      if (request.sessionRejected) throw new Error('expired session');
      return { uid: request.auth.uid, email: request.auth.token.email };
    }, commandAdapters: Object.fromEntries(Object.values(enrollment.ARCHIVE_ENROLLMENT_COMMAND_TYPES)
      .map(type => [type, enrollment.createArchiveEnrollmentCommandAdapter()])),
    serverTimestamp: () => stamp, concreteTimestamp: () => stamp });
  const request = () => ({ auth: { uid: 'admin', token: { email: 'westoria28@gmail.com' } }, data: {
    commandId: randomUUID(), commandType: 'moveEnrollment', payload: { semesterId: scope, studentUid: uid,
      activeEnrollmentId: original.enrollmentId, expectedRevision: 1, targetClassId: 'next-class',
      studentNumber: '7', effectiveAt: '2026-11-14', reason: '학급 이동' },
  } });
  return { ...ctx, store, core, sessions, projections, request, requestRanking: ctx.request, oldEnrollmentId: original.enrollmentId };
};
const leaderboard = state => Object.values(state.hallOfFame.gradeLeaderboardByGrade).flat();
const ranking = (ctx, classKey) => ctx.requestRanking({ uid: 'teacher', audience: 'teacher', rankingMetric: 'current', rankingClassKey: classKey });
const overview = (store, classNumber) => queryWisOverviewPage(store, { semesterId: scope, limit: 20, overview: {
  grade: '3', classNumber, studentNumber: '', namePrefix: '', sortField: 'balance', direction: 'desc' } });
const unchangedReject = async (f, request, expected) => {
  const before = structuredClone(f.store.docs);
  await assert.rejects(() => f.core.execute(request), error => error.details?.reason === expected);
  assert.deepEqual(f.store.docs, before);
};
const closeRequest = f => ({ ...f.request(), data: { commandId: randomUUID(), commandType: 'closeEnrollment', payload: {
  semesterId: scope, studentUid: uid, activeEnrollmentId: f.oldEnrollmentId, expectedRevision: 1,
  targetStatus: 'WITHDRAWN', effectiveTo: '2026-11-14', reason: '전출' } } });
const upsertRequest = f => ({ ...f.request(), data: { commandId: randomUUID(), commandType: 'upsertEnrollment', payload: {
  semesterId: scope, expectedSemesterRevision: 3, studentUid: uid, classId: 'next-class', studentNumber: '7',
  displayName: '재등록 학생', effectiveFrom: '2026-11-14', sourceType: 'MANUAL_EXCEPTION', sourceId: 'return', reason: '재등록' } } });
const importRequest = async (f, students = [uid]) => {
  const payload = { semesterId: scope, expectedSemesterRevision: 3, rosterId: 'return-roster', importRevision: 1,
    sourceLabel: '재등록 명단', sourceHash: 'a'.repeat(64), effectiveFrom: '2026-11-14', expectedStudentUids: students,
    classes: [{ grade: '3', classNumber: '2', displayName: '3학년 2반', homeroomTeacherUid: 'teacher' }],
    entries: students.map((studentUid, index) => ({ studentUid, displayName: '재등록 학생', classKey: '3::2',
      studentNumber: students.length === 1 ? '7' : String(index + 1) })), reason: '재등록' };
  const validation = await enrollment.validateRoster({ reader: f.store, payload: enrollment.normalizeRosterContract(payload) });
  assert.equal(validation.passed, true);
  return { ...f.request(), data: { commandId: randomUUID(), commandType: 'importEnrollmentRoster',
    payload: { ...payload, validationHash: validation.validationHash } } };
};

test('real move command synchronizes ranking/overview class filters and preserves every financial field', async () => {
  const f = fixture();
  assert(leaderboard(await ranking(f, '3-1')).some(row => row.uid === publicId(scope, uid)));
  assert.equal((await overview(f.store, '2')).rows.length, 0);
  const before = new Map(f.projections.map(path => [path, structuredClone(f.store.docs.get(path))]));
  const economy = structuredClone(f.store.docs.get(`semester_wis_economies/${scope}`));
  const ledger = structuredClone(f.store.docs.get('semester_wis_ledger/immutable'));
  const response = await f.core.execute(f.request());
  assert.equal(response.status, 'SUCCEEDED');
  for (const path of f.projections) {
    const row = f.store.docs.get(path);
    assert.deepEqual(withoutMetadata(row), withoutMetadata(before.get(path)));
    assert.equal(row.enrollmentId, response.result.enrollmentId);
    assert.equal(row.classId, 'next-class'); assert.equal(row.grade, '3'); assert.equal(row.classNumber, '2');
    assert.equal(row.studentNumber, '7'); assert.equal(row.displayName, '이동 학생');
  }
  assert.equal(f.store.docs.get(`semester_enrollments/${f.oldEnrollmentId}`).enrollmentStatus, 'TRANSFERRED');
  assert.equal(leaderboard(await ranking(f, '3-1')).some(row => row.uid === publicId(scope, uid)), false);
  assert.equal(leaderboard(await ranking(f, '3-2'))[0].uid, publicId(scope, uid));
  assert.equal((await overview(f.store, '1')).rows.some(row => row.studentUid === uid), false);
  assert.equal((await overview(f.store, '2')).rows[0].studentUid, uid);
  assert.deepEqual(f.store.docs.get(`semester_wis_economies/${scope}`), economy);
  assert.deepEqual(f.store.docs.get('semester_wis_ledger/immutable'), ledger);
});

test('same command receipt retries once; competing move preserves account revisions and rejects stale enrollment', async () => {
  const f = fixture(), request = f.request();
  const results = await Promise.all([f.core.execute(request), f.core.execute(request)]);
  assert.equal(results.filter(result => result.replayed).length, 1);
  assert.equal(f.store.docs.get(f.projections[0]).revision, 4);
  const after = structuredClone(f.store.docs);
  assert.equal((await f.core.execute(request)).replayed, true);
  assert.deepEqual(f.store.docs, after);
  await unchangedReject(f, f.request(), 'ENROLLMENT_ACTIVE_CONFLICT');
});

test('students and ordinary teachers cannot use administrator move; high-risk session checks remain', async () => {
  for (const role of ['student', 'teacher']) {
    const f = fixture(), request = f.request(); request.auth = { uid: role, token: { email: `${role}@example.invalid` } };
    await unchangedReject(f, request, 'COMMAND_ADMIN_REQUIRED');
    assert.deepEqual(f.sessions[0], { recentAuth: true, highRisk: true });
  }
  const f = fixture(), request = f.request(); request.sessionRejected = true;
  const before = structuredClone(f.store.docs); await assert.rejects(() => f.core.execute(request), /expired session/);
  assert.deepEqual(f.store.docs, before);
});

test('students without any Wis projections retain the existing move and receive no account writes', async () => {
  const f = fixture(); for (const path of f.projections) f.store.docs.delete(path);
  await f.core.execute(f.request());
  for (const path of f.projections) assert.equal(f.store.docs.has(path), false);
});

test('partial or corrupt wallet projections abort the complete move without overwrites', async () => {
  const cases = [
    [f => f.store.docs.delete(f.projections[1]), 'STUDENT_PROFILE_WIS_PROJECTION_INCOMPLETE'],
    [f => f.store.docs.delete(f.projections[0]), 'STUDENT_PROFILE_WIS_PROJECTION_INCOMPLETE'],
    [f => f.store.patch(f.projections[1], { studentUid: 'different' }), 'STUDENT_PROFILE_WIS_SCOPE_INVALID'],
    [f => f.store.patch(f.projections[2], { semesterId: '2026-1' }), 'STUDENT_PROFILE_WIS_SCOPE_INVALID'],
    [f => f.store.patch(f.projections[1], { balance: 999 }), 'STUDENT_PROFILE_WIS_PROJECTION_INVALID'],
    [f => f.store.patch(f.projections[1], { ledgerRevision: 3 }), 'STUDENT_PROFILE_WIS_PROJECTION_INVALID'],
    [f => f.store.patch(f.projections[2], { rankEarnedTotal: 999 }), 'STUDENT_PROFILE_WIS_PROJECTION_INVALID'],
    [f => f.store.patch(f.projections[0], { spentTotal: -1 }), 'STUDENT_PROFILE_WIS_PROJECTION_INVALID'],
  ];
  for (const [mutate, reason] of cases) { const f = fixture(); mutate(f); await unchangedReject(f, f.request(), reason); }
});

test('close preserves all wallet fields, then upsert/import registration synchronizes metadata atomically', async () => {
  for (const makeRequest of [upsertRequest, importRequest]) {
    const f = fixture(), before = new Map(f.projections.map(path => [path, structuredClone(f.store.docs.get(path))]));
    const economy = structuredClone(f.store.docs.get(`semester_wis_economies/${scope}`));
    const ledger = structuredClone(f.store.docs.get('semester_wis_ledger/immutable'));
    await f.core.execute(closeRequest(f));
    for (const path of f.projections) assert.deepEqual(f.store.docs.get(path), before.get(path), 'CLOSE is unchanged');
    const request = await makeRequest(f), response = await f.core.execute(request);
    assert.equal(response.status, 'SUCCEEDED');
    const activeId = f.store.docs.get(slotPath(scope, uid)).activeEnrollmentId;
    assert.notEqual(activeId, f.oldEnrollmentId);
    for (const path of f.projections) {
      const row = f.store.docs.get(path);
      assert.deepEqual(withoutMetadata(row), withoutMetadata(before.get(path)));
      assert.equal(row.enrollmentId, activeId); assert.equal(row.grade, '3'); assert.equal(row.classNumber, '2');
      assert.equal(row.studentNumber, '7'); assert.equal(row.displayName, '재등록 학생');
    }
    assert.equal((await overview(f.store, '1')).rows.some(row => row.studentUid === uid), false);
    assert.equal((await overview(f.store, '2')).rows[0].studentUid, uid);
    assert.equal(leaderboard(await ranking(f, '3-2'))[0].uid, publicId(scope, uid));
    assert.deepEqual(f.store.docs.get(`semester_wis_economies/${scope}`), economy);
    assert.deepEqual(f.store.docs.get('semester_wis_ledger/immutable'), ledger);
    const after = structuredClone(f.store.docs);
    assert.equal((await f.core.execute(request)).replayed, true);
    assert.deepEqual(f.store.docs, after);
  }
});

test('upsert/import partial projections fail before any roster or wallet writes', async () => {
  for (const makeRequest of [upsertRequest, importRequest]) {
    const f = fixture(); await f.core.execute(closeRequest(f));
    f.store.docs.delete(f.projections[1]);
    await unchangedReject(f, await makeRequest(f), 'STUDENT_PROFILE_WIS_PROJECTION_INCOMPLETE');
  }
});

test('upsert/import registration without a wallet keeps all projections absent', async () => {
  for (const makeRequest of [upsertRequest, importRequest]) {
    const f = fixture(); await f.core.execute(closeRequest(f));
    for (const path of f.projections) f.store.docs.delete(path);
    await f.core.execute(await makeRequest(f));
    for (const path of f.projections) assert.equal(f.store.docs.has(path), false);
  }
});

test('preparing upsert/import preserve cutover enrollment receipts and never read or write existing Wis', async () => {
  for (const makeRequest of [upsertRequest, importRequest]) {
    const f = fixture(); await f.core.execute(closeRequest(f));
    f.store.patch(`semester_manifests/${scope}`, { status: 'PREPARING' });
    const before = new Map(f.projections.map(path => [path, structuredClone(f.store.docs.get(path))]));
    await f.core.execute(await makeRequest(f));
    for (const path of f.projections) assert.deepEqual(f.store.docs.get(path), before.get(path));
    assert.equal(f.store.lastTransactionStats.reads.some(path => path.startsWith('semester_wis_')), false);
    assert.equal(f.store.lastTransactionStats.writes.some(path => path.startsWith('semester_wis_')), false);
    for (const [path, row] of f.store.docs) if (path.startsWith('command_receipts/'))
      assert.equal(row.target.refs.some(ref => ref.startsWith('semester_wis_')), false);
  }
});

test('maximum 120-student reimport batches exactly 360 projection reads and writes; import replay adds no metadata reads/writes', async () => {
  const f = fixture(120), students = Array.from({ length: 120 }, (_, index) => `student-${index}`);
  const before = new Map();
  for (const studentUid of students) {
    const path = accountPath(scope, studentUid), original = f.store.docs.get(path);
    const account = { ...original, revision: 4, earnedTotal: 1100, rankEarnedTotal: 1100, spentTotal: 100, adjustedTotal: 0 };
    f.store.set(path, account); before.set(path, account);
    for (const collection of ['semester_wis_balances', 'semester_wis_rankings'])
      f.store.set(`${collection}/${account.accountId}`, { ...account, ledgerRevision: 4 });
    f.store.patch(slotPath(scope, studentUid), { status: 'WITHDRAWN', activeEnrollmentId: null });
    f.store.patch(`semester_enrollments/${account.enrollmentId}`, { enrollmentStatus: 'WITHDRAWN' });
    f.store.set(`student_identities/${studentUid}`, { studentUid, displayName: '재등록 학생', accountStatus: 'ACTIVE', revision: 1 });
  }
  const request = await importRequest(f, students); await f.core.execute(request);
  const stats = f.store.lastTransactionStats;
  const isProjection = path => /^semester_wis_(accounts|balances|rankings)\//.test(path);
  assert.equal(stats.reads.filter(isProjection).length, 360);
  assert.equal(stats.writes.filter(isProjection).length, 360);
  assert.equal(stats.readBatches.filter(paths => paths.some(isProjection)).length, 1);
  for (const [path, value] of before) {
    assert.deepEqual(withoutMetadata(f.store.docs.get(path)), withoutMetadata(value));
    assert.equal(f.store.docs.get(path).classNumber, '2');
  }
  await f.core.execute({ ...request, data: { ...request.data, commandId: randomUUID() } });
  assert.equal(f.store.lastTransactionStats.reads.filter(isProjection).length, 0);
  assert.equal(f.store.lastTransactionStats.writes.filter(isProjection).length, 0);
});
