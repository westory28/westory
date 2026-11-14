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
const { catalog, defaultLook, lookHash } = require('../studentAvatarCatalog');
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
  await check('avatar-shop closure blocks purchases and replays, preserves wardrobe, and supports legacy menu settings', async () => {
    const closedSettings = [
      { config: { studentMenuVisibility: { mypage: true, avatar: true, avatar_shop: false } } },
      ...[{ url: '/student/points', hidden: true },
        ...['/student/points?tab=shop', '/student/points?shop=avatar&tab=shop'].map(url => ({
          url: '/student/points', children: [{ url, hidden: true }],
        }))].map(item => ({ config: { studentMenuVisibility: { mypage: true, avatar: true } }, menu: { student: [item] } })),
    ];
    for (const { config, menu } of closedSettings) {
      await seed();
      await api.purchaseStudentAvatarItem(authenticated(fixture.purchase()));
      const before = await db.doc(fixture.accountPath).get();
      const beforeAvatar = await db.doc(fixture.avatarPath).get();
      const beforeReceipts = (await db.collection(`${fixture.avatarPath}/requests`).get()).size;
      await db.doc('site_settings/config').set(config);
      if (menu) await db.doc('site_settings/menu_config').set(menu);
      for (const input of [fixture.purchase(), fixture.purchase(fixture.paid[1], 'hidden-new-purchase')]) {
        await assert.rejects(api.purchaseStudentAvatarItem(authenticated(input)), error => error.details?.reason === 'STUDENT_MENU_HIDDEN');
      }
      assert.equal((await db.doc(fixture.accountPath).get()).updateTime.toMillis(), before.updateTime.toMillis());
      assert.equal((await db.doc(fixture.avatarPath).get()).updateTime.toMillis(), beforeAvatar.updateTime.toMillis());
      assert.equal((await db.collection(`${fixture.avatarPath}/requests`).get()).size, beforeReceipts);
      assert.equal((await db.collection('semester_wis_ledger').get()).size, 1);
      const wardrobe = await api.getAvatarStudioState(authenticated(fixture.req({ year: '2026', semester: '2' })));
      assert.equal(wardrobe.balance, before.data().balance);
      const saved = await api.saveStudentAvatar(authenticated(await fixture.save({ expectedRevision: wardrobe.avatar.revision })));
      assert.equal(saved.revision, wardrobe.avatar.revision + 1);
      assert.equal((await db.doc(fixture.accountPath).get()).updateTime.toMillis(), before.updateTime.toMillis());
    }
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
  await check('item metadata saves atomically, rejects students and recovers concurrent edits without extra writes', async () => {
    await seed(); await seedTeacher();
    const [first, second] = fixture.paid;
    const metadataFor = item => ({ label: `수정 ${item.label}`, gender: 'unisex', description: '검증용 상품 설명' });
    const requestFor = item => ({ expectedRevision: 0, prices: { [item.id]: 88 }, metadata: { [item.id]: metadataFor(item) } });
    await assert.rejects(pricingApi.updateAvatarCatalogPricing(authenticated(fixture.req(requestFor(first)))),
      error => error.details?.reason === 'AVATAR_TEACHER_REQUIRED');
    assert.equal((await db.doc(PRICING_PATH).get()).exists, false);
    const results = await Promise.allSettled([first, second].map(item => pricingApi.updateAvatarCatalogPricing(teacherRequest(requestFor(item)))));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const conflict = results.find(result => result.status === 'rejected').reason;
    assert.equal(conflict.details.reason, 'AVATAR_PRICING_REVISION_CONFLICT');
    const failed = results[0].status === 'rejected' ? first : second;
    await pricingApi.updateAvatarCatalogPricing(teacherRequest({ ...requestFor(failed), expectedRevision: conflict.details.pricing.revision }));
    const beforeRetry = await db.doc(PRICING_PATH).get();
    // Both original requests now match current fields; each replay must be a read-only no-op.
    for (const item of [first, second]) await pricingApi.updateAvatarCatalogPricing(teacherRequest(requestFor(item)));
    const afterRetry = await db.doc(PRICING_PATH).get();
    assert.equal(afterRetry.updateTime.toMillis(), beforeRetry.updateTime.toMillis());
    assert.equal(afterRetry.data().revision, 2);
    const studio = await api.getAvatarStudioState(authenticated(fixture.req({ year: '2026', semester: '2' })));
    for (const item of [first, second]) {
      assert.deepEqual(studio.pricing.metadata[item.id], metadataFor(item));
      assert.equal(studio.pricing.prices[item.id], 88);
    }
    assert.equal(studio.balance, 1000); assert.equal(studio.avatar.ownedItemIds.length, 0);
    await assert.rejects(pricingApi.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 2, prices: {},
      metadata: { [first.id]: { ...metadataFor(first), characters: ['boy'] } } })), error => error.details?.reason === 'AVATAR_PRICING_INPUT_INVALID');
    assert.equal((await db.doc(PRICING_PATH).get()).updateTime.toMillis(), beforeRetry.updateTime.toMillis());
  });
  await check('school uniforms stay free and retired choices cannot reconnect or grant new clothes', async () => {
    await seed(); await seedTeacher();
    await db.doc(PRICING_PATH).set({ schemaVersion: 1, revision: 1, prices: { 'minimi-top-knit-cream': 0, 'minimi-bottom-jeans': 0, 'minimi-top-school-hoodie': 999 } });
    const pricing = await pricingApi.getAvatarCatalogPricing(teacherRequest({}));
    assert.equal(pricing.prices['minimi-top-knit-cream'], 160); assert.equal(pricing.prices['minimi-bottom-jeans'], 100);
    assert.equal(pricing.prices['minimi-top-school-hoodie'], 0); assert.equal(pricing.policyVersion, 3);
    await assert.rejects(pricingApi.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices: { 'minimi-top-knit-cream': 0 } })),
      error => error.details?.reason === 'AVATAR_PRICING_INPUT_INVALID');
    const plain = catalog.items.find(item => item.id === 'minimi-top-knit-cream');
    const stale = authenticated(fixture.purchase(plain)); delete stale.data.expectedPricingPolicyVersion;
    await assert.rejects(api.purchaseStudentAvatarItem(stale), error => error.details?.reason === 'AVATAR_PRICE_CHANGED');
    const unownedLook = { ...defaultLook(), top: 'mm-knit-cream', bottom: 'mm-jeans' };
    await assert.rejects(api.saveStudentAvatar(authenticated(await fixture.save({ look: unownedLook }))), error => error.details?.reason === 'AVATAR_ITEM_NOT_OWNED');
    assert.equal((await db.collection('semester_wis_ledger').get()).size, 0);
    assert.equal((await db.doc(fixture.avatarPath).get()).exists, false);
    const uniformLook = { ...defaultLook(), top: 'mm-school-hoodie', bottom: 'mm-school-joggers' };
    await api.saveStudentAvatar(authenticated(await fixture.save({ look: uniformLook })));
    const saved = await get(fixture.avatarPath);
    await db.doc(fixture.avatarPath).set({ ...saved, catalogVersion: 1, look: unownedLook, lookHash: lookHash(unownedLook),
      ownedItemIds: ['minimi-top-sweat-blue'], lastSavedAtMs: 1 });
    const recovered = await api.getStudentAvatar(authenticated(fixture.req({})));
    assert.deepEqual(recovered.look, defaultLook()); assert.deepEqual(recovered.ownedItemIds, []);
    const result = await api.saveStudentAvatar(authenticated(await fixture.save({ look: defaultLook(), expectedRevision: 1, requestId: 'legacy-uniform-save' })));
    assert.equal(result.revision, 2);
    assert.equal((await get(fixture.accountPath)).balance, 1000);
    assert.equal((await db.collection('semester_wis_ledger').get()).size, 0);
  });
  await check('generation reset is idempotent, preserves receipts and money, and skips concurrent new avatars', async () => {
    await seed();
    const { resetAvatarOwner } = require('../avatarGenerationReset');
    const old = { schemaVersion: 1, catalogVersion: 1, studentUid: fixture.uid, revision: 7,
      look: { character: 'boy', hairStyle: 'old-hair' }, ownedItemIds: ['top:old'],
      thumbnailPath: 'student_avatar_thumbnails/v1/old.webp', lastSavedAtMs: 1 };
    await db.doc(fixture.avatarPath).set(old);
    await db.doc(`users/${fixture.uid}`).update({ avatar: { catalogVersion: 1, thumbnailUrl: 'old' }, profileIcon: '😀' });
    const receiptRef = db.doc(`${fixture.avatarPath}/requests/old-purchase`);
    await receiptRef.set({ charged: 100, immutable: true });
    const backups = [];
    const args = { db, uid: fixture.uid, audience: 'student', apply: true, backup: async value => backups.push(value) };
    assert.deepEqual(await resetAvatarOwner({ ...args, apply: false }), { inventory: true, projection: true });
    assert.equal((await get(fixture.avatarPath)).revision, 7);
    assert.deepEqual(await resetAvatarOwner(args), { inventory: true, projection: true });
    assert.equal((await get(fixture.avatarPath)).revision, 8);
    assert.deepEqual((await get(fixture.avatarPath)).ownedItemIds, []);
    assert.equal((await get(fixture.avatarPath)).thumbnailPath, undefined);
    assert.equal((await get(`users/${fixture.uid}`)).avatar, undefined);
    assert.equal((await get(`users/${fixture.uid}`)).profileIcon, '😀');
    assert.deepEqual((await receiptRef.get()).data(), { charged: 100, immutable: true });
    assert.equal((await get(fixture.accountPath)).balance, 1000); assert.equal(backups.length, 1);
    assert.deepEqual(await resetAvatarOwner(args), { inventory: false, projection: false });
    const current = await api.saveStudentAvatar(authenticated(await fixture.save({ expectedRevision: 8 })));
    assert.deepEqual(await resetAvatarOwner(args), { inventory: false, projection: false });
    assert.equal((await get(`users/${fixture.uid}`)).avatar.thumbnailUrl, current.thumbnailUrl);
    await db.doc('users/orphan-avatar').set({ role: 'student', avatar: { schemaVersion: 1, thumbnailUrl: 'old-unversioned' }, preserved: 'yes' });
    const candidates = await db.collection('users').where('avatar', '!=', null)
      .select('avatar', 'role').orderBy('avatar').get();
    assert.ok(candidates.docs.some(doc => doc.id === 'orphan-avatar'));
    const orphanArgs = { db, uid: 'orphan-avatar', audience: 'student', apply: true };
    await assert.rejects(resetAvatarOwner({ ...orphanArgs, backup: async () => { throw new Error('Backup unavailable'); } }));
    assert.equal((await get('users/orphan-avatar')).avatar.thumbnailUrl, 'old-unversioned');
    assert.deepEqual(await resetAvatarOwner(orphanArgs), { inventory: false, projection: true });
    assert.equal((await get('users/orphan-avatar')).avatar, undefined);
    assert.equal((await get('users/orphan-avatar')).preserved, 'yes');
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
    await assertFails(setDoc(doc(client, PRICING_PATH), { metadata: { [fixture.paid[0].id]: { label: '변조', gender: 'unisex', description: '' } } }));
    await assertFails(getDoc(doc(client, PRICING_PATH)));
    await assertFails(setDoc(doc(client, `teacher_avatars/${fixture.uid}`), { ownedItemIds: ['top:expensive'] }));
    await assertFails(getDoc(doc(client, 'users/foreign-student')));
    await seedTeacher();
    const teacherClient = rules.authenticatedContext(teacherUid, { email: 'teacher@yongshin-ms.ms.kr', auth_time: authTime }).firestore();
    await assertFails(setDoc(doc(teacherClient, PRICING_PATH), { prices: { [fixture.paid[0].id]: 0 } }));
    await assertFails(setDoc(doc(teacherClient, PRICING_PATH), { metadata: { [fixture.paid[0].id]: { label: '변조', gender: 'unisex', description: '' } } }));
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
