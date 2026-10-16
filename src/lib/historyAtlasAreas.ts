import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import { geoBounds, geoContains } from "d3-geo";
import type { AtlasPlace, AtlasSubject, AtlasUnit } from "./historyAtlas";
import {
  ATLAS_KOREA_PROVINCES,
  matchesAtlasRegion,
} from "./historyAtlasRegions";
import koreaAreasUrl from "../data/atlas/areas-korea.json?url";
import worldAreasUrl from "../data/atlas/areas-world.json?url";

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

const areaPromises = new Map<
  AtlasSubject | "all",
  Promise<AtlasAreaCollection>
>();

/** Offline source-backed boundaries, independent of semester or portal data. */
export function loadAtlasAreaGeometry(
  subject: AtlasSubject | "all" = "korea",
): Promise<AtlasAreaCollection> {
  const cached = areaPromises.get(subject);
  if (cached) return cached;
  const promise = (
    subject === "all"
      ? Promise.all([
          loadAtlasAreaGeometry("korea"),
          loadAtlasAreaGeometry("world"),
        ]).then(
          (collections): AtlasAreaCollection => ({
            type: "FeatureCollection",
            features: collections.flatMap((collection) => collection.features),
          }),
        )
      : fetch(subject === "korea" ? koreaAreasUrl : worldAreasUrl).then(
          async (response) => {
            if (!response.ok) throw new Error("지역 범위를 불러오지 못했다.");
            const collection = (await response.json()) as AtlasAreaCollection;
            if (
              collection.type !== "FeatureCollection" ||
              !collection.features?.length ||
              collection.features.some(
                (feature) =>
                  !["Polygon", "MultiPolygon"].includes(
                    feature.geometry?.type,
                  ) ||
                  feature.properties?.coordinates?.length !== 2 ||
                  !feature.properties.coordinates.every(Number.isFinite),
              )
            )
              throw new Error("지역 범위 자료의 형식이 올바르지 않다.");
            return collection;
          },
        )
  ).catch((error) => {
    areaPromises.delete(subject);
    throw error;
  });
  areaPromises.set(subject, promise);
  return promise;
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

export const findAtlasRegionArea = (
  regionId: string,
  collection: AtlasAreaCollection,
): AtlasAreaFeature | null =>
  collection.features.find(
    (feature) => feature.properties.regionId === regionId,
  ) || null;

export const findAtlasProvinceArea = findAtlasRegionArea;

const koreanRegions = new Set(ATLAS_KOREA_PROVINCES.map(({ id }) => id));
const worldLandRegions = new Set([
  "europe",
  "asia",
  "africa",
  "america",
  "oceania",
  "antarctica",
  "greenland",
]);
const membershipCache = new WeakMap<
  AtlasAreaCollection,
  WeakMap<AtlasPlace, Map<string, boolean>>
>();

/** Located places follow the displayed current boundary; unknown locations keep
 * their reviewed catalogue membership rather than receiving invented points. */
export function matchesAtlasCurrentRegion(
  place: AtlasPlace,
  subject: AtlasSubject,
  regionId: string,
  subregionId: string,
  collection: AtlasAreaCollection | null,
): boolean {
  if (!regionId) return true;
  // Coastal point/coastline rounding must not turn a port or river into a sea.
  // Retain the reviewed marine category before locating it in current waters.
  if (
    subject === "world" &&
    regionId === "water" &&
    !matchesAtlasRegion(place, subject, "water")
  )
    return false;
  const area =
    collection && findAtlasRegionArea(subregionId || regionId, collection);
  if (!place.coordinates || !collection)
    return matchesAtlasRegion(place, subject, regionId, subregionId);
  // The date line has two equivalent spellings; use the same side for polygon
  // containment so a -180° location does not fall through a shared seam.
  const coordinates: [number, number] = [
    place.coordinates[0] === -180 ? 180 : place.coordinates[0],
    place.coordinates[1],
  ];
  let byPlace = membershipCache.get(collection);
  if (!byPlace) {
    byPlace = new WeakMap();
    membershipCache.set(collection, byPlace);
  }
  let membership = byPlace.get(place);
  if (!membership) {
    membership = new Map();
    byPlace.set(place, membership);
  }
  const key = `${subject}:${subregionId || regionId}`;
  const cached = membership.get(key);
  if (cached !== undefined) return cached;
  const hasKnownLand = () => {
    const knownKey = `${subject}:known-land`;
    const known = membership.get(knownKey);
    if (known !== undefined) return known;
    const parentIds = subject === "korea" ? koreanRegions : worldLandRegions;
    const knownLand = collection.features.some(
      (feature) =>
        parentIds.has(feature.properties.regionId || "") &&
        geoContains(feature, coordinates),
    );
    membership.set(knownKey, knownLand);
    return knownLand;
  };
  let included = area
    ? geoContains(area, coordinates)
    : matchesAtlasRegion(place, subject, regionId, subregionId);
  if (!area && (regionId === "outside-korea" || regionId === "unclassified")) {
    if (hasKnownLand()) included = false;
  } else if (area && !included) {
    // Simplified shorelines omit some ports, straits and tiny islands. Preserve
    // their reviewed membership only when no current land region contains them.
    if (!hasKnownLand())
      included = matchesAtlasRegion(place, subject, regionId, subregionId);
  }
  membership.set(key, included);
  return included;
}

/** Keep date-line neighbours together and never pad past a full globe or pole. */
export function atlasAreaCameraBounds(
  area: AtlasAreaFeature,
): AtlasUnit["bounds"] {
  const [[west, south], [rawEast, north]] = geoBounds(area);
  const east = rawEast < west ? rawEast + 360 : rawEast;
  const padding = Math.max(
    0.25,
    (east - west) * 0.025,
    (north - south) * 0.025,
  );
  const fullLongitude = east - west + padding * 2 >= 360;
  return [
    fullLongitude ? -180 : west - padding,
    Math.max(-90, south - padding),
    fullLongitude ? 180 : east + padding,
    Math.min(90, north + padding),
  ];
}
