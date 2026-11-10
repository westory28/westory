const assert = require('node:assert/strict');
const { test } = require('node:test');
const { gunzipSync } = require('node:zlib');
const { randomBytes } = require('node:crypto');
const { buildEnrollmentSlotId } = require('../productionGateway/archiveEnrollment');
const { buildQuizAnalysis } = require('../quizClassAnalysisCore.cjs');
const { normalizeQuery, createQuizClassAnalysisService, createQuizClassAnalysisHandler,
  createQuizAnalysisInvalidation, createQuizAnalysisTriggers, summarizeClass, adaptRecords, readBounded, hash } = require('../quizClassAnalysis');

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
  const reads = [], queries = [], writes = [], bodyReads = [];
  const snapshot = path => ({ id: path.split('/').at(-1), ref: ref(path), exists: data.has(path), data: () => data.get(path) });
  const ref = path => ({ path, get: async () => { reads.push(path); return snapshot(path); },
    set: async (value, options) => { writes.push(path); data.set(path, options?.merge ? { ...data.get(path), ...value } : value); } });
  const collection = path => {
    const filters = []; let projection, limit = Infinity, after;
    const cursor = { where(field, operator, value) { filters.push([field, operator, value]); return cursor; },
      select(...fields) { projection = fields; return cursor; }, orderBy() { return cursor; },
      limit(value) { limit = value; return cursor; }, startAfter(value) { after = value.id; return cursor; },
      async get() {
        const queryLog = { path, filters: structuredClone(filters), projection, limit };
        queries.push(queryLog);
        let entries = [...data.entries()].filter(([key]) => key.startsWith(`${path}/`) && key.slice(path.length + 1).split('/').length === 1)
          .filter(([, value]) => filters.every(([field, op, wanted]) => op === '==' ? value[field] === wanted : wanted.includes(value[field])))
          .sort((a, b) => a[0].localeCompare(b[0]));
        if (after) entries = entries.filter(([key]) => key.split('/').at(-1) > after);
        const docs = entries.slice(0, limit).map(([key, value]) => ({ ...snapshot(key), data: () => projection
          ? Object.fromEntries(projection.filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]])) : value }));
        queryLog.returnedPaths = entries.slice(0, limit).map(([key]) => key);
        return { docs, size: docs.length, empty: !docs.length };
      } };
    return cursor;
  };
  const db = { doc: ref, collection, getAll: async (...refs) => {
      const options = refs.at(-1)?.fieldMask ? refs.pop() : undefined;
      return Promise.all(refs.map(async r => {
        const doc = await r.get(); bodyReads.push({ path: r.path, projection: options?.fieldMask });
        return options && doc.exists ? { ...doc, data: () => Object.fromEntries(options.fieldMask
          .filter(field => Object.hasOwn(doc.data(), field)).map(field => [field, doc.data()[field]])) } : doc;
      }));
    },
    runTransaction: async callback => callback({ getAll: async (...refs) => Promise.all(refs.map(r => r.get())), set: (r, value) => { writes.push(r.path); data.set(r.path, value); } }) };
  return { db, data, reads, queries, writes, bodyReads };
}

test('query validates class bounds, scope and detail restriction', () => {
  assert.equal(normalizeQuery({ ...q }).classIds.length, 1);
  for (const patch of [{ classIds: [] }, { classIds: ['a', 'a'] }, { classIds: ['a', 'b', 'c', 'd', 'e'] },
    { mode: 'detail', classIds: ['a', 'b'] }, { semesterId: '../2026-2' }, { category: 'other' }, { unitId: '../a' }]) {
    assert.throws(() => normalizeQuery({ ...q, ...patch }), e => e.code === 'invalid-argument');
  }
});

test('achievement mode is explicit, one-class and mock-exam only', () => {
  const request = { ...q, mode: 'achievement', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1' };
  assert.equal(normalizeQuery(request).mode, 'achievement');
  for (const patch of [{ category: 'formative', examRound: '' }, { classIds: ['class_a', 'class_b'] },
    { keyword: '사림' }, { comparisonGrade: '3' }])
    assert.throws(() => normalizeQuery({ ...request, ...patch }), e => e.code === 'invalid-argument');
});

test('retired compact evidence requests require a client refresh before analysis', () => {
  const achievement = { ...q, mode: 'achievement', category: 'exam_prep', unitId: 'exam_prep', examRound: 'round_1' };
  assert.throws(() => normalizeQuery({ ...achievement, compactEvidence: true }),
    error => error.code === 'failed-precondition' && error.details.reason === 'QUIZ_ACHIEVEMENT_CLIENT_RETIRED');
  assert.equal(Object.hasOwn(normalizeQuery(achievement), 'compactEvidence'), false);
  assert.equal(Object.hasOwn(normalizeQuery({ ...achievement, compactEvidence: false }), 'compactEvidence'), false);
  for (const mode of ['catalog', 'summary', 'detail']) {
    assert.throws(() => normalizeQuery({ ...q, mode, compactEvidence: true }), error => error.code === 'invalid-argument');
    assert.equal(Object.hasOwn(normalizeQuery({ ...q, mode, compactEvidence: false }), 'compactEvidence'), false);
  }
  for (const compactEvidence of [1, 'true', null, {}, []])
    assert.throws(() => normalizeQuery({ ...achievement, compactEvidence }), error => error.code === 'invalid-argument');
});

test('gzip response encoding is explicit and restricted to achievement requests', () => {
  const request = { ...q, mode: 'achievement', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1' };
  assert.equal(normalizeQuery({ ...request, responseEncoding: 'gzip-base64' }).responseEncoding, 'gzip-base64');
  assert.equal(Object.hasOwn(normalizeQuery(request), 'responseEncoding'), false);
  for (const responseEncoding of [undefined, null, false, true, '', 'gzip', 'GZIP-BASE64', {}, []])
    assert.throws(() => normalizeQuery({ ...request, responseEncoding }), error => error.code === 'invalid-argument');
  for (const mode of ['catalog', 'summary', 'detail'])
    assert.throws(() => normalizeQuery({ ...request, mode, responseEncoding: 'gzip-base64' }), error => error.code === 'invalid-argument');
  const changes = { ...request, mode: 'changes', liveMode: 'achievement', contextVersion: 'a'.repeat(64),
    contentCursor: 0, cursors: [{ classId: 'class_a', cursor: 0 }] };
  assert.equal(normalizeQuery(changes).mode, 'changes');
  assert.throws(() => normalizeQuery({ ...changes, responseEncoding: 'gzip-base64' }), error => error.code === 'invalid-argument');
});

test('snapshot dictionary is an explicit boolean accepted only by detail requests', () => {
  assert.equal(normalizeQuery({ ...q, mode: 'detail', snapshotDictionary: true }).snapshotDictionary, true);
  for (const request of [{ ...q, mode: 'detail' }, { ...q, mode: 'detail', snapshotDictionary: false }])
    assert.equal(Object.hasOwn(normalizeQuery(request), 'snapshotDictionary'), false);
  for (const mode of ['catalog', 'summary', 'achievement']) for (const snapshotDictionary of [true, false, undefined])
    assert.throws(() => normalizeQuery({ ...q, mode, snapshotDictionary }), error => error.code === 'invalid-argument');
  for (const snapshotDictionary of [undefined, null, 1, 'true', {}, []])
    assert.throws(() => normalizeQuery({ ...q, mode: 'detail', snapshotDictionary }), error => error.code === 'invalid-argument');
});

function expandSnapshotDictionary(response) {
  const { historicalQuestionSnapshots, ...inline } = response;
  return { ...inline, rawRows: inline.rawRows.map(row => {
    if (!Object.hasOwn(row.raw, 'questionSnapshotRefs')) return row;
    const { questionSnapshotRefs, ...raw } = row.raw;
    return { ...row, raw: { ...raw, questionSnapshots: questionSnapshotRefs.map(key => {
      assert.ok(Object.hasOwn(historicalQuestionSnapshots, key));
      return historicalQuestionSnapshots[key];
    }) } };
  }) };
}

test('detail dictionary preserves rich historical originals, repeated ordering and inline compatibility', async () => {
  const initial = fixture();
  const first = { id: 1, question: '당시 발문', answer: '당시 정답', explanation: '당시 해설', image: 'data:image/svg+xml,old',
    options: ['가', '나'], passageSegments: [{ type: 'text', text: '원문' }], empty: '', optional: null, sourceRevision: '1' };
  const changed = { ...first, question: '다른 원문', answer: '다른 정답' };
  Object.assign(initial['semester_assessment_results/r1'], { answers: { 1: '학생의 당시 답' }, sourceHash: 'a'.repeat(64),
    questionSnapshots: [first, changed, first], questionSnapshotOmittedIds: ['99'] });
  Object.assign(initial['semester_assessment_results/r2'], { sourceHash: 'a'.repeat(64), questionSnapshots: [changed] });
  initial['semester_assessment_submissions/r2'] = { studentUid: 'a', semesterId: SCOPE, attemptId: 'r2', answers: { 1: '복구된 당시 답' } };
  const f = memory(initial), service = createQuizClassAnalysisService({ db: f.db, now: () => 1800000000000 });
  const plain = await service.query(normalizeQuery({ ...q, mode: 'detail' }));
  assert.deepEqual(await service.query(normalizeQuery({ ...q, mode: 'detail', snapshotDictionary: false })), plain);
  assert.equal(Object.hasOwn(plain, 'historicalQuestionSnapshots'), false);
  const packed = await service.query(normalizeQuery({ ...q, mode: 'detail', snapshotDictionary: true }));
  assert.equal(Object.keys(packed.historicalQuestionSnapshots).length, 2);
  assert.deepEqual(expandSnapshotDictionary(packed), plain);
  assert.equal(packed.questions[0].question, '사림에 대한 설명은?');
  assert.deepEqual(packed.rawRows.find(row => row.id === 'r2').raw.answers, { 1: '복구된 당시 답' });
  assert.ok(f.writes.every(path => path.startsWith('quiz_class_analysis_cache/')), 'only existing derived catalog caches may be written');
});

test('whole-grade scope is explicit and cannot combine client classes or comparison grades', () => {
  for (const mode of ['summary', 'detail', 'achievement']) {
    const request = { ...q, mode, grade: '3', classIds: [], category: 'exam_prep', unitId: 'exam_prep', examRound: 'round_1' };
    assert.equal(normalizeQuery(request).grade, '3');
    assert.deepEqual(normalizeQuery(request).classIds, []);
    for (const patch of [{ grade: 3 }, { grade: '' }, { grade: '03' }, { grade: '3학년' }, { grade: '0' },
      { classIds: ['class_a'] }, { comparisonGrade: '3' }])
      assert.throws(() => normalizeQuery({ ...request, ...patch }), error => error.code === 'invalid-argument');
  }
  assert.throws(() => normalizeQuery({ semesterId: SCOPE, mode: 'catalog', grade: '3' }), error => error.code === 'invalid-argument');
});

const gradeFixture = () => {
  const initial = fixture();
  initial['semester_classes/class_empty'] = { semesterId: SCOPE, status: 'ACTIVE', grade: '3', classNumber: '3' };
  initial['semester_classes/class_other'] = { semesterId: SCOPE, status: 'ACTIVE', grade: '2', classNumber: '1' };
  initial['semester_classes/class_inactive'] = { semesterId: SCOPE, status: 'INACTIVE', grade: '3', classNumber: '4' };
  for (const [uid, classId] of [['c', 'class_a'], ['foreign', 'class_other'], ['inactive', 'class_inactive'], ['old', 'old_class']]) {
    const semesterId = uid === 'old' ? '2026-1' : SCOPE;
    initial[`semester_enrollments/en_${uid}`] = { semesterId, studentUid: uid, classId, enrollmentStatus: 'ACTIVE', studentNumber: '3' };
    initial[`semester_enrollment_slots/${buildEnrollmentSlotId(semesterId, uid)}`] = { semesterId, studentUid: uid, activeEnrollmentId: `en_${uid}`, status: 'ACTIVE' };
    initial[`semester_assessment_results/result_${uid}`] = { ...initial['semester_assessment_results/r2'], semesterId, studentUid: uid,
      classId, attemptId: `result_${uid}`, percent: 0 };
  }
  return initial;
};
const gradeQuery = overrides => normalizeQuery({ ...q, classIds: [], grade: '3', ...overrides });

test('whole-grade summary resolves active semester classes and weights students rather than class averages', async () => {
  const f = memory(gradeFixture()), service = createQuizClassAnalysisService({ db: f.db });
  const result = await service.query(gradeQuery());
  assert.equal(result.grade, '3');
  assert.deepEqual(result.classes.map(row => row.classId), ['class_a', 'class_b', 'class_empty']);
  assert.equal(result.gradeComparison.rosterCount, 3);
  assert.equal(result.gradeComparison.averageScore, 40, '(100 + 0 + 20) / 3, not (50 + 20) / 2');
  assert.equal(result.gradeComparison.classCount, 3);
  assert.equal(result.classes[2].averageScore, null);
  assert.equal(result.classes[2].rosterCount, 0);
  assert.equal(JSON.stringify(result).includes('학생 A'), false);
  const rosterClasses = f.queries.filter(query => query.path === 'semester_enrollments').map(query => query.filters[0][2]);
  assert.deepEqual(rosterClasses.sort(), ['class_a', 'class_b', 'class_empty'].sort());
  const resultReads = () => f.queries.filter(query => query.path.endsWith('results')).length;
  const readCount = resultReads();
  await service.query(gradeQuery());
  assert.equal(resultReads(), readCount, 'unchanged whole-grade rosters reuse result caches');
  await assert.rejects(service.query(gradeQuery({ grade: '1' })), error => error.code === 'invalid-argument');
});

test('whole-grade roster fingerprint avoids transfer and membership races before invalidation triggers run', async () => {
  const f = memory(), service = createQuizClassAnalysisService({ db: f.db });
  await service.query(q); // The previous implementation reused this pre-transfer class cache.
  const original = await service.query(gradeQuery());
  assert.equal(original.gradeComparison.rosterCount, 2);
  const resultReads = () => f.queries.filter(query => query.path.endsWith('results')).length;
  const warmReads = resultReads();
  await service.query(gradeQuery());
  assert.equal(resultReads(), warmReads, 'unchanged memberships keep the warm result-cache benefit');
  f.data.set('semester_enrollments/en_a', { ...f.data.get('semester_enrollments/en_a'), classId: 'class_b' });
  const moved = await service.query(gradeQuery());
  assert.deepEqual(moved.classes.map(row => row.rosterCount), [0, 2]);
  assert.equal(moved.gradeComparison.rosterCount, 2, 'a pupil is not counted in both old and current classes');
  assert.equal(moved.gradeComparison.averageScore, 60);
  f.data.set('semester_enrollments/en_new', { semesterId: SCOPE, studentUid: 'new-pupil', classId: 'class_a', enrollmentStatus: 'ACTIVE' });
  f.data.set(`semester_enrollment_slots/${buildEnrollmentSlotId(SCOPE, 'new-pupil')}`, { semesterId: SCOPE, studentUid: 'new-pupil', activeEnrollmentId: 'en_new', status: 'ACTIVE' });
  const added = await service.query(gradeQuery());
  assert.deepEqual(added.classes.map(row => row.rosterCount), [1, 2]);
  assert.equal(added.gradeComparison.rosterCount, 3);
  assert.equal(added.gradeComparison.scoredCount, 2, 'a new nonparticipant never receives a fabricated zero');
  f.data.set('semester_enrollments/en_new', { ...f.data.get('semester_enrollments/en_new'), rosterExclusionStatus: 'excluded' });
  const removed = await service.query(gradeQuery());
  assert.deepEqual(removed.classes.map(row => row.rosterCount), [0, 2]);
  assert.equal(removed.gradeComparison.rosterCount, 2);
  assert.equal(f.data.has(`quiz_class_analysis_state/${SCOPE}`), false, 'all transitions were checked before roster triggers');
});

test('whole-grade roster fingerprint includes legacy result email matching without exposing identities', async () => {
  const f = memory(), service = createQuizClassAnalysisService({ db: f.db });
  f.data.set('users/legacy-pupil', { role: 'student', grade: '3', class: '1', number: '9', email: 'old@example.invalid' });
  f.data.set(`${ROOT}/quiz_results/email-only`, { email: 'new@example.invalid', unitId: 'unit-a', category: 'formative',
    score: 40, timestamp: '2026-10-25T01:00:00Z', details: [{ id: 1, correct: false, sourceRevision: '2' }] });
  assert.equal((await service.query(gradeQuery())).gradeComparison.scoredCount, 2);
  f.data.set('users/legacy-pupil', { ...f.data.get('users/legacy-pupil'), email: 'new@example.invalid' });
  const changed = await service.query(gradeQuery());
  assert.equal(changed.gradeComparison.scoredCount, 3);
  assert.equal(changed.gradeComparison.averageScore, 160 / 3);
  assert.equal(JSON.stringify(changed).includes('example.invalid'), false);
  assert.equal(JSON.stringify(changed).includes('legacy-pupil'), false);
});

test('whole-grade detail retains actual classes, merges each pupil once and excludes other scopes', async () => {
  const f = memory(gradeFixture()), service = createQuizClassAnalysisService({ db: f.db });
  const result = await service.query(gradeQuery({ mode: 'detail' }));
  assert.equal(result.grade, '3');
  assert.equal(result.complete, true);
  assert.deepEqual(result.students.map(row => [row.uid, row.classId]), [['a', 'class_a'], ['c', 'class_a'], ['b', 'class_b']]);
  assert.deepEqual(result.configuredClasses.map(row => row.id), ['class_a', 'class_b', 'class_empty']);
  assert.ok(result.rawRows.every(row => ['a', 'b', 'c'].includes(row.raw.studentUid || row.raw.uid)));
  assert.equal(new Set(result.rawRows.map(row => `${row.source}:${row.id}`)).size, result.rawRows.length);
});

const gradeExamFixture = () => {
  const initial = gradeFixture();
  initial[`${ROOT}/quiz_questions/91`] = { id: 91, unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
    question: '합성 모의 문항', contentRevision: 1, curriculumVersion: '2018-162', achievementStandardCodes: ['9역07-01'] };
  for (const uid of ['a', 'b', 'foreign', 'inactive']) initial[`semester_assessment_results/exam_${uid}`] = {
    assessmentKind: 'QUIZ', semesterId: SCOPE, studentUid: uid, sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
    attemptId: `exam_${uid}`, startedAtIso: '2026-11-01T01:00:00.000Z', submittedAtIso: '2026-11-01T02:00:00.000Z',
    answerChecks: [{ id: 91, correct: true }], percent: 100, answers: { 91: '합성 답안' },
  };
  initial['semester_achievement_profiles/wrong_class'] = { semesterId: SCOPE, classId: 'class_b', studentUid: 'a', unitId: 'exam_prep', examRound: 'round_1' };
  initial['semester_achievement_profiles/right_class'] = { semesterId: SCOPE, classId: 'class_b', studentUid: 'b', unitId: 'exam_prep', examRound: 'round_1', level: null };
  return initial;
};
const gradeExamQuery = () => gradeQuery({ mode: 'achievement', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1' });

function decodeAchievementResponse(envelope) {
  assert.deepEqual(Object.keys(envelope).sort(), ['encoding', 'payload', 'uncompressedBytes']);
  assert.equal(envelope.encoding, 'gzip-base64');
  assert.ok(Buffer.byteLength(JSON.stringify(envelope)) <= 8 * 1024 * 1024);
  const bytes = gunzipSync(Buffer.from(envelope.payload, 'base64'), { maxOutputLength: 32 * 1024 * 1024 });
  assert.equal(bytes.length, envelope.uncompressedBytes, 'byte count describes UTF-8, not UTF-16 character length');
  return JSON.parse(bytes.toString('utf8'));
}

test('achievement gzip keeps the exact inline data and identical read-only query cost', async () => {
  const initial = gradeExamFixture();
  initial['semester_assessment_results/exam_a'].percent = 0;
  initial['semester_assessment_results/exam_a'].questionSnapshots = [{ id: 91, question: '당시 문항 🏫', answer: '가', type: 'choice' }];
  const plain = memory(initial), compressed = memory(initial), now = () => Date.UTC(2026, 10, 10);
  const query = { ...gradeExamQuery(), live: true };
  const expected = await createQuizClassAnalysisService({ db: plain.db, now }).query(query);
  const envelope = await createQuizClassAnalysisService({ db: compressed.db, now }).query({ ...query, responseEncoding: 'gzip-base64' });
  assert.deepEqual(decodeAchievementResponse(envelope), expected);
  assert.deepEqual(compressed.reads, plain.reads, 'encoding adds no document reads');
  assert.deepEqual(compressed.queries, plain.queries, 'encoding adds no queries or changes projections');
  assert.deepEqual(compressed.bodyReads, plain.bodyReads);
  assert.deepEqual(compressed.writes, []);
  assert.deepEqual(plain.writes, []);
});

test('whole-grade achievement transports all 300 pupils above 8 MiB without truncating evidence', async context => {
  const initial = gradeExamFixture();
  for (const path of Object.keys(initial)) if (path.startsWith('semester_assessment_results/')) delete initial[path];
  const metadata = Array.from({ length: 30 }, (_, index) => ({
    id: String(index + 91), sourceRevision: '1', unitId: 'exam_prep', points: 3,
    curriculumVersion: '2018-162', achievementStandardCodes: ['9역07-01'], achievementMappingSource: 'manual',
    targetAchievementLevel: 'C', intendedDifficulty: 'medium',
    concepts: Array.from({ length: 5 }, (_, concept) => `${concept} 역사적 맥락과 원인 결과를 비교합니다. 역사 자료의 근거를 살펴봅니다.`),
    misconceptionTags: Object.fromEntries(Array.from({ length: 4 }, (_, choice) => [String(choice),
      '제도와 사건의 관련성을 자료 근거로 구분합니다. 시대적 배경과 사건의 전개 과정을 함께 살펴봅니다.'])),
  }));
  assert.ok(metadata.every(item => Buffer.byteLength(JSON.stringify(item)) < 2048), 'fixture respects each saved metadata row bound');
  const questionSnapshots = metadata.map(item => ({ id: item.id, question: `응시 당시 ${item.id}번 문항`,
    type: 'choice', answer: '가', options: ['가', '나'], points: 3 }));
  for (let index = 0; index < 300; index++) {
    const uid = `grade-pupil-${String(index).padStart(3, '0')}`, classId = `grade-class-${Math.floor(index / 30)}`;
    initial[`semester_classes/${classId}`] = { semesterId: SCOPE, status: 'ACTIVE', grade: '3', classNumber: String(4 + Math.floor(index / 30)) };
    initial[`semester_enrollments/en_${uid}`] = { semesterId: SCOPE, studentUid: uid, classId,
      enrollmentStatus: 'ACTIVE', studentNumber: String(index % 30 + 1), snapshot: { displayName: `합성 학생 ${index}` } };
    initial[`semester_enrollment_slots/${buildEnrollmentSlotId(SCOPE, uid)}`] = { semesterId: SCOPE, studentUid: uid, activeEnrollmentId: `en_${uid}`, status: 'ACTIVE' };
    initial[`semester_assessment_results/grade_${index}`] = { assessmentKind: 'QUIZ', semesterId: SCOPE, studentUid: uid,
      sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', attemptId: `grade_${index}`,
      total: 30, percent: index % 101, maxPoints: 90, earnedPoints: index % 91,
      submittedAtIso: new Date(Date.UTC(2026, 10, 10, 0, index)).toISOString(), sourceHash: 'a'.repeat(64),
      learningSnapshot: metadata, questionSnapshots, questionSnapshotOmittedIds: [],
      answers: Object.fromEntries(metadata.map(item => [item.id, index % 2 ? '가' : ''])),
      answerChecks: metadata.map(item => ({ id: item.id, correct: index % 2 === 1 })),
    };
  }
  const f = memory(initial), service = createQuizClassAnalysisService({ db: f.db });
  await assert.rejects(service.query(gradeExamQuery()), error => error.details?.reason === 'QUIZ_ACHIEVEMENT_RESPONSE_LIMIT');
  f.reads.length = 0; f.queries.length = 0; f.bodyReads.length = 0;
  const envelope = await service.query({ ...gradeExamQuery(), responseEncoding: 'gzip-base64' });
  assert.ok(envelope.uncompressedBytes > 8 * 1024 * 1024);
  const result = decodeAchievementResponse(envelope), restored = expandSnapshotDictionary(result);
  assert.equal(result.complete, true);
  assert.equal(result.rawRows.length, 300);
  assert.equal(result.mockExamScoreRows.length, 300);
  assert.equal(new Set(result.rawRows.map(row => row.raw.studentUid)).size, 300);
  for (const row of restored.rawRows) {
    const original = initial[`semester_assessment_results/${row.id}`];
    assert.deepEqual(row.raw.learningSnapshot, original.learningSnapshot);
    assert.deepEqual(row.raw.questionSnapshots, original.questionSnapshots);
    assert.deepEqual(row.raw.answers, original.answers);
    assert.equal(row.raw.percent, original.percent);
  }
  const resultBodyReads = f.bodyReads.filter(read => read.path.startsWith('semester_assessment_results/'));
  assert.equal(resultBodyReads.length, 300, 'every selected result body is read exactly once');
  assert.equal(new Set(resultBodyReads.map(read => read.path)).size, 300);
  assert.deepEqual(f.writes, []);
  context.diagnostic(`Whole-grade response: ${envelope.uncompressedBytes} UTF-8 bytes -> ${Buffer.byteLength(JSON.stringify(envelope))} wire bytes; 300 result bodies, 0 writes.`);
});

test('achievement gzip preserves decoded and wire response bounds without returning partial data', async () => {
  for (const [label, value] of [
    ['expanded', '가'.repeat(Math.ceil(32 * 1024 * 1024 / 3))],
    ['wire', randomBytes(7 * 1024 * 1024).toString('base64')],
  ]) {
    const f = memory(gradeExamFixture());
    // One injected reference value isolates transport bounds from source read budgets.
    f.data.set(`${ROOT}/curriculum/tree`, { tree: [{ id: 'size-fixture', title: value }] });
    await assert.rejects(createQuizClassAnalysisService({ db: f.db }).query({ ...gradeExamQuery(), responseEncoding: 'gzip-base64' }),
      error => error.code === 'resource-exhausted', `${label} overflow cannot be presented as a complete result`);
    assert.deepEqual(f.writes, []);
  }
});

test('whole-grade achievement shares reference reads, preserves pupil class and remains read-only', async () => {
  const f = memory(gradeExamFixture()), service = createQuizClassAnalysisService({ db: f.db });
  const result = await service.query(gradeExamQuery());
  assert.equal(result.grade, '3');
  assert.deepEqual(result.students.map(row => row.uid), ['a', 'c', 'b']);
  assert.deepEqual(result.configuredClasses.map(row => row.id), ['class_a', 'class_b', 'class_empty']);
  assert.deepEqual(result.rawRows.map(row => row.raw.studentUid).sort(), ['a', 'b']);
  assert.equal(Object.hasOwn(result, 'profiles'), false);
  assert.deepEqual(result.mockExamScoreRows.map(row => row.raw.studentUid).sort(), ['a', 'b']);
  assert.equal(f.queries.some(query => query.path === 'semester_achievement_profiles'), false);
  assert.equal(f.queries.filter(query => query.path === `${ROOT}/quiz_questions`).length, 1);
  assert.equal(f.queries.some(query => /\/(lessons|lesson_progress)(\/|$)/.test(query.path)), false);
  assert.equal(f.reads.filter(path => path === `${ROOT}/curriculum/tree`).length, 1);
  assert.equal(f.queries.some(query => /lesson_progress\/(foreign|inactive)\//.test(query.path)), false);
  assert.deepEqual(f.writes, []);
  for (const path of [...f.data.keys()]) if (path.startsWith('semester_assessment_results/') || path.includes('/quiz_results/')) f.data.delete(path);
  const empty = await service.query(gradeExamQuery());
  assert.equal(empty.students.length, 3);
  assert.deepEqual(empty.rawRows, []);
  assert.equal(empty.complete, true);
});

test('old compact flag cannot reactivate retired diagnostic/formative evidence queries', async () => {
  const f = memory(gradeExamFixture());
  const handler = createQuizClassAnalysisHandler({ db: f.db, assertSession: async () => ({ uid: 'teacher', email: 't@school.test' }) });
  await assert.rejects(handler({ auth: { uid: 'teacher' }, data: { ...gradeExamQuery(), compactEvidence: true } }),
    error => error.code === 'failed-precondition' && error.details.reason === 'QUIZ_ACHIEVEMENT_CLIENT_RETIRED');
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.queries, []);
  assert.deepEqual(f.writes, []);
  const service = createQuizClassAnalysisService({ db: f.db, now: () => Date.UTC(2026, 10, 7) });
  const plain = await service.query(gradeExamQuery());
  assert.deepEqual(await service.query({ ...gradeExamQuery(), compactEvidence: false }), plain);
  assert.equal(Object.hasOwn(plain, 'achievementEvidence'), false);
  assert.equal(f.queries.some(query => query.filters.some(([, , values]) =>
    Array.isArray(values) && values.includes('diagnostic'))), false);
  assert.deepEqual(f.writes, []);
});

test('whole-grade reads fail instead of returning a partial class or a changing scope', async () => {
  for (const mode of ['summary', 'detail', 'achievement']) {
    const f = memory(gradeExamFixture()), originalCollection = f.db.collection;
    f.db.collection = path => {
      const source = originalCollection(path), get = source.get, where = source.where;
      let classId;
      source.where = (field, operator, value) => {
        if (field === 'classId') classId = value;
        return where(field, operator, value);
      };
      source.get = async () => {
        const value = await get();
        if (path === 'semester_enrollments' && classId === 'class_b')
          throw new Error('Synthetic class read failure');
        return value;
      };
      return source;
    };
    const service = createQuizClassAnalysisService({ db: f.db });
    await assert.rejects(service.query(mode === 'achievement' ? gradeExamQuery() : gradeQuery({ mode })), /Synthetic class read failure/);
  }
  for (const mode of ['detail', 'achievement']) {
    for (const changed of ['class', 'catalog']) {
      const f = memory(gradeExamFixture()), originalCollection = f.db.collection;
      let changedOnce = false;
      f.db.collection = path => {
        const source = originalCollection(path), get = source.get;
        source.get = async () => {
          const value = await get();
          if (!changedOnce && path === 'semester_assessment_results') {
            changedOnce = true;
            f.data.set(changed === 'class' ? `quiz_class_analysis_state/${SCOPE}/classes/${hash('class_b')}` : `quiz_class_analysis_state/${SCOPE}`,
              changed === 'class' ? { generation: 'changed' } : { catalogGeneration: 'changed' });
          }
          return value;
        };
        return source;
      };
      await assert.rejects(createQuizClassAnalysisService({ db: f.db }).query(mode === 'achievement' ? gradeExamQuery() : gradeQuery({ mode })),
        error => error.code === 'aborted');
    }
  }
});

test('whole-grade scope rejects excessive or duplicate classes and retains role authorization', async () => {
  for (const mode of ['summary', 'detail', 'achievement']) {
    const f = memory(gradeExamFixture());
    for (let n = 4; n <= 31; n++) f.data.set(`semester_classes/extra_${n}`, { semesterId: SCOPE, status: 'ACTIVE', grade: '3', classNumber: String(n) });
    await assert.rejects(createQuizClassAnalysisService({ db: f.db }).query(mode === 'achievement' ? gradeExamQuery() : gradeQuery({ mode })),
      error => error.code === 'invalid-argument');
    const duplicate = memory(gradeExamFixture());
    duplicate.data.set('semester_classes/duplicate', { semesterId: SCOPE, status: 'ACTIVE', grade: '3', classNumber: '1' });
    await assert.rejects(createQuizClassAnalysisService({ db: duplicate.db }).query(mode === 'achievement' ? gradeExamQuery() : gradeQuery({ mode })),
      error => error.code === 'aborted');
    const authority = memory(gradeExamFixture());
    const handler = createQuizClassAnalysisHandler({ db: authority.db, assertSession: async () => ({ uid: 'a' }) });
    await assert.rejects(handler({ auth: { uid: 'a', token: {} }, data: mode === 'achievement' ? gradeExamQuery() : gradeQuery({ mode }) }),
      error => error.code === 'permission-denied');
    assert.equal(authority.queries.length, 0);
  }
});

test('achievement route reads only selected pupils and never reads retired evidence or writes scores', async () => {
  const f = memory();
  const metadata = { curriculumVersion: '2018-162', achievementStandardCodes: ['9역07-01'],
    achievementMappingSource: 'manual', targetAchievementLevel: 'C', intendedDifficulty: 'medium' };
  f.data.set(`${ROOT}/quiz_questions/91`, { id: 91, unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
    question: '합성 모의 문항', contentRevision: 1, ...metadata });
  f.data.set('semester_assessment_results/exam', { assessmentKind: 'QUIZ', semesterId: SCOPE, studentUid: 'a',
    sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', attemptId: 'exam',
    definitionId: 'quiz:2026-2:exam_prep:exam_prep:round_1', submittedAtIso: '2026-11-01T02:00:00.000Z',
    answerChecks: [{ id: 91, correct: true }], percent: 100 });
  f.data.set('semester_assessment_attempts/exam', { ...f.data.get('semester_assessment_results/exam'),
    startedAtIso: '2026-11-01T01:00:00.000Z', resultRef: 'semester_assessment_results/exam' });
  f.data.set(`${ROOT}/lessons/lesson`, { unitId: 'unit-a', contentRevision: 2, contentHtml: '[정답]' });
  f.data.set(`${ROOT}/lesson_progress/a/units/unit-a`, { studentUid: 'a', semesterId: SCOPE, contentRevision: 2,
    updatedAt: '2026-10-26T01:00:00.000Z', answers: { 0: { value: 'PRIVATE_WORKSHEET_ANSWER', status: 'wrong' } } });
  f.data.set(`${ROOT}/lesson_progress/b/units/unit-a`, { answers: { 0: { value: 'FOREIGN_STUDENT_ANSWER' } } });
  const query = { ...q, mode: 'achievement', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1' };
  const handler = createQuizClassAnalysisHandler({ db: f.db, assertSession: async () => ({ uid: 'teacher', email: 't@school.test' }) });
  const result = await handler({ auth: { uid: 'teacher' }, data: query });
  assert.equal(Object.hasOwn(result, 'canReview'), false); assert.equal(result.students.length, 1);
  assert.equal(result.rawRows.length, 1); assert.equal(result.mockExamScoreRows.length, 1);
  assert.equal(f.reads.includes('semester_assessment_attempts/exam'), false);
  assert.equal(Object.hasOwn(result, 'achievementEvidence'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_WORKSHEET_ANSWER'), false);
  assert.equal(JSON.stringify(result).includes('FOREIGN_STUDENT_ANSWER'), false);
  assert.equal(f.queries.some(query => /\/(lessons|lesson_progress)(\/|$)/.test(query.path)), false);
  assert.deepEqual(f.writes, []);
  f.data.set('users/teacher', { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['quiz_read'] });
  assert.equal((await handler({ auth: { uid: 'teacher' }, data: query })).mockExamScoreRows.length, 1);
});

test('achievement queries mock exams only and never reads diagnostic/formative evidence or later exam bodies', async context => {
  const initial = gradeExamFixture();
  const priorDefinition = `quiz:${SCOPE}:unit-a:diagnostic`;
  initial[`semester_assessment_definitions/${priorDefinition}`] = { semesterId: SCOPE, assessmentKind: 'QUIZ', category: 'diagnostic' };
  initial['semester_assessment_results/old_prior'] = { ...initial['semester_assessment_results/r1'],
    category: '', sourceId: '', definitionId: priorDefinition, attemptId: 'old_prior' };
  initial[`${ROOT}/quiz_results/old_prior_email`] = { email: 'a@school.test', unitId: 'unit-a', category: 'diagnostic',
    timestamp: '2026-10-24T01:00:00Z', details: [{ id: 1, correct: true, sourceRevision: '2' }],
    learningSnapshot: [{ id: 1, unitId: 'unit-a', sourceRevision: '2' }] };
  initial[`${ROOT}/quiz_results/legacy_exam_first`] = { uid: 'a', email: 'a@school.test', unitId: 'exam_prep', category: 'exam_prep',
    score: 80, details: [{ id: 91, correct: true }], timestamp: '2026-10-30T01:00:00Z' };
  initial['semester_assessment_results/old_exam_first'] = { ...initial['semester_assessment_results/exam_a'],
    sourceId: '', category: '', examRound: '', definitionId: `quiz:${SCOPE}:exam_prep:exam_prep`, attemptId: 'old_exam_first' };
  for (let round = 2; round <= 6; round++) {
    initial[`semester_assessment_results/other_round_${round}`] = { ...initial['semester_assessment_results/exam_a'],
      examRound: `round_${round}`, definitionId: `quiz:${SCOPE}:exam_prep:exam_prep:round_${round}`, answers: { 91: 'UNSELECTED_BODY' } };
    initial[`${ROOT}/quiz_results/other_round_${round}`] = { uid: 'a', unitId: 'exam_prep', category: 'exam_prep',
      examRound: `round_${round}`, details: [{ id: 91, answer: 'UNSELECTED_BODY' }] };
  }
  initial['semester_assessment_results/wrong_semester'] = { ...initial['semester_assessment_results/r1'], semesterId: '2026-1' };
  initial['semester_assessment_results/wrong_kind'] = { ...initial['semester_assessment_results/r1'], assessmentKind: 'HISTORY_CLASSROOM' };
  initial[`${ROOT}/quiz_results/wrong_owner_email`] = { ...initial[`${ROOT}/quiz_results/old_prior_email`], uid: 'foreign' };
  initial[`${ROOT}/lessons/private`] = { contentHtml: '[PRIVATE_LESSON]' };
  initial[`${ROOT}/lesson_progress/a/units/private`] = { answers: { 0: { value: 'PRIVATE_WORKSHEET' } } };
  const f = memory(initial), service = createQuizClassAnalysisService({ db: f.db });
  const result = await service.query(gradeExamQuery());
  const bodyQueries = f.queries.filter(query => query.path.endsWith('results') && query.projection.includes('answerChecks'));
  assert.equal(bodyQueries.length, 0);
  assert.equal(f.reads.some(path => /old_prior|\/r1$|\/r2$|\/rb$/.test(path)), false);
  const canonicalQueries = f.queries.filter(query => query.path === 'semester_assessment_results');
  assert.ok(canonicalQueries.every(query => query.filters.some(([field, , value]) => field === 'semesterId' && value === SCOPE)
    && query.filters.some(([field, , value]) => field === 'assessmentKind' && value === 'QUIZ')));
  assert.ok(f.queries.filter(query => query.path.endsWith('results')).every(query =>
    query.filters[0][1] === 'in' && query.filters[0][2].every(value => ['a', 'b', 'c', 'a@school.test', 'b@school.test'].includes(value))));
  const resultBodyPaths = [...bodyQueries.flatMap(query => query.returnedPaths),
    ...f.bodyReads.filter(read => read.path.includes('results/')).map(read => read.path)];
  assert.equal(resultBodyPaths.some(path => /other_round|wrong_semester|wrong_kind|foreign|inactive|wrong_owner/.test(path)), false);
  assert.equal(f.bodyReads.filter(read => read.path === `${ROOT}/quiz_results/legacy_exam_first`).length, 1,
    'matching UID and email queries fetch a selected legacy body once');
  assert.ok(result.rawRows.some(row => row.id === 'old_exam_first'));
  assert.ok(result.rawRows.some(row => row.id === 'legacy_exam_first'));
  assert.ok(result.mockExamScoreRows.every(row => row.raw.category === 'exam_prep' && row.raw.examRound === 'round_1'));
  assert.equal(Object.hasOwn(result, 'achievementEvidence'), false);
  assert.equal(f.queries.some(query => /\/(lessons|lesson_progress)(\/|$)/.test(query.path)), false);
  assert.equal(JSON.stringify(result).includes('UNSELECTED_BODY'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_WORKSHEET'), false);
  assert.deepEqual(f.writes, []);
  context.diagnostic(`Read shape: ${bodyQueries.length} prior answer queries; ${resultBodyPaths.length} selected result-body reads; 0 unselected round bodies; 0 lesson/progress queries.`);
});

test('third-round analysis reads cumulative frozen score metadata without previous answers or future papers', async () => {
  const f = memory(gradeExamFixture());
  const metadata = [{ id: '91', targetAchievementLevel: 'A', intendedDifficulty: 'hard' },
    { id: '92', targetAchievementLevel: 'D', intendedDifficulty: 'easy' }];
  for (const round of [1, 2, 3, 4]) {
    const id = `cumulative_${round}`, definitionId = `quiz:${SCOPE}:exam_prep:exam_prep:round_${round}`;
    const raw = { assessmentKind: 'QUIZ', semesterId: SCOPE, studentUid: 'a', sourceId: 'exam_prep',
      category: 'exam_prep', examRound: `round_${round}`, definitionId, attemptId: id,
      total: 2, percent: round * 20, maxPoints: 10, earnedPoints: round * 2,
      submittedAtIso: `2026-11-0${round}T02:00:00.000Z`, learningSnapshot: metadata,
      answers: { 91: 'PRIVATE_PREVIOUS_ANSWER' }, analytics: { private: true },
      questionSnapshots: metadata.map(item => ({ ...item, points: item.id === '91' ? 3 : 7,
        question: 'PRIVATE_PREVIOUS_QUESTION', image: 'PRIVATE_PREVIOUS_IMAGE' })),
    };
    f.data.set(`semester_assessment_results/${id}`, raw);
    f.data.set(`semester_assessment_attempts/${id}`, { ...raw, resultRef: `semester_assessment_results/${id}`,
      gradingSnapshot: [{ id: '91', points: 3, answer: 'PRIVATE_KEY' }, { id: '92', points: 7, answer: 'PRIVATE_KEY' }] });
  }
  f.data.set(`${ROOT}/quiz_questions/93`, { id: '93', unitId: 'exam_prep', category: 'exam_prep',
    examRound: 'round_3', question: '선택 회차', points: 100, targetAchievementLevel: 'E' });
  f.data.set(`${ROOT}/quiz_results/legacy_second`, { uid: 'a', unitId: 'exam_prep', category: 'exam_prep__round_2',
    timestamp: '2026-11-02T01:00:00.000Z', score: 60, total: 2, learningSnapshot: metadata,
    details: [{ id: '91', u: 'PRIVATE_LEGACY_ANSWER' }] });
  const result = await createQuizClassAnalysisService({ db: f.db }).query({ ...gradeExamQuery(), examRound: 'round_3' });
  assert.deepEqual(result.rawRows.map(row => row.id), ['cumulative_3']);
  const selected = result.mockExamScoreRows.filter(row => row.id.startsWith('cumulative_'));
  assert.deepEqual(selected.map(row => row.raw.examRound).sort(), ['round_1', 'round_2', 'round_3']);
  for (const row of selected) assert.deepEqual(row.raw.cutScoreQuestions, metadata.map(item => ({ ...item, points: item.id === '91' ? 3 : 7 })));
  const legacy = result.mockExamScoreRows.find(row => row.id === 'legacy_second');
  assert.equal(legacy.raw.semesterId, SCOPE); assert.equal(legacy.raw.examRound, 'round_2');
  assert.equal(JSON.stringify(result.mockExamScoreRows).includes('PRIVATE_'), false);
  const previousReads = f.bodyReads.filter(read => /results\/cumulative_[12]$/.test(read.path));
  assert.equal(previousReads.length, 2);
  assert.ok(previousReads.every(read => read.projection.includes('learningSnapshot')
    && !['answers', 'answerChecks', 'questionSnapshots', 'analytics'].some(field => read.projection.includes(field))));
  assert.equal(f.reads.some(path => /cumulative_4$/.test(path)), false);
  assert.equal(f.reads.includes('semester_assessment_attempts/cumulative_3'), false, 'selected frozen paper already supplies points');
  assert.deepEqual(f.writes, []);
});

test('cumulative point recovery refuses a foreign or mismatched attempt and never uses current bank points', async () => {
  for (const mismatch of ['studentUid', 'semesterId', 'definitionId', 'resultRef', 'submittedAtIso', 'sourceHash']) {
    const f = memory(gradeExamFixture()), raw = f.data.get('semester_assessment_results/exam_a');
    Object.assign(raw, { definitionId: `quiz:${SCOPE}:exam_prep:exam_prep:round_1`, total: 1, maxPoints: 100,
      sourceHash: 'frozen', learningSnapshot: [{ id: '91', targetAchievementLevel: 'C' }] });
    f.data.set('semester_assessment_attempts/exam_a', { ...raw, resultRef: 'semester_assessment_results/exam_a',
      gradingSnapshot: [{ id: '91', points: 100 }], [mismatch]: 'mismatched' });
    f.data.set(`${ROOT}/quiz_questions/91`, { ...f.data.get(`${ROOT}/quiz_questions/91`), points: 999 });
    const result = await createQuizClassAnalysisService({ db: f.db }).query(gradeExamQuery());
    const questions = result.mockExamScoreRows.find(row => row.id === 'exam_a').raw.cutScoreQuestions;
    assert.deepEqual(questions, [{ id: '91', targetAchievementLevel: 'C' }]);
    assert.deepEqual(f.writes, []);
  }
});

test('achievement interns over 32 MiB of repeated frozen papers in ten-result batches without changing each original', async context => {
  const f = memory(gradeExamFixture()), getAll = f.db.getAll, batches = [], decodeCounts = new Map();
  f.db.getAll = async (...args) => {
    const paperBodies = args.at(-1)?.fieldMask?.includes('questionSnapshots');
    if (paperBodies) batches.push(args.length - 1);
    const docs = await getAll(...args);
    return paperBodies ? docs.map(doc => ({ ...doc, data() {
      decodeCounts.set(doc.id, (decodeCounts.get(doc.id) || 0) + 1);
      return doc.data();
    } })) : docs;
  };
  for (const key of [...f.data.keys()]) if (key.startsWith('semester_assessment_results/exam_')) f.data.delete(key);
  const firstImage = 'a'.repeat(450 * 1024), secondImage = 'b'.repeat(450 * 1024);
  for (let index = 0; index < 80; index++) {
    const changed = index === 1, targetAchievementLevel = changed ? 'E' : 'A';
    f.data.set(`semester_assessment_results/large_${index}`, { assessmentKind: 'QUIZ', semesterId: SCOPE,
      studentUid: 'a', sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', sourceHash: 'a'.repeat(64),
      attemptId: `large_${index}`, total: 1, percent: index ? 100 : 60, maxPoints: 100, earnedPoints: index ? 100 : 60,
      submittedAtIso: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(), answers: { 91: index ? '나' : '가' },
      answerChecks: [{ id: '91', correct: index > 0 }], questionSnapshotOmittedIds: [],
      learningSnapshot: [{ id: '91', sourceRevision: '1', targetAchievementLevel }],
      questionSnapshots: [{ id: '91', type: 'choice', question: changed ? '다른 발문' : '당시 발문', answer: '가',
        options: ['가', '나'], points: 100, targetAchievementLevel, image: changed ? secondImage : firstImage }] });
  }
  const service = createQuizClassAnalysisService({ db: f.db }), budget = { documents: 0, bytes: 0 };
  const rows = await service.loadResults(gradeExamQuery(), [{ uid: 'a' }], true, budget, true);
  assert.equal(rows.length, 80);
  assert.ok(budget.resultReadBytes > 32 * 1024 * 1024);
  assert.ok(budget.bytes < 2 * 1024 * 1024, 'retained unique contents stay within the unchanged limits');
  assert.ok(batches.length === 8 && batches.every(size => size === 10));
  assert.equal(decodeCounts.size, 80);
  assert.ok([...decodeCounts.values()].every(count => count === 1), 'full result bodies decode only once, including scope verification');
  assert.equal(rows.find(row => row.id === 'large_0').raw.questionSnapshots[0], rows.find(row => row.id === 'large_2').raw.questionSnapshots[0]);
  assert.notEqual(rows.find(row => row.id === 'large_0').raw.questionSnapshots[0], rows.find(row => row.id === 'large_1').raw.questionSnapshots[0]);
  const result = await service.query(gradeExamQuery());
  assert.equal(Object.keys(result.historicalQuestionSnapshots).length, 2);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 8 * 1024 * 1024);
  for (const row of result.rawRows) {
    const original = f.data.get(`semester_assessment_results/${row.id}`);
    assert.deepEqual(row.raw.questionSnapshotRefs.map(ref => result.historicalQuestionSnapshots[ref]), original.questionSnapshots);
    assert.deepEqual(row.raw.answers, original.answers);
    const score = result.mockExamScoreRows.find(scoreRow => scoreRow.id === row.id);
    assert.deepEqual(score.raw.cutScoreQuestions, [{ id: '91', points: 100, targetAchievementLevel: original.learningSnapshot[0].targetAchievementLevel }]);
  }
  assert.equal(result.mockExamScoreRows.find(row => row.id === 'large_0').raw.percent, 60);
  assert.deepEqual(f.writes, []);
  context.diagnostic(`Frozen paper reads: ${budget.resultReadBytes} physical bytes, ${budget.bytes} retained bytes; full contents and original scores preserved.`);
});

test('achievement still rejects more than 32 MiB of distinct frozen paper contents', async () => {
  const f = memory(), image = 'x'.repeat(450 * 1024);
  for (let index = 0; index < 80; index++) f.data.set(`semester_assessment_results/unique_${index}`, {
    assessmentKind: 'QUIZ', semesterId: SCOPE, studentUid: 'a', sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
    sourceHash: 'a'.repeat(64), questionSnapshots: [{ id: '91', type: 'choice', question: `원문 ${index}`, answer: '가', image }],
  });
  await assert.rejects(createQuizClassAnalysisService({ db: f.db }).loadResults(gradeExamQuery(), [{ uid: 'a' }], true,
    { documents: 0, bytes: 0 }, true), error => error.details?.reason === 'QUIZ_ANALYSIS_BYTE_LIMIT');
  assert.deepEqual(f.writes, []);
});

test('whole-grade detail dictionary handles repeated papers above 32 MiB in ten-body batches with one decode', async () => {
  const f = memory(gradeExamFixture()), getAll = f.db.getAll, batches = [], decodes = new Map();
  for (const key of [...f.data.keys()]) if (key.startsWith('semester_assessment_results/exam_')) f.data.delete(key);
  const original = { id: '91', question: '당시 발문', answer: '가', image: 'a'.repeat(450 * 1024), options: ['가', '나'] };
  const changed = { ...original, question: '같은 sourceHash의 다른 원문', image: 'b'.repeat(450 * 1024) };
  for (let index = 0; index < 80; index++) f.data.set(`semester_assessment_results/detail_${index}`, {
    assessmentKind: 'QUIZ', semesterId: SCOPE, studentUid: index % 2 ? 'a' : 'b',
    sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', sourceHash: 'a'.repeat(64),
    attemptId: `detail_${index}`, percent: index ? 100 : 60, answers: { 91: `당시 답 ${index}` },
    questionSnapshots: [index === 1 ? changed : original], questionSnapshotOmittedIds: [],
  });
  f.data.set('semester_assessment_results/foreign_detail', { ...f.data.get('semester_assessment_results/detail_0'), studentUid: 'foreign' });
  f.data.set('semester_assessment_results/old_detail', { ...f.data.get('semester_assessment_results/detail_0'), semesterId: '2026-1' });
  f.db.getAll = async (...args) => {
    const bodies = args.at(-1)?.fieldMask?.includes('questionSnapshots');
    if (bodies) batches.push(args.length - 1);
    const docs = await getAll(...args);
    return bodies ? docs.map(doc => ({ ...doc, data() { decodes.set(doc.id, (decodes.get(doc.id) || 0) + 1); return doc.data(); } })) : docs;
  };
  const service = createQuizClassAnalysisService({ db: f.db });
  const input = gradeQuery({ mode: 'detail', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', snapshotDictionary: true });
  const result = await service.query(input);
  assert.equal(result.rawRows.length, 80);
  assert.equal(Object.keys(result.historicalQuestionSnapshots).length, 2);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 8 * 1024 * 1024);
  assert.deepEqual(batches, Array(8).fill(10));
  assert.equal(decodes.size, 80);
  assert.ok([...decodes.values()].every(count => count === 1));
  for (const row of expandSnapshotDictionary(result).rawRows) {
    const expected = f.data.get(`semester_assessment_results/${row.id}`);
    assert.deepEqual(row.raw.questionSnapshots, expected.questionSnapshots);
    assert.deepEqual(row.raw.answers, expected.answers);
    assert.equal(row.raw.percent, expected.percent);
  }
  for (const snapshotDictionary of [undefined, false]) {
    const legacy = { ...input }; delete legacy.snapshotDictionary;
    if (snapshotDictionary === false) legacy.snapshotDictionary = false;
    await assert.rejects(service.query(legacy), error => error.details?.reason === 'QUIZ_ANALYSIS_BYTE_LIMIT');
  }
  assert.ok(f.writes.every(path => path.startsWith('quiz_class_analysis_cache/')), 'only existing derived catalog caches may be written');
});

test('detail dictionary retains unique-body and response byte limits', async () => {
  const input = gradeQuery({ mode: 'detail', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', snapshotDictionary: true });
  for (const [count, reason] of [[80, 'QUIZ_ANALYSIS_BYTE_LIMIT'], [20, 'QUIZ_ANALYSIS_DETAIL_TOO_LARGE']]) {
    const f = memory(gradeExamFixture()), image = 'x'.repeat(450 * 1024);
    for (let index = 0; index < count; index++) f.data.set(`semester_assessment_results/unique_detail_${index}`, {
      assessmentKind: 'QUIZ', semesterId: SCOPE, studentUid: 'a', sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
      sourceHash: 'a'.repeat(64), answers: {}, questionSnapshots: [{ id: '91', question: `원문 ${index}`, image }],
    });
    await assert.rejects(createQuizClassAnalysisService({ db: f.db }).query(input), error => error.details?.reason === reason);
    assert.ok(f.writes.every(path => path.startsWith('quiz_class_analysis_cache/')), 'only existing derived catalog caches may be written');
  }
});

function boundedPaperFixture() {
  const f = memory();
  for (let index = 0; index < 35; index++) f.data.set(`semester_assessment_results/wave_${String(index).padStart(2, '0')}`, {
    assessmentKind: 'QUIZ', semesterId: SCOPE, studentUid: 'a', sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
    answers: { 91: String(index) }, questionSnapshots: [{ id: '91', question: '당시 원문', answer: '가' }],
  });
  return f;
}

test('dictionary paper reads overlap at most two ten-document batches while decoding and rows retain order', async () => {
  const f = boundedPaperFixture(), getAll = f.db.getAll, releases = [], sizes = [], decoded = [];
  let calls = 0, active = 0, peak = 0;
  f.db.getAll = async (...args) => {
    const call = calls++;
    sizes.push(args.length - 1); active++; peak = Math.max(peak, active);
    if (call < 2) await new Promise(resolve => { releases[call] = resolve; });
    try {
      const docs = await getAll(...args);
      return docs.map(doc => ({ ...doc, data() { decoded.push(doc.id); return doc.data(); } }));
    } finally { active--; }
  };
  const input = gradeQuery({ mode: 'detail', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', snapshotDictionary: true });
  const loading = createQuizClassAnalysisService({ db: f.db }).loadResults(input, [{ uid: 'a' }], true, { documents: 0, bytes: 0 });
  for (let index = 0; index < 10 && calls < 2; index++) await new Promise(setImmediate);
  assert.equal(calls, 2, 'both reads start before either deferred read finishes');
  assert.equal(active, 2);
  releases[1](); await new Promise(setImmediate);
  assert.equal(calls, 2, 'the next wave waits for ordered validation');
  assert.deepEqual(decoded, [], 'a faster second read cannot move decoding or budget updates ahead');
  releases[0]();
  const rows = await loading;
  assert.equal(peak, 2);
  assert.deepEqual(sizes, [10, 10, 10, 5]);
  const expected = Array.from({ length: 35 }, (_, index) => `wave_${String(index).padStart(2, '0')}`);
  assert.deepEqual(rows.map(row => row.id), expected);
  assert.deepEqual(decoded, expected);
  assert.deepEqual(f.writes, []);
});

test('failed dictionary waves stop scheduling and preserve validation or byte-limit precedence over a later fetch failure', async () => {
  for (const failure of ['scope', 'limit', 'read']) {
    const f = boundedPaperFixture(), getAll = f.db.getAll;
    let calls = 0;
    f.db.getAll = async (...args) => {
      const call = ++calls;
      if (call === 2) throw new Error('Later batch failed');
      if (failure === 'read') throw new Error('First batch failed');
      const docs = await getAll(...args);
      return failure === 'scope' ? docs.map((doc, index) => index ? doc : ({ ...doc, data: () => ({ ...doc.data(), studentUid: 'foreign' }) })) : docs;
    };
    const budget = { documents: 0, bytes: 0, ...(failure === 'limit' ? { resultReadBytes: 256 * 1024 * 1024 } : {}) };
    const input = gradeQuery({ mode: 'detail', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', snapshotDictionary: true });
    await assert.rejects(createQuizClassAnalysisService({ db: f.db }).loadResults(input, [{ uid: 'a' }], true, budget), error =>
      failure === 'scope' ? error.details?.reason === 'QUIZ_ANALYSIS_CHANGED'
        : failure === 'limit' ? error.details?.reason === 'QUIZ_ANALYSIS_READ_BYTE_LIMIT' : error.message === 'First batch failed');
    assert.equal(calls, 2, 'failed validation never schedules a later wave');
    assert.deepEqual(f.writes, []);
  }
});

test('detail dictionary stops at the original-processing cap even when retained contents are identical', async () => {
  const f = memory(), budget = { documents: 0, bytes: 0 };
  const questionSnapshots = [{ id: '91', question: '같은 원문', image: 'x'.repeat(500 * 1024) }];
  for (let index = 0; index < 560; index++) f.data.set(`semester_assessment_results/repeated_detail_${index}`, {
    assessmentKind: 'QUIZ', semesterId: SCOPE, studentUid: 'a', sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', questionSnapshots,
  });
  const input = gradeQuery({ mode: 'detail', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', snapshotDictionary: true });
  await assert.rejects(createQuizClassAnalysisService({ db: f.db }).loadResults(input, [{ uid: 'a' }], true, budget),
    error => error.code === 'resource-exhausted' && error.details?.reason === 'QUIZ_ANALYSIS_READ_BYTE_LIMIT');
  assert.ok(budget.resultReadBytes > 256 * 1024 * 1024);
  assert.ok(budget.bytes < 2 * 1024 * 1024);
  assert.ok(f.bodyReads.filter(read => read.path.includes('/repeated_detail_')).length < 560);
  assert.deepEqual(f.writes, []);
});

test('achievement rejects over 256 MiB of cumulative original processing even when every image is identical', async () => {
  const f = memory(), budget = { documents: 0, bytes: 0 };
  // Keep one shared synthetic image/snapshot in the fixture, rather than
  // allocating hundreds of MiB just to verify the physical processing bound.
  const questionSnapshots = [{ id: '91', type: 'choice', question: '같은 원문', answer: '가', image: 'x'.repeat(500 * 1024) }];
  for (let index = 0; index < 560; index++) f.data.set(`semester_assessment_results/repeated_${index}`, {
    assessmentKind: 'QUIZ', semesterId: SCOPE, studentUid: 'a', sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
    sourceHash: 'a'.repeat(64), questionSnapshots,
  });
  await assert.rejects(createQuizClassAnalysisService({ db: f.db }).loadResults(gradeExamQuery(), [{ uid: 'a' }], true,
    budget, true), error => error.code === 'resource-exhausted' && error.details?.reason === 'QUIZ_ACHIEVEMENT_READ_BYTE_LIMIT');
  assert.ok(budget.resultReadBytes > 256 * 1024 * 1024);
  assert.ok(budget.bytes < 2 * 1024 * 1024, 'small unique retained size cannot bypass the original-processing limit');
  assert.ok(f.bodyReads.filter(read => read.path.includes('/repeated_')).length < 560, 'no new wave starts after the processing limit');
  await assert.rejects(createQuizClassAnalysisService({ db: f.db }).loadResults(gradeExamQuery(), [{ uid: 'a' }], true,
    undefined, true), error => error.details?.reason === 'QUIZ_ACHIEVEMENT_READ_BYTE_LIMIT');
  assert.deepEqual(f.writes, []);
});

test('scope-only compatibility reads fail closed when a result disappears or changes before its body read', async () => {
  for (const changed of ['missing', 'round']) {
    const f = memory(gradeExamFixture()), getAll = f.db.getAll;
    f.db.getAll = async (...refs) => {
      if (refs.some(ref => ref.path === 'semester_assessment_results/exam_a')) {
        if (changed === 'missing') f.data.delete('semester_assessment_results/exam_a');
        else f.data.set('semester_assessment_results/exam_a', { ...f.data.get('semester_assessment_results/exam_a'), examRound: 'round_2' });
      }
      return getAll(...refs);
    };
    await assert.rejects(createQuizClassAnalysisService({ db: f.db }).query(gradeExamQuery()), error => error.code === 'aborted');
  }
});

test('unchanged projected scope preserves missing, null and empty fields without depending on property order', async () => {
  const f = memory(gradeExamFixture()), getAll = f.db.getAll;
  f.data.set('semester_assessment_results/exam_a', { ...f.data.get('semester_assessment_results/exam_a'),
    uid: null, studentId: '', userId: null, email: '', studentEmail: null, unitId: '' });
  f.db.getAll = async (...refs) => (await getAll(...refs)).map(doc => !doc.exists ? doc : { ...doc,
    data: () => Object.fromEntries(Object.entries(doc.data()).reverse()) });
  const result = await createQuizClassAnalysisService({ db: f.db }).query(gradeExamQuery());
  assert.equal(result.complete, true);
  const raw = result.rawRows.find(row => row.id === 'exam_a').raw;
  assert.equal(raw.uid, null);
  assert.equal(raw.studentId, '');
  assert.equal(Object.hasOwn(raw, 'definitionId'), false);
});

test('a real result invalidation during a grade query rejects the mixed generation without changing result data', async () => {
  const f = memory(gradeExamFixture()), getAll = f.db.getAll;
  const before = structuredClone(f.data.get('semester_assessment_results/exam_a'));
  const invalidation = createQuizAnalysisInvalidation({ db: f.db });
  let invalidated = false;
  f.db.getAll = async (...refs) => {
    const docs = await getAll(...refs);
    if (!invalidated && refs.some(ref => ref.path === 'semester_assessment_results/exam_a')) {
      invalidated = true;
      await invalidation.invalidateResult(SCOPE, before);
    }
    return docs;
  };
  await assert.rejects(createQuizClassAnalysisService({ db: f.db }).query(gradeExamQuery()), error =>
    error.code === 'aborted' && error.details.reason === 'QUIZ_ANALYSIS_CHANGED' && error.message.includes('평가 자료'));
  assert.equal(invalidated, true);
  assert.deepEqual(f.data.get('semester_assessment_results/exam_a'), before);
});

test('grade result queries account for DNF limits and batch definitions without multiplying legacy alias queries', async context => {
  const f = memory(), students = Array.from({ length: 31 }, (_, index) => ({ uid: `synthetic-${index}`, email: `synthetic-${index}@school.test` }));
  const collection = f.db.collection;
  let activeQueries = 0, peakQueries = 0;
  f.db.collection = path => {
    const query = collection(path), get = query.get;
    if (path.endsWith('results')) query.get = async () => {
      activeQueries++; peakQueries = Math.max(peakQueries, activeQueries);
      try { await new Promise(resolve => setTimeout(resolve, 2)); return await get(); }
      finally { activeQueries--; }
    };
    return query;
  };
  for (let index = 0; index < 16; index++) f.data.set(`semester_assessment_definitions/quiz:${SCOPE}:unit-${index}:diagnostic`,
    { semesterId: SCOPE, assessmentKind: 'QUIZ', category: 'diagnostic' });
  await createQuizClassAnalysisService({ db: f.db }).loadResults(gradeExamQuery(), students, true,
    { documents: 0, bytes: 0 }, true);
  const requests = f.queries.filter(query => query.path.endsWith('results'));
  assert.ok(requests.some(query => query.filters[0][2].length === 30));
  assert.ok(requests.some(query => query.filters[0][2].length === 10));
  assert.ok(requests.every(query => query.filters.reduce((count, [, operator, value]) =>
    count * (operator === 'in' ? value.length : 1), 1) <= 30));
  assert.equal(requests.length, 18, '31 pupils use 18 bounded mock-exam queries; diagnostic definitions add no queries');
  assert.ok(requests.filter(query => query.path.endsWith('/quiz_results')).every(query =>
    !query.filters.some(([field]) => field === 'definitionId' || field === 'sourceId')));
  const definitions = requests.filter(query => query.filters.some(([field, , value]) => field === 'definitionId'
    && Array.isArray(value) && value.some(id => id.includes('unit-'))));
  assert.equal(definitions.length, 0);
  assert.ok(definitions.every(query => query.path === 'semester_assessment_results' && query.filters[0][0] === 'studentUid'));
  assert.equal(peakQueries, 8, 'only eight result queries run concurrently; query count and field projections stay bounded');
  assert.equal(activeQueries, 0);
  context.diagnostic('31-pupil query plan: 18 scoped mock-exam result queries; 1 mock definition-metadata query; 0 diagnostic/formative/worksheet queries.');
});

test('catalog has real current classes, no student names or answers and no result reads', async () => {
  const f = memory(), service = createQuizClassAnalysisService({ db: f.db });
  const result = await service.query({ semesterId: SCOPE, mode: 'catalog' });
  assert.deepEqual(result.classes.map(c => c.id), ['class_a', 'class_b']);
  assert.equal(result.assessments[0].questionCount, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE_LARGE_IMAGE'), false);
  assert.equal(JSON.stringify(result).includes('학생 A'), false);
  assert.equal(f.queries.some(query => /users|results|enrollments/.test(query.path)), false);
  assert.deepEqual(f.queries.find(query => query.path === 'semester_classes').projection,
    ['status', 'grade', 'classNumber']);
  assert.deepEqual(f.queries.find(query => query.path === 'semester_assessment_definitions').projection,
    ['assessmentKind', 'sourceId', 'category', 'examRound']);
});

test('roster and result invalidation retain the catalog but still refresh class statistics', async () => {
  const f = memory(), service = createQuizClassAnalysisService({ db: f.db });
  const triggers = createQuizAnalysisTriggers({ db: f.db });
  const snapshot = value => ({ exists: !!value, data: () => value });
  const before = await service.query(q);
  const catalogQueries = () => f.queries.filter(query => query.path === 'semester_classes'
    || query.path === 'semester_assessment_definitions').length;
  const initialCatalogQueries = catalogQueries();
  const oldEnrollment = f.data.get('semester_enrollments/en_a');
  const newEnrollment = { ...oldEnrollment, enrollmentStatus: 'INACTIVE' };
  f.data.set('semester_enrollments/en_a', newEnrollment);
  await triggers.invalidateQuizClassEnrollment.run({ params: { enrollmentId: 'en_a' },
    data: { before: snapshot(oldEnrollment), after: snapshot(newEnrollment) } });
  const after = await service.query(q);
  assert.equal(before.classes[0].rosterCount, 1);
  assert.equal(after.classes[0].rosterCount, 0, 'summary must still invalidate on enrollment changes');
  assert.equal(catalogQueries(), initialCatalogQueries, 'enrollment changes must not rescan picker data');
  const oldProfile = f.data.get('users/a'), newProfile = { ...oldProfile, name: '변경된 합성 이름' };
  f.data.set('users/a', newProfile);
  await triggers.invalidateQuizClassProfile.run({ params: { uid: 'a' },
    data: { before: snapshot(oldProfile), after: snapshot(newProfile) } });
  // A result without a resolvable class advances contentGeneration, not catalogGeneration.
  await createQuizAnalysisInvalidation({ db: f.db }).invalidateResult(SCOPE, {});
  const queries = f.queries.length;
  await service.query({ semesterId: SCOPE, mode: 'catalog' });
  assert.equal(f.queries.length, queries, 'profile and result updates reuse the authorized catalog');
});

test('catalog source triggers invalidate units, categories, rounds, definitions and class metadata', async () => {
  const snapshot = value => ({ exists: !!value, data: () => value });
  const cases = [
    { path: `${ROOT}/quiz_questions/1`, trigger: 'invalidateQuizClassQuestion', params: { year: '2026', semester: '2', questionId: '1' },
      update: value => ({ ...value, category: 'diagnostic' }), check: result => assert.equal(result.assessments[0].category, 'diagnostic') },
    { path: `${ROOT}/quiz_questions/1`, trigger: 'invalidateQuizClassQuestion', params: { year: '2026', semester: '2', questionId: '1' },
      update: value => ({ ...value, unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_2' }),
      check: result => assert.deepEqual(result.assessments.map(item => [item.unitId, item.examRound]), [['exam_prep', 'round_2']]) },
    { path: 'semester_assessment_definitions/defined-formative', trigger: 'invalidateQuizClassDefinition', params: { definitionId: 'defined-formative' },
      update: () => ({ semesterId: SCOPE, assessmentKind: 'QUIZ', sourceId: 'unit-a', category: 'formative' }),
      check: result => assert.equal(result.assessments[0].id, 'defined-formative') },
    { path: 'semester_classes/class_a', trigger: 'invalidateQuizClassMetadata', params: { classId: 'class_a' },
      update: value => ({ ...value, grade: '2', classNumber: '9' }),
      check: result => assert.equal(result.classes.find(item => item.id === 'class_a').label, '2학년 9반') },
    { path: 'semester_classes/class_a', trigger: 'invalidateQuizClassMetadata', params: { classId: 'class_a' },
      update: value => ({ ...value, status: 'INACTIVE' }),
      check: result => assert.deepEqual(result.classes.map(item => item.id), ['class_b']) },
    { path: `${ROOT}/curriculum/tree`, trigger: 'invalidateQuizClassCurriculum', params: { year: '2026', semester: '2', documentId: 'tree' },
      update: () => ({ tree: [{ id: 'big', title: '조선', children: [{ id: 'unit-a', title: '붕당 정치' }] }] }),
      check: result => assert.equal(result.assessments[0].unitTitle, '조선 · 붕당 정치') },
    { path: `${ROOT}/quiz_questions/1`, trigger: 'invalidateQuizClassQuestion', params: { year: '2026', semester: '2', questionId: '1' },
      update: () => null, check: result => assert.deepEqual(result.assessments, []) },
  ];
  for (const scenario of cases) {
    const f = memory(), service = createQuizClassAnalysisService({ db: f.db });
    const catalogQuery = { semesterId: SCOPE, mode: 'catalog' };
    await service.query(catalogQuery);
    const queryCount = f.queries.length;
    const before = f.data.get(scenario.path), after = scenario.update(before);
    if (after) f.data.set(scenario.path, after); else f.data.delete(scenario.path);
    await createQuizAnalysisTriggers({ db: f.db })[scenario.trigger].run({ params: scenario.params,
      data: { before: snapshot(before), after: snapshot(after) } });
    const result = await service.query(catalogQuery);
    assert.ok(f.queries.length > queryCount, `${scenario.trigger} must rebuild the picker catalog`);
    scenario.check(result);
  }
});

test('mock paper catalogs and question analysis separate authored rounds from legacy pools', async () => {
  const f = memory();
  for (const [id, examRound] of [[91, 'round_1'], [92, 'round_1'], [93, 'round_2']]) {
    f.data.set(`${ROOT}/quiz_questions/${id}`, { id, unitId: 'exam_prep', category: 'exam_prep', examRound,
      paperOrder: id === 92 ? 2 : 1, points: 50, question: '합성 역사 문항', type: 'choice', options: ['가', '나', '다', '라', '마'] });
  }
  f.data.set(`${ROOT}/quiz_questions/legacy`, { id: 90, unitId: 'exam_prep', category: 'exam_prep', question: '이전 자료' });
  f.data.set('semester_assessment_results/mock-result', { assessmentKind: 'QUIZ', semesterId: SCOPE, sourceId: 'exam_prep',
    category: 'exam_prep', examRound: 'round_1', studentUid: 'a', classId: 'class_a', attemptId: 'mock-result',
    score: 1, total: 2, percent: 30, earnedPoints: 30, maxPoints: 100, submittedAtIso: '2026-11-06T01:00:00Z',
    answerChecks: [{ id: 91, correct: true }, { id: 92, correct: false }] });
  const service = createQuizClassAnalysisService({ db: f.db });
  const catalog = await service.query({ semesterId: SCOPE, mode: 'catalog' });
  const papers = catalog.assessments.filter(item => item.category === 'exam_prep');
  assert.deepEqual(papers.map(item => [item.examRound, item.questionCount]), [['round_1', 2], ['round_2', 1]]);
  assert.match(papers[0].title, /초시/); assert.match(papers[1].title, /복시/);
  const summary = await service.query({ ...q, unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_2' });
  assert.deepEqual(summary.classes[0].questions.map(item => String(item.id)), ['93']);
  const first = await service.query({ ...q, unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1' });
  assert.equal(first.classes[0].averageScore, 30, 'authoritative weighted percent must not be replaced by 1/2 correct');
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
  assert.ok(resultQueries.every(query => query.filters.length > 1 && query.filters[0][1] === 'in'
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

const resultEvent = (before, after, params = {}) => ({ params, data: {
  before: { exists: before !== undefined, data: () => before },
  after: { exists: after !== undefined, data: () => after },
} });
const classRevisionPath = (scope, classId) => `quiz_class_analysis_state/${scope}/classes/${hash(classId)}`;
const studentRevisionPath = (scope, uid) => `quiz_analysis_student_revisions/${hash(`${scope}\n${uid}`)}`;

test('result update invalidates its unchanged target once with two reads and two writes', async () => {
  const f = memory(), before = f.data.get('semester_assessment_results/r2');
  const after = { ...before, percent: 50 };
  f.data.set('semester_assessment_results/r2', after);
  await createQuizAnalysisInvalidation({ db: f.db }).onResult(resultEvent(before, after));
  assert.deepEqual(f.reads, [`semester_enrollment_slots/${buildEnrollmentSlotId(SCOPE, 'a')}`, 'semester_enrollments/en_a']);
  assert.deepEqual(f.writes, [studentRevisionPath(SCOPE, 'a'), classRevisionPath(SCOPE, 'class_a')]);
  assert.equal(f.queries.length, 0, 'invalidation must never scan results or the roster');
  assert.deepEqual(f.data.get('semester_assessment_results/r2'), after, 'result scores remain untouched');
  assert.equal((await createQuizClassAnalysisService({ db: f.db }).query(q)).classes[0].averageScore, 50);
});

test('result invalidation retains create, delete, legacy and missing-owner behavior', async () => {
  const canonical = fixture()['semester_assessment_results/r2'];
  for (const [before, after, params] of [
    [undefined, canonical, {}], [canonical, undefined, {}],
    [{ uid: 'a', classId: 'class_a' }, { uid: 'a', classId: 'class_a', score: 50 }, { year: '2026', semester: '2' }],
  ]) {
    const f = memory();
    await createQuizAnalysisInvalidation({ db: f.db }).onResult(resultEvent(before, after, params));
    assert.equal(f.reads.length, 2);
    assert.deepEqual(f.writes, [studentRevisionPath(SCOPE, 'a'), classRevisionPath(SCOPE, 'class_a')]);
  }
  const f = memory();
  const unknown = { assessmentKind: 'QUIZ', semesterId: SCOPE };
  await createQuizAnalysisInvalidation({ db: f.db }).onResult(resultEvent(unknown, { ...unknown, percent: 50 }));
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.writes, [`quiz_class_analysis_state/${SCOPE}`]);
});

test('result moves invalidate both student, class and semester targets', async () => {
  const original = fixture()['semester_assessment_results/r2'];
  for (const change of [
    { studentUid: 'b', classId: 'class_b' }, { classId: 'class_b' }, { semesterId: '2026-1' },
  ]) {
    const f = memory();
    await createQuizAnalysisInvalidation({ db: f.db }).onResult(resultEvent(original, { ...original, ...change }));
    assert.ok(f.writes.includes(studentRevisionPath(SCOPE, 'a')));
    assert.ok(f.writes.includes(classRevisionPath(SCOPE, 'class_a')));
    assert.ok(f.writes.includes(studentRevisionPath(change.semesterId || SCOPE, change.studentUid || 'a')));
    assert.ok(f.writes.includes(classRevisionPath(change.semesterId || SCOPE, change.classId || 'class_a')));
  }
  for (const [before, after] of [[original, { ...original, assessmentKind: 'OTHER' }],
    [{ ...original, assessmentKind: 'OTHER' }, original]]) {
    const f = memory();
    await createQuizAnalysisInvalidation({ db: f.db }).onResult(resultEvent(before, after));
    assert.equal(f.reads.length, 2);
    assert.equal(f.writes.length, 2, 'entering or leaving QUIZ still invalidates its quiz target');
  }
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

test('keyword detail dictionary trims snapshots and answers before packing and preserves inline values', async () => {
  const initial = keywordFixture();
  Object.assign(initial['semester_assessment_results/search_a'], {
    answers: { 2: '검색 답', 999: '범위 밖 답' },
    questionSnapshots: [{ id: 2, question: '검색 문항', image: '당시 이미지' }, { id: 999, question: '범위 밖 문제' }],
  });
  const f = memory(initial), service = createQuizClassAnalysisService({ db: f.db, now: () => 1800000000000 });
  const input = keywordQuery({ mode: 'detail', keyword: '광해군 사화' });
  const inline = await service.query(input);
  f.queries.length = 0;
  const packed = await service.query({ ...input, snapshotDictionary: true });
  const sortRows = response => ({ ...response, rawRows: [...response.rawRows].sort((a, b) => a.id.localeCompare(b.id)) });
  assert.deepEqual(sortRows(expandSnapshotDictionary(packed)), sortRows(inline));
  assert.equal(Object.keys(packed.historicalQuestionSnapshots).length, 1);
  assert.equal(JSON.stringify(packed).includes('범위 밖'), false);
  const resultQueries = f.queries.filter(query => /(?:semester_assessment_results|quiz_results)$/.test(query.path));
  assert.ok(resultQueries.length > 0);
  assert.ok(resultQueries.every(query => query.projection && !query.projection.includes('questionSnapshots')));
  assert.ok(f.writes.every(path => path.startsWith('quiz_class_analysis_cache/')), 'only existing derived catalog caches may be written');
});

test('detail dictionary rejects changed student, semester and definition scope between metadata and body reads', async () => {
  for (const patch of [{ studentUid: 'b' }, { semesterId: '2026-1' }, { category: 'exam_prep' }, { sourceId: 'other-unit' }]) {
    const f = memory(), getAll = f.db.getAll;
    f.db.getAll = async (...args) => {
      if (args.at(-1)?.fieldMask?.includes('questionSnapshots')) Object.assign(f.data.get('semester_assessment_results/r1'), patch);
      return getAll(...args);
    };
    await assert.rejects(createQuizClassAnalysisService({ db: f.db }).query(normalizeQuery({ ...q, mode: 'detail', snapshotDictionary: true })),
      error => error.code === 'aborted' && error.details?.reason === 'QUIZ_ANALYSIS_CHANGED');
    assert.ok(f.writes.every(path => path.startsWith('quiz_class_analysis_cache/')), 'only existing derived catalog caches may be written');
  }
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

test('behavior inputs use result projections without extra summary reads and keyword detail trims observations', async () => {
  const initial = fixture();
  const observation = { activeMs: 10000, hiddenMs: 0, firstResponseMs: 6000, finalResponseMs: 6000, answerChangeCount: 0, revisitCount: 0, quality: 'complete' };
  initial['semester_assessment_results/r2'].answers = { 1: '원본 답안' };
  initial['semester_assessment_results/r2'].analytics = { version: 1, quality: 'complete', questions: { 1: observation, 999: observation } };
  initial['semester_assessment_results/r1'].submissionRef = 'semester_assessment_submissions/r1';
  initial['semester_assessment_submissions/r1'] = { attemptId: 'r1', studentUid: 'a', semesterId: SCOPE, answers: { 1: '상세 보완 답안' } };
  const f = memory(initial), service = createQuizClassAnalysisService({ db: f.db });
  const summary = await service.query(q);
  assert.ok(f.queries.filter(query => query.path.endsWith('results')).every(query => !query.projection.includes('analytics')
    && !query.projection.includes('answers') && !query.projection.includes('questionSnapshots')));
  assert.ok(f.bodyReads.filter(read => read.path.startsWith('semester_assessment_results/')).every(read => read.projection.includes('analytics')
    && read.projection.includes('answers') && !read.projection.includes('questionSnapshots')));
  assert.equal(f.reads.some(path => path.startsWith('semester_assessment_submissions/')), false);
  assert.equal(JSON.stringify(summary).includes('원본 답안'), false);
  assert.equal(JSON.stringify(summary).includes('firstResponseMs'), false);
  const detail = await service.query(normalizeQuery({ ...q, mode: 'detail', keyword: '사림' }));
  const joined = detail.rawRows.find(row => row.id === 'r1');
  assert.equal(joined.raw.answers[1], '상세 보완 답안');
  assert.equal(joined.raw.behaviorAnswersAvailable, false, 'joining an old submission never invents original behavior input');
  const original = detail.rawRows.find(row => row.id === 'r2');
  assert.equal(original.raw.behaviorAnswersAvailable, true);
  assert.deepEqual(Object.keys(original.raw.analytics.questions), ['1']);
  const adapted = adaptRecords(detail.rawRows, detail.students, SCOPE);
  assert.equal(adapted.find(row => row.id === 'r1').behaviorAnswersAvailable, false);
  assert.equal(adapted.find(row => row.id === 'r2').behaviorAnswersAvailable, true);
  assert.deepEqual(adapted.find(row => row.id === 'r2').analytics.questions[1], observation);
});

test('missing historical behavior stays insufficient, never zero or unflagged, and grade counts cover the roster once', async () => {
  const f = memory(keywordFixture()), service = createQuizClassAnalysisService({ db: f.db });
  const result = await service.query(keywordQuery({ comparisonGrade: '3' }));
  assert.deepEqual(result.classes[0].behaviorCounts, { suspected_guessing: 0, repeated_choice: 0, unflagged: 0, insufficient: 2, no_attempt: 0 });
  assert.deepEqual(result.gradeComparison.behaviorCounts, { suspected_guessing: 0, repeated_choice: 0, unflagged: 0, insufficient: 3, no_attempt: 1 });
  assert.equal(Object.values(result.gradeComparison.behaviorCounts).reduce((sum, count) => sum + count, 0), result.gradeComparison.rosterCount);
  assert.equal(result.gradeComparison.averageScore, 50, 'observation categories never modify official or keyword scores');
  const sourceReads = f.queries.length;
  await service.query(keywordQuery({ comparisonGrade: '3' }));
  assert.equal(f.queries.length, sourceReads, 'warm behavior summary must retain the existing cache cost');
});

const behaviorFixture = () => {
  const initial = fixture();
  for (const path of Object.keys(initial)) if (path.includes('/quiz_results/') || path.startsWith('semester_assessment_results/')) delete initial[path];
  const ids = Array.from({ length: 10 }, (_, index) => index + 1);
  for (const id of ids) initial[`${ROOT}/quiz_questions/${id}`] = { id, unitId: 'unit-a', category: 'formative',
    question: `광해군 ${id}번`, type: 'choice', options: ['선택 가', '선택 나', '선택 다', '선택 라'], contentRevision: 1 };
  for (const [uid, classId] of [['c', 'class_a'], ['d', 'class_b'], ['e', 'class_a'], ['f', 'class_b']]) {
    initial[`semester_enrollments/en_${uid}`] = { semesterId: SCOPE, studentUid: uid, classId, enrollmentStatus: 'ACTIVE' };
    initial[`semester_enrollment_slots/${buildEnrollmentSlotId(SCOPE, uid)}`] = { semesterId: SCOPE, studentUid: uid, activeEnrollmentId: `en_${uid}`, status: 'ACTIVE' };
  }
  for (const uid of ['a', 'b', 'c', 'd', 'f']) {
    const fast = uid === 'a', varied = ['c', 'd', 'f'].includes(uid);
    const result = { assessmentKind: 'QUIZ', semesterId: SCOPE, sourceId: 'unit-a', category: 'formative', studentUid: uid,
      attemptId: `behavior_${uid}`, percent: 80, total: 10, answerChecks: ids.map(id => ({ id, correct: id <= 8 })),
      learningSnapshot: ids.map(id => ({ id, sourceRevision: '1' })),
      answers: Object.fromEntries(ids.map(id => [id, varied ? ['선택 가', '선택 나', '선택 다', '선택 라'][id % 4] : '선택 가'])),
      analytics: { version: 1, quality: uid === 'f' ? 'partial' : 'complete', questions: Object.fromEntries(ids.map(id => [id,
        { activeMs: fast ? 500 : 50000, hiddenMs: 0, firstResponseMs: fast ? 300 : 40000, finalResponseMs: fast ? 400 : 45000,
          answerChangeCount: 0, revisitCount: 0, hintViewed: false, quality: uid === 'f' ? 'partial' : 'complete' }])) },
      submittedAtIso: '2026-10-25T02:00:00Z' };
    if (uid === 'd') delete result.analytics;
    initial[`semester_assessment_results/behavior_${uid}`] = result;
  }
  return initial;
};

test('server summary classifies five behavior states on current canonical responses without changing scores', async () => {
  const f = memory(behaviorFixture());
  const handler = createQuizClassAnalysisHandler({ db: f.db, assertSession: async () => ({ uid: 'teacher' }) });
  const result = await handler({ auth: { uid: 'teacher', token: {} }, data: { ...q, comparisonGrade: '3' } });
  assert.deepEqual(result.classes[0].behaviorCounts, { suspected_guessing: 1, repeated_choice: 0, unflagged: 1, insufficient: 0, no_attempt: 1 });
  assert.deepEqual(result.gradeComparison.behaviorCounts, { suspected_guessing: 1, repeated_choice: 1, unflagged: 1, insufficient: 2, no_attempt: 1 });
  assert.equal(result.gradeComparison.averageScore, 80);
  assert.equal(result.gradeComparison.scoredCount, 5);
  assert.equal(Object.values(result.gradeComparison.behaviorCounts).reduce((sum, count) => sum + count, 0), 6);
  assert.equal(f.reads.some(path => path.startsWith('semester_assessment_submissions/')), false);
  assert.equal(JSON.stringify(result).includes('선택 가'), false, 'private answers must not enter the class or grade payload');
});

test('behavior uses one latest attempt, reacts to result invalidation, and narrows keyword evidence', async () => {
  const initial = behaviorFixture(), f = memory(initial), service = createQuizClassAnalysisService({ db: f.db });
  assert.equal((await service.query(q)).classes[0].behaviorCounts.suspected_guessing, 1);
  const latest = { ...initial['semester_assessment_results/behavior_c'], attemptId: 'later_a', studentUid: 'a', submittedAtIso: '2026-10-26T02:00:00Z' };
  f.data.set('semester_assessment_results/later_a', latest);
  await createQuizAnalysisInvalidation({ db: f.db }).invalidateResult(SCOPE, latest);
  const current = await service.query(q);
  assert.equal(current.classes[0].behaviorCounts.suspected_guessing, 0);
  assert.equal(current.classes[0].behaviorCounts.unflagged, 2);
  const narrow = await service.query(normalizeQuery({ ...q, keyword: '광해군 1번' }));
  assert.equal(narrow.search.matchedQuestionCount, 1);
  assert.equal(narrow.classes[0].behaviorCounts.insufficient, 2, 'one matching item cannot borrow behavior from other items or older attempts');
});

test('detail-only immutable answer recovery cannot change the original summary behavior category', async () => {
  const initial = behaviorFixture();
  const original = initial['semester_assessment_results/behavior_b'];
  const answers = original.answers;
  delete original.answers;
  original.submissionRef = 'semester_assessment_submissions/behavior_b';
  initial['semester_assessment_submissions/behavior_b'] = { studentUid: 'b', semesterId: SCOPE, attemptId: 'behavior_b', answers };
  const f = memory(initial), service = createQuizClassAnalysisService({ db: f.db });
  const scope = { ...q, classIds: ['class_b'] };
  const summary = await service.query(scope);
  const detail = await service.query({ ...scope, mode: 'detail' });
  const result = detail.rawRows.find(row => row.id === 'behavior_b');
  assert.deepEqual(result.raw.answers, answers);
  assert.equal(result.raw.behaviorAnswersAvailable, false);
  const analysis = buildQuizAnalysis({ semesterId: SCOPE, students: detail.students, questions: detail.questions,
    records: adaptRecords(detail.rawRows, detail.students, SCOPE), scope: { unitIds: ['unit-a'], category: 'formative', classId: 'class_b' } });
  const detailCounts = { suspected_guessing: 0, repeated_choice: 0, unflagged: 0, insufficient: 0, no_attempt: 0 };
  for (const student of analysis.students) detailCounts[student.behavior.category]++;
  assert.deepEqual(detailCounts, summary.classes[0].behaviorCounts);
});

test('roster lookup merges legacy value types and reads each canonical slot once', async () => {
  const f = memory();
  f.data.set('users/legacy_numeric', { role: 'student', studentGrade: 3, studentClass: 1, studentNumber: 5, name: '구형 학생' });
  f.data.set('users/excluded', { role: 'student', grade: '3', class: '1', enrollmentStatus: 'withdrawn' });
  f.data.set('users/foreign_grade', { role: 'student', grade: '2', class: '1' });
  const service = createQuizClassAnalysisService({ db: f.db });
  const students = await service.loadRoster(SCOPE, { id: 'class_a', grade: '3', classNumber: '1' });
  assert.deepEqual(students.map(student => student.uid), ['a', 'legacy_numeric']);
  assert.equal(students[0].name, '학생 A');
  assert.equal(students[0].email, 'a@school.test');
  const profiles = f.queries.filter(query => query.path === 'users');
  assert.equal(profiles.length, 2, 'string and numeric class values share one query per historical field');
  assert.ok(profiles.every(query => query.filters[0][1] === 'in' && query.projection?.length));
  const slotReads = f.bodyReads.filter(read => read.path.startsWith('semester_enrollment_slots/'));
  assert.equal(slotReads.length, 2);
  assert.equal(new Set(slotReads.map(read => read.path)).size, slotReads.length, 'canonical pupils are not read again for legacy email lookup');
  assert.ok(slotReads.every(read => read.projection && !read.projection.includes('snapshot')));
});

test('selected fixed round excludes other question bodies in detail and achievement reads', async () => {
  const initial = fixture();
  for (let round = 1; round <= 3; round++) {
    initial[`${ROOT}/quiz_questions/${90 + round}`] = { id: 90 + round, unitId: 'exam_prep', category: 'exam_prep',
      examRound: `round_${round}`, paperOrder: 1, points: 100, question: `문항 ${round}`, image: 'large-image'.repeat(10000) };
  }
  for (const mode of ['detail', 'achievement']) {
    const f = memory(initial), service = createQuizClassAnalysisService({ db: f.db });
    await service.query({ semesterId: SCOPE, mode: 'catalog' });
    f.queries.length = 0;
    const result = await service.query({ ...q, mode, unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_2' });
    assert.deepEqual(result.questions.map(question => String(question.id)), ['92']);
    const questionReads = f.queries.filter(query => query.path.endsWith('/quiz_questions'));
    assert.equal(questionReads.length, 1, 'selected round is fetched in one query');
    assert.deepEqual(questionReads[0].returnedPaths, [`${ROOT}/quiz_questions/92`]);
    assert.ok(questionReads[0].filters.some(([field, operator, value]) => field === 'examRound' && operator === '==' && value === 'round_2'));
  }
});

test('question lookup preserves untagged legacy banks and never borrows a different fixed round', async () => {
  const f = memory();
  f.data.set(`${ROOT}/quiz_questions/91`, { id: 91, unitId: 'exam_prep', category: 'exam_prep', question: '구형 문항' });
  const service = createQuizClassAnalysisService({ db: f.db });
  const scope = { ...q, mode: 'detail', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1' };
  const legacy = await service.query(scope);
  assert.deepEqual(legacy.questions.map(question => String(question.id)), ['91']);
  const metadata = f.queries.find(query => query.path.endsWith('/quiz_questions') && query.projection?.join(',') === 'category,examRound');
  assert.ok(metadata, 'fallback discovers only small scope fields before reading the old bank');
  f.data.set(`${ROOT}/quiz_questions/92`, { id: 92, unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_2', question: '다른 회차' });
  f.queries.length = 0;
  f.bodyReads.length = 0;
  const empty = await service.query(scope);
  assert.deepEqual(empty.questions, [], 'an authored other round disables the untagged fallback');
  assert.equal(f.bodyReads.some(read => read.path.startsWith(`${ROOT}/quiz_questions/`)), false);
  assert.ok(f.queries.filter(query => query.path.endsWith('/quiz_questions') && query.returnedPaths.length)
    .every(query => query.projection?.join(',') === 'category,examRound'));
});
