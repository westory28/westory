import React from "react";
import {
  buildScoreRows,
  getGradeBand,
  getTypeLabel,
} from "../../../../lib/studentScores";

interface ScoreCardProps {
  disabled?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  plan: {
    id: string;
    subject: string;
    items: { name: string; maxScore: number; ratio: number; type: string }[];
  };
  userScores: { [key: string]: string };
  onScoreChange: (planId: string, idx: number, val: string) => void;
  totalScore: number;
  hasData: boolean;
}

const formatScore = (value: number) => Math.round(value).toString();

const ScoreCard: React.FC<ScoreCardProps> = ({
  plan,
  disabled = false,
  expanded = true,
  onToggle,
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
  const panelId = `score-panel-${plan.id}`;
  const toggleId = `score-toggle-${plan.id}`;

  return (
    <section
      className="score-calculator__subject"
      aria-label={`${plan.subject} 점수 계산`}
    >
      <h2 className="score-calculator__subject-heading">
        <button
          id={toggleId}
          type="button"
          className="score-calculator__subject-toggle"
          aria-label={`${plan.subject} 점수 입력`}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className="score-calculator__subject-name">{plan.subject}</span>
          <span className="score-calculator__meta">
            {enteredCount}/{breakdown.length}개
          </span>
          <span
            className="score-calculator__total"
            aria-label={complete ? "환산 총점" : "입력한 점수 합계"}
          >
            <strong>
              {hasData ? `${formatScore(totalScore)}점` : "미입력"}
            </strong>
            {complete && validPlan && (
              <span className="score-calculator__grade">
                {getGradeBand(totalScore, plan.subject)}
              </span>
            )}
          </span>
          <svg
            className="score-calculator__chevron"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path
              d="m4 6 4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
      </h2>
      <div id={panelId} hidden={!expanded} aria-labelledby={toggleId}>
        <div className="score-calculator__items">
          {breakdown.map((item, idx) => {
            const inputId = `score-input-${item.key}`;
            const rangeId = `score-range-${item.key}`;
            const metaId = `score-meta-${item.key}`;
            const maxScore = Math.floor(item.maxScore);
            const canEdit = !disabled && maxScore > 0;
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
                  {getTypeLabel(item.type)} · {formatScore(item.maxScore)}점
                  만점 · {item.ratio}% 반영
                </div>
                <div className="score-calculator__input-row">
                  <input
                    id={rangeId}
                    type="range"
                    min={0}
                    max={maxScore || 1}
                    step={1}
                    value={Math.min(maxScore, Math.round(item.score))}
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
                  <input
                    id={inputId}
                    type="number"
                    min={0}
                    max={maxScore}
                    step={1}
                    inputMode="numeric"
                    disabled={!canEdit}
                    aria-label={`${plan.subject} ${item.name} 점수`}
                    aria-describedby={metaId}
                    className="score-calculator__number"
                    value={item.entered ? formatScore(item.score) : ""}
                    placeholder="미입력"
                    onChange={(event) =>
                      onScoreChange(plan.id, idx, event.target.value)
                    }
                  />
                </div>
              </div>
            );
          })}
          {!validPlan && (
            <p className="score-calculator__plan-warning" role="status">
              평가 반영 비율이 {ratioTotal}%입니다. 평가 기준을 선생님께 확인해
              주세요.
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

export default ScoreCard;
