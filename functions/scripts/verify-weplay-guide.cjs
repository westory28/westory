const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../node_modules/typescript');
const { createWeplayFunctions } = require('../weplay');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function client(firebase) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/lib/weplayGuide.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)((name) => {
    if (name === './historyDictionarySession') return { getHistoryDictionaryCallable: firebase.getHttpsCallable };
    assert.equal(name, './firebase');
    return firebase;
  }, exports);
  return exports;
}
function server() {
  class ApiError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const docs = new Map([
    ['users/student', { uid: 'student', role: 'student', name: '학생' }],
    ['users/teacher', { uid: 'teacher', role: 'teacher', name: '교사' }],
    ['users/staff', { uid: 'staff', role: 'staff', teacherPortalEnabled: true, staffPermissions: ['lesson_read'] }],
    ['years/2026/semesters/2/point_wallets/student', { balance: 50 }],
  ]);
  const writes = [];
  let tail = Promise.resolve();
  const db = {
    doc: (key) => ({ path: key }),
    runTransaction: (callback) => {
      const run = tail.then(() => callback({
        get: async (ref) => ({ exists: docs.has(ref.path), data: () => structuredClone(docs.get(ref.path)) }),
        update: (ref, fields) => {
          assert.ok(docs.has(ref.path));
          writes.push({ path: ref.path, fields });
          docs.set(ref.path, { ...docs.get(ref.path), ...fields });
        },
      }));
      tail = run.catch(() => undefined);
      return run;
    },
  };
  const api = createWeplayFunctions({
    db, HttpsError: ApiError, FieldValue: { serverTimestamp: () => ({ timestamp: writes.length + 1 }) },
    onCall: (_options, fn) => fn, onSchedule: (_options, fn) => fn,
    assertAllowedWestoryUser: (request) => {
      if (!request.auth?.uid) throw new ApiError('unauthenticated', '인증 필요');
      return { uid: request.auth.uid };
    },
  });
  const call = (uid, accountUid = uid, data = {}) => api.completeWeplayGuide({ auth: uid ? { uid } : null, data: { accountUid, ...data } });
  return { docs, writes, call };
}

test('guide status is unknown on missing or mismatched account data and only explicit true means completed', () => {
  const { getWeplayGuideStatus } = client({});
  assert.equal(getWeplayGuideStatus(null, null), null);
  assert.equal(getWeplayGuideStatus('a', null), null);
  assert.equal(getWeplayGuideStatus('a', { uid: 'b', weplayGuideCompleted: true }), null);
  assert.equal(getWeplayGuideStatus('a', { uid: 'a' }), false);
  assert.equal(getWeplayGuideStatus('a', { uid: 'a', weplayGuideCompleted: 'true' }), false);
  assert.equal(getWeplayGuideStatus('a', { uid: 'a', weplayGuideCompleted: true }), true);
});

test('one account deduplicates in-flight completion and sends no semester or target fields', async () => {
  const response = deferred(); let count = 0;
  const api = client({ auth: { currentUser: { uid: 'a' } }, getHttpsCallable: async (name) => {
    assert.equal(name, 'completeWeplayGuide');
    return async (data) => { count++; assert.deepEqual(data, { accountUid: 'a' }); return response.promise; };
  } });
  const first = api.completeWeplayGuide('a');
  const second = api.completeWeplayGuide('a');
  assert.equal(first, second);
  await Promise.resolve(); assert.equal(count, 1);
  response.resolve({ data: { uid: 'a', guideCompleted: true } });
  assert.deepEqual(await first, { uid: 'a', guideCompleted: true });
});

test('failed or malformed completion never becomes success and a later call retries', async () => {
  let count = 0;
  const api = client({ auth: { currentUser: { uid: 'a' } }, getHttpsCallable: async () => async () => {
    count++;
    if (count === 1) throw new Error('offline');
    return { data: { uid: count === 2 ? 'b' : 'a', guideCompleted: true } };
  } });
  await assert.rejects(api.completeWeplayGuide('a'), /offline/);
  await assert.rejects(api.completeWeplayGuide('a'), /확인하지 못했습니다/);
  assert.deepEqual(await api.completeWeplayGuide('a'), { uid: 'a', guideCompleted: true });
  assert.equal(count, 3);
});

test('account switches before callable loading or after response cannot acknowledge the wrong account', async () => {
  const auth = { currentUser: { uid: 'a' } };
  const loading = deferred(); let calls = 0;
  const api = client({ auth, getHttpsCallable: () => loading.promise });
  const first = api.completeWeplayGuide('a');
  auth.currentUser = { uid: 'b' };
  loading.resolve(async () => { calls++; return { data: { uid: 'a', guideCompleted: true } }; });
  await assert.rejects(first, /계정이 변경/); assert.equal(calls, 0);
  await assert.rejects(api.completeWeplayGuide('a'), /계정이 변경/);
  const response = deferred();
  auth.currentUser = { uid: 'a' };
  const late = client({ auth, getHttpsCallable: async () => async (data) => {
    assert.equal(data.accountUid, 'a'); return response.promise;
  } });
  const pending = late.completeWeplayGuide('a'); await Promise.resolve();
  auth.currentUser = null;
  response.resolve({ data: { uid: 'a', guideCompleted: true } });
  await assert.rejects(pending, /계정이 변경/);
});

test('server permanently marks only authenticated account and concurrent/repeated calls write once across semesters', async () => {
  const { docs, writes, call } = server();
  const originalWallet = structuredClone(docs.get('years/2026/semesters/2/point_wallets/student'));
  const results = await Promise.all(Array.from({ length: 5 }, () => call('student')));
  results.forEach((result) => assert.deepEqual(result, { uid: 'student', guideCompleted: true }));
  const recorded = structuredClone(docs.get('users/student'));
  assert.equal(recorded.weplayGuideCompleted, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0].fields).sort(), ['weplayGuideCompleted', 'weplayGuideCompletedAt']);
  await call('student', 'student', { year: '2027', semester: '1', uid: 'teacher' });
  assert.deepEqual(docs.get('users/student'), recorded);
  assert.equal(docs.get('users/teacher').weplayGuideCompleted, undefined);
  assert.deepEqual(docs.get('years/2026/semesters/2/point_wallets/student'), originalWallet);
  assert.equal(writes.length, 1);
  assert.equal(docs.size, 4);
});

test('student, teacher and authorized staff complete their own guide; spoofed, missing and revoked accounts fail', async () => {
  const { docs, writes, call } = server();
  await assert.rejects(call(null), (error) => error.code === 'unauthenticated');
  await assert.rejects(call('student', 'teacher'), (error) => error.code === 'permission-denied');
  await assert.rejects(call('missing'), (error) => error.code === 'failed-precondition');
  for (const profile of [
    { role: 'staff', teacherPortalEnabled: false, staffPermissions: ['lesson_read'] },
    { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['point_read'] },
    { role: 'unknown' }, { role: 'student', isDeleted: true },
    { role: 'teacher', deletedAt: 123 }, { role: 'student', weplayDeletionPending: true },
  ]) {
    docs.set('users/denied', profile);
    await assert.rejects(call('denied'), (error) => error.code === 'permission-denied');
  }
  assert.equal(writes.length, 0);
  for (const uid of ['student', 'teacher', 'staff']) assert.deepEqual(await call(uid), { uid, guideCompleted: true });
  assert.equal(writes.length, 3);
});
