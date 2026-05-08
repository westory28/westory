import React, { useEffect, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import PointRankBadge from "../../../components/common/PointRankBadge";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import { formatWisAmount } from "../../../lib/pointFormatters";
import {
  loadStudentProgressSummary,
  type StudentProgressSummary,
} from "../../../lib/studentProgressSummary";

interface Student {
  id: string;
  grade: string;
  class: string;
  number: number;
  name: string;
  email: string;
}

type DetailTab = "summary" | "profile";
type SummaryPanel = "overview" | "lesson" | "quiz";

interface StudentDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student | null;
  onUpdate: () => void;
  readOnly?: boolean;
  initialTab?: DetailTab;
}

const EMPTY_SUMMARY_TEXT = "-";

const StudentDetailModal: React.FC<StudentDetailModalProps> = ({
  isOpen,
  onClose,
  student,
  onUpdate,
  readOnly = false,
  initialTab = "summary",
}) => {
  const { config } = useAuth();
  const [activeTab, setActiveTab] = useState<DetailTab>(initialTab);
  const [summary, setSummary] = useState<StudentProgressSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryPanel, setSummaryPanel] = useState<SummaryPanel>("overview");
  const [quizUnitFilter, setQuizUnitFilter] = useState("all");
  const [quizCategoryFilter, setQuizCategoryFilter] = useState("all");
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
    setActiveTab(initialTab);
    setSummaryPanel("overview");
    setQuizUnitFilter("all");
    setQuizCategoryFilter("all");
  }, [initialTab, isOpen]);

  useEffect(() => {
    if (!student) return;
    setFormData(student);
  }, [student]);

  useEffect(() => {
    if (!isOpen || !student?.id) return;
    let cancelled = false;
    const loadSummary = async () => {
      setSummaryLoading(true);
      try {
        const nextSummary = await loadStudentProgressSummary(
          config,
          student.id,
        );
        if (!cancelled) setSummary(nextSummary);
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    };

    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [config, isOpen, student?.id]);

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
      await updateDoc(doc(db, "users", formData.id), {
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

  if (!isOpen || !student) return null;

  const lesson = summary?.lesson;
  const quiz = summary?.quiz;
  const historyClassroom = summary?.historyClassroom;
  const wis = summary?.wis;
  const lessonUnits = lesson?.units || [];
  const lessonTrackedUnits = lessonUnits.filter(
    (unit) => unit.blankCount > 0 || !lesson?.worksheetUnits,
  );
  const lessonWorksheetTotal =
    lesson?.worksheetUnits ||
    lessonTrackedUnits.length ||
    lesson?.totalLessons ||
    0;
  const lessonSubmittedTotal = lessonTrackedUnits.filter(
    (unit) => unit.submitted,
  ).length;
  const quizGroups = quiz?.groups || [];
  const quizUnitOptions = Array.from(
    new Set(quizGroups.map((item) => item.unitTitle).filter(Boolean)),
  );
  const quizCategoryOptions = Array.from(
    new Map(
      quizGroups.map((item) => [
        item.category,
        { category: item.category, label: item.categoryLabel },
      ]),
    ).values(),
  );
  const filteredQuizGroups = quizGroups.filter(
    (item) =>
      (quizUnitFilter === "all" || item.unitTitle === quizUnitFilter) &&
      (quizCategoryFilter === "all" || item.category === quizCategoryFilter),
  );

  const summaryCardClassName =
    "rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl animate-fadeScale"
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
            {[
              {
                key: "summary" as const,
                label: "학습 현황",
                icon: "fa-chart-line",
              },
              {
                key: "profile" as const,
                label: "정보 수정",
                icon: "fa-id-card",
              },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
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
          {activeTab === "summary" && (
            <div className="space-y-4">
              {summaryLoading && (
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm font-bold text-gray-400">
                  학생 학습 현황을 불러오는 중...
                </div>
              )}

              {!summaryLoading && (
                <>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <button
                      type="button"
                      onClick={() => setSummaryPanel("lesson")}
                      className={summaryCardClassName}
                      title="제출한 수업 자료 상세 보기"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-extrabold text-gray-800">
                          수업 자료
                        </div>
                        <i className="fas fa-book-open text-blue-500"></i>
                      </div>
                      <div className="mt-4 text-3xl font-black text-blue-700">
                        {lesson?.unavailable
                          ? EMPTY_SUMMARY_TEXT
                          : `${lessonSubmittedTotal}/${lessonWorksheetTotal}`}
                      </div>
                      <div className="mt-2 text-xs font-semibold leading-5 text-gray-500">
                        {lesson?.unavailable
                          ? lesson.message
                          : `제출 ${lessonSubmittedTotal}개 · 최근 ${lesson?.latestUnitTitle || "기록 없음"}`}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSummaryPanel("quiz")}
                      className={summaryCardClassName}
                      title="평가 기록 상세 보기"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-extrabold text-gray-800">
                          평가 기록
                        </div>
                        <i className="fas fa-clipboard-check text-emerald-500"></i>
                      </div>
                      <div className="mt-4 text-3xl font-black text-emerald-700">
                        {quiz?.unavailable
                          ? EMPTY_SUMMARY_TEXT
                          : `${quiz?.totalAttempts || 0}회`}
                      </div>
                      <div className="mt-2 text-xs font-semibold leading-5 text-gray-500">
                        {quiz?.unavailable
                          ? quiz.message
                          : `평균 ${quiz?.averageScore || 0}점 · 오답 ${quiz?.wrongCount || 0}개`}
                      </div>
                    </button>

                    <section className={summaryCardClassName}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-extrabold text-gray-800">
                          역사교실
                        </div>
                        <i className="fas fa-landmark text-amber-500"></i>
                      </div>
                      <div className="mt-4 text-3xl font-black text-amber-700">
                        {historyClassroom?.unavailable
                          ? EMPTY_SUMMARY_TEXT
                          : `${historyClassroom?.passedCount || 0}/${historyClassroom?.totalAttempts || 0}`}
                      </div>
                      <div className="mt-2 text-xs font-semibold leading-5 text-gray-500">
                        {historyClassroom?.unavailable
                          ? historyClassroom.message
                          : `평균 ${historyClassroom?.averagePercent || 0}% · 최근 ${historyClassroom?.latestStatusLabel || "기록 없음"}`}
                      </div>
                    </section>

                    <section className={summaryCardClassName}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-extrabold text-gray-800">
                          위스
                        </div>
                        <i className="fas fa-coins text-violet-500"></i>
                      </div>
                      <div className="mt-4 text-2xl font-black text-violet-700">
                        {wis?.unavailable
                          ? EMPTY_SUMMARY_TEXT
                          : formatWisAmount(wis?.balance || 0)}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold leading-5 text-gray-500">
                        {wis?.unavailable ? (
                          wis.message
                        ) : (
                          <>
                            {wis?.currentRank && (
                              <PointRankBadge
                                rank={wis.currentRank}
                                size="sm"
                              />
                            )}
                            <span>
                              누적{" "}
                              {formatWisAmount(
                                wis?.currentRank?.metricValue ||
                                  wis?.earnedTotal ||
                                  0,
                              )}
                            </span>
                          </>
                        )}
                      </div>
                    </section>
                  </div>

                  {summaryPanel === "lesson" && (
                    <section className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-extrabold text-gray-900">
                          수업 자료 제출 상세
                        </h4>
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                          저장한 수업 자료 기준
                        </span>
                      </div>
                      <div className="grid gap-2">
                        {lessonUnits.map((unit) => {
                          const accuracy =
                            unit.blankCount > 0
                              ? Math.round(
                                  (unit.correctCount / unit.blankCount) * 100,
                                )
                              : 0;
                          return (
                            <div
                              key={unit.unitId}
                              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-extrabold text-gray-800">
                                    {unit.title}
                                  </div>
                                  <div className="mt-1 text-xs font-semibold text-gray-500">
                                    정답률 {accuracy}% · 정답{" "}
                                    {unit.correctCount}/{unit.blankCount}
                                  </div>
                                </div>
                                <span
                                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold ${
                                    unit.submitted
                                      ? "bg-emerald-50 text-emerald-700"
                                      : "bg-slate-100 text-slate-600"
                                  }`}
                                >
                                  {unit.submissionLabel}
                                </span>
                              </div>
                              {unit.latestUpdatedAtText && (
                                <div className="mt-2 text-xs font-semibold text-gray-400">
                                  마지막 저장 {unit.latestUpdatedAtText}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {!lesson?.units?.length && (
                          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm font-bold text-gray-400 md:col-span-2">
                            조회할 수업 자료 진행 기록이 없습니다.
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {summaryPanel === "quiz" && (
                    <section className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-extrabold text-gray-900">
                          평가 결과 상세
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={quizUnitFilter}
                            onChange={(event) =>
                              setQuizUnitFilter(event.target.value)
                            }
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700"
                            aria-label="평가 단원 필터"
                          >
                            <option value="all">전체 단원</option>
                            {quizUnitOptions.map((unitTitle) => (
                              <option key={unitTitle} value={unitTitle}>
                                {unitTitle}
                              </option>
                            ))}
                          </select>
                          <select
                            value={quizCategoryFilter}
                            onChange={(event) =>
                              setQuizCategoryFilter(event.target.value)
                            }
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700"
                            aria-label="평가 유형 필터"
                          >
                            <option value="all">전체 유형</option>
                            {quizCategoryOptions.map((category) => (
                              <option
                                key={category.category}
                                value={category.category}
                              >
                                {category.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {filteredQuizGroups.map((group) => (
                          <div
                            key={`${group.unitTitle}-${group.category}`}
                            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-extrabold text-gray-800">
                                  {group.unitTitle}
                                </div>
                                <div className="mt-1 text-xs font-bold text-emerald-700">
                                  {group.categoryLabel}
                                </div>
                              </div>
                              <span className="shrink-0 text-lg font-black text-emerald-700">
                                평균 {group.averageScore}점
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-gray-500">
                              <span>응시 {group.totalAttempts}회</span>
                              <span>최근 {group.latestScore ?? 0}점</span>
                              <span>오답 {group.wrongCount}개</span>
                            </div>
                            {group.latestDateText && (
                              <div className="mt-1 text-xs font-semibold text-gray-400">
                                최근 응시 {group.latestDateText}
                              </div>
                            )}
                          </div>
                        ))}
                        {!filteredQuizGroups.length && (
                          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm font-bold text-gray-400 md:col-span-2">
                            조건에 맞는 평가 기록이 없습니다.
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  <div className="grid gap-4 lg:grid-cols-2">
                    <section className={summaryCardClassName}>
                      <h4 className="text-sm font-extrabold text-gray-800">
                        최근 활동
                      </h4>
                      <div className="mt-3 space-y-2 text-sm text-gray-600">
                        <div className="flex justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                          <span className="font-bold text-gray-700">
                            수업 자료
                          </span>
                          <span className="text-right">
                            {lesson?.latestUnitTitle || "최근 저장 기록 없음"}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                          <span className="font-bold text-gray-700">평가</span>
                          <span className="text-right">
                            {quiz?.latestTitle
                              ? `${quiz.latestTitle} · ${quiz.latestScore ?? 0}점`
                              : "최근 응시 기록 없음"}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                          <span className="font-bold text-gray-700">
                            역사교실
                          </span>
                          <span className="text-right">
                            {historyClassroom?.latestTitle
                              ? `${historyClassroom.latestTitle} · ${historyClassroom.latestStatusLabel}`
                              : "최근 결과 없음"}
                          </span>
                        </div>
                      </div>
                    </section>

                    <section className={summaryCardClassName}>
                      <h4 className="text-sm font-extrabold text-gray-800">
                        지도 참고
                      </h4>
                      <div className="mt-3 space-y-2 text-sm text-gray-600">
                        <div className="rounded-lg bg-blue-50 px-3 py-2 font-semibold text-blue-800">
                          수업 자료는 학생이 저장한 경우 제출로 집계하고, 빈칸은
                          비어 있어도 오답으로 정답률에 반영합니다.
                        </div>
                        <div className="rounded-lg bg-emerald-50 px-3 py-2 font-semibold text-emerald-800">
                          평가 카드를 누르면 현재 학기 응시 기록을 단원과 평가
                          유형별로 나누어 볼 수 있습니다.
                        </div>
                        <div className="rounded-lg bg-amber-50 px-3 py-2 font-semibold text-amber-800">
                          권한이 없는 항목은 표시되지 않습니다. 위스는 위스 조회
                          권한, 수업 자료 진행률은 관리자 권한이 필요할 수
                          있습니다.
                        </div>
                      </div>
                    </section>
                  </div>
                </>
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
