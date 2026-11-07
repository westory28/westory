import React, { useEffect, useState } from "react";
import {
  MockExamQuestionContent,
  type MockExamPaperQuestion,
} from "../../../components/common/MockExamPaper";
import MockExamAnswerControls from "../../../components/common/MockExamAnswerControls";

export default React.memo(function MockExamDraftPreview({
  question,
}: {
  question: MockExamPaperQuestion;
}) {
  const [answer, setAnswer] = useState("");
  const answerIdentity = JSON.stringify([
    question.id,
    question.type,
    question.options,
    question.matchingPairs,
  ]);
  useEffect(() => setAnswer(""), [answerIdentity]);
  const index = Math.max(0, Number(question.paperOrder || 1) - 1);
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
          index={index}
          answer={answer}
          hideAnswers
        />
        <MockExamAnswerControls
          question={question}
          index={index}
          answer={answer}
          onAnswer={setAnswer}
        />
      </div>
    </aside>
  );
});
