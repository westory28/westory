import { useId, useMemo, useRef, useState, useEffect } from "react";
import {
  wisStockReturnObservations,
  type WisStockReturnObservation,
} from "./wisStockInvestmentReturns";
import "./WisStockReturnHistoryChart.css";

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

export default function WisStockReturnHistoryChart({
  observations,
  studentName,
}: {
  observations: readonly WisStockReturnObservation[];
  studentName: string;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const id = useId();
  const [width, setWidth] = useState(600);
  const [selected, setSelected] = useState<number | null>(null);
  const points = useMemo(
    () => wisStockReturnObservations(observations),
    [observations],
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
  useEffect(() => setSelected(null), [observations, studentName]);
  const values = points.flatMap((point) =>
    point.returnPercent === null ? [] : [point.returnPercent],
  );
  const low = values.reduce((minimum, value) => Math.min(minimum, value), 0);
  const high = values.reduce((maximum, value) => Math.max(maximum, value), 0);
  const rough = Math.max(0.01, (high - low || 2) / 4);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    ([1, 2, 5, 10].find((value) => value * magnitude >= rough) || 10) *
    magnitude;
  const minimum = low === high ? -1 : Math.floor(low / step) * step;
  const maximum = low === high ? 1 : Math.ceil(high / step) * step;
  const left = 64,
    right = width - 16,
    top = 24,
    bottom = 212,
    height = 272;
  const start = points[0]?.atMs || 0;
  const end = points.at(-1)?.atMs || start;
  const x = (atMs: number) =>
    left +
    (end > start ? (atMs - start) / (end - start) : 0.5) * (right - left);
  const y = (value: number) =>
    bottom - ((value - minimum) / (maximum - minimum)) * (bottom - top);
  const segments: { atMs: number; returnPercent: number }[][] = [];
  let segment: { atMs: number; returnPercent: number }[] = [];
  for (const point of points) {
    if (point.returnPercent === null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else
      segment.push({ atMs: point.atMs, returnPercent: point.returnPercent });
  }
  if (segment.length) segments.push(segment);
  const ticks = Array.from(
    { length: 5 },
    (_, index) => minimum + ((maximum - minimum) * index) / 4,
  );
  const timeTicks = points.length
    ? end === start
      ? [start]
      : [start, ...(width >= 600 ? [(start + end) / 2] : []), end]
    : [];
  const active = selected === null ? null : points[selected];
  const inspect = (clientX: number) => {
    if (!canvas.current || !points.length) return;
    const local = clientX - canvas.current.getBoundingClientRect().left;
    let closest = 0;
    points.forEach((point, index) => {
      if (
        Math.abs(x(point.atMs) - local) <
        Math.abs(x(points[closest].atMs) - local)
      )
        closest = index;
    });
    setSelected(closest);
  };
  const latest = points.at(-1)?.returnPercent;
  return (
    <div className="wis-return-history">
      <div
        ref={canvas}
        className="wis-return-history__canvas"
        role="group"
        tabIndex={points.length ? 0 : -1}
        aria-label={`${studentName} 보유 수익률 변화 차트`}
        aria-describedby={`${id}-help${active ? ` ${id}-value` : ""}`}
        onFocus={() => setSelected(points.length ? points.length - 1 : null)}
        onBlur={() => setSelected(null)}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse") inspect(event.clientX);
        }}
        onPointerDown={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          inspect(event.clientX);
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
            !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
          )
            return;
          event.preventDefault();
          setSelected(
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? points.length - 1
                : Math.max(
                    0,
                    Math.min(
                      points.length - 1,
                      (selected ?? points.length - 1) +
                        (event.key === "ArrowLeft" ? -1 : 1),
                    ),
                  ),
          );
        }}
      >
        <p id={`${id}-help`} className="sr-only">
          좌우 방향키나 차트의 기록을 눌러 시각과 수익률을 확인합니다. Home은 첫
          기록, End는 마지막 기록, Escape는 닫기입니다.
        </p>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${studentName}, 수익률 기록 ${points.length}건${latest == null ? "" : `, 최근 ${percent(latest)}`}`}
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
          <g className="wis-return-history__plot">
            {segments.map((values, index) => (
              <g key={index}>
                {values.length > 1 && (
                  <polyline
                    fill="none"
                    points={values
                      .map(
                        (point) => `${x(point.atMs)},${y(point.returnPercent)}`,
                      )
                      .join(" ")}
                  />
                )}
                {values.map((point) => (
                  <circle
                    key={point.atMs}
                    cx={x(point.atMs)}
                    cy={y(point.returnPercent)}
                    r="3"
                  />
                ))}
              </g>
            ))}
          </g>
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
              left: Math.max(8, Math.min(width - 200, x(active.atMs) - 96)),
            }}
          >
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
      {!values.length && points.length > 0 && (
        <p className="wis-return-history__notice">
          {points.some((point) => point.holdingValue === null)
            ? "확인할 수 있는 시세 기록이 없습니다."
            : "보유 주식이 없어 수익률을 표시하지 않습니다."}
        </p>
      )}
      {values.length === 1 && (
        <p className="wis-return-history__notice">
          첫 기록입니다. 다음 기록부터 변화가 선으로 이어집니다.
        </p>
      )}
    </div>
  );
}
