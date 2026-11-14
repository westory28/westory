const assert = require('node:assert/strict');
const { test } = require('node:test');
const { HttpsError } = require('firebase-functions/v2/https');
const { fixture, uid, req, purchase, save, paid, accountPath } = require('./verify-student-avatar.cjs');
const { catalog, defaultLook, lookHash, sanitizePublicAvatar, itemIdFor, itemMetadata, validateLook } = require('../studentAvatarCatalog');
const { createStudentAvatarHandlers, createStudentAvatarDeletionHandler } = require('../studentAvatar');
const { createAvatarCatalogPricingHandlers, PRICING_PATH, MAX_AVATAR_PRICE, MAX_AVATAR_LABEL_LENGTH, MAX_AVATAR_DESCRIPTION_LENGTH } = require('../avatarCatalogPricing');
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
  const state = setup(), id = itemIdFor('expression', 'mm-wink');
  for (const prices of [{ unknown: 0 }, { [id]: -1 }, { [id]: 0.5 }, { [id]: MAX_AVATAR_PRICE + 1 }, []]) {
    await assert.rejects(state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices })), reason('AVATAR_PRICING_INPUT_INVALID'));
  }
  const changed = await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices: { [id]: 50 } }));
  assert.equal(changed.revision, 1); assert.equal(changed.prices[id], 50);
  assert.deepEqual(state.documents.get(PRICING_PATH).prices, { [id]: 50 });
  await assert.rejects(state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices: { [id]: 77 } })), reason('AVATAR_PRICING_REVISION_CONFLICT'));
  const writes = state.writes.length;
  assert.equal((await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices: { [id]: 50 } }))).revision, 1);
  assert.equal(state.writes.length, writes);
  await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices: { [id]: 0 } }));
  assert.deepEqual(state.documents.get(PRICING_PATH).prices, {});
});

test('legacy price documents supply item metadata without migration writes or extra reads', async () => {
  const state = setup(); setPrices(state, { [paid[0].id]: 73 });
  const result = await state.pricing.getAvatarCatalogPricing(teacherRequest({}));
  assert.deepEqual(result.metadata, Object.fromEntries(catalog.items.map(item => [item.id, itemMetadata(item)])));
  assert.deepEqual(state.reads, [`users/${teacherUid}`, PRICING_PATH]);
  assert.equal(state.writes.length, 0);
  assert.equal(state.documents.get(PRICING_PATH).metadata, undefined);
});

test('one product saves name, gender, description and price atomically with one settings write', async () => {
  const state = setup(), item = paid[0], other = paid[1];
  const request = teacherRequest({ expectedRevision: 0, prices: { [item.id]: 321 },
    metadata: { [item.id]: { label: '  밤하늘 머리  ', gender: 'boy', description: '  별빛을 담은 머리\n짧은 앞머리  ' } } });
  const result = await state.pricing.updateAvatarCatalogPricing(request);
  assert.equal(result.revision, 1); assert.equal(result.prices[item.id], 321);
  assert.deepEqual(result.metadata[item.id], { label: '밤하늘 머리', gender: 'boy', description: '별빛을 담은 머리\n짧은 앞머리' });
  assert.deepEqual(result.metadata[other.id], itemMetadata(other));
  assert.deepEqual(state.reads, [`users/${teacherUid}`, PRICING_PATH]);
  assert.deepEqual(state.writes.map(write => write.path), [PRICING_PATH]);
  const stored = state.documents.get(PRICING_PATH);
  assert.equal(stored.updatedBy, teacherUid); assert.ok(stored.updatedAt);
  assert.deepEqual(stored.prices, { [item.id]: 321 });
  assert.deepEqual(stored.metadata, { [item.id]: result.metadata[item.id] });
  const writes = state.writes.length;
  // Lost response retry carries the original revision and must never create another write.
  assert.deepEqual(await state.pricing.updateAvatarCatalogPricing(request), result);
  assert.equal(state.writes.length, writes);
  const student = await state.api.getAvatarStudioState(req({ year: '2026', semester: '2' }));
  assert.deepEqual(student.pricing, result);
  assert.equal(state.writes.length, writes);
});

test('metadata validation rejects malformed fields before document reads and writes', async () => {
  const state = setup(), id = paid[0].id;
  const valid = { label: '새 이름', gender: 'unisex', description: '짧은 설명' };
  for (const metadata of [null, [], { unknown: valid }, { [id]: null },
    { [id]: { ...valid, label: '' } }, { [id]: { ...valid, label: '  ' } },
    { [id]: { ...valid, label: '가'.repeat(MAX_AVATAR_LABEL_LENGTH + 1) } },
    { [id]: { ...valid, label: '두\n이름' } }, { [id]: { ...valid, gender: 'all' } },
    { [id]: { ...valid, description: 1 } }, { [id]: { ...valid, description: '\u0000' } },
    { [id]: { ...valid, description: '가'.repeat(MAX_AVATAR_DESCRIPTION_LENGTH + 1) } },
    { [id]: { ...valid, characters: ['girl', 'boy'] } }, { [id]: { label: '누락', gender: 'girl' } }]) {
    await assert.rejects(state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices: {}, metadata })),
      reason('AVATAR_PRICING_INPUT_INVALID'));
  }
  assert.equal(state.reads.length, 0); assert.equal(state.writes.length, 0);
  const boundary = { label: '가'.repeat(MAX_AVATAR_LABEL_LENGTH), gender: 'girl', description: '나'.repeat(MAX_AVATAR_DESCRIPTION_LENGTH) };
  assert.deepEqual((await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices: {}, metadata: { [id]: boundary } }))).metadata[id], boundary);
});

test('corrupt stored metadata fails closed for teacher and student without repair writes', async () => {
  for (const metadata of [[], null, { [paid[0].id]: { label: '손상', gender: 'invalid', description: '' } }]) {
    const state = setup();
    state.documents.set(PRICING_PATH, { schemaVersion: 1, revision: 1, prices: {}, metadata });
    await assert.rejects(state.pricing.getAvatarCatalogPricing(teacherRequest({})), reason('AVATAR_PRICING_INVALID'));
    await assert.rejects(state.api.getAvatarStudioState(req({ year: '2026', semester: '2' })), reason('AVATAR_PRICING_INVALID'));
    assert.equal(state.writes.length, 0);
  }
});

test('price-only clients preserve metadata and reverting metadata removes only its override', async () => {
  const state = setup(), item = paid[0];
  const metadata = { ...itemMetadata(item), label: '수정 이름', gender: 'boy', description: '설명' };
  await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices: {}, metadata: { [item.id]: metadata } }));
  const priced = await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices: { [item.id]: 123 } }));
  assert.deepEqual(priced.metadata[item.id], metadata);
  const reverted = await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 2, prices: {}, metadata: { [item.id]: itemMetadata(item) } }));
  assert.deepEqual(reverted.metadata[item.id], itemMetadata(item));
  assert.deepEqual(state.documents.get(PRICING_PATH).metadata, {});
  assert.deepEqual(state.documents.get(PRICING_PATH).prices, { [item.id]: 123 });
});

test('competing item edits expose latest fields and recover with a new revision without losing the other item', async () => {
  const state = setup(), [first, second] = paid;
  const requestFor = item => teacherRequest({ expectedRevision: 0, prices: {}, metadata: { [item.id]: { ...itemMetadata(item), label: `수정 ${item.label}` } } });
  const results = await Promise.allSettled([first, second].map(item => state.pricing.updateAvatarCatalogPricing(requestFor(item))));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const conflict = results.find(result => result.status === 'rejected').reason;
  assert.equal(conflict.details.reason, 'AVATAR_PRICING_REVISION_CONFLICT');
  assert.equal(conflict.details.pricing.revision, 1);
  assert.equal(state.writes.length, 1);
  const failedItem = results[0].status === 'rejected' ? first : second;
  const retry = requestFor(failedItem); retry.data.expectedRevision = conflict.details.pricing.revision;
  const recovered = await state.pricing.updateAvatarCatalogPricing(retry);
  for (const item of [first, second]) assert.equal(recovered.metadata[item.id].label, `수정 ${item.label}`);
  assert.equal(state.writes.length, 2);
});

test('gender classification never grants a body shape or changes an existing saved look', async () => {
  const state = setup(), skirt = catalog.items.find(item => item.id === 'minimi-bottom-skirt-navy');
  const before = [...skirt.characters];
  const saved = await state.api.saveStudentAvatar(await save());
  const oldAvatar = structuredClone(state.documents.get(`student_avatars/${uid}`));
  await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices: {},
    metadata: { [skirt.id]: { ...itemMetadata(skirt), gender: 'unisex' } } }));
  assert.deepEqual(skirt.characters, before);
  assert.equal(validateLook({ ...defaultLook('boy'), bottom: skirt.value }), null);
  const current = await state.api.getStudentAvatar(req({}));
  assert.deepEqual(current.look, saved.look); assert.deepEqual(current.ownedItemIds, saved.ownedItemIds);
  assert.deepEqual(structuredClone(state.documents.get(`student_avatars/${uid}`)), oldAvatar);
});

test('metadata revision changes require a fresh purchase quote and ledger keeps the purchased name', async () => {
  const state = setup(), item = paid[0];
  const metadata = { ...itemMetadata(item), label: '별빛 머리', description: '반짝이는 머리' };
  await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices: {}, metadata: { [item.id]: metadata } }));
  await assert.rejects(state.api.purchaseStudentAvatarItem(quotedPurchase(item)), error => reason('AVATAR_PRICE_CHANGED')(error)
    && error.details.pricing.metadata[item.id].label === metadata.label);
  assert.equal(state.writes.length, 1);
  const result = await state.api.purchaseStudentAvatarItem(quotedPurchase(item, item.price, 1));
  assert.equal(state.documents.get(`semester_wis_ledger/${result.ledgerEntryId}`).reason, `아바타 구매: ${metadata.label}`);
  const writes = state.writes.length;
  const duplicate = await state.api.purchaseStudentAvatarItem(quotedPurchase(item, item.price, 1));
  assert.equal(duplicate.duplicate, true); assert.equal(state.writes.length, writes);
  assert.equal(state.documents.get(accountPath).balance, 1000 - item.price);
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
    ...Object.fromEntries(clothing.map(item => [item.id, 0])), 'minimi-top-sweat-blue': 333 });
  const teacher = await state.pricing.getAvatarCatalogPricing(teacherRequest({}));
  const student = await state.api.getAvatarStudioState(req({ year: '2026', semester: '2' }));
  assert.deepEqual(student.pricing, teacher);
  assert.equal(teacher.policyVersion, 3);
  for (const item of free) assert.equal(teacher.prices[item.id], 0, item.id);
  for (const item of clothing) assert.equal(teacher.prices[item.id], item.id === 'minimi-top-sweat-blue' ? 333 : item.price, item.id);
  assert.equal(state.reads.filter(path => path === PRICING_PATH).length, 2);
  assert.equal(state.writes.length, 0);
  for (const prices of [{ 'minimi-top-school-white': 1 }, { 'minimi-top-school-hoodie': 1 }, { 'minimi-bottom-school-joggers': 1 },
    { 'minimi-top-knit-cream': 0 }, { 'minimi-bottom-jeans': 0 }]) {
    await assert.rejects(state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices })), reason('AVATAR_PRICING_INPUT_INVALID'));
  }
  const changed = await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices: { 'minimi-top-knit-cream': 222 } }));
  assert.equal(changed.prices['minimi-top-knit-cream'], 222);
  assert.deepEqual(state.documents.get(PRICING_PATH).prices, { 'minimi-top-knit-cream': 222, 'minimi-top-sweat-blue': 333 });
});

test('old policy quotes cannot debit newly paid clothes, and each school uniform saves free', async () => {
  const state = setup(), item = catalog.items.find(entry => entry.id === 'minimi-top-knit-cream');
  for (const override of [{ expectedPricingPolicyVersion: undefined }, { expectedPricingPolicyVersion: 1 }, { expectedPrice: 0 }]) {
    const request = quotedPurchase(item); Object.assign(request.data, override);
    await assert.rejects(state.api.purchaseStudentAvatarItem(request), reason('AVATAR_PRICE_CHANGED'));
  }
  assert.equal(state.writes.length, 0);
  await assert.rejects(state.api.saveStudentAvatar(await save({ look: { ...defaultLook(), top: 'mm-knit-cream' } })), reason('AVATAR_ITEM_NOT_OWNED'));
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

test('legacy inventory cannot grant new minimi clothes or reuse the old public image', async () => {
  const state = setup();
  const old = { schemaVersion: 1, catalogVersion: 1, studentUid: uid, revision: 3,
    look: { top: 'plain-top', bottom: 'plain-bottom' }, lookHash: 'old-hash',
    ownedItemIds: ['top:jacket-navy'], lastSavedAtMs: 1,
    thumbnailPath: 'student_avatar_thumbnails/v1/legacy/example.webp' };
  state.documents.set(`student_avatars/${uid}`, old);
  const current = await state.api.getStudentAvatar(req({}));
  assert.deepEqual(current.look, defaultLook()); assert.deepEqual(current.ownedItemIds, []);
  assert.equal(sanitizePublicAvatar(old), null);
  await assert.rejects(state.api.saveStudentAvatar(await save({
    look: { ...defaultLook(), top: 'mm-knit-cream' }, expectedRevision: 3
  })), reason('AVATAR_ITEM_NOT_OWNED'));
  assert.equal(state.documents.get(accountPath).balance, 1000); assert.equal(state.writes.length, 0);
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
  const state = setup(), id = itemIdFor('expression', defaultLook().expression);
  setPrices(state, { [id]: 91 });
  await assert.rejects(state.api.saveStudentAvatar(await save()), error => reason('AVATAR_ITEM_NOT_OWNED')(error)
    && error.details.pricing.prices[id] === 91);
  await state.api.purchaseStudentAvatarItem(quotedPurchase(paid[0], paid[0].price, 1));
  const current = await state.api.getStudentAvatar(req({}));
  assert.equal(current.ownedItemIds.includes(id), false);
  await assert.rejects(state.api.saveStudentAvatar(await save({ expectedRevision: 1 })), reason('AVATAR_ITEM_NOT_OWNED'));
});

test('items actually saved while free remain owned after a later price increase', async () => {
  const state = setup(), item = catalog.items.find(item => item.id === itemIdFor('expression', 'mm-wink'));
  const look = { ...defaultLook(), [item.slot]: item.value };
  setPrices(state, { [item.id]: 0 });
  const first = await state.api.saveStudentAvatar(await save({ look }));
  assert.ok(first.ownedItemIds.includes(item.id));
  setPrices(state, { [item.id]: 900 }, 2); state.advance();
  const second = await state.api.saveStudentAvatar(await save({ look, expectedRevision: 1, requestId: 'saved-free-again' }));
  assert.ok(second.ownedItemIds.includes(item.id)); assert.equal(state.documents.get(accountPath).balance, 1000);
});

test('price changes during thumbnail upload fail atomically and leave no free ownership or image orphan', async () => {
  const state = setup(), id = itemIdFor('expression', defaultLook().expression);
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
  assert.ok(result.thumbnailUrl.includes('teacher_avatar_thumbnails%2Fv2%2F'));
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

test('teacher legacy selections reset and current garment compatibility still applies', async () => {
  const state = setup(), look = { ...defaultLook('boy'), bottom: 'pleated-lilac' };
  state.documents.set(`teacher_avatars/${teacherUid}`, { schemaVersion: 1, catalogVersion: 1,
    teacherUid, revision: 2, look, lookHash: lookHash(look), ownedItemIds: [], thumbnailUrl: 'legacy-thumbnail' });
  const result = await state.teacher.getTeacherMyPage(scopedTeacherRequest({}));
  assert.deepEqual(result.avatar.look, defaultLook()); assert.equal(result.avatar.requiresThumbnailRefresh, undefined);
  assert.equal(result.avatar.thumbnailUrl, undefined); assert.equal(state.writes.length, 0);
  await assert.rejects(state.teacher.saveStudentAvatar(teacherRequest((await save({
    look: { ...defaultLook('boy'), bottom: 'mm-skirt-navy' }, expectedRevision: 2
  })).data)), reason('AVATAR_INPUT_INVALID'));
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
