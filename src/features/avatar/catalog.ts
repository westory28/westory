import catalog from "../../../functions/avatarCatalog.json";

export type AvatarCharacter = "girl" | "boy";
export type AvatarItemGender = AvatarCharacter | "unisex";
export interface AvatarItemMetadata {
  label: string;
  gender: AvatarItemGender;
  description: string;
}
export type AvatarLook = {
  character: AvatarCharacter;
  skinTone: string;
  faceShape: string;
  expression: string;
  hairStyle: string;
  hairTone: string;
  pose: string;
  top: string;
  bottom: string;
  shoes: string;
  accessory: string;
};
export type AvatarSlot = keyof AvatarLook;
export interface AvatarItem {
  id: string;
  slot: AvatarSlot;
  value: string;
  label: string;
  price: number;
  tier: "basic" | "premium";
  characters: AvatarCharacter[];
  color?: string;
  /** Shop classification only; characters remains the rendering compatibility contract. */
  gender?: AvatarItemGender;
  description?: string;
}
export interface AvatarPublic {
  schemaVersion: number;
  catalogVersion: number;
  look: AvatarLook;
  revision: number;
  lookHash: string;
  thumbnailUrl?: string;
}
export interface AvatarState extends AvatarPublic {
  ownedItemIds: string[];
  requiresThumbnailRefresh?: boolean;
}
export const AVATAR_CATALOG_VERSION = catalog.version;
export const AVATAR_PRICING_POLICY_VERSION = catalog.pricingPolicyVersion;
export const AVATAR_ITEMS = catalog.items as AvatarItem[];
const freeClothingItemIds = new Set(catalog.freeClothingItemIds);
export const avatarItemPricePolicy = (
  item: AvatarItem,
): "free" | "paid" | null =>
  item.slot === "top" || item.slot === "bottom"
    ? freeClothingItemIds.has(item.id)
      ? "free"
      : "paid"
    : null;
export const effectiveAvatarItemPrice = (
  item: AvatarItem,
  override?: number,
): number => {
  const policy = avatarItemPricePolicy(item);
  if (policy === "free") return 0;
  if (policy === "paid" && override === 0) return item.price;
  return Number.isSafeInteger(override) &&
    override! >= 0 &&
    override! <= 1_000_000
    ? override!
    : item.price;
};
export const avatarItemGender = (item: AvatarItem): AvatarItemGender =>
  item.gender ?? (item.characters.length === 1 ? item.characters[0] : "unisex");
export const avatarItemMetadata = (item: AvatarItem): AvatarItemMetadata => ({
  label: item.label,
  gender: avatarItemGender(item),
  description: item.description ?? "",
});
/** Apply the server's shop fields without changing IDs, geometry or ownership. */
export const applyAvatarCatalogSettings = (
  item: AvatarItem,
  settings: {
    prices: Record<string, number>;
    metadata?: Record<string, AvatarItemMetadata>;
  },
): AvatarItem => ({
  ...item,
  ...avatarItemMetadata(item),
  ...settings.metadata?.[item.id],
  price: effectiveAvatarItemPrice(item, settings.prices[item.id]),
});
export const AVATAR_SLOTS: { key: AvatarSlot; label: string; icon: string }[] =
  [
    { key: "character", label: "캐릭터", icon: "fa-user" },
    { key: "top", label: "상의", icon: "fa-shirt" },
    { key: "bottom", label: "하의", icon: "fa-layer-group" },
    { key: "shoes", label: "신발", icon: "fa-shoe-prints" },
    { key: "accessory", label: "장식", icon: "fa-star" },
    { key: "hairStyle", label: "헤어", icon: "fa-scissors" },
    { key: "hairTone", label: "염색", icon: "fa-palette" },
    { key: "faceShape", label: "얼굴형", icon: "fa-circle-user" },
    { key: "expression", label: "눈매·표정", icon: "fa-face-smile" },
    { key: "skinTone", label: "피부색", icon: "fa-hand" },
    { key: "pose", label: "포즈", icon: "fa-person" },
  ];
export const defaultAvatarLook = (
  character: AvatarCharacter = "girl",
): AvatarLook => ({
  character,
  skinTone: "mm-ivory",
  faceShape: "mm-round",
  expression: "mm-smile",
  hairStyle: character === "boy" ? "mm-parted" : "mm-bob",
  hairTone: "mm-ink",
  pose: "mm-idle",
  top: catalog.defaultClothing.top,
  bottom: catalog.defaultClothing.bottom,
  shoes: "mm-sneakers-white",
  accessory: "mm-none",
});
export const itemForLook = (look: AvatarLook, slot: AvatarSlot) =>
  AVATAR_ITEMS.find(
    (item) =>
      item.slot === slot &&
      item.value === look[slot] &&
      item.characters.includes(look.character),
  );
export const ownsAvatarItem = (item: AvatarItem, owned: readonly string[]) =>
  item.price === 0 || owned.includes(item.id);
export const unownedAvatarItems = (
  look: AvatarLook,
  owned: readonly string[],
) =>
  AVATAR_SLOTS.map(({ key }) => itemForLook(look, key)).filter(
    (item): item is AvatarItem => Boolean(item && !ownsAvatarItem(item, owned)),
  );
export const selectAvatarItem = (
  look: AvatarLook,
  item: AvatarItem,
): AvatarLook => {
  if (item.slot !== "character" && !item.characters.includes(look.character))
    return look;
  const next = { ...look, [item.slot]: item.value } as AvatarLook;
  if (item.slot === "character") {
    for (const { key } of AVATAR_SLOTS) {
      if (!itemForLook(next, key))
        next[key] = defaultAvatarLook(next.character)[key] as never;
    }
  }
  return next;
};

// A retired catalog is a reset, never a partial migration of the old character.
export const restoreAvatarLook = (
  look: AvatarLook,
  catalogVersion = AVATAR_CATALOG_VERSION,
): AvatarLook => {
  if (catalogVersion !== AVATAR_CATALOG_VERSION) return defaultAvatarLook();
  const next = { ...look };
  const fallback = defaultAvatarLook(look.character);
  for (const { key } of AVATAR_SLOTS)
    if (!itemForLook(next, key)) next[key] = fallback[key] as never;
  return next;
};

export const isCurrentAvatar = (
  avatar: { catalogVersion?: number; thumbnailUrl?: string } | null | undefined,
): boolean => avatar?.catalogVersion === AVATAR_CATALOG_VERSION;

export const restoreAvatarState = (state: AvatarState): AvatarState => {
  if (!isCurrentAvatar(state)) {
    return {
      schemaVersion: 1,
      catalogVersion: AVATAR_CATALOG_VERSION,
      look: defaultAvatarLook(),
      revision: state.revision,
      lookHash: "",
      ownedItemIds: [],
    };
  }
  return {
    ...state,
    look: restoreAvatarLook(state.look, state.catalogVersion),
    ownedItemIds: state.ownedItemIds.filter((id) =>
      AVATAR_ITEMS.some((item) => item.id === id),
    ),
  };
};
