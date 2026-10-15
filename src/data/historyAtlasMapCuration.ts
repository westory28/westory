import type { AtlasPlace } from "../lib/historyAtlas";
import type { AtlasHistoricalStory } from "../lib/historyAtlasStories";
import {
  ATLAS_DOKDO_COORDINATES,
  ATLAS_DOKDO_ID,
  ATLAS_DOKDO_LOCATION_SOURCE,
} from "./historyAtlasDokdo";

export const ATLAS_CHEORWON_ID = "kr-5946842fc116";
export const ATLAS_GWIJU_ID = "kr-bd065f0d1538";
export const ATLAS_TAEBONG_EVENT_ID = `story-korea-taebong-renamed-${ATLAS_CHEORWON_ID}`;

/** Sources for independently checked modern reference points.
 * These points do not assert historic battlefield positions or site boundaries.
 */
export const atlasMapLocationEvidence = {
  [ATLAS_DOKDO_ID]: [ATLAS_DOKDO_LOCATION_SOURCE],
  [ATLAS_GWIJU_ID]: [
    {
      title: "국사편찬위원회 우리역사넷 · 귀주대첩",
      url: "https://contents.history.go.kr/mobile/kc/view.do?levelId=kc_i200400",
    },
    {
      title: "GeoNames · Kusŏng-si (1875107, populated place)",
      url: "https://www.geonames.org/1875107/kusong-si.html",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    },
  ],
};

export const atlasMapPlaceOverrides: Record<string, Partial<AtlasPlace>> = {
  [ATLAS_DOKDO_ID]: {
    modernName: "대한민국 경상북도 울릉군 울릉읍 독도리",
    coordinates: ATLAS_DOKDO_COORDINATES,
    kind: "island",
    locationNote:
      "대한민국 경상북도 울릉군의 독도이다. 해양수산부가 공개한 동도의 좌표를 대표점으로 사용했다. 동도·서도 전체의 경계나 면적을 나타내는 점은 아니다.",
  },
  [ATLAS_GWIJU_ID]: {
    modernName: "평안북도 구성시",
    coordinates: [125.2529, 39.97969],
    locationNote:
      "국사편찬위원회가 귀주로 비정한 평안북도 구성시 일대의 대표 위치이다. GeoNames의 구성 정주지 좌표를 사용했으며, 귀주대첩의 정확한 전투 지점이나 귀주성의 경계를 뜻하지 않는다.",
  },
};

// Political names belong in dated historical accounts, not city synonyms.
export const atlasMapContextOnlyAliases: Record<string, string[]> = {
  gimhae: ["금관가야"],
  jeju: ["탐라"],
};

/** Individual review of residual captions that passed the old sentence filter.
 * Their source ledger remains available; these alone cannot justify a map pin.
 */
export const atlasMapExcludedEntries: Record<string, string> = {
  "kr-entry-2557f78c117d":
    "의림지를 삼한의 농업 자료로 제시한다는 캡션이며 개별 역사 설명이 없다.",
  "world-exp-world-5b3e89fd66c7-1":
    "제네바에서 일어난 개별 사건 대신 종교 개혁 지도의 전파 범위만 설명한다.",
  "world-exp-world-c8937d58c6d1-3":
    "콜카타 자체의 사건 대신 벵골 분할 지도에 등장하는 배경을 설명한다.",
  "world-exp-world-8510abc47546-5":
    "사이공의 개별 사건 대신 베트남 전쟁 지도의 공간적 배경만 설명한다.",
  "world-exp-world-13c2900caa06-3":
    "빈센스와 현대 위치를 대조한 기록이며 개별 전투의 역사 설명이 없다.",
  "world-exp-world-23d8fb870454-5":
    "처칠의 인용문에 등장한다는 설명이며 도시 자체의 역사 사건이 아니다.",
};

/** An existing relationship can name a particular event without adding a
 * second link or changing the original source ledger.
 */
export const atlasMapRelationEntryTargets: Record<
  string,
  Record<string, string>
> = {
  "korea-goryeo-founded": {
    kaesong: "story-korea-gaegyeong-capital-kaesong",
  },
  "korea-incheon-landing": {
    seoul: "kr-entry-1f4225de4d5e",
  },
  "korea-busan-refuge": {
    seoul: "kr-entry-1f4225de4d5e",
  },
};

/** A place match alone does not justify opening an unrelated historical era. */
export const atlasMapExcludedRelationTargets: Record<string, string[]> = {
  "korea-hubaekje-capital": ["gwangju"],
  "korea-ganghwa-treaty": ["busan"],
  "korea-gongsan-battle": ["gyeongju"],
  "korea-seogyeong-movement": ["kaesong"],
  "korea-ganghwa-capital": ["kaesong"],
};

export const atlasMapContextLinks: Record<
  string,
  NonNullable<AtlasHistoricalStory["related"]>
> = {
  "korea-cheorwon-capital": [
    {
      placeId: ATLAS_CHEORWON_ID,
      targetEntryId: ATLAS_TAEBONG_EVENT_ID,
      label: "태봉",
      reason: "철원은 궁예가 911년 국호를 태봉으로 바꿀 당시의 수도였다.",
      fromPlaceIds: [ATLAS_CHEORWON_ID],
    },
  ],
};
