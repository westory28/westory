const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeAchievementMetadata } = require('../historyAchievementMetadata');
const { buildQuizAchievementEvidence, packHistoricalQuestionSnapshots } = require('../quizAchievementEvidence');
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
