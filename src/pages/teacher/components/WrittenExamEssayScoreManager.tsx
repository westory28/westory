import React from "react";
import { WRITTEN_EXAM_SCORE_KIND } from "../../../lib/performanceScores";
import PerformanceScoreManager from "./PerformanceScoreManager";

const WrittenExamEssayScoreManager: React.FC = () => (
  <PerformanceScoreManager scoreKind={WRITTEN_EXAM_SCORE_KIND} />
);

export default WrittenExamEssayScoreManager;
