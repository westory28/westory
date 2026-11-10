// Emulator only: firebase emulators:exec --only firestore --config firebase.student-access-test.json --project demo-westory-quiz-live "node scripts/verify-quiz-live-rules.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDocFromServer, getDocsFromServer, setDoc, updateDoc, deleteDoc, Timestamp, onSnapshot, setLogLevel } from 'firebase/firestore';

const projectId = 'demo-westory-quiz-live';
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Dedicated synthetic project required');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18220', 'Local emulator required; production forbidden');
setLogLevel('silent');
const rules = readFileSync('firestore.rules', 'utf8');
console.log(`RULES SHA256 ${createHash('sha256').update(rules).digest('hex')}`);
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18220, rules } });
const authTime = Math.floor(Date.now() / 1000) - 60;
const email = uid => uid === 'admin' ? 'westoria28@gmail.com' : `${uid}@yongshin-ms.ms.kr`;
const client = (uid, time = authTime) => env.authenticatedContext(uid, { email: email(uid), auth_time: time }).firestore();
const seed = (path, data) => env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), path), data));
let checks = 0;
const check = async (label, allowed, operation) => {
  await (allowed ? assertSucceeds(operation()) : assertFails(operation()));
  checks++; console.log(`PASS ${label}`);
};
const session = (status = 'active', expiry = Date.now() + 3600000) => ({ schemaVersion: 2, status, authTime, authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, sessionRevision: 'a'.repeat(64), authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(expiry) });
const analysisPaths = ['quiz_class_analysis_state/2026-2', 'quiz_class_analysis_state/2026-2/classes/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'];
const signalPath = id => `quiz_result_correction_signals/${id}`;
const read = (db, path) => getDocFromServer(doc(db, path));

try {
  await env.clearFirestore();
  await seed('site_settings/config', { year: '2026', semester: '2', activeSemesterId: '2026-2' });
  await seed('site_settings/semester_active', { semesterId: '2026-2', revision: 1 });
  await seed('semester_manifests/2026-2', { semesterId: '2026-2', status: 'ACTIVE', revision: 1, readOnly: false });
  for (const [uid, role, permissions, portal] of [
    ['admin', 'teacher', [], true], ['teacher', 'teacher', [], true],
    ['quiz-reader', 'staff', ['quiz_read'], true], ['ordinary-staff', 'staff', [], true],
    ['disabled-reader', 'staff', ['quiz_read'], false], ['student-a', 'student', [], false], ['student-b', 'student', [], false],
    ['pending-student', 'student', [], false],
  ]) {
    await seed(`users/${uid}`, { uid, email: email(uid), role, registrationApprovalStatus: uid === 'pending-student' ? 'PENDING' : 'APPROVED', teacherPortalEnabled: portal, staffPermissions: permissions });
    await seed(`application_sessions/${uid}/sessions/${authTime}`, session());
  }
  for (const path of analysisPaths) await seed(path, { revision: 1, updatedAt: Timestamp.now() });
  for (const [id, studentUid, semesterId] of [['own', 'student-a', '2026-2'], ['foreign', 'student-b', '2026-2'], ['past', 'student-a', '2026-1'], ['pending', 'pending-student', '2026-2'], ['missing-signal', 'student-a', '2026-2']]) {
    await seed(`semester_assessment_results/${id}`, { studentUid, semesterId, assessmentKind: 'QUIZ', score: 50 });
    if (id !== 'missing-signal') await seed(signalPath(id), { revision: 1, updatedAt: Timestamp.now() });
  }
  await seed(signalPath('orphan'), { revision: 1 });
  for (const uid of ['admin', 'teacher', 'quiz-reader', 'ordinary-staff', 'disabled-reader', 'student-a']) {
    const db = client(uid), privileged = ['admin', 'teacher', 'quiz-reader'].includes(uid);
    for (const path of [...analysisPaths, 'quiz_class_analysis_state/2026-2/classes/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'])
      await check(`${uid}: analysis document get ${path}`, privileged, () => read(db, path));
    await check(`${uid}: past analysis denied`, false, () => read(db, 'quiz_class_analysis_state/2026-1'));
    await check(`${uid}: analysis root list denied`, false, () => getDocsFromServer(collection(db, 'quiz_class_analysis_state')));
    await check(`${uid}: analysis classes list denied`, false, () => getDocsFromServer(collection(db, 'quiz_class_analysis_state/2026-2/classes')));
    await check(`${uid}: correction own result`, privileged || uid === 'student-a', () => read(db, signalPath('own')));
    await check(`${uid}: correction foreign result`, privileged, () => read(db, signalPath('foreign')));
    await check(`${uid}: correction past result`, privileged, () => read(db, signalPath('past')));
    await check(`${uid}: absent correction for existing result`, privileged || uid === 'student-a', () => read(db, signalPath('missing-signal')));
    await check(`${uid}: orphan correction denied`, false, () => read(db, signalPath('orphan')));
    await check(`${uid}: correction list denied`, false, () => getDocsFromServer(collection(db, 'quiz_result_correction_signals')));
    for (const path of [...analysisPaths, signalPath('own')]) {
      await check(`${uid}: signal update denied ${path}`, false, () => updateDoc(doc(db, path), { revision: 999 }));
      await check(`${uid}: signal delete denied ${path}`, false, () => deleteDoc(doc(db, path)));
    }
    await check(`${uid}: analysis create denied`, false, () => setDoc(doc(db, 'quiz_class_analysis_state/2026-2/classes/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'), { revision: 1 }));
    await check(`${uid}: correction create denied`, false, () => setDoc(doc(db, signalPath('missing-signal')), { revision: 1 }));
  }
  const unauthenticated = env.unauthenticatedContext().firestore();
  for (const path of [...analysisPaths, signalPath('own')])
    await check(`anonymous denied ${path}`, false, () => read(unauthenticated, path));
  await check('student-b can read own correction', true, () => read(client('student-b'), signalPath('foreign')));
  await check('student-b cannot read another correction', false, () => read(client('student-b'), signalPath('own')));
  await check('pending student correction denied', false, () => read(client('pending-student'), signalPath('pending')));
  for (const uid of ['teacher', 'student-a']) {
    const path = uid === 'teacher' ? analysisPaths[0] : signalPath('own');
    await check(`${uid}: missing session denied`, false, () => read(client(uid, authTime + 1), path));
    await seed(`application_sessions/${uid}/sessions/${authTime}`, session('active', Date.now() - 60000));
    await check(`${uid}: expired session denied`, false, () => read(client(uid), path));
    await seed(`application_sessions/${uid}/sessions/${authTime}`, session());
    let unsubscribe;
    let resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const revoked = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`${uid}: listener did not reject revocation`)), 8000);
      unsubscribe = onSnapshot(doc(client(uid), path), snapshot => { if (!snapshot.metadata.fromCache) resolveReady(); }, error => {
        clearTimeout(timer);
        if (error.code === 'permission-denied') resolve(); else { rejectReady(error); reject(error); }
      });
    });
    await ready;
    await seed(`application_sessions/${uid}/sessions/${authTime}`, session('closed'));
    await seed(path, { revision: 2, updatedAt: Timestamp.now() });
    await revoked; unsubscribe(); checks++; console.log(`PASS ${uid}: live listener revoked`);
    await check(`${uid}: revoked session read denied`, false, () => read(client(uid), path));
    await seed(`application_sessions/${uid}/sessions/${authTime}`, session());
  }
  await seed('site_settings/student_maintenance', { enabled: true, blockedRoles: ['student'], bypassUids: [], title: '합성 점검', message: '합성 검증', startedAt: Timestamp.now(), updatedAt: Timestamp.now(), updatedBy: 'teacher', revision: 1 });
  await check('maintenance blocks student correction', false, () => read(client('student-a'), signalPath('own')));
  await check('maintenance retains permitted teacher analysis', true, () => read(client('teacher'), analysisPaths[0]));
  await seed('site_settings/student_maintenance', { enabled: false, blockedRoles: ['student'], bypassUids: [], title: '합성 점검', message: '합성 검증', startedAt: null, updatedAt: Timestamp.now(), updatedBy: 'teacher', revision: 2 });
  await seed('site_settings/config', { year: '2027', semester: '1', activeSemesterId: '2027-1' });
  await seed('semester_manifests/2027-1', { semesterId: '2027-1', status: 'ACTIVE', revision: 2, readOnly: false });
  await seed('site_settings/semester_active', { semesterId: '2027-1', revision: 2 });
  for (const path of analysisPaths) await check('semester transition revokes old analysis', false, () => read(client('teacher'), path));
  await check('semester transition permits new absent analysis', true, () => read(client('teacher'), 'quiz_class_analysis_state/2027-1'));
  await check('semester transition revokes old student signal', false, () => read(client('student-a'), signalPath('own')));
  await seed('semester_assessment_results/new-semester', { studentUid: 'student-a', semesterId: '2027-1', assessmentKind: 'QUIZ', score: 50 });
  await check('semester transition permits new own absent signal', true, () => read(client('student-a'), signalPath('new-semester')));
  console.log(`PASS quiz live rules: ${checks} assertions; exact-document reads, role/owner/semester fences, absent signals, no list/write, live revocation and maintenance; emulator only.`);
} finally {
  await env.cleanup();
}
