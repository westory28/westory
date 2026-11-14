import { useEffect, useId, useMemo, useRef, useState } from "react";
import { animate, createScope } from "animejs";
import InfoHelp from "../../../../components/common/InfoHelp";
import type {
  WisStock,
  WisStockMarketRules,
} from "../../../../lib/wisStocksClient";
import WisStockOrderPreview from "./WisStockOrderPreview";
import {
  wisStockCatalog,
  wisStockCatalogWeeks,
  createWisStockPlanStocks,
} from "../../../../lib/wisStockCatalog";
import "./WisStockChart.css";
import "./WisStockCatalog.css";

const DAY = 86_400_000;
const periods = [
  { key: "day", label: "1일", days: 1 },
  { key: "week", label: "1주", days: 7 },
  { key: "month", label: "1개월", days: 30 },
  { key: "all", label: "전체", days: Infinity },
] as const;
const money = (value: number) => value.toLocaleString("ko-KR");
const catalogById = new Map(
  wisStockCatalog.map((company) => [company.id, company]),
);
const catalogByName = new Map(
  wisStockCatalog.map((company) => [company.name, company]),
);
const sessionLabel = (session: number) =>
  `${Math.floor((session - 1) / 35) + 1}주 ${Math.floor(((session - 1) % 35) / 7) + 1}일차`;

// Keep observed times and prices. Invalid or repeated observations must never
// create NaN coordinates, fabricated prices, or an equal-spacing time axis.
export function stockObservations(stock: WisStock) {
  const points = new Map<number, number>();
  for (const point of Array.isArray(stock.history) ? stock.history : [])
    if (
      point &&
      Number.isSafeInteger(point.atMs) &&
      point.atMs >= 0 &&
      point.atMs <= 8_640_000_000_000_000 &&
      Number.isSafeInteger(point.price) &&
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
function priceAxis(low: number, high: number) {
  const pad = high === low ? Math.max(1, Math.round(high * 0.05)) : 0;
  const minimum = Math.max(0, low - pad),
    maximum = Math.min(Number.MAX_SAFE_INTEGER, high + pad);
  const rough = Math.max(1, (maximum - minimum) / 4);
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
function StockChart({ stock, days }: { stock: WisStock; days: number }) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  const [width, setWidth] = useState(600);
  const [selection, setSelection] = useState<{
    key: string;
    index: number;
  } | null>(null);
  const observations = useMemo(() => stockObservations(stock), [stock]);
  const visible = useMemo(() => {
    const end = observations.at(-1)?.atMs || 0;
    return observations.filter((point) => point.atMs >= end - days * DAY);
  }, [observations, days]);
  const key = JSON.stringify([stock.id, days, visible]);
  const prices = visible.map((point) => point.price);
  const low = prices.length
    ? Math.min(...prices)
    : Number.isSafeInteger(stock.price) && stock.price >= 0
      ? stock.price
      : 0;
  const high = prices.length ? Math.max(...prices) : low;
  const domain = priceAxis(low, high);
  const start = visible[0]?.atMs || 0,
    end = visible.at(-1)?.atMs || start;
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
  const points = visible.map((point) => ({
    ...point,
    x: x(point.atMs),
    y: y(point.price),
  }));
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
  }, [stock.id, stock.updatedAtMs, days, width]);
  return (
    <div ref={root} className="wis-stock-chart wispi-price-chart">
      <p id={`${id}-help`} className="wispi-price-chart__instructions">
        차트에 마우스를 올리거나 터치하면 기록된 가격을 확인합니다. 키보드 좌우
        방향키로 기록을 이동하고 Home과 End로 처음과 마지막 기록을 확인합니다.
        Escape로 가격 말풍선을 닫습니다.
      </p>
      <div
        ref={canvas}
        className="wispi-price-chart__canvas"
        tabIndex={visible.length ? 0 : -1}
        role="group"
        aria-label={`${stock.settings.name} 가격 차트`}
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
          aria-label={`${stock.settings.name} 가격 변동, 기록 ${visible.length}건${visible.length ? `, 최고 ${money(high)} 위스, 최저 ${money(low)} 위스` : ""}`}
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
              가격 (위스)
            </text>
            <line x1={left} y1={top} x2={left} y2={bottom} />
            <line x1={left} y1={bottom} x2={right} y2={bottom} />
            {domain.ticks.map((price) => (
              <g key={price}>
                <line x1={left - 4} y1={y(price)} x2={left} y2={y(price)} />
                <text x={left - 9} y={y(price)} dy=".35em" textAnchor="end">
                  {axisPrice(price)}
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
            <polyline
              points={points.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
            />
            {points.length > 0 && (
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
          <p className="wispi-price-chart__empty">아직 가격 기록이 없습니다.</p>
        )}
        {active && (
          <div
            id={`${id}-value`}
            role="tooltip"
            aria-live="polite"
            className="wispi-price-chart__tooltip"
            data-at-ms={active.atMs}
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
              top: Math.max(
                36,
                Math.min(
                  height - 100,
                  active.y >= 136 ? active.y - 88 : active.y + 20,
                ),
              ),
            }}
          >
            <time dateTime={new Date(active.atMs).toISOString()}>
              {exactDate.format(active.atMs)}
              {active.atMs % 1000
                ? `.${String(active.atMs % 1000).padStart(3, "0")}`
                : ""}
            </time>
            <strong>{money(active.price)} 위스</strong>
          </div>
        )}
      </div>
    </div>
  );
}
export default function WisStockChartPreview({
  stocks,
  rules,
  revision,
  semesterId,
}: {
  stocks: WisStock[];
  rules: WisStockMarketRules;
  revision: number;
  semesterId: string;
}) {
  const planStocks = useMemo(createWisStockPlanStocks, []);
  const [source, setSource] = useState(stocks.length ? "registered" : "plan");
  const isPlan = source === "plan" || !stocks.length;
  const available = isPlan ? planStocks : stocks;
  const [week, setWeek] = useState(1);
  const visibleStocks = isPlan
    ? available.filter((stock) => catalogById.get(stock.id)?.week === week)
    : available;
  const [selectedId, setSelectedId] = useState(available[0]?.id || "");
  const [period, setPeriod] = useState<(typeof periods)[number]>(periods[3]);
  const [orderPending, setOrderPending] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected =
    visibleStocks.find((stock) => stock.id === selectedId) || visibleStocks[0];
  const company = isPlan ? catalogById.get(selected.id) : undefined;
  const observations = stockObservations(selected);
  const lastAt = observations.at(-1)?.atMs || 0;
  const first =
    observations.find((point) => point.atMs >= lastAt - period.days * DAY)
      ?.price || selected.price;
  const change = selected.price - first;
  const percent = first ? (change / first) * 100 : 0;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  useEffect(() => {
    const scope = createScope({
      root,
      mediaQueries: { reduceMotion: "(prefers-reduced-motion: reduce)" },
    }).add((context) => {
      if (context && !context.matches.reduceMotion)
        animate(".wis-stock-preview__quote", {
          opacity: [0.45, 1],
          y: [5, 0],
          duration: 250,
          ease: "out(3)",
        });
    });
    return () => scope.revert();
  }, [selected.id, selected.price, period.key]);
  return (
    <div ref={root} className="wis-stock-preview">
      <div className="wis-stock-preview__heading">
        <h2>학생 화면 미리보기</h2>
        <span className="wis-stocks__closed">
          {isPlan ? "6주 기획안 · 가상 시세" : "등록 종목"}
        </span>
        <InfoHelp label="미리보기 자료">
          <p>
            등록 종목은 저장된 관측 가격을 표시합니다. 6주 기획안은 역사 종목
            70개와 장기 가치 종목 10개의 가상 시나리오이며, 날짜·등락·퇴장은
            실제 운영 일정이 아닙니다. 계좌 이체와 주문은 미리보기 안에서만
            처리합니다.
          </p>
        </InfoHelp>
      </div>
      <div
        className="wis-stock-catalog__filters"
        aria-label="미리보기 자료 선택"
      >
        <div role="group" aria-label="자료 종류">
          {[
            { key: "registered", label: "등록 종목" },
            { key: "plan", label: "6주 기획안" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={(isPlan ? "plan" : "registered") === item.key}
              disabled={
                orderPending || (item.key === "registered" && !stocks.length)
              }
              onClick={() => setSource(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {isPlan && (
          <label>
            공개 차수
            <select
              aria-label="공개 차수"
              value={week}
              disabled={orderPending}
              onChange={(event) => setWeek(Number(event.target.value))}
            >
              {wisStockCatalogWeeks.map((name, index) => (
                <option key={name} value={index + 1}>
                  {index + 1}주 · {name}
                </option>
              ))}
              <option value={0}>상시 · 장기 가치 종목</option>
            </select>
          </label>
        )}
      </div>
      <div className="wis-stock-preview__layout">
        <div className="wis-stock-preview__catalog" aria-label="미리보기 종목">
          {visibleStocks.map((stock, index) => {
            const logo = (
              isPlan
                ? catalogById.get(stock.id)
                : catalogByName.get(stock.settings.name)
            )?.logoUrl;
            const baseline = stockObservations(stock)[0]?.price || stock.price;
            const difference = stock.price - baseline;
            return (
              <button
                type="button"
                className={`wis-stock-preview__stock${selected.id === stock.id ? " is-selected" : ""}`}
                key={stock.id}
                aria-pressed={selected.id === stock.id}
                disabled={orderPending}
                onClick={() => {
                  setSelectedId(stock.id);
                }}
              >
                <span className="wis-stock-preview__symbol" aria-hidden="true">
                  {logo ? (
                    <img src={logo} alt="" width={36} height={36} />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <span className="wis-stock-preview__stock-name">
                  <strong>{stock.settings.name}</strong>
                  <small>{stock.settings.period || "역사 종목"}</small>
                </span>
                <span className="wis-stock-preview__stock-price">
                  <strong>{money(stock.price)}</strong>
                  <small
                    className={`is-${difference > 0 ? "up" : difference < 0 ? "down" : "flat"}`}
                  >
                    {difference > 0 ? "+" : ""}
                    {((difference / baseline) * 100).toFixed(1)}%
                  </small>
                </span>
              </button>
            );
          })}
        </div>
        <div className="wis-stock-preview__detail">
          <div className="wis-stock-preview__quote">
            <span>{selected.settings.period || "역사 종목"}</span>
            <h3>{selected.settings.name}</h3>
            <strong>
              {money(selected.price)} <small>위스</small>
            </strong>
            <p className={`is-${direction}`}>
              {change > 0 ? "상승" : change < 0 ? "하락" : "변동 없음"}{" "}
              {change > 0 ? "+" : ""}
              {money(change)} ({percent > 0 ? "+" : ""}
              {percent.toFixed(1)}%) <span>선택 기간 대비</span>
            </p>
          </div>
          <div className={`wis-stock-preview__chart is-${direction}`}>
            <StockChart stock={selected} days={period.days} />
          </div>
          <div className="wis-stock-preview__periods" aria-label="차트 기간">
            {periods.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={item.key === period.key}
                onClick={() => setPeriod(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {selected.settings.description && (
            <p className="wis-stock-preview__background">
              {selected.settings.description}
            </p>
          )}
          {company && (
            <details className="wis-stock-catalog__story" key={company.id}>
              <summary>종목 로드맵·역사 근거</summary>
              <div
                className="wis-stock-catalog__timeline"
                aria-label="6주 종목 로드맵"
              >
                <div className="wis-stock-catalog__weeks">
                  {wisStockCatalogWeeks.map((_, index) => (
                    <span key={index}>{index + 1}주</span>
                  ))}
                </div>
                {[
                  {
                    label: "등장",
                    session: company.listingSession,
                    kind: "listing",
                  },
                  {
                    label: "성장 구간",
                    session: company.riseSession,
                    kind: "rise",
                  },
                  {
                    label: "조정 구간",
                    session: company.fallSession,
                    kind: "fall",
                  },
                  ...(company.exitSession === null
                    ? []
                    : [
                        {
                          label:
                            company.exitKind === "merge"
                              ? "합병 구간"
                              : "퇴장 구간",
                          session: company.exitSession,
                          kind: "exit",
                        },
                      ]),
                ].map((event) => (
                  <div
                    className={`wis-stock-catalog__event is-${event.kind}`}
                    key={event.kind}
                  >
                    <span>{event.label}</span>
                    <div>
                      <i
                        style={{
                          left: `${Math.min(98, Math.max(2, ((event.session - 1) / 209) * 100))}%`,
                        }}
                      />
                    </div>
                    <small>{sessionLabel(event.session)}</small>
                  </div>
                ))}
              </div>
              <dl>
                <div>
                  <dt>성장 계기</dt>
                  <dd>{company.riseReason}</dd>
                </div>
                <div>
                  <dt>하락 위험</dt>
                  <dd>{company.fallReason}</dd>
                </div>
                <div>
                  <dt>마무리</dt>
                  <dd>
                    {company.exitReason || "6주 이후에도 존속하는 기획입니다."}
                  </dd>
                </div>
              </dl>
              <p className="wis-stock-catalog__fiction">
                가격·사건의 발생 시점은 수업용 가정입니다. 상장폐지·합병은
                기획안이며 계좌를 자동 정산하지 않습니다.
              </p>
              {company.sourceUrls.length > 0 && (
                <div className="wis-stock-catalog__sources">
                  {company.sourceUrls.map((url, index) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      {company.sourceTitle || "역사 자료"}
                      {company.sourceUrls.length > 1 ? ` ${index + 1}` : ""}
                    </a>
                  ))}
                </div>
              )}
              {company.sourceUrls.length === 0 && company.sourceTitle && (
                <p className="wis-stock-catalog__fiction">
                  출처: {company.sourceTitle}
                </p>
              )}
            </details>
          )}
          <WisStockOrderPreview
            key={isPlan ? "plan" : "registered"}
            stock={selected}
            stocks={available}
            rules={rules}
            revision={revision}
            semesterId={semesterId}
            onPendingChange={setOrderPending}
          />
        </div>
      </div>
    </div>
  );
}
