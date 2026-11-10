import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MockExamQuestionContent,
  type MockExamPaperQuestion,
} from "../../../components/common/MockExamPaper";
import QuizPassage from "../../../components/common/QuizPassage";
import { acquirePageScrollLock } from "../../../lib/pageScrollLock";
import {
  getQuizClassQuestion,
  quizClassAnalysisError,
  type QuizClassQuestionRequest,
  type QuizClassScope,
} from "../../../lib/quizClassAnalysis";

export default function QuizAnalysisQuestionDialog({
  scope,
  identityKey,
  selection,
  inlineQuestion,
  onClose,
}: {
  scope: QuizClassScope;
  identityKey: string;
  selection: QuizClassQuestionRequest | null;
  inlineQuestion?: MockExamPaperQuestion;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [question, setQuestion] = useState<MockExamPaperQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify([
    identityKey,
    scope.semesterId,
    scope.unitId,
    scope.category,
    scope.examRound,
    scope.classIds,
    scope.grade,
    selection,
  ]);
  const currentRequest = useRef(requestKey);
  currentRequest.current = requestKey;
  const [loadedKey, setLoadedKey] = useState("");
  useEffect(() => {
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current!;
    const release = acquirePageScrollLock();
    dialog.showModal();
    return () => {
      dialog.close();
      release();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    let active = true;
    setQuestion(null);
    setError("");
    setLoading(true);
    setLoadedKey("");
    const finish = (original: MockExamPaperQuestion | null) => {
      if (active && currentRequest.current === requestKey) {
        setQuestion(original);
        setLoadedKey(requestKey);
        setLoading(false);
      }
    };
    if (inlineQuestion) finish(inlineQuestion);
    else if (!selection) finish(null);
    else
      void getQuizClassQuestion(scope, identityKey, selection)
        .then((result) => finish(result.question))
        .catch((failure) => {
          if (active && currentRequest.current === requestKey) {
            setError(quizClassAnalysisError(failure));
            setLoadedKey(requestKey);
            setLoading(false);
          }
        });
    return () => {
      active = false;
    };
  }, [requestKey, retry, inlineQuestion]);
  const ready = loadedKey === requestKey && !loading;
  return createPortal(
    <dialog
      className="qaa-question-dialog"
      ref={dialogRef}
      aria-labelledby="qaa-question-title"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="qaa-question">
        <div className="qca-section-heading">
          <h3 id="qaa-question-title">응시 당시 문항</h3>
          <button
            type="button"
            className="qca-secondary"
            autoFocus
            onClick={onClose}
          >
            닫기
          </button>
        </div>
        {!ready ? (
          <p role="status">문항을 불러오는 중입니다.</p>
        ) : error ? (
          <div role="alert" className="qca-error">
            {error}
            <button
              type="button"
              className="qca-secondary"
              onClick={() => setRetry((value) => value + 1)}
            >
              다시 시도
            </button>
          </div>
        ) : !question ? (
          <p role="status">응시 당시 문항 원문이 보관되어 있지 않습니다.</p>
        ) : (
          <>
            <MockExamQuestionContent
              question={question}
              index={Math.max(0, (question.paperOrder || 1) - 1)}
              answer={String(question.answer || "")}
            />
            <dl className="qaa-answer">
              <dt>정답</dt>
              <dd>{String(question.answer || "미보관")}</dd>
              <dt>해설</dt>
              <dd>
                {question.explanation ? (
                  <QuizPassage value={question.explanation} />
                ) : (
                  "해설 미등록"
                )}
              </dd>
            </dl>
          </>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
