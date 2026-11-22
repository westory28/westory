import { useLayoutEffect, useRef, useState } from "react";
import type { ExchangeTrade } from "../../../../lib/wisStockExchangeDisplayClient";
import WisStockFlapFaces from "./WisStockFlapFaces";
import { quoteNumber } from "./wisStockQuote";
import "./WisStockTradeFeed.css";

const clock = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
export const exchangeDateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const kstDay = (at: number) => Math.floor((at + 9 * 3_600_000) / 86_400_000);

function TradeContent({ trade }: { trade: ExchangeTrade }) {
  return (
    <div className="wis-exchange__trade-content">
      <div className="wis-exchange__trade-head">
        <b className={trade.side === "BUY" ? "is-up" : "is-down"}>
          {trade.side === "BUY" ? "매수" : "매도"}
        </b>
        <strong>{trade.displayName}</strong>
        <time
          dateTime={new Date(trade.atMs).toISOString()}
          title={exchangeDateTime.format(trade.atMs)}
        >
          {kstDay(trade.atMs) === kstDay(Date.now())
            ? clock.format(trade.atMs)
            : exchangeDateTime.format(trade.atMs)}
        </time>
      </div>
      <div className="wis-exchange__trade-stock">
        <span>{trade.stockName}</span>
        <span className="wis-exchange__trade-amount">
          <span>
            <strong>{quoteNumber(trade.quantity)}</strong>주
          </span>{" "}
          <span>
            주당 <strong>{quoteNumber(trade.unitPrice)}</strong>위스
          </span>
        </span>
      </div>
    </div>
  );
}

type Turn = {
  flipIds: Set<string>;
  oldRows: ExchangeTrade[];
  fromTops: (number | undefined)[];
  rows: number;
};
function canTurn(list: HTMLOListElement | null) {
  return (
    Boolean(list?.getClientRects().length) &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
type Feed = {
  source: ExchangeTrade[] | null;
  session: number;
  classKey: string;
  items: ExchangeTrade[];
  page: number;
  turn: Turn | null;
};
type FeedProps = {
  trades: ExchangeTrade[] | null;
  rows: number;
  classKey: string;
  session: number;
};

export default function WisStockTradeFeed({
  trades,
  rows,
  classKey,
  session,
}: FeedProps) {
  const list = useRef<HTMLOListElement>(null);
  const [view, setView] = useState<Feed>({
    source: null,
    items: [],
    page: 0,
    turn: null,
    session,
    classKey,
  });
  const [grade, classNumber] = classKey.split(":");
  const pageSize = Math.max(1, rows);
  const pages = Math.max(1, Math.ceil(view.items.length / pageSize));
  const page = Math.min(view.page, pages - 1);
  const start = page * pageSize;
  const visible = view.items.slice(start, start + pageSize);

  useLayoutEffect(() => {
    const sameSession = view.session === session && view.classKey === classKey;
    if (sameSession && view.source === trades) return;
    const oldRanks = new Map(
      (sameSession ? view.items : []).map((trade, index) => [trade.id, index]),
    );
    const items = Array.from(
      new Map(trades?.map((trade) => [trade.id, trade])).values(),
    );
    // Firestore timestamps may tie. Keep newcomers ahead of already displayed fills
    // for that timestamp, and preserve their order on subsequent snapshots.
    items.sort(
      (a, b) =>
        b.atMs - a.atMs ||
        (oldRanks.get(a.id) ?? -1) - (oldRanks.get(b.id) ?? -1),
    );
    const lastAt = view.items[0]?.atMs ?? -Infinity;
    const fresh =
      sameSession && view.source
        ? items.filter(
            (trade) => trade.atMs >= lastAt && !oldRanks.has(trade.id),
          )
        : [];
    let turn = sameSession && trades ? view.turn : null;
    if (fresh.length) {
      const container = list.current;
      turn = null;
      if (container && canTurn(container)) {
        const oldRows = view.items.slice(start, start + pageSize);
        const oldPositions = new Map<string, number>();
        const top = container.getBoundingClientRect().top;
        Array.from(container.children).forEach((row, index) => {
          if (oldRows[index])
            oldPositions.set(
              oldRows[index].id,
              row.getBoundingClientRect().top - top,
            );
        });
        const fromTops = items
          .slice(0, pageSize)
          .map((trade) => oldPositions.get(trade.id));
        turn = {
          flipIds: new Set(fresh.map((trade) => trade.id)),
          oldRows,
          fromTops,
          rows: pageSize,
        };
      }
    }
    setView({
      source: trades,
      items,
      page: fresh.length || !trades || !sameSession ? 0 : page,
      turn,
      session,
      classKey,
    });
  }, [trades, view, start, pageSize, page, session, classKey]);

  useLayoutEffect(() => {
    const turn = view.turn;
    if (!turn) return;
    const animations: Animation[] = [];
    const container = list.current;
    if (container && turn.rows === pageSize) {
      const top = container.getBoundingClientRect().top;
      Array.from(container.children).forEach((row, index) => {
        const oldY = turn.fromTops[index];
        if (oldY === undefined) return;
        const delta = oldY - (row.getBoundingClientRect().top - top);
        if (Math.abs(delta) >= 1 && row.animate) {
          animations.push(
            row.animate(
              [
                { transform: `translateY(${delta}px)` },
                { transform: "translateY(0)" },
              ],
              {
                duration: 420,
                easing: "cubic-bezier(.22,.7,.24,1)",
              },
            ),
          );
        }
      });
    }
    const finish = setTimeout(
      () =>
        setView((current) =>
          current.turn === turn ? { ...current, turn: null } : current,
        ),
      450,
    );
    return () => {
      clearTimeout(finish);
      animations.forEach((animation) => animation.cancel());
    };
  }, [view.turn, pageSize]);

  const go = (next: number) => {
    const target = view.items.slice(next * pageSize, (next + 1) * pageSize);
    const turn = canTurn(list.current)
      ? {
          flipIds: new Set(target.map((trade) => trade.id)),
          oldRows: visible,
          fromTops: [],
          rows: pageSize,
        }
      : null;
    setView({ ...view, page: next, turn });
  };
  return (
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
        {pages > 1 && (
          <div
            className="wis-exchange__pager wis-exchange__trade-controls"
            role="group"
            aria-label="체결 페이지"
          >
            <button
              type="button"
              aria-label="이전 체결 페이지"
              disabled={page === 0}
              onClick={() => go(page - 1)}
            >
              ‹
            </button>
            <span>
              {page + 1} / {pages}
            </span>
            <button
              type="button"
              aria-label="다음 체결 페이지"
              disabled={page === pages - 1}
              onClick={() => go(page + 1)}
            >
              ›
            </button>
          </div>
        )}
      </div>
      <div
        className="wis-exchange__window wis-exchange__trade-window"
        role="region"
        aria-label="최근 학생 체결 목록"
      >
        {trades && !trades.length && (
          <p className="wis-exchange__empty">표시할 체결이 없습니다.</p>
        )}
        <ol ref={list} start={start + 1}>
          {visible.map((trade, index) => {
            const transition = view.turn;
            const flips =
              transition?.rows === pageSize && transition.flipIds.has(trade.id);
            const old = transition?.oldRows[index];
            return (
              <li
                key={trade.id}
                className={
                  flips
                    ? "wis-exchange__trade-row is-turning"
                    : "wis-exchange__trade-row"
                }
              >
                <TradeContent trade={trade} />
                {flips && (
                  <WisStockFlapFaces
                    before={old ? <TradeContent trade={old} /> : null}
                    after={<TradeContent trade={trade} />}
                  />
                )}
              </li>
            );
          })}
        </ol>
        {view.turn?.rows === pageSize &&
          view.turn.oldRows.length > visible.length && (
            <div className="wis-exchange__trade-blanks" aria-hidden="true">
              {view.turn.oldRows.slice(visible.length).map((old) => (
                <div key={old.id} className="wis-exchange__trade-blank">
                  <TradeContent trade={old} />
                  <WisStockFlapFaces
                    before={<TradeContent trade={old} />}
                    after={null}
                  />
                </div>
              ))}
            </div>
          )}
      </div>
    </section>
  );
}
