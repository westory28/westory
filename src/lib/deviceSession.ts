import { readLocalOnly, removeStorage, writeLocalOnly } from "./safeStorage";
import { isSemesterArchive } from "./semesterArchive";

export const DEVICE_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const DEVICE_SESSION_ACTIVITY_THROTTLE_MS = 30 * 1000;
export const DEVICE_SESSION_CHECK_MS = 60 * 1000;

interface DeviceSession {
  authTime: number;
  expiresAt: number;
}

export const getDeviceSessionKey = (uid: string) =>
  `westoryDeviceSession:v1:${uid}`;

const readSession = (uid: string): DeviceSession | null => {
  try {
    const key = getDeviceSessionKey(uid);
    let raw: string | null;
    try {
      raw =
        typeof window !== "undefined" && !isSemesterArchive
          ? window.localStorage.getItem(key)
          : readLocalOnly(key);
    } catch {
      raw = readLocalOnly(key);
    }
    // A missing local value is authoritative after another tab signs out.
    // Only blocked storage uses safeStorage's in-memory fallback.
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

const writeSession = (uid: string, session: DeviceSession) => {
  writeLocalOnly(getDeviceSessionKey(uid), JSON.stringify(session));
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
  removeStorage(getDeviceSessionKey(uid));
  removeStorage("sessionExpiry");
};

export const formatDeviceSessionRemaining = (seconds: number) => {
  if (seconds <= 0) return "만료";
  if (seconds >= 24 * 60 * 60) return `${Math.ceil(seconds / 86400)}일`;
  if (seconds >= 60 * 60) return `${Math.ceil(seconds / 3600)}시간`;
  return `${Math.ceil(seconds / 60)}분`;
};
