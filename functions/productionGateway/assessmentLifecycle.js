const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const semesterCore = require("./semesterCore");
const archiveEnrollment = require("./archiveEnrollment");
const cutoverAuthorization = require("./cutoverAuthorization");
const sessionAuthority = require("./sessionAuthority");
const { onCallWithStudentMaintenance: onCall } = require("./studentMaintenance");
const historyExemptions = require("./historyClassroomExemptions");
const learning = require("./assessmentLearning");

const REGION = "asia-northeast3";
const ASSESSMENT_SCHEMA_VERSION = 1;
const ASSESSMENT_POLICY_VERSION = "w6a-v1";
const DEFINITION_COLLECTION = "semester_assessment_definitions";
const ATTEMPT_COLLECTION = "semester_assessment_attempts";
const SUBMISSION_COLLECTION = "semester_assessment_submissions";
const RESULT_COLLECTION = "semester_assessment_results";
const LEGACY_ISSUE_COLLECTION = "assessment_legacy_issues";

const ASSESSMENT_COMMAND_TYPES = Object.freeze({
  ...historyExemptions.COMMAND_TYPES,
  LOCK_HISTORY_CLASSROOM_ATTEMPT: "lockHistoryClassroomAttempt",
  CREATE_ASSESSMENT_DEFINITION: "createAssessmentDefinition",
  UPDATE_ASSESSMENT_DEFINITION: "updateAssessmentDefinition",
  TRANSITION_ASSESSMENT_DEFINITION: "transitionAssessmentDefinition",
  SAVE_QUIZ_ASSESSMENT_SETTINGS: "saveQuizAssessmentSettings",
  START_ASSESSMENT_ATTEMPT: "startAssessmentAttempt",
  SUBMIT_ASSESSMENT_ATTEMPT: "submitAssessmentAttempt",
  RESET_ASSESSMENT_ATTEMPTS_BY_CLASS: "resetAssessmentAttemptsByClassV2",
  RESET_ASSESSMENT_ATTEMPT: "resetAssessmentAttempt",
  UPSERT_QUIZ_QUESTION: "upsertQuizQuestion",
  DELETE_QUIZ_QUESTION: "deleteQuizQuestion",
  UPSERT_HISTORY_CLASSROOM_SOURCE: "upsertHistoryClassroomSource",
  SAVE_HISTORY_CLASSROOM_ASSIGNMENT: "saveHistoryClassroomAssignment",
  DELETE_HISTORY_CLASSROOM_SOURCE: "deleteHistoryClassroomSource",
  UPDATE_MAP_RESOURCE_BLANKS: "updateMapResourceBlanks",
});

const STUDENT_COMMAND_TYPES = new Set([
  ASSESSMENT_COMMAND_TYPES.CREATE_HISTORY_CLASSROOM_EXEMPTION_REQUEST,
  ASSESSMENT_COMMAND_TYPES.LOCK_HISTORY_CLASSROOM_ATTEMPT,
  ASSESSMENT_COMMAND_TYPES.START_ASSESSMENT_ATTEMPT,
  ASSESSMENT_COMMAND_TYPES.SUBMIT_ASSESSMENT_ATTEMPT,
]);

const fail = (code, message, reason, details = {}) => {
  throw new HttpsError(code, message, { reason, ...details });
};

const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const assertAllowedKeys = (value, keys, label) => {
  if (!isPlainObject(value)) {
    fail("invalid-argument", `${label} must be an object.`, "ASSESSMENT_PAYLOAD_INVALID");
  }
  const unexpected = Object.keys(value).filter((key) => !keys.includes(key));
  if (unexpected.length) {
    fail("invalid-argument", `${label} contains unsupported fields.`, "ASSESSMENT_PAYLOAD_INVALID", { fields: unexpected });
  }
};

const text = (value, label, max = 160) => {
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > max) {
    fail("invalid-argument", `${label} is invalid.`, "ASSESSMENT_PAYLOAD_INVALID", { field: label });
  }
  return value;
};

const optionalText = (value, label, max = 160) =>
  value === undefined || value === null || value === "" ? "" : text(value, label, max);

const positiveInteger = (value, label, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    fail("invalid-argument", `${label} is invalid.`, "ASSESSMENT_PAYLOAD_INVALID", { field: label });
  }
  return value;
};

const nonNegativeInteger = (value, label, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    fail("invalid-argument", `${label} is invalid.`, "ASSESSMENT_PAYLOAD_INVALID", { field: label });
  }
  return value;
};

const normalizeSemesterId = (value) => semesterCore.normalizeSemesterId(value);
const normalizeKind = (value) => {
  if (value !== "QUIZ" && value !== "HISTORY_CLASSROOM") {
    fail("invalid-argument", "assessmentKind is invalid.", "ASSESSMENT_KIND_INVALID");
  }
  return value;
};

const normalizeAnswers = (value) => {
  if (!isPlainObject(value)) {
    fail("invalid-argument", "answers must be an object.", "ASSESSMENT_ANSWERS_INVALID");
  }
  const entries = Object.entries(value);
  if (entries.length > 300) {
    fail("invalid-argument", "answers contains too many entries.", "ASSESSMENT_ANSWERS_INVALID");
  }
  return Object.fromEntries(entries.map(([key, answer]) => [
    text(String(key), "answer key", 160),
    typeof answer === "string" && answer.length <= 20_000
      ? answer
      : fail("invalid-argument", "answer is invalid.", "ASSESSMENT_ANSWERS_INVALID"),
  ]));
};

const normalizeJsonDocument = (value, allowedKeys, label, maxBytes = 900_000) => {
  assertAllowedKeys(value, allowedKeys, label);
  let normalized;
  try {
    normalized = JSON.parse(JSON.stringify(value));
  } catch {
    fail("invalid-argument", `${label} must be JSON-compatible.`, "ASSESSMENT_PAYLOAD_INVALID");
  }
  const serialized = canonicalJson(normalized);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    fail("invalid-argument", `${label} is too large.`, "ASSESSMENT_PAYLOAD_INVALID");
  }
  return normalized;
};

const normalizePresentationSettings = (value) => {
  const normalized = normalizeJsonDocument(value, [
    "active",
    "questionCount",
    "randomOrder",
    "questionOrder",
    "timeLimit",
    "allowRetake",
    "cooldown",
    "hintLimit",
    "visibleTargetGrade",
    "visibleClassIds",
    "visibilityVersion",
  ], "presentationSettings", 20_000);
  if (
    typeof normalized.active !== "boolean"
    || typeof normalized.randomOrder !== "boolean"
    || typeof normalized.allowRetake !== "boolean"
    || !["random", "created", "unit"].includes(normalized.questionOrder)
    || !Array.isArray(normalized.visibleClassIds)
    || normalized.visibleClassIds.length > 100
  ) {
    fail("invalid-argument", "presentationSettings is invalid.", "ASSESSMENT_PAYLOAD_INVALID");
  }
  const visibleClassIds = normalized.visibleClassIds.map((item) =>
    text(item, "visibleClassId", 180));
  if (new Set(visibleClassIds).size !== visibleClassIds.length) {
    fail("invalid-argument", "presentationSettings has duplicate class ids.", "ASSESSMENT_PAYLOAD_INVALID");
  }
  return {
    ...normalized,
    questionCount: positiveInteger(normalized.questionCount, "presentationSettings.questionCount", 200),
    timeLimit: positiveInteger(normalized.timeLimit, "presentationSettings.timeLimit", 21_600),
    cooldown: nonNegativeInteger(normalized.cooldown, "presentationSettings.cooldown", 43_200),
    hintLimit: nonNegativeInteger(normalized.hintLimit, "presentationSettings.hintLimit", 200),
    visibleTargetGrade: text(normalized.visibleTargetGrade, "presentationSettings.visibleTargetGrade", 40),
    visibleClassIds,
    visibilityVersion: positiveInteger(normalized.visibilityVersion, "presentationSettings.visibilityVersion", 100),
  };
};

const normalizeLegacyConfigKey = (value) => {
  const normalized = text(value, "legacyConfigKey", 180);
  if (
    ["__proto__", "prototype", "constructor"].includes(normalized)
    || /[\/\\\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    fail("invalid-argument", "legacyConfigKey is invalid.", "ASSESSMENT_PAYLOAD_INVALID");
  }
  return normalized;
};

const normalizeDefinitionId = (value) => {
  const normalized = text(value, "definitionId", 180);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,179}$/.test(normalized)) {
    fail("invalid-argument", "definitionId is invalid.", "ASSESSMENT_DEFINITION_ID_INVALID");
  }
  return normalized;
};

const normalizeAttemptId = (value) => {
  const normalized = text(value, "attemptId", 180);
  if (!/^attempt_[a-f0-9]{64}$/.test(normalized)) {
    fail("invalid-argument", "attemptId is invalid.", "ASSESSMENT_ATTEMPT_ID_INVALID");
  }
  return normalized;
};

const normalizeIso = (value, label, allowEmpty = true) => {
  if ((value === "" || value === null || value === undefined) && allowEmpty) return "";
  const normalized = text(value, label, 40);
  const millis = Date.parse(normalized);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== normalized) {
    fail("invalid-argument", `${label} must be an ISO-8601 UTC timestamp.`, "ASSESSMENT_PAYLOAD_INVALID");
  }
  return normalized;
};

const normalizeAssessmentPayload = (commandType, rawPayload) => {
  if (commandType === ASSESSMENT_COMMAND_TYPES.SAVE_QUIZ_ASSESSMENT_SETTINGS) {
    const { expectedRevision, expectedSourceHash, reason, ...definitionInput } = rawPayload || {};
    const definition = normalizeAssessmentPayload(ASSESSMENT_COMMAND_TYPES.CREATE_ASSESSMENT_DEFINITION, definitionInput);
    if (definition.assessmentKind !== "QUIZ" || definition.cutoverPlanId || definition.cutoverOperationKey) {
      fail("invalid-argument", "Only current quiz settings can be saved together.", "ASSESSMENT_PAYLOAD_INVALID");
    }
    const settings = definition.presentationSettings;
    if (definition.questionCount !== settings.questionCount || definition.durationSeconds !== settings.timeLimit
      || definition.maxAttempts !== (settings.allowRetake ? 20 : 1) || definition.cooldownMinutes !== settings.cooldown
      || canonicalJson([...definition.assignedClassIds].sort()) !== canonicalJson([...settings.visibleClassIds].sort())) {
      fail("invalid-argument", "Quiz settings and response policy must agree.", "ASSESSMENT_PAYLOAD_INVALID");
    }
    if (settings.active && !settings.visibleClassIds.length) {
      fail("invalid-argument", "공개할 학급을 선택해 주세요.", "ASSESSMENT_CLASS_NOT_ASSIGNED");
    }
    if (expectedSourceHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedSourceHash)) {
      fail("invalid-argument", "expectedSourceHash is invalid.", "ASSESSMENT_PAYLOAD_INVALID");
    }
    return { ...definition, expectedRevision: nonNegativeInteger(expectedRevision, "expectedRevision"),
      ...(expectedSourceHash !== undefined ? { expectedSourceHash } : {}), reason: text(reason, "reason", 300) };
  }
  if (Object.values(historyExemptions.COMMAND_TYPES).includes(commandType))
    return historyExemptions.normalizePayload(commandType, rawPayload);
  if (commandType === ASSESSMENT_COMMAND_TYPES.LOCK_HISTORY_CLASSROOM_ATTEMPT) {
    assertAllowedKeys(rawPayload, ["attemptId", "reason"], "lockHistoryClassroomAttempt payload");
    if (!["VISIBILITY_HIDDEN", "NAVIGATION"].includes(rawPayload.reason))
      fail("invalid-argument", "Lock reason is invalid.", "ASSESSMENT_LOCK_REASON_INVALID");
    return { attemptId: normalizeAttemptId(rawPayload.attemptId), reason: rawPayload.reason };
  }
  const payload = rawPayload || {};
  if (
    commandType === ASSESSMENT_COMMAND_TYPES.CREATE_ASSESSMENT_DEFINITION
    || commandType === ASSESSMENT_COMMAND_TYPES.UPDATE_ASSESSMENT_DEFINITION
  ) {
    const definitionKeys = ["definitionId", "semesterId", "assessmentKind", "title", "sourceId", "category", "examRound", "questionCount", "durationSeconds", "maxAttempts", "cooldownMinutes", "opensAt", "closesAt", "assignedClassIds", "legacyConfigKey", "presentationSettings", "expectedRevision", "expectedSourceRevision", "reason"];
    if (commandType === ASSESSMENT_COMMAND_TYPES.CREATE_ASSESSMENT_DEFINITION) definitionKeys.push("cutoverPlanId", "cutoverOperationKey");
    assertAllowedKeys(payload, definitionKeys, "assessment definition payload");
    if (payload.expectedSourceRevision !== undefined && payload.assessmentKind !== "HISTORY_CLASSROOM") {
      fail("invalid-argument", "expectedSourceRevision is only supported for History Classroom.", "ASSESSMENT_PAYLOAD_INVALID");
    }
    if (commandType === ASSESSMENT_COMMAND_TYPES.CREATE_ASSESSMENT_DEFINITION && Boolean(payload.cutoverPlanId) !== Boolean(payload.cutoverOperationKey)) {
      fail("invalid-argument", "cutoverPlanId and cutoverOperationKey must be provided together.", "ASSESSMENT_PAYLOAD_INVALID");
    }
    const assignedClassIds = Array.isArray(payload.assignedClassIds)
      ? payload.assignedClassIds.map((item) => text(String(item), "assignedClassId", 180))
      : fail("invalid-argument", "assignedClassIds must be an array.", "ASSESSMENT_PAYLOAD_INVALID");
    if (assignedClassIds.length > 100 || new Set(assignedClassIds).size !== assignedClassIds.length) {
      fail("invalid-argument", "assignedClassIds is invalid.", "ASSESSMENT_PAYLOAD_INVALID");
    }
    const opensAt = normalizeIso(payload.opensAt, "opensAt");
    const closesAt = normalizeIso(payload.closesAt, "closesAt");
    if (opensAt && closesAt && Date.parse(opensAt) >= Date.parse(closesAt)) {
      fail("invalid-argument", "opensAt must precede closesAt.", "ASSESSMENT_WINDOW_INVALID");
    }
    return {
      definitionId: normalizeDefinitionId(payload.definitionId),
      semesterId: normalizeSemesterId(payload.semesterId),
      assessmentKind: normalizeKind(payload.assessmentKind),
      ...(payload.expectedSourceRevision !== undefined
        ? { expectedSourceRevision: nonNegativeInteger(payload.expectedSourceRevision, "expectedSourceRevision") }
        : {}),
      title: text(payload.title, "title", 200),
      sourceId: text(payload.sourceId, "sourceId", 180),
      category: optionalText(payload.category, "category", 80),
      examRound: optionalText(payload.examRound, "examRound", 80),
      questionCount: payload.questionCount === undefined
        ? 0
        : positiveInteger(payload.questionCount, "questionCount", 200),
      durationSeconds: positiveInteger(payload.durationSeconds, "durationSeconds", 21_600),
      maxAttempts: positiveInteger(payload.maxAttempts, "maxAttempts", 20),
      cooldownMinutes: nonNegativeInteger(payload.cooldownMinutes, "cooldownMinutes", 43_200),
      opensAt,
      closesAt,
      assignedClassIds,
      legacyConfigKey: payload.assessmentKind === "QUIZ"
        ? normalizeLegacyConfigKey(payload.legacyConfigKey)
        : "",
      presentationSettings: payload.assessmentKind === "QUIZ"
        ? normalizePresentationSettings(payload.presentationSettings)
        : null,
      ...(commandType === ASSESSMENT_COMMAND_TYPES.CREATE_ASSESSMENT_DEFINITION && payload.cutoverPlanId && payload.cutoverOperationKey
        ? { cutoverPlanId: text(payload.cutoverPlanId, "cutoverPlanId", 80), cutoverOperationKey: text(payload.cutoverOperationKey, "cutoverOperationKey", 80) }
        : {}),
      ...(commandType === ASSESSMENT_COMMAND_TYPES.UPDATE_ASSESSMENT_DEFINITION
        ? {
            expectedRevision: positiveInteger(payload.expectedRevision, "expectedRevision"),
            reason: text(payload.reason, "reason", 300),
          }
        : {}),
    };
  }
  if (commandType === ASSESSMENT_COMMAND_TYPES.TRANSITION_ASSESSMENT_DEFINITION) {
    assertAllowedKeys(payload, ["definitionId", "expectedRevision", "expectedSourceRevision", "targetStatus", "reason"], "transitionAssessmentDefinition payload");
    if (!["PUBLISHED", "PAUSED", "CLOSED"].includes(payload.targetStatus)) {
      fail("invalid-argument", "targetStatus is invalid.", "ASSESSMENT_STATUS_INVALID");
    }
    if (payload.expectedSourceRevision !== undefined && payload.targetStatus !== "PUBLISHED") {
      fail("invalid-argument", "expectedSourceRevision is only supported when publishing.", "ASSESSMENT_PAYLOAD_INVALID");
    }
    return {
      definitionId: normalizeDefinitionId(payload.definitionId),
      expectedRevision: positiveInteger(payload.expectedRevision, "expectedRevision"),
      ...(payload.expectedSourceRevision !== undefined
        ? { expectedSourceRevision: nonNegativeInteger(payload.expectedSourceRevision, "expectedSourceRevision") }
        : {}),
      targetStatus: payload.targetStatus,
      reason: text(payload.reason, "reason", 300),
    };
  }
  if (commandType === ASSESSMENT_COMMAND_TYPES.START_ASSESSMENT_ATTEMPT) {
    assertAllowedKeys(payload, ["definitionId"], "startAssessmentAttempt payload");
    return {
      definitionId: normalizeDefinitionId(payload.definitionId),
    };
  }
  if (commandType === ASSESSMENT_COMMAND_TYPES.SUBMIT_ASSESSMENT_ATTEMPT) {
    assertAllowedKeys(payload, ["attemptId", "expectedRevision", "answers", "submitReason", "analytics"], "submitAssessmentAttempt payload");
    if (!["STUDENT", "TIMEOUT"].includes(payload.submitReason)) {
      fail("invalid-argument", "submitReason is invalid.", "ASSESSMENT_SUBMIT_REASON_INVALID");
    }
    return {
      attemptId: normalizeAttemptId(payload.attemptId),
      expectedRevision: positiveInteger(payload.expectedRevision, "expectedRevision"),
      answers: normalizeAnswers(payload.answers),
      submitReason: payload.submitReason,
      ...(payload.analytics !== undefined ? { analytics: learning.normalizeAnalytics(payload.analytics) } : {}),
    };
  }
  if (commandType === ASSESSMENT_COMMAND_TYPES.RESET_ASSESSMENT_ATTEMPTS_BY_CLASS) {
    assertAllowedKeys(payload, ["definitionId", "classId", "reason"], "resetAssessmentAttemptsByClassV2 payload");
    return {
      definitionId: normalizeDefinitionId(payload.definitionId),
      classId: text(payload.classId, "classId", 180),
      reason: text(payload.reason, "reason", 300),
    };
  }
  if (commandType === ASSESSMENT_COMMAND_TYPES.RESET_ASSESSMENT_ATTEMPT) {
    assertAllowedKeys(payload, ["definitionId", "studentUid", "reason"], "resetAssessmentAttempt payload");
    return {
      definitionId: normalizeDefinitionId(payload.definitionId),
      studentUid: text(payload.studentUid, "studentUid", 160),
      reason: text(payload.reason, "reason", 300),
    };
  }
  if (commandType === ASSESSMENT_COMMAND_TYPES.UPSERT_QUIZ_QUESTION) {
    assertAllowedKeys(payload, ["semesterId", "questionId", "question", "expectedRevision", "reason"], "upsertQuizQuestion payload");
    const questionId = text(payload.questionId, "questionId", 160);
    const question = normalizeJsonDocument(payload.question, [
      "id", "unitId", "subUnitId", "category", "type", "question", "answer",
      "options", "choiceOptionImages", "matchingPairs", "explanation", "image",
      "passage", "hintEnabled", "hint", "refBig", "refMid", "refSmall",
      "concepts", "cognitiveProcess", "familyId", "derivedFromQuestionId", "misconceptionTags", "reviewLessonId",
    ], "question");
    if (String(question.id) !== questionId || !question.unitId || !question.category || !question.type || !question.question) {
      fail("invalid-argument", "question identity is invalid.", "ASSESSMENT_QUESTION_INVALID");
    }
    return {
      semesterId: normalizeSemesterId(payload.semesterId),
      questionId,
      question: { ...question, ...(["concepts", "cognitiveProcess", "familyId", "derivedFromQuestionId", "misconceptionTags", "reviewLessonId"].some(key => Object.hasOwn(question, key)) ? learning.normalizeQuestionLearning(question) : {}) },
      expectedRevision: nonNegativeInteger(payload.expectedRevision, "expectedRevision"),
      reason: text(payload.reason, "reason", 300),
    };
  }
  if (commandType === ASSESSMENT_COMMAND_TYPES.DELETE_QUIZ_QUESTION) {
    assertAllowedKeys(payload, ["semesterId", "questionId", "expectedRevision", "reason"], "deleteQuizQuestion payload");
    return {
      semesterId: normalizeSemesterId(payload.semesterId),
      questionId: text(payload.questionId, "questionId", 160),
      expectedRevision: nonNegativeInteger(payload.expectedRevision, "expectedRevision"),
      reason: text(payload.reason, "reason", 300),
    };
  }
  if ([ASSESSMENT_COMMAND_TYPES.UPSERT_HISTORY_CLASSROOM_SOURCE, ASSESSMENT_COMMAND_TYPES.SAVE_HISTORY_CLASSROOM_ASSIGNMENT].includes(commandType)) {
    assertAllowedKeys(payload, ["semesterId", "sourceId", "source", "expectedRevision", "reason"], "upsertHistoryClassroomSource payload");
    return {
      semesterId: normalizeSemesterId(payload.semesterId),
      sourceId: text(payload.sourceId, "sourceId", 160),
      source: normalizeJsonDocument(payload.source, [
        "title", "description", "sourceType", "lessonUnitId", "lessonTitle", "lessonUnitPath",
        "mapResourceId", "mapTitle", "pdfPageImages",
        "pdfRegions", "blanks", "answerOptions", "timeLimitMinutes",
        "cooldownMinutes", "passThresholdPercent", "dueWindowDays", "targetGrade",
        "targetClass", "targetStudentUid", "targetStudentUids",
        "targetStudentAccessMap", "targetStudentName", "targetStudentNames",
        "targetStudentReasons", "targetStudentNumber", "isPublished", "publishedAt",
        "dueAt", "retryResetByStudentUid",
      ], "history classroom source"),
      expectedRevision: nonNegativeInteger(payload.expectedRevision, "expectedRevision"),
      reason: text(payload.reason, "reason", 300),
    };
  }
  if (commandType === ASSESSMENT_COMMAND_TYPES.DELETE_HISTORY_CLASSROOM_SOURCE) {
    assertAllowedKeys(payload, ["semesterId", "sourceId", "expectedRevision", "reason"], "deleteHistoryClassroomSource payload");
    return {
      semesterId: normalizeSemesterId(payload.semesterId),
      sourceId: text(payload.sourceId, "sourceId", 160),
      expectedRevision: nonNegativeInteger(payload.expectedRevision, "expectedRevision"),
      reason: text(payload.reason, "reason", 300),
    };
  }
  if (commandType === ASSESSMENT_COMMAND_TYPES.UPDATE_MAP_RESOURCE_BLANKS) {
    assertAllowedKeys(payload, ["semesterId", "mapResourceId", "pdfBlanks", "answerOptions", "expectedRevision", "reason"], "updateMapResourceBlanks payload");
    const mapContent = normalizeJsonDocument(
      { pdfBlanks: payload.pdfBlanks, answerOptions: payload.answerOptions },
      ["pdfBlanks", "answerOptions"],
      "map resource blanks",
    );
    if (!Array.isArray(mapContent.pdfBlanks) || mapContent.pdfBlanks.length > 500) {
      fail("invalid-argument", "pdfBlanks is invalid.", "ASSESSMENT_PAYLOAD_INVALID");
    }
    return {
      semesterId: normalizeSemesterId(payload.semesterId),
      mapResourceId: text(payload.mapResourceId, "mapResourceId", 160),
      pdfBlanks: mapContent.pdfBlanks,
      answerOptions: Array.isArray(mapContent.answerOptions) && mapContent.answerOptions.length <= 500
        ? mapContent.answerOptions.map((item) => text(item, "answerOption", 300))
        : fail("invalid-argument", "answerOptions is invalid.", "ASSESSMENT_PAYLOAD_INVALID"),
      expectedRevision: nonNegativeInteger(payload.expectedRevision, "expectedRevision"),
      reason: text(payload.reason, "reason", 300),
    };
  }
  fail("invalid-argument", "Unsupported assessment commandType.", "COMMAND_TYPE_UNSUPPORTED");
};

const definitionPath = (id) => `${DEFINITION_COLLECTION}/${id}`;
const attemptPath = (id) => `${ATTEMPT_COLLECTION}/${id}`;
const submissionPath = (id) => `${SUBMISSION_COLLECTION}/${id}`;
const resultPath = (id) => `${RESULT_COLLECTION}/${id}`;
const manifestPath = (semesterId) => `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${semesterId}`;
const semesterRoot = (semesterId) => {
  const [year, term] = semesterId.split("-");
  return `years/${year}/semesters/${term}`;
};
const slotPath = (semesterId, uid) => `${archiveEnrollment.ENROLLMENT_SLOT_COLLECTION}/${archiveEnrollment.buildEnrollmentSlotId(semesterId, uid)}`;
const enrollmentPath = (id) => `${archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION}/${id}`;

const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
};
const normalizeAnswer = (value) => String(value ?? "").replace(/\s+/g, "").trim();

const extractQuizQuestion = (document) => {
  const data = document.data || {};
  const id = String(data.id ?? document.path.split("/").at(-1)).trim();
  return {
    id,
    answer: String(data.answer ?? ""),
    sourceRevision: String(data.contentRevision || data.revision || data.updatedAt?.toMillis?.() || "legacy"),
  };
};

const collectHistoryAnswerKey = (data) => {
  const blanks = Array.isArray(data.blanks)
    ? data.blanks
    : Array.isArray(data.pdfRegions)
      ? data.pdfRegions.flatMap((region) => Array.isArray(region?.blanks) ? region.blanks : [])
      : [];
  return blanks.map((blank, index) => ({
    id: String(blank.id || blank.blankId || `blank-${index + 1}`).trim(),
    answer: String(blank.answer || blank.correctAnswer || ""),
  })).filter((item) => item.id);
};

const loadDefinitionSource = async (transaction, payload) => {
  if (payload.assessmentKind === "QUIZ") {
    const documents = await transaction.query(`${semesterRoot(payload.semesterId)}/quiz_questions`, { filters: [
      { field: "unitId", operator: "==", value: payload.sourceId },
      ...(payload.category ? [{ field: "category", operator: "==", value: payload.category }] : []),
    ] });
    const questions = documents
      .filter((document) => !payload.category || String(document.data?.category || "") === payload.category)
      .map(extractQuizQuestion)
      .filter((question) => question.id && question.answer)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!questions.length) {
      fail("failed-precondition", "No canonical quiz questions were found.", "ASSESSMENT_SOURCE_EMPTY");
    }
    return { itemCount: questions.length, answerKey: questions, quizDocuments: documents,
      learningSnapshot: documents.filter(document => questions.some(item => item.id === String(document.data?.id ?? document.path.split("/").at(-1)))).map(learning.questionLearningSnapshot),
      assignedStudentUids: [], sourceHash: sha256(canonicalJson(questions)) };
  }
  const sourcePath = `${semesterRoot(payload.semesterId)}/history_classrooms/${payload.sourceId}`;
  const snapshot = await transaction.get(sourcePath);
  if (!snapshot.exists || snapshot.data?.deletedAt || snapshot.data?.isPublished !== true) {
    fail("failed-precondition", "The canonical History Classroom assignment is unavailable.", "ASSESSMENT_SOURCE_UNAVAILABLE");
  }
  const sourceContentRevision = Number(snapshot.data?.contentRevision || 0);
  if (payload.expectedSourceRevision !== undefined && payload.expectedSourceRevision !== sourceContentRevision) {
    fail("aborted", "다른 변경이 먼저 반영되었습니다. 최신 과제를 확인해 주세요.", "ASSESSMENT_SOURCE_REVISION_CONFLICT");
  }
  const answerKey = collectHistoryAnswerKey(snapshot.data);
  if (!answerKey.length) {
    fail("failed-precondition", "The History Classroom answer key is empty.", "ASSESSMENT_SOURCE_EMPTY");
  }
  const assignedStudentUids = Array.isArray(snapshot.data?.targetStudentUids)
    ? snapshot.data.targetStudentUids.map((uid) => String(uid || "").trim()).filter(Boolean)
    : snapshot.data?.targetStudentUid
      ? [String(snapshot.data.targetStudentUid).trim()]
      : [];
  const threshold = snapshot.data.passThresholdPercent == null || snapshot.data.passThresholdPercent === "" ? Number.NaN : Number(snapshot.data.passThresholdPercent);
  const passThresholdPercent = Number.isFinite(threshold) ? Math.min(100, Math.max(0, threshold)) : 80;
  return { itemCount: answerKey.length, answerKey, assignedStudentUids, passThresholdPercent, sourceContentRevision, sourceHash: sha256(canonicalJson({ answerKey, assignedStudentUids })) };
};

const resolveAssignedClassIds = async (transaction, semesterId, requestedIds) => {
  if (!requestedIds.length) return [];
  const classes = await transaction.query(archiveEnrollment.SEMESTER_CLASS_COLLECTION, {
    field: "semesterId",
    operator: "==",
    value: semesterId,
  });
  const activeClasses = classes.filter((document) =>
    document.data?.status === "ACTIVE" && document.data?.readOnly !== true);
  const classNotFound = (classId) => fail("not-found",
    `현재 학기에서 공개할 수 없는 학급입니다: ${classId}. 학급 목록을 다시 확인해 주세요.`,
    "ASSESSMENT_CLASS_NOT_FOUND", { semesterId, classId });
  const resolved = requestedIds.map((requestedId) => {
    if (requestedId.startsWith("class_")) {
      const exact = activeClasses.find((document) =>
        String(document.data?.classId || document.path.split("/").at(-1)) === requestedId);
      if (!exact) classNotFound(requestedId);
      return requestedId;
    }
    const match = requestedId.match(/^(.+?)-(.+)$/);
    if (!match) fail("invalid-argument", "assignedClassId is invalid.", "ASSESSMENT_CLASS_INVALID");
    const [, grade, classNumber] = match;
    const target = activeClasses.find((document) =>
      String(document.data?.grade || "") === grade
      && String(document.data?.classNumber || "") === classNumber);
    if (!target) classNotFound(requestedId);
    return String(target.data?.classId || target.path.split("/").at(-1));
  });
  return [...new Set(resolved)];
};

const selectAttemptQuestionIds = ({ source, definition, studentUid, attemptNumber, priorAttempts = [] }) => {
  const allIds = source.answerKey.map((item) => item.id);
  if (definition.assessmentKind !== "QUIZ") return allIds;
  const requestedCount = Number(definition.questionCount || 0);
  const count = Math.min(requestedCount, allIds.length);
  if (count < 1) {
    fail("failed-precondition", "The published quiz question count is invalid.", "ASSESSMENT_QUESTION_SET_INVALID");
  }
  const learningRanks = learning.rankLearningCandidates(source, priorAttempts);
  return [...allIds]
    .map((id) => ({
      id,
      rank: sha256(`${studentUid}\n${definition.definitionId}\n${attemptNumber}\n${id}`),
    }))
    .sort((left, right) => (learningRanks.get(left.id) - learningRanks.get(right.id)) || left.rank.localeCompare(right.rank) || left.id.localeCompare(right.id))
    .slice(0, count)
    .map((item) => item.id);
};

const assertActiveEnrollment = async (transaction, semesterId, uid, assignedClassIds) => {
  const [pointer, manifest, slot] = await transaction.getAll([
    semesterCore.ACTIVE_SEMESTER_POINTER_PATH,
    manifestPath(semesterId),
    slotPath(semesterId, uid),
  ]);
  if (!pointer.exists || !manifest.exists || pointer.data?.semesterId !== semesterId || manifest.data?.status !== "ACTIVE" || Number(pointer.data?.revision || 0) !== Number(manifest.data?.revision || 0)) {
    fail("failed-precondition", "The assessment semester is not canonical ACTIVE.", "ASSESSMENT_SEMESTER_NOT_ACTIVE");
  }
  const activeEnrollmentId = String(slot.data?.activeEnrollmentId || "").trim();
  if (!slot.exists || !activeEnrollmentId) {
    fail("permission-denied", "An active semester enrollment is required.", "ASSESSMENT_ENROLLMENT_REQUIRED");
  }
  const enrollment = await transaction.get(enrollmentPath(activeEnrollmentId));
  if (
    !enrollment.exists
    || enrollment.data?.studentUid !== uid
    || enrollment.data?.semesterId !== semesterId
    || enrollment.data?.enrollmentStatus !== "ACTIVE"
  ) {
    fail("permission-denied", "The active semester enrollment is inconsistent.", "ASSESSMENT_ENROLLMENT_INVALID");
  }
  if (assignedClassIds.length && !assignedClassIds.includes(enrollment.data?.classId)) {
    fail("permission-denied", "This assessment is not assigned to the active class.", "ASSESSMENT_CLASS_NOT_ASSIGNED");
  }
  return enrollment.data;
};

const assertTeacherActor = (actor) => {
  if (!actor?.actorUid || !["teacher", "staff", "admin"].includes(actor.actorRole)) {
    fail("permission-denied", "Assessment management permission is required.", "ASSESSMENT_MANAGE_REQUIRED");
  }
};

const assertStudentActor = (actor) => {
  if (!actor?.actorUid || actor.actorRole !== "student") {
    fail("permission-denied", "A student account is required.", "ASSESSMENT_STUDENT_REQUIRED");
  }
};

const transitionAllowed = (source, target) => ({
  DRAFT: ["PUBLISHED", "CLOSED"],
  PUBLISHED: ["PAUSED", "CLOSED"],
  PAUSED: ["PUBLISHED", "CLOSED"],
  CLOSED: [],
}[source] || []).includes(target);

const assertAssessmentSemesterWritable = async (transaction, semesterId) => {
  const [pointer, manifest] = await transaction.getAll([
    semesterCore.ACTIVE_SEMESTER_POINTER_PATH,
    manifestPath(semesterId),
  ]);
  if (
    !pointer.exists
    || !manifest.exists
    || pointer.data?.semesterId !== semesterId
    || manifest.data?.status !== "ACTIVE"
    || Number(pointer.data?.revision || 0) !== Number(manifest.data?.revision || 0)
  ) {
    fail("failed-precondition", "Assessment source writes require the canonical ACTIVE semester.", "ASSESSMENT_SEMESTER_NOT_ACTIVE");
  }
};

const assertAssessmentDefinitionSemesterWritable = (manifest, semesterId) => {
  if (
    !manifest.exists
    || manifest.data?.semesterId !== semesterId
    || !["PREPARING", "READY", "ACTIVE"].includes(manifest.data?.status)
  ) {
    fail(
      "failed-precondition",
      "The semester cannot accept assessment definition changes.",
      "ASSESSMENT_SEMESTER_NOT_WRITABLE",
    );
  }
};

const assertContentRevision = (snapshot, expectedRevision, label) => {
  const currentRevision = snapshot.exists ? Number(snapshot.data?.contentRevision || 0) : 0;
  if (currentRevision !== expectedRevision) {
    fail("aborted", `${label} revision changed.`, "ASSESSMENT_CONTENT_REVISION_CONFLICT", { currentRevision });
  }
  return currentRevision;
};

const createAssessmentCommandAdapter = ({ now = () => new Date(), wisRewards = null } = {}) => ({
  apply: async ({ transaction, commandId, commandType, payload, payloadHash, receiptId, timestamp, concreteTimestamp, actor }) => {
    if (Object.values(historyExemptions.COMMAND_TYPES).includes(commandType))
      return historyExemptions.apply({ transaction, commandId, commandType, payload, actor, timestamp,
        helpers: { assertActiveEnrollment, assertTeacherActor, assertStudentActor, assertAssessmentSemesterWritable, now } });
    if (commandType === ASSESSMENT_COMMAND_TYPES.LOCK_HISTORY_CLASSROOM_ATTEMPT) {
      assertStudentActor(actor);
      const path = attemptPath(payload.attemptId);
      const current = await transaction.get(path);
      const attempt = current.data || {};
      if (!current.exists || attempt.studentUid !== actor.actorUid || attempt.assessmentKind !== "HISTORY_CLASSROOM")
        fail("permission-denied", "This History Classroom attempt cannot be locked.", "ASSESSMENT_ATTEMPT_FORBIDDEN");
      await assertAssessmentSemesterWritable(transaction, attempt.semesterId);
      if (!["SUBMITTED", "LOCKED", "STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(attempt.status))
        fail("failed-precondition", "This attempt is no longer active.", "ASSESSMENT_ATTEMPT_NOT_WRITABLE");
      const settled = ["SUBMITTED", "LOCKED"].includes(attempt.status);
      const revision = Number(attempt.revision || 0) + (settled ? 0 : 1);
      if (!settled) transaction.set(path, { status: "LOCKED", revision, lockReason: payload.reason,
        lockedAtIso: now().toISOString(), updatedAt: timestamp }, { merge: true });
      return { target: { kind: "assessment-attempt-lock", id: payload.attemptId, refs: [path] }, sourceHash: attempt.sourceHash || null,
        result: { attemptId: payload.attemptId, status: settled ? attempt.status : "LOCKED", revision } };
    }
    if (commandType === ASSESSMENT_COMMAND_TYPES.UPSERT_QUIZ_QUESTION) {
      assertTeacherActor(actor);
      await assertAssessmentSemesterWritable(transaction, payload.semesterId);
      const path = `${semesterRoot(payload.semesterId)}/quiz_questions/${payload.questionId}`;
      const snapshot = await transaction.get(path);
      const currentRevision = assertContentRevision(snapshot, payload.expectedRevision, "Quiz question");
      const nextRevision = currentRevision + 1;
      const question = {
        ...payload.question,
        contentRevision: nextRevision,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
        updateReason: payload.reason,
        ...(snapshot.exists ? {} : { createdAt: timestamp, createdBy: actor.actorUid }),
      };
      transaction.set(path, question, { merge: true });
      return { target: { kind: "quiz-question", id: payload.questionId, refs: [path] }, sourceHash: sha256(canonicalJson(payload.question)), result: { questionId: payload.questionId, contentRevision: nextRevision } };
    }

    if (commandType === ASSESSMENT_COMMAND_TYPES.DELETE_QUIZ_QUESTION) {
      assertTeacherActor(actor);
      await assertAssessmentSemesterWritable(transaction, payload.semesterId);
      const path = `${semesterRoot(payload.semesterId)}/quiz_questions/${payload.questionId}`;
      const snapshot = await transaction.get(path);
      if (!snapshot.exists) fail("not-found", "Quiz question was not found.", "ASSESSMENT_QUESTION_NOT_FOUND");
      assertContentRevision(snapshot, payload.expectedRevision, "Quiz question");
      transaction.delete(path);
      return { target: { kind: "quiz-question-delete", id: payload.questionId, refs: [path] }, sourceHash: null, result: { questionId: payload.questionId, deleted: true } };
    }

    if ([ASSESSMENT_COMMAND_TYPES.UPSERT_HISTORY_CLASSROOM_SOURCE, ASSESSMENT_COMMAND_TYPES.SAVE_HISTORY_CLASSROOM_ASSIGNMENT].includes(commandType)) {
      assertTeacherActor(actor);
      await assertAssessmentSemesterWritable(transaction, payload.semesterId);
      const path = `${semesterRoot(payload.semesterId)}/history_classrooms/${payload.sourceId}`;
      const definitionId = `history_classroom:${payload.semesterId}:${payload.sourceId}`;
      const [snapshot, definition] = await transaction.getAll([path, definitionPath(definitionId)]);
      const currentRevision = assertContentRevision(snapshot, payload.expectedRevision, "History Classroom source");
      const atomicSave = commandType === ASSESSMENT_COMMAND_TYPES.SAVE_HISTORY_CLASSROOM_ASSIGNMENT;
      const worksheet = (value) => ({ blanks: value?.blanks || [], pdfPageImages: value?.pdfPageImages || [], pdfRegions: value?.pdfRegions || [] });
      const isLessonSource = payload.source.sourceType === "lesson";
      const legacyWorksheet = (value) => ({ ...worksheet(value), blanks: (value?.blanks || []).map((blank) => ({
        ...blank, prompt: String(blank?.prompt || "").trim(), source: blank?.source === "ocr" ? "ocr" : "manual",
      })) });
      if (isLessonSource) {
        if (!String(payload.source.lessonUnitId || "").trim() || String(payload.source.mapResourceId || "").trim()) {
          fail("invalid-argument", "역사교실은 학습지 자료만 연결할 수 있습니다.", "ASSESSMENT_LESSON_SOURCE_INVALID");
        }
      } else {
        // Old map assignments retain their own immutable worksheet and results.
        // Their map ID is archival provenance, never a live source or a template
        // for creating another assignment through a stale client.
        if (!snapshot.exists || snapshot.data?.sourceType === "lesson" ||
            ![undefined, "", "map"].includes(payload.source.sourceType) ||
            String(payload.source.mapResourceId || "") !== String(snapshot.data?.mapResourceId || "") ||
            canonicalJson(legacyWorksheet(snapshot.data)) !== canonicalJson(legacyWorksheet(payload.source)) ||
            canonicalJson(snapshot.data?.answerOptions || []) !== canonicalJson(payload.source.answerOptions || [])) {
          fail("failed-precondition", "지도 연결이 종료되었습니다. 새 역사교실은 학습지를 선택해 주세요.", "ASSESSMENT_MAP_SOURCE_DISCONNECTED");
        }
      }
      // Normalizing a legacy blank adds optional prompt/source defaults. Keep
      // its exact stored worksheet bytes when only assignment settings change.
      const source = isLessonSource ? payload.source : {
        ...payload.source, ...worksheet(snapshot.data), answerOptions: snapshot.data?.answerOptions || [],
      };
      if (snapshot.exists && canonicalJson(worksheet(snapshot.data)) !== canonicalJson(worksheet(source))) {
        const [attempts, results, legacyResults] = await Promise.all([
          transaction.query(ATTEMPT_COLLECTION, { field: "definitionId", operator: "==", value: definitionId }),
          transaction.query(RESULT_COLLECTION, { field: "definitionId", operator: "==", value: definitionId }),
          transaction.query(`${semesterRoot(payload.semesterId)}/history_classroom_results`, { field: "assignmentId", operator: "==", value: payload.sourceId }),
        ]);
        if (results.some((row) => row.data?.completionSource !== "exemption") ||
            legacyResults.some((row) => row.data?.completionSource !== "exemption" && row.data?.status !== "cancelled"))
          fail("failed-precondition", "제출 기록이 있는 학습지는 새 역사교실로 등록해 주세요.", "ASSESSMENT_SOURCE_HAS_RESULTS");
        if (attempts.some((row) => row.data?.resetAt == null && ["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(row.data?.status)))
          fail("failed-precondition", "학생이 응시 중인 학습지는 변경할 수 없습니다. 제출 또는 응시 초기화 후 다시 저장해 주세요.", "ASSESSMENT_SOURCE_IN_USE");
      }
      const nextRevision = currentRevision + 1;
      let savedDefinition = null;
      if (atomicSave) {
        if (typeof source.isPublished !== "boolean") fail("invalid-argument", "isPublished is invalid.", "ASSESSMENT_PAYLOAD_INVALID");
        if (definition.exists && (definition.data?.semesterId !== payload.semesterId || definition.data?.sourceId !== payload.sourceId || definition.data?.assessmentKind !== "HISTORY_CLASSROOM"))
          fail("failed-precondition", "Assessment definition identity cannot be changed.", "ASSESSMENT_IDENTITY_IMMUTABLE");
        if (definition.data?.status === "CLOSED") fail("failed-precondition", "A closed assessment definition cannot be edited.", "ASSESSMENT_DEFINITION_CLOSED");
        if (source.isPublished) {
          const settings = normalizeAssessmentPayload(ASSESSMENT_COMMAND_TYPES.CREATE_ASSESSMENT_DEFINITION, {
            definitionId, semesterId: payload.semesterId, assessmentKind: "HISTORY_CLASSROOM", sourceId: payload.sourceId,
            title: String(source.title || "역사교실"), durationSeconds: Math.max(60, Number(source.timeLimitMinutes) * 60 || 3600),
            maxAttempts: 20, cooldownMinutes: Math.max(0, Number(source.cooldownMinutes) || 0), opensAt: "", closesAt: source.dueAt || "", assignedClassIds: [],
          });
          const answerKey = collectHistoryAnswerKey(source);
          if (!answerKey.length) fail("failed-precondition", "The History Classroom answer key is empty.", "ASSESSMENT_SOURCE_EMPTY");
          const assignedStudentUids = Array.isArray(source.targetStudentUids)
            ? source.targetStudentUids.map(uid => String(uid || "").trim()).filter(Boolean)
            : source.targetStudentUid ? [String(source.targetStudentUid).trim()] : [];
          savedDefinition = { ...settings, schemaVersion: ASSESSMENT_SCHEMA_VERSION, policyVersion: ASSESSMENT_POLICY_VERSION,
            status: "PUBLISHED", revision: Number(definition.data?.revision || 0) + 1, sourceContentRevision: nextRevision,
            sourceHash: sha256(canonicalJson({ answerKey, assignedStudentUids })), itemCount: answerKey.length, assignedStudentUids,
            updatedBy: actor.actorUid, updatedAt: timestamp, updateReason: payload.reason, transitionReason: payload.reason, commandId,
            ...(definition.exists ? {} : { createdAt: timestamp, createdBy: actor.actorUid }) };
        }
        // Reject malformed editor dates before either source or definition changes.
        normalizeIso(source.publishedAt, "publishedAt");
        normalizeIso(source.dueAt, "dueAt");
      }
      transaction.set(path, {
        ...source,
        // Reset permission is owned by reset commands; a stale editor must not
        // remove it or manufacture a new local-lock release marker.
        retryResetByStudentUid: snapshot.data?.retryResetByStudentUid || {},
        contentRevision: nextRevision,
        deletedAt: null,
        deletedByUid: "",
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
        updateReason: payload.reason,
        ...(snapshot.exists ? {} : { createdAt: timestamp, createdBy: actor.actorUid }),
      }, { merge: false });
      // Publication changes only after every source guard passes. The client
      // refreshes the definition snapshot and republishes the accepted source.
      if (savedDefinition) transaction.set(definitionPath(definitionId), savedDefinition, { merge: definition.exists });
      else if (definition.exists && definition.data?.status === "PUBLISHED")
        transaction.set(definition.path, { status: "PAUSED", revision: Number(definition.data.revision || 0) + 1,
          transitionReason: payload.reason, updatedAt: timestamp, updatedBy: actor.actorUid, commandId }, { merge: true });
      return { target: { kind: "history-classroom-source", id: payload.sourceId, refs: [path, ...(savedDefinition || (definition.exists && definition.data?.status === "PUBLISHED") ? [definitionPath(definitionId)] : [])] }, sourceHash: sha256(canonicalJson(source)), result: { sourceId: payload.sourceId, contentRevision: nextRevision,
        ...(atomicSave ? { definitionId, status: savedDefinition?.status || (definition.data?.status === "PUBLISHED" ? "PAUSED" : definition.data?.status || "DRAFT"),
          definitionRevision: savedDefinition?.revision || Number(definition.data?.revision || 0) + (definition.data?.status === "PUBLISHED" ? 1 : 0),
          publicationWindow: { publishedAt: source.publishedAt || null, dueAt: source.dueAt || null } } : {}) } };
    }

    if (commandType === ASSESSMENT_COMMAND_TYPES.DELETE_HISTORY_CLASSROOM_SOURCE) {
      assertTeacherActor(actor);
      await assertAssessmentSemesterWritable(transaction, payload.semesterId);
      const path = `${semesterRoot(payload.semesterId)}/history_classrooms/${payload.sourceId}`;
      const snapshot = await transaction.get(path);
      if (!snapshot.exists) fail("not-found", "History Classroom source was not found.", "ASSESSMENT_SOURCE_NOT_FOUND");
      const currentRevision = assertContentRevision(snapshot, payload.expectedRevision, "History Classroom source");
      const nextRevision = currentRevision + 1;
      transaction.set(path, {
        isPublished: false,
        contentRevision: nextRevision,
        deletedAt: timestamp,
        deletedByUid: actor.actorUid,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
        updateReason: payload.reason,
      }, { merge: true });
      return { target: { kind: "history-classroom-source-delete", id: payload.sourceId, refs: [path] }, sourceHash: null, result: { sourceId: payload.sourceId, contentRevision: nextRevision, deleted: true } };
    }

    if (commandType === ASSESSMENT_COMMAND_TYPES.UPDATE_MAP_RESOURCE_BLANKS) {
      assertTeacherActor(actor);
      await assertAssessmentSemesterWritable(transaction, payload.semesterId);
      fail("failed-precondition", "지도 연결이 종료되었습니다. 수업자료에서 학습지 빈칸을 수정해 주세요.", "ASSESSMENT_MAP_SOURCE_DISCONNECTED");
    }

    if (commandType === ASSESSMENT_COMMAND_TYPES.SAVE_QUIZ_ASSESSMENT_SETTINGS) {
      assertTeacherActor(actor);
      await assertAssessmentSemesterWritable(transaction, payload.semesterId);
      const path = definitionPath(payload.definitionId);
      const snapshot = await transaction.get(path);
      const current = snapshot.data || {};
      if (Number(current.revision || 0) !== payload.expectedRevision) {
        fail("aborted", "평가 설정이 변경되었습니다. 다시 열어 확인해 주세요.", "ASSESSMENT_REVISION_CONFLICT");
      }
      if (current.status === "CLOSED") fail("failed-precondition", "A closed assessment definition cannot be edited.", "ASSESSMENT_DEFINITION_CLOSED");
      if (snapshot.exists && ["semesterId", "assessmentKind", "sourceId", "category", "examRound", "legacyConfigKey"].some(key => (current[key] || "") !== (payload[key] || ""))) {
        fail("failed-precondition", "Assessment definition identity cannot be changed.", "ASSESSMENT_IDENTITY_IMMUTABLE");
      }
      const published = payload.presentationSettings.active;
      // Closing access must succeed even if questions/classes have since been
      // removed. Only publication needs to read and validate the source bank.
      const source = published ? await loadDefinitionSource(transaction, payload) : null;
      if (source && payload.questionCount > source.itemCount) {
        fail("invalid-argument", "출제 문항 수가 등록된 문항 수보다 많습니다.", "ASSESSMENT_QUESTION_SET_INVALID");
      }
      if (source && payload.expectedSourceHash && payload.expectedSourceHash !== source.sourceHash) {
        fail("aborted", "평가 문항이 바뀌었습니다. 다시 확인해 주세요.", "ASSESSMENT_SOURCE_REVISION_CONFLICT");
      }
      const assignedClassIds = published
        ? await resolveAssignedClassIds(transaction, payload.semesterId, payload.assignedClassIds)
        : payload.assignedClassIds.length ? current.assignedClassIds || [] : [];
      const { expectedRevision, expectedSourceHash: _expectedSourceHash, reason, ...definitionPayload } = payload;
      const definition = {
        schemaVersion: ASSESSMENT_SCHEMA_VERSION, policyVersion: ASSESSMENT_POLICY_VERSION,
        ...definitionPayload, assignedClassIds,
        status: published ? "PUBLISHED" : snapshot.exists && current.status !== "DRAFT" ? "PAUSED" : "DRAFT",
        revision: expectedRevision + 1,
        sourceHash: source?.sourceHash || current.sourceHash || "",
        itemCount: source?.itemCount ?? current.itemCount ?? 0,
        assignedStudentUids: [], updatedBy: actor.actorUid, updateReason: reason, commandId, updatedAt: timestamp,
        ...(snapshot.exists ? {} : { createdBy: actor.actorUid, createdAt: timestamp }),
      };
      const legacyConfigPath = `${semesterRoot(payload.semesterId)}/assessment_config/settings`;
      transaction.set(path, definition, { merge: true });
      transaction.set(legacyConfigPath, { [payload.legacyConfigKey]: payload.presentationSettings }, { merge: true });
      return { target: { kind: "assessment-definition", id: payload.definitionId, refs: [path, legacyConfigPath] },
        sourceHash: definition.sourceHash || null,
        result: { definitionId: payload.definitionId, status: definition.status, revision: definition.revision,
          sourceHash: definition.sourceHash, itemCount: definition.itemCount } };
    }

    if (commandType === ASSESSMENT_COMMAND_TYPES.CREATE_ASSESSMENT_DEFINITION) {
      assertTeacherActor(actor);
      const path = definitionPath(payload.definitionId);
      const [existing, manifest] = await transaction.getAll([path, manifestPath(payload.semesterId)]);
      if (existing.exists) fail("already-exists", "Assessment definition already exists.", "ASSESSMENT_DEFINITION_EXISTS");
      assertAssessmentDefinitionSemesterWritable(manifest, payload.semesterId);
      if (["PREPARING", "READY"].includes(manifest.data?.status)) {
        await cutoverAuthorization.assertPreparingCutoverCreateIfTargeted({ transaction, semesterId: payload.semesterId, actor, commandType, commandId, payloadHash, cutoverPlanId: payload.cutoverPlanId, cutoverOperationKey: payload.cutoverOperationKey, operationType: "ASSESSMENT_DEFINITIONS", allowWithoutMarker: true });
      }
      const source = await loadDefinitionSource(transaction, payload);
      if (payload.assessmentKind === "QUIZ" && payload.questionCount > source.itemCount) {
        fail("invalid-argument", "questionCount exceeds the canonical question set.", "ASSESSMENT_QUESTION_SET_INVALID");
      }
      const assignedClassIds = await resolveAssignedClassIds(
        transaction,
        payload.semesterId,
        payload.assignedClassIds,
      );
      const { expectedSourceRevision: _expectedSourceRevision, ...definitionPayload } = payload;
      const definition = {
        schemaVersion: ASSESSMENT_SCHEMA_VERSION,
        policyVersion: ASSESSMENT_POLICY_VERSION,
        ...definitionPayload,
        assignedClassIds,
        status: "DRAFT",
        revision: 1,
        sourceHash: source.sourceHash,
        ...(payload.assessmentKind === "HISTORY_CLASSROOM" ? { sourceContentRevision: source.sourceContentRevision } : {}),
        itemCount: source.itemCount,
        assignedStudentUids: source.assignedStudentUids,
        createdBy: actor.actorUid,
        updatedBy: actor.actorUid,
        commandId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      transaction.create(path, definition);
      const refs = [path];
      if (payload.assessmentKind === "QUIZ") {
        const legacyConfigPath = `${semesterRoot(payload.semesterId)}/assessment_config/settings`;
        transaction.set(legacyConfigPath, { [payload.legacyConfigKey]: payload.presentationSettings }, { merge: true });
        refs.push(legacyConfigPath);
      }
      return { target: { kind: "assessment-definition", id: payload.definitionId, refs }, sourceHash: source.sourceHash, result: { definition: { ...definition, createdAt: null, updatedAt: null } } };
    }

    if (commandType === ASSESSMENT_COMMAND_TYPES.UPDATE_ASSESSMENT_DEFINITION) {
      assertTeacherActor(actor);
      const path = definitionPath(payload.definitionId);
      const [snapshot, manifest] = await transaction.getAll([
        path,
        manifestPath(payload.semesterId),
      ]);
      if (!snapshot.exists) fail("not-found", "Assessment definition was not found.", "ASSESSMENT_DEFINITION_NOT_FOUND");
      assertAssessmentDefinitionSemesterWritable(manifest, payload.semesterId);
      const current = snapshot.data || {};
      if (Number(current.revision || 0) !== payload.expectedRevision) fail("aborted", "Assessment definition revision changed.", "ASSESSMENT_REVISION_CONFLICT");
      if (current.status === "CLOSED") fail("failed-precondition", "A closed assessment definition cannot be edited.", "ASSESSMENT_DEFINITION_CLOSED");
      if (current.semesterId !== payload.semesterId || current.assessmentKind !== payload.assessmentKind || current.sourceId !== payload.sourceId) fail("failed-precondition", "Assessment definition identity cannot be changed.", "ASSESSMENT_IDENTITY_IMMUTABLE");
      const source = await loadDefinitionSource(transaction, payload);
      if (payload.assessmentKind === "QUIZ" && payload.questionCount > source.itemCount) {
        fail("invalid-argument", "questionCount exceeds the canonical question set.", "ASSESSMENT_QUESTION_SET_INVALID");
      }
      const assignedClassIds = await resolveAssignedClassIds(
        transaction,
        payload.semesterId,
        payload.assignedClassIds,
      );
      const revision = payload.expectedRevision + 1;
      const { expectedRevision: _expectedRevision, expectedSourceRevision: _expectedSourceRevision, reason, ...definitionUpdate } = payload;
      transaction.set(path, {
        ...definitionUpdate,
        assignedClassIds,
        revision,
        sourceHash: source.sourceHash,
        ...(payload.assessmentKind === "HISTORY_CLASSROOM" ? { sourceContentRevision: source.sourceContentRevision } : {}),
        itemCount: source.itemCount,
        assignedStudentUids: source.assignedStudentUids,
        updatedBy: actor.actorUid,
        updateReason: reason,
        commandId,
        updatedAt: timestamp,
      }, { merge: true });
      const refs = [path];
      if (payload.assessmentKind === "QUIZ") {
        const legacyConfigPath = `${semesterRoot(payload.semesterId)}/assessment_config/settings`;
        transaction.set(legacyConfigPath, { [payload.legacyConfigKey]: payload.presentationSettings }, { merge: true });
        refs.push(legacyConfigPath);
      }
      return { target: { kind: "assessment-definition", id: payload.definitionId, refs }, sourceHash: source.sourceHash, result: { definitionId: payload.definitionId, status: current.status, revision, sourceHash: source.sourceHash, itemCount: source.itemCount } };
    }

    if (commandType === ASSESSMENT_COMMAND_TYPES.TRANSITION_ASSESSMENT_DEFINITION) {
      assertTeacherActor(actor);
      const path = definitionPath(payload.definitionId);
      const snapshot = await transaction.get(path);
      if (!snapshot.exists) fail("not-found", "Assessment definition was not found.", "ASSESSMENT_DEFINITION_NOT_FOUND");
      const current = snapshot.data || {};
      const manifest = await transaction.get(manifestPath(current.semesterId));
      assertAssessmentDefinitionSemesterWritable(manifest, current.semesterId);
      if (Number(current.revision || 0) !== payload.expectedRevision) fail("aborted", "Assessment definition revision changed.", "ASSESSMENT_REVISION_CONFLICT");
      if (!transitionAllowed(current.status, payload.targetStatus)) fail("failed-precondition", "Assessment definition transition is invalid.", "ASSESSMENT_TRANSITION_INVALID");
      if (payload.expectedSourceRevision !== undefined) {
        if (current.assessmentKind !== "HISTORY_CLASSROOM") {
          fail("invalid-argument", "expectedSourceRevision is only supported for History Classroom.", "ASSESSMENT_PAYLOAD_INVALID");
        }
        const source = await loadDefinitionSource(transaction, { ...current, expectedSourceRevision: payload.expectedSourceRevision });
        if (current.sourceContentRevision !== payload.expectedSourceRevision || current.sourceHash !== source.sourceHash) {
          fail("aborted", "과제가 바뀌어 공개하지 않았습니다. 최신 과제를 확인해 주세요.", "ASSESSMENT_SOURCE_REVISION_CONFLICT");
        }
      }
      const revision = payload.expectedRevision + 1;
      transaction.set(path, { status: payload.targetStatus, revision, transitionReason: payload.reason, updatedBy: actor.actorUid, updatedAt: timestamp, commandId }, { merge: true });
      return { target: { kind: "assessment-definition", id: payload.definitionId, refs: [path] }, sourceHash: current.sourceHash || null, result: { definitionId: payload.definitionId, status: payload.targetStatus, revision } };
    }

    if (commandType === ASSESSMENT_COMMAND_TYPES.START_ASSESSMENT_ATTEMPT) {
      assertStudentActor(actor);
      const definitionSnapshot = await transaction.get(definitionPath(payload.definitionId));
      if (!definitionSnapshot.exists) fail("not-found", "Assessment definition was not found.", "ASSESSMENT_DEFINITION_NOT_FOUND");
      const definition = definitionSnapshot.data || {};
      if (definition.status !== "PUBLISHED") fail("failed-precondition", "Assessment is not open.", "ASSESSMENT_NOT_PUBLISHED");
      const nowDate = now();
      const nowMs = nowDate.getTime();
      if ((definition.opensAt && nowMs < Date.parse(definition.opensAt)) || (definition.closesAt && nowMs > Date.parse(definition.closesAt))) {
        fail("failed-precondition", "Assessment is outside its response window.", "ASSESSMENT_WINDOW_CLOSED");
      }
      if (definition.assessmentKind === "QUIZ" && !(definition.assignedClassIds || []).length) {
        fail("permission-denied", "This assessment has no assigned class.", "ASSESSMENT_CLASS_NOT_ASSIGNED");
      }
      const enrollment = await assertActiveEnrollment(transaction, definition.semesterId, actor.actorUid, definition.assignedClassIds || []);
      if (
        Array.isArray(definition.assignedStudentUids)
        && definition.assignedStudentUids.length > 0
        && !definition.assignedStudentUids.includes(actor.actorUid)
      ) {
        fail("permission-denied", "This assessment is not assigned to the student.", "ASSESSMENT_STUDENT_NOT_ASSIGNED");
      }
      const allPrior = (await transaction.query(ATTEMPT_COLLECTION, { filters: [
        { field: "definitionId", operator: "==", value: payload.definitionId },
        { field: "studentUid", operator: "==", value: actor.actorUid },
      ] }))
        .filter((document) => document.data?.studentUid === actor.actorUid);
      const prior = allPrior.filter((document) => document.data?.resetAt == null)
        .sort((left, right) => Number(left.data?.attemptNumber || 0) - Number(right.data?.attemptNumber || 0));
      if (definition.assessmentKind === "HISTORY_CLASSROOM") {
        if (prior.some((document) => document.data?.status === "LOCKED" && ["VISIBILITY_HIDDEN", "NAVIGATION"].includes(document.data?.lockReason)))
          fail("failed-precondition", "화면 이탈로 응시가 종료되었습니다. 선생님께 재응시를 요청해 주세요.", "ASSESSMENT_ATTEMPT_LOCKED");
        const exemption = await transaction.get(resultPath(historyExemptions.resultIdFor(definition.semesterId, definition.sourceId, actor.actorUid)));
        if (exemption.exists)
          fail("failed-precondition", "면제권으로 이미 완료한 역사교실입니다.", "ASSESSMENT_ALREADY_EXEMPTED");
      }
      const active = prior.find((document) => ["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(document.data?.status));
      if (active) {
        return { target: { kind: "assessment-attempt", id: active.data.attemptId, refs: [active.path] }, sourceHash: active.data.sourceHash || null, result: serializeAttempt(active.data, true) };
      }
      if (prior.length >= Number(definition.maxAttempts || 1)) fail("failed-precondition", "No assessment attempts remain.", "ASSESSMENT_ATTEMPT_LIMIT_REACHED");
      const latestSubmitted = [...prior].reverse().find((document) => document.data?.submittedAtIso);
      if (latestSubmitted && Number(definition.cooldownMinutes || 0) > 0) {
        const nextAt = Date.parse(latestSubmitted.data.submittedAtIso) + Number(definition.cooldownMinutes) * 60_000;
        if (nowMs < nextAt) fail("failed-precondition", "Assessment retry cooldown is active.", "ASSESSMENT_COOLDOWN_ACTIVE", { retryAt: new Date(nextAt).toISOString() });
      }
      const source = await loadDefinitionSource(transaction, definition);
      if (source.sourceHash !== definition.sourceHash) fail("failed-precondition", "Assessment content changed after publication.", "ASSESSMENT_SOURCE_STALE");
      const attemptNumber = prior.length + 1;
      // Reset restores the allowed attempts, but immutable attempt/result IDs
      // must never be reused. Keep a lifetime ordinal separate from that count.
      const attemptOrdinal = Math.max(0, ...allPrior.map((document) =>
        Number(document.data?.attemptOrdinal || document.data?.attemptNumber || 0))) + 1;
      if (!Number.isSafeInteger(attemptOrdinal)) fail("failed-precondition", "Assessment attempt sequence is invalid.", "ASSESSMENT_ATTEMPT_INVALID");
      const selectedIds = selectAttemptQuestionIds({
        source,
        definition,
        studentUid: actor.actorUid,
        attemptNumber,
        priorAttempts: allPrior.map(document => document.data || {}),
      });
      const answerById = new Map(source.answerKey.map((item) => [item.id, item]));
      const gradingSnapshot = selectedIds.map((id) => answerById.get(id));
      const attemptId = `attempt_${sha256(`${actor.actorUid}\n${payload.definitionId}\n${attemptOrdinal}`)}`;
      const path = attemptPath(attemptId);
      const deadlineMs = Math.min(
        nowMs + Number(definition.durationSeconds) * 1000,
        definition.closesAt ? Date.parse(definition.closesAt) : Number.MAX_SAFE_INTEGER,
      );
      const attempt = {
        schemaVersion: ASSESSMENT_SCHEMA_VERSION,
        policyVersion: ASSESSMENT_POLICY_VERSION,
        attemptId,
        definitionId: payload.definitionId,
        definitionRevision: definition.revision,
        semesterId: definition.semesterId,
        assessmentKind: definition.assessmentKind,
        studentUid: actor.actorUid,
        enrollmentId: enrollment.enrollmentId,
        classId: enrollment.classId,
        attemptNumber,
        attemptOrdinal,
        status: "STARTED",
        revision: 1,
        answers: {},
        currentItemId: selectedIds[0] || "",
        questionIds: selectedIds,
        gradingSnapshot,
        ...(definition.assessmentKind === "QUIZ" ? {
          sourceId: definition.sourceId || "", category: definition.category || "", examRound: definition.examRound || "",
          learningSnapshot: (source.learningSnapshot || []).filter(item => selectedIds.includes(item.id)),
          questionDocumentIds: Object.fromEntries((source.quizDocuments || [])
            .filter(document => selectedIds.includes(String(document.data?.id ?? document.path.split("/").at(-1))))
            .map(document => [String(document.data?.id ?? document.path.split("/").at(-1)), document.path.split("/").at(-1)])),
        } : {}),
        ...(definition.assessmentKind === "HISTORY_CLASSROOM" ? { passThresholdPercent: source.passThresholdPercent } : {}),
        sourceHash: source.sourceHash,
        startedAtIso: nowDate.toISOString(),
        deadlineAtIso: new Date(deadlineMs).toISOString(),
        lastSavedAtIso: nowDate.toISOString(),
        submittedAtIso: "",
        resultRef: "",
        submissionRef: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (definition.assessmentKind === "QUIZ") Object.assign(attempt,
        learning.captureQuestionSnapshots(source.quizDocuments || [], selectedIds, attempt));
      transaction.create(path, attempt);
      return { target: { kind: "assessment-attempt", id: attemptId, refs: [path] }, sourceHash: source.sourceHash, result: serializeAttempt(attempt, false) };
    }

    if (commandType === ASSESSMENT_COMMAND_TYPES.SUBMIT_ASSESSMENT_ATTEMPT) {
      assertStudentActor(actor);
      const path = attemptPath(payload.attemptId);
      const attemptSnapshot = await transaction.get(path);
      if (!attemptSnapshot.exists) fail("not-found", "Assessment attempt was not found.", "ASSESSMENT_ATTEMPT_NOT_FOUND");
      const attempt = attemptSnapshot.data || {};
      if (attempt.attemptId !== payload.attemptId) fail("failed-precondition", "Assessment attempt identity is inconsistent.", "ASSESSMENT_ATTEMPT_INVALID");
      if (attempt.studentUid !== actor.actorUid) fail("permission-denied", "Assessment attempt belongs to another student.", "ASSESSMENT_ATTEMPT_FORBIDDEN");
      await assertAssessmentSemesterWritable(transaction, attempt.semesterId);
      if (attempt.status === "SUBMITTED") {
        if (attempt.resultRef !== resultPath(attempt.attemptId)) fail("failed-precondition", "Assessment result reference is inconsistent.", "ASSESSMENT_RESULT_INVALID");
        const resultDoc = await transaction.get(attempt.resultRef);
        const result = resultDoc.data || {};
        if (!resultDoc.exists || result.studentUid !== actor.actorUid || result.semesterId !== attempt.semesterId || result.attemptId !== attempt.attemptId)
          fail("failed-precondition", "Assessment result is inconsistent.", "ASSESSMENT_RESULT_INVALID");
        const reward = result.reward || { status: "NOT_RECORDED", awarded: false, duplicate: false, amount: 0, bonusAwarded: false,
          bonusAmount: 0, totalAwarded: 0, blockedReason: "reward_not_recorded", blockedMessage: "이전 제출의 보상 확인 기록이 없습니다.", ledgerEntryIds: [] };
        return { target: { kind: "assessment-submission", id: attempt.attemptId, refs: [path, attempt.submissionRef, attempt.resultRef] }, sourceHash: attempt.sourceHash || null, result: { attemptId: attempt.attemptId, status: "SUBMITTED", resultRef: attempt.resultRef, submissionRef: attempt.submissionRef,
          score: result.score, total: result.total, percent: result.percent, ...(attempt.assessmentKind === "QUIZ" ? { analytics: result.analytics || null, learningSnapshot: result.learningSnapshot || [], ...(Array.isArray(result.questionSnapshots) ? { questionSnapshots: result.questionSnapshots, questionSnapshotOmittedIds: result.questionSnapshotOmittedIds || [] } : {}) } : {}), ...(typeof result.passed === "boolean" ? { passed: result.passed, passThresholdPercent: result.passThresholdPercent } : {}), answerChecks: result.answerChecks, reward, replayedSubmission: true } };
      }
      if (!Array.isArray(attempt.gradingSnapshot) || !["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(attempt.status)) fail("failed-precondition", "Assessment attempt cannot be submitted.", "ASSESSMENT_ATTEMPT_NOT_SUBMITTABLE");
      if (Number(attempt.revision || 0) !== payload.expectedRevision) fail("aborted", "Assessment attempt revision changed.", "ASSESSMENT_ATTEMPT_REVISION_CONFLICT", { currentRevision: Number(attempt.revision || 0) });
      const nowDate = now();
      if (payload.submitReason !== "TIMEOUT" && nowDate.getTime() > Date.parse(attempt.deadlineAtIso)) {
        fail("deadline-exceeded", "The authoritative assessment deadline has passed.", "ASSESSMENT_DEADLINE_EXPIRED");
      }
      const effectiveAnswers = payload.answers;
      const analytics = attempt.assessmentKind === "QUIZ"
        ? learning.normalizeAnalytics(payload.analytics === undefined ? attempt.analytics : payload.analytics, attempt, nowDate.getTime(), effectiveAnswers) : null;
      const checks = attempt.gradingSnapshot.map((item) => ({ id: item.id, correct: normalizeAnswer(effectiveAnswers[item.id]) === normalizeAnswer(item.answer) }));
      const correctCount = checks.filter((item) => item.correct).length;
      const total = checks.length;
      const percent = total ? Math.round((correctCount / total) * 100) : 0;
      const historyOutcome = attempt.assessmentKind === "HISTORY_CLASSROOM" && Number.isFinite(attempt.passThresholdPercent)
        ? { passThresholdPercent: attempt.passThresholdPercent, passed: percent >= attempt.passThresholdPercent }
        : {};
      const nextRevision = Number(attempt.revision) + 1;
      const immutableSubmissionPath = submissionPath(attempt.attemptId);
      const immutableResultPath = resultPath(attempt.attemptId);
      const submittedAtIso = nowDate.toISOString();
      if (!wisRewards || typeof wisRewards.prepare !== "function") fail("failed-precondition", "Assessment reward adapter is unavailable.", "ASSESSMENT_WIS_ADAPTER_REQUIRED");
      const rewardPlan = await wisRewards.prepare({ transaction, attempt, percent, commandId, receiptId, nowDate, concreteTimestamp });
      const reviewSnapshots = attempt.assessmentKind === "QUIZ" && Array.isArray(attempt.questionSnapshots)
        ? learning.boundQuestionSnapshots(attempt.questionSnapshots, attempt.questionIds || [],
          { ...attempt, questionSnapshots: undefined, answers: effectiveAnswers, analytics }) : {};
      // No reads below this point: score, reward ledger/projections and receipt
      // are committed together, or none of them are committed.
      transaction.create(immutableSubmissionPath, {
        schemaVersion: ASSESSMENT_SCHEMA_VERSION,
        policyVersion: ASSESSMENT_POLICY_VERSION,
        submissionId: attempt.attemptId,
        attemptId: attempt.attemptId,
        definitionId: attempt.definitionId,
        semesterId: attempt.semesterId,
        studentUid: actor.actorUid,
        answers: effectiveAnswers,
        ...(attempt.assessmentKind === "QUIZ" ? { analytics } : {}),
        submitReason: payload.submitReason,
        attemptRevision: nextRevision,
        sourceHash: attempt.sourceHash,
        submittedAtIso,
        receiptId,
        createdAt: timestamp,
      });
      transaction.create(immutableResultPath, {
        schemaVersion: ASSESSMENT_SCHEMA_VERSION,
        policyVersion: ASSESSMENT_POLICY_VERSION,
        resultId: attempt.attemptId,
        attemptId: attempt.attemptId,
        definitionId: attempt.definitionId,
        semesterId: attempt.semesterId,
        assessmentKind: attempt.assessmentKind,
        studentUid: actor.actorUid,
        enrollmentId: attempt.enrollmentId,
        classId: attempt.classId,
        score: correctCount,
        total,
        percent,
        ...historyOutcome,
        answerChecks: checks,
        ...(attempt.assessmentKind === "QUIZ" ? {
          analytics, learningSnapshot: attempt.learningSnapshot || [], answers: effectiveAnswers, ...reviewSnapshots,
          sourceId: attempt.sourceId || "", category: attempt.category || "", examRound: attempt.examRound || "",
          attemptNumber: attempt.attemptNumber,
        } : {}),
        sourceHash: attempt.sourceHash,
        submittedAtIso,
        submissionRef: immutableSubmissionPath,
        reward: rewardPlan.result,
        receiptId,
        createdAt: timestamp,
      });
      transaction.set(path, { status: "SUBMITTED", revision: nextRevision, answers: effectiveAnswers, ...(attempt.assessmentKind === "QUIZ" ? { analytics } : {}), submittedAtIso, submissionRef: immutableSubmissionPath, resultRef: immutableResultPath, submitReason: payload.submitReason, updatedAt: timestamp }, { merge: true });
      rewardPlan.apply();
      return { target: { kind: "assessment-submission", id: attempt.attemptId, refs: [path, immutableSubmissionPath, immutableResultPath, ...rewardPlan.refs] }, sourceHash: attempt.sourceHash, result: { attemptId: attempt.attemptId, status: "SUBMITTED", revision: nextRevision, score: correctCount, total, percent, ...historyOutcome, answerChecks: checks, ...(attempt.assessmentKind === "QUIZ" ? { analytics, learningSnapshot: attempt.learningSnapshot || [], ...reviewSnapshots } : {}), resultRef: immutableResultPath, submissionRef: immutableSubmissionPath, reward: rewardPlan.result, replayedSubmission: false } };
    }

    if (commandType === ASSESSMENT_COMMAND_TYPES.RESET_ASSESSMENT_ATTEMPTS_BY_CLASS) {
      assertTeacherActor(actor);
      const definition = await transaction.get(definitionPath(payload.definitionId));
      if (!definition.exists) fail("not-found", "Assessment definition was not found.", "ASSESSMENT_DEFINITION_NOT_FOUND");
      await assertAssessmentSemesterWritable(transaction, definition.data?.semesterId);
      let resolvedClassId = payload.classId;
      if (!payload.classId.startsWith("class_")) {
        const [grade, classNumber] = payload.classId.split("-");
        const classes = await transaction.query(archiveEnrollment.SEMESTER_CLASS_COLLECTION, { field: "semesterId", operator: "==", value: definition.data?.semesterId });
        const matchedClass = classes.find((document) => String(document.data?.grade || "") === grade && String(document.data?.classNumber || "") === classNumber && document.data?.status === "ACTIVE");
        if (!matchedClass) fail("not-found", "The active semester class was not found.", "ASSESSMENT_CLASS_NOT_FOUND");
        resolvedClassId = String(matchedClass.data?.classId || matchedClass.path.split("/").at(-1));
      }
      const attempts = (await transaction.query(ATTEMPT_COLLECTION, { field: "definitionId", operator: "==", value: payload.definitionId })).filter((document) => document.data?.classId === resolvedClassId && document.data?.resetAt == null);
      const sourcePath = definition.data?.assessmentKind === "HISTORY_CLASSROOM"
        ? `${semesterRoot(definition.data.semesterId)}/history_classrooms/${definition.data.sourceId}` : "";
      const source = sourcePath ? await transaction.get(sourcePath) : null;
      const enrollments = source?.exists ? await transaction.query(archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION, { field: "classId", operator: "==", value: resolvedClassId }) : [];
      const resetUids = [...new Set([...attempts.map((row) => row.data.studentUid), ...enrollments.filter((row) => row.data?.semesterId === definition.data.semesterId && row.data?.enrollmentStatus === "ACTIVE").map((row) => row.data.studentUid)].filter(Boolean))];
      for (const document of attempts) transaction.set(document.path, { status: "LOCKED", resetAt: timestamp, resetBy: actor.actorUid, resetReason: payload.reason, updatedAt: timestamp }, { merge: true });
      if (source?.exists) transaction.set(sourcePath, { retryResetByStudentUid: { ...(source.data.retryResetByStudentUid || {}), ...Object.fromEntries(resetUids.map((uid) => [uid, timestamp])) } }, { merge: true });
      return { target: { kind: "assessment-attempt-reset", id: `${payload.definitionId}:${resolvedClassId}`, refs: [...attempts.map((item) => item.path), ...(source?.exists ? [sourcePath] : [])] }, sourceHash: definition.data?.sourceHash || null, result: { definitionId: payload.definitionId, classId: resolvedClassId, resetCount: attempts.length } };
    }
    if (commandType === ASSESSMENT_COMMAND_TYPES.RESET_ASSESSMENT_ATTEMPT) {
      assertTeacherActor(actor);
      const definition = await transaction.get(definitionPath(payload.definitionId));
      if (!definition.exists) fail("not-found", "Assessment definition was not found.", "ASSESSMENT_DEFINITION_NOT_FOUND");
      await assertAssessmentSemesterWritable(transaction, definition.data?.semesterId);
      const attempts = (await transaction.query(ATTEMPT_COLLECTION, { field: "definitionId", operator: "==", value: payload.definitionId })).filter((document) => document.data?.studentUid === payload.studentUid && document.data?.resetAt == null);
      const sourcePath = definition.data?.assessmentKind === "HISTORY_CLASSROOM"
        ? `${semesterRoot(definition.data.semesterId)}/history_classrooms/${definition.data.sourceId}` : "";
      const source = sourcePath ? await transaction.get(sourcePath) : null;
      for (const document of attempts) transaction.set(document.path, { status: "LOCKED", resetAt: timestamp, resetBy: actor.actorUid, resetReason: payload.reason, updatedAt: timestamp }, { merge: true });
      if (source?.exists) transaction.set(sourcePath, { retryResetByStudentUid: { ...(source.data.retryResetByStudentUid || {}), [payload.studentUid]: timestamp } }, { merge: true });
      return { target: { kind: "assessment-attempt-reset", id: `${payload.definitionId}:${payload.studentUid}`, refs: [...attempts.map((item) => item.path), ...(source?.exists ? [sourcePath] : [])] }, sourceHash: definition.data?.sourceHash || null, result: { definitionId: payload.definitionId, studentUid: payload.studentUid, resetCount: attempts.length } };
    }
    fail("invalid-argument", "Unsupported assessment commandType.", "COMMAND_TYPE_UNSUPPORTED");
  },
});

const serializeAttempt = (attempt, resumed) => ({
  attemptId: attempt.attemptId,
  definitionId: attempt.definitionId,
  semesterId: attempt.semesterId,
  assessmentKind: attempt.assessmentKind,
  attemptNumber: attempt.attemptNumber,
  status: attempt.status,
  revision: attempt.revision,
  answers: attempt.answers || {},
  ...(attempt.assessmentKind === "QUIZ" ? { analytics: attempt.analytics || null, learningSnapshot: attempt.learningSnapshot || [],
    ...(Array.isArray(attempt.questionSnapshots) ? { questionPresentation: learning.questionPresentation(attempt.questionSnapshots), questionSnapshotOmittedIds: attempt.questionSnapshotOmittedIds || [] } : {}) } : {}),
  currentItemId: attempt.currentItemId || "",
  questionIds: attempt.questionIds || [],
  startedAtIso: attempt.startedAtIso,
  deadlineAtIso: attempt.deadlineAtIso,
  lastSavedAtIso: attempt.lastSavedAtIso,
  submittedAtIso: attempt.submittedAtIso || "",
  resultRef: attempt.resultRef || "",
  resumed,
});

const normalizeSaveRequest = (data, projectId) => {
  const payload = { ...(data || {}) };
  delete payload._session;
  const testDelayAfterSessionMs = payload._testDelayAfterSessionMs === undefined
    ? 0
    : nonNegativeInteger(payload._testDelayAfterSessionMs, "_testDelayAfterSessionMs", 2_000);
  delete payload._testDelayAfterSessionMs;
  const testAuthorizedSignalId = payload._testAuthorizedSignalId === undefined
    ? ""
    : text(payload._testAuthorizedSignalId, "_testAuthorizedSignalId", 100);
  delete payload._testAuthorizedSignalId;
  const testDropResponseAfterCommit = payload._testDropResponseAfterCommit === undefined
    ? false
    : payload._testDropResponseAfterCommit;
  delete payload._testDropResponseAfterCommit;
  if (typeof testDropResponseAfterCommit !== "boolean") {
    fail("invalid-argument", "Assessment response-loss flag is invalid.", "ASSESSMENT_TEST_FAULT_INVALID");
  }
  if (
    (testDelayAfterSessionMs > 0 || testAuthorizedSignalId || testDropResponseAfterCommit)
    && !String(projectId || "").startsWith("demo-westory-session-")
  ) {
    fail(
      "failed-precondition",
      "Assessment save fault injection is unavailable.",
      "TEST_FAULT_INJECTION_FORBIDDEN",
    );
  }
  if (testAuthorizedSignalId && !/^[A-Za-z0-9_-]+$/.test(testAuthorizedSignalId)) {
    fail("invalid-argument", "Assessment test signal is invalid.", "ASSESSMENT_TEST_SIGNAL_INVALID");
  }
  if (testAuthorizedSignalId && testDelayAfterSessionMs === 0) {
    fail("invalid-argument", "Assessment test signal requires a delay.", "ASSESSMENT_TEST_SIGNAL_INVALID");
  }
  assertAllowedKeys(payload, ["attemptId", "expectedRevision", "answers", "currentItemId", "saveId", "analytics"], "saveAssessmentProgress payload");
  return {
    attemptId: normalizeAttemptId(payload.attemptId),
    expectedRevision: positiveInteger(payload.expectedRevision, "expectedRevision"),
    answers: normalizeAnswers(payload.answers),
    currentItemId: optionalText(payload.currentItemId, "currentItemId", 160),
    saveId: text(payload.saveId, "saveId", 100),
    ...(payload.analytics !== undefined ? { analytics: learning.normalizeAnalytics(payload.analytics) } : {}),
    testDelayAfterSessionMs,
    testAuthorizedSignalId,
    testDropResponseAfterCommit,
  };
};

const normalizeQueryRequest = (data) => {
  const payload = { ...(data || {}) };
  delete payload._session;
  if ("semesterId" in payload) {
    assertAllowedKeys(payload, ["semesterId"], "getAssessmentState class query payload");
    return { semesterId: semesterCore.normalizeSemesterId(payload.semesterId) };
  }
  assertAllowedKeys(payload, ["definitionId", "attemptId"], "getAssessmentState payload");
  if (!payload.definitionId && !payload.attemptId) fail("invalid-argument", "definitionId or attemptId is required.", "ASSESSMENT_QUERY_INVALID");
  return {
    definitionId: payload.definitionId ? normalizeDefinitionId(payload.definitionId) : "",
    attemptId: payload.attemptId ? normalizeAttemptId(payload.attemptId) : "",
  };
};

const createAssessmentQueryCore = ({ store, assertSession = sessionAuthority.assertActiveApplicationSession, serverTimestamp, now = () => new Date(), projectId = "" }) => {
  if (!store) throw new TypeError("store is required.");
  const actorFor = async (request) => {
    const identity = await assertSession(request, { recentAuth: false, highRisk: false });
    const uid = String(identity?.uid || request.auth?.uid || "").trim();
    if (!uid || uid !== String(request.auth?.uid || "").trim()) fail("permission-denied", "Authenticated actor mismatch.", "COMMAND_ACTOR_MISMATCH");
    const profile = await store.get(`users/${uid}`);
    const role = String(profile.data?.role || "student");
    const teacherPortalEnabled = profile.data?.teacherPortalEnabled === true;
    const canReadQuizManagement = ["teacher", "admin"].includes(role)
      || (teacherPortalEnabled && Array.isArray(profile.data?.staffPermissions) && profile.data.staffPermissions.includes("quiz_read"));
    return { uid, role, teacherPortalEnabled, canReadQuizManagement };
  };

  const getAssessmentState = async (request) => {
    const actor = await actorFor(request);
    const query = normalizeQueryRequest(request.data || {});
    if (query.semesterId) {
      if (!actor.canReadQuizManagement) fail("permission-denied", "Assessment management permission is required.", "ASSESSMENT_MANAGE_REQUIRED");
      return store.runTransaction(async (transaction) => {
        await assertAssessmentSemesterWritable(transaction, query.semesterId);
        const documents = await transaction.query(archiveEnrollment.SEMESTER_CLASS_COLLECTION, {
          field: "semesterId", operator: "==", value: query.semesterId,
        });
        const classes = documents
          .filter((document) => document.data?.status === "ACTIVE" && document.data?.readOnly !== true)
          .map((document) => ({
            classId: String(document.data?.classId || document.path.split("/").at(-1) || "").trim(),
            grade: String(document.data?.grade || "").trim(),
            classNumber: String(document.data?.classNumber || "").trim(),
          }))
          .filter((entry) => entry.classId && entry.grade && entry.classNumber)
          .sort((left, right) => left.grade.localeCompare(right.grade, "ko", { numeric: true })
            || left.classNumber.localeCompare(right.classNumber, "ko", { numeric: true }) || left.classId.localeCompare(right.classId));
        return { semesterId: query.semesterId, classes };
      });
    }
    return store.runTransaction(async (transaction) => {
      const attemptSnapshot = query.attemptId ? await transaction.get(attemptPath(query.attemptId)) : null;
      if (attemptSnapshot?.exists && attemptSnapshot.data?.studentUid !== actor.uid && !actor.teacherPortalEnabled && actor.role !== "admin") fail("permission-denied", "Assessment attempt is not visible.", "ASSESSMENT_ATTEMPT_FORBIDDEN");
      const definitionId = query.definitionId || attemptSnapshot?.data?.definitionId || "";
      const definitionSnapshot = definitionId ? await transaction.get(definitionPath(definitionId)) : null;
      if (!definitionSnapshot?.exists) return { status: "INVALID_LINK", definition: null, attempt: null, serverNowIso: now().toISOString(), writeCount: 0 };
      if (attemptSnapshot?.exists && (attemptSnapshot.data?.definitionId !== definitionId || attemptSnapshot.data?.semesterId !== definitionSnapshot.data?.semesterId)) {
        fail("permission-denied", "Assessment attempt does not belong to the requested definition and semester.", "ASSESSMENT_QUERY_SCOPE_MISMATCH");
      }
      if (actor.role === "student") {
        await assertAssessmentSemesterWritable(transaction, definitionSnapshot.data?.semesterId);
      }
      let ownAttempt = attemptSnapshot;
      if (!ownAttempt && actor.role === "student") {
        const attempts = (await transaction.query(ATTEMPT_COLLECTION, { filters: [
          { field: "definitionId", operator: "==", value: definitionId },
          { field: "studentUid", operator: "==", value: actor.uid },
        ] })).filter((document) => document.data?.studentUid === actor.uid && document.data?.resetAt == null).sort((left, right) => Number(right.data?.attemptNumber || 0) - Number(left.data?.attemptNumber || 0));
        ownAttempt = attempts[0] || null;
      }
      const definition = definitionSnapshot.data || {};
      let status = definition.status === "PUBLISHED" ? "READY" : "NOT_OPEN";
      const manifest = await transaction.get(manifestPath(definition.semesterId));
      const currentTimeMs = now().getTime();
      if (manifest.data?.status === "ARCHIVED" || manifest.data?.status === "CLOSED") status = "ARCHIVED";
      else if (definition.status === "CLOSED" || (definition.closesAt && currentTimeMs > Date.parse(definition.closesAt))) status = "CLOSED";
      else if (definition.status !== "PUBLISHED" || (definition.opensAt && currentTimeMs < Date.parse(definition.opensAt))) status = "NOT_OPEN";
      if (actor.role === "student" && status === "READY") {
        const [pointer, slot] = await transaction.getAll([
          semesterCore.ACTIVE_SEMESTER_POINTER_PATH,
          slotPath(definition.semesterId, actor.uid),
        ]);
        const activeEnrollmentId = String(slot.data?.activeEnrollmentId || "").trim();
        const enrollment = activeEnrollmentId ? await transaction.get(enrollmentPath(activeEnrollmentId)) : null;
        const assignedClassIds = Array.isArray(definition.assignedClassIds) ? definition.assignedClassIds : [];
        const assignedStudentUids = Array.isArray(definition.assignedStudentUids) ? definition.assignedStudentUids : [];
        const eligible = pointer.exists
          && manifest.exists
          && pointer.data?.semesterId === definition.semesterId
          && manifest.data?.status === "ACTIVE"
          && Number(pointer.data?.revision || 0) === Number(manifest.data?.revision || 0)
          && slot.exists
          && enrollment?.exists
          && enrollment.data?.studentUid === actor.uid
          && enrollment.data?.semesterId === definition.semesterId
          && enrollment.data?.enrollmentStatus === "ACTIVE"
          && (definition.assessmentKind === "QUIZ" ? assignedClassIds.includes(enrollment.data?.classId) : assignedClassIds.length === 0 || assignedClassIds.includes(enrollment.data?.classId))
          && (assignedStudentUids.length === 0 || assignedStudentUids.includes(actor.uid));
        if (!eligible) status = "PERMISSION";
      }
      if (ownAttempt?.exists && ["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(ownAttempt.data?.status)) status = "RECOVERABLE";
      if (ownAttempt?.exists && ownAttempt.data?.status === "SUBMITTED") status = "SUBMITTED";
      const attempt = ownAttempt?.exists ? serializeAttempt(ownAttempt.data, true) : null;
      if (attempt && ownAttempt.data.assessmentKind === "QUIZ" && ["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(ownAttempt.data.status)) {
        const frozenIds = new Set((attempt.questionPresentation || []).map(item => item.id));
        const missingIds = attempt.questionIds.filter(id => !frozenIds.has(id));
        if (missingIds.length) {
          // Legacy/base64-heavy attempts may lack stored presentation snapshots.
          // Read only this attempt's selected questions and require the exact
          // grading revision before exposing answer-free presentation data.
          const documents = await transaction.getAll(missingIds.map(id => `${semesterRoot(definition.semesterId)}/quiz_questions/${ownAttempt.data.questionDocumentIds?.[id] || id}`));
          const grading = new Map((ownAttempt.data.gradingSnapshot || []).map(item => [String(item.id), item]));
          const matching = documents.filter(document => {
            if (!document.exists) return false;
            const item = extractQuizQuestion(document), expected = grading.get(item.id);
            return expected && item.answer === expected.answer && item.sourceRevision === String(expected.sourceRevision || "legacy")
              && document.data.unitId === definition.sourceId && (!definition.category || document.data.category === definition.category);
          });
          const fallback = learning.captureQuestionSnapshots(matching, missingIds, {}, { responseOnly: true });
          attempt.questionPresentation = [...(attempt.questionPresentation || []), ...learning.questionPresentation(fallback.questionSnapshots)];
          attempt.questionSnapshotOmittedIds = fallback.questionSnapshotOmittedIds;
        }
      }
      return {
        status,
        definition: {
          definitionId: definition.definitionId,
          semesterId: definition.semesterId,
          assessmentKind: definition.assessmentKind,
          title: definition.title,
          status: definition.status,
          revision: definition.revision,
          durationSeconds: definition.durationSeconds,
          maxAttempts: definition.maxAttempts,
          cooldownMinutes: definition.cooldownMinutes,
          opensAt: definition.opensAt,
          closesAt: definition.closesAt,
          itemCount: definition.itemCount,
          questionCount: definition.questionCount || definition.itemCount,
          ...(definition.assessmentKind === "QUIZ" ? { presentationSettings: definition.presentationSettings || null } : {}),
          provenance: definition.semesterId,
        },
        attempt,
        serverNowIso: now().toISOString(),
        writeCount: 0,
      };
    });
  };

  const saveAssessmentProgress = async (request) => {
    const actor = await actorFor(request);
    if (actor.role !== "student") fail("permission-denied", "A student account is required.", "ASSESSMENT_STUDENT_REQUIRED");
    const payload = normalizeSaveRequest(request.data || {}, projectId);
    if (payload.testAuthorizedSignalId) {
      if (typeof store.set !== "function") throw new TypeError("store.set is required for demo test signaling.");
      await store.set(`__w6a_test_signals/${payload.testAuthorizedSignalId}`, {
        state: "AUTHORIZED",
        createdAt: serverTimestamp(),
      });
    }
    if (payload.testDelayAfterSessionMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, payload.testDelayAfterSessionMs));
    }
    const result = await store.runTransaction(async (transaction) => {
      const path = attemptPath(payload.attemptId);
      const snapshot = await transaction.get(path);
      if (!snapshot.exists) fail("not-found", "Assessment attempt was not found.", "ASSESSMENT_ATTEMPT_NOT_FOUND");
      const attempt = snapshot.data || {};
      if (attempt.studentUid !== actor.uid) fail("permission-denied", "Assessment attempt belongs to another student.", "ASSESSMENT_ATTEMPT_FORBIDDEN");
      await assertAssessmentSemesterWritable(transaction, attempt.semesterId);
      const saveHash = sha256(canonicalJson({ answers: payload.answers, currentItemId: payload.currentItemId,
        ...(payload.analytics !== undefined ? { analytics: payload.analytics } : {}) }));
      if (attempt.lastSaveId === payload.saveId) {
        if (attempt.lastSaveHash !== saveHash) fail("already-exists", "saveId was reused with different progress.", "ASSESSMENT_SAVE_ID_CONFLICT");
        return { attemptId: attempt.attemptId, status: attempt.status, revision: attempt.revision, deadlineAtIso: attempt.deadlineAtIso, savedAtIso: attempt.lastSavedAtIso, replayed: true };
      }
      if (!["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(attempt.status)) fail("failed-precondition", "Assessment attempt cannot be saved.", "ASSESSMENT_ATTEMPT_NOT_WRITABLE");
      if (Number(attempt.revision || 0) !== payload.expectedRevision) fail("aborted", "Assessment attempt revision changed.", "ASSESSMENT_ATTEMPT_REVISION_CONFLICT", { currentRevision: Number(attempt.revision || 0) });
      const savedAt = now();
      if (savedAt.getTime() > Date.parse(attempt.deadlineAtIso)) {
        fail("deadline-exceeded", "The authoritative assessment deadline has passed.", "ASSESSMENT_DEADLINE_EXPIRED");
      }
      const savedAtIso = savedAt.toISOString();
      const revision = payload.expectedRevision + 1;
      const analytics = attempt.assessmentKind === "QUIZ" && payload.analytics !== undefined
        ? { analytics: learning.normalizeAnalytics(payload.analytics, attempt, savedAt.getTime(), payload.answers) } : {};
      transaction.set(path, { status: "IN_PROGRESS", revision, answers: payload.answers, ...analytics, currentItemId: payload.currentItemId, lastSaveId: payload.saveId, lastSaveHash: saveHash, lastSavedAtIso: savedAtIso, updatedAt: serverTimestamp() }, { merge: true });
      return { attemptId: attempt.attemptId, status: "IN_PROGRESS", revision, deadlineAtIso: attempt.deadlineAtIso, savedAtIso, replayed: false };
    });
    if (payload.testDropResponseAfterCommit) {
      fail("unavailable", "Synthetic assessment save response loss.", "TEST_RESPONSE_LOSS");
    }
    return result;
  };
  return { getAssessmentState, saveAssessmentProgress };
};

const createAssessmentCallableExports = ({ core }) => ({
  getAssessmentState: onCall({ region: REGION }, (request) => core.getAssessmentState(request)),
  saveAssessmentProgress: onCall({ region: REGION }, (request) => core.saveAssessmentProgress(request)),
});

const createAssessmentReadinessAdapter = () => ({
  evaluate: async ({ transaction, manifest }) => {
    const semesterId = String(manifest?.semesterId || "").trim();
    const definitions = await transaction.query(DEFINITION_COLLECTION, { field: "semesterId", operator: "==", value: semesterId });
    const classes = await transaction.query(archiveEnrollment.SEMESTER_CLASS_COLLECTION, { field: "semesterId", operator: "==", value: semesterId });
    const legacyIssues = await transaction.query(LEGACY_ISSUE_COLLECTION, { field: "semesterId", operator: "==", value: semesterId });
    const classById = new Map(classes.map((document) => [
      String(document.data?.classId || document.path.split("/").at(-1) || "").trim(),
      document.data || {},
    ]));
    const logicalKeys = new Set();
    let unsupportedSchemaCount = 0;
    let invalidSemesterCount = 0;
    let orphanClassReferenceCount = 0;
    let invalidWindowCount = 0;
    let invalidPublicationCount = 0;
    let duplicateKeyCount = 0;
    const dependencyRows = [];
    for (const document of definitions) {
      const value = document.data || {};
      const assignedClassIds = Array.isArray(value.assignedClassIds) ? value.assignedClassIds : [];
      if (value.schemaVersion !== ASSESSMENT_SCHEMA_VERSION || value.policyVersion !== ASSESSMENT_POLICY_VERSION) unsupportedSchemaCount += 1;
      if (value.semesterId !== semesterId || !/^\d{4}-[12]$/.test(String(value.semesterId || ""))) invalidSemesterCount += 1;
      orphanClassReferenceCount += assignedClassIds.filter((classId) => {
        const target = classById.get(String(classId));
        return !target || target.semesterId !== semesterId || target.status !== "ACTIVE";
      }).length;
      const opensAt = String(value.opensAt || "");
      const closesAt = String(value.closesAt || "");
      const opensMs = opensAt ? Date.parse(opensAt) : Number.NaN;
      const closesMs = closesAt ? Date.parse(closesAt) : Number.NaN;
      if (
        (opensAt && !Number.isFinite(opensMs))
        || (closesAt && !Number.isFinite(closesMs))
        || (opensAt && closesAt && opensMs >= closesMs)
      ) invalidWindowCount += 1;
      const publishedInvalid = value.status === "PUBLISHED" && (
        !value.sourceHash
        || Number(value.itemCount || 0) < 1
        || Number(value.durationSeconds || 0) < 1
        || Number(value.maxAttempts || 0) < 1
        || (value.assessmentKind === "QUIZ" && assignedClassIds.length === 0)
      );
      // An unpublished quiz may save its settings before any questions exist.
      // This exact empty-source shape is not a valid paused/closed publication
      // or a substitute for a missing source snapshot on other definitions.
      const unpreparedQuizDraft = value.assessmentKind === "QUIZ"
        && value.status === "DRAFT"
        && value.presentationSettings?.active === false
        && value.sourceHash === ""
        && value.itemCount === 0;
      if (
        !["DRAFT", "PUBLISHED", "PAUSED", "CLOSED"].includes(value.status)
        || !["QUIZ", "HISTORY_CLASSROOM"].includes(value.assessmentKind)
        || !value.definitionId
        || (!unpreparedQuizDraft && (!value.sourceHash || Number(value.itemCount || 0) < 1))
        || new Set(assignedClassIds).size !== assignedClassIds.length
        || publishedInvalid
      ) invalidPublicationCount += 1;
      const logicalKey = [value.assessmentKind, value.sourceId, value.category || "", value.examRound || ""].join("|");
      if (logicalKeys.has(logicalKey)) duplicateKeyCount += 1;
      logicalKeys.add(logicalKey);
      dependencyRows.push({
        definitionId: value.definitionId || document.path,
        revision: Number(value.revision || 0),
        status: value.status || "",
        sourceHash: value.sourceHash || "",
        assignedClassIds: [...assignedClassIds].sort(),
        opensAt,
        closesAt,
      });
    }
    const blockingLegacyIssues = legacyIssues.filter((document) => !["RESOLVED", "DISMISSED"].includes(String(document.data?.status || "OPEN")));
    const invalidCount = unsupportedSchemaCount
      + invalidSemesterCount
      + orphanClassReferenceCount
      + invalidWindowCount
      + invalidPublicationCount
      + duplicateKeyCount
      + blockingLegacyIssues.length;
    const dependencyHash = sha256(canonicalJson({
      definitions: dependencyRows.sort((left, right) => String(left.definitionId).localeCompare(String(right.definitionId))),
      classes: [...classById.entries()].map(([classId, value]) => ({ classId, status: value.status || "", semesterId: value.semesterId || "" })).sort((left, right) => left.classId.localeCompare(right.classId)),
      legacyIssues: legacyIssues.map((document) => ({ id: document.path.split("/").at(-1), status: document.data?.status || "OPEN" })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
    }));
    return [{
      checkId: "assessment_readiness",
      label: "Assessment lifecycle readiness",
      category: "ASSESSMENT",
      required: true,
      status: invalidCount === 0 ? "PASS" : "FAIL",
      evidence: `applicability=${definitions.length === 0 ? "NOT_APPLICABLE" : "APPLICABLE"}; definitions=${definitions.length}; unsupportedSchema=${unsupportedSchemaCount}; invalidSemester=${invalidSemesterCount}; orphanClassRefs=${orphanClassReferenceCount}; invalidWindows=${invalidWindowCount}; invalidPublication=${invalidPublicationCount}; duplicateKeys=${duplicateKeyCount}; blockingLegacyIssues=${blockingLegacyIssues.length}; dependency=${dependencyHash}`,
      failureReason: invalidCount === 0 ? null : "ASSESSMENT_READINESS_NOT_PASS",
      ownerWave: "W6A",
    }];
  },
});

module.exports = {
  ASSESSMENT_COMMAND_TYPES,
  ASSESSMENT_POLICY_VERSION,
  ASSESSMENT_SCHEMA_VERSION,
  ATTEMPT_COLLECTION,
  DEFINITION_COLLECTION,
  RESULT_COLLECTION,
  LEGACY_ISSUE_COLLECTION,
  STUDENT_COMMAND_TYPES,
  SUBMISSION_COLLECTION,
  createAssessmentCallableExports,
  createAssessmentCommandAdapter,
  createAssessmentQueryCore,
  createAssessmentReadinessAdapter,
  normalizeAssessmentPayload,
  serializeAttempt,
};
