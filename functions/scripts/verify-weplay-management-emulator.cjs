const assert = require('node:assert/strict');

const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (project !== 'demo-westory-weplay' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw new Error('Run with the isolated demo-westory-weplay Firestore emulator.');
}
const api = require('../index');
const { getFirestore } = require('firebase-admin/firestore');
const { DEFAULT_POLICY, hash } = require('../weplayCore');
const db = getFirestore();
const scope = { year: '2026', semester: '2' };
const prefix = 'years/2026/semesters/2';
const gamePath = `${prefix}/weplay_games/history-rain`;
const call = (name, data = {}, uid = 'teacher') => api[name].run({
  auth: uid ? { uid, token: { email: uid === 'manager' ? 'westoria28@gmail.com' : `${uid}@yongshin-ms.ms.kr` } } : null,
  data: { ...scope, gameId: 'history-rain', difficulty: 'medium', ...data },
});
const get = async (path) => (await db.doc(path).get()).data();
const rejectCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);
const snapshotDatabase = async () => {
  const result = [];
  const visit = async (collection) => {
    for (const documentRef of await collection.listDocuments()) {
      const doc = await documentRef.get();
      if (doc.exists) result.push({ path: doc.ref.path, data: doc.data(), updateTime: doc.updateTime.toMillis() });
      for (const child of await documentRef.listCollections()) await visit(child);
    }
  };
  for (const collection of await db.listCollections()) await visit(collection);
  return result.sort((a, b) => a.path.localeCompare(b.path));
};

async function main() {
  const reset = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.ok(reset.ok);
  await db.doc('site_settings/config').set(scope);
  await db.doc('users/teacher').set({ role: 'teacher', name: '검증 교사' });
  await db.doc('users/staff').set({ role: 'student', teacherPortalEnabled: true, staffPermissions: ['lesson_read'], name: '자료 조회 담당', studentGrade: '2', studentClass: '1' });
  await db.doc('users/student').set({ role: 'student', teacherPortalEnabled: true, name: '검증 학생', studentGrade: '2', studentClass: '1' });
  await db.doc('users/point-staff').set({ role: 'student', teacherPortalEnabled: true, staffPermissions: ['point_manage'], name: '위스 담당', studentGrade: '2', studentClass: '1' });
  await db.doc(`${prefix}/point_wallets/student`).set({ uid: 'student', balance: 30, earnedTotal: 30, rankEarnedTotal: 30, spentTotal: 0, adjustedTotal: 0 });
  await db.doc(`${prefix}/weplay_policies/current`).set(DEFAULT_POLICY);
  await db.doc(`${prefix}/lessons/public`).set({ unitId: 'public', title: '공개 수업', contentHtml: '[고조선] [삼국 시대] [훈민정음]', isVisibleToStudents: true });
  await db.doc(`${prefix}/lessons/private`).set({ unitId: 'private', title: '비공개 수업', contentHtml: '[비밀왕국] [비밀연표] [비밀문화]', isVisibleToStudents: false });
  await db.doc(`${prefix}/lessons/empty`).set({ unitId: 'empty', title: '빈 자료', isVisibleToStudents: false, contentHtml: '' });
  await db.doc('lessons/private').set({ unitId: 'private', title: '옛 공개 수업', contentHtml: '[옛왕국] [옛연표] [옛문화]', isVisibleToStudents: true });

  const beforeRead = await snapshotDatabase();
  assert.ok(beforeRead.some((doc) => doc.path === `${prefix}/weplay_policies/current`), 'Database snapshots must include nested semester documents.');
  const initial = await call('getWeplayManagement');
  assert.deepEqual(initial.settings, { enabled: true, sourceMode: 'all', unitIds: [], version: 0 });
  assert.equal(initial.availableWordCount, 3);
  assert.equal(initial.previewWordCount, 6);
  assert.equal(initial.lessons.find((lesson) => lesson.unitId === 'private').isVisibleToStudents, false);
  assert.equal(initial.lessons.find((lesson) => lesson.unitId === 'empty').wordCount, 0);
  assert.deepEqual(await snapshotDatabase(), beforeRead, 'Management reads must not create any state.');
  await call('getWeplayManagement', {}, 'manager');
  await call('getWeplayManagement', {}, 'staff');
  for (const uid of ['student', 'point-staff']) {
    await rejectCode(call('getWeplayManagement', {}, uid), 'permission-denied');
    await rejectCode(call('previewWeplayGame', {}, uid), 'permission-denied');
    await rejectCode(call('saveWeplayGameSettings', { settings: initial.settings }, uid), 'permission-denied');
  }
  await rejectCode(call('saveWeplayGameSettings', { settings: initial.settings }, 'staff'), 'permission-denied');
  await rejectCode(call('getWeplayManagement', {}, null), 'unauthenticated');
  await rejectCode(call('getWeplayManagement', { gameId: '../private' }), 'invalid-argument');
  console.log('PASS management permissions: teacher/admin access, lesson_read read/preview only, student portal flag and point_manage cannot save');

  const privateOnly = { ...initial.settings, sourceMode: 'selected', unitIds: ['private'] };
  const saved = await call('saveWeplayGameSettings', { settings: privateOnly });
  assert.equal(saved.settings.version, 1);
  assert.equal(saved.availableWordCount, 0);
  assert.equal(saved.previewWordCount, 3);
  assert.equal((await get(`${prefix}/lessons/private`)).isVisibleToStudents, false);
  assert.deepEqual(await get(`${prefix}/weplay_policies/current`), DEFAULT_POLICY);
  await rejectCode(call('saveWeplayGameSettings', { settings: privateOnly }), 'aborted');
  for (const settings of [
    { ...saved.settings, enabled: 'true' }, { ...saved.settings, sourceMode: 'invalid' },
    { ...saved.settings, unitIds: ['unknown'] }, { ...saved.settings, unitIds: [''] },
    { ...saved.settings, unitIds: ['private/child'] }, { ...saved.settings, version: -1 },
  ]) await rejectCode(call('saveWeplayGameSettings', { settings }), 'invalid-argument');
  console.log('PASS source settings validation, optimistic version conflicts, public flags and existing Wis policy unchanged');

  const beforePreview = await snapshotDatabase();
  for (const [uid, difficulty] of [['teacher', 'mild'], ['staff', 'medium'], ['manager', 'spicy']]) {
    const preview = await call('previewWeplayGame', { difficulty }, uid);
    assert.ok(preview.id.startsWith('preview_'));
    assert.equal(preview.mode, 'practice');
    assert.equal(preview.endsAtMs - preview.startsAtMs, 60000);
    assert.equal(preview.words.length, 20);
    assert.ok(preview.words.every((word) => word.unitId === 'private'));
    assert.equal(preview.words[0].fallDurationMs, { mild: 12000, medium: 10000, spicy: 8000 }[difficulty]);
    await rejectCode(call('submitWeplayAnswer', { sessionId: preview.id, eventId: 'try', wordId: 'word-1', answer: preview.words[0].text }, 'student'), 'not-found');
    await rejectCode(call('finishWeplayGame', { sessionId: preview.id }, 'student'), 'not-found');
  }
  const override = await call('previewWeplayGame', { unitIds: ['public'] });
  assert.ok(override.words.every((word) => word.unitId === 'public'));
  await rejectCode(call('previewWeplayGame', { unitIds: [] }), 'failed-precondition');
  await rejectCode(call('previewWeplayGame', { unitIds: ['unknown'] }), 'invalid-argument');
  assert.deepEqual(await snapshotDatabase(), beforePreview, 'Teacher previews must perform zero Firestore writes, including queues and wallets.');
  console.log('PASS teacher/staff previews include hidden selected words with identical difficulty curves, no persisted sessions/queues/points/ranks');

  let lobby = await call('getWeplayLobby', {}, 'student');
  assert.equal(lobby.gameEnabled, true);
  assert.equal(lobby.wordCount, 0);
  assert.deepEqual(lobby.lessons, []);
  await rejectCode(call('startWeplayGame', { mode: 'practice', requestKey: 'private-bypass', unitIds: ['private'] }, 'student'), 'failed-precondition');
  const mixed = await call('saveWeplayGameSettings', { settings: { ...saved.settings, unitIds: ['public', 'private'] } });
  lobby = await call('getWeplayLobby', {}, 'student');
  assert.equal(lobby.wordCount, 3);
  assert.deepEqual(lobby.lessons.map((lesson) => lesson.unitId), ['public']);
  const live = await call('startWeplayGame', { mode: 'practice', requestKey: 'allowed-practice' }, 'student');
  assert.ok(live.words.every((word) => word.unitId === 'public'));
  const paused = await call('saveWeplayGameSettings', { settings: { ...mixed.settings, enabled: false } });
  assert.equal((await call('getWeplayLobby', {}, 'student')).gameEnabled, false);
  const pausedSnapshot = await snapshotDatabase();
  const pausedPreview = await call('previewWeplayGame', { unitIds: ['private'] });
  assert.ok(pausedPreview.words.every((word) => word.unitId === 'private'));
  assert.deepEqual(await snapshotDatabase(), pausedSnapshot, 'Teacher preview must remain available without writes while student play is disabled.');
  await rejectCode(call('startWeplayGame', { mode: 'practice', requestKey: 'paused-practice' }, 'student'), 'failed-precondition');
  await rejectCode(call('startWeplayGame', { mode: 'challenge', requestKey: 'paused-challenge' }, 'student'), 'failed-precondition');
  await db.doc(`${prefix}/weplay_sessions/${live.id}`).update({ startsAtMs: Date.now() - 400 });
  const answer = await call('submitWeplayAnswer', { sessionId: live.id, eventId: 'active-after-pause', wordId: live.words[0].id, answer: live.words[0].text }, 'student');
  assert.equal(answer.accepted, true);
  await db.doc(`${prefix}/weplay_sessions/${live.id}`).update({ endsAtMs: Date.now() - 1 });
  const finished = await call('finishWeplayGame', { sessionId: live.id }, 'student');
  assert.equal(finished.correctCount, 1);
  assert.equal(finished.netWis, 0);
  assert.equal((await get(`${prefix}/point_wallets/student`)).balance, 30);
  assert.equal((await db.collection(`${prefix}/point_transactions`).get()).size, 0);
  console.log('PASS students only receive selected visible answers, disabled settings block both starts, active games finish without point changes');

  const resumed = await call('saveWeplayGameSettings', { settings: { ...paused.settings, enabled: true } });
  const originalRunTransaction = db.runTransaction.bind(db);
  let injected = false;
  db.runTransaction = async (callback, options) => {
    if (!injected) {
      injected = true;
      await db.doc(gamePath).update({ sourceMode: 'selected', unitIds: ['private'], version: resumed.settings.version + 1 });
    }
    return originalRunTransaction(callback, options);
  };
  try {
    await rejectCode(call('startWeplayGame', { mode: 'practice', requestKey: 'catalog-race' }, 'student'), 'aborted');
  } finally {
    db.runTransaction = originalRunTransaction;
  }
  const rejectedId = hash(`${scope.year}:${scope.semester}:student:catalog-race`);
  assert.equal(await get(`${prefix}/weplay_sessions/${rejectedId}`), undefined);
  assert.equal(await get(`weplay_session_queue/${rejectedId}`), undefined);
  assert.equal((await get(`${prefix}/point_wallets/student`)).balance, 30);
  console.log('PASS configuration change between catalog fetch and start transaction rejects stale words without session/queue/ledger mutations');

  const current = (await call('getWeplayManagement')).settings;
  const empty = await call('saveWeplayGameSettings', { settings: { ...current, sourceMode: 'selected', unitIds: [] } });
  assert.equal(empty.availableWordCount, 0);
  assert.equal(empty.previewWordCount, 0);
  await rejectCode(call('startWeplayGame', { mode: 'challenge', requestKey: 'empty-selection' }, 'student'), 'failed-precondition');
  assert.equal((await get(`${prefix}/lessons/private`)).isVisibleToStudents, false);
  console.log('PASS empty selected scope safely disables starts without publishing private lessons');

  await db.doc(`${prefix}/lessons/gone`).set({ unitId: 'gone', title: '삭제할 수업', contentHtml: '[삭제가] [삭제나] [삭제다]', isVisibleToStudents: true });
  const beforeRemoval = await call('saveWeplayGameSettings', { settings: { ...empty.settings, unitIds: ['gone'] } });
  await db.doc(`${prefix}/lessons/gone`).delete();
  const missing = await call('getWeplayManagement');
  assert.deepEqual(missing.settings.unitIds, ['gone']);
  assert.equal(missing.availableWordCount, 0);
  assert.equal(missing.previewWordCount, 0);
  assert.equal((await call('getWeplayLobby', {}, 'student')).wordCount, 0);
  await rejectCode(call('previewWeplayGame'), 'failed-precondition');
  const recovered = await call('saveWeplayGameSettings', { settings: { ...beforeRemoval.settings, enabled: false, sourceMode: 'all' } });
  assert.deepEqual(recovered.settings.unitIds, []);
  assert.equal(recovered.settings.enabled, false);
  assert.equal(recovered.availableWordCount, 3);
  assert.equal((await get(`${prefix}/lessons/private`)).isVisibleToStudents, false);
  console.log('PASS missing selected lessons remain empty; explicit all/disabled save clears stale IDs and recovers without publishing or substituting hidden material');

  const signup = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'management-rules@yongshin-ms.ms.kr', password: 'emulator-only-password', returnSecureToken: true }) });
  const account = await signup.json();
  assert.ok(account.idToken, JSON.stringify(account));
  await db.doc(`users/${account.localId}`).set({ role: 'student', email: 'management-rules@yongshin-ms.ms.kr' });
  const settingsEndpoint = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents/${gamePath}`;
  const directRead = await fetch(settingsEndpoint, { headers: { authorization: `Bearer ${account.idToken}` } });
  assert.equal(directRead.status, 403);
  const directWrite = await fetch(settingsEndpoint, { method: 'PATCH', headers: { authorization: `Bearer ${account.idToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ fields: { enabled: { booleanValue: true } } }) });
  assert.equal(directWrite.status, 403);
  assert.equal((await get(gamePath)).enabled, false);
  console.log('PASS authenticated student Firestore clients cannot read or write game management settings');
  console.log('Weplay management emulator verification completed: all groups passed.');
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
