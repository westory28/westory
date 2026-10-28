import { AVATAR_SLOTS, type AvatarCharacter, type AvatarItem } from "./catalog";

/** Presentation only: catalog IDs, ownership and prices remain server owned. */
export function getAvatarItemGroup(item: AvatarItem): string {
  if (item.slot === "top") {
    if (item.value.startsWith("hanbok-")) return "한복 저고리";
    if (item.value.startsWith("official-")) return "관복";
    if (item.value.startsWith("summer-")) return "학교 하복";
    return "재킷·기본복";
  }
  if (item.slot === "bottom") {
    if (item.value.startsWith("chima-")) return "한복 치마";
    if (item.value.startsWith("baji-")) return "한복 바지";
    if (item.value.startsWith("summer-")) return "학교 하복";
    return "일상 하의";
  }
  if (item.slot === "accessory") {
    if (item.value.startsWith("official-")) return "전통 모자";
    if (item.value === "glasses-round") return "안경";
    if (item.value === "headphones") return "헤드폰";
    return "머리 장식";
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
  return `avatar/v1/previews-v3/${avatarPreviewCharacter(item, character)}/${item.slot}-${item.value}.webp`;
}
