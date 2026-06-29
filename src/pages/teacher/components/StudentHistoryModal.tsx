import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../contexts/AuthContext";
import QuizPassage from "../../../components/common/QuizPassage";
import { normalizeMockExamCategory } from "../../../lib/mockExamRounds";
import { getSemesterCollectionPath } from "../../../lib/semesterScope";

type HistoryReadScope = "current" | "history";
type HistorySource = "current" | "legacy";

interface HistoryInitialFilter {
  category?: string;
  unitId?: string;
  unitTitle?: string;
}

interface StudentHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  readScope?: HistoryReadScope;
  launchContextLabel?: string;
  initialFilter?: HistoryInitialFilter;
}

interface StudentQuizHistoryPanelProps {
  studentId: string;
  studentName: string;
  readScope?: HistoryReadScope;
  launchContextLabel?: string;
  initialFilter?: HistoryInitialFilter;
  title?: string;
  onClose?: () => void;
  className?: string;
  surface?: "modal" | "embedded";
}

interface QuizResultDetail {
  id?: string | number;
  correct?: boolean;
  u?: string;
  passage?: string;
}

interface QuizResultRecord {
  id: string;
  uid?: string;
  score?: number;
  category?: string;
  unitId?: string;
  timeString?: string;
  timestamp?: { seconds?: number };
  details?: QuizResultDetail[];
}

interface QuestionDoc {
  question?: string;
  answer?: string;
  explanation?: string;
  passage?: string;
}

interface ResolvedDetail extends QuizResultDetail {
  questionText: string;
  answerText: string;
  explanationText: string;
  passageText: string;
}

interface ResolvedQuizResultRecord extends QuizResultRecord {
  resolvedDetails: ResolvedDetail[];
}

const BATCH_SIZE = 10;

const chunk = <T,>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size),
  );

const getCategoryLabel = (category?: string): string => {
  const normalizedCategory = normalizeMockExamCategory(category);
  if (normalizedCategory === "diagnostic") return "진단평가";
  if (normalizedCategory === "formative") return "형성평가";
  if (normalizedCategory === "exam_prep") return "모의고사";
  return "기타";
};

const getRecordTimeMs = (record: QuizResultRecord): number => {
  if (record.timestamp?.seconds) return record.timestamp.seconds * 1000;
  if (!record.timeString) return 0;
  const parsed = new Date(record.timeString);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const getTimeText = (record: QuizResultRecord): string => {
  if (record.timestamp?.seconds) {
    return new Date(record.timestamp.seconds * 1000).toLocaleString("ko-KR");
  }
  return record.timeString || "-";
};

const getRecordUnitId = (record: QuizResultRecord) =>
  String(record.unitId || "").trim();

const getNormalizedCategory = (category?: string) =>
  normalizeMockExamCategory(category || "other");

const getInitialCategoryFilter = (initialFilter?: HistoryInitialFilter) => {
  const rawCategory = String(initialFilter?.category || "").trim();
  return rawCategory ? getNormalizedCategory(rawCategory) : "all";
};

const collectUnitTitles = (
  nodes: unknown[],
  map: Record<string, string> = {},
) => {
  nodes.forEach((node) => {
    if (!node || typeof node !== "object") return;
    const item = node as { id?: unknown; title?: unknown; children?: unknown };
    const id = String(item.id || "").trim();
    const title = String(item.title || "").trim();
    if (id && title) map[id] = title;
    if (Array.isArray(item.children)) collectUnitTitles(item.children, map);
  });
  return map;
};

const getScoreTone = (score: number) => {
  if (score >= 80) return "text-blue-700";
  if (score >= 60) return "text-emerald-700";
  return "text-red-600";
};

export const StudentQuizHistoryPanel: React.FC<
  StudentQuizHistoryPanelProps
> = ({
  studentId,
  studentName,
  readScope = "current",
  launchContextLabel,
  initialFilter,
  title,
  onClose,
  className = "",
  surface = "modal",
}) => {
  const { config } = useAuth();
  const allowLegacyLookup = readScope === "history";
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<HistorySource>("current");
  const [records, setRecords] = useState<QuizResultRecord[]>([]);
  const [unitTitleMap, setUnitTitleMap] = useState<Record<string, string>>({});
  const [questionMap, setQuestionMap] = useState<Record<string, QuestionDoc>>(
    {},
  );
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    setSource("current");
    setCategoryFilter(getInitialCategoryFilter(initialFilter));
    setUnitFilter(String(initialFilter?.unitId || "").trim() || "all");
    setSelectedRecordId("");
    setExpandedQuestions(new Set());
  }, [initialFilter?.category, initialFilter?.unitId, readScope, studentId]);

  useEffect(() => {
    if (!studentId) return;
    void fetchHistory(allowLegacyLookup ? source : "current");
  }, [allowLegacyLookup, config, source, studentId]);

  const getRecordUnitLabel = (record: QuizResultRecord) => {
    const unitId = getRecordUnitId(record);
    if (unitId === "exam_prep") return "모의고사";
    return unitTitleMap[unitId] || unitId || "단원 정보 없음";
  };

  const fetchHistory = async (selectedSource: HistorySource) => {
    setLoading(true);
    setRecords([]);
    setUnitTitleMap({});
    setQuestionMap({});
    setSelectedRecordId("");
    setExpandedQuestions(new Set());

    const resultCollectionPath =
      selectedSource === "legacy"
        ? "quiz_results"
        : getSemesterCollectionPath(config, "quiz_results");
    const questionCollectionPath =
      selectedSource === "legacy"
        ? "quiz_questions"
        : getSemesterCollectionPath(config, "quiz_questions");
    const curriculumCollectionPath =
      selectedSource === "legacy"
        ? "curriculum"
        : getSemesterCollectionPath(config, "curriculum");

    try {
      const [resultSnap, treeSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, resultCollectionPath),
            where("uid", "==", studentId),
          ),
        ),
        getDoc(doc(db, curriculumCollectionPath, "tree")).catch(() => null),
      ]);

      const nextUnitTitleMap: Record<string, string> = {
        exam_prep: "모의고사",
      };
      const tree = treeSnap?.exists() ? treeSnap.data().tree : null;
      if (Array.isArray(tree)) collectUnitTitles(tree, nextUnitTitleMap);
      if (initialFilter?.unitId && initialFilter.unitTitle) {
        nextUnitTitleMap[initialFilter.unitId] = initialFilter.unitTitle;
      }
      setUnitTitleMap(nextUnitTitleMap);

      const nextRecords: QuizResultRecord[] = [];
      resultSnap.forEach((item) => {
        nextRecords.push({
          id: item.id,
          ...(item.data() as Omit<QuizResultRecord, "id">),
        });
      });
      nextRecords.sort((a, b) => getRecordTimeMs(b) - getRecordTimeMs(a));
      setRecords(nextRecords);

      const allQuestionIds = Array.from(
        new Set(
          nextRecords.flatMap((record) =>
            (record.details || [])
              .map((detail) => String(detail.id || "").trim())
              .filter((id) => id.length > 0),
          ),
        ),
      );

      if (allQuestionIds.length === 0) return;

      const resolvedQuestionMap: Record<string, QuestionDoc> = {};
      await Promise.all(
        chunk(allQuestionIds, BATCH_SIZE).map(async (ids) => {
          const questionSnap = await getDocs(
            query(
              collection(db, questionCollectionPath),
              where(documentId(), "in", ids),
            ),
          );
          questionSnap.forEach((item) => {
            resolvedQuestionMap[item.id] = item.data() as QuestionDoc;
          });
        }),
      );

      setQuestionMap(resolvedQuestionMap);
    } catch (error) {
      console.error("Error fetching student history:", error);
      setRecords([]);
      setUnitTitleMap({});
      setQuestionMap({});
    } finally {
      setLoading(false);
    }
  };

  const resolvedRecords = useMemo<ResolvedQuizResultRecord[]>(
    () =>
      records.map((record) => ({
        ...record,
        resolvedDetails: (record.details || []).map((detail, idx) => {
          const qid = String(detail.id || "").trim();
          const question = qid ? questionMap[qid] : undefined;
          const no = idx + 1;
          return {
            ...detail,
            questionText: question?.question || `Q${no} 문항 정보 없음`,
            answerText: question?.answer ? String(question.answer) : "-",
            explanationText:
              question?.explanation || "해설이 등록되지 않았습니다.",
            passageText: String(question?.passage || detail.passage || ""),
          };
        }),
      })),
    [questionMap, records],
  );

  const categoryOptions = useMemo(() => {
    const map = new Map<
      string,
      { value: string; label: string; count: number }
    >();
    records.forEach((record) => {
      const value = getNormalizedCategory(record.category);
      const existing = map.get(value);
      if (existing) existing.count += 1;
      else map.set(value, { value, label: getCategoryLabel(value), count: 1 });
    });
    return Array.from(map.values());
  }, [records]);

  const unitOptions = useMemo(() => {
    const map = new Map<
      string,
      { value: string; label: string; count: number }
    >();
    records.forEach((record) => {
      const value = getRecordUnitId(record) || "unknown";
      const existing = map.get(value);
      if (existing) existing.count += 1;
      else
        map.set(value, { value, label: getRecordUnitLabel(record), count: 1 });
    });
    const options = Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "ko"),
    );
    if (
      unitFilter !== "all" &&
      !options.some((option) => option.value === unitFilter)
    ) {
      options.unshift({
        value: unitFilter,
        label: initialFilter?.unitTitle || unitFilter,
        count: 0,
      });
    }
    return options;
  }, [initialFilter?.unitTitle, records, unitFilter, unitTitleMap]);

  const filteredRecords = useMemo(
    () =>
      resolvedRecords.filter((record) => {
        const categoryMatches =
          categoryFilter === "all" ||
          getNormalizedCategory(record.category) === categoryFilter;
        const unitMatches =
          unitFilter === "all" ||
          (getRecordUnitId(record) || "unknown") === unitFilter;
        return categoryMatches && unitMatches;
      }),
    [categoryFilter, resolvedRecords, unitFilter],
  );

  useEffect(() => {
    if (loading) return;
    setSelectedRecordId((current) => {
      if (filteredRecords.some((record) => record.id === current)) {
        return current;
      }
      return filteredRecords[0]?.id || "";
    });
    setExpandedQuestions(new Set());
  }, [filteredRecords, loading]);

  const selectedRecord =
    filteredRecords.find((record) => record.id === selectedRecordId) ||
    filteredRecords[0] ||
    null;
  const selectedDetails = selectedRecord?.resolvedDetails || [];
  const selectedWrongCount = selectedDetails.filter(
    (detail) => !detail.correct,
  ).length;
  const filteredAverage = filteredRecords.length
    ? Math.round(
        filteredRecords.reduce(
          (sum, record) => sum + Number(record.score || 0),
          0,
        ) / filteredRecords.length,
      )
    : 0;
  const selectedFilterLabel = [
    categoryFilter === "all" ? "전체 유형" : getCategoryLabel(categoryFilter),
    unitFilter === "all"
      ? "전체 단원"
      : unitOptions.find((option) => option.value === unitFilter)?.label ||
        initialFilter?.unitTitle ||
        unitFilter,
  ].join(" · ");

  const toggleQuestion = (key: string) => {
    setExpandedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const activeSource = allowLegacyLookup ? source : "current";
  const scopeBadgeLabel = allowLegacyLookup
    ? activeSource === "legacy"
      ? "이전 기록 조회 중"
      : "현재 학기 조회 중"
    : "현재 학기 전용";
  const loadingText =
    activeSource === "legacy"
      ? "이전 기록을 불러오는 중..."
      : "현재 학기 기록을 불러오는 중...";
  const emptyTitle =
    activeSource === "legacy"
      ? "이전 기록이 없습니다."
      : "현재 학기 응시 기록이 없습니다.";
  const emptyDescription =
    activeSource === "legacy"
      ? "이 학생의 이전 학기 누적 응시 기록은 아직 확인되지 않았습니다."
      : allowLegacyLookup
        ? "현재 운영 학기에는 아직 응시 기록이 없습니다. 과거 기록을 보려면 상단에서 이전 기록을 선택해 주세요."
        : "현재 운영 학기 기준으로 아직 응시 기록이 없습니다.";
  const panelTitle = title || `${studentName} 응시 기록`;
  const panelClassName =
    surface === "embedded"
      ? "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      : "flex h-full min-h-0 flex-col overflow-hidden bg-white";

  return (
    <div className={`${panelClassName} ${className}`}>
      {surface !== "embedded" && (
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-xl font-extrabold text-gray-900">
              {panelTitle}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                {scopeBadgeLabel}
              </span>
              {launchContextLabel && (
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-bold text-gray-600">
                  {launchContextLabel}
                </span>
              )}
              <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-bold text-gray-600">
                {selectedFilterLabel}
              </span>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
              aria-label="응시 기록 닫기"
            >
              <i className="fas fa-times"></i>
            </button>
          )}
        </div>
      )}

      <div className="border-b border-gray-100 px-4 py-2.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {allowLegacyLookup &&
              (["current", "legacy"] as HistorySource[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSource(item)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    source === item
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {item === "current" ? "현재 학기 기록" : "이전 기록"}
                </button>
              ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCategoryFilter("all")}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                categoryFilter === "all"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              전체 유형
            </button>
            {categoryOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setCategoryFilter(option.value)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                  categoryFilter === option.value
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {option.label} {option.count}회 응시
              </button>
            ))}
            <select
              value={unitFilter}
              onChange={(event) => setUnitFilter(event.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700"
              aria-label="응시 기록 단원 필터"
            >
              <option value="all">전체 단원</option>
              {unitOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                  {option.count ? ` (${option.count}회)` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-gray-50 p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-500">
            {loadingText}
          </div>
        ) : records.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-4 py-16 text-center">
            <div className="text-sm font-bold text-gray-500">{emptyTitle}</div>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-gray-400">
              {emptyDescription}
            </p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-4 py-16 text-center">
            <div className="text-sm font-bold text-gray-500">
              조건에 맞는 응시 기록이 없습니다.
            </div>
            <p className="mt-2 text-xs text-gray-400">
              유형 또는 단원 필터를 바꾸면 다른 기록을 확인할 수 있습니다.
            </p>
          </div>
        ) : (
          <div className="grid h-full min-h-0 overflow-hidden gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-extrabold text-gray-900">
                    응시 목록
                  </h4>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600">
                    {filteredRecords.length}회 응시
                  </span>
                </div>
                <p className="mt-1 text-xs font-semibold text-gray-500">
                  평균 {filteredAverage}점
                </p>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {filteredRecords.map((record) => {
                  const details = record.resolvedDetails || [];
                  const wrongCount = details.filter(
                    (detail) => !detail.correct,
                  ).length;
                  const selected = selectedRecord?.id === record.id;
                  const score = Number(record.score || 0);
                  return (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => setSelectedRecordId(record.id)}
                      className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                        selected
                          ? "border-blue-300 bg-blue-50 shadow-sm"
                          : "border-gray-200 bg-white hover:border-blue-200 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-extrabold text-gray-900">
                            {getRecordUnitLabel(record)}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                              {getCategoryLabel(record.category)}
                            </span>
                            <span className="rounded bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600">
                              오답 {wrongCount}개
                            </span>
                          </div>
                        </div>
                        <span
                          className={`shrink-0 text-lg font-black ${getScoreTone(score)}`}
                        >
                          {score}점
                        </span>
                      </div>
                      <div className="mt-2 text-xs font-semibold text-gray-400">
                        {getTimeText(record)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              {selectedRecord ? (
                <>
                  <div className="border-b border-gray-100 px-5 py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-black text-blue-600">
                          선택한 응시 기록
                        </div>
                        <h4 className="mt-1 truncate text-lg font-extrabold text-gray-900">
                          {getRecordUnitLabel(selectedRecord)} ·{" "}
                          {getCategoryLabel(selectedRecord.category)}
                        </h4>
                        <p className="mt-1 text-xs font-semibold text-gray-500">
                          {getTimeText(selectedRecord)} · 오답{" "}
                          {selectedWrongCount} / 전체{" "}
                          {selectedDetails.length || 0}문항
                        </p>
                      </div>
                      <div className="shrink-0 text-left md:text-right">
                        <div
                          className={`text-2xl font-black ${getScoreTone(
                            Number(selectedRecord.score || 0),
                          )}`}
                        >
                          {Number(selectedRecord.score || 0)}점
                        </div>
                        <div className="text-xs font-bold text-gray-400">
                          문항을 펼쳐 답안과 해설 확인
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                    {selectedDetails.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm font-bold text-gray-400">
                        문항 상세 정보가 없습니다.
                      </div>
                    ) : (
                      selectedDetails.map((detail, qIdx) => {
                        const qKey = `${selectedRecord.id}_${qIdx}`;
                        const open = expandedQuestions.has(qKey);
                        const wrong = !detail.correct;
                        return (
                          <div
                            key={qKey}
                            className={`rounded-lg border ${
                              wrong
                                ? "border-red-200 bg-red-50"
                                : "border-emerald-200 bg-emerald-50"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleQuestion(qKey)}
                              className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left"
                            >
                              <div className="min-w-0">
                                <div
                                  className={`text-xs font-extrabold ${
                                    wrong ? "text-red-600" : "text-emerald-700"
                                  }`}
                                >
                                  Q{qIdx + 1} {wrong ? "오답" : "정답"}
                                </div>
                                <div className="mt-1 line-clamp-2 text-sm font-semibold text-gray-900">
                                  {detail.questionText}
                                </div>
                              </div>
                              <i
                                className={`fas fa-chevron-down mt-1 text-gray-400 transition-transform ${
                                  open ? "rotate-180" : ""
                                }`}
                              ></i>
                            </button>
                            {open && (
                              <div className="space-y-2 border-t border-white/70 px-3 pb-3 pt-2 text-sm text-gray-700">
                                <div className="font-bold text-gray-900">
                                  {detail.questionText}
                                </div>
                                {detail.passageText && (
                                  <QuizPassage value={detail.passageText} />
                                )}
                                <div className="grid gap-2 md:grid-cols-2">
                                  <div className="rounded-lg bg-white px-3 py-2">
                                    <div className="text-xs font-bold text-gray-400">
                                      학생 답
                                    </div>
                                    <div
                                      className={`mt-1 font-extrabold ${
                                        wrong
                                          ? "text-red-600"
                                          : "text-emerald-700"
                                      }`}
                                    >
                                      {detail.u || "(미입력)"}
                                    </div>
                                  </div>
                                  <div className="rounded-lg bg-white px-3 py-2">
                                    <div className="text-xs font-bold text-gray-400">
                                      정답
                                    </div>
                                    <div className="mt-1 font-extrabold text-blue-700">
                                      {detail.answerText}
                                    </div>
                                  </div>
                                </div>
                                <div className="rounded-lg bg-white px-3 py-2 leading-6 text-gray-700">
                                  <span className="font-bold text-gray-900">
                                    해설:{" "}
                                  </span>
                                  {detail.explanationText}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-sm font-bold text-gray-400">
                  확인할 응시 기록을 선택해 주세요.
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
};

const StudentHistoryModal: React.FC<StudentHistoryModalProps> = ({
  isOpen,
  onClose,
  studentId,
  studentName,
  readScope = "current",
  launchContextLabel,
  initialFilter,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[calc(100vh-2.5rem)] max-h-[88vh] w-full max-w-6xl animate-fadeScale flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <StudentQuizHistoryPanel
          studentId={studentId}
          studentName={studentName}
          readScope={readScope}
          launchContextLabel={launchContextLabel}
          initialFilter={initialFilter}
          onClose={onClose}
          surface="modal"
        />
      </div>
    </div>
  );
};

export default StudentHistoryModal;
