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
        className={`w-full ${
          activeTab === "performance" || activeTab === "written-essay"
            ? "max-w-[1500px]"
            : "max-w-7xl"
        } mx-auto px-4 py-6 flex-1 flex flex-col`}
      >
        <div className="relative min-h-[500px] flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-6">
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
