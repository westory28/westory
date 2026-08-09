import { readLocalOnly } from "./safeStorage";

export const SESSION_EXPIRY_KEY = "sessionExpiry";

export const readSessionExpiry = (): number | null => {
  const value = Number(readLocalOnly(SESSION_EXPIRY_KEY));
  return Number.isFinite(value) && value > 0 ? value : null;
};

export const isStoredSessionExpired = (now = Date.now()): boolean => {
  const expiry = readSessionExpiry();
  return expiry !== null && expiry <= now;
};
