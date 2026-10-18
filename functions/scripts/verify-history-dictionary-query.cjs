const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createHistoryDictionaryQueryHandler, PAGE_SIZE } = require('../historyDictionaryQuery');
const root = 'years/2026/semesters/2/dictionary_students';
const term = (i, overrides = {}) => ({ uid: 'student', termId: `term_${i}`, word: `단어 ${i}`, definition: '학생이 직접 정리한 역사 용어의 뜻입니다.', normalizedWord: `단어 ${i}`, definitionSource: 'student', status: 'saved', year: '2026', semester: '2', updatedAt: { seconds: i + 1, nanoseconds: 0 }, ...overrides });
const row = (path, data) => ({ id: path.split('/').at(-1), ref: { path }, data: () => data });
const rows = Array.from({length: 605}, (_, i) => row(`${root}/student/history_dictionary_words/term_${String(i).padStart(4, '0')}`, term(i)));
rows.push(row(`${root}/other/history_dictionary_words/mismatch`, term(999)));
rows.push(row(`users/student/history_dictionary_words/legacy`, term(998)));
rows.push(row(`${root}/student/history_dictionary_words/teacher-term`, term(997, { definitionSource: 'teacher' })));
rows.sort((a,b) => a.ref.path.localeCompare(b.ref.path));
let profile = { role: 'teacher' }, active = true, sessionFailure = false, reads = 0;
const db = {
  doc: path => ({ path, get: async () => ({ data: () => profile }) }),
  getAll: async () => [{ exists: true, data: () => ({ semesterId: '2026-2', revision: 1 }) }, { exists: true, data: () => ({ semesterId: '2026-2', revision: 1, status: active ? 'ACTIVE' : 'ARCHIVED' }) }],
  collectionGroup: name => {
    assert.equal(name, 'history_dictionary_words');
    let after = '', limit = 0;
    const constraints = [];
    const query = { where(...input) { constraints.push(input); return query; }, orderBy() { return query; }, startAfter(ref) { after=ref.path; return query; }, limit(n) { limit=n; return query; }, async get() {
      reads++;
      assert.deepEqual(constraints, [['year','==','2026'], ['semester','==','2'], ['status','==','saved']]);
      assert.equal(limit, PAGE_SIZE);
      const start = after ? rows.findIndex(item => item.ref.path === after) + 1 : 0;
      const docs = rows.slice(start, start + limit);
      return { size: docs.length, docs };
    }};
    return query;
  },
};
const handler = createHistoryDictionaryQueryHandler({ db, assertSession: async () => { if (sessionFailure) throw Error('closed session'); } });
const request = (data = {}, email = 'teacher@yongshin-ms.ms.kr') => ({ auth: { uid: 'teacher', token: { email } }, data: { year: '2026', semester: '2', ...data } });
(async () => {
  let after = '', all = [];
  do { const result = await handler(request({after})); all.push(...result.words); after=result.nextCursor; } while(after);
  assert.equal(all.length, 605, 'Every term remains available beyond the former 500 limit');
  assert.equal(new Set(all.map(word => word.id)).size, 605);
  assert.ok(all.every(word => word.uid === 'student' && /^\d+:0$/.test(word.writeVersion)));
  assert.equal(reads, 4);
  active=false;
  assert.ok((await handler(request())).words.length, 'Teachers retain deployed archive access');
  profile={role: 'staff', teacherPortalEnabled: true, staffPermissions: ['lesson_read']};
  await assert.rejects(handler(request()), { code: 'permission-denied' });
  active=true; assert.ok((await handler(request())).words.length);
  profile={role:'student'};
  await assert.rejects(handler(request()), {code:'permission-denied'});
  assert.ok((await handler(request({}, 'westoria28@gmail.com'))).words.length, 'Administrator retains access');
  profile={role:'teacher'};
  for (const after of ['years/2025/semesters/2/dictionary_students/student/history_dictionary_words/x', 'users/student/private/x', 'users/student/history_dictionary_words/x/extra', 'users/student/history_dictionary_words/bad\\path'])
    await assert.rejects(handler(request({after})), {code:'invalid-argument'});
  await assert.rejects(handler(request({year:'2026/2'})), {code:'invalid-argument'});
  const before=reads;sessionFailure=true;
  await assert.rejects(handler(request()), /closed session/);
  assert.equal(reads, before, 'Session failure prevents data access');
  const manifest = require('../historyDictionaryQuery.source.json');
  assert.equal(createHash('sha256').update(readFileSync(require.resolve('../historyDictionaryQuery'), 'utf8').replace(/\r\n/g, '\n')).digest('hex'), manifest.restoredSha256);
  assert.match(manifest.originalSourceSha256, /^[a-f0-9]{64}$/);
  process.env.GCLOUD_PROJECT = 'demo-westory-dictionary-export';
  process.env.FIREBASE_CONFIG = JSON.stringify({projectId: process.env.GCLOUD_PROJECT});
  const endpoint = require('../index').listStudentHistoryDictionaryWordsForTeacher;
  assert.deepEqual(endpoint.__endpoint.region, ['asia-northeast3']);
  assert.ok(endpoint.__endpoint.callableTrigger);
  const actual = readFileSync(require.resolve('../index'), 'utf8');
  assert.match(actual, /exports\.listStudentHistoryDictionaryWordsForTeacher = onCall\(\{ region: REGION \},\s*require\('\.\/historyDictionaryQuery'\)\.createHistoryDictionaryQueryHandler\(\{ db \}\)\)/);
  console.log('PASS dictionary query: 605 rows across 4 pages, scoped ownership/privacy, teacher archives, staff active-semester restriction, session rejection, bounded cursors, source hash and Seoul export; network 0');
})().catch(error => { console.error(error); process.exitCode=1; });
