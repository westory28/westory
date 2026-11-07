import React from "react";
import {
  MockExamQuestionContent,
  type MockExamPaperQuestion,
} from "../../../components/common/MockExamPaper";

export default React.memo(function MockExamDraftPreview({
  question,
}: {
  question: MockExamPaperQuestion;
}) {
  return (
    <aside
      className="mock-exam-draft-preview"
      aria-label="학생 화면 미리보기"
      tabIndex={0}
    >
      <div className="mock-exam-draft-preview-heading">미리보기</div>
      <div className="mock-exam-draft-preview-paper">
        <MockExamQuestionContent
          question={question}
          index={Math.max(0, Number(question.paperOrder || 1) - 1)}
        />
      </div>
    </aside>
  );
});
