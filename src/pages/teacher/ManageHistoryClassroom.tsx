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
  setDoc,
} from "firebase/firestore";
import { useNavigate, useSearchParams } from "react-router-dom";
import HistoryClassroomAssignmentView from "../../components/common/HistoryClassroomAssignmentView";
import LessonWorksheetStage from "../../components/common/LessonWorksheetStage";
import { useAuth } from "../../contexts/AuthContext";
import { cloneDefaultMenus, sanitizeMenuConfig } from "../../constants/menus";
import { db, getHttpsCallable } from "../../lib/firebase";
import {
  buildAnswerOptions,
  buildHistoryClassroomPublishWindow,
  formatHistoryClassroomRemainingWindow,
  getHistoryClassroomAssignedStudentUids,
  getHistoryClassroomDueAtMs,
  getHistoryClassroomRemainingMs,
  getHistoryClassroomStudentRetryResetMs,
  inferHistoryClassroomBlankSource,
  isHistoryClassroomDeleted,
  isHistoryClassroomPastDue,
  mergeHistoryClassroomMapSnapshot,
  normalizeHistoryClassroomAssignment,
  normalizeHistoryClassroomResult,
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
import { normalizeMapResource, type MapResource } from "../../lib/mapResources";
import { createManagedNotifications } from "../../lib/notifications";
import {
  getSemesterCollectionPath,
  getYearSemester,
} from "../../lib/semesterScope";

const HISTORY_CLASSROOM_RESULT_LIMIT = 500;

interface StudentOption {
  uid: string;
  name: string;
  grade: string;
  className: string;
  number: string;
}

type ExemptionRequestStatus = "pending" | "approved" | "rejected";
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
      <path d={name === "chevronUp" ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
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
type EditingResultStatusFilter = "all" | HistoryClassroomResult["status"];
type EditingResultSortOrder = "latest" | "oldest" | "passedFirst" | "scoreHigh";

const EDITING_RESULT_STATUS_FILTERS: {
  value: EditingResultStatusFilter;
  label: string;
}[] = [
  { value: "all", label: "전체" },
  { value: "passed", label: "통과" },
  { value: "failed", label: "미통과" },
  { value: "cancelled", label: "취소" },
];

const EDITING_RESULT_SORT_OPTIONS: {
  value: EditingResultSortOrder;
  label: string;
}[] = [
  { value: "latest", label: "최신 제출순" },
  { value: "oldest", label: "오래된 제출순" },
  { value: "passedFirst", label: "통과 먼저" },
  { value: "scoreHigh", label: "점수 높은순" },
];

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
  return "pending";
};

const normalizeHistoryClassroomExemption = (
  id: string,
  data: Record<string, unknown>,
): HistoryClassroomExemption => ({
  id,
  uid: String(data.uid || data.studentUid || "").trim(),
  studentName: String(data.studentName || data.name || "").trim(),
  grade: String(data.grade || data.studentGrade || "").trim(),
  className: String(
    data.className || data.class || data.studentClass || "",
  ).trim(),
  number: String(data.number || data.studentNumber || "").trim(),
  reason: String(data.reason || data.memo || "").trim(),
  status: String(data.status || "active").trim() || "active",
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
  return "대기";
};

const getExemptionRequestStatusClassName = (status: ExemptionRequestStatus) => {
  if (status === "approved") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "rejected") {
    return "border-rose-200 bg-rose-50 text-rose-700";
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
  };
};

const worksheetBlankToHistoryBlank = (
  blank: LessonWorksheetBlank,
  pageImage?: LessonWorksheetPageImage | null,
): HistoryClassroomBlank | null => {
  if (!pageImage || pageImage.width <= 0 || pageImage.height <= 0) {
    return null;
  }

  return {
    id: blank.id,
    page: blank.page,
    left: Math.round(blank.leftRatio * pageImage.width),
    top: Math.round(blank.topRatio * pageImage.height),
    width: Math.max(1, Math.round(blank.widthRatio * pageImage.width)),
    height: Math.max(1, Math.round(blank.heightRatio * pageImage.height)),
    answer: blank.answer.trim(),
    prompt: String(blank.prompt || "").trim(),
    source: blank.source === "ocr" ? "ocr" : "manual",
  };
};

const cloneMapResourceBlanks = (
  mapResource: MapResource | null,
): HistoryClassroomBlank[] =>
  (mapResource?.pdfBlanks || [])
    .map((blank) => ({
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
    }))
    .filter((blank) => blank.answer)
    .sort((a, b) => a.page - b.page || a.top - b.top || a.left - b.left);

const ManageHistoryClassroom: React.FC = () => {
  const { config, userData } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [maps, setMaps] = useState<MapResource[]>([]);
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
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(0);
  const [cooldownMinutes, setCooldownMinutes] = useState(0);
  const [dueWindowDays, setDueWindowDays] = useState<number | "">("");
  const [passThresholdPercent, setPassThresholdPercent] = useState(80);
  const [targetGrade, setTargetGrade] = useState("");
  const [targetClass, setTargetClass] = useState("");
  const [targetNumber, setTargetNumber] = useState("");
  const [targetStudentUid, setTargetStudentUid] = useState("");
  const [targetStudentSearch, setTargetStudentSearch] = useState("");
  const [selectedStudentUids, setSelectedStudentUids] = useState<string[]>([]);
  const [studentReasons, setStudentReasons] = useState<Record<string, string>>(
    {},
  );
  const [blanks, setBlanks] = useState<HistoryClassroomBlank[]>([]);
  const [saving, setSaving] = useState(false);
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
  const [editingStudentSearch, setEditingStudentSearch] = useState("");
  const [editingStudentReasons, setEditingStudentReasons] = useState<
    Record<string, string>
  >({});
  const [editingIsPublished, setEditingIsPublished] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingAssignment, setDeletingAssignment] = useState(false);
  const [resettingAttemptUid, setResettingAttemptUid] = useState("");
  const [editingResultStatusFilter, setEditingResultStatusFilter] =
    useState<EditingResultStatusFilter>("all");
  const [editingResultSortOrder, setEditingResultSortOrder] =
    useState<EditingResultSortOrder>("latest");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCurrentPage, setPreviewCurrentPage] = useState(1);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, string>>(
    {},
  );
  const [reviewResultId, setReviewResultId] = useState("");
  const [reviewCurrentPage, setReviewCurrentPage] = useState(1);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isMapManagerOpen, setIsMapManagerOpen] = useState(false);
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [dashboardStatusFilter, setDashboardStatusFilter] =
    useState<DashboardStatusFilter>("all");
  const [dashboardSortOrder, setDashboardSortOrder] =
    useState<DashboardSortOrder>("latest");
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [refreshingDashboard, setRefreshingDashboard] = useState(false);
  const [expandedAssignmentId, setExpandedAssignmentId] = useState("");
  const [savingMapBlanks, setSavingMapBlanks] = useState(false);
  const preserveBlankResetRef = React.useRef(false);
  const blankEditorComposingRef = React.useRef(false);
  const blankEditorCommitLockRef = React.useRef(false);
  const [tabLabels, setTabLabels] = useState({
    manage: "문제 등록",
    log: "제출 현황",
    bank: "문제 은행",
    historyClassroom: "역사교실",
  });

  const loadExemptionData = React.useCallback(async () => {
    setLoadingExemptions(true);
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
    } finally {
      setLoadingExemptions(false);
    }
  }, [config]);

  useEffect(() => {
    const loadData = async () => {
      setRefreshingDashboard(true);
      try {
        const mapPath = getSemesterCollectionPath(config, "map_resources");
        const semesterMapSnap = await getDocs(
          query(collection(db, mapPath), orderBy("sortOrder", "asc")),
        );
        const legacyMapSnap = await getDocs(
          query(collection(db, "map_resources"), orderBy("sortOrder", "asc")),
        );
        const mapById = new Map<string, MapResource>();
        legacyMapSnap.docs.forEach((docSnap) => {
          mapById.set(
            docSnap.id,
            normalizeMapResource(docSnap.id, docSnap.data()),
          );
        });
        semesterMapSnap.docs.forEach((docSnap) => {
          mapById.set(
            docSnap.id,
            normalizeMapResource(docSnap.id, docSnap.data()),
          );
        });
        const loadedMaps = Array.from(mapById.values())
          .filter(
            (item) =>
              item.type === "pdf" && (item.pdfPageImages?.length || 0) > 0,
          )
          .sort((a, b) => {
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
            return a.title.localeCompare(b.title, "ko");
          });
        setMaps(loadedMaps);
        if (loadedMaps[0]) {
          setSelectedMapId((prev) => prev || loadedMaps[0].id);
        }

        const studentSnap = await getDocs(collection(db, "users"));
        const loadedStudents = studentSnap.docs
          .map((docSnap) => {
            const data = docSnap.data() as Record<string, unknown>;
            if (data.role === "teacher") return null;
            return {
              uid: docSnap.id,
              name: String(data.name || "").trim(),
              grade: String(data.grade || "").trim(),
              className: String(data.class || "").trim(),
              number: String(data.number || "").trim(),
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

        const assignmentPath = getSemesterCollectionPath(
          config,
          "history_classrooms",
        );
        let assignmentSnap = await getDocs(
          query(collection(db, assignmentPath), orderBy("updatedAt", "desc")),
        );
        if (assignmentSnap.empty) {
          assignmentSnap = await getDocs(
            query(
              collection(db, "history_classrooms"),
              orderBy("updatedAt", "desc"),
            ),
          );
        }
        setAssignments(
          assignmentSnap.docs
            .map((docSnap) =>
              mergeHistoryClassroomMapSnapshot(
                normalizeHistoryClassroomAssignment(docSnap.id, docSnap.data()),
                loadedMaps.find(
                  (map) => map.id === docSnap.data().mapResourceId,
                ) || null,
              ),
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
    const resolveMenuLabels = async () => {
      try {
        const menuSnap = await getDoc(doc(db, "site_settings", "menu_config"));
        const menuConfig = menuSnap.exists()
          ? sanitizeMenuConfig(menuSnap.data())
          : cloneDefaultMenus();
        const teacherQuizMenu = (menuConfig.teacher || []).find(
          (menu) => menu.url === "/teacher/quiz",
        );
        const children = teacherQuizMenu?.children || [];
        setTabLabels({
          manage:
            children.find((child) => child.url === "/teacher/quiz")?.name ||
            "문제 등록",
          log:
            children.find((child) => child.url === "/teacher/quiz?tab=log")
              ?.name || "제출 현황",
          bank:
            children.find((child) => child.url === "/teacher/quiz?tab=bank")
              ?.name || "문제 은행",
          historyClassroom:
            children.find(
              (child) => child.url === "/teacher/quiz/history-classroom",
            )?.name || "역사교실",
        });
      } catch (error) {
        console.error("Failed to load quiz menu labels:", error);
      }
    };
    void resolveMenuLabels();
  }, []);

  useEffect(() => {
    if (preserveBlankResetRef.current) {
      preserveBlankResetRef.current = false;
      return;
    }
    const nextMap = maps.find((item) => item.id === selectedMapId) || null;
    setBlanks(cloneMapResourceBlanks(nextMap));
    setSelectedBlankId("");
    setDraftBlank(null);
    setDraftBlankAnswer("");
    setBlankEditorMode(null);
    setBlankEditorAnswer("");
    setBlankEditorError("");
    blankEditorComposingRef.current = false;
    setShowAllBlankTags(false);
  }, [maps, selectedMapId]);

  const worksheetSourceMap = useMemo<MapResource | null>(() => {
    if (
      !worksheetSourceAssignment ||
      worksheetSourceAssignment.mapResourceId !== selectedMapId
    ) {
      return null;
    }

    if (
      !(worksheetSourceAssignment.pdfPageImages?.length || 0) &&
      !(worksheetSourceAssignment.pdfRegions?.length || 0)
    ) {
      return maps.find((item) => item.id === selectedMapId) || null;
    }

    return {
      id: worksheetSourceAssignment.mapResourceId,
      title: worksheetSourceAssignment.mapTitle || "불러온 지도",
      category: "",
      description: "",
      type: "pdf",
      pdfPageImages: worksheetSourceAssignment.pdfPageImages || [],
      pdfRegions: worksheetSourceAssignment.pdfRegions || [],
      sortOrder: -1,
    };
  }, [maps, selectedMapId, worksheetSourceAssignment]);

  const selectedMap = useMemo(
    () =>
      worksheetSourceMap ||
      maps.find((item) => item.id === selectedMapId) ||
      null,
    [maps, selectedMapId, worksheetSourceMap],
  );

  const selectedStoredMap = useMemo(
    () => maps.find((item) => item.id === selectedMapId) || null,
    [maps, selectedMapId],
  );

  const activeWorksheetMap = isMapManagerOpen ? selectedStoredMap : selectedMap;

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

  const classFilteredStudents = useMemo(
    () =>
      students.filter(
        (student) =>
          (!targetGrade || student.grade === targetGrade) &&
          (!targetClass || student.className === targetClass),
      ),
    [students, targetClass, targetGrade],
  );

  const numberFilteredStudents = useMemo(
    () =>
      classFilteredStudents.filter(
        (student) => !targetNumber || student.number === targetNumber,
      ),
    [classFilteredStudents, targetNumber],
  );

  const searchedStudents = useMemo(() => {
    const keyword = targetStudentSearch.trim().toLocaleLowerCase("ko-KR");
    if (!keyword) return [];
    return students
      .filter((student) => {
        if (selectedStudentUids.includes(student.uid)) return false;
        return buildStudentSearchText(student).includes(keyword);
      })
      .slice(0, 8);
  }, [selectedStudentUids, students, targetStudentSearch]);

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

  const classOptions = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .filter((student) => !targetGrade || student.grade === targetGrade)
            .map((student) => student.className)
            .filter(Boolean),
        ),
      ).sort(compareSchoolValues),
    [students, targetGrade],
  );

  const numberOptions = useMemo(
    () =>
      Array.from(
        new Set(
          classFilteredStudents
            .map((student) => student.number)
            .filter(Boolean),
        ),
      ).sort(compareSchoolValues),
    [classFilteredStudents],
  );

  const exemptionSelectedStudents = useMemo(
    () =>
      exemptionSelectedStudentUids
        .map((uid) => students.find((student) => student.uid === uid))
        .filter((student): student is StudentOption => !!student),
    [exemptionSelectedStudentUids, students],
  );

  const searchedExemptionStudents = useMemo(() => {
    const keyword = exemptionStudentSearch.trim().toLocaleLowerCase("ko-KR");
    if (!keyword) return [];
    return students
      .filter(
        (student) =>
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
                !exemptionTargetGrade || student.grade === exemptionTargetGrade,
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
      (student) => student.grade === grade && student.className === className,
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

  const targetStudentPreview = useMemo(
    () =>
      students.find((student) => student.uid === targetStudentUid) ||
      (targetNumber && numberFilteredStudents.length === 1
        ? numberFilteredStudents[0]
        : null),
    [numberFilteredStudents, students, targetNumber, targetStudentUid],
  );

  const editingAssignment = useMemo(
    () =>
      assignments.find((assignment) => assignment.id === editingAssignmentId) ||
      null,
    [assignments, editingAssignmentId],
  );

  const editingSelectedMap = useMemo(
    () => maps.find((map) => map.id === editingMapResourceId) || null,
    [editingMapResourceId, maps],
  );

  const editingStudents = useMemo(
    () =>
      editingStudentUids
        .map((uid) => students.find((student) => student.uid === uid))
        .filter((student): student is StudentOption => !!student),
    [editingStudentUids, students],
  );

  const searchedEditingStudents = useMemo(() => {
    const keyword = editingStudentSearch.trim().toLocaleLowerCase("ko-KR");
    if (!keyword) return [];
    return students
      .filter(
        (student) =>
          !editingStudentUids.includes(student.uid) &&
          buildStudentSearchText(student).includes(keyword),
      )
      .slice(0, 8);
  }, [editingStudentSearch, editingStudentUids, students]);

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

  const editingResultStatusCounts = useMemo(() => {
    const counts: Record<EditingResultStatusFilter, number> = {
      all: editingVisibleResults.length,
      passed: 0,
      failed: 0,
      cancelled: 0,
    };
    editingVisibleResults.forEach((result) => {
      counts[result.status] += 1;
    });
    return counts;
  }, [editingVisibleResults]);

  const editingResultRows = useMemo(() => {
    const statusRank: Record<HistoryClassroomResult["status"], number> = {
      passed: 0,
      failed: 1,
      cancelled: 2,
    };
    const filtered =
      editingResultStatusFilter === "all"
        ? editingVisibleResults
        : editingVisibleResults.filter(
            (result) => result.status === editingResultStatusFilter,
          );

    return [...filtered].sort((a, b) => {
      const aSubmittedAt = getTimestampMs(a.createdAt) || 0;
      const bSubmittedAt = getTimestampMs(b.createdAt) || 0;
      if (editingResultSortOrder === "oldest") {
        return aSubmittedAt - bSubmittedAt;
      }
      if (editingResultSortOrder === "passedFirst") {
        return (
          statusRank[a.status] - statusRank[b.status] ||
          bSubmittedAt - aSubmittedAt
        );
      }
      if (editingResultSortOrder === "scoreHigh") {
        return b.percent - a.percent || bSubmittedAt - aSubmittedAt;
      }
      return bSubmittedAt - aSubmittedAt;
    });
  }, [
    editingResultSortOrder,
    editingResultStatusFilter,
    editingVisibleResults,
  ]);

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

  const editingPreviewMap = useMemo(
    () =>
      editingSelectedMap ||
      maps.find((map) => map.id === editingAssignment?.mapResourceId) ||
      null,
    [editingAssignment?.mapResourceId, editingSelectedMap, maps],
  );

  const editingPreviewAssignment = useMemo(() => {
    if (!editingAssignment) return null;

    const resolvedDueWindowDays =
      resolveDueWindowDaysValue(editingDueWindowDays);
    const mapChanged =
      !!editingSelectedMap &&
      editingSelectedMap.id !== editingAssignment.mapResourceId;
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
        title:
          editingSelectedMap?.title ||
          editingAssignment.mapTitle ||
          editingAssignment.title,
        description: "",
        mapResourceId:
          editingSelectedMap?.id || editingAssignment.mapResourceId,
        mapTitle: editingSelectedMap?.title || editingAssignment.mapTitle,
        pdfPageImages:
          editingSelectedMap?.pdfPageImages || editingAssignment.pdfPageImages,
        pdfRegions:
          editingSelectedMap?.pdfRegions || editingAssignment.pdfRegions,
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

    return mergeHistoryClassroomMapSnapshot(
      previewAssignment,
      editingPreviewMap,
    );
  }, [
    editingAssignment,
    editingCooldownMinutes,
    editingDueWindowDays,
    editingIsPublished,
    editingPassThresholdPercent,
    editingPreviewMap,
    editingSelectedMap,
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
      const latestResult = editingLatestResultsByStudentUid.get(student.uid);
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
            statusLabel: "재도전 가능",
            detailLabel: "응시 시간이 초기화되어 바로 다시 응시할 수 있습니다.",
            toneClassName: "border-blue-200 bg-blue-50 text-blue-700",
            canResetAttempt: false,
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
          canResetAttempt: false,
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
        canResetAttempt: false,
      };
    });
  }, [
    editingLatestResultsByStudentUid,
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
    setTimeLimitMinutes(0);
    setCooldownMinutes(0);
    setDueWindowDays("");
    setPassThresholdPercent(80);
    setTargetGrade("");
    setTargetClass("");
    setTargetNumber("");
    setTargetStudentUid("");
    setTargetStudentSearch("");
    setSelectedStudentUids([]);
    setStudentReasons({});
    setSelectedBlankId("");
    setDraftBlank(null);
    setDraftBlankAnswer("");
    setBlankEditorMode(null);
    setBlankEditorAnswer("");
    setBlankEditorError("");
    blankEditorComposingRef.current = false;
    setShowAllBlankTags(false);
    setFloatingPanelOpen(false);
    if (maps[0]) {
      setSelectedMapId(maps[0].id);
      setBlanks(cloneMapResourceBlanks(maps[0]));
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

  useEffect(() => {
    if (!numberFilteredStudents.length) {
      setTargetStudentUid("");
      return;
    }

    if (
      numberFilteredStudents.some((student) => student.uid === targetStudentUid)
    ) {
      return;
    }

    if (numberFilteredStudents.length === 1) {
      setTargetStudentUid(numberFilteredStudents[0].uid);
      return;
    }

    setTargetStudentUid("");
  }, [numberFilteredStudents, targetStudentUid]);

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

  const openMapBlankManager = (mapId?: string) => {
    const nextMap =
      maps.find((item) => item.id === mapId) ||
      maps.find((item) => item.id === selectedMapId) ||
      maps[0] ||
      null;
    if (nextMap) {
      setSelectedMapId(nextMap.id);
      setBlanks(cloneMapResourceBlanks(nextMap));
    }
    setSelectedBlankId("");
    setDraftBlank(null);
    setDraftBlankAnswer("");
    closeBlankEditor();
    setFloatingPanelOpen(true);
    setIsMapManagerOpen(true);
  };

  const closeMapBlankManager = () => {
    setIsMapManagerOpen(false);
    setFloatingPanelOpen(false);
    setSelectedBlankId("");
    setDraftBlank(null);
    setDraftBlankAnswer("");
    closeBlankEditor();
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
    const reason = exemptionReason.trim();
    const { year, semester } = getYearSemester(config);
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

    setGrantingExemption(true);
    try {
      const callable = await getHttpsCallable(
        "grantHistoryClassroomExemptions",
      );
      await callable({
        year,
        semester,
        mode: exemptionGrantMode,
        reason,
        studentUids: targetStudents.map((student) => student.uid),
        targetGrade: exemptionGrantMode === "class" ? exemptionTargetGrade : "",
        targetClass: exemptionGrantMode === "class" ? exemptionTargetClass : "",
      });
      setExemptionStudentSearch("");
      setExemptionSelectedStudentUids([]);
      setExemptionReason("");
      await loadExemptionData();
      alert("면제권을 부여했습니다.");
    } catch (error) {
      console.error("Failed to grant history classroom exemptions:", error);
      alert("면제권 부여에 실패했습니다.");
    } finally {
      setGrantingExemption(false);
    }
  };

  const handleReviewExemptionRequest = async (
    requestId: string,
    status: "approved" | "rejected",
  ) => {
    const { year, semester } = getYearSemester(config);
    setReviewingExemptionRequestId(requestId);
    try {
      const callable = await getHttpsCallable(
        "reviewHistoryClassroomExemptionRequest",
      );
      await callable({
        year,
        semester,
        requestId,
        status,
        decision: status,
        approved: status === "approved",
      });
      await loadExemptionData();
    } catch (error) {
      console.error("Failed to review history classroom exemption request:", {
        requestId,
        status,
        error,
      });
      alert("면제권 사용 요청 처리에 실패했습니다.");
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

    const { year, semester } = getYearSemester(config);
    setRevokingExemptionStudentKey(row.key);
    try {
      const callable = await getHttpsCallable(
        "revokeHistoryClassroomExemptions",
      );
      await callable({
        year,
        semester,
        exemptionIds: revocableItems
          .slice(0, revokeCount)
          .map((item) => item.id),
      });
      setExpandedExemptionStudentKey("");
      await loadExemptionData();
    } catch (error) {
      console.error("Failed to revoke history classroom exemptions:", {
        row,
        error,
      });
      alert("면제권 회수에 실패했습니다.");
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

    const { year, semester } = getYearSemester(config);
    setResettingGrantedExemptions(true);
    try {
      const callable = await getHttpsCallable(
        "revokeHistoryClassroomExemptions",
      );
      for (
        let index = 0;
        index < resettableGrantedExemptionIds.length;
        index += 50
      ) {
        await callable({
          year,
          semester,
          exemptionIds: resettableGrantedExemptionIds.slice(index, index + 50),
        });
      }
      setExpandedExemptionStudentKey("");
      await loadExemptionData();
    } catch (error) {
      console.error("Failed to reset history classroom exemptions:", error);
      alert("면제권 부여 초기화에 실패했습니다.");
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
    setEditingAssignmentId(assignment.id);
    setEditingMapResourceId(assignment.mapResourceId);
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
    setEditingStudentSearch("");
    setEditingStudentReasons(assignment.targetStudentReasons || {});
    setEditingIsPublished(assignment.isPublished);
    setPreviewOpen(false);
  };

  const loadAssignmentIntoWorksheetEditor = (
    assignment: HistoryClassroomAssignment,
    mode: "edit" | "clone" = "edit",
  ) => {
    preserveBlankResetRef.current = true;
    setSelectedMapId(assignment.mapResourceId);
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
    setTargetNumber("");
    setTargetStudentUid("");
    setTargetStudentSearch("");
    setSelectedStudentUids(
      assignment.targetStudentUids.length
        ? assignment.targetStudentUids
        : assignment.targetStudentUid
          ? [assignment.targetStudentUid]
          : [],
    );
    setStudentReasons(assignment.targetStudentReasons || {});
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
    setEditingAssignmentId("");
    setEditingMapResourceId("");
    setEditingTitle("");
    setEditingDescription("");
    setEditingTimeLimitMinutes(0);
    setEditingCooldownMinutes(0);
    setEditingDueWindowDays("");
    setEditingPassThresholdPercent(80);
    setEditingStudentUids([]);
    setEditingStudentSearchOpen(false);
    setEditingStudentSearch("");
    setEditingStudentReasons({});
    setEditingIsPublished(true);
    setSavingEdit(false);
    setDeletingAssignment(false);
    setResettingAttemptUid("");
    setEditingResultStatusFilter("all");
    setEditingResultSortOrder("latest");
    setPreviewOpen(false);
    setPreviewCurrentPage(1);
    setPreviewAnswers({});
    setReviewResultId("");
    setReviewCurrentPage(1);
  };

  const handleSaveAssignmentEdit = async () => {
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
    const replacementMap = maps.find((map) => map.id === editingMapResourceId);
    const mapChanged =
      !!replacementMap && replacementMap.id !== targetAssignment.mapResourceId;
    if (editingMapResourceId && !replacementMap) {
      alert("교체할 배포 지도를 찾을 수 없습니다.");
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
      alert("교체할 배포 지도에 저장된 빈칸과 정답을 먼저 확인해 주세요.");
      return;
    }

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
      const nextMapTitle =
        replacementMap?.title ||
        targetAssignment.mapTitle ||
        editingTitle.trim();
      const payload = sanitizeHistoryClassroomAssignmentForWrite({
        ...targetAssignment,
        title: nextMapTitle,
        description: "",
        mapResourceId: replacementMap?.id || targetAssignment.mapResourceId,
        mapTitle: nextMapTitle,
        pdfPageImages:
          replacementMap?.pdfPageImages || targetAssignment.pdfPageImages,
        pdfRegions: replacementMap?.pdfRegions || targetAssignment.pdfRegions,
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

      await setDoc(
        doc(
          db,
          getSemesterCollectionPath(config, "history_classrooms"),
          targetAssignment.id,
        ),
        payload,
      );
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
                return mergeHistoryClassroomMapSnapshot(
                  normalized,
                  maps.find((map) => map.id === normalized.mapResourceId) ||
                    null,
                );
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
      alert("역사교실 수정에 실패했습니다.");
      setSavingEdit(false);
    }
  };

  const handleResetStudentAttemptCooldown = async (student: StudentOption) => {
    const targetAssignment = assignments.find(
      (assignment) => assignment.id === editingAssignmentId,
    );
    if (!targetAssignment || !student.uid || resettingAttemptUid) return;

    const latestResult = editingLatestResultsByStudentUid.get(student.uid);
    if (!latestResult || latestResult.status === "passed") {
      alert("초기화할 재도전 제한 기록이 없습니다.");
      return;
    }

    const confirmed = window.confirm(
      `${student.name} 학생의 역사교실 응시 시간을 초기화할까요?\n기존 결과 기록은 남기고, 학생은 바로 다시 응시할 수 있습니다.`,
    );
    if (!confirmed) return;

    const resetAt = new Date();
    setResettingAttemptUid(student.uid);
    try {
      await setDoc(
        doc(
          db,
          getSemesterCollectionPath(config, "history_classrooms"),
          targetAssignment.id,
        ),
        {
          retryResetByStudentUid: {
            [student.uid]: serverTimestamp(),
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

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
    } catch (error) {
      console.error("Failed to reset history classroom attempt cooldown", {
        path: `${getSemesterCollectionPath(config, "history_classrooms")}/${targetAssignment.id}`,
        assignmentId: targetAssignment.id,
        uid: student.uid,
        ...getFirestoreErrorSummary(error),
        error,
      });
      alert("응시 시간 초기화에 실패했습니다.");
    } finally {
      setResettingAttemptUid("");
    }
  };

  const handleDeleteAssignment = async () => {
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
      await setDoc(
        doc(
          db,
          `${getSemesterCollectionPath(config, "history_classrooms")}/${targetAssignment.id}`,
        ),
        {
          isPublished: false,
          deletedAt: serverTimestamp(),
          deletedByUid: String(userData?.uid || "").trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
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
    if (!selectedMap || !selectedStudentUids.length) {
      alert("지도와 대상 학생을 먼저 선택해 주세요.");
      return;
    }
    if (!selectedStudents.length) {
      alert("학생 정보를 찾을 수 없습니다.");
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
      alert("배포 지도 관리에서 출제 빈칸과 정답을 먼저 저장해 주세요.");
      return;
    }

    setSaving(true);
    let assignmentId = "";
    try {
      const existingAssignment = worksheetEditingAssignmentId
        ? assignments.find(
            (assignment) => assignment.id === worksheetEditingAssignmentId,
          ) || null
        : null;
      assignmentId =
        existingAssignment?.id || `history-classroom-${Date.now()}`;
      const sourceSnapshot =
        worksheetSourceAssignment &&
        worksheetSourceAssignment.mapResourceId === selectedMap.id
          ? worksheetSourceAssignment
          : existingAssignment &&
              existingAssignment.mapResourceId === selectedMap.id
            ? existingAssignment
            : null;
      const resolvedDueWindowDays = resolveDueWindowDaysValue(dueWindowDays);
      const resolvedMapTitle =
        sourceSnapshot?.mapTitle || selectedMap.title || "역사교실";
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
        mapResourceId: selectedMap.id,
        mapTitle: resolvedMapTitle,
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
        targetGrade: targetGrade || selectedStudents[0]?.grade || "",
        targetClass: targetClass || selectedStudents[0]?.className || "",
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
      await setDoc(
        doc(
          db,
          getSemesterCollectionPath(config, "history_classrooms"),
          assignmentId,
        ),
        payload,
      );
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
        const normalized = mergeHistoryClassroomMapSnapshot(
          normalizedAssignment,
          maps.find((map) => map.id === normalizedAssignment.mapResourceId) ||
            null,
        );
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
      setTimeLimitMinutes(0);
      setCooldownMinutes(0);
      setDueWindowDays("");
      setPassThresholdPercent(80);
      setTargetGrade("");
      setTargetClass("");
      setTargetNumber("");
      setTargetStudentUid("");
      setTargetStudentSearch("");
      setSelectedStudentUids([]);
      setStudentReasons({});
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
      alert("역사교실 과제 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMapBlanks = async () => {
    if (!selectedStoredMap) {
      alert("저장할 지도를 선택해 주세요.");
      return;
    }
    if (!blanks.length || blanks.some((blank) => !blank.answer.trim())) {
      alert("빈칸을 추가하고 모든 정답을 입력해 주세요.");
      return;
    }

    setSavingMapBlanks(true);
    try {
      const payload = normalizeMapResource(selectedStoredMap.id, {
        ...selectedStoredMap,
        pdfBlanks: blanks,
        answerOptions: buildAnswerOptions(blanks),
      });
      await setDoc(
        doc(
          db,
          getSemesterCollectionPath(config, "map_resources"),
          selectedStoredMap.id,
        ),
        {
          ...payload,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setMaps((prev) =>
        prev.map((map) => (map.id === selectedStoredMap.id ? payload : map)),
      );
      setBlanks(cloneMapResourceBlanks(payload));
      alert("배포 지도 빈칸과 정답을 저장했습니다.");
    } catch (error) {
      console.error("Failed to save map blanks", {
        mapResourceId: selectedStoredMap.id,
        ...getFirestoreErrorSummary(error),
        error,
      });
      alert("배포 지도 빈칸 저장에 실패했습니다.");
    } finally {
      setSavingMapBlanks(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:py-8">
      <div className="mb-4 flex shrink-0 overflow-x-auto rounded-t-lg border-b border-gray-200 bg-white px-2">
        <button
          type="button"
          onClick={() => navigate("/teacher/quiz")}
          className="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-600 transition whitespace-nowrap hover:bg-gray-50"
        >
          {tabLabels.manage}
        </button>
        <button
          type="button"
          onClick={() => navigate("/teacher/quiz?tab=log")}
          className="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-600 transition whitespace-nowrap hover:bg-gray-50"
        >
          {tabLabels.log}
        </button>
        <button
          type="button"
          onClick={() => navigate("/teacher/quiz?tab=bank")}
          className="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-600 transition whitespace-nowrap hover:bg-gray-50"
        >
          {tabLabels.bank}
        </button>
        <button
          type="button"
          className="border-b-2 border-blue-500 px-6 py-3 text-sm font-bold text-blue-600 transition whitespace-nowrap"
        >
          {tabLabels.historyClassroom}
        </button>
      </div>

      <section className="mb-5 px-1 py-2">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-600">
              <DashboardIcon name="calendar" className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-gray-900">
                역사교실 제출 현황 대시보드
              </h1>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                날짜별로 과제와 학생 제출 현황을 한눈에 확인하세요.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openExemptionPanel("grant")}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 text-sm font-bold text-blue-700 shadow-sm hover:bg-blue-100"
            >
              면제권 관리
              {pendingExemptionRequestCount > 0 && (
                <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-black text-white">
                  {pendingExemptionRequestCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => openMapBlankManager()}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50"
            >
              지도 관리
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="h-11 rounded-2xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
            >
              + 새 역사교실
            </button>
          </div>
        </div>
      </section>

      <section className="mb-5 rounded-3xl border border-gray-200 bg-white p-3.5 shadow-sm">
        <div className="grid gap-2.5 xl:grid-cols-[15rem_minmax(12rem,18rem)_auto_auto] xl:items-center xl:justify-between">
          <div className="flex h-12 items-center gap-3 rounded-2xl border border-gray-200 px-4 text-sm font-bold text-gray-700">
            <DashboardIcon name="calendar" className="h-4 w-4 text-blue-600" />
            {dashboardDateRangeLabel}
          </div>
          <div className="flex h-12 items-center gap-3 rounded-2xl border border-gray-200 px-4">
            <input
              value={dashboardSearch}
              onChange={(event) => setDashboardSearch(event.target.value)}
              placeholder="과제명, 학생 이름, 학번 검색"
              className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-gray-400"
            />
            <DashboardIcon name="search" className="h-5 w-5 text-gray-400" />
          </div>
          <div className="flex flex-nowrap gap-2">
            {[
              ["all", "전체"],
              ["published", "공개"],
              ["private", "비공개"],
              ["pending", "미제출"],
              ["passed", "통과"],
            ].map(([value, label]) => (
              <React.Fragment key={value}>
                <button
                  type="button"
                  onClick={() =>
                    setDashboardStatusFilter(value as DashboardStatusFilter)
                  }
                  className={`h-10 rounded-xl border px-3 text-xs font-bold transition ${
                    dashboardStatusFilter === value
                      ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                      : value === "pending"
                        ? "border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                        : value === "passed"
                          ? "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {label}
                </button>
                {value === "all" && (
                  <button
                    type="button"
                    onClick={() =>
                      setDashboardRefreshKey((current) => current + 1)
                    }
                    disabled={refreshingDashboard}
                    aria-label="새로고침"
                    title="새로고침"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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
          <label className="flex h-12 items-center gap-3 rounded-2xl border border-gray-200 px-4 text-sm font-bold text-gray-600">
            정렬 기준
            <select
              value={dashboardSortOrder}
              onChange={(event) =>
                setDashboardSortOrder(event.target.value as DashboardSortOrder)
              }
              className="h-full min-w-[7rem] border-0 bg-transparent text-sm font-bold text-gray-900 outline-none"
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
            <button
              type="button"
              onClick={() => void loadExemptionData()}
              disabled={loadingExemptions}
              className="h-10 rounded-2xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {loadingExemptions ? "새로고침 중" : "새로고침"}
            </button>
            <button
              type="button"
              onClick={() =>
                exemptionPanelOpen
                  ? closeExemptionPanel()
                  : setExemptionPanelOpen(true)
              }
              className="h-10 rounded-2xl bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700"
            >
              {exemptionPanelOpen ? "패널 닫기" : "면제권 관리 열기"}
            </button>
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
                  <button
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
                  >
                    {label}
                  </button>
                ))}
              </div>

              {exemptionGrantMode === "students" ? (
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-gray-500">
                      학생 검색
                    </span>
                    <input
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
                  value={exemptionReason}
                  onChange={(event) => setExemptionReason(event.target.value)}
                  rows={3}
                  placeholder="예: 학교 행사, 공결, 상담 등"
                  className="w-full resize-none rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleGrantExemptions()}
                disabled={grantingExemption}
                className="mt-3 h-11 w-full rounded-2xl bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {grantingExemption ? "부여 중" : "면제권 부여"}
              </button>
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
                            <button
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
                            >
                              반려
                            </button>
                            <button
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
                            >
                              승인
                            </button>
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
        className={`relative space-y-8 ${
          pagedAssignmentGroups.length
            ? "before:pointer-events-none before:absolute before:bottom-0 before:left-1.5 before:top-2 before:w-px before:bg-gray-200"
            : ""
        }`}
      >
        {pagedAssignmentGroups.map((group) => (
          <div
            key={group.dateKey}
            className="relative flex w-full flex-col gap-3 lg:flex-row lg:items-start"
          >
            <div className="relative w-full shrink-0 pl-5 lg:w-32 lg:pl-0">
              <div className="relative z-10">
                <div className="absolute left-0 top-2 h-3 w-3 rounded-full border-4 border-white bg-blue-600 shadow ring-1 ring-blue-200" />
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
                    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start">
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
                      <div className="-mr-1 flex max-w-full flex-nowrap items-center justify-start gap-1.5 overflow-x-auto pb-1 pr-1 lg:max-w-none lg:shrink-0 lg:justify-end lg:overflow-visible lg:pb-0 lg:pr-0">
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
                            className={`inline-flex h-9 min-w-[4.6rem] shrink-0 items-center justify-center gap-1.5 rounded-xl border px-2 text-[11px] font-black sm:h-10 sm:min-w-[5rem] sm:px-2.5 sm:text-xs ${className}`}
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
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 transition hover:bg-blue-100 sm:h-10 sm:w-10"
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
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 sm:h-10 sm:w-10"
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
                        {[
                          ["통과", row.statusGroups.passed, "text-emerald-700"],
                          ["미통과", row.statusGroups.failed, "text-rose-700"],
                          ["미제출", row.statusGroups.pending, "text-gray-700"],
                          [
                            "자동 종료",
                            row.statusGroups.cancelled,
                            "text-amber-700",
                          ],
                        ].map(([label, students, toneClassName]) => (
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
                              {(students as typeof row.studentSummaries).map(
                                (student) => (
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
                                ),
                              )}
                              {!(students as typeof row.studentSummaries)
                                .length && (
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
            아직 생성된 역사교실 과제가 없습니다. + 새 역사교실로 첫 과제를
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
              <button
                type="button"
                onClick={() =>
                  setAssignmentPage((current) => Math.max(1, current - 1))
                }
                disabled={assignmentPage <= 1}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                이전
              </button>
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
              <button
                type="button"
                onClick={() =>
                  setAssignmentPage((current) =>
                    Math.min(totalAssignmentPages, current + 1),
                  )
                }
                disabled={assignmentPage >= totalAssignmentPages}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </section>

      {exemptionPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-5 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-[min(96vw,72rem)] overflow-hidden rounded-3xl bg-white shadow-2xl">
            <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-slate-50 p-4 md:block">
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

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-xl font-black text-slate-900">
                    면제권 관리
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    학생별·학급별 부여와 학생 사용 요청 처리를 한 곳에서
                    관리합니다.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void loadExemptionData()}
                    disabled={loadingExemptions}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {loadingExemptions ? "새로고침 중" : "새로고침"}
                  </button>
                  <button
                    type="button"
                    onClick={closeExemptionPanel}
                    className="h-10 rounded-xl bg-blue-600 px-4 text-xs font-black text-white hover:bg-blue-700"
                  >
                    닫기
                  </button>
                </div>
              </div>

              <div className="flex gap-2 overflow-x-auto border-b border-slate-200 px-4 py-3 md:hidden">
                {[
                  ["grant", "면제권 부여"],
                  [
                    "requests",
                    `면제권 사용 요청 ${pendingExemptionRequestCount}`,
                  ],
                  ["granted", `부여된 면제권 ${activeExemptionCount}`],
                ].map(([value, label]) => (
                  <button
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
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-white p-5">
                {exemptionModalTab === "grant" && (
                  <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap gap-2">
                      {[
                        ["students", "학생별 부여"],
                        ["class", "학급 단위 부여"],
                      ].map(([value, label]) => (
                        <button
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
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {exemptionGrantMode === "students" ? (
                      <div className="mt-4 space-y-3">
                        <label className="block">
                          <span className="mb-1 block text-xs font-bold text-slate-500">
                            학생 검색
                          </span>
                          <input
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
                            선택 대상 {exemptionClassStudents.length}명
                          </div>
                        </div>
                      </>
                    )}

                    <label className="mt-4 block">
                      <span className="mb-1 block text-xs font-bold text-slate-500">
                        부여 사유
                      </span>
                      <textarea
                        value={exemptionReason}
                        onChange={(event) =>
                          setExemptionReason(event.target.value)
                        }
                        rows={3}
                        placeholder="예: 학교 행사, 공결, 상담 등"
                        className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleGrantExemptions()}
                      disabled={grantingExemption}
                      className="mt-3 h-11 w-full rounded-2xl bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {grantingExemption ? "부여 중" : "면제권 부여"}
                    </button>
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
                      <div className="sticky top-0 z-10 grid min-w-[48rem] grid-cols-[3.5rem_3rem_minmax(6rem,1fr)_minmax(8rem,1.2fr)_6rem_4.5rem_7.5rem] items-center gap-2 border-b border-slate-200 bg-white px-3 pb-1.5 text-[11px] font-bold text-slate-400">
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
                            className={`min-w-[48rem] rounded-xl border bg-white px-3 py-2 transition ${
                              isHighlighted
                                ? "border-blue-300 bg-blue-50 ring-2 ring-blue-50"
                                : "border-slate-200 hover:border-blue-100 hover:bg-blue-50/30"
                            }`}
                          >
                            <div className="grid grid-cols-[3.5rem_3rem_minmax(6rem,1fr)_minmax(8rem,1.2fr)_6rem_4.5rem_7.5rem] items-center gap-2">
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
                              <div className="flex items-center justify-end gap-1.5">
                                {isPending ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleReviewExemptionRequest(
                                          request.id,
                                          "rejected",
                                        )
                                      }
                                      disabled={reviewing}
                                      className="h-8 rounded-lg border border-rose-200 bg-white px-2.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                    >
                                      반려
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleReviewExemptionRequest(
                                          request.id,
                                          "approved",
                                        )
                                      }
                                      disabled={reviewing}
                                      className="h-8 rounded-lg bg-blue-600 px-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                                    >
                                      승인
                                    </button>
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
                          type="text"
                          value={grantedExemptionNameSearch}
                          onChange={(event) =>
                            setGrantedExemptionNameSearch(event.target.value)
                          }
                          placeholder="학생 이름 검색"
                          className="h-9 w-36 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                        />
                        <button
                          type="button"
                          onClick={() => void handleResetGrantedExemptions()}
                          disabled={
                            resettingGrantedExemptions ||
                            resettableGrantedExemptionIds.length <= 0
                          }
                          className="h-8 rounded-full border border-rose-100 bg-rose-50 px-3 text-xs font-black text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-100 disabled:text-slate-400"
                          title={`보유 면제권 ${resettableGrantedExemptionIds.length}개 회수`}
                        >
                          초기화
                        </button>
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
                      <div className="sticky top-0 z-10 grid min-w-[42rem] grid-cols-[3rem_3rem_3.5rem_minmax(9rem,1fr)_4.5rem_5.5rem_4.5rem_3.5rem] items-center gap-2 border-b border-slate-200 bg-white px-3 pb-1.5 text-[11px] font-bold text-slate-400">
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
                            className={`min-w-[42rem] rounded-xl border bg-white px-3 py-2 transition ${
                              expanded
                                ? "border-blue-200 ring-2 ring-blue-50"
                                : "border-slate-200 hover:border-blue-100 hover:bg-blue-50/30"
                            }`}
                          >
                            <div className="grid grid-cols-[3rem_3rem_3.5rem_minmax(9rem,1fr)_4.5rem_5.5rem_4.5rem_3.5rem] items-center gap-2">
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
          <div className="flex max-h-[94vh] w-full max-w-[min(96vw,96rem)] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-5 py-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-500">
                  New History Classroom
                </div>
                <h2 className="mt-1 text-xl font-black text-gray-900">
                  {worksheetEditingAssignmentId
                    ? "역사교실 지도/빈칸 수정"
                    : "새 역사교실 등록"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
              >
                닫기
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-4">
              <div className="mx-auto max-w-6xl space-y-4">
                <section className="grid gap-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_18rem]">
                  <div className="md:col-span-2 xl:col-span-2">
                    <label className="mb-1 block text-xs font-bold text-gray-500">
                      PDF 지도 선택
                    </label>
                    <select
                      value={selectedMapId}
                      onChange={(e) => {
                        const nextMapId = e.target.value;
                        setSelectedMapId(nextMapId);
                        if (
                          worksheetSourceAssignment?.mapResourceId !== nextMapId
                        ) {
                          setWorksheetSourceAssignment(null);
                          setWorksheetImportSourceId("");
                          setWorksheetImportSourceTitle("");
                        }
                        setTargetStudentUid("");
                        setTargetStudentSearch("");
                        setSelectedStudentUids([]);
                        setStudentReasons({});
                      }}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                    >
                      {maps.map((map) => (
                        <option key={map.id} value={map.id}>
                          {map.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-3 md:col-span-2 md:grid-cols-2 xl:col-span-2 xl:grid-cols-4">
                    <div>
                      <label className="mb-1 block whitespace-nowrap text-[11px] font-bold text-gray-500">
                        제한 시간(분)
                      </label>
                      <input
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
                      <input
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
                      <input
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
                      <input
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

                  <div className="space-y-3 md:col-span-2 xl:col-span-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(5.75rem,1.2fr)] gap-2 lg:grid-cols-4 lg:gap-3">
                      <select
                        value={targetGrade}
                        onChange={(e) => {
                          setTargetGrade(e.target.value);
                          setTargetClass("");
                          setTargetNumber("");
                          setTargetStudentUid("");
                          setTargetStudentSearch("");
                        }}
                        className="h-11 w-full min-w-0 rounded-xl border border-gray-300 px-3 text-sm"
                      >
                        <option value="">학년 선택</option>
                        {gradeOptions.map((grade) => (
                          <option key={grade} value={grade}>
                            {grade}
                          </option>
                        ))}
                      </select>
                      <select
                        value={targetClass}
                        onChange={(e) => {
                          setTargetClass(e.target.value);
                          setTargetNumber("");
                          setTargetStudentUid("");
                          setTargetStudentSearch("");
                        }}
                        className="h-11 w-full min-w-0 rounded-xl border border-gray-300 px-3 text-sm"
                      >
                        <option value="">학급 선택</option>
                        {classOptions.map((className) => (
                          <option key={className} value={className}>
                            {className}
                          </option>
                        ))}
                      </select>
                      <select
                        value={targetNumber}
                        onChange={(e) => {
                          setTargetNumber(e.target.value);
                          setTargetStudentUid("");
                          setTargetStudentSearch("");
                        }}
                        className="h-11 w-full min-w-0 rounded-xl border border-gray-300 px-3 text-sm"
                      >
                        <option value="">번호 선택</option>
                        {numberOptions.map((number) => (
                          <option key={number} value={number}>
                            {number}
                          </option>
                        ))}
                      </select>
                      <div className="flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-3 text-center text-sm font-bold text-gray-700">
                        <span className="block w-full truncate whitespace-nowrap">
                          {targetStudentPreview?.name || "학생 이름"}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <input
                        value={targetStudentSearch}
                        onChange={(e) => setTargetStudentSearch(e.target.value)}
                        placeholder="이름으로 전체 학생 검색"
                        className="h-11 w-full min-w-0 rounded-xl border border-gray-300 px-3 text-sm"
                      />
                      {targetStudentSearch.trim() && (
                        <div className="max-h-48 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-2">
                          {searchedStudents.length > 0 ? (
                            <div className="space-y-1">
                              {searchedStudents.map((student) => (
                                <button
                                  key={student.uid}
                                  type="button"
                                  onClick={() => {
                                    setTargetGrade(student.grade || "");
                                    setTargetClass(student.className || "");
                                    setTargetNumber(student.number || "");
                                    setTargetStudentUid(student.uid);
                                    setSelectedStudentUids((prev) =>
                                      prev.includes(student.uid)
                                        ? prev
                                        : [...prev, student.uid],
                                    );
                                    setTargetStudentSearch("");
                                  }}
                                  className="flex w-full min-w-0 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-blue-50"
                                >
                                  <span className="min-w-0 truncate font-bold text-gray-900">
                                    {student.name}
                                  </span>
                                  <span className="shrink-0 text-xs font-semibold text-gray-500">
                                    {student.grade}-{student.className}{" "}
                                    {student.number}번
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="px-3 py-4 text-center text-sm font-semibold text-gray-400">
                              검색 결과가 없습니다.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <select
                      value={targetStudentUid}
                      onChange={(e) => {
                        setTargetStudentUid(e.target.value);
                        setTargetStudentSearch("");
                      }}
                      className="h-11 w-full min-w-0 rounded-xl border border-gray-300 px-3 text-sm"
                      title={
                        targetStudentPreview
                          ? `${targetStudentPreview.grade}-${targetStudentPreview.className} ${targetStudentPreview.number}번 ${targetStudentPreview.name}`
                          : "학생 선택"
                      }
                    >
                      <option value="">학생 선택</option>
                      {numberFilteredStudents.map((student) => (
                        <option key={student.uid} value={student.uid}>
                          {student.grade}-{student.className} {student.number}번{" "}
                          {student.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          !targetStudentUid ||
                          selectedStudentUids.includes(targetStudentUid)
                        )
                          return;
                        setSelectedStudentUids((prev) => [
                          ...prev,
                          targetStudentUid,
                        ]);
                        setTargetStudentUid("");
                        setTargetStudentSearch("");
                      }}
                      disabled={
                        !targetStudentUid ||
                        selectedStudentUids.includes(targetStudentUid)
                      }
                      className="h-11 rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-bold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      학생 추가
                    </button>
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
                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {selectedStudents.map((student) => (
                        <div
                          key={student.uid}
                          className="rounded-2xl border border-gray-200 bg-gray-50 p-3"
                        >
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="min-w-0 text-sm font-bold text-gray-900">
                              <span className="mr-2 rounded-full bg-white px-2 py-1 text-[11px] text-gray-600">
                                {student.grade}-{student.className}{" "}
                                {student.number}번
                              </span>
                              {student.name}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedStudentUids((prev) =>
                                  prev.filter((uid) => uid !== student.uid),
                                )
                              }
                              className="shrink-0 text-[11px] font-bold text-red-500"
                            >
                              삭제
                            </button>
                          </div>
                          <textarea
                            value={studentReasons[student.uid] || ""}
                            onChange={(event) =>
                              setStudentReasons((prev) => ({
                                ...prev,
                                [student.uid]: event.target.value,
                              }))
                            }
                            rows={2}
                            placeholder="왜 배정했는지 입력"
                            className="w-full resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                          />
                        </div>
                      ))}
                      {!selectedStudents.length && (
                        <div className="text-sm text-gray-400">
                          학생을 선택해서 추가하면 여기에 반별로 묶여
                          표시됩니다.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 md:col-span-2 xl:col-span-1 xl:col-start-3 xl:row-span-4 xl:row-start-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-gray-700">
                          선택한 배포 지도
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          빈칸과 정답은 지도 관리에서 저장한 값을 그대로
                          사용합니다.
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
                        {selectedMap?.title || "지도 미선택"}
                      </span>
                      <button
                        type="button"
                        onClick={() => openMapBlankManager(selectedMapId)}
                        className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50"
                      >
                        지도 관리에서 수정
                      </button>
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
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeBlank(blank.id);
                                }}
                                className="text-red-500"
                              >
                                삭제
                              </button>
                            </div>
                            <input
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
                            지도에서 영역을 드래그하거나 OCR 단어를 선택해
                            빈칸을 추가하세요.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 md:col-span-2 sm:flex-row sm:justify-end xl:col-span-3">
                    {worksheetEditingAssignmentId && (
                      <button
                        type="button"
                        onClick={() => {
                          setWorksheetEditingAssignmentId("");
                          setWorksheetEditingIsPublished(true);
                          setWorksheetImportSourceId("");
                          setWorksheetImportSourceTitle("");
                          setWorksheetSourceAssignment(null);
                          setTitle("");
                          setDescription("");
                          setTimeLimitMinutes(0);
                          setCooldownMinutes(0);
                          setDueWindowDays("");
                          setPassThresholdPercent(80);
                          setTargetGrade("");
                          setTargetClass("");
                          setTargetNumber("");
                          setTargetStudentUid("");
                          setTargetStudentSearch("");
                          setSelectedStudentUids([]);
                          setStudentReasons({});
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
                      >
                        수정 취소
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={saving}
                      className="rounded-2xl bg-orange-500 px-6 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60 sm:w-auto"
                    >
                      {saving
                        ? "저장 중..."
                        : worksheetEditingAssignmentId
                          ? "역사교실 수정 저장"
                          : "역사교실 저장"}
                    </button>
                  </div>
                </section>

                {false && (
                  <section className="hidden">
                    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-gray-700">
                            지도 선택 영역
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            지도 관리에 저장된 빈칸과 정답 배치를 확인합니다.
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
                              <button
                                type="button"
                                onClick={() => setWorksheetTool("box")}
                                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                                  worksheetTool === "box"
                                    ? "bg-blue-600 text-white shadow-sm"
                                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                                }`}
                              >
                                텍스트 박스
                              </button>
                              <button
                                type="button"
                                onClick={() => setWorksheetTool("ocr")}
                                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                                  worksheetTool === "ocr"
                                    ? "bg-blue-600 text-white shadow-sm"
                                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                                }`}
                              >
                                OCR 선택
                              </button>
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
                          PDF 지도를 먼저 선택해 주세요.
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
                                    {assignment.mapTitle}
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

      {isMapManagerOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-3 py-5 backdrop-blur-sm">
          <div className="flex max-h-[94vh] w-full max-w-[min(96vw,92rem)] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-5 py-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-500">
                  Map Blank Editor
                </div>
                <h2 className="mt-1 text-xl font-black text-gray-900">
                  배포 지도 관리
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveMapBlanks()}
                  disabled={savingMapBlanks}
                  className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingMapBlanks ? "저장 중..." : "빈칸 저장"}
                </button>
                <button
                  type="button"
                  onClick={closeMapBlankManager}
                  className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                >
                  닫기
                </button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 bg-gray-50 lg:grid-cols-[18rem_minmax(0,1fr)]">
              <aside className="min-h-0 border-r border-gray-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-sm font-black text-gray-900">
                    지도 목록
                  </div>
                  <div className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">
                    {maps.length}개
                  </div>
                </div>
                <div className="max-h-[calc(94vh-10rem)] space-y-2 overflow-y-auto pr-1">
                  {maps.map((map) => (
                    <button
                      key={map.id}
                      type="button"
                      onClick={() => {
                        setSelectedMapId(map.id);
                        setBlanks(cloneMapResourceBlanks(map));
                        setSelectedBlankId("");
                        setDraftBlank(null);
                        setDraftBlankAnswer("");
                        closeBlankEditor();
                      }}
                      className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                        map.id === selectedMapId
                          ? "border-blue-200 bg-blue-50 text-blue-800"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <div className="text-sm font-black">{map.title}</div>
                      <div className="mt-1 text-xs font-semibold text-gray-500">
                        빈칸 {map.pdfBlanks?.length || 0}개
                      </div>
                    </button>
                  ))}
                </div>
              </aside>
              <section className="min-h-0 overflow-y-auto p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
                  <div>
                    <div className="text-sm font-black text-gray-900">
                      {selectedStoredMap?.title || "지도 미선택"}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      백지도 위에서 영역을 드래그하거나 OCR 글자를 선택해 빈칸을
                      추가합니다.
                    </div>
                  </div>
                  <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
                    현재 빈칸 {blanks.length}개
                  </div>
                </div>
                {worksheetPageImages.length > 0 ? (
                  <div className="mx-auto max-w-[64rem]">
                    <LessonWorksheetStage
                      pageImages={worksheetPageImages}
                      blanks={worksheetBlanks}
                      textRegions={worksheetTextRegions}
                      mode="teacher-edit"
                      teacherTool={worksheetTool}
                      selectedBlankId={selectedBlankId || null}
                      pendingBlank={draftBlank}
                      onSelectBlank={handleSelectBlank}
                      onDeleteBlank={removeBlank}
                      onCreateBlankFromSelection={
                        handleCreateBlankFromSelection
                      }
                      annotationEnabled={false}
                      showPageLabel={false}
                    />
                  </div>
                ) : (
                  <div className="rounded-3xl border border-dashed border-gray-300 bg-white px-6 py-20 text-center text-sm font-semibold text-gray-400">
                    빈칸을 편집할 PDF 지도를 선택해 주세요.
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {editingAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/35 px-4 py-6">
          <div
            className={`relative flex h-[calc(100dvh-3rem)] max-h-[94vh] w-full flex-col overflow-hidden overscroll-contain rounded-3xl bg-white shadow-2xl transition-[max-width] ${
              previewOpen
                ? "max-w-[min(96vw,92rem)]"
                : "max-w-[min(96vw,72rem)]"
            }`}
          >
            <div className="shrink-0 flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <div className="text-xs font-bold text-orange-500">
                  {editingAssignment.mapTitle}
                </div>
                <div className="text-xl font-black text-gray-900">
                  역사교실 설정 수정
                </div>
              </div>
              <button
                type="button"
                onClick={closeAssignmentEditor}
                className="shrink-0 text-sm font-bold text-gray-500 hover:text-gray-700"
              >
                닫기
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain lg:overflow-hidden">
              <div className="grid min-h-full gap-0 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,0.82fr)_minmax(24rem,1.18fr)] xl:grid-cols-[minmax(0,0.78fr)_minmax(29rem,1.22fr)]">
                <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-5 [-webkit-overflow-scrolling:touch]">
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      <div>
                        <label className="mb-1 block whitespace-nowrap text-[11px] font-bold text-gray-500">
                          제한 시간(분)
                        </label>
                        <input
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
                        <input
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
                        <input
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
                        <input
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
                            현재 배포 지도
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            선택한 배포 지도의 빈칸과 정답으로 과제를
                            교체합니다.
                          </div>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-600">
                          현재 {editingAssignment.mapTitle}
                        </span>
                      </div>
                      <label className="mt-3 block">
                        <span className="mb-1 block text-xs font-bold text-gray-500">
                          배포 지도 교체
                        </span>
                        <select
                          value={editingMapResourceId}
                          onChange={(event) =>
                            setEditingMapResourceId(event.target.value)
                          }
                          className="h-10 w-full rounded-xl border border-orange-200 bg-white px-3 text-sm font-bold text-gray-800 outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                        >
                          {maps.map((map) => (
                            <option key={map.id} value={map.id}>
                              {map.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      {editingSelectedMap &&
                        editingSelectedMap.id !==
                          editingAssignment.mapResourceId && (
                          <div className="mt-2 rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-blue-700">
                            저장하면 {editingSelectedMap.title} 지도로
                            교체됩니다.
                          </div>
                        )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            openMapBlankManager(
                              editingMapResourceId ||
                                editingAssignment.mapResourceId,
                            )
                          }
                          className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs font-bold text-orange-700 hover:bg-orange-50"
                        >
                          선택한 지도 관리
                        </button>
                      </div>
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
                                if (current) setEditingStudentSearch("");
                                return !current;
                              });
                            }}
                            className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold transition ${
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
                        <div className="mb-3 space-y-2">
                          <input
                            value={editingStudentSearch}
                            onChange={(event) =>
                              setEditingStudentSearch(event.target.value)
                            }
                            placeholder="학년 반 번호 또는 이름 검색"
                            className="h-10 w-full min-w-0 rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                            autoFocus
                          />
                          {editingStudentSearch.trim() && (
                            <div className="max-h-44 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-2">
                              {searchedEditingStudents.length > 0 ? (
                                <div className="space-y-1">
                                  {searchedEditingStudents.map((student) => (
                                    <button
                                      key={student.uid}
                                      type="button"
                                      onClick={() => {
                                        setEditingStudentUids((prev) =>
                                          prev.includes(student.uid)
                                            ? prev
                                            : [...prev, student.uid],
                                        );
                                        setEditingStudentSearch("");
                                      }}
                                      className="flex w-full min-w-0 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-blue-50"
                                    >
                                      <span className="min-w-0 truncate font-bold text-gray-900">
                                        {student.name}
                                      </span>
                                      <span className="shrink-0 text-xs font-semibold text-gray-500">
                                        {student.grade}-{student.className}{" "}
                                        {student.number}번
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="px-3 py-4 text-center text-sm font-semibold text-gray-400">
                                  검색 결과가 없습니다.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                        {editingStudents.map((student) => (
                          <div
                            key={student.uid}
                            className="rounded-2xl bg-white px-3 py-2"
                          >
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <div className="min-w-0 text-sm font-bold text-gray-900">
                                <span className="mr-2 rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-600">
                                  {student.grade}-{student.className}{" "}
                                  {student.number}번
                                </span>
                                {student.name}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingStudentUids((prev) =>
                                    prev.filter((uid) => uid !== student.uid),
                                  );
                                  setEditingStudentReasons((prev) => {
                                    const next = { ...prev };
                                    delete next[student.uid];
                                    return next;
                                  });
                                }}
                                className="shrink-0 text-[11px] font-bold text-red-500"
                              >
                                삭제
                              </button>
                            </div>
                            <textarea
                              value={editingStudentReasons[student.uid] || ""}
                              onChange={(event) =>
                                setEditingStudentReasons((prev) => ({
                                  ...prev,
                                  [student.uid]: event.target.value,
                                }))
                              }
                              rows={2}
                              placeholder="왜 배정했는지 입력"
                              className="w-full resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                            />
                          </div>
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

                <div className="flex min-h-0 flex-col overflow-visible border-t border-gray-200 bg-gray-50 px-5 py-5 lg:h-full lg:overflow-hidden lg:border-l lg:border-t-0 lg:px-5">
                  <div className="shrink-0 rounded-2xl border border-gray-200 bg-white p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-bold text-gray-700">
                        응시 현황
                      </div>
                      <div className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">
                        {editingAttemptStatusRows.length}명
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                        완료 {editingAttemptStatusCounts.completed}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                        응시 전 {editingAttemptStatusCounts.pending}
                      </span>
                      <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700">
                        미응시 {editingAttemptStatusCounts.overdueAbsent}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-[minmax(8rem,1fr)_6.5rem_5rem_7rem] items-center gap-2 border-b border-gray-200 px-3 pb-1.5 text-[11px] font-bold text-gray-400">
                      <div>학생</div>
                      <div className="text-center">점수·판정</div>
                      <div className="text-center">상태</div>
                      <div className="text-center">조치</div>
                    </div>
                    <div className="mt-1 max-h-60 space-y-1.5 overflow-y-auto pr-1">
                      {editingAttemptStatusRows.map((row) => (
                        <div
                          key={row.student.uid}
                          className={`rounded-xl border px-3 py-2 ${row.toneClassName}`}
                        >
                          <div className="grid grid-cols-[minmax(8rem,1fr)_6.5rem_5rem_7rem] items-center gap-2">
                            <div className="contents">
                              <div className="contents">
                                <div className="truncate text-sm font-bold">
                                  {formatStudentBadgeLabel(row.student)}
                                </div>
                                <div className="min-w-0 truncate text-center text-[11px] font-semibold opacity-80">
                                  {row.detailLabel}
                                </div>
                              </div>
                              <div className="sr-only">{row.detailLabel}</div>
                            </div>
                            <span className="justify-self-center rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold">
                              {row.statusLabel}
                            </span>
                            {row.canResetAttempt && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleResetStudentAttemptCooldown(
                                    row.student,
                                  )
                                }
                                disabled={
                                  resettingAttemptUid === row.student.uid
                                }
                                className="justify-self-end whitespace-nowrap rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {resettingAttemptUid === row.student.uid
                                  ? "초기화 중"
                                  : "응시 시간 초기화"}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 flex min-h-[16rem] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white p-3.5 lg:min-h-0 lg:flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-bold text-gray-700">
                        결과
                      </div>
                      <div className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">
                        {editingResultRows.length}/
                        {editingVisibleResults.length}건
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        {EDITING_RESULT_STATUS_FILTERS.map((option) => {
                          const selected =
                            editingResultStatusFilter === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() =>
                                setEditingResultStatusFilter(option.value)
                              }
                              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                                selected
                                  ? "bg-blue-600 text-white"
                                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                              }`}
                            >
                              {option.label}{" "}
                              {editingResultStatusCounts[option.value]}
                            </button>
                          );
                        })}
                      </div>
                      <select
                        value={editingResultSortOrder}
                        onChange={(event) =>
                          setEditingResultSortOrder(
                            event.target.value as EditingResultSortOrder,
                          )
                        }
                        className="ml-auto h-7 min-w-[7.5rem] rounded-full border border-gray-200 bg-white px-2 text-[11px] font-bold text-gray-600 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                        aria-label="결과 정렬"
                      >
                        {EDITING_RESULT_SORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-3 max-h-[min(52vh,30rem)] min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-1 [-webkit-overflow-scrolling:touch] lg:max-h-none">
                      <div className="sticky top-0 z-10 grid grid-cols-[minmax(5.5rem,1fr)_minmax(7rem,1fr)_minmax(4.25rem,0.65fr)_minmax(3.25rem,0.55fr)_minmax(4rem,0.65fr)_2.25rem] items-center gap-2 border-b border-gray-200 bg-white px-[13px] pb-1.5 text-[11px] font-bold text-gray-400">
                        <div>학생</div>
                        <div className="text-center">제출 일시</div>
                        <div className="text-center">제출</div>
                        <div className="text-center">점수</div>
                        <div className="text-center">판정</div>
                        <div className="text-center">지도</div>
                      </div>
                      {editingResultRows.map((result) => (
                        <div
                          key={result.id}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2"
                        >
                          <div className="grid grid-cols-[minmax(5.5rem,1fr)_minmax(7rem,1fr)_minmax(4.25rem,0.65fr)_minmax(3.25rem,0.55fr)_minmax(4rem,0.65fr)_2.25rem] items-center gap-2">
                            <div className="min-w-0">
                              <div className="space-y-0.5">
                                <div className="truncate text-sm font-bold text-gray-900">
                                  {result.studentName}
                                </div>
                                <div className="mt-0.5 truncate text-[11px] font-semibold text-gray-500">
                                  {[
                                    result.studentGrade,
                                    result.studentClass,
                                    result.studentNumber,
                                  ]
                                    .filter(Boolean)
                                    .join("-")}
                                </div>
                              </div>
                            </div>
                            <div className="truncate text-center text-[11px] font-semibold text-gray-500">
                              {formatResultSubmittedAtLabel(result.createdAt)}
                            </div>
                            <div className="truncate text-center text-[11px] font-semibold text-gray-500">
                              {result.score}/{result.total}
                            </div>
                            <div className="contents">
                              <div className="text-center text-sm font-black text-gray-900">
                                {result.percent}%
                              </div>
                              <span
                                className={`inline-flex justify-self-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                  result.status === "passed"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : result.status === "failed"
                                      ? "bg-rose-50 text-rose-700"
                                      : "bg-amber-50 text-amber-700"
                                }`}
                              >
                                {describeHistoryResultStatus(result.status)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setPreviewOpen(false);
                                setReviewResultId(result.id);
                              }}
                              className="flex h-8 w-8 items-center justify-center justify-self-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                              aria-label="지도 확인"
                              title="지도 확인"
                            >
                              <DashboardIcon name="map" className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                      {!editingResultRows.length && (
                        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-400">
                          조건에 맞는 결과가 없습니다.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-gray-200 bg-white/95 px-6 py-4 backdrop-blur">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDeleteAssignment()}
                    disabled={savingEdit || deletingAssignment}
                    className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingAssignment ? "삭제 중..." : "과제 삭제"}
                  </button>
                  <button
                    type="button"
                    onClick={closeAssignmentEditor}
                    className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
                  >
                    취소
                  </button>
                  <button
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
                  >
                    {previewOpen ? "미리보기 닫기" : "미리보기"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveAssignmentEdit()}
                    disabled={savingEdit || deletingAssignment}
                    className="rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60"
                  >
                    {savingEdit ? "저장 중..." : "설정 저장"}
                  </button>
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
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(false)}
                    className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                  >
                    설정으로 돌아가기
                  </button>
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
                  <button
                    type="button"
                    onClick={() => setReviewResultId("")}
                    className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                  >
                    닫기
                  </button>
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
              <button
                type="button"
                onClick={() => setWorksheetTool("box")}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                  worksheetTool === "box"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                텍스트 박스
              </button>
              <button
                type="button"
                onClick={() => setWorksheetTool("ocr")}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                  worksheetTool === "ocr"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                OCR 선택
              </button>
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
                <button
                  type="button"
                  onClick={handleCancelDraftBlank}
                  className="text-xs font-bold text-gray-500"
                >
                  취소
                </button>
              </div>
              <div className="text-xs text-gray-500">
                p.{draftBlank.page} 영역을 선택했습니다.
              </div>
              <input
                type="text"
                value={draftBlankAnswer}
                onChange={(e) => setDraftBlankAnswer(e.target.value)}
                className="w-full rounded-lg border border-amber-300 px-2.5 py-1.5 text-sm"
                placeholder="정답을 입력해 주세요"
                autoFocus
              />
              <button
                type="button"
                onClick={handleConfirmDraftBlank}
                className="w-full rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-600"
              >
                빈칸 추가
              </button>
            </div>
          ) : selectedBlank ? (
            <div className="space-y-2.5 rounded-2xl border border-blue-100 bg-white/98 p-3 shadow-2xl backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-blue-900">
                  선택한 빈칸
                </div>
                <button
                  type="button"
                  onClick={() => removeBlank(selectedBlank.id)}
                  className="text-xs font-bold text-red-600"
                >
                  삭제
                </button>
              </div>
              <div className="text-xs text-gray-500">
                p.{selectedBlank.page}
              </div>
              <input
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
                <button
                  type="button"
                  onClick={
                    blankEditorMode === "create"
                      ? handleCancelDraftBlank
                      : closeBlankEditor
                  }
                  className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  닫기
                </button>
              </div>

              <div className="max-h-[calc(90vh-8rem)] overflow-y-auto px-5 py-5">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    답 입력
                  </span>
                  <input
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
                  <button
                    type="button"
                    onClick={() => removeBlank(selectedBlank.id)}
                    className="mr-auto rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    삭제
                  </button>
                )}
                <button
                  type="button"
                  onClick={
                    blankEditorMode === "create"
                      ? handleCancelDraftBlank
                      : closeBlankEditor
                  }
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSubmitBlankEditor}
                  className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  {blankEditorMode === "create" ? "등록" : "저장"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isMapManagerOpen && (
        <div className="fixed bottom-5 right-5 z-[65] flex max-w-[calc(100vw-2.5rem)] flex-col items-end gap-3">
          {floatingPanelOpen && (
            <div className="w-[min(18rem,calc(100vw-2.5rem))] space-y-2.5">
              <div className="rounded-2xl border border-gray-200 bg-white/96 p-3 shadow-2xl backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400">
                    빈칸 목록
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
            </div>
          )}

          <button
            type="button"
            onClick={() => setFloatingPanelOpen((prev) => !prev)}
            aria-label={
              floatingPanelOpen ? "플로팅 도구 닫기" : "플로팅 도구 열기"
            }
            className={`flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-2xl transition duration-200 hover:bg-blue-700 ${
              floatingPanelOpen ? "scale-90" : "scale-100"
            }`}
          >
            <i
              className={`fas ${floatingPanelOpen ? "fa-times" : "fa-layer-group"} text-lg`}
            ></i>
          </button>
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
