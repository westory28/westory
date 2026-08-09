import { getHttpsCallable } from "./firebase";

export type ApplicationSessionScope = "GENERAL" | "HIGH_RISK";

export interface ApplicationSessionSnapshot {
  authTime: number;
  generalExpiresAt: number;
  highRiskExpiresAt: number;
  status: "active" | "closed" | string;
  resumed?: boolean;
  throttled?: boolean;
}

const invokeSessionCommand = async <TResponse>(
  name: string,
  data: Record<string, unknown> = {},
): Promise<TResponse> => {
  const callable = await getHttpsCallable<Record<string, unknown>, TResponse>(
    name,
  );
  const response = await callable(data);
  return response.data;
};

export const openApplicationSession = () =>
  invokeSessionCommand<ApplicationSessionSnapshot>("openApplicationSession");

export const touchApplicationSession = (scope: ApplicationSessionScope) =>
  invokeSessionCommand<ApplicationSessionSnapshot>("touchApplicationSession", {
    scope,
  });

export const closeApplicationSession = () =>
  invokeSessionCommand<{ closed: boolean; reason?: string }>(
    "closeApplicationSession",
  );
