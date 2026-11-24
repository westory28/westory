export type WisStockGrowthProfile = 'HISTORICAL' | 'VALUE';
export interface WisStockPriceModelAnchor {
  version: 1;
  anchorAtMs: number;
  anchorPrice: number;
}
export interface WisStockPriceModelInput {
  id: string;
  price: number;
  updatedAtMs?: number;
  history?: { atMs: number; price: number }[];
  priceModel?: WisStockPriceModelAnchor;
  settings: {
    name?: string;
    sector?: string;
    initialPrice: number;
    minimumPrice: number;
    maximumPrice: number;
    volatilityBps: number;
    trendBps: number;
    intervalHours: number;
    growthProfile?: WisStockGrowthProfile;
  };
}
/** Return a finite value in [0, 1). The server supplies a private deterministic sampler. */
export type WisStockPriceSampler = (key: string) => number;
export interface WisStockMarketContext {
  atMs?: number;
  priorMarketReturnBps?: number;
  marketStress?: number;
  sampler?: WisStockPriceSampler;
}
export type WisStockSector = 'CONSTRUCTION_STEEL' | 'TECH_ELECTRONICS' | 'FINANCE' | 'OTHER';
export function wisStockSector(stock: WisStockPriceModelInput): WisStockSector;
export function wisStockPreviousMarketReturn(index: { history?: { atMs: number; value: number }[] } | undefined,
  atMs: number): number;
export function wisStockMarketStress(index: { history?: { atMs: number; value: number }[] } | undefined,
  atMs: number): number;
export function sampleWisStockMarketFactors(stock: WisStockPriceModelInput, semesterId: string, slot: number,
  priceSeed?: string, context?: WisStockMarketContext): {
  sector: WisStockSector; market: number; industry: number; volatilityScale: number; priorMarket: number;
  contribution: number; individualWeight: number;
};
export function wisStockPriceModelAnchor(stock: WisStockPriceModelInput): WisStockPriceModelAnchor;
export function sampleWisStockPriceStep(stock: WisStockPriceModelInput, semesterId: string, slot: number,
  priceSeed?: string, sampler?: WisStockPriceSampler, dailyPriceLimitBps?: number, marketContext?: WisStockMarketContext,
  sectorFactors?: ReturnType<typeof sampleWisStockMarketFactors>): {
  movementBps: number;
  regime: 'MANUAL' | 'SIDEWAYS' | 'RISING' | 'FALLING' | 'CORRECTION';
  volatilityScale: number;
  shockBps: number;
  referencePrice: number | null;
};
/** Integer price with instrument bounds; market session/daily/circuit rules remain the caller's responsibility. */
export function nextWisStockModelPrice(stock: WisStockPriceModelInput, semesterId: string, slot: number,
  priceSeed?: string, sampler?: WisStockPriceSampler, dailyPriceLimitBps?: number, marketContext?: WisStockMarketContext): number;
