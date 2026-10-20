const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createFirestoreStore } = require('../productionGateway/commandGateway');
const { setup, addStudent, accountPath, previewPath, slotPath, policyPath, publicId } = require('./verify-wis-ranking-preview.cjs');

const scope = '2026-2';
const full = (ctx, options = {}) => ctx.request({ uid: 'teacher', audience: 'teacher', projection: 'hall-index', ...options });
const original = (ctx, options = {}) => ctx.request({ uid: 'teacher', audience: 'teacher', projection: 'hall-of-fame', ...options });
const hallBody = state => Object.fromEntries(Object.entries(state.hallOfFame)
  .filter(([key]) => !['updatedAt', 'updatedAtMs', 'sourceUpdatedAtMs'].includes(key)));
const visible = state => new Set([state.hallOfFame.gradeLeaderboardByGrade, state.hallOfFame.classLeaderboardByClassKey]
  .flatMap(group => Object.values(group).flat()).map(entry => entry.uid));
const place = (ctx, index, { grade = '3', classNumber = '1', score = 1000 - index, ...options } = {}) => {
  const uid = addStudent(ctx.store, index, { grade, score, ...options });
  const classId = `class-${scope}-${grade}-${classNumber}`;
  ctx.store.set(`semester_classes/${classId}`, { classId, semesterId: scope, grade, classNumber, status: 'ACTIVE' });
  ctx.store.patch(`semester_enrollments/enrollment-${scope}-${index}`, { classId, snapshot: { grade, classNumber } });
  ctx.store.patch(accountPath(scope, uid), { classId, classNumber });
  ctx.store.patch(previewPath(scope, uid), { classId, classNumber });
  return uid;
};
const school = () => {
  const ctx = setup(0);
  for (let index = 0; index < 321; index++) place(ctx, index, {
    grade: String(1 + Math.floor(index / 107)), classNumber: String(1 + index % 6), score: 3000 - index,
  });
  return ctx;
};
const noPrivateResponse = state => {
  assert.equal(state.account, null);
  for (const key of ['accounts', 'ledger', 'products', 'inventory', 'orders', 'rankings']) assert.deepEqual(state[key], []);
  assert.equal(state.writeCount, 0); assert.equal(JSON.stringify(state).includes('large transaction'), false);
  assert.equal(JSON.stringify(state).includes('studentUid'), false); assert.ok(state.hallOfFameConfig);
};
const oneIndexQuery = (store, grade) => {
  assert.equal(store.queries.length, 1); const [query] = store.queries;
  assert.equal(query.collection, 'semester_wis_preview_entries'); assert.equal(query.limit, 2001);
  assert.equal(query.orderBy, undefined);
  assert.deepEqual(query.filters, [{ field: 'semesterId', operator: '==', value: scope },
    { field: 'eligible', operator: '==', value: true },
    ...(grade ? [{ field: 'grade', operator: '==', value: grade }] : [])]);
};
const tests = [], metrics = {};
const test = (name, run) => tests.push({ name, run });

test('teacher full hall preserves every grade/class map and verifies only the published union', async () => {
  const ctx = school(); ctx.store.resetStats();
  const started = process.hrtime.bigint(); const state = await full(ctx);
  metrics.teacher321Ms = Number(process.hrtime.bigint() - started) / 1e6;
  oneIndexQuery(ctx.store); noPrivateResponse(state);
  assert.deepEqual(Object.keys(state.hallOfFame.gradeLeaderboardByGrade), ['1', '2', '3']);
  assert.equal(Object.keys(state.hallOfFame.classLeaderboardByClassKey).length, 18);
  const ids = visible(state); metrics.teacher321Visible = ids.size;
  const accountReads = ctx.store.reads.filter(path => path.startsWith('semester_wis_accounts/'));
  assert.equal(accountReads.length, ids.size); assert.ok(accountReads.length < 321);
  assert.equal(accountReads.length, new Set(accountReads).size);
  assert.equal(ctx.store.reads.filter(path => path.startsWith('users/') && path !== 'users/teacher').length, ids.size);
  assert.equal(ctx.store.reads.filter(path => path === policyPath(scope)).length, 1);
  assert.equal(ctx.store.reads.length, new Set(ctx.store.reads).size);
  const masked = ctx.store.getAllCalls.filter(call => call.fieldMask);
  assert.ok(masked.length > 0);
  for (const call of masked) {
    assert.ok(call.paths.every(path => path.startsWith('semester_wis_accounts/')));
    assert.ok(call.fieldMask.includes('rankEarnedTotal')); assert.ok(call.fieldMask.includes('hallZeroEligible'));
    assert.equal(call.fieldMask.includes('recentLedgerEntries'), false); assert.equal(call.fieldMask.includes('balance'), false);
  }
  assert.ok(ctx.store.getAllCalls.filter(call => !call.fieldMask).every(call =>
    call.paths.every(path => !path.startsWith('semester_wis_accounts/'))));
  const previous = await original(ctx); assert.deepEqual(hallBody(state), hallBody(previous));
});

test('student returns only the current own grade and own class while omitting the personal account', async () => {
  const ctx = school(); ctx.store.resetStats(); const uid = 'student-300';
  const state = await full(ctx, { uid, audience: 'student' });
  oneIndexQuery(ctx.store, '3'); noPrivateResponse(state);
  assert.deepEqual(Object.keys(state.hallOfFame.gradeLeaderboardByGrade), ['3']);
  assert.deepEqual(Object.keys(state.hallOfFame.classLeaderboardByClassKey), ['3-1']);
  assert.equal(state.hallOfFame.primaryGradeKey, '3');
  assert.equal(ctx.store.reads.filter(path => path === accountPath(scope, uid)).length, 1);
  const previous = await original(ctx, { uid, audience: 'student' }); assert.deepEqual(hallBody(state), hallBody(previous));
});

test('class-only candidates do not renumber grades using the narrower visible union', async () => {
  const ctx = setup(0);
  for (let index = 0; index < 70; index++) place(ctx, index, { classNumber: index < 50 ? '1' : '2', score: 1000 - index });
  const state = await full(ctx), previous = await original(ctx);
  assert.deepEqual(hallBody(state), hallBody(previous));
  assert.equal(state.hallOfFame.classLeaderboardByClassKey['3-2'][0].rank, 1);
  assert.equal(state.hallOfFame.classLeaderboardByClassKey['3-2'][0].cumulativeEarned, 950);
  assert.equal(state.hallOfFame.gradeLeaderboardByGrade['3'].length, 10);
});

test('positive ties retain the twenty-person cap in every group for both tie policies', async () => {
  for (const includeTies of [true, false]) {
    const ctx = setup(0);
    for (let index = 0; index < 90; index++) place(ctx, index, { classNumber: String(1 + index % 3), score: 100 });
    ctx.store.set('site_settings/interface_config', { hallOfFame: { publicRange: { gradeRankLimit: 4, classRankLimit: 7, includeTies } } });
    const state = await full(ctx), previous = await original(ctx); assert.deepEqual(hallBody(state), hallBody(previous));
    assert.equal(state.hallOfFame.gradeLeaderboardByGrade['3'].length, includeTies ? 20 : 4);
    for (const rows of Object.values(state.hallOfFame.classLeaderboardByClassKey)) {
      assert.equal(rows.length, includeTies ? 20 : 7); assert.ok(rows.every(row => row.rank === 1));
      assert.deepEqual(rows.map(row => row.uid), rows.map(row => row.uid).sort((a, b) => a.localeCompare(b)));
    }
  }
});

test('zero-score fill, closed accounts, test names and active classes keep legacy full semantics', async () => {
  const ctx = setup(0);
  for (let index = 0; index < 30; index++) place(ctx, index, { classNumber: String(1 + index % 3),
    score: index < 2 ? 100 : 0, status: index === 4 ? 'CLOSED' : 'ACTIVE', name: index === 5 ? '방테스트' : `학생 ${index}` });
  ctx.store.patch('semester_classes/class-2026-2-3-3', { status: 'CLOSED' });
  const state = await full(ctx), previous = await original(ctx); assert.deepEqual(hallBody(state), hallBody(previous));
  assert.equal(state.hallOfFame.gradeLeaderboardByGrade['3'].length, 5);
  assert.ok(!visible(state).has(publicId(scope, 'student-4'))); assert.ok(!visible(state).has(publicId(scope, 'student-5')));
});

test('fresh score decreases fill both grade and class groups with the next indexed candidates', async () => {
  const ctx = setup(0);
  for (let index = 0; index < 80; index++) place(ctx, index, { score: 1000 - index });
  for (let index = 0; index < 20; index++) ctx.store.patch(accountPath(scope, `student-${index}`), { rankEarnedTotal: 0 });
  ctx.store.resetStats(); const state = await full(ctx);
  oneIndexQuery(ctx.store); assert.equal(ctx.store.reads.length, new Set(ctx.store.reads).size);
  assert.equal(ctx.store.reads.filter(path => path.startsWith('semester_wis_accounts/')).length, 30);
  assert.equal(ctx.store.reads.filter(path => path.startsWith('users/') && path !== 'users/teacher').length, 10);
  assert.equal(state.hallOfFame.gradeLeaderboardByGrade['3'][0].cumulativeEarned, 980);
  const previous = await original(ctx); assert.deepEqual(hallBody(state), hallBody(previous));
});

test('fresh grade/class changes relocate students and refill former groups rather than globally dropping them', async () => {
  const ctx = setup(0);
  for (let index = 0; index < 40; index++) place(ctx, index, { grade: '3', classNumber: index < 20 ? '1' : '2', score: 1000 - index });
  // Canonical snapshot grade/class overrides class directory grade/class.
  ctx.store.patch(`semester_enrollments/enrollment-${scope}-0`, { snapshot: { grade: '1', classNumber: '7' }, displayName: '새 학적 이름' });
  ctx.store.patch(`semester_enrollments/enrollment-${scope}-20`, { snapshot: { grade: '2', classNumber: '8' } });
  ctx.store.resetStats(); const state = await full(ctx); oneIndexQuery(ctx.store);
  assert.equal(state.hallOfFame.primaryGradeKey, '1');
  assert.equal(state.hallOfFame.gradeLeaderboardByGrade['1'][0].studentName, '새 학적 이름');
  assert.equal(state.hallOfFame.classLeaderboardByClassKey['1-7'][0].uid, publicId(scope, 'student-0'));
  assert.equal(state.hallOfFame.classLeaderboardByClassKey['2-8'][0].uid, publicId(scope, 'student-20'));
  assert.equal(state.hallOfFame.classLeaderboardByClassKey['3-1'].length, 10);
  assert.equal(state.hallOfFame.classLeaderboardByClassKey['3-2'].length, 10);
  const previous = await original(ctx); assert.deepEqual(hallBody(state), hallBody(previous));
});

test('fresh deletion, withdrawal and newly renamed test accounts refill public groups without leaking stale names', async () => {
  const ctx = setup(0);
  for (let index = 0; index < 35; index++) place(ctx, index, { score: 1000 - index });
  ctx.store.docs.delete(accountPath(scope, 'student-0'));
  ctx.store.patch(`semester_enrollments/enrollment-${scope}-1`, { enrollmentStatus: 'WITHDRAWN' });
  ctx.store.patch(`semester_enrollments/enrollment-${scope}-2`, { displayName: 'BangTest' });
  ctx.store.patch(`semester_enrollments/enrollment-${scope}-3`, { displayName: '최신 이름' });
  ctx.store.resetStats(); const state = await full(ctx); oneIndexQuery(ctx.store);
  assert.ok([0, 1, 2].every(index => !visible(state).has(publicId(scope, `student-${index}`))));
  assert.equal(state.hallOfFame.gradeLeaderboardByGrade['3'][0].studentName, '최신 이름');
  assert.equal(state.hallOfFame.gradeLeaderboardByGrade['3'].length, 10);
  const previous = await original(ctx); assert.deepEqual(hallBody(state), hallBody(previous));
});

test('student never receives another grade after stale-index movement', async () => {
  const ctx = setup(0);
  for (let index = 0; index < 40; index++) place(ctx, index, { grade: '3', classNumber: index < 20 ? '1' : '2', score: 1000 - index });
  ctx.store.patch(`semester_enrollments/enrollment-${scope}-0`, { snapshot: { grade: '2', classNumber: '9' }, displayName: '다른 학년 이름' });
  ctx.store.patch(`semester_enrollments/enrollment-${scope}-1`, { snapshot: { grade: '3', classNumber: '2' } });
  const state = await full(ctx, { uid: 'student-30', audience: 'student' });
  assert.deepEqual(Object.keys(state.hallOfFame.gradeLeaderboardByGrade), ['3']);
  assert.deepEqual(Object.keys(state.hallOfFame.classLeaderboardByClassKey), ['3-2']);
  assert.equal(JSON.stringify(state).includes('다른 학년 이름'), false);
  assert.ok(state.hallOfFame.classLeaderboardByClassKey['3-2'].some(row => row.uid === publicId(scope, 'student-1')));
  const previous = await original(ctx, { uid: 'student-30', audience: 'student' }); assert.deepEqual(hallBody(state), hallBody(previous));
});

test('current policy and profiles are applied only to the final published union on every request', async () => {
  const ctx = setup(0); for (let index = 0; index < 35; index++) place(ctx, index);
  await full(ctx);
  ctx.store.set(policyPath(scope), { rankPolicy: { emojiRegistry: [
    { id: 'smile', emoji: '😀', enabled: true }, { id: 'trophy', emoji: '🏆', enabled: false },
  ] } });
  ctx.store.patch('users/student-0', { profileEmojiId: 'smile' });
  ctx.store.resetStats(); const state = await full(ctx); oneIndexQuery(ctx.store);
  assert.equal(state.rankPolicy.emojiRegistry[1].enabled, false);
  const rows = [...Object.values(state.hallOfFame.gradeLeaderboardByGrade), ...Object.values(state.hallOfFame.classLeaderboardByClassKey)].flat();
  assert.ok(rows.every(row => row.profileIcon === '😀'));
  assert.equal(ctx.store.reads.filter(path => path.startsWith('users/') && path !== 'users/teacher').length, visible(state).size);
  assert.equal(ctx.store.reads.filter(path => path === policyPath(scope)).length, 1);
});

test('every request rechecks permissions, session, actor enrollment and preparing-semester guards', async () => {
  const ctx = setup(); await full(ctx);
  ctx.store.patch('users/teacher', { staffPermissions: [] });
  await assert.rejects(() => full(ctx), error => error.details?.reason === 'WIS_MANAGE_REQUIRED');
  ctx.store.patch('users/teacher', { staffPermissions: ['point_read'] }); ctx.denySession();
  await assert.rejects(() => full(ctx), /session revoked/);
  const preparing = setup(); preparing.store.patch('semester_manifests/2026-2', { status: 'PREPARING' });
  assert.equal((await full(preparing, { uid: 'student-11', audience: 'student' })).reason, 'PREPARING_STUDENT_DATA_HIDDEN');
  const inactive = setup(); inactive.store.patch(slotPath(scope, 'student-11'), { activeEnrollmentId: '' });
  const empty = await full(inactive, { uid: 'student-11', audience: 'student' });
  assert.equal(empty.reason, 'WIS_ACTIVE_ENROLLMENT_REQUIRED'); assert.equal(inactive.store.queries.length, 0);
});

test('single-query failures are surfaced once; another explicit call can recover without cached authority', async () => {
  const ctx = setup(); ctx.store.failRankingQueries = 1;
  await assert.rejects(() => full(ctx), /synthetic read failure/); assert.equal(ctx.store.queries.length, 1);
  ctx.store.resetStats(); await full(ctx); oneIndexQuery(ctx.store);
  ctx.advance(31_000); ctx.store.resetStats(); await full(ctx); oneIndexQuery(ctx.store);
});

test('the complete input is capped before account scans and malformed index rows fail closed', async () => {
  const capped = setup(0);
  for (let index = 0; index < 2001; index++) place(capped, index, { score: 100 });
  await assert.rejects(() => full(capped), error => error.details?.reason === 'WIS_HALL_ACCOUNT_LIMIT_EXCEEDED');
  oneIndexQuery(capped.store); assert.equal(capped.store.reads.filter(path => path.startsWith('semester_wis_accounts/')).length, 0);
  const ctx = setup(35);
  ctx.store.patch(previewPath(scope, 'student-0'), { accountId: 'forged' });
  ctx.store.patch(previewPath(scope, 'student-1'), { publicId: 'forged' });
  ctx.store.patch(previewPath(scope, 'student-2'), { rankEarnedTotal: NaN });
  const state = await full(ctx); assert.ok([0, 1, 2].every(index => !visible(state).has(publicId(scope, `student-${index}`))));
});

test('EXPLICIT archive keeps stored historical fields, missing ranking metadata, full maps and zero policy', async () => {
  const ctx = school(); ctx.store.patch('semester_manifests/2026-2', { status: 'ARCHIVED' });
  for (let index = 0; index < 321; index++) {
    ctx.store.docs.delete(slotPath(scope, `student-${index}`));
    ctx.store.patch(previewPath(scope, `student-${index}`), { grade: '9', classNumber: '9', eligible: false });
    ctx.store.patch(`semester_wis_rankings/${ctx.store.docs.get(accountPath(scope, `student-${index}`)).accountId}`, { grade: '', classNumber: '' });
  }
  ctx.store.resetStats(); const state = await full(ctx, { source: 'EXPLICIT' });
  assert.equal(ctx.store.queries.length, 1); assert.equal(ctx.store.queries[0].collection, 'semester_wis_accounts');
  assert.equal(ctx.store.queries[0].limit, 2001); assert.equal(state.provenance, 'EXPLICIT'); assert.equal(state.readOnly, true);
  assert.ok(ctx.store.queries[0].fieldMask.includes('grade'));
  assert.equal(ctx.store.queries[0].fieldMask.includes('recentLedgerEntries'), false);
  noPrivateResponse(state); assert.deepEqual(Object.keys(state.hallOfFame.gradeLeaderboardByGrade), ['1', '2', '3']);
  const previous = await original(ctx, { source: 'EXPLICIT' }); assert.deepEqual(hallBody(state), hallBody(previous));
  const zero = setup();
  for (let index = 0; index < 12; index++) zero.store.patch(accountPath(scope, `student-${index}`), { rankEarnedTotal: 0 });
  const empty = await full(zero, { source: 'EXPLICIT' }); assert.equal(visible(empty).size, 0);
});

test('Firestore field masks reach actual getAll/select options while default reads remain unchanged', async () => {
  const calls = [];
  const body = { rankEarnedTotal: 25, displayName: '합성 학생', recentLedgerEntries: [{ private: true }] };
  const document = (ref, fields) => ({ ref, exists: true, data: () => fields
    ? Object.fromEntries(fields.map(field => [field, body[field]])) : { ...body } });
  const makeQuery = () => ({ kind: 'query', fields: undefined,
    where() { return this; }, limit() { return this; },
    select(...fields) { this.fields = fields; calls.push({ kind: 'select', fields }); return this; },
    async get() { return { docs: [document({ path: 'fixtures/one' }, this.fields)] }; },
  });
  const db = { doc: path => ({ path }), collection: () => makeQuery(),
    runTransaction: callback => callback({
      getAll: async (...args) => {
        const options = args.at(-1)?.fieldMask ? args.pop() : undefined;
        calls.push({ kind: 'getAll', options, paths: args.map(ref => ref.path) });
        return args.map(ref => document(ref, options?.fieldMask));
      },
      get: async query => ({ docs: [document({ path: 'fixtures/one' }, query.fields)] }),
    }),
  };
  const store = createFirestoreStore(db, { readOnly: true });
  await store.runTransaction(async transaction => {
    const masked = await transaction.getAll(['fixtures/one'], { fieldMask: ['rankEarnedTotal', 'displayName'] });
    const ordinary = await transaction.getAll(['fixtures/one']);
    assert.equal(masked[0].data.recentLedgerEntries, undefined); assert.ok(ordinary[0].data.recentLedgerEntries);
    const compactQuery = await transaction.query('fixtures', { limit: 5, fieldMask: ['rankEarnedTotal'] });
    const fullQuery = await transaction.query('fixtures', { limit: 5 });
    assert.deepEqual(compactQuery[0].data, { rankEarnedTotal: 25 }); assert.ok(fullQuery[0].data.recentLedgerEntries);
  });
  assert.deepEqual(calls.filter(call => call.kind === 'getAll').map(call => call.options),
    [{ fieldMask: ['rankEarnedTotal', 'displayName'] }, undefined]);
  const compact = await store.query('fixtures', { fieldMask: ['rankEarnedTotal'] });
  const unchanged = await store.query('fixtures');
  assert.deepEqual(compact[0].data, { rankEarnedTotal: 25 }); assert.ok(unchanged[0].data.recentLedgerEntries);
  assert.equal(calls.filter(call => call.kind === 'select').length, 2);
});

test('transport allows only hall-of-fame or default preview and preserves the existing warm instance options', async () => {
  let received, options;
  const exports = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../wisRankingPreview'), 'utf8'), { exports, require: name => {
    if (name === 'firebase-admin/firestore') return { getFirestore: () => ({}) };
    if (name === './productionGateway/commandGateway') return { createFirestoreStore: () => ({}) };
    if (name === './productionGateway/wisEconomyQuery') return { createWisQueryCore: () => ({ getWisEconomyState: request => { received = request; } }) };
    if (name === './productionGateway/studentMaintenance') return { onCallWithStudentMaintenance: (configuration, handler) => { options = configuration; return handler; } };
    throw new Error('Unexpected dependency');
  } });
  for (const [input, expected] of [['hall-of-fame', 'hall-index'], [undefined, 'ranking-preview'], ['hall-index', 'ranking-preview'], ['catalog', 'ranking-preview'], ['account', 'ranking-preview']]) {
    const request = { auth: { uid: 'actor' }, data: { projection: input, _session: { id: 'proof' } } };
    await exports.getWisRankingPreview(request); assert.equal(received.data.projection, expected);
    assert.equal(received.auth, request.auth); assert.equal(received.data._session, request.data._session); assert.equal(request.data.projection, input);
  }
  assert.equal(options.minInstances, 1); assert.equal(options.maxInstances, 3); assert.equal(options.concurrency, 80);
  assert.equal(options.memory, '256MiB'); assert.equal(options.region, 'us-central1');
});

(async () => {
  for (const item of tests) {
    try { await item.run(); } catch (error) { error.message = `${item.name}: ${error.message}`; throw error; }
  }
  console.log(JSON.stringify({ passed: true, cases: tests.length, network: 0, metrics,
    guarantees: ['one bounded lightweight current-index query', 'published grade/class union only, with fresh canonical replacement',
      'all grade/class limits, ties, zero fill, current profiles and policy preserved', 'student own grade/class and no account/ledger payload',
      'stored EXPLICIT archive and old full endpoint unchanged', 'existing standby reused without polling or automatic query retries'] }));
})().catch(error => { console.error(error); process.exitCode = 1; });
