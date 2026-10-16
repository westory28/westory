import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import * as geo from "d3-geo";

const bytes = readFileSync("src/data/atlas/countries-world.json");
const geometry = JSON.parse(bytes);
assert(bytes.length < 5.5 * 1024 * 1024, "Bound the downloaded country layer");
assert(
  gzipSync(bytes).length < 2 * 1024 * 1024,
  "Bound compressed loading cost",
);
const manifest = JSON.parse(
  readFileSync("src/data/atlas/countries-world.sources.json", "utf8"),
);
assert.equal(
  createHash("sha256").update(bytes).digest("hex"),
  manifest.assetSha256,
  "Generated country asset must match its reviewed source manifest",
);
assert.equal(manifest.source, "World Bank Official Boundaries");
assert.equal(manifest.license, "CC BY 4.0");
assert.equal(manifest.countryCount, geometry.countries.features.length);
assert.equal(manifest.sourceCountryCount - 1, manifest.countryCount);
assert.equal(geometry.borders.type, "MultiLineString");
assert.equal(geometry.disputedBorders.type, "MultiLineString");
assert(geometry.borders.coordinates.length > 300);
assert(geometry.disputedBorders.coordinates.length > 20);
for (const source of Object.values(manifest.sources)) {
  assert.match(source.sha256, /^[a-f0-9]{64}$/u);
  assert(source.url.startsWith("https://"));
}

const collection = geometry.countries;
const countries = new Map(
  collection.features.map((feature) => [feature.properties.id, feature]),
);
assert.equal(
  countries.size,
  collection.features.length,
  "Country IDs are unique",
);
assert(
  !countries.has("PRK"),
  "No separate North Korea label or click geometry",
);
assert.equal(countries.get("KOR").properties.name, "대한민국");
let priorZoom = 0;
for (const feature of collection.features) {
  const p = feature.properties;
  assert(p.name && !/북한|조선민주주의/u.test(p.name));
  assert(p.coordinates.every(Number.isFinite));
  assert(
    p.minZoom >= priorZoom && p.minZoom <= 5,
    "Labels retain useful zoom order",
  );
  priorZoom = p.minZoom;
  const area = geo.geoArea(feature);
  assert(area > 0 && area < Math.PI * 2, `${p.id}: correct D3 polygon winding`);
  assert(
    geo.geoContains(feature, p.coordinates),
    `${p.id}: interior label point`,
  );
}

const containing = (point) =>
  collection.features
    .filter((feature) => geo.geoContains(feature, point))
    .map((feature) => feature.properties.id);
for (const [point, id] of [
  [[126.98, 37.56], "KOR"], // Seoul
  [[125.76, 39.03], "KOR"], // Pyongyang
  [[128.3, 38.2], "KOR"], // Inland east-central peninsula
  [[126.55, 33.38], "KOR"], // Jeju
  [[130.87, 37.49], "KOR"], // Ulleungdo
  [[-3.19, 55.95], "GBR"], // Edinburgh
  [[2.35, 48.86], "FRA"], // Paris
  [[-77.04, 38.91], "USA"],
  [[34.1, 44.95], "UKR"], // Crimea: World Bank, not NE de facto Russia
  [[21.16, 42.66], "XKX"], // World Bank's institutional membership view
  [[121.565, 25.03], "CHN"], // Preserve the same WB baseline uniformly
  [[12.4534, 41.9022], "VAT"], // Sovereign enclave hole in Italy
  [[12.45, 43.94], "SMR"], // San Marino
  [[28.24, -29.6], "LSO"], // Enclave hole in South Africa
  [[7.425, 43.738], "MCO"], // Microstate on a generalized coastline
]) {
  assert.deepEqual(containing(point), [id], `${point}: country selection`);
}
for (const point of [
  [0, 0], // Atlantic: no nearest-country guess
  [-140, 0], // Pacific
  [-13.2, 27.1], // Western Sahara: NDLSA
  [35.8, 33], // Golan Heights: NDLSA
  [78.5, 35.2], // Aksai Chin: NDLSA
]) {
  assert.deepEqual(
    containing(point),
    [],
    `${point}: no invented country territory`,
  );
}
for (const mesh of [geometry.borders, geometry.disputedBorders]) {
  for (const line of mesh.coordinates) {
    assert(
      !line.every(([x, y]) => x > 125 && x < 130 && y > 37 && y < 39),
      "The Korean internal dividing line must not survive in either mesh",
    );
  }
}

const requests = [];
let nextResponse = { ok: true, json: async () => geometry };
const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(resolve("src/lib/historyAtlasCountries.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  {
    exports,
    fetch: async (url) => {
      requests.push(url);
      return nextResponse;
    },
    require: (name) => {
      if (name === "d3-geo") return geo;
      if (name.endsWith("?url")) return { default: name };
      if (name === "./historyAtlas")
        return {
          normalizeAtlasSearch: (value) =>
            value
              .normalize("NFKC")
              .toLocaleLowerCase("ko")
              .replace(/\s+/gu, ""),
        };
      throw new Error(`Unexpected dependency ${name}`);
    },
  },
);
const selected = exports.findAtlasCountry([125.76, 39.03], collection);
assert.equal(selected.properties.id, "KOR");
assert.equal(exports.findAtlasCountry([Infinity, 20], collection), null);
assert.equal(exports.findAtlasCountry([0, 95], collection), null);
for (const [name, id] of [
  ["대한민국", "KOR"],
  ["한국", "KOR"],
  ["중국", "CHN"],
  ["타이", "THA"],
  ["에스파냐", "ESP"],
  ["튀르키예", "TUR"],
]) {
  assert.equal(
    exports.findAtlasCountryForPlace({ name, kind: "country" }, collection)
      ?.properties.id,
    id,
  );
}
assert.equal(
  exports.findAtlasCountryForPlace(
    { name: "로마 제국", kind: "country", coordinates: [12.5, 41.9] },
    collection,
  ),
  null,
  "A historical state must not be silently replaced with a modern country",
);
assert.equal(
  exports.findAtlasCountryForPlace(
    { name: "프랑스", kind: "settlement" },
    collection,
  ),
  null,
);
nextResponse = { ok: false };
await assert.rejects(exports.loadAtlasCountryGeometry());
nextResponse = { ok: true, json: async () => geometry };
const first = exports.loadAtlasCountryGeometry();
const second = exports.loadAtlasCountryGeometry();
assert.equal(
  first,
  second,
  "Atlas and globe share one successful source fetch",
);
assert.equal(await first, geometry);
assert.equal(requests.length, 2, "A failed source request can be retried");
assert(requests.every((url) => url.includes("countries-world.json")));
console.log(
  `Country boundaries verified: ${countries.size} countries/territories, Korean union, World Bank dispute policy, labels and selection.`,
);
