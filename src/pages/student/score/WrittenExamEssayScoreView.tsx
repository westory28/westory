import React from "react";
import { ScoreConfirmationView } from "./PerformanceScoreView";
import { WRITTEN_EXAM_SCORE_KIND } from "../../../lib/performanceScores";

const WrittenExamEssayScoreView: React.FC = () => (
  <ScoreConfirmationView scoreKind={WRITTEN_EXAM_SCORE_KIND} />
);

export default WrittenExamEssayScoreView;
