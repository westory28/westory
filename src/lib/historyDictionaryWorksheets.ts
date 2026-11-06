import {
  historyDictionaryWorksheetAliases,
  historyDictionaryWorksheetReferences,
  historyDictionaryWorksheetRows,
  historyDictionaryWorksheetTitles,
} from "../data/historyDictionaryWorksheetSupplement";
import type {
  HistoryDictionaryAttribution,
  HistoryDictionaryCatalogTerm,
} from "./historyDictionaryCatalog";
import {
  expandHistoryDictionaryFacetIds,
  getHistoryDictionaryFacet,
} from "./historyDictionaryThemes";

const worksheetSource = (number: number): HistoryDictionaryAttribution => {
  const title = historyDictionaryWorksheetTitles[number - 1];
  if (!title) throw new Error(`Unknown worksheet reference: ${number}`);
  return {
    title: `위스토리 · ${title}, 1쪽`,
    author: "위스토리",
    url: "",
    changes:
      "업로드 학습지의 용어·문맥 확인 · 뜻풀이는 직접 작성하고 원문·이미지는 수록하지 않음",
    retrievedAt: "2026-11-06",
  };
};

/** Add reviewed worksheet gaps without replacing existing definitions or IDs. */
export const applyHistoryDictionaryWorksheetSupplement = (
  baseline: HistoryDictionaryCatalogTerm[],
): HistoryDictionaryCatalogTerm[] => {
  const terms = new Map(baseline.map((term) => [term.id, term]));
  for (const row of historyDictionaryWorksheetRows) {
    const id = `catalog-history-${encodeURIComponent(row.word)}`;
    if (terms.has(id))
      throw new Error(`Worksheet entry already exists: ${row.word}`);
    const facetIds = expandHistoryDictionaryFacetIds(row.facetIds);
    terms.set(id, {
      id,
      word: row.word,
      definition: row.definition,
      aliases: [...row.aliases],
      facetIds,
      tags: row.facetIds.map(
        (facetId) => getHistoryDictionaryFacet(facetId)!.label,
      ),
      kind: "history",
      attributions: [
        ...row.worksheets.map(worksheetSource),
        ...row.references.map((reference) => {
          const source = historyDictionaryWorksheetReferences[reference];
          if (!source)
            throw new Error(`Unknown worksheet source: ${reference}`);
          return source;
        }),
      ],
    });
  }
  for (const patch of historyDictionaryWorksheetAliases) {
    const previous = terms.get(patch.id);
    if (!previous)
      throw new Error(`Worksheet alias target missing: ${patch.id}`);
    terms.set(previous.id, {
      ...previous,
      aliases: [...new Set([...previous.aliases, ...patch.aliases])],
      attributions: [
        ...previous.attributions,
        ...patch.worksheets.map(worksheetSource),
      ],
    });
  }
  return [...terms.values()];
};
