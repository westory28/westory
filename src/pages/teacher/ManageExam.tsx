import React, { useEffect, useState } from "react";
import ExamGradingPlan from "./components/ExamGradingPlan";
import ExamOmrConfig from "./components/ExamOmrConfig";
import PerformanceScoreManager from "./components/PerformanceScoreManager";
import WrittenExamEssayScoreManager from "./components/WrittenExamEssayScoreManager";
import { useSearchParams } from "react-router-dom";
import { MENUS } from "../../constants/menus";

// These two screens have no heading of their own; show the menu's own name.
const getExamMenuName = (url: string, fallback: string) =>
  MENUS.teacher
    .flatMap((item) => item.children || [])
    .find((child) => child.url === url)?.name || fallback;

const ManageExam: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    "preview" | "omr" | "performance" | "written-essay"
  >("preview");
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const tab = searchParams.get("tab");
    setActiveTab(
      tab === "omr"
        ? "omr"
        : tab === "performance"
          ? "performance"
          : tab === "written-essay"
            ? "written-essay"
            : "preview",
    );
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <main
        className={
          activeTab === "preview"
            ? "ws-page grading-page flex flex-1 flex-col"
            : `ws-page flex flex-1 flex-col ${activeTab === "performance" ? "ws-page--reading" : ""}`
        }
      >
        {(activeTab === "preview" || activeTab === "omr") && (
          <header className="ws-page-header">
            <h1>
              {activeTab === "preview"
                ? getExamMenuName("/teacher/exam", "평가 반영 비율")
                : getExamMenuName("/teacher/exam?tab=omr", "정기시험 답안")}
            </h1>
          </header>
        )}
        <div
          className={
            activeTab === "preview"
              ? "relative min-h-[500px] flex-1 min-w-0"
              : "relative min-h-[500px] min-w-0 flex-1"
          }
        >
          {activeTab === "preview" && <ExamGradingPlan />}
          {activeTab === "omr" && <ExamOmrConfig />}
          {activeTab === "performance" && <PerformanceScoreManager />}
          {activeTab === "written-essay" && <WrittenExamEssayScoreManager />}
        </div>
      </main>
    </div>
  );
};

export default ManageExam;
