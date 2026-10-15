import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const cache = new Map();
const nodeRequire = createRequire(import.meta.url);
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
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      require: (name) => {
        if (name.endsWith(".css")) return {};
        if (name === "./InfoHelp") return { default: () => null };
        if (!name.startsWith(".")) return nodeRequire(name);
        const file = resolve(dirname(path), name);
        return load(existsSync(`${file}.ts`) ? `${file}.ts` : `${file}.tsx`);
      },
    },
  );
  return exports;
}
// Audit all authored facts even when a place is excluded from the map catalogue.
const { historyAtlasSourceDataset: dataset } = load(
  "src/data/historyAtlasContent.ts",
);
const {
  atlasEntrySubject,
  atlasStoryStartYear,
  getAtlasHistoricalRelations,
  getAtlasHistoryEntries,
  getAtlasHistoricalSummary,
  isAtlasHistoricalEntry,
} = load("src/lib/historyAtlasStories.ts");
const places = new Map(dataset.places.map((place) => [place.id, place]));
const entries = new Map(dataset.entries.map((entry) => [entry.id, entry]));
const facts = dataset.entries.filter((entry) => entry.historicalStory);
const stories = [
  ...new Map(
    facts.map((entry) => [entry.historicalStory.id, entry.historicalStory]),
  ).values(),
];
assert(
  stories.length >= 150,
  "Historical audit must cover both maps broadly, not just Cheorwon",
);
for (const story of stories) {
  assert(
    story.summary.trim() && story.title.trim() && story.period.trim(),
    story.id,
  );
  assert(Number.isInteger(story.startYear), `${story.id}: undated story`);
  assert(
    !story.endYear || story.endYear >= story.startYear,
    `${story.id}: reversed chronology`,
  );
  assert(story.sources.length, `${story.id}: missing historical source`);
  for (const source of story.sources)
    assert(
      /^https:\/\//u.test(source.url) && source.title.trim(),
      `${story.id}: malformed source`,
    );
  for (const id of story.placeIds)
    assert(places.has(id), `${story.id}: unknown place ${id}`);
  for (const link of story.related || []) {
    assert(
      story.placeIds.length === 1 || link.fromPlaceIds?.length,
      `${story.id}: multi-place relationship needs explicit source places`,
    );
    for (const from of link.fromPlaceIds || story.placeIds)
      assert(
        story.placeIds.includes(from) && from !== link.placeId,
        `${story.id}: invalid relationship source ${from}`,
      );
    assert(
      places.has(link.placeId),
      `${story.id}: unknown related place ${link.placeId}`,
    );
    assert(
      link.reason.trim().length >= 10,
      `${story.id}: relationship needs an explanation`,
    );
    assert(
      dataset.entries.some(
        (entry) =>
          entry.placeId === link.placeId &&
          atlasEntrySubject(dataset, entry) === story.subject,
      ),
      `${story.id}: no same-subject target ${link.placeId}`,
    );
  }
  for (const id of story.replacesEntryIds || []) {
    const old = entries.get(id);
    assert(
      old && story.placeIds.includes(old.placeId),
      `${story.id}: replacing another place's story ${id}`,
    );
    assert.equal(
      atlasEntrySubject(dataset, old),
      story.subject,
      `${story.id}: cross-subject replacement`,
    );
  }
}

const audit = [];
for (const place of dataset.places) {
  const subjects = [
    ...new Set(
      dataset.entries
        .filter((entry) => entry.placeId === place.id)
        .map((entry) => atlasEntrySubject(dataset, entry)),
    ),
  ];
  for (const subject of subjects) {
    const history = getAtlasHistoryEntries(dataset, place.id, subject);
    history.forEach((entry, index) => {
      assert.equal(
        atlasEntrySubject(dataset, entry),
        subject,
        `${place.name}: cross-subject era chip`,
      );
      assert(
        isAtlasHistoricalEntry(entry),
        `${place.name}: source caption became a story`,
      );
      if (index)
        assert(
          atlasStoryStartYear(history[index - 1]) <= atlasStoryStartYear(entry),
          `${place.name}: stories out of chronological order`,
        );
    });
    audit.push({
      id: place.id,
      name: place.name,
      subject,
      historicalEntries: history.length,
      sourcedEvents: history.filter((entry) => entry.historicalStory).length,
      status: history.length ? "historical-context" : "place-overview-only",
    });
  }
}
let scopedRelations = 0;
for (const entry of facts) {
  const subject = atlasEntrySubject(dataset, entry);
  for (const link of getAtlasHistoricalRelations(dataset, entry, subject)) {
    assert.equal(
      atlasEntrySubject(dataset, link.entry),
      subject,
      `${entry.id}: relation escapes ${subject}`,
    );
    assert.notEqual(link.entry.placeId, entry.placeId, "Self relation");
    scopedRelations++;
  }
}
// Mixed factual/caption summaries must keep the actual history.
for (const id of [
  "kr-entry-218e816f6fc4",
  "kr-entry-ab7f99cac852",
  "kr-entry-1f4225de4d5e",
]) {
  assert(
    getAtlasHistoricalSummary(entries.get(id)).length > 20,
    `${id}: lost real history while removing a source caption`,
  );
}
const cheorwon = getAtlasHistoryEntries(dataset, "kr-5946842fc116", "korea");
assert(
  cheorwon.some(
    (entry) => /궁예/u.test(entry.summary) && /태봉/u.test(entry.summary),
  ),
  "Cheorwon needs Gungye/Taebong context",
);
assert(
  cheorwon.some((entry) =>
    getAtlasHistoricalRelations(dataset, entry, "korea").some(
      (link) => link.entry.placeId === "kr-8b12d94c5688",
    ),
  ),
  "Cheorwon must lead to Taebong",
);
assert.equal(
  entries.get("kr-entry-e37f8b5faaea").placeId,
  "andong",
  "930 Gochang battle must locate at Andong",
);
assert(
  entries.get("world-exp-world-fccf1c2757b2-0").eraIds.includes("w-medieval"),
  "Todaiji is a Nara-period temple, not an ancient Greek site",
);
const Details = load("src/components/common/AtlasPlaceDetails.tsx").default;
const detailHtml = (entry, subject, data = dataset) =>
  renderToStaticMarkup(
    React.createElement(Details, {
      dataset: data,
      entry,
      subject,
      place: data.places.find((p) => p.id === entry.placeId),
      onSelectEntry() {},
    }),
  );
const cheorwonHtml = detailHtml(cheorwon[0], "korea");
for (const label of ["905년", "911년", "918년", "태봉", "함께 볼 장소"])
  assert(
    cheorwonHtml.includes(label),
    `Cheorwon default details lost ${label}`,
  );
const modernSeoul = facts.find(
  (entry) =>
    entry.placeId === "seoul" && entry.historicalStory.startYear === 1960,
);
assert.equal(
  modernSeoul.displayName,
  "서울",
  "Modern Seoul must not be labeled Hanyang",
);
assert(detailHtml(modernSeoul, "korea").includes("<h2>서울</h2>"));
const balhaeWonsanHtml = detailHtml(
  entries.get("kr-entry-ab5e7f664f0a"),
  "korea",
);
assert(balhaeWonsanHtml.includes("장소 개요"));
assert(
  !balhaeWonsanHtml
    .match(/class="atlas-place-details__definition">([^<]*)/u)?.[1]
    .includes("1929"),
  "A Balhae map caption must not fall back to the 1929 Wonsan strike as its definition",
);
// Share a physical place across subjects and test the actual rendered chips.
const fixturePlace = { id: "shared", name: "공유 지명", coordinates: null };
const fixtureEntries = ["korea", "world"].map((subject) => ({
  id: `fixture-${subject}`,
  placeId: fixturePlace.id,
  unitId: subject === "korea" ? "korea-modern" : "world-contemporary",
  title: `${subject}-story`,
  period: subject === "korea" ? "1950년" : "1960년",
  summary: `${subject}-historical-summary`,
  significance: "",
  citations: [],
  eraIds: [subject === "korea" ? "k-modern" : "w-contemporary"],
}));
const fixture = { ...dataset, places: [fixturePlace], entries: fixtureEntries };
assert(
  !detailHtml(fixtureEntries[0], "korea", fixture).includes(
    "world-historical-summary",
  ),
);
assert(
  !detailHtml(fixtureEntries[1], "world", fixture).includes(
    "korea-historical-summary",
  ),
);
const globeHtml = detailHtml(fixtureEntries[0], undefined, fixture);
assert.equal(
  (globeHtml.match(/aria-pressed=/g) || []).length,
  2,
  "Globe needs both subject stories",
);
// One shared story does not make every city/monument a participant in each
// relationship. Check both outgoing and reverse traversal independently.
const edgeStory = {
  id: "city-and-monument",
  subject: "world",
  placeIds: ["city", "monument"],
  title: "공유 이야기",
  period: "1900년",
  startYear: 1900,
  summary: "도시와 유적의 역사",
  eraIds: ["w-wars"],
  sources: [],
  related: [
    {
      placeId: "state",
      fromPlaceIds: ["city"],
      reason: "이 도시는 이 나라의 수도였습니다.",
    },
  ],
};
const edgeData = {
  ...dataset,
  places: ["city", "monument", "state"].map((id) => ({
    id,
    name: id,
    coordinates: null,
  })),
  entries: ["city", "monument", "state"].map((placeId) => ({
    ...fixtureEntries[1],
    id: `edge-${placeId}`,
    placeId,
    ...(placeId === "state" ? {} : { historicalStory: edgeStory }),
  })),
};
assert.deepEqual(
  Array.from(
    getAtlasHistoricalRelations(edgeData, edgeData.entries[0], "world"),
    (r) => r.entry.placeId,
  ),
  ["state"],
);
assert.equal(
  getAtlasHistoricalRelations(edgeData, edgeData.entries[1], "world").length,
  0,
);
assert.deepEqual(
  Array.from(
    getAtlasHistoricalRelations(edgeData, edgeData.entries[2], "world"),
    (r) => r.entry.placeId,
  ),
  ["city"],
);
for (const subject of ["korea", "world"]) {
  const covered = new Set(
    facts
      .filter((entry) => atlasEntrySubject(dataset, entry) === subject)
      .map((entry) => entry.placeId),
  );
  assert(
    covered.size >= 60,
    `${subject}: insufficient map-wide historical coverage`,
  );
}
// A shared physical location can show both histories on the globe, but never
// leak a world-history chip or link into the Korean-history flat map.
for (const place of dataset.places) {
  const all = getAtlasHistoryEntries(dataset, place.id);
  const korea = getAtlasHistoryEntries(dataset, place.id, "korea");
  const world = getAtlasHistoryEntries(dataset, place.id, "world");
  assert(
    all.length >= Math.max(korea.length, world.length),
    `${place.id}: globe hides a subject`,
  );
}
const report = {
  places: dataset.places.length,
  entries: dataset.entries.length,
  sourcedStories: stories.length,
  sourcedPlaces: new Set(facts.map((entry) => entry.placeId)).size,
  scopedRelations,
  historicalPlaceSubjects: audit.filter((item) => item.historicalEntries)
    .length,
  overviewOnlyPlaceSubjects: audit.filter((item) => !item.historicalEntries)
    .length,
  items: audit,
};
if (process.argv.includes("--report"))
  writeFileSync(
    "docs/reviews/history-atlas-story-audit-20261015.json",
    JSON.stringify(report, null, 2) + "\n",
  );
console.log(
  `PASS historical atlas: ${report.places} places audited, ${stories.length} sourced events, ${report.sourcedPlaces} event-linked places, ${scopedRelations} scoped relationships; ${report.overviewOnlyPlaceSubjects} place/subject pairs remain overviews, never inferred historical events.`,
);
