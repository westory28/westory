import { getSemesterCollectionPath } from "./semesterScope";

export type TeacherPresentationClassContext = {
  classId: string;
  classLabel: string;
  grade?: string;
  className?: string;
};

export type TeacherPresentationSaveState =
  | "restoring"
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "error";

export type TeacherPresentationClassSummary = {
  classId: string;
  classLabel: string;
  grade?: string;
  className?: string;
  lastUsedAt?: Date | null;
  updatedAt?: Date | null;
  currentPage?: number | null;
  hasSavedState?: boolean;
  isFallback?: boolean;
  runtimeState?: TeacherPresentationSaveState | null;
  hasUnsavedChanges?: boolean;
  statusText?: string;
};

export type TeacherPresentationRuntimeStatus = {
  classId: string;
  classLabel: string;
  saveState: TeacherPresentationSaveState;
  currentPage: number | null;
  lastSavedAt: Date | null;
  hasUnsavedChanges: boolean;
  statusText: string;
};

export type TeacherPresentationRecentContext = {
  teacherUid?: string | null;
  lessonId?: string | null;
};

export type TeacherPresentationLauncherState = {
  selectedClassId: string;
  selectedClassLabel: string;
  recentItems: TeacherPresentationClassSummary[];
};

type RecentTeacherPresentationClassRecord = {
  classId: string;
  classLabel: string;
  grade?: string;
  className?: string;
  currentPage?: number | null;
  updatedAt?: string | null;
  lastUsedAt?: string | null;
  hasSavedState?: boolean;
  runtimeState?: TeacherPresentationSaveState | null;
  hasUnsavedChanges?: boolean;
  statusText?: string;
};

const RECENT_CLASS_STORAGE_PREFIX =
  "westory:teacher-presentation:recent-class:v2";
const DEFAULT_CLASS_ID = "preview-default";
const DEFAULT_CLASS_LABEL = "미리보기용 공용 상태";

export const sanitizeTeacherPresentationKey = (value: string) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();

const sanitizeDisplayToken = (value?: string | null) =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseNumericSegment = (value?: string | null) => {
  const match = String(value || "")
    .trim()
    .match(/\d+/);
  return match ? Number(match[0]) : Number.NaN;
};

const parseClassIdSegments = (classId?: string | null) => {
  const cleaned = String(classId || "").trim();
  const numberSegments = cleaned.split(/[^0-9]+/).filter(Boolean);

  if (numberSegments.length >= 2) {
    return {
      grade: numberSegments[0],
      className: numberSegments[1],
    };
  }

  const textSegments = sanitizeDisplayToken(cleaned).split(" ").filter(Boolean);
  if (textSegments.length >= 2) {
    return {
      grade: textSegments[0],
      className: textSegments[1],
    };
  }

  return {
    grade: "",
    className: "",
  };
};

const buildReadableClassFallback = (classId?: string | null) => {
  const normalized = sanitizeDisplayToken(classId);
  if (
    !normalized ||
    sanitizeTeacherPresentationKey(normalized) === DEFAULT_CLASS_ID
  ) {
    return DEFAULT_CLASS_LABEL;
  }

  const { grade, className } = parseClassIdSegments(normalized);
  if (grade || className) {
    return buildTeacherPresentationClassLabel(grade, className);
  }

  return `${normalized}반`;
};

export const buildTeacherPresentationClassId = (
  grade?: string,
  className?: string,
) => {
  const safeGrade = sanitizeTeacherPresentationKey(grade || "");
  const safeClassName = sanitizeTeacherPresentationKey(className || "");
  if (safeGrade && safeClassName) {
    return `${safeGrade}-${safeClassName}`;
  }
  return safeGrade || safeClassName || DEFAULT_CLASS_ID;
};

export const buildTeacherPresentationClassLabel = (
  grade?: string,
  className?: string,
) => {
  const safeGrade = sanitizeDisplayToken(grade);
  const safeClassName = sanitizeDisplayToken(className);
  if (safeGrade && safeClassName) {
    return `${safeGrade}학년 ${safeClassName}반`;
  }
  if (safeGrade) return `${safeGrade}학년`;
  if (safeClassName) return `${safeClassName}반`;
  return DEFAULT_CLASS_LABEL;
};

export const resolveTeacherPresentationClassLabel = (params?: {
  classId?: string | null;
  classLabel?: string | null;
  grade?: string | null;
  className?: string | null;
  preferredLabel?: string | null;
}) => {
  const explicitLabel = sanitizeDisplayToken(
    params?.preferredLabel || params?.classLabel,
  );
  if (explicitLabel) {
    const { grade, className } = parseClassIdSegments(explicitLabel);
    if (grade || className) {
      return buildTeacherPresentationClassLabel(grade, className);
    }
    return explicitLabel;
  }

  const safeGrade = sanitizeDisplayToken(params?.grade);
  const safeClassName = sanitizeDisplayToken(params?.className);
  if (safeGrade || safeClassName) {
    return buildTeacherPresentationClassLabel(safeGrade, safeClassName);
  }

  return buildReadableClassFallback(params?.classId);
};

export const normalizeTeacherPresentationClassContext = (params?: {
  classId?: string | null;
  classLabel?: string | null;
  grade?: string | null;
  className?: string | null;
}): TeacherPresentationClassContext => {
  const grade = sanitizeDisplayToken(params?.grade);
  const className = sanitizeDisplayToken(params?.className);
  const derivedClassId =
    sanitizeTeacherPresentationKey(params?.classId || "") ||
    buildTeacherPresentationClassId(grade, className);

  return {
    classId: derivedClassId,
    classLabel: resolveTeacherPresentationClassLabel({
      classId: derivedClassId,
      classLabel: params?.classLabel,
      grade,
      className,
    }),
    grade: grade || undefined,
    className: className || undefined,
  };
};

export const normalizeTeacherPresentationClassSummary = (
  params?: Partial<TeacherPresentationClassSummary> | null,
): TeacherPresentationClassSummary | null => {
  if (!params) return null;

  const grade = sanitizeDisplayToken(params.grade);
  const className = sanitizeDisplayToken(params.className);
  const classId =
    sanitizeTeacherPresentationKey(params.classId || "") ||
    buildTeacherPresentationClassId(grade, className);
  const classLabel = resolveTeacherPresentationClassLabel({
    classId,
    classLabel: params.classLabel,
    grade,
    className,
  });

  if (!classId && !classLabel) return null;

  return {
    classId: classId || DEFAULT_CLASS_ID,
    classLabel: classLabel || DEFAULT_CLASS_LABEL,
    grade: grade || undefined,
    className: className || undefined,
    currentPage:
      typeof params.currentPage === "number" ? params.currentPage : null,
    updatedAt: params.updatedAt || null,
    lastUsedAt: params.lastUsedAt || null,
    hasSavedState:
      params.hasSavedState ??
      Boolean(params.updatedAt || params.lastUsedAt || params.currentPage),
    isFallback: params.isFallback ?? false,
    runtimeState: params.runtimeState ?? null,
    hasUnsavedChanges: params.hasUnsavedChanges ?? false,
    statusText: sanitizeDisplayToken(params.statusText) || undefined,
  };
};

export const buildTeacherPresentationDocPath = (params: {
  config: { year: string; semester: string } | null | undefined;
  lessonId: string;
  teacherUid: string;
  classId: string;
}) =>
  `${getSemesterCollectionPath(params.config, "lesson_presentations")}/${params.lessonId}/teachers/${params.teacherUid}/classes/${params.classId}`;

export const getTeacherPresentationLegacyDocPath = (
  config: { year: string; semester: string } | null | undefined,
  lessonId: string,
  teacherUid: string,
) =>
  `${getSemesterCollectionPath(config, "lesson_presentations")}/${lessonId}/teachers/${teacherUid}`;

export const getTeacherPresentationClassDocPath = (
  config: { year: string; semester: string } | null | undefined,
  lessonId: string,
  teacherUid: string,
  classId: string,
) =>
  buildTeacherPresentationDocPath({
    config,
    lessonId,
    teacherUid,
    classId,
  });

export const buildTeacherPresentationRecentClassStorageKey = (
  teacherUid: string,
  lessonId: string,
) =>
  `${RECENT_CLASS_STORAGE_PREFIX}:${sanitizeTeacherPresentationKey(
    teacherUid,
  )}:${sanitizeTeacherPresentationKey(lessonId)}`;

const canUseBrowserStorage = () =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export const readRecentTeacherPresentationClass = (
  params: TeacherPresentationRecentContext,
): TeacherPresentationClassSummary | null => {
  if (!params.teacherUid || !params.lessonId || !canUseBrowserStorage()) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(
      buildTeacherPresentationRecentClassStorageKey(
        params.teacherUid,
        params.lessonId,
      ),
    );
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue) as RecentTeacherPresentationClassRecord;
    return normalizeTeacherPresentationClassSummary({
      classId: parsed.classId,
      classLabel: parsed.classLabel,
      grade: parsed.grade,
      className: parsed.className,
      currentPage:
        typeof parsed.currentPage === "number" ? parsed.currentPage : null,
      updatedAt: parsed.updatedAt ? new Date(parsed.updatedAt) : null,
      lastUsedAt: parsed.lastUsedAt ? new Date(parsed.lastUsedAt) : null,
      hasSavedState: parsed.hasSavedState,
      runtimeState: parsed.runtimeState ?? null,
      hasUnsavedChanges: parsed.hasUnsavedChanges ?? false,
      statusText: parsed.statusText,
      isFallback: false,
    });
  } catch (error) {
    console.warn("Failed to read recent teacher presentation class:", error);
    return null;
  }
};

export const writeRecentTeacherPresentationClass = (params: {
  teacherUid?: string | null;
  lessonId?: string | null;
  summary: TeacherPresentationClassSummary;
}) => {
  if (!params.teacherUid || !params.lessonId || !canUseBrowserStorage()) return;
  const normalizedSummary = normalizeTeacherPresentationClassSummary(
    params.summary,
  );
  if (!normalizedSummary) return;

  const payload: RecentTeacherPresentationClassRecord = {
    classId: normalizedSummary.classId,
    classLabel: normalizedSummary.classLabel,
    grade: normalizedSummary.grade,
    className: normalizedSummary.className,
    currentPage: normalizedSummary.currentPage ?? null,
    updatedAt: normalizedSummary.updatedAt?.toISOString() || null,
    lastUsedAt: normalizedSummary.lastUsedAt?.toISOString() || null,
    hasSavedState: normalizedSummary.hasSavedState ?? false,
    runtimeState: normalizedSummary.runtimeState ?? null,
    hasUnsavedChanges: normalizedSummary.hasUnsavedChanges ?? false,
    statusText: normalizedSummary.statusText,
  };

  try {
    window.localStorage.setItem(
      buildTeacherPresentationRecentClassStorageKey(
        params.teacherUid,
        params.lessonId,
      ),
      JSON.stringify(payload),
    );
  } catch (error) {
    console.warn("Failed to write recent teacher presentation class:", error);
  }
};

export const shouldUseLegacyTeacherPresentationFallback = (params: {
  hasClassDocument: boolean;
}) => !params.hasClassDocument;

export const shouldWarnOnClassSwitch = (params: {
  saveState: TeacherPresentationSaveState;
  hasUnsavedChanges: boolean;
}) =>
  params.hasUnsavedChanges &&
  (params.saveState === "dirty" ||
    params.saveState === "saving" ||
    params.saveState === "error");

export const getTeacherPresentationWarningState = (params: {
  saveState: TeacherPresentationSaveState;
  hasUnsavedChanges: boolean;
  classLabel: string;
}) => {
  const shouldWarn = shouldWarnOnClassSwitch(params);
  if (!shouldWarn) {
    return {
      shouldWarnOnClose: false,
      shouldWarnOnClassSwitch: false,
      closeMessage: "",
      classSwitchMessage: "",
      unloadMessage: "",
    };
  }

  const baseMessage =
    params.saveState === "error"
      ? `${params.classLabel} 저장에 실패한 메모가 있습니다.`
      : `${params.classLabel}에 저장하지 않은 판서가 있습니다.`;

  return {
    shouldWarnOnClose: true,
    shouldWarnOnClassSwitch: true,
    closeMessage: `${baseMessage} 닫으면 마지막 변경이 사라질 수 있습니다.`,
    classSwitchMessage: `${baseMessage} 다른 반으로 전환하기 전에 저장 여부를 확인하세요.`,
    unloadMessage: `${params.classLabel}에 저장하지 않은 판서가 있습니다.`,
  };
};

export const sortTeacherPresentationClasses = (
  items: TeacherPresentationClassSummary[],
  activeClassId?: string | null,
) =>
  [...items].sort((left, right) => {
    const leftActive = activeClassId && left.classId === activeClassId ? -1 : 0;
    const rightActive =
      activeClassId && right.classId === activeClassId ? -1 : 0;
    if (leftActive !== rightActive) return leftActive - rightActive;

    const leftRuntimeError = left.runtimeState === "error" ? -1 : 0;
    const rightRuntimeError = right.runtimeState === "error" ? -1 : 0;
    if (leftRuntimeError !== rightRuntimeError) {
      return leftRuntimeError - rightRuntimeError;
    }

    const leftRecent =
      left.lastUsedAt?.getTime() || left.updatedAt?.getTime() || 0;
    const rightRecent =
      right.lastUsedAt?.getTime() || right.updatedAt?.getTime() || 0;
    if (leftRecent !== rightRecent) return rightRecent - leftRecent;

    const leftGradeNum = parseNumericSegment(left.grade);
    const rightGradeNum = parseNumericSegment(right.grade);
    if (!Number.isNaN(leftGradeNum) || !Number.isNaN(rightGradeNum)) {
      if (leftGradeNum !== rightGradeNum) return leftGradeNum - rightGradeNum;
    }

    const leftClassNum = parseNumericSegment(left.className);
    const rightClassNum = parseNumericSegment(right.className);
    if (!Number.isNaN(leftClassNum) || !Number.isNaN(rightClassNum)) {
      if (leftClassNum !== rightClassNum) return leftClassNum - rightClassNum;
    }

    const gradeCompare = String(left.grade || "").localeCompare(
      String(right.grade || ""),
      "ko",
    );
    if (gradeCompare !== 0) return gradeCompare;

    const classCompare = String(left.className || "").localeCompare(
      String(right.className || ""),
      "ko",
    );
    if (classCompare !== 0) return classCompare;

    return left.classLabel.localeCompare(right.classLabel, "ko");
  });

export const getRecentTeacherPresentationItems = (
  items: TeacherPresentationClassSummary[],
  maxItems = 3,
) =>
  sortTeacherPresentationClasses(
    items.filter(
      (item) =>
        item.hasSavedState ||
        item.runtimeState === "error" ||
        item.hasUnsavedChanges,
    ),
  ).slice(0, maxItems);

export const formatTeacherPresentationSavedAt = (value: Date | null) =>
  value
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(value)
    : "";

export const getTeacherPresentationStatusText = (params: {
  state: TeacherPresentationSaveState;
  classLabel: string;
  savedAt?: Date | null;
}) => {
  const { state, savedAt } = params;
  if (state === "restoring") {
    return "불러오는 중";
  }
  if (state === "dirty") {
    return "변경됨";
  }
  if (state === "saving") {
    return "저장 중";
  }
  if (state === "error") {
    return "저장 안 됨";
  }
  if (state === "saved" && savedAt) {
    return `저장됨 · ${formatTeacherPresentationSavedAt(savedAt)}`;
  }
  if (state === "saved") {
    return "저장됨";
  }
  return "기록 없음";
};

export const getTeacherPresentationRuntimeBadge = (
  summary?: Pick<
    TeacherPresentationClassSummary,
    "runtimeState" | "hasUnsavedChanges" | "hasSavedState"
  > | null,
) => {
  if (!summary) {
    return {
      tone: "slate" as const,
      text: "기록 없음",
    };
  }
  if (summary.runtimeState === "error") {
    return {
      tone: "rose" as const,
      text: "저장 안 됨",
    };
  }
  if (summary.hasUnsavedChanges || summary.runtimeState === "dirty") {
    return {
      tone: "amber" as const,
      text: "변경됨",
    };
  }
  if (summary.hasSavedState) {
    return {
      tone: "blue" as const,
      text: "저장됨",
    };
  }
  return {
    tone: "slate" as const,
    text: "기록 없음",
  };
};

export const getTeacherPresentationSelectorSummaryText = (
  summary?: TeacherPresentationClassSummary | null,
) => {
  if (!summary) {
    return "선택한 반의 저장 상태를 확인하는 중입니다.";
  }
  if (summary.runtimeState === "error") {
    return "이 반의 저장이 실패했습니다. 다시 저장해 주세요.";
  }
  if (summary.hasUnsavedChanges) {
    return "이 반에는 저장하지 않은 변경이 있습니다.";
  }
  return getTeacherPresentationClassSummaryText(summary);
};

export const getTeacherPresentationClassSummaryText = (
  summary?: Pick<
    TeacherPresentationClassSummary,
    "classLabel" | "updatedAt" | "lastUsedAt" | "currentPage" | "hasSavedState"
  > | null,
) => {
  if (!summary) {
    return "최근 사용 정보가 없습니다.";
  }
  if (!summary.hasSavedState) {
    return "아직 저장된 수업 메모가 없습니다.";
  }
  const savedAt =
    formatTeacherPresentationSavedAt(
      summary.lastUsedAt || summary.updatedAt || null,
    ) || "시간 기록 없음";
  const pageText = summary.currentPage
    ? `${summary.currentPage}페이지`
    : "페이지 기록 없음";
  return `마지막 저장 ${savedAt} · ${pageText}`;
};
