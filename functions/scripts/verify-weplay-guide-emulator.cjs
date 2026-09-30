const assert = require('node:assert/strict');
const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (project !== 'demo-westory-weplay-guide' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
  throw new Error('Run only with isolated demo-westory-weplay-guide Firestore/Auth emulators.');
}
const api = require('../index');
const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore();
const call = (uid, accountUid = uid, extra = {}, email = `${uid}@yongshin-ms.ms.kr`) => api.completeWeplayGuide.run({
  auth: uid ? { uid, token: { email } } : null,
  data: { accountUid, ...extra },
});
const rejectCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);
const profile = async (uid) => (await db.doc(`users/${uid}`).get()).data();

async function main() {
  const cleared = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.ok, true);
  const signup = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'guide-student@yongshin-ms.ms.kr', password: 'emulator-only-password', returnSecureToken: true }),
  });
  const account = await signup.json();
  assert.ok(account.localId && account.idToken);
  const uid = account.localId;
  await db.doc(`users/${uid}`).set({ uid, email: 'guide-student@yongshin-ms.ms.kr', role: 'student', name: '안내검증', grade: '2', class: '1', number: '9' });
  await db.doc('users/teacher').set({ uid: 'teacher', email: 'teacher@yongshin-ms.ms.kr', role: 'teacher' });
  await db.doc('users/staff').set({ uid: 'staff', role: 'staff', teacherPortalEnabled: true, staffPermissions: ['lesson_read'] });
  await db.doc('users/denied-staff').set({ uid: 'denied-staff', role: 'staff', teacherPortalEnabled: true, staffPermissions: ['point_read'] });
  await db.doc('users/deleted').set({ uid: 'deleted', role: 'student', isDeleted: true });
  const wallet = { uid, balance: 38, earnedTotal: 40, spentTotal: 2 };
  const walletRef = db.doc(`years/2026/semesters/2/point_wallets/${uid}`);
  await walletRef.set(wallet);

  await rejectCode(call(null), 'unauthenticated');
  await rejectCode(call(uid, uid, {}, 'outsider@example.com'), 'permission-denied');
  await rejectCode(call(uid, 'teacher'), 'permission-denied');
  await rejectCode(call('missing'), 'failed-precondition');
  await rejectCode(call('denied-staff'), 'permission-denied');
  await rejectCode(call('deleted'), 'permission-denied');
  assert.equal((await profile(uid)).weplayGuideCompleted, undefined);
  assert.equal((await profile('teacher')).weplayGuideCompleted, undefined);
  console.log('PASS actual school-account helper, authenticated owner guard, current role/permission and missing/deleted profile checks');

  const results = await Promise.all(Array.from({ length: 5 }, () => call(uid)));
  results.forEach((result) => assert.deepEqual(result, { uid, guideCompleted: true }));
  const first = await profile(uid);
  assert.equal(first.weplayGuideCompleted, true);
  assert.equal(typeof first.weplayGuideCompletedAt.toMillis(), 'number');
  const initialUpdate = (await db.doc(`users/${uid}`).get()).updateTime;
  await call(uid, uid, { year: '2027', semester: '1', uid: 'teacher' });
  const replaySnapshot = await db.doc(`users/${uid}`).get();
  assert.ok(replaySnapshot.updateTime.isEqual(initialUpdate), 'Completed guide replay must not write the user document');
  assert.ok(replaySnapshot.data().weplayGuideCompletedAt.isEqual(first.weplayGuideCompletedAt));
  assert.equal((await profile('teacher')).weplayGuideCompleted, undefined);
  for (const actor of ['teacher', 'staff']) assert.deepEqual(await call(actor), { uid: actor, guideCompleted: true });
  assert.deepEqual((await walletRef.get()).data(), wallet);
  assert.equal((await db.collectionGroup('point_transactions').get()).size, 0);
  assert.equal((await db.collectionGroup('weplay_sessions').get()).size, 0);
  console.log('PASS real concurrent one-time profile persistence, immutable completion timestamp/replay no-op, cross-semester data, teacher/staff support and zero game/Wis writes');

  const endpoint = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents/users/${uid}`;
  const headers = { authorization: `Bearer ${account.idToken}`, 'content-type': 'application/json' };
  const read = await fetch(endpoint, { headers });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).fields.weplayGuideCompleted.booleanValue, true);
  const reset = await fetch(`${endpoint}?updateMask.fieldPaths=weplayGuideCompleted`, {
    method: 'PATCH', headers, body: JSON.stringify({ fields: { weplayGuideCompleted: { booleanValue: false } } }),
  });
  assert.equal(reset.status, 403, 'Student cannot erase guide completion with a direct write');
  const ordinaryUpdate = await fetch(`${endpoint}?updateMask.fieldPaths=photoURL`, {
    method: 'PATCH', headers, body: JSON.stringify({ fields: { photoURL: { stringValue: '' } } }),
  });
  assert.equal(ordinaryUpdate.status, 200, 'Server-owned guide fields must not break existing own-profile updates');
  assert.equal((await profile(uid)).weplayGuideCompleted, true);
  await db.doc(`users/${uid}`).delete();
  await rejectCode(call(uid), 'failed-precondition');
  assert.equal(await profile(uid), undefined);
  console.log('PASS real authenticated profile read, direct completion reset denied, existing profile update preserved, deleted account never recreated');
  console.log('Weplay guide Firestore/Auth verification completed: all groups passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  const { getApps, deleteApp } = require('firebase-admin/app');
  await Promise.all(getApps().map(deleteApp));
});
