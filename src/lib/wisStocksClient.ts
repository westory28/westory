import { auth } from "./firebase";
import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { getYearSemester } from "./semesterScope";
import { ensureSensitiveOperation } from "./sensitiveOperation";
import type { SystemConfig } from "../types";
import type { WisStockMarketRules } from "../../functions/wisStockMarketRules.mjs";
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
  intervalHours: number;
  automatic: boolean;
  issuedShares: number;
  lotSize: number;
  tradingStatus: "ACTIVE" | "HALTED" | "SELL_ONLY";
}
export interface WisStock {
  id: string;
  settings: WisStockSettings;
  price: number;
  updatedAtMs: number;
  nextTickAtMs: number;
  haltedUntilMs?: number;
  history: { atMs: number; price: number }[];
}
export interface WisStockManagement {
  semesterId: string;
  revision: number;
  studentOpen: false;
  maxStocks: number;
  historyLimit: number;
  updatedAtMs: number;
  stocks: WisStock[];
  rules: WisStockMarketRules;
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
export async function getWisStockManagement(config: WisStockConfig) {
  const owner = auth.currentUser;
  if (!owner) throw changedOwner();
  const epoch = Number((await owner.getIdTokenResult()).claims.auth_time);
  if (auth.currentUser !== owner || !Number.isFinite(epoch))
    throw changedOwner();
  const scope = getYearSemester(config);
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
    return "위스 주식 관리 권한을 확인해 주세요.";
  return "주식 자료를 처리하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
}
