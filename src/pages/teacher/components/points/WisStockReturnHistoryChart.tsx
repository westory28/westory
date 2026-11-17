import { useId, useMemo, useRef, useState, useEffect } from "react";
import {
  wisStockReturnObservations,
  type WisStockReturnObservation,
} from "./wisStockInvestmentReturns";
import "./WisStockReturnHistoryChart.css";

interface ReturnSeries {
  studentKey: string;
  studentName: string;
  studentLabel: string;
  returnPercent: number | null;
  observations: readonly WisStockReturnObservation[];
}
const percent = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
const exactTime = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Seoul",
});
const axisTime = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Seoul",
});
const strokes = [undefined, "8 4", "2 4", "10 3 2 3", "12 4 4 4"];

export default function WisStockReturnHistoryChart({
  series,
  range,
  label = "보유 수익률 상위 5명",
}: {
  series: readonly ReturnSeries[];
  range?: { fromMs: number; toMs: number };
  label?: string;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const id = useId();
  const [width, setWidth] = useState(600);
  const [selected, setSelected] = useState<{
    series: number;
    point: number;
  } | null>(null);
  const lines = useMemo(
    () =>
      series.map((item) => ({
        ...item,
        points: wisStockReturnObservations(item.observations).filter(
          (point) =>
            !range || (point.atMs >= range.fromMs && point.atMs <= range.toMs),
        ),
      })),
    [series, range?.fromMs, range?.toMs],
  );
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(200, element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const membership = lines.map((line) => line.studentKey).join(":");
  useEffect(() => setSelected(null), [membership, range?.fromMs, range?.toMs]);
  const points = lines.flatMap((line) => line.points);
  const values = points.flatMap((point) =>
    point.returnPercent === null ? [] : [point.returnPercent],
  );
  const low = values.reduce((a, b) => Math.min(a, b), 0),
    high = values.reduce((a, b) => Math.max(a, b), 0);
  const rough = Math.max(0.01, (high - low || 2) / 4),
    magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    ([1, 2, 5, 10].find((value) => value * magnitude >= rough) || 10) *
    magnitude;
  const minimum = low === high ? -1 : Math.floor(low / step) * step,
    maximum = low === high ? 1 : Math.ceil(high / step) * step;
  const left = 64,
    right = width - 16,
    top = 24,
    bottom = 212,
    height = 272;
  const start =
      range?.fromMs ?? points.reduce((a, b) => Math.min(a, b.atMs), Infinity),
    end = range?.toMs ?? points.reduce((a, b) => Math.max(a, b.atMs), 0);
  const x = (atMs: number) =>
    left +
    (end > start ? (atMs - start) / (end - start) : 0.5) * (right - left);
  const y = (value: number) =>
    bottom - ((value - minimum) / (maximum - minimum)) * (bottom - top);
  const ticks = Array.from(
    { length: 5 },
    (_, index) => minimum + ((maximum - minimum) * index) / 4,
  );
  const timeTicks = points.length
    ? end === start
      ? [start]
      : [start, ...(width >= 600 ? [(start + end) / 2] : []), end]
    : [];
  const activeLine = selected ? lines[selected.series] : undefined;
  const active = selected ? activeLine?.points[selected.point] : undefined;
  const latest = (seriesIndex = 0) => {
    const available = lines
      .map((line, index) => ({ line, index }))
      .filter((item) => item.line.points.length);
    const item =
      available.find((item) => item.index >= seriesIndex) || available[0];
    return item
      ? { series: item.index, point: item.line.points.length - 1 }
      : null;
  };
  const inspect = (clientX: number, clientY: number) => {
    if (!canvas.current) return;
    const bounds = canvas.current.getBoundingClientRect();
    let closest = Infinity,
      target: typeof selected = null;
    lines.forEach((line, seriesIndex) =>
      line.points.forEach((point, pointIndex) => {
        const distance = Math.hypot(
          x(point.atMs) - (clientX - bounds.left),
          (point.returnPercent === null ? bottom : y(point.returnPercent)) -
            (clientY - bounds.top),
        );
        if (distance < closest) {
          closest = distance;
          target = { series: seriesIndex, point: pointIndex };
        }
      }),
    );
    setSelected(target);
  };
  return (
    <div className="wis-return-history">
      <ol
        className="wis-return-history__legend"
        aria-label="차트에 표시된 학생"
      >
        {lines.map((line, index) => (
          <li key={line.studentKey} data-series={index}>
            <svg width="32" height="16" viewBox="0 0 32 16" aria-hidden="true">
              <line
                x1="1"
                x2="31"
                y1="8"
                y2="8"
                strokeDasharray={strokes[index]}
              />
            </svg>
            <div>
              <strong>
                {lines.length > 1 ? `${index + 1}. ` : ""}
                {line.studentName}
              </strong>
              <small>
                {line.studentLabel}
                {!line.points.length
                  ? " · 기록 없음"
                  : line.points.every((point) => point.returnPercent === null)
                    ? " · 수익률 기록 없음"
                    : ""}
              </small>
            </div>
            <span
              className={
                (line.returnPercent ?? 0) > 0
                  ? "is-up"
                  : (line.returnPercent ?? 0) < 0
                    ? "is-down"
                    : "is-flat"
              }
            >
              {line.returnPercent === null
                ? "미보유"
                : percent(line.returnPercent)}
            </span>
          </li>
        ))}
      </ol>
      <div
        ref={canvas}
        className="wis-return-history__canvas"
        role="group"
        tabIndex={points.length ? 0 : -1}
        aria-label={`${label} 시기별 차트`}
        aria-describedby={`${id}-help${active ? ` ${id}-value` : ""}`}
        onFocus={() => setSelected(latest())}
        onBlur={() => setSelected(null)}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse")
            inspect(event.clientX, event.clientY);
        }}
        onPointerDown={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          inspect(event.clientX, event.clientY);
        }}
        onPointerLeave={(event) => {
          if (
            event.pointerType === "mouse" &&
            document.activeElement !== canvas.current
          )
            setSelected(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") return setSelected(null);
          if (
            !points.length ||
            ![
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
            ].includes(event.key)
          )
            return;
          event.preventDefault();
          const current = selected || latest();
          if (!current) return;
          if (["ArrowUp", "ArrowDown"].includes(event.key)) {
            const choices = lines
              .map((line, index) => (line.points.length ? index : -1))
              .filter((index) => index >= 0);
            const next =
              choices[
                (choices.indexOf(current.series) +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  choices.length) %
                  choices.length
              ];
            const atMs = lines[current.series]?.points[current.point]?.atMs;
            let point = 0;
            lines[next].points.forEach((item, index) => {
              if (
                Math.abs(item.atMs - atMs) <
                Math.abs(lines[next].points[point].atMs - atMs)
              )
                point = index;
            });
            setSelected({ series: next, point });
          } else
            setSelected({
              series: current.series,
              point:
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? lines[current.series].points.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          lines[current.series].points.length - 1,
                          current.point + (event.key === "ArrowLeft" ? -1 : 1),
                        ),
                      ),
            });
        }}
      >
        <p id={`${id}-help`} className="sr-only">
          좌우 방향키로 시각을, 위아래 방향키로 학생을 바꿉니다. Home은 첫 기록,
          End는 마지막 기록, Escape는 닫기입니다. 기록이 없는 구간은 선을
          연결하지 않습니다.
        </p>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${lines.length}명 시기별 보유 수익률, ${points.length}개 실제 기록`}
        >
          <g className="wis-return-history__axes">
            {ticks.map((value, index) => (
              <g key={index}>
                <line x1={left} x2={right} y1={y(value)} y2={y(value)} />
                <text x={left - 8} y={y(value)} dy=".35em" textAnchor="end">
                  {Math.abs(value) >= 10000
                    ? `${new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value)}%`
                    : percent(value)}
                </text>
              </g>
            ))}
            <line
              className="wis-return-history__zero"
              x1={left}
              x2={right}
              y1={y(0)}
              y2={y(0)}
            />
            {timeTicks.map((atMs, index) => (
              <text
                key={atMs}
                x={x(atMs)}
                y={bottom + 24}
                textAnchor={
                  timeTicks.length === 1
                    ? "middle"
                    : index === 0
                      ? "start"
                      : index === timeTicks.length - 1
                        ? "end"
                        : "middle"
                }
              >
                {axisTime.format(atMs)}
              </text>
            ))}
            <text x={right} y={height - 8} textAnchor="end">
              한국 시간
            </text>
          </g>
          {lines.map((line, index) => {
            const segments: (typeof line.points)[] = [];
            let segment: typeof line.points = [];
            for (const point of line.points) {
              if (point.returnPercent === null) {
                if (segment.length) segments.push(segment);
                segment = [];
              } else segment.push(point);
            }
            if (segment.length) segments.push(segment);
            return (
              <g
                key={line.studentKey}
                className="wis-return-history__plot"
                data-series={index}
                data-student-key={line.studentKey}
              >
                {segments.map((segment, part) => (
                  <g key={part}>
                    {segment.length > 1 && (
                      <polyline
                        fill="none"
                        strokeDasharray={strokes[index]}
                        points={segment
                          .map(
                            (point) =>
                              `${x(point.atMs)},${y(point.returnPercent!)}`,
                          )
                          .join(" ")}
                      />
                    )}
                    {segment.map((point) => (
                      <circle
                        key={point.atMs}
                        cx={x(point.atMs)}
                        cy={y(point.returnPercent!)}
                        r="3"
                      />
                    ))}
                  </g>
                ))}
              </g>
            );
          })}
          {active && (
            <g className="wis-return-history__selection">
              <line
                x1={x(active.atMs)}
                x2={x(active.atMs)}
                y1={top}
                y2={bottom}
              />
              {active.returnPercent !== null && (
                <circle
                  cx={x(active.atMs)}
                  cy={y(active.returnPercent)}
                  r="5"
                />
              )}
            </g>
          )}
        </svg>
        {active && (
          <div
            id={`${id}-value`}
            className="wis-return-history__tooltip"
            role="tooltip"
            aria-live="polite"
            data-at-ms={active.atMs}
            data-return={active.returnPercent ?? "none"}
            style={{
              left: Math.max(8, Math.min(width - 208, x(active.atMs) - 96)),
            }}
          >
            <b>{activeLine?.studentName}</b>
            <time dateTime={new Date(active.atMs).toISOString()}>
              {exactTime.format(active.atMs)}
            </time>
            <strong>
              {active.holdingValue === null
                ? "시세 기록 없음"
                : active.returnPercent === null
                  ? "보유 주식 없음"
                  : percent(active.returnPercent)}
            </strong>
          </div>
        )}
      </div>
      {!points.length && (
        <p className="wis-return-history__notice">
          {range
            ? "선택한 기간에 수익률 기록이 없습니다."
            : "아직 수익률 기록이 없습니다."}
        </p>
      )}
      {!!points.length && !values.length && (
        <p className="wis-return-history__notice">
          확인할 수 있는 보유 수익률 기록이 없습니다.
        </p>
      )}
    </div>
  );
}
