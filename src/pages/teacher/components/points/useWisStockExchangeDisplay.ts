import { useEffect, useState } from "react";
import {
  watchWisStockExchange,
  type ExchangeMarket,
  type ExchangeState,
} from "../../../../lib/wisStockExchangeDisplayClient";
import type { QuotePriceTransition } from "./WisStockQuotePrice";

type Surge = { id: string; name: string; percent: number };
const surgePercent = 5;
const surgeDurationMs = 8_000;

export function useWisStockExchangeDisplay(
  year: string,
  semester: string,
  classKey: string,
  retry: number,
) {
  const [state, setState] = useState<ExchangeState>({ status: "loading" });
  const [flips, setFlips] = useState<ReadonlyMap<string, QuotePriceTransition>>(
    new Map(),
  );
  const [surges, setSurges] = useState<Surge[]>([]);

  useEffect(() => {
    let previous: ExchangeMarket | null = null;
    let activeFlips = new Map<string, QuotePriceTransition>();
    let surgeTimer: ReturnType<typeof setTimeout> | undefined;

    const clearEffects = () => {
      activeFlips = new Map();
      setFlips(activeFlips);
      clearTimeout(surgeTimer);
      setSurges([]);
    };
    const stop = watchWisStockExchange(year, semester, classKey, (next) => {
      if (next.status !== "ready" || !next.market) {
        previous = null;
        clearEffects();
        setState(next);
        return;
      }
      const market = next.market;
      if (previous && market.updatedAtMs < previous.updatedAtMs) {
        setState({ ...next, market: previous });
        return;
      }
      // Trade-only snapshots share the last confirmed market object.
      if (!previous || market.halted !== previous.halted) {
        clearEffects();
      } else if (!market.halted && market.updatedAtMs > previous.updatedAtMs) {
        const lastPrices = new Map(
          previous.stocks.map((stock) => [stock.id, stock.price]),
        );
        const moves = new Map<string, QuotePriceTransition>();
        const rising: Surge[] = [];
        const lastRow = Math.ceil(market.stocks.length / 2) - 1;
        const rowDelayMs = Math.min(125, 1_500 / Math.max(1, lastRow));
        market.stocks.forEach((stock, index) => {
          const from = lastPrices.get(stock.id);
          if (from === undefined) return;
          if (from === stock.price) {
            const existing = activeFlips.get(stock.id);
            if (existing) moves.set(stock.id, existing);
            return;
          }
          moves.set(stock.id, {
            from,
            to: stock.price,
            id: market.updatedAtMs,
            delayMs: Math.round(Math.floor(index / 2) * rowDelayMs),
          });
          const percent = ((stock.price - from) / from) * 100;
          if (percent >= surgePercent)
            rising.push({ id: stock.id, name: stock.name, percent });
        });
        activeFlips = moves;
        setFlips(moves);
        if (rising.length) {
          clearTimeout(surgeTimer);
          setSurges(rising.sort((a, b) => b.percent - a.percent));
          surgeTimer = setTimeout(() => setSurges([]), surgeDurationMs);
        }
      }
      previous = market;
      setState(next);
    });
    return () => {
      stop();
      clearTimeout(surgeTimer);
    };
  }, [year, semester, classKey, retry]);
  return { state, flips, surges };
}
