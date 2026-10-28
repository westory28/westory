const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const projectId = 'demo-westory-session-avatar';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^127\.0\.0\.1:\d+$/.test(host) || process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error('Only the dedicated local demo-westory-session-avatar emulator may run these fixtures.');
}
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const app = initializeApp({ projectId }), db = getFirestore(app);
const { createStudentAvatarHandlers, createStudentAvatarDeletionHandler } = require('../studentAvatar');
const { createAvatarCatalogPricingHandlers, PRICING_PATH } = require('../avatarCatalogPricing');
const { catalog } = require('../studentAvatarCatalog');
const fixture = require('./verify-student-avatar.cjs');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc } = require('firebase/firestore');
const authTime = Math.floor(Date.now() / 1000), revision = 'a'.repeat(64);
const sessionPath = `application_sessions/${fixture.uid}/sessions/${authTime}`;
const session = { status: 'active', authTime, schemaVersion: 2, authorityGeneration: 'w1r2-2026-08-09',
  protocolVersion: 2, sessionRevision: revision, authorityModeAtOpen: 'ENFORCE',
  generalExpiresAt: Timestamp.fromMillis(Date.now() + 600000), highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 600000) };
const authenticated = request => ({ ...request, auth: { uid: fixture.uid, token: { email: 'avatar@yongshin-ms.ms.kr', auth_time: authTime } },
  data: { ...request.data, _session: { authorityGeneration: session.authorityGeneration, protocolVersion: 2, revision } } });
const bucket = fixture.memoryBucket(), api = createStudentAvatarHandlers({ db, bucket });
const teacherUid = 'avatar-teacher';
const teacherApi = createStudentAvatarHandlers({ db, bucket, audience: 'teacher',
  loadPolicy: async tx => (await tx.get(db.doc('years/2026/semesters/2/point_policies/current'))).data() || {} });
const pricingApi = createAvatarCatalogPricingHandlers({ db });
const teacherRequest = data => {
  const request = authenticated(fixture.req(data));
  request.auth.uid = teacherUid; request.auth.token.email = 'teacher@yongshin-ms.ms.kr';
  return request;
};
const seedTeacher = async () => {
  await db.doc(`users/${teacherUid}`).set({ role: 'teacher', email: 'teacher@yongshin-ms.ms.kr', profileIcon: '😀' });
  await db.doc(`application_sessions/${teacherUid}/sessions/${authTime}`).set(session);
};
const seed = async (balance = 1000) => {
  assert.equal((await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok, true);
  const rows = { ...fixture.initialDocuments(balance), [sessionPath]: session };
  await Promise.all(Object.entries(rows).map(([name, data]) => db.doc(name).set(data)));
  bucket.objects.clear();
};
const get = async name => (await db.doc(name).get()).data();
const cases = [];
async function check(name, action) { await action(); cases.push(name); console.log(`PASS ${name}`); }
let rules;
(async () => {
  await check('real session authority: missing/mismatched/expired proof cannot read or save avatar', async () => {
    await seed();
    for (const badProof of [undefined, { authorityGeneration: session.authorityGeneration, protocolVersion: 2, revision: 'b'.repeat(64) }]) {
      const read = authenticated(fixture.req({})); read.data._session = badProof;
      const save = authenticated(await fixture.save()); save.data._session = badProof;
      for (const [handler, request] of [[api.getStudentAvatar, read], [api.saveStudentAvatar, save]]) {
        await assert.rejects(handler(request), error => error.code === 'unauthenticated');
      }
    }
    await db.doc(sessionPath).update({ generalExpiresAt: Timestamp.fromMillis(1) });
    await assert.rejects(api.getStudentAvatar(authenticated(fixture.req({}))), error => error.details?.reason === 'SESSION_EXPIRED');
    assert.equal((await db.doc(fixture.avatarPath).get()).exists, false); assert.equal(bucket.objects.size, 0);
  });
  await check('real maintenance guard prevents get/save/purchase without avatar or wallet mutations', async () => {
    await seed();
    await db.doc('site_settings/student_maintenance').set({ enabled: true, blockedRoles: ['student'], bypassUids: [],
      title: '검증 중', message: '합성 점검', revision: 1, startedAt: Timestamp.now(), updatedAt: Timestamp.now(), updatedBy: 'fixture-admin' });
    for (const [handler, request] of [[api.getStudentAvatar, fixture.req({})], [api.saveStudentAvatar, await fixture.save()], [api.purchaseStudentAvatarItem, fixture.purchase()]]) {
      await assert.rejects(handler(authenticated(request)), error => error.code === 'permission-denied' || error.code === 'unavailable');
    }
    assert.equal((await get(fixture.accountPath)).revision, 1); assert.equal(bucket.objects.size, 0);
  });
  await check('Firestore contention: four duplicate purchases produce exactly one debit', async () => {
    await seed();
    const values = await Promise.all(Array.from({ length: 4 }, () => api.purchaseStudentAvatarItem(authenticated(fixture.purchase()))));
    assert.equal(values.filter(value => !value.duplicate).length, 1);
    assert.equal((await db.collection('semester_wis_ledger').get()).size, 1);
    const account = await get(fixture.accountPath);
    assert.equal(account.balance, 1000 - fixture.paid[0].price); assert.equal(account.earnedTotal, 2000); assert.equal(account.rankEarnedTotal, 1900);
    const receipt = values[0].ledgerEntryId;
    assert.equal((await get(`semester_wis_ledger/${receipt}`)).type, 'ORDER_DEBIT');
  });
  await check('Firestore contention: different purchases cannot overspend or duplicate ownership', async () => {
    await seed(Math.max(fixture.paid[0].price, fixture.paid[1].price));
    const values = await Promise.allSettled([api.purchaseStudentAvatarItem(authenticated(fixture.purchase())),
      api.purchaseStudentAvatarItem(authenticated(fixture.purchase(fixture.paid[1], 'purchase-0002')))]);
    assert.equal(values.filter(value => value.status === 'fulfilled').length, 1);
    assert.ok((await get(fixture.accountPath)).balance >= 0);
    assert.equal((await db.collection('semester_wis_ledger').get()).size, 1);
  });
  await check('pricing uses real session/teacher authority and concurrent revision updates cannot overwrite each other', async () => {
    await seed(); await seedTeacher();
    await assert.rejects(pricingApi.getAvatarCatalogPricing(authenticated(fixture.req({}))), error => error.details?.reason === 'AVATAR_TEACHER_REQUIRED');
    const expired = teacherRequest({}); expired.data._session.revision = 'b'.repeat(64);
    await assert.rejects(pricingApi.getAvatarCatalogPricing(expired), error => error.code === 'unauthenticated');
    const values = await Promise.allSettled([73, 94].map(price => pricingApi.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices: { [fixture.paid[0].id]: price } }))));
    assert.equal(values.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(values.find(value => value.status === 'rejected').reason.details.reason, 'AVATAR_PRICING_REVISION_CONFLICT');
    const current = await get(PRICING_PATH);
    assert.equal(current.revision, 1);
    await assert.rejects(api.purchaseStudentAvatarItem(authenticated(fixture.purchase())), error => error.details?.reason === 'AVATAR_PRICE_CHANGED');
    const result = await api.purchaseStudentAvatarItem(authenticated(fixture.req({ ...fixture.purchase().data,
      expectedPricingRevision: 1, expectedPrice: current.prices[fixture.paid[0].id] })));
    assert.equal(result.charged, current.prices[fixture.paid[0].id]);
    assert.equal((await get(fixture.accountPath)).balance, 1000 - result.charged);
  });
  await check('teacher all-item save and emoji use real sessions without a teacher wallet and reject role downgrade during save', async () => {
    await seed(); await seedTeacher();
    const current = await teacherApi.getTeacherMyPage(teacherRequest({ year: '2026', semester: '2' }));
    assert.equal(current.avatar.ownedItemIds.length, catalog.items.length);
    const item = fixture.paid.find(value => value.characters.includes('girl'));
    const input = await fixture.save({ look: { ...current.avatar.look, [item.slot]: item.value } });
    await teacherApi.saveStudentAvatar(teacherRequest(input.data));
    await teacherApi.updateTeacherProfileIcon(teacherRequest({ year: '2026', semester: '2', emojiId: 'trophy' }));
    assert.equal((await get(`users/${teacherUid}`)).profileIcon, '🏆');
    assert.equal((await get(fixture.accountPath)).balance, 1000);
    assert.equal((await db.collection('semester_wis_ledger').get()).size, 0);
    await db.doc(`teacher_avatars/${teacherUid}`).update({ lastSavedAtMs: Date.now() - 10000 });
    bucket.afterSave = async () => db.doc(`users/${teacherUid}`).update({ role: 'student', teacherPortalEnabled: true });
    await assert.rejects(teacherApi.saveStudentAvatar(teacherRequest((await fixture.save({ ...input.data, expectedRevision: 1, requestId: 'teacher-downgrade' })).data)),
      error => error.details?.reason === 'AVATAR_TEACHER_REQUIRED');
    bucket.afterSave = null;
    assert.equal((await get(`teacher_avatars/${teacherUid}`)).revision, 1);
    assert.equal(bucket.objects.size, 1);
  });
  await check('real session save commits public projection and private inventory atomically', async () => {
    await seed(); const result = await api.saveStudentAvatar(authenticated(await fixture.save()));
    assert.equal(result.revision, 1);
    const profile = await get(`users/${fixture.uid}`), avatar = await get(fixture.avatarPath);
    assert.equal(profile.avatar.lookHash, avatar.lookHash); assert.equal(profile.avatar.thumbnailUrl, avatar.thumbnailUrl);
    assert.equal(profile.avatar.ownedItemIds, undefined); assert.equal(profile.avatar.studentUid, undefined);
  });
  await check('existing production rules deny direct avatar/ownership/receipt/ledger writes and foreign profile reads', async () => {
    const [hostname, port] = host.split(':');
    rules = await initializeTestEnvironment({ projectId, firestore: { host: hostname, port: Number(port), rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8') } });
    const client = rules.authenticatedContext(fixture.uid, { email: 'avatar@yongshin-ms.ms.kr', auth_time: authTime }).firestore();
    await assertSucceeds(updateDoc(doc(client, `users/${fixture.uid}`), { myPageGoalScore: '80' }));
    await assertFails(updateDoc(doc(client, `users/${fixture.uid}`), { avatar: { revision: 1000 } }));
    await assertFails(setDoc(doc(client, fixture.avatarPath), { studentUid: fixture.uid, ownedItemIds: ['top:expensive'] }));
    await assertFails(setDoc(doc(client, `${fixture.avatarPath}/requests/fake`), { result: 'owned' }));
    await assertFails(setDoc(doc(client, 'semester_wis_ledger/fake'), { delta: 999 }));
    await assertFails(setDoc(doc(client, PRICING_PATH), { prices: { [fixture.paid[0].id]: 0 } }));
    await assertFails(getDoc(doc(client, PRICING_PATH)));
    await assertFails(setDoc(doc(client, `teacher_avatars/${fixture.uid}`), { ownedItemIds: ['top:expensive'] }));
    await assertFails(getDoc(doc(client, 'users/foreign-student')));
    await seedTeacher();
    const teacherClient = rules.authenticatedContext(teacherUid, { email: 'teacher@yongshin-ms.ms.kr', auth_time: authTime }).firestore();
    await assertFails(setDoc(doc(teacherClient, PRICING_PATH), { prices: { [fixture.paid[0].id]: 0 } }));
    await assertFails(setDoc(doc(teacherClient, `teacher_avatars/${teacherUid}`), { ownedItemIds: ['top:expensive'] }));
  });
  await check('deletion pending prevents purchase; real recursive cleanup removes private descendants only and retries safely', async () => {
    await db.doc(`users/${fixture.uid}`).update({ weplayDeletionPending: true });
    await assert.rejects(api.purchaseStudentAvatarItem(authenticated(fixture.purchase())), error => error.code === 'permission-denied');
    const snapshot = await db.doc(`users/${fixture.uid}`).get();
    await db.doc('student_avatars/other/requests/keep').set({ untouched: true });
    await db.doc(`users/${fixture.uid}`).delete();
    const cleanup = createStudentAvatarDeletionHandler({ db, bucket });
    const event = { id: 'avatar-deletion-emulator', params: { uid: fixture.uid }, data: snapshot };
    await cleanup(event); await cleanup(event);
    assert.equal((await db.doc(fixture.avatarPath).get()).exists, false);
    assert.equal((await db.collection(`${fixture.avatarPath}/requests`).get()).size, 0);
    assert.equal((await db.doc('student_avatars/other/requests/keep').get()).exists, true);
    assert.equal((await db.doc(`student_avatar_deletions/${fixture.uid}`).get()).exists, false);
    assert.equal(bucket.objects.size, 0);
    assert.equal((await get(fixture.accountPath)).balance, 1000);
  });
  console.log(JSON.stringify({ passed: true, emulator: projectId, cases }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (rules) await rules.cleanup(); await deleteApp(app); });
