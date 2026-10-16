import { geoContains } from "d3-geo";
import type {
  Feature,
  FeatureCollection,
  MultiLineString,
  MultiPolygon,
  Polygon,
} from "geojson";
import { normalizeAtlasSearch, type AtlasPlace } from "./historyAtlas";
import countriesUrl from "../data/atlas/countries-world.json?url";

export interface AtlasCountryProperties {
  id: string;
  name: string;
  coordinates: [number, number];
  minZoom: number;
}

export type AtlasCountryFeature = Feature<
  Polygon | MultiPolygon,
  AtlasCountryProperties
>;
export type AtlasCountryCollection = FeatureCollection<
  Polygon | MultiPolygon,
  AtlasCountryProperties
>;
export interface AtlasCountryGeometry {
  countries: AtlasCountryCollection;
  borders: MultiLineString;
  disputedBorders: MultiLineString;
}

export const ATLAS_COUNTRY_HELP =
  "국가·지역 영역은 세계은행 공식 경계 자료를 기준으로 하며 역사적 영토를 뜻하지 않습니다. 세계은행의 법적 지위 미확정 지역은 선택 영역에서 제외하고, 분쟁·미확정 경계는 점선으로 구분합니다. 한반도는 별도 표시 원칙에 따라 대한민국으로 통합했습니다. 경계는 화면 표시를 위해 단순화했습니다.";
export const ATLAS_COUNTRY_SOURCE_URL =
  "https://datacatalog.worldbank.org/search/dataset/0038272/world-bank-official-boundaries";
export const ATLAS_COUNTRY_LICENSE_URL =
  "https://creativecommons.org/licenses/by/4.0/";

let countryPromise: Promise<AtlasCountryGeometry> | undefined;

/** One source-backed, self-hosted layer shared by the atlas and globe. */
export function loadAtlasCountryGeometry(): Promise<AtlasCountryGeometry> {
  if (!countryPromise)
    countryPromise = fetch(countriesUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error("국가 경계를 불러오지 못했습니다.");
        const geometry = (await response.json()) as AtlasCountryGeometry;
        if (
          geometry.countries?.type !== "FeatureCollection" ||
          !geometry.countries.features?.length ||
          geometry.borders?.type !== "MultiLineString" ||
          geometry.disputedBorders?.type !== "MultiLineString" ||
          geometry.countries.features.some(
            (feature) =>
              !["Polygon", "MultiPolygon"].includes(feature.geometry?.type) ||
              !feature.properties?.id ||
              !feature.properties.name ||
              feature.properties.coordinates?.length !== 2 ||
              !feature.properties.coordinates.every(Number.isFinite) ||
              !Number.isFinite(feature.properties.minZoom),
          )
        )
          throw new Error("국가 경계 자료의 형식이 올바르지 않습니다.");
        return geometry;
      })
      .catch((error) => {
        countryPromise = undefined;
        throw error;
      });
  return countryPromise;
}

export function findAtlasCountry(
  coordinates: [number, number],
  collection: AtlasCountryCollection,
): AtlasCountryFeature | null {
  if (!coordinates.every(Number.isFinite) || Math.abs(coordinates[1]) > 90)
    return null;
  const point: [number, number] = [
    ((((coordinates[0] + 180) % 360) + 360) % 360) - 180,
    coordinates[1],
  ];
  return (
    collection.features.find((feature) => geoContains(feature, point)) || null
  );
}

// Exact modern-name aliases only. Historical country records also use the
// "country" kind, so an unknown name must never acquire today's territory by
// falling back to its capital/label coordinates (e.g. Rome -> Italy).
const countryNameIds: Record<string, string> = {
  한국: "KOR",
  대한민국: "KOR",
  중국: "CHN",
  중화인민공화국: "CHN",
  타이: "THA",
  태국: "THA",
  에스파냐: "ESP",
  스페인: "ESP",
  튀르키예: "TUR",
  터키: "TUR",
  타이완: "TWN",
  대만: "TWN",
  아랍에미리트: "ARE",
  중앙아프리카공화국: "CAF",
  콩고: "COG",
  미크로네시아: "FSM",
  마셜제도: "MHL",
  바티칸: "VAT",
  도미니카: "DMA",
};

export function findAtlasCountryForPlace(
  place: AtlasPlace,
  collection: AtlasCountryCollection,
): AtlasCountryFeature | null {
  if (place.kind !== "country") return null;
  const name = normalizeAtlasSearch(place.name);
  const id = countryNameIds[name];
  return (
    collection.features.find((feature) =>
      id
        ? feature.properties.id === id
        : normalizeAtlasSearch(feature.properties.name) === name,
    ) || null
  );
}
