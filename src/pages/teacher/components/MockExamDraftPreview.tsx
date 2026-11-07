import React, { useEffect, useRef, useState } from "react";
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
  const [solving, setSolving] = useState(false);
  const [answer, setAnswer] = useState("");
  const questionCard = useRef<HTMLDivElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const answerIdentity = JSON.stringify([
    question.id,
    question.type,
    question.options,
    question.matchingPairs,
  ]);
  useEffect(() => setAnswer(""), [answerIdentity]);
  useEffect(() => {
    if (solving) returnButton.current?.focus();
  }, [solving]);
  const index = Math.max(0, Number(question.paperOrder || 1) - 1);
  const returnToQuestion = () => {
    setSolving(false);
    requestAnimationFrame(() => questionCard.current?.focus());
  };
  return (
    <aside
      className="mock-exam-draft-preview"
      aria-label="학생 화면 미리보기"
      tabIndex={0}
      onKeyDown={(event) => {
        if (solving && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          returnToQuestion();
        }
      }}
    >
      <div className="mock-exam-draft-preview-heading">미리보기</div>
      {solving && (
        <button
          ref={returnButton}
          type="button"
          className="quiz-authoring-button mock-exam-preview-back"
          onClick={returnToQuestion}
        >
          미리보기로 돌아가기
        </button>
      )}
      <div
        ref={questionCard}
        className={`mock-exam-draft-preview-paper ${solving ? "is-current" : "is-interactive"}`}
        role={solving ? undefined : "button"}
        tabIndex={solving ? undefined : 0}
        aria-label={solving ? undefined : "문제 풀이 미리보기"}
        onClick={() => {
          if (!solving) setSolving(true);
        }}
        onKeyDown={(event) => {
          if (
            !solving &&
            event.target === event.currentTarget &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            setSolving(true);
          }
        }}
      >
        <MockExamQuestionContent
          question={question}
          index={index}
          answer={answer}
          hideAnswers={solving}
        />
        {solving && (
          <MockExamAnswerControls
            question={question}
            index={index}
            answer={answer}
            onAnswer={setAnswer}
          />
        )}
      </div>
    </aside>
  );
});
