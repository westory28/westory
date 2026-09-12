const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const {
  onCallWithStudentMaintenance: onCall,
} = require("./studentMaintenance");

const sessionAuthority = require("./sessionAuthority");
const semesterCore = require("./semesterCore");
const cutoverAuthorization = require("./cutoverAuthorization");

const REGION = "asia-northeast3";
const ADMIN_EMAIL = "westoria28@gmail.com";
const STAGING_PROJECT_ID = "westory-staging-177587430482";
const W4_SCHEMA_VERSION = 1;
const W4_READINESS_REGISTRY_VERSION = "w4-v1";
const WRITE_FENCE_VERSION = "w4-v1";

const STUDENT_IDENTITY_COLLECTION = "student_identities";
const SEMESTER_CLASS_COLLECTION = "semester_classes";
const SEMESTER_ENROLLMENT_COLLECTION = "semester_enrollments";
const ENROLLMENT_SLOT_COLLECTION = "semester_enrollment_slots";
const ROSTER_IMPORT_COLLECTION = "enrollment_roster_imports";
const ARCHIVE_MANIFEST_COLLECTION = "semester_archive_manifests";
const CUTOVER_TARGET_COLLECTION = "semester_cutover_targets";
const CUTOVER_PLAN_COLLECTION = "semester_cutover_plans";
const CUTOVER_ATTEMPT_COLLECTION = "semester_cutover_attempts";
const CUTOVER_EVIDENCE_COLLECTION = "semester_cutover_evidence";
const CUTOVER_SCHEMA_VERSION = 1;
const CUTOVER_POLICY_VERSION = "w11-v1";

const ARCHIVE_ENROLLMENT_COMMAND_TYPES = Object.freeze({
  CREATE_SEMESTER_CLASS: "createSemesterClass",
  UPDATE_SEMESTER_CLASS: "updateSemesterClass",
  IMPORT_ENROLLMENT_ROSTER: "importEnrollmentRoster",
  UPSERT_ENROLLMENT: "upsertEnrollment",
  MOVE_ENROLLMENT: "moveEnrollment",
  CLOSE_ENROLLMENT: "closeEnrollment",
  PREPARE_SEMESTER_ARCHIVE: "prepareSemesterArchive",
  FREEZE_SEMESTER_ARCHIVE: "freezeSemesterArchive",
});

const ENROLLMENT_STATUSES = Object.freeze([
  "PENDING",
  "ACTIVE",
  "TRANSFERRED",
  "WITHDRAWN",
  "COMPLETED",
]);

const fail = (code, message, reason, details = {}) => {
  throw new HttpsError(code, message, { reason, ...details });
};

const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");

const isPlainObject = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertAllowedKeys = (value, allowedKeys, label) => {
  if (!isPlainObject(value)) {
    fail(
      "invalid-argument",
      `${label} must be an object.`,
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  const unexpected = Object.keys(value).filter(
    (key) => !allowedKeys.includes(key),
  );
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
    fail(
      "invalid-argument",
      `${label} must be a string.`,
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maxLength) {
    fail(
      "invalid-argument",
      `${label} must contain between 1 and ${maxLength} characters.`,
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  return normalized;
};

const normalizeOptionalString = (value, label, maxLength) => {
  if (value === undefined || value === null || value === "") return null;
  return requireTrimmedString(value, label, maxLength);
};

const normalizeUid = (value, label = "studentUid") => {
  const uid = requireTrimmedString(value, label, 160);
  if (uid.includes("/")) {
    fail("invalid-argument", `${label} is invalid.`, "COMMAND_PAYLOAD_INVALID");
  }
  return uid;
};

const normalizeExpectedRevision = (value, label = "expectedRevision") => {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(
      "invalid-argument",
      `${label} must be a positive safe integer.`,
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  return value;
};

const normalizeDate = (value, label) => {
  const normalized = requireTrimmedString(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    fail(
      "invalid-argument",
      `${label} must use YYYY-MM-DD.`,
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== normalized
  ) {
    fail(
      "invalid-argument",
      `${label} is not a real date.`,
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  return normalized;
};

const normalizeClassPart = (value, label) => {
  const normalized = requireTrimmedString(value, label, 40).normalize("NFKC");
  if (!/^[\p{L}\p{N}_. -]+$/u.test(normalized)) {
    fail(
      "invalid-argument",
      `${label} contains unsupported characters.`,
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  return normalized;
};

const normalizeStudentNumber = (value) => {
  const normalized = requireTrimmedString(
    String(value ?? ""),
    "studentNumber",
    12,
  );
  if (!/^[\p{L}\p{N}-]+$/u.test(normalized)) {
    fail(
      "invalid-argument",
      "studentNumber is invalid.",
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  return normalized;
};

const normalizeSha256 = (value, label) => {
  const normalized = requireTrimmedString(value, label, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    fail(
      "invalid-argument",
      `${label} must be a SHA-256 hash.`,
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  return normalized;
};

const canonicalize = (value) => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(
        "invalid-argument",
        "Payload contains an invalid number.",
        "COMMAND_PAYLOAD_INVALID",
      );
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!isPlainObject(value)) {
    fail(
      "invalid-argument",
      "Payload must contain JSON-compatible values.",
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
};

const buildClassKey = (grade, classNumber) =>
  `${grade.normalize("NFKC").toLowerCase()}::${classNumber.normalize("NFKC").toLowerCase()}`;

const buildClassId = (semesterId, grade, classNumber) =>
  `class_${sha256(`${semesterId}\n${buildClassKey(grade, classNumber)}`).slice(0, 32)}`;

const buildEnrollmentSlotId = (semesterId, studentUid) =>
  `slot_${sha256(`${semesterId}\n${studentUid}`).slice(0, 40)}`;

const buildEnrollmentId = ({
  semesterId,
  studentUid,
  classId,
  effectiveFrom,
  discriminator,
}) =>
  `enr_${sha256(
    `${semesterId}\n${studentUid}\n${classId}\n${effectiveFrom}\n${discriminator}`,
  ).slice(0, 40)}`;

const normalizeClassDefinition = (value, label) => {
  assertAllowedKeys(
    value,
    ["grade", "classNumber", "displayName", "homeroomTeacherUid"],
    label,
  );
  const grade = normalizeClassPart(value.grade, `${label}.grade`);
  const classNumber = normalizeClassPart(
    value.classNumber,
    `${label}.classNumber`,
  );
  return {
    grade,
    classNumber,
    classKey: buildClassKey(grade, classNumber),
    displayName: requireTrimmedString(
      value.displayName,
      `${label}.displayName`,
      120,
    ),
    homeroomTeacherUid: normalizeUid(
      value.homeroomTeacherUid,
      `${label}.homeroomTeacherUid`,
    ),
  };
};

const normalizeRosterEntry = (value, label) => {
  assertAllowedKeys(
    value,
    ["studentUid", "displayName", "classKey", "studentNumber"],
    label,
  );
  return {
    studentUid: normalizeUid(value.studentUid, `${label}.studentUid`),
    displayName: requireTrimmedString(
      value.displayName,
      `${label}.displayName`,
      80,
    ),
    classKey: requireTrimmedString(
      value.classKey,
      `${label}.classKey`,
      100,
    ).toLowerCase(),
    studentNumber: normalizeStudentNumber(value.studentNumber),
  };
};

const normalizeRosterContract = (payload, label = "roster") => {
  assertAllowedKeys(
    payload,
    [
      "semesterId",
      "expectedSemesterRevision",
      "rosterId",
      "importRevision",
      "sourceLabel",
      "sourceHash",
      "validationHash",
      "effectiveFrom",
      "expectedStudentUids",
      "classes",
      "entries",
      "reason",
      "cutoverPlanId",
      "cutoverOperationKey",
    ],
    label,
  );
  if (
    !Array.isArray(payload.classes) ||
    payload.classes.length < 1 ||
    payload.classes.length > 40
  ) {
    fail(
      "invalid-argument",
      "classes must contain between 1 and 40 entries.",
      "ROSTER_PAYLOAD_INVALID",
    );
  }
  if (
    !Array.isArray(payload.entries) ||
    payload.entries.length < 1 ||
    payload.entries.length > 120
  ) {
    fail(
      "invalid-argument",
      "entries must contain between 1 and 120 students.",
      "ROSTER_PAYLOAD_INVALID",
    );
  }
  if (
    !Array.isArray(payload.expectedStudentUids) ||
    payload.expectedStudentUids.length < 1 ||
    payload.expectedStudentUids.length > 120
  ) {
    fail(
      "invalid-argument",
      "expectedStudentUids must contain between 1 and 120 students.",
      "ROSTER_PAYLOAD_INVALID",
    );
  }
  const classes = payload.classes.map((entry, index) =>
    normalizeClassDefinition(entry, `${label}.classes[${index}]`),
  );
  const entries = payload.entries.map((entry, index) =>
    normalizeRosterEntry(entry, `${label}.entries[${index}]`),
  );
  if (Boolean(payload.cutoverPlanId) !== Boolean(payload.cutoverOperationKey)) {
    fail("invalid-argument", "cutoverPlanId and cutoverOperationKey must be provided together.", "COMMAND_PAYLOAD_INVALID");
  }
  return {
    semesterId: semesterCore.normalizeSemesterId(payload.semesterId),
    expectedSemesterRevision: normalizeExpectedRevision(
      payload.expectedSemesterRevision,
      "expectedSemesterRevision",
    ),
    rosterId: requireTrimmedString(payload.rosterId, "rosterId", 120),
    importRevision: normalizeExpectedRevision(
      payload.importRevision,
      "importRevision",
    ),
    sourceLabel: requireTrimmedString(payload.sourceLabel, "sourceLabel", 160),
    sourceHash: normalizeSha256(payload.sourceHash, "sourceHash"),
    validationHash:
      payload.validationHash === undefined
        ? null
        : normalizeSha256(payload.validationHash, "validationHash"),
    effectiveFrom: normalizeDate(payload.effectiveFrom, "effectiveFrom"),
    expectedStudentUids: payload.expectedStudentUids.map((uid, index) =>
      normalizeUid(uid, `${label}.expectedStudentUids[${index}]`),
    ),
    classes,
    entries,
    reason: requireTrimmedString(payload.reason, "reason", 500),
    ...(payload.cutoverPlanId ? { cutoverPlanId: requireTrimmedString(payload.cutoverPlanId, "cutoverPlanId", 80), cutoverOperationKey: requireTrimmedString(payload.cutoverOperationKey, "cutoverOperationKey", 80) } : {}),
  };
};

const normalizeArchiveEnrollmentPayload = (commandType, payload) => {
  if (commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.CREATE_SEMESTER_CLASS) {
    assertAllowedKeys(
      payload,
      [
        "semesterId",
        "expectedSemesterRevision",
        "grade",
        "classNumber",
        "displayName",
        "homeroomTeacherUid",
        "reason",
        "cutoverPlanId",
        "cutoverOperationKey",
      ],
      "createSemesterClass payload",
    );
    const grade = normalizeClassPart(payload.grade, "grade");
    const classNumber = normalizeClassPart(payload.classNumber, "classNumber");
    if (Boolean(payload.cutoverPlanId) !== Boolean(payload.cutoverOperationKey)) fail("invalid-argument", "cutoverPlanId and cutoverOperationKey must be provided together.", "COMMAND_PAYLOAD_INVALID");
    return {
      semesterId: semesterCore.normalizeSemesterId(payload.semesterId),
      expectedSemesterRevision: normalizeExpectedRevision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      grade,
      classNumber,
      classKey: buildClassKey(grade, classNumber),
      displayName: requireTrimmedString(
        payload.displayName,
        "displayName",
        120,
      ),
      homeroomTeacherUid: normalizeUid(
        payload.homeroomTeacherUid,
        "homeroomTeacherUid",
      ),
      reason: requireTrimmedString(payload.reason, "reason", 500),
      ...(payload.cutoverPlanId ? { cutoverPlanId: requireTrimmedString(payload.cutoverPlanId, "cutoverPlanId", 80), cutoverOperationKey: requireTrimmedString(payload.cutoverOperationKey, "cutoverOperationKey", 80) } : {}),
    };
  }

  if (commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.UPDATE_SEMESTER_CLASS) {
    assertAllowedKeys(
      payload,
      [
        "semesterId",
        "classId",
        "expectedRevision",
        "displayName",
        "homeroomTeacherUid",
        "status",
        "reason",
      ],
      "updateSemesterClass payload",
    );
    const status = requireTrimmedString(
      payload.status,
      "status",
      20,
    ).toUpperCase();
    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      fail(
        "invalid-argument",
        "Class status must be ACTIVE or INACTIVE.",
        "COMMAND_PAYLOAD_INVALID",
      );
    }
    return {
      semesterId: semesterCore.normalizeSemesterId(payload.semesterId),
      classId: requireTrimmedString(payload.classId, "classId", 80),
      expectedRevision: normalizeExpectedRevision(payload.expectedRevision),
      displayName: requireTrimmedString(
        payload.displayName,
        "displayName",
        120,
      ),
      homeroomTeacherUid: normalizeUid(
        payload.homeroomTeacherUid,
        "homeroomTeacherUid",
      ),
      status,
      reason: requireTrimmedString(payload.reason, "reason", 500),
    };
  }

  if (
    commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.IMPORT_ENROLLMENT_ROSTER
  ) {
    const normalized = normalizeRosterContract(
      payload,
      "importEnrollmentRoster payload",
    );
    if (!normalized.validationHash) {
      fail(
        "invalid-argument",
        "validationHash from roster preview is required.",
        "ROSTER_VALIDATION_HASH_REQUIRED",
      );
    }
    return normalized;
  }

  if (commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.UPSERT_ENROLLMENT) {
    assertAllowedKeys(
      payload,
      [
        "semesterId",
        "expectedSemesterRevision",
        "studentUid",
        "classId",
        "studentNumber",
        "displayName",
        "effectiveFrom",
        "sourceType",
        "sourceId",
        "reason",
      ],
      "upsertEnrollment payload",
    );
    const sourceType = requireTrimmedString(
      payload.sourceType,
      "sourceType",
      40,
    ).toUpperCase();
    if (!["ROSTER_IMPORT", "MANUAL_EXCEPTION"].includes(sourceType)) {
      fail(
        "invalid-argument",
        "sourceType is not supported.",
        "COMMAND_PAYLOAD_INVALID",
      );
    }
    return {
      semesterId: semesterCore.normalizeSemesterId(payload.semesterId),
      expectedSemesterRevision: normalizeExpectedRevision(
        payload.expectedSemesterRevision,
        "expectedSemesterRevision",
      ),
      studentUid: normalizeUid(payload.studentUid),
      classId: requireTrimmedString(payload.classId, "classId", 80),
      studentNumber: normalizeStudentNumber(payload.studentNumber),
      displayName: requireTrimmedString(payload.displayName, "displayName", 80),
      effectiveFrom: normalizeDate(payload.effectiveFrom, "effectiveFrom"),
      sourceType,
      sourceId: requireTrimmedString(payload.sourceId, "sourceId", 160),
      reason: requireTrimmedString(payload.reason, "reason", 500),
    };
  }

  if (commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.MOVE_ENROLLMENT) {
    assertAllowedKeys(
      payload,
      [
        "semesterId",
        "studentUid",
        "activeEnrollmentId",
        "expectedRevision",
        "targetClassId",
        "studentNumber",
        "effectiveAt",
        "reason",
      ],
      "moveEnrollment payload",
    );
    return {
      semesterId: semesterCore.normalizeSemesterId(payload.semesterId),
      studentUid: normalizeUid(payload.studentUid),
      activeEnrollmentId: requireTrimmedString(
        payload.activeEnrollmentId,
        "activeEnrollmentId",
        80,
      ),
      expectedRevision: normalizeExpectedRevision(payload.expectedRevision),
      targetClassId: requireTrimmedString(
        payload.targetClassId,
        "targetClassId",
        80,
      ),
      studentNumber: normalizeStudentNumber(payload.studentNumber),
      effectiveAt: normalizeDate(payload.effectiveAt, "effectiveAt"),
      reason: requireTrimmedString(payload.reason, "reason", 500),
    };
  }

  if (commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.CLOSE_ENROLLMENT) {
    assertAllowedKeys(
      payload,
      [
        "semesterId",
        "studentUid",
        "activeEnrollmentId",
        "expectedRevision",
        "targetStatus",
        "effectiveTo",
        "reason",
      ],
      "closeEnrollment payload",
    );
    const targetStatus = requireTrimmedString(
      payload.targetStatus,
      "targetStatus",
      20,
    ).toUpperCase();
    if (!["WITHDRAWN", "COMPLETED"].includes(targetStatus)) {
      fail(
        "invalid-argument",
        "targetStatus must be WITHDRAWN or COMPLETED.",
        "COMMAND_PAYLOAD_INVALID",
      );
    }
    return {
      semesterId: semesterCore.normalizeSemesterId(payload.semesterId),
      studentUid: normalizeUid(payload.studentUid),
      activeEnrollmentId: requireTrimmedString(
        payload.activeEnrollmentId,
        "activeEnrollmentId",
        80,
      ),
      expectedRevision: normalizeExpectedRevision(payload.expectedRevision),
      targetStatus,
      effectiveTo: normalizeDate(payload.effectiveTo, "effectiveTo"),
      reason: requireTrimmedString(payload.reason, "reason", 500),
    };
  }

  if (
    commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.PREPARE_SEMESTER_ARCHIVE
  ) {
    assertAllowedKeys(
      payload,
      [
        "semesterId",
        "expectedRevision",
        "accessPolicy",
        "sourcePaths",
        "unresolvedLegacyItems",
        "reason",
      ],
      "prepareSemesterArchive payload",
    );
    if (
      !Array.isArray(payload.sourcePaths) ||
      payload.sourcePaths.length < 1 ||
      payload.sourcePaths.length > 80
    ) {
      fail(
        "invalid-argument",
        "sourcePaths must contain between 1 and 80 paths.",
        "COMMAND_PAYLOAD_INVALID",
      );
    }
    if (
      !Array.isArray(payload.unresolvedLegacyItems) ||
      payload.unresolvedLegacyItems.length > 50
    ) {
      fail(
        "invalid-argument",
        "unresolvedLegacyItems must be an array of at most 50 issue codes.",
        "COMMAND_PAYLOAD_INVALID",
      );
    }
    const accessPolicy = requireTrimmedString(
      payload.accessPolicy,
      "accessPolicy",
      40,
    ).toUpperCase();
    if (accessPolicy !== "ADMIN_ONLY") {
      fail(
        "failed-precondition",
        "Historical access remains ADMIN_ONLY until the archive access policy is approved.",
        "ARCHIVE_ACCESS_POLICY_UNDECIDED",
      );
    }
    const sourcePaths = payload.sourcePaths.map((path, index) => {
      const normalized = requireTrimmedString(
        path,
        `sourcePaths[${index}]`,
        240,
      );
      if (normalized.startsWith("/") || normalized.includes("..")) {
        fail(
          "invalid-argument",
          "sourcePaths contains an invalid path.",
          "COMMAND_PAYLOAD_INVALID",
        );
      }
      return normalized;
    });
    return {
      semesterId: semesterCore.normalizeSemesterId(payload.semesterId),
      expectedRevision: normalizeExpectedRevision(payload.expectedRevision),
      accessPolicy,
      sourcePaths: [...new Set(sourcePaths)].sort(),
      unresolvedLegacyItems: payload.unresolvedLegacyItems
        .map((item, index) =>
          requireTrimmedString(item, `unresolvedLegacyItems[${index}]`, 120),
        )
        .sort(),
      reason: requireTrimmedString(payload.reason, "reason", 500),
    };
  }

  if (
    commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.FREEZE_SEMESTER_ARCHIVE
  ) {
    assertAllowedKeys(
      payload,
      ["semesterId", "expectedRevision", "expectedIntegrityHash", "reason"],
      "freezeSemesterArchive payload",
    );
    return {
      semesterId: semesterCore.normalizeSemesterId(payload.semesterId),
      expectedRevision: normalizeExpectedRevision(payload.expectedRevision),
      expectedIntegrityHash: normalizeSha256(
        payload.expectedIntegrityHash,
        "expectedIntegrityHash",
      ),
      reason: requireTrimmedString(payload.reason, "reason", 500),
    };
  }

  fail(
    "invalid-argument",
    "Unsupported archive/enrollment commandType.",
    "COMMAND_TYPE_UNSUPPORTED",
    {
      commandType,
    },
  );
};

const readDocuments = async (reader, paths) => {
  if (paths.length === 0) return [];
  if (typeof reader.getAll === "function") return reader.getAll(paths);
  const documents = [];
  for (const path of paths) documents.push(await reader.get(path));
  return documents;
};

const manifestPathFor = (semesterId) =>
  `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${semesterId}`;
const readinessPathFor = (semesterId) =>
  `${semesterCore.SEMESTER_READINESS_REPORT_COLLECTION}/${semesterId}`;
const identityPathFor = (studentUid) =>
  `${STUDENT_IDENTITY_COLLECTION}/${studentUid}`;
const classPathFor = (classId) => `${SEMESTER_CLASS_COLLECTION}/${classId}`;
const enrollmentPathFor = (enrollmentId) =>
  `${SEMESTER_ENROLLMENT_COLLECTION}/${enrollmentId}`;
const slotPathFor = (semesterId, studentUid) =>
  `${ENROLLMENT_SLOT_COLLECTION}/${buildEnrollmentSlotId(semesterId, studentUid)}`;
const rosterPathFor = (rosterId) => `${ROSTER_IMPORT_COLLECTION}/${rosterId}`;
const archivePathFor = (semesterId) =>
  `${ARCHIVE_MANIFEST_COLLECTION}/${semesterId}`;

const assertManifestWritable = (
  snapshot,
  semesterId,
  expectedRevision,
  allowedStatuses,
) => {
  if (!snapshot.exists) {
    fail(
      "not-found",
      "Semester Manifest does not exist.",
      "SEMESTER_NOT_FOUND",
      { semesterId },
    );
  }
  const manifest = snapshot.data || {};
  if (Number(manifest.revision || 0) !== expectedRevision) {
    fail(
      "aborted",
      "Semester Manifest revision has changed.",
      "SEMESTER_REVISION_CONFLICT",
      {
        semesterId,
        currentRevision: Number(manifest.revision || 0),
      },
    );
  }
  if (["CLOSED", "ARCHIVED"].includes(manifest.status)) {
    fail(
      "failed-precondition",
      "Archived semester data is read-only.",
      "SEMESTER_ARCHIVED_WRITE_FORBIDDEN",
      { semesterId, status: manifest.status },
    );
  }
  if (!allowedStatuses.includes(manifest.status)) {
    fail(
      "failed-precondition",
      "This command is not allowed in the current semester state.",
      "SEMESTER_WRITE_STATE_INVALID",
      { semesterId, status: manifest.status },
    );
  }
  return manifest;
};

const applyReadinessInvalidation = ({
  transaction,
  reportSnapshot,
  manifestPath,
  readinessPath,
  manifest,
  timestamp,
  actorUid,
  reason,
}) => {
  const demotes = ["VALIDATING", "READY", "FAILED"].includes(manifest.status);
  if (reportSnapshot.exists) {
    transaction.set(
      readinessPath,
      {
        status: "STALE",
        stale: true,
        staleAt: timestamp,
        staleBy: actorUid,
        staleReason: reason,
        registryVersion: W4_READINESS_REGISTRY_VERSION,
      },
      { merge: true },
    );
  }
  if (demotes) {
    transaction.set(
      manifestPath,
      {
        status: "PREPARING",
        provenance: "PREPARING",
        stateRevision: Number(manifest.stateRevision || 0) + 1,
        updatedAt: timestamp,
        updatedBy: actorUid,
      },
      { merge: true },
    );
  }
  return reportSnapshot.exists || demotes;
};

const summarizeStableDocuments = (documents) =>
  documents
    .map((document) => ({
      path: document.path,
      exists: document.exists,
      data: document.exists
        ? Object.fromEntries(
            Object.entries(document.data || {})
              .filter(
                ([key]) =>
                  ![
                    "createdAt",
                    "updatedAt",
                    "preparedAt",
                    "frozenAt",
                  ].includes(key),
              )
              .sort(([left], [right]) => left.localeCompare(right)),
          )
        : null,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

const hashDocuments = (documents) =>
  sha256(JSON.stringify(summarizeStableDocuments(documents)));

const validateRoster = async ({ reader, payload }) => {
  const classKeyCounts = new Map();
  payload.classes.forEach((entry) =>
    classKeyCounts.set(
      entry.classKey,
      (classKeyCounts.get(entry.classKey) || 0) + 1,
    ),
  );
  const studentCounts = new Map();
  payload.entries.forEach((entry) =>
    studentCounts.set(
      entry.studentUid,
      (studentCounts.get(entry.studentUid) || 0) + 1,
    ),
  );
  const numberCounts = new Map();
  payload.entries.forEach((entry) => {
    const key = `${entry.classKey}::${entry.studentNumber}`;
    numberCounts.set(key, (numberCounts.get(key) || 0) + 1);
  });
  const expectedCounts = new Map();
  payload.expectedStudentUids.forEach((uid) =>
    expectedCounts.set(uid, (expectedCounts.get(uid) || 0) + 1),
  );

  const classIdsByKey = new Map(
    payload.classes.map((entry) => [
      entry.classKey,
      buildClassId(payload.semesterId, entry.grade, entry.classNumber),
    ]),
  );
  const userDocuments = await readDocuments(
    reader,
    [...new Set(payload.entries.map((entry) => entry.studentUid))].map(
      (uid) => `users/${uid}`,
    ),
  );
  const teacherDocuments = await readDocuments(
    reader,
    [...new Set(payload.classes.map((entry) => entry.homeroomTeacherUid))].map(
      (uid) => `users/${uid}`,
    ),
  );
  const existingClasses = await readDocuments(
    reader,
    [...classIdsByKey.values()].map(classPathFor),
  );
  const existingClassByPath = new Map(
    existingClasses.map((document) => [document.path, document]),
  );
  const existingClassKeys = new Set();
  existingClasses.forEach((document) => {
    if (document.exists && document.data?.semesterId === payload.semesterId) {
      existingClassKeys.add(String(document.data?.classKey || ""));
    }
  });

  const duplicateClassCount = [...classKeyCounts.values()].filter(
    (count) => count > 1,
  ).length;
  const duplicateStudentCount = [...studentCounts.values()].filter(
    (count) => count > 1,
  ).length;
  const duplicateStudentNumberCount = [...numberCounts.values()].filter(
    (count) => count > 1,
  ).length;
  const duplicateExpectedStudentCount = [...expectedCounts.values()].filter(
    (count) => count > 1,
  ).length;
  const orphanStudentCount = userDocuments.filter(
    (document) =>
      !document.exists ||
      document.data?.role !== "student",
  ).length;
  const orphanTeacherCount = teacherDocuments.filter(
    (document) =>
      !document.exists || String(document.data?.role || "") !== "teacher",
  ).length;
  const orphanClassCount = payload.entries.filter(
    (entry) =>
      !classIdsByKey.has(entry.classKey) &&
      !existingClassKeys.has(entry.classKey),
  ).length;
  const entryUidSet = new Set(payload.entries.map((entry) => entry.studentUid));
  const expectedUidSet = new Set(payload.expectedStudentUids);
  const missingStudentCount = [...expectedUidSet].filter(
    (uid) => !entryUidSet.has(uid),
  ).length;
  const unexpectedStudentCount = [...entryUidSet].filter(
    (uid) => !expectedUidSet.has(uid),
  ).length;
  const existingClassConflictCount = payload.classes.filter((entry) => {
    const path = classPathFor(classIdsByKey.get(entry.classKey));
    const document = existingClassByPath.get(path);
    return (
      document?.exists &&
      (document.data?.semesterId !== payload.semesterId ||
        document.data?.classKey !== entry.classKey ||
        document.data?.displayName !== entry.displayName ||
        document.data?.homeroomTeacherUid !== entry.homeroomTeacherUid)
    );
  }).length;

  const summary = {
    expectedStudentCount: expectedUidSet.size,
    classCount: payload.classes.length,
    enrollmentCount: payload.entries.length,
    duplicateClassCount,
    duplicateStudentCount,
    duplicateStudentNumberCount,
    duplicateExpectedStudentCount,
    orphanStudentCount,
    orphanTeacherCount,
    orphanClassCount,
    missingStudentCount,
    unexpectedStudentCount,
    existingClassConflictCount,
  };
  const passed = Object.entries(summary)
    .filter(
      ([key]) =>
        key.endsWith("Count") &&
        !["expectedStudentCount", "classCount", "enrollmentCount"].includes(
          key,
        ),
    )
    .every(([, count]) => count === 0);
  const validationHash = sha256(
    canonicalize({
      semesterId: payload.semesterId,
      rosterId: payload.rosterId,
      importRevision: payload.importRevision,
      sourceHash: payload.sourceHash,
      effectiveFrom: payload.effectiveFrom,
      expectedStudentUids: [...expectedUidSet].sort(),
      classes: [...payload.classes].sort((left, right) =>
        left.classKey.localeCompare(right.classKey),
      ),
      entries: [...payload.entries].sort((left, right) =>
        left.studentUid.localeCompare(right.studentUid),
      ),
      summary,
    }),
  );
  return { passed, validationHash, summary, classIdsByKey, userDocuments };
};

const createArchiveEnrollmentCommandAdapter = () => {
  const apply = async ({
    transaction,
    commandId,
    commandType,
    payload,
    payloadHash,
    receiptId,
    timestamp,
    actor,
  }) => {
    const manifestPath = manifestPathFor(payload.semesterId);
    const readinessPath = readinessPathFor(payload.semesterId);

    if (
      commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.CREATE_SEMESTER_CLASS
    ) {
      const classId = buildClassId(
        payload.semesterId,
        payload.grade,
        payload.classNumber,
      );
      const classPath = classPathFor(classId);
      const [manifestSnapshot, reportSnapshot, classSnapshot, teacherSnapshot] =
        await readDocuments(transaction, [
          manifestPath,
          readinessPath,
          classPath,
          `users/${payload.homeroomTeacherUid}`,
        ]);
      const manifest = assertManifestWritable(
        manifestSnapshot,
        payload.semesterId,
        payload.expectedSemesterRevision,
        ["DRAFT", "PREPARING", "VALIDATING", "READY", "FAILED", "ACTIVE"],
      );
      if (["PREPARING", "READY"].includes(manifest.status)) await cutoverAuthorization.assertPreparingCutoverCreateIfTargeted({ transaction, semesterId: payload.semesterId, actor, commandType, commandId, payloadHash, cutoverPlanId: payload.cutoverPlanId, cutoverOperationKey: payload.cutoverOperationKey, operationType: "SEMESTER_CLASSES", allowWithoutMarker: true });
      if (classSnapshot.exists) {
        fail(
          "already-exists",
          "Semester class already exists.",
          "SEMESTER_CLASS_ALREADY_EXISTS",
          { classId },
        );
      }
      if (
        !teacherSnapshot.exists ||
        String(teacherSnapshot.data?.role || "") !== "teacher"
      ) {
        fail(
          "failed-precondition",
          "Homeroom teacher reference is invalid.",
          "TEACHER_ASSIGNMENT_INVALID",
        );
      }
      const semesterClass = {
        classId,
        semesterId: payload.semesterId,
        grade: payload.grade,
        classNumber: payload.classNumber,
        classKey: payload.classKey,
        displayName: payload.displayName,
        status: "ACTIVE",
        homeroomTeacherUid: payload.homeroomTeacherUid,
        revision: 1,
        provenance: "CANONICAL",
        schemaVersion: W4_SCHEMA_VERSION,
        createdAt: timestamp,
        createdBy: actor.actorUid,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
      };
      transaction.create(classPath, semesterClass);
      const readinessInvalidated = applyReadinessInvalidation({
        transaction,
        reportSnapshot,
        manifestPath,
        readinessPath,
        manifest,
        timestamp,
        actorUid: actor.actorUid,
        reason: payload.reason,
      });
      return {
        target: {
          semesterId: payload.semesterId,
          classId,
          refs: [classPath, ...(readinessInvalidated ? [readinessPath] : [])],
        },
        sourceHash: null,
        result: { semesterClass, readinessInvalidated },
      };
    }

    if (
      commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.UPDATE_SEMESTER_CLASS
    ) {
      const classPath = classPathFor(payload.classId);
      const [manifestSnapshot, reportSnapshot, classSnapshot, teacherSnapshot] =
        await readDocuments(transaction, [
          manifestPath,
          readinessPath,
          classPath,
          `users/${payload.homeroomTeacherUid}`,
        ]);
      const manifest = assertManifestWritable(
        manifestSnapshot,
        payload.semesterId,
        Number(manifestSnapshot.data?.revision || 0),
        ["DRAFT", "PREPARING", "VALIDATING", "READY", "FAILED", "ACTIVE"],
      );
      if (
        !classSnapshot.exists ||
        classSnapshot.data?.semesterId !== payload.semesterId
      ) {
        fail(
          "not-found",
          "Semester class does not exist.",
          "SEMESTER_CLASS_NOT_FOUND",
        );
      }
      if (
        Number(classSnapshot.data?.revision || 0) !== payload.expectedRevision
      ) {
        fail(
          "aborted",
          "Semester class revision has changed.",
          "SEMESTER_CLASS_REVISION_CONFLICT",
          {
            currentRevision: Number(classSnapshot.data?.revision || 0),
          },
        );
      }
      if (
        !teacherSnapshot.exists ||
        String(teacherSnapshot.data?.role || "") !== "teacher"
      ) {
        fail(
          "failed-precondition",
          "Homeroom teacher reference is invalid.",
          "TEACHER_ASSIGNMENT_INVALID",
        );
      }
      const revision = payload.expectedRevision + 1;
      transaction.set(
        classPath,
        {
          displayName: payload.displayName,
          homeroomTeacherUid: payload.homeroomTeacherUid,
          status: payload.status,
          revision,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      const readinessInvalidated = applyReadinessInvalidation({
        transaction,
        reportSnapshot,
        manifestPath,
        readinessPath,
        manifest,
        timestamp,
        actorUid: actor.actorUid,
        reason: payload.reason,
      });
      return {
        target: {
          semesterId: payload.semesterId,
          classId: payload.classId,
          refs: [classPath, ...(readinessInvalidated ? [readinessPath] : [])],
        },
        sourceHash: null,
        result: {
          classId: payload.classId,
          revision,
          status: payload.status,
          readinessInvalidated,
        },
      };
    }

    if (
      commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.IMPORT_ENROLLMENT_ROSTER
    ) {
      const rosterPath = rosterPathFor(payload.rosterId);
      const [manifestSnapshot, reportSnapshot, existingImport] =
        await readDocuments(transaction, [
          manifestPath,
          readinessPath,
          rosterPath,
        ]);
      const manifest = assertManifestWritable(
        manifestSnapshot,
        payload.semesterId,
        payload.expectedSemesterRevision,
        ["DRAFT", "PREPARING", "VALIDATING", "READY", "FAILED", "ACTIVE"],
      );
      if (["PREPARING", "READY"].includes(manifest.status)) await cutoverAuthorization.assertPreparingCutoverCreateIfTargeted({ transaction, semesterId: payload.semesterId, actor, commandType, commandId, payloadHash, cutoverPlanId: payload.cutoverPlanId, cutoverOperationKey: payload.cutoverOperationKey, operationType: "SEMESTER_ENROLLMENTS", allowWithoutMarker: true });
      const validation = await validateRoster({ reader: transaction, payload });
      if (!validation.passed) {
        fail(
          "failed-precondition",
          "Roster validation failed.",
          "ROSTER_VALIDATION_FAILED",
          validation.summary,
        );
      }
      if (validation.validationHash !== payload.validationHash) {
        fail("aborted", "Roster preview is stale.", "ROSTER_VALIDATION_STALE", {
          currentValidationHash: validation.validationHash,
        });
      }
      if (existingImport.exists) {
        if (
          existingImport.data?.semesterId !== payload.semesterId ||
          existingImport.data?.sourceHash !== payload.sourceHash ||
          existingImport.data?.validationHash !== payload.validationHash ||
          Number(existingImport.data?.importRevision || 0) !==
            payload.importRevision
        ) {
          fail(
            "already-exists",
            "Roster ID was already used for different content.",
            "ROSTER_IMPORT_CONFLICT",
          );
        }
        return {
          target: {
            semesterId: payload.semesterId,
            rosterId: payload.rosterId,
            refs: [rosterPath],
          },
          sourceHash: payload.sourceHash,
          result: {
            rosterId: payload.rosterId,
            applied: true,
            replayedImport: true,
            ...existingImport.data.summary,
            validationHash: payload.validationHash,
          },
        };
      }

      const classDocuments = await readDocuments(
        transaction,
        payload.classes.map((entry) =>
          classPathFor(validation.classIdsByKey.get(entry.classKey)),
        ),
      );
      const identities = await readDocuments(
        transaction,
        payload.entries.map((entry) => identityPathFor(entry.studentUid)),
      );
      const slots = await readDocuments(
        transaction,
        payload.entries.map((entry) =>
          slotPathFor(payload.semesterId, entry.studentUid),
        ),
      );
      const enrollmentIds = payload.entries.map((entry) =>
        buildEnrollmentId({
          semesterId: payload.semesterId,
          studentUid: entry.studentUid,
          classId: validation.classIdsByKey.get(entry.classKey),
          effectiveFrom: payload.effectiveFrom,
          discriminator: `roster:${payload.rosterId}:${payload.importRevision}`,
        }),
      );
      const enrollments = await readDocuments(
        transaction,
        enrollmentIds.map(enrollmentPathFor),
      );

      slots.forEach((slot, index) => {
        if (
          slot.exists &&
          slot.data?.activeEnrollmentId &&
          slot.data.activeEnrollmentId !== enrollmentIds[index]
        ) {
          fail(
            "failed-precondition",
            "A student already has an active Enrollment for this semester.",
            "ENROLLMENT_ACTIVE_CONFLICT",
            { semesterId: payload.semesterId },
          );
        }
      });
      enrollments.forEach((enrollment, index) => {
        if (
          enrollment.exists &&
          (enrollment.data?.studentUid !== payload.entries[index].studentUid ||
            enrollment.data?.semesterId !== payload.semesterId ||
            enrollment.data?.enrollmentStatus !== "ACTIVE")
        ) {
          fail(
            "failed-precondition",
            "Enrollment ID collision detected.",
            "ENROLLMENT_ID_CONFLICT",
          );
        }
      });

      payload.classes.forEach((entry, index) => {
        if (classDocuments[index].exists) return;
        const classId = validation.classIdsByKey.get(entry.classKey);
        transaction.create(classPathFor(classId), {
          classId,
          semesterId: payload.semesterId,
          grade: entry.grade,
          classNumber: entry.classNumber,
          classKey: entry.classKey,
          displayName: entry.displayName,
          status: "ACTIVE",
          homeroomTeacherUid: entry.homeroomTeacherUid,
          revision: 1,
          provenance: "CANONICAL",
          schemaVersion: W4_SCHEMA_VERSION,
          createdAt: timestamp,
          createdBy: actor.actorUid,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        });
      });

      let createdIdentityCount = 0;
      let createdEnrollmentCount = 0;
      payload.entries.forEach((entry, index) => {
        const classId = validation.classIdsByKey.get(entry.classKey);
        const enrollmentId = enrollmentIds[index];
        if (!identities[index].exists) {
          transaction.create(identityPathFor(entry.studentUid), {
            studentUid: entry.studentUid,
            displayName: entry.displayName,
            accountStatus: "ACTIVE",
            revision: 1,
            provenance: "CANONICAL",
            schemaVersion: W4_SCHEMA_VERSION,
            createdAt: timestamp,
            createdBy: actor.actorUid,
            updatedAt: timestamp,
            updatedBy: actor.actorUid,
          });
          createdIdentityCount += 1;
        }
        if (!enrollments[index].exists) {
          const classDefinition = payload.classes.find(
            (item) => item.classKey === entry.classKey,
          );
          transaction.create(enrollmentPathFor(enrollmentId), {
            enrollmentId,
            studentUid: entry.studentUid,
            semesterId: payload.semesterId,
            classId,
            studentNumber: entry.studentNumber,
            enrollmentStatus: "ACTIVE",
            source: {
              type: "ROSTER_IMPORT",
              sourceId: payload.rosterId,
              revision: payload.importRevision,
              sourceHash: payload.sourceHash,
            },
            revision: 1,
            provenance: "CANONICAL",
            effectiveFrom: payload.effectiveFrom,
            effectiveTo: null,
            snapshot: {
              displayName: entry.displayName,
              grade: classDefinition.grade,
              classNumber: classDefinition.classNumber,
              classDisplayName: classDefinition.displayName,
              studentNumber: entry.studentNumber,
            },
            schemaVersion: W4_SCHEMA_VERSION,
            createdAt: timestamp,
            createdBy: actor.actorUid,
            updatedAt: timestamp,
            updatedBy: actor.actorUid,
          });
          createdEnrollmentCount += 1;
        }
        transaction.set(slotPathFor(payload.semesterId, entry.studentUid), {
          semesterId: payload.semesterId,
          studentUid: entry.studentUid,
          activeEnrollmentId: enrollmentId,
          revision: Number(slots[index].data?.revision || 0) + 1,
          status: "ACTIVE",
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        });
      });

      const summary = {
        classCount: payload.classes.length,
        enrollmentCount: payload.entries.length,
        createdIdentityCount,
        createdEnrollmentCount,
        duplicateEnrollmentCount: 0,
        duplicateClassCount: 0,
        duplicateStudentCount: 0,
        duplicateStudentNumberCount: 0,
        duplicateExpectedStudentCount: 0,
        orphanStudentCount: 0,
        orphanTeacherCount: 0,
        orphanClassCount: 0,
        missingStudentCount: 0,
        unexpectedStudentCount: 0,
        existingClassConflictCount: 0,
      };
      transaction.create(rosterPath, {
        rosterId: payload.rosterId,
        semesterId: payload.semesterId,
        status: "APPLIED",
        approvalStatus: "APPROVED",
        importRevision: payload.importRevision,
        sourceHash: payload.sourceHash,
        expectedStudentUids: [...new Set(payload.expectedStudentUids)].sort(),
        source: {
          type: "APPROVED_ROSTER_IMPORT",
          label: payload.sourceLabel,
          sourceHash: payload.sourceHash,
        },
        validationStatus: "PASS",
        validationHash: payload.validationHash,
        summary,
        schemaVersion: W4_SCHEMA_VERSION,
        approvedAt: timestamp,
        approvedBy: actor.actorUid,
        appliedAt: timestamp,
        appliedBy: actor.actorUid,
        commandId,
        receiptId,
      });
      const readinessInvalidated = applyReadinessInvalidation({
        transaction,
        reportSnapshot,
        manifestPath,
        readinessPath,
        manifest,
        timestamp,
        actorUid: actor.actorUid,
        reason: payload.reason,
      });
      return {
        target: {
          semesterId: payload.semesterId,
          rosterId: payload.rosterId,
          refs: [
            rosterPath,
            ...payload.classes.map((entry) =>
              classPathFor(validation.classIdsByKey.get(entry.classKey)),
            ),
            ...enrollmentIds.map(enrollmentPathFor),
            ...payload.entries.map((entry) =>
              slotPathFor(payload.semesterId, entry.studentUid),
            ),
          ],
        },
        sourceHash: payload.sourceHash,
        result: {
          rosterId: payload.rosterId,
          applied: true,
          replayedImport: false,
          ...summary,
          validationHash: payload.validationHash,
          readinessInvalidated,
        },
      };
    }

    if (commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.UPSERT_ENROLLMENT) {
      const classPath = classPathFor(payload.classId);
      const identityPath = identityPathFor(payload.studentUid);
      const slotPath = slotPathFor(payload.semesterId, payload.studentUid);
      const enrollmentId = buildEnrollmentId({
        semesterId: payload.semesterId,
        studentUid: payload.studentUid,
        classId: payload.classId,
        effectiveFrom: payload.effectiveFrom,
        discriminator: `${payload.sourceType}:${payload.sourceId}`,
      });
      const enrollmentPath = enrollmentPathFor(enrollmentId);
      const [
        manifestSnapshot,
        reportSnapshot,
        classSnapshot,
        identitySnapshot,
        slotSnapshot,
        enrollmentSnapshot,
      ] = await readDocuments(transaction, [
        manifestPath,
        readinessPath,
        classPath,
        identityPath,
        slotPath,
        enrollmentPath,
      ]);
      const manifest = assertManifestWritable(
        manifestSnapshot,
        payload.semesterId,
        payload.expectedSemesterRevision,
        ["DRAFT", "PREPARING", "VALIDATING", "READY", "FAILED", "ACTIVE"],
      );
      if (!identitySnapshot.exists) {
        fail(
          "not-found",
          "Student identity does not exist.",
          "STUDENT_IDENTITY_NOT_FOUND",
        );
      }
      if (
        !classSnapshot.exists ||
        classSnapshot.data?.semesterId !== payload.semesterId ||
        classSnapshot.data?.status !== "ACTIVE"
      ) {
        fail(
          "failed-precondition",
          "Target class is not active in this semester.",
          "SEMESTER_CLASS_NOT_ACTIVE",
        );
      }
      if (slotSnapshot.exists && slotSnapshot.data?.activeEnrollmentId) {
        if (
          slotSnapshot.data.activeEnrollmentId === enrollmentId &&
          enrollmentSnapshot.exists &&
          enrollmentSnapshot.data?.enrollmentStatus === "ACTIVE"
        ) {
          return {
            target: {
              semesterId: payload.semesterId,
              enrollmentId,
              refs: [enrollmentPath, slotPath],
            },
            sourceHash: null,
            result: {
              enrollmentId,
              revision: enrollmentSnapshot.data.revision,
              replayedEnrollment: true,
            },
          };
        }
        fail(
          "failed-precondition",
          "Student already has an active Enrollment.",
          "ENROLLMENT_ACTIVE_CONFLICT",
        );
      }
      if (enrollmentSnapshot.exists) {
        fail(
          "failed-precondition",
          "Enrollment ID already exists without an active slot.",
          "ENROLLMENT_ID_CONFLICT",
        );
      }
      const enrollment = {
        enrollmentId,
        studentUid: payload.studentUid,
        semesterId: payload.semesterId,
        classId: payload.classId,
        studentNumber: payload.studentNumber,
        enrollmentStatus: "ACTIVE",
        source: {
          type: payload.sourceType,
          sourceId: payload.sourceId,
          revision: 1,
        },
        revision: 1,
        provenance: "CANONICAL",
        effectiveFrom: payload.effectiveFrom,
        effectiveTo: null,
        snapshot: {
          displayName: payload.displayName,
          grade: classSnapshot.data.grade,
          classNumber: classSnapshot.data.classNumber,
          classDisplayName: classSnapshot.data.displayName,
          studentNumber: payload.studentNumber,
        },
        schemaVersion: W4_SCHEMA_VERSION,
        createdAt: timestamp,
        createdBy: actor.actorUid,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
      };
      transaction.create(enrollmentPath, enrollment);
      transaction.set(slotPath, {
        semesterId: payload.semesterId,
        studentUid: payload.studentUid,
        activeEnrollmentId: enrollmentId,
        revision: Number(slotSnapshot.data?.revision || 0) + 1,
        status: "ACTIVE",
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
      });
      const readinessInvalidated = applyReadinessInvalidation({
        transaction,
        reportSnapshot,
        manifestPath,
        readinessPath,
        manifest,
        timestamp,
        actorUid: actor.actorUid,
        reason: payload.reason,
      });
      return {
        target: {
          semesterId: payload.semesterId,
          enrollmentId,
          refs: [enrollmentPath, slotPath],
        },
        sourceHash: null,
        result: {
          enrollmentId,
          revision: 1,
          replayedEnrollment: false,
          readinessInvalidated,
        },
      };
    }

    if (commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.MOVE_ENROLLMENT) {
      const slotPath = slotPathFor(payload.semesterId, payload.studentUid);
      const activePath = enrollmentPathFor(payload.activeEnrollmentId);
      const targetClassPath = classPathFor(payload.targetClassId);
      const identityPath = identityPathFor(payload.studentUid);
      const [
        manifestSnapshot,
        reportSnapshot,
        slotSnapshot,
        activeSnapshot,
        targetClassSnapshot,
        identitySnapshot,
      ] = await readDocuments(transaction, [
        manifestPath,
        readinessPath,
        slotPath,
        activePath,
        targetClassPath,
        identityPath,
      ]);
      const manifest = assertManifestWritable(
        manifestSnapshot,
        payload.semesterId,
        Number(manifestSnapshot.data?.revision || 0),
        ["PREPARING", "VALIDATING", "READY", "FAILED", "ACTIVE"],
      );
      if (
        !slotSnapshot.exists ||
        slotSnapshot.data?.activeEnrollmentId !== payload.activeEnrollmentId ||
        !activeSnapshot.exists ||
        activeSnapshot.data?.studentUid !== payload.studentUid ||
        activeSnapshot.data?.semesterId !== payload.semesterId ||
        activeSnapshot.data?.enrollmentStatus !== "ACTIVE"
      ) {
        fail(
          "aborted",
          "Active Enrollment has changed.",
          "ENROLLMENT_ACTIVE_CONFLICT",
        );
      }
      if (
        Number(activeSnapshot.data?.revision || 0) !== payload.expectedRevision
      ) {
        fail(
          "aborted",
          "Enrollment revision has changed.",
          "ENROLLMENT_REVISION_CONFLICT",
          {
            currentRevision: Number(activeSnapshot.data?.revision || 0),
          },
        );
      }
      if (
        !targetClassSnapshot.exists ||
        targetClassSnapshot.data?.semesterId !== payload.semesterId ||
        targetClassSnapshot.data?.status !== "ACTIVE"
      ) {
        fail(
          "failed-precondition",
          "Target class is not active.",
          "SEMESTER_CLASS_NOT_ACTIVE",
        );
      }
      if (!identitySnapshot.exists) {
        fail(
          "not-found",
          "Student identity does not exist.",
          "STUDENT_IDENTITY_NOT_FOUND",
        );
      }
      const nextEnrollmentId = buildEnrollmentId({
        semesterId: payload.semesterId,
        studentUid: payload.studentUid,
        classId: payload.targetClassId,
        effectiveFrom: payload.effectiveAt,
        discriminator: `move:${receiptId}`,
      });
      const nextPath = enrollmentPathFor(nextEnrollmentId);
      const nextSnapshot = await transaction.get(nextPath);
      if (nextSnapshot.exists) {
        fail(
          "failed-precondition",
          "Movement Enrollment already exists.",
          "ENROLLMENT_ID_CONFLICT",
        );
      }
      transaction.set(
        activePath,
        {
          enrollmentStatus: "TRANSFERRED",
          effectiveTo: payload.effectiveAt,
          revision: payload.expectedRevision + 1,
          transitionReason: payload.reason,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      transaction.create(nextPath, {
        enrollmentId: nextEnrollmentId,
        studentUid: payload.studentUid,
        semesterId: payload.semesterId,
        classId: payload.targetClassId,
        studentNumber: payload.studentNumber,
        enrollmentStatus: "ACTIVE",
        source: { type: "MANUAL_EXCEPTION", sourceId: receiptId, revision: 1 },
        revision: 1,
        provenance: "CANONICAL",
        effectiveFrom: payload.effectiveAt,
        effectiveTo: null,
        previousEnrollmentId: payload.activeEnrollmentId,
        snapshot: {
          displayName: identitySnapshot.data.displayName,
          grade: targetClassSnapshot.data.grade,
          classNumber: targetClassSnapshot.data.classNumber,
          classDisplayName: targetClassSnapshot.data.displayName,
          studentNumber: payload.studentNumber,
        },
        schemaVersion: W4_SCHEMA_VERSION,
        createdAt: timestamp,
        createdBy: actor.actorUid,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
      });
      transaction.set(
        slotPath,
        {
          activeEnrollmentId: nextEnrollmentId,
          revision: Number(slotSnapshot.data?.revision || 0) + 1,
          status: "ACTIVE",
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      const readinessInvalidated = applyReadinessInvalidation({
        transaction,
        reportSnapshot,
        manifestPath,
        readinessPath,
        manifest,
        timestamp,
        actorUid: actor.actorUid,
        reason: payload.reason,
      });
      return {
        target: {
          semesterId: payload.semesterId,
          enrollmentId: nextEnrollmentId,
          previousEnrollmentId: payload.activeEnrollmentId,
          refs: [activePath, nextPath, slotPath],
        },
        sourceHash: null,
        result: {
          previousEnrollmentId: payload.activeEnrollmentId,
          enrollmentId: nextEnrollmentId,
          activeEnrollmentCount: 1,
          readinessInvalidated,
        },
      };
    }

    if (commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.CLOSE_ENROLLMENT) {
      const slotPath = slotPathFor(payload.semesterId, payload.studentUid);
      const enrollmentPath = enrollmentPathFor(payload.activeEnrollmentId);
      const [
        manifestSnapshot,
        reportSnapshot,
        slotSnapshot,
        enrollmentSnapshot,
      ] = await readDocuments(transaction, [
        manifestPath,
        readinessPath,
        slotPath,
        enrollmentPath,
      ]);
      const manifest = assertManifestWritable(
        manifestSnapshot,
        payload.semesterId,
        Number(manifestSnapshot.data?.revision || 0),
        ["PREPARING", "VALIDATING", "READY", "FAILED", "ACTIVE"],
      );
      if (
        !slotSnapshot.exists ||
        slotSnapshot.data?.activeEnrollmentId !== payload.activeEnrollmentId ||
        !enrollmentSnapshot.exists ||
        enrollmentSnapshot.data?.studentUid !== payload.studentUid ||
        enrollmentSnapshot.data?.semesterId !== payload.semesterId ||
        enrollmentSnapshot.data?.enrollmentStatus !== "ACTIVE"
      ) {
        fail(
          "aborted",
          "Active Enrollment has changed.",
          "ENROLLMENT_ACTIVE_CONFLICT",
        );
      }
      if (
        Number(enrollmentSnapshot.data?.revision || 0) !==
        payload.expectedRevision
      ) {
        fail(
          "aborted",
          "Enrollment revision has changed.",
          "ENROLLMENT_REVISION_CONFLICT",
          {
            currentRevision: Number(enrollmentSnapshot.data?.revision || 0),
          },
        );
      }
      transaction.set(
        enrollmentPath,
        {
          enrollmentStatus: payload.targetStatus,
          effectiveTo: payload.effectiveTo,
          revision: payload.expectedRevision + 1,
          transitionReason: payload.reason,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      transaction.set(
        slotPath,
        {
          activeEnrollmentId: null,
          revision: Number(slotSnapshot.data?.revision || 0) + 1,
          status: payload.targetStatus,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      const readinessInvalidated = applyReadinessInvalidation({
        transaction,
        reportSnapshot,
        manifestPath,
        readinessPath,
        manifest,
        timestamp,
        actorUid: actor.actorUid,
        reason: payload.reason,
      });
      return {
        target: {
          semesterId: payload.semesterId,
          enrollmentId: payload.activeEnrollmentId,
          refs: [enrollmentPath, slotPath],
        },
        sourceHash: null,
        result: {
          enrollmentId: payload.activeEnrollmentId,
          status: payload.targetStatus,
          activeEnrollmentCount: 0,
          readinessInvalidated,
        },
      };
    }

    if (
      commandType ===
        ARCHIVE_ENROLLMENT_COMMAND_TYPES.PREPARE_SEMESTER_ARCHIVE ||
      commandType === ARCHIVE_ENROLLMENT_COMMAND_TYPES.FREEZE_SEMESTER_ARCHIVE
    ) {
      const archivePath = archivePathFor(payload.semesterId);
      const [manifestSnapshot, archiveSnapshot] = await readDocuments(
        transaction,
        [manifestPath, archivePath],
      );
      if (!manifestSnapshot.exists) {
        fail(
          "not-found",
          "Semester Manifest does not exist.",
          "SEMESTER_NOT_FOUND",
        );
      }
      const manifest = manifestSnapshot.data || {};
      if (Number(manifest.revision || 0) !== payload.expectedRevision) {
        fail(
          "aborted",
          "Semester Manifest revision has changed.",
          "SEMESTER_REVISION_CONFLICT",
          {
            currentRevision: Number(manifest.revision || 0),
          },
        );
      }
      const classes = await transaction.query(SEMESTER_CLASS_COLLECTION, {
        field: "semesterId",
        operator: "==",
        value: payload.semesterId,
      });
      const enrollments = await transaction.query(
        SEMESTER_ENROLLMENT_COLLECTION,
        { field: "semesterId", operator: "==", value: payload.semesterId },
      );
      const imports = await transaction.query(ROSTER_IMPORT_COLLECTION, {
        field: "semesterId",
        operator: "==",
        value: payload.semesterId,
      });
      const integrityDocuments = [...classes, ...enrollments, ...imports];
      const integrityHash = hashDocuments(integrityDocuments);
      const counts = {
        classCount: classes.length,
        enrollmentCount: enrollments.length,
        activeEnrollmentCount: enrollments.filter(
          (document) => document.data?.enrollmentStatus === "ACTIVE",
        ).length,
        rosterImportCount: imports.length,
      };

      if (
        commandType ===
        ARCHIVE_ENROLLMENT_COMMAND_TYPES.PREPARE_SEMESTER_ARCHIVE
      ) {
        if (!["ACTIVE", "CLOSING", "CLOSED"].includes(manifest.status)) {
          fail(
            "failed-precondition",
            "Archive preparation requires ACTIVE, CLOSING, or CLOSED.",
            "ARCHIVE_STATE_INVALID",
          );
        }
        if (
          archiveSnapshot.exists &&
          archiveSnapshot.data?.archiveStatus === "FROZEN"
        ) {
          fail(
            "failed-precondition",
            "Frozen archive metadata is immutable.",
            "ARCHIVE_IMMUTABLE",
          );
        }
        const archiveManifest = {
          semesterId: payload.semesterId,
          archiveStatus: "PREPARED",
          preparedRevision: manifest.revision,
          frozenRevision: null,
          schemaVersion: W4_SCHEMA_VERSION,
          writeFenceVersion: WRITE_FENCE_VERSION,
          readinessRegistryVersion: W4_READINESS_REGISTRY_VERSION,
          counts,
          sourcePaths: payload.sourcePaths,
          integrityHash,
          unresolvedLegacyItems: payload.unresolvedLegacyItems,
          unresolvedBlockingCount: payload.unresolvedLegacyItems.length,
          accessPolicy: payload.accessPolicy,
          preparedAt: timestamp,
          preparedBy: actor.actorUid,
          frozenAt: null,
          frozenBy: null,
          commandId,
          updatedAt: timestamp,
        };
        transaction.set(archivePath, archiveManifest);
        return {
          target: {
            semesterId: payload.semesterId,
            refs: [archivePath, ...payload.sourcePaths],
          },
          sourceHash: integrityHash,
          result: {
            semesterId: payload.semesterId,
            archiveStatus: "PREPARED",
            integrityHash,
            counts,
          },
        };
      }

      if (manifest.status !== "CLOSED") {
        fail(
          "failed-precondition",
          "Only a CLOSED semester can be frozen.",
          "ARCHIVE_STATE_INVALID",
          {
            status: manifest.status,
          },
        );
      }
      if (
        !archiveSnapshot.exists ||
        archiveSnapshot.data?.archiveStatus !== "PREPARED"
      ) {
        fail(
          "failed-precondition",
          "Archive preparation evidence is missing.",
          "ARCHIVE_PREPARATION_REQUIRED",
        );
      }
      if (archiveSnapshot.data?.unresolvedBlockingCount !== 0) {
        fail(
          "failed-precondition",
          "Archive has unresolved blocking issues.",
          "ARCHIVE_BLOCKING_ISSUES",
        );
      }
      if (
        archiveSnapshot.data?.integrityHash !== payload.expectedIntegrityHash ||
        integrityHash !== payload.expectedIntegrityHash
      ) {
        fail(
          "aborted",
          "Archive contents changed after preparation.",
          "ARCHIVE_INTEGRITY_CONFLICT",
          {
            currentIntegrityHash: integrityHash,
          },
        );
      }
      transaction.set(
        archivePath,
        {
          archiveStatus: "FROZEN",
          frozenRevision: manifest.revision,
          integrityHash,
          counts,
          archivedAt: timestamp,
          archivedBy: actor.actorUid,
          frozenAt: timestamp,
          frozenBy: actor.actorUid,
          freezeCommandId: commandId,
          updatedAt: timestamp,
        },
        { merge: true },
      );
      return {
        target: { semesterId: payload.semesterId, refs: [archivePath] },
        sourceHash: integrityHash,
        result: {
          semesterId: payload.semesterId,
          archiveStatus: "FROZEN",
          integrityHash,
          counts,
        },
      };
    }

    fail(
      "invalid-argument",
      "Unsupported archive/enrollment commandType.",
      "COMMAND_TYPE_UNSUPPORTED",
      {
        commandType,
      },
    );
  };

  return { apply };
};

const createArchiveEnrollmentReadinessAdapter = () => ({
  evaluate: async ({ transaction, manifest }) => {
    const classes = await transaction.query(SEMESTER_CLASS_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: manifest.semesterId,
    });
    const enrollments = await transaction.query(
      SEMESTER_ENROLLMENT_COLLECTION,
      { field: "semesterId", operator: "==", value: manifest.semesterId },
    );
    const slots = await transaction.query(ENROLLMENT_SLOT_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: manifest.semesterId,
    });
    const imports = await transaction.query(ROSTER_IMPORT_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: manifest.semesterId,
    });
    const activeClasses = classes.filter(
      (document) => document.data?.status === "ACTIVE",
    );
    const classKeys = activeClasses
      .map((document) => document.data?.classKey)
      .filter(Boolean);
    const classIds = new Set(
      activeClasses.map((document) => document.data?.classId),
    );
    const teacherDocuments = await readDocuments(
      transaction,
      [
        ...new Set(
          activeClasses
            .map((document) => document.data?.homeroomTeacherUid)
            .filter(Boolean),
        ),
      ].map((uid) => `users/${uid}`),
    );
    const teacherByUid = new Map(
      teacherDocuments.map((document) => [
        document.path.split("/").at(-1),
        document,
      ]),
    );
    const classSchemaInvalidCount = activeClasses.filter(
      (document) =>
        document.data?.semesterId !== manifest.semesterId ||
        Number(document.data?.schemaVersion || 0) !== W4_SCHEMA_VERSION ||
        !document.data?.homeroomTeacherUid ||
        !document.data?.classKey,
    ).length;
    const invalidTeacherAssignmentCount = activeClasses.filter((document) => {
      const teacher = teacherByUid.get(document.data?.homeroomTeacherUid);
      return !teacher?.exists || teacher.data?.role !== "teacher";
    }).length;
    const duplicateClassCount = classKeys.length - new Set(classKeys).size;
    const classDigest = hashDocuments([...activeClasses, ...teacherDocuments]);
    const classPass =
      activeClasses.length > 0 &&
      classSchemaInvalidCount === 0 &&
      invalidTeacherAssignmentCount === 0 &&
      duplicateClassCount === 0;

    const activeEnrollments = enrollments.filter(
      (document) => document.data?.enrollmentStatus === "ACTIVE",
    );
    const activeCounts = new Map();
    activeEnrollments.forEach((document) => {
      const uid = String(document.data?.studentUid || "");
      activeCounts.set(uid, (activeCounts.get(uid) || 0) + 1);
    });
    const duplicateActiveCount = [...activeCounts.values()].filter(
      (count) => count > 1,
    ).length;
    const activeSlots = slots.filter((slot) =>
      Boolean(slot.data?.activeEnrollmentId),
    );
    const slotStudentCounts = new Map();
    activeSlots.forEach((slot) => {
      const uid = String(slot.data?.studentUid || "");
      slotStudentCounts.set(uid, (slotStudentCounts.get(uid) || 0) + 1);
    });
    const duplicateSlotCount = [...slotStudentCounts.values()].filter(
      (count) => count > 1,
    ).length;
    const identityDocuments = await readDocuments(
      transaction,
      [
        ...new Set(
          activeEnrollments
            .map((document) => document.data?.studentUid)
            .filter(Boolean),
        ),
      ].map(identityPathFor),
    );
    const identityByUid = new Map(
      identityDocuments.map((document) => [
        document.path.split("/").at(-1),
        document,
      ]),
    );
    const orphanStudentCount = activeEnrollments.filter(
      (document) => !identityByUid.get(document.data?.studentUid)?.exists,
    ).length;
    const orphanClassCount = activeEnrollments.filter(
      (document) => !classIds.has(document.data?.classId),
    ).length;
    const activeById = new Map(
      activeEnrollments.map((document) => [
        document.data?.enrollmentId,
        document,
      ]),
    );
    const slotMismatchCount =
      slots.filter((slot) => {
        if (!slot.data?.activeEnrollmentId)
          return slot.data?.status === "ACTIVE";
        const enrollment = activeById.get(slot.data.activeEnrollmentId);
        return (
          !enrollment || enrollment.data?.studentUid !== slot.data?.studentUid
        );
      }).length +
      activeEnrollments.filter(
        (enrollment) =>
          !slots.some(
            (slot) =>
              slot.data?.activeEnrollmentId === enrollment.data?.enrollmentId &&
              slot.data?.studentUid === enrollment.data?.studentUid,
          ),
      ).length;
    const approvedImports = imports.filter(
      (document) =>
        document.data?.status === "APPLIED" &&
        document.data?.approvalStatus === "APPROVED" &&
        document.data?.validationStatus === "PASS",
    );
    const invalidImportCount = imports.length - approvedImports.length;
    const expectedStudentUids = new Set(
      approvedImports.flatMap((document) =>
        Array.isArray(document.data?.expectedStudentUids)
          ? document.data.expectedStudentUids.filter(Boolean)
          : [],
      ),
    );
    const missingActiveEnrollmentCount = [...expectedStudentUids].filter(
      (uid) => !activeCounts.has(uid),
    ).length;
    const enrollmentDigest = hashDocuments([
      ...enrollments,
      ...slots,
      ...imports,
      ...identityDocuments,
    ]);
    const enrollmentPass =
      approvedImports.length > 0 &&
      activeEnrollments.length > 0 &&
      duplicateActiveCount === 0 &&
      orphanStudentCount === 0 &&
      orphanClassCount === 0 &&
      slotMismatchCount === 0 &&
      duplicateSlotCount === 0 &&
      missingActiveEnrollmentCount === 0 &&
      invalidImportCount === 0;

    const pointerSnapshot = await transaction.get(
      semesterCore.ACTIVE_SEMESTER_POINTER_PATH,
    );
    const pointerSemesterId =
      pointerSnapshot.exists && pointerSnapshot.data?.semesterId
        ? pointerSnapshot.data.semesterId
        : null;
    const previousSemesterId =
      pointerSnapshot.exists && pointerSnapshot.data?.previousSemesterId
        ? pointerSnapshot.data.previousSemesterId
        : null;
    let priorSemesterId =
      pointerSemesterId && pointerSemesterId !== manifest.semesterId
        ? pointerSemesterId
        : previousSemesterId && previousSemesterId !== manifest.semesterId
          ? previousSemesterId
          : null;
    let priorSemesterSource = "ACTIVE_POINTER";
    const cutoverPointer = await transaction.get(
      `${CUTOVER_TARGET_COLLECTION}/${manifest.semesterId}`,
    );
    if (
      cutoverPointer.exists &&
      cutoverPointer.data?.status === "VERIFIED" &&
      cutoverPointer.data?.targetSemesterId === manifest.semesterId &&
      cutoverPointer.data?.latestPlanId &&
      cutoverPointer.data?.latestAttemptId &&
      cutoverPointer.data?.latestEvidenceId &&
      cutoverPointer.data?.dependencyHash
    ) {
      const cutoverPlan = await transaction.get(
        `${CUTOVER_PLAN_COLLECTION}/${cutoverPointer.data.latestPlanId}`,
      );
      const cutoverAttempt = await transaction.get(
        `${CUTOVER_ATTEMPT_COLLECTION}/${cutoverPointer.data.latestAttemptId}`,
      );
      const cutoverEvidence = await transaction.get(
        `${CUTOVER_EVIDENCE_COLLECTION}/${cutoverPointer.data.latestEvidenceId}`,
      );
      const sourceSemesterId = String(
        cutoverPlan.data?.sourceSemesterId || "",
      );
      const sourceManifest = sourceSemesterId
        ? await transaction.get(
            `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${sourceSemesterId}`,
          )
        : { exists: false, data: null };
      const dependencyHash = cutoverPointer.data.dependencyHash;
      const cutoverSourceIsVerified =
        Number(cutoverPointer.data?.schemaVersion || 0) ===
          CUTOVER_SCHEMA_VERSION &&
        cutoverPointer.data?.policyVersion === CUTOVER_POLICY_VERSION &&
        cutoverPlan.exists &&
        cutoverAttempt.exists &&
        cutoverEvidence.exists &&
        sourceManifest.exists &&
        Number(cutoverPlan.data?.schemaVersion || 0) ===
          CUTOVER_SCHEMA_VERSION &&
        Number(cutoverAttempt.data?.schemaVersion || 0) ===
          CUTOVER_SCHEMA_VERSION &&
        Number(cutoverEvidence.data?.schemaVersion || 0) ===
          CUTOVER_SCHEMA_VERSION &&
        cutoverPlan.data?.policyVersion === CUTOVER_POLICY_VERSION &&
        cutoverAttempt.data?.policyVersion === CUTOVER_POLICY_VERSION &&
        cutoverEvidence.data?.policyVersion === CUTOVER_POLICY_VERSION &&
        cutoverPlan.data?.status === "VERIFIED" &&
        cutoverAttempt.data?.status === "VERIFIED" &&
        cutoverEvidence.data?.status === "PASS" &&
        cutoverPlan.data?.planId === cutoverPointer.data.latestPlanId &&
        cutoverAttempt.data?.attemptId ===
          cutoverPointer.data.latestAttemptId &&
        cutoverAttempt.data?.planId === cutoverPointer.data.latestPlanId &&
        cutoverEvidence.data?.evidenceId ===
          cutoverPointer.data.latestEvidenceId &&
        cutoverEvidence.data?.planId === cutoverPointer.data.latestPlanId &&
        cutoverEvidence.data?.attemptId ===
          cutoverPointer.data.latestAttemptId &&
        sourceSemesterId.length > 0 &&
        sourceSemesterId !== manifest.semesterId &&
        cutoverPlan.data?.targetSemesterId === manifest.semesterId &&
        cutoverAttempt.data?.sourceSemesterId === sourceSemesterId &&
        cutoverAttempt.data?.targetSemesterId === manifest.semesterId &&
        cutoverEvidence.data?.sourceSemesterId === sourceSemesterId &&
        cutoverEvidence.data?.targetSemesterId === manifest.semesterId &&
        cutoverPointer.data?.manifestHash === cutoverPlan.data?.manifestHash &&
        cutoverPlan.data?.manifestHash === cutoverEvidence.data?.manifestHash &&
        cutoverAttempt.data?.manifestHash === cutoverPlan.data?.manifestHash &&
        cutoverPlan.data?.dependencyHash === dependencyHash &&
        cutoverAttempt.data?.dependencyHash === dependencyHash &&
        cutoverEvidence.data?.dependencyHash === dependencyHash &&
        Number(cutoverPlan.data?.targetManifestRevision || 0) ===
          Number(manifest.revision || 0) &&
        Number(cutoverPointer.data?.targetManifestRevision || 0) ===
          Number(manifest.revision || 0) &&
        Number(cutoverAttempt.data?.targetManifestRevision || 0) ===
          Number(manifest.revision || 0) &&
        Number(cutoverEvidence.data?.targetManifestRevision || 0) ===
          Number(manifest.revision || 0) &&
        Number(cutoverPlan.data?.sourceManifestRevision || 0) ===
          Number(sourceManifest.data?.revision || 0) &&
        Number(cutoverAttempt.data?.sourceManifestRevision || 0) ===
          Number(sourceManifest.data?.revision || 0) &&
        Number(cutoverEvidence.data?.sourceManifestRevision || 0) ===
          Number(sourceManifest.data?.revision || 0) &&
        sourceManifest.data?.semesterId === sourceSemesterId &&
        sourceManifest.data?.status === "ARCHIVED" &&
        cutoverEvidence.data?.sourceStatus === "ARCHIVED";
      if (cutoverSourceIsVerified) {
        priorSemesterId = sourceSemesterId;
        priorSemesterSource = "VERIFIED_CUTOVER_PLAN";
      }
    }
    const archiveSnapshot = priorSemesterId
      ? await transaction.get(archivePathFor(priorSemesterId))
      : { exists: false, data: null, path: "" };
    const archiveApplicable = Boolean(priorSemesterId);
    const archivePass =
      !archiveApplicable ||
      (archiveSnapshot.exists &&
        ["PREPARED", "FROZEN"].includes(archiveSnapshot.data?.archiveStatus) &&
        archiveSnapshot.data?.writeFenceVersion === WRITE_FENCE_VERSION &&
        Number(archiveSnapshot.data?.unresolvedBlockingCount || 0) === 0);
    const archiveEvidence = archiveApplicable
      ? `semester=${priorSemesterId}; source=${priorSemesterSource}; status=${archiveSnapshot.data?.archiveStatus || "missing"}; fence=${archiveSnapshot.data?.writeFenceVersion || "missing"}; blockers=${Number(archiveSnapshot.data?.unresolvedBlockingCount || 0)}; integrity=${archiveSnapshot.data?.integrityHash || "missing"}`
      : "noPreviousActiveSemester=true; registry=w4-v1";

    return [
      {
        checkId: "archive_readiness",
        label: "Previous semester archive readiness",
        category: "ARCHIVE",
        required: true,
        status: archivePass ? "PASS" : "FAIL",
        evidence: archiveEvidence,
        failureReason: archivePass ? null : "ARCHIVE_READINESS_NOT_PASS",
        ownerWave: "W4",
      },
      {
        checkId: "class_readiness",
        label: "Semester Class readiness",
        category: "CLASS",
        required: true,
        status: classPass ? "PASS" : "FAIL",
        evidence: `active=${activeClasses.length}; duplicate=${duplicateClassCount}; invalid=${classSchemaInvalidCount}; invalidTeacher=${invalidTeacherAssignmentCount}; digest=${classDigest}`,
        failureReason: classPass ? null : "CLASS_READINESS_NOT_PASS",
        ownerWave: "W4",
      },
      {
        checkId: "enrollment_readiness",
        label: "Semester Enrollment readiness",
        category: "ENROLLMENT",
        required: true,
        status: enrollmentPass ? "PASS" : "FAIL",
        evidence: `active=${activeEnrollments.length}; imports=${approvedImports.length}; duplicate=${duplicateActiveCount}; duplicateSlot=${duplicateSlotCount}; missingActive=${missingActiveEnrollmentCount}; orphanStudent=${orphanStudentCount}; orphanClass=${orphanClassCount}; slotMismatch=${slotMismatchCount}; invalidImport=${invalidImportCount}; digest=${enrollmentDigest}`,
        failureReason: enrollmentPass ? null : "ENROLLMENT_READINESS_NOT_PASS",
        ownerWave: "W4",
      },
    ];
  },
  assertTransition: async ({ transaction, manifest, targetStatus }) => {
    if (targetStatus !== "ARCHIVED") return;
    const archiveSnapshot = await transaction.get(
      archivePathFor(manifest.semesterId),
    );
    if (
      !archiveSnapshot.exists ||
      archiveSnapshot.data?.archiveStatus !== "FROZEN" ||
      Number(archiveSnapshot.data?.frozenRevision || 0) !==
        Number(manifest.revision || 0) ||
      archiveSnapshot.data?.writeFenceVersion !== WRITE_FENCE_VERSION
    ) {
      fail(
        "failed-precondition",
        "Frozen archive evidence is required before ARCHIVED transition.",
        "ARCHIVE_FREEZE_REQUIRED",
      );
    }
  },
});

const resolveProjectId = (environment = process.env) => {
  const direct = String(
    environment.GCLOUD_PROJECT || environment.GOOGLE_CLOUD_PROJECT || "",
  ).trim();
  if (direct) return direct;
  try {
    return String(
      JSON.parse(String(environment.FIREBASE_CONFIG || "{}"))?.projectId || "",
    ).trim();
  } catch {
    return "";
  }
};

const assertQueryActor = async ({
  store,
  request,
  assertSession,
  highRisk = false,
}) => {
  const identity = await assertSession(request, {
    recentAuth: highRisk,
    highRisk,
  });
  const actorUid = String(identity?.uid || request.auth?.uid || "").trim();
  const actorEmail = String(identity?.email || request.auth?.token?.email || "")
    .trim()
    .toLowerCase();
  if (!actorUid || actorUid !== String(request.auth?.uid || "").trim()) {
    fail(
      "permission-denied",
      "Authenticated actor mismatch.",
      "COMMAND_ACTOR_MISMATCH",
    );
  }
  const profile = await store.get(`users/${actorUid}`);
  return {
    actorUid,
    actorEmail,
    isAdmin: actorEmail === ADMIN_EMAIL,
    profile: profile.exists ? profile.data || {} : {},
  };
};

const normalizeStateQuery = (data) => {
  assertAllowedKeys(
    data,
    ["source", "semesterId", "studentUid", "callSite", "_session"],
    "getArchiveEnrollmentState payload",
  );
  const source = requireTrimmedString(data.source, "source", 20).toUpperCase();
  if (
    !["CURRENT", "PREPARING", "ARCHIVE", "LEGACY", "EXPLICIT"].includes(source)
  ) {
    fail(
      "invalid-argument",
      "source is not supported.",
      "PROVENANCE_SOURCE_INVALID",
    );
  }
  const semesterId =
    data.semesterId === undefined ||
    data.semesterId === null ||
    data.semesterId === ""
      ? null
      : semesterCore.normalizeSemesterId(data.semesterId);
  if (
    ["PREPARING", "ARCHIVE", "EXPLICIT", "LEGACY"].includes(source) &&
    !semesterId
  ) {
    fail(
      "invalid-argument",
      "semesterId is required for the selected source.",
      "SEMESTER_ID_REQUIRED",
    );
  }
  return {
    source,
    semesterId,
    studentUid: data.studentUid ? normalizeUid(data.studentUid) : null,
    callSite: requireTrimmedString(data.callSite, "callSite", 160),
  };
};

const createArchiveEnrollmentQueryCore = ({
  store,
  assertSession = sessionAuthority.assertActiveApplicationSession,
  projectId = resolveProjectId(),
} = {}) => {
  if (!store) throw new TypeError("store is required.");

  const previewEnrollmentRoster = async (request) => {
    const actor = await assertQueryActor({
      store,
      request,
      assertSession,
      highRisk: true,
    });
    if (!actor.isAdmin) {
      fail(
        "permission-denied",
        "Roster preview requires administrator access.",
        "COMMAND_ADMIN_REQUIRED",
      );
    }
    const data = { ...(request.data || {}) };
    delete data._session;
    const payload = normalizeRosterContract(
      data,
      "previewEnrollmentRoster payload",
    );
    const writeCountBefore = Number(store.writeCount || 0);
    const validation = await store.runTransaction((transaction) =>
      validateRoster({ reader: transaction, payload }),
    );
    if (Number(store.writeCount || 0) !== writeCountBefore) {
      fail(
        "internal",
        "Roster preview must not write data.",
        "QUERY_PURITY_VIOLATION",
      );
    }
    return {
      semesterId: payload.semesterId,
      rosterId: payload.rosterId,
      passed: validation.passed,
      validationHash: validation.validationHash,
      summary: validation.summary,
      writeCount: 0,
    };
  };

  const getArchiveEnrollmentState = async (request) => {
    const actor = await assertQueryActor({
      store,
      request,
      assertSession,
      highRisk: false,
    });
    const query = normalizeStateQuery(request.data || {});
    const canManageStudents =
      actor.isAdmin ||
      (actor.profile?.teacherPortalEnabled === true &&
        Array.isArray(actor.profile?.staffPermissions) &&
        actor.profile.staffPermissions.includes("student_list_read"));
    const requestedStudentUid = query.studentUid || actor.actorUid;
    const isSelf = requestedStudentUid === actor.actorUid;
    if (!canManageStudents && !isSelf) {
      fail(
        "permission-denied",
        "Student enrollment access is not allowed.",
        "ENROLLMENT_READ_FORBIDDEN",
      );
    }
    if (
      ["PREPARING", "ARCHIVE", "LEGACY", "EXPLICIT"].includes(query.source) &&
      !actor.isAdmin
    ) {
      fail(
        "permission-denied",
        "Historical and preparation data remain administrator-only until policy approval.",
        "ARCHIVE_ACCESS_POLICY_UNDECIDED",
      );
    }

    return store.runTransaction(async (transaction) => {
      if (query.source === "LEGACY") {
        const legacyDocuments = query.studentUid
          ? await readDocuments(transaction, [`users/${query.studentUid}`])
          : await transaction.query("users");
        const students = legacyDocuments
          .filter(
            (document) =>
              document.exists &&
              String(document.data?.role || "student") !== "teacher",
          )
          .map((document) => ({
            studentUid: document.path.split("/").at(-1),
            displayName: String(
              document.data?.studentName || document.data?.name || "",
            ).trim(),
            grade: String(
              document.data?.studentGrade || document.data?.grade || "",
            ).trim(),
            classNumber: String(
              document.data?.studentClass || document.data?.class || "",
            ).trim(),
            studentNumber: String(
              document.data?.studentNumber || document.data?.number || "",
            ).trim(),
          }));
        console.info("LEGACY_ENROLLMENT_READ", {
          projectId,
          actorUid: actor.actorUid,
          semesterId: query.semesterId,
          callSite: query.callSite,
          recordCount: students.length,
        });
        return {
          semesterId: query.semesterId,
          provenance: "LEGACY",
          source: "users",
          readOnly: true,
          schemaVersion: 0,
          legacy: true,
          status: "LEGACY_READ_ONLY",
          classes: [],
          enrollments: students,
          rosterImports: [],
          archive: null,
        };
      }

      const [pointerSnapshot] = await readDocuments(transaction, [
        semesterCore.ACTIVE_SEMESTER_POINTER_PATH,
      ]);
      let semesterId = query.semesterId;
      if (query.source === "CURRENT") {
        semesterId =
          pointerSnapshot.exists &&
          typeof pointerSnapshot.data?.semesterId === "string"
            ? pointerSnapshot.data.semesterId
            : null;
        if (!semesterId) {
          fail(
            "failed-precondition",
            "No canonical active semester exists.",
            "NO_ACTIVE_SEMESTER",
          );
        }
      }
      const manifestSnapshot = await transaction.get(
        manifestPathFor(semesterId),
      );
      if (!manifestSnapshot.exists) {
        fail(
          "not-found",
          "Semester Manifest does not exist.",
          "SEMESTER_NOT_FOUND",
          { semesterId },
        );
      }
      const manifest = manifestSnapshot.data || {};
      const allowedStatuses =
        query.source === "CURRENT"
          ? ["ACTIVE", "CLOSING"]
          : query.source === "PREPARING"
            ? ["DRAFT", "PREPARING", "VALIDATING", "READY", "FAILED"]
            : query.source === "ARCHIVE"
              ? ["CLOSED", "ARCHIVED"]
              : semesterCore.SEMESTER_STATUSES;
      if (!allowedStatuses.includes(manifest.status)) {
        fail(
          "failed-precondition",
          "Requested source does not match Semester status.",
          "PROVENANCE_SOURCE_MISMATCH",
          {
            source: query.source,
            status: manifest.status,
          },
        );
      }
      if (
        query.source === "CURRENT" &&
        (pointerSnapshot.data?.semesterId !== semesterId ||
          Number(pointerSnapshot.data?.revision || 0) !==
            Number(manifest.revision || 0))
      ) {
        fail(
          "failed-precondition",
          "Active semester pointer is inconsistent.",
          "SEMESTER_ACTIVE_CONFLICT",
        );
      }
      const classes = await transaction.query(SEMESTER_CLASS_COLLECTION, {
        field: "semesterId",
        operator: "==",
        value: semesterId,
      });
      const allEnrollments = await transaction.query(
        SEMESTER_ENROLLMENT_COLLECTION,
        { field: "semesterId", operator: "==", value: semesterId },
      );
      const imports = await transaction.query(ROSTER_IMPORT_COLLECTION, {
        field: "semesterId",
        operator: "==",
        value: semesterId,
      });
      const archiveSnapshot = await transaction.get(archivePathFor(semesterId));
      const enrollments = canManageStudents
        ? allEnrollments
        : allEnrollments.filter(
            (document) => document.data?.studentUid === actor.actorUid,
          );
      return {
        semesterId,
        provenance: manifest.provenance,
        source: `${SEMESTER_ENROLLMENT_COLLECTION}:${semesterId}`,
        readOnly: ["CLOSING", "CLOSED", "ARCHIVED"].includes(manifest.status),
        schemaVersion: W4_SCHEMA_VERSION,
        legacy: false,
        status: manifest.status,
        classes: classes.map((document) => document.data),
        enrollments: enrollments.map((document) => document.data),
        rosterImports: canManageStudents
          ? imports.map((document) => document.data)
          : [],
        archive: archiveSnapshot.exists ? archiveSnapshot.data : null,
      };
    });
  };

  return { previewEnrollmentRoster, getArchiveEnrollmentState };
};

const createArchiveEnrollmentCallableExports = ({ core } = {}) => {
  if (!core) throw new TypeError("archive enrollment query core is required.");
  return {
    previewEnrollmentRoster: onCall({ region: REGION }, (request) =>
      core.previewEnrollmentRoster(request),
    ),
    getArchiveEnrollmentState: onCall({ region: REGION }, (request) =>
      core.getArchiveEnrollmentState(request),
    ),
  };
};

const assertFixtureProject = (projectId) => {
  const normalized = String(projectId || "").trim();
  if (
    normalized !== STAGING_PROJECT_ID &&
    !normalized.startsWith("demo-westory-session-")
  ) {
    fail(
      "failed-precondition",
      "W4 synthetic fixtures are available only in Dedicated Staging or demo projects.",
      "W4_FIXTURE_PROJECT_FORBIDDEN",
    );
  }
};

module.exports = {
  ADMIN_EMAIL,
  ARCHIVE_ENROLLMENT_COMMAND_TYPES,
  ARCHIVE_MANIFEST_COLLECTION,
  ENROLLMENT_SLOT_COLLECTION,
  ENROLLMENT_STATUSES,
  ROSTER_IMPORT_COLLECTION,
  SEMESTER_CLASS_COLLECTION,
  SEMESTER_ENROLLMENT_COLLECTION,
  STUDENT_IDENTITY_COLLECTION,
  STAGING_PROJECT_ID,
  W4_READINESS_REGISTRY_VERSION,
  W4_SCHEMA_VERSION,
  WRITE_FENCE_VERSION,
  assertFixtureProject,
  buildClassId,
  buildEnrollmentId,
  buildEnrollmentSlotId,
  canonicalize,
  createArchiveEnrollmentCallableExports,
  createArchiveEnrollmentCommandAdapter,
  createArchiveEnrollmentQueryCore,
  createArchiveEnrollmentReadinessAdapter,
  hashDocuments,
  normalizeArchiveEnrollmentPayload,
  normalizeRosterContract,
  resolveProjectId,
  sha256,
  validateRoster,
};
