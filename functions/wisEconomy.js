const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const semesterCore = require("./semesterCore");
const archiveEnrollment = require("./archiveEnrollment");
const cutoverAuthorization = require("./cutoverAuthorization");
const sessionAuthority = require("./sessionAuthority");
const {
  onCallWithStudentMaintenance: onCall,
} = require("./studentMaintenance");

const REGION = "asia-northeast3";
const WIS_SCHEMA_VERSION = 1;
const WIS_POLICY_VERSION = "w7-v1";

const WIS_ECONOMY_COLLECTION = "semester_wis_economies";
const WIS_ACCOUNT_COLLECTION = "semester_wis_accounts";
const WIS_LEDGER_COLLECTION = "semester_wis_ledger";
const WIS_BALANCE_COLLECTION = "semester_wis_balances";
const WIS_RANKING_COLLECTION = "semester_wis_rankings";
const WIS_PRODUCT_COLLECTION = "wis_product_catalog";
const WIS_INVENTORY_COLLECTION = "semester_wis_inventory";
const WIS_ORDER_COLLECTION = "semester_wis_orders";
const WIS_RECONCILIATION_COLLECTION = "semester_wis_reconciliation_reports";
const WIS_LEGACY_ISSUE_COLLECTION = "wis_legacy_issues";
const WIS_HALL_OF_FAME_CONFIG_PATH = "site_settings/interface_config";
const WIS_QUERY_DEFAULT_LIMIT = 100;
const WIS_QUERY_MAX_LIMIT = 200;
const WIS_RECENT_LEDGER_LIMIT = 100;
const WIS_HALL_ACCOUNT_LIMIT = 2_000;
const WIS_REBUILD_LEDGER_LIMIT = 400;
const WIS_INTEGRITY_VERSION = "w10p-aggregate-v1";
const WIS_MANUAL_REVERSIBLE_TYPES = new Set(["GRANT", "DEDUCT", "ADJUST"]);
const AUTOMATIC_REWARD_ACTIVITIES = new Set(["quiz", "quiz_bonus", "history_classroom", "history_classroom_bonus", "map_tag"]);

const WIS_COMMAND_TYPES = Object.freeze({
  CREATE_SEMESTER_ECONOMY: "createSemesterEconomy",
  CREATE_WIS_ACCOUNTS: "createWisAccounts",
  GRANT_INITIAL_WIS: "grantInitialWis",
  GRANT_WIS: "grantWis",
  DEDUCT_WIS: "deductWis",
  ADJUST_WIS: "adjustWis",
  REVERSE_WIS_ENTRY: "reverseWisEntry",
  REBUILD_WIS_PROJECTION: "rebuildWisProjection",
  TRANSITION_WIS_ECONOMY: "transitionWisEconomy",
  UPSERT_WIS_PRODUCT: "upsertWisProduct",
  UPSERT_WIS_INVENTORY: "upsertWisInventory",
  PLACE_WIS_ORDER: "placeWisOrder",
  REVIEW_WIS_ORDER: "reviewWisOrder",
  SAVE_WIS_HALL_OF_FAME_CONFIG: "saveWisHallOfFameConfig",
});

const STUDENT_COMMAND_TYPES = new Set([WIS_COMMAND_TYPES.PLACE_WIS_ORDER]);
const HIGH_RISK_COMMAND_TYPES = new Set(
  Object.values(WIS_COMMAND_TYPES).filter(
    (type) => !STUDENT_COMMAND_TYPES.has(type),
  ),
);

const fail = (code, message, reason, details = {}) => {
  throw new HttpsError(code, message, { reason, ...details });
};
const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const canonicalJson = (value) => {
  const visit = (current) => {
    if (Array.isArray(current)) return current.map(visit);
    if (current && typeof current === "object") {
      return Object.fromEntries(
        Object.keys(current)
          .sort()
          .filter((key) => current[key] !== undefined)
          .map((key) => [key, visit(current[key])]),
      );
    }
    return current;
  };
  return JSON.stringify(visit(value));
};
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const allowed = (value, keys, label) => {
  if (!isObject(value))
    fail(
      "invalid-argument",
      `${label} must be an object.`,
      "WIS_PAYLOAD_INVALID",
    );
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  if (extra.length)
    fail(
      "invalid-argument",
      `${label} contains unsupported fields.`,
      "WIS_PAYLOAD_INVALID",
      { fields: extra },
    );
};
const text = (value, label, max = 160) => {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > max ||
    value.includes("/")
  ) {
    fail("invalid-argument", `${label} is invalid.`, "WIS_PAYLOAD_INVALID", {
      field: label,
    });
  }
  return value;
};
const optionalText = (value, label, max = 500) =>
  value === undefined || value === null || value === ""
    ? ""
    : text(value, label, max);
const normalizeOrderMemo = (value) => {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.trim().length > 500)
    fail(
      "invalid-argument",
      "구매 메모는 500자 이내로 입력해 주세요.",
      "WIS_PAYLOAD_INVALID",
      { field: "memo" },
    );
  return value.trim();
};
const integer = (value, label, { min = 0, max = 1_000_000 } = {}) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail("invalid-argument", `${label} is invalid.`, "WIS_PAYLOAD_INVALID", {
      field: label,
    });
  return value;
};
const revision = (value, label = "expectedRevision") =>
  integer(value, label, { min: 1, max: Number.MAX_SAFE_INTEGER });
const nullableRevision = (value, label) =>
  value === null ? null : revision(value, label);
const semesterId = (value) => semesterCore.normalizeSemesterId(value);
const hashId = (prefix, ...parts) => `${prefix}_${sha256(parts.join("\n"))}`;
const accountIdFor = (scope, uid) => hashId("wisacct", scope, uid);
const inventoryIdFor = (scope, productId) => hashId("wisinv", scope, productId);
const ledgerIdFor = (scope, accountId, type, sourceId) =>
  hashId("wisled", scope, accountId, type, sourceId);
const orderIdFor = (scope, accountId, inventoryId, commandId) =>
  hashId("wisord", scope, accountId, inventoryId, commandId);
const economyPath = (scope) => `${WIS_ECONOMY_COLLECTION}/${scope}`;
const accountPath = (id) => `${WIS_ACCOUNT_COLLECTION}/${id}`;
const balancePath = (id) => `${WIS_BALANCE_COLLECTION}/${id}`;
const rankingPath = (id) => `${WIS_RANKING_COLLECTION}/${id}`;
const ledgerPath = (id) => `${WIS_LEDGER_COLLECTION}/${id}`;
const inventoryPath = (id) => `${WIS_INVENTORY_COLLECTION}/${id}`;
const productPath = (id) => `${WIS_PRODUCT_COLLECTION}/${id}`;
const orderPath = (id) => `${WIS_ORDER_COLLECTION}/${id}`;
const manifestPath = (scope) =>
  `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${scope}`;
const enrollmentPath = (id) =>
  `${archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION}/${id}`;
const enrollmentSlotPath = (scope, studentUid) =>
  `${archiveEnrollment.ENROLLMENT_SLOT_COLLECTION}/${archiveEnrollment.buildEnrollmentSlotId(scope, studentUid)}`;
const classPath = (id) =>
  `${archiveEnrollment.SEMESTER_CLASS_COLLECTION}/${id}`;

const readCanonicalActiveEnrollment = async (
  transaction,
  scope,
  studentUid,
) => {
  const slot = await transaction.get(enrollmentSlotPath(scope, studentUid));
  const activeEnrollmentId = String(slot.data?.activeEnrollmentId || "").trim();
  if (!slot.exists || !activeEnrollmentId) return null;
  const enrollment = await transaction.get(enrollmentPath(activeEnrollmentId));
  const data = enrollment.data || {};
  if (
    !enrollment.exists ||
    String(data.enrollmentId || "") !== activeEnrollmentId ||
    String(data.semesterId || "") !== scope ||
    String(data.studentUid || "") !== studentUid ||
    data.enrollmentStatus !== "ACTIVE"
  )
    return null;
  return data;
};

const DEFAULT_WIS_HALL_OF_FAME_CONFIG = Object.freeze({
  podiumImageUrl: "",
  podiumStoragePath: "",
  positionPreset: "classic_podium_v1",
  positions: {
    desktop: {
      first: { leftPercent: 50, topPercent: 26, widthPercent: 21 },
      second: { leftPercent: 26.5, topPercent: 40.5, widthPercent: 18 },
      third: { leftPercent: 73.5, topPercent: 40.5, widthPercent: 18 },
    },
    mobile: {
      first: { leftPercent: 50, topPercent: 28, widthPercent: 28 },
      second: { leftPercent: 28, topPercent: 46, widthPercent: 21 },
      third: { leftPercent: 72, topPercent: 46, widthPercent: 21 },
    },
  },
  leaderboardPanel: {
    desktop: { leftPercent: 71, topPercent: 0, widthPercent: 29 },
    mobile: { leftPercent: 50, topPercent: 0, widthPercent: 100 },
  },
  publicRange: { gradeRankLimit: 10, classRankLimit: 10, includeTies: true },
  recognitionPopup: { enabled: true, gradeEnabled: true, classEnabled: true },
});

const boundedNumber = (value, label, minimum, maximum, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    fail("invalid-argument", `${label} is invalid.`, "WIS_PAYLOAD_INVALID", {
      field: label,
    });
  }
  return parsed;
};

const displayText = (value, label, max, fallback = "") => {
  if (value === undefined || value === null) return fallback;
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail("invalid-argument", `${label} is invalid.`, "WIS_PAYLOAD_INVALID", {
      field: label,
    });
  }
  return value;
};

const normalizeHallPosition = (value, fallback, label, strict) => {
  const input = isObject(value) ? value : {};
  if (strict)
    allowed(input, ["leftPercent", "topPercent", "widthPercent"], label);
  return {
    leftPercent: boundedNumber(
      input.leftPercent,
      `${label}.leftPercent`,
      0,
      100,
      fallback.leftPercent,
    ),
    topPercent: boundedNumber(
      input.topPercent,
      `${label}.topPercent`,
      0,
      100,
      fallback.topPercent,
    ),
    widthPercent: boundedNumber(
      input.widthPercent,
      `${label}.widthPercent`,
      8,
      100,
      fallback.widthPercent,
    ),
  };
};

const normalizeHallDevicePositions = (value, fallback, label, strict) => {
  const input = isObject(value) ? value : {};
  if (strict) allowed(input, ["first", "second", "third"], label);
  return {
    first: normalizeHallPosition(
      input.first,
      fallback.first,
      `${label}.first`,
      strict,
    ),
    second: normalizeHallPosition(
      input.second,
      fallback.second,
      `${label}.second`,
      strict,
    ),
    third: normalizeHallPosition(
      input.third,
      fallback.third,
      `${label}.third`,
      strict,
    ),
  };
};

const normalizeWisHallOfFameConfig = (value, { strict = false } = {}) => {
  const input = isObject(value) ? value : {};
  if (strict) {
    allowed(
      input,
      [
        "podiumImageUrl",
        "podiumStoragePath",
        "positionPreset",
        "positions",
        "leaderboardPanel",
        "publicRange",
        "recognitionPopup",
      ],
      "hallOfFame",
    );
  }
  const positions = isObject(input.positions) ? input.positions : {};
  const leaderboardPanel = isObject(input.leaderboardPanel)
    ? input.leaderboardPanel
    : {};
  const publicRange = isObject(input.publicRange) ? input.publicRange : {};
  const recognitionPopup = isObject(input.recognitionPopup)
    ? input.recognitionPopup
    : {};
  if (strict) {
    allowed(positions, ["desktop", "mobile"], "hallOfFame.positions");
    allowed(
      leaderboardPanel,
      ["desktop", "mobile"],
      "hallOfFame.leaderboardPanel",
    );
    allowed(
      publicRange,
      ["gradeRankLimit", "classRankLimit", "includeTies"],
      "hallOfFame.publicRange",
    );
    allowed(
      recognitionPopup,
      ["enabled", "gradeEnabled", "classEnabled"],
      "hallOfFame.recognitionPopup",
    );
  }
  const booleanValue = (raw, fallback, label) => {
    if (raw === undefined || raw === null) return fallback;
    if (typeof raw !== "boolean")
      fail("invalid-argument", `${label} is invalid.`, "WIS_PAYLOAD_INVALID", {
        field: label,
      });
    return raw;
  };
  return {
    podiumImageUrl: displayText(
      input.podiumImageUrl,
      "hallOfFame.podiumImageUrl",
      2000,
      "",
    ),
    podiumStoragePath: displayText(
      input.podiumStoragePath,
      "hallOfFame.podiumStoragePath",
      500,
      "",
    ),
    positionPreset:
      displayText(
        input.positionPreset,
        "hallOfFame.positionPreset",
        80,
        DEFAULT_WIS_HALL_OF_FAME_CONFIG.positionPreset,
      ) || DEFAULT_WIS_HALL_OF_FAME_CONFIG.positionPreset,
    positions: {
      desktop: normalizeHallDevicePositions(
        positions.desktop,
        DEFAULT_WIS_HALL_OF_FAME_CONFIG.positions.desktop,
        "hallOfFame.positions.desktop",
        strict,
      ),
      mobile: normalizeHallDevicePositions(
        positions.mobile,
        DEFAULT_WIS_HALL_OF_FAME_CONFIG.positions.mobile,
        "hallOfFame.positions.mobile",
        strict,
      ),
    },
    leaderboardPanel: {
      desktop: normalizeHallPosition(
        leaderboardPanel.desktop,
        DEFAULT_WIS_HALL_OF_FAME_CONFIG.leaderboardPanel.desktop,
        "hallOfFame.leaderboardPanel.desktop",
        strict,
      ),
      mobile: normalizeHallPosition(
        leaderboardPanel.mobile,
        DEFAULT_WIS_HALL_OF_FAME_CONFIG.leaderboardPanel.mobile,
        "hallOfFame.leaderboardPanel.mobile",
        strict,
      ),
    },
    publicRange: {
      gradeRankLimit: Math.round(
        boundedNumber(
          publicRange.gradeRankLimit,
          "hallOfFame.publicRange.gradeRankLimit",
          4,
          20,
          10,
        ),
      ),
      classRankLimit: Math.round(
        boundedNumber(
          publicRange.classRankLimit,
          "hallOfFame.publicRange.classRankLimit",
          4,
          20,
          10,
        ),
      ),
      includeTies: booleanValue(
        publicRange.includeTies,
        true,
        "hallOfFame.publicRange.includeTies",
      ),
    },
    recognitionPopup: {
      enabled: booleanValue(
        recognitionPopup.enabled,
        true,
        "hallOfFame.recognitionPopup.enabled",
      ),
      gradeEnabled: booleanValue(
        recognitionPopup.gradeEnabled,
        true,
        "hallOfFame.recognitionPopup.gradeEnabled",
      ),
      classEnabled: booleanValue(
        recognitionPopup.classEnabled,
        true,
        "hallOfFame.recognitionPopup.classEnabled",
      ),
    },
  };
};

const normalizeWisPayload = (commandType, raw) => {
  const payload = raw || {};
  const common = ["semesterId", "expectedSemesterRevision"];
  const cutoverPlanId = optionalText(
    payload.cutoverPlanId,
    "cutoverPlanId",
    80,
  );
  const cutoverOperationKey = optionalText(
    payload.cutoverOperationKey,
    "cutoverOperationKey",
    80,
  );
  if (Boolean(cutoverPlanId) !== Boolean(cutoverOperationKey)) {
    fail(
      "invalid-argument",
      "cutoverPlanId and cutoverOperationKey must be provided together.",
      "WIS_PAYLOAD_INVALID",
    );
  }
  const cutover = cutoverPlanId ? { cutoverPlanId, cutoverOperationKey } : {};
  if (commandType === WIS_COMMAND_TYPES.CREATE_SEMESTER_ECONOMY) {
    allowed(
      payload,
      [
        ...common,
        "cutoverPlanId",
        "cutoverOperationKey",
        "displayName",
        "currencyName",
        "initialGrantAmount",
      ],
      "createSemesterEconomy payload",
    );
    return {
      semesterId: semesterId(payload.semesterId),
      expectedSemesterRevision: revision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      ...cutover,
      displayName: text(payload.displayName, "displayName", 120),
      currencyName: text(payload.currencyName, "currencyName", 20),
      initialGrantAmount: integer(
        payload.initialGrantAmount,
        "initialGrantAmount",
      ),
    };
  }
  if (commandType === WIS_COMMAND_TYPES.CREATE_WIS_ACCOUNTS) {
    allowed(
      payload,
      [
        ...common,
        "cutoverPlanId",
        "cutoverOperationKey",
        "expectedEconomyRevision",
        "enrollmentIds",
        "reason",
      ],
      "createWisAccounts payload",
    );
    if (
      !Array.isArray(payload.enrollmentIds) ||
      payload.enrollmentIds.length < 1 ||
      payload.enrollmentIds.length > 100
    )
      fail(
        "invalid-argument",
        "enrollmentIds is invalid.",
        "WIS_PAYLOAD_INVALID",
      );
    const enrollmentIds = payload.enrollmentIds.map((id, index) =>
      text(id, `enrollmentIds[${index}]`, 180),
    );
    if (new Set(enrollmentIds).size !== enrollmentIds.length)
      fail(
        "invalid-argument",
        "enrollmentIds contains duplicates.",
        "WIS_PAYLOAD_INVALID",
      );
    return {
      semesterId: semesterId(payload.semesterId),
      expectedSemesterRevision: revision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      ...cutover,
      expectedEconomyRevision: revision(
        payload.expectedEconomyRevision,
        "expectedEconomyRevision",
      ),
      enrollmentIds,
      reason: text(payload.reason, "reason", 500),
    };
  }
  if (
    [
      WIS_COMMAND_TYPES.GRANT_INITIAL_WIS,
      WIS_COMMAND_TYPES.GRANT_WIS,
      WIS_COMMAND_TYPES.DEDUCT_WIS,
    ].includes(commandType)
  ) {
    allowed(
      payload,
      [
        ...common,
        "expectedEconomyRevision",
        "accountId",
        "expectedAccountRevision",
        "amount",
        "sourceId",
        "reason",
      ],
      `${commandType} payload`,
    );
    return {
      semesterId: semesterId(payload.semesterId),
      expectedSemesterRevision: revision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      expectedEconomyRevision: revision(
        payload.expectedEconomyRevision,
        "expectedEconomyRevision",
      ),
      accountId: text(payload.accountId, "accountId", 80),
      expectedAccountRevision: revision(
        payload.expectedAccountRevision,
        "expectedAccountRevision",
      ),
      amount: integer(payload.amount, "amount", { min: 1 }),
      sourceId: text(payload.sourceId, "sourceId", 180),
      reason: text(payload.reason, "reason", 500),
    };
  }
  if (commandType === WIS_COMMAND_TYPES.ADJUST_WIS) {
    allowed(
      payload,
      [
        ...common,
        "expectedEconomyRevision",
        "accountId",
        "expectedAccountRevision",
        "delta",
        "sourceId",
        "reason",
      ],
      "adjustWis payload",
    );
    const delta =
      integer(Math.abs(payload.delta), "delta", { min: 1 }) *
      Math.sign(payload.delta || 0);
    if (!delta)
      fail("invalid-argument", "delta is invalid.", "WIS_PAYLOAD_INVALID");
    return {
      semesterId: semesterId(payload.semesterId),
      expectedSemesterRevision: revision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      expectedEconomyRevision: revision(
        payload.expectedEconomyRevision,
        "expectedEconomyRevision",
      ),
      accountId: text(payload.accountId, "accountId", 80),
      expectedAccountRevision: revision(
        payload.expectedAccountRevision,
        "expectedAccountRevision",
      ),
      delta,
      sourceId: text(payload.sourceId, "sourceId", 180),
      reason: text(payload.reason, "reason", 500),
    };
  }
  if (commandType === WIS_COMMAND_TYPES.REVERSE_WIS_ENTRY) {
    allowed(
      payload,
      [
        ...common,
        "expectedEconomyRevision",
        "accountId",
        "expectedAccountRevision",
        "ledgerEntryId",
        "reason",
      ],
      "reverseWisEntry payload",
    );
    return {
      semesterId: semesterId(payload.semesterId),
      expectedSemesterRevision: revision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      expectedEconomyRevision: revision(
        payload.expectedEconomyRevision,
        "expectedEconomyRevision",
      ),
      accountId: text(payload.accountId, "accountId", 80),
      expectedAccountRevision: revision(
        payload.expectedAccountRevision,
        "expectedAccountRevision",
      ),
      ledgerEntryId: text(payload.ledgerEntryId, "ledgerEntryId", 80),
      reason: text(payload.reason, "reason", 500),
    };
  }
  if (commandType === WIS_COMMAND_TYPES.REBUILD_WIS_PROJECTION) {
    allowed(
      payload,
      [...common, "expectedEconomyRevision", "accountId", "reason"],
      "rebuildWisProjection payload",
    );
    return {
      semesterId: semesterId(payload.semesterId),
      expectedSemesterRevision: revision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      expectedEconomyRevision: revision(
        payload.expectedEconomyRevision,
        "expectedEconomyRevision",
      ),
      accountId: text(payload.accountId, "accountId", 80),
      reason: text(payload.reason, "reason", 500),
    };
  }
  if (commandType === WIS_COMMAND_TYPES.TRANSITION_WIS_ECONOMY) {
    allowed(
      payload,
      [...common, "expectedEconomyRevision", "targetStatus", "reason"],
      "transitionWisEconomy payload",
    );
    if (
      !["ACTIVE_INITIALIZING", "ACTIVE_OPEN", "CLOSED", "ARCHIVED"].includes(
        payload.targetStatus,
      )
    )
      fail(
        "invalid-argument",
        "targetStatus is invalid.",
        "WIS_PAYLOAD_INVALID",
      );
    return {
      semesterId: semesterId(payload.semesterId),
      expectedSemesterRevision: revision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      expectedEconomyRevision: revision(
        payload.expectedEconomyRevision,
        "expectedEconomyRevision",
      ),
      targetStatus: payload.targetStatus,
      reason: text(payload.reason, "reason", 500),
    };
  }
  if (commandType === WIS_COMMAND_TYPES.UPSERT_WIS_PRODUCT) {
    allowed(
      payload,
      [
        ...common,
        "expectedEconomyRevision",
        "productId",
        "expectedProductRevision",
        "name",
        "description",
        "imageUrl",
        "active",
        "reason",
      ],
      "upsertWisProduct payload",
    );
    if (typeof payload.active !== "boolean")
      fail("invalid-argument", "active is invalid.", "WIS_PAYLOAD_INVALID");
    const name = text(payload.name, "name", 120);
    return {
      semesterId: semesterId(payload.semesterId),
      expectedSemesterRevision: revision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      expectedEconomyRevision: revision(
        payload.expectedEconomyRevision,
        "expectedEconomyRevision",
      ),
      productId: payload.productId
        ? text(payload.productId, "productId", 80)
        : hashId("wisprod", name),
      expectedProductRevision: nullableRevision(
        payload.expectedProductRevision,
        "expectedProductRevision",
      ),
      name,
      description: optionalText(payload.description, "description", 1000),
      imageUrl: optionalText(payload.imageUrl, "imageUrl", 1000),
      active: payload.active,
      reason: text(payload.reason, "reason", 500),
    };
  }
  if (commandType === WIS_COMMAND_TYPES.UPSERT_WIS_INVENTORY) {
    allowed(
      payload,
      [
        ...common,
        "expectedEconomyRevision",
        "productId",
        "expectedInventoryRevision",
        "price",
        "stock",
        "active",
        "reason",
      ],
      "upsertWisInventory payload",
    );
    if (typeof payload.active !== "boolean")
      fail("invalid-argument", "active is invalid.", "WIS_PAYLOAD_INVALID");
    const scope = semesterId(payload.semesterId);
    const productId = text(payload.productId, "productId", 80);
    return {
      semesterId: scope,
      expectedSemesterRevision: revision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      expectedEconomyRevision: revision(
        payload.expectedEconomyRevision,
        "expectedEconomyRevision",
      ),
      productId,
      inventoryId: inventoryIdFor(scope, productId),
      expectedInventoryRevision: nullableRevision(
        payload.expectedInventoryRevision,
        "expectedInventoryRevision",
      ),
      price: integer(payload.price, "price", { min: 1 }),
      stock: integer(payload.stock, "stock"),
      active: payload.active,
      reason: text(payload.reason, "reason", 500),
    };
  }
  if (commandType === WIS_COMMAND_TYPES.PLACE_WIS_ORDER) {
    allowed(
      payload,
      [
        ...common,
        "expectedEconomyRevision",
        "inventoryId",
        "expectedInventoryRevision",
        "expectedAccountRevision",
        "quantity",
        "memo",
      ],
      "placeWisOrder payload",
    );
    return {
      semesterId: semesterId(payload.semesterId),
      expectedSemesterRevision: revision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      expectedEconomyRevision: revision(
        payload.expectedEconomyRevision,
        "expectedEconomyRevision",
      ),
      inventoryId: text(payload.inventoryId, "inventoryId", 80),
      expectedInventoryRevision: revision(
        payload.expectedInventoryRevision,
        "expectedInventoryRevision",
      ),
      expectedAccountRevision: revision(
        payload.expectedAccountRevision,
        "expectedAccountRevision",
      ),
      quantity: integer(payload.quantity, "quantity", { min: 1, max: 99 }),
      // Preserve the canonical payload hash of pre-memo receipts.
      ...(payload.memo === undefined
        ? {}
        : { memo: normalizeOrderMemo(payload.memo) }),
    };
  }
  if (commandType === WIS_COMMAND_TYPES.REVIEW_WIS_ORDER) {
    allowed(
      payload,
      [
        ...common,
        "expectedEconomyRevision",
        "orderId",
        "expectedOrderRevision",
        "action",
        "reason",
      ],
      "reviewWisOrder payload",
    );
    if (!["APPROVE", "REJECT", "FULFILL"].includes(payload.action))
      fail("invalid-argument", "action is invalid.", "WIS_PAYLOAD_INVALID");
    return {
      semesterId: semesterId(payload.semesterId),
      expectedSemesterRevision: revision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      expectedEconomyRevision: revision(
        payload.expectedEconomyRevision,
        "expectedEconomyRevision",
      ),
      orderId: text(payload.orderId, "orderId", 80),
      expectedOrderRevision: revision(
        payload.expectedOrderRevision,
        "expectedOrderRevision",
      ),
      action: payload.action,
      reason: text(payload.reason, "reason", 500),
    };
  }
  if (commandType === WIS_COMMAND_TYPES.SAVE_WIS_HALL_OF_FAME_CONFIG) {
    allowed(
      payload,
      [
        ...common,
        "expectedEconomyRevision",
        "expectedHallOfFameRevision",
        "hallOfFame",
        "reason",
      ],
      "saveWisHallOfFameConfig payload",
    );
    return {
      semesterId: semesterId(payload.semesterId),
      expectedSemesterRevision: revision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      expectedEconomyRevision: revision(
        payload.expectedEconomyRevision,
        "expectedEconomyRevision",
      ),
      expectedHallOfFameRevision: integer(
        payload.expectedHallOfFameRevision,
        "expectedHallOfFameRevision",
        { min: 0, max: Number.MAX_SAFE_INTEGER },
      ),
      hallOfFame: normalizeWisHallOfFameConfig(payload.hallOfFame, {
        strict: true,
      }),
      reason: text(payload.reason, "reason", 500),
    };
  }
  fail(
    "invalid-argument",
    "Unsupported Wis command.",
    "WIS_COMMAND_UNSUPPORTED",
  );
};

const assertTeacher = (actor) => {
  if (!actor?.actorUid || !["teacher", "admin"].includes(actor.actorRole))
    fail(
      "permission-denied",
      "Wis management permission is required.",
      "WIS_MANAGE_REQUIRED",
    );
};
const assertStudent = (actor) => {
  if (!actor?.actorUid || actor.actorRole !== "student")
    fail(
      "permission-denied",
      "A student account is required.",
      "WIS_STUDENT_REQUIRED",
    );
};
const assertManifest = async (
  transaction,
  payload,
  commandType,
  actor,
  commandId,
  payloadHash,
) => {
  const snapshot = await transaction.get(manifestPath(payload.semesterId));
  const manifest = snapshot.data || {};
  if (!snapshot.exists)
    fail(
      "not-found",
      "Semester Manifest does not exist.",
      "SEMESTER_NOT_FOUND",
    );
  if (Number(manifest.revision || 0) !== payload.expectedSemesterRevision)
    fail("aborted", "Semester revision changed.", "SEMESTER_REVISION_CONFLICT");
  if (manifest.status !== "ACTIVE") {
    const preparingCreate =
      [
        WIS_COMMAND_TYPES.CREATE_SEMESTER_ECONOMY,
        WIS_COMMAND_TYPES.CREATE_WIS_ACCOUNTS,
      ].includes(commandType) &&
      ["PREPARING", "READY"].includes(manifest.status);
    if (!preparingCreate)
      fail(
        "failed-precondition",
        "Wis writes require the active semester.",
        ["CLOSED", "ARCHIVED"].includes(manifest.status)
          ? "SEMESTER_ARCHIVED_WRITE_FORBIDDEN"
          : "SEMESTER_WRITE_STATE_INVALID",
      );
    await cutoverAuthorization.assertPreparingCutoverCreateIfTargeted({
      transaction,
      semesterId: payload.semesterId,
      actor,
      commandType,
      commandId,
      payloadHash,
      cutoverPlanId: payload.cutoverPlanId,
      cutoverOperationKey: payload.cutoverOperationKey,
      operationType:
        commandType === WIS_COMMAND_TYPES.CREATE_SEMESTER_ECONOMY
          ? "WIS_ECONOMY"
          : "WIS_ACCOUNTS",
    });
  }
  return manifest;
};
const assertEconomy = async (
  transaction,
  payload,
  statuses = ["ACTIVE_INITIALIZING", "ACTIVE_OPEN"],
) => {
  const snapshot = await transaction.get(economyPath(payload.semesterId));
  if (!snapshot.exists)
    fail(
      "not-found",
      "Semester Wis economy does not exist.",
      "WIS_ECONOMY_NOT_FOUND",
    );
  const economy = snapshot.data || {};
  if (Number(economy.revision || 0) !== payload.expectedEconomyRevision)
    fail(
      "aborted",
      "Wis economy revision changed.",
      "WIS_ECONOMY_REVISION_CONFLICT",
      { currentRevision: Number(economy.revision || 0) },
    );
  if (!statuses.includes(economy.status))
    fail(
      "failed-precondition",
      "Wis economy state does not allow this command.",
      "WIS_ECONOMY_STATE_INVALID",
      { status: economy.status },
    );
  return economy;
};
const writeProjection = (
  transaction,
  account,
  balance,
  timestamp,
  actorUid,
  totals = {
    earnedTotal: Number(account.earnedTotal || 0),
    rankEarnedTotal: Number(account.rankEarnedTotal || 0),
    spentTotal: Number(account.spentTotal || 0),
    adjustedTotal: Number(account.adjustedTotal || 0),
  },
  recentLedgerEntries = Array.isArray(account.recentLedgerEntries)
    ? account.recentLedgerEntries.slice(0, WIS_RECENT_LEDGER_LIMIT)
    : [],
) => {
  const revisionValue = Number(account.revision || 0) + 1;
  const patch = {
    revision: revisionValue,
    balance,
    ...totals,
    recentLedgerEntries,
    updatedAt: timestamp,
    updatedBy: actorUid,
  };
  transaction.set(accountPath(account.accountId), patch, { merge: true });
  transaction.set(
    balancePath(account.accountId),
    {
      schemaVersion: WIS_SCHEMA_VERSION,
      policyVersion: WIS_POLICY_VERSION,
      accountId: account.accountId,
      semesterId: account.semesterId,
      studentUid: account.studentUid,
      balance,
      ...totals,
      ledgerRevision: revisionValue,
      updatedAt: timestamp,
    },
    { merge: true },
  );
  transaction.set(
    rankingPath(account.accountId),
    {
      schemaVersion: WIS_SCHEMA_VERSION,
      policyVersion: WIS_POLICY_VERSION,
      accountId: account.accountId,
      semesterId: account.semesterId,
      studentUid: account.studentUid,
      displayName: account.displayName,
      classId: account.classId || "",
      grade: String(account.grade || ""),
      classNumber: String(account.classNumber || ""),
      balance,
      rankEarnedTotal: totals.rankEarnedTotal,
      ledgerRevision: revisionValue,
      updatedAt: timestamp,
    },
    { merge: true },
  );
  return revisionValue;
};
const zeroAccountTotals = () => ({
  earnedTotal: 0,
  rankEarnedTotal: 0,
  spentTotal: 0,
  adjustedTotal: 0,
});
const ledgerTotalsContribution = (type, delta, activityType = "") => {
  const contribution = zeroAccountTotals();
  if (type === "INITIAL_GRANT" && delta > 0) {
    contribution.earnedTotal = delta;
  } else if (type === "GRANT" && delta > 0) {
    contribution.earnedTotal = delta;
    contribution.rankEarnedTotal = delta;
    contribution.adjustedTotal = AUTOMATIC_REWARD_ACTIVITIES.has(activityType) ? 0 : delta;
  } else if (type === "DEDUCT") {
    contribution.adjustedTotal = delta;
  } else if (type === "ADJUST") {
    if (delta > 0) {
      contribution.earnedTotal = delta;
      contribution.rankEarnedTotal = delta;
    }
    contribution.adjustedTotal = delta;
  } else if (type === "ORDER_DEBIT" && delta < 0) {
    contribution.spentTotal = Math.abs(delta);
  } else if (type === "ORDER_REFUND" && delta > 0) {
    contribution.spentTotal = -delta;
  }
  return contribution;
};
const addAccountTotals = (account, contribution) => ({
  earnedTotal:
    Number(account.earnedTotal || 0) + Number(contribution.earnedTotal || 0),
  rankEarnedTotal:
    Number(account.rankEarnedTotal || 0) +
    Number(contribution.rankEarnedTotal || 0),
  spentTotal:
    Number(account.spentTotal || 0) + Number(contribution.spentTotal || 0),
  adjustedTotal:
    Number(account.adjustedTotal || 0) +
    Number(contribution.adjustedTotal || 0),
});
const negateAccountTotals = (contribution) =>
  Object.fromEntries(
    Object.entries(contribution).map(([key, value]) => [
      key,
      -Number(value || 0),
    ]),
  );
const nextAccountTotals = (
  account,
  delta,
  type,
  { reversedType = "", reversedDelta = 0 } = {},
) =>
  addAccountTotals(
    account,
    type === "REVERSAL"
      ? negateAccountTotals(
          ledgerTotalsContribution(reversedType, Number(reversedDelta || 0)),
        )
      : ledgerTotalsContribution(type, delta),
  );
const totalsFromLedgerEntries = (entries) => {
  const normalized = entries.map((row) => row.data || row);
  const byId = new Map(
    normalized.map((entry) => [String(entry.ledgerEntryId || ""), entry]),
  );
  return normalized.reduce((totals, entry) => {
    if (entry.type === "LEGACY_OPENING" || entry.type === "LEGACY_RECLAIM") {
      const contribution = entry.type === "LEGACY_OPENING" ? entry.openingTotals : entry.totalsContribution;
      if (!contribution || !Object.keys(zeroAccountTotals()).every(key => Number.isSafeInteger(contribution[key])) ||
          !Number.isSafeInteger(entry.delta) ||
          (entry.type === "LEGACY_OPENING" && (entry.delta < 0 || contribution.balance !== entry.delta ||
            ["earnedTotal", "rankEarnedTotal", "spentTotal"].some(key => contribution[key] < 0) ||
            normalized.filter(row => row.type === "LEGACY_OPENING").length !== 1)) ||
          (entry.type === "LEGACY_RECLAIM" && (entry.delta >= 0 || contribution.earnedTotal !== entry.delta ||
            contribution.rankEarnedTotal !== entry.delta || contribution.spentTotal !== 0 || contribution.adjustedTotal !== 0 ||
            !entry.sourceOriginalRewardPath || !entry.legacyMigrationId || !entry.openingLedgerEntryId)))
        fail("failed-precondition", "Legacy Wis ledger totals are invalid.", "WIS_LEGACY_LEDGER_INVALID");
      return addAccountTotals(totals, contribution);
    }
    if (entry.type !== "REVERSAL") {
      return addAccountTotals(
        totals,
        ledgerTotalsContribution(entry.type, Number(entry.delta || 0), entry.activityType),
      );
    }
    const source = byId.get(String(entry.sourceId || "")) || {};
    const reversedType = String(entry.reversedType || source.type || "");
    const reversedDelta = Number(
      entry.reversedDelta === undefined
        ? source.delta || 0
        : entry.reversedDelta,
    );
    return addAccountTotals(
      totals,
      negateAccountTotals(
        ledgerTotalsContribution(reversedType, reversedDelta, entry.reversedActivityType || source.activityType),
      ),
    );
  }, zeroAccountTotals());
};
const assertLegacyLedgerProvenance = async (transaction, entries, account) => {
  const migration = require("./wisLegacyMigration");
  const rows = entries.map(row => row.data || row);
  const legacyRows = rows.filter(row => ["LEGACY_OPENING", "LEGACY_RECLAIM"].includes(row.type));
  if (!legacyRows.length && !account.legacyMigrationId) return;
  const invalid = () => fail("failed-precondition", "Legacy Wis ledger provenance is invalid.", "WIS_LEGACY_LEDGER_INVALID");
  const paths = migration.pathsFor(account.semesterId, account.studentUid);
  const markerSnapshot = await transaction.get(paths.marker);
  const marker = markerSnapshot.data || {};
  const openingRows = rows.filter(row => row.type === "LEGACY_OPENING");
  const opening = openingRows[0];
  if (!markerSnapshot.exists || marker.status !== "MIGRATED" || marker.policyVersion !== migration.POLICY_VERSION ||
      marker.migrationId !== paths.migrationId || marker.accountId !== account.accountId ||
      marker.semesterId !== account.semesterId || marker.studentUid !== account.studentUid ||
      marker.openingLedgerEntryId !== paths.openingId || account.legacyMigrationId !== paths.migrationId ||
      openingRows.length !== 1 || opening.ledgerEntryId !== paths.openingId || opening.sourceId !== paths.migrationId ||
      opening.legacyHash !== marker.legacyHash || !/^[a-f0-9]{64}$/.test(marker.legacyHash || "") ||
      migration.canonical(opening.openingTotals) !== migration.canonical(marker.totals) ||
      opening.balanceBefore !== 0 || opening.balanceAfter !== opening.delta) invalid();
  const sourcePaths = new Set();
  for (const row of legacyRows) {
    if (row.accountId !== account.accountId || row.studentUid !== account.studentUid || row.semesterId !== account.semesterId) invalid();
    if (row.type !== "LEGACY_RECLAIM") continue;
    if (row.legacyMigrationId !== paths.migrationId || row.openingLedgerEntryId !== paths.openingId ||
        typeof row.sourceOriginalRewardPath !== "string" ||
        !row.sourceOriginalRewardPath.startsWith(paths.transactions + "/") ||
        row.sourceOriginalRewardPath.slice(paths.transactions.length + 1).includes("/") ||
        sourcePaths.has(row.sourceOriginalRewardPath)) invalid();
    sourcePaths.add(row.sourceOriginalRewardPath);
    const sourceId = `legacy-reclaim:${sha256(`${paths.migrationId}\n${row.sourceOriginalRewardPath}`)}`;
    if (row.sourceId !== sourceId || row.ledgerEntryId !== ledgerIdFor(account.semesterId, account.accountId, "LEGACY_RECLAIM", sourceId) ||
        row.legacyHash !== marker.legacyHash) invalid();
    const original = await transaction.get(row.sourceOriginalRewardPath);
    if (!original.exists || original.data?.uid !== account.studentUid || original.data?.type !== "history_dictionary" ||
        !Number.isSafeInteger(original.data?.delta) || original.data.delta <= 0 || original.data.delta !== -row.delta ||
        original.data.reclaimed === true) invalid();
  }
};
const postLedger = async ({
  transaction,
  account,
  delta,
  type,
  sourceId,
  reason,
  commandId,
  receiptId,
  timestamp,
  actor,
  economy,
  reversedType = "",
  reversedDelta = 0,
}) => {
  const entryId = ledgerIdFor(
    account.semesterId,
    account.accountId,
    type,
    sourceId,
  );
  const existing = await transaction.get(ledgerPath(entryId));
  if (existing.exists)
    fail(
      "already-exists",
      "A ledger entry already exists for this source.",
      "WIS_LEDGER_SOURCE_EXISTS",
      { ledgerEntryId: entryId },
    );
  const before = Number(account.balance || 0);
  const after = before + delta;
  if (after < 0)
    fail(
      "failed-precondition",
      "Wis balance is insufficient.",
      "WIS_INSUFFICIENT_BALANCE",
      { balance: before, required: Math.abs(delta) },
    );
  const ledgerEntry = {
    schemaVersion: WIS_SCHEMA_VERSION,
    policyVersion: WIS_POLICY_VERSION,
    ledgerEntryId: entryId,
    semesterId: account.semesterId,
    accountId: account.accountId,
    studentUid: account.studentUid,
    type,
    delta,
    balanceBefore: before,
    balanceAfter: after,
    sourceId,
    reason,
    actorUid: actor.actorUid,
    actorRole: actor.actorRole,
    commandId,
    receiptId,
    createdAt: timestamp,
    ...(type === "REVERSAL" ? { reversedType, reversedDelta } : {}),
  };
  const accountRevision = writeProjection(
    transaction,
    account,
    after,
    timestamp,
    actor.actorUid,
    nextAccountTotals(account, delta, type, { reversedType, reversedDelta }),
    [
      ledgerEntry,
      ...(Array.isArray(account.recentLedgerEntries)
        ? account.recentLedgerEntries
        : []),
    ].slice(0, WIS_RECENT_LEDGER_LIMIT),
  );
  transaction.create(ledgerPath(entryId), ledgerEntry);
  transaction.set(
    economyPath(account.semesterId),
    {
      ledgerEntryCount: Number(economy?.ledgerEntryCount || 0) + 1,
      updatedAt: timestamp,
      updatedBy: actor.actorUid,
    },
    { merge: true },
  );
  return { ledgerEntryId: entryId, balance: after, accountRevision };
};

// Internal submit dependency only. Reads/validates everything before returning a
// write-only closure; the assessment result and Gateway receipt share its commit.
const createAssessmentWisRewardAdapter = ({ loadPolicy, resolveActivityReward } = {}) => {
  if (typeof loadPolicy !== "function" || typeof resolveActivityReward !== "function")
    throw new TypeError("Assessment reward policy dependencies are required.");
  const rewardFailure = (reason, message = "평가 보상 계좌를 확인하지 못했습니다. 제출 내용을 유지한 채 다시 시도해 주세요.") =>
    fail("failed-precondition", message, `ASSESSMENT_WIS_${reason}`);
  const safe = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
  const emptyReward = (status, blockedReason, blockedMessage, extra = {}) => ({
    status, awarded: false, duplicate: status === "DUPLICATE", amount: 0,
    bonusAwarded: false, bonusAmount: 0, totalAwarded: 0,
    blockedReason, blockedMessage, ledgerEntryIds: [], ...extra,
  });
  return {
    prepare: async ({ transaction, attempt, percent, commandId, receiptId, nowDate, concreteTimestamp }) => {
      const scope = semesterId(attempt.semesterId), uid = text(attempt.studentUid, "studentUid", 180);
      const activityType = attempt.assessmentKind === "QUIZ" ? "quiz"
        : attempt.assessmentKind === "HISTORY_CLASSROOM" ? "history_classroom" : "";
      if (!activityType || !safe(percent) || percent > 100 || !safe(nowDate?.getTime()) || !concreteTimestamp) rewardFailure("RESULT_INVALID");
      const accountId = accountIdFor(scope, uid);
      const migrationFence = require("./wisMigrationFence");
      const [pointerDoc, manifestDoc, economyDoc, accountDoc, profileDoc, identityDoc, slotDoc, fenceDoc] = await transaction.getAll([
        semesterCore.ACTIVE_SEMESTER_POINTER_PATH, manifestPath(scope), economyPath(scope), accountPath(accountId),
        `users/${uid}`, `student_identities/${uid}`, enrollmentSlotPath(scope, uid), migrationFence.controlPath(scope),
      ]);
      migrationFence.assertControl(fenceDoc.data);
      const manifest = manifestDoc.data || {}, economy = economyDoc.data || {}, account = accountDoc.data || {};
      if (!pointerDoc.exists || pointerDoc.data?.semesterId !== scope || !manifestDoc.exists || manifest.semesterId !== scope ||
          manifest.status !== "ACTIVE" || manifest.readOnly === true || !safe(manifest.revision, 1) || pointerDoc.data?.revision !== manifest.revision)
        rewardFailure("SEMESTER_INACTIVE");
      if (!profileDoc.exists || profileDoc.data?.role !== "student" ||
          (Object.hasOwn(profileDoc.data, "registrationApprovalStatus") && profileDoc.data.registrationApprovalStatus !== "APPROVED") ||
          !identityDoc.exists || identityDoc.data?.studentUid !== uid ||
          (identityDoc.data.accountStatus !== undefined && identityDoc.data.accountStatus !== "ACTIVE"))
        rewardFailure("STUDENT_INACTIVE");
      if (!slotDoc.exists || slotDoc.data?.semesterId !== scope || slotDoc.data?.studentUid !== uid ||
          (slotDoc.data.status !== undefined && slotDoc.data.status !== "ACTIVE") || !slotDoc.data.activeEnrollmentId)
        rewardFailure("ENROLLMENT_INVALID");
      const enrollmentDoc = await transaction.get(enrollmentPath(slotDoc.data.activeEnrollmentId));
      const enrollment = enrollmentDoc.data || {};
      if (!enrollmentDoc.exists || enrollment.enrollmentId !== slotDoc.data.activeEnrollmentId || enrollment.semesterId !== scope ||
          enrollment.studentUid !== uid || enrollment.enrollmentStatus !== "ACTIVE" || enrollment.readOnly === true ||
          enrollment.enrollmentId !== attempt.enrollmentId || enrollment.classId !== attempt.classId)
        rewardFailure("ENROLLMENT_CHANGED");
      const classDoc = await transaction.get(classPath(enrollment.classId));
      if (!classDoc.exists || classDoc.data?.semesterId !== scope || classDoc.data.status !== "ACTIVE" || classDoc.data.readOnly === true) rewardFailure("CLASS_INACTIVE");
      if (!economyDoc.exists || economy.semesterId !== scope || economy.status !== "ACTIVE_OPEN" || economy.readOnly === true ||
          !safe(economy.revision, 1) || !safe(economy.ledgerEntryCount)) rewardFailure("ECONOMY_CLOSED");
      if (!accountDoc.exists || account.schemaVersion !== WIS_SCHEMA_VERSION || account.policyVersion !== WIS_POLICY_VERSION ||
          account.accountId !== accountId || account.studentUid !== uid || account.semesterId !== scope || account.status !== "ACTIVE" ||
          account.readOnly === true || account.enrollmentId !== enrollment.enrollmentId || account.classId !== enrollment.classId ||
          !safe(account.revision, 1) || !["balance", "earnedTotal", "rankEarnedTotal", "spentTotal"].every(key => safe(account[key])) ||
          !Number.isSafeInteger(account.adjustedTotal) || !Array.isArray(account.recentLedgerEntries)) rewardFailure("ACCOUNT_INVALID");

      const policy = await loadPolicy(transaction, scope);
      const sourceId = `assessment:${attempt.attemptId}`;
      const plan = resolveActivityReward({ policy, activityType, sourceId,
        sourceLabel: activityType === "quiz" ? "문제 풀이" : "역사교실 제출 완료", score: percent });
      if (!Array.isArray(plan.items) || plan.items.some(item => ![activityType, `${activityType}_bonus`].includes(item.type) ||
          item.sourceId !== sourceId || !safe(item.amount)) || new Set(plan.items.map(item => item.type)).size !== plan.items.length)
        rewardFailure("POLICY_INVALID");
      const items = plan.items.filter(item => item.amount > 0);
      const base = emptyReward("DISABLED", "reward_disabled", "현재 정책에서 지급할 평가 보상이 없습니다.", { balance: account.balance });
      if (!items.length) return { result: base, refs: [], apply() {} };
      const posts = items.map(item => {
        const entrySource = `${sourceId}:${item.type}`;
        return { item, sourceId: entrySource, id: ledgerIdFor(scope, accountId, "GRANT", entrySource) };
      });
      const existing = await transaction.getAll(posts.map(post => ledgerPath(post.id)));
      // Only a committed immutable result can replay a reward. Orphan/partial
      // ledger evidence must be reconciled, never supplemented by a new submit.
      if (existing.some(doc => doc.exists)) rewardFailure("SOURCE_ALREADY_POSTED");

      if (activityType === "history_classroom") {
        const [year, term] = scope.split("-");
        const limit = 1000;
        const [legacyRows, canonicalRows] = await Promise.all([
          transaction.query(`years/${year}/semesters/${term}/point_transactions`, {
            filters: [{ field: "uid", operator: "==", value: uid }, { field: "type", operator: "==", value: activityType }], limit: limit + 1,
          }),
          transaction.query(WIS_LEDGER_COLLECTION, { filters: [
            { field: "semesterId", operator: "==", value: scope }, { field: "studentUid", operator: "==", value: uid },
            { field: "type", operator: "==", value: "GRANT" }, { field: "activityType", operator: "==", value: activityType },
          ], limit: limit + 1 }),
        ]);
        if (legacyRows.length > limit || canonicalRows.length > limit) rewardFailure("HISTORY_LIMIT_EXCEEDED");
        const rows = [...legacyRows, ...canonicalRows];
        const rule = policy.rewardPolicy?.historyClassroom || {};
        const maxClaims = Number(rule.maxClaims || 0), cooldownHours = Math.max(1, Number(rule.cooldownHours || 24));
        if (!safe(maxClaims) || !Number.isFinite(cooldownHours)) rewardFailure("POLICY_INVALID");
        if (maxClaims > 0 && rows.length >= maxClaims) return { refs: [], apply() {}, result:
          emptyReward("NOT_ELIGIBLE", "max_claims_reached", `누적 최대 ${maxClaims}회까지 적립됩니다.`, { balance: account.balance }) };
        const times = rows.map(row => {
          const value = row.data?.createdAt;
          const milliseconds = typeof value?.toMillis === "function" ? value.toMillis()
            : Number(value?.seconds || 0) * 1000 + Math.floor(Number(value?.nanoseconds || 0) / 1000000);
          if (!safe(milliseconds, 1)) rewardFailure("HISTORY_TIMESTAMP_INVALID");
          return milliseconds;
        });
        const nextEligibleAtMs = times.length ? Math.max(...times) + cooldownHours * 3600000 : 0;
        if (!safe(nextEligibleAtMs)) rewardFailure("POLICY_INVALID");
        if (nextEligibleAtMs > nowDate.getTime()) return { refs: [], apply() {}, result:
          emptyReward("NOT_ELIGIBLE", "cooldown_active", `${cooldownHours}시간마다 1회만 적립됩니다.`,
            { balance: account.balance, nextEligibleAt: new Date(nextEligibleAtMs).toISOString() }) };
      }
      const totalAwarded = items.reduce((total, item) => total + item.amount, 0);
      const amount = items.find(item => item.type === activityType)?.amount || 0, bonusAmount = totalAwarded - amount;
      const balance = account.balance + totalAwarded;
      const totals = { earnedTotal: account.earnedTotal + totalAwarded, rankEarnedTotal: account.rankEarnedTotal + totalAwarded,
        spentTotal: account.spentTotal, adjustedTotal: account.adjustedTotal };
      if (!safe(totalAwarded, 1) || !safe(balance) || !safe(totals.earnedTotal) || !safe(totals.rankEarnedTotal) ||
          !safe(account.revision + 1, 1) || !safe(economy.revision + 1, 1) || !safe(economy.ledgerEntryCount + posts.length)) rewardFailure("AMOUNT_OVERFLOW");
      let runningBalance = account.balance;
      const ledgers = posts.map(post => {
        const before = runningBalance; runningBalance += post.item.amount;
        return { schemaVersion: WIS_SCHEMA_VERSION, policyVersion: WIS_POLICY_VERSION, ledgerEntryId: post.id,
          semesterId: scope, accountId, studentUid: uid, type: "GRANT", activityType: post.item.type,
          delta: post.item.amount, balanceBefore: before, balanceAfter: runningBalance, sourceId: post.sourceId,
          sourceResultId: attempt.attemptId, reason: post.item.sourceLabel, actorUid: "system:assessment-reward", actorRole: "system",
          initiatedByUid: uid, commandId, receiptId, createdAt: concreteTimestamp,
          targetDate: new Date(nowDate.getTime() + 9 * 3600000).toISOString().slice(0, 10) };
      });
      const refs = [accountPath(accountId), balancePath(accountId), rankingPath(accountId), economyPath(scope), ...posts.map(post => ledgerPath(post.id))];
      return { refs, result: { status: "AWARDED", awarded: true, duplicate: false, amount, bonusAwarded: bonusAmount > 0,
        bonusAmount, totalAwarded, balance, blockedReason: "", blockedMessage: "", ledgerEntryIds: posts.map(post => post.id) },
      apply() {
        writeProjection(transaction, account, balance, concreteTimestamp, "system:assessment-reward", totals,
          [...ledgers].reverse().concat(account.recentLedgerEntries).slice(0, WIS_RECENT_LEDGER_LIMIT));
        for (const ledger of ledgers) transaction.create(ledgerPath(ledger.ledgerEntryId), ledger);
        transaction.set(economyPath(scope), { revision: economy.revision + 1, ledgerEntryCount: economy.ledgerEntryCount + posts.length,
          updatedAt: concreteTimestamp, updatedBy: "system:assessment-reward" }, { merge: true });
      } };
    },
  };
};

const createWisCommandAdapter = ({ projectId, now } = {}) => ({
  apply: async ({
    transaction,
    commandId,
    commandType,
    payload,
    payloadHash,
    receiptId,
    timestamp,
    concreteTimestamp,
    actor,
  }) => {
    const projectionTimestamp = concreteTimestamp || timestamp;
    await require("./wisMigrationFence").assertWisWriteAllowed(transaction, payload.semesterId);
    const manifest = await assertManifest(
      transaction,
      payload,
      commandType,
      actor,
      commandId,
      payloadHash,
    );
    if (commandType === WIS_COMMAND_TYPES.CREATE_SEMESTER_ECONOMY) {
      assertTeacher(actor);
      const path = economyPath(payload.semesterId);
      const existing = await transaction.get(path);
      if (existing.exists)
        fail(
          "already-exists",
          "Semester Wis economy already exists.",
          "WIS_ECONOMY_EXISTS",
        );
      const status =
        manifest.status === "ACTIVE"
          ? "ACTIVE_INITIALIZING"
          : "PREPARING_INITIALIZING";
      transaction.create(path, {
        schemaVersion: WIS_SCHEMA_VERSION,
        policyVersion: WIS_POLICY_VERSION,
        semesterId: payload.semesterId,
        revision: 1,
        status,
        displayName: payload.displayName,
        currencyName: payload.currencyName,
        initialGrantAmount: payload.initialGrantAmount,
        integrityVersion: WIS_INTEGRITY_VERSION,
        accountCount: 0,
        initializedAccountCount: 0,
        ledgerEntryCount: 0,
        inventoryCount: 0,
        orderCount: 0,
        unresolvedLegacyIssueCount: 0,
        provenance: manifest.status === "ACTIVE" ? "CURRENT" : "PREPARING",
        readOnly: manifest.status !== "ACTIVE",
        cutoverPlanId: payload.cutoverPlanId || null,
        createdBy: actor.actorUid,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return {
        target: { kind: "wis-economy", id: payload.semesterId, refs: [path] },
        sourceHash: sha256(canonicalJson(payload)),
        result: { semesterId: payload.semesterId, revision: 1, status },
      };
    }
    const economyStatuses =
      commandType === WIS_COMMAND_TYPES.CREATE_WIS_ACCOUNTS &&
      ["PREPARING", "READY"].includes(manifest.status)
        ? ["PREPARING_INITIALIZING"]
        : commandType === WIS_COMMAND_TYPES.TRANSITION_WIS_ECONOMY
          ? [
              "PREPARING_INITIALIZING",
              "ACTIVE_INITIALIZING",
              "ACTIVE_OPEN",
              "CLOSED",
            ]
          : ["ACTIVE_INITIALIZING", "ACTIVE_OPEN"];
    const economy = await assertEconomy(transaction, payload, economyStatuses);
    if (commandType === WIS_COMMAND_TYPES.CREATE_WIS_ACCOUNTS) {
      assertTeacher(actor);
      const enrollments = await transaction.getAll(
        payload.enrollmentIds.map(enrollmentPath),
      );
      const enrollmentData = enrollments.map((snapshot) => snapshot.data || {});
      const classIds = [
        ...new Set(
          enrollmentData
            .map((data) => String(data.classId || ""))
            .filter(Boolean),
        ),
      ];
      const accountIds = enrollmentData.map((data) =>
        accountIdFor(payload.semesterId, data.studentUid),
      );
      const [
        classSnapshots,
        existingAccountSnapshots,
        enrollmentSlotSnapshots,
      ] = await Promise.all([
        transaction.getAll(classIds.map(classPath)),
        transaction.getAll(accountIds.map(accountPath)),
        transaction.getAll(
          enrollmentData.map((data) =>
            enrollmentSlotPath(
              payload.semesterId,
              String(data.studentUid || ""),
            ),
          ),
        ),
      ]);
      const classes = new Map(
        classSnapshots
          .filter((snapshot) => snapshot.exists)
          .map((snapshot) => [
            String(snapshot.data?.classId || ""),
            snapshot.data || {},
          ]),
      );
      const refs = [];
      let createdCount = 0;
      let syncedCount = 0;
      for (let index = 0; index < enrollments.length; index += 1) {
        const enrollment = enrollments[index];
        const data = enrollment.data || {};
        const enrollmentId = String(data.enrollmentId || "");
        const enrollmentSlot = enrollmentSlotSnapshots[index];
        if (
          !enrollment.exists ||
          data.semesterId !== payload.semesterId ||
          data.enrollmentStatus !== "ACTIVE" ||
          enrollmentId !== payload.enrollmentIds[index] ||
          !enrollmentSlot.exists ||
          String(enrollmentSlot.data?.activeEnrollmentId || "") !== enrollmentId
        )
          fail(
            "failed-precondition",
            "Enrollment is not active in this semester.",
            "WIS_ENROLLMENT_INVALID",
            { enrollmentId: payload.enrollmentIds[index] },
          );
        const accountId = accountIds[index];
        const path = accountPath(accountId);
        const existing = existingAccountSnapshots[index];
        const semesterClass = classes.get(String(data.classId || "")) || {};
        const snapshot = isObject(data.snapshot) ? data.snapshot : {};
        const accountMetadata = {
          enrollmentId,
          classId: data.classId,
          grade: String(
            snapshot.grade || data.grade || semesterClass.grade || "",
          ),
          classNumber: String(
            snapshot.classNumber ||
              data.classNumber ||
              semesterClass.classNumber ||
              "",
          ),
          studentNumber: String(
            data.studentNumber || snapshot.studentNumber || "",
          ),
          displayName:
            data.displayName ||
            data.studentName ||
            data.snapshot?.displayName ||
            "학생",
          status: manifest.status === "ACTIVE" ? "ACTIVE" : "PREPARING",
          provenance: manifest.status === "ACTIVE" ? "CURRENT" : "PREPARING",
          readOnly: manifest.status !== "ACTIVE",
          updatedAt: timestamp,
        };
        if (existing.exists) {
          const existingAccount = existing.data || {};
          transaction.set(path, accountMetadata, { merge: true });
          transaction.set(balancePath(accountId), accountMetadata, {
            merge: true,
          });
          transaction.set(
            rankingPath(accountId),
            {
              enrollmentId,
              classId: data.classId,
              grade: accountMetadata.grade,
              classNumber: accountMetadata.classNumber,
              displayName: accountMetadata.displayName,
              updatedAt: timestamp,
            },
            { merge: true },
          );
          if (
            String(existingAccount.enrollmentId || "") !== enrollmentId ||
            String(existingAccount.classId || "") !== String(data.classId || "")
          )
            syncedCount += 1;
          refs.push(path, balancePath(accountId), rankingPath(accountId));
          continue;
        }
        const account = {
          schemaVersion: WIS_SCHEMA_VERSION,
          policyVersion: WIS_POLICY_VERSION,
          accountId,
          semesterId: payload.semesterId,
          studentUid: data.studentUid,
          ...accountMetadata,
          revision: 1,
          balance: 0,
          earnedTotal: 0,
          rankEarnedTotal: 0,
          spentTotal: 0,
          adjustedTotal: 0,
          recentLedgerEntries: [],
          initialGrantLedgerEntryId: null,
          cutoverPlanId: payload.cutoverPlanId || null,
          createdAt: timestamp,
        };
        transaction.create(path, account);
        transaction.create(balancePath(accountId), {
          ...account,
          ledgerRevision: 1,
        });
        transaction.create(rankingPath(accountId), {
          schemaVersion: WIS_SCHEMA_VERSION,
          policyVersion: WIS_POLICY_VERSION,
          accountId,
          semesterId: payload.semesterId,
          studentUid: data.studentUid,
          displayName: account.displayName,
          enrollmentId,
          balance: 0,
          rankEarnedTotal: 0,
          classId: data.classId,
          ledgerRevision: 1,
          updatedAt: timestamp,
        });
        createdCount += 1;
        refs.push(path, balancePath(accountId), rankingPath(accountId));
      }
      const nextRevision = economy.revision + 1;
      transaction.set(
        economyPath(payload.semesterId),
        {
          revision: nextRevision,
          accountCount: Number(economy.accountCount || 0) + createdCount,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      return {
        target: { kind: "wis-accounts", id: payload.semesterId, refs },
        sourceHash: sha256(canonicalJson(payload.enrollmentIds)),
        result: {
          semesterId: payload.semesterId,
          createdCount,
          syncedCount,
          economyRevision: nextRevision,
        },
      };
    }
    if (
      [
        WIS_COMMAND_TYPES.GRANT_INITIAL_WIS,
        WIS_COMMAND_TYPES.GRANT_WIS,
        WIS_COMMAND_TYPES.DEDUCT_WIS,
        WIS_COMMAND_TYPES.ADJUST_WIS,
      ].includes(commandType)
    ) {
      assertTeacher(actor);
      const snapshot = await transaction.get(accountPath(payload.accountId));
      const account = snapshot.data || {};
      if (!snapshot.exists || account.semesterId !== payload.semesterId)
        fail(
          "not-found",
          "Wis account was not found.",
          "WIS_ACCOUNT_NOT_FOUND",
        );
      if (Number(account.revision || 0) !== payload.expectedAccountRevision)
        fail(
          "aborted",
          "Wis account revision changed.",
          "WIS_ACCOUNT_REVISION_CONFLICT",
        );
      if (
        commandType === WIS_COMMAND_TYPES.GRANT_INITIAL_WIS &&
        (economy.status !== "ACTIVE_INITIALIZING" ||
          account.initialGrantLedgerEntryId || account.legacyMigrationId)
      )
        fail(
          "failed-precondition",
          "Initial grant is allowed exactly once during initialization.",
          "WIS_INITIAL_GRANT_ALREADY_APPLIED",
        );
      if (
        commandType === WIS_COMMAND_TYPES.GRANT_INITIAL_WIS &&
        payload.amount !== economy.initialGrantAmount
      )
        fail(
          "failed-precondition",
          "Initial grant amount must match the semester economy policy.",
          "WIS_INITIAL_GRANT_AMOUNT_MISMATCH",
        );
      const delta =
        commandType === WIS_COMMAND_TYPES.DEDUCT_WIS
          ? -payload.amount
          : commandType === WIS_COMMAND_TYPES.ADJUST_WIS
            ? payload.delta
            : payload.amount;
      const type =
        commandType === WIS_COMMAND_TYPES.GRANT_INITIAL_WIS
          ? "INITIAL_GRANT"
          : commandType === WIS_COMMAND_TYPES.GRANT_WIS
            ? "GRANT"
            : commandType === WIS_COMMAND_TYPES.DEDUCT_WIS
              ? "DEDUCT"
              : "ADJUST";
      const posted = await postLedger({
        transaction,
        account,
        economy,
        delta,
        type,
        sourceId: payload.sourceId,
        reason: payload.reason,
        commandId,
        receiptId,
        timestamp: projectionTimestamp,
        actor,
      });
      if (type === "INITIAL_GRANT") {
        // The manifest is ACTIVE here. Promote this prepared account only as
        // part of its exactly-once opening, without scanning every account.
        const activeMetadata = { status: "ACTIVE", provenance: "CURRENT", readOnly: false };
        transaction.set(
          accountPath(account.accountId),
          { ...activeMetadata, initialGrantLedgerEntryId: posted.ledgerEntryId },
          { merge: true },
        );
        transaction.set(balancePath(account.accountId), activeMetadata, { merge: true });
        transaction.set(rankingPath(account.accountId), activeMetadata, { merge: true });
        transaction.set(
          economyPath(payload.semesterId),
          {
            initializedAccountCount:
              Number(economy.initializedAccountCount || 0) + 1,
            updatedAt: timestamp,
            updatedBy: actor.actorUid,
          },
          { merge: true },
        );
      }
      return {
        target: {
          kind: "wis-ledger",
          id: posted.ledgerEntryId,
          refs: [
            ledgerPath(posted.ledgerEntryId),
            accountPath(account.accountId),
            balancePath(account.accountId),
            rankingPath(account.accountId),
          ],
        },
        sourceHash: sha256(`${type}\n${payload.sourceId}`),
        result: { accountId: account.accountId, ...posted, type },
      };
    }
    if (commandType === WIS_COMMAND_TYPES.REVERSE_WIS_ENTRY) {
      assertTeacher(actor);
      const [accountSnapshot, original] = await transaction.getAll([
        accountPath(payload.accountId),
        ledgerPath(payload.ledgerEntryId),
      ]);
      const account = accountSnapshot.data || {};
      const source = original.data || {};
      if (
        !accountSnapshot.exists ||
        account.semesterId !== payload.semesterId ||
        Number(account.revision || 0) !== payload.expectedAccountRevision
      )
        fail(
          "aborted",
          "Wis account revision changed.",
          "WIS_ACCOUNT_REVISION_CONFLICT",
        );
      if (
        !original.exists ||
        source.accountId !== account.accountId ||
        !WIS_MANUAL_REVERSIBLE_TYPES.has(source.type) ||
        !["teacher", "admin"].includes(String(source.actorRole || "")) ||
        String(source.sourceId || "") === "lesson-core-points-all"
      )
        fail(
          "failed-precondition",
          "Ledger entry cannot be reversed.",
          "WIS_REVERSAL_INVALID",
        );
      const posted = await postLedger({
        transaction,
        account,
        economy,
        delta: -Number(source.delta || 0),
        type: "REVERSAL",
        sourceId: payload.ledgerEntryId,
        reason: payload.reason,
        commandId,
        receiptId,
        timestamp: projectionTimestamp,
        actor,
        reversedType: source.type,
        reversedDelta: Number(source.delta || 0),
      });
      return {
        target: {
          kind: "wis-reversal",
          id: posted.ledgerEntryId,
          refs: [
            ledgerPath(payload.ledgerEntryId),
            ledgerPath(posted.ledgerEntryId),
          ],
        },
        sourceHash: sha256(payload.ledgerEntryId),
        result: {
          accountId: account.accountId,
          ...posted,
          reversedLedgerEntryId: payload.ledgerEntryId,
        },
      };
    }
    if (commandType === WIS_COMMAND_TYPES.REBUILD_WIS_PROJECTION) {
      assertTeacher(actor);
      const accountSnapshot = await transaction.get(
        accountPath(payload.accountId),
      );
      const account = accountSnapshot.data || {};
      if (!accountSnapshot.exists || account.semesterId !== payload.semesterId)
        fail(
          "not-found",
          "Wis account was not found.",
          "WIS_ACCOUNT_NOT_FOUND",
        );
      const entries = await transaction.query(WIS_LEDGER_COLLECTION, {
        field: "accountId",
        operator: "==",
        value: payload.accountId,
        orderBy: { field: "createdAt", direction: "desc" },
        limit: WIS_REBUILD_LEDGER_LIMIT + 1,
      });
      if (entries.length > WIS_REBUILD_LEDGER_LIMIT)
        fail(
          "resource-exhausted",
          "Wis projection rebuild requires a bounded migration workflow.",
          "WIS_REBUILD_LEDGER_LIMIT_EXCEEDED",
          { limit: WIS_REBUILD_LEDGER_LIMIT },
        );
      await assertLegacyLedgerProvenance(transaction, entries, account);
      const balance = entries.reduce(
        (sum, entry) => sum + Number(entry.data?.delta || 0),
        0,
      );
      if (balance < 0)
        fail(
          "failed-precondition",
          "Ledger produces a negative balance.",
          "WIS_LEDGER_INVALID",
        );
      const accountRevision = writeProjection(
        transaction,
        account,
        balance,
        projectionTimestamp,
        actor.actorUid,
        totalsFromLedgerEntries(entries),
        entries
          .map((entry) => entry.data || {})
          .slice(0, WIS_RECENT_LEDGER_LIMIT),
      );
      const reportId = hashId(
        "wisrec",
        payload.semesterId,
        payload.accountId,
        String(accountRevision),
        sha256(canonicalJson(entries.map((entry) => entry.data))),
      );
      transaction.create(`${WIS_RECONCILIATION_COLLECTION}/${reportId}`, {
        schemaVersion: WIS_SCHEMA_VERSION,
        policyVersion: WIS_POLICY_VERSION,
        reportId,
        semesterId: payload.semesterId,
        accountId: payload.accountId,
        accountRevision,
        ledgerCount: entries.length,
        balance,
        status: "PASS",
        dependencyHash: sha256(
          canonicalJson(entries.map((entry) => entry.data)),
        ),
        createdBy: actor.actorUid,
        createdAt: timestamp,
      });
      return {
        target: {
          kind: "wis-projection",
          id: payload.accountId,
          refs: [
            accountPath(payload.accountId),
            balancePath(payload.accountId),
            rankingPath(payload.accountId),
            `${WIS_RECONCILIATION_COLLECTION}/${reportId}`,
          ],
        },
        sourceHash: sha256(canonicalJson(entries.map((entry) => entry.data))),
        result: {
          accountId: payload.accountId,
          accountRevision,
          balance,
          reportId,
          status: "PASS",
        },
      };
    }
    if (commandType === WIS_COMMAND_TYPES.TRANSITION_WIS_ECONOMY) {
      assertTeacher(actor);
      const transitions = {
        PREPARING_INITIALIZING: ["ACTIVE_INITIALIZING"],
        ACTIVE_INITIALIZING: ["ACTIVE_OPEN"],
        ACTIVE_OPEN: ["CLOSED"],
        CLOSED: ["ARCHIVED"],
      };
      if (!(transitions[economy.status] || []).includes(payload.targetStatus))
        fail(
          "failed-precondition",
          "Wis economy transition is invalid.",
          "WIS_ECONOMY_TRANSITION_INVALID",
        );
      let initialOpeningBinding = null;
      if (payload.targetStatus === "ACTIVE_OPEN") {
        initialOpeningBinding = await require("./wisInitialOpeningApproval").assertReadyToOpen({
          transaction, economy, manifest, semesterId: payload.semesterId, expectedSemesterRevision: payload.expectedSemesterRevision, actor, projectId, now,
        });
        const accountCount = Number(economy.accountCount || 0);
        const initializedAccountCount = Number(
          economy.initializedAccountCount || 0,
        );
        const missingGrantCount =
          economy.initialGrantAmount > 0
            ? Math.max(0, accountCount - initializedAccountCount)
            : 0;
        if (accountCount === 0 || missingGrantCount)
          fail(
            "failed-precondition",
            "All active accounts require their exactly-once initial grant.",
            "WIS_INITIALIZATION_INCOMPLETE",
            {
              accountCount,
              missingGrantCount,
            },
          );
      }
      const economyRevision = economy.revision + 1;
      transaction.set(
        economyPath(payload.semesterId),
        {
          ...initialOpeningBinding,
          revision: economyRevision,
          status: payload.targetStatus,
          provenance: ["CLOSED", "ARCHIVED"].includes(payload.targetStatus) ? "ARCHIVE" : "CURRENT",
          readOnly: ["CLOSED", "ARCHIVED"].includes(payload.targetStatus),
          transitionReason: payload.reason,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "wis-economy-transition",
          id: payload.semesterId,
          refs: [economyPath(payload.semesterId)],
        },
        sourceHash: sha256(`${economy.status}\n${payload.targetStatus}`),
        result: {
          semesterId: payload.semesterId,
          revision: economyRevision,
          status: payload.targetStatus,
        },
      };
    }
    if (commandType === WIS_COMMAND_TYPES.UPSERT_WIS_PRODUCT) {
      assertTeacher(actor);
      const path = productPath(payload.productId);
      const linkedInventoryPath = inventoryPath(
        inventoryIdFor(payload.semesterId, payload.productId),
      );
      const [existing, linkedInventory] = await transaction.getAll([
        path,
        linkedInventoryPath,
      ]);
      const currentRevision = Number(existing.data?.revision || 0);
      if (
        (existing.exists &&
          payload.expectedProductRevision !== currentRevision) ||
        (!existing.exists && payload.expectedProductRevision !== null)
      )
        fail(
          "aborted",
          "Product revision changed.",
          "WIS_PRODUCT_REVISION_CONFLICT",
        );
      const nextRevision = currentRevision + 1;
      transaction.set(
        path,
        {
          schemaVersion: WIS_SCHEMA_VERSION,
          policyVersion: WIS_POLICY_VERSION,
          productId: payload.productId,
          revision: nextRevision,
          name: payload.name,
          description: payload.description,
          imageUrl: payload.imageUrl,
          active: payload.active,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
          ...(existing.exists
            ? {}
            : { createdAt: timestamp, createdBy: actor.actorUid }),
        },
        { merge: true },
      );
      let inventoryRevision = null;
      if (
        linkedInventory.exists &&
        linkedInventory.data?.semesterId === payload.semesterId
      ) {
        inventoryRevision = Number(linkedInventory.data?.revision || 0) + 1;
        transaction.set(
          linkedInventoryPath,
          {
            productName: payload.name,
            productRevision: nextRevision,
            revision: inventoryRevision,
            updatedAt: timestamp,
            updatedBy: actor.actorUid,
          },
          { merge: true },
        );
      }
      return {
        target: {
          kind: "wis-product",
          id: payload.productId,
          refs: [
            path,
            ...(linkedInventory.exists ? [linkedInventoryPath] : []),
          ],
        },
        sourceHash: sha256(canonicalJson(payload)),
        result: {
          productId: payload.productId,
          revision: nextRevision,
          inventoryRevision,
          active: payload.active,
        },
      };
    }
    if (commandType === WIS_COMMAND_TYPES.UPSERT_WIS_INVENTORY) {
      assertTeacher(actor);
      const [product, existing] = await transaction.getAll([
        productPath(payload.productId),
        inventoryPath(payload.inventoryId),
      ]);
      if (!product.exists)
        fail("not-found", "Product was not found.", "WIS_PRODUCT_NOT_FOUND");
      const currentRevision = Number(existing.data?.revision || 0);
      if (
        (existing.exists &&
          currentRevision !== payload.expectedInventoryRevision) ||
        (!existing.exists && payload.expectedInventoryRevision !== null)
      )
        fail(
          "aborted",
          "Inventory revision changed.",
          "WIS_INVENTORY_REVISION_CONFLICT",
        );
      const reserved = Number(existing.data?.reserved || 0);
      if (payload.stock < reserved)
        fail(
          "failed-precondition",
          "Stock cannot be below reserved quantity.",
          "WIS_INVENTORY_RESERVED_CONFLICT",
        );
      const nextRevision = currentRevision + 1;
      transaction.set(
        inventoryPath(payload.inventoryId),
        {
          schemaVersion: WIS_SCHEMA_VERSION,
          policyVersion: WIS_POLICY_VERSION,
          inventoryId: payload.inventoryId,
          semesterId: payload.semesterId,
          productId: payload.productId,
          productRevision: product.data?.revision,
          productName: product.data?.name,
          revision: nextRevision,
          price: payload.price,
          stock: payload.stock,
          available: payload.stock - reserved,
          reserved,
          sold: Number(existing.data?.sold || 0),
          active: payload.active,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
          ...(existing.exists ? {} : { createdAt: timestamp }),
        },
        { merge: true },
      );
      if (!existing.exists)
        transaction.set(
          economyPath(payload.semesterId),
          {
            inventoryCount: Number(economy.inventoryCount || 0) + 1,
            updatedAt: timestamp,
            updatedBy: actor.actorUid,
          },
          { merge: true },
        );
      return {
        target: {
          kind: "wis-inventory",
          id: payload.inventoryId,
          refs: [
            inventoryPath(payload.inventoryId),
            productPath(payload.productId),
          ],
        },
        sourceHash: sha256(canonicalJson(payload)),
        result: {
          inventoryId: payload.inventoryId,
          revision: nextRevision,
          available: payload.stock - reserved,
          reserved,
        },
      };
    }
    if (commandType === WIS_COMMAND_TYPES.PLACE_WIS_ORDER) {
      assertStudent(actor);
      if (economy.status !== "ACTIVE_OPEN")
        fail(
          "failed-precondition",
          "Wis shop is not open.",
          "WIS_ECONOMY_STATE_INVALID",
        );
      const accountId = accountIdFor(payload.semesterId, actor.actorUid);
      const activeEnrollment = await readCanonicalActiveEnrollment(
        transaction,
        payload.semesterId,
        actor.actorUid,
      );
      const [accountSnapshot, inventorySnapshot] = await transaction.getAll([
        accountPath(accountId),
        inventoryPath(payload.inventoryId),
      ]);
      const account = accountSnapshot.data || {};
      const inventory = inventorySnapshot.data || {};
      const productSnapshot = inventory.productId
        ? await transaction.get(productPath(String(inventory.productId)))
        : { exists: false, data: null };
      const product = productSnapshot.data || {};
      if (
        !activeEnrollment ||
        !accountSnapshot.exists ||
        account.semesterId !== payload.semesterId ||
        account.studentUid !== actor.actorUid
      )
        fail(
          "not-found",
          "An active enrollment and Wis account are required.",
          "WIS_ACTIVE_ENROLLMENT_REQUIRED",
        );
      if (Number(account.revision || 0) !== payload.expectedAccountRevision)
        fail(
          "aborted",
          "Wis account revision changed.",
          "WIS_ACCOUNT_REVISION_CONFLICT",
        );
      if (
        !inventorySnapshot.exists ||
        inventory.semesterId !== payload.semesterId ||
        inventory.active !== true ||
        Number(inventory.revision || 0) !== payload.expectedInventoryRevision
      )
        fail(
          "aborted",
          "Inventory changed.",
          "WIS_INVENTORY_REVISION_CONFLICT",
        );
      if (
        !productSnapshot.exists ||
        product.active !== true ||
        String(product.productId || "") !== String(inventory.productId || "") ||
        Number(product.revision || 0) !== Number(inventory.productRevision || 0)
      )
        fail(
          "failed-precondition",
          "Product is not available for ordering.",
          "WIS_PRODUCT_UNAVAILABLE",
        );
      if (Number(inventory.available || 0) < payload.quantity)
        fail(
          "failed-precondition",
          "Inventory is insufficient.",
          "WIS_INSUFFICIENT_STOCK",
        );
      const totalPrice = Number(inventory.price || 0) * payload.quantity;
      const orderId = orderIdFor(
        payload.semesterId,
        accountId,
        payload.inventoryId,
        commandId,
      );
      const posted = await postLedger({
        transaction,
        account,
        economy,
        delta: -totalPrice,
        type: "ORDER_DEBIT",
        sourceId: orderId,
        reason: `상품 주문: ${inventory.productName || inventory.productId}`,
        commandId,
        receiptId,
        timestamp: projectionTimestamp,
        actor,
      });
      transaction.set(
        inventoryPath(payload.inventoryId),
        {
          revision: payload.expectedInventoryRevision + 1,
          available: inventory.available - payload.quantity,
          reserved: Number(inventory.reserved || 0) + payload.quantity,
          updatedAt: timestamp,
        },
        { merge: true },
      );
      transaction.create(orderPath(orderId), {
        schemaVersion: WIS_SCHEMA_VERSION,
        policyVersion: WIS_POLICY_VERSION,
        orderId,
        semesterId: payload.semesterId,
        accountId,
        studentUid: actor.actorUid,
        enrollmentId: account.enrollmentId,
        classId: account.classId,
        inventoryId: payload.inventoryId,
        productId: inventory.productId,
        productName: inventory.productName,
        quantity: payload.quantity,
        unitPrice: inventory.price,
        totalPrice,
        memo: payload.memo || "",
        debitLedgerEntryId: posted.ledgerEntryId,
        revision: 1,
        status: "REQUESTED",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      transaction.set(
        economyPath(payload.semesterId),
        {
          orderCount: Number(economy.orderCount || 0) + 1,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "wis-order",
          id: orderId,
          refs: [
            orderPath(orderId),
            inventoryPath(payload.inventoryId),
            ledgerPath(posted.ledgerEntryId),
            accountPath(accountId),
          ],
        },
        sourceHash: sha256(
          canonicalJson({
            inventoryId: payload.inventoryId,
            quantity: payload.quantity,
            totalPrice,
          }),
        ),
        result: {
          orderId,
          status: "REQUESTED",
          orderRevision: 1,
          inventoryRevision: payload.expectedInventoryRevision + 1,
          accountRevision: posted.accountRevision,
          balance: posted.balance,
          ledgerEntryId: posted.ledgerEntryId,
        },
      };
    }
    if (commandType === WIS_COMMAND_TYPES.REVIEW_WIS_ORDER) {
      assertTeacher(actor);
      const orderSnapshot = await transaction.get(orderPath(payload.orderId));
      const order = orderSnapshot.data || {};
      if (!orderSnapshot.exists || order.semesterId !== payload.semesterId)
        fail("not-found", "Order was not found.", "WIS_ORDER_NOT_FOUND");
      if (Number(order.revision || 0) !== payload.expectedOrderRevision)
        fail(
          "aborted",
          "Order revision changed.",
          "WIS_ORDER_REVISION_CONFLICT",
        );
      const nextStatus =
        payload.action === "APPROVE"
          ? "APPROVED"
          : payload.action === "FULFILL"
            ? "FULFILLED"
            : "REJECTED";
      const allowedStatus =
        payload.action === "APPROVE" || payload.action === "REJECT"
          ? "REQUESTED"
          : "APPROVED";
      if (order.status !== allowedStatus)
        fail(
          "failed-precondition",
          "Order state is invalid.",
          "WIS_ORDER_STATE_INVALID",
        );
      const refs = [orderPath(payload.orderId)];
      const result = {
        orderId: payload.orderId,
        status: nextStatus,
        orderRevision: payload.expectedOrderRevision + 1,
      };
      if (payload.action === "REJECT") {
        const [inventorySnapshot, accountSnapshot] = await transaction.getAll([
          inventoryPath(order.inventoryId),
          accountPath(order.accountId),
        ]);
        const inventory = inventorySnapshot.data || {};
        const account = accountSnapshot.data || {};
        if (!inventorySnapshot.exists || !accountSnapshot.exists)
          fail(
            "failed-precondition",
            "Order dependencies are missing.",
            "WIS_ORDER_DEPENDENCY_INVALID",
          );
        const posted = await postLedger({
          transaction,
          account,
          economy,
          delta: Number(order.totalPrice || 0),
          type: "ORDER_REFUND",
          sourceId: payload.orderId,
          reason: payload.reason,
          commandId,
          receiptId,
          timestamp: projectionTimestamp,
          actor,
        });
        transaction.set(
          inventoryPath(order.inventoryId),
          {
            revision: Number(inventory.revision || 0) + 1,
            available: Number(inventory.available || 0) + order.quantity,
            reserved: Number(inventory.reserved || 0) - order.quantity,
            updatedAt: timestamp,
          },
          { merge: true },
        );
        Object.assign(result, {
          refundLedgerEntryId: posted.ledgerEntryId,
          balance: posted.balance,
        });
        refs.push(
          inventoryPath(order.inventoryId),
          ledgerPath(posted.ledgerEntryId),
          accountPath(order.accountId),
        );
      } else if (payload.action === "FULFILL") {
        const inventorySnapshot = await transaction.get(
          inventoryPath(order.inventoryId),
        );
        const inventory = inventorySnapshot.data || {};
        if (
          !inventorySnapshot.exists ||
          Number(inventory.reserved || 0) < order.quantity
        )
          fail(
            "failed-precondition",
            "Reserved inventory is inconsistent.",
            "WIS_ORDER_DEPENDENCY_INVALID",
          );
        transaction.set(
          inventoryPath(order.inventoryId),
          {
            revision: Number(inventory.revision || 0) + 1,
            reserved: inventory.reserved - order.quantity,
            sold: Number(inventory.sold || 0) + order.quantity,
            updatedAt: timestamp,
          },
          { merge: true },
        );
        refs.push(inventoryPath(order.inventoryId));
      }
      transaction.set(
        orderPath(payload.orderId),
        {
          revision: payload.expectedOrderRevision + 1,
          status: nextStatus,
          reviewReason: payload.reason,
          reviewedBy: actor.actorUid,
          reviewedAt: timestamp,
          updatedAt: timestamp,
        },
        { merge: true },
      );
      return {
        target: { kind: "wis-order-review", id: payload.orderId, refs },
        sourceHash: sha256(`${payload.orderId}\n${payload.action}`),
        result,
      };
    }
    if (commandType === WIS_COMMAND_TYPES.SAVE_WIS_HALL_OF_FAME_CONFIG) {
      assertTeacher(actor);
      const configSnapshot = await transaction.get(
        WIS_HALL_OF_FAME_CONFIG_PATH,
      );
      const currentRevision = Number(
        configSnapshot.data?.hallOfFameRevision || 0,
      );
      if (currentRevision !== payload.expectedHallOfFameRevision) {
        fail(
          "aborted",
          "Hall of fame configuration revision changed.",
          "WIS_HALL_OF_FAME_REVISION_CONFLICT",
          { currentRevision },
        );
      }
      const nextRevision = currentRevision + 1;
      transaction.set(
        WIS_HALL_OF_FAME_CONFIG_PATH,
        {
          hallOfFame: payload.hallOfFame,
          hallOfFameRevision: nextRevision,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "wis-hall-of-fame-config",
          id: payload.semesterId,
          refs: [WIS_HALL_OF_FAME_CONFIG_PATH],
        },
        sourceHash: sha256(canonicalJson(payload.hallOfFame)),
        result: {
          semesterId: payload.semesterId,
          hallOfFameRevision: nextRevision,
          hallOfFame: payload.hallOfFame,
        },
      };
    }
    fail(
      "invalid-argument",
      "Unsupported Wis command.",
      "WIS_COMMAND_UNSUPPORTED",
    );
  },
});

const normalizeQuery = (raw) => {
  const value = raw || {};
  allowed(
    value,
    [
      "audience",
      "semesterId",
      "source",
      "provenance",
      "projection",
      "accountId",
      "ledgerEntryId",
      "orderStatus",
      "cursor",
      "limit",
      "_session",
    ],
    "getWisEconomyState payload",
  );
  const source = value.provenance || value.source;
  if (!["CURRENT", "ARCHIVE", "LEGACY", "EXPLICIT"].includes(source))
    fail("invalid-argument", "source is invalid.", "WIS_QUERY_INVALID");
  const audience = value.audience === "teacher" ? "teacher" : "student";
  const allowedProjections =
    audience === "teacher"
      ? ["summary", "overview", "account", "orders", "catalog", "hall-of-fame"]
      : ["summary", "student-core", "orders", "catalog", "hall-of-fame"];
  const projection =
    value.projection || (audience === "teacher" ? "overview" : "student-core");
  if (!allowedProjections.includes(projection))
    fail("invalid-argument", "projection is invalid.", "WIS_QUERY_INVALID");
  const cursor = value.cursor ? text(value.cursor, "cursor", 160) : "";
  if (cursor && !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    fail("invalid-argument", "cursor is invalid.", "WIS_QUERY_INVALID");
  }
  return {
    audience,
    semesterId: semesterId(value.semesterId),
    source,
    projection,
    accountId: value.accountId ? text(value.accountId, "accountId", 80) : "",
    ledgerEntryId: value.ledgerEntryId
      ? text(value.ledgerEntryId, "ledgerEntryId", 80)
      : "",
    orderStatus: value.orderStatus
      ? text(value.orderStatus, "orderStatus", 40)
      : "",
    cursor,
    limit:
      value.limit === undefined
        ? WIS_QUERY_DEFAULT_LIMIT
        : integer(value.limit, "limit", { min: 1, max: WIS_QUERY_MAX_LIMIT }),
  };
};
const projectTeacherRosterFields = async (transaction, accounts, scope) => {
  const studentUids = [
    ...new Set(
      accounts
        .map((account) => String(account?.studentUid || "").trim())
        .filter(Boolean),
    ),
  ];
  const slotSnapshots = studentUids.length
    ? await transaction.getAll(
        studentUids.map((studentUid) => enrollmentSlotPath(scope, studentUid)),
      )
    : [];
  const activeEnrollmentIdByStudentUid = new Map(
    slotSnapshots
      .map((slot, index) => [
        studentUids[index],
        slot.exists ? String(slot.data?.activeEnrollmentId || "").trim() : "",
      ])
      .filter(([, enrollmentId]) => Boolean(enrollmentId)),
  );
  const enrollmentIds = [...new Set(activeEnrollmentIdByStudentUid.values())];
  const enrollmentSnapshots = enrollmentIds.length
    ? await transaction.getAll(enrollmentIds.map(enrollmentPath))
    : [];
  const enrollments = new Map(
    enrollmentSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [
        String(snapshot.data?.enrollmentId || ""),
        snapshot.data || {},
      ]),
  );
  const classIds = [
    ...new Set(
      [...enrollments.values()]
        .map((enrollment) => String(enrollment?.classId || "").trim())
        .filter(Boolean),
    ),
  ];
  const classSnapshots = classIds.length
    ? await transaction.getAll(classIds.map(classPath))
    : [];
  const classes = new Map(
    classSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [
        String(snapshot.data?.classId || ""),
        snapshot.data || {},
      ]),
  );
  return accounts.map((account) => {
    const studentUid = String(account?.studentUid || "");
    const activeEnrollmentId = String(
      activeEnrollmentIdByStudentUid.get(studentUid) || "",
    );
    const enrollment = enrollments.get(activeEnrollmentId);
    const canonicalClassId = String(enrollment?.classId || "").trim();
    const semesterClass = classes.get(canonicalClassId);
    const validEnrollment =
      Boolean(enrollment) &&
      String(enrollment.enrollmentId || "") === activeEnrollmentId &&
      String(enrollment.semesterId || "") === scope &&
      String(enrollment.studentUid || "") === studentUid &&
      enrollment.enrollmentStatus === "ACTIVE";
    const validClass =
      validEnrollment &&
      Boolean(semesterClass) &&
      String(semesterClass.semesterId || "") === scope;
    const snapshot =
      validEnrollment &&
      enrollment.snapshot &&
      typeof enrollment.snapshot === "object"
        ? enrollment.snapshot
        : {};
    return {
      ...account,
      enrollmentId: validEnrollment ? activeEnrollmentId : "",
      classId: validEnrollment ? canonicalClassId : "",
      displayName: validEnrollment
        ? String(
            enrollment.displayName ||
              enrollment.studentName ||
              snapshot.displayName ||
              account?.displayName ||
              "학생",
          )
        : String(account?.displayName || "학생"),
      grade: validEnrollment
        ? String(
            snapshot.grade ||
              enrollment.grade ||
              (validClass ? semesterClass.grade : "") ||
              "",
          )
        : "",
      classNumber: validEnrollment
        ? String(
            snapshot.classNumber ||
              enrollment.classNumber ||
              (validClass ? semesterClass.classNumber : "") ||
              "",
          )
        : "",
      studentNumber: validEnrollment
        ? String(enrollment.studentNumber || snapshot.studentNumber || "")
        : "",
    };
  });
};

const paginatePresortedRows = (rows, { cursor, limit, id }) => {
  const cursorIndex = cursor
    ? rows.findIndex((row) => String(id(row)) === cursor)
    : -1;
  const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const page = rows.slice(startIndex, startIndex + limit);
  return {
    rows: page,
    nextCursor:
      startIndex + page.length < rows.length && page.length
        ? String(id(page[page.length - 1]))
        : "",
  };
};

const documentIdFromPath = (path) =>
  String(path || "")
    .split("/")
    .pop() || "";

const queryBoundedDocumentPage = async (
  transaction,
  collection,
  { cursor, limit, field = "", operator = "==", value },
) => {
  const rows = await transaction.query(collection, {
    ...(field ? { field, operator, value } : {}),
    documentIdOrder: "asc",
    ...(cursor ? { startAfterId: cursor } : {}),
    limit: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    rows: page.map((row) => row.data || {}),
    nextCursor:
      rows.length > limit && page.length
        ? documentIdFromPath(page[page.length - 1].path)
        : "",
  };
};

const queryBoundedCreatedAtPage = async (
  transaction,
  collection,
  { cursor, limit, filters },
) => {
  const rows = await transaction.query(collection, {
    filters,
    orderBy: { field: "createdAt", direction: "desc" },
    documentIdOrder: "desc",
    ...(cursor ? { startAfterPath: `${collection}/${cursor}` } : {}),
    limit: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    rows: page.map((row) => row.data || {}),
    nextCursor:
      rows.length > limit && page.length
        ? documentIdFromPath(page[page.length - 1].path)
        : "",
  };
};

const queryHallAccounts = async (transaction, scope) => {
  const rows = await transaction.query(WIS_ACCOUNT_COLLECTION, {
    field: "semesterId",
    operator: "==",
    value: scope,
    limit: WIS_HALL_ACCOUNT_LIMIT + 1,
  });
  if (rows.length > WIS_HALL_ACCOUNT_LIMIT) {
    fail(
      "resource-exhausted",
      "Wis hall-of-fame account limit was exceeded.",
      "WIS_HALL_ACCOUNT_LIMIT_EXCEEDED",
      { limit: WIS_HALL_ACCOUNT_LIMIT },
    );
  }
  return rows.map((row) => row.data || {}).filter((account) => Number(account.rankEarnedTotal || 0) > 0);
};

const projectWisAccount = (account) =>
  account
    ? {
        accountId: String(account.accountId || ""),
        semesterId: String(account.semesterId || ""),
        studentUid: String(account.studentUid || ""),
        displayName: String(account.displayName || "학생"),
        enrollmentId: String(account.enrollmentId || ""),
        classId: String(account.classId || ""),
        status: String(account.status || ""),
        provenance: String(account.provenance || ""),
        readOnly: Boolean(account.readOnly),
        revision: Number(account.revision || 0),
        balance: Number(account.balance || 0),
        initialGrantLedgerEntryId: String(
          account.initialGrantLedgerEntryId || "",
        ),
        grade: String(account.grade || ""),
        classNumber: String(account.classNumber || ""),
        studentNumber: String(account.studentNumber || ""),
        earnedTotal: Number(account.earnedTotal || 0),
        rankEarnedTotal: Number(account.rankEarnedTotal || 0),
        spentTotal: Number(account.spentTotal || 0),
        adjustedTotal: Number(account.adjustedTotal || 0),
      }
    : null;

const projectStudentLedgerEntry = (entry) => ({
  ledgerEntryId: String(entry?.ledgerEntryId || ""),
  type: String(entry?.type || ""),
  delta: Number(entry?.delta || 0),
  balanceBefore: Number(entry?.balanceBefore || 0),
  balanceAfter: Number(entry?.balanceAfter || 0),
  reason: String(entry?.reason || ""),
  createdAt: entry?.createdAt || null,
  ...(["history_dictionary", "history_dictionary_reclaim", ...AUTOMATIC_REWARD_ACTIVITIES].includes(
    entry?.activityType,
  )
    ? { activityType: entry.activityType }
    : {}),
  ...(String(entry?.sourceId || "") === "lesson-core-points-all"
    ? { sourceId: "lesson-core-points-all" }
    : {}),
});

const projectStudentOrder = (order) => ({
  orderId: String(order?.orderId || ""),
  inventoryId: String(order?.inventoryId || ""),
  productId: String(order?.productId || ""),
  productName: String(order?.productName || ""),
  quantity: Number(order?.quantity || 0),
  unitPrice: Number(order?.unitPrice || 0),
  totalPrice: Number(order?.totalPrice || 0),
  revision: Number(order?.revision || 0),
  status: String(order?.status || ""),
  reviewReason: String(order?.reviewReason || ""),
  memo: String(order?.memo || ""),
  createdAt: order?.createdAt || null,
  reviewedAt: order?.reviewedAt || null,
  updatedAt: order?.updatedAt || null,
});

const projectStudentProduct = (product) => ({
  productId: String(product?.productId || ""),
  revision: Number(product?.revision || 0),
  name: String(product?.name || ""),
  description: String(product?.description || ""),
  imageUrl: String(product?.imageUrl || ""),
  active: product?.active === true,
});

const projectStudentInventory = (inventory) => ({
  inventoryId: String(inventory?.inventoryId || ""),
  productId: String(inventory?.productId || ""),
  productRevision: Number(inventory?.productRevision || 0),
  productName: String(inventory?.productName || ""),
  revision: Number(inventory?.revision || 0),
  price: Number(inventory?.price || 0),
  stock: Number(inventory?.stock || 0),
  available: Number(inventory?.available || 0),
  reserved: Number(inventory?.reserved || 0),
  sold: Number(inventory?.sold || 0),
  active: inventory?.active === true,
});

const projectStudentEconomy = (economy) =>
  economy
    ? {
        semesterId: String(economy.semesterId || ""),
        revision: Number(economy.revision || 0),
        status: String(economy.status || ""),
        displayName: String(economy.displayName || ""),
        currencyName: String(economy.currencyName || ""),
        initialGrantAmount: Number(economy.initialGrantAmount || 0),
        provenance: String(economy.provenance || ""),
        readOnly: Boolean(economy.readOnly),
      }
    : null;

const maskStudentName = (value) => {
  const normalized = String(value || "학생").trim() || "학생";
  const characters = Array.from(normalized);
  if (characters.length < 2) return "학생";
  return `${characters[0]}${"*".repeat(Math.min(2, characters.length - 1))}`;
};

const rankHallEntries = (entries) => {
  const sorted = [...entries].sort(
    (left, right) =>
      Number(right.cumulativeEarned || 0) -
        Number(left.cumulativeEarned || 0) ||
      String(left.uid).localeCompare(String(right.uid)),
  );
  let previousScore = null;
  let previousRank = 0;
  return sorted.map((entry, index) => {
    const score = Number(entry.cumulativeEarned || 0);
    const rank = previousScore === score ? previousRank : index + 1;
    previousScore = score;
    previousRank = rank;
    return { ...entry, rank, ...(rank <= 3 ? { podiumSlot: rank } : {}) };
  });
};

const limitHallEntries = (entries, limit, includeTies) => {
  const ranked = rankHallEntries(entries);
  if (!includeTies) return ranked.slice(0, limit);
  // Keep equal ranks, but never turn a podium into the complete school roster.
  return ranked.filter((entry) => entry.rank <= limit).slice(0, 20);
};

const buildWisHallOfFameProjection = ({
  accounts,
  config,
  scope,
  studentAccount = null,
}) => {
  const entries = accounts
    .filter((account) => Number(account.rankEarnedTotal || 0) > 0)
    .map((account) => {
      const grade = String(account?.grade || "").trim();
      const className = String(account?.classNumber || "").trim();
      if (!grade || !className || !account?.studentUid) return null;
      const publicId = `wispublic_${sha256(`${scope}\n${account.studentUid}`).slice(0, 24)}`;
      const publicName = maskStudentName(account.displayName);
      return {
        uid: publicId,
        rank: 1,
        grade,
        class: className,
        classKey: `${grade}-${className}`,
        studentName: publicName,
        displayName: publicName,
        currentBalance: 0,
        cumulativeEarned: Math.max(0, Number(account.rankEarnedTotal || 0)),
        profileIcon: "😀",
      };
    })
    .filter(Boolean);
  const studentGrade = String(studentAccount?.grade || "").trim();
  const studentClassKey =
    studentGrade && studentAccount?.classNumber
      ? `${studentGrade}-${String(studentAccount.classNumber).trim()}`
      : "";
  const gradeEntries = studentAccount
    ? entries.filter((entry) => entry.grade === studentGrade)
    : entries;
  const classEntries = studentAccount
    ? entries.filter((entry) => entry.classKey === studentClassKey)
    : entries;
  const group = (rows, key) =>
    rows.reduce((result, entry) => {
      const groupKey = entry[key];
      if (!result[groupKey]) result[groupKey] = [];
      result[groupKey].push(entry);
      return result;
    }, {});
  const gradeGroups = group(gradeEntries, "grade");
  const classGroups = group(classEntries, "classKey");
  const gradeLeaderboardByGrade = Object.fromEntries(
    Object.entries(gradeGroups).map(([key, rows]) => [
      key,
      limitHallEntries(
        rows,
        config.publicRange.gradeRankLimit,
        config.publicRange.includeTies,
      ),
    ]),
  );
  const classLeaderboardByClassKey = Object.fromEntries(
    Object.entries(classGroups).map(([key, rows]) => [
      key,
      limitHallEntries(
        rows,
        config.publicRange.classRankLimit,
        config.publicRange.includeTies,
      ),
    ]),
  );
  const gradeTop3ByGrade = Object.fromEntries(
    Object.entries(gradeLeaderboardByGrade).map(([key, rows]) => [
      key,
      rows.filter((entry) => entry.rank <= 3),
    ]),
  );
  const classTop3ByClassKey = Object.fromEntries(
    Object.entries(classLeaderboardByClassKey).map(([key, rows]) => [
      key,
      rows.filter((entry) => entry.rank <= 3),
    ]),
  );
  const [year = "", semester = ""] = scope.split("-");
  const snapshotBody = { gradeLeaderboardByGrade, classLeaderboardByClassKey };
  const now = Date.now();
  return {
    year,
    semester,
    snapshotVersion: 7,
    snapshotKey: `w7_${sha256(canonicalJson(snapshotBody)).slice(0, 32)}`,
    rankingMetric: "cumulativeEarned",
    primaryGradeKey:
      studentGrade || Object.keys(gradeLeaderboardByGrade).sort()[0] || "3",
    gradeTop3ByGrade,
    classTop3ByClassKey,
    gradeLeaderboardByGrade,
    classLeaderboardByClassKey,
    leaderboardPolicy: {
      ...config.publicRange,
      storedRankLimit: 20,
    },
    updatedAt: new Date(now).toISOString(),
    updatedAtMs: now,
    sourceUpdatedAtMs: now,
  };
};

const emptyWisState = ({
  query,
  provenance,
  readOnly,
  economy = null,
  manifestRevision = 0,
  reason = "",
}) => ({
  audience: query.audience,
  semesterId: query.semesterId,
  manifestRevision,
  provenance,
  readOnly,
  status: "EMPTY",
  economy,
  account: null,
  accounts: [],
  ledger: [],
  products: [],
  inventory: [],
  orders: [],
  rankings: [],
  hallOfFame: null,
  hallOfFameConfig: null,
  hallOfFameConfigRevision: 0,
  nextCursor: "",
  reason,
  writeCount: 0,
});

const createWisQueryCore = ({
  store,
  assertSession = sessionAuthority.assertActiveApplicationSession,
} = {}) => {
  if (!store) throw new TypeError("store is required.");
  const getWisEconomyState = async (request) => {
    const identity = await assertSession(request, {
      recentAuth: false,
      highRisk: false,
    });
    const uid = String(identity?.uid || request.auth?.uid || "").trim();
    if (!uid || uid !== String(request.auth?.uid || "").trim())
      fail(
        "permission-denied",
        "Authenticated actor mismatch.",
        "COMMAND_ACTOR_MISMATCH",
      );
    const query = normalizeQuery(request.data || {});
    const profile = await store.get(`users/${uid}`);
    const profileData = profile.data || {};
    const permissions = Array.isArray(profileData.staffPermissions)
      ? profileData.staffPermissions
      : [];
    const role = String(profileData.role || "student");
    const isAdmin =
      String(
        identity?.email || request.auth?.token?.email || "",
      ).toLowerCase() === "westoria28@gmail.com";
    const portalEligible =
      role === "teacher" || profileData.teacherPortalEnabled === true;
    const canRead =
      isAdmin ||
      (portalEligible &&
        permissions.some((permission) =>
          ["point_read", "point_manage"].includes(permission),
        ));
    const canManage =
      isAdmin || (portalEligible && permissions.includes("point_manage"));
    if (query.audience === "teacher" && !canRead)
      fail(
        "permission-denied",
        "Wis read permission is required.",
        "WIS_MANAGE_REQUIRED",
      );
    if (query.source === "LEGACY")
      return {
        ...emptyWisState({
          query,
          provenance: "LEGACY",
          readOnly: true,
          reason: "LEGACY_SOURCE_REQUIRES_EXPLICIT_READ_ONLY_ADAPTER",
        }),
        status: "LEGACY",
      };
    return store.runTransaction(async (transaction) => {
      const [manifest, economySnapshot, interfaceSnapshot] =
        await transaction.getAll([
          manifestPath(query.semesterId),
          economyPath(query.semesterId),
          WIS_HALL_OF_FAME_CONFIG_PATH,
        ]);
      const manifestStatus = String(manifest.data?.status || "");
      const lifecycle = ["CLOSED", "ARCHIVED"].includes(manifestStatus)
        ? "ARCHIVE"
        : manifestStatus === "ACTIVE"
          ? "CURRENT"
          : "PREPARING";
      const provenance = query.source === "EXPLICIT" ? "EXPLICIT" : lifecycle;
      const readOnly =
        manifestStatus !== "ACTIVE" ||
        (query.audience === "student" &&
          economySnapshot.data?.status !== "ACTIVE_OPEN") ||
        (query.audience === "teacher" && !canManage);
      const manifestRevision = Number(manifest.data?.revision || 0);
      if (query.audience === "student" && lifecycle === "PREPARING") {
        return emptyWisState({
          query,
          provenance,
          readOnly: true,
          manifestRevision,
          reason: "PREPARING_STUDENT_DATA_HIDDEN",
        });
      }
      if (!manifest.exists || !economySnapshot.exists) {
        return emptyWisState({
          query,
          provenance,
          readOnly: true,
          economy: economySnapshot.data || null,
          manifestRevision,
          reason: manifest.exists
            ? "WIS_ECONOMY_NOT_CREATED"
            : "SEMESTER_NOT_FOUND",
        });
      }
      let hallOfFameConfig;
      try {
        hallOfFameConfig = normalizeWisHallOfFameConfig(
          interfaceSnapshot.data?.hallOfFame || {},
        );
      } catch (_error) {
        hallOfFameConfig = structuredClone(DEFAULT_WIS_HALL_OF_FAME_CONFIG);
      }
      const base = {
        audience: query.audience,
        semesterId: query.semesterId,
        manifestRevision,
        provenance,
        readOnly,
        status: "CONTENT",
        economy: economySnapshot.data,
        account: null,
        accounts: [],
        ledger: [],
        products: [],
        inventory: [],
        orders: [],
        rankings: [],
        hallOfFame: null,
        hallOfFameConfig:
          query.projection === "hall-of-fame" ? hallOfFameConfig : null,
        hallOfFameConfigRevision: Number(
          interfaceSnapshot.data?.hallOfFameRevision || 0,
        ),
        nextCursor: "",
        reason: "",
        writeCount: 0,
      };

      if (query.audience === "student") {
        const studentBase = {
          ...base,
          economy: projectStudentEconomy(economySnapshot.data),
        };
        const ownAccountId = accountIdFor(query.semesterId, uid);
        const [accountSnapshot, activeEnrollment] = await Promise.all([
          transaction.get(accountPath(ownAccountId)),
          readCanonicalActiveEnrollment(transaction, query.semesterId, uid),
        ]);
        const account =
          activeEnrollment &&
          accountSnapshot.exists &&
          accountSnapshot.data?.studentUid === uid &&
          accountSnapshot.data?.semesterId === query.semesterId
            ? {
                ...accountSnapshot.data,
                enrollmentId: activeEnrollment.enrollmentId,
                classId: activeEnrollment.classId,
                displayName:
                  activeEnrollment.displayName ||
                  activeEnrollment.studentName ||
                  activeEnrollment.snapshot?.displayName ||
                  accountSnapshot.data?.displayName,
                grade:
                  activeEnrollment.snapshot?.grade ||
                  activeEnrollment.grade ||
                  accountSnapshot.data?.grade,
                classNumber:
                  activeEnrollment.snapshot?.classNumber ||
                  activeEnrollment.classNumber ||
                  accountSnapshot.data?.classNumber,
                studentNumber:
                  activeEnrollment.studentNumber ||
                  activeEnrollment.snapshot?.studentNumber ||
                  accountSnapshot.data?.studentNumber,
              }
            : null;
        if (!account) {
          return emptyWisState({
            query,
            provenance,
            readOnly: true,
            economy: projectStudentEconomy(economySnapshot.data),
            manifestRevision,
            reason: "WIS_ACTIVE_ENROLLMENT_REQUIRED",
          });
        }
        if (query.projection === "student-core") {
          const recentLedger = Array.isArray(account?.recentLedgerEntries)
            ? account.recentLedgerEntries
            : account
              ? (
                  await transaction.query(WIS_LEDGER_COLLECTION, {
                    field: "accountId",
                    operator: "==",
                    value: ownAccountId,
                    orderBy: { field: "createdAt", direction: "desc" },
                    limit: Math.min(query.limit, WIS_RECENT_LEDGER_LIMIT),
                  })
                ).map((row) => row.data)
              : [];
          const ledgerRows = recentLedger.slice(0, WIS_RECENT_LEDGER_LIMIT);
          const page = paginatePresortedRows(ledgerRows, {
            cursor: query.cursor,
            limit: query.limit,
            id: (row) => row.ledgerEntryId,
          });
          const ownRankingSnapshot = account
            ? await transaction.get(rankingPath(ownAccountId))
            : { exists: false, data: null };
          const ownRanking =
            ownRankingSnapshot.exists &&
            ownRankingSnapshot.data?.studentUid === uid &&
            ownRankingSnapshot.data?.semesterId === query.semesterId
              ? ownRankingSnapshot.data
              : null;
          return {
            ...studentBase,
            account: projectWisAccount(account),
            ledger: page.rows.map(projectStudentLedgerEntry),
            rankings: ownRanking
              ? [
                  {
                    accountId: ownAccountId,
                    semesterId: query.semesterId,
                    studentUid: uid,
                    balance: Number(ownRanking.balance || 0),
                    rankEarnedTotal: Number(
                      ownRanking.rankEarnedTotal ||
                        account?.rankEarnedTotal ||
                        0,
                    ),
                    ledgerRevision: Number(ownRanking.ledgerRevision || 0),
                  },
                ]
              : [],
            nextCursor: page.nextCursor,
            status: account ? "CONTENT" : "EMPTY",
          };
        }
        if (query.projection === "orders") {
          const page = account
            ? await queryBoundedCreatedAtPage(
                transaction,
                WIS_ORDER_COLLECTION,
                {
                  cursor: query.cursor,
                  limit: query.limit,
                  filters: [
                    {
                      field: "accountId",
                      operator: "==",
                      value: ownAccountId,
                    },
                    ...(query.orderStatus
                      ? [
                          {
                            field: "status",
                            operator: "==",
                            value: query.orderStatus,
                          },
                        ]
                      : []),
                  ],
                },
              )
            : { rows: [], nextCursor: "" };
          return {
            ...studentBase,
            account: projectWisAccount(account),
            orders: page.rows.map(projectStudentOrder),
            nextCursor: page.nextCursor,
            status: account || page.rows.length ? "CONTENT" : "EMPTY",
          };
        }
        if (query.projection === "catalog") {
          const productPage = await queryBoundedDocumentPage(
            transaction,
            WIS_PRODUCT_COLLECTION,
            {
              cursor: query.cursor,
              limit: query.limit,
              field: "active",
              value: true,
            },
          );
          const inventorySnapshots = await transaction.getAll(
            productPage.rows.map((product) =>
              inventoryPath(
                inventoryIdFor(query.semesterId, product.productId),
              ),
            ),
          );
          const productInventory = productPage.rows
            .map((product, index) => ({
              product,
              inventory: inventorySnapshots[index],
            }))
            .filter(
              ({ inventory }) =>
                inventory.exists &&
                inventory.data?.semesterId === query.semesterId,
            );
          return {
            ...studentBase,
            account: projectWisAccount(account),
            products: productInventory.map(({ product }) =>
              projectStudentProduct(product),
            ),
            inventory: productInventory.map(({ inventory }) =>
              projectStudentInventory(inventory.data),
            ),
            nextCursor: productPage.nextCursor,
            status: productInventory.length ? "CONTENT" : "EMPTY",
          };
        }
        if (query.projection === "hall-of-fame") {
          const projectedAccounts = await projectTeacherRosterFields(
            transaction,
            await queryHallAccounts(transaction, query.semesterId),
            query.semesterId,
          );
          const studentAccount =
            projectedAccounts.find((item) => item.studentUid === uid) || null;
          return {
            ...studentBase,
            account: projectWisAccount(account),
            hallOfFame: buildWisHallOfFameProjection({
              accounts: projectedAccounts,
              config: hallOfFameConfig,
              scope: query.semesterId,
              studentAccount,
            }),
            status: studentAccount ? "CONTENT" : "EMPTY",
          };
        }
        return {
          ...studentBase,
          account: projectWisAccount(account),
          status: account ? "CONTENT" : "EMPTY",
        };
      }

      if (query.projection === "overview") {
        const page = await queryBoundedDocumentPage(
          transaction,
          WIS_ACCOUNT_COLLECTION,
          {
            cursor: query.cursor,
            limit: query.limit,
            field: "semesterId",
            value: query.semesterId,
          },
        );
        const accounts = (
          await projectTeacherRosterFields(
            transaction,
            page.rows,
            query.semesterId,
          )
        ).map(projectWisAccount);
        return {
          ...base,
          accounts,
          nextCursor: page.nextCursor,
          status: accounts.length ? "CONTENT" : "EMPTY",
        };
      }
      if (query.projection === "account") {
        let ledgerEntry = null;
        let targetAccountId = query.accountId;
        if (query.ledgerEntryId) {
          const entrySnapshot = await transaction.get(
            ledgerPath(query.ledgerEntryId),
          );
          if (
            entrySnapshot.exists &&
            entrySnapshot.data?.semesterId === query.semesterId
          ) {
            ledgerEntry = entrySnapshot.data;
            targetAccountId = String(ledgerEntry.accountId || "");
          }
        }
        const accountSnapshot = targetAccountId
          ? await transaction.get(accountPath(targetAccountId))
          : { exists: false, data: null };
        const rawAccount =
          accountSnapshot.exists &&
          accountSnapshot.data?.semesterId === query.semesterId
            ? accountSnapshot.data
            : null;
        const recentLedger = Array.isArray(rawAccount?.recentLedgerEntries)
          ? rawAccount.recentLedgerEntries
          : rawAccount
            ? (
                await transaction.query(WIS_LEDGER_COLLECTION, {
                  field: "accountId",
                  operator: "==",
                  value: targetAccountId,
                  orderBy: { field: "createdAt", direction: "desc" },
                  limit: Math.min(query.limit, WIS_RECENT_LEDGER_LIMIT),
                })
              ).map((row) => row.data)
            : [];
        const filteredLedger = ledgerEntry
          ? [ledgerEntry]
          : recentLedger.slice(0, WIS_RECENT_LEDGER_LIMIT);
        const page = paginatePresortedRows(filteredLedger, {
          cursor: query.cursor,
          limit: query.limit,
          id: (row) => row.ledgerEntryId,
        });
        const accounts = rawAccount
          ? (
              await projectTeacherRosterFields(
                transaction,
                [rawAccount],
                query.semesterId,
              )
            ).map(projectWisAccount)
          : [];
        return {
          ...base,
          account: accounts[0] || null,
          accounts,
          ledger: page.rows,
          nextCursor: page.nextCursor,
          status: accounts.length ? "CONTENT" : "EMPTY",
        };
      }
      if (query.projection === "orders") {
        const page = await queryBoundedCreatedAtPage(
          transaction,
          WIS_ORDER_COLLECTION,
          {
            cursor: query.cursor,
            limit: query.limit,
            filters: [
              {
                field: "semesterId",
                operator: "==",
                value: query.semesterId,
              },
              ...(query.orderStatus
                ? [
                    {
                      field: "status",
                      operator: "==",
                      value: query.orderStatus,
                    },
                  ]
                : []),
            ],
          },
        );
        const accountIds = [
          ...new Set(
            page.rows
              .map((order) => String(order.accountId || ""))
              .filter(Boolean),
          ),
        ];
        const accountSnapshots = accountIds.length
          ? await transaction.getAll(accountIds.map(accountPath))
          : [];
        const accounts = (
          await projectTeacherRosterFields(
            transaction,
            accountSnapshots
              .filter((snapshot) => snapshot.exists)
              .map((snapshot) => snapshot.data),
            query.semesterId,
          )
        ).map(projectWisAccount);
        return {
          ...base,
          accounts,
          orders: page.rows,
          nextCursor: page.nextCursor,
          status: page.rows.length ? "CONTENT" : "EMPTY",
        };
      }
      if (query.projection === "catalog") {
        const productPage = await queryBoundedDocumentPage(
          transaction,
          WIS_PRODUCT_COLLECTION,
          { cursor: query.cursor, limit: query.limit },
        );
        const inventorySnapshots = await transaction.getAll(
          productPage.rows.map((product) =>
            inventoryPath(inventoryIdFor(query.semesterId, product.productId)),
          ),
        );
        const productInventory = productPage.rows
          .map((product, index) => ({
            product,
            inventory: inventorySnapshots[index],
          }))
          .filter(
            ({ inventory }) =>
              inventory.exists &&
              inventory.data?.semesterId === query.semesterId,
          );
        return {
          ...base,
          products: productInventory.map(({ product }) => product),
          inventory: productInventory.map(({ inventory }) => inventory.data),
          nextCursor: productPage.nextCursor,
          status: productInventory.length ? "CONTENT" : "EMPTY",
        };
      }
      if (query.projection === "hall-of-fame") {
        const projectedAccounts = await projectTeacherRosterFields(
          transaction,
          await queryHallAccounts(transaction, query.semesterId),
          query.semesterId,
        );
        return {
          ...base,
          hallOfFame: buildWisHallOfFameProjection({
            accounts: projectedAccounts,
            config: hallOfFameConfig,
            scope: query.semesterId,
          }),
          status: projectedAccounts.length ? "CONTENT" : "EMPTY",
        };
      }
      return base;
    });
  };
  return { getWisEconomyState };
};
const createWisCallableExports = ({ core }) => ({
  getWisEconomyState: onCall({ region: REGION }, (request) =>
    core.getWisEconomyState(request),
  ),
});

const createWisReadinessAdapter = () => ({
  evaluate: async ({ transaction, manifest }) => {
    const scope = String(manifest?.semesterId || "");
    const economy = await transaction.get(economyPath(scope));
    const collectionCounters = [
      [WIS_ACCOUNT_COLLECTION, "accountCount"],
      [WIS_LEDGER_COLLECTION, "ledgerEntryCount"],
      [WIS_BALANCE_COLLECTION, "accountCount"],
      [WIS_RANKING_COLLECTION, "accountCount"],
      [WIS_INVENTORY_COLLECTION, "inventoryCount"],
      [WIS_ORDER_COLLECTION, "orderCount"],
      [WIS_LEGACY_ISSUE_COLLECTION, "unresolvedLegacyIssueCount"],
    ];
    const boundedPresence = await Promise.all(
      collectionCounters.map(([collection]) =>
        transaction.query(collection, {
          field: "semesterId",
          operator: "==",
          value: scope,
          limit: 1,
        }),
      ),
    );
    const orphanCollectionCount = boundedPresence.filter(
      (rows) => rows.length > 0,
    ).length;
    if (!economy.exists) {
      const applicable = orphanCollectionCount > 0;
      return [
        {
          checkId: "wis_economy_readiness",
          label: "Wis economy readiness",
          category: "WIS_ECONOMY",
          required: true,
          status: applicable ? "FAIL" : "PASS",
          evidence: applicable
            ? `applicability=ORPHANED; collections=${orphanCollectionCount}; dependency=none`
            : "applicability=NOT_APPLICABLE; dependency=none",
          failureReason: applicable ? "WIS_ECONOMY_READINESS_NOT_PASS" : null,
          ownerWave: "W7",
        },
      ];
    }
    const economyData = economy.data || {};
    const counts = Object.fromEntries(
      [
        "accountCount",
        "initializedAccountCount",
        "ledgerEntryCount",
        "inventoryCount",
        "orderCount",
        "unresolvedLegacyIssueCount",
      ].map((key) => [key, Number(economyData[key] || 0)]),
    );
    let invalid =
      economyData.integrityVersion === WIS_INTEGRITY_VERSION ? 0 : 1;
    invalid += Object.values(counts).filter(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ).length;
    if (counts.initializedAccountCount > counts.accountCount) invalid += 1;
    collectionCounters.forEach(([, counter], index) => {
      if (counts[counter] > 0 && boundedPresence[index].length === 0)
        invalid += 1;
    });
    const preparing = ["PREPARING", "VALIDATING", "READY"].includes(
      manifest?.status,
    );
    if (preparing && economyData.status !== "PREPARING_INITIALIZING")
      invalid += 1;
    if (
      !preparing &&
      !["ACTIVE_INITIALIZING", "ACTIVE_OPEN", "CLOSED", "ARCHIVED"].includes(
        economyData.status,
      )
    )
      invalid += 1;
    if (
      preparing &&
      (counts.initializedAccountCount || counts.ledgerEntryCount)
    )
      invalid += 1;
    if (
      !preparing &&
      Number(economyData.initialGrantAmount || 0) > 0 &&
      counts.initializedAccountCount !== counts.accountCount
    )
      invalid += 1;
    if (counts.unresolvedLegacyIssueCount > 0) invalid += 1;
    const dependencyHash = sha256(
      canonicalJson({
        integrityVersion: economyData.integrityVersion,
        revision: economyData.revision,
        status: economyData.status,
        initialGrantAmount: economyData.initialGrantAmount,
        ...counts,
      }),
    );
    return [
      {
        checkId: "wis_economy_readiness",
        label: "Wis economy readiness",
        category: "WIS_ECONOMY",
        required: true,
        status: invalid === 0 ? "PASS" : "FAIL",
        evidence: `applicability=APPLICABLE; accounts=${counts.accountCount}; initialized=${counts.initializedAccountCount}; ledger=${counts.ledgerEntryCount}; inventory=${counts.inventoryCount}; orders=${counts.orderCount}; invalid=${invalid}; integrity=${economyData.integrityVersion || "missing"}; dependency=${dependencyHash}`,
        failureReason: invalid === 0 ? null : "WIS_ECONOMY_READINESS_NOT_PASS",
        ownerWave: "W7",
      },
    ];
  },
});

const getWisCommandSessionOptions = (commandType) => ({
  recentAuth: HIGH_RISK_COMMAND_TYPES.has(commandType),
  highRisk: HIGH_RISK_COMMAND_TYPES.has(commandType),
});

module.exports = {
  HIGH_RISK_COMMAND_TYPES,
  STUDENT_COMMAND_TYPES,
  WIS_ACCOUNT_COLLECTION,
  WIS_BALANCE_COLLECTION,
  WIS_COMMAND_TYPES,
  WIS_ECONOMY_COLLECTION,
  WIS_INVENTORY_COLLECTION,
  WIS_LEDGER_COLLECTION,
  WIS_LEGACY_ISSUE_COLLECTION,
  WIS_ORDER_COLLECTION,
  WIS_POLICY_VERSION,
  WIS_PRODUCT_COLLECTION,
  WIS_RANKING_COLLECTION,
  WIS_RECONCILIATION_COLLECTION,
  WIS_SCHEMA_VERSION,
  accountIdFor,
  createWisCallableExports,
  createWisCommandAdapter,
  createAssessmentWisRewardAdapter,
  createMapTagWisRewardAdapter: (options) => require("./mapTagWisReward").createAdapter({
    ...options, wis: module.exports, writeProjection, ledgerIdFor,
  }),
  createWisQueryCore,
  createWisReadinessAdapter,
  getWisCommandSessionOptions,
  inventoryIdFor,
  initialGrantTotalsFor: (amount) => ({ balance: amount, ...ledgerTotalsContribution("INITIAL_GRANT", amount) }),
  ledgerIdFor,
  normalizeWisPayload,
};
