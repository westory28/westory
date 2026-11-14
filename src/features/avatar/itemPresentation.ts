import {
  AVATAR_SLOTS,
  avatarAccessoryGroup,
  type AvatarCharacter,
  type AvatarItem,
} from "./catalog";

/** Presentation only: catalog IDs, ownership and prices remain server owned. */
export function getAvatarItemGroup(item: AvatarItem): string {
  if (item.slot === "accessory")
    return { hat: "모자", accessory: "액세서리", glasses: "안경" }[
      avatarAccessoryGroup(item)
    ];
  if (item.value.startsWith("mm-hanbok-")) return "한복";
  if (item.slot === "top") {
    if (/^mm-school-(white|navy)$/.test(item.value)) return "용신중 하복";
    if (item.value.startsWith("mm-school-")) return "용신중 동복 체육복";
    return "일상 상의";
  }
  if (item.slot === "bottom") {
    if (item.value === "mm-school-shorts") return "용신중 하복";
    if (item.value === "mm-school-joggers") return "용신중 동복 체육복";
    return "일상 하의";
  }
  if (item.slot === "hairStyle") {
    if (/twin|tail|half|braid|bun/.test(item.value)) return "묶음머리";
    if (/long|wave/.test(item.value)) return "웨이브·긴 머리";
    return "짧은 머리·단발";
  }
  return AVATAR_SLOTS.find(({ key }) => key === item.slot)?.label ?? "기타";
}

export function avatarItemTypeLabel(item: AvatarItem): string {
  return AVATAR_SLOTS.find(({ key }) => key === item.slot)?.label ?? "기타";
}

export function avatarPreviewCharacter(
  item: AvatarItem,
  preferred: AvatarCharacter = "girl",
): AvatarCharacter {
  if (item.slot === "character") return item.value as AvatarCharacter;
  return item.characters.includes(preferred) ? preferred : item.characters[0];
}

export function avatarItemPreviewPath(
  item: AvatarItem,
  character?: AvatarCharacter,
): string {
  return `avatar/minimi-v2/previews/${avatarPreviewCharacter(item, character)}/${item.slot}-${item.value}.webp`;
}
