import NumericInput from "../../components/common/NumericInput";
import "./ManageHistoryClassroom.css";
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { useSearchParams } from "react-router-dom";
import HistoryClassroomAssignmentView from "../../components/common/HistoryClassroomAssignmentView";
import LessonWorksheetStage from "../../components/common/LessonWorksheetStage";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import {
  buildAssessmentDefinitionId,
  executeAssessmentManagementCommand,
} from "../../lib/assessmentLifecycle";
import {
  deleteHistoryAssessmentSource,
  getAssessmentSemesterId,
  readAssessmentContentRevision,
  saveHistoryAssessmentSource,
} from "../../lib/assessmentRelease";
import {
  applyHistoryClassroomExemption,
  buildAnswerOptions,
  buildHistoryClassroomPublishWindow,
  formatHistoryClassroomRemainingWindow,
  getHistoryClassroomAssignedStudentUids,
  getHistoryClassroomDueAtMs,
  getHistoryClassroomRemainingMs,
  getHistoryClassroomStudentRetryResetMs,
  grantHistoryClassroomExemptions,
  inferHistoryClassroomBlankSource,
  isHistoryClassroomDeleted,
  isHistoryClassroomPastDue,
  normalizeHistoryClassroomAssignment,
  normalizeHistoryClassroomResult,
  reviewHistoryClassroomExemptionRequest,
  revokeHistoryClassroomExemptions,
  sanitizeHistoryClassroomAssignmentForWrite,
  summarizeHistoryClassroomAnswers,
  type HistoryClassroomAssignment,
  type HistoryClassroomBlank,
  type HistoryClassroomResult,
} from "../../lib/historyClassroom";
import {
  clampRatio,
  getTightTextRegionBounds,
  type LessonWorksheetBlank,
  type LessonWorksheetPageImage,
  type LessonWorksheetTextRegion,
} from "../../lib/lessonWorksheet";
import type { MapResource } from "../../lib/mapResources";
import { normalizeLessonBlankClip } from "../../lib/lessonBlankClip";
import {
  getHistoryClassroomSourceFields,
  getHistoryClassroomLessonSelectLevels,
  getHistoryClassroomSourceId,
  readHistoryClassroomLessonSources,
  type HistoryClassroomLessonSource,
} from "../../lib/historyClassroomLessonSources";
import { createManagedNotifications } from "../../lib/notifications";
import {
  isActiveRosterStudent,
  isStudentRosterProfile,
} from "../../lib/studentRoster";
import { getSemesterCollectionPath } from "../../lib/semesterScope";

const HISTORY_CLASSROOM_RESULT_LIMIT = 500;
const NEW_ASSIGNMENT_DEFAULTS = {
  timeLimitMinutes: 10,
  cooldownMinutes: 5,
  passThresholdPercent: 90,
  targetGrade: "3",
  targetClass: "2",
};
const ASSIGNMENT_REASONS = [
  "1인 1역 및 청소 안함",
  "지각",
  "수업 태도",
  "교사 지시 불이행",
];
const OTHER_ASSIGNMENT_REASON = "__other__";

interface StudentOption {
  uid: string;
  name: string;
  grade: string;
  className: string;
  number: string;
  active?: boolean;
}

type ExemptionRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "used";
type ExemptionGrantMode = "students" | "class";
type ExemptionModalTab = "grant" | "requests" | "granted";

interface HistoryClassroomExemption {
  id: string;
  uid: string;
  studentName: string;
  grade: string;
  className: string;
  number: string;
  reason: string;
  status: string;
  assignmentId: string;
  createdAt: unknown;
  expiresAt: unknown;
  requestId: string;
}

interface HistoryClassroomExemptionRequest {
  id: string;
  uid: string;
  studentName: string;
  grade: string;
  className: string;
  number: string;
  assignmentTitle: string;
  assignmentId: string;
  reason: string;
  status: ExemptionRequestStatus;
  createdAt: unknown;
  reviewedAt: unknown;
}

interface ExemptionStudentSummary {
  key: string;
  uid: string;
  studentName: string;
  grade: string;
  className: string;
  number: string;
  availableCount: number;
  requestedCount: number;
  usedCount: number;
  totalCount: number;
  items: HistoryClassroomExemption[];
}

type DashboardIconName =
  | "calendar"
  | "search"
  | "clipboard"
  | "users"
  | "check"
  | "edit"
  | "map"
  | "plus"
  | "refresh"
  | "trash"
  | "close"
  | "eye"
  | "hidden"
  | "ticket"
  | "save"
  | "clock"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "chevronUp";

const DashboardIcon = ({
  name,
  className = "h-5 w-5",
}: {
  name: DashboardIconName;
  className?: string;
}) => {
  const commonProps = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (["close", "eye", "hidden", "ticket", "save", "clock"].includes(name)) {
    return (
      <svg {...commonProps}>
        {name === "close" && <path d="m6 6 12 12M18 6 6 18" />}
        {(name === "eye" || name === "hidden") && (
          <>
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {name === "hidden" && <path d="m3 3 18 18" />}
          </>
        )}
        {name === "ticket" && (
          <>
            <path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4Z" />
            <path d="M15 5v3m0 3v2m0 3v3" />
          </>
        )}
        {name === "save" && (
          <>
            <path d="M5 3h12l4 4v14H3V3Z" />
            <path d="M7 3v6h10V3M7 21v-8h10v8" />
          </>
        )}
        {name === "clock" && (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </>
        )}
      </svg>
    );
  }

  if (name === "calendar") {
    return (
      <svg {...commonProps}>
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M3 10h18" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg {...commonProps}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    );
  }
  if (name === "clipboard") {
    return (
      <svg {...commonProps}>
        <rect x="8" y="3" width="8" height="4" rx="1.5" />
        <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <path d="M8 12h8" />
        <path d="M8 16h5" />
      </svg>
    );
  }
  if (name === "users") {
    return (
      <svg {...commonProps}>
        <path d="M16 20c0-2.2-1.8-4-4-4s-4 1.8-4 4" />
        <circle cx="12" cy="9" r="3" />
        <path d="M22 20c0-1.8-1.2-3.3-2.8-3.8" />
        <path d="M19 7.5a2.5 2.5 0 0 1 0 5" />
        <path d="M2 20c0-1.8 1.2-3.3 2.8-3.8" />
        <path d="M5 7.5a2.5 2.5 0 0 0 0 5" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16 9" />
      </svg>
    );
  }
  if (name === "edit") {
    return (
      <svg {...commonProps}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }
  if (name === "map") {
    return (
      <svg {...commonProps}>
        <path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
        <path d="M9 3v15" />
        <path d="M15 6v15" />
      </svg>
    );
  }
  if (name === "plus") {
    return (
      <svg {...commonProps}>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  }
  if (name === "refresh") {
    return (
      <svg {...commonProps}>
        <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4" />
        <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" />
      </svg>
    );
  }
  if (name === "trash") {
    return (
      <svg {...commonProps}>
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path
        d={
          name === "chevronLeft"
            ? "m15 6-6 6 6 6"
            : name === "chevronRight"
              ? "m9 6 6 6-6 6"
              : name === "chevronUp"
                ? "m6 15 6-6 6 6"
                : "m6 9 6 6 6-6"
        }
      />
    </svg>
  );
};

const formatStudentBadgeLabel = (
  student: Pick<StudentOption, "grade" | "className" | "number" | "name">,
) => {
  const parts = [
    student.grade && student.className
      ? `${student.grade}-${student.className}`
      : "",
    student.number ? `${student.number}번` : "",
    student.name,
  ].filter(Boolean);
  return parts.join(" ");
};

const formatClassGroupLabel = (
  student: Pick<StudentOption, "grade" | "className">,
) =>
  student.grade && student.className
    ? `${student.grade}-${student.className}`
    : "미지정 반";

const groupStudentsByClass = <
  T extends Pick<StudentOption, "uid" | "name" | "grade" | "className">,
>(
  items: T[],
) => {
  const grouped = new Map<string, T[]>();
  items.forEach((student) => {
    const key = formatClassGroupLabel(student);
    const current = grouped.get(key) || [];
    current.push(student);
    grouped.set(key, current);
  });
  return Array.from(grouped.entries()).map(([classLabel, students]) => ({
    classLabel,
    students: students.sort((a, b) => a.name.localeCompare(b.name, "ko")),
  }));
};

const buildStudentSearchText = (
  student: Pick<StudentOption, "name" | "grade" | "className" | "number">,
) =>
  [
    student.name,
    student.grade,
    student.className,
    student.number,
    `${student.grade}-${student.className}`,
    `${student.grade}-${student.className} ${student.number}번`,
    `${student.grade} ${student.className} ${student.number}`,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ko-KR");

const createWorksheetBlankFromRect = (
  page: number,
  rect: {
    leftRatio: number;
    topRatio: number;
    widthRatio: number;
    heightRatio: number;
  },
  source: "ocr" | "manual" = "manual",
): LessonWorksheetBlank => ({
  id: `blank-${page}-${Date.now()}`,
  page,
  leftRatio: rect.leftRatio,
  topRatio: rect.topRatio,
  widthRatio: rect.widthRatio,
  heightRatio: rect.heightRatio,
  answer: "",
  prompt: "",
  source,
});

const getBlankAnswerFromRegions = (regions: LessonWorksheetTextRegion[]) =>
  regions
    .map((region) => String(region.label || "").trim())
    .filter(Boolean)
    .join(" ");

const getBoundsFromRegions = (
  regions: LessonWorksheetTextRegion[],
  pageImage?: LessonWorksheetPageImage | null,
) => {
  if (
    !regions.length ||
    !pageImage ||
    pageImage.width <= 0 ||
    pageImage.height <= 0
  ) {
    return null;
  }

  const tightened = regions
    .map((region) => getTightTextRegionBounds(region, pageImage))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!tightened.length) {
    return null;
  }

  const left = Math.min(...tightened.map((region) => region.left));
  const top = Math.min(...tightened.map((region) => region.top));
  const right = Math.max(
    ...tightened.map((region) => region.left + region.width),
  );
  const bottom = Math.max(
    ...tightened.map((region) => region.top + region.height),
  );

  return {
    leftRatio: clampRatio(left / pageImage.width),
    topRatio: clampRatio(top / pageImage.height),
    widthRatio: clampRatio((right - left) / pageImage.width),
    heightRatio: clampRatio((bottom - top) / pageImage.height),
  };
};

const parseNumericLike = (value: string) => {
  const normalized = String(value || "").trim();
  if (!normalized) return Number.NaN;
  const direct = Number(normalized);
  if (Number.isFinite(direct)) return direct;
  const matched = normalized.match(/\d+/);
  return matched ? Number(matched[0]) : Number.NaN;
};

const compareSchoolValues = (a: string, b: string) => {
  const aNumber = parseNumericLike(a);
  const bNumber = parseNumericLike(b);
  if (
    Number.isFinite(aNumber) &&
    Number.isFinite(bNumber) &&
    aNumber !== bNumber
  ) {
    return aNumber - bNumber;
  }
  if (Number.isFinite(aNumber) && !Number.isFinite(bNumber)) return -1;
  if (!Number.isFinite(aNumber) && Number.isFinite(bNumber)) return 1;
  return a.localeCompare(b, "ko");
};

type BlankEditorMode = "create" | "edit";
type DashboardStatusFilter =
  | "all"
  | "published"
  | "private"
  | "pending"
  | "passed";
type DashboardSortOrder = "latest" | "oldest";
const ASSIGNMENTS_PER_PAGE = 10;
const GRANTED_EXEMPTIONS_PER_PAGE = 30;

const normalizeDueWindowDaysInput = (value: string): number | "" => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const numeric = Math.floor(Number(trimmed));
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return Math.max(1, numeric);
};

const resolveDueWindowDaysValue = (value: number | "") =>
  value === "" ? null : Math.max(1, Math.floor(Number(value) || 0));

const formatDeadlineLabel = (timestampMs: number | null | undefined) => {
  if (!timestampMs) return "기한 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestampMs));
};

const getTimestampMs = (value: unknown): number | null => {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && value) {
    if ("toMillis" in value && typeof value.toMillis === "function") {
      return value.toMillis();
    }
    if ("seconds" in value) {
      const seconds = Number((value as { seconds?: unknown }).seconds);
      if (Number.isFinite(seconds)) return seconds * 1000;
    }
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatDateTimeLabel = (value: unknown, fallback = "일시 없음") => {
  const timestampMs = getTimestampMs(value);
  if (!timestampMs) return fallback;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestampMs));
};

const normalizeExemptionRequestStatus = (
  value: unknown,
): ExemptionRequestStatus => {
  const normalized = String(value || "").trim();
  if (normalized === "approved") return "approved";
  if (normalized === "rejected" || normalized === "denied") return "rejected";
  if (normalized === "cancelled" || normalized === "used") return normalized;
  return "pending";
};

const getHistoryExemptionStatus = (data: Record<string, unknown>) => {
  if (data.usedAt || data.usedAssignmentId || data.usedByUid) return "used";
  if (data.revokedAt) return "revoked";
  const statuses = [data.status, data.state].filter(Boolean).map(String);
  if (statuses.some((status) => ["used", "consumed"].includes(status)))
    return "used";
  if (statuses.some((status) => ["requested", "pending"].includes(status)))
    return "requested";
  if (statuses.includes("revoked")) return "revoked";
  return statuses.every((status) => ["available", "active"].includes(status))
    ? "available"
    : "invalid";
};

const normalizeHistoryClassroomExemption = (
  id: string,
  data: Record<string, unknown>,
): HistoryClassroomExemption => ({
  id,
  uid: String(
    data.uid || data.studentUid || data.ownerUid || data.recipientUid || "",
  ).trim(),
  studentName: String(data.studentName || data.name || "").trim(),
  grade: String(data.grade || data.studentGrade || "").trim(),
  className: String(
    data.className || data.class || data.studentClass || "",
  ).trim(),
  number: String(data.number || data.studentNumber || "").trim(),
  reason: String(data.reason || data.memo || "").trim(),
  status: getHistoryExemptionStatus(data),
  assignmentId: String(data.assignmentId || "").trim(),
  createdAt: data.createdAt || data.grantedAt || null,
  expiresAt: data.expiresAt || null,
  requestId: String(data.requestId || "").trim(),
});

const normalizeHistoryClassroomExemptionRequest = (
  id: string,
  data: Record<string, unknown>,
): HistoryClassroomExemptionRequest => ({
  id,
  uid: String(data.uid || data.studentUid || "").trim(),
  studentName: String(data.studentName || data.name || "").trim(),
  grade: String(data.grade || data.studentGrade || "").trim(),
  className: String(
    data.className || data.class || data.studentClass || "",
  ).trim(),
  number: String(data.number || data.studentNumber || "").trim(),
  assignmentTitle: String(data.assignmentTitle || "").trim(),
  assignmentId: String(data.assignmentId || "").trim(),
  reason: String(data.reason || data.exemptionReason || data.memo || "").trim(),
  status: normalizeExemptionRequestStatus(data.status || data.reviewStatus),
  createdAt: data.createdAt || data.requestedAt || null,
  reviewedAt: data.reviewedAt || null,
});

const formatExemptionStudentLabel = (item: {
  studentName: string;
  grade: string;
  className: string;
  number: string;
  uid: string;
}) => {
  const classLabel =
    item.grade && item.className ? `${item.grade}-${item.className}` : "";
  return [
    item.studentName || item.uid || "학생",
    classLabel,
    item.number ? `${item.number}번` : "",
  ]
    .filter(Boolean)
    .join(" · ");
};

const formatExemptionRequestStatusLabel = (status: ExemptionRequestStatus) => {
  if (status === "approved") return "승인";
  if (status === "rejected") return "반려";
  if (status === "cancelled") return "취소";
  if (status === "used") return "사용됨";
  return "대기";
};

const getExemptionRequestStatusClassName = (status: ExemptionRequestStatus) => {
  if (status === "approved") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "rejected") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (status === "cancelled" || status === "used") {
    return "border-gray-200 bg-gray-50 text-gray-600";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
};

const formatExemptionStatusLabel = (status: string) => {
  if (status === "requested") return "사용 요청";
  if (status === "used") return "사용됨";
  if (status === "revoked") return "회수";
  return "보유";
};

const formatResultSubmittedAtLabel = (value: unknown) => {
  const timestampMs = getTimestampMs(value);
  if (!timestampMs) return "제출 시간 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestampMs));
};

const getAssignmentSortMs = (assignment: HistoryClassroomAssignment) =>
  getTimestampMs(assignment.publishedAt) ||
  getTimestampMs(assignment.createdAt) ||
  getTimestampMs(assignment.updatedAt) ||
  getHistoryClassroomDueAtMs(assignment) ||
  0;

const formatAssignmentDateLabel = (timestampMs: number) => {
  if (!timestampMs) return "날짜 미정";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(timestampMs));
};

const formatAssignmentDateKey = (timestampMs: number) => {
  if (!timestampMs) return "unknown";
  const target = new Date(timestampMs);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatAssignmentTimelineDate = (timestampMs: number) => {
  if (!timestampMs) return { date: "날짜 미정", weekday: "" };
  const target = new Date(timestampMs);
  return {
    date: new Intl.DateTimeFormat("ko-KR", {
      month: "long",
      day: "numeric",
    }).format(target),
    weekday: new Intl.DateTimeFormat("ko-KR", {
      weekday: "long",
    }).format(target),
  };
};

const getFirestoreErrorSummary = (error: unknown) => ({
  code:
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "",
  message: error instanceof Error ? error.message : String(error || ""),
});

const getHistoryClassroomErrorMessage = (error: unknown, fallback: string) => {
  const { code, message } = getFirestoreErrorSummary(error);
  const failure = error as {
    details?: { reason?: unknown };
    customData?: { details?: { reason?: unknown } };
  } | null;
  const reason = String(
    failure?.details?.reason || failure?.customData?.details?.reason || "",
  );
  if (
    code === "functions/aborted" ||
    [
      "ASSESSMENT_SOURCE_REVISION_CONFLICT",
      "ASSESSMENT_REVISION_CONFLICT",
    ].includes(reason)
  ) {
    return "다른 변경이 먼저 반영되었습니다. 입력 내용을 보관한 뒤 최신 과제를 확인해 주세요.";
  }
  if (code === "functions/unauthenticated") {
    return "로그인 상태를 확인한 뒤 다시 시도해 주세요.";
  }
  if (["functions/unavailable", "functions/deadline-exceeded"].includes(code)) {
    return "연결을 확인한 뒤 다시 시도해 주세요. 같은 요청은 중복 처리되지 않습니다.";
  }
  if (
    ["functions/internal", "functions/unknown", "functions/cancelled"].includes(
      code,
    )
  ) {
    return "서버 처리 결과를 확인하지 못했습니다. 잠시 후 같은 내용으로 다시 시도해 주세요.";
  }
  if (
    [
      "functions/invalid-argument",
      "functions/failed-precondition",
      "functions/permission-denied",
      "functions/not-found",
    ].includes(code) &&
    message
  ) {
    return message;
  }
  return fallback;
};

const describeHistoryResultStatus = (
  status: HistoryClassroomResult["status"],
) => {
  if (status === "passed") return "통과";
  if (status === "failed") return "미통과";
  return "자동 종료";
};

const pickStudentReasons = (
  reasons: Record<string, string>,
  studentUids: string[],
) =>
  Object.fromEntries(
    studentUids
      .map((uid) => [uid, String(reasons[uid] || "").trim()] as const)
      .filter(([, reason]) => reason),
  );

const historyBlankToWorksheetBlank = (
  blank: HistoryClassroomBlank,
  pageImage?: LessonWorksheetPageImage | null,
  pageRegions: LessonWorksheetTextRegion[] = [],
): LessonWorksheetBlank | null => {
  if (!pageImage || pageImage.width <= 0 || pageImage.height <= 0) {
    return null;
  }

  const inkClip = normalizeLessonBlankClip(blank.inkClip);
  return {
    id: blank.id,
    page: blank.page,
    leftRatio: clampRatio(blank.left / pageImage.width),
    topRatio: clampRatio(blank.top / pageImage.height),
    widthRatio: clampRatio(blank.width / pageImage.width),
    heightRatio: clampRatio(blank.height / pageImage.height),
    answer: blank.answer,
    prompt: blank.prompt || "",
    source: inferHistoryClassroomBlankSource(blank, pageImage, pageRegions),
    ...(inkClip ? { inkClip } : {}),
  };
};

const worksheetBlankToHistoryBlank = (
  blank: LessonWorksheetBlank,
  pageImage?: LessonWorksheetPageImage | null,
): HistoryClassroomBlank | null => {
  if (!pageImage || pageImage.width <= 0 || pageImage.height <= 0) {
    return null;
  }

  const inkClip = normalizeLessonBlankClip(blank.inkClip);
  const coordinate = inkClip ? (value: number) => value : Math.round;
  return {
    id: blank.id,
    page: blank.page,
    left: coordinate(blank.leftRatio * pageImage.width),
    top: coordinate(blank.topRatio * pageImage.height),
    width: Math.max(1, coordinate(blank.widthRatio * pageImage.width)),
    height: Math.max(1, coordinate(blank.heightRatio * pageImage.height)),
    answer: blank.answer.trim(),
    prompt: String(blank.prompt || "").trim(),
    source: blank.source === "ocr" ? "ocr" : "manual",
    ...(inkClip ? { inkClip } : {}),
  };
};

const cloneMapResourceBlanks = (
  mapResource: MapResource | null,
): HistoryClassroomBlank[] =>
  mapResource && "lessonUnitId" in mapResource
    ? (mapResource.pdfBlanks || []).map((blank) => ({ ...blank }))
    : (mapResource?.pdfBlanks || [])
        .map<HistoryClassroomBlank>((blank) => {
          const inkClip = normalizeLessonBlankClip(blank.inkClip);
          return {
            id:
              String(blank.id || "").trim() ||
              `blank-${blank.page}-${blank.left}-${blank.top}`,
            page: Math.max(1, Number(blank.page) || 1),
            left: Number(blank.left) || 0,
            top: Number(blank.top) || 0,
            width: Math.max(1, Number(blank.width) || 1),
            height: Math.max(1, Number(blank.height) || 1),
            answer: String(blank.answer || "").trim(),
            prompt: String(blank.prompt || "").trim(),
            source: blank.source === "ocr" ? "ocr" : "manual",
            ...(inkClip ? { inkClip } : {}),
          };
        })
        .filter((blank) => blank.answer)
        .sort((a, b) => a.page - b.page || a.top - b.top || a.left - b.left);

const HistoryClassroomSourceSelect: React.FC<{
  id: string;
  value: string;
  currentLabel?: string;
  stacked?: boolean;
  sources: HistoryClassroomLessonSource[];
  loading: boolean;
  error: string;
  onChange: (value: string) => void;
}> = ({
  id,
  value,
  currentLabel,
  stacked = false,
  sources,
  loading,
  error,
  onChange,
}) => {
  const lessonLevels = getHistoryClassroomLessonSelectLevels(sources, value);
  const selectClassName =
    "min-h-11 w-full min-w-0 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm";
  return (
    <div className="min-w-0 space-y-3">
      {lessonLevels.length ? (
        <div
          className={`grid min-w-0 gap-3 ${stacked ? "" : "md:grid-cols-3"}`}
        >
          {lessonLevels.map((level, index) => {
            const levelId =
              index === lessonLevels.length - 1 ? id : `${id}-level-${index}`;
            return (
              <label key={index} className="block min-w-0" htmlFor={levelId}>
                <span className="mb-1 block text-xs font-bold text-gray-500">
                  {["대목차", "중목차", "소목차"][index] ||
                    `하위 목차 ${index - 2}`}
                </span>
                <select
                  id={levelId}
                  title={
                    level.options.find((option) => option.value === level.value)
                      ?.title || currentLabel
                  }
                  data-lesson-level={index}
                  value={level.value}
                  onChange={(event) => {
                    const option = level.options.find(
                      (item) => item.value === event.target.value,
                    );
                    if (option) onChange(option.sourceId);
                  }}
                  className={selectClassName}
                >
                  {!level.value && (
                    <option value="">
                      {(currentLabel ? "기존 배포 자료 유지" : "") ||
                        (loading ? "수업 자료 불러오는 중…" : "목차 선택")}
                    </option>
                  )}
                  {level.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.title}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      ) : (
        <label className="block" htmlFor={id}>
          <span className="mb-1 block text-xs font-bold text-gray-500">
            수업 자료 목차
          </span>
          <select
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="min-h-11 w-full min-w-0 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {!sources.some((source) => source.id === value) && (
              <option value={value}>
                {currentLabel ||
                  (loading ? "수업 자료 불러오는 중…" : "자료 선택")}
              </option>
            )}
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.lessonUnitPath.join(" › ")}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!loading && !error && !sources.length && (
        <p className="text-sm text-gray-500">
          빈칸이 저장된 수업 자료가 없습니다.
        </p>
      )}
    </div>
  );
};

const AssignmentReasonField: React.FC<{
  id: string;
  studentName: string;
  value: string;
  explicitOther: boolean;
  showError: boolean;
  compact?: boolean;
  onChange: (value: string, other: boolean) => void;
}> = ({
  id,
  studentName,
  value,
  explicitOther,
  showError,
  compact = false,
  onChange,
}) => {
  const other =
    explicitOther || (!!value && !ASSIGNMENT_REASONS.includes(value));
  const invalid = showError && !value.trim();
  if (compact) {
    return (
      <div className="history-entry-reason min-w-0">
        <input
          id={id}
          aria-label={`${studentName} 배정 사유`}
          title={value || "배정 사유 선택 또는 직접 입력"}
          list="history-assignment-reasons"
          value={value}
          placeholder="배정 사유"
          required
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(event) =>
            onChange(
              event.target.value,
              !ASSIGNMENT_REASONS.includes(event.target.value),
            )
          }
          className="min-h-11 w-full min-w-0 rounded-xl border border-gray-300 bg-white px-2 py-2 text-xs"
        />
        {invalid && (
          <p
            id={`${id}-error`}
            role="alert"
            className="mt-1 text-sm text-red-600"
          >
            배정 사유를 입력해 주세요.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="history-entry-reason min-w-0 space-y-2">
      <label className="block" htmlFor={id}>
        <span className="mb-1 block text-xs font-bold text-gray-500">
          배정 사유
        </span>
        <select
          id={id}
          aria-label={`${studentName} 배정 사유`}
          value={other ? OTHER_ASSIGNMENT_REASON : value}
          aria-invalid={invalid}
          title={value || "배정 사유 선택"}
          onChange={(event) => {
            const nextOther = event.target.value === OTHER_ASSIGNMENT_REASON;
            onChange(
              nextOther ? (other ? value : "") : event.target.value,
              nextOther,
            );
          }}
          className="min-h-11 w-full min-w-0 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">사유 선택</option>
          {ASSIGNMENT_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {reason}
            </option>
          ))}
          <option value={OTHER_ASSIGNMENT_REASON}>기타</option>
        </select>
      </label>
      {invalid && !other && (
        <p role="alert" className="text-sm text-red-600">
          배정 사유를 선택해 주세요.
        </p>
      )}
      {other && (
        <label className="block" htmlFor={`${id}-other`}>
          <span className="mb-1 block text-xs font-bold text-gray-500">
            기타 사유 (필수)
          </span>
          <textarea
            id={`${id}-other`}
            lang="ko"
            inputMode="text"
            rows={2}
            required
            value={value}
            aria-label={`${studentName} 기타 사유`}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${id}-error` : undefined}
            onChange={(event) => onChange(event.target.value, true)}
            className="w-full resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          {invalid && (
            <span
              id={`${id}-error`}
              role="alert"
              className="mt-1 block text-sm text-red-600"
            >
              기타 사유를 입력해 주세요.
            </span>
          )}
        </label>
      )}
    </div>
  );
};

const HistoryActionButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: DashboardIconName;
    label: string;
  }
> = ({ icon, label, className = "", children, ...props }) => (
  <button
    type="button"
    {...props}
    aria-label={props["aria-label"] || label}
    title={props.title || label}
    className={`history-action-button ${className}`}
  >
    <DashboardIcon name={icon} />
    <span className="history-action-label">{label}</span>
    {children}
  </button>
);

const AssignmentStudentPicker: React.FC<{
  id: string;
  students: StudentOption[];
  selectedUids: string[];
  initialGrade: string;
  initialClass: string;
  reason: string;
  reasonOther: boolean;
  reasonError: boolean;
  onReasonChange: (value: string, other: boolean) => void;
  onAdd: (student: StudentOption) => boolean;
}> = ({
  id,
  students,
  selectedUids,
  initialGrade,
  initialClass,
  reason,
  reasonOther,
  reasonError,
  onReasonChange,
  onAdd,
}) => {
  const [grade, setGrade] = useState(initialGrade);
  const [className, setClassName] = useState(initialClass);
  const [number, setNumber] = useState("");
  const [studentUid, setStudentUid] = useState("");
  const [search, setSearch] = useState("");
  const options = (values: string[]) =>
    Array.from(new Set(values.filter(Boolean))).sort(compareSchoolValues);
  const gradeOptions = options(students.map((student) => student.grade));
  const gradeStudents = students.filter(
    (student) => !grade || student.grade === grade,
  );
  const classOptions = options(
    gradeStudents.map((student) => student.className),
  );
  const classStudents = gradeStudents.filter(
    (student) => !className || student.className === className,
  );
  const numberOptions = options(classStudents.map((student) => student.number));
  const availableStudents = classStudents.filter(
    (student) =>
      !selectedUids.includes(student.uid) &&
      (!number || student.number === number),
  );
  const selected =
    availableStudents.find((student) => student.uid === studentUid) ||
    (number && availableStudents.length === 1 ? availableStudents[0] : null);
  const searchResults = search.trim()
    ? students
        .filter(
          (student) =>
            !selectedUids.includes(student.uid) &&
            buildStudentSearchText(student).includes(
              search.trim().toLocaleLowerCase("ko-KR"),
            ),
        )
        .slice(0, 8)
    : [];
  const addStudent = (student: StudentOption) => {
    if (!onAdd(student)) return;
    setGrade(student.grade);
    setClassName(student.className);
    setNumber("");
    setStudentUid("");
    setSearch("");
  };
  return (
    <div className="history-student-entry">
      <div className="history-student-entry-grid">
        <div className="history-student-fields">
          <select
            aria-label="대상 학년"
            title="대상 학년"
            value={grade}
            onChange={(event) => {
              setGrade(event.target.value);
              setClassName("");
              setNumber("");
              setStudentUid("");
            }}
          >
            <option value="">학년</option>
            {grade && !gradeOptions.includes(grade) && (
              <option value={grade}>{grade}</option>
            )}
            {gradeOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            aria-label="대상 학급"
            title="대상 학급"
            value={className}
            onChange={(event) => {
              setClassName(event.target.value);
              setNumber("");
              setStudentUid("");
            }}
          >
            <option value="">반</option>
            {className && !classOptions.includes(className) && (
              <option value={className}>{className}</option>
            )}
            {classOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            aria-label="대상 번호"
            title="대상 번호"
            value={number}
            onChange={(event) => {
              setNumber(event.target.value);
              setStudentUid("");
            }}
          >
            <option value="">번호</option>
            {numberOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            aria-label="대상 학생"
            title={selected?.name || "대상 학생"}
            value={selected?.uid || ""}
            onChange={(event) => setStudentUid(event.target.value)}
          >
            <option value="">이름</option>
            {availableStudents.map((student) => (
              <option key={student.uid} value={student.uid}>
                {student.name}
              </option>
            ))}
          </select>
        </div>
        <AssignmentReasonField
          id={id}
          studentName="추가할 학생"
          value={reason}
          explicitOther={reasonOther}
          showError={reasonError}
          compact
          onChange={onReasonChange}
        />
        <div className="history-student-search-group">
          <input
            className="history-student-search"
            aria-label="전체 학생 이름 검색"
            lang="ko"
            inputMode="text"
            placeholder="전체 이름 검색"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <HistoryActionButton
            icon="plus"
            label="학생 추가"
            disabled={!selected}
            onClick={() => {
              if (selected) addStudent(selected);
            }}
            className="h-11 rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-bold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>
      {search.trim() && (
        <div className="mt-2 rounded-xl border border-gray-200 bg-white p-2">
          {searchResults.length ? (
            searchResults.map((student) => (
              <button
                key={student.uid}
                type="button"
                onClick={() => addStudent(student)}
                className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg px-2 text-left text-sm hover:bg-blue-50"
              >
                <span className="font-bold text-gray-900">{student.name}</span>
                <span className="shrink-0 text-xs text-gray-500">
                  {student.grade}-{student.className} {student.number}번
                </span>
              </button>
            ))
          ) : (
            <div className="px-2 py-3 text-sm text-gray-500">
              검색 결과가 없습니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const AssignedStudentRow: React.FC<{
  student: StudentOption;
  id: string;
  reason: string;
  invalid: boolean;
  onReasonChange: (reason: string) => void;
  onRemove: () => void;
}> = ({ student, id, reason, invalid, onReasonChange, onRemove }) => (
  <div>
    <div className="history-student-row">
      <div
        className="history-student-info"
        title={`${student.grade}-${student.className} ${student.number}번 ${student.name}`}
      >
        <span className="text-gray-500">
          {student.grade}-{student.className} {student.number}번
        </span>
        <span className="history-student-name">{student.name}</span>
      </div>
      <input
        id={`${id}-other`}
        className="history-student-reason"
        aria-label={`${student.name} 배정 사유`}
        title={reason || "사유 미입력"}
        list="history-assignment-reasons"
        value={reason}
        placeholder="사유 미입력"
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => onReasonChange(event.target.value)}
      />
      <HistoryActionButton
        icon="trash"
        label={`${student.name} 배정 삭제`}
        onClick={onRemove}
        className="history-student-remove text-red-500 hover:bg-red-50 rounded-xl"
      />
    </div>
    {invalid && (
      <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-600">
        배정 사유를 입력해 주세요.
      </p>
    )}
  </div>
);

const ManageHistoryClassroom: React.FC = () => {
  const { config, userData } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [lessonSources, setLessonSources] = useState<
    HistoryClassroomLessonSource[]
  >([]);
  const [lessonSourceError, setLessonSourceError] = useState("");
  const [loadingLessonSources, setLoadingLessonSources] = useState(false);
  const worksheetSources = lessonSources;
  const [assignments, setAssignments] = useState<HistoryClassroomAssignment[]>(
    [],
  );
  const [resultsByAssignment, setResultsByAssignment] = useState<
    Record<string, HistoryClassroomResult[]>
  >({});
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [exemptions, setExemptions] = useState<HistoryClassroomExemption[]>([]);
  const [exemptionRequests, setExemptionRequests] = useState<
    HistoryClassroomExemptionRequest[]
  >([]);
  const [loadingExemptions, setLoadingExemptions] = useState(false);
  const [exemptionLoadError, setExemptionLoadError] = useState("");
  const [exemptionPanelOpen, setExemptionPanelOpen] = useState(false);
  const [exemptionModalTab, setExemptionModalTab] =
    useState<ExemptionModalTab>("grant");
  const [highlightedExemptionRequestId, setHighlightedExemptionRequestId] =
    useState("");
  const [expandedExemptionStudentKey, setExpandedExemptionStudentKey] =
    useState("");
  const [grantedExemptionGradeFilter, setGrantedExemptionGradeFilter] =
    useState("");
  const [grantedExemptionClassFilter, setGrantedExemptionClassFilter] =
    useState("");
  const [grantedExemptionNameSearch, setGrantedExemptionNameSearch] =
    useState("");
  const [grantedExemptionPage, setGrantedExemptionPage] = useState(1);
  const [exemptionGrantMode, setExemptionGrantMode] =
    useState<ExemptionGrantMode>("students");
  const [exemptionStudentSearch, setExemptionStudentSearch] = useState("");
  const [exemptionSelectedStudentUids, setExemptionSelectedStudentUids] =
    useState<string[]>([]);
  const [exemptionTargetGrade, setExemptionTargetGrade] = useState("");
  const [exemptionTargetClass, setExemptionTargetClass] = useState("");
  const [
    excludedClassExemptionStudentUids,
    setExcludedClassExemptionStudentUids,
  ] = useState<string[]>([]);
  const [exemptionReason, setExemptionReason] = useState("");
  const [grantingExemption, setGrantingExemption] = useState(false);
  const grantingExemptionRef = React.useRef(false);
  const [revokingExemptionStudentKey, setRevokingExemptionStudentKey] =
    useState("");
  const [resettingGrantedExemptions, setResettingGrantedExemptions] =
    useState(false);
  const [reviewingExemptionRequestId, setReviewingExemptionRequestId] =
    useState("");
  const exemptionSectionRef = React.useRef<HTMLElement | null>(null);
  const [selectedMapId, setSelectedMapId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(
    NEW_ASSIGNMENT_DEFAULTS.timeLimitMinutes,
  );
  const [cooldownMinutes, setCooldownMinutes] = useState(
    NEW_ASSIGNMENT_DEFAULTS.cooldownMinutes,
  );
  const [dueWindowDays, setDueWindowDays] = useState<number | "">("");
  const [passThresholdPercent, setPassThresholdPercent] = useState(
    NEW_ASSIGNMENT_DEFAULTS.passThresholdPercent,
  );
  const [targetGrade, setTargetGrade] = useState(
    NEW_ASSIGNMENT_DEFAULTS.targetGrade,
  );
  const [targetClass, setTargetClass] = useState(
    NEW_ASSIGNMENT_DEFAULTS.targetClass,
  );
  const [selectedStudentUids, setSelectedStudentUids] = useState<string[]>([]);
  const [studentReasons, setStudentReasons] = useState<Record<string, string>>(
    {},
  );
  const [blanks, setBlanks] = useState<HistoryClassroomBlank[]>([]);
  const [otherReasonUids, setOtherReasonUids] = useState<string[]>([]);
  const [showReasonErrors, setShowReasonErrors] = useState(false);
  const [newStudentReason, setNewStudentReason] = useState("");
  const [newStudentReasonOther, setNewStudentReasonOther] = useState(false);
  const [newStudentReasonError, setNewStudentReasonError] = useState(false);
  const [editingNewStudentReason, setEditingNewStudentReason] = useState("");
  const [editingNewStudentReasonOther, setEditingNewStudentReasonOther] =
    useState(false);
  const [editingNewStudentReasonError, setEditingNewStudentReasonError] =
    useState(false);
  const [editingOtherReasonUids, setEditingOtherReasonUids] = useState<
    string[]
  >([]);
  const [showEditingReasonErrors, setShowEditingReasonErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = React.useRef(false);
  const savingEditRef = React.useRef(false);
  const [selectedBlankId, setSelectedBlankId] = useState("");
  const [draftBlank, setDraftBlank] = useState<any>(null);
  const [draftBlankAnswer, setDraftBlankAnswer] = useState("");
  const [blankEditorMode, setBlankEditorMode] =
    useState<BlankEditorMode | null>(null);
  const [blankEditorAnswer, setBlankEditorAnswer] = useState("");
  const [blankEditorError, setBlankEditorError] = useState("");
  const [worksheetTool, setWorksheetTool] = useState<"ocr" | "box">("box");
  const [showAllBlankTags, setShowAllBlankTags] = useState(false);
  const [floatingPanelOpen, setFloatingPanelOpen] = useState(false);
  const [worksheetEditingAssignmentId, setWorksheetEditingAssignmentId] =
    useState("");
  const [worksheetEditingIsPublished, setWorksheetEditingIsPublished] =
    useState(true);
  const [worksheetImportSourceId, setWorksheetImportSourceId] = useState("");
  const [worksheetImportSourceTitle, setWorksheetImportSourceTitle] =
    useState("");
  const [worksheetSourceAssignment, setWorksheetSourceAssignment] =
    useState<HistoryClassroomAssignment | null>(null);
  const [editingAssignmentId, setEditingAssignmentId] = useState("");
  const [editingMapResourceId, setEditingMapResourceId] = useState("");
  const [editingRefreshSource, setEditingRefreshSource] = useState(false);
  const [refreshingEditingSource, setRefreshingEditingSource] = useState(false);
  const editingSourceRefreshRef = React.useRef(0);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingTimeLimitMinutes, setEditingTimeLimitMinutes] = useState(0);
  const [editingCooldownMinutes, setEditingCooldownMinutes] = useState(0);
  const [editingDueWindowDays, setEditingDueWindowDays] = useState<number | "">(
    "",
  );
  const [editingPassThresholdPercent, setEditingPassThresholdPercent] =
    useState(80);
  const [editingStudentUids, setEditingStudentUids] = useState<string[]>([]);
  const [editingStudentSearchOpen, setEditingStudentSearchOpen] =
    useState(false);
  const [editingStudentReasons, setEditingStudentReasons] = useState<
    Record<string, string>
  >({});
  const [editingIsPublished, setEditingIsPublished] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingAssignment, setDeletingAssignment] = useState(false);
  const [resettingAttemptUid, setResettingAttemptUid] = useState("");
  const resettingAttemptRef = React.useRef(false);
  const applyingExemptionRef = React.useRef(false);
  const [applyingExemptionUid, setApplyingExemptionUid] = useState("");
  const [appliedExemptionKeys, setAppliedExemptionKeys] = useState<string[]>(
    [],
  );
  const [directExemptionFeedback, setDirectExemptionFeedback] = useState<
    Record<string, string>
  >({});
  const pendingAssignmentId = React.useRef("");
  const assignmentCollectionPathsRef = React.useRef<Record<string, string>>({});
  const [expandedAttemptUids, setExpandedAttemptUids] = useState<string[]>([]);
  const [attemptResetFeedback, setAttemptResetFeedback] = useState<
    Record<string, string>
  >({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCurrentPage, setPreviewCurrentPage] = useState(1);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, string>>(
    {},
  );
  const [reviewResultId, setReviewResultId] = useState("");
  const [reviewCurrentPage, setReviewCurrentPage] = useState(1);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  useEffect(() => {
    if (!isCreateModalOpen) pendingAssignmentId.current = "";
  }, [isCreateModalOpen]);
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [dashboardStatusFilter, setDashboardStatusFilter] =
    useState<DashboardStatusFilter>("all");
  const [dashboardSortOrder, setDashboardSortOrder] =
    useState<DashboardSortOrder>("latest");
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [refreshingDashboard, setRefreshingDashboard] = useState(false);
  const [expandedAssignmentId, setExpandedAssignmentId] = useState("");
  const preserveBlankResetRef = React.useRef(false);
  const blankEditorComposingRef = React.useRef(false);
  const blankEditorCommitLockRef = React.useRef(false);

  const loadExemptionData = React.useCallback(async () => {
    setLoadingExemptions(true);
    setExemptionLoadError("");
    try {
      const exemptionPath = getSemesterCollectionPath(
        config,
        "history_classroom_exemptions",
      );
      const requestPath = getSemesterCollectionPath(
        config,
        "history_classroom_exemption_requests",
      );
      const [exemptionSnap, requestSnap] = await Promise.all([
        getDocs(collection(db, exemptionPath)),
        getDocs(collection(db, requestPath)),
      ]);
      setExemptions(
        exemptionSnap.docs
          .map((docSnap) =>
            normalizeHistoryClassroomExemption(docSnap.id, docSnap.data()),
          )
          .sort(
            (a, b) =>
              (getTimestampMs(b.createdAt) || 0) -
              (getTimestampMs(a.createdAt) || 0),
          ),
      );
      setExemptionRequests(
        requestSnap.docs
          .map((docSnap) =>
            normalizeHistoryClassroomExemptionRequest(
              docSnap.id,
              docSnap.data(),
            ),
          )
          .sort(
            (a, b) =>
              (getTimestampMs(b.createdAt) || 0) -
              (getTimestampMs(a.createdAt) || 0),
          ),
      );
    } catch (error) {
      console.error("Failed to load history classroom exemption data:", error);
      setExemptionLoadError(
        "면제권 내역을 불러오지 못했습니다. 새로고침해 주세요.",
      );
    } finally {
      setLoadingExemptions(false);
    }
  }, [config]);

  useEffect(() => {
    const loadData = async () => {
      setRefreshingDashboard(true);
      try {
        const studentSnap = await getDocs(collection(db, "users"));
        const loadedStudents = studentSnap.docs
          .map((docSnap) => {
            const data = docSnap.data() as Record<string, unknown>;
            if (!isStudentRosterProfile(data)) return null;
            return {
              uid: docSnap.id,
              name: String(data.name || "").trim(),
              grade: String(data.grade || "").trim(),
              className: String(data.class || "").trim(),
              number: String(data.number || "").trim(),
              active: data.role === "student" && isActiveRosterStudent(data),
            } as StudentOption;
          })
          .filter((item): item is StudentOption => !!item && !!item.uid)
          .sort(
            (a, b) =>
              compareSchoolValues(a.grade, b.grade) ||
              compareSchoolValues(a.className, b.className) ||
              compareSchoolValues(a.number, b.number) ||
              a.name.localeCompare(b.name, "ko"),
          );
        setStudents(loadedStudents);

        let assignmentPath = getSemesterCollectionPath(
          config,
          "history_classrooms",
        );
        let assignmentSnap = await getDocs(
          query(collection(db, assignmentPath), orderBy("updatedAt", "desc")),
        );
        if (assignmentSnap.empty) {
          assignmentPath = "history_classrooms";
          assignmentSnap = await getDocs(
            query(
              collection(db, "history_classrooms"),
              orderBy("updatedAt", "desc"),
            ),
          );
        }
        assignmentCollectionPathsRef.current = Object.fromEntries(
          assignmentSnap.docs.map((item) => [item.id, assignmentPath]),
        );
        setAssignments(
          assignmentSnap.docs
            .map((docSnap) =>
              normalizeHistoryClassroomAssignment(docSnap.id, docSnap.data()),
            )
            .filter((assignment) => !isHistoryClassroomDeleted(assignment)),
        );

        const resultPath = getSemesterCollectionPath(
          config,
          "history_classroom_results",
        );
        let resultSnap = await getDocs(
          query(
            collection(db, resultPath),
            orderBy("createdAt", "desc"),
            limit(HISTORY_CLASSROOM_RESULT_LIMIT),
          ),
        );
        if (resultSnap.empty) {
          resultSnap = await getDocs(
            query(
              collection(db, "history_classroom_results"),
              orderBy("createdAt", "desc"),
              limit(HISTORY_CLASSROOM_RESULT_LIMIT),
            ),
          );
        }
        const groupedResults: Record<string, HistoryClassroomResult[]> = {};
        resultSnap.docs.forEach((docSnap) => {
          const result = normalizeHistoryClassroomResult(
            docSnap.id,
            docSnap.data(),
          );
          groupedResults[result.assignmentId] = [
            ...(groupedResults[result.assignmentId] || []),
            result,
          ];
        });
        setResultsByAssignment(groupedResults);
        void loadExemptionData();
      } catch (error) {
        console.error(
          "Failed to load history classroom dashboard data:",
          error,
        );
      } finally {
        setRefreshingDashboard(false);
      }
    };

    void loadData();
  }, [config, dashboardRefreshKey, loadExemptionData]);

  useEffect(() => {
    if (searchParams.get("panel") !== "exemption-requests") return;
    setExemptionPanelOpen(true);
    setExemptionModalTab("requests");
    setHighlightedExemptionRequestId(searchParams.get("requestId") || "");
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoadingLessonSources(true);
    setLessonSourceError("");
    setLessonSources([]);
    void readHistoryClassroomLessonSources(config)
      .then((sources) => {
        if (!cancelled) {
          setLessonSources(sources);
          setSelectedMapId((previous) => previous || sources[0]?.id || "");
        }
      })
      .catch((error) => {
        console.error(
          "Failed to load history classroom lesson sources:",
          error,
        );
        if (!cancelled)
          setLessonSourceError(
            "수업 자료를 불러오지 못했습니다. 새로고침 후 다시 선택해 주세요.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoadingLessonSources(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, dashboardRefreshKey]);

  const selectedWorksheetSource = useMemo(
    () =>
      worksheetSources.find((source) => source.id === selectedMapId) || null,
    [worksheetSources, selectedMapId],
  );

  useEffect(() => {
    if (preserveBlankResetRef.current) {
      preserveBlankResetRef.current = false;
      return;
    }
    setBlanks(
      worksheetSourceAssignment &&
        getHistoryClassroomSourceId(worksheetSourceAssignment) === selectedMapId
        ? worksheetSourceAssignment.blanks
        : cloneMapResourceBlanks(selectedWorksheetSource),
    );
    setSelectedBlankId("");
    setDraftBlank(null);
    setDraftBlankAnswer("");
    setBlankEditorMode(null);
    setBlankEditorAnswer("");
    setBlankEditorError("");
    blankEditorComposingRef.current = false;
    setShowAllBlankTags(false);
  }, [selectedWorksheetSource, selectedMapId, worksheetSourceAssignment]);

  const worksheetSourceMap = useMemo<MapResource | null>(() => {
    if (
      !worksheetSourceAssignment ||
      worksheetSourceAssignment.sourceType !== "lesson" ||
      getHistoryClassroomSourceId(worksheetSourceAssignment) !== selectedMapId
    ) {
      return null;
    }

    if (
      !(worksheetSourceAssignment.pdfPageImages?.length || 0) &&
      !(worksheetSourceAssignment.pdfRegions?.length || 0)
    ) {
      return worksheetSources.find((item) => item.id === selectedMapId) || null;
    }

    return {
      id: getHistoryClassroomSourceId(worksheetSourceAssignment),
      title: worksheetSourceAssignment.title,
      lessonUnitId: worksheetSourceAssignment.lessonUnitId,
      lessonTitle: worksheetSourceAssignment.lessonTitle,
      lessonUnitPath: worksheetSourceAssignment.lessonUnitPath,
      category: "",
      description: "",
      type: "pdf",
      pdfPageImages: worksheetSourceAssignment.pdfPageImages || [],
      pdfRegions: worksheetSourceAssignment.pdfRegions || [],
      pdfBlanks: worksheetSourceAssignment.blanks,
      sortOrder: -1,
    };
  }, [worksheetSources, selectedMapId, worksheetSourceAssignment]);

  const selectedMap = useMemo(
    () =>
      worksheetSourceMap ||
      worksheetSources.find((item) => item.id === selectedMapId) ||
      null,
    [worksheetSources, selectedMapId, worksheetSourceMap],
  );

  const activeWorksheetMap = selectedMap;

  const worksheetPageImages = useMemo(
    () =>
      (activeWorksheetMap?.pdfPageImages || []).map((page) => ({
        page: page.page,
        imageUrl: page.imageUrl,
        width: page.width,
        height: page.height,
      })),
    [activeWorksheetMap],
  );

  const worksheetTextRegions = useMemo(
    () =>
      (activeWorksheetMap?.pdfRegions || []).map((region) => ({
        label: region.label,
        page: region.page,
        left: region.left,
        top: region.top,
        width: region.width,
        height: region.height,
      })),
    [activeWorksheetMap],
  );

  const worksheetBlanks = useMemo(
    () =>
      blanks
        .map((blank) => {
          const pageImage =
            worksheetPageImages.find((page) => page.page === blank.page) ||
            null;
          const pageRegions = worksheetTextRegions.filter(
            (region) => region.page === blank.page,
          );
          return historyBlankToWorksheetBlank(blank, pageImage, pageRegions);
        })
        .filter((item): item is LessonWorksheetBlank => Boolean(item)),
    [blanks, worksheetPageImages, worksheetTextRegions],
  );

  const sortedBlanks = useMemo(
    () =>
      [...blanks].sort(
        (a, b) => a.page - b.page || a.top - b.top || a.left - b.left,
      ),
    [blanks],
  );

  const visibleBlankTags = useMemo(
    () => (showAllBlankTags ? sortedBlanks : sortedBlanks.slice(0, 6)),
    [showAllBlankTags, sortedBlanks],
  );
  const blankOrderMap = useMemo(
    () => new Map(sortedBlanks.map((blank, index) => [blank.id, index + 1])),
    [sortedBlanks],
  );

  const selectedStudents = useMemo(
    () =>
      selectedStudentUids
        .map((uid) => students.find((student) => student.uid === uid))
        .filter((student): student is StudentOption => !!student),
    [selectedStudentUids, students],
  );

  const studentByUid = useMemo(
    () => new Map(students.map((student) => [student.uid, student])),
    [students],
  );

  const gradeOptions = useMemo(
    () =>
      Array.from(
        new Set(students.map((student) => student.grade).filter(Boolean)),
      ).sort(compareSchoolValues),
    [students],
  );

  const exemptionSelectedStudents = useMemo(
    () =>
      exemptionSelectedStudentUids
        .map((uid) => students.find((student) => student.uid === uid))
        .filter(
          (student): student is StudentOption =>
            !!student && student.active !== false,
        ),
    [exemptionSelectedStudentUids, students],
  );

  const searchedExemptionStudents = useMemo(() => {
    const keyword = exemptionStudentSearch.trim().toLocaleLowerCase("ko-KR");
    if (!keyword) return [];
    return students
      .filter(
        (student) =>
          student.active !== false &&
          !exemptionSelectedStudentUids.includes(student.uid) &&
          buildStudentSearchText(student).includes(keyword),
      )
      .slice(0, 8);
  }, [exemptionSelectedStudentUids, exemptionStudentSearch, students]);

  const exemptionClassOptions = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .filter(
              (student) =>
                student.active !== false &&
                (!exemptionTargetGrade ||
                  student.grade === exemptionTargetGrade),
            )
            .map((student) => student.className)
            .filter(Boolean),
        ),
      ).sort(compareSchoolValues),
    [exemptionTargetGrade, students],
  );

  const exemptionClassStudents = useMemo(() => {
    const grade = String(exemptionTargetGrade || "").trim();
    const className = String(exemptionTargetClass || "").trim();
    if (!grade || !className) return [];
    return students.filter(
      (student) =>
        student.active !== false &&
        student.grade === grade &&
        student.className === className,
    );
  }, [exemptionTargetClass, exemptionTargetGrade, students]);

  const activeExemptionClassStudents = useMemo(
    () =>
      exemptionClassStudents.filter(
        (student) => !excludedClassExemptionStudentUids.includes(student.uid),
      ),
    [excludedClassExemptionStudentUids, exemptionClassStudents],
  );

  const exemptionClassLabel = useMemo(() => {
    const grade = String(exemptionTargetGrade || "").trim();
    const className = String(exemptionTargetClass || "").trim();
    return grade && className ? `${grade}학년 ${className}반` : "담임 학급";
  }, [exemptionTargetClass, exemptionTargetGrade]);

  useEffect(() => {
    setExcludedClassExemptionStudentUids((previous) =>
      previous.filter((uid) =>
        exemptionClassStudents.some((student) => student.uid === uid),
      ),
    );
  }, [exemptionClassStudents]);

  useEffect(() => {
    const teacherGrade = String(userData?.grade || "").trim();
    const teacherClass = String(userData?.class || "").trim();
    if (teacherGrade) {
      setExemptionTargetGrade(teacherGrade);
    }
    if (teacherClass) {
      setExemptionTargetClass(teacherClass);
    }
  }, [userData?.class, userData?.grade]);

  const sortedExemptionRequests = useMemo(
    () =>
      [...exemptionRequests].sort((a, b) => {
        if (a.status !== b.status) {
          if (a.status === "pending") return -1;
          if (b.status === "pending") return 1;
        }
        return (
          (getTimestampMs(b.createdAt) || 0) -
          (getTimestampMs(a.createdAt) || 0)
        );
      }),
    [exemptionRequests],
  );

  const pendingExemptionRequestCount = useMemo(
    () =>
      exemptionRequests.filter((request) => request.status === "pending")
        .length,
    [exemptionRequests],
  );

  const activeExemptionCount = useMemo(
    () =>
      exemptions.filter((exemption) => exemption.status !== "revoked").length,
    [exemptions],
  );

  const grantedExemptionStudentRows = useMemo(() => {
    const rowsByStudent = new Map<string, ExemptionStudentSummary>();

    exemptions.forEach((exemption) => {
      if (exemption.status === "revoked") return;
      const matchedStudent = exemption.uid
        ? students.find((student) => student.uid === exemption.uid)
        : null;
      const key =
        exemption.uid ||
        [
          exemption.grade,
          exemption.className,
          exemption.number,
          exemption.studentName,
        ]
          .filter(Boolean)
          .join(":") ||
        exemption.id;
      const existing =
        rowsByStudent.get(key) ||
        ({
          key,
          uid: exemption.uid,
          studentName:
            exemption.studentName ||
            matchedStudent?.name ||
            exemption.uid ||
            "학생",
          grade: exemption.grade || matchedStudent?.grade || "",
          className: exemption.className || matchedStudent?.className || "",
          number: exemption.number || matchedStudent?.number || "",
          availableCount: 0,
          requestedCount: 0,
          usedCount: 0,
          totalCount: 0,
          items: [],
        } satisfies ExemptionStudentSummary);

      const status = String(exemption.status || "").trim();
      existing.totalCount += 1;
      if (status === "requested") {
        existing.requestedCount += 1;
      } else if (status === "used") {
        existing.usedCount += 1;
      } else {
        existing.availableCount += 1;
      }
      existing.items = [...existing.items, exemption].sort(
        (a, b) =>
          (getTimestampMs(b.createdAt) || 0) -
          (getTimestampMs(a.createdAt) || 0),
      );
      rowsByStudent.set(key, existing);
    });

    return Array.from(rowsByStudent.values()).sort((a, b) => {
      const gradeCompare = compareSchoolValues(a.grade, b.grade);
      if (gradeCompare) return gradeCompare;
      const classCompare = compareSchoolValues(a.className, b.className);
      if (classCompare) return classCompare;
      const numberCompare = compareSchoolValues(a.number, b.number);
      if (numberCompare) return numberCompare;
      return a.studentName.localeCompare(b.studentName, "ko-KR");
    });
  }, [exemptions, students]);

  const grantedExemptionClassCount = useMemo(
    () =>
      new Set(
        grantedExemptionStudentRows.map((row) =>
          row.grade && row.className
            ? `${row.grade}-${row.className}`
            : "unassigned",
        ),
      ).size,
    [grantedExemptionStudentRows],
  );

  const grantedExemptionGradeCount = useMemo(
    () =>
      new Set(
        grantedExemptionStudentRows
          .map((row) => row.grade || "unassigned")
          .filter(Boolean),
      ).size,
    [grantedExemptionStudentRows],
  );

  const resettableGrantedExemptionIds = useMemo(
    () =>
      grantedExemptionStudentRows.flatMap((row) =>
        row.items
          .filter((item) => {
            const status = String(item.status || "").trim() || "available";
            return status === "available" || status === "active";
          })
          .map((item) => item.id),
      ),
    [grantedExemptionStudentRows],
  );

  const grantedExemptionGradeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          grantedExemptionStudentRows.map((row) => row.grade).filter(Boolean),
        ),
      ).sort(compareSchoolValues),
    [grantedExemptionStudentRows],
  );

  const grantedExemptionClassOptions = useMemo(
    () =>
      Array.from(
        new Set(
          grantedExemptionStudentRows
            .filter(
              (row) =>
                !grantedExemptionGradeFilter ||
                row.grade === grantedExemptionGradeFilter,
            )
            .map((row) => row.className)
            .filter(Boolean),
        ),
      ).sort(compareSchoolValues),
    [grantedExemptionGradeFilter, grantedExemptionStudentRows],
  );

  const filteredGrantedExemptionRows = useMemo(() => {
    const keyword = grantedExemptionNameSearch
      .trim()
      .toLocaleLowerCase("ko-KR");
    return grantedExemptionStudentRows.filter((row) => {
      if (
        grantedExemptionGradeFilter &&
        row.grade !== grantedExemptionGradeFilter
      ) {
        return false;
      }
      if (
        grantedExemptionClassFilter &&
        row.className !== grantedExemptionClassFilter
      ) {
        return false;
      }
      if (
        keyword &&
        !row.studentName.toLocaleLowerCase("ko-KR").includes(keyword)
      ) {
        return false;
      }
      return true;
    });
  }, [
    grantedExemptionClassFilter,
    grantedExemptionGradeFilter,
    grantedExemptionNameSearch,
    grantedExemptionStudentRows,
  ]);

  const grantedExemptionPageCount = Math.max(
    1,
    Math.ceil(
      filteredGrantedExemptionRows.length / GRANTED_EXEMPTIONS_PER_PAGE,
    ),
  );
  const grantedExemptionCurrentPage = Math.min(
    grantedExemptionPage,
    grantedExemptionPageCount,
  );

  const pagedGrantedExemptionRows = useMemo(() => {
    const startIndex =
      (grantedExemptionCurrentPage - 1) * GRANTED_EXEMPTIONS_PER_PAGE;
    return filteredGrantedExemptionRows.slice(
      startIndex,
      startIndex + GRANTED_EXEMPTIONS_PER_PAGE,
    );
  }, [filteredGrantedExemptionRows, grantedExemptionCurrentPage]);

  useEffect(() => {
    setGrantedExemptionPage(1);
    setExpandedExemptionStudentKey("");
  }, [
    grantedExemptionClassFilter,
    grantedExemptionGradeFilter,
    grantedExemptionNameSearch,
    grantedExemptionStudentRows.length,
  ]);

  const editingAssignment = useMemo(
    () =>
      assignments.find((assignment) => assignment.id === editingAssignmentId) ||
      null,
    [assignments, editingAssignmentId],
  );

  const editingSelectedMap = useMemo(
    () =>
      worksheetSources.find((map) => map.id === editingMapResourceId) || null,
    [editingMapResourceId, worksheetSources],
  );

  const editingStudents = useMemo(
    () =>
      editingStudentUids
        .map((uid) => students.find((student) => student.uid === uid))
        .filter((student): student is StudentOption => !!student),
    [editingStudentUids, students],
  );

  const assignmentStudentsById = useMemo(() => {
    const resolved = new Map<string, StudentOption[]>();
    assignments.forEach((assignment) => {
      const matched = assignment.targetStudentUids.length
        ? assignment.targetStudentUids
            .map((uid) => studentByUid.get(uid))
            .filter((student): student is StudentOption => Boolean(student))
        : [];
      resolved.set(assignment.id, matched);
    });
    return resolved;
  }, [assignments, studentByUid]);

  const editingResults = useMemo(
    () => resultsByAssignment[editingAssignmentId] || [],
    [editingAssignmentId, resultsByAssignment],
  );

  const editingVisibleResults = useMemo(() => {
    const assignedUidSet = new Set(editingStudentUids);
    if (!assignedUidSet.size) return [];
    return editingResults.filter(
      (result) => result.uid && assignedUidSet.has(result.uid),
    );
  }, [editingResults, editingStudentUids]);

  const editingResultsByStudentUid = useMemo(() => {
    const grouped = new Map<string, HistoryClassroomResult[]>();
    editingVisibleResults.forEach((result) => {
      grouped.set(result.uid, [...(grouped.get(result.uid) || []), result]);
    });
    grouped.forEach((items) =>
      items.sort(
        (a, b) =>
          (getTimestampMs(b.createdAt) || 0) -
          (getTimestampMs(a.createdAt) || 0),
      ),
    );
    return grouped;
  }, [editingVisibleResults]);

  const assignmentAttemptMetaById = useMemo(() => {
    const resolved = new Map<
      string,
      {
        completed: number;
        pending: number;
        overdueAbsent: number;
        dueAtMs: number | null;
        remainingMs: number | null;
      }
    >();

    assignments.forEach((assignment) => {
      const assignedUids = getHistoryClassroomAssignedStudentUids(assignment);
      const assignedUidSet = new Set(assignedUids);
      const latestByStudentUid = new Map<string, HistoryClassroomResult>();
      (resultsByAssignment[assignment.id] || []).forEach((result) => {
        if (
          !result.uid ||
          !assignedUidSet.has(result.uid) ||
          latestByStudentUid.has(result.uid)
        ) {
          return;
        }
        latestByStudentUid.set(result.uid, result);
      });

      const attemptedCount = latestByStudentUid.size;
      const untouchedCount = Math.max(
        0,
        assignedUids.filter((uid) => !latestByStudentUid.has(uid)).length,
      );
      const pastDue = isHistoryClassroomPastDue(assignment);

      resolved.set(assignment.id, {
        completed: attemptedCount,
        pending: pastDue ? 0 : untouchedCount,
        overdueAbsent: pastDue ? untouchedCount : 0,
        dueAtMs: getHistoryClassroomDueAtMs(assignment),
        remainingMs: getHistoryClassroomRemainingMs(assignment),
      });
    });

    return resolved;
  }, [assignments, resultsByAssignment]);

  const editingLatestResultsByStudentUid = useMemo(() => {
    const latestByStudentUid = new Map<string, HistoryClassroomResult>();
    editingResults.forEach((result) => {
      if (!result.uid || latestByStudentUid.has(result.uid)) return;
      latestByStudentUid.set(result.uid, result);
    });
    return latestByStudentUid;
  }, [editingResults]);

  const editingPreviewAssignment = useMemo(() => {
    if (!editingAssignment) return null;

    const resolvedDueWindowDays =
      resolveDueWindowDaysValue(editingDueWindowDays);
    const mapChanged =
      !!editingSelectedMap &&
      (editingRefreshSource ||
        editingSelectedMap.id !==
          getHistoryClassroomSourceId(editingAssignment));
    const previewBlanks = mapChanged
      ? cloneMapResourceBlanks(editingSelectedMap)
      : editingAssignment.blanks;
    const publishWindow = buildHistoryClassroomPublishWindow({
      dueWindowDays: resolvedDueWindowDays,
      isPublished: editingIsPublished,
      previousIsPublished: editingAssignment.isPublished,
      previousPublishedAt:
        editingAssignment.publishedAt ||
        editingAssignment.createdAt ||
        editingAssignment.updatedAt,
    });

    const previewAssignment = normalizeHistoryClassroomAssignment(
      editingAssignment.id,
      {
        ...editingAssignment,
        title: mapChanged ? editingSelectedMap!.title : editingAssignment.title,
        description: "",
        ...(mapChanged
          ? getHistoryClassroomSourceFields(editingSelectedMap!)
          : {}),
        pdfPageImages: mapChanged
          ? editingSelectedMap!.pdfPageImages
          : editingAssignment.pdfPageImages,
        pdfRegions: mapChanged
          ? editingSelectedMap!.pdfRegions
          : editingAssignment.pdfRegions,
        blanks: previewBlanks,
        answerOptions: buildAnswerOptions(previewBlanks),
        targetStudentReasons: pickStudentReasons(
          editingStudentReasons,
          editingStudentUids,
        ),
        targetGrade: editingStudents[0]?.grade || "",
        targetClass: editingStudents[0]?.className || "",
        targetStudentUid: editingStudents[0]?.uid || "",
        targetStudentUids: editingStudents.map((student) => student.uid),
        targetStudentAccessMap: Object.fromEntries(
          editingStudents.map((student) => [student.uid, true]),
        ),
        targetStudentName: editingStudents
          .map((student) => student.name)
          .join(", "),
        targetStudentNames: editingStudents.map((student) => student.name),
        targetStudentNumber: editingStudents
          .map((student) => student.number)
          .filter(Boolean)
          .join(", "),
        timeLimitMinutes: Math.max(0, editingTimeLimitMinutes),
        cooldownMinutes: Math.max(0, editingCooldownMinutes),
        dueWindowDays: resolvedDueWindowDays,
        passThresholdPercent: Math.min(
          100,
          Math.max(0, editingPassThresholdPercent),
        ),
        isPublished: editingIsPublished,
        publishedAt: publishWindow.publishedAt || null,
        dueAt: publishWindow.dueAt || null,
      },
    );

    return previewAssignment;
  }, [
    editingAssignment,
    editingCooldownMinutes,
    editingDueWindowDays,
    editingIsPublished,
    editingPassThresholdPercent,
    editingSelectedMap,
    editingRefreshSource,
    editingStudents,
    editingStudentReasons,
    editingStudentUids,
    editingTimeLimitMinutes,
  ]);

  const reviewResult = useMemo(
    () =>
      editingVisibleResults.find((result) => result.id === reviewResultId) ||
      null,
    [editingVisibleResults, reviewResultId],
  );

  const reviewAnswerChecks = useMemo(() => {
    if (!editingPreviewAssignment || !reviewResult) return [];
    if (reviewResult.answerChecks.length) return reviewResult.answerChecks;
    return summarizeHistoryClassroomAnswers(
      editingPreviewAssignment,
      reviewResult.answers,
    ).checks;
  }, [editingPreviewAssignment, reviewResult]);

  useEffect(() => {
    if (!reviewResult || !editingPreviewAssignment) return;
    setReviewCurrentPage(
      editingPreviewAssignment.pdfPageImages?.[0]?.page || 1,
    );
  }, [editingPreviewAssignment, reviewResult]);

  const editingAttemptStatusRows = useMemo(() => {
    if (!editingPreviewAssignment) return [];

    const remainingMs = getHistoryClassroomRemainingMs(
      editingPreviewAssignment,
    );
    const pastDue =
      editingPreviewAssignment.isPublished &&
      isHistoryClassroomPastDue(editingPreviewAssignment);

    return editingStudents.map((student) => {
      const studentResults = editingResultsByStudentUid.get(student.uid) || [];
      if (
        appliedExemptionKeys.includes(
          `${editingPreviewAssignment.id}:${student.uid}`,
        ) ||
        studentResults.some((result) => result.completionSource === "exemption")
      ) {
        return {
          student,
          statusKey: "completed" as const,
          statusLabel: "면제 완료",
          detailLabel: "면제권 1장 사용",
          toneClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
          canResetAttempt: false,
        };
      }
      const latestResult =
        studentResults.find(
          (result) => result.status === "passed" || result.passed,
        ) || editingLatestResultsByStudentUid.get(student.uid);
      if (latestResult) {
        const resetAtMs = getHistoryClassroomStudentRetryResetMs(
          editingPreviewAssignment,
          student.uid,
        );
        const latestCreatedAtMs = getTimestampMs(latestResult.createdAt);
        const isResetAfterLatest =
          latestResult.status !== "passed" &&
          !!resetAtMs &&
          (!latestCreatedAtMs || latestCreatedAtMs <= resetAtMs);
        if (isResetAfterLatest) {
          return {
            student,
            statusKey: "pending" as const,
            statusLabel: "대기 해제",
            detailLabel: `${latestResult.percent}% · ${describeHistoryResultStatus(latestResult.status)}`,
            toneClassName: "border-blue-200 bg-blue-50 text-blue-700",
            canResetAttempt: true,
          };
        }

        return {
          student,
          statusKey: "completed" as const,
          statusLabel:
            latestResult.status === "cancelled" ? "자동 종료" : "응시 완료",
          detailLabel:
            latestResult.status === "cancelled"
              ? "창 전환 또는 이탈로 자동 종료되었습니다."
              : `${latestResult.percent}% · ${describeHistoryResultStatus(latestResult.status)}`,
          toneClassName:
            latestResult.status === "cancelled"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700",
          canResetAttempt: latestResult.status !== "passed",
        };
      }

      if (pastDue) {
        return {
          student,
          statusKey: "overdueAbsent" as const,
          statusLabel: "미응시",
          detailLabel: "응시 기간이 지나 미응시로 처리됩니다.",
          toneClassName: "border-rose-200 bg-rose-50 text-rose-700",
          canResetAttempt: true,
        };
      }

      return {
        student,
        statusKey: "pending" as const,
        statusLabel: "응시 전",
        detailLabel: !editingPreviewAssignment.isPublished
          ? "아직 학생에게 공개되지 않았습니다."
          : remainingMs
            ? `응시 마감까지 ${formatHistoryClassroomRemainingWindow(remainingMs)}`
            : "아직 시작하지 않았습니다.",
        toneClassName: "border-slate-200 bg-slate-50 text-slate-700",
        canResetAttempt: true,
      };
    });
  }, [
    appliedExemptionKeys,
    editingLatestResultsByStudentUid,
    editingResultsByStudentUid,
    editingPreviewAssignment,
    editingStudents,
  ]);

  const editingAttemptStatusCounts = useMemo(
    () =>
      editingAttemptStatusRows.reduce(
        (accumulator, row) => {
          if (row.statusKey === "completed") {
            accumulator.completed += 1;
          } else if (row.statusKey === "overdueAbsent") {
            accumulator.overdueAbsent += 1;
          } else {
            accumulator.pending += 1;
          }
          return accumulator;
        },
        { completed: 0, pending: 0, overdueAbsent: 0 },
      ),
    [editingAttemptStatusRows],
  );

  const previewDueStatusMeta = useMemo(() => {
    if (!editingPreviewAssignment) return null;
    const dueAtMs = getHistoryClassroomDueAtMs(editingPreviewAssignment);
    const remainingMs = getHistoryClassroomRemainingMs(
      editingPreviewAssignment,
    );
    if (!dueAtMs || remainingMs == null) return null;

    return {
      label:
        remainingMs > 0
          ? `응시 마감까지 ${formatHistoryClassroomRemainingWindow(remainingMs)}`
          : "응시 기간 마감",
      detailLabel: `응시 마감 ${formatDeadlineLabel(dueAtMs)}`,
      tone: remainingMs > 0 ? ("amber" as const) : ("rose" as const),
    };
  }, [editingPreviewAssignment]);

  const classroomDashboard = useMemo(() => {
    const totals = assignments.reduce(
      (accumulator, assignment) => {
        const assignedUids = getHistoryClassroomAssignedStudentUids(assignment);
        const assignedUidSet = new Set(assignedUids);
        const assignedCount = assignedUids.length;
        const attemptMeta = assignmentAttemptMetaById.get(assignment.id);
        const latestByStudentUid = new Map<string, HistoryClassroomResult>();
        (resultsByAssignment[assignment.id] || []).forEach((result) => {
          if (
            !result.uid ||
            !assignedUidSet.has(result.uid) ||
            latestByStudentUid.has(result.uid)
          ) {
            return;
          }
          latestByStudentUid.set(result.uid, result);
        });

        accumulator.assigned += assignedCount;
        accumulator.submitted += attemptMeta?.completed || 0;
        accumulator.pending += attemptMeta?.pending || 0;
        accumulator.overdueAbsent += attemptMeta?.overdueAbsent || 0;
        latestByStudentUid.forEach((result) => {
          if (result.status === "passed") accumulator.passed += 1;
          if (result.status === "failed") accumulator.failed += 1;
          if (result.status === "cancelled") accumulator.cancelled += 1;
        });
        return accumulator;
      },
      {
        assigned: 0,
        submitted: 0,
        passed: 0,
        failed: 0,
        cancelled: 0,
        pending: 0,
        overdueAbsent: 0,
      },
    );

    const published = assignments.filter(
      (assignment) => assignment.isPublished,
    ).length;

    return {
      ...totals,
      totalAssignments: assignments.length,
      published,
      privateCount: assignments.length - published,
    };
  }, [assignmentAttemptMetaById, assignments, resultsByAssignment]);

  const assignmentRows = useMemo(
    () =>
      assignments.map((assignment) => {
        const attemptMeta = assignmentAttemptMetaById.get(assignment.id);
        const assignedUids = getHistoryClassroomAssignedStudentUids(assignment);
        const assignedUidSet = new Set(assignedUids);
        const latestByStudentUid = new Map<string, HistoryClassroomResult>();
        const assignmentResults = resultsByAssignment[assignment.id] || [];
        assignmentResults.forEach((result) => {
          if (
            !result.uid ||
            !assignedUidSet.has(result.uid) ||
            latestByStudentUid.has(result.uid)
          ) {
            return;
          }
          latestByStudentUid.set(result.uid, result);
        });
        const statusCounts = {
          passed: 0,
          failed: 0,
          cancelled: 0,
        };
        latestByStudentUid.forEach((result) => {
          if (result.status === "passed") statusCounts.passed += 1;
          if (result.status === "failed") statusCounts.failed += 1;
          if (result.status === "cancelled") statusCounts.cancelled += 1;
        });
        const isPastDue = isHistoryClassroomPastDue(assignment);
        const studentSummaries = assignedUids.map((uid, index) => {
          const student = studentByUid.get(uid);
          const attempts = assignmentResults
            .filter((result) => result.uid === uid)
            .sort(
              (a, b) =>
                (getTimestampMs(a.createdAt) || 0) -
                (getTimestampMs(b.createdAt) || 0),
            );
          const latest = attempts[attempts.length - 1] || null;
          const fallbackName =
            assignment.targetStudentNames[index] ||
            assignment.targetStudentName ||
            "학생";
          const reason = String(
            assignment.targetStudentReasons?.[uid] || "",
          ).trim();
          return {
            uid,
            name: student?.name || fallbackName,
            classLabel: student ? formatClassGroupLabel(student) : "",
            number: student?.number || "",
            reason,
            status: latest?.status || null,
            statusLabel: latest
              ? describeHistoryResultStatus(latest.status)
              : isPastDue
                ? "마감 미제출"
                : "미제출",
            attemptLabel: latest
              ? `${attempts.length}번째 · ${Math.round(latest.percent)}%`
              : "시도 없음",
          };
        });
        const statusGroups = {
          passed: studentSummaries.filter(
            (student) => student.status === "passed",
          ),
          failed: studentSummaries.filter(
            (student) => student.status === "failed",
          ),
          pending: studentSummaries.filter((student) => !student.status),
          cancelled: studentSummaries.filter(
            (student) => student.status === "cancelled",
          ),
        };
        const sortMs = getAssignmentSortMs(assignment);
        const studentNames = studentSummaries
          .map((student) => student.name)
          .filter(Boolean);

        return {
          assignment,
          assignedCount: assignedUids.length,
          submittedCount: attemptMeta?.completed || 0,
          pendingCount: attemptMeta?.pending || 0,
          overdueAbsentCount: attemptMeta?.overdueAbsent || 0,
          dueAtMs: attemptMeta?.dueAtMs || null,
          sortMs,
          dateKey: formatAssignmentDateKey(sortMs),
          dateLabel: formatAssignmentDateLabel(sortMs),
          timelineDate: formatAssignmentTimelineDate(sortMs),
          studentNamesLabel: studentNames.length
            ? `${studentNames.slice(0, 3).join(", ")}${
                studentNames.length > 3
                  ? ` 외 ${studentNames.length - 3}명`
                  : ""
              }`
            : "배정 학생 없음",
          studentSummaries,
          statusGroups,
          ...statusCounts,
        };
      }),
    [assignmentAttemptMetaById, assignments, resultsByAssignment, studentByUid],
  );

  const filteredAssignmentRows = useMemo(() => {
    const keyword = dashboardSearch.trim().toLocaleLowerCase("ko-KR");
    return assignmentRows.filter((row) => {
      if (dashboardStatusFilter === "published" && !row.assignment.isPublished)
        return false;
      if (dashboardStatusFilter === "private" && row.assignment.isPublished)
        return false;
      if (
        dashboardStatusFilter === "pending" &&
        row.pendingCount + row.overdueAbsentCount <= 0
      ) {
        return false;
      }
      if (dashboardStatusFilter === "passed" && row.passed <= 0) return false;
      if (!keyword) return true;

      const searchable = [
        row.assignment.title,
        row.assignment.mapTitle,
        row.assignment.description,
        row.dateLabel,
        ...row.studentSummaries.flatMap((student) => [
          student.name,
          student.classLabel,
          student.number,
          student.reason,
          student.statusLabel,
          student.attemptLabel,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ko-KR");
      return searchable.includes(keyword);
    });
  }, [assignmentRows, dashboardSearch, dashboardStatusFilter]);

  const sortedAssignmentRows = useMemo(
    () =>
      [...filteredAssignmentRows].sort((a, b) =>
        dashboardSortOrder === "latest"
          ? b.sortMs - a.sortMs
          : a.sortMs - b.sortMs,
      ),
    [dashboardSortOrder, filteredAssignmentRows],
  );

  const dashboardDateRangeLabel = useMemo(() => {
    const timestamps = filteredAssignmentRows
      .map((row) => row.sortMs)
      .filter((value) => value > 0);
    if (!timestamps.length) return "날짜 전체";
    const start = Math.min(...timestamps);
    const end = Math.max(...timestamps);
    const format = (timestampMs: number) =>
      new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .format(new Date(timestampMs))
        .replace(/\.\s?/g, ".")
        .replace(/\.$/, "");
    return `${format(start)} ~ ${format(end)}`;
  }, [filteredAssignmentRows]);

  const totalAssignmentPages = Math.max(
    1,
    Math.ceil(sortedAssignmentRows.length / ASSIGNMENTS_PER_PAGE),
  );
  const pagedAssignmentRows = useMemo(
    () =>
      sortedAssignmentRows.slice(
        (assignmentPage - 1) * ASSIGNMENTS_PER_PAGE,
        assignmentPage * ASSIGNMENTS_PER_PAGE,
      ),
    [assignmentPage, sortedAssignmentRows],
  );

  const pagedAssignmentGroups = useMemo(() => {
    const grouped = new Map<string, typeof pagedAssignmentRows>();
    pagedAssignmentRows.forEach((row) => {
      grouped.set(row.dateKey, [...(grouped.get(row.dateKey) || []), row]);
    });
    return Array.from(grouped.entries()).map(([dateKey, rows]) => ({
      dateKey,
      timelineDate: rows[0]?.timelineDate || { date: "날짜 미정", weekday: "" },
      rows,
    }));
  }, [pagedAssignmentRows]);

  useEffect(() => {
    setAssignmentPage((current) => Math.min(current, totalAssignmentPages));
  }, [totalAssignmentPages]);

  useEffect(() => {
    setAssignmentPage(1);
  }, [dashboardSearch, dashboardStatusFilter, dashboardSortOrder]);

  useEffect(() => {
    if (
      expandedAssignmentId &&
      !pagedAssignmentRows.some(
        (row) => row.assignment.id === expandedAssignmentId,
      )
    ) {
      setExpandedAssignmentId("");
    }
  }, [expandedAssignmentId, pagedAssignmentRows]);

  const resetWorksheetDraft = () => {
    setWorksheetEditingAssignmentId("");
    setWorksheetEditingIsPublished(true);
    setWorksheetImportSourceId("");
    setWorksheetImportSourceTitle("");
    setWorksheetSourceAssignment(null);
    setTitle("");
    setDescription("");
    setTimeLimitMinutes(NEW_ASSIGNMENT_DEFAULTS.timeLimitMinutes);
    setCooldownMinutes(NEW_ASSIGNMENT_DEFAULTS.cooldownMinutes);
    setDueWindowDays("");
    setPassThresholdPercent(NEW_ASSIGNMENT_DEFAULTS.passThresholdPercent);
    setTargetGrade(NEW_ASSIGNMENT_DEFAULTS.targetGrade);
    setTargetClass(NEW_ASSIGNMENT_DEFAULTS.targetClass);
    setSelectedStudentUids([]);
    setStudentReasons({});
    setOtherReasonUids([]);
    setShowReasonErrors(false);
    setNewStudentReason("");
    setNewStudentReasonOther(false);
    setNewStudentReasonError(false);
    setSelectedBlankId("");
    setDraftBlank(null);
    setDraftBlankAnswer("");
    setBlankEditorMode(null);
    setBlankEditorAnswer("");
    setBlankEditorError("");
    blankEditorComposingRef.current = false;
    setShowAllBlankTags(false);
    setFloatingPanelOpen(false);
    if (worksheetSources[0]) {
      setSelectedMapId(worksheetSources[0].id);
      setBlanks(cloneMapResourceBlanks(worksheetSources[0]));
    } else {
      setBlanks([]);
    }
  };

  const openCreateModal = () => {
    resetWorksheetDraft();
    setIsCreateModalOpen(true);
  };

  const selectedBlank = useMemo<any>(
    () => blanks.find((blank) => blank.id === selectedBlankId) || null,
    [blanks, selectedBlankId],
  );
  const activeBlankEditor =
    blankEditorMode === "create"
      ? draftBlank
      : blankEditorMode === "edit"
        ? selectedBlank
        : null;

  useEffect(() => {
    if (!previewOpen || !editingPreviewAssignment) return;
    setPreviewCurrentPage(
      editingPreviewAssignment.pdfPageImages?.[0]?.page || 1,
    );
    setPreviewAnswers({});
  }, [editingPreviewAssignment, previewOpen]);

  useEffect(() => {
    if (sortedBlanks.length <= 6 && showAllBlankTags) {
      setShowAllBlankTags(false);
    }
  }, [showAllBlankTags, sortedBlanks.length]);

  const handleCreateBlankFromSelection = (
    page: number,
    rect: {
      leftRatio: number;
      topRatio: number;
      widthRatio: number;
      heightRatio: number;
    },
    matchedRegions: LessonWorksheetTextRegion[],
    source: "ocr" | "manual",
  ) => {
    const pageImage =
      worksheetPageImages.find((item) => item.page === page) || null;
    const regionBounds = getBoundsFromRegions(matchedRegions, pageImage);
    const initialAnswer = getBlankAnswerFromRegions(matchedRegions);
    const blank = createWorksheetBlankFromRect(
      page,
      regionBounds || rect,
      matchedRegions.length ? "ocr" : source,
    );
    setDraftBlank(blank);
    setDraftBlankAnswer(initialAnswer);
    setSelectedBlankId("");
    setBlankEditorMode("create");
    setBlankEditorAnswer(initialAnswer);
    setBlankEditorError("");
    blankEditorComposingRef.current = false;
    setFloatingPanelOpen(false);
  };

  const closeBlankEditor = () => {
    setBlankEditorMode(null);
    setBlankEditorAnswer("");
    setBlankEditorError("");
    blankEditorComposingRef.current = false;
  };

  const closeExemptionPanel = () => {
    setExemptionPanelOpen(false);
    setHighlightedExemptionRequestId("");
    if (searchParams.get("panel") === "exemption-requests") {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("panel");
      nextParams.delete("requestId");
      setSearchParams(nextParams, { replace: true });
    }
  };

  const openExemptionPanel = (tab: ExemptionModalTab = "grant") => {
    const nextTab =
      tab === "requests" || tab === "granted" || tab === "grant"
        ? tab
        : "grant";
    setExemptionModalTab(nextTab);
    setExemptionPanelOpen(true);
    void loadExemptionData();
  };

  const handleGrantExemptions = async () => {
    if (grantingExemptionRef.current) return;
    const reason = exemptionReason.trim();
    const targetStudents =
      exemptionGrantMode === "class"
        ? activeExemptionClassStudents
        : exemptionSelectedStudents;

    if (
      exemptionGrantMode === "class" &&
      (!exemptionTargetGrade || !exemptionTargetClass)
    ) {
      alert("학급 단위 부여는 학년과 반을 모두 선택해 주세요.");
      return;
    }

    if (!targetStudents.length) {
      alert(
        exemptionGrantMode === "class"
          ? "면제권을 부여할 학급을 선택해 주세요."
          : "면제권을 부여할 학생을 선택해 주세요.",
      );
      return;
    }
    if (!reason) {
      alert("면제권 부여 사유를 입력해 주세요.");
      return;
    }

    grantingExemptionRef.current = true;
    setGrantingExemption(true);
    try {
      const result = await grantHistoryClassroomExemptions(config, {
        reason,
        recipientUids: targetStudents.map((student) => student.uid),
        classId:
          exemptionGrantMode === "class"
            ? `${exemptionTargetGrade}-${exemptionTargetClass}`
            : "",
        targetGrade: exemptionGrantMode === "class" ? exemptionTargetGrade : "",
        targetClass: exemptionGrantMode === "class" ? exemptionTargetClass : "",
      });
      setExemptionStudentSearch("");
      setExemptionSelectedStudentUids([]);
      setExemptionReason("");
      await loadExemptionData();
      alert(`${result.createdCount}명에게 면제권을 부여했습니다.`);
    } catch (error) {
      console.error("Failed to grant history classroom exemptions:", error);
      alert(
        getHistoryClassroomErrorMessage(error, "면제권 부여에 실패했습니다."),
      );
    } finally {
      grantingExemptionRef.current = false;
      setGrantingExemption(false);
    }
  };

  const handleReviewExemptionRequest = async (
    requestId: string,
    status: "approved" | "rejected",
  ) => {
    setReviewingExemptionRequestId(requestId);
    try {
      await reviewHistoryClassroomExemptionRequest(config, {
        requestId,
        approved: status === "approved",
      });
      await loadExemptionData();
    } catch (error) {
      console.error("Failed to review history classroom exemption request:", {
        requestId,
        status,
        error,
      });
      alert(
        getHistoryClassroomErrorMessage(
          error,
          "면제권 사용 요청 처리에 실패했습니다.",
        ),
      );
    } finally {
      setReviewingExemptionRequestId("");
    }
  };

  const handleRevokeExemptions = async (row: ExemptionStudentSummary) => {
    const revocableItems = row.items.filter((item) => {
      const status = String(item.status || "").trim() || "available";
      return status === "available" || status === "active";
    });
    if (!revocableItems.length) {
      alert("회수할 수 있는 보유 면제권이 없습니다.");
      return;
    }

    let revokeCount = 1;
    if (revocableItems.length > 1) {
      const input = window.prompt(
        `${row.studentName} 학생의 면제권 ${revocableItems.length}개 중 몇 개를 회수할까요?`,
        "1",
      );
      if (input === null) return;
      const parsed = Math.floor(Number(input));
      if (
        !Number.isFinite(parsed) ||
        parsed < 1 ||
        parsed > revocableItems.length
      ) {
        alert(`1부터 ${revocableItems.length} 사이의 숫자를 입력해 주세요.`);
        return;
      }
      revokeCount = parsed;
    }

    const message =
      revokeCount === revocableItems.length
        ? `${row.studentName} 학생의 보유 면제권 ${revokeCount}개를 모두 회수할까요?`
        : `${row.studentName} 학생의 보유 면제권 ${revokeCount}개를 회수할까요?`;
    if (!window.confirm(message)) return;

    setRevokingExemptionStudentKey(row.key);
    try {
      await revokeHistoryClassroomExemptions(
        config,
        revocableItems.slice(0, revokeCount).map((item) => item.id),
      );
      setExpandedExemptionStudentKey("");
      await loadExemptionData();
    } catch (error) {
      console.error("Failed to revoke history classroom exemptions:", {
        row,
        error,
      });
      alert(
        getHistoryClassroomErrorMessage(error, "면제권 회수에 실패했습니다."),
      );
    } finally {
      setRevokingExemptionStudentKey("");
    }
  };

  const handleResetGrantedExemptions = async () => {
    if (!resettableGrantedExemptionIds.length) {
      alert("초기화할 수 있는 보유 면제권이 없습니다.");
      return;
    }

    const studentCount = grantedExemptionStudentRows.filter(
      (row) => row.availableCount > 0,
    ).length;
    const confirmed = window.confirm(
      `현재 부여되어 보유 중인 면제권 ${resettableGrantedExemptionIds.length}개를 모두 회수할까요?\n대상 학생 ${studentCount}명의 보유 면제권이 초기화됩니다.`,
    );
    if (!confirmed) return;

    setResettingGrantedExemptions(true);
    try {
      for (
        let index = 0;
        index < resettableGrantedExemptionIds.length;
        index += 50
      ) {
        await revokeHistoryClassroomExemptions(
          config,
          resettableGrantedExemptionIds.slice(index, index + 50),
        );
      }
      setExpandedExemptionStudentKey("");
      await loadExemptionData();
    } catch (error) {
      console.error("Failed to reset history classroom exemptions:", error);
      await loadExemptionData();
      alert(
        getHistoryClassroomErrorMessage(
          error,
          "면제권 부여 초기화에 실패했습니다.",
        ),
      );
    } finally {
      setResettingGrantedExemptions(false);
    }
  };

  const handleConfirmDraftBlank = () => {
    if (!draftBlank) return;

    const answer = blankEditorAnswer.trim();
    if (!answer) {
      setBlankEditorError("빈칸 정답을 입력해 주세요.");
      return;
    }

    const pageImage =
      worksheetPageImages.find((item) => item.page === draftBlank.page) || null;
    const nextBlank = worksheetBlankToHistoryBlank(
      { ...draftBlank, answer },
      pageImage,
    );
    if (!nextBlank) return;

    setBlanks((prev) => [...prev, nextBlank]);
    setSelectedBlankId(nextBlank.id);
    setDraftBlank(null);
    setDraftBlankAnswer("");
    closeBlankEditor();
    setFloatingPanelOpen(true);
  };

  const handleCancelDraftBlank = () => {
    setDraftBlank(null);
    setDraftBlankAnswer("");
    closeBlankEditor();
    setFloatingPanelOpen(true);
  };

  const handleSelectBlank = (blankId: string) => {
    const targetBlank = blanks.find((blank) => blank.id === blankId);
    if (!targetBlank) return;
    setSelectedBlankId(blankId);
    setDraftBlank(null);
    setDraftBlankAnswer("");
    setBlankEditorMode("edit");
    setBlankEditorAnswer(targetBlank.answer);
    setBlankEditorError("");
    blankEditorComposingRef.current = false;
  };

  const handleFocusBlankFromList = (blankId: string) => {
    const targetBlank = blanks.find((blank) => blank.id === blankId);
    if (!targetBlank) return;
    setSelectedBlankId(blankId);
    setDraftBlank(null);
    setDraftBlankAnswer("");
    closeBlankEditor();
  };

  const handleBlankChange = (blankId: string, answer: string) => {
    setBlanks((prev) =>
      prev.map((blank) =>
        blank.id === blankId ? { ...blank, answer } : blank,
      ),
    );
  };

  const removeBlank = (blankId: string) => {
    setBlanks((prev) => prev.filter((blank) => blank.id !== blankId));
    if (selectedBlankId === blankId) {
      setSelectedBlankId("");
      closeBlankEditor();
    }
  };

  const handleSaveSelectedBlank = () => {
    if (!selectedBlank) return;

    const answer = blankEditorAnswer.trim();
    if (!answer) {
      setBlankEditorError("빈칸 정답을 입력해 주세요.");
      return;
    }

    handleBlankChange(selectedBlank.id, answer);
    closeBlankEditor();
    setFloatingPanelOpen(true);
  };

  const handleSubmitBlankEditor = () => {
    if (blankEditorCommitLockRef.current) return;

    blankEditorCommitLockRef.current = true;
    try {
      if (blankEditorMode === "create") {
        handleConfirmDraftBlank();
      } else if (blankEditorMode === "edit") {
        handleSaveSelectedBlank();
      }
    } finally {
      window.requestAnimationFrame(() => {
        blankEditorCommitLockRef.current = false;
      });
    }
  };

  const handleBlankEditorKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing || blankEditorComposingRef.current)
      return;
    event.preventDefault();
    handleSubmitBlankEditor();
  };

  const openAssignmentEditor = (assignment: HistoryClassroomAssignment) => {
    editingSourceRefreshRef.current += 1;
    setRefreshingEditingSource(false);
    setEditingAssignmentId(assignment.id);
    setEditingMapResourceId(getHistoryClassroomSourceId(assignment));
    setEditingRefreshSource(false);
    setEditingTitle(assignment.title);
    setEditingDescription(assignment.description);
    setEditingTimeLimitMinutes(assignment.timeLimitMinutes);
    setEditingCooldownMinutes(assignment.cooldownMinutes);
    setEditingDueWindowDays(assignment.dueWindowDays || "");
    setEditingPassThresholdPercent(assignment.passThresholdPercent);
    setEditingStudentUids(
      assignment.targetStudentUids.length
        ? assignment.targetStudentUids
        : assignment.targetStudentUid
          ? [assignment.targetStudentUid]
          : [],
    );
    setEditingStudentSearchOpen(false);
    setEditingStudentReasons(assignment.targetStudentReasons || {});
    setEditingOtherReasonUids([]);
    setShowEditingReasonErrors(false);
    setEditingNewStudentReason("");
    setEditingNewStudentReasonOther(false);
    setEditingNewStudentReasonError(false);
    setEditingIsPublished(assignment.isPublished);
    setPreviewOpen(false);
  };

  const loadAssignmentIntoWorksheetEditor = (
    assignment: HistoryClassroomAssignment,
    mode: "edit" | "clone" = "edit",
  ) => {
    if (assignment.sourceType !== "lesson") {
      alert(
        "기존 지도 과제는 설정에서 관리할 수 있습니다. 새 과제에는 수업 자료를 선택해 주세요.",
      );
      return;
    }
    preserveBlankResetRef.current = true;
    setSelectedMapId(getHistoryClassroomSourceId(assignment));
    setWorksheetSourceAssignment(assignment);
    setWorksheetEditingAssignmentId(mode === "edit" ? assignment.id : "");
    setWorksheetEditingIsPublished(
      mode === "edit" ? assignment.isPublished : true,
    );
    setTitle(assignment.title);
    setDescription(assignment.description);
    setTimeLimitMinutes(assignment.timeLimitMinutes);
    setCooldownMinutes(assignment.cooldownMinutes);
    setDueWindowDays(assignment.dueWindowDays || "");
    setPassThresholdPercent(assignment.passThresholdPercent);
    setTargetGrade(assignment.targetGrade);
    setTargetClass(assignment.targetClass);
    setSelectedStudentUids(
      assignment.targetStudentUids.length
        ? assignment.targetStudentUids
        : assignment.targetStudentUid
          ? [assignment.targetStudentUid]
          : [],
    );
    setStudentReasons(assignment.targetStudentReasons || {});
    setOtherReasonUids([]);
    setShowReasonErrors(false);
    setNewStudentReason("");
    setNewStudentReasonOther(false);
    setNewStudentReasonError(false);
    setBlanks(assignment.blanks);
    setSelectedBlankId("");
    setDraftBlank(null);
    setDraftBlankAnswer("");
    setBlankEditorMode(null);
    setBlankEditorAnswer("");
    blankEditorComposingRef.current = false;
    setShowAllBlankTags(false);
    setWorksheetImportSourceTitle(mode === "clone" ? assignment.title : "");
    setWorksheetImportSourceId(mode === "clone" ? assignment.id : "");
    closeAssignmentEditor();
    setIsCreateModalOpen(true);
  };

  const handleImportAssignmentToDraft = () => {
    const sourceAssignment = assignments.find(
      (assignment) => assignment.id === worksheetImportSourceId,
    );
    if (!sourceAssignment) return;
    loadAssignmentIntoWorksheetEditor(sourceAssignment, "clone");
  };

  const closeAssignmentEditor = () => {
    editingSourceRefreshRef.current += 1;
    setRefreshingEditingSource(false);
    setEditingAssignmentId("");
    setEditingMapResourceId("");
    setEditingRefreshSource(false);
    setEditingTitle("");
    setEditingDescription("");
    setEditingTimeLimitMinutes(0);
    setEditingCooldownMinutes(0);
    setEditingDueWindowDays("");
    setEditingPassThresholdPercent(80);
    setEditingStudentUids([]);
    setEditingStudentSearchOpen(false);
    setEditingStudentReasons({});
    setEditingOtherReasonUids([]);
    setShowEditingReasonErrors(false);
    setEditingNewStudentReason("");
    setEditingNewStudentReasonOther(false);
    setEditingNewStudentReasonError(false);
    setEditingIsPublished(true);
    setSavingEdit(false);
    setDeletingAssignment(false);
    setResettingAttemptUid("");
    setAttemptResetFeedback({});
    setExpandedAttemptUids([]);
    setPreviewOpen(false);
    setPreviewCurrentPage(1);
    setPreviewAnswers({});
    setReviewResultId("");
    setReviewCurrentPage(1);
  };

  const handleRefreshEditingLesson = async () => {
    if (!editingAssignment || !editingMapResourceId.startsWith("lesson:"))
      return;
    const sourceId = editingMapResourceId;
    const requestId = ++editingSourceRefreshRef.current;
    setRefreshingEditingSource(true);
    try {
      const sources = await readHistoryClassroomLessonSources(config, true);
      if (requestId !== editingSourceRefreshRef.current) return;
      const source = sources.find((item) => item.id === sourceId);
      if (
        !source ||
        !source.pdfBlanks?.length ||
        source.pdfBlanks.some((blank) => !blank.answer.trim())
      ) {
        alert("수업 자료에 저장된 학습지와 빈칸 정답을 먼저 확인해 주세요.");
        return;
      }
      setLessonSources(sources);
      setEditingRefreshSource(true);
    } catch (error) {
      console.error(
        "Failed to refresh history classroom lesson snapshot:",
        error,
      );
      if (requestId === editingSourceRefreshRef.current) {
        alert("최신 수업 자료를 불러오지 못했습니다. 다시 시도해 주세요.");
      }
    } finally {
      if (requestId === editingSourceRefreshRef.current)
        setRefreshingEditingSource(false);
    }
  };

  const handleSaveAssignmentEdit = async () => {
    if (
      savingEditRef.current ||
      resettingAttemptRef.current ||
      applyingExemptionRef.current ||
      refreshingEditingSource
    )
      return;
    const targetAssignment = assignments.find(
      (assignment) => assignment.id === editingAssignmentId,
    );
    if (!targetAssignment) return;
    const updatedStudents = students.filter((student) =>
      editingStudentUids.includes(student.uid),
    );
    if (!updatedStudents.length) {
      alert("배정 학생을 확인해주세요.");
      return;
    }
    const missingReasonUid = editingStudentUids.find(
      (uid) =>
        editingOtherReasonUids.includes(uid) &&
        !String(editingStudentReasons[uid] || "").trim(),
    );
    if (missingReasonUid) {
      setShowEditingReasonErrors(true);
      window.requestAnimationFrame(() => {
        const input = document.getElementById(
          `history-edit-reason-${missingReasonUid}-other`,
        );
        input?.focus({ preventScroll: true });
        input?.closest("label")?.scrollIntoView({ block: "center" });
      });
      return;
    }
    const replacementMap = worksheetSources.find(
      (map) => map.id === editingMapResourceId,
    );
    const mapChanged =
      !!replacementMap &&
      (editingRefreshSource ||
        replacementMap.id !== getHistoryClassroomSourceId(targetAssignment));
    if (
      editingMapResourceId !== getHistoryClassroomSourceId(targetAssignment) &&
      !replacementMap
    ) {
      alert("교체할 자료를 찾을 수 없습니다. 자료를 다시 선택해 주세요.");
      return;
    }
    const nextBlanks = mapChanged
      ? cloneMapResourceBlanks(replacementMap)
      : targetAssignment.blanks;
    if (
      mapChanged &&
      (!nextBlanks.length ||
        nextBlanks.some((blank) => !String(blank.answer || "").trim()))
    ) {
      alert("교체할 자료에 저장된 빈칸과 정답을 먼저 확인해 주세요.");
      return;
    }

    savingEditRef.current = true;
    setSavingEdit(true);
    try {
      const resolvedDueWindowDays =
        resolveDueWindowDaysValue(editingDueWindowDays);
      const publishWindow = buildHistoryClassroomPublishWindow({
        dueWindowDays: resolvedDueWindowDays,
        isPublished: editingIsPublished,
        previousIsPublished: targetAssignment.isPublished,
        previousPublishedAt:
          targetAssignment.publishedAt ||
          targetAssignment.createdAt ||
          targetAssignment.updatedAt,
      });
      const nextMapTitle = mapChanged
        ? replacementMap!.title
        : targetAssignment.title;
      const payload = sanitizeHistoryClassroomAssignmentForWrite({
        ...targetAssignment,
        title: nextMapTitle,
        description: "",
        ...(mapChanged ? getHistoryClassroomSourceFields(replacementMap!) : {}),
        pdfPageImages: mapChanged
          ? replacementMap!.pdfPageImages
          : targetAssignment.pdfPageImages,
        pdfRegions: mapChanged
          ? replacementMap!.pdfRegions
          : targetAssignment.pdfRegions,
        blanks: nextBlanks,
        answerOptions: buildAnswerOptions(nextBlanks),
        timeLimitMinutes: Math.max(0, editingTimeLimitMinutes),
        cooldownMinutes: Math.max(0, editingCooldownMinutes),
        dueWindowDays: resolvedDueWindowDays,
        passThresholdPercent: Math.min(
          100,
          Math.max(0, editingPassThresholdPercent),
        ),
        targetGrade: updatedStudents[0]?.grade || "",
        targetClass: updatedStudents[0]?.className || "",
        targetStudentUid: updatedStudents[0]?.uid || "",
        targetStudentUids: updatedStudents.map((student) => student.uid),
        targetStudentAccessMap: Object.fromEntries(
          updatedStudents.map((student) => [student.uid, true]),
        ),
        targetStudentName: updatedStudents
          .map((student) => student.name)
          .join(", "),
        targetStudentNames: updatedStudents.map((student) => student.name),
        targetStudentReasons: pickStudentReasons(
          editingStudentReasons,
          updatedStudents.map((student) => student.uid),
        ),
        targetStudentNumber: updatedStudents
          .map((student) => student.number)
          .filter(Boolean)
          .join(", "),
        isPublished: editingIsPublished,
        publishedAt: publishWindow.publishedAt || null,
        dueAt: publishWindow.dueAt || null,
        updatedAt: serverTimestamp(),
      });

      const saved = await saveHistoryAssessmentSource(
        config,
        targetAssignment.id,
        payload,
        Number(targetAssignment.contentRevision || 0),
      );
      payload.contentRevision = saved.contentRevision;
      Object.assign(payload, saved.publicationWindow);
      if (editingIsPublished && !targetAssignment.isPublished) {
        void createManagedNotifications(config, {
          recipientUids: updatedStudents.map((student) => student.uid),
          type: "history_classroom_assigned",
          title: "역사교실이 배정되었습니다",
          body: `${nextMapTitle} 과제가 새로 열렸습니다.`,
          targetUrl: "/student/history-classroom",
          entityType: "history_classroom",
          entityId: targetAssignment.id,
          dedupeKey: `history_classroom_assigned:${targetAssignment.id}`,
          templateValues: {
            assignmentTitle: nextMapTitle,
          },
        }).catch((notificationError) => {
          console.error(
            "Failed to create history classroom assignment notifications:",
            notificationError,
          );
        });
      }
      setAssignments((prev) =>
        prev.map((assignment) =>
          assignment.id === targetAssignment.id
            ? (() => {
                const normalized = normalizeHistoryClassroomAssignment(
                  targetAssignment.id,
                  payload as Partial<HistoryClassroomAssignment>,
                );
                return normalized;
              })()
            : assignment,
        ),
      );
      closeAssignmentEditor();
      setWorksheetEditingAssignmentId("");
      setWorksheetEditingIsPublished(true);
    } catch (error) {
      console.error("Failed to save history classroom assignment edit", {
        path: `${getSemesterCollectionPath(config, "history_classrooms")}/${targetAssignment.id}`,
        assignmentId: targetAssignment.id,
        payload: {
          title: targetAssignment.mapTitle || editingTitle.trim(),
          studentCount: updatedStudents.length,
          blankCount: targetAssignment.blanks.length,
          dueWindowDays: resolveDueWindowDaysValue(editingDueWindowDays),
          isPublished: editingIsPublished,
        },
        ...getFirestoreErrorSummary(error),
        error,
      });
      alert(
        getHistoryClassroomErrorMessage(error, "역사교실 수정에 실패했습니다."),
      );
    } finally {
      savingEditRef.current = false;
      setSavingEdit(false);
    }
  };

  const getAvailableStudentExemptions = (
    studentUid: string,
    assignmentId: string,
  ) =>
    exemptions.filter(
      (exemption) =>
        exemption.uid === studentUid &&
        ["available", "active"].includes(exemption.status) &&
        (!exemption.assignmentId || exemption.assignmentId === assignmentId) &&
        (!getTimestampMs(exemption.expiresAt) ||
          getTimestampMs(exemption.expiresAt)! > Date.now()),
    );

  const handleApplyStudentExemption = async (student: StudentOption) => {
    const assignment = assignments.find(
      (item) => item.id === editingAssignmentId,
    );
    if (
      !assignment ||
      applyingExemptionRef.current ||
      savingEditRef.current ||
      resettingAttemptRef.current ||
      deletingAssignment
    )
      return;
    const exemption = getAvailableStudentExemptions(
      student.uid,
      assignment.id,
    )[0];
    if (
      !exemption ||
      !getHistoryClassroomAssignedStudentUids(assignment).includes(student.uid)
    )
      return;
    const key = `${assignment.id}:${student.uid}`;
    if (appliedExemptionKeys.includes(key)) return;
    applyingExemptionRef.current = true;
    setApplyingExemptionUid(student.uid);
    setDirectExemptionFeedback((previous) => ({ ...previous, [key]: "" }));
    try {
      const applied = await applyHistoryClassroomExemption(config, {
        assignmentId: assignment.id,
        studentUid: student.uid,
        exemptionId: exemption.id,
      });
      setAppliedExemptionKeys((previous) => [...new Set([...previous, key])]);
      setExemptions((previous) =>
        previous.map((item) =>
          item.id === applied.exemptionId ? { ...item, status: "used" } : item,
        ),
      );
      setDirectExemptionFeedback((previous) => ({
        ...previous,
        [key]: "면제권 1장을 사용했습니다.",
      }));
      try {
        const resultSnapshot = await getDoc(
          doc(
            db,
            getSemesterCollectionPath(config, "history_classroom_results"),
            applied.resultId,
          ),
        );
        if (resultSnapshot.exists()) {
          const result = normalizeHistoryClassroomResult(
            resultSnapshot.id,
            resultSnapshot.data(),
          );
          setResultsByAssignment((previous) => ({
            ...previous,
            [assignment.id]: [
              result,
              ...(previous[assignment.id] || []).filter(
                (item) => item.id !== result.id,
              ),
            ],
          }));
        }
        await loadExemptionData();
      } catch (error) {
        console.error(
          "Failed to refresh applied history classroom exemption",
          error,
        );
        setDirectExemptionFeedback((previous) => ({
          ...previous,
          [key]: "면제 처리되었습니다. 제출 내역은 새로고침해 주세요.",
        }));
      }
    } catch (error) {
      setDirectExemptionFeedback((previous) => ({
        ...previous,
        [key]: getHistoryClassroomErrorMessage(
          error,
          "면제권을 사용하지 못했습니다. 다시 시도해 주세요.",
        ),
      }));
    } finally {
      applyingExemptionRef.current = false;
      setApplyingExemptionUid("");
    }
  };

  const handleResetStudentAttemptCooldown = async (student: StudentOption) => {
    const targetAssignment = assignments.find(
      (assignment) => assignment.id === editingAssignmentId,
    );
    if (
      !targetAssignment ||
      !student.uid ||
      resettingAttemptRef.current ||
      applyingExemptionRef.current ||
      savingEdit ||
      deletingAssignment
    )
      return;
    if (
      (editingResultsByStudentUid.get(student.uid) || []).some(
        (result) => result.status === "passed" || result.passed,
      )
    )
      return;
    // An unsaved newly assigned student cannot receive a live reset yet.
    if (
      !getHistoryClassroomAssignedStudentUids(targetAssignment).includes(
        student.uid,
      )
    )
      return;
    const assignmentPath =
      assignmentCollectionPathsRef.current[targetAssignment.id] ||
      getSemesterCollectionPath(config, "history_classrooms");
    const resetAt = new Date();
    resettingAttemptRef.current = true;
    setResettingAttemptUid(student.uid);
    setAttemptResetFeedback((prev) => ({ ...prev, [student.uid]: "" }));
    try {
      await executeAssessmentManagementCommand("resetAssessmentAttempt", {
        definitionId: buildAssessmentDefinitionId(
          getAssessmentSemesterId(config),
          "HISTORY_CLASSROOM",
          targetAssignment.id,
        ),
        studentUid: student.uid,
        reason: "교사 역사교실 재응시 대기 해제",
      });

      setAssignments((prev) =>
        prev.map((assignment) =>
          assignment.id === targetAssignment.id
            ? {
                ...assignment,
                retryResetByStudentUid: {
                  ...(assignment.retryResetByStudentUid || {}),
                  [student.uid]: resetAt,
                },
                updatedAt: resetAt,
              }
            : assignment,
        ),
      );
      setAttemptResetFeedback((prev) => ({
        ...prev,
        [student.uid]: "재응시 대기 해제됨",
      }));
    } catch (error) {
      console.error("Failed to reset history classroom attempt cooldown", {
        path: `${assignmentPath}/${targetAssignment.id}`,
        assignmentId: targetAssignment.id,
        uid: student.uid,
        ...getFirestoreErrorSummary(error),
        error,
      });
      setAttemptResetFeedback((prev) => ({
        ...prev,
        [student.uid]: "해제하지 못했습니다. 다시 시도해 주세요.",
      }));
    } finally {
      resettingAttemptRef.current = false;
      setResettingAttemptUid("");
    }
  };

  const handleDeleteAssignment = async () => {
    if (resettingAttemptRef.current || applyingExemptionRef.current) return;
    const targetAssignment = assignments.find(
      (assignment) => assignment.id === editingAssignmentId,
    );
    if (!targetAssignment) return;
    const confirmed = window.confirm(
      "이 역사교실 과제를 삭제할까요?\n학생 목록에서는 즉시 사라지며, 기존 제출 결과는 유지됩니다.",
    );
    if (!confirmed) return;

    setDeletingAssignment(true);
    try {
      await deleteHistoryAssessmentSource(
        config,
        targetAssignment.id,
        targetAssignment,
        Number(targetAssignment.contentRevision || 0),
      );
      setAssignments((prev) =>
        prev.filter((assignment) => assignment.id !== targetAssignment.id),
      );
      setResultsByAssignment((prev) => {
        const next = { ...prev };
        delete next[targetAssignment.id];
        return next;
      });
      if (worksheetEditingAssignmentId === targetAssignment.id) {
        setWorksheetEditingAssignmentId("");
        setWorksheetEditingIsPublished(true);
      }
      if (worksheetSourceAssignment?.id === targetAssignment.id) {
        setWorksheetSourceAssignment(null);
        setWorksheetImportSourceId("");
        setWorksheetImportSourceTitle("");
      }
      closeAssignmentEditor();
      alert("역사교실 과제를 삭제했습니다.");
    } catch (error) {
      console.error("Failed to delete history classroom assignment", {
        path: `${getSemesterCollectionPath(config, "history_classrooms")}/${targetAssignment.id}`,
        assignmentId: targetAssignment.id,
        ...getFirestoreErrorSummary(error),
        error,
      });
      alert("역사교실 과제 삭제에 실패했습니다.");
    } finally {
      setDeletingAssignment(false);
    }
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!selectedMap || !selectedStudentUids.length) {
      alert("자료와 대상 학생을 먼저 선택해 주세요.");
      return;
    }
    if (!("lessonUnitId" in selectedMap) || !selectedMap.lessonUnitId) {
      alert("빈칸이 저장된 수업 자료를 선택해 주세요.");
      return;
    }
    if (!selectedStudents.length) {
      alert("학생 정보를 찾을 수 없습니다.");
      return;
    }
    const missingReasonUid = selectedStudentUids.find(
      (uid) =>
        otherReasonUids.includes(uid) &&
        !String(studentReasons[uid] || "").trim(),
    );
    if (missingReasonUid) {
      setShowReasonErrors(true);
      window.requestAnimationFrame(() => {
        const input = document.getElementById(
          `history-create-reason-${missingReasonUid}-other`,
        );
        input?.focus({ preventScroll: true });
        input?.closest("label")?.scrollIntoView({ block: "center" });
      });
      return;
    }
    const saveBlanks =
      worksheetEditingAssignmentId && worksheetSourceAssignment
        ? blanks
        : cloneMapResourceBlanks(selectedMap);
    if (
      !saveBlanks.length ||
      saveBlanks.some((blank) => !blank.answer.trim())
    ) {
      alert("선택한 자료에 빈칸과 정답을 먼저 저장해 주세요.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    let assignmentId = "";
    try {
      const existingAssignment = worksheetEditingAssignmentId
        ? assignments.find(
            (assignment) => assignment.id === worksheetEditingAssignmentId,
          ) || null
        : null;
      assignmentId =
        existingAssignment?.id ||
        pendingAssignmentId.current ||
        `history-classroom-${Date.now()}`;
      pendingAssignmentId.current = assignmentId;
      const sourceSnapshot =
        worksheetSourceAssignment &&
        getHistoryClassroomSourceId(worksheetSourceAssignment) ===
          selectedMap.id
          ? worksheetSourceAssignment
          : existingAssignment &&
              getHistoryClassroomSourceId(existingAssignment) === selectedMap.id
            ? existingAssignment
            : null;
      const resolvedDueWindowDays = resolveDueWindowDaysValue(dueWindowDays);
      const resolvedMapTitle =
        sourceSnapshot?.title || selectedMap.title || "역사교실";
      const nextIsPublished = existingAssignment
        ? worksheetEditingIsPublished
        : true;
      const publishWindow = buildHistoryClassroomPublishWindow({
        dueWindowDays: resolvedDueWindowDays,
        isPublished: nextIsPublished,
        previousIsPublished: existingAssignment?.isPublished || false,
        previousPublishedAt:
          existingAssignment?.publishedAt ||
          existingAssignment?.createdAt ||
          existingAssignment?.updatedAt,
      });
      const payload = sanitizeHistoryClassroomAssignmentForWrite({
        title: resolvedMapTitle,
        description: "",
        ...getHistoryClassroomSourceFields(selectedMap),
        pdfPageImages: sourceSnapshot?.pdfPageImages?.length
          ? sourceSnapshot.pdfPageImages
          : selectedMap.pdfPageImages || [],
        pdfRegions: sourceSnapshot?.pdfRegions?.length
          ? sourceSnapshot.pdfRegions
          : selectedMap.pdfRegions || [],
        blanks: saveBlanks,
        answerOptions: buildAnswerOptions(saveBlanks),
        timeLimitMinutes,
        cooldownMinutes,
        dueWindowDays: resolvedDueWindowDays,
        passThresholdPercent,
        targetGrade: selectedStudents[0]?.grade || "",
        targetClass: selectedStudents[0]?.className || "",
        targetStudentUid: selectedStudents[0]?.uid || "",
        targetStudentUids: selectedStudents.map((student) => student.uid),
        targetStudentName: selectedStudents
          .map((student) => student.name)
          .join(", "),
        targetStudentNames: selectedStudents.map((student) => student.name),
        targetStudentReasons: pickStudentReasons(
          studentReasons,
          selectedStudents.map((student) => student.uid),
        ),
        targetStudentNumber: selectedStudents
          .map((student) => student.number)
          .filter(Boolean)
          .join(", "),
        retryResetByStudentUid: existingAssignment?.retryResetByStudentUid,
        isPublished: nextIsPublished,
        publishedAt: publishWindow.publishedAt || null,
        dueAt: publishWindow.dueAt || null,
        createdAt: existingAssignment?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const saved = await saveHistoryAssessmentSource(
        config,
        assignmentId,
        payload,
        Number(existingAssignment?.contentRevision || 0),
      );
      payload.contentRevision = saved.contentRevision;
      Object.assign(payload, saved.publicationWindow);
      if (nextIsPublished && !existingAssignment?.isPublished) {
        void createManagedNotifications(config, {
          recipientUids: selectedStudents.map((student) => student.uid),
          type: "history_classroom_assigned",
          title: "역사교실이 배정되었습니다",
          body: `${resolvedMapTitle} 과제가 새로 열렸습니다.`,
          targetUrl: "/student/history-classroom",
          entityType: "history_classroom",
          entityId: assignmentId,
          dedupeKey: `history_classroom_assigned:${assignmentId}`,
          templateValues: {
            assignmentTitle: resolvedMapTitle,
          },
        }).catch((notificationError) => {
          console.error(
            "Failed to create history classroom assignment notifications:",
            notificationError,
          );
        });
      }
      setAssignments((prev) => {
        const normalizedAssignment = normalizeHistoryClassroomAssignment(
          assignmentId,
          payload as Partial<HistoryClassroomAssignment>,
        );
        const normalized = normalizedAssignment;
        if (existingAssignment) {
          return prev.map((assignment) =>
            assignment.id === assignmentId ? normalized : assignment,
          );
        }
        return [normalized, ...prev];
      });
      setAssignmentPage(1);
      setTitle("");
      setDescription("");
      setTimeLimitMinutes(NEW_ASSIGNMENT_DEFAULTS.timeLimitMinutes);
      setCooldownMinutes(NEW_ASSIGNMENT_DEFAULTS.cooldownMinutes);
      setDueWindowDays("");
      setPassThresholdPercent(NEW_ASSIGNMENT_DEFAULTS.passThresholdPercent);
      setTargetGrade(NEW_ASSIGNMENT_DEFAULTS.targetGrade);
      setTargetClass(NEW_ASSIGNMENT_DEFAULTS.targetClass);
      setSelectedStudentUids([]);
      setStudentReasons({});
      setOtherReasonUids([]);
      setShowReasonErrors(false);
      setNewStudentReason("");
      setNewStudentReasonOther(false);
      setNewStudentReasonError(false);
      setBlanks([]);
      setSelectedBlankId("");
      setDraftBlank(null);
      setDraftBlankAnswer("");
      setBlankEditorMode(null);
      setBlankEditorAnswer("");
      blankEditorComposingRef.current = false;
      setShowAllBlankTags(false);
      setWorksheetEditingAssignmentId("");
      setWorksheetEditingIsPublished(true);
      setWorksheetImportSourceId("");
      setWorksheetImportSourceTitle("");
      setWorksheetSourceAssignment(null);
      alert("역사교실 과제를 저장했습니다.");
      pendingAssignmentId.current = "";
      setIsCreateModalOpen(false);
    } catch (error) {
      console.error("Failed to save history classroom assignment", {
        path: `${getSemesterCollectionPath(config, "history_classrooms")}/${assignmentId || worksheetEditingAssignmentId || "new"}`,
        assignmentId: assignmentId || worksheetEditingAssignmentId || null,
        payload: {
          title: selectedMap.title,
          mapResourceId: selectedMap.id,
          studentCount: selectedStudents.length,
          blankCount: blanks.length,
          dueWindowDays: resolveDueWindowDaysValue(dueWindowDays),
          isPublished: worksheetEditingAssignmentId
            ? worksheetEditingIsPublished
            : true,
        },
        ...getFirestoreErrorSummary(error),
        error,
      });
      alert(
        getHistoryClassroomErrorMessage(
          error,
          "역사교실 과제 저장에 실패했습니다.",
        ),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const addAssignmentStudent = (uid: string, editing = false) => {
    const reason = (
      editing ? editingNewStudentReason : newStudentReason
    ).trim();
    if (!reason) {
      (editing ? setEditingNewStudentReasonError : setNewStudentReasonError)(
        true,
      );
      const prefix = editing
        ? "history-edit-add-reason"
        : "history-create-add-reason";
      document.getElementById(prefix)?.focus();
      return false;
    }
    if (editing) {
      setEditingStudentUids((previous) =>
        previous.includes(uid) ? previous : [...previous, uid],
      );
      setEditingStudentReasons((previous) => ({ ...previous, [uid]: reason }));
      setEditingOtherReasonUids((previous) => [...new Set([...previous, uid])]);
    } else {
      setSelectedStudentUids((previous) =>
        previous.includes(uid) ? previous : [...previous, uid],
      );
      setStudentReasons((previous) => ({ ...previous, [uid]: reason }));
      setOtherReasonUids((previous) => [...new Set([...previous, uid])]);
    }
    return true;
  };

  const activeModalId = isCreateModalOpen
    ? "history-create-dialog"
    : editingAssignment
      ? "history-edit-dialog"
      : exemptionPanelOpen
        ? "history-exemption-dialog"
        : "";
  const closeActiveModalRef = React.useRef<() => void>(() => {});
  closeActiveModalRef.current = () => {
    if (isCreateModalOpen) {
      if (!savingRef.current) setIsCreateModalOpen(false);
    } else if (editingAssignment) {
      if (reviewResultId) setReviewResultId("");
      else if (previewOpen) setPreviewOpen(false);
      else if (!savingEditRef.current) closeAssignmentEditor();
    } else if (!grantingExemptionRef.current) {
      closeExemptionPanel();
    }
  };
  useEffect(() => {
    if (!activeModalId) return;
    const modal = document.getElementById(activeModalId);
    if (!modal) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeActiveModalRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        modal.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === modal)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [activeModalId]);

  return (
    <div className="history-classroom ws-page">
      <datalist id="history-assignment-reasons">
        {ASSIGNMENT_REASONS.map((reason) => (
          <option key={reason} value={reason} />
        ))}
      </datalist>
      <section className="history-dashboard mb-4">
        <div className="history-heading ws-page-header">
          <div className="flex items-start gap-4">
            <div>
              <h1 className="text-2xl font-black text-gray-900">
                역사교실 제출 현황 대시보드
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <HistoryActionButton
              icon="ticket"
              label="면제권 관리"
              type="button"
              onClick={() => openExemptionPanel("grant")}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 text-sm font-bold text-blue-700 shadow-sm hover:bg-blue-100"
            >
              {pendingExemptionRequestCount > 0 && (
                <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-black text-white">
                  {pendingExemptionRequestCount}
                </span>
              )}
            </HistoryActionButton>

            <HistoryActionButton
              icon="plus"
              label="새 역사교실"
              type="button"
              onClick={openCreateModal}
              className="h-11 rounded-2xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
            ></HistoryActionButton>
          </div>
        </div>
      </section>

      <section className="history-dashboard ws-flat-section mb-5">
        <div className="history-filters">
          <div className="history-date-label flex h-11 items-center gap-3 rounded-2xl border border-gray-200 px-3 text-sm font-bold text-gray-700 xl:h-12 xl:px-4">
            <DashboardIcon name="calendar" className="h-4 w-4 text-blue-600" />
            {dashboardDateRangeLabel}
          </div>
          <div className="flex h-11 items-center gap-3 rounded-2xl border border-gray-200 px-3 xl:h-12 xl:px-4">
            <input
              lang="ko"
              inputMode="text"
              value={dashboardSearch}
              onChange={(event) => setDashboardSearch(event.target.value)}
              placeholder="과제명, 학생 이름, 학번 검색"
              className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-gray-400"
            />
            <DashboardIcon name="search" className="h-5 w-5 text-gray-400" />
          </div>
          <div className="history-filter-actions">
            {[
              ["all", "전체"],
              ["published", "공개"],
              ["private", "비공개"],
              ["pending", "미제출"],
              ["passed", "통과"],
            ].map(([value, label]) => (
              <React.Fragment key={value}>
                <HistoryActionButton
                  icon={
                    {
                      all: "clipboard",
                      published: "eye",
                      private: "hidden",
                      pending: "clock",
                      passed: "check",
                    }[value] as DashboardIconName
                  }
                  label={String(label)}
                  type="button"
                  onClick={() =>
                    setDashboardStatusFilter(value as DashboardStatusFilter)
                  }
                  className={`h-9 rounded-xl border px-2.5 text-xs font-bold transition xl:h-10 xl:px-3 ${
                    dashboardStatusFilter === value
                      ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                      : value === "pending"
                        ? "border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                        : value === "passed"
                          ? "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                ></HistoryActionButton>
                {value === "all" && (
                  <button
                    type="button"
                    onClick={() =>
                      setDashboardRefreshKey((current) => current + 1)
                    }
                    disabled={refreshingDashboard}
                    aria-label="새로고침"
                    title="새로고침"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <DashboardIcon
                      name="refresh"
                      className={`h-4 w-4 ${refreshingDashboard ? "animate-spin" : ""}`}
                    />
                  </button>
                )}
              </React.Fragment>
            ))}
          </div>
          <label className="history-sort-label flex h-11 items-center gap-2 rounded-2xl border border-gray-200 px-3 text-sm font-bold text-gray-600 xl:h-12 xl:gap-3 xl:px-4">
            정렬 기준
            <select
              value={dashboardSortOrder}
              onChange={(event) =>
                setDashboardSortOrder(event.target.value as DashboardSortOrder)
              }
              className="h-full min-w-[5.75rem] border-0 bg-transparent text-sm font-bold text-gray-900 outline-none xl:min-w-[7rem]"
            >
              <option value="latest">최신순</option>
              <option value="oldest">오래된순</option>
            </select>
          </label>
        </div>
      </section>

      <section
        ref={exemptionSectionRef}
        id="history-classroom-exemption-management"
        className="hidden"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-500">
              Exemption
            </div>
            <h2 className="mt-1 text-lg font-black text-gray-900">
              면제권 관리
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500">
              역사교실 면제권을 학생별 또는 학급별로 부여하고 학생 사용 요청을
              승인/반려합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">
              사용 요청 대기 {pendingExemptionRequestCount}건
            </span>
            <span className="rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">
              부여 기록 {activeExemptionCount}건
            </span>
            <HistoryActionButton
              icon="refresh"
              label={loadingExemptions ? "새로고침 중" : "새로고침"}
              type="button"
              onClick={() => void loadExemptionData()}
              disabled={loadingExemptions}
              className="h-10 rounded-2xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            ></HistoryActionButton>
            <HistoryActionButton
              icon="ticket"
              label={exemptionPanelOpen ? "패널 닫기" : "면제권 관리 열기"}
              type="button"
              onClick={() =>
                exemptionPanelOpen
                  ? closeExemptionPanel()
                  : setExemptionPanelOpen(true)
              }
              className="h-10 rounded-2xl bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700"
            ></HistoryActionButton>
          </div>
        </div>

        {exemptionPanelOpen && (
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="rounded-2xl border border-gray-200 bg-slate-50 p-4">
              <div className="flex flex-wrap gap-2">
                {[
                  ["students", "학생별 부여"],
                  ["class", "학급 단위 부여"],
                ].map(([value, label]) => (
                  <HistoryActionButton
                    icon={value === "class" ? "users" : "plus"}
                    label={String(label)}
                    key={value}
                    type="button"
                    onClick={() =>
                      setExemptionGrantMode(value as ExemptionGrantMode)
                    }
                    className={`rounded-2xl border px-4 py-2 text-sm font-bold ${
                      exemptionGrantMode === value
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  ></HistoryActionButton>
                ))}
              </div>

              {exemptionGrantMode === "students" ? (
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-gray-500">
                      학생 검색
                    </span>
                    <input
                      lang="ko"
                      inputMode="text"
                      type="text"
                      value={exemptionStudentSearch}
                      onChange={(event) =>
                        setExemptionStudentSearch(event.target.value)
                      }
                      placeholder="이름, 학년, 반, 번호로 검색"
                      className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                    />
                  </label>
                  {searchedExemptionStudents.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {searchedExemptionStudents.map((student) => (
                        <button
                          key={student.uid}
                          type="button"
                          onClick={() => {
                            setExemptionSelectedStudentUids((prev) => [
                              ...prev,
                              student.uid,
                            ]);
                            setExemptionStudentSearch("");
                          }}
                          className="rounded-full border border-blue-100 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50"
                        >
                          {formatStudentBadgeLabel(student)}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex min-h-10 flex-wrap gap-2 rounded-2xl border border-gray-200 bg-white p-2">
                    {exemptionSelectedStudents.map((student) => (
                      <span
                        key={student.uid}
                        className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700"
                      >
                        {formatStudentBadgeLabel(student)}
                        <button
                          type="button"
                          onClick={() =>
                            setExemptionSelectedStudentUids((prev) =>
                              prev.filter((uid) => uid !== student.uid),
                            )
                          }
                          className="text-blue-400 hover:text-blue-700"
                          aria-label={`${student.name} 선택 해제`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {!exemptionSelectedStudents.length && (
                      <span className="px-2 py-1 text-xs font-semibold text-gray-400">
                        선택된 학생이 없습니다.
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-gray-500">
                      학년
                    </span>
                    <select
                      value={exemptionTargetGrade}
                      onChange={(event) => {
                        setExemptionTargetGrade(event.target.value);
                        setExemptionTargetClass("");
                      }}
                      className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                    >
                      <option value="">학년 선택</option>
                      {gradeOptions.map((grade) => (
                        <option key={grade} value={grade}>
                          {grade}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-gray-500">
                      반
                    </span>
                    <select
                      value={exemptionTargetClass}
                      onChange={(event) =>
                        setExemptionTargetClass(event.target.value)
                      }
                      className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                    >
                      <option value="">반 선택</option>
                      {exemptionClassOptions.map((className) => (
                        <option key={className} value={className}>
                          {className}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="sm:col-span-2 rounded-2xl border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-blue-700">
                    선택 대상 {exemptionClassStudents.length}명
                  </div>
                </div>
              )}

              <label className="mt-4 block">
                <span className="mb-1 block text-xs font-bold text-gray-500">
                  부여 사유
                </span>
                <textarea
                  lang="ko"
                  inputMode="text"
                  value={exemptionReason}
                  onChange={(event) => setExemptionReason(event.target.value)}
                  rows={3}
                  placeholder="예: 학교 행사, 공결, 상담 등"
                  className="w-full resize-none rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                />
              </label>
              <HistoryActionButton
                icon="ticket"
                label={grantingExemption ? "부여 중" : "면제권 부여"}
                type="button"
                onClick={() => void handleGrantExemptions()}
                disabled={grantingExemption}
                className="mt-3 h-11 w-full rounded-2xl bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-50"
              ></HistoryActionButton>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-200 bg-white">
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                  <h3 className="text-sm font-black text-gray-900">
                    면제권 사용 요청
                  </h3>
                  <span className="text-xs font-bold text-gray-400">
                    {exemptionRequests.length}건
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto p-3">
                  {sortedExemptionRequests.map((request) => {
                    const isPending = request.status === "pending";
                    const isHighlighted =
                      highlightedExemptionRequestId === request.id;
                    return (
                      <div
                        key={request.id}
                        className={`mb-2 rounded-2xl border p-3 last:mb-0 ${
                          isHighlighted
                            ? "border-blue-300 bg-blue-50"
                            : "border-gray-200 bg-white"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-black text-gray-900">
                              {formatExemptionStudentLabel(request)}
                            </div>
                            <div className="mt-1 text-xs font-semibold text-gray-500">
                              요청 {formatDateTimeLabel(request.createdAt)}
                            </div>
                            {request.assignmentTitle && (
                              <div className="mt-1 text-xs font-bold text-blue-700">
                                {request.assignmentTitle}
                              </div>
                            )}
                          </div>
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-black ${getExemptionRequestStatusClassName(
                              request.status,
                            )}`}
                          >
                            {formatExemptionRequestStatusLabel(request.status)}
                          </span>
                        </div>
                        {request.reason && (
                          <p className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
                            {request.reason}
                          </p>
                        )}
                        {isPending ? (
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <HistoryActionButton
                              icon="close"
                              label="반려"
                              type="button"
                              onClick={() =>
                                void handleReviewExemptionRequest(
                                  request.id,
                                  "rejected",
                                )
                              }
                              disabled={
                                reviewingExemptionRequestId === request.id
                              }
                              className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            ></HistoryActionButton>
                            <HistoryActionButton
                              icon="check"
                              label="승인"
                              type="button"
                              onClick={() =>
                                void handleReviewExemptionRequest(
                                  request.id,
                                  "approved",
                                )
                              }
                              disabled={
                                reviewingExemptionRequestId === request.id
                              }
                              className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                            ></HistoryActionButton>
                          </div>
                        ) : (
                          <div className="mt-2 text-xs font-semibold text-gray-400">
                            처리 {formatDateTimeLabel(request.reviewedAt)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!sortedExemptionRequests.length && (
                    <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm font-semibold text-gray-400">
                      접수된 면제권 사용 요청이 없습니다.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white">
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                  <h3 className="text-sm font-black text-gray-900">
                    부여된 면제권
                  </h3>
                  <span className="text-xs font-bold text-gray-400">
                    {exemptions.length}건
                  </span>
                </div>
                <div className="max-h-64 overflow-y-auto p-3">
                  {exemptions.map((exemption) => (
                    <div
                      key={exemption.id}
                      className="mb-2 rounded-2xl border border-gray-200 bg-white p-3 last:mb-0"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-black text-gray-900">
                            {formatExemptionStudentLabel(exemption)}
                          </div>
                          <div className="mt-1 text-xs font-semibold text-gray-500">
                            부여 {formatDateTimeLabel(exemption.createdAt)}
                            {exemption.expiresAt
                              ? ` · 만료 ${formatDateTimeLabel(
                                  exemption.expiresAt,
                                )}`
                              : ""}
                          </div>
                        </div>
                        <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                          {exemption.status}
                        </span>
                      </div>
                      {exemption.reason && (
                        <p className="mt-2 text-xs leading-5 text-gray-600">
                          {exemption.reason}
                        </p>
                      )}
                    </div>
                  ))}
                  {!exemptions.length && (
                    <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm font-semibold text-gray-400">
                      아직 부여된 면제권이 없습니다.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <section
        className={`history-dashboard relative space-y-8 ${
          pagedAssignmentGroups.length
            ? "before:pointer-events-none before:absolute before:bottom-0 before:left-1.5 before:top-2 before:w-px before:bg-gray-200"
            : ""
        }`}
      >
        {pagedAssignmentGroups.map((group) => (
          <div
            key={group.dateKey}
            className="history-timeline-group relative flex w-full flex-col gap-3 lg:flex-row lg:items-start"
          >
            <div className="history-timeline-date relative w-full shrink-0 lg:w-32">
              <div className="relative z-10">
                <div
                  className="history-timeline-marker absolute left-0 top-2 h-3 w-3 rounded-full border-4 border-white bg-blue-600 shadow ring-1 ring-blue-200"
                  aria-hidden="true"
                />
                <div className="ml-6">
                  <div className="whitespace-nowrap text-base font-black leading-6 text-gray-900 sm:text-lg">
                    {group.timelineDate.date}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-gray-500 sm:text-sm">
                    {group.timelineDate.weekday}
                  </div>
                </div>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              {group.rows.map((row) => {
                const expanded = expandedAssignmentId === row.assignment.id;
                return (
                  <article
                    key={row.assignment.id}
                    className="min-w-0 flex-1 cursor-pointer rounded-3xl border border-gray-200 bg-white p-3.5 shadow-sm transition hover:shadow-md"
                    onClick={() =>
                      setExpandedAssignmentId((current) =>
                        current === row.assignment.id ? "" : row.assignment.id,
                      )
                    }
                  >
                    <div className="history-card-heading flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="min-w-0 break-keep text-lg font-black leading-tight text-gray-900">
                            {row.assignment.mapTitle || row.assignment.title}
                          </h2>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${
                              row.assignment.isPublished
                                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border border-gray-200 bg-gray-100 text-gray-600"
                            }`}
                          >
                            {row.assignment.isPublished ? "공개" : "비공개"}
                          </span>
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
                            {row.studentNamesLabel}
                          </span>
                        </div>
                        <div className="mt-2 break-keep text-sm font-medium leading-6 text-gray-500">
                          통과 기준 {row.assignment.passThresholdPercent}% ·
                          제한 시간{" "}
                          {row.assignment.timeLimitMinutes > 0
                            ? `${row.assignment.timeLimitMinutes}분`
                            : "없음"}{" "}
                          · 재도전 제한 {row.assignment.cooldownMinutes}분
                        </div>
                      </div>
                      <div className="history-card-status -mr-1 flex max-w-full flex-nowrap items-center justify-start gap-1.5 overflow-x-auto pb-1 pr-1 lg:max-w-none lg:shrink-0 lg:justify-end lg:overflow-visible lg:pb-0 lg:pr-0">
                        {[
                          [
                            "통과",
                            row.passed,
                            "border-emerald-200 bg-emerald-50 text-emerald-700",
                          ],
                          [
                            "미통과",
                            row.failed,
                            "border-rose-200 bg-rose-50 text-rose-700",
                          ],
                          [
                            "미제출",
                            row.pendingCount + row.overdueAbsentCount,
                            "border-gray-200 bg-gray-50 text-gray-700",
                          ],
                          [
                            "자동 종료",
                            row.cancelled,
                            "border-amber-200 bg-amber-50 text-amber-700",
                          ],
                        ].map(([label, count, className]) => (
                          <span
                            key={label}
                            className={`history-card-count inline-flex h-9 min-w-[4.6rem] shrink-0 items-center justify-center gap-1.5 rounded-xl border px-2 text-[11px] font-black sm:h-10 sm:min-w-[5rem] sm:px-2.5 sm:text-xs ${className}`}
                          >
                            {label}
                            <span>{count}</span>
                          </span>
                        ))}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openAssignmentEditor(row.assignment);
                          }}
                          className="history-card-control flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 transition hover:bg-blue-100"
                          aria-label={`${row.assignment.title} 설정 수정`}
                        >
                          <DashboardIcon name="edit" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedAssignmentId((current) =>
                              current === row.assignment.id
                                ? ""
                                : row.assignment.id,
                            );
                          }}
                          className="history-card-control flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                          aria-label={expanded ? "상세 접기" : "상세 펼치기"}
                          aria-expanded={expanded}
                        >
                          <DashboardIcon
                            name={expanded ? "chevronUp" : "chevronDown"}
                            className="h-4 w-4"
                          />
                        </button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="mt-4 grid gap-3 xl:grid-cols-4">
                        {(
                          [
                            [
                              "통과",
                              row.statusGroups.passed,
                              "text-emerald-700",
                            ],
                            [
                              "미통과",
                              row.statusGroups.failed,
                              "text-rose-700",
                            ],
                            [
                              "미제출",
                              row.statusGroups.pending,
                              "text-gray-700",
                            ],
                            [
                              "자동 종료",
                              row.statusGroups.cancelled,
                              "text-amber-700",
                            ],
                          ] as const
                        ).map(([label, students, toneClassName]) => (
                          <div
                            key={label}
                            className="rounded-2xl border border-gray-200 bg-white p-3"
                          >
                            <div
                              className={`text-xs font-black ${toneClassName}`}
                            >
                              {label}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {students.map((student) => (
                                <span
                                  key={`${row.assignment.id}-${label}-${student.uid}`}
                                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700"
                                >
                                  {student.name}
                                  <span className="ml-2 font-semibold text-gray-500">
                                    {student.classLabel}{" "}
                                    {student.number && `${student.number}번`}{" "}
                                    {student.attemptLabel !== "시도 없음" &&
                                      student.attemptLabel}
                                  </span>
                                  {student.reason && (
                                    <span className="ml-2 font-semibold text-blue-600">
                                      {student.reason}
                                    </span>
                                  )}
                                </span>
                              ))}
                              {!students.length && (
                                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-400">
                                  없음
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        ))}
        {!assignmentRows.length && (
          <div className="rounded-3xl border border-dashed border-gray-300 bg-white px-5 py-12 text-center text-sm font-semibold text-gray-400">
            아직 생성된 역사교실 과제가 없습니다. 새 역사교실로 첫 과제를
            등록하세요.
          </div>
        )}
        {assignmentRows.length > 0 && !pagedAssignmentRows.length && (
          <div className="rounded-3xl border border-dashed border-gray-300 bg-white px-5 py-12 text-center text-sm font-semibold text-gray-400">
            현재 검색 조건에 맞는 역사교실이 없습니다.
          </div>
        )}
        {totalAssignmentPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
            <div className="text-xs font-semibold text-gray-500">
              {assignmentPage} / {totalAssignmentPages}페이지
            </div>
            <div className="flex items-center gap-2">
              <HistoryActionButton
                icon="chevronLeft"
                label="이전"
                type="button"
                onClick={() =>
                  setAssignmentPage((current) => Math.max(1, current - 1))
                }
                disabled={assignmentPage <= 1}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              ></HistoryActionButton>
              {Array.from(
                { length: totalAssignmentPages },
                (_, index) => index + 1,
              ).map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setAssignmentPage(page)}
                  className={`h-10 w-10 rounded-xl text-xs font-black ${
                    page === assignmentPage
                      ? "bg-blue-600 text-white"
                      : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {page}
                </button>
              ))}
              <HistoryActionButton
                icon="chevronRight"
                label="다음"
                type="button"
                onClick={() =>
                  setAssignmentPage((current) =>
                    Math.min(totalAssignmentPages, current + 1),
                  )
                }
                disabled={assignmentPage >= totalAssignmentPages}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              ></HistoryActionButton>
            </div>
          </div>
        )}
      </section>
      {exemptionPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-5 backdrop-blur-sm">
          <div
            id="history-exemption-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-exemption-title"
            tabIndex={-1}
            className="history-modal flex max-h-[92vh] w-full max-w-[min(96vw,72rem)] overflow-hidden rounded-3xl bg-white shadow-2xl"
          >
            <aside className="history-exemption-sidebar hidden w-56 shrink-0 border-r border-slate-200 bg-slate-50 p-4 md:block">
              <div className="mb-4 px-2">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-500">
                  Exemption
                </div>
                <h2 className="mt-1 text-lg font-black text-slate-900">
                  면제권 관리
                </h2>
              </div>
              {[
                ["grant", "면제권 부여", ""],
                ["requests", "면제권 사용 요청", pendingExemptionRequestCount],
                ["granted", "부여된 면제권", activeExemptionCount],
              ].map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setExemptionModalTab(value as ExemptionModalTab)
                  }
                  className={`mb-2 flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left text-sm font-black transition ${
                    exemptionModalTab === value
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-700 hover:bg-white"
                  }`}
                >
                  <span>{label}</span>
                  {count !== "" && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        exemptionModalTab === value
                          ? "bg-white/20 text-white"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              ))}
            </aside>

            <div className="history-exemption-content flex min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                  <h2
                    id="history-exemption-title"
                    className="text-xl font-black text-slate-900"
                  >
                    면제권 관리
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <HistoryActionButton
                    icon="refresh"
                    label={loadingExemptions ? "새로고침 중" : "새로고침"}
                    type="button"
                    onClick={() => void loadExemptionData()}
                    disabled={loadingExemptions}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  ></HistoryActionButton>
                  <HistoryActionButton
                    icon="close"
                    label="닫기"
                    type="button"
                    onClick={closeExemptionPanel}
                    className="h-10 rounded-xl bg-blue-600 px-4 text-xs font-black text-white hover:bg-blue-700"
                  ></HistoryActionButton>
                </div>
              </div>

              <div className="history-exemption-tabs flex gap-2 overflow-x-auto border-b border-slate-200 px-4 py-3 md:hidden">
                {[
                  ["grant", "면제권 부여"],
                  [
                    "requests",
                    `면제권 사용 요청 ${pendingExemptionRequestCount}`,
                  ],
                  ["granted", `부여된 면제권 ${activeExemptionCount}`],
                ].map(([value, label]) => (
                  <HistoryActionButton
                    icon={
                      value === "grant"
                        ? "plus"
                        : value === "requests"
                          ? "clipboard"
                          : "ticket"
                    }
                    label={String(label)}
                    key={value}
                    type="button"
                    onClick={() =>
                      setExemptionModalTab(value as ExemptionModalTab)
                    }
                    className={`h-10 shrink-0 rounded-xl px-3 text-xs font-black ${
                      exemptionModalTab === value
                        ? "bg-blue-600 text-white"
                        : "border border-slate-200 bg-white text-slate-700"
                    }`}
                  ></HistoryActionButton>
                ))}
              </div>

              <div className="history-modal-padding min-h-0 flex-1 overflow-y-auto bg-white p-5">
                {exemptionLoadError && (
                  <div
                    role="alert"
                    className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
                  >
                    {exemptionLoadError}
                  </div>
                )}
                {exemptionModalTab === "grant" && (
                  <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap gap-2">
                      {[
                        ["students", "학생별 부여"],
                        ["class", "학급 단위 부여"],
                      ].map(([value, label]) => (
                        <HistoryActionButton
                          icon={value === "class" ? "users" : "plus"}
                          label={String(label)}
                          key={value}
                          type="button"
                          onClick={() =>
                            setExemptionGrantMode(value as ExemptionGrantMode)
                          }
                          className={`rounded-xl border px-4 py-2 text-sm font-black ${
                            exemptionGrantMode === value
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        ></HistoryActionButton>
                      ))}
                    </div>

                    {exemptionGrantMode === "students" ? (
                      <div className="mt-4 space-y-3">
                        <label className="block">
                          <span className="mb-1 block text-xs font-bold text-slate-500">
                            학생 검색
                          </span>
                          <input
                            lang="ko"
                            inputMode="text"
                            type="text"
                            value={exemptionStudentSearch}
                            onChange={(event) =>
                              setExemptionStudentSearch(event.target.value)
                            }
                            placeholder="이름, 학년, 반, 번호로 검색"
                            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                          />
                        </label>
                        {searchedExemptionStudents.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {searchedExemptionStudents.map((student) => (
                              <button
                                key={student.uid}
                                type="button"
                                onClick={() => {
                                  setExemptionSelectedStudentUids((prev) => [
                                    ...prev,
                                    student.uid,
                                  ]);
                                  setExemptionStudentSearch("");
                                }}
                                className="rounded-full border border-blue-100 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50"
                              >
                                {formatStudentBadgeLabel(student)}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="flex min-h-10 flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2">
                          {exemptionSelectedStudents.map((student) => (
                            <span
                              key={student.uid}
                              className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700"
                            >
                              {formatStudentBadgeLabel(student)}
                              <button
                                type="button"
                                onClick={() =>
                                  setExemptionSelectedStudentUids((prev) =>
                                    prev.filter((uid) => uid !== student.uid),
                                  )
                                }
                                className="text-blue-400 hover:text-blue-700"
                                aria-label={`${student.name} 선택 해제`}
                              >
                                x
                              </button>
                            </span>
                          ))}
                          {!exemptionSelectedStudents.length && (
                            <span className="px-2 py-1 text-xs font-semibold text-slate-400">
                              선택된 학생이 없습니다.
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-black text-slate-600">
                              {exemptionClassLabel}
                            </div>
                            <div className="text-xs font-bold text-blue-700">
                              부여 대상 {activeExemptionClassStudents.length}명
                              {excludedClassExemptionStudentUids.length > 0
                                ? ` · 제외 ${excludedClassExemptionStudentUids.length}명`
                                : ""}
                            </div>
                          </div>
                          <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-2">
                            {exemptionClassStudents.map((student) => {
                              const excluded =
                                excludedClassExemptionStudentUids.includes(
                                  student.uid,
                                );
                              return (
                                <span
                                  key={student.uid}
                                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${
                                    excluded
                                      ? "border-slate-200 bg-white text-slate-400 line-through"
                                      : "border-blue-100 bg-blue-50 text-blue-700"
                                  }`}
                                >
                                  {student.number ? `${student.number}번 ` : ""}
                                  {student.name || "학생"}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExcludedClassExemptionStudentUids(
                                        (prev) =>
                                          excluded
                                            ? prev.filter(
                                                (uid) => uid !== student.uid,
                                              )
                                            : [...prev, student.uid],
                                      )
                                    }
                                    className={`font-black ${
                                      excluded
                                        ? "text-slate-400 hover:text-blue-600"
                                        : "text-blue-400 hover:text-blue-700"
                                    }`}
                                    aria-label={`${student.name || "학생"} ${
                                      excluded ? "제외 해제" : "제외"
                                    }`}
                                  >
                                    x
                                  </button>
                                </span>
                              );
                            })}
                            {!exemptionClassStudents.length && (
                              <span className="px-2 py-1 text-xs font-semibold text-slate-400">
                                담임 학급 학생 명단을 찾지 못했습니다.
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <label className="block">
                            <span className="mb-1 block text-xs font-bold text-slate-500">
                              학년
                            </span>
                            <select
                              value={exemptionTargetGrade}
                              onChange={(event) => {
                                setExemptionTargetGrade(event.target.value);
                                setExemptionTargetClass("");
                              }}
                              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                            >
                              <option value="">학년 선택</option>
                              {gradeOptions.map((grade) => (
                                <option key={grade} value={grade}>
                                  {grade}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-bold text-slate-500">
                              반
                            </span>
                            <select
                              value={exemptionTargetClass}
                              onChange={(event) =>
                                setExemptionTargetClass(event.target.value)
                              }
                              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                            >
                              <option value="">반 선택</option>
                              {exemptionClassOptions.map((className) => (
                                <option key={className} value={className}>
                                  {className}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="rounded-2xl border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-blue-700 sm:col-span-2">
                            선택 대상 {activeExemptionClassStudents.length}명
                          </div>
                        </div>
                      </>
                    )}

                    <label className="mt-4 block">
                      <span className="mb-1 block text-xs font-bold text-slate-500">
                        부여 사유
                      </span>
                      <textarea
                        lang="ko"
                        inputMode="text"
                        value={exemptionReason}
                        onChange={(event) =>
                          setExemptionReason(event.target.value)
                        }
                        rows={3}
                        placeholder="예: 학교 행사, 공결, 상담 등"
                        className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                      />
                    </label>
                    <HistoryActionButton
                      icon="ticket"
                      label={grantingExemption ? "부여 중" : "면제권 부여"}
                      type="button"
                      onClick={() => void handleGrantExemptions()}
                      disabled={grantingExemption}
                      className="mt-3 h-11 w-full rounded-2xl bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-50"
                    ></HistoryActionButton>
                  </div>
                )}

                {exemptionModalTab === "requests" && (
                  <div className="flex min-h-[18rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-black text-slate-800">
                          면제권 사용 요청
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          대기 {pendingExemptionRequestCount}건 · 전체{" "}
                          {sortedExemptionRequests.length}건
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 max-h-[min(58vh,34rem)] min-h-0 flex-1 space-y-1.5 overflow-auto pr-1 [-webkit-overflow-scrolling:touch]">
                      <div className="sticky top-0 z-10 grid min-w-[50rem] grid-cols-[4rem_4rem_minmax(7rem,1fr)_minmax(8rem,1.2fr)_6rem_4.5rem_10rem] items-center gap-3 border-x border-b border-x-transparent border-b-slate-200 bg-white px-3 pb-1.5 text-[11px] font-bold text-slate-400">
                        <div>학급</div>
                        <div className="text-center">번호</div>
                        <div>학생</div>
                        <div>과제</div>
                        <div className="text-center">요청 일시</div>
                        <div className="text-center">상태</div>
                        <div className="text-center">처리</div>
                      </div>
                      {sortedExemptionRequests.map((request) => {
                        const isPending = request.status === "pending";
                        const isHighlighted =
                          highlightedExemptionRequestId === request.id;
                        const reviewing =
                          reviewingExemptionRequestId === request.id;
                        return (
                          <div
                            key={request.id}
                            className={`min-w-[50rem] rounded-xl border bg-white px-3 py-2 transition ${
                              isHighlighted
                                ? "border-blue-300 bg-blue-50 ring-2 ring-blue-50"
                                : "border-slate-200 hover:border-blue-100 hover:bg-blue-50/30"
                            }`}
                          >
                            <div className="grid grid-cols-[4rem_4rem_minmax(7rem,1fr)_minmax(8rem,1.2fr)_6rem_4.5rem_10rem] items-center gap-3">
                              <div className="truncate text-xs font-bold text-slate-500">
                                {request.grade && request.className
                                  ? `${request.grade}-${request.className}`
                                  : "-"}
                              </div>
                              <div className="truncate text-center text-xs font-bold text-slate-500">
                                {request.number || "-"}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-black text-slate-900">
                                  {request.studentName || request.uid || "학생"}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-xs font-black text-blue-700">
                                  {request.assignmentTitle || "역사교실"}
                                </div>
                                {request.reason && (
                                  <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
                                    {request.reason}
                                  </div>
                                )}
                              </div>
                              <div className="truncate text-center text-[11px] font-semibold text-slate-500">
                                {formatDateTimeLabel(request.createdAt)}
                              </div>
                              <div className="flex justify-center">
                                <span
                                  className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${getExemptionRequestStatusClassName(
                                    request.status,
                                  )}`}
                                >
                                  {formatExemptionRequestStatusLabel(
                                    request.status,
                                  )}
                                </span>
                              </div>
                              <div className="flex items-center justify-end gap-2">
                                {isPending ? (
                                  <>
                                    <HistoryActionButton
                                      icon="close"
                                      label="반려"
                                      type="button"
                                      onClick={() =>
                                        void handleReviewExemptionRequest(
                                          request.id,
                                          "rejected",
                                        )
                                      }
                                      disabled={reviewing}
                                      className="h-8 rounded-lg border border-rose-200 bg-white px-2.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                    ></HistoryActionButton>
                                    <HistoryActionButton
                                      icon="check"
                                      label="승인"
                                      type="button"
                                      onClick={() =>
                                        void handleReviewExemptionRequest(
                                          request.id,
                                          "approved",
                                        )
                                      }
                                      disabled={reviewing}
                                      className="h-8 rounded-lg bg-blue-600 px-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                                    ></HistoryActionButton>
                                  </>
                                ) : (
                                  <span className="truncate text-[11px] font-semibold text-slate-400">
                                    {formatDateTimeLabel(request.reviewedAt)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {!sortedExemptionRequests.length && (
                      <div className="mt-3 rounded-2xl border border-dashed border-slate-200 px-4 py-12 text-center text-sm font-semibold text-slate-400">
                        접수된 면제권 사용 요청이 없습니다.
                      </div>
                    )}
                  </div>
                )}

                {exemptionModalTab === "granted" && (
                  <div className="flex min-h-[24rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="mr-2">
                          <div className="text-sm font-black text-slate-800">
                            학생별 면제권 보유 현황
                          </div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">
                            {grantedExemptionGradeCount}개 학년 ·{" "}
                            {grantedExemptionClassCount}개 반 ·{" "}
                            {grantedExemptionStudentRows.length}명
                          </div>
                        </div>
                        <select
                          value={grantedExemptionGradeFilter}
                          onChange={(event) => {
                            setGrantedExemptionGradeFilter(event.target.value);
                            setGrantedExemptionClassFilter("");
                          }}
                          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                          aria-label="면제권 보유 현황 학년 필터"
                        >
                          <option value="">전체 학년</option>
                          {grantedExemptionGradeOptions.map((grade) => (
                            <option key={grade} value={grade}>
                              {grade}학년
                            </option>
                          ))}
                        </select>
                        <select
                          value={grantedExemptionClassFilter}
                          onChange={(event) =>
                            setGrantedExemptionClassFilter(event.target.value)
                          }
                          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                          aria-label="면제권 보유 현황 반 필터"
                        >
                          <option value="">전체 반</option>
                          {grantedExemptionClassOptions.map((className) => (
                            <option key={className} value={className}>
                              {className}반
                            </option>
                          ))}
                        </select>
                        <input
                          lang="ko"
                          inputMode="text"
                          type="text"
                          value={grantedExemptionNameSearch}
                          onChange={(event) =>
                            setGrantedExemptionNameSearch(event.target.value)
                          }
                          placeholder="학생 이름 검색"
                          className="h-9 w-36 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                        />
                        <HistoryActionButton
                          icon="trash"
                          label="초기화"
                          type="button"
                          onClick={() => void handleResetGrantedExemptions()}
                          disabled={
                            resettingGrantedExemptions ||
                            resettableGrantedExemptionIds.length <= 0
                          }
                          className="h-8 rounded-full border border-rose-100 bg-rose-50 px-3 text-xs font-black text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-100 disabled:text-slate-400"
                          title={`보유 면제권 ${resettableGrantedExemptionIds.length}개 회수`}
                        ></HistoryActionButton>
                      </div>
                      <div className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                        총 {activeExemptionCount}개 · 표시{" "}
                        {filteredGrantedExemptionRows.length}명
                      </div>
                    </div>
                    <div
                      className="mt-3 max-h-[min(58vh,34rem)] min-h-0 flex-1 space-y-1.5 overflow-auto pr-1 [-webkit-overflow-scrolling:touch]"
                      onWheel={(event) => {
                        const target = event.currentTarget;
                        const canScrollDown =
                          event.deltaY > 0 &&
                          target.scrollTop + target.clientHeight <
                            target.scrollHeight;
                        const canScrollUp =
                          event.deltaY < 0 && target.scrollTop > 0;
                        if (canScrollDown || canScrollUp) {
                          target.scrollTop += event.deltaY;
                          event.preventDefault();
                        }
                      }}
                    >
                      <div className="sticky top-0 z-10 grid min-w-[52rem] grid-cols-[4rem_4rem_4rem_minmax(9rem,1fr)_4.5rem_5.5rem_4.5rem_3.5rem] items-center gap-3 border-x border-b border-x-transparent border-b-slate-200 bg-white px-3 pb-1.5 text-[11px] font-bold text-slate-400">
                        <div className="text-center">학년</div>
                        <div className="text-center">반</div>
                        <div className="text-center">번호</div>
                        <div>이름</div>
                        <div className="text-center">보유</div>
                        <div className="text-center">사용 요청</div>
                        <div className="text-center">사용됨</div>
                        <div className="text-center">회수</div>
                      </div>
                      {pagedGrantedExemptionRows.map((row) => {
                        const expanded =
                          expandedExemptionStudentKey === row.key;
                        const revoking =
                          revokingExemptionStudentKey === row.key;
                        return (
                          <div
                            key={row.key}
                            className={`min-w-[52rem] rounded-xl border bg-white px-3 py-2 transition ${
                              expanded
                                ? "border-blue-200 ring-2 ring-blue-50"
                                : "border-slate-200 hover:border-blue-100 hover:bg-blue-50/30"
                            }`}
                          >
                            <div className="grid grid-cols-[4rem_4rem_4rem_minmax(9rem,1fr)_4.5rem_5.5rem_4.5rem_3.5rem] items-center gap-3">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedExemptionStudentKey((current) =>
                                    current === row.key ? "" : row.key,
                                  )
                                }
                                className="contents text-left"
                                aria-expanded={expanded}
                              >
                                <div className="truncate text-center text-xs font-bold text-slate-500">
                                  {row.grade || "-"}
                                </div>
                                <div className="truncate text-center text-xs font-bold text-slate-500">
                                  {row.className || "-"}
                                </div>
                                <div className="truncate text-center text-xs font-bold text-slate-500">
                                  {row.number || "-"}
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-black text-slate-900">
                                    {row.studentName}
                                  </div>
                                </div>
                                <div className="text-center text-xl font-black leading-none text-blue-700">
                                  {row.availableCount}
                                </div>
                                <div className="text-center text-base font-black text-amber-700">
                                  {row.requestedCount}
                                </div>
                                <div className="text-center text-base font-black text-slate-600">
                                  {row.usedCount}
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRevokeExemptions(row)}
                                disabled={row.availableCount <= 0 || revoking}
                                className="flex h-8 w-8 items-center justify-center justify-self-center rounded-full border border-rose-100 bg-rose-50 text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300"
                                aria-label={`${row.studentName} 면제권 회수`}
                                title={
                                  row.availableCount > 1
                                    ? `면제권 회수 (${row.availableCount}개 중 선택)`
                                    : "면제권 회수"
                                }
                              >
                                <DashboardIcon
                                  name="trash"
                                  className={`h-4 w-4 ${revoking ? "animate-pulse" : ""}`}
                                />
                              </button>
                            </div>
                            {expanded && (
                              <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                                <div className="mb-2 text-xs font-black text-slate-500">
                                  부여 상세
                                </div>
                                <div className="space-y-1.5">
                                  {row.items.map((item) => (
                                    <div
                                      key={item.id}
                                      className="grid grid-cols-[5rem_minmax(7rem,0.7fr)_minmax(10rem,1fr)] gap-2 rounded-lg bg-white px-3 py-2 text-xs"
                                    >
                                      <div className="font-black text-blue-700">
                                        {formatExemptionStatusLabel(
                                          item.status,
                                        )}
                                      </div>
                                      <div className="font-semibold text-slate-500">
                                        {formatDateTimeLabel(item.createdAt)}
                                      </div>
                                      <div className="min-w-0 truncate font-semibold text-slate-600">
                                        {item.reason || "부여 사유 없음"}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {filteredGrantedExemptionRows.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 border-t border-slate-100 pt-3">
                        {Array.from(
                          { length: grantedExemptionPageCount },
                          (_, index) => index + 1,
                        ).map((pageNumber) => (
                          <button
                            key={pageNumber}
                            type="button"
                            onClick={() => {
                              setGrantedExemptionPage(pageNumber);
                              setExpandedExemptionStudentKey("");
                            }}
                            className={`h-8 min-w-8 rounded-lg px-2 text-xs font-black ${
                              pageNumber === grantedExemptionCurrentPage
                                ? "bg-blue-600 text-white"
                                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}
                            aria-current={
                              pageNumber === grantedExemptionCurrentPage
                                ? "page"
                                : undefined
                            }
                          >
                            {pageNumber}
                          </button>
                        ))}
                      </div>
                    )}
                    {!filteredGrantedExemptionRows.length && (
                      <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-12 text-center text-sm font-semibold text-slate-400">
                        조건에 맞는 면제권 보유 학생이 없습니다.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-5 backdrop-blur-sm">
          <div
            id="history-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-create-title"
            tabIndex={-1}
            className="history-modal flex max-h-[94vh] w-full max-w-[min(96vw,96rem)] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
          >
            <div className="history-modal-header flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-5 py-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-500">
                  New History Classroom
                </div>
                <h2
                  id="history-create-title"
                  className="mt-1 text-xl font-black text-gray-900"
                >
                  {worksheetEditingAssignmentId
                    ? "역사교실 자료 수정"
                    : "새 역사교실 등록"}
                </h2>
              </div>
              <HistoryActionButton
                icon="close"
                label="닫기"
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
              ></HistoryActionButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-4">
              <div className="mx-auto max-w-6xl space-y-4">
                <section className="history-create-grid grid gap-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_18rem]">
                  <div className="min-w-0 md:col-span-2 xl:col-span-2">
                    <HistoryClassroomSourceSelect
                      id="history-create-source"
                      value={selectedMapId}
                      sources={worksheetSources}
                      loading={loadingLessonSources}
                      error={lessonSourceError}
                      currentLabel={worksheetSourceAssignment?.title}
                      onChange={(nextMapId) => {
                        setSelectedMapId(nextMapId);
                        if (
                          !worksheetSourceAssignment ||
                          getHistoryClassroomSourceId(
                            worksheetSourceAssignment,
                          ) !== nextMapId
                        ) {
                          setWorksheetSourceAssignment(null);
                          setWorksheetImportSourceId("");
                          setWorksheetImportSourceTitle("");
                        }
                      }}
                    />
                  </div>

                  <div className="history-number-fields grid gap-3 md:col-span-2 md:grid-cols-2 xl:col-span-2 xl:grid-cols-4">
                    <div>
                      <label className="mb-1 block whitespace-nowrap text-[11px] font-bold text-gray-500">
                        제한 시간(분)
                      </label>
                      <NumericInput
                        type="number"
                        min={0}
                        value={timeLimitMinutes}
                        onChange={(e) =>
                          setTimeLimitMinutes(Number(e.target.value) || 0)
                        }
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block whitespace-nowrap text-[11px] font-bold text-gray-500">
                        재도전 제한 시간(분)
                      </label>
                      <NumericInput
                        type="number"
                        min={0}
                        value={cooldownMinutes}
                        onChange={(e) =>
                          setCooldownMinutes(Number(e.target.value) || 0)
                        }
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block whitespace-nowrap text-[11px] font-bold text-gray-500">
                        응시 제한 기간(일)
                      </label>
                      <NumericInput
                        type="number"
                        min={1}
                        value={dueWindowDays}
                        onChange={(e) =>
                          setDueWindowDays(
                            normalizeDueWindowDaysInput(e.target.value),
                          )
                        }
                        placeholder="없음"
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block whitespace-nowrap text-[11px] font-bold text-gray-500">
                        통과 기준 (%)
                      </label>
                      <NumericInput
                        type="number"
                        min={0}
                        max={100}
                        value={passThresholdPercent}
                        onChange={(e) =>
                          setPassThresholdPercent(
                            Math.min(
                              100,
                              Math.max(0, Number(e.target.value) || 0),
                            ),
                          )
                        }
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="min-w-0 md:col-span-2 xl:col-span-2">
                    <AssignmentStudentPicker
                      id="history-create-add-reason"
                      students={students}
                      selectedUids={selectedStudentUids}
                      initialGrade={targetGrade}
                      initialClass={targetClass}
                      reason={newStudentReason}
                      reasonOther={newStudentReasonOther}
                      reasonError={newStudentReasonError}
                      onReasonChange={(value, other) => {
                        setNewStudentReason(value);
                        setNewStudentReasonOther(other);
                        setNewStudentReasonError(false);
                      }}
                      onAdd={(student) => {
                        if (!addAssignmentStudent(student.uid)) return false;
                        setTargetGrade(student.grade);
                        setTargetClass(student.className);
                        return true;
                      }}
                    />
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-3 md:col-span-2 xl:col-span-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-sm font-bold text-gray-700">
                        배정 학생
                      </div>
                      <div className="inline-flex shrink-0 items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 whitespace-nowrap">
                        {selectedStudents.length}명
                      </div>
                    </div>
                    <div className="space-y-2">
                      {selectedStudents.map((student) => (
                        <AssignedStudentRow
                          key={student.uid}
                          student={student}
                          id={`history-create-reason-${student.uid}`}
                          reason={studentReasons[student.uid] || ""}
                          invalid={
                            showReasonErrors &&
                            otherReasonUids.includes(student.uid) &&
                            !String(studentReasons[student.uid] || "").trim()
                          }
                          onReasonChange={(reason) => {
                            setStudentReasons((prev) => ({
                              ...prev,
                              [student.uid]: reason,
                            }));
                            setOtherReasonUids((prev) => [
                              ...new Set([...prev, student.uid]),
                            ]);
                          }}
                          onRemove={() =>
                            setSelectedStudentUids((prev) =>
                              prev.filter((uid) => uid !== student.uid),
                            )
                          }
                        />
                      ))}
                      {!selectedStudents.length && (
                        <div className="text-sm text-gray-400">
                          배정 학생이 없습니다.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 md:col-span-2 xl:col-span-1 xl:col-start-3 xl:row-span-4 xl:row-start-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-gray-700">
                          선택한 자료
                        </div>
                      </div>
                      <div className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-blue-700">
                        {blanks.length}개 빈칸
                      </div>
                    </div>
                    <div className="mt-3 overflow-hidden rounded-2xl border border-blue-100 bg-white">
                      <div className="flex aspect-[4/3] items-center justify-center bg-gray-50">
                        {selectedMap?.pdfPageImages?.[0]?.imageUrl ? (
                          <img
                            src={selectedMap.pdfPageImages[0].imageUrl}
                            alt={selectedMap.title}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <div className="px-4 text-center text-xs font-semibold text-gray-400">
                            미리보기 이미지가 없습니다.
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-gray-700">
                        {selectedMap?.title || "자료 미선택"}
                      </span>
                    </div>
                  </div>

                  {false && (
                    <div className="rounded-2xl bg-gray-50 p-4 md:col-span-2 xl:col-span-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-bold text-gray-700">
                            빈칸 목록
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            추가한 단어는 우측 하단 패널에서도 빠르게 선택할 수
                            있습니다.
                          </div>
                        </div>
                        <div className="inline-flex shrink-0 items-center rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-600 whitespace-nowrap">
                          {blanks.length}개
                        </div>
                      </div>
                      <div className="space-y-2">
                        {sortedBlanks.map((blank, index) => (
                          <div
                            key={blank.id}
                            className={`rounded-2xl border bg-white p-3 transition ${blank.id === selectedBlankId ? "border-blue-300 shadow-md shadow-blue-100" : "border-gray-200"}`}
                            onClick={() => handleFocusBlankFromList(blank.id)}
                          >
                            <div className="mb-2 flex items-center justify-between gap-2 text-xs font-bold text-gray-500">
                              <span>
                                빈칸 {index + 1} / p.{blank.page}
                              </span>
                              <HistoryActionButton
                                icon="trash"
                                label="삭제"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeBlank(blank.id);
                                }}
                                className="text-red-500"
                              ></HistoryActionButton>
                            </div>
                            <input
                              lang="ko"
                              inputMode="text"
                              value={blank.answer}
                              onChange={(e) =>
                                handleBlankChange(blank.id, e.target.value)
                              }
                              placeholder="정답 입력"
                              className="hidden"
                            />
                            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                              {blank.answer || "답안이 비어 있습니다."}
                            </div>
                          </div>
                        ))}
                        {!blanks.length && (
                          <div className="text-sm text-gray-400">
                            수업 자료에서 영역을 드래그하거나 OCR 단어를 선택해
                            빈칸을 추가하세요.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 md:col-span-2 sm:flex-row sm:justify-end xl:col-span-3">
                    {worksheetEditingAssignmentId && (
                      <HistoryActionButton
                        icon="close"
                        label="수정 취소"
                        type="button"
                        onClick={() => {
                          setWorksheetEditingAssignmentId("");
                          setWorksheetEditingIsPublished(true);
                          setWorksheetImportSourceId("");
                          setWorksheetImportSourceTitle("");
                          setWorksheetSourceAssignment(null);
                          setTitle("");
                          setDescription("");
                          setTimeLimitMinutes(
                            NEW_ASSIGNMENT_DEFAULTS.timeLimitMinutes,
                          );
                          setCooldownMinutes(
                            NEW_ASSIGNMENT_DEFAULTS.cooldownMinutes,
                          );
                          setDueWindowDays("");
                          setPassThresholdPercent(
                            NEW_ASSIGNMENT_DEFAULTS.passThresholdPercent,
                          );
                          setTargetGrade(NEW_ASSIGNMENT_DEFAULTS.targetGrade);
                          setTargetClass(NEW_ASSIGNMENT_DEFAULTS.targetClass);
                          setSelectedStudentUids([]);
                          setStudentReasons({});
                          setOtherReasonUids([]);
                          setShowReasonErrors(false);
                          setNewStudentReason("");
                          setNewStudentReasonOther(false);
                          setNewStudentReasonError(false);
                          setBlanks([]);
                          setSelectedBlankId("");
                          setDraftBlank(null);
                          setDraftBlankAnswer("");
                          setBlankEditorMode(null);
                          setBlankEditorAnswer("");
                          blankEditorComposingRef.current = false;
                          setShowAllBlankTags(false);
                        }}
                        className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 sm:w-auto"
                      ></HistoryActionButton>
                    )}
                    <HistoryActionButton
                      icon="save"
                      label={
                        saving
                          ? "저장 중..."
                          : worksheetEditingAssignmentId
                            ? "역사교실 수정 저장"
                            : "역사교실 저장"
                      }
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={saving}
                      className="rounded-2xl bg-orange-500 px-6 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60 sm:w-auto"
                    ></HistoryActionButton>
                  </div>
                </section>

                {false && (
                  <section className="hidden">
                    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-gray-700">
                            수업 자료
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            수업 자료에 저장된 빈칸과 정답 배치를 확인합니다.
                          </div>
                        </div>
                      </div>

                      {false && (
                        <div className="mb-4 space-y-3 lg:hidden">
                          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400">
                              Tool
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <HistoryActionButton
                                icon="edit"
                                label="텍스트 박스"
                                type="button"
                                onClick={() => setWorksheetTool("box")}
                                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                                  worksheetTool === "box"
                                    ? "bg-blue-600 text-white shadow-sm"
                                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                                }`}
                              ></HistoryActionButton>
                              <HistoryActionButton
                                icon="search"
                                label="OCR 선택"
                                type="button"
                                onClick={() => setWorksheetTool("ocr")}
                                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                                  worksheetTool === "ocr"
                                    ? "bg-blue-600 text-white shadow-sm"
                                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                                }`}
                              ></HistoryActionButton>
                            </div>
                          </div>

                          {(draftBlank ||
                            selectedBlank ||
                            sortedBlanks.length > 0) && (
                            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400">
                                  Words
                                </div>
                                <div className="text-[11px] font-semibold text-gray-500">
                                  {sortedBlanks.length}개
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {visibleBlankTags.map((blank, index) => (
                                  <button
                                    key={blank.id}
                                    type="button"
                                    onClick={() =>
                                      handleFocusBlankFromList(blank.id)
                                    }
                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                                      selectedBlankId === blank.id
                                        ? "border-blue-300 bg-blue-50 text-blue-700"
                                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                                    }`}
                                  >
                                    {blank.answer || `빈칸 ${index + 1}`}
                                  </button>
                                ))}
                                {sortedBlanks.length > 6 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setShowAllBlankTags((prev) => !prev)
                                    }
                                    className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100"
                                  >
                                    {showAllBlankTags
                                      ? "숨기기"
                                      : `더보기 +${sortedBlanks.length - visibleBlankTags.length}`}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {worksheetPageImages.length > 0 ? (
                        <div className="mx-auto max-w-[56rem]">
                          <LessonWorksheetStage
                            pageImages={worksheetPageImages}
                            blanks={worksheetBlanks}
                            textRegions={worksheetTextRegions}
                            mode="teacher-present"
                            annotationEnabled={false}
                            showPageLabel={false}
                          />
                        </div>
                      ) : (
                        <div className="rounded-3xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center text-gray-400">
                          수업 자료를 먼저 선택해 주세요.
                        </div>
                      )}
                    </div>

                    {false && (
                      <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="text-sm font-bold text-gray-700">
                          생성된 역사교실
                        </div>
                        <div className="mt-4 space-y-3">
                          {assignments.map((assignment) => (
                            <div
                              key={assignment.id}
                              className="rounded-2xl border border-gray-200 p-4"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-xs font-bold text-orange-500">
                                    {assignment.title}
                                  </div>
                                  <div className="text-lg font-black text-gray-900">
                                    {assignment.title}
                                  </div>
                                  <div className="mt-1 text-xs text-gray-500">
                                    통과 기준 {assignment.passThresholdPercent}%
                                    · 재도전 제한 {assignment.cooldownMinutes}분
                                  </div>
                                </div>
                                <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700 whitespace-nowrap">
                                  {(assignment.targetStudentNames.length
                                    ? `${assignment.targetStudentNames[0]}${assignment.targetStudentNames.length > 1 ? ` 외 ${assignment.targetStudentNames.length - 1}명` : ""}`
                                    : assignment.targetStudentName) ||
                                    "학생 미지정"}
                                </span>
                              </div>
                            </div>
                          ))}
                          {!assignments.length && (
                            <div className="text-sm text-gray-400">
                              아직 생성된 역사교실 과제가 없습니다.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {editingAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/35 px-2 py-6 sm:px-4">
          <div
            id="history-edit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-edit-title"
            tabIndex={-1}
            className={`history-modal relative flex h-[calc(100dvh-3rem)] max-h-[94vh] w-full flex-col overflow-hidden overscroll-contain rounded-3xl bg-white shadow-2xl transition-[max-width] ${
              previewOpen
                ? "max-w-[min(96vw,92rem)]"
                : "max-w-[min(96vw,72rem)]"
            }`}
          >
            <div className="history-modal-header shrink-0 flex items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
              <div>
                <div className="text-xs font-bold text-orange-500">
                  {editingAssignment.title}
                </div>
                <h2
                  id="history-edit-title"
                  className="text-xl font-black text-gray-900"
                >
                  역사교실 설정 수정
                </h2>
              </div>
              <HistoryActionButton
                icon="close"
                label="닫기"
                type="button"
                onClick={closeAssignmentEditor}
                className="shrink-0 text-sm font-bold text-gray-500 hover:text-gray-700"
              ></HistoryActionButton>
            </div>

            <div className="history-edit-body min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="history-edit-grid grid min-h-full min-w-0 grid-cols-1 gap-0">
                <div className="history-edit-settings history-modal-padding min-w-0 px-6 py-5">
                  <div className="space-y-4">
                    <div className="history-number-fields grid gap-3 md:grid-cols-4">
                      <div>
                        <label className="mb-1 block whitespace-nowrap text-[11px] font-bold text-gray-500">
                          제한 시간(분)
                        </label>
                        <NumericInput
                          type="number"
                          min={0}
                          value={editingTimeLimitMinutes}
                          onChange={(e) =>
                            setEditingTimeLimitMinutes(
                              Number(e.target.value) || 0,
                            )
                          }
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block whitespace-nowrap text-[11px] font-bold text-gray-500">
                          재도전 제한(분)
                        </label>
                        <NumericInput
                          type="number"
                          min={0}
                          value={editingCooldownMinutes}
                          onChange={(e) =>
                            setEditingCooldownMinutes(
                              Number(e.target.value) || 0,
                            )
                          }
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block whitespace-nowrap text-[11px] font-bold text-gray-500">
                          응시 제한 기간(일)
                        </label>
                        <NumericInput
                          type="number"
                          min={1}
                          value={editingDueWindowDays}
                          onChange={(e) =>
                            setEditingDueWindowDays(
                              normalizeDueWindowDaysInput(e.target.value),
                            )
                          }
                          placeholder="없음"
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block whitespace-nowrap text-[11px] font-bold text-gray-500">
                          통과 기준(%)
                        </label>
                        <NumericInput
                          type="number"
                          min={0}
                          max={100}
                          value={editingPassThresholdPercent}
                          onChange={(e) =>
                            setEditingPassThresholdPercent(
                              Math.min(
                                100,
                                Math.max(0, Number(e.target.value) || 0),
                              ),
                            )
                          }
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-orange-100 bg-orange-50/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-gray-700">
                            배포 자료
                          </div>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-600">
                          현재 {editingAssignment.title}
                        </span>
                      </div>
                      <div className="mt-3">
                        <HistoryClassroomSourceSelect
                          id="history-edit-source"
                          stacked
                          value={editingMapResourceId}
                          sources={worksheetSources}
                          loading={loadingLessonSources}
                          error={lessonSourceError}
                          currentLabel={editingAssignment.title}
                          onChange={(sourceId) => {
                            editingSourceRefreshRef.current += 1;
                            setRefreshingEditingSource(false);
                            setEditingRefreshSource(false);
                            setEditingMapResourceId(sourceId);
                          }}
                        />
                      </div>
                      {editingSelectedMap &&
                        (editingRefreshSource ||
                          editingSelectedMap.id !==
                            getHistoryClassroomSourceId(editingAssignment)) && (
                          <div className="mt-2 rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-blue-700">
                            저장하면 {editingSelectedMap.title} 자료의 최신
                            학습지와 빈칸{" "}
                            {editingSelectedMap.pdfBlanks?.length || 0}개를
                            반영합니다.
                          </div>
                        )}
                      {editingMapResourceId.startsWith("lesson:") && (
                        <HistoryActionButton
                          icon="refresh"
                          label={
                            refreshingEditingSource
                              ? "수업 자료 불러오는 중"
                              : "최신 수업 자료 반영"
                          }
                          type="button"
                          onClick={() => void handleRefreshEditingLesson()}
                          disabled={refreshingEditingSource || savingEdit}
                          className="mt-3 min-h-11 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                        ></HistoryActionButton>
                      )}
                    </div>

                    <div className="rounded-2xl bg-gray-50 p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-bold text-gray-700">
                            배정 학생
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingStudentSearchOpen((current) => {
                                return !current;
                              });
                            }}
                            className={`flex h-11 w-11 items-center justify-center rounded-full border text-xs font-bold transition ${
                              editingStudentSearchOpen
                                ? "border-blue-600 bg-blue-600 text-white"
                                : "border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
                            }`}
                            aria-label="배정 학생 추가"
                            title="배정 학생 추가"
                          >
                            <DashboardIcon
                              name="plus"
                              className="h-3.5 w-3.5"
                            />
                          </button>
                        </div>
                        <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-600">
                          {editingStudents.length}명
                        </div>
                      </div>
                      {editingStudentSearchOpen && (
                        <div className="mb-3">
                          <AssignmentStudentPicker
                            id="history-edit-add-reason"
                            students={students}
                            selectedUids={editingStudentUids}
                            initialGrade={
                              editingAssignment.targetGrade ||
                              NEW_ASSIGNMENT_DEFAULTS.targetGrade
                            }
                            initialClass={
                              editingAssignment.targetClass ||
                              NEW_ASSIGNMENT_DEFAULTS.targetClass
                            }
                            reason={editingNewStudentReason}
                            reasonOther={editingNewStudentReasonOther}
                            reasonError={editingNewStudentReasonError}
                            onReasonChange={(value, other) => {
                              setEditingNewStudentReason(value);
                              setEditingNewStudentReasonOther(other);
                              setEditingNewStudentReasonError(false);
                            }}
                            onAdd={(student) =>
                              addAssignmentStudent(student.uid, true)
                            }
                          />
                        </div>
                      )}
                      <div className="space-y-2">
                        {editingStudents.map((student) => (
                          <AssignedStudentRow
                            key={student.uid}
                            student={student}
                            id={`history-edit-reason-${student.uid}`}
                            reason={editingStudentReasons[student.uid] || ""}
                            invalid={
                              showEditingReasonErrors &&
                              editingOtherReasonUids.includes(student.uid) &&
                              !String(
                                editingStudentReasons[student.uid] || "",
                              ).trim()
                            }
                            onReasonChange={(reason) => {
                              setEditingStudentReasons((prev) => ({
                                ...prev,
                                [student.uid]: reason,
                              }));
                              setEditingOtherReasonUids((prev) => [
                                ...new Set([...prev, student.uid]),
                              ]);
                            }}
                            onRemove={() => {
                              setEditingStudentUids((prev) =>
                                prev.filter((uid) => uid !== student.uid),
                              );
                              setEditingStudentReasons((prev) => {
                                const next = { ...prev };
                                delete next[student.uid];
                                return next;
                              });
                            }}
                          />
                        ))}
                        {!editingStudents.length && (
                          <div className="text-sm text-gray-400">
                            배정 학생이 없습니다.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="history-edit-results flex min-h-0 min-w-0 flex-col overflow-visible border-t border-gray-200 bg-gray-50 px-5 py-5">
                  <section
                    aria-label="응시 현황 및 제출 내역"
                    className="history-attempt-section flex min-h-0 min-w-0 flex-col rounded-2xl border border-gray-200 bg-white p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-gray-700">
                        응시 현황
                      </h3>
                      <span className="text-xs font-semibold text-gray-500">
                        {editingAttemptStatusRows.length}명 · 제출{" "}
                        {editingVisibleResults.length}건
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                        완료 {editingAttemptStatusCounts.completed}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                        대기 {editingAttemptStatusCounts.pending}
                      </span>
                      <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">
                        미응시 {editingAttemptStatusCounts.overdueAbsent}
                      </span>
                    </div>
                    <div className="history-results-table mt-3 min-w-0">
                      <table className="history-attempt-table text-left text-xs">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            {["학생", "응시 결과", "관리"].map((label) => (
                              <th
                                key={label}
                                scope="col"
                                className="px-2 py-2.5 font-bold"
                              >
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {editingAttemptStatusRows.map((row) => {
                            const studentResults =
                              editingResultsByStudentUid.get(row.student.uid) ||
                              [];
                            const latestResult =
                              studentResults.find(
                                (result) =>
                                  result.status === "passed" || result.passed,
                              ) || studentResults[0];
                            const savedStudent =
                              !!editingAssignment &&
                              getHistoryClassroomAssignedStudentUids(
                                editingAssignment,
                              ).includes(row.student.uid);
                            const expanded = expandedAttemptUids.includes(
                              row.student.uid,
                            );
                            const historyId = `history-attempt-details-${row.student.uid}`;
                            const feedback =
                              attemptResetFeedback[row.student.uid];
                            const directFeedback =
                              directExemptionFeedback[
                                `${editingAssignment.id}:${row.student.uid}`
                              ];
                            const availableExemptions =
                              getAvailableStudentExemptions(
                                row.student.uid,
                                editingAssignment.id,
                              );
                            const completed =
                              !row.canResetAttempt ||
                              studentResults.some(
                                (result) =>
                                  result.passed || result.status === "passed",
                              );
                            const pendingRequest = exemptionRequests.some(
                              (request) =>
                                request.uid === row.student.uid &&
                                request.assignmentId === editingAssignment.id &&
                                request.status === "pending",
                            );
                            const exemptionDisabledReason = !savedStudent
                              ? "학생 배정을 먼저 저장해 주세요."
                              : completed
                                ? "이미 통과하거나 면제된 학생입니다."
                                : !editingAssignment.isPublished
                                  ? "과제를 공개한 뒤 사용할 수 있습니다."
                                  : isHistoryClassroomPastDue(editingAssignment)
                                    ? "응시 기간이 지났습니다."
                                    : pendingRequest
                                      ? "면제권 사용 요청을 먼저 검토해 주세요."
                                      : exemptionLoadError
                                        ? exemptionLoadError
                                        : !availableExemptions.length
                                          ? "사용 가능한 면제권이 없습니다."
                                          : "";
                            const toggleHistory = () => {
                              if (!studentResults.length) return;
                              setExpandedAttemptUids((prev) =>
                                prev.includes(row.student.uid)
                                  ? prev.filter(
                                      (uid) => uid !== row.student.uid,
                                    )
                                  : [...prev, row.student.uid],
                              );
                            };
                            return (
                              <React.Fragment key={row.student.uid}>
                                <tr
                                  aria-label={`${row.student.name} 응시 현황`}
                                  aria-expanded={
                                    studentResults.length ? expanded : undefined
                                  }
                                  aria-controls={
                                    studentResults.length
                                      ? historyId
                                      : undefined
                                  }
                                  tabIndex={
                                    studentResults.length ? 0 : undefined
                                  }
                                  onClick={toggleHistory}
                                  onKeyDown={(event) => {
                                    if (
                                      event.target === event.currentTarget &&
                                      (event.key === "Enter" ||
                                        event.key === " ")
                                    ) {
                                      event.preventDefault();
                                      toggleHistory();
                                    }
                                  }}
                                  className={`history-attempt-row border-b border-gray-100 text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${studentResults.length ? "cursor-pointer hover:bg-blue-50/50" : ""}`}
                                >
                                  <th
                                    scope="row"
                                    className="history-attempt-student px-2 py-1 font-bold text-gray-900"
                                  >
                                    <span className="history-attempt-number text-gray-500">
                                      {row.student.grade || "-"}-
                                      {row.student.className || "-"}{" "}
                                      {row.student.number || "-"}번
                                    </span>
                                    <span
                                      className="history-attempt-name"
                                      title={row.student.name}
                                    >
                                      {studentResults.length > 0 && (
                                        <span
                                          aria-hidden="true"
                                          className="mr-1 text-gray-400"
                                        >
                                          {expanded ? "▾" : "▸"}
                                        </span>
                                      )}
                                      {row.student.name}
                                    </span>
                                  </th>
                                  <td
                                    className="history-attempt-result px-2 py-1"
                                    title={feedback || row.detailLabel}
                                  >
                                    <span
                                      className={`history-attempt-status inline-block rounded-full border text-[11px] font-bold ${row.toneClassName}`}
                                    >
                                      {feedback
                                        ? feedback.includes("못했습니다")
                                          ? "해제 실패"
                                          : "해제됨"
                                        : row.statusLabel}
                                    </span>
                                    {latestResult &&
                                      row.statusLabel !== "면제 완료" && (
                                        <span className="history-attempt-percent font-semibold">
                                          {latestResult.percent}%
                                        </span>
                                      )}
                                    {feedback && (
                                      <span role="status" className="sr-only">
                                        {feedback}
                                      </span>
                                    )}
                                  </td>
                                  <td className="history-attempt-actions px-1 py-1">
                                    {row.canResetAttempt && (
                                      <HistoryActionButton
                                        icon="refresh"
                                        label={
                                          resettingAttemptUid ===
                                          row.student.uid
                                            ? "처리 중"
                                            : "리셋"
                                        }
                                        aria-label={`${row.student.name} 재응시 제한 리셋`}
                                        data-history-reset-label="true"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void handleResetStudentAttemptCooldown(
                                            row.student,
                                          );
                                        }}
                                        disabled={
                                          !!resettingAttemptUid ||
                                          !!applyingExemptionUid ||
                                          savingEdit ||
                                          deletingAssignment ||
                                          !savedStudent
                                        }
                                        title={
                                          !savedStudent
                                            ? "학생 배정을 먼저 저장해 주세요."
                                            : `${row.student.name} 재응시 제한 리셋`
                                        }
                                        className="rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                                      />
                                    )}
                                    {!completed && (
                                      <HistoryActionButton
                                        icon="ticket"
                                        label={
                                          applyingExemptionUid ===
                                          row.student.uid
                                            ? "처리 중"
                                            : "면제권 사용"
                                        }
                                        aria-label={`${row.student.name} 면제권 1장 사용${availableExemptions.length ? ` · 보유 ${availableExemptions.length}장` : ""}`}
                                        title={
                                          exemptionDisabledReason ||
                                          `${row.student.name} 면제권 1장 사용 · 보유 ${availableExemptions.length}장`
                                        }
                                        disabled={
                                          !!exemptionDisabledReason ||
                                          loadingExemptions ||
                                          !!applyingExemptionUid ||
                                          !!resettingAttemptUid ||
                                          savingEdit ||
                                          deletingAssignment
                                        }
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void handleApplyStudentExemption(
                                            row.student,
                                          );
                                        }}
                                        className="rounded-xl border border-blue-200 bg-white px-3 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                    )}
                                  </td>
                                </tr>
                                {directFeedback && (
                                  <tr className="history-attempt-feedback">
                                    <td
                                      colSpan={3}
                                      role="status"
                                      className="px-2 py-2 text-xs text-blue-700"
                                    >
                                      {directFeedback}
                                    </td>
                                  </tr>
                                )}
                                {studentResults.length > 0 && (
                                  <tr
                                    hidden={!expanded}
                                    id={historyId}
                                    className="history-attempt-details"
                                  >
                                    <td
                                      colSpan={3}
                                      className="border-b border-gray-200 bg-gray-50 px-3 py-2"
                                    >
                                      <div className="mb-1 text-[11px] font-bold text-gray-500">
                                        제출 내역 {studentResults.length}건
                                      </div>
                                      <ol>
                                        {studentResults.map((result) => (
                                          <li
                                            key={result.id}
                                            className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 border-t border-gray-200/70"
                                          >
                                            <span className="text-gray-500">
                                              {formatResultSubmittedAtLabel(
                                                result.createdAt,
                                              )}
                                            </span>
                                            <span className="ml-auto font-semibold text-gray-700">
                                              {result.score}/{result.total} ·{" "}
                                              {result.percent}% ·{" "}
                                              {describeHistoryResultStatus(
                                                result.status,
                                              )}
                                            </span>
                                            <HistoryActionButton
                                              icon="eye"
                                              label="자료 보기"
                                              type="button"
                                              onClick={() => {
                                                setPreviewOpen(false);
                                                setReviewResultId(result.id);
                                              }}
                                              className="min-h-[44px] shrink-0 px-2 font-bold text-blue-700 hover:text-blue-900"
                                              aria-label={`${row.student.name} 제출 자료 확인`}
                                            ></HistoryActionButton>
                                          </li>
                                        ))}
                                      </ol>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                          {!editingAttemptStatusRows.length && (
                            <tr>
                              <td
                                colSpan={3}
                                className="py-6 text-center text-gray-400"
                              >
                                배정된 학생이 없습니다.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              </div>
            </div>

            <div className="history-modal-padding shrink-0 min-w-0 border-t border-gray-200 bg-white/95 px-6 py-4 backdrop-blur">
              <div className="history-edit-footer flex min-w-0 flex-col gap-3">
                <label className="inline-flex items-center gap-3 self-start rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={editingIsPublished}
                    onClick={() => setEditingIsPublished((prev) => !prev)}
                    className={`relative h-7 w-12 rounded-full transition ${
                      editingIsPublished ? "bg-emerald-500" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${
                        editingIsPublished ? "left-6" : "left-1"
                      }`}
                    />
                  </button>
                  <div className="leading-tight">
                    <div className="text-sm font-bold text-gray-800">
                      학생들에게 공개
                    </div>
                    <div
                      className={`text-xs font-bold ${editingIsPublished ? "text-emerald-600" : "text-gray-500"}`}
                    >
                      {editingIsPublished ? "현재 공개됨" : "현재 비공개"}
                    </div>
                  </div>
                </label>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <HistoryActionButton
                    icon="trash"
                    label={deletingAssignment ? "삭제 중..." : "과제 삭제"}
                    type="button"
                    onClick={() => void handleDeleteAssignment()}
                    disabled={
                      savingEdit ||
                      deletingAssignment ||
                      !!resettingAttemptUid ||
                      !!applyingExemptionUid
                    }
                    className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                  ></HistoryActionButton>
                  <HistoryActionButton
                    icon="close"
                    label="취소"
                    type="button"
                    onClick={closeAssignmentEditor}
                    className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
                  ></HistoryActionButton>
                  <HistoryActionButton
                    icon="eye"
                    label={previewOpen ? "미리보기 닫기" : "미리보기"}
                    type="button"
                    onClick={() => {
                      if (previewOpen) {
                        setPreviewOpen(false);
                        return;
                      }
                      setPreviewCurrentPage(
                        editingPreviewAssignment?.pdfPageImages?.[0]?.page || 1,
                      );
                      setPreviewOpen(true);
                    }}
                    className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100"
                  ></HistoryActionButton>
                  <HistoryActionButton
                    icon="save"
                    label={savingEdit ? "저장 중..." : "설정 저장"}
                    type="button"
                    onClick={() => void handleSaveAssignmentEdit()}
                    disabled={
                      savingEdit ||
                      refreshingEditingSource ||
                      deletingAssignment ||
                      !!applyingExemptionUid ||
                      !!resettingAttemptUid
                    }
                    className="rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60"
                  ></HistoryActionButton>
                </div>
              </div>
            </div>

            {previewOpen && editingPreviewAssignment && (
              <div className="absolute inset-0 z-10 flex flex-col bg-white">
                <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                  <div>
                    <div className="text-xs font-bold text-blue-500">
                      학생용 미리보기
                    </div>
                    <div className="text-lg font-black text-gray-900">
                      읽기 전용으로 학생 화면을 확인합니다.
                    </div>
                    {previewDueStatusMeta?.detailLabel && (
                      <div className="mt-1 text-xs text-gray-500">
                        {previewDueStatusMeta.detailLabel}
                      </div>
                    )}
                  </div>
                  <HistoryActionButton
                    icon="chevronLeft"
                    label="설정으로 돌아가기"
                    type="button"
                    onClick={() => setPreviewOpen(false)}
                    className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                  ></HistoryActionButton>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
                  <HistoryClassroomAssignmentView
                    assignment={editingPreviewAssignment}
                    currentPage={previewCurrentPage}
                    onCurrentPageChange={setPreviewCurrentPage}
                    answers={previewAnswers}
                    readOnly
                    dueStatusLabel={previewDueStatusMeta?.label || null}
                    dueStatusTone={previewDueStatusMeta?.tone || "slate"}
                    layoutVariant="modalPreview"
                  />
                </div>
              </div>
            )}

            {reviewResult && editingPreviewAssignment && (
              <div className="absolute inset-0 z-20 flex flex-col bg-white">
                <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                  <div>
                    <div className="text-xs font-bold text-blue-500">
                      제출 답안 확인
                    </div>
                    <div className="text-lg font-black text-gray-900">
                      {reviewResult.studentName || "학생"} ·{" "}
                      {reviewResult.score}/{reviewResult.total} ·{" "}
                      {reviewResult.percent}%
                    </div>
                  </div>
                  <HistoryActionButton
                    icon="close"
                    label="닫기"
                    type="button"
                    onClick={() => setReviewResultId("")}
                    className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                  ></HistoryActionButton>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
                  <HistoryClassroomAssignmentView
                    assignment={editingPreviewAssignment}
                    currentPage={reviewCurrentPage}
                    onCurrentPageChange={setReviewCurrentPage}
                    answers={reviewResult.answers}
                    answerChecks={reviewAnswerChecks}
                    interactiveViewport
                    readOnly
                    layoutVariant="modalPreview"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {false && (draftBlank || selectedBlank || sortedBlanks.length > 0) && (
        <div className="fixed bottom-5 right-5 z-40 hidden w-[min(18rem,calc(100vw-2.5rem))] space-y-2.5 lg:block">
          <div className="rounded-2xl border border-gray-200 bg-white/96 p-3 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400">
                Tool
              </div>
              <div className="text-[11px] font-semibold text-gray-500">
                {worksheetTool === "box" ? "텍스트 박스" : "OCR 선택"}
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <HistoryActionButton
                icon="edit"
                label="텍스트 박스"
                type="button"
                onClick={() => setWorksheetTool("box")}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                  worksheetTool === "box"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              ></HistoryActionButton>
              <HistoryActionButton
                icon="search"
                label="OCR 선택"
                type="button"
                onClick={() => setWorksheetTool("ocr")}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                  worksheetTool === "ocr"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              ></HistoryActionButton>
            </div>
            <div className="mt-2 text-[11px] leading-4 text-gray-500">
              {worksheetTool === "box"
                ? "드래그한 크기 그대로 빈칸 상자를 만듭니다."
                : "글자 위를 클릭하거나 드래그하면 OCR 단어를 기준으로 빈칸이 잡힙니다."}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white/96 p-3 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400">
                Words
              </div>
              <div className="text-[11px] font-semibold text-gray-500">
                {sortedBlanks.length}개
              </div>
            </div>
            <div className="mt-2.5 flex max-h-28 flex-wrap gap-1.5 overflow-hidden">
              {visibleBlankTags.map((blank, index) => (
                <button
                  key={blank.id}
                  type="button"
                  onClick={() => handleFocusBlankFromList(blank.id)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                    selectedBlankId === blank.id
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {blank.answer || `빈칸 ${index + 1}`}
                </button>
              ))}
              {sortedBlanks.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllBlankTags((prev) => !prev)}
                  className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100"
                >
                  {showAllBlankTags
                    ? "숨기기"
                    : `더보기 +${sortedBlanks.length - visibleBlankTags.length}`}
                </button>
              )}
            </div>
          </div>

          {draftBlank ? (
            <div className="space-y-2.5 rounded-2xl border border-amber-200 bg-white/98 p-3 shadow-2xl backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-amber-900">
                  새 빈칸 초안
                </div>
                <HistoryActionButton
                  icon="close"
                  label="취소"
                  type="button"
                  onClick={handleCancelDraftBlank}
                  className="text-xs font-bold text-gray-500"
                ></HistoryActionButton>
              </div>
              <div className="text-xs text-gray-500">
                p.{draftBlank.page} 영역을 선택했습니다.
              </div>
              <input
                lang="ko"
                inputMode="text"
                type="text"
                value={draftBlankAnswer}
                onChange={(e) => setDraftBlankAnswer(e.target.value)}
                className="w-full rounded-lg border border-amber-300 px-2.5 py-1.5 text-sm"
                placeholder="정답을 입력해 주세요"
                autoFocus
              />
              <HistoryActionButton
                icon="plus"
                label="빈칸 추가"
                type="button"
                onClick={handleConfirmDraftBlank}
                className="w-full rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-600"
              ></HistoryActionButton>
            </div>
          ) : selectedBlank ? (
            <div className="space-y-2.5 rounded-2xl border border-blue-100 bg-white/98 p-3 shadow-2xl backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-blue-900">
                  선택한 빈칸
                </div>
                <HistoryActionButton
                  icon="trash"
                  label="삭제"
                  type="button"
                  onClick={() => removeBlank(selectedBlank.id)}
                  className="text-xs font-bold text-red-600"
                ></HistoryActionButton>
              </div>
              <div className="text-xs text-gray-500">
                p.{selectedBlank.page}
              </div>
              <input
                lang="ko"
                inputMode="text"
                type="text"
                value={selectedBlank.answer}
                onChange={(e) =>
                  handleBlankChange(selectedBlank.id, e.target.value)
                }
                className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
                placeholder="정답"
              />
            </div>
          ) : null}
        </div>
      )}

      {blankEditorMode && activeBlankEditor && (
        <div
          className="fixed inset-0 z-[90] bg-slate-950/45 backdrop-blur-sm"
          onClick={
            blankEditorMode === "create"
              ? handleCancelDraftBlank
              : closeBlankEditor
          }
        >
          <div className="flex h-full items-end justify-center p-3 md:items-center md:p-6">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="history-blank-editor-title"
              className="w-full max-w-lg overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.2)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                    {blankEditorMode === "create"
                      ? "새 빈칸 등록"
                      : "빈칸 답 수정"}
                  </div>
                  <h3
                    id="history-blank-editor-title"
                    className="mt-1 text-lg font-bold text-slate-900"
                  >
                    {blankEditorMode === "create"
                      ? "선택한 빈칸 답 입력"
                      : "선택한 빈칸 저장"}
                  </h3>
                </div>
                <HistoryActionButton
                  icon="close"
                  label="닫기"
                  type="button"
                  onClick={
                    blankEditorMode === "create"
                      ? handleCancelDraftBlank
                      : closeBlankEditor
                  }
                  className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                ></HistoryActionButton>
              </div>

              <div className="max-h-[calc(90vh-8rem)] overflow-y-auto px-5 py-5">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    답 입력
                  </span>
                  <input
                    lang="ko"
                    inputMode="text"
                    type="text"
                    value={blankEditorAnswer}
                    onChange={(event) => {
                      setBlankEditorAnswer(event.target.value);
                      if (blankEditorError) setBlankEditorError("");
                    }}
                    onKeyDown={handleBlankEditorKeyDown}
                    onCompositionStart={() => {
                      blankEditorComposingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                      blankEditorComposingRef.current = false;
                    }}
                    placeholder="정답을 입력해 주세요."
                    autoFocus
                    className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                  />
                </label>
                {blankEditorError && (
                  <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                    {blankEditorError}
                  </div>
                )}
                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                  입력창에서 Enter를 누르면 바로
                  {blankEditorMode === "create" ? " 등록" : " 저장"}됩니다.
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
                {blankEditorMode === "edit" && selectedBlank && (
                  <HistoryActionButton
                    icon="trash"
                    label="삭제"
                    type="button"
                    onClick={() => removeBlank(selectedBlank.id)}
                    className="mr-auto rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                  ></HistoryActionButton>
                )}
                <HistoryActionButton
                  icon="close"
                  label="취소"
                  type="button"
                  onClick={
                    blankEditorMode === "create"
                      ? handleCancelDraftBlank
                      : closeBlankEditor
                  }
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                ></HistoryActionButton>
                <HistoryActionButton
                  icon="save"
                  label={blankEditorMode === "create" ? "등록" : "저장"}
                  type="button"
                  onClick={handleSubmitBlankEditor}
                  className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                ></HistoryActionButton>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
                .history-assignment-card > div:last-child {
                    display: none;
                }
            `}</style>
    </div>
  );
};

export default ManageHistoryClassroom;
