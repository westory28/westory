import type { GeoPermissibleObjects } from "d3-geo";
import type { GeoJSON, Position } from "geojson";

const lineCache = new WeakMap<object, Map<number, GeoPermissibleObjects>>();

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

/** Temporary line detail stays below half a CSS pixel at the current scale.
 * Terrain may opt into the same detail limit. Administrative areas and hit
 * testing always retain their exact source geometry.
 */
export function globeInteractionGeometry<T extends GeoPermissibleObjects>(
  shape: T,
  scale: number,
  terrain = false,
): T {
  const bucket = 2 ** Math.ceil(Math.log2(Math.max(1, scale)));
  const cacheKey = bucket * 2 + Number(terrain);
  let levels = lineCache.get(shape);
  if (!levels) {
    levels = new Map();
    lineCache.set(shape, levels);
  }
  const cached = levels.get(cacheKey);
  if (cached) return cached as T;
  const tolerance = (0.35 * 180) / (Math.PI * bucket);
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
