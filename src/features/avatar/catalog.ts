import catalog from "../../../functions/avatarCatalog.json";

export type AvatarCharacter = "girl" | "boy";
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
}
export const AVATAR_CATALOG_VERSION = catalog.version;
export const AVATAR_ITEMS = catalog.items as AvatarItem[];
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
  skinTone: "original",
  faceShape: "natural",
  expression: "natural",
  hairStyle: character === "boy" ? "curtain" : "bob",
  hairTone: "original",
  pose: "idle",
  top: "plain-top",
  bottom: "plain-bottom",
  shoes: "plain-shoes",
  accessory: "none",
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
  const next = { ...look, [item.slot]: item.value } as AvatarLook;
  if (item.slot === "character") {
    for (const { key } of AVATAR_SLOTS) {
      if (!itemForLook(next, key))
        next[key] = defaultAvatarLook(next.character)[key] as never;
    }
  }
  return next;
};
