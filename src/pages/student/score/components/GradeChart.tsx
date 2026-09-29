import React, { useState } from "react";
import { getTypeLabel, type ScoreRow } from "../../../../lib/studentScores";
import "./GradeChart.css";

const segmentColors = [
  "var(--ws-primary)",
  "var(--ws-accent)",
  "var(--ws-success)",
  "var(--ws-text-muted)",
  "var(--ws-ring)",
  "var(--ws-accent-text)",
];
const format = (value: number) => Number(value.toFixed(1)).toString();

const GradeChart: React.FC<{ rows: ScoreRow[] }> = ({ rows }) => {
  const [mode, setMode] = useState<"ratio" | "score">("ratio");
  const unit = mode === "ratio" ? "%" : "점";
  return (
    <section
      className="assessment-chart"
      aria-label="평가 반영 비율과 환산 점수"
    >
      <div className="assessment-chart__header">
        <h2>평가 반영 비율</h2>
        <div className="assessment-chart__modes" aria-label="그래프 표시 기준">
          <button
            type="button"
            aria-pressed={mode === "ratio"}
            onClick={() => setMode("ratio")}
          >
            반영 비율
          </button>
          <button
            type="button"
            aria-pressed={mode === "score"}
            onClick={() => setMode("score")}
          >
            환산 점수
          </button>
        </div>
      </div>
      <p className="assessment-chart__hint">
        {mode === "ratio"
          ? "각 평가가 최종 점수에 반영되는 비율입니다."
          : "입력한 점수에 반영 비율을 적용한 참고용 점수입니다."}
      </p>
      {rows.length === 0 ? (
        <p className="assessment-chart__hint">등록된 평가 기준이 없습니다.</p>
      ) : (
        rows.map((row) => {
          const values = row.breakdown.map((item) => {
            const value = mode === "ratio" ? item.ratio : item.weighted;
            return Number.isFinite(value)
              ? Math.max(0, Math.min(100, value))
              : 0;
          });
          const total = values.reduce((sum, value) => sum + value, 0);
          return (
            <div className="assessment-chart__row" key={row.id}>
              <div className="assessment-chart__subject">
                <h3>{row.subject}</h3>
                <strong>
                  {mode === "score" && !row.hasData
                    ? "미입력"
                    : `${format(total)}${unit}`}
                </strong>
              </div>
              <div
                className="assessment-chart__track"
                role="img"
                aria-label={`${row.subject}: ${row.breakdown.map((item, index) => `${item.name} ${mode === "score" && !item.entered ? "미입력" : `${format(values[index])}${unit}`}`).join(", ")}`}
              >
                {row.breakdown.map((item, index) => (
                  <span
                    key={item.key}
                    className="assessment-chart__segment"
                    style={{
                      width: `${values[index]}%`,
                      background: segmentColors[index % segmentColors.length],
                    }}
                    title={`${item.name}: ${format(values[index])}${unit}`}
                  />
                ))}
              </div>
              <div className="assessment-chart__axis" aria-hidden="true">
                <span>0</span>
                <span>25</span>
                <span>50</span>
                <span>75</span>
                <span>100{unit}</span>
              </div>
              <ul className="assessment-chart__legend">
                {row.breakdown.map((item, index) => (
                  <li key={item.key}>
                    <span
                      className="assessment-chart__dot"
                      style={{
                        background: segmentColors[index % segmentColors.length],
                      }}
                      aria-hidden="true"
                    />
                    <span>
                      {item.name} <small>{getTypeLabel(item.type)}</small>
                    </span>
                    <strong>
                      {mode === "score" && !item.entered
                        ? "미입력"
                        : `${format(values[index])}${unit}`}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
};
export default GradeChart;
