export interface WisStockCatalogPlan {
  version: 1;
  startsAtMs: number;
  exitsEnabledAtMs?: number;
  exitOverrides?: Record<string, number>;
}
export function catalogSessionAtMs(session: number, startsAtMs: number): number;
export function catalogExitAtMs(
  entry: { id: string; exitSession: number | null },
  plan: WisStockCatalogPlan | null | undefined,
): number | null;
