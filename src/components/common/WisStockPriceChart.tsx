import { useEffect, useId, useMemo, useRef, useState } from "react";
import { animate, createScope } from "animejs";
import InfoHelp from "./InfoHelp";
import {
  buildWisStockCandles,
  WIS_STOCK_CANDLE_INTERVALS,
  type WisStockCandleInterval,
} from "../../lib/wisStockCandles";
export interface WisStockPriceSeries {
  id: string;
  settings: { name: string };
  price: number;
  updatedAtMs: number;
  history: { atMs: number; price: number }[];
}
import "./wisStockPriceChart.css";
const DAY = 86_400_000;
const money = (value: number) => value.toLocaleString("ko-KR");
// Keep observed times and prices. Invalid or repeated observations must never
// create NaN coordinates, fabricated prices, or an equal-spacing time axis.
export function stockObservations(
  stock: Pick<WisStockPriceSeries, "history">,
  fractional = false,
) {
  const points = new Map<number, number>();
  for (const point of Array.isArray(stock.history) ? stock.history : [])
    if (
      point &&
      Number.isSafeInteger(point.atMs) &&
      point.atMs >= 0 &&
      point.atMs <= 8_640_000_000_000_000 &&
      (fractional
        ? Number.isFinite(point.price) && point.price <= Number.MAX_SAFE_INTEGER
        : Number.isSafeInteger(point.price)) &&
      point.price > 0
    )
      points.set(point.atMs, point.price);
  return [...points]
    .sort((a, b) => a[0] - b[0])
    .map(([atMs, price]) => ({ atMs, price }));
}
const shortDate = new Intl.DateTimeFormat("ko-KR", {
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Seoul",
});
const shortTime = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Seoul",
});
const exactDate = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Seoul",
});
const axisPrice = (value: number) =>
  value > 1_000_000
    ? new Intl.NumberFormat("ko-KR", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value)
    : money(value);
function priceAxis(low: number, high: number, minimumStep = 1) {
  const pad = high === low ? Math.max(1, Math.round(high * 0.05)) : 0;
  const minimum = Math.max(0, low - pad),
    maximum = Math.min(Number.MAX_SAFE_INTEGER, high + pad);
  const rough = Math.max(minimumStep, (maximum - minimum) / 4);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    ([1, 2, 5, 10].find((value) => value * magnitude >= rough) || 10) *
    magnitude;
  const start = Math.max(0, Math.floor(minimum / step) * step);
  const end = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(start + 1, Math.ceil(maximum / step) * step),
  );
  const ticks: number[] = [];
  for (let i = 0; i < 8 && start + i * step <= end; i++)
    ticks.push(start + i * step);
  if (ticks.at(-1) !== end) ticks.push(end);
  return { start, end, ticks };
}
export default function WisStockPriceChart({
  stock,
  days,
  kind = "price",
  variant = "line",
}: {
  stock: WisStockPriceSeries;
  days: number;
  kind?: "price" | "index";
  variant?: "line" | "candlestick";
}) {
  const candlestick = variant === "candlestick";
  const [interval, setInterval] = useState<WisStockCandleInterval>("day");
  const label = kind === "index" ? "지수" : "가격";
  const unit = kind === "index" ? "pt" : "위스";
  const formatValue = (value: number) =>
    kind === "index"
      ? value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })
      : money(value);
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  const [width, setWidth] = useState(600);
  const [selection, setSelection] = useState<{
    key: string;
    index: number;
  } | null>(null);
  const observations = useMemo(
    () => stockObservations(stock, kind === "index"),
    [stock, kind],
  );
  const visible = useMemo(() => {
    const end = observations.at(-1)?.atMs || 0;
    return observations.filter((point) => point.atMs >= end - days * DAY);
  }, [observations, days]);
  const candles = useMemo(
    () => (candlestick ? buildWisStockCandles(visible, interval) : []),
    [visible, candlestick, interval],
  );
  const key = JSON.stringify([stock.id, days, variant, interval, visible]);
  const prices = visible.map((point) => point.price);
  const low = prices.length
    ? Math.min(...prices)
    : Number.isSafeInteger(stock.price) && stock.price >= 0
      ? stock.price
      : 0;
  const high = prices.length ? Math.max(...prices) : low;
  const domain = priceAxis(low, high, kind === "index" ? 0.01 : 1);
  const start = candlestick
      ? candles[0]?.startAtMs || 0
      : visible[0]?.atMs || 0,
    end = candlestick
      ? candles.at(-1)?.endAtMs || start
      : visible.at(-1)?.atMs || start;
  const span = end - start;
  const height = 304,
    left = 76,
    right = Math.max(left + 1, width - 16),
    top = 40,
    bottom = 238;
  const plotWidth = right - left,
    plotHeight = bottom - top;
  const x = (atMs: number) =>
    left + (span > 0 ? (atMs - start) / span : 0.5) * plotWidth;
  const y = (price: number) =>
    bottom -
    ((price - domain.start) / (domain.end - domain.start)) * plotHeight;
  const displayPoints = candlestick
    ? candles.map((candle) => ({
        atMs: candle.startAtMs + (candle.endAtMs - candle.startAtMs) / 2,
        price: candle.close,
        candle,
      }))
    : visible.map((point) => ({ ...point, candle: undefined }));
  const points = displayPoints.map((point) => ({
    ...point,
    x: x(point.atMs),
    y: y(point.price),
  }));
  const candleWidth = Math.max(
    1,
    Math.min(
      20,
      ((WIS_STOCK_CANDLE_INTERVALS.find((item) => item.key === interval)!
        .duration *
        plotWidth) /
        Math.max(1, span)) *
        0.65,
    ),
  );
  const tickCount = width < 500 ? 3 : 5;
  const timeTicks = !visible.length
    ? []
    : span === 0
      ? [start]
      : Array.from({ length: tickCount }, (_, i) =>
          Math.round(start + (span * i) / (tickCount - 1)),
        );
  const active = selection?.key === key ? points[selection.index] : null;
  const tooltipWidth = Math.max(120, Math.min(244, width - 24));
  const select = (index: number) =>
    setSelection((current) =>
      current?.key === key && current.index === index
        ? current
        : { key, index },
    );
  const inspect = (clientX: number) => {
    if (!points.length || !canvas.current) return;
    const localX = clientX - canvas.current.getBoundingClientRect().left;
    let nearest = 0;
    for (let index = 1; index < points.length; index++)
      if (
        Math.abs(points[index].x - localX) <
        Math.abs(points[nearest].x - localX)
      )
        nearest = index;
    select(nearest);
  };
  useEffect(() => {
    if (!canvas.current) return;
    const measure = () =>
      setWidth(Math.max(200, canvas.current?.clientWidth || 600));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const scope = createScope({
      root,
      mediaQueries: { reduceMotion: "(prefers-reduced-motion: reduce)" },
    }).add((context) => {
      if (!context || context.matches.reduceMotion) return;
      const line = root.current?.querySelector<SVGPolylineElement>(
        ".wis-stock-chart__plot polyline",
      );
      if (line && line.getTotalLength() > 0) {
        const length = line.getTotalLength();
        animate(line, {
          strokeDasharray: [length, length],
          strokeDashoffset: [length, 0],
          duration: 280,
          ease: "out(3)",
        });
      }
      animate(".wis-stock-chart__plot", {
        opacity: [0.4, 1],
        duration: 220,
        ease: "out(3)",
      });
    });
    return () => scope.revert();
  }, [stock.id, stock.updatedAtMs, days, width, variant, interval]);
  return (
    <div
      ref={root}
      className={`wispi-price-chart-shell${candlestick ? " is-candlestick" : ""}`}
    >
      {candlestick && (
        <div className="wispi-price-chart__controls">
          <div className="ws-page-tabs" role="group" aria-label="봉차트 단위">
            {WIS_STOCK_CANDLE_INTERVALS.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={interval === item.key}
                onClick={() => setInterval(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <InfoHelp label="봉차트 표시 기준">
            <p>
              한국 시각 기준으로 기록된 관측값을 묶습니다. 각 봉의 시가·종가는
              첫·마지막 관측값이며 고가·저가는 해당 구간의 최고·최저
              관측값입니다. 선택한 조회 기간 안의 기록만 사용하며 기록이 없는
              구간은 표시하지 않습니다. 주봉은 월요일에 시작합니다.
            </p>
          </InfoHelp>
        </div>
      )}
      <div className="wis-stock-chart wispi-price-chart">
        <p id={`${id}-help`} className="wispi-price-chart__instructions">
          차트에 마우스를 올리거나 터치하면 기록된 값을 확인합니다. 키보드 좌우
          방향키로 기록을 이동하고 Home과 End로 처음과 마지막 기록을 확인합니다.
          Escape로 말풍선을 닫습니다.
        </p>
        <div
          ref={canvas}
          className="wispi-price-chart__canvas"
          tabIndex={visible.length ? 0 : -1}
          role="group"
          aria-label={`${stock.settings.name} ${label} ${candlestick ? "봉차트" : "차트"}`}
          aria-describedby={`${id}-help${active ? ` ${id}-value` : ""}`}
          onFocus={() => {
            if (points.length) select(points.length - 1);
          }}
          onBlur={() => setSelection(null)}
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
              setSelection(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setSelection(null);
              return;
            }
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
            const index =
              selection?.key === key ? selection.index : points.length - 1;
            select(
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? points.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        points.length - 1,
                        index +
                          (["ArrowLeft", "ArrowDown"].includes(event.key)
                            ? -1
                            : 1),
                      ),
                    ),
            );
          }}
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            role="img"
            aria-label={`${stock.settings.name} ${label} 변동, 기록 ${visible.length}건${candlestick ? `, ${candles.length}개 봉` : ""}${visible.length ? `, 최고 ${formatValue(high)} ${unit}, 최저 ${formatValue(low)} ${unit}` : ""}`}
          >
            <defs>
              <pattern
                id={`${id}-minor`}
                x={left}
                y={top}
                width="20"
                height="20"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 20 0 L 0 0 0 20"
                  className="wispi-price-chart__minor"
                  fill="none"
                />
              </pattern>
              <pattern
                id={`${id}-major`}
                x={left}
                y={top}
                width="100"
                height="100"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 100 0 L 0 0 0 100"
                  className="wispi-price-chart__major"
                  fill="none"
                />
              </pattern>
              <clipPath id={`${id}-clip`}>
                <rect
                  x={left - 4}
                  y={top - 4}
                  width={plotWidth + 8}
                  height={plotHeight + 8}
                />
              </clipPath>
            </defs>
            <rect
              x={left}
              y={top}
              width={plotWidth}
              height={plotHeight}
              fill={`url(#${id}-minor)`}
            />
            <rect
              x={left}
              y={top}
              width={plotWidth}
              height={plotHeight}
              fill={`url(#${id}-major)`}
              className="wispi-price-chart__paper"
            />
            <g className="wispi-price-chart__axes">
              <text x="12" y="22" className="wispi-price-chart__caption">
                {label} ({unit})
              </text>
              <line x1={left} y1={top} x2={left} y2={bottom} />
              <line x1={left} y1={bottom} x2={right} y2={bottom} />
              {domain.ticks.map((price) => (
                <g key={price}>
                  <line x1={left - 4} y1={y(price)} x2={left} y2={y(price)} />
                  <text x={left - 9} y={y(price)} dy=".35em" textAnchor="end">
                    {kind === "index" ? formatValue(price) : axisPrice(price)}
                  </text>
                </g>
              ))}
              {timeTicks.map((atMs, index) => (
                <g key={`${atMs}-${index}`}>
                  <line x1={x(atMs)} y1={bottom} x2={x(atMs)} y2={bottom + 5} />
                  <text
                    x={x(atMs)}
                    y={bottom + 20}
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
                    <tspan x={x(atMs)}>{shortDate.format(atMs)}</tspan>
                    <tspan x={x(atMs)} dy="14">
                      {shortTime.format(atMs)}
                    </tspan>
                  </text>
                </g>
              ))}
              <text
                x={right}
                y={height - 8}
                textAnchor="end"
                className="wispi-price-chart__caption"
              >
                날짜·시간 (한국)
              </text>
            </g>
            <g className="wis-stock-chart__plot" clipPath={`url(#${id}-clip)`}>
              {candlestick ? (
                points.map((point) => {
                  const candle = point.candle!;
                  const direction =
                    candle.close > candle.open
                      ? "up"
                      : candle.close < candle.open
                        ? "down"
                        : "flat";
                  return (
                    <g
                      key={candle.startAtMs}
                      className={`wispi-price-chart__candle is-${direction}`}
                      data-start-at-ms={candle.startAtMs}
                      data-open={candle.open}
                      data-high={candle.high}
                      data-low={candle.low}
                      data-close={candle.close}
                    >
                      <line
                        x1={point.x}
                        x2={point.x}
                        y1={y(candle.high)}
                        y2={y(candle.low)}
                      />
                      {candle.open === candle.close ? (
                        <line
                          x1={point.x - candleWidth / 2}
                          x2={point.x + candleWidth / 2}
                          y1={y(candle.open)}
                          y2={y(candle.close)}
                        />
                      ) : (
                        <rect
                          x={point.x - candleWidth / 2}
                          y={Math.min(y(candle.open), y(candle.close))}
                          width={candleWidth}
                          height={Math.max(
                            1,
                            Math.abs(y(candle.open) - y(candle.close)),
                          )}
                        />
                      )}
                    </g>
                  );
                })
              ) : (
                <polyline
                  points={points
                    .map((point) => `${point.x},${point.y}`)
                    .join(" ")}
                  fill="none"
                />
              )}
              {!candlestick && points.length > 0 && (
                <circle cx={points.at(-1)!.x} cy={points.at(-1)!.y} r="3.5" />
              )}
            </g>
            {active && (
              <g className="wispi-price-chart__selection">
                <line x1={active.x} y1={top} x2={active.x} y2={bottom} />
                <circle cx={active.x} cy={active.y} r="5" />
              </g>
            )}
          </svg>
          {!visible.length && (
            <p className="wispi-price-chart__empty">
              아직 {label} 기록이 없습니다.
            </p>
          )}
          {active && (
            <div
              id={`${id}-value`}
              role="tooltip"
              aria-live="polite"
              className="wispi-price-chart__tooltip"
              data-at-ms={active.candle?.firstAtMs ?? active.atMs}
              data-price={active.price}
              style={{
                width: tooltipWidth,
                left: Math.max(
                  12,
                  Math.min(
                    width - tooltipWidth - 12,
                    active.x - tooltipWidth / 2,
                  ),
                ),
                top: candlestick
                  ? 48
                  : Math.max(
                      36,
                      Math.min(
                        height - 100,
                        active.y >= 136 ? active.y - 88 : active.y + 20,
                      ),
                    ),
              }}
            >
              <time
                dateTime={new Date(
                  active.candle?.firstAtMs ?? active.atMs,
                ).toISOString()}
              >
                {exactDate.format(active.candle?.firstAtMs ?? active.atMs)}
                {(active.candle?.firstAtMs ?? active.atMs) % 1000
                  ? `.${String((active.candle?.firstAtMs ?? active.atMs) % 1000).padStart(3, "0")}`
                  : ""}
              </time>
              {active.candle ? (
                <>
                  <time
                    dateTime={new Date(active.candle.lastAtMs).toISOString()}
                  >
                    ~ {exactDate.format(active.candle.lastAtMs)}
                    {active.candle.lastAtMs % 1000
                      ? `.${String(active.candle.lastAtMs % 1000).padStart(3, "0")}`
                      : ""}
                  </time>
                  <strong>
                    {active.candle.close > active.candle.open
                      ? "상승"
                      : active.candle.close < active.candle.open
                        ? "하락"
                        : "보합"}
                  </strong>
                  <dl className="wispi-price-chart__ohlc">
                    {(
                      [
                        ["시가", active.candle.open],
                        ["고가", active.candle.high],
                        ["저가", active.candle.low],
                        ["종가", active.candle.close],
                      ] as const
                    ).map(([name, value]) => (
                      <div key={name}>
                        <dt>{name}</dt>
                        <dd>
                          {formatValue(value)} {unit}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <span className="wispi-price-chart__observations">
                    관측 {active.candle.observations}회
                  </span>
                </>
              ) : (
                <strong>
                  {formatValue(active.price)} {unit}
                </strong>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
