const assert = require('node:assert/strict');
const path = require('node:path');
const modulePath = process.env.WESTORY_DEVELOPER_LOG_LIKERS_MODULE
  || path.resolve(__dirname, '../developerLogLikeStudents.js');
const { createDeveloperLogLikeStudentsHandler, READER_FIELDS, STUDENT_FIELDS } = require(modulePath);
const postPath = 'site_settings/developer_logs/items/post';
const doc = (id, data) => ({ id, exists: data !== undefined, data: () => data });
const request = (data = {}, uid = 'teacher', email = 'teacher@yongshin-ms.ms.kr') => ({
  auth: { uid, token: { email } }, data: { postId: 'post', ...data },
});
const fixture = (options = {}) => {
  const documents = new Map([
    ['users/teacher', { role: 'teacher' }],
    [postPath, { title: '합성 검증 글', bodyHtml: 'x'.repeat(100000) }],
    ...Array.from({ length: 83 }, (_, n) => [`users/student-${String(n).padStart(3, '0')}`, {
      role: 'student', name: `검증 학생 ${n}`, grade: 3, class: 2, number: n + 1,
      email: 'private@example.test', avatar: 'private', secret: 'private',
    }]),
  ]);
  if (Object.hasOwn(options, 'reader')) documents.set('users/teacher', options.reader);
  if (options.noPost) documents.delete(postPath);
  const likes = options.likes || Array.from({ length: 83 }, (_, n) => ({ id: `student-${String(n).padStart(3, '0')}`, uid: `student-${String(n).padStart(3, '0')}` }));
  const reads = [], sessions = [];
  let writes = 0;
  const forbidden = () => { writes++; throw new Error('Unexpected write'); };
  const db = {
    doc: reference => ({ path: reference, id: reference.split('/').at(-1), set: forbidden, update: forbidden, delete: forbidden,
      collection: name => {
        assert.equal(reference, postPath); assert.equal(name, 'likes');
        const state = { path: `${reference}/${name}` };
        const query = {
          orderBy: value => { state.order = value; return query; },
          select: (...fields) => { state.fields = fields; return query; },
          startAfter: cursor => { state.cursor = cursor; return query; },
          limit: limit => { state.limit = limit; return query; },
          get: async () => {
            if (options.failQuery) throw new Error('synthetic query failure');
            const selected = likes.filter(row => !state.cursor || row.id > state.cursor).slice(0, state.limit);
            reads.push({ ...state, count: selected.length });
            return { docs: selected.map(row => doc(row.id, { uid: row.uid })) };
          },
        };
        return query;
      },
    }),
    getAll: async (...args) => {
      const { fieldMask } = args.pop();
      reads.push({ paths: args.map(ref => ref.path), fieldMask });
      if (options.failProfile && args.some(ref => ref.path.includes('/student-'))) throw new Error('synthetic profile failure');
      return args.map(ref => {
        const data = documents.get(ref.path);
        return doc(ref.id, data === undefined ? undefined
          : Object.fromEntries(fieldMask.filter(field => Object.hasOwn(data, field)).map(field => [field, data[field]])));
      });
    },
  };
  return {
    documents, reads, sessions, writes: () => writes,
    handler: createDeveloperLogLikeStudentsHandler({ db, assertSession: async value => {
      sessions.push(value);
      if (options.sessionError) throw options.sessionError;
      return { uid: options.sessionUid || value.auth.uid };
    } }),
  };
};

async function unit() {
  let checks = 0;
  const f = fixture(), seen = [];
  let cursor, pages = 0;
  do {
    const result = await f.handler(request(cursor ? { cursor } : {}));
    assert(result.students.length <= 40);
    for (const row of result.students) {
      assert.deepEqual(Object.keys(row).sort(), ['class', 'grade', 'id', 'name', 'number']);
      assert.equal(row.grade, '3'); assert.equal(row.class, '2');
      seen.push(row.id);
    }
    assert.equal(result.hasMore, result.nextCursor !== null);
    cursor = result.nextCursor; pages++;
  } while (cursor);
  assert.equal(pages, 3); assert.equal(seen.length, 83); assert.equal(new Set(seen).size, 83);
  assert.deepEqual(f.reads.filter(read => read.path).map(read => read.count), [41, 41, 3]);
  assert(f.reads.filter(read => read.path).every(read => read.limit === 41 && read.fields.join() === 'uid'));
  assert(f.reads.filter(read => read.paths?.some(item => item.includes('/student-'))).every(read => read.fieldMask === STUDENT_FIELDS));
  assert(f.reads.filter(read => read.paths?.includes('users/teacher')).every(read => read.fieldMask === READER_FIELDS));
  assert(f.reads.filter(read => read.paths?.includes(postPath)).every(read => read.fieldMask.length === 0));
  assert.equal(f.writes(), 0); checks++;
  for (const reader of [undefined, {}, { role: 'student' }, { role: 'student', teacherPortalEnabled: true, staffPermissions: ['student_list_read'] },
    { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['student_list_read'] }, { role: 'teacher', disabled: true },
    { role: 'teacher', isDeleted: true }, { role: 'teacher', deletedAt: 1 },
    { role: 'teacher', registrationApprovalStatus: 'PENDING' }, { role: 'teacher', registrationApprovalStatus: null }]) {
    const denied = fixture({ reader });
    await assert.rejects(denied.handler(request()), { code: 'permission-denied' });
    assert.equal(denied.reads.length, 1); assert.equal(denied.reads[0].paths[0], 'users/teacher'); checks++;
  }
  const approved = fixture({ reader: { role: 'teacher', registrationApprovalStatus: 'APPROVED' } });
  assert.equal((await approved.handler(request({ pageSize: 100 }))).students.length, 83); checks++;
  const admin = fixture();
  assert.equal((await admin.handler(request({}, 'teacher', 'WESTORIA28@gmail.com'))).students.length, 40); checks++;
  for (const bad of [{ postId: '../users' }, { postId: 'post/likes' }, { postId: '' }, { postId: 7 }, { postId: 'a'.repeat(81) },
    { cursor: '../foo' }, { cursor: '..' }, { cursor: 'x/y' }, { cursor: '' }, { cursor: '\u0000' }, { cursor: 'x'.repeat(129) },
    { cursor: null }, { pageSize: 0 }, { pageSize: 101 }, { pageSize: 1.5 }, { pageSize: '40' }, { scope: 'all' }]) {
    const invalid = fixture(); await assert.rejects(invalid.handler(request(bad)), { code: 'invalid-argument' });
    assert.equal(invalid.reads.length, 0); assert.equal(invalid.sessions.length, 0); checks++;
  }
  for (const req of [{ data: { postId: 'post' } }, request({}, '../teacher'), request({}, 'teacher', 'x@example.test')]) {
    const denied = fixture(); await assert.rejects(denied.handler(req)); assert.equal(denied.reads.length, 0); checks++;
  }
  for (const opts of [{ sessionError: new Error('revoked') }, { sessionUid: 'another-teacher' }]) {
    const denied = fixture(opts); await assert.rejects(denied.handler(request())); assert.equal(denied.reads.length, 0); checks++;
  }
  const absent = fixture({ noPost: true }); await assert.rejects(absent.handler(request()), { code: 'not-found' });
  assert.equal(absent.reads.length, 2); checks++;
  const empty = fixture({ likes: [] }); assert.deepEqual(await empty.handler(request()), { students: [], nextCursor: null, hasMore: false });
  assert.equal(empty.reads.length, 3); checks++;
  const boundary = fixture(); const end = await boundary.handler(request({ cursor: 'student-082' }));
  assert.equal(end.students.length, 0); assert.equal(end.hasMore, false); checks++;
  const identity = fixture({ likes: [{ id: 'student-000', uid: 'someone-else' }, { id: 'student-001' }, { id: 'student-002' }, { id: 'student-003' }, { id: 'student-004' }] });
  identity.documents.set('users/student-000', { role: 'student', studentName: '원래 학생', name: '별명', studentGrade: 2, studentClass: '5', studentNumber: '07', email: 'secret' });
  identity.documents.delete('users/student-001');
  identity.documents.set('users/student-002', { role: 'student', name: '삭제된 이름', isDeleted: true });
  identity.documents.set('users/student-003', { role: 'teacher', name: '교사로 전환됨' });
  identity.documents.set('users/student-004', { role: 'student', displayName: '이전 이름', grade: 1, class: 3, number: 9 });
  const rows = (await identity.handler(request())).students;
  assert.deepEqual(rows[0], { id: 'student-000', name: '원래 학생', grade: '2', class: '5', number: '07' });
  assert.equal(rows[4].name, '이전 이름');
  rows.slice(1, 4).forEach(row => assert.deepEqual(row, { id: row.id, name: '학생 정보 없음', grade: '', class: '', number: '' }));
  assert(!identity.reads.some(read => read.paths?.includes('users/someone-else'))); checks++;
  for (const opts of [{ failQuery: true }, { failProfile: true }]) {
    const failed = fixture(opts); await assert.rejects(failed.handler(request()), /synthetic/); assert.equal(failed.writes(), 0); checks++;
  }
  console.log(JSON.stringify({ suite: 'developer-log-like-students-unit', checks, pages, rows: seen.length, writes: f.writes(), pass: true }));
}

async function integration() {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
  assert.match(emulatorHost, /^(?:127\.0\.0\.1|localhost):\d{1,5}$/);
  const projectId = process.env.GCLOUD_PROJECT || '';
  assert.match(projectId, /^demo-westory-session-developer-log-likers(?:-[a-z0-9-]+)?$/);
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const { getFirestore, Timestamp } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId });
  const db = getFirestore(app); db.settings({ host: emulatorHost, ssl: false });
  const sourceDir = path.dirname(modulePath);
  const { MIN_CLIENT_PROTOCOL_VERSION, SESSION_AUTHORITY_GENERATION, SESSION_SCHEMA_VERSION } = require(path.join(sourceDir, 'sessionAuthority.js'));
  const { withStudentMaintenanceGuard } = require(path.join(sourceDir, 'studentMaintenance.js'));
  const authTime = Math.floor(Date.now() / 1000), revision = 'a'.repeat(64);
  const makeRequest = (uid, data = {}) => ({
    auth: { uid, token: { email: `${uid}@yongshin-ms.ms.kr`, auth_time: authTime } },
    data: { postId: 'post', ...data, _session: { authorityGeneration: SESSION_AUTHORITY_GENERATION, protocolVersion: MIN_CLIENT_PROTOCOL_VERSION, revision } },
  });
  const seedSession = uid => db.doc(`application_sessions/${uid}/sessions/${authTime}`).set({
    uid, email: `${uid}@yongshin-ms.ms.kr`, authTime, status: 'active', schemaVersion: SESSION_SCHEMA_VERSION,
    authorityGeneration: SESSION_AUTHORITY_GENERATION, protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
    sessionRevision: revision, authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(Date.now() + 600000),
  });
  const calls = [];
  const observed = {
    doc: reference => db.doc(reference),
    getAll: async (...args) => { calls.push({ paths: args.slice(0, -1).map(ref => ref.path), fieldMask: args.at(-1).fieldMask }); return db.getAll(...args); },
  };
  try {
    await Promise.all(['teacher', 'student', 'staff'].map(seedSession));
    const seed = db.batch();
    seed.set(db.doc('users/teacher'), { role: 'teacher', registrationApprovalStatus: 'APPROVED' });
    seed.set(db.doc('users/student'), { role: 'student', teacherPortalEnabled: true, staffPermissions: ['student_list_read'] });
    seed.set(db.doc('users/staff'), { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['student_list_read'] });
    seed.set(db.doc(postPath), { title: '합성 글', bodyHtml: 'x'.repeat(100000), likeCount: 85 });
    for (let n = 0; n < 85; n++) {
      const id = `student-${String(n).padStart(3, '0')}`;
      seed.set(db.doc(`${postPath}/likes/${id}`), { uid: id, createdAt: Timestamp.now() });
      if (n < 84) seed.set(db.doc(`users/${id}`), { role: 'student', studentName: `검증 학생 ${n}`, studentGrade: 3, studentClass: 2,
        studentNumber: n + 1, email: 'secret@example.test', ...(n === 83 ? { isDeleted: true } : {}) });
    }
    await seed.commit();
    const handler = withStudentMaintenanceGuard(createDeveloperLogLikeStudentsHandler({ db: observed }));
    let cursor, pages = 0;
    const rows = [];
    do {
      const response = await handler(makeRequest('teacher', cursor ? { cursor } : {}));
      rows.push(...response.students); cursor = response.nextCursor; pages++;
    } while (cursor);
    assert.equal(rows.length, 85); assert.equal(new Set(rows.map(row => row.id)).size, 85); assert.equal(pages, 3);
    assert.equal(rows[0].name, '검증 학생 0'); assert.equal(rows[83].name, '학생 정보 없음'); assert.equal(rows[84].name, '학생 정보 없음');
    assert(!JSON.stringify(rows).includes('email'));
    assert.deepEqual(calls.filter(call => call.paths[0]?.includes('/student-')).map(call => call.paths.length), [40, 40, 5]);
    for (const uid of ['student', 'staff']) {
      calls.length = 0; await assert.rejects(handler(makeRequest(uid)), { code: 'permission-denied' });
      assert.equal(calls.length, 1); assert.equal(calls[0].paths[0], `users/${uid}`);
    }
    for (const update of [{ disabled: true }, { isDeleted: true }, { registrationApprovalStatus: 'PENDING' }]) {
      await db.doc('users/teacher').set({ role: 'teacher', ...update });
      await assert.rejects(handler(makeRequest('teacher')), { code: 'permission-denied' });
    }
    await db.doc('users/teacher').set({ role: 'teacher' });
    await db.doc(`application_sessions/teacher/sessions/${authTime}`).update({ status: 'revoked' });
    calls.length = 0; await assert.rejects(handler(makeRequest('teacher')), { code: 'unauthenticated' }); assert.equal(calls.length, 0);
    await seedSession('teacher');
    await assert.rejects(handler(makeRequest('teacher', { postId: 'missing' })), { code: 'not-found' });
    await db.doc('site_settings/student_maintenance').set({ enabled: true, blockedRoles: ['student'], bypassUids: [],
      title: '합성 점검', message: '합성 검사 중입니다.', revision: 1, startedAt: Timestamp.now(), updatedAt: Timestamp.now(), updatedBy: 'teacher' });
    assert.equal((await handler(makeRequest('teacher', { pageSize: 1 }))).students.length, 1);
    calls.length = 0;
    await assert.rejects(handler(makeRequest('student')));
    assert.equal(calls.length, 0);
    const before = (await db.doc(postPath).get()).updateTime.toMillis();
    await handler(makeRequest('teacher', { pageSize: 100 }));
    assert.equal((await db.doc(postPath).get()).updateTime.toMillis(), before);
    assert.equal((await db.doc(postPath).get()).data().likeCount, 85);
    console.log(JSON.stringify({ suite: 'developer-log-like-students-emulator', pass: true, rows: rows.length, pages,
      security: 'real maintenance, registration and application-session guards; live role/deletion/session rejection',
      lookupDocumentCounts: [40, 40, 5], returnedFields: ['id', 'name', 'grade', 'class', 'number'], featureWrites: 0 }));
  } finally { await db.terminate(); await deleteApp(app); }
}

(async () => { await unit(); if (process.argv.includes('--emulator')) await integration(); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
