import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
    {
      exports,
      require: (name) => load(resolve(dirname(path), `${name}.ts`)),
    },
  );
  return exports;
}

const { historyAtlasSourceDataset: dataset } = load(
  "src/data/historyAtlasContent.ts",
);
const { getAtlasPlaceProfile, isAtlasSourceContext } = load(
  "src/lib/historyAtlasProfiles.ts",
);
const { historyAtlasReferenceDefinitions: wikipedia } = load(
  "src/data/historyAtlasReferenceDefinitions.ts",
);
const { historyAtlasEncyclopediaDefinitions: encyclopedia } = load(
  "src/data/historyAtlasEncyclopediaDefinitions.ts",
);
const places = new Map(dataset.places.map((place) => [place.id, place]));
for (const [label, definitions] of [
  ["Wikipedia", wikipedia],
  ["AKS", encyclopedia],
]) {
  assert.equal(
    new Set(definitions.map(([id]) => id)).size,
    definitions.length,
    `${label}: repeated place ID`,
  );
  for (const [id, title, revision, definition] of definitions) {
    assert(places.has(id), `${label}: unknown place ${id}`);
    assert(
      title && revision && definition.trim(),
      `${id}: missing provenance/definition`,
    );
    assert(
      !isAtlasSourceContext(definition),
      `${id}: caption used as definition`,
    );
    assert.equal(
      (definition.match(/\(/gu) || []).length,
      (definition.match(/\)/gu) || []).length,
      `${id}: malformed parentheses`,
    );
    assert(
      !/듣기 \)|궁궐지정\.|잉문명의|별똥별|보석 장신구/u.test(definition),
      `${id}: malformed/non-geographic excerpt`,
    );
  }
}

// These same-name pages describe a different place, era, or a non-geographic object.
for (const id of [
  "kr-fe6083c45bfa",
  "kr-e78f582eee68",
  "world-43b370fd0aec",
  "kr-8c06cb76767e",
  "world-2064571eae7e",
  "kr-b21bec130154",
  "kr-ab0228174178",
  "kr-52c80072ba18",
  "kr-8fbc2902ad39",
  "kr-7fb1e90e9e47",
  "kr-14d26b24bf6f",
])
  assert(
    !wikipedia.some(([placeId]) => placeId === id),
    `${id}: unsafe automatic match restored`,
  );

for (const [id, expected] of [
  ["kr-fe6083c45bfa", "황해도"],
  ["kr-ab0228174178", "고려"],
  ["kr-52c80072ba18", "고려"],
  ["kr-8fbc2902ad39", "고려"],
  ["kr-7fb1e90e9e47", "서경"],
  ["kr-14d26b24bf6f", "강화도"],
])
  assert(
    getAtlasPlaceProfile(places.get(id), dataset.entries).definition.includes(
      expected,
    ),
    `${id}: historical meaning lost`,
  );

for (const id of [
  "kr-76cc007aa942",
  "kr-48e90e3f82e0",
  "kr-3e72ef43633f",
  "kr-bd065f0d1538",
  "kr-f6f733c2ebd3",
  "kr-89457b94f0a7",
  "kr-d3c4396280a0",
  "kr-aeb934831f1e",
  "kr-03ec817998b4",
  "kr-55e1a20fdec1",
  "kr-0e5014dff93f",
  "kr-c372351584c4",
  "kr-7a90a7bd8645",
  "kr-a42cfe638d05",
  "kr-f6d04964c6f5",
  "world-e7eb35422f77",
  "kr-007d255ac052",
  "kr-834fb5ce7e93",
])
  assert(
    !encyclopedia.some(([placeId]) => placeId === id),
    id + ": unsafe AKS match restored",
  );

for (const [id, title] of [
  ["world-389dc8d0c779", "사타바하나 왕조"],
  ["world-d4a8d58d90a8", "이탈리아 왕국 (1805년~1814년)"],
  ["world-6250637ec634", "충산구"],
  ["world-4c51052d4a44", "동인도 제도"],
])
  assert.equal(
    wikipedia.find(([placeId]) => placeId === id)?.[1],
    title,
    id + ": historical era mismatch",
  );

const unresolved = [];
const counts = { verified: 0, reference: 0, basic: 0 };
for (const place of dataset.places) {
  const profile = getAtlasPlaceProfile(place, dataset.entries);
  counts[profile.quality] += 1;
  assert(profile.definition.trim(), `${place.id}: empty definition`);
  if (profile.quality === "basic") {
    unresolved.push({
      id: place.id,
      name: place.name,
      kind: place.kind,
      hasCoordinates: !!place.coordinates,
    });
  } else {
    assert(
      profile.sources.length || profile.textbookCitations?.length,
      `${place.id}: unsupported definition`,
    );
    assert(
      !isAtlasSourceContext(profile.definition),
      `${place.id}: source caption promoted to explanation`,
    );
  }
  for (const source of profile.sources)
    assert.equal(
      new URL(source.url).protocol,
      "https:",
      `${place.id}: unsafe source URL`,
    );
}
assert(
  counts.verified + counts.reference >= 2200,
  "Sourced place-definition coverage regressed",
);
const unresolvedMapped = unresolved.filter((place) => place.hasCoordinates);
assert(
  unresolvedMapped.length <= 1 &&
    unresolvedMapped.every((place) => place.id === "world-89964281fd43"),
  "Mapped place lost its sourced definition",
);
if (process.argv.includes("--report")) {
  writeFileSync(
    "output/atlas-profile-coverage.json",
    JSON.stringify(
      {
        total: dataset.places.length,
        counts,
        unresolvedWithCoordinates: unresolved.filter(
          (place) => place.hasCoordinates,
        ).length,
        unresolved,
      },
      null,
      2,
    ),
  );
}
console.log(
  `Atlas definitions: ${counts.verified} curated/textbook + ${counts.reference} encyclopedia; ${counts.basic} unresolved of ${dataset.places.length} (${unresolved.filter((place) => place.hasCoordinates).length} with coordinates).`,
);
