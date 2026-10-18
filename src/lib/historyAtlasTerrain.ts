import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import terrainUrl from "../data/atlas/terrain.json?url";

export type AtlasTerrainKind =
  | "mountain"
  | "plateau"
  | "desert"
  | "plain"
  | "basin";

export interface AtlasTerrainProperties {
  id: string;
  name: string;
  kind: AtlasTerrainKind;
  coordinates: [number, number];
  minZoom: number;
  source: string;
  sourceUrl: string;
  locationNote: string;
  korea?: boolean;
}

export type AtlasTerrainFeature = Feature<
  Polygon | MultiPolygon,
  AtlasTerrainProperties
>;
export type AtlasTerrainCollection = FeatureCollection<
  Polygon | MultiPolygon,
  AtlasTerrainProperties
>;

let terrainPromise: Promise<AtlasTerrainCollection> | undefined;

/** Physical terrain is a separate local layer; historical desert lookup stays unchanged. */
export function loadAtlasTerrainGeometry(): Promise<AtlasTerrainCollection> {
  terrainPromise ||= fetch(terrainUrl)
    .then(async (response) => {
      if (!response.ok) throw new Error("지형을 불러오지 못했습니다.");
      const data = (await response.json()) as AtlasTerrainCollection;
      if (
        data.type !== "FeatureCollection" ||
        !data.features?.length ||
        data.features.some(
          (feature) =>
            !["Polygon", "MultiPolygon"].includes(feature.geometry?.type) ||
            !["mountain", "plateau", "desert", "plain", "basin"].includes(
              feature.properties?.kind,
            ) ||
            feature.properties?.coordinates?.length !== 2 ||
            !feature.properties.coordinates.every(Number.isFinite),
        )
      )
        throw new Error("지형 자료의 형식이 올바르지 않습니다.");
      return data;
    })
    .catch((error) => {
      terrainPromise = undefined;
      throw error;
    });
  return terrainPromise;
}
