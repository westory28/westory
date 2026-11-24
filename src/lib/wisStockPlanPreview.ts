import { nextWisStockModelPrice } from "../../functions/wisStockPriceModel.mjs";
import {
  isWisStockTradingSession,
  normalizeWisStockMarketRules,
  wisStockDailyBounds,
  wisStockKstSession,
  wisStockPriceSlot,
  WIS_STOCK_PRICE_INTERVAL_MS,
} from "../../functions/wisStockMarketRules.mjs";
import {
  getWisStockTemplateSettings,
  wisStockCatalog,
  wisStockPlanSessions,
} from "./wisStockCatalog";
import type { WisStock, WisStockMarketRules } from "./wisStocksClient";
import {
  catalogSessionAtMs,
  catalogExitAtMs,
  type WisStockCatalogPlan,
} from "../../functions/wisStockCatalogTimeline.mjs";

const DAY = 86_400_000;
const EXAMPLE_START = wisStockPlanSessions[0].atMs;
const PREVIEW_SEED = "wispi-unlisted-plan-v2";

// A public, reproducible example draw. Production's private price seed is never
// returned to the browser, and an unlisted example is not a future quote.
function exampleOpeningPrice(id: string, semesterId: string) {
  let hash = 2166136261;
  for (const char of `${semesterId}:${id}`)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return 100 + ((hash >>> 0) % 401);
}

// Catalog identity and editable settings suffice for the list and the empty
// demo portfolio. Model prices are calculated only for an opened example.
function planDraft(id: string, semesterId: string): WisStock {
  const initialPrice = exampleOpeningPrice(id, semesterId);
  return {
    id,
    settings: {
      ...getWisStockTemplateSettings(id),
      initialPrice,
      automatic: true,
    },
    price: initialPrice,
    updatedAtMs: 0,
    nextTickAtMs: 0,
    haltedUntilMs: 0,
    history: [],
  };
}
export const wisStockPlanDrafts = (semesterId: string) =>
  wisStockCatalog.map((entry) => planDraft(entry.id, semesterId));

/** Local scenario only: called when saved rules/start/semester change, no I/O,
 * timer, wall clock, persisted cache, or production history mutation. */
export function createWisStockRulePlanStocks(
  input: WisStockMarketRules,
  semesterId: string,
  plan: WisStockCatalogPlan = { version: 1, startsAtMs: EXAMPLE_START },
  stockId?: string,
): WisStock[] {
  const rules = normalizeWisStockMarketRules(input);
  const { startsAtMs } = plan;
  const planEnd = startsAtMs + 42 * DAY;
  const sessions: number[] = [];
  for (
    let atMs =
      Math.ceil(startsAtMs / WIS_STOCK_PRICE_INTERVAL_MS) *
      WIS_STOCK_PRICE_INTERVAL_MS;
    atMs < planEnd;
    atMs += WIS_STOCK_PRICE_INTERVAL_MS
  ) {
    if (isWisStockTradingSession(rules, atMs)) sessions.push(atMs);
  }
  const entries = stockId
    ? wisStockCatalog.filter((entry) => entry.id === stockId)
    : wisStockCatalog;
  return entries.map((entry) => {
    const listingAt = catalogSessionAtMs(entry.listingSession, startsAtMs);
    const exitAt = catalogExitAtMs(entry, plan) ?? planEnd;
    const available = sessions.filter(
      (atMs) => atMs >= listingAt && atMs <= exitAt,
    );
    const stock = planDraft(entry.id, semesterId);
    const { settings, price: initialPrice } = stock;
    const firstAt = available[0] ?? listingAt;
    stock.updatedAtMs = firstAt;
    stock.priceModel = {
      version: 1,
      anchorAtMs: firstAt,
      anchorPrice: initialPrice,
    };
    if (available.length)
      stock.history.push({ atMs: firstAt, price: initialPrice });
    let dayKey = "";
    let dayOpenPrice = initialPrice;
    if (rules.automaticPrices && !rules.halted) {
      for (const atMs of available.slice(1)) {
        if ((stock.haltedUntilMs || 0) > atMs) continue;
        const session = wisStockKstSession(atMs);
        if (dayKey !== session.dayKey) {
          dayKey = session.dayKey;
          dayOpenPrice = stock.price;
        }
        const bounds = wisStockDailyBounds(
          dayOpenPrice,
          rules.dailyPriceLimitBps,
        );
        const price = Math.max(
          settings.minimumPrice,
          bounds.minimum,
          Math.min(
            settings.maximumPrice,
            bounds.maximum,
            nextWisStockModelPrice(
              stock,
              semesterId,
              wisStockPriceSlot(atMs),
              PREVIEW_SEED,
              undefined,
              rules.dailyPriceLimitBps,
              { atMs },
            ),
          ),
        );
        const resuming =
          (stock.haltedUntilMs || 0) > 0 && (stock.haltedUntilMs || 0) <= atMs;
        if (
          !resuming &&
          Math.abs(price - stock.price) * 10000 >=
            stock.price * rules.circuitBreakerBps
        ) {
          stock.haltedUntilMs = atMs + rules.circuitBreakerMinutes * 60_000;
          continue;
        }
        if (price === stock.price) continue;
        stock.price = price;
        stock.updatedAtMs = atMs;
        stock.haltedUntilMs = 0;
        stock.history.push({ atMs, price });
      }
    }
    stock.settings = {
      ...settings,
      tradingStatus: entry.exitSession === null ? "ACTIVE" : "HALTED",
    };
    return stock;
  });
}

/** Keep each registered object intact. Never append synthetic future prices to
 * real observations. Exact names support individually registered catalog drafts. */
export function matchWisStockPlanStocks(
  plan: WisStock[],
  registered: WisStock[],
) {
  const byId = new Map(registered.map((stock) => [stock.id, stock]));
  const byName = new Map<string, WisStock[]>();
  for (const stock of registered) {
    const name = stock.settings.name.trim();
    byName.set(name, [...(byName.get(name) || []), stock]);
  }
  return plan.map((example) => {
    const exact = byId.get(example.id);
    const names = byName.get(example.settings.name);
    return exact || (names?.length === 1 ? names[0] : example);
  });
}
