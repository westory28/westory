const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const { buildCorrection, effectiveQuizResult, applicableCorrection, createQuizQuestionCorrectionService } = require('../quizQuestionCorrections');
const catalog = require('../shared/historyAchievementStandards.json');
const scope = '2026-2';
const definitionId = 'quiz:2026-2:exam_prep:exam_prep:round_1';
const original = { id: 1, unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', paperOrder: 1, points: 3,
  type: 'short', question: '합성 문항', answer: '고조선', passage: '보관된 원문', image: 'original-image', contentRevision: 1 };
const metadata = { curriculumVersion: catalog.curriculumVersion, achievementStandardCodes: [catalog.standards[0].code],
  achievementMappingSource: 'manual', targetAchievementLevel: 'B', intendedDifficulty: 'hard' };
const result = id => ({ resultId: id, attemptId: id, definitionId, semesterId: scope, assessmentKind: 'QUIZ', studentUid: 'synthetic-student',
  score: 1, percent: 40, total: 2, earnedPoints: 2, maxPoints: 5, reward: { awarded: true, amount: 100 },
  answers: { 1: '조선', 2: '가' }, answerChecks: [{ id: '1', correct: false }, { id: '2', correct: true }],
  learningSnapshot: [{ id: '1', sourceRevision: '1', concepts: ['보관된 개념'] }, { id: '2', sourceRevision: '1' }],
  questionSnapshots: [{ ...original }, { id: '2', type: 'choice', question: '둘째 원문', answer: '가', options: ['가', '나'], points: 2 }],
  sourceHash: 'original-source', submittedAtIso: '2026-11-10T00:00:00Z', receiptId: 'original-receipt' });
const deepMerge = (left, right) => Object.fromEntries([...new Set([...Object.keys(left || {}), ...Object.keys(right)])].map(key =>
  [key, Object.hasOwn(right, key) ? right[key] && typeof right[key] === 'object' && !Array.isArray(right[key])
    ? deepMerge(left?.[key], right[key]) : right[key] : left[key]]));
function memoryDb() {
  const rows = new Map(), writes = [], reads = [];
  const snap = ref => ({ id: ref.id, ref, exists: rows.has(ref.path), data: () => structuredClone(rows.get(ref.path)) });
  const db = {
    rows, writes, reads,
    doc: path => ({ path, id: path.split('/').at(-1), async get() { reads.push(path); return snap(this); } }),
    async runTransaction(callback) {
      const pending = [];
      const value = await callback({
        getAll: async (...refs) => { reads.push(...refs.map(ref => ref.path)); return refs.map(snap); },
        set: (ref, data, options) => pending.push({ ref, data, options }),
      });
      for (const { ref, data, options } of pending) { rows.set(ref.path, options?.merge ? deepMerge(rows.get(ref.path), data) : structuredClone(data)); writes.push(ref.path); }
      return value;
    },
    collection(path) {
      const filters = []; let maximum = Infinity, after = '';
      const query = { where(field, _op, value) { filters.push([field, value]); return query; }, select() { return query; }, orderBy() { return query; },
        limit(value) { maximum = value; return query; }, startAfter(value) { after = value.id; return query; },
        async get() { const docs = [...rows].filter(([key, data]) => key.startsWith(path + '/') && key.slice(path.length + 1).indexOf('/') < 0
            && filters.every(([field, value]) => data[field] === value) && key.split('/').at(-1) > after)
            .sort(([a], [b]) => a.localeCompare(b)).slice(0, maximum).map(([key]) => snap(db.doc(key))); return { docs, size: docs.length }; } };
      return query;
    },
  };
  return db;
}
const questionPath = 'years/2026/semesters/2/quiz_questions/doc-1';
const event = (db, before, after) => ({ params: { year: '2026', semester: '2', questionId: 'doc-1' },
  data: { before: { exists: true, data: () => before }, after: { exists: true, ref: db.doc(questionPath), data: () => after } } });

test('aliases and achievement edits update a separate projection, preserving original paper, answers, scores and reward', async () => {
  const db = memoryDb(), service = createQuizQuestionCorrectionService({ db });
  const before = result('r1'); db.rows.set('semester_assessment_results/r1', before);
  const after = { ...original, ...metadata, answer: '고조선, 조선', contentRevision: 2 };
  db.rows.set(questionPath, after);
  await service.onQuestion(event(db, original, after));
  const saved = db.rows.get('semester_assessment_results/r1'), effective = effectiveQuizResult(saved);
  assert.equal(saved.score, before.score); assert.equal(saved.percent, 40); assert.deepEqual(saved.answers, before.answers);
  assert.deepEqual(saved.questionSnapshots, before.questionSnapshots); assert.deepEqual(saved.reward, before.reward);
  assert.equal(effective.percent, 100); assert.equal(effective.earnedPoints, 5); assert.equal(effective.score, 2);
  assert.equal(effective.questionSnapshots[0].answer, '고조선, 조선'); assert.equal(effective.questionSnapshots[0].image, 'original-image');
  assert.equal(effective.learningSnapshot[0].sourceRevision, '2'); assert.equal(effective.learningSnapshot[0].targetAchievementLevel, 'B');
  assert.equal(effective.learningSnapshot[0].intendedDifficulty, 'hard'); assert.deepEqual(effective.learningSnapshot[0].concepts, ['보관된 개념']);
  assert.equal(effectiveQuizResult({ assessmentKind: 'QUIZ', gradingCorrectionSummary: saved.gradingCorrectionSummary }).percent, 100,
    'Compact lists use a grade summary, without answers or paper images');
  assert.deepEqual(effectiveQuizResult(effective), effective, 'Read projection is idempotent');
  const previousVersion = saved.gradingCorrectionVersion, writes = db.writes.length;
  await service.onQuestion(event(db, original, after));
  assert.equal(db.rows.get('semester_assessment_results/r1').gradingCorrectionVersion, previousVersion);
  assert.equal(db.writes.slice(writes).filter(path => path.startsWith('semester_assessment_results/')).length, 0);
  assert(!db.writes.some(path => /wis|wallet|attempt|submission|receipt/.test(path)));
  const signal = db.rows.get('quiz_result_correction_signals/r1');
  assert.equal(signal.studentUid, 'synthetic-student'); assert.equal(signal.semesterId, scope); assert.equal(signal.version, previousVersion);
  assert(!Object.hasOwn(signal, 'answers'));
});

test('in-flight old attempts are corrected on result creation; unseen whole bank is never loaded', async () => {
  const db = memoryDb(), service = createQuizQuestionCorrectionService({ db });
  const after = { ...original, answer: '고조선, 조선', contentRevision: 2 };
  db.rows.set(questionPath, after); await service.onQuestion(event(db, original, after));
  db.rows.set('semester_assessment_results/late', result('late'));
  await service.onCreatedResult({ data: { ref: db.doc('semester_assessment_results/late'), data: () => result('late') } });
  assert.equal(effectiveQuizResult(db.rows.get('semester_assessment_results/late')).percent, 100);
  assert.equal(db.reads.filter(path => path.includes('quiz_question_correction_indexes/')).length, 1);
});

test('older canonical results join only their bound immutable submission and retain original storage', async () => {
  const db = memoryDb(), service = createQuizQuestionCorrectionService({ db });
  const before = result('older'), answers = before.answers;
  delete before.answers;
  before.submissionRef = 'semester_assessment_submissions/older';
  const submission = { submissionId: 'older', attemptId: 'older', definitionId, semesterId: scope,
    studentUid: before.studentUid, sourceHash: before.sourceHash, answers };
  db.rows.set('semester_assessment_results/older', before);
  db.rows.set(before.submissionRef, submission);
  const after = { ...original, ...metadata, answer: '고조선, 조선', contentRevision: 2 };
  db.rows.set(questionPath, after);
  await service.onQuestion(event(db, original, after));
  const saved = db.rows.get('semester_assessment_results/older');
  assert.equal(db.reads.filter(path => path === before.submissionRef).length, 1);
  assert.equal(Object.hasOwn(saved, 'answers'), false);
  assert.deepEqual(db.rows.get(before.submissionRef), submission);
  assert.deepEqual(saved.questionSnapshots, before.questionSnapshots);
  assert.deepEqual(saved.answerChecks, before.answerChecks);
  assert.deepEqual(saved.reward, before.reward);
  assert.equal(saved.percent, 40);
  const compact = effectiveQuizResult(saved);
  assert.equal(compact.percent, 100);
  assert.equal(compact.earnedPoints, 5);
  assert.equal(compact.questionSnapshots[0].answer, after.answer);
  assert.equal(compact.learningSnapshot[0].targetAchievementLevel, 'B');
  assert.equal(compact.learningSnapshot[0].sourceRevision, '2');
  assert.equal(effectiveQuizResult({ ...saved, answers }).percent, 100);
  assert(!db.writes.some(path => path.startsWith('semester_assessment_submissions/')));
});

test('submission-only correction rejects mismatched owner, semester, attempt, definition, identity and source', async () => {
  const invalid = [
    { studentUid: 'someone-else' }, { semesterId: '2026-1' }, { attemptId: 'another-attempt' },
    { definitionId: 'another-definition' }, { submissionId: 'another-submission' }, { sourceHash: 'different-source' },
    { answers: [] },
  ];
  for (const patch of invalid) {
    const db = memoryDb(), service = createQuizQuestionCorrectionService({ db });
    const before = result('invalid'), answers = before.answers;
    delete before.answers;
    before.submissionRef = 'semester_assessment_submissions/invalid';
    db.rows.set('semester_assessment_results/invalid', before);
    db.rows.set(before.submissionRef, { submissionId: 'invalid', attemptId: 'invalid', definitionId, semesterId: scope,
      studentUid: before.studentUid, sourceHash: before.sourceHash, answers, ...patch });
    const after = { ...original, answer: '고조선, 조선', contentRevision: 2 };
    db.rows.set(questionPath, after);
    await service.onQuestion(event(db, original, after));
    assert.deepEqual(db.rows.get('semester_assessment_results/invalid'), before, JSON.stringify(patch));
    assert.equal(db.rows.has('quiz_result_correction_signals/invalid'), false);
    assert.equal(db.reads.filter(path => path === before.submissionRef).length, 1);
  }
});

test('changed source material, missing revision evidence, other scope, and non-quiz results are not reinterpreted', () => {
  const after = { ...original, ...metadata, contentRevision: 2 };
  const correction = buildCorrection(scope, 'doc-1', original, after);
  assert.equal(buildCorrection(scope, 'doc-1', original, { ...after, image: 'different-image' }), null);
  assert.equal(applicableCorrection({ ...result('r'), questionSnapshots: [{ ...original, question: '다른 원문' }] }, correction), false);
  assert.equal(applicableCorrection({ ...result('r'), semesterId: '2026-1' }, correction), false);
  assert.equal(applicableCorrection({ ...result('r'), assessmentKind: 'HISTORY_CLASSROOM' }, correction), false);
  assert.equal(applicableCorrection({ ...result('r'), questionSnapshots: [], learningSnapshot: [] }, correction), false);
  assert.equal(applicableCorrection({ ...result('r'), questionSnapshots: [] }, correction), true, 'Known compatible revision permits omitted original images without fetching today’s images');
});

test('metadata-only edit never regrades; later removals regrade from original and delayed events cannot roll back', async () => {
  const db = memoryDb(), service = createQuizQuestionCorrectionService({ db });
  db.rows.set('semester_assessment_results/r', result('r'));
  const second = { ...original, ...metadata, contentRevision: 2 };
  db.rows.set(questionPath, second); await service.onQuestion(event(db, original, second));
  assert.equal(effectiveQuizResult(db.rows.get('semester_assessment_results/r')).percent, 40);
  const third = { ...second, answer: '고조선, 조선', contentRevision: 3 };
  db.rows.set(questionPath, third); await service.onQuestion(event(db, second, third));
  assert.equal(effectiveQuizResult(db.rows.get('semester_assessment_results/r')).percent, 100);
  const fourth = { ...third, answer: '고조선', contentRevision: 4 };
  db.rows.set(questionPath, fourth); await service.onQuestion(event(db, third, fourth));
  await service.onQuestion(event(db, original, second));
  const effective = effectiveQuizResult(db.rows.get('semester_assessment_results/r'));
  assert.equal(effective.percent, 40); assert.equal(effective.learningSnapshot[0].sourceRevision, '4');
});

test('paging updates every matching result and leaves unrelated definitions untouched', async () => {
  const db = memoryDb(), service = createQuizQuestionCorrectionService({ db });
  for (let index = 0; index < 105; index++) { const id = 'r' + String(index).padStart(3, '0'); db.rows.set('semester_assessment_results/' + id, result(id)); }
  db.rows.set('semester_assessment_results/other', { ...result('other'), definitionId: 'another-assessment' });
  const after = { ...original, answer: '고조선, 조선', contentRevision: 2 };
  db.rows.set(questionPath, after); await service.onQuestion(event(db, original, after));
  assert.equal([...db.rows].filter(([path]) => path.startsWith('quiz_result_correction_signals/')).length, 105);
  assert.equal(db.rows.get('semester_assessment_results/other').gradingCorrections, undefined);
});
