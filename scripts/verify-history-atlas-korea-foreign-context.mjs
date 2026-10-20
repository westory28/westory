import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

function createLoader(withContext = true) {
  const cache = new Map();
  function load(filename) {
    const path = resolve(filename);
    if (cache.has(path)) return cache.get(path);
    if (!withContext && path.endsWith("historyAtlasKoreaForeignContext.ts"))
      return {
        atlasKoreaForeignContextPlaceUpdates: [],
        atlasKoreaForeignContextStories: [],
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
  historyAtlasSourceDataset: source,
  historyAtlasDataset: dataset,
  historyAtlasMapAudit: audit,
} = load("src/data/historyAtlasContent.ts");
const baseline = createLoader(false)(
  "src/data/historyAtlasContent.ts",
).historyAtlasDataset;
const { atlasKoreaForeignContextStories: stories } = load(
  "src/data/historyAtlasKoreaForeignContext.ts",
);
const { matchesAtlasSearch } = load("src/lib/historyAtlas.ts");
const { getAtlasPlaceRegionIds } = load("src/lib/historyAtlasRegions.ts");
const {
  atlasEntrySubject,
  getAtlasHistoryEntries,
  getAtlasHistoricalRelations,
} = load("src/lib/historyAtlasStories.ts");
const places = new Map(dataset.places.map((place) => [place.id, place]));
const entries = new Map(dataset.entries.map((entry) => [entry.id, entry]));
const contextIds = ["kr-23f8483f8d47", "kr-ed074edaab7c", "beijing", "tokyo"];
const koreanPlaceIds = (data) =>
  new Set(
    data.entries
      .filter(
        (entry) =>
          !entry.geographicReference &&
          atlasEntrySubject(data, entry) === "korea",
      )
      .map((entry) => entry.placeId),
  );
const baselineKoreanIds = koreanPlaceIds(baseline);
assert.deepEqual(
  [...koreanPlaceIds(dataset)]
    .filter((id) => !baselineKoreanIds.has(id))
    .sort(),
  [...contextIds].sort(),
  "Only four evidenced places gain Korean historical accounts",
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
for (const id of contextIds) {
  const place = places.get(id);
  assert(
    place?.coordinates?.every(Number.isFinite),
    `${id}: existing verified point`,
  );
  assert(
    audit.find((item) => item.placeId === id)?.included,
    `${id}: map inclusion`,
  );
  assert(getAtlasPlaceRegionIds(place, "korea").includes("outside-korea"));
  assert(getAtlasHistoryEntries(dataset, id, "korea").length > 0);
}
assert.equal(stories.length, 5);
for (const story of stories) {
  assert.equal(story.subject, "korea");
  assert(
    story.sources.some((item) =>
      /history\.go\.kr|encykorea\.aks\.ac\.kr/u.test(item.url),
    ),
  );
  assert(story.startYear <= (story.endYear ?? story.startYear));
  assert(!/지도·자료에 등장/u.test(story.summary));
  for (const id of story.placeIds) {
    const entry = entries.get(`story-${story.id}-${id}`);
    assert(
      entry?.historicalStory,
      `${story.id}: clickable sourced explanation`,
    );
    assert.equal(atlasEntrySubject(dataset, entry), "korea");
    for (const era of story.eraIds)
      assert(dataset.eras.some((item) => item.id === era));
    assert(
      matchesAtlasSearch(entry, places.get(id), story.displayNames[id]),
      `${story.id}: historical-name search`,
    );
    for (const link of story.related || [])
      assert(
        getAtlasHistoricalRelations(dataset, entry, "korea").some(
          (relation) => relation.entry.id === link.targetEntryId,
        ),
        `${story.id}: exact related event survives subject curation`,
      );
  }
}
const edo = entries.get("story-korea-edo-tongsinsa-tokyo");
const tokyo = entries.get("story-korea-tokyo-february-eighth-tokyo");
const shenyang = entries.get("story-korea-shenyang-sohyeon-kr-ed074edaab7c");
const beijing = entries.get("story-korea-beijing-sohyeon-beijing");
assert.equal(edo.displayName, "에도");
assert.equal(tokyo.displayName, "도쿄");
assert(
  edo.eraIds.includes("k-joseon-late") && !edo.eraIds.includes("k-colonial"),
);
assert(
  tokyo.eraIds.includes("k-colonial") &&
    !tokyo.eraIds.includes("k-joseon-late"),
);
assert(
  stories
    .filter((story) => story.placeIds.includes("tokyo"))
    .every((story) => story.startYear > 1598),
);
assert(matchesAtlasSearch(shenyang, places.get(shenyang.placeId), "선양"));
assert(matchesAtlasSearch(beijing, places.get(beijing.placeId), "베이징"));
assert(matchesAtlasSearch(edo, places.get("tokyo"), "도쿄"));

for (const [from, to] of [
  ["story-korea-namhansanseong-namhansanseong", shenyang.id],
  ["story-korea-march-first-seoul", tokyo.id],
])
  assert(
    getAtlasHistoricalRelations(dataset, entries.get(from), "korea").some(
      (relation) => relation.entry.id === to,
    ),
    `${from}: domestic account reaches the correct foreign event`,
  );
assert(
  !getAtlasHistoricalRelations(
    dataset,
    entries.get("story-korea-march-first-kr-617d98ea0194"),
    "korea",
  ).some((relation) => relation.entry.id === tokyo.id),
  "The city-level Tokyo relation is not copied to every Seoul monument",
);
for (const id of [
  "kr-entry-975fb7627e3b",
  "kr-entry-21c9d500c208",
  "kr-entry-fdc87207a019",
])
  assert(
    source.entries
      .find((entry) => entry.id === id)
      ?.summary.includes("지도·자료에 등장한다"),
    `${id}: original source ledger remains a caption`,
  );
console.log(
  "Korean foreign context PASS: four places, five sourced accounts, exact event links, search and era/region separation.",
);
