import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as d3 from "d3-geo";

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
      require: (name) =>
        name === "d3-geo"
          ? d3
          : name.endsWith("?url")
            ? { default: name }
            : load(resolve(dirname(path), `${name}.ts`)),
    },
    { filename: path },
  );
  return exports;
}
const { historyAtlasDataset: dataset } = load(
  "src/data/historyAtlasContent.ts",
);
const { atlasEastAsiaReferences: references } = load(
  "src/data/historyAtlasEastAsia.ts",
);
const { matchesAtlasSearch, matchesAtlasTemporalScope } = load(
  "src/lib/historyAtlas.ts",
);
const { getAtlasPlaceProfile } = load("src/lib/historyAtlasProfiles.ts");
const { getAtlasHistoryEntries } = load("src/lib/historyAtlasStories.ts");
const { findAtlasRiver } = load("src/lib/historyAtlasRivers.ts");
const { findAtlasReferenceTerrain } = load("src/lib/historyAtlasTerrain.ts");
const terrain = JSON.parse(readFileSync("src/data/atlas/terrain.json", "utf8"));
const places = new Map(dataset.places.map((place) => [place.id, place]));
const units = new Map(dataset.units.map((unit) => [unit.id, unit]));
const required = [
  "요동",
  "요서",
  "요하",
  "만주",
  "간도",
  "연해주",
  "오르도스",
  "화북",
  "중원",
  "강남",
  "화중",
  "화남",
  "서남",
  "요동 반도",
  "산둥 반도",
  "고비 사막",
  "타클라마칸 사막",
  "티베트 고원",
  "쑹화강",
  "회수",
  "황하",
  "장강",
  "압록강",
  "두만강",
  "규슈",
  "카라코룸",
  "하얼빈",
  "창춘",
  "베이징",
  "평성",
  "업",
  "뤄양",
  "시안",
  "허창",
  "카이펑",
  "쉬저우",
  "난징",
  "상하이",
  "임안",
  "장링",
  "광저우",
];
for (const subject of ["korea", "world"]) {
  for (const name of required) {
    const matches = dataset.entries.filter(
      (entry) =>
        entry.geographicReference &&
        units.get(entry.unitId).subject === subject &&
        matchesAtlasSearch(entry, places.get(entry.placeId), name),
    );
    assert(matches.length, `${subject}: missing geographic reference ${name}`);
    assert(
      matches.every((entry) =>
        matchesAtlasTemporalScope(entry, "any-unit", "any-era"),
      ),
    );
  }
}
for (const reference of references) {
  const place = places.get(reference.place.id);
  assert(place, `Missing map place ${reference.place.id}`);
  const [west, south, east, north] = reference.evidenceBounds;
  const [lon, lat] = place.coordinates;
  assert(west < east && south < north);
  assert(
    lon >= west && lon <= east && lat >= south && lat <= north,
    `${place.name}: outside reviewed envelope`,
  );
  assert(
    place.locationNote?.length > 15,
    `${place.name}: missing coordinate explanation`,
  );
  assert(reference.sources.length >= 1, `${place.name}: missing provenance`);
  for (const source of reference.sources)
    assert(
      source.title && new URL(source.url).protocol === "https:",
      place.name,
    );
  const profile = getAtlasPlaceProfile(place);
  assert.equal(profile.quality, "verified");
  assert(profile.definition.length > 20);
  // A geography reference must never manufacture a dated event or era chip.
  const histories = getAtlasHistoryEntries(dataset, place.id);
  assert(
    histories.every((entry) => !entry.geographicReference),
    place.name,
  );
  const entries = dataset.entries.filter(
    (entry) => entry.placeId === place.id && entry.geographicReference,
  );
  assert.equal(entries.length, 2, `${place.name}: one reference per subject`);
  for (const entry of entries) {
    assert.equal(entry.historicalStory, undefined);
    assert.equal(entry.eraIds.length, 0);
  }
  if (reference.terrainId) {
    const feature = terrain.features.find(
      (item) => item.properties.id === reference.terrainId,
    );
    assert(
      feature && d3.geoContains(feature, place.coordinates),
      `${place.name}: representative point outside source terrain`,
    );
    assert(
      findAtlasReferenceTerrain(place, terrain),
      `${place.name}: missing source terrain selection`,
    );
  }
}
const riverIds = new Set();
for (const subject of ["korea", "world"]) {
  const rivers = JSON.parse(
    readFileSync(`src/data/atlas/rivers-${subject}.json`, "utf8"),
  );
  rivers.features.push(
    ...JSON.parse(readFileSync("src/data/atlas/rivers-supplement.json", "utf8"))
      .features,
  );
  for (const reference of references.filter(
    ({ place }) => place.kind === "water",
  )) {
    const river = findAtlasRiver(places.get(reference.place.id), rivers);
    assert(
      river?.features.length,
      `${subject}: ${reference.place.name} must use actual river geometry`,
    );
    if (reference.place.name === "랴오허강") {
      assert(
        river.features.every(
          (feature) => feature.properties.source === "OpenStreetMap",
        ),
        "Do not select the NE Liao line ending at Yingkou",
      );
      const ends = river.features.flatMap((feature) =>
        feature.geometry.coordinates.map((line) => line.at(-1)),
      );
      assert(
        ends.some(
          ([lon, lat]) => lon > 121.7 && lon < 121.95 && lat > 40.7 && lat < 41,
        ),
        "Modern Liao must reach the Panjin/Shuangtaizi estuary",
      );
      assert(
        !ends.some(([lon, lat]) => lon > 122.1 && lon < 122.3 && lat < 40.8),
        "Daliao/Yingkou is a separate outlet",
      );
    }
    riverIds.add(reference.place.id);
    const point = reference.place.coordinates;
    const nearest = Math.min(
      ...river.features.flatMap((feature) =>
        (feature.geometry.type === "LineString"
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates
        ).flatMap((line) =>
          line.map((vertex) => d3.geoDistance(point, vertex)),
        ),
      ),
    );
    assert(
      nearest * 6371 < 15,
      `${reference.place.name}: label is not on its river (${nearest * 6371} km)`,
    );
  }
}
// Independent geographic relationships, so swapped longitudes and accidental
// river/region substitutions cannot pass only by matching their own metadata.
const named = (name) =>
  references.find(({ place }) => place.name === name)?.place;
assert(named("요서").coordinates[0] < 122);
assert(named("요동").coordinates[0] > 123);
assert(named("간도").coordinates[0] > 127 && named("간도").coordinates[1] > 42);
assert(named("강남").coordinates[0] > 118 && named("강남").coordinates[1] < 32);
assert(named("중원").coordinates[0] < 115 && named("중원").coordinates[1] > 33);
assert(named("화남").coordinates[1] < named("화중").coordinates[1]);
assert(
  !places.has("kr-8b12d94c5688"),
  "Unreviewed political names must stay excluded",
);
console.log(
  `East Asia verified: ${references.length} shared geographic references, ${riverIds.size} real rivers, source terrain and era-independent discovery.`,
);
