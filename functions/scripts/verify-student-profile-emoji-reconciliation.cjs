const assert = require('node:assert/strict');
const {
  createStudentProfileEmojiReconciliationService,
  createStudentProfileEmojiReconciliationTriggers,
} = require('../studentProfileEmojiReconciliation');
const { accountIdFor } = require('../studentWisWallet');

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const policy = () => ({ rankPolicy: {
  tiers: [
    { code: 'tier_1', minPoints: 0, allowedEmojiIds: ['smile'] },
    { code: 'tier_2', minPoints: 50, allowedEmojiIds: ['rocket'] },
  ],
  emojiRegistry: [
    { id: 'smile', emoji: '😀', enabled: true, unlockTierCode: 'tier_1' },
    { id: 'rocket', emoji: '🚀', enabled: true, unlockTierCode: 'tier_2' },
  ],
  emojiPolicy: { enabled: true, defaultEmojiId: 'smile' },
} });
const account = (uid, semesterId = '2026-2', rankEarnedTotal = 100) => ({
  accountId: accountIdFor(semesterId, uid), studentUid: uid, semesterId,
  schemaVersion: 1, policyVersion: 'w7-v1', status: 'ACTIVE', readOnly: false,
  revision: 1, rankEarnedTotal, balance: 444, earnedTotal: 888,
});
const selected = { role: 'student', profileEmojiId: 'rocket', profileIcon: '🚀', displayName: '학생' };

// Firestore-shaped transactional store with version checks, retries, paginated
// queries and real handlers. No Firebase network calls or production data.
function fixture(extra = {}) {
  const values = new Map(), versions = new Map(), writes = [], queries = [];
  let beforeCommit, attempts = 0, activeTransactions = 0, maximumConcurrency = 0;
  const put = (path, data) => { values.set(path, clone(data)); versions.set(path, (versions.get(path) || 0) + 1); };
  const remove = (path) => { values.delete(path); versions.set(path, (versions.get(path) || 0) + 1); };
  const snapshot = (path) => ({
    id: path.split('/').at(-1), ref: reference(path), exists: values.has(path),
    data: () => clone(values.get(path)),
  });
  const reference = (path) => ({ path, get: async () => snapshot(path) });
  const query = (path, state = {}) => ({
    where: (field, operator, value) => { assert.equal(operator, '=='); return query(path, { ...state, field, value }); },
    orderBy: () => query(path, state),
    limit: (limit) => query(path, { ...state, limit }),
    startAfter: (cursor) => query(path, { ...state, cursor: cursor.id }),
    get: async () => {
      queries.push({ path, ...state });
      const docs = [...values.keys()].filter((key) => key.startsWith(`${path}/`) && key.split('/').length === 2)
        .map(snapshot).filter((row) => row.data()?.[state.field] === state.value)
        .filter((row) => !state.cursor || row.id > state.cursor)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, state.limit);
      return { docs };
    },
  });
  const db = {
    doc: reference, collection: (path) => query(path),
    runTransaction: async (run) => {
      activeTransactions += 1;
      maximumConcurrency = Math.max(maximumConcurrency, activeTransactions);
      try {
        for (let retry = 0; retry < 5; retry += 1) {
          attempts += 1;
          const reads = new Map(), pending = [];
          const get = async (ref) => { assert.equal(pending.length, 0, 'All reads precede writes'); reads.set(ref.path, versions.get(ref.path) || 0); return snapshot(ref.path); };
          const result = await run({
            get, getAll: (...refs) => Promise.all(refs.map(get)),
            set: (ref, data, options) => { assert.deepEqual(options, { merge: true }); pending.push([ref.path, data]); },
          });
          if (beforeCommit) { const hook = beforeCommit; beforeCommit = undefined; await hook(); }
          if ([...reads].some(([path, version]) => (versions.get(path) || 0) !== version)) continue;
          for (const [path, data] of pending) {
            writes.push({ path, data: clone(data) });
            put(path, { ...values.get(path), ...data });
          }
          return result;
        }
        throw Error('Transaction retry limit reached');
      } finally { activeTransactions -= 1; }
    },
  };
  const seed = {
    'site_settings/semester_active': { semesterId: '2026-2', revision: 4 },
    'semester_manifests/2026-2': { semesterId: '2026-2', status: 'ACTIVE', revision: 4 },
    'years/2026/semesters/2/point_policies/current': policy(),
    'users/student': selected,
    [`semester_wis_accounts/${accountIdFor('2026-2', 'student')}`]: account('student'),
    ...extra,
  };
  for (const [path, data] of Object.entries(seed)) if (data !== undefined) put(path, data);
  return {
    db, values, writes, queries, put, remove,
    service: createStudentProfileEmojiReconciliationService({ db, serverTimestamp: () => 'server-timestamp' }),
    conflictOnce: (hook) => { beforeCommit = hook; },
    get attempts() { return attempts; },
    get maximumConcurrency() { return maximumConcurrency; },
  };
}
const event = (before, after, params = {}) => ({
  params, data: {
    before: { exists: before !== undefined, data: () => clone(before) },
    after: { exists: after !== undefined, data: () => clone(after) },
  },
});
const accountPath = `semester_wis_accounts/${accountIdFor('2026-2', 'student')}`;

(async () => {
  const scoreDown = fixture();
  const originalAccount = clone(scoreDown.values.get(accountPath));
  scoreDown.put(accountPath, { ...originalAccount, rankEarnedTotal: 0 });
  const dry = await scoreDown.service.inspectStudent('student');
  assert.equal(dry.status, 'updated'); assert.equal(dry.applied, false);
  assert.deepEqual(dry.before, { profileEmojiId: 'rocket', profileIcon: '🚀' });
  assert.deepEqual(dry.after, { profileEmojiId: 'smile', profileIcon: '😀' });
  assert.equal(scoreDown.writes.length, 0, 'Inspection performs no writes');
  await scoreDown.service.handleAccountWritten(event(originalAccount, scoreDown.values.get(accountPath), { accountId: originalAccount.accountId }));
  assert.equal(scoreDown.values.get('users/student').profileIcon, '😀');
  assert.deepEqual(scoreDown.writes, [{ path: 'users/student', data: { profileEmojiId: 'smile', profileIcon: '😀', updatedAt: 'server-timestamp' } }]);
  assert.deepEqual(scoreDown.values.get(accountPath), { ...originalAccount, rankEarnedTotal: 0 }, 'No wallet, score or ranking writes');
  await scoreDown.service.handleAccountWritten(event(originalAccount, scoreDown.values.get(accountPath), { accountId: originalAccount.accountId }));
  await scoreDown.service.handleUserWritten(event(selected, scoreDown.values.get('users/student'), { uid: 'student' }));
  assert.equal(scoreDown.writes.length, 1, 'Duplicate and self-induced events settle without writes');
  const stableProfile = scoreDown.values.get('users/student');
  assert.equal(await scoreDown.service.handleUserWritten(event(stableProfile, { ...stableProfile, updatedAt: 'later' }, { uid: 'student' })), null);

  const valid = fixture();
  assert.equal((await valid.service.reconcileStudent('student')).status, 'valid');
  await valid.service.handleAccountWritten(event(account('student', '2026-2', 100), account('student', '2026-2', 0)));
  assert.equal(valid.writes.length, 0, 'A stale score-down event re-reads and preserves the currently valid choice');
  valid.put('users/student', { ...selected, profileEmojiId: 'smile', profileIcon: '😀' });
  await valid.service.handleUserWritten(event(undefined, selected, { uid: 'student' }));
  assert.equal(valid.writes.length, 0, 'A stale profile event preserves the latest valid selection');

  const mismatch = fixture({ 'users/student': { ...selected, profileEmojiId: 'smile' } });
  assert.equal((await mismatch.service.reconcileStudent('student')).reason, 'id_icon_mismatch');
  assert.equal(mismatch.values.get('users/student').profileIcon, '😀');
  for (const rankEarnedTotal of [-1, '100', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture({ [accountPath]: { ...account('student'), rankEarnedTotal } });
    assert.equal((await f.service.reconcileStudent('student')).rankEarnedTotal, 0);
  }
  for (const change of [{ status: 'CLOSED' }, { readOnly: true }, { studentUid: 'someone-else' }, { semesterId: '2026-1' }, { accountId: 'forged' }, { schemaVersion: 0 }, { policyVersion: 'legacy' }, { revision: 0 }]) {
    const f = fixture({ [accountPath]: { ...account('student'), ...change } });
    assert.equal((await f.service.reconcileStudent('student')).accountValid, false);
    assert.equal(f.values.get('users/student').profileIcon, '😀');
  }
  const missing = fixture({ [accountPath]: undefined, 'years/2026/semesters/2/point_wallets/student': { rankEarnedTotal: 999999 } });
  assert.equal((await missing.service.reconcileStudent('student')).rankEarnedTotal, 0, 'A legacy wallet never restores access');

  const policyChange = fixture();
  const changedPolicy = policy(); changedPolicy.rankPolicy.tiers[1].minPoints = 200;
  policyChange.put('years/2026/semesters/2/point_policies/current', changedPolicy);
  await policyChange.service.handlePolicyWritten(event(policy(), changedPolicy, { year: '2026', semester: '2', policyId: 'current' }));
  assert.equal(policyChange.values.get('users/student').profileIcon, '😀');
  const queryCount = policyChange.queries.length;
  assert.equal(await policyChange.service.handlePolicyWritten(event(policy(), changedPolicy, { year: '2026', semester: '1', policyId: 'current' })), null);
  assert.equal(await policyChange.service.handlePolicyWritten(event(policy(), changedPolicy, { year: '2026', semester: '2', policyId: 'draft' })), null);
  assert.equal(policyChange.queries.length, queryCount, 'Historical and draft policy events never scan students');
  const stalePolicy = fixture();
  await stalePolicy.service.handlePolicyWritten(event(policy(), changedPolicy, { year: '2026', semester: '2', policyId: 'current' }));
  assert.equal(stalePolicy.writes.length, 0, 'An old policy event uses the latest policy and preserves valid selections');

  const semesterChange = fixture();
  semesterChange.put('site_settings/semester_active', { semesterId: '2027-1', revision: 1 });
  semesterChange.put('semester_manifests/2027-1', { semesterId: '2027-1', revision: 1, status: 'ACTIVE' });
  semesterChange.put('years/2027/semesters/1/point_policies/current', policy());
  await semesterChange.service.handleSemesterWritten(event({ semesterId: '2026-2', revision: 4 }, { semesterId: '2027-1', revision: 1 }));
  assert.equal(semesterChange.values.get('users/student').profileIcon, '😀', 'The new semester cannot inherit prior rank access');
  assert.equal(semesterChange.values.get(accountPath).rankEarnedTotal, 100);

  for (const extra of [
    { 'site_settings/semester_active': undefined },
    { 'site_settings/semester_active': { semesterId: '../2026-2', revision: 4 } },
    { 'semester_manifests/2026-2': undefined },
    { 'semester_manifests/2026-2': { semesterId: '2026-2', status: 'CLOSED', revision: 4 } },
    { 'semester_manifests/2026-2': { semesterId: '2026-2', status: 'ACTIVE', revision: 5 } },
  ]) {
    const f = fixture(extra);
    assert.equal((await f.service.reconcileStudent('student')).reason, 'active_semester_unavailable');
    assert.equal(f.writes.length, 0, 'Unavailable authority does not mutate profiles');
  }
  for (const profile of [{ role: 'student' }, { ...selected, role: 'teacher' }, { ...selected, deletedAt: 'deleted' }, { ...selected, isDeleted: true }]) {
    const f = fixture({ 'users/student': profile });
    assert.equal((await f.service.reconcileStudent('student')).status, 'skipped'); assert.equal(f.writes.length, 0);
  }

  const race = fixture({ [accountPath]: account('student', '2026-2', 0) });
  race.conflictOnce(() => race.put('users/student', { ...selected, profileEmojiId: 'smile', profileIcon: '😀' }));
  assert.equal((await race.service.reconcileStudent('student')).status, 'valid');
  assert.equal(race.attempts, 2, 'A concurrent valid selection retries the transaction');
  assert.equal(race.writes.length, 0);
  const guarded = fixture({ [accountPath]: account('student', '2026-2', 0) });
  const inspection = await guarded.service.inspectStudent('student');
  guarded.put('users/student', { ...selected, profileEmojiId: 'unknown', profileIcon: '👑' });
  assert.equal((await guarded.service.reconcileStudent('student', { expectedBefore: inspection.before })).reason, 'profile_changed');
  assert.equal(guarded.writes.length, 0, 'Backup/apply compare-and-set protects concurrent edits');
  const semesterGuard = fixture({ [accountPath]: account('student', '2026-2', 0) });
  assert.equal((await semesterGuard.service.inspectStudent('student', { expectedSemesterId: '2026-1' })).reason, 'semester_changed');
  semesterGuard.conflictOnce(() => semesterGuard.put('site_settings/semester_active', { semesterId: '2027-1', revision: 1 }));
  assert.equal((await semesterGuard.service.reconcileStudent('student', { expectedSemesterId: '2026-2' })).reason, 'semester_changed');
  assert.equal(semesterGuard.writes.length, 0, 'A semester change between backup and commit never resets a new-semester profile');
  const expected = fixture({ [accountPath]: account('student', '2026-2', 0) });
  const expectedInspection = await expected.service.inspectStudent('student', { expectedSemesterId: '2026-2' });
  assert.equal((await expected.service.reconcileStudent('student', {
    expectedBefore: expectedInspection.before, expectedSemesterId: '2026-2',
  })).applied, true, 'An unchanged backed-up profile applies normally');

  const paginated = fixture({ 'users/student': { role: 'teacher' } });
  for (let index = 0; index < 17; index += 1) paginated.put(`users/student${String(index).padStart(2, '0')}`, selected);
  const totals = await paginated.service.reconcileAll({ pageSize: 5, concurrency: 3, apply: false });
  assert.deepEqual(totals, { scanned: 17, updated: 17, valid: 0, skipped: 0, applied: 0 });
  assert.equal(paginated.queries.length, 4); assert.ok(paginated.maximumConcurrency <= 3);
  assert.equal(paginated.writes.length, 0);
  await paginated.service.reconcileAll({ pageSize: 5, concurrency: 3 });
  assert.equal(paginated.writes.length, 17);

  const registrations = [];
  const exports = createStudentProfileEmojiReconciliationTriggers({ db: valid.db, register: (options, handler) => { registrations.push(options); return handler; } });
  assert.equal(Object.keys(exports).length, 4);
  assert.deepEqual(registrations.map((row) => row.document), [
    'users/{uid}', 'semester_wis_accounts/{accountId}',
    'years/{year}/semesters/{semester}/point_policies/{policyId}', 'site_settings/semester_active',
  ]);
  assert.ok(registrations.every((row) => row.region === 'asia-northeast3' && row.database === '(default)' && row.retry === true));
  console.log('PASS student profile emoji reconciliation: current account/policy/semester authority, bounded scans, stale/duplicate events, transaction retries, backup CAS and profile-only writes.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
