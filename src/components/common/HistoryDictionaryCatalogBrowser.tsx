import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { HistoryDictionaryCatalogTerm } from "../../lib/historyDictionaryCatalog";
import "./historyDictionary.css";

interface Props {
  onChoose?: (entry: HistoryDictionaryCatalogTerm) => void;
  chooseLabel?: string;
  disabled?: boolean;
}

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
  const [catalog, setCatalog] = useState<HistoryDictionaryCatalogTerm[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "history" | "place">("all");
  const [visibleCount, setVisibleCount] = useState(12);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const searchCatalog =
    useRef<
      typeof import("../../lib/historyDictionaryCatalog").searchHistoryDictionaryCatalog
    >();
  const id = useId();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    import("../../lib/historyDictionaryCatalog")
      .then((module) => {
        if (active) {
          searchCatalog.current = module.searchHistoryDictionaryCatalog;
          setCatalog(module.getHistoryDictionaryCatalog());
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
  }, [retry]);

  const results = useMemo(() => {
    return (searchCatalog.current?.(query, catalog.length) || []).filter(
      (entry) => kind === "all" || kind === entry.kind,
    );
  }, [catalog, kind, query]);

  return (
    <section className="history-dictionary-catalog" aria-label="기본 사전">
      <div className="history-dictionary-search-row">
        <label className="history-dictionary-field" htmlFor={`${id}-search`}>
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
        <label className="history-dictionary-field" htmlFor={`${id}-kind`}>
          <span>분류</span>
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as typeof kind);
              setVisibleCount(12);
            }}
          >
            <option value="all">전체</option>
            <option value="history">역사 용어</option>
            <option value="place">지명</option>
          </select>
        </label>
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
          <p className="history-dictionary-count" role="status">
            {results.length.toLocaleString("ko-KR")}개
          </p>
          {!results.length && (
            <div className="history-dictionary-empty">
              <p>검색 결과가 없습니다.</p>
              <button
                className="history-dictionary-button"
                type="button"
                onClick={() => {
                  setQuery("");
                  setKind("all");
                }}
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
                <div className="history-dictionary-row">
                  <h3>{entry.word}</h3>
                  <span className="history-dictionary-count">
                    {entry.kind === "place" ? "지명" : "역사 용어"}
                  </span>
                </div>
                <p className="history-dictionary-definition">
                  {entry.definition}
                </p>
                {entry.tags.length > 0 && (
                  <p className="history-dictionary-count">
                    {entry.tags.slice(0, 3).join(" · ")}
                  </p>
                )}
                <HistoryDictionaryAttribution entry={entry} />
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
        </>
      )}
    </section>
  );
}
