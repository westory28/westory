import { readLocalOnly, removeStorage, writeLocalOnly } from "./safeStorage";

export const SESSION_EXPIRY_KEY = "sessionExpiry";
export const SESSION_LAST_ACTIVITY_KEY = "westorySessionLastActivity";
export const SESSION_RETURN_PATH_KEY = "westorySessionReturnPath";

const MINUTE_MS = 60 * 1000;
const LEGACY_SESSION_DURATION_MS = 60 * MINUTE_MS;
const SESSION_RETURN_PATH_MAX_AGE_MS = 2 * 60 * MINUTE_MS;

export const NORMAL_SESSION_DURATION_MS = 30 * MINUTE_MS;
export const HIGH_RISK_ADMIN_SESSION_DURATION_MS = 15 * MINUTE_MS;
export const SESSION_WARNING_LEAD_MS = 5 * MINUTE_MS;

export interface SessionPolicy {
  durationMs: number;
  warningLeadMs: number;
  highRisk: boolean;
}

export const isHighRiskAdminPath = (
  pathname: string,
  isAdmin: boolean,
): boolean => isAdmin && /^\/teacher\/settings(?:\/|$)/.test(pathname);

export const resolveSessionPolicy = (
  pathname: string,
  isAdmin: boolean,
): SessionPolicy => {
  const highRisk = isHighRiskAdminPath(pathname, isAdmin);
  return {
    durationMs: highRisk
      ? HIGH_RISK_ADMIN_SESSION_DURATION_MS
      : NORMAL_SESSION_DURATION_MS,
    warningLeadMs: SESSION_WARNING_LEAD_MS,
    highRisk,
  };
};

export const readSessionExpiry = (): number | null => {
  const value = Number(readLocalOnly(SESSION_EXPIRY_KEY));
  return Number.isFinite(value) && value > 0 ? value : null;
};

export const readSessionLastActivity = (): number | null => {
  const value = Number(readLocalOnly(SESSION_LAST_ACTIVITY_KEY));
  if (Number.isFinite(value) && value > 0) return value;

  // Existing W0/W1 sessions only stored a 60-minute expiry. Infer their last
  // activity conservatively so the shorter Option C policy cannot be bypassed
  // during the first release after this migration.
  const legacyExpiry = readSessionExpiry();
  if (legacyExpiry === null) return null;
  const inferredLastActivity = legacyExpiry - LEGACY_SESSION_DURATION_MS;
  return inferredLastActivity > 0 ? inferredLastActivity : null;
};

export const getSessionExpiryAt = (
  lastActivityAt: number,
  policy: Pick<SessionPolicy, "durationMs">,
): number => lastActivityAt + policy.durationMs;

export const writeSessionActivity = (
  lastActivityAt: number,
  policy: Pick<SessionPolicy, "durationMs">,
): number => {
  const expiry = getSessionExpiryAt(lastActivityAt, policy);
  writeLocalOnly(SESSION_LAST_ACTIVITY_KEY, String(lastActivityAt));
  writeLocalOnly(SESSION_EXPIRY_KEY, String(expiry));
  return expiry;
};

export const clearSessionTiming = () => {
  removeStorage(SESSION_LAST_ACTIVITY_KEY);
  removeStorage(SESSION_EXPIRY_KEY);
};

export const isStoredSessionExpired = (
  policy: Pick<SessionPolicy, "durationMs"> = {
    durationMs: NORMAL_SESSION_DURATION_MS,
  },
  now = Date.now(),
): boolean => {
  const lastActivityAt = readSessionLastActivity();
  if (lastActivityAt !== null) {
    return getSessionExpiryAt(lastActivityAt, policy) <= now;
  }
  const expiry = readSessionExpiry();
  return expiry !== null && expiry <= now;
};

export const shouldShowSessionWarning = (
  expiryAt: number,
  policy: Pick<SessionPolicy, "warningLeadMs">,
  now = Date.now(),
): boolean => {
  const remainingMs = expiryAt - now;
  return remainingMs > 0 && remainingMs <= policy.warningLeadMs;
};

export const normalizeSessionReturnPath = (
  pathname: string,
  search = "",
): string | null => {
  const normalizedPath = String(pathname || "").trim();
  const normalizedSearch = String(search || "").trim();
  if (!/^\/(student|teacher)(?:\/|$)/.test(normalizedPath)) return null;
  if (normalizedPath.includes("#") || normalizedSearch.includes("#"))
    return null;
  if (normalizedSearch && !normalizedSearch.startsWith("?")) return null;
  const target = `${normalizedPath}${normalizedSearch}`;
  return target.length <= 1200 ? target : null;
};

export const writeSessionReturnPath = (
  ownerUid: string,
  pathname: string,
  search = "",
  savedAt = Date.now(),
) => {
  const normalizedOwnerUid = String(ownerUid || "").trim();
  const path = normalizeSessionReturnPath(pathname, search);
  if (!normalizedOwnerUid || !path) return;
  writeLocalOnly(
    SESSION_RETURN_PATH_KEY,
    JSON.stringify({ ownerUid: normalizedOwnerUid, path, savedAt }),
  );
};

export const clearSessionReturnPath = () => {
  removeStorage(SESSION_RETURN_PATH_KEY);
};

export const consumeSessionReturnPath = (
  ownerUid: string,
  now = Date.now(),
): string | null => {
  const raw = readLocalOnly(SESSION_RETURN_PATH_KEY);
  if (!raw) return null;
  clearSessionReturnPath();
  try {
    const parsed = JSON.parse(raw) as {
      ownerUid?: unknown;
      path?: unknown;
      savedAt?: unknown;
    };
    const normalizedOwnerUid = String(ownerUid || "").trim();
    const savedAt = Number(parsed.savedAt);
    const path = normalizeSessionReturnPath(String(parsed.path || ""));
    if (
      !normalizedOwnerUid ||
      String(parsed.ownerUid || "").trim() !== normalizedOwnerUid ||
      !path ||
      !Number.isFinite(savedAt) ||
      savedAt <= 0 ||
      now - savedAt > SESSION_RETURN_PATH_MAX_AGE_MS
    ) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
};
