import { historyDictionaryCoreRows } from "../data/historyDictionaryCore";
import { applyHistoryDictionaryTextbookReviews } from "./historyDictionaryTextbooks";
import {
  historyDictionaryCoreClassification,
  historyDictionaryPlaceClassification,
  historyDictionaryFacetSets,
} from "../data/historyDictionaryClassification";
import {
  historyDictionaryPlaceRows,
  historyDictionaryPlaceSources,
} from "../data/historyDictionaryPlaces";

export interface HistoryDictionaryAttribution {
  title: string;
  author: string;
  /** Empty only for existing Westory writing and supplied printed sources. */
  url: string;
  license?: string;
  licenseUrl?: string;
  changes: string;
  retrievedAt: string;
}

export interface HistoryDictionaryCatalogTerm {
  id: string;
  word: string;
  definition: string;
  aliases: string[];
  tags: string[];
  /** Reviewed themes including ancestors; source worksheet tags are not periods. */
  facetIds: string[];
  kind: "history" | "place";
  attributions: HistoryDictionaryAttribution[];
  atlasPlaceId?: string;
}

export type HistoryDictionaryPlaceRow = [
  placeId: string,
  word: string,
  definition: string,
  aliases: string[],
  tags: string[],
  attributionIds: number[],
];

export type HistoryDictionaryCoreRow = [
  word: string,
  definition: string,
  sourceTitle: string,
  revision: number,
  tags: string[],
  aliases: string[],
];

const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("ko").replace(/\s+/gu, "");

let baselineCatalog: HistoryDictionaryCatalogTerm[] | undefined;
let catalog: HistoryDictionaryCatalogTerm[] | undefined;

/** Load this module with import() so reference data is downloaded on demand. */
export const getHistoryDictionaryBaselineCatalog =
  (): HistoryDictionaryCatalogTerm[] => {
    if (baselineCatalog) return baselineCatalog;
    const history: HistoryDictionaryCatalogTerm[] =
      historyDictionaryCoreRows.map(
        ([word, definition, title, revision, tags, aliases]) => ({
          id: `catalog-history-${encodeURIComponent(word)}`,
          word,
          definition,
          aliases,
          tags,
          facetIds:
            historyDictionaryFacetSets[
              historyDictionaryCoreClassification[word]
            ],
          kind: "history",
          attributions: [
            {
              title: `위키백과 · ${title}`,
              author: "위키백과 기여자",
              url: `https://ko.wikipedia.org/w/index.php?oldid=${revision}`,
              license: "CC BY-SA 4.0",
              licenseUrl:
                "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
              changes: "학습용으로 본문 요약·문장 재구성",
              retrievedAt: "2026-10-18",
            },
          ],
        }),
      );
    const places: HistoryDictionaryCatalogTerm[] =
      historyDictionaryPlaceRows.map(
        ([placeId, word, definition, aliases, tags, attributionIds]) => ({
          id: `catalog-place-${placeId}`,
          word,
          definition,
          aliases,
          tags,
          facetIds:
            historyDictionaryFacetSets[
              historyDictionaryPlaceClassification[placeId]
            ],
          kind: "place",
          atlasPlaceId: placeId,
          attributions: attributionIds.map(
            (id) => historyDictionaryPlaceSources[id],
          ),
        }),
      );
    baselineCatalog = [...history, ...places];
    return baselineCatalog;
  };

export const getHistoryDictionaryCatalog = (): HistoryDictionaryCatalogTerm[] =>
  (catalog ||= applyHistoryDictionaryTextbookReviews(
    getHistoryDictionaryBaselineCatalog(),
  ));

const searchIndexes = new WeakMap<
  HistoryDictionaryCatalogTerm[],
  {
    term: HistoryDictionaryCatalogTerm;
    word: string;
    aliases: string[];
    text: string;
  }[]
>();

/** Exact words and aliases precede partial names, then meaning/topic matches. */
export const searchHistoryDictionaryCatalog = (
  query: string,
  limit = 80,
  terms: HistoryDictionaryCatalogTerm[] = getHistoryDictionaryCatalog(),
): HistoryDictionaryCatalogTerm[] => {
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 80;
  if (!count) return [];
  const normalized = normalize(query.trim());
  if (!normalized) return terms.slice(0, count);
  const tokens = query.trim().split(/\s+/u).map(normalize).filter(Boolean);
  let searchIndex = searchIndexes.get(terms);
  if (!searchIndex) {
    searchIndex = terms.map((term) => ({
      term,
      word: normalize(term.word),
      aliases: term.aliases.map(normalize),
      text: normalize(
        [term.word, ...term.aliases, term.definition, ...term.tags].join(" "),
      ),
    }));
    searchIndexes.set(terms, searchIndex);
  }
  return searchIndex
    .flatMap((entry) => {
      const score =
        entry.word === normalized
          ? 0
          : entry.aliases.includes(normalized)
            ? 1
            : entry.word.startsWith(normalized)
              ? 2
              : entry.word.includes(normalized) ||
                  entry.aliases.some((alias) => alias.includes(normalized))
                ? 3
                : tokens.every((token) => entry.text.includes(token))
                  ? 4
                  : -1;
      return score < 0 ? [] : [{ term: entry.term, score }];
    })
    .sort(
      (a, b) =>
        a.score - b.score ||
        (a.term.kind === b.term.kind
          ? 0
          : a.term.kind === "history"
            ? -1
            : 1) ||
        a.term.word.localeCompare(b.term.word, "ko"),
    )
    .slice(0, count)
    .map(({ term }) => term);
};

/** Preserve provenance when a downstream flow copies a catalog definition. */
export const getHistoryDictionaryCatalogSource = (
  term: HistoryDictionaryCatalogTerm,
) =>
  term.attributions
    .map((source) =>
      [
        source.title,
        source.author,
        source.url,
        source.license,
        source.licenseUrl,
        `변경: ${source.changes}`,
        `확인: ${source.retrievedAt}`,
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .join("\n");
