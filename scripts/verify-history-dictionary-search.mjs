import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const result = await build({
  entryPoints: ["src/lib/historyDictionarySearch.ts"],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  minify: true,
  metafile: true,
  logLevel: "silent",
});
assert.deepEqual(Object.keys(result.metafile.inputs), [
  "src/lib/historyDictionarySearch.ts",
]);
assert(result.outputFiles[0].contents.length < 8_000);
const module = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, {
  module,
  exports: module.exports,
});
const search = module.exports.searchHistoryDictionaryCatalog;
const entry = (id, word, extra = {}) => ({
  id,
  word,
  definition: "조선의 제도",
  aliases: [],
  tags: ["한국사"],
  facetIds: [],
  kind: "history",
  attributions: [],
  ...extra,
});
const terms = [
  entry("place", "의정부", { kind: "place" }),
  entry("exact", "의정부"),
  entry("alias", "육조", { aliases: ["6조"] }),
  entry("prefix", "의정부 서사제"),
  entry("meaning", "과전법", { definition: "조선의 토지와 수조권 제도" }),
  entry("latin", "ABC"),
];
assert.deepEqual(
  Array.from(search("의정부", 10, terms), (r) => r.id),
  ["exact", "place", "prefix"],
);
assert.equal(search("６조", 1, terms)[0].id, "alias");
assert.equal(search("의 정부", 1, terms)[0].id, "exact");
assert.equal(search("수조권 조선", 1, terms)[0].id, "meaning");
assert.equal(search("abc", 1, terms)[0].id, "latin");
assert.equal(search("의정부").length, 0, "No implicit bundled catalog");
assert.equal(search("의정부", 10, []).length, 0, "No stale index reuse");
assert.equal(search("", 0, terms).length, 0);
assert.equal(search("", 2.8, terms).length, 2);
assert.equal(search("", -1, terms).length, 0);
const browser = readFileSync(
  "src/components/common/HistoryDictionaryCatalogBrowser.tsx",
  "utf8",
);
assert(!/import\(["'][^"']*historyDictionaryCatalog/.test(browser));
assert(browser.includes('from "../../lib/historyDictionarySearch"'));
console.log(
  `Dictionary search: ranking, supplied data isolation, no content imports; ${result.outputFiles[0].contents.length} byte bundle.`,
);
