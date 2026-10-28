const { createHash } = require('node:crypto');
const catalog = require('./avatarCatalog.json');

const SLOTS = Object.freeze(['character', 'skinTone', 'faceShape', 'expression', 'hairStyle', 'hairTone', 'pose', 'top', 'bottom', 'shoes', 'accessory']);
const items = new Map();
for (const item of catalog.items) {
  if (!SLOTS.includes(item.slot) || item.id !== `${item.slot}:${item.value}` || items.has(item.id)
    || !Number.isSafeInteger(item.price) || item.price < 0 || !Array.isArray(item.characters)
    || !item.characters.length || item.characters.some(value => !['girl', 'boy'].includes(value))) {
    throw new Error('Invalid server avatar catalog');
  }
  items.set(item.id, Object.freeze(item));
}
const defaultLook = (character = 'girl') => Object.fromEntries(SLOTS.map(slot => {
  const item = catalog.items.find(entry => entry.slot === slot && entry.price === 0
    && entry.characters.includes(character) && (slot !== 'character' || entry.value === character));
  if (!item) throw new Error(`Missing free avatar slot: ${slot}`);
  return [slot, item.value];
}));
const validateLook = (look, ownedItemIds) => {
  if (!look || typeof look !== 'object' || Array.isArray(look)
    || Object.keys(look).length !== SLOTS.length || Object.keys(look).some(key => !SLOTS.includes(key))
    || !['girl', 'boy'].includes(look.character)) return null;
  const owned = ownedItemIds === undefined ? null : new Set(ownedItemIds);
  const result = {};
  for (const slot of SLOTS) {
    if (typeof look[slot] !== 'string') return null;
    const item = items.get(`${slot}:${look[slot]}`);
    if (!item || !item.characters.includes(look.character) || (owned && item.price > 0 && !owned.has(item.id))) return null;
    result[slot] = item.value;
  }
  return result;
};
const lookHash = look => createHash('sha256').update(JSON.stringify(SLOTS.map(slot => [slot, look[slot]]))).digest('hex');
const sanitizePublicAvatar = value => {
  if (!value || value.schemaVersion !== 1 || value.catalogVersion !== catalog.version
    || !Number.isSafeInteger(value.revision) || value.revision < 1) return null;
  const look = validateLook(value.look);
  if (!look || value.lookHash !== lookHash(look)) return null;
  const result = { schemaVersion: 1, catalogVersion: catalog.version, look, revision: value.revision, lookHash: value.lookHash };
  // Only the server's immutable object namespace is eligible for public projection.
  if (typeof value.thumbnailUrl === 'string' && value.thumbnailUrl.length < 1024
    && /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/student_avatar_thumbnails%2Fv1%2F[a-f0-9]{64}%2F[a-f0-9]{64}\.webp\?alt=media&token=[a-f0-9-]{36}$/.test(value.thumbnailUrl)) {
    result.thumbnailUrl = value.thumbnailUrl;
  }
  return result;
};

module.exports = { SLOTS, catalog, items, defaultLook, validateLook, lookHash, sanitizePublicAvatar };
