import React, { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import PortalSubNavigation from "../../../components/common/PortalSubNavigation";
import { WRITTEN_EXAM_SCORE_KIND } from "../../../lib/performanceScores";
import PerformanceScoreManager from "./PerformanceScoreManager";
import "./writtenExamAnalysis.css";

const WrittenExamAnalysis = lazy(() => import("./WrittenExamAnalysis"));

const WrittenExamEssayScoreManager: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const analysis = params.get("section") === "analysis";
  const navigation = (
    <PortalSubNavigation
      title="정기시험"
      activeLabel={analysis ? "평가 분석" : "점수 확인·운영"}
      variant="tabs"
      className="written-exam-navigation"
    >
      {[
        [false, "점수 확인·운영"],
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
    <Suspense fallback={<p role="status">평가 분석을 불러오는 중입니다.</p>}>
      <WrittenExamAnalysis navigation={navigation} />
    </Suspense>
  ) : (
    <PerformanceScoreManager
      scoreKind={WRITTEN_EXAM_SCORE_KIND}
      navigation={navigation}
    />
  );
};

export default WrittenExamEssayScoreManager;
