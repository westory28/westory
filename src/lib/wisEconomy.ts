import {
  executeWestoryCommand,
  type W2CommandPayloads,
} from "./commandGateway";
import { getHttpsCallable } from "./firebase";
import { getYearSemester } from "./semesterScope";
import type {
  HallOfFameInterfaceConfig,
  SystemConfig,
  WisHallOfFameSnapshot,
} from "../types";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;
type JsonRecord = Record<string, unknown>;

export type WisProvenance = "CURRENT" | "PREPARING" | "ARCHIVE" | "LEGACY";
export type WisEconomyStatus =
  | "ACTIVE_INITIALIZING"
  | "ACTIVE_OPEN"
  | "CLOSED"
  | "ARCHIVED"
  | "UNKNOWN";

export interface WisAccount {
  accountId: string;
  studentUid: string;
  displayName: string;
  enrollmentId: string;
  classId: string;
  revision: number;
  balance: number;
  initialGrantLedgerEntryId: string;
  grade: string;
  classNumber: string;
  studentNumber: string;
  earnedTotal: number;
  rankEarnedTotal: number;
  spentTotal: number;
  adjustedTotal: number;
}

export interface WisLedgerEntry {
  ledgerEntryId: string;
  accountId: string;
  studentUid: string;
  type: string;
  activityType?:
    | "history_dictionary"
    | "history_dictionary_reclaim"
    | "quiz"
    | "quiz_bonus"
    | "history_classroom"
    | "history_classroom_bonus";
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
  sourceId: string;
  reason: string;
  reversalEntryId: string;
  actorUid: string;
  actorRole: string;
  commandId: string;
  receiptId: string;
  createdAt: unknown;
}

export interface WisProduct {
  productId: string;
  revision: number;
  name: string;
  description: string;
  imageUrl: string;
  active: boolean;
}

export interface WisInventory {
  inventoryId: string;
  productId: string;
  productName: string;
  revision: number;
  price: number;
  stock: number;
  available: number;
  reserved: number;
  sold: number;
  active: boolean;
}

export interface WisOrder {
  orderId: string;
  accountId: string;
  studentUid: string;
  inventoryId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  revision: number;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "FULFILLED";
  reviewReason: string;
  memo?: string;
  reviewedBy: string;
  createdAt: unknown;
  reviewedAt: unknown;
  updatedAt: unknown;
}

export interface WisRankingRow {
  accountId: string;
  studentUid: string;
  displayName: string;
  balance: number;
  rank: number;
}

export interface WisEconomyState {
  semesterId: string;
  manifestRevision: number;
  provenance: WisProvenance;
  readOnly: boolean;
  status: "CONTENT" | "EMPTY" | "LEGACY";
  reason: string;
  economy: {
    revision: number;
    status: WisEconomyStatus;
    displayName: string;
    currencyName: string;
    initialGrantAmount: number;
  } | null;
  account: WisAccount | null;
  accounts: WisAccount[];
  ledger: WisLedgerEntry[];
  products: WisProduct[];
  inventory: WisInventory[];
  orders: WisOrder[];
  rankings: WisRankingRow[];
  hallOfFame: WisHallOfFameSnapshot | null;
  hallOfFameConfig: HallOfFameInterfaceConfig | null;
  hallOfFameConfigRevision: number;
  nextCursor: string;
}

export class WisEconomyError extends Error {
  readonly kind:
    | "PERMISSION"
    | "SESSION_EXPIRED"
    | "CONFLICT"
    | "VALIDATION"
    | "NETWORK"
    | "UNKNOWN";
  constructor(kind: WisEconomyError["kind"], message: string) {
    super(message);
    this.name = "WisEconomyError";
    this.kind = kind;
  }
}

const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
const rows = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.map(record) : [];
const string = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const boolean = (value: unknown) => value === true;

const mapError = (error: unknown) => {
  const raw = record(error);
  const code = string(raw.code).toLowerCase();
  const message = string(raw.message);
  if (code.includes("permission-denied"))
    return new WisEconomyError("PERMISSION", "위스 자료를 볼 권한이 없습니다.");
  if (code.includes("unauthenticated"))
    return new WisEconomyError(
      "SESSION_EXPIRED",
      "로그인 상태를 다시 확인해 주세요.",
    );
  if (code.includes("aborted") || code.includes("already-exists"))
    return new WisEconomyError(
      "CONFLICT",
      "다른 변경이 먼저 반영되었습니다. 최신 상태를 다시 불러와 주세요.",
    );
  if (code.includes("invalid-argument") || code.includes("failed-precondition"))
    return new WisEconomyError(
      "VALIDATION",
      message || "요청 내용을 다시 확인해 주세요.",
    );
  if (code.includes("unavailable") || code.includes("deadline-exceeded"))
    return new WisEconomyError(
      "NETWORK",
      "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
    );
  return new WisEconomyError(
    "UNKNOWN",
    message || "위스 자료를 처리하지 못했습니다.",
  );
};

const normalizeAccount = (value: unknown): WisAccount => {
  const item = record(value);
  return {
    accountId: string(item.accountId),
    studentUid: string(item.studentUid),
    displayName: string(item.displayName) || "학생",
    enrollmentId: string(item.enrollmentId),
    classId: string(item.classId),
    revision: number(item.revision),
    balance: number(item.balance),
    initialGrantLedgerEntryId: string(item.initialGrantLedgerEntryId),
    grade: string(item.grade),
    classNumber: string(item.classNumber),
    studentNumber: string(item.studentNumber),
    earnedTotal: number(item.earnedTotal),
    rankEarnedTotal: number(item.rankEarnedTotal),
    spentTotal: number(item.spentTotal),
    adjustedTotal: number(item.adjustedTotal),
  };
};

const currentSemesterId = (config: ConfigLike) => {
  const { year, semester } = getYearSemester(config);
  return `${year}-${semester}`;
};

export const getWisEconomyState = async (input: {
  config: ConfigLike;
  audience: "student" | "teacher";
  semesterId?: string;
  provenance?: "CURRENT" | "ARCHIVE" | "LEGACY" | "EXPLICIT";
  projection?:
    | "summary"
    | "overview"
    | "student-core"
    | "account"
    | "orders"
    | "catalog"
    | "hall-of-fame";
  accountId?: string;
  ledgerEntryId?: string;
  orderStatus?: string;
  cursor?: string;
  limit?: number;
}): Promise<WisEconomyState> => {
  const activeSemesterId = currentSemesterId(input.config);
  const requestedSemesterId = string(input.semesterId) || activeSemesterId;
  if (!/^\d{4}-[12]$/.test(requestedSemesterId)) {
    throw new WisEconomyError(
      "VALIDATION",
      "조회할 학기 범위가 올바르지 않습니다.",
    );
  }
  const source =
    input.provenance === "LEGACY"
      ? "LEGACY"
      : requestedSemesterId !== activeSemesterId
        ? "ARCHIVE"
        : input.provenance || "CURRENT";
  try {
    const callable = await getHttpsCallable<
      {
        audience: "student" | "teacher";
        semesterId: string;
        source: "CURRENT" | "ARCHIVE" | "LEGACY" | "EXPLICIT";
        projection?: string;
        accountId?: string;
        ledgerEntryId?: string;
        orderStatus?: string;
        cursor?: string;
        limit?: number;
      },
      unknown
    >("getWisEconomyState");
    const response = await callable({
      audience: input.audience,
      semesterId: requestedSemesterId,
      source,
      ...(input.projection ? { projection: input.projection } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.ledgerEntryId ? { ledgerEntryId: input.ledgerEntryId } : {}),
      ...(input.orderStatus ? { orderStatus: input.orderStatus } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
    });
    const raw = record(response.data);
    const economyRaw = record(raw.economy);
    return {
      semesterId: string(raw.semesterId) || requestedSemesterId,
      manifestRevision: number(raw.manifestRevision),
      provenance: ["ARCHIVE", "LEGACY", "PREPARING"].includes(
        string(raw.provenance),
      )
        ? (string(raw.provenance) as WisProvenance)
        : "CURRENT",
      readOnly: boolean(raw.readOnly),
      status:
        string(raw.status) === "CONTENT"
          ? "CONTENT"
          : string(raw.status) === "LEGACY"
            ? "LEGACY"
            : "EMPTY",
      reason: string(raw.reason),
      economy: Object.keys(economyRaw).length
        ? {
            revision: number(economyRaw.revision),
            status: string(economyRaw.status) as WisEconomyStatus,
            displayName: string(economyRaw.displayName),
            currencyName: string(economyRaw.currencyName) || "위스",
            initialGrantAmount: number(economyRaw.initialGrantAmount),
          }
        : null,
      account: Object.keys(record(raw.account)).length
        ? normalizeAccount(raw.account)
        : null,
      accounts: rows(raw.accounts).map(normalizeAccount),
      ledger: rows(raw.ledger).map((item) => ({
        ledgerEntryId: string(item.ledgerEntryId),
        accountId: string(item.accountId),
        studentUid: string(item.studentUid),
        type: string(item.type),
        ...(item.activityType === "history_dictionary" ||
        item.activityType === "history_dictionary_reclaim" ||
        item.activityType === "quiz" ||
        item.activityType === "quiz_bonus" ||
        item.activityType === "history_classroom" ||
        item.activityType === "history_classroom_bonus"
          ? { activityType: item.activityType }
          : {}),
        delta: number(item.delta),
        balanceBefore: number(item.balanceBefore),
        balanceAfter: number(item.balanceAfter),
        sourceId: string(item.sourceId),
        reason: string(item.reason),
        reversalEntryId: string(item.reversalEntryId),
        actorUid: string(item.actorUid),
        actorRole: string(item.actorRole),
        commandId: string(item.commandId),
        receiptId: string(item.receiptId),
        createdAt: item.createdAt ?? null,
      })),
      products: rows(raw.products).map((item) => ({
        productId: string(item.productId),
        revision: number(item.revision),
        name: string(item.name),
        description: string(item.description),
        imageUrl: string(item.imageUrl),
        active: boolean(item.active),
      })),
      inventory: rows(raw.inventory).map((item) => ({
        inventoryId: string(item.inventoryId),
        productId: string(item.productId),
        productName: string(item.productName),
        revision: number(item.revision),
        price: number(item.price),
        stock: number(item.stock),
        available: number(item.available),
        reserved: number(item.reserved),
        sold: number(item.sold),
        active: boolean(item.active),
      })),
      orders: rows(raw.orders).map((item) => ({
        orderId: string(item.orderId),
        accountId: string(item.accountId),
        studentUid: string(item.studentUid),
        inventoryId: string(item.inventoryId),
        productId: string(item.productId),
        productName: string(item.productName),
        quantity: number(item.quantity),
        unitPrice: number(item.unitPrice),
        totalPrice: number(item.totalPrice),
        revision: number(item.revision),
        status: string(item.status) as WisOrder["status"],
        reviewReason: string(item.reviewReason),
        memo: string(item.memo),
        reviewedBy: string(item.reviewedBy),
        createdAt: item.createdAt ?? null,
        reviewedAt: item.reviewedAt ?? null,
        updatedAt: item.updatedAt ?? null,
      })),
      rankings: rows(raw.rankings).map((item) => ({
        accountId: string(item.accountId),
        studentUid: string(item.studentUid),
        displayName: string(item.displayName),
        balance: number(item.balance),
        rank: number(item.rank),
      })),
      hallOfFame: Object.keys(record(raw.hallOfFame)).length
        ? (raw.hallOfFame as WisHallOfFameSnapshot)
        : null,
      hallOfFameConfig: Object.keys(record(raw.hallOfFameConfig)).length
        ? (raw.hallOfFameConfig as HallOfFameInterfaceConfig)
        : null,
      hallOfFameConfigRevision: number(raw.hallOfFameConfigRevision),
      nextCursor: string(raw.nextCursor),
    };
  } catch (error) {
    throw error instanceof WisEconomyError ? error : mapError(error);
  }
};

const mapped = async <T>(operation: Promise<T>) => {
  try {
    return await operation;
  } catch (error) {
    throw mapError(error);
  }
};

export const createSemesterEconomy = (
  payload: W2CommandPayloads["createSemesterEconomy"],
) => mapped(executeWestoryCommand("createSemesterEconomy", payload));
export const createWisAccounts = (
  payload: W2CommandPayloads["createWisAccounts"],
) => mapped(executeWestoryCommand("createWisAccounts", payload));
export const grantInitialWis = (
  payload: W2CommandPayloads["grantInitialWis"],
) => mapped(executeWestoryCommand("grantInitialWis", payload));
export const grantWis = (
  payload: W2CommandPayloads["grantWis"],
  options: { commandId?: string } = {},
) => mapped(executeWestoryCommand("grantWis", payload, options));
export const deductWis = (
  payload: W2CommandPayloads["deductWis"],
  options: { commandId?: string } = {},
) => mapped(executeWestoryCommand("deductWis", payload, options));
export const adjustWis = (payload: W2CommandPayloads["adjustWis"]) =>
  mapped(executeWestoryCommand("adjustWis", payload));
export const reverseWisEntry = (
  payload: W2CommandPayloads["reverseWisEntry"],
) => mapped(executeWestoryCommand("reverseWisEntry", payload));
export const rebuildWisProjection = (
  payload: W2CommandPayloads["rebuildWisProjection"],
) => mapped(executeWestoryCommand("rebuildWisProjection", payload));
export const transitionWisEconomy = (
  payload: W2CommandPayloads["transitionWisEconomy"],
) => mapped(executeWestoryCommand("transitionWisEconomy", payload));
export const upsertWisProduct = (
  payload: W2CommandPayloads["upsertWisProduct"],
) => mapped(executeWestoryCommand("upsertWisProduct", payload));
export const upsertWisInventory = (
  payload: W2CommandPayloads["upsertWisInventory"],
) => mapped(executeWestoryCommand("upsertWisInventory", payload));
export const placeWisOrder = (
  payload: W2CommandPayloads["placeWisOrder"],
  options: { commandId?: string } = {},
) => mapped(executeWestoryCommand("placeWisOrder", payload, options));
export const reviewWisOrder = (payload: W2CommandPayloads["reviewWisOrder"]) =>
  mapped(executeWestoryCommand("reviewWisOrder", payload));
export const saveWisHallOfFameConfig = (
  payload: W2CommandPayloads["saveWisHallOfFameConfig"],
  options: { commandId?: string } = {},
) => mapped(executeWestoryCommand("saveWisHallOfFameConfig", payload, options));

export { currentSemesterId };
