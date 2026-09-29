const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Never allow this test to seed or submit production student records.
const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (project !== 'demo-westory-history'
  || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
  || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
  throw new Error('Use the isolated demo-westory-history Firestore/Auth emulators.');
}
const api = require('../index');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const db = getFirestore();
const scope = { year: '2026', semester: '2' };
const prefix = `years/${scope.year}/semesters/${scope.semester}`;
const results = `${prefix}/history_classroom_results`;
const reports = [];
const get = async name => (await db.doc(`${results}/${name}`).get()).data();
const call = (data = {}, uid = 'student-a', email = `${uid}@yongshin-ms.ms.kr`) => api.submitHistoryClassroomResult.run({
  auth: uid ? { uid, token: { email } } : null,
  data: { ...scope, assignmentId: 'lesson', resultId: 'result', ...data },
});
const reject = (promise, code) => assert.rejects(promise, error => error.code === code);
const summary = result => Object.fromEntries(['resultId', 'resultCollectionPath', 'score', 'total', 'percent', 'passThresholdPercent', 'status', 'passed', 'answerChecks'].map(key => [key, result[key]]));
const correct = { ancient: ' 고 조 선 ', culture: '훈민정음!', latin: 'ＡＢＣ １２３' };
const record = message => { reports.push({ message, status: 'passed' }); console.log(`PASS ${message}`); };
const assignment = {
  title: '고조선과 문화', sourceType: 'lesson', isPublished: true,
  targetStudentUids: ['student-a', 'student-b', 'teacher'],
  passThresholdPercent: 80,
  blanks: [
    { id: 'ancient', page: 1, answer: '고조선' },
    { id: 'culture', page: 3, answer: '훈민정음' },
    { id: 'latin', page: 3, answer: 'abc123' },
  ],
};

async function main() {
  const cleared = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.ok, true);
  await db.doc('site_settings/config').set(scope);
  for (const uid of ['student-a', 'student-b', 'unassigned']) {
    await db.doc(`users/${uid}`).set({ role: 'student', name: '검증학생', studentGrade: '2', studentClass: '3', studentNumber: '7', email: `${uid}@yongshin-ms.ms.kr` });
  }
  await db.doc('users/teacher').set({ role: 'teacher', teacherPortalEnabled: true, email: 'teacher@yongshin-ms.ms.kr' });
  await db.doc(`${prefix}/history_classrooms/lesson`).set(assignment);
  await db.doc(`${prefix}/history_classrooms/other`).set({ ...assignment, title: '다른 과제' });

  await reject(call({}, null), 'unauthenticated');
  await reject(call({}, 'student-a', 'outsider@example.com'), 'permission-denied');
  await reject(call({}, 'teacher'), 'permission-denied');
  await reject(call({}, 'unassigned'), 'permission-denied');
  await reject(call({ resultId: 'bad/id' }), 'invalid-argument');
  await reject(call({ assignmentId: '../lesson' }), 'invalid-argument');
  await reject(call({ year: '2026/nested' }), 'invalid-argument');
  await reject(call({ status: 'approved' }), 'invalid-argument');
  await reject(call({ assignmentId: 'missing' }), 'not-found');
  assert.equal((await db.collection(results).get()).size, 0);
  record('Authentication, domain, student role, assigned UID, invalid path/status and missing assignment reject without writes');

  const first = await call({ answers: correct, score: 9999, percent: 0, passed: false, status: 'failed' });
  assert.equal(first.score, 3); assert.equal(first.percent, 100); assert.equal(first.status, 'passed');
  assert.deepEqual(first.answerChecks.map(check => check.page), [1, 3, 3]);
  const original = await get('result');
  assert.equal(original.serverSubmissionVersion, 1);
  assert.equal(original.studentGrade, '2'); assert.equal(original.studentClass, '3'); assert.equal(original.studentNumber, '7');
  record('Server scores saved lesson blanks with Korean whitespace, punctuation and NFKC normalization, ignoring forged totals/status');

  const replays = await Promise.all(Array.from({ length: 8 }, (_, i) => call({ answers: i % 2 ? {} : correct, status: i % 2 ? 'cancelled' : 'failed', cancellationReason: 'late retry' })));
  for (const replay of replays) assert.deepEqual(summary(replay), summary(first));
  assert.deepEqual(await get('result'), original);
  assert.equal((await db.collection(results).get()).size, 1);
  const teacherInbox = db.doc(`${prefix}/notification_inboxes/teacher`);
  assert.equal((await teacherInbox.collection('items').where('entityId', '==', 'result').get()).size, 1);
  assert.equal((await teacherInbox.get()).data().unreadCount, 1);
  await reject(call({ assignmentId: 'other' }), 'failed-precondition');
  await reject(call({}, 'student-b'), 'permission-denied');
  record('Lost-response retry and concurrent changed-payload/cancel retries return the original result, preserving answers/timestamp; cross-owner/assignment collisions reject');

  const rewardRequests = await Promise.all(Array.from({ length: 5 }, () => api.applyPointActivityReward.run({ auth: { uid: 'student-a', token: { email: 'student-a@yongshin-ms.ms.kr' } }, data: { ...scope, activityType: 'history_classroom', sourceId: 'history-classroom:result', sourceLabel: '역사교실', score: 999999 } })));
  assert.equal(rewardRequests.filter(result => result.awarded).length, 1);
  assert.equal((await db.collection(`${prefix}/point_transactions`).where('type', '==', 'history_classroom').get()).size, 1);
  record('Repeated result replay creates one teacher notification/unread count and concurrent reward claims produce one point transaction');

  const concurrent = await Promise.all(Array.from({ length: 8 }, (_, i) => call({ resultId: 'race', answers: i % 2 ? {} : correct })));
  for (const result of concurrent) assert.deepEqual(summary(result), summary(concurrent[0]));
  assert([0, 100].includes(concurrent[0].percent));
  assert.equal((await db.collection(results).get()).size, 2);
  record('First-save transaction races commit one result; every caller receives the winner');

  const cancelled = await call({ resultId: 'cancelled', answers: correct, status: 'cancelled', cancellationReason: '응시 취소' });
  assert.equal(cancelled.passed, false); assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(summary(await call({ resultId: 'cancelled', answers: correct, status: 'passed' })), summary(cancelled));
  const timeout = await call({ resultId: 'timeout', answers: { ancient: '고조선' }, status: 'failed' });
  assert.equal(timeout.score, 1); assert.equal(timeout.percent, 33); assert.equal(timeout.status, 'failed');
  assert.deepEqual(summary(await call({ resultId: 'timeout', answers: correct })), summary(timeout));
  record('Cancelled and timed-out partial answer results cannot turn into a later successful attempt under the same ID');

  await db.doc(`${prefix}/history_classrooms/lesson`).update({ isPublished: false, deletedAt: Timestamp.now(), blanks: [], passThresholdPercent: 0 });
  assert.deepEqual(summary(await call({ answers: {} })), summary(first));
  await reject(call({ resultId: 'after-delete' }), 'failed-precondition');
  await db.doc(`${prefix}/history_classrooms/lesson`).set(assignment);
  record('Committed retries survive assignment edits/deletion; new submissions still enforce publication/deletion');

  const oldTime = Timestamp.fromMillis(1700000000000);
  await db.doc(`${results}/legacy-direct`).set({ ...original, serverSubmissionVersion: null, answers: { ancient: '틀린 답' }, score: 9999, percent: 9999, passed: true, status: 'passed', createdAt: oldTime });
  const upgraded = await call({ resultId: 'legacy-direct', answers: correct, score: 9999 });
  assert.equal(upgraded.score, 0); assert.equal(upgraded.percent, 0); assert.equal(upgraded.status, 'failed');
  const upgradedRow = await get('legacy-direct');
  assert.deepEqual(upgradedRow.answers, { ancient: '틀린 답' });
  assert(upgradedRow.createdAt.isEqual(oldTime)); assert.equal(upgradedRow.serverSubmissionVersion, 1);
  record('Old direct-write rows are re-scored from their original answers, never trusted client totals or replacement retry answers');

  const exemption = { ...original, serverSubmissionVersion: null, completionSource: 'exemption', score: 0, total: 0, percent: 100, passed: true, status: 'passed', answers: {}, answerChecks: [], createdAt: oldTime };
  await db.doc(`${results}/exemption`).set(exemption);
  await reject(call({ resultId: 'exemption', answers: {} }), 'failed-precondition');
  assert.deepEqual(await get('exemption'), exemption);
  record('An attempt cannot overwrite a teacher-approved exemption result, even for its own assignment and owner');

  await db.doc('history_classrooms/legacy-map').set({ ...assignment, sourceType: 'map' });
  assert.equal((await call({ assignmentId: 'legacy-map', resultId: 'legacy-map', answers: correct })).percent, 100);
  await db.doc('history_classrooms/hidden').set(assignment);
  await db.doc(`${prefix}/history_classrooms/hidden`).set({ ...assignment, isPublished: false });
  await reject(call({ assignmentId: 'hidden', resultId: 'hidden' }), 'failed-precondition');
  await db.doc(`${prefix}/history_classrooms/zero`).set({ ...assignment, passThresholdPercent: 0 });
  assert.equal((await call({ assignmentId: 'zero', resultId: 'zero', answers: {} })).passed, true);
  await db.doc(`${prefix}/history_classrooms/unset`).set({ ...assignment, passThresholdPercent: null });
  assert.equal((await call({ assignmentId: 'unset', resultId: 'unset', answers: {} })).passThresholdPercent, 80);
  record('Legacy assignment fallback, scoped unpublished precedence and explicit zero threshold preserve the source contract');

  // Real Auth emulator token exercises Firestore rules independently from Admin.
  const authResponse = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rules-history@yongshin-ms.ms.kr', password: 'test-only-password', returnSecureToken: true }) });
  const account = await authResponse.json(); assert(account.idToken, JSON.stringify(account));
  await db.doc(`users/${account.localId}`).set({ role: 'student', name: '규칙검증', email: 'rules-history@yongshin-ms.ms.kr' });
  await db.doc(`${prefix}/history_classrooms/rules`).set({ ...assignment, targetStudentUids: [account.localId] });
  await call({ assignmentId: 'rules', resultId: 'rules-result', answers: correct }, account.localId, 'rules-history@yongshin-ms.ms.kr');
  const base = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents`;
  const headers = { authorization: `Bearer ${account.idToken}`, 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/${results}/rules-result`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/${results}/result`, { headers })).status, 403);
  assert.equal((await fetch(`${base}/${results}/rules-result?updateMask.fieldPaths=score`, { method: 'PATCH', headers, body: JSON.stringify({ fields: { score: { integerValue: '9999' } } }) })).status, 403);
  const fields = {
    assignmentId: { stringValue: 'rules' }, assignmentTitle: { stringValue: 'fixture' }, uid: { stringValue: account.localId },
    studentName: { stringValue: 'fixture' }, studentGrade: { stringValue: '' }, studentClass: { stringValue: '' }, studentNumber: { stringValue: '' },
    answers: { mapValue: { fields: {} } }, score: { integerValue: '0' }, total: { integerValue: '3' }, percent: { integerValue: '0' },
    passThresholdPercent: { integerValue: '80' }, passed: { booleanValue: false }, status: { stringValue: 'failed' },
    answerChecks: { arrayValue: { values: [] } }, cancellationReason: { stringValue: '' }, createdAt: { timestampValue: new Date().toISOString() },
    serverSubmissionVersion: { integerValue: '1' },
  };
  assert.equal((await fetch(`${base}/${results}/forged-marker`, { method: 'PATCH', headers, body: JSON.stringify({ fields }) })).status, 403);
  record('Real authenticated rules allow own result read, deny other owner read, deny committed score update and deny forged server submission marker');
  console.log(`History classroom emulator verification completed: ${reports.length} groups passed.`);
}

main().then(async () => {
  const output = path.resolve(__dirname, '../../.superloopy/sessions/history-lesson-worksheets/evidence/history-classroom-backend-emulator.json');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify({ recordedAt: new Date().toISOString(), project, backend: 'exported production callable .run + real Firestore transactions + Auth emulator rules', reports }, null, 2));
  process.exit(0);
}).catch(error => { console.error(error); process.exit(1); });
