import { readLocalOnly, removeStorage, writeLocalOnly } from "./safeStorage";
import { isSemesterArchive } from "./semesterArchive";

export const DEVICE_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const DEVICE_SESSION_ACTIVITY_THROTTLE_MS = 30 * 1000;
export const DEVICE_SESSION_CHECK_MS = 60 * 1000;

interface DeviceSession {
  authTime: number;
  expiresAt: number;
}

// A browser can allow reads while rejecting writes (for example, at quota).
// Keep an unsaved update only until another tab changes the persisted value.
const pendingWrites = new Map<
  string,
  { session: DeviceSession; persistedValue: string | null | undefined }
>();

export const getDeviceSessionKey = (uid: string) =>
  `westoryDeviceSession:v1:${uid}`;

const parseSession = (raw: string | null): DeviceSession | null => {
  try {
    const saved = JSON.parse(raw || "null");
    return saved &&
      Number.isFinite(saved.authTime) &&
      saved.authTime > 0 &&
      Number.isFinite(saved.expiresAt) &&
      saved.expiresAt >= 0
      ? saved
      : null;
  } catch {
    return null;
  }
};

const readSession = (uid: string): DeviceSession | null => {
  try {
    const key = getDeviceSessionKey(uid);
    let raw: string | null;
    try {
      raw =
        typeof window !== "undefined" && !isSemesterArchive
          ? window.localStorage.getItem(key)
          : readLocalOnly(key);
      const pending = pendingWrites.get(key);
      if (pending) {
        const persisted = parseSession(raw);
        // After blocked reads recover, retain only a newer local deadline for
        // the same login. A removed key or different login remains authoritative.
        if (
          raw === pending.persistedValue ||
          (pending.persistedValue === undefined &&
            persisted?.authTime === pending.session.authTime &&
            persisted.expiresAt < pending.session.expiresAt)
        ) {
          pending.persistedValue = raw;
          return pending.session;
        }
        pendingWrites.delete(key);
      }
    } catch {
      raw = readLocalOnly(key);
    }
    // A missing local value is authoritative after another tab signs out.
    // Blocked reads continue to use safeStorage's in-memory fallback.
    return parseSession(raw);
  } catch {
    return null;
  }
};

const writeSession = (uid: string, session: DeviceSession) => {
  const key = getDeviceSessionKey(uid);
  const serialized = JSON.stringify(session);
  let persistedValue: string | null | undefined;
  if (typeof window !== "undefined" && !isSemesterArchive) {
    try {
      persistedValue = window.localStorage.getItem(key);
    } catch {
      persistedValue = pendingWrites.get(key)?.persistedValue;
    }
  }
  writeLocalOnly(key, serialized);
  if (typeof window !== "undefined" && !isSemesterArchive) {
    try {
      const saved = window.localStorage.getItem(key);
      if (
        saved === serialized ||
        (persistedValue !== undefined && saved !== persistedValue)
      ) {
        pendingWrites.delete(key);
      } else {
        pendingWrites.set(key, { session, persistedValue: saved });
      }
    } catch {
      pendingWrites.set(key, { session, persistedValue });
    }
  }
  return session;
};

export const readDeviceSession = (uid: string, authTime: number) => {
  const saved = readSession(uid);
  return saved?.authTime === authTime ? saved : null;
};

// Call only after a new, explicit sign-in. Automatic restoration must use
// initializeDeviceSession so reopening the app cannot revive an expired timer.
export const resetDeviceSession = (
  uid: string,
  authTime: number,
  now = Date.now(),
) => {
  if (!uid || !Number.isFinite(authTime) || authTime <= 0) return null;
  const saved = readSession(uid);
  if (saved && saved.authTime > authTime) return null;
  return writeSession(uid, {
    authTime,
    expiresAt: now + DEVICE_SESSION_DURATION_MS,
  });
};

export const initializeDeviceSession = (
  uid: string,
  authTime: number,
  now = Date.now(),
) => {
  const saved = readSession(uid);
  if (saved?.authTime === authTime) return saved;
  // A suspended tab must never overwrite a newer sign-in from another tab.
  if (saved && saved.authTime > authTime) return null;
  // The old global one-hour timer has no account/epoch identity. Existing
  // logins migrate once; only this version's persisted timer is reused.
  removeStorage("sessionExpiry");
  return resetDeviceSession(uid, authTime, now);
};

export const extendDeviceSession = (
  uid: string,
  authTime: number,
  now = Date.now(),
) => {
  const saved = readDeviceSession(uid, authTime);
  if (!saved || saved.expiresAt <= now) return saved;
  if (
    saved.expiresAt - now >
    DEVICE_SESSION_DURATION_MS - DEVICE_SESSION_ACTIVITY_THROTTLE_MS
  ) {
    return saved;
  }
  return writeSession(uid, {
    authTime,
    expiresAt: Math.max(saved.expiresAt, now + DEVICE_SESSION_DURATION_MS),
  });
};

export const clearDeviceSession = (uid: string) => {
  const key = getDeviceSessionKey(uid);
  pendingWrites.delete(key);
  removeStorage(key);
  removeStorage("sessionExpiry");
};
