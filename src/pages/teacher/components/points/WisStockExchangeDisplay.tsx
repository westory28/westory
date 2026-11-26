import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExchangeMarket } from "../../../../lib/wisStockExchangeDisplayClient";
import type { WisStockManagement } from "../../../../lib/wisStocksClient";
import { quoteNumber, signedQuote, wisStockQuote } from "./wisStockQuote";
import { Movement, direction } from "./WisStockMovement";
import WisStockQuotePages from "./WisStockQuotePages";
import WisStockTradeFeed, { exchangeDateTime } from "./WisStockTradeFeed";
import WisStockFlapFaces from "./WisStockFlapFaces";
import type { StockBulletinItem } from "./wisStockDisplayBulletins";
import { useWisStockDisplayRows } from "./useWisStockDisplayRows";
import { useWisStockExchangeDisplay } from "./useWisStockExchangeDisplay";
import {
  exitLabel,
  useWisStockBulletinAudio,
} from "./useWisStockBulletinAudio";
import "./WisStockExchangeDisplay.css";

function bulletinHeading(stocks: StockBulletinItem[]) {
  const lead = stocks[0];
  if (lead.kind === "listing") return "신규 상장";
  if (lead.kind === "exit") return exitLabel(lead.exit);
  const up = stocks.some((item) => "percent" in item && item.percent > 0);
  const down = stocks.some((item) => "percent" in item && item.percent < 0);
  return up && down ? "급등·급락 속보" : up ? "급등 속보" : "급락 속보";
}
function surgeList(stocks: StockBulletinItem[]) {
  return (
    <ul aria-label={bulletinHeading(stocks)}>
      {stocks.map((stock) => (
        <li
          key={stock.id}
          className={
            stock.kind === "listing"
              ? "is-listing"
              : stock.kind === "exit"
                ? "is-exit"
                : "is-" + direction(stock.percent)
          }
        >
          <b>{stock.name}</b>
          {stock.kind === "listing" ? (
            <strong>
              <small>{stock.hasListingPrice ? "상장가" : "현재가"} </small>
              {quoteNumber(stock.price)}
              <small> 위스</small>
            </strong>
          ) : stock.kind === "exit" ? (
            <strong>
              <small>마지막 가격 </small>
              {quoteNumber(stock.price)}
              <small> 위스</small>
            </strong>
          ) : (
            <strong>
              <span aria-hidden="true">{stock.percent > 0 ? "▲ " : "▼ "}</span>
              <span className="sr-only">
                {stock.percent > 0 ? "상승 " : "하락 "}
              </span>
              {signedQuote(stock.percent, 2)}%
            </strong>
          )}
          <time dateTime={new Date(stock.atMs).toISOString()}>
            {exchangeDateTime.format(stock.atMs)}{" "}
            {stock.kind === "listing"
              ? stock.hasListingPrice
                ? "상장"
                : "상장 확인"
              : stock.kind === "exit"
                ? exitLabel(stock.exit)
                : "시세"}
          </time>
        </li>
      ))}
    </ul>
  );
}

function initialQuotes(market: WisStockManagement): ExchangeMarket {
  const updatedAtMs = Math.max(
    market.updatedAtMs,
    ...market.stocks.map((stock) => stock.updatedAtMs),
  );
  return {
    updatedAtMs,
    halted: !market.studentOpen || market.rules.halted,
    index: market.marketIndex?.history.length ? market.marketIndex : null,
    stocks: market.stocks.map((stock) => {
      const { change } = wisStockQuote(stock, updatedAtMs);
      const latest = stock.history.at(-1);
      const previous = stock.history.at(-2);
      const first = stock.history[0];
      return {
        id: stock.id,
        name: stock.settings.name,
        price: stock.price,
        previousClose: change === null ? null : stock.price - change,
        ...(previous &&
        latest?.price === stock.price &&
        previous.atMs < latest.atMs
          ? { previousPrice: previous.price, priceAtMs: latest.atMs }
          : {}),
        ...(first &&
        stock.history.length < market.historyLimit &&
        first.price === stock.settings.initialPrice
          ? { listedAtMs: first.atMs, listingPrice: first.price }
          : {}),
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
  const displayClose = useRef<HTMLButtonElement>(null);
  const bulletinFocused = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  const [retry, setRetry] = useState(0);
  const [mobilePanel, setMobilePanel] = useState<"quotes" | "trades">("quotes");
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 639px)").matches,
  );
  useLayoutEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const initial = useMemo(() => initialQuotes(initialMarket), [initialMarket]);
  const {
    state,
    flips,
    bulletin,
    tradeSession,
    dismissBulletin: dismissRotation,
  } = useWisStockExchangeDisplay(year, semester, classKey, retry, initial);
  const audio = useWisStockBulletinAudio(
    bulletin,
    state.status === "ready" && !(state.market ?? initial).halted,
  );
  const dismissBulletin = () => {
    audio.stop();
    dismissRotation();
  };
  useLayoutEffect(() => {
    if (!bulletin && bulletinFocused.current) {
      bulletinFocused.current = false;
      displayClose.current?.focus();
    }
  }, [bulletin]);
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
  const rows = useWisStockDisplayRows(panel);
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
  return createPortal(
    <dialog
      ref={dialog}
      className="wis-exchange-dialog"
      aria-labelledby="wis-exchange-title"
      onCancel={(event) => {
        event.preventDefault();
        if (bulletin) dismissBulletin();
        else onClose();
      }}
    >
      <div
        ref={panel}
        className="wis-exchange"
        onClickCapture={(event) => {
          if (
            bulletin &&
            event.target instanceof Element &&
            !event.target.closest(
              ".wis-exchange__surge, .wis-exchange__actions",
            )
          )
            dismissBulletin();
        }}
      >
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
          <div className="wis-exchange__actions">
            <button
              type="button"
              aria-label="속보 알림음"
              aria-pressed={audio.sound}
              disabled={!audio.soundAvailable}
              title={
                audio.soundAvailable
                  ? undefined
                  : "이 브라우저는 알림음을 지원하지 않습니다."
              }
              onClick={() => void audio.toggleSound()}
            >
              알림음 {audio.sound ? "켬" : "끔"}
            </button>
            <button
              type="button"
              aria-label="속보 음성"
              aria-pressed={audio.speech}
              disabled={!audio.speechAvailable}
              title={
                audio.speechAvailable
                  ? undefined
                  : "이 브라우저는 음성 안내를 지원하지 않습니다."
              }
              onClick={audio.toggleSpeech}
            >
              음성 {audio.speech ? "켬" : "끔"}
            </button>
            <button
              ref={displayClose}
              type="button"
              className="wis-exchange__close"
              onClick={onClose}
              autoFocus
              aria-label="전광판 닫기"
            >
              <span aria-hidden="true">×</span>{" "}
              <span className="wis-exchange__close-text">닫기</span>
            </button>
          </div>
        </div>
        {audio.message && (
          <div className="wis-exchange__error" role="status">
            {audio.message}
          </div>
        )}
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
        <div className="wis-exchange__columns" data-panel={mobilePanel}>
          <div
            className="wis-exchange__mobile-switch"
            role="group"
            aria-label="표시할 목록"
          >
            <button
              type="button"
              aria-pressed={mobilePanel === "quotes"}
              onClick={() => setMobilePanel("quotes")}
            >
              시세
            </button>
            <button
              type="button"
              aria-pressed={mobilePanel === "trades"}
              onClick={() => setMobilePanel("trades")}
            >
              체결
            </button>
          </div>
          <WisStockQuotePages
            stocks={market?.stocks}
            flips={flips}
            rows={rows.quotes}
            active={
              state.status === "ready" && (!narrow || mobilePanel === "quotes")
            }
          />
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
                      {exchangeDateTime.format(market.updatedAtMs)}{" "}
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
          <WisStockTradeFeed
            trades={trades}
            rows={rows.trades}
            classKey={classKey}
            session={tradeSession}
          />
        </div>
        <div
          className="wis-exchange__bulletin"
          role="status"
          aria-live="polite"
        >
          {bulletin && (
            <div className="wis-exchange__surge">
              <button
                type="button"
                className="wis-exchange__surge-close"
                aria-label="속보 닫기"
                onClick={dismissBulletin}
                onFocus={() => {
                  bulletinFocused.current = true;
                }}
                onBlur={() => {
                  bulletinFocused.current = false;
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
              <div className="wis-exchange__surge-heading">
                <strong>{bulletinHeading(bulletin.stocks)}</strong>
                <span>
                  {
                    {
                      listing: "오늘",
                      exit: "오늘 거래 종료",
                      previous: "직전 시세 대비",
                      received: "직전 수신 시세 대비",
                    }[bulletin.stocks[0].kind]
                  }
                </span>
              </div>
              <div className="wis-exchange__surge-page">
                {surgeList(bulletin.stocks)}
                {bulletin.before.length > 0 && (
                  <WisStockFlapFaces
                    key={bulletin.id}
                    before={surgeList(bulletin.before)}
                    after={surgeList(bulletin.stocks)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
