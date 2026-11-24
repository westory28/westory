import type {
  WisStock,
  WisStockSettings,
  WisStockMarketRules,
} from "./wisStocksClient";

export const STUDENT_WISPI_URL = "/student/wispi";
export type WisStockScope = { year: string; semester: string };
export type WisStockLoad<T> =
  | { status: "idle" | "loading"; data: null; error: "" }
  | { status: "ready"; data: T; error: "" }
  | { status: "error"; data: null; error: string };
export interface StudentWisStockStatus {
  schemaVersion: 1;
  semesterId: string;
  studentOpen: boolean;
  halted: boolean;
  tradingEpoch: number;
  revision: number;
  updatedAtMs: number;
}
export interface StudentWisStockMarket {
  schemaVersion: 1;
  semesterId: string;
  studentOpen: true;
  tradingEpoch: number;
  revision: number;
  updatedAtMs: number;
  rules: WisStockMarketRules;
  stocks: StudentWisStockInstrument[];
}
export type StudentWisStockInstrument = Omit<WisStock, "settings"> & {
  settings: Pick<
    WisStockSettings,
    | "name"
    | "description"
    | "period"
    | "issuedShares"
    | "lotSize"
    | "tradingStatus"
  >;
};
export interface StudentWisStockPosition {
  stockId: string;
  quantity: number;
  principal: number;
  costBasis: number;
  reservedSellQuantity: number;
}
export interface StudentWisStockOrder {
  id: string;
  stockId: string;
  side: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
  fee: number;
  dueAtMs: number;
  status: string;
}
export interface StudentWisStockState {
  semesterId: string;
  serverNowMs: number;
  marketRevision: number;
  studentOpen: boolean;
  halted: boolean;
  tradingEpoch: number;
  rules: WisStockMarketRules;
  stocks: Array<
    Pick<
      StudentWisStockInstrument,
      "id" | "settings" | "price" | "updatedAtMs" | "haltedUntilMs"
    >
  >;
  mainCash: number;
  accountPath: string | null;
  /** Local response receipt time; never sent as an execution timestamp. */
  clientReceivedAtMs?: number;
  account: {
    accountId: string;
    revision: number;
    stockCash: number;
    reservedCash: number;
    outstandingPrincipal: number;
    lastDepositAtMs: number;
    eventBonusTotal?: number;
    eventBonusRestrictionVersion?: 1;
    eventBonusRestrictedCash?: number;
    eventBonusReservedCash?: number;
    eventBonusLossCarryforward?: number;
    eventBonusLegacyWithdrawn?: number;
    positions: StudentWisStockPosition[];
    pendingOrders: StudentWisStockOrder[];
    recentOrders: StudentWisStockOrder[];
  };
  funding: {
    maximumDeposit: number;
    maximumWithdrawal: number;
    nextDepositAtMs: number;
  };
}
export interface StudentWisStockHistoryEntry {
  id: string;
  kind:
    | "DEPOSIT"
    | "EVENT_BONUS"
    | "WITHDRAW"
    | "ORDER_ACCEPTED"
    | "ORDER_FILLED"
    | "ORDER_CANCELLED";
  atMs: number;
  stockId?: string;
  side?: "BUY" | "SELL";
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  fee?: number;
  stockCashDelta: number;
  mainCashDelta: number;
  earnedDelta: number;
  campaignId?: string;
  automaticSettlement?: "GRADUATION";
}
export interface StudentWisStockHistoryPage {
  semesterId: string;
  entries: StudentWisStockHistoryEntry[];
  nextCursor: string;
  hasMore: boolean;
}
export interface StudentWisStockReturns {
  semesterId: string;
  asOfMs: number;
  points: { atMs: number; returnPercent: number | null }[];
}
export interface StudentWisStockMutation {
  changed: boolean;
  duplicate: boolean;
  bonusAmount?: number;
  depositBonus?: StudentWisStockBonus;
  state: StudentWisStockState;
  order?: StudentWisStockOrder;
  receipt?: { withdrawnProfit?: number; principalReturned?: number };
}
export interface StudentWisStockBonus {
  campaignId: string;
  threshold: number;
  amount: number;
  status: "DISABLED" | "INELIGIBLE" | "ELIGIBLE" | "CLAIMED";
  qualifyingDepositAmount: number;
}
