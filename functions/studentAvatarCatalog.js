const { createHash } = require('node:crypto');
const catalog = require('./avatarCatalog.json');

const SLOTS = Object.freeze(['character', 'skinTone', 'faceShape', 'expression', 'hairStyle', 'hairTone', 'pose', 'top', 'bottom', 'shoes', 'accessory']);
const items = new Map();
const itemIdFor = (slot, value) => `minimi-${slot}-${String(value).replace(/^mm-/, '')}`;
const itemMetadata = item => ({
  label: item.label,
  gender: item.gender ?? (item.characters.length === 1 ? item.characters[0] : 'unisex'),
  description: item.description ?? '',
});
const freeClothingItemIds = new Set(catalog.freeClothingItemIds);
const itemPricePolicy = item => ['top', 'bottom'].includes(item.slot)
  ? (freeClothingItemIds.has(item.id) ? 'free' : 'paid') : null;
const effectiveAvatarPrice = (item, override) => {
  const policy = itemPricePolicy(item);
  if (policy === 'free') return 0;
  if (policy === 'paid' && override === 0) return item.price;
  return override ?? item.price;
};
for (const item of catalog.items) {
  if (!SLOTS.includes(item.slot) || item.id !== itemIdFor(item.slot, item.value) || items.has(item.id)
    || !Number.isSafeInteger(item.price) || item.price < 0 || !Array.isArray(item.characters)
    || (itemPricePolicy(item) === 'free' ? item.price !== 0 : itemPricePolicy(item) === 'paid' && item.price === 0)
    || !item.characters.length || item.characters.some(value => !['girl', 'boy'].includes(value))) {
    throw new Error('Invalid server avatar catalog');
  }
  items.set(item.id, Object.freeze(item));
}
const defaultLook = (character = 'girl') => Object.fromEntries(SLOTS.map(slot => {
  const preferred = slot === 'hairStyle' ? catalog.defaultHairStyle[character] : catalog.defaultClothing[slot];
  const item = catalog.items.find(entry => entry.slot === slot && entry.price === 0
    && entry.characters.includes(character) && (slot !== 'character' || entry.value === character)
    && (!preferred || entry.value === preferred));
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
    const item = items.get(itemIdFor(slot, look[slot]));
    if (!item || !item.characters.includes(look.character) || (owned && item.price > 0 && !owned.has(item.id))) return null;
    result[slot] = item.value;
  }
  return result;
};
// Editing eligibility follows the administrator's current gender setting. Keep
// this separate from stored/public validation so older saved looks still render.
const canWearItem = (item, character, metadata = {}) => {
  if (!item || !item.characters.includes(character)) return false;
  if (item.slot === 'character') return item.value === character;
  const gender = metadata[item.id]?.gender ?? itemMetadata(item).gender;
  return gender === 'unisex' || gender === character;
};
const validateWearableLook = (look, metadata = {}) => {
  const validated = validateLook(look);
  return validated && SLOTS.every(slot => canWearItem(items.get(itemIdFor(slot, validated[slot])), validated.character, metadata))
    ? validated : null;
};
// Retired generations must never reconnect through a per-slot fallback.
const restoreStoredLook = look => validateLook(look);
const lookHash = look => createHash('sha256').update(JSON.stringify(SLOTS.map(slot => [slot, look[slot]]))).digest('hex');
const sanitizePublicAvatar = value => {
  if (!value || value.schemaVersion !== 1 || value.catalogVersion !== catalog.version
    || !Number.isSafeInteger(value.revision) || value.revision < 1) return null;
  const look = restoreStoredLook(value.look);
  if (!look || value.lookHash !== lookHash(value.look)) return null;
  const currentHash = lookHash(look);
  const result = { schemaVersion: 1, catalogVersion: catalog.version, look, revision: value.revision, lookHash: currentHash };
  // Only the server's immutable object namespace is eligible for public projection.
  if (currentHash === value.lookHash && typeof value.thumbnailUrl === 'string' && value.thumbnailUrl.length < 1024
    && /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/student_avatar_thumbnails%2Fv2%2F[a-f0-9]{64}%2F[a-f0-9]{64}\.webp\?alt=media&token=[a-f0-9-]{36}$/.test(value.thumbnailUrl)) {
    result.thumbnailUrl = value.thumbnailUrl;
  }
  return result;
};

module.exports = { SLOTS, catalog, items, itemIdFor, itemMetadata, itemPricePolicy, effectiveAvatarPrice, defaultLook, validateLook, canWearItem, validateWearableLook, restoreStoredLook, lookHash, sanitizePublicAvatar };
