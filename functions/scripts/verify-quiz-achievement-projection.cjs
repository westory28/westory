'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SCOPE_FIELDS, sourceVersionOf, projectionRef, projectAchievementRaw, buildAchievementProjection,
  readAchievementProjections, updateAchievementProjection } = require('../quizAchievementProjection');
const { buildCorrection } = require('../quizQuestionCorrections');
const { parseArgs, runBackfill } = require('./backfill-quiz-achievement-projection.cjs');
const { createLiveRecorder, createLiveReader, contextVersion } = require('../quizClassAnalysisLive');
const { buildEnrollmentSlotId } = require('../productionGateway/archiveEnrollment');
const { createHash } = require('node:crypto');
const SCOPE = '2026-2', PATH = 'semester_assessment_results/result-a';
const raw = () => ({ semesterId: SCOPE, assessmentKind: 'QUIZ', studentUid: 'student-a',
  sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
  definitionId: `quiz:${SCOPE}:exam_prep:exam_prep:round_1`, attemptId: 'result-a', resultId: 'result-a',
  sourceHash: 'a'.repeat(64), total: 1, score: 0, percent: 0, earnedPoints: 0, maxPoints: 5,
  answers: { q: '나' }, answerChecks: [{ id: 'q', correct: false }],
  questionSnapshots: [{ id: 'q', type: 'choice', question: '동결 원문', options: ['가', '나'], answer: '가', points: 5, image: 'x'.repeat(20000) }],
  learningSnapshot: [{ id: 'q', unitId: 'exam_prep', targetAchievementLevel: 'C', intendedDifficulty: 'medium' }],
  analytics: { questions: { q: { activeMs: 1000 } } }, submittedAtIso: '2026-11-10T01:00:00Z' });
function memory(initial = { [PATH]: raw() }) {
  const data = new Map(Object.entries(initial)), versions = new Map([...data.keys()].map(path => [path, 1]));
  const reads = [], writes = [];
  const snapshot = (path, fields) => ({ id: path.split('/').at(-1), ref: ref(path), exists: data.has(path),
    updateTime: { seconds: 100, nanoseconds: versions.get(path) || 0 }, data: () => fields
      ? Object.fromEntries(fields.filter(key => Object.hasOwn(data.get(path) || {}, key)).map(key => [key, data.get(path)[key]])) : data.get(path) });
  const ref = path => ({ path, get: async () => { reads.push({ path }); return snapshot(path); } });
  const getAll = async (...refs) => {
    const options = refs.at(-1)?.fieldMask ? refs.pop() : {};
    return refs.map(item => { reads.push({ path: item.path, fields: options.fieldMask }); return snapshot(item.path, options.fieldMask); });
  };
  const db = { doc: ref, getAll, runTransaction: async callback => callback({ getAll,
    get: item => item.get(), set: (item, value) => { writes.push(item.path); data.set(item.path, value); versions.set(item.path, (versions.get(item.path) || 0) + 1); } }),
    collection(path) {
      const filters = []; let limit = Infinity, after = '', fields;
      const cursor = { where(key, op, value) { filters.push([key, op, value]); return cursor; },
        select(...value) { fields = value; return cursor; }, orderBy() { return cursor; }, limit(value) { limit = value; return cursor; },
        startAfter(value) { after = value.id; return cursor; }, async get() {
          const docs = [...data.keys()].filter(key => key.startsWith(`${path}/`) && key.slice(path.length + 1).split('/').length === 1)
            .filter(key => filters.every(([field, op, value]) => op === '==' ? data.get(key)[field] === value
              : op === '>' ? data.get(key)[field] > value : op === '<=' ? data.get(key)[field] <= value : value.includes(data.get(key)[field])))
            .filter(key => key.split('/').at(-1) > after).sort().slice(0, limit).map(key => snapshot(key, fields));
          return { docs, size: docs.length };
        } }; return cursor;
    } };
  const entry = (path = PATH, source = 'canonical') => ({ id: path.split('/').at(-1), path, source,
    sourceVersion: sourceVersionOf(snapshot(path)), scope: snapshot(path, SCOPE_FIELDS).data() });
  return { db, data, versions, reads, writes, snapshot, entry };
}

test('compact projection preserves historical identity, scores and ordered options without full originals', () => {
  const first = projectAchievementRaw(raw()), second = projectAchievementRaw({ ...raw(), questionSnapshots: [{ ...raw().questionSnapshots[0], question: '같은 sourceHash의 다른 원문' }] });
  assert.notEqual(first.learningSnapshot[0].sourceRevision, second.learningSnapshot[0].sourceRevision);
  assert.match(first.learningSnapshot[0].sourceRevision, /^snapshot:[a-f0-9]{64}$/);
  assert.deepEqual(first.questionSnapshots, [{ id: 'q', type: 'choice', options: ['가', '나'], answer: '가', points: 5 }]);
  assert.deepEqual(first.answers, raw().answers);
  assert.equal(first.percent, 0);
  assert.equal(Object.hasOwn(first, 'analytics'), false);
  assert.equal(JSON.stringify(first).includes('동결 원문'), false);
  const legacy = projectAchievementRaw({ uid: 'legacy-a', score: 0, details: [{ qid: 'q', u: '', correct: false, sourceRevision: 'old', questionSnapshot: raw().questionSnapshots[0] }] });
  assert.deepEqual(legacy.details, [{ qid: 'q', u: '', correct: false, sourceRevision: 'old' }]);
  assert.equal(legacy.score, 0);
});

test('compact projection applies compatible corrections before stripping material and keeps foreign corrections out', () => {
  const before = { ...raw().questionSnapshots[0], unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', contentRevision: 1 };
  const after = { ...before, answer: '나', contentRevision: 2 };
  const correction = buildCorrection(SCOPE, 'q', before, after);
  const value = { ...raw(), questionSnapshots: [before], learningSnapshot: [{ id: 'q', sourceRevision: '1' }], gradingCorrections: { correction } };
  const projected = projectAchievementRaw(value);
  assert.equal(projected.percent, 100);
  assert.equal(projected.answerChecks[0].correct, true);
  assert.equal(projected.questionSnapshots[0].answer, '나');
  assert.equal(Object.hasOwn(projected, 'gradingCorrections'), false);
  assert.equal(projectAchievementRaw({ ...value, gradingCorrections: { correction: { ...correction, semesterId: '2026-1' } } }).percent, 0);
});

test('matching sidecars avoid all original body reads and stale/corrupt entries fall back without writes', async () => {
  const f = memory(), entry = f.entry(), ref = projectionRef(f.db, PATH);
  const view = buildAchievementProjection({ sourcePath: PATH, source: 'canonical', sourceVersion: entry.sourceVersion, semesterId: SCOPE, raw: raw() });
  f.data.set(ref.path, view);
  const budget = {};
  const [hit] = await readAchievementProjections({ db: f.db, entries: [entry], budget });
  assert.equal(hit.raw.analysisSourceVersion, entry.sourceVersion);
  assert.equal(budget.projectionHits, 1);
  assert.equal(f.reads.filter(read => read.path === PATH).length, 0);
  for (const damaged of [null, { ...view, sourceVersion: 'stale' }, { ...view, rawCompact: { ...view.rawCompact, percent: 100 } }, { ...view, sourcePath: 'foreign' }]) {
    damaged ? f.data.set(ref.path, damaged) : f.data.delete(ref.path);
    const calls = f.reads.length, [fallback] = await readAchievementProjections({ db: f.db, entries: [entry] });
    assert.deepEqual(fallback.raw, hit.raw);
    assert.equal(f.reads.slice(calls).filter(read => read.path === PATH).length, 1);
  }
  assert.deepEqual(f.writes, []);
  f.versions.set(PATH, 2);
  await assert.rejects(readAchievementProjections({ db: f.db, entries: [entry] }), error => error.details?.reason === 'QUIZ_ANALYSIS_CHANGED');
});

test('fallback body reads run in batches of at most ten with at most two in flight', async () => {
  const f = memory({}), entries = [];
  for (let index = 0; index < 43; index++) {
    const path = `semester_assessment_results/batch-${index}`;
    f.data.set(path, raw()); f.versions.set(path, 1); entries.push(f.entry(path));
  }
  const getAll = f.db.getAll; let active = 0, maximum = 0; const sizes = [];
  f.db.getAll = async (...refs) => {
    if (!refs[0].path.startsWith('semester_assessment_results/')) return getAll(...refs);
    sizes.push(refs.filter(ref => ref.path).length); maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 1));
    try { return await getAll(...refs); } finally { active--; }
  };
  const budget = {}, rows = await readAchievementProjections({ db: f.db, entries, budget });
  assert.equal(rows.length, 43); assert.ok(sizes.every(size => size <= 10)); assert.equal(maximum, 2);
  assert.equal(budget.projectionFallbackReads, 43); assert.deepEqual(f.writes, []);
});

test('fallback preserves the original-processing byte limit and stops before another wave', async () => {
  const f = memory();
  await assert.rejects(readAchievementProjections({ db: f.db, entries: [f.entry()], budget: { resultReadBytes: 256 * 1024 * 1024 - 1 } }),
    error => error.details?.reason === 'QUIZ_ACHIEVEMENT_READ_BYTE_LIMIT');
  assert.deepEqual(f.writes, []);
});

test('projection events are ordered, duplicate-safe and deletion tombstones prevent resurrection', async () => {
  const f = memory(), versioned = (value, nanos) => ({ exists: !!value, updateTime: value ? { seconds: 100, nanoseconds: nanos } : undefined, data: () => value });
  const event = (value, nanos, previous) => ({ params: { resultId: 'result-a' }, time: `1970-01-01T00:01:40.${String(nanos).padStart(9, '0')}Z`,
    data: { after: versioned(value, nanos), before: versioned(previous, nanos - 1) } });
  assert.equal(await updateAchievementProjection(f.db, event(raw(), 2)), true);
  assert.equal(await updateAchievementProjection(f.db, event(raw(), 2)), false);
  assert.equal(await updateAchievementProjection(f.db, event(raw(), 1)), false);
  assert.equal(await updateAchievementProjection(f.db, event(null, 3, raw())), true);
  assert.equal(await updateAchievementProjection(f.db, event(raw(), 2)), false);
  assert.equal(f.data.get(projectionRef(f.db, PATH).path).deleted, true);
  assert.equal(f.reads.some(read => read.path === PATH), false, 'event refresh never reads the original again');
  const count = f.writes.length;
  await updateAchievementProjection(f.db, event({ ...raw(), category: 'formative' }, 4));
  assert.equal(f.writes.length, count, 'unrelated assessments do not create views');
});

test('projection failure does not prevent existing live invalidation', async () => {
  const f = memory(), transaction = f.db.runTransaction;
  // Use an event without an owner/class so the existing root marker is the only target.
  f.db.runTransaction = callback => transaction(async tx => {
    const getAll = tx.getAll;
    tx.getAll = (...refs) => refs.some(ref => ref.path?.startsWith('quiz_achievement_result_views/'))
      ? Promise.reject(new Error('Synthetic sidecar failure')) : getAll(...refs);
    return callback(tx);
  });
  const value = { ...raw(), studentUid: undefined }, warning = console.warn; let warned = false;
  console.warn = () => { warned = true; };
  try { await createLiveRecorder({ db: f.db }).result({ params: { resultId: 'result-a' }, id: 'event',
    data: { before: { exists: false }, after: { exists: true, updateTime: { seconds: 100, nanoseconds: 2 }, data: () => value } } }); }
  finally { console.warn = warning; }
  assert.equal(warned, true);
  assert.ok(f.writes.some(path => path === `quiz_class_analysis_state/${SCOPE}`));
});

test('scoped backfill is dry by default, skips unchanged versions and never writes originals', async () => {
  const options = parseArgs(['--semester', SCOPE, '--unit', 'exam_prep', '--round', 'round_1']);
  assert.equal(options.apply, false);
  for (const args of [[], ['--semester', SCOPE], ['--semester', SCOPE, '--unit', '../a', '--round', 'round_1']]) assert.throws(() => parseArgs(args));
  const f = memory(), original = JSON.stringify(f.data.get(PATH));
  assert.equal((await runBackfill({ db: f.db, options })).converted, 1); assert.deepEqual(f.writes, []);
  assert.equal((await runBackfill({ db: f.db, options: { ...options, apply: true } })).written, 1);
  assert.equal((await runBackfill({ db: f.db, options: { ...options, apply: true } })).unchanged, 1);
  assert.equal(JSON.stringify(f.data.get(PATH)), original);
  assert.ok(f.writes.every(path => path.startsWith('quiz_achievement_result_views/')));
});

test('backfill never publishes a projection if its original changes before the guarded transaction', async () => {
  const f = memory(), transact = f.db.runTransaction;
  f.db.runTransaction = callback => { f.versions.set(PATH, 2); return transact(callback); };
  const options = parseArgs(['--semester', SCOPE, '--unit', 'exam_prep', '--round', 'round_1', '--apply']);
  const totals = await runBackfill({ db: f.db, options });
  assert.equal(totals.stale, 1); assert.equal(totals.written, 0); assert.deepEqual(f.writes, []);
});

test('backfill overlaps at most three narrowed source reads and excludes unrelated rounds', async () => {
  const f = memory({});
  for (let index = 0; index < 9; index++) {
    const path = `semester_assessment_results/backfill-${index}`;
    f.data.set(path, raw()); f.versions.set(path, 1);
  }
  f.data.set('semester_assessment_results/other-round', { ...raw(), examRound: 'round_2' });
  const getAll = f.db.getAll; let active = 0, maximum = 0;
  f.db.getAll = async (...refs) => {
    if (!refs.at(-1)?.fieldMask?.includes('questionSnapshots')) return getAll(...refs);
    assert.equal(refs.at(-1).fieldMask.includes('analytics'), false);
    assert.equal(refs.at(-1).fieldMask.includes('reward'), false);
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 1));
    try { return await getAll(...refs); } finally { active--; }
  };
  const options = parseArgs(['--semester', SCOPE, '--unit', 'exam_prep', '--round', 'round_1']);
  const totals = await runBackfill({ db: f.db, options });
  assert.equal(totals.converted, 9); assert.equal(maximum, 3); assert.deepEqual(f.writes, []);
  assert.equal(f.reads.some(read => read.path.endsWith('/other-round')), false);
});

test('compact live changes read current scope plus sidecar and preserve cursors without original bodies', async () => {
  const f = memory(), classId = 'class-a', state = `quiz_class_analysis_state/${SCOPE}`;
  const classState = `${state}/classes/${createHash('sha256').update(classId).digest('hex')}`;
  f.data.set(`semester_classes/${classId}`, { semesterId: SCOPE, status: 'ACTIVE', grade: '3' });
  f.data.set(state, { sequence: 0 }); f.data.set(classState, { sequence: 1 });
  f.data.set(`${classState}/changes/event`, { semesterId: SCOPE, sequence: 1, kind: 'result', source: 'canonical', id: 'result-a',
    scopes: [{ unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1' }] });
  f.data.set(`semester_enrollment_slots/${buildEnrollmentSlotId(SCOPE, 'student-a')}`, { activeEnrollmentId: 'en-a' });
  f.data.set('semester_enrollments/en-a', { semesterId: SCOPE, studentUid: 'student-a', classId, enrollmentStatus: 'ACTIVE' });
  const entry = f.entry();
  f.data.set(projectionRef(f.db, PATH).path, buildAchievementProjection({ sourcePath: PATH, source: 'canonical', sourceVersion: entry.sourceVersion, semesterId: SCOPE, raw: raw() }));
  const reader = createLiveReader({ db: f.db, json: value => value, resultFields: [...SCOPE_FIELDS, 'questionSnapshots'],
    scoreFields: SCOPE_FIELDS, questionFields: [], adaptRecords: rows => rows, buildMockExamScoreRows: async rows => rows });
  const result = await reader.changes({ semesterId: SCOPE, mode: 'changes', liveMode: 'achievement', analysisProjection: 'compact-v1',
    unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', classIds: [classId],
    contextVersion: contextVersion(SCOPE, {}), contentCursor: 0, cursors: [{ classId, cursor: 0 }] });
  assert.equal(result.rawRows.length, 1); assert.equal(result.mockExamScoreRows.length, 1);
  assert.equal(result.rawRows[0].raw.analysisSourceVersion, entry.sourceVersion);
  assert.equal(result.rawRows[0].raw.percent, 0);
  assert.equal(result.live.classes[0].cursor, 1); assert.equal(result.hasMore, false);
  const originals = f.reads.filter(read => read.path === PATH);
  assert.equal(originals.length, 1); assert.deepEqual(originals[0].fields, SCOPE_FIELDS);
  assert.equal(f.reads.filter(read => read.path === projectionRef(f.db, PATH).path).length, 1);
  assert.deepEqual(f.writes, []);
});

test('compact live question updates exclude pictures and explanations from the analysis feed', async () => {
  const f = memory({}), classId = 'class-a', state = `quiz_class_analysis_state/${SCOPE}`;
  const classState = `${state}/classes/${createHash('sha256').update(classId).digest('hex')}`;
  const questionPath = 'years/2026/semesters/2/quiz_questions/q';
  f.data.set(`semester_classes/${classId}`, { semesterId: SCOPE, status: 'ACTIVE', grade: '3' });
  f.data.set(state, { sequence: 1 }); f.data.set(classState, { sequence: 0 });
  f.data.set(`${state}/changes/question`, { semesterId: SCOPE, sequence: 1, kind: 'question', id: 'q', questionIds: ['q'],
    scopes: [{ unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1' }] });
  f.data.set(questionPath, { id: 'q', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
    question: '변경 문항', answer: '가', options: ['가', '나'], image: 'not-for-analysis', explanation: 'not-for-analysis' });
  const fields = ['id', 'unitId', 'category', 'examRound', 'question', 'options'];
  const reader = createLiveReader({ db: f.db, json: value => value, resultFields: [], scoreFields: [], questionFields: fields,
    adaptRecords: rows => rows, buildMockExamScoreRows: async rows => rows });
  const result = await reader.changes({ semesterId: SCOPE, mode: 'changes', liveMode: 'achievement', analysisProjection: 'compact-v1',
    unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', classIds: [classId],
    contextVersion: contextVersion(SCOPE, {}), contentCursor: 0, cursors: [{ classId, cursor: 0 }] });
  assert.equal(result.questionUpserts[0].answer, '가');
  assert.equal(Object.hasOwn(result.questionUpserts[0], 'image'), false);
  assert.equal(Object.hasOwn(result.questionUpserts[0], 'explanation'), false);
  assert.deepEqual(f.reads.find(read => read.path === questionPath).fields, [...fields, 'answer']);
  assert.deepEqual(f.writes, []);
});
