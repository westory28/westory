const { Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { catalog, items, SLOTS } = require('./studentAvatarCatalog');

const PRICING_PATH = 'avatar_catalog_settings/current';
const MAX_AVATAR_PRICE = 1000000;
const ADMIN_EMAIL = 'westoria28@gmail.com';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const safePrice = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_AVATAR_PRICE;
const fail = (code, message, reason, extra = {}) => { throw new HttpsError(code, message, { reason, ...extra }); };
const invalid = () => fail('invalid-argument', '아바타 가격 입력을 확인해 주세요.', 'AVATAR_PRICING_INPUT_INVALID');
const publicPricing = (revision, overrides = {}) => ({
  catalogVersion: catalog.version,
  revision,
  prices: Object.fromEntries(catalog.items.map(item => [item.id, overrides[item.id] ?? item.price])),
});
const readAvatarPricing = async (tx, db) => {
  const snapshot = await tx.get(db.doc(PRICING_PATH));
  if (!snapshot.exists) return publicPricing(0);
  const value = snapshot.data();
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !record(value.prices) || Object.keys(value.prices).length > 500
    || Object.values(value.prices).some(price => !safePrice(price))) {
    fail('failed-precondition', '아바타 가격표를 확인하지 못했습니다.', 'AVATAR_PRICING_INVALID');
  }
  return publicPricing(value.revision, value.prices);
};
const assertAvatarIdentity = async (request, assertSession = assertScoreWorkflowSession) => {
  const identity = await assertSession(request), uid = request.auth?.uid;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || (identity?.uid && identity.uid !== uid)) {
    fail('unauthenticated', '다시 로그인해 주세요.', 'AVATAR_SESSION_INVALID');
  }
  return { uid, email: String(identity?.email || request.auth?.token?.email || '').trim().toLowerCase() };
};
const readAvatarTeacher = async (tx, db, identity) => {
  const snapshot = await tx.get(db.doc(`users/${identity.uid}`)), value = snapshot.data() || {};
  if (!snapshot.exists || value.deletedAt || value.isDeleted || value.weplayDeletionPending
    || (value.role !== 'teacher' && identity.email !== ADMIN_EMAIL)) {
    fail('permission-denied', '교사 계정에서 사용할 수 있습니다.', 'AVATAR_TEACHER_REQUIRED');
  }
  return value;
};
const ownedLookIds = look => SLOTS.map(slot => `${slot}:${look[slot]}`);
const canUsePricedLook = (look, owned, pricing) => ownedLookIds(look)
  .every(id => pricing.prices[id] === 0 || owned.includes(id));

const createAvatarCatalogPricingHandlers = ({ db, assertSession = assertScoreWorkflowSession, now = Date.now }) => {
  const getAvatarCatalogPricing = async request => {
    const identity = await assertAvatarIdentity(request, assertSession), data = request.data || {};
    if (!record(data) || Object.keys(data).some(key => key !== '_session')) invalid();
    return db.runTransaction(async tx => {
      await readAvatarTeacher(tx, db, identity);
      return readAvatarPricing(tx, db);
    }, { readOnly: true });
  };
  const updateAvatarCatalogPricing = async request => {
    const identity = await assertAvatarIdentity(request, assertSession), data = request.data || {};
    if (!record(data) || Object.keys(data).some(key => !['_session', 'expectedRevision', 'prices'].includes(key))
      || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0 || !record(data.prices)
      || Object.keys(data.prices).length > catalog.items.length
      || Object.entries(data.prices).some(([id, price]) => !items.has(id) || !safePrice(price))) invalid();
    return db.runTransaction(async tx => {
      await readAvatarTeacher(tx, db, identity);
      const current = await readAvatarPricing(tx, db);
      if (current.revision !== data.expectedRevision) {
        fail('aborted', '다른 화면에서 가격표가 변경되었습니다. 다시 불러와 확인해 주세요.', 'AVATAR_PRICING_REVISION_CONFLICT', { pricing: current });
      }
      const prices = { ...current.prices, ...data.prices };
      if (catalog.items.every(item => prices[item.id] === current.prices[item.id])) return current;
      if (!Number.isSafeInteger(current.revision + 1)) fail('failed-precondition', '가격표 버전을 확인해 주세요.', 'AVATAR_PRICING_INVALID');
      const overrides = Object.fromEntries(catalog.items.filter(item => prices[item.id] !== item.price).map(item => [item.id, prices[item.id]]));
      tx.set(db.doc(PRICING_PATH), { schemaVersion: 1, revision: current.revision + 1, prices: overrides,
        updatedAt: Timestamp.fromMillis(now()), updatedBy: identity.uid });
      return publicPricing(current.revision + 1, overrides);
    });
  };
  return { getAvatarCatalogPricing, updateAvatarCatalogPricing };
};
module.exports = { PRICING_PATH, MAX_AVATAR_PRICE, readAvatarPricing, assertAvatarIdentity, readAvatarTeacher,
  ownedLookIds, canUsePricedLook, createAvatarCatalogPricingHandlers };
