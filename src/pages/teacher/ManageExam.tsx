import React, { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { MENUS } from "../../constants/menus";
import { useAuth } from "../../contexts/AuthContext";
import ExamGradingPlan from "./components/ExamGradingPlan";
import ExamOmrConfig from "./components/ExamOmrConfig";
import GradeEvidenceManager from "./components/GradeEvidenceManager";

type ExamTab = "preview" | "omr" | "performance" | "written-essay";

const TAB_QUERY_VALUES = new Set<ExamTab>([
  "preview",
  "omr",
  "performance",
  "written-essay",
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

  useEffect(() => {
    if (!rawTab) return;
    if (rawTab !== "preview" && TAB_QUERY_VALUES.has(rawTab as ExamTab)) return;
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    setSearchParams(next, { replace: true });
  }, [rawTab, searchParams, setSearchParams]);

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
    };
  }, [menuConfig]);

  const selectTab = (tab: ExamTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === "preview") next.delete("tab");
    else next.set("tab", tab);
    setSearchParams(next);
  };

  const tabs: Array<{ id: ExamTab; label: string }> = [
    { id: "preview", label: tabLabels.preview },
    { id: "omr", label: tabLabels.omr },
    { id: "performance", label: tabLabels.performance },
    { id: "written-essay", label: tabLabels.writtenEssay },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div
        className={`mx-auto flex w-full flex-1 flex-col px-4 py-6 ${
          activeTab === "performance" || activeTab === "written-essay"
            ? "max-w-[1600px]"
            : "max-w-7xl"
        }`}
      >
        <div
          className="mb-4 flex shrink-0 overflow-x-auto rounded-t-lg border-b border-gray-200 bg-white px-2"
          role="tablist"
          aria-label="점수 관리 화면"
        >
          {tabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`exam-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`exam-panel-${tab.id}`}
                onClick={() => selectTab(tab.id)}
                className={`min-h-11 whitespace-nowrap border-b-2 px-6 py-3 text-sm font-bold transition ${
                  selected
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-600 hover:bg-gray-50"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <section
          id={`exam-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`exam-tab-${activeTab}`}
          className="relative min-h-[500px] flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-6"
        >
          {activeTab === "preview" && <ExamGradingPlan />}
          {activeTab === "omr" && <ExamOmrConfig />}
          {activeTab === "performance" && (
            <GradeEvidenceManager scoreKind="performance" />
          )}
          {activeTab === "written-essay" && (
            <GradeEvidenceManager scoreKind="written_exam_essay" />
          )}
        </section>
      </div>
    </div>
  );
};

export default ManageExam;
