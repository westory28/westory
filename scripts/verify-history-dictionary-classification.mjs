import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
import ts from "typescript";

const cache = new Map();
function load(filename) {
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
    { exports, require: (name) => load(resolve(dirname(path), `${name}.ts`)) },
  );
  return exports;
}
const { getHistoryDictionaryBaselineCatalog, searchHistoryDictionaryCatalog } =
  load("src/lib/historyDictionaryCatalog.ts");
const themes = load("src/lib/historyDictionaryThemes.ts");
const {
  historyDictionaryFacets: facets,
  getHistoryDictionaryFacet,
  expandHistoryDictionaryFacetIds,
  getHistoryDictionaryTermFacets,
  matchesHistoryDictionaryFacets,
} = themes;
// Preserve the original map/worksheet classification audit. Textbook revisions
// are independently checked against their page evidence in the textbook check.
const terms = getHistoryDictionaryBaselineCatalog();
const metadata = load("src/data/historyDictionaryClassification.ts");
const audit = JSON.parse(
  readFileSync(
    "docs/reviews/history-dictionary-classification-20261018.json",
    "utf8",
  ),
);

// Check the real import graph before loading any atlas data for independent comparison.
assert(
  [...cache.keys()].every(
    (path) => !/historyAtlas|firebase|boundary/i.test(path),
  ),
  "Dictionary imported map/backend runtime",
);
const byId = new Map(terms.map((term) => [term.id, term]));
const facetIds = new Set(facets.map((facet) => facet.id));
assert.equal(terms.length, 2383);
assert.equal(byId.size, terms.length);
assert.equal(facetIds.size, facets.length);
assert.equal(
  Object.keys(metadata.historyDictionaryCoreClassification).length,
  133,
);
assert.equal(
  Object.keys(metadata.historyDictionaryPlaceClassification).length,
  2250,
);
assert.equal(audit.total, terms.length);
assert.equal(audit.facetCount, facets.length);
assert.equal(audit.facetSetCount, metadata.historyDictionaryFacetSets.length);

const groups = new Set(["subject", "era", "region", "topic"]);
for (const facet of facets) {
  assert(groups.has(facet.group));
  assert(facet.id.startsWith(`${facet.group}:`));
  assert(facet.label.trim());
  if (facet.subjectId)
    assert.equal(getHistoryDictionaryFacet(facet.subjectId)?.group, "subject");
  if (facet.parentId)
    assert.equal(getHistoryDictionaryFacet(facet.parentId)?.group, facet.group);
  // Expansion detects parent cycles and unknown references.
  assert(expandHistoryDictionaryFacetIds([facet.id]).includes(facet.id));
}
for (const ids of metadata.historyDictionaryFacetSets) {
  assert.equal(new Set(ids).size, ids.length, "Duplicate facet within palette");
  assert.deepEqual(
    Array.from(expandHistoryDictionaryFacetIds(ids)),
    Array.from(ids),
    "Missing ancestor or unstable ordering",
  );
}
for (const term of terms) {
  assert(
    Array.isArray(term.facetIds) && term.facetIds.length,
    `${term.id}: missing classification`,
  );
  assert.equal(new Set(term.facetIds).size, term.facetIds.length);
  for (const id of term.facetIds) {
    assert(facetIds.has(id), `${term.id}: unknown facet ${id}`);
    const facet = getHistoryDictionaryFacet(id);
    if (facet.parentId)
      assert(
        term.facetIds.includes(facet.parentId),
        `${term.id}: missing parent ${facet.parentId}`,
      );
    if (facet.subjectId)
      assert(
        term.facetIds.includes(facet.subjectId),
        `${term.id}: era subject lost`,
      );
  }
  assert(getHistoryDictionaryTermFacets(term, "subject").length);
  assert(getHistoryDictionaryTermFacets(term, "topic").length);
  if (term.kind === "history") {
    assert(
      getHistoryDictionaryTermFacets(term, "era").length,
      `${term.word}: unreviewed core era`,
    );
    assert.equal(
      getHistoryDictionaryTermFacets(term, "region").length,
      0,
      `${term.word}: concept given an invented location`,
    );
  } else {
    assert(getHistoryDictionaryTermFacets(term, "region").length);
    assert(
      !term.facetIds.includes("era:common"),
      `${term.id}: unknown era presented as timeless`,
    );
    if (term.facetIds.includes("region:unconfirmed"))
      assert.equal(getHistoryDictionaryTermFacets(term, "region").length, 1);
  }
}

const { historyAtlasSourceDataset: atlas } = load(
  "src/data/historyAtlasContent.ts",
);
const { getAtlasHistoryEntries } = load("src/lib/historyAtlasStories.ts");
const { getAtlasPlaceRegionIds } = load("src/lib/historyAtlasRegions.ts");
const { historyAtlasReferenceDefinitions } = load(
  "src/data/historyAtlasReferenceDefinitions.ts",
);
const place = (id) => {
  const term = byId.get(`catalog-place-${id}`);
  assert(term, `Missing ${id}`);
  return term;
};
const core = (word) => {
  const term = byId.get(`catalog-history-${encodeURIComponent(word)}`);
  assert(term, `Missing ${word}`);
  return term;
};
const idsFor = (term, group) =>
  getHistoryDictionaryTermFacets(term, group).map((facet) => facet.id);
const normalizeName = (word) => word.normalize("NFKC").replace(/\s+/gu, "");
const references = new Map(
  historyAtlasReferenceDefinitions.map(([id, title, revision]) => [
    id,
    `${title}\u0000${revision}`,
  ]),
);
const atlasPlaces = new Map(atlas.places.map((item) => [item.id, item]));
const units = new Map(atlas.units.map((item) => [item.id, item]));
for (const entry of atlas.entries) {
  const term = byId.get(`catalog-place-${entry.placeId}`);
  if (term)
    assert(
      term.facetIds.includes(`subject:${units.get(entry.unitId).subject}`),
      `${entry.placeId}: source subject lost`,
    );
}

for (const record of [...audit.copiedEras, ...audit.copiedRegions]) {
  assert(record.from.length);
  for (const peerId of record.from) {
    assert(references.get(record.id));
    assert.equal(
      references.get(record.id),
      references.get(peerId),
      "Different source/revision merged",
    );
    assert.equal(
      normalizeName(place(record.id).word),
      normalizeName(place(peerId).word),
      "Different entities in a shared article merged",
    );
  }
}
const unassigned = new Map(
  audit.unassignedEras.map((record) => [record.id, record]),
);
const unconfirmed = new Map(
  audit.unconfirmedRegions.map((record) => [record.id, record]),
);
assert.equal(unassigned.size, audit.unassignedEras.length);
assert.equal(unconfirmed.size, audit.unconfirmedRegions.length);
const overrides = new Map(
  audit.placeDecisions.map((record) => [record.id, record]),
);
const eraCopies = new Map(
  audit.copiedEras.map((record) => [record.id, record]),
);
const regionCopies = new Map(
  audit.copiedRegions.map((record) => [record.id, record]),
);
let actualEraCoverage = 0;
let actualRegionCoverage = 0;
for (const term of terms.filter((item) => item.kind === "place")) {
  const id = term.atlasPlaceId;
  const eras = idsFor(term, "era");
  assert.equal(
    !eras.length,
    unassigned.has(id),
    `${id}: era omission missing from audit`,
  );
  if (!eras.length) assert(unassigned.get(id).reason);
  else actualEraCoverage++;
  const expectedEraIds = overrides.has(id)
    ? overrides.get(id).eraIds
    : eraCopies.has(id)
      ? eraCopies
          .get(id)
          .from.flatMap(
            (peer) =>
              overrides.get(peer)?.eraIds ||
              getAtlasHistoryEntries(atlas, peer).flatMap(
                (entry) => entry.eraIds || [],
              ),
          )
      : getAtlasHistoryEntries(atlas, id).flatMap(
          (entry) => entry.eraIds || [],
        );
  assert.deepEqual(
    Array.from(eras),
    Array.from(
      expandHistoryDictionaryFacetIds(
        expectedEraIds.map((era) => `era:${era}`),
      ),
    ),
    `${id}: stale or unsupported era`,
  );
  const unknown = term.facetIds.includes("region:unconfirmed");
  assert.equal(
    unknown,
    unconfirmed.has(id),
    `${id}: region omission missing from audit`,
  );
  if (!unknown) actualRegionCoverage++;
  const rawRegions = getAtlasPlaceRegionIds(atlasPlaces.get(id), "korea")
    .filter((region) => !["outside-korea", "unclassified"].includes(region))
    .map((region) => `region:korea-${region}`)
    .concat(
      getAtlasPlaceRegionIds(atlasPlaces.get(id), "world")
        .filter((region) => region !== "unclassified")
        .map((region) => `region:${region}`),
    );
  rawRegions.push(...(regionCopies.get(id)?.added || []));
  const expectedRegions = expandHistoryDictionaryFacetIds(
    rawRegions.length ? rawRegions : ["region:unconfirmed"],
  );
  assert.deepEqual(
    Array.from(idsFor(term, "region")),
    Array.from(expectedRegions),
    `${id}: stale or guessed region`,
  );
}
assert.equal(actualEraCoverage, audit.classifiedPlaceEraCount);
assert.equal(actualRegionCoverage, audit.classifiedPlaceRegionCount);

// Historical meaning, not the source worksheet chapter.
assert.deepEqual(Array.from(idsFor(core("고조선"), "era")), ["era:k-gojoseon"]);
assert(!core("고려").facetIds.includes("era:k-joseon"));
assert.deepEqual(Array.from(idsFor(core("정몽주"), "era")), ["era:k-goryeo"]);
assert.deepEqual(Array.from(idsFor(core("위화도 회군"), "era")), [
  "era:k-goryeo",
]);
assert(core("고려사").facetIds.includes("era:k-joseon-early"));
assert(!core("고려사").facetIds.includes("era:k-goryeo"));
for (const word of ["유교", "불교", "왕조", "유격전"])
  assert.deepEqual(Array.from(idsFor(core(word), "era")), ["era:common"]);
for (const word of ["집현전", "사헌부", "춘추관", "성균관"]) {
  assert(core(word).facetIds.includes("era:k-goryeo"));
  assert(core(word).facetIds.includes("era:k-joseon-early"));
}
assert(!core("집현전").facetIds.includes("era:k-joseon-late"));
assert.deepEqual(Array.from(idsFor(place("kr-e8350c00f10a"), "era")), [
  "era:k-gojoseon",
]);
assert.deepEqual(
  Array.from(idsFor(place("kr-e9c99a172d2b"), "era")),
  Array.from(idsFor(place("world-e9c99a172d2b"), "era")),
);
assert(place("world-e9c99a172d2b").facetIds.includes("subject:world"));
assert(!place("world-e9c99a172d2b").facetIds.includes("era:w-contemporary"));
assert.deepEqual(Array.from(idsFor(place("world-5350ddf46cbb"), "era")), [
  "era:w-medieval",
]);
for (const id of [
  "kr-c137ea78cf57",
  "kr-60064b649d75",
  "world-60064b649d75",
  "kr-50dff25ab3bf",
  "kr-215dd5d7b724",
  "kr-b452c0e0de62",
  "kr-b867ddf7eb84",
])
  assert.equal(
    idsFor(place(id), "era").length,
    0,
    `${id}: artifact era leaked into institution`,
  );

// One source article is not one entity; names alone are not an entity key either.
assert(place("kr-31ee5f79f84a").facetIds.includes("region:korea-pyeongan"));
assert(!place("kr-31ee5f79f84a").facetIds.includes("region:korea-hamgyeong"));
assert(place("kr-be8f1454c1ad").facetIds.includes("region:korea-hamgyeong"));
assert(!place("kr-be8f1454c1ad").facetIds.includes("region:korea-pyeongan"));
for (const province of ["gangwon", "chungcheong", "gyeongsang", "jeolla"])
  assert(
    !place("kr-81c55ada08a6").facetIds.includes(`region:korea-${province}`),
  );
assert(place("kr-81c55ada08a6").facetIds.includes("region:korea-hwanghae"));
assert(place("kr-a730c371946e").facetIds.includes("region:korea-gyeonggi"));
assert(!place("world-a730c371946e").facetIds.includes("region:korea-gyeonggi"));
assert(place("jeju").facetIds.includes("region:korea-jeolla"));
assert(place("jeju").facetIds.includes("region:korea-eight-provinces"));
assert.equal(
  getHistoryDictionaryFacet("region:korea-eight-provinces").label,
  "조선 8도",
);
for (const id of [
  "kr-06811683f45c",
  "kr-2ffc31b9b5e6",
  "kr-d95ad83c4fe7",
  "kr-e4a602fa8857",
]) {
  assert(!place(id).facetIds.includes("topic:country"));
  assert(place(id).facetIds.includes("topic:social-order"));
}
for (const word of [
  "로마 제국",
  "오스만 제국",
  "무굴 제국",
  "프랑크 왕국",
  "북위",
]) {
  const found = terms.filter((term) => term.word === word);
  assert(found.length);
  for (const term of found)
    assert(
      term.facetIds.includes("topic:country"),
      `${word}: historical country presented as a generic area`,
    );
}
assert(place("kr-e5597b63c484").facetIds.includes("topic:desert"));
for (const id of [
  "kr-93ebbe6fe34d",
  "world-7096f97791db",
  "world-3c87cec8df7c",
])
  assert(place(id).facetIds.includes("topic:island"));

const gyeongguk = core("경국대전");
assert(
  matchesHistoryDictionaryFacets(gyeongguk, [
    "subject:korea",
    "era:k-joseon",
    "topic:politics",
  ]),
);
assert(
  !matchesHistoryDictionaryFacets(gyeongguk, ["subject:world", "era:k-joseon"]),
);
assert(
  matchesHistoryDictionaryFacets(gyeongguk, ["era:k-gojoseon", "era:k-joseon"]),
);
assert(matchesHistoryDictionaryFacets(gyeongguk, []));
assert(!matchesHistoryDictionaryFacets(gyeongguk, ["invalid:id"]));
assert.throws(() => expandHistoryDictionaryFacetIds(["invalid:id"]));
assert.equal(
  searchHistoryDictionaryCatalog("과전법", 1)[0].id,
  core("과전법").id,
);

const metadataGzipBytes = gzipSync(
  readFileSync("src/data/historyDictionaryClassification.ts"),
).length;
assert(
  metadataGzipBytes < 70000,
  `Compact metadata budget exceeded: ${metadataGzipBytes}`,
);
console.log(
  JSON.stringify({
    terms: terms.length,
    facets: facets.length,
    coreReviewed: 133,
    placeEraCoverage: actualEraCoverage,
    placeEraUnassigned: unassigned.size,
    placeRegionCoverage: actualRegionCoverage,
    placeRegionUnconfirmed: unconfirmed.size,
    metadataGzipBytes,
  }),
);
