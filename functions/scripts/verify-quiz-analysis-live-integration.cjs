const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const projectId = 'demo-westory-session-quiz-live';
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/);
assert.equal(process.env.GCLOUD_PROJECT, projectId);
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({ projectId }), actual = getFirestore(app);
const { createQuizClassAnalysisService, createQuizAnalysisInvalidation, normalizeQuery } = require('../quizClassAnalysis');
const { buildEnrollmentSlotId } = require('../productionGateway/archiveEnrollment');
const scope = '2026-2', root = 'years/2026/semesters/2';
const definitionId = 'quiz:2026-2:exam_prep:exam_prep:round_1';
const queryLog = [], bodyReads = [];
let duringResultRead;
const trackQuery = (query, path) => new Proxy(query, { get(target, key) {
  if (key === 'get') return (...args) => { queryLog.push(path); return target.get(...args); };
  if (['where', 'orderBy', 'limit', 'select', 'startAfter'].includes(key)) return (...args) => trackQuery(target[key](...args), path);
  const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
} });
const db = { doc: actual.doc.bind(actual), collection: path => trackQuery(actual.collection(path), path),
  runTransaction: actual.runTransaction.bind(actual), getAll: async (...args) => {
    bodyReads.push(...args.filter(item => item.path).map(item => item.path));
    const result = await actual.getAll(...args);
    if (duringResultRead && args.some(item => item.path?.startsWith('semester_assessment_results/'))) {
      const effect = duringResultRead; duringResultRead = undefined; await effect();
    }
    return result;
  } };
const service = createQuizClassAnalysisService({ db }), invalidation = createQuizAnalysisInvalidation({ db });
const q = { semesterId: scope, mode: 'achievement', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', classIds: ['class_a'], live: true };
const result = (id, uid = 'a', round = 'round_1') => ({ assessmentKind: 'QUIZ', semesterId: scope, studentUid: uid,
  classId: uid === 'a' ? 'class_a' : 'class_b', sourceId: 'exam_prep', category: 'exam_prep', examRound: round,
  definitionId: definitionId.replace('round_1', round), attemptId: id, total: 1, score: 0, percent: 0,
  submittedAtIso: `2026-11-10T01:00:${String(Number(id.replace(/\D/g, '')) || 1).padStart(2, '0')}Z`,
  answers: { 1: '조선' }, answerChecks: [{ id: '1', correct: false }],
  learningSnapshot: [{ id: '1', sourceRevision: '1', concepts: ['고려'], points: 4, targetAchievementLevel: 'C' }],
  questionSnapshots: [{ id: '1', type: 'choice', question: '합성 자료', answer: '고려', options: ['고려', '조선'], points: 4, paperOrder: 1, examRound: round }],
});
let eventNumber = 0;
const publish = async (id, next, source = 'canonical') => {
  const path = source === 'canonical' ? `semester_assessment_results/${id}` : `${root}/quiz_results/${id}`;
  const ref = actual.doc(path), before = await ref.get();
  next ? await ref.set(next) : await ref.delete();
  const after = await ref.get();
  const event = { id: randomUUID(), time: new Date(Date.now() + ++eventNumber).toISOString(),
    params: { resultId: id, ...(source === 'legacy' ? { year: '2026', semester: '2' } : {}) }, data: { before, after } };
  await invalidation.onResult(event); return event;
};
const delta = (baseline, overrides = {}) => service.query(normalizeQuery({ ...q, ...overrides, mode: 'changes', liveMode: overrides.liveMode || 'achievement',
  contextVersion: baseline.live.contextVersion, contentCursor: baseline.live.contentCursor,
  cursors: baseline.live.classes.map(({ classId, cursor }) => ({ classId, cursor })) }));
const resetReads = () => { queryLog.length = 0; bodyReads.length = 0; };
const noFullRead = () => assert.ok(queryLog.every(path => path.endsWith('/changes')),
  `Delta must not query source results, questions, class or roster collections: ${queryLog}`);

(async () => {
  const seed = {
    'site_settings/config': { year: '2026', semester: '2', activeSemesterId: scope },
    'site_settings/semester_active': { semesterId: scope, revision: 1 },
    [`semester_manifests/${scope}`]: { semesterId: scope, revision: 1, status: 'ACTIVE' },
    [`${root}/curriculum/tree`]: { tree: [] },
    [`${root}/quiz_questions/1`]: { id: 1, unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
      type: 'choice', question: '합성 자료', answer: '고려', options: ['고려', '조선'], points: 4, paperOrder: 1, contentRevision: 1 },
    [`semester_assessment_definitions/${definitionId}`]: { semesterId: scope, assessmentKind: 'QUIZ', sourceId: 'exam_prep', category: 'exam_prep',
      examRound: 'round_1', status: 'PUBLISHED', title: '합성 시험', questionCount: 1 },
    'semester_assessment_results/r1': result('r1'),
  };
  for (const uid of ['a', 'b']) {
    seed[`semester_classes/class_${uid}`] = { semesterId: scope, status: 'ACTIVE', grade: '3', classNumber: uid === 'a' ? '1' : '2' };
    seed[`users/${uid}`] = { role: 'student', name: `합성 ${uid}`, email: `${uid}@example.invalid` };
    seed[`semester_enrollments/en_${uid}`] = { semesterId: scope, studentUid: uid, classId: `class_${uid}`, enrollmentStatus: 'ACTIVE', displayName: `합성 ${uid}`, studentNumber: '1' };
    seed[`semester_enrollment_slots/${buildEnrollmentSlotId(scope, uid)}`] = { semesterId: scope, studentUid: uid, activeEnrollmentId: `en_${uid}` };
  }
  const batch = actual.batch(); for (const [path, value] of Object.entries(seed)) batch.set(actual.doc(path), value); await batch.commit();
  const initial = await service.query(normalizeQuery(q));
  assert.equal(initial.rawRows.length, 1);
  const event = await publish('r2', result('r2'));
  resetReads(); const added = await delta(initial); noFullRead();
  assert.deepEqual(added.rawRows.map(row => row.id), ['r2']);
  assert.deepEqual(added.mockExamScoreRows.map(row => row.id), ['r2']);
  assert.deepEqual(bodyReads.filter(path => path.startsWith('semester_assessment_results/')), ['semester_assessment_results/r2']);
  const cursor = added.live.classes[0].cursor;
  await invalidation.onResult(event);
  resetReads(); const duplicate = await delta(added); noFullRead();
  assert.equal(duplicate.rawRows.length, 0); assert.equal(duplicate.live.classes[0].cursor, cursor);
  assert.equal(queryLog.length, 0, 'An unchanged cursor performs no change-log query');
  await publish('r2', { ...result('r2'), answers: { 1: '고려' }, percent: 100, score: 1, answerChecks: [{ id: '1', correct: true }] });
  await invalidation.onResult(event); // delayed older delivery must not advance or roll back the marker
  const edited = await delta(added);
  assert.equal(edited.rawRows[0].raw.answers[1], '고려');
  assert.equal(edited.live.classes[0].cursor, cursor + 1);
  await publish('r2', null); resetReads(); const deleted = await delta(edited); noFullRead();
  assert.deepEqual(deleted.removedKeys, ['canonical:r2']); assert.deepEqual(deleted.rawRows, []);
  await publish('outsider', result('outsider', 'b'));
  resetReads(); const other = await delta(deleted); noFullRead(); assert.deepEqual(other.rawRows, []);
  assert.equal(bodyReads.some(path => path.endsWith('/outsider')), false);
  // A submission committed during initial loading but whose trigger arrives later
  // is replayed from the cursor captured before that initial read.
  await actual.doc('semester_assessment_results/r3').set(result('r3'));
  const delayedBaseline = await service.query(normalizeQuery(q));
  await publish('r3', result('r3'));
  const delayed = await delta(delayedBaseline); assert.deepEqual(delayed.rawRows.map(row => row.id), ['r3']);
  const questionRef = actual.doc(`${root}/quiz_questions/1`), before = await questionRef.get();
  await questionRef.update({ contentRevision: 2, concepts: ['왕권'] });
  await invalidation.onScope(['contentGeneration', 'catalogGeneration'])({ id: randomUUID(), time: new Date().toISOString(),
    params: { year: '2026', semester: '2', questionId: '1' }, data: { before, after: await questionRef.get() } });
  resetReads(); const questionChanged = await delta(delayed); noFullRead();
  assert.deepEqual(questionChanged.questionUpserts.map(row => row.sourceRevision), ['2']);
  assert.deepEqual(questionChanged.rawRows, []);
  const compactQuestionDelta = await delta(delayed, { liveMode: 'summary' });
  assert.equal(compactQuestionDelta.questionUpserts[0].question, undefined);
  assert.deepEqual(compactQuestionDelta.questionUpserts[0].options, ['고려', '조선']);
  const summary = await service.query(normalizeQuery({ ...q, mode: 'summary' }));
  assert.equal(summary.liveData.records.length, 2);
  assert.equal(summary.liveData.classes[0].grade, '3');
  assert.equal(JSON.stringify(summary.liveData).includes('questionSnapshots'), false);
  await publish('r4', result('r4'));
  resetReads(); const summaryDelta = await delta(summary, { liveMode: 'summary' }); noFullRead();
  assert.deepEqual(summaryDelta.records.map(row => row.id), ['r4']); assert.deepEqual(summaryDelta.rawRows, []);
  // Drain a backlog without an arbitrary truncation or full class rebuild.
  for (let offset = 5; offset < 33; offset += 4)
    await Promise.all(Array.from({ length: Math.min(4, 33 - offset) }, (_, index) => publish(`r${offset + index}`, result(`r${offset + index}`))));
  let current = summaryDelta, total = 0, pages = 0;
  do { resetReads(); current = await delta(current); noFullRead(); total += current.rawRows.length; pages++; } while (current.hasMore);
  assert.equal(total, 28); assert.equal(pages, 2);
  duringResultRead = () => publish('r40', result('r40'));
  const liveRace = await service.query(normalizeQuery(q));
  assert.equal(duringResultRead, undefined);
  assert.ok((await delta(liveRace)).rawRows.some(row => row.id === 'r40'), 'A live baseline tolerates submissions during its result read and replays from its earlier cursor');
  duringResultRead = () => publish('r41', result('r41'));
  const summaryRace = await service.query(normalizeQuery({ ...q, mode: 'summary', forceRefresh: true }));
  assert.ok((await delta(summaryRace, { liveMode: 'summary' })).records.some(row => row.id === 'r41'),
    'Live summary does not retry a full class build when a pupil submits during that build');
  const { createQuizQuestionCorrectionService } = require('../quizQuestionCorrections');
  const correctionService = createQuizQuestionCorrectionService({ db: actual });
  const submissionOnly = { ...result('r42'), submissionRef: 'semester_assessment_submissions/r42' };
  delete submissionOnly.answers;
  await actual.doc('semester_assessment_results/r42').set(submissionOnly);
  await actual.doc('semester_assessment_submissions/r42').set({ studentUid: 'a', semesterId: scope,
    attemptId: 'r42', definitionId, answers: { 1: '조선' } });
  const originalResult = (await actual.doc('semester_assessment_results/r1').get()).data();
  const originalQuestion = await questionRef.get();
  await questionRef.update({ contentRevision: 3, answer: '조선', curriculumVersion: '2018-162', achievementStandardCodes: ['9역07-01'],
    achievementMappingSource: 'manual', targetAchievementLevel: 'B', intendedDifficulty: 'hard' });
  const questionEvent = { id: randomUUID(), params: { year: '2026', semester: '2', questionId: '1' },
    data: { before: originalQuestion, after: await questionRef.get() } };
  await correctionService.onQuestion(questionEvent);
  const corrected = (await actual.doc('semester_assessment_results/r1').get()).data();
  assert.deepEqual(corrected.answers, originalResult.answers); assert.deepEqual(corrected.answerChecks, originalResult.answerChecks);
  const correctedSubmissionOnly = (await actual.doc('semester_assessment_results/r42').get()).data();
  assert.equal(correctedSubmissionOnly.answers, undefined, 'Correction does not copy immutable submission answers into the canonical result');
  assert.equal(correctedSubmissionOnly.gradingCorrectionSummary.percent, 100);
  await publish('r1', corrected);
  await publish('r42', { ...correctedSubmissionOnly, updatedAtIso: new Date().toISOString() });
  const correctionDelta = await delta(summaryRace);
  const changedResult = correctionDelta.rawRows.find(row => row.id === 'r1').raw;
  assert.equal(changedResult.answerChecks[0].correct, true);
  assert.equal(changedResult.learningSnapshot[0].sourceRevision, '3');
  assert.equal(changedResult.learningSnapshot[0].targetAchievementLevel, 'B');
  assert.equal(changedResult.learningSnapshot[0].intendedDifficulty, 'hard');
  assert.equal(correctionDelta.mockExamScoreRows.find(row => row.id === 'r1').raw.cutScoreQuestions[0].targetAchievementLevel, 'B');
  const joinedDelta = correctionDelta.rawRows.find(row => row.id === 'r42').raw;
  assert.equal(joinedDelta.answers[1], '조선');
  assert.equal(joinedDelta.answerChecks[0].correct, true);
  assert.equal(joinedDelta.questionSnapshots[0].answer, '조선');
  const correctionInitial = await service.query(normalizeQuery(q));
  assert.deepEqual(correctionInitial.rawRows.find(row => row.id === 'r1').raw.learningSnapshot, changedResult.learningSnapshot);
  await actual.doc(`${root}/quiz_questions/2`).set({ ...seed[`${root}/quiz_questions/1`], id: 2, examRound: 'round_2' });
  await actual.doc(`semester_assessment_definitions/${definitionId.replace('round_1', 'round_2')}`).set({
    ...seed[`semester_assessment_definitions/${definitionId}`], examRound: 'round_2' });
  const cumulative = await service.query(normalizeQuery({ ...q, examRound: 'round_2' }));
  const priorScore = cumulative.mockExamScoreRows.find(row => row.id === 'r1').raw;
  assert.equal(priorScore.percent, 100);
  assert.equal(priorScore.cutScoreQuestions[0].targetAchievementLevel, 'B', 'Earlier-round score projections retain corrected achievement metadata without fetching original answers/images');
  await publish('r1', { ...corrected, updatedAtIso: new Date().toISOString() });
  resetReads(); const cumulativeDelta = await delta(cumulative, { examRound: 'round_2' }); noFullRead();
  assert.equal(cumulativeDelta.rawRows.length, 0);
  assert.equal(cumulativeDelta.mockExamScoreRows[0].raw.cutScoreQuestions[0].targetAchievementLevel, 'B');
  // A stable marker can coalesce several scope moves before the client reads it.
  const beforeMoves = await service.query(normalizeQuery(q));
  await publish('r3', result('r3', 'a', 'round_2'));
  await publish('r3', result('r3', 'a', 'round_3'));
  resetReads(); const movedResult = await delta(beforeMoves); noFullRead();
  assert.ok(movedResult.removedKeys.includes('canonical:r3'));
  assert.equal(movedResult.rawRows.length, 0);
  assert.equal(bodyReads.some(path => path === 'semester_assessment_results/r3'), false,
    'Successive out-of-scope moves remove the stale row without reading its body');
  const beforeRename = await questionRef.get();
  await questionRef.update({ id: 11, examRound: 'round_2' });
  const middleRename = await questionRef.get();
  await questionRef.update({ id: 12, examRound: 'round_3' });
  const afterRename = await questionRef.get();
  const questionChange = (before, after) => ({ id: randomUUID(), params: { year: '2026', semester: '2', questionId: '1' }, data: { before, after } });
  const recordQuestion = invalidation.onScope(['contentGeneration', 'catalogGeneration']);
  await recordQuestion(questionChange(middleRename, afterRename));
  await recordQuestion(questionChange(beforeRename, middleRename));
  resetReads(); const movedQuestion = await delta(movedResult); noFullRead();
  assert.ok(movedQuestion.questionRemovedIds.includes('1'), 'Reverse-order logical-ID edits retain every stale identity to remove');
  assert.equal(movedQuestion.questionUpserts.length, 0);
  await actual.doc(`quiz_class_analysis_state/${scope}`).set({ rosterGeneration: 'moved' }, { merge: true });
  await assert.rejects(delta(current), error => error.details?.reason === 'QUIZ_ANALYSIS_LIVE_SCOPE_CHANGED');
  await assert.rejects(service.query(normalizeQuery({ ...q, mode: 'changes', liveMode: 'achievement', contextVersion: current.live.contextVersion,
    contentCursor: current.live.contentCursor, cursors: [{ classId: 'class_b', cursor: 0 }] })), error => error.details?.reason === 'QUIZ_ANALYSIS_CLASS_INVALID');
  console.log('PASS real Firestore live initial/cursor handoff and concurrent initial reads, scoped create/edit/delete/move, duplicate/out-of-order delivery, unchanged zero queries, question delta/rename, summary compact base, 28-event paging, effective grading+achievement metadata, roster fence and foreign-class block; no source collection scans per delta');
})().finally(() => deleteApp(app)).catch(error => { console.error(error); process.exitCode = 1; });
