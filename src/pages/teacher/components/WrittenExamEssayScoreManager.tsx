import React, { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import PortalSubNavigation from "../../../components/common/PortalSubNavigation";
import {
  PageLoading,
  InlineLoading,
} from "../../../components/common/LoadingState";
import { WRITTEN_EXAM_SCORE_KIND } from "../../../lib/performanceScores";
import PerformanceScoreManager from "./PerformanceScoreManager";
import "./writtenExamAnalysis.css";

const WrittenExamAnalysis = lazy(() => import("./WrittenExamAnalysis"));
const WrittenExamMaterials = lazy(() =>
  import("./WrittenExamAnalysis").then((module) => ({
    default: module.WrittenExamMaterials,
  })),
);

const WrittenExamEssayScoreManager: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const analysis = params.get("section") === "analysis";
  const navigation = (
    <PortalSubNavigation
      title="정기시험"
      activeLabel={analysis ? "평가 분석" : "점수 등록 및 확인"}
      variant="tabs"
      className="written-exam-navigation"
    >
      {[
        [false, "점수 등록 및 확인"],
        [true, "평가 분석"],
      ].map(([value, label]) => (
        <button
          key={String(value)}
          type="button"
          className={analysis === value ? "is-active" : ""}
          aria-current={analysis === value ? "page" : undefined}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set("section", value ? "analysis" : "scores");
            setParams(next);
          }}
        >
          {label}
        </button>
      ))}
    </PortalSubNavigation>
  );
  return analysis ? (
    <Suspense fallback={<PageLoading />}>
      <WrittenExamAnalysis navigation={navigation} />
    </Suspense>
  ) : (
    <PerformanceScoreManager
      scoreKind={WRITTEN_EXAM_SCORE_KIND}
      navigation={navigation}
      writtenExamMaterials={(onBusyChange) => (
        <Suspense fallback={<InlineLoading />}>
          <WrittenExamMaterials onBusyChange={onBusyChange} />
        </Suspense>
      )}
    />
  );
};

export default WrittenExamEssayScoreManager;
