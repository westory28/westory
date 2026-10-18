import type { HistoryDictionaryCatalogTerm } from "./historyDictionaryCatalog";
import type {
  HistoryDictionaryFacet,
  HistoryDictionaryFacetGroup,
} from "./historyDictionaryThemes";
import {
  getHistoryDictionaryInitial,
  matchesHistoryDictionaryInitial,
} from "./historyDictionaryInitials";

export type HistoryDictionaryBrowseFilters = Record<
  HistoryDictionaryFacetGroup,
  string
> & {
  kind: "all" | "history" | "place";
  initial: string;
};

export const emptyHistoryDictionaryFilters =
  (): HistoryDictionaryBrowseFilters => ({
    kind: "all",
    initial: "",
    subject: "",
    era: "",
    region: "",
    topic: "",
  });

export function changeHistoryDictionaryFilter(
  previous: HistoryDictionaryBrowseFilters,
  key: keyof HistoryDictionaryBrowseFilters,
  value: string,
  facets: HistoryDictionaryFacet[],
): HistoryDictionaryBrowseFilters {
  const next = { ...previous, [key]: value };
  if (key === "kind" && value === "history") next.region = "";
  const eraSubject = facets.find((facet) => facet.id === next.era)?.subjectId;
  if (key === "subject" && value && eraSubject && eraSubject !== value)
    next.era = "";
  if (key === "region" && value) next.kind = "place";
  return next;
}

export function filterHistoryDictionaryEntries(
  terms: HistoryDictionaryCatalogTerm[],
  filters: HistoryDictionaryBrowseFilters,
  omit?: keyof HistoryDictionaryBrowseFilters,
) {
  return terms.filter(
    (term) =>
      (omit === "kind" ||
        filters.kind === "all" ||
        term.kind === filters.kind) &&
      (omit === "initial" ||
        matchesHistoryDictionaryInitial(term.word, filters.initial)) &&
      (["subject", "era", "region", "topic"] as const).every(
        (group) =>
          omit === group ||
          !filters[group] ||
          term.facetIds.includes(filters[group]),
      ),
  );
}

const collator = new Intl.Collator("ko", {
  numeric: true,
  sensitivity: "base",
});
const initialRank = (word: string) => {
  const initial = getHistoryDictionaryInitial(word);
  return /^[0-9]$/.test(initial)
    ? 0
    : /^[ㄱ-ㅎ]$/.test(initial)
      ? 1
      : /^[a-z]$/.test(initial)
        ? 2
        : 3;
};

export function compareHistoryDictionaryHeadwords(
  a: HistoryDictionaryCatalogTerm,
  b: HistoryDictionaryCatalogTerm,
) {
  return (
    initialRank(a.word) - initialRank(b.word) ||
    collator.compare(a.word, b.word) ||
    a.id.localeCompare(b.id)
  );
}

/** A badge starts a new theme, independent of the previous search or letter. */
export function historyDictionaryFiltersForFacet(
  facet: HistoryDictionaryFacet,
): HistoryDictionaryBrowseFilters {
  return {
    ...emptyHistoryDictionaryFilters(),
    kind: facet.group === "region" ? "place" : "all",
    [facet.group]: facet.id,
  };
}

/** Display specific regions without repeating every ancestor on each entry. */
export function getHistoryDictionaryVisibleBadges(
  ids: string[],
  facets: HistoryDictionaryFacet[],
) {
  const selected = new Set(ids);
  const parents = new Set(
    facets
      .filter((facet) => selected.has(facet.id))
      .map((facet) => facet.parentId),
  );
  return facets.filter(
    (facet) =>
      selected.has(facet.id) &&
      !parents.has(facet.id) &&
      facet.id !== "region:unconfirmed",
  );
}
