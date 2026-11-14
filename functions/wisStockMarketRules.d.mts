export interface WisStockMarketRules {
  buyFeeBps: number; sellFeeBps: number; tradingDays: number[];
  openMinuteKst: number; closeMinuteKst: number; maxOrderQuantity: number; maxOrderAmount: number;
  maxHoldingQuantity: number; maxConcentrationBps: number; minimumCashReserve: number;
  dailyBuyLimit: number; dailyOrderLimit: number; cooldownSeconds: number;
  quoteTtlSeconds: number; maxSlippageBps: number; automaticPrices: boolean;
  dailyPriceLimitBps: number; circuitBreakerBps: number; circuitBreakerMinutes: number; halted: boolean;
}
export interface WisStockTradingSettings { issuedShares: number; lotSize: number; tradingStatus: 'ACTIVE' | 'HALTED' | 'SELL_ONLY'; }
export interface WisStockQuotePortfolio {
  cashBalance: number; holdingQuantity: number; holdingPrincipal: number; holdingCostBasis: number;
  portfolioValue: number; dayKey: string; dailyBuyAmount: number; dailyOrderCount: number;
  lastOrderAtMs: number; cumulativeRealizedPnl: number; profitHighWatermark: number;
}
export interface WisStockOrderQuoteInput {
  rules: WisStockMarketRules; side: 'BUY' | 'SELL'; quantity: number; nowMs: number; marketRevision: number;
  stock: { id: string; price: number; settings: WisStockTradingSettings; haltedUntilMs?: number; availableShares: number };
  quote: { stockId: string; price: number; atMs: number; marketRevision: number }; portfolio: WisStockQuotePortfolio;
}
export interface WisStockOrderQuote {
  side: 'BUY' | 'SELL'; quantity: number; unitPrice: number; gross: number; fee: number;
  cashDebit: number; cashCredit: number; walletDelta: number; principalRemoved: number; costBasisRemoved: number;
  buyFeesRemoved: number; principalRecovered: number; realizedPnl: number; cumulativeRealizedPnl: number;
  profitHighWatermark: number; earnedDelta: 0; rankEarnedDelta: 0; nextCashBalance: number;
  nextHoldingQuantity: number; nextHoldingPrincipal: number; nextHoldingCostBasis: number;
  dayKey: string; nextDailyBuyAmount: number; nextDailyOrderCount: number; nextAvailableShares: number; executable: false; studentOpen: false;
}
export class WisStockRuleError extends Error { reason: string; }
export const DEFAULT_WIS_STOCK_MARKET_RULES: Readonly<WisStockMarketRules>;
export const DEFAULT_WIS_STOCK_TRADING_SETTINGS: Readonly<WisStockTradingSettings>;
export const WIS_STOCK_RULE_LIMITS: Readonly<Record<string, readonly [number, number]>>;
export function normalizeWisStockMarketRules(input?: Partial<WisStockMarketRules>): WisStockMarketRules;
export function normalizeWisStockTradingSettings(input?: Partial<WisStockTradingSettings>): WisStockTradingSettings;
export function wisStockKstSession(atMs: number): { dayKey: string; dayOfWeek: number; minute: number };
export function isWisStockTradingSession(rules: WisStockMarketRules, atMs: number): boolean;
export function wisStockDailyBounds(openPrice: number, limitBps: number): { minimum: number; maximum: number };
export function quoteWisStockOrder(input: WisStockOrderQuoteInput): WisStockOrderQuote;
