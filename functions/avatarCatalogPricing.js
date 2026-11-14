const { Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { catalog, items, SLOTS, itemIdFor, itemMetadata, effectiveAvatarPrice } = require('./studentAvatarCatalog');

const PRICING_PATH = 'avatar_catalog_settings/current';
const MAX_AVATAR_PRICE = 1000000;
const MAX_AVATAR_LABEL_LENGTH = 60;
const MAX_AVATAR_DESCRIPTION_LENGTH = 400;
const ADMIN_EMAIL = 'westoria28@gmail.com';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const safePrice = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_AVATAR_PRICE;
const fail = (code, message, reason, extra = {}) => { throw new HttpsError(code, message, { reason, ...extra }); };
const invalid = () => fail('invalid-argument', '아이템 이름, 가격, 성별, 설명을 확인해 주세요.', 'AVATAR_PRICING_INPUT_INVALID');
const normalizedMetadata = value => {
  if (!record(value) || Object.keys(value).length !== 3
    || Object.keys(value).some(key => !['label', 'gender', 'description'].includes(key))
    || typeof value.label !== 'string' || !value.label.trim() || value.label.trim().length > MAX_AVATAR_LABEL_LENGTH
    || /[\u0000-\u001f\u007f]/.test(value.label)
    || !['boy', 'girl', 'unisex'].includes(value.gender)
    || typeof value.description !== 'string' || value.description.trim().length > MAX_AVATAR_DESCRIPTION_LENGTH
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.description)) return null;
  return { label: value.label.trim(), gender: value.gender, description: value.description.trim() };
};
const metadataEqual = (left, right) => left.label === right.label && left.gender === right.gender && left.description === right.description;
const publicPricing = (revision, overrides = {}, metadata = {}) => ({
  catalogVersion: catalog.version,
  policyVersion: catalog.pricingPolicyVersion,
  revision,
  prices: Object.fromEntries(catalog.items.map(item => [item.id, effectiveAvatarPrice(item, overrides[item.id])])),
  metadata: Object.fromEntries(catalog.items.map(item => [item.id, metadata[item.id] || itemMetadata(item)])),
});
const readAvatarPricing = async (tx, db) => {
  const snapshot = await tx.get(db.doc(PRICING_PATH));
  if (!snapshot.exists) return publicPricing(0);
  const value = snapshot.data();
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !record(value.prices) || Object.keys(value.prices).length > 500
    || Object.values(value.prices).some(price => !safePrice(price))
    || (value.metadata !== undefined && (!record(value.metadata) || Object.keys(value.metadata).length > 500
      || Object.values(value.metadata).some(metadata => !normalizedMetadata(metadata))))) {
    fail('failed-precondition', '아바타 상품 정보를 확인하지 못했습니다.', 'AVATAR_PRICING_INVALID');
  }
  return publicPricing(value.revision, value.prices,
    Object.fromEntries(Object.entries(value.metadata || {}).map(([id, metadata]) => [id, normalizedMetadata(metadata)])));
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
const ownedLookIds = look => SLOTS.map(slot => itemIdFor(slot, look[slot]));
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
    if (!record(data) || Object.keys(data).some(key => !['_session', 'expectedRevision', 'prices', 'metadata'].includes(key))
      || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0 || !record(data.prices)
      || Object.keys(data.prices).length > catalog.items.length
      || Object.entries(data.prices).some(([id, price]) => !items.has(id) || !safePrice(price)
        || effectiveAvatarPrice(items.get(id), price) !== price)
      || (data.metadata !== undefined && (!record(data.metadata) || Object.keys(data.metadata).length > catalog.items.length
        || Object.entries(data.metadata).some(([id, metadata]) => !items.has(id) || !normalizedMetadata(metadata))))) invalid();
    const metadataChanges = Object.fromEntries(Object.entries(data.metadata || {})
      .map(([id, metadata]) => [id, normalizedMetadata(metadata)]));
    return db.runTransaction(async tx => {
      await readAvatarTeacher(tx, db, identity);
      const current = await readAvatarPricing(tx, db);
      const prices = { ...current.prices, ...data.prices };
      const metadata = { ...current.metadata, ...metadataChanges };
      // An identical retry after a lost response is a read-only success, even at an older revision.
      if (catalog.items.every(item => prices[item.id] === current.prices[item.id]
        && metadataEqual(metadata[item.id], current.metadata[item.id]))) return current;
      if (current.revision !== data.expectedRevision) {
        fail('aborted', '다른 화면에서 상품 정보가 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.', 'AVATAR_PRICING_REVISION_CONFLICT', { pricing: current });
      }
      if (!Number.isSafeInteger(current.revision + 1)) fail('failed-precondition', '상품 정보 버전을 확인해 주세요.', 'AVATAR_PRICING_INVALID');
      const overrides = Object.fromEntries(catalog.items.filter(item => prices[item.id] !== item.price).map(item => [item.id, prices[item.id]]));
      const metadataOverrides = Object.fromEntries(catalog.items.filter(item => !metadataEqual(metadata[item.id], itemMetadata(item)))
        .map(item => [item.id, metadata[item.id]]));
      tx.set(db.doc(PRICING_PATH), { schemaVersion: 1, catalogVersion: catalog.version, revision: current.revision + 1, prices: overrides, metadata: metadataOverrides,
        updatedAt: Timestamp.fromMillis(now()), updatedBy: identity.uid });
      return publicPricing(current.revision + 1, overrides, metadataOverrides);
    });
  };
  return { getAvatarCatalogPricing, updateAvatarCatalogPricing };
};
module.exports = { PRICING_PATH, MAX_AVATAR_PRICE, MAX_AVATAR_LABEL_LENGTH, MAX_AVATAR_DESCRIPTION_LENGTH, readAvatarPricing, assertAvatarIdentity, readAvatarTeacher,
  ownedLookIds, canUsePricedLook, createAvatarCatalogPricingHandlers };
