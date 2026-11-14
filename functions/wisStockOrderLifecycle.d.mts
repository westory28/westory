import type { WisStockOrderQuoteInput, WisStockQuotePortfolio, WisStockTradingSettings } from './wisStockMarketRules.mjs';
export interface WisStockReservations {
  /** Account-wide pending buy cash (fees included), already inside stock cash. */
  cash: number;
  /** Account-wide pending buy fees, already inside reserved cash. */
  buyFees: number;
  /** The remaining quantities and cost reservations belong to this stock only. */
  buyQuantity: number; sellQuantity: number; sellPrincipal: number; sellCostBasis: number;
}
export const EMPTY_WIS_STOCK_RESERVATIONS: Readonly<WisStockReservations>;
export interface WisStockReservedOrder {
  schemaVersion: 1; id: string; accountId: string; semesterId: string; stockId: string;
  requestKey: string; status: 'PENDING' | 'FILLED' | 'CANCELLED'; revision: number;
  side: 'BUY' | 'SELL'; quantity: number; unitPrice: number; gross: number; fee: number;
  cashDebit: number; cashCredit: number; reservedPrincipal: number; reservedCostBasis: number;
  acceptedAtMs: number; dueAtMs: number; delaySeconds: number; dayKey: string;
  settledAtMs?: number; cancellationReason?: string; realizedPnl?: number; earnedDelta?: number;
}
export interface WisStockOrderEffects {
  mainCashDelta: 0; stockCashDelta: number; holdingQuantityDelta: number; holdingPrincipalDelta: number; holdingCostBasisDelta: number;
  reservedCashDelta: number; reservedBuyQuantityDelta: number; reservedBuyFeesDelta: number;
  reservedSellQuantityDelta: number; reservedSellPrincipalDelta: number; reservedSellCostBasisDelta: number;
  availableSharesDelta: number; marketReservedBuyQuantityDelta: number;
  dailyBuyAmountDelta: number; dailyOrderCountDelta: number; counterDayKey: string | null; lastOrderAtMs: number | null;
  cumulativeRealizedPnlDelta: number; profitHighWatermarkDelta: number; earnedDelta: 0; rankEarnedDelta: 0;
}
export interface WisStockOrderTransition { changed: boolean; order: WisStockReservedOrder; effects: WisStockOrderEffects; executable: false; }
export interface WisStockOrderContext {
  order: WisStockReservedOrder; accountId: string; semesterId: string; nowMs: number;
  portfolio: WisStockQuotePortfolio; reservations: WisStockReservations;
  supply: { issuedShares: number; availableShares: number; reservedBuyQuantity: number };
}
export function acceptWisStockOrder(input: {
  orderId: string; accountId: string; semesterId: string; quoteInput: WisStockOrderQuoteInput;
  reservations: WisStockReservations; supplyReservedBuyQuantity: number; delaySeconds: number;
  existingOrder?: WisStockReservedOrder | null;
}): WisStockOrderTransition;
export function finalizeWisStockOrder(input: WisStockOrderContext & {
  execution: { serviceAllowed: boolean; authorized: boolean; scopeActive: boolean; marketHalted: boolean;
    tradingStatus: WisStockTradingSettings['tradingStatus']; haltedUntilMs: number; };
}): WisStockOrderTransition;
export function cancelWisStockOrder(input: WisStockOrderContext): WisStockOrderTransition;
