import React from "react";
import type { CalculatorScoreRow } from "../../../../lib/studentScores";

export default function CalculatorScoreResult({
  row,
}: {
  row: CalculatorScoreRow;
}) {
  if (!row.hasData)
    return <span className="score-calculator__meta">미입력</span>;
  if (!row.band)
    return <span className="score-calculator__meta">반영 {row.total}점</span>;

  return (
    <span className="score-calculator__result">
      <span className="score-calculator__result-line">
        <span>{row.estimated ? "예상" : "등급"}</span>
        <strong className="score-calculator__grade">{row.band}</strong>
        <span className="score-calculator__result-score">
          {row.achievementScore}점
        </span>
      </span>
      {row.estimated && (
        <small className="score-calculator__subtotal">반영 {row.total}점</small>
      )}
    </span>
  );
}
