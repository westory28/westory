import type { MapResource } from "./mapResources";
import {
  clampRatio,
  getTightTextRegionBounds,
  normalizeBlankText,
  splitTextRegionIntoTokens,
  type LessonWorksheetPageImage,
  type LessonWorksheetTextRegion,
} from "./lessonWorksheet";

export type HistoryClassroomBlankSource = "ocr" | "manual";

export interface HistoryClassroomBlank {
  id: string;
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
  answer: string;
  prompt?: string;
  source?: HistoryClassroomBlankSource;
}

export interface HistoryClassroomAssignment {
  id: string;
  title: string;
  description: string;
  mapResourceId: string;
  mapTitle: string;
  pdfPageImages: MapResource["pdfPageImages"];
  pdfRegions: MapResource["pdfRegions"];
  blanks: HistoryClassroomBlank[];
  answerOptions: string[];
  timeLimitMinutes: number;
  cooldownMinutes: number;
  passThresholdPercent: number;
  dueWindowDays: number | null;
  targetGrade: string;
  targetClass: string;
  targetStudentUid: string;
  targetStudentUids: string[];
  targetStudentAccessMap: Record<string, boolean>;
  targetStudentName: string;
  targetStudentNames: string[];
  targetStudentReasons: Record<string, string>;
  targetStudentNumber: string;
  isPublished: boolean;
  publishedAt?: unknown;
  dueAt?: unknown;
  deletedAt?: unknown;
  deletedByUid?: string;
  retryResetByStudentUid?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type HistoryClassroomResultStatus = "passed" | "failed" | "cancelled";

export interface HistoryClassroomResult {
  id: string;
  assignmentId: string;
  assignmentTitle?: string;
  uid: string;
  studentName: string;
  studentGrade?: string;
  studentClass?: string;
  studentNumber?: string;
  answers: Record<string, string>;
  score: number;
  total: number;
  percent: number;
  passThresholdPercent: number;
  passed: boolean;
  status: HistoryClassroomResultStatus;
  cancellationReason?: string;
  createdAt?: unknown;
}

const collectHistoryClassroomTargetStudentUids = (
  raw: Partial<HistoryClassroomAssignment>,
) =>
  Array.from(
    new Set([
      ...(Array.isArray(raw.targetStudentUids)
        ? raw.targetStudentUids
            .map((item) => String(item || "").trim())
            .filter(Boolean)
        : []),
      ...(String(raw.targetStudentUid || "").trim()
        ? [String(raw.targetStudentUid || "").trim()]
        : []),
      ...((raw.targetStudentAccessMap &&
      typeof raw.targetStudentAccessMap === "object"
        ? Object.entries(raw.targetStudentAccessMap)
            .filter(([, value]) => value === true)
            .map(([uid]) => String(uid || "").trim())
            .filter(Boolean)
        : []) as string[]),
    ]),
  );

export const normalizeHistoryClassroomAssignment = (
  id: string,
  raw: Partial<HistoryClassroomAssignment>,
): HistoryClassroomAssignment => {
  const targetStudentUids = collectHistoryClassroomTargetStudentUids(raw);

  return {
    id,
    title: String(raw.title || "").trim() || "역사교실",
    description: String(raw.description || "").trim(),
    mapResourceId: String(raw.mapResourceId || "").trim(),
    mapTitle: String(raw.mapTitle || "").trim(),
    pdfPageImages: Array.isArray(raw.pdfPageImages)
      ? raw.pdfPageImages
          .map((page) => ({
            page: Math.max(1, Number(page?.page) || 1),
            imageUrl: String(page?.imageUrl || "").trim(),
            width: Math.max(0, Number(page?.width) || 0),
            height: Math.max(0, Number(page?.height) || 0),
          }))
          .filter((page) => page.imageUrl)
          .sort((left, right) => left.page - right.page)
      : [],
    pdfRegions: Array.isArray(raw.pdfRegions)
      ? raw.pdfRegions
          .map((region) => ({
            label: String(region?.label || "").trim(),
            page: Math.max(1, Number(region?.page) || 1),
            left: Number(region?.left) || 0,
            top: Number(region?.top) || 0,
            width: Number(region?.width) || 0,
            height: Number(region?.height) || 0,
            shortcutEnabled: region?.shortcutEnabled !== false,
            tags: Array.isArray(region?.tags)
              ? region.tags
                  .map((tag) => String(tag || "").trim())
                  .filter(Boolean)
              : [],
          }))
          .filter(
            (region) => region.label && region.width > 0 && region.height > 0,
          )
      : [],
    blanks: Array.isArray(raw.blanks)
      ? raw.blanks.map((blank) => ({
          id: String(blank?.id || "").trim() || `blank-${Date.now()}`,
          page: Number(blank?.page) || 1,
          left: Number(blank?.left) || 0,
          top: Number(blank?.top) || 0,
          width: Number(blank?.width) || 140,
          height: Number(blank?.height) || 52,
          answer: String(blank?.answer || "").trim(),
          prompt: String(blank?.prompt || "").trim(),
          source: blank?.source === "ocr" ? "ocr" : "manual",
        }))
      : [],
    answerOptions: Array.isArray(raw.answerOptions)
      ? raw.answerOptions
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    timeLimitMinutes: Math.max(0, Number(raw.timeLimitMinutes) || 0),
    cooldownMinutes: Number(raw.cooldownMinutes) || 0,
    passThresholdPercent: Math.min(
      100,
      Math.max(0, Number(raw.passThresholdPercent) || 80),
    ),
    dueWindowDays:
      Number.isFinite(Number(raw.dueWindowDays)) &&
      Number(raw.dueWindowDays) > 0
        ? Math.max(1, Math.floor(Number(raw.dueWindowDays)))
        : null,
    targetGrade: String(raw.targetGrade || "").trim(),
    targetClass: String(raw.targetClass || "").trim(),
    targetStudentUid: String(raw.targetStudentUid || "").trim(),
    targetStudentUids,
    targetStudentAccessMap: Object.fromEntries(
      targetStudentUids.map((uid) => [uid, true]),
    ),
    targetStudentName: String(raw.targetStudentName || "").trim(),
    targetStudentNames: Array.isArray(raw.targetStudentNames)
      ? raw.targetStudentNames
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : String(raw.targetStudentName || "").trim()
        ? [String(raw.targetStudentName || "").trim()]
        : [],
    targetStudentReasons:
      raw.targetStudentReasons && typeof raw.targetStudentReasons === "object"
        ? Object.fromEntries(
            Object.entries(raw.targetStudentReasons)
              .map(([uid, reason]) => [
                String(uid || "").trim(),
                String(reason || "").trim(),
              ])
              .filter(([uid]) => uid),
          )
        : {},
    targetStudentNumber: String(raw.targetStudentNumber || "").trim(),
    isPublished: raw.isPublished === true,
    publishedAt: raw.publishedAt,
    dueAt: raw.dueAt,
    deletedAt: raw.deletedAt,
    deletedByUid: String(raw.deletedByUid || "").trim(),
    retryResetByStudentUid:
      raw.retryResetByStudentUid && typeof raw.retryResetByStudentUid === "object"
        ? Object.fromEntries(
            Object.entries(raw.retryResetByStudentUid)
              .map(([uid, resetAt]) => [String(uid || "").trim(), resetAt])
              .filter(([uid]) => uid),
          )
        : {},
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
};

export const normalizeHistoryClassroomResult = (
  id: string,
  raw: Partial<HistoryClassroomResult>,
): HistoryClassroomResult => ({
  id,
  assignmentId: String(raw.assignmentId || "").trim(),
  assignmentTitle: String(raw.assignmentTitle || "").trim(),
  uid: String(raw.uid || "").trim(),
  studentName: String(raw.studentName || "").trim(),
  studentGrade: String(raw.studentGrade || "").trim(),
  studentClass: String(raw.studentClass || "").trim(),
  studentNumber: String(raw.studentNumber || "").trim(),
  answers:
    raw.answers && typeof raw.answers === "object"
      ? Object.fromEntries(
          Object.entries(raw.answers).map(([key, value]) => [
            String(key || "").trim(),
            String(value ?? ""),
          ]),
        )
      : {},
  score: Number(raw.score) || 0,
  total: Number(raw.total) || 0,
  percent: Math.min(100, Math.max(0, Number(raw.percent) || 0)),
  passThresholdPercent: Math.min(
    100,
    Math.max(0, Number(raw.passThresholdPercent) || 80),
  ),
  passed: raw.passed === true,
  status:
    raw.status === "cancelled" ||
    raw.status === "passed" ||
    raw.status === "failed"
      ? raw.status
      : raw.passed
        ? "passed"
        : "failed",
  cancellationReason: String(raw.cancellationReason || "").trim(),
  createdAt: raw.createdAt,
});

export const sanitizeHistoryClassroomAssignmentForWrite = (
  raw: Partial<HistoryClassroomAssignment>,
) => {
  const normalizedTargetStudentUids = collectHistoryClassroomTargetStudentUids(
    raw,
  );
  const payload: Record<string, unknown> = {
    title: String(raw.title || "").trim() || "역사교실",
    description: String(raw.description || "").trim(),
    mapResourceId: String(raw.mapResourceId || "").trim(),
    mapTitle: String(raw.mapTitle || "").trim(),
    pdfPageImages: Array.isArray(raw.pdfPageImages)
      ? raw.pdfPageImages
          .map((page) => ({
            page: Math.max(1, Number(page?.page) || 1),
            imageUrl: String(page?.imageUrl || "").trim(),
            width: Math.max(0, Number(page?.width) || 0),
            height: Math.max(0, Number(page?.height) || 0),
          }))
          .filter((page) => page.imageUrl)
      : [],
    pdfRegions: Array.isArray(raw.pdfRegions)
      ? raw.pdfRegions
          .map((region) => ({
            label: String(region?.label || "").trim(),
            page: Math.max(1, Number(region?.page) || 1),
            left: Number(region?.left) || 0,
            top: Number(region?.top) || 0,
            width: Math.max(0, Number(region?.width) || 0),
            height: Math.max(0, Number(region?.height) || 0),
            shortcutEnabled: region?.shortcutEnabled !== false,
            tags: Array.isArray(region?.tags)
              ? region.tags
                  .map((tag) => String(tag || "").trim())
                  .filter(Boolean)
              : [],
          }))
          .filter(
            (region) => region.label && region.width > 0 && region.height > 0,
          )
      : [],
    blanks: Array.isArray(raw.blanks)
      ? raw.blanks.map((blank) => {
          const normalizedBlank: Record<string, unknown> = {
            id: String(blank?.id || "").trim() || `blank-${Date.now()}`,
            page: Math.max(1, Number(blank?.page) || 1),
            left: Number(blank?.left) || 0,
            top: Number(blank?.top) || 0,
            width: Math.max(1, Number(blank?.width) || 1),
            height: Math.max(1, Number(blank?.height) || 1),
            answer: String(blank?.answer || "").trim(),
            prompt: String(blank?.prompt || "").trim(),
          };
          if (blank?.source === "ocr" || blank?.source === "manual") {
            normalizedBlank.source = blank.source;
          }
          return normalizedBlank;
        })
      : [],
    answerOptions: Array.isArray(raw.answerOptions)
      ? raw.answerOptions
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    timeLimitMinutes: Math.max(0, Number(raw.timeLimitMinutes) || 0),
    cooldownMinutes: Math.max(0, Number(raw.cooldownMinutes) || 0),
    passThresholdPercent: Math.min(
      100,
      Math.max(0, Number(raw.passThresholdPercent) || 80),
    ),
    dueWindowDays:
      Number.isFinite(Number(raw.dueWindowDays)) &&
      Number(raw.dueWindowDays) > 0
        ? Math.max(1, Math.floor(Number(raw.dueWindowDays)))
        : null,
    targetGrade: String(raw.targetGrade || "").trim(),
    targetClass: String(raw.targetClass || "").trim(),
    targetStudentUid: String(raw.targetStudentUid || "").trim(),
    targetStudentUids: normalizedTargetStudentUids,
    targetStudentAccessMap: Object.fromEntries(
      normalizedTargetStudentUids.map((uid) => [uid, true]),
    ),
    targetStudentName: String(raw.targetStudentName || "").trim(),
    targetStudentNames: Array.isArray(raw.targetStudentNames)
      ? raw.targetStudentNames
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    targetStudentReasons:
      raw.targetStudentReasons && typeof raw.targetStudentReasons === "object"
        ? Object.fromEntries(
            Object.entries(raw.targetStudentReasons)
              .map(([uid, reason]) => [
                String(uid || "").trim(),
                String(reason || "").trim(),
              ])
              .filter(([uid]) => uid),
          )
        : {},
    targetStudentNumber: String(raw.targetStudentNumber || "").trim(),
    isPublished: raw.isPublished === true,
  };

  if (Object.prototype.hasOwnProperty.call(raw, "publishedAt")) {
    payload.publishedAt = raw.publishedAt ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(raw, "dueAt")) {
    payload.dueAt = raw.dueAt ?? null;
  }
  if (
    raw.retryResetByStudentUid &&
    typeof raw.retryResetByStudentUid === "object"
  ) {
    payload.retryResetByStudentUid = Object.fromEntries(
      Object.entries(raw.retryResetByStudentUid)
        .map(([uid, resetAt]) => [String(uid || "").trim(), resetAt])
        .filter(([uid]) => uid),
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(raw, "createdAt") &&
    raw.createdAt !== undefined
  ) {
    payload.createdAt = raw.createdAt;
  }
  if (
    Object.prototype.hasOwnProperty.call(raw, "updatedAt") &&
    raw.updatedAt !== undefined
  ) {
    payload.updatedAt = raw.updatedAt;
  }

  return payload;
};

export const buildAnswerOptions = (blanks: HistoryClassroomBlank[]) =>
  Array.from(
    new Set(blanks.map((blank) => blank.answer.trim()).filter(Boolean)),
  );

export const normalizeHistoryClassroomAnswer = (value: unknown) => {
  const text = String(value ?? "");
  const normalized =
    typeof text.normalize === "function" ? text.normalize("NFC") : text;
  return normalizeBlankText(normalized).toLocaleLowerCase("ko-KR");
};

export const isHistoryClassroomBlankCorrect = (
  input: unknown,
  expected: unknown,
) =>
  normalizeHistoryClassroomAnswer(input) ===
  normalizeHistoryClassroomAnswer(expected);

export const mergeHistoryClassroomMapSnapshot = (
  assignment: HistoryClassroomAssignment,
  mapResource?: MapResource | null,
): HistoryClassroomAssignment => ({
  ...assignment,
  pdfPageImages: assignment.pdfPageImages?.length
    ? assignment.pdfPageImages
    : mapResource?.pdfPageImages || [],
  pdfRegions: assignment.pdfRegions?.length
    ? assignment.pdfRegions
    : mapResource?.pdfRegions || [],
});

export const getHistoryClassroomAssignedStudentUids = (
  assignment: Pick<
    HistoryClassroomAssignment,
    "targetStudentUid" | "targetStudentUids" | "targetStudentAccessMap"
  >,
) => {
  const normalized = [
    ...assignment.targetStudentUids,
    ...(assignment.targetStudentUid ? [assignment.targetStudentUid] : []),
    ...Object.entries(assignment.targetStudentAccessMap || {})
      .filter(([, value]) => value === true)
      .map(([uid]) => uid),
  ];

  return Array.from(
    new Set(normalized.map((uid) => String(uid || "").trim()).filter(Boolean)),
  );
};

export const isHistoryClassroomAssignedToStudent = (
  assignment: Pick<
    HistoryClassroomAssignment,
    "targetStudentUid" | "targetStudentUids" | "targetStudentAccessMap"
  >,
  uid: string,
) =>
  getHistoryClassroomAssignedStudentUids(assignment).includes(
    String(uid || "").trim(),
  );

export const getHistoryClassroomTimestampMs = (
  value: unknown,
): number | null => {
  if (!value) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object") {
    const timestampLike = value as {
      seconds?: number;
      nanoseconds?: number;
      toDate?: () => Date;
    };
    if (typeof timestampLike.toDate === "function") {
      const date = timestampLike.toDate();
      return date instanceof Date && Number.isFinite(date.getTime())
        ? date.getTime()
        : null;
    }
    if (typeof timestampLike.seconds === "number") {
      return (
        timestampLike.seconds * 1000 +
        Math.floor((Number(timestampLike.nanoseconds) || 0) / 1_000_000)
      );
    }
  }
  return null;
};

export const getHistoryClassroomStudentRetryResetMs = (
  assignment:
    | Pick<HistoryClassroomAssignment, "retryResetByStudentUid">
    | null
    | undefined,
  uid: string,
) => {
  const normalizedUid = String(uid || "").trim();
  if (!assignment || !normalizedUid) return null;
  return getHistoryClassroomTimestampMs(
    assignment.retryResetByStudentUid?.[normalizedUid],
  );
};

export const isHistoryClassroomDeleted = (
  assignment: Pick<HistoryClassroomAssignment, "deletedAt"> | null | undefined,
) => getHistoryClassroomTimestampMs(assignment?.deletedAt) != null;

export const getHistoryClassroomDueAtMs = (
  assignment: Pick<
    HistoryClassroomAssignment,
    "dueAt" | "dueWindowDays" | "publishedAt" | "createdAt" | "updatedAt"
  >,
): number | null => {
  const explicitDueAtMs = getHistoryClassroomTimestampMs(assignment.dueAt);
  if (explicitDueAtMs != null) return explicitDueAtMs;

  const dueWindowDays = Number(assignment.dueWindowDays);
  if (!Number.isFinite(dueWindowDays) || dueWindowDays <= 0) {
    return null;
  }

  const publishedAtMs = getHistoryClassroomPublishedAtMs(assignment);
  if (publishedAtMs == null) return null;

  return publishedAtMs + Math.floor(dueWindowDays) * 24 * 60 * 60 * 1000;
};

export const getHistoryClassroomPublishedAtMs = (
  assignment: Pick<
    HistoryClassroomAssignment,
    "publishedAt" | "createdAt" | "updatedAt"
  >,
): number | null =>
  getHistoryClassroomTimestampMs(assignment.publishedAt) ??
  getHistoryClassroomTimestampMs(assignment.createdAt) ??
  getHistoryClassroomTimestampMs(assignment.updatedAt);

export const getHistoryClassroomRemainingMs = (
  assignment: Pick<
    HistoryClassroomAssignment,
    "dueAt" | "dueWindowDays" | "publishedAt" | "createdAt" | "updatedAt"
  >,
  now = Date.now(),
): number | null => {
  const dueAtMs = getHistoryClassroomDueAtMs(assignment);
  if (!dueAtMs) return null;
  return Math.max(0, dueAtMs - now);
};

export const isHistoryClassroomPastDue = (
  assignment: Pick<
    HistoryClassroomAssignment,
    "dueAt" | "dueWindowDays" | "publishedAt" | "createdAt" | "updatedAt"
  >,
  now = Date.now(),
): boolean => {
  const dueAtMs = getHistoryClassroomDueAtMs(assignment);
  return dueAtMs != null && dueAtMs <= now;
};

export const buildHistoryClassroomDueAtDate = (
  publishedBaseMs: number | null | undefined,
  dueWindowDays: number | null | undefined,
) => {
  if (publishedBaseMs == null || !Number.isFinite(publishedBaseMs)) {
    return null;
  }

  const normalizedDueWindowDays = Number(dueWindowDays);
  if (
    !Number.isFinite(normalizedDueWindowDays) ||
    normalizedDueWindowDays <= 0
  ) {
    return null;
  }

  return new Date(
    publishedBaseMs + Math.floor(normalizedDueWindowDays) * 24 * 60 * 60 * 1000,
  );
};

export const buildHistoryClassroomPublishWindow = ({
  dueWindowDays,
  isPublished,
  previousIsPublished = false,
  previousPublishedAt,
  now = new Date(),
}: {
  dueWindowDays: number | null | undefined;
  isPublished: boolean;
  previousIsPublished?: boolean;
  previousPublishedAt?: unknown;
  now?: Date;
}) => {
  if (!isPublished) {
    return {
      publishedAt: previousIsPublished ? previousPublishedAt : undefined,
      dueAt: undefined,
    };
  }

  const publishedBaseMs = previousIsPublished
    ? getHistoryClassroomTimestampMs(previousPublishedAt)
    : null;
  const publishedAt = publishedBaseMs != null ? new Date(publishedBaseMs) : now;

  return {
    publishedAt,
    dueAt: buildHistoryClassroomDueAtDate(publishedAt.getTime(), dueWindowDays),
  };
};

export const formatHistoryClassroomRemainingWindow = (
  remainingMs: number | null | undefined,
) => {
  if (!remainingMs || remainingMs <= 0) return "마감";

  const totalMinutes = Math.ceil(remainingMs / 60000);
  if (totalMinutes < 60) return `${totalMinutes}분`;

  const totalHours = Math.ceil(totalMinutes / 60);
  if (totalHours < 48) {
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (days > 0) {
      return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
    }
    return `${totalHours}시간`;
  }

  return `${Math.ceil(totalHours / 24)}일`;
};

const getExpandedTextRegions = (
  pageRegions: LessonWorksheetTextRegion[],
  pageImage: LessonWorksheetPageImage,
) =>
  pageRegions.flatMap((region) => {
    const tokens = splitTextRegionIntoTokens(region, pageImage);
    return tokens.length ? tokens : [region];
  });

const expandRenderRect = (
  rect: {
    leftRatio: number;
    topRatio: number;
    widthRatio: number;
    heightRatio: number;
  },
  pageImage: LessonWorksheetPageImage,
  options?: {
    padX?: number;
    padY?: number;
    minWidth?: number;
    minHeight?: number;
  },
) => {
  const padX = options?.padX ?? 8;
  const padY = options?.padY ?? 5;
  const minWidth = options?.minWidth ?? 44;
  const minHeight = options?.minHeight ?? 20;
  const left = Math.max(0, rect.leftRatio * pageImage.width - padX);
  const top = Math.max(0, rect.topRatio * pageImage.height - padY);
  const right = Math.min(
    pageImage.width,
    (rect.leftRatio + rect.widthRatio) * pageImage.width + padX,
  );
  const bottom = Math.min(
    pageImage.height,
    (rect.topRatio + rect.heightRatio) * pageImage.height + padY,
  );
  const width = Math.max(minWidth, right - left);
  const height = Math.max(minHeight, bottom - top);

  return {
    leftRatio: clampRatio(left / pageImage.width),
    topRatio: clampRatio(top / pageImage.height),
    widthRatio: Math.min(1 - left / pageImage.width, width / pageImage.width),
    heightRatio: Math.min(
      1 - top / pageImage.height,
      height / pageImage.height,
    ),
  };
};

export const inferHistoryClassroomBlankSource = (
  blank: HistoryClassroomBlank,
  pageImage?: LessonWorksheetPageImage | null,
  pageRegions: LessonWorksheetTextRegion[] = [],
): HistoryClassroomBlankSource => {
  if (blank.source === "ocr" || blank.source === "manual") {
    return blank.source;
  }
  if (!pageImage || pageRegions.length === 0) {
    return "manual";
  }

  const blankCenterX = blank.left + blank.width / 2;
  const blankCenterY = blank.top + blank.height / 2;
  const normalizedAnswer = normalizeBlankText(blank.answer);
  if (!normalizedAnswer) return "manual";

  const expandedRegions = getExpandedTextRegions(pageRegions, pageImage);
  const matchedRegion = expandedRegions.some((region) => {
    if (normalizeBlankText(region.label) !== normalizedAnswer) return false;
    const bounds = getTightTextRegionBounds(region, pageImage);
    if (!bounds) return false;
    const regionCenterX = bounds.left + bounds.width / 2;
    const regionCenterY = bounds.top + bounds.height / 2;
    const distance = Math.hypot(
      regionCenterX - blankCenterX,
      regionCenterY - blankCenterY,
    );
    return distance <= Math.max(blank.width, bounds.width) * 1.35;
  });

  return matchedRegion ? "ocr" : "manual";
};

export const getHistoryClassroomBlankRenderRect = (
  blank: HistoryClassroomBlank,
  pageImage: LessonWorksheetPageImage,
  pageRegions: LessonWorksheetTextRegion[] = [],
) => {
  const blankSource = inferHistoryClassroomBlankSource(
    blank,
    pageImage,
    pageRegions,
  );
  const baseRect = {
    leftRatio: clampRatio(blank.left / pageImage.width),
    topRatio: clampRatio(blank.top / pageImage.height),
    widthRatio: clampRatio(blank.width / pageImage.width),
    heightRatio: clampRatio(blank.height / pageImage.height),
  };

  if (blankSource === "manual" || pageRegions.length === 0) {
    const pixelWidth = Math.max(1, baseRect.widthRatio * pageImage.width);
    const pixelHeight = Math.max(1, baseRect.heightRatio * pageImage.height);
    return expandRenderRect(baseRect, pageImage, {
      padX: pixelWidth < 34 ? 3 : 4,
      padY: pixelHeight < 18 ? 2 : 3,
      minWidth: Math.max(38, Math.min(pixelWidth + 14, 96)),
      minHeight: Math.max(20, Math.min(pixelHeight + 10, 40)),
    });
  }

  const blankCenterX = blank.left + blank.width / 2;
  const blankCenterY = blank.top + blank.height / 2;
  const normalizedAnswer = normalizeBlankText(blank.answer);
  const expandedRegions = getExpandedTextRegions(pageRegions, pageImage);
  const nearestBounds = expandedRegions
    .filter((region) => normalizeBlankText(region.label) === normalizedAnswer)
    .map((region) => {
      const bounds = getTightTextRegionBounds(region, pageImage);
      if (!bounds) return null;
      const regionCenterX = bounds.left + bounds.width / 2;
      const regionCenterY = bounds.top + bounds.height / 2;
      return {
        bounds,
        distance: Math.hypot(
          regionCenterX - blankCenterX,
          regionCenterY - blankCenterY,
        ),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => a.distance - b.distance)[0];

  const resolvedRect = nearestBounds
    ? {
        leftRatio: nearestBounds.bounds.leftRatio,
        topRatio: nearestBounds.bounds.topRatio,
        widthRatio: nearestBounds.bounds.widthRatio,
        heightRatio: nearestBounds.bounds.heightRatio,
      }
    : baseRect;
  const pixelWidth = Math.max(1, resolvedRect.widthRatio * pageImage.width);
  const pixelHeight = Math.max(1, resolvedRect.heightRatio * pageImage.height);

  return expandRenderRect(resolvedRect, pageImage, {
    padX: pixelWidth < 40 ? 4 : 5,
    padY: pixelHeight < 20 ? 2.5 : 3.5,
    minWidth: Math.max(40, Math.min(pixelWidth + 18, 104)),
    minHeight: Math.max(22, Math.min(pixelHeight + 10, 42)),
  });
};
