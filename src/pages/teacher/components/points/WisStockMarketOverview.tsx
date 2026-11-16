import { useMemo } from "react";
import InfoHelp from "../../../../components/common/InfoHelp";
import WisStockPriceChart, {
  stockObservations,
} from "../../../../components/common/WisStockPriceChart";
import type {
  WisStock,
  WisStockMarketIndex,
} from "../../../../lib/wisStocksClient";

const number = (value: number) =>
  value.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function WisStockMarketOverview({
  index,
}: {
  index?: WisStockMarketIndex;
}) {
  const series = useMemo(
    () => ({
      id: "wispi-market-index",
      settings: { name: "전체 위스피" },
      price: index?.value || 1000,
      updatedAtMs: index?.updatedAtMs || 0,
      history:
        index?.history.map((point) => ({
          atMs: point.atMs,
          price: point.value,
        })) || [],
    }),
    [index],
  );
  const change = index ? index.value - index.previousClose : 0;
  const percent = index?.previousClose
    ? (change / index.previousClose) * 100
    : 0;
  return (
    <section className="wis-stocks__market-index" aria-label="전체 위스피 지수">
      <div className="wis-stocks__index-quote">
        <div className="wis-stocks__index-title">
          <h3>전체 위스피</h3>
          <InfoHelp label="위스피 지수 계산">
            <p>
              기준 지수는 1,000입니다. 종목 가격과 발행 주식 수를 반영하며 신규
              상장이나 발행량 변경만으로 지수가 변하지 않도록 조정합니다. 보관된
              실제 가격 기록으로 계산하며 전 거래일 마지막 지수와 비교합니다.
              첫날은 시작 지수와 비교합니다.
            </p>
          </InfoHelp>
        </div>
        <strong>
          {index?.history.length ? number(index.value) : "—"}
          <small>pt</small>
        </strong>
        {Boolean(index?.history.length) && (
          <span
            className={
              change > 0 ? "is-up" : change < 0 ? "is-down" : "is-flat"
            }
          >
            {change > 0 ? "+" : ""}
            {number(change)} ({percent > 0 ? "+" : ""}
            {number(percent)}%)
          </span>
        )}
        {Boolean(index?.updatedAtMs) && (
          <time dateTime={new Date(index!.updatedAtMs).toISOString()}>
            {new Intl.DateTimeFormat("ko-KR", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Seoul",
            }).format(index!.updatedAtMs)}{" "}
            기준
          </time>
        )}
      </div>
      {index?.history.length ? (
        <WisStockPriceChart stock={series} days={Infinity} kind="index" />
      ) : (
        <p className="wis-stocks__empty">아직 지수 기록이 없습니다.</p>
      )}
    </section>
  );
}

export function WisStockSparkline({ stock }: { stock: WisStock }) {
  const observations = stockObservations(stock);
  if (!observations.length)
    return <span className="wis-stocks__sparkline-empty">가격 기록 없음</span>;
  const low = Math.min(...observations.map((point) => point.price));
  const high = Math.max(...observations.map((point) => point.price));
  const start = observations[0].atMs;
  const end = observations.at(-1)!.atMs;
  const points = observations.map((point) => ({
    x: end === start ? 80 : 4 + ((point.atMs - start) / (end - start)) * 152,
    y: high === low ? 32 : 58 - ((point.price - low) / (high - low)) * 52,
  }));
  const last = points.at(-1)!;
  const change = observations.at(-1)!.price - observations[0].price;
  return (
    <svg
      className={`wis-stocks__sparkline ${change > 0 ? "is-up" : change < 0 ? "is-down" : "is-flat"}`}
      viewBox="0 0 160 64"
      role="img"
      aria-label={`${stock.settings.name} 실제 가격 추이, ${observations.length}건, ${observations[0].price}에서 ${observations.at(-1)!.price} 위스`}
    >
      <path d="M4 60H156" className="wis-stocks__sparkline-axis" />
      <polyline
        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
      />
      <circle cx={last.x} cy={last.y} r="3" />
    </svg>
  );
}
