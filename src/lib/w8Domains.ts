import type { SystemConfig } from "../types";
import {
  executeWestoryCommand,
  type W2CommandPayloads,
} from "./commandGateway";
import { getHttpsCallable } from "./firebase";
import { getYearSemester } from "./semesterScope";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;
type JsonRecord = Record<string, unknown>;

export type W8Domain =
  | "LEARNING"
  | "SCHEDULE"
  | "ATTENDANCE"
  | "COMMUNICATION"
  | "DASHBOARD";
export type W8Audience = "student" | "teacher";
export type W8Source = "CURRENT" | "ARCHIVE" | "LEGACY" | "EXPLICIT";
export type W8Provenance =
  | "CURRENT"
  | "PREPARING"
  | "ARCHIVE"
  | "LEGACY"
  | "EXPLICIT";

export type LearningContentStatus =
  | "DRAFT"
  | "READY"
  | "SCHEDULED"
  | "PUBLISHED"
  | "CLOSED"
  | "ARCHIVED";
export type LearningProgressStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PAUSED"
  | "ARCHIVED";
export type AttendanceStatus =
  | "UNRECORDED"
  | "PRESENT"
  | "LATE"
  | "ABSENT"
  | "EARLY_LEAVE"
  | "EXCUSED";
export type NoticeStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "PUBLISHED"
  | "EXPIRED"
  | "ARCHIVED";

export interface W8LearningContent {
  contentId: string;
  semesterId: string;
  contentType: string;
  title: string;
  summary: string;
  body: string;
  resourceUrl: string;
  status: LearningContentStatus;
  revision: number;
  schemaVersion: number;
  provenance: W8Provenance;
  classIds: string[];
  availableFrom: string;
  availableUntil: string;
  publishedAt: string;
}

export interface W8LearningProgress {
  progressId: string;
  contentId: string;
  studentUid: string;
  enrollmentId: string;
  status: LearningProgressStatus;
  revision: number;
  completedAt: string;
  updatedAt: string;
}

export interface W8LearningExemptionRequest {
  requestId: string;
  contentId: string;
  studentUid: string;
  enrollmentId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason: string;
  reviewReason: string;
  revision: number;
  requestedAt: string;
  reviewedAt: string;
}

export interface W8LearningExemption {
  exemptionId: string;
  contentId: string;
  studentUid: string;
  enrollmentId: string;
  status: "ACTIVE" | "REVOKED";
  reason: string;
  revision: number;
}

export interface W8ScheduleEvent {
  eventId: string;
  semesterId: string;
  eventType: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  period: string;
  status: string;
  sourceDomain: string;
  sourceReference: string;
  classIds: string[];
  targetUserIds: string[];
  revision: number;
  provenance: W8Provenance;
}

export interface W8AttendanceSession {
  sessionId: string;
  semesterId: string;
  classId: string;
  className: string;
  date: string;
  period: string;
  status: "OPEN" | "CLOSED" | "ARCHIVED";
  revision: number;
  scheduleEventId: string;
}

export interface W8AttendanceRecord {
  recordId: string;
  sessionId: string;
  studentUid: string;
  studentName: string;
  enrollmentId: string;
  attendanceStatus: AttendanceStatus;
  reason: string;
  revision: number;
  corrected: boolean;
  recordedAt: string;
  correctedAt: string;
}

export interface W8AttendanceRevision {
  revisionId: string;
  recordId: string;
  previousStatus: AttendanceStatus;
  nextStatus: AttendanceStatus;
  reason: string;
  correctedAt: string;
}

export interface W8Notice {
  noticeId: string;
  semesterId: string;
  title: string;
  content: string;
  status: NoticeStatus;
  priority: "NORMAL" | "HIGH";
  revision: number;
  provenance: W8Provenance;
  classIds: string[];
  targetUserIds: string[];
  targetRoles: string[];
  publishAt: string;
  expireAt: string;
  acknowledged: boolean;
  acknowledgedAt: string;
}

export interface W8NoticeDelivery {
  deliveryId: string;
  noticeId: string;
  recipientUid: string;
  targetUrl: string;
  status: string;
  createdAt: string;
}

export interface W8NoticeAcknowledgement {
  acknowledgementId: string;
  noticeId: string;
  studentUid: string;
  acknowledgedAt: string;
}

export interface W8DashboardSummary {
  todaySchedule: W8ScheduleEvent[];
  upcomingLearning: W8LearningContent[];
  attendancePendingCount: number;
  importantNotices: W8Notice[];
}

export interface W8DomainState {
  domain: W8Domain;
  audience: W8Audience;
  semesterId: string;
  manifestRevision: number;
  provenance: W8Provenance;
  source: W8Source;
  readOnly: boolean;
  status: "CONTENT" | "EMPTY" | "LEGACY" | "ARCHIVED" | "PREPARING";
  reason: string;
  enrollmentId: string;
  learningContents: W8LearningContent[];
  learningProgress: W8LearningProgress[];
  exemptions: W8LearningExemption[];
  exemptionRequests: W8LearningExemptionRequest[];
  scheduleEvents: W8ScheduleEvent[];
  attendanceSessions: W8AttendanceSession[];
  attendanceRecords: W8AttendanceRecord[];
  attendanceRevisions: W8AttendanceRevision[];
  notices: W8Notice[];
  deliveries: W8NoticeDelivery[];
  acknowledgements: W8NoticeAcknowledgement[];
  notificationConfig: JsonRecord;
  writeCount: 0;
  dashboard: W8DashboardSummary;
}

export class W8DomainError extends Error {
  readonly kind:
    | "PERMISSION"
    | "SESSION_EXPIRED"
    | "CONFLICT"
    | "VALIDATION"
    | "NETWORK"
    | "UNKNOWN";

  constructor(kind: W8DomainError["kind"], message: string) {
    super(message);
    this.name = "W8DomainError";
    this.kind = kind;
  }
}

const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
const rows = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const boolean = (value: unknown) => value === true;
const strings = (value: unknown) =>
  Array.isArray(value) ? value.map(text).filter(Boolean) : [];

const normalizeProvenance = (value: unknown): W8Provenance => {
  const normalized = text(value).toUpperCase();
  return ["PREPARING", "ARCHIVE", "LEGACY", "EXPLICIT"].includes(normalized)
    ? (normalized as W8Provenance)
    : "CURRENT";
};

const normalizeLearningContent = (value: unknown): W8LearningContent => {
  const item = record(value);
  return {
    contentId: text(item.contentId) || text(item.id),
    semesterId: text(item.semesterId),
    contentType: text(item.contentType) || "LESSON",
    title: text(item.title) || "제목 없는 학습",
    summary: text(item.summary),
    body: text(item.body) || text(item.content),
    resourceUrl: text(item.resourceUrl),
    status: (text(item.status) || "DRAFT") as LearningContentStatus,
    revision: number(item.revision),
    schemaVersion: number(item.schemaVersion),
    provenance: normalizeProvenance(item.provenance),
    classIds: strings(item.targetClassIds || item.classIds),
    availableFrom: text(item.availableFrom),
    availableUntil: text(item.availableUntil),
    publishedAt: text(item.publishedAt),
  };
};

const normalizeLearningProgress = (value: unknown): W8LearningProgress => {
  const item = record(value);
  return {
    progressId: text(item.progressId) || text(item.id),
    contentId: text(item.contentId),
    studentUid: text(item.studentUid),
    enrollmentId: text(item.enrollmentId),
    status: (text(item.status) || "NOT_STARTED") as LearningProgressStatus,
    revision: number(item.revision),
    completedAt: text(item.completedAt),
    updatedAt: text(item.updatedAt),
  };
};

const normalizeLearningExemptionRequest = (
  value: unknown,
): W8LearningExemptionRequest => {
  const item = record(value);
  return {
    requestId: text(item.requestId) || text(item.id),
    contentId: text(item.contentId),
    studentUid: text(item.studentUid),
    enrollmentId: text(item.enrollmentId),
    status: (text(item.status) ||
      "PENDING") as W8LearningExemptionRequest["status"],
    reason: text(item.reason),
    reviewReason: text(item.reviewReason),
    revision: number(item.revision),
    requestedAt: text(item.requestedAt),
    reviewedAt: text(item.reviewedAt),
  };
};

const normalizeLearningExemption = (value: unknown): W8LearningExemption => {
  const item = record(value);
  return {
    exemptionId: text(item.exemptionId) || text(item.id),
    contentId: text(item.contentId),
    studentUid: text(item.studentUid),
    enrollmentId: text(item.enrollmentId),
    status: (text(item.status) || "ACTIVE") as W8LearningExemption["status"],
    reason: text(item.reason),
    revision: number(item.revision),
  };
};

const normalizeScheduleEvent = (value: unknown): W8ScheduleEvent => {
  const item = record(value);
  return {
    eventId: text(item.eventId) || text(item.id),
    semesterId: text(item.semesterId),
    eventType: text(item.eventType) || "SCHOOL",
    title: text(item.title) || "제목 없는 일정",
    description: text(item.description),
    startAt: text(item.startAt),
    endAt: text(item.endAt),
    allDay: boolean(item.allDay),
    period: text(item.period),
    status: text(item.status) || "ACTIVE",
    sourceDomain: text(item.sourceDomain) || "SCHEDULE",
    sourceReference: text(item.sourceReference),
    classIds: strings(item.targetClassIds || item.classIds),
    targetUserIds: strings(item.targetUserIds),
    revision: number(item.revision),
    provenance: normalizeProvenance(item.provenance),
  };
};

const normalizeAttendanceSession = (value: unknown): W8AttendanceSession => {
  const item = record(value);
  return {
    sessionId: text(item.sessionId) || text(item.id),
    semesterId: text(item.semesterId),
    classId: text(item.classId),
    className: text(item.className),
    date: text(item.date),
    period: text(item.period),
    status: (text(item.status) || "OPEN") as W8AttendanceSession["status"],
    revision: number(item.revision),
    scheduleEventId: text(item.scheduleEventId),
  };
};

const normalizeAttendanceRecord = (value: unknown): W8AttendanceRecord => {
  const item = record(value);
  return {
    recordId: text(item.recordId) || text(item.id),
    sessionId: text(item.sessionId),
    studentUid: text(item.studentUid),
    studentName: text(item.studentName) || text(item.displayName) || "학생",
    enrollmentId: text(item.enrollmentId),
    attendanceStatus: (text(item.attendanceStatus) ||
      "UNRECORDED") as AttendanceStatus,
    reason: text(item.reason),
    revision: number(item.revision),
    corrected: boolean(item.corrected) || number(item.correctionCount) > 0,
    recordedAt: text(item.recordedAt),
    correctedAt: text(item.correctedAt),
  };
};

const normalizeAttendanceRevision = (value: unknown): W8AttendanceRevision => {
  const item = record(value);
  return {
    revisionId: text(item.revisionId) || text(item.id),
    recordId: text(item.recordId),
    previousStatus: (text(item.previousStatus) ||
      "UNRECORDED") as AttendanceStatus,
    nextStatus: (text(item.nextStatus) || "UNRECORDED") as AttendanceStatus,
    reason: text(item.reason),
    correctedAt: text(item.correctedAt),
  };
};

const normalizeNotice = (value: unknown): W8Notice => {
  const item = record(value);
  return {
    noticeId: text(item.noticeId) || text(item.id),
    semesterId: text(item.semesterId),
    title: text(item.title) || "제목 없는 공지",
    content: text(item.content) || text(item.body),
    status: (text(item.status) || "DRAFT") as NoticeStatus,
    priority: (text(item.priority) || "NORMAL") as W8Notice["priority"],
    revision: number(item.revision),
    provenance: normalizeProvenance(item.provenance),
    classIds: strings(item.targetClassIds || item.classIds),
    targetUserIds: strings(item.targetUserIds),
    targetRoles: strings(item.targetRoles),
    publishAt: text(item.publishAt),
    expireAt: text(item.expireAt),
    acknowledged: boolean(item.acknowledged),
    acknowledgedAt: text(item.acknowledgedAt),
  };
};

const normalizeDelivery = (value: unknown): W8NoticeDelivery => {
  const item = record(value);
  return {
    deliveryId: text(item.deliveryId) || text(item.id),
    noticeId: text(item.noticeId),
    recipientUid: text(item.recipientUid),
    targetUrl: text(item.targetUrl),
    status: text(item.status),
    createdAt: text(item.createdAt),
  };
};

const normalizeAcknowledgement = (value: unknown): W8NoticeAcknowledgement => {
  const item = record(value);
  return {
    acknowledgementId: text(item.acknowledgementId) || text(item.id),
    noticeId: text(item.noticeId),
    studentUid: text(item.studentUid),
    acknowledgedAt: text(item.acknowledgedAt),
  };
};

const mapError = (error: unknown) => {
  const raw = record(error);
  const code = text(raw.code).toLowerCase();
  const message = text(raw.message);
  if (code.includes("permission-denied")) {
    return new W8DomainError("PERMISSION", "이 자료를 볼 권한이 없습니다.");
  }
  if (code.includes("unauthenticated")) {
    return new W8DomainError(
      "SESSION_EXPIRED",
      "로그인 상태를 다시 확인해 주세요.",
    );
  }
  if (code.includes("aborted") || code.includes("already-exists")) {
    return new W8DomainError(
      "CONFLICT",
      "다른 변경이 먼저 반영되었습니다. 최신 상태를 다시 불러와 주세요.",
    );
  }
  if (
    code.includes("invalid-argument") ||
    code.includes("failed-precondition")
  ) {
    return new W8DomainError(
      "VALIDATION",
      message || "입력 내용을 다시 확인해 주세요.",
    );
  }
  if (code.includes("unavailable") || code.includes("deadline-exceeded")) {
    return new W8DomainError(
      "NETWORK",
      "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
    );
  }
  return new W8DomainError("UNKNOWN", message || "자료를 처리하지 못했습니다.");
};

export const getCurrentSemesterId = (config: ConfigLike) => {
  const { year, semester } = getYearSemester(config);
  return `${year}-${semester}`;
};

export const getW8DomainState = async (input: {
  config: ConfigLike;
  domain: W8Domain;
  audience: W8Audience;
  semesterId?: string;
  source?: W8Source;
  contentId?: string;
  eventId?: string;
  sessionId?: string;
  noticeId?: string;
  studentUid?: string;
  classId?: string;
}): Promise<W8DomainState> => {
  const currentSemesterId = getCurrentSemesterId(input.config);
  const semesterId = text(input.semesterId) || currentSemesterId;
  if (!/^\d{4}-[12]$/u.test(semesterId)) {
    throw new W8DomainError(
      "VALIDATION",
      "조회할 학기 범위가 올바르지 않습니다.",
    );
  }
  const source =
    input.source === "LEGACY" || input.source === "EXPLICIT"
      ? input.source
      : semesterId !== currentSemesterId
        ? "ARCHIVE"
        : input.source || "CURRENT";

  try {
    const callable = await getHttpsCallable<
      {
        domain: W8Domain;
        audience: W8Audience;
        semesterId: string;
        source: W8Source;
        contentId?: string;
        eventId?: string;
        sessionId?: string;
        noticeId?: string;
        studentUid?: string;
        classId?: string;
      },
      unknown
    >("getW8DomainState");
    const response = await callable({
      domain: input.domain,
      audience: input.audience,
      semesterId,
      source,
      ...(input.contentId ? { contentId: input.contentId } : {}),
      ...(input.eventId ? { eventId: input.eventId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.noticeId ? { noticeId: input.noticeId } : {}),
      ...(input.studentUid ? { studentUid: input.studentUid } : {}),
      ...(input.classId ? { classId: input.classId } : {}),
    });
    const raw = record(response.data);
    const requiredArrayKeys = [
      "contents",
      "progress",
      "exemptions",
      "exemptionRequests",
      "events",
      "sessions",
      "records",
      "notices",
      "deliveries",
      "acknowledgements",
    ] as const;
    const responseContractValid =
      raw.domain === input.domain &&
      raw.audience === input.audience &&
      raw.source === source &&
      typeof raw.readOnly === "boolean" &&
      requiredArrayKeys.every((key) => Array.isArray(raw[key])) &&
      (raw.notificationConfig === null ||
        (typeof raw.notificationConfig === "object" &&
          !Array.isArray(raw.notificationConfig)));
    if (!responseContractValid) {
      throw new W8DomainError(
        "UNKNOWN",
        "W8 자료 응답 형식이 현재 앱 계약과 일치하지 않습니다.",
      );
    }
    if (raw.writeCount !== 0) {
      throw new W8DomainError(
        "UNKNOWN",
        "조회 과정에서 예상하지 않은 변경이 감지되었습니다.",
      );
    }
    const dashboardRaw = record(raw.dashboard);
    const learningContents = rows(raw.contents).map(normalizeLearningContent);
    const scheduleEvents = rows(raw.events).map(normalizeScheduleEvent);
    const acknowledgements = rows(raw.acknowledgements).map(
      normalizeAcknowledgement,
    );
    const acknowledgementByNoticeId = new Map(
      acknowledgements.map((item) => [item.noticeId, item]),
    );
    const notices = rows(raw.notices).map((value) => {
      const notice = normalizeNotice(value);
      const acknowledgement = acknowledgementByNoticeId.get(notice.noticeId);
      return acknowledgement
        ? {
            ...notice,
            acknowledged: true,
            acknowledgedAt: acknowledgement.acknowledgedAt,
          }
        : notice;
    });

    return {
      domain: (text(raw.domain) || input.domain) as W8Domain,
      audience: (text(raw.audience) || input.audience) as W8Audience,
      semesterId: text(raw.semesterId) || semesterId,
      manifestRevision: number(raw.manifestRevision),
      provenance:
        source === "EXPLICIT"
          ? "EXPLICIT"
          : normalizeProvenance(raw.provenance || source),
      source: (text(raw.source) || source) as W8Source,
      readOnly: boolean(raw.readOnly) || source !== "CURRENT",
      status:
        text(raw.status) === "CONTENT"
          ? "CONTENT"
          : text(raw.status) === "ARCHIVED"
            ? "ARCHIVED"
            : text(raw.status) === "PREPARING"
              ? "PREPARING"
              : text(raw.status) === "LEGACY"
                ? "LEGACY"
                : "EMPTY",
      reason: text(raw.reason),
      enrollmentId:
        text(raw.enrollmentId) || text(record(raw.enrollment).enrollmentId),
      learningContents,
      learningProgress: rows(raw.progress).map(normalizeLearningProgress),
      exemptions: rows(raw.exemptions).map(normalizeLearningExemption),
      exemptionRequests: rows(raw.exemptionRequests).map(
        normalizeLearningExemptionRequest,
      ),
      scheduleEvents,
      attendanceSessions: rows(raw.sessions).map(normalizeAttendanceSession),
      attendanceRecords: rows(raw.records).map(normalizeAttendanceRecord),
      attendanceRevisions: rows(raw.revisions).map(normalizeAttendanceRevision),
      notices,
      deliveries: rows(raw.deliveries).map(normalizeDelivery),
      acknowledgements,
      notificationConfig: record(raw.notificationConfig),
      writeCount: 0,
      dashboard: {
        todaySchedule: rows(dashboardRaw.todaySchedule).map(
          normalizeScheduleEvent,
        ),
        upcomingLearning: rows(dashboardRaw.upcomingLearning).map(
          normalizeLearningContent,
        ),
        attendancePendingCount: number(dashboardRaw.attendancePendingCount),
        importantNotices: rows(dashboardRaw.importantNotices).map(
          normalizeNotice,
        ),
      },
    };
  } catch (error) {
    throw error instanceof W8DomainError ? error : mapError(error);
  }
};

export const toW8StatePanelState = (error: W8DomainError) => {
  if (error.kind === "PERMISSION") return "PERMISSION" as const;
  if (error.kind === "SESSION_EXPIRED") return "SESSION_EXPIRED" as const;
  if (error.kind === "NETWORK") return "OFFLINE" as const;
  if (error.kind === "CONFLICT") return "STALE" as const;
  return "ERROR" as const;
};

export const formatW8DateTime = (
  value: string,
  options?: { dateOnly?: boolean },
) => {
  if (!value) return "일정 없음";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(options?.dateOnly
      ? {}
      : { hour: "2-digit", minute: "2-digit", hour12: false }),
  }).format(parsed);
};

export const toW8LocalDateTimeInput = (value: string) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(parsed);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}T${valueOf("hour")}:${valueOf("minute")}`;
};

export const toW8ServerDateTime = (value: string) => {
  const normalized = text(value);
  if (!normalized) return "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(normalized)) {
    return normalized;
  }
  return new Date(`${normalized}:00+09:00`).toISOString();
};

export const getW8KstDateKey = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
};

export const getLearningProgressForContent = (
  state: W8DomainState,
  contentId: string,
) => state.learningProgress.find((item) => item.contentId === contentId);

const execute = async <CommandType extends keyof W2CommandPayloads>(
  commandType: CommandType,
  payload: W2CommandPayloads[CommandType],
) => {
  try {
    return await executeWestoryCommand(commandType, payload);
  } catch (error) {
    throw mapError(error);
  }
};

export const createLearningContent = (
  payload: W2CommandPayloads["createLearningContent"],
) => execute("createLearningContent", payload);
export const updateLearningContent = (
  payload: W2CommandPayloads["updateLearningContent"],
) => execute("updateLearningContent", payload);
export const transitionLearningContent = (
  payload: W2CommandPayloads["transitionLearningContent"],
) => execute("transitionLearningContent", payload);
export const recordLearningProgress = (
  payload: W2CommandPayloads["recordLearningProgress"],
) => execute("recordLearningProgress", payload);
export const resetLearningProgress = (
  payload: W2CommandPayloads["resetLearningProgress"],
) => execute("resetLearningProgress", payload);
export const grantLearningExemptions = (
  payload: W2CommandPayloads["grantLearningExemptions"],
) => execute("grantLearningExemptions", payload);
export const revokeLearningExemptions = (
  payload: W2CommandPayloads["revokeLearningExemptions"],
) => execute("revokeLearningExemptions", payload);
export const requestLearningExemption = (
  payload: W2CommandPayloads["requestLearningExemption"],
) => execute("requestLearningExemption", payload);
export const reviewLearningExemptionRequest = (
  payload: W2CommandPayloads["reviewLearningExemptionRequest"],
) => execute("reviewLearningExemptionRequest", payload);
export const createScheduleEvent = (
  payload: W2CommandPayloads["createScheduleEvent"],
) => execute("createScheduleEvent", payload);
export const updateScheduleEvent = (
  payload: W2CommandPayloads["updateScheduleEvent"],
) => execute("updateScheduleEvent", payload);
export const deleteScheduleEvent = (
  payload: W2CommandPayloads["deleteScheduleEvent"],
) => execute("deleteScheduleEvent", payload);
export const createAttendanceSession = (
  payload: W2CommandPayloads["createAttendanceSession"],
) => execute("createAttendanceSession", payload);
export const recordAttendance = (
  payload: W2CommandPayloads["recordAttendance"],
) => execute("recordAttendance", payload);
export const recordAttendanceBulk = (
  payload: W2CommandPayloads["recordAttendanceBulk"],
) => execute("recordAttendanceBulk", payload);
export const correctAttendanceRecord = (
  payload: W2CommandPayloads["correctAttendanceRecord"],
) => execute("correctAttendanceRecord", payload);
export const closeAttendanceSession = (
  payload: W2CommandPayloads["closeAttendanceSession"],
) => execute("closeAttendanceSession", payload);
export const createNotice = (payload: W2CommandPayloads["createNotice"]) =>
  execute("createNotice", payload);
export const updateNotice = (payload: W2CommandPayloads["updateNotice"]) =>
  execute("updateNotice", payload);
export const transitionNotice = (
  payload: W2CommandPayloads["transitionNotice"],
) => execute("transitionNotice", payload);
export const acknowledgeNotice = (
  payload: W2CommandPayloads["acknowledgeNotice"],
) => execute("acknowledgeNotice", payload);
export const acknowledgeAllNotices = (
  payload: W2CommandPayloads["acknowledgeAllNotices"],
) => execute("acknowledgeAllNotices", payload);
export const updateNotificationSettings = async (
  payload: W2CommandPayloads["updateNotificationSettings"],
) => {
  try {
    return await executeWestoryCommand("updateNotificationSettings", payload);
  } catch (error) {
    throw mapError(error);
  }
};
