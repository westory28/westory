import React from "react";
import { useSearchParams } from "react-router-dom";
import StudentGradeEvidenceView from "./GradeEvidenceStudentView";
import { ScoreConfirmationView } from "./PerformanceScoreView";
import { WRITTEN_EXAM_SCORE_KIND } from "../../../lib/performanceScores";

const WrittenExamEssayScoreView: React.FC = () => {
  const [searchParams] = useSearchParams();
  return searchParams.get("view") === "evidence" ? (
    <StudentGradeEvidenceView scoreKind="written_exam_essay" />
  ) : (
    <ScoreConfirmationView scoreKind={WRITTEN_EXAM_SCORE_KIND} />
  );
};

export default WrittenExamEssayScoreView;
