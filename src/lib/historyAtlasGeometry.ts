import {
  geoMercator,
  geoNaturalEarth1,
  geoPath,
  type GeoPermissibleObjects,
} from "d3-geo";
import type { AtlasSubject, AtlasUnit } from "./historyAtlas";
import koreaLandUrl from "../data/atlas/land-korea.json?url";
import koreaRiversUrl from "../data/atlas/rivers-korea.json?url";
import worldLandUrl from "../data/atlas/land-world.json?url";
import worldRiversUrl from "../data/atlas/rivers-world.json?url";

export interface AtlasGeometry {
  land: GeoPermissibleObjects;
  rivers: GeoPermissibleObjects;
}

export interface AtlasTransform {
  x: number;
  y: number;
  scale: number;
}

export const ATLAS_IDENTITY: AtlasTransform = { x: 0, y: 0, scale: 1 };
export const ATLAS_MAX_ZOOM = 12;

const geometryCache = new Map<AtlasSubject, Promise<AtlasGeometry>>();

async function readGeometry(url: string): Promise<GeoPermissibleObjects> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Atlas geometry could not be loaded");
  return response.json();
}

/** Hash-addressed local assets load once per subject, never per pan or selection. */
export function loadAtlasGeometry(
  subject: AtlasSubject,
  bounds?: AtlasUnit["bounds"],
): Promise<AtlasGeometry> {
  // Korean history includes overseas missions and independence movements.
  // Do not draw a pin against the empty part of the clipped regional asset.
  const layer: AtlasSubject =
    subject === "korea" &&
    (!bounds ||
      (bounds[0] >= 90 &&
        bounds[1] >= 10 &&
        bounds[2] <= 160 &&
        bounds[3] <= 65))
      ? "korea"
      : "world";
  const cached = geometryCache.get(layer);
  if (cached) return cached;
  const urls =
    layer === "korea"
      ? [koreaLandUrl, koreaRiversUrl]
      : [worldLandUrl, worldRiversUrl];
  const promise = Promise.all(urls.map(readGeometry))
    .then(([land, rivers]) => ({ land, rivers }))
    .catch((error) => {
      geometryCache.delete(layer);
      throw error;
    });
  geometryCache.set(layer, promise);
  return promise;
}

/** A single geographic projection preserves aspect ratio at every canvas size. */
export function createAtlasProjection(
  subject: AtlasSubject,
  bounds: AtlasUnit["bounds"],
  width: number,
  height: number,
) {
  const [west, south, east, north] = bounds;
  const middleLongitude = (west + east) / 2;
  const projection =
    subject === "korea"
      ? geoMercator().center([middleLongitude, (south + north) / 2])
      : geoNaturalEarth1().rotate([-middleLongitude, 0]);
  // Sample the boundary as points: polygon winding must not invert the fit area.
  const coordinates: [number, number][] = [];
  for (let step = 0; step <= 20; step += 1) {
    const longitude = west + ((east - west) * step) / 20;
    const latitude = south + ((north - south) * step) / 20;
    coordinates.push([longitude, south], [longitude, north]);
    coordinates.push([west, latitude], [east, latitude]);
  }
  projection.fitExtent(
    [
      [32, 40],
      [Math.max(64, width - 32), Math.max(80, height - 40)],
    ],
    { type: "MultiPoint", coordinates },
  );
  return projection.precision(0.3);
}

export function createAtlasPaths(
  geometry: AtlasGeometry,
  projection: ReturnType<typeof createAtlasProjection>,
) {
  const path = geoPath(projection).digits(1);
  return {
    land: path(geometry.land) || "",
    rivers: path(geometry.rivers) || "",
  };
}

export function constrainAtlasTransform(
  transform: AtlasTransform,
  width: number,
  height: number,
): AtlasTransform {
  const scale = Math.min(ATLAS_MAX_ZOOM, Math.max(1, transform.scale));
  return {
    scale,
    x: Math.max(width * (0.2 - scale), Math.min(width * 0.8, transform.x)),
    y: Math.max(height * (0.2 - scale), Math.min(height * 0.8, transform.y)),
  };
}

export function zoomAtlasAt(
  transform: AtlasTransform,
  factor: number,
  point: [number, number],
  width: number,
  height: number,
) {
  const scale = Math.min(ATLAS_MAX_ZOOM, Math.max(1, transform.scale * factor));
  const ratio = scale / transform.scale;
  return constrainAtlasTransform(
    {
      scale,
      x: point[0] - (point[0] - transform.x) * ratio,
      y: point[1] - (point[1] - transform.y) * ratio,
    },
    width,
    height,
  );
}
