const assert = require('node:assert/strict');
const { test } = require('node:test');
const { HttpsError } = require('firebase-functions/v2/https');
const { fixture, uid, req, purchase, save, paid, accountPath } = require('./verify-student-avatar.cjs');
const { catalog, defaultLook, lookHash, sanitizePublicAvatar } = require('../studentAvatarCatalog');
const { createStudentAvatarHandlers, createStudentAvatarDeletionHandler } = require('../studentAvatar');
const { createAvatarCatalogPricingHandlers, PRICING_PATH, MAX_AVATAR_PRICE } = require('../avatarCatalogPricing');
const reason = expected => error => error.details?.reason === expected;
const teacherUid = 'avatar-teacher';
const auth = async request => ({ uid: request.auth.uid, email: request.auth.token?.email });
const teacherRequest = data => ({ auth: { uid: teacherUid, token: { email: 'teacher@yongshin-ms.ms.kr' } }, data: { _session: {}, ...data } });
const scopedTeacherRequest = data => teacherRequest({ year: '2026', semester: '2', ...data });
const setup = () => {
  const state = fixture();
  state.documents.set(`users/${teacherUid}`, { role: 'teacher', profileIcon: '😀', untouched: 'preserved' });
  state.pricing = createAvatarCatalogPricingHandlers({ db: state.db, assertSession: auth });
  state.teacher = createStudentAvatarHandlers({ db: state.db, bucket: state.bucket, audience: 'teacher', assertSession: auth,
    loadPolicy: async tx => (await tx.get(state.db.doc('fixture_policy/current'))).data() || {} });
  return state;
};
const setPrices = (state, prices, revision = 1) => state.documents.set(PRICING_PATH, { schemaVersion: 1, revision, prices });
const quotedPurchase = (item = paid[0], price = item.price, revision = 0, requestId = 'priced-purchase-1') =>
  req({ year: '2026', semester: '2', itemId: item.id, requestId, expectedPrice: price, expectedPricingRevision: revision,
    expectedPricingPolicyVersion: catalog.pricingPolicyVersion });

test('pricing read uses one policy document and settings authority excludes staff/student portal flags', async () => {
  const state = setup();
  const current = await state.pricing.getAvatarCatalogPricing(teacherRequest({}));
  assert.equal(current.revision, 0);
  assert.deepEqual(current.prices, Object.fromEntries(catalog.items.map(item => [item.id, item.price])));
  assert.equal(state.reads.filter(path => path === PRICING_PATH).length, 1);
  assert.equal(state.writes.length, 0);
  state.documents.set(`users/${uid}`, { role: 'student', teacherPortalEnabled: true, staffPermissions: ['point_manage'] });
  await assert.rejects(state.pricing.getAvatarCatalogPricing(req({})), reason('AVATAR_TEACHER_REQUIRED'));
  await assert.rejects(state.pricing.updateAvatarCatalogPricing(req({ expectedRevision: 0, prices: {} })), reason('AVATAR_TEACHER_REQUIRED'));
});

test('pricing bounds, allowed IDs, compare-and-swap, sparse overrides and no-op writes', async () => {
  const state = setup(), id = paid[0].id;
  for (const prices of [{ unknown: 0 }, { [id]: -1 }, { [id]: 0.5 }, { [id]: MAX_AVATAR_PRICE + 1 }, []]) {
    await assert.rejects(state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices })), reason('AVATAR_PRICING_INPUT_INVALID'));
  }
  const changed = await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices: { [id]: 0 } }));
  assert.equal(changed.revision, 1); assert.equal(changed.prices[id], 0);
  assert.deepEqual(state.documents.get(PRICING_PATH).prices, { [id]: 0 });
  await assert.rejects(state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices: { [id]: 77 } })), reason('AVATAR_PRICING_REVISION_CONFLICT'));
  const writes = state.writes.length;
  assert.equal((await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices: { [id]: 0 } }))).revision, 1);
  assert.equal(state.writes.length, writes);
  await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices: { [id]: paid[0].price } }));
  assert.deepEqual(state.documents.get(PRICING_PATH).prices, {});
});

test('student studio combines catalog, inventory and canonical balance without duplicate profile reads', async () => {
  const state = setup(); setPrices(state, { [paid[0].id]: 73 });
  const result = await state.api.getAvatarStudioState(req({ year: '2026', semester: '2' }));
  assert.equal(result.balance, 1000); assert.equal(result.wallet.balance, 1000);
  assert.equal(result.pricing.prices[paid[0].id], 73); assert.equal(result.avatar.revision, 0);
  for (const path of [`users/${uid}`, `student_identities/${uid}`, `student_avatars/${uid}`, PRICING_PATH]) {
    assert.equal(state.reads.filter(value => value === path).length, 1, path);
  }
  assert.equal(state.writes.length, 0);
  state.documents.get(`users/${uid}`).weplayDeletionPending = true;
  await assert.rejects(state.api.getAvatarStudioState(req({ year: '2026', semester: '2' })), reason('AVATAR_STUDENT_REQUIRED'));
});

test('school uniform policy normalizes old overrides consistently without migration writes', async () => {
  const state = setup();
  const free = catalog.items.filter(item => catalog.freeClothingItemIds.includes(item.id));
  const clothing = catalog.items.filter(item => ['top', 'bottom'].includes(item.slot) && item.price > 0);
  setPrices(state, { ...Object.fromEntries(free.map(item => [item.id, 900])),
    ...Object.fromEntries(clothing.map(item => [item.id, 0])), 'top:jacket-navy': 333 });
  const teacher = await state.pricing.getAvatarCatalogPricing(teacherRequest({}));
  const student = await state.api.getAvatarStudioState(req({ year: '2026', semester: '2' }));
  assert.deepEqual(student.pricing, teacher);
  assert.equal(teacher.policyVersion, 2);
  for (const item of free) assert.equal(teacher.prices[item.id], 0, item.id);
  for (const item of clothing) assert.equal(teacher.prices[item.id], item.id === 'top:jacket-navy' ? 333 : item.price, item.id);
  assert.equal(state.reads.filter(path => path === PRICING_PATH).length, 2);
  assert.equal(state.writes.length, 0);
  for (const prices of [{ 'top:summer-white': 1 }, { 'top:winter-hoodie': 1 }, { 'bottom:winter-joggers': 1 },
    { 'top:plain-top': 0 }, { 'bottom:plain-bottom': 0 }]) {
    await assert.rejects(state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices })), reason('AVATAR_PRICING_INPUT_INVALID'));
  }
  const changed = await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices: { 'top:plain-top': 222 } }));
  assert.equal(changed.prices['top:plain-top'], 222);
  assert.deepEqual(state.documents.get(PRICING_PATH).prices, { 'top:plain-top': 222, 'top:jacket-navy': 333 });
});

test('old policy quotes cannot debit newly paid clothes, and each school uniform saves free', async () => {
  const state = setup(), item = catalog.items.find(entry => entry.id === 'top:plain-top');
  for (const override of [{ expectedPricingPolicyVersion: undefined }, { expectedPricingPolicyVersion: 1 }, { expectedPrice: 0 }]) {
    const request = quotedPurchase(item); Object.assign(request.data, override);
    await assert.rejects(state.api.purchaseStudentAvatarItem(request), reason('AVATAR_PRICE_CHANGED'));
  }
  assert.equal(state.writes.length, 0);
  await assert.rejects(state.api.saveStudentAvatar(await save({ look: { ...defaultLook(), top: 'plain-top' } })), reason('AVATAR_ITEM_NOT_OWNED'));
  let revision = 0;
  for (const id of catalog.freeClothingItemIds) {
    const uniform = catalog.items.find(entry => entry.id === id);
    const result = await state.api.saveStudentAvatar(await save({ look: { ...defaultLook(), [uniform.slot]: uniform.value },
      expectedRevision: revision++, requestId: `free-uniform-${revision}` }));
    assert.ok(result.ownedItemIds.includes(id)); state.advance();
  }
  assert.equal(state.documents.get(accountPath).balance, 1000);
  assert.equal(state.writes.some(write => write.path.startsWith('semester_wis_')), false);
});

test('legacy saved free clothes and purchased inventory survive the catalog price increase', async () => {
  const state = setup(), look = { ...defaultLook(), top: 'plain-top', bottom: 'plain-bottom' };
  const old = { schemaVersion: 1, catalogVersion: 1, studentUid: uid, revision: 3,
    look, lookHash: lookHash(look), ownedItemIds: ['top:jacket-navy'], lastSavedAtMs: 1,
    thumbnailPath: 'student_avatar_thumbnails/v1/legacy/example.webp' };
  state.documents.set(`student_avatars/${uid}`, old);
  const current = await state.api.getStudentAvatar(req({}));
  assert.deepEqual(current.look, look);
  for (const id of ['top:plain-top', 'bottom:plain-bottom', 'top:jacket-navy']) assert.ok(current.ownedItemIds.includes(id));
  assert.ok(sanitizePublicAvatar(old));
  const result = await state.api.saveStudentAvatar(await save({ look, expectedRevision: 3 }));
  assert.deepEqual(result.look, look);
  const purchased = await state.api.purchaseStudentAvatarItem(quotedPurchase(catalog.items.find(item => item.id === 'top:plain-top')));
  assert.equal(purchased.charged, 0);
  assert.equal(state.documents.get(accountPath).balance, 1000);
});

test('current server prices gate old/stale clients and quoted purchase debits once', async () => {
  const state = setup(); setPrices(state, { [paid[0].id]: 73 });
  for (const request of [purchase(), quotedPurchase(paid[0], paid[0].price, 0), quotedPurchase(paid[0], 72, 1)]) {
    await assert.rejects(state.api.purchaseStudentAvatarItem(request), error => reason('AVATAR_PRICE_CHANGED')(error)
      && error.details.currentPrice === 73 && error.details.pricing.revision === 1);
  }
  assert.equal(state.writes.length, 0);
  const request = quotedPurchase(paid[0], 73, 1);
  const result = await state.api.purchaseStudentAvatarItem(request);
  assert.equal(result.charged, 73); assert.equal(result.wallet.balance, 927);
  setPrices(state, { [paid[0].id]: 800 }, 2);
  assert.equal((await state.api.purchaseStudentAvatarItem(request)).charged, 73);
  assert.equal(state.documents.get(accountPath).balance, 927);
  assert.equal((await state.api.purchaseStudentAvatarItem(quotedPurchase(paid[0], 800, 2, 'already-owned-2'))).charged, 0);
});

test('paid override on an unrestricted free default cannot be bypassed by save or buying an unrelated item', async () => {
  const state = setup(), id = `expression:${defaultLook().expression}`;
  setPrices(state, { [id]: 91 });
  await assert.rejects(state.api.saveStudentAvatar(await save()), error => reason('AVATAR_ITEM_NOT_OWNED')(error)
    && error.details.pricing.prices[id] === 91);
  await state.api.purchaseStudentAvatarItem(quotedPurchase(paid[0], paid[0].price, 1));
  const current = await state.api.getStudentAvatar(req({}));
  assert.equal(current.ownedItemIds.includes(id), false);
  await assert.rejects(state.api.saveStudentAvatar(await save({ expectedRevision: 1 })), reason('AVATAR_ITEM_NOT_OWNED'));
});

test('items actually saved while free remain owned after a later price increase', async () => {
  const state = setup(), item = paid.find(item => item.characters.includes('girl'));
  const look = { ...defaultLook(), [item.slot]: item.value };
  setPrices(state, { [item.id]: 0 });
  const first = await state.api.saveStudentAvatar(await save({ look }));
  assert.ok(first.ownedItemIds.includes(item.id));
  setPrices(state, { [item.id]: 900 }, 2); state.advance();
  const second = await state.api.saveStudentAvatar(await save({ look, expectedRevision: 1, requestId: 'saved-free-again' }));
  assert.ok(second.ownedItemIds.includes(item.id)); assert.equal(state.documents.get(accountPath).balance, 1000);
});

test('price changes during thumbnail upload fail atomically and leave no free ownership or image orphan', async () => {
  const state = setup(), id = `expression:${defaultLook().expression}`;
  state.bucket.afterSave = async () => setPrices(state, { [id]: 99 });
  await assert.rejects(state.api.saveStudentAvatar(await save()), reason('AVATAR_ITEM_NOT_OWNED'));
  assert.equal(state.documents.has(`student_avatars/${uid}`), false); assert.equal(state.bucket.objects.size, 0);
});

test('teacher My Page returns all items and enabled emoji choices with no wallet or pricing lookup', async () => {
  const state = setup();
  state.documents.set('fixture_policy/current', { rankPolicy: { emojiRegistry: [
    { id: 'smile', emoji: '😀', label: '웃음', enabled: true },
    { id: 'teacher_star', emoji: '⭐', label: '별', enabled: true },
    { id: 'hidden', emoji: '❌', label: '숨김', enabled: false },
  ] } });
  const page = await state.teacher.getTeacherMyPage(scopedTeacherRequest({}));
  assert.equal(page.allAvailable, true); assert.equal(page.avatar.ownedItemIds.length, catalog.items.length);
  assert.deepEqual(page.emojiRegistry.map(item => item.id), ['smile', 'teacher_star']);
  const emoji = await state.teacher.updateTeacherProfileIcon(scopedTeacherRequest({ emojiId: 'teacher_star' }));
  assert.equal(emoji.profileIcon, '⭐'); assert.equal(state.documents.get(`users/${teacherUid}`).untouched, 'preserved');
  await assert.rejects(state.teacher.updateTeacherProfileIcon(scopedTeacherRequest({ emojiId: 'hidden' })), reason('AVATAR_EMOJI_INVALID'));
  assert.equal(state.reads.some(path => path.startsWith('semester_wis_') || path === PRICING_PATH), false);
});

test('teacher can save paid items into own isolated namespace without ledger or student changes', async () => {
  const state = setup(), look = defaultLook();
  for (const item of paid.filter(item => item.characters.includes('girl') && item.slot !== 'character')) look[item.slot] = item.value;
  const input = await save({ look });
  const result = await state.teacher.saveStudentAvatar(teacherRequest(input.data));
  assert.equal(result.revision, 1); assert.equal(result.ownedItemIds.length, catalog.items.length);
  assert.ok(result.thumbnailUrl.includes('teacher_avatar_thumbnails%2Fv1%2F'));
  assert.ok(state.documents.has(`teacher_avatars/${teacherUid}`));
  assert.equal(state.documents.get(`users/${teacherUid}`).avatar.ownedItemIds, undefined);
  assert.equal(state.documents.get(accountPath).balance, 1000);
  assert.equal(state.writes.some(write => write.path.startsWith('semester_wis_') || write.path.startsWith('student_avatars/')), false);
  const duplicate = await state.teacher.saveStudentAvatar(teacherRequest(input.data)); assert.equal(duplicate.duplicate, true);
});

test('teacher profile rejects student portal grants, foreign owner fields and invalid sessions', async () => {
  const state = setup();
  state.documents.set(`users/${uid}`, { role: 'student', teacherPortalEnabled: true, staffPermissions: ['point_manage'] });
  await assert.rejects(state.teacher.getTeacherMyPage(req({ year: '2026', semester: '2' })), reason('AVATAR_TEACHER_REQUIRED'));
  await assert.rejects(state.teacher.saveStudentAvatar(await save()), reason('AVATAR_TEACHER_REQUIRED'));
  await assert.rejects(state.teacher.getTeacherMyPage(scopedTeacherRequest({ uid: 'another' })), reason('AVATAR_INPUT_INVALID'));
  const rejected = createStudentAvatarHandlers({ db: state.db, audience: 'teacher', assertSession: async () => { throw new HttpsError('unauthenticated', 'Expired'); } });
  const reads = state.reads.length;
  await assert.rejects(rejected.getTeacherMyPage(scopedTeacherRequest({})), error => error.code === 'unauthenticated');
  assert.equal(state.reads.length, reads); assert.equal(state.writes.length, 0);
});

test('teacher boy skirt recovery is read-only and teacher access cannot bypass garment compatibility', async () => {
  const state = setup(), look = { ...defaultLook('boy'), bottom: 'pleated-lilac' };
  const old = { schemaVersion: 1, catalogVersion: catalog.version, teacherUid, revision: 2,
    look, lookHash: lookHash(look), ownedItemIds: [], thumbnailUrl: 'legacy-thumbnail', lastSavedAtMs: 1 };
  state.documents.set(`teacher_avatars/${teacherUid}`, structuredClone(old));
  const result = await state.teacher.getTeacherMyPage(scopedTeacherRequest({}));
  assert.deepEqual(result.avatar.look, defaultLook('boy'));
  assert.equal(result.avatar.requiresThumbnailRefresh, true);
  assert.equal(result.avatar.thumbnailUrl, undefined);
  assert.deepEqual(state.documents.get(`teacher_avatars/${teacherUid}`), old);
  assert.equal(state.writes.length, 0);
  const input = await save({ look, expectedRevision: 2 });
  await assert.rejects(state.teacher.saveStudentAvatar(teacherRequest(input.data)), reason('AVATAR_INPUT_INVALID'));
  assert.equal(state.writes.length, 0);
  assert.equal(state.bucket.objects.size, 0);
});

test('teacher deletion removes only own private inventory and thumbnail prefix', async () => {
  const state = setup();
  await state.teacher.saveStudentAvatar(teacherRequest((await save()).data));
  state.documents.set('teacher_avatars/other/requests/keep', { untouched: true });
  state.documents.delete(`users/${teacherUid}`);
  const cleanup = createStudentAvatarDeletionHandler({ db: state.db, bucket: state.bucket, audience: 'teacher' });
  await cleanup({ id: 'teacher-deletion-1', params: { uid: teacherUid }, data: { data: () => ({ role: 'teacher' }) } });
  assert.equal(state.documents.has(`teacher_avatars/${teacherUid}`), false);
  assert.equal(state.documents.has('teacher_avatars/other/requests/keep'), true);
  assert.equal(state.bucket.objects.size, 0); assert.equal(state.documents.get(accountPath).balance, 1000);
});

test('teacher deletion cleans former teachers after a role change and skips unrelated profiles without writes', async () => {
  const state = setup();
  await state.teacher.saveStudentAvatar(teacherRequest((await save()).data));
  state.documents.delete(`users/${teacherUid}`);
  const cleanup = createStudentAvatarDeletionHandler({ db: state.db, bucket: state.bucket, audience: 'teacher' });
  await cleanup({ id: 'former-teacher-deletion', params: { uid: teacherUid }, data: { data: () => ({ role: 'staff' }) } });
  assert.equal(state.documents.has(`teacher_avatars/${teacherUid}`), false);
  assert.equal(state.bucket.objects.size, 0);
  const reads = state.reads.length, writes = state.writes.length;
  await cleanup({ id: 'ordinary-student-deletion', params: { uid: 'other-student' }, data: { data: () => ({ role: 'student' }) } });
  assert.deepEqual(state.reads.slice(reads), ['teacher_avatars/other-student', 'teacher_avatar_deletions/other-student']);
  assert.equal(state.writes.length, writes);
});

test('former teacher deletion retries its final lock cleanup after inventory removal and ignores another event lock', async () => {
  const state = setup();
  await state.teacher.saveStudentAvatar(teacherRequest((await save()).data));
  state.documents.delete(`users/${teacherUid}`);
  const originalTransaction = state.db.runTransaction.bind(state.db);
  let calls = 0;
  state.db.runTransaction = (...args) => {
    calls += 1;
    if (calls === 2) throw new Error('Final lock cleanup temporarily unavailable');
    return originalTransaction(...args);
  };
  const cleanup = createStudentAvatarDeletionHandler({ db: state.db, bucket: state.bucket, audience: 'teacher' });
  const event = { id: 'former-teacher-retry', params: { uid: teacherUid }, data: { data: () => ({ role: 'staff' }) } };
  await assert.rejects(cleanup(event), /temporarily unavailable/);
  assert.equal(state.documents.has(`teacher_avatars/${teacherUid}`), false);
  assert.equal(state.documents.has(`teacher_avatar_deletions/${teacherUid}`), true);
  const writes = state.writes.length;
  await cleanup({ ...event, id: 'different-teacher-event' });
  assert.equal(state.documents.has(`teacher_avatar_deletions/${teacherUid}`), true);
  assert.equal(state.writes.length, writes);
  await cleanup(event);
  assert.equal(state.documents.has(`teacher_avatar_deletions/${teacherUid}`), false);
  assert.equal(state.bucket.objects.size, 0);
  const cleanedWrites = state.writes.length;
  await cleanup(event);
  assert.equal(state.writes.length, cleanedWrites);
});
