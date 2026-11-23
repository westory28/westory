import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ExchangeQuote } from "../../../../lib/wisStockExchangeDisplayClient";
import WisStockQuotePrice, {
  type QuotePriceTransition,
} from "./WisStockQuotePrice";
import { Movement } from "./WisStockMovement";
import WisStockFlapFaces from "./WisStockFlapFaces";
import WisStockQuoteHelp from "./WisStockQuoteHelp";
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
  const slots = Math.min(size, total);
  const visibleRows = Math.ceil(slots / 2);
  const measureGrid = useRef<HTMLUListElement>(null);
  const visibleGrid = useRef<HTMLUListElement>(null);
  const dimensions = useRef({ width: 0, viewport: 0, row: 0, name: 0 });
  useLayoutEffect(() => {
    const source = measureGrid.current!;
    const target = visibleGrid.current!;
    const measure = () => {
      if (!source.clientWidth || !source.children.length) return;
      const sameSize =
        dimensions.current.width === source.clientWidth &&
        dimensions.current.viewport === window.innerHeight;
      const cells = Array.from(source.children);
      const nameHeight = (cell: Element) =>
        cell.querySelector(".wis-exchange__quote-name")!.getBoundingClientRect()
          .height;
      const name = Math.max(
        sameSize ? dimensions.current.name : 0,
        ...cells.map(nameHeight),
      );
      const row = Math.ceil(
        Math.max(
          sameSize ? dimensions.current.row : 0,
          ...cells.map(
            (cell) =>
              cell.getBoundingClientRect().height + name - nameHeight(cell),
          ),
        ),
      );
      dimensions.current = {
        width: source.clientWidth,
        viewport: window.innerHeight,
        row,
        name,
      };
      target.style.gridAutoRows = `${row}px`;
      target.style.setProperty("--wis-quote-name-height", `${name}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(source);
    for (const cell of source.children) observer.observe(cell);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [stocks]);
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
      previous: current,
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
        <div className="wis-exchange__quote-title">
          <h3 id="wis-exchange-quotes">종목 시세</h3>
          <WisStockQuoteHelp />
        </div>
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
              {Math.floor(start / size) + 1}/{pages}
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
      </div>
      <div
        className="wis-exchange__quote-window wis-exchange__window"
        role="region"
        aria-label="종목 시세 목록"
      >
        <ul ref={visibleGrid} className="wis-exchange__quote-grid">
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
        <ul
          ref={measureGrid}
          className="wis-exchange__quote-grid wis-exchange__quote-measure"
          aria-hidden="true"
        >
          {stocks?.map((stock) => (
            <li key={stock.id}>
              <QuoteFace stock={stock} />
            </li>
          ))}
        </ul>
        {stocks && !stocks.length && (
          <p className="wis-exchange__empty">상장된 종목이 없습니다.</p>
        )}
      </div>
    </section>
  );
}
