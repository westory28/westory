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
    | { kind: "previous" | "received" | "daily"; percent: number }
  );
export type StockBulletin = {
  id: number;
  before: StockBulletinItem[];
  stocks: StockBulletinItem[];
};
const day = 24 * 60 * 60 * 1000;

function eligibleItems(
  market: BulletinMarket,
  now: number,
): StockBulletinItem[] {
  const listings: StockBulletinItem[] = [];
  const movements: Extract<StockBulletinItem, { percent: number }>[] = [];
  let gainer: (typeof movements)[number] | undefined;
  let decliner: typeof gainer;
  const recent = (time: number | undefined): time is number =>
    time !== undefined && time > 0 && time <= now && now - time < day;
  for (const stock of market.stocks) {
    const {
      id,
      name,
      price,
      listedAtMs,
      priceAtMs,
      previousPrice,
      previousClose,
    } = stock;
    if (recent(listedAtMs)) {
      listings.push({
        kind: "listing",
        id,
        name,
        atMs: listedAtMs,
        price: stock.listingPrice ?? price,
        hasListingPrice: stock.listingPrice !== undefined,
      });
    }
    if (
      recent(priceAtMs) &&
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
    } else if (
      recent(market.updatedAtMs) &&
      previousClose &&
      price !== previousClose
    ) {
      const item = {
        kind: "daily" as const,
        id,
        name,
        atMs: market.updatedAtMs,
        percent: ((price - previousClose) / previousClose) * 100,
      };
      if (Math.abs(price - previousClose) * 100 >= 3 * previousClose)
        movements.push(item);
      else if (item.percent > 0 && (!gainer || item.percent > gainer.percent))
        gainer = item;
      else if (
        item.percent < 0 &&
        (!decliner || item.percent < decliner.percent)
      )
        decliner = item;
    }
  }
  if (!movements.length) {
    if (gainer) movements.push(gainer);
    if (decliner) movements.push(decliner);
  }
  listings.sort((a, b) => b.atMs - a.atMs);
  movements.sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent));
  return [...listings, ...movements];
}

// Each burst leaves the board clear after at most two pages. Least recently
// shown headlines come first in the next burst, including on a quiet market.
export function createStockBulletinRotation(
  publish: (value: StockBulletin | null) => void,
) {
  let market: BulletinMarket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  let page: StockBulletinItem[] = [];
  let pagesInBurst = 0;
  const shown = new Map<string, number>();
  const inBurst = new Set<string>();
  const key = (item: StockBulletinItem) => item.kind + ":" + item.id;
  function rest() {
    page = [];
    pagesInBurst = 0;
    inBurst.clear();
    publish(null);
    timer = setTimeout(show, 16_000);
  }
  function show(priority = new Set<string>()) {
    timer = undefined;
    if (!market || market.halted || document.hidden) return;
    const items = eligibleItems(
      market,
      Math.max(Date.now(), market.updatedAtMs),
    );
    const available = items
      .filter((item) => !inBurst.has(key(item)))
      .sort((a, b) => {
        const aPriority = priority.has(key(a));
        const bPriority = priority.has(key(b));
        if (aPriority || bPriority)
          return Number(bPriority) - Number(aPriority);
        return (shown.get(key(a)) ?? 0) - (shown.get(key(b)) ?? 0);
      });
    const lead = available[0];
    if (!lead) {
      if (page.length) rest();
      else publish(null);
      return;
    }
    const before = page;
    page = available.filter((item) => item.kind === lead.kind).slice(0, 2);
    sequence++;
    for (const item of page) {
      shown.set(key(item), sequence);
      inBurst.add(key(item));
    }
    publish({ id: sequence, before, stocks: page });
    const more = available.length > page.length;
    pagesInBurst++;
    timer = setTimeout(
      more && pagesInBurst < 2 ? () => show(priority) : rest,
      more || pagesInBurst > 1 ? 4_000 : 8_000,
    );
  }
  function clear() {
    clearTimeout(timer);
    timer = undefined;
    page = [];
    pagesInBurst = 0;
    inBurst.clear();
    shown.clear();
    market = null;
    publish(null);
  }
  return {
    clear,
    update(next: BulletinMarket, priority: Set<string>) {
      market = next;
      if (next.halted) {
        clear();
        return;
      }
      if (priority.size) {
        clearTimeout(timer);
        inBurst.clear();
        pagesInBurst = 0;
        page = [];
        show(priority);
      } else if (timer === undefined) show();
    },
  };
}
