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
const SUPPORTED_RUBRIC_VERSIONS = Object.freeze(["rubric-v1", "w6b-rubric-v1", "w6b-assessment-v1"]);

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
  UPSERT_LEGACY_GRADE_ROSTER: "upsertLegacyGradeRoster",
  DELETE_LEGACY_GRADE_ROSTER: "deleteLegacyGradeRoster",
  SAVE_LEGACY_GRADE_CONFIG: "saveLegacyGradeConfig",
  ACKNOWLEDGE_LEGACY_GRADE_WARNING: "acknowledgeLegacyGradeWarning",
  SUBMIT_LEGACY_GRADE_REQUEST: "submitLegacyGradeRequest",
  REVIEW_LEGACY_GRADE_REQUEST: "reviewLegacyGradeRequest",
  SIGN_LEGACY_GRADE_RECORDS: "signLegacyGradeRecords",
  REJECT_LEGACY_GRADE_SIGNATURES: "rejectLegacyGradeSignatures",
});

const STUDENT_COMMAND_TYPES = new Set([
  GRADE_COMMAND_TYPES.REQUEST_GRADE_REVIEW,
  GRADE_COMMAND_TYPES.ACKNOWLEDGE_GRADE_EVIDENCE,
  GRADE_COMMAND_TYPES.SIGN_OFFICIAL_GRADE,
  GRADE_COMMAND_TYPES.ACKNOWLEDGE_LEGACY_GRADE_WARNING,
  GRADE_COMMAND_TYPES.SUBMIT_LEGACY_GRADE_REQUEST,
  GRADE_COMMAND_TYPES.SIGN_LEGACY_GRADE_RECORDS,
]);

const HIGH_RISK_COMMAND_TYPES = new Set([
  GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT,
  GRADE_COMMAND_TYPES.REVIEW_GRADE_DRAFT,
  GRADE_COMMAND_TYPES.FINALIZE_GRADE_EVIDENCE,
  GRADE_COMMAND_TYPES.PUBLISH_OFFICIAL_GRADE,
  GRADE_COMMAND_TYPES.CORRECT_OFFICIAL_GRADE,
  GRADE_COMMAND_TYPES.SIGN_OFFICIAL_GRADE,
  GRADE_COMMAND_TYPES.UPSERT_LEGACY_GRADE_ROSTER,
  GRADE_COMMAND_TYPES.DELETE_LEGACY_GRADE_ROSTER,
  GRADE_COMMAND_TYPES.SAVE_LEGACY_GRADE_CONFIG,
  GRADE_COMMAND_TYPES.SIGN_LEGACY_GRADE_RECORDS,
  GRADE_COMMAND_TYPES.REJECT_LEGACY_GRADE_SIGNATURES,
]);

const LEGACY_GRADE_SCHEMA_VERSION = 1;
const LEGACY_GRADE_POLICY_VERSION = "w10p-w6b-legacy-v1";
const LEGACY_GRADE_MAX_RECORDS = 100;
const LEGACY_GRADE_MAX_ROSTER_ROWS = 240;
const LEGACY_GRADE_MAX_RELATED_ROSTERS = 12;
const LEGACY_GRADE_MAX_ATOMIC_WRITES = 450;
const LEGACY_SIGNATURE_IMAGE_MAX_LENGTH = 180_000;
const LEGACY_OMR_RELEASE_POLICY_VERSION = "w6b-answer-release-v1";
const LEGACY_OMR_RELEASE_STATUSES = Object.freeze(["HIDDEN", "RELEASED"]);
const GRADE_READINESS_BOUNDS = Object.freeze({
  records: 1_000,
  versions: 2_000,
  requests: 1_000,
  attestations: 2_000,
  legacyIssues: 250,
  totalCoreDocuments: 3_000,
  dependencyDocuments: 2_000,
});

const fail = (code, message, reason, details = {}) => {
  throw new HttpsError(code, message, { reason, ...details });
};

const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");

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

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

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
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > max) {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_PAYLOAD_INVALID", {
      field: label,
    });
  }
  return value;
};

const optionalText = (value, label, max = 160) => (value === undefined || value === null || value === "" ? "" : text(value, label, max));

const positiveInteger = (value, label, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_PAYLOAD_INVALID", {
      field: label,
    });
  }
  return value;
};

const nonNegativeInteger = (value, label, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_PAYLOAD_INVALID", {
      field: label,
    });
  }
  return value;
};

const scoreNumber = (value, label) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000 || Math.round(value * 1000) !== value * 1000) {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_SCORE_INVALID", {
      field: label,
    });
  }
  return value;
};

const normalizeSemesterId = (value) => semesterCore.normalizeSemesterId(value);

const normalizeRubricVersion = (value) => {
  const normalized = text(value, "rubricVersion", 100);
  if (!SUPPORTED_RUBRIC_VERSIONS.includes(normalized)) {
    fail("failed-precondition", "rubricVersion is not supported by the active grade policy.", "GRADE_RUBRIC_VERSION_UNSUPPORTED", {
      rubricVersion: normalized,
      policyVersion: GRADE_POLICY_VERSION,
    });
  }
  return normalized;
};

const normalizeStatementVersion = (value) => {
  const normalized = text(value, "statementVersion", 100);
  if (normalized !== GRADE_STATEMENT_VERSION) {
    fail("failed-precondition", "statementVersion is not supported by the active grade policy.", "GRADE_STATEMENT_VERSION_UNSUPPORTED", {
      statementVersion: normalized,
      policyVersion: GRADE_POLICY_VERSION,
    });
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
    fail("invalid-argument", `${label} is invalid.`, "GRADE_HASH_INVALID", {
      field: label,
    });
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
    assertAllowedKeys(item, ["itemId", "maxScore", "awardedScore", "evaluationKind", "evidence", "reason"], `items[${index}]`);
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
    if (!["AUTO", "TEACHER"].includes(item.evaluationKind)) {
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

const pathSegment = (value, label, max = 180) => {
  const normalized = text(value, label, max);
  if (normalized.includes("/") || normalized === "." || normalized === "..") {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_PAYLOAD_INVALID", {
      field: label,
    });
  }
  return normalized;
};

const normalizedText = (value, label, max, required = false) => {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if ((required && !normalized) || normalized.length > max) {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_PAYLOAD_INVALID", {
      field: label,
    });
  }
  return normalized;
};

const legacyScoreNumber = (value, label, maximum = 100_000) => {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > maximum || Math.round(normalized * 1000) !== normalized * 1000) {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_SCORE_INVALID", {
      field: label,
    });
  }
  return normalized;
};

const normalizeLegacyGradeItem = (value, index, label = "items") => {
  assertAllowedKeys(
    value,
    [
      "name",
      "shortName",
      "itemKey",
      "groupKey",
      "groupLabel",
      "examSection",
      "questionNumber",
      "correctAnswer",
      "studentAnswer",
      "answerCorrect",
      "answerStatus",
      "answerChoices",
      "feedback",
      "score",
      "maxScore",
      "ratio",
      "scoreEntered",
    ],
    `${label}[${index}]`,
  );
  const answerChoices =
    value.answerChoices === undefined
      ? []
      : (() => {
          if (!Array.isArray(value.answerChoices) || value.answerChoices.length > 10) {
            fail("invalid-argument", `${label}[${index}].answerChoices is invalid.`, "GRADE_PAYLOAD_INVALID");
          }
          return value.answerChoices.map((choice, choiceIndex) => normalizedText(choice, `${label}[${index}].answerChoices[${choiceIndex}]`, 120));
        })();
  const answerStatus = normalizedText(value.answerStatus, `${label}[${index}].answerStatus`, 20);
  if (answerStatus && !["correct", "incorrect", "blank", "invalid"].includes(answerStatus)) {
    fail("invalid-argument", `${label}[${index}].answerStatus is invalid.`, "GRADE_PAYLOAD_INVALID");
  }
  const examSection = normalizedText(value.examSection, `${label}[${index}].examSection`, 20);
  if (examSection && !["objective", "essay"].includes(examSection)) {
    fail("invalid-argument", `${label}[${index}].examSection is invalid.`, "GRADE_PAYLOAD_INVALID");
  }
  const questionNumber =
    value.questionNumber === undefined || value.questionNumber === null
      ? 0
      : nonNegativeInteger(value.questionNumber, `${label}[${index}].questionNumber`, 500);
  const ratio = value.ratio === undefined || value.ratio === null ? 0 : legacyScoreNumber(value.ratio, `${label}[${index}].ratio`, 1000);
  return {
    name: normalizedText(value.name, `${label}[${index}].name`, 180, true),
    shortName: normalizedText(value.shortName, `${label}[${index}].shortName`, 180),
    itemKey: normalizedText(value.itemKey, `${label}[${index}].itemKey`, 180),
    groupKey: normalizedText(value.groupKey, `${label}[${index}].groupKey`, 120),
    groupLabel: normalizedText(value.groupLabel, `${label}[${index}].groupLabel`, 180),
    examSection,
    questionNumber,
    correctAnswer: normalizedText(value.correctAnswer, `${label}[${index}].correctAnswer`, 500),
    studentAnswer: normalizedText(value.studentAnswer, `${label}[${index}].studentAnswer`, 500),
    answerCorrect: value.answerCorrect === true,
    answerStatus,
    answerChoices,
    feedback: normalizedText(value.feedback, `${label}[${index}].feedback`, 1_000),
    score: legacyScoreNumber(value.score ?? 0, `${label}[${index}].score`),
    maxScore: legacyScoreNumber(value.maxScore ?? 0, `${label}[${index}].maxScore`),
    ratio,
    scoreEntered: value.scoreEntered !== false,
  };
};

const normalizeLegacyGradeItems = (value, label = "items") => {
  if (!Array.isArray(value) || value.length > 200) {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_ITEMS_INVALID");
  }
  return value.map((item, index) => normalizeLegacyGradeItem(item, index, label));
};

const normalizeLegacyRosterRow = (value, index) => {
  assertAllowedKeys(
    value,
    [
      "rowNumber",
      "uid",
      "grade",
      "class",
      "number",
      "studentName",
      "items",
      "enteredScoreCount",
      "totalScore",
      "totalMaxScore",
      "feedback",
      "evidence",
      "matchStatus",
      "matchMessage",
      "academicStatus",
      "isManual",
      "isTransferred",
      "transferStatus",
    ],
    `roster.rows[${index}]`,
  );
  const matchStatus = normalizedText(value.matchStatus, `roster.rows[${index}].matchStatus`, 30, true);
  if (!["matched", "name-mismatch", "unmatched"].includes(matchStatus)) {
    fail("invalid-argument", "Roster row matchStatus is invalid.", "GRADE_PAYLOAD_INVALID");
  }
  const transferStatus = normalizedText(value.transferStatus, `roster.rows[${index}].transferStatus`, 30);
  if (transferStatus && transferStatus !== "transferred") {
    fail("invalid-argument", "Roster row transferStatus is invalid.", "GRADE_PAYLOAD_INVALID");
  }
  return {
    rowNumber: positiveInteger(value.rowNumber, `roster.rows[${index}].rowNumber`, 10_000),
    uid: value.uid ? pathSegment(value.uid, `roster.rows[${index}].uid`, 160) : "",
    grade: normalizedText(value.grade, `roster.rows[${index}].grade`, 20),
    class: normalizedText(value.class, `roster.rows[${index}].class`, 40),
    number: normalizedText(value.number, `roster.rows[${index}].number`, 40),
    studentName: normalizedText(value.studentName, `roster.rows[${index}].studentName`, 120),
    items: normalizeLegacyGradeItems(value.items || [], `roster.rows[${index}].items`),
    enteredScoreCount: nonNegativeInteger(value.enteredScoreCount ?? 0, `roster.rows[${index}].enteredScoreCount`, 200),
    totalScore: legacyScoreNumber(value.totalScore ?? 0, `roster.rows[${index}].totalScore`),
    totalMaxScore: legacyScoreNumber(value.totalMaxScore ?? 0, `roster.rows[${index}].totalMaxScore`),
    feedback: normalizedText(value.feedback, `roster.rows[${index}].feedback`, 1_000),
    evidence: normalizedText(value.evidence, `roster.rows[${index}].evidence`, 1_000),
    matchStatus,
    matchMessage: normalizedText(value.matchMessage, `roster.rows[${index}].matchMessage`, 500),
    academicStatus: normalizedText(value.academicStatus, `roster.rows[${index}].academicStatus`, 60),
    isManual: value.isManual === true,
    isTransferred: value.isTransferred === true,
    transferStatus,
  };
};

const normalizeLegacyScoreRecord = (value, index) => {
  assertAllowedKeys(
    value,
    [
      "uid",
      "grade",
      "class",
      "number",
      "studentName",
      "items",
      "enteredScoreCount",
      "totalScore",
      "totalMaxScore",
      "feedback",
      "evidence",
      "academicStatus",
      "isTransferred",
      "transferStatus",
    ],
    `records[${index}]`,
  );
  return {
    uid: pathSegment(value.uid, `records[${index}].uid`, 160),
    grade: normalizedText(value.grade, `records[${index}].grade`, 20),
    class: normalizedText(value.class, `records[${index}].class`, 40),
    number: normalizedText(value.number, `records[${index}].number`, 40),
    studentName: normalizedText(value.studentName, `records[${index}].studentName`, 120),
    items: normalizeLegacyGradeItems(value.items || [], `records[${index}].items`),
    enteredScoreCount: nonNegativeInteger(value.enteredScoreCount ?? 0, `records[${index}].enteredScoreCount`, 200),
    totalScore: legacyScoreNumber(value.totalScore ?? 0, `records[${index}].totalScore`),
    totalMaxScore: legacyScoreNumber(value.totalMaxScore ?? 0, `records[${index}].totalMaxScore`),
    feedback: normalizedText(value.feedback, `records[${index}].feedback`, 1_000),
    evidence: normalizedText(value.evidence, `records[${index}].evidence`, 1_000),
    academicStatus: normalizedText(value.academicStatus, `records[${index}].academicStatus`, 60),
    isTransferred: value.isTransferred === true,
    transferStatus: normalizedText(value.transferStatus, `records[${index}].transferStatus`, 30),
  };
};

const normalizeLegacyRoster = (value) => {
  assertAllowedKeys(
    value,
    [
      "scoreKind",
      "scoreContentKind",
      "title",
      "subject",
      "assessmentOrder",
      "targetGrade",
      "targetClass",
      "classes",
      "items",
      "totalMaxScore",
      "rowCount",
      "matchedCount",
      "unmatchedCount",
      "sourceFileName",
      "rows",
      "uploadedByEmail",
    ],
    "roster",
  );
  if (!Array.isArray(value.rows) || value.rows.length > LEGACY_GRADE_MAX_ROSTER_ROWS) {
    fail("invalid-argument", "Roster rows exceed the bounded command limit.", "GRADE_ROSTER_LIMIT_EXCEEDED");
  }
  if (!Array.isArray(value.classes) || value.classes.length > 40) {
    fail("invalid-argument", "Roster classes are invalid.", "GRADE_PAYLOAD_INVALID");
  }
  const scoreContentKind = normalizedText(value.scoreContentKind, "roster.scoreContentKind", 30);
  if (scoreContentKind && !["performance", "objective", "essay", "mixed"].includes(scoreContentKind)) {
    fail("invalid-argument", "Roster scoreContentKind is invalid.", "GRADE_PAYLOAD_INVALID");
  }
  const rows = value.rows.map(normalizeLegacyRosterRow);
  const rowNumbers = rows.map((row) => row.rowNumber);
  if (new Set(rowNumbers).size !== rowNumbers.length) {
    fail("invalid-argument", "Roster contains duplicate row numbers.", "GRADE_PAYLOAD_INVALID");
  }
  return {
    scoreKind: normalizeScoreKind(value.scoreKind),
    scoreContentKind,
    title: normalizedText(value.title, "roster.title", 200, true),
    subject: normalizedText(value.subject, "roster.subject", 120, true),
    assessmentOrder:
      value.assessmentOrder === undefined || value.assessmentOrder === null ? 0 : nonNegativeInteger(value.assessmentOrder, "roster.assessmentOrder", 100),
    targetGrade: normalizedText(value.targetGrade, "roster.targetGrade", 20),
    targetClass: normalizedText(value.targetClass, "roster.targetClass", 40),
    classes: value.classes.map((entry, index) => normalizedText(entry, `roster.classes[${index}]`, 40, true)),
    items: normalizeLegacyGradeItems(value.items || [], "roster.items"),
    totalMaxScore: legacyScoreNumber(value.totalMaxScore ?? 0, "roster.totalMaxScore"),
    rowCount: nonNegativeInteger(value.rowCount ?? rows.length, "roster.rowCount", LEGACY_GRADE_MAX_ROSTER_ROWS),
    matchedCount: nonNegativeInteger(value.matchedCount ?? 0, "roster.matchedCount", LEGACY_GRADE_MAX_ROSTER_ROWS),
    unmatchedCount: nonNegativeInteger(value.unmatchedCount ?? 0, "roster.unmatchedCount", LEGACY_GRADE_MAX_ROSTER_ROWS),
    sourceFileName: normalizedText(value.sourceFileName, "roster.sourceFileName", 240),
    rows,
    uploadedByEmail: normalizedText(value.uploadedByEmail, "roster.uploadedByEmail", 240),
  };
};

const normalizeLegacyRecordRefs = (value, label, maximum = 20) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    fail("invalid-argument", `${label} is invalid.`, "GRADE_PAYLOAD_INVALID");
  }
  const entries = value.map((entry, index) => {
    assertAllowedKeys(entry, ["recordId", "scoreId", "expectedRevision", "expectedGradeRevision", "targetDetails"], `${label}[${index}]`);
    return {
      recordId: normalizeRecordId(entry.recordId),
      scoreId: pathSegment(entry.scoreId, `${label}[${index}].scoreId`, 180),
      expectedRevision: positiveInteger(entry.expectedRevision, `${label}[${index}].expectedRevision`),
      expectedGradeRevision: positiveInteger(entry.expectedGradeRevision, `${label}[${index}].expectedGradeRevision`),
      targetDetails: normalizedText(entry.targetDetails, `${label}[${index}].targetDetails`, 1_000),
    };
  });
  if (new Set(entries.map((entry) => entry.recordId)).size !== entries.length) {
    fail("invalid-argument", `${label} contains duplicate records.`, "GRADE_PAYLOAD_INVALID");
  }
  return entries;
};

const normalizeLegacyConfigData = (configKind, rawValue) => {
  const value = rawValue || {};
  if (configKind === "WARNING") {
    assertAllowedKeys(value, ["warningText", "warningVersion", "warningTextHash"], "config.data");
    return {
      warningText: normalizedText(value.warningText, "config.data.warningText", 600, true),
      warningVersion: normalizedText(value.warningVersion, "config.data.warningVersion", 80, true),
      warningTextHash: normalizedText(value.warningTextHash, "config.data.warningTextHash", 64, true),
    };
  }
  if (configKind === "GRADING_PLAN") {
    assertAllowedKeys(value, ["subject", "targetGrade", "items"], "config.data");
    if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 30) {
      fail("invalid-argument", "Grading plan items are invalid.", "GRADE_PAYLOAD_INVALID");
    }
    return {
      subject: normalizedText(value.subject, "config.data.subject", 120, true),
      targetGrade: normalizedText(value.targetGrade, "config.data.targetGrade", 20, true),
      items: value.items.map((item, index) => {
        assertAllowedKeys(item, ["type", "name", "maxScore", "ratio"], `config.data.items[${index}]`);
        const typeValue = normalizedText(item.type, `config.data.items[${index}].type`, 20, true);
        if (!["정기", "정기시험", "수행", "수행평가"].includes(typeValue)) {
          fail("invalid-argument", "Grading plan item type is invalid.", "GRADE_PAYLOAD_INVALID");
        }
        return {
          type: typeValue,
          name: normalizedText(item.name, `config.data.items[${index}].name`, 160, true),
          maxScore: legacyScoreNumber(item.maxScore, `config.data.items[${index}].maxScore`, 10_000),
          ratio: legacyScoreNumber(item.ratio, `config.data.items[${index}].ratio`, 100),
        };
      }),
    };
  }
  if (configKind === "OMR") {
    assertAllowedKeys(
      value,
      ["objective", "subjective", "releaseStatus", "releasePolicyVersion"],
      "config.data",
    );
    if (!Array.isArray(value.objective) || value.objective.length > 100) {
      fail("invalid-argument", "OMR objective items are invalid.", "GRADE_PAYLOAD_INVALID");
    }
    if (!Array.isArray(value.subjective) || value.subjective.length > 40) {
      fail("invalid-argument", "OMR subjective items are invalid.", "GRADE_PAYLOAD_INVALID");
    }
    const releaseStatus =
      value.releaseStatus === undefined
        ? "HIDDEN"
        : normalizedText(
            value.releaseStatus,
            "config.data.releaseStatus",
            20,
            true,
          );
    const releasePolicyVersion =
      value.releasePolicyVersion === undefined
        ? LEGACY_OMR_RELEASE_POLICY_VERSION
        : normalizedText(
            value.releasePolicyVersion,
            "config.data.releasePolicyVersion",
            80,
            true,
          );
    if (
      !LEGACY_OMR_RELEASE_STATUSES.includes(releaseStatus) ||
      releasePolicyVersion !== LEGACY_OMR_RELEASE_POLICY_VERSION
    ) {
      fail(
        "invalid-argument",
        "OMR student answer release policy is invalid.",
        "GRADE_ANSWER_RELEASE_POLICY_INVALID",
      );
    }
    const objective = value.objective.map((item, index) => {
        assertAllowedKeys(item, ["score", "answer"], `config.data.objective[${index}]`);
        return {
          score: legacyScoreNumber(item.score, `config.data.objective[${index}].score`, 1_000),
          answer: nonNegativeInteger(item.answer, `config.data.objective[${index}].answer`, 5),
        };
      });
    const subjective = value.subjective.map((parent, parentIndex) => {
        assertAllowedKeys(parent, ["subItems"], `config.data.subjective[${parentIndex}]`);
        if (!Array.isArray(parent.subItems) || parent.subItems.length > 20) {
          fail("invalid-argument", "OMR subjective sub-items are invalid.", "GRADE_PAYLOAD_INVALID");
        }
        return {
          subItems: parent.subItems.map((item, itemIndex) => {
            assertAllowedKeys(item, ["score", "answer"], `config.data.subjective[${parentIndex}].subItems[${itemIndex}]`);
            return {
              score: legacyScoreNumber(item.score, `config.data.subjective[${parentIndex}].subItems[${itemIndex}].score`, 1_000),
              answer: normalizedText(item.answer, `config.data.subjective[${parentIndex}].subItems[${itemIndex}].answer`, 500),
            };
          }),
        };
      });
    if (
      releaseStatus === "RELEASED" &&
      (objective.length +
        subjective.reduce((count, parent) => count + parent.subItems.length, 0) ===
        0 ||
        objective.some((item) => item.answer < 1 || item.answer > 5))
    ) {
      fail(
        "failed-precondition",
        "Released OMR answers must contain completed answer keys.",
        "GRADE_ANSWER_RELEASE_INCOMPLETE",
      );
    }
    return {
      objective,
      subjective,
      releaseStatus,
      releasePolicyVersion,
    };
  }
  fail("invalid-argument", "Legacy grade config kind is invalid.", "GRADE_PAYLOAD_INVALID");
};

const normalizeBaseMutation = (payload, allowedKeys, label) => {
  assertAllowedKeys(payload, allowedKeys, label);
  return {
    semesterId: normalizeSemesterId(payload.semesterId),
    expectedSemesterRevision: positiveInteger(payload.expectedSemesterRevision, "expectedSemesterRevision"),
  };
};

const normalizeGradePayload = (commandType, rawPayload) => {
  const payload = rawPayload || {};
  if (commandType === GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT) {
    const allowed = [
      "semesterId",
      "expectedSemesterRevision",
      "sourceKind",
      "attemptId",
      "manualSourceId",
      "studentUid",
      "enrollmentId",
      "classId",
      "sourceHash",
      "scoreKind",
      "title",
      "rubricVersion",
      "items",
      "reason",
    ];
    const base = normalizeBaseMutation(payload, allowed, "createGradeDraft payload");
    if (!["ASSESSMENT_RESULT", "MANUAL_IMPORT"].includes(payload.sourceKind)) {
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
        payload.manualSourceId !== undefined ||
        payload.studentUid !== undefined ||
        payload.enrollmentId !== undefined ||
        payload.classId !== undefined ||
        payload.sourceHash !== undefined ||
        payload.items !== undefined
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
    const base = normalizeBaseMutation(
      payload,
      ["semesterId", "expectedSemesterRevision", "recordId", "expectedRevision", "expectedGradeRevision", "items", "reason"],
      "reviewGradeDraft payload",
    );
    return {
      ...base,
      recordId: normalizeRecordId(payload.recordId),
      expectedRevision: positiveInteger(payload.expectedRevision, "expectedRevision"),
      expectedGradeRevision: positiveInteger(payload.expectedGradeRevision, "expectedGradeRevision"),
      items: normalizeItems(payload.items),
      reason: text(payload.reason, "reason", 500),
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.FINALIZE_GRADE_EVIDENCE || commandType === GRADE_COMMAND_TYPES.PUBLISH_OFFICIAL_GRADE) {
    const allowed = ["semesterId", "expectedSemesterRevision", "recordId", "expectedRevision", "expectedGradeRevision", "expectedVersionId", "reason"];
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
    const base = normalizeBaseMutation(
      payload,
      ["semesterId", "expectedSemesterRevision", "recordId", "expectedRevision", "expectedGradeRevision", "items", "reason", "requestId", "resolution"],
      "correctOfficialGrade payload",
    );
    if (!["CORRECT", "REJECT"].includes(payload.resolution)) {
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
      items:
        payload.resolution === "CORRECT"
          ? normalizeItems(payload.items)
          : payload.items === undefined
            ? []
            : fail("invalid-argument", "Rejected request cannot contain score changes.", "GRADE_REQUEST_RESOLUTION_INVALID"),
      reason: text(payload.reason, "reason", 500),
      requestId: payload.requestId ? normalizeRequestId(payload.requestId) : "",
      resolution: payload.resolution,
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.REQUEST_GRADE_REVIEW) {
    const base = normalizeBaseMutation(
      payload,
      ["semesterId", "expectedSemesterRevision", "recordId", "expectedRevision", "expectedGradeRevision", "requestKind", "reason"],
      "requestGradeReview payload",
    );
    if (!["OBJECTION", "ANSWER_SHEET"].includes(payload.requestKind)) {
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
    const base = normalizeBaseMutation(
      payload,
      ["semesterId", "expectedSemesterRevision", "recordId", "expectedRevision", "expectedGradeRevision", "statementVersion"],
      "acknowledgeGradeEvidence payload",
    );
    return {
      ...base,
      recordId: normalizeRecordId(payload.recordId),
      expectedRevision: positiveInteger(payload.expectedRevision, "expectedRevision"),
      expectedGradeRevision: positiveInteger(payload.expectedGradeRevision, "expectedGradeRevision"),
      statementVersion: normalizeStatementVersion(payload.statementVersion),
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.SIGN_OFFICIAL_GRADE) {
    const base = normalizeBaseMutation(
      payload,
      ["semesterId", "expectedSemesterRevision", "recordId", "expectedRevision", "expectedGradeRevision", "signatureName", "statementVersion"],
      "signOfficialGrade payload",
    );
    return {
      ...base,
      recordId: normalizeRecordId(payload.recordId),
      expectedRevision: positiveInteger(payload.expectedRevision, "expectedRevision"),
      expectedGradeRevision: positiveInteger(payload.expectedGradeRevision, "expectedGradeRevision"),
      signatureName: text(payload.signatureName, "signatureName", 40),
      statementVersion: normalizeStatementVersion(payload.statementVersion),
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.UPSERT_LEGACY_GRADE_ROSTER) {
    const base = normalizeBaseMutation(
      payload,
      ["semesterId", "expectedSemesterRevision", "rosterId", "expectedRosterRevision", "mode", "roster", "records", "relatedRosters", "reason"],
      "upsertLegacyGradeRoster payload",
    );
    if (!["CREATE", "UPDATE"].includes(payload.mode)) {
      fail("invalid-argument", "Roster mutation mode is invalid.", "GRADE_PAYLOAD_INVALID");
    }
    if (!Array.isArray(payload.records) || payload.records.length > LEGACY_GRADE_MAX_RECORDS) {
      fail("invalid-argument", "Score records exceed the bounded command limit.", "GRADE_ROSTER_LIMIT_EXCEEDED");
    }
    const records = payload.records.map(normalizeLegacyScoreRecord);
    if (new Set(records.map((record) => record.uid)).size !== records.length) {
      fail("invalid-argument", "Score records contain duplicate students.", "GRADE_PAYLOAD_INVALID");
    }
    if (payload.relatedRosters !== undefined && (!Array.isArray(payload.relatedRosters) || payload.relatedRosters.length > LEGACY_GRADE_MAX_RELATED_ROSTERS)) {
      fail("invalid-argument", "Related grade rosters exceed the bounded command limit.", "GRADE_ROSTER_LIMIT_EXCEEDED");
    }
    const relatedRosters = (payload.relatedRosters || []).map((entry, index) => {
      assertAllowedKeys(entry, ["rosterId", "expectedRosterRevision", "roster"], `relatedRosters[${index}]`);
      return {
        rosterId: pathSegment(entry.rosterId, `relatedRosters[${index}].rosterId`, 180),
        expectedRosterRevision: nonNegativeInteger(entry.expectedRosterRevision, `relatedRosters[${index}].expectedRosterRevision`),
        roster: normalizeLegacyRoster(entry.roster),
      };
    });
    if (
      relatedRosters.some((entry) => entry.rosterId === payload.rosterId) ||
      new Set(relatedRosters.map((entry) => entry.rosterId)).size !== relatedRosters.length
    ) {
      fail("invalid-argument", "Related grade roster IDs are invalid.", "GRADE_PAYLOAD_INVALID");
    }
    return {
      ...base,
      rosterId: pathSegment(payload.rosterId, "rosterId", 180),
      expectedRosterRevision: nonNegativeInteger(payload.expectedRosterRevision, "expectedRosterRevision"),
      mode: payload.mode,
      roster: normalizeLegacyRoster(payload.roster),
      records,
      relatedRosters,
      reason: normalizedText(payload.reason, "reason", 500, true),
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.DELETE_LEGACY_GRADE_ROSTER) {
    const base = normalizeBaseMutation(
      payload,
      ["semesterId", "expectedSemesterRevision", "rosterId", "expectedRosterRevision", "reason"],
      "deleteLegacyGradeRoster payload",
    );
    return {
      ...base,
      rosterId: pathSegment(payload.rosterId, "rosterId", 180),
      expectedRosterRevision: nonNegativeInteger(payload.expectedRosterRevision, "expectedRosterRevision"),
      reason: normalizedText(payload.reason, "reason", 500, true),
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.SAVE_LEGACY_GRADE_CONFIG) {
    const base = normalizeBaseMutation(
      payload,
      ["semesterId", "expectedSemesterRevision", "configKind", "configId", "expectedRevision", "operation", "data", "reason"],
      "saveLegacyGradeConfig payload",
    );
    if (!["WARNING", "GRADING_PLAN", "OMR"].includes(payload.configKind)) {
      fail("invalid-argument", "Legacy grade config kind is invalid.", "GRADE_PAYLOAD_INVALID");
    }
    if (!["UPSERT", "DELETE"].includes(payload.operation)) {
      fail("invalid-argument", "Legacy grade config operation is invalid.", "GRADE_PAYLOAD_INVALID");
    }
    if (payload.operation === "DELETE" && payload.configKind !== "GRADING_PLAN") {
      fail("invalid-argument", "This grade config cannot be deleted.", "GRADE_PAYLOAD_INVALID");
    }
    return {
      ...base,
      configKind: payload.configKind,
      configId: pathSegment(payload.configId, "configId", 180),
      expectedRevision: nonNegativeInteger(payload.expectedRevision, "expectedRevision"),
      operation: payload.operation,
      data: payload.operation === "UPSERT" ? normalizeLegacyConfigData(payload.configKind, payload.data) : {},
      reason: normalizedText(payload.reason, "reason", 500, true),
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.ACKNOWLEDGE_LEGACY_GRADE_WARNING) {
    const base = normalizeBaseMutation(
      payload,
      ["semesterId", "expectedSemesterRevision", "warningVersion", "warningTextHash"],
      "acknowledgeLegacyGradeWarning payload",
    );
    return {
      ...base,
      warningVersion: normalizedText(payload.warningVersion, "warningVersion", 80, true),
      warningTextHash: normalizedText(payload.warningTextHash, "warningTextHash", 64, true),
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.SUBMIT_LEGACY_GRADE_REQUEST) {
    const base = normalizeBaseMutation(
      payload,
      ["semesterId", "expectedSemesterRevision", "requestKind", "records", "reason"],
      "submitLegacyGradeRequest payload",
    );
    if (!["OBJECTION", "ANSWER_SHEET"].includes(payload.requestKind)) {
      fail("invalid-argument", "Legacy grade request kind is invalid.", "GRADE_REQUEST_KIND_INVALID");
    }
    return {
      ...base,
      requestKind: payload.requestKind,
      records: normalizeLegacyRecordRefs(payload.records, "records", 20),
      reason: normalizedText(payload.reason, "reason", 1_000, true),
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.REVIEW_LEGACY_GRADE_REQUEST) {
    const base = normalizeBaseMutation(
      payload,
      ["semesterId", "expectedSemesterRevision", "requestId", "expectedRequestRevision", "resolution", "changedTotalScore", "reviewMemo"],
      "reviewLegacyGradeRequest payload",
    );
    if (!["ACCEPTED", "REJECTED", "REVIEWED"].includes(payload.resolution)) {
      fail("invalid-argument", "Legacy grade request resolution is invalid.", "GRADE_REQUEST_RESOLUTION_INVALID");
    }
    return {
      ...base,
      requestId: normalizeRequestId(payload.requestId),
      expectedRequestRevision: positiveInteger(payload.expectedRequestRevision, "expectedRequestRevision"),
      resolution: payload.resolution,
      changedTotalScore:
        payload.changedTotalScore === undefined || payload.changedTotalScore === null
          ? null
          : legacyScoreNumber(payload.changedTotalScore, "changedTotalScore"),
      reviewMemo: normalizedText(payload.reviewMemo, "reviewMemo", 240),
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.SIGN_LEGACY_GRADE_RECORDS) {
    const base = normalizeBaseMutation(
      payload,
      ["semesterId", "expectedSemesterRevision", "records", "signatureName", "signatureImage", "statementVersion"],
      "signLegacyGradeRecords payload",
    );
    const signatureImage = normalizedText(payload.signatureImage, "signatureImage", LEGACY_SIGNATURE_IMAGE_MAX_LENGTH, true);
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signatureImage)) {
      fail("invalid-argument", "Signature image is invalid.", "GRADE_SIGNATURE_IMAGE_INVALID");
    }
    return {
      ...base,
      records: normalizeLegacyRecordRefs(payload.records, "records", 20),
      signatureName: normalizedText(payload.signatureName, "signatureName", 40, true),
      signatureImage,
      statementVersion: normalizeStatementVersion(payload.statementVersion),
    };
  }

  if (commandType === GRADE_COMMAND_TYPES.REJECT_LEGACY_GRADE_SIGNATURES) {
    const base = normalizeBaseMutation(
      payload,
      ["semesterId", "expectedSemesterRevision", "studentUid", "records", "reason"],
      "rejectLegacyGradeSignatures payload",
    );
    return {
      ...base,
      studentUid: pathSegment(payload.studentUid, "studentUid", 160),
      records: normalizeLegacyRecordRefs(payload.records, "records", 20),
      reason: normalizedText(payload.reason, "reason", 500, true),
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
const manifestPath = (semesterId) => `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${semesterId}`;
const attemptPath = (attemptId) => `${assessmentLifecycle.ATTEMPT_COLLECTION}/${attemptId}`;
const submissionPath = (attemptId) => `${assessmentLifecycle.SUBMISSION_COLLECTION}/${attemptId}`;
const resultPath = (attemptId) => `${assessmentLifecycle.RESULT_COLLECTION}/${attemptId}`;
const enrollmentPath = (enrollmentId) => `${archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION}/${enrollmentId}`;
const classPath = (classId) => `${archiveEnrollment.SEMESTER_CLASS_COLLECTION}/${classId}`;
const slotPath = (semesterId, studentUid) =>
  `${archiveEnrollment.ENROLLMENT_SLOT_COLLECTION}/${archiveEnrollment.buildEnrollmentSlotId(semesterId, studentUid)}`;

const legacySemesterParts = (semesterId) => {
  const [year, semester] = semesterId.split("-");
  return { year, semester };
};

const legacySemesterRoot = (semesterId) => {
  const { year, semester } = legacySemesterParts(semesterId);
  return `years/${year}/semesters/${semester}`;
};

const legacyRosterPath = (semesterId, rosterId) => `${legacySemesterRoot(semesterId)}/performance_score_rosters/${rosterId}`;
const legacyScorePath = (studentUid, scoreId) => `users/${studentUid}/performance_scores/${scoreId}`;
const legacyConfirmationPath = (studentUid, scoreId) => `${legacyScorePath(studentUid, scoreId)}/confirmations/${studentUid}`;
const legacyWarningSettingsPath = (semesterId) => `${legacySemesterRoot(semesterId)}/assessment_config/performance_score`;
const legacyWarningConsentPath = (studentUid) => `users/${studentUid}/performance_score_consents/current`;
const legacyRequestProjectionPath = (semesterId, requestKind, requestId) => {
  const collection = requestKind === "ANSWER_SHEET" ? "performance_score_answer_sheet_requests" : "performance_score_objections";
  return `${legacySemesterRoot(semesterId)}/${collection}/${requestId}`;
};
const legacyConfigPath = (semesterId, configKind, configId) => {
  if (configKind === "WARNING") return legacyWarningSettingsPath(semesterId);
  if (configKind === "OMR") {
    if (configId !== "final_exam") {
      fail("invalid-argument", "OMR config ID is invalid.", "GRADE_PAYLOAD_INVALID");
    }
    return `${legacySemesterRoot(semesterId)}/exam_config/final_exam`;
  }
  return `${legacySemesterRoot(semesterId)}/grading_plans/${configId}`;
};

const normalizeStoredLegacyRoster = (value) =>
  normalizeLegacyRoster({
    scoreKind: value?.scoreKind || "performance",
    scoreContentKind: value?.scoreContentKind || "",
    title: value?.title || "",
    subject: value?.subject || "",
    assessmentOrder: value?.assessmentOrder ?? 0,
    targetGrade: value?.targetGrade || "",
    targetClass: value?.targetClass || "",
    classes: Array.isArray(value?.classes) ? value.classes : [],
    items: Array.isArray(value?.items) ? value.items : [],
    totalMaxScore: value?.totalMaxScore ?? 0,
    rowCount: value?.rowCount ?? (Array.isArray(value?.rows) ? value.rows.length : 0),
    matchedCount: value?.matchedCount ?? 0,
    unmatchedCount: value?.unmatchedCount ?? 0,
    sourceFileName: value?.sourceFileName || "",
    rows: Array.isArray(value?.rows) ? value.rows : [],
    uploadedByEmail: value?.uploadedByEmail || "",
  });

const assertRelatedLegacyRosterMutation = ({ current, next, primaryScoreKind, rosterId }) => {
  if (current.scoreKind !== "performance" || next.scoreKind !== "performance" || primaryScoreKind !== "performance") {
    fail("failed-precondition", "Cross-roster identity sync is limited to performance score rosters.", "GRADE_ROSTER_SYNC_SCOPE_INVALID", { rosterId });
  }
  const fixedFields = (roster) => ({
    scoreKind: roster.scoreKind,
    scoreContentKind: roster.scoreContentKind,
    title: roster.title,
    subject: roster.subject,
    assessmentOrder: roster.assessmentOrder,
    targetGrade: roster.targetGrade,
    items: roster.items,
    totalMaxScore: roster.totalMaxScore,
    sourceFileName: roster.sourceFileName,
  });
  const protectedRows = (roster) => roster.rows.filter((row) => row.uid || row.isManual !== true);
  if (
    canonicalJson(fixedFields(current)) !== canonicalJson(fixedFields(next)) ||
    canonicalJson(protectedRows(current)) !== canonicalJson(protectedRows(next))
  ) {
    fail("failed-precondition", "Related roster sync attempted to change protected score data.", "GRADE_ROSTER_SYNC_PROTECTED_DATA", { rosterId });
  }
};

const legacyWarningHash = (value) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const DEFAULT_LEGACY_WARNING_TEXT =
  "다른 학생의 점수를 확인하거나 대리로 서명할 경우 학업성적관리규정 위반 학생 및 생활교육 대상자가 될 수 있습니다. 본인 점수만 확인하고 본인 이름으로만 서명해 주세요.";
const DEFAULT_LEGACY_WARNING_VERSION = "default-20260609";

const loadActiveEnrollmentScopes = async (transaction, semesterId, studentUids) => {
  const uniqueStudentUids = [...new Set(studentUids)];
  if (uniqueStudentUids.length === 0) return new Map();
  const slots = await transaction.getAll(uniqueStudentUids.map((studentUid) => slotPath(semesterId, studentUid)));
  const enrollmentIds = slots.map((slot, index) => {
    const studentUid = uniqueStudentUids[index];
    const enrollmentId = String(slot.data?.activeEnrollmentId || "");
    if (!slot.exists || slot.data?.status !== "ACTIVE" || slot.data?.semesterId !== semesterId || slot.data?.studentUid !== studentUid || !enrollmentId) {
      fail("failed-precondition", "Student does not have an active Enrollment slot.", "GRADE_ENROLLMENT_MISMATCH", {
        studentUid,
      });
    }
    return enrollmentId;
  });
  const enrollments = await transaction.getAll(enrollmentIds.map(enrollmentPath));
  const classIds = enrollments.map((enrollment, index) => {
    const studentUid = uniqueStudentUids[index];
    const enrollmentId = enrollmentIds[index];
    const classId = String(enrollment.data?.classId || "");
    if (
      !enrollment.exists ||
      enrollment.data?.enrollmentId !== enrollmentId ||
      enrollment.data?.studentUid !== studentUid ||
      enrollment.data?.semesterId !== semesterId ||
      enrollment.data?.enrollmentStatus !== "ACTIVE" ||
      !classId
    ) {
      fail("failed-precondition", "Student Enrollment is not active in this semester.", "GRADE_ENROLLMENT_MISMATCH", {
        studentUid,
        enrollmentId,
      });
    }
    return classId;
  });
  const uniqueClassIds = [...new Set(classIds)];
  const classes = await transaction.getAll(uniqueClassIds.map(classPath));
  const classById = new Map(classes.map((snapshot, index) => [uniqueClassIds[index], snapshot]));
  return new Map(
    uniqueStudentUids.map((studentUid, index) => {
      const classId = classIds[index];
      const semesterClass = classById.get(classId);
      if (
        !semesterClass?.exists ||
        semesterClass.data?.classId !== classId ||
        semesterClass.data?.semesterId !== semesterId ||
        semesterClass.data?.status !== "ACTIVE"
      ) {
        fail("failed-precondition", "Student class is not active in this semester.", "GRADE_ENROLLMENT_MISMATCH", {
          studentUid,
          classId,
        });
      }
      const enrollment = enrollments[index];
      return [
        studentUid,
        {
          studentUid,
          enrollmentId: enrollmentIds[index],
          classId,
          enrollment: enrollment.data || {},
          semesterClass: semesterClass.data || {},
          enrollmentSnapshot: buildEnrollmentSnapshot(enrollment.data || {}, semesterClass.data || {}),
        },
      ];
    }),
  );
};

const legacyItemsToGradeItems = (record) => {
  const positiveItems = record.items.filter((item) => item.maxScore > 0);
  if (positiveItems.length === 0) {
    if (!(record.totalMaxScore > 0) || record.totalScore > record.totalMaxScore) {
      fail("invalid-argument", "Legacy score has no valid maximum score.", "GRADE_ITEMS_INVALID", {
        studentUid: record.uid,
      });
    }
    return [
      {
        itemId: "legacy-total",
        maxScore: record.totalMaxScore,
        awardedScore: record.totalScore,
        evaluationKind: "TEACHER",
        evidence: record.evidence || record.feedback || "LEGACY_GRADE_TOTAL",
        reason: "Legacy grade roster import",
      },
    ];
  }
  const mapped = positiveItems.map((item, index) => {
    if (item.score > item.maxScore) {
      fail("invalid-argument", "Legacy item score exceeds its maximum.", "GRADE_ITEMS_INVALID", {
        studentUid: record.uid,
        item: item.name,
      });
    }
    const evidence = canonicalJson({
      feedback: item.feedback,
      studentAnswer: item.studentAnswer,
      correctAnswer: item.correctAnswer,
      answerStatus: item.answerStatus,
      answerCorrect: item.answerCorrect,
      source: record.evidence || record.feedback,
    }).slice(0, 2_000);
    return {
      itemId: `legacy-${index + 1}-${sha256(item.itemKey || item.name).slice(0, 16)}`,
      maxScore: item.maxScore,
      awardedScore: item.score,
      evaluationKind: "TEACHER",
      evidence,
      reason: "Legacy grade roster import",
    };
  });
  const summary = summarizeItems(mapped);
  if (summary.totalScore !== record.totalScore || summary.totalMaxScore !== record.totalMaxScore) {
    if (!(record.totalMaxScore > 0) || record.totalScore > record.totalMaxScore) {
      fail("invalid-argument", "Legacy score totals are inconsistent.", "GRADE_ITEMS_INVALID", {
        studentUid: record.uid,
      });
    }
    return [
      {
        itemId: "legacy-total",
        maxScore: record.totalMaxScore,
        awardedScore: record.totalScore,
        evaluationKind: "TEACHER",
        evidence: canonicalJson({
          sourceItems: mapped,
          note: record.evidence || record.feedback,
        }).slice(0, 2_000),
        reason: "Legacy grade total normalized by the W6B gateway",
      },
    ];
  }
  return mapped;
};

const buildLegacyBaseRecord = ({ payload, rosterPath, record, scope }) => {
  const recordId = buildRecordId({
    sourceKind: "MANUAL_IMPORT",
    semesterId: payload.semesterId,
    manualSourceId: payload.rosterId,
    enrollmentId: scope.enrollmentId,
  });
  const sourceHash = sha256(
    canonicalJson({
      rosterId: payload.rosterId,
      scoreKind: payload.roster.scoreKind,
      title: payload.roster.title,
      studentUid: record.uid,
      enrollmentId: scope.enrollmentId,
      items: record.items,
      totalScore: record.totalScore,
      totalMaxScore: record.totalMaxScore,
      feedback: record.feedback,
      evidence: record.evidence,
    }),
  );
  return {
    recordId,
    logicalKey: `MANUAL_IMPORT:${payload.semesterId}:${payload.rosterId}:${scope.enrollmentId}`,
    semesterId: payload.semesterId,
    studentUid: record.uid,
    enrollmentId: scope.enrollmentId,
    classId: scope.classId,
    sourceKind: "MANUAL_IMPORT",
    sourceId: payload.rosterId,
    sourceRefs: [rosterPath, enrollmentPath(scope.enrollmentId), classPath(scope.classId), legacyScorePath(record.uid, payload.rosterId)],
    sourceSnapshotHash: sourceHash,
    scoreKind: payload.roster.scoreKind,
    enrollmentSnapshot: scope.enrollmentSnapshot,
    definitionId: "",
    definitionRevision: 0,
    sourceHash,
    title: payload.roster.title,
    rubricVersion: "w6b-rubric-v1",
  };
};

const buildLegacyScoreProjection = ({ payload, record, scope, gradeRecord, version, revision, timestamp, actor }) => {
  const { year, semester } = legacySemesterParts(payload.semesterId);
  return {
    schemaVersion: LEGACY_GRADE_SCHEMA_VERSION,
    policyVersion: LEGACY_GRADE_POLICY_VERSION,
    scoreKind: payload.roster.scoreKind,
    ...(payload.roster.scoreContentKind ? { scoreContentKind: payload.roster.scoreContentKind } : {}),
    rosterId: payload.rosterId,
    title: payload.roster.title,
    subject: payload.roster.subject,
    ...(payload.roster.assessmentOrder ? { assessmentOrder: payload.roster.assessmentOrder } : {}),
    academicYear: year,
    semester,
    grade: scope.enrollmentSnapshot.grade,
    class: scope.enrollmentSnapshot.classNumber,
    number: scope.enrollmentSnapshot.studentNumber,
    studentName: scope.enrollmentSnapshot.displayName,
    uid: record.uid,
    items: record.items,
    enteredScoreCount: record.enteredScoreCount,
    totalScore: record.totalScore,
    totalMaxScore: record.totalMaxScore,
    feedback: record.feedback,
    evidence: record.evidence || record.feedback,
    sourceFileName: payload.roster.sourceFileName,
    uploadedBy: actor.actorUid,
    uploadedByEmail: payload.roster.uploadedByEmail || actor.actorEmail || "",
    uploadedAt: timestamp,
    updatedAt: timestamp,
    ...(record.academicStatus ? { academicStatus: record.academicStatus } : {}),
    ...(record.isTransferred ? { isTransferred: true } : {}),
    ...(record.transferStatus ? { transferStatus: record.transferStatus } : {}),
    gradeRecordId: gradeRecord.recordId,
    gradeVersionId: version.versionId,
    gradeRecordRevision: gradeRecord.revision,
    gradeRevision: gradeRecord.gradeRevision,
    projectionRevision: revision,
    commandId: gradeRecord.commandId,
    receiptId: gradeRecord.receiptId,
  };
};

const assertLegacyScoreProjectionOwnership = ({
  snapshot,
  semesterId,
  studentUid,
  rosterId,
  scoreKind,
}) => {
  if (!snapshot?.exists) return;
  const data = snapshot.data || {};
  const { year, semester } = legacySemesterParts(semesterId);
  const gradeRecordId = String(data.gradeRecordId || "");
  if (
    data.uid !== studentUid ||
    data.rosterId !== rosterId ||
    String(data.academicYear || "") !== year ||
    String(data.semester || "") !== semester ||
    String(data.scoreKind || "performance") !== scoreKind ||
    (gradeRecordId && !/^grade_[a-f0-9]{64}$/.test(gradeRecordId))
  ) {
    fail(
      "failed-precondition",
      "Stored grade projection does not belong to this roster scope.",
      "GRADE_PROJECTION_SCOPE_MISMATCH",
      { studentUid, rosterId },
    );
  }
};

const assertAtomicWriteBudget = (writeCount, operation) => {
  if (writeCount > LEGACY_GRADE_MAX_ATOMIC_WRITES) {
    fail(
      "failed-precondition",
      "This roster change is too large for one atomic grade command.",
      "GRADE_ROSTER_ATOMIC_LIMIT_EXCEEDED",
      {
        operation,
        writeCount,
        maximum: LEGACY_GRADE_MAX_ATOMIC_WRITES,
      },
    );
  }
};

const assertLegacyWarningConsent = async (transaction, semesterId, studentUid) => {
  const [settingsSnapshot, consentSnapshot] = await transaction.getAll([legacyWarningSettingsPath(semesterId), legacyWarningConsentPath(studentUid)]);
  const warningText = settingsSnapshot.exists ? String(settingsSnapshot.data?.warningText || "").trim() : DEFAULT_LEGACY_WARNING_TEXT;
  const warningVersion = settingsSnapshot.exists ? String(settingsSnapshot.data?.warningVersion || "") : DEFAULT_LEGACY_WARNING_VERSION;
  const warningTextHash = settingsSnapshot.exists ? String(settingsSnapshot.data?.warningTextHash || "") : legacyWarningHash(DEFAULT_LEGACY_WARNING_TEXT);
  const { year, semester } = legacySemesterParts(semesterId);
  if (
    !warningText ||
    !warningVersion ||
    !warningTextHash ||
    !consentSnapshot.exists ||
    consentSnapshot.data?.uid !== studentUid ||
    consentSnapshot.data?.academicYear !== year ||
    consentSnapshot.data?.semester !== semester ||
    consentSnapshot.data?.acknowledged !== true ||
    consentSnapshot.data?.warningVersion !== warningVersion ||
    consentSnapshot.data?.warningTextHash !== warningTextHash
  ) {
    fail("failed-precondition", "The current grade warning must be acknowledged first.", "GRADE_WARNING_ACKNOWLEDGEMENT_REQUIRED");
  }
  return { warningText, warningVersion, warningTextHash };
};

const buildEnrollmentSnapshot = (enrollmentData, classData) => ({
  enrollmentId: String(enrollmentData?.enrollmentId || ""),
  classId: String(enrollmentData?.classId || ""),
  displayName: String(enrollmentData?.snapshot?.displayName || "").trim(),
  studentNumber: String(enrollmentData?.snapshot?.studentNumber ?? enrollmentData?.studentNumber ?? "").trim(),
  grade: String(enrollmentData?.snapshot?.grade ?? classData?.grade ?? "").trim(),
  classNumber: String(enrollmentData?.snapshot?.classNumber ?? classData?.classNumber ?? "").trim(),
  classDisplayName: String(enrollmentData?.snapshot?.classDisplayName ?? classData?.displayName ?? "").trim(),
});

const buildRecordId = ({ sourceKind, attemptId = "", semesterId = "", manualSourceId = "", enrollmentId = "" }) => {
  const logicalKey =
    sourceKind === "ASSESSMENT_RESULT" ? `ASSESSMENT_RESULT\n${attemptId}` : `MANUAL_IMPORT\n${semesterId}\n${manualSourceId}\n${enrollmentId}`;
  return `grade_${sha256(logicalKey)}`;
};

const buildVersionId = (recordId, gradeRevision, evidenceHash) => `gradever_${sha256(`${recordId}\n${gradeRevision}\n${evidenceHash}`)}`;

const buildRequestId = (recordId, gradeRevision, studentUid, requestKind) =>
  `gradereq_${sha256(`${recordId}\n${gradeRevision}\n${studentUid}\n${requestKind}`)}`;

const buildAttestationId = (type, recordId, gradeRevision, studentUid) => `gradeatt_${sha256(`${type}\n${recordId}\n${gradeRevision}\n${studentUid}`)}`;

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
}) =>
  sha256(
    canonicalJson({
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
    }),
  );

const buildVersion = ({ record, gradeRevision, items, state, reason, actor, commandId, receiptId, timestamp, supersedesVersionId = "" }) => {
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
  if (!actor?.actorUid || !["teacher", "admin"].includes(actor.actorRole)) {
    fail("permission-denied", "Grade management permission is required.", "GRADE_MANAGE_REQUIRED");
  }
};

const assertStudentActor = (actor) => {
  if (!actor?.actorUid || actor.actorRole !== "student") {
    fail("permission-denied", "A student account is required.", "GRADE_STUDENT_REQUIRED");
  }
};

const assertWritableSemester = async (transaction, semesterId, expectedSemesterRevision) => {
  const [pointer, snapshot] = await transaction.getAll([
    semesterCore.ACTIVE_SEMESTER_POINTER_PATH,
    manifestPath(semesterId),
  ]);
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
  if (
    !pointer.exists ||
    pointer.data?.semesterId !== semesterId ||
    Number(pointer.data?.revision || 0) !== Number(manifest.revision || 0)
  ) {
    fail(
      "failed-precondition",
      "Grade writes require the canonical active semester.",
      "GRADE_SEMESTER_NOT_ACTIVE",
      { semesterId },
    );
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
    attempt?.exists &&
    submission?.exists &&
    result?.exists &&
    enrollment?.exists &&
    semesterClass?.exists &&
    attemptData.status === "SUBMITTED" &&
    !attemptData.resetAt &&
    attemptId &&
    submissionData.attemptId === attemptId &&
    submissionData.submissionId === attemptId &&
    resultData.attemptId === attemptId &&
    resultData.resultId === attemptId &&
    attemptData.semesterId === expectedSemesterId &&
    submissionData.semesterId === expectedSemesterId &&
    resultData.semesterId === expectedSemesterId &&
    submissionData.definitionId === attemptData.definitionId &&
    resultData.definitionId === attemptData.definitionId &&
    submissionData.studentUid === attemptData.studentUid &&
    resultData.studentUid === attemptData.studentUid &&
    sourceHash &&
    submissionData.sourceHash === sourceHash &&
    resultData.sourceHash === sourceHash &&
    Number(submissionData.attemptRevision || 0) === Number(attemptData.revision || 0) &&
    submissionData.submittedAtIso === attemptData.submittedAtIso &&
    resultData.submittedAtIso === attemptData.submittedAtIso &&
    attemptData.submissionRef === submissionPath(attemptId) &&
    attemptData.resultRef === resultPath(attemptId) &&
    resultData.submissionRef === submissionPath(attemptId) &&
    resultData.enrollmentId === attemptData.enrollmentId &&
    resultData.classId === attemptData.classId &&
    enrollmentData.enrollmentId === attemptData.enrollmentId &&
    enrollmentData.studentUid === attemptData.studentUid &&
    enrollmentData.semesterId === expectedSemesterId &&
    enrollmentData.classId === attemptData.classId &&
    classData.classId === attemptData.classId &&
    classData.semesterId === expectedSemesterId &&
    Array.isArray(attemptData.questionIds) &&
    Array.isArray(attemptData.gradingSnapshot) &&
    Array.isArray(resultData.answerChecks) &&
    canonicalJson(submissionData.answers || {}) === canonicalJson(attemptData.answers || {}),
  );
  if (!valid) return { ok: false, reason: "ASSESSMENT_GRADE_SOURCE_MISMATCH" };

  const questionIds = attemptData.questionIds.map(String);
  const snapshotIds = attemptData.gradingSnapshot.map((item) => String(item?.id || ""));
  const checks = resultData.answerChecks.map((item) => ({
    id: String(item?.id || ""),
    correct: item?.correct === true,
  }));
  if (
    questionIds.length < 1 ||
    new Set(questionIds).size !== questionIds.length ||
    canonicalJson(questionIds) !== canonicalJson(snapshotIds) ||
    canonicalJson(questionIds) !== canonicalJson(checks.map((item) => item.id))
  ) {
    return { ok: false, reason: "ASSESSMENT_GRADE_ITEMS_MISMATCH" };
  }
  const correctCount = checks.filter((item) => item.correct).length;
  const expectedPercent = checks.length > 0 ? Math.round((correctCount / checks.length) * 100) : 0;
  if (Number(resultData.score) !== correctCount || Number(resultData.total) !== checks.length || Number(resultData.percent) !== expectedPercent) {
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
    !slot.exists ||
    !enrollment.exists ||
    !semesterClass.exists ||
    slot.data?.activeEnrollmentId !== payload.enrollmentId ||
    slot.data?.status !== "ACTIVE" ||
    enrollment.data?.enrollmentId !== payload.enrollmentId ||
    enrollment.data?.studentUid !== payload.studentUid ||
    enrollment.data?.semesterId !== payload.semesterId ||
    enrollment.data?.classId !== payload.classId ||
    enrollment.data?.enrollmentStatus !== "ACTIVE" ||
    semesterClass.data?.classId !== payload.classId ||
    semesterClass.data?.semesterId !== payload.semesterId ||
    semesterClass.data?.status !== "ACTIVE"
  ) {
    fail("failed-precondition", "Manual grade source is not bound to the current Enrollment.", "GRADE_ENROLLMENT_MISMATCH");
  }
  return {
    sourceId: payload.manualSourceId,
    sourceSnapshotHash: sha256(
      canonicalJson({
        sourceKind: payload.sourceKind,
        manualSourceId: payload.manualSourceId,
        semesterId: payload.semesterId,
        studentUid: payload.studentUid,
        enrollmentId: payload.enrollmentId,
        classId: payload.classId,
        sourceHash: payload.sourceHash,
        items: payload.items,
      }),
    ),
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
    record.schemaVersion !== GRADE_SCHEMA_VERSION ||
    record.policyVersion !== GRADE_POLICY_VERSION ||
    !SUPPORTED_RUBRIC_VERSIONS.includes(record.rubricVersion) ||
    !GRADE_SCORE_KINDS.includes(record.scoreKind)
  ) {
    fail("failed-precondition", "Grade record uses an unsupported schema, policy, or rubric version.", "GRADE_RECORD_VERSION_UNSUPPORTED");
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
    await assertWritableSemester(transaction, payload.semesterId, payload.expectedSemesterRevision);

    if (commandType === GRADE_COMMAND_TYPES.UPSERT_LEGACY_GRADE_ROSTER) {
      assertTeacherActor(actor);
      const rosterPath = legacyRosterPath(payload.semesterId, payload.rosterId);
      const rosterSnapshot = await transaction.get(rosterPath);
      const relatedRosterPaths = payload.relatedRosters.map((entry) => legacyRosterPath(payload.semesterId, entry.rosterId));
      const relatedRosterSnapshots = await transaction.getAll(relatedRosterPaths);
      const currentRosterRevision = Number(rosterSnapshot.data?.revision || 0);
      if (payload.mode === "CREATE" && rosterSnapshot.exists) {
        fail("already-exists", "Grade roster already exists.", "GRADE_ROSTER_EXISTS", {
          rosterId: payload.rosterId,
        });
      }
      if (payload.mode === "UPDATE" && !rosterSnapshot.exists) {
        fail("not-found", "Grade roster was not found.", "GRADE_ROSTER_NOT_FOUND", {
          rosterId: payload.rosterId,
        });
      }
      if (currentRosterRevision !== payload.expectedRosterRevision) {
        fail("aborted", "Grade roster revision changed.", "GRADE_ROSTER_REVISION_CONFLICT", {
          rosterId: payload.rosterId,
          currentRevision: currentRosterRevision,
        });
      }
      if (
        rosterSnapshot.exists &&
        (String(rosterSnapshot.data?.academicYear || "") !== legacySemesterParts(payload.semesterId).year ||
          String(rosterSnapshot.data?.semester || "") !== legacySemesterParts(payload.semesterId).semester ||
          normalizeScoreKind(rosterSnapshot.data?.scoreKind || "performance") !== payload.roster.scoreKind)
      ) {
        fail("failed-precondition", "Grade roster scope does not match.", "GRADE_SCOPE_MISMATCH");
      }
      payload.relatedRosters.forEach((entry, index) => {
        const snapshot = relatedRosterSnapshots[index];
        if (!snapshot.exists) {
          fail("not-found", "Related grade roster was not found.", "GRADE_ROSTER_NOT_FOUND", {
            rosterId: entry.rosterId,
          });
        }
        const currentRevision = Number(snapshot.data?.revision || 0);
        if (currentRevision !== entry.expectedRosterRevision) {
          fail("aborted", "Related grade roster revision changed.", "GRADE_ROSTER_REVISION_CONFLICT", {
            rosterId: entry.rosterId,
            currentRevision,
          });
        }
        const { year, semester } = legacySemesterParts(payload.semesterId);
        if (String(snapshot.data?.academicYear || "") !== year || String(snapshot.data?.semester || "") !== semester) {
          fail("failed-precondition", "Related grade roster scope does not match.", "GRADE_SCOPE_MISMATCH", {
            rosterId: entry.rosterId,
          });
        }
        assertRelatedLegacyRosterMutation({
          current: normalizeStoredLegacyRoster(snapshot.data || {}),
          next: entry.roster,
          primaryScoreKind: payload.roster.scoreKind,
          rosterId: entry.rosterId,
        });
      });

      const rosterStudentUids = payload.roster.rows.map((row) => row.uid).filter(Boolean);
      const recordStudentUids = payload.records.map((record) => record.uid);
      const rosterStudentUidSet = new Set(rosterStudentUids);
      if (recordStudentUids.some((studentUid) => !rosterStudentUidSet.has(studentUid))) {
        fail("invalid-argument", "Every score record must belong to the bounded roster snapshot.", "GRADE_ROSTER_RECORD_MISMATCH");
      }
      const activeScopes = await loadActiveEnrollmentScopes(transaction, payload.semesterId, rosterStudentUids);
      const existingRosterRows = Array.isArray(rosterSnapshot.data?.rows) ? rosterSnapshot.data.rows : [];
      if (existingRosterRows.length > LEGACY_GRADE_MAX_ROSTER_ROWS) {
        fail("failed-precondition", "Stored roster exceeds the bounded command limit.", "GRADE_ROSTER_LIMIT_EXCEEDED");
      }
      const existingStudentUids = [...new Set(existingRosterRows.map((row) => String(row?.uid || "")).filter(Boolean))];
      const projectionStudentUids = [...new Set([...existingStudentUids, ...recordStudentUids])];
      const projectionPaths = projectionStudentUids.map((studentUid) => legacyScorePath(studentUid, payload.rosterId));
      const projectionSnapshots = await transaction.getAll(projectionPaths);
      const projectionByUid = new Map(projectionStudentUids.map((studentUid, index) => [studentUid, projectionSnapshots[index]]));
      const confirmationSnapshots = await transaction.getAll(
        projectionStudentUids.map((studentUid) =>
          legacyConfirmationPath(studentUid, payload.rosterId),
        ),
      );
      const confirmationByUid = new Map(
        projectionStudentUids.map((studentUid, index) => [
          studentUid,
          confirmationSnapshots[index],
        ]),
      );
      const baseRecords = payload.records.map((record) =>
        buildLegacyBaseRecord({
          payload,
          rosterPath,
          record,
          scope: activeScopes.get(record.uid),
        }),
      );
      const desiredRecordIdByUid = new Map(baseRecords.map((record) => [record.studentUid, record.recordId]));
      const headIds = [
        ...new Set([
          ...baseRecords.map((record) => record.recordId),
          ...projectionSnapshots.map((snapshot) => String(snapshot.data?.gradeRecordId || "")).filter((recordId) => /^grade_[a-f0-9]{64}$/.test(recordId)),
        ]),
      ];
      const headSnapshots = await transaction.getAll(headIds.map(recordPath));
      const headById = new Map(headIds.map((recordId, index) => [recordId, headSnapshots[index]]));
      projectionStudentUids.forEach((studentUid) => {
        const projection = projectionByUid.get(studentUid);
        assertLegacyScoreProjectionOwnership({
          snapshot: projection,
          semesterId: payload.semesterId,
          studentUid,
          rosterId: payload.rosterId,
          scoreKind: payload.roster.scoreKind,
        });
        const previousRecordId = String(projection?.data?.gradeRecordId || "");
        if (!previousRecordId) return;
        const previousHead = headById.get(previousRecordId);
        if (
          !previousHead?.exists ||
          previousHead.data?.semesterId !== payload.semesterId ||
          previousHead.data?.studentUid !== studentUid ||
          previousHead.data?.sourceKind !== "MANUAL_IMPORT" ||
          previousHead.data?.sourceId !== payload.rosterId
        ) {
          fail(
            "failed-precondition",
            "Stored grade projection points to a different grade record scope.",
            "GRADE_PROJECTION_SCOPE_MISMATCH",
            { studentUid, rosterId: payload.rosterId },
          );
        }
      });
      const estimatedWriteCount =
        payload.records.length * 3 +
        recordStudentUids.filter(
          (studentUid) => confirmationByUid.get(studentUid)?.exists,
        ).length +
        projectionStudentUids.reduce((count, studentUid) => {
          const projection = projectionByUid.get(studentUid);
          const previousRecordId = String(
            projection?.data?.gradeRecordId || "",
          );
          const desiredRecordId = desiredRecordIdByUid.get(studentUid) || "";
          return (
            count +
            (previousRecordId && previousRecordId !== desiredRecordId ? 1 : 0) +
            (!desiredRecordId && projection?.exists ? 1 : 0) +
            (!desiredRecordId && confirmationByUid.get(studentUid)?.exists
              ? 1
              : 0)
          );
        }, 0) +
        1 +
        payload.relatedRosters.length;
      assertAtomicWriteBudget(estimatedWriteCount, "UPSERT");
      const nextRosterRevision = currentRosterRevision + 1;
      const refs = [rosterPath];
      const savedRecordResults = [];

      payload.records.forEach((legacyRecord, index) => {
        const baseRecord = baseRecords[index];
        const existingHead = headById.get(baseRecord.recordId);
        if (
          existingHead?.exists &&
          (existingHead.data?.schemaVersion !== GRADE_SCHEMA_VERSION ||
            existingHead.data?.policyVersion !== GRADE_POLICY_VERSION ||
            existingHead.data?.semesterId !== payload.semesterId ||
            existingHead.data?.studentUid !== legacyRecord.uid ||
            existingHead.data?.sourceKind !== "MANUAL_IMPORT" ||
            existingHead.data?.sourceId !== payload.rosterId)
        ) {
          fail("failed-precondition", "Stored grade record conflicts with this roster.", "GRADE_RECORD_CONFLICT", {
            recordId: baseRecord.recordId,
          });
        }
        const gradeRevision = existingHead?.exists ? Number(existingHead.data?.gradeRevision || 0) + 1 : 1;
        const revision = existingHead?.exists ? Number(existingHead.data?.revision || 0) + 1 : 1;
        const version = buildVersion({
          record: { ...(existingHead?.data || {}), ...baseRecord },
          gradeRevision,
          items: legacyItemsToGradeItems(legacyRecord),
          state: existingHead?.exists ? "CORRECTION_REVIEWED" : "OFFICIAL_PUBLISHED",
          reason: payload.reason,
          actor,
          commandId,
          receiptId,
          timestamp,
          supersedesVersionId: existingHead?.exists ? String(existingHead.data?.currentVersionId || "") : "",
        });
        const gradeRecord = {
          schemaVersion: GRADE_SCHEMA_VERSION,
          policyVersion: GRADE_POLICY_VERSION,
          ...baseRecord,
          revision,
          gradeRevision,
          status: "OFFICIAL_PENDING_SIGNATURE",
          currentVersionId: version.versionId,
          currentVersionRef: versionPath(version.versionId),
          evidenceHash: version.evidenceHash,
          totalScore: version.totalScore,
          totalMaxScore: version.totalMaxScore,
          percent: version.percent,
          signatureRequired: true,
          provenance: "CURRENT",
          officialVersionId: null,
          officialAt: null,
          signedAttestationId: null,
          signedBy: null,
          signedAt: null,
          previousOfficialVersionId: existingHead?.exists ? String(existingHead.data?.currentVersionId || "") : "",
          createdBy: existingHead?.exists ? String(existingHead.data?.createdBy || actor.actorUid) : actor.actorUid,
          createdAt: existingHead?.exists ? existingHead.data?.createdAt || timestamp : timestamp,
          updatedBy: actor.actorUid,
          updatedAt: timestamp,
          commandId,
          receiptId,
        };
        transaction.create(versionPath(version.versionId), version);
        if (existingHead?.exists) {
          transaction.set(recordPath(baseRecord.recordId), gradeRecord);
        } else {
          transaction.create(recordPath(baseRecord.recordId), gradeRecord);
        }
        if (confirmationByUid.get(legacyRecord.uid)?.exists) {
          transaction.delete(
            legacyConfirmationPath(legacyRecord.uid, payload.rosterId),
          );
        }
        transaction.set(
          legacyScorePath(legacyRecord.uid, payload.rosterId),
          buildLegacyScoreProjection({
            payload,
            record: legacyRecord,
            scope: activeScopes.get(legacyRecord.uid),
            gradeRecord,
            version,
            revision: nextRosterRevision,
            timestamp,
            actor,
          }),
        );
        savedRecordResults.push({
          uid: legacyRecord.uid,
          scoreId: payload.rosterId,
          recordId: baseRecord.recordId,
          versionId: version.versionId,
          revision,
          gradeRevision,
          projectionRevision: nextRosterRevision,
        });
        refs.push(recordPath(baseRecord.recordId), versionPath(version.versionId));
      });

      projectionStudentUids.forEach((studentUid) => {
        const projection = projectionByUid.get(studentUid);
        const previousRecordId = String(projection?.data?.gradeRecordId || "");
        const desiredRecordId = desiredRecordIdByUid.get(studentUid) || "";
        if (previousRecordId && previousRecordId !== desiredRecordId) {
          const previousHead = headById.get(previousRecordId);
          if (
            previousHead?.exists &&
            previousHead.data?.studentUid === studentUid &&
            previousHead.data?.semesterId === payload.semesterId &&
            previousHead.data?.sourceId === payload.rosterId
          ) {
            transaction.set(
              recordPath(previousRecordId),
              {
                revision: Number(previousHead.data?.revision || 0) + 1,
                status: "WITHDRAWN",
                signatureRequired: false,
                officialVersionId: null,
                officialAt: null,
                signedAttestationId: null,
                signedBy: null,
                signedAt: null,
                withdrawnBy: actor.actorUid,
                withdrawnAt: timestamp,
                withdrawalReason: payload.reason,
                updatedBy: actor.actorUid,
                updatedAt: timestamp,
                commandId,
                receiptId,
              },
              { merge: true },
            );
            refs.push(recordPath(previousRecordId));
          }
        }
        if (!desiredRecordId) {
          if (confirmationByUid.get(studentUid)?.exists) {
            transaction.delete(
              legacyConfirmationPath(studentUid, payload.rosterId),
            );
          }
          if (projection?.exists) {
            transaction.delete(legacyScorePath(studentUid, payload.rosterId));
          }
        }
      });

      const canonicalRows = payload.roster.rows.map((row) => {
        if (!row.uid) return row;
        const scope = activeScopes.get(row.uid);
        return {
          ...row,
          grade: scope.enrollmentSnapshot.grade,
          class: scope.enrollmentSnapshot.classNumber,
          number: scope.enrollmentSnapshot.studentNumber,
          studentName: scope.enrollmentSnapshot.displayName,
        };
      });
      const { year, semester } = legacySemesterParts(payload.semesterId);
      const storedRoster = {
        schemaVersion: LEGACY_GRADE_SCHEMA_VERSION,
        policyVersion: LEGACY_GRADE_POLICY_VERSION,
        revision: nextRosterRevision,
        scoreKind: payload.roster.scoreKind,
        ...(payload.roster.scoreContentKind ? { scoreContentKind: payload.roster.scoreContentKind } : {}),
        title: payload.roster.title,
        subject: payload.roster.subject,
        ...(payload.roster.assessmentOrder ? { assessmentOrder: payload.roster.assessmentOrder } : {}),
        academicYear: year,
        semester,
        targetGrade: payload.roster.targetGrade,
        targetClass: payload.roster.targetClass,
        classes: payload.roster.classes,
        items: payload.roster.items,
        totalMaxScore: payload.roster.totalMaxScore,
        rowCount: canonicalRows.length,
        matchedCount: payload.roster.matchedCount,
        unmatchedCount: payload.roster.unmatchedCount,
        sourceFileName: payload.roster.sourceFileName,
        rows: canonicalRows,
        uploadedBy: rosterSnapshot.exists ? String(rosterSnapshot.data?.uploadedBy || actor.actorUid) : actor.actorUid,
        uploadedByEmail: payload.roster.uploadedByEmail || actor.actorEmail || "",
        createdAt: rosterSnapshot.exists ? rosterSnapshot.data?.createdAt || timestamp : timestamp,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
        commandId,
        receiptId,
      };
      if (rosterSnapshot.exists) transaction.set(rosterPath, storedRoster);
      else transaction.create(rosterPath, storedRoster);
      const relatedRosterRevisions = payload.relatedRosters.map((entry, index) => {
        const snapshot = relatedRosterSnapshots[index];
        const revision = entry.expectedRosterRevision + 1;
        const stored = snapshot.data || {};
        const { year, semester } = legacySemesterParts(payload.semesterId);
        transaction.set(relatedRosterPaths[index], {
          schemaVersion: LEGACY_GRADE_SCHEMA_VERSION,
          policyVersion: LEGACY_GRADE_POLICY_VERSION,
          revision,
          scoreKind: entry.roster.scoreKind,
          ...(entry.roster.scoreContentKind ? { scoreContentKind: entry.roster.scoreContentKind } : {}),
          title: entry.roster.title,
          subject: entry.roster.subject,
          ...(entry.roster.assessmentOrder ? { assessmentOrder: entry.roster.assessmentOrder } : {}),
          academicYear: year,
          semester,
          targetGrade: entry.roster.targetGrade,
          targetClass: entry.roster.targetClass,
          classes: entry.roster.classes,
          items: entry.roster.items,
          totalMaxScore: entry.roster.totalMaxScore,
          rowCount: entry.roster.rows.length,
          matchedCount: entry.roster.matchedCount,
          unmatchedCount: entry.roster.unmatchedCount,
          sourceFileName: entry.roster.sourceFileName,
          rows: entry.roster.rows,
          uploadedBy: String(stored.uploadedBy || actor.actorUid),
          uploadedByEmail: entry.roster.uploadedByEmail || String(stored.uploadedByEmail || actor.actorEmail || ""),
          createdAt: stored.createdAt || timestamp,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
          commandId,
          receiptId,
        });
        refs.push(relatedRosterPaths[index]);
        return { rosterId: entry.rosterId, revision };
      });
      const sourceHash = sha256(
        canonicalJson({
          roster: storedRoster,
          records: payload.records,
          relatedRosters: payload.relatedRosters,
        }),
      );
      return {
        target: {
          kind: "legacy-grade-roster",
          id: payload.rosterId,
          refs: [...new Set(refs)].slice(0, 40),
        },
        sourceHash,
        result: {
          rosterId: payload.rosterId,
          revision: nextRosterRevision,
          status: "SAVED",
          recordCount: payload.records.length,
          records: savedRecordResults,
          relatedRosterRevisions,
          withdrawnCount: projectionStudentUids.filter((studentUid) => !desiredRecordIdByUid.has(studentUid)).length,
          sourceHash,
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.DELETE_LEGACY_GRADE_ROSTER) {
      assertTeacherActor(actor);
      const rosterPath = legacyRosterPath(payload.semesterId, payload.rosterId);
      const rosterSnapshot = await transaction.get(rosterPath);
      if (!rosterSnapshot.exists) {
        fail("not-found", "Grade roster was not found.", "GRADE_ROSTER_NOT_FOUND", {
          rosterId: payload.rosterId,
        });
      }
      const currentRevision = Number(rosterSnapshot.data?.revision || 0);
      if (currentRevision !== payload.expectedRosterRevision) {
        fail("aborted", "Grade roster revision changed.", "GRADE_ROSTER_REVISION_CONFLICT", {
          rosterId: payload.rosterId,
          currentRevision,
        });
      }
      const rows = Array.isArray(rosterSnapshot.data?.rows) ? rosterSnapshot.data.rows : [];
      if (rows.length > LEGACY_GRADE_MAX_ROSTER_ROWS) {
        fail("failed-precondition", "Stored roster exceeds the bounded command limit.", "GRADE_ROSTER_LIMIT_EXCEEDED");
      }
      const studentUids = [...new Set(rows.map((row) => String(row?.uid || "")).filter(Boolean))];
      const { year, semester } = legacySemesterParts(payload.semesterId);
      const rosterScoreKind = String(rosterSnapshot.data?.scoreKind || "performance");
      if (
        String(rosterSnapshot.data?.academicYear || "") !== year ||
        String(rosterSnapshot.data?.semester || "") !== semester ||
        !GRADE_SCORE_KINDS.includes(rosterScoreKind)
      ) {
        fail("failed-precondition", "Grade roster scope does not match.", "GRADE_SCOPE_MISMATCH");
      }
      const scorePaths = studentUids.map((studentUid) => legacyScorePath(studentUid, payload.rosterId));
      const scoreSnapshots = await transaction.getAll(scorePaths);
      const confirmationSnapshots = await transaction.getAll(
        studentUids.map((studentUid) =>
          legacyConfirmationPath(studentUid, payload.rosterId),
        ),
      );
      scoreSnapshots.forEach((snapshot, index) =>
        assertLegacyScoreProjectionOwnership({
          snapshot,
          semesterId: payload.semesterId,
          studentUid: studentUids[index],
          rosterId: payload.rosterId,
          scoreKind: rosterScoreKind,
        }),
      );
      const recordIds = [
        ...new Set(scoreSnapshots.map((snapshot) => String(snapshot.data?.gradeRecordId || "")).filter((recordId) => /^grade_[a-f0-9]{64}$/.test(recordId))),
      ];
      const recordSnapshots = await transaction.getAll(recordIds.map(recordPath));
      const studentUidByRecordId = new Map();
      scoreSnapshots.forEach((snapshot, index) => {
        const recordId = String(snapshot.data?.gradeRecordId || "");
        if (recordId) studentUidByRecordId.set(recordId, studentUids[index]);
      });
      recordSnapshots.forEach((recordSnapshot, index) => {
        if (!recordSnapshot.exists) return;
        const recordId = recordIds[index];
        if (
          recordSnapshot.data?.semesterId !== payload.semesterId ||
          recordSnapshot.data?.studentUid !== studentUidByRecordId.get(recordId) ||
          recordSnapshot.data?.sourceKind !== "MANUAL_IMPORT" ||
          recordSnapshot.data?.sourceId !== payload.rosterId
        ) {
          fail("failed-precondition", "Grade record does not belong to this roster.", "GRADE_RECORD_CONFLICT", {
            recordId,
          });
        }
      });
      assertAtomicWriteBudget(
        recordSnapshots.filter((snapshot) => snapshot.exists).length +
          scoreSnapshots.filter((snapshot) => snapshot.exists).length +
          confirmationSnapshots.filter((snapshot) => snapshot.exists).length +
          1,
        "DELETE",
      );
      recordSnapshots.forEach((recordSnapshot, index) => {
        if (!recordSnapshot.exists) return;
        const recordId = recordIds[index];
        transaction.set(
          recordPath(recordId),
          {
            revision: Number(recordSnapshot.data?.revision || 0) + 1,
            status: "WITHDRAWN",
            signatureRequired: false,
            officialVersionId: null,
            officialAt: null,
            signedAttestationId: null,
            signedBy: null,
            signedAt: null,
            withdrawnBy: actor.actorUid,
            withdrawnAt: timestamp,
            withdrawalReason: payload.reason,
            updatedBy: actor.actorUid,
            updatedAt: timestamp,
            commandId,
            receiptId,
          },
          { merge: true },
        );
      });
      studentUids.forEach((studentUid) => {
        const index = studentUids.indexOf(studentUid);
        if (confirmationSnapshots[index]?.exists) {
          transaction.delete(
            legacyConfirmationPath(studentUid, payload.rosterId),
          );
        }
        if (scoreSnapshots[index]?.exists) {
          transaction.delete(legacyScorePath(studentUid, payload.rosterId));
        }
      });
      transaction.delete(rosterPath);
      return {
        target: {
          kind: "legacy-grade-roster-deletion",
          id: payload.rosterId,
          refs: [rosterPath, ...recordIds.map(recordPath)].slice(0, 40),
        },
        sourceHash: sha256(canonicalJson(rosterSnapshot.data || {})),
        result: {
          rosterId: payload.rosterId,
          revision: currentRevision + 1,
          status: "DELETED",
          withdrawnCount: recordIds.length,
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.SAVE_LEGACY_GRADE_CONFIG) {
      assertTeacherActor(actor);
      if (payload.configKind === "WARNING" && payload.configId !== "performance_score") {
        fail("invalid-argument", "Warning config ID is invalid.", "GRADE_PAYLOAD_INVALID");
      }
      const configPath = legacyConfigPath(payload.semesterId, payload.configKind, payload.configId);
      const snapshot = await transaction.get(configPath);
      const currentRevision = Number(snapshot.data?.revision || 0);
      if (currentRevision !== payload.expectedRevision) {
        fail("aborted", "Grade config revision changed.", "GRADE_CONFIG_REVISION_CONFLICT", {
          configId: payload.configId,
          currentRevision,
        });
      }
      if (payload.operation === "DELETE") {
        if (!snapshot.exists) {
          fail("not-found", "Grade config was not found.", "GRADE_CONFIG_NOT_FOUND");
        }
        transaction.delete(configPath);
        return {
          target: {
            kind: "legacy-grade-config-deletion",
            id: payload.configId,
            refs: [configPath],
          },
          sourceHash: sha256(canonicalJson(snapshot.data || {})),
          result: {
            configId: payload.configId,
            configKind: payload.configKind,
            revision: currentRevision + 1,
            status: "DELETED",
          },
        };
      }
      if (payload.configKind === "WARNING") {
        const expectedHash = legacyWarningHash(payload.data.warningText);
        if (payload.data.warningTextHash !== expectedHash || payload.data.warningVersion !== `warning-${expectedHash}`) {
          fail("invalid-argument", "Warning version does not match the warning text.", "GRADE_WARNING_VERSION_MISMATCH");
        }
      }
      if (payload.configKind === "GRADING_PLAN" && payload.data.items.reduce((sum, item) => sum + item.ratio, 0) !== 100) {
        fail("invalid-argument", "Grading plan ratios must total 100.", "GRADE_CONFIG_RATIO_INVALID");
      }
      const { year, semester } = legacySemesterParts(payload.semesterId);
      const revision = currentRevision + 1;
      const storedData = {
        schemaVersion: LEGACY_GRADE_SCHEMA_VERSION,
        policyVersion: LEGACY_GRADE_POLICY_VERSION,
        revision,
        ...payload.data,
        academicYear: year,
        semester,
        createdAt: snapshot.exists ? snapshot.data?.createdAt || timestamp : timestamp,
        createdBy: snapshot.exists ? String(snapshot.data?.createdBy || actor.actorUid) : actor.actorUid,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
        commandId,
        receiptId,
      };
      if (snapshot.exists) transaction.set(configPath, storedData);
      else transaction.create(configPath, storedData);
      return {
        target: {
          kind: "legacy-grade-config",
          id: payload.configId,
          refs: [configPath],
        },
        sourceHash: sha256(canonicalJson(payload.data)),
        result: {
          configId: payload.configId,
          configKind: payload.configKind,
          revision,
          status: "SAVED",
          data: payload.data,
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.ACKNOWLEDGE_LEGACY_GRADE_WARNING) {
      assertStudentActor(actor);
      await loadActiveEnrollmentScopes(transaction, payload.semesterId, [actor.actorUid]);
      const [settingsSnapshot, consentSnapshot] = await transaction.getAll([
        legacyWarningSettingsPath(payload.semesterId),
        legacyWarningConsentPath(actor.actorUid),
      ]);
      const warningText = settingsSnapshot.exists ? String(settingsSnapshot.data?.warningText || "").trim() : DEFAULT_LEGACY_WARNING_TEXT;
      const warningVersion = settingsSnapshot.exists ? String(settingsSnapshot.data?.warningVersion || "") : DEFAULT_LEGACY_WARNING_VERSION;
      const warningTextHash = settingsSnapshot.exists ? String(settingsSnapshot.data?.warningTextHash || "") : legacyWarningHash(DEFAULT_LEGACY_WARNING_TEXT);
      if (!warningText || payload.warningVersion !== warningVersion || payload.warningTextHash !== warningTextHash) {
        fail("aborted", "The grade warning changed before acknowledgement.", "GRADE_WARNING_REVISION_CONFLICT");
      }
      const { year, semester } = legacySemesterParts(payload.semesterId);
      const revision = Number(consentSnapshot.data?.revision || 0) + 1;
      transaction.set(legacyWarningConsentPath(actor.actorUid), {
        schemaVersion: LEGACY_GRADE_SCHEMA_VERSION,
        policyVersion: LEGACY_GRADE_POLICY_VERSION,
        revision,
        uid: actor.actorUid,
        academicYear: year,
        semester,
        acknowledged: true,
        warningVersion,
        warningTextHash,
        acknowledgedAt: timestamp,
        updatedAt: timestamp,
        commandId,
        receiptId,
      });
      return {
        target: {
          kind: "legacy-grade-warning-acknowledgement",
          id: actor.actorUid,
          refs: [legacyWarningConsentPath(actor.actorUid), legacyWarningSettingsPath(payload.semesterId)],
        },
        sourceHash: sha256(canonicalJson({ warningVersion, warningTextHash })),
        result: {
          studentUid: actor.actorUid,
          revision,
          status: "ACKNOWLEDGED",
          warningVersion,
          warningTextHash,
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.SUBMIT_LEGACY_GRADE_REQUEST) {
      assertStudentActor(actor);
      await loadActiveEnrollmentScopes(transaction, payload.semesterId, [actor.actorUid]);
      await assertLegacyWarningConsent(transaction, payload.semesterId, actor.actorUid);
      const headSnapshots = await transaction.getAll(payload.records.map((entry) => recordPath(entry.recordId)));
      const scoreSnapshots = await transaction.getAll(payload.records.map((entry) => legacyScorePath(actor.actorUid, entry.scoreId)));
      const requestIds = payload.records.map((entry) => buildRequestId(entry.recordId, entry.expectedGradeRevision, actor.actorUid, payload.requestKind));
      const requestSnapshots = await transaction.getAll(requestIds.map(requestPath));
      const refs = [];
      payload.records.forEach((entry, index) => {
        const head = headSnapshots[index];
        const score = scoreSnapshots[index];
        const record = assertRecordCas(
          head,
          {
            ...entry,
            semesterId: payload.semesterId,
          },
          ["OFFICIAL_PENDING_SIGNATURE", "OFFICIAL"],
        );
        if (
          record.studentUid !== actor.actorUid ||
          !score.exists ||
          score.data?.uid !== actor.actorUid ||
          score.data?.gradeRecordId !== entry.recordId ||
          Number(score.data?.gradeRecordRevision || 0) !== entry.expectedRevision ||
          Number(score.data?.gradeRevision || 0) !== entry.expectedGradeRevision
        ) {
          fail("permission-denied", "Grade record belongs to another student.", "GRADE_RECORD_FORBIDDEN");
        }
        if (requestSnapshots[index].exists) {
          fail("already-exists", "A request already exists for this grade revision.", "GRADE_REQUEST_EXISTS", {
            requestId: requestIds[index],
          });
        }
        const requestId = requestIds[index];
        const canonicalPath = requestPath(requestId);
        const projectionPath = legacyRequestProjectionPath(payload.semesterId, payload.requestKind, requestId);
        const requestDocument = {
          schemaVersion: GRADE_SCHEMA_VERSION,
          policyVersion: GRADE_POLICY_VERSION,
          revision: 1,
          requestId,
          recordId: entry.recordId,
          versionId: record.currentVersionId,
          gradeRevision: entry.expectedGradeRevision,
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
        };
        transaction.create(canonicalPath, requestDocument);
        const { year, semester } = legacySemesterParts(payload.semesterId);
        transaction.create(projectionPath, {
          schemaVersion: LEGACY_GRADE_SCHEMA_VERSION,
          policyVersion: LEGACY_GRADE_POLICY_VERSION,
          revision: 1,
          requestId,
          gradeRecordId: entry.recordId,
          gradeVersionId: record.currentVersionId,
          gradeRevision: entry.expectedGradeRevision,
          uid: actor.actorUid,
          scoreKind: record.scoreKind,
          scoreId: entry.scoreId,
          rosterId: record.sourceId,
          scoreTitle: record.title,
          subject: String(score.data?.subject || ""),
          academicYear: year,
          semester,
          studentName: record.enrollmentSnapshot?.displayName || "",
          grade: record.enrollmentSnapshot?.grade || "",
          class: record.enrollmentSnapshot?.classNumber || "",
          number: record.enrollmentSnapshot?.studentNumber || "",
          totalScore: Number(record.totalScore || 0),
          totalMaxScore: Number(record.totalMaxScore || 0),
          scoreLabel: `${Number(record.totalScore || 0)} / ${Number(record.totalMaxScore || 0)}점`,
          items: Array.isArray(score.data?.items) ? score.data.items : [],
          targetDetails: entry.targetDetails,
          reason: payload.reason,
          status: "pending",
          requestedAt: timestamp,
          updatedAt: timestamp,
          commandId,
          receiptId,
        });
        refs.push(canonicalPath, projectionPath, recordPath(entry.recordId));
      });
      return {
        target: {
          kind: "legacy-grade-review-request",
          id: requestIds.join("|"),
          refs: refs.slice(0, 40),
        },
        sourceHash: sha256(canonicalJson({ records: payload.records, reason: payload.reason })),
        result: {
          requestIds,
          requestId: requestIds[0] || "",
          status: "PENDING",
          requestCount: requestIds.length,
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.REVIEW_LEGACY_GRADE_REQUEST) {
      assertTeacherActor(actor);
      const requestSnapshot = await transaction.get(requestPath(payload.requestId));
      if (!requestSnapshot.exists) {
        fail("not-found", "Grade request was not found.", "GRADE_REQUEST_NOT_FOUND");
      }
      const request = requestSnapshot.data || {};
      if (
        request.semesterId !== payload.semesterId ||
        request.status !== "PENDING" ||
        Number(request.revision || 0) !== payload.expectedRequestRevision ||
        !["OBJECTION", "ANSWER_SHEET"].includes(request.requestKind)
      ) {
        fail("aborted", "Grade request changed.", "GRADE_REQUEST_REVISION_CONFLICT");
      }
      if ((request.requestKind === "ANSWER_SHEET") !== (payload.resolution === "REVIEWED")) {
        fail("invalid-argument", "Request resolution does not match its kind.", "GRADE_REQUEST_RESOLUTION_INVALID");
      }
      const [recordSnapshot, projectionSnapshot] = await transaction.getAll([
        recordPath(request.recordId),
        legacyRequestProjectionPath(payload.semesterId, request.requestKind, payload.requestId),
      ]);
      if (
        !recordSnapshot.exists ||
        recordSnapshot.data?.studentUid !== request.studentUid ||
        recordSnapshot.data?.semesterId !== payload.semesterId ||
        !projectionSnapshot.exists ||
        projectionSnapshot.data?.gradeRecordId !== request.recordId
      ) {
        fail("failed-precondition", "Grade request projection is inconsistent.", "GRADE_REQUEST_INVALID");
      }
      if (payload.resolution === "ACCEPTED" && (payload.changedTotalScore === null || Number(recordSnapshot.data?.totalScore) !== payload.changedTotalScore)) {
        fail("failed-precondition", "Changed total does not match the current canonical grade.", "GRADE_REQUEST_SCORE_MISMATCH");
      }
      const canonicalStatus = payload.resolution === "REJECTED" ? "REJECTED" : "ACCEPTED";
      const revision = payload.expectedRequestRevision + 1;
      transaction.set(
        requestPath(payload.requestId),
        {
          revision,
          status: canonicalStatus,
          resolvedBy: actor.actorUid,
          resolvedAt: timestamp,
          resolutionReason: payload.reviewMemo || payload.resolution,
          correctionVersionId: payload.resolution === "ACCEPTED" ? String(recordSnapshot.data?.currentVersionId || "") : "",
          updatedAt: timestamp,
          commandId,
          receiptId,
        },
        { merge: true },
      );
      const projectionStatus = request.requestKind === "ANSWER_SHEET" ? "reviewed" : payload.resolution === "ACCEPTED" ? "accepted" : "rejected";
      transaction.set(
        legacyRequestProjectionPath(payload.semesterId, request.requestKind, payload.requestId),
        {
          revision,
          status: projectionStatus,
          reviewedAt: timestamp,
          reviewedBy: actor.actorUid,
          reviewedByName: actor.actorEmail || "",
          reviewMemo: payload.reviewMemo,
          ...(payload.changedTotalScore !== null
            ? {
                changedTotalScore: payload.changedTotalScore,
                changedScoreLabel: `${payload.changedTotalScore} / ${Number(recordSnapshot.data?.totalMaxScore || 0)}점`,
              }
            : {}),
          updatedAt: timestamp,
          commandId,
          receiptId,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "legacy-grade-request-review",
          id: payload.requestId,
          refs: [
            requestPath(payload.requestId),
            legacyRequestProjectionPath(payload.semesterId, request.requestKind, payload.requestId),
            recordPath(request.recordId),
          ],
        },
        sourceHash: String(recordSnapshot.data?.sourceHash || ""),
        result: {
          requestId: payload.requestId,
          revision,
          status: canonicalStatus,
          projectionStatus,
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.SIGN_LEGACY_GRADE_RECORDS) {
      assertStudentActor(actor);
      const scopes = await loadActiveEnrollmentScopes(transaction, payload.semesterId, [actor.actorUid]);
      await assertLegacyWarningConsent(transaction, payload.semesterId, actor.actorUid);
      const scope = scopes.get(actor.actorUid);
      if (scope.enrollmentSnapshot.displayName.trim() !== payload.signatureName) {
        fail("permission-denied", "Signature name does not match the active Enrollment.", "GRADE_SIGNATURE_NAME_MISMATCH");
      }
      const headSnapshots = await transaction.getAll(payload.records.map((entry) => recordPath(entry.recordId)));
      const scoreSnapshots = await transaction.getAll(payload.records.map((entry) => legacyScorePath(actor.actorUid, entry.scoreId)));
      const requestPaths = payload.records.flatMap((entry) => [
        requestPath(buildRequestId(entry.recordId, entry.expectedGradeRevision, actor.actorUid, "OBJECTION")),
        requestPath(buildRequestId(entry.recordId, entry.expectedGradeRevision, actor.actorUid, "ANSWER_SHEET")),
      ]);
      const requestSnapshots = await transaction.getAll(requestPaths);
      if (requestSnapshots.some((snapshot) => snapshot.exists && snapshot.data?.status === "PENDING")) {
        fail("failed-precondition", "Pending grade requests must be resolved before signing.", "GRADE_REQUEST_PENDING");
      }
      const attestationPaths = payload.records.flatMap((entry) => [
        attestationPath(buildAttestationId("ACKNOWLEDGEMENT", entry.recordId, entry.expectedGradeRevision, actor.actorUid)),
        attestationPath(buildAttestationId("SIGNATURE", entry.recordId, entry.expectedGradeRevision, actor.actorUid)),
      ]);
      const attestationSnapshots = await transaction.getAll(attestationPaths);
      const signatureImageHash = sha256(payload.signatureImage);
      const refs = [];
      payload.records.forEach((entry, index) => {
        const head = headSnapshots[index];
        const score = scoreSnapshots[index];
        const record = assertRecordCas(
          head,
          {
            ...entry,
            semesterId: payload.semesterId,
          },
          ["OFFICIAL_PENDING_SIGNATURE"],
        );
        if (
          record.studentUid !== actor.actorUid ||
          record.signatureRequired !== true ||
          !score.exists ||
          score.data?.uid !== actor.actorUid ||
          score.data?.gradeRecordId !== entry.recordId ||
          Number(score.data?.gradeRecordRevision || 0) !== entry.expectedRevision ||
          Number(score.data?.gradeRevision || 0) !== entry.expectedGradeRevision
        ) {
          fail("permission-denied", "Grade record cannot be signed by this student.", "GRADE_SIGNATURE_FORBIDDEN");
        }
        const acknowledgementId = buildAttestationId("ACKNOWLEDGEMENT", entry.recordId, entry.expectedGradeRevision, actor.actorUid);
        const signatureId = buildAttestationId("SIGNATURE", entry.recordId, entry.expectedGradeRevision, actor.actorUid);
        const acknowledgement = attestationSnapshots[index * 2];
        const signature = attestationSnapshots[index * 2 + 1];
        if (
          acknowledgement.exists &&
          (acknowledgement.data?.evidenceHash !== record.evidenceHash ||
            acknowledgement.data?.versionId !== record.currentVersionId ||
            acknowledgement.data?.statementVersion !== payload.statementVersion)
        ) {
          fail("already-exists", "Acknowledgement conflicts with the current evidence.", "GRADE_ATTESTATION_CONFLICT");
        }
        if (signature.exists) {
          fail("already-exists", "This grade revision has already been signed.", "GRADE_SIGNATURE_EXISTS");
        }
        if (!acknowledgement.exists) {
          transaction.create(attestationPath(acknowledgementId), {
            schemaVersion: GRADE_SCHEMA_VERSION,
            policyVersion: GRADE_POLICY_VERSION,
            attestationId: acknowledgementId,
            type: "ACKNOWLEDGEMENT",
            recordId: entry.recordId,
            versionId: record.currentVersionId,
            recordRevision: entry.expectedRevision,
            gradeRevision: entry.expectedGradeRevision,
            evidenceHash: record.evidenceHash,
            semesterId: payload.semesterId,
            studentUid: actor.actorUid,
            statementVersion: payload.statementVersion,
            commandId,
            receiptId,
            createdAt: timestamp,
          });
        }
        const signatureHash = sha256(
          canonicalJson({
            type: "SIGNATURE",
            recordId: entry.recordId,
            versionId: record.currentVersionId,
            gradeRevision: entry.expectedGradeRevision,
            evidenceHash: record.evidenceHash,
            studentUid: actor.actorUid,
            signatureName: payload.signatureName,
            signatureImageHash,
            statementVersion: payload.statementVersion,
          }),
        );
        transaction.create(attestationPath(signatureId), {
          schemaVersion: GRADE_SCHEMA_VERSION,
          policyVersion: GRADE_POLICY_VERSION,
          attestationId: signatureId,
          type: "SIGNATURE",
          recordId: entry.recordId,
          versionId: record.currentVersionId,
          recordRevision: entry.expectedRevision,
          gradeRevision: entry.expectedGradeRevision,
          evidenceHash: record.evidenceHash,
          semesterId: payload.semesterId,
          studentUid: actor.actorUid,
          signatureName: payload.signatureName,
          signatureImageHash,
          statementVersion: payload.statementVersion,
          signatureHash,
          acknowledgementRef: attestationPath(acknowledgementId),
          commandId,
          receiptId,
          createdAt: timestamp,
        });
        const revision = entry.expectedRevision + 1;
        transaction.set(
          recordPath(entry.recordId),
          {
            revision,
            status: "OFFICIAL",
            officialVersionId: record.currentVersionId,
            officialAt: timestamp,
            signedAttestationId: signatureId,
            signedBy: actor.actorUid,
            signedAt: timestamp,
            updatedBy: actor.actorUid,
            updatedAt: timestamp,
            commandId,
            receiptId,
          },
          { merge: true },
        );
        transaction.set(
          legacyScorePath(actor.actorUid, entry.scoreId),
          {
            gradeRecordRevision: revision,
            signatureName: payload.signatureName,
            signatureImage: payload.signatureImage,
            signedAt: timestamp,
            updatedAt: timestamp,
            commandId,
            receiptId,
          },
          { merge: true },
        );
        transaction.create(legacyConfirmationPath(actor.actorUid, entry.scoreId), {
          schemaVersion: LEGACY_GRADE_SCHEMA_VERSION,
          policyVersion: LEGACY_GRADE_POLICY_VERSION,
          uid: actor.actorUid,
          rosterId: entry.scoreId,
          gradeRecordId: entry.recordId,
          gradeRevision: entry.expectedGradeRevision,
          signatureName: payload.signatureName,
          signatureImage: payload.signatureImage,
          signatureImageHash,
          confirmedAt: timestamp,
          updatedAt: timestamp,
          commandId,
          receiptId,
        });
        refs.push(recordPath(entry.recordId), attestationPath(signatureId), legacyConfirmationPath(actor.actorUid, entry.scoreId));
      });
      return {
        target: {
          kind: "legacy-grade-signature",
          id: actor.actorUid,
          refs: refs.slice(0, 40),
        },
        sourceHash: signatureImageHash,
        result: {
          studentUid: actor.actorUid,
          signedCount: payload.records.length,
          status: "OFFICIAL",
          signatureImageHash,
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.REJECT_LEGACY_GRADE_SIGNATURES) {
      assertTeacherActor(actor);
      await loadActiveEnrollmentScopes(transaction, payload.semesterId, [payload.studentUid]);
      const headSnapshots = await transaction.getAll(payload.records.map((entry) => recordPath(entry.recordId)));
      const scoreSnapshots = await transaction.getAll(payload.records.map((entry) => legacyScorePath(payload.studentUid, entry.scoreId)));
      const versionIds = headSnapshots.map((snapshot) => String(snapshot.data?.currentVersionId || ""));
      const versionSnapshots = await transaction.getAll(versionIds.map(versionPath));
      const refs = [];
      payload.records.forEach((entry, index) => {
        const head = headSnapshots[index];
        const score = scoreSnapshots[index];
        const record = assertRecordCas(
          head,
          {
            ...entry,
            semesterId: payload.semesterId,
          },
          ["OFFICIAL"],
        );
        const version = versionSnapshots[index];
        if (
          record.studentUid !== payload.studentUid ||
          !record.signedAttestationId ||
          !score.exists ||
          score.data?.uid !== payload.studentUid ||
          score.data?.gradeRecordId !== entry.recordId ||
          !version.exists ||
          version.data?.recordId !== entry.recordId ||
          version.data?.evidenceHash !== record.evidenceHash ||
          !Array.isArray(version.data?.items)
        ) {
          fail("failed-precondition", "Signed grade evidence is inconsistent.", "GRADE_SIGNATURE_REJECTION_INVALID");
        }
        const gradeRevision = entry.expectedGradeRevision + 1;
        const nextVersion = buildVersion({
          record,
          gradeRevision,
          items: version.data.items,
          state: "CORRECTION_REVIEWED",
          reason: payload.reason,
          actor,
          commandId,
          receiptId,
          timestamp,
          supersedesVersionId: record.currentVersionId,
        });
        const revision = entry.expectedRevision + 1;
        transaction.create(versionPath(nextVersion.versionId), nextVersion);
        transaction.set(
          recordPath(entry.recordId),
          {
            revision,
            gradeRevision,
            status: "OFFICIAL_PENDING_SIGNATURE",
            currentVersionId: nextVersion.versionId,
            currentVersionRef: versionPath(nextVersion.versionId),
            evidenceHash: nextVersion.evidenceHash,
            totalScore: nextVersion.totalScore,
            totalMaxScore: nextVersion.totalMaxScore,
            percent: nextVersion.percent,
            signatureRequired: true,
            previousOfficialVersionId: record.currentVersionId,
            officialVersionId: null,
            officialAt: null,
            signedAttestationId: null,
            signedBy: null,
            signedAt: null,
            signatureRejectedBy: actor.actorUid,
            signatureRejectedAt: timestamp,
            signatureRejectionReason: payload.reason,
            updatedBy: actor.actorUid,
            updatedAt: timestamp,
            commandId,
            receiptId,
          },
          { merge: true },
        );
        const { signatureName: _signatureName, signatureImage: _signatureImage, signedAt: _signedAt, ...unsignedProjection } = score.data || {};
        transaction.set(legacyScorePath(payload.studentUid, entry.scoreId), {
          ...unsignedProjection,
          gradeVersionId: nextVersion.versionId,
          gradeRecordRevision: revision,
          gradeRevision,
          updatedAt: timestamp,
          commandId,
          receiptId,
        });
        transaction.delete(legacyConfirmationPath(payload.studentUid, entry.scoreId));
        refs.push(recordPath(entry.recordId), versionPath(nextVersion.versionId), legacyScorePath(payload.studentUid, entry.scoreId));
      });
      return {
        target: {
          kind: "legacy-grade-signature-rejection",
          id: payload.studentUid,
          refs: refs.slice(0, 40),
        },
        sourceHash: sha256(canonicalJson(payload.records)),
        result: {
          studentUid: payload.studentUid,
          rejectedCount: payload.records.length,
          status: "OFFICIAL_PENDING_SIGNATURE",
        },
      };
    }

    if (commandType === GRADE_COMMAND_TYPES.CREATE_GRADE_DRAFT) {
      assertTeacherActor(actor);
      const source =
        payload.sourceKind === "ASSESSMENT_RESULT" ? await loadAssessmentSource(transaction, payload) : await loadManualSource(transaction, payload);
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
        logicalKey:
          payload.sourceKind === "ASSESSMENT_RESULT"
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
        target: {
          kind: "grade-record",
          id: recordId,
          refs: [path, versionPath(version.versionId)],
        },
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
      transaction.set(
        path,
        {
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
        },
        { merge: true },
      );
      return {
        target: {
          kind: "grade-review",
          id: payload.recordId,
          refs: [path, versionPath(version.versionId)],
        },
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
      transaction.set(
        path,
        {
          revision,
          status: "EVIDENCE_LOCKED",
          finalizedBy: actor.actorUid,
          finalizedAt: timestamp,
          finalizeReason: payload.reason,
          updatedBy: actor.actorUid,
          updatedAt: timestamp,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "grade-finalization",
          id: payload.recordId,
          refs: [path, versionPath(payload.expectedVersionId)],
        },
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
      transaction.set(
        path,
        {
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
        },
        { merge: true },
      );
      return {
        target: {
          kind: "official-grade-publication",
          id: payload.recordId,
          refs: [path, versionPath(payload.expectedVersionId)],
        },
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
          !request.exists ||
          request.data?.recordId !== payload.recordId ||
          request.data?.studentUid !== record.studentUid ||
          request.data?.status !== "PENDING" ||
          Number(request.data?.gradeRevision || 0) !== payload.expectedGradeRevision
        ) {
          fail("failed-precondition", "Grade review request is not pending for this version.", "GRADE_REQUEST_INVALID");
        }
      }
      if (payload.resolution === "REJECT") {
        transaction.set(
          requestPath(payload.requestId),
          {
            status: "REJECTED",
            resolvedBy: actor.actorUid,
            resolvedAt: timestamp,
            resolutionReason: payload.reason,
            correctionVersionId: "",
            updatedAt: timestamp,
          },
          { merge: true },
        );
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
      transaction.set(
        path,
        {
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
        },
        { merge: true },
      );
      const refs = [path, versionPath(version.versionId)];
      if (request) {
        transaction.set(
          requestPath(payload.requestId),
          {
            status: "ACCEPTED",
            resolvedBy: actor.actorUid,
            resolvedAt: timestamp,
            resolutionReason: payload.reason,
            correctionVersionId: version.versionId,
            updatedAt: timestamp,
          },
          { merge: true },
        );
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
      const requestId = buildRequestId(payload.recordId, payload.expectedGradeRevision, actor.actorUid, payload.requestKind);
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
        target: {
          kind: "grade-review-request",
          id: requestId,
          refs: [targetPath, path],
        },
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
      const attestationId = buildAttestationId("ACKNOWLEDGEMENT", payload.recordId, payload.expectedGradeRevision, actor.actorUid);
      const targetPath = attestationPath(attestationId);
      const existing = await transaction.get(targetPath);
      if (existing.exists) {
        if (existing.data?.evidenceHash !== record.evidenceHash || existing.data?.statementVersion !== payload.statementVersion) {
          fail("already-exists", "Acknowledgement identity conflicts with existing evidence.", "GRADE_ATTESTATION_CONFLICT");
        }
        return {
          target: {
            kind: "grade-acknowledgement",
            id: attestationId,
            refs: [targetPath, path],
          },
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
        target: {
          kind: "grade-acknowledgement",
          id: attestationId,
          refs: [targetPath, path],
        },
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
      const acknowledgementId = buildAttestationId("ACKNOWLEDGEMENT", payload.recordId, payload.expectedGradeRevision, actor.actorUid);
      const signatureId = buildAttestationId("SIGNATURE", payload.recordId, payload.expectedGradeRevision, actor.actorUid);
      const [acknowledgement, existingSignature] = await transaction.getAll([attestationPath(acknowledgementId), attestationPath(signatureId)]);
      if (
        !acknowledgement.exists ||
        acknowledgement.data?.evidenceHash !== record.evidenceHash ||
        acknowledgement.data?.versionId !== record.currentVersionId
      ) {
        fail("failed-precondition", "The exact grade revision must be acknowledged first.", "GRADE_ACKNOWLEDGEMENT_REQUIRED");
      }
      if (acknowledgement.data?.statementVersion !== payload.statementVersion) {
        fail("failed-precondition", "Signature statement does not match the acknowledged statement.", "GRADE_SIGNATURE_STATEMENT_MISMATCH");
      }
      const signatureHash = sha256(
        canonicalJson({
          type: "SIGNATURE",
          recordId: payload.recordId,
          versionId: record.currentVersionId,
          gradeRevision: payload.expectedGradeRevision,
          evidenceHash: record.evidenceHash,
          studentUid: actor.actorUid,
          signatureName: payload.signatureName,
          statementVersion: payload.statementVersion,
        }),
      );
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
      transaction.set(
        path,
        {
          revision,
          status: "OFFICIAL",
          officialVersionId: record.currentVersionId,
          officialAt: timestamp,
          signedAttestationId: signatureId,
          signedBy: actor.actorUid,
          signedAt: timestamp,
          updatedBy: actor.actorUid,
          updatedAt: timestamp,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "official-grade-signature",
          id: signatureId,
          refs: [attestationPath(signatureId), path],
        },
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

const GRADE_TEACHER_QUEUE_PAGE_SIZE = 25;
const EMPTY_GRADE_QUEUE_CURSOR = Object.freeze({
  recordId: "",
  attemptId: "",
  slotId: "",
  recordsDone: false,
  attemptsDone: false,
  slotsDone: false,
});

const decodeGradeQueueCursor = (rawCursor) => {
  const cursor = String(rawCursor || "").trim();
  if (!cursor) return { ...EMPTY_GRADE_QUEUE_CURSOR };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    assertAllowedKeys(
      parsed,
      [
        "version",
        "recordId",
        "attemptId",
        "slotId",
        "recordsDone",
        "attemptsDone",
        "slotsDone",
      ],
      "grade queue cursor",
    );
    if (parsed.version !== 1) throw new TypeError("unsupported cursor");
    return {
      recordId: parsed.recordId
        ? pathSegment(parsed.recordId, "cursor.recordId", 240)
        : "",
      attemptId: parsed.attemptId
        ? pathSegment(parsed.attemptId, "cursor.attemptId", 240)
        : "",
      slotId: parsed.slotId
        ? pathSegment(parsed.slotId, "cursor.slotId", 240)
        : "",
      recordsDone: parsed.recordsDone === true,
      attemptsDone: parsed.attemptsDone === true,
      slotsDone: parsed.slotsDone === true,
    };
  } catch {
    fail(
      "invalid-argument",
      "Grade queue cursor is invalid.",
      "GRADE_QUERY_CURSOR_INVALID",
    );
  }
};

const encodeGradeQueueCursor = (cursor) => {
  if (cursor.recordsDone && cursor.attemptsDone && cursor.slotsDone) return "";
  return Buffer.from(
    JSON.stringify({ version: 1, ...cursor }),
    "utf8",
  ).toString("base64url");
};

const documentIdFromCollection = (document, collectionPath) => {
  const prefix = `${collectionPath}/`;
  const path = String(document?.path || "");
  const id = path.startsWith(prefix) ? path.slice(prefix.length) : "";
  if (!id || id.includes("/")) {
    fail(
      "failed-precondition",
      "Grade queue document path is invalid.",
      "GRADE_QUERY_DOCUMENT_INVALID",
    );
  }
  return id;
};

const loadGradeQueuePage = async ({
  transaction,
  collectionPath,
  semesterId,
  cursorId,
  done,
}) => {
  if (done) return { documents: [], cursorId, done: true };
  const documents = await transaction.query(collectionPath, {
    field: "semesterId",
    operator: "==",
    value: semesterId,
    documentIdOrder: "asc",
    ...(cursorId ? { startAfterId: cursorId } : {}),
    limit: GRADE_TEACHER_QUEUE_PAGE_SIZE + 1,
  });
  const hasMore = documents.length > GRADE_TEACHER_QUEUE_PAGE_SIZE;
  const page = documents.slice(0, GRADE_TEACHER_QUEUE_PAGE_SIZE);
  return {
    documents: page,
    cursorId: hasMore
      ? documentIdFromCollection(page[page.length - 1], collectionPath)
      : cursorId,
    done: !hasMore,
  };
};

const normalizeQuery = (raw) => {
  const value = raw || {};
  assertAllowedKeys(
    value,
    ["mode", "audience", "semesterId", "recordId", "studentUid", "source", "provenance", "scoreKind", "status", "cursor", "_session"],
    "getGradeEvidenceState payload",
  );
  if (value.audience !== undefined && !["student", "teacher"].includes(value.audience)) {
    fail("invalid-argument", "audience is invalid.", "GRADE_QUERY_INVALID");
  }
  const inferredMode = value.recordId ? "GRADE_DETAIL" : value.audience === "teacher" ? "TEACHER_QUEUE" : "MY_GRADES";
  const mode = value.mode || inferredMode;
  if (
    ![
      "MY_GRADES",
      "GRADE_DETAIL",
      "TEACHER_QUEUE",
      "STUDENT_EXAM_ANSWERS",
    ].includes(mode)
  ) {
    fail("invalid-argument", "mode is invalid.", "GRADE_QUERY_INVALID");
  }
  const source = value.provenance || value.source;
  if (!["CURRENT", "PREPARING", "ARCHIVE", "LEGACY", "EXPLICIT"].includes(source)) {
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
    cursor: value.cursor ? text(value.cursor, "cursor", 2_000) : "",
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
  if (!inspected.ok || inspected.sourceSnapshotHash !== record.sourceSnapshotHash || inspected.sourceHash !== record.sourceHash) {
    fail("failed-precondition", "The immutable assessment source no longer matches this grade record.", "GRADE_SOURCE_EVIDENCE_INVALID", {
      recordId: record.recordId,
      sourceId: record.sourceId,
    });
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

const createGradeQueryCore = ({ store, assertSession = sessionAuthority.assertActiveApplicationSession } = {}) => {
  if (!store) throw new TypeError("store is required.");

  const resolveActor = async (request) => {
    const identity = await assertSession(request, {
      recentAuth: false,
      highRisk: false,
    });
    const uid = String(identity?.uid || request.auth?.uid || "").trim();
    if (!uid || uid !== String(request.auth?.uid || "").trim()) {
      fail("permission-denied", "Authenticated actor mismatch.", "COMMAND_ACTOR_MISMATCH");
    }
    const profile = await store.get(`users/${uid}`);
    const role = String(profile.data?.role || "student").trim() || "student";
    const isAdmin =
      String(identity?.email || request.auth?.token?.email || "")
        .trim()
        .toLowerCase() === "westoria28@gmail.com";
    const canManage = isAdmin || role === "teacher";
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
    if (query.mode === "STUDENT_EXAM_ANSWERS") {
      if (
        actor.role !== "student" ||
        query.audience !== "student" ||
        query.source !== "CURRENT" ||
        query.scoreKind !== "written_exam_essay" ||
        query.recordId ||
        query.studentUid ||
        query.status ||
        query.cursor
      ) {
        fail(
          "permission-denied",
          "Student exam answer access is not allowed for this request.",
          "GRADE_STUDENT_ANSWER_SCOPE_REQUIRED",
        );
      }
      return store.runTransaction(async (transaction) => {
        const [pointer, manifest, slot, config] = await transaction.getAll([
          "site_settings/semester_active",
          manifestPath(query.semesterId),
          slotPath(query.semesterId, actor.uid),
          legacyConfigPath(query.semesterId, "OMR", "final_exam"),
        ]);
        if (
          !pointer.exists ||
          pointer.data?.semesterId !== query.semesterId ||
          !manifest.exists ||
          manifest.data?.status !== "ACTIVE" ||
          Number(pointer.data?.revision || 0) !==
            Number(manifest.data?.revision || 0)
        ) {
          fail(
            "failed-precondition",
            "Exam answers are only available in the canonical active semester.",
            "GRADE_SEMESTER_NOT_ACTIVE",
          );
        }
        const enrollmentId = String(slot.data?.activeEnrollmentId || "");
        if (
          !slot.exists ||
          slot.data?.status !== "ACTIVE" ||
          slot.data?.semesterId !== query.semesterId ||
          slot.data?.studentUid !== actor.uid ||
          !enrollmentId
        ) {
          fail(
            "permission-denied",
            "An active student enrollment is required for exam answers.",
            "GRADE_STUDENT_ANSWER_SCOPE_REQUIRED",
          );
        }
        const enrollment = await transaction.get(enrollmentPath(enrollmentId));
        const classId = String(enrollment.data?.classId || "");
        if (
          !enrollment.exists ||
          enrollment.data?.enrollmentId !== enrollmentId ||
          enrollment.data?.studentUid !== actor.uid ||
          enrollment.data?.semesterId !== query.semesterId ||
          enrollment.data?.enrollmentStatus !== "ACTIVE" ||
          !classId
        ) {
          fail(
            "permission-denied",
            "An active student enrollment is required for exam answers.",
            "GRADE_STUDENT_ANSWER_SCOPE_REQUIRED",
          );
        }
        const semesterClass = await transaction.get(classPath(classId));
        if (
          !semesterClass.exists ||
          semesterClass.data?.classId !== classId ||
          semesterClass.data?.semesterId !== query.semesterId ||
          semesterClass.data?.status !== "ACTIVE"
        ) {
          fail(
            "permission-denied",
            "An active student class is required for exam answers.",
            "GRADE_STUDENT_ANSWER_SCOPE_REQUIRED",
          );
        }
        const baseResult = {
          mode: query.mode,
          audience: "student",
          source: "CURRENT",
          provenance: "CURRENT",
          scoreKind: "written_exam_essay",
          semesterId: query.semesterId,
          manifestRevision: Number(manifest.data?.revision || 0),
          manifestStatus: "ACTIVE",
          readOnly: true,
          records: [],
          pendingSources: [],
          activeStudents: [],
          detail: null,
          nextCursor: "",
          writeCount: 0,
        };
        if (!config.exists) {
          return {
            ...baseResult,
            status: "EMPTY",
            releaseStatus: "HIDDEN",
            releasePolicyVersion: LEGACY_OMR_RELEASE_POLICY_VERSION,
            configRevision: null,
            examAnswers: null,
            reason: "EXAM_CONFIG_NOT_FOUND",
          };
        }
        const storedReleaseStatus = String(
          config.data?.releaseStatus || "HIDDEN",
        );
        if (!LEGACY_OMR_RELEASE_STATUSES.includes(storedReleaseStatus)) {
          fail(
            "failed-precondition",
            "Stored exam answer release policy is invalid.",
            "GRADE_ANSWER_RELEASE_POLICY_INVALID",
          );
        }
        if (storedReleaseStatus !== "RELEASED") {
          return {
            ...baseResult,
            status: "NOT_RELEASED",
            releaseStatus: "HIDDEN",
            releasePolicyVersion: LEGACY_OMR_RELEASE_POLICY_VERSION,
            configRevision: Number(config.data?.revision || 0) || null,
            examAnswers: null,
            reason: "EXAM_ANSWERS_NOT_RELEASED",
          };
        }
        const { year, semester } = legacySemesterParts(query.semesterId);
        if (
          config.data?.schemaVersion !== LEGACY_GRADE_SCHEMA_VERSION ||
          config.data?.policyVersion !== LEGACY_GRADE_POLICY_VERSION ||
          String(config.data?.academicYear || "") !== year ||
          String(config.data?.semester || "") !== semester ||
          Number(config.data?.revision || 0) < 1 ||
          config.data?.releasePolicyVersion !==
            LEGACY_OMR_RELEASE_POLICY_VERSION
        ) {
          fail(
            "failed-precondition",
            "Stored exam answers do not satisfy the release policy.",
            "GRADE_ANSWER_RELEASE_POLICY_INVALID",
          );
        }
        const releasedAnswers = normalizeLegacyConfigData("OMR", {
          objective: config.data?.objective,
          subjective: config.data?.subjective,
          releaseStatus: storedReleaseStatus,
          releasePolicyVersion: config.data?.releasePolicyVersion,
        });
        return {
          ...baseResult,
          status: "RELEASED",
          releaseStatus: "RELEASED",
          releasePolicyVersion: releasedAnswers.releasePolicyVersion,
          configRevision: Number(config.data?.revision || 0),
          examAnswers: {
            objective: releasedAnswers.objective,
            subjective: releasedAnswers.subjective,
          },
          reason: "",
        };
      });
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
        activeStudents: [],
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
          activeStudents: [],
          detail: null,
          reason: "SEMESTER_NOT_FOUND",
          writeCount: 0,
        };
      }
      const manifestStatus = String(manifest.data?.status || "");
      if (!semesterCore.SEMESTER_STATUSES.includes(manifestStatus)) {
        fail("failed-precondition", "Semester Manifest status is invalid.", "GRADE_MANIFEST_STATUS_INVALID", {
          semesterId: query.semesterId,
          manifestStatus,
        });
      }
      const archived = ["CLOSED", "ARCHIVED"].includes(manifestStatus);
      const preparing = ["DRAFT", "PREPARING", "VALIDATING", "READY", "FAILED", "QUARANTINED"].includes(manifestStatus);
      if (query.source === "ARCHIVE" && !archived) {
        fail("failed-precondition", "ARCHIVE provenance requires a closed or archived semester.", "GRADE_PROVENANCE_MISMATCH", {
          semesterId: query.semesterId,
          manifestStatus,
        });
      }
      const archivedView = archived;
      const lifecycleProvenance = archived ? "ARCHIVE" : preparing ? "PREPARING" : "CURRENT";
      const provenance = query.source === "EXPLICIT" && lifecycleProvenance === "CURRENT" ? "EXPLICIT" : lifecycleProvenance;
      const readOnly = manifestStatus !== "ACTIVE" || query.source !== "CURRENT";
      const queueCursor =
        query.mode === "TEACHER_QUEUE"
          ? decodeGradeQueueCursor(query.cursor)
          : null;
      const recordPage = queueCursor
        ? await loadGradeQueuePage({
            transaction,
            collectionPath: GRADE_RECORD_COLLECTION,
            semesterId: query.semesterId,
            cursorId: queueCursor.recordId,
            done: queueCursor.recordsDone,
          })
        : null;
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
      } else if (recordPage) {
        recordDocuments = recordPage.documents;
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
      const scopedRecords = recordDocuments.map((document) => document.data || {}).filter((record) => record.semesterId === query.semesterId);
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
        records = records.filter((record) => ["OFFICIAL_PENDING_SIGNATURE", "OFFICIAL"].includes(record.status));
      }
      if (
        records.some(
          (record) =>
            record.schemaVersion !== GRADE_SCHEMA_VERSION ||
            record.policyVersion !== GRADE_POLICY_VERSION ||
            !SUPPORTED_RUBRIC_VERSIONS.includes(record.rubricVersion) ||
            !GRADE_SCORE_KINDS.includes(record.scoreKind),
        )
      ) {
        fail("failed-precondition", "A grade record uses an unsupported schema, policy, or rubric version.", "GRADE_RECORD_VERSION_UNSUPPORTED");
      }
      records.sort(
        (left, right) =>
          String(left.title || "").localeCompare(String(right.title || ""), "ko") || String(left.recordId || "").localeCompare(String(right.recordId || "")),
      );

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
          !version.exists ||
          version.data?.recordId !== record.recordId ||
          version.data?.evidenceHash !== record.evidenceHash ||
          !versionEvidenceMatches(version.data || {})
        ) {
          fail("failed-precondition", "The current grade evidence version is invalid.", "GRADE_EVIDENCE_INVALID", {
            recordId: record.recordId,
          });
        }
        const currentAttestations = attestations
          .map((document) => document.data || {})
          .filter(
            (attestation) =>
              attestation.versionId === record.currentVersionId &&
              Number(attestation.gradeRevision || 0) === Number(record.gradeRevision || 0) &&
              attestation.evidenceHash === record.evidenceHash,
          );
        const sourceEvidence = await loadPublicSourceEvidence({
          transaction,
          record,
          actor,
        });
        detail = {
          record: {
            ...publicRecord(record, actor.canManage),
            provenance,
            readOnly,
          },
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
      let activeStudents = [];
      let nextCursor = "";
      if (query.mode === "TEACHER_QUEUE") {
        const attemptPage = await loadGradeQueuePage({
          transaction,
          collectionPath: assessmentLifecycle.ATTEMPT_COLLECTION,
          semesterId: query.semesterId,
          cursorId: queueCursor.attemptId,
          done: queueCursor.attemptsDone,
        });
        const slotPage = await loadGradeQueuePage({
          transaction,
          collectionPath: archiveEnrollment.ENROLLMENT_SLOT_COLLECTION,
          semesterId: query.semesterId,
          cursorId: queueCursor.slotId,
          done: queueCursor.slotsDone,
        });

        const attempts = attemptPage.documents
          .map((document) => ({ document, attempt: document.data || {} }))
          .filter(
            ({ attempt }) =>
              attempt.semesterId === query.semesterId &&
              (!query.studentUid || attempt.studentUid === query.studentUid),
          );
        const attemptDependencyPaths = [
          ...new Set(
            attempts.flatMap(({ attempt }) => [
              `${assessmentLifecycle.DEFINITION_COLLECTION}/${attempt.definitionId}`,
              submissionPath(attempt.attemptId),
              resultPath(attempt.attemptId),
              enrollmentPath(attempt.enrollmentId),
              classPath(attempt.classId),
              recordPath(
                buildRecordId({
                  sourceKind: "ASSESSMENT_RESULT",
                  attemptId: attempt.attemptId,
                }),
              ),
            ]),
          ),
        ];
        const attemptDependencies = await transaction.getAll(
          attemptDependencyPaths,
        );
        const attemptDependencyByPath = new Map(
          attemptDependencyPaths.map((path, index) => [
            path,
            attemptDependencies[index],
          ]),
        );
        pendingSources = attempts
          .map(({ document, attempt }) => {
            const definition =
              attemptDependencyByPath.get(
                `${assessmentLifecycle.DEFINITION_COLLECTION}/${attempt.definitionId}`,
              )?.data || {};
            const enrollmentDocument = attemptDependencyByPath.get(
              enrollmentPath(attempt.enrollmentId),
            );
            const classDocument = attemptDependencyByPath.get(
              classPath(attempt.classId),
            );
            const enrollment = enrollmentDocument?.data || {};
            const semesterClass = classDocument?.data || {};
            const gradeHead = attemptDependencyByPath.get(
              recordPath(
                buildRecordId({
                  sourceKind: "ASSESSMENT_RESULT",
                  attemptId: attempt.attemptId,
                }),
              ),
            );
            if (
              gradeHead?.exists &&
              (gradeHead.data?.sourceKind !== "ASSESSMENT_RESULT" ||
                gradeHead.data?.sourceId !== attempt.attemptId ||
                gradeHead.data?.semesterId !== query.semesterId)
            ) {
              fail(
                "failed-precondition",
                "A grade record conflicts with this assessment source.",
                "GRADE_RECORD_CONFLICT",
                { attemptId: attempt.attemptId },
              );
            }
            const inspected = inspectAssessmentJoin({
              attempt: document,
              submission: attemptDependencyByPath.get(
                submissionPath(attempt.attemptId),
              ),
              result: attemptDependencyByPath.get(
                resultPath(attempt.attemptId),
              ),
              enrollment: enrollmentDocument,
              semesterClass: classDocument,
              expectedSemesterId: query.semesterId,
            });
            return {
              attempt,
              definition,
              enrollment,
              semesterClass,
              inspected,
              alreadyGraded: gradeHead?.exists === true,
            };
          })
          .filter(
            ({ attempt, definition, inspected, alreadyGraded }) =>
              inspected.ok &&
              !alreadyGraded &&
              attempt.status === "SUBMITTED" &&
              definition.definitionId === attempt.definitionId &&
              Number(definition.revision || 0) ===
                Number(attempt.definitionRevision || 0),
          )
          .map(
            ({ attempt, definition, enrollment, semesterClass, inspected }) => ({
              attemptId: attempt.attemptId,
              definitionId: attempt.definitionId,
              definitionRevision: Number(attempt.definitionRevision || 0),
              title: String(definition.title || "채점 대기 평가"),
              scoreKind: query.scoreKind,
              semesterId: query.semesterId,
              studentUid: attempt.studentUid,
              enrollmentId: attempt.enrollmentId,
              classId: attempt.classId,
              enrollmentSnapshot: buildEnrollmentSnapshot(
                enrollment,
                semesterClass,
              ),
              sourceHash: inspected.sourceHash,
              sourceSnapshotHash: inspected.sourceSnapshotHash,
              submittedAtIso: attempt.submittedAtIso || "",
              provenance,
              readOnly,
            }),
          )
          .sort(
            (left, right) =>
              String(left.title).localeCompare(String(right.title), "ko") ||
              String(left.attemptId).localeCompare(String(right.attemptId)),
          );

        const slots = slotPage.documents
          .map((document) => document.data || {})
          .filter(
            (slot) =>
              slot.status === "ACTIVE" &&
              slot.semesterId === query.semesterId &&
              slot.studentUid &&
              slot.activeEnrollmentId &&
              (!query.studentUid || slot.studentUid === query.studentUid),
          );
        const enrollmentPaths = [
          ...new Set(slots.map((slot) => enrollmentPath(slot.activeEnrollmentId))),
        ];
        const enrollmentDocuments = await transaction.getAll(enrollmentPaths);
        const enrollmentByPath = new Map(
          enrollmentPaths.map((path, index) => [path, enrollmentDocuments[index]]),
        );
        const classPaths = [
          ...new Set(
            enrollmentDocuments
              .map((document) => String(document.data?.classId || ""))
              .filter(Boolean)
              .map(classPath),
          ),
        ];
        const classDocuments = await transaction.getAll(classPaths);
        const classByPath = new Map(
          classPaths.map((path, index) => [path, classDocuments[index]]),
        );
        activeStudents = slots
          .map((slot) => {
            const enrollmentDocument = enrollmentByPath.get(
              enrollmentPath(slot.activeEnrollmentId),
            );
            const enrollment = enrollmentDocument?.data || {};
            const classDocument = classByPath.get(classPath(enrollment.classId));
            const semesterClass = classDocument?.data || {};
            return { slot, enrollmentDocument, enrollment, classDocument, semesterClass };
          })
          .filter(
            ({ slot, enrollmentDocument, enrollment, classDocument, semesterClass }) =>
              enrollmentDocument?.exists &&
              classDocument?.exists &&
              enrollment.enrollmentId === slot.activeEnrollmentId &&
              enrollment.studentUid === slot.studentUid &&
              enrollment.semesterId === query.semesterId &&
              enrollment.enrollmentStatus === "ACTIVE" &&
              semesterClass.classId === enrollment.classId &&
              semesterClass.semesterId === query.semesterId &&
              semesterClass.status === "ACTIVE",
          )
          .map(({ enrollment, semesterClass }) => ({
            studentUid: enrollment.studentUid,
            enrollmentId: enrollment.enrollmentId,
            classId: enrollment.classId,
            enrollmentSnapshot: buildEnrollmentSnapshot(
              enrollment,
              semesterClass,
            ),
          }))
          .sort((left, right) => {
            const leftSnapshot = left.enrollmentSnapshot || {};
            const rightSnapshot = right.enrollmentSnapshot || {};
            return (
              Number(leftSnapshot.grade || 0) - Number(rightSnapshot.grade || 0) ||
              Number(leftSnapshot.classNumber || 0) - Number(rightSnapshot.classNumber || 0) ||
              Number(leftSnapshot.studentNumber || 0) - Number(rightSnapshot.studentNumber || 0) ||
              String(leftSnapshot.displayName || "").localeCompare(String(rightSnapshot.displayName || ""), "ko")
            );
          });

        nextCursor = encodeGradeQueueCursor({
          recordId: recordPage.cursorId,
          attemptId: attemptPage.cursorId,
          slotId: slotPage.cursorId,
          recordsDone: recordPage.done,
          attemptsDone: attemptPage.done,
          slotsDone: slotPage.done,
        });
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
        status: archivedView ? "ARCHIVED" : projected.length > 0 || pendingSources.length > 0 || activeStudents.length > 0 || nextCursor ? "CONTENT" : "EMPTY",
        records: projected,
        pendingSources,
        activeStudents,
        detail,
        nextCursor,
        reason: "",
        writeCount: 0,
      };
    });
  };

  return { getGradeEvidenceState };
};

const createGradeCallableExports = ({ core }) => ({
  getGradeEvidenceState: onCall({ region: REGION }, (request) => core.getGradeEvidenceState(request)),
});

const versionEvidenceMatches = (version) => {
  if (
    version.schemaVersion !== GRADE_SCHEMA_VERSION ||
    version.policyVersion !== GRADE_POLICY_VERSION ||
    !SUPPORTED_RUBRIC_VERSIONS.includes(version.rubricVersion) ||
    !GRADE_SCORE_KINDS.includes(version.scoreKind)
  )
    return false;
  if (!Array.isArray(version.items) || version.items.length < 1) return false;
  let items;
  try {
    items = normalizeItems(version.items);
  } catch {
    return false;
  }
  const summary = summarizeItems(items);
  const expectedHash = evidenceHashFor({ ...version, items });
  return (
    expectedHash === version.evidenceHash &&
    summary.totalScore === Number(version.totalScore) &&
    summary.totalMaxScore === Number(version.totalMaxScore) &&
    summary.percent === Number(version.percent)
  );
};

const createGradeReadinessAdapter = () => ({
  evaluate: async ({ transaction, manifest }) => {
    const semesterId = String(manifest?.semesterId || "").trim();
    const boundedFailure = (scope, observedAtLeast, maximum) => [
      {
        checkId: "grade_evidence_readiness",
        label: "Grade and evidence readiness",
        category: "GRADE_EVIDENCE",
        required: true,
        status: "FAIL",
        evidence: `applicability=UNKNOWN; boundedOverflow=${scope}; observedAtLeast=${observedAtLeast}; maximum=${maximum}`,
        failureReason: "GRADE_EVIDENCE_READINESS_BOUNDED_LIMIT_EXCEEDED",
        ownerWave: "W6B",
      },
    ];
    const queryBounded = async (collectionPath, maximum) =>
      transaction.query(collectionPath, {
        field: "semesterId",
        operator: "==",
        value: semesterId,
        limit: maximum + 1,
      });
    const records = await transaction.query(GRADE_RECORD_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: semesterId,
      limit: GRADE_READINESS_BOUNDS.records + 1,
    });
    if (records.length > GRADE_READINESS_BOUNDS.records) {
      return boundedFailure(
        GRADE_RECORD_COLLECTION,
        records.length,
        GRADE_READINESS_BOUNDS.records,
      );
    }
    const versions = await queryBounded(
      GRADE_VERSION_COLLECTION,
      GRADE_READINESS_BOUNDS.versions,
    );
    if (versions.length > GRADE_READINESS_BOUNDS.versions) {
      return boundedFailure(
        GRADE_VERSION_COLLECTION,
        versions.length,
        GRADE_READINESS_BOUNDS.versions,
      );
    }
    const requests = await queryBounded(
      GRADE_REQUEST_COLLECTION,
      GRADE_READINESS_BOUNDS.requests,
    );
    if (requests.length > GRADE_READINESS_BOUNDS.requests) {
      return boundedFailure(
        GRADE_REQUEST_COLLECTION,
        requests.length,
        GRADE_READINESS_BOUNDS.requests,
      );
    }
    const attestations = await queryBounded(
      GRADE_ATTESTATION_COLLECTION,
      GRADE_READINESS_BOUNDS.attestations,
    );
    if (attestations.length > GRADE_READINESS_BOUNDS.attestations) {
      return boundedFailure(
        GRADE_ATTESTATION_COLLECTION,
        attestations.length,
        GRADE_READINESS_BOUNDS.attestations,
      );
    }
    const legacyIssues = await queryBounded(
      GRADE_LEGACY_ISSUE_COLLECTION,
      GRADE_READINESS_BOUNDS.legacyIssues,
    );
    if (legacyIssues.length > GRADE_READINESS_BOUNDS.legacyIssues) {
      return boundedFailure(
        GRADE_LEGACY_ISSUE_COLLECTION,
        legacyIssues.length,
        GRADE_READINESS_BOUNDS.legacyIssues,
      );
    }
    const totalCoreDocuments =
      records.length +
      versions.length +
      requests.length +
      attestations.length +
      legacyIssues.length;
    if (totalCoreDocuments > GRADE_READINESS_BOUNDS.totalCoreDocuments) {
      return boundedFailure(
        "grade_core_documents",
        totalCoreDocuments,
        GRADE_READINESS_BOUNDS.totalCoreDocuments,
      );
    }
    const enrollmentIds = [
      ...new Set(
        records
          .map((document) => String(document.data?.enrollmentId || ""))
          .filter(Boolean),
      ),
    ];
    const assessmentAttemptIds = [
      ...new Set(
        records
          .filter(
            (document) =>
              document.data?.sourceKind === "ASSESSMENT_RESULT",
          )
          .map((document) => String(document.data?.sourceId || ""))
          .filter(Boolean),
      ),
    ];
    const initialDependencyCount =
      enrollmentIds.length + assessmentAttemptIds.length * 3;
    if (
      initialDependencyCount > GRADE_READINESS_BOUNDS.dependencyDocuments
    ) {
      return boundedFailure(
        "grade_dependency_documents",
        initialDependencyCount,
        GRADE_READINESS_BOUNDS.dependencyDocuments,
      );
    }
    const enrollments = enrollmentIds.length
      ? await transaction.getAll(enrollmentIds.map(enrollmentPath))
      : [];
    const classIds = [
      ...new Set(
        enrollments
          .map((document) => String(document.data?.classId || ""))
          .filter(Boolean),
      ),
    ];
    const totalDependencyDocuments =
      initialDependencyCount + classIds.length;
    if (
      totalDependencyDocuments > GRADE_READINESS_BOUNDS.dependencyDocuments
    ) {
      return boundedFailure(
        "grade_dependency_documents",
        totalDependencyDocuments,
        GRADE_READINESS_BOUNDS.dependencyDocuments,
      );
    }
    const classes = classIds.length
      ? await transaction.getAll(classIds.map(classPath))
      : [];
    const attempts = assessmentAttemptIds.length
      ? await transaction.getAll(assessmentAttemptIds.map(attemptPath))
      : [];
    const submissions = assessmentAttemptIds.length
      ? await transaction.getAll(assessmentAttemptIds.map(submissionPath))
      : [];
    const results = assessmentAttemptIds.length
      ? await transaction.getAll(assessmentAttemptIds.map(resultPath))
      : [];
    const byId = (documents, key) => new Map(documents.map((document) => [String(document.data?.[key] || document.path.split("/").at(-1) || ""), document]));
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
      return (
        version.schemaVersion !== GRADE_SCHEMA_VERSION ||
        version.policyVersion !== GRADE_POLICY_VERSION ||
        !SUPPORTED_RUBRIC_VERSIONS.includes(version.rubricVersion) ||
        !GRADE_SCORE_KINDS.includes(version.scoreKind)
      );
    }).length;

    const dependencyRecords = [];
    for (const document of records) {
      const record = document.data || {};
      if (
        record.schemaVersion !== GRADE_SCHEMA_VERSION ||
        record.policyVersion !== GRADE_POLICY_VERSION ||
        record.semesterId !== semesterId ||
        record.recordId !== document.path.split("/").at(-1)
      )
        invalidSchemaCount += 1;
      if (
        record.policyVersion !== GRADE_POLICY_VERSION ||
        !SUPPORTED_RUBRIC_VERSIONS.includes(record.rubricVersion) ||
        !GRADE_SCORE_KINDS.includes(record.scoreKind)
      )
        unsupportedVersionCount += 1;
      if (logicalKeys.has(record.logicalKey)) duplicateLogicalKeyCount += 1;
      logicalKeys.add(record.logicalKey);
      const version = versionById.get(record.currentVersionId);
      if (
        !version ||
        version.data?.recordId !== record.recordId ||
        Number(version.data?.gradeRevision || 0) !== Number(record.gradeRevision || 0) ||
        version.data?.evidenceHash !== record.evidenceHash ||
        canonicalJson(version.data?.enrollmentSnapshot) !== canonicalJson(record.enrollmentSnapshot) ||
        Number(version.data?.totalScore) !== Number(record.totalScore) ||
        Number(version.data?.totalMaxScore) !== Number(record.totalMaxScore) ||
        Number(version.data?.percent) !== Number(record.percent) ||
        !versionEvidenceMatches(version.data || {})
      )
        invalidVersionCount += 1;
      const enrollment = enrollmentById.get(record.enrollmentId);
      const semesterClass = classById.get(record.classId);
      if (
        !enrollment ||
        !semesterClass ||
        enrollment.data?.studentUid !== record.studentUid ||
        enrollment.data?.semesterId !== semesterId ||
        enrollment.data?.classId !== record.classId ||
        semesterClass.data?.semesterId !== semesterId ||
        canonicalJson(record.enrollmentSnapshot) !== canonicalJson(buildEnrollmentSnapshot(enrollment.data || {}, semesterClass.data || {}))
      )
        orphanEnrollmentCount += 1;
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
        const currentSignature = attestationRows.find(
          (attestation) =>
            attestation.type === "SIGNATURE" &&
            attestation.recordId === record.recordId &&
            attestation.versionId === record.currentVersionId &&
            Number(attestation.gradeRevision || 0) === Number(record.gradeRevision || 0) &&
            attestation.evidenceHash === record.evidenceHash,
        );
        const signatureValid = record.signatureRequired !== true || (currentSignature && record.signedAttestationId === currentSignature.attestationId);
        if (!record.officialVersionId || record.officialVersionId !== record.currentVersionId || !signatureValid) {
          invalidOfficialCount += 1;
        }
      } else if (
        record.status === "OFFICIAL_PENDING_SIGNATURE" &&
        (record.signatureRequired !== true || record.officialVersionId !== null || record.signedAttestationId !== null)
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
      return (
        request.schemaVersion !== GRADE_SCHEMA_VERSION ||
        request.policyVersion !== GRADE_POLICY_VERSION ||
        request.requestId !== document.path.split("/").at(-1) ||
        request.semesterId !== semesterId ||
        !["OBJECTION", "ANSWER_SHEET"].includes(request.requestKind) ||
        !["PENDING", "ACCEPTED", "REJECTED"].includes(request.status) ||
        !record.recordId ||
        record.studentUid !== request.studentUid ||
        !version.versionId ||
        version.recordId !== request.recordId ||
        Number(version.gradeRevision || 0) !== Number(request.gradeRevision || 0) ||
        version.evidenceHash !== request.evidenceHash
      );
    }).length;
    const invalidAttestationCount = attestations.filter((document) => {
      const attestation = document.data || {};
      const record = recordById.get(attestation.recordId)?.data || {};
      const version = versionById.get(attestation.versionId)?.data || {};
      return (
        attestation.schemaVersion !== GRADE_SCHEMA_VERSION ||
        attestation.policyVersion !== GRADE_POLICY_VERSION ||
        attestation.attestationId !== document.path.split("/").at(-1) ||
        attestation.semesterId !== semesterId ||
        !["ACKNOWLEDGEMENT", "SIGNATURE"].includes(attestation.type) ||
        attestation.statementVersion !== GRADE_STATEMENT_VERSION ||
        !record.recordId ||
        record.studentUid !== attestation.studentUid ||
        !version.versionId ||
        version.recordId !== attestation.recordId ||
        Number(version.gradeRevision || 0) !== Number(attestation.gradeRevision || 0) ||
        version.evidenceHash !== attestation.evidenceHash ||
        (attestation.type === "SIGNATURE" && (typeof attestation.signatureName !== "string" || !/^[a-f0-9]{64}$/.test(String(attestation.signatureHash || ""))))
      );
    }).length;
    const pendingRequestCount = requests.filter((document) => document.data?.status === "PENDING").length;
    const blockingLegacyIssues = legacyIssues.filter((document) => !["RESOLVED", "DISMISSED"].includes(String(document.data?.status || "OPEN")));
    const invalidCount =
      invalidSchemaCount +
      duplicateLogicalKeyCount +
      invalidVersionCount +
      invalidSourceCount +
      orphanEnrollmentCount +
      invalidOfficialCount +
      unsupportedVersionCount +
      orphanRequestCount +
      orphanAttestationCount +
      invalidRequestCount +
      invalidAttestationCount +
      pendingRequestCount +
      blockingLegacyIssues.length;
    const dependencyHash = sha256(
      canonicalJson({
        records: dependencyRecords.sort((left, right) => left.recordId.localeCompare(right.recordId)),
        requests: requests
          .map((document) => ({
            requestId: document.data?.requestId,
            recordId: document.data?.recordId,
            gradeRevision: Number(document.data?.gradeRevision || 0),
            status: document.data?.status,
          }))
          .sort((left, right) => String(left.requestId).localeCompare(String(right.requestId))),
        attestations: attestations
          .map((document) => ({
            attestationId: document.data?.attestationId,
            recordId: document.data?.recordId,
            gradeRevision: Number(document.data?.gradeRevision || 0),
            type: document.data?.type,
            evidenceHash: document.data?.evidenceHash,
          }))
          .sort((left, right) => String(left.attestationId).localeCompare(String(right.attestationId))),
        legacyIssues: legacyIssues
          .map((document) => ({
            issueId: document.path.split("/").at(-1),
            status: document.data?.status || "OPEN",
          }))
          .sort((left, right) => String(left.issueId).localeCompare(String(right.issueId))),
      }),
    );
    return [
      {
        checkId: "grade_evidence_readiness",
        label: "Grade and evidence readiness",
        category: "GRADE_EVIDENCE",
        required: true,
        status: invalidCount === 0 ? "PASS" : "FAIL",
        evidence: `applicability=${records.length === 0 ? "NOT_APPLICABLE" : "APPLICABLE"}; records=${records.length}; versions=${versions.length}; invalidSchema=${invalidSchemaCount}; unsupportedVersions=${unsupportedVersionCount}; duplicateLogicalKeys=${duplicateLogicalKeyCount}; invalidVersions=${invalidVersionCount}; invalidSources=${invalidSourceCount}; orphanEnrollments=${orphanEnrollmentCount}; invalidOfficial=${invalidOfficialCount}; orphanRequests=${orphanRequestCount}; orphanAttestations=${orphanAttestationCount}; invalidRequests=${invalidRequestCount}; invalidAttestations=${invalidAttestationCount}; pendingRequests=${pendingRequestCount}; blockingLegacyIssues=${blockingLegacyIssues.length}; dependency=${dependencyHash}`,
        failureReason: invalidCount === 0 ? null : "GRADE_EVIDENCE_READINESS_NOT_PASS",
        ownerWave: "W6B",
      },
    ];
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
