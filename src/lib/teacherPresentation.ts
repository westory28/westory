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

const DEFAULT_CLASS_ID = "preview-default";
const DEFAULT_CLASS_LABEL = "미리보기";

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
