const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Readable } = require('node:stream');
const { readFileSync } = require('node:fs');
const {
  CATALOG_FIELDS, MAX_CATALOG_ENTRIES, MAX_CATALOG_BYTES,
  normalizeQuery, catalogEntry, createQuizEditorCatalogHandler,
} = require('../quizEditorCatalog');

const ROOT = 'years/2026/semesters/2/quiz_questions';
const request = (data = {}, auth = {}) => ({
  data: { semesterId: '2026-2', unitId: 'unit-a', ...data },
  auth: { uid: 'teacher-a', token: { email: 'teacher@yongshin-ms.ms.kr' }, ...auth },
});
const question = (id, data = {}) => ({
  id: String(id), data: () => ({
    id: Number(id), unitId: 'unit-a', subUnitId: 'leaf-a', category: 'diagnostic',
    type: 'choice', contentRevision: 2, question: '다음 자료의 인물은?',
    explanation: '조선을 건국한 태조 이성계이다.', passage: '(가) 조선 건국', concepts: ['조선 건국'],
    image: 'data:image/png;base64,NOT_FOR_CATALOG', answer: '이성계', hint: '정답 힌트',
    options: ['이성계', '정도전'], matchingPairs: [{ left: 'A', right: 'B' }],
    choiceOptionImages: ['data:image/png;base64,SECRET'], ...data,
  }),
});
const memory = (profile = { role: 'teacher' }, docs = [question(10), question(2)], overrides = {}) => {
  const documents = {
    'users/teacher-a': profile,
    'site_settings/config': { year: '2026', semester: '2', activeSemesterId: '2026-2' },
    'site_settings/semester_active': { semesterId: '2026-2', revision: 1 },
    'semester_manifests/2026-2': { semesterId: '2026-2', status: 'ACTIVE', revision: 1 },
    ...overrides,
  };
  const reads = [], queries = [];
  let consumed = 0, stream;
  const snapshot = (path) => ({ data: () => documents[path] });
  const db = {
    doc: (path) => ({ path, get: async () => { reads.push(path); return snapshot(path); } }),
    getAll: async (...refs) => refs.map(({ path }) => { reads.push(path); return snapshot(path); }),
    collection: (path) => {
      const query = { path };
      queries.push(query);
      const cursor = {
        where: (...clause) => { query.where = clause; return cursor; },
        select: (...fields) => { query.select = fields; return cursor; },
        limit: (limit) => { query.limit = limit; return cursor; },
        stream: () => {
          // Emulate the projection, not just a full document later filtered in JS.
          stream = Readable.from((async function* () {
            for (const document of docs.slice(0, query.limit)) {
              const raw = document.data();
              if (raw.unitId !== query.where[2]) continue;
              consumed += 1;
              yield { id: document.id, data: () => Object.fromEntries(query.select
                .filter((field) => Object.hasOwn(raw, field)).map((field) => [field, raw[field]])) };
            }
          })());
          return stream;
        },
      };
      return cursor;
    },
  };
  const handler = createQuizEditorCatalogHandler({ db, assertSession: async (req, options) => {
    assert.deepEqual(options, { recentAuth: false, highRisk: false });
    return { uid: req.auth?.uid, email: req.auth?.token?.email };
  } });
  return { handler, reads, queries, consumed: () => consumed, stream: () => stream };
};

test('one scoped projection query returns complete search metadata and no full body fields', async () => {
  const fixture = memory();
  const result = await fixture.handler(request());
  assert.deepEqual(result.entries.map((entry) => entry.id), [2, 10]);
  assert.equal(result.entries[0].documentId, '2');
  assert.equal(result.entries[0].searchText, '다음 자료의 인물은? 조선을 건국한 태조 이성계이다. (가) 조선 건국 조선 건국');
  assert.deepEqual(fixture.queries, [{ path: ROOT, where: ['unitId', '==', 'unit-a'], select: [...CATALOG_FIELDS], limit: MAX_CATALOG_ENTRIES + 1 }]);
  assert.equal(fixture.reads.length, 4);
  for (const field of ['question', 'explanation', 'passage', 'image', 'answer', 'options', 'hint', 'choiceOptionImages', 'matchingPairs']) {
    assert.equal(Object.hasOwn(result.entries[0], field), false, field);
  }
  for (const field of ['image', 'answer', 'options', 'hint', 'choiceOptionImages', 'matchingPairs']) {
    assert.equal(CATALOG_FIELDS.includes(field), false, field);
  }
  assert.equal(fixture.stream().destroyed, true);
});

test('teacher, quiz-read portal staff and verified administrator retain access', async () => {
  for (const profile of [{ role: 'teacher' }, { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['quiz_read'] },
    { role: 'student', teacherPortalEnabled: true, staffPermissions: ['quiz_read'] }]) {
    assert.equal((await memory(profile).handler(request())).entries.length, 2);
  }
  assert.equal((await memory({}).handler(request({}, { token: { email: 'westoria28@gmail.com' } }))).entries.length, 2);
});

test('student, missing profile, disabled portal and unrelated staff permission never reach question query', async () => {
  for (const profile of [undefined, { role: 'student' }, { role: 'staff', staffPermissions: ['quiz_read'] },
    { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['lesson_read'] }, { role: 'admin' }]) {
    const fixture = memory(profile || {}, []);
    await assert.rejects(fixture.handler(request()), (error) => error.code === 'permission-denied');
    assert.equal(fixture.queries.length, 0);
    assert.equal(fixture.reads.length, 1);
  }
});

test('session failures and actor mismatch cannot reach profile or catalog reads', async () => {
  const db = new Proxy({}, { get() { throw Error('No database read expected'); } });
  const expired = createQuizEditorCatalogHandler({ db, assertSession: async () => { throw Error('session expired'); } });
  await assert.rejects(expired(request()), /session expired/);
  const mismatch = createQuizEditorCatalogHandler({ db, assertSession: async () => ({ uid: 'other' }) });
  await assert.rejects(mismatch(request()), (error) => error.code === 'unauthenticated');
});

test('archive, draft, mismatched pointer/config and read-only semesters never reach question query', async () => {
  for (const overrides of [
    { 'site_settings/config': { year: '2026', semester: '1', activeSemesterId: '2026-1' } },
    { 'site_settings/config': { year: '2026', semester: '2' } },
    { 'site_settings/semester_active': { semesterId: '2026-1', revision: 1 } },
    { 'site_settings/semester_active': { semesterId: '2026-2', revision: 2 } },
    { 'semester_manifests/2026-2': { semesterId: '2026-2', status: 'CLOSED', revision: 1 } },
    { 'semester_manifests/2026-2': { semesterId: '2026-2', status: 'PREPARING', revision: 1 } },
    { 'semester_manifests/2026-2': { semesterId: '2026-2', status: 'ACTIVE', revision: 1, readOnly: true } },
    { 'semester_manifests/2026-2': undefined },
  ]) {
    const fixture = memory({ role: 'teacher' }, [], overrides);
    await assert.rejects(fixture.handler(request()), (error) => error.details.reason === 'QUIZ_CATALOG_SEMESTER_NOT_ACTIVE');
    assert.equal(fixture.queries.length, 0);
  }
});

test('invalid scope/query shape rejects path injection and arbitrary projections', () => {
  for (const payload of [null, [], { semesterId: '2026-3', unitId: 'x' },
    { semesterId: '2026-2', unitId: '../x' }, { semesterId: '2026-2', unitId: ' unit-a ' },
    { semesterId: '2026-2', unitId: '.' }, { semesterId: '2026-2', unitId: 'x', fields: ['answer'] }]) {
    assert.throws(() => normalizeQuery(payload), (error) => error.code === 'invalid-argument');
  }
  assert.deepEqual(normalizeQuery({ semesterId: '2026-2', unitId: 'deleted-unit', _session: {} }), { semesterId: '2026-2', unitId: 'deleted-unit' });
});

test('unassigned categories and vanished curriculum units remain in the exact requested scope', async () => {
  const fixture = memory({ role: 'teacher' }, [question(1, { unitId: 'deleted-unit', subUnitId: null, category: 'exam_prep', refBig: 'old-big' }), question(2)]);
  const result = await fixture.handler(request({ unitId: 'deleted-unit' }));
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].subUnitId, null);
  assert.equal(result.entries[0].refBig, 'old-big');
  assert.equal(result.entries[0].category, 'exam_prep');
});

test('numeric sort IDs remain separate from document IDs and source timestamps normalize to milliseconds', () => {
  const entry = catalogEntry({ id: 'legacy-document', data: () => ({ id: 20, createdAt: { toMillis: () => 123 }, updatedAt: { seconds: 2, nanoseconds: 3000000 }, contentRevision: 4 }) });
  assert.equal(entry.id, 20);
  assert.equal(entry.documentId, 'legacy-document');
  assert.equal(entry.createdAt, 123);
  assert.equal(entry.updatedAt, 2003);
  assert.equal(entry.contentRevision, 4);
  assert.throws(() => catalogEntry({ id: 'invalid', data: () => ({}) }), (error) => error.details.reason === 'QUIZ_CATALOG_ID_INVALID');
});

test('large complete search text is preserved; size/row overflows fail instead of silently truncating matches', async () => {
  const passage = '가'.repeat(30000) + '끝쪽검색어';
  assert.ok((await memory({ role: 'teacher' }, [question(1, { passage })]).handler(request())).entries[0].searchText.includes('끝쪽검색어'));
  const tooMany = memory({ role: 'teacher' }, Array.from({ length: MAX_CATALOG_ENTRIES + 1 }, (_, index) => question(index)));
  await assert.rejects(tooMany.handler(request()), (error) => error.code === 'resource-exhausted');
  assert.equal(tooMany.stream().destroyed, true);
  const large = memory({ role: 'teacher' }, Array.from({ length: 100 }, (_, index) => question(index, { passage: 'a'.repeat(Math.ceil(MAX_CATALOG_BYTES / 4)) })));
  await assert.rejects(large.handler(request()), (error) => error.code === 'resource-exhausted');
  assert.ok(large.consumed() < 100, 'oversize metadata must stop the query stream');
  assert.equal(large.stream().destroyed, true);
});

test('actual deployment entry exports the isolated Seoul callable; session and maintenance stay in its handler', () => {
  const source = readFileSync(require.resolve('../index.js'), 'utf8');
  assert.match(source, /exports\.getQuizEditorCatalog = onCall\([\s\S]*?createQuizEditorCatalogHandler\(\{ db \}\)/);
  const handlerSource = readFileSync(require.resolve('../quizEditorCatalog'), 'utf8');
  assert.match(handlerSource, /assertSession = assertScoreWorkflowSession/);
  assert.match(readFileSync(require.resolve('../scoreWorkflowGuard'), 'utf8'), /withStudentMaintenanceGuard\([\s\S]*?assertActiveApplicationSession/);
});
