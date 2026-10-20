import React from "react";
import type { ScoreRow } from "../../../../lib/studentScores";

const ScoreOverview: React.FC<{
  rows: ScoreRow[];
  expandedId: string | null;
  onSelect: (id: string) => void;
}> = ({ rows, expandedId, onSelect }) => (
  <section
    className="ws-surface score-calculator__overview"
    aria-label="전체 과목 점수"
  >
    <div className="score-calculator__overview-heading">
      <h2>전체 과목 점수</h2>
      <div className="score-calculator__legend">
        <span>
          <i data-type="exam" />
          정기시험
        </span>
        <span>
          <i data-type="performance" />
          수행평가
        </span>
        {rows.some((row) =>
          row.breakdown.some((item) => item.type === "other"),
        ) && (
          <span>
            <i data-type="other" />
            기타
          </span>
        )}
      </div>
    </div>
    <div className="score-calculator__chart-axis" aria-hidden="true">
      <span>0</span>
      <span>50</span>
      <span>100점</span>
    </div>
    <div className="score-calculator__chart-rows">
      {rows.map((row) => {
        const entered = row.breakdown.filter((item) => item.entered).length;
        const partial = row.hasData && entered < row.breakdown.length;
        const shades = { exam: 0, performance: 0, other: 0 };
        return (
          <button
            type="button"
            key={row.id}
            className="score-calculator__chart-row"
            data-active={row.id === expandedId}
            onClick={() => onSelect(row.id)}
            aria-label={`${row.subject} 점수 입력으로 이동`}
            aria-describedby={`score-chart-value-${row.id}`}
          >
            <span className="score-calculator__chart-subject">
              {row.subject}
            </span>
            <span
              className="score-calculator__chart-track"
              role="img"
              aria-label={row.breakdown
                .map(
                  (item) =>
                    `${item.name} ${item.entered ? `${Math.round(item.weighted)}점` : "미입력"}`,
                )
                .join(", ")}
            >
              {row.breakdown.map((item) => {
                const tint = (shades[item.type]++ % 3) * 26;
                const base =
                  item.type === "performance"
                    ? "var(--score-performance)"
                    : "var(--score-exam)";
                return (
                  <span
                    key={item.key}
                    className="score-calculator__bar-segment"
                    data-type={item.type}
                    style={{
                      width: `${Math.max(0, Math.min(100, item.weighted))}%`,
                      background: `color-mix(in srgb, ${base}, white ${tint}%)`,
                    }}
                    title={`${item.name}: ${item.entered ? `${Math.round(item.weighted)}점` : "미입력"}`}
                  />
                );
              })}
            </span>
            <span
              id={`score-chart-value-${row.id}`}
              className="score-calculator__chart-value"
              aria-live="polite"
              aria-atomic="true"
            >
              {row.hasData ? `${Math.round(row.total)}점` : "미입력"}
              {partial && <small>일부 입력</small>}
            </span>
          </button>
        );
      })}
    </div>
  </section>
);

export default ScoreOverview;
