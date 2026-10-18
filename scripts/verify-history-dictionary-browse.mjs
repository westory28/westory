import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  );
  return exports;
}
const {
  emptyHistoryDictionaryFilters: empty,
  filterHistoryDictionaryEntries: filter,
  compareHistoryDictionaryHeadwords: compare,
  toggleHistoryDictionaryTag: toggleTag,
  removeHistoryDictionaryFacet: removeFacet,
  getHistoryDictionarySelectedFacets: selectedFacets,
  isHistoryDictionaryFacetSelected: isSelected,
  getHistoryDictionaryVisibleBadges: badges,
  changeHistoryDictionaryFilter: change,
} = load("src/lib/historyDictionaryBrowse.ts");
const term = (word, kind, facetIds) => ({ id: word, word, kind, facetIds });
const entries = [
  term("갑오개혁", "history", ["korea", "modern", "politics"]),
  term("가야", "history", ["korea", "ancient", "politics"]),
  term("강화도", "place", ["korea", "modern", "asia", "east-asia"]),
  term("Agora", "place", ["world", "ancient", "europe"]),
  term("1차 대전", "history", ["world", "modern", "war"]),
];
assert.deepEqual(
  Array.from(filter(entries, empty()), (item) => item.id),
  entries.map((item) => item.id),
);
const selected = { ...empty(), subject: "korea", era: "modern", initial: "ㄱ" };
assert.deepEqual(
  Array.from(filter(entries, selected), (item) => item.word),
  ["갑오개혁", "강화도"],
);
assert.deepEqual(
  Array.from(
    filter(entries, { ...selected, kind: "history", topic: "politics" }),
    (item) => item.word,
  ),
  ["갑오개혁"],
);
assert.equal(filter(entries, { ...selected, region: "europe" }).length, 0);
assert.deepEqual(
  Array.from(filter(entries, selected, "era"), (item) => item.word),
  ["갑오개혁", "가야", "강화도"],
);
assert.deepEqual(
  Array.from(
    filter(entries, { ...empty(), initial: "a-z" }),
    (item) => item.word,
  ),
  ["Agora"],
);
assert.deepEqual(
  Array.from(
    filter(entries, { ...empty(), initial: "0-9" }),
    (item) => item.word,
  ),
  ["1차 대전"],
);
assert.equal(filter(entries, { ...empty(), initial: "9" }).length, 0);
const subjectFacets = [{ id: "modern", group: "era", subjectId: "korea" }];
const changedSubject = change(
  { ...selected, initial: "" },
  "subject",
  "world",
  subjectFacets,
);
assert.equal(changedSubject.era, "");
assert.equal(
  filter(entries, changedSubject).length,
  2,
  "Subject count must include era reset",
);
assert.equal(change(selected, "subject", "korea", subjectFacets).era, "modern");
assert.equal(
  change({ ...empty(), region: "asia" }, "kind", "history", []).region,
  "",
);
assert.equal(change(empty(), "region", "asia", []).kind, "place");
const facets = [
  { id: "korea", label: "한국사", group: "subject" },
  { id: "world", label: "세계사", group: "subject" },
  { id: "ancient", label: "고대", group: "era" },
  { id: "modern", label: "근현대", group: "era", subjectId: "korea" },
  { id: "asia", label: "아시아", group: "region" },
  { id: "east-asia", label: "동아시아", group: "region" },
  { id: "europe", label: "유럽", group: "region" },
  { id: "politics", label: "정치", group: "topic" },
];
const facet = (id) => facets.find((item) => item.id === id);
const words = (values) => Array.from(values, (item) => item.word);
const stacked = toggleTag(toggleTag(empty(), facet("korea")), facet("modern"));
assert.deepEqual(Array.from(stacked.tags), ["korea", "modern"]);
assert.deepEqual(words(filter(entries, stacked)), ["갑오개혁", "강화도"]);
assert.deepEqual(words(filter(entries, toggleTag(stacked, facet("asia")))), [
  "강화도",
]);
assert.deepEqual(
  words(filter(entries, { ...stacked, tags: [...stacked.tags].reverse() })),
  words(filter(entries, stacked)),
  "Tag order changed results",
);
const overlap = [
  ...entries,
  term("여러 시대 비교", "history", ["korea", "ancient", "modern"]),
];
assert.deepEqual(
  words(filter(overlap, { ...empty(), tags: ["ancient", "modern"] })),
  ["여러 시대 비교"],
  "Same-group tags must also use AND",
);
assert.equal(
  filter(entries, { ...stacked, tags: [...stacked.tags, "ancient"] }).length,
  0,
  "Incompatible tags must produce no results",
);
assert.equal(
  filter(entries, { ...empty(), tags: ["missing-facet"] }).length,
  0,
);
assert.deepEqual(
  words(filter(entries, { ...stacked, tags: ["korea", "modern", "korea"] })),
  words(filter(entries, stacked)),
  "Duplicate tags changed the result",
);

const initialState = Object.freeze({
  ...selected,
  kind: "place",
  region: "asia",
  tags: Object.freeze(["modern"]),
});
const snapshot = JSON.stringify(initialState);
const toggled = toggleTag(initialState, facet("east-asia"));
for (const key of ["kind", "initial", "subject", "era", "region", "topic"])
  assert.equal(toggled[key], initialState[key], `${key} lost on tag selection`);
assert.deepEqual(Array.from(toggled.tags), ["modern", "east-asia"]);
assert.deepEqual(words(filter(entries, toggled)), ["강화도"]);
assert.deepEqual(
  words(filter(entries, { ...toggled, initial: "ㄴ" })),
  [],
  "Initial filter must remain conjunctive",
);
const query = "강화";
const queryMatches = entries.filter((item) => item.word.includes(query));
assert.deepEqual(
  words(filter(queryMatches, toggled)),
  ["강화도"],
  "Query results must be narrowed by tags/dropdowns/initials together",
);
assert.equal(
  filter(queryMatches, toggleTag(toggled, facet("politics"))).length,
  0,
);
assert.deepEqual(
  words(filter(entries, { ...toggled, region: "europe" }, "region")),
  ["강화도"],
  "Omitting a dropdown must preserve tag restrictions",
);
assert.equal(
  filter(entries, { ...empty(), era: "ancient", tags: ["modern"] }).length,
  0,
  "Dropdown and tag in the same group must intersect",
);

const removed = removeFacet(toggled, facet("modern"));
assert.equal(
  removed.era,
  "",
  "Removing a tag must also clear the matching dropdown",
);
assert.deepEqual(Array.from(removed.tags), ["east-asia"]);
assert.equal(removed.subject, "korea");
assert.equal(removed.region, "asia");
assert.equal(removed.initial, "ㄱ");
assert.equal(removed.kind, "place");
assert.deepEqual(
  Array.from(toggleTag(toggled, facet("east-asia")).tags),
  ["modern"],
  "A second click must remove the tag",
);
const dropdownOnly = {
  ...empty(),
  era: "modern",
  initial: "ㄱ",
  subject: "korea",
};
assert(isSelected(dropdownOnly, facet("modern")));
const dropdownDeselected = toggleTag(dropdownOnly, facet("modern"));
assert.equal(dropdownDeselected.era, "");
assert.equal(
  dropdownDeselected.tags.length,
  0,
  "Clicking an active dropdown badge must deselect, not duplicate it",
);
assert.equal(dropdownDeselected.subject, "korea");
assert.equal(dropdownDeselected.initial, "ㄱ");
assert(!isSelected(dropdownDeselected, facet("modern")));
assert.deepEqual(
  Array.from(
    selectedFacets({ ...toggled, tags: [...toggled.tags, "modern", "korea"] }, [
      ...facets,
      facet("modern"),
    ]),
    (item) => item.id,
  ),
  ["korea", "modern", "asia", "east-asia"],
  "Selected chips must be deduplicated and retain taxonomy order",
);
assert.equal(selectedFacets(empty(), facets).length, 0);
assert.deepEqual(
  words(filter(entries, empty())),
  words(entries),
  "Reset must clear all tag restrictions",
);
assert.notStrictEqual(
  empty().tags,
  empty().tags,
  "Empty filter states must not share a mutable array",
);
assert.equal(
  JSON.stringify(initialState),
  snapshot,
  "Tag helpers mutated their input",
);
const changedWithTags = change(initialState, "subject", "world", facets);
assert.equal(changedWithTags.era, "");
assert.deepEqual(
  Array.from(changedWithTags.tags),
  ["modern"],
  "Dropdown changes must preserve independent tags",
);
assert.notStrictEqual(changedWithTags.tags, initialState.tags);
assert.equal(
  JSON.stringify(initialState),
  snapshot,
  "Dropdown changes mutated the original array",
);
assert.deepEqual(
  Array.from(
    change({ ...toggled, kind: "all" }, "kind", "history", facets).tags,
  ),
  ["modern", "east-asia"],
);
assert.equal(
  removeFacet(toggled, facet("ancient")).era,
  "modern",
  "Removing another era must leave the dropdown intact",
);

const { getHistoryDictionaryCatalog, searchHistoryDictionaryCatalog } = load(
  "src/lib/historyDictionaryCatalog.ts",
);
const { historyDictionaryFacets: realFacets } = load(
  "src/lib/historyDictionaryThemes.ts",
);
const catalog = getHistoryDictionaryCatalog();
const realFacet = (id) => {
  const value = realFacets.find((item) => item.id === id);
  assert(value);
  return value;
};
const realTagIds = [
  "subject:korea",
  "era:k-joseon-early",
  "region:korea-pyeongan",
];
const realFilters = realTagIds.reduce(
  (filters, id) => toggleTag(filters, realFacet(id)),
  empty(),
);
const realMatches = filter(catalog, realFilters);
assert(realMatches.some((item) => item.word === "4군"));
assert(
  realMatches.every((item) =>
    realTagIds.every((id) => item.facetIds.includes(id)),
  ),
);
assert(
  !realMatches.some((item) => item.word === "6진"),
  "Hamgyeong place must not match Pyeongan tag",
);
assert.deepEqual(
  words(
    filter(catalog, { ...realFilters, tags: [...realFilters.tags].reverse() }),
  ),
  words(realMatches),
);
const realQueryMatches = searchHistoryDictionaryCatalog("4군", catalog.length);
const combined = {
  ...realFilters,
  kind: "place",
  initial: "4",
  region: "region:korea",
  topic: "topic:region",
};
assert(
  filter(realQueryMatches, combined).some((item) => item.word === "4군"),
  "Real catalog query + initial + dropdown + tags must intersect",
);
assert.equal(
  filter(realQueryMatches, { ...combined, initial: "ㄱ" }).length,
  0,
);
assert.equal(
  filter(
    realQueryMatches,
    toggleTag(combined, realFacet("region:korea-hamgyeong")),
  ).length,
  0,
  "Same-group region tags must not broaden to OR",
);
assert.deepEqual(
  [...entries].sort(compare).map((item) => item.word),
  ["1차 대전", "가야", "갑오개혁", "강화도", "Agora"],
);
const regions = [
  { id: "asia", group: "region", label: "아시아" },
  { id: "east-asia", group: "region", label: "동아시아", parentId: "asia" },
  { id: "peninsula", group: "region", label: "한반도", parentId: "east-asia" },
  { id: "modern", group: "era", label: "근현대" },
];
assert.deepEqual(
  Array.from(
    badges(["asia", "east-asia", "peninsula", "modern"], regions),
    (facet) => facet.id,
  ),
  ["peninsula", "modern"],
);
console.log(
  "PASS dictionary browse: cumulative AND tags, same-group intersections, individual removal/reset, selection deduplication, immutable dropdown changes, query/initial/dropdown preservation, real Korea/Joseon/Pyeongan catalog intersection, facet counts, numeric/Korean/Latin order, ancestor badge deduplication.",
);
