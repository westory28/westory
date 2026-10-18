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
  historyDictionaryFiltersForFacet: forFacet,
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
const theme = forFacet({ id: "ancient", label: "고대", group: "era" });
assert.equal(theme.initial, "");
assert.equal(theme.subject, "");
assert.equal(theme.kind, "all");
assert.deepEqual(
  Array.from(filter(entries, theme), (item) => item.word),
  ["가야", "Agora"],
);
assert.equal(
  forFacet({ id: "asia", label: "아시아", group: "region" }).kind,
  "place",
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
  "PASS dictionary browse: conjunctive themes, kind and initials, facet counts, badge theme reset, numeric/Korean/Latin order, ancestor badge deduplication.",
);
