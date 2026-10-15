import {
  geoMercator,
  geoNaturalEarth1,
  geoCentroid,
  geoOrthographic,
  geoPath,
  type GeoPermissibleObjects,
  type GeoProjection,
} from "d3-geo";
import type { AtlasSubject, AtlasUnit } from "./historyAtlas";
import {
  constrainGlobeView,
  isGlobePointVisible,
  type GlobeView,
} from "./historyGlobeMath";
import koreaLandUrl from "../data/atlas/land-korea.json?url";
import koreaRiversUrl from "../data/atlas/rivers-korea.json?url";
import worldLandUrl from "../data/atlas/land-world.json?url";
import worldRiversUrl from "../data/atlas/rivers-world.json?url";
import riverSupplementUrl from "../data/atlas/rivers-supplement.json?url";
import type { AtlasRiverCollection } from "./historyAtlasRivers";

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
const riversCache = new Map<AtlasSubject, Promise<AtlasRiverCollection>>();
let supplementPromise: Promise<GeoPermissibleObjects> | undefined;

async function readGeometry(url: string): Promise<GeoPermissibleObjects> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Atlas geometry could not be loaded");
  return response.json();
}

export function loadAtlasRiverGeometry(
  subject: AtlasSubject,
): Promise<AtlasRiverCollection> {
  const cached = riversCache.get(subject);
  if (cached) return cached;
  supplementPromise ||= readGeometry(riverSupplementUrl).catch((error) => {
    supplementPromise = undefined;
    throw error;
  });
  const promise = Promise.all([
    readGeometry(subject === "korea" ? koreaRiversUrl : worldRiversUrl),
    supplementPromise,
  ])
    .then(
      ([rivers, supplement]) =>
        ({
          type: "FeatureCollection" as const,
          features: [
            ...(rivers.type === "FeatureCollection"
              ? (rivers as AtlasRiverCollection).features
              : []),
            ...(supplement.type === "FeatureCollection"
              ? (supplement as AtlasRiverCollection).features
              : []),
          ],
        }) as AtlasRiverCollection,
    )
    .catch((error) => {
      riversCache.delete(subject);
      throw error;
    });
  riversCache.set(subject, promise);
  return promise;
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
  const promise = Promise.all([
    readGeometry(layer === "korea" ? koreaLandUrl : worldLandUrl),
    loadAtlasRiverGeometry(layer),
  ])
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
      ? geoMercator()
          .rotate([-middleLongitude, 0])
          .center([0, (south + north) / 2])
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

/** A camera extent from located places, never a historical boundary polygon. */
export function atlasRegionCameraBounds(
  input: readonly [number, number][],
  subject: AtlasSubject,
): AtlasUnit["bounds"] | null {
  const coordinates = input.filter((point) => point.every(Number.isFinite));
  if (!coordinates.length) return null;
  const longitudes = [
    ...new Set(
      coordinates.map(([longitude]) => ((longitude % 360) + 360) % 360),
    ),
  ].sort((a, b) => a - b);
  // The largest empty arc is outside the view, including across the date line.
  let gap = -1;
  let start = longitudes[0];
  for (let index = 0; index < longitudes.length; index += 1) {
    const next =
      longitudes[(index + 1) % longitudes.length] +
      (index === longitudes.length - 1 ? 360 : 0);
    if (next - longitudes[index] > gap) {
      gap = next - longitudes[index];
      start = next % 360;
    }
  }
  const span = 360 - gap;
  let center = start + span / 2;
  if (center > 180) center -= 360;
  const halfWidth = Math.min(180, Math.max(0.9, span * 0.6));
  const south = Math.min(...coordinates.map((point) => point[1]));
  const north = Math.max(...coordinates.map((point) => point[1]));
  const halfHeight = Math.max(0.7, (north - south) * 0.6);
  const latitude = (south + north) / 2;
  const limit = subject === "korea" ? 85.0511287798 : 90;
  return [
    center - halfWidth,
    Math.max(-limit, latitude - halfHeight),
    center + halfWidth,
    Math.min(limit, latitude + halfHeight),
  ];
}

/** Fit a region on the visible hemisphere; a globe cannot show both sides. */
export function fitGlobeRegionCamera(
  coordinates: readonly [number, number][],
  width: number,
  height: number,
): GlobeView | null {
  const bounds = atlasRegionCameraBounds(coordinates, "world");
  if (!bounds) return null;
  const points: GeoPermissibleObjects = {
    type: "MultiPoint",
    coordinates: [...coordinates],
  };
  const center = geoCentroid(points);
  const candidates = [
    center,
    [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
  ];
  const views = candidates
    .filter((point) => point.every(Number.isFinite))
    .map((point) =>
      constrainGlobeView({
        longitude: point[0],
        latitude: point[1],
        roll: 0,
        zoom: 1,
      }),
    );
  views.sort(
    (a, b) =>
      coordinates.filter((point) => isGlobePointVisible(point, b)).length -
      coordinates.filter((point) => isGlobePointVisible(point, a)).length,
  );
  const view = views[0];
  const projection = geoOrthographic()
    .translate([0, 0])
    .scale(1)
    .rotate([-view.longitude, -view.latitude, 0]);
  const visible = coordinates.filter((point) =>
    isGlobePointVisible(point, view),
  );
  // Keep the full globe when a broad region necessarily spans its back side.
  if (visible.length !== coordinates.length) return view;
  const projected = visible.map((point) => projection(point)!);
  const horizontal = Math.max(
    0.01,
    ...projected.map((point) => Math.abs(point[0])),
  );
  const vertical = Math.max(
    0.01,
    ...projected.map((point) => Math.abs(point[1])),
  );
  const radius = Math.min(
    (width / 2 - 32) / horizontal,
    (height / 2 - 48) / vertical,
  );
  return constrainGlobeView({
    ...view,
    zoom: radius / (Math.min(width, height) * 0.44),
  });
}

/** A selected point stays above its popup, including on a 320px page. */
export function globeSelectionCenterY(width: number, height: number): number {
  // The narrow popup is raised above the compass. Center the selected point
  // between the toolbar and that popup, including room for its expanding halo.
  return width < 344 ? (height * 0.58 - 84) / 2 + 12 : height * 0.3;
}

/** Local projected north at the camera center, including orthographic roll. */
export function atlasProjectedNorthBearing(
  projection: GeoProjection,
  coordinates: [number, number],
): number {
  const origin = projection(coordinates);
  const north = projection([
    coordinates[0],
    Math.min(90, coordinates[1] + 0.01),
  ]);
  if (!origin || !north) return 0;
  const angle =
    (Math.atan2(north[0] - origin[0], origin[1] - north[1]) * 180) / Math.PI;
  return Number.isFinite(angle) ? angle : 0;
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

/** Reframe an offscreen selection without repeating an identical bounds update. */
export function reframeAtlasSelectionBounds(
  subject: AtlasSubject,
  coordinates: [number, number],
  bounds: AtlasUnit["bounds"],
  baseBounds: AtlasUnit["bounds"],
): AtlasUnit["bounds"] {
  const [longitude, latitude] = coordinates;
  if (!coordinates.every(Number.isFinite)) return bounds;
  const contains = (extent: AtlasUnit["bounds"]) =>
    longitude >= extent[0] &&
    longitude <= extent[2] &&
    latitude >= extent[1] &&
    latitude <= extent[3];
  if (contains(bounds)) return bounds;
  if (contains(baseBounds)) return baseBounds;
  const halfWidth = Math.min(
    20,
    Math.max(4, (baseBounds[2] - baseBounds[0]) / 2),
  );
  const halfHeight = Math.min(
    16,
    Math.max(4, (baseBounds[3] - baseBounds[1]) / 2),
  );
  // Natural Earth supports both poles. Mercator stays inside its finite,
  // square-map latitude range; the projection itself is not changed.
  const latitudeLimit =
    subject === "world" ? 90 : (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI;
  const next: AtlasUnit["bounds"] = [
    Math.max(-180, longitude - halfWidth),
    Math.max(-latitudeLimit, latitude - halfHeight),
    Math.min(180, longitude + halfWidth),
    Math.min(latitudeLimit, latitude + halfHeight),
  ];
  return next.every((value, index) => value === bounds[index]) ? bounds : next;
}

/** A narrow unit view must still contain the selected geographical context. */
export function includeAtlasContextBounds(
  bounds: AtlasUnit["bounds"],
  context: AtlasUnit["bounds"] | null,
): AtlasUnit["bounds"] {
  if (
    !context ||
    (bounds[0] <= context[0] &&
      bounds[1] <= context[1] &&
      bounds[2] >= context[2] &&
      bounds[3] >= context[3])
  )
    return bounds;
  return [
    Math.min(bounds[0], context[0]),
    Math.min(bounds[1], context[1]),
    Math.max(bounds[2], context[2]),
    Math.max(bounds[3], context[3]),
  ];
}

/** Fit the full selection into the map area that remains beside its card. */
export function fitAtlasSelection(
  projection: ReturnType<typeof createAtlasProjection>,
  selection: {
    coordinates: [number, number];
    contextBounds?: AtlasUnit["bounds"] | null;
    geometry?: GeoPermissibleObjects | null;
  },
  viewport: {
    width: number;
    height: number;
    mapHeight?: number;
    overlayRight?: number;
  },
): AtlasTransform {
  const { width, height, overlayRight = 0 } = viewport;
  const coordinates: [number, number][] = [selection.coordinates];
  if (selection.contextBounds) {
    const [west, south, east, north] = selection.contextBounds;
    // Natural Earth curves at the equator and between corners, so fit sampled
    // edges as well as the actual selected watercourse, not just four corners.
    for (let step = 0; step <= 20; step += 1) {
      const longitude = west + ((east - west) * step) / 20;
      const latitude = south + ((north - south) * step) / 20;
      coordinates.push(
        [longitude, south],
        [longitude, north],
        [west, latitude],
        [east, latitude],
      );
    }
  }
  const path = geoPath(projection);
  const context = path.bounds({ type: "MultiPoint", coordinates });
  const feature = selection.geometry
    ? path.bounds(selection.geometry)
    : context;
  const left = Math.min(context[0][0], feature[0][0]);
  const top = Math.min(context[0][1], feature[0][1]);
  const right = Math.max(context[1][0], feature[1][0]);
  const bottom = Math.max(context[1][1], feature[1][1]);
  if (![left, top, right, bottom].every(Number.isFinite)) return ATLAS_IDENTITY;

  const availableLeft = overlayRight + 24;
  const availableWidth = Math.max(1, width - availableLeft - 24);
  const availableHeight = Math.max(1, height - 48);
  const scale = Math.max(
    0.5,
    Math.min(
      ATLAS_MAX_ZOOM,
      (availableWidth * 0.85) / Math.max(1, right - left),
      (availableHeight * 0.85) / Math.max(1, bottom - top),
    ),
  );
  return constrainAtlasTransform(
    {
      scale,
      x: availableLeft + availableWidth / 2 - ((left + right) / 2) * scale,
      y: height / 2 - ((top + bottom) / 2) * scale,
    },
    width,
    viewport.mapHeight ?? height,
  );
}

export function constrainAtlasTransform(
  transform: AtlasTransform,
  width: number,
  height: number,
): AtlasTransform {
  const scale = Math.min(ATLAS_MAX_ZOOM, Math.max(0.5, transform.scale));
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
  const scale = Math.min(
    ATLAS_MAX_ZOOM,
    Math.max(0.5, transform.scale * factor),
  );
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
