import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import type { AtlasPlace } from "./historyAtlas";
import areasUrl from "../data/atlas/areas-korea.json?url";

export interface AtlasAreaProperties {
  id: string;
  name: string;
  placeId?: string;
  regionId?: string;
  coordinates: [number, number];
  locationNote: string;
  source: string;
  sourceUrl: string;
}

export type AtlasAreaFeature = Feature<
  Polygon | MultiPolygon,
  AtlasAreaProperties
>;
export type AtlasAreaCollection = FeatureCollection<
  Polygon | MultiPolygon,
  AtlasAreaProperties
>;

let areasPromise: Promise<AtlasAreaCollection> | undefined;

/** Offline source-backed boundaries, independent of semester or portal data. */
export function loadAtlasAreaGeometry(): Promise<AtlasAreaCollection> {
  areasPromise ||= fetch(areasUrl)
    .then(async (response) => {
      if (!response.ok) throw new Error("지역 범위를 불러오지 못했다.");
      const collection = (await response.json()) as AtlasAreaCollection;
      if (
        collection.type !== "FeatureCollection" ||
        !collection.features?.length ||
        collection.features.some(
          (feature) =>
            !["Polygon", "MultiPolygon"].includes(feature.geometry?.type) ||
            feature.properties?.coordinates?.length !== 2 ||
            !feature.properties.coordinates.every(Number.isFinite),
        )
      )
        throw new Error("지역 범위 자료의 형식이 올바르지 않다.");
      return collection;
    })
    .catch((error) => {
      areasPromise = undefined;
      throw error;
    });
  return areasPromise;
}

const areaPlaceIds = new Set(["ganghwa", "jeju", "hansando", "incheon"]);

export const isAtlasAreaPlace = (place: AtlasPlace) =>
  areaPlaceIds.has(place.id);

export const findAtlasArea = (
  place: AtlasPlace,
  collection: AtlasAreaCollection,
): AtlasAreaFeature | null =>
  collection.features.find(
    (feature) => feature.properties.placeId === place.id,
  ) || null;

export const findAtlasProvinceArea = (
  regionId: string,
  collection: AtlasAreaCollection,
): AtlasAreaFeature | null =>
  collection.features.find(
    (feature) => feature.properties.regionId === regionId,
  ) || null;
