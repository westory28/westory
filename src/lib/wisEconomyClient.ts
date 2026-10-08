import { Timestamp } from "firebase/firestore";
import { auth } from "./firebase";
import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { getYearSemester } from "./semesterScope";
import { ensureSensitiveOperation } from "./sensitiveOperation";
import { readStorage, writeStorage, removeStorage } from "./safeStorage";
import type {
  PointWallet,
  PointTransaction,
  PointProduct,
  PointOrder,
  SystemConfig,
  WisHallOfFameSnapshot,
  HallOfFameInterfaceConfig,
} from "../types";

export type WisConfig =
  | Pick<SystemConfig, "year" | "semester">
  | null
  | undefined;
export type WisRow = Record<string, any>;
export type WisState = {
  semesterId: string;
  manifestRevision: number;
  readOnly: boolean;
  reason?: string;
  economy: WisRow | null;
  account: WisRow | null;
  accounts: WisRow[];
  ledger: WisRow[];
  products: WisRow[];
  inventory: WisRow[];
  orders: WisRow[];
  hallOfFame: WisHallOfFameSnapshot | null;
  hallOfFameConfig?: HallOfFameInterfaceConfig;
  hallOfFameConfigRevision: number;
  nextCursor: string;
};
export const wisSemesterId = (config: WisConfig) => {
  const { year, semester } = getYearSemester(config);
  return `${year}-${semester}`;
};
const ownerChanged = () =>
  new Error("로그인 계정이 바뀌었습니다. 다시 확인해 주세요.");
const serviceError = (error: any) => {
  const reason = String(error?.details?.reason || ""),
    code = String(error?.code || "");
  let message =
    "위스 자료를 처리하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
  if (reason === "WIS_INSUFFICIENT_BALANCE")
    message = "보유 위스가 부족합니다.";
  else if (/STOCK|INVENTORY_RESERVED/.test(reason))
    message = "상품 재고가 변경되었습니다. 목록을 새로고침해 주세요.";
  else if (/REVISION_CONFLICT/.test(reason))
    message =
      "다른 변경이 먼저 반영되었습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.";
  else if (/SESSION_|unauthenticated/.test(reason + code))
    message = "로그인 세션을 다시 확인한 뒤 시도해 주세요.";
  else if (/permission-denied/.test(code))
    message = "현재 학기의 위스 이용 권한을 확인해 주세요.";
  else if (reason === "WIS_ECONOMY_STATE_INVALID")
    message = "현재 학기의 위스 상점이 열려 있지 않습니다.";
  else if (reason === "WIS_ORDER_STATE_INVALID")
    message = "주문 처리 상태가 바뀌었습니다. 목록을 새로고침해 주세요.";
  else if (reason === "WIS_LEDGER_SOURCE_EXISTS")
    message = "이미 반영된 조정입니다. 위스 내역을 새로고침해 주세요.";
  return Object.assign(new Error(message), {
    code: error?.code,
    details: error?.details,
  });
};
export const assertWisOwner = (uid: string) => {
  if (!uid || auth.currentUser?.uid !== uid) throw ownerChanged();
};
export const callWisService = async <T>(
  name: string,
  payload: WisRow,
  uid = auth.currentUser?.uid || "",
): Promise<T> => {
  assertWisOwner(uid);
  const user = auth.currentUser!;
  const epoch = Number((await user.getIdTokenResult()).claims.auth_time);
  if (auth.currentUser !== user || !Number.isFinite(epoch))
    throw ownerChanged();
  const call = await getHistoryDictionaryCallable<WisRow, T>(name);
  if (auth.currentUser !== user) throw ownerChanged();
  let result;
  try {
    result = await call(payload);
  } catch (error) {
    throw serviceError(error);
  }
  if (
    auth.currentUser !== user ||
    Number((await user.getIdTokenResult()).claims.auth_time) !== epoch
  )
    throw ownerChanged();
  return result.data;
};
export const queryWisState = async (
  config: WisConfig,
  audience: "student" | "teacher",
  projection: string,
  extra: WisRow = {},
): Promise<WisState> => {
  const semesterId = wisSemesterId(config);
  const data = await callWisService<WisState>("getWisEconomyState", {
    audience,
    semesterId,
    source: "CURRENT",
    projection,
    limit: 200,
    ...extra,
  });
  if (data.semesterId !== semesterId)
    throw new Error("현재 학기가 바뀌었습니다. 다시 확인해 주세요.");
  return data;
};
export const queryAllWisState = async (
  config: WisConfig,
  projection: string,
  extra: WisRow = {},
) => {
  const uid = auth.currentUser?.uid || "";
  const user = auth.currentUser;
  const state = await queryWisState(config, "teacher", projection, extra);
  const seen = new Set<string>();
  while (state.nextCursor) {
    assertWisOwner(uid);
    if (auth.currentUser !== user) throw ownerChanged();
    if (seen.has(state.nextCursor))
      throw new Error("위스 자료의 다음 페이지를 확인하지 못했습니다.");
    seen.add(state.nextCursor);
    const page = await queryWisState(config, "teacher", projection, {
      ...extra,
      cursor: state.nextCursor,
    });
    for (const key of [
      "accounts",
      "ledger",
      "products",
      "inventory",
      "orders",
    ] as const)
      state[key] = [...(state[key] || []), ...(page[key] || [])];
    state.nextCursor = page.nextCursor;
  }
  assertWisOwner(uid);
  if (auth.currentUser !== user) throw ownerChanged();
  return state;
};
export const wisTimestamp = (value: any) => {
  if (!value) return null;
  if (typeof value === "string") {
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds)
      ? Timestamp.fromMillis(milliseconds)
      : null;
  }
  const seconds = Number(value.seconds ?? value._seconds);
  const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
  return Number.isFinite(seconds) ? new Timestamp(seconds, nanos) : value;
};
export const wisHallOfFame = (state: WisState): WisHallOfFameSnapshot | null =>
  state.hallOfFame
    ? {
        ...state.hallOfFame,
        updatedAt: wisTimestamp(state.hallOfFame.updatedAt),
      }
    : null;
export const wisWallet = (account: WisRow): PointWallet => ({
  uid: account.studentUid,
  studentName: account.displayName || "",
  grade: account.grade || "",
  class: account.classNumber || "",
  number: account.studentNumber || "",
  balance: Number(account.balance || 0),
  earnedTotal: Number(account.earnedTotal || 0),
  rankEarnedTotal: Number(account.rankEarnedTotal || 0),
  spentTotal: Number(account.spentTotal || 0),
  adjustedTotal: Number(account.adjustedTotal || 0),
  rankSnapshot: null,
});
const activities = new Set([
  "attendance",
  "attendance_monthly_bonus",
  "attendance_milestone_bonus",
  "quiz",
  "quiz_bonus",
  "lesson",
  "lesson_core_points",
  "lesson_core_points_reclaim",
  "think_cloud",
  "map_tag",
  "history_dictionary",
  "history_dictionary_reclaim",
  "history_classroom",
  "history_classroom_bonus",
  "weplay_cost",
  "weplay_reward",
  "weplay_rank_reward",
]);
export const wisTransaction = (
  entry: WisRow,
  uid: string,
): PointTransaction => {
  const types: Record<string, PointTransaction["type"]> = {
    INITIAL_GRANT: "manual_adjust",
    GRANT: "manual_adjust",
    DEDUCT: "manual_reclaim",
    ADJUST: "manual_adjust",
    REVERSAL: "manual_reclaim",
    ORDER_DEBIT: "purchase_hold",
    ORDER_REFUND: "purchase_cancel",
  };
  const activityType = activities.has(entry.activityType)
    ? (entry.activityType as PointTransaction["type"])
    : undefined;
  return {
    id: entry.ledgerEntryId,
    uid,
    type: activityType || types[entry.type] || "manual_adjust",
    ...(activityType ? { activityType } : {}),
    delta: Number(entry.delta || 0),
    balanceAfter: Number(entry.balanceAfter || 0),
    sourceId: entry.sourceId || entry.ledgerEntryId,
    sourceLabel: entry.reason || "위스 내역",
    policyId: "w7-v1",
    createdBy: entry.actorUid || "",
    createdAt: wisTimestamp(entry.createdAt),
    reclaimed: !!entry.reversalEntryId,
    canReverse:
      ["GRANT", "DEDUCT", "ADJUST"].includes(entry.type) &&
      ["teacher", "admin"].includes(entry.actorRole) &&
      entry.sourceId !== "lesson-core-points-all" &&
      !entry.reversalEntryId,
    originalTransactionId: entry.originalLedgerEntryId || "",
  };
};
export const wisProducts = (
  state: WisState,
  activeOnly: boolean,
): PointProduct[] =>
  (state.products || []).flatMap((product) => {
    const stock = (state.inventory || []).find(
      (item) => item.productId === product.productId,
    );
    if (!stock || (activeOnly && (!product.active || !stock.active))) return [];
    return [
      {
        id: product.productId,
        name: product.name,
        description: product.description || "",
        price: Number(stock.price || 0),
        stock: Number(activeOnly ? stock.available : stock.stock),
        isActive: product.active === true && stock.active === true,
        sortOrder: 0,
        imageUrl: product.imageUrl || "",
      },
    ];
  });
export const wisOrder = (
  order: WisRow,
  account?: WisRow | null,
): PointOrder => ({
  id: order.orderId,
  uid: account?.studentUid || order.studentUid || "",
  studentName: account?.displayName || "",
  grade: account?.grade || "",
  class: account?.classNumber || "",
  number: account?.studentNumber || "",
  productId: order.productId,
  productName: order.productName,
  priceSnapshot: Number(order.totalPrice || 0),
  status: String(order.status).toLowerCase() as PointOrder["status"],
  requestedAt: wisTimestamp(order.createdAt),
  reviewedAt: wisTimestamp(order.reviewedAt),
  reviewedBy: order.reviewedBy || "",
  memo: order.reviewReason || order.memo || "",
});

export const wisRevisionScope = (state: WisState) => {
  if (
    state.readOnly ||
    !state.economy ||
    !Number.isInteger(state.manifestRevision) ||
    !Number.isInteger(state.economy.revision)
  )
    throw new Error("현재 학기의 위스 운영 상태를 확인해 주세요.");
  return {
    semesterId: state.semesterId,
    expectedSemesterRevision: state.manifestRevision,
    expectedEconomyRevision: state.economy.revision,
  };
};
type Command = {
  commandId: string;
  commandType: string;
  payload: WisRow;
  result?: WisRow;
};
type Operation = { ownerUid: string; steps: Record<string, Command> };
const flights = new Map<string, Promise<any>>();
const ambiguous = (error: any) =>
  /(?:unavailable|deadline-exceeded|internal|network-request-failed)$/.test(
    String(error?.code || ""),
  );
const hash = async (input: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)),
    ),
    (item) => item.toString(16).padStart(2, "0"),
  ).join("");

// Retain the exact revisions and command ID until the receipt confirms success.
// Multi-command product/adjustment operations resume after their completed step.
export const runWisOperation = async <T>(
  intent: unknown[],
  sensitive: boolean,
  run: (
    step: (
      name: string,
      prepare: () => Promise<{ commandType: string; payload: WisRow }>,
    ) => Promise<WisRow>,
  ) => Promise<T>,
  retainCompleted = false,
): Promise<T> => {
  const uid = auth.currentUser?.uid || "";
  assertWisOwner(uid);
  const key = `westoryWisOperation:${await hash(JSON.stringify([uid, ...intent]))}`;
  assertWisOwner(uid);
  const existing = flights.get(key);
  if (existing) return existing;
  const operation = (async () => {
    if (sensitive) await ensureSensitiveOperation();
    assertWisOwner(uid);
    let saved: Operation = { ownerUid: uid, steps: {} };
    try {
      const value = JSON.parse(readStorage(key) || "null");
      if (value?.ownerUid === uid && value.steps) saved = value;
    } catch {
      /* no prior operation */
    }
    const persist = () => writeStorage(key, JSON.stringify(saved));
    const step = async (
      name: string,
      prepare: () => Promise<{ commandType: string; payload: WisRow }>,
    ) => {
      assertWisOwner(uid);
      let command = saved.steps[name];
      if (!command) {
        command = { ...(await prepare()), commandId: crypto.randomUUID() };
        assertWisOwner(uid);
        saved.steps[name] = command;
        persist();
      }
      if (command.result) return command.result;
      let response: { status: string; result: WisRow };
      const { commandId, commandType, payload } = command;
      try {
        response = await callWisService(
          "executeCommand",
          { commandId, commandType, payload },
          uid,
        );
      } catch (error) {
        if (
          /^(?:(?:WIS|W8)_.*REVISION_CONFLICT|SEMESTER_REVISION_CONFLICT)$/.test(
            String((error as any)?.details?.reason || ""),
          )
        ) {
          // This error is emitted after receipt lookup, so this exact command
          // did not commit. Retain any earlier completed operation stages.
          delete saved.steps[name];
          persist();
        }
        if (!ambiguous(error)) throw error;
        const receipt = await callWisService<{
          status: string;
          result: WisRow;
        }>("getCommandStatus", { commandId, commandType }, uid).catch(
          () => null,
        );
        if (receipt?.status !== "SUCCEEDED") throw error;
        response = receipt;
      }
      if (response.status !== "SUCCEEDED" || !response.result)
        throw Object.assign(
          new Error(
            "위스 작업 결과를 확인하지 못했습니다. 같은 작업을 다시 시도해 주세요.",
          ),
          { code: "functions/unavailable" },
        );
      assertWisOwner(uid);
      command.result = response.result;
      persist();
      return response.result;
    };
    const result = await run(step);
    assertWisOwner(uid);
    if (!retainCompleted) removeStorage(key);
    return result;
  })();
  flights.set(key, operation);
  try {
    return await operation;
  } finally {
    if (flights.get(key) === operation) flights.delete(key);
  }
};
