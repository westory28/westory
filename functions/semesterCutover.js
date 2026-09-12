const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const semesterCore = require("./semesterCore");
const archiveEnrollment = require("./archiveEnrollment");
const assessmentLifecycle = require("./assessmentLifecycle");
const gradeEvidence = require("./gradeEvidence");
const wisEconomy = require("./wisEconomy");
const w8Domains = require("./w8Domains");
const teacherOperations = require("./teacherOperations");
const sessionAuthority = require("./sessionAuthority");
const { onCallWithStudentMaintenance: onCall } = require("./studentMaintenance");
const productionApproval = require("./productionCutoverApproval");

const REGION = "asia-northeast3";
const ADMIN_EMAIL = "westoria28@gmail.com";
const STAGING_PROJECT_ID = "westory-staging-177587430482";
const VISUAL_FIXTURE_ADMIN_EMAIL = "w10p-visual-admin@yongshin-ms.ms.kr";
const VISUAL_FIXTURE_ADMIN_UID = "w10p-visual-admin";
const VISUAL_FIXTURE_ID = "w10p-visual-fixture-v1";
const VISUAL_FIXTURE_OWNER = "w10p-visual-parity";
const VISUAL_FIXTURE_PLAN_HASH = "53d6f784bdfda8b731085d468e402e2b144ee4c6e4d5bab612352d131be5c509";
const VISUAL_FIXTURE_RUN_PATH = `w10p_visual_fixture_runs/${VISUAL_FIXTURE_ID}`;
const VISUAL_FIXTURE_TARGET_SEMESTER_ID = "2026-2";
const REHEARSAL_SOURCE_SEMESTER_ID = "2098-1";
const REHEARSAL_TARGET_SEMESTER_ID = "2098-2";
const CUTOVER_SCHEMA_VERSION = 1;
const CUTOVER_POLICY_VERSION = "w11-v1";
const READINESS_CHECK_ID = "semester_cutover_readiness";
const MAX_OPERATIONS = 100;
const APPLY_BATCH_LIMIT = 25;
const SNAPSHOT_DEFAULT_ROW_LIMIT = 500;
const SNAPSHOT_TOTAL_BYTE_LIMIT = 1_500_000;
const SNAPSHOT_TRANSACTION_BYTE_LIMIT = 5_000_000;
const SNAPSHOT_ROW_LIMITS = Object.freeze({
  SEMESTER_MANIFEST: 1,
  SEMESTER_SETTINGS: 50,
  SEMESTER_CLASSES: 200,
  SEMESTER_ENROLLMENTS: 1_500,
  ASSESSMENT_DEFINITIONS: 25,
  GRADE_MASTER: 1,
  LEARNING_CONTENT: 50,
  SCHEDULE_EVENTS: 200,
  NOTICE_TEMPLATES: 50,
  WIS_CATALOG_REFERENCE: 100,
  WIS_ECONOMY: 1,
  WIS_ACCOUNTS: 1_200,
});

const CUTOVER_PLAN_COLLECTION = "semester_cutover_plans";
const CUTOVER_ATTEMPT_COLLECTION = "semester_cutover_attempts";
const CUTOVER_EVIDENCE_COLLECTION = "semester_cutover_evidence";
const CUTOVER_TARGET_COLLECTION = "semester_cutover_targets";
const RECEIPT_COLLECTION = "command_receipts";
const AUDIT_COLLECTION = "command_audit_events";

const CUTOVER_COMMAND_TYPES = Object.freeze({
  CREATE_PLAN: "createSemesterCutoverPlan",
  DRY_RUN: "dryRunSemesterCutover",
  APPLY_BATCH: "applySemesterCutoverBatch",
  VERIFY: "verifySemesterCutover",
  RESUME: "resumeSemesterCutover",
  CREATE_ROLLBACK_PLAN: "createSemesterRollbackPlan",
});

const PLAN_STATUSES = Object.freeze([
  "CREATED",
  "DRY_RUN_PASSED",
  "BLOCKED",
  "APPLYING",
  "PARTIAL",
  "APPLIED",
  "VERIFIED",
  "ROLLBACK_PLANNED",
  "QUARANTINED",
]);
const ATTEMPT_STATUSES = Object.freeze([
  "PLANNED",
  "DRY_RUN_PASSED",
  "BLOCKED",
  "APPLYING",
  "PARTIAL",
  "APPLIED",
  "VERIFIED",
  "ROLLBACK_PLANNED",
  "FAILED",
]);
const ITEM_STATUSES = Object.freeze(["PENDING", "SUCCEEDED", "FAILED", "NOT_APPLICABLE"]);

const COPY_DENYLIST = Object.freeze([
  "ASSESSMENT_ATTEMPTS", "STUDENT_ANSWERS", "ASSESSMENT_SUBMISSIONS", "ASSESSMENT_RESULTS",
  "OFFICIAL_GRADES", "GRADE_VERSIONS", "GRADE_CORRECTION_REQUESTS", "GRADE_ATTESTATIONS",
  "ATTENDANCE_SESSIONS", "ATTENDANCE_RECORDS", "ATTENDANCE_REVISIONS", "LEARNING_PROGRESS",
  "LEARNING_EXEMPTIONS", "NOTICE_DELIVERIES", "NOTICE_ACKNOWLEDGEMENTS", "NOTIFICATION_READ_STATE",
  "TEACHER_DRAFTS", "TEACHER_BULK_JOBS", "COMMAND_RECEIPTS", "AUDIT_LOGS", "WIS_LEDGER",
  "WIS_BALANCES", "WIS_RANKINGS", "WIS_ORDERS", "WIS_INVENTORY", "WIS_ITEM_USAGE",
  "WIS_INITIAL_GRANTS", "APPLICATION_SESSIONS", "TEMPORARY_FIXTURES", "TEST_DATA", "STORAGE_OBJECTS",
]);

const OPERATION_DEFINITIONS = Object.freeze({
  SEMESTER_MANIFEST: Object.freeze({
    strategy: "RECREATE",
    commands: Object.freeze([semesterCore.SEMESTER_COMMAND_TYPES.CREATE_SEMESTER_MANIFEST]),
  }),
  SEMESTER_SETTINGS: Object.freeze({
    strategy: "RECREATE",
    commands: Object.freeze([semesterCore.SEMESTER_COMMAND_TYPES.CREATE_SEMESTER_MANIFEST]),
  }),
  SEMESTER_CLASSES: Object.freeze({
    strategy: "IMPORT",
    commands: Object.freeze([archiveEnrollment.ARCHIVE_ENROLLMENT_COMMAND_TYPES.CREATE_SEMESTER_CLASS]),
  }),
  SEMESTER_ENROLLMENTS: Object.freeze({
    strategy: "IMPORT",
    commands: Object.freeze([archiveEnrollment.ARCHIVE_ENROLLMENT_COMMAND_TYPES.IMPORT_ENROLLMENT_ROSTER]),
  }),
  ASSESSMENT_DEFINITIONS: Object.freeze({
    strategy: "CLONE",
    commands: Object.freeze([assessmentLifecycle.ASSESSMENT_COMMAND_TYPES.CREATE_ASSESSMENT_DEFINITION]),
  }),
  GRADE_MASTER: Object.freeze({ strategy: "VALIDATE_ONLY", commands: Object.freeze([]) }),
  LEARNING_CONTENT: Object.freeze({
    strategy: "CLONE",
    commands: Object.freeze([w8Domains.W8_COMMAND_TYPES.CREATE_LEARNING_CONTENT]),
  }),
  SCHEDULE_EVENTS: Object.freeze({
    strategy: "RECREATE",
    commands: Object.freeze([w8Domains.W8_COMMAND_TYPES.CREATE_SCHEDULE_EVENT]),
  }),
  NOTICE_TEMPLATES: Object.freeze({
    strategy: "RECREATE",
    commands: Object.freeze([w8Domains.W8_COMMAND_TYPES.CREATE_NOTICE]),
  }),
  WIS_CATALOG_REFERENCE: Object.freeze({ strategy: "REFERENCE", commands: Object.freeze([]) }),
  WIS_ECONOMY: Object.freeze({
    strategy: "RECREATE",
    commands: Object.freeze([wisEconomy.WIS_COMMAND_TYPES.CREATE_SEMESTER_ECONOMY]),
  }),
  WIS_ACCOUNTS: Object.freeze({
    strategy: "RECREATE",
    commands: Object.freeze([wisEconomy.WIS_COMMAND_TYPES.CREATE_WIS_ACCOUNTS]),
  }),
});

const fail = (code, message, reason, details = {}) => {
  throw new HttpsError(code, message, { reason, ...details });
};
const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const canonicalJson = (value) => {
  const visit = (current) => {
    if (current === null || ["string", "boolean", "number"].includes(typeof current)) return current;
    if (Array.isArray(current)) return current.map(visit);
    if (typeof current?.toMillis === "function") return { __timestampMillis: current.toMillis() };
    if (current instanceof Date) return { __dateMillis: current.getTime() };
    if (isObject(current)) {
      return Object.fromEntries(Object.keys(current).sort()
        .filter((key) => current[key] !== undefined)
        .map((key) => [key, visit(current[key])]));
    }
    return String(current);
  };
  return JSON.stringify(visit(value));
};
const EMPTY_SNAPSHOT_HASH = sha256("[]");

const allowed = (value, keys, label) => {
  if (!isObject(value)) fail("invalid-argument", `${label} must be an object.`, "W11_PAYLOAD_INVALID");
  const fields = Object.keys(value).filter((key) => !keys.includes(key));
  if (fields.length) fail("invalid-argument", `${label} contains unsupported fields.`, "W11_PAYLOAD_INVALID", { fields });
};
const text = (value, label, max = 160) => {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > max || value.includes("/")) {
    fail("invalid-argument", `${label} is invalid.`, "W11_PAYLOAD_INVALID", { field: label });
  }
  return value;
};
const integer = (value, label, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail("invalid-argument", `${label} is invalid.`, "W11_PAYLOAD_INVALID", { field: label });
  }
  return value;
};
const hash = (value, label) => {
  const normalized = text(value, label, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) fail("invalid-argument", `${label} is invalid.`, "W11_PAYLOAD_INVALID");
  return normalized;
};
const commandId = (value, label = "childCommandId") => {
  const normalized = text(value, label, 40);
  if (!/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26})$/i.test(normalized)) {
    fail("invalid-argument", `${label} is invalid.`, "W11_PAYLOAD_INVALID");
  }
  return normalized.includes("-") ? normalized.toLowerCase() : normalized.toUpperCase();
};
const enumValue = (value, values, label) => {
  if (!values.includes(value)) fail("invalid-argument", `${label} is invalid.`, "W11_PAYLOAD_INVALID", { field: label });
  return value;
};
const semesterId = (value) => semesterCore.normalizeSemesterId(value);
const snapshotSpec = (value, label) => {
  allowed(value, ["count", "hash"], label);
  return { count: integer(value.count, `${label}.count`, 0, 100_000), hash: hash(value.hash, `${label}.hash`) };
};
const manifestSnapshotSpec = (value) => ({ count: Number(value?.count || 0), hash: String(value?.hash || "") });

const normalizeOperation = (value, index) => {
  const label = `operations[${index}]`;
  allowed(value, [
    "operationKey", "operationOrder", "operationType", "applicable", "childCommandType",
    "childCommandId", "childPayloadHash", "sourceSnapshot", "targetBeforeSnapshot", "targetAfterSnapshot",
  ], label);
  const operationType = enumValue(value.operationType, Object.keys(OPERATION_DEFINITIONS), `${label}.operationType`);
  const definition = OPERATION_DEFINITIONS[operationType];
  const applicable = value.applicable !== false;
  const commandRequired = definition.commands.length > 0 && applicable;
  const childCommandType = commandRequired
    ? enumValue(value.childCommandType, definition.commands, `${label}.childCommandType`)
    : null;
  if (!commandRequired && [value.childCommandType, value.childCommandId, value.childPayloadHash].some((item) => item != null && item !== "")) {
    fail("invalid-argument", `${label} cannot declare a child command.`, "W11_OPERATION_COMMAND_FORBIDDEN");
  }
  if (operationType === "GRADE_MASTER" && applicable) {
    fail("failed-precondition", "Grade master cloning is not available in W11.", "W11_GRADE_CLONE_NOT_AVAILABLE");
  }
  const operation = {
    operationKey: text(value.operationKey, `${label}.operationKey`, 80),
    operationOrder: integer(value.operationOrder, `${label}.operationOrder`, 1, MAX_OPERATIONS),
    operationType,
    strategy: definition.strategy,
    applicable,
    childCommandType,
    childCommandId: commandRequired ? commandId(value.childCommandId, `${label}.childCommandId`) : null,
    childPayloadHash: commandRequired ? hash(value.childPayloadHash, `${label}.childPayloadHash`) : null,
    sourceSnapshot: snapshotSpec(value.sourceSnapshot, `${label}.sourceSnapshot`),
    targetBeforeSnapshot: snapshotSpec(value.targetBeforeSnapshot, `${label}.targetBeforeSnapshot`),
    targetAfterSnapshot: snapshotSpec(value.targetAfterSnapshot, `${label}.targetAfterSnapshot`),
  };
  return operation;
};

const manifestFingerprint = (value) => ({
  manifestVersion: value.manifestVersion,
  sourceSemesterId: value.sourceSemesterId,
  targetSemesterId: value.targetSemesterId,
  sourceManifestRevision: value.sourceManifestRevision,
  targetManifestRevision: value.targetManifestRevision,
  copyDenylist: value.copyDenylist,
  operations: value.operations.map((operation) => ({
    ...operation,
    sourceSnapshot: manifestSnapshotSpec(operation.sourceSnapshot),
    targetBeforeSnapshot: manifestSnapshotSpec(operation.targetBeforeSnapshot),
    targetAfterSnapshot: manifestSnapshotSpec(operation.targetAfterSnapshot),
  })),
});
const computeManifestHash = (value) => sha256(canonicalJson(manifestFingerprint(value)));
const planIdFor = (manifestVersion, sourceSemesterId, targetSemesterId) =>
  `cutplan_${sha256(`${manifestVersion}\n${sourceSemesterId}\n${targetSemesterId}`)}`;
const attemptIdFor = (planId) => `cutattempt_${sha256(planId)}`;
const itemIdFor = (planId, operationKey) => `cutitem_${sha256(`${planId}\n${operationKey}`)}`;
const evidenceIdFor = (attemptId, dependencyHash) => `cutevidence_${sha256(`${attemptId}\n${dependencyHash}`)}`;
const rollbackPlanIdFor = (planId, attemptId) => `cutrollback_${sha256(`${planId}\n${attemptId}`)}`;
const receiptIdFor = (actorUid, childCommandType, childCommandId) =>
  `cmd_${sha256(`${actorUid}\n${childCommandType}\n${childCommandId}`)}`;
const planPath = (planId) => `${CUTOVER_PLAN_COLLECTION}/${planId}`;
const attemptPath = (attemptId) => `${CUTOVER_ATTEMPT_COLLECTION}/${attemptId}`;
const itemPath = (attemptId, operationKey) => `${CUTOVER_ATTEMPT_COLLECTION}/${attemptId}/items/${itemIdFor(attemptId, operationKey)}`;
const evidencePath = (evidenceId) => `${CUTOVER_EVIDENCE_COLLECTION}/${evidenceId}`;
const targetPath = (targetSemesterId) => `${CUTOVER_TARGET_COLLECTION}/${targetSemesterId}`;
const manifestPath = (scope) => `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${scope}`;

const normalizeCutoverPayload = (type, raw) => {
  if (!isObject(raw)) fail("invalid-argument", "payload must be an object.", "W11_PAYLOAD_INVALID");
  if (type === CUTOVER_COMMAND_TYPES.CREATE_PLAN) {
    allowed(raw, ["manifestVersion", "manifestHash", "sourceSemesterId", "targetSemesterId", "sourceManifestRevision", "targetManifestRevision", "copyDenylist", "operations"], "createSemesterCutoverPlan payload");
    if (!Array.isArray(raw.operations) || raw.operations.length < 1 || raw.operations.length > MAX_OPERATIONS) fail("invalid-argument", "operations is invalid.", "W11_PAYLOAD_INVALID");
    const operations = raw.operations.map(normalizeOperation).sort((a, b) => a.operationOrder - b.operationOrder || a.operationKey.localeCompare(b.operationKey));
    if (new Set(operations.map((item) => item.operationKey)).size !== operations.length || new Set(operations.map((item) => item.operationOrder)).size !== operations.length) fail("invalid-argument", "operations must have unique keys and ordering.", "W11_OPERATION_DUPLICATE");
    const datasets = [...new Set(operations.map((item) => item.operationType))].sort();
    const requiredDatasets = Object.keys(OPERATION_DEFINITIONS).sort();
    if (canonicalJson(datasets) !== canonicalJson(requiredDatasets)) fail("failed-precondition", "operations must cover every W11 dataset.", "W11_DATASET_MANIFEST_INCOMPLETE", { requiredDatasets });
    const aggregateSpecs = new Map();
    for (const operation of operations) {
      const fingerprint = canonicalJson({ sourceSnapshot: operation.sourceSnapshot, targetBeforeSnapshot: operation.targetBeforeSnapshot, targetAfterSnapshot: operation.targetAfterSnapshot });
      const existing = aggregateSpecs.get(operation.operationType);
      if (existing && existing !== fingerprint) fail("failed-precondition", "Operations for one dataset must share aggregate snapshots.", "W11_DATASET_SNAPSHOT_MISMATCH", { operationType: operation.operationType });
      aggregateSpecs.set(operation.operationType, fingerprint);
    }
    const payload = {
      manifestVersion: text(raw.manifestVersion, "manifestVersion", 80),
      sourceSemesterId: semesterId(raw.sourceSemesterId),
      targetSemesterId: semesterId(raw.targetSemesterId),
      sourceManifestRevision: integer(raw.sourceManifestRevision, "sourceManifestRevision", 1),
      targetManifestRevision: integer(raw.targetManifestRevision, "targetManifestRevision", 1),
      copyDenylist: Array.isArray(raw.copyDenylist) ? raw.copyDenylist.map((item, index) => text(item, `copyDenylist[${index}]`, 80)) : [],
      operations,
    };
    if (canonicalJson(payload.copyDenylist) !== canonicalJson(COPY_DENYLIST)) fail("failed-precondition", "copyDenylist does not match the W11 policy.", "W11_COPY_DENYLIST_MISMATCH");
    if (payload.sourceSemesterId === payload.targetSemesterId) fail("invalid-argument", "source and target semesters must differ.", "W11_SCOPE_IDENTICAL");
    payload.manifestHash = hash(raw.manifestHash, "manifestHash");
    if (computeManifestHash(payload) !== payload.manifestHash) fail("failed-precondition", "manifestHash does not match normalized operations.", "W11_MANIFEST_HASH_MISMATCH");
    return payload;
  }
  const common = ["planId", "attemptId", "expectedPlanRevision", "expectedAttemptRevision"];
  if (type === CUTOVER_COMMAND_TYPES.DRY_RUN) {
    allowed(raw, ["planId", "expectedPlanRevision", "expectedAttemptRevision"], "dryRunSemesterCutover payload");
    return {
      planId: text(raw.planId, "planId", 80),
      expectedPlanRevision: integer(raw.expectedPlanRevision, "expectedPlanRevision", 1),
      expectedAttemptRevision: raw.expectedAttemptRevision == null
        ? null
        : integer(raw.expectedAttemptRevision, "expectedAttemptRevision", 1),
    };
  }
  if (type === CUTOVER_COMMAND_TYPES.APPLY_BATCH) {
    allowed(raw, [...common, "operationKeys", "failures"], "applySemesterCutoverBatch payload");
    if (!Array.isArray(raw.operationKeys) || raw.operationKeys.length < 1 || raw.operationKeys.length > APPLY_BATCH_LIMIT) fail("invalid-argument", "operationKeys is invalid.", "W11_PAYLOAD_INVALID");
    const operationKeys = raw.operationKeys.map((item, index) => text(item, `operationKeys[${index}]`, 80));
    if (new Set(operationKeys).size !== operationKeys.length) fail("invalid-argument", "operationKeys contains duplicates.", "W11_OPERATION_DUPLICATE");
    const failures = raw.failures === undefined ? [] : raw.failures;
    if (!Array.isArray(failures) || failures.length > operationKeys.length) fail("invalid-argument", "failures is invalid.", "W11_PAYLOAD_INVALID");
    return { planId: text(raw.planId, "planId", 80), attemptId: text(raw.attemptId, "attemptId", 80), expectedPlanRevision: integer(raw.expectedPlanRevision, "expectedPlanRevision", 1), expectedAttemptRevision: integer(raw.expectedAttemptRevision, "expectedAttemptRevision", 1), operationKeys, failures: failures.map((failure, index) => { allowed(failure, ["operationKey", "errorCode", "errorReason"], `failures[${index}]`); return { operationKey: text(failure.operationKey, `failures[${index}].operationKey`, 80), errorCode: text(failure.errorCode, `failures[${index}].errorCode`, 120), errorReason: failure.errorReason ? text(failure.errorReason, `failures[${index}].errorReason`, 500) : "" }; }) };
  }
  if (type === CUTOVER_COMMAND_TYPES.VERIFY) {
    allowed(raw, common, "verifySemesterCutover payload");
    return { planId: text(raw.planId, "planId", 80), attemptId: text(raw.attemptId, "attemptId", 80), expectedPlanRevision: integer(raw.expectedPlanRevision, "expectedPlanRevision", 1), expectedAttemptRevision: integer(raw.expectedAttemptRevision, "expectedAttemptRevision", 1) };
  }
  if (type === CUTOVER_COMMAND_TYPES.RESUME) {
    allowed(raw, [...common, "operationKeys", "reason"], "resumeSemesterCutover payload");
    if (!Array.isArray(raw.operationKeys) || raw.operationKeys.length < 1 || raw.operationKeys.length > APPLY_BATCH_LIMIT) fail("invalid-argument", "operationKeys is invalid.", "W11_PAYLOAD_INVALID");
    return { planId: text(raw.planId, "planId", 80), attemptId: text(raw.attemptId, "attemptId", 80), expectedPlanRevision: integer(raw.expectedPlanRevision, "expectedPlanRevision", 1), expectedAttemptRevision: integer(raw.expectedAttemptRevision, "expectedAttemptRevision", 1), operationKeys: raw.operationKeys.map((item, index) => text(item, `operationKeys[${index}]`, 80)), reason: text(raw.reason, "reason", 500) };
  }
  if (type === CUTOVER_COMMAND_TYPES.CREATE_ROLLBACK_PLAN) {
    allowed(raw, [...common, "reason"], "createSemesterRollbackPlan payload");
    return { planId: text(raw.planId, "planId", 80), attemptId: text(raw.attemptId, "attemptId", 80), expectedPlanRevision: integer(raw.expectedPlanRevision, "expectedPlanRevision", 1), expectedAttemptRevision: integer(raw.expectedAttemptRevision, "expectedAttemptRevision", 1), reason: text(raw.reason, "reason", 500) };
  }
  fail("invalid-argument", "Unsupported W11 command.", "W11_COMMAND_UNSUPPORTED");
};

const assertProject = (projectId) => {
  const normalized = String(projectId || "").trim();
  if (normalized !== STAGING_PROJECT_ID && normalized !== productionApproval.PRODUCTION_PROJECT_ID && !normalized.startsWith("demo-westory-session-")) {
    fail("failed-precondition", "Cutover project is not supported.", "W11_PROJECT_FORBIDDEN");
  }
};
const assertCutoverProject = assertProject;
const assertProjectSemesterPair = (projectId, sourceSemesterId, targetSemesterId) => {
  if (
    String(projectId || "").trim() === STAGING_PROJECT_ID
    && (
      sourceSemesterId !== REHEARSAL_SOURCE_SEMESTER_ID
      || targetSemesterId !== REHEARSAL_TARGET_SEMESTER_ID
    )
  ) {
    fail(
      "failed-precondition",
      "Dedicated Staging W11 plans are limited to the isolated rehearsal semester pair.",
      "W11_STAGING_SCOPE_FORBIDDEN",
      {
        sourceSemesterId,
        targetSemesterId,
        requiredSourceSemesterId: REHEARSAL_SOURCE_SEMESTER_ID,
        requiredTargetSemesterId: REHEARSAL_TARGET_SEMESTER_ID,
      },
    );
  }
};
const assertManifestRevision = (snapshot, semester, expectedRevision, statuses, label) => {
  if (!snapshot.exists || snapshot.data?.semesterId !== semester) fail("not-found", `${label} Manifest was not found.`, "SEMESTER_NOT_FOUND", { semesterId: semester });
  if (Number(snapshot.data?.revision || 0) !== expectedRevision) fail("aborted", `${label} Manifest revision changed.`, "SEMESTER_REVISION_CONFLICT", { semesterId: semester, currentRevision: Number(snapshot.data?.revision || 0) });
  if (!statuses.includes(snapshot.data?.status)) fail("failed-precondition", `${label} Manifest lifecycle is not eligible.`, "W11_MANIFEST_STATE_INVALID", { semesterId: semester, status: snapshot.data?.status });
  return snapshot.data;
};
const assertRevision = (snapshot, field, expected, reason) => {
  if (!snapshot.exists) fail("not-found", "W11 resource was not found.", "W11_RESOURCE_NOT_FOUND");
  if (Number(snapshot.data?.[field] || 0) !== expected) fail("aborted", "W11 resource revision changed.", reason, { currentRevision: Number(snapshot.data?.[field] || 0) });
};
const assertLatestTargetMarker = async (transaction, plan, planId, attemptId = null) => {
  const targetSemesterId = plan.data?.targetSemesterId;
  const marker = await transaction.get(targetPath(targetSemesterId));
  if (
    !marker.exists
    || marker.data?.targetSemesterId !== targetSemesterId
    || marker.data?.latestPlanId !== planId
  ) {
    fail(
      "failed-precondition",
      "Cutover Plan is not the latest plan for its target semester.",
      "W11_CUTOVER_TARGET_PLAN_MISMATCH",
      {
        planId,
        targetSemesterId,
        latestPlanId: marker.data?.latestPlanId || null,
      },
    );
  }
  if (
    attemptId
    && (
      marker.data?.latestAttemptId !== attemptId
      || plan.data?.latestAttemptId !== attemptId
    )
  ) {
    fail(
      "failed-precondition",
      "Cutover Attempt is not the latest attempt for its target plan.",
      "W11_CUTOVER_TARGET_ATTEMPT_MISMATCH",
      {
        planId,
        attemptId,
        latestAttemptId: marker.data?.latestAttemptId || null,
      },
    );
  }
  return marker;
};

const VOLATILE_FIELDS = new Set([
  "createdAt", "updatedAt", "createdBy", "updatedBy", "commandId", "receiptId", "actorUid",
  "activatedAt", "activatedBy", "closedAt", "closedBy", "openedAt", "openedBy", "publishedAt",
]);
const MANIFEST_LIFECYCLE_FIELDS = new Set([
  "status",
  "provenance",
  "stateRevision",
  "readinessReportId",
  "readinessReportRef",
  "lastTransitionReason",
  "lastChangeReason",
]);
const semanticData = (value) => {
  if (Array.isArray(value)) return value.map(semanticData);
  if (value && typeof value === "object") {
    if (typeof value.toMillis === "function") return null;
    return Object.fromEntries(Object.keys(value).sort().filter((key) => !VOLATILE_FIELDS.has(key) && value[key] !== undefined)
      .map((key) => [key, semanticData(value[key])]));
  }
  return value;
};
const semanticDataForOperation = (value, operationType) => {
  if (operationType !== "SEMESTER_MANIFEST" || !value || typeof value !== "object" || Array.isArray(value)) return semanticData(value);
  return semanticData(Object.fromEntries(Object.entries(value).filter(([key]) => !MANIFEST_LIFECYCLE_FIELDS.has(key))));
};
const snapshotFromRows = (rows, { operationType = "UNKNOWN", scope = "UNKNOWN" } = {}) => {
  const rowLimit = SNAPSHOT_ROW_LIMITS[operationType] || SNAPSHOT_DEFAULT_ROW_LIMIT;
  if (rows.length > rowLimit) fail("resource-exhausted", "Cutover aggregate snapshot exceeds its bounded row budget.", "W11_SNAPSHOT_OVERFLOW", { operationType, scope, rowCount: rows.length, rowLimit });
  const normalized = rows.map((row) => ({ path: row.path, data: semanticDataForOperation(row.data || {}, operationType) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const serialized = canonicalJson(normalized);
  const byteCount = Buffer.byteLength(serialized, "utf8");
  if (byteCount > SNAPSHOT_TOTAL_BYTE_LIMIT) fail("resource-exhausted", "Cutover snapshot exceeds the bounded evidence budget.", "W11_SNAPSHOT_OVERFLOW", { operationType, scope, byteCount, byteLimit: SNAPSHOT_TOTAL_BYTE_LIMIT });
  const shards = new Map();
  for (const row of normalized) {
    const shardKey = row.path.split("/")[0] || "unknown";
    const bucket = shards.get(shardKey) || [];
    bucket.push(row);
    shards.set(shardKey, bucket);
  }
  return {
    count: normalized.length,
    hash: sha256(serialized),
    scan: {
      bounded: true,
      rowLimit,
      byteLimit: SNAPSHOT_TOTAL_BYTE_LIMIT,
      byteCount,
      shards: [...shards.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([shardKey, shardRows]) => ({ shardKey, count: shardRows.length, hash: sha256(canonicalJson(shardRows)) })),
    },
  };
};
const queryBounded = async (transaction, collection, filter, operationType) => {
  const rowLimit = SNAPSHOT_ROW_LIMITS[operationType] || SNAPSHOT_DEFAULT_ROW_LIMIT;
  const rows = await transaction.query(collection, { ...(filter || {}), limit: rowLimit + 1 });
  if (rows.length > rowLimit) fail("resource-exhausted", "Cutover snapshot requires an approved paginated evidence contract.", "W11_SNAPSHOT_OVERFLOW", { operationType, collection, rowLimit });
  return rows;
};
const querySemester = (transaction, collection, scope, operationType) => queryBounded(transaction, collection, { field: "semesterId", operator: "==", value: scope }, operationType);
const readSeedRows = async (transaction, scope) => {
  const [year, term] = scope.split("-");
  const paths = semesterCore.getSemesterSeedDefinitions(year, term).map((seed) => seed.path);
  const rows = typeof transaction.getAll === "function" ? await transaction.getAll(paths) : await Promise.all(paths.map((path) => transaction.get(path)));
  return rows.filter((row) => row.exists);
};
const ACTIVITY_COLLECTIONS = Object.freeze([
  assessmentLifecycle.ATTEMPT_COLLECTION,
  assessmentLifecycle.SUBMISSION_COLLECTION,
  assessmentLifecycle.RESULT_COLLECTION,
  gradeEvidence.GRADE_RECORD_COLLECTION,
  gradeEvidence.GRADE_VERSION_COLLECTION,
  gradeEvidence.GRADE_REQUEST_COLLECTION,
  gradeEvidence.GRADE_ATTESTATION_COLLECTION,
  w8Domains.LEARNING_PROGRESS_COLLECTION,
  w8Domains.LEARNING_EXEMPTION_COLLECTION,
  w8Domains.LEARNING_EXEMPTION_REQUEST_COLLECTION,
  w8Domains.ATTENDANCE_SESSION_COLLECTION,
  w8Domains.ATTENDANCE_RECORD_COLLECTION,
  w8Domains.ATTENDANCE_REVISION_COLLECTION,
  w8Domains.NOTICE_DELIVERY_COLLECTION,
  w8Domains.NOTICE_ACK_COLLECTION,
  wisEconomy.WIS_LEDGER_COLLECTION,
  wisEconomy.WIS_ORDER_COLLECTION,
  wisEconomy.WIS_INVENTORY_COLLECTION,
  teacherOperations.TEACHER_DRAFT_COLLECTION,
  teacherOperations.TEACHER_BULK_JOB_COLLECTION,
]);
const rowsForOperation = async (transaction, scope, operationType) => {
  if (operationType === "SEMESTER_MANIFEST") {
    const row = await transaction.get(manifestPath(scope));
    return row.exists ? [row] : [];
  }
  if (operationType === "SEMESTER_SETTINGS") return readSeedRows(transaction, scope);
  if (operationType === "SEMESTER_CLASSES") return querySemester(transaction, archiveEnrollment.SEMESTER_CLASS_COLLECTION, scope, operationType);
  if (operationType === "SEMESTER_ENROLLMENTS") {
    const rows = [];
    for (const collection of [archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION, archiveEnrollment.ENROLLMENT_SLOT_COLLECTION, archiveEnrollment.ROSTER_IMPORT_COLLECTION]) rows.push(...await querySemester(transaction, collection, scope, operationType));
    return rows;
  }
  if (operationType === "ASSESSMENT_DEFINITIONS") return querySemester(transaction, assessmentLifecycle.DEFINITION_COLLECTION, scope, operationType);
  if (operationType === "LEARNING_CONTENT") return querySemester(transaction, w8Domains.LEARNING_CONTENT_COLLECTION, scope, operationType);
  if (operationType === "SCHEDULE_EVENTS") return querySemester(transaction, w8Domains.SCHEDULE_EVENT_COLLECTION, scope, operationType);
  if (operationType === "NOTICE_TEMPLATES") return querySemester(transaction, w8Domains.NOTICE_COLLECTION, scope, operationType);
  if (operationType === "WIS_CATALOG_REFERENCE") return queryBounded(transaction, wisEconomy.WIS_PRODUCT_COLLECTION, null, operationType);
  if (operationType === "WIS_ECONOMY") return querySemester(transaction, wisEconomy.WIS_ECONOMY_COLLECTION, scope, operationType);
  if (operationType === "WIS_ACCOUNTS") {
    const rows = [];
    for (const collection of [wisEconomy.WIS_ACCOUNT_COLLECTION, wisEconomy.WIS_BALANCE_COLLECTION, wisEconomy.WIS_RANKING_COLLECTION]) rows.push(...await querySemester(transaction, collection, scope, operationType));
    return rows;
  }
  if (operationType === "GRADE_MASTER") return [];
  fail("failed-precondition", "W11 operation has no snapshot adapter.", "W11_OPERATION_ADAPTER_MISSING", { operationType });
};
const activitySnapshot = async (transaction, scope) => {
  const rows = [];
  for (const collection of ACTIVITY_COLLECTIONS) rows.push(...await transaction.query(collection, { field: "semesterId", operator: "==", value: scope, limit: 1 }));
  return snapshotFromRows(rows, { operationType: "DENIED_ACTIVITY", scope });
};
const inspectOperation = async (transaction, operation, sourceSemesterId, targetSemesterId) => ({
  source: snapshotFromRows(await rowsForOperation(transaction, sourceSemesterId, operation.operationType), { operationType: operation.operationType, scope: sourceSemesterId }),
  target: snapshotFromRows(await rowsForOperation(transaction, targetSemesterId, operation.operationType), { operationType: operation.operationType, scope: targetSemesterId }),
});
const inspectDatasets = async (transaction, operations, sourceSemesterId, targetSemesterId) => {
  const byType = new Map();
  let byteCount = 0;
  for (const operation of operations) {
    if (!byType.has(operation.operationType)) {
      const inspected = await inspectOperation(transaction, operation, sourceSemesterId, targetSemesterId);
      byteCount += Number(inspected.source.scan?.byteCount || 0) + Number(inspected.target.scan?.byteCount || 0);
      if (byteCount > SNAPSHOT_TRANSACTION_BYTE_LIMIT) fail("resource-exhausted", "Cutover snapshot exceeds the bounded transaction evidence budget.", "W11_SNAPSHOT_OVERFLOW", { operationType: operation.operationType, byteCount, byteLimit: SNAPSHOT_TRANSACTION_BYTE_LIMIT });
      byType.set(operation.operationType, inspected);
    }
  }
  return Object.fromEntries(operations.map((operation) => [operation.operationKey, byType.get(operation.operationType)]));
};
const snapshotEqual = (left, right) => left.count === right.count && left.hash === right.hash;
const dependencyHashFor = (operations, snapshots, deniedActivitySnapshot) => sha256(canonicalJson({
  operations: operations.map((operation) => ({ operationKey: operation.operationKey, source: snapshots[operation.operationKey].source, target: snapshots[operation.operationKey].target })),
  deniedActivitySnapshot,
}));

const RECEIPT_TARGET_POLICY = Object.freeze({
  SEMESTER_MANIFEST: Object.freeze({ kinds: Object.freeze([null]), prefixes: Object.freeze(["semester_manifests/", "years/"]) }),
  SEMESTER_SETTINGS: Object.freeze({ kinds: Object.freeze([null]), prefixes: Object.freeze(["semester_manifests/", "years/"]) }),
  SEMESTER_CLASSES: Object.freeze({ kinds: Object.freeze([null]), prefixes: Object.freeze(["semester_classes/", "semester_readiness_reports/"]) }),
  SEMESTER_ENROLLMENTS: Object.freeze({ kinds: Object.freeze([null]), prefixes: Object.freeze(["enrollment_roster_imports/", "semester_classes/", "semester_enrollments/", "semester_enrollment_slots/", "semester_readiness_reports/"]) }),
  ASSESSMENT_DEFINITIONS: Object.freeze({ kinds: Object.freeze(["assessment-definition"]), prefixes: Object.freeze(["semester_assessment_definitions/", "years/"]) }),
  LEARNING_CONTENT: Object.freeze({ kinds: Object.freeze(["learning-content"]), prefixes: Object.freeze(["semester_learning_contents/"]) }),
  SCHEDULE_EVENTS: Object.freeze({ kinds: Object.freeze(["schedule-event"]), prefixes: Object.freeze(["semester_schedule_events/"]) }),
  NOTICE_TEMPLATES: Object.freeze({ kinds: Object.freeze(["notice"]), prefixes: Object.freeze(["semester_notices/"]) }),
  WIS_ECONOMY: Object.freeze({ kinds: Object.freeze(["wis-economy"]), prefixes: Object.freeze(["semester_wis_economies/"]) }),
  WIS_ACCOUNTS: Object.freeze({ kinds: Object.freeze(["wis-accounts"]), prefixes: Object.freeze(["semester_wis_accounts/", "semester_wis_balances/", "semester_wis_rankings/"]) }),
});
const refBelongsToSemester = (ref, targetSemesterId) => {
  if (!ref.startsWith("years/")) return true;
  const [year, term] = targetSemesterId.split("-");
  return ref.startsWith(`years/${year}/semesters/${term}/`);
};
const assertReceiptTargetScope = ({ receipt, operation, targetSemesterId, documentsByPath }) => {
  const policy = RECEIPT_TARGET_POLICY[operation.operationType];
  if (!policy) fail("failed-precondition", "Operation cannot use a child receipt.", "W11_RECEIPT_OPERATION_FORBIDDEN", { operationKey: operation.operationKey });
  const target = receipt.target || {};
  const kind = typeof target.kind === "string" ? target.kind : null;
  if (!policy.kinds.includes(kind)) fail("failed-precondition", "Child receipt target kind is invalid.", "W11_CHILD_RECEIPT_TARGET_INVALID", { operationKey: operation.operationKey, kind });
  if (target.semesterId && target.semesterId !== targetSemesterId) fail("failed-precondition", "Child receipt targets another semester.", "W11_CHILD_RECEIPT_SCOPE_MISMATCH", { operationKey: operation.operationKey, targetSemesterId: target.semesterId });
  if (receipt.result?.semesterId && receipt.result.semesterId !== targetSemesterId) fail("failed-precondition", "Child receipt result belongs to another semester.", "W11_CHILD_RECEIPT_SCOPE_MISMATCH", { operationKey: operation.operationKey, resultSemesterId: receipt.result.semesterId });
  const refs = Array.isArray(target.refs) ? target.refs : [];
  if (operation.operationType !== "WIS_ACCOUNTS" && refs.length === 0) fail("failed-precondition", "Child receipt has no canonical target refs.", "W11_CHILD_RECEIPT_TARGET_INVALID", { operationKey: operation.operationKey });
  for (const ref of refs) {
    if (typeof ref !== "string" || !policy.prefixes.some((prefix) => ref.startsWith(prefix)) || !refBelongsToSemester(ref, targetSemesterId)) fail("failed-precondition", "Child receipt ref is outside the target dataset.", "W11_CHILD_RECEIPT_SCOPE_MISMATCH", { operationKey: operation.operationKey, ref });
    const document = documentsByPath.get(ref);
    if (!document?.exists) fail("failed-precondition", "Child receipt target document is missing.", "W11_CHILD_RECEIPT_TARGET_MISSING", { operationKey: operation.operationKey, ref });
    if (document?.exists && document.data?.semesterId && document.data.semesterId !== targetSemesterId) fail("failed-precondition", "Child receipt ref document belongs to another semester.", "W11_CHILD_RECEIPT_SCOPE_MISMATCH", { operationKey: operation.operationKey, ref, documentSemesterId: document.data.semesterId });
  }
};
const assertReceiptAuditAuthoritySummary = ({ receiptId, receipt, audit, operation, actor, approvedProductionExecution = null }) => {
  const auditPath = `${AUDIT_COLLECTION}/${receiptId}`;
  const session = receipt.session;
  const approvedServerSession = approvedProductionExecution
    && approvedProductionExecution.projectId === productionApproval.PRODUCTION_PROJECT_ID
    && approvedProductionExecution.actorUid === actor.actorUid
    && approvedProductionExecution.actorEmail === ADMIN_EMAIL
    && session?.authorityMode === "SERVER_MAINTENANCE"
    && session.authTime === 0 && session.ref === null && session.protocolVersion === 0
    && session.authorityGeneration === approvedProductionExecution.serverMaintenanceRunId
    && session.revisionHash === sha256(approvedProductionExecution.approvalHash)
    && session.observedFailure === null
    && [receipt, audit?.data].every(row => row?.executionProvenance?.kind === "SERVER_MAINTENANCE"
      && row.executionProvenance.runId === approvedProductionExecution.serverMaintenanceRunId
      && row.executionProvenance.approvalHash === approvedProductionExecution.approvalHash);
  const applicationSession = isObject(session)
    && Number.isSafeInteger(session.authTime) && session.authTime > 0
    && session.ref === `application_sessions/${actor.actorUid}/sessions/${session.authTime}`
    && typeof session.authorityMode === "string" && session.authorityMode && session.authorityMode !== "SERVER_MAINTENANCE"
    && typeof session.authorityGeneration === "string" && session.authorityGeneration
    && Number.isSafeInteger(session.protocolVersion) && session.protocolVersion >= 1
    && typeof session.revisionHash === "string" && /^[0-9a-f]{64}$/.test(session.revisionHash)
    && Object.prototype.hasOwnProperty.call(session, "observedFailure");
  if (
    receipt.actorUid !== actor.actorUid
    || String(receipt.actorEmail || "").trim().toLowerCase() !== ADMIN_EMAIL
    || receipt.actorRole !== "admin"
    || typeof receipt.actorCapability !== "string"
    || !receipt.actorCapability.trim()
    || (!approvedServerSession && !applicationSession)
  ) {
    fail(
      "failed-precondition",
      "Child command authority or session summary is incomplete.",
      "W11_CHILD_RECEIPT_AUTHORITY_MISMATCH",
      { operationKey: operation.operationKey, receiptId },
    );
  }
  if (
    !isObject(receipt.audit)
    || receipt.audit.eventId !== receiptId
    || receipt.audit.ref !== auditPath
    || receipt.audit.eventType !== "COMMAND_SUCCEEDED"
    || !audit?.exists
    || audit.data?.eventId !== receiptId
    || audit.data?.eventType !== "COMMAND_SUCCEEDED"
    || audit.data?.receiptRef !== `${RECEIPT_COLLECTION}/${receiptId}`
    || audit.data?.commandId !== receipt.commandId
    || audit.data?.commandType !== receipt.commandType
    || audit.data?.actorUid !== receipt.actorUid
    || audit.data?.actorEmail !== receipt.actorEmail
    || audit.data?.actorRole !== receipt.actorRole
    || audit.data?.actorCapability !== receipt.actorCapability
    || audit.data?.payloadHash !== receipt.payloadHash
    || audit.data?.sourceHash !== receipt.sourceHash
    || canonicalJson(audit.data?.target) !== canonicalJson(receipt.target)
    || canonicalJson(audit.data?.result) !== canonicalJson(receipt.result)
  ) {
    fail(
      "failed-precondition",
      "Child command audit does not match its receipt.",
      "W11_CHILD_AUDIT_MISMATCH",
      { operationKey: operation.operationKey, receiptId },
    );
  }
};
const assertReconciledChildReceipt = ({ receiptId, receipt, audit, operation, actor, targetSemesterId, documentsByPath, approvedProductionExecution }) => {
  if (
    !receipt?.exists
    || receipt.data?.status !== "SUCCEEDED"
    || receipt.data?.actorUid !== actor.actorUid
    || receipt.data?.commandType !== operation.childCommandType
    || receipt.data?.commandId !== operation.childCommandId
    || receipt.data?.payloadHash !== operation.childPayloadHash
  ) {
    fail("failed-precondition", "Child command receipt does not match the Cutover Plan.", "W11_CHILD_RECEIPT_MISMATCH", { operationKey: operation.operationKey });
  }
  assertReceiptTargetScope({ receipt: receipt.data, operation, targetSemesterId, documentsByPath });
  assertReceiptAuditAuthoritySummary({ receiptId, receipt: receipt.data, audit, operation, actor, approvedProductionExecution });
};
const revisionEvidenceFor = (document) => {
  for (const field of ["revision", "stateRevision", "manifestRevision", "recordRevision", "sessionRevision"]) {
    const value = document?.data?.[field];
    if (Number.isSafeInteger(value) && value >= 0) return { field, value };
  }
  return null;
};

const createSemesterCutoverCommandAdapter = ({ projectId = "", now = () => new Date() } = {}) => ({
  apply: async ({ transaction, commandId: parentCommandId, commandType, payload, payloadHash, timestamp, actor }) => {
    assertProject(projectId);
    if (actor?.actorRole !== "admin" || String(actor?.actorEmail || "").toLowerCase() !== ADMIN_EMAIL) fail("permission-denied", "Highest administrator authority is required.", "W11_ADMIN_REQUIRED");

    if (commandType === CUTOVER_COMMAND_TYPES.CREATE_PLAN) {
      assertProjectSemesterPair(projectId, payload.sourceSemesterId, payload.targetSemesterId);
      const productionPlan = { ...payload, planId: planIdFor(payload.manifestVersion, payload.sourceSemesterId, payload.targetSemesterId) };
      const approval = await productionApproval.assertProductionCutoverApproval({ transaction, plan: productionPlan, actor, projectId, now, creating: true });
      const [sourceSnapshot, targetSnapshot] = await transaction.getAll([manifestPath(payload.sourceSemesterId), manifestPath(payload.targetSemesterId)]);
      const source = assertManifestRevision(sourceSnapshot, payload.sourceSemesterId, payload.sourceManifestRevision, ["ACTIVE", "CLOSING", "CLOSED", "ARCHIVED"], "Source");
      const target = assertManifestRevision(targetSnapshot, payload.targetSemesterId, payload.targetManifestRevision, ["PREPARING", "READY"], "Target");
      if (["CLOSED", "ARCHIVED", "QUARANTINED"].includes(target.status)) fail("failed-precondition", "Archive or Legacy cannot be a cutover target.", "W11_TARGET_READ_ONLY");
      const planId = planIdFor(payload.manifestVersion, payload.sourceSemesterId, payload.targetSemesterId);
      const path = planPath(planId);
      const [existing, marker] = await transaction.getAll([path, targetPath(payload.targetSemesterId)]);
      if (marker.exists && marker.data?.latestPlanId !== planId) {
        fail("aborted", "Another Cutover Plan already owns this target semester.", "W11_CUTOVER_TARGET_PLAN_CONFLICT", { planId, latestPlanId: marker.data?.latestPlanId || null });
      }
      if (existing.exists) {
        const samePlan = existing.data?.manifestHash === payload.manifestHash
          && existing.data?.sourceSemesterId === payload.sourceSemesterId
          && existing.data?.targetSemesterId === payload.targetSemesterId
          && existing.data?.manifestVersion === payload.manifestVersion;
        fail(samePlan ? "already-exists" : "aborted", samePlan ? "Cutover plan already exists." : "Cutover Manifest changed without a manifestVersion bump.", samePlan ? "W11_PLAN_EXISTS" : "W11_MANIFEST_VERSION_CONFLICT", { planId, existingManifestHash: existing.data?.manifestHash || null, requestedManifestHash: payload.manifestHash });
      }
      const plan = { schemaVersion: CUTOVER_SCHEMA_VERSION, policyVersion: CUTOVER_POLICY_VERSION, planId, planRevision: 1, planType: "CUTOVER", status: "CREATED", manifestVersion: payload.manifestVersion, manifestHash: payload.manifestHash, sourceSemesterId: payload.sourceSemesterId, targetSemesterId: payload.targetSemesterId, sourceManifestRevision: payload.sourceManifestRevision, targetManifestRevision: payload.targetManifestRevision, sourceStatus: source.status, targetStatus: target.status, copyDenylist: payload.copyDenylist, operations: payload.operations, operationCount: payload.operations.length, createdAt: timestamp, createdBy: actor.actorUid, updatedAt: timestamp, updatedBy: actor.actorUid, commandId: parentCommandId, payloadHash };
      if (approval) Object.assign(plan, productionApproval.bindingFor(approval));
      transaction.create(path, plan);
      transaction.set(targetPath(payload.targetSemesterId), { schemaVersion: CUTOVER_SCHEMA_VERSION, policyVersion: CUTOVER_POLICY_VERSION, targetSemesterId: payload.targetSemesterId, latestPlanId: planId, latestAttemptId: null, latestEvidenceId: null, status: "CREATED", manifestHash: payload.manifestHash, updatedAt: timestamp });
      return { target: { kind: "semester-cutover-plan", id: planId, refs: [path, targetPath(payload.targetSemesterId)] }, sourceHash: payload.manifestHash, result: { planId, planRevision: 1, status: "CREATED", attemptId: attemptIdFor(planId), operationCount: payload.operations.length, manifestHash: payload.manifestHash } };
    }

    const plan = await transaction.get(planPath(payload.planId));
    assertRevision(plan, "planRevision", payload.expectedPlanRevision, "W11_PLAN_REVISION_CONFLICT");
    const approvedProductionExecution = await productionApproval.assertProductionCutoverApproval({ transaction, plan: plan.data, actor, projectId, now });
    if (plan.data?.planType !== "CUTOVER") fail("failed-precondition", "Rollback plan is not executable.", "W11_PLAN_TYPE_INVALID");
    assertProjectSemesterPair(projectId, plan.data.sourceSemesterId, plan.data.targetSemesterId);
    await assertLatestTargetMarker(
      transaction,
      plan,
      payload.planId,
      commandType === CUTOVER_COMMAND_TYPES.DRY_RUN ? null : payload.attemptId,
    );
    const [sourceManifest, targetManifest] = await transaction.getAll([manifestPath(plan.data.sourceSemesterId), manifestPath(plan.data.targetSemesterId)]);
    assertManifestRevision(sourceManifest, plan.data.sourceSemesterId, plan.data.sourceManifestRevision, ["ACTIVE", "CLOSING", "CLOSED", "ARCHIVED"], "Source");
    const target = assertManifestRevision(targetManifest, plan.data.targetSemesterId, plan.data.targetManifestRevision, ["PREPARING", "READY"], "Target");
    const operations = Array.isArray(plan.data.operations) ? plan.data.operations : [];

    if (commandType === CUTOVER_COMMAND_TYPES.DRY_RUN) {
      if (!["CREATED", "BLOCKED"].includes(plan.data.status)) fail("failed-precondition", "Plan cannot be dry-run in its current state.", "W11_PLAN_STATE_INVALID");
      const attemptId = attemptIdFor(payload.planId);
      const existingAttempt = await transaction.get(attemptPath(attemptId));
      const rerun = existingAttempt.exists;
      if (rerun) {
        await assertLatestTargetMarker(transaction, plan, payload.planId, attemptId);
        if (
          plan.data.status !== "BLOCKED"
          || existingAttempt.data?.planId !== payload.planId
          || existingAttempt.data?.targetSemesterId !== plan.data.targetSemesterId
          || existingAttempt.data?.status !== "BLOCKED"
        ) {
          fail("failed-precondition", "Only a blocked deterministic attempt can be dry-run again.", "W11_ATTEMPT_STATE_INVALID", { attemptId });
        }
        if (payload.expectedAttemptRevision == null) {
          fail("failed-precondition", "Blocked dry-run retry requires Attempt revision CAS.", "W11_ATTEMPT_REVISION_REQUIRED", { attemptId });
        }
        assertRevision(existingAttempt, "attemptRevision", payload.expectedAttemptRevision, "W11_ATTEMPT_REVISION_CONFLICT");
      } else {
        if (plan.data.status !== "CREATED") fail("failed-precondition", "Blocked plan lost its deterministic attempt.", "W11_ATTEMPT_NOT_FOUND", { attemptId });
        if (payload.expectedAttemptRevision != null) fail("failed-precondition", "Initial dry-run cannot declare an Attempt revision.", "W11_ATTEMPT_REVISION_UNEXPECTED", { attemptId });
      }
      const existingItems = rerun
        ? await transaction.getAll(operations.map((operation) => itemPath(attemptId, operation.operationKey)))
        : [];
      const inspected = await inspectDatasets(transaction, operations, plan.data.sourceSemesterId, plan.data.targetSemesterId);
      const deniedActivitySnapshot = await activitySnapshot(transaction, plan.data.targetSemesterId);
      const activityZero = deniedActivitySnapshot.count === 0 && deniedActivitySnapshot.hash === EMPTY_SNAPSHOT_HASH;
      const results = operations.map((operation) => {
        const actual = inspected[operation.operationKey];
        const sourceMatch = snapshotEqual(actual.source, operation.sourceSnapshot);
        const targetMatch = snapshotEqual(actual.target, operation.targetBeforeSnapshot);
        return { operationKey: operation.operationKey, sourceMatch, targetMatch, actualSource: actual.source, actualTargetBefore: actual.target, status: sourceMatch && targetMatch ? (operation.applicable ? "PENDING" : "NOT_APPLICABLE") : "FAILED", errorReason: sourceMatch && targetMatch ? null : "W11_DRY_RUN_DIFF" };
      });
      const blocked = results.some((result) => result.status === "FAILED") || !activityZero;
      const attemptStatus = blocked ? "BLOCKED" : "DRY_RUN_PASSED";
      const planRevision = payload.expectedPlanRevision + 1;
      const attemptRevision = rerun ? payload.expectedAttemptRevision + 1 : 1;
      const attempt = { schemaVersion: CUTOVER_SCHEMA_VERSION, policyVersion: CUTOVER_POLICY_VERSION, attemptId, attemptRevision, planId: payload.planId, planRevision, manifestHash: plan.data.manifestHash, sourceSemesterId: plan.data.sourceSemesterId, targetSemesterId: plan.data.targetSemesterId, sourceManifestRevision: plan.data.sourceManifestRevision, targetManifestRevision: plan.data.targetManifestRevision, status: attemptStatus, operationCount: operations.length, succeededCount: results.filter((result) => result.status === "NOT_APPLICABLE").length, failedCount: results.filter((result) => result.status === "FAILED").length + (activityZero ? 0 : 1), pendingCount: results.filter((result) => result.status === "PENDING").length, copyDenylist: plan.data.copyDenylist, deniedActivitySnapshot, activityZero, createdAt: rerun ? existingAttempt.data.createdAt : timestamp, createdBy: rerun ? existingAttempt.data.createdBy : actor.actorUid, updatedAt: timestamp };
      if (rerun) transaction.set(attemptPath(attemptId), attempt, { merge: true });
      else transaction.create(attemptPath(attemptId), attempt);
      results.forEach((result, index) => {
        const operation = operations.find((item) => item.operationKey === result.operationKey);
        const existingItem = existingItems[index];
        if (rerun && (!existingItem?.exists || existingItem.data?.planId !== payload.planId || existingItem.data?.operationKey !== result.operationKey)) {
          fail("failed-precondition", "Blocked dry-run item set is incomplete.", "W11_ITEM_SCOPE_MISMATCH", { attemptId, operationKey: result.operationKey });
        }
        const item = { schemaVersion: CUTOVER_SCHEMA_VERSION, policyVersion: CUTOVER_POLICY_VERSION, itemId: itemIdFor(attemptId, result.operationKey), attemptId, planId: payload.planId, ...operation, itemRevision: rerun ? Number(existingItem.data?.itemRevision || 0) + 1 : 1, status: result.status, dryRun: result, receiptId: null, errorCode: result.status === "FAILED" ? "W11_DRY_RUN_DIFF" : null, errorReason: result.errorReason, createdAt: rerun ? existingItem.data.createdAt : timestamp, updatedAt: timestamp };
        if (rerun) transaction.set(existingItem.path, item, { merge: true });
        else transaction.create(itemPath(attemptId, result.operationKey), item);
      });
      transaction.set(planPath(payload.planId), { planRevision, status: attemptStatus, latestAttemptId: attemptId, updatedAt: timestamp, updatedBy: actor.actorUid }, { merge: true });
      transaction.set(targetPath(plan.data.targetSemesterId), { latestAttemptId: attemptId, status: attemptStatus, updatedAt: timestamp }, { merge: true });
      return { target: { kind: "semester-cutover-dry-run", id: attemptId, refs: [attemptPath(attemptId), ...results.map((result) => itemPath(attemptId, result.operationKey))] }, sourceHash: plan.data.manifestHash, result: { planId: payload.planId, planRevision, attemptId, attemptRevision, deterministicAttemptReused: rerun, status: attemptStatus, counts: { total: results.length, pending: results.filter((result) => result.status === "PENDING").length, failed: results.filter((result) => result.status === "FAILED").length + (activityZero ? 0 : 1), notApplicable: results.filter((result) => result.status === "NOT_APPLICABLE").length }, activityZero, deniedActivitySnapshot, items: results } };
    }

    const attempt = await transaction.get(attemptPath(payload.attemptId));
    assertRevision(attempt, "attemptRevision", payload.expectedAttemptRevision, "W11_ATTEMPT_REVISION_CONFLICT");
    if (attempt.data?.planId !== payload.planId || attempt.data?.targetSemesterId !== plan.data.targetSemesterId) fail("failed-precondition", "Attempt does not belong to this plan.", "W11_ATTEMPT_SCOPE_MISMATCH");

    if (commandType === CUTOVER_COMMAND_TYPES.APPLY_BATCH) {
      if (!["DRY_RUN_PASSED", "APPLYING", "PARTIAL"].includes(attempt.data.status)) fail("failed-precondition", "Attempt cannot reconcile child commands.", "W11_ATTEMPT_STATE_INVALID");
      const allItems = await transaction.getAll(operations.map((operation) => itemPath(payload.attemptId, operation.operationKey)));
      if (allItems.some((row, index) => !row.exists || row.data?.planId !== payload.planId || row.data?.attemptId !== payload.attemptId || row.data?.operationKey !== operations[index].operationKey)) fail("failed-precondition", "Cutover item set does not match the Plan and Attempt.", "W11_ITEM_SCOPE_MISMATCH");
      const allItemByKey = new Map(allItems.map((row) => [row.data?.operationKey, row]));
      const itemRows = payload.operationKeys.map((key) => allItemByKey.get(key) || { exists: false, data: null, path: itemPath(payload.attemptId, key) });
      const failureMap = new Map(payload.failures.map((failure) => [failure.operationKey, failure]));
      const receiptPaths = itemRows.map((row) => row.data?.childCommandType ? `${RECEIPT_COLLECTION}/${receiptIdFor(actor.actorUid, row.data.childCommandType, row.data.childCommandId)}` : null);
      const receiptRows = await transaction.getAll(receiptPaths.filter(Boolean));
      const receiptByPath = new Map(receiptRows.map((row) => [row.path, row]));
      const auditPaths = receiptRows.map((row) => `${AUDIT_COLLECTION}/${String(row.path).split("/").at(-1)}`);
      const auditRows = await transaction.getAll(auditPaths);
      const auditByPath = new Map(auditRows.map((row) => [row.path, row]));
      const targetRefPaths = [...new Set(receiptRows.filter((row) => row.exists).flatMap((row) => Array.isArray(row.data?.target?.refs) ? row.data.target.refs : []))];
      const targetRefRows = await transaction.getAll(targetRefPaths);
      const targetDocumentsByPath = new Map(targetRefRows.map((row) => [row.path, row]));
      const nonCommandSnapshots = new Map();
      for (const row of itemRows) {
        if (row.exists && !row.data?.childCommandType && !["SUCCEEDED", "NOT_APPLICABLE"].includes(row.data?.status)) {
          nonCommandSnapshots.set(row.data.operationKey, await inspectOperation(transaction, row.data, plan.data.sourceSemesterId, plan.data.targetSemesterId));
        }
      }
      const results = [];
      for (let index = 0; index < itemRows.length; index += 1) {
        const row = itemRows[index];
        const key = payload.operationKeys[index];
        if (!row.exists || row.data?.operationKey !== key) fail("not-found", "Cutover item was not found.", "W11_ITEM_NOT_FOUND", { operationKey: key });
        if (["SUCCEEDED", "NOT_APPLICABLE"].includes(row.data.status)) {
          if (row.data.status === "SUCCEEDED" && row.data.childCommandType) {
            const receiptId = receiptIdFor(actor.actorUid, row.data.childCommandType, row.data.childCommandId);
            assertReconciledChildReceipt({ receiptId, receipt: receiptByPath.get(`${RECEIPT_COLLECTION}/${receiptId}`), audit: auditByPath.get(`${AUDIT_COLLECTION}/${receiptId}`), operation: row.data, actor, targetSemesterId: plan.data.targetSemesterId, documentsByPath: targetDocumentsByPath, approvedProductionExecution });
          }
          results.push({ operationKey: key, status: row.data.status, replayed: true, receiptId: row.data.receiptId || null }); continue;
        }
        const failure = failureMap.get(key);
        let status = "PENDING"; let receiptId = null; let errorCode = null; let errorReason = null;
        if (row.data.childCommandType) {
          receiptId = receiptIdFor(actor.actorUid, row.data.childCommandType, row.data.childCommandId);
          const receipt = receiptByPath.get(`${RECEIPT_COLLECTION}/${receiptId}`);
          if (receipt?.exists) {
            assertReconciledChildReceipt({ receiptId, receipt, audit: auditByPath.get(`${AUDIT_COLLECTION}/${receiptId}`), operation: row.data, actor, targetSemesterId: plan.data.targetSemesterId, documentsByPath: targetDocumentsByPath, approvedProductionExecution });
            status = "SUCCEEDED";
          } else if (failure) { status = "FAILED"; errorCode = failure.errorCode; errorReason = failure.errorReason; }
        } else {
          const inspected = nonCommandSnapshots.get(key);
          status = snapshotEqual(inspected.target, row.data.targetAfterSnapshot) ? "SUCCEEDED" : failure ? "FAILED" : "PENDING";
          errorCode = status === "FAILED" ? failure.errorCode : null;
          errorReason = status === "FAILED" ? failure.errorReason : null;
        }
        transaction.set(row.path, { itemRevision: Number(row.data.itemRevision || 0) + 1, status, receiptId: status === "SUCCEEDED" ? receiptId : null, errorCode, errorReason, updatedAt: timestamp }, { merge: true });
        results.push({ operationKey: key, status, replayed: false, receiptId: status === "SUCCEEDED" ? receiptId : null, errorCode, errorReason });
      }
      const statusByKey = new Map(results.map((result) => [result.operationKey, result.status]));
      const statuses = allItems.map((row) => statusByKey.get(row.data?.operationKey) || row.data?.status);
      const counts = { total: statuses.length, succeeded: statuses.filter((status) => status === "SUCCEEDED").length, failed: statuses.filter((status) => status === "FAILED").length, pending: statuses.filter((status) => status === "PENDING").length, notApplicable: statuses.filter((status) => status === "NOT_APPLICABLE").length };
      const attemptStatus = counts.pending ? (counts.failed ? "PARTIAL" : "APPLYING") : counts.failed ? "PARTIAL" : "APPLIED";
      const attemptRevision = payload.expectedAttemptRevision + 1;
      const planRevision = payload.expectedPlanRevision + 1;
      transaction.set(attemptPath(payload.attemptId), { attemptRevision, status: attemptStatus, ...Object.fromEntries(Object.entries(counts).map(([key, value]) => [`${key}Count`, value])), updatedAt: timestamp }, { merge: true });
      transaction.set(planPath(payload.planId), { planRevision, status: attemptStatus, updatedAt: timestamp, updatedBy: actor.actorUid }, { merge: true });
      transaction.set(targetPath(plan.data.targetSemesterId), { status: attemptStatus, updatedAt: timestamp }, { merge: true });
      return { target: { kind: "semester-cutover-apply", id: payload.attemptId, refs: [attemptPath(payload.attemptId), ...itemRows.map((row) => row.path)] }, sourceHash: plan.data.manifestHash, result: { planId: payload.planId, planRevision, attemptId: payload.attemptId, attemptRevision, status: attemptStatus, counts, items: results, canonicalBusinessWriteCount: 0 } };
    }

    if (commandType === CUTOVER_COMMAND_TYPES.RESUME) {
      if (!["PARTIAL", "FAILED", "APPLYING"].includes(attempt.data.status)) fail("failed-precondition", "Attempt cannot be resumed.", "W11_ATTEMPT_STATE_INVALID");
      if (new Set(payload.operationKeys).size !== payload.operationKeys.length) fail("invalid-argument", "operationKeys contains duplicates.", "W11_OPERATION_DUPLICATE");
      const items = await transaction.getAll(payload.operationKeys.map((key) => itemPath(payload.attemptId, key)));
      items.forEach((row, index) => { if (!row.exists || !["FAILED", "PENDING"].includes(row.data?.status)) fail("failed-precondition", "Only failed or pending items can be resumed.", "W11_RESUME_ITEM_INVALID", { operationKey: payload.operationKeys[index] }); });
      items.forEach((row) => transaction.set(row.path, { itemRevision: Number(row.data.itemRevision || 0) + 1, status: "PENDING", errorCode: null, errorReason: null, resumeReason: payload.reason, updatedAt: timestamp }, { merge: true }));
      const attemptRevision = payload.expectedAttemptRevision + 1; const planRevision = payload.expectedPlanRevision + 1;
      transaction.set(attemptPath(payload.attemptId), { attemptRevision, status: "APPLYING", resumedAt: timestamp, resumeReason: payload.reason, updatedAt: timestamp }, { merge: true });
      transaction.set(planPath(payload.planId), { planRevision, status: "APPLYING", updatedAt: timestamp, updatedBy: actor.actorUid }, { merge: true });
      transaction.set(targetPath(plan.data.targetSemesterId), { status: "APPLYING", updatedAt: timestamp }, { merge: true });
      return { target: { kind: "semester-cutover-resume", id: payload.attemptId, refs: [attemptPath(payload.attemptId), ...items.map((row) => row.path)] }, sourceHash: sha256(payload.reason), result: { planId: payload.planId, planRevision, attemptId: payload.attemptId, attemptRevision, status: "APPLYING", resumedOperationKeys: payload.operationKeys, childCommandIds: items.map((row) => row.data.childCommandId).filter(Boolean), successfulItemEffectCount: 0 } };
    }

    if (commandType === CUTOVER_COMMAND_TYPES.VERIFY) {
      if (attempt.data.status !== "APPLIED") fail("failed-precondition", "Only an applied attempt can be verified.", "W11_ATTEMPT_STATE_INVALID");
      const items = await transaction.getAll(operations.map((operation) => itemPath(payload.attemptId, operation.operationKey)));
      if (items.some((row) => !row.exists || !["SUCCEEDED", "NOT_APPLICABLE"].includes(row.data?.status))) fail("failed-precondition", "Every applicable Cutover item must succeed.", "W11_ITEMS_NOT_COMPLETE");
      const snapshots = await inspectDatasets(transaction, operations, plan.data.sourceSemesterId, plan.data.targetSemesterId); const diffs = [];
      for (const operation of operations) {
        const inspected = snapshots[operation.operationKey];
        const sourceMatch = snapshotEqual(inspected.source, operation.sourceSnapshot);
        const targetMatch = snapshotEqual(inspected.target, operation.targetAfterSnapshot);
        diffs.push({ operationKey: operation.operationKey, expectedSource: operation.sourceSnapshot, actualSource: inspected.source, expectedTarget: operation.targetAfterSnapshot, actualTarget: inspected.target, sourceStatus: sourceMatch ? "PASS" : "FAIL", targetStatus: targetMatch ? "PASS" : "FAIL", status: sourceMatch && targetMatch ? "PASS" : "FAIL" });
      }
      if (diffs.some((diff) => diff.status === "FAIL")) fail("failed-precondition", "Cutover verification found an exact diff.", "W11_VERIFY_DIFF", { diffs: diffs.filter((diff) => diff.status === "FAIL") });
      const deniedActivitySnapshot = await activitySnapshot(transaction, plan.data.targetSemesterId);
      if (deniedActivitySnapshot.count !== 0 || deniedActivitySnapshot.hash !== EMPTY_SNAPSHOT_HASH) fail("failed-precondition", "Denied activity exists in the target semester.", "W11_ACTIVITY_ZERO_REQUIRED", { deniedActivitySnapshot });
      const dependencyHash = dependencyHashFor(operations, snapshots, deniedActivitySnapshot);
      const evidenceId = evidenceIdFor(payload.attemptId, dependencyHash);
      const evidence = { schemaVersion: CUTOVER_SCHEMA_VERSION, policyVersion: CUTOVER_POLICY_VERSION, evidenceId, planId: payload.planId, attemptId: payload.attemptId, manifestHash: plan.data.manifestHash, sourceSemesterId: plan.data.sourceSemesterId, targetSemesterId: plan.data.targetSemesterId, sourceManifestRevision: plan.data.sourceManifestRevision, targetManifestRevision: plan.data.targetManifestRevision, sourceStatus: sourceManifest.data?.status, targetStatus: target.status, dependencyHash, status: "PASS", copyDenylist: plan.data.copyDenylist, deniedActivitySnapshot, activityZero: true, diffs, verifiedAt: timestamp, verifiedBy: actor.actorUid };
      transaction.create(evidencePath(evidenceId), evidence);
      const attemptRevision = payload.expectedAttemptRevision + 1; const planRevision = payload.expectedPlanRevision + 1;
      transaction.set(attemptPath(payload.attemptId), { attemptRevision, status: "VERIFIED", dependencyHash, evidenceId, verifiedAt: timestamp, updatedAt: timestamp }, { merge: true });
      transaction.set(planPath(payload.planId), { planRevision, status: "VERIFIED", dependencyHash, evidenceId, updatedAt: timestamp, updatedBy: actor.actorUid }, { merge: true });
      transaction.set(targetPath(plan.data.targetSemesterId), { latestEvidenceId: evidenceId, status: "VERIFIED", dependencyHash, targetManifestRevision: plan.data.targetManifestRevision, updatedAt: timestamp }, { merge: true });
      return { target: { kind: "semester-cutover-verification", id: evidenceId, refs: [evidencePath(evidenceId), attemptPath(payload.attemptId), planPath(payload.planId)] }, sourceHash: dependencyHash, result: { planId: payload.planId, planRevision, attemptId: payload.attemptId, attemptRevision, evidenceId, status: "VERIFIED", dependencyHash, diffs, pointerMutationCount: 0, activationMutationCount: 0 } };
    }

    if (commandType === CUTOVER_COMMAND_TYPES.CREATE_ROLLBACK_PLAN) {
      if (!["APPLIED", "VERIFIED", "PARTIAL", "FAILED"].includes(attempt.data.status)) fail("failed-precondition", "Attempt does not have rollback-relevant effects.", "W11_ATTEMPT_STATE_INVALID");
      if (!["PREPARING", "READY"].includes(target.status)) fail("failed-precondition", "An active or archived target cannot use the W11 rollback plan.", "W11_ROLLBACK_RESTORE_REQUIRED");
      const rollbackPlanId = rollbackPlanIdFor(payload.planId, payload.attemptId);
      const rollbackPath = planPath(rollbackPlanId);
      if ((await transaction.get(rollbackPath)).exists) fail("already-exists", "Rollback plan already exists.", "W11_ROLLBACK_PLAN_EXISTS", { rollbackPlanId });
      const itemRows = await transaction.getAll(operations.map((operation) => itemPath(payload.attemptId, operation.operationKey)));
      if (itemRows.some((row) => !row.exists || row.data?.planId !== payload.planId || row.data?.attemptId !== payload.attemptId)) fail("failed-precondition", "Rollback item set does not match the Cutover Attempt.", "W11_ITEM_SCOPE_MISMATCH");
      const succeededItems = itemRows
        .filter((row) => row.data?.status === "SUCCEEDED")
        .sort((left, right) => Number(right.data?.operationOrder || 0) - Number(left.data?.operationOrder || 0));
      if (succeededItems.length === 0) fail("failed-precondition", "No succeeded Cutover item requires compensation.", "W11_ROLLBACK_NOT_REQUIRED");
      const receiptIds = succeededItems
        .filter((row) => row.data?.childCommandType)
        .map((row) => receiptIdFor(actor.actorUid, row.data.childCommandType, row.data.childCommandId));
      const receiptRows = await transaction.getAll(receiptIds.map((receiptId) => `${RECEIPT_COLLECTION}/${receiptId}`));
      const auditRows = await transaction.getAll(receiptIds.map((receiptId) => `${AUDIT_COLLECTION}/${receiptId}`));
      const receiptById = new Map(receiptRows.map((row) => [String(row.path).split("/").at(-1), row]));
      const auditById = new Map(auditRows.map((row) => [String(row.path).split("/").at(-1), row]));
      const targetRefs = [...new Set(receiptRows.filter((row) => row.exists).flatMap((row) => Array.isArray(row.data?.target?.refs) ? row.data.target.refs : []))];
      const targetDocuments = await transaction.getAll(targetRefs);
      const targetDocumentsByPath = new Map(targetDocuments.map((row) => [row.path, row]));
      const steps = succeededItems.map((row, index) => {
        const operation = row.data;
        const receiptId = operation.childCommandType
          ? receiptIdFor(actor.actorUid, operation.childCommandType, operation.childCommandId)
          : null;
        const receipt = receiptId ? receiptById.get(receiptId) : null;
        if (receiptId) {
          assertReconciledChildReceipt({ receiptId, receipt, audit: auditById.get(receiptId), operation, actor, targetSemesterId: plan.data.targetSemesterId, documentsByPath: targetDocumentsByPath, approvedProductionExecution });
          if (operation.receiptId !== receiptId) fail("failed-precondition", "Succeeded item receipt reference changed.", "W11_CHILD_RECEIPT_MISMATCH", { operationKey: operation.operationKey });
        }
        const refs = receiptId && Array.isArray(receipt.data?.target?.refs) ? receipt.data.target.refs : [];
        const targetPreconditions = refs.map((ref) => {
          const document = targetDocumentsByPath.get(ref);
          if (!document?.exists) fail("failed-precondition", "Rollback target document is missing.", "W11_ROLLBACK_TARGET_MISSING", { operationKey: operation.operationKey, ref });
          const revision = revisionEvidenceFor(document);
          return revision
            ? { ref, kind: "REVISION", revisionField: revision.field, expectedRevision: revision.value }
            : { ref, kind: "DOCUMENT_HASH", expectedHash: sha256(canonicalJson(document.data)) };
        });
        const expectedTargetRevisions = targetPreconditions
          .filter((precondition) => precondition.kind === "REVISION")
          .map(({ ref, revisionField, expectedRevision }) => ({ ref, revisionField, expectedRevision }));
        const noAction = operation.strategy === "REFERENCE" || operation.strategy === "VALIDATE_ONLY" || operation.strategy === "ZERO_ASSERTION";
        return {
          order: index + 1,
          operationKey: operation.operationKey,
          operationType: operation.operationType,
          disposition: noAction ? "NO_ACTION" : "DOMAIN_COMPENSATION_REQUIRED",
          automaticMutation: false,
          receiptId,
          targetRefs: refs,
          expectedTargetRevisions,
          targetPreconditions,
          compensationBasis: receiptId
            ? { type: "SUCCEEDED_COMMAND_RECEIPT", payloadHash: receipt.data.payloadHash, sourceHash: receipt.data.sourceHash, auditEventId: receipt.data.audit.eventId }
            : { type: "VERIFIED_TARGET_SNAPSHOT", targetAfterSnapshot: operation.targetAfterSnapshot },
        };
      });
      transaction.create(rollbackPath, { schemaVersion: CUTOVER_SCHEMA_VERSION, policyVersion: CUTOVER_POLICY_VERSION, planId: rollbackPlanId, planRevision: 1, planType: "ROLLBACK_PLAN_ONLY", status: "ROLLBACK_PLANNED", parentPlanId: payload.planId, attemptId: payload.attemptId, sourceSemesterId: plan.data.sourceSemesterId, targetSemesterId: plan.data.targetSemesterId, reason: payload.reason, steps, createdAt: timestamp, createdBy: actor.actorUid });
      const attemptRevision = payload.expectedAttemptRevision + 1; const planRevision = payload.expectedPlanRevision + 1;
      transaction.set(attemptPath(payload.attemptId), { attemptRevision, status: "ROLLBACK_PLANNED", rollbackPlanId, updatedAt: timestamp }, { merge: true });
      transaction.set(planPath(payload.planId), { planRevision, status: "ROLLBACK_PLANNED", rollbackPlanId, updatedAt: timestamp, updatedBy: actor.actorUid }, { merge: true });
      transaction.set(targetPath(plan.data.targetSemesterId), { status: "ROLLBACK_PLANNED", updatedAt: timestamp }, { merge: true });
      return { target: { kind: "semester-cutover-rollback-plan", id: rollbackPlanId, refs: [rollbackPath, attemptPath(payload.attemptId)] }, sourceHash: sha256(payload.reason), result: { planId: payload.planId, planRevision, attemptId: payload.attemptId, attemptRevision, rollbackPlanId, status: "ROLLBACK_PLANNED", steps, canonicalBusinessWriteCount: 0, pointerMutationCount: 0, activationMutationCount: 0 } };
    }
    fail("invalid-argument", "Unsupported W11 command.", "W11_COMMAND_UNSUPPORTED");
  },
});

const normalizeQuery = (raw) => {
  allowed(raw, ["targetSemesterId", "planId", "attemptId", "_session"], "getSemesterCutoverState payload");
  return { targetSemesterId: semesterId(raw.targetSemesterId), planId: raw.planId ? text(raw.planId, "planId", 80) : null, attemptId: raw.attemptId ? text(raw.attemptId, "attemptId", 80) : null };
};
const isVisualFixtureAdminReadIdentity = ({ request, identity, projectId }) => {
  const token = request.auth?.token || {};
  return String(projectId || "").trim() === STAGING_PROJECT_ID
    && String(request.data?.targetSemesterId || "").trim() === VISUAL_FIXTURE_TARGET_SEMESTER_ID
    && String(request.auth?.uid || "").trim() === VISUAL_FIXTURE_ADMIN_UID
    && String(identity?.uid || "").trim() === VISUAL_FIXTURE_ADMIN_UID
    && String(identity?.email || "").trim().toLowerCase() === VISUAL_FIXTURE_ADMIN_EMAIL
    && String(token.email || "").trim().toLowerCase() === VISUAL_FIXTURE_ADMIN_EMAIL
    && token.fixtureOwner === VISUAL_FIXTURE_OWNER
    && token.fixtureId === VISUAL_FIXTURE_ID
    && token.fixtureRole === "admin";
};
const assertVisualFixtureAdminReadMarker = async (transaction) => {
  const marker = await transaction.get(VISUAL_FIXTURE_RUN_PATH);
  const data = marker.data || {};
  if (!marker.exists
    || data.status !== "READY"
    || data.projectId !== STAGING_PROJECT_ID
    || data.fixtureOwner !== VISUAL_FIXTURE_OWNER
    || data.fixtureId !== VISUAL_FIXTURE_ID
    || data.fixtureRevision !== 1
    || data.planHash !== VISUAL_FIXTURE_PLAN_HASH) {
    fail("permission-denied", "Highest administrator authority is required.", "W11_ADMIN_REQUIRED");
  }
};
const visualFixtureEmptyState = () => ({
  schemaVersion: CUTOVER_SCHEMA_VERSION,
  policyVersion: CUTOVER_POLICY_VERSION,
  targetSemesterId: VISUAL_FIXTURE_TARGET_SEMESTER_ID,
  manifestRevision: 0,
  manifestStatus: null,
  provenance: "EXPLICIT",
  readOnly: true,
  status: "EMPTY",
  pointer: null,
  plan: null,
  attempt: null,
  items: [],
  evidence: null,
  suggestedPlan: null,
  suggestedPlanUnavailableReason: "VISUAL_FIXTURE_READ_ONLY_EMPTY",
  suggestedPlanScanEvidence: null,
  contract: {
    manifestVersion: CUTOVER_POLICY_VERSION,
    operationTypes: Object.keys(OPERATION_DEFINITIONS),
    copyDenylist: COPY_DENYLIST,
    maxOperations: MAX_OPERATIONS,
    applyBatchLimit: APPLY_BATCH_LIMIT,
    snapshotRowLimits: SNAPSHOT_ROW_LIMITS,
    snapshotByteLimit: SNAPSHOT_TOTAL_BYTE_LIMIT,
    snapshotTransactionByteLimit: SNAPSHOT_TRANSACTION_BYTE_LIMIT,
    executionModel: "ALLOWLISTED_DOMAIN_COMMAND_RECEIPT_RECONCILIATION",
    suggestedPlanPolicy: "APPROVED_AUTHENTICATED_RUNNER_ONLY",
  },
  activationControlsAvailable: false,
  productionControlsAvailable: false,
  writeCount: 0,
});
const createSemesterCutoverQueryCore = ({ store, projectId = "", assertSession = sessionAuthority.assertActiveApplicationSession } = {}) => ({
  getSemesterCutoverState: async (request) => {
    assertProject(projectId);
    const identity = await assertSession(request, { recentAuth: false, highRisk: false });
    const email = String(identity?.email || request.auth?.token?.email || "").trim().toLowerCase();
    const fixtureAdminRead = isVisualFixtureAdminReadIdentity({ request, identity, projectId });
    if (email !== ADMIN_EMAIL && !fixtureAdminRead) fail("permission-denied", "Highest administrator authority is required.", "W11_ADMIN_REQUIRED");
    const query = normalizeQuery(request.data || {});
    if (fixtureAdminRead && (query.planId || query.attemptId)) fail("permission-denied", "Highest administrator authority is required.", "W11_ADMIN_REQUIRED");
    return store.runTransaction(async (transaction) => {
      if (fixtureAdminRead) {
        await assertVisualFixtureAdminReadMarker(transaction);
        return visualFixtureEmptyState();
      }
      const pointer = await transaction.get(targetPath(query.targetSemesterId));
      const planId = query.planId || pointer.data?.latestPlanId || null;
      const attemptId = query.attemptId || pointer.data?.latestAttemptId || null;
      const [manifest, plan, attempt] = await transaction.getAll([manifestPath(query.targetSemesterId), planId ? planPath(planId) : "semester_cutover_plans/missing-plan", attemptId ? attemptPath(attemptId) : "semester_cutover_attempts/missing-attempt"]);
      if (plan.exists && plan.data?.targetSemesterId !== query.targetSemesterId) fail("failed-precondition", "Plan does not match target semester.", "W11_PLAN_SCOPE_MISMATCH");
      if (attempt.exists && attempt.data?.planId !== planId) fail("failed-precondition", "Attempt does not match Plan.", "W11_ATTEMPT_SCOPE_MISMATCH");
      const operations = Array.isArray(plan.data?.operations) ? plan.data.operations : [];
      const items = attempt.exists ? await transaction.getAll(operations.map((operation) => itemPath(attemptId, operation.operationKey))) : [];
      const evidence = pointer.data?.latestEvidenceId ? await transaction.get(evidencePath(pointer.data.latestEvidenceId)) : { exists: false, data: null };
      const readOnly = !manifest.exists || !["PREPARING", "READY"].includes(manifest.data?.status);
      let suggestedPlan = null;
      let suggestedPlanUnavailableReason = "CANONICAL_TARGET_QUERY_ONLY";
      let suggestedPlanScanEvidence = null;
      if (query.targetSemesterId === REHEARSAL_TARGET_SEMESTER_ID && !plan.exists) {
        const sourceManifest = await transaction.get(manifestPath(REHEARSAL_SOURCE_SEMESTER_ID));
        if (!sourceManifest.exists || !manifest.exists) suggestedPlanUnavailableReason = "REHEARSAL_MANIFESTS_REQUIRED";
        else if (!["ACTIVE", "CLOSING", "CLOSED", "ARCHIVED"].includes(sourceManifest.data?.status) || !["PREPARING", "READY"].includes(manifest.data?.status)) suggestedPlanUnavailableReason = "REHEARSAL_LIFECYCLE_INVALID";
        else {
          const templateOperations = Object.keys(OPERATION_DEFINITIONS).map((operationType, index) => ({ operationKey: `suggested-${String(index + 1).padStart(2, "0")}`, operationOrder: index + 1, operationType, applicable: false }));
          const inspected = await inspectDatasets(transaction, templateOperations, REHEARSAL_SOURCE_SEMESTER_ID, REHEARSAL_TARGET_SEMESTER_ID);
          suggestedPlanScanEvidence = templateOperations.map((operation) => ({
            operationType: operation.operationType,
            source: inspected[operation.operationKey].source,
            target: inspected[operation.operationKey].target,
          }));
          suggestedPlanUnavailableReason = "APPROVED_CHILD_COMMAND_BLUEPRINT_REQUIRED";
        }
      } else if (plan.exists) suggestedPlanUnavailableReason = "PLAN_ALREADY_EXISTS";
      return { schemaVersion: CUTOVER_SCHEMA_VERSION, policyVersion: CUTOVER_POLICY_VERSION, targetSemesterId: query.targetSemesterId, manifestRevision: Number(manifest.data?.revision || 0), manifestStatus: manifest.data?.status || null, provenance: manifest.exists ? semesterCore.provenanceForStatus(manifest.data?.status) : "EXPLICIT", readOnly, status: !plan.exists ? "EMPTY" : plan.data?.status || "CONTENT", pointer: pointer.exists ? pointer.data : null, plan: plan.exists ? plan.data : null, attempt: attempt.exists ? attempt.data : null, items: items.filter((row) => row.exists).map((row) => row.data), evidence: evidence.exists ? evidence.data : null, suggestedPlan, suggestedPlanUnavailableReason, suggestedPlanScanEvidence, contract: { manifestVersion: CUTOVER_POLICY_VERSION, operationTypes: Object.keys(OPERATION_DEFINITIONS), copyDenylist: COPY_DENYLIST, maxOperations: MAX_OPERATIONS, applyBatchLimit: APPLY_BATCH_LIMIT, snapshotRowLimits: SNAPSHOT_ROW_LIMITS, snapshotByteLimit: SNAPSHOT_TOTAL_BYTE_LIMIT, snapshotTransactionByteLimit: SNAPSHOT_TRANSACTION_BYTE_LIMIT, executionModel: "ALLOWLISTED_DOMAIN_COMMAND_RECEIPT_RECONCILIATION", suggestedPlanPolicy: "APPROVED_AUTHENTICATED_RUNNER_ONLY" }, activationControlsAvailable: false, productionControlsAvailable: false, writeCount: 0 };
    });
  },
});
const createSemesterCutoverCallableExports = ({ core }) => ({ getSemesterCutoverState: onCall({ region: REGION }, (request) => core.getSemesterCutoverState(request)) });

const createSemesterCutoverReadinessAdapter = ({ projectId = productionApproval.resolveProjectId(), now = () => new Date() } = {}) => ({
  evaluate: async ({ transaction, manifest }) => {
    if (!["PREPARING", "VALIDATING", "READY"].includes(manifest?.status)) return [{ checkId: READINESS_CHECK_ID, label: "Semester cutover readiness", category: "CUTOVER", required: true, status: "PASS", evidence: `applicability=NOT_APPLICABLE; semesterStatus=${manifest?.status || "UNKNOWN"}`, failureReason: null, ownerWave: "W11" }];
    if (manifest?.cutoverApplicability === "NOT_APPLICABLE" && projectId !== productionApproval.PRODUCTION_PROJECT_ID) return [{ checkId: READINESS_CHECK_ID, label: "Semester cutover readiness", category: "CUTOVER", required: true, status: "PASS", evidence: "applicability=NOT_APPLICABLE; source=EXPLICIT_STORED_FIXTURE", failureReason: null, ownerWave: "W11" }];
    const pointer = await transaction.get(targetPath(manifest.semesterId));
    if (!pointer.exists || pointer.data?.status !== "VERIFIED" || !pointer.data?.latestPlanId || !pointer.data?.latestAttemptId || !pointer.data?.latestEvidenceId) return [{ checkId: READINESS_CHECK_ID, label: "Semester cutover readiness", category: "CUTOVER", required: true, status: "FAIL", evidence: "applicability=APPLICABLE; verifiedEvidence=missing", failureReason: "SEMESTER_CUTOVER_NOT_VERIFIED", ownerWave: "W11" }];
    const [plan, attempt, evidence] = await transaction.getAll([planPath(pointer.data.latestPlanId), attemptPath(pointer.data.latestAttemptId), evidencePath(pointer.data.latestEvidenceId)]);
    let current = plan.exists && attempt.exists && evidence.exists && plan.data?.status === "VERIFIED" && attempt.data?.status === "VERIFIED" && evidence.data?.status === "PASS" && plan.data?.manifestHash === evidence.data?.manifestHash && Number(plan.data?.targetManifestRevision || 0) === Number(manifest.revision || 0) && Number(evidence.data?.targetManifestRevision || 0) === Number(manifest.revision || 0);
    let dependencyHash = null;
    if (current) {
      try {
        await productionApproval.assertProductionCutoverApproval({ transaction, plan: plan.data, projectId, now });
      } catch (error) {
        if (!String(error?.details?.reason || "").startsWith("PRODUCTION_CUTOVER_")) throw error;
        return [{ checkId: READINESS_CHECK_ID, label: "Semester cutover readiness", category: "CUTOVER", required: true, status: "FAIL", evidence: "applicability=APPLICABLE; productionApproval=invalid", failureReason: error.details.reason, ownerWave: "W11" }];
      }
    }
    if (current) {
      const snapshots = await inspectDatasets(transaction, plan.data.operations || [], plan.data.sourceSemesterId, plan.data.targetSemesterId);
      const deniedActivitySnapshot = await activitySnapshot(transaction, plan.data.targetSemesterId);
      dependencyHash = dependencyHashFor(plan.data.operations || [], snapshots, deniedActivitySnapshot);
      current = dependencyHash === evidence.data?.dependencyHash && deniedActivitySnapshot.count === 0 && deniedActivitySnapshot.hash === EMPTY_SNAPSHOT_HASH;
    }
    return [{ checkId: READINESS_CHECK_ID, label: "Semester cutover readiness", category: "CUTOVER", required: true, status: current ? "PASS" : "FAIL", evidence: `applicability=APPLICABLE; planId=${pointer.data.latestPlanId}; attemptId=${pointer.data.latestAttemptId}; evidenceId=${pointer.data.latestEvidenceId}; dependency=${dependencyHash || "unavailable"}`, failureReason: current ? null : "SEMESTER_CUTOVER_EVIDENCE_STALE", ownerWave: "W11" }];
  },
});

const getSemesterCutoverCommandSessionOptions = () => ({ recentAuth: true, highRisk: true });

module.exports = {
  ACTIVITY_COLLECTIONS,
  APPLY_BATCH_LIMIT,
  ATTEMPT_STATUSES,
  CUTOVER_ATTEMPT_COLLECTION,
  CUTOVER_COMMAND_TYPES,
  CUTOVER_EVIDENCE_COLLECTION,
  CUTOVER_PLAN_COLLECTION,
  CUTOVER_POLICY_VERSION,
  CUTOVER_SCHEMA_VERSION,
  CUTOVER_TARGET_COLLECTION,
  COPY_DENYLIST,
  EMPTY_SNAPSHOT_HASH,
  ITEM_STATUSES,
  MAX_OPERATIONS,
  OPERATION_DEFINITIONS,
  PLAN_STATUSES,
  READINESS_CHECK_ID,
  RECEIPT_TARGET_POLICY,
  SNAPSHOT_ROW_LIMITS,
  SNAPSHOT_TOTAL_BYTE_LIMIT,
  SNAPSHOT_TRANSACTION_BYTE_LIMIT,
  attemptIdFor,
  assertProjectSemesterPair,
  assertReceiptAuditAuthoritySummary,
  assertReceiptTargetScope,
  assertCutoverProject,
  computeManifestHash,
  createSemesterCutoverCallableExports,
  createSemesterCutoverCommandAdapter,
  createSemesterCutoverQueryCore,
  createSemesterCutoverReadinessAdapter,
  getSemesterCutoverCommandSessionOptions,
  itemIdFor,
  normalizeCutoverPayload,
  planIdFor,
  receiptIdFor,
  snapshotFromRows,
};
