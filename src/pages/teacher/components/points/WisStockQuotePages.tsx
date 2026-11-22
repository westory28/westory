import { useEffect, useRef, useState } from "react";
import type { ExchangeQuote } from "../../../../lib/wisStockExchangeDisplayClient";
import WisStockQuotePrice, {
  type QuotePriceTransition,
} from "./WisStockQuotePrice";
import { Movement } from "./WisStockMovement";
import WisStockFlapFaces from "./WisStockFlapFaces";
import "./WisStockQuotePages.css";

const pageIntervalMs = 8_000;
const rowDelay = (row: number, rows: number) =>
  Math.round(row * Math.min(110, 700 / Math.max(1, rows - 1)));

function QuoteFace({
  stock,
  flip,
}: {
  stock?: ExchangeQuote;
  flip?: QuotePriceTransition;
}) {
  // A stock coming onto the board starts at its latest price.
  const [initialTick] = useState(flip?.id);
  if (!stock) return null;
  return (
    <>
      <strong className="wis-exchange__quote-name">{stock.name}</strong>
      <div className="wis-exchange__quote-values">
        <span className="wis-exchange__quote-price">
          <WisStockQuotePrice
            price={stock.price}
            transition={flip?.id === initialTick ? undefined : flip}
          />
        </span>
        <span className="sr-only">전일 대비 </span>
        <Movement price={stock.price} previous={stock.previousClose} />
      </div>
    </>
  );
}

type PageTurn = { first: number; previous?: ExchangeQuote[] };

export default function WisStockQuotePages({
  stocks,
  flips,
  rows,
  active,
}: {
  stocks: ExchangeQuote[] | undefined;
  flips: ReadonlyMap<string, QuotePriceTransition>;
  rows: number;
  active: boolean;
}) {
  const size = 2 * Math.max(1, rows);
  const pages = Math.ceil((stocks?.length ?? 0) / size);
  const [turn, setTurn] = useState<PageTurn>({ first: 0 });
  const [paused, setPaused] = useState(false);
  const total = stocks?.length ?? 0;
  const start = turn.first < total ? turn.first : Math.max(0, pages - 1) * size;
  const current = stocks?.slice(start, start + size) ?? [];
  const previous = active && start === turn.first ? turn.previous : undefined;
  const slots = Math.min(size, Math.max(current.length, previous?.length ?? 0));
  const visibleRows = Math.ceil(slots / 2);
  const nextPage = (step: number) => {
    if (!active || document.hidden || pages < 2) return;
    const destination =
      step > 0
        ? start + size >= total
          ? 0
          : start + size
        : start === 0
          ? (pages - 1) * size
          : Math.max(0, start - size);
    setTurn({
      first: destination,
      previous: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? undefined
        : current,
    });
  };
  const next = useRef(nextPage);
  next.current = nextPage;

  useEffect(() => {
    if (!active || paused || pages < 2) return;
    // Live trade and quote updates do not restart the reading interval.
    const timer = window.setTimeout(() => next.current(1), pageIntervalMs);
    return () => window.clearTimeout(timer);
  }, [active, start, pages, paused, size]);

  useEffect(() => {
    if (!turn.previous) return;
    if (!previous) {
      setTurn({ first: start });
      return;
    }
    const settle = window.setTimeout(
      () => {
        setTurn((latest) =>
          latest === turn ? { first: latest.first } : latest,
        );
      },
      420 + rowDelay(Math.max(0, visibleRows - 1), visibleRows),
    );
    return () => window.clearTimeout(settle);
  }, [turn, previous, visibleRows, start]);

  return (
    <section
      className="wis-exchange__quotes"
      aria-labelledby="wis-exchange-quotes"
    >
      <div className="wis-exchange__heading wis-exchange__quote-heading">
        <h3 id="wis-exchange-quotes">종목 시세</h3>
        {pages > 1 && (
          <div
            className="wis-exchange__pager wis-exchange__quote-controls"
            role="group"
            aria-label="종목 페이지"
          >
            <button
              type="button"
              aria-label="이전 종목 페이지"
              title="이전 종목 페이지"
              onClick={() => nextPage(-1)}
            >
              ‹
            </button>
            <span
              className="wis-exchange__quote-page"
              aria-label={`전체 ${total}종목 중 ${start + 1}번째부터 ${start + current.length}번째까지`}
            >
              {start + 1}–{start + current.length}/{total}
            </span>
            <button
              type="button"
              aria-label="다음 종목 페이지"
              title="다음 종목 페이지"
              onClick={() => nextPage(1)}
            >
              ›
            </button>
            <button
              type="button"
              aria-label={
                paused ? "종목 자동 넘김 재생" : "종목 자동 넘김 일시정지"
              }
              title={paused ? "자동 넘김 재생" : "자동 넘김 일시정지"}
              onClick={() => setPaused(!paused)}
            >
              <span
                aria-hidden="true"
                className={paused ? "wis-ticker-play" : "wis-ticker-pause"}
              />
            </button>
          </div>
        )}
        <span>
          현재가 · 전일 대비 <b>단위 위스</b>
        </span>
      </div>
      <div
        className="wis-exchange__quote-window wis-exchange__window"
        role="region"
        aria-label="종목 시세 목록"
      >
        <ul className="wis-exchange__quote-grid">
          {Array.from({ length: slots }, (_, index) => {
            const stock = current[index];
            const old = previous?.[index];
            const delayMs = rowDelay(Math.floor(index / 2), visibleRows);
            const tick = stock && flips.get(stock.id);
            return (
              <li
                key={index}
                data-quote-id={stock?.id}
                aria-hidden={stock ? undefined : true}
              >
                <div className="wis-ticker-tile">
                  <div className="wis-ticker-tile__current">
                    <QuoteFace
                      key={stock?.id}
                      stock={stock}
                      flip={tick && { ...tick, delayMs }}
                    />
                  </div>
                  {previous && old?.id !== stock?.id && (
                    <div
                      key={start}
                      className="wis-ticker-tile__turn"
                      aria-hidden="true"
                    >
                      <div className="wis-ticker-tile__outgoing">
                        <QuoteFace stock={old} />
                      </div>
                      <WisStockFlapFaces
                        before={<QuoteFace stock={old} />}
                        after={<QuoteFace stock={stock} />}
                        delayMs={delayMs}
                      />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {stocks && !stocks.length && (
          <p className="wis-exchange__empty">상장된 종목이 없습니다.</p>
        )}
      </div>
    </section>
  );
}
