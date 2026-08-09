const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const REGION = "asia-northeast3";
const ADMIN_EMAIL = "westoria28@gmail.com";
const SCHOOL_EMAIL_PATTERN = /@yongshin-ms\.ms\.kr$/i;

const GENERAL_IDLE_MS = 30 * 60 * 1000;
const HIGH_RISK_IDLE_MS = 15 * 60 * 1000;
const RECENT_AUTH_MS = 5 * 60 * 1000;
const SESSION_TOUCH_MIN_INTERVAL_MS = 30 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

const getAuthEmail = (request) =>
  String(request.auth?.token?.email || "")
    .trim()
    .toLowerCase();

const getAuthTimeSeconds = (request) => {
  const value = Number(request.auth?.token?.auth_time);
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpsError(
      "unauthenticated",
      "The authentication time is missing or invalid.",
      { reason: "SESSION_AUTH_TIME_INVALID" },
    );
  }
  return value;
};

const assertAllowedIdentity = (request) => {
  const uid = String(request.auth?.uid || "").trim();
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication is required.", {
      reason: "SESSION_AUTH_REQUIRED",
    });
  }

  const email = getAuthEmail(request);
  if (!email || (!SCHOOL_EMAIL_PATTERN.test(email) && email !== ADMIN_EMAIL)) {
    throw new HttpsError(
      "permission-denied",
      "This account cannot create a Westory application session.",
      { reason: "SESSION_ACCOUNT_NOT_ALLOWED" },
    );
  }

  return { uid, email, authTime: getAuthTimeSeconds(request) };
};

const getSessionRef = (uid, authTime) =>
  getFirestore().doc(`application_sessions/${uid}/sessions/${authTime}`);

const timestampMillis = (value) =>
  value && typeof value.toMillis === "function" ? value.toMillis() : 0;

const isRecentAuthentication = (authTime, nowMs) => {
  const authTimeMs = authTime * 1000;
  const ageMs = nowMs - authTimeMs;
  return ageMs >= -MAX_CLOCK_SKEW_MS && ageMs <= RECENT_AUTH_MS;
};

const serializeSession = (data) => ({
  authTime: Number(data.authTime || 0),
  generalExpiresAt: timestampMillis(data.generalExpiresAt),
  highRiskExpiresAt: timestampMillis(data.highRiskExpiresAt),
  status: String(data.status || ""),
});

const assertActiveApplicationSession = async (request, options = {}) => {
  const identity = assertAllowedIdentity(request);
  const nowMs = Date.now();
  const sessionSnap = await getSessionRef(identity.uid, identity.authTime).get();
  const session = sessionSnap.exists ? sessionSnap.data() || {} : {};
  const expiryField = options.highRisk === true
    ? "highRiskExpiresAt"
    : "generalExpiresAt";
  const expiryMs = timestampMillis(session[expiryField]);

  if (
    !sessionSnap.exists
    || session.status !== "active"
    || Number(session.authTime) !== identity.authTime
    || expiryMs <= nowMs
  ) {
    throw new HttpsError(
      "unauthenticated",
      "The Westory application session has expired.",
      {
        reason: !sessionSnap.exists
          ? "SESSION_MISSING"
          : "SESSION_EXPIRED",
        scope: options.highRisk === true ? "HIGH_RISK" : "GENERAL",
      },
    );
  }

  if (
    options.recentAuth === true
    && !isRecentAuthentication(identity.authTime, nowMs)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Recent authentication is required for this command.",
      { reason: "RECENT_AUTH_REQUIRED", maxAgeSeconds: RECENT_AUTH_MS / 1000 },
    );
  }

  return {
    ...identity,
    sessionRef: sessionSnap.ref,
    session,
  };
};

const openApplicationSession = onCall({ region: REGION }, async (request) => {
  const identity = assertAllowedIdentity(request);
  const db = getFirestore();
  const ref = getSessionRef(identity.uid, identity.authTime);

  return db.runTransaction(async (transaction) => {
    const nowMs = Date.now();
    const snap = await transaction.get(ref);
    const existing = snap.exists ? snap.data() || {} : null;

    if (existing) {
      const generalExpiryMs = timestampMillis(existing.generalExpiresAt);
      if (
        existing.status === "active"
        && Number(existing.authTime) === identity.authTime
        && generalExpiryMs > nowMs
      ) {
        return { resumed: true, ...serializeSession(existing) };
      }

      throw new HttpsError(
        "unauthenticated",
        "This application session cannot be reopened. Sign in again.",
        { reason: "SESSION_REAUTH_REQUIRED" },
      );
    }

    if (!isRecentAuthentication(identity.authTime, nowMs)) {
      throw new HttpsError(
        "unauthenticated",
        "A recent sign-in is required to start a Westory application session.",
        { reason: "SESSION_REAUTH_REQUIRED" },
      );
    }

    const session = {
      uid: identity.uid,
      email: identity.email,
      authTime: identity.authTime,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      lastActivityAt: FieldValue.serverTimestamp(),
      lastTouchAt: FieldValue.serverTimestamp(),
      generalExpiresAt: Timestamp.fromMillis(nowMs + GENERAL_IDLE_MS),
      highRiskExpiresAt: Timestamp.fromMillis(nowMs + HIGH_RISK_IDLE_MS),
      closedAt: null,
      schemaVersion: 1,
    };
    transaction.create(ref, session);
    return { resumed: false, ...serializeSession(session) };
  });
});

const touchApplicationSession = onCall({ region: REGION }, async (request) => {
  const identity = assertAllowedIdentity(request);
  const requestedScope =
    String(request.data?.scope || "GENERAL").trim().toUpperCase() === "HIGH_RISK"
      ? "HIGH_RISK"
      : "GENERAL";
  if (requestedScope === "HIGH_RISK" && identity.email !== ADMIN_EMAIL) {
    throw new HttpsError(
      "permission-denied",
      "Only the administrator can extend a high-risk application session.",
      { reason: "HIGH_RISK_SESSION_ADMIN_ONLY" },
    );
  }

  const db = getFirestore();
  const ref = getSessionRef(identity.uid, identity.authTime);
  return db.runTransaction(async (transaction) => {
    const nowMs = Date.now();
    const snap = await transaction.get(ref);
    const session = snap.exists ? snap.data() || {} : {};
    const generalExpiryMs = timestampMillis(session.generalExpiresAt);

    if (
      !snap.exists
      || session.status !== "active"
      || Number(session.authTime) !== identity.authTime
      || generalExpiryMs <= nowMs
    ) {
      throw new HttpsError(
        "unauthenticated",
        "The Westory application session has expired.",
        { reason: !snap.exists ? "SESSION_MISSING" : "SESSION_EXPIRED" },
      );
    }

    const lastTouchMs = timestampMillis(session.lastTouchAt);
    if (lastTouchMs > 0 && nowMs - lastTouchMs < SESSION_TOUCH_MIN_INTERVAL_MS) {
      return { throttled: true, ...serializeSession(session) };
    }

    const update = {
      lastActivityAt: FieldValue.serverTimestamp(),
      lastTouchAt: FieldValue.serverTimestamp(),
      generalExpiresAt: Timestamp.fromMillis(nowMs + GENERAL_IDLE_MS),
      highRiskExpiresAt: Timestamp.fromMillis(nowMs + HIGH_RISK_IDLE_MS),
    };
    transaction.update(ref, update);
    return {
      throttled: false,
      authTime: identity.authTime,
      generalExpiresAt: nowMs + GENERAL_IDLE_MS,
      highRiskExpiresAt: nowMs + HIGH_RISK_IDLE_MS,
      status: "active",
    };
  });
});

const closeApplicationSession = onCall({ region: REGION }, async (request) => {
  const identity = assertAllowedIdentity(request);
  const ref = getSessionRef(identity.uid, identity.authTime);
  const snap = await ref.get();
  if (!snap.exists) return { closed: false, reason: "SESSION_MISSING" };
  const session = snap.data() || {};
  if (Number(session.authTime) !== identity.authTime) {
    throw new HttpsError("permission-denied", "Session ownership mismatch.", {
      reason: "SESSION_OWNERSHIP_MISMATCH",
    });
  }
  if (session.status !== "closed") {
    await ref.set(
      {
        status: "closed",
        closedAt: FieldValue.serverTimestamp(),
        generalExpiresAt: Timestamp.fromMillis(0),
        highRiskExpiresAt: Timestamp.fromMillis(0),
      },
      { merge: true },
    );
  }
  return { closed: true };
});

module.exports = {
  GENERAL_IDLE_MS,
  HIGH_RISK_IDLE_MS,
  RECENT_AUTH_MS,
  assertActiveApplicationSession,
  callableExports: {
    openApplicationSession,
    touchApplicationSession,
    closeApplicationSession,
  },
};
