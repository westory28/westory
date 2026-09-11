const { randomBytes } = require("node:crypto");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const {
  onCallWithStudentMaintenance,
} = require("./studentMaintenance");
// Session lifecycle is needed before profile creation and while awaiting a
// teacher. This exception never wraps a business command or query.
const onCall = (options, handler) => onCallWithStudentMaintenance(
  options, handler, { registrationBootstrap: true },
);

const REGION = "asia-northeast3";
const ADMIN_EMAIL = "westoria28@gmail.com";
const SCHOOL_EMAIL_PATTERN = /@yongshin-ms\.ms\.kr$/i;

const GENERAL_IDLE_MS = 30 * 60 * 1000;
const HIGH_RISK_IDLE_MS = 15 * 60 * 1000;
const RECENT_AUTH_MS = 5 * 60 * 1000;
const SESSION_TOUCH_MIN_INTERVAL_MS = 30 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

const SESSION_SCHEMA_VERSION = 2;
const SESSION_AUTHORITY_GENERATION = "w1r2-2026-08-09";
const MIN_CLIENT_PROTOCOL_VERSION = 2;
const SESSION_REVISION_BYTES = 32;
const SESSION_PROOF_FIELD = "_session";
const REAUTH_TRANSITION_MS = 90 * 1000;

const SESSION_IDLE_MODES = Object.freeze({
  ENFORCE: "ENFORCE",
  OBSERVE_ONLY: "OBSERVE_ONLY",
  DISABLED: "DISABLED",
});
const STAGING_PROJECT_ID = "westory-staging-177587430482";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const W10P_VISUAL_FIXTURE_ADMIN = Object.freeze({
  uid: "w10p-visual-admin",
  email: "w10p-visual-admin@yongshin-ms.ms.kr",
  fixtureOwner: "w10p-visual-parity",
  fixtureId: "w10p-visual-fixture-v1",
  fixtureRole: "admin",
});
const APP_CHECK_OBSERVATION_LOG_INTERVAL_MS = 5 * 60 * 1000;
let lastAppCheckObservationLogAt = 0;

const parseFirebaseProjectId = (value) => {
  try {
    return String(JSON.parse(String(value || "{}"))?.projectId || "").trim();
  } catch {
    return "";
  }
};

const resolveSessionAuthorityConfig = (environment = process.env) => {
  const projectId = String(
    environment.GCLOUD_PROJECT
      || environment.GOOGLE_CLOUD_PROJECT
      || parseFirebaseProjectId(environment.FIREBASE_CONFIG),
  ).trim();
  const configuredMode = String(environment.WESTORY_SESSION_IDLE_MODE || "")
    .trim()
    .toUpperCase();
  const configuredAppCheckMode = String(
    environment.WESTORY_APP_CHECK_MODE || "",
  ).trim().toUpperCase();
  const isDemo = projectId.startsWith("demo-westory-session-")
    || projectId === "demo-westory-session-authority";

  let allowedModes;
  let defaultMode;
  let allowedAppCheckModes;
  let defaultAppCheckMode;
  if (projectId === STAGING_PROJECT_ID) {
    allowedModes = [SESSION_IDLE_MODES.ENFORCE];
    defaultMode = SESSION_IDLE_MODES.ENFORCE;
    allowedAppCheckModes = [SESSION_IDLE_MODES.ENFORCE];
    defaultAppCheckMode = SESSION_IDLE_MODES.ENFORCE;
  } else if (isDemo) {
    allowedModes = [SESSION_IDLE_MODES.ENFORCE];
    defaultMode = SESSION_IDLE_MODES.ENFORCE;
    allowedAppCheckModes = [SESSION_IDLE_MODES.DISABLED];
    defaultAppCheckMode = SESSION_IDLE_MODES.DISABLED;
  } else if (projectId === PRODUCTION_PROJECT_ID) {
    allowedModes = [
      SESSION_IDLE_MODES.OBSERVE_ONLY,
      SESSION_IDLE_MODES.DISABLED,
    ];
    defaultMode = SESSION_IDLE_MODES.OBSERVE_ONLY;
    allowedAppCheckModes = Object.values(SESSION_IDLE_MODES);
    defaultAppCheckMode = SESSION_IDLE_MODES.OBSERVE_ONLY;
  } else {
    return {
      valid: false,
      projectId,
      mode: "INVALID",
      reason: "SESSION_PROJECT_NOT_ALLOWLISTED",
    };
  }

  const mode = configuredMode || defaultMode;
  const appCheckMode = configuredAppCheckMode || defaultAppCheckMode;
  if (!allowedModes.includes(mode) || !allowedAppCheckModes.includes(appCheckMode)) {
    return {
      valid: false,
      projectId,
      mode,
      reason: !allowedModes.includes(mode)
        ? "SESSION_IDLE_MODE_INVALID"
        : "SESSION_APP_CHECK_MODE_INVALID",
    };
  }

  return {
    valid: true,
    projectId,
    mode,
    appCheckMode,
    requireAppCheck: appCheckMode === SESSION_IDLE_MODES.ENFORCE,
    appCheckPromotionRequired:
      projectId === PRODUCTION_PROJECT_ID
      && appCheckMode !== SESSION_IDLE_MODES.ENFORCE,
    reason: "",
  };
};

const getSessionAuthorityConfig = () => {
  const config = resolveSessionAuthorityConfig();
  if (!config.valid) {
    console.error("Westory session authority configuration is invalid.", {
      projectId: config.projectId || "missing",
      mode: config.mode,
      reason: config.reason,
    });
    throw new HttpsError(
      "unavailable",
      "The Westory session authority is not configured for this environment.",
      { reason: "SESSION_AUTHORITY_CONFIG_INVALID" },
    );
  }
  return config;
};

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

const isTrustedW10PVisualFixtureAdmin = (request, identity, config) => {
  const token = request.auth?.token || {};
  return config.projectId === STAGING_PROJECT_ID
    && identity.uid === W10P_VISUAL_FIXTURE_ADMIN.uid
    && identity.email === W10P_VISUAL_FIXTURE_ADMIN.email
    && token.fixtureOwner === W10P_VISUAL_FIXTURE_ADMIN.fixtureOwner
    && token.fixtureId === W10P_VISUAL_FIXTURE_ADMIN.fixtureId
    && token.fixtureRole === W10P_VISUAL_FIXTURE_ADMIN.fixtureRole;
};

const getSessionRef = (uid, authTime) =>
  getFirestore().doc(`application_sessions/${uid}/sessions/${authTime}`);

const getReauthTransitionRef = (uid) =>
  getFirestore().doc(`application_session_transitions/${uid}`);

const timestampMillis = (value) =>
  value && typeof value.toMillis === "function" ? value.toMillis() : 0;

const isRecentAuthentication = (authTime, nowMs) => {
  const authTimeMs = authTime * 1000;
  const ageMs = nowMs - authTimeMs;
  return ageMs >= -MAX_CLOCK_SKEW_MS && ageMs <= RECENT_AUTH_MS;
};

const normalizeHandshake = (data) => ({
  authorityGeneration: String(data?.authorityGeneration || "").trim(),
  protocolVersion: Number(data?.protocolVersion || 0),
});

const normalizeSessionProof = (request) => {
  const proof = request.data?.[SESSION_PROOF_FIELD];
  return {
    authorityGeneration: String(proof?.authorityGeneration || "").trim(),
    protocolVersion: Number(proof?.protocolVersion || 0),
    revision: String(proof?.revision || "").trim(),
  };
};

const sessionHasCurrentProtocol = (session) =>
  Number(session?.schemaVersion) === SESSION_SCHEMA_VERSION
  && String(session?.authorityGeneration || "") === SESSION_AUTHORITY_GENERATION
  && Number.isInteger(session?.protocolVersion)
  && Number(session.protocolVersion) >= MIN_CLIENT_PROTOCOL_VERSION
  && typeof session?.sessionRevision === "string"
  && /^[a-f0-9]{64}$/.test(session.sessionRevision)
  && Object.values(SESSION_IDLE_MODES).includes(session?.authorityModeAtOpen);

const proofMatchesSession = (proof, session) =>
  proof.authorityGeneration === SESSION_AUTHORITY_GENERATION
  && Number.isInteger(proof.protocolVersion)
  && proof.protocolVersion >= MIN_CLIENT_PROTOCOL_VERSION
  && /^[a-f0-9]{64}$/.test(proof.revision)
  && proof.revision === session.sessionRevision;

const serializeSession = (data) => ({
  authTime: Number(data.authTime || 0),
  generalExpiresAt: timestampMillis(data.generalExpiresAt),
  highRiskExpiresAt: timestampMillis(data.highRiskExpiresAt),
  status: String(data.status || ""),
  authorityGeneration: String(data.authorityGeneration || ""),
  protocolVersion: Number(data.protocolVersion || 0),
  revision: String(data.sessionRevision || ""),
});

const throwRecentAuthenticationRequired = () => {
  throw new HttpsError(
    "failed-precondition",
    "Recent authentication is required for this command.",
    { reason: "RECENT_AUTH_REQUIRED", maxAgeSeconds: RECENT_AUTH_MS / 1000 },
  );
};

const observeSessionFailure = (config, identity, reason, options) => {
  console.warn("Westory session authority observation.", {
    projectId: config.projectId,
    mode: config.mode,
    uid: identity.uid,
    reason,
    scope: options.highRisk === true ? "HIGH_RISK" : "GENERAL",
  });
};

const assertAppCheckIfRequired = (request, config) => {
  if (config.requireAppCheck && !request.app?.appId) {
    throw new HttpsError(
      "unauthenticated",
      "A verified Westory application is required.",
      { reason: "APP_CHECK_REQUIRED" },
    );
  }
  if (config.appCheckMode === SESSION_IDLE_MODES.OBSERVE_ONLY && !request.app?.appId) {
    const nowMs = Date.now();
    if (nowMs - lastAppCheckObservationLogAt >= APP_CHECK_OBSERVATION_LOG_INTERVAL_MS) {
      lastAppCheckObservationLogAt = nowMs;
      console.warn("Westory App Check observation.", {
        projectId: config.projectId,
        mode: config.appCheckMode,
        reason: "APP_CHECK_MISSING",
      });
    }
  }
};

const resolveEffectiveIdleMode = (runtimeMode, modeAtOpen) => {
  if (
    runtimeMode === SESSION_IDLE_MODES.ENFORCE
    || modeAtOpen === SESSION_IDLE_MODES.ENFORCE
  ) {
    return SESSION_IDLE_MODES.ENFORCE;
  }
  if (
    runtimeMode === SESSION_IDLE_MODES.OBSERVE_ONLY
    || modeAtOpen === SESSION_IDLE_MODES.OBSERVE_ONLY
  ) {
    return SESSION_IDLE_MODES.OBSERVE_ONLY;
  }
  return SESSION_IDLE_MODES.DISABLED;
};

const assertActiveApplicationSession = async (request, options = {}) => {
  const identity = assertAllowedIdentity(request);
  const config = getSessionAuthorityConfig();
  const nowMs = Date.now();
  assertAppCheckIfRequired(request, config);

  if (options.recentAuth === true && !isRecentAuthentication(identity.authTime, nowMs)) {
    throwRecentAuthenticationRequired();
  }

  const sessionSnap = await getSessionRef(identity.uid, identity.authTime).get();
  const session = sessionSnap.exists ? sessionSnap.data() || {} : {};
  const expiryField = options.highRisk === true
    ? "highRiskExpiresAt"
    : "generalExpiresAt";
  const expiryMs = timestampMillis(session[expiryField]);
  let fenceFailureReason = "";

  if (!sessionSnap.exists) {
    fenceFailureReason = "SESSION_MISSING";
  } else if (
    session.status !== "active"
    || Number(session.authTime) !== identity.authTime
  ) {
    fenceFailureReason = "SESSION_EXPIRED";
  } else if (!sessionHasCurrentProtocol(session)) {
    fenceFailureReason = "SESSION_PROTOCOL_OUTDATED";
  } else if (!proofMatchesSession(normalizeSessionProof(request), session)) {
    fenceFailureReason = "SESSION_PROOF_INVALID";
  }

  if (fenceFailureReason) {
    throw new HttpsError(
      "unauthenticated",
      fenceFailureReason === "SESSION_PROOF_INVALID"
        ? "The Westory session proof is missing or invalid."
        : "The Westory application session has expired.",
      {
        reason: fenceFailureReason,
        scope: options.highRisk === true ? "HIGH_RISK" : "GENERAL",
      },
    );
  }

  const effectiveIdleMode = resolveEffectiveIdleMode(
    config.mode,
    session.authorityModeAtOpen,
  );
  const idleExpired = expiryMs <= nowMs;
  if (idleExpired && effectiveIdleMode === SESSION_IDLE_MODES.ENFORCE) {
    throw new HttpsError(
      "unauthenticated",
      "The Westory application session has expired.",
      {
        reason: "SESSION_EXPIRED",
        scope: options.highRisk === true ? "HIGH_RISK" : "GENERAL",
      },
    );
  }
  if (idleExpired && effectiveIdleMode === SESSION_IDLE_MODES.OBSERVE_ONLY) {
    observeSessionFailure(
      { ...config, mode: effectiveIdleMode },
      identity,
      "SESSION_IDLE_EXPIRED",
      options,
    );
  }

  return {
    ...identity,
    sessionRef: sessionSnap.exists ? sessionSnap.ref : null,
    session: sessionSnap.exists ? session : null,
    authorityMode: effectiveIdleMode,
    observedFailure: idleExpired ? "SESSION_IDLE_EXPIRED" : null,
  };
};

const openApplicationSession = onCall({ region: REGION }, async (request) => {
  const identity = assertAllowedIdentity(request);
  const config = getSessionAuthorityConfig();
  assertAppCheckIfRequired(request, config);
  const handshake = normalizeHandshake(request.data);
  const validHandshake = handshake.authorityGeneration === SESSION_AUTHORITY_GENERATION
    && Number.isInteger(handshake.protocolVersion)
    && handshake.protocolVersion >= MIN_CLIENT_PROTOCOL_VERSION;

  if (!validHandshake) {
    throw new HttpsError(
      "failed-precondition",
      "This Westory client protocol is no longer supported.",
      {
        reason: "SESSION_PROTOCOL_REQUIRED",
        authorityGeneration: SESSION_AUTHORITY_GENERATION,
        minProtocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
      },
    );
  }

  const db = getFirestore();
  const ref = getSessionRef(identity.uid, identity.authTime);
  const transitionRef = getReauthTransitionRef(identity.uid);

  return db.runTransaction(async (transaction) => {
    const nowMs = Date.now();
    const snap = await transaction.get(ref);
    const existing = snap.exists ? snap.data() || {} : null;

    if (existing) {
      const generalExpiryMs = timestampMillis(existing.generalExpiresAt);
      const activeFenceMatches = existing.status === "active"
        && Number(existing.authTime) === identity.authTime;
      if (activeFenceMatches && sessionHasCurrentProtocol(existing)) {
        const effectiveIdleMode = resolveEffectiveIdleMode(
          config.mode,
          existing.authorityModeAtOpen,
        );
        const idleExpired = generalExpiryMs <= nowMs;
        if (!idleExpired || effectiveIdleMode !== SESSION_IDLE_MODES.ENFORCE) {
          if (idleExpired && effectiveIdleMode === SESSION_IDLE_MODES.OBSERVE_ONLY) {
            observeSessionFailure(
              { ...config, mode: effectiveIdleMode },
              identity,
              "SESSION_IDLE_EXPIRED",
              { highRisk: false },
            );
          }
          transaction.delete(transitionRef);
          return {
            resumed: true,
            authorityMode: effectiveIdleMode,
            observedFailure: idleExpired ? "SESSION_IDLE_EXPIRED" : null,
            ...serializeSession(existing),
          };
        }
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
      schemaVersion: SESSION_SCHEMA_VERSION,
      authorityGeneration: SESSION_AUTHORITY_GENERATION,
      protocolVersion: validHandshake
        ? handshake.protocolVersion
        : MIN_CLIENT_PROTOCOL_VERSION,
      sessionRevision: randomBytes(SESSION_REVISION_BYTES).toString("hex"),
      authorityModeAtOpen: config.mode,
    };
    transaction.create(ref, session);
    transaction.delete(transitionRef);
    return {
      resumed: false,
      authorityMode: config.mode,
      ...serializeSession(session),
    };
  });
});

const beginApplicationSessionReauthentication = onCall(
  { region: REGION },
  async (request) => {
    const identity = await assertActiveApplicationSession(request, {
      highRisk: true,
    });
    const nowMs = Date.now();
    await getReauthTransitionRef(identity.uid).set({
      uid: identity.uid,
      status: "pending",
      fromAuthTime: identity.authTime,
      expiresAt: Timestamp.fromMillis(nowMs + REAUTH_TRANSITION_MS),
      createdAt: FieldValue.serverTimestamp(),
      authorityGeneration: SESSION_AUTHORITY_GENERATION,
      protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
      schemaVersion: 1,
    });
    return { expiresAt: nowMs + REAUTH_TRANSITION_MS };
  },
);

const touchApplicationSession = onCall({ region: REGION }, async (request) => {
  const identity = assertAllowedIdentity(request);
  const config = getSessionAuthorityConfig();
  assertAppCheckIfRequired(request, config);
  const requestedScope =
    String(request.data?.scope || "GENERAL").trim().toUpperCase() === "HIGH_RISK"
      ? "HIGH_RISK"
      : "GENERAL";
  if (
    requestedScope === "HIGH_RISK"
    && identity.email !== ADMIN_EMAIL
    && !isTrustedW10PVisualFixtureAdmin(request, identity, config)
  ) {
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
    const expiryField = requestedScope === "HIGH_RISK"
      ? "highRiskExpiresAt"
      : "generalExpiresAt";
    const expiryMs = timestampMillis(session[expiryField]);
    let fenceFailureReason = "";

    if (!snap.exists) {
      fenceFailureReason = "SESSION_MISSING";
    } else if (
      session.status !== "active"
      || Number(session.authTime) !== identity.authTime
    ) {
      fenceFailureReason = "SESSION_EXPIRED";
    } else if (!sessionHasCurrentProtocol(session)) {
      fenceFailureReason = "SESSION_PROTOCOL_OUTDATED";
    } else if (!proofMatchesSession(normalizeSessionProof(request), session)) {
      fenceFailureReason = "SESSION_PROOF_INVALID";
    }

    if (fenceFailureReason) {
      throw new HttpsError(
        "unauthenticated",
        "The Westory application session cannot be extended.",
        { reason: fenceFailureReason },
      );
    }

    const effectiveIdleMode = resolveEffectiveIdleMode(
      config.mode,
      session.authorityModeAtOpen,
    );
    const idleExpired = expiryMs <= nowMs;
    if (idleExpired && effectiveIdleMode === SESSION_IDLE_MODES.ENFORCE) {
      throw new HttpsError(
        "unauthenticated",
        "The Westory application session cannot be extended.",
        { reason: "SESSION_EXPIRED" },
      );
    }
    if (idleExpired && effectiveIdleMode === SESSION_IDLE_MODES.OBSERVE_ONLY) {
      observeSessionFailure(
        { ...config, mode: effectiveIdleMode },
        identity,
        "SESSION_IDLE_EXPIRED",
        { highRisk: requestedScope === "HIGH_RISK" },
      );
    }

    const lastTouchMs = timestampMillis(session.lastTouchAt);
    if (lastTouchMs > 0 && nowMs - lastTouchMs < SESSION_TOUCH_MIN_INTERVAL_MS) {
      return {
        throttled: true,
        authorityMode: effectiveIdleMode,
        ...serializeSession(session),
      };
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
      authorityMode: effectiveIdleMode,
      observedFailure: idleExpired ? "SESSION_IDLE_EXPIRED" : null,
      authTime: identity.authTime,
      generalExpiresAt: nowMs + GENERAL_IDLE_MS,
      highRiskExpiresAt: nowMs + HIGH_RISK_IDLE_MS,
      status: "active",
      authorityGeneration: SESSION_AUTHORITY_GENERATION,
      protocolVersion: Number(session.protocolVersion),
      revision: String(session.sessionRevision),
    };
  });
});

const closeApplicationSession = onCall({ region: REGION }, async (request) => {
  const identity = assertAllowedIdentity(request);
  const config = getSessionAuthorityConfig();
  assertAppCheckIfRequired(request, config);
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
  REAUTH_TRANSITION_MS,
  RECENT_AUTH_MS,
  MIN_CLIENT_PROTOCOL_VERSION,
  SESSION_AUTHORITY_GENERATION,
  SESSION_IDLE_MODES,
  SESSION_PROOF_FIELD,
  SESSION_SCHEMA_VERSION,
  assertActiveApplicationSession,
  resolveSessionAuthorityConfig,
  callableExports: {
    openApplicationSession,
    beginApplicationSessionReauthentication,
    touchApplicationSession,
    closeApplicationSession,
  },
};
