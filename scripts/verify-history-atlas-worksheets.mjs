import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

function createLoader(withWorksheetSupplement = true) {
  const cache = new Map();
  function load(filename) {
    const path = resolve(filename);
    if (cache.has(path)) return cache.get(path);
    if (
      !withWorksheetSupplement &&
      path.endsWith("historyAtlasWorksheetSupplement.ts")
    )
      return {
        atlasWorksheetNewPlaces: [],
        atlasWorksheetPlaceUpdates: [],
        atlasWorksheetStories: [],
        atlasWorksheetDictionaryReferences: [],
        atlasWorksheetRegionOverrides: {},
        atlasWorksheetWorldRegionOverrides: {},
      };
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
      { filename: path },
    );
    return exports;
  }
  return load;
}

const load = createLoader();
const {
  historyAtlasDataset: dataset,
  historyAtlasSourceDataset: source,
  historyAtlasMapAudit: audit,
} = load("src/data/historyAtlasContent.ts");
const {
  historyAtlasDataset: baseline,
  historyAtlasSourceDataset: baselineSource,
} = createLoader(false)("src/data/historyAtlasContent.ts");
const {
  atlasWorksheetPlaceReviews: reviews,
  atlasWorksheetDictionaryReferences: references,
} = load("src/data/historyAtlasWorksheetSupplement.ts");
const { matchesAtlasSearch, matchesAtlasTemporalScope } = load(
  "src/lib/historyAtlas.ts",
);
const { getAtlasHistoryEntries, atlasEntrySubject } = load(
  "src/lib/historyAtlasStories.ts",
);
const { getAtlasPlaceRegionIds, matchesAtlasRegion } = load(
  "src/lib/historyAtlasRegions.ts",
);
const { getAtlasPlaceProfile } = load("src/lib/historyAtlasProfiles.ts");
const places = new Map(dataset.places.map((place) => [place.id, place]));
const reviewedIds = new Set(reviews.map(({ place }) => place.id));
const originalIds = new Set(baseline.places.map(({ id }) => id));

assert.equal(reviews.length, 13);
assert.equal(reviews.filter((review) => !review.existing).length, 2);
assert.equal(dataset.places.length - baseline.places.length, 13);
assert.deepEqual(
  [
    ...dataset.places
      .filter(({ id }) => !originalIds.has(id))
      .map(({ id }) => id),
  ].sort(),
  [...reviewedIds].sort(),
  "Only reviewed worksheet places gain map markers",
);
assert.equal(
  JSON.stringify(dataset.places.filter(({ id }) => !reviewedIds.has(id))),
  JSON.stringify(baseline.places),
  "Existing displayed places keep their coordinates and names",
);
assert.equal(
  JSON.stringify(
    dataset.entries.filter(
      (entry) => atlasEntrySubject(dataset, entry) === "world",
    ),
  ),
  JSON.stringify(
    baseline.entries.filter(
      (entry) => atlasEntrySubject(baseline, entry) === "world",
    ),
  ),
  "World-history accounts remain unchanged",
);
const originalEntries = new Set(baselineSource.entries.map(({ id }) => id));
assert.equal(
  JSON.stringify(source.entries.filter(({ id }) => originalEntries.has(id))),
  JSON.stringify(baselineSource.entries),
  "Original textbook provenance and descriptions are retained",
);

for (const review of reviews) {
  const place = places.get(review.place.id);
  assert(place && audit.find(({ placeId }) => placeId === place.id)?.included);
  assert(place.coordinates.every(Number.isFinite) && place.locationNote.trim());
  assert(getAtlasPlaceRegionIds(place, "korea").includes(review.regionId));
  assert(matchesAtlasRegion(place, "korea", review.regionId));
  const entries = getAtlasHistoryEntries(dataset, place.id, "korea");
  const current = entries.find(
    (entry) => entry.historicalStory?.id === `worksheet-${place.id}`,
  );
  assert(current, `${place.name}: clickable historical account`);
  assert.equal(
    entries.length,
    1,
    `${place.name}: source captions must not duplicate the new account`,
  );
  assert(
    matchesAtlasTemporalScope(current, current.unitId, review.story.eraIds[0]),
  );
  for (const query of [place.name, ...(review.place.aliases || [])])
    assert(
      matchesAtlasSearch(current, place, query),
      `${place.name}: search ${query}`,
    );
  assert(!matchesAtlasTemporalScope(current, "", "k-prehistory"));
  const profile = getAtlasPlaceProfile(place, entries);
  assert.equal(profile.definition, review.definition);
  assert(
    profile.sources.some(({ url }) =>
      /history\.go\.kr|aks\.ac\.kr|seoul\.go\.kr|khs\.go\.kr|heritage\.go\.kr|ln\.gov\.cn/u.test(
        url,
      ),
    ),
  );
  assert.equal(
    references.find(({ placeId }) => placeId === place.id)?.definition,
    review.definition,
  );
  assert(review.worksheet.endsWith(".pdf"));
}

const sarhu = places.get("worksheet-sarhu");
assert(sarhu.coordinates[0] > 124.2 && sarhu.coordinates[0] < 124.35);
assert(sarhu.coordinates[1] > 41.85 && sarhu.coordinates[1] < 41.95);
assert.match(sarhu.locationNote, /심하·부차/);
assert.equal(
  reviews.find(({ place }) => place.id === sarhu.id).story.startYear,
  1619,
);
const library = places.get("kr-ca387c21676a");
assert(
  library.coordinates[1] > 37.58 && library.coordinates[1] < 37.59,
  "The Joseon Gyujanggak stays at Changdeokgung, not modern Seoul National University",
);
assert.match(library.locationNote, /서울대학교/);
assert.match(places.get("kr-08b2887f4e5e").locationNote, /현대 부산항/);
assert.equal(places.get("kr-93ebbe6fe34d").kind, "island");
for (const id of ["worksheet-sarhu", "kr-93ebbe6fe34d"])
  assert(getAtlasPlaceRegionIds(places.get(id), "world").includes("asia-east"));
assert(!places.get("kr-552294756bf0").aliases.includes("준천"));
assert.equal(
  reviews.find(({ place }) => place.id === "kr-c6a843e42fcc").story.startYear,
  1742,
);

for (const id of ["kr-31ee5f79f84a", "kr-be8f1454c1ad"])
  assert(
    !places.has(id),
    "Four counties / six garrisons must not become fabricated single-site markers",
  );

console.log(
  "Worksheet atlas PASS: 13 reviewed markers, historical names, era/region search, provenance, precise-location caveats and unrelated-data preservation.",
);
