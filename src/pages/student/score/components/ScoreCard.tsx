import React from "react";
import NumericInput from "../../../../components/common/NumericInput";
import {
  buildScoreRows,
  getGradeBand,
  getTypeLabel,
} from "../../../../lib/studentScores";

interface ScoreItem {
  name: string;
  maxScore: number;
  ratio: number;
  type: string;
}

interface ScoreCardProps {
  disabled?: boolean;
  plan: {
    id: string;
    subject: string;
    items: ScoreItem[];
  };
  userScores: { [key: string]: string };
  onScoreChange: (planId: string, idx: number, val: string) => void;
  totalScore: number;
  hasData: boolean;
}

const formatScore = (value: number) => Number(value.toFixed(1)).toString();

const ScoreCard: React.FC<ScoreCardProps> = ({
  plan,
  disabled = false,
  userScores,
  onScoreChange,
  totalScore,
  hasData,
}) => {
  const { breakdown } = buildScoreRows([plan], userScores, {
    filterByGrade: false,
  })[0];
  const enteredCount = breakdown.filter((item) => item.entered).length;
  const complete = hasData && enteredCount === breakdown.length;
  const ratioTotal = breakdown.reduce((sum, item) => sum + item.ratio, 0);
  const validPlan =
    breakdown.length === 0 ||
    (Math.abs(ratioTotal - 100) < 0.01 &&
      breakdown.every((item) => item.maxScore > 0));

  return (
    <section
      className="ws-surface score-calculator__subject"
      aria-label={`${plan.subject} 점수 계산`}
    >
      <div className="score-calculator__subject-header">
        <div>
          <h2>{plan.subject}</h2>
          <span className="score-calculator__meta">
            {enteredCount}/{breakdown.length}개 입력
          </span>
        </div>
        <div
          className="score-calculator__total"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="score-calculator__meta">
            {complete ? "환산 총점" : "입력한 점수 합계"}
          </span>
          <div>
            <strong>
              {hasData ? `${formatScore(totalScore)}점` : "미입력"}
            </strong>
            {complete && validPlan && (
              <span className="score-calculator__grade">
                {getGradeBand(totalScore, plan.subject)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        className="score-calculator__total-track"
        role="meter"
        aria-label={`${plan.subject} 환산 점수`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.max(0, totalScore))}
        aria-valuetext={
          hasData
            ? `${formatScore(totalScore)}점, ${enteredCount}/${breakdown.length}개 입력`
            : "미입력"
        }
      >
        <span style={{ width: `${Math.min(100, Math.max(0, totalScore))}%` }} />
      </div>

      <div className="score-calculator__items">
        {breakdown.map((item, idx) => {
          const inputId = `score-input-${item.key}`;
          const rangeId = `score-range-${item.key}`;
          const metaId = `score-meta-${item.key}`;
          const canEdit = !disabled && item.maxScore > 0;
          return (
            <div className="score-calculator__item" key={item.key}>
              <div className="score-calculator__item-heading">
                <label htmlFor={inputId}>{item.name}</label>
                <output
                  htmlFor={`${inputId} ${rangeId}`}
                  className="score-calculator__weighted"
                >
                  {item.entered
                    ? `반영 ${formatScore(item.weighted)}점`
                    : "미입력"}
                </output>
              </div>
              <div id={metaId} className="score-calculator__meta">
                {getTypeLabel(item.type)} · {formatScore(item.maxScore)}점 만점
                · {formatScore(item.ratio)}% 반영
              </div>
              <div className="score-calculator__input-row">
                <input
                  id={rangeId}
                  type="range"
                  min={0}
                  max={item.maxScore || 1}
                  step={0.1}
                  value={item.score}
                  disabled={!canEdit}
                  aria-label={`${plan.subject} ${item.name} 점수 조절`}
                  aria-describedby={metaId}
                  aria-valuetext={
                    item.entered ? `${formatScore(item.score)}점` : "미입력"
                  }
                  className="score-calculator__range"
                  onChange={(event) =>
                    onScoreChange(plan.id, idx, event.target.value)
                  }
                />
                <NumericInput
                  id={inputId}
                  allowEmpty
                  min={0}
                  max={item.maxScore}
                  step={0.1}
                  inputMode="decimal"
                  disabled={!canEdit}
                  aria-label={`${plan.subject} ${item.name} 점수`}
                  aria-describedby={metaId}
                  className="score-calculator__number"
                  value={item.entered ? String(item.score) : ""}
                  placeholder="미입력"
                  onChange={(event) =>
                    onScoreChange(plan.id, idx, event.target.value)
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
      {!validPlan && (
        <p className="score-calculator__plan-warning" role="status">
          평가 반영 비율이 {formatScore(ratioTotal)}%입니다. 평가 기준을
          선생님께 확인해 주세요.
        </p>
      )}
    </section>
  );
};

export default ScoreCard;
