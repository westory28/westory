import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
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
  getHistoryDictionaryCatalog,
  searchHistoryDictionaryCatalog,
  getHistoryDictionaryCatalogSource,
} = load("src/lib/historyDictionaryCatalog.ts");
const terms = getHistoryDictionaryCatalog();
const databaseCatalog = [
  {
    ...terms[0],
    id: "database-only",
    word: "새 학습용어",
    aliases: ["새 별칭"],
    definition: "서버에서 추가한 새로운 풀이입니다.",
  },
];
assert.equal(
  searchHistoryDictionaryCatalog("새 별칭", 80, databaseCatalog)[0]?.id,
  "database-only",
);
assert.equal(
  searchHistoryDictionaryCatalog("고려", 80, databaseCatalog).length,
  0,
  "Provided database catalog must not search the static bundle",
);
assert.equal(
  searchHistoryDictionaryCatalog("새 별칭", 80, []).length,
  0,
  "Different catalog arrays must not reuse a stale search index",
);
const { getHistoryDictionaryFacet } = load(
  "src/lib/historyDictionaryThemes.ts",
);
assert.equal(
  new Set(terms.map((term) => term.id)).size,
  terms.length,
  "Duplicate catalog ID",
);
assert(
  terms.filter((term) => term.kind === "history").length >= 100,
  "Missing worksheet vocabulary",
);
assert(
  terms.filter((term) => term.kind === "place").length >= 2000,
  "Atlas source coverage shrank",
);

for (const term of terms) {
  assert(term.facetIds?.length, `${term.id}: missing theme classification`);
  assert.equal(new Set(term.facetIds).size, term.facetIds.length);
  for (const id of term.facetIds)
    assert(getHistoryDictionaryFacet(id), `${term.id}: unknown theme ${id}`);
  assert(term.id.startsWith("catalog-"), `${term.word}: unstable ID namespace`);
  assert(
    term.word.trim() && term.definition.trim(),
    `${term.id}: empty content`,
  );
  assert(
    term.definition.length >= 12 &&
      term.definition !== term.word &&
      !term.definition.startsWith(`${term.word} · `),
    `${term.id}: metadata-only definition`,
  );
  assert(term.attributions.length, `${term.id}: missing attribution`);
  for (const source of term.attributions) {
    assert(
      source &&
        source.title &&
        source.author &&
        source.changes &&
        source.retrievedAt,
      `${term.id}: incomplete attribution`,
    );
    if (source.url)
      assert.equal(
        new URL(source.url).protocol,
        "https:",
        `${term.id}: unsafe source URL`,
      );
    if (/wikipedia\.org/u.test(source.url)) {
      assert.equal(source.author, "위키백과 기여자");
      assert.equal(source.license, "CC BY-SA 4.0");
      assert.equal(
        source.licenseUrl,
        "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      );
      assert(
        /oldid=\d+/u.test(source.url),
        `${term.id}: unpinned Wikipedia source`,
      );
    }
  }
  const fullAttribution = getHistoryDictionaryCatalogSource(term);
  for (const source of term.attributions) {
    assert(fullAttribution.includes(source.title));
    assert(fullAttribution.includes(source.changes));
    if (source.licenseUrl) assert(fullAttribution.includes(source.licenseUrl));
  }
}

const { historyAtlasDataset: displayed } = load(
  "src/data/historyAtlasContent.ts",
);
for (const place of displayed.places) {
  assert(
    terms.some((term) => term.atlasPlaceId === place.id),
    `${place.name}: visible map place missing`,
  );
}
const { atlasEastAsiaReferences } = load("src/data/historyAtlasEastAsia.ts");
assert.equal(atlasEastAsiaReferences.length, 41);
for (const reference of atlasEastAsiaReferences) {
  const term = terms.find((item) => item.atlasPlaceId === reference.place.id);
  assert(term, `${reference.place.name}: geographic reference missing`);
  assert.equal(
    term.definition,
    reference.definition,
    `${term.id}: reviewed geographic explanation lost`,
  );
  for (const source of reference.sources)
    assert(
      term.attributions.some((item) => item.url === source.url),
      `${term.id}: reviewed source missing`,
    );
  for (const alias of reference.place.aliases || [])
    assert(
      term.word === alias || term.aliases.includes(alias),
      `${term.id}: geographic search alias missing: ${alias}`,
    );
  assert(term.facetIds.includes("subject:korea"));
  assert(term.facetIds.includes("subject:world"));
}
// The dictionary merges previously published aliases. Keep nearby archaeological
// sites and modern districts from becoming aliases of the reviewed city point.
for (const [placeId, distinctNames] of [
  ["world-9ab745ec51b2", ["성락", "성러", "盛乐", "盛樂"]],
  ["xian", ["함양", "셴양", "咸阳", "咸陽", "Xianyang"]],
  ["beijing", ["요 중경", "요중경", "중경", "요 상경", "요상경"]],
  ["kr-da2cc50b7f4d", ["금 상경", "금상경", "회령부", "아청", "阿城"]],
  ["world-872972e9a3dc", ["린안구", "임안구", "临安区", "臨安區"]],
  ["eastasia-ye", ["안양", "安阳", "安陽"]],
]) {
  const term = terms.find((item) => item.atlasPlaceId === placeId);
  assert(term, `${placeId}: reviewed city missing`);
  for (const name of distinctNames)
    assert(
      !term.aliases.includes(name),
      `${term.word}: distinct location incorrectly merged as alias: ${name}`,
    );
}

const first = (query) => searchHistoryDictionaryCatalog(query, 1)[0];
assert.equal(first("과 전 법").word, "과전법");
assert.equal(first("６조").word, "육조");
assert.equal(first("위화도 회군").word, "위화도 회군");
assert.equal(first("천상열차").word, "천상열차분야지도");
assert.equal(first("가례").word, "가례");
assert(
  first("가례").definition.includes("책"),
  "Worksheet book confused with the general rites",
);
assert.equal(first("사병").kind, "history");
assert(
  first("사병").definition.includes("사적인 군대"),
  "Private army confused with enlisted soldier",
);
assert.equal(first("의정부").kind, "history");
assert(
  first("의정부").definition.includes("정무 기관"),
  "Government office confused with the modern city",
);
assert.equal(
  searchHistoryDictionaryCatalog("없는단어-abcdef-987654321").length,
  0,
);
assert.equal(searchHistoryDictionaryCatalog("", 0).length, 0);
assert.equal(searchHistoryDictionaryCatalog("", 7).length, 7);
assert(
  searchHistoryDictionaryCatalog("조선 수조권").some(
    (term) => term.word === "과전법",
  ),
);
assert(
  searchHistoryDictionaryCatalog("독도").some((term) => term.kind === "place"),
);

const catalogSource = readFileSync(
  "src/lib/historyDictionaryCatalog.ts",
  "utf8",
);
assert(
  !/from ["'].*(?:firebase|historyAtlas)/u.test(catalogSource),
  "Dictionary must load independently of Firestore and the map runtime",
);
const compressedBytes = gzipSync(Buffer.from(JSON.stringify(terms))).length;
assert(
  // Reviewed textbook vocabulary adds roughly 1,000 entries to the original catalog.
  compressedBytes < 380000,
  `Dictionary gzip budget exceeded: ${compressedBytes}`,
);
console.log(
  JSON.stringify({
    terms: terms.length,
    history: terms.filter((term) => term.kind === "history").length,
    places: terms.filter((term) => term.kind === "place").length,
    displayedMapPlaces: displayed.places.length,
    compressedBytes,
  }),
);
