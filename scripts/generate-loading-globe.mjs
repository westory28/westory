// Small local silhouette from the public globe's Natural Earth land (public domain).
import fs from "node:fs/promises";
import { geoArea } from "d3-geo";

function simplify(points, tolerance = 0.7) {
  if (points.length <= 2) return points;
  const first = points[0],
    last = points.at(-1);
  const dx = last[0] - first[0],
    dy = last[1] - first[1];
  let furthest = 0,
    distance = tolerance * tolerance;
  for (let i = 1; i < points.length - 1; i++) {
    const t = Math.max(
      0,
      Math.min(
        1,
        ((points[i][0] - first[0]) * dx + (points[i][1] - first[1]) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    const square =
      (points[i][0] - first[0] - t * dx) ** 2 +
      (points[i][1] - first[1] - t * dy) ** 2;
    if (square > distance) {
      distance = square;
      furthest = i;
    }
  }
  return furthest
    ? [
        ...simplify(points.slice(0, furthest + 1), tolerance).slice(0, -1),
        ...simplify(points.slice(furthest), tolerance),
      ]
    : [first, last];
}

const source = JSON.parse(
  await fs.readFile(
    new URL("../src/data/atlas/land-globe.json", import.meta.url),
    "utf8",
  ),
);
const land = {
  type: "MultiPolygon",
  coordinates: source.coordinates
    .filter((coordinates) => geoArea({ type: "Polygon", coordinates }) > 0.0004)
    .map(([ring]) => [
      simplify(ring).map((point) =>
        point.map((value) => Math.round(value * 100) / 100),
      ),
    ])
    .filter(([ring]) => ring.length >= 4),
};
const output = JSON.stringify(land) + "\n";
await fs.writeFile(
  new URL("../src/data/loadingGlobeLand.json", import.meta.url),
  output,
);
console.log(
  `Loading globe: ${land.coordinates.length} polygons, ${output.length} bytes`,
);
