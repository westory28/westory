interface QuizLearningResultProps {
  assessmentTitle: string;
  unitTitle: string;
  score: number;
  correctCount: number;
  totalCount: number;
  onReview: () => void;
  onRetry: () => void;
}

export default function QuizLearningResult({
  assessmentTitle,
  unitTitle,
  score,
  correctCount,
  totalCount,
  onReview,
  onRetry,
}: QuizLearningResultProps) {
  return (
    <div className="student-quiz-learning-result mx-auto w-full max-w-2xl px-4 py-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
        <header className="student-quiz-result-heading">
          <h1 className="text-2xl font-bold text-gray-900">
            {assessmentTitle}
          </h1>
          <p className="mt-2 text-base text-gray-600">{unitTitle}</p>
        </header>
        <div className="student-quiz-result-score">
          <p className="text-3xl font-bold text-blue-700">
            {score}
            <span className="ml-1 text-base">점</span>
          </p>
          <p
            className="mt-2 text-base text-gray-600"
            aria-label={`정답 ${correctCount}문항, 전체 ${totalCount}문항`}
          >
            {correctCount}/{totalCount}
          </p>
        </div>
        <div className="student-quiz-result-next">
          <button
            type="button"
            onClick={onReview}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            답안 및 해설 보기
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            다시 풀기
          </button>
        </div>
      </section>
    </div>
  );
}
