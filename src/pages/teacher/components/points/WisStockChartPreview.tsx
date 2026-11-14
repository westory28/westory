import { useEffect, useMemo, useRef, useState } from "react";
import { animate, createScope } from "animejs";
import InfoHelp from "../../../../components/common/InfoHelp";
import type {
  WisStock,
  WisStockMarketRules,
} from "../../../../lib/wisStocksClient";
import WisStockOrderPreview from "./WisStockOrderPreview";

const DAY = 86_400_000;
const periods = [
  { key: "day", label: "1일", days: 1 },
  { key: "week", label: "1주", days: 7 },
  { key: "month", label: "1개월", days: 30 },
  { key: "all", label: "전체", days: Infinity },
] as const;
const money = (value: number) => value.toLocaleString("ko-KR");
const stamp = (value: number) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(value);
const exampleStocks: WisStock[] = [
  {
    name: "조선 상업",
    period: "조선 후기",
    prices: [
      100, 98, 102, 101, 108, 106, 109, 115, 112, 110, 116, 123, 118, 122, 126,
      123, 130,
    ],
  },
  {
    name: "고려 무역",
    period: "고려 시대",
    prices: [
      180, 185, 181, 175, 178, 180, 174, 170, 176, 173, 168, 172, 170, 166, 169,
      165, 168,
    ],
  },
  {
    name: "신라 교역",
    period: "통일 신라",
    prices: [
      80, 81, 79, 82, 84, 81, 85, 83, 87, 86, 90, 87, 89, 91, 90, 92, 94,
    ],
  },
].map((item, index) => ({
  id: `stock_${String(index + 1).padStart(24, "0")}`,
  settings: {
    name: item.name,
    period: item.period,
    description: "화면 구성을 확인하기 위한 가상의 역사 종목입니다.",
    initialPrice: item.prices[0],
    minimumPrice: 1,
    maximumPrice: 10000,
    volatilityBps: 300,
    trendBps: 0,
    intervalHours: 24,
    automatic: false,
    issuedShares: 100000,
    lotSize: 1,
    tradingStatus: "ACTIVE",
  },
  price: item.prices.at(-1)!,
  updatedAtMs: Date.UTC(2026, 10, 13, 1),
  nextTickAtMs: 0,
  history: item.prices.map((price, i) => ({
    atMs: Date.UTC(2026, 10, 13, 1) - (item.prices.length - 1 - i) * DAY,
    price,
  })),
}));

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
  if (!points.size && Number.isSafeInteger(stock.price) && stock.price > 0)
    points.set(
      Number.isSafeInteger(stock.updatedAtMs) &&
        stock.updatedAtMs >= 0 &&
        stock.updatedAtMs <= 8_640_000_000_000_000
        ? stock.updatedAtMs
        : 0,
      stock.price,
    );
  return [...points]
    .sort((a, b) => a[0] - b[0])
    .map(([atMs, price]) => ({ atMs, price }));
}
function StockChart({ stock, days }: { stock: WisStock; days: number }) {
  const root = useRef<HTMLDivElement>(null);
  const observations = useMemo(() => stockObservations(stock), [stock]);
  const end = observations.at(-1)?.atMs || 0;
  const cutoff = end - days * DAY;
  const visible = observations.filter((point) => point.atMs >= cutoff);
  const prices = visible.map((point) => point.price);
  const low = prices.length ? Math.min(...prices) : 0;
  const high = prices.length ? Math.max(...prices) : 0;
  const start = visible[0]?.atMs || 0;
  const span = end - start;
  const points = visible.map((point) => ({
    x: 20 + (span > 0 ? (point.atMs - start) / span : 0.5) * 560,
    y: high === low ? 132 : 232 - ((point.price - low) / (high - low)) * 200,
  }));
  useEffect(() => {
    const scope = createScope({
      root,
      mediaQueries: { reduceMotion: "(prefers-reduced-motion: reduce)" },
    }).add((context) => {
      if (!context || context.matches.reduceMotion) return;
      const line = root.current?.querySelector<SVGPolylineElement>("polyline");
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
  }, [stock.id, stock.updatedAtMs, days]);
  return (
    <div ref={root} className="wis-stock-chart">
      <div className="wis-stock-chart__values">
        <span>최고 {money(high)} 위스</span>
        <span>최저 {money(low)} 위스</span>
      </div>
      <svg
        viewBox="0 0 600 264"
        role="img"
        aria-label={`${stock.settings.name} 가격 변동, 관측 ${visible.length}건, 최고 ${money(high)} 위스, 최저 ${money(low)} 위스`}
      >
        {[32, 132, 232].map((y) => (
          <line
            key={y}
            x1="20"
            y1={y}
            x2="580"
            y2={y}
            className="wis-stock-chart__axis"
          />
        ))}
        <g className="wis-stock-chart__plot">
          <polyline
            points={points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
          />
          {points.length > 0 && (
            <circle cx={points.at(-1)!.x} cy={points.at(-1)!.y} r="4" />
          )}
        </g>
      </svg>
      <div className="wis-stock-chart__values">
        <span>{stamp(start)}</span>
        <span>{stamp(end)}</span>
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
  const available = stocks.length ? stocks : exampleStocks;
  const [selectedId, setSelectedId] = useState(available[0]?.id || "");
  const [period, setPeriod] = useState<(typeof periods)[number]>(periods[3]);
  const [orderPending, setOrderPending] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected =
    available.find((stock) => stock.id === selectedId) || available[0];
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
          {stocks.length ? "등록 종목" : "예시 자료"}
        </span>
        <InfoHelp label="미리보기 자료">
          <p>
            가격은 {stocks.length ? "현재 등록된 종목" : "가상의 예시 종목"}{" "}
            자료입니다. 계좌 이체와 매수·매도는 예시 안에서만 처리하며, 학생
            지갑이나 보유 주식은 바뀌지 않습니다.
          </p>
        </InfoHelp>
      </div>
      <div className="wis-stock-preview__layout">
        <div className="wis-stock-preview__catalog" aria-label="미리보기 종목">
          {available.map((stock, index) => {
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
                  {String(index + 1).padStart(2, "0")}
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
          <WisStockOrderPreview
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
