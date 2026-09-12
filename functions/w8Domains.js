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
const W8_SCHEMA_VERSION = 1;
const W8_POLICY_VERSION = "w8-v1";
const THINK_CLOUD_RESPONSE_LIMIT = 200;

const LEARNING_CONTENT_COLLECTION = "semester_learning_contents";
const LEARNING_PROGRESS_COLLECTION = "semester_learning_progress";
const LEARNING_EXEMPTION_COLLECTION = "semester_learning_exemptions";
const LEARNING_EXEMPTION_REQUEST_COLLECTION =
  "semester_learning_exemption_requests";
const SCHEDULE_EVENT_COLLECTION = "semester_schedule_events";
const ATTENDANCE_SESSION_COLLECTION = "semester_attendance_sessions";
const ATTENDANCE_RECORD_COLLECTION = "semester_attendance_records";
const ATTENDANCE_REVISION_COLLECTION = "semester_attendance_revisions";
const NOTICE_COLLECTION = "semester_notices";
const NOTICE_DELIVERY_COLLECTION = "semester_notice_deliveries";
const NOTICE_ACK_COLLECTION = "semester_notice_acknowledgements";
const W8_LEGACY_ISSUE_COLLECTION = "w8_legacy_issues";
const NOTIFICATION_CONFIG_PATH = "site_settings/notification_config";

const W8_COMMAND_TYPES = Object.freeze({
  CREATE_LEARNING_CONTENT: "createLearningContent",
  UPDATE_LEARNING_CONTENT: "updateLearningContent",
  TRANSITION_LEARNING_CONTENT: "transitionLearningContent",
  RECORD_LEARNING_PROGRESS: "recordLearningProgress",
  REQUEST_LEARNING_EXEMPTION: "requestLearningExemption",
  RESET_LEARNING_PROGRESS: "resetLearningProgress",
  GRANT_LEARNING_EXEMPTIONS: "grantLearningExemptions",
  REVOKE_LEARNING_EXEMPTIONS: "revokeLearningExemptions",
  REVIEW_LEARNING_EXEMPTION_REQUEST: "reviewLearningExemptionRequest",
  CREATE_SCHEDULE_EVENT: "createScheduleEvent",
  UPDATE_SCHEDULE_EVENT: "updateScheduleEvent",
  DELETE_SCHEDULE_EVENT: "deleteScheduleEvent",
  CREATE_ATTENDANCE_SESSION: "createAttendanceSession",
  RECORD_ATTENDANCE: "recordAttendance",
  RECORD_ATTENDANCE_BULK: "recordAttendanceBulk",
  CORRECT_ATTENDANCE_RECORD: "correctAttendanceRecord",
  CLOSE_ATTENDANCE_SESSION: "closeAttendanceSession",
  CREATE_NOTICE: "createNotice",
  UPDATE_NOTICE: "updateNotice",
  TRANSITION_NOTICE: "transitionNotice",
  ACKNOWLEDGE_NOTICE: "acknowledgeNotice",
  ACKNOWLEDGE_ALL_NOTICES: "acknowledgeAllNotices",
  UPDATE_NOTIFICATION_SETTINGS: "updateNotificationSettings",
  CREATE_THINK_CLOUD_SESSION: "createThinkCloudSession",
  TRANSITION_THINK_CLOUD_SESSION: "transitionThinkCloudSession",
  DELETE_THINK_CLOUD_SESSION: "deleteThinkCloudSession",
  SUBMIT_THINK_CLOUD_RESPONSE: "submitThinkCloudResponse",
});

const STUDENT_COMMAND_TYPES = new Set([
  W8_COMMAND_TYPES.RECORD_LEARNING_PROGRESS,
  W8_COMMAND_TYPES.REQUEST_LEARNING_EXEMPTION,
  W8_COMMAND_TYPES.ACKNOWLEDGE_NOTICE,
  W8_COMMAND_TYPES.ACKNOWLEDGE_ALL_NOTICES,
  W8_COMMAND_TYPES.SUBMIT_THINK_CLOUD_RESPONSE,
]);
const ADMIN_COMMAND_TYPES = new Set([
  W8_COMMAND_TYPES.UPDATE_NOTIFICATION_SETTINGS,
]);
const W8_READINESS_CHECK_IDS = Object.freeze([
  "learning_domain_readiness",
  "schedule_domain_readiness",
  "attendance_domain_readiness",
  "communication_domain_readiness",
]);
const HIGH_RISK_COMMAND_TYPES = new Set(
  Object.values(W8_COMMAND_TYPES).filter(
    (commandType) => !STUDENT_COMMAND_TYPES.has(commandType),
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
      "W8_PAYLOAD_INVALID",
    );
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  if (extra.length)
    fail(
      "invalid-argument",
      `${label} contains unsupported fields.`,
      "W8_PAYLOAD_INVALID",
      { fields: extra },
    );
};
const text = (value, label, max = 160, allowSlash = false) => {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > max ||
    (!allowSlash && value.includes("/"))
  ) {
    fail("invalid-argument", `${label} is invalid.`, "W8_PAYLOAD_INVALID", {
      field: label,
    });
  }
  return value;
};
const optionalText = (value, label, max = 1000, allowSlash = false) =>
  value === undefined || value === null || value === ""
    ? ""
    : text(value, label, max, allowSlash);
const integer = (
  value,
  label,
  { min = 0, max = Number.MAX_SAFE_INTEGER } = {},
) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail("invalid-argument", `${label} is invalid.`, "W8_PAYLOAD_INVALID", {
      field: label,
    });
  return value;
};
const revision = (value, label = "expectedRevision") =>
  integer(value, label, { min: 1 });
const nullableRevision = (value, label) =>
  value === null ? null : revision(value, label);
const legacyRevision = (value, label) => integer(value, label, { min: 0 });
const nullableLegacyRevision = (value, label) =>
  value === null ? null : legacyRevision(value, label);
const semesterId = (value) => semesterCore.normalizeSemesterId(value);
const stringList = (value, label, max = 100) => {
  if (!Array.isArray(value) || value.length > max)
    fail("invalid-argument", `${label} is invalid.`, "W8_PAYLOAD_INVALID");
  const normalized = value.map((entry, index) =>
    text(entry, `${label}[${index}]`, 180),
  );
  if (new Set(normalized).size !== normalized.length)
    fail(
      "invalid-argument",
      `${label} contains duplicates.`,
      "W8_PAYLOAD_INVALID",
    );
  return normalized;
};
const enumValue = (value, allowedValues, label) => {
  if (!allowedValues.includes(value))
    fail("invalid-argument", `${label} is invalid.`, "W8_PAYLOAD_INVALID", {
      field: label,
    });
  return value;
};
const iso = (value, label, optional = false) => {
  if (optional && (value === undefined || value === null || value === ""))
    return "";
  const normalized = text(value, label, 40);
  if (Number.isNaN(Date.parse(normalized)))
    fail("invalid-argument", `${label} is invalid.`, "W8_PAYLOAD_INVALID", {
      field: label,
    });
  return new Date(normalized).toISOString();
};
const optionalHttpsUrl = (value, label) => {
  const normalized = optionalText(value, label, 1000, true);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:") throw new Error("protocol");
  } catch {
    fail(
      "invalid-argument",
      `${label} must be an HTTPS URL.`,
      "W8_PAYLOAD_INVALID",
      { field: label },
    );
  }
  return normalized;
};
const dateKey = (value, label = "date") => {
  const normalized = text(value, label, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized) ||
    new Date(`${normalized}T00:00:00.000Z`).toISOString().slice(0, 10) !==
      normalized
  ) {
    fail("invalid-argument", `${label} is invalid.`, "W8_PAYLOAD_INVALID", {
      field: label,
    });
  }
  return normalized;
};
const kstDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const boolean = (value, label) => {
  if (typeof value !== "boolean")
    fail("invalid-argument", `${label} is invalid.`, "W8_PAYLOAD_INVALID", {
      field: label,
    });
  return value;
};
const hashId = (prefix, ...parts) => `${prefix}_${sha256(parts.join("\n"))}`;
const commonPayload = (payload) => ({
  semesterId: semesterId(payload.semesterId),
  expectedSemesterRevision: revision(
    payload.expectedSemesterRevision,
    "expectedSemesterRevision",
  ),
});
const cutoverContext = (payload) => {
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
  if (!cutoverPlanId && !cutoverOperationKey) return {};
  if (!cutoverPlanId || !cutoverOperationKey) {
    fail(
      "invalid-argument",
      "cutoverPlanId and cutoverOperationKey must be provided together.",
      "W8_PAYLOAD_INVALID",
    );
  }
  return { cutoverPlanId, cutoverOperationKey };
};
const editableLearning = (payload) => {
  const availableFrom = iso(payload.availableFrom, "availableFrom", true);
  const availableUntil = iso(payload.availableUntil, "availableUntil", true);
  if (availableFrom && availableUntil && availableFrom > availableUntil)
    fail(
      "invalid-argument",
      "Learning availability range is invalid.",
      "W8_DATE_RANGE_INVALID",
    );
  const audienceRoles = stringList(
    payload.audienceRoles,
    "audienceRoles",
    4,
  ).map((role) => enumValue(role, ["student", "teacher"], "audienceRole"));
  if (audienceRoles.length === 0)
    fail(
      "invalid-argument",
      "Learning content requires at least one audience role.",
      "W8_AUDIENCE_REQUIRED",
    );
  return {
    title: text(payload.title, "title", 200, true),
    summary: optionalText(payload.summary, "summary", 2000, true),
    body: text(payload.body, "body", 20_000, true),
    resourceUrl: optionalHttpsUrl(payload.resourceUrl, "resourceUrl"),
    contentType: enumValue(
      payload.contentType,
      [
        "LESSON",
        "RESOURCE",
        "VIDEO",
        "ACTIVITY",
        "HISTORY_SOURCE",
        "DICTIONARY",
      ],
      "contentType",
    ),
    audienceRoles,
    targetClassIds: stringList(payload.targetClassIds, "targetClassIds"),
    availableFrom,
    availableUntil,
  };
};
const editableSchedule = (payload) => {
  const startAt = iso(payload.startAt, "startAt");
  const endAt = iso(payload.endAt, "endAt");
  if (startAt > endAt)
    fail(
      "invalid-argument",
      "Schedule range is invalid.",
      "W8_DATE_RANGE_INVALID",
    );
  return {
    eventType: enumValue(
      payload.eventType,
      [
        "CLASS",
        "SCHOOL",
        "ASSESSMENT",
        "LEARNING_DEADLINE",
        "NOTICE",
        "HOLIDAY",
        "PERSONAL",
      ],
      "eventType",
    ),
    title: text(payload.title, "title", 200, true),
    description: optionalText(payload.description, "description", 3000, true),
    startAt,
    endAt,
    allDay: boolean(payload.allDay, "allDay"),
    period: optionalText(payload.period, "period", 40),
    targetClassIds: stringList(payload.targetClassIds, "targetClassIds"),
    targetUserIds: stringList(payload.targetUserIds, "targetUserIds"),
    sourceDomain: enumValue(
      payload.sourceDomain,
      ["USER", "LEARNING", "ASSESSMENT", "NOTICE", "HOLIDAY", "TIMETABLE"],
      "sourceDomain",
    ),
    sourceReference: optionalText(
      payload.sourceReference,
      "sourceReference",
      240,
    ),
  };
};
const editableNotice = (payload) => {
  const publishAt = iso(payload.publishAt, "publishAt", true);
  const expireAt = iso(payload.expireAt, "expireAt", true);
  if (publishAt && expireAt && publishAt > expireAt)
    fail(
      "invalid-argument",
      "Notice publication range is invalid.",
      "W8_DATE_RANGE_INVALID",
    );
  const targetRoles = stringList(payload.targetRoles, "targetRoles", 1).map(
    (role) => enumValue(role, ["student"], "targetRole"),
  );
  if (targetRoles.length !== 1 || targetRoles[0] !== "student")
    fail(
      "invalid-argument",
      "W8 v1 Notice target role must be student.",
      "W8_AUDIENCE_REQUIRED",
    );
  return {
    title: text(payload.title, "title", 200, true),
    content: text(payload.content, "content", 20_000, true),
    targetRoles,
    targetClassIds: stringList(payload.targetClassIds, "targetClassIds"),
    targetUserIds: stringList(payload.targetUserIds, "targetUserIds"),
    publishAt,
    expireAt,
    priority: enumValue(payload.priority, ["NORMAL", "HIGH"], "priority"),
  };
};
const editableThinkCloudOptions = (value) => {
  allowed(
    value,
    [
      "allowDuplicateWord",
      "allowDuplicateByStudent",
      "inputMode",
      "anonymous",
      "maxLength",
      "profanityFilter",
    ],
    "thinkCloud options",
  );
  return {
    allowDuplicateWord: boolean(
      value.allowDuplicateWord,
      "options.allowDuplicateWord",
    ),
    allowDuplicateByStudent: boolean(
      value.allowDuplicateByStudent,
      "options.allowDuplicateByStudent",
    ),
    inputMode: enumValue(
      value.inputMode,
      ["word", "sentence"],
      "options.inputMode",
    ),
    anonymous: boolean(value.anonymous, "options.anonymous"),
    maxLength: integer(value.maxLength, "options.maxLength", {
      min: 5,
      max: 100,
    }),
    profanityFilter: boolean(value.profanityFilter, "options.profanityFilter"),
  };
};

const normalizeW8Payload = (commandType, raw) => {
  const payload = raw || {};
  const common = ["semesterId", "expectedSemesterRevision"];
  if (commandType === W8_COMMAND_TYPES.CREATE_LEARNING_CONTENT) {
    allowed(
      payload,
      [
        ...common,
        "cutoverPlanId",
        "cutoverOperationKey",
        "title",
        "summary",
        "body",
        "resourceUrl",
        "contentType",
        "audienceRoles",
        "targetClassIds",
        "availableFrom",
        "availableUntil",
      ],
      "createLearningContent payload",
    );
    return {
      ...commonPayload(payload),
      ...cutoverContext(payload),
      ...editableLearning(payload),
    };
  }
  if (commandType === W8_COMMAND_TYPES.UPDATE_LEARNING_CONTENT) {
    allowed(
      payload,
      [
        ...common,
        "contentId",
        "expectedContentRevision",
        "title",
        "summary",
        "body",
        "resourceUrl",
        "contentType",
        "audienceRoles",
        "targetClassIds",
        "availableFrom",
        "availableUntil",
      ],
      "updateLearningContent payload",
    );
    return {
      ...commonPayload(payload),
      contentId: text(payload.contentId, "contentId", 80),
      expectedContentRevision: revision(
        payload.expectedContentRevision,
        "expectedContentRevision",
      ),
      ...editableLearning(payload),
    };
  }
  if (commandType === W8_COMMAND_TYPES.TRANSITION_LEARNING_CONTENT) {
    allowed(
      payload,
      [
        ...common,
        "contentId",
        "expectedContentRevision",
        "targetStatus",
        "reason",
      ],
      "transitionLearningContent payload",
    );
    return {
      ...commonPayload(payload),
      contentId: text(payload.contentId, "contentId", 80),
      expectedContentRevision: revision(
        payload.expectedContentRevision,
        "expectedContentRevision",
      ),
      targetStatus: enumValue(
        payload.targetStatus,
        ["READY", "PUBLISHED", "CLOSED", "ARCHIVED"],
        "targetStatus",
      ),
      reason: text(payload.reason, "reason", 500, true),
    };
  }
  if (commandType === W8_COMMAND_TYPES.RECORD_LEARNING_PROGRESS) {
    allowed(
      payload,
      [
        ...common,
        "contentId",
        "expectedContentRevision",
        "enrollmentId",
        "expectedProgressRevision",
        "event",
      ],
      "recordLearningProgress payload",
    );
    return {
      ...commonPayload(payload),
      contentId: text(payload.contentId, "contentId", 80),
      expectedContentRevision: revision(
        payload.expectedContentRevision,
        "expectedContentRevision",
      ),
      enrollmentId: text(payload.enrollmentId, "enrollmentId", 180),
      expectedProgressRevision: nullableRevision(
        payload.expectedProgressRevision,
        "expectedProgressRevision",
      ),
      event: enumValue(payload.event, ["START", "COMPLETE"], "event"),
    };
  }
  if (commandType === W8_COMMAND_TYPES.REQUEST_LEARNING_EXEMPTION) {
    allowed(
      payload,
      [
        ...common,
        "contentId",
        "expectedContentRevision",
        "enrollmentId",
        "reason",
      ],
      "requestLearningExemption payload",
    );
    return {
      ...commonPayload(payload),
      contentId: text(payload.contentId, "contentId", 80),
      expectedContentRevision: revision(
        payload.expectedContentRevision,
        "expectedContentRevision",
      ),
      enrollmentId: text(payload.enrollmentId, "enrollmentId", 180),
      reason: text(payload.reason, "reason", 500, true),
    };
  }
  if (commandType === W8_COMMAND_TYPES.RESET_LEARNING_PROGRESS) {
    allowed(
      payload,
      [...common, "studentUid", "enrollmentId", "entries", "reason"],
      "resetLearningProgress payload",
    );
    if (
      !Array.isArray(payload.entries) ||
      payload.entries.length < 1 ||
      payload.entries.length > 100
    )
      fail("invalid-argument", "entries is invalid.", "W8_PAYLOAD_INVALID");
    const entries = payload.entries.map((entry, index) => {
      allowed(
        entry,
        ["contentId", "expectedProgressRevision"],
        `entries[${index}]`,
      );
      return {
        contentId: text(entry.contentId, `entries[${index}].contentId`, 80),
        expectedProgressRevision: revision(
          entry.expectedProgressRevision,
          `entries[${index}].expectedProgressRevision`,
        ),
      };
    });
    return {
      ...commonPayload(payload),
      studentUid: text(payload.studentUid, "studentUid", 180),
      enrollmentId: text(payload.enrollmentId, "enrollmentId", 180),
      entries,
      reason: text(payload.reason, "reason", 500, true),
    };
  }
  if (commandType === W8_COMMAND_TYPES.GRANT_LEARNING_EXEMPTIONS) {
    allowed(
      payload,
      [
        ...common,
        "contentId",
        "expectedContentRevision",
        "enrollmentIds",
        "reason",
      ],
      "grantLearningExemptions payload",
    );
    return {
      ...commonPayload(payload),
      contentId: text(payload.contentId, "contentId", 80),
      expectedContentRevision: revision(
        payload.expectedContentRevision,
        "expectedContentRevision",
      ),
      enrollmentIds: stringList(payload.enrollmentIds, "enrollmentIds"),
      reason: text(payload.reason, "reason", 500, true),
    };
  }
  if (commandType === W8_COMMAND_TYPES.REVOKE_LEARNING_EXEMPTIONS) {
    allowed(
      payload,
      [...common, "items", "reason"],
      "revokeLearningExemptions payload",
    );
    if (
      !Array.isArray(payload.items) ||
      payload.items.length < 1 ||
      payload.items.length > 100
    )
      fail("invalid-argument", "items is invalid.", "W8_PAYLOAD_INVALID");
    return {
      ...commonPayload(payload),
      items: payload.items.map((item, index) => {
        allowed(
          item,
          ["exemptionId", "expectedExemptionRevision"],
          `items[${index}]`,
        );
        return {
          exemptionId: text(
            item.exemptionId,
            `items[${index}].exemptionId`,
            80,
          ),
          expectedExemptionRevision: revision(
            item.expectedExemptionRevision,
            `items[${index}].expectedExemptionRevision`,
          ),
        };
      }),
      reason: text(payload.reason, "reason", 500, true),
    };
  }
  if (commandType === W8_COMMAND_TYPES.REVIEW_LEARNING_EXEMPTION_REQUEST) {
    allowed(
      payload,
      [...common, "requestId", "expectedRequestRevision", "action", "reason"],
      "reviewLearningExemptionRequest payload",
    );
    return {
      ...commonPayload(payload),
      requestId: text(payload.requestId, "requestId", 80),
      expectedRequestRevision: revision(
        payload.expectedRequestRevision,
        "expectedRequestRevision",
      ),
      action: enumValue(payload.action, ["APPROVE", "REJECT"], "action"),
      reason: text(payload.reason, "reason", 500, true),
    };
  }
  if (commandType === W8_COMMAND_TYPES.CREATE_SCHEDULE_EVENT) {
    allowed(
      payload,
      [
        ...common,
        "cutoverPlanId",
        "cutoverOperationKey",
        "eventType",
        "title",
        "description",
        "startAt",
        "endAt",
        "allDay",
        "period",
        "targetClassIds",
        "targetUserIds",
        "sourceDomain",
        "sourceReference",
      ],
      "createScheduleEvent payload",
    );
    return {
      ...commonPayload(payload),
      ...cutoverContext(payload),
      ...editableSchedule(payload),
    };
  }
  if (commandType === W8_COMMAND_TYPES.UPDATE_SCHEDULE_EVENT) {
    allowed(
      payload,
      [
        ...common,
        "eventId",
        "expectedEventRevision",
        "eventType",
        "title",
        "description",
        "startAt",
        "endAt",
        "allDay",
        "period",
        "targetClassIds",
        "targetUserIds",
        "sourceDomain",
        "sourceReference",
      ],
      "updateScheduleEvent payload",
    );
    return {
      ...commonPayload(payload),
      eventId: text(payload.eventId, "eventId", 80),
      expectedEventRevision: revision(
        payload.expectedEventRevision,
        "expectedEventRevision",
      ),
      ...editableSchedule(payload),
    };
  }
  if (commandType === W8_COMMAND_TYPES.DELETE_SCHEDULE_EVENT) {
    allowed(
      payload,
      [...common, "eventId", "expectedEventRevision", "reason"],
      "deleteScheduleEvent payload",
    );
    return {
      ...commonPayload(payload),
      eventId: text(payload.eventId, "eventId", 80),
      expectedEventRevision: revision(
        payload.expectedEventRevision,
        "expectedEventRevision",
      ),
      reason: text(payload.reason, "reason", 500, true),
    };
  }
  if (commandType === W8_COMMAND_TYPES.CREATE_ATTENDANCE_SESSION) {
    allowed(
      payload,
      [
        ...common,
        "classId",
        "date",
        "period",
        "sourceEventId",
        "expectedSourceEventRevision",
      ],
      "createAttendanceSession payload",
    );
    return {
      ...commonPayload(payload),
      classId: text(payload.classId, "classId", 80),
      date: dateKey(payload.date),
      period: text(payload.period, "period", 40),
      sourceEventId: optionalText(payload.sourceEventId, "sourceEventId", 80),
      expectedSourceEventRevision: nullableRevision(
        payload.expectedSourceEventRevision,
        "expectedSourceEventRevision",
      ),
    };
  }
  const normalizeAttendanceEntry = (entry, label) => {
    allowed(
      entry,
      [
        "studentUid",
        "enrollmentId",
        "expectedRecordRevision",
        "attendanceStatus",
        "reason",
      ],
      label,
    );
    return {
      studentUid: text(entry.studentUid, `${label}.studentUid`, 180),
      enrollmentId: text(entry.enrollmentId, `${label}.enrollmentId`, 180),
      expectedRecordRevision: nullableRevision(
        entry.expectedRecordRevision,
        `${label}.expectedRecordRevision`,
      ),
      attendanceStatus: enumValue(
        entry.attendanceStatus,
        ["PRESENT", "LATE", "ABSENT", "EARLY_LEAVE", "EXCUSED"],
        `${label}.attendanceStatus`,
      ),
      reason: optionalText(entry.reason, `${label}.reason`, 500, true),
    };
  };
  if (commandType === W8_COMMAND_TYPES.RECORD_ATTENDANCE) {
    allowed(
      payload,
      [
        ...common,
        "sessionId",
        "expectedSessionRevision",
        "studentUid",
        "enrollmentId",
        "expectedRecordRevision",
        "attendanceStatus",
        "reason",
      ],
      "recordAttendance payload",
    );
    return {
      ...commonPayload(payload),
      sessionId: text(payload.sessionId, "sessionId", 80),
      expectedSessionRevision: revision(
        payload.expectedSessionRevision,
        "expectedSessionRevision",
      ),
      ...normalizeAttendanceEntry(
        {
          studentUid: payload.studentUid,
          enrollmentId: payload.enrollmentId,
          expectedRecordRevision: payload.expectedRecordRevision,
          attendanceStatus: payload.attendanceStatus,
          reason: payload.reason,
        },
        "record",
      ),
    };
  }
  if (commandType === W8_COMMAND_TYPES.RECORD_ATTENDANCE_BULK) {
    allowed(
      payload,
      [...common, "sessionId", "expectedSessionRevision", "entries", "reason"],
      "recordAttendanceBulk payload",
    );
    if (
      !Array.isArray(payload.entries) ||
      payload.entries.length < 1 ||
      payload.entries.length > 100
    )
      fail("invalid-argument", "entries is invalid.", "W8_PAYLOAD_INVALID");
    return {
      ...commonPayload(payload),
      sessionId: text(payload.sessionId, "sessionId", 80),
      expectedSessionRevision: revision(
        payload.expectedSessionRevision,
        "expectedSessionRevision",
      ),
      entries: payload.entries.map((entry, index) =>
        normalizeAttendanceEntry(entry, `entries[${index}]`),
      ),
      reason: text(payload.reason, "reason", 500, true),
    };
  }
  if (commandType === W8_COMMAND_TYPES.CORRECT_ATTENDANCE_RECORD) {
    allowed(
      payload,
      [
        ...common,
        "recordId",
        "expectedRecordRevision",
        "attendanceStatus",
        "reason",
      ],
      "correctAttendanceRecord payload",
    );
    return {
      ...commonPayload(payload),
      recordId: text(payload.recordId, "recordId", 80),
      expectedRecordRevision: revision(
        payload.expectedRecordRevision,
        "expectedRecordRevision",
      ),
      attendanceStatus: enumValue(
        payload.attendanceStatus,
        ["PRESENT", "LATE", "ABSENT", "EARLY_LEAVE", "EXCUSED"],
        "attendanceStatus",
      ),
      reason: text(payload.reason, "reason", 500, true),
    };
  }
  if (commandType === W8_COMMAND_TYPES.CLOSE_ATTENDANCE_SESSION) {
    allowed(
      payload,
      [...common, "sessionId", "expectedSessionRevision"],
      "closeAttendanceSession payload",
    );
    return {
      ...commonPayload(payload),
      sessionId: text(payload.sessionId, "sessionId", 80),
      expectedSessionRevision: revision(
        payload.expectedSessionRevision,
        "expectedSessionRevision",
      ),
    };
  }
  if (commandType === W8_COMMAND_TYPES.CREATE_NOTICE) {
    allowed(
      payload,
      [
        ...common,
        "cutoverPlanId",
        "cutoverOperationKey",
        "title",
        "content",
        "targetRoles",
        "targetClassIds",
        "targetUserIds",
        "publishAt",
        "expireAt",
        "priority",
      ],
      "createNotice payload",
    );
    return {
      ...commonPayload(payload),
      ...cutoverContext(payload),
      ...editableNotice(payload),
    };
  }
  if (commandType === W8_COMMAND_TYPES.UPDATE_NOTICE) {
    allowed(
      payload,
      [
        ...common,
        "noticeId",
        "expectedNoticeRevision",
        "title",
        "content",
        "targetRoles",
        "targetClassIds",
        "targetUserIds",
        "publishAt",
        "expireAt",
        "priority",
      ],
      "updateNotice payload",
    );
    return {
      ...commonPayload(payload),
      noticeId: text(payload.noticeId, "noticeId", 80),
      expectedNoticeRevision: revision(
        payload.expectedNoticeRevision,
        "expectedNoticeRevision",
      ),
      ...editableNotice(payload),
    };
  }
  if (commandType === W8_COMMAND_TYPES.TRANSITION_NOTICE) {
    allowed(
      payload,
      [...common, "noticeId", "expectedNoticeRevision", "targetStatus"],
      "transitionNotice payload",
    );
    return {
      ...commonPayload(payload),
      noticeId: text(payload.noticeId, "noticeId", 80),
      expectedNoticeRevision: revision(
        payload.expectedNoticeRevision,
        "expectedNoticeRevision",
      ),
      targetStatus: enumValue(
        payload.targetStatus,
        ["SCHEDULED", "PUBLISHED", "EXPIRED", "ARCHIVED"],
        "targetStatus",
      ),
    };
  }
  if (commandType === W8_COMMAND_TYPES.ACKNOWLEDGE_NOTICE) {
    allowed(
      payload,
      [...common, "noticeId", "expectedNoticeRevision"],
      "acknowledgeNotice payload",
    );
    return {
      ...commonPayload(payload),
      noticeId: text(payload.noticeId, "noticeId", 80),
      expectedNoticeRevision: revision(
        payload.expectedNoticeRevision,
        "expectedNoticeRevision",
      ),
    };
  }
  if (commandType === W8_COMMAND_TYPES.ACKNOWLEDGE_ALL_NOTICES) {
    allowed(payload, [...common, "notices"], "acknowledgeAllNotices payload");
    if (
      !Array.isArray(payload.notices) ||
      payload.notices.length < 1 ||
      payload.notices.length > 100
    )
      fail("invalid-argument", "notices is invalid.", "W8_PAYLOAD_INVALID");
    return {
      ...commonPayload(payload),
      notices: payload.notices.map((notice, index) => {
        allowed(
          notice,
          ["noticeId", "expectedNoticeRevision"],
          `notices[${index}]`,
        );
        return {
          noticeId: text(notice.noticeId, `notices[${index}].noticeId`, 80),
          expectedNoticeRevision: revision(
            notice.expectedNoticeRevision,
            `notices[${index}].expectedNoticeRevision`,
          ),
        };
      }),
    };
  }
  if (commandType === W8_COMMAND_TYPES.UPDATE_NOTIFICATION_SETTINGS) {
    allowed(
      payload,
      [
        ...common,
        "expectedConfigRevision",
        "enabled",
        "studentNotificationsEnabled",
        "teacherNotificationsEnabled",
        "eventPolicies",
      ],
      "updateNotificationSettings payload",
    );
    if (!isObject(payload.eventPolicies))
      fail(
        "invalid-argument",
        "eventPolicies is invalid.",
        "W8_PAYLOAD_INVALID",
      );
    return {
      ...commonPayload(payload),
      expectedConfigRevision: nullableRevision(
        payload.expectedConfigRevision,
        "expectedConfigRevision",
      ),
      enabled: boolean(payload.enabled, "enabled"),
      studentNotificationsEnabled: boolean(
        payload.studentNotificationsEnabled,
        "studentNotificationsEnabled",
      ),
      teacherNotificationsEnabled: boolean(
        payload.teacherNotificationsEnabled,
        "teacherNotificationsEnabled",
      ),
      eventPolicies: JSON.parse(canonicalJson(payload.eventPolicies)),
    };
  }
  if (commandType === W8_COMMAND_TYPES.CREATE_THINK_CLOUD_SESSION) {
    allowed(
      payload,
      [
        ...common,
        "expectedStateRevision",
        "title",
        "description",
        "targetGrade",
        "targetClass",
        "targetGradeLabel",
        "targetClassLabel",
        "options",
      ],
      "createThinkCloudSession payload",
    );
    return {
      ...commonPayload(payload),
      expectedStateRevision: nullableLegacyRevision(
        payload.expectedStateRevision,
        "expectedStateRevision",
      ),
      title: text(payload.title, "title", 200, true),
      description: optionalText(payload.description, "description", 2000, true),
      targetGrade: text(payload.targetGrade, "targetGrade", 20),
      targetClass: text(payload.targetClass, "targetClass", 20),
      targetGradeLabel: optionalText(
        payload.targetGradeLabel,
        "targetGradeLabel",
        40,
        true,
      ),
      targetClassLabel: optionalText(
        payload.targetClassLabel,
        "targetClassLabel",
        40,
        true,
      ),
      options: editableThinkCloudOptions(payload.options),
    };
  }
  if (commandType === W8_COMMAND_TYPES.TRANSITION_THINK_CLOUD_SESSION) {
    allowed(
      payload,
      [
        ...common,
        "sessionId",
        "expectedSessionRevision",
        "expectedStateRevision",
        "targetStatus",
      ],
      "transitionThinkCloudSession payload",
    );
    return {
      ...commonPayload(payload),
      sessionId: text(payload.sessionId, "sessionId", 180),
      expectedSessionRevision: legacyRevision(
        payload.expectedSessionRevision,
        "expectedSessionRevision",
      ),
      expectedStateRevision: nullableLegacyRevision(
        payload.expectedStateRevision,
        "expectedStateRevision",
      ),
      targetStatus: enumValue(
        payload.targetStatus,
        ["active", "paused", "closed"],
        "targetStatus",
      ),
    };
  }
  if (commandType === W8_COMMAND_TYPES.DELETE_THINK_CLOUD_SESSION) {
    allowed(
      payload,
      [
        ...common,
        "sessionId",
        "expectedSessionRevision",
        "expectedStateRevision",
        "reason",
      ],
      "deleteThinkCloudSession payload",
    );
    return {
      ...commonPayload(payload),
      sessionId: text(payload.sessionId, "sessionId", 180),
      expectedSessionRevision: legacyRevision(
        payload.expectedSessionRevision,
        "expectedSessionRevision",
      ),
      expectedStateRevision: nullableLegacyRevision(
        payload.expectedStateRevision,
        "expectedStateRevision",
      ),
      reason: text(payload.reason, "reason", 500, true),
    };
  }
  if (commandType === W8_COMMAND_TYPES.SUBMIT_THINK_CLOUD_RESPONSE) {
    allowed(
      payload,
      [
        ...common,
        "sessionId",
        "expectedSessionRevision",
        "textRaw",
        "textNormalized",
      ],
      "submitThinkCloudResponse payload",
    );
    return {
      ...commonPayload(payload),
      sessionId: text(payload.sessionId, "sessionId", 180),
      expectedSessionRevision: legacyRevision(
        payload.expectedSessionRevision,
        "expectedSessionRevision",
      ),
      textRaw: text(payload.textRaw, "textRaw", 100, true),
      textNormalized: text(payload.textNormalized, "textNormalized", 100, true),
    };
  }
  fail("invalid-argument", "Unsupported W8 command.", "W8_COMMAND_UNSUPPORTED");
};

const path = (collection, id) => `${collection}/${id}`;
const manifestPath = (scope) =>
  path(semesterCore.SEMESTER_MANIFEST_COLLECTION, scope);
const classPath = (id) => path(archiveEnrollment.SEMESTER_CLASS_COLLECTION, id);
const enrollmentPath = (id) =>
  path(archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION, id);
const progressIdFor = (scope, contentId, studentUid) =>
  hashId("learnprog", scope, contentId, studentUid);
const exemptionIdFor = (scope, contentId, studentUid) =>
  hashId("learnex", scope, contentId, studentUid);
const attendanceSessionIdFor = (scope, classId, date, period) =>
  hashId("attsess", scope, classId, date, period);
const attendanceRecordIdFor = (sessionId, studentUid) =>
  hashId("attrec", sessionId, studentUid);
const deliveryIdFor = (noticeId, uid) => hashId("noticedel", noticeId, uid);
const acknowledgementIdFor = (noticeId, uid) =>
  hashId("noticeack", noticeId, uid);
const thinkCloudRoot = (scope) => {
  const [year, semester] = scope.split("-");
  return `years/${year}/semesters/${semester}`;
};
const thinkCloudStatePath = (scope, classId) =>
  `${thinkCloudRoot(scope)}/think_cloud_state/${classId}`;
const thinkCloudSessionsPath = (scope) =>
  `${thinkCloudRoot(scope)}/think_cloud_sessions`;
const thinkCloudSessionPath = (scope, sessionId) =>
  `${thinkCloudRoot(scope)}/think_cloud_sessions/${sessionId}`;
const thinkCloudResponsesPath = (scope, sessionId) =>
  `${thinkCloudSessionPath(scope, sessionId)}/responses`;
const thinkCloudEnrollmentSlotPath = (scope, uid) =>
  `${archiveEnrollment.ENROLLMENT_SLOT_COLLECTION}/${archiveEnrollment.buildEnrollmentSlotId(scope, uid)}`;

const assertThinkCloudStateRevision = (snapshot, expected) => {
  const currentRevision = Number(snapshot.data?.revision || 0);
  if (
    (snapshot.exists && expected !== currentRevision) ||
    (!snapshot.exists && expected !== null)
  ) {
    fail(
      "aborted",
      "Think Cloud state revision changed.",
      "W8_THINK_CLOUD_STATE_REVISION_CONFLICT",
      { currentRevision },
    );
  }
  return currentRevision;
};
const assertThinkCloudSessionRevision = (snapshot, expected) => {
  if (!snapshot.exists)
    fail(
      "not-found",
      "Think Cloud session was not found.",
      "W8_THINK_CLOUD_SESSION_NOT_FOUND",
    );
  const currentRevision = Number(snapshot.data?.revision || 0);
  if (currentRevision !== expected)
    fail(
      "aborted",
      "Think Cloud session revision changed.",
      "W8_THINK_CLOUD_SESSION_REVISION_CONFLICT",
      { currentRevision },
    );
  return currentRevision;
};
const assertThinkCloudTeacherTarget = async (
  transaction,
  actor,
  scope,
  targetGrade,
  targetClass,
) => {
  const profile = await transaction.get(`users/${actor.actorUid}`);
  const classes = await transaction.query(
    archiveEnrollment.SEMESTER_CLASS_COLLECTION,
    { field: "semesterId", operator: "==", value: scope },
  );
  const target = classes.find(
    (row) =>
      row.data?.status === "ACTIVE" &&
      String(row.data?.grade || "").trim() === targetGrade &&
      String(row.data?.classNumber || "").trim() === targetClass,
  );
  if (!target)
    fail(
      "failed-precondition",
      "Think Cloud target class is not active.",
      "W8_THINK_CLOUD_CLASS_INVALID",
    );
  if (
    actor.actorRole !== "admin" &&
    (!profile.exists || target.data?.homeroomTeacherUid !== actor.actorUid)
  ) {
    fail(
      "permission-denied",
      "Teacher Think Cloud target is outside the assigned class.",
      "W8_THINK_CLOUD_TARGET_FORBIDDEN",
    );
  }
  return {
    profile,
    semesterClass: target,
    classId: String(
      target.data?.classId || target.path.split("/").at(-1) || "",
    ),
  };
};
const assertThinkCloudStudentTarget = async (
  transaction,
  actor,
  session,
  scope,
) => {
  const [profile, slot] = await transaction.getAll([
    `users/${actor.actorUid}`,
    thinkCloudEnrollmentSlotPath(scope, actor.actorUid),
  ]);
  const activeEnrollmentId = String(slot.data?.activeEnrollmentId || "").trim();
  if (
    !profile.exists ||
    !slot.exists ||
    slot.data?.semesterId !== scope ||
    slot.data?.studentUid !== actor.actorUid ||
    slot.data?.status !== "ACTIVE" ||
    !activeEnrollmentId
  )
    fail(
      "permission-denied",
      "Active student enrollment is required.",
      "W8_THINK_CLOUD_TARGET_FORBIDDEN",
    );
  const enrollment = await transaction.get(
    `${archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION}/${activeEnrollmentId}`,
  );
  if (
    !enrollment.exists ||
    enrollment.data?.enrollmentId !== activeEnrollmentId ||
    enrollment.data?.semesterId !== scope ||
    enrollment.data?.studentUid !== actor.actorUid ||
    enrollment.data?.enrollmentStatus !== "ACTIVE"
  )
    fail(
      "permission-denied",
      "Active student enrollment is inconsistent.",
      "W8_THINK_CLOUD_TARGET_FORBIDDEN",
    );
  const semesterClass = await transaction.get(
    classPath(enrollment.data?.classId),
  );
  const grade = String(
    semesterClass.data?.grade || profile.data?.grade || "",
  ).trim();
  const classNumber = String(
    semesterClass.data?.classNumber || profile.data?.class || "",
  ).trim();
  if (
    !semesterClass.exists ||
    semesterClass.data?.status !== "ACTIVE" ||
    semesterClass.data?.semesterId !== scope ||
    grade !== session.targetGrade ||
    classNumber !== session.targetClass
  ) {
    fail(
      "permission-denied",
      "Think Cloud session is outside the active class.",
      "W8_THINK_CLOUD_TARGET_FORBIDDEN",
    );
  }
  return {
    enrollment,
    profile,
    semesterClass,
    classId: String(
      semesterClass.data?.classId ||
        enrollment.data?.classId ||
        semesterClass.path.split("/").at(-1) ||
        "",
    ),
  };
};

const assertTeacher = (actor) => {
  if (!actor?.actorUid || !["teacher", "admin"].includes(actor.actorRole))
    fail(
      "permission-denied",
      "Teacher management authority is required.",
      "W8_MANAGE_REQUIRED",
    );
};
const assertStudent = (actor) => {
  if (!actor?.actorUid || actor.actorRole !== "student")
    fail(
      "permission-denied",
      "A student account is required.",
      "W8_STUDENT_REQUIRED",
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
        W8_COMMAND_TYPES.CREATE_LEARNING_CONTENT,
        W8_COMMAND_TYPES.CREATE_SCHEDULE_EVENT,
        W8_COMMAND_TYPES.CREATE_NOTICE,
      ].includes(commandType) &&
      ["PREPARING", "READY"].includes(manifest.status);
    if (!preparingCreate)
      fail(
        "failed-precondition",
        "W8 writes require the active semester.",
        ["CLOSED", "ARCHIVED"].includes(manifest.status)
          ? "SEMESTER_ARCHIVED_WRITE_FORBIDDEN"
          : "SEMESTER_WRITE_STATE_INVALID",
      );
    const operationType =
      commandType === W8_COMMAND_TYPES.CREATE_LEARNING_CONTENT
        ? "LEARNING_CONTENT"
        : commandType === W8_COMMAND_TYPES.CREATE_SCHEDULE_EVENT
          ? "SCHEDULE_EVENTS"
          : "NOTICE_TEMPLATES";
    await cutoverAuthorization.assertPreparingCutoverCreateIfTargeted({
      transaction,
      semesterId: payload.semesterId,
      actor,
      commandType,
      commandId,
      payloadHash,
      cutoverPlanId: payload.cutoverPlanId,
      cutoverOperationKey: payload.cutoverOperationKey,
      operationType,
    });
  }
  if (actor?.actorRole === "student") {
    const pointer = await transaction.get(semesterCore.ACTIVE_SEMESTER_POINTER_PATH);
    if (!pointer.exists || pointer.data?.semesterId !== payload.semesterId
      || !Number.isSafeInteger(pointer.data?.revision) || pointer.data.revision < 1
      || pointer.data?.revision !== manifest.revision || manifest.readOnly === true)
      fail("failed-precondition", "Student writes require the current semester.", "W8_STUDENT_CURRENT_SEMESTER_REQUIRED");
  }
  return manifest;
};
const assertDatesWithinSemester = (manifest, commandType, payload) => {
  const start = String(manifest.startAt || manifest.startDate || "");
  const end = String(manifest.endAt || manifest.endDate || "");
  if (!start || !end) return;
  const candidates = [];
  if (
    [
      W8_COMMAND_TYPES.CREATE_LEARNING_CONTENT,
      W8_COMMAND_TYPES.UPDATE_LEARNING_CONTENT,
    ].includes(commandType)
  )
    candidates.push(payload.availableFrom, payload.availableUntil);
  if (
    [
      W8_COMMAND_TYPES.CREATE_SCHEDULE_EVENT,
      W8_COMMAND_TYPES.UPDATE_SCHEDULE_EVENT,
    ].includes(commandType)
  )
    candidates.push(payload.startAt, payload.endAt);
  if (commandType === W8_COMMAND_TYPES.CREATE_ATTENDANCE_SESSION)
    candidates.push(payload.date);
  if (
    [W8_COMMAND_TYPES.CREATE_NOTICE, W8_COMMAND_TYPES.UPDATE_NOTICE].includes(
      commandType,
    )
  )
    candidates.push(payload.publishAt, payload.expireAt);
  const invalid = candidates
    .filter(Boolean)
    .map((value) => String(value).slice(0, 10))
    .find((date) => date < start || date > end);
  if (invalid)
    fail(
      "failed-precondition",
      "W8 date is outside the Semester range.",
      "W8_DATE_OUTSIDE_SEMESTER",
      { date: invalid, semesterStart: start, semesterEnd: end },
    );
};
const assertEnrollment = async (
  transaction,
  enrollmentId,
  scope,
  studentUid = null,
  classId = null,
) => {
  const snapshot = await transaction.get(enrollmentPath(enrollmentId));
  const enrollment = snapshot.data || {};
  if (
    !snapshot.exists ||
    enrollment.semesterId !== scope ||
    enrollment.enrollmentStatus !== "ACTIVE" ||
    (studentUid && enrollment.studentUid !== studentUid) ||
    (classId && enrollment.classId !== classId)
  ) {
    fail(
      "failed-precondition",
      "Active Enrollment does not match the W8 target.",
      "W8_ENROLLMENT_INVALID",
      { enrollmentId },
    );
  }
  const semesterClass = await transaction.get(classPath(enrollment.classId));
  if (
    !semesterClass.exists ||
    semesterClass.data?.semesterId !== scope ||
    semesterClass.data?.status !== "ACTIVE"
  )
    fail(
      "failed-precondition",
      "Active Class does not match the W8 target.",
      "W8_CLASS_INVALID",
      { classId: enrollment.classId },
    );
  return enrollment;
};
const assertClasses = async (transaction, classIds, scope) => {
  if (!classIds.length) return;
  const rows = await transaction.getAll(classIds.map(classPath));
  rows.forEach((row, index) => {
    if (
      !row.exists ||
      row.data?.semesterId !== scope ||
      row.data?.status !== "ACTIVE"
    )
      fail(
        "failed-precondition",
        "Target Class is invalid.",
        "W8_CLASS_INVALID",
        { classId: classIds[index] },
      );
  });
};
const assertTargetUsers = async (transaction, userIds, scope) => {
  if (!userIds.length) return;
  const enrollments = await transaction.query(
    archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION,
    { field: "semesterId", operator: "==", value: scope },
  );
  const activeUids = new Set(
    enrollments
      .filter((row) => row.data?.enrollmentStatus === "ACTIVE")
      .map((row) => row.data?.studentUid),
  );
  const invalid = userIds.find((uid) => !activeUids.has(uid));
  if (invalid)
    fail(
      "failed-precondition",
      "Target user does not have an active Enrollment.",
      "W8_ENROLLMENT_INVALID",
      { studentUid: invalid },
    );
};
const assertRevision = (snapshot, expected, reason) => {
  if (!snapshot.exists)
    fail("not-found", "W8 resource was not found.", "W8_RESOURCE_NOT_FOUND");
  if (Number(snapshot.data?.revision || 0) !== expected)
    fail("aborted", "W8 resource revision changed.", reason, {
      currentRevision: Number(snapshot.data?.revision || 0),
    });
};
const baseDocument = (scope) => ({
  schemaVersion: W8_SCHEMA_VERSION,
  policyVersion: W8_POLICY_VERSION,
  semesterId: scope,
  provenance: "CURRENT",
});

const createW8CommandAdapter = ({
  now = () => new Date().toISOString(),
} = {}) => ({
  apply: async ({
    transaction,
    commandId,
    commandType,
    payload,
    payloadHash,
    receiptId,
    timestamp,
    actor,
  }) => {
    const manifest = await assertManifest(
      transaction,
      payload,
      commandType,
      actor,
      commandId,
      payloadHash,
    );
    assertDatesWithinSemester(manifest, commandType, payload);
    const teacherCommand = !STUDENT_COMMAND_TYPES.has(commandType);
    if (teacherCommand) assertTeacher(actor);
    else assertStudent(actor);

    if (commandType === W8_COMMAND_TYPES.CREATE_THINK_CLOUD_SESSION) {
      const { profile, classId } = await assertThinkCloudTeacherTarget(
        transaction,
        actor,
        payload.semesterId,
        payload.targetGrade,
        payload.targetClass,
      );
      const statePath = thinkCloudStatePath(payload.semesterId, classId);
      const state = await transaction.get(statePath);
      const stateRevision = assertThinkCloudStateRevision(
        state,
        payload.expectedStateRevision,
      );
      const scopedSessions = await transaction.query(
        thinkCloudSessionsPath(payload.semesterId),
      );
      const legacyActive = scopedSessions.find(
        (row) =>
          row.data?.status === "active" &&
          String(row.data?.targetGrade || "").trim() === payload.targetGrade &&
          String(row.data?.targetClass || "").trim() === payload.targetClass,
      );
      const previousSessionId = String(
        state.data?.activeSessionId ||
          legacyActive?.data?.sessionId ||
          legacyActive?.path.split("/").at(-1) ||
          "",
      ).trim();
      const refs = [statePath];
      if (previousSessionId) {
        const previousPath = thinkCloudSessionPath(
          payload.semesterId,
          previousSessionId,
        );
        const previous = await transaction.get(previousPath);
        if (!previous.exists || previous.data?.status !== "active")
          fail(
            "failed-precondition",
            "Active Think Cloud session state is inconsistent.",
            "W8_THINK_CLOUD_STATE_INVALID",
          );
        transaction.set(
          previousPath,
          {
            revision: Number(previous.data?.revision || 0) + 1,
            status: "closed",
            closedAt: timestamp,
            updatedAt: timestamp,
          },
          { merge: true },
        );
        refs.push(previousPath);
      }
      const sessionId = hashId("think", payload.semesterId, commandId);
      const sessionPath = thinkCloudSessionPath(payload.semesterId, sessionId);
      transaction.create(sessionPath, {
        ...baseDocument(payload.semesterId),
        sessionId,
        targetClassId: classId,
        revision: 1,
        title: payload.title,
        description: payload.description,
        targetGrade: payload.targetGrade,
        targetClass: payload.targetClass,
        targetGradeLabel: payload.targetGradeLabel,
        targetClassLabel: payload.targetClassLabel,
        status: "active",
        options: payload.options,
        createdByName:
          String(profile.data?.name || "교사")
            .trim()
            .slice(0, 30) || "교사",
        createdAt: timestamp,
        activatedAt: timestamp,
        updatedAt: timestamp,
      });
      transaction.set(
        statePath,
        {
          ...baseDocument(payload.semesterId),
          classId,
          activeSessionId: sessionId,
          revision: stateRevision + 1,
          updatedAt: timestamp,
        },
        { merge: true },
      );
      refs.push(sessionPath);
      return {
        target: { kind: "think-cloud-session", id: sessionId, refs },
        sourceHash: sha256(canonicalJson(payload)),
        result: {
          sessionId,
          sessionRevision: 1,
          stateRevision: stateRevision + 1,
          status: "active",
        },
      };
    }
    if (commandType === W8_COMMAND_TYPES.TRANSITION_THINK_CLOUD_SESSION) {
      const sessionPath = thinkCloudSessionPath(
        payload.semesterId,
        payload.sessionId,
      );
      const session = await transaction.get(sessionPath);
      assertThinkCloudSessionRevision(session, payload.expectedSessionRevision);
      const { classId } = await assertThinkCloudTeacherTarget(
        transaction,
        actor,
        payload.semesterId,
        String(session.data?.targetGrade || ""),
        String(session.data?.targetClass || ""),
      );
      const statePath = thinkCloudStatePath(payload.semesterId, classId);
      const state = await transaction.get(statePath);
      const stateRevision = assertThinkCloudStateRevision(
        state,
        payload.expectedStateRevision,
      );
      const currentStatus = String(session.data?.status || "");
      const transitions = {
        active: ["paused", "closed"],
        paused: ["active", "closed"],
      };
      if (!transitions[currentStatus]?.includes(payload.targetStatus))
        fail(
          "failed-precondition",
          "Think Cloud session transition is invalid.",
          "W8_THINK_CLOUD_SESSION_STATE_INVALID",
        );
      let activeSessionId = String(state.data?.activeSessionId || "").trim();
      if (!state.exists && currentStatus === "active")
        activeSessionId = payload.sessionId;
      if (currentStatus === "active" && activeSessionId !== payload.sessionId)
        fail(
          "failed-precondition",
          "Active Think Cloud session state is inconsistent.",
          "W8_THINK_CLOUD_STATE_INVALID",
        );
      const refs = [sessionPath, statePath];
      if (payload.targetStatus === "active" && !activeSessionId) {
        const scopedSessions = await transaction.query(
          thinkCloudSessionsPath(payload.semesterId),
        );
        const previous = scopedSessions.find(
          (row) =>
            row.data?.status === "active" &&
            String(row.data?.targetGrade || "").trim() ===
              String(session.data?.targetGrade || "").trim() &&
            String(row.data?.targetClass || "").trim() ===
              String(session.data?.targetClass || "").trim() &&
            String(row.data?.sessionId || row.path.split("/").at(-1) || "") !==
              payload.sessionId,
        );
        activeSessionId = String(
          previous?.data?.sessionId || previous?.path.split("/").at(-1) || "",
        );
      }
      if (
        payload.targetStatus === "active" &&
        activeSessionId &&
        activeSessionId !== payload.sessionId
      ) {
        const previousPath = thinkCloudSessionPath(
          payload.semesterId,
          activeSessionId,
        );
        const previous = await transaction.get(previousPath);
        if (!previous.exists || previous.data?.status !== "active")
          fail(
            "failed-precondition",
            "Active Think Cloud session state is inconsistent.",
            "W8_THINK_CLOUD_STATE_INVALID",
          );
        await assertThinkCloudTeacherTarget(
          transaction,
          actor,
          payload.semesterId,
          String(previous.data?.targetGrade || ""),
          String(previous.data?.targetClass || ""),
        );
        transaction.set(
          previousPath,
          {
            revision: Number(previous.data?.revision || 0) + 1,
            status: "paused",
            updatedAt: timestamp,
          },
          { merge: true },
        );
        refs.push(previousPath);
      }
      const nextSessionRevision = payload.expectedSessionRevision + 1;
      const nextStateRevision = stateRevision + 1;
      transaction.set(
        sessionPath,
        {
          revision: nextSessionRevision,
          status: payload.targetStatus,
          activatedAt:
            payload.targetStatus === "active"
              ? timestamp
              : session.data?.activatedAt || null,
          closedAt:
            payload.targetStatus === "closed"
              ? timestamp
              : session.data?.closedAt || null,
          updatedAt: timestamp,
        },
        { merge: true },
      );
      transaction.set(
        statePath,
        {
          ...baseDocument(payload.semesterId),
          classId,
          activeSessionId:
            payload.targetStatus === "active" ? payload.sessionId : "",
          revision: nextStateRevision,
          updatedAt: timestamp,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "think-cloud-session-transition",
          id: payload.sessionId,
          refs,
        },
        sourceHash: sha256(
          `${payload.sessionId}\n${currentStatus}\n${payload.targetStatus}`,
        ),
        result: {
          sessionId: payload.sessionId,
          sessionRevision: nextSessionRevision,
          stateRevision: nextStateRevision,
          status: payload.targetStatus,
        },
      };
    }
    if (commandType === W8_COMMAND_TYPES.DELETE_THINK_CLOUD_SESSION) {
      const sessionPath = thinkCloudSessionPath(
        payload.semesterId,
        payload.sessionId,
      );
      const session = await transaction.get(sessionPath);
      assertThinkCloudSessionRevision(session, payload.expectedSessionRevision);
      const { classId } = await assertThinkCloudTeacherTarget(
        transaction,
        actor,
        payload.semesterId,
        String(session.data?.targetGrade || ""),
        String(session.data?.targetClass || ""),
      );
      const statePath = thinkCloudStatePath(payload.semesterId, classId);
      const state = await transaction.get(statePath);
      const stateRevision = assertThinkCloudStateRevision(
        state,
        payload.expectedStateRevision,
      );
      const responses = await transaction.query(
        thinkCloudResponsesPath(payload.semesterId, payload.sessionId),
      );
      if (responses.length > THINK_CLOUD_RESPONSE_LIMIT)
        fail(
          "resource-exhausted",
          "Think Cloud session deletion is limited to 200 responses.",
          "W8_THINK_CLOUD_RESPONSE_LIMIT",
          {
            responseCount: responses.length,
            maximum: THINK_CLOUD_RESPONSE_LIMIT,
          },
        );
      responses.forEach((response) => transaction.delete(response.path));
      transaction.delete(sessionPath);
      const nextStateRevision = stateRevision + 1;
      transaction.set(
        statePath,
        {
          ...baseDocument(payload.semesterId),
          classId,
          activeSessionId:
            String(state.data?.activeSessionId || "") === payload.sessionId ||
            (!state.exists && session.data?.status === "active")
              ? ""
              : String(state.data?.activeSessionId || ""),
          revision: nextStateRevision,
          deleteReason: payload.reason,
          updatedAt: timestamp,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "think-cloud-session-delete",
          id: payload.sessionId,
          refs: [
            sessionPath,
            ...responses.map((response) => response.path),
            statePath,
          ],
        },
        sourceHash: sha256(`${payload.sessionId}\n${payload.reason}`),
        result: {
          sessionId: payload.sessionId,
          stateRevision: nextStateRevision,
          deleted: true,
        },
      };
    }
    if (commandType === W8_COMMAND_TYPES.SUBMIT_THINK_CLOUD_RESPONSE) {
      const sessionPath = thinkCloudSessionPath(
        payload.semesterId,
        payload.sessionId,
      );
      const session = await transaction.get(sessionPath);
      assertThinkCloudSessionRevision(session, payload.expectedSessionRevision);
      const { profile, classId } = await assertThinkCloudStudentTarget(
        transaction,
        actor,
        session.data || {},
        payload.semesterId,
      );
      const state = await transaction.get(
        thinkCloudStatePath(payload.semesterId, classId),
      );
      const stateActiveSessionId = String(
        state.data?.activeSessionId || "",
      ).trim();
      if (
        session.data?.status !== "active" ||
        (state.exists && stateActiveSessionId !== payload.sessionId)
      )
        fail(
          "failed-precondition",
          "Think Cloud session is not active.",
          "W8_THINK_CLOUD_SESSION_STATE_INVALID",
        );
      const options = {
        allowDuplicateWord: true,
        allowDuplicateByStudent: false,
        inputMode: "word",
        anonymous: true,
        maxLength: 20,
        profanityFilter: true,
        ...(session.data?.options || {}),
      };
      const compact = payload.textRaw.replace(/\s+/g, " ").trim().toLowerCase();
      const normalized =
        options.inputMode === "word" ? compact.replace(/\s+/g, "") : compact;
      if (
        !normalized ||
        normalized !== payload.textNormalized ||
        payload.textRaw.length > options.maxLength ||
        (options.inputMode === "word" && /\s/.test(payload.textRaw))
      )
        fail(
          "invalid-argument",
          "Think Cloud response is invalid.",
          "W8_THINK_CLOUD_RESPONSE_INVALID",
        );
      if (
        options.profanityFilter &&
        ["욕설", "비속어"].some((word) => normalized.includes(word))
      )
        fail(
          "invalid-argument",
          "Think Cloud response contains a blocked term.",
          "W8_THINK_CLOUD_RESPONSE_BLOCKED",
        );
      const responses = await transaction.query(
        thinkCloudResponsesPath(payload.semesterId, payload.sessionId),
      );
      if (responses.length >= THINK_CLOUD_RESPONSE_LIMIT)
        fail(
          "resource-exhausted",
          "Think Cloud response limit has been reached.",
          "W8_THINK_CLOUD_RESPONSE_LIMIT",
          {
            responseCount: responses.length,
            maximum: THINK_CLOUD_RESPONSE_LIMIT,
          },
        );
      if (
        !options.allowDuplicateByStudent &&
        responses.some((response) => response.data?.uid === actor.actorUid)
      )
        fail(
          "already-exists",
          "Student already submitted a Think Cloud response.",
          "W8_THINK_CLOUD_STUDENT_DUPLICATE",
        );
      if (
        !options.allowDuplicateWord &&
        responses.some(
          (response) => response.data?.textNormalized === normalized,
        )
      )
        fail(
          "already-exists",
          "Think Cloud response is duplicated.",
          "W8_THINK_CLOUD_WORD_DUPLICATE",
        );
      const responseId = hashId(
        "thinkresp",
        payload.semesterId,
        payload.sessionId,
        actor.actorUid,
        commandId,
      );
      const responsePath = `${thinkCloudResponsesPath(payload.semesterId, payload.sessionId)}/${responseId}`;
      transaction.create(responsePath, {
        uid: actor.actorUid,
        displayName:
          String(profile.data?.name || "학생")
            .trim()
            .slice(0, 20) || "학생",
        textRaw: payload.textRaw,
        textNormalized: normalized,
        revision: 1,
        createdAt: timestamp,
      });
      return {
        target: {
          kind: "think-cloud-response",
          id: responseId,
          refs: [responsePath, sessionPath],
        },
        sourceHash: sha256(
          `${payload.sessionId}\n${actor.actorUid}\n${normalized}`,
        ),
        result: {
          sessionId: payload.sessionId,
          sessionRevision: payload.expectedSessionRevision,
          responseId,
          responseRevision: 1,
        },
      };
    }

    if (commandType === W8_COMMAND_TYPES.CREATE_LEARNING_CONTENT) {
      await assertClasses(
        transaction,
        payload.targetClassIds,
        payload.semesterId,
      );
      const contentId = hashId("learn", payload.semesterId, commandId);
      transaction.create(path(LEARNING_CONTENT_COLLECTION, contentId), {
        ...baseDocument(payload.semesterId),
        provenance: manifest.status === "ACTIVE" ? "CURRENT" : "PREPARING",
        readOnly: manifest.status !== "ACTIVE",
        cutoverPlanId: payload.cutoverPlanId || null,
        contentId,
        revision: 1,
        status: "DRAFT",
        ...editableLearning(payload),
        createdAt: timestamp,
        createdBy: actor.actorUid,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
      });
      return {
        target: {
          kind: "learning-content",
          id: contentId,
          refs: [path(LEARNING_CONTENT_COLLECTION, contentId)],
        },
        sourceHash: sha256(canonicalJson(payload)),
        result: { contentId, contentRevision: 1, status: "DRAFT" },
      };
    }
    if (commandType === W8_COMMAND_TYPES.UPDATE_LEARNING_CONTENT) {
      await assertClasses(
        transaction,
        payload.targetClassIds,
        payload.semesterId,
      );
      const targetPath = path(LEARNING_CONTENT_COLLECTION, payload.contentId);
      const snapshot = await transaction.get(targetPath);
      assertRevision(
        snapshot,
        payload.expectedContentRevision,
        "W8_CONTENT_REVISION_CONFLICT",
      );
      if (
        snapshot.data?.semesterId !== payload.semesterId ||
        !["DRAFT", "READY"].includes(snapshot.data?.status)
      )
        fail(
          "failed-precondition",
          "Learning content cannot be edited in this state.",
          "W8_CONTENT_STATE_INVALID",
        );
      const next = payload.expectedContentRevision + 1;
      transaction.set(
        targetPath,
        {
          ...editableLearning(payload),
          revision: next,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "learning-content",
          id: payload.contentId,
          refs: [targetPath],
        },
        sourceHash: sha256(canonicalJson(payload)),
        result: { contentId: payload.contentId, contentRevision: next },
      };
    }
    if (commandType === W8_COMMAND_TYPES.TRANSITION_LEARNING_CONTENT) {
      const targetPath = path(LEARNING_CONTENT_COLLECTION, payload.contentId);
      const snapshot = await transaction.get(targetPath);
      assertRevision(
        snapshot,
        payload.expectedContentRevision,
        "W8_CONTENT_REVISION_CONFLICT",
      );
      const allowedTransitions = {
        DRAFT: ["READY"],
        READY: ["PUBLISHED", "ARCHIVED"],
        PUBLISHED: ["CLOSED"],
        CLOSED: ["ARCHIVED"],
      };
      if (
        snapshot.data?.semesterId !== payload.semesterId ||
        !allowedTransitions[snapshot.data?.status]?.includes(
          payload.targetStatus,
        )
      )
        fail(
          "failed-precondition",
          "Learning content transition is invalid.",
          "W8_CONTENT_STATE_INVALID",
        );
      await assertClasses(
        transaction,
        snapshot.data?.targetClassIds || [],
        payload.semesterId,
      );
      const next = payload.expectedContentRevision + 1;
      transaction.set(
        targetPath,
        {
          revision: next,
          status: payload.targetStatus,
          transitionReason: payload.reason,
          publishedAt:
            payload.targetStatus === "PUBLISHED"
              ? timestamp
              : snapshot.data?.publishedAt || null,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "learning-content-transition",
          id: payload.contentId,
          refs: [targetPath],
        },
        sourceHash: sha256(`${snapshot.data?.status}\n${payload.targetStatus}`),
        result: {
          contentId: payload.contentId,
          contentRevision: next,
          status: payload.targetStatus,
        },
      };
    }
    if (commandType === W8_COMMAND_TYPES.RECORD_LEARNING_PROGRESS) {
      const content = await transaction.get(
        path(LEARNING_CONTENT_COLLECTION, payload.contentId),
      );
      assertRevision(
        content,
        payload.expectedContentRevision,
        "W8_CONTENT_REVISION_CONFLICT",
      );
      const enrollment = await assertEnrollment(
        transaction,
        payload.enrollmentId,
        payload.semesterId,
        actor.actorUid,
      );
      if (
        content.data?.semesterId !== payload.semesterId ||
        content.data?.status !== "PUBLISHED" ||
        !content.data?.audienceRoles?.includes("student") ||
        (content.data?.targetClassIds?.length &&
          !content.data.targetClassIds.includes(enrollment.classId))
      )
        fail(
          "permission-denied",
          "Learning content is not available to this student.",
          "W8_CONTENT_TARGET_FORBIDDEN",
        );
      const progressId = progressIdFor(
        payload.semesterId,
        payload.contentId,
        actor.actorUid,
      );
      const targetPath = path(LEARNING_PROGRESS_COLLECTION, progressId);
      const current = await transaction.get(targetPath);
      const currentRevision = Number(current.data?.revision || 0);
      if (
        (current.exists &&
          payload.expectedProgressRevision !== currentRevision) ||
        (!current.exists && payload.expectedProgressRevision !== null)
      )
        fail(
          "aborted",
          "Learning progress revision changed.",
          "W8_PROGRESS_REVISION_CONFLICT",
          { currentRevision },
        );
      const currentStatus = current.data?.status || "NOT_STARTED";
      const targetStatus =
        payload.event === "COMPLETE" ? "COMPLETED" : "IN_PROGRESS";
      if (currentStatus === "COMPLETED" && targetStatus !== "COMPLETED")
        fail(
          "failed-precondition",
          "Completed learning progress cannot move backwards.",
          "W8_PROGRESS_STATE_INVALID",
        );
      const next = currentRevision + 1;
      transaction.set(
        targetPath,
        {
          ...baseDocument(payload.semesterId),
          progressId,
          contentId: payload.contentId,
          contentRevision: payload.expectedContentRevision,
          studentUid: actor.actorUid,
          enrollmentId: payload.enrollmentId,
          classId: enrollment.classId,
          revision: next,
          status: targetStatus,
          startedAt: current.data?.startedAt || timestamp,
          completedAt:
            targetStatus === "COMPLETED"
              ? current.data?.completedAt || timestamp
              : null,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "learning-progress",
          id: progressId,
          refs: [targetPath],
        },
        sourceHash: sha256(
          `${payload.contentId}\n${payload.event}\n${actor.actorUid}`,
        ),
        result: { progressId, progressRevision: next, status: targetStatus },
      };
    }
    if (commandType === W8_COMMAND_TYPES.REQUEST_LEARNING_EXEMPTION) {
      const content = await transaction.get(
        path(LEARNING_CONTENT_COLLECTION, payload.contentId),
      );
      assertRevision(
        content,
        payload.expectedContentRevision,
        "W8_CONTENT_REVISION_CONFLICT",
      );
      const enrollment = await assertEnrollment(
        transaction,
        payload.enrollmentId,
        payload.semesterId,
        actor.actorUid,
      );
      if (
        content.data?.semesterId !== payload.semesterId ||
        content.data?.status !== "PUBLISHED" ||
        !content.data?.audienceRoles?.includes("student") ||
        (content.data?.targetClassIds?.length &&
          !content.data.targetClassIds.includes(enrollment.classId))
      )
        fail(
          "permission-denied",
          "Learning content is not available to this student.",
          "W8_CONTENT_TARGET_FORBIDDEN",
        );
      const requestId = hashId(
        "learnexreq",
        payload.semesterId,
        payload.contentId,
        actor.actorUid,
      );
      const requestPath = path(
        LEARNING_EXEMPTION_REQUEST_COLLECTION,
        requestId,
      );
      const existing = await transaction.get(requestPath);
      if (
        existing.exists &&
        ["PENDING", "APPROVED"].includes(existing.data?.status)
      )
        fail(
          "already-exists",
          "Learning exemption request already exists.",
          "W8_EXEMPTION_REQUEST_EXISTS",
        );
      transaction.set(
        requestPath,
        {
          ...baseDocument(payload.semesterId),
          requestId,
          contentId: payload.contentId,
          contentRevision: payload.expectedContentRevision,
          studentUid: actor.actorUid,
          enrollmentId: payload.enrollmentId,
          classId: enrollment.classId,
          revision: Number(existing.data?.revision || 0) + 1,
          status: "PENDING",
          reason: payload.reason,
          requestedAt: timestamp,
          updatedAt: timestamp,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "learning-exemption-request",
          id: requestId,
          refs: [requestPath],
        },
        sourceHash: sha256(`${payload.contentId}\n${actor.actorUid}`),
        result: {
          requestId,
          requestRevision: Number(existing.data?.revision || 0) + 1,
          status: "PENDING",
        },
      };
    }
    if (commandType === W8_COMMAND_TYPES.RESET_LEARNING_PROGRESS) {
      const enrollment = await assertEnrollment(
        transaction,
        payload.enrollmentId,
        payload.semesterId,
        payload.studentUid,
      );
      const refs = payload.entries.map((entry) =>
        path(
          LEARNING_PROGRESS_COLLECTION,
          progressIdFor(
            payload.semesterId,
            entry.contentId,
            payload.studentUid,
          ),
        ),
      );
      const currentRows = await transaction.getAll(refs);
      currentRows.forEach((current, index) => {
        assertRevision(
          current,
          payload.entries[index].expectedProgressRevision,
          "W8_PROGRESS_REVISION_CONFLICT",
        );
        if (current.data?.enrollmentId !== enrollment.enrollmentId)
          fail(
            "failed-precondition",
            "Learning progress Enrollment does not match.",
            "W8_ENROLLMENT_INVALID",
          );
      });
      refs.forEach((targetPath, index) => {
        transaction.set(
          targetPath,
          {
            revision: payload.entries[index].expectedProgressRevision + 1,
            status: "NOT_STARTED",
            startedAt: null,
            completedAt: null,
            resetReason: payload.reason,
            updatedAt: timestamp,
            updatedBy: actor.actorUid,
          },
          { merge: true },
        );
      });
      return {
        target: {
          kind: "learning-progress-reset",
          id: payload.studentUid,
          refs,
        },
        sourceHash: sha256(canonicalJson(payload.entries)),
        result: {
          resetCount: refs.length,
          progressIds: refs.map((ref) => ref.split("/").at(-1)),
        },
      };
    }
    if (commandType === W8_COMMAND_TYPES.GRANT_LEARNING_EXEMPTIONS) {
      const content = await transaction.get(
        path(LEARNING_CONTENT_COLLECTION, payload.contentId),
      );
      assertRevision(
        content,
        payload.expectedContentRevision,
        "W8_CONTENT_REVISION_CONFLICT",
      );
      const enrollments = await transaction.getAll(
        payload.enrollmentIds.map(enrollmentPath),
      );
      const classIds = [
        ...new Set(enrollments.map((row) => row.data?.classId).filter(Boolean)),
      ];
      const classRows = await transaction.getAll(classIds.map(classPath));
      const classById = new Map(
        classRows.map((row) => [row.data?.classId, row]),
      );
      enrollments.forEach((row, index) => {
        const enrollment = row.data || {};
        const semesterClass = classById.get(enrollment.classId);
        if (
          !row.exists ||
          enrollment.semesterId !== payload.semesterId ||
          enrollment.enrollmentStatus !== "ACTIVE" ||
          !semesterClass?.exists ||
          semesterClass.data?.semesterId !== payload.semesterId ||
          semesterClass.data?.status !== "ACTIVE"
        )
          fail(
            "failed-precondition",
            "Active Enrollment does not match the W8 target.",
            "W8_ENROLLMENT_INVALID",
            { enrollmentId: payload.enrollmentIds[index] },
          );
      });
      const ids = enrollments.map((row) =>
        exemptionIdFor(
          payload.semesterId,
          payload.contentId,
          row.data.studentUid,
        ),
      );
      const exemptionPaths = ids.map((id) =>
        path(LEARNING_EXEMPTION_COLLECTION, id),
      );
      const existingRows = await transaction.getAll(exemptionPaths);
      existingRows.forEach((existing) => {
        if (existing.exists && existing.data?.status === "ACTIVE")
          fail(
            "already-exists",
            "Learning exemption already exists.",
            "W8_EXEMPTION_EXISTS",
          );
      });
      exemptionPaths.forEach((targetPath, index) => {
        const enrollment = enrollments[index].data;
        transaction.set(targetPath, {
          ...baseDocument(payload.semesterId),
          exemptionId: ids[index],
          contentId: payload.contentId,
          contentRevision: payload.expectedContentRevision,
          studentUid: enrollment.studentUid,
          enrollmentId: payload.enrollmentIds[index],
          classId: enrollment.classId,
          revision: Number(existingRows[index].data?.revision || 0) + 1,
          status: "ACTIVE",
          reason: payload.reason,
          grantedAt: timestamp,
          grantedBy: actor.actorUid,
          updatedAt: timestamp,
        });
      });
      return {
        target: {
          kind: "learning-exemptions",
          id: payload.contentId,
          refs: ids.map((id) => path(LEARNING_EXEMPTION_COLLECTION, id)),
        },
        sourceHash: sha256(canonicalJson(payload.enrollmentIds)),
        result: { createdCount: ids.length, exemptionIds: ids },
      };
    }
    if (commandType === W8_COMMAND_TYPES.REVOKE_LEARNING_EXEMPTIONS) {
      const ids = payload.items.map((item) => item.exemptionId);
      const targetPaths = ids.map((id) =>
        path(LEARNING_EXEMPTION_COLLECTION, id),
      );
      const currentRows = await transaction.getAll(targetPaths);
      currentRows.forEach((current, index) => {
        assertRevision(
          current,
          payload.items[index].expectedExemptionRevision,
          "W8_EXEMPTION_REVISION_CONFLICT",
        );
        if (
          current.data?.semesterId !== payload.semesterId ||
          current.data?.status !== "ACTIVE"
        )
          fail(
            "failed-precondition",
            "Learning exemption is not active.",
            "W8_EXEMPTION_STATE_INVALID",
          );
      });
      targetPaths.forEach((targetPath, index) =>
        transaction.set(
          targetPath,
          {
            revision: payload.items[index].expectedExemptionRevision + 1,
            status: "REVOKED",
            revokeReason: payload.reason,
            revokedAt: timestamp,
            revokedBy: actor.actorUid,
            updatedAt: timestamp,
          },
          { merge: true },
        ),
      );
      return {
        target: {
          kind: "learning-exemptions-revoke",
          id: commandId,
          refs: ids.map((id) => path(LEARNING_EXEMPTION_COLLECTION, id)),
        },
        sourceHash: sha256(canonicalJson(payload.items)),
        result: { revokedCount: ids.length, exemptionIds: ids },
      };
    }
    if (commandType === W8_COMMAND_TYPES.REVIEW_LEARNING_EXEMPTION_REQUEST) {
      const requestPath = path(
        LEARNING_EXEMPTION_REQUEST_COLLECTION,
        payload.requestId,
      );
      const request = await transaction.get(requestPath);
      assertRevision(
        request,
        payload.expectedRequestRevision,
        "W8_EXEMPTION_REQUEST_REVISION_CONFLICT",
      );
      if (
        request.data?.semesterId !== payload.semesterId ||
        request.data?.status !== "PENDING"
      )
        fail(
          "failed-precondition",
          "Learning exemption request is not pending.",
          "W8_EXEMPTION_REQUEST_STATE_INVALID",
        );
      const enrollment = await assertEnrollment(
        transaction,
        request.data.enrollmentId,
        payload.semesterId,
        request.data.studentUid,
      );
      const content = await transaction.get(
        path(LEARNING_CONTENT_COLLECTION, request.data.contentId),
      );
      if (
        payload.action === "APPROVE" &&
        (!content.exists ||
          content.data?.semesterId !== payload.semesterId ||
          content.data?.status !== "PUBLISHED" ||
          Number(content.data?.revision || 0) !==
            Number(request.data?.contentRevision || 0) ||
          !content.data?.audienceRoles?.includes("student") ||
          (content.data?.targetClassIds?.length &&
            !content.data.targetClassIds.includes(enrollment.classId)))
      )
        fail(
          "failed-precondition",
          "Learning exemption request content is no longer eligible.",
          "W8_EXEMPTION_CONTENT_STALE",
        );
      const status = payload.action === "APPROVE" ? "APPROVED" : "REJECTED";
      const next = payload.expectedRequestRevision + 1;
      let exemptionId = null;
      const refs = [requestPath];
      if (status === "APPROVED") {
        exemptionId = exemptionIdFor(
          payload.semesterId,
          request.data.contentId,
          request.data.studentUid,
        );
        const exemptionPath = path(LEARNING_EXEMPTION_COLLECTION, exemptionId);
        const existing = await transaction.get(exemptionPath);
        if (existing.exists && existing.data?.status === "ACTIVE")
          fail(
            "already-exists",
            "Learning exemption already exists.",
            "W8_EXEMPTION_EXISTS",
          );
        transaction.set(exemptionPath, {
          ...baseDocument(payload.semesterId),
          exemptionId,
          contentId: request.data.contentId,
          contentRevision: request.data.contentRevision,
          studentUid: request.data.studentUid,
          enrollmentId: request.data.enrollmentId,
          classId: enrollment.classId,
          revision: Number(existing.data?.revision || 0) + 1,
          status: "ACTIVE",
          reason: payload.reason,
          requestId: payload.requestId,
          grantedAt: timestamp,
          grantedBy: actor.actorUid,
          updatedAt: timestamp,
        });
        refs.push(exemptionPath);
      }
      transaction.set(
        requestPath,
        {
          revision: next,
          status,
          reviewReason: payload.reason,
          reviewedAt: timestamp,
          reviewedBy: actor.actorUid,
          exemptionId,
          updatedAt: timestamp,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "learning-exemption-request",
          id: payload.requestId,
          refs,
        },
        sourceHash: sha256(`${payload.requestId}\n${payload.action}`),
        result: {
          requestId: payload.requestId,
          requestRevision: next,
          status,
          ...(exemptionId ? { exemptionId } : {}),
        },
      };
    }
    if (commandType === W8_COMMAND_TYPES.CREATE_SCHEDULE_EVENT) {
      await assertClasses(
        transaction,
        payload.targetClassIds,
        payload.semesterId,
      );
      await assertTargetUsers(
        transaction,
        payload.targetUserIds,
        payload.semesterId,
      );
      if (payload.eventType === "HOLIDAY" || payload.sourceDomain === "HOLIDAY")
        fail(
          "failed-precondition",
          "Holiday events use syncKoreanPublicHolidays.",
          "W8_HOLIDAY_COMMAND_REQUIRED",
        );
      if (payload.sourceReference) {
        const existing = await transaction.query(SCHEDULE_EVENT_COLLECTION, {
          field: "sourceReference",
          operator: "==",
          value: payload.sourceReference,
        });
        if (
          existing.some(
            (row) =>
              row.data?.semesterId === payload.semesterId &&
              row.data?.status !== "ARCHIVED",
          )
        )
          fail(
            "already-exists",
            "Schedule source already exists.",
            "W8_SCHEDULE_SOURCE_DUPLICATE",
          );
      }
      const eventId = hashId("schedule", payload.semesterId, commandId);
      const targetPath = path(SCHEDULE_EVENT_COLLECTION, eventId);
      transaction.create(targetPath, {
        ...baseDocument(payload.semesterId),
        provenance: manifest.status === "ACTIVE" ? "CURRENT" : "PREPARING",
        readOnly: manifest.status !== "ACTIVE",
        cutoverPlanId: payload.cutoverPlanId || null,
        eventId,
        revision: 1,
        status: "ACTIVE",
        ...editableSchedule(payload),
        createdAt: timestamp,
        createdBy: actor.actorUid,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
      });
      return {
        target: { kind: "schedule-event", id: eventId, refs: [targetPath] },
        sourceHash: sha256(canonicalJson(payload)),
        result: { eventId, eventRevision: 1, status: "ACTIVE" },
      };
    }
    if (commandType === W8_COMMAND_TYPES.UPDATE_SCHEDULE_EVENT) {
      await assertClasses(
        transaction,
        payload.targetClassIds,
        payload.semesterId,
      );
      await assertTargetUsers(
        transaction,
        payload.targetUserIds,
        payload.semesterId,
      );
      const targetPath = path(SCHEDULE_EVENT_COLLECTION, payload.eventId);
      const event = await transaction.get(targetPath);
      assertRevision(
        event,
        payload.expectedEventRevision,
        "W8_SCHEDULE_REVISION_CONFLICT",
      );
      if (
        event.data?.semesterId !== payload.semesterId ||
        event.data?.status !== "ACTIVE" ||
        event.data?.sourceDomain === "HOLIDAY" ||
        payload.sourceDomain === "HOLIDAY"
      )
        fail(
          "failed-precondition",
          "Schedule event cannot be edited.",
          "W8_SCHEDULE_STATE_INVALID",
        );
      if (payload.sourceReference) {
        const duplicates = await transaction.query(SCHEDULE_EVENT_COLLECTION, {
          field: "sourceReference",
          operator: "==",
          value: payload.sourceReference,
        });
        if (
          duplicates.some(
            (row) =>
              row.data?.eventId !== payload.eventId &&
              row.data?.semesterId === payload.semesterId &&
              row.data?.status !== "ARCHIVED",
          )
        )
          fail(
            "already-exists",
            "Schedule source already exists.",
            "W8_SCHEDULE_SOURCE_DUPLICATE",
          );
      }
      const next = payload.expectedEventRevision + 1;
      transaction.set(
        targetPath,
        {
          ...editableSchedule(payload),
          revision: next,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "schedule-event",
          id: payload.eventId,
          refs: [targetPath],
        },
        sourceHash: sha256(canonicalJson(payload)),
        result: { eventId: payload.eventId, eventRevision: next },
      };
    }
    if (commandType === W8_COMMAND_TYPES.DELETE_SCHEDULE_EVENT) {
      const targetPath = path(SCHEDULE_EVENT_COLLECTION, payload.eventId);
      const event = await transaction.get(targetPath);
      assertRevision(
        event,
        payload.expectedEventRevision,
        "W8_SCHEDULE_REVISION_CONFLICT",
      );
      if (
        event.data?.semesterId !== payload.semesterId ||
        event.data?.status !== "ACTIVE" ||
        event.data?.sourceDomain === "HOLIDAY"
      )
        fail(
          "failed-precondition",
          "Schedule event cannot be archived.",
          "W8_SCHEDULE_STATE_INVALID",
        );
      const next = payload.expectedEventRevision + 1;
      transaction.set(
        targetPath,
        {
          revision: next,
          status: "ARCHIVED",
          archiveReason: payload.reason,
          archivedAt: timestamp,
          archivedBy: actor.actorUid,
          updatedAt: timestamp,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "schedule-event-archive",
          id: payload.eventId,
          refs: [targetPath],
        },
        sourceHash: sha256(`${payload.eventId}\nARCHIVED`),
        result: {
          eventId: payload.eventId,
          eventRevision: next,
          status: "ARCHIVED",
        },
      };
    }
    if (commandType === W8_COMMAND_TYPES.CREATE_ATTENDANCE_SESSION) {
      await assertClasses(transaction, [payload.classId], payload.semesterId);
      if (payload.sourceEventId) {
        const event = await transaction.get(
          path(SCHEDULE_EVENT_COLLECTION, payload.sourceEventId),
        );
        assertRevision(
          event,
          payload.expectedSourceEventRevision,
          "W8_SCHEDULE_REVISION_CONFLICT",
        );
        if (
          event.data?.semesterId !== payload.semesterId ||
          !event.data?.targetClassIds?.includes(payload.classId)
        )
          fail(
            "failed-precondition",
            "Schedule event does not match Attendance Session.",
            "W8_ATTENDANCE_SOURCE_INVALID",
          );
      }
      const sessionId = attendanceSessionIdFor(
        payload.semesterId,
        payload.classId,
        payload.date,
        payload.period,
      );
      const targetPath = path(ATTENDANCE_SESSION_COLLECTION, sessionId);
      if ((await transaction.get(targetPath)).exists)
        fail(
          "already-exists",
          "Attendance Session already exists.",
          "W8_ATTENDANCE_SESSION_EXISTS",
        );
      transaction.create(targetPath, {
        ...baseDocument(payload.semesterId),
        sessionId,
        classId: payload.classId,
        date: payload.date,
        period: payload.period,
        sourceEventId: payload.sourceEventId,
        revision: 1,
        status: "OPEN",
        openedAt: timestamp,
        openedBy: actor.actorUid,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return {
        target: {
          kind: "attendance-session",
          id: sessionId,
          refs: [targetPath],
        },
        sourceHash: sha256(
          `${payload.semesterId}\n${payload.classId}\n${payload.date}\n${payload.period}`,
        ),
        result: { sessionId, sessionRevision: 1, status: "OPEN" },
      };
    }
    if (
      [
        W8_COMMAND_TYPES.RECORD_ATTENDANCE,
        W8_COMMAND_TYPES.RECORD_ATTENDANCE_BULK,
      ].includes(commandType)
    ) {
      const session = await transaction.get(
        path(ATTENDANCE_SESSION_COLLECTION, payload.sessionId),
      );
      assertRevision(
        session,
        payload.expectedSessionRevision,
        "W8_ATTENDANCE_SESSION_REVISION_CONFLICT",
      );
      if (
        session.data?.semesterId !== payload.semesterId ||
        session.data?.status !== "OPEN"
      )
        fail(
          "failed-precondition",
          "Attendance Session is not open.",
          "W8_ATTENDANCE_SESSION_STATE_INVALID",
        );
      const entries =
        commandType === W8_COMMAND_TYPES.RECORD_ATTENDANCE
          ? [payload]
          : payload.entries;
      if (
        new Set(entries.map((entry) => entry.studentUid)).size !==
        entries.length
      )
        fail(
          "invalid-argument",
          "Attendance entries contain duplicates.",
          "W8_ATTENDANCE_DUPLICATE_STUDENT",
        );
      const enrollmentRows = await transaction.getAll(
        entries.map((entry) => enrollmentPath(entry.enrollmentId)),
      );
      const classRows = await transaction.getAll(
        [
          ...new Set(
            enrollmentRows.map((row) => row.data?.classId).filter(Boolean),
          ),
        ].map(classPath),
      );
      const classById = new Map(
        classRows.map((row) => [row.data?.classId, row]),
      );
      enrollmentRows.forEach((row, index) => {
        const enrollment = row.data || {};
        const semesterClass = classById.get(enrollment.classId);
        if (
          !row.exists ||
          enrollment.semesterId !== payload.semesterId ||
          enrollment.enrollmentStatus !== "ACTIVE" ||
          enrollment.studentUid !== entries[index].studentUid ||
          enrollment.classId !== session.data.classId ||
          !semesterClass?.exists ||
          semesterClass.data?.status !== "ACTIVE"
        )
          fail(
            "failed-precondition",
            "Active Enrollment does not match Attendance Session.",
            "W8_ENROLLMENT_INVALID",
            { enrollmentId: entries[index].enrollmentId },
          );
      });
      const recordIds = entries.map((entry) =>
        attendanceRecordIdFor(session.data.sessionId, entry.studentUid),
      );
      const targetPaths = recordIds.map((id) =>
        path(ATTENDANCE_RECORD_COLLECTION, id),
      );
      const currentRows = await transaction.getAll(targetPaths);
      const rows = currentRows.map((current, index) => {
        const currentRevision = Number(current.data?.revision || 0);
        if (
          (current.exists &&
            entries[index].expectedRecordRevision !== currentRevision) ||
          (!current.exists && entries[index].expectedRecordRevision !== null)
        )
          fail(
            "aborted",
            "Attendance Record revision changed.",
            "W8_ATTENDANCE_RECORD_REVISION_CONFLICT",
            { recordId: recordIds[index], currentRevision },
          );
        return {
          recordId: recordIds[index],
          recordRevision: currentRevision + 1,
          path: targetPaths[index],
        };
      });
      rows.forEach((row, index) => {
        const current = currentRows[index];
        const entry = entries[index];
        transaction.set(
          row.path,
          {
            ...baseDocument(payload.semesterId),
            recordId: row.recordId,
            sessionId: session.data.sessionId,
            studentUid: entry.studentUid,
            enrollmentId: entry.enrollmentId,
            classId: session.data.classId,
            attendanceStatus: entry.attendanceStatus,
            reason: entry.reason,
            revision: row.recordRevision,
            recordedAt: current.data?.recordedAt || timestamp,
            recordedBy: current.data?.recordedBy || actor.actorUid,
            updatedAt: timestamp,
            updatedBy: actor.actorUid,
          },
          { merge: true },
        );
      });
      return {
        target: {
          kind:
            commandType === W8_COMMAND_TYPES.RECORD_ATTENDANCE
              ? "attendance-record"
              : "attendance-bulk",
          id: payload.sessionId,
          refs: rows.map((row) => row.path),
        },
        sourceHash: sha256(canonicalJson(entries)),
        result:
          commandType === W8_COMMAND_TYPES.RECORD_ATTENDANCE
            ? {
                recordId: rows[0].recordId,
                recordRevision: rows[0].recordRevision,
              }
            : {
                recordedCount: rows.length,
                records: rows.map(({ recordId, recordRevision }) => ({
                  recordId,
                  recordRevision,
                })),
              },
      };
    }
    if (commandType === W8_COMMAND_TYPES.CORRECT_ATTENDANCE_RECORD) {
      const targetPath = path(ATTENDANCE_RECORD_COLLECTION, payload.recordId);
      const record = await transaction.get(targetPath);
      assertRevision(
        record,
        payload.expectedRecordRevision,
        "W8_ATTENDANCE_RECORD_REVISION_CONFLICT",
      );
      const [session, enrollment, semesterClass] = await transaction.getAll([
        path(ATTENDANCE_SESSION_COLLECTION, record.data?.sessionId),
        enrollmentPath(record.data?.enrollmentId),
        classPath(record.data?.classId),
      ]);
      if (
        record.data?.semesterId !== payload.semesterId ||
        !session.exists ||
        session.data?.semesterId !== payload.semesterId ||
        !["OPEN", "CLOSED"].includes(session.data?.status) ||
        session.data?.classId !== record.data?.classId ||
        !enrollment.exists ||
        enrollment.data?.semesterId !== payload.semesterId ||
        enrollment.data?.enrollmentStatus !== "ACTIVE" ||
        enrollment.data?.studentUid !== record.data?.studentUid ||
        enrollment.data?.classId !== record.data?.classId ||
        !semesterClass.exists ||
        semesterClass.data?.semesterId !== payload.semesterId ||
        semesterClass.data?.status !== "ACTIVE"
      )
        fail(
          "failed-precondition",
          "Attendance correction dependencies are invalid.",
          "W8_ATTENDANCE_SCOPE_INVALID",
        );
      const next = payload.expectedRecordRevision + 1;
      const revisionId = hashId("attrev", payload.recordId, String(next));
      const revisionPath = path(ATTENDANCE_REVISION_COLLECTION, revisionId);
      transaction.create(revisionPath, {
        ...baseDocument(payload.semesterId),
        revisionId,
        recordId: payload.recordId,
        fromRevision: payload.expectedRecordRevision,
        toRevision: next,
        previousStatus: record.data?.attendanceStatus,
        nextStatus: payload.attendanceStatus,
        reason: payload.reason,
        sessionStatusAtCorrection: session.data?.status,
        correctedAt: timestamp,
        correctedBy: actor.actorUid,
        commandId,
        receiptId,
      });
      transaction.set(
        targetPath,
        {
          revision: next,
          attendanceStatus: payload.attendanceStatus,
          reason: payload.reason,
          correctedAt: timestamp,
          correctedBy: actor.actorUid,
          lastRevisionId: revisionId,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "attendance-correction",
          id: payload.recordId,
          refs: [targetPath, revisionPath],
        },
        sourceHash: sha256(
          canonicalJson({
            recordId: payload.recordId,
            from: record.data?.attendanceStatus,
            to: payload.attendanceStatus,
          }),
        ),
        result: {
          recordId: payload.recordId,
          recordRevision: next,
          revisionId,
        },
      };
    }
    if (commandType === W8_COMMAND_TYPES.CLOSE_ATTENDANCE_SESSION) {
      const targetPath = path(ATTENDANCE_SESSION_COLLECTION, payload.sessionId);
      const session = await transaction.get(targetPath);
      assertRevision(
        session,
        payload.expectedSessionRevision,
        "W8_ATTENDANCE_SESSION_REVISION_CONFLICT",
      );
      if (
        session.data?.semesterId !== payload.semesterId ||
        session.data?.status !== "OPEN"
      )
        fail(
          "failed-precondition",
          "Attendance Session is not open.",
          "W8_ATTENDANCE_SESSION_STATE_INVALID",
        );
      const records = await transaction.query(ATTENDANCE_RECORD_COLLECTION, {
        field: "sessionId",
        operator: "==",
        value: payload.sessionId,
      });
      const enrollments = await transaction.query(
        archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION,
        { field: "semesterId", operator: "==", value: payload.semesterId },
      );
      const recordedUids = new Set(records.map((row) => row.data?.studentUid));
      const unrecordedCount = enrollments.filter(
        (row) =>
          row.data?.enrollmentStatus === "ACTIVE" &&
          row.data?.classId === session.data.classId &&
          !recordedUids.has(row.data?.studentUid),
      ).length;
      const next = payload.expectedSessionRevision + 1;
      transaction.set(
        targetPath,
        {
          revision: next,
          status: "CLOSED",
          unrecordedCountAtClose: unrecordedCount,
          closedAt: timestamp,
          closedBy: actor.actorUid,
          updatedAt: timestamp,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "attendance-session-close",
          id: payload.sessionId,
          refs: [targetPath],
        },
        sourceHash: sha256(`${payload.sessionId}\nCLOSED\n${unrecordedCount}`),
        result: {
          sessionId: payload.sessionId,
          sessionRevision: next,
          status: "CLOSED",
          unrecordedCount,
        },
      };
    }
    if (commandType === W8_COMMAND_TYPES.CREATE_NOTICE) {
      await assertClasses(
        transaction,
        payload.targetClassIds,
        payload.semesterId,
      );
      await assertTargetUsers(
        transaction,
        payload.targetUserIds,
        payload.semesterId,
      );
      const noticeId = hashId("notice", payload.semesterId, commandId);
      const targetPath = path(NOTICE_COLLECTION, noticeId);
      transaction.create(targetPath, {
        ...baseDocument(payload.semesterId),
        provenance: manifest.status === "ACTIVE" ? "CURRENT" : "PREPARING",
        readOnly: manifest.status !== "ACTIVE",
        cutoverPlanId: payload.cutoverPlanId || null,
        noticeId,
        revision: 1,
        status: "DRAFT",
        ...editableNotice(payload),
        createdAt: timestamp,
        createdBy: actor.actorUid,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
      });
      return {
        target: { kind: "notice", id: noticeId, refs: [targetPath] },
        sourceHash: sha256(canonicalJson(payload)),
        result: { noticeId, noticeRevision: 1, status: "DRAFT" },
      };
    }
    if (commandType === W8_COMMAND_TYPES.UPDATE_NOTICE) {
      await assertClasses(
        transaction,
        payload.targetClassIds,
        payload.semesterId,
      );
      await assertTargetUsers(
        transaction,
        payload.targetUserIds,
        payload.semesterId,
      );
      const targetPath = path(NOTICE_COLLECTION, payload.noticeId);
      const notice = await transaction.get(targetPath);
      assertRevision(
        notice,
        payload.expectedNoticeRevision,
        "W8_NOTICE_REVISION_CONFLICT",
      );
      if (
        notice.data?.semesterId !== payload.semesterId ||
        notice.data?.status !== "DRAFT"
      )
        fail(
          "failed-precondition",
          "Only a Draft Notice can be edited.",
          "W8_NOTICE_STATE_INVALID",
        );
      const next = payload.expectedNoticeRevision + 1;
      transaction.set(
        targetPath,
        {
          ...editableNotice(payload),
          revision: next,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      return {
        target: { kind: "notice", id: payload.noticeId, refs: [targetPath] },
        sourceHash: sha256(canonicalJson(payload)),
        result: { noticeId: payload.noticeId, noticeRevision: next },
      };
    }
    if (commandType === W8_COMMAND_TYPES.TRANSITION_NOTICE) {
      const targetPath = path(NOTICE_COLLECTION, payload.noticeId);
      const notice = await transaction.get(targetPath);
      assertRevision(
        notice,
        payload.expectedNoticeRevision,
        "W8_NOTICE_REVISION_CONFLICT",
      );
      const transitions = {
        DRAFT: ["SCHEDULED", "PUBLISHED", "ARCHIVED"],
        SCHEDULED: ["PUBLISHED", "EXPIRED", "ARCHIVED"],
        PUBLISHED: ["EXPIRED", "ARCHIVED"],
        EXPIRED: ["ARCHIVED"],
      };
      if (
        notice.data?.semesterId !== payload.semesterId ||
        !transitions[notice.data?.status]?.includes(payload.targetStatus)
      )
        fail(
          "failed-precondition",
          "Notice transition is invalid.",
          "W8_NOTICE_STATE_INVALID",
        );
      const next = payload.expectedNoticeRevision + 1;
      const refs = [targetPath];
      let deliveryCount = 0;
      if (payload.targetStatus === "SCHEDULED" && !notice.data?.publishAt)
        fail(
          "failed-precondition",
          "Scheduled Notice requires publishAt.",
          "W8_NOTICE_SCHEDULE_INVALID",
        );
      if (["SCHEDULED", "PUBLISHED"].includes(payload.targetStatus)) {
        const enrollments = await transaction.query(
          archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION,
          { field: "semesterId", operator: "==", value: payload.semesterId },
        );
        const activeUids = new Set(
          enrollments
            .filter((row) => row.data?.enrollmentStatus === "ACTIVE")
            .map((row) => row.data?.studentUid),
        );
        const explicitUsers = new Set(notice.data?.targetUserIds || []);
        const recipients = new Set(
          enrollments
            .filter(
              (row) =>
                row.data?.enrollmentStatus === "ACTIVE" &&
                (!(notice.data?.targetClassIds || []).length ||
                  notice.data.targetClassIds.includes(row.data?.classId)) &&
                (!explicitUsers.size ||
                  explicitUsers.has(row.data?.studentUid)),
            )
            .map((row) => row.data.studentUid),
        );
        if (recipients.size === 0)
          fail(
            "failed-precondition",
            "Notice target resolves to no active students.",
            "W8_NOTICE_TARGET_EMPTY",
          );
        if ([...recipients].some((uid) => !activeUids.has(uid)))
          fail(
            "failed-precondition",
            "Notice target is invalid.",
            "W8_ENROLLMENT_INVALID",
          );
        if (recipients.size > 100)
          fail(
            "resource-exhausted",
            "Notice delivery is limited to 100 recipients per W8 command.",
            "W8_NOTICE_RECIPIENT_LIMIT",
            { recipientCount: recipients.size, maximum: 100 },
          );
        const recipientUids = [...recipients];
        const deliveryIds = recipientUids.map((uid) =>
          deliveryIdFor(payload.noticeId, uid),
        );
        const deliveryPaths = deliveryIds.map((id) =>
          path(NOTICE_DELIVERY_COLLECTION, id),
        );
        const existingRows = await transaction.getAll(deliveryPaths);
        deliveryPaths.forEach((deliveryPath, index) => {
          if (!existingRows[index].exists) {
            const uid = recipientUids[index];
            transaction.create(deliveryPath, {
              ...baseDocument(payload.semesterId),
              deliveryId: deliveryIds[index],
              noticeId: payload.noticeId,
              noticeRevision: next,
              recipientUid: uid,
              revision: 1,
              status: "DELIVERED",
              deliveredAt: timestamp,
              dedupeKey: `${payload.noticeId}:${uid}`,
            });
            deliveryCount += 1;
          }
          refs.push(deliveryPath);
        });
      }
      transaction.set(
        targetPath,
        {
          revision: next,
          status: payload.targetStatus,
          publishedAt:
            payload.targetStatus === "PUBLISHED"
              ? timestamp
              : notice.data?.publishedAt || null,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      return {
        target: { kind: "notice-transition", id: payload.noticeId, refs },
        sourceHash: sha256(`${payload.noticeId}\n${payload.targetStatus}`),
        result: {
          noticeId: payload.noticeId,
          noticeRevision: next,
          status: payload.targetStatus,
          deliveryCount,
        },
      };
    }
    if (
      [
        W8_COMMAND_TYPES.ACKNOWLEDGE_NOTICE,
        W8_COMMAND_TYPES.ACKNOWLEDGE_ALL_NOTICES,
      ].includes(commandType)
    ) {
      const requested =
        commandType === W8_COMMAND_TYPES.ACKNOWLEDGE_NOTICE
          ? [
              {
                noticeId: payload.noticeId,
                expectedNoticeRevision: payload.expectedNoticeRevision,
              },
            ]
          : payload.notices;
      const noticeRows = await transaction.getAll(
        requested.map((item) => path(NOTICE_COLLECTION, item.noticeId)),
      );
      const deliveryIds = requested.map((item) =>
        deliveryIdFor(item.noticeId, actor.actorUid),
      );
      const deliveryRows = await transaction.getAll(
        deliveryIds.map((id) => path(NOTICE_DELIVERY_COLLECTION, id)),
      );
      const acknowledgementIds = requested.map((item) =>
        acknowledgementIdFor(item.noticeId, actor.actorUid),
      );
      const acknowledgementPaths = acknowledgementIds.map((id) =>
        path(NOTICE_ACK_COLLECTION, id),
      );
      const acknowledgementRows =
        await transaction.getAll(acknowledgementPaths);
      const currentIso = now();
      noticeRows.forEach((notice, index) => {
        assertRevision(
          notice,
          requested[index].expectedNoticeRevision,
          "W8_NOTICE_REVISION_CONFLICT",
        );
        const scheduledAvailable =
          notice.data?.status === "SCHEDULED" &&
          notice.data?.publishAt &&
          notice.data.publishAt <= currentIso &&
          (!notice.data?.expireAt || notice.data.expireAt >= currentIso);
        if (
          notice.data?.semesterId !== payload.semesterId ||
          (notice.data?.status !== "PUBLISHED" && !scheduledAvailable) ||
          (notice.data?.expireAt && notice.data.expireAt < currentIso)
        )
          fail(
            "failed-precondition",
            "Notice is not available for acknowledgement.",
            "W8_NOTICE_STATE_INVALID",
          );
        if (!deliveryRows[index].exists)
          fail(
            "permission-denied",
            "Notice is not targeted to this student.",
            "W8_NOTICE_TARGET_FORBIDDEN",
          );
      });
      acknowledgementPaths.forEach((acknowledgementPath, index) => {
        if (!acknowledgementRows[index].exists)
          transaction.create(acknowledgementPath, {
            ...baseDocument(payload.semesterId),
            acknowledgementId: acknowledgementIds[index],
            noticeId: requested[index].noticeId,
            noticeRevision: requested[index].expectedNoticeRevision,
            studentUid: actor.actorUid,
            revision: 1,
            acknowledgedAt: timestamp,
            commandId,
            receiptId,
          });
      });
      if (commandType === W8_COMMAND_TYPES.ACKNOWLEDGE_NOTICE)
        return {
          target: {
            kind: "notice-acknowledgement",
            id: acknowledgementIds[0],
            refs: [acknowledgementPaths[0]],
          },
          sourceHash: sha256(`${payload.noticeId}\n${actor.actorUid}`),
          result: {
            noticeId: payload.noticeId,
            acknowledgementId: acknowledgementIds[0],
            acknowledged: true,
          },
        };
      return {
        target: {
          kind: "notice-acknowledgements",
          id: actor.actorUid,
          refs: acknowledgementPaths,
        },
        sourceHash: sha256(canonicalJson(payload.notices)),
        result: {
          acknowledgedCount: acknowledgementIds.length,
          acknowledgementIds,
        },
      };
    }
    if (commandType === W8_COMMAND_TYPES.UPDATE_NOTIFICATION_SETTINGS) {
      const current = await transaction.get(NOTIFICATION_CONFIG_PATH);
      const currentRevision = Number(current.data?.revision || 0);
      if (
        (current.exists &&
          payload.expectedConfigRevision !== currentRevision) ||
        (!current.exists && payload.expectedConfigRevision !== null)
      )
        fail(
          "aborted",
          "Notification config revision changed.",
          "W8_NOTIFICATION_CONFIG_REVISION_CONFLICT",
          { currentRevision },
        );
      const next = currentRevision + 1;
      transaction.set(
        NOTIFICATION_CONFIG_PATH,
        {
          schemaVersion: W8_SCHEMA_VERSION,
          policyVersion: W8_POLICY_VERSION,
          revision: next,
          enabled: payload.enabled,
          studentNotificationsEnabled: payload.studentNotificationsEnabled,
          teacherNotificationsEnabled: payload.teacherNotificationsEnabled,
          eventPolicies: payload.eventPolicies,
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      return {
        target: {
          kind: "notification-config",
          id: "notification_config",
          refs: [NOTIFICATION_CONFIG_PATH],
        },
        sourceHash: sha256(canonicalJson(payload.eventPolicies)),
        result: { configRevision: next },
      };
    }
    fail(
      "invalid-argument",
      "Unsupported W8 command.",
      "W8_COMMAND_UNSUPPORTED",
    );
  },
});

const normalizeQuery = (raw) => {
  const value = raw || {};
  allowed(
    value,
    [
      "domain",
      "audience",
      "semesterId",
      "source",
      "provenance",
      "contentId",
      "eventId",
      "sessionId",
      "noticeId",
      "studentUid",
      "classId",
      "_session",
    ],
    "getW8DomainState payload",
  );
  const source = value.provenance || value.source;
  return {
    domain: enumValue(
      value.domain,
      ["LEARNING", "SCHEDULE", "ATTENDANCE", "COMMUNICATION", "DASHBOARD"],
      "domain",
    ),
    audience: enumValue(value.audience, ["student", "teacher"], "audience"),
    semesterId: semesterId(value.semesterId),
    source: enumValue(
      source,
      ["CURRENT", "ARCHIVE", "LEGACY", "EXPLICIT"],
      "source",
    ),
    contentId: value.contentId ? text(value.contentId, "contentId", 80) : "",
    eventId: value.eventId ? text(value.eventId, "eventId", 80) : "",
    sessionId: value.sessionId ? text(value.sessionId, "sessionId", 80) : "",
    noticeId: value.noticeId ? text(value.noticeId, "noticeId", 80) : "",
    studentUid: value.studentUid
      ? text(value.studentUid, "studentUid", 180)
      : "",
    classId: value.classId ? text(value.classId, "classId", 80) : "",
  };
};
const createW8QueryCore = ({
  store,
  assertSession = sessionAuthority.assertActiveApplicationSession,
  now = () => new Date().toISOString(),
} = {}) => {
  if (!store) throw new TypeError("store is required.");
  const getW8DomainState = async (request) => {
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
    if (
      query.audience === "student" &&
      query.studentUid &&
      query.studentUid !== uid
    )
      fail(
        "permission-denied",
        "Students can only query their own W8 state.",
        "W8_STUDENT_SCOPE_FORBIDDEN",
      );
    const profile = await store.get(`users/${uid}`);
    const isAdmin =
      String(
        identity?.email || request.auth?.token?.email || "",
      ).toLowerCase() === "westoria28@gmail.com";
    const profileRole = String(profile.data?.role || "").trim();
    const isTeacher = profileRole === "teacher";
    const delegatedLessonRead =
      query.domain === "LEARNING" &&
      !isTeacher &&
      profile.data?.teacherPortalEnabled === true &&
      Array.isArray(profile.data?.staffPermissions) &&
      profile.data.staffPermissions.includes("lesson_read");
    const canReadTeacherState = isAdmin || isTeacher || delegatedLessonRead;
    if (query.audience === "teacher" && !canReadTeacherState)
      fail(
        "permission-denied",
        "Teacher W8 access is required.",
        "W8_MANAGE_REQUIRED",
      );
    const base = {
      domain: query.domain,
      audience: query.audience,
      semesterId: query.semesterId,
      manifestRevision: 0,
      provenance: query.source === "LEGACY" ? "LEGACY" : "PREPARING",
      source: query.source,
      readOnly: true,
      status: query.source === "LEGACY" ? "LEGACY" : "EMPTY",
      enrollment: null,
      enrollmentId: null,
      contents: [],
      progress: [],
      exemptions: [],
      exemptionRequests: [],
      events: [],
      sessions: [],
      records: [],
      notices: [],
      deliveries: [],
      acknowledgements: [],
      notificationConfig: null,
      thinkCloudState: {
        activeSessionId: "",
        activeSessionIds: [],
        revision: 0,
        exists: false,
      },
      thinkCloudSessions: [],
      thinkCloudResponses: [],
      thinkCloudRoster: [],
      thinkCloudManagedClasses: [],
      dashboard: {
        todaySchedule: [],
        upcomingLearning: [],
        attendancePendingCount: 0,
        importantNotices: [],
      },
      reason:
        query.source === "LEGACY"
          ? "LEGACY_SOURCE_REQUIRES_EXPLICIT_READ_ONLY_ADAPTER"
          : "SEMESTER_NOT_FOUND",
      writeCount: 0,
    };
    if (query.audience === "student" && query.source !== "CURRENT")
      fail("permission-denied", "Students can only read the current semester.", "W8_STUDENT_CURRENT_SEMESTER_REQUIRED");
    if (query.source === "LEGACY") return base;
    return store.runTransaction(async (transaction) => {
      const manifest = await transaction.get(manifestPath(query.semesterId));
      if (!manifest.exists) return base;
      if (query.audience === "student") {
        const pointer = await transaction.get(semesterCore.ACTIVE_SEMESTER_POINTER_PATH);
        if (!pointer.exists || pointer.data?.semesterId !== query.semesterId
          || !Number.isSafeInteger(pointer.data?.revision) || pointer.data.revision < 1
          || pointer.data?.revision !== manifest.data?.revision || manifest.data?.status !== "ACTIVE"
          || manifest.data?.readOnly === true)
          fail("permission-denied", "Students can only read the current semester.", "W8_STUDENT_CURRENT_SEMESTER_REQUIRED");
      }
      const manifestStatus = String(manifest.data?.status || "");
      const lifecycleProvenance = ["CLOSED", "ARCHIVED"].includes(
        manifestStatus,
      )
        ? "ARCHIVE"
        : manifestStatus === "ACTIVE"
          ? "CURRENT"
          : "PREPARING";
      if (query.source === "CURRENT" && lifecycleProvenance !== "CURRENT")
        fail(
          "failed-precondition",
          "Requested CURRENT source does not match the Semester lifecycle.",
          "W8_SOURCE_MISMATCH",
        );
      if (query.source === "ARCHIVE" && lifecycleProvenance !== "ARCHIVE")
        fail(
          "failed-precondition",
          "Requested ARCHIVE source does not match the Semester lifecycle.",
          "W8_SOURCE_MISMATCH",
        );
      if (query.audience === "teacher" && query.domain === "LEARNING" && lifecycleProvenance === "ARCHIVE")
        fail("permission-denied", "지난 학기 수업 자료와 생각 모아는 관리자 설정의 학기 조회에서 확인해 주세요.", "W8_ARCHIVE_CONTENT_ADMIN_VIEW_REQUIRED");
      const provenance =
        query.source === "EXPLICIT" ? "EXPLICIT" : lifecycleProvenance;
      const readOnly =
        (!isAdmin && delegatedLessonRead) ||
        query.source === "EXPLICIT" ||
        lifecycleProvenance !== "CURRENT";
      if (query.audience === "student" && lifecycleProvenance === "PREPARING")
        return {
          ...base,
          manifestRevision: Number(manifest.data?.revision || 0),
          provenance: query.source === "EXPLICIT" ? "EXPLICIT" : "PREPARING",
          source: query.source,
          readOnly: true,
          status: "EMPTY",
          reason: "PREPARING_STUDENT_DATA_HIDDEN",
        };
      let semesterClassRowsPromise = null;
      const getSemesterClassRows = () => {
        if (!semesterClassRowsPromise)
          semesterClassRowsPromise = transaction.query(
            archiveEnrollment.SEMESTER_CLASS_COLLECTION,
            {
              field: "semesterId",
              operator: "==",
              value: query.semesterId,
            },
          );
        return semesterClassRowsPromise;
      };
      const suppressArchiveStudentState =
        query.audience === "teacher" &&
        ["LEARNING", "ATTENDANCE", "DASHBOARD"].includes(query.domain) &&
        lifecycleProvenance === "ARCHIVE" &&
        !isAdmin &&
        !delegatedLessonRead &&
        !(await getSemesterClassRows()).some(
          (row) =>
            row.data?.status === "ACTIVE" &&
            row.data?.homeroomTeacherUid === uid,
        );
      const selectedUid = query.audience === "student" ? uid : query.studentUid;
      let enrollment = null;
      let enrollmentRows = [];
      if (
        !suppressArchiveStudentState &&
        (query.audience === "student" ||
          query.domain === "LEARNING" ||
          query.domain === "ATTENDANCE" ||
          query.domain === "DASHBOARD")
      ) {
        enrollmentRows = await transaction.query(
          archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION,
          query.audience === "student"
            ? { field: "studentUid", operator: "==", value: uid }
            : { field: "semesterId", operator: "==", value: query.semesterId },
        );
        const own = enrollmentRows.find(
          (row) =>
            row.data?.semesterId === query.semesterId &&
            row.data?.studentUid === uid &&
            row.data?.enrollmentStatus === "ACTIVE",
        );
        if (own)
          enrollment = {
            enrollmentId: own.data.enrollmentId,
            classId: own.data.classId,
            studentUid: uid,
            status: own.data.enrollmentStatus,
          };
      }
      let contents = [];
      let progress = [];
      let exemptions = [];
      let exemptionRequests = [];
      let events = [];
      let sessions = [];
      let records = [];
      let notices = [];
      let deliveries = [];
      let acknowledgements = [];
      let notificationConfig = null;
      let thinkCloudState = {
        activeSessionId: "",
        activeSessionIds: [],
        revision: 0,
        exists: false,
      };
      let thinkCloudSessions = [];
      let thinkCloudResponses = [];
      let thinkCloudRoster = [];
      let thinkCloudManagedClasses = [];
      const currentIso = now();
      const activeWindow = (row, fromKey, untilKey) =>
        (!row[fromKey] || row[fromKey] <= currentIso) &&
        (!row[untilKey] || row[untilKey] >= currentIso);
      const loadLearning = async () => {
        contents = query.contentId
          ? [
              await transaction.get(
                path(LEARNING_CONTENT_COLLECTION, query.contentId),
              ),
            ]
              .filter((row) => row.exists)
              .map((row) => row.data)
          : (
              await transaction.query(LEARNING_CONTENT_COLLECTION, {
                field: "semesterId",
                operator: "==",
                value: query.semesterId,
              })
            ).map((row) => row.data);
        if (!suppressArchiveStudentState && selectedUid) {
          progress = (
            await transaction.query(LEARNING_PROGRESS_COLLECTION, {
              field: "studentUid",
              operator: "==",
              value: selectedUid,
            })
          )
            .map((row) => row.data)
            .filter((row) => row.semesterId === query.semesterId);
          exemptions = (
            await transaction.query(LEARNING_EXEMPTION_COLLECTION, {
              field: "studentUid",
              operator: "==",
              value: selectedUid,
            })
          )
            .map((row) => row.data)
            .filter((row) => row.semesterId === query.semesterId);
          exemptionRequests = (
            await transaction.query(LEARNING_EXEMPTION_REQUEST_COLLECTION, {
              field: "studentUid",
              operator: "==",
              value: selectedUid,
            })
          )
            .map((row) => row.data)
            .filter((row) => row.semesterId === query.semesterId);
        } else if (
          !suppressArchiveStudentState &&
          query.audience === "teacher"
        ) {
          progress = (
            await transaction.query(LEARNING_PROGRESS_COLLECTION, {
              field: "semesterId",
              operator: "==",
              value: query.semesterId,
            })
          ).map((row) => row.data);
          exemptions = (
            await transaction.query(LEARNING_EXEMPTION_COLLECTION, {
              field: "semesterId",
              operator: "==",
              value: query.semesterId,
            })
          ).map((row) => row.data);
          exemptionRequests = (
            await transaction.query(LEARNING_EXEMPTION_REQUEST_COLLECTION, {
              field: "semesterId",
              operator: "==",
              value: query.semesterId,
            })
          ).map((row) => row.data);
        }
        if (query.audience === "student") {
          contents = contents.filter(
            (row) =>
              row.semesterId === query.semesterId &&
              row.status === "PUBLISHED" &&
              row.audienceRoles?.includes("student") &&
              activeWindow(row, "availableFrom", "availableUntil") &&
              (!(row.targetClassIds || []).length ||
                row.targetClassIds.includes(enrollment?.classId)),
          );
        }
        if (query.classId)
          contents = contents.filter(
            (row) =>
              !(row.targetClassIds || []).length ||
              row.targetClassIds.includes(query.classId),
          );
      };
      const loadThinkCloud = async () => {
        if (suppressArchiveStudentState) return;
        const [classRows, sessionRows] = await Promise.all([
          getSemesterClassRows(),
          transaction.query(thinkCloudSessionsPath(query.semesterId)),
        ]);
        const activeClasses = classRows.filter(
          (row) => row.data?.status === "ACTIVE",
        );
        let allowedClasses = [];
        if (query.audience === "student") {
          const ownClass = activeClasses.find(
            (row) => row.data?.classId === enrollment?.classId,
          );
          if (!enrollment || !ownClass)
            fail(
              "permission-denied",
              "Active student enrollment is required.",
              "W8_THINK_CLOUD_TARGET_FORBIDDEN",
            );
          allowedClasses = [ownClass];
        } else if (isAdmin || delegatedLessonRead) {
          allowedClasses = activeClasses;
        } else {
          allowedClasses = activeClasses.filter(
            (row) => row.data?.homeroomTeacherUid === uid,
          );
          if (!allowedClasses.length)
            fail(
              "permission-denied",
              "An assigned class is required for Think Cloud.",
              "W8_THINK_CLOUD_TARGET_FORBIDDEN",
            );
        }
        thinkCloudManagedClasses = allowedClasses
          .map((row) => ({
            classId: String(
              row.data?.classId || row.path.split("/").at(-1) || "",
            ),
            grade: String(row.data?.grade || "").trim(),
            classNumber: String(row.data?.classNumber || "").trim(),
            displayName: String(row.data?.displayName || "").trim(),
          }))
          .filter((row) => row.classId && row.grade && row.classNumber);
        const classStateRows = await transaction.getAll(
          thinkCloudManagedClasses.map((row) =>
            thinkCloudStatePath(query.semesterId, row.classId),
          ),
        );
        thinkCloudManagedClasses = thinkCloudManagedClasses.map(
          (row, index) => {
            const state = classStateRows[index];
            const legacyActive = sessionRows.find(
              (session) =>
                session.data?.status === "active" &&
                String(session.data?.targetGrade || "").trim() === row.grade &&
                String(session.data?.targetClass || "").trim() ===
                  row.classNumber,
            );
            return {
              ...row,
              stateExists: state.exists,
              stateRevision: Number(state.data?.revision || 0),
              activeSessionId: String(
                state.data?.activeSessionId ||
                  legacyActive?.data?.sessionId ||
                  legacyActive?.path.split("/").at(-1) ||
                  "",
              ).trim(),
            };
          },
        );
        const allowedTargets = new Set(
          thinkCloudManagedClasses.map(
            (row) => `${row.grade}::${row.classNumber}`,
          ),
        );
        thinkCloudSessions = sessionRows
          .map((row) => {
            const id = String(
              row.data?.sessionId || row.path.split("/").at(-1) || "",
            );
            const targetGrade = String(row.data?.targetGrade || "").trim();
            const targetClass = String(row.data?.targetClass || "").trim();
            const managedClass = thinkCloudManagedClasses.find(
              (item) =>
                item.grade === targetGrade && item.classNumber === targetClass,
            );
            return {
              ...row.data,
              id,
              stateExists: managedClass?.stateExists === true,
              stateRevision: Number(managedClass?.stateRevision || 0),
            };
          })
          .filter(
            (row) =>
              row.id &&
              allowedTargets.has(
                `${String(row.targetGrade || "").trim()}::${String(row.targetClass || "").trim()}`,
              ),
          );
        const activeSessionIds = thinkCloudManagedClasses
          .map((row) => row.activeSessionId)
          .filter((id) =>
            thinkCloudSessions.some((session) => session.id === id),
          );
        const selectedForState = query.sessionId
          ? thinkCloudSessions.find((row) => row.id === query.sessionId)
          : null;
        const selectedManagedClass = selectedForState
          ? thinkCloudManagedClasses.find(
              (row) =>
                row.grade ===
                  String(selectedForState.targetGrade || "").trim() &&
                row.classNumber ===
                  String(selectedForState.targetClass || "").trim(),
            )
          : thinkCloudManagedClasses[0];
        thinkCloudState = {
          activeSessionId: activeSessionIds[0] || "",
          activeSessionIds,
          revision: Number(selectedManagedClass?.stateRevision || 0),
          exists: selectedManagedClass?.stateExists === true,
        };
        if (!query.sessionId) return;
        const selectedSession = thinkCloudSessions.find(
          (row) => row.id === query.sessionId,
        );
        if (!selectedSession)
          fail(
            "permission-denied",
            "Think Cloud session is outside the assigned class.",
            "W8_THINK_CLOUD_TARGET_FORBIDDEN",
          );
        const responseRows = await transaction.query(
          thinkCloudResponsesPath(query.semesterId, query.sessionId),
        );
        const anonymousStudent =
          query.audience === "student" &&
          selectedSession.options?.anonymous === true;
        thinkCloudResponses = responseRows.map((row) => {
          const id = row.path.split("/").at(-1);
          if (query.audience !== "student") return { ...row.data, id };
          return {
            id,
            ...(!anonymousStudent
              ? { displayName: String(row.data?.displayName || "학생") }
              : {}),
            textRaw: String(row.data?.textRaw || ""),
            textNormalized: String(row.data?.textNormalized || ""),
            createdAt: row.data?.createdAt || null,
            revision: Number(row.data?.revision || 0),
            isOwn: row.data?.uid === uid,
          };
        });
        if (query.audience === "teacher") {
          const selectedClass = thinkCloudManagedClasses.find(
            (row) =>
              row.grade === String(selectedSession.targetGrade || "").trim() &&
              row.classNumber ===
                String(selectedSession.targetClass || "").trim(),
          );
          thinkCloudRoster = selectedClass
            ? enrollmentRows
                .filter(
                  (row) =>
                    row.data?.enrollmentStatus === "ACTIVE" &&
                    row.data?.classId === selectedClass.classId,
                )
                .map((row) => ({
                  uid: String(row.data?.studentUid || ""),
                  name: String(row.data?.snapshot?.displayName || "학생"),
                  number: String(
                    row.data?.studentNumber ||
                      row.data?.snapshot?.studentNumber ||
                      "",
                  ),
                }))
                .filter((row) => row.uid)
            : [];
        }
      };
      const loadSchedule = async () => {
        events = query.eventId
          ? [
              await transaction.get(
                path(SCHEDULE_EVENT_COLLECTION, query.eventId),
              ),
            ]
              .filter((row) => row.exists)
              .map((row) => row.data)
          : (
              await transaction.query(SCHEDULE_EVENT_COLLECTION, {
                field: "semesterId",
                operator: "==",
                value: query.semesterId,
              })
            ).map((row) => row.data);
        const [year, term] = query.semesterId.split("-");
        const holidays = await transaction.query(
          `years/${year}/semesters/${term}/calendar`,
          { field: "eventType", operator: "==", value: "holiday" },
        );
        events.push(
          ...holidays.map((row) => ({
            ...baseDocument(query.semesterId),
            eventId: row.path.split("/").at(-1),
            revision: 1,
            status: "ACTIVE",
            eventType: "HOLIDAY",
            title: row.data?.title || "공휴일",
            description: row.data?.description || "",
            startAt: `${row.data?.start || ""}T00:00:00.000Z`,
            endAt: `${row.data?.end || row.data?.start || ""}T23:59:59.999Z`,
            allDay: true,
            period: "",
            targetClassIds: [],
            targetUserIds: [],
            sourceDomain: "HOLIDAY",
            sourceReference: row.path,
            managedBy: row.data?.managedBy || "commandGateway",
          })),
        );
        if (query.audience === "student")
          events = events.filter(
            (row) =>
              row.status === "ACTIVE" &&
              (!(row.targetClassIds || []).length ||
                row.targetClassIds.includes(enrollment?.classId)) &&
              (!(row.targetUserIds || []).length ||
                row.targetUserIds.includes(uid)),
          );
        if (query.classId)
          events = events.filter(
            (row) =>
              !(row.targetClassIds || []).length ||
              row.targetClassIds.includes(query.classId),
          );
      };
      const loadAttendance = async () => {
        if (suppressArchiveStudentState) return;
        sessions = query.sessionId
          ? [
              await transaction.get(
                path(ATTENDANCE_SESSION_COLLECTION, query.sessionId),
              ),
            ]
              .filter((row) => row.exists)
              .map((row) => row.data)
          : (
              await transaction.query(ATTENDANCE_SESSION_COLLECTION, {
                field: "semesterId",
                operator: "==",
                value: query.semesterId,
              })
            ).map((row) => row.data);
        if (query.audience === "student") {
          sessions = sessions.filter(
            (row) => row.classId === enrollment?.classId,
          );
          records = (
            await transaction.query(ATTENDANCE_RECORD_COLLECTION, {
              field: "studentUid",
              operator: "==",
              value: uid,
            })
          )
            .map((row) => row.data)
            .filter((row) => row.semesterId === query.semesterId);
        } else if (query.sessionId) {
          records = (
            await transaction.query(ATTENDANCE_RECORD_COLLECTION, {
              field: "sessionId",
              operator: "==",
              value: query.sessionId,
            })
          ).map((row) => row.data);
        } else if (selectedUid) {
          records = (
            await transaction.query(ATTENDANCE_RECORD_COLLECTION, {
              field: "studentUid",
              operator: "==",
              value: selectedUid,
            })
          )
            .map((row) => row.data)
            .filter((row) => row.semesterId === query.semesterId);
        } else {
          records = (
            await transaction.query(ATTENDANCE_RECORD_COLLECTION, {
              field: "semesterId",
              operator: "==",
              value: query.semesterId,
            })
          ).map((row) => row.data);
        }
        if (query.classId) {
          sessions = sessions.filter((row) => row.classId === query.classId);
          records = records.filter((row) => row.classId === query.classId);
        }
        if (
          query.audience === "teacher" &&
          query.sessionId &&
          sessions.length === 1
        ) {
          const realUids = new Set(records.map((row) => row.studentUid));
          records.push(
            ...enrollmentRows
              .filter(
                (row) =>
                  row.data?.enrollmentStatus === "ACTIVE" &&
                  row.data?.classId === sessions[0].classId &&
                  !realUids.has(row.data?.studentUid),
              )
              .map((row) => ({
                ...baseDocument(query.semesterId),
                recordId: null,
                sessionId: sessions[0].sessionId,
                studentUid: row.data.studentUid,
                studentName: row.data.snapshot?.displayName || "학생",
                studentNumber:
                  row.data.studentNumber ||
                  row.data.snapshot?.studentNumber ||
                  "",
                enrollmentId: row.data.enrollmentId,
                classId: row.data.classId,
                attendanceStatus: "UNRECORDED",
                reason: "",
                revision: 0,
                placeholder: true,
              })),
          );
        }
      };
      const loadCommunication = async () => {
        notificationConfig = await transaction.get(NOTIFICATION_CONFIG_PATH);
        if (query.audience === "student") {
          deliveries = (
            await transaction.query(NOTICE_DELIVERY_COLLECTION, {
              field: "recipientUid",
              operator: "==",
              value: uid,
            })
          )
            .map((row) => row.data)
            .filter((row) => row.semesterId === query.semesterId);
          acknowledgements = (
            await transaction.query(NOTICE_ACK_COLLECTION, {
              field: "studentUid",
              operator: "==",
              value: uid,
            })
          )
            .map((row) => row.data)
            .filter((row) => row.semesterId === query.semesterId);
          const noticeIds = [...new Set(deliveries.map((row) => row.noticeId))];
          notices = (
            await transaction.getAll(
              noticeIds.map((id) => path(NOTICE_COLLECTION, id)),
            )
          )
            .filter((row) => row.exists)
            .map((row) => row.data)
            .filter(
              (row) =>
                row.semesterId === query.semesterId &&
                ["PUBLISHED", "SCHEDULED"].includes(row.status) &&
                activeWindow(row, "publishAt", "expireAt"),
            );
        } else {
          notices = query.noticeId
            ? [await transaction.get(path(NOTICE_COLLECTION, query.noticeId))]
                .filter((row) => row.exists)
                .map((row) => row.data)
            : (
                await transaction.query(NOTICE_COLLECTION, {
                  field: "semesterId",
                  operator: "==",
                  value: query.semesterId,
                })
              ).map((row) => row.data);
          deliveries = (
            await transaction.query(NOTICE_DELIVERY_COLLECTION, {
              field: "recipientUid",
              operator: "==",
              value: uid,
            })
          )
            .map((row) => row.data)
            .filter((row) => row.semesterId === query.semesterId);
          acknowledgements =
            !suppressArchiveStudentState && selectedUid
              ? (
                  await transaction.query(NOTICE_ACK_COLLECTION, {
                    field: "studentUid",
                    operator: "==",
                    value: selectedUid,
                  })
                )
                  .map((row) => row.data)
                  .filter((row) => row.semesterId === query.semesterId)
              : [];
        }
        if (query.classId)
          notices = notices.filter(
            (row) =>
              !(row.targetClassIds || []).length ||
              row.targetClassIds.includes(query.classId),
          );
      };
      // The historical dashboard keeps schedule/attendance/communication data,
      // but academic material is available only through the administrator archive.
      if (["LEARNING", "DASHBOARD"].includes(query.domain) && lifecycleProvenance !== "ARCHIVE")
        await loadLearning();
      if (query.domain === "LEARNING") await loadThinkCloud();
      if (["SCHEDULE", "DASHBOARD"].includes(query.domain))
        await loadSchedule();
      if (["ATTENDANCE", "DASHBOARD"].includes(query.domain))
        await loadAttendance();
      if (["COMMUNICATION", "DASHBOARD"].includes(query.domain))
        await loadCommunication();
      const expose = (rows) =>
        rows.map((row) => {
          const projected = {
            ...row,
            provenance,
            readOnly: readOnly || row.placeholder === true,
          };
          if (query.audience === "student") {
            [
              "targetUserIds",
              "createdBy",
              "updatedBy",
              "openedBy",
              "closedBy",
              "recordedBy",
              "correctedBy",
              "reviewedBy",
              "grantedBy",
              "revokedBy",
              "commandId",
              "receiptId",
              "sourceHash",
              "payloadHash",
              "dedupeKey",
            ].forEach((key) => delete projected[key]);
          }
          return projected;
        });
      const today = kstDateKey(currentIso);
      const dashboard = {
        todaySchedule: expose(
          events.filter((row) => kstDateKey(row.startAt) === today),
        ),
        upcomingLearning: expose(
          contents
            .filter(
              (row) =>
                !progress.some(
                  (item) =>
                    item.contentId === row.contentId &&
                    item.status === "COMPLETED",
                ),
            )
            .slice(0, 5),
        ),
        attendancePendingCount:
          query.audience === "teacher"
            ? records.filter((row) => row.attendanceStatus === "UNRECORDED")
                .length
            : 0,
        importantNotices: expose(
          notices.filter((row) => row.priority === "HIGH").slice(0, 5),
        ),
      };
      const hasContent =
        contents.length +
          progress.length +
          events.length +
          sessions.length +
          records.length +
          notices.length +
          deliveries.length +
          thinkCloudSessions.length >
        0;
      return {
        ...base,
        manifestRevision: Number(manifest.data?.revision || 0),
        provenance,
        source: query.source,
        readOnly,
        status:
          readOnly && provenance === "ARCHIVE"
            ? "ARCHIVED"
            : hasContent
              ? "CONTENT"
              : "EMPTY",
        enrollment,
        enrollmentId: enrollment?.enrollmentId || null,
        contents: expose(contents),
        progress: expose(progress),
        exemptions: expose(exemptions),
        exemptionRequests: expose(exemptionRequests),
        events: expose(events),
        sessions: expose(sessions),
        records: expose(records),
        notices: expose(notices),
        deliveries: expose(deliveries),
        acknowledgements: expose(acknowledgements),
        notificationConfig: notificationConfig?.exists
          ? {
              ...notificationConfig.data,
              readOnly: query.audience === "student" || readOnly,
            }
          : null,
        thinkCloudState,
        thinkCloudSessions: expose(thinkCloudSessions),
        thinkCloudResponses: expose(thinkCloudResponses),
        thinkCloudRoster,
        thinkCloudManagedClasses,
        dashboard,
        reason: "",
        writeCount: 0,
      };
    });
  };
  return { getW8DomainState };
};
const createW8CallableExports = ({ core }) => ({
  getW8DomainState: onCall({ region: REGION }, (request) =>
    core.getW8DomainState(request),
  ),
});

const createW8ReadinessAdapter = () => ({
  evaluate: async ({ transaction, manifest }) => {
    const scope = String(manifest?.semesterId || "");
    const contents = await transaction.query(LEARNING_CONTENT_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: scope,
    });
    const progress = await transaction.query(LEARNING_PROGRESS_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: scope,
    });
    const exemptions = await transaction.query(LEARNING_EXEMPTION_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: scope,
    });
    const exemptionRequests = await transaction.query(
      LEARNING_EXEMPTION_REQUEST_COLLECTION,
      { field: "semesterId", operator: "==", value: scope },
    );
    const events = await transaction.query(SCHEDULE_EVENT_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: scope,
    });
    const sessions = await transaction.query(ATTENDANCE_SESSION_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: scope,
    });
    const records = await transaction.query(ATTENDANCE_RECORD_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: scope,
    });
    const revisions = await transaction.query(ATTENDANCE_REVISION_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: scope,
    });
    const notices = await transaction.query(NOTICE_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: scope,
    });
    const deliveries = await transaction.query(NOTICE_DELIVERY_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: scope,
    });
    const acknowledgements = await transaction.query(NOTICE_ACK_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: scope,
    });
    const issues = await transaction.query(W8_LEGACY_ISSUE_COLLECTION, {
      field: "semesterId",
      operator: "==",
      value: scope,
    });
    const classes = await transaction.query(
      archiveEnrollment.SEMESTER_CLASS_COLLECTION,
      { field: "semesterId", operator: "==", value: scope },
    );
    const enrollments = await transaction.query(
      archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION,
      { field: "semesterId", operator: "==", value: scope },
    );
    const classIds = new Set(
      classes
        .filter((row) => row.data?.status === "ACTIVE")
        .map((row) => row.data?.classId),
    );
    const enrollmentById = new Map(
      enrollments.map((row) => [row.data?.enrollmentId, row.data]),
    );
    const activeStudentUids = new Set(
      enrollments
        .filter((row) => row.data?.enrollmentStatus === "ACTIVE")
        .map((row) => row.data?.studentUid),
    );
    const blockingIssues = issues.filter(
      (row) => !["RESOLVED", "DISMISSED"].includes(row.data?.status),
    );
    const schemaInvalid = (rows) =>
      rows.filter(
        (row) =>
          row.data?.schemaVersion !== W8_SCHEMA_VERSION ||
          row.data?.policyVersion !== W8_POLICY_VERSION ||
          row.data?.semesterId !== scope,
      ).length;
    let learningInvalid =
      schemaInvalid([
        ...contents,
        ...progress,
        ...exemptions,
        ...exemptionRequests,
      ]) +
      contents.filter(
        (row) =>
          (row.data?.targetClassIds || []).some((id) => !classIds.has(id)) ||
          (row.data?.availableFrom &&
            row.data?.availableUntil &&
            row.data.availableFrom > row.data.availableUntil),
      ).length +
      progress.filter((row) => {
        const enrollment = enrollmentById.get(row.data?.enrollmentId);
        return (
          !enrollment ||
          enrollment.studentUid !== row.data?.studentUid ||
          !["NOT_STARTED", "IN_PROGRESS", "COMPLETED"].includes(
            row.data?.status,
          )
        );
      }).length;
    const sourceKeys = new Set();
    let scheduleInvalid =
      schemaInvalid(events) +
      events.filter(
        (row) =>
          row.data?.startAt > row.data?.endAt ||
          (row.data?.targetClassIds || []).some((id) => !classIds.has(id)) ||
          (row.data?.targetUserIds || []).some(
            (uid) => !activeStudentUids.has(uid),
          ) ||
          !["USER", "LEARNING", "ASSESSMENT", "NOTICE", "TIMETABLE"].includes(
            row.data?.sourceDomain,
          ),
      ).length;
    for (const row of events) {
      if (!row.data?.sourceReference || row.data?.status === "ARCHIVED")
        continue;
      const key = row.data.sourceReference;
      if (sourceKeys.has(key)) scheduleInvalid += 1;
      sourceKeys.add(key);
    }
    const sessionKeys = new Set();
    let attendanceInvalid = schemaInvalid([
      ...sessions,
      ...records,
      ...revisions,
    ]);
    for (const row of sessions) {
      const key = `${row.data?.classId}:${row.data?.date}:${row.data?.period}`;
      if (!classIds.has(row.data?.classId) || sessionKeys.has(key))
        attendanceInvalid += 1;
      sessionKeys.add(key);
    }
    const sessionIds = new Set(sessions.map((row) => row.data?.sessionId));
    const recordKeys = new Set();
    for (const row of records) {
      const enrollment = enrollmentById.get(row.data?.enrollmentId);
      const key = `${row.data?.sessionId}:${row.data?.studentUid}`;
      if (
        !sessionIds.has(row.data?.sessionId) ||
        !enrollment ||
        enrollment.studentUid !== row.data?.studentUid ||
        recordKeys.has(key) ||
        !["PRESENT", "LATE", "ABSENT", "EARLY_LEAVE", "EXCUSED"].includes(
          row.data?.attendanceStatus,
        )
      )
        attendanceInvalid += 1;
      recordKeys.add(key);
    }
    const noticeIds = new Set(notices.map((row) => row.data?.noticeId));
    const deliveryKeys = new Set();
    let communicationInvalid =
      schemaInvalid([...notices, ...deliveries, ...acknowledgements]) +
      notices.filter(
        (row) =>
          (row.data?.targetClassIds || []).some((id) => !classIds.has(id)) ||
          (row.data?.targetUserIds || []).some(
            (uid) => !activeStudentUids.has(uid),
          ) ||
          (row.data?.publishAt &&
            row.data?.expireAt &&
            row.data.publishAt > row.data.expireAt) ||
          !Array.isArray(row.data?.targetRoles) ||
          row.data.targetRoles.length !== 1 ||
          row.data.targetRoles[0] !== "student" ||
          (["PUBLISHED", "SCHEDULED"].includes(row.data?.status) &&
            !deliveries.some(
              (delivery) => delivery.data?.noticeId === row.data?.noticeId,
            )),
      ).length;
    for (const row of deliveries) {
      const key = `${row.data?.noticeId}:${row.data?.recipientUid}`;
      if (
        !noticeIds.has(row.data?.noticeId) ||
        !activeStudentUids.has(row.data?.recipientUid) ||
        deliveryKeys.has(key)
      )
        communicationInvalid += 1;
      deliveryKeys.add(key);
    }
    communicationInvalid += acknowledgements.filter(
      (row) =>
        !noticeIds.has(row.data?.noticeId) ||
        !activeStudentUids.has(row.data?.studentUid),
    ).length;
    learningInvalid += blockingIssues.filter((row) =>
      ["LEARNING", "ALL"].includes(row.data?.domain),
    ).length;
    scheduleInvalid += blockingIssues.filter((row) =>
      ["SCHEDULE", "ALL"].includes(row.data?.domain),
    ).length;
    attendanceInvalid += blockingIssues.filter((row) =>
      ["ATTENDANCE", "ALL"].includes(row.data?.domain),
    ).length;
    communicationInvalid += blockingIssues.filter((row) =>
      ["COMMUNICATION", "ALL"].includes(row.data?.domain),
    ).length;
    const evidence = (name, count, rows) =>
      `applicability=${rows.length ? "APPLICABLE" : "NOT_APPLICABLE"}; ${name}=${rows.length}; invalid=${count}; dependency=${sha256(canonicalJson(rows.map((row) => row.data)))}`;
    return [
      {
        checkId: "learning_domain_readiness",
        label: "Learning domain readiness",
        category: "LEARNING",
        required: true,
        status: learningInvalid ? "FAIL" : "PASS",
        evidence: evidence("documents", learningInvalid, [
          ...contents,
          ...progress,
          ...exemptions,
          ...exemptionRequests,
        ]),
        failureReason: learningInvalid
          ? "LEARNING_DOMAIN_READINESS_NOT_PASS"
          : null,
        ownerWave: "W8",
      },
      {
        checkId: "schedule_domain_readiness",
        label: "Schedule domain readiness",
        category: "SCHEDULE",
        required: true,
        status: scheduleInvalid ? "FAIL" : "PASS",
        evidence: evidence("events", scheduleInvalid, events),
        failureReason: scheduleInvalid
          ? "SCHEDULE_DOMAIN_READINESS_NOT_PASS"
          : null,
        ownerWave: "W8",
      },
      {
        checkId: "attendance_domain_readiness",
        label: "Attendance domain readiness",
        category: "ATTENDANCE",
        required: true,
        status: attendanceInvalid ? "FAIL" : "PASS",
        evidence: evidence("documents", attendanceInvalid, [
          ...sessions,
          ...records,
          ...revisions,
        ]),
        failureReason: attendanceInvalid
          ? "ATTENDANCE_DOMAIN_READINESS_NOT_PASS"
          : null,
        ownerWave: "W8",
      },
      {
        checkId: "communication_domain_readiness",
        label: "Communication domain readiness",
        category: "COMMUNICATION",
        required: true,
        status: communicationInvalid ? "FAIL" : "PASS",
        evidence: evidence("documents", communicationInvalid, [
          ...notices,
          ...deliveries,
          ...acknowledgements,
        ]),
        failureReason: communicationInvalid
          ? "COMMUNICATION_DOMAIN_READINESS_NOT_PASS"
          : null,
        ownerWave: "W8",
      },
    ];
  },
});

const getW8CommandSessionOptions = (commandType) => ({
  recentAuth: HIGH_RISK_COMMAND_TYPES.has(commandType),
  highRisk: HIGH_RISK_COMMAND_TYPES.has(commandType),
});

module.exports = {
  ADMIN_COMMAND_TYPES,
  ATTENDANCE_RECORD_COLLECTION,
  ATTENDANCE_REVISION_COLLECTION,
  ATTENDANCE_SESSION_COLLECTION,
  HIGH_RISK_COMMAND_TYPES,
  LEARNING_CONTENT_COLLECTION,
  LEARNING_EXEMPTION_COLLECTION,
  LEARNING_EXEMPTION_REQUEST_COLLECTION,
  LEARNING_PROGRESS_COLLECTION,
  NOTICE_ACK_COLLECTION,
  NOTICE_COLLECTION,
  NOTICE_DELIVERY_COLLECTION,
  NOTIFICATION_CONFIG_PATH,
  SCHEDULE_EVENT_COLLECTION,
  STUDENT_COMMAND_TYPES,
  THINK_CLOUD_RESPONSE_LIMIT,
  W8_COMMAND_TYPES,
  W8_LEGACY_ISSUE_COLLECTION,
  W8_POLICY_VERSION,
  W8_READINESS_CHECK_IDS,
  W8_SCHEMA_VERSION,
  acknowledgementIdFor,
  attendanceRecordIdFor,
  attendanceSessionIdFor,
  createW8CallableExports,
  createW8CommandAdapter,
  createW8QueryCore,
  createW8ReadinessAdapter,
  deliveryIdFor,
  exemptionIdFor,
  getW8CommandSessionOptions,
  normalizeW8Payload,
  progressIdFor,
};
