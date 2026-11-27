import {
  nextWisStockPriceTick,
  wisStockPriceSlot,
} from "../../../../../functions/wisStockMarketRules.mjs";
import type {
  ExchangeMarket,
  ExchangeQuote,
} from "../../../../lib/wisStockExchangeDisplayClient";

export type BulletinQuote = ExchangeQuote & { comparedToReceived?: boolean };
export type BulletinMarket = Omit<ExchangeMarket, "stocks"> & {
  stocks: BulletinQuote[];
};
type Item = { id: string; name: string; atMs: number };
export type StockBulletinItem = Item &
  (
    | { kind: "listing"; price: number; hasListingPrice: boolean }
    | { kind: "exit"; exit: "delist" | "merge" | "close"; price: number }
    | { kind: "previous" | "received"; percent: number }
  );
export type StockBulletin = {
  id: number;
  before: StockBulletinItem[];
  stocks: StockBulletinItem[];
};
const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
// A display computer whose clock runs a little slow must not miss an event.
const CLOCK_SKEW_MS = 120_000;
// A price move flashes briefly; a delisting or merger stays readable.
const BULLETIN_MS = 3_000;
const EXIT_BULLETIN_MS = 10_000;
/** Listings and trading ends are news all their day. */
export function isDayLongStockBulletin(kind: StockBulletinItem["kind"]) {
  return kind === "listing" || kind === "exit";
}
/** A price move is news until the next quote; a listing or exit, all its day. */
export function stockBulletinExpiresAt(
  item: Pick<StockBulletinItem, "kind" | "atMs">,
) {
  return isDayLongStockBulletin(item.kind)
    ? (Math.floor((item.atMs + KST_OFFSET_MS) / DAY_MS) + 1) * DAY_MS -
        KST_OFFSET_MS
    : nextWisStockPriceTick(item.atMs);
}
export function isWisStockBreakingMove(price: number, previousPrice: number) {
  return (
    previousPrice > 0 && Math.abs(price - previousPrice) * 10 >= previousPrice
  );
}

function eligibleItems(
  market: BulletinMarket,
  now: number,
): StockBulletinItem[] {
  const exits: StockBulletinItem[] = [];
  const listings: StockBulletinItem[] = [];
  const movements: Extract<StockBulletinItem, { percent: number }>[] = [];
  const current = (
    kind: StockBulletinItem["kind"],
    time: number | undefined,
  ): time is number =>
    time !== undefined &&
    Number.isFinite(time) &&
    time > 0 &&
    time <= now + CLOCK_SKEW_MS &&
    now < stockBulletinExpiresAt({ kind, atMs: time });
  for (const stock of market.stocks) {
    const { id, name, price, listedAtMs, priceAtMs, previousPrice } = stock;
    if (stock.exitKind && current("exit", stock.exitedAtMs)) {
      exits.push({
        kind: "exit",
        id,
        name,
        atMs: stock.exitedAtMs,
        exit: stock.exitKind,
        price,
      });
      // A closed stock has no further listing or price news.
      continue;
    }
    if (current("listing", listedAtMs)) {
      listings.push({
        kind: "listing",
        id,
        name,
        atMs: listedAtMs,
        price: stock.listingPrice ?? price,
        hasListingPrice: stock.listingPrice !== undefined,
      });
    }
    // A document refresh or yesterday's close does not establish when a price
    // moved. Only an observed tick can create a time-limited breaking headline.
    if (
      current("previous", priceAtMs) &&
      previousPrice &&
      isWisStockBreakingMove(price, previousPrice)
    ) {
      movements.push({
        kind: stock.comparedToReceived ? "received" : "previous",
        id,
        name,
        atMs: priceAtMs,
        percent: ((price - previousPrice) / previousPrice) * 100,
      });
    }
  }
  exits.sort((a, b) => b.atMs - a.atMs);
  listings.sort((a, b) => b.atMs - a.atMs);
  movements.sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent));
  return [...exits, ...listings, ...movements];
}

// Each confirmed event is announced once: a price move within its ten-minute
// quote interval and a listing once a day while this display stays open. A
// delisting or merger is announced again in every later ten-minute quote
// interval of its day, so a board that was not being watched still shows it.
export function createStockBulletinRotation(
  publish: (value: StockBulletin | null) => void,
) {
  let market: BulletinMarket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  let page: StockBulletinItem[] = [];
  const shown = new Set<string>();
  // kind:id:atMs, plus the current quote slot for a trading end.
  const key = (item: StockBulletinItem, now: number) =>
    `${item.kind}:${item.id}:${item.atMs}` +
    (item.kind === "exit" ? `:${wisStockPriceSlot(now)}` : "");

  function show(priority = new Set<string>()) {
    clearTimeout(timer);
    timer = undefined;
    if (!market || market.halted || document.hidden) {
      page = [];
      publish(null);
      return;
    }
    const now = Date.now();
    const items = eligibleItems(market, now);
    const activeKeys = new Set(items.map((item) => key(item, now)));
    for (const eventKey of shown.keys())
      if (!activeKeys.has(eventKey)) shown.delete(eventKey);
    const available = items
      .filter((item) => !shown.has(key(item, now)))
      .sort(
        (a, b) =>
          Number(priority.has(`${b.kind}:${b.id}`)) -
          Number(priority.has(`${a.kind}:${a.id}`)),
      );
    const lead = available[0];
    if (lead) {
      const before = page.filter((item) => now < stockBulletinExpiresAt(item));
      page = [lead];
      shown.add(key(lead, now));
      publish({ id: ++sequence, before, stocks: page });
      const deadline = Math.min(
        now + (lead.kind === "exit" ? EXIT_BULLETIN_MS : BULLETIN_MS),
        ...page.map((item) => stockBulletinExpiresAt(item)),
      );
      timer = setTimeout(() => show(priority), Math.max(0, deadline - now));
      return;
    }
    page = [];
    publish(null);
  }
  function clear() {
    clearTimeout(timer);
    timer = undefined;
    page = [];
    // A reconnect announces the events of the current ten minutes again, not
    // the listings or trading ends already shown earlier in the day.
    const now = Date.now();
    for (const eventKey of shown)
      if (
        !isDayLongStockBulletin(
          eventKey.split(":")[0] as StockBulletinItem["kind"],
        ) ||
        now < nextWisStockPriceTick(Number(eventKey.split(":")[2]))
      )
        shown.delete(eventKey);
    market = null;
    publish(null);
  }
  return {
    clear,
    dismiss() {
      if (!market || page.length === 0) return;
      const now = Date.now();
      for (const item of eligibleItems(market, now)) shown.add(key(item, now));
      page = [];
      show();
    },
    update(next: BulletinMarket, priority: Set<string>) {
      market = next;
      if (next.halted) {
        clear();
        return;
      }
      const now = Date.now();
      const hasNewPriority = eligibleItems(next, now).some(
        (item) =>
          priority.has(`${item.kind}:${item.id}`) && !shown.has(key(item, now)),
      );
      if (hasNewPriority || timer === undefined) show(priority);
    },
  };
}
