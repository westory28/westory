const assert = require('node:assert/strict');
const projectId = process.env.GCLOUD_PROJECT;
assert.equal(projectId, 'demo-westory-session-roster-performance');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18194');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({ projectId }), db = getFirestore(app);
db.settings({ host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false });
const { callableExports, SESSION_AUTHORITY_GENERATION, MIN_CLIENT_PROTOCOL_VERSION } = require('../sessionAuthority');
const { onCallWithStudentMaintenance } = require('../studentMaintenance');
const { createTeacherStudentRosterHandler } = require('../teacherStudentRoster');
const callable = onCallWithStudentMaintenance({ region: 'us-central1' }, createTeacherStudentRosterHandler({ db }));
const authTime = Math.floor(Date.now() / 1000);
const users = [
  ...Array.from({ length: 321 }, (_, index) => ({ id: `student-${index}`, role: 'student', email: `student-${index}@yongshin-ms.ms.kr`, studentName: `합성학생${index}`, grade: '3', class: String(Math.floor(index / 27) + 1), number: index % 27 + 1, avatar: 'x'.repeat(10000) })),
  { id: 'legacy', studentName: '구형학생', gradeClass: '3학년 1반 1번' },
  { id: 'legacy-alias', grade: 3, name: '이전형식학생' },
  { id: 'admin-test', role: 'teacher', email: 'westoria28@gmail.com', studentName: '관리자테스트' },
  { id: 'pending', role: 'student', registrationApprovalStatus: null },
  { id: 'teacher', role: 'teacher', email: 'teacher@yongshin-ms.ms.kr' },
  { id: 'reader', role: 'staff', email: 'reader@yongshin-ms.ms.kr', teacherPortalEnabled: true, staffPermissions: ['student_list_read'] },
  { id: 'staff', role: 'staff', email: 'staff@yongshin-ms.ms.kr' },
];
const sessions = new Map();
const request = (uid, data = {}) => ({ auth: { uid, token: { email: users.find(row => row.id === uid)?.email, auth_time: authTime } }, data });
const rosterRequest = (uid, extra = {}) => request(uid, { year: '2026', semester: '2', _session: sessions.get(uid), ...extra });
const open = async uid => {
  const session = await callableExports.openApplicationSession.run(request(uid, {
    authorityGeneration: SESSION_AUTHORITY_GENERATION, protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
  }));
  sessions.set(uid, { authorityGeneration: session.authorityGeneration, protocolVersion: session.protocolVersion, revision: session.revision });
};
(async () => {
  const batch = db.batch();
  for (const { id, ...data } of users) batch.set(db.doc(`users/${id}`), data);
  batch.set(db.doc('site_settings/config'), { year: '2026', semester: '2' });
  batch.set(db.doc('site_settings/school_config'), { grades: [{ value: '3', label: '3학년' }], classes: [{ value: '1', label: '1반' }], unrelated: 'not returned' });
  await batch.commit();
  for (const uid of ['teacher', 'reader', 'staff', 'student-0']) await open(uid);
  const before = (await db.collection('users').get()).docs.map(doc => [doc.id, doc.updateTime.toMillis()]);
  const sessionRef = db.doc(`application_sessions/teacher/sessions/${authTime}`);
  const sessionBefore = (await sessionRef.get()).updateTime.toMillis();
  const result = await callable.run(rosterRequest('teacher'));
  assert.equal(result.students.length, 325);
  assert.ok(result.students.some(row => row.id === 'legacy'));
  assert.ok(result.students.some(row => row.id === 'legacy-alias'));
  assert.ok(result.students.some(row => row.id === 'admin-test'));
  assert.equal(result.students.find(row => row.id === 'pending').registrationApprovalStatus, null);
  assert.equal(Object.hasOwn(result.students.find(row => row.id === 'student-0'), 'registrationApprovalStatus'), false);
  assert.equal(result.students.some(row => Object.hasOwn(row, 'avatar')), false);
  assert.equal(Object.hasOwn(result.schoolConfig, 'unrelated'), false);
  assert.equal((await callable.run(rosterRequest('reader'))).students.length, 325);
  for (const uid of ['staff', 'student-0']) await assert.rejects(callable.run(rosterRequest(uid)), { code: 'permission-denied' });
  await assert.rejects(callable.run(rosterRequest('teacher', { semester: '1' })), { code: 'failed-precondition' });
  await assert.rejects(callable.run(rosterRequest('teacher', { _session: { ...sessions.get('teacher'), revision: '0'.repeat(64) } })), { code: 'unauthenticated' });
  assert.deepEqual((await db.collection('users').get()).docs.map(doc => [doc.id, doc.updateTime.toMillis()]), before);
  assert.equal((await sessionRef.get()).updateTime.toMillis(), sessionBefore);
  await db.doc('users/reader').update({ staffPermissions: [] });
  await assert.rejects(callable.run(rosterRequest('reader')), { code: 'permission-denied' });
  await sessionRef.update({ status: 'closed' });
  await assert.rejects(callable.run(rosterRequest('teacher')), { code: 'unauthenticated' });
  console.log(JSON.stringify({ pass: true, emulator: process.env.FIRESTORE_EMULATOR_HOST, syntheticUsers: users.length,
    returnedStudents: result.students.length, responseBytes: Buffer.byteLength(JSON.stringify(result)),
    queryWrites: 0, checks: 'actual Firestore projection; complete legacy roster/approval field absence; actual maintenance wrapper and session proof; teacher/delegated read; student/staff/revoked permission/closed session/wrong scope denial; unchanged users and session timestamps' }));
})().then(() => deleteApp(app)).catch(async error => { console.error(error); await deleteApp(app); process.exitCode = 1; });
