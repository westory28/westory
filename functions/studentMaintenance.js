const {
  FieldValue,
  Timestamp,
  getFirestore,
} = require("firebase-admin/firestore");
const {
  HttpsError,
  onCall: firebaseOnCall,
} = require("firebase-functions/v2/https");

const REGION = "asia-northeast3";
const ADMIN_EMAIL = "westoria28@gmail.com";
const CONFIG_DOCUMENT_PATH = "site_settings/student_maintenance";
const MAINTENANCE_ROLES = new Set(["student", "teacher", "staff"]);
const MAX_BLOCKED_ROLES = MAINTENANCE_ROLES.size;
const MAX_BYPASS_UIDS = 20;
const MAX_TITLE_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 500;
const STORED_CONFIG_KEYS = [
  "blockedRoles",
  "bypassUids",
  "enabled",
  "message",
  "revision",
  "startedAt",
  "title",
  "updatedAt",
  "updatedBy",
];
const DEFAULT_DISABLED_CONFIG = {
  enabled: false,
  blockedRoles: ["student"],
  bypassUids: [],
  title: "위스토리 2학기 준비 중",
  message: [
    "새 학기를 위한 시스템 점검과 서비스 개편이 진행 중입니다.",
    "학생 서비스는 점검이 완료될 때까지 잠시 이용할 수 없습니다.",
    "더 안정적이고 편리한 위스토리로 다시 만나겠습니다.",
  ].join("\n"),
  revision: 0,
};

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeRole = (value) => {
  if (typeof value !== "string") return "";
  const role = value.trim().toLowerCase();
  return MAINTENANCE_ROLES.has(role) ? role : "";
};

const normalizeProfileRole = (value) => {
  if (typeof value !== "string" || value !== value.trim().toLowerCase())
    return "";
  return MAINTENANCE_ROLES.has(value) ? value : "";
};

const normalizeUniqueStringArray = ({
  fieldName,
  value,
  maxItems,
  normalizeItem,
}) => {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(
      `${fieldName} must be an array with at most ${maxItems} items.`,
    );
  }

  const normalized = [];
  const seen = new Set();
  value.forEach((item) => {
    const nextItem = normalizeItem(item);
    if (!nextItem || seen.has(nextItem)) {
      throw new TypeError(
        `${fieldName} contains an invalid or duplicate value.`,
      );
    }
    seen.add(nextItem);
    normalized.push(nextItem);
  });
  return normalized;
};

const normalizeBlockedRoles = (value) => {
  const blockedRoles = normalizeUniqueStringArray({
    fieldName: "blockedRoles",
    value,
    maxItems: MAX_BLOCKED_ROLES,
    normalizeItem: normalizeRole,
  });
  if (blockedRoles.length !== 1 || blockedRoles[0] !== "student") {
    throw new TypeError("blockedRoles must contain only the student role.");
  }
  return blockedRoles;
};

const normalizeBypassUids = (value) =>
  normalizeUniqueStringArray({
    fieldName: "bypassUids",
    value,
    maxItems: MAX_BYPASS_UIDS,
    normalizeItem: (item) => {
      if (typeof item !== "string") return "";
      const uid = item.trim();
      return uid.length > 0 && uid.length <= 128 ? uid : "";
    },
  });

const normalizeRequiredText = (fieldName, value, maxLength) => {
  if (typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a string.`);
  }
  const text = value.trim();
  if (!text || text.length > maxLength) {
    throw new TypeError(
      `${fieldName} must contain between 1 and ${maxLength} characters.`,
    );
  }
  return text;
};

const normalizeStudentMaintenanceConfig = (value) => {
  if (!isRecord(value) || typeof value.enabled !== "boolean") {
    throw new TypeError("Student maintenance configuration is malformed.");
  }

  return {
    enabled: value.enabled,
    blockedRoles: normalizeBlockedRoles(value.blockedRoles),
    bypassUids: normalizeBypassUids(value.bypassUids),
    title: normalizeRequiredText("title", value.title, MAX_TITLE_LENGTH),
    message: normalizeRequiredText(
      "message",
      value.message,
      MAX_MESSAGE_LENGTH,
    ),
    revision:
      Number.isSafeInteger(value.revision) && value.revision >= 0
        ? value.revision
        : 0,
  };
};

const normalizeStoredStudentMaintenanceConfig = (value) => {
  const normalized = normalizeStudentMaintenanceConfig(value);
  const hasExactKeys =
    Object.keys(value).sort().join("|") === STORED_CONFIG_KEYS.join("|");
  const hasCanonicalAccessValues =
    value.blockedRoles.length === 1 &&
    value.blockedRoles[0] === "student" &&
    value.bypassUids.every(
      (uid, index) => uid === normalized.bypassUids[index],
    );
  const startedAtIsValid =
    (normalized.enabled && value.startedAt instanceof Timestamp) ||
    (!normalized.enabled && value.startedAt === null);
  if (
    !hasExactKeys ||
    !hasCanonicalAccessValues ||
    !startedAtIsValid ||
    !(value.updatedAt instanceof Timestamp) ||
    typeof value.updatedBy !== "string" ||
    !value.updatedBy.trim() ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  ) {
    throw new TypeError(
      "Stored student maintenance configuration is malformed.",
    );
  }
  return normalized;
};

const evaluateStudentMaintenanceAccess = ({
  auth,
  config,
  profile,
  profileExists = true,
}) => {
  const uid = typeof auth?.uid === "string" ? auth.uid.trim() : "";
  if (!uid) {
    return { allowed: true, reason: "anonymous" };
  }

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

  if (normalizedConfig.blockedRoles.includes(role)) {
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
      config.message ||
        "Student access is temporarily unavailable during maintenance.",
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

const readConfig = async () => {
  try {
    const snap = await getFirestore().doc(CONFIG_DOCUMENT_PATH).get();
    if (!snap.exists) return DEFAULT_DISABLED_CONFIG;
    const config = snap.data();
    normalizeStoredStudentMaintenanceConfig(config);
    return config;
  } catch (error) {
    console.error("Failed to read student maintenance configuration:", error);
    throw new HttpsError(
      "unavailable",
      "Student maintenance access could not be verified. Please try again later.",
      { reason: "maintenance-config-read-failed" },
    );
  }
};

const readProfile = async (uid) => {
  try {
    const snap = await getFirestore().doc(`users/${uid}`).get();
    return {
      exists: snap.exists,
      data: snap.exists ? snap.data() : undefined,
    };
  } catch (error) {
    console.error(
      "Failed to read user profile for student maintenance check:",
      error,
    );
    throw new HttpsError(
      "unavailable",
      "Student maintenance access could not be verified. Please try again later.",
      { reason: "maintenance-profile-read-failed" },
    );
  }
};

const assertStudentMaintenanceAccess = async (request) => {
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
  throwAccessDecision(
    evaluateStudentMaintenanceAccess({
      auth: request.auth,
      config,
      profile: profile.data,
      profileExists: profile.exists,
    }),
  );
};

const assertMaintenanceAdmin = (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }
  if (normalizeEmail(request.auth.token?.email) !== ADMIN_EMAIL) {
    throw new HttpsError(
      "permission-denied",
      "Only the Westory administrator can update student maintenance settings.",
    );
  }
};

const withStudentMaintenanceGuard =
  (handler, options = {}) =>
  async (request) => {
    if (options.adminRecoveryOnly) {
      assertMaintenanceAdmin(request);
    } else {
      await assertStudentMaintenanceAccess(request);
    }
    return handler(request);
  };

const onCallWithStudentMaintenance = (options, handler, guardOptions) =>
  firebaseOnCall(options, withStudentMaintenanceGuard(handler, guardOptions));

const buildAuditConfig = (value) => ({
  enabled: value?.enabled === true,
  blockedRoles: Array.isArray(value?.blockedRoles)
    ? value.blockedRoles
        .filter((item) => typeof item === "string")
        .slice(0, MAX_BLOCKED_ROLES)
    : [],
  bypassUids: Array.isArray(value?.bypassUids)
    ? value.bypassUids
        .filter((item) => typeof item === "string")
        .slice(0, MAX_BYPASS_UIDS)
    : [],
  title:
    typeof value?.title === "string"
      ? value.title.slice(0, MAX_TITLE_LENGTH)
      : "",
  message:
    typeof value?.message === "string"
      ? value.message.slice(0, MAX_MESSAGE_LENGTH)
      : "",
  startedAt: value?.startedAt ?? null,
  updatedAt: value?.updatedAt ?? null,
  updatedBy: typeof value?.updatedBy === "string" ? value.updatedBy : "",
  revision:
    Number.isSafeInteger(value?.revision) && value.revision >= 0
      ? value.revision
      : 0,
});

const updateStudentMaintenanceConfig = onCallWithStudentMaintenance(
  { region: REGION },
  async (request) => {
    let nextConfig;
    try {
      nextConfig = normalizeStudentMaintenanceConfig(request.data);
    } catch (error) {
      throw new HttpsError("invalid-argument", error.message);
    }

    const db = getFirestore();
    const configRef = db.doc(CONFIG_DOCUMENT_PATH);
    const auditRef = configRef.collection("audit").doc();
    let savedConfig;

    await db.runTransaction(async (transaction) => {
      const currentSnap = await transaction.get(configRef);
      const current = currentSnap.exists ? currentSnap.data() || {} : {};
      const previous = buildAuditConfig(current);
      const revision = previous.revision + 1;
      const now = FieldValue.serverTimestamp();
      const startedAt = nextConfig.enabled
        ? current.enabled === true && current.startedAt
          ? current.startedAt
          : now
        : null;

      savedConfig = {
        enabled: nextConfig.enabled,
        blockedRoles: nextConfig.blockedRoles,
        bypassUids: nextConfig.bypassUids,
        title: nextConfig.title,
        message: nextConfig.message,
        revision,
        startedAt,
        updatedAt: now,
        updatedBy: request.auth.uid,
      };

      transaction.set(configRef, savedConfig);
      transaction.set(auditRef, {
        action:
          previous.enabled === nextConfig.enabled
            ? "updated"
            : nextConfig.enabled
              ? "enabled"
              : "disabled",
        previous,
        next: {
          enabled: savedConfig.enabled,
          blockedRoles: savedConfig.blockedRoles,
          bypassUids: savedConfig.bypassUids,
          title: savedConfig.title,
          message: savedConfig.message,
          startedAt,
          updatedAt: now,
          updatedBy: request.auth.uid,
          revision,
        },
        revision,
        createdAt: now,
        updatedBy: request.auth.uid,
        updatedByUid: request.auth.uid,
        updatedByEmail: ADMIN_EMAIL,
      });
    });

    return {
      enabled: savedConfig.enabled,
      blockedRoles: savedConfig.blockedRoles,
      bypassUids: savedConfig.bypassUids,
      title: savedConfig.title,
      message: savedConfig.message,
      revision: savedConfig.revision,
      updatedBy: savedConfig.updatedBy,
    };
  },
  { adminRecoveryOnly: true },
);

module.exports = {
  CONFIG_DOCUMENT_PATH,
  evaluateStudentMaintenanceAccess,
  normalizeStudentMaintenanceConfig,
  normalizeStoredStudentMaintenanceConfig,
  onCallWithStudentMaintenance,
  updateStudentMaintenanceConfig,
  withStudentMaintenanceGuard,
};
