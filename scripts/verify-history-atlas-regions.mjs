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
    {
      exports,
      require(name) {
        assert(name.startsWith("."), "Regions must use local static data");
        return load(resolve(dirname(path), `${name}.ts`));
      },
    },
    { filename: path },
  );
  return exports;
}

// Region membership is an archival catalogue; map curation may exclude its names.
const dataset = load("src/data/historyAtlasContent.ts").historyAtlasSourceDataset;
const regions = load("src/lib/historyAtlasRegions.ts");
const { koreaAtlasRegionIdsByPlace: korea } = load(
  "src/data/historyAtlasKoreaRegions.ts",
);
const { worldAtlasRegionIdsByPlace: world } = load(
  "src/data/historyAtlasWorldRegions.ts",
);
const {
  ATLAS_KOREA_PROVINCES,
  ATLAS_WORLD_REGION_GROUPS,
  getAtlasPlaceRegionIds,
  matchesAtlasRegion,
} = regions;
const units = new Map(dataset.units.map((unit) => [unit.id, unit]));
const places = new Map(dataset.places.map((place) => [place.id, place]));
const subjects = Object.fromEntries(
  ["korea", "world"].map((subject) => [
    subject,
    new Set(
      dataset.entries
        .filter((entry) => units.get(entry.unitId).subject === subject)
        .map((entry) => entry.placeId),
    ),
  ]),
);
const worldIds = new Set(
  ATLAS_WORLD_REGION_GROUPS.flatMap((group) => [
    group.id,
    ...group.children.map(({ id }) => id),
  ]),
);
const koreaIds = new Set(ATLAS_KOREA_PROVINCES.map(({ id }) => id));
assert.equal(koreaIds.size, ATLAS_KOREA_PROVINCES.length);
assert.equal(
  worldIds.size,
  ATLAS_WORLD_REGION_GROUPS.reduce(
    (sum, group) => sum + group.children.length + 1,
    0,
  ),
  "Region IDs must be unique",
);

for (const [subject, map, validIds] of [
  ["korea", korea, koreaIds],
  ["world", world, worldIds],
]) {
  for (const [id, memberships] of Object.entries(map)) {
    assert(
      subjects[subject].has(id),
      `${subject}: unknown or wrong-subject place ${id}`,
    );
    assert.equal(
      new Set(memberships).size,
      memberships.length,
      `${id}: duplicate regions`,
    );
    for (const region of memberships)
      assert(validIds.has(region), `${id}: unknown region ${region}`);
    assert(
      !memberships.includes("unclassified") || memberships.length === 1,
      `${id}: classified and unclassified cannot coexist`,
    );
  }
  const groups =
    subject === "korea" ? ATLAS_KOREA_PROVINCES : ATLAS_WORLD_REGION_GROUPS;
  let classified = 0;
  for (const id of subjects[subject]) {
    const place = places.get(id);
    assert(
      matchesAtlasRegion(place, subject, "", ""),
      `${id}: lost from all regions`,
    );
    const memberships = getAtlasPlaceRegionIds(place, subject);
    const matchedGroups = groups.filter((group) =>
      matchesAtlasRegion(place, subject, group.id, ""),
    );
    assert(
      matchedGroups.length,
      `${id}: no discoverable region or unclassified option`,
    );
    if (!memberships.includes("unclassified")) classified += 1;
  }
  console.log(
    `${subject}: ${classified}/${subjects[subject].size} places classified; remaining names retained under unclassified and all.`,
  );
}

const getPlace = (name, subject) => {
  const matches = dataset.places.filter(
    (place) => place.name === name && subjects[subject].has(place.id),
  );
  assert.equal(matches.length, 1, `${subject}: expected a unique ${name}`);
  return matches[0];
};
const inRegion = (name, subject, group, child = "") => {
  assert(
    matchesAtlasRegion(getPlace(name, subject), subject, group, child),
    `${name}: expected ${group}/${child}`,
  );
};

// Independently chosen teaching examples exercise both hierarchy and source
// exceptions, rather than asserting that the mapping matches itself.
for (const [name, group, child] of [
  ["파리", "europe", "europe-west"],
  ["아테네", "europe", "europe-south"],
  ["베이징", "asia", "asia-east"],
  ["아그라", "asia", "asia-south"],
  ["바그다드", "asia", "asia-west"],
  ["바그다드", "middle-east", ""],
  ["보스턴", "america", "america-north"],
  ["지중해", "water", "water-mediterranean"],
  ["태평양", "water", "water-pacific"],
  ["그린란드", "greenland", ""],
  ["북극해", "arctic", ""],
])
  inRegion(name, "world", group, child);

for (const [name, province] of [
  ["한양", "gyeonggi"],
  ["송악 · 개경", "gyeonggi"],
  ["수원", "gyeonggi"],
  ["제주도", "jeolla"],
  ["전주", "jeolla"],
  ["청주", "chungcheong"],
  ["안동", "gyeongsang"],
  ["평양", "pyeongan"],
  ["백두산", "hamgyeong"],
  ["금산", "jeolla"],
  ["진산", "jeolla"],
  ["울진", "gangwon"],
  ["평해", "gangwon"],
  ["안변", "hamgyeong"],
  ["원산", "hamgyeong"],
  ["상하이", "outside-korea"],
])
  inRegion(name, "korea", province);

assert(
  !matchesAtlasRegion(
    getPlace("파리", "world"),
    "world",
    "asia",
    "europe-west",
  ),
);
assert(
  !matchesAtlasRegion(getPlace("바그다드", "world"), "world", "europe", ""),
);
assert(
  !matchesAtlasRegion(getPlace("제주도", "korea"), "korea", "gyeongsang", ""),
);
assert(!matchesAtlasRegion(getPlace("금산", "korea"), "korea", "chungcheong"));
assert(!matchesAtlasRegion(getPlace("울진", "korea"), "korea", "gyeongsang"));
assert(!matchesAtlasRegion(getPlace("원산", "korea"), "korea", "gangwon"));
assert(
  !matchesAtlasRegion(
    getPlace("지중해", "world"),
    "world",
    "europe",
    "europe-south",
  ),
);
const unknown = {
  id: "unverified-place",
  name: "이름 미확정",
  coordinates: null,
  aliases: ["파리", "한양"],
};
for (const subject of ["korea", "world"]) {
  assert(matchesAtlasRegion(unknown, subject, "unclassified"));
  assert(matchesAtlasRegion(unknown, subject, ""));
}
assert(!matchesAtlasRegion(unknown, "world", "europe"));
assert(!matchesAtlasRegion(unknown, "korea", "gyeonggi"));

// Applying a region alongside unit/era filters must preserve source entries,
// names without coordinates and the original historical citations.
const original = JSON.stringify(dataset);
const koreanEntries = dataset.entries.filter(
  (entry) => units.get(entry.unitId).subject === "korea",
);
for (const province of ATLAS_KOREA_PROVINCES) {
  const filtered = koreanEntries.filter((entry) =>
    matchesAtlasRegion(places.get(entry.placeId), "korea", province.id),
  );
  assert(
    filtered.every(
      (entry) =>
        entry.citations.length || entry.historicalStory?.sources.length,
    ),
  );
}
assert.equal(
  JSON.stringify(dataset),
  original,
  "Filtering must not rewrite textbook data or coordinates",
);
const bytes = gzipSync(JSON.stringify({ korea, world })).byteLength;
assert(bytes < 35_000, `Region membership traffic budget exceeded: ${bytes}`);
console.log(
  `Atlas region hierarchy, independent examples, historical province exceptions, unknown-name retention and ${bytes}-byte gzip data budget passed.`,
);
