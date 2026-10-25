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
