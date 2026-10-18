import React, { useEffect, useState } from "react";
import ExamGradingPlan from "./components/ExamGradingPlan";
import ExamOmrConfig from "./components/ExamOmrConfig";
import PerformanceScoreManager from "./components/PerformanceScoreManager";
import WrittenExamEssayScoreManager from "./components/WrittenExamEssayScoreManager";
import { useSearchParams } from "react-router-dom";

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
            ? "grading-page mx-auto flex w-full flex-1 flex-col px-4 py-6"
            : "ws-page flex flex-1 flex-col"
        }
      >
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
