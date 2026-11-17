const assert = require('node:assert/strict');
const fs = require('node:fs');
const projectId = 'demo-westory-session-shortcuts';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^127\.0\.0\.1:\d+$/.test(host) || process.env.GCLOUD_PROJECT !== projectId)
  throw new Error('Use the dedicated local demo-westory-session-shortcuts emulator only.');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, DocumentReference } = require('firebase-admin/firestore');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const client = require('firebase/firestore');
const { createStudentLearningShortcutsHandler, SHORTCUT_IDS } = require('../studentLearningShortcuts');
const entrypoint = fs.readFileSync(require('node:path').resolve(__dirname, '../index.js'), 'utf8');
assert.match(entrypoint, /const collectKnownUserStudentDataRefs[\s\S]*?users\/\$\{uid\}\/preferences\/studentLearningTools[\s\S]*?refsByPath\.set\(shortcutRef\.path, shortcutRef\)/,
  'Account deletion must collect the exact preference document without a broad preferences scan');
const { buildEnrollmentSlotId } = require('../productionGateway/archiveEnrollment');
const app = initializeApp({ projectId }), db = getFirestore(app);
const scope = '2026-2', epoch = Math.floor(Date.now() / 1000), sessionRevision = 'b'.repeat(64);
let metrics = { reads: 0, writes: 0 }, checks = 0;
const originalDocumentGet = DocumentReference.prototype.get;
DocumentReference.prototype.get = async function (...args) {
  const value = await originalDocumentGet.apply(this, args); metrics.reads++; return value;
};
const instrumented = {
  doc: path => db.doc(path),
  runTransaction: (body, options) => db.runTransaction(async tx => body({
    async get(ref) { metrics.reads++; return tx.get(ref); },
    async getAll(...refs) { metrics.reads += refs.length; return tx.getAll(...refs); },
    set(...args) { metrics.writes++; tx.set(...args); },
  }), options),
};
const api = createStudentLearningShortcutsHandler({ db: instrumented });
const request = (uid, data = {}) => ({ auth: { uid, token: { email: `${uid}@yongshin-ms.ms.kr`, auth_time: epoch } },
  data: { action: 'get', semesterId: scope, ...data, _session: {
    authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: sessionRevision,
  } } });
const read = (uid = 'a', data = {}) => api(request(uid, data));
const save = (items, expectedRevision, uid = 'a', data = {}) => read(uid, { action: 'save', items, expectedRevision, ...data });
const reason = expected => error => error.details?.reason === expected;
const reset = () => { metrics = { reads: 0, writes: 0 }; };
const counts = {};
async function seed() {
  assert.equal((await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok, true);
  const rows = {
    'site_settings/semester_active': { semesterId: scope, revision: 1 },
    'site_settings/config': { year: '2026', semester: '2', activeSemesterId: scope },
    [`semester_manifests/${scope}`]: { semesterId: scope, status: 'ACTIVE', revision: 1 },
    'semester_classes/class_one': { semesterId: scope, status: 'ACTIVE' },
    'site_settings/student_maintenance': { enabled: false, blockedRoles: ['student'], bypassUids: [],
      title: '접속 설정', message: '합성 검증', startedAt: null, updatedAt: Timestamp.now(), updatedBy: 'teacher', revision: 1 },
  };
  for (const uid of ['a', 'b', 'teacher']) {
    rows[`users/${uid}`] = { role: uid === 'teacher' ? 'teacher' : 'student', email: `${uid}@yongshin-ms.ms.kr`, registrationApprovalStatus: 'APPROVED' };
    rows[`application_sessions/${uid}/sessions/${epoch}`] = { status: 'active', authTime: epoch, schemaVersion: 2,
      authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, sessionRevision, authorityModeAtOpen: 'ENFORCE',
      generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000), highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 3600000) };
    rows[`semester_enrollment_slots/${buildEnrollmentSlotId(scope, uid)}`] = { semesterId: scope, studentUid: uid, activeEnrollmentId: `en_${uid}`, status: 'ACTIVE' };
    rows[`semester_enrollments/en_${uid}`] = { semesterId: scope, studentUid: uid, classId: 'class_one', enrollmentStatus: 'ACTIVE' };
  }
  await Promise.all(Object.entries(rows).map(([path, value]) => db.doc(path).set(value)));
  reset();
}
async function check(name, callback) { await seed(); await callback(); checks++; console.log(`PASS ${name}`); }
let rules;
(async () => {
  await check('account preferences have bounded reads, zero-write get/no-op and one-write changed order', async () => {
    assert.deepEqual(await read(), { items: [], revision: 0 }); counts.get = { ...metrics };
    assert.equal(metrics.reads, 10); assert.equal(metrics.writes, 0);
    reset(); assert.deepEqual(await save([], 0), { items: [], revision: 0 }); counts.noop = { ...metrics };
    assert.equal(metrics.reads, 10); assert.equal(metrics.writes, 0);
    reset(); assert.deepEqual(await save(['calendar', 'lesson'], 0), { items: ['calendar', 'lesson'], revision: 1 }); counts.save = { ...metrics };
    assert.equal(metrics.reads, 10); assert.equal(metrics.writes, 1);
    assert.deepEqual(await read(), { items: ['calendar', 'lesson'], revision: 1 });
    assert.deepEqual(await read('b'), { items: [], revision: 0 });
    reset(); assert.deepEqual(await save(['calendar', 'lesson'], 0), { items: ['calendar', 'lesson'], revision: 1 }); counts.lostResponseRetry = { ...metrics };
    assert.equal(metrics.writes, 0);
    assert.deepEqual(await save(['lesson', 'calendar'], 1), { items: ['lesson', 'calendar'], revision: 2 });
    const stored = (await db.doc('users/a/preferences/studentLearningTools').get()).data();
    assert.deepEqual(Object.keys(stored).sort(), ['items', 'revision', 'schemaVersion', 'updatedAt']);
  });
  await check('simultaneous device edits commit once, stale edits reject and explicit reload/retry succeeds', async () => {
    const results = await Promise.allSettled([save(['lesson'], 0), save(['maps'], 0)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const failure = results.find(result => result.status === 'rejected');
    assert.equal(failure.reason.details.reason, 'SHORTCUTS_REVISION_CONFLICT');
    const fresh = await read(); assert.equal(fresh.revision, 1);
    assert.deepEqual(await save(SHORTCUT_IDS, fresh.revision), { items: SHORTCUT_IDS, revision: 2 });
    assert.deepEqual(await save([], 2), { items: [], revision: 3 });
  });
  await check('identity, session, registration, scope and canonical enrollment reject without writes', async () => {
    const noProof = request('a'); delete noProof.data._session;
    await assert.rejects(api(noProof), error => error.code === 'unauthenticated');
    await assert.rejects(read('teacher'), reason('SHORTCUTS_STUDENT_REQUIRED'));
    await assert.rejects(read('a', { studentId: 'b' }), reason('SHORTCUTS_INPUT_INVALID'));
    await assert.rejects(read('a', { semesterId: '2026-1' }), reason('SHORTCUTS_SEMESTER_INACTIVE'));
    await db.doc('users/a').update({ registrationApprovalStatus: 'PENDING' });
    await assert.rejects(read());
    await db.doc('users/a').update({ registrationApprovalStatus: 'APPROVED' });
    await db.doc('users/a').update({ registrationApprovalStatus: require('firebase-admin/firestore').FieldValue.delete() });
    assert.deepEqual(await read(), { items: [], revision: 0 });
    await db.doc('semester_enrollments/en_a').update({ studentUid: 'b' });
    await assert.rejects(read(), reason('SHORTCUTS_ENROLLMENT_REQUIRED'));
    await db.doc('semester_enrollments/en_a').update({ studentUid: 'a' });
    await db.doc('semester_classes/class_one').update({ status: 'ARCHIVED' });
    await assert.rejects(read(), reason('SHORTCUTS_CLASS_REQUIRED'));
    assert.equal(metrics.writes, 0);
  });
  await check('input allowlist, duplicate IDs, revisions and malformed stored values fail closed', async () => {
    for (const items of [['unknown'], ['lesson', 'lesson'], Array(7).fill('maps'), 'lesson', null])
      await assert.rejects(save(items, 0), reason('SHORTCUTS_INPUT_INVALID'));
    for (const revision of [-1, 0.5, null]) await assert.rejects(save(['lesson'], revision), reason('SHORTCUTS_INPUT_INVALID'));
    await assert.rejects(read('a', { items: ['lesson'] }), reason('SHORTCUTS_INPUT_INVALID'));
    await db.doc('users/a/preferences/studentLearningTools').set({ schemaVersion: 1, items: ['foreign'], revision: 1 });
    await assert.rejects(read(), reason('SHORTCUTS_STATE_INVALID')); assert.equal(metrics.writes, 0);
  });
  await check('new active semester preserves account choices while stale-semester calls are denied', async () => {
    await save(['weplay', 'avatar-shop'], 0);
    const next = '2027-1';
    await Promise.all([
      db.doc('site_settings/semester_active').set({ semesterId: next, revision: 1 }),
      db.doc(`semester_manifests/${next}`).set({ semesterId: next, revision: 1, status: 'ACTIVE' }),
      db.doc(`semester_enrollment_slots/${buildEnrollmentSlotId(next, 'a')}`).set({ semesterId: next, studentUid: 'a', activeEnrollmentId: 'next_a', status: 'ACTIVE' }),
      db.doc('semester_enrollments/next_a').set({ semesterId: next, studentUid: 'a', classId: 'next_class', enrollmentStatus: 'ACTIVE' }),
      db.doc('semester_classes/next_class').set({ semesterId: next, status: 'ACTIVE' }),
    ]);
    reset(); await assert.rejects(read(), reason('SHORTCUTS_SEMESTER_INACTIVE'));
    assert.deepEqual(await read('a', { semesterId: next }), { items: ['weplay', 'avatar-shop'], revision: 1 });
    assert.equal(metrics.writes, 0);
  });
  await check('preferences remain callable-only for owner, other student and teacher under existing rules', async () => {
    await save(['wispi'], 0);
    rules = await initializeTestEnvironment({ projectId, firestore: { host: host.split(':')[0], port: Number(host.split(':')[1]), rules: fs.readFileSync('firestore.rules', 'utf8') } });
    for (const uid of ['a', 'b', 'teacher']) {
      const connection = rules.authenticatedContext(uid, { email: `${uid}@yongshin-ms.ms.kr`, auth_time: epoch }).firestore();
      const ref = client.doc(connection, 'users/a/preferences/studentLearningTools');
      await assertFails(client.getDoc(ref));
      await assertFails(client.setDoc(ref, { schemaVersion: 1, items: ['maps'], revision: 1 }));
    }
  });
  console.log(JSON.stringify({ passed: true, checks, counts }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (rules) await rules.cleanup(); await deleteApp(app);
});
