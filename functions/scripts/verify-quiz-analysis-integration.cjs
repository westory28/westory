const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
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
  'semester_classes/other_grade': { semesterId, grade: '2', classNumber: '1', status: 'ACTIVE' },
  'semester_classes/inactive_class': { semesterId, grade: '3', classNumber: '3', status: 'INACTIVE' },
  'semester_classes/old_class': { semesterId: '2026-1', grade: '3', classNumber: '4', status: 'ACTIVE' },
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
  assert.equal(catalog.classes.length, 3); assert.ok(catalog.assessments.some(a => a.unitId === 'unit-a'));
  const scope = { mode: 'summary', unitId: 'unit-a', category: 'formative', classIds: ['class_1', 'class_2'] };
  const summary = await deployed.getQuizClassAnalysis.run(request(teacher, scope));
  assert.deepEqual(summary.classes.map(c => [c.rosterCount, c.submittedCount, c.averageScore]), [[1, 1, 0], [1, 1, 100]]);
  assert.ok(!JSON.stringify(summary).includes(student) && !JSON.stringify(summary).includes('가상학생'));
  const cached = await deployed.getQuizClassAnalysis.run(request(teacher, scope));
  assert.deepEqual(cached.classes, summary.classes);
  const detail = await deployed.getQuizClassAnalysis.run(request(teacher, { ...scope, mode: 'detail', classIds: ['class_1'] }));
  assert.deepEqual(detail.students.map(s => s.uid), [student]); assert.equal(detail.rawRows.length, 1);
  assert.equal(detail.rawRows[0].raw.answers['1'], '오답');
  const gradeScope = { ...scope, classIds: [], grade: '3' };
  const grade = await deployed.getQuizClassAnalysis.run(request(teacher, gradeScope));
  assert.equal(grade.grade, '3');
  assert.deepEqual(grade.classes.map(row => row.classId), ['class_1', 'class_2']);
  assert.equal(grade.gradeComparison.averageScore, 50);
  const warmGrade = await deployed.getQuizClassAnalysis.run(request(teacher, gradeScope));
  assert.deepEqual(warmGrade.classes, grade.classes);
  // Firestore-only emulator: no enrollment trigger is running during these changes.
  await db.doc(`semester_enrollments/enroll_${student}`).update({ classId: 'class_2' });
  const movedGrade = await deployed.getQuizClassAnalysis.run(request(teacher, gradeScope));
  assert.deepEqual(movedGrade.classes.map(row => row.rosterCount), [0, 2]);
  assert.equal(movedGrade.gradeComparison.rosterCount, 2);
  await db.doc(`semester_enrollments/enroll_${student}`).update({ classId: 'class_1' });
  const newUid = 'analysis-grade-new';
  await db.doc(`semester_enrollments/enroll_${newUid}`).set({ semesterId, studentUid: newUid, classId: 'class_1', enrollmentStatus: 'ACTIVE' });
  await db.doc(`semester_enrollment_slots/${slot(newUid)}`).set({ semesterId, studentUid: newUid, status: 'ACTIVE', activeEnrollmentId: `enroll_${newUid}` });
  const addedGrade = await deployed.getQuizClassAnalysis.run(request(teacher, gradeScope));
  assert.equal(addedGrade.gradeComparison.rosterCount, 3);
  assert.equal(addedGrade.gradeComparison.scoredCount, 2);
  await db.doc(`semester_enrollments/enroll_${newUid}`).update({ enrollmentStatus: 'INACTIVE' });
  const removedGrade = await deployed.getQuizClassAnalysis.run(request(teacher, gradeScope));
  assert.equal(removedGrade.gradeComparison.rosterCount, 2);
  const gradeDetail = await deployed.getQuizClassAnalysis.run(request(teacher, { ...gradeScope, mode: 'detail' }));
  assert.equal(gradeDetail.grade, '3');
  assert.deepEqual(gradeDetail.students.map(row => row.uid).sort(), [student, other].sort());
  assert.deepEqual(gradeDetail.configuredClasses.map(row => row.id), ['class_1', 'class_2']);
  await assert.rejects(deployed.getQuizClassAnalysis.run(request(student, gradeScope)), error => error.code === 'permission-denied');
  await assert.rejects(deployed.getQuizClassAnalysis.run(request(teacher, { ...gradeScope, classIds: ['class_1'] })), error => error.code === 'invalid-argument');
  await db.doc('years/2026/semesters/2/quiz_questions/91').set({ id: 91, unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
    type: 'choice', question: '합성 모의 문항', contentRevision: 1, curriculumVersion: '2018-162', achievementStandardCodes: ['9역07-01'] });
  for (const uid of [student, other]) await db.doc(`semester_assessment_results/grade_exam_${uid}`).set({
    semesterId, studentUid: uid, assessmentKind: 'QUIZ', sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
    attemptId: `grade_exam_${uid}`, startedAtIso: new Date(now - 60000).toISOString(), submittedAtIso: new Date(now).toISOString(),
    total: 1, percent: 100, answerChecks: [{ id: 91, correct: true }], answers: { 91: '합성 답안' },
  });
  for (const uid of [student, other]) await db.doc(`semester_assessment_results/compact_${uid}`).set({
    studentUid: uid, semesterId, assessmentKind: 'QUIZ', sourceId: 'unit-a', category: 'diagnostic',
    submittedAtIso: new Date(now - 120000).toISOString(),
    answerChecks: Array.from({ length: 24 }, (_, index) => ({ id: String(index), correct: index % 2 === 0 })),
    learningSnapshot: Array.from({ length: 24 }, (_, index) => ({ id: String(index), sourceRevision: '1', unitId: 'unit-a' })),
  });
  await db.doc('semester_assessment_results/compact_definition_only').set({ semesterId, studentUid: student,
    assessmentKind: 'QUIZ', definitionId: 'quiz:2026-2:unit-a:formative',
    submittedAtIso: new Date(now - 120000).toISOString(), answerChecks: [{ id: '1', correct: true }],
    learningSnapshot: [{ id: '1', sourceRevision: '1', unitId: 'unit-a' }] });
  await db.doc('years/2026/semesters/2/quiz_results/compact_other_round').set({ uid: student,
    unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_2', details: [{ answer: 'UNSELECTED_ROUND_BODY' }] });
  const gradeAchievement = await deployed.getQuizClassAnalysis.run(request(teacher, { ...gradeScope, mode: 'achievement',
    unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1' }));
  assert.equal(gradeAchievement.grade, '3');
  assert.equal(gradeAchievement.complete, true);
  assert.deepEqual(gradeAchievement.rawRows.map(row => row.raw.studentUid).sort(), [student, other].sort());
  assert.deepEqual(gradeAchievement.configuredClasses.map(row => row.id), ['class_1', 'class_2']);
  assert.ok(gradeAchievement.achievementEvidence.observations.some(row => row.resultId === 'compact_definition_only'));
  assert.ok(gradeAchievement.achievementEvidence.observations.every(row => ['diagnostic', 'formative'].includes(row.source)));
  assert.equal(JSON.stringify(gradeAchievement).includes('UNSELECTED_ROUND_BODY'), false);
  const compactQuery = { ...gradeScope, mode: 'achievement', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', compactEvidence: true };
  const compactGrade = await deployed.getQuizClassAnalysis.run(request(teacher, compactQuery));
  const { observationTable, ...evidenceMetadata } = compactGrade.achievementEvidence;
  assert.ok(observationTable);
  const { keys, values, rows } = observationTable;
  const restoredEvidence = { ...evidenceMetadata, observations: rows.map(row => Object.fromEntries(row.flatMap((index, position) =>
    index === -1 ? [] : [[keys[position], values[index]]]))) };
  assert.deepEqual(restoredEvidence, gradeAchievement.achievementEvidence);
  await assert.rejects(deployed.getQuizClassAnalysis.run(request(student, compactQuery)), error => error.code === 'permission-denied');
  for (const uid of [student, other]) await db.doc(`semester_assessment_results/compact_${uid}`).delete();
  await db.doc('semester_assessment_results/compact_definition_only').delete();
  await db.doc('years/2026/semesters/2/quiz_results/compact_other_round').delete();
  // Remove only the synthetic extra exam records before the unchanged history assertions.
  for (const uid of [student, other]) await db.doc(`semester_assessment_results/grade_exam_${uid}`).delete();
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
  await db.doc('years/2026/semesters/2/quiz_questions/2').set({ id: 2, unitId: 'unit-b', category: 'diagnostic',
    type: 'choice', question: '광해군의 정치', explanation: '사화 이후의 정치 변화', answer: '정답', options: ['정답', '오답'], contentRevision: 1, concepts: ['광해군'] });
  await db.doc(`semester_assessment_results/search_${student}`).set({ semesterId, studentUid: student, classId: 'class_1',
    assessmentKind: 'QUIZ', attemptId: `search_${student}`, sourceId: 'unit-b', category: 'diagnostic', total: 10, percent: 90,
    submittedAtIso: new Date(now + 1000).toISOString(), answers: { 2: '오답' },
    answerChecks: [{ id: '2', correct: false }], learningSnapshot: [{ id: '2', sourceRevision: '1', concepts: ['광해군'] }] });
  await createQuizAnalysisInvalidation({ db }).invalidate(semesterId, ['contentGeneration', 'catalogGeneration']);
  const searchScope = { ...scope, keyword: '광해군', comparisonGrade: '3', classIds: ['class_1'] };
  const keyword = await deployed.getQuizClassAnalysis.run(request(teacher, searchScope));
  assert.equal(keyword.unitId, ''); assert.equal(keyword.category, '');
  assert.deepEqual(keyword.search.questionIds, ['2']);
  assert.equal(keyword.classes[0].averageScore, 0, 'search must not show the 90% full-assessment score');
  assert.equal(keyword.gradeComparison.classCount, 2);
  assert.equal(keyword.gradeComparison.rosterCount, 2);
  assert.equal(keyword.gradeComparison.scoredCount, 1);
  assert.equal(keyword.gradeComparison.averageScore, 0, 'nonrespondents must not contribute fabricated zeros');
  assert.ok(!JSON.stringify(keyword).includes(student) && !JSON.stringify(keyword).includes('가상학생'));
  const searchDetail = await deployed.getQuizClassAnalysis.run(request(teacher, { ...scope, mode: 'detail', keyword: '사화', classIds: ['class_1'] }));
  assert.deepEqual(searchDetail.search.questionIds, ['2']);
  assert.equal(searchDetail.questions[0].unitId, 'unit-b');
  assert.ok(searchDetail.rawRows.every(row => row.raw.answerChecks.every(check => String(check.id) === '2')));
  const noMatch = await deployed.getQuizClassAnalysis.run(request(teacher, { ...searchScope, keyword: '검색결과없는가상키워드' }));
  assert.equal(noMatch.search.matchedQuestionCount, 0);
  assert.equal(noMatch.classes[0].averageScore, null);
  await assert.rejects(deployed.getQuizClassAnalysis.run(request(student, searchScope)), e => e.code === 'permission-denied');
  // Actual Firestore projections/cache + exported authenticated callable. No production writes.
  const behaviorBatch = db.batch(), behaviorAnswers = {}, behaviorChecks = [], behaviorSnapshot = [], behaviorTimes = {};
  for (let i = 101; i <= 110; i++) {
    const id = String(i);
    behaviorBatch.set(db.doc(`years/2026/semesters/2/quiz_questions/${id}`), {
      id: i, unitId: 'unit-a', category: 'formative', type: 'choice', question: `풀이분류검증 ${i}`,
      options: ['보기 A', '보기 B', '보기 C', '보기 D'], answer: '보기 B', contentRevision: 1,
    });
    behaviorAnswers[id] = '보기 A'; behaviorChecks.push({ id, correct: false });
    behaviorSnapshot.push({ id, sourceRevision: '1' });
    behaviorTimes[id] = { activeMs: 1000, hiddenMs: 0, firstResponseMs: 500, finalResponseMs: 800,
      answerChangeCount: 0, revisitCount: 0, quality: 'complete' };
  }
  const behaviorRecord = { semesterId, studentUid: student, classId: 'class_1', assessmentKind: 'QUIZ',
    attemptId: 'behavior-attempt', sourceId: 'unit-a', category: 'formative', total: 10, percent: 0,
    submittedAtIso: new Date(now + 2000).toISOString(), answers: behaviorAnswers, answerChecks: behaviorChecks,
    learningSnapshot: behaviorSnapshot, analytics: { version: 1, quality: 'complete', questions: behaviorTimes } };
  behaviorBatch.set(db.doc('semester_assessment_results/behavior-attempt'), behaviorRecord);
  await behaviorBatch.commit();
  await createQuizAnalysisInvalidation({ db }).invalidate(semesterId, ['contentGeneration', 'catalogGeneration']);
  await createQuizAnalysisInvalidation({ db }).invalidateResult(semesterId, behaviorRecord);
  const behaviorScope = { ...scope, comparisonGrade: '3' };
  const behaviorSummary = await deployed.getQuizClassAnalysis.run(request(teacher, behaviorScope));
  assert.equal(behaviorSummary.classes[0].behaviorCounts.suspected_guessing, 1);
  assert.equal(behaviorSummary.classes[1].behaviorCounts.insufficient, 1);
  assert.equal(behaviorSummary.gradeComparison.behaviorCounts.suspected_guessing, 1);
  assert.equal(behaviorSummary.gradeComparison.behaviorCounts.insufficient, 1);
  assert.equal(behaviorSummary.gradeComparison.averageScore, 50);
  assert.ok(!JSON.stringify(behaviorSummary).includes('behavior-attempt') && !JSON.stringify(behaviorSummary).includes('activeMs'));
  const behaviorDetail = await deployed.getQuizClassAnalysis.run(request(teacher, { ...scope, mode: 'detail', classIds: ['class_1'] }));
  const selectedBehavior = behaviorDetail.rawRows.find(row => row.id === 'behavior-attempt').raw;
  assert.equal(selectedBehavior.behaviorAnswersAvailable, true);
  assert.equal(selectedBehavior.analytics.questions['101'].activeMs, 1000);
  const updatedTimes = Object.fromEntries(Object.entries(behaviorTimes).map(([id, value]) => [id, { ...value, activeMs: 40000 }]));
  await db.doc('semester_assessment_results/behavior-attempt').update({ analytics: { version: 1, quality: 'complete', questions: updatedTimes } });
  await createQuizAnalysisInvalidation({ db }).invalidateResult(semesterId, behaviorRecord);
  const repeated = await deployed.getQuizClassAnalysis.run(request(teacher, behaviorScope));
  assert.equal(repeated.classes[0].behaviorCounts.suspected_guessing, 0);
  assert.equal(repeated.classes[0].behaviorCounts.repeated_choice, 1);
  assert.equal(repeated.gradeComparison.averageScore, 50);
  const achievementMeta = { curriculumVersion: '2018-162', achievementStandardCodes: ['9역07-01'],
    achievementMappingSource: 'manual', targetAchievementLevel: 'C', intendedDifficulty: 'medium' };
  const examStart = new Date(now + 60000).toISOString(), examSubmit = new Date(now + 120000).toISOString();
  const examId = 'achievement-exam', definition = `quiz:${semesterId}:exam_prep:exam_prep:round_1`;
  const exam = { semesterId, studentUid: student, assessmentKind: 'QUIZ', classId: 'class_1', attemptId: examId,
    sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', definitionId: definition,
    startedAtIso: examStart, submittedAtIso: examSubmit, score: 1, percent: 100, total: 1,
    resultRef: `semester_assessment_results/${examId}`, answerChecks: [{ id: '901', correct: true }], answers: { 901: '정답' },
    learningSnapshot: [{ id: '901', sourceRevision: '1', ...achievementMeta }] };
  const achievementBatch = db.batch();
  achievementBatch.set(db.doc('years/2026/semesters/2/quiz_questions/901'), { id: 901, unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
    contentRevision: 1, type: 'choice', question: '합성 성취 분석 문항', answer: '정답', options: ['정답', '오답'], ...achievementMeta });
  achievementBatch.set(db.doc(`semester_assessment_results/${examId}`), exam);
  achievementBatch.set(db.doc(`semester_assessment_attempts/${examId}`), exam);
  achievementBatch.update(db.doc(resultPath), { learningSnapshot: [{ id: '1', sourceRevision: '1', unitId: 'unit-a', ...achievementMeta }] });
  achievementBatch.set(db.doc('years/2026/semesters/2/lessons/achievement'), { unitId: 'unit-a', contentRevision: 1, contentHtml: '[정답]' });
  achievementBatch.set(db.doc(`years/2026/semesters/2/lesson_progress/${student}/units/unit-a`), {
    studentUid: student, semesterId, contentRevision: 1, updatedAt: Timestamp.fromMillis(now), answers: { 0: { value: 'PRIVATE_BLANK', status: 'wrong' } } });
  await achievementBatch.commit();
  const achievementQuery = { mode: 'achievement', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', classIds: ['class_1'] };
  const evidence = await deployed.getQuizClassAnalysis.run(request(teacher, achievementQuery));
  assert.equal(evidence.canReview, true); assert.equal(evidence.achievementEvidence.examCutoffs[0].startedAt, examStart);
  assert.ok(evidence.achievementEvidence.observations.every(row => ['diagnostic', 'formative'].includes(row.source)));
  assert.ok(evidence.achievementEvidence.observations.some(row => row.source === 'formative'));
  assert.ok(!JSON.stringify(evidence).includes('PRIVATE_BLANK'));
  await assert.rejects(deployed.getQuizClassAnalysis.run(request(student, achievementQuery)), e => e.code === 'permission-denied');
  const reviewPayload = { semesterId, classId: 'class_1', unitId: 'exam_prep', examRound: 'round_1', studentUid: student,
    standardCode: '9역07-01', level: 'C', expectedRevision: 0, examAttemptId: examId, mappingConfirmed: true,
    expectedRubricVersion: evidence.rubricVersion,
    evidenceRefs: [{ resultId: `attempt_${student}`, questionId: '1' }] };
  const saveProfile = (uid, payload, commandId = randomUUID()) => deployed.executeCommand.run({ auth: request(uid, {}).auth,
    data: { commandId, commandType: 'saveAchievementProfile', payload, _session: proof } });
  const priorResult = (await db.doc(resultPath).get()).data();
  const outcomes = await Promise.allSettled([saveProfile(teacher, reviewPayload), saveProfile(teacher, { ...reviewPayload, level: 'B' })]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(outcome => outcome.status === 'rejected' && outcome.reason.code === 'aborted').length, 1);
  assert.deepEqual((await db.doc(resultPath).get()).data(), priorResult, 'profile review cannot change assessment scores');
  const reviewed = await deployed.getQuizClassAnalysis.run(request(teacher, achievementQuery));
  assert.equal(reviewed.profiles[0].revision, 1); assert.equal(reviewed.profiles[0].asOf, examStart);
  assert.equal(reviewed.profiles[0].stale, false);
  await assert.rejects(saveProfile(teacher, { ...reviewPayload, expectedRevision: 1, expectedRubricVersion: 'older-rubric' }),
    e => e.details?.reason === 'ACHIEVEMENT_PROFILE_RUBRIC_CHANGED');
  await db.doc(`semester_achievement_profiles/${reviewed.profiles[0].id}`).update({ rubricVersion: 'older-rubric' });
  assert.equal((await deployed.getQuizClassAnalysis.run(request(teacher, achievementQuery))).profiles[0].stale, true);
  await assert.rejects(saveProfile(student, { ...reviewPayload, expectedRevision: 1 }), e => e.code === 'permission-denied');
  const replayId = randomUUID();
  await saveProfile(teacher, { ...reviewPayload, level: null, expectedRevision: 1 }, replayId);
  assert.equal((await saveProfile(teacher, { ...reviewPayload, level: null, expectedRevision: 1 }, replayId)).replayed, true);
  const confirmedStatus = await deployed.getCommandStatus.run({ auth: request(teacher, {}).auth,
    data: { commandId: replayId, commandType: 'saveAchievementProfile', _session: proof } });
  assert.equal(confirmedStatus.result.level, null); assert.equal(confirmedStatus.result.revision, 2);
  console.log('PASS achievement callable + Firestore: scoped private evidence, immutable exam cutoff, concurrent teacher-review CAS, forbidden student writes, replay and unchanged scores');
  await db.doc(`application_sessions/${teacher}/sessions/${authTime}`).update({ status: 'revoked' });
  await assert.rejects(deployed.getQuizClassAnalysis.run(request(teacher, scope)), e => e.code === 'unauthenticated');
  await db.doc(`application_sessions/${student}/sessions/${authTime}`).update({ status: 'revoked' });
  await assert.rejects(deployed.getMyQuizHistory.run(request(student, { mode: 'list' })), e => e.code === 'unauthenticated');
  console.log('PASS real exported callables + Firestore: session/auth, class cache, history, keyword, grade, response classification/counts/detail/cache invalidation, unchanged scores and permission denial');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.terminate());
