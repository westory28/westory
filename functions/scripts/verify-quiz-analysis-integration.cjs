const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const projectId = 'demo-westory-session-quiz-analysis';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
  || (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId)) throw new Error('Dedicated local demo Firestore only.');
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
process.env.WESTORY_SESSION_IDLE_MODE = 'ENFORCE';
process.env.WESTORY_APP_CHECK_MODE = 'DISABLED';
const deployed = require('../index');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { createQuizAnalysisInvalidation } = require('../quizClassAnalysis');
const db = getFirestore(), now = Date.now(), semesterId = '2026-2';
const teacher = 'analysis-teacher', student = 'analysis-student-a', other = 'analysis-student-b';
const authTime = Math.floor(now / 1000) - 1200;
const proof = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'a'.repeat(64) };
const slot = uid => `slot_${createHash('sha256').update(`${semesterId}\n${uid}`).digest('hex').slice(0, 40)}`;
const seed = {
  'site_settings/config': { year: '2026', semester: '2', activeSemesterId: semesterId, showQuiz: true },
  'site_settings/semester_active': { semesterId, revision: 1 },
  [`semester_manifests/${semesterId}`]: { semesterId, status: 'ACTIVE', revision: 1 },
  'semester_classes/class_1': { semesterId, grade: '3', classNumber: '1', status: 'ACTIVE' },
  'semester_classes/class_2': { semesterId, grade: '3', classNumber: '2', status: 'ACTIVE' },
  [`users/${teacher}`]: { role: 'teacher', registrationApprovalStatus: 'APPROVED' },
  [`users/${student}`]: { role: 'student', name: '가상학생 A', grade: '3', class: '1', number: '1', email: 'a@example.invalid', registrationApprovalStatus: 'APPROVED' },
  [`users/${other}`]: { role: 'student', name: '가상학생 B', grade: '3', class: '2', number: '1', email: 'b@example.invalid', registrationApprovalStatus: 'APPROVED' },
  'years/2026/semesters/2/curriculum/tree': { tree: [{ id: 'big', title: '조선', children: [{ id: 'unit-a', title: '사림 세력' }] }] },
  'years/2026/semesters/2/quiz_questions/1': { id: 1, unitId: 'unit-a', category: 'formative', type: 'choice', question: '문제', answer: '정답', options: ['정답', '오답'], contentRevision: 1, concepts: ['사림'] },
  'semester_assessment_definitions/quiz:2026-2:unit-a:formative': { semesterId, assessmentKind: 'QUIZ', sourceId: 'unit-a', category: 'formative', status: 'PUBLISHED', title: '사림 형성평가', questionCount: 1 },
};
for (const uid of [teacher, student, other]) seed[`application_sessions/${uid}/sessions/${authTime}`] = {
  status: 'active', authTime, schemaVersion: 2, authorityGeneration: proof.authorityGeneration,
  protocolVersion: 2, sessionRevision: proof.revision, authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(now + 3600000),
};
for (const [uid, classId] of [[student, 'class_1'], [other, 'class_2']]) {
  seed[`semester_enrollments/enroll_${uid}`] = { semesterId, studentUid: uid, classId, enrollmentStatus: 'ACTIVE', displayName: uid === student ? '가상학생 A' : '가상학생 B', studentNumber: '1' };
  seed[`semester_enrollment_slots/${slot(uid)}`] = { semesterId, studentUid: uid, status: 'ACTIVE', activeEnrollmentId: `enroll_${uid}` };
  const id = `attempt_${uid}`;
  seed[`semester_assessment_results/${id}`] = { semesterId, studentUid: uid, uid, classId, assessmentKind: 'QUIZ', attemptId: id,
    sourceId: 'unit-a', definitionId: 'quiz:2026-2:unit-a:formative', category: 'formative', total: 1,
    score: uid === student ? 0 : 1, percent: uid === student ? 0 : 100,
    submittedAtIso: new Date(now).toISOString(), submissionRef: `semester_assessment_submissions/${id}`,
    answerChecks: [{ id: '1', correct: uid !== student }], learningSnapshot: [{ id: '1', sourceRevision: '1', concepts: ['사림'] }],
    questionSnapshots: [{ id: '1', type: 'choice', question: '저장된 문제', answer: '정답', options: ['정답', '오답'] }],
  };
  seed[`semester_assessment_submissions/${id}`] = { semesterId, studentUid: uid, attemptId: id, answers: { 1: uid === student ? '오답' : '정답' } };
}
const request = (uid, data) => ({ auth: { uid, token: { email: `${uid}@yongshin-ms.ms.kr`, auth_time: authTime } }, data: { semesterId, ...data, _session: proof } });
(async () => {
  const batch = db.batch(); Object.entries(seed).forEach(([path, value]) => batch.set(db.doc(path), value)); await batch.commit();
  const catalog = await deployed.getQuizClassAnalysis.run(request(teacher, { mode: 'catalog' }));
  assert.equal(catalog.classes.length, 2); assert.ok(catalog.assessments.some(a => a.unitId === 'unit-a'));
  const scope = { mode: 'summary', unitId: 'unit-a', category: 'formative', classIds: ['class_1', 'class_2'] };
  const summary = await deployed.getQuizClassAnalysis.run(request(teacher, scope));
  assert.deepEqual(summary.classes.map(c => [c.rosterCount, c.submittedCount, c.averageScore]), [[1, 1, 0], [1, 1, 100]]);
  assert.ok(!JSON.stringify(summary).includes(student) && !JSON.stringify(summary).includes('가상학생'));
  const cached = await deployed.getQuizClassAnalysis.run(request(teacher, scope));
  assert.deepEqual(cached.classes, summary.classes);
  const detail = await deployed.getQuizClassAnalysis.run(request(teacher, { ...scope, mode: 'detail', classIds: ['class_1'] }));
  assert.deepEqual(detail.students.map(s => s.uid), [student]); assert.equal(detail.rawRows.length, 1);
  assert.equal(detail.rawRows[0].raw.answers['1'], '오답');
  await assert.rejects(deployed.getQuizClassAnalysis.run(request(student, scope)), e => e.code === 'permission-denied');
  const history = await deployed.getMyQuizHistory.run(request(student, { mode: 'list' }));
  assert.equal(history.totalCount, 1); assert.equal(history.rows[0].score, 0);
  const review = await deployed.getMyQuizHistory.run(request(student, { mode: 'detail', key: `canonical:attempt_${student}` }));
  assert.equal(review.record.details[0].u, '오답');
  await assert.rejects(deployed.getMyQuizHistory.run(request(student, { mode: 'detail', key: `canonical:attempt_${other}` })), e => e.code === 'not-found');
  const resultPath = `semester_assessment_results/attempt_${student}`;
  await db.doc(resultPath).update({ percent: 100, score: 1, answerChecks: [{ id: '1', correct: true }] });
  await createQuizAnalysisInvalidation({ db }).invalidateResult(semesterId, seed[resultPath]);
  const updated = await deployed.getQuizClassAnalysis.run(request(teacher, scope));
  assert.equal(updated.classes[0].averageScore, 100);
  assert.equal((await deployed.getMyQuizHistory.run(request(student, { mode: 'list' }))).rows[0].score, 100);
  await db.doc(`application_sessions/${teacher}/sessions/${authTime}`).update({ status: 'revoked' });
  await assert.rejects(deployed.getQuizClassAnalysis.run(request(teacher, scope)), e => e.code === 'unauthenticated');
  await db.doc(`application_sessions/${student}/sessions/${authTime}`).update({ status: 'revoked' });
  await assert.rejects(deployed.getMyQuizHistory.run(request(student, { mode: 'list' })), e => e.code === 'unauthenticated');
  console.log('PASS real exported callables + Firestore: 20-minute session, class isolation/comparison/cache, result invalidation, own history/detail, cross-owner and revoked-session denial');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.terminate());
