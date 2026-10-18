import type { HistoryDictionaryCatalogTerm } from "./historyDictionaryCatalog";

const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("ko").replace(/\s+/gu, "");

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
  terms: HistoryDictionaryCatalogTerm[] = [],
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
