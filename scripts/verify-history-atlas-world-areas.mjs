import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
import ts from "typescript";
import {
  geoArea,
  geoBounds,
  geoContains,
  geoNaturalEarth1,
  geoOrthographic,
  geoPath,
} from "d3-geo";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const payload = read("src/data/atlas/areas-world.json");
const collection = JSON.parse(payload);
const sources = JSON.parse(read("src/data/atlas/areas-world.sources.json"));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const textDigest = (value) => digest(value.replace(/\r\n/g, "\n"));
assert.equal(
  digest(payload),
  sources.assetSha256,
  "World-area asset matches its source manifest",
);
assert.equal(
  textDigest(read(sources.m49.snapshot)),
  sources.m49.sha256,
  "UN M49 grouping snapshot is unchanged",
);
assert.equal(
  textDigest(read(sources.m49.snapshot).replace(/\r?\n/g, "\r\n")),
  sources.m49.sha256,
  "Windows and Linux checkouts must verify the same M49 content",
);
assert.equal(
  sources.naturalEarthRevision,
  "ca96624a56bd078437bca8184e78163e5039ad19",
);
assert.equal(sources.sources.length, 4);
assert(
  sources.sources.every(
    (source) =>
      source.license === "Public domain" &&
      /^[a-f0-9]{64}$/.test(source.sha256) &&
      source.url.includes(sources.naturalEarthRevision),
  ),
);
assert(
  gzipSync(payload).length < 1_250_000,
  "Lazy world-area transfer exceeds the reviewed payload budget",
);

// Read the actual filter declaration without executing the region membership
// module or duplicating its list in this test.
const source = read("src/lib/historyAtlasRegions.ts");
const ast = ts.createSourceFile(
  "historyAtlasRegions.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
let groupsExpression;
const visit = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(ast) === "ATLAS_WORLD_REGION_GROUPS"
  )
    groupsExpression = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
};
visit(ast);
assert(groupsExpression);
const groups = vm.runInNewContext(groupsExpression);
const expected = groups
  .flatMap((group) => [group.id, ...group.children.map((child) => child.id)])
  .filter((id) => id !== "unclassified");
const byRegion = new Map(
  collection.features.map((feature) => [feature.properties.regionId, feature]),
);
assert.equal(collection.type, "FeatureCollection");
assert.equal(collection.features.length, 43);
assert.equal(
  byRegion.size,
  collection.features.length,
  "Every region has exactly one geometry",
);
assert.deepEqual(
  [...byRegion.keys()].sort(),
  Array.from(expected).sort(),
  "Every located world filter has an actual area",
);
assert(
  !byRegion.has("unclassified"),
  "Unclassified places must not acquire a fabricated extent",
);
assert.deepEqual(
  sources.features.map((feature) => feature.regionId).sort(),
  [...byRegion.keys()].sort(),
);

let projectionCases = 0;
for (const feature of collection.features) {
  const { id, regionId, name, coordinates, source, sourceUrl, locationNote } =
    feature.properties;
  assert(
    id && name && source && sourceUrl && locationNote,
    `${regionId}: evidence and label are required`,
  );
  assert(
    ["Polygon", "MultiPolygon"].includes(feature.geometry.type),
    `${regionId}: no bounding-box or point substitute`,
  );
  assert(
    geoContains(feature, coordinates),
    `${regionId}: label must lie inside the actual shape`,
  );
  const area = geoArea(feature);
  assert(
    area > 0.0001 && area < 4 * Math.PI,
    `${regionId}: finite correctly wound spherical area`,
  );
  if (!regionId.startsWith("water"))
    assert(
      area < 1.5,
      `${regionId}: a land region must not invert across the globe`,
    );
  const bounds = geoBounds(feature);
  assert(
    bounds.flat().every(Number.isFinite),
    `${regionId}: bounds remain finite at poles and date line`,
  );
  assert(
    bounds[0][1] >= -90 && bounds[1][1] <= 90 && bounds[0][1] <= bounds[1][1],
  );
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  for (const polygon of polygons)
    for (const ring of polygon) {
      assert(ring.length >= 4, `${regionId}: complete polygon ring`);
      assert.deepEqual(
        ring[0],
        ring.at(-1),
        `${regionId}: closed polygon ring`,
      );
      assert(
        ring.every(
          (point) =>
            point.length === 2 &&
            point.every(Number.isFinite) &&
            Math.abs(point[0]) <= 180 &&
            Math.abs(point[1]) <= 90,
        ),
      );
    }
  for (const projection of [
    geoNaturalEarth1().translate([320, 240]).scale(100),
    geoOrthographic()
      .translate([320, 240])
      .scale(200)
      .rotate([-coordinates[0], -coordinates[1], 0])
      .clipAngle(90),
    geoOrthographic()
      .translate([320, 240])
      .scale(200)
      .rotate([-179, -35, 0])
      .clipAngle(90),
  ]) {
    const path = geoPath(projection)(feature);
    assert(
      path === null || !/NaN|Infinity/.test(path),
      `${regionId}: flat/globe projection must not become invalid`,
    );
    projectionCases++;
  }
}

// Independently chosen physical locations catch mainland inversion, overseas
// sovereignty leaking into continental groups, and whole-country shortcuts.
const containsCases = [
  ["europe-west", [2.35, 48.85], true],
  ["europe-west", [-53, 4], false],
  ["europe-east", [37.6, 55.7], true],
  ["europe-east", [82.92, 55.03], false],
  ["europe-south", [12.5, 41.9], true],
  ["europe-south", [28.95, 41.05], true],
  ["europe-south", [32.85, 39.92], false],
  ["europe-north", [-0.1, 51.5], true],
  ["europe-north", [2.35, 48.85], false],
  ["asia-west", [32.85, 39.92], true],
  ["asia-west", [28.95, 41.05], false],
  ["asia-south", [77.2, 28.6], true],
  ["asia-south", [51.4, 35.7], true],
  ["asia-east", [116.4, 39.9], true],
  ["asia-east", [127, 37], true],
  ["asia-southeast", [105.85, 21.03], true],
  ["asia-southeast", [140, -5], false],
  ["asia-central", [69.2, 41.3], true],
  ["asia-central", [37.6, 55.7], false],
  ["asia-north", [82.92, 55.03], true],
  ["asia-north", [131.8855, 43.1155], true],
  ["asia-north", [37.6, 55.7], false],
  ["africa-north", [31.2, 30], true],
  ["africa-south", [28.2, -25.7], true],
  ["africa-east", [36.82, -1.29], true],
  ["africa-west", [-1.62, 6.69], true],
  ["africa-central", [23, -2], true],
  ["middle-east", [51.4, 35.7], true],
  ["middle-east", [31.2, 30], true],
  ["middle-east", [69.2, 34.5], false],
  ["america-north", [-75.7, 45.4], true],
  ["america-north", [-42, 72], true],
  ["america-north", [-155.6, 19.6], false],
  ["america-south", [-53, 4], true],
  ["america-south", [2.35, 48.85], false],
  ["america-central", [-99, 19], true],
  ["america-central", [-80, 8.5], true],
  ["america-caribbean", [-79.5, 22], true],
  ["america-caribbean", [-95, 30], false],
  ["oceania-australia", [149, -35], true],
  ["oceania-australia", [175, -39], true],
  ["oceania-pacific", [-155.6, 19.6], true],
  ["oceania-pacific", [140, -5], true],
  ["oceania-pacific", [149, -35], false],
  ["antarctica", [0, -85], true],
  ["antarctica", [0, 60], false],
  ["arctic", [0, 89.999], true],
  ["arctic", [0, 60], false],
  ["greenland", [-42, 72], true],
  ["greenland", [-100, 70], false],
  ["water-pacific", [170, 0], true],
  ["water-pacific", [-179.99, 0], true],
  ["water-pacific", [179.99, 0], true],
  ["water-atlantic", [-30, 10], true],
  ["water-indian", [70, -20], true],
  ["water-southern", [50, -65], true],
  ["water-southern", [50, -50], false],
  ["water-arctic", [0, 85], true],
  ["water-arctic", [-42, 72], false],
  ["water-mediterranean", [18, 35], true],
  ["water-mediterranean", [13, 42], false],
  ["water-black", [35, 43], true],
  ["water-red", [38, 20], true],
  ["water-baltic", [20, 58], true],
  ["water-caribbean", [-75, 16], true],
  ["water-caribbean", [-79.5, 22], false],
  ["water-east-asia", [132, 39], true],
  ["water-east-asia", [127, 37], false],
  ["water-other", [139, -14], true],
  ["water-other", [170, 0], false],
  ["water", [0, 0], true],
  ["water", [127, 37], false],
  ["water", [50, 40], false],
];
for (const [regionId, coordinates, expected] of containsCases)
  assert.equal(
    geoContains(byRegion.get(regionId), coordinates),
    expected,
    `${regionId}: physical membership ${coordinates}`,
  );

for (const parent of groups.filter((group) => group.children.length))
  for (const child of parent.children) {
    assert(
      geoContains(
        byRegion.get(parent.id),
        byRegion.get(child.id).properties.coordinates,
      ),
      `${parent.id}: includes child region ${child.id}`,
    );
  }
assert(
  geoBounds(byRegion.get("asia"))[0][0] > geoBounds(byRegion.get("asia"))[1][0],
  "Asian geometry keeps the date-line wrap",
);
assert(
  geoBounds(byRegion.get("arctic"))[0][1] > 66 &&
    geoBounds(byRegion.get("arctic"))[1][1] === 90,
  "Arctic cap bounds must not invert to the southern hemisphere",
);
assert(
  geoBounds(byRegion.get("antarctica"))[0][1] === -90 &&
    geoBounds(byRegion.get("antarctica"))[1][1] < -60,
  "Antarctic bounds retain the southern pole",
);
assert(
  geoArea(byRegion.get("water")) > 8 && geoArea(byRegion.get("water")) < 10,
  "The combined marine layer covers oceans, not their land complement",
);
assert(
  sources.transcontinentalClips.every((clip) => clip.coveredFraction > 0.995),
  "Source-scale coastline differences cannot omit substantial transcontinental land",
);
assert.equal(sources.middleEastIso3.length, 17);
console.log(
  `World area checks passed: ${collection.features.length} source-backed filters, ${containsCases.length} independent physical memberships, ${projectionCases} flat/globe projections, overseas and transcontinental separation, polar/date-line bounds, marine/inland separation, provenance and transfer budget.`,
);
