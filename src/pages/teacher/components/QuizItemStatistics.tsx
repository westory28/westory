import { useState } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import type {
  QuizItemStatisticsRow,
  QuizItemStatisticsSummary,
} from "../../../lib/quizAnalysis";

const unavailable: Record<string, string> = {
  insufficient_students: "표본 3명 미만",
  single_item: "단일 문항 시험지",
  constant_item: "모두 정답 또는 모두 오답",
  constant_rest_score: "나머지 문항 점수 동일",
  constant_total_score: "총점 동일",
};
const answerText = (value: string) =>
  value.replace(/\|\|/g, " · ").replace(/=>/g, " ↔ ");

export default function QuizItemStatistics({
  row,
  summary,
  answer,
}: {
  row?: QuizItemStatisticsRow;
  summary: QuizItemStatisticsSummary;
  answer: string;
}) {
  const [formKey, setFormKey] = useState("");
  const cohorts = row?.cohorts || [];
  const cohort =
    cohorts.length === 1
      ? cohorts[0]
      : cohorts.find((item) => item.formKey === formKey);
  const correlation = cohort?.correctedItemTotalCorrelation;
  return (
    <section className="qa-item-statistics" aria-label="첫 제출 문항 분석">
      <div className="qa-section-head">
        <h4>첫 제출 문항 분석</h4>
        <InfoHelp
          label="워싱턴대 문항 분석 기준"
          sections={[
            {
              text: "불러온 기록 중 학생별 첫 제출을 사용합니다. 같은 문항 구성·현재 버전의 완전한 정오표만 모으며, 서로 다른 시험지는 합치지 않습니다. 소단원을 좁혀도 나머지 문항 점수는 시험지 전체를 기준으로 계산합니다.",
            },
            {
              title: "계산",
              rows: [
                {
                  label: "정답률",
                  content:
                    "정답 학생 수 ÷ 해당 시험지 표본 수 × 100. 높을수록 쉬운 문항입니다.",
                },
                {
                  label: "변별도",
                  content:
                    "이 문항의 정오(1·0)와 이 문항을 뺀 총점의 피어슨 상관계수입니다. .30 초과 양호, .10~.30 보통, .10 미만 검토. 음수이면 정답·발문·자료부터 확인합니다.",
                },
                {
                  label: "시험지 신뢰도",
                  content:
                    "같은 시험지의 전체 문항으로 계산한 Cronbach α입니다. 각 문항을 같은 배점의 정오(1·0)로 처리하므로 KR-20과 같습니다. 한 문항의 품질 점수가 아닙니다.",
                },
              ],
            },
            {
              text: "위스토리는 표본 3명 미만이면 상관·신뢰도를 계산하지 않고, 20명 미만이면 소표본으로 표시합니다. 이는 서비스의 보수적 표시 기준이며 워싱턴대의 최소 표본 규정은 아닙니다. 이전 기록 조회 한도가 있으면 실제 최초 응시와 다를 수 있습니다.",
            },
            {
              text: (
                <a
                  href="https://www.washington.edu/assessment/scanning-scoring/scoring/reports/item-analysis/"
                  target="_blank"
                  rel="noreferrer"
                >
                  워싱턴대 문항 분석 안내
                </a>
              ),
            },
          ]}
        />
      </div>
      {cohorts.length > 1 && (
        <label className="qa-form-filter">
          시험지 구성
          <select
            aria-label="문항 분석 시험지 구성"
            value={formKey}
            onChange={(event) => setFormKey(event.target.value)}
          >
            <option value="">시험지 선택 ({cohorts.length}종)</option>
            {cohorts.map((item, index) => (
              <option key={item.formKey} value={item.formKey}>
                시험지 {index + 1} · {item.itemCount}문항 · {item.sampleSize}명
              </option>
            ))}
          </select>
        </label>
      )}
      {!cohorts.length ? (
        <p className="qa-muted">
          같은 시험지·현재 버전으로 분석할 첫 제출 기록이 없습니다.
        </p>
      ) : cohort ? (
        <>
          <div className="qa-legend">
            <span>
              표본 {cohort.sampleSize}명 · {cohort.itemCount}문항
            </span>
            {cohort.smallSample && <span>소표본 · 참고용</span>}
          </div>
          <dl className="qa-statistics-grid">
            <div>
              <dt>첫 제출 정답률</dt>
              <dd>
                {cohort.difficultyPercent.toFixed(1)}%{" "}
                <small>
                  {cohort.difficultyPercent >= 85
                    ? "쉬움"
                    : cohort.difficultyPercent <= 50
                      ? "어려움"
                      : "보통"}
                </small>
              </dd>
            </div>
            <div>
              <dt>변별도</dt>
              <dd>
                {correlation == null ? "—" : correlation.toFixed(2)}{" "}
                <small>
                  {correlation == null
                    ? unavailable[cohort.correlationUnavailableReason || ""]
                    : correlation < 0
                      ? "음수 · 정답·발문 확인"
                      : correlation > 0.3
                        ? "양호"
                        : correlation >= 0.1
                          ? "보통"
                          : "검토"}
                </small>
              </dd>
            </div>
            <div>
              <dt>시험지 신뢰도 (α)</dt>
              <dd>
                {cohort.alphaReliability == null
                  ? "—"
                  : cohort.alphaReliability.toFixed(2)}
                <small>
                  {cohort.alphaReliability == null
                    ? unavailable[cohort.alphaUnavailableReason || ""]
                    : "같은 시험지 전체 문항"}
                </small>
              </dd>
            </div>
          </dl>
          <div className="qa-section-head">
            <h4>첫 제출 답안 분포</h4>
            <InfoHelp label="첫 제출 답안 분포 기준">
              비율의 분모는 무응답을 포함한 해당 시험지의 전체 표본입니다.
              나머지 문항 평균은 해당 답안을 고른 학생들이 이 문항을 제외한
              문항에서 얻은 정답률의 평균입니다. 높은 점수의 학생들이 많이 고른
              오답은 정답·표현의 모호함을 살펴보세요.
            </InfoHelp>
          </div>
          <div
            className="qa-first-options"
            role="table"
            aria-label="첫 제출 답안별 분석"
          >
            <div className="qa-first-option" role="row">
              <span role="columnheader">답안</span>
              <span role="columnheader">선택</span>
              <span role="columnheader">나머지 문항 평균</span>
            </div>
            {cohort.options.map((option) => (
              <div className="qa-first-option" role="row" key={option.answer}>
                <span role="cell">
                  {answerText(option.answer)}
                  {option.answer === answer && (
                    <strong className="qa-answer-key">정답</strong>
                  )}
                </span>
                <span role="cell">
                  {option.count}명{" "}
                  <small>({Math.round(option.percent)}%)</small>
                </span>
                <span role="cell">
                  {option.meanRestPercent == null
                    ? "—"
                    : `${option.meanRestPercent.toFixed(1)}%`}
                </span>
              </div>
            ))}
          </div>
          {!!(cohort.unansweredCount + cohort.missingAnswerCount) && (
            <div className="qa-legend">
              <span>무응답 {cohort.unansweredCount}명</span>
              <span>답안 미보관 {cohort.missingAnswerCount}명</span>
            </div>
          )}
        </>
      ) : (
        <p className="qa-muted">분석할 시험지 구성을 선택하세요.</p>
      )}
      {!!(
        summary.excludedChronologyCount +
        summary.excludedIncompleteCount +
        summary.excludedRevisionCount
      ) && (
        <div className="qa-legend">
          <span>평가 전체 제외 기록</span>
          {!!summary.excludedChronologyCount && (
            <span>제출 순서 미확인 {summary.excludedChronologyCount}명</span>
          )}
          {!!summary.excludedIncompleteCount && (
            <span>정오표 불완전 {summary.excludedIncompleteCount}명</span>
          )}
          {!!summary.excludedRevisionCount && (
            <span>이전·미확인 문항 버전 {summary.excludedRevisionCount}명</span>
          )}
        </div>
      )}
    </section>
  );
}
