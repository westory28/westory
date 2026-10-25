import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import InfoHelp from "../../../components/common/InfoHelp";
import { useAuth } from "../../../contexts/AuthContext";
import { getAssessmentSemesterId } from "../../../lib/assessmentRelease";
import { formatMockExamRoundLabel } from "../../../lib/mockExamRounds";
import { acquirePageScrollLock } from "../../../lib/pageScrollLock";
import {
  QUIZ_BEHAVIOR_LABELS,
  type QuizResponseBehavior,
} from "../../../lib/quizAnalysis";
import {
  getQuizClassCatalog,
  getQuizClassDetail,
  getQuizClassSummary,
  quizClassAnalysisError,
  type QuizClassCatalog,
  type QuizClassDetail,
  type QuizClassScope,
  type QuizClassSummary,
  type QuizClassSummaryResponse,
} from "../../../lib/quizClassAnalysis";
import type { QuizQuestionDraft } from "./QuizEditor";
import type { Question, TreeUnit } from "./QuizBankTab";
import QuizAnalysisView, { QuizBehaviorHelp } from "./QuizAnalysisView";
import { adaptQuizAnalysisRecords } from "./useQuizAnalysisData";
import "./QuizClassAnalysis.css";

const percent = (part: number, total: number) =>
  total ? `${Math.round((part / total) * 100)}%` : "—";
const score = (value: number | null, keywordScope = false) =>
  value === null
    ? "—"
    : `${Math.round(value * 10) / 10}${keywordScope ? "%" : "점"}`;
const assessmentLabel = (category: string, round: string) =>
  category === "exam_prep"
    ? formatMockExamRoundLabel(round)
    : { diagnostic: "진단평가", formative: "형성평가" }[category] || "평가";
const timeLabel = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Seoul",
      }).format(date)
    : "갱신 시각 확인 불가";
};

interface DetailState {
  classId: string;
  classLabel: string;
  scope: QuizClassScope;
  data: QuizClassDetail;
  behaviorFilter?: QuizResponseBehavior["category"];
}
const behaviorColumns: QuizResponseBehavior["category"][] = [
  "suspected_guessing",
  "repeated_choice",
  "unflagged",
  "insufficient",
];

export default function QuizClassAnalysis({
  canEdit,
  onEdit,
  onDerive,
  onDetailData,
  editedQuestions,
  refreshVersion,
}: {
  canEdit: boolean;
  onEdit: (question: Question) => void;
  onDerive?: (question: QuizQuestionDraft) => void;
  onDetailData: (questions: Question[], tree: TreeUnit[]) => void;
  editedQuestions: Question[];
  refreshVersion: number;
}) {
  const { config, currentUser, authGeneration } = useAuth();
  const semesterId = getAssessmentSemesterId(config);
  const identityKey = `${currentUser?.uid || ""}:${authGeneration}:${semesterId}`;
  const identityRef = useRef(identityKey);
  identityRef.current = identityKey;
  const requestId = useRef(0);
  const detailRequestId = useRef(0);
  const [catalog, setCatalog] = useState<QuizClassCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [bigUnitId, setBigUnitId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [classId, setClassId] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparisonGrade, setComparisonGrade] = useState("");
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [summary, setSummary] = useState<QuizClassSummaryResponse | null>(null);
  const [loadedScope, setLoadedScope] = useState<QuizClassScope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [detailLoading, setDetailLoading] = useState("");
  const [detailError, setDetailError] = useState("");
  const [failedDetailId, setFailedDetailId] = useState("");
  const detailRef = useRef<HTMLDialogElement>(null);
  const detailOpeners = useRef(new Map<string, HTMLButtonElement>());
  const detailTrigger = useRef<HTMLElement | null>(null);
  const detailFilter = useRef<QuizResponseBehavior["category"]>();
  const comparisonButton = useRef<HTMLButtonElement>(null);
  const comparisonPanel = useRef<HTMLDivElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const reloadVersion = useRef(refreshVersion);
  const savedAssessment = useRef<{
    scope: QuizClassScope;
    data: QuizClassSummaryResponse;
  } | null>(null);
  const comparisonId = useId();
  const dialogTitleId = useId();

  useEffect(() => {
    let active = true;
    ++requestId.current;
    ++detailRequestId.current;
    savedAssessment.current = null;
    setCatalog(null);
    setCatalogLoading(true);
    setCatalogError("");
    setBigUnitId("");
    setUnitId("");
    setAssessmentId("");
    setClassId("");
    setCompareIds([]);
    setComparisonGrade("");
    setComparisonOpen(false);
    setSearchOpen(false);
    setKeyword("");
    setSummary(null);
    setLoadedScope(null);
    setDetail(null);
    setLoading(false);
    setDetailLoading("");
    setError("");
    setDetailError("");
    setFailedDetailId("");
    if (!currentUser) {
      setCatalogLoading(false);
      return () => {
        active = false;
      };
    }
    void getQuizClassCatalog(semesterId, identityKey)
      .then((data) => {
        if (!active || identityRef.current !== identityKey) return;
        if (data.semesterId !== semesterId)
          throw new Error("Semester mismatch");
        setCatalog(data);
      })
      .catch((failure) => {
        if (active && identityRef.current === identityKey)
          setCatalogError(quizClassAnalysisError(failure));
      })
      .finally(() => {
        if (active && identityRef.current === identityKey)
          setCatalogLoading(false);
      });
    return () => {
      active = false;
      ++requestId.current;
      ++detailRequestId.current;
    };
  }, [identityKey, semesterId, catalogVersion, currentUser]);

  const unitGroups = useMemo(() => {
    if (!catalog) return [];
    const titles = new Map(
      catalog.assessments.map((entry) => [
        entry.unitId,
        entry.unitTitle || entry.title,
      ]),
    );
    const assigned = new Set<string>();
    const groups = catalog.treeData
      .map((big) => ({
        id: big.id,
        label: big.title,
        units: (big.children || [])
          .filter((mid) => titles.has(mid.id))
          .map((mid) => {
            assigned.add(mid.id);
            return { id: mid.id, label: mid.title || titles.get(mid.id)! };
          }),
      }))
      .filter((big) => big.units.length);
    const others = [...titles]
      .filter(([id]) => !assigned.has(id))
      .map(([id, label]) => ({ id, label }));
    if (others.length)
      groups.push({ id: "__other", label: "기타 평가", units: others });
    return groups;
  }, [catalog]);
  const units = unitGroups.find((group) => group.id === bigUnitId)?.units || [];
  const assessments =
    catalog?.assessments.filter((entry) => entry.unitId === unitId) || [];
  const assessment = assessments.find((entry) => entry.id === assessmentId);
  const selectedClass = catalog?.classes.find((entry) => entry.id === classId);
  const grades = [
    ...new Set(
      catalog?.classes.map((entry) => entry.grade).filter(Boolean) || [],
    ),
  ];
  const classIds = [classId, ...compareIds].filter(Boolean);
  const queryKeyword = searchOpen
    ? keyword.normalize("NFC").trim().replace(/\s+/g, " ")
    : "";
  const canQuery =
    !!classId &&
    (searchOpen ? !!queryKeyword : !!assessment) &&
    !catalogLoading &&
    !loading;

  const clearResult = (clearSaved = true) => {
    ++requestId.current;
    ++detailRequestId.current;
    if (clearSaved) savedAssessment.current = null;
    setSummary(null);
    setLoadedScope(null);
    setDetail(null);
    setLoading(false);
    setDetailLoading("");
    setError("");
    setDetailError("");
    setFailedDetailId("");
  };
  const closeSearch = () => {
    clearResult(false);
    setSearchOpen(false);
    setKeyword("");
    const previous = savedAssessment.current;
    if (previous) {
      setSummary(previous.data);
      setLoadedScope(previous.scope);
    }
    requestAnimationFrame(() =>
      searchButton.current?.focus({ preventScroll: true }),
    );
  };
  const loadSummary = async (forceRefresh = false, reuseScope = false) => {
    if (!reuseScope && (!classId || (searchOpen ? !queryKeyword : !assessment)))
      return;
    if (reuseScope && !loadedScope) return;
    const scope: QuizClassScope =
      reuseScope && loadedScope
        ? loadedScope
        : {
            semesterId,
            unitId: queryKeyword ? "" : assessment!.unitId,
            category: queryKeyword ? "" : assessment!.category,
            examRound: queryKeyword ? "" : assessment!.examRound || "",
            classIds,
            ...(queryKeyword ? { keyword: queryKeyword } : {}),
            ...(comparisonGrade ? { comparisonGrade } : {}),
          };
    const run = ++requestId.current;
    ++detailRequestId.current;
    setComparisonOpen(false);
    setLoading(true);
    setError("");
    setLoadedScope(scope);
    setSummary(null);
    setDetail(null);
    setDetailError("");
    setDetailLoading("");
    setFailedDetailId("");
    try {
      const data = await getQuizClassSummary(scope, identityKey, forceRefresh);
      if (run !== requestId.current || identityRef.current !== identityKey)
        return;
      if (
        data.semesterId !== scope.semesterId ||
        data.unitId !== scope.unitId ||
        data.category !== scope.category ||
        (data.examRound || "") !== scope.examRound ||
        (data.keyword || "") !== (scope.keyword || "") ||
        data.classes.length !== scope.classIds.length ||
        new Set(data.classes.map((row) => row.classId)).size !==
          scope.classIds.length ||
        data.classes.some(
          (row) =>
            !scope.classIds.includes(row.classId) || row.complete === false,
        ) ||
        (scope.comparisonGrade &&
          (data.gradeComparison?.grade !== scope.comparisonGrade ||
            data.gradeComparison.complete === false))
      )
        throw new Error("Analysis scope mismatch");
      setLoadedScope(scope);
      setSummary(data);
      if (!scope.keyword) savedAssessment.current = { scope, data };
    } catch (failure) {
      if (run === requestId.current && identityRef.current === identityKey)
        setError(quizClassAnalysisError(failure));
    } finally {
      if (run === requestId.current && identityRef.current === identityKey)
        setLoading(false);
    }
  };
  const loadDetail = async (
    row: QuizClassSummary,
    forceRefresh = false,
    behaviorFilter?: QuizResponseBehavior["category"],
  ) => {
    if (!loadedScope) return;
    const run = ++detailRequestId.current;
    const { comparisonGrade: _comparisonGrade, ...detailScope } = loadedScope;
    const scope = { ...detailScope, classIds: [row.classId] };
    detailFilter.current = behaviorFilter || detail?.behaviorFilter;
    if (!detail && document.activeElement instanceof HTMLElement)
      detailTrigger.current = document.activeElement;
    setComparisonOpen(false);
    setDetailLoading(row.classId);
    setDetailError("");
    setFailedDetailId("");
    try {
      const data = await getQuizClassDetail(scope, identityKey, forceRefresh);
      if (
        run !== detailRequestId.current ||
        identityRef.current !== identityKey
      )
        return;
      if (
        data.complete === false ||
        data.students.some((student) => student.classId !== row.classId) ||
        (data.keyword || "") !== (scope.keyword || "")
      )
        throw new Error("Detail scope mismatch");
      onDetailData(data.questions, data.treeData);
      setDetail({
        classId: row.classId,
        classLabel: row.label,
        scope,
        data,
        behaviorFilter: detailFilter.current,
      });
    } catch (failure) {
      if (
        run === detailRequestId.current &&
        identityRef.current === identityKey
      ) {
        setDetailError(quizClassAnalysisError(failure));
        setFailedDetailId(row.classId);
      }
    } finally {
      if (
        run === detailRequestId.current &&
        identityRef.current === identityKey
      )
        setDetailLoading("");
    }
  };
  const closeDetail = () => {
    ++detailRequestId.current;
    detailRef.current?.close();
    setDetail(null);
    setDetailLoading("");
    setDetailError("");
    setFailedDetailId("");
  };
  const detailClassId = detail?.classId;
  useEffect(() => {
    const dialog = detailRef.current;
    if (!detailClassId || !dialog) return;
    const release = acquirePageScrollLock();
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.close();
      release();
      const opener = detailTrigger.current?.isConnected
        ? detailTrigger.current
        : detailOpeners.current.get(detailClassId);
      opener?.focus({ preventScroll: true });
    };
  }, [detailClassId]);
  useEffect(() => {
    if (!comparisonOpen) return;
    const position = () => {
      const button = comparisonButton.current;
      const panel = comparisonPanel.current;
      if (!button || !panel) return;
      const bounds = button.getBoundingClientRect();
      panel.style.left = `${Math.max(16, Math.min(bounds.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 16))}px`;
      panel.style.top = `${Math.max(16, Math.min(bounds.bottom + 8, window.innerHeight - panel.offsetHeight - 16))}px`;
    };
    position();
    comparisonPanel.current
      ?.querySelector<HTMLInputElement>("input:not(:disabled)")
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (
        !comparisonPanel.current?.contains(event.target as Node) &&
        !comparisonButton.current?.contains(event.target as Node)
      )
        setComparisonOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setComparisonOpen(false);
        comparisonButton.current?.focus();
      }
    };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [comparisonOpen]);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    if (reloadVersion.current === refreshVersion) return;
    reloadVersion.current = refreshVersion;
    savedAssessment.current = null;
    if (summary) void loadSummary(true, true);
  }, [refreshVersion]);
  const detailRecords = useMemo(
    () =>
      detail
        ? adaptQuizAnalysisRecords(
            detail.data.rawRows,
            detail.data.students,
            semesterId,
          )
        : null,
    [detail, semesterId],
  );
  const loadedAssessment = catalog?.assessments.find(
    (entry) =>
      entry.unitId === loadedScope?.unitId &&
      entry.category === loadedScope.category &&
      (entry.examRound || "") === loadedScope.examRound,
  );
  const resultTitle = loadedScope?.keyword
    ? `전체 단원 · “${loadedScope.keyword}” 검색`
    : loadedAssessment
      ? `${loadedAssessment.unitTitle || loadedAssessment.title} · ${assessmentLabel(loadedAssessment.category, loadedAssessment.examRound)}`
      : "평가 결과";
  const rows = summary
    ? [
        ...summary.classes,
        ...(summary.gradeComparison ? [summary.gradeComparison] : []),
      ]
    : [];

  return (
    <section className="quiz-class-analysis" aria-label="학급별 평가 분석">
      <div className="qca-toolbar-scroll">
        <form
          className="ws-filter-bar qca-filters"
          onSubmit={(event) => {
            event.preventDefault();
            if (canQuery) void loadSummary();
          }}
        >
          <label className="qca-unit">
            대단원
            <select
              aria-label="분석할 대단원"
              value={bigUnitId}
              disabled={catalogLoading || !unitGroups.length}
              onChange={(event) => {
                clearResult();
                setBigUnitId(event.target.value);
                setUnitId("");
                setAssessmentId("");
              }}
            >
              <option value="">대단원 선택</option>
              {unitGroups.map((unit) => (
                <option value={unit.id} key={unit.id}>
                  {unit.label}
                </option>
              ))}
            </select>
          </label>
          <label className="qca-unit">
            중단원
            <select
              aria-label="분석할 중단원"
              value={unitId}
              disabled={catalogLoading || !units.length}
              onChange={(event) => {
                clearResult();
                setUnitId(event.target.value);
                setAssessmentId(
                  catalog?.assessments.find(
                    (entry) => entry.unitId === event.target.value,
                  )?.id || "",
                );
              }}
            >
              <option value="">중단원 선택</option>
              {units.map((unit) => (
                <option value={unit.id} key={unit.id}>
                  {unit.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            평가
            <select
              aria-label="분석할 평가"
              value={assessmentId}
              disabled={catalogLoading || !assessments.length}
              onChange={(event) => {
                clearResult();
                setAssessmentId(event.target.value);
              }}
            >
              <option value="">평가 선택</option>
              {assessments.map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {assessmentLabel(entry.category, entry.examRound)}
                </option>
              ))}
            </select>
          </label>
          <label>
            학급
            <select
              aria-label="분석할 학급"
              value={classId}
              disabled={catalogLoading || !catalog?.classes.length}
              onChange={(event) => {
                clearResult();
                setClassId(event.target.value);
                setCompareIds((ids) =>
                  ids.filter((id) => id !== event.target.value),
                );
                if (comparisonGrade)
                  setComparisonGrade(
                    catalog?.classes.find(
                      (entry) => entry.id === event.target.value,
                    )?.grade || "",
                  );
              }}
            >
              <option value="">학급 선택</option>
              {catalog?.classes.map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <div className="qca-filter-actions">
            <button type="submit" className="qca-primary" disabled={!canQuery}>
              {loading ? "조회 중…" : "결과 조회"}
            </button>
            <button
              ref={comparisonButton}
              type="button"
              className={`qca-icon-button${compareIds.length || comparisonGrade ? " is-active" : ""}`}
              aria-label="학급 비교"
              title="학급 비교"
              aria-expanded={comparisonOpen}
              aria-controls={comparisonOpen ? comparisonId : undefined}
              onClick={() => setComparisonOpen(!comparisonOpen)}
              disabled={!classId || catalogLoading}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              >
                <path d="M3 5h8m4 0h6M3 12h3m4 0h11M3 19h11m4 0h3M11 2v6M6 9v6M14 16v6" />
              </svg>
              {(compareIds.length > 0 || comparisonGrade) && (
                <span className="qca-filter-count">
                  {compareIds.length + (comparisonGrade ? 1 : 0)}
                </span>
              )}
            </button>
            <div className="qca-search">
              {searchOpen && (
                <div className="qca-search-input">
                  <label
                    className="qca-sr-only"
                    htmlFor={`${comparisonId}-search`}
                  >
                    전체 단원 문항 검색
                  </label>
                  <input
                    ref={searchInput}
                    id={`${comparisonId}-search`}
                    type="search"
                    value={keyword}
                    maxLength={80}
                    placeholder="전체 단원 문항 검색"
                    onChange={(event) => setKeyword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        closeSearch();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="qca-icon-button"
                    aria-label="검색 해제"
                    title="검색 해제"
                    onClick={closeSearch}
                  >
                    <CloseIcon />
                  </button>
                </div>
              )}
              <button
                ref={searchButton}
                type="button"
                className="qca-icon-button"
                aria-label={
                  searchOpen ? "전체 단원 검색 실행" : "전체 단원 검색"
                }
                title={searchOpen ? "전체 단원 검색 실행" : "전체 단원 검색"}
                aria-expanded={searchOpen}
                disabled={
                  catalogLoading ||
                  (searchOpen && (!queryKeyword || !classId || loading))
                }
                onClick={() => {
                  if (searchOpen) void loadSummary();
                  else setSearchOpen(true);
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                >
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="m16 16 5 5" />
                </svg>
              </button>
            </div>
          </div>
        </form>
      </div>
      {comparisonOpen &&
        createPortal(
          <div
            ref={comparisonPanel}
            id={comparisonId}
            className="qca-comparison-popover"
            role="dialog"
            aria-label="학급 비교 설정"
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                !comparisonButton.current?.contains(event.relatedTarget)
              )
                setComparisonOpen(false);
            }}
          >
            <div className="qca-section-heading">
              <strong>학급 비교</strong>
              <span className="qca-muted">최대 4개 학급</span>
            </div>
            <fieldset className="qca-compare-select">
              <legend className="qca-sr-only">비교할 학급</legend>
              {catalog?.classes.map((entry) => (
                <label key={entry.id}>
                  <input
                    type="checkbox"
                    checked={
                      entry.id === classId || compareIds.includes(entry.id)
                    }
                    disabled={
                      entry.id === classId ||
                      (!compareIds.includes(entry.id) && compareIds.length >= 3)
                    }
                    onChange={(event) => {
                      clearResult();
                      setCompareIds((ids) =>
                        event.target.checked
                          ? [...ids, entry.id]
                          : ids.filter((id) => id !== entry.id),
                      );
                    }}
                  />
                  {entry.label}
                </label>
              ))}
            </fieldset>
            <div className="qca-grade-comparison">
              <label>
                <input
                  type="checkbox"
                  checked={!!comparisonGrade}
                  disabled={!selectedClass?.grade && !grades.length}
                  onChange={(event) => {
                    clearResult();
                    setComparisonGrade(
                      event.target.checked
                        ? selectedClass?.grade || grades[0]
                        : "",
                    );
                  }}
                />
                {comparisonGrade || selectedClass?.grade || grades[0]}학년 전체
                평균
              </label>
              <InfoHelp label="학년 전체 평균 집계 기준">
                해당 학년의 모든 학급을 합친 값입니다. 학급 평균의 단순 평균이
                아니라 점수가 확인된 학생 수로 가중합니다.
              </InfoHelp>
              {grades.length > 1 && !!comparisonGrade && (
                <select
                  aria-label="비교할 전체 학년"
                  value={comparisonGrade}
                  onChange={(event) => {
                    clearResult();
                    setComparisonGrade(event.target.value);
                  }}
                >
                  {grades.map((grade) => (
                    <option value={grade} key={grade}>
                      {grade}학년
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button
              type="button"
              className="qca-secondary qca-comparison-done"
              onClick={() => {
                setComparisonOpen(false);
                comparisonButton.current?.focus();
              }}
            >
              선택 완료
            </button>
          </div>,
          document.body,
        )}
      {catalogLoading ? (
        <p role="status" className="qca-empty">
          평가와 학급 목록을 불러오는 중입니다.
        </p>
      ) : catalogError ? (
        <div role="alert" className="qca-error">
          {catalogError}
          <button
            type="button"
            onClick={() => setCatalogVersion((value) => value + 1)}
          >
            다시 시도
          </button>
        </div>
      ) : !catalog?.assessments.length ? (
        <p className="qca-empty">등록된 평가가 없습니다.</p>
      ) : !catalog.classes.length ? (
        <p className="qca-empty">조회할 학급이 없습니다.</p>
      ) : !summary && !error && !loading ? (
        <p className="qca-empty">
          평가와 학급을 선택한 뒤 결과를 조회해 주세요.
        </p>
      ) : null}
      {error && (
        <div role="alert" className="qca-error">
          {error}
          <button
            type="button"
            onClick={() => void loadSummary(false, true)}
            disabled={loading}
          >
            다시 조회
          </button>
        </div>
      )}
      {loading && (
        <p className="qca-empty" role="status">
          선택한 학급의 결과를 불러오는 중입니다.
        </p>
      )}
      {summary && (
        <>
          <div className="qca-result-heading">
            <h2>{resultTitle}</h2>
            {summary.search && (
              <span className="qca-muted">
                {summary.search.unitCount}개 단원 ·{" "}
                {summary.search.matchedQuestionCount}문항
              </span>
            )}
            <button
              type="button"
              className="qca-secondary"
              onClick={() => void loadSummary(true, true)}
              disabled={loading}
            >
              최신 결과 조회
            </button>
          </div>
          {summary.search?.matchedQuestionCount === 0 ? (
            <p className="qca-empty">검색어와 일치하는 문항이 없습니다.</p>
          ) : (
            <>
              <section
                className="qca-section"
                aria-label="학급별 제출과 최근 점수"
              >
                <div className="qca-section-heading">
                  <h3>{rows.length > 1 ? "학급별 결과 비교" : "학급 결과"}</h3>
                  <InfoHelp label="학급 결과 집계 기준">
                    {loadedScope?.keyword
                      ? "전체 단원의 검색 문항에 남긴 현재 버전의 마지막 응답을 집계합니다. 평균은 학생별 검색 문항 정답률의 평균이며, 응답 문항 수는 학생마다 다를 수 있습니다."
                      : "현재 학급 명단을 기준으로 집계합니다. 제출은 한 번 이상 제출한 학생 수, 평균과 점수 분포는 학생별 마지막 공식 제출 점수입니다."}{" "}
                    무작위 출제와 재응시 횟수가 달라 학급 순위로 해석하지
                    않습니다. 20명 미만의 평균에는 소표본을 표시합니다.
                  </InfoHelp>
                  <span className="qca-muted qca-summary-time">
                    조회 {timeLabel(summary.generatedAt)}
                  </span>
                  <InfoHelp label="학급별 집계 시각">
                    {rows.map((row) => (
                      <span className="qca-help-row" key={row.classId}>
                        {row.label}: {timeLabel(row.generatedAt)}
                      </span>
                    ))}
                  </InfoHelp>
                </div>
                <div
                  className="qca-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="학급별 결과 표"
                >
                  <table className="qca-table qca-summary-table">
                    <thead>
                      <tr>
                        <th scope="col">학급</th>
                        <th scope="col">
                          {loadedScope?.keyword ? "응답 / 인원" : "제출 / 인원"}
                        </th>
                        <th scope="col">
                          {loadedScope?.keyword ? "미응답" : "미제출"}
                        </th>
                        <th scope="col">
                          {loadedScope?.keyword
                            ? "검색 문항 평균"
                            : "최근 평균"}
                        </th>
                        <th scope="col">
                          {loadedScope?.keyword ? "정답률 분포" : "점수 분포"}{" "}
                          <span className="qca-muted">(%)</span>
                          <InfoHelp label="분포 그래프 읽는 법">
                            아래 숫자는{" "}
                            {loadedScope?.keyword ? "정답률" : "점수"} 구간, 위
                            숫자와 막대 높이는 해당 구간의 학생 비율입니다. 모든
                            학급에 같은 0~100% 세로 눈금을 적용합니다. 각 구간은
                            상한 미만이며 마지막 구간은 100까지 포함합니다.
                          </InfoHelp>
                        </th>
                        <th scope="col">상세</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const aggregate =
                          row.classId === summary.gradeComparison?.classId;
                        return (
                          <tr
                            key={row.classId}
                            className={
                              aggregate ? "qca-benchmark-row" : undefined
                            }
                          >
                            <th scope="row">
                              {row.label}
                              {aggregate && (
                                <span className="qca-inline-note">
                                  {summary.gradeComparison!.classCount}개 학급
                                </span>
                              )}
                            </th>
                            <td>
                              <strong>
                                {row.submittedCount} / {row.rosterCount}명
                              </strong>
                              <span className="qca-inline-note">
                                {percent(row.submittedCount, row.rosterCount)}
                              </span>
                            </td>
                            <td>{row.unsubmittedCount}명</td>
                            <td>
                              <strong>
                                {score(
                                  row.averageScore,
                                  !!loadedScope?.keyword,
                                )}
                              </strong>
                              {row.smallSample && row.scoredCount > 0 && (
                                <span className="qca-inline-note">소표본</span>
                              )}
                              {!!row.missingScoreCount && (
                                <InfoHelp label={`${row.label} 평균 제외 인원`}>
                                  점수가 확인되지 않은 {row.missingScoreCount}
                                  명은 평균과 분포에서 제외했습니다. 점수 확인{" "}
                                  {row.scoredCount}명.
                                </InfoHelp>
                              )}
                            </td>
                            <td>
                              <CompactDistribution
                                row={row}
                                keywordScope={!!loadedScope?.keyword}
                              />
                            </td>
                            <td>
                              {!aggregate && (
                                <button
                                  ref={(button) => {
                                    if (button)
                                      detailOpeners.current.set(
                                        row.classId,
                                        button,
                                      );
                                    else
                                      detailOpeners.current.delete(row.classId);
                                  }}
                                  type="button"
                                  aria-label={`문항·학생 상세 ${row.label}`}
                                  className="qca-secondary"
                                  onClick={() => void loadDetail(row)}
                                  disabled={!!detailLoading}
                                >
                                  {detailLoading === row.classId
                                    ? "조회 중…"
                                    : "문항·학생"}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="qca-section" aria-label="풀이 분류">
                <div className="qca-section-heading">
                  <h3>풀이 분류</h3>
                  <QuizBehaviorHelp label="학급 풀이 분류 기준" />
                </div>
                <div
                  className="qca-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="학급별 풀이 분류 표"
                >
                  <table className="qca-table qca-behavior-table">
                    <thead>
                      <tr>
                        <th scope="col">학급</th>
                        {behaviorColumns.map((category) => (
                          <th scope="col" key={category}>
                            {QUIZ_BEHAVIOR_LABELS[category]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const aggregate =
                          row.classId === summary.gradeComparison?.classId;
                        const counts = row.behaviorCounts;
                        return (
                          <tr
                            key={row.classId}
                            className={
                              aggregate ? "qca-benchmark-row" : undefined
                            }
                          >
                            <th scope="row">
                              {row.label}
                              {row.rosterCount === 0 ? (
                                <span className="qca-inline-note">
                                  학생 없음
                                </span>
                              ) : counts?.no_attempt === row.rosterCount ? (
                                <span className="qca-inline-note">미응시</span>
                              ) : !counts ? (
                                <span className="qca-inline-note">
                                  집계 미확인
                                </span>
                              ) : null}
                            </th>
                            {behaviorColumns.map((category) => (
                              <td key={category}>
                                {counts == null ? (
                                  "—"
                                ) : !aggregate && counts[category] > 0 ? (
                                  <button
                                    type="button"
                                    className="qca-count-button"
                                    aria-label={`${row.label} ${QUIZ_BEHAVIOR_LABELS[category]} ${counts[category]}명 보기`}
                                    onClick={() =>
                                      void loadDetail(row, false, category)
                                    }
                                    disabled={!!detailLoading}
                                  >
                                    {counts[category]}명
                                  </button>
                                ) : (
                                  `${counts[category]}명`
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              <section
                className="qca-section"
                aria-label="다시 살펴볼 개념과 문항"
              >
                <div className="qca-section-heading">
                  <h3>보충지도</h3>
                  <InfoHelp label="보충지도 내용 집계 기준">
                    현재 버전의 문항별 마지막 응답에서 오답이 있는 개념과
                    정답률이 낮은 문항을 최대 5개씩 표시합니다. 개념별 오답
                    학생은 같은 개념의 여러 문항을 틀려도 한 명으로 셉니다. 응답
                    학생이 적으면 개별 응답을 함께 확인하세요.
                  </InfoHelp>
                </div>
                <div className="qca-learning-grid">
                  {summary.classes.map((row) => (
                    <LearningSummary key={row.classId} row={row} />
                  ))}
                </div>
              </section>
              {summary.classes.some(
                (row) => row.relearning.repeatedStudentCount > 0,
              ) && (
                <section
                  className="qca-section"
                  aria-label="공식 재응시 후 변화"
                >
                  <div className="qca-section-heading">
                    <h3>다시 푼 뒤의 변화</h3>
                    <InfoHelp label="재응답 변화 집계 기준">
                      같은 문항·같은 버전의 공식 제출을 두 번 이상 남긴 학생의
                      최초 응답과 최근 응답을 비교합니다. 오답 연습 화면의 임시
                      결과는 포함하지 않습니다. 반복 문항의 변화이며 학습 향상을
                      확정하는 지표는 아닙니다.
                    </InfoHelp>
                  </div>
                  <div
                    className="qca-table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="학급별 재응답 변화 표"
                  >
                    <table className="qca-table qca-relearning-table">
                      <thead>
                        <tr>
                          <th scope="col">학급</th>
                          <th scope="col">같은 문항 재응답</th>
                          <th scope="col">오답 → 정답</th>
                          <th scope="col">정답 → 오답</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.classes.map((row) => (
                          <tr key={row.classId}>
                            <th scope="row">{row.label}</th>
                            <td>{row.relearning.repeatedStudentCount}명</td>
                            <td>{row.relearning.wrongToCorrectCount}건</td>
                            <td>{row.relearning.correctToWrongCount}건</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
      {detailError && !detail && (
        <div className="qca-error" role="alert">
          {detailError}
          <button
            type="button"
            onClick={() => {
              const row = summary?.classes.find(
                (item) => item.classId === failedDetailId,
              );
              if (row) void loadDetail(row, false, detailFilter.current);
            }}
          >
            상세 다시 조회
          </button>
        </div>
      )}
      {detail && detailRecords && (
        <dialog
          ref={detailRef}
          className="qca-detail-dialog"
          aria-labelledby={dialogTitleId}
          onCancel={(event) => {
            event.preventDefault();
            closeDetail();
          }}
        >
          <header className="qca-detail-header">
            <div>
              <h2 id={dialogTitleId}>{detail.classLabel} · 문항·학생 상세</h2>
              <p>{resultTitle}</p>
            </div>
            <button
              type="button"
              className="qca-icon-button"
              aria-label="상세 닫기"
              title="상세 닫기"
              autoFocus
              onClick={closeDetail}
            >
              <CloseIcon />
            </button>
          </header>
          <div className="qca-detail-body">
            {detailError && (
              <div className="qca-error" role="alert">
                {detailError}
              </div>
            )}
            <QuizAnalysisView
              key={`${identityKey}:${detail.scope.unitId}:${detail.scope.category}:${detail.scope.examRound}:${detail.scope.keyword || ""}:${detail.classId}:${detail.data.version}:${detail.behaviorFilter || "all"}`}
              initialBehaviorFilter={detail.behaviorFilter}
              questions={editedQuestions}
              tree={detail.data.treeData}
              students={detail.data.students}
              records={detailRecords.records}
              snapshots={detailRecords.snapshots}
              configuredClasses={detail.data.configuredClasses}
              semesterId={semesterId}
              loading={!!detailLoading}
              errors={[]}
              legacyLimited={false}
              canEdit={canEdit}
              onEdit={(question) => {
                closeDetail();
                onEdit(question);
              }}
              onDerive={
                onDerive
                  ? (question) => {
                      closeDetail();
                      onDerive(question);
                    }
                  : undefined
              }
              onReload={() => {
                const row = summary?.classes.find(
                  (entry) => entry.classId === detail.classId,
                );
                if (row) void loadDetail(row, true);
              }}
              lockedScope={{
                unitId: detail.scope.unitId,
                category: detail.scope.category,
                examRound: detail.scope.examRound,
                classId: detail.classId,
                keyword: detail.scope.keyword,
                questionIds: detail.data.search?.questionIds,
              }}
            />
          </div>
        </dialog>
      )}
    </section>
  );
}

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <path d="m6 6 12 12M6 18 18 6" />
    </svg>
  );
}

function CompactDistribution({
  row,
  keywordScope,
}: {
  row: QuizClassSummary;
  keywordScope: boolean;
}) {
  const bandLabel = (bin: QuizClassSummary["scoreHistogram"][number]) =>
    `${bin.lower}–${Math.min(100, bin.upper)}${keywordScope ? "%" : "점"}${bin.upper <= 100 ? " 미만" : ""}`;
  return (
    <div
      className="qca-distribution"
      role="img"
      aria-label={`${row.label} ${keywordScope ? "정답률" : "점수"} 분포: ${row.scoreHistogram.map((bin) => `${bandLabel(bin)} ${bin.count}명`).join(", ")}`}
    >
      {row.scoreHistogram.map((bin) => (
        <div
          className="qca-bin"
          key={bin.lower}
          title={`${bandLabel(bin)}: ${bin.count}명 (${percent(bin.count, row.scoredCount)})`}
        >
          <span className="qca-bin-value">
            {row.scoredCount
              ? Math.round((bin.count / row.scoredCount) * 100)
              : "—"}
          </span>
          <span className="qca-bin-track">
            <span
              style={{
                height: `${row.scoredCount ? (bin.count / row.scoredCount) * 100 : 0}%`,
              }}
            />
          </span>
          <span className="qca-bin-label">
            {bin.lower}–{Math.min(100, bin.upper)}
          </span>
        </div>
      ))}
    </div>
  );
}

function LearningSummary({ row }: { row: QuizClassSummary }) {
  const concepts = [...row.concepts]
    .filter((entry) => entry.wrongCount > 0)
    .sort((a, b) => b.wrongCount - a.wrongCount)
    .slice(0, 5);
  const questions = [...row.questions]
    .filter((entry) => entry.wrongCount > 0 && entry.respondentCount > 0)
    .sort(
      (a, b) =>
        (a.correctRate ?? 101) - (b.correctRate ?? 101) ||
        b.respondentCount - a.respondentCount,
    )
    .slice(0, 5);
  return (
    <section
      className="qca-learning-class"
      aria-label={`${row.label} 보충지도`}
    >
      <h4>{row.label}</h4>
      {!concepts.length && !questions.length ? (
        <p className="qca-muted qca-no-wrong">
          {row.submittedCount === 0 ||
          !row.questions.some((entry) => entry.respondentCount > 0)
            ? "확인할 응답 기록이 없습니다."
            : "현재 문항에서 확인된 오답이 없습니다."}
        </p>
      ) : (
        <div className="qca-learning-tables">
          <div>
            {concepts.length > 0 ? (
              <div
                className="qca-table-scroll"
                tabIndex={0}
                role="region"
                aria-label={`${row.label} 핵심 개념 표`}
              >
                <table className="qca-table qca-concept-table">
                  <thead>
                    <tr>
                      <th scope="col">핵심 개념</th>
                      <th scope="col">오답 학생</th>
                      <th scope="col">응답 학생</th>
                    </tr>
                  </thead>
                  <tbody>
                    {concepts.map((entry) => (
                      <tr key={entry.concept}>
                        <th scope="row">{entry.concept}</th>
                        <td>
                          <strong>{entry.wrongCount}명</strong>
                        </td>
                        <td>{entry.respondentCount}명</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="qca-muted qca-no-wrong">
                등록된 오답 개념이 없습니다.
              </p>
            )}
          </div>
          <div>
            {questions.length > 0 && (
              <div
                className="qca-table-scroll"
                tabIndex={0}
                role="region"
                aria-label={`${row.label} 낮은 정답률 문항 표`}
              >
                <table className="qca-table qca-question-table">
                  <thead>
                    <tr>
                      <th scope="col">정답률이 낮은 문항</th>
                      <th scope="col">정답률</th>
                      <th scope="col">응답 학생</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map((entry) => (
                      <tr key={entry.id}>
                        <th scope="row">
                          {entry.question || `문항 ${entry.id}`}
                        </th>
                        <td>
                          <strong>
                            {entry.correctRate === null
                              ? "—"
                              : `${Math.round(entry.correctRate)}%`}
                          </strong>
                        </td>
                        <td>{entry.respondentCount}명</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
