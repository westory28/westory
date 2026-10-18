import type {
  AtlasAreaCollection,
  AtlasAreaFeature,
} from "./historyAtlasAreas";
import splits from "../data/atlas/traditional-region-splits.json";

const sourceUrl = "https://encykorea.aks.ac.kr/Article/E0062616";
const definitions = [
  ["gwanbuk", "관북", "hamgyeong"],
  ["gwanseo", "관서", "pyeongan"],
  ["haeseo", "해서", "hwanghae"],
  ["gyeonggi", "경기", "gyeonggi"],
  ["gwandong", "관동", "gangwon"],
  ["hoseo", "호서", "chungcheong"],
  ["honam", "호남", "jeolla"],
  ["yeongnam", "영남", "gyeongsang"],
] as const;

const collectionCache = new WeakMap<AtlasAreaCollection, AtlasAreaCollection>();

/** These modern source polygons explain traditional names, not dated frontiers.
 * Giho overlaps Gyeonggi and Hoseo, so it is only returned on explicit selection.
 */
export function atlasKoreanTraditionalRegions(
  areas: AtlasAreaCollection,
): AtlasAreaCollection {
  const cached = collectionCache.get(areas);
  if (cached) return cached;
  const features: AtlasAreaFeature[] = [];
  for (const [regionId, name, provinceId] of definitions) {
    const original = areas.features.find(
      (feature) => feature.properties.regionId === provinceId,
    );
    if (!original) continue;
    const split = (splits as AtlasAreaCollection).features.find(
      (feature) => feature.properties.regionId === regionId,
    );
    features.push(
      split || {
        ...original,
        properties: {
          ...original.properties,
          id: `traditional-${regionId}`,
          regionId,
          name,
          source: `${original.properties.source} · 한국민족문화대백과사전`,
          sourceUrl,
          locationNote: `${name}은 ${original.properties.name} 일대를 부르는 전통 지역명이다. ${original.properties.locationNote} 전통 지역의 대략적 위치를 이해하기 위한 현대 경계이며, 특정 시대의 역사 경계를 복원한 것이 아니다.`,
        },
      },
    );
  }
  const jeju = (splits as AtlasAreaCollection).features.find(
    (feature) => feature.properties.regionId === "jeju",
  );
  if (jeju && features.length) features.push(jeju);
  const collection: AtlasAreaCollection = {
    type: "FeatureCollection",
    features,
  };
  collectionCache.set(areas, collection);
  return collection;
}

export function getAtlasKoreanTraditionalRegion(
  regionId: string,
  areas: AtlasAreaCollection,
): AtlasAreaFeature | null {
  if (regionId === "giho")
    return (
      (splits as AtlasAreaCollection).features.find(
        (feature) => feature.properties.regionId === "giho",
      ) || null
    );
  return (
    atlasKoreanTraditionalRegions(areas).features.find(
      (feature) => feature.properties.regionId === regionId,
    ) || null
  );
}

export const ATLAS_KOREAN_TRADITIONAL_REGION_OPTIONS = [
  ...definitions.map(([id, title]) => ({ id, title })),
  { id: "jeju", title: "제주" },
  { id: "giho", title: "기호 (경기·호서)" },
];
