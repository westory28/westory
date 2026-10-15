import InfoHelp from "../../../components/common/InfoHelp";
import {
  ASSESSMENT_LEARNING_EVIDENCE_LABELS,
  type AssessmentLearningSummary,
} from "../../../lib/assessmentLearning";

const seconds = (value: number | null) =>
  value === null ? "관찰 없음" : `${(value / 1000).toFixed(1)}초`;

interface QuizLearningResultProps {
  score: number;
  correctCount: number;
  summary: AssessmentLearningSummary;
  labels: Record<string, string>;
  pointNotice: string;
  missingOriginalQuestionCount?: number;
  onReview: () => void;
  onChooseAssessment: () => void;
  onRetry: () => void;
  onLesson: (id: string) => void;
}

export default function QuizLearningResult({
  score,
  correctCount,
  summary,
  labels,
  pointNotice,
  missingOriginalQuestionCount = 0,
  onReview,
  onChooseAssessment,
  onRetry,
  onLesson,
}: QuizLearningResultProps) {
  const hasConcepts =
    summary.concepts.length > 0 && summary.missingConceptQuestionCount === 0;
  const groups = [...(hasConcepts ? summary.concepts : summary.units)].sort(
    (left, right) =>
      right.wrongQuestions - left.wrongQuestions ||
      left.label.localeCompare(right.label, "ko"),
  );

  return (
    <div className="student-quiz-learning-result mx-auto w-full max-w-4xl px-4 py-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
        <header className="student-quiz-result-heading">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">이번 평가 결과</h1>
            <p className="mt-2 text-sm text-gray-600">
              {summary.assessedQuestionCount}문항 중 {correctCount}문항 정답
            </p>
          </div>
          <p className="text-3xl font-bold text-blue-700">
            {score}
            <span className="ml-1 text-base">점</span>
          </p>
        </header>

        {pointNotice && (
          <p className="mt-4 text-sm text-gray-600">{pointNotice}</p>
        )}
        {missingOriginalQuestionCount > 0 && (
          <p className="mt-3 text-sm text-gray-600">
            {missingOriginalQuestionCount}문항은 당시 원문이 보관되지
            않았습니다.
          </p>
        )}

        <div className="student-quiz-result-section-heading">
          <h2 className="text-lg font-bold text-gray-900">
            {hasConcepts ? "개념별 확인" : "단원별 확인"}
          </h2>
          <InfoHelp label="평가 결과 해석 안내">
            이번에 제출한 서로 다른 문항만 묶어 정답과 오답을 보여 줍니다.
            문항이 1~2개인 분류는 판단 자료가 부족합니다. 정답이 많아도 해당
            개념을 완전히 이해했다고 단정하지 않습니다. 문항에 등록된 분류를
            사용하며, 풀이 시간만으로 실력이나 오개념을 추측하지 않습니다.
          </InfoHelp>
        </div>

        {groups.length === 0 ? (
          <p className="py-4 text-gray-600">
            단원·개념 분류가 없어 문항별 답안으로 확인할 수 있습니다.
          </p>
        ) : (
          <ul className="student-quiz-evidence-list">
            {groups.map((group) => (
              <li key={group.key}>
                <div className="student-quiz-evidence-main">
                  <h3 className="font-bold text-gray-900">
                    {hasConcepts
                      ? group.label
                      : labels[group.key] || "단원 분류 확인 필요"}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {group.distinctQuestions}문항 · 정답{" "}
                    {group.correctQuestions} · 오답 {group.wrongQuestions}
                    {group.hintedQuestionCount > 0 &&
                      ` · 힌트 확인 ${group.hintedQuestionCount}`}
                  </p>
                  {group.possibleConfusions.length > 0 && (
                    <p className="mt-2 text-sm text-gray-700">
                      확인할 내용: {group.possibleConfusions.join(" · ")}
                    </p>
                  )}
                  <p className="text-sm text-gray-600">
                    {group.behavior.observedQuestionCount === 0 ? (
                      "풀이 관찰 기록 없음"
                    ) : (
                      <>
                        관찰 {group.behavior.observedQuestionCount}/
                        {group.distinctQuestions}문항 · 풀이{" "}
                        {seconds(group.behavior.activeMs)}
                        {group.behavior.answerChangeCount !== null &&
                          ` · 답 변경 ${group.behavior.answerChangeCount}회`}
                        {group.behavior.partialQuestionCount > 0 &&
                          ` · 일부 구간만 기록 ${group.behavior.partialQuestionCount}문항`}
                      </>
                    )}
                  </p>
                  {group.behavior.observedQuestionCount > 0 && (
                    <details className="mt-2 text-sm text-gray-600">
                      <summary className="min-h-11 cursor-pointer py-3">
                        답안 선택 기록
                      </summary>
                      <p>
                        첫 답까지 평균{" "}
                        {seconds(group.behavior.meanFirstResponseMs)} · 마지막
                        답까지 평균{" "}
                        {seconds(group.behavior.meanFinalResponseMs)}
                      </p>
                      <p>
                        답을 바꾼 문항{" "}
                        {group.behavior.changedQuestionCount ?? "—"}개 · 재방문{" "}
                        {group.behavior.revisitCount ?? "—"}회
                      </p>
                    </details>
                  )}
                </div>
                <div className="student-quiz-evidence-actions">
                  <span
                    className={
                      group.wrongQuestions > 0
                        ? "text-amber-800"
                        : "text-gray-600"
                    }
                  >
                    {ASSESSMENT_LEARNING_EVIDENCE_LABELS[group.evidence]}
                  </span>
                  {group.reviewLessonIds
                    .filter((id) => !!labels[id])
                    .slice(0, 2)
                    .map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onLesson(id)}
                      >
                        {labels[id]} 복습
                      </button>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        {summary.limitedMetadataQuestionCount > 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            분류 정보가 일부 없는 {summary.limitedMetadataQuestionCount}문항은
            문항별 답안으로 확인해 주세요.
          </p>
        ) : (
          summary.missingConceptQuestionCount > 0 && (
            <p className="mt-3 text-sm text-gray-500">
              개념이 등록되지 않은 {summary.missingConceptQuestionCount}문항은
              단원과 문항별 답안으로 확인합니다.
            </p>
          )
        )}

        <div className="student-quiz-result-next">
          <button
            type="button"
            onClick={onReview}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            답안·해설 복습
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            다시 풀어 확인
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
          <span className="inline-flex items-center gap-1">
            재응시 기준
            <InfoHelp label="재응시 문항 안내">
              응시 횟수와 대기 시간은 기존 기준을 따릅니다. 다시 응시하면
              틀렸거나 힌트를 참고한 개념의 다른 문항을 우선합니다. 해당 문항이
              부족하면 다른 개념이나 이전에 푼 문항이 포함될 수 있습니다.
            </InfoHelp>
          </span>
          <button
            type="button"
            className="min-h-11 underline underline-offset-4"
            onClick={onChooseAssessment}
          >
            평가 목록
          </button>
        </div>
      </section>
    </div>
  );
}
