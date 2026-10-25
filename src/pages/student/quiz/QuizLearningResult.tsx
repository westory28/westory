import { useState } from "react";
import QuizRelearning from "./QuizRelearning";
import type { QuizRelearningItem } from "./quizPracticeData";

interface QuizLearningResultProps {
  assessmentTitle: string;
  unitTitle: string;
  score: number;
  correctCount: number;
  totalCount: number;
  comparison?: {
    previousScore: number;
    delta: number;
    direction: "up" | "down" | "same";
  } | null;
  reviewItems?: QuizRelearningItem[];
  onReview: () => void;
  onRetry: () => void;
}

export default function QuizLearningResult({
  assessmentTitle,
  unitTitle,
  score,
  correctCount,
  totalCount,
  comparison,
  reviewItems = [],
  onReview,
  onRetry,
}: QuizLearningResultProps) {
  const [reviewing, setReviewing] = useState(false);
  const ringScore = Number.isFinite(score)
    ? Math.min(100, Math.max(0, score))
    : 0;
  const comparisonText = comparison
    ? comparison.direction === "same"
      ? "이전과 같은 점수"
      : `${Math.abs(comparison.delta)}점 ${comparison.direction === "up" ? "상승" : "하락"}`
    : "";

  return (
    <div className="student-quiz-learning-result">
      <section className="student-quiz-result-content">
        {reviewing ? (
          <QuizRelearning
            items={reviewItems}
            onClose={() => setReviewing(false)}
          />
        ) : (
          <>
            <header className="student-quiz-result-heading">
              <h1>{assessmentTitle}</h1>
              <p>{unitTitle}</p>
            </header>
            <div className="student-quiz-result-score">
              <div
                className="student-quiz-score-ring"
                role="img"
                aria-label={`점수 ${score}점, 100점 만점`}
              >
                <svg viewBox="0 0 176 176" aria-hidden="true">
                  <circle
                    className="student-quiz-score-track"
                    cx="88"
                    cy="88"
                    r="76"
                  />
                  {ringScore > 0 && (
                    <circle
                      className="student-quiz-score-value"
                      cx="88"
                      cy="88"
                      r="76"
                      pathLength="100"
                      strokeDasharray={`${ringScore} 100`}
                      transform="rotate(-90 88 88)"
                    />
                  )}
                </svg>
                <p aria-hidden="true">
                  {score}
                  <span>점</span>
                </p>
              </div>
              <p className="student-quiz-result-count">
                정답 <strong>{correctCount}문제</strong> / 총 {totalCount}문제
              </p>
              {comparison && (
                <p className="student-quiz-result-comparison">
                  이전 {comparison.previousScore}점
                  <span aria-hidden="true"> · </span>
                  <strong>{comparisonText}</strong>
                </p>
              )}
            </div>
            <div className="student-quiz-result-next">
              <button
                type="button"
                onClick={
                  reviewItems.length ? () => setReviewing(true) : onReview
                }
                className="student-quiz-primary-action"
              >
                {reviewItems.length
                  ? `오답 ${reviewItems.length}문제 복습하기`
                  : "답안 및 해설 보기"}
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="student-quiz-secondary-action"
              >
                다시 풀기
              </button>
            </div>
            {reviewItems.length > 0 && (
              <div className="student-quiz-result-review-link">
                {reviewItems.length < totalCount - correctCount && (
                  <p>
                    원문이 보관된 오답 {reviewItems.length}문제만 바로 복습할 수
                    있습니다.
                  </p>
                )}
                <button type="button" onClick={onReview}>
                  전체 답안 및 해설 보기
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
