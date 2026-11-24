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
    | { kind: "previous" | "received"; percent: number }
  );
export type StockBulletin = {
  id: number;
  before: StockBulletinItem[];
  stocks: StockBulletinItem[];
};
const slotMs = 30 * 60 * 1000;
const repeatMs = 10 * 60 * 1000;
export const stockBulletinExpiresAt = (atMs: number) =>
  (Math.floor(atMs / slotMs) + 1) * slotMs;

function eligibleItems(
  market: BulletinMarket,
  now: number,
): StockBulletinItem[] {
  const listings: StockBulletinItem[] = [];
  const movements: Extract<StockBulletinItem, { percent: number }>[] = [];
  const current = (time: number | undefined): time is number =>
    time !== undefined &&
    Number.isFinite(time) &&
    time > 0 &&
    time <= now &&
    now < stockBulletinExpiresAt(time);
  for (const stock of market.stocks) {
    const { id, name, price, listedAtMs, priceAtMs, previousPrice } = stock;
    if (current(listedAtMs)) {
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
      current(priceAtMs) &&
      previousPrice &&
      Math.abs(price - previousPrice) * 100 >= 3 * previousPrice
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
  listings.sort((a, b) => b.atMs - a.atMs);
  movements.sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent));
  return [...listings, ...movements];
}

// Local deadlines only: each event is announced on receipt, then at its next
// ten-minute marks, and never beyond its original half-hour market slot.
export function createStockBulletinRotation(
  publish: (value: StockBulletin | null) => void,
) {
  let market: BulletinMarket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  let page: StockBulletinItem[] = [];
  const shown = new Map<string, number>();
  const key = (item: StockBulletinItem) =>
    `${item.kind}:${item.id}:${item.atMs}`;
  const occurrence = (item: StockBulletinItem, now: number) =>
    Math.floor((now - item.atMs) / repeatMs);

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
    const activeKeys = new Set(items.map(key));
    for (const eventKey of shown.keys())
      if (!activeKeys.has(eventKey)) shown.delete(eventKey);
    const available = items
      .filter((item) => shown.get(key(item)) !== occurrence(item, now))
      .sort(
        (a, b) =>
          Number(priority.has(`${b.kind}:${b.id}`)) -
          Number(priority.has(`${a.kind}:${a.id}`)),
      );
    const lead = available[0];
    if (lead) {
      const before = page.filter(
        (item) => now < stockBulletinExpiresAt(item.atMs),
      );
      page = [lead];
      for (const item of page) shown.set(key(item), occurrence(item, now));
      publish({ id: ++sequence, before, stocks: page });
      const deadline = Math.min(
        now + 3_000,
        ...page.map((item) => stockBulletinExpiresAt(item.atMs)),
      );
      timer = setTimeout(() => show(priority), Math.max(0, deadline - now));
      return;
    }
    page = [];
    publish(null);
    const deadlines = items
      .map((item) => item.atMs + (occurrence(item, now) + 1) * repeatMs)
      .filter((time) => time > now && time < stockBulletinExpiresAt(now));
    if (deadlines.length)
      timer = setTimeout(show, Math.min(...deadlines) - now);
  }
  function clear() {
    clearTimeout(timer);
    timer = undefined;
    page = [];
    shown.clear();
    market = null;
    publish(null);
  }
  return {
    clear,
    dismiss() {
      if (!market || page.length === 0) return;
      const now = Date.now();
      // Dismiss the whole current round, including its queued pages. The next
      // ten-minute occurrence and genuinely new market events remain eligible.
      for (const item of eligibleItems(market, now))
        shown.set(key(item), occurrence(item, now));
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
          priority.has(`${item.kind}:${item.id}`) &&
          shown.get(key(item)) !== occurrence(item, now),
      );
      if (hasNewPriority || timer === undefined) show(priority);
    },
  };
}
