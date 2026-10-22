import type { GeoPermissibleObjects, GeoProjection } from "d3-geo";
import type { GeoJSON, MultiPolygon, Position } from "geojson";
import type { GlobeView } from "./historyGlobeMath";

const lineCache = new WeakMap<object, Map<string, GeoPermissibleObjects>>();
type TerrainCap = {
  coordinates: [number, number];
  center: [number, number, number];
  radius: number;
};
const terrainCaps = new WeakMap<object, TerrainCap | null>();
const radians = Math.PI / 180;

function terrainCap(
  polygon: Position[][],
  identity: object = polygon,
): TerrainCap | null {
  if (terrainCaps.has(identity)) return terrainCaps.get(identity)!;
  const vertices = polygon.flatMap((ring) =>
    ring.map(([longitude, latitude]) => {
      const latitudeCosine = Math.cos(latitude * radians);
      return [
        latitudeCosine * Math.cos(longitude * radians),
        latitudeCosine * Math.sin(longitude * radians),
        Math.sin(latitude * radians),
      ];
    }),
  );
  const sum = vertices.reduce(
    (total, point) => total.map((value, index) => value + point[index]),
    [0, 0, 0],
  );
  const length = Math.hypot(...sum);
  if (length < 1e-8) {
    terrainCaps.set(identity, null);
    return null;
  }
  const center = sum.map((value) => value / length) as [number, number, number];
  const radius = Math.acos(
    Math.max(
      -1,
      Math.min(
        1,
        ...vertices.map((point) =>
          point.reduce((dot, value, index) => dot + value * center[index], 0),
        ),
      ),
    ),
  );
  // A cap smaller than a hemisphere is geodesically convex: the complete
  // polygon, including edges between vertices, lies inside this bound.
  const cap: TerrainCap | null =
    radius < Math.PI / 2
      ? {
          coordinates: [
            Math.atan2(center[1], center[0]) / radians,
            Math.asin(center[2]) / radians,
          ],
          center,
          radius,
        }
      : null;
  terrainCaps.set(identity, cap);
  return cap;
}

function visibleCapFilter(
  projection: GeoProjection,
  camera: GlobeView,
  width: number,
  height: number,
) {
  const latitudeCosine = Math.cos(camera.latitude * radians);
  const facing = [
    latitudeCosine * Math.cos(camera.longitude * radians),
    latitudeCosine * Math.sin(camera.longitude * radians),
    Math.sin(camera.latitude * radians),
  ];
  return (cap: TerrainCap | null) => {
    if (!cap) return true;
    const dot = cap.center.reduce(
      (total, value, index) => total + value * facing[index],
      0,
    );
    if (dot < -Math.sin(cap.radius) - 1e-8) return false;
    const point = projection(cap.coordinates);
    if (!point) return true;
    // Orthographic projection cannot enlarge a three-dimensional chord.
    const radius = projection.scale() * 2 * Math.sin(cap.radius / 2) + 8;
    return (
      point[0] + radius >= 0 &&
      point[1] + radius >= 0 &&
      point[0] - radius <= width &&
      point[1] - radius <= height
    );
  };
}

/** Reject whole offscreen physical regions before D3 projects their vertices.
 * Bounds are deliberately conservative and never apply to selection/hit paths.
 */
export function globeVisibleTerrain(
  geometry: MultiPolygon,
  projection: GeoProjection,
  camera: GlobeView,
  width: number,
  height: number,
): MultiPolygon {
  const visible = visibleCapFilter(projection, camera, width, height);
  const coordinates = geometry.coordinates.filter((polygon) =>
    visible(terrainCap(polygon)),
  );
  return coordinates.length === geometry.coordinates.length
    ? geometry
    : { ...geometry, coordinates };
}

/** Discard whole invisible line segments; exact selected/hit paths are separate. */
export function globeVisibleLines<T extends GeoPermissibleObjects>(
  shape: T,
  projection: GeoProjection,
  camera: GlobeView,
  width: number,
  height: number,
): T {
  const visible = visibleCapFilter(projection, camera, width, height);
  const lineVisible = (line: Position[]) => visible(terrainCap([line], line));
  type Shape = GeoJSON | { type: "Sphere" };
  const filter = (value: Shape): Shape => {
    if (value.type === "LineString")
      return lineVisible(value.coordinates)
        ? value
        : { ...value, coordinates: [] };
    if (value.type === "MultiLineString")
      return { ...value, coordinates: value.coordinates.filter(lineVisible) };
    if (value.type === "Feature")
      return {
        ...value,
        geometry: value.geometry ? filter(value.geometry) : null,
      } as Shape;
    if (value.type === "FeatureCollection")
      return {
        ...value,
        features: value.features.map((feature) => filter(feature)),
      } as Shape;
    if (value.type === "GeometryCollection")
      return {
        ...value,
        geometries: value.geometries.map((geometry) => filter(geometry)),
      } as Shape;
    return value;
  };
  return filter(shape as Shape) as T;
}

function simplifyLine(points: Position[], tolerance: number): Position[] {
  if (points.length <= 2) return points;
  const kept = new Uint8Array(points.length);
  kept[0] = kept[points.length - 1] = 1;
  const pending = [[0, points.length - 1]];
  const limit = tolerance * tolerance;
  while (pending.length) {
    const [first, last] = pending.pop()!;
    const [ax, ay] = points[first],
      [bx, by] = points[last];
    // Do not simplify across the antimeridian: preserve the source seam.
    if (Math.abs(bx - ax) > 180) {
      for (let index = first; index <= last; index += 1) kept[index] = 1;
      continue;
    }
    const dx = bx - ax,
      dy = by - ay;
    const length = dx * dx + dy * dy;
    let furthest = -1,
      greatest = limit;
    for (let index = first + 1; index < last; index += 1) {
      const [x, y] = points[index];
      const ratio = length
        ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length))
        : 0;
      const distance = (x - ax - ratio * dx) ** 2 + (y - ay - ratio * dy) ** 2;
      if (distance > greatest) {
        greatest = distance;
        furthest = index;
      }
    }
    if (furthest >= 0) {
      kept[furthest] = 1;
      pending.push([first, furthest], [furthest, last]);
    }
  }
  return points.filter((_, index) => kept[index]);
}

/** Base layer detail defaults to below half a CSS pixel at the current scale.
 * The non-WebGL moving fallback can request a one-pixel limit.
 * Physical terrain and the moving coastline may opt into polygon detail.
 * Selected administrative areas and hit testing keep their exact source geometry.
 */
export function globeInteractionGeometry<T extends GeoPermissibleObjects>(
  shape: T,
  scale: number,
  terrain = false,
  pixelError = 0.35,
): T {
  const bucket = 2 ** Math.ceil(Math.log2(Math.max(1, scale)));
  const cacheKey = `${bucket}:${Number(terrain)}:${pixelError}`;
  let levels = lineCache.get(shape);
  if (!levels) {
    levels = new Map();
    lineCache.set(shape, levels);
  }
  const cached = levels.get(cacheKey);
  if (cached) return cached as T;
  const tolerance = (pixelError * 180) / (Math.PI * bucket);
  const ring = (points: Position[]) => {
    const reduced = simplifyLine(points, tolerance);
    return reduced.length >= 4 ? reduced : points;
  };
  type Shape = GeoJSON | { type: "Sphere" };
  const simplify = (value: Shape): Shape => {
    if (value.type === "LineString")
      return {
        ...value,
        coordinates: simplifyLine(value.coordinates, tolerance),
      };
    if (value.type === "MultiLineString")
      return {
        ...value,
        coordinates: value.coordinates.map((line) =>
          simplifyLine(line, tolerance),
        ),
      };
    if (terrain && value.type === "Polygon")
      return { ...value, coordinates: value.coordinates.map(ring) };
    if (terrain && value.type === "MultiPolygon")
      return {
        ...value,
        coordinates: value.coordinates.map((polygon) => polygon.map(ring)),
      };
    if (value.type === "Feature")
      return {
        ...value,
        geometry: value.geometry ? simplify(value.geometry) : null,
      } as Shape;
    if (value.type === "FeatureCollection")
      return {
        ...value,
        features: value.features.map((feature) => simplify(feature)),
      } as Shape;
    if (value.type === "GeometryCollection")
      return {
        ...value,
        geometries: value.geometries.map((geometry) => simplify(geometry)),
      } as Shape;
    return value;
  };
  const result = simplify(shape as Shape);
  levels.set(cacheKey, result);
  return result as T;
}
