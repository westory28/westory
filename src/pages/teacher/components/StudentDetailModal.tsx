import React, { useEffect, useMemo, useState } from "react";
import PointRankBadge from "../../../components/common/PointRankBadge";
import { useAuth } from "../../../contexts/AuthContext";
import { formatWisAmount } from "../../../lib/pointFormatters";
import {
  loadStudentHistoryClassroomProgressSummary,
  loadStudentLessonProgressSummary,
  loadStudentQuizProgressSummary,
  loadStudentWisProgressSummary,
  type StudentHistoryClassroomSummary,
  type StudentLessonProgressSummary,
  type StudentQuizProgressSummary,
  type StudentWisSummary,
} from "../../../lib/studentProgressSummary";
import { updateStudentData } from "../../../lib/studentData";
import {
  formatPerformanceScore,
  loadUserPerformanceScoreRecords,
  type PerformanceScoreRecord,
} from "../../../lib/performanceScores";
import { StudentQuizHistoryPanel } from "./StudentHistoryModal";

interface Student {
  id: string;
  userId?: string;
  grade: string;
  class: string;
  number: number;
  name: string;
  email: string;
}

type DetailTab =
  | "overview"
  | "lesson"
  | "quiz"
  | "history"
  | "wis"
  | "performance"
  | "profile";
type StudentDetailInitialTab = DetailTab | "summary";

interface StudentDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student | null;
  onUpdate: () => void;
  readOnly?: boolean;
  initialTab?: StudentDetailInitialTab;
}

const EMPTY_SUMMARY_TEXT = "-";

const normalizeInitialTab = (
  initialTab: StudentDetailInitialTab = "overview",
): DetailTab => (initialTab === "summary" ? "overview" : initialTab);

const buildLoadKey = (
  studentId: string | undefined,
  config: { year?: string | number; semester?: string | number } | null,
) =>
  [
    studentId || "",
    String(config?.year || "2026"),
    String(config?.semester || "1"),
  ].join(":");

const StudentDetailModal: React.FC<StudentDetailModalProps> = ({
  isOpen,
  onClose,
  student,
  onUpdate,
  readOnly = false,
  initialTab = "overview",
}) => {
  const { config } = useAuth();
  const [activeTab, setActiveTab] = useState<DetailTab>(
    normalizeInitialTab(initialTab),
  );
  const [lessonSummary, setLessonSummary] =
    useState<StudentLessonProgressSummary | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonLoadedKey, setLessonLoadedKey] = useState("");
  const [quizSummary, setQuizSummary] =
    useState<StudentQuizProgressSummary | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizLoadedKey, setQuizLoadedKey] = useState("");
  const [historySummary, setHistorySummary] =
    useState<StudentHistoryClassroomSummary | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadedKey, setHistoryLoadedKey] = useState("");
  const [wisSummary, setWisSummary] = useState<StudentWisSummary | null>(null);
  const [wisLoading, setWisLoading] = useState(false);
  const [wisLoadedKey, setWisLoadedKey] = useState("");
  const [performanceScores, setPerformanceScores] = useState<
    PerformanceScoreRecord[]
  >([]);
  const [performanceScoresLoading, setPerformanceScoresLoading] =
    useState(false);
  const [performanceScoresLoadedKey, setPerformanceScoresLoadedKey] =
    useState("");
  const [lessonSectionFilter, setLessonSectionFilter] = useState("all");
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<Student>({
    id: "",
    grade: "",
    class: "",
    number: 0,
    name: "",
    email: "",
  });

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(normalizeInitialTab(initialTab));
    setLessonSectionFilter("all");
  }, [initialTab, isOpen]);

  useEffect(() => {
    if (!student) return;
    setFormData(student);
    setLessonSummary(null);
    setLessonLoading(false);
    setLessonLoadedKey("");
    setQuizSummary(null);
    setQuizLoading(false);
    setQuizLoadedKey("");
    setHistorySummary(null);
    setHistoryLoading(false);
    setHistoryLoadedKey("");
    setWisSummary(null);
    setWisLoading(false);
    setWisLoadedKey("");
    setPerformanceScores([]);
    setPerformanceScoresLoading(false);
    setPerformanceScoresLoadedKey("");
  }, [student]);

  useEffect(() => {
    if (!isOpen || activeTab !== "lesson" || !student?.id) return;
    const loadKey = buildLoadKey(student.id, config);
    if (lessonLoadedKey === loadKey) return;

    let cancelled = false;
    const loadLesson = async () => {
      setLessonLoading(true);
      try {
        const nextSummary = await loadStudentLessonProgressSummary(
          config,
          student.id,
        );
        if (!cancelled) {
          setLessonSummary(nextSummary);
          setLessonLoadedKey(loadKey);
        }
      } catch (error) {
        console.error("Failed to load student lesson summary:", error);
        if (!cancelled) {
          setLessonSummary(null);
          setLessonLoadedKey(loadKey);
        }
      } finally {
        if (!cancelled) setLessonLoading(false);
      }
    };

    void loadLesson();
    return () => {
      cancelled = true;
    };
  }, [activeTab, config, isOpen, lessonLoadedKey, student?.id]);

  useEffect(() => {
    if (!isOpen || activeTab !== "quiz" || !student?.id) return;
    const loadKey = buildLoadKey(student.id, config);
    if (quizLoadedKey === loadKey) return;

    let cancelled = false;
    const loadQuiz = async () => {
      setQuizLoading(true);
      try {
        const nextSummary = await loadStudentQuizProgressSummary(
          config,
          student.id,
        );
        if (!cancelled) {
          setQuizSummary(nextSummary);
          setQuizLoadedKey(loadKey);
        }
      } catch (error) {
        console.error("Failed to load student quiz summary:", error);
        if (!cancelled) {
          setQuizSummary(null);
          setQuizLoadedKey(loadKey);
        }
      } finally {
        if (!cancelled) setQuizLoading(false);
      }
    };

    void loadQuiz();
    return () => {
      cancelled = true;
    };
  }, [activeTab, config, isOpen, quizLoadedKey, student?.id]);

  useEffect(() => {
    if (!isOpen || activeTab !== "history" || !student?.id) return;
    const loadKey = buildLoadKey(student.id, config);
    if (historyLoadedKey === loadKey) return;

    let cancelled = false;
    const loadHistory = async () => {
      setHistoryLoading(true);
      try {
        const nextSummary = await loadStudentHistoryClassroomProgressSummary(
          config,
          student.id,
        );
        if (!cancelled) {
          setHistorySummary(nextSummary);
          setHistoryLoadedKey(loadKey);
        }
      } catch (error) {
        console.error(
          "Failed to load student history classroom summary:",
          error,
        );
        if (!cancelled) {
          setHistorySummary(null);
          setHistoryLoadedKey(loadKey);
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [activeTab, config, historyLoadedKey, isOpen, student?.id]);

  useEffect(() => {
    if (!isOpen || activeTab !== "wis" || !student?.id) return;
    const loadKey = buildLoadKey(student.id, config);
    if (wisLoadedKey === loadKey) return;

    let cancelled = false;
    const loadWis = async () => {
      setWisLoading(true);
      try {
        const nextSummary = await loadStudentWisProgressSummary(
          config,
          student.id,
        );
        if (!cancelled) {
          setWisSummary(nextSummary);
          setWisLoadedKey(loadKey);
        }
      } catch (error) {
        console.error("Failed to load student WIS summary:", error);
        if (!cancelled) {
          setWisSummary(null);
          setWisLoadedKey(loadKey);
        }
      } finally {
        if (!cancelled) setWisLoading(false);
      }
    };

    void loadWis();
    return () => {
      cancelled = true;
    };
  }, [activeTab, config, isOpen, student?.id, wisLoadedKey]);

  useEffect(() => {
    if (!isOpen || activeTab !== "performance" || !student?.id) return;
    const loadKey = buildLoadKey(student.id, config);
    if (performanceScoresLoadedKey === loadKey) return;

    let cancelled = false;
    const loadPerformanceScores = async () => {
      setPerformanceScoresLoading(true);
      try {
        const year = String(config?.year || "2026");
        const semester = String(config?.semester || "1");
        const records = await loadUserPerformanceScoreRecords(student.id, {
          year,
          semester,
        });
        if (!cancelled) {
          setPerformanceScores(records);
          setPerformanceScoresLoadedKey(loadKey);
        }
      } catch (error) {
        console.error("Failed to load student performance scores:", error);
        if (!cancelled) {
          setPerformanceScores([]);
          setPerformanceScoresLoadedKey(loadKey);
        }
      } finally {
        if (!cancelled) setPerformanceScoresLoading(false);
      }
    };

    void loadPerformanceScores();
    return () => {
      cancelled = true;
    };
  }, [activeTab, config, isOpen, performanceScoresLoadedKey, student?.id]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === "number" ? parseInt(value, 10) || 0 : value,
    }));
  };

  const handleSave = async () => {
    if (readOnly || !formData.id) return;
    setSaving(true);
    try {
      await updateStudentData(config, {
        uid: formData.id,
        grade: formData.grade,
        class: formData.class,
        number: formData.number,
        name: formData.name,
        email: formData.email,
      });
      onUpdate();
      onClose();
    } catch (error) {
      console.error("Failed to update student:", error);
      alert("학생 정보 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const lessonSections = useMemo(() => {
    const lessonUnits = lessonSummary?.units || [];
    const sectionMap = new Map<
      string,
      {
        key: string;
        title: string;
        order: number;
        units: typeof lessonUnits;
        blankCount: number;
        correctCount: number;
        submittedCount: number;
      }
    >();

    lessonUnits.forEach((unit) => {
      const key = unit.sectionKey || "uncategorized";
      const existing = sectionMap.get(key);
      const section = existing || {
        key,
        title: unit.sectionTitle || "기타 수업 자료",
        order: unit.sectionOrder ?? Number.MAX_SAFE_INTEGER,
        units: [],
        blankCount: 0,
        correctCount: 0,
        submittedCount: 0,
      };
      section.units.push(unit);
      section.blankCount += unit.blankCount;
      section.correctCount += unit.correctCount;
      if (unit.submitted) section.submittedCount += 1;
      sectionMap.set(key, section);
    });

    return Array.from(sectionMap.values()).sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.title.localeCompare(right.title, "ko");
    });
  }, [lessonSummary?.units]);

  const filteredLessonSections = useMemo(
    () =>
      lessonSectionFilter === "all"
        ? lessonSections
        : lessonSections.filter(
            (section) => section.key === lessonSectionFilter,
          ),
    [lessonSectionFilter, lessonSections],
  );

  const lessonTrackedUnits = (lessonSummary?.units || []).filter(
    (unit) => unit.blankCount > 0 || !lessonSummary?.worksheetUnits,
  );
  const lessonWorksheetTotal =
    lessonSummary?.worksheetUnits ||
    lessonTrackedUnits.length ||
    lessonSummary?.totalLessons ||
    0;
  const lessonSubmittedTotal = lessonTrackedUnits.filter(
    (unit) => unit.submitted,
  ).length;

  if (!isOpen || !student) return null;

  const topTabs: Array<{ key: DetailTab; label: string; icon: string }> = [
    { key: "overview", label: "개요", icon: "fa-table-cells-large" },
    { key: "lesson", label: "수업 자료", icon: "fa-book-open" },
    { key: "quiz", label: "평가", icon: "fa-clipboard-check" },
    { key: "history", label: "역사교실", icon: "fa-landmark" },
    { key: "wis", label: "위스", icon: "fa-coins" },
    { key: "performance", label: "수행평가", icon: "fa-chart-column" },
    { key: "profile", label: "정보 수정", icon: "fa-id-card" },
  ];
  const panelClassName = "rounded-xl border border-gray-200 bg-white shadow-sm";
  const emptyClassName =
    "rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-8 text-center text-sm font-bold text-gray-400";

  const renderLoading = (label: string) => (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm font-bold text-gray-400">
      {label} 불러오는 중...
    </div>
  );

  const openTab = (tab: DetailTab) => {
    setActiveTab(tab);
  };

  const renderOverviewCard = ({
    tab,
    label,
    value,
    meta,
    icon,
    tone,
  }: {
    tab: DetailTab;
    label: string;
    value: string;
    meta: string;
    icon: string;
    tone: string;
  }) => (
    <button
      key={tab}
      type="button"
      onClick={() => openTab(tab)}
      className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-extrabold text-gray-800">{label}</div>
        <i className={`fas ${icon} ${tone}`}></i>
      </div>
      <div className={`mt-4 text-2xl font-black ${tone}`}>{value}</div>
      <div className="mt-2 text-xs font-semibold leading-5 text-gray-500">
        {meta}
      </div>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-6xl animate-fadeScale flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-extrabold text-gray-900">
                {student.name || "이름 없음"}
              </h3>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                {student.grade || "-"}학년 {student.class || "-"}반{" "}
                {student.number || "-"}번
              </span>
            </div>
            <div className="mt-1 truncate font-mono text-xs text-gray-500">
              {student.email || "이메일 없음"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            aria-label="학생 상세 팝업 닫기"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="border-b border-gray-100 px-5 pt-4">
          <div className="flex gap-2 overflow-x-auto">
            {topTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => openTab(tab.key)}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-t-lg border border-b-0 px-4 py-2 text-sm font-bold transition ${
                  activeTab === tab.key
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                }`}
              >
                <i className={`fas ${tab.icon} text-xs`}></i>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50 p-5">
          {activeTab === "overview" && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {renderOverviewCard({
                tab: "lesson",
                label: "수업 자료",
                value: lessonSummary
                  ? `${lessonSubmittedTotal}/${lessonWorksheetTotal}`
                  : "조회 전",
                meta: lessonSummary?.latestUnitTitle || "수업 자료별 진행률",
                icon: "fa-book-open",
                tone: "text-blue-700",
              })}
              {renderOverviewCard({
                tab: "quiz",
                label: "평가",
                value: quizSummary
                  ? `${quizSummary.totalAttempts || 0}회`
                  : "조회 전",
                meta: quizSummary?.latestTitle || "평가 유형별 응시 기록",
                icon: "fa-clipboard-check",
                tone: "text-emerald-700",
              })}
              {renderOverviewCard({
                tab: "history",
                label: "역사교실",
                value: historySummary
                  ? `${historySummary.passedCount || 0}/${historySummary.totalAttempts || 0}`
                  : "조회 전",
                meta: historySummary?.latestTitle || "역사교실 결과",
                icon: "fa-landmark",
                tone: "text-amber-700",
              })}
              {renderOverviewCard({
                tab: "wis",
                label: "위스",
                value: wisSummary
                  ? formatWisAmount(wisSummary.balance || 0)
                  : "조회 전",
                meta: wisSummary?.currentRank?.label || "위스 잔액과 등급",
                icon: "fa-coins",
                tone: "text-violet-700",
              })}
              {renderOverviewCard({
                tab: "performance",
                label: "수행평가",
                value: performanceScoresLoadedKey
                  ? `${performanceScores.length}건`
                  : "조회 전",
                meta: "수행평가 점수와 피드백",
                icon: "fa-chart-column",
                tone: "text-sky-700",
              })}
            </div>
          )}

          {activeTab === "lesson" && (
            <div className="space-y-4">
              {lessonLoading && renderLoading("수업 자료")}
              {!lessonLoading && lessonSummary?.unavailable && (
                <div className={emptyClassName}>{lessonSummary.message}</div>
              )}
              {!lessonLoading &&
                lessonSummary &&
                !lessonSummary.unavailable && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                      <div>
                        <h4 className="text-sm font-extrabold text-gray-900">
                          수업 자료 진행
                        </h4>
                        <p className="mt-1 text-xs font-bold text-gray-500">
                          제출 {lessonSubmittedTotal}/{lessonWorksheetTotal}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setLessonSectionFilter("all")}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                            lessonSectionFilter === "all"
                              ? "border-blue-300 bg-blue-50 text-blue-700"
                              : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          전체
                        </button>
                        {lessonSections.map((section) => (
                          <button
                            key={section.key}
                            type="button"
                            onClick={() => setLessonSectionFilter(section.key)}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                              lessonSectionFilter === section.key
                                ? "border-blue-300 bg-blue-50 text-blue-700"
                                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                            }`}
                          >
                            {section.title}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {filteredLessonSections.map((section) => {
                        const sectionAccuracy =
                          section.blankCount > 0
                            ? Math.round(
                                (section.correctCount / section.blankCount) *
                                  100,
                              )
                            : 0;
                        return (
                          <section
                            key={section.key}
                            className={`${panelClassName} overflow-hidden`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-extrabold text-gray-900">
                                  {section.title}
                                </div>
                                <div className="mt-0.5 text-xs font-semibold text-gray-500">
                                  제출 {section.submittedCount}/
                                  {section.units.length} · 평균{" "}
                                  {sectionAccuracy}%
                                </div>
                              </div>
                            </div>
                            <div className="overflow-x-auto">
                              <div className="min-w-[46rem]">
                                <div className="grid grid-cols-[minmax(13rem,1fr)_minmax(8rem,0.8fr)_minmax(5.5rem,0.55fr)_minmax(4.5rem,0.45fr)_minmax(4.5rem,0.45fr)] items-center gap-2 border-b border-gray-200 bg-white px-3 py-2 text-[11px] font-bold text-gray-400">
                                  <div>수업 자료</div>
                                  <div className="text-center">제출 일시</div>
                                  <div className="text-center">정답</div>
                                  <div className="text-center">정답률</div>
                                  <div className="text-center">제출</div>
                                </div>
                                <div className="divide-y divide-gray-100">
                                  {section.units.map((unit) => {
                                    const accuracy =
                                      unit.blankCount > 0
                                        ? Math.round(
                                            (unit.correctCount /
                                              unit.blankCount) *
                                              100,
                                          )
                                        : 0;
                                    return (
                                      <div
                                        key={unit.unitId}
                                        className="grid grid-cols-[minmax(13rem,1fr)_minmax(8rem,0.8fr)_minmax(5.5rem,0.55fr)_minmax(4.5rem,0.45fr)_minmax(4.5rem,0.45fr)] items-center gap-2 px-3 py-2.5"
                                      >
                                        <div className="min-w-0">
                                          <div className="truncate text-sm font-bold text-gray-800">
                                            {unit.title}
                                          </div>
                                        </div>
                                        <div className="truncate text-center text-xs font-semibold text-gray-500">
                                          {unit.latestUpdatedAtText || "-"}
                                        </div>
                                        <div className="text-center text-xs font-semibold text-gray-500">
                                          {unit.correctCount}/{unit.blankCount}
                                        </div>
                                        <div className="text-center text-sm font-black text-gray-900">
                                          {accuracy}%
                                        </div>
                                        <span
                                          className={`justify-self-center rounded-full px-2.5 py-1 text-xs font-extrabold ${
                                            unit.submitted
                                              ? "bg-emerald-50 text-emerald-700"
                                              : "bg-slate-100 text-slate-600"
                                          }`}
                                        >
                                          {unit.submissionLabel}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </section>
                        );
                      })}
                      {!lessonSummary.units.length && (
                        <div className={emptyClassName}>
                          조회할 수업 자료 진행 기록이 없습니다.
                        </div>
                      )}
                    </div>
                  </>
                )}
            </div>
          )}

          {activeTab === "quiz" && (
            <div className="space-y-4">
              {quizLoading && renderLoading("평가 요약")}
              {!quizLoading && quizSummary?.unavailable && (
                <div className={emptyClassName}>{quizSummary.message}</div>
              )}
              {!quizLoading && quizSummary && !quizSummary.unavailable && (
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h4 className="text-sm font-extrabold text-gray-900">
                        평가 요약
                      </h4>
                      <p className="mt-1 text-xs font-bold text-gray-500">
                        총 {quizSummary.totalAttempts}회 응시 · 평균{" "}
                        {quizSummary.averageScore}점 · 오답{" "}
                        {quizSummary.wrongCount}개
                      </p>
                    </div>
                    <div className="text-xs font-bold text-gray-400">
                      아래 응시 기록에서 개별 문항을 바로 확인할 수 있습니다.
                    </div>
                  </div>
                </div>
              )}

              <StudentQuizHistoryPanel
                studentId={student.userId || student.id}
                studentName={student.name || student.email || "학생"}
                readScope="history"
                launchContextLabel="학생 명단 관리"
                title="평가 응시 기록"
                surface="embedded"
              />
            </div>
          )}

          {activeTab === "history" && (
            <div className="space-y-4">
              {historyLoading && renderLoading("역사교실 결과")}
              {!historyLoading && historySummary?.unavailable && (
                <div className={emptyClassName}>{historySummary.message}</div>
              )}
              {!historyLoading &&
                historySummary &&
                !historySummary.unavailable && (
                  <section className={`${panelClassName} p-5`}>
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h4 className="text-lg font-extrabold text-gray-900">
                          역사교실 결과
                        </h4>
                        <p className="mt-1 text-sm font-bold text-gray-500">
                          최근 {historySummary.latestTitle || "결과 없음"}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-black text-amber-700">
                          {historySummary.passedCount}/
                          {historySummary.totalAttempts}
                        </div>
                        <div className="text-xs font-black text-amber-600">
                          평균 {historySummary.averagePercent}%
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <div className="text-xs font-bold text-gray-400">
                          상태
                        </div>
                        <div className="mt-1 text-sm font-extrabold text-gray-800">
                          {historySummary.latestStatusLabel || "-"}
                        </div>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <div className="text-xs font-bold text-gray-400">
                          최근 일시
                        </div>
                        <div className="mt-1 text-sm font-extrabold text-gray-800">
                          {historySummary.latestDateText || "-"}
                        </div>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <div className="text-xs font-bold text-gray-400">
                          응시
                        </div>
                        <div className="mt-1 text-sm font-extrabold text-gray-800">
                          {historySummary.totalAttempts}회
                        </div>
                      </div>
                    </div>
                  </section>
                )}
            </div>
          )}

          {activeTab === "wis" && (
            <div className="space-y-4">
              {wisLoading && renderLoading("위스 정보")}
              {!wisLoading && wisSummary?.unavailable && (
                <div className={emptyClassName}>{wisSummary.message}</div>
              )}
              {!wisLoading && wisSummary && !wisSummary.unavailable && (
                <section className={`${panelClassName} p-5`}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h4 className="text-lg font-extrabold text-gray-900">
                        위스 현황
                      </h4>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {wisSummary.currentRank && (
                          <PointRankBadge
                            rank={wisSummary.currentRank}
                            size="sm"
                          />
                        )}
                        <span className="text-xs font-bold text-gray-500">
                          누적 {formatWisAmount(wisSummary.earnedTotal || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-violet-700">
                        {formatWisAmount(wisSummary.balance || 0)}
                      </div>
                      <div className="text-xs font-black text-violet-600">
                        사용 {formatWisAmount(wisSummary.spentTotal || 0)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <div className="text-xs font-bold text-gray-400">
                        잔액
                      </div>
                      <div className="mt-1 text-sm font-extrabold text-gray-800">
                        {formatWisAmount(wisSummary.balance || 0)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <div className="text-xs font-bold text-gray-400">
                        누적
                      </div>
                      <div className="mt-1 text-sm font-extrabold text-gray-800">
                        {formatWisAmount(wisSummary.earnedTotal || 0)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <div className="text-xs font-bold text-gray-400">
                        다음 등급
                      </div>
                      <div className="mt-1 text-sm font-extrabold text-gray-800">
                        {formatWisAmount(wisSummary.nextRankGap || 0)}
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === "performance" && (
            <div className="space-y-4">
              {performanceScoresLoading ? (
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm font-bold text-gray-400">
                  수행평가 점수를 불러오는 중...
                </div>
              ) : performanceScores.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center text-sm font-bold text-gray-400">
                  저장된 수행평가 점수가 없습니다.
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {performanceScores.map((record) => (
                    <section
                      key={record.id || record.rosterId}
                      className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <h4 className="truncate text-lg font-extrabold text-gray-900">
                            {record.title}
                          </h4>
                          <p className="mt-1 text-xs font-bold text-gray-400">
                            {record.subject || "과목"} · {record.academicYear}
                            학년도 {record.semester}학기
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-2xl font-black text-blue-600">
                            {formatPerformanceScore(record.totalScore)}
                            <span className="text-base text-gray-400">
                              {" "}
                              / {formatPerformanceScore(record.totalMaxScore)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {(record.items || []).map((item, index) => (
                          <div
                            key={`${record.rosterId}-${item.name}-${index}`}
                            className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                          >
                            <div className="truncate text-xs font-black text-gray-500">
                              {item.shortName || item.name}
                            </div>
                            <div className="mt-1 text-sm font-black text-gray-800">
                              {item.scoreEntered === false
                                ? "-"
                                : formatPerformanceScore(item.score)}
                              <span className="text-xs text-gray-400">
                                {" "}
                                / {formatPerformanceScore(item.maxScore)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-gray-700">
                        {record.evidence ||
                          record.feedback ||
                          "등록된 피드백이 없습니다."}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "profile" && (
            <div className="mx-auto max-w-xl rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h4 className="border-b border-gray-100 pb-3 text-lg font-extrabold text-gray-800">
                학생 정보 수정
              </h4>
              {readOnly && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">
                  현재 계정은 학생 정보를 수정할 수 없습니다.
                </div>
              )}
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <label>
                    <span className="mb-1 block text-xs font-bold text-gray-500">
                      학년
                    </span>
                    <input
                      type="text"
                      name="grade"
                      value={formData.grade}
                      onChange={handleChange}
                      disabled={readOnly}
                      className="w-full rounded border p-2 text-center text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-bold text-gray-500">
                      반
                    </span>
                    <input
                      type="text"
                      name="class"
                      value={formData.class}
                      onChange={handleChange}
                      disabled={readOnly}
                      className="w-full rounded border p-2 text-center text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-bold text-gray-500">
                      번호
                    </span>
                    <input
                      type="number"
                      name="number"
                      value={formData.number}
                      onChange={handleChange}
                      disabled={readOnly}
                      className="w-full rounded border p-2 text-center text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-500">
                    이름
                  </span>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    disabled={readOnly}
                    className="w-full rounded border p-2 text-sm font-bold focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-500">
                    이메일
                  </span>
                  <input
                    type="text"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    disabled={readOnly}
                    className="w-full rounded border bg-gray-50 p-2 text-sm focus:border-blue-500 focus:outline-none disabled:text-gray-500"
                  />
                </label>
              </div>
              <div className="mt-6 flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded border border-gray-300 bg-white py-2 font-bold text-gray-700 transition hover:bg-gray-50"
                >
                  닫기
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving}
                    className="flex-1 rounded bg-blue-600 py-2 font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:bg-blue-300"
                  >
                    {saving ? "저장 중..." : "저장"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StudentDetailModal;
