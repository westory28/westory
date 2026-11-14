import catalog from "../data/wisStockCatalog.json";
import { nextWisStockModelPrice } from "../../functions/wisStockPriceModel.mjs";
import { wisStockDailyBounds } from "../../functions/wisStockMarketRules.mjs";
import type { WisStock, WisStockSettings } from "./wisStocksClient";

export interface WisStockCatalogEntry {
  /** Valid preview-order identifier; sourceId retains the planning document ID. */
  id: string;
  sourceId: string;
  name: string;
  week: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  sector: string;
  tagline: string;
  fact: string;
  riseReason: string;
  fallReason: string;
  exitKind: "survive" | "merge" | "delist";
  exitReason: string;
  sourceTitle: string;
  sourceUrls: string[];
  sourceKind: string;
  sourceNote: string;
  logoUrl: string;
  logoConcept: string;
  acronym: string;
  listingSession: number;
  riseSession: number;
  fallSession: number;
  exitSession: number | null;
  growthProfile: "HISTORICAL" | "VALUE";
  basePrice: number;
}

export interface WisStockPlanSession {
  session: number;
  week: number;
  dayIndex: number;
  hourKst: number;
  atMs: number;
  label: string;
}

export interface WisStockSyntheticPoint extends WisStockPlanSession {
  /** Null means not listed yet or already exited, never a fabricated zero. */
  price: number | null;
  phase: "unlisted" | "steady" | "rise" | "fall" | "recovery" | "exited";
}

export const wisStockCatalogWeeks: readonly string[] = Object.freeze([
  "구석기~고조선",
  "삼국 시대",
  "통일신라와 발해",
  "후삼국과 고려",
  "조선 전기~왜란·호란",
  "붕당·탕평과 조선 후기 상업",
]);

export const wisStockCatalog: readonly WisStockCatalogEntry[] = Object.freeze(
  (catalog as WisStockCatalogEntry[]).map((entry) => Object.freeze(entry)),
);

const byId = new Map(wisStockCatalog.map((entry) => [entry.id, entry]));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const WIS_STOCK_PLAN_DAILY_LIMIT_BPS = 3000;
// A fixed teaching timeline, not current time or a live market timetable.
const EXAMPLE_MONDAY = Date.UTC(2026, 10, 16, 0);
export const wisStockPlanSessions: readonly WisStockPlanSession[] =
  Object.freeze(
    Array.from({ length: 210 }, (_, index) => {
      const day = Math.floor(index / 7);
      const week = Math.floor(day / 5);
      const dayIndex = day % 5;
      const hour = index % 7;
      return Object.freeze({
        session: index + 1,
        week: week + 1,
        dayIndex,
        hourKst: hour + 9,
        atMs: EXAMPLE_MONDAY + (week * 7 + dayIndex) * DAY + hour * HOUR,
        label: `${week + 1}주 ${["월", "화", "수", "목", "금"][dayIndex]} ${hour + 9}:00`,
      });
    }),
  );

function findEntry(id: string): WisStockCatalogEntry {
  const entry = byId.get(id);
  if (!entry) throw new RangeError("기획 목록에 없는 종목입니다.");
  return entry;
}

/** An individual, editable registration draft. This never submits anything. */
export function getWisStockTemplateSettings(id: string): WisStockSettings {
  const entry = findEntry(id);
  return {
    name: entry.name,
    period: entry.week
      ? wisStockCatalogWeeks[entry.week - 1]
      : "상시 가치 종목",
    description: `${entry.tagline}\n${entry.fact}`,
    initialPrice: entry.basePrice,
    minimumPrice: 1,
    maximumPrice: 1_000_000,
    volatilityBps: entry.growthProfile === "VALUE" ? 180 : 300,
    trendBps: entry.growthProfile === "VALUE" ? 35 : 0,
    intervalHours: 1,
    automatic: false,
    growthProfile: entry.growthProfile,
    issuedShares: 100_000,
    lotSize: 1,
    tradingStatus: "ACTIVE",
  };
}

function phaseFor(
  entry: WisStockCatalogEntry,
  session: number,
): WisStockSyntheticPoint["phase"] {
  if (session < entry.listingSession) return "unlisted";
  if (entry.exitSession !== null && session > entry.exitSession)
    return "exited";
  if (session >= entry.fallSession && session < entry.fallSession + 10)
    return "fall";
  if (session >= entry.fallSession + 10) return "recovery";
  if (
    session >= entry.riseSession &&
    session < Math.min(entry.fallSession, entry.riseSession + 14)
  )
    return "rise";
  return "steady";
}

const histories = new Map<string, readonly WisStockSyntheticPoint[]>();

/** Reproducible synthetic data, kept separate from the management API history. */
export function getWisStockPlanHistory(id: string): WisStockSyntheticPoint[] {
  const entry = findEntry(id);
  const cached = histories.get(id);
  if (cached) return cached.map((point) => ({ ...point }));
  const settings = getWisStockTemplateSettings(id);
  const first = wisStockPlanSessions[entry.listingSession - 1];
  const stock: WisStock = {
    id,
    settings,
    price: settings.initialPrice,
    updatedAtMs: first.atMs,
    nextTickAtMs: 0,
    priceModel: {
      version: 1,
      anchorAtMs: first.atMs,
      anchorPrice: settings.initialPrice,
    },
    history: [],
  };
  let currentDay = "";
  let dayOpenPrice = stock.price;
  const points = wisStockPlanSessions.map((session) => {
    const phase = phaseFor(entry, session.session);
    if (phase === "unlisted" || phase === "exited")
      return { ...session, phase, price: null };
    const day = `${session.week}-${session.dayIndex}`;
    if (day !== currentDay) {
      currentDay = day;
      dayOpenPrice = stock.price;
    }
    const value = entry.growthProfile === "VALUE";
    let trend = settings.trendBps;
    if (phase === "rise") {
      // News changes drift for several sessions, not a one-point forced spike.
      const ramp = Math.min(1, (session.session - entry.riseSession + 1) / 4);
      trend = Math.round(trend + (value ? 35 : 140) * ramp);
    } else if (phase === "fall") {
      const ramp = Math.min(1, (session.session - entry.fallSession + 1) / 3);
      trend = Math.round(trend - (value ? 110 : 190) * ramp);
    } else if (phase === "recovery" && !value)
      trend = entry.exitKind === "survive" ? 16 : -30;
    stock.settings = { ...settings, trendBps: trend };
    if (session.session !== entry.listingSession) {
      const candidate = nextWisStockModelPrice(
        stock,
        "wispi-teacher-plan",
        session.atMs / HOUR,
        "wispi-plan-80-v1",
      );
      const bounds = wisStockDailyBounds(
        dayOpenPrice,
        WIS_STOCK_PLAN_DAILY_LIMIT_BPS,
      );
      stock.price = Math.max(
        bounds.minimum,
        Math.min(bounds.maximum, candidate),
      );
    }
    stock.updatedAtMs = session.atMs;
    stock.history.push({ atMs: session.atMs, price: stock.price });
    return { ...session, phase, price: stock.price };
  });
  histories.set(
    id,
    points.map((point) => Object.freeze(point)),
  );
  return points.map((point) => ({ ...point }));
}

/** Teacher planning preview only. No API, wallet access, registration or timer. */
export function createWisStockPlanStocks(): WisStock[] {
  return wisStockCatalog.map((entry) => {
    const settings = getWisStockTemplateSettings(entry.id);
    const history = getWisStockPlanHistory(entry.id)
      .filter(
        (point): point is WisStockSyntheticPoint & { price: number } =>
          point.price !== null,
      )
      .map(({ atMs, price }) => ({ atMs, price }));
    const last = history[history.length - 1];
    return {
      id: entry.id,
      settings: {
        ...settings,
        tradingStatus: entry.exitSession === null ? "ACTIVE" : "HALTED",
      },
      price: last.price,
      updatedAtMs: last.atMs,
      nextTickAtMs: 0,
      haltedUntilMs: 0,
      priceModel: {
        version: 1,
        anchorAtMs: history[0].atMs,
        anchorPrice: settings.initialPrice,
      },
      history,
    };
  });
}
