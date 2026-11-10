const assert = require('node:assert/strict');
const { createTeacherStudentRosterHandler, ROSTER_FIELDS } = require('../teacherStudentRoster');

const request = (data = {}) => ({ auth: { uid: 'teacher', token: { email: 'qa@yongshin-ms.ms.kr' } },
  data: { year: '2026', semester: '2', ...data } });
const document = (id, data) => ({ id, exists: data !== undefined, data: () => data });
const makeFixture = ({ profile = { role: 'teacher' }, config = { year: '2026', semester: '2' }, users = [], failRead = false } = {}) => {
  const reads = [], sessions = [];
  let writes = 0;
  const db = {
    doc: path => ({ path, get: async () => {
      reads.push(path);
      return document(path, path === 'site_settings/config' ? config : { grades: [{ value: '3', label: '3학년' }], classes: [{ value: '1', label: '1반' }] });
    } }),
    getAll: async (ref, options) => { reads.push({ path: ref.path, fieldMask: options.fieldMask }); return [document(ref.path, profile)]; },
    collection: path => ({ select: (...fields) => ({ get: async () => {
      reads.push({ path, fields, documents: users.length });
      if (failRead) throw new Error('synthetic read failure');
      return { docs: users.map(({ id, ...data }) => document(id, Object.fromEntries(fields.filter(field => Object.hasOwn(data, field)).map(field => [field, data[field]])))) };
    } }) }),
    set: () => { writes++; },
  };
  return { handler: createTeacherStudentRosterHandler({ db, assertSession: async value => sessions.push(value) }), reads, sessions, writes: () => writes };
};

(async () => {
  const users = [
    ...Array.from({ length: 321 }, (_, index) => ({ id: `student-${index}`, role: 'student', studentName: `학생${index}`, grade: 3, class: 1, number: index + 1, avatar: 'x'.repeat(50000), notes: 'x'.repeat(20000) })),
    { id: 'legacy', studentName: '이전학생', gradeClass: '3학년 1반 1번' },
    { id: 'legacy-alias', grade: '3', name: '별칭학생' },
    { id: 'admin-test', role: 'teacher', email: 'westoria28@gmail.com', studentName: '관리자테스트' },
    { id: 'pending', role: 'student', registrationApprovalStatus: null },
    { id: 'teacher', role: 'teacher', studentName: '교사' },
    { id: 'staff', role: 'staff', studentName: '직원' },
    { id: 'unregistered', name: '학생 정보 없음' },
  ];
  const fixture = makeFixture({ users });
  const result = await fixture.handler(request());
  assert.equal(result.students.length, 325);
  assert.ok(result.students.some(row => row.id === 'legacy'));
  assert.ok(result.students.some(row => row.id === 'legacy-alias'));
  assert.ok(result.students.some(row => row.id === 'admin-test'));
  assert.equal(result.students.find(row => row.id === 'pending').registrationApprovalStatus, null);
  assert.equal(Object.hasOwn(result.students[0], 'registrationApprovalStatus'), false);
  assert.equal(result.students.some(row => ['teacher', 'staff', 'unregistered'].includes(row.id)), false);
  assert.equal(JSON.stringify(result).includes('avatar'), false);
  assert.equal(JSON.stringify(result).includes('notes'), false);
  assert.deepEqual(fixture.reads.find(read => read.path === 'users').fields, ROSTER_FIELDS);
  assert.equal(fixture.reads.find(read => read.path === 'users').documents, users.length);
  assert.equal(fixture.sessions.length, 1);
  assert.equal(fixture.writes(), 0);
  assert.deepEqual(result.schoolConfig.grades, [{ value: '3', label: '3학년' }]);
  for (const profile of [{ role: 'student' }, { role: 'staff' }, { role: 'staff', staffPermissions: ['student_list_read'] }, { role: 'teacher', disabled: true }]) {
    const denied = makeFixture({ profile, users });
    await assert.rejects(denied.handler(request()), { code: 'permission-denied' });
    assert.equal(denied.reads.some(read => read.path === 'users'), false);
  }
  const delegated = makeFixture({ profile: { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['student_list_read'] }, users });
  assert.equal((await delegated.handler(request())).students.length, 325);
  const wrongScope = makeFixture({ users });
  await assert.rejects(wrongScope.handler(request({ semester: '1' })), { code: 'failed-precondition' });
  assert.equal(wrongScope.reads.some(read => read.path === 'users'), false);
  await assert.rejects(makeFixture().handler(request({ grade: '3' })), { code: 'invalid-argument' });
  await assert.rejects(makeFixture().handler({ data: request().data }), { code: 'permission-denied' });
  await assert.rejects(makeFixture({ failRead: true }).handler(request()), /synthetic read failure/);
  let protectedReads = 0;
  const blocked = createTeacherStudentRosterHandler({ db: { getAll: () => { protectedReads++; } }, assertSession: async () => { throw new Error('session revoked'); } });
  await assert.rejects(blocked(request()), /session revoked/);
  assert.equal(protectedReads, 0);
  console.log(JSON.stringify({ pass: true, rosterProfiles: result.students.length,
    projectedDocumentReads: users.length, responseBytes: Buffer.byteLength(JSON.stringify(result)),
    sourceBytes: Buffer.byteLength(JSON.stringify(users)), writes: fixture.writes(),
    checks: 'complete 321+ roster; legacy missing roles/approval, admin test, staff exclusion, field projection, live role/session/scope denial, no writes' }));
})().catch(error => { console.error(error); process.exitCode = 1; });
