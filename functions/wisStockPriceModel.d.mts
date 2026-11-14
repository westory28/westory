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
    initialPrice: number;
    minimumPrice: number;
    maximumPrice: number;
    volatilityBps: number;
    trendBps: number;
    intervalHours: number;
    growthProfile?: WisStockGrowthProfile;
  };
}
/** Return a finite value in [0, 1). The server supplies a private SHA-256 sampler. */
export type WisStockPriceSampler = (key: string) => number;
export function wisStockPriceModelAnchor(stock: WisStockPriceModelInput): WisStockPriceModelAnchor;
export function sampleWisStockPriceStep(stock: WisStockPriceModelInput, semesterId: string, slot: number,
  priceSeed?: string, sampler?: WisStockPriceSampler): {
  movementBps: number;
  regime: 'MANUAL' | 'SIDEWAYS' | 'RISING' | 'FALLING' | 'CORRECTION';
  volatilityScale: number;
  shockBps: number;
  referencePrice: number | null;
};
/** Integer price with instrument bounds; market session/daily/circuit rules remain the caller's responsibility. */
export function nextWisStockModelPrice(stock: WisStockPriceModelInput, semesterId: string, slot: number,
  priceSeed?: string, sampler?: WisStockPriceSampler): number;
