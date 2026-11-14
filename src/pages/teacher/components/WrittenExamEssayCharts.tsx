import { useEffect, useState } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import type { WrittenExamEssayReport } from "../../../lib/writtenExamEssayAnalysis";
import "./QuizAchievementAnalysis.css";
import "./QuizAnalysisMotion.css";
import "./writtenExamEssayCharts.css";

type Bar = { key: string; label: string; value: number | null; count: number };
const number = (value: number) =>
  value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });

/** Uses full report aggregates; the student table's visible window is irrelevant. */
export default function WrittenExamEssayCharts({
  data,
  view,
}: {
  data: WrittenExamEssayReport;
  view: number;
}) {
  const [entrance, setEntrance] = useState(0);
  useEffect(() => setEntrance((value) => value + 1), [data]);
  if (view < 0 || view > 2) return null;
  const distribution = view === 0;
  const title = ["논술형 총점 분포", "논술형 문항 평균", "논술형 학급 평균"][
    view
  ];
  const unit = distribution ? "명" : "점";
  const bars: Bar[] = distribution
    ? data.totals.distribution.map((row) => ({
        key: String(row.score),
        label: `${number(row.score)}점`,
        value: row.count,
        count: row.count,
      }))
    : view === 1
      ? data.items.map((item) => ({
          key: item.key,
          label: item.label,
          value: item.summary.mean,
          count: item.summary.count,
        }))
      : data.classes.map((room) => ({
          key: room.id,
          label: room.label,
          value: room.totals.mean,
          count: room.totals.count,
        }));
  // Zero is an observed score. Null is never drawn as a zero-valued observation.
  const hasValues = bars.some((bar) => bar.value !== null);
  const maximum = Math.max(1, ...bars.map((bar) => bar.value ?? 0));
  const axisTicks =
    distribution && maximum % 2 !== 0
      ? [maximum, 0]
      : [maximum, maximum / 2, 0];
  const description = (bar: Bar) =>
    bar.value === null
      ? `${bar.label}: 입력된 점수 없음`
      : distribution
        ? `${bar.label}: ${bar.count}명`
        : `${bar.label}: 원점수 평균 ${number(bar.value)}점, 집계 ${bar.count}명`;

  return (
    <figure className="wea-chart" aria-label={title}>
      <figcaption className="wea-chart-heading">
        <h3>{title}</h3>
        <InfoHelp label={`${title} 기준`}>
          {distribution ? (
            <p>
              모든 논술형 문항의 점수를 입력한 학생만 총점 분포에 포함합니다.
              실제 0점은 포함하고 일부 입력·미입력은 제외합니다.
            </p>
          ) : (
            <p>
              {view === 1
                ? "각 문항에 입력된 점수의 원점수 평균입니다. 실제 0점은 포함하고 미입력은 제외합니다."
                : "모든 논술형 문항의 점수를 입력한 학생의 학급별 원점수 평균입니다. 실제 0점은 포함하고 일부 입력·미입력은 제외합니다."}{" "}
              원래 배점을 확인하지 못한 자료는 득점률이나 난이도로 비교하지
              않습니다.
            </p>
          )}
        </InfoHelp>
      </figcaption>
      {!hasValues ? (
        <p className="wea-chart-empty">
          {view === 0 || view === 2
            ? "모든 논술형 문항의 점수를 입력한 학생이 없습니다."
            : "집계할 입력 점수가 없습니다."}
        </p>
      ) : (
        <>
          <div className="wea-chart-unit">
            {distribution ? "인원(명)" : "원점수 평균(점)"}
          </div>
          <div className="wea-chart-frame">
            <div className="wea-chart-axis" aria-hidden="true">
              {axisTicks.map((tick) => (
                <span key={tick}>{number(tick)}</span>
              ))}
            </div>
            <div
              className="wea-chart-scroll"
              role="region"
              aria-label={`${title} 그래프`}
              tabIndex={0}
            >
              <div
                className="qaa-histogram wea-chart-plot"
                key={`${view}:${entrance}`}
                style={{ minWidth: `${Math.max(0, bars.length * 80)}px` }}
              >
                {bars.map((bar) => (
                  <div
                    className="qaa-histogram-column wea-chart-column"
                    key={bar.key}
                    role="img"
                    aria-label={description(bar)}
                    title={description(bar)}
                    tabIndex={0}
                    data-value={bar.value ?? "missing"}
                    data-count={bar.count}
                  >
                    <div className="wea-chart-track" aria-hidden="true">
                      <span
                        className="wea-chart-value"
                        style={{
                          bottom: `calc(${((bar.value ?? 0) / maximum) * 100}% + 4px)`,
                        }}
                      >
                        {bar.value === null
                          ? "미입력"
                          : `${number(bar.value)}${unit}`}
                      </span>
                      {bar.value !== null && (
                        <div
                          className="qa-chart-rise wea-chart-bar"
                          style={{ height: `${(bar.value / maximum) * 100}%` }}
                        />
                      )}
                    </div>
                    <small>{bar.label}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="wea-chart-x-unit">
            {distribution ? "총점(점)" : view === 1 ? "문항" : "학급"}
          </div>
        </>
      )}
    </figure>
  );
}
