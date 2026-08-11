import {
  executeWestoryCommand,
  type W2CommandPayloads,
} from "./commandGateway";
import { getHttpsCallable } from "./firebase";
import { getYearSemester } from "./semesterScope";
import type { SystemConfig } from "../types";

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
}

export interface WisLedgerEntry {
  ledgerEntryId: string;
  accountId: string;
  type: string;
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
  sourceId: string;
  reason: string;
  reversalEntryId: string;
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
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  revision: number;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "FULFILLED";
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
  accountId?: string;
  orderStatus?: string;
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
        accountId?: string;
        orderStatus?: string;
      },
      unknown
    >("getWisEconomyState");
    const response = await callable({
      audience: input.audience,
      semesterId: requestedSemesterId,
      source,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.orderStatus ? { orderStatus: input.orderStatus } : {}),
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
        type: string(item.type),
        delta: number(item.delta),
        balanceBefore: number(item.balanceBefore),
        balanceAfter: number(item.balanceAfter),
        sourceId: string(item.sourceId),
        reason: string(item.reason),
        reversalEntryId: string(item.reversalEntryId),
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
        productName: string(item.productName),
        quantity: number(item.quantity),
        unitPrice: number(item.unitPrice),
        totalPrice: number(item.totalPrice),
        revision: number(item.revision),
        status: string(item.status) as WisOrder["status"],
      })),
      rankings: rows(raw.rankings).map((item) => ({
        accountId: string(item.accountId),
        studentUid: string(item.studentUid),
        displayName: string(item.displayName),
        balance: number(item.balance),
        rank: number(item.rank),
      })),
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
export const grantWis = (payload: W2CommandPayloads["grantWis"]) =>
  mapped(executeWestoryCommand("grantWis", payload));
export const deductWis = (payload: W2CommandPayloads["deductWis"]) =>
  mapped(executeWestoryCommand("deductWis", payload));
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
export const placeWisOrder = (payload: W2CommandPayloads["placeWisOrder"]) =>
  mapped(executeWestoryCommand("placeWisOrder", payload));
export const reviewWisOrder = (payload: W2CommandPayloads["reviewWisOrder"]) =>
  mapped(executeWestoryCommand("reviewWisOrder", payload));

export { currentSemesterId };
