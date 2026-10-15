import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { geoArea, geoBounds, geoContains } from "d3-geo";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const payload = read("src/data/atlas/areas-korea.json");
const collection = JSON.parse(payload);
const sources = JSON.parse(read("src/data/atlas/areas-korea.sources.json"));
assert.equal(
  createHash("sha256").update(payload).digest("hex"),
  sources.assetSha256,
);
assert.equal(sources.historical.boundaryDate, "1910-05-10");
assert.equal(
  sources.historical.provinces.flatMap((p) => p.sourceRecords).length,
  14,
);
assert.equal(collection.features.length, 12);
assert.equal(new Set(collection.features.map((f) => f.properties.id)).size, 12);

for (const feature of collection.features) {
  const { id, coordinates, source, sourceUrl, locationNote } =
    feature.properties;
  assert(source && sourceUrl && locationNote, `Missing area evidence: ${id}`);
  assert(geoContains(feature, coordinates), `Label anchor outside area: ${id}`);
  assert(
    geoArea(feature) > 0 && geoArea(feature) < 0.04,
    `Inverted area: ${id}`,
  );
  const bounds = geoBounds(feature);
  assert(bounds[0][0] > 123 && bounds[1][0] < 132, `Longitude: ${id}`);
  assert(bounds[0][1] > 32 && bounds[1][1] < 44, `Latitude: ${id}`);
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  for (const polygon of polygons)
    for (const ring of polygon) {
      assert(ring.length >= 4, `Incomplete ring: ${id}`);
      assert.deepEqual(ring[0], ring.at(-1), `Open ring: ${id}`);
      assert(
        ring.every(
          (point) => point.length === 2 && point.every(Number.isFinite),
        ),
        id,
      );
    }
}

let calls = 0;
const exports = {};
vm.runInNewContext(
  ts.transpileModule(read("src/lib/historyAtlasAreas.ts"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  {
    exports,
    require(name) {
      assert(name.endsWith("areas-korea.json?url"));
      return { default: name };
    },
    fetch: async () => {
      calls++;
      return { ok: true, json: async () => collection };
    },
  },
);
const {
  findAtlasArea,
  findAtlasProvinceArea,
  isAtlasAreaPlace,
  loadAtlasAreaGeometry,
} = exports;
const [first, second] = await Promise.all([
  loadAtlasAreaGeometry(),
  loadAtlasAreaGeometry(),
]);
assert.equal(calls, 1, "Area fetch is cached across selections and portals");
assert.equal(first, second);
for (const [regionId, point] of [
  ["gyeonggi", [126.978, 37.566]],
  ["gangwon", [127.73, 37.88]],
  ["chungcheong", [127.12, 36.45]],
  ["jeolla", [127.15, 35.82]],
  ["gyeongsang", [128.6, 35.87]],
  ["hwanghae", [125.72, 38.03]],
  ["pyeongan", [125.75, 39.02]],
  ["hamgyeong", [127.54, 39.92]],
]) {
  const area = findAtlasProvinceArea(regionId, collection);
  assert(area, `Missing province: ${regionId}`);
  assert(
    geoContains(area, point),
    `Province lost its reference city: ${regionId}`,
  );
  assert(
    area.properties.locationNote.includes("1910년"),
    "Do not represent the reference layer as timeless boundaries",
  );
}
assert.equal(findAtlasProvinceArea("outside-korea", collection), null);
assert.equal(findAtlasProvinceArea("unclassified", collection), null);
assert.equal(findAtlasArea({ id: "seoul" }, collection), null);
assert(!isAtlasAreaPlace({ id: "seoul" }));
for (const feature of collection.features.filter((f) => f.properties.placeId))
  assert(isAtlasAreaPlace({ id: feature.properties.placeId }));
const landPayload = read("src/data/atlas/land-korea.json");
const land = JSON.parse(landPayload);
assert.equal(
  createHash("sha256").update(landPayload).digest("hex"),
  sources.land.sourceSha256,
);
assert.equal(sources.land.islands.length, 3);
for (const island of sources.land.islands) {
  const area = findAtlasArea({ id: island.placeId }, collection);
  assert(area, `Missing reviewed island: ${island.placeId}`);
  assert.equal(area.geometry.coordinates.length, 1, "Main island only");
  assert(geoContains(area, island.interiorPoint));
  const original = {
    type: "Polygon",
    coordinates: land.coordinates[island.sourcePolygonIndex],
  };
  assert(geoContains(original, island.interiorPoint));
  assert(
    Math.abs(geoArea(area) - geoArea(original)) < 1e-12,
    `Island extent changed from the base coastline: ${island.placeId}`,
  );
  const vertices = (polygon) =>
    polygon
      .flatMap((ring) => ring.slice(0, -1))
      .map((point) => point.join(","))
      .sort();
  assert.deepEqual(
    vertices(area.geometry.coordinates[0]),
    vertices(original.coordinates),
  );
}
assert(
  !geoContains(findAtlasArea({ id: "jeju" }, collection), [126.53, 34.2]),
  "Jeju must not include the Korean mainland",
);
assert(
  !geoContains(findAtlasArea({ id: "hansando" }, collection), [128.52, 34.8]),
  "Hansando must not include nearby islands or battle waters",
);
const ganghwa = findAtlasArea({ id: "ganghwa" }, collection);
const incheon = findAtlasArea({ id: "incheon" }, collection);
assert(geoContains(ganghwa, [126.49, 37.75]));
assert(
  !geoContains(ganghwa, [126.33, 37.7]),
  "Ganghwa must not include Seokmodo",
);
assert(
  !geoContains(ganghwa, [126.57, 37.73]),
  "Ganghwa must not include the mainland",
);
assert(geoContains(incheon, [126.65, 37.47]));
assert(
  geoContains(incheon, [126.49, 37.75]),
  "Modern Incheon includes Ganghwa",
);
assert(
  !geoContains(incheon, [126.978, 37.566]),
  "Incheon must not include Seoul",
);
assert.equal(sources.incheon.license, "ODbL 1.0");
console.log(
  "History atlas areas: 8 source-backed provinces, Incheon, Ganghwa, Jeju and Hansando verified.",
);
