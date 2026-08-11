const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const semesterCore = require("./semesterCore");
const archiveEnrollment = require("./archiveEnrollment");
const assessmentLifecycle = require("./assessmentLifecycle");
const sessionAuthority = require("./sessionAuthority");
const { onCallWithStudentMaintenance: onCall } = require("./studentMaintenance");

const REGION = "asia-northeast3";
const GRADE_SCHEMA_VERSION = 1;
const GRADE_POLICY_VERSION = "w6b-v1";
const GRADE_SCORE_KINDS = Object.freeze(["performance", "written_exam_essay"]);
const GRADE_STATEMENT_VERSION = "w6b-grade-statement-v1";
const SUPPORTED_RUBRIC_VERSIONS = Object.freeze([
  "rubric-v1",
  "w6b-rubric-v1",
  "w6b-assessment-v1",
]);

const GRADE_RECORD_COLLECTION = "semester_grade_records";
const GRADE_VERSION_COLLECTION = "semester_grade_versions";
const GRADE_REQUEST_COLLECTION = "semester_grade_requests";
const GRADE_ATTESTATION_COLLECTION = "semester_grade_attestations";
const GRADE_LEGACY_ISSUE_COLLECTION = "grade_legacy_issues";

const GRADE_COMMAND_TYPES = Object.freeze({
  CREATE_GRADE_DRAFT: "createGradeDraft",
  REVIEW_GRADE_DRAFT: "reviewGradeDraft",
  FINALIZE_GRADE_EVIDENCE: "finalizeGradeEvidence",
  PUBLISH_OFFICIAL_GRADE: "publishOfficialGrade",
  CORRECT_OFFICIAL_GRADE: "correctOfficialGrade",
  REQUEST_GRADE_REVIEW: "requestGradeReview",
  ACKNOWLEDGE_GRADE_EVIDENCE: "acknowledgeGradeEvidence",
  SIGN_OFFICIAL_GRADE: "signOfficialGrade",
});

const STUDENT_COMMAND_TYPES = new Set([
  GRADE_COMMAND_TYPES.REQUEST_GRADE_REVIEW,
  GRADE_COMMAND_TYPES.ACKNOWLEDGE_GRADE_EVIDENCE,
  GRADE_COMMAND_TYPES.SIGN_OFFICIAL_GRADE,
]);

const HIGH_RISK_COMMAND_TYPES = new Set([
  GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT,
  GRADE_COMMAND_TYPES.REVIEW_GRADE_DRAFT,
  GRADE_COMMAND_TYPES.FINALIZE_GRADE_EVIDENCE,
  GRADE_COMMAND_TYPES.PUBLISH_OFFICIAL_GRADE,
  GRADE_COMMAND_TYPES.CORRECT_OFFICIAL_GRADE,
  GRADE_COMMAND_TYPES.SIGN_OFFICIAL_GRADE,
]);

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

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const assertAllowedKeys = (value, allowed, label) => {
  if (!isPlainObject(value)) {
    fail("invalid-argument", `${label} must be an object.`, "GRADE_PAYLOAD_INVALID");
  }
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    fail("invalid-argument", `${label} contains unsupported fields.`, "GRADE_PAYLOAD_INVALID", {
      fields: unexpected,
    });
  }
};

const text = (value, label, max = 160) => {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > max
  ) {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_PAYLOAD_INVALID", { field: label });
  }
  return value;
};

const optionalText = (value, label, max = 160) =>
  value === undefined || value === null || value === "" ? "" : text(value, label, max);

const positiveInteger = (value, label, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_PAYLOAD_INVALID", { field: label });
  }
  return value;
};

const nonNegativeInteger = (value, label, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_PAYLOAD_INVALID", { field: label });
  }
  return value;
};

const scoreNumber = (value, label) => {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
    || value > 10_000
    || Math.round(value * 1000) !== value * 1000
  ) {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_SCORE_INVALID", { field: label });
  }
  return value;
};

const normalizeSemesterId = (value) => semesterCore.normalizeSemesterId(value);

const normalizeRubricVersion = (value) => {
  const normalized = text(value, "rubricVersion", 100);
  if (!SUPPORTED_RUBRIC_VERSIONS.includes(normalized)) {
    fail(
      "failed-precondition",
      "rubricVersion is not supported by the active grade policy.",
      "GRADE_RUBRIC_VERSION_UNSUPPORTED",
      { rubricVersion: normalized, policyVersion: GRADE_POLICY_VERSION },
    );
  }
  return normalized;
};

const normalizeStatementVersion = (value) => {
  const normalized = text(value, "statementVersion", 100);
  if (normalized !== GRADE_STATEMENT_VERSION) {
    fail(
      "failed-precondition",
      "statementVersion is not supported by the active grade policy.",
      "GRADE_STATEMENT_VERSION_UNSUPPORTED",
      { statementVersion: normalized, policyVersion: GRADE_POLICY_VERSION },
    );
  }
  return normalized;
};

const normalizeRecordId = (value) => {
  const normalized = text(value, "recordId", 80);
  if (!/^grade_[a-f0-9]{64}$/.test(normalized)) {
    fail("invalid-argument", "recordId is invalid.", "GRADE_RECORD_ID_INVALID");
  }
  return normalized;
};

const normalizeVersionId = (value) => {
  const normalized = text(value, "versionId", 84);
  if (!/^gradever_[a-f0-9]{64}$/.test(normalized)) {
    fail("invalid-argument", "versionId is invalid.", "GRADE_VERSION_ID_INVALID");
  }
  return normalized;
};

const normalizeRequestId = (value) => {
  const normalized = text(value, "requestId", 84);
  if (!/^gradereq_[a-f0-9]{64}$/.test(normalized)) {
    fail("invalid-argument", "requestId is invalid.", "GRADE_REQUEST_ID_INVALID");
  }
  return normalized;
};

const normalizeAttemptId = (value) => {
  const normalized = text(value, "attemptId", 180);
  if (!/^attempt_[a-f0-9]{64}$/.test(normalized)) {
    fail("invalid-argument", "attemptId is invalid.", "GRADE_ATTEMPT_ID_INVALID");
  }
  return normalized;
};

const normalizeHash = (value, label) => {
  const normalized = text(value, label, 64);
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_HASH_INVALID", { field: label });
  }
  return normalized;
};

const normalizeScoreKind = (value) => {
  if (!GRADE_SCORE_KINDS.includes(value)) {
    fail("invalid-argument", "scoreKind is invalid.", "GRADE_SCORE_KIND_INVALID");
  }
  return value;
};

const normalizeItems = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) {
    fail("invalid-argument", "items is invalid.", "GRADE_ITEMS_INVALID");
  }
  const items = value.map((item, index) => {
    assertAllowedKeys(
      item,
      ["itemId", "maxScore", "awardedScore", "evaluationKind", "evidence", "reason"],
      `items[${index}]`,
    );
    const itemId = text(item.itemId, `items[${index}].itemId`, 180);
    const maxScore = scoreNumber(item.maxScore, `items[${index}].maxScore`);
    if (maxScore <= 0) {
      fail("invalid-argument", "Item maxScore must be greater than zero.", "GRADE_ITEMS_INVALID");
    }
    const awardedScore = scoreNumber(item.awardedScore, `items[${index}].awardedScore`);
    if (awardedScore > maxScore) {
      fail("invalid-argument", "Item awardedScore exceeds maxScore.", "GRADE_ITEMS_INVALID", {
        itemId,
      });
    }
    if (!['AUTO', 'TEACHER'].includes(item.evaluationKind)) {
      fail("invalid-argument", "Item evaluationKind is invalid.", "GRADE_ITEMS_INVALID", {
        itemId,
      });
    }
    return {
      itemId,
      maxScore,
      awardedScore,
      evaluationKind: item.evaluationKind,
      evidence: optionalText(item.evidence, `items[${index}].evidence`, 2_000),
      reason: optionalText(item.reason, `items[${index}].reason`, 500),
    };
  });
  const ids = items.map((item) => item.itemId);
  if (new Set(ids).size !== ids.length) {
    fail("invalid-argument", "items contains duplicate item IDs.", "GRADE_ITEMS_INVALID");
  }
  const totalMaxScore = items.reduce((sum, item) => sum + item.maxScore, 0);
  if (totalMaxScore > 100_000) {
    fail("invalid-argument", "items total exceeds the supported range.", "GRADE_ITEMS_INVALID");
  }
  return items;
};

const normalizeBaseMutation = (payload, allowedKeys, label) => {
  assertAllowedKeys(payload, allowedKeys, label);
  return {
    semesterId: normalizeSemesterId(payload.semesterId),
    expectedSemesterRevision: positiveInteger(
      payload.expectedSemesterRevision,
      "expectedSemesterRevision",
    ),
  };
};

const normalizeGradePayload = (commandType, rawPayload) => {
  const payload = rawPayload || {};
  if (commandType === GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT) {
    const allowed = [
      "semesterId", "expectedSemesterRevision", "sourceKind", "attemptId",
      "manualSourceId", "studentUid", "enrollmentId", "classId", "sourceHash",
      "scoreKind", "title", "rubricVersion", "items", "reason",
    ];
    const base = normalizeBaseMutation(payload, allowed, "createGradeDraft payload");
    if (!['ASSESSMENT_RESULT', 'MANUAL_IMPORT'].includes(payload.sourceKind)) {
      fail("invalid-argument", "sourceKind is invalid.", "GRADE_SOURCE_KIND_INVALID");
    }
    const common = {
      ...base,
      sourceKind: payload.sourceKind,
      scoreKind: normalizeScoreKind(payload.scoreKind),
      title: text(payload.title, "title", 200),
      rubricVersion: normalizeRubricVersion(payload.rubricVersion),
      reason: text(payload.reason, "reason", 500),
    };
    if (payload.sourceKind === "ASSESSMENT_RESULT") {
      if (
        payload.manualSourceId !== undefined
        || payload.studentUid !== undefined
        || payload.enrollmentId !== undefined
        || payload.classId !== undefined
        || payload.sourceHash !== undefined
        || payload.items !== undefined
      ) {
        fail("invalid-argument", "Assessment draft contains manual source fields.", "GRADE_PAYLOAD_INVALID");
      }
      return { ...common, attemptId: normalizeAttemptId(payload.attemptId) };
    }
    if (payload.attemptId !== undefined) {
      fail("invalid-argument", "Manual draft cannot contain attemptId.", "GRADE_PAYLOAD_INVALID");
    }
    return {
      ...common,
      manualSourceId: text(payload.manualSourceId, "manualSourceId", 180),
      studentUid: text(payload.studentUid, "studentUid", 160),
      enrollmentId: text(payload.enrollmentId, "enrollmentId", 180),
      classId: text(payload.classId, "classId", 180),
      sourceHash: normalizeHash(payload.sourceHash, "sourceHash"),
      items: normalizeItems(payload.items),
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.REVIEW_GRADE_DRAFT) {
    const base = normalizeBaseMutation(payload, [
      "semesterId", "expectedSemesterRevision", "recordId", "expectedRevision",
      "expectedGradeRevision", "items", "reason",
    ], "reviewGradeDraft payload");
    return {
      ...base,
      recordId: normalizeRecordId(payload.recordId),
      expectedRevision: positiveInteger(payload.expectedRevision, "expectedRevision"),
      expectedGradeRevision: positiveInteger(payload.expectedGradeRevision, "expectedGradeRevision"),
      items: normalizeItems(payload.items),
      reason: text(payload.reason, "reason", 500),
    };
  }

  if (
    commandType === GRADE_COMMAND_TYPES.FINALIZE_GRADE_EVIDENCE
    || commandType === GRADE_COMMAND_TYPES.PUBLISH_OFFICIAL_GRADE
  ) {
    const allowed = [
      "semesterId", "expectedSemesterRevision", "recordId", "expectedRevision",
      "expectedGradeRevision", "expectedVersionId", "reason",
    ];
    if (commandType === GRADE_COMMAND_TYPES.PUBLISH_OFFICIAL_GRADE) {
      allowed.push("signatureRequired");
    }
    const base = normalizeBaseMutation(payload, allowed, `${commandType} payload`);
    const normalized = {
      ...base,
      recordId: normalizeRecordId(payload.recordId),
      expectedRevision: positiveInteger(payload.expectedRevision, "expectedRevision"),
      expectedGradeRevision: positiveInteger(payload.expectedGradeRevision, "expectedGradeRevision"),
      expectedVersionId: normalizeVersionId(payload.expectedVersionId),
      reason: text(payload.reason, "reason", 500),
    };
    if (commandType === GRADE_COMMAND_TYPES.PUBLISH_OFFICIAL_GRADE) {
      if (typeof payload.signatureRequired !== "boolean") {
        fail("invalid-argument", "signatureRequired must be a boolean.", "GRADE_PAYLOAD_INVALID");
      }
      normalized.signatureRequired = payload.signatureRequired;
    }
    return normalized;
  }

  if (commandType === GRADE_COMMAND_TYPES.CORRECT_OFFICIAL_GRADE) {
    const base = normalizeBaseMutation(payload, [
      "semesterId", "expectedSemesterRevision", "recordId", "expectedRevision",
      "expectedGradeRevision", "items", "reason", "requestId", "resolution",
    ], "correctOfficialGrade payload");
    if (!['CORRECT', 'REJECT'].includes(payload.resolution)) {
      fail("invalid-argument", "resolution is invalid.", "GRADE_REQUEST_RESOLUTION_INVALID");
    }
    if (payload.resolution === "REJECT" && !payload.requestId) {
      fail("invalid-argument", "requestId is required when rejecting a request.", "GRADE_REQUEST_RESOLUTION_INVALID");
    }
    return {
      ...base,
      recordId: normalizeRecordId(payload.recordId),
      expectedRevision: positiveInteger(payload.expectedRevision, "expectedRevision"),
      expectedGradeRevision: positiveInteger(payload.expectedGradeRevision, "expectedGradeRevision"),
      items: payload.resolution === "CORRECT"
        ? normalizeItems(payload.items)
        : (payload.items === undefined ? [] : fail("invalid-argument", "Rejected request cannot contain score changes.", "GRADE_REQUEST_RESOLUTION_INVALID")),
      reason: text(payload.reason, "reason", 500),
      requestId: payload.requestId ? normalizeRequestId(payload.requestId) : "",
      resolution: payload.resolution,
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.REQUEST_GRADE_REVIEW) {
    const base = normalizeBaseMutation(payload, [
      "semesterId", "expectedSemesterRevision", "recordId", "expectedRevision",
      "expectedGradeRevision", "requestKind", "reason",
    ], "requestGradeReview payload");
    if (!['OBJECTION', 'ANSWER_SHEET'].includes(payload.requestKind)) {
      fail("invalid-argument", "requestKind is invalid.", "GRADE_REQUEST_KIND_INVALID");
    }
    return {
      ...base,
      recordId: normalizeRecordId(payload.recordId),
      expectedRevision: positiveInteger(payload.expectedRevision, "expectedRevision"),
      expectedGradeRevision: positiveInteger(payload.expectedGradeRevision, "expectedGradeRevision"),
      requestKind: payload.requestKind,
      reason: text(payload.reason, "reason", 1_000),
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.ACKNOWLEDGE_GRADE_EVIDENCE) {
    const base = normalizeBaseMutation(payload, [
      "semesterId", "expectedSemesterRevision", "recordId", "expectedRevision",
      "expectedGradeRevision", "statementVersion",
    ], "acknowledgeGradeEvidence payload");
    return {
      ...base,
      recordId: normalizeRecordId(payload.recordId),
      expectedRevision: positiveInteger(payload.expectedRevision, "expectedRevision"),
      expectedGradeRevision: positiveInteger(payload.expectedGradeRevision, "expectedGradeRevision"),
      statementVersion: normalizeStatementVersion(payload.statementVersion),
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.SIGN_OFFICIAL_GRADE) {
    const base = normalizeBaseMutation(payload, [
      "semesterId", "expectedSemesterRevision", "recordId", "expectedRevision",
      "expectedGradeRevision", "signatureName", "statementVersion",
    ], "signOfficialGrade payload");
    return {
      ...base,
      recordId: normalizeRecordId(payload.recordId),
      expectedRevision: positiveInteger(payload.expectedRevision, "expectedRevision"),
      expectedGradeRevision: positiveInteger(payload.expectedGradeRevision, "expectedGradeRevision"),
      signatureName: text(payload.signatureName, "signatureName", 40),
      statementVersion: normalizeStatementVersion(payload.statementVersion),
    };
  }

  fail("invalid-argument", "Unsupported grade command.", "GRADE_COMMAND_UNSUPPORTED", {
    commandType,
  });
};

const recordPath = (recordId) => `${GRADE_RECORD_COLLECTION}/${recordId}`;
const versionPath = (versionId) => `${GRADE_VERSION_COLLECTION}/${versionId}`;
const requestPath = (requestId) => `${GRADE_REQUEST_COLLECTION}/${requestId}`;
const attestationPath = (attestationId) => `${GRADE_ATTESTATION_COLLECTION}/${attestationId}`;
const manifestPath = (semesterId) =>
  `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${semesterId}`;
const attemptPath = (attemptId) =>
  `${assessmentLifecycle.ATTEMPT_COLLECTION}/${attemptId}`;
const submissionPath = (attemptId) =>
  `${assessmentLifecycle.SUBMISSION_COLLECTION}/${attemptId}`;
const resultPath = (attemptId) =>
  `${assessmentLifecycle.RESULT_COLLECTION}/${attemptId}`;
const enrollmentPath = (enrollmentId) =>
  `${archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION}/${enrollmentId}`;
const classPath = (classId) =>
  `${archiveEnrollment.SEMESTER_CLASS_COLLECTION}/${classId}`;
const slotPath = (semesterId, studentUid) =>
  `${archiveEnrollment.ENROLLMENT_SLOT_COLLECTION}/${archiveEnrollment.buildEnrollmentSlotId(semesterId, studentUid)}`;

const buildEnrollmentSnapshot = (enrollmentData, classData) => ({
  enrollmentId: String(enrollmentData?.enrollmentId || ""),
  classId: String(enrollmentData?.classId || ""),
  displayName: String(enrollmentData?.snapshot?.displayName || "").trim(),
  studentNumber: String(
    enrollmentData?.snapshot?.studentNumber ?? enrollmentData?.studentNumber ?? "",
  ).trim(),
  grade: String(enrollmentData?.snapshot?.grade ?? classData?.grade ?? "").trim(),
  classNumber: String(
    enrollmentData?.snapshot?.classNumber ?? classData?.classNumber ?? "",
  ).trim(),
  classDisplayName: String(
    enrollmentData?.snapshot?.classDisplayName ?? classData?.displayName ?? "",
  ).trim(),
});

const buildRecordId = ({ sourceKind, attemptId = "", semesterId = "", manualSourceId = "", enrollmentId = "" }) => {
  const logicalKey = sourceKind === "ASSESSMENT_RESULT"
    ? `ASSESSMENT_RESULT\n${attemptId}`
    : `MANUAL_IMPORT\n${semesterId}\n${manualSourceId}\n${enrollmentId}`;
  return `grade_${sha256(logicalKey)}`;
};

const buildVersionId = (recordId, gradeRevision, evidenceHash) =>
  `gradever_${sha256(`${recordId}\n${gradeRevision}\n${evidenceHash}`)}`;

const buildRequestId = (recordId, gradeRevision, studentUid, requestKind) =>
  `gradereq_${sha256(`${recordId}\n${gradeRevision}\n${studentUid}\n${requestKind}`)}`;

const buildAttestationId = (type, recordId, gradeRevision, studentUid) =>
  `gradeatt_${sha256(`${type}\n${recordId}\n${gradeRevision}\n${studentUid}`)}`;

const summarizeItems = (items) => {
  const totalScore = items.reduce((sum, item) => sum + Number(item.awardedScore || 0), 0);
  const totalMaxScore = items.reduce((sum, item) => sum + Number(item.maxScore || 0), 0);
  return {
    totalScore,
    totalMaxScore,
    percent: totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 10_000) / 100 : 0,
  };
};

const evidenceHashFor = ({
  recordId,
  gradeRevision,
  semesterId,
  studentUid,
  enrollmentId,
  classId,
  sourceKind,
  sourceId,
  sourceSnapshotHash,
  scoreKind,
  enrollmentSnapshot,
  title,
  rubricVersion,
  items,
  supersedesVersionId,
}) => sha256(canonicalJson({
  recordId,
  gradeRevision,
  semesterId,
  studentUid,
  enrollmentId,
  classId,
  sourceKind,
  sourceId,
  sourceSnapshotHash,
  scoreKind,
  enrollmentSnapshot,
  title,
  rubricVersion,
  items,
  supersedesVersionId: supersedesVersionId || "",
}));

const buildVersion = ({
  record,
  gradeRevision,
  items,
  state,
  reason,
  actor,
  commandId,
  receiptId,
  timestamp,
  supersedesVersionId = "",
}) => {
  const evidenceHash = evidenceHashFor({
    ...record,
    gradeRevision,
    items,
    supersedesVersionId,
  });
  const versionId = buildVersionId(record.recordId, gradeRevision, evidenceHash);
  const summary = summarizeItems(items);
  return {
    schemaVersion: GRADE_SCHEMA_VERSION,
    policyVersion: GRADE_POLICY_VERSION,
    versionId,
    recordId: record.recordId,
    gradeRevision,
    state,
    semesterId: record.semesterId,
    studentUid: record.studentUid,
    enrollmentId: record.enrollmentId,
    classId: record.classId,
    sourceKind: record.sourceKind,
    sourceId: record.sourceId,
    sourceRefs: record.sourceRefs,
    sourceSnapshotHash: record.sourceSnapshotHash,
    scoreKind: record.scoreKind,
    enrollmentSnapshot: record.enrollmentSnapshot,
    definitionId: record.definitionId || "",
    definitionRevision: Number(record.definitionRevision || 0),
    sourceHash: record.sourceHash,
    title: record.title,
    rubricVersion: record.rubricVersion,
    items,
    ...summary,
    evidenceHash,
    supersedesVersionId,
    reason,
    createdBy: actor.actorUid,
    createdByRole: actor.actorRole,
    commandId,
    receiptId,
    createdAt: timestamp,
  };
};

const assertTeacherActor = (actor) => {
  if (!actor?.actorUid || !['teacher', 'admin'].includes(actor.actorRole)) {
    fail("permission-denied", "Grade management permission is required.", "GRADE_MANAGE_REQUIRED");
  }
};

const assertStudentActor = (actor) => {
  if (!actor?.actorUid || actor.actorRole !== "student") {
    fail("permission-denied", "A student account is required.", "GRADE_STUDENT_REQUIRED");
  }
};

const assertWritableSemester = async (transaction, semesterId, expectedSemesterRevision) => {
  const snapshot = await transaction.get(manifestPath(semesterId));
  if (!snapshot.exists) {
    fail("not-found", "Semester Manifest does not exist.", "SEMESTER_NOT_FOUND", {
      semesterId,
    });
  }
  const manifest = snapshot.data || {};
  if (Number(manifest.revision || 0) !== expectedSemesterRevision) {
    fail("aborted", "Semester Manifest revision has changed.", "SEMESTER_REVISION_CONFLICT", {
      semesterId,
      currentRevision: Number(manifest.revision || 0),
    });
  }
  if (["CLOSED", "ARCHIVED"].includes(manifest.status)) {
    fail("failed-precondition", "Archived semester data is read-only.", "SEMESTER_ARCHIVED_WRITE_FORBIDDEN", {
      semesterId,
      status: manifest.status,
    });
  }
  if (manifest.status !== "ACTIVE") {
    fail("failed-precondition", "Grade writes require the active semester.", "SEMESTER_WRITE_STATE_INVALID", {
      semesterId,
      status: manifest.status,
    });
  }
  return manifest;
};

const inspectAssessmentJoin = ({ attempt, submission, result, enrollment, semesterClass, expectedSemesterId }) => {
  const attemptData = attempt?.data || {};
  const submissionData = submission?.data || {};
  const resultData = result?.data || {};
  const enrollmentData = enrollment?.data || {};
  const classData = semesterClass?.data || {};
  const attemptId = String(attemptData.attemptId || "");
  const sourceHash = String(attemptData.sourceHash || "");
  const valid = Boolean(
    attempt?.exists
    && submission?.exists
    && result?.exists
    && enrollment?.exists
    && semesterClass?.exists
    && attemptData.status === "SUBMITTED"
    && !attemptData.resetAt
    && attemptId
    && submissionData.attemptId === attemptId
    && submissionData.submissionId === attemptId
    && resultData.attemptId === attemptId
    && resultData.resultId === attemptId
    && attemptData.semesterId === expectedSemesterId
    && submissionData.semesterId === expectedSemesterId
    && resultData.semesterId === expectedSemesterId
    && submissionData.definitionId === attemptData.definitionId
    && resultData.definitionId === attemptData.definitionId
    && submissionData.studentUid === attemptData.studentUid
    && resultData.studentUid === attemptData.studentUid
    && sourceHash
    && submissionData.sourceHash === sourceHash
    && resultData.sourceHash === sourceHash
    && Number(submissionData.attemptRevision || 0) === Number(attemptData.revision || 0)
    && submissionData.submittedAtIso === attemptData.submittedAtIso
    && resultData.submittedAtIso === attemptData.submittedAtIso
    && attemptData.submissionRef === submissionPath(attemptId)
    && attemptData.resultRef === resultPath(attemptId)
    && resultData.submissionRef === submissionPath(attemptId)
    && resultData.enrollmentId === attemptData.enrollmentId
    && resultData.classId === attemptData.classId
    && enrollmentData.enrollmentId === attemptData.enrollmentId
    && enrollmentData.studentUid === attemptData.studentUid
    && enrollmentData.semesterId === expectedSemesterId
    && enrollmentData.classId === attemptData.classId
    && classData.classId === attemptData.classId
    && classData.semesterId === expectedSemesterId
    && Array.isArray(attemptData.questionIds)
    && Array.isArray(attemptData.gradingSnapshot)
    && Array.isArray(resultData.answerChecks)
    && canonicalJson(submissionData.answers || {}) === canonicalJson(attemptData.answers || {})
  );
  if (!valid) return { ok: false, reason: "ASSESSMENT_GRADE_SOURCE_MISMATCH" };

  const questionIds = attemptData.questionIds.map(String);
  const snapshotIds = attemptData.gradingSnapshot.map((item) => String(item?.id || ""));
  const checks = resultData.answerChecks.map((item) => ({
    id: String(item?.id || ""),
    correct: item?.correct === true,
  }));
  if (
    questionIds.length < 1
    || new Set(questionIds).size !== questionIds.length
    || canonicalJson(questionIds) !== canonicalJson(snapshotIds)
    || canonicalJson(questionIds) !== canonicalJson(checks.map((item) => item.id))
  ) {
    return { ok: false, reason: "ASSESSMENT_GRADE_ITEMS_MISMATCH" };
  }
  const correctCount = checks.filter((item) => item.correct).length;
  const expectedPercent = checks.length > 0
    ? Math.round((correctCount / checks.length) * 100)
    : 0;
  if (
    Number(resultData.score) !== correctCount
    || Number(resultData.total) !== checks.length
    || Number(resultData.percent) !== expectedPercent
  ) {
    return { ok: false, reason: "ASSESSMENT_GRADE_TOTAL_MISMATCH" };
  }
  const sourceSnapshot = {
    attemptId,
    definitionId: attemptData.definitionId,
    definitionRevision: Number(attemptData.definitionRevision || 0),
    semesterId: expectedSemesterId,
    studentUid: attemptData.studentUid,
    enrollmentId: attemptData.enrollmentId,
    classId: attemptData.classId,
    attemptNumber: Number(attemptData.attemptNumber || 0),
    questionIds,
    gradingSnapshot: attemptData.gradingSnapshot,
    answers: submissionData.answers || {},
    answerChecks: checks,
    sourceHash,
    submittedAtIso: submissionData.submittedAtIso,
  };
  return {
    ok: true,
    sourceSnapshotHash: sha256(canonicalJson(sourceSnapshot)),
    items: checks.map((item) => ({
      itemId: item.id,
      maxScore: 1,
      awardedScore: item.correct ? 1 : 0,
      evaluationKind: "AUTO",
      evidence: "W6A_PROVISIONAL_RESULT",
      reason: "",
    })),
    studentUid: attemptData.studentUid,
    enrollmentId: attemptData.enrollmentId,
    classId: attemptData.classId,
    definitionId: attemptData.definitionId,
    definitionRevision: Number(attemptData.definitionRevision || 0),
    sourceHash,
    sourceRefs: [attemptPath(attemptId), submissionPath(attemptId), resultPath(attemptId)],
    enrollmentSnapshot: buildEnrollmentSnapshot(enrollmentData, classData),
  };
};

const loadAssessmentSource = async (transaction, payload) => {
  const attempt = await transaction.get(attemptPath(payload.attemptId));
  const attemptData = attempt.data || {};
  const enrollmentId = String(attemptData.enrollmentId || "");
  const classId = String(attemptData.classId || "");
  if (!attempt.exists) {
    fail("not-found", "Assessment attempt was not found.", "GRADE_ASSESSMENT_ATTEMPT_NOT_FOUND", {
      attemptId: payload.attemptId,
    });
  }
  if (!enrollmentId || !classId) {
    fail("failed-precondition", "Assessment attempt has no canonical Enrollment snapshot.", "ASSESSMENT_GRADE_SOURCE_MISMATCH", {
      attemptId: payload.attemptId,
    });
  }
  const documents = await transaction.getAll([
    submissionPath(payload.attemptId),
    resultPath(payload.attemptId),
    enrollmentPath(enrollmentId),
    classPath(classId),
  ]);
  const inspected = inspectAssessmentJoin({
    attempt,
    submission: documents[0],
    result: documents[1],
    enrollment: documents[2],
    semesterClass: documents[3],
    expectedSemesterId: payload.semesterId,
  });
  if (!inspected.ok) {
    fail("failed-precondition", "Assessment grade source is inconsistent.", inspected.reason, {
      attemptId: payload.attemptId,
    });
  }
  return {
    ...inspected,
    sourceId: payload.attemptId,
  };
};

const loadManualSource = async (transaction, payload) => {
  const [slot, enrollment, semesterClass] = await transaction.getAll([
    slotPath(payload.semesterId, payload.studentUid),
    enrollmentPath(payload.enrollmentId),
    classPath(payload.classId),
  ]);
  if (
    !slot.exists
    || !enrollment.exists
    || !semesterClass.exists
    || slot.data?.activeEnrollmentId !== payload.enrollmentId
    || slot.data?.status !== "ACTIVE"
    || enrollment.data?.enrollmentId !== payload.enrollmentId
    || enrollment.data?.studentUid !== payload.studentUid
    || enrollment.data?.semesterId !== payload.semesterId
    || enrollment.data?.classId !== payload.classId
    || enrollment.data?.enrollmentStatus !== "ACTIVE"
    || semesterClass.data?.classId !== payload.classId
    || semesterClass.data?.semesterId !== payload.semesterId
    || semesterClass.data?.status !== "ACTIVE"
  ) {
    fail("failed-precondition", "Manual grade source is not bound to the current Enrollment.", "GRADE_ENROLLMENT_MISMATCH");
  }
  return {
    sourceId: payload.manualSourceId,
    sourceSnapshotHash: sha256(canonicalJson({
      sourceKind: payload.sourceKind,
      manualSourceId: payload.manualSourceId,
      semesterId: payload.semesterId,
      studentUid: payload.studentUid,
      enrollmentId: payload.enrollmentId,
      classId: payload.classId,
      sourceHash: payload.sourceHash,
      items: payload.items,
    })),
    items: payload.items,
    studentUid: payload.studentUid,
    enrollmentId: payload.enrollmentId,
    classId: payload.classId,
    definitionId: "",
    definitionRevision: 0,
    sourceHash: payload.sourceHash,
    sourceRefs: [enrollmentPath(payload.enrollmentId), classPath(payload.classId)],
    enrollmentSnapshot: buildEnrollmentSnapshot(enrollment.data || {}, semesterClass.data || {}),
  };
};

const assertRecordCas = (snapshot, payload, allowedStatuses) => {
  if (!snapshot.exists) {
    fail("not-found", "Grade record was not found.", "GRADE_RECORD_NOT_FOUND", {
      recordId: payload.recordId,
    });
  }
  const record = snapshot.data || {};
  if (
    record.schemaVersion !== GRADE_SCHEMA_VERSION
    || record.policyVersion !== GRADE_POLICY_VERSION
    || !SUPPORTED_RUBRIC_VERSIONS.includes(record.rubricVersion)
    || !GRADE_SCORE_KINDS.includes(record.scoreKind)
  ) {
    fail(
      "failed-precondition",
      "Grade record uses an unsupported schema, policy, or rubric version.",
      "GRADE_RECORD_VERSION_UNSUPPORTED",
    );
  }
  if (record.semesterId !== payload.semesterId) {
    fail("failed-precondition", "Grade record semester does not match.", "GRADE_SCOPE_MISMATCH");
  }
  if (Number(record.revision || 0) !== payload.expectedRevision) {
    fail("aborted", "Grade record revision changed.", "GRADE_REVISION_CONFLICT", {
      currentRevision: Number(record.revision || 0),
    });
  }
  if (Number(record.gradeRevision || 0) !== payload.expectedGradeRevision) {
    fail("aborted", "Grade evidence revision changed.", "GRADE_EVIDENCE_REVISION_CONFLICT", {
      currentGradeRevision: Number(record.gradeRevision || 0),
    });
  }
  if (!allowedStatuses.includes(record.status)) {
    fail("failed-precondition", "Grade record is not in an allowed state.", "GRADE_STATE_INVALID", {
      status: record.status,
    });
  }
  return record;
};

const createGradeCommandAdapter = () => ({
  apply: async ({ transaction, commandId, commandType, payload, receiptId, timestamp, actor }) => {
    await assertWritableSemester(
      transaction,
      payload.semesterId,
      payload.expectedSemesterRevision,
    );

    if (commandType === GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT) {
      assertTeacherActor(actor);
      const source = payload.sourceKind === "ASSESSMENT_RESULT"
        ? await loadAssessmentSource(transaction, payload)
        : await loadManualSource(transaction, payload);
      const recordId = buildRecordId({
        sourceKind: payload.sourceKind,
        attemptId: payload.attemptId,
        semesterId: payload.semesterId,
        manualSourceId: payload.manualSourceId,
        enrollmentId: source.enrollmentId,
      });
      const path = recordPath(recordId);
      const existing = await transaction.get(path);
      if (existing.exists) {
        fail("already-exists", "A grade record already exists for this source.", "GRADE_RECORD_EXISTS", {
          recordId,
        });
      }
      const baseRecord = {
        recordId,
        logicalKey: payload.sourceKind === "ASSESSMENT_RESULT"
          ? `ASSESSMENT_RESULT:${payload.attemptId}`
          : `MANUAL_IMPORT:${payload.semesterId}:${payload.manualSourceId}:${source.enrollmentId}`,
        semesterId: payload.semesterId,
        studentUid: source.studentUid,
        enrollmentId: source.enrollmentId,
        classId: source.classId,
        sourceKind: payload.sourceKind,
        sourceId: source.sourceId,
        sourceRefs: source.sourceRefs,
        sourceSnapshotHash: source.sourceSnapshotHash,
        scoreKind: payload.scoreKind,
        enrollmentSnapshot: source.enrollmentSnapshot,
        definitionId: source.definitionId,
        definitionRevision: source.definitionRevision,
        sourceHash: source.sourceHash,
        title: payload.title,
        rubricVersion: payload.rubricVersion,
      };
      const version = buildVersion({
        record: baseRecord,
        gradeRevision: 1,
        items: source.items,
        state: "DRAFT",
        reason: payload.reason,
        actor,
        commandId,
        receiptId,
        timestamp,
      });
      transaction.create(versionPath(version.versionId), version);
      transaction.create(path, {
        schemaVersion: GRADE_SCHEMA_VERSION,
        policyVersion: GRADE_POLICY_VERSION,
        ...baseRecord,
        revision: 1,
        gradeRevision: 1,
        status: "DRAFT",
        currentVersionId: version.versionId,
        currentVersionRef: versionPath(version.versionId),
        evidenceHash: version.evidenceHash,
        totalScore: version.totalScore,
        totalMaxScore: version.totalMaxScore,
        percent: version.percent,
        signatureRequired: false,
        provenance: "CURRENT",
        createdBy: actor.actorUid,
        updatedBy: actor.actorUid,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return {
        target: { kind: "grade-record", id: recordId, refs: [path, versionPath(version.versionId)] },
        sourceHash: source.sourceHash,
        result: {
          recordId,
          versionId: version.versionId,
          revision: 1,
          gradeRevision: 1,
          status: "DRAFT",
          evidenceHash: version.evidenceHash,
          scoreKind: payload.scoreKind,
        },
      };
    }

    const path = recordPath(payload.recordId);
    const recordSnapshot = await transaction.get(path);

    if (commandType === GRADE_COMMAND_TYPES.REVIEW_GRADE_DRAFT) {
      assertTeacherActor(actor);
      const record = assertRecordCas(recordSnapshot, payload, ["DRAFT", "REVIEWED"]);
      const gradeRevision = payload.expectedGradeRevision + 1;
      const version = buildVersion({
        record,
        gradeRevision,
        items: payload.items,
        state: "REVIEWED",
        reason: payload.reason,
        actor,
        commandId,
        receiptId,
        timestamp,
        supersedesVersionId: record.currentVersionId,
      });
      const revision = payload.expectedRevision + 1;
      transaction.create(versionPath(version.versionId), version);
      transaction.set(path, {
        revision,
        gradeRevision,
        status: "REVIEWED",
        currentVersionId: version.versionId,
        currentVersionRef: versionPath(version.versionId),
        evidenceHash: version.evidenceHash,
        totalScore: version.totalScore,
        totalMaxScore: version.totalMaxScore,
        percent: version.percent,
        reviewReason: payload.reason,
        reviewedBy: actor.actorUid,
        reviewedAt: timestamp,
        updatedBy: actor.actorUid,
        updatedAt: timestamp,
      }, { merge: true });
      return {
        target: { kind: "grade-review", id: payload.recordId, refs: [path, versionPath(version.versionId)] },
        sourceHash: record.sourceHash,
        result: {
          recordId: payload.recordId,
          versionId: version.versionId,
          revision,
          gradeRevision,
          status: "REVIEWED",
          evidenceHash: version.evidenceHash,
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.FINALIZE_GRADE_EVIDENCE) {
      assertTeacherActor(actor);
      const record = assertRecordCas(recordSnapshot, payload, ["REVIEWED"]);
      if (record.currentVersionId !== payload.expectedVersionId) {
        fail("aborted", "Grade evidence version changed.", "GRADE_VERSION_CONFLICT");
      }
      const version = await transaction.get(versionPath(payload.expectedVersionId));
      if (!version.exists || version.data?.evidenceHash !== record.evidenceHash) {
        fail("failed-precondition", "Grade evidence cannot be finalized.", "GRADE_EVIDENCE_INVALID");
      }
      const revision = payload.expectedRevision + 1;
      transaction.set(path, {
        revision,
        status: "EVIDENCE_LOCKED",
        finalizedBy: actor.actorUid,
        finalizedAt: timestamp,
        finalizeReason: payload.reason,
        updatedBy: actor.actorUid,
        updatedAt: timestamp,
      }, { merge: true });
      return {
        target: { kind: "grade-finalization", id: payload.recordId, refs: [path, versionPath(payload.expectedVersionId)] },
        sourceHash: record.sourceHash,
        result: {
          recordId: payload.recordId,
          versionId: payload.expectedVersionId,
          revision,
          gradeRevision: payload.expectedGradeRevision,
          status: "EVIDENCE_LOCKED",
          evidenceHash: record.evidenceHash,
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.PUBLISH_OFFICIAL_GRADE) {
      assertTeacherActor(actor);
      const record = assertRecordCas(recordSnapshot, payload, ["EVIDENCE_LOCKED"]);
      if (record.currentVersionId !== payload.expectedVersionId) {
        fail("aborted", "Grade evidence version changed.", "GRADE_VERSION_CONFLICT");
      }
      const version = await transaction.get(versionPath(payload.expectedVersionId));
      if (!version.exists || version.data?.evidenceHash !== record.evidenceHash) {
        fail("failed-precondition", "Grade evidence cannot be published.", "GRADE_EVIDENCE_INVALID");
      }
      const revision = payload.expectedRevision + 1;
      const status = payload.signatureRequired ? "OFFICIAL_PENDING_SIGNATURE" : "OFFICIAL";
      transaction.set(path, {
        revision,
        status,
        signatureRequired: payload.signatureRequired,
        publishedBy: actor.actorUid,
        publishedAt: timestamp,
        publishReason: payload.reason,
        officialAt: status === "OFFICIAL" ? timestamp : null,
        officialVersionId: status === "OFFICIAL" ? record.currentVersionId : null,
        signedAttestationId: null,
        signedBy: null,
        signedAt: null,
        updatedBy: actor.actorUid,
        updatedAt: timestamp,
      }, { merge: true });
      return {
        target: { kind: "official-grade-publication", id: payload.recordId, refs: [path, versionPath(payload.expectedVersionId)] },
        sourceHash: record.sourceHash,
        result: {
          recordId: payload.recordId,
          versionId: payload.expectedVersionId,
          revision,
          gradeRevision: payload.expectedGradeRevision,
          status,
          evidenceHash: record.evidenceHash,
          signatureRequired: payload.signatureRequired,
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.CORRECT_OFFICIAL_GRADE) {
      assertTeacherActor(actor);
      const record = assertRecordCas(recordSnapshot, payload, ["OFFICIAL_PENDING_SIGNATURE", "OFFICIAL"]);
      let request = null;
      if (payload.requestId) {
        request = await transaction.get(requestPath(payload.requestId));
        if (
          !request.exists
          || request.data?.recordId !== payload.recordId
          || request.data?.studentUid !== record.studentUid
          || request.data?.status !== "PENDING"
          || Number(request.data?.gradeRevision || 0) !== payload.expectedGradeRevision
        ) {
          fail("failed-precondition", "Grade review request is not pending for this version.", "GRADE_REQUEST_INVALID");
        }
      }
      if (payload.resolution === "REJECT") {
        transaction.set(requestPath(payload.requestId), {
          status: "REJECTED",
          resolvedBy: actor.actorUid,
          resolvedAt: timestamp,
          resolutionReason: payload.reason,
          correctionVersionId: "",
          updatedAt: timestamp,
        }, { merge: true });
        return {
          target: {
            kind: "grade-request-rejection",
            id: payload.requestId,
            refs: [requestPath(payload.requestId), path],
          },
          sourceHash: record.sourceHash,
          result: {
            requestId: payload.requestId,
            recordId: payload.recordId,
            versionId: record.currentVersionId,
            revision: payload.expectedRevision,
            gradeRevision: payload.expectedGradeRevision,
            status: record.status,
            requestStatus: "REJECTED",
            evidenceHash: record.evidenceHash,
          },
        };
      }
      const gradeRevision = payload.expectedGradeRevision + 1;
      const version = buildVersion({
        record,
        gradeRevision,
        items: payload.items,
        state: "CORRECTION_REVIEWED",
        reason: payload.reason,
        actor,
        commandId,
        receiptId,
        timestamp,
        supersedesVersionId: record.currentVersionId,
      });
      const revision = payload.expectedRevision + 1;
      transaction.create(versionPath(version.versionId), version);
      transaction.set(path, {
        revision,
        gradeRevision,
        status: "REVIEWED",
        currentVersionId: version.versionId,
        currentVersionRef: versionPath(version.versionId),
        evidenceHash: version.evidenceHash,
        totalScore: version.totalScore,
        totalMaxScore: version.totalMaxScore,
        percent: version.percent,
        correctionReason: payload.reason,
        correctedBy: actor.actorUid,
        correctedAt: timestamp,
        previousOfficialVersionId: record.currentVersionId,
        signatureRequired: false,
        officialVersionId: null,
        officialAt: null,
        signedAttestationId: null,
        signedBy: null,
        signedAt: null,
        updatedBy: actor.actorUid,
        updatedAt: timestamp,
      }, { merge: true });
      const refs = [path, versionPath(version.versionId)];
      if (request) {
        transaction.set(requestPath(payload.requestId), {
          status: "ACCEPTED",
          resolvedBy: actor.actorUid,
          resolvedAt: timestamp,
          resolutionReason: payload.reason,
          correctionVersionId: version.versionId,
          updatedAt: timestamp,
        }, { merge: true });
        refs.push(requestPath(payload.requestId));
      }
      return {
        target: { kind: "grade-correction", id: payload.recordId, refs },
        sourceHash: record.sourceHash,
        result: {
          recordId: payload.recordId,
          versionId: version.versionId,
          supersedesVersionId: record.currentVersionId,
          revision,
          gradeRevision,
          status: "REVIEWED",
          evidenceHash: version.evidenceHash,
          requestId: payload.requestId || null,
          requestStatus: payload.requestId ? "ACCEPTED" : null,
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.REQUEST_GRADE_REVIEW) {
      assertStudentActor(actor);
      const record = assertRecordCas(recordSnapshot, payload, ["OFFICIAL_PENDING_SIGNATURE", "OFFICIAL"]);
      if (record.studentUid !== actor.actorUid) {
        fail("permission-denied", "Grade record belongs to another student.", "GRADE_RECORD_FORBIDDEN");
      }
      const requestId = buildRequestId(
        payload.recordId,
        payload.expectedGradeRevision,
        actor.actorUid,
        payload.requestKind,
      );
      const targetPath = requestPath(requestId);
      const existing = await transaction.get(targetPath);
      if (existing.exists) {
        fail("already-exists", "A request already exists for this grade revision.", "GRADE_REQUEST_EXISTS", {
          requestId,
        });
      }
      transaction.create(targetPath, {
        schemaVersion: GRADE_SCHEMA_VERSION,
        policyVersion: GRADE_POLICY_VERSION,
        requestId,
        recordId: payload.recordId,
        versionId: record.currentVersionId,
        gradeRevision: payload.expectedGradeRevision,
        evidenceHash: record.evidenceHash,
        semesterId: payload.semesterId,
        studentUid: actor.actorUid,
        enrollmentId: record.enrollmentId,
        classId: record.classId,
        requestKind: payload.requestKind,
        reason: payload.reason,
        status: "PENDING",
        createdBy: actor.actorUid,
        commandId,
        receiptId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return {
        target: { kind: "grade-review-request", id: requestId, refs: [targetPath, path] },
        sourceHash: record.sourceHash,
        result: {
          requestId,
          recordId: payload.recordId,
          versionId: record.currentVersionId,
          gradeRevision: payload.expectedGradeRevision,
          status: "PENDING",
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.ACKNOWLEDGE_GRADE_EVIDENCE) {
      assertStudentActor(actor);
      const record = assertRecordCas(recordSnapshot, payload, ["OFFICIAL_PENDING_SIGNATURE", "OFFICIAL"]);
      if (record.studentUid !== actor.actorUid) {
        fail("permission-denied", "Grade record belongs to another student.", "GRADE_RECORD_FORBIDDEN");
      }
      const attestationId = buildAttestationId(
        "ACKNOWLEDGEMENT",
        payload.recordId,
        payload.expectedGradeRevision,
        actor.actorUid,
      );
      const targetPath = attestationPath(attestationId);
      const existing = await transaction.get(targetPath);
      if (existing.exists) {
        if (
          existing.data?.evidenceHash !== record.evidenceHash
          || existing.data?.statementVersion !== payload.statementVersion
        ) {
          fail("already-exists", "Acknowledgement identity conflicts with existing evidence.", "GRADE_ATTESTATION_CONFLICT");
        }
        return {
          target: { kind: "grade-acknowledgement", id: attestationId, refs: [targetPath, path] },
          sourceHash: record.sourceHash,
          result: {
            attestationId,
            recordId: payload.recordId,
            gradeRevision: payload.expectedGradeRevision,
            evidenceHash: record.evidenceHash,
            replayedAttestation: true,
          },
        };
      }
      transaction.create(targetPath, {
        schemaVersion: GRADE_SCHEMA_VERSION,
        policyVersion: GRADE_POLICY_VERSION,
        attestationId,
        type: "ACKNOWLEDGEMENT",
        recordId: payload.recordId,
        versionId: record.currentVersionId,
        recordRevision: payload.expectedRevision,
        gradeRevision: payload.expectedGradeRevision,
        evidenceHash: record.evidenceHash,
        semesterId: payload.semesterId,
        studentUid: actor.actorUid,
        statementVersion: payload.statementVersion,
        commandId,
        receiptId,
        createdAt: timestamp,
      });
      return {
        target: { kind: "grade-acknowledgement", id: attestationId, refs: [targetPath, path] },
        sourceHash: record.sourceHash,
        result: {
          attestationId,
          recordId: payload.recordId,
          versionId: record.currentVersionId,
          gradeRevision: payload.expectedGradeRevision,
          evidenceHash: record.evidenceHash,
          replayedAttestation: false,
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.SIGN_OFFICIAL_GRADE) {
      assertStudentActor(actor);
      const record = assertRecordCas(recordSnapshot, payload, ["OFFICIAL_PENDING_SIGNATURE"]);
      if (record.studentUid !== actor.actorUid || record.signatureRequired !== true) {
        fail("permission-denied", "Grade record cannot be signed by this student.", "GRADE_SIGNATURE_FORBIDDEN");
      }
      const acknowledgementId = buildAttestationId(
        "ACKNOWLEDGEMENT",
        payload.recordId,
        payload.expectedGradeRevision,
        actor.actorUid,
      );
      const signatureId = buildAttestationId(
        "SIGNATURE",
        payload.recordId,
        payload.expectedGradeRevision,
        actor.actorUid,
      );
      const [acknowledgement, existingSignature] = await transaction.getAll([
        attestationPath(acknowledgementId),
        attestationPath(signatureId),
      ]);
      if (
        !acknowledgement.exists
        || acknowledgement.data?.evidenceHash !== record.evidenceHash
        || acknowledgement.data?.versionId !== record.currentVersionId
      ) {
        fail("failed-precondition", "The exact grade revision must be acknowledged first.", "GRADE_ACKNOWLEDGEMENT_REQUIRED");
      }
      if (acknowledgement.data?.statementVersion !== payload.statementVersion) {
        fail("failed-precondition", "Signature statement does not match the acknowledged statement.", "GRADE_SIGNATURE_STATEMENT_MISMATCH");
      }
      const signatureHash = sha256(canonicalJson({
        type: "SIGNATURE",
        recordId: payload.recordId,
        versionId: record.currentVersionId,
        gradeRevision: payload.expectedGradeRevision,
        evidenceHash: record.evidenceHash,
        studentUid: actor.actorUid,
        signatureName: payload.signatureName,
        statementVersion: payload.statementVersion,
      }));
      if (existingSignature.exists) {
        fail("already-exists", "This grade revision has already been signed.", "GRADE_SIGNATURE_EXISTS", {
          attestationId: signatureId,
        });
      }
      transaction.create(attestationPath(signatureId), {
        schemaVersion: GRADE_SCHEMA_VERSION,
        policyVersion: GRADE_POLICY_VERSION,
        attestationId: signatureId,
        type: "SIGNATURE",
        recordId: payload.recordId,
        versionId: record.currentVersionId,
        recordRevision: payload.expectedRevision,
        gradeRevision: payload.expectedGradeRevision,
        evidenceHash: record.evidenceHash,
        semesterId: payload.semesterId,
        studentUid: actor.actorUid,
        signatureName: payload.signatureName,
        statementVersion: payload.statementVersion,
        signatureHash,
        acknowledgementRef: attestationPath(acknowledgementId),
        commandId,
        receiptId,
        createdAt: timestamp,
      });
      const revision = payload.expectedRevision + 1;
      transaction.set(path, {
        revision,
        status: "OFFICIAL",
        officialVersionId: record.currentVersionId,
        officialAt: timestamp,
        signedAttestationId: signatureId,
        signedBy: actor.actorUid,
        signedAt: timestamp,
        updatedBy: actor.actorUid,
        updatedAt: timestamp,
      }, { merge: true });
      return {
        target: { kind: "official-grade-signature", id: signatureId, refs: [attestationPath(signatureId), path] },
        sourceHash: record.sourceHash,
        result: {
          attestationId: signatureId,
          recordId: payload.recordId,
          versionId: record.currentVersionId,
          revision,
          gradeRevision: payload.expectedGradeRevision,
          evidenceHash: record.evidenceHash,
          signatureHash,
          status: "OFFICIAL",
        },
      };
    }

    fail("invalid-argument", "Unsupported grade command.", "GRADE_COMMAND_UNSUPPORTED", {
      commandType,
    });
  },
});

const getGradeCommandSessionOptions = (commandType) => ({
  recentAuth: HIGH_RISK_COMMAND_TYPES.has(commandType),
  highRisk: HIGH_RISK_COMMAND_TYPES.has(commandType),
});

const normalizeQuery = (raw) => {
  const value = raw || {};
  assertAllowedKeys(
    value,
    [
      "mode", "audience", "semesterId", "recordId", "studentUid", "source",
      "provenance", "scoreKind", "status", "_session",
    ],
    "getGradeEvidenceState payload",
  );
  if (value.audience !== undefined && !['student', 'teacher'].includes(value.audience)) {
    fail("invalid-argument", "audience is invalid.", "GRADE_QUERY_INVALID");
  }
  const inferredMode = value.recordId
    ? "GRADE_DETAIL"
    : (value.audience === "teacher" ? "TEACHER_QUEUE" : "MY_GRADES");
  const mode = value.mode || inferredMode;
  if (!['MY_GRADES', 'GRADE_DETAIL', 'TEACHER_QUEUE'].includes(mode)) {
    fail("invalid-argument", "mode is invalid.", "GRADE_QUERY_INVALID");
  }
  const source = value.provenance || value.source;
  if (!['CURRENT', 'PREPARING', 'ARCHIVE', 'LEGACY', 'EXPLICIT'].includes(source)) {
    fail("invalid-argument", "source is invalid.", "GRADE_QUERY_INVALID");
  }
  return {
    mode,
    audience: value.audience || (mode === "TEACHER_QUEUE" ? "teacher" : "student"),
    semesterId: normalizeSemesterId(value.semesterId),
    recordId: value.recordId ? normalizeRecordId(value.recordId) : "",
    studentUid: value.studentUid ? text(value.studentUid, "studentUid", 160) : "",
    source,
    scoreKind: normalizeScoreKind(value.scoreKind),
    status: value.status ? text(value.status, "status", 60) : "",
  };
};

const publicRecord = (record, includeStudent) => ({
  recordId: record.recordId,
  versionId: record.currentVersionId,
  revision: Number(record.revision || 0),
  gradeRevision: Number(record.gradeRevision || 0),
  status: record.status,
  semesterId: record.semesterId,
  ...(includeStudent ? { studentUid: record.studentUid } : {}),
  enrollmentId: record.enrollmentId,
  classId: record.classId,
  sourceKind: record.sourceKind,
  sourceId: record.sourceId,
  scoreKind: record.scoreKind,
  title: record.title,
  rubricVersion: record.rubricVersion,
  totalScore: Number(record.totalScore || 0),
  totalMaxScore: Number(record.totalMaxScore || 0),
  percent: Number(record.percent || 0),
  evidenceHash: record.evidenceHash,
  signatureRequired: record.signatureRequired === true,
  enrollmentSnapshot: record.enrollmentSnapshot || null,
  provenance: record.provenance || "CURRENT",
});

const publicVersion = (version) => ({
  versionId: version.versionId,
  recordId: version.recordId,
  gradeRevision: Number(version.gradeRevision || 0),
  state: version.state,
  title: version.title,
  rubricVersion: version.rubricVersion,
  items: Array.isArray(version.items) ? version.items : [],
  totalScore: Number(version.totalScore || 0),
  totalMaxScore: Number(version.totalMaxScore || 0),
  percent: Number(version.percent || 0),
  evidenceHash: version.evidenceHash,
  supersedesVersionId: version.supersedesVersionId || "",
  sourceKind: version.sourceKind,
  scoreKind: version.scoreKind,
  enrollmentSnapshot: version.enrollmentSnapshot || null,
  definitionId: version.definitionId || "",
  definitionRevision: Number(version.definitionRevision || 0),
  sourceHash: version.sourceHash,
  sourceRefs: Array.isArray(version.sourceRefs) ? version.sourceRefs : [],
  sourceSnapshotHash: version.sourceSnapshotHash,
});

const publicRequest = (request) => ({
  requestId: request.requestId,
  recordId: request.recordId,
  versionId: request.versionId,
  gradeRevision: Number(request.gradeRevision || 0),
  requestKind: request.requestKind,
  reason: request.reason,
  status: request.status,
  resolutionReason: request.resolutionReason || "",
  correctionVersionId: request.correctionVersionId || "",
  createdBy: request.createdBy || request.studentUid || "",
  createdAt: request.createdAt || null,
  resolvedBy: request.resolvedBy || "",
  resolvedAt: request.resolvedAt || null,
});

const publicAttestation = (attestation) => ({
  attestationId: attestation.attestationId,
  type: attestation.type,
  recordId: attestation.recordId,
  versionId: attestation.versionId,
  gradeRevision: Number(attestation.gradeRevision || 0),
  evidenceHash: attestation.evidenceHash,
  statementVersion: attestation.statementVersion || "",
  signatureName: attestation.signatureName || "",
  signatureHash: attestation.signatureHash || "",
  actorUid: attestation.studentUid || "",
  createdAt: attestation.createdAt || null,
});

const loadPublicSourceEvidence = async ({ transaction, record, actor }) => {
  if (record.sourceKind !== "ASSESSMENT_RESULT") {
    return {
      sourceKind: record.sourceKind,
      sourceId: record.sourceId,
      sourceRefs: Array.isArray(record.sourceRefs) ? record.sourceRefs : [],
      sourceSnapshotHash: record.sourceSnapshotHash,
      sourceHash: record.sourceHash,
      provenance: record.provenance || "CURRENT",
    };
  }
  const [attempt, submission, result, enrollment, semesterClass] = await transaction.getAll([
    attemptPath(record.sourceId),
    submissionPath(record.sourceId),
    resultPath(record.sourceId),
    enrollmentPath(record.enrollmentId),
    classPath(record.classId),
  ]);
  const inspected = inspectAssessmentJoin({
    attempt,
    submission,
    result,
    enrollment,
    semesterClass,
    expectedSemesterId: record.semesterId,
  });
  if (
    !inspected.ok
    || inspected.sourceSnapshotHash !== record.sourceSnapshotHash
    || inspected.sourceHash !== record.sourceHash
  ) {
    fail(
      "failed-precondition",
      "The immutable assessment source no longer matches this grade record.",
      "GRADE_SOURCE_EVIDENCE_INVALID",
      { recordId: record.recordId, sourceId: record.sourceId },
    );
  }
  const attemptData = attempt.data || {};
  const submissionData = submission.data || {};
  const resultData = result.data || {};
  return {
    sourceKind: "ASSESSMENT_RESULT",
    sourceId: record.sourceId,
    sourceRefs: inspected.sourceRefs,
    sourceSnapshotHash: inspected.sourceSnapshotHash,
    sourceHash: inspected.sourceHash,
    definitionId: inspected.definitionId,
    definitionRevision: inspected.definitionRevision,
    attemptRevision: Number(attemptData.revision || 0),
    submittedAtIso: String(submissionData.submittedAtIso || ""),
    questionIds: Array.isArray(attemptData.questionIds) ? attemptData.questionIds.map(String) : [],
    answers: isPlainObject(submissionData.answers) ? submissionData.answers : {},
    answerChecks: Array.isArray(resultData.answerChecks)
      ? resultData.answerChecks.map((item) => ({
        itemId: String(item?.id || ""),
        correct: item?.correct === true,
      }))
      : [],
    result: {
      score: Number(resultData.score || 0),
      total: Number(resultData.total || 0),
      percent: Number(resultData.percent || 0),
    },
    answerKeyIncluded: false,
    visibleTo: actor.canManage ? "TEACHER" : "STUDENT_OWNER",
  };
};

const createGradeQueryCore = ({
  store,
  assertSession = sessionAuthority.assertActiveApplicationSession,
} = {}) => {
  if (!store) throw new TypeError("store is required.");

  const resolveActor = async (request) => {
    const identity = await assertSession(request, { recentAuth: false, highRisk: false });
    const uid = String(identity?.uid || request.auth?.uid || "").trim();
    if (!uid || uid !== String(request.auth?.uid || "").trim()) {
      fail("permission-denied", "Authenticated actor mismatch.", "COMMAND_ACTOR_MISMATCH");
    }
    const profile = await store.get(`users/${uid}`);
    const role = String(profile.data?.role || "student").trim() || "student";
    const permissions = Array.isArray(profile.data?.staffPermissions)
      ? profile.data.staffPermissions
      : [];
    const isAdmin = String(identity?.email || request.auth?.token?.email || "").trim().toLowerCase()
      === "westoria28@gmail.com";
    const canManage = isAdmin || (
      profile.data?.teacherPortalEnabled === true
      && permissions.includes("quiz_read")
    );
    return { uid, role: isAdmin ? "admin" : role, canManage };
  };

  const getGradeEvidenceState = async (request) => {
    const actor = await resolveActor(request);
    const query = normalizeQuery(request.data || {});
    if (query.mode === "TEACHER_QUEUE" && !actor.canManage) {
      fail("permission-denied", "Grade management permission is required.", "GRADE_MANAGE_REQUIRED");
    }
    if (query.mode === "GRADE_DETAIL" && !query.recordId) {
      fail("invalid-argument", "recordId is required for grade detail.", "GRADE_QUERY_INVALID");
    }
    if (query.source === "LEGACY") {
      return {
        mode: query.mode,
        audience: query.audience,
        source: "LEGACY",
        provenance: "LEGACY",
        scoreKind: query.scoreKind,
        semesterId: query.semesterId,
        manifestRevision: null,
        readOnly: true,
        status: "LEGACY",
        records: [],
        pendingSources: [],
        detail: null,
        reason: "LEGACY_SOURCE_REQUIRES_EXPLICIT_MIGRATION_EVIDENCE",
        writeCount: 0,
      };
    }

    return store.runTransaction(async (transaction) => {
      const manifest = await transaction.get(manifestPath(query.semesterId));
      if (!manifest.exists) {
        return {
          mode: query.mode,
          audience: query.audience,
          source: query.source,
          provenance: query.source,
          scoreKind: query.scoreKind,
          semesterId: query.semesterId,
          manifestRevision: null,
          readOnly: true,
          status: "EMPTY",
          records: [],
          pendingSources: [],
          detail: null,
          reason: "SEMESTER_NOT_FOUND",
          writeCount: 0,
        };
      }
      const manifestStatus = String(manifest.data?.status || "");
      if (!semesterCore.SEMESTER_STATUSES.includes(manifestStatus)) {
        fail(
          "failed-precondition",
          "Semester Manifest status is invalid.",
          "GRADE_MANIFEST_STATUS_INVALID",
          { semesterId: query.semesterId, manifestStatus },
        );
      }
      const archived = ["CLOSED", "ARCHIVED"].includes(manifestStatus);
      const preparing = [
        "DRAFT", "PREPARING", "VALIDATING", "READY", "FAILED", "QUARANTINED",
      ].includes(manifestStatus);
      if (query.source === "ARCHIVE" && !archived) {
        fail(
          "failed-precondition",
          "ARCHIVE provenance requires a closed or archived semester.",
          "GRADE_PROVENANCE_MISMATCH",
          { semesterId: query.semesterId, manifestStatus },
        );
      }
      const archivedView = archived;
      const lifecycleProvenance = archived ? "ARCHIVE" : (preparing ? "PREPARING" : "CURRENT");
      const provenance = query.source === "EXPLICIT" && lifecycleProvenance === "CURRENT"
        ? "EXPLICIT"
        : lifecycleProvenance;
      const readOnly = manifestStatus !== "ACTIVE" || query.source !== "CURRENT";
      let recordDocuments;
      if (query.mode === "GRADE_DETAIL") {
        const recordDocument = await transaction.get(recordPath(query.recordId));
        recordDocuments = recordDocument.exists ? [recordDocument] : [];
      } else if (!actor.canManage) {
        recordDocuments = await transaction.query(GRADE_RECORD_COLLECTION, {
          field: "studentUid",
          operator: "==",
          value: actor.uid,
        });
      } else if (query.studentUid) {
        recordDocuments = await transaction.query(GRADE_RECORD_COLLECTION, {
          field: "studentUid",
          operator: "==",
          value: query.studentUid,
        });
      } else {
        recordDocuments = await transaction.query(GRADE_RECORD_COLLECTION, {
          field: "semesterId",
          operator: "==",
          value: query.semesterId,
        });
      }
      const scopedRecords = recordDocuments
        .map((document) => document.data || {})
        .filter((record) => record.semesterId === query.semesterId);
      const allSemesterRecords = scopedRecords;
      let records = scopedRecords
        .filter((record) => actor.canManage || record.studentUid === actor.uid)
        .filter((record) => record.scoreKind === query.scoreKind)
        .filter((record) => !query.studentUid || record.studentUid === query.studentUid)
        .filter((record) => !query.status || record.status === query.status);
      if (query.mode === "MY_GRADES") {
        const requestedUid = query.studentUid || actor.uid;
        if (!actor.canManage && requestedUid !== actor.uid) {
          fail("permission-denied", "Another student's grades are not visible.", "GRADE_RECORD_FORBIDDEN");
        }
        records = records.filter((record) => record.studentUid === requestedUid);
      }
      if (query.mode === "GRADE_DETAIL") {
        records = records.filter((record) => record.recordId === query.recordId);
      }
      if (!actor.canManage) {
        records = records.filter((record) =>
          ["OFFICIAL_PENDING_SIGNATURE", "OFFICIAL"].includes(record.status));
      }
      if (records.some((record) =>
        record.schemaVersion !== GRADE_SCHEMA_VERSION
        || record.policyVersion !== GRADE_POLICY_VERSION
        || !SUPPORTED_RUBRIC_VERSIONS.includes(record.rubricVersion)
        || !GRADE_SCORE_KINDS.includes(record.scoreKind))) {
        fail(
          "failed-precondition",
          "A grade record uses an unsupported schema, policy, or rubric version.",
          "GRADE_RECORD_VERSION_UNSUPPORTED",
        );
      }
      records.sort((left, right) =>
        String(left.title || "").localeCompare(String(right.title || ""), "ko")
        || String(left.recordId || "").localeCompare(String(right.recordId || "")));

      let detail = null;
      if (query.mode === "GRADE_DETAIL" && records.length === 1) {
        const record = records[0];
        const version = await transaction.get(versionPath(record.currentVersionId));
        const requests = await transaction.query(GRADE_REQUEST_COLLECTION, {
          field: "recordId",
          operator: "==",
          value: record.recordId,
        });
        const attestations = await transaction.query(GRADE_ATTESTATION_COLLECTION, {
          field: "recordId",
          operator: "==",
          value: record.recordId,
        });
        if (
          !version.exists
          || version.data?.recordId !== record.recordId
          || version.data?.evidenceHash !== record.evidenceHash
          || !versionEvidenceMatches(version.data || {})
        ) {
          fail(
            "failed-precondition",
            "The current grade evidence version is invalid.",
            "GRADE_EVIDENCE_INVALID",
            { recordId: record.recordId },
          );
        }
        const currentAttestations = attestations
          .map((document) => document.data || {})
          .filter((attestation) =>
            attestation.versionId === record.currentVersionId
            && Number(attestation.gradeRevision || 0) === Number(record.gradeRevision || 0)
            && attestation.evidenceHash === record.evidenceHash);
        const sourceEvidence = await loadPublicSourceEvidence({ transaction, record, actor });
        detail = {
          record: { ...publicRecord(record, actor.canManage), provenance, readOnly },
          version: publicVersion(version.data || {}),
          requests: requests.map((document) => publicRequest(document.data || {})),
          attestations: currentAttestations.map(publicAttestation),
          sourceEvidence,
        };
      }
      const projected = records.map((record) => ({
        ...publicRecord(record, actor.canManage),
        provenance,
        readOnly,
      }));
      let pendingSources = [];
      if (query.mode === "TEACHER_QUEUE") {
        const attempts = await transaction.query(assessmentLifecycle.ATTEMPT_COLLECTION, {
          field: "semesterId",
          operator: "==",
          value: query.semesterId,
        });
        const definitions = await transaction.query(assessmentLifecycle.DEFINITION_COLLECTION, {
          field: "semesterId",
          operator: "==",
          value: query.semesterId,
        });
        const submissions = await transaction.query(assessmentLifecycle.SUBMISSION_COLLECTION, {
          field: "semesterId",
          operator: "==",
          value: query.semesterId,
        });
        const results = await transaction.query(assessmentLifecycle.RESULT_COLLECTION, {
          field: "semesterId",
          operator: "==",
          value: query.semesterId,
        });
        const enrollments = await transaction.query(archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION, {
          field: "semesterId",
          operator: "==",
          value: query.semesterId,
        });
        const classes = await transaction.query(archiveEnrollment.SEMESTER_CLASS_COLLECTION, {
          field: "semesterId",
          operator: "==",
          value: query.semesterId,
        });
        const definitionById = new Map(definitions.map((document) => [
          document.data?.definitionId,
          document.data || {},
        ]));
        const submissionByAttemptId = new Map(submissions.map((document) => [
          document.data?.attemptId,
          document,
        ]));
        const resultByAttemptId = new Map(results.map((document) => [
          document.data?.attemptId,
          document,
        ]));
        const enrollmentById = new Map(enrollments.map((document) => [
          document.data?.enrollmentId,
          document.data || {},
        ]));
        const classById = new Map(classes.map((document) => [
          document.data?.classId,
          document.data || {},
        ]));
        const gradedAttemptIds = new Set(
          allSemesterRecords
            .filter((record) => record.sourceKind === "ASSESSMENT_RESULT")
            .map((record) => record.sourceId),
        );
        pendingSources = attempts
          .map((document) => ({ document, attempt: document.data || {} }))
          .map(({ document, attempt }) => {
            const enrollment = enrollmentById.get(attempt.enrollmentId) || {};
            const semesterClass = classById.get(attempt.classId) || {};
            const inspected = inspectAssessmentJoin({
              attempt: document,
              submission: submissionByAttemptId.get(attempt.attemptId),
              result: resultByAttemptId.get(attempt.attemptId),
              enrollment: enrollment.enrollmentId ? { exists: true, data: enrollment } : null,
              semesterClass: semesterClass.classId ? { exists: true, data: semesterClass } : null,
              expectedSemesterId: query.semesterId,
            });
            return { attempt, enrollment, semesterClass, inspected };
          })
          .filter(({ inspected }) => inspected.ok)
          .filter(({ attempt }) => {
            const definition = definitionById.get(attempt.definitionId) || {};
            return definition.definitionId === attempt.definitionId
              && Number(definition.revision || 0) === Number(attempt.definitionRevision || 0);
          })
          .filter(({ attempt }) => attempt.status === "SUBMITTED" && !gradedAttemptIds.has(attempt.attemptId))
          .filter(({ attempt }) => !query.studentUid || attempt.studentUid === query.studentUid)
          .map(({ attempt, enrollment, semesterClass, inspected }) => {
            const definition = definitionById.get(attempt.definitionId) || {};
            return {
              attemptId: attempt.attemptId,
              definitionId: attempt.definitionId,
              definitionRevision: Number(attempt.definitionRevision || 0),
              title: String(definition.title || "채점 대기 평가"),
              scoreKind: query.scoreKind,
              semesterId: query.semesterId,
              studentUid: attempt.studentUid,
              enrollmentId: attempt.enrollmentId,
              classId: attempt.classId,
              enrollmentSnapshot: buildEnrollmentSnapshot(enrollment, semesterClass),
              sourceHash: inspected.sourceHash,
              sourceSnapshotHash: inspected.sourceSnapshotHash,
              submittedAtIso: attempt.submittedAtIso || "",
              provenance,
              readOnly,
            };
          })
          .sort((left, right) =>
            String(left.title).localeCompare(String(right.title), "ko")
            || String(left.attemptId).localeCompare(String(right.attemptId)));
      }
      return {
        mode: query.mode,
        audience: query.audience,
        source: query.source,
        provenance,
        scoreKind: query.scoreKind,
        semesterId: query.semesterId,
        manifestRevision: Number(manifest.data?.revision || 0),
        manifestStatus,
        readOnly,
        status: archivedView ? "ARCHIVED" : (
          projected.length > 0 || pendingSources.length > 0 ? "CONTENT" : "EMPTY"
        ),
        records: projected,
        pendingSources,
        detail,
        reason: "",
        writeCount: 0,
      };
    });
  };

  return { getGradeEvidenceState };
};

const createGradeCallableExports = ({ core }) => ({
  getGradeEvidenceState: onCall({ region: REGION }, (request) =>
    core.getGradeEvidenceState(request)),
});

const versionEvidenceMatches = (version) => {
  if (
    version.schemaVersion !== GRADE_SCHEMA_VERSION
    || version.policyVersion !== GRADE_POLICY_VERSION
    || !SUPPORTED_RUBRIC_VERSIONS.includes(version.rubricVersion)
    || !GRADE_SCORE_KINDS.includes(version.scoreKind)
  ) return false;
  if (!Array.isArray(version.items) || version.items.length < 1) return false;
  let items;
  try {
    items = normalizeItems(version.items);
  } catch {
    return false;
  }
  const summary = summarizeItems(items);
  const expectedHash = evidenceHashFor({ ...version, items });
  return expectedHash === version.evidenceHash
    && summary.totalScore === Number(version.totalScore)
    && summary.totalMaxScore === Number(version.totalMaxScore)
    && summary.percent === Number(version.percent);
};

const createGradeReadinessAdapter = () => ({
  evaluate: async ({ transaction, manifest }) => {
    const semesterId = String(manifest?.semesterId || "").trim();
    const records = await transaction.query(GRADE_RECORD_COLLECTION, { field: "semesterId", operator: "==", value: semesterId });
    const versions = await transaction.query(GRADE_VERSION_COLLECTION, { field: "semesterId", operator: "==", value: semesterId });
    const requests = await transaction.query(GRADE_REQUEST_COLLECTION, { field: "semesterId", operator: "==", value: semesterId });
    const attestations = await transaction.query(GRADE_ATTESTATION_COLLECTION, { field: "semesterId", operator: "==", value: semesterId });
    const legacyIssues = await transaction.query(GRADE_LEGACY_ISSUE_COLLECTION, { field: "semesterId", operator: "==", value: semesterId });
    const enrollments = await transaction.query(archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION, { field: "semesterId", operator: "==", value: semesterId });
    const classes = await transaction.query(archiveEnrollment.SEMESTER_CLASS_COLLECTION, { field: "semesterId", operator: "==", value: semesterId });
    const attempts = await transaction.query(assessmentLifecycle.ATTEMPT_COLLECTION, { field: "semesterId", operator: "==", value: semesterId });
    const submissions = await transaction.query(assessmentLifecycle.SUBMISSION_COLLECTION, { field: "semesterId", operator: "==", value: semesterId });
    const results = await transaction.query(assessmentLifecycle.RESULT_COLLECTION, { field: "semesterId", operator: "==", value: semesterId });
    const byId = (documents, key) => new Map(documents.map((document) => [
      String(document.data?.[key] || document.path.split("/").at(-1) || ""),
      document,
    ]));
    const versionById = byId(versions, "versionId");
    const enrollmentById = byId(enrollments, "enrollmentId");
    const classById = byId(classes, "classId");
    const attemptById = byId(attempts, "attemptId");
    const submissionById = byId(submissions, "attemptId");
    const resultById = byId(results, "attemptId");
    const attestationRows = attestations.map((document) => document.data || {});
    const logicalKeys = new Set();
    let invalidSchemaCount = 0;
    let duplicateLogicalKeyCount = 0;
    let invalidVersionCount = 0;
    let invalidSourceCount = 0;
    let orphanEnrollmentCount = 0;
    let invalidOfficialCount = 0;
    let unsupportedVersionCount = versions.filter((document) => {
      const version = document.data || {};
      return version.schemaVersion !== GRADE_SCHEMA_VERSION
        || version.policyVersion !== GRADE_POLICY_VERSION
        || !SUPPORTED_RUBRIC_VERSIONS.includes(version.rubricVersion)
        || !GRADE_SCORE_KINDS.includes(version.scoreKind);
    }).length;

    const dependencyRecords = [];
    for (const document of records) {
      const record = document.data || {};
      if (
        record.schemaVersion !== GRADE_SCHEMA_VERSION
        || record.policyVersion !== GRADE_POLICY_VERSION
        || record.semesterId !== semesterId
        || record.recordId !== document.path.split("/").at(-1)
      ) invalidSchemaCount += 1;
      if (
        record.policyVersion !== GRADE_POLICY_VERSION
        || !SUPPORTED_RUBRIC_VERSIONS.includes(record.rubricVersion)
        || !GRADE_SCORE_KINDS.includes(record.scoreKind)
      ) unsupportedVersionCount += 1;
      if (logicalKeys.has(record.logicalKey)) duplicateLogicalKeyCount += 1;
      logicalKeys.add(record.logicalKey);
      const version = versionById.get(record.currentVersionId);
      if (
        !version
        || version.data?.recordId !== record.recordId
        || Number(version.data?.gradeRevision || 0) !== Number(record.gradeRevision || 0)
        || version.data?.evidenceHash !== record.evidenceHash
        || canonicalJson(version.data?.enrollmentSnapshot) !== canonicalJson(record.enrollmentSnapshot)
        || Number(version.data?.totalScore) !== Number(record.totalScore)
        || Number(version.data?.totalMaxScore) !== Number(record.totalMaxScore)
        || Number(version.data?.percent) !== Number(record.percent)
        || !versionEvidenceMatches(version.data || {})
      ) invalidVersionCount += 1;
      const enrollment = enrollmentById.get(record.enrollmentId);
      const semesterClass = classById.get(record.classId);
      if (
        !enrollment
        || !semesterClass
        || enrollment.data?.studentUid !== record.studentUid
        || enrollment.data?.semesterId !== semesterId
        || enrollment.data?.classId !== record.classId
        || semesterClass.data?.semesterId !== semesterId
        || canonicalJson(record.enrollmentSnapshot) !== canonicalJson(
          buildEnrollmentSnapshot(enrollment.data || {}, semesterClass.data || {}),
        )
      ) orphanEnrollmentCount += 1;
      if (record.sourceKind === "ASSESSMENT_RESULT") {
        const inspected = inspectAssessmentJoin({
          attempt: attemptById.get(record.sourceId),
          submission: submissionById.get(record.sourceId),
          result: resultById.get(record.sourceId),
          enrollment,
          semesterClass,
          expectedSemesterId: semesterId,
        });
        if (!inspected.ok || inspected.sourceSnapshotHash !== record.sourceSnapshotHash) {
          invalidSourceCount += 1;
        }
      } else if (record.sourceKind !== "MANUAL_IMPORT") {
        invalidSourceCount += 1;
      }
      if (record.status === "OFFICIAL") {
        const currentSignature = attestationRows.find((attestation) =>
          attestation.type === "SIGNATURE"
          && attestation.recordId === record.recordId
          && attestation.versionId === record.currentVersionId
          && Number(attestation.gradeRevision || 0) === Number(record.gradeRevision || 0)
          && attestation.evidenceHash === record.evidenceHash);
        const signatureValid = record.signatureRequired !== true || (
          currentSignature
          && record.signedAttestationId === currentSignature.attestationId
        );
        if (!record.officialVersionId || record.officialVersionId !== record.currentVersionId || !signatureValid) {
          invalidOfficialCount += 1;
        }
      } else if (
        record.status === "OFFICIAL_PENDING_SIGNATURE"
        && (
          record.signatureRequired !== true
          || record.officialVersionId !== null
          || record.signedAttestationId !== null
        )
      ) {
        invalidOfficialCount += 1;
      }
      dependencyRecords.push({
        recordId: record.recordId,
        logicalKey: record.logicalKey,
        revision: Number(record.revision || 0),
        gradeRevision: Number(record.gradeRevision || 0),
        status: record.status,
        versionId: record.currentVersionId,
        evidenceHash: record.evidenceHash,
        sourceSnapshotHash: record.sourceSnapshotHash,
      });
    }

    const recordIds = new Set(records.map((document) => document.data?.recordId));
    const recordById = byId(records, "recordId");
    const orphanRequestCount = requests.filter((document) => !recordIds.has(document.data?.recordId)).length;
    const orphanAttestationCount = attestations.filter((document) => !recordIds.has(document.data?.recordId)).length;
    const invalidRequestCount = requests.filter((document) => {
      const request = document.data || {};
      const record = recordById.get(request.recordId)?.data || {};
      const version = versionById.get(request.versionId)?.data || {};
      return request.schemaVersion !== GRADE_SCHEMA_VERSION
        || request.policyVersion !== GRADE_POLICY_VERSION
        || request.requestId !== document.path.split("/").at(-1)
        || request.semesterId !== semesterId
        || !["OBJECTION", "ANSWER_SHEET"].includes(request.requestKind)
        || !["PENDING", "ACCEPTED", "REJECTED"].includes(request.status)
        || !record.recordId
        || record.studentUid !== request.studentUid
        || !version.versionId
        || version.recordId !== request.recordId
        || Number(version.gradeRevision || 0) !== Number(request.gradeRevision || 0)
        || version.evidenceHash !== request.evidenceHash;
    }).length;
    const invalidAttestationCount = attestations.filter((document) => {
      const attestation = document.data || {};
      const record = recordById.get(attestation.recordId)?.data || {};
      const version = versionById.get(attestation.versionId)?.data || {};
      return attestation.schemaVersion !== GRADE_SCHEMA_VERSION
        || attestation.policyVersion !== GRADE_POLICY_VERSION
        || attestation.attestationId !== document.path.split("/").at(-1)
        || attestation.semesterId !== semesterId
        || !["ACKNOWLEDGEMENT", "SIGNATURE"].includes(attestation.type)
        || attestation.statementVersion !== GRADE_STATEMENT_VERSION
        || !record.recordId
        || record.studentUid !== attestation.studentUid
        || !version.versionId
        || version.recordId !== attestation.recordId
        || Number(version.gradeRevision || 0) !== Number(attestation.gradeRevision || 0)
        || version.evidenceHash !== attestation.evidenceHash
        || (
          attestation.type === "SIGNATURE"
          && (
            typeof attestation.signatureName !== "string"
            || !/^[a-f0-9]{64}$/.test(String(attestation.signatureHash || ""))
          )
        );
    }).length;
    const pendingRequestCount = requests.filter((document) => document.data?.status === "PENDING").length;
    const blockingLegacyIssues = legacyIssues.filter((document) =>
      !["RESOLVED", "DISMISSED"].includes(String(document.data?.status || "OPEN")));
    const invalidCount = invalidSchemaCount
      + duplicateLogicalKeyCount
      + invalidVersionCount
      + invalidSourceCount
      + orphanEnrollmentCount
      + invalidOfficialCount
      + unsupportedVersionCount
      + orphanRequestCount
      + orphanAttestationCount
      + invalidRequestCount
      + invalidAttestationCount
      + pendingRequestCount
      + blockingLegacyIssues.length;
    const dependencyHash = sha256(canonicalJson({
      records: dependencyRecords.sort((left, right) => left.recordId.localeCompare(right.recordId)),
      requests: requests.map((document) => ({
        requestId: document.data?.requestId,
        recordId: document.data?.recordId,
        gradeRevision: Number(document.data?.gradeRevision || 0),
        status: document.data?.status,
      })).sort((left, right) => String(left.requestId).localeCompare(String(right.requestId))),
      attestations: attestations.map((document) => ({
        attestationId: document.data?.attestationId,
        recordId: document.data?.recordId,
        gradeRevision: Number(document.data?.gradeRevision || 0),
        type: document.data?.type,
        evidenceHash: document.data?.evidenceHash,
      })).sort((left, right) => String(left.attestationId).localeCompare(String(right.attestationId))),
      legacyIssues: legacyIssues.map((document) => ({
        issueId: document.path.split("/").at(-1),
        status: document.data?.status || "OPEN",
      })).sort((left, right) => String(left.issueId).localeCompare(String(right.issueId))),
    }));
    return [{
      checkId: "grade_evidence_readiness",
      label: "Grade and evidence readiness",
      category: "GRADE_EVIDENCE",
      required: true,
      status: invalidCount === 0 ? "PASS" : "FAIL",
      evidence: `applicability=${records.length === 0 ? "NOT_APPLICABLE" : "APPLICABLE"}; records=${records.length}; versions=${versions.length}; invalidSchema=${invalidSchemaCount}; unsupportedVersions=${unsupportedVersionCount}; duplicateLogicalKeys=${duplicateLogicalKeyCount}; invalidVersions=${invalidVersionCount}; invalidSources=${invalidSourceCount}; orphanEnrollments=${orphanEnrollmentCount}; invalidOfficial=${invalidOfficialCount}; orphanRequests=${orphanRequestCount}; orphanAttestations=${orphanAttestationCount}; invalidRequests=${invalidRequestCount}; invalidAttestations=${invalidAttestationCount}; pendingRequests=${pendingRequestCount}; blockingLegacyIssues=${blockingLegacyIssues.length}; dependency=${dependencyHash}`,
      failureReason: invalidCount === 0 ? null : "GRADE_EVIDENCE_READINESS_NOT_PASS",
      ownerWave: "W6B",
    }];
  },
});

module.exports = {
  GRADE_ATTESTATION_COLLECTION,
  GRADE_COMMAND_TYPES,
  GRADE_LEGACY_ISSUE_COLLECTION,
  GRADE_POLICY_VERSION,
  GRADE_RECORD_COLLECTION,
  GRADE_REQUEST_COLLECTION,
  GRADE_SCORE_KINDS,
  GRADE_STATEMENT_VERSION,
  GRADE_SCHEMA_VERSION,
  GRADE_VERSION_COLLECTION,
  HIGH_RISK_COMMAND_TYPES,
  STUDENT_COMMAND_TYPES,
  SUPPORTED_RUBRIC_VERSIONS,
  buildAttestationId,
  buildRecordId,
  buildRequestId,
  buildVersionId,
  createGradeCallableExports,
  createGradeCommandAdapter,
  createGradeQueryCore,
  createGradeReadinessAdapter,
  getGradeCommandSessionOptions,
  normalizeGradePayload,
};
