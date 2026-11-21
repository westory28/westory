import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  watchWisStockExchange,
  type ExchangeMarket,
  type ExchangeState,
} from "../../../../lib/wisStockExchangeDisplayClient";
import type { WisStockManagement } from "../../../../lib/wisStocksClient";
import { quoteNumber, signedQuote, wisStockQuote } from "./wisStockQuote";
import "./WisStockExchangeDisplay.css";

const clock = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const dated = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const direction = (change: number) =>
  change > 0 ? "up" : change < 0 ? "down" : "flat";
const kstDay = (atMs: number) =>
  Math.floor((atMs + 9 * 3_600_000) / 86_400_000);

function Movement({
  price,
  previous,
  digits = 0,
}: {
  price: number;
  previous: number | null;
  digits?: number;
}) {
  if (previous === null) return <span className="wis-exchange__muted">—</span>;
  const change = price - previous;
  const icon = change > 0 ? "▲" : change < 0 ? "▼" : "―";
  return (
    <span className={"wis-exchange__movement is-" + direction(change)}>
      <span>
        <span aria-hidden="true">{icon} </span>
        <span className="sr-only">
          {change > 0 ? "상승 " : change < 0 ? "하락 " : "보합 "}
        </span>
        {quoteNumber(Math.abs(change), digits)}
      </span>
      <small>({signedQuote((change / previous) * 100, 2)}%)</small>
    </span>
  );
}

function initialQuotes(market: WisStockManagement): ExchangeMarket {
  return {
    updatedAtMs: market.updatedAtMs,
    halted: !market.studentOpen || market.rules.halted,
    index: market.marketIndex?.history.length ? market.marketIndex : null,
    stocks: market.stocks.map((stock) => {
      const { change } = wisStockQuote(stock, market.updatedAtMs);
      return {
        id: stock.id,
        name: stock.settings.name,
        price: stock.price,
        previousClose: change === null ? null : stock.price - change,
      };
    }),
  };
}

export default function WisStockExchangeDisplay({
  year,
  semester,
  classKey,
  initialMarket,
  onClose,
}: {
  year: string;
  semester: string;
  classKey: string;
  initialMarket: WisStockManagement;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<ExchangeState>({ status: "loading" });
  useLayoutEffect(() => {
    const modal = dialog.current!;
    const frame = panel.current!;
    const overflow = document.body.style.overflow;
    const opener = document.activeElement;
    modal.showModal();
    document.body.style.overflow = "hidden";
    let entered = false;
    const changed = () => {
      if (document.fullscreenElement === frame) entered = true;
      else if (entered) close.current();
    };
    document.addEventListener("fullscreenchange", changed);
    // Keep the viewport dialog on devices that do not permit native fullscreen.
    void frame.requestFullscreen?.().catch(() => {});
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      if (document.fullscreenElement === frame)
        void document.exitFullscreen().catch(() => {});
      modal.close();
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  useEffect(
    () => watchWisStockExchange(year, semester, classKey, setState),
    [year, semester, classKey, retry],
  );
  const initial = useMemo(() => initialQuotes(initialMarket), [initialMarket]);
  const market = state.status === "ready" ? (state.market ?? initial) : null;
  const index = market?.index;
  const trades = state.status === "ready" ? state.trades : null;
  const breadth = { up: 0, flat: 0, down: 0 };
  for (const stock of market?.stocks ?? []) {
    if (stock.previousClose !== null)
      breadth[direction(stock.price - stock.previousClose)]++;
  }
  const status =
    state.status === "ready"
      ? "실시간 연결"
      : state.status === "error"
        ? "연결 오류"
        : state.status === "offline"
          ? "오프라인"
          : state.status === "paused"
            ? "연결 일시 중지"
            : "연결 중";
  const [grade, classNumber] = classKey.split(":");
  const today = kstDay(Date.now());
  return createPortal(
    <dialog
      ref={dialog}
      className="wis-exchange-dialog"
      aria-labelledby="wis-exchange-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div ref={panel} className="wis-exchange">
        <div className="wis-exchange__bar">
          <h2 id="wis-exchange-title">위스피 전광판</h2>
          <span
            className={
              "wis-exchange__connection" +
              (state.status === "ready" ? " is-ready" : "")
            }
            role="status"
          >
            {status}
          </span>
          <button
            type="button"
            className="wis-exchange__close"
            onClick={onClose}
            autoFocus
            aria-label="전광판 닫기"
          >
            <span aria-hidden="true">×</span> 닫기
          </button>
        </div>
        {state.status === "error" && (
          <div className="wis-exchange__error" role="alert">
            {state.message}
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              다시 연결
            </button>
          </div>
        )}
        <div className="wis-exchange__columns">
          <section
            className="wis-exchange__quotes"
            aria-labelledby="wis-exchange-quotes"
          >
            <div className="wis-exchange__heading">
              <h3 id="wis-exchange-quotes">종목 시세</h3>
              <span>단위 위스</span>
            </div>
            <div
              className="wis-exchange__scroll"
              tabIndex={0}
              role="region"
              aria-label="종목 시세 목록"
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">종목명</th>
                    <th scope="col">현재가</th>
                    <th scope="col">전일 대비</th>
                  </tr>
                </thead>
                <tbody>
                  {market?.stocks.map((stock) => (
                    <tr key={stock.id}>
                      <th scope="row">{stock.name}</th>
                      <td>{quoteNumber(stock.price)}</td>
                      <td>
                        <Movement
                          price={stock.price}
                          previous={stock.previousClose}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {market && !market.stocks.length && (
                <p className="wis-exchange__empty">상장된 종목이 없습니다.</p>
              )}
            </div>
          </section>
          <section className="wis-exchange__index" aria-label="위스피 종합지수">
            <div className="wis-exchange__index-main">
              <h3>
                <span lang="en">WsPI</span>
                <small>위스피 종합지수</small>
              </h3>
              <strong className="wis-exchange__index-value">
                {index ? quoteNumber(index.value, 2) : "—"}
                <small>pt</small>
              </strong>
              {index && (
                <div className="wis-exchange__index-change">
                  <span>전일 대비</span>
                  <Movement
                    price={index.value}
                    previous={index.previousClose}
                    digits={2}
                  />
                </div>
              )}
              {market && (
                <div className="wis-exchange__index-time">
                  <span>{market.halted ? "거래 정지" : "거래 중"}</span>
                  {market.updatedAtMs > 0 && (
                    <time dateTime={new Date(market.updatedAtMs).toISOString()}>
                      {dated.format(market.updatedAtMs)}{" "}
                      {state.status === "ready" && !state.market
                        ? "조회 시세"
                        : "시세"}
                    </time>
                  )}
                </div>
              )}
              {market && !index && (
                <p className="wis-exchange__empty">
                  아직 지수 기록이 없습니다.
                </p>
              )}
            </div>
            {market && (
              <div
                className="wis-exchange__breadth"
                aria-label="종목별 등락 분포"
              >
                <div className="wis-exchange__breadth-bar" aria-hidden="true">
                  {(["up", "flat", "down"] as const).map(
                    (key) =>
                      breadth[key] > 0 && (
                        <i
                          key={key}
                          className={"is-" + key}
                          style={{ flex: breadth[key] }}
                        />
                      ),
                  )}
                </div>
                <dl>
                  {(["up", "flat", "down"] as const).map((key, i) => (
                    <div key={key}>
                      <dt>{["상승", "보합", "하락"][i]}</dt>
                      <dd className={"is-" + key}>{breadth[key]}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </section>
          <section
            className="wis-exchange__trades"
            aria-labelledby="wis-exchange-trades"
          >
            <div className="wis-exchange__heading">
              <h3 id="wis-exchange-trades">실시간 체결</h3>
              <span>
                {classKey === "all"
                  ? "전체 학급"
                  : grade + "학년 " + classNumber + "반"}{" "}
                · 최근 20건
              </span>
            </div>
            <div
              className="wis-exchange__scroll"
              tabIndex={0}
              role="region"
              aria-label="최근 학생 체결 목록"
            >
              {trades && !trades.length && (
                <p className="wis-exchange__empty">표시할 체결이 없습니다.</p>
              )}
              <ol>
                {trades?.map((trade) => (
                  <li key={trade.id}>
                    <div className="wis-exchange__trade-head">
                      <b className={trade.side === "BUY" ? "is-up" : "is-down"}>
                        {trade.side === "BUY" ? "매수" : "매도"}
                      </b>
                      <strong>{trade.displayName}</strong>
                      <time
                        dateTime={new Date(trade.atMs).toISOString()}
                        title={dated.format(trade.atMs)}
                      >
                        {kstDay(trade.atMs) === today
                          ? clock.format(trade.atMs)
                          : dated.format(trade.atMs)}
                      </time>
                    </div>
                    <div className="wis-exchange__trade-stock">
                      <span>{trade.stockName}</span>
                      <span>
                        {quoteNumber(trade.quantity)}주 · 주당{" "}
                        {quoteNumber(trade.unitPrice)}위스
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
