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
  onReview,
  onRetry,
}: QuizLearningResultProps) {
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
            onClick={onReview}
            className="student-quiz-primary-action"
          >
            답안 및 해설 보기
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="student-quiz-secondary-action"
          >
            다시 풀기
          </button>
        </div>
      </section>
    </div>
  );
}
