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
    {
      exports,
      require(name) {
        assert(name.startsWith("."), `Unexpected dependency ${name}`);
        return load(resolve(dirname(path), `${name}.ts`));
      },
    },
    { filename: path },
  );
  return exports;
}

const {
  historyAtlasSourceDataset: source,
  historyAtlasDataset: dataset,
  historyAtlasMapAudit: audit,
} = load("src/data/historyAtlasContent.ts");
const { buildAtlasMapDataset } = load("src/lib/historyAtlasMapDataset.ts");
const {
  atlasEntrySubject,
  getAtlasHistoricalRelations,
  getAtlasHistoricalSummary,
  getAtlasHistoryEntries,
} = load("src/lib/historyAtlasStories.ts");
const { matchesAtlasSearch } = load("src/lib/historyAtlas.ts");
const { getAtlasPlaceKindLabel, getAtlasPlaceProfile } = load(
  "src/lib/historyAtlasProfiles.ts",
);
const {
  ATLAS_DOKDO_ID,
  ATLAS_DOKDO_COORDINATES,
  ATLAS_DOKDO_LABEL,
  ATLAS_DOKDO_LOCATION_SOURCE,
} = load("src/data/historyAtlasDokdo.ts");
const { ATLAS_KOREA_PROVINCES, matchesAtlasRegion } = load(
  "src/lib/historyAtlasRegions.ts",
);
const {
  ATLAS_CHEORWON_ID,
  ATLAS_GWIJU_ID,
  ATLAS_TAEBONG_EVENT_ID,
  atlasMapExcludedRelationTargets,
} = load("src/data/historyAtlasMapCuration.ts");
const excludedRelationReasons = new Set(
  source.entries.flatMap((entry) =>
    (entry.historicalStory?.related || [])
      .filter((link) =>
        atlasMapExcludedRelationTargets[entry.historicalStory.id]?.includes(
          link.placeId,
        ),
      )
      .map((link) => link.reason),
  ),
);
const places = new Map(dataset.places.map((place) => [place.id, place]));
const entries = new Map(dataset.entries.map((entry) => [entry.id, entry]));
const finitePoint = (place) =>
  place?.coordinates?.length === 2 &&
  place.coordinates.every(Number.isFinite) &&
  Math.abs(place.coordinates[0]) <= 180 &&
  Math.abs(place.coordinates[1]) <= 90;
assert.equal(places.size, dataset.places.length);
assert.equal(entries.size, dataset.entries.length);
assert.equal(
  audit.length,
  source.places.length,
  "Every source place is audited",
);
assert.equal(new Set(audit.map((row) => row.placeId)).size, audit.length);
assert(source.places.length >= 2500, "The full source ledger must survive");
assert(dataset.places.length >= 100 && dataset.places.length < 500);
assert(dataset.entries.length < source.entries.length / 2);
for (const place of dataset.places) {
  assert(finitePoint(place), `${place.id}: unclickable map place`);
  assert(place.locationNote?.trim(), `${place.id}: no coordinate provenance`);
  assert(!["country", "region"].includes(place.kind), place.id);
  assert(
    !/연구소|박물관|미술관|고속\s*(?:도로|국도)/u.test(place.name),
    place.name,
  );
  assert(
    dataset.entries.some((entry) => entry.placeId === place.id),
    place.id,
  );
}
let relationCount = 0;
for (const entry of dataset.entries) {
  assert(
    finitePoint(places.get(entry.placeId)),
    `${entry.id}: missing location`,
  );
  assert(getAtlasHistoricalSummary(entry).trim(), `${entry.id}: caption only`);
  const subject = atlasEntrySubject(dataset, entry);
  assert(["korea", "world"].includes(subject), entry.id);
  for (const related of getAtlasHistoricalRelations(dataset, entry, subject)) {
    relationCount++;
    assert(entries.has(related.entry.id), `${entry.id}: dangling relation`);
    assert(finitePoint(places.get(related.entry.placeId)), entry.id);
    assert.equal(atlasEntrySubject(dataset, related.entry), subject, entry.id);
    assert(related.reason.trim() && related.sources.length, entry.id);
    assert(
      !excludedRelationReasons.has(related.reason),
      `${entry.id}: excluded era-mismatched reason reappeared`,
    );
  }
  for (const placeId of entry.relatedPlaceIds || [])
    assert(places.has(placeId));
  for (const entryId of entry.relatedEntryIds || [])
    assert(entries.has(entryId));
  const story = entry.historicalStory;
  if (!story) continue;
  for (const placeId of story.placeIds) assert(places.has(placeId), placeId);
  for (const placeId of Object.keys(story.displayNames || {}))
    assert(story.placeIds.includes(placeId), placeId);
  for (const entryId of story.replacesEntryIds || [])
    assert(entries.has(entryId));
  for (const link of story.related || []) {
    assert(places.has(link.placeId), `${entry.id}: raw story target retained`);
    assert(link.fromPlaceIds?.length, `${entry.id}: unscoped story relation`);
    for (const placeId of link.fromPlaceIds)
      assert(story.placeIds.includes(placeId), `${entry.id}: invalid origin`);
    if (link.targetEntryId)
      assert.equal(entries.get(link.targetEntryId)?.placeId, link.placeId);
  }
}

const cheorwon = places.get(ATLAS_CHEORWON_ID);
const gwiju = places.get(ATLAS_GWIJU_ID);
const dokdo = places.get(ATLAS_DOKDO_ID);
assert(finitePoint(dokdo), "Dokdo must remain a selectable physical island");
assert.equal(dokdo.kind, "island");
assert.equal(getAtlasPlaceKindLabel(dokdo), "섬");
assert.equal(dokdo.modernName, "대한민국 경상북도 울릉군 울릉읍 독도리");
// Independently check the shared constant against MOF's east-island DMS point:
// 131°52′10.4″ E, 37°14′26.8″ N. Never swap longitude and latitude.
assert(Math.abs(dokdo.coordinates[0] - 131.86955555555556) < 1e-9);
assert(Math.abs(dokdo.coordinates[1] - 37.24077777777778) < 1e-9);
assert.equal(
  JSON.stringify(dokdo.coordinates),
  JSON.stringify(ATLAS_DOKDO_COORDINATES),
);
assert(dokdo.locationNote.includes("대한민국"));
assert(dokdo.locationNote.includes("동도"));
const dokdoHistory = getAtlasHistoryEntries(dataset, ATLAS_DOKDO_ID, "korea");
const dokdoEntry = dokdoHistory[0];
assert.equal(
  dokdoEntry?.id,
  `story-korea-dokdo-imperial-decree-${ATLAS_DOKDO_ID}`,
  "Selecting Dokdo opens the evidenced 1900 account, not a source caption",
);
assert.equal(dokdoEntry.displayName, ATLAS_DOKDO_LABEL);
assert.equal(ATLAS_DOKDO_LABEL, "독도 · 대한민국");
assert.equal(dokdoEntry.historicalStory.startYear, 1900);
assert.equal(dokdoEntry.unitId, "korea-modern");
assert(dokdoEntry.eraIds.includes("k-opening"));
assert(dokdoEntry.summary.includes("칙령 제41호"));
assert(dokdoEntry.summary.includes("석도, 곧 독도"));
assert(dokdoEntry.summary.includes("1900년 10월 25일"));
assert(dokdoEntry.summary.includes("27일 관보"));
assert(
  dokdoEntry.historicalStory.sources.some(
    (item) =>
      item.url ===
      "https://contents.history.go.kr/front/hm/view.do?levelId=hm_122_0020",
  ),
);
assert(
  dokdoEntry.historicalStory.sources.some(
    (item) => item.url === ATLAS_DOKDO_LOCATION_SOURCE.url,
  ),
);
assert(matchesAtlasSearch(dokdoEntry, dokdo, "독도"));
assert.equal(
  getAtlasHistoryEntries(dataset, ATLAS_DOKDO_ID)[0]?.id,
  dokdoEntry.id,
  "The globe includes the same historical account",
);
assert.equal(
  getAtlasHistoryEntries(dataset, ATLAS_DOKDO_ID, "world").length,
  0,
  "The Korean historical island must not enter the world-history catalogue",
);
const dokdoProfile = getAtlasPlaceProfile(dokdo, dokdoHistory);
assert.equal(dokdoProfile.quality, "verified");
assert(dokdoProfile.definition.includes("대한민국"));
assert(dokdoProfile.definition.includes("동도와 서도"));
assert(dokdoProfile.facts.some((fact) => fact.value === dokdo.modernName));
for (const id of [
  "kr-entry-52c075a797c8",
  "kr-entry-8446393120ac",
  "kr-entry-ca1825db5bac",
  "kr-entry-4da99cfb6df0",
]) {
  assert(
    source.entries.some(
      (entry) =>
        entry.id === id &&
        entry.placeId === ATLAS_DOKDO_ID &&
        entry.citations.length > 0,
    ),
    "The original Dokdo textbook citations must remain in the source ledger",
  );
  assert(!entries.has(id), "A Dokdo caption must not become a dated event");
}
assert(finitePoint(gwiju));
assert.equal(JSON.stringify(gwiju.coordinates), "[125.2529,39.97969]");
assert(gwiju.modernName.includes("구성"));
assert(gwiju.locationNote.includes("정확한 전투 지점"));
assert(!places.has("kr-8b12d94c5688"), "Taebong is not a city pin");
assert(!cheorwon.aliases?.includes("태봉"), "Taebong is not a city synonym");
assert(!places.get("gimhae").aliases?.includes("금관가야"));
assert(!places.get("jeju").aliases?.includes("탐라"));
assert(!places.has("kr-70de7c323108"), "Uirimji caption is not a map history");
assert(!entries.has("kr-entry-2557f78c117d"));
assert(
  source.entries.some((entry) => entry.id === "kr-entry-2557f78c117d"),
  "The excluded Uirimji source caption must remain in the ledger",
);
const taebong = entries.get(ATLAS_TAEBONG_EVENT_ID);
assert.equal(taebong.placeId, ATLAS_CHEORWON_ID);
assert.equal(taebong.historicalStory.startYear, 911);
assert(matchesAtlasSearch(taebong, cheorwon, "태봉"));
const cheorwon905 = entries.get(
  `story-korea-cheorwon-capital-${ATLAS_CHEORWON_ID}`,
);
const keyword = getAtlasHistoricalRelations(dataset, cheorwon905, "korea").find(
  (relation) => relation.label === "태봉",
);
assert(keyword, "The explicit Taebong keyword remains clickable");
assert.equal(keyword.entry.id, taebong.id);
assert.equal(keyword.entry.placeId, cheorwon905.placeId);
assert.notEqual(
  keyword.entry.id,
  cheorwon905.id,
  "Click changes historical period",
);
assert(keyword.reason.includes("911년") && keyword.reason.includes("철원"));
const cheorwon918 = entries.get(
  `story-korea-goryeo-founded-${ATLAS_CHEORWON_ID}`,
);
const capitalMoveLinks = getAtlasHistoricalRelations(
  dataset,
  cheorwon918,
  "korea",
).filter((relation) => relation.entry.placeId === "kaesong");
assert(capitalMoveLinks[0]?.reason.includes("919년"));
assert.equal(
  capitalMoveLinks.length,
  1,
  "The corrected capital link is unique",
);
assert.equal(
  capitalMoveLinks[0].entry.id,
  "story-korea-gaegyeong-capital-kaesong",
);
assert.equal(capitalMoveLinks[0].entry.historicalStory.startYear, 919);
assert.equal(capitalMoveLinks[0].entry.placeId, "kaesong");
for (const [entryId, excludedPlaceId] of [
  ["story-korea-hubaekje-capital-jeonju", "gwangju"],
  ["story-korea-ganghwa-treaty-ganghwa", "busan"],
  ["story-korea-gongsan-battle-daegu", "gyeongju"],
  ["story-korea-gongsan-battle-kr-18dcdc12b418", "gyeongju"],
  ["story-korea-seogyeong-movement-pyongyang", "kaesong"],
  ["story-korea-ganghwa-capital-ganghwa", "kaesong"],
]) {
  const historicalEntry = entries.get(entryId);
  assert(historicalEntry, entryId);
  assert(
    !getAtlasHistoricalRelations(dataset, historicalEntry, "korea").some(
      (relation) => relation.entry.placeId === excludedPlaceId,
    ),
    `${entryId}: a different era must not stand in for the historical target`,
  );
  assert(
    source.entries
      .find((entry) => entry.id === entryId)
      .historicalStory.related.some(
        (relation) => relation.placeId === excludedPlaceId,
      ),
    `${entryId}: source relationship must remain intact`,
  );
}
for (const entryId of [
  "story-korea-incheon-landing-incheon",
  "story-korea-busan-refuge-busan",
]) {
  const seoulLinks = getAtlasHistoricalRelations(
    dataset,
    entries.get(entryId),
    "korea",
  ).filter((relation) => relation.entry.placeId === "seoul");
  assert.equal(seoulLinks.length, 1, `${entryId}: one Seoul destination`);
  assert.equal(seoulLinks[0].entry.id, "kr-entry-1f4225de4d5e");
  assert(seoulLinks[0].entry.summary.includes("6·25"));
}
assert(
  !getAtlasHistoricalRelations(dataset, taebong, "korea").some(
    (relation) => relation.label === "태봉",
  ),
  "Explicit keyword links must not be copied backwards",
);
const invalidTargetEntry = {
  ...cheorwon905,
  historicalStory: {
    ...cheorwon905.historicalStory,
    related: [
      {
        placeId: ATLAS_CHEORWON_ID,
        targetEntryId: "missing-entry",
        fromPlaceIds: [ATLAS_CHEORWON_ID],
        label: "invalid-target",
        reason: "잘못된 시기 링크",
      },
    ],
  },
};
const invalidTargetDataset = {
  ...dataset,
  entries: dataset.entries.map((entry) =>
    entry.id === invalidTargetEntry.id ? invalidTargetEntry : entry,
  ),
};
assert(
  !getAtlasHistoricalRelations(
    invalidTargetDataset,
    invalidTargetEntry,
    "korea",
  ).some((relation) => relation.label === "invalid-target"),
  "An invalid explicit period must never fall back to another event",
);

const before = JSON.stringify(source);
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
}
freeze(source);
const rebuilt = buildAtlasMapDataset(source);
assert.equal(
  JSON.stringify(source),
  before,
  "Curation mutated the source ledger",
);
assert.equal(JSON.stringify(rebuilt.dataset), JSON.stringify(dataset));
assert.equal(
  source.places.find((place) => place.id === ATLAS_DOKDO_ID).coordinates,
  null,
  "Restoring the verified Dokdo point must not mutate its raw coordinates",
);
assert.equal(
  source.places.find((place) => place.id === ATLAS_DOKDO_ID).kind,
  "region",
);
assert.equal(
  source.places.find((place) => place.id === ATLAS_GWIJU_ID).coordinates,
  null,
);
assert.equal(
  source.places.find((place) => place.id === "kr-8b12d94c5688").kind,
  "country",
);
// Even a future entry with coordinates and an account cannot reintroduce
// source-only modern facilities into the historical place list.
for (const name of ["경부 고속 국도", "현대 연구소", "유물 박물관"]) {
  const fixtureId = "facility-regression";
  const fixture = {
    ...source,
    places: [...source.places, { ...gwiju, id: fixtureId, name }],
    entries: [
      ...source.entries,
      {
        ...source.entries.find((entry) => entry.id === "k-yeoncheon"),
        id: fixtureId,
        placeId: fixtureId,
      },
    ],
  };
  const result = buildAtlasMapDataset(fixture);
  assert(!result.dataset.places.some((place) => place.id === fixtureId), name);
  assert(
    result.audit
      .find((row) => row.placeId === fixtureId)
      .reasons.includes("nonhistorical-facility"),
    name,
  );
}

const subjectPlaces = (subject) =>
  new Set(
    dataset.entries
      .filter((entry) => atlasEntrySubject(dataset, entry) === subject)
      .map((entry) => entry.placeId),
  );
const koreaPlaces = subjectPlaces("korea");
const worldPlaces = subjectPlaces("world");
assert(koreaPlaces.size >= 50 && worldPlaces.size >= 60);
for (const place of dataset.places) {
  const all = getAtlasHistoryEntries(dataset, place.id);
  const korea = getAtlasHistoryEntries(dataset, place.id, "korea");
  const world = getAtlasHistoryEntries(dataset, place.id, "world");
  assert(all.length >= Math.max(korea.length, world.length));
  korea.forEach((entry) =>
    assert.equal(atlasEntrySubject(dataset, entry), "korea"),
  );
  world.forEach((entry) =>
    assert.equal(atlasEntrySubject(dataset, entry), "world"),
  );
}
for (const id of [
  "seoul",
  "pyongyang",
  "kaesong",
  "gongju",
  "buyeo",
  "gyeongju",
  "jeonju",
  "cheongju",
  "andong",
  "jeju",
  "rome",
  "athens",
  "ur",
  "mohenjo-daro",
  "xian",
  "beijing",
  "paris",
  "berlin",
  "boston",
  "world-953c761e000b",
  "world-72e73261214b",
])
  assert(places.has(id), `Core historical place was lost: ${id}`);
const provinces = ATLAS_KOREA_PROVINCES.map((province) => ({
  ...province,
  places: dataset.places
    .filter(
      (place) =>
        koreaPlaces.has(place.id) &&
        matchesAtlasRegion(place, "korea", province.id),
    )
    .map((place) => place.name),
}));
const polite = /(?:습니다|입니다)[.!?。]?(?:\s|$)/u;
const styleViolations = [
  ...dataset.places.flatMap((place) =>
    polite.test(place.locationNote || "") ? [place.id] : [],
  ),
  ...dataset.entries.flatMap((entry) =>
    polite.test(entry.summary) ? [entry.id] : [],
  ),
  ...dataset.entries.flatMap((entry) =>
    (entry.historicalStory?.related || [])
      .filter((link) => polite.test(link.reason))
      .map(() => `${entry.id}:relation`),
  ),
];
const report = {
  sourcePlaces: source.places.length,
  sourceEntries: source.entries.length,
  mapPlaces: dataset.places.length,
  mapEntries: dataset.entries.length,
  koreaPlaces: koreaPlaces.size,
  worldPlaces: worldPlaces.size,
  relations: relationCount,
  excludedRelationReasons: [...excludedRelationReasons],
  exclusions: Object.fromEntries(
    [
      "country-or-region",
      "nonhistorical-facility",
      "unverified-location",
      "no-individual-history",
    ].map((reason) => [
      reason,
      audit.filter((row) => row.reasons.includes(reason)).length,
    ]),
  ),
  provinces,
  includedPlaces: dataset.places
    .map((place) => ({
      id: place.id,
      name: place.name,
      coordinates: place.coordinates,
      subjects: ["korea", "world"].filter((subject) =>
        subjectPlaces(subject).has(place.id),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true })),
  styleViolations,
  audit,
};
mkdirSync("output", { recursive: true });
writeFileSync(
  "output/atlas-map-curation-audit.json",
  JSON.stringify(report, null, 2) + "\n",
);
const listFor = (subject) =>
  report.includedPlaces
    .filter((place) => place.subjects.includes(subject))
    .map((place) => `- ${place.name} (${place.id})`)
    .join("\n");
writeFileSync(
  "output/atlas-map-curation-summary.md",
  [
    "# 역사 지도 장소 선별 검증 · 2026-10-15",
    "",
    `원본 ${source.places.length}곳·${source.entries.length}개 항목을 보존하고, 앱 지도에는 ${dataset.places.length}곳·${dataset.entries.length}개 역사 항목을 사용한다. 한국사 ${koreaPlaces.size}곳, 세계사 ${worldPlaces.size}곳이며 지구본은 두 과목의 장소를 모두 제공한다.`,
    "",
    "실제 장소의 좌표, 개별 역사 설명, 출처가 모두 확인되는 항목을 유지했다. 나라·왕조·광역 범위, 위치 미확정 자료, 단순 지도 캡션, 비핵심 현대 시설은 목록과 검색에서 제외했다. 정규식은 시설 제외를 돕는 보조 조건이며 역사 내용과 위치 확인을 대신하지 않는다.",
    "",
    "## 제외 사유",
    "",
    ...Object.entries(report.exclusions).map(
      ([reason, count]) => `- ${reason}: ${count}곳`,
    ),
    "",
    "한 장소에 여러 사유가 해당할 수 있어 위 수치는 중복 집계다. 전체 제외 장소는 " +
      (source.places.length - dataset.places.length) +
      "곳이다. 모든 장소의 판정은 atlas-map-curation-audit.json에 보존한다.",
    "",
    "## 팔도별 유지 장소",
    "",
    "| 분류 | 수 | 장소 |",
    "|---|---:|---|",
    ...provinces.map(
      (province) =>
        `| ${province.title} | ${province.places.length} | ${province.places.join(", ") || "없음"} |`,
    ),
    "",
    "낙동강처럼 두 지역에 걸친 곳은 중복 집계한다. 개성·벽란도는 기존 조선 팔도 분류에서 경기도에 속한다. 황해도 분류에는 좌표와 개별 역사 설명을 함께 충족하는 장소가 없어 0곳이며, 분류 수를 채우기 위한 추정 좌표나 사건을 만들지 않았다.",
    "",
    "## 위치 연결과 검증",
    "",
    "- 태봉은 원본의 country 분류·null 좌표를 유지한다. 철원의 905년 이야기에서 ‘태봉’ 키워드를 누르면 같은 철원 지점의 911년 국호 변경 이야기로 이동한다. 도시의 별칭으로 태봉을 추가하지 않는다.",
    "- 귀주는 국사편찬위원회의 현대 지명 비정과 GeoNames 1875107의 구성 정주지 좌표를 대조했다. [125.2529, 39.97969]는 구성시 일대의 대표 위치이며 정확한 전투 지점이나 성곽의 경계가 아니다.",
    "- 독도는 해양수산부의 동도 좌표(동경 131도 52분 10.4초, 북위 37도 14분 26.8초)를 사용한 대한민국의 섬으로 복원했다. 현재 위치는 대한민국 경상북도 울릉군 울릉읍 독도리이며, 기본 역사 이야기는 1900년 대한제국 칙령 제41호이다. 한국사와 전체 지구본에 포함하고 세계사 목록에는 포함하지 않는다. 원본의 null 좌표·region 분류·교과서 인용은 보존했다.",
    "- 모든 entry·관련 연결의 실제 좌표, 과목 경계, 원본 불변, 잘못된 targetEntryId의 대체 선택 방지, 시설 재도입 방지, 평서형 문체를 자동 검사했다.",
    "- 선별된 설명과 시대가 맞지 않는 전주(후백제)→광주, 강화도조약→부산, 공산 전투→경주, 서경 천도 운동→개경, 강화 천도→개경 관계는 지도용 데이터에서 제외했다. 원본 관계는 보존하며, 제외한 이유가 정방향·역방향 연결에 다시 나타나지 않는지 전수 검사했다.",
    "- 철원의 고려 건국→송악은 919년 천도 이야기로, 인천상륙작전·부산 피란→서울은 6·25전쟁 피해 이야기로 정확히 연결했다.",
    "- source 장부의 원래 지명·인용·미확정 위치 자료는 historyAtlasSourceDataset에 그대로 보존한다. 지도 밖 자료의 추가 좌표 검증은 이번 선별 범위에 포함하지 않는다.",
    "",
    "출처: [국사편찬위원회 귀주대첩](https://contents.history.go.kr/mobile/kc/view.do?levelId=kc_i200400), [GeoNames 구성 정주지](https://www.geonames.org/1875107/kusong-si.html), [한국민족문화대백과사전 태봉](https://encykorea.aks.ac.kr/Article/E0058942).",
    "",
    `## 한국사 유지 명단 (${koreaPlaces.size}곳)`,
    "",
    listFor("korea"),
    "",
    `## 세계사 유지 명단 (${worldPlaces.size}곳)`,
    "",
    listFor("world"),
    "",
  ].join("\n"),
);
assert.equal(
  styleViolations.length,
  0,
  `Map text must use plain endings: ${styleViolations.slice(0, 12).join(", ")}`,
);
console.log(
  `PASS atlas curation: ${source.places.length} source places → ${dataset.places.length} mapped places (${koreaPlaces.size} Korean / ${worldPlaces.size} world), ${dataset.entries.length} entries, ${relationCount} valid relations; source unchanged.`,
);
