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
assert.equal(sources.historical, undefined, "No historic boundary layer");
assert.match(sources.administrative.snapshotDate, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(sources.administrative.license, "ODbL 1.0");
assert.equal(
  sources.administrative.provinces.flatMap((p) => p.sourceRecords).length,
  29,
);
assert.equal(
  new Set(
    sources.administrative.provinces.flatMap((p) =>
      p.sourceRecords.map((r) => r.id),
    ),
  ).size,
  29,
  "Every current administrative division is assigned once",
);
assert(
  sources.administrative.provinces
    .find((p) => p.regionId === "jeolla")
    .sourceRecords.some(
      (r) => r.id === 21039457 && r.name === "전남광주통합특별시",
    ),
  "Include the current unified Jeonnam-Gwangju boundary",
);
for (const record of sources.administrative.provinces.flatMap(
  (p) => p.sourceRecords,
)) {
  assert(
    record.version > 0 && record.timestamp && record.sourceSha256.length === 64,
  );
}
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
const moduleCache = new Map();
const fixtureFetch = async (assetUrl) => {
  assert(/areas-(korea|world)\.json\?url$/.test(assetUrl));
  calls++;
  return {
    ok: true,
    json: async () =>
      assetUrl.endsWith("areas-korea.json?url")
        ? collection
        : JSON.parse(read("src/data/atlas/areas-world.json")),
  };
};
function loadModule(url, cache = moduleCache, fetchImpl = fixtureFetch) {
  if (cache.has(url.href)) return cache.get(url.href);
  const exports = {};
  cache.set(url.href, exports);
  vm.runInNewContext(
    ts.transpileModule(readFileSync(url, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require(name) {
        if (name === "d3-geo") return { geoBounds, geoContains };
        if (/areas-(korea|world)\.json\?url$/.test(name))
          return { default: name };
        assert(name.startsWith("."));
        return loadModule(new URL(`${name}.ts`, url), cache, fetchImpl);
      },
      fetch: fetchImpl,
    },
  );
  return exports;
}
const exports = loadModule(new URL("src/lib/historyAtlasAreas.ts", root));
const {
  findAtlasArea,
  findAtlasProvinceArea,
  isAtlasAreaPlace,
  loadAtlasAreaGeometry,
  matchesAtlasCurrentRegion,
} = exports;
const datasets = loadModule(new URL("src/data/historyAtlasContent.ts", root));
const reviewedPlaces = new Map([
  ...datasets.historyAtlasSourceDataset.places.map((place) => [
    place.id,
    place,
  ]),
  ...datasets.historyAtlasDataset.places.map((place) => [place.id, place]),
]);
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
    area.properties.locationNote.includes("현재") &&
      !area.properties.locationNote.includes("1910"),
    "Use current administrative boundaries",
  );
}
for (const [placeId, included, excluded] of [
  ["kr-6ff93702835e", "gyeongsang", "gangwon"], // 울진
  ["kr-24588d9f490f", "gyeongsang", "gangwon"], // 평해
  ["kr-70cb5c37802b", "chungcheong", "jeolla"], // 금산
  ["kr-f264380b68d2", "gangwon", "hamgyeong"], // 원산
  ["kr-43e23c90d08a", "gangwon", "hamgyeong"], // 안변
  ["kr-3a8cd7d46ccd", "gyeongsang", "gangwon"], // 독도
]) {
  const place = reviewedPlaces.get(placeId);
  assert(place?.coordinates, `Reviewed place missing: ${placeId}`);
  assert(
    geoContains(findAtlasProvinceArea(included, collection), place.coordinates),
    `Current boundary must include ${place.name} in ${included}`,
  );
  assert(
    !geoContains(
      findAtlasProvinceArea(excluded, collection),
      place.coordinates,
    ),
    `Do not restore the historic boundary for ${place.name}`,
  );
  assert(
    matchesAtlasCurrentRegion(place, "korea", included, "", collection),
    `Current filter excludes ${place.name}`,
  );
  assert(
    !matchesAtlasCurrentRegion(place, "korea", excluded, "", collection),
    `Historic filter retains ${place.name}`,
  );
}
const provinceFeatures = collection.features.filter(
  (feature) => feature.properties.regionId,
);
for (const [placeId, included, excluded] of [
  ["kr-a34472ffacdf", "jeolla", "gyeongsang"], // 명량: strait outside land polygons
  ["kr-f8f6a36df2ea", "gyeongsang", "jeolla"], // 노량: strait outside land polygons
]) {
  const place = reviewedPlaces.get(placeId);
  assert(place?.coordinates);
  assert(
    !provinceFeatures.some((feature) =>
      geoContains(feature, place.coordinates),
    ),
  );
  assert(
    matchesAtlasCurrentRegion(place, "korea", included, "", collection),
    `Coastal fallback lost ${place.name}`,
  );
  assert(!matchesAtlasCurrentRegion(place, "korea", excluded, "", collection));
}
const uljin = reviewedPlaces.get("kr-6ff93702835e");
for (const unavailable of [null, { type: "FeatureCollection", features: [] }]) {
  assert(
    matchesAtlasCurrentRegion(uljin, "korea", "gangwon", "", unavailable),
    "Unavailable boundaries retain the reviewed catalogue",
  );
  assert(
    !matchesAtlasCurrentRegion(uljin, "korea", "gyeongsang", "", unavailable),
  );
}
const namgyeong = reviewedPlaces.get("kr-c27023f3c34a");
assert(
  matchesAtlasCurrentRegion(namgyeong, "korea", "hamgyeong", "", collection),
);
assert(
  !matchesAtlasCurrentRegion(
    namgyeong,
    "korea",
    "outside-korea",
    "",
    collection,
  ),
  "A place inside a current province must not also be outside Korea",
);
const locatedUnclassified = reviewedPlaces.get("kr-d31d44135bdf"); // 경원선 source catalogue
assert(
  matchesAtlasCurrentRegion(
    locatedUnclassified,
    "korea",
    "gyeonggi",
    "",
    collection,
  ),
);
assert(
  !matchesAtlasCurrentRegion(
    locatedUnclassified,
    "korea",
    "unclassified",
    "",
    collection,
  ),
  "Known current geography takes precedence over an unclassified source entry",
);
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

// Switching from a flat map to the globe shares the successful subject loads.
const [combined, world, combinedAgain] = await Promise.all([
  loadAtlasAreaGeometry("all"),
  loadAtlasAreaGeometry("world"),
  loadAtlasAreaGeometry("all"),
]);
assert.equal(calls, 2, "Korea, world and globe share one fetch per subject");
assert.equal(combined, combinedAgain);
assert.equal(
  combined.features.length,
  collection.features.length + world.features.length,
);
assert.equal(
  new Set(combined.features.map((feature) => feature.properties.id)).size,
  combined.features.length,
  "Combined data must not repeat a region id",
);
const pacific = reviewedPlaces.get("world-4af3e3ae890b");
assert(pacific);
for (const longitude of [-180, 180]) {
  assert(
    matchesAtlasCurrentRegion(
      { ...pacific, coordinates: [longitude, 0] },
      "world",
      "water",
      "water-pacific",
      world,
    ),
    "Both longitude spellings of the Pacific date line belong to its range",
  );
}
for (const name of ["마카오", "티루스", "아카풀코", "리버풀"]) {
  const port = [...reviewedPlaces.values()].find(
    (p) => p.name === name && p.id.startsWith("world-"),
  );
  assert(port, name);
  assert(
    !matchesAtlasCurrentRegion(port, "world", "water", "", world),
    `${name}: shoreline resolution must not classify a port as a sea`,
  );
}

// A transient failure of one globe layer must not poison all future loads or
// refetch its already successful sibling layer.
const retryCalls = { korea: 0, world: 0 };
const retryAreas = loadModule(
  new URL("src/lib/historyAtlasAreas.ts", root),
  new Map(),
  async (assetUrl) => {
    const subject = assetUrl.endsWith("areas-korea.json?url")
      ? "korea"
      : "world";
    retryCalls[subject]++;
    return {
      ok: subject !== "world" || retryCalls.world > 1,
      json: async () => (subject === "korea" ? collection : world),
    };
  },
);
await assert.rejects(
  retryAreas.loadAtlasAreaGeometry("all"),
  /지역 범위를 불러오지 못했다/,
);
const [recovered, recoveredAgain] = await Promise.all([
  retryAreas.loadAtlasAreaGeometry("all"),
  retryAreas.loadAtlasAreaGeometry("all"),
]);
assert.equal(recovered, recoveredAgain);
assert.equal(recovered.features.length, combined.features.length);
assert.deepEqual(retryCalls, { korea: 1, world: 2 });
console.log(
  "History atlas areas: 8 source-backed provinces, Incheon, Ganghwa, Jeju and Hansando verified.",
);
await import("./verify-history-atlas-world-areas.mjs");
