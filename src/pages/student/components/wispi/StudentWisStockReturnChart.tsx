import { lazy, Suspense } from "react";
import type { StudentWisStockReturns } from "../../../../lib/studentWisStockTypes";
import StudentWisStockReadStatus from "./StudentWisStockReadStatus";

const Chart = lazy(() => import("../../../../components/common/LazyChart"));
export const dateTime = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Seoul",
});
const shortDate = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Seoul",
});
export const percent = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
const colors = ["#2563eb", "#15803d", "#dc2626", "#92400e", "#1f2937"];
const dashes = [[], [8, 4], [2, 4], [10, 3, 2, 3], [12, 4, 4, 4]];

export default function StudentWisStockReturnChart({
  series,
  showLegend = true,
}: {
  series: { displayName: string; points: StudentWisStockReturns["points"] }[];
  showLegend?: boolean;
}) {
  const points = series.flatMap((item) => item.points);
  const values = points.flatMap((point) =>
    point.returnPercent === null ? [] : [point.returnPercent],
  );
  const start = points.reduce(
    (minimum, point) => Math.min(minimum, point.atMs),
    Infinity,
  );
  const end = points.reduce(
    (maximum, point) => Math.max(maximum, point.atMs),
    0,
  );
  const axisTicks = start === end ? [start] : [start, (start + end) / 2, end];
  if (!values.length)
    return (
      <p className="student-wispi-muted">이 기간에 수익률 기록이 없습니다.</p>
    );
  const tickFormat =
    shortDate.format(start) === shortDate.format(end)
      ? new Intl.DateTimeFormat("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
          timeZone: "Asia/Seoul",
        })
      : shortDate;
  return (
    <>
      {showLegend && (
        <ul className="student-wispi-rank-legend" aria-label="그래프 학생">
          {series.map((item, index) => (
            <li key={index}>
              <svg
                width="28"
                height="12"
                viewBox="0 0 28 12"
                aria-hidden="true"
              >
                <path
                  d="M0 6H28"
                  stroke={colors[index]}
                  strokeWidth="2"
                  strokeDasharray={dashes[index].join(" ")}
                />
              </svg>
              <span>{item.displayName}</span>
            </li>
          ))}
        </ul>
      )}
      <div
        className="student-wispi-rank-chart"
        role="img"
        aria-label={`${series.map((item) => item.displayName).join(", ")} 최근 30일 보유 수익률 추이`}
      >
        <Suspense
          fallback={<StudentWisStockReadStatus loading label="수익률 그래프" />}
        >
          <Chart
            type="line"
            data={{
              datasets: series.map((item, index) => ({
                label: item.displayName,
                data: item.points.map((point) => ({
                  x: point.atMs,
                  y: point.returnPercent,
                })),
                borderColor: colors[index],
                backgroundColor: colors[index],
                borderDash: dashes[index],
                borderWidth: 2,
                pointRadius: item.points.length > 30 ? 1 : 3,
                clip: 4,
                spanGaps: false,
              })),
            }}
            options={{
              animation: false,
              responsive: true,
              maintainAspectRatio: false,
              parsing: false,
              interaction: { intersect: false, mode: "nearest", axis: "x" },
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    title: (items: { parsed: { x: number } }[]) =>
                      items.length ? dateTime.format(items[0].parsed.x) : "",
                    label: (item: {
                      dataset: { label: string };
                      parsed: { y: number };
                    }) => `${item.dataset.label} ${percent(item.parsed.y)}`,
                  },
                },
              },
              scales: {
                x: {
                  type: "linear",
                  min: start === end ? start - 1 : start,
                  max: start === end ? end + 1 : end,
                  afterBuildTicks: (axis: { ticks: { value: number }[] }) => {
                    axis.ticks = axisTicks.map((value) => ({ value }));
                  },
                  ticks: {
                    callback: (value: number) => tickFormat.format(value),
                  },
                },
                y: {
                  beginAtZero: true,
                  ticks: {
                    maxTicksLimit: 5,
                    callback: (value: number) => percent(value),
                  },
                },
              },
            }}
          />
        </Suspense>
      </div>
    </>
  );
}
