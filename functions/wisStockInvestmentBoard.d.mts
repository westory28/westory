export interface WisStockInvestmentBoardScopeInput {
  year: string; semester: string; grade?: string; classNumber?: string;
}
export interface WisStockInvestmentBoardScope {
  year: string; semester: string; semesterId: string; grade: string; classNumber: string; documentId: string;
}
export interface WisStockInvestmentBoardClass { grade: string; classNumber: string; }
export interface WisStockInvestmentBoardRow {
  /** Opaque server-generated board identity, never an email or authentication UID. */
  studentKey: string; grade: string; classNumber: string; studentNumber: string; displayName: string;
  /** Stock cash includes reserved cash; never add reservedCash to assets again. */
  stockCash: number; reservedCash: number; holdingCount: number;
  /** Filled holdings only, including shares reserved for sale, at one price revision. */
  holdingValue: number; holdingCostBasis: number; realizedPnl: number;
}
export interface WisStockInvestmentBoardViewRow extends WisStockInvestmentBoardRow {
  totalAssets: number; unrealizedPnl: number;
}
export interface WisStockInvestmentBoardTotals {
  studentCount: number; stockCash: number; reservedCash: number; holdingValue: number;
  holdingCostBasis: number; totalAssets: number; realizedPnl: number; unrealizedPnl: number;
}
export interface WisStockInvestmentBoardDocument {
  schemaVersion: 1; status: 'READY'; source: 'CANONICAL_STOCK_LEDGER'; complete: true;
  semesterId: string; grade: string; classNumber: string; revision: number; asOfMs: number;
  sourceRevision: number; priceRevision: number; classes: WisStockInvestmentBoardClass[];
  rows: WisStockInvestmentBoardRow[]; totals: WisStockInvestmentBoardTotals;
}
export interface WisStockInvestmentBoardState {
  status: 'NOT_READY' | 'READY'; semesterId: string; grade: string; classNumber: string;
  revision: number; asOfMs: number; sourceRevision: number; priceRevision: number;
  classes: WisStockInvestmentBoardClass[]; rows: WisStockInvestmentBoardViewRow[];
  totals: WisStockInvestmentBoardTotals | null;
}
export class WisStockInvestmentBoardError extends Error { reason: string; }
export interface WisStockInvestmentBoardSession {
  authTime: number; revision: string; authorityMode: 'ENFORCE' | 'OBSERVE_ONLY' | 'DISABLED';
  expiresAtMs: number; deadlineAtMs: number | null;
}
export function parseWisStockInvestmentBoardSession(raw: unknown, identity: { uid: string; authTime: number }, nowMs: number): WisStockInvestmentBoardSession;
export function normalizeWisStockInvestmentBoardScope(input: WisStockInvestmentBoardScopeInput): WisStockInvestmentBoardScope;
export function parseWisStockInvestmentBoardSnapshot(raw: unknown | null, scope: WisStockInvestmentBoardScope): WisStockInvestmentBoardState;
/** Pure future writer contract; no database access or student trading authorization. */
export function buildWisStockInvestmentBoard(input: {
  scope: WisStockInvestmentBoardScope; revision: number; asOfMs: number; sourceRevision: number; priceRevision: number;
  classes: WisStockInvestmentBoardClass[]; rows: WisStockInvestmentBoardRow[];
}): WisStockInvestmentBoardDocument;
