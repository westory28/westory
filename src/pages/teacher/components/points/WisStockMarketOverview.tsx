import { useMemo, type ReactNode } from "react";
import InfoHelp from "../../../../components/common/InfoHelp";
import WisStockPriceChart from "../../../../components/common/WisStockPriceChart";
import type {
  WisStock,
  WisStockMarketIndex,
} from "../../../../lib/wisStocksClient";
import {
  wisStockQuote,
  quoteNumber,
  signedQuote,
  quoteDirection,
} from "./wisStockQuote";

const number = (value: number) =>
  value.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function WisStockMarketOverview({
  index,
  stock,
  asOfMs,
  actions,
  unit = "위스",
  indexName = "전체 위스피",
}: {
  index?: WisStockMarketIndex;
  stock?: WisStock;
  asOfMs: number;
  actions?: ReactNode;
  /** Price unit of the venue (the overseas market quotes in 유스). */
  unit?: "위스" | "유스";
  indexName?: string;
}) {
  const series = useMemo(
    () => ({
      id: "wispi-market-index",
      settings: { name: indexName },
      price: index?.value || 1000,
      updatedAtMs: index?.updatedAtMs || 0,
      history:
        index?.history.map((point) => ({
          atMs: point.atMs,
          price: point.value,
        })) || [],
    }),
    [index, indexName],
  );
  const quote = stock ? wisStockQuote(stock, asOfMs) : null;
  const change = stock
    ? quote!.change
    : index?.history.length
      ? index.value - index.previousClose
      : null;
  const percent = stock
    ? quote!.percent
    : index?.previousClose && change !== null
      ? (change / index.previousClose) * 100
      : null;
  const updatedAtMs = stock?.updatedAtMs || index?.updatedAtMs || 0;
  const name = stock?.settings.name || indexName;
  return (
    <section
      className="wis-stocks__market-index"
      aria-label={stock ? `${name} 시세` : `${indexName} 지수`}
    >
      <div className="wis-stocks__index-quote">
        <div className="wis-stocks__index-title">
          <h3>{name}</h3>
          {!stock && (
            <InfoHelp label="위스피 지수 계산">
              <p>
                기준 지수는 1,000입니다. 종목 가격과 발행 주식 수를 반영하며
                신규 상장이나 발행량 변경만으로 지수가 변하지 않도록 조정합니다.
                보관된 실제 가격 기록으로 계산하며 전 거래일 마지막 지수와
                비교합니다. 첫날은 시작 지수와 비교합니다.
              </p>
            </InfoHelp>
          )}
          {actions}
        </div>
        <strong>
          {stock
            ? quoteNumber(stock.price)
            : index?.history.length
              ? number(index.value)
              : "—"}
          <small>{stock ? unit : "pt"}</small>
        </strong>
        {change !== null && percent !== null && (
          <span className={quoteDirection(change)}>
            {signedQuote(change, stock ? 0 : 2)} ({signedQuote(percent, 2)}%)
          </span>
        )}
        {Boolean(updatedAtMs) && (
          <time dateTime={new Date(updatedAtMs).toISOString()}>
            {new Intl.DateTimeFormat("ko-KR", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Seoul",
            }).format(updatedAtMs)}{" "}
            기준
          </time>
        )}
      </div>
      {stock ? (
        <WisStockPriceChart
          stock={stock}
          days={Infinity}
          variant="candlestick"
          priceUnit={unit}
        />
      ) : index?.history.length ? (
        <WisStockPriceChart
          stock={series}
          days={Infinity}
          kind="index"
          variant="candlestick"
        />
      ) : (
        <p className="wis-stocks__empty">아직 지수 기록이 없습니다.</p>
      )}
      {stock?.settings.description && (
        <p className="wis-stocks__detail-description">
          {stock.settings.description}
        </p>
      )}
    </section>
  );
}
