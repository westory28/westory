const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const SEMESTER_MANIFEST_COLLECTION = "semester_manifests";
const SEMESTER_READINESS_REPORT_COLLECTION = "semester_readiness_reports";
const ACTIVE_SEMESTER_POINTER_PATH = "site_settings/semester_active";
const SITE_CONFIG_PATH = "site_settings/config";
const SEMESTER_SCHEMA_VERSION = 1;
const READINESS_POLICY_VERSION = "w3-v1";
const REQUIRED_READINESS_CHECK_COUNT = 11;
const STAGING_PROJECT_ID = "westory-staging-177587430482";

const SEMESTER_COMMAND_TYPES = Object.freeze({
  CREATE_SEMESTER_MANIFEST: "createSemesterManifest",
  UPDATE_OPERATIONAL_SETTINGS: "updateOperationalSettings",
  UPDATE_SEMESTER_MANIFEST: "updateSemesterManifest",
  VALIDATE_SEMESTER_READINESS: "validateSemesterReadiness",
  TRANSITION_SEMESTER_STATUS: "transitionSemesterStatus",
  ACTIVATE_SEMESTER: "activateSemester",
});

const SEMESTER_STATUSES = Object.freeze([
  "DRAFT",
  "PREPARING",
  "VALIDATING",
  "READY",
  "ACTIVE",
  "CLOSING",
  "CLOSED",
  "ARCHIVED",
  "FAILED",
  "QUARANTINED",
]);

const TRANSITION_TABLE = Object.freeze({
  DRAFT: Object.freeze(["PREPARING"]),
  PREPARING: Object.freeze([]),
  VALIDATING: Object.freeze(["READY", "FAILED", "PREPARING"]),
  READY: Object.freeze(["PREPARING", "VALIDATING"]),
  ACTIVE: Object.freeze(["CLOSING"]),
  CLOSING: Object.freeze(["ACTIVE", "CLOSED"]),
  CLOSED: Object.freeze(["ARCHIVED"]),
  ARCHIVED: Object.freeze([]),
  FAILED: Object.freeze(["PREPARING", "QUARANTINED"]),
  QUARANTINED: Object.freeze([]),
});

const fail = (code, message, reason, details = {}) => {
  throw new HttpsError(code, message, { reason, ...details });
};

const isPlainObject = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

const normalizeSchoolYear = (value) => {
  const schoolYear = String(value ?? "").trim();
  if (!/^\d{4}$/.test(schoolYear)) {
    fail("invalid-argument", "schoolYear must be a four-digit year.", "SEMESTER_ID_INVALID");
  }
  const numericYear = Number(schoolYear);
  if (numericYear < 2000 || numericYear > 2100) {
    fail("invalid-argument", "schoolYear is outside the supported range.", "SEMESTER_ID_INVALID");
  }
  return schoolYear;
};

const normalizeTerm = (value) => {
  const term = String(value ?? "").trim();
  if (term !== "1" && term !== "2") {
    fail("invalid-argument", "term must be 1 or 2.", "SEMESTER_ID_INVALID");
  }
  return term;
};

const buildSemesterId = (schoolYear, term) => `${schoolYear}-${term}`;

const normalizeSemesterId = (value) => {
  const semesterId = requireTrimmedString(value, "semesterId", 16);
  const match = /^(\d{4})-([12])$/.exec(semesterId);
  if (!match) {
    fail("invalid-argument", "semesterId must use YYYY-1 or YYYY-2.", "SEMESTER_ID_INVALID");
  }
  normalizeSchoolYear(match[1]);
  return semesterId;
};

const normalizeExpectedRevision = (value) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(
      "invalid-argument",
      "expectedRevision must be a positive safe integer.",
      "COMMAND_PAYLOAD_INVALID",
    );
  }
  return value;
};

const normalizeDate = (value, label) => {
  const normalized = requireTrimmedString(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    fail("invalid-argument", `${label} must use YYYY-MM-DD.`, "SEMESTER_DATE_RANGE_INVALID");
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    fail("invalid-argument", `${label} is not a real date.`, "SEMESTER_DATE_RANGE_INVALID");
  }
  return normalized;
};

const normalizeDateRange = ({ schoolYear, startDate, endDate }) => {
  const startAt = normalizeDate(startDate, "startDate");
  const endAt = normalizeDate(endDate, "endDate");
  if (startAt >= endAt || startAt.slice(0, 4) !== schoolYear) {
    fail(
      "invalid-argument",
      "Semester dates must begin in schoolYear and start before endDate.",
      "SEMESTER_DATE_RANGE_INVALID",
    );
  }
  return { startAt, endAt };
};

const normalizeFixture = (value) => {
  if (value === undefined) return null;
  if (value !== "PARTIAL_SHELL") {
    fail("invalid-argument", "Unsupported semester test fixture.", "SEMESTER_TEST_FIXTURE_INVALID");
  }
  return value;
};

const normalizeSemesterCommandPayload = (commandType, payload) => {
  if (commandType === SEMESTER_COMMAND_TYPES.CREATE_SEMESTER_MANIFEST) {
    assertAllowedKeys(
      payload,
      ["schoolYear", "term", "displayName", "startDate", "endDate", "_testFixture"],
      "createSemesterManifest payload",
    );
    const schoolYear = normalizeSchoolYear(payload.schoolYear);
    const term = normalizeTerm(payload.term);
    const dates = normalizeDateRange({
      schoolYear,
      startDate: payload.startDate,
      endDate: payload.endDate,
    });
    return {
      schoolYear,
      term,
      semesterId: buildSemesterId(schoolYear, term),
      displayName: requireTrimmedString(payload.displayName, "displayName", 120),
      ...dates,
      testFixture: normalizeFixture(payload._testFixture),
    };
  }

  if (commandType === SEMESTER_COMMAND_TYPES.UPDATE_OPERATIONAL_SETTINGS) {
    assertAllowedKeys(
      payload,
      ["showQuiz", "showScore", "showLesson"],
      "updateOperationalSettings payload",
    );
    ["showQuiz", "showScore", "showLesson"].forEach((field) => {
      if (typeof payload[field] !== "boolean") {
        fail("invalid-argument", `${field} must be a boolean.`, "COMMAND_PAYLOAD_INVALID");
      }
    });
    return {
      showQuiz: payload.showQuiz,
      showScore: payload.showScore,
      showLesson: payload.showLesson,
    };
  }

  if (commandType === SEMESTER_COMMAND_TYPES.UPDATE_SEMESTER_MANIFEST) {
    assertAllowedKeys(
      payload,
      ["semesterId", "expectedRevision", "displayName", "startDate", "endDate", "reason"],
      "updateSemesterManifest payload",
    );
    const semesterId = normalizeSemesterId(payload.semesterId);
    const schoolYear = semesterId.slice(0, 4);
    return {
      semesterId,
      expectedRevision: normalizeExpectedRevision(payload.expectedRevision),
      displayName: requireTrimmedString(payload.displayName, "displayName", 120),
      ...normalizeDateRange({
        schoolYear,
        startDate: payload.startDate,
        endDate: payload.endDate,
      }),
      reason: requireTrimmedString(payload.reason, "reason", 500),
    };
  }

  if (commandType === SEMESTER_COMMAND_TYPES.VALIDATE_SEMESTER_READINESS) {
    assertAllowedKeys(
      payload,
      ["semesterId", "expectedRevision"],
      "validateSemesterReadiness payload",
    );
    return {
      semesterId: normalizeSemesterId(payload.semesterId),
      expectedRevision: normalizeExpectedRevision(payload.expectedRevision),
    };
  }

  if (commandType === SEMESTER_COMMAND_TYPES.TRANSITION_SEMESTER_STATUS) {
    assertAllowedKeys(
      payload,
      ["semesterId", "expectedRevision", "targetStatus", "reason"],
      "transitionSemesterStatus payload",
    );
    const targetStatus = requireTrimmedString(payload.targetStatus, "targetStatus", 24).toUpperCase();
    if (!SEMESTER_STATUSES.includes(targetStatus) || targetStatus === "DRAFT") {
      fail("invalid-argument", "targetStatus is not supported.", "SEMESTER_TRANSITION_INVALID");
    }
    return {
      semesterId: normalizeSemesterId(payload.semesterId),
      expectedRevision: normalizeExpectedRevision(payload.expectedRevision),
      targetStatus,
      reason: requireTrimmedString(payload.reason, "reason", 500),
    };
  }

  if (commandType === SEMESTER_COMMAND_TYPES.ACTIVATE_SEMESTER) {
    assertAllowedKeys(
      payload,
      [
        "semesterId",
        "expectedRevision",
        "readinessPolicyVersion",
        "expectedActiveSemesterId",
      ],
      "activateSemester payload",
    );
    if (payload.expectedActiveSemesterId !== null && typeof payload.expectedActiveSemesterId !== "string") {
      fail(
        "invalid-argument",
        "expectedActiveSemesterId must be a semesterId or null.",
        "COMMAND_PAYLOAD_INVALID",
      );
    }
    return {
      semesterId: normalizeSemesterId(payload.semesterId),
      expectedRevision: normalizeExpectedRevision(payload.expectedRevision),
      readinessPolicyVersion: requireTrimmedString(
        payload.readinessPolicyVersion,
        "readinessPolicyVersion",
        40,
      ),
      expectedActiveSemesterId: payload.expectedActiveSemesterId === null
        ? null
        : normalizeSemesterId(payload.expectedActiveSemesterId),
    };
  }

  fail("invalid-argument", "Unsupported semester commandType.", "COMMAND_TYPE_UNSUPPORTED", {
    commandType,
  });
};

const getSemesterSeedDefinitions = (schoolYear, term, getDefaultPointPolicy = () => ({})) => {
  const prefix = `years/${schoolYear}/semesters/${term}`;
  return [
    {
      checkId: "point_policy",
      path: `${prefix}/point_policies/current`,
      data: getDefaultPointPolicy(),
    },
    {
      checkId: "assessment_settings",
      path: `${prefix}/assessment_config/settings`,
      data: { gradingPlanRefs: [], assessmentRefs: [] },
    },
    {
      checkId: "final_exam_config",
      path: `${prefix}/exam_config/final_exam`,
      data: { enabled: false, assessmentRefs: [] },
    },
    {
      checkId: "grading_plans_meta",
      path: `${prefix}/grading_plans_meta/current`,
      data: { planCount: 0 },
    },
    {
      checkId: "calendar_meta",
      path: `${prefix}/calendar_meta/current`,
      data: { eventCount: 0 },
    },
    {
      checkId: "notices_meta",
      path: `${prefix}/notices_meta/current`,
      data: { noticeCount: 0 },
    },
  ];
};

const provenanceForStatus = (status) => {
  if (status === "ACTIVE" || status === "CLOSING") return "CURRENT";
  if (status === "CLOSED" || status === "ARCHIVED") return "ARCHIVE";
  if (status === "QUARANTINED") return "LEGACY";
  return "PREPARING";
};

const serializeManifestResult = (manifest) => ({
  semesterId: manifest.semesterId,
  schoolYear: manifest.schoolYear,
  term: manifest.term,
  displayName: manifest.displayName,
  status: manifest.status,
  startAt: manifest.startAt,
  endAt: manifest.endAt,
  schemaVersion: manifest.schemaVersion,
  revision: manifest.revision,
  stateRevision: manifest.stateRevision,
  readinessPolicyVersion: manifest.readinessPolicyVersion,
  provenance: manifest.provenance,
  blockingIssues: Array.isArray(manifest.blockingIssues) ? manifest.blockingIssues : [],
  shellState: manifest.shellState,
  seedCount: manifest.seedCount,
  requiredSeedCount: manifest.requiredSeedCount,
  seedRefs: Array.isArray(manifest.seedRefs) ? manifest.seedRefs : [],
  createdBy: manifest.createdBy || null,
  updatedBy: manifest.updatedBy || null,
});

const normalizeForHash = (value) => {
  if (value === null || value === undefined) return value ?? null;
  if (["string", "boolean", "number"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (typeof value?.toMillis === "function") return { __timestampMillis: value.toMillis() };
  if (value instanceof Date) return { __dateMillis: value.getTime() };
  if (typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (!["createdAt", "updatedAt"].includes(key)) {
        result[key] = normalizeForHash(value[key]);
      }
      return result;
    }, {});
  }
  return String(value);
};

const readinessCheckFingerprint = (checks = []) => checks.map((check) => ({
  checkId: check.checkId,
  required: check.required === true,
  status: check.status,
  evidence: check.evidence || "",
  failureReason: check.failureReason || null,
  ownerWave: check.ownerWave || "",
}));

const hashDependencyDocuments = (documents, extensionChecks = []) => createHash("sha256")
  .update(JSON.stringify(documents.map((document) => ({
    path: document.path,
    exists: document.exists,
    data: normalizeForHash(document.data),
  })).concat([{ extensionChecks: readinessCheckFingerprint(extensionChecks) }])), "utf8")
  .digest("hex");

const readDocuments = async (reader, paths) => {
  if (paths.length === 0) return [];
  if (typeof reader.getAll === "function") return reader.getAll(paths);
  const documents = [];
  for (const path of paths) documents.push(await reader.get(path));
  return documents;
};

const isFixtureProject = (projectId) => {
  const normalized = String(projectId || "").trim();
  return normalized.startsWith("demo-westory-session-")
    || normalized === STAGING_PROJECT_ID;
};

const assertManifestExists = (snapshot, semesterId) => {
  if (!snapshot.exists) {
    fail("not-found", "Semester Manifest does not exist.", "SEMESTER_NOT_FOUND", {
      semesterId,
    });
  }
  return snapshot.data || {};
};

const assertRevision = (manifest, payload) => {
  const currentRevision = Number(manifest.revision || 0);
  if (currentRevision !== payload.expectedRevision) {
    fail("aborted", "Semester Manifest revision has changed.", "SEMESTER_REVISION_CONFLICT", {
      semesterId: payload.semesterId,
      currentRevision,
    });
  }
};

const isValidManifestSchema = (manifest, semesterId) =>
  manifest.semesterId === semesterId
  && buildSemesterId(String(manifest.schoolYear || ""), String(manifest.term || "")) === semesterId
  && typeof manifest.displayName === "string"
  && manifest.displayName.trim().length > 0
  && SEMESTER_STATUSES.includes(manifest.status)
  && Number.isSafeInteger(manifest.revision)
  && manifest.revision >= 1;

const isValidStoredDateRange = (manifest) => {
  try {
    const { startAt, endAt } = normalizeDateRange({
      schoolYear: String(manifest.schoolYear || ""),
      startDate: manifest.startAt,
      endDate: manifest.endAt,
    });
    return startAt < endAt;
  } catch {
    return false;
  }
};

const buildCheck = ({
  checkId,
  label,
  category,
  required = true,
  status,
  evidence,
  failureReason = null,
  ownerWave = "W3",
  evaluatedAt,
  revision,
}) => ({
  checkId,
  label,
  category,
  required,
  status,
  severity: required ? (status === "PASS" ? "INFO" : "BLOCKER") : "ADVISORY",
  evidence,
  resultSummary: evidence,
  evaluatedAt,
  evaluatedRevision: revision,
  policyVersion: READINESS_POLICY_VERSION,
  failureReason,
  ownerWave,
});

const normalizeExtensionCheck = (check, { evaluatedAt, revision }) => {
  if (!isPlainObject(check)) {
    fail("failed-precondition", "Readiness adapter returned an invalid check.", "SEMESTER_READINESS_ADAPTER_INVALID");
  }
  const checkId = requireTrimmedString(check.checkId, "readiness checkId", 80);
  if (!/^[a-z][a-z0-9_]*$/.test(checkId)) {
    fail("failed-precondition", "Readiness checkId is invalid.", "SEMESTER_READINESS_ADAPTER_INVALID");
  }
  const status = String(check.status || "").trim().toUpperCase();
  if (!["PASS", "FAIL", "WARNING", "PENDING", "NOT_APPLICABLE"].includes(status)) {
    fail("failed-precondition", "Readiness check status is invalid.", "SEMESTER_READINESS_ADAPTER_INVALID");
  }
  if (typeof check.required !== "boolean") {
    fail("failed-precondition", "Readiness check required flag is invalid.", "SEMESTER_READINESS_ADAPTER_INVALID");
  }
  return buildCheck({
    checkId,
    label: requireTrimmedString(check.label, "readiness check label", 160),
    category: requireTrimmedString(check.category, "readiness check category", 80),
    required: check.required,
    status,
    evidence: requireTrimmedString(check.evidence, "readiness check evidence", 1_000),
    failureReason: check.failureReason
      ? requireTrimmedString(check.failureReason, "readiness failureReason", 160)
      : null,
    ownerWave: requireTrimmedString(check.ownerWave, "readiness ownerWave", 80),
    evaluatedAt,
    revision,
  });
};

const buildReadinessReport = ({
  manifest,
  allManifests,
  activePointer,
  seedDocuments,
  reportId,
  timestamp,
  checkEvaluatedAt,
  actorUid,
  extensionChecks = [],
}) => {
  const semesterId = manifest.semesterId;
  const revision = Number(manifest.revision || 0);
  const sameIdentity = allManifests.filter((document) =>
    String(document.data?.schoolYear || "") === String(manifest.schoolYear || "")
    && String(document.data?.term || "") === String(manifest.term || ""));
  const activeManifests = allManifests.filter((document) => document.data?.status === "ACTIVE");
  const missingSeeds = seedDocuments.filter((document) => !document.exists);
  const pendingSeeds = seedDocuments.filter((document) =>
    document.exists && document.data?.seedState === "PENDING");
  const untrustedSeeds = seedDocuments.filter((document) =>
    document.exists
    && (
      document.data?.managedBy !== "semesterCore"
      || document.data?.semesterId !== semesterId
      || Number(document.data?.schemaVersion || 0) !== SEMESTER_SCHEMA_VERSION
    ));
  const blockingIssues = Array.isArray(manifest.blockingIssues)
    ? manifest.blockingIssues.filter(Boolean)
    : ["blockingIssues is not an array"];
  const pointerSemesterId = typeof activePointer?.semesterId === "string"
    ? activePointer.semesterId
    : null;
  const pointerRevision = Number(activePointer?.revision || 0);
  const activeConflict = activeManifests.length > 1
    || (activeManifests.length === 1 && pointerSemesterId !== activeManifests[0].data?.semesterId)
    || (activeManifests.length === 1
      && pointerRevision !== Number(activeManifests[0].data?.revision || 0))
    || (activeManifests.length === 0 && pointerSemesterId !== null);
  const shellStatus = missingSeeds.length > 0 || manifest.shellState !== "COMPLETE"
    ? "PENDING"
    : untrustedSeeds.length > 0 || pendingSeeds.length > 0
      ? "FAIL"
      : "PASS";

  const requiredChecks = [
    buildCheck({
      checkId: "manifest_schema",
      label: "Manifest schema",
      category: "MANIFEST",
      status: isValidManifestSchema(manifest, semesterId) ? "PASS" : "FAIL",
      evidence: `schemaVersion=${manifest.schemaVersion}; revision=${revision}`,
      failureReason: isValidManifestSchema(manifest, semesterId) ? null : "SEMESTER_MANIFEST_SCHEMA_INVALID",
      evaluatedAt: checkEvaluatedAt,
      revision,
    }),
    buildCheck({
      checkId: "semester_identity_unique",
      label: "Unique schoolYear and term",
      category: "IDENTITY",
      status: sameIdentity.length === 1 ? "PASS" : "FAIL",
      evidence: `matchingManifestCount=${sameIdentity.length}`,
      failureReason: sameIdentity.length === 1 ? null : "SEMESTER_IDENTITY_NOT_UNIQUE",
      evaluatedAt: checkEvaluatedAt,
      revision,
    }),
    buildCheck({
      checkId: "date_range",
      label: "Semester date range",
      category: "MANIFEST",
      status: isValidStoredDateRange(manifest) ? "PASS" : "FAIL",
      evidence: `${manifest.startAt || "missing"}..${manifest.endAt || "missing"}`,
      failureReason: isValidStoredDateRange(manifest) ? null : "SEMESTER_DATE_RANGE_INVALID",
      evaluatedAt: checkEvaluatedAt,
      revision,
    }),
    buildCheck({
      checkId: "required_settings",
      label: "Required semester settings",
      category: "DEPENDENCY",
      status: missingSeeds.length === 0 && pendingSeeds.length === 0 ? "PASS" : (pendingSeeds.length ? "PENDING" : "FAIL"),
      evidence: `present=${seedDocuments.length - missingSeeds.length}/${seedDocuments.length}; pending=${pendingSeeds.length}`,
      failureReason: missingSeeds.length === 0 && pendingSeeds.length === 0 ? null : "SEMESTER_REQUIRED_SETTINGS_INCOMPLETE",
      evaluatedAt: checkEvaluatedAt,
      revision,
    }),
    buildCheck({
      checkId: "status_transition",
      label: "Validation state transition",
      category: "STATE",
      status: ["PREPARING", "VALIDATING", "READY"].includes(manifest.status) ? "PASS" : "FAIL",
      evidence: `status=${manifest.status}`,
      failureReason: ["PREPARING", "VALIDATING", "READY"].includes(manifest.status) ? null : "SEMESTER_TRANSITION_INVALID",
      evaluatedAt: checkEvaluatedAt,
      revision,
    }),
    buildCheck({
      checkId: "schema_version",
      label: "Supported schema version",
      category: "VERSION",
      status: manifest.schemaVersion === SEMESTER_SCHEMA_VERSION ? "PASS" : "FAIL",
      evidence: `schemaVersion=${manifest.schemaVersion}`,
      failureReason: manifest.schemaVersion === SEMESTER_SCHEMA_VERSION ? null : "SEMESTER_SCHEMA_VERSION_UNSUPPORTED",
      evaluatedAt: checkEvaluatedAt,
      revision,
    }),
    buildCheck({
      checkId: "readiness_policy_version",
      label: "Supported readiness policy",
      category: "VERSION",
      status: manifest.readinessPolicyVersion === READINESS_POLICY_VERSION ? "PASS" : "FAIL",
      evidence: `policyVersion=${manifest.readinessPolicyVersion || "missing"}`,
      failureReason: manifest.readinessPolicyVersion === READINESS_POLICY_VERSION ? null : "SEMESTER_POLICY_VERSION_MISMATCH",
      evaluatedAt: checkEvaluatedAt,
      revision,
    }),
    buildCheck({
      checkId: "active_semester_conflict",
      label: "Exactly one coherent active semester",
      category: "ACTIVATION",
      status: activeConflict ? "FAIL" : "PASS",
      evidence: `activeCount=${activeManifests.length}; pointer=${pointerSemesterId || "none"}`,
      failureReason: activeConflict ? "SEMESTER_ACTIVE_CONFLICT" : null,
      evaluatedAt: checkEvaluatedAt,
      revision,
    }),
    buildCheck({
      checkId: "revision_freshness",
      label: "Manifest revision freshness",
      category: "REVISION",
      status: "PASS",
      evidence: `evaluatedRevision=${revision}`,
      evaluatedAt: checkEvaluatedAt,
      revision,
    }),
    buildCheck({
      checkId: "blocking_issues",
      label: "Unresolved blocking issues",
      category: "GOVERNANCE",
      status: blockingIssues.length === 0 ? "PASS" : "FAIL",
      evidence: `blockingIssueCount=${blockingIssues.length}`,
      failureReason: blockingIssues.length === 0 ? null : "SEMESTER_BLOCKING_ISSUES_UNRESOLVED",
      evaluatedAt: checkEvaluatedAt,
      revision,
    }),
    buildCheck({
      checkId: "trusted_shell_complete",
      label: "Trusted shell completeness",
      category: "DEPENDENCY",
      status: shellStatus,
      evidence: `shellState=${manifest.shellState || "missing"}; missing=${missingSeeds.length}; untrusted=${untrustedSeeds.length}`,
      failureReason: shellStatus === "PASS" ? null : "SEMESTER_PARTIAL_SHELL",
      evaluatedAt: checkEvaluatedAt,
      revision,
    }),
  ];

  const durationDays = isValidStoredDateRange(manifest)
    ? Math.round((Date.parse(`${manifest.endAt}T00:00:00Z`) - Date.parse(`${manifest.startAt}T00:00:00Z`)) / 86_400_000)
    : 0;
  const durationWarning = durationDays < 60 || durationDays > 220;
  const checks = [
    ...requiredChecks,
    buildCheck({
      checkId: "semester_duration_advisory",
      label: "Semester duration advisory",
      category: "ADVISORY",
      required: false,
      status: durationWarning ? "WARNING" : "PASS",
      evidence: `durationDays=${durationDays}`,
      failureReason: durationWarning ? "SEMESTER_DURATION_UNUSUAL" : null,
      ownerWave: "W3",
      evaluatedAt: checkEvaluatedAt,
      revision,
    }),
    ...extensionChecks,
  ];
  const allRequiredChecks = checks.filter((check) => check.required === true);
  const requiredPassed = allRequiredChecks.filter((check) => check.status === "PASS").length;
  const requiredTotal = allRequiredChecks.length;
  const status = requiredPassed === requiredTotal ? "PASS" : "FAIL";
  return {
    schemaVersion: 1,
    reportId,
    semesterId,
    status,
    stale: false,
    policyVersion: READINESS_POLICY_VERSION,
    evaluatedRevision: revision,
    dependencyHash: hashDependencyDocuments(seedDocuments, extensionChecks),
    requiredPassed,
    requiredTotal,
    warningCount: checks.filter((check) => check.status === "WARNING").length,
    checks,
    evaluatedAt: timestamp,
    evaluatedBy: actorUid,
    manifestRef: `${SEMESTER_MANIFEST_COLLECTION}/${semesterId}`,
  };
};

const assertReadinessCurrent = ({
  manifest,
  report,
  seedDocuments,
  requestedPolicyVersion,
  extensionChecks = [],
}) => {
  if (!report) {
    fail("failed-precondition", "Readiness report does not exist.", "SEMESTER_READINESS_NOT_FOUND");
  }
  if (
    report.status === "STALE"
    || report.stale === true
    || report.evaluatedRevision !== manifest.revision
    || report.dependencyHash !== hashDependencyDocuments(seedDocuments, extensionChecks)
  ) {
    fail("failed-precondition", "Readiness report is stale.", "SEMESTER_READINESS_STALE", {
      evaluatedRevision: report.evaluatedRevision || null,
      currentRevision: manifest.revision || null,
    });
  }
  const policyVersion = requestedPolicyVersion || manifest.readinessPolicyVersion;
  if (
    policyVersion !== READINESS_POLICY_VERSION
    || manifest.readinessPolicyVersion !== READINESS_POLICY_VERSION
    || report.policyVersion !== READINESS_POLICY_VERSION
  ) {
    fail(
      "failed-precondition",
      "Readiness policy version does not match.",
      "SEMESTER_POLICY_VERSION_MISMATCH",
    );
  }
  const requiredChecks = Array.isArray(report.checks)
    ? report.checks.filter((check) => check?.required === true)
    : [];
  if (
    report.status !== "PASS"
    || requiredChecks.length < REQUIRED_READINESS_CHECK_COUNT
    || Number(report.requiredTotal || 0) !== requiredChecks.length
    || requiredChecks.some((check) => check.status !== "PASS")
  ) {
    fail(
      "failed-precondition",
      "All required readiness checks must pass.",
      "SEMESTER_READINESS_NOT_PASS",
    );
  }
};

const assertReadinessFailureCurrent = ({
  manifest,
  report,
  seedDocuments,
  extensionChecks = [],
}) => {
  if (!report) {
    fail("failed-precondition", "Readiness report does not exist.", "SEMESTER_READINESS_NOT_FOUND");
  }
  if (
    report.status === "STALE"
    || report.stale === true
    || report.evaluatedRevision !== manifest.revision
    || report.dependencyHash !== hashDependencyDocuments(seedDocuments, extensionChecks)
  ) {
    fail("failed-precondition", "Readiness report is stale.", "SEMESTER_READINESS_STALE");
  }
  if (report.status !== "FAIL") {
    fail(
      "failed-precondition",
      "FAILED requires a current failed readiness report.",
      "SEMESTER_READINESS_NOT_FAIL",
    );
  }
};

const evaluateReadinessAdapters = async ({
  readinessAdapters,
  transaction,
  manifest,
  evaluatedAt,
}) => {
  if (!Array.isArray(readinessAdapters)) {
    throw new TypeError("readinessAdapters must be an array.");
  }
  const rawChecks = [];
  for (const adapter of readinessAdapters) {
    if (!adapter || typeof adapter.evaluate !== "function") {
      fail(
        "failed-precondition",
        "Readiness adapter is not callable.",
        "SEMESTER_READINESS_ADAPTER_INVALID",
      );
    }
    const result = await adapter.evaluate({
      transaction: {
        get: (path) => transaction.get(path),
        getAll: (paths) => typeof transaction.getAll === "function"
          ? transaction.getAll(paths)
          : Promise.all(paths.map((path) => transaction.get(path))),
        query: (collectionPath, filter = null) => transaction.query(collectionPath, filter),
      },
      manifest,
      policyVersion: READINESS_POLICY_VERSION,
    });
    const adapterChecks = Array.isArray(result) ? result : result?.checks;
    if (!Array.isArray(adapterChecks)) {
      fail(
        "failed-precondition",
        "Readiness adapter did not return checks.",
        "SEMESTER_READINESS_ADAPTER_INVALID",
      );
    }
    rawChecks.push(...adapterChecks);
  }
  const checks = rawChecks.map((check) => normalizeExtensionCheck(check, {
    evaluatedAt,
    revision: manifest.revision,
  }));
  const reservedIds = new Set([
    "manifest_schema",
    "semester_identity_unique",
    "date_range",
    "required_settings",
    "status_transition",
    "schema_version",
    "readiness_policy_version",
    "active_semester_conflict",
    "revision_freshness",
    "blocking_issues",
    "trusted_shell_complete",
    "semester_duration_advisory",
  ]);
  checks.forEach((check) => {
    if (reservedIds.has(check.checkId)) {
      fail(
        "failed-precondition",
        "Readiness adapter checkId is already registered.",
        "SEMESTER_READINESS_ADAPTER_INVALID",
        { checkId: check.checkId },
      );
    }
    reservedIds.add(check.checkId);
  });
  return checks;
};

const createSemesterCoreCommandAdapter = ({
  getDefaultPointPolicy = () => ({}),
  projectId = "",
  evaluationClock = () => new Date().toISOString(),
  readinessAdapters = [],
} = {}) => {
  if (!Array.isArray(readinessAdapters)) {
    throw new TypeError("readinessAdapters must be an array.");
  }
  const evaluateReadinessExtensions = ({ transaction, manifest, evaluatedAt }) =>
    evaluateReadinessAdapters({ readinessAdapters, transaction, manifest, evaluatedAt });

  const apply = async ({
    transaction,
    commandId,
    commandType,
    payload,
    receiptId,
    timestamp,
    actor,
  }) => {
    if (commandType === SEMESTER_COMMAND_TYPES.UPDATE_OPERATIONAL_SETTINGS) {
      transaction.set(SITE_CONFIG_PATH, {
        showQuiz: payload.showQuiz,
        showScore: payload.showScore,
        showLesson: payload.showLesson,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
      }, { merge: true });
      return {
        target: { refs: [SITE_CONFIG_PATH] },
        sourceHash: null,
        result: {
          showQuiz: payload.showQuiz,
          showScore: payload.showScore,
          showLesson: payload.showLesson,
        },
      };
    }

    if (commandType === SEMESTER_COMMAND_TYPES.CREATE_SEMESTER_MANIFEST) {
      if (payload.testFixture && !isFixtureProject(projectId)) {
        fail(
          "invalid-argument",
          "Semester test fixtures are not available in this environment.",
          "SEMESTER_TEST_FIXTURE_FORBIDDEN",
        );
      }
      const allSeeds = getSemesterSeedDefinitions(
        payload.schoolYear,
        payload.term,
        getDefaultPointPolicy,
      );
      const manifestPath = `${SEMESTER_MANIFEST_COLLECTION}/${payload.semesterId}`;
      const [manifestDocument, ...existingSeedDocuments] = await readDocuments(
        transaction,
        [manifestPath, ...allSeeds.map((seed) => seed.path)],
      );
      if (manifestDocument.exists) {
        fail(
          "already-exists",
          "A Semester Manifest already exists for schoolYear and term.",
          "SEMESTER_ALREADY_EXISTS",
          {
            semesterId:
              manifestDocument.data?.semesterId || payload.semesterId,
          },
        );
      }
      const existingSeeds = existingSeedDocuments.filter((document) => document.exists);
      const fixtureMayAdoptExistingPointPolicy = payload.testFixture === "PARTIAL_SHELL"
        && existingSeeds.length === 1
        && existingSeeds[0].path === allSeeds[0].path;
      if (existingSeeds.length > 0 && !fixtureMayAdoptExistingPointPolicy) {
        fail(
          "failed-precondition",
          "Semester seed paths already contain data and require an explicit migration.",
          "SEMESTER_SEED_CONFLICT",
          { refs: existingSeeds.map((document) => document.path) },
        );
      }
      const seeds = payload.testFixture === "PARTIAL_SHELL" ? allSeeds.slice(0, 1) : allSeeds;
      const seedRefs = seeds.map((seed) => seed.path);
      const manifest = {
        semesterId: payload.semesterId,
        schoolYear: payload.schoolYear,
        term: payload.term,
        displayName: payload.displayName,
        status: "DRAFT",
        startAt: payload.startAt,
        endAt: payload.endAt,
        schemaVersion: SEMESTER_SCHEMA_VERSION,
        revision: 1,
        stateRevision: 1,
        readinessPolicyVersion: READINESS_POLICY_VERSION,
        provenance: "PREPARING",
        blockingIssues: [],
        shellState: payload.testFixture === "PARTIAL_SHELL" ? "PARTIAL" : "COMPLETE",
        seedCount: seeds.length,
        requiredSeedCount: allSeeds.length,
        seedRefs,
        createdAt: timestamp,
        createdBy: actor.actorUid,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
        activatedAt: null,
        activatedBy: null,
        closedAt: null,
        closedBy: null,
      };
      transaction.create(`${SEMESTER_MANIFEST_COLLECTION}/${payload.semesterId}`, manifest);
      seeds.forEach((seed, index) => {
        if (!existingSeedDocuments[index].exists) {
          transaction.create(seed.path, {
            ...seed.data,
            semesterId: payload.semesterId,
            schemaVersion: SEMESTER_SCHEMA_VERSION,
            seedState: "COMPLETE",
            managedBy: "semesterCore",
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      });
      return {
        target: {
          semesterId: payload.semesterId,
          refs: [`${SEMESTER_MANIFEST_COLLECTION}/${payload.semesterId}`, ...seedRefs],
        },
        sourceHash: null,
        result: {
          semester: serializeManifestResult(manifest),
          seedCount: seeds.length,
          seedRefs,
        },
      };
    }

    const manifestPath = `${SEMESTER_MANIFEST_COLLECTION}/${payload.semesterId}`;
    const readinessPath = `${SEMESTER_READINESS_REPORT_COLLECTION}/${payload.semesterId}`;

    if (commandType === SEMESTER_COMMAND_TYPES.UPDATE_SEMESTER_MANIFEST) {
      const [manifestSnapshot, reportSnapshot] = await readDocuments(transaction, [
        manifestPath,
        readinessPath,
      ]);
      const manifest = assertManifestExists(manifestSnapshot, payload.semesterId);
      assertRevision(manifest, payload);
      if (["ACTIVE", "CLOSING", "CLOSED", "ARCHIVED", "QUARANTINED"].includes(manifest.status)) {
        fail(
          "failed-precondition",
          "This Semester Manifest cannot be edited in its current state.",
          "SEMESTER_TRANSITION_INVALID",
          { status: manifest.status },
        );
      }
      const nextRevision = manifest.revision + 1;
      const nextStatus = ["VALIDATING", "READY", "FAILED"].includes(manifest.status)
        ? "PREPARING"
        : manifest.status;
      const manifestUpdate = {
        displayName: payload.displayName,
        startAt: payload.startAt,
        endAt: payload.endAt,
        revision: nextRevision,
        stateRevision: Number(manifest.stateRevision || 0) + (nextStatus === manifest.status ? 0 : 1),
        status: nextStatus,
        provenance: provenanceForStatus(nextStatus),
        readinessReportId: null,
        readinessReportRef: null,
        lastChangeReason: payload.reason,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
      };
      transaction.set(manifestPath, manifestUpdate, { merge: true });
      if (reportSnapshot.exists) {
        transaction.set(readinessPath, {
          status: "STALE",
          stale: true,
          staleAt: timestamp,
          staleBy: actor.actorUid,
          staleReason: payload.reason,
          currentRevision: nextRevision,
        }, { merge: true });
      }
      return {
        target: {
          semesterId: payload.semesterId,
          refs: reportSnapshot.exists ? [manifestPath, readinessPath] : [manifestPath],
        },
        sourceHash: null,
        result: {
          semester: serializeManifestResult({ ...manifest, ...manifestUpdate }),
          readinessInvalidated: reportSnapshot.exists,
        },
      };
    }

    const seedDefinitions = getSemesterSeedDefinitions(
      payload.semesterId.slice(0, 4),
      payload.semesterId.slice(-1),
      getDefaultPointPolicy,
    );

    if (commandType === SEMESTER_COMMAND_TYPES.VALIDATE_SEMESTER_READINESS) {
      const allManifests = await transaction.query(SEMESTER_MANIFEST_COLLECTION);
      const [manifestSnapshot, pointerSnapshot, ...seedDocuments] = await readDocuments(
        transaction,
        [
          manifestPath,
          ACTIVE_SEMESTER_POINTER_PATH,
          ...seedDefinitions.map((seed) => seed.path),
        ],
      );
      const manifest = assertManifestExists(manifestSnapshot, payload.semesterId);
      assertRevision(manifest, payload);
      if (!["PREPARING", "VALIDATING", "READY"].includes(manifest.status)) {
        fail(
          "failed-precondition",
          "Readiness validation is not allowed in the current state.",
          "SEMESTER_TRANSITION_INVALID",
          { status: manifest.status },
        );
      }
      const reportId = `readiness_${receiptId.slice(4)}`;
      const checkEvaluatedAt = evaluationClock();
      const extensionChecks = await evaluateReadinessExtensions({
        transaction,
        manifest,
        evaluatedAt: checkEvaluatedAt,
      });
      const report = buildReadinessReport({
        manifest,
        allManifests,
        activePointer: pointerSnapshot.exists ? pointerSnapshot.data : null,
        seedDocuments,
        reportId,
        timestamp,
        checkEvaluatedAt,
        actorUid: actor.actorUid,
        extensionChecks,
      });
      const versionPath = `${readinessPath}/versions/${reportId}`;
      transaction.set(manifestPath, {
        status: "VALIDATING",
        stateRevision: Number(manifest.stateRevision || 0) + (manifest.status === "VALIDATING" ? 0 : 1),
        provenance: "PREPARING",
        readinessReportId: reportId,
        readinessReportRef: readinessPath,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
      }, { merge: true });
      transaction.set(readinessPath, report);
      transaction.create(versionPath, report);
      return {
        target: {
          semesterId: payload.semesterId,
          refs: [manifestPath, readinessPath, versionPath, ...seedDefinitions.map((seed) => seed.path)],
        },
        sourceHash: report.dependencyHash,
        result: {
          semesterId: payload.semesterId,
          status: report.status,
          reportId,
          evaluatedRevision: report.evaluatedRevision,
          requiredPassed: report.requiredPassed,
          requiredTotal: report.requiredTotal,
        },
      };
    }

    if (commandType === SEMESTER_COMMAND_TYPES.TRANSITION_SEMESTER_STATUS) {
      const activeManifests = await transaction.query(SEMESTER_MANIFEST_COLLECTION, {
        field: "status",
        operator: "==",
        value: "ACTIVE",
      });
      const [manifestSnapshot, reportSnapshot, pointerSnapshot, ...seedDocuments] =
        await readDocuments(transaction, [
          manifestPath,
          readinessPath,
          ACTIVE_SEMESTER_POINTER_PATH,
          ...seedDefinitions.map((seed) => seed.path),
        ]);
      const manifest = assertManifestExists(manifestSnapshot, payload.semesterId);
      assertRevision(manifest, payload);
      const extensionChecks = (
        payload.targetStatus === "READY"
        || payload.targetStatus === "FAILED"
      ) ? await evaluateReadinessExtensions({
          transaction,
          manifest,
          evaluatedAt: evaluationClock(),
        }) : [];
      if (payload.targetStatus === "ACTIVE" && manifest.status !== "CLOSING") {
        fail(
          "failed-precondition",
          "ACTIVE is available only through activateSemester.",
          "SEMESTER_TRANSITION_INVALID",
        );
      }
      if (!TRANSITION_TABLE[manifest.status]?.includes(payload.targetStatus)) {
        fail(
          "failed-precondition",
          "Semester status transition is not allowed.",
          "SEMESTER_TRANSITION_INVALID",
          { fromStatus: manifest.status, targetStatus: payload.targetStatus },
        );
      }
      for (const adapter of readinessAdapters) {
        if (typeof adapter?.assertTransition !== "function") continue;
        await adapter.assertTransition({
          transaction: {
            get: (path) => transaction.get(path),
            getAll: (paths) => typeof transaction.getAll === "function"
              ? transaction.getAll(paths)
              : Promise.all(paths.map((path) => transaction.get(path))),
            query: (collectionPath, filter = null) => transaction.query(collectionPath, filter),
          },
          manifest,
          targetStatus: payload.targetStatus,
          policyVersion: READINESS_POLICY_VERSION,
        });
      }
      if (payload.targetStatus === "READY") {
        assertReadinessCurrent({
          manifest,
          report: reportSnapshot.exists ? reportSnapshot.data : null,
          seedDocuments,
          extensionChecks,
        });
      }
      if (payload.targetStatus === "FAILED") {
        assertReadinessFailureCurrent({
          manifest,
          report: reportSnapshot.exists ? reportSnapshot.data : null,
          seedDocuments,
          extensionChecks,
        });
      }
      const pointerSemesterId = pointerSnapshot.exists
        && typeof pointerSnapshot.data?.semesterId === "string"
        ? pointerSnapshot.data.semesterId
        : null;
      const pointerRevision = Number(pointerSnapshot.data?.revision || 0);
      if (["ACTIVE", "CLOSING"].includes(manifest.status)) {
        if (
          pointerSemesterId !== payload.semesterId
          || pointerRevision !== Number(manifest.revision || 0)
          || activeManifests.length > 1
          || (manifest.status === "ACTIVE" && activeManifests.length !== 1)
        ) {
          fail(
            "failed-precondition",
            "Active semester pointer is inconsistent.",
            "SEMESTER_ACTIVE_CONFLICT",
          );
        }
      }
      const invalidatesReadiness = payload.targetStatus === "PREPARING"
        || (manifest.status === "READY" && payload.targetStatus === "VALIDATING");
      transaction.set(manifestPath, {
        status: payload.targetStatus,
        stateRevision: Number(manifest.stateRevision || 0) + 1,
        provenance: provenanceForStatus(payload.targetStatus),
        lastTransitionReason: payload.reason,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
        ...(payload.targetStatus === "CLOSED" ? {
          closedAt: timestamp,
          closedBy: actor.actorUid,
        } : {}),
      }, { merge: true });
      if (invalidatesReadiness && reportSnapshot.exists) {
        transaction.set(readinessPath, {
          status: "STALE",
          stale: true,
          staleAt: timestamp,
          staleBy: actor.actorUid,
          staleReason: payload.reason,
        }, { merge: true });
      }
      if (payload.targetStatus === "CLOSED") {
        transaction.set(ACTIVE_SEMESTER_POINTER_PATH, {
          semesterId: null,
          revision: manifest.revision,
          previousSemesterId: payload.semesterId,
          clearedAt: timestamp,
          clearedBy: actor.actorUid,
          commandId,
        });
        transaction.set(SITE_CONFIG_PATH, {
          activeSemesterId: null,
          activeSemesterRevision: null,
          semesterLifecycleStatus: "CLOSED",
          semesterWritesEnabled: false,
          updatedAt: timestamp,
        }, { merge: true });
      } else if (payload.targetStatus === "CLOSING") {
        transaction.set(SITE_CONFIG_PATH, {
          semesterLifecycleStatus: "CLOSING",
          semesterWritesEnabled: false,
          updatedAt: timestamp,
        }, { merge: true });
      } else if (manifest.status === "CLOSING" && payload.targetStatus === "ACTIVE") {
        transaction.set(SITE_CONFIG_PATH, {
          semesterLifecycleStatus: "ACTIVE",
          semesterWritesEnabled: true,
          updatedAt: timestamp,
        }, { merge: true });
      }
      const updatesLifecycleConfig = payload.targetStatus === "CLOSING"
        || payload.targetStatus === "CLOSED"
        || (manifest.status === "CLOSING" && payload.targetStatus === "ACTIVE");
      return {
        target: {
          semesterId: payload.semesterId,
          refs: [
            manifestPath,
            ...(invalidatesReadiness && reportSnapshot.exists ? [readinessPath] : []),
            ...(payload.targetStatus === "CLOSED" ? [ACTIVE_SEMESTER_POINTER_PATH] : []),
            ...(updatesLifecycleConfig ? [SITE_CONFIG_PATH] : []),
          ],
        },
        sourceHash: null,
        result: {
          semesterId: payload.semesterId,
          status: payload.targetStatus,
          revision: manifest.revision,
        },
      };
    }

    if (commandType === SEMESTER_COMMAND_TYPES.ACTIVATE_SEMESTER) {
      const activeManifests = await transaction.query(SEMESTER_MANIFEST_COLLECTION, {
        field: "status",
        operator: "==",
        value: "ACTIVE",
      });
      const [
        manifestSnapshot,
        reportSnapshot,
        pointerSnapshot,
        configSnapshot,
        ...seedDocuments
      ] = await readDocuments(transaction, [
        manifestPath,
        readinessPath,
        ACTIVE_SEMESTER_POINTER_PATH,
        SITE_CONFIG_PATH,
        ...seedDefinitions.map((seed) => seed.path),
      ]);
      const manifest = assertManifestExists(manifestSnapshot, payload.semesterId);
      assertRevision(manifest, payload);
      const extensionChecks = await evaluateReadinessExtensions({
        transaction,
        manifest,
        evaluatedAt: evaluationClock(),
      });
      assertReadinessCurrent({
        manifest,
        report: reportSnapshot.exists ? reportSnapshot.data : null,
        seedDocuments,
        requestedPolicyVersion: payload.readinessPolicyVersion,
        extensionChecks,
      });
      if (manifest.status === "ACTIVE") {
        fail(
          "already-exists",
          "Semester is already active under a different command.",
          "SEMESTER_ALREADY_ACTIVE",
        );
      }
      if (manifest.status !== "READY" || ["ARCHIVE", "LEGACY"].includes(manifest.provenance)) {
        fail(
          "failed-precondition",
          "Only a READY preparing semester can be activated.",
          "SEMESTER_TRANSITION_INVALID",
          { status: manifest.status, provenance: manifest.provenance },
        );
      }
      const currentPointerId = pointerSnapshot.exists
        && typeof pointerSnapshot.data?.semesterId === "string"
        ? pointerSnapshot.data.semesterId
        : null;
      if (currentPointerId !== payload.expectedActiveSemesterId) {
        fail(
          "aborted",
          "Active semester expectation has changed.",
          "SEMESTER_ACTIVE_EXPECTATION_CONFLICT",
          { currentActiveSemesterId: currentPointerId },
        );
      }
      if (
        (currentPointerId === null && activeManifests.length !== 0)
        || (currentPointerId !== null && (
          activeManifests.length !== 1
          || activeManifests[0].data?.semesterId !== currentPointerId
          || Number(pointerSnapshot.data?.revision || 0)
            !== Number(activeManifests[0].data?.revision || 0)
        ))
      ) {
        fail(
          "failed-precondition",
          "Active semester state is inconsistent.",
          "SEMESTER_ACTIVE_CONFLICT",
        );
      }
      const configYear = String(configSnapshot.data?.year || "").trim();
      const configTerm = String(configSnapshot.data?.semester || "").trim();
      const configData = configSnapshot.data || {};
      const configExplicitlyInactive = configData.semesterLifecycleStatus === "CLOSED"
        || configData.semesterWritesEnabled === false
        || (
          Object.prototype.hasOwnProperty.call(configData, "activeSemesterId")
          && configData.activeSemesterId === null
        );
      const legacyActiveId = !configExplicitlyInactive
        && /^\d{4}$/.test(configYear)
        && ["1", "2"].includes(configTerm)
        ? buildSemesterId(configYear, configTerm)
        : null;
      if (currentPointerId === null && legacyActiveId && legacyActiveId !== payload.semesterId) {
        fail(
          "failed-precondition",
          "Legacy active semester must be bootstrapped before cutover.",
          "SEMESTER_LEGACY_ACTIVE_REQUIRES_BOOTSTRAP",
          { legacyActiveSemesterId: legacyActiveId },
        );
      }

      let previousManifest = null;
      let previousManifestPath = null;
      if (currentPointerId) {
        previousManifestPath = `${SEMESTER_MANIFEST_COLLECTION}/${currentPointerId}`;
        const previousSnapshot = await transaction.get(previousManifestPath);
        previousManifest = assertManifestExists(previousSnapshot, currentPointerId);
        if (!["ACTIVE", "CLOSING"].includes(previousManifest.status)) {
          fail(
            "failed-precondition",
            "The current active semester cannot be closed atomically.",
            "SEMESTER_ACTIVE_POINTER_INVALID",
            { status: previousManifest.status },
          );
        }
      }

      if (previousManifest && previousManifestPath) {
        transaction.set(previousManifestPath, {
          status: "CLOSED",
          stateRevision: Number(previousManifest.stateRevision || 0) + 1,
          provenance: "ARCHIVE",
          closedAt: timestamp,
          closedBy: actor.actorUid,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        }, { merge: true });
      }
      transaction.set(manifestPath, {
        status: "ACTIVE",
        stateRevision: Number(manifest.stateRevision || 0) + 1,
        provenance: "CURRENT",
        activatedAt: timestamp,
        activatedBy: actor.actorUid,
        activationCommandId: commandId,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
      }, { merge: true });
      const activePointer = {
        semesterId: payload.semesterId,
        revision: manifest.revision,
        previousSemesterId: currentPointerId,
        activatedAt: timestamp,
        activatedBy: actor.actorUid,
        commandId,
      };
      transaction.set(ACTIVE_SEMESTER_POINTER_PATH, activePointer);
      transaction.set(SITE_CONFIG_PATH, {
        year: manifest.schoolYear,
        semester: manifest.term,
        activeSemesterId: payload.semesterId,
        activeSemesterRevision: manifest.revision,
        semesterLifecycleStatus: "ACTIVE",
        semesterWritesEnabled: true,
        updatedAt: timestamp,
      }, { merge: true });
      return {
        target: {
          semesterId: payload.semesterId,
          previousSemesterId: currentPointerId,
          refs: [
            manifestPath,
            readinessPath,
            ACTIVE_SEMESTER_POINTER_PATH,
            SITE_CONFIG_PATH,
            ...(previousManifestPath ? [previousManifestPath] : []),
          ],
        },
        sourceHash: reportSnapshot.data?.dependencyHash || null,
        result: {
          semesterId: payload.semesterId,
          previousSemesterId: currentPointerId,
          status: "ACTIVE",
          revision: manifest.revision,
        },
      };
    }

    fail("invalid-argument", "Unsupported semester commandType.", "COMMAND_TYPE_UNSUPPORTED", {
      commandType,
    });
  };

  return { apply };
};

const resolveSemesterCoreState = async ({ store, semesterId = null, readinessAdapters = [] }) => {
  if (!Array.isArray(readinessAdapters)) {
    throw new TypeError("readinessAdapters must be an array.");
  }
  const requestedSemesterId = semesterId === null || semesterId === undefined || semesterId === ""
    ? null
    : normalizeSemesterId(semesterId);
  const loadState = async (reader) => {
    const manifestDocuments = await reader.query(SEMESTER_MANIFEST_COLLECTION);
    const [pointerSnapshot] = await readDocuments(reader, [ACTIVE_SEMESTER_POINTER_PATH]);
    const manifests = manifestDocuments.map((document) => document.data || {});
    const current = manifests.filter((manifest) =>
      manifest.status === "ACTIVE" || manifest.status === "CLOSING");
    const pointerId = pointerSnapshot.exists && typeof pointerSnapshot.data?.semesterId === "string"
      ? pointerSnapshot.data.semesterId
      : null;
    const pointerRevision = pointerSnapshot.exists
      ? Number(pointerSnapshot.data?.revision || 0)
      : 0;
    const preparing = manifests
      .filter((manifest) => ["DRAFT", "PREPARING", "VALIDATING", "READY", "FAILED"].includes(manifest.status))
      .sort((left, right) => String(right.semesterId || "").localeCompare(String(left.semesterId || "")))[0]
      || null;
    const requested = requestedSemesterId
      ? manifests.find((manifest) => manifest.semesterId === requestedSemesterId) || null
      : null;
    let error = null;
    const currentConflict = current.length > 1
      || (current.length === 1 && pointerId !== current[0].semesterId)
      || (current.length === 1 && pointerRevision !== Number(current[0].revision || 0))
      || (current.length === 0 && pointerId !== null);
    if (currentConflict) {
      error = "CONFLICTING_ACTIVE_SEMESTER";
    } else if (requestedSemesterId && !requested) {
      error = "SEMESTER_NOT_FOUND";
    } else if (!requestedSemesterId && current.length === 0) {
      error = "NO_ACTIVE_SEMESTER";
    }
    const resolvedManifest = currentConflict ? null : (requested || current[0] || preparing);
    const selectedManifest = requestedSemesterId
      ? requested
      : currentConflict
        ? null
        : (current[0] || preparing);
    let readiness = {
      current: false,
      reason: currentConflict
        ? "SEMESTER_ACTIVE_CONFLICT"
        : requestedSemesterId && !requested
          ? "SEMESTER_NOT_FOUND"
          : "SEMESTER_READINESS_NOT_FOUND",
      dependencyHash: null,
    };
    if (selectedManifest) {
      const selectedSemesterId = selectedManifest.semesterId;
      const readinessPath = `${SEMESTER_READINESS_REPORT_COLLECTION}/${selectedSemesterId}`;
      const seedDefinitions = getSemesterSeedDefinitions(
        String(selectedManifest.schoolYear || ""),
        String(selectedManifest.term || ""),
      );
      const [reportSnapshot, ...seedDocuments] = await readDocuments(reader, [
        readinessPath,
        ...seedDefinitions.map((seed) => seed.path),
      ]);
      const extensionChecks = await evaluateReadinessAdapters({
        readinessAdapters,
        transaction: reader,
        manifest: selectedManifest,
        evaluatedAt: new Date().toISOString(),
      });
      const dependencyHash = hashDependencyDocuments(seedDocuments, extensionChecks);
      const report = reportSnapshot.exists ? reportSnapshot.data || {} : null;
      let reason = null;
      if (!report) {
        reason = "SEMESTER_READINESS_NOT_FOUND";
      } else if (
        report.status === "STALE"
        || report.stale === true
        || report.evaluatedRevision !== selectedManifest.revision
      ) {
        reason = "SEMESTER_READINESS_STALE";
      } else if (report.dependencyHash !== dependencyHash) {
        reason = "SEMESTER_READINESS_DEPENDENCY_CHANGED";
      } else if (
        report.policyVersion !== READINESS_POLICY_VERSION
        || selectedManifest.readinessPolicyVersion !== READINESS_POLICY_VERSION
      ) {
        reason = "SEMESTER_POLICY_VERSION_MISMATCH";
      } else {
        const requiredChecks = Array.isArray(report.checks)
          ? report.checks.filter((check) => check?.required === true)
          : [];
        if (
          report.status !== "PASS"
          || requiredChecks.length < REQUIRED_READINESS_CHECK_COUNT
          || Number(report.requiredTotal || 0) !== requiredChecks.length
          || requiredChecks.some((check) => check.status !== "PASS")
        ) {
          reason = "SEMESTER_READINESS_NOT_PASS";
        }
      }
      readiness = {
        current: reason === null,
        reason,
        dependencyHash,
      };
    }
    return {
      active: !currentConflict && current.length === 1 ? current[0] : null,
      preparing,
      requested,
      provenance: resolvedManifest?.provenance || null,
      error,
      readiness,
    };
  };
  return typeof store.runTransaction === "function"
    ? store.runTransaction((transaction) => loadState(transaction))
    : loadState(store);
};

module.exports = {
  ACTIVE_SEMESTER_POINTER_PATH,
  READINESS_POLICY_VERSION,
  REQUIRED_READINESS_CHECK_COUNT,
  SEMESTER_COMMAND_TYPES,
  SEMESTER_MANIFEST_COLLECTION,
  SEMESTER_READINESS_REPORT_COLLECTION,
  SEMESTER_SCHEMA_VERSION,
  SEMESTER_STATUSES,
  SITE_CONFIG_PATH,
  STAGING_PROJECT_ID,
  TRANSITION_TABLE,
  buildSemesterId,
  createSemesterCoreCommandAdapter,
  evaluateReadinessAdapters,
  getSemesterSeedDefinitions,
  normalizeSemesterCommandPayload,
  normalizeSemesterId,
  provenanceForStatus,
  resolveSemesterCoreState,
};
