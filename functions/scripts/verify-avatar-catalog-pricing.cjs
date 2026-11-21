const assert = require('node:assert/strict');
const { test } = require('node:test');
const { HttpsError } = require('firebase-functions/v2/https');
const { fixture, uid, req, purchase, save, paid, accountPath } = require('./verify-student-avatar.cjs');
const { catalog, defaultLook, lookHash, sanitizePublicAvatar, itemIdFor, itemMetadata, itemMinPurchaseTier, PURCHASE_TIER_CODES, validateLook, validateWearableLook, canWearItem } = require('../studentAvatarCatalog');
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
const rankPolicyPath = 'years/2026/semesters/2/point_policies/current';

test('purchase tiers preserve legacy defaults and catalog restrictions without migration writes', async () => {
  const state = setup(); setPrices(state, {});
  const result = await state.pricing.getAvatarCatalogPricing(teacherRequest({}));
  assert.deepEqual(result.purchaseTiers, Object.fromEntries(catalog.items.map(item => [item.id, itemMinPurchaseTier(item)])));
  assert.equal(itemMinPurchaseTier({}), 'tier_1');
  assert.deepEqual(state.reads, [`users/${teacherUid}`, PRICING_PATH]);
  assert.equal(state.writes.length, 0); assert.equal(state.documents.get(PRICING_PATH).purchaseTiers, undefined);
});

test('tier-only updates are validated, sparse and idempotent and legacy updates retain restrictions', async () => {
  const state = setup(), item = paid[0], id = item.id;
  for (const purchaseTiers of [null, [], { unknown: 'tier_1' }, { [id]: 'tier_0' }, { [id]: 'tier_6' }, { [id]: 5 }]) {
    await assert.rejects(state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, purchaseTiers })), reason('AVATAR_PRICING_INPUT_INVALID'));
  }
  assert.equal(state.reads.length, 0); assert.equal(state.writes.length, 0);
  const request = teacherRequest({ expectedRevision: 0, purchaseTiers: { [id]: 'tier_5' } });
  const result = await state.pricing.updateAvatarCatalogPricing(request);
  assert.equal(result.purchaseTiers[id], 'tier_5'); assert.equal(result.revision, 1);
  assert.deepEqual(state.documents.get(PRICING_PATH).purchaseTiers, { [id]: 'tier_5' });
  assert.deepEqual(state.reads, [`users/${teacherUid}`, PRICING_PATH]); assert.equal(state.writes.length, 1);
  assert.equal((await state.pricing.updateAvatarCatalogPricing(request)).revision, 1); assert.equal(state.writes.length, 1);
  const legacy = await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices: { [id]: 123 } }));
  assert.equal(legacy.purchaseTiers[id], 'tier_5');
  const reverted = await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 2, purchaseTiers: { [id]: itemMinPurchaseTier(item) } }));
  assert.equal(reverted.prices[id], 123); assert.deepEqual(state.documents.get(PRICING_PATH).purchaseTiers, {});
});

test('concurrent tier edits conflict without overwriting another item and retry with current revision', async () => {
  const state = setup(), [first, second] = paid;
  const requestFor = item => teacherRequest({ expectedRevision: 0, purchaseTiers: { [item.id]: 'tier_4' } });
  const results = await Promise.allSettled([first, second].map(item => state.pricing.updateAvatarCatalogPricing(requestFor(item))));
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1); assert.equal(state.writes.length, 1);
  const conflict = results.find(value => value.status === 'rejected').reason;
  assert.equal(conflict.details.reason, 'AVATAR_PRICING_REVISION_CONFLICT');
  const failed = results[0].status === 'rejected' ? first : second;
  const retry = requestFor(failed); retry.data.expectedRevision = conflict.details.pricing.revision;
  const recovered = await state.pricing.updateAvatarCatalogPricing(retry);
  assert.equal(recovered.purchaseTiers[first.id], 'tier_4'); assert.equal(recovered.purchaseTiers[second.id], 'tier_4');
  assert.equal(state.writes.length, 2);
});

test('corrupt persisted tier maps fail closed without wallet, inventory or settings writes', async () => {
  for (const purchaseTiers of [null, [], { [paid[0].id]: 'tier_6' }]) {
    const state = setup(); state.documents.set(PRICING_PATH, { schemaVersion: 1, revision: 1, prices: {}, purchaseTiers });
    await assert.rejects(state.pricing.getAvatarCatalogPricing(teacherRequest({})), reason('AVATAR_PRICING_INVALID'));
    await assert.rejects(state.api.getAvatarStudioState(req({ year: '2026', semester: '2' })), reason('AVATAR_PRICING_INVALID'));
    await assert.rejects(state.api.purchaseStudentAvatarItem(quotedPurchase(paid[0], paid[0].price, 1)), reason('AVATAR_PRICING_INVALID'));
    assert.equal(state.writes.length, 0); assert.equal(state.documents.get(accountPath).balance, 1000);
  }
});

test('canonical rank with custom semester thresholds gates below/equal/above purchases and studio with bounded reads', async () => {
  const thresholds = [0, 100, 400, 900, 2400], item = paid[0];
  for (let minimum = 1; minimum < 5; minimum++) for (const offset of [-1, 0, 1]) {
    const state = setup(), total = thresholds[minimum] + offset;
    state.documents.set('site_settings/config', { studentMenuVisibility: { mypage: true, avatar: true, avatar_shop: true } });
    state.documents.set(rankPolicyPath, { rankPolicy: { tiers: thresholds.map((minPoints, index) => ({ code: `tier_${index + 1}`, minPoints })) } });
    state.documents.get(accountPath).earnedTotal = total;
    state.documents.get(`users/${uid}`).rankTierCode = 'tier_5'; // Profile/client hints never grant access.
    state.documents.set(PRICING_PATH, { schemaVersion: 1, revision: 1, prices: {}, purchaseTiers: { [item.id]: `tier_${minimum + 1}` } });
    const expectedCode = `tier_${minimum + (offset < 0 ? 0 : 1)}`;
    const studio = await state.api.getAvatarStudioState(req({ year: '2026', semester: '2' }));
    assert.equal(studio.purchaseTierCode, expectedCode); assert.equal(state.reads.length, 15);
    assert.deepEqual(studio.allowedPurchaseTiers, PURCHASE_TIER_CODES.slice(0, minimum + (offset < 0 ? 0 : 1)));
    assert.equal(state.reads.filter(path => path === rankPolicyPath).length, 1); assert.equal(state.writes.length, 0);
    state.reads.length = 0;
    const request = quotedPurchase(item, item.price, 1);
    if (offset < 0) {
      await assert.rejects(state.api.purchaseStudentAvatarItem(request), error => {
        assert.equal(error.details.reason, 'AVATAR_TIER_LOCKED'); assert.equal(error.details.purchaseTierCode, expectedCode);
        assert.equal(error.details.minPurchaseTier, `tier_${minimum + 1}`); assert.equal(error.details.pricing.revision, 1); return true;
      });
      assert.equal(state.writes.length, 0); assert.equal(state.documents.get(accountPath).balance, 1000);
    } else {
      const result = await state.api.purchaseStudentAvatarItem(request);
      assert.equal(result.purchaseTierCode, expectedCode); assert.equal(result.charged, item.price);
      assert.equal(state.writes.length, 8); assert.equal(result.wallet.earnedTotal, total);
    }
    assert.equal(state.reads.length, 18); assert.equal(state.reads.filter(path => path === rankPolicyPath).length, 1);
  }
});

test('forged rank fields and wrong semester cannot buy a restricted item', async () => {
  const state = setup();
  for (const field of ['purchaseTierCode', 'allowedPurchaseTiers', 'rankEarnedTotal', 'earnedTotal', 'minPurchaseTier']) {
    const request = purchase(); request.data[field] = field === 'rankEarnedTotal' ? 999999 : 'tier_5';
    await assert.rejects(state.api.purchaseStudentAvatarItem(request), reason('AVATAR_INPUT_INVALID'));
  }
  assert.equal(state.reads.length, 0); assert.equal(state.writes.length, 0);
  const wrong = purchase(); wrong.data.semester = '1';
  await assert.rejects(state.api.purchaseStudentAvatarItem(wrong), error => error.code === 'failed-precondition');
  assert.equal(state.reads.includes('years/2026/semesters/1/point_policies/current'), false);
  assert.equal(state.writes.length, 0);
});

test('royal purchases and studio use cumulative earnings including the initial grant at the 10000 boundary', async () => {
  const item = paid[0];
  for (const earnedTotal of [9999, 10000, 10010]) {
    const state = setup(), wallet = state.documents.get(accountPath);
    Object.assign(wallet, { earnedTotal, rankEarnedTotal: earnedTotal - 500 });
    state.documents.set('site_settings/config', { studentMenuVisibility: { mypage: true, avatar: true, avatar_shop: true } });
    state.documents.set(rankPolicyPath, { rankPolicy: { tiers: [
      { code: 'tier_1', minPoints: 0 }, { code: 'tier_4', minPoints: 7000 }, { code: 'tier_5', minPoints: 10000 },
    ] } });
    state.documents.set(PRICING_PATH, { schemaVersion: 1, revision: 1, prices: {}, purchaseTiers: { [item.id]: 'tier_5' } });
    const expectedCode = earnedTotal < 10000 ? 'tier_4' : 'tier_5';
    const studio = await state.api.getAvatarStudioState(req({ year: '2026', semester: '2' }));
    assert.equal(studio.purchaseTierCode, expectedCode); assert.equal(state.reads.length, 15); assert.equal(state.writes.length, 0);
    state.reads.length = 0;
    const request = quotedPurchase(item, item.price, 1, 'cumulative-tier-purchase');
    if (earnedTotal < 10000) {
      await assert.rejects(state.api.purchaseStudentAvatarItem(request), reason('AVATAR_TIER_LOCKED'));
      assert.equal(state.writes.length, 0);
    } else {
      const result = await state.api.purchaseStudentAvatarItem(request);
      assert.equal(result.purchaseTierCode, 'tier_5'); assert.equal(result.wallet.earnedTotal, earnedTotal);
      assert.equal(result.wallet.rankEarnedTotal, earnedTotal - 500);
      assert.equal(result.wallet.balance, 1000 - item.price);
      assert.equal(state.writes.length, 8, 'Only the ordinary purchase writes occur; no rank migration');
      const writesAfterPurchase = state.writes.length;
      const repeated = await state.api.purchaseStudentAvatarItem(request);
      assert.equal(repeated.duplicate, true); assert.equal(state.writes.length, writesAfterPurchase);
      assert.equal((await state.api.getAvatarStudioState(req({ year: '2026', semester: '2' }))).purchaseTierCode, 'tier_5');
    }
    assert.equal(state.documents.get(accountPath).earnedTotal, earnedTotal);
    assert.equal(state.documents.get(accountPath).rankEarnedTotal, earnedTotal - 500);
  }
});

test('invalid cumulative earnings deny studio and purchase despite a high rank field or balance', async () => {
  for (const earnedTotal of [undefined, null, '10000', -1, 10000.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const state = setup();
    Object.assign(state.documents.get(accountPath), { earnedTotal, rankEarnedTotal: 10000, balance: 10000 });
    await assert.rejects(state.api.getAvatarStudioState(req({ year: '2026', semester: '2' })), error => error.code === 'failed-precondition');
    await assert.rejects(state.api.purchaseStudentAvatarItem(purchase()), error => error.code === 'failed-precondition');
    assert.equal(state.writes.length, 0);
  }
});

test('extended, reordered and removed rank tiers use policy order instead of numeric code comparisons', async () => {
  const cases = [
    { tiers: [[1, 0], [2, 50], [3, 150], [4, 300], [5, 500], [6, 750]], total: 750, current: 6, allowed: [1, 2, 3, 4, 5] },
    { tiers: [[1, 0], [2, 50], [6, 100], [3, 150], [4, 300], [5, 500]], total: 100, current: 6, allowed: [1, 2] },
    { tiers: [[1, 0], [2, 50], [3, 150], [5, 300], [4, 500]], total: 300, current: 5, allowed: [1, 2, 3, 5] },
    { tiers: [[1, 0], [2, 50], [3, 150], [5, 300], [4, 500]], total: 500, current: 4, allowed: [1, 2, 3, 4, 5] },
    { tiers: [[1, 0], [2, 50], [4, 300], [5, 500]], total: 300, current: 4, allowed: [1, 2, 4] },
    { tiers: [[1, 0], [2, 50], [4, 300], [5, 500]], total: 500, current: 5, allowed: [1, 2, 4, 5] },
    { tiers: [[2, 0], [3, 150], [4, 300], [5, 500]], total: 0, current: 2, allowed: [1, 2] },
    { tiers: [[2, 50], [5, 500]], total: 0, current: 2, allowed: [1, 2] },
    { tiers: [[6, 0]], total: 999, current: 6, allowed: [1] },
    { tiers: [[2, 0], [3, 150], [4, 300], [5, 500], [1, 700]], total: 500, current: 5, allowed: [1, 2, 3, 4, 5] },
    { tiers: [[2, 0], [3, 150], [4, 300], [5, 500], [1, 700]], total: 700, current: 1, allowed: [1, 2, 3, 4, 5] },
  ];
  const item = paid[0];
  for (const scenario of cases) for (const minimum of PURCHASE_TIER_CODES) {
    const state = setup(), allowed = scenario.allowed.map(index => `tier_${index}`);
    state.documents.get(accountPath).earnedTotal = scenario.total;
    state.documents.set(rankPolicyPath, { rankPolicy: { tiers: scenario.tiers.map(([index, minPoints]) => ({ code: `tier_${index}`, minPoints })) } });
    state.documents.set(PRICING_PATH, { schemaVersion: 1, revision: 1, prices: {}, purchaseTiers: { [item.id]: minimum } });
    const studio = await state.api.getAvatarStudioState(req({ year: '2026', semester: '2' }));
    assert.equal(studio.purchaseTierCode, `tier_${scenario.current}`); assert.deepEqual(studio.allowedPurchaseTiers, allowed);
    const request = quotedPurchase(item, item.price, 1);
    if (allowed.includes(minimum)) {
      const result = await state.api.purchaseStudentAvatarItem(request);
      assert.equal(result.purchaseTierCode, studio.purchaseTierCode); assert.deepEqual(result.allowedPurchaseTiers, allowed);
      assert.equal(result.charged, item.price); assert.equal(state.writes.length, 8);
    } else {
      await assert.rejects(state.api.purchaseStudentAvatarItem(request), error => {
        assert.equal(error.details.reason, 'AVATAR_TIER_LOCKED'); assert.equal(error.details.purchaseTierCode, studio.purchaseTierCode);
        assert.deepEqual(error.details.allowedPurchaseTiers, allowed); return true;
      });
      assert.equal(state.writes.length, 0); assert.equal(state.documents.get(accountPath).balance, 1000);
    }
  }
});

test('tier changes invalidate quotes and a denied request can retry after earning the required rank', async () => {
  const state = setup(), item = paid[0]; state.documents.get(accountPath).earnedTotal = 0;
  await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, purchaseTiers: { [item.id]: 'tier_2' } }));
  state.writes.length = 0;
  await assert.rejects(state.api.purchaseStudentAvatarItem(purchase(item)), error => reason('AVATAR_PRICE_CHANGED')(error)
    && error.details.pricing.purchaseTiers[item.id] === 'tier_2');
  const request = quotedPurchase(item, item.price, 1, 'tier-unlock-retry');
  await assert.rejects(state.api.purchaseStudentAvatarItem(request), reason('AVATAR_TIER_LOCKED'));
  assert.equal(state.writes.length, 0);
  state.documents.get(accountPath).earnedTotal = 50;
  const result = await state.api.purchaseStudentAvatarItem(request);
  assert.equal(result.charged, item.price); assert.equal(result.purchaseTierCode, 'tier_2'); assert.equal(state.writes.length, 8);
});

test('a failed rank-policy read cannot debit or grant an item and the same request safely retries', async () => {
  const state = setup(), request = purchase();
  const runTransaction = state.db.runTransaction.bind(state.db);
  let unavailable = true;
  state.db.runTransaction = callback => runTransaction(tx => {
    const getAll = tx.getAll.bind(tx);
    tx.getAll = (...refs) => {
      if (refs[0]?.path === rankPolicyPath && unavailable) throw new HttpsError('unavailable', 'Fixture policy read failure');
      return getAll(...refs);
    };
    return callback(tx);
  });
  await assert.rejects(state.api.purchaseStudentAvatarItem(request), error => error.code === 'unavailable');
  assert.equal(state.writes.length, 0); assert.equal(state.documents.get(accountPath).balance, 1000);
  unavailable = false;
  const result = await state.api.purchaseStudentAvatarItem(request);
  assert.equal(result.charged, paid[0].price); assert.equal(state.writes.length, 8);
  const replay = await state.api.purchaseStudentAvatarItem(request);
  assert.equal(replay.duplicate, true); assert.equal(state.writes.length, 8);
});

test('owned items and paid receipts survive higher minimums and rank reductions without duplicate debits', async () => {
  const state = setup(), item = paid[0], request = purchase(item);
  const bought = await state.api.purchaseStudentAvatarItem(request);
  await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, purchaseTiers: { [item.id]: 'tier_5' } }));
  state.documents.get(accountPath).earnedTotal = 0;
  state.reads.length = 0; state.writes.length = 0;
  const replay = await state.api.purchaseStudentAvatarItem(request);
  assert.equal(replay.duplicate, true); assert.equal(replay.charged, bought.charged);
  assert.equal(state.reads.includes(rankPolicyPath), false); assert.equal(state.writes.length, 0);
  const owned = await state.api.purchaseStudentAvatarItem(quotedPurchase(item, item.price, 1, 'owned-new-tier-request'));
  assert.equal(owned.charged, 0); assert.equal(owned.purchaseTierCode, 'tier_1'); assert.equal(state.writes.length, 0);
  const character = item.gender === 'boy' ? 'boy' : 'girl';
  const saved = await state.api.saveStudentAvatar(await save({ look: { ...defaultLook(character), [item.slot]: item.value }, expectedRevision: bought.avatar.revision }));
  assert.ok(saved.ownedItemIds.includes(item.id)); assert.equal(state.documents.get(accountPath).balance, 1000 - item.price);
});

test('free items remain available even with a higher purchase minimum and save without a rank read', async () => {
  const state = setup(), item = catalog.items.find(item => item.id === catalog.freeClothingItemIds[0]);
  state.documents.get(accountPath).earnedTotal = 0;
  state.documents.set(PRICING_PATH, { schemaVersion: 1, revision: 1, prices: {}, purchaseTiers: { [item.id]: 'tier_5' } });
  const pricing = await state.pricing.getAvatarCatalogPricing(teacherRequest({}));
  assert.equal(pricing.purchaseTiers[item.id], 'tier_1'); assert.equal(state.writes.length, 0);
  const result = await state.api.purchaseStudentAvatarItem(quotedPurchase(item, 0, 1));
  assert.equal(result.charged, 0); assert.equal(result.purchaseTierCode, 'tier_1'); assert.equal(state.writes.length, 0);
  state.reads.length = 0;
  await state.api.saveStudentAvatar(await save({ look: { ...defaultLook(), [item.slot]: item.value } }));
  assert.equal(state.reads.includes(rankPolicyPath), false);
  assert.equal(state.writes.some(write => write.path.startsWith('semester_wis_')), false);
});

test('free purchase tiers reject explicit restrictions and price-only free conversions normalize without losing metadata', async () => {
  const state = setup(), item = catalog.items.find(item => item.slot === 'accessory' && item.price > 0);
  const free = catalog.items.find(item => item.id === catalog.freeClothingItemIds[0]);
  await assert.rejects(state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, purchaseTiers: { [free.id]: 'tier_5' } })),
    reason('AVATAR_PRICING_INPUT_INVALID'));
  await assert.rejects(state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices: { [item.id]: 0 }, purchaseTiers: { [item.id]: 'tier_5' } })),
    reason('AVATAR_PRICING_INPUT_INVALID'));
  assert.equal(state.writes.length, 0);
  const metadata = { ...itemMetadata(item), label: '검증 상품' };
  await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, purchaseTiers: { [item.id]: 'tier_5' }, metadata: { [item.id]: metadata } }));
  const converted = await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices: { [item.id]: 0 } }));
  assert.equal(converted.prices[item.id], 0); assert.equal(converted.purchaseTiers[item.id], 'tier_1');
  assert.deepEqual(converted.metadata[item.id], metadata);
  assert.deepEqual(state.documents.get(PRICING_PATH).purchaseTiers, {});
  const writes = state.writes.length;
  await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices: { [item.id]: 0 } }));
  assert.equal(state.writes.length, writes);
  const restored = await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 2, prices: { [item.id]: item.price } }));
  assert.equal(restored.purchaseTiers[item.id], 'tier_1', 'Returning to paid keeps the current unrestricted selection');
});

test('wearing eligibility checks gender and geometry while historical public looks remain valid', () => {
  for (const character of ['girl', 'boy']) {
    assert.ok(validateWearableLook(defaultLook(character)));
    for (const item of catalog.items.filter(item => item.slot !== 'character')) {
      const look = { ...defaultLook(character), [item.slot]: item.value };
      assert.equal(Boolean(validateWearableLook(look)), canWearItem(item, character), `${item.id}:${character}`);
    }
  }
  const maleHair = catalog.items.find(item => item.slot === 'hairStyle' && item.gender === 'boy' && item.characters.includes('girl'));
  const look = { ...defaultLook('girl'), hairStyle: maleHair.value };
  assert.ok(validateLook(look)); assert.equal(validateWearableLook(look), null);
  const old = { schemaVersion: 1, catalogVersion: catalog.version, revision: 3, look, lookHash: lookHash(look),
    thumbnailUrl: `https://firebasestorage.googleapis.com/v0/b/avatar-test.appspot.com/o/student_avatar_thumbnails%2Fv2%2F${'a'.repeat(64)}%2F${'b'.repeat(64)}.webp?alt=media&token=${'c'.repeat(36)}` };
  assert.deepEqual(sanitizePublicAvatar(old), old);
  const skirt = catalog.items.find(item => item.id === 'minimi-bottom-skirt-navy');
  assert.equal(canWearItem(skirt, 'boy', { [skirt.id]: { gender: 'unisex' } }), false);
  for (const character of ['girl', 'boy']) {
    const body = catalog.items.find(item => item.slot === 'character' && item.value === character);
    const other = character === 'girl' ? 'boy' : 'girl';
    assert.ok(validateWearableLook(defaultLook(character), { [body.id]: { gender: other } }));
    assert.equal(canWearItem(body, other, { [body.id]: { gender: 'unisex' } }), false);
  }
});

test('student and teacher reject opposite-gender saves before upload or writes with one metadata read', async () => {
  for (const teacher of [false, true]) for (const character of ['girl', 'boy']) {
    const state = setup(), other = character === 'girl' ? 'boy' : 'girl';
    const hair = catalog.items.find(item => item.slot === 'hairStyle' && item.gender === other && item.characters.includes(character));
    const input = await save({ look: { ...defaultLook(character), hairStyle: hair.value } });
    const api = teacher ? state.teacher : state.api;
    await assert.rejects(api.saveStudentAvatar(teacher ? teacherRequest(input.data) : input), error => {
      assert.equal(error.details.reason, 'AVATAR_GENDER_MISMATCH');
      assert.equal(error.details.pricing.metadata[hair.id].gender, other);
      return true;
    });
    assert.equal(state.reads.filter(path => path === PRICING_PATH).length, 1);
    assert.equal(state.bucket.objects.size, 0); assert.equal(state.writes.length, 0);
    assert.equal(state.documents.get(accountPath).balance, 1000);
  }
});

test('admin reclassification governs new saves but keeps old reads, ownership, thumbnails and receipt retries', async () => {
  for (const teacher of [false, true]) {
    const state = setup(), api = teacher ? state.teacher : state.api;
    const item = catalog.items.find(item => item.id === itemIdFor('hairStyle', defaultLook().hairStyle));
    const input = await save();
    const request = teacher ? teacherRequest(input.data) : input;
    const first = await api.saveStudentAvatar(request);
    assert.equal(state.reads.filter(path => path === PRICING_PATH).length, 2);
    const avatarPath = teacher ? `teacher_avatars/${teacherUid}` : `student_avatars/${uid}`;
    const before = structuredClone(state.documents.get(avatarPath));
    await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 0, prices: {},
      metadata: { [item.id]: { ...itemMetadata(item), gender: 'boy' } } }));
    state.reads.length = 0; state.writes.length = 0;
    const current = await api.getStudentAvatar(teacher ? teacherRequest({}) : req({}));
    assert.equal(current.thumbnailUrl, first.thumbnailUrl); assert.deepEqual(current.look, first.look);
    assert.deepEqual(current.ownedItemIds, first.ownedItemIds);
    assert.equal(state.reads.includes(PRICING_PATH), false, 'Historical reads do not fetch metadata');
    const retry = await api.saveStudentAvatar(request);
    assert.equal(retry.duplicate, true); assert.equal(state.writes.length, 0);
    const edited = await save({ expectedRevision: first.revision, requestId: 'gender-new-save' });
    await assert.rejects(api.saveStudentAvatar(teacher ? teacherRequest(edited.data) : edited), reason('AVATAR_GENDER_MISMATCH'));
    assert.equal(state.writes.length, 0); assert.equal(state.bucket.objects.size, 1);
    assert.deepEqual(structuredClone(state.documents.get(avatarPath)), before);
    await state.pricing.updateAvatarCatalogPricing(teacherRequest({ expectedRevision: 1, prices: {},
      metadata: { [item.id]: { ...itemMetadata(item), gender: 'unisex' } } }));
    state.advance();
    state.documents.set(avatarPath, { ...state.documents.get(avatarPath), lastSavedAtMs: 1 });
    const compatible = await api.saveStudentAvatar(teacher ? teacherRequest(edited.data) : edited);
    assert.equal(compatible.revision, first.revision + 1);
  }
});

test('gender changes during upload are rechecked for both roles and clean the uncommitted image', async () => {
  for (const teacher of [false, true]) {
    const state = setup(), item = catalog.items.find(item => item.id === itemIdFor('hairStyle', defaultLook().hairStyle));
    state.bucket.afterSave = async () => state.documents.set(PRICING_PATH, { schemaVersion: 1, revision: 1, prices: {},
      metadata: { [item.id]: { ...itemMetadata(item), gender: 'boy' } } });
    const input = await save();
    await assert.rejects((teacher ? state.teacher : state.api).saveStudentAvatar(teacher ? teacherRequest(input.data) : input), reason('AVATAR_GENDER_MISMATCH'));
    assert.equal(state.reads.filter(path => path === PRICING_PATH).length, 2);
    assert.equal(state.writes.length, 0); assert.equal(state.bucket.objects.size, 0);
    assert.equal(state.documents.has(teacher ? `teacher_avatars/${teacherUid}` : `student_avatars/${uid}`), false);
    assert.equal(state.documents.get(accountPath).balance, 1000);
  }
});

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

test('teacher My Page returns all items, effective metadata and enabled emoji choices with one pricing read and no wallet lookup', async () => {
  const state = setup();
  state.documents.set('fixture_policy/current', { rankPolicy: { emojiRegistry: [
    { id: 'smile', emoji: '😀', label: '웃음', enabled: true },
    { id: 'teacher_star', emoji: '⭐', label: '별', enabled: true },
    { id: 'hidden', emoji: '❌', label: '숨김', enabled: false },
  ] } });
  const hair = catalog.items.find(item => item.id === itemIdFor('hairStyle', defaultLook().hairStyle));
  state.documents.set(PRICING_PATH, { schemaVersion: 1, revision: 1, prices: {},
    metadata: { [hair.id]: { ...itemMetadata(hair), gender: 'boy' } } });
  const page = await state.teacher.getTeacherMyPage(scopedTeacherRequest({}));
  assert.equal(page.allAvailable, true); assert.equal(page.avatar.ownedItemIds.length, catalog.items.length);
  assert.equal(page.pricing.metadata[hair.id].gender, 'boy');
  assert.deepEqual(page.emojiRegistry.map(item => item.id), ['smile', 'teacher_star']);
  const emoji = await state.teacher.updateTeacherProfileIcon(scopedTeacherRequest({ emojiId: 'teacher_star' }));
  assert.equal(emoji.profileIcon, '⭐'); assert.equal(state.documents.get(`users/${teacherUid}`).untouched, 'preserved');
  await assert.rejects(state.teacher.updateTeacherProfileIcon(scopedTeacherRequest({ emojiId: 'hidden' })), reason('AVATAR_EMOJI_INVALID'));
  assert.equal(state.reads.filter(path => path === PRICING_PATH).length, 1);
  assert.equal(state.reads.some(path => path.startsWith('semester_wis_')), false);
});

test('teacher can save paid items into own isolated namespace without ledger or student changes', async () => {
  const state = setup(), look = defaultLook();
  for (const item of paid.filter(item => canWearItem(item, 'girl') && item.slot !== 'character')) look[item.slot] = item.value;
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
