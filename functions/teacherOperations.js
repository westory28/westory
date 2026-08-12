const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const semesterCore = require("./semesterCore");
const sessionAuthority = require("./sessionAuthority");
const assessmentLifecycle = require("./assessmentLifecycle");
const gradeEvidence = require("./gradeEvidence");
const wisEconomy = require("./wisEconomy");
const w8Domains = require("./w8Domains");
const { onCallWithStudentMaintenance: onCall } = require("./studentMaintenance");

const REGION = "asia-northeast3";
const ADMIN_EMAIL = "westoria28@gmail.com";
const TEACHER_OPERATIONS_SCHEMA_VERSION = 1;
const TEACHER_OPERATIONS_POLICY_VERSION = "w9-v1";
const DRAFT_TTL_DAYS = 30;
const DRAFT_TTL_MS = DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000;
const BULK_ITEM_LIMIT = 100;
const BULK_JOB_CANONICAL_BYTE_LIMIT = 300_000;
const ENTITY_ACTIVE_DRAFT_LIMIT = 20;
const ORPHAN_RUNNING_MS = 24 * 60 * 60 * 1000;
const COMMAND_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26})$/i;

const TEACHER_DRAFT_COLLECTION = "teacher_drafts";
const TEACHER_BULK_JOB_COLLECTION = "teacher_bulk_jobs";
const RECEIPT_COLLECTION = "command_receipts";
const READINESS_CHECK_ID = "teacher_operations_readiness";

const DRAFT_STATUSES = Object.freeze(["ACTIVE", "CONFLICT", "SAVED", "DISCARDED", "EXPIRED"]);
const BULK_JOB_STATUSES = Object.freeze(["READY", "RUNNING", "PARTIAL", "SUCCEEDED", "FAILED"]);
const BULK_ITEM_STATUSES = Object.freeze(["PENDING", "SUCCEEDED", "FAILED"]);
const BULK_POLICIES = Object.freeze(["ALL_OR_NOTHING", "ITEMIZED_PARTIAL"]);

const TEACHER_OPERATIONS_COMMAND_TYPES = Object.freeze({
  SAVE_TEACHER_DRAFT: "saveTeacherDraft",
  DISCARD_TEACHER_DRAFT: "discardTeacherDraft",
  RESOLVE_TEACHER_DRAFT: "resolveTeacherDraft",
  CLEANUP_EXPIRED_TEACHER_DRAFTS: "cleanupExpiredTeacherDrafts",
  CREATE_TEACHER_BULK_JOB: "createTeacherBulkJob",
  RECONCILE_TEACHER_BULK_JOB: "reconcileTeacherBulkJob",
  RETRY_TEACHER_BULK_JOB: "retryTeacherBulkJob",
});
const ADMIN_COMMAND_TYPES = new Set([
  TEACHER_OPERATIONS_COMMAND_TYPES.CLEANUP_EXPIRED_TEACHER_DRAFTS,
]);
const HIGH_RISK_COMMAND_TYPES = new Set([
  TEACHER_OPERATIONS_COMMAND_TYPES.CLEANUP_EXPIRED_TEACHER_DRAFTS,
  TEACHER_OPERATIONS_COMMAND_TYPES.CREATE_TEACHER_BULK_JOB,
  TEACHER_OPERATIONS_COMMAND_TYPES.RECONCILE_TEACHER_BULK_JOB,
  TEACHER_OPERATIONS_COMMAND_TYPES.RETRY_TEACHER_BULK_JOB,
]);

const fail = (code, message, reason, details = {}) => {
  throw new HttpsError(code, message, { reason, ...details });
};
const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const canonicalize = (value, path = "payload") => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`)).join(",")}]`;
  if (!isObject(value)) fail("invalid-argument", `${path} must be JSON-compatible.`, "W9_PAYLOAD_INVALID");
  return `{${Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) fail("invalid-argument", `${path}.${key} cannot be undefined.`, "W9_PAYLOAD_INVALID");
    if (["_session", "token", "idtoken", "accesstoken", "refreshtoken", "password", "credential", "secret", "apikey", "authorization", "cookie"].includes(key.toLowerCase())) fail("invalid-argument", `${path}.${key} is forbidden.`, "W9_DRAFT_SECRET_FORBIDDEN");
    return `${JSON.stringify(key)}:${canonicalize(value[key], `${path}.${key}`)}`;
  }).join(",")}}`;
};
const allowed = (value, keys, label) => {
  if (!isObject(value)) fail("invalid-argument", `${label} must be an object.`, "W9_PAYLOAD_INVALID");
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  if (extra.length) fail("invalid-argument", `${label} contains unsupported fields.`, "W9_PAYLOAD_INVALID", { fields: extra });
};
const text = (value, label, max = 180, allowSlash = false) => {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > max || (!allowSlash && value.includes("/"))) fail("invalid-argument", `${label} is invalid.`, "W9_PAYLOAD_INVALID", { field: label });
  return value;
};
const optionalText = (value, label, max = 180, allowSlash = false) => value === undefined || value === null || value === "" ? "" : text(value, label, max, allowSlash);
const integer = (value, label, min = 0) => {
  if (!Number.isSafeInteger(value) || value < min) fail("invalid-argument", `${label} is invalid.`, "W9_PAYLOAD_INVALID", { field: label });
  return value;
};
const nullableRevision = (value, label) => value === null ? null : integer(value, label, 1);
const hash = (value, label) => {
  const normalized = text(value, label, 64);
  if (!/^[0-9a-f]{64}$/.test(normalized)) fail("invalid-argument", `${label} must be a SHA-256 hash.`, "W9_PAYLOAD_INVALID");
  return normalized;
};
const commandId = (value, label) => {
  const normalized = text(value, label, 80);
  if (!COMMAND_ID_PATTERN.test(normalized)) fail("invalid-argument", `${label} is invalid.`, "W9_PAYLOAD_INVALID");
  return normalized.includes("-") ? normalized.toLowerCase() : normalized.toUpperCase();
};
const enumValue = (value, choices, label) => choices.includes(value) ? value : fail("invalid-argument", `${label} is invalid.`, "W9_PAYLOAD_INVALID", { field: label });
const semesterId = (value) => semesterCore.normalizeSemesterId(value);
const uuidFromHash = (value) => {
  const digest = sha256(value).slice(0, 32).split("");
  digest[12] = "4";
  digest[16] = ["8", "9", "a", "b"][Number.parseInt(digest[16], 16) % 4];
  const raw = digest.join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
};
const idFor = (prefix, ...parts) => `${prefix}_${sha256(parts.join("\n"))}`;
const entityKeyHashFor = (key) => sha256(canonicalize({ routeKey: key.routeKey, surfaceKey: key.surfaceKey, entityType: key.entityType, entityId: key.entityId }));
const receiptIdFor = (actorUid, commandType, commandId) => `cmd_${sha256(`${actorUid}\n${commandType}\n${commandId}`)}`;
const isoAfter = (iso, millis) => new Date(Date.parse(iso) + millis).toISOString();
const manifestPath = (scope) => `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${scope}`;

const commonPayload = (payload) => ({
  semesterId: semesterId(payload.semesterId),
  expectedSemesterRevision: integer(payload.expectedSemesterRevision, "expectedSemesterRevision", 1),
});
const normalizeDraftKey = (value) => {
  allowed(value, ["routeKey", "surfaceKey", "entityType", "entityId", "clientDraftId"], "draft key");
  return {
    routeKey: text(value.routeKey, "routeKey", 120, true),
    surfaceKey: text(value.surfaceKey, "surfaceKey", 120),
    entityType: text(value.entityType, "entityType", 80),
    entityId: text(value.entityId, "entityId", 180),
    clientDraftId: text(value.clientDraftId, "clientDraftId", 80),
  };
};
const normalizeStagedAssets = (value) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) fail("invalid-argument", "stagedAssets is invalid.", "W9_PAYLOAD_INVALID");
  return value.map((asset, index) => {
    allowed(asset, ["uploadId", "checksum"], `stagedAssets[${index}]`);
    return { uploadId: text(asset.uploadId, `stagedAssets[${index}].uploadId`, 180), checksum: hash(asset.checksum, `stagedAssets[${index}].checksum`) };
  });
};
const normalizeJsonObject = (value, label, maxBytes) => {
  if (!isObject(value)) fail("invalid-argument", `${label} must be an object.`, "W9_PAYLOAD_INVALID");
  const canonical = canonicalize(value, label);
  if (Buffer.byteLength(canonical, "utf8") > maxBytes) fail("invalid-argument", `${label} is too large.`, "W9_PAYLOAD_TOO_LARGE");
  return { value: JSON.parse(canonical), canonical, payloadHash: sha256(canonical) };
};

const supportedBulkCommandTypes = new Set([
  ...Object.values(assessmentLifecycle.ASSESSMENT_COMMAND_TYPES).filter((type) => !assessmentLifecycle.STUDENT_COMMAND_TYPES.has(type)),
  ...Object.values(gradeEvidence.GRADE_COMMAND_TYPES).filter((type) => !gradeEvidence.STUDENT_COMMAND_TYPES.has(type)),
  ...Object.values(wisEconomy.WIS_COMMAND_TYPES).filter((type) => !wisEconomy.STUDENT_COMMAND_TYPES.has(type)),
  ...Object.values(w8Domains.W8_COMMAND_TYPES).filter((type) => !w8Domains.STUDENT_COMMAND_TYPES.has(type) && !w8Domains.ADMIN_COMMAND_TYPES.has(type)),
]);
const normalizeUnderlyingPayload = (commandType, payload) => {
  if (!supportedBulkCommandTypes.has(commandType)) fail("invalid-argument", "Bulk item commandType is unsupported.", "W9_BULK_COMMAND_UNSUPPORTED", { commandType });
  if (Object.values(assessmentLifecycle.ASSESSMENT_COMMAND_TYPES).includes(commandType)) return assessmentLifecycle.normalizeAssessmentPayload(commandType, payload);
  if (Object.values(gradeEvidence.GRADE_COMMAND_TYPES).includes(commandType)) return gradeEvidence.normalizeGradePayload(commandType, payload);
  if (Object.values(wisEconomy.WIS_COMMAND_TYPES).includes(commandType)) return wisEconomy.normalizeWisPayload(commandType, payload);
  return w8Domains.normalizeW8Payload(commandType, payload);
};
const normalizeBulkItem = (item, index, scope) => {
  allowed(item, ["itemKey", "commandType", "commandPayload", "commandPayloadHash"], `items[${index}]`);
  const itemKey = text(item.itemKey, `items[${index}].itemKey`, 120);
  const commandType = text(item.commandType, `items[${index}].commandType`, 120);
  const commandPayload = normalizeUnderlyingPayload(commandType, item.commandPayload);
  if (commandPayload.semesterId !== scope) fail("invalid-argument", "Bulk item semester does not match the job.", "W9_BULK_SEMESTER_MISMATCH", { itemKey });
  const commandPayloadHash = sha256(canonicalize(commandPayload));
  if (hash(item.commandPayloadHash, `items[${index}].commandPayloadHash`) !== commandPayloadHash) fail("invalid-argument", "Bulk item payload hash does not match.", "W9_BULK_PAYLOAD_HASH_MISMATCH", { itemKey });
  return { itemKey, commandType, commandPayload, commandPayloadHash };
};

const normalizeTeacherOperationsPayload = (commandType, raw) => {
  const payload = raw || {};
  const common = ["semesterId", "expectedSemesterRevision"];
  if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.SAVE_TEACHER_DRAFT) {
    allowed(payload, [...common, "key", "expectedDraftRevision", "baseEntityRevision", "basePayloadHash", "payloadSchemaVersion", "intendedCommandType", "expectedCommandPayloadHash", "payload", "stagedAssets"], "saveTeacherDraft payload");
    const draftPayload = normalizeJsonObject(payload.payload, "payload", 150_000);
    const basePayloadHash = payload.basePayloadHash === null ? null : hash(payload.basePayloadHash, "basePayloadHash");
    if (basePayloadHash && basePayloadHash === draftPayload.payloadHash) fail("failed-precondition", "Only dirty input can be saved as a draft.", "W9_DRAFT_NOT_DIRTY");
    return { ...commonPayload(payload), key: normalizeDraftKey(payload.key), expectedDraftRevision: nullableRevision(payload.expectedDraftRevision, "expectedDraftRevision"), baseEntityRevision: nullableRevision(payload.baseEntityRevision, "baseEntityRevision"), basePayloadHash, payloadSchemaVersion: integer(payload.payloadSchemaVersion, "payloadSchemaVersion", 1), intendedCommandType: text(payload.intendedCommandType, "intendedCommandType", 120), expectedCommandPayloadHash: hash(payload.expectedCommandPayloadHash, "expectedCommandPayloadHash"), payload: draftPayload.value, payloadHash: draftPayload.payloadHash, stagedAssets: normalizeStagedAssets(payload.stagedAssets) };
  }
  if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.DISCARD_TEACHER_DRAFT) {
    allowed(payload, [...common, "draftId", "expectedDraftRevision", "reason"], "discardTeacherDraft payload");
    return { ...commonPayload(payload), draftId: text(payload.draftId, "draftId", 80), expectedDraftRevision: integer(payload.expectedDraftRevision, "expectedDraftRevision", 1), reason: text(payload.reason, "reason", 500, true) };
  }
  if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.RESOLVE_TEACHER_DRAFT) {
    allowed(payload, [...common, "draftId", "expectedDraftRevision", "canonicalCommandType", "canonicalCommandId", "expectedCommandPayloadHash"], "resolveTeacherDraft payload");
    return { ...commonPayload(payload), draftId: text(payload.draftId, "draftId", 80), expectedDraftRevision: integer(payload.expectedDraftRevision, "expectedDraftRevision", 1), canonicalCommandType: text(payload.canonicalCommandType, "canonicalCommandType", 120), canonicalCommandId: commandId(payload.canonicalCommandId, "canonicalCommandId"), expectedCommandPayloadHash: hash(payload.expectedCommandPayloadHash, "expectedCommandPayloadHash") };
  }
  if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.CLEANUP_EXPIRED_TEACHER_DRAFTS) {
    allowed(payload, [...common, "limit"], "cleanupExpiredTeacherDrafts payload");
    return { ...commonPayload(payload), limit: integer(payload.limit, "limit", 1) > 100 ? fail("invalid-argument", "limit exceeds 100.", "W9_PAYLOAD_INVALID") : payload.limit };
  }
  if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.CREATE_TEACHER_BULK_JOB) {
    allowed(payload, [...common, "clientBulkId", "domain", "operationType", "policy", "filter", "items"], "createTeacherBulkJob payload");
    const base = commonPayload(payload); const policy = enumValue(payload.policy, BULK_POLICIES, "policy");
    if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > BULK_ITEM_LIMIT) fail("invalid-argument", "Bulk items must contain 1 to 100 entries.", "W9_BULK_ITEM_LIMIT");
    if (policy === "ALL_OR_NOTHING" && payload.items.length !== 1) fail("invalid-argument", "ALL_OR_NOTHING requires one underlying atomic command.", "W9_BULK_ATOMIC_POLICY_INVALID");
    const items = payload.items.map((item, index) => normalizeBulkItem(item, index, base.semesterId));
    if (new Set(items.map((item) => item.itemKey)).size !== items.length) fail("invalid-argument", "Bulk item keys must be unique.", "W9_BULK_DUPLICATE_ITEM");
    if (Buffer.byteLength(canonicalize(items), "utf8") > BULK_JOB_CANONICAL_BYTE_LIMIT) fail("invalid-argument", "Bulk job exceeds the safe document size budget.", "W9_BULK_PAYLOAD_TOO_LARGE", { maximumBytes: BULK_JOB_CANONICAL_BYTE_LIMIT });
    const filter = normalizeJsonObject(payload.filter, "filter", 40_000);
    return { ...base, clientBulkId: text(payload.clientBulkId, "clientBulkId", 80), domain: enumValue(payload.domain, ["ASSESSMENT", "GRADE", "WIS", "LEARNING", "SCHEDULE", "ATTENDANCE", "COMMUNICATION"], "domain"), operationType: text(payload.operationType, "operationType", 120), policy, filter: filter.value, filterHash: filter.payloadHash, items };
  }
  if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.RECONCILE_TEACHER_BULK_JOB) {
    allowed(payload, [...common, "jobId", "expectedJobRevision", "reportedFailures"], "reconcileTeacherBulkJob payload");
    const failures = Array.isArray(payload.reportedFailures) ? payload.reportedFailures : fail("invalid-argument", "reportedFailures must be an array.", "W9_PAYLOAD_INVALID");
    if (failures.length > BULK_ITEM_LIMIT) fail("invalid-argument", "reportedFailures exceeds 100.", "W9_PAYLOAD_INVALID");
    const reportedFailures = failures.map((failure, index) => { allowed(failure, ["itemKey", "childCommandId", "errorCode", "errorReason"], `reportedFailures[${index}]`); return { itemKey: text(failure.itemKey, `reportedFailures[${index}].itemKey`, 120), childCommandId: text(failure.childCommandId, `reportedFailures[${index}].childCommandId`, 80), errorCode: text(failure.errorCode, `reportedFailures[${index}].errorCode`, 80), errorReason: optionalText(failure.errorReason, `reportedFailures[${index}].errorReason`, 500, true) }; });
    if (new Set(reportedFailures.map((failure) => failure.itemKey)).size !== reportedFailures.length) fail("invalid-argument", "reportedFailures contains duplicate item keys.", "W9_BULK_DUPLICATE_ITEM");
    return { ...commonPayload(payload), jobId: text(payload.jobId, "jobId", 80), expectedJobRevision: integer(payload.expectedJobRevision, "expectedJobRevision", 1), reportedFailures };
  }
  if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.RETRY_TEACHER_BULK_JOB) {
    allowed(payload, [...common, "jobId", "expectedJobRevision", "items"], "retryTeacherBulkJob payload");
    if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > BULK_ITEM_LIMIT) fail("invalid-argument", "Retry items are invalid.", "W9_PAYLOAD_INVALID");
    const base = commonPayload(payload);
    const items = payload.items.map((item, index) => normalizeBulkItem(item, index, base.semesterId));
    if (Buffer.byteLength(canonicalize(items), "utf8") > BULK_JOB_CANONICAL_BYTE_LIMIT) fail("invalid-argument", "Retry items exceed the safe document size budget.", "W9_BULK_PAYLOAD_TOO_LARGE", { maximumBytes: BULK_JOB_CANONICAL_BYTE_LIMIT });
    return { ...base, jobId: text(payload.jobId, "jobId", 80), expectedJobRevision: integer(payload.expectedJobRevision, "expectedJobRevision", 1), items };
  }
  fail("invalid-argument", "Unsupported Teacher Operations command.", "COMMAND_TYPE_UNSUPPORTED", { commandType });
};

const assertManifest = async (transaction, payload) => {
  const manifest = await transaction.get(manifestPath(payload.semesterId));
  if (!manifest.exists) fail("not-found", "Semester Manifest does not exist.", "SEMESTER_NOT_FOUND");
  if (Number(manifest.data?.revision || 0) !== payload.expectedSemesterRevision) fail("aborted", "Semester revision changed.", "SEMESTER_REVISION_CONFLICT");
  if (manifest.data?.status !== "ACTIVE") fail("failed-precondition", "Teacher Operations writes require ACTIVE semester.", ["CLOSED", "ARCHIVED"].includes(manifest.data?.status) ? "SEMESTER_ARCHIVED_WRITE_FORBIDDEN" : "SEMESTER_WRITE_STATE_INVALID");
  return manifest.data;
};
const assertTeacherActor = (actor) => {
  if (!actor?.actorUid || !["teacher", "admin"].includes(actor.actorRole)) fail("permission-denied", "Teacher Operations authority is required.", "W9_MANAGE_REQUIRED");
};
const draftStatusMutable = (status) => ["ACTIVE", "CONFLICT"].includes(status);
const jobStatusFromItems = (items) => {
  const succeeded = items.filter((item) => item.status === "SUCCEEDED").length;
  const failed = items.filter((item) => item.status === "FAILED").length;
  const pending = items.length - succeeded - failed;
  if (succeeded === items.length) return "SUCCEEDED";
  if (failed === items.length) return "FAILED";
  if (failed > 0) return "PARTIAL";
  if (pending > 0) return "RUNNING";
  return "READY";
};

const createTeacherOperationsCommandAdapter = ({ now = () => new Date().toISOString() } = {}) => ({
  apply: async ({ transaction, commandId, commandType, payload, receiptId, timestamp, actor }) => {
    assertTeacherActor(actor);
    if (ADMIN_COMMAND_TYPES.has(commandType) && actor.actorRole !== "admin") fail("permission-denied", "Administrator authority is required.", "W9_ADMIN_REQUIRED");
    const cleanupCommand = commandType === TEACHER_OPERATIONS_COMMAND_TYPES.CLEANUP_EXPIRED_TEACHER_DRAFTS;
    if (cleanupCommand) {
      const manifest = await transaction.get(manifestPath(payload.semesterId));
      if (!manifest.exists) fail("not-found", "Semester Manifest does not exist.", "SEMESTER_NOT_FOUND");
      if (Number(manifest.data?.revision || 0) !== payload.expectedSemesterRevision) fail("aborted", "Semester revision changed.", "SEMESTER_REVISION_CONFLICT");
    } else {
      await assertManifest(transaction, payload);
    }
    const currentIso = now();
    if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.SAVE_TEACHER_DRAFT) {
      const draftId = idFor("draft", actor.actorUid, payload.semesterId, canonicalize(payload.key)); const draftPath = `${TEACHER_DRAFT_COLLECTION}/${draftId}`; const current = await transaction.get(draftPath); const currentRevision = Number(current.data?.draftRevision || 0);
      if ((current.exists && current.data?.ownerUid !== actor.actorUid) || (current.exists && current.data?.semesterId !== payload.semesterId)) fail("permission-denied", "Draft owner or scope does not match.", "W9_DRAFT_OWNER_FORBIDDEN");
      if ((current.exists && currentRevision !== payload.expectedDraftRevision) || (!current.exists && payload.expectedDraftRevision !== null)) fail("aborted", "Draft revision changed.", "W9_DRAFT_REVISION_CONFLICT", { currentDraftRevision: currentRevision });
      if (current.exists && !draftStatusMutable(current.data?.status)) fail("failed-precondition", "Terminal Draft cannot be changed.", "W9_DRAFT_STATE_INVALID");
      if (current.exists && current.data?.status === "CONFLICT") fail("failed-precondition", "Conflicted Draft requires an explicit rebase or discard.", "W9_DRAFT_REBASE_REQUIRED", { currentDraftRevision: currentRevision, conflictReason: current.data?.conflictReason || "UNKNOWN" });
      if (current.exists && current.data?.baseEntityRevision !== payload.baseEntityRevision) {
        const next = currentRevision + 1; transaction.set(draftPath, { status: "CONFLICT", draftRevision: next, conflictReason: "BASE_ENTITY_REVISION_CHANGED", attemptedBaseEntityRevision: payload.baseEntityRevision, updatedAt: timestamp, updatedAtIso: currentIso, expiresAt: isoAfter(currentIso, DRAFT_TTL_MS) }, { merge: true });
        return { target: { kind: "teacher-draft-conflict", id: draftId, refs: [draftPath] }, sourceHash: payload.payloadHash, result: { draftId, draftRevision: next, status: "CONFLICT", saved: false, conflictReason: "BASE_ENTITY_REVISION_CHANGED", expiresAt: isoAfter(currentIso, DRAFT_TTL_MS) } };
      }
      const next = currentRevision + 1; const expiresAt = isoAfter(currentIso, DRAFT_TTL_MS); transaction.set(draftPath, { schemaVersion: TEACHER_OPERATIONS_SCHEMA_VERSION, policyVersion: TEACHER_OPERATIONS_POLICY_VERSION, draftId, ownerUid: actor.actorUid, semesterId: payload.semesterId, key: payload.key, entityKeyHash: entityKeyHashFor(payload.key), baseEntityRevision: payload.baseEntityRevision, basePayloadHash: payload.basePayloadHash, payloadSchemaVersion: payload.payloadSchemaVersion, intendedCommandType: payload.intendedCommandType, expectedCommandPayloadHash: payload.expectedCommandPayloadHash, payload: payload.payload, payloadHash: payload.payloadHash, stagedAssets: payload.stagedAssets, draftRevision: next, status: "ACTIVE", conflictReason: null, createdAt: current.data?.createdAt || timestamp, createdAtIso: current.data?.createdAtIso || currentIso, updatedAt: timestamp, updatedAtIso: currentIso, expiresAt }, { merge: true });
      return { target: { kind: "teacher-draft", id: draftId, refs: [draftPath] }, sourceHash: payload.payloadHash, result: { draftId, draftRevision: next, status: "ACTIVE", saved: true, payloadHash: payload.payloadHash, expiresAt } };
    }
    if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.DISCARD_TEACHER_DRAFT) {
      const draftPath = `${TEACHER_DRAFT_COLLECTION}/${payload.draftId}`; const draft = await transaction.get(draftPath); if (!draft.exists) fail("not-found", "Draft was not found.", "W9_DRAFT_NOT_FOUND"); if (draft.data?.ownerUid !== actor.actorUid || draft.data?.semesterId !== payload.semesterId) fail("permission-denied", "Draft owner or scope does not match.", "W9_DRAFT_OWNER_FORBIDDEN"); if (Number(draft.data?.draftRevision || 0) !== payload.expectedDraftRevision) fail("aborted", "Draft revision changed.", "W9_DRAFT_REVISION_CONFLICT"); if (!draftStatusMutable(draft.data?.status)) fail("failed-precondition", "Draft is terminal.", "W9_DRAFT_STATE_INVALID"); const next = payload.expectedDraftRevision + 1; transaction.set(draftPath, { draftRevision: next, status: "DISCARDED", payload: {}, stagedAssets: [], payloadPurgedAt: timestamp, discardReason: payload.reason, discardedAt: timestamp, updatedAt: timestamp, updatedAtIso: currentIso }, { merge: true }); return { target: { kind: "teacher-draft-discard", id: payload.draftId, refs: [draftPath] }, sourceHash: sha256(payload.reason), result: { draftId: payload.draftId, draftRevision: next, status: "DISCARDED", payloadPurged: true } };
    }
    if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.RESOLVE_TEACHER_DRAFT) {
      const draftPath = `${TEACHER_DRAFT_COLLECTION}/${payload.draftId}`; const canonicalReceiptId = receiptIdFor(actor.actorUid, payload.canonicalCommandType, payload.canonicalCommandId); const [draft, receipt] = await transaction.getAll([draftPath, `${RECEIPT_COLLECTION}/${canonicalReceiptId}`]); if (!draft.exists) fail("not-found", "Draft was not found.", "W9_DRAFT_NOT_FOUND"); if (draft.data?.ownerUid !== actor.actorUid || draft.data?.semesterId !== payload.semesterId) fail("permission-denied", "Draft owner or scope does not match.", "W9_DRAFT_OWNER_FORBIDDEN"); if (Number(draft.data?.draftRevision || 0) !== payload.expectedDraftRevision) fail("aborted", "Draft revision changed.", "W9_DRAFT_REVISION_CONFLICT"); if (!draftStatusMutable(draft.data?.status)) fail("failed-precondition", "Draft is terminal.", "W9_DRAFT_STATE_INVALID"); if (!receipt.exists || receipt.data?.status !== "SUCCEEDED" || receipt.data?.actorUid !== actor.actorUid || receipt.data?.commandType !== payload.canonicalCommandType || receipt.data?.commandId !== payload.canonicalCommandId) fail("failed-precondition", "Successful canonical command receipt is required.", "W9_CANONICAL_RECEIPT_REQUIRED"); if (receipt.data?.payloadHash !== payload.expectedCommandPayloadHash || draft.data?.expectedCommandPayloadHash !== payload.expectedCommandPayloadHash || draft.data?.intendedCommandType !== payload.canonicalCommandType) fail("failed-precondition", "Canonical command receipt does not match the Draft.", "W9_CANONICAL_RECEIPT_MISMATCH"); const entityKeyHash = draft.data?.entityKeyHash || entityKeyHashFor(draft.data?.key || {}); const activeEntityDrafts = await transaction.query(TEACHER_DRAFT_COLLECTION, { filters: [{ field: "ownerUid", operator: "==", value: actor.actorUid }, { field: "semesterId", operator: "==", value: payload.semesterId }, { field: "entityKeyHash", operator: "==", value: entityKeyHash }, { field: "status", operator: "==", value: "ACTIVE" }], limit: ENTITY_ACTIVE_DRAFT_LIMIT + 1 }); if (activeEntityDrafts.length > ENTITY_ACTIVE_DRAFT_LIMIT) fail("resource-exhausted", "Too many concurrent Drafts exist for the same entity.", "W9_DRAFT_ENTITY_CONCURRENCY_LIMIT", { maximum: ENTITY_ACTIVE_DRAFT_LIMIT }); const siblingDrafts = activeEntityDrafts.filter((row) => row.path !== draftPath && row.data?.key?.routeKey === draft.data?.key?.routeKey && row.data?.key?.surfaceKey === draft.data?.key?.surfaceKey && row.data?.key?.entityType === draft.data?.key?.entityType && row.data?.key?.entityId === draft.data?.key?.entityId); const next = payload.expectedDraftRevision + 1; transaction.set(draftPath, { draftRevision: next, status: "SAVED", payload: {}, stagedAssets: [], payloadPurgedAt: timestamp, resolvedCommandType: payload.canonicalCommandType, resolvedCommandId: payload.canonicalCommandId, resolvedReceiptId: canonicalReceiptId, resolvedAt: timestamp, updatedAt: timestamp, updatedAtIso: currentIso }, { merge: true }); siblingDrafts.forEach((row) => transaction.set(row.path, { draftRevision: Number(row.data?.draftRevision || 0) + 1, status: "CONFLICT", conflictReason: "BASE_ENTITY_REVISION_CHANGED", conflictingResolvedDraftId: payload.draftId, conflictingCanonicalReceiptId: canonicalReceiptId, conflictDetectedAt: timestamp, updatedAt: timestamp, updatedAtIso: currentIso }, { merge: true })); return { target: { kind: "teacher-draft-resolve", id: payload.draftId, refs: [draftPath, ...siblingDrafts.map((row) => row.path)] }, sourceHash: receipt.data?.sourceHash || payload.expectedCommandPayloadHash, result: { draftId: payload.draftId, draftRevision: next, status: "SAVED", canonicalReceiptId, payloadPurged: true, conflictedDraftCount: siblingDrafts.length, conflictedDraftIds: siblingDrafts.map((row) => row.data?.draftId) } };
    }
    if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.CLEANUP_EXPIRED_TEACHER_DRAFTS) {
      const drafts = await transaction.query(TEACHER_DRAFT_COLLECTION, { field: "semesterId", operator: "==", value: payload.semesterId }); const expired = drafts.filter((row) => draftStatusMutable(row.data?.status) && row.data?.expiresAt && row.data.expiresAt <= currentIso).slice(0, payload.limit); expired.forEach((row) => transaction.set(row.path, { draftRevision: Number(row.data?.draftRevision || 0) + 1, status: "EXPIRED", payload: {}, stagedAssets: [], payloadPurgedAt: timestamp, expiredAt: timestamp, updatedAt: timestamp, updatedAtIso: currentIso }, { merge: true })); return { target: { kind: "teacher-draft-cleanup", id: payload.semesterId, refs: expired.map((row) => row.path) }, sourceHash: sha256(expired.map((row) => row.path).join("\n")), result: { expiredCount: expired.length, draftIds: expired.map((row) => row.data?.draftId), cutoff: currentIso, canonicalMutationCount: 0, payloadPurgedCount: expired.length } };
    }
    if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.CREATE_TEACHER_BULK_JOB) {
      const jobId = idFor("bulk", actor.actorUid, payload.semesterId, payload.clientBulkId); const jobPath = `${TEACHER_BULK_JOB_COLLECTION}/${jobId}`; const current = await transaction.get(jobPath); if (current.exists) fail("already-exists", "Bulk job already exists.", "W9_BULK_JOB_EXISTS"); const previewHash = sha256(canonicalize(payload.items.map(({ itemKey, commandType: type, commandPayloadHash }) => ({ itemKey, commandType: type, commandPayloadHash })))); const items = payload.items.map((item) => ({ ...item, attempt: 1, childCommandId: uuidFromHash(`${jobId}\n${item.itemKey}\n1`), status: "PENDING", receiptId: null, errorCode: null, errorReason: null })); transaction.create(jobPath, { schemaVersion: TEACHER_OPERATIONS_SCHEMA_VERSION, policyVersion: TEACHER_OPERATIONS_POLICY_VERSION, jobId, clientBulkId: payload.clientBulkId, ownerUid: actor.actorUid, semesterId: payload.semesterId, domain: payload.domain, operationType: payload.operationType, policy: payload.policy, filter: payload.filter, filterHash: payload.filterHash, previewHash, jobRevision: 1, status: "READY", riskLevel: "HIGH", items, createdAt: timestamp, createdAtIso: currentIso, updatedAt: timestamp, updatedAtIso: currentIso }); return { target: { kind: "teacher-bulk-job", id: jobId, refs: [jobPath] }, sourceHash: previewHash, result: { jobId, jobRevision: 1, status: "READY", policy: payload.policy, filterHash: payload.filterHash, previewHash, itemCount: items.length, items: items.map(({ itemKey, commandType: type, commandPayload, commandPayloadHash, attempt, childCommandId, status }) => ({ itemKey, commandType: type, commandPayload, commandPayloadHash, attempt, childCommandId, status })) } };
    }
    if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.RECONCILE_TEACHER_BULK_JOB) {
      const jobPath = `${TEACHER_BULK_JOB_COLLECTION}/${payload.jobId}`; const job = await transaction.get(jobPath); if (!job.exists) fail("not-found", "Bulk job was not found.", "W9_BULK_JOB_NOT_FOUND"); if (job.data?.ownerUid !== actor.actorUid || job.data?.semesterId !== payload.semesterId) fail("permission-denied", "Bulk job owner or scope does not match.", "W9_BULK_OWNER_FORBIDDEN"); if (Number(job.data?.jobRevision || 0) !== payload.expectedJobRevision) fail("aborted", "Bulk job revision changed.", "W9_BULK_REVISION_CONFLICT"); if (["SUCCEEDED"].includes(job.data?.status)) fail("failed-precondition", "Bulk job is terminal.", "W9_BULK_STATE_INVALID"); const failureMap = new Map(payload.reportedFailures.map((failure) => [failure.itemKey, failure])); const items = Array.isArray(job.data?.items) ? job.data.items : []; for (const failure of payload.reportedFailures) { const item = items.find((candidate) => candidate.itemKey === failure.itemKey); if (!item || item.status !== "PENDING" || item.childCommandId !== failure.childCommandId) fail("invalid-argument", "Reported failure does not match a pending item.", "W9_BULK_FAILURE_MISMATCH", { itemKey: failure.itemKey }); } const receiptPaths = items.map((item) => `${RECEIPT_COLLECTION}/${receiptIdFor(actor.actorUid, item.commandType, item.childCommandId)}`); const receipts = await transaction.getAll(receiptPaths); const nextItems = items.map((item, index) => { if (item.status === "SUCCEEDED") return item; const receipt = receipts[index]; if (receipt.exists) { if (receipt.data?.status !== "SUCCEEDED" || receipt.data?.actorUid !== actor.actorUid || receipt.data?.commandType !== item.commandType || receipt.data?.commandId !== item.childCommandId || receipt.data?.payloadHash !== item.commandPayloadHash) fail("failed-precondition", "Bulk item receipt does not match.", "W9_BULK_RECEIPT_MISMATCH", { itemKey: item.itemKey }); return { ...item, status: "SUCCEEDED", receiptId: receiptIdFor(actor.actorUid, item.commandType, item.childCommandId), result: receipt.data?.result || null, errorCode: null, errorReason: null }; } const failure = failureMap.get(item.itemKey); return failure ? { ...item, status: "FAILED", errorCode: failure.errorCode, errorReason: failure.errorReason || null } : item; }); const status = jobStatusFromItems(nextItems); const next = payload.expectedJobRevision + 1; transaction.set(jobPath, { jobRevision: next, status, items: nextItems, updatedAt: timestamp, updatedAtIso: currentIso, completedAt: ["SUCCEEDED", "FAILED"].includes(status) ? timestamp : null }, { merge: true }); return { target: { kind: "teacher-bulk-reconcile", id: payload.jobId, refs: [jobPath, ...receipts.filter((row) => row.exists).map((row) => row.path)] }, sourceHash: sha256(canonicalize(nextItems.map(({ itemKey, status: itemStatus, attempt }) => ({ itemKey, status: itemStatus, attempt })))), result: { jobId: payload.jobId, jobRevision: next, status, counts: { total: nextItems.length, succeeded: nextItems.filter((item) => item.status === "SUCCEEDED").length, failed: nextItems.filter((item) => item.status === "FAILED").length, pending: nextItems.filter((item) => item.status === "PENDING").length }, items: nextItems.map(({ itemKey, status: itemStatus, attempt, childCommandId, receiptId: itemReceiptId, errorCode, errorReason }) => ({ itemKey, status: itemStatus, attempt, childCommandId, receiptId: itemReceiptId, errorCode, errorReason })) } };
    }
    if (commandType === TEACHER_OPERATIONS_COMMAND_TYPES.RETRY_TEACHER_BULK_JOB) {
      const jobPath = `${TEACHER_BULK_JOB_COLLECTION}/${payload.jobId}`; const job = await transaction.get(jobPath); if (!job.exists) fail("not-found", "Bulk job was not found.", "W9_BULK_JOB_NOT_FOUND"); if (job.data?.ownerUid !== actor.actorUid || job.data?.semesterId !== payload.semesterId) fail("permission-denied", "Bulk job owner or scope does not match.", "W9_BULK_OWNER_FORBIDDEN"); if (Number(job.data?.jobRevision || 0) !== payload.expectedJobRevision) fail("aborted", "Bulk job revision changed.", "W9_BULK_REVISION_CONFLICT"); const replacements = new Map(payload.items.map((item) => [item.itemKey, item])); if (replacements.size !== payload.items.length) fail("invalid-argument", "Retry item keys must be unique.", "W9_BULK_DUPLICATE_ITEM"); const currentItems = Array.isArray(job.data?.items) ? job.data.items : []; for (const item of payload.items) { const current = currentItems.find((candidate) => candidate.itemKey === item.itemKey); if (!current || current.status !== "FAILED" || current.commandType !== item.commandType) fail("failed-precondition", "Only failed items can be retried.", "W9_BULK_RETRY_NOT_FAILED", { itemKey: item.itemKey }); } const nextItems = currentItems.map((item) => { const replacement = replacements.get(item.itemKey); if (!replacement) return item; const attempt = Number(item.attempt || 1) + 1; return { ...item, commandPayload: replacement.commandPayload, commandPayloadHash: replacement.commandPayloadHash, attempt, childCommandId: uuidFromHash(`${payload.jobId}\n${item.itemKey}\n${attempt}`), status: "PENDING", receiptId: null, result: null, errorCode: null, errorReason: null }; }); const next = payload.expectedJobRevision + 1; transaction.set(jobPath, { jobRevision: next, status: "READY", items: nextItems, retryCount: Number(job.data?.retryCount || 0) + 1, updatedAt: timestamp, updatedAtIso: currentIso, completedAt: null }, { merge: true }); return { target: { kind: "teacher-bulk-retry", id: payload.jobId, refs: [jobPath] }, sourceHash: sha256(canonicalize(payload.items)), result: { jobId: payload.jobId, jobRevision: next, status: "READY", retriedCount: payload.items.length, items: nextItems.filter((item) => replacements.has(item.itemKey)).map(({ itemKey, commandType: type, commandPayload, commandPayloadHash, attempt, childCommandId, status }) => ({ itemKey, commandType: type, commandPayload, commandPayloadHash, attempt, childCommandId, status })) } };
    }
    fail("invalid-argument", "Unsupported Teacher Operations command.", "COMMAND_TYPE_UNSUPPORTED");
  },
});

const normalizeQuery = (raw) => {
  const payload = raw || {}; allowed(payload, ["semesterId", "source", "provenance", "draftId", "jobId", "includeTerminal", "limit", "_session"], "getTeacherOperationsState payload"); const source = payload.provenance || payload.source; if (typeof payload.includeTerminal !== "undefined" && typeof payload.includeTerminal !== "boolean") fail("invalid-argument", "includeTerminal must be boolean.", "W9_PAYLOAD_INVALID"); const limit = payload.limit === undefined ? 50 : integer(payload.limit, "limit", 1); if (limit > 100) fail("invalid-argument", "limit exceeds 100.", "W9_PAYLOAD_INVALID"); return { semesterId: semesterId(payload.semesterId), source: enumValue(source, ["CURRENT", "ARCHIVE", "LEGACY", "EXPLICIT"], "source"), draftId: optionalText(payload.draftId, "draftId", 80), jobId: optionalText(payload.jobId, "jobId", 80), includeTerminal: payload.includeTerminal === true, limit };
};
const createTeacherOperationsQueryCore = ({ store, assertSession = sessionAuthority.assertActiveApplicationSession, now = () => new Date().toISOString() } = {}) => {
  if (!store) throw new TypeError("store is required.");
  return { getTeacherOperationsState: async (request) => {
    const identity = await assertSession(request, { recentAuth: false, highRisk: false }); const uid = String(identity?.uid || request.auth?.uid || "").trim(); if (!uid || uid !== String(request.auth?.uid || "").trim()) fail("permission-denied", "Authenticated actor mismatch.", "COMMAND_ACTOR_MISMATCH"); const query = normalizeQuery(request.data || {}); const profile = await store.get(`users/${uid}`); const isAdmin = String(identity?.email || request.auth?.token?.email || "").toLowerCase() === ADMIN_EMAIL; const permissions = Array.isArray(profile.data?.staffPermissions) ? profile.data.staffPermissions : []; const isTeacher = isAdmin || (profile.data?.role === "teacher" && profile.data?.teacherPortalEnabled === true && permissions.some((permission) => ["lesson_read", "quiz_read", "point_manage"].includes(permission))); if (!isTeacher) fail("permission-denied", "Teacher Operations access is required.", "W9_MANAGE_REQUIRED"); const base = { semesterId: query.semesterId, manifestRevision: 0, provenance: query.source === "LEGACY" ? "LEGACY" : "PREPARING", source: query.source, readOnly: true, status: query.source === "LEGACY" ? "LEGACY" : "EMPTY", drafts: [], bulkJobs: [], warnings: [], reason: query.source === "LEGACY" ? "LEGACY_SOURCE_REQUIRES_EXPLICIT_READ_ONLY_ADAPTER" : "SEMESTER_NOT_FOUND", writeCount: 0 }; if (query.source === "LEGACY") return base;
    return store.runTransaction(async (transaction) => { const manifest = await transaction.get(manifestPath(query.semesterId)); if (!manifest.exists) return base; const lifecycle = ["CLOSED", "ARCHIVED"].includes(manifest.data?.status) ? "ARCHIVE" : manifest.data?.status === "ACTIVE" ? "CURRENT" : "PREPARING"; if (query.source === "CURRENT" && lifecycle !== "CURRENT") fail("failed-precondition", "CURRENT source does not match Semester lifecycle.", "W9_SOURCE_MISMATCH"); if (query.source === "ARCHIVE" && lifecycle !== "ARCHIVE") fail("failed-precondition", "ARCHIVE source does not match Semester lifecycle.", "W9_SOURCE_MISMATCH"); const provenance = query.source === "EXPLICIT" ? "EXPLICIT" : lifecycle; const readOnly = query.source === "EXPLICIT" || lifecycle !== "CURRENT"; const boundedSpec = (statuses, extraFilter = null) => ({ filters: [{ field: "ownerUid", operator: "==", value: uid }, { field: "semesterId", operator: "==", value: query.semesterId }, ...(extraFilter ? [extraFilter] : []), ...(statuses ? [{ field: "status", operator: "in", value: statuses }] : [])], ...(statuses ? { orderBy: { field: "updatedAtIso", direction: "desc" } } : {}), limit: statuses ? query.limit + 1 : 1 }); let draftRows; let jobRows; if (query.draftId) { draftRows = await transaction.query(TEACHER_DRAFT_COLLECTION, boundedSpec(null, { field: "draftId", operator: "==", value: query.draftId })); } else { const activeDraftRows = await transaction.query(TEACHER_DRAFT_COLLECTION, boundedSpec(["ACTIVE", "CONFLICT"])); const terminalDraftRows = query.includeTerminal ? await transaction.query(TEACHER_DRAFT_COLLECTION, boundedSpec(["SAVED", "DISCARDED", "EXPIRED"])) : []; draftRows = [...activeDraftRows, ...terminalDraftRows]; } if (query.jobId) { jobRows = await transaction.query(TEACHER_BULK_JOB_COLLECTION, boundedSpec(null, { field: "jobId", operator: "==", value: query.jobId })); } else { const activeJobRows = await transaction.query(TEACHER_BULK_JOB_COLLECTION, boundedSpec(["READY", "RUNNING", "PARTIAL", "FAILED"])); const terminalJobRows = query.includeTerminal ? await transaction.query(TEACHER_BULK_JOB_COLLECTION, boundedSpec(["SUCCEEDED"])) : []; jobRows = [...activeJobRows, ...terminalJobRows]; } const sortRecent = (left, right) => String(right.data?.updatedAtIso || right.data?.createdAtIso || "").localeCompare(String(left.data?.updatedAtIso || left.data?.createdAtIso || "")) || left.path.localeCompare(right.path); draftRows.sort(sortRecent); jobRows.sort(sortRecent); const draftTruncated = draftRows.length > query.limit; const jobTruncated = jobRows.length > query.limit; draftRows = draftRows.slice(0, query.limit); jobRows = jobRows.slice(0, query.limit); const currentIso = now(); const expose = (row) => ({ ...row.data, provenance, readOnly: readOnly || !["ACTIVE", "CONFLICT", "READY", "RUNNING", "PARTIAL", "FAILED"].includes(row.data?.status) }); const drafts = draftRows.map(expose); const bulkJobs = jobRows.map(expose); const warnings = [...(draftTruncated || jobTruncated ? [{ code: query.includeTerminal ? "TERMINAL_RESULTS_TRUNCATED" : "RESULTS_TRUNCATED", limit: query.limit, draftTruncated, jobTruncated }] : []), ...drafts.filter((draft) => draft.status === "CONFLICT").map((draft) => ({ code: "DRAFT_CONFLICT", draftId: draft.draftId })), ...drafts.filter((draft) => draft.expiresAt && draft.expiresAt <= currentIso && draftStatusMutable(draft.status)).map((draft) => ({ code: "DRAFT_EXPIRED_PENDING_CLEANUP", draftId: draft.draftId })), ...bulkJobs.filter((job) => job.status === "RUNNING" && job.updatedAtIso && Date.parse(currentIso) - Date.parse(job.updatedAtIso) > ORPHAN_RUNNING_MS).map((job) => ({ code: "BULK_RUNNING_ORPHAN", jobId: job.jobId }))]; return { ...base, manifestRevision: Number(manifest.data?.revision || 0), provenance, source: query.source, readOnly, status: readOnly && provenance === "ARCHIVE" ? "ARCHIVED" : drafts.length + bulkJobs.length ? "CONTENT" : "EMPTY", drafts, bulkJobs, warnings, reason: "", writeCount: 0 }; });
  } };
};
const createTeacherOperationsCallableExports = ({ core }) => ({ getTeacherOperationsState: onCall({ region: REGION }, (request) => core.getTeacherOperationsState(request)) });

const createTeacherOperationsReadinessAdapter = ({ now = () => new Date().toISOString() } = {}) => ({ evaluate: async ({ transaction, manifest }) => { const scope = String(manifest?.semesterId || ""); const jobs = await transaction.query(TEACHER_BULK_JOB_COLLECTION, { field: "semesterId", operator: "==", value: scope }); const drafts = await transaction.query(TEACHER_DRAFT_COLLECTION, { field: "semesterId", operator: "==", value: scope }); const currentMs = Date.parse(now()); const orphanRunning = jobs.filter((row) => row.data?.status === "RUNNING" && row.data?.updatedAtIso && currentMs - Date.parse(row.data.updatedAtIso) > ORPHAN_RUNNING_MS); const highRiskUnresolved = jobs.filter((row) => row.data?.riskLevel === "HIGH" && ["FAILED", "PARTIAL"].includes(row.data?.status)); const invalidHighRiskJobs = jobs.filter((row) => row.data?.riskLevel === "HIGH" && (row.data?.schemaVersion !== TEACHER_OPERATIONS_SCHEMA_VERSION || row.data?.policyVersion !== TEACHER_OPERATIONS_POLICY_VERSION || !BULK_JOB_STATUSES.includes(row.data?.status))); const invalidDraftWarnings = drafts.filter((row) => row.data?.schemaVersion !== TEACHER_OPERATIONS_SCHEMA_VERSION || row.data?.policyVersion !== TEACHER_OPERATIONS_POLICY_VERSION || !DRAFT_STATUSES.includes(row.data?.status)).length; const blockerCount = new Set([...orphanRunning, ...highRiskUnresolved, ...invalidHighRiskJobs].map((row) => row.path)).size; const ordinaryDraftCount = drafts.filter((row) => ["ACTIVE", "CONFLICT"].includes(row.data?.status)).length; const dependency = sha256(canonicalize({ jobs: jobs.map((row) => ({ id: row.data?.jobId, revision: row.data?.jobRevision, status: row.data?.status })), drafts: drafts.map((row) => ({ id: row.data?.draftId, revision: row.data?.draftRevision, status: row.data?.status })) })); return [{ checkId: READINESS_CHECK_ID, label: "Teacher operations readiness", category: "TEACHER_OPERATIONS", required: true, status: blockerCount ? "FAIL" : "PASS", evidence: `applicability=${jobs.length || drafts.length ? "APPLICABLE" : "NOT_APPLICABLE"}; jobs=${jobs.length}; ordinaryDraftWarnings=${ordinaryDraftCount}; invalidDraftWarnings=${invalidDraftWarnings}; orphanRunning=${orphanRunning.length}; highRiskUnresolved=${highRiskUnresolved.length}; invalidHighRiskJobs=${invalidHighRiskJobs.length}; dependency=${dependency}`, failureReason: blockerCount ? "TEACHER_OPERATIONS_READINESS_NOT_PASS" : null, ownerWave: "W9" }]; } });
const getTeacherOperationsCommandSessionOptions = (commandType) => {
  const lowRiskDraftCommands = new Set([
    TEACHER_OPERATIONS_COMMAND_TYPES.SAVE_TEACHER_DRAFT,
    TEACHER_OPERATIONS_COMMAND_TYPES.DISCARD_TEACHER_DRAFT,
    TEACHER_OPERATIONS_COMMAND_TYPES.RESOLVE_TEACHER_DRAFT,
  ]);
  return lowRiskDraftCommands.has(commandType)
    ? { recentAuth: false, highRisk: false }
    : { recentAuth: true, highRisk: true };
};

module.exports = {
  ADMIN_COMMAND_TYPES, BULK_ITEM_LIMIT, BULK_JOB_CANONICAL_BYTE_LIMIT, BULK_ITEM_STATUSES, BULK_JOB_STATUSES, BULK_POLICIES, DRAFT_STATUSES, DRAFT_TTL_DAYS, ENTITY_ACTIVE_DRAFT_LIMIT, HIGH_RISK_COMMAND_TYPES, READINESS_CHECK_ID, RECEIPT_COLLECTION, TEACHER_BULK_JOB_COLLECTION, TEACHER_DRAFT_COLLECTION, TEACHER_OPERATIONS_COMMAND_TYPES, TEACHER_OPERATIONS_POLICY_VERSION, TEACHER_OPERATIONS_SCHEMA_VERSION, createTeacherOperationsCallableExports, createTeacherOperationsCommandAdapter, createTeacherOperationsQueryCore, createTeacherOperationsReadinessAdapter, getTeacherOperationsCommandSessionOptions, normalizeTeacherOperationsPayload, receiptIdFor, supportedBulkCommandTypes, uuidFromHash,
};
