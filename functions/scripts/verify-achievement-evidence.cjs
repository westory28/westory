const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeAchievementMetadata } = require('../historyAchievementMetadata');
const { historicalQuestionEvidence, packHistoricalQuestionSnapshots, createHistoricalQuestionSnapshotPool } = require('../quizAchievementEvidence');
const { normalizeProfilePayload, applyProfile } = require('../achievementProfiles');
const code = '9역07-01';
const metadata = { curriculumVersion: '2018-162', achievementStandardCodes: [code],
  achievementMappingSource: 'manual', targetAchievementLevel: 'C', intendedDifficulty: 'medium' };

test('achievement metadata validates the catalog and preserves omitted old-client fields', () => {
  assert.deepEqual(normalizeAchievementMetadata({ concepts: [] }, { strict: true }), {});
  assert.deepEqual(normalizeAchievementMetadata(metadata, { strict: true }), metadata);
  for (const patch of [{ achievementStandardCodes: ['9역99-99'] }, { curriculumVersion: '2022' },
    { achievementStandardCodes: [code, code] }, { targetAchievementLevel: 'F' }, { intendedDifficulty: 'extreme' },
    { achievementMappingSource: 'AI' }, { achievementStandardCodes: undefined }])
    assert.throws(() => normalizeAchievementMetadata({ ...metadata, ...patch }, { strict: true }), e => e.code === 'invalid-argument');
  assert.deepEqual(normalizeAchievementMetadata({ ...metadata, achievementStandardCodes: [] }, { strict: true }).achievementStandardCodes, []);
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

test('retired diagnostic/formative profile command rejects before any reads or writes', () => {
  const transaction = new Proxy({}, { get() { throw new Error('Retired profile touched the database'); } });
  for (const invoke of [() => normalizeProfilePayload({}), () => applyProfile({ transaction, payload: {} })])
    assert.throws(invoke, error => error.code === 'failed-precondition' && error.details.reason === 'ACHIEVEMENT_PROFILE_RETIRED');
});

test('historical mock metadata remains bound to frozen presentation, never current bank text', () => {
  const raw = { sourceHash: 'a'.repeat(64), learningSnapshot: [{ id: '1', sourceRevision: 'legacy' }],
    questionSnapshots: [{ id: '1', type: 'choice', question: '당시 문항', answer: '당시 정답' }] };
  const result = historicalQuestionEvidence(raw, '1');
  assert.match(result.sourceRevision, /^snapshot:[a-f0-9]{64}$/);
  assert.equal(result.revisionBasis, 'frozen-snapshot');
  delete raw.questionSnapshots[0].answer;
  assert.equal(historicalQuestionEvidence(raw, '1'), null);
});

test('snapshot interning preserves complete content, row order and omissions despite identical source hashes', () => {
  const hashes = new WeakMap(), pool = createHistoricalQuestionSnapshotPool(hashes);
  const original = { id: '1', type: 'choice', question: '당시 발문', answer: '가', options: ['가', '나'],
    image: 'first-image', points: 3, targetAchievementLevel: 'A', intendedDifficulty: 'hard' };
  const changed = { ...original, question: '다른 발문', image: 'second-image', targetAchievementLevel: 'E', intendedDifficulty: 'easy' };
  const rows = [original, changed, original].map((snapshot, index) => ({ id: String(index), source: 'canonical',
    raw: { sourceHash: 'a'.repeat(64), answers: { 1: index ? '나' : '가' }, questionSnapshotOmittedIds: ['2'],
      questionSnapshots: [structuredClone(snapshot)] } }));
  const retained = rows.map(row => ({ ...row, raw: pool.intern(row.raw).raw }));
  assert.equal(retained[0].raw.questionSnapshots[0], retained[2].raw.questionSnapshots[0]);
  assert.notEqual(retained[0].raw.questionSnapshots[0], retained[1].raw.questionSnapshots[0]);
  const packed = packHistoricalQuestionSnapshots(retained, hashes);
  assert.equal(Object.keys(packed.historicalQuestionSnapshots).length, 2);
  for (let index = 0; index < rows.length; index++) {
    assert.deepEqual(packed.rawRows[index].raw.questionSnapshotRefs.map(ref => packed.historicalQuestionSnapshots[ref]), rows[index].raw.questionSnapshots);
    assert.deepEqual(packed.rawRows[index].raw.questionSnapshotOmittedIds, ['2']);
    assert.deepEqual(packed.rawRows[index].raw.answers, rows[index].raw.answers);
    assert.equal(historicalQuestionEvidence(retained[index].raw, '1', hashes).sourceRevision,
      historicalQuestionEvidence(rows[index].raw, '1').sourceRevision);
  }
});
