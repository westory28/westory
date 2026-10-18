import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import { geoArea, geoContains, geoBounds } from "d3-geo";

const asset = readFileSync("src/data/atlas/terrain.json");
const terrain = JSON.parse(asset);
const splits = JSON.parse(
  readFileSync("src/data/atlas/traditional-region-splits.json", "utf8"),
);
const areas = JSON.parse(
  readFileSync("src/data/atlas/areas-korea.json", "utf8"),
);
const manifest = JSON.parse(
  readFileSync("src/data/atlas/terrain.sources.json", "utf8"),
);
for (const [name, hash] of Object.entries(manifest.assets))
  assert.equal(
    createHash("sha256")
      .update(readFileSync(`src/data/atlas/${name}`))
      .digest("hex"),
    hash,
    `${name}: reviewed generation checksum`,
  );
assert.equal(
  createHash("sha256")
    .update(readFileSync("src/data/atlas/areas-korea.json"))
    .digest("hex"),
  manifest.traditionalRegions.parentAssetSha256,
);
assert(asset.length < 700_000, "Keep terrain's raw payload within 700 KB");
assert(
  gzipSync(asset).length < 200_000,
  "Keep terrain's compressed payload within 200 KB",
);
const count = (coordinates) =>
  typeof coordinates[0] === "number"
    ? 1
    : coordinates.reduce((sum, next) => sum + count(next), 0);
const vertices = terrain.features.reduce(
  (sum, f) => sum + count(f.geometry.coordinates),
  0,
);
assert(
  vertices < 25_000,
  "Bound globe's per-frame physical-layer projection work",
);
assert(
  new Set(terrain.features.map((f) => f.properties.id)).size ===
    terrain.features.length,
);
const kinds = new Set(terrain.features.map((f) => f.properties.kind));
for (const kind of ["mountain", "plateau", "desert", "plain", "basin"])
  assert(kinds.has(kind));
for (const f of [...terrain.features, ...splits.features]) {
  assert(
    geoArea(f) > 0 && geoArea(f) < Math.PI * 2,
    `${f.properties.id}: D3 spherical winding`,
  );
  assert(
    geoContains(f, f.properties.coordinates),
    `${f.properties.id}: label inside its range`,
  );
  assert(f.properties.source && f.properties.sourceUrl.startsWith("https://"));
  assert(
    f.properties.locationNote,
    `${f.properties.id}: provenance/limits available`,
  );
  assert(
    count(f.geometry.coordinates) > 4,
    `${f.properties.id}: never substitute a bounding rectangle`,
  );
}
const byName = (name) =>
  terrain.features.find((f) => f.properties.name === name);
for (const [name, point] of [
  ["태백산맥", [128.4656, 38.1194]], // Seoraksan
  ["태백산맥", [128.915, 37.095]], // Taebaeksan
  ["소백산맥", [127.7306, 35.3372]], // Jirisan
  ["소백산맥", [127.9, 36.5333]], // Songnisan
  ["개마고원", [127.4, 40.8]],
])
  assert(
    geoContains(byName(name), point),
    `${name}: independent named-landmark check`,
  );
assert(
  !geoContains(byName("태백산맥"), [126.978, 37.5665]),
  "Taebaek must not cover Seoul",
);
assert(
  !geoContains(byName("개마고원"), [127.535, 39.918]),
  "Gaema highland must not paint Hamhung coastal lowland",
);
assert(geoArea(byName("개마고원")) * 6371 ** 2 > 10_000);
assert(geoArea(byName("개마고원")) * 6371 ** 2 < 45_000);
assert.match(
  byName("개마고원").properties.locationNote,
  /1,000m.*확정 경계를 뜻하지/u,
);
assert.equal(manifest.gmba.license, "CC BY 4.0");
assert(manifest.gmba.datasetUrl && manifest.gmba.publicationUrl);
assert.equal(manifest.gaemaElevation.sources.length, 9);

function loadModule(path, require, fetch) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { exports, require, fetch, WeakMap, Number, Map, Set },
  );
  return exports;
}
const traditional = loadModule(
  "src/lib/historyAtlasTraditionalRegions.ts",
  (name) => {
    assert(name.endsWith("traditional-region-splits.json"));
    return { default: splits };
  },
);
const collection = traditional.atlasKoreanTraditionalRegions(areas);
assert.equal(collection.features.length, 9);
assert.strictEqual(
  collection,
  traditional.atlasKoreanTraditionalRegions(areas),
  "Stable collection identity prevents camera/effect loops",
);
const get = (id) => traditional.getAtlasKoreanTraditionalRegion(id, areas);
for (const id of [
  "gwanbuk",
  "gwanseo",
  "haeseo",
  "gyeonggi",
  "gwandong",
  "hoseo",
  "honam",
  "yeongnam",
  "jeju",
  "giho",
]) {
  assert(get(id));
  assert.strictEqual(get(id), get(id), `${id}: stable selection identity`);
}
for (const [id, point] of [
  ["gwanseo", [125.75, 39.03]],
  ["gwanbuk", [129.72, 41.79]],
  ["haeseo", [125.72, 38.04]],
  ["gwandong", [128.9, 37.75]],
  ["hoseo", [127.43, 36.64]],
  ["honam", [127.15, 35.82]],
  ["yeongnam", [128.6, 35.87]],
  ["jeju", [126.53, 33.5]],
  ["giho", [126.978, 37.5665]],
  ["giho", [127.43, 36.64]],
])
  assert(geoContains(get(id), point), `${id}: actual place membership`);
assert(
  !geoContains(get("honam"), [126.53, 33.5]),
  "Jeju is a separate overlay",
);
assert(
  !geoContains(get("giho"), [126.55, 37.97]),
  "Modern Giho definition excludes Kaesong",
);
assert(
  !collection.features.some((f) => f.properties.regionId === "giho"),
  "Overlapping Giho is explicit-only",
);
// Source sample grid: default traditional labels must never assign a point to
// two regions, while Giho's intentional inclusion of Hoseo remains explicit.
for (let lat = 33.1; lat < 43; lat += 0.12) {
  for (let lon = 124.1; lon < 131; lon += 0.12) {
    const hits = collection.features.filter((f) => geoContains(f, [lon, lat]));
    assert(hits.length <= 1, `Traditional regions overlap at ${lon},${lat}`);
  }
}

let requests = 0;
const loader = loadModule(
  "src/lib/historyAtlasTerrain.ts",
  () => ({ default: "terrain.json" }),
  async () => {
    requests += 1;
    return { ok: requests > 1, json: async () => terrain };
  },
);
await assert.rejects(
  loader.loadAtlasTerrainGeometry(),
  /지형을 불러오지 못했습니다/u,
);
const retried = loader.loadAtlasTerrainGeometry();
assert.strictEqual(
  retried,
  loader.loadAtlasTerrainGeometry(),
  "Share pending source fetch",
);
assert.strictEqual(await retried, terrain);
assert.equal(
  requests,
  2,
  "Failed geometry loads can retry and successful loads are cached",
);
console.log(
  `Terrain verified: ${terrain.features.length} features, ${vertices} vertices, ${gzipSync(asset).length} gzip bytes; 9 non-overlapping traditional regions + explicit Giho.`,
);
