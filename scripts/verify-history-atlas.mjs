import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
import ts from "typescript";
import { geoPath, geoMercator, geoNaturalEarth1, geoContains } from "d3-geo";

const cache = new Map();
const load = (filename) => {
  const path = resolve(filename);
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  cache.set(path, exports);
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require(name) {
        assert(name.startsWith("."), `Unexpected content dependency: ${name}`);
        return load(resolve(dirname(path), `${name}.ts`));
      },
    },
    { filename: path },
  );
  return exports;
};

const { historyAtlasDataset: dataset } = load(
  "src/data/historyAtlasContent.ts",
);
const { matchesAtlasSearch } = load("src/lib/historyAtlas.ts");
const unique = (items, label) => {
  const ids = items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: duplicate ID`);
  ids.forEach((id) => assert(/^[a-z0-9-]+$/u.test(id), `Unstable ID: ${id}`));
  return new Map(items.map((item) => [item.id, item]));
};
const sources = unique(dataset.sources, "source");
const sourcePages = {
  history1: 252,
  "history2-lee": 209,
  "atlas-lee": 106,
  "atlas-2022": 107,
};
const units = unique(dataset.units, "unit");
const places = unique(dataset.places, "place");
unique(dataset.entries, "entry");
assert(dataset.sources.length >= 2, "Both history textbooks need provenance");
for (const unit of dataset.units) {
  assert(["korea", "world"].includes(unit.subject));
  const [west, south, east, north] = unit.bounds;
  assert(
    west < east &&
      south < north &&
      west >= -180 &&
      east <= 180 &&
      south >= -90 &&
      north <= 90,
    `${unit.id}: invalid extent`,
  );
  assert(
    dataset.entries.some((entry) => entry.unitId === unit.id),
    `${unit.id}: empty unit`,
  );
}
for (const place of dataset.places) {
  const [lon, lat] = place.coordinates;
  assert(
    Number.isFinite(lon) &&
      Number.isFinite(lat) &&
      Math.abs(lon) <= 180 &&
      Math.abs(lat) <= 90,
    `${place.id}: invalid WGS84 position`,
  );
  assert(place.name.trim(), `${place.id}: missing name`);
}
for (const entry of dataset.entries) {
  assert(units.has(entry.unitId), `${entry.id}: missing unit`);
  const place = places.get(entry.placeId);
  assert(place, `${entry.id}: missing place`);
  assert(
    entry.summary.trim() && entry.significance.trim(),
    `${entry.id}: missing explanation`,
  );
  assert(entry.citations.length > 0, `${entry.id}: missing evidence`);
  for (const citation of entry.citations) {
    assert(sources.has(citation.sourceId), `${entry.id}: unknown source`);
    assert(
      Number.isInteger(citation.pdfPage) &&
        citation.pdfPage > 0 &&
        citation.pdfPage <= sourcePages[citation.sourceId],
      `${entry.id}: invalid PDF page`,
    );
    assert(
      String(citation.printedPage).trim(),
      `${entry.id}: missing printed page`,
    );
  }
  for (const id of entry.relatedPlaceIds || [])
    assert(places.has(id), `${entry.id}: unknown related place`);
  assert(
    matchesAtlasSearch(entry, place, place.name),
    `${entry.id}: name not searchable`,
  );
  for (const alias of place.aliases || [])
    assert(
      matchesAtlasSearch(entry, place, alias),
      `${entry.id}: alias not searchable`,
    );
}
for (const subject of ["korea", "world"]) {
  const count = dataset.entries.filter(
    (entry) => units.get(entry.unitId).subject === subject,
  ).length;
  assert(count >= 15, `${subject}: incomplete subject coverage (${count})`);
}

const manifest = JSON.parse(
  readFileSync("src/data/atlas/sources.json", "utf8"),
);
const budgets = { korea: 0, world: 0 };
const geographies = {};
for (const layer of manifest.layers) {
  const raw = readFileSync(`src/data/atlas/${layer.file}`);
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    layer.sha256,
    `${layer.file}: source drift`,
  );
  const geometry = JSON.parse(raw);
  geographies[layer.file] = geometry;
  const projection = layer.file.includes("korea")
    ? geoMercator().center([127, 37]).scale(1800)
    : geoNaturalEarth1();
  const start = performance.now();
  const path = geoPath(projection)(geometry);
  assert(
    path && !/NaN|Infinity/u.test(path),
    `${layer.file}: invalid projection`,
  );
  const compressed = gzipSync(raw).byteLength;
  budgets[layer.file.includes("korea") ? "korea" : "world"] += compressed;
  console.log(
    `${layer.file}: ${compressed} gzip bytes, ${Math.round(performance.now() - start)} ms Node path generation`,
  );
}
assert(
  geoContains(geographies["land-world.json"], [126.98, 37.57]),
  "Seoul must be on land; catches reversed spherical rings",
);
assert(
  geoContains(geographies["land-world.json"], [12.5, 41.9]),
  "Rome must be on land",
);
assert(
  !geoContains(geographies["land-world.json"], [-130, 0]),
  "Pacific must remain water",
);
assert(
  geoContains(geographies["land-korea.json"], [127.8, 36.3]),
  "Korean inland must be on land",
);
assert(
  !geoContains(geographies["land-korea.json"], [130, 37]),
  "East Sea must remain water",
);
for (const [subject, bytes] of Object.entries(budgets))
  assert(
    bytes < 1024 * 1024,
    `${subject}: geography exceeds initial 1 MiB transfer budget`,
  );
console.log(
  `Atlas verified: ${dataset.units.length} units / ${dataset.places.length} places / ${dataset.entries.length} entries. Geography gzip: ${JSON.stringify(budgets)}`,
);
