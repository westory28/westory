const {
  FieldValue,
  Timestamp,
  getFirestore,
} = require("firebase-admin/firestore");
const {
  HttpsError,
  onCall: firebaseOnCall,
} = require("firebase-functions/v2/https");
const { assertStudentRegistrationAccess } = require("./studentRegistrationAccess");

const REGION = "asia-northeast3";
const ADMIN_EMAIL = "westoria28@gmail.com";
const CONFIG_DOCUMENT_PATH = "site_settings/student_maintenance";
const STORED_CONFIG_KEYS = Object.freeze([
  "blockedRoles",
  "bypassUids",
  "enabled",
  "message",
  "revision",
  "startedAt",
  "title",
  "updatedAt",
  "updatedBy",
]);
const UPDATE_CONFIG_KEYS = Object.freeze([
  "blockedRoles",
  "bypassUids",
  "enabled",
  "message",
  "title",
]);
const MAX_BYPASS_UIDS = 20;
const MAX_UID_LENGTH = 128;
const MAX_TITLE_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 500;
const DEFAULT_DISABLED_CONFIG = Object.freeze({
  enabled: false,
  blockedRoles: ["student"],
  bypassUids: [],
  title: "위스토리 점검 안내",
  message: "현재 학생 서비스 점검이 진행되고 있지 않습니다.",
  revision: 0,
});

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value, expectedKeys) =>
  isRecord(value)
  && Object.keys(value).sort().join("|") === [...expectedKeys].sort().join("|");

const normalizeEmail = (value) =>
  String(value || "").trim().toLowerCase();

const assertCanonicalText = (fieldName, value, maxLength) => {
  if (typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a string.`);
  }
  if (!value || value !== value.trim() || value.length > maxLength) {
    throw new TypeError(
      `${fieldName} must be canonical text between 1 and ${maxLength} characters.`,
    );
  }
  return value;
};

const normalizeBlockedRoles = (value) => {
  if (
    !Array.isArray(value)
    || value.length !== 1
    || value[0] !== "student"
  ) {
    throw new TypeError("blockedRoles must be exactly ['student'].");
  }
  return ["student"];
};

const normalizeBypassUids = (value) => {
  if (!Array.isArray(value) || value.length > MAX_BYPASS_UIDS) {
    throw new TypeError(
      `bypassUids must be an array with at most ${MAX_BYPASS_UIDS} items.`,
    );
  }
  const seen = new Set();
  return value.map((item) => {
    if (
      typeof item !== "string"
      || !item
      || item !== item.trim()
      || item.length > MAX_UID_LENGTH
      || seen.has(item)
    ) {
      throw new TypeError(
        "bypassUids contains a non-canonical, duplicate, or invalid uid.",
      );
    }
    seen.add(item);
    return item;
  });
};

const normalizeStudentMaintenanceConfig = (value) => {
  if (!isRecord(value) || typeof value.enabled !== "boolean") {
    throw new TypeError("Student maintenance configuration is malformed.");
  }
  const revision = value.revision === undefined
    ? 0
    : value.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError("revision must be a non-negative safe integer.");
  }
  return {
    enabled: value.enabled,
    blockedRoles: normalizeBlockedRoles(value.blockedRoles),
    bypassUids: normalizeBypassUids(value.bypassUids),
    title: assertCanonicalText("title", value.title, MAX_TITLE_LENGTH),
    message: assertCanonicalText("message", value.message, MAX_MESSAGE_LENGTH),
    revision,
  };
};

const normalizeStoredStudentMaintenanceConfig = (value) => {
  if (!hasExactKeys(value, STORED_CONFIG_KEYS)) {
    throw new TypeError(
      "Stored student maintenance configuration must use the exact 9-field schema.",
    );
  }
  const normalized = normalizeStudentMaintenanceConfig(value);
  const startedAtIsValid = normalized.enabled
    ? value.startedAt instanceof Timestamp
    : value.startedAt === null;
  if (
    !startedAtIsValid
    || !(value.updatedAt instanceof Timestamp)
    || typeof value.updatedBy !== "string"
    || !value.updatedBy
    || value.updatedBy !== value.updatedBy.trim()
    || value.updatedBy.length > MAX_UID_LENGTH
  ) {
    throw new TypeError(
      "Stored student maintenance configuration is malformed.",
    );
  }
  return normalized;
};

const normalizeUpdatePayload = (value) => {
  if (!hasExactKeys(value, UPDATE_CONFIG_KEYS)) {
    throw new TypeError(
      "Maintenance updates must contain exactly enabled, blockedRoles, bypassUids, title, and message.",
    );
  }
  return normalizeStudentMaintenanceConfig(value);
};

const normalizeProfileRole = (value) => {
  if (
    typeof value !== "string"
    || value !== value.trim().toLowerCase()
    || !["student", "teacher", "staff"].includes(value)
  ) {
    return "";
  }
  return value;
};

const evaluateStudentMaintenanceAccess = ({
  auth,
  config,
  profile,
  profileExists = true,
}) => {
  const uid = typeof auth?.uid === "string" ? auth.uid.trim() : "";
  if (!uid) return { allowed: true, reason: "anonymous" };

  let normalizedConfig;
  try {
    normalizedConfig = normalizeStudentMaintenanceConfig(config);
  } catch (_error) {
    return {
      allowed: false,
      errorCode: "unavailable",
      reason: "config-malformed",
    };
  }

  if (!normalizedConfig.enabled) {
    return {
      allowed: true,
      reason: "maintenance-disabled",
      config: normalizedConfig,
    };
  }
  if (normalizeEmail(auth?.token?.email) === ADMIN_EMAIL) {
    return { allowed: true, reason: "admin-bypass", config: normalizedConfig };
  }
  if (normalizedConfig.bypassUids.includes(uid)) {
    return { allowed: true, reason: "uid-bypass", config: normalizedConfig };
  }
  if (!profileExists) {
    return {
      allowed: false,
      errorCode: "permission-denied",
      reason: "profile-missing",
      config: normalizedConfig,
    };
  }
  const role = isRecord(profile) ? normalizeProfileRole(profile.role) : "";
  if (!role) {
    return {
      allowed: false,
      errorCode: "permission-denied",
      reason: "profile-malformed",
      config: normalizedConfig,
    };
  }
  if (role === "student") {
    return {
      allowed: false,
      errorCode: "permission-denied",
      reason: "role-blocked",
      role,
      config: normalizedConfig,
    };
  }
  return {
    allowed: true,
    reason: "role-not-blocked",
    role,
    config: normalizedConfig,
  };
};

const throwAccessDecision = (decision) => {
  if (decision.allowed) return;
  if (decision.errorCode === "permission-denied") {
    const config = decision.config || {};
    throw new HttpsError(
      "permission-denied",
      config.message
        || "Student access is temporarily unavailable during maintenance.",
      {
        reason: "student-maintenance",
        maintenanceReason: decision.reason,
        title: config.title || "",
        revision: config.revision || 0,
      },
    );
  }
  throw new HttpsError(
    "unavailable",
    "Student maintenance access could not be verified. Please try again later.",
    { reason: decision.reason || "maintenance-check-failed" },
  );
};

const assertMaintenanceAdmin = (request) => {
  if (typeof request.auth?.uid !== "string" || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }
  if (
    request.auth.uid !== request.auth.uid.trim()
    || request.auth.uid.length > MAX_UID_LENGTH
  ) {
    throw new HttpsError(
      "permission-denied",
      "The administrator identity is malformed.",
      { reason: "MAINTENANCE_ADMIN_UID_INVALID" },
    );
  }
  if (normalizeEmail(request.auth.token?.email) !== ADMIN_EMAIL) {
    throw new HttpsError(
      "permission-denied",
      "Only the Westory administrator can update maintenance settings.",
    );
  }
  return { uid: request.auth.uid, email: ADMIN_EMAIL };
};

const buildAuditConfig = (value) => ({
  enabled: value?.enabled === true,
  blockedRoles: Array.isArray(value?.blockedRoles)
    ? value.blockedRoles.filter((item) => typeof item === "string").slice(0, 1)
    : [],
  bypassUids: Array.isArray(value?.bypassUids)
    ? value.bypassUids.filter((item) => typeof item === "string").slice(0, MAX_BYPASS_UIDS)
    : [],
  title: typeof value?.title === "string" ? value.title.slice(0, MAX_TITLE_LENGTH) : "",
  message: typeof value?.message === "string" ? value.message.slice(0, MAX_MESSAGE_LENGTH) : "",
  startedAt: value?.startedAt instanceof Timestamp ? value.startedAt : null,
  updatedAt: value?.updatedAt instanceof Timestamp ? value.updatedAt : null,
  updatedBy: typeof value?.updatedBy === "string" ? value.updatedBy.slice(0, MAX_UID_LENGTH) : "",
  revision: Number.isSafeInteger(value?.revision) && value.revision >= 0
    ? value.revision
    : 0,
});

const createStudentMaintenanceService = ({
  db = getFirestore(),
  serverTimestamp = () => FieldValue.serverTimestamp(),
} = {}) => {
  const readConfig = async () => {
    let snapshot;
    try {
      snapshot = await db.doc(CONFIG_DOCUMENT_PATH).get();
    } catch (error) {
      console.error("Failed to read student maintenance configuration:", error);
      throw new HttpsError(
        "unavailable",
        "Student maintenance access could not be verified. Please try again later.",
        { reason: "maintenance-config-read-failed" },
      );
    }
    if (!snapshot.exists) return DEFAULT_DISABLED_CONFIG;
    try {
      normalizeStoredStudentMaintenanceConfig(snapshot.data());
      return snapshot.data();
    } catch (error) {
      console.error("Student maintenance configuration is malformed:", error);
      throw new HttpsError(
        "unavailable",
        "Student maintenance access could not be verified. Please try again later.",
        { reason: "maintenance-config-malformed" },
      );
    }
  };

  const readProfile = async (uid) => {
    try {
      const snapshot = await db.doc(`users/${uid}`).get();
      return {
        exists: snapshot.exists,
        data: snapshot.exists ? snapshot.data() : undefined,
      };
    } catch (error) {
      console.error("Failed to read profile for maintenance access:", error);
      throw new HttpsError(
        "unavailable",
        "Student maintenance access could not be verified. Please try again later.",
        { reason: "maintenance-profile-read-failed" },
      );
    }
  };

  const assertRegistrationAccess = async (request) => {
    if (!request.auth?.uid || normalizeEmail(request.auth.token?.email) === ADMIN_EMAIL) return;
    const profile = await readProfile(request.auth.uid);
    assertStudentRegistrationAccess(profile.data, profile.exists);
  };

  const assertAccess = async (request) => {
    if (!request.auth?.uid) return;
    const config = await readConfig();
    const initialDecision = evaluateStudentMaintenanceAccess({
      auth: request.auth,
      config,
      profileExists: false,
    });
    if (initialDecision.allowed) return;
    if (initialDecision.reason !== "profile-missing") {
      throwAccessDecision(initialDecision);
    }
    const profile = await readProfile(request.auth.uid);
    throwAccessDecision(evaluateStudentMaintenanceAccess({
      auth: request.auth,
      config,
      profile: profile.data,
      profileExists: profile.exists,
    }));
  };

  const updateConfig = async (request) => {
    const actor = assertMaintenanceAdmin(request);
    let nextConfig;
    try {
      nextConfig = normalizeUpdatePayload(request.data);
    } catch (error) {
      throw new HttpsError("invalid-argument", error.message, {
        reason: "MAINTENANCE_CONFIG_INVALID",
      });
    }
    const configRef = db.doc(CONFIG_DOCUMENT_PATH);
    const auditRef = configRef.collection("audit").doc();
    let response;
    await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(configRef);
      const current = currentSnapshot.exists ? currentSnapshot.data() || {} : {};
      const previous = buildAuditConfig(current);
      const revision = previous.revision + 1;
      const now = serverTimestamp();
      const startedAt = nextConfig.enabled
        ? current.enabled === true && current.startedAt instanceof Timestamp
          ? current.startedAt
          : now
        : null;
      const saved = {
        enabled: nextConfig.enabled,
        blockedRoles: nextConfig.blockedRoles,
        bypassUids: nextConfig.bypassUids,
        title: nextConfig.title,
        message: nextConfig.message,
        startedAt,
        updatedAt: now,
        updatedBy: actor.uid,
        revision,
      };
      transaction.set(configRef, saved);
      transaction.set(auditRef, {
        action: previous.enabled === saved.enabled
          ? "updated"
          : saved.enabled ? "enabled" : "disabled",
        previous,
        next: saved,
        revision,
        createdAt: now,
        updatedBy: actor.uid,
        updatedByUid: actor.uid,
        updatedByEmail: actor.email,
      });
      response = {
        enabled: saved.enabled,
        blockedRoles: saved.blockedRoles,
        bypassUids: saved.bypassUids,
        title: saved.title,
        message: saved.message,
        revision,
        updatedBy: actor.uid,
      };
    });
    return response;
  };

  return { assertAccess, assertRegistrationAccess, readConfig, readProfile, updateConfig };
};

let defaultService;
const getDefaultService = () => {
  if (!defaultService) {
    try {
      defaultService = createStudentMaintenanceService();
    } catch (error) {
      const isBareNodeUnitHarness = error?.code === "app/no-app"
        && !process.env.GCLOUD_PROJECT
        && !process.env.GOOGLE_CLOUD_PROJECT
        && !process.env.FUNCTION_TARGET
        && !process.env.K_SERVICE
        && !process.env.FUNCTIONS_EMULATOR;
      if (!isBareNodeUnitHarness) throw error;
      defaultService = {
        assertAccess: async () => {},
      };
    }
  }
  return defaultService;
};

const withStudentMaintenanceGuard = (handler, options = {}) =>
  async (request) => {
    if (options.adminRecoveryOnly) {
      assertMaintenanceAdmin(request);
    } else {
      const service = options.service || getDefaultService();
      if (!options.registrationBootstrap) await service.assertRegistrationAccess?.(request);
      await service.assertAccess(request);
    }
    return handler(request);
  };

const onCallWithStudentMaintenance = (options, handler, guardOptions) =>
  firebaseOnCall(options, withStudentMaintenanceGuard(handler, guardOptions));

const createUpdateStudentMaintenanceConfigHandler = ({
  service = getDefaultService(),
  assertActiveApplicationSession,
} = {}) => {
  if (typeof assertActiveApplicationSession !== "function") {
    throw new TypeError("assertActiveApplicationSession is required.");
  }
  return async (request) => {
    assertMaintenanceAdmin(request);
    await assertActiveApplicationSession(request, {
      recentAuth: true,
      highRisk: true,
    });
    // Session proof is transport metadata, verified above. Keep the business
    // payload exact without discarding unknown application fields.
    const { _session, ...data } = request.data || {};
    return service.updateConfig({ ...request, data });
  };
};

const createUpdateStudentMaintenanceConfigCallable = ({
  service,
  assertActiveApplicationSession,
} = {}) => onCallWithStudentMaintenance(
  { region: REGION, enforceAppCheck: true },
  createUpdateStudentMaintenanceConfigHandler({
    service,
    assertActiveApplicationSession,
  }),
  { adminRecoveryOnly: true },
);

module.exports = {
  ADMIN_EMAIL,
  CONFIG_DOCUMENT_PATH,
  DEFAULT_DISABLED_CONFIG,
  STORED_CONFIG_KEYS,
  UPDATE_CONFIG_KEYS,
  createStudentMaintenanceService,
  createUpdateStudentMaintenanceConfigCallable,
  createUpdateStudentMaintenanceConfigHandler,
  evaluateStudentMaintenanceAccess,
  normalizeStoredStudentMaintenanceConfig,
  normalizeStudentMaintenanceConfig,
  normalizeUpdatePayload,
  onCallWithStudentMaintenance,
  withStudentMaintenanceGuard,
};
