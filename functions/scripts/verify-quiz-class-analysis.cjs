const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildEnrollmentSlotId } = require('../productionGateway/archiveEnrollment');
const { normalizeQuery, createQuizClassAnalysisService, createQuizClassAnalysisHandler,
  createQuizAnalysisInvalidation, summarizeClass, readBounded, hash } = require('../quizClassAnalysis');

const SCOPE = '2026-2';
const ROOT = 'years/2026/semesters/2';
const q = { semesterId: SCOPE, mode: 'summary', unitId: 'unit-a', category: 'formative', examRound: '', classIds: ['class_a'], forceRefresh: false };
const fixture = () => ({
  'users/teacher': { role: 'teacher' },
  'site_settings/config': { year: '2026', semester: '2', activeSemesterId: SCOPE },
  'site_settings/semester_active': { semesterId: SCOPE, revision: 1 },
  [`semester_manifests/${SCOPE}`]: { semesterId: SCOPE, status: 'ACTIVE', revision: 1 },
  'semester_classes/class_a': { semesterId: SCOPE, status: 'ACTIVE', grade: '3', classNumber: '1' },
  'semester_classes/class_b': { semesterId: SCOPE, status: 'ACTIVE', grade: '3', classNumber: '2' },
  'semester_classes/old_class': { semesterId: '2026-1', status: 'ACTIVE', grade: '3', classNumber: '1' },
  'semester_enrollments/en_a': { semesterId: SCOPE, studentUid: 'a', classId: 'class_a', enrollmentStatus: 'ACTIVE', studentNumber: '1', snapshot: { displayName: '학생 A' } },
  'semester_enrollments/en_b': { semesterId: SCOPE, studentUid: 'b', classId: 'class_b', enrollmentStatus: 'ACTIVE', studentNumber: '2', snapshot: { displayName: '학생 B' } },
  [`semester_enrollment_slots/${buildEnrollmentSlotId(SCOPE, 'a')}`]: { semesterId: SCOPE, studentUid: 'a', activeEnrollmentId: 'en_a', status: 'ACTIVE' },
  [`semester_enrollment_slots/${buildEnrollmentSlotId(SCOPE, 'b')}`]: { semesterId: SCOPE, studentUid: 'b', activeEnrollmentId: 'en_b', status: 'ACTIVE' },
  'users/a': { role: 'student', name: '학생 A', grade: '3', class: '1', number: '1', email: 'a@school.test' },
  'users/b': { role: 'student', name: '학생 B', grade: '3', class: '2', number: '2', email: 'b@school.test' },
  [`${ROOT}/curriculum/tree`]: { tree: [{ id: 'big', title: '조선', children: [{ id: 'unit-a', title: '사림' }] }] },
  [`${ROOT}/quiz_questions/1`]: { id: 1, unitId: 'unit-a', category: 'formative', question: '사림에 대한 설명은?', contentRevision: 2, concepts: ['사림'], answer: '정답', image: 'PRIVATE_LARGE_IMAGE' },
  'semester_assessment_results/r1': { assessmentKind: 'QUIZ', semesterId: SCOPE, sourceId: 'unit-a', category: 'formative', studentUid: 'a', classId: 'class_a',
    attemptId: 'r1', percent: 0, total: 1, answerChecks: [{ id: 1, correct: false }], learningSnapshot: [{ id: 1, sourceRevision: '2', concepts: ['사림'], reviewLessonId: 'lesson-a' }], submittedAtIso: '2026-10-24T01:00:00Z' },
  'semester_assessment_results/r2': { assessmentKind: 'QUIZ', semesterId: SCOPE, sourceId: 'unit-a', category: 'formative', studentUid: 'a', classId: 'class_a',
    attemptId: 'r2', percent: 100, total: 1, answerChecks: [{ id: 1, correct: true }], learningSnapshot: [{ id: 1, sourceRevision: '2', concepts: ['사림'] }], submittedAtIso: '2026-10-25T01:00:00Z' },
  'semester_assessment_results/rb': { assessmentKind: 'QUIZ', semesterId: SCOPE, sourceId: 'unit-a', category: 'formative', studentUid: 'b', classId: 'class_b', percent: 20, submittedAtIso: '2026-10-25T01:00:00Z' },
  [`${ROOT}/quiz_results/duplicate`]: { uid: 'a', unitId: 'unit-a', category: 'formative', canonicalAttemptId: 'r1', score: 90, timestamp: '2026-10-24T01:00:00Z', details: [{ id: 1, correct: true, sourceRevision: '2' }] },
});

function memory(initial = fixture()) {
  const data = new Map(Object.entries(initial));
  const reads = [], queries = [], writes = [];
  const snapshot = path => ({ id: path.split('/').at(-1), ref: ref(path), exists: data.has(path), data: () => data.get(path) });
  const ref = path => ({ path, get: async () => { reads.push(path); return snapshot(path); },
    set: async (value, options) => { writes.push(path); data.set(path, options?.merge ? { ...data.get(path), ...value } : value); } });
  const collection = path => {
    const filters = []; let projection, limit = Infinity, after;
    const cursor = { where(field, operator, value) { filters.push([field, operator, value]); return cursor; },
      select(...fields) { projection = fields; return cursor; }, orderBy() { return cursor; },
      limit(value) { limit = value; return cursor; }, startAfter(value) { after = value.id; return cursor; },
      async get() {
        queries.push({ path, filters: structuredClone(filters), projection, limit });
        let entries = [...data.entries()].filter(([key]) => key.startsWith(`${path}/`) && key.slice(path.length + 1).split('/').length === 1)
          .filter(([, value]) => filters.every(([field, op, wanted]) => op === '==' ? value[field] === wanted : wanted.includes(value[field])))
          .sort((a, b) => a[0].localeCompare(b[0]));
        if (after) entries = entries.filter(([key]) => key.split('/').at(-1) > after);
        const docs = entries.slice(0, limit).map(([key, value]) => ({ ...snapshot(key), data: () => projection
          ? Object.fromEntries(projection.filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]])) : value }));
        return { docs, size: docs.length, empty: !docs.length };
      } };
    return cursor;
  };
  const db = { doc: ref, collection, getAll: async (...refs) => Promise.all(refs.map(r => r.get())),
    runTransaction: async callback => callback({ getAll: async (...refs) => Promise.all(refs.map(r => r.get())), set: (r, value) => { writes.push(r.path); data.set(r.path, value); } }) };
  return { db, data, reads, queries, writes };
}

test('query validates class bounds, scope and detail restriction', () => {
  assert.equal(normalizeQuery({ ...q }).classIds.length, 1);
  for (const patch of [{ classIds: [] }, { classIds: ['a', 'a'] }, { classIds: ['a', 'b', 'c', 'd', 'e'] },
    { mode: 'detail', classIds: ['a', 'b'] }, { semesterId: '../2026-2' }, { category: 'other' }, { unitId: '../a' }]) {
    assert.throws(() => normalizeQuery({ ...q, ...patch }), e => e.code === 'invalid-argument');
  }
});

test('catalog has real current classes, no student names or answers and no result reads', async () => {
  const f = memory(), service = createQuizClassAnalysisService({ db: f.db });
  const result = await service.query({ semesterId: SCOPE, mode: 'catalog' });
  assert.deepEqual(result.classes.map(c => c.id), ['class_a', 'class_b']);
  assert.equal(result.assessments[0].questionCount, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE_LARGE_IMAGE'), false);
  assert.equal(JSON.stringify(result).includes('학생 A'), false);
  assert.equal(f.queries.some(query => /users|results|enrollments/.test(query.path)), false);
});

test('class summary uses recent score, deduplicates legacy and carries repeated outcomes without identities', async () => {
  const f = memory(), service = createQuizClassAnalysisService({ db: f.db });
  const result = await service.query(q), summary = result.classes[0];
  assert.equal(summary.rosterCount, 1);
  assert.equal(summary.submittedCount, 1);
  assert.equal(summary.averageScore, 100);
  assert.equal(summary.questions[0].correctRate, 100);
  assert.equal(summary.relearning.wrongToCorrectCount, 1);
  assert.equal(summary.relearning.repeatedStudentCount, 1);
  assert.equal(JSON.stringify(result).includes('학생 A'), false);
  assert.equal(JSON.stringify(result).includes('a@school.test'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_LARGE_IMAGE'), false);
  const resultQueries = f.queries.filter(query => /results$/.test(query.path));
  assert.ok(resultQueries.length > 0);
  assert.ok(resultQueries.every(query => query.filters.length === 1 && query.filters[0][1] === 'in'
    && query.filters[0][2].every(id => ['a', 'a@school.test'].includes(id))));
  const count = f.queries.length;
  await service.query(q);
  assert.equal(f.queries.length, count, 'warm visit must not query students, questions or result collections');
});

test('result invalidation rebuilds only stale class snapshot and advances student revision', async () => {
  const f = memory(), service = createQuizClassAnalysisService({ db: f.db });
  await service.query(q);
  const invalidation = createQuizAnalysisInvalidation({ db: f.db });
  const updated = { ...f.data.get('semester_assessment_results/r2'), percent: 50 };
  f.data.set('semester_assessment_results/r2', updated);
  await invalidation.invalidateResult(SCOPE, updated);
  const result = await service.query(q);
  assert.equal(result.classes[0].averageScore, 50);
  assert.ok(f.data.get(`quiz_analysis_student_revisions/${hash(`${SCOPE}\na`)}`).generation);
});

test('current roster excludes stale old-class profile and includes transferred student history in new class', async () => {
  const initial = fixture();
  initial['semester_enrollments/en_a'].classId = 'class_b';
  const f = memory(initial), service = createQuizClassAnalysisService({ db: f.db });
  const old = await service.query(q);
  assert.equal(old.classes[0].rosterCount, 0);
  const current = await service.query({ ...q, classIds: ['class_b'] });
  assert.equal(current.classes[0].rosterCount, 2);
  assert.equal(current.classes[0].submittedCount, 2);
  assert.equal(current.classes[0].averageScore, 60);
});

test('detail is explicit single-class, returns existing adapters contract and not another class records', async () => {
  const f = memory(), service = createQuizClassAnalysisService({ db: f.db });
  const detail = await service.query({ ...q, mode: 'detail', classIds: ['3-1'] });
  assert.equal(detail.complete, true);
  assert.deepEqual(detail.students.map(s => s.uid), ['a']);
  assert.equal(detail.questions[0].sourceRevision, '2');
  assert.equal(detail.questions[0].image, 'PRIVATE_LARGE_IMAGE');
  assert.ok(detail.rawRows.every(row => ['r1', 'r2', 'duplicate'].includes(row.id)));
});

test('detail joins only owner-and-semester matched immutable submissions', async () => {
  const initial = fixture();
  initial['semester_assessment_results/r1'].submissionRef = 'semester_assessment_submissions/r1';
  initial['semester_assessment_results/r2'].submissionRef = 'semester_assessment_submissions/r2';
  initial['semester_assessment_submissions/r1'] = { attemptId: 'r1', studentUid: 'a', semesterId: SCOPE, answers: { 1: '보관 답안' } };
  initial['semester_assessment_submissions/r2'] = { attemptId: 'r2', studentUid: 'b', semesterId: SCOPE, answers: { 1: '다른 학생 답안' } };
  const f = memory(initial), service = createQuizClassAnalysisService({ db: f.db });
  const detail = await service.query({ ...q, mode: 'detail' });
  assert.deepEqual(detail.rawRows.find(row => row.id === 'r1').raw.answers, { 1: '보관 답안' });
  assert.equal(detail.rawRows.find(row => row.id === 'r2').raw.answers, undefined);
  assert.equal(JSON.stringify(detail).includes('다른 학생 답안'), false);
});

test('bounded pagination reads beyond the first page and rejects rather than truncating', async () => {
  const initial = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`items/${String(i).padStart(4, '0')}`, { number: i }]));
  const f = memory(initial);
  const result = await readBounded(f.db.collection('items'), 600, '검증 기록');
  assert.equal(result.length, 501);
  assert.equal(f.queries.length, 3);
  await assert.rejects(readBounded(f.db.collection('items'), 500, '검증 기록'), error => error.code === 'resource-exhausted');
});

test('missing chronology, old revision and no submissions stay distinct from zero', () => {
  const students = [{ uid: 'a', classId: 'class_a' }, { uid: 'b', classId: 'class_a' }];
  const question = [{ id: 1, unitId: 'unit-a', category: 'formative', sourceRevision: '2' }];
  const base = { id: 'r', source: 'legacy', raw: { uid: 'a', unitId: 'unit-a', category: 'formative', score: 0, details: [{ id: 1, correct: false, sourceRevision: '1' }] } };
  const summary = summarizeClass(q, { id: 'class_a', label: '3학년 1반' }, students, question, [base], new Date().toISOString(), 'v');
  assert.equal(summary.submittedCount, 1);
  assert.equal(summary.unsubmittedCount, 1);
  assert.equal(summary.averageScore, 0);
  assert.equal(summary.questions[0].correctRate, null);
  assert.equal(summary.questions[0].revisionExcludedCount, 1);
});

test('read authority and active semester are checked before catalog/cache and no recent auth is requested', async () => {
  for (const role of ['student', 'staff']) {
    const f = memory(); f.data.set('users/teacher', { role });
    let invoked = false;
    const handler = createQuizClassAnalysisHandler({ db: f.db, assertSession: async (_r, options) => {
      assert.deepEqual(options, { recentAuth: false, highRisk: false }); return { uid: 'teacher' };
    }, service: { query: async () => { invoked = true; } } });
    await assert.rejects(handler({ data: q, auth: { uid: 'teacher', token: {} } }), e => e.code === 'permission-denied');
    assert.equal(invoked, false);
  }
  const f = memory(); f.data.set('site_settings/semester_active', { semesterId: '2027-1', revision: 1 });
  const handler = createQuizClassAnalysisHandler({ db: f.db, assertSession: async () => ({ uid: 'teacher' }), service: { query: async () => assert.fail('no query') } });
  await assert.rejects(handler({ data: q, auth: { uid: 'teacher', token: {} } }), e => e.code === 'failed-precondition');
});

test('profile presentation changes invalidate roster but unrelated last-login writes do not', async () => {
  const f = memory(), service = createQuizAnalysisInvalidation({ db: f.db });
  const snapshot = value => ({ exists: true, data: () => value });
  await service.onUser({ data: { before: snapshot({ role: 'student', name: 'A', lastLogin: 1 }), after: snapshot({ role: 'student', name: 'A', lastLogin: 2 }) } });
  assert.equal(f.writes.length, 0);
  await service.onUser({ data: { before: snapshot({ role: 'student', name: 'A' }), after: snapshot({ role: 'student', name: 'B' }) } });
  assert.ok(f.data.get(`quiz_class_analysis_state/${SCOPE}`).rosterGeneration);
});

const keywordFixture = () => {
  const data = fixture();
  data[`${ROOT}/quiz_questions/2`] = { id: 2, unitId: 'unit-b', category: 'diagnostic', question: '<p>광해군</p>', passage: '사화의 원인을 찾으세요', contentRevision: 3 };
  data[`${ROOT}/quiz_questions/3`] = { id: 3, unitId: 'unit-c', category: 'exam_prep', question: '보기 고르기', options: ['광해군', '선조'], contentRevision: 1 };
  data[`${ROOT}/quiz_questions/4`] = { id: 4, unitId: 'unit-c', category: 'formative', question: '해설 확인', explanation: '광해군 시기', contentRevision: 1 };
  data[`${ROOT}/quiz_questions/5`] = { id: 5, unitId: 'unit-c', category: 'formative', question: '개념 확인', concepts: ['광해군'], contentRevision: 1 };
  data[`${ROOT}/quiz_questions/6`] = { id: 6, unitId: 'unit-c', category: 'formative', question: '연결하기', matchingPairs: [{ left: '광해군', right: '중립 외교', rightImage: 'PRIVATE_PAIR_IMAGE' }], contentRevision: 1 };
  for (const [uid, classId] of [['c', 'class_a'], ['d', 'class_c']]) {
    data[`semester_enrollments/en_${uid}`] = { semesterId: SCOPE, studentUid: uid, classId, enrollmentStatus: 'ACTIVE', studentName: `개인명 ${uid}` };
    data[`semester_enrollment_slots/${buildEnrollmentSlotId(SCOPE, uid)}`] = { semesterId: SCOPE, studentUid: uid, activeEnrollmentId: `en_${uid}`, status: 'ACTIVE' };
  }
  data['semester_classes/class_c'] = { semesterId: SCOPE, status: 'ACTIVE', grade: '3', classNumber: '3' };
  const result = (uid, checks, date) => ({ assessmentKind: 'QUIZ', semesterId: SCOPE, sourceId: 'unit-b', category: 'diagnostic', studentUid: uid,
    percent: 100, answerChecks: checks, learningSnapshot: checks.map(item => ({ id: item.id, sourceRevision: item.id === 2 ? '3' : '1' })), submittedAtIso: date });
  data['semester_assessment_results/search_old'] = result('a', [{ id: 2, correct: true }], '2026-10-24T02:00:00Z');
  data['semester_assessment_results/search_a'] = result('a', [{ id: 2, correct: false }, { id: 3, correct: true }, { id: 999, correct: true }], '2026-10-25T02:00:00Z');
  data['semester_assessment_results/search_b'] = result('b', [{ id: 2, correct: true }], '2026-10-25T02:00:00Z');
  data['semester_assessment_results/search_c'] = result('c', [{ id: 2, correct: false }], '2026-10-25T02:00:00Z');
  return data;
};
const keywordQuery = patch => normalizeQuery({ ...q, keyword: '광해군', ...patch });

test('keyword validates Unicode and whitespace, ignores assessment fields, and bounds comparison mode', () => {
  const value = normalizeQuery({ ...q, keyword: '  광해군   사화  ', unitId: '', category: '' });
  assert.equal(value.keyword, '광해군 사화');
  assert.equal(normalizeQuery({ ...q, keyword: '광해군\t\n사화' }).keyword, '광해군 사화');
  assert.equal(value.unitId, ''); assert.equal(value.category, ''); assert.equal(value.examRound, '');
  assert.equal(normalizeQuery({ ...q, keyword: '광해군' }).keyword, '광해군');
  for (const patch of [{ keyword: '' }, { keyword: ' ' }, { keyword: '<b> </b>' }, { keyword: '&nbsp;' }, { keyword: '가'.repeat(81) }, { keyword: 3 },
    { comparisonGrade: 3 }, { comparisonGrade: '03' }, { mode: 'detail', comparisonGrade: '3' }]) {
    assert.throws(() => normalizeQuery({ ...q, ...patch }), error => error.code === 'invalid-argument');
  }
});

test('keyword searches all units and saved text fields, scores only latest current matching answers', async () => {
  const f = memory(keywordFixture()), service = createQuizClassAnalysisService({ db: f.db });
  const response = await service.query(keywordQuery());
  assert.deepEqual(response.search.questionIds, ['2', '3', '4', '5', '6']);
  assert.equal(response.search.unitCount, 2);
  assert.equal(response.classes[0].basis, 'latest_current_revision_keyword_items');
  assert.equal(response.classes[0].averageScore, 25, '50% and 0%, never original 100-point assessment scores');
  assert.equal(response.classes[0].submittedCount, 2);
  assert.equal(response.classes[0].relearning.correctToWrongCount, 1);
  assert.equal(JSON.stringify(response).includes('PRIVATE_PAIR_IMAGE'), false);
  const sourceSearchCount = () => f.queries.filter(query => query.path.endsWith('/quiz_questions')).length;
  const count = sourceSearchCount();
  const andResponse = await service.query(keywordQuery({ keyword: '광해군 사화' }));
  assert.deepEqual(andResponse.search.questionIds, ['2']);
  assert.equal(andResponse.classes[0].averageScore, 0);
  assert.equal(sourceSearchCount(), count, 'a new keyword reuses the text catalog without another full question scan');
  const readCount = f.queries.length;
  await service.query(keywordQuery({ keyword: '광해군 사화' }));
  assert.equal(f.queries.length, readCount, 'warm summary performs no source collection queries');
});

test('grade comparison weights actual respondents, includes empty classes without zero imputation, and stays anonymous', async () => {
  const f = memory(keywordFixture()), service = createQuizClassAnalysisService({ db: f.db });
  const response = await service.query(keywordQuery({ comparisonGrade: '3' })), grade = response.gradeComparison;
  assert.equal(response.classes.length, 1);
  assert.equal(grade.classId, 'grade:3'); assert.equal(grade.classCount, 3); assert.equal(grade.respondingClassCount, 2);
  assert.equal(grade.rosterCount, 4); assert.equal(grade.scoredCount, 3); assert.equal(grade.unsubmittedCount, 1);
  assert.equal(grade.averageScore, 50); assert.equal(grade.scoreHistogram.reduce((sum, band) => sum + band.count, 0), 3);
  assert.equal(grade.questions.find(item => item.id === '2').respondentCount, 3);
  assert.equal(JSON.stringify(grade).includes('개인명'), false); assert.equal(JSON.stringify(grade).includes('학생 A'), false);
  assert.equal(Object.hasOwn(grade, 'students'), false); assert.equal(Object.hasOwn(grade, 'rawRows'), false);
  const reads = f.queries.length;
  await service.query(keywordQuery({ comparisonGrade: '3' }));
  assert.equal(f.queries.length, reads);
  const empty = await service.query(keywordQuery({ keyword: '일치하는문항없음', comparisonGrade: '3' }));
  assert.equal(empty.gradeComparison.averageScore, null); assert.equal(empty.gradeComparison.scoredCount, 0);
  assert.equal(empty.gradeComparison.respondingClassCount, 0); assert.equal(empty.search.matchedQuestionCount, 0);
});

test('question changes invalidate the shared search catalog; result changes preserve it but refresh class and grade', async () => {
  const f = memory(keywordFixture()), service = createQuizClassAnalysisService({ db: f.db });
  await service.query(keywordQuery({ comparisonGrade: '3' }));
  const invalidation = createQuizAnalysisInvalidation({ db: f.db });
  const questionCount = f.queries.filter(query => query.path.endsWith('/quiz_questions')).length;
  const updated = { ...f.data.get('semester_assessment_results/search_c'), answerChecks: [{ id: 2, correct: true }] };
  f.data.set('semester_assessment_results/search_c', updated);
  await invalidation.invalidateResult(SCOPE, updated);
  const result = await service.query(keywordQuery({ comparisonGrade: '3' }));
  assert.ok(Math.abs(result.gradeComparison.averageScore - 250 / 3) < 1e-9);
  assert.equal(f.queries.filter(query => query.path.endsWith('/quiz_questions')).length, questionCount);
  f.data.set(`${ROOT}/quiz_questions/2`, { ...f.data.get(`${ROOT}/quiz_questions/2`), question: '다른 문제', passage: '다른 지문', contentRevision: 4 });
  await invalidation.invalidate(SCOPE, ['contentGeneration', 'catalogGeneration']);
  const changed = await service.query(keywordQuery());
  assert.deepEqual(changed.search.questionIds, ['3', '4', '5', '6']);
  assert.equal(changed.classes[0].averageScore, 100);
});

test('keyword detail retains dedupe metadata and only selected question snapshots and answers', async () => {
  const initial = keywordFixture();
  initial['semester_assessment_results/search_a'].answers = { 2: '검색 답', 999: '범위 밖 답' };
  initial['semester_assessment_results/search_a'].questionSnapshots = [{ id: 2, question: '검색 문항' }, { id: 999, question: '범위 밖 문제' }];
  const f = memory(initial), service = createQuizClassAnalysisService({ db: f.db });
  const detail = await service.query(keywordQuery({ mode: 'detail', keyword: '광해군 사화' }));
  assert.equal(detail.complete, true); assert.equal(detail.basis, 'latest_current_revision_keyword_items');
  assert.deepEqual(detail.questions.map(row => row.id), [2]);
  assert.ok(detail.rawRows.some(row => row.id === 'r1'), 'canonical metadata stays for deduplication before question filtering');
  assert.ok(detail.rawRows.every(row => !['search_b', 'rb'].includes(row.id)));
  assert.equal(JSON.stringify(detail).includes('범위 밖'), false);
  assert.deepEqual(detail.rawRows.find(row => row.id === 'search_a').raw.answers, { 2: '검색 답' });
});

test('grade and broad keyword bounds fail explicitly without truncated comparison', async () => {
  const initial = keywordFixture();
  for (let i = 7; i < 507; i++) initial[`${ROOT}/quiz_questions/${i}`] = { id: i, unitId: 'unit-x', category: 'formative', question: '광해군' };
  const f = memory(initial), service = createQuizClassAnalysisService({ db: f.db });
  await assert.rejects(service.query(keywordQuery()), error => error.code === 'resource-exhausted' && error.details.reason === 'QUIZ_ANALYSIS_SEARCH_LIMIT');
  await assert.rejects(service.query(keywordQuery({ keyword: '검색어', comparisonGrade: '9' })), error => error.code === 'invalid-argument');
  const bound = { documents: 30000, bytes: 0 };
  await assert.rejects(readBounded(f.db.collection('semester_classes'), 100, '학급', bound), error => error.code === 'resource-exhausted' && error.details.reason === 'QUIZ_ANALYSIS_REQUEST_LIMIT');
});

test('grade concept denominators include all-correct classes and only deduped latest outcomes with known chronology', async () => {
  const initial = keywordFixture();
  for (const id of ['search_a', 'search_b', 'search_c']) initial[`semester_assessment_results/${id}`].learningSnapshot[0].concepts = ['사화'];
  initial['semester_assessment_results/search_old'].learningSnapshot[0].concepts = ['과거 개념'];
  for (const [id, correct] of [['ambiguous_a', true], ['ambiguous_b', false]]) {
    initial[`semester_assessment_results/${id}`] = { ...initial['semester_assessment_results/search_b'], studentUid: 'd',
      answerChecks: [{ id: 2, correct }], submittedAtIso: '2026-10-25T05:00:00Z' };
  }
  const f = memory(initial), service = createQuizClassAnalysisService({ db: f.db });
  const correctClass = await service.query(keywordQuery({ classIds: ['class_b'], keyword: '사화' }));
  assert.deepEqual(correctClass.classes[0].concepts, [], 'all-correct concepts stay out of the public weakness list');
  const result = await service.query(keywordQuery({ keyword: '사화', comparisonGrade: '3' }));
  assert.deepEqual(result.gradeComparison.concepts.map(({ concept, wrongCount, respondentCount }) => ({ concept, wrongCount, respondentCount })),
    [{ concept: '사화', wrongCount: 2, respondentCount: 3 }]);
  assert.equal(result.gradeComparison.scoredCount, 3, 'equal-time outcomes are unavailable, not a fourth respondent');
});

test('keyword excludes incomplete canonical records without an explicit current semester', async () => {
  const initial = keywordFixture();
  initial['semester_assessment_results/unspecified_term'] = { ...initial['semester_assessment_results/search_a'],
    semesterId: undefined, answerChecks: [{ id: 2, correct: true }], submittedAtIso: '2026-10-26T01:00:00Z' };
  const f = memory(initial), service = createQuizClassAnalysisService({ db: f.db });
  const result = await service.query(keywordQuery({ keyword: '사화' }));
  assert.equal(result.classes[0].averageScore, 0);
});

test('cold grade aggregation uses at most three concurrent class builds and preserves requested class order', async () => {
  const initial = keywordFixture();
  for (let i = 4; i <= 8; i++) initial[`semester_classes/class_${i}`] = { semesterId: SCOPE, status: 'ACTIVE', grade: '3', classNumber: String(i) };
  const f = memory(initial), originalCollection = f.db.collection;
  let active = 0, maximum = 0;
  f.db.collection = path => {
    const query = originalCollection(path), get = query.get;
    query.get = async () => {
      if (path !== 'semester_enrollments') return get();
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setImmediate(resolve));
      try { return await get(); } finally { active--; }
    };
    return query;
  };
  const service = createQuizClassAnalysisService({ db: f.db });
  const result = await service.query(keywordQuery({ comparisonGrade: '3', classIds: ['class_b', 'class_a'] }));
  assert.equal(maximum, 3);
  assert.equal(active, 0);
  assert.equal(result.gradeComparison.classCount, 8);
  assert.equal(result.gradeComparison.averageScore, 50);
  assert.deepEqual(result.classes.map(row => row.classId), ['class_b', 'class_a']);
});
