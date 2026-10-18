import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { HistoryDictionaryCatalogTerm } from "../../lib/historyDictionaryCatalog";
import { useAuth } from "../../contexts/AuthContext";
import { loadHistoryDictionaryCatalog } from "../../lib/historyDictionary";
import { searchHistoryDictionaryCatalog } from "../../lib/historyDictionarySearch";
import {
  HISTORY_DICTIONARY_THEME_HELP,
  historyDictionaryFacets,
  type HistoryDictionaryFacet,
  type HistoryDictionaryFacetGroup,
} from "../../lib/historyDictionaryThemes";
import {
  compareHistoryDictionaryHeadwords,
  changeHistoryDictionaryFilter,
  emptyHistoryDictionaryFilters,
  filterHistoryDictionaryEntries,
  getHistoryDictionaryVisibleBadges,
  getHistoryDictionarySelectedFacets,
  isHistoryDictionaryFacetSelected,
  removeHistoryDictionaryFacet,
  toggleHistoryDictionaryTag,
  type HistoryDictionaryBrowseFilterKey,
} from "../../lib/historyDictionaryBrowse";
import { getHistoryDictionaryInitialCounts } from "../../lib/historyDictionaryInitials";
import HistoryDictionaryInitialFilter from "./HistoryDictionaryInitialFilter";
import InfoHelp from "./InfoHelp";
import "./historyDictionary.css";

interface Props {
  onChoose?: (entry: HistoryDictionaryCatalogTerm) => void;
  chooseLabel?: string;
  disabled?: boolean;
}

const facetGroups: { group: HistoryDictionaryFacetGroup; label: string }[] = [
  { group: "subject", label: "역사" },
  { group: "era", label: "관련 시대" },
  { group: "region", label: "지역" },
  { group: "topic", label: "주제" },
];

export function HistoryDictionaryAttribution({
  entry,
}: {
  entry: HistoryDictionaryCatalogTerm;
}) {
  return (
    <details className="history-dictionary-sources">
      <summary>출처 및 이용 조건</summary>
      {entry.attributions.map((source, index) => (
        <div
          className="history-dictionary-source"
          key={`${source.url}-${index}`}
        >
          {source.url ? (
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.title}
            </a>
          ) : (
            <span>{source.title}</span>
          )}
          <span>{source.author}</span>
          {source.license &&
            (source.licenseUrl ? (
              <a
                href={source.licenseUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {source.license}
              </a>
            ) : (
              <span>{source.license}</span>
            ))}
          {source.changes && <span>{source.changes}</span>}
          {source.retrievedAt && <span>확인일 {source.retrievedAt}</span>}
        </div>
      ))}
    </details>
  );
}

export default function HistoryDictionaryCatalogBrowser({
  onChoose,
  chooseLabel = "내 말로 정리하기",
  disabled = false,
}: Props) {
  const { currentUser, config, configReady } = useAuth();
  const [catalog, setCatalog] = useState<HistoryDictionaryCatalogTerm[]>([]);
  const facets = historyDictionaryFacets;
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(emptyHistoryDictionaryFilters);
  const [visibleCount, setVisibleCount] = useState(12);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const id = useId();
  const resultsRef = useRef<HTMLDivElement>(null);
  const selectedFacetsRef = useRef<HTMLDivElement>(null);
  const facetById = useMemo(
    () => new Map(facets.map((facet) => [facet.id, facet])),
    [facets],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setCatalog([]);
    if (!configReady || !config || !currentUser?.uid) {
      setLoading(!configReady);
      if (configReady) setFailed(true);
      return;
    }
    loadHistoryDictionaryCatalog(config)
      .then((items) => {
        if (active) {
          setCatalog(items);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retry, configReady, config?.year, config?.semester, currentUser]);

  const searched = useMemo(() => {
    const entries = searchHistoryDictionaryCatalog(
      query,
      catalog.length,
      catalog,
    );
    return query.trim()
      ? entries
      : [...entries].sort(compareHistoryDictionaryHeadwords);
  }, [catalog, query]);
  const results = useMemo(
    () => filterHistoryDictionaryEntries(searched, filters),
    [searched, filters],
  );
  const initialCounts = useMemo(
    () =>
      getHistoryDictionaryInitialCounts(
        filterHistoryDictionaryEntries(searched, filters, "initial").map(
          (term) => term.word,
        ),
      ),
    [searched, filters],
  );
  const facetCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    facetGroups.forEach(({ group }) => {
      filterHistoryDictionaryEntries(searched, filters, group).forEach(
        (term) => {
          term.facetIds.forEach((facetId) => {
            if (facetById.get(facetId)?.group === group)
              counts[facetId] = (counts[facetId] || 0) + 1;
          });
        },
      );
    });
    // Switching subjects clears an incompatible era; counts describe that action.
    facets
      .filter((facet) => facet.group === "subject")
      .forEach((facet) => {
        counts[facet.id] = filterHistoryDictionaryEntries(
          searched,
          changeHistoryDictionaryFilter(filters, "subject", facet.id, facets),
        ).length;
      });
    return counts;
  }, [searched, filters, facetById, facets]);
  const hasFilters =
    query.trim() ||
    filters.kind !== "all" ||
    filters.initial ||
    filters.tags.length > 0 ||
    facetGroups.some(({ group }) => filters[group]);

  const changeFilter = (
    key: HistoryDictionaryBrowseFilterKey,
    value: string,
  ) => {
    setFilters((previous) =>
      changeHistoryDictionaryFilter(previous, key, value, facets),
    );
    setVisibleCount(12);
  };
  const reset = () => {
    setQuery("");
    setFilters(emptyHistoryDictionaryFilters());
    setVisibleCount(12);
  };
  const browseInitial = (value: string) => {
    changeFilter("initial", value);
    requestAnimationFrame(() => {
      const resultsElement = resultsRef.current;
      if (!resultsElement) return;
      const stickyTop =
        Number.parseFloat(
          getComputedStyle(resultsElement).getPropertyValue(
            "--history-dictionary-sticky-top",
          ),
        ) || 80;
      const scrollportTop =
        resultsElement
          .closest(".history-dictionary-dialog-body")
          ?.getBoundingClientRect().top || 0;
      if (
        resultsElement.getBoundingClientRect().top <
        scrollportTop + stickyTop
      ) {
        resultsElement.scrollIntoView({ block: "start", behavior: "instant" });
      }
    });
  };
  const browseFacet = (facet: HistoryDictionaryFacet) => {
    setFilters((previous) => toggleHistoryDictionaryTag(previous, facet));
    setVisibleCount(12);
    requestAnimationFrame(() => {
      resultsRef.current?.focus({ preventScroll: true });
      selectedFacetsRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "instant",
      });
    });
  };
  const facetLabel = (facet: HistoryDictionaryFacet) => {
    if (facet.group === "era") {
      const subject = facet.subjectId && facetById.get(facet.subjectId);
      return subject && !filters.subject
        ? `${subject.label} · ${facet.label}`
        : facet.label;
    }
    const parent = facet.parentId && facetById.get(facet.parentId);
    return parent ? `${parent.label} · ${facet.label}` : facet.label;
  };

  return (
    <section
      className="history-dictionary-catalog history-dictionary-initial-region"
      aria-label="기본 사전"
    >
      <div className="ws-filter-bar history-dictionary-search-row">
        <label
          className="history-dictionary-field history-dictionary-query-field"
          htmlFor={`${id}-search`}
        >
          <span>단어·지명 찾기</span>
          <input
            id={`${id}-search`}
            type="search"
            lang="ko"
            value={query}
            placeholder="예: 율령, 한양, 나일강"
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(12);
            }}
          />
        </label>
        <label
          className="history-dictionary-field history-dictionary-kind-field"
          htmlFor={`${id}-kind`}
        >
          <span>종류</span>
          <select
            id={`${id}-kind`}
            value={filters.kind}
            onChange={(event) => changeFilter("kind", event.target.value)}
          >
            <option value="all">전체</option>
            <option value="history">역사 용어</option>
            <option value="place">지명</option>
          </select>
        </label>
        {facetGroups.map(({ group, label }) => (
          <div className="history-dictionary-field" key={group}>
            <div className="history-dictionary-filter-label">
              <label htmlFor={`${id}-${group}`}>
                {group === "era" ? "시대" : label}
              </label>
              {group === "era" && (
                <InfoHelp label="시대·지역 분류 기준">
                  {HISTORY_DICTIONARY_THEME_HELP}
                </InfoHelp>
              )}
            </div>
            <select
              id={`${id}-${group}`}
              aria-label={label}
              title={
                filters[group]
                  ? facetById.get(filters[group])?.label
                  : `${label} 전체`
              }
              value={filters[group]}
              disabled={
                loading ||
                failed ||
                (group === "region" && filters.kind === "history")
              }
              onChange={(event) => changeFilter(group, event.target.value)}
            >
              <option value="">전체</option>
              {facets
                .filter(
                  (facet) =>
                    facet.group === group &&
                    (group !== "era" ||
                      !filters.subject ||
                      !facet.subjectId ||
                      facet.subjectId === filters.subject ||
                      facet.id === filters.era),
                )
                .map((facet) => (
                  <option key={facet.id} value={facet.id}>
                    {facetLabel(facet)} (
                    {(facetCounts[facet.id] || 0).toLocaleString("ko-KR")})
                  </option>
                ))}
            </select>
          </div>
        ))}
      </div>
      {loading ? (
        <p className="history-dictionary-empty" role="status">
          사전을 불러오는 중입니다.
        </p>
      ) : failed ? (
        <div className="history-dictionary-error" role="alert">
          <p>사전을 불러오지 못했습니다.</p>
          <button
            className="history-dictionary-button"
            type="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            다시 불러오기
          </button>
        </div>
      ) : (
        <>
          <div
            className="history-dictionary-active-filters"
            ref={selectedFacetsRef}
          >
            {getHistoryDictionarySelectedFacets(filters, facets).map(
              (facet) => (
                <button
                  type="button"
                  className="history-dictionary-tag is-selected"
                  key={facet.id}
                  onClick={() => {
                    setFilters((previous) =>
                      removeHistoryDictionaryFacet(previous, facet),
                    );
                    setVisibleCount(12);
                  }}
                  aria-label={`${facet.label} 필터 해제`}
                >
                  {facet.label}
                  <span aria-hidden="true">×</span>
                </button>
              ),
            )}
          </div>
          <div className="history-dictionary-initial-layout">
            <div
              className="ws-surface history-dictionary-initial-content history-dictionary-search-results"
              ref={resultsRef}
              tabIndex={-1}
              role="region"
              aria-label="사전 검색 결과"
            >
              <div className="history-dictionary-row history-dictionary-results-heading">
                <p className="history-dictionary-count" role="status">
                  {filters.initial ? `${filters.initial} · ` : ""}
                  {results.length.toLocaleString("ko-KR")}개
                </p>
                {hasFilters && (
                  <button
                    type="button"
                    className="history-dictionary-reset"
                    onClick={reset}
                  >
                    필터 초기화
                  </button>
                )}
              </div>
              {!results.length && (
                <div className="history-dictionary-empty">
                  <p>검색 결과가 없습니다.</p>
                  <button
                    className="history-dictionary-button"
                    type="button"
                    onClick={reset}
                  >
                    전체 단어 보기
                  </button>
                </div>
              )}
              <div className="history-dictionary-catalog-list">
                {results.slice(0, visibleCount).map((entry) => (
                  <article
                    className="history-dictionary-catalog-entry"
                    key={entry.id}
                  >
                    <h3>{entry.word}</h3>
                    <p className="history-dictionary-definition">
                      {entry.definition}
                    </p>
                    <div className="history-dictionary-entry-footer">
                      <div
                        className="history-dictionary-tags"
                        aria-label={`${entry.word} 분류`}
                      >
                        {getHistoryDictionaryVisibleBadges(
                          entry.facetIds,
                          facets,
                        ).map((facet) => (
                          <button
                            key={facet.id}
                            type="button"
                            className="history-dictionary-tag"
                            aria-label={`${facet.label} 태그 ${isHistoryDictionaryFacetSelected(filters, facet) ? "해제" : "추가"}`}
                            aria-pressed={isHistoryDictionaryFacetSelected(
                              filters,
                              facet,
                            )}
                            onClick={() => browseFacet(facet)}
                          >
                            {facet.label}
                          </button>
                        ))}
                      </div>
                      {onChoose && (
                        <button
                          className="history-dictionary-button"
                          type="button"
                          disabled={disabled}
                          onClick={() => onChoose(entry)}
                        >
                          {chooseLabel}
                        </button>
                      )}
                      <HistoryDictionaryAttribution entry={entry} />
                    </div>
                  </article>
                ))}
              </div>
              {results.length > visibleCount && (
                <button
                  className="history-dictionary-button history-dictionary-more"
                  type="button"
                  onClick={() => setVisibleCount((value) => value + 12)}
                >
                  더 보기 ({Math.min(visibleCount, results.length)} /{" "}
                  {results.length.toLocaleString("ko-KR")})
                </button>
              )}
            </div>
            <HistoryDictionaryInitialFilter
              value={filters.initial}
              onChange={browseInitial}
              counts={initialCounts}
              label="사전 첫 글자"
            />
          </div>
        </>
      )}
    </section>
  );
}
