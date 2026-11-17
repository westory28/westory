import type { WisStockReservedOrder } from './wisStockOrderLifecycle.mjs';
export const WIS_STOCK_BONUS_RESTRICTION_VERSION: 1;
export interface WisStockBonusLot {
  quantity: number; costBasis: number; restrictedCostBasis: number; sequence: number;
}
export interface WisStockBonusAccount {
  schemaVersion: 1 | 2; revision: number; stockCash: number; reservedCash: number;
  eventBonusTotal?: number; eventBonusRestrictionVersion?: 1;
  eventBonusRestrictedCash?: number; eventBonusReservedCash?: number;
  eventBonusLossCarryforward?: number; eventBonusLegacyWithdrawn?: number;
  positions: Record<string, { quantity: number; reservedSellQuantity: number; eventBonusLots?: Record<string, WisStockBonusLot> }>;
  pendingOrders: Record<string, WisStockReservedOrder>;
}
export function isWisStockBonusMigrationPending(account: WisStockBonusAccount): boolean;
export function assertWisStockBonusReady(account: WisStockBonusAccount): void;
export function validateWisStockBonusAccount(account: WisStockBonusAccount): void;
export function wisStockBonusFunding(account: WisStockBonusAccount): {
  eventBonusRestrictedCash: number; eventBonusReservedCash: number; eventBonusMigrationPending?: boolean;
};
export function grantWisStockRestrictedBonus(account: WisStockBonusAccount, amount: number): void;
export function tagWisStockBonusOrder(account: WisStockBonusAccount, order: WisStockReservedOrder): WisStockReservedOrder;
export function applyWisStockBonusOrder(previous: WisStockBonusAccount, next: WisStockBonusAccount,
  transition: { order: WisStockReservedOrder }): void;
