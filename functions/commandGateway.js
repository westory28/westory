const { createHash } = require("node:crypto");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const {
  onCallWithStudentMaintenance: onCall,
} = require("./studentMaintenance");

const sessionAuthority = require("./sessionAuthority");
const semesterCore = require("./semesterCore");
const archiveEnrollment = require("./archiveEnrollment");
const assessmentLifecycle = require("./assessmentLifecycle");
const gradeEvidence = require("./gradeEvidence");
const wisEconomy = require("./wisEconomy");

const REGION = "asia-northeast3";
const ADMIN_EMAIL = "westoria28@gmail.com";
const RECEIPT_COLLECTION = "command_receipts";
const AUDIT_COLLECTION = "command_audit_events";
const COMMAND_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26})$/i;
const MAX_CANONICAL_PAYLOAD_BYTES = 750_000;
const COMMAND_TYPES = Object.freeze({
  UPDATE_TERMS_SETTINGS: "updateTermsSettings",
  ADD_CONSENT_ITEM: "addConsentItem",
  UPDATE_CONSENT_ITEM: "updateConsentItem",
  DELETE_CONSENT_ITEM: "deleteConsentItem",
  SYNC_KOREAN_PUBLIC_HOLIDAYS: "syncKoreanPublicHolidays",
  ADJUST_TEACHER_POINTS: "adjustTeacherPoints",
  ...semesterCore.SEMESTER_COMMAND_TYPES,
  ...archiveEnrollment.ARCHIVE_ENROLLMENT_COMMAND_TYPES,
  ...assessmentLifecycle.ASSESSMENT_COMMAND_TYPES,
  ...gradeEvidence.GRADE_COMMAND_TYPES,
  ...wisEconomy.WIS_COMMAND_TYPES,
});

const resolveProjectId = (environment = process.env) => {
  const direct = String(
    environment.GCLOUD_PROJECT || environment.GOOGLE_CLOUD_PROJECT || "",
  ).trim();
  if (direct) return direct;
  try {
    return String(JSON.parse(String(environment.FIREBASE_CONFIG || "{}"))?.projectId || "").trim();
  } catch {
    return "";
  }
};

const fail = (code, message, reason, details = {}) => {
  throw new HttpsError(code, message, { reason, ...details });
};

const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");

const readDocuments = async (reader, paths) => {
  if (paths.length === 0) return [];
  if (typeof reader.getAll === "function") return reader.getAll(paths);
  const documents = [];
  for (const path of paths) documents.push(await reader.get(path));
  return documents;
};

const isPlainObject = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const canonicalize = (value, path = "payload") => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("invalid-argument", `${path} contains an invalid number.`, "COMMAND_PAYLOAD_INVALID");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`)).join(",")}]`;
  }
  if (!isPlainObject(value)) {
    fail("invalid-argument", `${path} must contain JSON-compatible values only.`, "COMMAND_PAYLOAD_INVALID");
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => {
      if (value[key] === undefined) {
        fail("invalid-argument", `${path}.${key} cannot be undefined.`, "COMMAND_PAYLOAD_INVALID");
      }
      return `${JSON.stringify(key)}:${canonicalize(value[key], `${path}.${key}`)}`;
    });
  return `{${entries.join(",")}}`;
};

const assertAllowedKeys = (value, allowedKeys, label) => {
  if (!isPlainObject(value)) {
    fail("invalid-argument", `${label} must be an object.`, "COMMAND_PAYLOAD_INVALID");
  }
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    fail(
      "invalid-argument",
      `${label} contains unsupported fields.`,
      "COMMAND_PAYLOAD_INVALID",
      { fields: unexpected },
    );
  }
};

const requireTrimmedString = (value, label, maxLength) => {
  if (typeof value !== "string") {
    fail("invalid-argument", `${label} must be a string.`, "COMMAND_PAYLOAD_INVALID");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    fail(
      "invalid-argument",
      `${label} must contain between 1 and ${maxLength} characters.`,
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  return normalized;
};

const normalizeOptionalTrimmedString = (value, label, maxLength) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    fail("invalid-argument", `${label} must be a string.`, "COMMAND_PAYLOAD_INVALID");
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    fail(
      "invalid-argument",
      `${label} must contain at most ${maxLength} characters.`,
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  return normalized;
};

const normalizeConsentItemId = (value) => {
  const itemId = requireTrimmedString(value, "itemId", 160);
  if (!/^[A-Za-z0-9_-]+$/.test(itemId)) {
    fail("invalid-argument", "itemId is invalid.", "COMMAND_PAYLOAD_INVALID");
  }
  return itemId;
};

const normalizeExpectedRevision = (value) => {
  if (value === null) return null;
  const revision = requireTrimmedString(value, "expectedRevision", 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(revision)) {
    fail(
      "invalid-argument",
      "expectedRevision must be a SHA-256 hash or null for a legacy item.",
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  return revision;
};

const getStoredRevision = (document) => {
  const revision = typeof document?.data?.revision === "string"
    ? document.data.revision.trim().toLowerCase()
    : "";
  return revision || null;
};

const normalizeYear = (value) => {
  const normalized = String(value ?? "").trim();
  if (!/^\d{4}$/.test(normalized)) {
    fail("invalid-argument", "year must be a four-digit year.", "COMMAND_PAYLOAD_INVALID");
  }
  const numericYear = Number(normalized);
  if (numericYear < 2000 || numericYear > 2100) {
    fail("invalid-argument", "year is outside the supported range.", "COMMAND_PAYLOAD_INVALID");
  }
  return normalized;
};

const normalizeSemester = (value) => {
  const normalized = String(value ?? "").trim();
  if (normalized !== "1" && normalized !== "2") {
    fail("invalid-argument", "semester must be 1 or 2.", "COMMAND_PAYLOAD_INVALID");
  }
  return normalized;
};

const normalizeCommandId = (value) =>
  value.includes("-") ? value.toLowerCase() : value.toUpperCase();

const normalizeDateKey = (value, year) => {
  const normalized = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match || match[1] !== year) {
    fail(
      "invalid-argument",
      "Each holiday start must be a valid date within the selected year.",
      "HOLIDAY_MANIFEST_INVALID",
    );
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    fail("invalid-argument", "Holiday date is invalid.", "HOLIDAY_MANIFEST_INVALID");
  }
  return normalized;
};

const sanitizeHolidayDocIdPart = (value) =>
  value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .slice(0, 60);

const buildHolidayDocumentId = ({ title, start }) => {
  const titlePart = sanitizeHolidayDocIdPart(title);
  if (!titlePart) {
    fail("invalid-argument", "Holiday title cannot produce a valid identifier.", "HOLIDAY_MANIFEST_INVALID");
  }
  return `holiday_${start}_${titlePart}`;
};

const normalizePayload = (commandType, payload) => {
  if (Object.values(wisEconomy.WIS_COMMAND_TYPES).includes(commandType)) {
    return wisEconomy.normalizeWisPayload(commandType, payload);
  }
  if (Object.values(gradeEvidence.GRADE_COMMAND_TYPES).includes(commandType)) {
    return gradeEvidence.normalizeGradePayload(commandType, payload);
  }
  if (Object.values(assessmentLifecycle.ASSESSMENT_COMMAND_TYPES).includes(commandType)) {
    return assessmentLifecycle.normalizeAssessmentPayload(commandType, payload);
  }
  if (Object.values(archiveEnrollment.ARCHIVE_ENROLLMENT_COMMAND_TYPES).includes(commandType)) {
    return archiveEnrollment.normalizeArchiveEnrollmentPayload(commandType, payload);
  }
  if (Object.values(semesterCore.SEMESTER_COMMAND_TYPES).includes(commandType)) {
    return semesterCore.normalizeSemesterCommandPayload(commandType, payload);
  }

  if (commandType === COMMAND_TYPES.UPDATE_TERMS_SETTINGS) {
    assertAllowedKeys(payload, ["text"], "updateTermsSettings payload");
    return { text: requireTrimmedString(payload.text, "text", 500_000) };
  }

  if (commandType === COMMAND_TYPES.ADD_CONSENT_ITEM) {
    assertAllowedKeys(payload, ["title", "text", "required"], "addConsentItem payload");
    if (typeof payload.required !== "boolean") {
      fail("invalid-argument", "required must be a boolean.", "COMMAND_PAYLOAD_INVALID");
    }
    return {
      title: requireTrimmedString(payload.title, "title", 200),
      text: requireTrimmedString(payload.text, "text", 100_000),
      required: payload.required,
    };
  }

  if (commandType === COMMAND_TYPES.UPDATE_CONSENT_ITEM) {
    assertAllowedKeys(
      payload,
      ["itemId", "title", "text", "required", "expectedRevision"],
      "updateConsentItem payload",
    );
    if (typeof payload.required !== "boolean") {
      fail("invalid-argument", "required must be a boolean.", "COMMAND_PAYLOAD_INVALID");
    }
    return {
      itemId: normalizeConsentItemId(payload.itemId),
      title: requireTrimmedString(payload.title, "title", 200),
      text: requireTrimmedString(payload.text, "text", 100_000),
      required: payload.required,
      expectedRevision: normalizeExpectedRevision(payload.expectedRevision),
    };
  }

  if (commandType === COMMAND_TYPES.DELETE_CONSENT_ITEM) {
    assertAllowedKeys(
      payload,
      ["itemId", "expectedRevision"],
      "deleteConsentItem payload",
    );
    return {
      itemId: normalizeConsentItemId(payload.itemId),
      expectedRevision: normalizeExpectedRevision(payload.expectedRevision),
    };
  }

  if (commandType === COMMAND_TYPES.ADJUST_TEACHER_POINTS) {
    assertAllowedKeys(
      payload,
      ["year", "semester", "uid", "delta", "sourceLabel", "policyId", "mode"],
      "adjustTeacherPoints payload",
    );
    const delta = payload.delta;
    if (
      typeof delta !== "number"
      || !Number.isFinite(delta)
      || delta === 0
      || Math.abs(delta) > 1_000_000
    ) {
      fail(
        "invalid-argument",
        "delta must be a non-zero finite number within the supported range.",
        "COMMAND_PAYLOAD_INVALID",
      );
    }
    if (payload.mode !== "grant" && payload.mode !== "reclaim") {
      fail("invalid-argument", "mode must be grant or reclaim.", "COMMAND_PAYLOAD_INVALID");
    }
    if (
      (payload.mode === "grant" && delta < 0)
      || (payload.mode === "reclaim" && delta > 0)
    ) {
      fail(
        "invalid-argument",
        "mode does not match the sign of delta.",
        "COMMAND_PAYLOAD_INVALID",
      );
    }
    return {
      year: normalizeYear(payload.year),
      semester: normalizeSemester(payload.semester),
      uid: requireTrimmedString(payload.uid, "uid", 160),
      delta,
      sourceLabel: requireTrimmedString(payload.sourceLabel, "sourceLabel", 240),
      policyId: normalizeOptionalTrimmedString(payload.policyId, "policyId", 160),
      mode: payload.mode,
    };
  }

  if (commandType === COMMAND_TYPES.SYNC_KOREAN_PUBLIC_HOLIDAYS) {
    assertAllowedKeys(payload, ["year", "semester", "holidays"], "syncKoreanPublicHolidays payload");
    const year = normalizeYear(payload.year);
    const semester = normalizeSemester(payload.semester);
    if (!Array.isArray(payload.holidays) || payload.holidays.length < 1 || payload.holidays.length > 64) {
      fail(
        "invalid-argument",
        "holidays must contain between 1 and 64 entries.",
        "HOLIDAY_MANIFEST_INVALID",
      );
    }
    const seenIds = new Set();
    const holidays = payload.holidays.map((holiday, index) => {
      assertAllowedKeys(
        holiday,
        ["title", "start", "eventType", "source"],
        `holidays[${index}]`,
      );
      const title = requireTrimmedString(holiday.title, `holidays[${index}].title`, 100);
      const start = normalizeDateKey(holiday.start, year);
      if (holiday.eventType !== "holiday") {
        fail("invalid-argument", "Holiday eventType must be holiday.", "HOLIDAY_MANIFEST_INVALID");
      }
      if (holiday.source !== "kasi" && holiday.source !== "generated") {
        fail(
          "invalid-argument",
          "Holiday source must be kasi or generated.",
          "HOLIDAY_MANIFEST_INVALID",
        );
      }
      const id = buildHolidayDocumentId({ title, start });
      if (seenIds.has(id)) {
        fail("invalid-argument", "Holiday manifest contains a duplicate entry.", "HOLIDAY_MANIFEST_DUPLICATE");
      }
      seenIds.add(id);
      return { id, title, start, eventType: "holiday", source: holiday.source };
    });
    holidays.sort((left, right) =>
      left.start.localeCompare(right.start)
      || left.title.localeCompare(right.title, "ko")
      || left.source.localeCompare(right.source),
    );
    return { year, semester, holidays };
  }

  fail("invalid-argument", "Unsupported commandType.", "COMMAND_TYPE_UNSUPPORTED", {
    commandType,
  });
};

const parseCommandEnvelope = (data) => {
  const rawCommandId = String(data?.commandId || "").trim();
  const commandType = String(data?.commandType || "").trim();
  if (!COMMAND_ID_PATTERN.test(rawCommandId)) {
    fail(
      "invalid-argument",
      "commandId must be a UUID v4/v7 or ULID.",
      "COMMAND_ID_INVALID",
    );
  }
  const commandId = normalizeCommandId(rawCommandId);
  if (!Object.values(COMMAND_TYPES).includes(commandType)) {
    fail("invalid-argument", "Unsupported commandType.", "COMMAND_TYPE_UNSUPPORTED", {
      commandType,
    });
  }
  const payload = normalizePayload(commandType, data?.payload);
  const canonicalPayload = canonicalize(payload);
  if (Buffer.byteLength(canonicalPayload, "utf8") > MAX_CANONICAL_PAYLOAD_BYTES) {
    fail("invalid-argument", "Command payload is too large.", "COMMAND_PAYLOAD_TOO_LARGE");
  }
  return {
    commandId,
    commandType,
    payload,
    payloadHash: sha256(canonicalPayload),
  };
};

const parseStatusEnvelope = (data) => {
  const rawCommandId = String(data?.commandId || "").trim();
  const commandType = String(data?.commandType || "").trim();
  if (!COMMAND_ID_PATTERN.test(rawCommandId)) {
    fail("invalid-argument", "commandId is invalid.", "COMMAND_ID_INVALID");
  }
  const commandId = normalizeCommandId(rawCommandId);
  if (!Object.values(COMMAND_TYPES).includes(commandType)) {
    fail("invalid-argument", "Unsupported commandType.", "COMMAND_TYPE_UNSUPPORTED");
  }
  return { commandId, commandType };
};

const buildReceiptId = (actorUid, commandType, commandId) =>
  `cmd_${sha256(`${actorUid}\n${commandType}\n${commandId}`)}`;

const serializeSession = (identity) => {
  const revision = String(identity?.session?.sessionRevision || "");
  return {
    ref: identity?.sessionRef?.path || null,
    authTime: Number(identity?.authTime || 0),
    authorityMode: String(identity?.authorityMode || ""),
    authorityGeneration: String(identity?.session?.authorityGeneration || ""),
    protocolVersion: Number(identity?.session?.protocolVersion || 0),
    revisionHash: revision ? sha256(revision) : null,
    observedFailure: identity?.observedFailure || null,
  };
};

const assertAdministrator = (request, identity) => {
  const tokenEmail = String(request.auth?.token?.email || "").trim().toLowerCase();
  const identityEmail = String(identity?.email || "").trim().toLowerCase();
  if (tokenEmail !== ADMIN_EMAIL || identityEmail !== ADMIN_EMAIL) {
    fail(
      "permission-denied",
      "Only the Westory administrator can execute this command.",
      "COMMAND_ADMIN_REQUIRED",
    );
  }
  const actorUid = String(identity?.uid || request.auth?.uid || "").trim();
  if (!actorUid || actorUid !== String(request.auth?.uid || "").trim()) {
    fail("permission-denied", "Authenticated actor mismatch.", "COMMAND_ACTOR_MISMATCH");
  }
  return {
    actorUid,
    actorEmail: tokenEmail,
    actorRole: "admin",
    actorCapability: null,
  };
};

const buildTarget = (commandType, payload, receiptId) => {
  if (commandType === COMMAND_TYPES.UPDATE_TERMS_SETTINGS) {
    return { refs: ["site_settings/terms"] };
  }
  if (commandType === COMMAND_TYPES.ADD_CONSENT_ITEM) {
    const itemId = `consent_${receiptId.slice(4, 36)}`;
    return {
      itemId,
      refs: [
        `site_settings/consent/items/${itemId}`,
        "site_settings/consent",
      ],
    };
  }
  if (
    commandType === COMMAND_TYPES.UPDATE_CONSENT_ITEM
    || commandType === COMMAND_TYPES.DELETE_CONSENT_ITEM
  ) {
    const itemPath = `site_settings/consent/items/${payload.itemId}`;
    const refs = [itemPath, "site_settings/consent"];
    if (commandType === COMMAND_TYPES.DELETE_CONSENT_ITEM) {
      refs.splice(1, 0, `site_settings/consent/deleted_items/${payload.itemId}`);
    }
    return { itemId: payload.itemId, refs };
  }
  return {
    year: payload.year,
    semester: payload.semester,
    refs: [`years/${payload.year}/semesters/${payload.semester}/calendar`],
  };
};

const buildHolidayDocument = (holiday, commandId, timestamp) => ({
  title: holiday.title,
  start: holiday.start,
  end: holiday.start,
  eventType: "holiday",
  targetType: "common",
  targetClass: null,
  description: holiday.source === "kasi"
    ? "한국천문연구원 특일 정보 기준 공휴일"
    : "대한민국 공휴일 규칙 기준 자동 생성",
  holidaySource: holiday.source,
  managedBy: "commandGateway",
  commandId,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const isActiveSemester = ({ pointer, manifest, year, semester }) =>
  pointer?.semesterId === `${year}-${semester}`
  && manifest?.semesterId === `${year}-${semester}`
  && String(manifest?.schoolYear || "") === year
  && String(manifest?.term || "") === semester
  && manifest?.status === "ACTIVE"
  && manifest?.provenance === "CURRENT"
  && Number(pointer?.revision || 0) === Number(manifest?.revision || 0);

const applyBusinessCommand = async ({
  transaction,
  commandId,
  commandType,
  payload,
  payloadHash,
  receiptId,
  timestamp,
  actor,
  commandAdapters,
}) => {
  if (commandType === COMMAND_TYPES.UPDATE_TERMS_SETTINGS) {
    transaction.set("site_settings/terms", {
      text: payload.text,
      revision: payloadHash,
      updatedAt: timestamp,
    });
    return {
      target: buildTarget(commandType, payload, receiptId),
      sourceHash: null,
      result: { revision: payloadHash, ref: "site_settings/terms" },
    };
  }

  if (commandType === COMMAND_TYPES.ADD_CONSENT_ITEM) {
    const target = buildTarget(commandType, payload, receiptId);
    const consentItemsPath = "site_settings/consent/items";
    const consentMetadataPath = "site_settings/consent";
    const metadata = await transaction.get(consentMetadataPath);
    const existingItems = await transaction.query(consentItemsPath);
    const maxExistingOrder = existingItems.reduce((maximum, document) => {
      const order = Number(document.data?.order);
      return Number.isSafeInteger(order) && order >= 1
        ? Math.max(maximum, order)
        : maximum;
    }, 0);
    const metadataNextOrder = Number(metadata.data?.nextItemOrder);
    const order = Number.isSafeInteger(metadataNextOrder) && metadataNextOrder >= 1
      ? Math.max(maxExistingOrder + 1, metadataNextOrder)
      : maxExistingOrder + 1;
    if (!Number.isSafeInteger(order) || order > 1_000_000) {
      fail(
        "failed-precondition",
        "Consent item order counter is outside the supported range.",
        "CONSENT_ORDER_COUNTER_INVALID",
      );
    }
    const item = {
      id: target.itemId,
      title: payload.title,
      text: payload.text,
      required: payload.required,
      order,
    };
    transaction.create(target.refs[0], {
      title: item.title,
      text: item.text,
      required: item.required,
      order: item.order,
      revision: payloadHash,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    transaction.set(
      target.refs[1],
      {
        nextItemOrder: order + 1,
        revision: payloadHash,
        updatedAt: timestamp,
      },
      { merge: true },
    );
    return {
      target,
      sourceHash: null,
      result: { item, revision: payloadHash },
    };
  }

  if (commandType === COMMAND_TYPES.UPDATE_CONSENT_ITEM) {
    const target = buildTarget(commandType, payload, receiptId);
    const itemPath = target.refs[0];
    const itemDocument = await transaction.get(itemPath);
    if (!itemDocument.exists) {
      fail(
        "not-found",
        "Consent item does not exist.",
        "CONSENT_ITEM_NOT_FOUND",
        { itemId: payload.itemId },
      );
    }
    const currentRevision = getStoredRevision(itemDocument);
    if (currentRevision !== payload.expectedRevision) {
      fail(
        "aborted",
        "Consent item revision has changed.",
        "CONSENT_REVISION_CONFLICT",
        { itemId: payload.itemId, currentRevision },
      );
    }
    const order = Number(itemDocument.data?.order);
    if (!Number.isSafeInteger(order) || order < 1) {
      fail(
        "failed-precondition",
        "Consent item order is invalid.",
        "CONSENT_ITEM_ORDER_INVALID",
        { itemId: payload.itemId },
      );
    }
    const item = {
      id: payload.itemId,
      title: payload.title,
      text: payload.text,
      required: payload.required,
      order,
    };
    transaction.set(itemPath, {
      title: item.title,
      text: item.text,
      required: item.required,
      revision: payloadHash,
      updatedAt: timestamp,
    }, { merge: true });
    transaction.set("site_settings/consent", {
      revision: payloadHash,
      updatedAt: timestamp,
    }, { merge: true });
    return {
      target,
      sourceHash: null,
      result: { item, revision: payloadHash },
    };
  }

  if (commandType === COMMAND_TYPES.DELETE_CONSENT_ITEM) {
    const target = buildTarget(commandType, payload, receiptId);
    const [itemDocument, tombstoneDocument] = await readDocuments(transaction, target.refs);
    if (!itemDocument.exists) {
      fail(
        "not-found",
        "Consent item does not exist.",
        "CONSENT_ITEM_NOT_FOUND",
        { itemId: payload.itemId },
      );
    }
    if (tombstoneDocument.exists) {
      fail(
        "failed-precondition",
        "Consent item tombstone already exists.",
        "CONSENT_TOMBSTONE_EXISTS",
        { itemId: payload.itemId },
      );
    }
    const currentRevision = getStoredRevision(itemDocument);
    if (currentRevision !== payload.expectedRevision) {
      fail(
        "aborted",
        "Consent item revision has changed.",
        "CONSENT_REVISION_CONFLICT",
        { itemId: payload.itemId, currentRevision },
      );
    }
    transaction.create(target.refs[1], {
      itemId: payload.itemId,
      item: itemDocument.data || {},
      previousRevision: currentRevision,
      revision: payloadHash,
      deletedBy: actor.actorUid,
      commandId,
      deletedAt: timestamp,
    });
    transaction.delete(target.refs[0]);
    transaction.set(target.refs[2], {
      revision: payloadHash,
      updatedAt: timestamp,
    }, { merge: true });
    return {
      target,
      sourceHash: null,
      result: {
        itemId: payload.itemId,
        revision: payloadHash,
        tombstoneRef: target.refs[1],
      },
    };
  }

  const adapter = commandAdapters?.[commandType];
  if (adapter) {
    if (!adapter || typeof adapter.apply !== "function") {
      fail(
        "failed-precondition",
        "Command adapter is not available.",
        "COMMAND_ADAPTER_UNAVAILABLE",
        { commandType },
      );
    }
    return adapter.apply({
      transaction,
      commandId,
      commandType,
      payload,
      payloadHash,
      receiptId,
      timestamp,
      actor,
    });
  }

  if (
    commandType === COMMAND_TYPES.ADJUST_TEACHER_POINTS
    || Object.values(semesterCore.SEMESTER_COMMAND_TYPES).includes(commandType)
    || Object.values(archiveEnrollment.ARCHIVE_ENROLLMENT_COMMAND_TYPES).includes(commandType)
    || Object.values(assessmentLifecycle.ASSESSMENT_COMMAND_TYPES).includes(commandType)
    || Object.values(gradeEvidence.GRADE_COMMAND_TYPES).includes(commandType)
    || Object.values(wisEconomy.WIS_COMMAND_TYPES).includes(commandType)
  ) {
    fail(
      "failed-precondition",
      "Command adapter is not available.",
      "COMMAND_ADAPTER_UNAVAILABLE",
      { commandType },
    );
  }

  const target = buildTarget(commandType, payload, receiptId);
  const calendarPath = target.refs[0];
  const sourceHash = sha256(canonicalize(payload.holidays));
  const semesterId = `${payload.year}-${payload.semester}`;
  const [pointer, manifest] = await readDocuments(transaction, [
    semesterCore.ACTIVE_SEMESTER_POINTER_PATH,
    `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${semesterId}`,
  ]);
  if (!pointer.exists || !manifest.exists || !isActiveSemester({
    pointer: pointer.data,
    manifest: manifest.data,
    year: payload.year,
    semester: payload.semester,
  })) {
    fail(
      "failed-precondition",
      "Holiday synchronization is limited to the canonical active semester.",
      "HOLIDAY_SCOPE_NOT_ACTIVE",
      { year: payload.year, semester: payload.semester },
    );
  }
  const existingHolidays = await transaction.query(calendarPath, {
    field: "eventType",
    operator: "==",
    value: "holiday",
  });
  const desiredPaths = payload.holidays.map((holiday) => `${calendarPath}/${holiday.id}`);
  const desiredDocuments = await readDocuments(transaction, desiredPaths);
  desiredDocuments.forEach((document, index) => {
    if (document.exists && document.data?.eventType !== "holiday") {
      fail(
        "failed-precondition",
        "A managed holiday ID conflicts with a non-holiday calendar event.",
        "HOLIDAY_DOCUMENT_ID_CONFLICT",
        { ref: desiredPaths[index] },
      );
    }
  });
  existingHolidays.forEach((document) => transaction.delete(document.path));
  payload.holidays.forEach((holiday) => {
    transaction.set(
      `${calendarPath}/${holiday.id}`,
      buildHolidayDocument(holiday, commandId, timestamp),
    );
  });
  return {
    target,
    sourceHash,
    result: { count: payload.holidays.length, sourceHash },
  };
};

const createFirestoreStore = (db = getFirestore()) => ({
  set: (path, data, options) => options
    ? db.doc(path).set(data, options)
    : db.doc(path).set(data),
  get: async (path) => {
    const snapshot = await db.doc(path).get();
    return { exists: snapshot.exists, data: snapshot.exists ? snapshot.data() : null, path };
  },
  query: async (collectionPath, filter = null) => {
    let query = db.collection(collectionPath);
    if (filter) query = query.where(filter.field, filter.operator, filter.value);
    const snapshot = await query.get();
    return snapshot.docs.map((document) => ({
      exists: true,
      data: document.data(),
      path: document.ref.path,
    }));
  },
  runTransaction: (callback) => db.runTransaction(async (firestoreTransaction) => {
    const transaction = {
      native: firestoreTransaction,
      get: async (path) => {
        const snapshot = await firestoreTransaction.get(db.doc(path));
        return {
          exists: snapshot.exists,
          data: snapshot.exists ? snapshot.data() : null,
          path: snapshot.ref.path,
        };
      },
      getAll: async (paths) => {
        if (paths.length === 0) return [];
        const snapshots = await firestoreTransaction.getAll(
          ...paths.map((path) => db.doc(path)),
        );
        return snapshots.map((snapshot) => ({
          exists: snapshot.exists,
          data: snapshot.exists ? snapshot.data() : null,
          path: snapshot.ref.path,
        }));
      },
      query: async (collectionPath, filter = null) => {
        let query = db.collection(collectionPath);
        if (filter) {
          query = query.where(filter.field, filter.operator, filter.value);
        }
        const snapshot = await firestoreTransaction.get(query);
        return snapshot.docs.map((document) => ({
          exists: true,
          data: document.data(),
          path: document.ref.path,
        }));
      },
      set: (path, data, options) => {
        if (options) firestoreTransaction.set(db.doc(path), data, options);
        else firestoreTransaction.set(db.doc(path), data);
      },
      create: (path, data) => firestoreTransaction.create(db.doc(path), data),
      delete: (path) => firestoreTransaction.delete(db.doc(path)),
    };
    return callback(transaction);
  }),
});

const createCommandGatewayCore = ({
  store = createFirestoreStore(),
  assertSession = sessionAuthority.assertActiveApplicationSession,
  authorizeCommand = null,
  commandAdapters = {},
  semesterCoreResolver = semesterCore.resolveSemesterCoreState,
  serverTimestamp = () => FieldValue.serverTimestamp(),
  projectId = resolveProjectId(),
  getSessionOptions = (commandType) => {
    if (Object.values(wisEconomy.WIS_COMMAND_TYPES).includes(commandType)) {
      return wisEconomy.getWisCommandSessionOptions(commandType);
    }
    if (Object.values(gradeEvidence.GRADE_COMMAND_TYPES).includes(commandType)) {
      return gradeEvidence.getGradeCommandSessionOptions(commandType);
    }
    return assessmentLifecycle.STUDENT_COMMAND_TYPES.has(commandType)
      ? { recentAuth: false, highRisk: false }
      : { recentAuth: true, highRisk: true };
  },
} = {}) => {
  const authorize = async (request, commandType) => {
    const identity = await assertSession(request, getSessionOptions(commandType));
    const commandActor = typeof authorizeCommand === "function"
      ? await authorizeCommand({ request, identity, commandType })
      : null;
    const actor = commandActor || assertAdministrator(request, identity);
    const authenticatedUid = String(request.auth?.uid || "").trim();
    if (!actor?.actorUid || actor.actorUid !== authenticatedUid) {
      fail("permission-denied", "Authenticated actor mismatch.", "COMMAND_ACTOR_MISMATCH");
    }
    return {
      identity,
      actor: {
        ...actor,
        actorRole: String(actor.actorRole || "admin").trim() || "admin",
        actorCapability: String(
          actor.actorCapability || `command:${commandType}`,
        ).trim(),
      },
    };
  };

  const execute = async (request) => {
    const requestedCommandType = String(request.data?.commandType || "").trim();
    const { identity, actor } = await authorize(request, requestedCommandType);
    const injectResponseLoss = request.data?._testDropResponseAfterCommit === true;
    if (injectResponseLoss && !String(projectId).startsWith("demo-westory-session-")) {
      fail(
        "invalid-argument",
        "Command fault injection is not available in this environment.",
        "TEST_FAULT_INJECTION_FORBIDDEN",
      );
    }
    const command = parseCommandEnvelope(request.data);
    const receiptId = buildReceiptId(actor.actorUid, command.commandType, command.commandId);
    const receiptPath = `${RECEIPT_COLLECTION}/${receiptId}`;
    const auditPath = `${AUDIT_COLLECTION}/${receiptId}`;

    const response = await store.runTransaction(async (transaction) => {
      const existing = await transaction.get(receiptPath);
      if (existing.exists) {
        if (existing.data?.payloadHash !== command.payloadHash) {
          fail(
            "already-exists",
            "commandId was already used with a different payload.",
            "COMMAND_ID_CONFLICT",
            { commandId: command.commandId, commandType: command.commandType },
          );
        }
        return {
          commandId: command.commandId,
          commandType: command.commandType,
          status: existing.data?.status || "SUCCEEDED",
          replayed: true,
          result: existing.data?.result || null,
        };
      }

      const timestamp = serverTimestamp();
      const business = await applyBusinessCommand({
        transaction,
        ...command,
        receiptId,
        timestamp,
        actor,
        commandAdapters,
      });
      const actorCapability = actor.actorCapability;
      const audit = {
        eventId: receiptId,
        ref: auditPath,
        eventType: "COMMAND_SUCCEEDED",
      };
      const receipt = {
        schemaVersion: 1,
        commandId: command.commandId,
        commandType: command.commandType,
        status: "SUCCEEDED",
        actorUid: actor.actorUid,
        actorEmail: actor.actorEmail,
        actorRole: actor.actorRole,
        actorCapability,
        target: business.target,
        payloadHash: command.payloadHash,
        payloadHashAlgorithm: "sha256",
        sourceHash: business.sourceHash,
        session: serializeSession(identity),
        audit,
        createdAt: timestamp,
        completedAt: timestamp,
        result: business.result,
        error: null,
        retryable: false,
        checkpoint: "COMMITTED",
      };
      transaction.create(receiptPath, receipt);
      transaction.create(auditPath, {
        schemaVersion: 1,
        eventId: receiptId,
        eventType: "COMMAND_SUCCEEDED",
        receiptRef: receiptPath,
        commandId: command.commandId,
        commandType: command.commandType,
        actorUid: actor.actorUid,
        actorEmail: actor.actorEmail,
        actorRole: actor.actorRole,
        actorCapability,
        target: business.target,
        payloadHash: command.payloadHash,
        sourceHash: business.sourceHash,
        result: business.result,
        createdAt: timestamp,
      });
      return {
        commandId: command.commandId,
        commandType: command.commandType,
        status: "SUCCEEDED",
        replayed: false,
        result: business.result,
      };
    });
    if (injectResponseLoss && response.replayed === false) {
      fail(
        "unavailable",
        "The test response was intentionally dropped after commit.",
        "TEST_RESPONSE_LOSS",
      );
    }
    return response;
  };

  const getStatus = async (request) => {
    const requestedCommandType = String(request.data?.commandType || "").trim();
    const { actor } = await authorize(request, requestedCommandType);
    const command = parseStatusEnvelope(request.data);
    const receiptId = buildReceiptId(actor.actorUid, command.commandType, command.commandId);
    const snapshot = await store.get(`${RECEIPT_COLLECTION}/${receiptId}`);
    if (!snapshot.exists) {
      return {
        commandId: command.commandId,
        commandType: command.commandType,
        status: "NOT_FOUND",
        replayed: false,
        result: null,
      };
    }
    return {
      commandId: command.commandId,
      commandType: command.commandType,
      status: snapshot.data?.status || "SUCCEEDED",
      replayed: true,
      result: snapshot.data?.result || null,
    };
  };

  const getSemesterCoreState = async (request) => {
    await authorize(request, "getSemesterCoreState");
    const data = request.data || {};
    assertAllowedKeys(data, ["semesterId", "_session"], "getSemesterCoreState payload");
    return semesterCoreResolver({
      store,
      semesterId: data.semesterId,
    });
  };

  return { execute, getStatus, getSemesterCoreState };
};

let defaultCore;
const getDefaultCore = () => {
  if (!defaultCore) defaultCore = createCommandGatewayCore();
  return defaultCore;
};

const createCallableExports = ({ core } = {}) => ({
  executeCommand: onCall({ region: REGION }, (request) =>
    (core || getDefaultCore()).execute(request)),
  getCommandStatus: onCall({ region: REGION }, (request) =>
    (core || getDefaultCore()).getStatus(request)),
  getSemesterCoreState: onCall({ region: REGION }, (request) =>
    (core || getDefaultCore()).getSemesterCoreState(request)),
});

module.exports = {
  ADMIN_EMAIL,
  AUDIT_COLLECTION,
  COMMAND_TYPES,
  RECEIPT_COLLECTION,
  buildHolidayDocumentId,
  buildReceiptId,
  canonicalize,
  createCallableExports,
  createCommandGatewayCore,
  createFirestoreStore,
  resolveProjectId,
  sha256,
  callableExports: createCallableExports(),
};
