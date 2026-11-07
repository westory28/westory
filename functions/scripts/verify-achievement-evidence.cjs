const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeAchievementMetadata } = require('../historyAchievementMetadata');
const { buildQuizAchievementEvidence, packHistoricalQuestionSnapshots, packAchievementEvidence } = require('../quizAchievementEvidence');
const { normalizeProfilePayload, applyProfile, profileId } = require('../achievementProfiles');
const { buildEnrollmentSlotId } = require('../productionGateway/archiveEnrollment');
const rubrics = require('../shared/historyAchievementRubrics.json');
const scope = '2026-2', code = '9역07-01';
const metadata = { curriculumVersion: '2018-162', achievementStandardCodes: [code],
  achievementMappingSource: 'manual', targetAchievementLevel: 'C', intendedDifficulty: 'medium' };
const examRaw = { assessmentKind: 'QUIZ', semesterId: scope, studentUid: 'a', attemptId: 'exam',
  definitionId: 'quiz:2026-2:exam_prep:exam_prep:round_1', sourceId: 'exam_prep', category: 'exam_prep', examRound: 'round_1',
  submittedAtIso: '2026-11-07T02:00:00.000Z', startedAtIso: '2026-11-07T01:00:00.000Z' };
const priorRaw = { assessmentKind: 'QUIZ', semesterId: scope, studentUid: 'a', attemptId: 'prior', category: 'diagnostic',
  sourceId: 'u', submittedAtIso: '2026-11-01T01:00:00.000Z', answers: { 1: 'PRIVATE_ANSWER' },
  answerChecks: [{ id: '1', correct: true }],
  learningSnapshot: [{ id: '1', sourceRevision: '2', unitId: 'u', familyId: 'family', ...metadata }],
  analytics: { questions: { 1: { hintViewed: false, quality: 'complete' } } } };

test('achievement metadata validates the catalog and preserves omitted old-client fields', () => {
  assert.deepEqual(normalizeAchievementMetadata({ concepts: [] }, { strict: true }), {});
  assert.deepEqual(normalizeAchievementMetadata(metadata, { strict: true }), metadata);
  for (const patch of [{ achievementStandardCodes: ['9역99-99'] }, { curriculumVersion: '2022' },
    { achievementStandardCodes: [code, code] }, { targetAchievementLevel: 'F' }, { intendedDifficulty: 'extreme' },
    { achievementMappingSource: 'AI' }, { achievementStandardCodes: undefined }])
    assert.throws(() => normalizeAchievementMetadata({ ...metadata, ...patch }, { strict: true }), e => e.code === 'invalid-argument');
  assert.deepEqual(normalizeAchievementMetadata({ ...metadata, achievementStandardCodes: [] }, { strict: true }).achievementStandardCodes, []);
});

const evidenceInput = () => ({ semesterId: scope, students: [{ uid: 'a' }], questions: [],
  priorRows: [{ id: 'prior', source: 'canonical', raw: structuredClone(priorRaw) }],
  examRows: [{ id: 'exam', source: 'canonical', raw: structuredClone(examRaw) }] });

const unpackEvidence = packed => {
  if (!packed.observationTable) return packed;
  const { observationTable: { version, keys, values, rows }, ...metadata } = packed;
  assert.equal(version, 1);
  return { ...metadata, observations: rows.map(row => Object.fromEntries(row.flatMap((index, position) =>
    index === -1 ? [] : [[keys[position], values[index]]]))) };
};

test('compact evidence preserves own fields, nested JSON values and missing/unknown/false distinctions', () => {
  const observations = Array.from({ length: 180 }, (_, index) => ({
    id: `synthetic-observation-${index}`, studentUid: `synthetic-${index % 6}`, semesterId: scope,
    source: 'diagnostic', correct: index % 3 ? true : false, hintViewed: index % 2 ? null : false,
    achievementStandardCodes: ['9역07-01', '9역07-02'], metadata: { nested: ['값', 0, false, null], source: 'snapshot' },
    ...(index % 4 ? { optional: '' } : {}), number: index % 2 ? 1 : '1',
  }));
  const evidence = { version: 1, status: 'partial', observations, examCutoffs: [{ studentUid: 'synthetic-0', startedAt: '2026-11-07T01:00:00Z' }], exclusions: { missingSourceRevision: 2 } };
  const original = structuredClone(evidence), packed = packAchievementEvidence(evidence);
  assert.ok(packed.observationTable);
  assert.equal(Object.hasOwn(packed, 'observations'), false);
  assert.ok(packed.observationTable.rows.some(row => row.includes(-1)));
  assert.deepEqual(unpackEvidence(JSON.parse(JSON.stringify(packed))), evidence);
  assert.deepEqual(evidence, original, 'packing never mutates the analysis evidence');
  assert.ok(packed.observationTable.values.some(value => value === false));
  assert.ok(packed.observationTable.values.some(value => value === null));
  assert.ok(packed.observationTable.values.some(value => value === 1));
  assert.ok(packed.observationTable.values.some(value => value === '1'));
});

test('compact evidence keeps the original shape when a dictionary is not smaller', () => {
  for (const observations of [[], [{ id: 'one' }]]) {
    const evidence = { version: 1, status: 'ready', observations, examCutoffs: [], exclusions: {} };
    assert.equal(packAchievementEvidence(evidence), evidence);
  }
  const unsupported = { observations: [{ presentButUndefined: undefined }] };
  assert.equal(packAchievementEvidence(unsupported), unsupported);
});

test('a 316-pupil grade with 27,899 worksheet observations fits the unchanged 8 MiB response bound losslessly', (context) => {
  const students = Array.from({ length: 316 }, (_, index) => ({ uid: `synthetic-student-${String(index).padStart(11, '0')}`,
    classId: `class-${Math.floor(index / 32)}`, name: `합성 학생 ${index + 1}`, number: String(index % 32 + 1) }));
  const lessons = [88, 1].map((count, index) => ({ unitId: `synthetic-lesson-unit-${index}`, contentRevision: 9,
    contentHtml: Array.from({ length: count }, (_, item) => `[합성 정답 ${item}]`).join(' '), ...metadata }));
  const progressRows = students.flatMap((student, index) => lessons.slice(0, index < 91 ? 2 : 1).map((lesson, lessonIndex) => ({
    id: lesson.unitId, studentUid: student.uid, raw: { studentUid: student.uid, semesterId: scope, contentRevision: 9,
      updatedAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
      answers: Object.fromEntries(Array.from({ length: lessonIndex ? 1 : 88 }, (_, item) => [String(item),
        { value: item % 3 ? '합성 입력' : '', status: item % 2 ? 'correct' : 'wrong' }])) } })));
  const evidence = buildQuizAchievementEvidence({ semesterId: scope, students, questions: [], priorRows: [], examRows: [], lessons, progressRows });
  assert.equal(evidence.observations.length, 27899);
  const originalBytes = Buffer.byteLength(JSON.stringify(evidence));
  assert.ok(originalBytes > 8 * 1024 * 1024, 'the regression fixture exceeds the old response limit');
  const packed = packAchievementEvidence(evidence);
  assert.ok(packed.observationTable);
  const response = { semesterId: scope, grade: '3', students, rawRows: [], questions: [{ id: '91', question: '합성 모의 문항' }],
    complete: true, achievementEvidence: packed, configuredClasses: [], generatedAt: '2026-11-07T01:00:00Z', version: 'synthetic' };
  const packedBytes = Buffer.byteLength(JSON.stringify(response));
  assert.ok(packedBytes < 8 * 1024 * 1024, `packed grade response: ${packedBytes} bytes`);
  assert.ok(packedBytes < originalBytes / 2);
  assert.deepEqual(unpackEvidence(JSON.parse(JSON.stringify(packed))), evidence);
  context.diagnostic(`Synthetic grade transport: ${originalBytes} bytes of evidence -> ${packedBytes} bytes for the complete response; 316 pupils, 27899 observations retained.`);
});
test('evidence keeps snapshot metadata, exact onset and unknown assistance distinct from false', () => {
  const input = evidenceInput();
  const result = buildQuizAchievementEvidence(input);
  assert.equal(result.status, 'ready'); assert.equal(result.examCutoffs[0].startedAt, examRaw.startedAtIso);
  assert.equal(result.observations[0].hintViewed, false); assert.equal(result.observations[0].resultId, 'prior');
  assert.equal(JSON.stringify(result).includes('PRIVATE_ANSWER'), false);
  delete input.priorRows[0].raw.analytics;
  assert.equal(buildQuizAchievementEvidence(input).observations[0].hintViewed, null);
  assert.equal(buildQuizAchievementEvidence(input).status, 'partial');
});
test('historical result joins only its own complete attempt; missing version is not invented', () => {
  const input = evidenceInput(); delete input.examRows[0].raw.startedAtIso;
  input.attempts = [{ id: 'exam', raw: { ...examRaw, resultRef: 'semester_assessment_results/exam' } }];
  assert.equal(buildQuizAchievementEvidence(input).examCutoffs[0].source, 'attempt');
  input.attempts[0].raw.studentUid = 'b';
  assert.equal(buildQuizAchievementEvidence(input).examCutoffs.length, 0);
  delete input.priorRows[0].raw.learningSnapshot[0].sourceRevision;
  assert.equal(buildQuizAchievementEvidence(input).observations.length, 0);
});
test('worksheet preserves blank/incorrect distinction, rejects changed content, and never claims independent mastery', () => {
  const input = evidenceInput();
  input.lessons = [{ unitId: 'u', contentRevision: 2, contentHtml: '[가] [나] [다]' }];
  input.progressRows = [{ id: 'u', studentUid: 'a', raw: { unitId: 'u', contentRevision: 2,
    updatedAt: '2026-11-01T02:00:00.000Z', completed: true,
    answers: { 0: { value: '', status: 'wrong' }, 1: { value: 'wrong', status: 'wrong' }, 2: { value: 'correct', status: 'correct' } } } }];
  const rows = buildQuizAchievementEvidence(input).observations.filter(row => row.source === 'worksheet');
  assert.deepEqual(rows.map(row => [row.filled, row.correct, row.hintViewed]), [[false, false, null], [true, false, null], [true, true, null]]);
  input.progressRows[0].raw.contentRevision = 1;
  assert.equal(buildQuizAchievementEvidence(input).exclusions.worksheetRevisionMismatch, 1);
});
test('canonical duplicate legacy evidence and other pupils are excluded', () => {
  const input = evidenceInput();
  input.priorRows.push({ id: 'dup', source: 'legacy', raw: { ...priorRaw, canonicalAttemptId: 'prior', details: [{ id: '1', correct: false, sourceRevision: '2' }] } },
    { id: 'other', source: 'canonical', raw: { ...priorRaw, studentUid: 'b' } });
  const result = buildQuizAchievementEvidence(input);
  assert.equal(result.observations.length, 1); assert.equal(result.exclusions.duplicateLegacyResult, 1);
});

test('pre-revision canonical evidence recovers only a hashed immutable presentation, never current bank text', () => {
  const input = evidenceInput(), raw = input.priorRows[0].raw;
  raw.learningSnapshot[0].sourceRevision = 'legacy'; raw.sourceHash = 'a'.repeat(64);
  raw.questionSnapshots = [{ id: '1', type: 'choice', question: '당시 문항', answer: '당시 정답', options: ['당시 정답', '오답'], unitId: 'u' }];
  input.questions = [{ id: '1', contentRevision: 99, question: '지금 다른 문항', answer: '다른 정답' }];
  const result = buildQuizAchievementEvidence(input);
  assert.match(result.observations[0].sourceRevision, /^snapshot:[a-f0-9]{64}$/);
  assert.equal(result.observations[0].quality, 'limited');
  const version = result.observations[0].sourceRevision;
  input.questions[0].question = '또 바꾼 문항';
  assert.equal(buildQuizAchievementEvidence(input).observations[0].sourceRevision, version);
  delete raw.questionSnapshots[0].answer;
  assert.equal(buildQuizAchievementEvidence(input).observations.length, 0);
});

test('historical popup sources deduplicate losslessly without changing answers or omitting media', () => {
  const snapshot = { id: '1', type: 'choice', question: '원문', passage: '제시문', explanation: '해설',
    image: 'data:image/png;base64,' + 'x'.repeat(5000), options: ['가', '나'], answer: '가',
    passageSet: { id: 'set', passage: '공통 지문', image: 'set-image' }, choiceOptionImages: ['first-image', null] };
  const rows = ['a', 'b'].map(uid => ({ id: uid, source: 'canonical', raw: { studentUid: uid,
    answers: { 1: uid === 'a' ? '가' : '나' }, questionSnapshots: [structuredClone(snapshot)], questionSnapshotOmittedIds: ['2'] } }));
  const packed = packHistoricalQuestionSnapshots(rows);
  assert.equal(Object.keys(packed.historicalQuestionSnapshots).length, 1);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(rows).length);
  packed.rawRows.forEach((row, index) => {
    assert.deepEqual(row.raw.questionSnapshotRefs.map(hash => packed.historicalQuestionSnapshots[hash]), rows[index].raw.questionSnapshots);
    assert.deepEqual(row.raw.answers, rows[index].raw.answers);
    assert.deepEqual(row.raw.questionSnapshotOmittedIds, ['2']);
  });
  assert.ok(rows[0].raw.questionSnapshots[0].image);
});

const payload = () => normalizeProfilePayload({ semesterId: scope, classId: 'class', unitId: 'exam_prep', examRound: 'round_1',
  studentUid: 'a', standardCode: code, level: 'C', expectedRevision: 0, examAttemptId: 'exam',
  expectedRubricVersion: rubrics.version,
  mappingConfirmed: true, evidenceRefs: [{ resultId: 'prior', questionId: '1' }] });
function profileFixture() {
  const data = new Map(Object.entries({
    'site_settings/semester_active': { semesterId: scope, revision: 1 },
    [`semester_manifests/${scope}`]: { semesterId: scope, status: 'ACTIVE', revision: 1 },
    'semester_classes/class': { semesterId: scope, status: 'ACTIVE' },
    [`semester_enrollment_slots/${buildEnrollmentSlotId(scope, 'a')}`]: { semesterId: scope, studentUid: 'a', activeEnrollmentId: 'en', status: 'ACTIVE' },
    'semester_enrollments/en': { semesterId: scope, studentUid: 'a', classId: 'class', enrollmentStatus: 'ACTIVE' },
    'semester_assessment_attempts/exam': { ...examRaw, resultRef: 'semester_assessment_results/exam' },
    'semester_assessment_results/exam': structuredClone(examRaw),
    'semester_assessment_results/prior': structuredClone(priorRaw),
  }));
  const writes = [];
  const get = async path => ({ path, exists: data.has(path), data: structuredClone(data.get(path)) });
  const transaction = { get, getAll: paths => Promise.all(paths.map(get)),
    query: async (path, filter) => Promise.all([...data.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')
      && data.get(key)[filter.field] === filter.value).map(get)),
    set: (path, value) => { data.set(path, value); writes.push(path); } };
  const run = (p = payload(), actor = { actorUid: 'teacher', actorRole: 'teacher' }) =>
    applyProfile({ transaction, payload: p, actor, timestamp: '2026-11-08T01:00:00.000Z' });
  return { data, writes, run };
}
test('teacher review persists only the analysis profile, uses historical cutoff and supports CAS clearing', async () => {
  const f = profileFixture(), result = await f.run();
  assert.equal(result.result.level, 'C'); assert.equal(result.result.asOf, examRaw.startedAtIso);
  assert.equal(result.result.rubricVersion, rubrics.version);
  assert.ok(result.result.reviewedAt > result.result.asOf);
  assert.deepEqual(f.writes, [`semester_achievement_profiles/${profileId(payload())}`]);
  await assert.rejects(f.run(), e => e.code === 'aborted');
  await f.run(normalizeProfilePayload({ ...payload(), level: null, expectedRevision: 1 }));
  assert.equal(f.data.get(f.writes[0]).level, null);
});
test('student, staff, wrong scope, foreign/future evidence and incompatible standard cannot confirm A–E', async () => {
  for (const role of ['student', 'staff']) await assert.rejects(profileFixture().run(payload(), { actorUid: role, actorRole: role }), e => e.code === 'permission-denied');
  for (const mutate of [
    f => { f.data.get('semester_enrollments/en').classId = 'other'; },
    f => { f.data.get(`semester_manifests/${scope}`).readOnly = true; },
    f => { f.data.get('semester_assessment_results/prior').studentUid = 'b'; },
    f => { f.data.get('semester_assessment_results/prior').submittedAtIso = examRaw.startedAtIso; },
    f => { f.data.get('semester_assessment_results/prior').learningSnapshot[0].achievementStandardCodes = ['9역07-02']; },
    f => { f.data.get('semester_assessment_attempts/exam').startedAtIso = ''; },
  ]) { const f = profileFixture(); mutate(f); await assert.rejects(f.run(), e => e.code === 'failed-precondition'); assert.equal(f.writes.length, 0); }
});
test('untagged historical mapping requires explicit teacher confirmation and is labelled as such', async () => {
  assert.throws(() => normalizeProfilePayload({ ...payload(), mappingConfirmed: false }));
  const f = profileFixture(); delete f.data.get('semester_assessment_results/prior').learningSnapshot[0].achievementStandardCodes;
  assert.equal((await f.run()).result.evidence[0].mappingBasis, 'teacher-confirmed');
});

test('a teacher cannot unknowingly confirm against a changed rubric version', async () => {
  assert.throws(() => normalizeProfilePayload({ ...payload(), expectedRubricVersion: 'older-rubric' }),
    e => e.details?.reason === 'ACHIEVEMENT_PROFILE_RUBRIC_CHANGED');
  const f = profileFixture();
  await assert.rejects(f.run({ ...payload(), expectedRubricVersion: 'older-rubric' }), e => e.code === 'failed-precondition');
  assert.equal(f.writes.length, 0);
});

test('old canonical first-round identity remains usable without rewriting its result', async () => {
  const f = profileFixture();
  for (const path of ['semester_assessment_attempts/exam', 'semester_assessment_results/exam']) {
    const row = f.data.get(path); delete row.examRound; row.definitionId = 'quiz:2026-2:exam_prep:exam_prep';
  }
  assert.equal((await f.run()).result.examRound, 'round_1');
  assert.equal(f.data.get('semester_assessment_results/exam').examRound, undefined);
});
