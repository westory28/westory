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

// The source ledger preserves textbook provenance independently of the smaller
// coordinate-backed map dataset, which has its own curation regression checks.
const { historyAtlasSourceDataset: dataset } = load(
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
const entries = unique(dataset.entries, "entry");
const eras = unique(dataset.eras || [], "era");
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
  assert(place.name.trim(), `${place.id}: missing name`);
  if (place.coordinates === null) {
    assert(
      place.locationNote?.trim(),
      `${place.id}: unlocated name needs context`,
    );
    continue;
  }
  const [lon, lat] = place.coordinates;
  assert(
    Number.isFinite(lon) &&
      Number.isFinite(lat) &&
      Math.abs(lon) <= 180 &&
      Math.abs(lat) <= 90,
    `${place.id}: invalid WGS84 position`,
  );
}
for (const entry of dataset.entries) {
  assert(units.has(entry.unitId), `${entry.id}: missing unit`);
  const place = places.get(entry.placeId);
  assert(place, `${entry.id}: missing place`);
  assert(entry.summary.trim(), `${entry.id}: missing source context`);
  assert(
    entry.geographicReference || entry.eraIds?.length > 0,
    `${entry.id}: missing historical period`,
  );
  assert(
    entry.citations.length > 0 ||
      entry.historicalStory?.sources.length > 0 ||
      entry.geographicReference?.sources.length > 0,
    `${entry.id}: missing evidence`,
  );
  for (const citation of entry.citations) {
    assert(sources.has(citation.sourceId), `${entry.id}: unknown source`);
    assert(
      Number.isInteger(citation.pdfPage) &&
        citation.pdfPage > 0 &&
        citation.pdfPage <= sourcePages[citation.sourceId],
      `${entry.id}: invalid PDF page`,
    );
    if (citation.printedPage !== undefined)
      assert(citation.printedPage.trim(), `${entry.id}: empty printed page`);
  }
  for (const id of entry.relatedPlaceIds || [])
    assert(places.has(id), `${entry.id}: unknown related place`);
  for (const id of entry.relatedEntryIds || [])
    assert(entries.has(id), `${entry.id}: unknown related story`);
  for (const id of entry.eraIds || []) {
    assert(eras.has(id), `${entry.id}: unknown era ${id}`);
    assert.equal(
      eras.get(id).subject,
      units.get(entry.unitId).subject,
      `${entry.id}: era belongs to another subject`,
    );
  }
  if (entry.displayName)
    assert(
      matchesAtlasSearch(entry, place, entry.displayName),
      `${entry.id}: historical name not searchable`,
    );
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
assert(entries.get("k-gyeongju").eraIds.includes("k-unified-silla"));
assert(entries.get("k-gyeongju").eraIds.includes("k-north-south"));
assert(entries.get("k-kaesong").eraIds.includes("k-later-three"));
assert(entries.get("k-kaesong").eraIds.includes("k-goryeo"));
for (const subject of ["korea", "world"]) {
  const count = dataset.entries.filter(
    (entry) => units.get(entry.unitId).subject === subject,
  ).length;
  assert(count >= 15, `${subject}: incomplete subject coverage (${count})`);
}

// The page ledger records both accepted names and explicit exclusions. A name
// count alone cannot prove that every page of the supplied books was reviewed.
const coveredPages = new Map(
  Object.keys(sourcePages).map((id) => [id, new Set()]),
);
for (const subject of ["korea", "world"]) {
  const filename = `docs/reviews/history-atlas-${subject}-coverage.json`;
  const coverage = JSON.parse(readFileSync(filename, "utf8"));
  let pendingPages = 0;
  for (const source of coverage.sources) {
    assert(sources.has(source.sourceId), `${filename}: unknown source`);
    const reviewed = new Set(source.reviewedPages || []);
    const pending = new Set(source.pendingPages || []);
    pendingPages += pending.size;
    for (const [start, end] of source.pageRanges) {
      assert(start >= 1 && end <= sourcePages[source.sourceId] && start <= end);
      for (let page = start; page <= end; page++) {
        coveredPages.get(source.sourceId).add(page);
        assert(
          reviewed.has(page) !== pending.has(page),
          `${filename}: ${source.sourceId}/${page} must have one review state`,
        );
      }
    }
  }
  for (const candidate of coverage.names) {
    assert(candidate.name.trim(), `${filename}: empty candidate`);
    assert(
      sources.has(candidate.sourceId),
      `${candidate.name}: unknown source`,
    );
    assert(
      candidate.pdfPages.length > 0,
      `${candidate.name}: missing source pages`,
    );
    for (const page of candidate.pdfPages)
      assert(
        Number.isInteger(page) &&
          page >= 1 &&
          page <= sourcePages[candidate.sourceId],
        `${candidate.name}: invalid source page`,
      );
    assert(
      ["included", "merged", "excluded", "pending"].includes(candidate.status),
      `${candidate.name}: unknown review state`,
    );
    if (["included", "merged"].includes(candidate.status)) {
      const linked = (candidate.entryIds || []).map((id) => {
        assert(entries.has(id), `${candidate.name}: unknown entry ${id}`);
        return entries.get(id);
      });
      if (candidate.placeId) {
        assert(
          places.has(candidate.placeId),
          `${candidate.name}: unknown place`,
        );
        linked.push(
          ...dataset.entries.filter(
            (entry) => entry.placeId === candidate.placeId,
          ),
        );
      }
      assert(
        linked.length > 0,
        `${candidate.name}: accepted but absent from atlas`,
      );
      for (const page of candidate.pdfPages)
        assert(
          linked.some((entry) =>
            entry.citations.some(
              (citation) =>
                citation.sourceId === candidate.sourceId &&
                citation.pdfPage === page,
            ),
          ),
          `${candidate.name}: linked story lacks ${candidate.sourceId}/${page}`,
        );
    } else {
      assert(
        candidate.reason?.trim(),
        `${candidate.name}: unresolved/excluded without reason`,
      );
    }
  }
  const pendingNames = coverage.names.filter(
    (name) => name.status === "pending",
  ).length;
  const unresolvedLayers = coverage.unresolvedLayers || [];
  for (const layer of unresolvedLayers) {
    assert(sources.has(layer.sourceId), `${filename}: unknown layer source`);
    assert(
      layer.reason?.trim(),
      `${filename}: unreadable layer needs a reason`,
    );
    for (const page of layer.pdfPages || [])
      assert(
        Number.isInteger(page) &&
          page >= 1 &&
          page <= sourcePages[layer.sourceId],
        `${filename}: invalid unreadable layer page`,
      );
  }
  if (coverage.complete) {
    assert.equal(
      unresolvedLayers.length,
      0,
      `${filename}: complete with unreadable source layers`,
    );
    assert.equal(
      pendingPages,
      0,
      `${filename}: complete with unreviewed pages`,
    );
    assert.equal(
      pendingNames,
      0,
      `${filename}: complete with unresolved names`,
    );
  }
  console.log(
    `${subject} coverage ledger: ${coverage.names.length} names, ${pendingPages} pending pages, ${pendingNames} pending names, ${unresolvedLayers.length} unresolved source layers; complete=${Boolean(coverage.complete)}`,
  );
}
for (const [sourceId, count] of Object.entries(sourcePages))
  assert.equal(
    coveredPages.get(sourceId).size,
    count,
    `${sourceId}: the coverage ledger must account for every supplied PDF page`,
  );

const yeompo = dataset.places.find((place) => place.name === "염포");
assert(
  yeompo?.coordinates,
  "Yeompo must retain its verified representative point",
);
assert(
  yeompo.id !== entries.get("k-ulsan").placeId,
  "Historical Yeompo is distinct from the modern Ulsan port",
);
assert(
  dataset.entries.some(
    (entry) =>
      entry.placeId === yeompo.id &&
      entry.eraIds.some((id) => id.startsWith("k-joseon")) &&
      entry.relatedEntryIds?.includes("k-ulsan"),
  ),
  "Yeompo must link its Joseon account with the Ulsan account",
);
const contentBytes = gzipSync(JSON.stringify(dataset)).byteLength;
assert(
  contentBytes < 512 * 1024,
  "Atlas content exceeds the 512 KiB gzip budget",
);
console.log(
  `Atlas content: ${contentBytes} gzip bytes; ${dataset.places.filter((place) => place.coordinates !== null).length} located places; all 674 PDF pages accounted for`,
);

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
