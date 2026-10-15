import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import * as geo from "d3-geo";

// Run from any directory. No network, ignored files, or generated reports are
// needed: the actual app modules and committed source geometries are the input.
const root = fileURLToPath(new URL("../", import.meta.url));
const json = (name) => JSON.parse(readFileSync(resolve(root, name), "utf8"));
const plain = (value) => JSON.parse(JSON.stringify(value));
const geography = json("src/data/atlas/globe-geography.json");
function createLoader(
  fetchImpl = () => assert.fail("Unexpected network fetch"),
) {
  const cache = new Map();
  function load(filename) {
    const path = resolve(root, filename);
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
        fetch: fetchImpl,
        require(name) {
          if (name === "d3-geo") return geo;
          if (name.endsWith("?url")) return { default: name };
          assert(name.startsWith("."), `Unexpected dependency ${name}`);
          return load(resolve(dirname(path), `${name}.ts`));
        },
      },
      { filename: path },
    );
    return exports;
  }
  return load;
}

let fetchCalls = 0;
const load = createLoader(async (url) => {
  assert(url.endsWith("globe-geography.json?url"));
  fetchCalls++;
  return { ok: true, json: async () => geography };
});
const {
  historyAtlasSourceDataset: source,
  historyAtlasDataset: dataset,
  historyAtlasMapAudit: mapAudit,
} = load("src/data/historyAtlasContent.ts");
const landforms = load("src/data/historyAtlasLandformRestoration.ts");
const world = load("src/data/historyAtlasWorldRestoration.ts");
const additional = load("src/data/historyAtlasWorldRestorationAdditional.ts");
const {
  atlasEntrySubject,
  getAtlasHistoricalRelations,
  getAtlasHistoryEntries,
} = load("src/lib/historyAtlasStories.ts");
const { getAtlasPlaceRegionIds } = load("src/lib/historyAtlasRegions.ts");
const { findAtlasRiver, atlasFocusExtent } = load(
  "src/lib/historyAtlasRivers.ts",
);
const { findAtlasLandform, isAtlasLandformArea, loadAtlasLandformGeometry } =
  load("src/lib/historyAtlasLandforms.ts");
const rawPlaces = new Map(source.places.map((place) => [place.id, place]));
const mapPlaces = new Map(dataset.places.map((place) => [place.id, place]));
const mapEntries = new Map(dataset.entries.map((entry) => [entry.id, entry]));
const landformIds = new Set(
  landforms.atlasLandformHistoricalStories.flatMap((story) => story.placeIds),
);
const worldIds = new Set(
  world.atlasWorldRestoredHistoricalStories.flatMap((story) => story.placeIds),
);
const additionalIds = new Set([
  ...additional.atlasWorldAdditionalHistoricalStories.flatMap(
    (story) => story.placeIds,
  ),
  ...Object.keys(additional.atlasWorldAdditionalPlaceOverrides),
]);
// Minimums catch accidental removal from the restoration modules themselves;
// the checks below separately catch integration/curation losses at runtime.
assert(landformIds.size >= 41, "Landform restoration coverage regressed");
assert(worldIds.size >= 25, "World city restoration coverage regressed");
assert(additionalIds.size >= 39, "Additional world restoration regressed");
assert(landforms.atlasLandformHistoricalStories.length >= 38);

const validSources = (sources, context) => {
  assert(sources?.length, `No sources: ${context}`);
  for (const item of sources) {
    assert(item.title?.trim(), `Untitled source: ${context}`);
    assert.equal(new URL(item.url).protocol, "https:", context);
    if (item.license)
      assert(item.licenseUrl, `License URL missing: ${context}`);
  }
};
function verifyPlace(id, subject) {
  assert(rawPlaces.has(id), `Unknown original place ${id}`);
  const place = mapPlaces.get(id);
  assert(place, `Restored place absent from final map: ${id}`);
  assert(
    place.coordinates?.length === 2 &&
      place.coordinates.every(Number.isFinite) &&
      Math.abs(place.coordinates[0]) <= 180 &&
      Math.abs(place.coordinates[1]) <= 90,
    `Invalid map coordinate ${id}`,
  );
  assert(place.locationNote?.trim(), `Missing coordinate context ${id}`);
  assert(!["region", "country"].includes(place.kind), `Territory pin ${id}`);
  assert(
    getAtlasHistoryEntries(dataset, id, subject).length,
    `Restored place lost subject ${subject}: ${id}`,
  );
  assert(
    !getAtlasPlaceRegionIds(place, subject).includes("unclassified"),
    `Restored place absent from region filters: ${id}/${subject}`,
  );
  return place;
}

let relationCount = 0;
const stories = [
  ...landforms.atlasLandformHistoricalStories,
  ...world.atlasWorldRestoredHistoricalStories,
  ...additional.atlasWorldAdditionalHistoricalStories,
];
assert.equal(new Set(stories.map((story) => story.id)).size, stories.length);
for (const story of stories) {
  validSources(story.sources, story.id);
  assert(story.summary.trim() && story.period.trim(), story.id);
  assert(story.startYear <= (story.endYear ?? story.startYear), story.id);
  assert(
    story.eraIds.every((id) => dataset.eras.some((era) => era.id === id)),
    `Unknown era in ${story.id}`,
  );
  for (const id of story.placeIds) {
    verifyPlace(id, story.subject);
    const entry = mapEntries.get(`story-${story.id}-${id}`);
    assert(entry, `Restored event absent from final map: ${story.id}/${id}`);
    assert.equal(atlasEntrySubject(dataset, entry), story.subject);
    assert.equal(entry.summary, story.summary, `Summary lost: ${entry.id}`);
    for (const item of story.sources)
      assert(
        entry.historicalStory.sources.some((s) => s.url === item.url),
        `Historical evidence lost: ${entry.id}/${item.url}`,
      );
  }
  for (const link of story.related || []) {
    const origins = link.fromPlaceIds || story.placeIds;
    assert(
      origins.length && origins.every((id) => story.placeIds.includes(id)),
    );
    assert(
      story.placeIds.length === 1 || link.fromPlaceIds?.length,
      `Unscoped multi-place relation: ${story.id}`,
    );
    assert(link.reason.trim(), `Empty relation: ${story.id}`);
    if (link.targetEntryId) {
      const target = mapEntries.get(link.targetEntryId);
      assert.equal(target?.placeId, link.placeId, `Wrong target: ${story.id}`);
      assert.equal(atlasEntrySubject(dataset, target), story.subject);
    }
    for (const origin of origins) {
      const entry = mapEntries.get(`story-${story.id}-${origin}`);
      const relation = getAtlasHistoricalRelations(
        dataset,
        entry,
        story.subject,
      ).find(
        (item) =>
          item.entry.placeId === link.placeId &&
          (!link.targetEntryId || item.entry.id === link.targetEntryId),
      );
      assert(relation, `Runtime relation lost: ${entry.id} → ${link.placeId}`);
      assert.equal(relation.reason, link.reason);
      assert.equal(atlasEntrySubject(dataset, relation.entry), story.subject);
      for (const item of story.sources)
        assert(relation.sources.some((s) => s.url === item.url));
      relationCount++;
    }
  }
}
for (const id of [...worldIds, ...additionalIds]) verifyPlace(id, "world");

// A vague legacy era must not reappear beside the source-backed construction
// history. Preserve the original evidence dataset and the actual mapped place.
for (const [placeId, legacyEntryId, storyId] of [
  [
    "world-940724b5425a",
    "world-exp-world-940724b5425a-1",
    "additional-world-940724b5425a",
  ],
  [
    "world-9e8d217233bd",
    "world-exp-world-9e8d217233bd-5",
    "additional-world-9e8d217233bd",
  ],
  ["world-231991299b29", "world-exp-world-231991299b29-1", "world-borobudur"],
  ["world-119cdcf6ee4c", "world-exp-world-119cdcf6ee4c-5", "world-athens"],
]) {
  verifyPlace(placeId, "world");
  assert(
    source.entries.some((entry) => entry.id === legacyEntryId),
    `Original evidence removed: ${legacyEntryId}`,
  );
  assert(
    !mapEntries.has(legacyEntryId),
    `Duplicate era restored: ${legacyEntryId}`,
  );
  const history = getAtlasHistoryEntries(dataset, placeId, "world");
  assert(!history.some((entry) => entry.id === legacyEntryId));
  assert(
    history.some((entry) => entry.id === `story-${storyId}-${placeId}`),
    `Detailed historical story removed: ${storyId}/${placeId}`,
  );
}

function verifyOverrides(overrides, evidence, subject) {
  for (const [id, override] of Object.entries(overrides)) {
    const place = mapPlaces.get(id);
    assert(place, `Unapplied override ${id}`);
    for (const [key, value] of Object.entries(override))
      assert.deepEqual(plain(place[key]), plain(value), `${id}.${key}`);
    validSources(evidence[id], `location ${id}`);
    const entries = getAtlasHistoryEntries(dataset, id, subject);
    assert(entries.length, `No event for location evidence ${id}`);
    for (const entry of entries.filter((item) => item.historicalStory))
      for (const item of evidence[id])
        assert(
          entry.historicalStory.sources.some((s) => s.url === item.url),
          `Location evidence lost: ${entry.id}/${item.url}`,
        );
  }
}
verifyOverrides(
  additional.atlasWorldAdditionalPlaceOverrides,
  additional.atlasWorldAdditionalLocationEvidence,
  "world",
);
for (const [id, override] of Object.entries(
  landforms.atlasLandformPlaceOverrides,
)) {
  const subject = landforms.atlasLandformHistoricalStories.find((story) =>
    story.placeIds.includes(id),
  ).subject;
  verifyOverrides(
    { [id]: override },
    landforms.atlasLandformLocationEvidence,
    subject,
  );
}
// Evidence-only entries also explain alternate upper-course river names.
for (const [id, evidence] of Object.entries(
  landforms.atlasLandformLocationEvidence,
)) {
  validSources(evidence, `landform location ${id}`);
  const entries = dataset.entries.filter(
    (entry) => entry.placeId === id && entry.historicalStory,
  );
  assert(entries.length, `Location evidence has no map event ${id}`);
  for (const entry of entries)
    for (const item of evidence)
      assert(entry.historicalStory.sources.some((s) => s.url === item.url));
}
assert.equal(
  getAtlasHistoryEntries(dataset, "kr-fe954fbe1cc0", "korea").length,
  0,
  "Gobi's original kr ID must not copy its world account into Korean history",
);

function parseDms(text) {
  const match = /^([NS])(\d+) (\d+) ([\d.]+) ([EW])(\d+) (\d+) ([\d.]+)$/.exec(
    text,
  );
  assert(match, `Invalid DMS reference: ${text}`);
  const [, latSign, latD, latM, latS, lonSign, lonD, lonM, lonS] = match;
  // Some published UNESCO values contain 60 seconds; arithmetic carries it.
  assert([latM, lonM].every((value) => +value < 60));
  assert([latS, lonS].every((value) => +value <= 60));
  return [
    (+lonD + +lonM / 60 + +lonS / 3600) * (lonSign === "W" ? -1 : 1),
    (+latD + +latM / 60 + +latS / 3600) * (latSign === "S" ? -1 : 1),
  ];
}
const coordinateAudit = additional.atlasWorldAdditionalCoordinateAudit;
assert(
  Object.keys(coordinateAudit).length >= 21,
  "DMS audit coverage regressed",
);
for (const [id, reference] of Object.entries(coordinateAudit)) {
  const expected = parseDms(reference.coordinateDms);
  const actual = mapPlaces.get(id)?.coordinates;
  assert(actual, `DMS place absent from map: ${id}`);
  expected.forEach((value, index) =>
    assert(Math.abs(actual[index] - value) < 1e-8, `DMS conversion ${id}`),
  );
  assert(
    additional.atlasWorldAdditionalLocationEvidence[id].some((item) =>
      item.url.includes(`/list/${reference.unescoId}/`),
    ),
    `DMS reference lost: ${id}`,
  );
}

const supplement = json("src/data/atlas/rivers-supplement.json");
const worldRivers = json("src/data/atlas/rivers-world.json");
const allRivers = {
  type: "FeatureCollection",
  features: [...worldRivers.features, ...supplement.features],
};
const containsBounds = (focus, bounds) =>
  focus[0] <= bounds[0][0] &&
  focus[1] <= bounds[0][1] &&
  focus[2] >= bounds[1][0] &&
  focus[3] >= bounds[1][1];
const riverResults = [];
for (const scope of ["korea", "world"]) {
  const geometry = json(`src/data/atlas/rivers-${scope}.json`);
  const place = mapPlaces.get("world-87d1fde40816");
  const river = findAtlasRiver(place, geometry);
  assert.equal(
    river.features.length,
    3,
    `${scope}: upper Huang course missing`,
  );
  const bounds = geo.geoBounds(river);
  assert(bounds[0][0] < 97 && bounds[1][0] > 119 && bounds[1][1] > 40);
  assert(containsBounds(atlasFocusExtent(place, "world", river), bounds));
  assert(
    river.features.every((feature) => geometry.features.includes(feature)),
  );
  if (scope === "korea")
    assert.deepEqual(
      [
        ...new Set(
          river.features.map((feature) => feature.properties.rivernum),
        ),
      ].sort(),
      [66, 95],
    );
  riverResults.push({ name: place.name, scope, bounds });
}
for (const id of landformIds) {
  const place = mapPlaces.get(id);
  if (place.kind !== "water" || !/강$/u.test(place.name)) continue;
  const river = findAtlasRiver(place, allRivers);
  assert(river?.features.length, `No selectable river line: ${place.name}`);
  assert(
    river.features.every((feature) => allRivers.features.includes(feature)),
  );
  riverResults.push({ id, name: place.name, bounds: geo.geoBounds(river) });
}
for (const [id, expectedNames] of [
  ["world-5ca1981dec6b", ["Tongtian", "Jinsha", "Chang Jiang", "Yangtze"]],
  ["world-198ae4b466bd", ["Tigris", "Dicle"]],
  ["world-69e57f3ecae9", ["Euphrates", "Firat"]],
]) {
  const river = findAtlasRiver(mapPlaces.get(id), allRivers);
  for (const name of expectedNames)
    assert(river.features.some((feature) => feature.properties.name === name));
}
for (const [id, name, way] of [
  ["kr-b92374007291", "금강", 34834591],
  ["world-0f91877cb13d", "가르강", 65981268],
]) {
  const point = mapPlaces.get(id).coordinates;
  const feature = supplement.features.find(
    (item) => item.properties.name === name,
  );
  const part =
    feature.geometry.coordinates[feature.properties.osmWayIds.indexOf(way)];
  assert(
    part.some(([x, y]) => x === point[0] && y === point[1]),
    `${name}: invented point`,
  );
}

const pendingGeometry = loadAtlasLandformGeometry();
assert.equal(
  pendingGeometry,
  loadAtlasLandformGeometry(),
  "Concurrent cache missed",
);
const flatGeometry = await pendingGeometry;
assert.equal(flatGeometry, await loadAtlasLandformGeometry());
assert.equal(fetchCalls, 1);
for (const [id, indexes, outside] of [
  ["kr-fe954fbe1cc0", [0], [0, 0]],
  ["world-9e21644b4935", [1, 2], [106, 43]],
]) {
  const place = mapPlaces.get(id);
  assert.equal(place.kind, "desert");
  assert(isAtlasLandformArea(place));
  const shape = findAtlasLandform(place, geography);
  assert(shape, `Desert polygon missing ${id}`);
  assert.deepEqual(
    plain(shape.features[0].geometry.coordinates),
    indexes.map((index) => geography.deserts.coordinates[index]),
    `Desert source parts changed ${id}`,
  );
  assert.deepEqual(plain(shape), plain(findAtlasLandform(place, flatGeometry)));
  assert(geo.geoContains(shape, place.coordinates));
  assert(!geo.geoContains(shape, outside), `Inverted desert winding ${id}`);
  assert(
    containsBounds(
      atlasFocusExtent(place, "world", shape),
      geo.geoBounds(shape),
    ),
  );
  assert.equal(
    findAtlasLandform(place, {
      deserts: { type: "MultiPolygon", coordinates: [] },
    }),
    null,
  );
}
assert.equal(isAtlasLandformArea(mapPlaces.get("world-87d1fde40816")), false);
assert.equal(
  findAtlasLandform(mapPlaces.get("world-87d1fde40816"), geography),
  null,
);
let retries = 0;
const retryLoader = createLoader(async () => {
  retries++;
  if (retries === 1) return { ok: false };
  if (retries === 2) return { ok: true, json: async () => ({ deserts: null }) };
  return { ok: true, json: async () => geography };
})("src/lib/historyAtlasLandforms.ts").loadAtlasLandformGeometry;
await assert.rejects(retryLoader(), /불러오지 못했다/u);
await assert.rejects(retryLoader(), /형식이 올바르지 않다/u);
await retryLoader();
assert.equal(retries, 3, "Failed fetch must not poison the loader cache");

for (const [asset, manifest, hashField] of [
  ["globe-geography.json", "globe-geography-source.json", "assetSha256"],
  ["rivers-supplement.json", "rivers-supplement.sources.json", "sha256"],
]) {
  const metadata = json(`src/data/atlas/${manifest}`);
  assert(
    metadata.license && metadata.licenseUrl,
    `Unlicensed geometry ${asset}`,
  );
  const actual = createHash("sha256")
    .update(readFileSync(resolve(root, `src/data/atlas/${asset}`)))
    .digest("hex");
  assert.equal(
    actual,
    metadata[hashField],
    `Geometry provenance mismatch ${asset}`,
  );
}

const auditById = new Map(mapAudit.map((item) => [item.placeId, item]));
const terrainAudit = source.places
  .filter(
    (place) =>
      ["water", "mountain"].includes(place.kind) || /사막/u.test(place.name),
  )
  .map((original) => {
    const place = mapPlaces.get(original.id);
    const audit = auditById.get(original.id);
    let status;
    if (place)
      status = landformIds.has(place.id)
        ? "restored-landform"
        : "included-other";
    else if (/사막/u.test(original.name)) status = "needs-source-area-geometry";
    else if (audit.reasons.includes("unverified-location"))
      status = "needs-source-location";
    else status = "needs-individual-historical-review";
    return {
      id: original.id,
      name: place?.name || original.name,
      status,
      reasons: audit.reasons,
    };
  });
const counts = Object.fromEntries(
  [...new Set(terrainAudit.map((item) => item.status))].map((status) => [
    status,
    terrainAudit.filter((item) => item.status === status).length,
  ]),
);
const result = {
  landformPlaces: landformIds.size,
  landformStories: landforms.atlasLandformHistoricalStories.length,
  worldPlaces: worldIds.size,
  additionalWorldPlaces: additionalIds.size,
  dmsCoordinates: Object.keys(coordinateAudit).length,
  preservedRelations: relationCount,
  mapPlaces: dataset.places.length,
  terrainCounts: counts,
  riverResults,
  terrainAudit,
};
if (process.argv.includes("--report"))
  console.log(JSON.stringify(result, null, 2));
else
  console.log(
    `PASS atlas restoration: ${landformIds.size} landforms, ${worldIds.size}+${additionalIds.size} world places, ${result.dmsCoordinates} DMS coordinates, ${relationCount} scoped runtime links; river source segments, desert parts, focus, caching and retry verified.`,
  );
