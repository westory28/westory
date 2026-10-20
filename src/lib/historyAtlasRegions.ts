import type { AtlasPlace, AtlasSubject } from "./historyAtlas";
import { koreaAtlasRegionIdsByPlace } from "../data/historyAtlasKoreaRegions";
import { worldAtlasRegionIdsByPlace } from "../data/historyAtlasWorldRegions";
import { atlasKoreaRestoredRegionOverrides } from "../data/historyAtlasKoreaRestoration";
import { atlasLandformRegionOverrides } from "../data/historyAtlasLandformRestoration";
import { atlasEastAsiaReferences } from "../data/historyAtlasEastAsia";

export interface AtlasRegionOption {
  id: string;
  title: string;
}

export interface AtlasRegionGroup extends AtlasRegionOption {
  children: AtlasRegionOption[];
}

export const ATLAS_KOREA_PROVINCES: AtlasRegionOption[] = [
  { id: "gyeonggi", title: "경기도" },
  { id: "gangwon", title: "강원도" },
  { id: "chungcheong", title: "충청도" },
  { id: "jeolla", title: "전라도" },
  { id: "gyeongsang", title: "경상도" },
  { id: "hwanghae", title: "황해도" },
  { id: "pyeongan", title: "평안도" },
  { id: "hamgyeong", title: "함경도" },
  { id: "outside-korea", title: "8도 밖" },
  { id: "unclassified", title: "지역 미분류" },
];

export const ATLAS_WORLD_REGION_GROUPS: AtlasRegionGroup[] = [
  {
    id: "europe",
    title: "유럽",
    children: [
      { id: "europe-west", title: "서유럽" },
      { id: "europe-east", title: "동유럽" },
      { id: "europe-south", title: "남유럽" },
      { id: "europe-north", title: "북유럽" },
    ],
  },
  {
    id: "asia",
    title: "아시아",
    children: [
      { id: "asia-west", title: "서아시아" },
      { id: "asia-south", title: "남아시아" },
      { id: "asia-east", title: "동아시아" },
      { id: "asia-southeast", title: "동남아시아" },
      { id: "asia-central", title: "중앙아시아" },
      { id: "asia-north", title: "북아시아" },
    ],
  },
  {
    id: "africa",
    title: "아프리카",
    children: [
      { id: "africa-north", title: "북아프리카" },
      { id: "africa-south", title: "남아프리카" },
      { id: "africa-east", title: "동아프리카" },
      { id: "africa-west", title: "서아프리카" },
      { id: "africa-central", title: "중앙아프리카" },
    ],
  },
  { id: "middle-east", title: "중동", children: [] },
  {
    id: "america",
    title: "아메리카",
    children: [
      { id: "america-north", title: "북아메리카" },
      { id: "america-south", title: "남아메리카" },
      { id: "america-central", title: "중앙아메리카" },
      { id: "america-caribbean", title: "카리브 지역" },
    ],
  },
  {
    id: "oceania",
    title: "오세아니아",
    children: [
      { id: "oceania-australia", title: "오스트레일리아·뉴질랜드" },
      { id: "oceania-pacific", title: "태평양 제도" },
    ],
  },
  { id: "antarctica", title: "남극", children: [] },
  { id: "arctic", title: "북극", children: [] },
  { id: "greenland", title: "그린란드", children: [] },
  {
    id: "water",
    title: "바다·대양",
    children: [
      { id: "water-pacific", title: "태평양" },
      { id: "water-atlantic", title: "대서양" },
      { id: "water-indian", title: "인도양" },
      { id: "water-southern", title: "남극해" },
      { id: "water-arctic", title: "북극해" },
      { id: "water-mediterranean", title: "지중해" },
      { id: "water-black", title: "흑해" },
      { id: "water-red", title: "홍해" },
      { id: "water-baltic", title: "발트해" },
      { id: "water-caribbean", title: "카리브해" },
      { id: "water-east-asia", title: "동아시아 해역" },
      { id: "water-other", title: "기타 해역" },
    ],
  },
  { id: "unclassified", title: "지역 미분류", children: [] },
];

const regionGroups = new Map(
  ATLAS_WORLD_REGION_GROUPS.map((group) => [group.id, group]),
);
const provinceIds = new Set(ATLAS_KOREA_PROVINCES.map(({ id }) => id));
const eastAsiaReferenceIds = new Set(
  atlasEastAsiaReferences.map(({ place }) => place.id),
);

/** Static, source-backed memberships; never infer a place from a search alias. */
export function getAtlasPlaceRegionIds(
  place: AtlasPlace,
  subject: AtlasSubject,
): readonly string[] {
  const ids =
    subject === "korea"
      ? atlasKoreaRestoredRegionOverrides[place.id] ||
        koreaAtlasRegionIdsByPlace[place.id]
      : atlasLandformRegionOverrides[place.id] ||
        worldAtlasRegionIdsByPlace[place.id];
  if (ids?.length && !ids.every((id) => id === "unclassified")) return ids;
  if (eastAsiaReferenceIds.has(place.id))
    return subject === "korea"
      ? ["outside-korea"]
      : place.id === "kr-6c3a9774fc76"
        ? ["asia-north"]
        : ["asia-east"];
  return ["unclassified"];
}

export function matchesAtlasRegion(
  place: AtlasPlace,
  subject: AtlasSubject,
  groupId: string,
  subregionId = "",
): boolean {
  if (!groupId) return true;
  const ids = getAtlasPlaceRegionIds(place, subject);
  if (subject === "korea")
    return provinceIds.has(groupId) && ids.includes(groupId);

  const group = regionGroups.get(groupId);
  if (!group) return false;
  if (subregionId)
    return (
      group.children.some(({ id }) => id === subregionId) &&
      ids.includes(subregionId)
    );
  return (
    ids.includes(groupId) || group.children.some(({ id }) => ids.includes(id))
  );
}
