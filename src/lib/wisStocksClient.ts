import { auth } from "./firebase";
import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { getYearSemester } from "./semesterScope";
import { ensureSensitiveOperation } from "./sensitiveOperation";
import type { SystemConfig } from "../types";
import type { WisStockMarketRules } from "../../functions/wisStockMarketRules.mjs";
import type { WisStockCatalogPlan } from "../../functions/wisStockCatalogTimeline.mjs";
export type { WisStockMarketRules } from "../../functions/wisStockMarketRules.mjs";

export type WisStockConfig =
  | Pick<SystemConfig, "year" | "semester">
  | null
  | undefined;
export interface WisStockSettings {
  name: string;
  description: string;
  period: string;
  initialPrice: number;
  minimumPrice: number;
  maximumPrice: number;
  volatilityBps: number;
  trendBps: number;
  /** Retained in saved settings for compatibility. The live market uses 10-minute slots. */
  intervalHours: number;
  automatic: boolean;
  issuedShares: number;
  lotSize: number;
  tradingStatus: "ACTIVE" | "HALTED" | "SELL_ONLY" | "GRADUATED";
  growthProfile?: "HISTORICAL" | "VALUE";
}
export interface WisStock {
  id: string;
  settings: WisStockSettings;
  price: number;
  updatedAtMs: number;
  nextTickAtMs: number;
  haltedUntilMs?: number;
  priceModel?: { version: 1; anchorAtMs: number; anchorPrice: number };
  history: { atMs: number; price: number }[];
}
export interface WisStockManagement {
  semesterId: string;
  revision: number;
  studentOpen: boolean;
  maxStocks: number;
  historyLimit: number;
  updatedAtMs: number;
  stocks: WisStock[];
  rules: WisStockMarketRules;
  specialSessions?: WisStockSpecialSession[];
  marketIndex?: WisStockMarketIndex;
  catalogSchedule?: {
    plan: WisStockCatalogPlan | null;
    totalCount: number;
    listedCount: number;
    pendingCount: number;
    dueCount: number;
    nextListingAtMs: number | null;
  };
}
export interface WisStockSpecialSession {
  dayKey: string;
  label: string;
  changeBps: number;
}
export interface WisStockForecast {
  semesterId: string;
  stockId: string;
  revision: number;
  asOfMs: number;
  startsAtMs: number;
  endsAtMs: number;
  history: WisStock["history"];
  specialSessions: WisStockSpecialSession[];
}
const validTimestamp = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 8_639_999_999_999_999;
export interface WisStockMarketIndex {
  baseValue: 1000;
  baseAtMs: number;
  value: number;
  previousClose: number;
  updatedAtMs: number;
  history: { atMs: number; value: number }[];
}
type SaveResult = WisStockManagement & {
  savedStockId: string;
  changed: boolean;
  duplicate: boolean;
};
const flights = new Map<string, Promise<WisStockManagement>>();
const pending = new Map<string, string>();
const changedOwner = () =>
  new Error("로그인 계정이 바뀌었습니다. 화면을 다시 열어 주세요.");
async function service<T>(
  name: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const owner = auth.currentUser;
  if (!owner) throw changedOwner();
  const epoch = Number((await owner.getIdTokenResult()).claims.auth_time);
  if (auth.currentUser !== owner || !Number.isFinite(epoch))
    throw changedOwner();
  const call = await getHistoryDictionaryCallable<Record<string, unknown>, T>(
    name,
  );
  if (auth.currentUser !== owner) throw changedOwner();
  const result = await call(payload);
  if (
    auth.currentUser !== owner ||
    Number((await owner.getIdTokenResult()).claims.auth_time) !== epoch
  )
    throw changedOwner();
  return result.data;
}
export { service as callWisStockService };
export function getWisStockManagement(
  config: WisStockConfig,
): Promise<WisStockManagement>;
export function getWisStockManagement(
  config: WisStockConfig,
  forecastStockId: string,
): Promise<WisStockForecast>;
export async function getWisStockManagement(
  config: WisStockConfig,
  forecastStockId?: string,
) {
  const scope = getYearSemester(config);
  if (forecastStockId !== undefined) {
    const forecast = await service<WisStockForecast>("getWisStockManagement", {
      ...scope,
      forecastStockId,
    });
    if (
      forecast?.stockId !== forecastStockId ||
      forecast.semesterId !== `${scope.year}-${scope.semester}` ||
      !validTimestamp(forecast.asOfMs) ||
      !validTimestamp(forecast.endsAtMs) ||
      !Array.isArray(forecast.history) ||
      forecast.history.some(
        (point, i) =>
          !validTimestamp(point?.atMs) ||
          point.atMs <= forecast.asOfMs ||
          point.atMs >= forecast.endsAtMs ||
          (i > 0 && point.atMs <= forecast.history[i - 1].atMs) ||
          !Number.isSafeInteger(point.price) ||
          point.price <= 0,
      ) ||
      !Array.isArray(forecast.specialSessions)
    )
      throw new Error("예정 시세를 확인하지 못했습니다. 다시 조회해 주세요.");
    return forecast;
  }
  const owner = auth.currentUser;
  if (!owner) throw changedOwner();
  const epoch = Number((await owner.getIdTokenResult()).claims.auth_time);
  if (auth.currentUser !== owner || !Number.isFinite(epoch))
    throw changedOwner();
  const key = `${owner.uid}:${epoch}:${scope.year}:${scope.semester}`;
  const existing = flights.get(key);
  if (existing) return existing;
  const task = service<WisStockManagement>(
    "getWisStockManagement",
    scope,
  ).finally(() => {
    if (flights.get(key) === task) flights.delete(key);
  });
  flights.set(key, task);
  return task;
}
export async function saveWisStock(
  config: WisStockConfig,
  expectedRevision: number,
  stockId: string,
  settings: WisStockSettings,
) {
  return saveManagement<SaveResult>("saveWisStock", config, expectedRevision, {
    stockId,
    settings,
  });
}
export async function saveWisStockMarketRules(
  config: WisStockConfig,
  expectedRevision: number,
  rules: WisStockMarketRules,
) {
  return saveManagement<
    WisStockManagement & { changed: boolean; duplicate: boolean }
  >("saveWisStockMarketRules", config, expectedRevision, { rules });
}
export async function setWisStockMarketHalted(
  config: WisStockConfig,
  expectedRevision: number,
  halted: boolean,
) {
  return saveManagement<
    WisStockManagement & { changed: boolean; duplicate: boolean }
  >("setWisStockMarketHalted", config, expectedRevision, { halted });
}
export async function activateWisStockCatalogPlan(
  config: WisStockConfig,
  expectedRevision: number,
  startsAtMs: number,
) {
  return saveManagement<
    WisStockManagement & { changed: boolean; duplicate: boolean }
  >("activateWisStockCatalogPlan", config, expectedRevision, { startsAtMs });
}
export async function activateWisStockCatalogExits(
  config: WisStockConfig,
  expectedRevision: number,
  exitOverrides: Record<string, number>,
) {
  return saveManagement<
    WisStockManagement & { changed: boolean; duplicate: boolean }
  >("activateWisStockCatalogExits", config, expectedRevision, {
    exitOverrides,
  });
}
async function saveManagement<T>(
  name: string,
  config: WisStockConfig,
  expectedRevision: number,
  fields: Record<string, unknown>,
): Promise<T> {
  const owner = auth.currentUser;
  if (!owner) throw changedOwner();
  await ensureSensitiveOperation();
  if (auth.currentUser !== owner) throw changedOwner();
  const epoch = Number((await owner.getIdTokenResult()).claims.auth_time);
  if (auth.currentUser !== owner || !Number.isFinite(epoch))
    throw changedOwner();
  const scope = getYearSemester(config);
  const payload = { ...scope, expectedRevision, ...fields };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([name, owner.uid, epoch, payload])),
  );
  const key =
    "westory:wis-stock-save:" +
    Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
  if (auth.currentUser !== owner) throw changedOwner();
  let requestId = pending.get(key);
  try {
    requestId ||= sessionStorage.getItem(key) || undefined;
  } catch {
    /* Memory fallback. */
  }
  if (!requestId || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId))
    requestId = crypto.randomUUID();
  pending.set(key, requestId);
  try {
    sessionStorage.setItem(key, requestId);
  } catch {
    /* Memory fallback. */
  }
  const result = await service<T>(name, {
    ...payload,
    requestId,
  });
  pending.delete(key);
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Optional storage. */
  }
  return result;
}
export function isWisStockRevisionConflict(error: unknown): boolean {
  return (
    (error as { details?: { reason?: string } })?.details?.reason ===
    "WIS_STOCK_REVISION_CONFLICT"
  );
}
export function wisStockErrorMessage(error: unknown): string {
  const failure = error as {
    code?: string;
    message?: string;
    details?: { reason?: string };
  };
  if (failure?.details?.reason?.startsWith("WIS_STOCK_") && failure.message)
    return failure.message;
  if (
    /SESSION|unauthenticated/.test(
      `${failure?.details?.reason} ${failure?.code}`,
    )
  )
    return "로그인 상태를 확인한 뒤 다시 시도해 주세요.";
  if (/permission-denied/.test(failure?.code || ""))
    return "위스피(WsPI) 관리 권한을 확인해 주세요.";
  return "주식 자료를 처리하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
}

// ---- 해외 시장(유스) 관리: 국내와 같은 명령 형식, 별도 시장 문서 ----
export interface WisStockFxSnapshot {
  rate: number;
  krwPerUsd: number;
  dayKey: string;
  sourceDate: string;
  source: string;
  fetchedAtMs: number;
  history: { dayKey: string; rate: number }[];
  current: boolean;
}
export type WisStockOverseasManagement = WisStockManagement & {
  venue: "OVERSEAS";
  unit: "유스";
  fx: WisStockFxSnapshot | null;
};
const overseasFlights = new Map<string, Promise<WisStockOverseasManagement>>();
function acceptOverseas(
  value: WisStockOverseasManagement,
  scope: { year: string; semester: string },
) {
  if (
    value?.venue !== "OVERSEAS" ||
    value.semesterId !== `${scope.year}-${scope.semester}` ||
    !Number.isSafeInteger(value.revision) ||
    !Array.isArray(value.stocks)
  )
    throw new Error(
      "해외 시장 자료를 확인하지 못했습니다. 다시 조회해 주세요.",
    );
  return value;
}
export async function getWisStockOverseasManagement(config: WisStockConfig) {
  const scope = getYearSemester(config);
  const owner = auth.currentUser;
  if (!owner) throw changedOwner();
  const epoch = Number((await owner.getIdTokenResult()).claims.auth_time);
  if (auth.currentUser !== owner || !Number.isFinite(epoch))
    throw changedOwner();
  const key = `${owner.uid}:${epoch}:${scope.year}:${scope.semester}`;
  const existing = overseasFlights.get(key);
  if (existing) return existing;
  const task = service<WisStockOverseasManagement>(
    "getWisStockOverseasManagement",
    scope,
  )
    .then((value) => acceptOverseas(value, scope))
    .finally(() => {
      if (overseasFlights.get(key) === task) overseasFlights.delete(key);
    });
  overseasFlights.set(key, task);
  return task;
}
type OverseasCommandResult = WisStockOverseasManagement & {
  changed: boolean;
  duplicate: boolean;
};
export const setWisStockOverseasMarketHalted = (
  config: WisStockConfig,
  expectedRevision: number,
  halted: boolean,
) =>
  saveManagement<OverseasCommandResult>(
    "setWisStockOverseasMarketHalted",
    config,
    expectedRevision,
    { halted },
  );
export const activateWisStockOverseasCatalogPlan = (
  config: WisStockConfig,
  expectedRevision: number,
  startsAtMs: number,
) =>
  saveManagement<OverseasCommandResult>(
    "activateWisStockOverseasCatalogPlan",
    config,
    expectedRevision,
    { startsAtMs },
  );
export const saveWisStockOverseasMarketRules = (
  config: WisStockConfig,
  expectedRevision: number,
  rules: WisStockMarketRules,
) =>
  saveManagement<OverseasCommandResult>(
    "saveWisStockOverseasMarketRules",
    config,
    expectedRevision,
    { rules },
  );
/** Fallback for the daily 07:05 job; once a KST day, later calls only read. */
export async function refreshWisStockFxRateNow(config: WisStockConfig) {
  const owner = auth.currentUser;
  if (!owner) throw changedOwner();
  await ensureSensitiveOperation();
  if (auth.currentUser !== owner) throw changedOwner();
  return service<{ changed: boolean; fx: WisStockFxSnapshot | null }>(
    "refreshWisStockFxRateNow",
    getYearSemester(config),
  );
}
