import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    { exports, require: (name) => load(resolve(dirname(path), `${name}.ts`)) },
    { filename: path },
  );
  return exports;
}

const {
  historyAtlasSourceDataset: source,
  historyAtlasDataset: dataset,
  historyAtlasMapAudit: audit,
} = load("src/data/historyAtlasContent.ts");
const {
  atlasKoreaRestoredPlaceOverrides: overrides,
  atlasKoreaRestoredLocationEvidence: evidence,
  atlasKoreaRestoredHistoricalStories: stories,
  atlasKoreaRestoredStoryRelations: relations,
  atlasKoreaRestoredRegionOverrides: regions,
} = load("src/data/historyAtlasKoreaRestoration.ts");
const {
  atlasEntrySubject,
  getAtlasHistoricalRelations,
  getAtlasHistoryEntries,
} = load("src/lib/historyAtlasStories.ts");
const { getAtlasPlaceRegionIds } = load("src/lib/historyAtlasRegions.ts");
const rawPlaces = new Map(source.places.map((p) => [p.id, p]));
const mapPlaces = new Map(dataset.places.map((p) => [p.id, p]));
const rawEntries = new Map(source.entries.map((e) => [e.id, e]));
const mapEntries = new Map(dataset.entries.map((e) => [e.id, e]));
const koreaIds = new Set(
  source.entries
    .filter((e) => atlasEntrySubject(source, e) === "korea")
    .map((e) => e.placeId),
);
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const validPoint = (p) =>
  p?.coordinates?.length === 2 &&
  p.coordinates.every(Number.isFinite) &&
  p.coordinates[0] >= 120 &&
  p.coordinates[0] < 140 &&
  p.coordinates[1] >= 30 &&
  p.coordinates[1] < 50;

for (const [id, value] of Object.entries(overrides)) {
  check(rawPlaces.has(id), `Unknown source place ${id}`);
  check(koreaIds.has(id), `Restored place outside Korean subject ${id}`);
  check(validPoint(value), `Invalid Korean-region coordinate ${id}`);
  check(
    evidence[id]?.url.startsWith("https://") &&
      evidence[id]?.coordinateUrl.startsWith("https://"),
    `Missing historical/location evidence ${id}`,
  );
  check(
    value.locationNote?.length > 20 &&
      !/위치 확인 필요/.test(value.locationNote),
    `Unresolved note ${id}`,
  );
  check(
    !["country", "region"].includes(value.kind),
    `Territorial entity restored ${id}`,
  );
  check(mapPlaces.has(id), `Verified restored place omitted from map ${id}`);
  if (mapPlaces.has(id))
    check(
      JSON.stringify(mapPlaces.get(id).coordinates) ===
        JSON.stringify(value.coordinates),
      `Override missing ${id}`,
    );
  check(
    rawPlaces.get(id)?.coordinates === null,
    `Original null-coordinate ledger was mutated ${id}`,
  );
}

const uniqueStories = new Set();
for (const story of stories) {
  check(!uniqueStories.has(story.id), `Duplicate story ${story.id}`);
  uniqueStories.add(story.id);
  check(story.subject === "korea", `Restoration leaked to world ${story.id}`);
  check(
    story.sources.length > 0 &&
      story.sources.every((s) => s.title && /^https:\/\//.test(s.url)),
    `Unreferenced story ${story.id}`,
  );
  check(
    !/(?:습니다|입니다)[.!?]?(?:\s|$)/u.test(story.summary),
    `Honorific educational prose ${story.id}`,
  );
  check(
    story.startYear <= (story.endYear ?? story.startYear),
    `Reversed dates ${story.id}`,
  );
  for (const pid of story.placeIds) {
    const id = `story-${story.id}-${pid}`;
    check(
      rawEntries.has(id) && mapEntries.has(id),
      `Restored event unavailable ${id}`,
    );
    check(mapPlaces.has(pid), `Restored story lacks a point ${id}`);
    check(
      story.eraIds.every((era) => dataset.eras.some((e) => e.id === era)),
      `Unknown story era ${id}`,
    );
  }
}

const verifyRelations = (storyId, links, placeIds) => {
  for (const link of links) {
    check(
      !!link.targetEntryId,
      `Ambiguous target event ${storyId} → ${link.placeId}`,
    );
    const target = mapEntries.get(link.targetEntryId);
    check(
      target?.placeId === link.placeId,
      `Missing/wrong relation target ${storyId} → ${link.targetEntryId}`,
    );
    check(
      target && atlasEntrySubject(dataset, target) === "korea",
      `Relation crossed subjects ${storyId}`,
    );
    const origins = link.fromPlaceIds || placeIds;
    check(
      placeIds.length === 1 || !!link.fromPlaceIds?.length,
      `Multi-place relation lacks origin restriction ${storyId}`,
    );
    for (const pid of origins) {
      const entry = mapEntries.get(`story-${storyId}-${pid}`);
      if (!entry) continue;
      const actual = getAtlasHistoricalRelations(dataset, entry, "korea");
      check(
        actual.some(
          (r) =>
            r.entry.placeId === link.placeId &&
            r.entry.id === link.targetEntryId,
        ),
        `Runtime relation missing ${storyId}/${pid} → ${link.targetEntryId}`,
      );
    }
  }
};
for (const story of stories)
  verifyRelations(story.id, story.related || [], story.placeIds);
for (const [id, links] of Object.entries(relations)) {
  const original = source.entries.find(
    (e) => e.historicalStory?.id === id,
  )?.historicalStory;
  check(!!original, `Unknown patched story ${id}`);
  if (original) verifyRelations(id, links, original.placeIds);
}
for (const [pid, expected] of Object.entries(regions)) {
  const place = mapPlaces.get(pid);
  check(!!place, `Region override has no map place ${pid}`);
  if (place)
    check(
      expected.every((r) => getAtlasPlaceRegionIds(place, "korea").includes(r)),
      `Province override not applied ${pid}`,
    );
}

const capitals = [
  "sanggyeong",
  "kr-8ced6b94e17d",
  "kr-46ab0f59d5f6",
  "kr-c27023f3c34a",
  "kr-0a314eeac193",
];
for (const id of capitals) {
  check(mapPlaces.has(id), `Balhae capital missing ${id}`);
  check(
    dataset.entries.some(
      (e) => e.placeId === id && e.eraIds?.includes("k-balhae"),
    ),
    `Balhae event missing ${id}`,
  );
}
check(
  /근사 위치/.test(mapPlaces.get("kr-0a314eeac193")?.locationNote || ""),
  "Western capital must disclose locality approximation",
);
check(
  /다른 견해/.test(mapPlaces.get("kr-c27023f3c34a")?.locationNote || ""),
  "Southern capital must disclose disputed identification",
);
check(
  mapPlaces.get("andong")?.name === "안동",
  "Modern/historic Andong must retain Andong as canonical name",
);
check(
  getAtlasHistoryEntries(dataset, "andong", "korea").some((e) =>
    /고창/.test(e.summary + e.title + e.displayName),
  ),
  "Andong must retain Gochang historical context",
);
for (const id of [
  "kr-8081f9dbac47",
  "kr-a34472ffacdf",
  "kr-f8f6a36df2ea",
  "kr-361994b9d007",
  "kr-12ea9225d065",
  "kr-8ae30bc3162c",
  "kr-3c130d976834",
  "kr-70cb5c37802b",
  "kr-a14b0e8e27dd",
]) {
  check(mapPlaces.has(id), `Imjin-war location missing ${id}`);
}
for (const id of [
  "kr-bf2885ef0119",
  "kr-5683eab0b727",
  "kr-b11ce9919656",
  "kr-b2f29b34ea03",
]) {
  check(
    !overrides[id],
    `False same-name/moved/zero-coordinate match restored ${id}`,
  );
}

const displayedKoreaIds = new Set(
  dataset.entries
    .filter((entry) => atlasEntrySubject(dataset, entry) === "korea")
    .map((entry) => entry.placeId),
);
const included = dataset.places.filter((p) => displayedKoreaIds.has(p.id));
const retained = included.map((p) => ({
  id: p.id,
  name: p.name,
  coordinates: p.coordinates,
  regions: getAtlasPlaceRegionIds(p, "korea"),
}));
const excluded = audit.filter((p) => koreaIds.has(p.placeId) && !p.included);
const provinceCounts = {};
for (const p of retained)
  for (const region of p.regions)
    provinceCounts[region] = (provinceCounts[region] || 0) + 1;
mkdirSync("output", { recursive: true });
writeFileSync(
  "output/history-atlas-korea-restoration-audit.json",
  JSON.stringify(
    {
      sourceKoreanPlaceCount: koreaIds.size,
      restoredCoordinateCount: Object.keys(overrides).length,
      newStoryCount: stories.length,
      newRelationCount:
        stories.reduce((n, s) => n + (s.related?.length || 0), 0) +
        Object.values(relations).reduce((n, r) => n + r.length, 0),
      includedKoreanPlaces: included.length,
      provinceCounts,
      restoredPlaces: Object.entries(overrides).map(([id, p]) => ({
        id,
        name: mapPlaces.get(id)?.name || p.name,
        coordinates: p.coordinates,
        evidence: evidence[id],
      })),
      retained,
      excluded,
      falseMatchesRejected: [
        { id: "kr-bf2885ef0119", reason: "고구려 신성과 경주 남산신성을 구별" },
        { id: "kr-5683eab0b727", reason: "고려 나성과 백제 부여 나성을 구별" },
        {
          id: "kr-b11ce9919656",
          reason:
            "경천사지 석탑의 현재 박물관 좌표를 원래 절터에 대입하지 않음",
        },
        { id: "kr-b2f29b34ea03", reason: "공식 API의 0,0 좌표 사용 금지" },
      ],
      limitations: [
        "전체 원본 PDF를 이번 작업에서 재열람하지 않았으며, 보존된 전 페이지 대조 장부와 공식 유산·학술 자료를 사용했다.",
        "서경은 린장 일대 근사 위치이며, 남경의 청해토성 비정은 다른 견해가 존재한다.",
        "등록 좌표는 유적 대표점이며 성곽 전체·행정구역·전투 범위를 복원한 경계가 아니다.",
      ],
      failures,
    },
    null,
    2,
  ),
);
assert.equal(failures.length, 0, failures.join("\n"));
console.log(
  `Korean restoration PASS: ${Object.keys(overrides).length} locations, ${stories.length} stories; ${included.length} Korean map places.`,
);
