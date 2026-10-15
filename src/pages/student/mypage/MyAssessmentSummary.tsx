import { useMemo, useState } from "react";
import {
  buildAssessmentScoreDistribution,
  formatRecordedScore,
} from "./assessmentRecords";
import "./MyAssessmentSummary.css";

export interface MyAssessmentSummaryAttempt {
  key: string;
  roundLabel: string;
  categoryLabel: string;
  score: number | null;
  wrongCount: number;
  dateText: string;
  allItems: readonly { correctKnown: boolean }[];
}

interface Props {
  attempts: readonly MyAssessmentSummaryAttempt[];
  loading: boolean;
  error: string;
  onOpen: (id: string) => void;
  onRetry: () => void;
  onStart: () => void;
}

export default function MyAssessmentSummary({
  attempts,
  loading,
  error,
  onOpen,
  onRetry,
  onStart,
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const scores = useMemo(
    () =>
      attempts.flatMap((attempt) =>
        attempt.score === null ? [] : [attempt.score],
      ),
    [attempts],
  );
  const bands = useMemo(
    () => buildAssessmentScoreDistribution(scores),
    [scores],
  );
  const average = scores.length
    ? Math.round(
        (scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10,
      ) / 10
    : null;
  const maxCount = Math.max(1, ...bands.map((band) => band.count));
  const shown = showAll ? attempts : attempts.slice(0, 5);

  return (
    <section
      className="my-assessment-summary"
      aria-labelledby="my-assessment-heading"
    >
      <header className="my-assessment-summary__header">
        <h3 id="my-assessment-heading">이번 학기 평가</h3>
        <button type="button" onClick={onStart}>
          평가 풀기
        </button>
      </header>
      {loading ? (
        <p role="status" className="my-assessment-summary__empty">
          응시 기록을 불러오는 중입니다.
        </p>
      ) : error ? (
        <div role="alert" className="my-assessment-summary__empty">
          <p>{error}</p>
          <button type="button" onClick={onRetry}>
            다시 불러오기
          </button>
        </div>
      ) : !attempts.length ? (
        <p className="my-assessment-summary__empty">
          아직 응시 기록이 없습니다.
        </p>
      ) : (
        <>
          <dl className="my-assessment-summary__metrics">
            <div>
              <dt>응시</dt>
              <dd>
                {attempts.length}
                <small>회</small>
              </dd>
            </div>
            <div>
              <dt>최근 점수</dt>
              <dd>{formatRecordedScore(attempts[0].score)}</dd>
            </div>
            <div>
              <dt>평균 점수</dt>
              <dd>{formatRecordedScore(average)}</dd>
            </div>
          </dl>
          <div className="my-assessment-summary__distribution">
            <h4>
              점수 분포 <small>{scores.length}회</small>
            </h4>
            {scores.length ? (
              <ul aria-label="이번 학기 전체 응시 점수 분포">
                {bands.map((band) => (
                  <li key={band.label}>
                    <span>{band.label}</span>
                    <span
                      className="my-assessment-summary__bar"
                      aria-hidden="true"
                    >
                      <span
                        style={{ width: `${(band.count / maxCount) * 100}%` }}
                      />
                    </span>
                    <strong>{band.count}회</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p>저장된 점수가 없습니다.</p>
            )}
            {attempts.length > scores.length && (
              <p className="my-assessment-summary__note">
                점수 없는 {attempts.length - scores.length}회는 평균과 분포에서
                제외했습니다.
              </p>
            )}
          </div>
          <div className="my-assessment-summary__records">
            <h4>응시 기록</h4>
            <ul>
              {shown.map((attempt) => {
                const graded = attempt.allItems.filter(
                  (item) => item.correctKnown,
                ).length;
                return (
                  <li key={attempt.key}>
                    <button
                      type="button"
                      onClick={() => onOpen(attempt.key)}
                      aria-label={`${attempt.roundLabel}, ${attempt.dateText}, ${formatRecordedScore(attempt.score)}, 답안 확인`}
                    >
                      <span className="my-assessment-summary__record-main">
                        <strong title={attempt.roundLabel}>
                          {attempt.roundLabel}
                        </strong>
                        <span>
                          {attempt.categoryLabel} · {attempt.dateText}
                        </span>
                        <span>
                          {graded
                            ? `오답 ${attempt.wrongCount} / 채점 기록 ${graded}문항`
                            : "문항별 채점 기록 없음"}
                        </span>
                      </span>
                      <span className="my-assessment-summary__record-score">
                        <strong>{formatRecordedScore(attempt.score)}</strong>
                        <span>답안 확인 ›</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {attempts.length > 5 && (
              <button
                type="button"
                className="my-assessment-summary__more"
                onClick={() => setShowAll((value) => !value)}
                aria-expanded={showAll}
              >
                {showAll ? "최근 5회만 보기" : `전체 ${attempts.length}회 보기`}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
