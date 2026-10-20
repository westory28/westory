import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { format } from "prettier";

// Reuse the checked atlas corpus without importing its map/story runtime in the
// dictionary. Never import the AKS verbatim-excerpt fallback as open content.
const cache = new Map();
// Update the reviewed geography without rewriting unrelated dictionary entries
// or dropping their published attribution records.
const geographicOnly = process.argv.includes("--geographic-references-only");
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

const { historyAtlasSourceDataset: original, historyAtlasDataset: displayed } =
  load("src/data/historyAtlasContent.ts");
const { getAtlasPlaceProfile, isAtlasSourceContext } = load(
  "src/lib/historyAtlasProfiles.ts",
);
const { historyAtlasReferenceDefinitions } = load(
  "src/data/historyAtlasReferenceDefinitions.ts",
);
const references = new Map(
  historyAtlasReferenceDefinitions.map((entry) => [entry[0], entry]),
);
const { atlasEastAsiaReferences } = load("src/data/historyAtlasEastAsia.ts");
const geographicReferences = new Map(
  atlasEastAsiaReferences.map((reference) => [reference.place.id, reference]),
);
const previous = geographicOnly
  ? load("src/data/historyDictionaryPlaces.ts")
  : { historyDictionaryPlaceRows: [], historyDictionaryPlaceSources: [] };
const previousRows = new Map(
  previous.historyDictionaryPlaceRows.map((row) => [row[0], row]),
);
const displayedPlaces = new Map(
  displayed.places.map((place) => [place.id, place]),
);
const units = new Map(original.units.map((unit) => [unit.id, unit]));
const books = new Map(original.sources.map((source) => [source.id, source]));
const sourceIds = new Map();
const sources = [];
function internSource(source) {
  const key = JSON.stringify(source);
  if (!sourceIds.has(key)) {
    sourceIds.set(key, sources.length);
    sources.push(source);
  }
  return sourceIds.get(key);
}
previous.historyDictionaryPlaceSources.forEach(internSource);
const toSource = (source, retrievedAt = "2026-10-15") => {
  const wikipedia = /https:\/\/(?:ko|en)\.wikipedia\.org\//u.test(source.url);
  return {
    title: source.title,
    author: wikipedia ? "위키백과 기여자" : source.title.split(" · ")[0],
    url: source.url,
    ...(wikipedia
      ? {
          license: "CC BY-SA 4.0",
          licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
        }
      : source.license
        ? {
            license: source.license.split(" · ")[0],
            licenseUrl: source.licenseUrl,
          }
        : {}),
    changes: wikipedia
      ? source.license?.split("변경: ")[1] || "본문 발췌·요약"
      : "위스토리 지도에서 작성한 설명의 참고 자료",
    retrievedAt,
  };
};
const entriesByPlace = new Map();
for (const entry of original.entries) {
  if (!entriesByPlace.has(entry.placeId)) entriesByPlace.set(entry.placeId, []);
  entriesByPlace.get(entry.placeId).push(entry);
}
const result = [...previous.historyDictionaryPlaceRows];
const resultIndices = new Map(result.map((row, index) => [row[0], index]));
const omitted = [];
for (const sourcePlace of original.places) {
  const place = displayedPlaces.get(sourcePlace.id) || sourcePlace;
  const geographicReference = geographicReferences.get(place.id);
  if (geographicOnly && !geographicReference) continue;
  const previousRow = previousRows.get(place.id);
  const entries = entriesByPlace.get(place.id) || [];
  const profile = getAtlasPlaceProfile(place, entries);
  const reference = references.get(place.id);
  let definition;
  let attributionIds;
  // Prefer reviewed map explanations for visible places. Otherwise the already
  // checked revision-based open source definition is the reusable fallback.
  if (geographicReference) {
    definition = geographicReference.definition;
    attributionIds = [
      internSource({
        title: "위스토리 동아시아 역사 지리",
        author: "위스토리",
        url: "",
        changes: "확인한 기관 자료의 지리적 사실을 바탕으로 뜻풀이를 새로 작성",
        retrievedAt: "2026-10-20",
      }),
      ...geographicReference.sources.map((source) =>
        internSource(toSource(source, "2026-10-20")),
      ),
    ];
  } else if (
    reference &&
    (!displayedPlaces.has(place.id) || profile.quality !== "verified")
  ) {
    const [, title, revision, text] = reference;
    definition = text;
    attributionIds = [
      internSource({
        title: `위키백과 · ${title}`,
        author: "위키백과 기여자",
        url: `https://ko.wikipedia.org/w/index.php?oldid=${revision}`,
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
        changes: "발음·번역 표기 생략, 본문 발췌·요약",
        retrievedAt: "2026-10-15",
      }),
    ];
  } else if (
    profile.quality === "verified" &&
    profile.definition.length > place.name.length + 8
  ) {
    definition = profile.definition;
    attributionIds = profile.sources.map((source) =>
      internSource(toSource(source)),
    );
    const wikipedia = profile.sources.some((source) =>
      /wikipedia\.org/u.test(source.url),
    );
    if (!wikipedia) {
      attributionIds.unshift(
        internSource({
          title: "위스토리 역사 지도",
          author: "위스토리",
          url: "",
          changes: "위스토리에서 작성한 지도 설명을 사전 항목으로 편집",
          retrievedAt: "2026-10-18",
        }),
      );
    }
    for (const citation of profile.textbookCitations || []) {
      const book = books.get(citation.sourceId);
      assert(book, `${place.id}: unknown textbook citation`);
      attributionIds.push(
        internSource({
          title: `${book.title} · PDF ${citation.pdfPage}쪽${citation.printedPage ? ` · 인쇄 ${citation.printedPage}쪽` : ""}`,
          author: book.edition,
          url: "",
          changes: "제공 교과서의 역사적 사실을 위스토리에서 요약",
          retrievedAt: "2026-10-15",
        }),
      );
    }
  } else {
    omitted.push({
      id: place.id,
      name: place.name,
      displayed: displayedPlaces.has(place.id),
    });
    continue;
  }
  assert(
    definition && !isAtlasSourceContext(definition),
    `${place.id}: invalid definition`,
  );
  assert(attributionIds.length, `${place.id}: missing provenance`);
  const tags = [
    ...new Set([
      ...(previousRow?.[4] || []),
      ...entries.flatMap((entry) => {
        const unit = units.get(entry.unitId);
        return unit
          ? [unit.subject === "korea" ? "한국사" : "세계사", unit.title]
          : [];
      }),
    ]),
  ];
  const word = previousRow?.[1] || place.name;
  const row = [
    place.id,
    word,
    definition,
    [
      ...new Set(
        [
          ...(previousRow?.[3] || []),
          ...(place.aliases || []),
          ...(word === place.name ? [] : [place.name]),
          place.modernName || "",
        ].filter(Boolean),
      ),
    ],
    tags,
    [...new Set([...(previousRow?.[5] || []), ...attributionIds])],
  ];
  const existingIndex = resultIndices.get(place.id);
  if (existingIndex === undefined) {
    resultIndices.set(place.id, result.length);
    result.push(row);
  } else result[existingIndex] = row;
}
assert(
  omitted.every((place) => !place.displayed),
  "A visible map place has no dictionary definition",
);
assert(
  displayed.places.every((place) => result.some((row) => row[0] === place.id)),
  "A visible map place is missing from the generated dictionary",
);
const output = `// Generated by scripts/build-history-dictionary-places.mjs.\n// Wikipedia-derived texts retain their individual CC BY-SA 4.0 attribution.\n// Other entries are Westory-authored summaries with separate reference sources.\n// No map geometry, student data, or AKS verbatim-excerpt fallback is included.\nimport type { HistoryDictionaryAttribution, HistoryDictionaryPlaceRow } from "../lib/historyDictionaryCatalog";\n\nexport const historyDictionaryPlaceSources: HistoryDictionaryAttribution[] = ${JSON.stringify(sources, null, 2)};\n\nexport const historyDictionaryPlaceRows: HistoryDictionaryPlaceRow[] = [\n${result.map((row) => `  ${JSON.stringify(row)},`).join("\n")}\n];\n`;
writeFileSync(
  "src/data/historyDictionaryPlaces.ts",
  await format(output, { parser: "typescript" }),
);
console.log(
  JSON.stringify({
    places: result.length,
    visibleMapPlaces: displayed.places.length,
    omittedLabelsOrRestrictedExcerpts: omitted.length,
    bytes: Buffer.byteLength(output),
  }),
);
