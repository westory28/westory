const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createQuizReviewNoteHandler, noteId, gradePractice } = require('../studentQuizReviewNotes');
const { createStudentQuizHistoryHandler } = require('../studentQuizHistory');
const semesterId = '2026-2', uid = 'synthetic-review-student', key = 'canonical:result-one';
const base = () => ({ semesterId, key, questionId: '1', practiceAnswer: '고려', reason: '개념이 헷갈렸어요',
  note: '자료의 근거를 다시 확인했습니다.', expectedRevision: 0, saveId: 'synthetic-save-id-0001' });
function fixture() {
  const data = new Map(Object.entries({
    [`users/${uid}`]: { role: 'student', registrationApprovalStatus: 'APPROVED' },
    'site_settings/semester_active': { semesterId, revision: 1 },
    [`semester_manifests/${semesterId}`]: { semesterId, status: 'ACTIVE', revision: 1 },
    'semester_assessment_results/result-one': { studentUid: uid, semesterId, assessmentKind: 'QUIZ', attemptId: 'result-one',
      submittedAtIso: '2026-11-07T01:00:00Z', category: 'formative', score: 1, total: 2, percent: 50,
      answers: { 1: '신라', 2: '고려' }, answerChecks: [{ id: '1', correct: false }, { id: '2', correct: true }],
      questionSnapshots: [{ id: '1', question: '합성 문항', type: 'choice', answer: '고려', options: ['고려', '신라'] }] },
  }));
  const reads = [], writes = [];
  const snapshot = path => ({ exists: data.has(path), data: () => data.get(path) });
  const doc = path => ({ path, get: async () => { reads.push(path); return snapshot(path); } });
  const db = { doc, getAll: (...refs) => Promise.all(refs.map(ref => ref.get())),
    runTransaction: async fn => {
      const staged = [];
      const result = await fn({ getAll: (...refs) => db.getAll(...refs), set: (ref, value) => staged.push([ref.path, value]) });
      for (const [path, value] of staged) { data.set(path, value); writes.push(path); }
      return result;
    } };
  let allowed = true;
  const assertSession = async request => { if (!allowed) throw new Error('Synthetic revoked session'); return { uid: request.auth.uid }; };
  const save = createQuizReviewNoteHandler({ db, assertSession, now: () => new Date('2026-11-08T01:00:00Z') });
  const history = createStudentQuizHistoryHandler({ db, assertSession });
  return { data, reads, writes, request: (patch = {}, actor = uid) => save({ auth: { uid: actor }, data: { ...base(), ...patch } }),
    detail: (recordKey = key, actor = uid) => history({ auth: { uid: actor }, data: { semesterId, key: recordKey, mode: 'detail' } }),
    revoke: () => { allowed = false; } };
}

test('explicit save and history detail retain notes and server grading without mutating original results', async () => {
  const f = fixture(), original = structuredClone(f.data.get('semester_assessment_results/result-one'));
  assert.deepEqual((await f.detail()).reviewNotes, { revision: 0, items: [], updatedAt: '' });
  const saved = await f.request();
  assert.equal(saved.reviewNotes.revision, 1);
  assert.equal(saved.reviewNotes.items[0].correct, true);
  assert.equal(saved.reviewNotes.items[0].note, base().note);
  assert.deepEqual((await f.detail()).reviewNotes, saved.reviewNotes);
  assert.deepEqual(f.data.get('semester_assessment_results/result-one'), original);
  assert.deepEqual(f.writes, [`semester_quiz_review_notes/${noteId(semesterId, uid, key)}`]);
  const replay = await f.request();
  assert.equal(replay.replayed, true); assert.equal(replay.reviewNotes.revision, 1); assert.equal(f.writes.length, 1);
  await assert.rejects(f.request({ note: '다른 내용' }), error => error.details.reason === 'QUIZ_REVIEW_SAVE_ID_REUSED');
  await assert.rejects(f.request({ saveId: 'synthetic-save-id-0002' }), error => error.code === 'aborted');
  const draft = await f.request({ saveId: 'synthetic-save-id-0002', expectedRevision: 1, practiceAnswer: '' });
  assert.equal(draft.reviewNotes.revision, 2); assert.equal(draft.reviewNotes.items[0].correct, null);
});

test('save rejects other owners, correct/unassigned questions, active attempts, unavailable snapshots and inactive terms', async () => {
  for (const [change, reason] of [
    [f => f.data.get('semester_assessment_results/result-one').studentUid = 'other', 'QUIZ_REVIEW_RESULT_NOT_FOUND'],
    [f => f.data.get('semester_assessment_results/result-one').status = 'IN_PROGRESS', 'QUIZ_REVIEW_RESULT_NOT_FOUND'],
    [f => delete f.data.get('semester_assessment_results/result-one').submittedAtIso, 'QUIZ_REVIEW_RESULT_NOT_FOUND'],
    [f => delete f.data.get('semester_assessment_results/result-one').questionSnapshots, 'QUIZ_REVIEW_SOURCE_UNAVAILABLE'],
    [f => f.data.get(`semester_manifests/${semesterId}`).status = 'ARCHIVED', 'QUIZ_REVIEW_SEMESTER_INACTIVE'],
    [f => f.data.get(`users/${uid}`).role = 'teacher', 'QUIZ_REVIEW_STUDENT_REQUIRED'],
    [f => f.data.get(`users/${uid}`).registrationApprovalStatus = 'PENDING', 'QUIZ_REVIEW_STUDENT_REQUIRED'],
    [f => f.data.get(`users/${uid}`).weplayDeletionPending = true, 'QUIZ_REVIEW_STUDENT_REQUIRED'],
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(f.request(), error => error.details.reason === reason);
    assert.deepEqual(f.writes, []);
  }
  for (const questionId of ['2', '999']) await assert.rejects(fixture().request({ questionId }), error => error.details.reason === 'QUIZ_REVIEW_QUESTION_INVALID');
  const f = fixture(); f.revoke(); await assert.rejects(f.request(), /revoked/); assert.deepEqual(f.writes, []);
});

test('legacy notes need an owned submitted original and remain separate from a same-id canonical result', async () => {
  const f = fixture();
  f.data.set('years/2026/semesters/2/quiz_results/result-one', { uid, category: 'formative', timestamp: '2026-11-07T01:00:00Z',
    details: [{ id: '1', correct: false, questionSnapshot: { id: '1', question: '합성 단답', type: 'short', answer: '고려' } }] });
  await f.request();
  const legacy = await f.request({ key: 'legacy:result-one', note: '과거 기록의 노트' });
  assert.equal(legacy.reviewNotes.revision, 1);
  assert.equal((await f.detail('legacy:result-one')).reviewNotes.items[0].note, '과거 기록의 노트');
  assert.equal((await f.detail()).reviewNotes.items[0].note, base().note);
  f.data.set('years/2026/semesters/2/quiz_results/flat', { uid, category: 'diagnostic', timestamp: '2026-11-07T01:00:00Z',
    details: [{ id: '1', correct: false, q: '보관된 합성 문항', a: 1392, type: 'short', u: '1391', exp: '보관된 해설',
      questionSnapshot: { question: '후순위 필드', answer: '1391' } }] });
  const flat = await f.request({ key: 'legacy:flat', practiceAnswer: '1392' });
  assert.equal(flat.reviewNotes.items[0].correct, true);
  assert.equal((await f.detail('legacy:flat')).reviewNotes.revision, 1);
  f.data.set(`users/other`, { role: 'student' });
  await assert.rejects(f.detail(key, 'other'), error => error.code === 'not-found');
  await assert.rejects(f.request({}, 'other'), error => error.code === 'not-found');
});

test('practice grading enforces frozen answer formats and preserves the assessment whitespace normalization', () => {
  const question = (type, answer, extra = {}) => ({ type, answer, ...extra });
  assert.equal(gradePractice(question('short', '고려'), '고 려'), true);
  assert.equal(gradePractice(question('short', '고려'), ''), null);
  assert.throws(() => gradePractice(question('short', '고려'), '가'.repeat(21)), error => error.code === 'invalid-argument');
  assert.throws(() => gradePractice(question('choice', '고려', { options: ['고려', '신라'] }), '발해'), error => error.code === 'invalid-argument');
  assert.equal(gradePractice(question('order', '나||가', { options: ['가', '나'] }), '가||나'), false);
  assert.equal(gradePractice(question('order', '나||가', { options: ['가', '나'] }), '가'), null);
  assert.throws(() => gradePractice(question('order', '나||가', { options: ['가', '나'] }), '가||가'), error => error.code === 'invalid-argument');
  assert.equal(gradePractice(question('matching', '가=>1||나=>2'), '가=>1||나=>1'), false);
  assert.equal(gradePractice(question('matching', '가=>1||나=>2'), '나=>2'), null);
  assert.throws(() => gradePractice(question('matching', '가=>1||나=>2'), '나=>2||가=>1'), error => error.code === 'invalid-argument');
  assert.throws(() => gradePractice(question('matching', '가=>1||나=>2'), '가=>1||가=>2'), error => error.code === 'invalid-argument');
  assert.throws(() => gradePractice(question('matching', '가=>1||나=>2'), '가=>1||다=>2'), error => error.code === 'invalid-argument');
  assert.throws(() => gradePractice(question('ox', 'O'), 'Y'), error => error.code === 'invalid-argument');
});

test('short and word practice accept each frozen alias without splitting student answers or choice combinations', () => {
  for (const type of ['short', 'word']) {
    const question = { type, answer: ' , 명, , 명나라, ' };
    for (const answer of ['명', '명나라', '명 나 라']) assert.equal(gradePractice(question, answer), true);
    for (const answer of ['청', '명, 명나라', ',']) assert.equal(gradePractice(question, answer), false);
    assert.equal(gradePractice(question, ''), null);
    assert.equal(gradePractice({ type, answer: ', ,' }, '명'), false);
    assert.equal(gradePractice({ type, answer: `${'가'.repeat(20)}, ${'나'.repeat(20)}` }, '나'.repeat(20)), true);
    assert.throws(() => gradePractice(question, '나'.repeat(21)), error => error.code === 'invalid-argument');
  }
  const choice = { type: 'choice', answer: 'ㄱ, ㄴ', options: ['ㄱ', 'ㄴ', 'ㄱ, ㄴ'] };
  assert.equal(gradePractice(choice, 'ㄱ, ㄴ'), true);
  assert.equal(gradePractice(choice, 'ㄱ'), false);
});

test('alias practice saves and rereads server grades while retaining the original submitted result', async () => {
  for (const type of ['short', 'word']) {
    const f = fixture();
    const result = f.data.get('semester_assessment_results/result-one');
    result.category = 'exam_prep';
    result.examRound = 'round_1';
    result.questionSnapshots[0] = { id: '1', question: '합성 허용 답안 문항', type, answer: '명, 명나라' };
    const original = structuredClone(result);
    let revision = 0;
    for (const [index, answer] of ['명', '명 나라', '명, 명나라'].entries()) {
      const saved = await f.request({ practiceAnswer: answer, expectedRevision: revision,
        saveId: `synthetic-alias-${type}-${index}` });
      revision = saved.reviewNotes.revision;
      assert.equal(saved.reviewNotes.items[0].correct, index !== 2);
      assert.equal(saved.reviewNotes.items[0].practiceAnswer, answer);
      assert.deepEqual((await f.detail()).reviewNotes, saved.reviewNotes);
      assert.deepEqual(f.data.get('semester_assessment_results/result-one'), original);
    }
    assert.equal(revision, 3);
    assert.ok(f.writes.every(path => path === `semester_quiz_review_notes/${noteId(semesterId, uid, key)}`));
  }
});

test('new and previously saved reflection reasons round-trip without changing the submitted assessment', async () => {
  const f = fixture();
  const original = structuredClone(f.data.get('semester_assessment_results/result-one'));
  const reasons = ['', '개념이 헷갈렸어요', '자료의 근거를 놓쳤어요', '답을 잘못 입력했어요',
    '몰랐어요', '잘못 읽었어요', '찍었어요', '실수했어요'];
  for (const [index, reason] of reasons.entries()) {
    const saved = await f.request({ reason, practiceAnswer: '', expectedRevision: index,
      saveId: `synthetic-reason-save-${index}` });
    assert.equal(saved.reviewNotes.items[0].reason, reason);
    assert.equal(saved.reviewNotes.items[0].correct, null);
    assert.deepEqual((await f.detail()).reviewNotes, saved.reviewNotes);
    assert.deepEqual(f.data.get('semester_assessment_results/result-one'), original);
  }
  assert.ok(f.writes.every(path => path === `semester_quiz_review_notes/${noteId(semesterId, uid, key)}`));
});

test('untrusted fields, oversized text and reused foreign scope are rejected before writes', async () => {
  for (const patch of [{ uid: 'other' }, { note: '가'.repeat(1001) }, { reason: 'arbitrary' }, { practiceAnswer: 'x'.repeat(12001) },
    { key: 'canonical:../forged' }, { expectedRevision: -1 }, { note: '\u0000' }]) {
    const f = fixture(); await assert.rejects(f.request(patch), error => error.code === 'invalid-argument'); assert.deepEqual(f.writes, []);
  }
});
