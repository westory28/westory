import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";

const result = await build({
  stdin: {
    contents:
      'export * from "./src/lib/historyDictionaryCatalog.ts"; export * from "./src/lib/historyDictionaryTextbooks.ts"; export * from "./src/lib/historyDictionaryThemes.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
});
const module = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, {
  module,
  exports: module.exports,
});
const api = module.exports;
const base = api.getHistoryDictionaryBaselineCatalog();
const original = JSON.stringify(base);
const terms = api.getHistoryDictionaryCatalog();
const byId = new Map(terms.map((term) => [term.id, term]));
const reviews = api.historyDictionaryTextbookReviews;
assert.equal(reviews.length, 1090, "Reviewed textbook entries changed");
assert.equal(byId.size, terms.length);
assert.equal(
  JSON.stringify(base),
  original,
  "Review mutated the original sources",
);
for (const before of base) {
  const after = byId.get(before.id);
  assert(after, `${before.word}: original entry lost`);
  assert.equal(after.atlasPlaceId, before.atlasPlaceId, "Map link changed");
  for (const source of before.attributions)
    assert(
      after.attributions.some(
        (item) => JSON.stringify(item) === JSON.stringify(source),
      ),
      `${before.word}: original provenance lost`,
    );
}
const normalize = (s) => s.normalize("NFKC").replace(/\s/gu, "");
// The supplied atlas includes four folded spreads, unlike the two textbook PDFs.
const printedPagesFor = ({ book, pdfPage }) => {
  if (book === "history2") return [pdfPage + 2];
  if (book === "history2-sem1") return [pdfPage + 4];
  if (pdfPage <= 16) return [pdfPage];
  if (pdfPage === 17) return [17, 18];
  if (pdfPage === 18) return [19];
  if (pdfPage === 19) return [20, 21];
  if (pdfPage <= 64) return [pdfPage + 2];
  if (pdfPage === 65) return [67, 68];
  if (pdfPage === 66) return [69, 70];
  return [pdfPage + 4];
};
for (const review of reviews) {
  assert(
    review.definition.length >= 12 && review.definition.length <= 260,
    `${review.word}: explanation length`,
  );
  assert(
    !/[\x00-\x1f\uE000-\uF8FF]/u.test(review.word + review.definition),
    `${review.word}: extraction artifact`,
  );
  assert(review.sources.length, `${review.word}: textbook page missing`);
  for (const source of review.sources) {
    assert(api.historyDictionaryTextbookBooks[source.book]);
    assert(
      Number.isInteger(source.pdfPage) &&
        source.pdfPage > 0 &&
        source.pdfPage <= api.historyDictionaryTextbookBooks[source.book].pages,
    );
    assert(
      Number.isInteger(source.printedPage) &&
        source.printedPage > 0 &&
        source.printedPage <= 211,
    );
    assert(
      printedPagesFor(source).includes(source.printedPage),
      `${review.word}: printed page does not match the supplied PDF`,
    );
  }
  const candidates = terms.filter((term) =>
    review.matchId
      ? term.id === review.matchId
      : term.kind === (review.kind || "history") &&
        normalize(term.word) === normalize(review.word),
  );
  assert.equal(
    candidates.length,
    1,
    `${review.word}: ambiguous review destination`,
  );
  const term = candidates[0];
  assert.equal(term.definition, review.definition);
  for (const id of review.facetIds) assert(term.facetIds.includes(id));
  for (const source of term.attributions.filter((item) =>
    item.title.startsWith("비상교육 ·"),
  )) {
    assert(
      !source.license && !source.licenseUrl,
      "Textbook falsely marked open licensed",
    );
    assert(source.title.includes("쪽 (제공 PDF "));
  }
}
for (const term of terms) {
  assert.deepEqual(
    Array.from(api.expandHistoryDictionaryFacetIds(term.facetIds)),
    Array.from(term.facetIds),
    `${term.word}: missing ancestor`,
  );
  for (const id of term.facetIds) {
    const facet = api.getHistoryDictionaryFacet(id);
    if (facet.subjectId)
      assert(
        term.facetIds.includes(facet.subjectId),
        `${term.word}: era subject lost`,
      );
  }
  for (const group of ["subject", "topic"])
    assert(
      api.getHistoryDictionaryTermFacets(term, group).length,
      `${term.word}: ${group}`,
    );
  if (term.kind === "history") {
    assert(
      api.getHistoryDictionaryTermFacets(term, "era").length,
      `${term.word}: era`,
    );
    assert.equal(api.getHistoryDictionaryTermFacets(term, "region").length, 0);
  } else {
    assert(
      api.getHistoryDictionaryTermFacets(term, "region").length,
      `${term.word}: region`,
    );
    if (term.facetIds.includes("region:unconfirmed"))
      assert.equal(
        api.getHistoryDictionaryTermFacets(term, "region").length,
        1,
      );
  }
}
// Representative coverage across all textbook chapters, including short aliases.
for (const word of [
  "간석기",
  "군장",
  "책화",
  "골품제",
  "독서삼품과",
  "호족",
  "노비안검법",
  "전시과",
  "삼별초",
  "팔만대장경",
  "과전법",
  "훈민정음",
  "붕당",
  "탕평책",
  "대동법",
  "세도 정치",
  "실학",
  "동학",
  "갑오개혁",
  "3·1 운동",
  "6월 민주 항쟁",
  "사료",
  "파탈리푸트라",
  "카슈가르",
  "한 군현",
  "우산국",
  "주자(도자기)",
  "국민 국가",
  "민주주의",
  "국내 총생산",
  "권리 청원",
]) {
  assert(
    terms.some((term) =>
      [term.word, ...term.aliases].some(
        (name) => normalize(name) === normalize(word),
      ),
    ),
    `Missing chapter keyword: ${word}`,
  );
}
assert.throws(() =>
  api.applyHistoryDictionaryTextbookReviews(base, [
    { ...reviews[0], matchId: "catalog-history-missing" },
  ]),
);
assert.throws(() =>
  api.applyHistoryDictionaryTextbookReviews(base, [reviews[0], reviews[0]]),
);
assert.throws(
  () =>
    api.applyHistoryDictionaryTextbookReviews(base, [
      { ...reviews[0], word: "다른 장소", matchId: base[0].id },
    ]),
  "Wrong-place IDs must fail before any synchronization",
);
const sixMinistries = base.find(
  (term) => term.word === "육조" && term.kind === "history",
);
const renamed = api
  .applyHistoryDictionaryTextbookReviews(base, [
    { ...reviews[0], word: "6조", matchId: sixMinistries.id },
  ])
  .find((term) => term.id === sixMinistries.id);
assert.equal(
  renamed.word,
  "육조",
  "A textbook spelling must not change a persistent ID",
);
assert(renamed.aliases.includes("6조"));
const referenceOnly = api.applyHistoryDictionaryTextbookReviews(
  [],
  [{ ...reviews[0], word: "검증용 지명", matchId: undefined, kind: "place" }],
)[0];
assert.equal(
  referenceOnly.id,
  `catalog-place-reference-${encodeURIComponent("검증용 지명")}`,
);
assert.equal(
  referenceOnly.atlasPlaceId,
  undefined,
  "New reference place must not invent a map link",
);
const updated = base.filter(
  (before) => byId.get(before.id).definition !== before.definition,
).length;
console.log(
  JSON.stringify({
    reviewed: reviews.length,
    added: terms.length - base.length,
    updated,
    total: terms.length,
    originalSourcesPreserved: true,
  }),
);
