import type { AtlasPlace } from "./historyAtlas";
import {
  historyAtlasPlaceProfiles,
  type AtlasPlaceProfile,
} from "../data/historyAtlasPlaceProfiles";

export type {
  AtlasPlaceProfile,
  AtlasProfileSource,
} from "../data/historyAtlasPlaceProfiles";

const normalizeName = (name: string) =>
  name.normalize("NFKC").replace(/\s+/gu, "");
const profilesById = new Map(
  historyAtlasPlaceProfiles.flatMap((profile) =>
    (profile.placeIds || []).map((id) => [id, profile] as const),
  ),
);
const profilesByName = new Map(
  historyAtlasPlaceProfiles.flatMap((profile) =>
    profile.names.map((name) => [normalizeName(name), profile] as const),
  ),
);

export const getAtlasPlaceKindLabel = (place: AtlasPlace): string => {
  if (place.kind === "water") {
    if (/해협$/u.test(place.name)) return "해협";
    if (/해구$/u.test(place.name)) return "해구";
    if (/(강|하)$/u.test(place.name)) return "하천";
    if (/(호|호수)$/u.test(place.name)) return "호수";
    if (/만$/u.test(place.name)) return "만";
    if (/(해|양|바다)$/u.test(place.name)) return "바다";
    return "수역";
  }
  if (place.kind === "mountain") {
    if (/산맥$/u.test(place.name)) return "산맥";
    if (/산$/u.test(place.name)) return "산";
    return "산지";
  }
  if (place.kind === "settlement") return "도시·취락";
  if (place.kind === "site") return "유적·장소";
  if (place.kind === "region") return "지역";
  if (place.kind === "country") return "국가·정치 영역";
  return "지명";
};

/** Metadata-only fallback never turns an unverified pin into a modern address,
 * nor a search keyword (e.g. 자금성 on 베이징) into a place's identity.
 */
export const getAtlasPlaceProfile = (place: AtlasPlace): AtlasPlaceProfile => {
  const profile =
    profilesById.get(place.id) || profilesByName.get(normalizeName(place.name));
  if (profile) {
    return {
      definition: profile.definition,
      facts: profile.facts.map((fact) => ({ ...fact })),
      sources: profile.sources.map((source) => ({ ...source })),
      textbookCitations: profile.textbookCitations?.map((citation) => ({
        ...citation,
      })),
      quality: "verified",
    };
  }

  const kind = getAtlasPlaceKindLabel(place);
  const modernName = place.modernName?.trim();
  return {
    definition: kind === "지명" ? place.name : `${place.name} · ${kind}`,
    facts:
      modernName && normalizeName(modernName) !== normalizeName(place.name)
        ? [{ label: "현재 명칭·위치", value: modernName }]
        : [],
    sources: [],
    quality: "basic",
  };
};
