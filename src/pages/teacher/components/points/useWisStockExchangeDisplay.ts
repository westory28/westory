import { useEffect, useState } from "react";
import {
  watchWisStockExchange,
  type ExchangeMarket,
  type ExchangeState,
} from "../../../../lib/wisStockExchangeDisplayClient";
import type { QuotePriceTransition } from "./WisStockQuotePrice";

import {
  createStockBulletinRotation,
  type StockBulletin,
  type BulletinMarket,
  type BulletinQuote,
} from "./wisStockDisplayBulletins";

export function useWisStockExchangeDisplay(
  year: string,
  semester: string,
  classKey: string,
  retry: number,
  initial: ExchangeMarket,
) {
  const [state, setState] = useState<ExchangeState>({ status: "loading" });
  const [flips, setFlips] = useState<ReadonlyMap<string, QuotePriceTransition>>(
    new Map(),
  );
  const [bulletin, setBulletin] = useState<StockBulletin | null>(null);
  const [tradeSession, setTradeSession] = useState(0);

  useEffect(() => {
    let previous: BulletinMarket | null = null;
    let connected = false;
    let rawMarket: ExchangeMarket | null = null;
    let activeFlips = new Map<string, QuotePriceTransition>();
    const rotation = createStockBulletinRotation(setBulletin);
    const initialStocks = new Map(
      initial.stocks.map((stock) => [stock.id, stock]),
    );
    const stop = watchWisStockExchange(year, semester, classKey, (next) => {
      if (next.status === "ready" && !connected)
        setTradeSession((value) => value + 1);
      connected = next.status === "ready";
      if (next.status !== "ready") {
        previous = rawMarket = null;
        rotation.clear();
        activeFlips = new Map();
        setFlips(activeFlips);
        setState(next);
        return;
      }
      const source = next.market ?? initial;
      const livePair =
        rawMarket && rawMarket !== initial && next.market !== null;
      if (livePair && rawMarket && source.updatedAtMs < rawMarket.updatedAtMs) {
        setState({ ...next, market: rawMarket });
        return;
      }
      if (source === rawMarket) {
        setState(next);
        return;
      }
      if (rawMarket && !livePair) rotation.clear();
      rawMarket = source;
      const continuous = Boolean(
        livePair && previous && !previous.halted && !source.halted,
      );
      const newer =
        continuous &&
        previous !== null &&
        source.updatedAtMs > previous.updatedAtMs;
      const previousStocks = new Map(
        previous?.stocks.map((stock) => [stock.id, stock]),
      );
      const moves = new Map<string, QuotePriceTransition>();
      const priority = new Set<string>();
      const lastRow = Math.ceil(source.stocks.length / 2) - 1;
      const rowDelayMs = Math.min(125, 1_500 / Math.max(1, lastRow));
      const market = {
        ...source,
        stocks: source.stocks.map((stock, index) => {
          const old = previousStocks.get(stock.id);
          // Older projections may lack observations. Only compare across a
          // continuous live connection, and never infer listings on its first read.
          const changed = newer && old && old.price !== stock.price;
          const added =
            continuous && !old && (newer || stock.listedAtMs !== undefined);
          const quote: BulletinQuote = { ...stock };
          const saved = initialStocks.get(stock.id);
          if (saved && !quote.listedAtMs && saved.listedAtMs) {
            quote.listedAtMs = saved.listedAtMs;
            quote.listingPrice ??= saved.listingPrice;
          }
          if (
            saved &&
            source.updatedAtMs === initial.updatedAtMs &&
            stock.price === saved.price &&
            !quote.previousPrice
          ) {
            quote.previousPrice = saved.previousPrice;
            quote.priceAtMs = saved.priceAtMs;
          }
          if (continuous && old && !quote.listedAtMs && old.listedAtMs) {
            quote.listedAtMs = old.listedAtMs;
            quote.listingPrice ??= old.listingPrice;
          }
          if (added) {
            quote.listedAtMs ??= source.updatedAtMs;
            priority.add("listing:" + stock.id);
          }
          if (changed) {
            moves.set(stock.id, {
              from: old.price,
              to: stock.price,
              id: source.updatedAtMs,
              delayMs: Math.round(Math.floor(index / 2) * rowDelayMs),
            });
            if (!quote.previousPrice || !quote.priceAtMs) {
              quote.previousPrice = old.price;
              quote.priceAtMs = source.updatedAtMs;
              quote.comparedToReceived = true;
            }
            if (
              Math.abs(stock.price - quote.previousPrice) * 100 >=
              3 * quote.previousPrice
            )
              priority.add(
                (quote.comparedToReceived ? "received:" : "previous:") +
                  stock.id,
              );
          } else if (continuous && old && old.price === stock.price) {
            if (!quote.previousPrice || !quote.priceAtMs) {
              quote.previousPrice = old.previousPrice;
              quote.priceAtMs = old.priceAtMs;
              quote.comparedToReceived = old.comparedToReceived;
            }
            const existing = activeFlips.get(stock.id);
            if (existing) moves.set(stock.id, existing);
          }
          return quote;
        }),
      };
      activeFlips = moves;
      setFlips(moves);
      rotation.update(market, priority);
      previous = market;
      setState(next);
    });
    return () => {
      stop();
      rotation.clear();
    };
  }, [year, semester, classKey, retry, initial]);
  return { state, flips, bulletin, tradeSession };
}
