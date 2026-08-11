import React from "react";
import StudentGradeEvidenceView from "./GradeEvidenceStudentView";

const WrittenExamEssayScoreView: React.FC = () => (
  <StudentGradeEvidenceView scoreKind="written_exam_essay" />
);

export default WrittenExamEssayScoreView;
