const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { createStudentQuizHistoryHandler, normalizeRows, canonicalDetail, FIELDS } = require('../studentQuizHistory');
const uid = 'synthetic-student', semesterId = '2026-2';
const source = (id, extra = {}, kind = 'canonical') => ({ id, source: kind, raw: {
  studentUid: uid, uid, semesterId, assessmentKind: 'QUIZ', sourceId: 'unit-a',
  category: 'formative', definitionId: `quiz:${semesterId}:unit-a:formative`,
  attemptId: id, percent: 50, score: 1, total: 2, answerChecks: [{ id: '1', correct: true }, { id: '2', correct: false }],
  submittedAtIso: '2026-10-25T10:00:00Z', ...extra,
} });
function fixture() {
  const values = new Map([
    [`users/${uid}`, { role: 'student' }], ['semester_manifests/2026-2', { status: 'ACTIVE' }],
    ['years/2026/semesters/2/curriculum/tree', { tree: [{ id: 'unit-a', title: '사림 세력과 정치 변화' }] }],
  ]), reads = [], queries = [], writes = [];
  const snap = path => ({ id: path.split('/').at(-1), exists: values.has(path), data: () => values.get(path) });
  const doc = path => ({ path, get: async () => { reads.push(path); return snap(path); },
    set: async value => { values.set(path, value); writes.push(path); } });
  const collection = path => {
    const filters = []; let selected = [], maximum = Infinity;
    const query = { where(field, op, value) { filters.push([field, op, value]); return query; },
      select(...fields) { selected = fields; return query; }, limit(n) { maximum = n; return query; },
      async get() {
        queries.push({ path, filters, selected });
        const docs = [...values.entries()].filter(([key, value]) => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1
          && filters.every(([field, , expected]) => value[field] === expected)).slice(0, maximum)
          .map(([key, value]) => ({ id: key.split('/').at(-1), data: () => Object.fromEntries(selected.filter(f => f in value).map(f => [f, value[f]])) }));
        return { docs, size: docs.length };
      } };
    return query;
  };
  let sessionCalls = 0, sessionAllowed = true;
  const handler = createStudentQuizHistoryHandler({ db: { doc, collection, getAll: (...refs) => Promise.all(refs.map(r => r.get())) }, now: () => 100000,
    assertSession: async (request, options) => { sessionCalls++; assert.deepEqual(options, { recentAuth: false, highRisk: false });
      if (!sessionAllowed) throw new Error('revoked'); return { uid: request.auth.uid }; } });
  const request = data => handler({ auth: { uid }, data: { semesterId, mode: 'list', ...data } });
  return { values, queries, reads, writes, request, revoke() { sessionAllowed = false; }, get sessionCalls() { return sessionCalls; } };
}

test('normalization preserves 0, unknown scores, owner/term isolation and canonical mirror identity', () => {
  const rows = normalizeRows([source('a', { percent: 0 }), source('b', { percent: null }), source('other', { studentUid: 'other' }),
    source('term', { semesterId: '2025-2' }), source('history', { assessmentKind: 'HISTORY_CLASSROOM' }),
    source('mirror', { canonicalAttemptId: 'a', score: 100 }, 'legacy')], uid, semesterId);
  assert.equal(rows.length, 2); assert.equal(rows.find(r => r.id === 'a').score, 0); assert.equal(rows.find(r => r.id === 'b').score, null);
});

test('weighted paper history keeps authoritative percent and frozen paper points', () => {
  const paper = source('paper', { category: 'exam_prep', sourceId: 'exam_prep', examRound: 'round_1',
    percent: 30, earnedPoints: 30, maxPoints: 100,
    questionSnapshots: [{ id: '1', question: '원래 문항', answer: '고려', examRound: 'round_1', paperOrder: 1, points: 30 }] });
  const row = normalizeRows([paper], uid, semesterId)[0];
  assert.equal(row.score, 30); assert.equal(row.totalCount, 2); assert.equal(row.wrongCount, 1);
  const detail = canonicalDetail('paper', paper.raw, { 1: '고려' });
  assert.equal(detail.score, 30); assert.equal(detail.earnedPoints, 30); assert.equal(detail.maxPoints, 100);
  assert.equal(detail.details[0].questionSnapshot.points, 30);
});
test('only selected owner metadata is read; 20 item paging reuses cache and rechecks session', async () => {
  const f = fixture();
  for (let n = 0; n < 25; n++) f.values.set(`semester_assessment_results/${n}`, source(String(n)).raw);
  f.values.set('semester_assessment_results/private-other', source('other', { studentUid: 'other', questionSnapshots: ['secret'] }).raw);
  const first = await f.request({});
  assert.equal(first.rows.length, 20); assert.equal(first.totalCount, 25); assert.ok(first.nextCursor);
  assert.ok(!FIELDS.includes('questionSnapshots') && !FIELDS.includes('answers') && !FIELDS.includes('details'));
  assert.ok(f.queries.every(q => q.filters.some(([field, , value]) => ['studentUid', 'uid'].includes(field) && value === uid)));
  const count = f.queries.length;
  const second = await f.request({ cursor: first.nextCursor });
  assert.equal(second.rows.length, 5); assert.equal(second.nextCursor, null); assert.equal(f.queries.length, count);
  assert.equal(f.sessionCalls, 2);
  f.revoke(); await assert.rejects(f.request({}), /revoked/);
});
test('submission revision invalidates history and stale cursor; force refresh is explicit', async () => {
  const f = fixture(); f.values.set('semester_assessment_results/a', source('a').raw);
  const first = await f.request({});
  const id = createHash('sha256').update(`${semesterId}\n${uid}`).digest('hex');
  f.values.set(`quiz_analysis_student_revisions/${id}`, { generation: 'new' });
  f.values.set('semester_assessment_results/b', source('b').raw);
  await assert.rejects(f.request({ cursor: `${first.version}:0` }), e => e.code === 'aborted');
  assert.equal((await f.request({})).totalCount, 2);
  const count = f.queries.length; await f.request({ forceRefresh: true }); assert.ok(f.queries.length > count);
});
test('detail is owner-bound and reads only a matching immutable submission', async () => {
  const f = fixture();
  f.values.set('semester_assessment_results/a', source('a', { submissionRef: 'semester_assessment_submissions/a',
    questionSnapshots: [{ id: '1', question: '저장된 문제', answer: '정답' }] }).raw);
  f.values.set('semester_assessment_submissions/a', { studentUid: uid, semesterId, attemptId: 'a', answers: { 1: '정답' } });
  f.values.set('semester_assessment_results/other', source('other', { studentUid: 'other' }).raw);
  const result = await f.request({ mode: 'detail', key: 'canonical:a' });
  assert.equal(result.record.details[0].questionSnapshot.question, '저장된 문제');
  assert.equal(result.record.details[0].u, '정답'); assert.equal(result.record.details[1].u, '');
  assert.equal(f.queries.length, 0);
  await assert.rejects(f.request({ mode: 'detail', key: 'canonical:other' }), e => e.code === 'not-found');
  await assert.rejects(f.request({ mode: 'detail', key: 'canonical:../other' }), e => e.code === 'invalid-argument');
  await assert.rejects(f.request({ uid: 'other' }), e => e.code === 'invalid-argument');
});
test('unavailable submitted answer is not fabricated as a recorded blank', () => {
  const result = canonicalDetail('a', source('a').raw, null);
  assert.equal(Object.hasOwn(result.details[0], 'u'), false);
});

test('paper header is frozen at submission, with a strictly bound immutable attempt fallback', async () => {
  const header = { subject: '역사', grade: '3', examName: '초시' };
  for (const storedOnResult of [true, false]) {
    const f = fixture();
    f.values.set('semester_assessment_results/paper', source('paper', { category: 'exam_prep', answers: {},
      ...(storedOnResult ? { paperHeader: header } : {}) }).raw);
    f.values.set('semester_assessment_attempts/paper', { studentUid: uid, semesterId, attemptId: 'paper', assessmentKind: 'QUIZ',
      resultRef: 'semester_assessment_results/paper', status: 'SUBMITTED', definitionId: `quiz:${semesterId}:unit-a:formative`, paperHeader: header });
    assert.deepEqual((await f.request({ mode: 'detail', key: 'canonical:paper' })).record.paperHeader, header);
    assert.equal(f.reads.filter(path => path.startsWith('semester_quiz_review_notes/')).length, 1);
    assert.equal(f.reads.filter(path => path === 'semester_assessment_attempts/paper').length, storedOnResult ? 0 : 1);
    assert.equal(f.queries.length, 0);
    if (!storedOnResult) {
      for (const patch of [{ studentUid: 'other' }, { definitionId: 'other' }, { resultRef: 'semester_assessment_results/other' }, { status: 'IN_PROGRESS' }]) {
        delete f.values.get('semester_assessment_results/paper').paperHeader;
        const attempt = f.values.get('semester_assessment_attempts/paper');
        f.values.set('semester_assessment_attempts/paper', { ...attempt, ...patch });
        assert.equal((await f.request({ mode: 'detail', key: 'canonical:paper' })).record.paperHeader, undefined);
        f.values.set('semester_assessment_attempts/paper', attempt);
      }
    }
  }
});
