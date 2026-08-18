import React, { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { MENUS } from "../../constants/menus";
import { useAuth } from "../../contexts/AuthContext";
import ExamGradingPlan from "./components/ExamGradingPlan";
import ExamOmrConfig from "./components/ExamOmrConfig";
import PerformanceScoreManager from "./components/PerformanceScoreManager";
import WrittenExamEssayScoreManager from "./components/WrittenExamEssayScoreManager";
import GradeEvidenceManager from "./components/GradeEvidenceManager";

type ExamTab =
  | "preview"
  | "omr"
  | "performance"
  | "written-essay"
  | "evidence-performance"
  | "evidence-written";

const TAB_QUERY_VALUES = new Set<ExamTab>([
  "preview",
  "omr",
  "performance",
  "written-essay",
  "evidence-performance",
  "evidence-written",
]);

const resolveTab = (value: string | null): ExamTab =>
  value && TAB_QUERY_VALUES.has(value as ExamTab)
    ? (value as ExamTab)
    : "preview";

const ManageExam: React.FC = () => {
  const { menuConfig } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab = resolveTab(rawTab);
  const activeEvidenceTabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!rawTab) return;
    if (rawTab !== "preview" && TAB_QUERY_VALUES.has(rawTab as ExamTab)) return;
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    setSearchParams(next, { replace: true });
  }, [rawTab, searchParams, setSearchParams]);

  useEffect(() => {
    if (
      activeTab !== "evidence-performance" &&
      activeTab !== "evidence-written"
    ) {
      return;
    }
    activeEvidenceTabRef.current?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTab]);

  const tabLabels = useMemo(() => {
    const teacherMenus = menuConfig?.teacher || MENUS.teacher;
    const children =
      teacherMenus.find((menu) => menu.url === "/teacher/exam")?.children || [];
    const labelFor = (url: string, fallback: string) =>
      children.find((child) => child.url === url)?.name || fallback;
    return {
      preview: labelFor("/teacher/exam", "평가 반영 비율"),
      omr: labelFor("/teacher/exam?tab=omr", "정기시험 답안"),
      performance: labelFor(
        "/teacher/exam?tab=performance",
        "수행평가 점수 관리",
      ),
      writtenEssay: labelFor(
        "/teacher/exam?tab=written-essay",
        "정기시험 점수 관리",
      ),
      evidencePerformance: labelFor(
        "/teacher/exam?tab=evidence-performance",
        "수행평가 성적 증거",
      ),
      evidenceWritten: labelFor(
        "/teacher/exam?tab=evidence-written",
        "정기시험 성적 증거",
      ),
    };
  }, [menuConfig]);

  const selectTab = (tab: ExamTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === "preview") next.delete("tab");
    else next.set("tab", tab);
    setSearchParams(next);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <main
        className={`w-full ${
          activeTab === "performance" ||
          activeTab === "written-essay" ||
          activeTab === "evidence-performance" ||
          activeTab === "evidence-written"
            ? "max-w-[1500px]"
            : "max-w-7xl"
        } mx-auto px-4 py-6 flex-1 flex flex-col`}
      >
        <div className="mb-4 flex shrink-0 overflow-x-auto rounded-t-lg border-b border-gray-200 bg-white px-2">
          <button
            onClick={() => selectTab("preview")}
            className={`py-3 px-6 font-bold text-sm border-b-2 transition whitespace-nowrap ${
              activeTab === "preview"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-600 hover:bg-gray-50"
            }`}
          >
            {tabLabels.preview}
          </button>
          <button
            onClick={() => selectTab("omr")}
            className={`py-3 px-6 font-bold text-sm border-b-2 transition whitespace-nowrap ${
              activeTab === "omr"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-600 hover:bg-gray-50"
            }`}
          >
            {tabLabels.omr}
          </button>
          <button
            onClick={() => selectTab("performance")}
            className={`py-3 px-6 font-bold text-sm border-b-2 transition whitespace-nowrap ${
              activeTab === "performance"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-600 hover:bg-gray-50"
            }`}
          >
            {tabLabels.performance}
          </button>
          <button
            onClick={() => selectTab("written-essay")}
            className={`py-3 px-6 font-bold text-sm border-b-2 transition whitespace-nowrap ${
              activeTab === "written-essay"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-600 hover:bg-gray-50"
            }`}
          >
            {tabLabels.writtenEssay}
          </button>
          {(activeTab === "evidence-performance" ||
            activeTab === "evidence-written") && (
            <>
              <button
                ref={
                  activeTab === "evidence-performance"
                    ? activeEvidenceTabRef
                    : undefined
                }
                aria-current={
                  activeTab === "evidence-performance" ? "page" : undefined
                }
                onClick={() => selectTab("evidence-performance")}
                className={`py-3 px-6 font-bold text-sm border-b-2 transition whitespace-nowrap ${
                  activeTab === "evidence-performance"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-600 hover:bg-gray-50"
                }`}
              >
                {tabLabels.evidencePerformance}
              </button>
              <button
                ref={
                  activeTab === "evidence-written"
                    ? activeEvidenceTabRef
                    : undefined
                }
                aria-current={
                  activeTab === "evidence-written" ? "page" : undefined
                }
                onClick={() => selectTab("evidence-written")}
                className={`py-3 px-6 font-bold text-sm border-b-2 transition whitespace-nowrap ${
                  activeTab === "evidence-written"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-600 hover:bg-gray-50"
                }`}
              >
                {tabLabels.evidenceWritten}
              </button>
            </>
          )}
        </div>

        <div className="relative min-h-[500px] flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-6">
          {activeTab === "preview" && <ExamGradingPlan />}
          {activeTab === "omr" && <ExamOmrConfig />}
          {activeTab === "performance" && <PerformanceScoreManager />}
          {activeTab === "written-essay" && <WrittenExamEssayScoreManager />}
          {activeTab === "evidence-performance" && (
            <GradeEvidenceManager scoreKind="performance" />
          )}
          {activeTab === "evidence-written" && (
            <GradeEvidenceManager scoreKind="written_exam_essay" />
          )}
        </div>
      </main>
    </div>
  );
};

export default ManageExam;
