import type { AtlasEntry, AtlasPlace } from "./historyAtlas";
import {
  historyAtlasPlaceProfiles,
  type AtlasPlaceProfile,
} from "../data/historyAtlasPlaceProfiles";
import { historyAtlasReferenceDefinitions } from "../data/historyAtlasReferenceDefinitions";
import { historyAtlasEncyclopediaDefinitions } from "../data/historyAtlasEncyclopediaDefinitions";

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
const referenceDefinitionsById = new Map(
  historyAtlasReferenceDefinitions.map(([id, title, revision, definition]) => [
    id,
    {
      definition,
      facts: [],
      sources: [
        {
          title: `위키백과 기여자 · ${title} (본문 발췌·요약)`,
          url: `https://ko.wikipedia.org/w/index.php?oldid=${revision}`,
          license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
          licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
        },
      ],
      quality: "reference" as const,
    },
  ]),
);
const encyclopediaDefinitionsById = new Map<string, AtlasPlaceProfile>(
  historyAtlasEncyclopediaDefinitions.map(
    ([id, title, article, definition]) => [
      id,
      {
        definition,
        facts: [],
        sources: [
          {
            title: `한국학중앙연구원 한국민족문화대백과사전 · ${title}`,
            url: `https://encykorea.aks.ac.kr/Article/${article}`,
          },
        ],
        quality: "reference",
      },
    ],
  ),
);

/** Source captions belong in the citation disclosure, not in the explanation. */
export const isAtlasSourceContext = (text: string): boolean =>
  /^교과서(?:는|에서|의)|(?:지도|교과서|자료|사진|본문|주석|단원).*(?:등장|표시|소개|제시)|(?:다루는|보여 주는|설명하는).*(?:지도|자료|사진)|지명으로 (?:표시|등장)/u.test(
    text,
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
  if (place.kind === "island") return "섬";
  if (place.kind === "region") return "지역";
  if (place.kind === "country") return "국가·정치 영역";
  return "지명";
};

/** Metadata-only fallback never turns an unverified pin into a modern address,
 * nor a search keyword (e.g. 자금성 on 베이징) into a place's identity.
 */
export const getAtlasPlaceProfile = (
  place: AtlasPlace,
  entries: AtlasEntry[] = [],
): AtlasPlaceProfile => {
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

  const explainedEntry = entries.find(
    (entry) =>
      entry.placeId === place.id && !isAtlasSourceContext(entry.summary),
  );
  if (explainedEntry) {
    return {
      definition: explainedEntry.summary,
      facts: [],
      sources: explainedEntry.historicalStory?.sources || [],
      textbookCitations: explainedEntry.citations,
      quality: "verified",
    };
  }

  const referenceDefinition =
    encyclopediaDefinitionsById.get(place.id) ||
    referenceDefinitionsById.get(place.id);
  if (referenceDefinition) return referenceDefinition;

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
