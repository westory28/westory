const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { catalog, defaultLook, lookHash } = require('./studentAvatarCatalog');

const isRetiredAvatar = value => Boolean(value && (value.catalogVersion === 1 || value.catalogVersion === undefined));
const resetInventory = (value, uid, audience, timestamp) => {
  if (!isRetiredAvatar(value)) return null;
  const owner = audience === 'student' ? 'studentUid' : 'teacherUid';
  if (value[owner] !== uid || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision)
    || value.revision < 1 || !Number.isSafeInteger(value.revision + 1)) throw new Error('Invalid retired avatar inventory');
  const look = defaultLook();
  return { schemaVersion: 1, catalogVersion: catalog.version, [owner]: uid,
    revision: value.revision + 1, look, lookHash: lookHash(look), ownedItemIds: [],
    updatedAt: timestamp, resetGeneration: 'minimi-v2' };
};

// Only these avatar documents/fields are touched. Receipts remain immutable and
// the monetary ledger, account balances, profile emoji and academic data are not read.
const resetAvatarOwner = async ({ db, uid, audience, apply = false, backup = async () => {}, onRead = () => {} }) => {
  if (!['student', 'teacher'].includes(audience) || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Invalid avatar reset scope');
  const ref = db.doc(`${audience}_avatars/${uid}`), userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async tx => {
    const [snapshot, user] = await tx.getAll(ref, userRef, { fieldMask: [
      'schemaVersion', 'catalogVersion', 'studentUid', 'teacherUid', 'revision', 'look', 'lookHash',
      'ownedItemIds', 'thumbnailPath', 'previousThumbnailPath', 'thumbnailUrl', 'lastSavedAtMs',
      'updatedAt', 'requiresThumbnailRefresh', 'resetGeneration', 'avatar',
    ] });
    onRead(2);
    const inventory = snapshot.exists ? snapshot.data() : null;
    const projection = user.exists ? user.data()?.avatar : null;
    const next = resetInventory(inventory, uid, audience, Timestamp.now());
    const clearProjection = isRetiredAvatar(projection);
    const result = { inventory: Boolean(next), projection: clearProjection };
    if (!apply || (!next && !clearProjection)) return result;
    await backup({ kind: 'avatar-owner', path: ref.path, before: next ? inventory : null,
      userPath: userRef.path, avatar: clearProjection ? projection : null });
    if (next) tx.set(ref, next);
    if (clearProjection) tx.update(userRef, { avatar: FieldValue.delete() });
    return result;
  }, apply ? {} : { readOnly: true });
};

module.exports = { isRetiredAvatar, resetInventory, resetAvatarOwner };
