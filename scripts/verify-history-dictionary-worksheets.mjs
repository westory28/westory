import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `
      export * from './src/lib/historyDictionaryCatalog.ts';
      export * from './src/lib/historyDictionaryTextbooks.ts';
      export * from './src/lib/historyDictionaryWorksheets.ts';
      export * from './src/data/historyDictionaryWorksheetSupplement.ts';
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
  metafile: true,
});
assert(
  Object.keys(bundle.metafile.inputs).every(
    (path) => !/firebase|historyAtlas|boundary/iu.test(path),
  ),
  "Worksheet vocabulary must not import map/backend runtime",
);
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module,
  exports: module.exports,
});
const api = module.exports;
const baseline = api.applyHistoryDictionaryTextbookReviews(
  api.getHistoryDictionaryBaselineCatalog(),
);
const original = JSON.stringify(baseline);
const terms = api.applyHistoryDictionaryWorksheetSupplement(baseline);
const byId = new Map(terms.map((term) => [term.id, term]));
assert.equal(
  JSON.stringify(baseline),
  original,
  "Supplement mutated prior catalog",
);
assert.equal(byId.size, terms.length, "Duplicate catalog IDs");
assert.equal(
  api.historyDictionaryWorksheetRows.length,
  112,
  "Reviewed worksheet count changed",
);
assert.equal(
  terms.length - baseline.length,
  112,
  "Worksheet additions missing",
);

for (const previous of baseline) {
  const current = byId.get(previous.id);
  assert(current, `${previous.word}: original entry lost`);
  for (const key of [
    "word",
    "definition",
    "kind",
    "atlasPlaceId",
    "facetIds",
    "tags",
  ])
    assert.equal(
      JSON.stringify(current[key]),
      JSON.stringify(previous[key]),
      `${previous.word}: existing ${key} changed`,
    );
  for (const alias of previous.aliases) assert(current.aliases.includes(alias));
  for (const source of previous.attributions)
    assert(
      current.attributions.some(
        (item) => JSON.stringify(item) === JSON.stringify(source),
      ),
    );
}
const worksheets = new Set();
for (const row of api.historyDictionaryWorksheetRows) {
  const term = byId.get(`catalog-history-${encodeURIComponent(row.word)}`);
  assert(term, `${row.word}: absent from catalog`);
  assert(term.definition.length >= 12 && term.definition.length <= 260);
  assert(
    !/[\uE000-\uF8FF]|堺/u.test(term.word + term.definition),
    "PDF extraction artifact",
  );
  assert(row.worksheets.length, `${row.word}: worksheet evidence absent`);
  for (const number of row.worksheets) {
    assert(Number.isInteger(number) && number >= 1 && number <= 13);
    worksheets.add(number);
    assert(
      term.attributions.some((source) =>
        source.title.includes(api.historyDictionaryWorksheetTitles[number - 1]),
      ),
    );
  }
  for (const source of term.attributions) {
    assert(
      !source.license && !source.licenseUrl,
      "Non-open source falsely assigned open license",
    );
    assert.equal(source.retrievedAt, "2026-11-06");
  }
  const exact = api
    .searchHistoryDictionaryCatalog(row.word, 80, terms)
    .find((item) => item.id === term.id);
  assert(exact, `${row.word}: missing from real search`);
}
assert.equal(worksheets.size, 13, "Not all uploaded worksheets covered");
for (const [query, word] of [
  ["신문고", "신문고"],
  ["申聞鼓", "신문고"],
  ["재조지은", "재조지은"],
  ["병마절도사", "병마절도사"],
  ["8도", "팔도"],
  ["3포", "삼포"],
  ["4불가론", "사불가론"],
  ["건저의", "건저의 사건"],
  ["군신관계", "군신 관계"],
  ["명나라", "명"],
  ["척화", "척화론"],
  ["주화", "주화론"],
  ["폐비윤씨", "폐비 윤씨"],
  ["시전상인", "시전 상인"],
  ["전랑", "전랑"],
  ["자주적", "자주성"],
  ["실용적", "실용"],
  ["세도가문", "세도 가문"],
  ["안동김씨", "안동 김씨"],
  ["풍양조씨", "풍양 조씨"],
  ["여흥민씨", "여흥 민씨"],
]) {
  assert.equal(
    api.searchHistoryDictionaryCatalog(query, 80, terms)[0]?.word,
    word,
    `${query}: wrong first search result`,
  );
}
for (const word of [
  "왕권",
  "재정",
  "정국",
  "포로",
  "온건파",
  "의리",
  "명분",
  "중립",
  "의병장",
  "풍흉",
  "형벌",
  "범람",
  "자문",
  "군사권",
  "실용",
  "자주성",
  "신흥",
  "여론",
  "가문",
  "개혁",
]) {
  const term = terms.find((item) => item.word === word);
  assert(
    term.facetIds.includes("era:common"),
    `${word}: generic concept tied to one period`,
  );
  assert(
    !term.facetIds.some((id) => id.startsWith("region:")),
    `${word}: inferred geographic classification`,
  );
}
const ambiguousFragments = new Set([
  "소수",
  "동국",
  "조선왕조",
  "경신",
  "1년",
  "3년",
  "9",
  "전랑",
]);
for (const row of api.historyDictionaryWorksheetRows)
  assert(
    !row.aliases.some((alias) => ambiguousFragments.has(alias)),
    `${row.word}: ambiguous worksheet fragment`,
  );
assert.match(terms.find((term) => term.word === "신문고").definition, /제한/u);
assert.match(
  terms.find((term) => term.word === "주초위왕").definition,
  /전해지는|설화/u,
);
assert.match(terms.find((term) => term.word === "결수").definition, /생산력/u);
assert.match(
  terms.find((term) => term.word === "인종").definition,
  /조선의 제12대/u,
);
const officer = terms.find((term) => term.word === "전랑");
assert.match(officer.definition, /이조와 병조/u);
assert.notEqual(
  officer.id,
  terms.find((term) => term.word === "이조 전랑")?.id,
);
for (const word of ["세도 가문", "안동 김씨", "풍양 조씨", "여흥 민씨"])
  assert.match(terms.find((term) => term.word === word).definition, /일부/u);
const minFamily = terms.find((term) => term.word === "여흥 민씨");
assert(minFamily.facetIds.includes("era:k-opening"));
assert.match(minFamily.definition, /1873년 고종의 친정 이후/u);
console.log(
  JSON.stringify({
    added: 112,
    aliasTargets: api.historyDictionaryWorksheetAliases.length,
    worksheets: worksheets.size,
    catalogTotal: terms.length,
    preserved: baseline.length,
  }),
);
