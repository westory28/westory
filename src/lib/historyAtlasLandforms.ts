import { geoContains } from "d3-geo";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { AtlasPlace } from "./historyAtlas";
import geographyUrl from "../data/atlas/globe-geography.json?url";

export interface AtlasLandformGeography {
  deserts: MultiPolygon | FeatureCollection<Polygon | MultiPolygon>;
}

export type AtlasLandformCollection = FeatureCollection<
  Polygon | MultiPolygon,
  { placeId: string; name: string; source: string }
>;

let geographyPromise:
  | Promise<{ deserts: FeatureCollection<Polygon | MultiPolygon> }>
  | undefined;

/** Flat maps share the same locally bundled desert geometry as the globe. */
export function loadAtlasLandformGeometry() {
  geographyPromise ||= fetch(geographyUrl)
    .then(async (response) => {
      if (!response.ok) throw new Error("사막 지형을 불러오지 못했다.");
      const data = (await response.json()) as { deserts: MultiPolygon };
      if (data.deserts?.type !== "MultiPolygon")
        throw new Error("사막 지형 자료의 형식이 올바르지 않다.");
      return {
        deserts: {
          type: "FeatureCollection" as const,
          features: data.deserts.coordinates.map((coordinates) => ({
            type: "Feature" as const,
            properties: {},
            geometry: { type: "Polygon" as const, coordinates },
          })),
        },
      };
    })
    .catch((error) => {
      geographyPromise = undefined;
      throw error;
    });
  return geographyPromise;
}

// These are the original Natural Earth desert parts in globe-geography.json,
// at revision ca96624a56bd078437bca8184e78163e5039ad19. Sahara is a two-part
// MultiPolygon; its tiny western part must not be silently discarded.
const desertParts: Record<
  string,
  { indexes: number[]; interior: [number, number] }
> = {
  "kr-fe954fbe1cc0": { indexes: [0], interior: [106.0126, 43.1336] },
  "world-9e21644b4935": { indexes: [1, 2], interior: [12.1037, 21.9424] },
};

export const isAtlasLandformArea = (place: AtlasPlace) =>
  Object.prototype.hasOwnProperty.call(desertParts, place.id);

/** Reuse verified source polygons for drawing, bounds and geoContains hit tests.
 * Label points never stand in for the geographical extent of a desert.
 */
export function findAtlasLandform(
  place: AtlasPlace,
  geography: AtlasLandformGeography,
): AtlasLandformCollection | null {
  const match = desertParts[place.id];
  if (!match) return null;
  const coordinates =
    geography.deserts?.type === "MultiPolygon"
      ? geography.deserts.coordinates
      : geography.deserts?.type === "FeatureCollection"
        ? geography.deserts.features.flatMap((feature) =>
            feature.geometry.type === "Polygon"
              ? [feature.geometry.coordinates]
              : feature.geometry.coordinates,
          )
        : [];
  const parts = match.indexes.map((index) => coordinates[index]);
  if (parts.some((part) => !part?.length)) return null;
  const geometry: MultiPolygon = { type: "MultiPolygon", coordinates: parts };
  // Fail closed if an incompatible source revision changes the part order.
  if (!geoContains(geometry, match.interior)) return null;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          placeId: place.id,
          name: place.name,
          source: "Natural Earth",
        },
        geometry,
      },
    ],
  };
}
