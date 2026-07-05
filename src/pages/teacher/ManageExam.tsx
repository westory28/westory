import React, { useEffect, useState } from "react";
import ExamGradingPlan from "./components/ExamGradingPlan";
import ExamOmrConfig from "./components/ExamOmrConfig";
import PerformanceScoreManager from "./components/PerformanceScoreManager";
import WrittenExamEssayScoreManager from "./components/WrittenExamEssayScoreManager";
import { useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { cloneDefaultMenus, sanitizeMenuConfig } from "../../constants/menus";

const ManageExam: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    "preview" | "omr" | "performance" | "written-essay"
  >("preview");
  const [tabLabels, setTabLabels] = useState({
    preview: "평가 반영 비율",
    omr: "정기시험 답안",
    performance: "수행평가 점수 관리",
    writtenEssay: "정기시험 논술형 점수 관리",
  });
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

  useEffect(() => {
    const resolveMenuLabels = async () => {
      try {
        const menuSnap = await getDoc(doc(db, "site_settings", "menu_config"));
        const menuConfig = menuSnap.exists()
          ? sanitizeMenuConfig(menuSnap.data())
          : cloneDefaultMenus();
        const teacherExamMenu = (menuConfig.teacher || []).find(
          (menu) => menu.url === "/teacher/exam",
        );
        const children = teacherExamMenu?.children || [];
        const previewLabel =
          children.find((child) => child.url === "/teacher/exam")?.name ||
          "평가 반영 비율";
        const omrLabel =
          children.find((child) => child.url === "/teacher/exam?tab=omr")
            ?.name || "정기시험 답안";
        const performanceLabel =
          children.find(
            (child) => child.url === "/teacher/exam?tab=performance",
          )?.name || "수행평가 점수 관리";
        const writtenEssayLabel =
          children.find(
            (child) => child.url === "/teacher/exam?tab=written-essay",
          )?.name || "정기시험 논술형 점수 관리";
        setTabLabels({
          preview: previewLabel,
          omr: omrLabel,
          performance: performanceLabel,
          writtenEssay: writtenEssayLabel,
        });
      } catch (error) {
        console.error("Failed to load exam menu labels:", error);
        setTabLabels({
          preview: "평가 반영 비율",
          omr: "정기시험 답안",
          performance: "수행평가 점수 관리",
          writtenEssay: "정기시험 논술형 점수 관리",
        });
      }
    };

    void resolveMenuLabels();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <main
        className={`w-full ${
          activeTab === "performance" || activeTab === "written-essay"
            ? "max-w-[1500px]"
            : "max-w-7xl"
        } mx-auto px-4 py-6 flex-1 flex flex-col`}
      >
        <div className="mb-4 flex shrink-0 overflow-x-auto rounded-t-lg border-b border-gray-200 bg-white px-2">
          <button
            onClick={() => setActiveTab("preview")}
            className={`py-3 px-6 font-bold text-sm border-b-2 transition whitespace-nowrap ${
              activeTab === "preview"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-600 hover:bg-gray-50"
            }`}
          >
            {tabLabels.preview}
          </button>
          <button
            onClick={() => setActiveTab("omr")}
            className={`py-3 px-6 font-bold text-sm border-b-2 transition whitespace-nowrap ${
              activeTab === "omr"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-600 hover:bg-gray-50"
            }`}
          >
            {tabLabels.omr}
          </button>
          <button
            onClick={() => setActiveTab("performance")}
            className={`py-3 px-6 font-bold text-sm border-b-2 transition whitespace-nowrap ${
              activeTab === "performance"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-600 hover:bg-gray-50"
            }`}
          >
            {tabLabels.performance}
          </button>
          <button
            onClick={() => setActiveTab("written-essay")}
            className={`py-3 px-6 font-bold text-sm border-b-2 transition whitespace-nowrap ${
              activeTab === "written-essay"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-600 hover:bg-gray-50"
            }`}
          >
            {tabLabels.writtenEssay}
          </button>
        </div>

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
