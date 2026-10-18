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
  /** Every selected card tag must match, including tags in the same group. */
  tags: string[];
};

export type HistoryDictionaryBrowseFilterKey = Exclude<
  keyof HistoryDictionaryBrowseFilters,
  "tags"
>;

export const emptyHistoryDictionaryFilters =
  (): HistoryDictionaryBrowseFilters => ({
    kind: "all",
    initial: "",
    subject: "",
    era: "",
    region: "",
    topic: "",
    tags: [],
  });

export function changeHistoryDictionaryFilter(
  previous: HistoryDictionaryBrowseFilters,
  key: HistoryDictionaryBrowseFilterKey,
  value: string,
  facets: HistoryDictionaryFacet[],
): HistoryDictionaryBrowseFilters {
  const next = { ...previous, tags: [...previous.tags], [key]: value };
  if (key === "kind" && value === "history") next.region = "";
  const eraSubject = facets.find((facet) => facet.id === next.era)?.subjectId;
  if (key === "subject" && value && eraSubject && eraSubject !== value)
    next.era = "";
  if (key === "region" && value) next.kind = "place";
  return next;
}

export function isHistoryDictionaryFacetSelected(
  filters: HistoryDictionaryBrowseFilters,
  facet: HistoryDictionaryFacet,
) {
  return filters[facet.group] === facet.id || filters.tags.includes(facet.id);
}

/** Remove this facet from both selection paths without changing other filters. */
export function removeHistoryDictionaryFacet(
  previous: HistoryDictionaryBrowseFilters,
  facet: HistoryDictionaryFacet,
): HistoryDictionaryBrowseFilters {
  return {
    ...previous,
    [facet.group]:
      previous[facet.group] === facet.id ? "" : previous[facet.group],
    tags: previous.tags.filter((id) => id !== facet.id),
  };
}

export function toggleHistoryDictionaryTag(
  previous: HistoryDictionaryBrowseFilters,
  facet: HistoryDictionaryFacet,
): HistoryDictionaryBrowseFilters {
  if (isHistoryDictionaryFacetSelected(previous, facet))
    return removeHistoryDictionaryFacet(previous, facet);
  return { ...previous, tags: [...new Set([...previous.tags, facet.id])] };
}

/** Keep taxonomy order while combining dropdown and card-tag selections. */
export function getHistoryDictionarySelectedFacets(
  filters: HistoryDictionaryBrowseFilters,
  facets: HistoryDictionaryFacet[],
) {
  const seen = new Set<string>();
  return facets.filter((facet) => {
    if (seen.has(facet.id) || !isHistoryDictionaryFacetSelected(filters, facet))
      return false;
    seen.add(facet.id);
    return true;
  });
}

export function filterHistoryDictionaryEntries(
  terms: HistoryDictionaryCatalogTerm[],
  filters: HistoryDictionaryBrowseFilters,
  omit?: HistoryDictionaryBrowseFilterKey,
) {
  return terms.filter(
    (term) =>
      (omit === "kind" ||
        filters.kind === "all" ||
        term.kind === filters.kind) &&
      (omit === "initial" ||
        matchesHistoryDictionaryInitial(term.word, filters.initial)) &&
      filters.tags.every((id) => term.facetIds.includes(id)) &&
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
