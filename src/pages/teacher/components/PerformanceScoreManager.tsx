import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  collection,
  collectionGroup,
  deleteField,
  doc,
  type DocumentData,
  type DocumentReference,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type WithFieldValue,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  InlineLoading,
  LoadingOverlay,
} from "../../../components/common/LoadingState";
import { useAppDialog } from "../../../components/common/AppDialogProvider";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import {
  getSemesterCollectionPath,
  getYearSemester,
} from "../../../lib/semesterScope";
import {
  PERFORMANCE_SCORE_ROSTERS_COLLECTION,
  PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION,
  DEFAULT_PERFORMANCE_SCORE_WARNING_TEXT,
  PERFORMANCE_SCORE_OBJECTIONS_COLLECTION,
  PERFORMANCE_SCORE_WARNING_MAX_LENGTH,
  PERFORMANCE_SCORE_USER_COLLECTION,
  applyPerformanceScoreConfirmation,
  buildStudentLookupKey,
  buildStudentNameLookupKey,
  formatPerformanceScore,
  getPerformanceScorePercent,
  loadPerformanceScoreSettings,
  loadPerformanceScoreConfirmation,
  normalizePerformanceScoreSettings,
  normalizePerformanceScoreWarningText,
  normalizeSchoolValue,
  normalizeStudentName,
  roundScore,
  savePerformanceScoreSettings,
  sortPerformanceScoreRecords,
  type PerformanceScoreSettings,
  type PerformanceScoreRecord,
  type PerformanceScoreRoster,
  type PerformanceScoreRosterRow,
} from "../../../lib/performanceScores";
import {
  parsePerformanceScoreWorkbook,
  type ParsedPerformanceScoreRow,
  type ParsedPerformanceScoreUpload,
} from "../../../lib/performanceScoreWorkbook";
import {
  createManagedNotifications,
  reviewPerformanceScoreObjection,
} from "../../../lib/notifications";

interface StudentProfile {
  uid: string;
  name: string;
  grade: string;
  class: string;
  number: string;
  email: string;
}

type ParsedScoreRow = ParsedPerformanceScoreRow;
type ParsedUpload = ParsedPerformanceScoreUpload;

type AssessmentPresetKey = "auto" | "first" | "second";
type UploadAssessmentPresetKey = Exclude<AssessmentPresetKey, "auto">;
type PreviewPageItem = number | { key: string; label: string };

const DEFAULT_GRADE_OPTIONS = ["1", "2", "3"];
const DEFAULT_CLASS_OPTIONS = Array.from({ length: 12 }, (_, index) =>
  String(index + 1),
);
const PREVIEW_PAGE_SIZE = 20;
const FIRESTORE_BATCH_WRITE_LIMIT = 450;
const CLASS_SHEET_TEMPLATE_PATH =
  "templates/performance-score-class-sheet-template.xlsx";
const CLASS_SHEET_STUDENT_START_ROW = 7;
const CLASS_SHEET_STUDENT_END_ROW = 38;
const CLASS_SHEET_SUMMARY_START_ROW = 39;
const CLASS_SHEET_TEMPLATE_COLUMN_COUNT = 13;
const CLASS_SHEET_STUDENT_NAME_COLUMN = 4;
const CLASS_SHEET_STUDENT_NAME_COLUMN_WIDTH = 6.88;
const CLASS_SHEET_STUDENT_NAME_COLUMN_FALLBACK_WIDTH =
  CLASS_SHEET_STUDENT_NAME_COLUMN_WIDTH;
const CLASS_SHEET_STUDENT_NAME_COLUMN_MAX_FIT_WIDTH = 13;
const CLASS_SHEET_STUDENT_NAME_HEADER_ROW = CLASS_SHEET_STUDENT_START_ROW - 1;
const CLASS_SHEET_INTERNAL_HORIZONTAL_START_ROW = 7;
const CLASS_SHEET_INTERNAL_HORIZONTAL_START_COLUMN = 2;
const CLASS_SHEET_INTERNAL_HORIZONTAL_END_COLUMN =
  CLASS_SHEET_TEMPLATE_COLUMN_COUNT;
const CLASS_SHEET_INTERNAL_VERTICAL_START_ROW = 6;
const CLASS_SHEET_INTERNAL_VERTICAL_LEFT_COLUMN = 6;
const CLASS_SHEET_INTERNAL_VERTICAL_RIGHT_COLUMN = 7;
const CLASS_SHEET_RIGHT_SPACER_COLUMNS = [
  { column: 16, minWidth: 8 },
  { column: 15, minWidth: 12 },
  { column: 14, minWidth: 1 },
];
const CLASS_SHEET_SIGNATURE_START_COLUMN_INDEX = 10;
const CLASS_SHEET_SIGNATURE_END_COLUMN_INDEX = 13;
const CLASS_SHEET_SIGNATURE_VERTICAL_PADDING = 0;
const CLASS_SHEET_SIGNATURE_IMAGE_MAX_WIDTH = 64;
const CLASS_SHEET_SIGNATURE_IMAGE_MAX_HEIGHT = 18;
const CLASS_SHEET_SIGNATURE_CELL_HORIZONTAL_PADDING = 8;
const CLASS_SHEET_SIGNATURE_CANVAS_SCALE = 2;
const CLASS_SHEET_SIGNATURE_ALPHA_THRESHOLD = 8;
const CLASS_SHEET_SIGNATURE_COLUMN_PIXEL_WIDTH = 64;
const CLASS_SHEET_SIGNATURE_ROW_PIXEL_HEIGHT = 19;
const CLASS_SHEET_FOOTER_PAGE_FIRST_START_COLUMN = 9;
const CLASS_SHEET_FOOTER_PAGE_FIRST_END_COLUMN = 10;
const CLASS_SHEET_FOOTER_PAGE_SLASH_START_COLUMN = 11;
const CLASS_SHEET_FOOTER_PAGE_SLASH_END_COLUMN = 12;
const CLASS_SHEET_FOOTER_PAGE_LAST_START_COLUMN = 13;
const CLASS_SHEET_FOOTER_PAGE_LAST_END_COLUMN = 14;
const CLASS_SHEET_FOOTER_SCHOOL_START_COLUMN = 15;
const CLASS_SHEET_FOOTER_SCHOOL_END_COLUMN = 16;
const CLASS_SHEET_PRINT_INFO_START_COLUMN = 8;
const CLASS_SHEET_PRINT_INFO_END_COLUMN = 16;
const CLASS_SHEET_PRINT_INFO_MIN_ROW = 45;
const CLASS_SHEET_PRINT_INFO_SPACER_ROW_HEIGHT = 6;
const CLASS_SHEET_PRINT_INFO_ROW_HEIGHT = 9;
const CLASS_SHEET_PRINT_INFO_FONT_SIZE = 7;
const CLASS_SHEET_PRINT_INFO_FONT_NAME = "바탕";
const CLASS_SHEET_PRINT_INFO_TRAILING_SPACES = "      ";
const CLASS_SHEET_SCHOOL_NAME = "용신중학교";
const CLASS_SHEET_PRINT_INFO_FIXED_IP = "10.182.***.93";
const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SCORE_LIST_ALL_ROSTERS_VALUE = "__all_performance_scores__";
const SCORE_LIST_FIRST_SUMMARY_LABEL = "고조선 8조법 4컷 만화 그리기";
const SCORE_LIST_SECOND_SUMMARY_LABEL = "삼국 시대 인물의 무덤에 평점 남기기";

const ASSESSMENT_PRESETS: Record<
  UploadAssessmentPresetKey,
  { title: string; subject: string; assessmentOrder: number }
> = {
  first: {
    title: "고조선 8조법 4컷 만화 그리기",
    subject: "역사",
    assessmentOrder: 1,
  },
  second: {
    title: "삼국 시대 인물의 무덤에 평점 남기기",
    subject: "역사",
    assessmentOrder: 2,
  },
};

const UPLOAD_ASSESSMENT_OPTIONS: Array<{
  key: UploadAssessmentPresetKey;
  label: string;
  description: string;
}> = [
  {
    key: "first",
    label: "1차 수행: 고조선 8조법 4컷 만화",
    description: "20점 만점, 법 조항 서사와 당대 생활상 중심",
  },
  {
    key: "second",
    label: "2차 수행: 삼국 시대 인물의 무덤 평점",
    description: "30점 만점, 업적·과오와 평점 근거 중심",
  },
];

const toText = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const getDefaultAssessmentPreset = (
  upload: ParsedUpload,
): AssessmentPresetKey => {
  if (upload.assessmentOrder === 1) return "first";
  if (upload.assessmentOrder === 2) return "second";
  return "auto";
};

const getAssessmentConfig = (
  upload: ParsedUpload,
  preset: AssessmentPresetKey,
) => {
  if (preset !== "auto") return ASSESSMENT_PRESETS[preset];
  return {
    title: upload.title,
    subject: upload.subject,
    assessmentOrder: upload.assessmentOrder,
  };
};

const getRosterTimestampSeconds = (value: unknown) => {
  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    return (value as { seconds: number }).seconds;
  }
  return 0;
};

const getRosterAssessmentOrder = (roster: PerformanceScoreRoster) => {
  const order = Number(roster.assessmentOrder || 0);
  if (Number.isFinite(order) && order > 0) return order;

  const text = `${roster.title || ""} ${roster.sourceFileName || ""}`;
  if (text.includes("고조선") || text.includes("8조법")) return 1;
  if (text.includes("삼국") || text.includes("무덤")) return 2;
  return 999;
};

const sortPerformanceScoreRosters = (items: PerformanceScoreRoster[]) =>
  [...items].sort(
    (a, b) =>
      getRosterAssessmentOrder(a) - getRosterAssessmentOrder(b) ||
      String(a.title || "").localeCompare(String(b.title || ""), "ko") ||
      getRosterTimestampSeconds(b.createdAt) -
        getRosterTimestampSeconds(a.createdAt),
  );

const normalizePerformanceScoreRoster = (
  id: string,
  data: Omit<PerformanceScoreRoster, "id">,
): PerformanceScoreRoster => ({
  id,
  ...data,
  rows: Array.isArray(data.rows) ? data.rows : [],
  classes: Array.isArray(data.classes) ? data.classes : [],
  items: Array.isArray(data.items) ? data.items : [],
});

const getItemLabel = (item: { name: string; shortName?: string }) =>
  item.shortName || item.name;

const getPreviewPageItems = (
  currentPage: number,
  totalPages: number,
): PreviewPageItem[] => {
  if (totalPages <= 15) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const visiblePages = new Set<number>([1, totalPages]);
  for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
    if (page > 1 && page < totalPages) {
      visiblePages.add(page);
    }
  }

  const sortedPages = Array.from(visiblePages).sort((a, b) => a - b);
  return sortedPages.flatMap((page, index) => {
    const previousPage = sortedPages[index - 1];
    if (index > 0 && page - previousPage > 1) {
      return [{ key: `gap-${previousPage}-${page}`, label: "..." }, page];
    }
    return [page];
  });
};

const getRowDisplayName = (row: ParsedScoreRow) =>
  `${row.class || "-"}반 ${row.number || "-"}번 ${row.studentName || "(이름 없음)"}`;

const formatRowsForConfirm = (rows: ParsedScoreRow[], limit = 80) => {
  const listedRows = rows.slice(0, limit);
  const names = listedRows
    .map((row, index) => `${index + 1}. ${getRowDisplayName(row)}`)
    .join("\n");
  const remaining = rows.length - listedRows.length;
  return remaining > 0 ? `${names}\n... 외 ${remaining}명` : names;
};

const getFirestoreWriteErrorMessage = (error: unknown) => {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  const message =
    error instanceof Error && error.message ? ` (${error.message})` : "";

  if (code === "permission-denied") {
    return `Firestore 권한이 거부되었습니다. 운영 Firestore rules 배포 상태를 확인해 주세요.${message}`;
  }
  if (code === "unavailable" || code === "deadline-exceeded") {
    return `Firestore 연결이 불안정합니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.${message}`;
  }
  if (code) {
    return `Firestore 저장 오류가 발생했습니다: ${code}${message}`;
  }
  return `권한, 네트워크 상태, Firestore rules 배포 상태를 확인한 뒤 다시 시도해 주세요.${message}`;
};

const getObjectionReviewErrorMessage = (error: unknown) => {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  if (code === "functions/failed-precondition") {
    return "이미 처리된 이의이거나, 입력한 변경 후 총점이 아직 학생 점수표에 저장된 총점과 일치하지 않습니다. 점수표를 먼저 수정·저장한 뒤 이의 목록을 새로고침해 다시 처리해 주세요.";
  }
  if (code === "functions/permission-denied") {
    return "수행평가 이의 처리 권한이 없습니다. 교사 계정과 권한 설정을 확인해 주세요.";
  }
  if (
    code === "functions/unavailable" ||
    code === "functions/deadline-exceeded"
  ) {
    return "서버 연결이 불안정합니다. 잠시 후 다시 시도해 주세요.";
  }
  return "권한, 네트워크 상태, 저장된 점수표 상태를 확인한 뒤 다시 시도해 주세요.";
};

const createBatchQueue = () => {
  const batches: Array<ReturnType<typeof writeBatch>> = [];
  let activeBatch = writeBatch(db);
  let activeWriteCount = 0;

  const rotateIfFull = () => {
    if (activeWriteCount < FIRESTORE_BATCH_WRITE_LIMIT) return;
    batches.push(activeBatch);
    activeBatch = writeBatch(db);
    activeWriteCount = 0;
  };

  const queueWrite = () => {
    activeWriteCount += 1;
  };

  return {
    set(
      ref: DocumentReference<DocumentData>,
      data: WithFieldValue<DocumentData>,
    ) {
      rotateIfFull();
      activeBatch.set(ref, data);
      queueWrite();
    },
    delete(ref: DocumentReference<DocumentData>) {
      rotateIfFull();
      activeBatch.delete(ref);
      queueWrite();
    },
    update(
      ref: DocumentReference<DocumentData>,
      data: WithFieldValue<DocumentData>,
    ) {
      rotateIfFull();
      activeBatch.update(ref, data);
      queueWrite();
    },
    async commit() {
      if (activeWriteCount > 0) {
        batches.push(activeBatch);
      }
      for (const batch of batches) {
        await batch.commit();
      }
    },
  };
};

const readWorkbookRows = async (file: File) => {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const workbookRows = (await readXlsxFile(file)) as unknown;
  return Array.isArray(workbookRows) &&
    workbookRows.length === 1 &&
    typeof workbookRows[0] === "object" &&
    workbookRows[0] !== null &&
    Array.isArray((workbookRows[0] as { data?: unknown }).data)
    ? ((workbookRows[0] as { data: unknown[][] }).data as unknown[][])
    : (workbookRows as unknown[][]);
};

const normalizeStudentProfile = (
  id: string,
  data: Record<string, unknown>,
) => ({
  uid: id,
  name: toText(data.studentName || data.name || data.displayName || ""),
  grade: normalizeSchoolValue(data.studentGrade || data.grade || ""),
  class: normalizeSchoolValue(data.studentClass || data.class || ""),
  number: normalizeSchoolValue(data.studentNumber || data.number || ""),
  email: toText(data.email),
});

interface StudentMatchIndexes {
  byNumber: Map<string, StudentProfile[]>;
  byName: Map<string, StudentProfile[]>;
}

const buildStudentMatchIndexes = (
  students: StudentProfile[],
): StudentMatchIndexes => {
  const byNumber = new Map<string, StudentProfile[]>();
  const byName = new Map<string, StudentProfile[]>();

  students.forEach((student) => {
    const numberKey = buildStudentLookupKey(
      student.grade,
      student.class,
      student.number,
    );
    if (student.grade && student.class && student.number) {
      byNumber.set(numberKey, [...(byNumber.get(numberKey) || []), student]);
    }

    const nameKey = buildStudentNameLookupKey(
      student.grade,
      student.class,
      student.name,
    );
    if (student.grade && student.class && student.name) {
      byName.set(nameKey, [...(byName.get(nameKey) || []), student]);
    }
  });

  return { byNumber, byName };
};

const getUniqueStudentMatch = (
  values: StudentProfile[] | undefined,
): StudentProfile | null => (values && values.length === 1 ? values[0] : null);

const matchRowsToStudents = (
  rows: ParsedScoreRow[],
  students: StudentProfile[],
): ParsedScoreRow[] => {
  const { byNumber, byName } = buildStudentMatchIndexes(students);

  return rows.map((row) => {
    const numberMatch = getUniqueStudentMatch(
      byNumber.get(buildStudentLookupKey(row.grade, row.class, row.number)),
    );
    if (numberMatch) {
      const sameName =
        !row.studentName ||
        normalizeStudentName(row.studentName) ===
          normalizeStudentName(numberMatch.name);
      return {
        ...row,
        uid: numberMatch.uid,
        studentName: row.studentName || numberMatch.name,
        matchStatus: sameName ? "matched" : "name-mismatch",
        matchMessage: sameName
          ? "학년, 반, 번호, 이름이 일치합니다."
          : `번호로 연결했습니다. 등록 명단 이름은 ${numberMatch.name || "이름 없음"}입니다.`,
      };
    }

    const nameMatch = getUniqueStudentMatch(
      byName.get(
        buildStudentNameLookupKey(row.grade, row.class, row.studentName),
      ),
    );
    if (nameMatch) {
      return {
        ...row,
        uid: nameMatch.uid,
        number: row.number || nameMatch.number,
        matchStatus: "name-mismatch",
        matchMessage: `이름으로 연결했습니다. 등록 명단 번호는 ${nameMatch.number || "-"}번입니다.`,
      };
    }

    return {
      ...row,
      uid: "",
      matchStatus: "unmatched",
      matchMessage: "학생 명단에서 같은 학년, 반, 번호를 찾지 못했습니다.",
    };
  });
};

const getRosterRowStudentRepair = (
  row: PerformanceScoreRosterRow,
  indexes: StudentMatchIndexes,
) => {
  if (!rosterRowHasScore(row)) return row;

  const numberMatch = getUniqueStudentMatch(
    indexes.byNumber.get(
      buildStudentLookupKey(row.grade, row.class, row.number),
    ),
  );
  if (numberMatch) {
    const sameName =
      !row.studentName ||
      normalizeStudentName(row.studentName) ===
        normalizeStudentName(numberMatch.name);
    if (sameName && !row.uid) {
      return {
        ...row,
        uid: numberMatch.uid,
        studentName: row.studentName || numberMatch.name,
        matchStatus: "matched" as const,
        matchMessage: "학생 명단과 연결된 점수입니다.",
      };
    }
  }

  const nameMatch = getUniqueStudentMatch(
    indexes.byName.get(
      buildStudentNameLookupKey(row.grade, row.class, row.studentName),
    ),
  );
  if (nameMatch && !row.uid && !row.number && !isManualRosterRow(row)) {
    return {
      ...row,
      uid: nameMatch.uid,
      number: nameMatch.number,
      matchStatus: "name-mismatch" as const,
      matchMessage: `이름으로 연결했습니다. 학생 명단 번호는 ${nameMatch.number || "-"}번입니다.`,
    };
  }

  return row;
};

const repairRosterRowsWithStudentProfiles = (
  rows: PerformanceScoreRosterRow[],
  students: StudentProfile[],
) => {
  if (!rows.length || !students.length) return { rows, changed: false };
  const indexes = buildStudentMatchIndexes(students);
  let changed = false;
  const repairedRows = rows.map((row) => {
    const repaired = getRosterRowStudentRepair(row, indexes);
    const rowChanged =
      repaired.uid !== row.uid ||
      repaired.number !== row.number ||
      repaired.studentName !== row.studentName ||
      repaired.matchStatus !== row.matchStatus ||
      repaired.matchMessage !== row.matchMessage;
    if (rowChanged) changed = true;
    return repaired;
  });
  return { rows: changed ? repairedRows : rows, changed };
};

const getMatchBadgeClass = (
  status: PerformanceScoreRosterRow["matchStatus"],
) => {
  if (status === "matched") return "bg-emerald-50 text-emerald-700";
  if (status === "name-mismatch") return "bg-amber-50 text-amber-700";
  return "bg-rose-50 text-rose-700";
};

const getMatchLabel = (status: PerformanceScoreRosterRow["matchStatus"]) => {
  if (status === "matched") return "연결";
  if (status === "name-mismatch") return "확인";
  return "미연결";
};

interface ClassSheetStudent {
  uid: string;
  grade: string;
  class: string;
  number: string;
  studentName: string;
  firstRecord?: PerformanceScoreRecord;
  secondRecord?: PerformanceScoreRecord;
}

type SortDirection = "asc" | "desc";
type ScoreListSortKey =
  | "grade"
  | "class"
  | "number"
  | "studentName"
  | "totalScore"
  | `item-${number}`;
type ClassStatsSortKey =
  | "class"
  | "count"
  | "average"
  | "max"
  | "min"
  | "difference"
  | "percent";
type ScoreStatsMode = "all" | "first" | "second";

interface SortState<TKey extends string> {
  key: TKey;
  direction: SortDirection;
}

interface ScoreSummary {
  count: number;
  total: number;
  average: number | null;
  min: number | null;
  max: number | null;
  maxScore: number;
  percent: number | null;
}

interface ClassScoreSummary extends ScoreSummary {
  classValue: string;
  difference: number | null;
}

interface AssessmentContributionSummary {
  classValue: string;
  first: ScoreSummary;
  second: ScoreSummary;
  firstAverage: number | null;
  secondAverage: number | null;
  combinedAverage: number | null;
  combinedCount: number;
}

interface ItemScoreSummary {
  index: number;
  label: string;
  name: string;
  maxScore: number;
  overall: ScoreSummary;
  selected: ScoreSummary;
  difference: number | null;
}

interface NormalCurveSummary {
  count: number;
  mean: number | null;
  standardDeviation: number | null;
  points: Array<{ x: number; y: number }>;
}

type ScoreListRecordSource = "student-doc" | "roster-row";

type ScoreListRecord = PerformanceScoreRecord & {
  scoreSource?: ScoreListRecordSource;
  scoreDocumentExists?: boolean;
  enteredScoreCount?: number;
  localKey?: string;
  rosterRowNumber?: number;
  isManual?: boolean;
  academicStatus?: string;
  isTransferred?: boolean;
  transferStatus?: "transferred";
};

type TransferScoreMeta = {
  academicStatus?: string;
  isTransferred?: boolean;
  transferStatus?: string;
};

const TRANSFERRED_LABEL = "전출";
const MANUAL_SCORE_ROW_MESSAGE = "수동 추가 학생입니다.";
const ACADEMIC_STATUS_OPTIONS = [
  "재입학",
  "편입학",
  "전입학",
  TRANSFERRED_LABEL,
  "면제",
  "유예",
  "취학",
  "재취학",
  "명예졸업",
  "장기결석에 따른 정원 외 학적관리",
];

type PerformanceScoreObjectionStatus = "pending" | "accepted" | "rejected";
type PerformanceScoreObjectionReviewAction = Extract<
  PerformanceScoreObjectionStatus,
  "accepted" | "rejected"
>;

interface PerformanceScoreObjectionItem {
  name: string;
  shortName?: string;
  score: number | null;
  maxScore: number | null;
  scoreEntered?: boolean;
}

interface PerformanceScoreObjection {
  id: string;
  uid: string;
  studentName: string;
  grade: string;
  class: string;
  number: string;
  scoreId: string;
  rosterId: string;
  scoreTitle: string;
  subject: string;
  assessmentOrder?: number | null;
  totalScore: number | null;
  totalMaxScore: number | null;
  scoreLabel: string;
  items: PerformanceScoreObjectionItem[];
  reason: string;
  status: PerformanceScoreObjectionStatus;
  requestedAt?: unknown;
  reviewedAt?: unknown;
  reviewedByName?: string;
  reviewMemo?: string;
  changedTotalScore?: number | null;
  changedScoreLabel?: string;
}

const SCORE_DISTRIBUTION_BUCKETS = [
  { label: "60% 미만", min: 0, max: 60 },
  { label: "60~69%", min: 60, max: 70 },
  { label: "70~79%", min: 70, max: 80 },
  { label: "80~89%", min: 80, max: 90 },
  { label: "90% 이상", min: 90, max: 101 },
];

const getFiniteNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const sanitizeScoreIntegerInput = (value: string) => {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return "";
  const integerPart = normalized.split(".")[0] ?? "";
  const digits = integerPart.replace(/\D/g, "");
  return digits.replace(/^0+(?=\d)/, "");
};

const parseScoreIntegerInput = (value: string) => {
  const normalized = sanitizeScoreIntegerInput(value);
  if (!normalized) return null;
  const score = Number(normalized);
  return Number.isFinite(score) ? score : null;
};

const toScoreEditInteger = (value: unknown) => {
  const score = getFiniteNumber(value);
  if (score === null || score < 0) return null;
  return Math.trunc(score);
};

const formatScoreDistributionBucketLabel = (
  bucket: (typeof SCORE_DISTRIBUTION_BUCKETS)[number],
  maxScore: number,
) => {
  if (maxScore <= 0) return bucket.label;
  const lower = roundScore((maxScore * bucket.min) / 100);
  const upper = roundScore((maxScore * bucket.max) / 100);
  if (bucket.min <= 0) {
    return `${formatPerformanceScore(upper)}점 미만`;
  }
  if (bucket.max >= 101) {
    return `${formatPerformanceScore(lower)}점 이상`;
  }
  return `${formatPerformanceScore(lower)}~${formatPerformanceScore(upper)}점 미만`;
};

const normalizeAcademicStatus = (value: unknown) => {
  const status = toText(value).slice(0, 80);
  if (!status || status === "-") return "";
  if (status === "transferred") return TRANSFERRED_LABEL;
  return status;
};

const getAcademicStatusLabel = (
  source?: (TransferScoreMeta & { academicStatus?: unknown }) | null,
) => {
  if (!source) return "";
  const status = normalizeAcademicStatus(source.academicStatus);
  if (status) return status;
  return source.isTransferred || source.transferStatus === "transferred"
    ? TRANSFERRED_LABEL
    : "";
};

const getAcademicStatusRecordMeta = (status: string) => {
  const academicStatus = normalizeAcademicStatus(status);
  if (!academicStatus) return {};
  return {
    academicStatus,
    ...(academicStatus === TRANSFERRED_LABEL
      ? {
          isTransferred: true,
          transferStatus: "transferred" as const,
        }
      : {}),
  };
};

const isTransferredScoreRecord = (
  record?: (PerformanceScoreRecord & TransferScoreMeta) | null,
) => Boolean(getAcademicStatusLabel(record));

const isTransferredRosterRow = (
  row?: (PerformanceScoreRosterRow & TransferScoreMeta) | null,
) => Boolean(getAcademicStatusLabel(row));

const getTimestampMillis = (value: unknown) => {
  if (!value) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    return (value as { seconds: number }).seconds * 1000;
  }
  if (value instanceof Date) return value.getTime();
  return 0;
};

const formatObjectionTime = (value: unknown) => {
  const millis = getTimestampMillis(value);
  if (!millis) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(millis));
};

const getSignatureSubmittedAtValue = (record?: PerformanceScoreRecord | null) =>
  record?.confirmation?.confirmedAt || record?.signedAt || null;

const formatClassSheetSignatureSubmittedAt = (value: unknown) => {
  const millis = getTimestampMillis(value);
  if (!millis) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(millis));
};

const normalizeObjectionStatus = (
  value: unknown,
): PerformanceScoreObjectionStatus => {
  const status = String(value || "").trim();
  if (status === "accepted" || status === "rejected") return status;
  return "pending";
};

const getObjectionStatusMeta = (status: PerformanceScoreObjectionStatus) => {
  if (status === "accepted") {
    return {
      label: "수용",
      badgeClass: "bg-emerald-50 text-emerald-700",
      rowClass: "bg-white",
    };
  }
  if (status === "rejected") {
    return {
      label: "반려",
      badgeClass: "bg-rose-50 text-rose-700",
      rowClass: "bg-white",
    };
  }
  return {
    label: "대기",
    badgeClass: "bg-amber-50 text-amber-700",
    rowClass: "bg-amber-50/20",
  };
};

const normalizeObjectionItems = (
  items: unknown,
): PerformanceScoreObjectionItem[] =>
  (Array.isArray(items) ? items : []).map((item, index) => {
    const source = (item || {}) as Record<string, unknown>;
    return {
      name: toText(source.name) || `평가요소 ${index + 1}`,
      shortName: toText(source.shortName),
      score: getFiniteNumber(source.score),
      maxScore: getFiniteNumber(source.maxScore),
      scoreEntered: source.scoreEntered === false ? false : true,
    };
  });

const getObjectionScoreLabel = (
  score: number | null,
  maxScore: number | null,
) => {
  if (score === null && maxScore === null) return "-";
  if (maxScore === null || maxScore <= 0) {
    return `${formatPerformanceScore(score || 0)}점`;
  }
  return `${formatPerformanceScore(score || 0)} / ${formatPerformanceScore(maxScore)}점`;
};

const normalizePerformanceScoreObjection = (
  id: string,
  data: Record<string, unknown>,
): PerformanceScoreObjection => {
  const totalScore = getFiniteNumber(data.totalScore);
  const totalMaxScore = getFiniteNumber(data.totalMaxScore);
  return {
    id,
    uid: toText(data.uid),
    studentName: toText(data.studentName) || "학생",
    grade: normalizeSchoolValue(data.grade),
    class: normalizeSchoolValue(data.class),
    number: normalizeSchoolValue(data.number),
    scoreId: toText(data.scoreId),
    rosterId: toText(data.rosterId),
    scoreTitle: toText(data.scoreTitle) || "수행평가",
    subject: toText(data.subject),
    assessmentOrder: getFiniteNumber(data.assessmentOrder),
    totalScore,
    totalMaxScore,
    scoreLabel:
      toText(data.scoreLabel) ||
      getObjectionScoreLabel(totalScore, totalMaxScore),
    items: normalizeObjectionItems(data.items),
    reason: toText(data.reason),
    status: normalizeObjectionStatus(data.status),
    requestedAt: data.requestedAt,
    reviewedAt: data.reviewedAt,
    reviewedByName: toText(data.reviewedByName),
    reviewMemo: toText(data.reviewMemo),
    changedTotalScore: getFiniteNumber(data.changedTotalScore),
    changedScoreLabel: toText(data.changedScoreLabel),
  };
};

const sortPerformanceScoreObjections = (
  objections: PerformanceScoreObjection[],
) =>
  [...objections].sort(
    (a, b) =>
      (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) ||
      getTimestampMillis(b.requestedAt) - getTimestampMillis(a.requestedAt) ||
      Number(a.grade) - Number(b.grade) ||
      Number(a.class) - Number(b.class) ||
      Number(a.number) - Number(b.number) ||
      a.studentName.localeCompare(b.studentName, "ko"),
  );

const getEnteredItemScore = (
  item?: PerformanceScoreRecord["items"][number],
) => {
  if (!item || item.scoreEntered === false) return null;
  const score = getFiniteNumber(item.score);
  return score === null ? null : roundScore(score);
};

const getEnteredTotalScore = (record: PerformanceScoreRecord) => {
  const items = Array.isArray(record.items) ? record.items : [];
  const enteredItemScores = items
    .map((item) => getEnteredItemScore(item))
    .filter((score): score is number => score !== null);

  if (items.length > 0 && enteredItemScores.length === 0) return null;

  const totalScore = getFiniteNumber(record.totalScore);
  if (totalScore !== null) return roundScore(totalScore);
  if (enteredItemScores.length > 0) {
    return roundScore(enteredItemScores.reduce((sum, score) => sum + score, 0));
  }
  return null;
};

const getEnteredItemsTotalScore = (items: PerformanceScoreRecord["items"]) => {
  const enteredScores = (items || [])
    .map((item) => getEnteredItemScore(item))
    .filter((score): score is number => score !== null);
  return enteredScores.length
    ? roundScore(enteredScores.reduce((sum, score) => sum + score, 0))
    : null;
};

const getRecordTotalMaxScore = (record: PerformanceScoreRecord) => {
  const totalMaxScore = getFiniteNumber(record.totalMaxScore);
  if (totalMaxScore !== null && totalMaxScore > 0) return totalMaxScore;
  const itemMaxScore = (record.items || []).reduce((sum, item) => {
    const score = getFiniteNumber(item.maxScore);
    return sum + (score && score > 0 ? score : 0);
  }, 0);
  return itemMaxScore > 0 ? itemMaxScore : 0;
};

const getScoreStudentIdentityAliases = (
  source: Pick<
    PerformanceScoreRecord,
    "uid" | "grade" | "class" | "number" | "studentName"
  >,
) => {
  const uid = toText(source.uid);
  const grade = normalizeSchoolValue(source.grade);
  const classValue = normalizeSchoolValue(source.class);
  const number = normalizeSchoolValue(source.number);
  const studentName = normalizeStudentName(source.studentName);
  const aliases: string[] = [];

  if (uid) aliases.push(`uid:${uid}`);
  if (grade && classValue && number) {
    aliases.push(`school:${grade}:${classValue}:${number}`);
  }
  if (classValue && number && studentName) {
    aliases.push(`class-number-name:${classValue}:${number}:${studentName}`);
  }

  return Array.from(new Set(aliases));
};

const getScoreStudentPrimaryIdentityKey = (
  source: Pick<
    PerformanceScoreRecord,
    "uid" | "grade" | "class" | "number" | "studentName"
  >,
) =>
  getScoreStudentIdentityAliases(source)[0] ||
  `student:${normalizeSchoolValue(source.grade)}:${normalizeSchoolValue(
    source.class,
  )}:${normalizeSchoolValue(source.number)}:${normalizeStudentName(
    source.studentName,
  )}`;

const getManualScoreStudentIdentityKey = (
  source: Pick<
    PerformanceScoreRecord,
    "grade" | "class" | "number" | "studentName"
  >,
) => {
  const grade = normalizeSchoolValue(source.grade);
  const classValue = normalizeSchoolValue(source.class);
  const number = normalizeSchoolValue(source.number);
  const studentName = normalizeStudentName(source.studentName);
  if (!grade || !classValue || !number || !studentName) return "";
  return `manual:${grade}:${classValue}:${number}:${studentName}`;
};

const getScoreSyncIdentityKeys = (
  source: Pick<
    PerformanceScoreRecord,
    "uid" | "grade" | "class" | "number" | "studentName"
  >,
) => {
  const uid = toText(source.uid);
  const keys: string[] = [];
  if (uid) keys.push(`uid:${uid}`);
  const manualKey = getManualScoreStudentIdentityKey(source);
  if (manualKey) keys.push(manualKey);
  return keys;
};

const hasDisplayableScoreRecord = (record?: PerformanceScoreRecord) =>
  Boolean(
    record &&
    (isTransferredScoreRecord(record) || getEnteredTotalScore(record) !== null),
  );

const chooseClassSheetRecord = (
  current: PerformanceScoreRecord | undefined,
  next: PerformanceScoreRecord,
) => {
  if (!current) return next;
  const currentHasScore = hasDisplayableScoreRecord(current);
  const nextHasScore = hasDisplayableScoreRecord(next);
  if (!currentHasScore && nextHasScore) return next;
  if (currentHasScore && !nextHasScore) return current;
  if (!current.uid && next.uid) return next;
  return current;
};

const addRecordToClassSheetStudentMap = (
  studentMap: Map<string, ClassSheetStudent>,
  record: PerformanceScoreRecord,
  slot: "firstRecord" | "secondRecord",
) => {
  const aliases = getScoreSyncIdentityKeys(record);
  const key =
    aliases.find((alias) => studentMap.has(alias)) ||
    aliases[0] ||
    `record:${slot}:${studentMap.size}`;
  const current = studentMap.get(key) || {
    uid: record.uid,
    grade: record.grade,
    class: record.class,
    number: record.number,
    studentName: record.studentName,
  };

  current.uid = current.uid || record.uid;
  current.grade = current.grade || record.grade;
  current.class = current.class || record.class;
  current.number = current.number || record.number;
  current.studentName = current.studentName || record.studentName;
  current[slot] = chooseClassSheetRecord(current[slot], record);
  studentMap.set(key, current);
  aliases.forEach((alias) => studentMap.set(alias, current));
};

const getClassSheetStudentsFromMap = (
  studentMap: Map<string, ClassSheetStudent>,
) =>
  Array.from(new Set(studentMap.values())).filter(
    (student) =>
      hasDisplayableScoreRecord(student.firstRecord) ||
      hasDisplayableScoreRecord(student.secondRecord),
  );

const getSummaryMaxScore = (
  records: PerformanceScoreRecord[],
  fallbackMaxScore: unknown,
) => {
  const fallback = getFiniteNumber(fallbackMaxScore);
  if (fallback !== null && fallback > 0) return fallback;
  const observed = records.reduce(
    (max, record) => Math.max(max, getRecordTotalMaxScore(record)),
    0,
  );
  return observed > 0 ? observed : 0;
};

const buildScoreSummary = (
  records: PerformanceScoreRecord[],
  maxScore: number,
): ScoreSummary => {
  const scores = records
    .map((record) => getEnteredTotalScore(record))
    .filter((score): score is number => score !== null);
  const total = roundScore(scores.reduce((sum, score) => sum + score, 0));
  const average = scores.length ? roundScore(total / scores.length) : null;
  return {
    count: scores.length,
    total,
    average,
    min: scores.length ? Math.min(...scores) : null,
    max: scores.length ? Math.max(...scores) : null,
    maxScore,
    percent:
      average !== null && maxScore > 0
        ? roundScore((average / maxScore) * 100)
        : null,
  };
};

const buildItemScoreSummary = (
  records: PerformanceScoreRecord[],
  itemIndex: number,
  maxScore: number,
): ScoreSummary => {
  const scores = records
    .map((record) => getEnteredItemScore(record.items?.[itemIndex]))
    .filter((score): score is number => score !== null);
  const total = roundScore(scores.reduce((sum, score) => sum + score, 0));
  const average = scores.length ? roundScore(total / scores.length) : null;
  return {
    count: scores.length,
    total,
    average,
    min: scores.length ? Math.min(...scores) : null,
    max: scores.length ? Math.max(...scores) : null,
    maxScore,
    percent:
      average !== null && maxScore > 0
        ? roundScore((average / maxScore) * 100)
        : null,
  };
};

const formatScoreStat = (value: number | null) =>
  value === null ? "-" : formatPerformanceScore(value);

const formatScoreStatWithUnit = (value: number | null) =>
  value === null ? "-" : `${formatScoreStat(value)}점`;

const formatPercentStat = (value: number | null) =>
  value === null ? "-" : `${formatPerformanceScore(value)}%`;

const formatDifferenceStat = (value: number | null) => {
  if (value === null) return "-";
  if (value > 0) return `+${formatPerformanceScore(value)}점`;
  return `${formatPerformanceScore(value)}점`;
};

const getDifferenceTextClass = (value: number | null) => {
  if (value === null || value === 0) return "text-slate-600";
  return value > 0 ? "text-blue-700" : "text-rose-700";
};

const compareSchoolValue = (a: unknown, b: unknown) => {
  const aNumber = getFiniteNumber(normalizeSchoolValue(a));
  const bNumber = getFiniteNumber(normalizeSchoolValue(b));
  if (aNumber !== null && bNumber !== null && aNumber !== bNumber) {
    return aNumber - bNumber;
  }
  return String(a || "").localeCompare(String(b || ""), "ko", {
    numeric: true,
  });
};

const sortStudentIdentityRows = <
  T extends {
    grade: string;
    class: string;
    number: string;
    studentName: string;
  },
>(
  rows: T[],
) =>
  [...rows].sort(
    (a, b) =>
      compareSchoolValue(a.grade, b.grade) ||
      compareSchoolValue(a.class, b.class) ||
      compareSchoolValue(a.number, b.number) ||
      String(a.studentName || "").localeCompare(
        String(b.studentName || ""),
        "ko",
        { numeric: true },
      ),
  );

const buildScoreListSummaryStudents = (
  firstRecords: PerformanceScoreRecord[],
  secondRecords: PerformanceScoreRecord[],
) => {
  const studentMap = new Map<string, ClassSheetStudent>();

  firstRecords.forEach((record) =>
    addRecordToClassSheetStudentMap(studentMap, record, "firstRecord"),
  );
  secondRecords.forEach((record) =>
    addRecordToClassSheetStudentMap(studentMap, record, "secondRecord"),
  );
  return sortStudentIdentityRows(getClassSheetStudentsFromMap(studentMap));
};

const buildAssessmentContributionSummaries = (
  students: ClassSheetStudent[],
  params: {
    firstMaxScore: number;
    secondMaxScore: number;
  },
) => {
  const byClass = new Map<string, ClassSheetStudent[]>();
  students.forEach((student) => {
    const classValue = normalizeSchoolValue(student.class);
    if (!classValue) return;
    byClass.set(classValue, [...(byClass.get(classValue) || []), student]);
  });

  return Array.from(byClass.entries())
    .map(([classValue, classStudents]): AssessmentContributionSummary => {
      const scorableStudents = classStudents.filter(
        (student) =>
          !isTransferredScoreRecord(student.firstRecord) &&
          !isTransferredScoreRecord(student.secondRecord),
      );
      const first = buildScoreSummary(
        scorableStudents
          .map((student) => student.firstRecord)
          .filter((record): record is PerformanceScoreRecord =>
            Boolean(record),
          ),
        params.firstMaxScore,
      );
      const second = buildScoreSummary(
        scorableStudents
          .map((student) => student.secondRecord)
          .filter((record): record is PerformanceScoreRecord =>
            Boolean(record),
          ),
        params.secondMaxScore,
      );
      const combinedScores = scorableStudents
        .map((student) => {
          const firstScore = student.firstRecord
            ? getEnteredTotalScore(student.firstRecord)
            : null;
          const secondScore = student.secondRecord
            ? getEnteredTotalScore(student.secondRecord)
            : null;
          return firstScore !== null || secondScore !== null
            ? {
                firstScore: firstScore ?? 0,
                secondScore: secondScore ?? 0,
              }
            : null;
        })
        .filter(
          (
            score,
          ): score is {
            firstScore: number;
            secondScore: number;
          } => score !== null,
        );
      const combinedCount = combinedScores.length;
      const firstTotal = roundScore(
        combinedScores.reduce((sum, score) => sum + score.firstScore, 0),
      );
      const secondTotal = roundScore(
        combinedScores.reduce((sum, score) => sum + score.secondScore, 0),
      );
      const contributionTotal = roundScore(firstTotal + secondTotal);
      const firstAverage = combinedCount
        ? roundScore(firstTotal / combinedCount)
        : null;
      const secondAverage = combinedCount
        ? roundScore(secondTotal / combinedCount)
        : null;
      const combinedAverage = combinedCount
        ? roundScore(contributionTotal / combinedCount)
        : null;
      return {
        classValue,
        first,
        second,
        firstAverage,
        secondAverage,
        combinedAverage,
        combinedCount,
      };
    })
    .sort((a, b) => compareSchoolValue(a.classValue, b.classValue));
};
const compareNullableNumber = (a: number | null, b: number | null) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
};

const compareScoreListRecords = (
  a: PerformanceScoreRecord,
  b: PerformanceScoreRecord,
  key: ScoreListSortKey,
) => {
  if (key === "grade") return compareSchoolValue(a.grade, b.grade);
  if (key === "class") return compareSchoolValue(a.class, b.class);
  if (key === "number") return compareSchoolValue(a.number, b.number);
  if (key === "studentName") {
    return String(a.studentName || "").localeCompare(
      String(b.studentName || ""),
      "ko",
      { numeric: true },
    );
  }
  if (key === "totalScore") {
    return compareNullableNumber(
      getEnteredTotalScore(a),
      getEnteredTotalScore(b),
    );
  }
  const itemIndex = Number(key.replace("item-", ""));
  return compareNullableNumber(
    getEnteredItemScore(a.items?.[itemIndex]),
    getEnteredItemScore(b.items?.[itemIndex]),
  );
};

const compareScoreRecordIdentity = (
  a: PerformanceScoreRecord,
  b: PerformanceScoreRecord,
) =>
  compareSchoolValue(a.grade, b.grade) ||
  compareSchoolValue(a.class, b.class) ||
  compareSchoolValue(a.number, b.number) ||
  String(a.studentName || "").localeCompare(String(b.studentName || ""), "ko", {
    numeric: true,
  });

const sortScoreListRecords = (
  records: PerformanceScoreRecord[],
  sort: SortState<ScoreListSortKey>,
) =>
  records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => {
      const compared = compareScoreListRecords(a.record, b.record, sort.key);
      if (compared !== 0) {
        return sort.direction === "asc" ? compared : -compared;
      }
      return (
        compareScoreRecordIdentity(a.record, b.record) || a.index - b.index
      );
    })
    .map(({ record }) => record);

const compareClassScoreSummaries = (
  a: ClassScoreSummary,
  b: ClassScoreSummary,
  key: ClassStatsSortKey,
) => {
  if (key === "class") return compareSchoolValue(a.classValue, b.classValue);
  if (key === "count") return a.count - b.count;
  if (key === "average") return compareNullableNumber(a.average, b.average);
  if (key === "max") return compareNullableNumber(a.max, b.max);
  if (key === "min") return compareNullableNumber(a.min, b.min);
  if (key === "difference")
    return compareNullableNumber(a.difference, b.difference);
  return compareNullableNumber(a.percent, b.percent);
};

const sortClassScoreSummaries = (
  summaries: ClassScoreSummary[],
  sort: SortState<ClassStatsSortKey>,
) =>
  summaries
    .map((summary, index) => ({ summary, index }))
    .sort((a, b) => {
      const compared = compareClassScoreSummaries(
        a.summary,
        b.summary,
        sort.key,
      );
      if (compared !== 0) {
        return sort.direction === "asc" ? compared : -compared;
      }
      return (
        compareSchoolValue(a.summary.classValue, b.summary.classValue) ||
        a.index - b.index
      );
    })
    .map(({ summary }) => summary);

const getRecordTotalScores = (records: PerformanceScoreRecord[]) =>
  records
    .map((record) => getEnteredTotalScore(record))
    .filter((score): score is number => score !== null);

const buildNormalCurveSummary = (
  records: PerformanceScoreRecord[],
  maxScore: number,
): NormalCurveSummary => {
  const scores = getRecordTotalScores(records);
  if (scores.length < 2 || maxScore <= 0) {
    return {
      count: scores.length,
      mean: scores.length === 1 ? scores[0] : null,
      standardDeviation: null,
      points: [],
    };
  }

  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance =
    scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length;
  const standardDeviation = Math.sqrt(variance);
  if (!Number.isFinite(standardDeviation) || standardDeviation <= 0) {
    return {
      count: scores.length,
      mean: roundScore(mean),
      standardDeviation: null,
      points: [],
    };
  }

  const pointCount = 72;
  const points = Array.from({ length: pointCount }, (_, index) => {
    const x = (maxScore * index) / (pointCount - 1);
    const y =
      (1 / (standardDeviation * Math.sqrt(2 * Math.PI))) *
      Math.exp(-0.5 * ((x - mean) / standardDeviation) ** 2);
    return { x, y };
  });

  return {
    count: scores.length,
    mean: roundScore(mean),
    standardDeviation: roundScore(standardDeviation),
    points,
  };
};

const buildNormalCurvePath = (
  curve: NormalCurveSummary,
  maxScore: number,
  maxDensity: number,
  width: number,
  height: number,
) => {
  if (!curve.points.length || maxScore <= 0 || maxDensity <= 0) return "";
  const paddingX = 10;
  const paddingY = 14;
  const graphWidth = width - paddingX * 2;
  const graphHeight = height - paddingY * 2;
  return curve.points
    .map((point, index) => {
      const x = paddingX + (point.x / maxScore) * graphWidth;
      const y = height - paddingY - (point.y / maxDensity) * graphHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
};

const getRosterRowEnteredScoreCount = (row: PerformanceScoreRosterRow) => {
  const enteredScoreCount = getFiniteNumber(row.enteredScoreCount);
  return enteredScoreCount === null ? 0 : Math.max(0, enteredScoreCount);
};

const getEnteredItemScoreCount = (items: PerformanceScoreRecord["items"]) =>
  (items || []).filter((item) => getEnteredItemScore(item) !== null).length;

const getScoreRecordEnteredScoreCount = (
  record: PerformanceScoreRecord & { enteredScoreCount?: number },
  itemsOverride?: PerformanceScoreRecord["items"],
) => {
  const academicStatus = getAcademicStatusLabel(record);
  if (academicStatus) return 1;

  const items = itemsOverride || record.items || [];
  const enteredItemCount = getEnteredItemScoreCount(items);
  if (enteredItemCount > 0) return enteredItemCount;

  const storedCount = getFiniteNumber(record.enteredScoreCount);
  const totalScore = getFiniteNumber(record.totalScore);
  if (storedCount !== null && storedCount > 0 && totalScore !== null) {
    return Math.max(1, Math.round(storedCount));
  }
  return totalScore !== null && totalScore > 0 ? 1 : 0;
};

const getScoreRecordFallbackTotalScore = (
  record: PerformanceScoreRecord & { enteredScoreCount?: number },
) => {
  const totalScore = getFiniteNumber(record.totalScore);
  if (getScoreRecordEnteredScoreCount(record) > 0 && totalScore !== null) {
    return roundScore(totalScore);
  }
  return getEnteredTotalScore(record);
};

const rosterRowHasScore = (row: PerformanceScoreRosterRow) => {
  if (isTransferredRosterRow(row)) return true;
  if (getRosterRowEnteredScoreCount(row) > 0) return true;
  const itemScores = Array.isArray(row.items) ? row.items : [];
  if (itemScores.some((item) => getEnteredItemScore(item) !== null)) {
    return true;
  }
  const totalScore = getFiniteNumber(row.totalScore);
  return totalScore !== null && totalScore > 0;
};

const isManualRosterRow = (row?: PerformanceScoreRosterRow | null) =>
  Boolean(
    row &&
    !row.uid &&
    (row.isManual || toText(row.matchMessage) === MANUAL_SCORE_ROW_MESSAGE),
  );

const shouldShowRosterRowInScoreList = (row: PerformanceScoreRosterRow) =>
  rosterRowHasScore(row) || isManualRosterRow(row);

const buildRecordFromRosterRow = (
  roster: PerformanceScoreRoster,
  row: PerformanceScoreRosterRow,
): PerformanceScoreRecord => {
  const hasScore = rosterRowHasScore(row);
  const academicStatus = getAcademicStatusLabel(row);
  const hasAcademicStatus = Boolean(academicStatus);
  const record = {
    id: roster.id,
    rosterId: roster.id,
    title: roster.title,
    subject: roster.subject,
    ...(roster.assessmentOrder
      ? { assessmentOrder: roster.assessmentOrder }
      : {}),
    academicYear: roster.academicYear,
    semester: roster.semester,
    grade: row.grade,
    class: row.class,
    number: row.number,
    studentName: row.studentName,
    uid: row.uid,
    items: hasAcademicStatus
      ? (roster.items || []).map((item) => ({
          name: item.name,
          ...(item.shortName ? { shortName: item.shortName } : {}),
          maxScore: getFiniteNumber(item.maxScore) ?? 0,
          ...(item.ratio !== undefined ? { ratio: item.ratio } : {}),
          score: 0,
          scoreEntered: false,
        }))
      : Array.isArray(row.items)
        ? row.items
        : [],
    enteredScoreCount: getRosterRowEnteredScoreCount(row),
    totalScore:
      hasScore && !hasAcademicStatus ? Number(row.totalScore || 0) : Number.NaN,
    totalMaxScore: row.totalMaxScore || roster.totalMaxScore || 0,
    feedback: row.feedback || "",
    evidence: row.evidence || row.feedback || "",
    sourceFileName: roster.sourceFileName,
    ...getAcademicStatusRecordMeta(academicStatus),
  } as PerformanceScoreRecord & TransferScoreMeta;
  return record;
};

const buildStudentScoreDocumentPayload = (
  roster: PerformanceScoreRoster,
  row: PerformanceScoreRosterRow,
  timestamp: ReturnType<typeof serverTimestamp>,
  scope: { year: string; semester: string },
): PerformanceScoreRecord | null => {
  if (!row.uid) return null;
  const record = buildRecordFromRosterRow(roster, row);
  const rowTotalScore = getFiniteNumber(row.totalScore);
  if (!hasDisplayableScoreRecord(record) && !rosterRowHasScore(row)) {
    return null;
  }

  const academicStatus = getAcademicStatusLabel(record);
  const hasAcademicStatus = Boolean(academicStatus);
  const items = (record.items || []).map((item) =>
    hasAcademicStatus
      ? {
          ...item,
          score: 0,
          scoreEntered: false,
        }
      : item,
  );
  const itemTotalScore = getEnteredItemsTotalScore(items);
  const totalScore = hasAcademicStatus
    ? 0
    : (itemTotalScore ??
      (rowTotalScore === null ? null : roundScore(rowTotalScore)));

  if (!hasAcademicStatus && totalScore === null) return null;

  return {
    rosterId: roster.id,
    title: roster.title,
    subject: roster.subject,
    ...(roster.assessmentOrder
      ? { assessmentOrder: roster.assessmentOrder }
      : {}),
    academicYear: roster.academicYear || scope.year,
    semester: roster.semester || scope.semester,
    grade: row.grade,
    class: row.class,
    number: row.number,
    studentName: row.studentName,
    uid: row.uid,
    items,
    enteredScoreCount: getRosterRowEnteredScoreCount(row),
    totalScore: totalScore ?? 0,
    totalMaxScore: row.totalMaxScore || roster.totalMaxScore || 0,
    feedback: String(row.feedback || "").slice(0, 1000),
    evidence: String(row.evidence || row.feedback || "").slice(0, 1000),
    sourceFileName: roster.sourceFileName,
    uploadedBy: roster.uploadedBy || "",
    uploadedByEmail: roster.uploadedByEmail || "",
    uploadedAt: roster.createdAt || timestamp,
    updatedAt: timestamp,
    ...getAcademicStatusRecordMeta(academicStatus),
  };
};

const cloneScoreListRecords = (records: ScoreListRecord[]) =>
  records.map((record) => ({
    ...record,
    items: (record.items || []).map((item) => ({ ...item })),
    confirmation: record.confirmation
      ? { ...record.confirmation }
      : record.confirmation,
  }));

const getRosterRowLocalKey = (
  rosterId: string,
  row: PerformanceScoreRosterRow,
) => `row:${rosterId}:${row.rowNumber}`;

const getScoreListRecordKey = (record: PerformanceScoreRecord) =>
  record.uid
    ? `uid:${record.uid}:${record.id || record.rosterId || ""}`
    : (record as ScoreListRecord).localKey ||
      `manual:${record.id || record.rosterId || ""}:${record.grade}:${record.class}:${record.number}:${record.studentName}`;

const isManualScoreListRecord = (record: PerformanceScoreRecord) => !record.uid;

const isNewManualScoreListRecord = (record: PerformanceScoreRecord) =>
  isManualScoreListRecord(record) &&
  Boolean((record as ScoreListRecord).localKey?.startsWith("manual:"));

const isEmptyManualScoreListRecord = (record: PerformanceScoreRecord) =>
  isManualScoreListRecord(record) &&
  !isTransferredScoreRecord(record) &&
  !normalizeSchoolValue(record.number) &&
  !normalizeStudentName(record.studentName) &&
  getEnteredTotalScore(record) === null &&
  !String(record.evidence || record.feedback || "").trim();

const createManualScoreListRecord = (
  roster: PerformanceScoreRoster,
  params: {
    year: string;
    semester: string;
    grade: string;
    classValue: string;
    localKey: string;
  },
): ScoreListRecord => ({
  id: roster.id,
  rosterId: roster.id,
  title: roster.title,
  subject: roster.subject,
  ...(roster.assessmentOrder
    ? { assessmentOrder: roster.assessmentOrder }
    : {}),
  academicYear: roster.academicYear || params.year,
  semester: roster.semester || params.semester,
  grade: normalizeSchoolValue(params.grade),
  class: normalizeSchoolValue(params.classValue),
  number: "",
  studentName: "",
  uid: "",
  items: (roster.items || []).map((item) => ({
    name: item.name,
    ...(item.shortName ? { shortName: item.shortName } : {}),
    maxScore: getFiniteNumber(item.maxScore) ?? 0,
    ...(item.ratio !== undefined ? { ratio: item.ratio } : {}),
    score: 0,
    scoreEntered: false,
  })),
  enteredScoreCount: 0,
  totalScore: Number.NaN,
  totalMaxScore: roster.totalMaxScore || 0,
  feedback: "",
  evidence: "",
  sourceFileName: roster.sourceFileName,
  uploadedBy: roster.uploadedBy,
  uploadedByEmail: roster.uploadedByEmail,
  uploadedAt: roster.createdAt,
  scoreSource: "roster-row",
  scoreDocumentExists: false,
  localKey: params.localKey,
  isManual: true,
});

const buildScoreListRecordFromRosterRow = (
  roster: PerformanceScoreRoster,
  row: PerformanceScoreRosterRow,
): ScoreListRecord => ({
  ...buildRecordFromRosterRow(roster, row),
  localKey: getRosterRowLocalKey(roster.id, row),
  rosterRowNumber: row.rowNumber,
  scoreSource: "roster-row",
  scoreDocumentExists: false,
  ...(isManualRosterRow(row) ? { isManual: true } : {}),
});

const shouldIncludeRosterRowInScoreList = (row: PerformanceScoreRosterRow) =>
  Boolean(row.uid) || shouldShowRosterRowInScoreList(row);

const buildScoreListRecordsFromRosterRows = (roster: PerformanceScoreRoster) =>
  sortStudentIdentityRows(
    (roster.rows || [])
      .filter((row) => shouldIncludeRosterRowInScoreList(row))
      .map((row) => buildScoreListRecordFromRosterRow(roster, row)),
  );

const buildScoreListRecordFromDocument = (
  id: string,
  data: PerformanceScoreRecord,
): ScoreListRecord => ({
  id,
  ...data,
  items: Array.isArray(data.items) ? data.items : [],
  scoreSource: "student-doc",
  scoreDocumentExists: true,
});

const getRecordItemsForRoster = (
  record: PerformanceScoreRecord,
  roster: PerformanceScoreRoster,
) =>
  (roster.items || []).map((item, index) => {
    const existing = record.items?.[index];
    const existingScore = getFiniteNumber(existing?.score);
    const existingMaxScore = getFiniteNumber(existing?.maxScore);
    const shortName = existing?.shortName || item.shortName;
    const ratio = existing?.ratio ?? item.ratio;
    return {
      name: existing?.name || item.name,
      score: existingScore === null ? 0 : roundScore(existingScore),
      maxScore:
        existingMaxScore === null
          ? roundScore(Number(item.maxScore || 0))
          : roundScore(existingMaxScore),
      scoreEntered:
        existing?.scoreEntered === false ? false : existingScore !== null,
      ...(shortName ? { shortName } : {}),
      ...(ratio !== undefined ? { ratio } : {}),
    };
  });

const normalizeScoreRecordForIntegerEdit = (
  record: ScoreListRecord,
): ScoreListRecord => {
  if (isTransferredScoreRecord(record)) return record;
  const items = (record.items || []).map((item) => {
    const score =
      item.scoreEntered === false ? null : toScoreEditInteger(item.score);
    return {
      ...item,
      score: score ?? 0,
      scoreEntered: score !== null,
    };
  });
  const itemTotalScore = getEnteredItemsTotalScore(items);
  const enteredScoreCount = getScoreRecordEnteredScoreCount(record, items);
  return {
    ...record,
    items,
    enteredScoreCount,
    totalScore:
      itemTotalScore ??
      (enteredScoreCount > 0
        ? (getScoreRecordFallbackTotalScore(record) ?? Number.NaN)
        : Number.NaN),
  };
};

const prepareScoreListRecordForInstantEdit = (
  record: ScoreListRecord,
): ScoreListRecord => {
  const normalized = normalizeScoreRecordForIntegerEdit(record);
  if (!normalized.uid || normalized.scoreDocumentExists === true) {
    return normalized;
  }
  return {
    ...normalized,
    scoreDocumentExists: true,
  };
};

const serializeScoreRecordForEdit = (
  record: PerformanceScoreRecord | undefined,
) => {
  if (!record) return "";
  return JSON.stringify({
    uid: record.uid || "",
    rosterId: record.rosterId || record.id || "",
    grade: normalizeSchoolValue(record.grade),
    class: normalizeSchoolValue(record.class),
    number: normalizeSchoolValue(record.number),
    studentName: normalizeStudentName(record.studentName),
    academicStatus: getAcademicStatusLabel(record),
    items: (record.items || []).map((item) => ({
      name: item.name || "",
      score: item.scoreEntered === false ? null : getEnteredItemScore(item),
      maxScore: getFiniteNumber(item.maxScore) ?? 0,
      scoreEntered: item.scoreEntered !== false,
    })),
    enteredScoreCount: getScoreRecordEnteredScoreCount(record),
    totalScore: getEnteredTotalScore(record),
    totalMaxScore: getRecordTotalMaxScore(record),
    feedback: String(record.feedback || ""),
    evidence: String(record.evidence || record.feedback || ""),
    isTransferred: isTransferredScoreRecord(record),
  });
};

const hasScoreRecordChanged = (
  before: PerformanceScoreRecord | undefined,
  after: PerformanceScoreRecord,
) => serializeScoreRecordForEdit(before) !== serializeScoreRecordForEdit(after);

const needsStudentScoreDocumentSync = (record: ScoreListRecord) =>
  Boolean(
    record.uid &&
    record.scoreDocumentExists === false &&
    (hasDisplayableScoreRecord(record) ||
      getScoreRecordEnteredScoreCount(record) > 0),
  );

const buildRosterRowFromScoreRecord = (
  row: PerformanceScoreRosterRow,
  record: PerformanceScoreRecord,
  roster: PerformanceScoreRoster,
): PerformanceScoreRosterRow => {
  const academicStatus = getAcademicStatusLabel(record);
  const hasAcademicStatus = Boolean(academicStatus);
  const manual =
    !record.uid &&
    (Boolean((record as ScoreListRecord).isManual) || isManualRosterRow(row));
  const items = getRecordItemsForRoster(record, roster).map((item) =>
    hasAcademicStatus
      ? {
          ...item,
          score: 0,
          scoreEntered: false,
        }
      : item,
  );
  const itemTotalScore = getEnteredItemsTotalScore(items);
  const totalScore = itemTotalScore ?? getScoreRecordFallbackTotalScore(record);
  const matchStatus = hasAcademicStatus
    ? "unmatched"
    : row.matchStatus || (record.uid ? "matched" : "unmatched");
  const matchMessage = hasAcademicStatus
    ? `${academicStatus} 학생입니다.`
    : row.matchMessage ||
      (record.uid
        ? "학생 문서와 연결된 점수입니다."
        : MANUAL_SCORE_ROW_MESSAGE);
  const nextRow: PerformanceScoreRosterRow = {
    rowNumber: Number(row.rowNumber) || 0,
    uid: record.uid || row.uid || "",
    grade: record.grade || row.grade || "",
    class: record.class || row.class || "",
    number: record.number || row.number || "",
    studentName: record.studentName || row.studentName || "",
    items,
    enteredScoreCount: getScoreRecordEnteredScoreCount(record, items),
    totalScore: hasAcademicStatus ? 0 : (totalScore ?? 0),
    totalMaxScore:
      getRecordTotalMaxScore(record) ||
      roster.totalMaxScore ||
      row.totalMaxScore ||
      0,
    feedback: String(record.feedback || "").slice(0, 1000),
    evidence: String(record.evidence || record.feedback || "").slice(0, 1000),
    matchStatus,
    matchMessage,
    ...(manual ? { isManual: true } : {}),
    ...getAcademicStatusRecordMeta(academicStatus),
  };
  return nextRow;
};

const hasSyncableManualScoreIdentity = (record: PerformanceScoreRecord) =>
  !record.uid &&
  Boolean((record as ScoreListRecord).isManual) &&
  Boolean(
    normalizeSchoolValue(record.grade) &&
    normalizeSchoolValue(record.class) &&
    normalizeSchoolValue(record.number) &&
    normalizeStudentName(record.studentName),
  );

type ManualScoreIdentityReplacement = {
  beforeKey: string;
  after: ScoreListRecord;
};

const getManualScoreIdentityReplacements = (
  editedRecords: ScoreListRecord[],
  originalByKey: Map<string, ScoreListRecord>,
) =>
  editedRecords
    .map((after): ManualScoreIdentityReplacement | null => {
      if (!hasSyncableManualScoreIdentity(after)) return null;
      const before = originalByKey.get(getScoreListRecordKey(after));
      if (!before || !hasSyncableManualScoreIdentity(before)) return null;
      const beforeKey = getManualScoreStudentIdentityKey(before);
      const afterKey = getManualScoreStudentIdentityKey(after);
      if (!beforeKey || !afterKey || beforeKey === afterKey) return null;
      return { beforeKey, after };
    })
    .filter((item): item is ManualScoreIdentityReplacement => item !== null);

const buildBlankManualRosterRowFromRecord = (
  record: PerformanceScoreRecord,
  roster: PerformanceScoreRoster,
  rowNumber: number,
): PerformanceScoreRosterRow => ({
  rowNumber,
  uid: "",
  grade: normalizeSchoolValue(record.grade),
  class: normalizeSchoolValue(record.class),
  number: normalizeSchoolValue(record.number),
  studentName: toText(record.studentName),
  items: (roster.items || []).map((item) => ({
    name: item.name,
    ...(item.shortName ? { shortName: item.shortName } : {}),
    maxScore: getFiniteNumber(item.maxScore) ?? 0,
    ...(item.ratio !== undefined ? { ratio: item.ratio } : {}),
    score: 0,
    scoreEntered: false,
  })),
  enteredScoreCount: 0,
  totalScore: 0,
  totalMaxScore: roster.totalMaxScore || 0,
  feedback: String(record.feedback || "").slice(0, 1000),
  evidence: String(record.evidence || record.feedback || "").slice(0, 1000),
  matchStatus: "unmatched",
  matchMessage: MANUAL_SCORE_ROW_MESSAGE,
  isManual: true,
  ...getAcademicStatusRecordMeta(getAcademicStatusLabel(record)),
});

const manualRosterRowHasProtectedContent = (row: PerformanceScoreRosterRow) => {
  if (getRosterRowEnteredScoreCount(row) > 0) return true;

  const hasEnteredScore = (row.items || []).some(
    (item) => getEnteredItemScore(item) !== null,
  );
  if (hasEnteredScore) return true;

  const totalScore = getFiniteNumber(row.totalScore);
  if (totalScore !== null && totalScore > 0) return true;

  const text = String(row.evidence || row.feedback || "").trim();
  if (!text) return false;
  const academicStatus = getAcademicStatusLabel(row);
  return (
    text !== academicStatus &&
    text !== TRANSFERRED_LABEL &&
    text !== MANUAL_SCORE_ROW_MESSAGE
  );
};

const isAutoSyncedManualRosterRow = (row?: PerformanceScoreRosterRow | null) =>
  Boolean(
    row && isManualRosterRow(row) && !manualRosterRowHasProtectedContent(row),
  );

const applyManualScoreIdentityReplacements = (
  rows: PerformanceScoreRosterRow[],
  replacements: ManualScoreIdentityReplacement[],
) => {
  if (!replacements.length) return rows;
  let changed = false;
  const replacementByBeforeKey = new Map(
    replacements.map((replacement) => [
      replacement.beforeKey,
      replacement.after,
    ]),
  );
  const updatedRows = rows.map((row) => {
    if (!isAutoSyncedManualRosterRow(row)) return row;
    const replacement = replacementByBeforeKey.get(
      getManualScoreStudentIdentityKey(row),
    );
    if (!replacement) return row;
    changed = true;
    return {
      ...row,
      grade: normalizeSchoolValue(replacement.grade),
      class: normalizeSchoolValue(replacement.class),
      number: normalizeSchoolValue(replacement.number),
      studentName: toText(replacement.studentName),
      isManual: true,
      matchMessage: row.matchMessage || MANUAL_SCORE_ROW_MESSAGE,
    };
  });
  return changed ? updatedRows : rows;
};

const chooseManualRosterRow = (
  current: PerformanceScoreRosterRow,
  next: PerformanceScoreRosterRow,
) => {
  const currentHasScore = rosterRowHasScore(current);
  const nextHasScore = rosterRowHasScore(next);
  if (!currentHasScore && nextHasScore) return next;
  if (currentHasScore && !nextHasScore) return current;
  const currentHasEvidence = Boolean(
    String(current.evidence || current.feedback || "").trim(),
  );
  const nextHasEvidence = Boolean(
    String(next.evidence || next.feedback || "").trim(),
  );
  if (!currentHasEvidence && nextHasEvidence) return next;
  return current;
};

const dedupeManualRosterRows = (rows: PerformanceScoreRosterRow[]) => {
  const seen = new Map<
    string,
    { row: PerformanceScoreRosterRow; index: number }
  >();
  const removedIndexes = new Set<number>();

  rows.forEach((row, index) => {
    if (!isManualRosterRow(row)) return;
    const key = getManualScoreStudentIdentityKey(row);
    if (!key) return;
    const current = seen.get(key);
    if (!current) {
      seen.set(key, { row, index });
      return;
    }
    const preferred = chooseManualRosterRow(current.row, row);
    if (preferred === current.row) {
      removedIndexes.add(index);
      return;
    }
    removedIndexes.add(current.index);
    seen.set(key, { row, index });
  });

  return removedIndexes.size
    ? rows.filter((_, index) => !removedIndexes.has(index))
    : rows;
};

const collectManualScoreSyncRecords = (
  editedRecords: ScoreListRecord[],
  skippedManualIdentityKeys: Set<string>,
) => {
  const recordMap = new Map<string, ScoreListRecord>();
  const addRecord = (record: ScoreListRecord) => {
    if (!hasSyncableManualScoreIdentity(record)) return;
    const manualKey = getManualScoreStudentIdentityKey(record);
    if (manualKey && skippedManualIdentityKeys.has(manualKey)) return;
    const aliases = getScoreSyncIdentityKeys(record);
    const existingKey = aliases.find((alias) => recordMap.has(alias));
    const current = existingKey ? recordMap.get(existingKey) : undefined;
    const preferred = chooseClassSheetRecord(
      current,
      record,
    ) as ScoreListRecord;
    aliases.forEach((alias) => recordMap.set(alias, preferred));
  };

  editedRecords.forEach(addRecord);
  return Array.from(new Set(recordMap.values()));
};

const buildRosterRowsMeta = (
  roster: PerformanceScoreRoster,
  rows: PerformanceScoreRosterRow[],
) => {
  const classes = Array.from(
    new Set(rows.map((row) => normalizeSchoolValue(row.class)).filter(Boolean)),
  ).sort(compareSchoolValue);
  const savedRowCount = rows.filter((row) => rosterRowHasScore(row)).length;
  return {
    classes,
    targetClass: classes.length === 1 ? classes[0] : roster.targetClass || "",
    rowCount: rows.length,
    matchedCount: savedRowCount,
    unmatchedCount: Math.max(0, rows.length - savedRowCount),
  };
};

const syncManualScoreRowsAcrossAssessments = (
  rosters: PerformanceScoreRoster[],
  editedRecords: ScoreListRecord[],
  replacements: ManualScoreIdentityReplacement[] = [],
  deletedRecords: ScoreListRecord[] = [],
) => {
  const syncGrades = new Set(
    [...editedRecords, ...deletedRecords]
      .filter(hasSyncableManualScoreIdentity)
      .map((record) => normalizeSchoolValue(record.grade))
      .filter(Boolean),
  );
  const targetRosters = rosters.filter((roster) => {
    if (!syncGrades.size) return true;
    const targetGrade = normalizeSchoolValue(roster.targetGrade);
    if (targetGrade && syncGrades.has(targetGrade)) return true;
    return (roster.rows || []).some((row) =>
      syncGrades.has(normalizeSchoolValue(row.grade)),
    );
  });
  const deletedManualIdentityKeys = new Set(
    deletedRecords
      .map((record) =>
        hasSyncableManualScoreIdentity(record)
          ? getManualScoreStudentIdentityKey(record)
          : "",
      )
      .filter(Boolean),
  );
  const skippedManualIdentityKeys = new Set([
    ...replacements.map((replacement) => replacement.beforeKey),
    ...deletedManualIdentityKeys,
  ]);
  const syncRecords = collectManualScoreSyncRecords(
    editedRecords,
    skippedManualIdentityKeys,
  );
  const updates = new Map<string, PerformanceScoreRosterRow[]>();

  if (
    !syncRecords.length &&
    !replacements.length &&
    !skippedManualIdentityKeys.size
  ) {
    return updates;
  }

  targetRosters.forEach((roster) => {
    let rows = dedupeManualRosterRows(
      applyManualScoreIdentityReplacements(roster.rows || [], replacements),
    );
    if (deletedManualIdentityKeys.size) {
      rows = rows.filter((row) => {
        if (!isAutoSyncedManualRosterRow(row)) return true;
        const key = getManualScoreStudentIdentityKey(row);
        return !key || !deletedManualIdentityKeys.has(key);
      });
    }
    let nextRowNumber = rows.reduce(
      (max, row) => Math.max(max, Number(row.rowNumber) || 0),
      0,
    );

    syncRecords.forEach((record) => {
      const recordAliases = new Set(getScoreSyncIdentityKeys(record));
      const existingIndex = rows.findIndex((row) =>
        getScoreSyncIdentityKeys(row).some((alias) => recordAliases.has(alias)),
      );
      if (existingIndex >= 0) {
        if (isAutoSyncedManualRosterRow(rows[existingIndex])) {
          rows = rows.map((row, index) =>
            index === existingIndex
              ? buildBlankManualRosterRowFromRecord(
                  record,
                  roster,
                  Number(row.rowNumber) || 0,
                )
              : row,
          );
        }
        return;
      }
      nextRowNumber += 1;
      rows = [
        ...rows,
        buildBlankManualRosterRowFromRecord(record, roster, nextRowNumber),
      ];
    });

    rows = dedupeManualRosterRows(rows);

    if (rows !== roster.rows) {
      updates.set(roster.id, rows);
    }
  });

  return updates;
};

const CLASS_SHEET_COLUMNS = [
  { width: 2.3 },
  { width: 7 },
  { width: 2 },
  { width: 8 },
  { width: 1 },
  { width: 9 },
  { width: 10 },
  { width: 7 },
  { width: 1.5 },
  { width: 4 },
  { width: 2 },
  { width: 2 },
  { width: 2 },
  { width: 4 },
  { width: 23 },
  { width: 18 },
];

const getTodayLabel = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}.`;
};

const formatClassSheetPrintDateTime = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}.${month}.${day} ${hours}:${minutes}`;
};

const normalizeClassSheetPrintIp = (value: unknown) => {
  const text = toText(value).slice(0, 80);
  return text || CLASS_SHEET_PRINT_INFO_FIXED_IP;
};

const getClassSheetPrintInfoText = (params: {
  schoolName?: string;
  printedAt?: Date;
  clientIp?: string;
  teacherName?: string;
}) =>
  `${toText(params.schoolName) || CLASS_SHEET_SCHOOL_NAME}/${formatClassSheetPrintDateTime(
    params.printedAt,
  )}/${normalizeClassSheetPrintIp(params.clientIp)}/${
    toText(params.teacherName) || "교사"
  }${CLASS_SHEET_PRINT_INFO_TRAILING_SPACES}`;

const loadClassSheetPrintClientInfo = async () => {
  return {
    clientIp: CLASS_SHEET_PRINT_INFO_FIXED_IP,
  };
};

const excelCell = (
  value: string | number,
  options: Record<string, unknown> = {},
) => ({
  value,
  type: typeof value === "number" ? Number : String,
  align: "center",
  alignVertical: "center",
  fontSize: 10,
  borderColor: "#111827",
  borderStyle: "thin",
  ...options,
});

const plainExcelCell = (
  value: string | number,
  options: Record<string, unknown> = {},
) => ({
  value,
  type: typeof value === "number" ? Number : String,
  align: "center",
  alignVertical: "center",
  fontSize: 10,
  ...options,
});

const makeExcelRow = (height?: number) => {
  const row = Array.from({ length: 16 }, () => null) as Array<unknown>;
  if (height) {
    row[0] = plainExcelCell("", { height });
  }
  return row;
};

const setExcelCell = (
  row: Array<unknown>,
  columnIndex: number,
  value: string | number,
  options: Record<string, unknown> = {},
) => {
  row[columnIndex] = excelCell(value, options);
};

const dataUrlToBlob = (dataUrl: string) => {
  const [meta, base64] = dataUrl.split(",");
  const contentType = /data:([^;]+)/.exec(meta || "")?.[1] || "image/png";
  const binary = window.atob(base64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: contentType });
};

const saveBlobAsFile = (blob: Blob, fileName: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

const getScoreNumber = (record?: PerformanceScoreRecord) => {
  if (!record || isTransferredScoreRecord(record)) return null;
  const score = Number(record.totalScore);
  return Number.isFinite(score) ? roundScore(score) : null;
};

const getClassSheetScoreCellValue = (record?: PerformanceScoreRecord) =>
  getAcademicStatusLabel(record) || getScoreNumber(record);

const getClassSheetAcademicStatusLabel = (student: ClassSheetStudent) =>
  getAcademicStatusLabel(student.firstRecord) ||
  getAcademicStatusLabel(student.secondRecord);

const isClassSheetTransferredStudent = (student: ClassSheetStudent) =>
  Boolean(getClassSheetAcademicStatusLabel(student));

const getClassSheetStudentScoreCellValue = (
  student: ClassSheetStudent,
  record?: PerformanceScoreRecord,
) =>
  isClassSheetTransferredStudent(student)
    ? getClassSheetAcademicStatusLabel(student)
    : getClassSheetScoreCellValue(record);

const getClassSheetSummaryScore = (
  student: ClassSheetStudent,
  record?: PerformanceScoreRecord,
) => (isClassSheetTransferredStudent(student) ? null : getScoreNumber(record));

const getScoreListSummaryTotalOnlyLabel = (
  record?: PerformanceScoreRecord,
  forceAcademicStatus = "",
) => {
  const academicStatus =
    normalizeAcademicStatus(forceAcademicStatus) ||
    getAcademicStatusLabel(record);
  if (academicStatus) return academicStatus;
  if (!record) return "-";
  const score = getEnteredTotalScore(record);
  return score === null ? "-" : formatPerformanceScore(score);
};

const getScoreListCombinedTotalScore = (student: ClassSheetStudent) => {
  if (isClassSheetTransferredStudent(student)) return null;
  const firstScore = student.firstRecord
    ? getEnteredTotalScore(student.firstRecord)
    : null;
  const secondScore = student.secondRecord
    ? getEnteredTotalScore(student.secondRecord)
    : null;
  return firstScore !== null || secondScore !== null
    ? roundScore((firstScore ?? 0) + (secondScore ?? 0))
    : null;
};

const getScoreListCombinedTotalLabel = (student: ClassSheetStudent) => {
  const academicStatus = getClassSheetAcademicStatusLabel(student);
  if (academicStatus) return academicStatus;
  const totalScore = getScoreListCombinedTotalScore(student);
  return totalScore === null ? "-" : formatPerformanceScore(totalScore);
};

const buildCombinedScoreStatsRecord = (
  student: ClassSheetStudent,
  params: {
    year: string;
    semester: string;
    firstRoster?: PerformanceScoreRoster;
    secondRoster?: PerformanceScoreRoster;
    totalMaxScore: number;
  },
): PerformanceScoreRecord | null => {
  const totalScore = getScoreListCombinedTotalScore(student);
  if (totalScore === null) return null;
  const sourceRecord = student.secondRecord || student.firstRecord;
  return {
    id: `${SCORE_LIST_ALL_ROSTERS_VALUE}:${getClassSheetStudentKey(student)}`,
    rosterId: SCORE_LIST_ALL_ROSTERS_VALUE,
    title: "전체 수행평가 총점",
    subject:
      params.firstRoster?.subject ||
      params.secondRoster?.subject ||
      sourceRecord?.subject ||
      "역사",
    academicYear:
      params.firstRoster?.academicYear ||
      params.secondRoster?.academicYear ||
      sourceRecord?.academicYear ||
      params.year,
    semester:
      params.firstRoster?.semester ||
      params.secondRoster?.semester ||
      sourceRecord?.semester ||
      params.semester,
    grade: student.grade,
    class: student.class,
    number: student.number,
    studentName: student.studentName,
    uid: student.uid,
    items: [],
    totalScore,
    totalMaxScore: params.totalMaxScore,
    feedback: "",
    evidence: "",
    sourceFileName: "전체 수행평가 총점",
  };
};

const buildCombinedScoreStatsRecords = (
  students: ClassSheetStudent[],
  params: {
    year: string;
    semester: string;
    firstRoster?: PerformanceScoreRoster;
    secondRoster?: PerformanceScoreRoster;
    totalMaxScore: number;
  },
) =>
  sortPerformanceScoreRecords(
    students
      .map((student) => buildCombinedScoreStatsRecord(student, params))
      .filter((record): record is PerformanceScoreRecord => record !== null),
  );

const formatScoreListSummaryAssessmentLabel = (
  label: string,
  maxScore?: number | null,
) => {
  const formattedMaxScore = formatPerformanceScore(maxScore);
  return formattedMaxScore === "-" ? label : `${label}(${formattedMaxScore})`;
};

const getClassSheetTotalScoreCellValue = (student: ClassSheetStudent) => {
  if (isClassSheetTransferredStudent(student)) {
    return "";
  }
  const firstScore = getScoreNumber(student.firstRecord);
  const secondScore = getScoreNumber(student.secondRecord);
  return firstScore !== null || secondScore !== null
    ? roundScore((firstScore ?? 0) + (secondScore ?? 0))
    : "";
};

const getClassSheetStudentName = (student: ClassSheetStudent) =>
  student.studentName || "(이름 없음)";

const getClassSheetStudentNameWidthUnits = (value: string) =>
  Array.from(value).reduce(
    (sum, character) => sum + (character.charCodeAt(0) <= 0x007f ? 0.85 : 1.35),
    0,
  );

const getFittedClassSheetStudentNameColumnWidth = (
  students: ClassSheetStudent[],
  currentWidth: number,
) => {
  const safeCurrentWidth =
    currentWidth || CLASS_SHEET_STUDENT_NAME_COLUMN_FALLBACK_WIDTH;
  const maxNameWidth = students.reduce(
    (max, student) =>
      Math.max(
        max,
        getClassSheetStudentNameWidthUnits(getClassSheetStudentName(student)),
      ),
    0,
  );
  const fittedWidth = Math.max(
    CLASS_SHEET_STUDENT_NAME_COLUMN_FALLBACK_WIDTH,
    Math.min(
      CLASS_SHEET_STUDENT_NAME_COLUMN_MAX_FIT_WIDTH,
      Math.ceil(maxNameWidth + 0.5),
    ),
  );
  return Math.abs(fittedWidth - safeCurrentWidth) > 0.05
    ? fittedWidth
    : safeCurrentWidth;
};

const getClassSheetStudentNameWidthDelta = (
  nextWidth: number,
  currentWidth: number,
) =>
  Math.max(
    0,
    nextWidth -
      (currentWidth || CLASS_SHEET_STUDENT_NAME_COLUMN_FALLBACK_WIDTH),
  );

const getConfirmedSignatureRecord = (
  student: ClassSheetStudent,
  expected: { requireFirst?: boolean; requireSecond?: boolean } = {},
) => {
  if (isClassSheetTransferredStudent(student)) {
    return (
      [student.secondRecord, student.firstRecord].find((record) =>
        isTransferredScoreRecord(record),
      ) ||
      student.secondRecord ||
      student.firstRecord ||
      null
    );
  }
  const requiredRecords: PerformanceScoreRecord[] = [];
  if (expected.requireFirst) {
    if (!student.firstRecord) return null;
    requiredRecords.push(student.firstRecord);
  } else if (student.firstRecord) {
    requiredRecords.push(student.firstRecord);
  }
  if (expected.requireSecond) {
    if (!student.secondRecord) return null;
    requiredRecords.push(student.secondRecord);
  } else if (student.secondRecord) {
    requiredRecords.push(student.secondRecord);
  }
  if (!requiredRecords.length) return null;
  const allConfirmed = requiredRecords.every(
    (record) => record.signatureImage || record.confirmation?.signatureImage,
  );
  if (!allConfirmed) return null;
  return (
    [...requiredRecords]
      .reverse()
      .find(
        (record) =>
          record.signatureImage || record.confirmation?.signatureImage,
      ) || null
  );
};

const getClassSheetStudentKey = (student: ClassSheetStudent) =>
  getScoreSyncIdentityKeys(student)[0] ||
  getScoreStudentPrimaryIdentityKey(student);

const getRecordScoreId = (record?: PerformanceScoreRecord) =>
  record?.id || record?.rosterId || "";

const clearRecordSignature = (
  record?: PerformanceScoreRecord,
): PerformanceScoreRecord | undefined =>
  record
    ? {
        ...record,
        signatureName: undefined,
        signatureImage: undefined,
        signedAt: undefined,
        confirmation: null,
      }
    : undefined;

const buildClassSummaryWorkbook = (params: {
  year: string;
  semester: string;
  grade: string;
  classValue: string;
  subject: string;
  teacherName: string;
  schoolName?: string;
  printedAt?: Date;
  clientIp?: string;
  firstRoster?: PerformanceScoreRoster;
  secondRoster?: PerformanceScoreRoster;
  students: ClassSheetStudent[];
}) => {
  const rows: unknown[][] = [];

  const row1 = makeExcelRow(18.85);
  row1[11] = plainExcelCell(getTodayLabel(), {
    columnSpan: 5,
    fontSize: 10,
  });
  rows.push(row1);

  const row2 = makeExcelRow(28.05);
  row2[5] = plainExcelCell("수행평가 강의실별 일람표", {
    columnSpan: 10,
    fontSize: 15,
    fontWeight: "bold",
  });
  rows.push(row2);

  const row3 = makeExcelRow(16.55);
  row3[1] = plainExcelCell(
    `${params.year}학년도   ${params.semester}학기   주간   ${params.grade}학년   ${params.classValue} 강의실`,
    { columnSpan: 15, fontWeight: "bold" },
  );
  rows.push(row3);

  const row4 = makeExcelRow(14.1);
  row4[1] = plainExcelCell(`교과목 : ${params.subject || "역사"}`, {
    columnSpan: 8,
    align: "left",
  });
  row4[9] = plainExcelCell(
    `교과담당교사 (${params.teacherName || "방재석"}) 인`,
    { columnSpan: 7 },
  );
  rows.push(row4);

  rows.push(makeExcelRow(6));

  const header = makeExcelRow(42.45);
  setExcelCell(header, 1, "반/번호", {
    columnSpan: 2,
    fontWeight: "bold",
    backgroundColor: "#f1f5f9",
    wrap: true,
  });
  setExcelCell(header, 3, "성명", {
    fontWeight: "bold",
    backgroundColor: "#f1f5f9",
  });
  setExcelCell(
    header,
    4,
    `${params.firstRoster?.title || "고조선 8조법 4컷 만화 그리기"}\n(만점 ${formatPerformanceScore(
      params.firstRoster?.totalMaxScore || 20,
    )})`,
    {
      columnSpan: 2,
      fontWeight: "bold",
      backgroundColor: "#f1f5f9",
      wrap: true,
    },
  );
  setExcelCell(
    header,
    6,
    `${params.secondRoster?.title || "삼국 시대 인물의 무덤에 평점 남기기"}\n(만점 ${formatPerformanceScore(
      params.secondRoster?.totalMaxScore || 30,
    )})`,
    {
      fontWeight: "bold",
      backgroundColor: "#f1f5f9",
      wrap: true,
    },
  );
  setExcelCell(header, 7, "합계", {
    columnSpan: 2,
    fontWeight: "bold",
    backgroundColor: "#f1f5f9",
  });
  setExcelCell(header, 9, "비고", {
    columnSpan: 4,
    fontWeight: "bold",
    backgroundColor: "#f1f5f9",
  });
  rows.push(header);

  const images: Array<{
    content: Blob;
    contentType: string;
    width: number;
    height: number;
    dpi: number;
    anchor: { row: number; column: number };
    offsetX: number;
    offsetY: number;
    title: string;
    description: string;
  }> = [];

  params.students.forEach((student, index) => {
    const excelRowNumber = 7 + index;
    const firstScore = getClassSheetStudentScoreCellValue(
      student,
      student.firstRecord,
    );
    const secondScore = getClassSheetStudentScoreCellValue(
      student,
      student.secondRecord,
    );
    const totalScore = getClassSheetTotalScoreCellValue(student);
    const row = makeExcelRow(18);
    setExcelCell(row, 1, `${student.class}/${student.number}`, {
      columnSpan: 2,
    });
    setExcelCell(row, 3, getClassSheetStudentName(student), {
      align: "center",
      wrap: false,
    });
    setExcelCell(row, 4, firstScore ?? "", { columnSpan: 2 });
    setExcelCell(row, 6, secondScore ?? "");
    setExcelCell(row, 7, totalScore, { columnSpan: 2 });
    setExcelCell(row, 9, "", { columnSpan: 4 });
    rows.push(row);

    const signatureRecord = getConfirmedSignatureRecord(student, {
      requireFirst: Boolean(params.firstRoster),
      requireSecond: Boolean(params.secondRoster),
    });
    const signatureImage =
      signatureRecord?.signatureImage ||
      signatureRecord?.confirmation?.signatureImage ||
      "";
    if (signatureImage) {
      images.push({
        content: dataUrlToBlob(signatureImage),
        contentType: "image/png",
        width: 76,
        height: 22,
        dpi: 96,
        anchor: { row: excelRowNumber, column: 10 },
        offsetX: 18,
        offsetY: 0,
        title: `${student.studentName} 서명`,
        description: `${student.studentName} 수행평가 점수 확인 서명`,
      });
    }
  });

  const firstScores = params.students
    .map((student) => getClassSheetSummaryScore(student, student.firstRecord))
    .filter((score): score is number => score !== null);
  const secondScores = params.students
    .map((student) => getClassSheetSummaryScore(student, student.secondRecord))
    .filter((score): score is number => score !== null);
  const firstSum = roundScore(
    firstScores.reduce((sum, score) => sum + score, 0),
  );
  const secondSum = roundScore(
    secondScores.reduce((sum, score) => sum + score, 0),
  );

  const countRow = makeExcelRow(18);
  setExcelCell(countRow, 1, "응시생수", {
    columnSpan: 3,
    fontWeight: "bold",
  });
  setExcelCell(countRow, 4, `${firstScores.length} 명`, { columnSpan: 2 });
  setExcelCell(countRow, 6, `${secondScores.length} 명`);
  rows.push(countRow);

  const sumRow = makeExcelRow(18);
  setExcelCell(sumRow, 1, "총점", { columnSpan: 3, fontWeight: "bold" });
  setExcelCell(sumRow, 4, firstSum, { columnSpan: 2 });
  setExcelCell(sumRow, 6, secondSum);
  setExcelCell(sumRow, 7, roundScore(firstSum + secondSum), { columnSpan: 2 });
  rows.push(sumRow);

  const averageRow = makeExcelRow(18);
  setExcelCell(averageRow, 1, "평균", { columnSpan: 3, fontWeight: "bold" });
  setExcelCell(
    averageRow,
    4,
    firstScores.length ? roundScore(firstSum / firstScores.length) : "",
    {
      columnSpan: 2,
    },
  );
  setExcelCell(
    averageRow,
    6,
    secondScores.length ? roundScore(secondSum / secondScores.length) : "",
  );
  const totalAverage =
    firstScores.length || secondScores.length
      ? roundScore(
          (firstSum + secondSum) /
            Math.max(firstScores.length, secondScores.length, 1),
        )
      : "";
  setExcelCell(averageRow, 7, totalAverage, { columnSpan: 2 });
  rows.push(averageRow);

  rows.push(makeExcelRow(120 - CLASS_SHEET_PRINT_INFO_ROW_HEIGHT));

  const footer = makeExcelRow(18);
  footer[8] = plainExcelCell(1, { columnSpan: 2 });
  footer[10] = plainExcelCell("/", { columnSpan: 2 });
  footer[12] = plainExcelCell(1, { columnSpan: 2 });
  footer[14] = plainExcelCell(params.schoolName || CLASS_SHEET_SCHOOL_NAME, {
    columnSpan: 2,
  });
  rows.push(footer);

  const printInfoFooter = makeExcelRow(CLASS_SHEET_PRINT_INFO_ROW_HEIGHT);
  printInfoFooter[CLASS_SHEET_PRINT_INFO_START_COLUMN - 1] = plainExcelCell(
    getClassSheetPrintInfoText(params),
    {
      columnSpan:
        CLASS_SHEET_PRINT_INFO_END_COLUMN -
        CLASS_SHEET_PRINT_INFO_START_COLUMN +
        1,
      align: "right",
      alignVertical: "top",
      fontFamily: CLASS_SHEET_PRINT_INFO_FONT_NAME,
      fontSize: CLASS_SHEET_PRINT_INFO_FONT_SIZE,
    },
  );
  rows.push(printInfoFooter);

  return { rows, images };
};

const setWorksheetCellValue = (
  worksheet: { getCell: (row: number, column: number) => { value: unknown } },
  row: number,
  column: number,
  value: string | number | null,
) => {
  worksheet.getCell(row, column).value = value;
};

const setClassSheetStudentNameCell = (
  worksheet: {
    getCell: (
      row: number,
      column: number,
    ) => { value: unknown; alignment?: unknown };
  },
  row: number,
  value: string,
) => {
  const cell = worksheet.getCell(row, CLASS_SHEET_STUDENT_NAME_COLUMN);
  cell.value = value;
  const currentAlignment =
    cell.alignment && typeof cell.alignment === "object" ? cell.alignment : {};
  cell.alignment = {
    ...(currentAlignment as Record<string, unknown>),
    horizontal: "center",
    vertical: "middle",
    wrapText: false,
  };
};

const centerClassSheetStudentNameHeader = (worksheet: {
  getCell: (
    row: number,
    column: number,
  ) => { value: unknown; alignment?: unknown };
}) => {
  const cell = worksheet.getCell(
    CLASS_SHEET_STUDENT_NAME_HEADER_ROW,
    CLASS_SHEET_STUDENT_NAME_COLUMN,
  );
  const currentAlignment =
    cell.alignment && typeof cell.alignment === "object" ? cell.alignment : {};
  cell.alignment = {
    ...(currentAlignment as Record<string, unknown>),
    horizontal: "center",
    vertical: "middle",
    wrapText: false,
  };
};

type ClassSheetBorderSide = { style?: string; color?: unknown };
type ClassSheetCellStyle = {
  style?: unknown;
  alignment?: unknown;
  border?: {
    left?: ClassSheetBorderSide;
    right?: ClassSheetBorderSide;
    top?: ClassSheetBorderSide;
    bottom?: ClassSheetBorderSide;
    diagonal?: unknown;
  };
};

const createClassSheetThinBorderSide = (): ClassSheetBorderSide => ({
  style: "hair",
  color: { indexed: 0 },
});

const cloneClassSheetBorder = (border: ClassSheetCellStyle["border"]) =>
  JSON.parse(JSON.stringify(border || {})) as NonNullable<
    ClassSheetCellStyle["border"]
  >;

const cloneClassSheetCellStyle = (style: ClassSheetCellStyle["style"]) =>
  JSON.parse(JSON.stringify(style || {})) as NonNullable<
    ClassSheetCellStyle["style"]
  >;

const setClassSheetCellHorizontalAlignment = (
  worksheet: {
    getCell: (row: number, column: number) => ClassSheetCellStyle;
  },
  row: number,
  column: number,
  horizontal: "left" | "center" | "right",
) => {
  const cell = worksheet.getCell(row, column);
  const currentAlignment =
    cell.alignment && typeof cell.alignment === "object" ? cell.alignment : {};
  cell.alignment = {
    ...(currentAlignment as Record<string, unknown>),
    horizontal,
    vertical: "middle",
  };
};

const setClassSheetCellBorder = (
  worksheet: {
    getCell: (row: number, column: number) => ClassSheetCellStyle;
  },
  row: number,
  column: number,
  border: ClassSheetCellStyle["border"],
) => {
  const cell = worksheet.getCell(row, column);
  cell.style = cloneClassSheetCellStyle(cell.style);
  cell.border = {
    ...cloneClassSheetBorder(cell.border),
    ...cloneClassSheetBorder(border),
  };
};

const applyClassSheetNiceStyleAdjustments = (
  worksheet: {
    getCell: (row: number, column: number) => ClassSheetCellStyle;
  },
  studentEndRow: number,
  summaryEndRow: number,
) => {
  setClassSheetCellHorizontalAlignment(worksheet, 3, 2, "left");
  setClassSheetCellHorizontalAlignment(worksheet, 4, 2, "left");

  const horizontalEndRow = Math.max(
    CLASS_SHEET_INTERNAL_HORIZONTAL_START_ROW,
    studentEndRow,
  );

  for (
    let row = CLASS_SHEET_INTERNAL_HORIZONTAL_START_ROW;
    row <= horizontalEndRow;
    row += 1
  ) {
    for (
      let column = CLASS_SHEET_INTERNAL_HORIZONTAL_START_COLUMN;
      column <= CLASS_SHEET_INTERNAL_HORIZONTAL_END_COLUMN;
      column += 1
    ) {
      const border: ClassSheetCellStyle["border"] = {};
      if (row > CLASS_SHEET_INTERNAL_HORIZONTAL_START_ROW) {
        border.top = createClassSheetThinBorderSide();
      }
      if (row < horizontalEndRow) {
        border.bottom = createClassSheetThinBorderSide();
      }
      if (border.top || border.bottom) {
        setClassSheetCellBorder(worksheet, row, column, border);
      }
    }
  }

  for (
    let row = CLASS_SHEET_INTERNAL_VERTICAL_START_ROW;
    row <= Math.max(CLASS_SHEET_INTERNAL_VERTICAL_START_ROW, summaryEndRow);
    row += 1
  ) {
    setClassSheetCellBorder(
      worksheet,
      row,
      CLASS_SHEET_INTERNAL_VERTICAL_LEFT_COLUMN,
      { right: createClassSheetThinBorderSide() },
    );
    setClassSheetCellBorder(
      worksheet,
      row,
      CLASS_SHEET_INTERNAL_VERTICAL_RIGHT_COLUMN,
      { left: createClassSheetThinBorderSide() },
    );
  }
};

const shrinkClassSheetRightSpacerColumns = (
  worksheet: { getColumn: (column: number) => { width?: number } },
  widthDelta: number,
) => {
  let remainingDelta = Math.max(0, widthDelta);
  CLASS_SHEET_RIGHT_SPACER_COLUMNS.forEach(({ column, minWidth }) => {
    if (remainingDelta <= 0) return;
    const worksheetColumn = worksheet.getColumn(column);
    const currentWidth = Number(worksheetColumn.width || 0);
    const shrinkableWidth = Math.max(0, currentWidth - minWidth);
    const nextShrink = Math.min(remainingDelta, shrinkableWidth);
    if (nextShrink <= 0) return;
    worksheetColumn.width = Number((currentWidth - nextShrink).toFixed(3));
    remainingDelta = Number((remainingDelta - nextShrink).toFixed(3));
  });
};

const cloneWorksheetStyle = (style: unknown) =>
  JSON.parse(JSON.stringify(style || {}));

type WorksheetMergeRange = {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
};

type WorksheetInternalMerge = {
  model?: {
    top?: number;
    left?: number;
    bottom?: number;
    right?: number;
  };
};

type WorksheetMergeModel = {
  model?: { merges?: string[] };
  _merges?: Record<string, WorksheetInternalMerge>;
  unMergeCells?: (range: string) => void;
};

const getWorksheetColumnNumber = (columnName: string) =>
  columnName
    .toUpperCase()
    .split("")
    .reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);

const getWorksheetColumnName = (columnNumber: number) => {
  let value = Math.floor(columnNumber);
  let columnName = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    columnName = String.fromCharCode(65 + remainder) + columnName;
    value = Math.floor((value - 1) / 26);
  }
  return columnName;
};

const parseWorksheetCellRef = (cellRef: string) => {
  const match = /^([A-Z]+)(\d+)$/i.exec(cellRef.trim());
  if (!match) return null;
  return {
    row: Number(match[2]),
    column: getWorksheetColumnNumber(match[1]),
  };
};

const parseWorksheetRange = (range: string): WorksheetMergeRange | null => {
  const [startRef, endRef = startRef] = range.split(":");
  const start = parseWorksheetCellRef(startRef);
  const end = parseWorksheetCellRef(endRef);
  if (!start || !end) return null;
  return {
    startRow: Math.min(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endRow: Math.max(start.row, end.row),
    endColumn: Math.max(start.column, end.column),
  };
};

const worksheetRangesOverlap = (
  first: WorksheetMergeRange,
  second: WorksheetMergeRange,
) =>
  first.startRow <= second.endRow &&
  first.endRow >= second.startRow &&
  first.startColumn <= second.endColumn &&
  first.endColumn >= second.startColumn;

const parseWorksheetInternalMergeRange = (
  merge: WorksheetInternalMerge,
): WorksheetMergeRange | null => {
  const top = Number(merge.model?.top);
  const left = Number(merge.model?.left);
  const bottom = Number(merge.model?.bottom);
  const right = Number(merge.model?.right);
  if (![top, left, bottom, right].every(Number.isFinite)) return null;
  return {
    startRow: Math.min(top, bottom),
    startColumn: Math.min(left, right),
    endRow: Math.max(top, bottom),
    endColumn: Math.max(left, right),
  };
};

const formatWorksheetRange = (range: WorksheetMergeRange) =>
  `${getWorksheetColumnName(range.startColumn)}${range.startRow}:${getWorksheetColumnName(
    range.endColumn,
  )}${range.endRow}`;

const unmergeWorksheetRange = (
  worksheet: WorksheetMergeModel,
  range: string,
) => {
  const targetRange = parseWorksheetRange(range);
  const mergeRanges = Array.isArray(worksheet.model?.merges)
    ? [...worksheet.model.merges]
    : [];

  if (targetRange) {
    mergeRanges.forEach((mergeRange) => {
      const parsedMergeRange = parseWorksheetRange(mergeRange);
      if (
        parsedMergeRange &&
        worksheetRangesOverlap(targetRange, parsedMergeRange)
      ) {
        try {
          worksheet.unMergeCells?.(mergeRange);
        } catch {
          // ExcelJS may already have cleared the merge while row operations shift.
        }
      }
    });

    Object.entries(worksheet._merges || {}).forEach(([mergeKey, merge]) => {
      const parsedMergeRange = parseWorksheetInternalMergeRange(merge);
      if (
        parsedMergeRange &&
        worksheetRangesOverlap(targetRange, parsedMergeRange)
      ) {
        try {
          worksheet.unMergeCells?.(formatWorksheetRange(parsedMergeRange));
        } catch {
          // Some shifted template merges remain only in ExcelJS' internal map.
        }
        if (worksheet._merges) {
          delete worksheet._merges[mergeKey];
        }
      }
    });
  }

  try {
    worksheet.unMergeCells?.(range);
  } catch {
    // The range may already be unmerged after ExcelJS row insertion.
  }
};

const resetWorksheetRowMerge = (
  worksheet: {
    mergeCells: (
      startRow: number,
      startColumn: number,
      endRow: number,
      endColumn: number,
    ) => void;
    unMergeCells?: (range: string) => void;
  },
  row: number,
  startColumn: number,
  endColumn: number,
  range: string,
) => {
  unmergeWorksheetRange(worksheet, range);
  worksheet.mergeCells(row, startColumn, row, endColumn);
};

const resizeClassSheetStudentRows = (
  worksheet: {
    getRow: (row: number) => {
      height?: number;
      getCell: (column: number) => { style: unknown };
    };
    insertRows: (row: number, values: unknown[], style?: string) => void;
    spliceRows: (start: number, count: number) => void;
    mergeCells: (
      startRow: number,
      startColumn: number,
      endRow: number,
      endColumn: number,
    ) => void;
    unMergeCells?: (range: string) => void;
  },
  studentCount: number,
) => {
  const templateCapacity =
    CLASS_SHEET_STUDENT_END_ROW - CLASS_SHEET_STUDENT_START_ROW + 1;
  const rowDelta = studentCount - templateCapacity;

  const sourceRow = worksheet.getRow(CLASS_SHEET_STUDENT_END_ROW);

  if (rowDelta > 0) {
    worksheet.insertRows(
      CLASS_SHEET_SUMMARY_START_ROW,
      Array.from({ length: rowDelta }, () => []),
      "i",
    );

    for (let index = 0; index < rowDelta; index += 1) {
      const row = CLASS_SHEET_SUMMARY_START_ROW + index;
      const targetRow = worksheet.getRow(row);
      targetRow.height = sourceRow.height;
      for (
        let column = 1;
        column <= CLASS_SHEET_TEMPLATE_COLUMN_COUNT;
        column += 1
      ) {
        targetRow.getCell(column).style = cloneWorksheetStyle(
          sourceRow.getCell(column).style,
        );
      }
    }
  } else if (rowDelta < 0) {
    worksheet.spliceRows(
      CLASS_SHEET_STUDENT_START_ROW + studentCount,
      Math.abs(rowDelta),
    );
  }

  const studentEndRow = CLASS_SHEET_STUDENT_START_ROW + studentCount - 1;
  const summaryStartRow = CLASS_SHEET_SUMMARY_START_ROW + rowDelta;

  for (
    let row = CLASS_SHEET_STUDENT_START_ROW;
    row <= studentEndRow;
    row += 1
  ) {
    unmergeWorksheetRange(worksheet, `B${row}:D${row}`);
    resetWorksheetRowMerge(worksheet, row, 5, 6, `E${row}:F${row}`);
    resetWorksheetRowMerge(worksheet, row, 8, 9, `H${row}:I${row}`);
    resetWorksheetRowMerge(worksheet, row, 10, 13, `J${row}:M${row}`);
  }

  for (let index = 0; index < 3; index += 1) {
    const row = summaryStartRow + index;
    resetWorksheetRowMerge(worksheet, row, 2, 4, `B${row}:D${row}`);
    resetWorksheetRowMerge(worksheet, row, 5, 6, `E${row}:F${row}`);
    resetWorksheetRowMerge(worksheet, row, 8, 9, `H${row}:I${row}`);
    resetWorksheetRowMerge(worksheet, row, 10, 13, `J${row}:M${row}`);
  }

  return { studentEndRow, summaryStartRow };
};

const resetClassSheetFooter = (
  worksheet: {
    getCell: (
      row: number,
      column: number,
    ) => { value: unknown; alignment?: unknown };
    mergeCells: (
      startRow: number,
      startColumn: number,
      endRow: number,
      endColumn: number,
    ) => void;
    unMergeCells?: (range: string) => void;
  },
  footerRow: number,
  schoolName = CLASS_SHEET_SCHOOL_NAME,
) => {
  [
    `I${footerRow}:N${footerRow}`,
    `I${footerRow}:J${footerRow}`,
    `K${footerRow}:L${footerRow}`,
    `M${footerRow}:N${footerRow}`,
    `O${footerRow}:P${footerRow}`,
  ].forEach((range) => unmergeWorksheetRange(worksheet, range));
  for (
    let column = CLASS_SHEET_FOOTER_PAGE_FIRST_START_COLUMN;
    column <= CLASS_SHEET_FOOTER_SCHOOL_END_COLUMN;
    column += 1
  ) {
    setWorksheetCellValue(worksheet, footerRow, column, null);
  }

  worksheet.mergeCells(
    footerRow,
    CLASS_SHEET_FOOTER_PAGE_FIRST_START_COLUMN,
    footerRow,
    CLASS_SHEET_FOOTER_PAGE_FIRST_END_COLUMN,
  );
  worksheet.mergeCells(
    footerRow,
    CLASS_SHEET_FOOTER_PAGE_SLASH_START_COLUMN,
    footerRow,
    CLASS_SHEET_FOOTER_PAGE_SLASH_END_COLUMN,
  );
  worksheet.mergeCells(
    footerRow,
    CLASS_SHEET_FOOTER_PAGE_LAST_START_COLUMN,
    footerRow,
    CLASS_SHEET_FOOTER_PAGE_LAST_END_COLUMN,
  );
  worksheet.mergeCells(
    footerRow,
    CLASS_SHEET_FOOTER_SCHOOL_START_COLUMN,
    footerRow,
    CLASS_SHEET_FOOTER_SCHOOL_END_COLUMN,
  );

  [
    { column: CLASS_SHEET_FOOTER_PAGE_FIRST_START_COLUMN, value: 1 },
    { column: CLASS_SHEET_FOOTER_PAGE_SLASH_START_COLUMN, value: "/" },
    { column: CLASS_SHEET_FOOTER_PAGE_LAST_START_COLUMN, value: 1 },
  ].forEach(({ column, value }) => {
    const cell = worksheet.getCell(footerRow, column);
    cell.value = value;
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
  });

  const schoolCell = worksheet.getCell(
    footerRow,
    CLASS_SHEET_FOOTER_SCHOOL_START_COLUMN,
  );
  schoolCell.value = schoolName;
  schoolCell.alignment = {
    horizontal: "right",
    vertical: "middle",
    wrapText: true,
  };
};

const resetClassSheetPrintInfoFooter = (
  worksheet: {
    getCell: (
      row: number,
      column: number,
    ) => {
      value: unknown;
      alignment?: unknown;
      font?: unknown;
    };
    getRow: (row: number) => { height?: number };
    mergeCells: (
      startRow: number,
      startColumn: number,
      endRow: number,
      endColumn: number,
    ) => void;
    unMergeCells?: (range: string) => void;
  },
  footerRow: number,
  printInfoText: string,
) => {
  const printInfoRow = Math.max(
    footerRow + 1,
    CLASS_SHEET_PRINT_INFO_MIN_ROW,
  );
  const spacerRow = worksheet.getRow(footerRow - 1);
  const spacerHeight = Number(spacerRow.height || 0);
  if (spacerHeight > CLASS_SHEET_PRINT_INFO_ROW_HEIGHT) {
    spacerRow.height = spacerHeight - CLASS_SHEET_PRINT_INFO_ROW_HEIGHT;
  }

  for (let row = footerRow + 1; row < printInfoRow; row += 1) {
    worksheet.getRow(row).height = CLASS_SHEET_PRINT_INFO_SPACER_ROW_HEIGHT;
    unmergeWorksheetRange(worksheet, `H${row}:P${row}`);
    for (
      let column = CLASS_SHEET_PRINT_INFO_START_COLUMN;
      column <= CLASS_SHEET_PRINT_INFO_END_COLUMN;
      column += 1
    ) {
      setWorksheetCellValue(worksheet, row, column, null);
    }
  }

  unmergeWorksheetRange(worksheet, `H${printInfoRow}:P${printInfoRow}`);
  for (
    let column = CLASS_SHEET_PRINT_INFO_START_COLUMN;
    column <= CLASS_SHEET_PRINT_INFO_END_COLUMN;
    column += 1
  ) {
    setWorksheetCellValue(worksheet, printInfoRow, column, null);
  }

  worksheet.getRow(printInfoRow).height = CLASS_SHEET_PRINT_INFO_ROW_HEIGHT;
  worksheet.mergeCells(
    printInfoRow,
    CLASS_SHEET_PRINT_INFO_START_COLUMN,
    printInfoRow,
    CLASS_SHEET_PRINT_INFO_END_COLUMN,
  );

  const cell = worksheet.getCell(
    printInfoRow,
    CLASS_SHEET_PRINT_INFO_START_COLUMN,
  );
  cell.value = printInfoText;
  cell.alignment = {
    horizontal: "right",
    vertical: "top",
    shrinkToFit: true,
    wrapText: false,
  };
  cell.font = {
    name: CLASS_SHEET_PRINT_INFO_FONT_NAME,
    size: CLASS_SHEET_PRINT_INFO_FONT_SIZE,
  };
};

const joinUrlPath = (base: string, path: string) =>
  `${base.replace(/\/?$/, "/")}${path.replace(/^\/+/, "")}`;

const getClassSheetTemplateUrls = () => {
  const basePath = joinUrlPath(
    import.meta.env.BASE_URL || "/",
    CLASS_SHEET_TEMPLATE_PATH,
  );
  const rootPath = `/${CLASS_SHEET_TEMPLATE_PATH}`;

  if (typeof window === "undefined") {
    return Array.from(new Set([basePath, rootPath]));
  }

  return Array.from(
    new Set(
      [rootPath, basePath].map(
        (path) => new URL(path, window.location.origin).href,
      ),
    ),
  );
};

const fetchClassSheetTemplate = async () => {
  const errors: string[] = [];
  for (const url of getClassSheetTemplateUrls()) {
    try {
      const response = await fetch(url, { cache: "no-cache" });
      if (response.ok) return response;
      errors.push(`${url}: ${response.status}`);
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : error}`);
    }
  }
  throw new Error(`class-sheet-template-not-found:${errors.join(", ")}`);
};

const normalizeClassSheetSignatureImage = (signatureImage: string) => {
  const trimmed = String(signatureImage || "").trim();
  if (!trimmed) return "";
  if (/^data:image\/png;base64,/i.test(trimmed)) return trimmed;
  if (/^[A-Za-z0-9+/]+=*$/.test(trimmed)) {
    return `data:image/png;base64,${trimmed}`;
  }
  return "";
};

const getClassSheetSignatureBase64Payload = (dataUrl: string) =>
  (dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl).replace(/\s/g, "");

const decodeClassSheetSignatureHeader = (dataUrl: string) => {
  if (typeof window === "undefined" || typeof window.atob !== "function") {
    return "";
  }
  try {
    return window.atob(
      getClassSheetSignatureBase64Payload(dataUrl).slice(0, 96),
    );
  } catch {
    return "";
  }
};

const getClassSheetSignaturePngDimensions = (dataUrl: string) => {
  const header = decodeClassSheetSignatureHeader(dataUrl);
  if (header.length < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((code, index) => header.charCodeAt(index) !== code)) {
    return null;
  }
  const readUInt32 = (offset: number) =>
    header.charCodeAt(offset) * 0x1000000 +
    header.charCodeAt(offset + 1) * 0x10000 +
    header.charCodeAt(offset + 2) * 0x100 +
    header.charCodeAt(offset + 3);
  const width = readUInt32(16);
  const height = readUInt32(20);
  return width > 0 && height > 0 ? { width, height } : null;
};

const getClassSheetColumnPixelWidth = (width?: number) => {
  if (!Number.isFinite(width) || !width || width <= 0) {
    return CLASS_SHEET_SIGNATURE_COLUMN_PIXEL_WIDTH;
  }
  return Math.max(1, Math.round(width * 7 + 5));
};

const getClassSheetSignatureCellPixelWidth = (worksheet: {
  getColumn: (column: number) => { width?: number };
}) => {
  let width = 0;
  for (
    let column = CLASS_SHEET_SIGNATURE_START_COLUMN_INDEX;
    column <= CLASS_SHEET_SIGNATURE_END_COLUMN_INDEX;
    column += 1
  ) {
    width += getClassSheetColumnPixelWidth(worksheet.getColumn(column).width);
  }
  return width || CLASS_SHEET_SIGNATURE_IMAGE_MAX_WIDTH;
};

const getClassSheetColumnPositionByPixelOffset = (
  worksheet: { getColumn: (column: number) => { width?: number } },
  startColumn: number,
  endColumn: number,
  pixelOffset: number,
) => {
  let remainingOffset = Math.max(0, pixelOffset);
  for (let column = startColumn; column <= endColumn; column += 1) {
    const columnWidth = getClassSheetColumnPixelWidth(
      worksheet.getColumn(column).width,
    );
    if (remainingOffset <= columnWidth) {
      return column - 1 + remainingOffset / columnWidth;
    }
    remainingOffset -= columnWidth;
  }
  return endColumn - 1;
};

const getClassSheetSignatureImageSize = (
  dataUrl: string,
  maxWidth = CLASS_SHEET_SIGNATURE_IMAGE_MAX_WIDTH,
  maxHeight = CLASS_SHEET_SIGNATURE_IMAGE_MAX_HEIGHT,
) => {
  const dimensions = getClassSheetSignaturePngDimensions(dataUrl);
  const sourceWidth = dimensions?.width || maxWidth;
  const sourceHeight = dimensions?.height || maxHeight;
  const ratio = sourceWidth / sourceHeight;
  const maxRatio = maxWidth / maxHeight;

  if (!Number.isFinite(ratio) || ratio <= 0) {
    return {
      width: maxWidth,
      height: maxHeight,
    };
  }

  if (ratio > maxRatio) {
    return {
      width: maxWidth,
      height: Math.max(1, maxWidth / ratio),
    };
  }

  return {
    width: Math.max(1, maxHeight * ratio),
    height: maxHeight,
  };
};

const getClassSheetSignatureImagePosition = (
  worksheet: { getColumn: (column: number) => { width?: number } },
  row: number,
  dataUrl: string,
) => {
  const cellWidth = getClassSheetSignatureCellPixelWidth(worksheet);
  const maxWidth = Math.min(
    CLASS_SHEET_SIGNATURE_IMAGE_MAX_WIDTH,
    Math.max(1, cellWidth - CLASS_SHEET_SIGNATURE_CELL_HORIZONTAL_PADDING * 2),
  );
  const size = getClassSheetSignatureImageSize(
    dataUrl,
    maxWidth,
    CLASS_SHEET_SIGNATURE_IMAGE_MAX_HEIGHT,
  );
  const horizontalCenterOffset = Math.max(0, cellWidth - size.width) / 2;
  const verticalCenterOffset =
    Math.max(0, CLASS_SHEET_SIGNATURE_IMAGE_MAX_HEIGHT - size.height) /
    2 /
    CLASS_SHEET_SIGNATURE_ROW_PIXEL_HEIGHT;

  return {
    tl: {
      col: getClassSheetColumnPositionByPixelOffset(
        worksheet,
        CLASS_SHEET_SIGNATURE_START_COLUMN_INDEX,
        CLASS_SHEET_SIGNATURE_END_COLUMN_INDEX,
        horizontalCenterOffset,
      ),
      row:
        row - 1 + CLASS_SHEET_SIGNATURE_VERTICAL_PADDING + verticalCenterOffset,
    },
    ext: size,
    editAs: "oneCell",
  };
};

const trimClassSheetSignatureImage = async (dataUrl: string) => {
  if (typeof document === "undefined") return dataUrl;

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("signature-image-load-failed"));
      element.src = dataUrl;
    });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) return dataUrl;

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) return dataUrl;
    sourceContext.drawImage(image, 0, 0, width, height);

    const pixels = sourceContext.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = pixels[(y * width + x) * 4 + 3];
        if (alpha <= CLASS_SHEET_SIGNATURE_ALPHA_THRESHOLD) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < 0 || maxY < 0) return dataUrl;
    const croppedWidth = maxX - minX + 1;
    const croppedHeight = maxY - minY + 1;
    const croppedCanvas = document.createElement("canvas");
    croppedCanvas.width = croppedWidth;
    croppedCanvas.height = croppedHeight;
    const croppedContext = croppedCanvas.getContext("2d");
    if (!croppedContext) return dataUrl;
    croppedContext.drawImage(
      sourceCanvas,
      minX,
      minY,
      croppedWidth,
      croppedHeight,
      0,
      0,
      croppedWidth,
      croppedHeight,
    );

    const outputWidth = croppedWidth * CLASS_SHEET_SIGNATURE_CANVAS_SCALE;
    const outputHeight = croppedHeight * CLASS_SHEET_SIGNATURE_CANVAS_SCALE;
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outputContext = outputCanvas.getContext("2d");
    if (!outputContext) return croppedCanvas.toDataURL("image/png");

    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = "high";
    const drawWidth = outputWidth;
    const drawHeight = outputHeight;

    outputContext.globalCompositeOperation = "source-over";
    outputContext.globalAlpha = 0.72;
    [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ].forEach(([offsetX, offsetY]) => {
      outputContext.drawImage(
        croppedCanvas,
        offsetX,
        offsetY,
        drawWidth,
        drawHeight,
      );
    });
    outputContext.globalAlpha = 1;
    outputContext.drawImage(croppedCanvas, 0, 0, drawWidth, drawHeight);

    return outputCanvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
};

const buildClassSummaryWorkbookFromTemplate = async (params: {
  year: string;
  semester: string;
  grade: string;
  classValue: string;
  subject: string;
  teacherName: string;
  schoolName?: string;
  printedAt?: Date;
  clientIp?: string;
  firstRoster?: PerformanceScoreRoster;
  secondRoster?: PerformanceScoreRoster;
  students: ClassSheetStudent[];
}) => {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const response = await fetchClassSheetTemplate();
  await workbook.xlsx.load(await response.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("class-sheet-template-empty");
  const studentNameColumn = worksheet.getColumn(
    CLASS_SHEET_STUDENT_NAME_COLUMN,
  );
  studentNameColumn.alignment = {
    ...(studentNameColumn.alignment || {}),
    horizontal: "center",
    vertical: "middle",
    wrapText: false,
  };
  studentNameColumn.width = CLASS_SHEET_STUDENT_NAME_COLUMN_WIDTH;
  const { studentEndRow, summaryStartRow } = resizeClassSheetStudentRows(
    worksheet,
    params.students.length,
  );
  const footerRow = summaryStartRow + 4;
  resetClassSheetFooter(
    worksheet,
    footerRow,
    params.schoolName || CLASS_SHEET_SCHOOL_NAME,
  );
  resetClassSheetPrintInfoFooter(
    worksheet,
    footerRow,
    getClassSheetPrintInfoText(params),
  );
  centerClassSheetStudentNameHeader(worksheet);

  setWorksheetCellValue(worksheet, 1, 12, getTodayLabel());
  setWorksheetCellValue(worksheet, 2, 6, "수행평가 강의실별 일람표");
  setWorksheetCellValue(
    worksheet,
    3,
    2,
    `${params.year}학년도   ${params.semester}학기   주간   ${params.grade}학년   ${params.classValue} 강의실`,
  );
  setWorksheetCellValue(
    worksheet,
    4,
    2,
    `교과목 : ${params.subject || "역사"}`,
  );
  setWorksheetCellValue(
    worksheet,
    4,
    10,
    `교과담당교사 (${params.teacherName || "방재석"}) 인`,
  );
  applyClassSheetNiceStyleAdjustments(
    worksheet,
    studentEndRow,
    summaryStartRow + 2,
  );
  for (
    let row = CLASS_SHEET_STUDENT_START_ROW;
    row <= studentEndRow;
    row += 1
  ) {
    [2, 3, 4, 5, 7, 8, 10].forEach((column) =>
      setWorksheetCellValue(worksheet, row, column, null),
    );
  }

  const imagesToAdd: Array<{
    row: number;
    dataUrl: string;
    title: string;
    description: string;
  }> = [];
  for (const [index, student] of params.students.entries()) {
    const row = CLASS_SHEET_STUDENT_START_ROW + index;
    const firstScore = getClassSheetStudentScoreCellValue(
      student,
      student.firstRecord,
    );
    const secondScore = getClassSheetStudentScoreCellValue(
      student,
      student.secondRecord,
    );
    const totalScore = getClassSheetTotalScoreCellValue(student);
    setWorksheetCellValue(
      worksheet,
      row,
      2,
      `${student.class}/${student.number}`,
    );
    setWorksheetCellValue(worksheet, row, 3, "");
    setClassSheetStudentNameCell(
      worksheet,
      row,
      getClassSheetStudentName(student),
    );
    setWorksheetCellValue(worksheet, row, 5, firstScore ?? "");
    setWorksheetCellValue(worksheet, row, 7, secondScore ?? "");
    setWorksheetCellValue(worksheet, row, 8, totalScore);

    const signatureRecord = getConfirmedSignatureRecord(student, {
      requireFirst: Boolean(params.firstRoster),
      requireSecond: Boolean(params.secondRoster),
    });
    const signatureImage =
      signatureRecord?.signatureImage ||
      signatureRecord?.confirmation?.signatureImage ||
      "";
    const signatureImageDataUrl =
      normalizeClassSheetSignatureImage(signatureImage);
    if (signatureImageDataUrl) {
      const trimmedSignatureImageDataUrl = await trimClassSheetSignatureImage(
        signatureImageDataUrl,
      );
      imagesToAdd.push({
        row,
        dataUrl: trimmedSignatureImageDataUrl,
        title: `${student.studentName} 서명`,
        description: `${student.studentName} 수행평가 점수 확인 서명`,
      });
    } else if (signatureImage) {
      console.warn("Skipping invalid class sheet signature image:", {
        row,
        studentName: student.studentName,
      });
    }
  }

  const firstScores = params.students
    .map((student) => getClassSheetSummaryScore(student, student.firstRecord))
    .filter((score): score is number => score !== null);
  const secondScores = params.students
    .map((student) => getClassSheetSummaryScore(student, student.secondRecord))
    .filter((score): score is number => score !== null);
  const firstSum = roundScore(
    firstScores.reduce((sum, score) => sum + score, 0),
  );
  const secondSum = roundScore(
    secondScores.reduce((sum, score) => sum + score, 0),
  );
  const summaryRow = summaryStartRow;
  setWorksheetCellValue(worksheet, summaryRow, 5, `${firstScores.length} 명`);
  setWorksheetCellValue(worksheet, summaryRow, 7, `${secondScores.length} 명`);
  setWorksheetCellValue(worksheet, summaryRow + 1, 5, firstSum);
  setWorksheetCellValue(worksheet, summaryRow + 1, 7, secondSum);
  setWorksheetCellValue(
    worksheet,
    summaryRow + 1,
    8,
    roundScore(firstSum + secondSum),
  );
  setWorksheetCellValue(
    worksheet,
    summaryRow + 2,
    5,
    firstScores.length ? roundScore(firstSum / firstScores.length) : "",
  );
  setWorksheetCellValue(
    worksheet,
    summaryRow + 2,
    7,
    secondScores.length ? roundScore(secondSum / secondScores.length) : "",
  );
  setWorksheetCellValue(
    worksheet,
    summaryRow + 2,
    8,
    firstScores.length || secondScores.length
      ? roundScore(
          (firstSum + secondSum) /
            Math.max(firstScores.length, secondScores.length, 1),
        )
      : "",
  );

  imagesToAdd.forEach((image) => {
    const imageId = workbook.addImage({
      base64: image.dataUrl,
      extension: "png",
    });
    worksheet.addImage(imageId, {
      ...getClassSheetSignatureImagePosition(
        worksheet,
        image.row,
        image.dataUrl,
      ),
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME_TYPE });
};

const PerformanceScoreManager: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { config, currentUser } = useAuth();
  const { showToast } = useAppToast();
  const { confirm, prompt: promptDialog } = useAppDialog();
  const { year, semester } = getYearSemester(config);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [targetGrade, setTargetGrade] = useState("3");
  const [fallbackClass, setFallbackClass] = useState("");
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentLoadError, setStudentLoadError] = useState("");
  const [parsed, setParsed] = useState<ParsedUpload | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rosters, setRosters] = useState<PerformanceScoreRoster[]>([]);
  const [rostersLoading, setRostersLoading] = useState(true);
  const [deletingRosterId, setDeletingRosterId] = useState("");
  const [scoreWarningSettings, setScoreWarningSettings] =
    useState<PerformanceScoreSettings>(() =>
      normalizePerformanceScoreSettings(),
    );
  const [scoreWarningDraft, setScoreWarningDraft] = useState(
    DEFAULT_PERFORMANCE_SCORE_WARNING_TEXT,
  );
  const [scoreWarningLoading, setScoreWarningLoading] = useState(true);
  const [scoreWarningSaving, setScoreWarningSaving] = useState(false);
  const [scoreWarningModalOpen, setScoreWarningModalOpen] = useState(false);
  const [previewClassFilter, setPreviewClassFilter] = useState("all");
  const [previewPage, setPreviewPage] = useState(1);
  const [assessmentPreset, setAssessmentPreset] =
    useState<AssessmentPresetKey>("auto");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadAssessmentPreset, setUploadAssessmentPreset] =
    useState<UploadAssessmentPresetKey>("first");
  const [scoreListRosterId, setScoreListRosterId] = useState(
    SCORE_LIST_ALL_ROSTERS_VALUE,
  );
  const [scoreListLoadedRosterId, setScoreListLoadedRosterId] = useState("");
  const [scoreListGradeFilter, setScoreListGradeFilter] = useState("all");
  const [scoreListClassFilter, setScoreListClassFilter] = useState("all");
  const [scoreListClassPage, setScoreListClassPage] = useState(1);
  const [scoreListSearch, setScoreListSearch] = useState("");
  const [scoreListRecords, setScoreListRecords] = useState<ScoreListRecord[]>(
    [],
  );
  const [scoreListSummaryStudents, setScoreListSummaryStudents] = useState<
    ClassSheetStudent[]
  >([]);
  const [scoreListSummaryLoadedKey, setScoreListSummaryLoadedKey] =
    useState("");
  const [scoreListLoading, setScoreListLoading] = useState(false);
  const [scoreListLoadError, setScoreListLoadError] = useState("");
  const [scoreEditing, setScoreEditing] = useState(false);
  const [scoreEditOriginalRecords, setScoreEditOriginalRecords] = useState<
    ScoreListRecord[]
  >([]);
  const [selectedScoreListRecordKeys, setSelectedScoreListRecordKeys] =
    useState<Set<string>>(() => new Set<string>());
  const scoreListSelectAllRef = useRef<HTMLInputElement | null>(null);
  const scoreDocumentSyncCheckedKeysRef = useRef<Set<string>>(
    new Set<string>(),
  );
  const scoreDocumentSyncRunRef = useRef(0);
  const rosterStudentLinkRepairKeyRef = useRef("");
  const [savingScoreEdits, setSavingScoreEdits] = useState(false);
  const [scoreStatsModalOpen, setScoreStatsModalOpen] = useState(false);
  const [scoreStatsRecords, setScoreStatsRecords] = useState<
    PerformanceScoreRecord[]
  >([]);
  const [scoreStatsLoadedRosterId, setScoreStatsLoadedRosterId] = useState("");
  const [scoreStatsLoading, setScoreStatsLoading] = useState(false);
  const [scoreStatsClassFilter, setScoreStatsClassFilter] = useState("");
  const [scoreStatsMode, setScoreStatsMode] = useState<ScoreStatsMode>("all");
  const [objectionModalOpen, setObjectionModalOpen] = useState(false);
  const [objections, setObjections] = useState<PerformanceScoreObjection[]>([]);
  const [objectionsLoading, setObjectionsLoading] = useState(false);
  const [objectionsLoaded, setObjectionsLoaded] = useState(false);
  const [objectionsAutoLoadAttempted, setObjectionsAutoLoadAttempted] =
    useState(false);
  const [objectionReviewingAction, setObjectionReviewingAction] = useState<{
    id: string;
    status: PerformanceScoreObjectionReviewAction;
  } | null>(null);
  const [scoreListSort, setScoreListSort] = useState<
    SortState<ScoreListSortKey>
  >({ key: "number", direction: "asc" });
  const [classStatsSort, setClassStatsSort] = useState<
    SortState<ClassStatsSortKey>
  >({ key: "class", direction: "asc" });
  const [classSheetModalOpen, setClassSheetModalOpen] = useState(false);
  const [classSheetFirstRosterId, setClassSheetFirstRosterId] = useState("");
  const [classSheetSecondRosterId, setClassSheetSecondRosterId] = useState("");
  const [classSheetGradeFilter, setClassSheetGradeFilter] =
    useState(targetGrade);
  const [classSheetClassFilter, setClassSheetClassFilter] = useState("");
  const [classSheetPreviewStudents, setClassSheetPreviewStudents] = useState<
    ClassSheetStudent[]
  >([]);
  const [classSheetPreviewLoading, setClassSheetPreviewLoading] =
    useState(false);
  const [classSheetPreviewLoadedKey, setClassSheetPreviewLoadedKey] =
    useState("");
  const [rejectingSignatureKey, setRejectingSignatureKey] = useState("");
  const [exportingClassSheet, setExportingClassSheet] = useState(false);

  useEffect(() => {
    setTitle(`${year}학년도 ${semester}학기 수행평가 점수`);
  }, [year, semester]);

  useEffect(() => {
    void loadStudents();
  }, []);

  useEffect(() => {
    scoreDocumentSyncCheckedKeysRef.current.clear();
    scoreDocumentSyncRunRef.current += 1;
    void loadRosters();
  }, [year, semester]);

  useEffect(() => {
    void loadScoreWarningSettings();
  }, [year, semester]);

  useEffect(() => {
    setScoreListRosterId((current) => {
      if (
        current === SCORE_LIST_ALL_ROSTERS_VALUE ||
        (current && rosters.some((roster) => roster.id === current))
      ) {
        return current;
      }
      return rosters.length > 0 ? SCORE_LIST_ALL_ROSTERS_VALUE : "";
    });
  }, [rosters]);

  useEffect(() => {
    if (!parsed || students.length === 0) return;
    setParsed((current) =>
      current
        ? {
            ...current,
            rows: matchRowsToStudents(current.rows, students),
          }
        : current,
    );
  }, [students.length]);

  useEffect(() => {
    setPreviewPage(1);
  }, [previewClassFilter, parsed?.sourceFileName]);

  useEffect(() => {
    setScoreListClassPage(1);
  }, [
    scoreListClassFilter,
    scoreListGradeFilter,
    scoreListLoadedRosterId,
    scoreListSearch,
  ]);

  useEffect(() => {
    setSelectedScoreListRecordKeys((current) => {
      if (!scoreEditing) return current.size ? new Set<string>() : current;
      const recordKeys = new Set(scoreListRecords.map(getScoreListRecordKey));
      const next = new Set(
        Array.from(current).filter((key) => recordKeys.has(key)),
      );
      return next.size === current.size ? current : next;
    });
  }, [scoreEditing, scoreListRecords]);

  useEffect(() => {
    setScoreListSort({ key: "number", direction: "asc" });
    setClassStatsSort({ key: "class", direction: "asc" });
  }, [scoreListLoadedRosterId]);

  useEffect(() => {
    setObjections([]);
    setObjectionsLoaded(false);
    setObjectionsAutoLoadAttempted(false);
  }, [year, semester]);

  useEffect(() => {
    setClassSheetPreviewStudents([]);
    setClassSheetPreviewLoadedKey("");
  }, [
    classSheetFirstRosterId,
    classSheetSecondRosterId,
    classSheetGradeFilter,
    classSheetClassFilter,
  ]);

  const firstAssessmentRosterOptions = useMemo(
    () => rosters.filter((roster) => getRosterAssessmentOrder(roster) === 1),
    [rosters],
  );
  const secondAssessmentRosterOptions = useMemo(
    () => rosters.filter((roster) => getRosterAssessmentOrder(roster) === 2),
    [rosters],
  );

  const rosterCollectionPath = getSemesterCollectionPath(
    { year, semester },
    PERFORMANCE_SCORE_ROSTERS_COLLECTION,
  );
  const objectionCollectionPath = getSemesterCollectionPath(
    { year, semester },
    PERFORMANCE_SCORE_OBJECTIONS_COLLECTION,
  );
  const rosterStudentLinkRepairKey = useMemo(() => {
    const studentKey = students
      .map(
        (student) =>
          `${student.uid}:${student.grade}:${student.class}:${student.number}:${normalizeStudentName(
            student.name,
          )}`,
      )
      .sort()
      .join("|");
    const rosterKey = rosters
      .map((roster) => {
        const repairableRows = (roster.rows || [])
          .filter((row) => rosterRowHasScore(row))
          .map(
            (row) =>
              `${row.rowNumber}:${row.uid}:${row.grade}:${row.class}:${row.number}:${normalizeStudentName(
                row.studentName,
              )}`,
          )
          .join(",");
        return `${roster.id}:${repairableRows}`;
      })
      .sort()
      .join("|");
    return `${year}:${semester}:${studentKey}:${rosterKey}`;
  }, [rosters, semester, students, year]);

  const parsedSummary = useMemo(() => {
    const rows = parsed?.rows || [];
    const matchedCount = rows.filter((row) => row.uid).length;
    const scoredCount = rows.filter((row) => row.enteredScoreCount > 0).length;
    const saveableCount = rows.filter(
      (row) => row.uid && row.enteredScoreCount > 0,
    ).length;
    const blankScoreCount = rows.filter(
      (row) => row.enteredScoreCount === 0,
    ).length;
    const warningCount = rows.filter(
      (row) => row.matchStatus === "name-mismatch",
    ).length;
    return {
      rowCount: rows.length,
      matchedCount,
      scoredCount,
      saveableCount,
      blankScoreCount,
      unmatchedCount: rows.length - matchedCount,
      warningCount,
    };
  }, [parsed]);

  const filteredPreviewRows = useMemo(() => {
    const rows = parsed?.rows || [];
    return previewClassFilter === "all"
      ? rows
      : rows.filter((row) => row.class === previewClassFilter);
  }, [parsed, previewClassFilter]);

  const previewClassFiltered = previewClassFilter !== "all";
  const previewTotalPages = previewClassFiltered
    ? 1
    : Math.max(1, Math.ceil(filteredPreviewRows.length / PREVIEW_PAGE_SIZE));
  const safePreviewPage = previewClassFiltered
    ? 1
    : Math.min(Math.max(1, previewPage), previewTotalPages);
  const previewStartIndex = previewClassFiltered
    ? 0
    : (safePreviewPage - 1) * PREVIEW_PAGE_SIZE;
  const previewRows = previewClassFiltered
    ? filteredPreviewRows
    : filteredPreviewRows.slice(
        previewStartIndex,
        previewStartIndex + PREVIEW_PAGE_SIZE,
      );
  const previewRangeLabel = filteredPreviewRows.length
    ? previewClassFiltered
      ? `1-${filteredPreviewRows.length}`
      : `${previewStartIndex + 1}-${Math.min(
          previewStartIndex + PREVIEW_PAGE_SIZE,
          filteredPreviewRows.length,
        )}`
    : "0";
  const previewPageItems = useMemo(
    () =>
      previewClassFiltered
        ? []
        : getPreviewPageItems(safePreviewPage, previewTotalPages),
    [previewClassFiltered, safePreviewPage, previewTotalPages],
  );

  const selectedScoreRoster = useMemo(
    () => rosters.find((roster) => roster.id === scoreListRosterId) || null,
    [rosters, scoreListRosterId],
  );
  const scoreListAllSelected =
    scoreListRosterId === SCORE_LIST_ALL_ROSTERS_VALUE;
  const scoreListSummaryRosters = useMemo(
    () => ({
      firstRoster: firstAssessmentRosterOptions[0],
      secondRoster: secondAssessmentRosterOptions[0],
    }),
    [firstAssessmentRosterOptions, secondAssessmentRosterOptions],
  );
  const scoreListSummaryLoadKey = [
    SCORE_LIST_ALL_ROSTERS_VALUE,
    scoreListSummaryRosters.firstRoster?.id || "",
    scoreListSummaryRosters.secondRoster?.id || "",
  ].join(":");
  const scoreListSummaryCacheReady =
    scoreListSummaryLoadedKey === scoreListSummaryLoadKey;
  const firstScoreListSummaryMaxScore = getFiniteNumber(
    scoreListSummaryRosters.firstRoster?.totalMaxScore,
  );
  const secondScoreListSummaryMaxScore = getFiniteNumber(
    scoreListSummaryRosters.secondRoster?.totalMaxScore,
  );
  const combinedScoreListSummaryMaxScore =
    firstScoreListSummaryMaxScore !== null ||
    secondScoreListSummaryMaxScore !== null
      ? roundScore(
          (firstScoreListSummaryMaxScore ?? 0) +
            (secondScoreListSummaryMaxScore ?? 0),
        )
      : null;
  const firstScoreListSummaryHeader = formatScoreListSummaryAssessmentLabel(
    SCORE_LIST_FIRST_SUMMARY_LABEL,
    firstScoreListSummaryMaxScore,
  );
  const secondScoreListSummaryHeader = formatScoreListSummaryAssessmentLabel(
    SCORE_LIST_SECOND_SUMMARY_LABEL,
    secondScoreListSummaryMaxScore,
  );
  const combinedScoreListSummaryHeader = formatScoreListSummaryAssessmentLabel(
    "수행평가 총점",
    combinedScoreListSummaryMaxScore,
  );
  const scoreStatsFirstRoster = scoreListSummaryRosters.firstRoster;
  const scoreStatsSecondRoster = scoreListSummaryRosters.secondRoster;
  const scoreStatsSelectedRoster =
    scoreStatsMode === "first"
      ? scoreStatsFirstRoster
      : scoreStatsMode === "second"
        ? scoreStatsSecondRoster
        : null;
  const scoreStatsAllSelected = scoreStatsMode === "all";
  const scoreStatsSelectionReady =
    scoreStatsMode === "all"
      ? Boolean(scoreStatsFirstRoster && scoreStatsSecondRoster)
      : Boolean(scoreStatsSelectedRoster);
  const scoreStatsAnyAvailable = Boolean(
    (scoreStatsFirstRoster && scoreStatsSecondRoster) ||
    scoreStatsFirstRoster ||
    scoreStatsSecondRoster,
  );
  const scoreStatsLoadKey =
    scoreStatsMode === "all"
      ? scoreListSummaryLoadKey
      : [scoreStatsMode, scoreStatsSelectedRoster?.id || ""].join(":");
  const scoreStatsTitle =
    scoreStatsMode === "all"
      ? combinedScoreListSummaryHeader
      : scoreStatsMode === "first"
        ? firstScoreListSummaryHeader
        : secondScoreListSummaryHeader;
  const scoreStatsTotalMaxScore =
    scoreStatsMode === "all"
      ? combinedScoreListSummaryMaxScore
      : scoreStatsSelectedRoster?.totalMaxScore;
  const scoreStatsModeOptions: Array<{
    mode: ScoreStatsMode;
    label: string;
    disabled: boolean;
  }> = [
    {
      mode: "all",
      label: "전체",
      disabled: !(scoreStatsFirstRoster && scoreStatsSecondRoster),
    },
    {
      mode: "first",
      label: `1차 ${SCORE_LIST_FIRST_SUMMARY_LABEL}`,
      disabled: !scoreStatsFirstRoster,
    },
    {
      mode: "second",
      label: `2차 ${SCORE_LIST_SECOND_SUMMARY_LABEL}`,
      disabled: !scoreStatsSecondRoster,
    },
  ];

  useEffect(() => {
    setClassSheetFirstRosterId((current) => {
      if (
        current &&
        firstAssessmentRosterOptions.some((roster) => roster.id === current)
      ) {
        return current;
      }
      if (
        selectedScoreRoster &&
        getRosterAssessmentOrder(selectedScoreRoster) === 1
      ) {
        return selectedScoreRoster.id;
      }
      return firstAssessmentRosterOptions[0]?.id || "";
    });
  }, [firstAssessmentRosterOptions, selectedScoreRoster]);

  useEffect(() => {
    setClassSheetSecondRosterId((current) => {
      if (
        current &&
        secondAssessmentRosterOptions.some((roster) => roster.id === current)
      ) {
        return current;
      }
      if (
        selectedScoreRoster &&
        getRosterAssessmentOrder(selectedScoreRoster) === 2
      ) {
        return selectedScoreRoster.id;
      }
      return secondAssessmentRosterOptions[0]?.id || "";
    });
  }, [secondAssessmentRosterOptions, selectedScoreRoster]);

  const scoreListGradeOptions = useMemo(() => {
    const values = new Set<string>();
    rosters.forEach((roster) => {
      if (roster.targetGrade) values.add(roster.targetGrade);
      (roster.rows || []).forEach((row) => {
        if (row.grade) values.add(row.grade);
      });
    });
    return Array.from(values).sort(
      (a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"),
    );
  }, [rosters]);
  const scoreListClassOptions = useMemo(() => {
    const values = new Set<string>();
    const sourceRosters = scoreListAllSelected
      ? [
          scoreListSummaryRosters.firstRoster,
          scoreListSummaryRosters.secondRoster,
        ]
      : [selectedScoreRoster];
    sourceRosters.filter(Boolean).forEach((roster) => {
      (roster?.classes || []).forEach((classValue) => {
        if (classValue) values.add(classValue);
      });
      (roster?.rows || []).forEach((row) => {
        if (row.class) values.add(row.class);
      });
    });
    return Array.from(values).sort(
      (a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"),
    );
  }, [scoreListAllSelected, scoreListSummaryRosters, selectedScoreRoster]);
  const scoreListReady =
    !scoreListAllSelected &&
    !!selectedScoreRoster &&
    scoreListLoadedRosterId === selectedScoreRoster.id;
  const scoreListSummaryReady =
    scoreListAllSelected &&
    scoreListLoadedRosterId === SCORE_LIST_ALL_ROSTERS_VALUE &&
    scoreListSummaryCacheReady;
  const scoreListSearchKey = useMemo(
    () => normalizeStudentName(scoreListSearch).toLocaleLowerCase(),
    [scoreListSearch],
  );
  const scoreListSearchActive = scoreListSearchKey.length > 0;
  const scoreListBaseRecords = useMemo(() => {
    if (!scoreListReady) return [];
    return scoreListRecords.filter((record) => {
      const gradeMatched =
        scoreListGradeFilter === "all" ||
        normalizeSchoolValue(record.grade) ===
          normalizeSchoolValue(scoreListGradeFilter);
      const identityKey = normalizeStudentName(
        `${record.studentName} ${record.class}반 ${record.number}번`,
      ).toLocaleLowerCase();
      const searchMatched =
        !scoreListSearchActive || identityKey.includes(scoreListSearchKey);
      return gradeMatched && searchMatched;
    });
  }, [
    scoreListGradeFilter,
    scoreListReady,
    scoreListRecords,
    scoreListSearchActive,
    scoreListSearchKey,
  ]);
  const scoreListSummaryBaseStudents = useMemo(() => {
    if (!scoreListSummaryReady) return [];
    return scoreListSummaryStudents.filter((student) => {
      const gradeMatched =
        scoreListGradeFilter === "all" ||
        normalizeSchoolValue(student.grade) ===
          normalizeSchoolValue(scoreListGradeFilter);
      const identityKey = normalizeStudentName(
        `${student.studentName} ${student.class}반 ${student.number}번`,
      ).toLocaleLowerCase();
      const searchMatched =
        !scoreListSearchActive || identityKey.includes(scoreListSearchKey);
      return gradeMatched && searchMatched;
    });
  }, [
    scoreListGradeFilter,
    scoreListSearchActive,
    scoreListSearchKey,
    scoreListSummaryReady,
    scoreListSummaryStudents,
  ]);
  const scoreListClassPageOptions = useMemo(() => {
    if (scoreListSearchActive) return [];
    if (scoreListClassFilter !== "all") return [scoreListClassFilter];
    const values = new Set<string>();
    const sourceRows = scoreListSummaryReady
      ? scoreListSummaryBaseStudents
      : scoreListBaseRecords;
    sourceRows.forEach((record) => {
      if (record.class) values.add(record.class);
    });
    return Array.from(values).sort(
      (a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"),
    );
  }, [
    scoreListBaseRecords,
    scoreListClassFilter,
    scoreListSearchActive,
    scoreListSummaryBaseStudents,
    scoreListSummaryReady,
  ]);
  const scoreListClassTotalPages = Math.max(
    1,
    scoreListClassPageOptions.length,
  );
  const safeScoreListClassPage = Math.min(
    Math.max(1, scoreListClassPage),
    scoreListClassTotalPages,
  );
  const activeScoreListClass = scoreListSearchActive
    ? ""
    : scoreListClassFilter !== "all"
      ? scoreListClassFilter
      : scoreListClassPageOptions[safeScoreListClassPage - 1] || "";
  const filteredScoreListRecords = useMemo(() => {
    if (!scoreListReady) return [];
    if (scoreListSearchActive) {
      if (scoreListClassFilter === "all") return scoreListBaseRecords;
      return scoreListBaseRecords.filter(
        (record) =>
          normalizeSchoolValue(record.class) ===
          normalizeSchoolValue(scoreListClassFilter),
      );
    }
    if (!scoreListReady || !activeScoreListClass) return [];
    return scoreListBaseRecords.filter(
      (record) =>
        normalizeSchoolValue(record.class) ===
        normalizeSchoolValue(activeScoreListClass),
    );
  }, [
    activeScoreListClass,
    scoreListBaseRecords,
    scoreListClassFilter,
    scoreListReady,
    scoreListSearchActive,
  ]);
  const filteredScoreListSummaryStudents = useMemo(() => {
    if (scoreListSearchActive) {
      if (!scoreListSummaryReady) return [];
      if (scoreListClassFilter === "all") return scoreListSummaryBaseStudents;
      return scoreListSummaryBaseStudents.filter(
        (student) =>
          normalizeSchoolValue(student.class) ===
          normalizeSchoolValue(scoreListClassFilter),
      );
    }
    if (!scoreListSummaryReady || !activeScoreListClass) return [];
    return scoreListSummaryBaseStudents.filter(
      (student) =>
        normalizeSchoolValue(student.class) ===
        normalizeSchoolValue(activeScoreListClass),
    );
  }, [
    activeScoreListClass,
    scoreListClassFilter,
    scoreListSearchActive,
    scoreListSummaryBaseStudents,
    scoreListSummaryReady,
  ]);
  const sortedFilteredScoreListRecords = useMemo(
    () => sortScoreListRecords(filteredScoreListRecords, scoreListSort),
    [filteredScoreListRecords, scoreListSort],
  );
  const visibleScoreListRecordKeys = useMemo(
    () => sortedFilteredScoreListRecords.map(getScoreListRecordKey),
    [sortedFilteredScoreListRecords],
  );
  const selectedVisibleScoreListRecordKeys = useMemo(() => {
    const selected = new Set<string>();
    visibleScoreListRecordKeys.forEach((key) => {
      if (selectedScoreListRecordKeys.has(key)) selected.add(key);
    });
    return selected;
  }, [selectedScoreListRecordKeys, visibleScoreListRecordKeys]);
  const selectedScoreListRecordCount = selectedVisibleScoreListRecordKeys.size;
  const visibleScoreListRecordsSelected =
    visibleScoreListRecordKeys.length > 0 &&
    visibleScoreListRecordKeys.every((key) =>
      selectedScoreListRecordKeys.has(key),
    );
  const visibleScoreListRecordsPartiallySelected =
    !visibleScoreListRecordsSelected &&
    visibleScoreListRecordKeys.some((key) =>
      selectedScoreListRecordKeys.has(key),
    );

  useEffect(() => {
    if (!scoreEditing) return;
    const visibleKeys = new Set(visibleScoreListRecordKeys);
    setSelectedScoreListRecordKeys((current) => {
      const next = new Set(
        Array.from(current).filter((key) => visibleKeys.has(key)),
      );
      return next.size === current.size ? current : next;
    });
  }, [scoreEditing, visibleScoreListRecordKeys]);

  useEffect(() => {
    if (!scoreListSelectAllRef.current) return;
    scoreListSelectAllRef.current.indeterminate =
      visibleScoreListRecordsPartiallySelected;
  }, [visibleScoreListRecordsPartiallySelected]);

  const scoreStatsFallbackRecords = useMemo(() => {
    if (scoreStatsAllSelected) {
      const summaryStudents = scoreListSummaryCacheReady
        ? scoreListSummaryStudents
        : scoreStatsFirstRoster && scoreStatsSecondRoster
          ? buildScoreListSummaryStudents(
              buildScoreListRecordsFromRosterRows(scoreStatsFirstRoster),
              buildScoreListRecordsFromRosterRows(scoreStatsSecondRoster),
            )
          : [];
      return buildCombinedScoreStatsRecords(summaryStudents, {
        year,
        semester,
        firstRoster: scoreStatsFirstRoster,
        secondRoster: scoreStatsSecondRoster,
        totalMaxScore: combinedScoreListSummaryMaxScore ?? 0,
      });
    }
    if (!scoreStatsSelectedRoster) return [];
    return (scoreStatsSelectedRoster.rows || [])
      .filter((row) => rosterRowHasScore(row))
      .map((row) => buildRecordFromRosterRow(scoreStatsSelectedRoster, row));
  }, [
    combinedScoreListSummaryMaxScore,
    scoreListSummaryCacheReady,
    scoreListSummaryStudents,
    scoreStatsAllSelected,
    scoreStatsFirstRoster,
    scoreStatsSecondRoster,
    scoreStatsSelectedRoster,
    semester,
    year,
  ]);
  const scoreStatsCombinedStudents = useMemo(() => {
    if (!scoreStatsAllSelected) return [];
    if (scoreListSummaryCacheReady) return scoreListSummaryStudents;
    if (!scoreStatsFirstRoster || !scoreStatsSecondRoster) return [];
    return buildScoreListSummaryStudents(
      buildScoreListRecordsFromRosterRows(scoreStatsFirstRoster),
      buildScoreListRecordsFromRosterRows(scoreStatsSecondRoster),
    );
  }, [
    scoreListSummaryCacheReady,
    scoreListSummaryStudents,
    scoreStatsAllSelected,
    scoreStatsFirstRoster,
    scoreStatsSecondRoster,
  ]);
  const scoreStatsRecordsReady =
    !!scoreStatsLoadKey && scoreStatsLoadedRosterId === scoreStatsLoadKey;
  const scoreStatsSourceRecords = useMemo(() => {
    if (scoreStatsRecordsReady) return scoreStatsRecords;
    if (
      scoreStatsAllSelected &&
      scoreListSummaryCacheReady &&
      scoreListSummaryStudents.length > 0
    ) {
      return scoreStatsFallbackRecords;
    }
    if (
      !scoreStatsAllSelected &&
      scoreListReady &&
      scoreStatsSelectedRoster &&
      scoreListLoadedRosterId === scoreStatsSelectedRoster.id &&
      scoreListRecords.length > 0
    ) {
      return scoreListRecords;
    }
    return scoreStatsFallbackRecords;
  }, [
    scoreListLoadedRosterId,
    scoreListReady,
    scoreListRecords,
    scoreListSummaryCacheReady,
    scoreListSummaryStudents.length,
    scoreStatsFallbackRecords,
    scoreStatsAllSelected,
    scoreStatsRecords,
    scoreStatsRecordsReady,
    scoreStatsSelectedRoster,
  ]);
  const scoreStatsClassOptions = useMemo(() => {
    const values = new Set<string>();
    const sourceRosters = scoreStatsAllSelected
      ? [scoreStatsFirstRoster, scoreStatsSecondRoster]
      : [scoreStatsSelectedRoster];
    sourceRosters.filter(Boolean).forEach((roster) => {
      (roster?.classes || []).forEach((classValue) => {
        const normalized = normalizeSchoolValue(classValue);
        if (normalized) values.add(normalized);
      });
      (roster?.rows || []).forEach((row) => {
        const normalized = normalizeSchoolValue(row.class);
        if (normalized) values.add(normalized);
      });
    });
    scoreStatsSourceRecords.forEach((record) => {
      const normalized = normalizeSchoolValue(record.class);
      if (normalized) values.add(normalized);
    });
    return Array.from(values).sort(compareSchoolValue);
  }, [
    scoreStatsAllSelected,
    scoreStatsFirstRoster,
    scoreStatsSecondRoster,
    scoreStatsSelectedRoster,
    scoreStatsSourceRecords,
  ]);
  const scoreStatsClassOptionsKey = scoreStatsClassOptions.join("|");

  useEffect(() => {
    setScoreStatsClassFilter((current) => {
      if (current && scoreStatsClassOptions.includes(current)) return current;
      if (
        scoreListClassFilter !== "all" &&
        scoreStatsClassOptions.includes(scoreListClassFilter)
      ) {
        return scoreListClassFilter;
      }
      if (
        activeScoreListClass &&
        scoreStatsClassOptions.includes(activeScoreListClass)
      ) {
        return activeScoreListClass;
      }
      return scoreStatsClassOptions[0] || "";
    });
  }, [activeScoreListClass, scoreListClassFilter, scoreStatsClassOptionsKey]);

  const scoreStatsSelectedRecords = useMemo(() => {
    if (!scoreStatsClassFilter) return [];
    return scoreStatsSourceRecords.filter(
      (record) =>
        normalizeSchoolValue(record.class) ===
        normalizeSchoolValue(scoreStatsClassFilter),
    );
  }, [scoreStatsClassFilter, scoreStatsSourceRecords]);
  const scoreStats = useMemo(() => {
    const totalMaxScore = getSummaryMaxScore(
      scoreStatsSourceRecords,
      scoreStatsTotalMaxScore,
    );
    const overall = buildScoreSummary(scoreStatsSourceRecords, totalMaxScore);
    const selected = buildScoreSummary(
      scoreStatsSelectedRecords,
      totalMaxScore,
    );
    const selectedDifference =
      selected.average !== null && overall.average !== null
        ? roundScore(selected.average - overall.average)
        : null;
    const byClass = new Map<string, PerformanceScoreRecord[]>();
    scoreStatsSourceRecords.forEach((record) => {
      const classValue = normalizeSchoolValue(record.class);
      if (!classValue) return;
      byClass.set(classValue, [...(byClass.get(classValue) || []), record]);
    });
    const classSummaries = Array.from(byClass.entries()).map(
      ([classValue, records]) => {
        const summary = buildScoreSummary(records, totalMaxScore);
        return {
          ...summary,
          classValue,
          difference:
            summary.average !== null && overall.average !== null
              ? roundScore(summary.average - overall.average)
              : null,
        };
      },
    );
    const sortedClassSummaries = sortClassScoreSummaries(
      classSummaries,
      classStatsSort,
    );
    const itemSummaries: ItemScoreSummary[] = (
      scoreStatsAllSelected ? [] : scoreStatsSelectedRoster?.items || []
    ).map((item, index) => {
      const itemMaxScore = getSummaryMaxScore(
        [],
        getFiniteNumber(item.maxScore) || 0,
      );
      const itemOverall = buildItemScoreSummary(
        scoreStatsSourceRecords,
        index,
        itemMaxScore,
      );
      const itemSelected = buildItemScoreSummary(
        scoreStatsSelectedRecords,
        index,
        itemMaxScore,
      );
      return {
        index,
        label: getItemLabel(item),
        name: item.name,
        maxScore: itemMaxScore,
        overall: itemOverall,
        selected: itemSelected,
        difference:
          itemSelected.average !== null && itemOverall.average !== null
            ? roundScore(itemSelected.average - itemOverall.average)
            : null,
      };
    });
    const getBucketCount = (
      records: PerformanceScoreRecord[],
      bucket: (typeof SCORE_DISTRIBUTION_BUCKETS)[number],
    ) =>
      records.filter((record) => {
        const score = getEnteredTotalScore(record);
        const recordMaxScore = getRecordTotalMaxScore(record) || totalMaxScore;
        if (score === null || recordMaxScore <= 0) return false;
        const percent = (score / recordMaxScore) * 100;
        return percent >= bucket.min && percent < bucket.max;
      }).length;
    const distribution = SCORE_DISTRIBUTION_BUCKETS.map((bucket) => ({
      ...bucket,
      overallCount: getBucketCount(scoreStatsSourceRecords, bucket),
      selectedCount: getBucketCount(scoreStatsSelectedRecords, bucket),
    }));
    const maxDistributionCount = Math.max(
      1,
      ...distribution.flatMap((bucket) => [
        bucket.overallCount,
        bucket.selectedCount,
      ]),
    );
    const overallCurve = buildNormalCurveSummary(
      scoreStatsSourceRecords,
      totalMaxScore,
    );
    const selectedCurve = buildNormalCurveSummary(
      scoreStatsSelectedRecords,
      totalMaxScore,
    );
    const maxCurveDensity = Math.max(
      0,
      ...overallCurve.points.map((point) => point.y),
      ...selectedCurve.points.map((point) => point.y),
    );
    return {
      totalMaxScore,
      overall,
      selected,
      selectedDifference,
      classSummaries: sortedClassSummaries,
      assessmentContributions: scoreStatsAllSelected
        ? buildAssessmentContributionSummaries(scoreStatsCombinedStudents, {
            firstMaxScore: firstScoreListSummaryMaxScore ?? 0,
            secondMaxScore: secondScoreListSummaryMaxScore ?? 0,
          })
        : [],
      itemSummaries,
      distribution,
      maxDistributionCount,
      normalCurve: {
        overall: overallCurve,
        selected: selectedCurve,
        maxDensity: maxCurveDensity,
      },
    };
  }, [
    classStatsSort,
    scoreStatsAllSelected,
    scoreStatsCombinedStudents,
    scoreStatsSelectedRecords,
    scoreStatsSelectedRoster,
    scoreStatsSourceRecords,
    scoreStatsTotalMaxScore,
    firstScoreListSummaryMaxScore,
    secondScoreListSummaryMaxScore,
  ]);
  const objectionSummary = useMemo(
    () => ({
      total: objections.length,
      pending: objections.filter((item) => item.status === "pending").length,
      accepted: objections.filter((item) => item.status === "accepted").length,
      rejected: objections.filter((item) => item.status === "rejected").length,
    }),
    [objections],
  );
  const summaryExportRosters = useMemo(() => {
    return {
      firstRoster:
        rosters.find((roster) => roster.id === classSheetFirstRosterId) ||
        undefined,
      secondRoster:
        rosters.find((roster) => roster.id === classSheetSecondRosterId) ||
        undefined,
    };
  }, [classSheetFirstRosterId, classSheetSecondRosterId, rosters]);
  const classSheetGradeOptions = useMemo(() => {
    const values = new Set<string>();
    if (targetGrade) values.add(targetGrade);
    [summaryExportRosters.firstRoster, summaryExportRosters.secondRoster]
      .filter(Boolean)
      .forEach((roster) => {
        if (roster?.targetGrade) values.add(roster.targetGrade);
        (roster?.rows || []).forEach((row) => {
          if (row.grade) values.add(row.grade);
        });
      });
    return Array.from(values).sort(
      (a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"),
    );
  }, [summaryExportRosters, targetGrade]);
  const classSheetClassOptions = useMemo(() => {
    const values = new Set<string>();
    [summaryExportRosters.firstRoster, summaryExportRosters.secondRoster]
      .filter(Boolean)
      .forEach((roster) => {
        (roster?.classes || []).forEach((classValue) => {
          if (classValue) values.add(classValue);
        });
        (roster?.rows || []).forEach((row) => {
          if (row.class) values.add(row.class);
        });
      });
    return Array.from(values).sort(
      (a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"),
    );
  }, [summaryExportRosters]);
  const classSheetSelectionKey = [
    classSheetFirstRosterId,
    classSheetSecondRosterId,
    classSheetGradeFilter,
    classSheetClassFilter,
  ].join("|");
  const classSheetPreviewReady =
    !!classSheetPreviewLoadedKey &&
    classSheetPreviewLoadedKey === classSheetSelectionKey;
  const classSheetSignatureRequirements = useMemo(
    () => ({
      requireFirst: Boolean(summaryExportRosters.firstRoster),
      requireSecond: Boolean(summaryExportRosters.secondRoster),
    }),
    [summaryExportRosters],
  );
  const classSheetStatusSummary = useMemo(() => {
    const firstScoredCount = classSheetPreviewStudents.filter(
      (student) =>
        getClassSheetSummaryScore(student, student.firstRecord) !== null,
    ).length;
    const secondScoredCount = classSheetPreviewStudents.filter(
      (student) =>
        getClassSheetSummaryScore(student, student.secondRecord) !== null,
    ).length;
    const signedCount = classSheetPreviewStudents.filter((student) =>
      getConfirmedSignatureRecord(student, classSheetSignatureRequirements),
    ).length;
    return {
      totalCount: classSheetPreviewStudents.length,
      firstScoredCount,
      secondScoredCount,
      signedCount,
      unsignedCount: Math.max(
        0,
        classSheetPreviewStudents.length - signedCount,
      ),
    };
  }, [classSheetPreviewStudents, classSheetSignatureRequirements]);

  useEffect(() => {
    setClassSheetGradeFilter((current) =>
      current && classSheetGradeOptions.includes(current)
        ? current
        : classSheetGradeOptions[0] || targetGrade,
    );
  }, [classSheetGradeOptions, targetGrade]);

  useEffect(() => {
    setClassSheetClassFilter((current) =>
      current && classSheetClassOptions.includes(current)
        ? current
        : classSheetClassOptions[0] || "",
    );
  }, [classSheetClassOptions]);

  const loadScoreWarningSettings = async () => {
    setScoreWarningLoading(true);
    try {
      const settings = await loadPerformanceScoreSettings(config);
      setScoreWarningSettings(settings);
      setScoreWarningDraft(settings.warningText);
    } catch (error) {
      console.error(
        "Failed to load performance score warning settings:",
        error,
      );
      showToast({
        tone: "error",
        title: "경고 문구를 불러오지 못했습니다.",
        message: "권한과 네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setScoreWarningLoading(false);
    }
  };

  const saveScoreWarningSettings = async () => {
    if (scoreWarningSaving) return;
    const normalizedText =
      normalizePerformanceScoreWarningText(scoreWarningDraft);
    if (scoreWarningDraft.length > PERFORMANCE_SCORE_WARNING_MAX_LENGTH) {
      showToast({
        tone: "warning",
        title: "문구가 너무 깁니다.",
        message: `${PERFORMANCE_SCORE_WARNING_MAX_LENGTH}자 이내로 줄여 주세요.`,
      });
      return;
    }
    setScoreWarningSaving(true);
    try {
      const saved = await savePerformanceScoreSettings(config, {
        warningText: normalizedText,
        updatedBy: currentUser?.uid,
      });
      const nextSettings = {
        ...scoreWarningSettings,
        ...saved,
        updatedAt: new Date(),
        updatedBy: currentUser?.uid || "",
      };
      setScoreWarningSettings(nextSettings);
      setScoreWarningDraft(saved.warningText);
      showToast({
        tone: "success",
        title: "경고 문구를 저장했습니다.",
        message:
          "학생은 이 문구에 동의해야 수행평가 점수 확인과 서명을 진행할 수 있습니다.",
      });
    } catch (error) {
      console.error(
        "Failed to save performance score warning settings:",
        error,
      );
      showToast({
        tone: "error",
        title: "경고 문구 저장에 실패했습니다.",
        message: "권한과 네트워크 상태를 확인한 뒤 다시 저장해 주세요.",
      });
    } finally {
      setScoreWarningSaving(false);
    }
  };

  const loadStudents = async () => {
    setStudentsLoading(true);
    setStudentLoadError("");
    try {
      const snap = await getDocs(collection(db, "users"));
      const loaded: StudentProfile[] = [];
      snap.forEach((item) => {
        const data = item.data() as Record<string, unknown>;
        const profile = normalizeStudentProfile(item.id, data);
        if (!profile.name && !profile.number && !profile.class) return;
        if (data.role === "teacher" && !profile.number) return;
        loaded.push(profile);
      });
      setStudents(loaded);
    } catch (error) {
      console.error("Failed to load students for performance scores:", error);
      setStudentLoadError(
        "학생 명단을 불러오지 못했습니다. 학생 연결을 위해 학생 명단 조회 권한이 필요합니다.",
      );
    } finally {
      setStudentsLoading(false);
    }
  };

  const syncMissingStudentScoreDocuments = async (
    loadedRosters: PerformanceScoreRoster[],
    syncRunId: number,
  ) => {
    const candidates = loadedRosters.flatMap((roster) =>
      (roster.rows || [])
        .filter((row) => row.uid && rosterRowHasScore(row))
        .map((row) => {
          const key = `${year}:${semester}:${row.uid}:${roster.id}`;
          return {
            key,
            roster,
            row,
            ref: doc(
              db,
              "users",
              row.uid,
              PERFORMANCE_SCORE_USER_COLLECTION,
              roster.id,
            ),
          };
        })
        .filter(
          (candidate) =>
            !scoreDocumentSyncCheckedKeysRef.current.has(candidate.key),
        ),
    );

    if (!candidates.length) return;

    try {
      const missingCandidates: typeof candidates = [];
      const existingKeys: string[] = [];

      for (let index = 0; index < candidates.length; index += 40) {
        const chunk = candidates.slice(index, index + 40);
        const snaps = await Promise.all(
          chunk.map((candidate) => getDoc(candidate.ref)),
        );
        snaps.forEach((snap, chunkIndex) => {
          const candidate = chunk[chunkIndex];
          if (snap.exists()) {
            existingKeys.push(candidate.key);
            return;
          }
          missingCandidates.push(candidate);
        });
      }

      if (scoreDocumentSyncRunRef.current !== syncRunId) return;

      if (!missingCandidates.length) {
        existingKeys.forEach((key) =>
          scoreDocumentSyncCheckedKeysRef.current.add(key),
        );
        return;
      }

      const writtenKeys: string[] = [];

      for (let index = 0; index < missingCandidates.length; index += 20) {
        const chunk = missingCandidates.slice(index, index + 20);
        await Promise.all(
          chunk.map(async (candidate) => {
            let shouldMarkChecked = false;
            await runTransaction(db, async (transaction) => {
              if (scoreDocumentSyncRunRef.current !== syncRunId) return;

              const scoreSnap = await transaction.get(candidate.ref);
              if (scoreSnap.exists()) {
                shouldMarkChecked = true;
                return;
              }

              const rosterSnap = await transaction.get(
                doc(db, rosterCollectionPath, candidate.roster.id),
              );
              if (!rosterSnap.exists()) return;

              const latestRoster = normalizePerformanceScoreRoster(
                rosterSnap.id,
                rosterSnap.data() as Omit<PerformanceScoreRoster, "id">,
              );
              const latestRow =
                (latestRoster.rows || []).find(
                  (row) =>
                    row.uid === candidate.row.uid &&
                    Number(row.rowNumber) === Number(candidate.row.rowNumber),
                ) ||
                (latestRoster.rows || []).find(
                  (row) => row.uid === candidate.row.uid,
                );
              if (!latestRow || !rosterRowHasScore(latestRow)) return;

              const payload = buildStudentScoreDocumentPayload(
                latestRoster,
                latestRow,
                serverTimestamp(),
                { year, semester },
              );
              if (!payload) return;

              transaction.set(candidate.ref, payload);
              shouldMarkChecked = true;
            });

            if (shouldMarkChecked) {
              writtenKeys.push(candidate.key);
            }
          }),
        );
      }

      [...existingKeys, ...writtenKeys].forEach((key) =>
        scoreDocumentSyncCheckedKeysRef.current.add(key),
      );
    } catch (error) {
      console.error(
        "Failed to sync missing performance score documents:",
        error,
      );
    }
  };

  const loadRosters = async () => {
    const syncRunId = scoreDocumentSyncRunRef.current + 1;
    scoreDocumentSyncRunRef.current = syncRunId;
    setRostersLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, rosterCollectionPath),
          orderBy("createdAt", "desc"),
        ),
      );
      const loaded = snap.docs.map((item) => {
        const data = item.data() as Omit<PerformanceScoreRoster, "id">;
        return normalizePerformanceScoreRoster(item.id, data);
      });
      setRosters(sortPerformanceScoreRosters(loaded));
      setScoreListLoadError("");
      void syncMissingStudentScoreDocuments(loaded, syncRunId);
    } catch (error) {
      console.error("Failed to load performance score rosters:", error);
      setRosters([]);
      setScoreListRosterId("");
      setScoreListLoadedRosterId("");
      setScoreListRecords([]);
      setScoreListSummaryStudents([]);
      setScoreListSummaryLoadedKey("");
      setScoreEditing(false);
      setScoreEditOriginalRecords([]);
      setScoreListLoadError("저장된 수행평가 점수표를 불러오지 못했습니다.");
      showToast({
        tone: "error",
        title: "저장된 점수표를 불러오지 못했습니다.",
        message: "권한과 네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setRostersLoading(false);
    }
  };

  const repairSavedRosterStudentLinks = async (
    sourceRosters: PerformanceScoreRoster[],
    expectedRepairKey: string,
  ) => {
    const studentSnapshot = students;
    if (!studentSnapshot.length || !sourceRosters.length) return;

    try {
      const repairedRosters: PerformanceScoreRoster[] = [];

      for (const roster of sourceRosters) {
        const repairedRoster = await runTransaction(db, async (transaction) => {
          const rosterRef = doc(db, rosterCollectionPath, roster.id);
          const latestSnap = await transaction.get(rosterRef);
          if (!latestSnap.exists()) return null;

          const latestRoster = normalizePerformanceScoreRoster(
            latestSnap.id,
            latestSnap.data() as Omit<PerformanceScoreRoster, "id">,
          );
          const repaired = repairRosterRowsWithStudentProfiles(
            latestRoster.rows || [],
            studentSnapshot,
          );
          if (!repaired.changed) return null;

          const meta = buildRosterRowsMeta(latestRoster, repaired.rows);
          const nextRoster = {
            ...latestRoster,
            rows: repaired.rows,
            classes: meta.classes,
            targetClass: meta.targetClass,
            rowCount: meta.rowCount,
            matchedCount: meta.matchedCount,
            unmatchedCount: meta.unmatchedCount,
            updatedAt: new Date(),
          };
          transaction.update(rosterRef, {
            rows: repaired.rows,
            classes: meta.classes,
            targetClass: meta.targetClass,
            rowCount: meta.rowCount,
            matchedCount: meta.matchedCount,
            unmatchedCount: meta.unmatchedCount,
            updatedAt: serverTimestamp(),
          });
          return nextRoster;
        });
        if (repairedRoster) repairedRosters.push(repairedRoster);
      }

      if (!repairedRosters.length) return;
      if (rosterStudentLinkRepairKeyRef.current !== expectedRepairKey) return;

      setRosters((current) => {
        const byId = new Map(
          repairedRosters.map((roster) => [roster.id, roster]),
        );
        return sortPerformanceScoreRosters(
          current.map((roster) => byId.get(roster.id) || roster),
        );
      });

      const syncRunId = scoreDocumentSyncRunRef.current + 1;
      scoreDocumentSyncRunRef.current = syncRunId;
      void syncMissingStudentScoreDocuments(repairedRosters, syncRunId);
    } catch (error) {
      console.error("Failed to repair performance score student links:", error);
    }
  };

  useEffect(() => {
    if (!students.length || !rosters.length || rostersLoading) return;
    if (rosterStudentLinkRepairKeyRef.current === rosterStudentLinkRepairKey) {
      return;
    }
    const currentRepairKey = rosterStudentLinkRepairKey;
    rosterStudentLinkRepairKeyRef.current = currentRepairKey;
    void repairSavedRosterStudentLinks(rosters, currentRepairKey);
  }, [rosterStudentLinkRepairKey, rosters, rostersLoading, students.length]);

  const loadScoreRecordsForRoster = async (
    roster: PerformanceScoreRoster,
    options: { includeStudentDocuments?: boolean } = {},
  ) => {
    if (!options.includeStudentDocuments) {
      return buildScoreListRecordsFromRosterRows(roster);
    }

    const rosterRows = roster.rows || [];
    const linkedRows = rosterRows.filter((row) => row.uid);
    const loaded: ScoreListRecord[] = [];
    for (let index = 0; index < linkedRows.length; index += 40) {
      const chunk = linkedRows.slice(index, index + 40);
      const snaps = await Promise.all(
        chunk.map((row) =>
          getDoc(
            doc(
              db,
              "users",
              row.uid,
              PERFORMANCE_SCORE_USER_COLLECTION,
              roster.id,
            ),
          ),
        ),
      );
      snaps.forEach((snap, rowIndex) => {
        const row = chunk[rowIndex];
        if (snap.exists()) {
          const data = snap.data() as PerformanceScoreRecord;
          loaded.push(buildScoreListRecordFromDocument(snap.id, data));
          return;
        }
        loaded.push(buildScoreListRecordFromRosterRow(roster, row));
      });
    }
    rosterRows
      .filter((row) => !row.uid && shouldShowRosterRowInScoreList(row))
      .forEach((row) => {
        loaded.push(buildScoreListRecordFromRosterRow(roster, row));
      });
    return sortStudentIdentityRows(loaded);
  };

  const loadScoreListRecords = async (
    rosterOverride?: PerformanceScoreRoster,
    options: { startEdit?: boolean } = {},
  ) => {
    const roster = rosterOverride || selectedScoreRoster;
    const loadingAllScores = !rosterOverride && scoreListAllSelected;
    if (
      scoreListLoading ||
      savingScoreEdits ||
      (!loadingAllScores && !roster)
    ) {
      return;
    }
    setScoreListLoading(true);
    setScoreListLoadError("");
    setScoreEditing(false);
    setScoreEditOriginalRecords([]);
    setScoreListLoadedRosterId("");
    setScoreListRecords([]);
    setScoreListSummaryStudents([]);
    setScoreListSummaryLoadedKey("");
    try {
      if (loadingAllScores) {
        const { firstRoster, secondRoster } = scoreListSummaryRosters;
        if (!firstRoster || !secondRoster) {
          setScoreListLoadError(
            "전체 조회는 고조선 8조법과 삼국 시대 무덤 수행평가 점수표가 모두 필요합니다.",
          );
          showToast({
            tone: "warning",
            title: "전체 조회를 할 수 없습니다.",
            message:
              "고조선 8조법과 삼국 시대 무덤 수행평가 점수표를 모두 업로드한 뒤 다시 조회해 주세요.",
          });
          return;
        }
        const [firstRecords, secondRecords] = await Promise.all([
          loadScoreRecordsForRoster(firstRoster),
          loadScoreRecordsForRoster(secondRoster),
        ]);
        setScoreListSummaryStudents(
          buildScoreListSummaryStudents(firstRecords, secondRecords),
        );
        setScoreListSummaryLoadedKey(scoreListSummaryLoadKey);
        setScoreListLoadedRosterId(SCORE_LIST_ALL_ROSTERS_VALUE);
        return;
      }

      if (!roster) return;
      const sortedLoaded = await loadScoreRecordsForRoster(roster, {
        includeStudentDocuments: options.startEdit === true,
      });
      setScoreListLoadedRosterId(roster.id);
      if (options.startEdit) {
        setScoreEditOriginalRecords(cloneScoreListRecords(sortedLoaded));
        setScoreListRecords(
          sortedLoaded.map((record) =>
            normalizeScoreRecordForIntegerEdit(record),
          ),
        );
        setScoreEditing(true);
      } else {
        setScoreListRecords(sortedLoaded);
      }
    } catch (error) {
      console.error("Failed to load performance score list:", error);
      setScoreListLoadedRosterId("");
      setScoreListRecords([]);
      setScoreListSummaryStudents([]);
      setScoreListSummaryLoadedKey("");
      setScoreEditing(false);
      setScoreEditOriginalRecords([]);
      setScoreListLoadError("점수 목록을 불러오지 못했습니다.");
      showToast({
        tone: "error",
        title: "점수 목록을 불러오지 못했습니다.",
        message: "권한과 네트워크 상태를 확인한 뒤 다시 조회해 주세요.",
      });
    } finally {
      setScoreListLoading(false);
    }
  };

  const loadScoreStatsRecords = async () => {
    if (!scoreStatsSelectionReady || scoreStatsLoading) return;
    if (scoreStatsLoadedRosterId === scoreStatsLoadKey) {
      return;
    }

    setScoreStatsLoading(true);
    try {
      if (scoreStatsAllSelected) {
        const firstRoster = scoreStatsFirstRoster;
        const secondRoster = scoreStatsSecondRoster;
        if (!firstRoster || !secondRoster) {
          showToast({
            tone: "warning",
            title: "전체 통계를 볼 수 없습니다.",
            message:
              "고조선 8조법과 삼국 시대 수행평가 점수표를 모두 업로드한 뒤 다시 시도해 주세요.",
          });
          return;
        }
        let summaryStudents = scoreListSummaryCacheReady
          ? scoreListSummaryStudents
          : [];
        if (!scoreListSummaryCacheReady) {
          const [firstRecords, secondRecords] = await Promise.all([
            loadScoreRecordsForRoster(firstRoster),
            loadScoreRecordsForRoster(secondRoster),
          ]);
          summaryStudents = buildScoreListSummaryStudents(
            firstRecords,
            secondRecords,
          );
          setScoreListSummaryStudents(summaryStudents);
          setScoreListSummaryLoadedKey(scoreListSummaryLoadKey);
        }
        const combinedStatsRecords = buildCombinedScoreStatsRecords(
          summaryStudents,
          {
            year,
            semester,
            firstRoster,
            secondRoster,
            totalMaxScore: combinedScoreListSummaryMaxScore ?? 0,
          },
        );
        if (scoreListAllSelected) {
          setScoreListLoadedRosterId(SCORE_LIST_ALL_ROSTERS_VALUE);
        }
        setScoreStatsRecords(combinedStatsRecords);
        setScoreStatsLoadedRosterId(scoreStatsLoadKey);
        return;
      }

      if (!scoreStatsSelectedRoster) return;
      const sortedLoaded = await loadScoreRecordsForRoster(
        scoreStatsSelectedRoster,
      );
      setScoreStatsRecords(sortedLoaded);
      setScoreStatsLoadedRosterId(scoreStatsLoadKey);
    } catch (error) {
      console.error("Failed to load performance score statistics:", error);
      showToast({
        tone: "error",
        title: "통계 데이터를 불러오지 못했습니다.",
        message: "권한과 네트워크 상태를 확인한 뒤 다시 열어 주세요.",
      });
    } finally {
      setScoreStatsLoading(false);
    }
  };

  const loadPerformanceScoreObjections = async () => {
    if (objectionsLoading) return;
    setObjectionsLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, objectionCollectionPath),
          orderBy("requestedAt", "desc"),
        ),
      );
      const loaded = snap.docs.map((item) =>
        normalizePerformanceScoreObjection(
          item.id,
          item.data() as Record<string, unknown>,
        ),
      );
      setObjections(sortPerformanceScoreObjections(loaded));
      setObjectionsLoaded(true);
    } catch (error) {
      console.error("Failed to load performance score objections:", error);
      setObjections([]);
      setObjectionsLoaded(false);
      showToast({
        tone: "error",
        title: "이의 목록을 불러오지 못했습니다.",
        message: "권한과 네트워크 상태를 확인한 뒤 다시 조회해 주세요.",
      });
    } finally {
      setObjectionsLoading(false);
    }
  };

  const openObjectionModal = () => {
    setObjectionModalOpen(true);
    void loadPerformanceScoreObjections();
  };

  const closeObjectionModal = () => {
    setObjectionModalOpen(false);
    if (searchParams.get("panel") !== "objections") return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("panel");
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    if (objectionsAutoLoadAttempted || objectionsLoaded || objectionsLoading) {
      return;
    }
    setObjectionsAutoLoadAttempted(true);
    void loadPerformanceScoreObjections();
  }, [
    objectionsAutoLoadAttempted,
    objectionsLoaded,
    objectionsLoading,
    objectionCollectionPath,
  ]);

  useEffect(() => {
    if (searchParams.get("panel") !== "objections" || objectionModalOpen) {
      return;
    }
    setObjectionModalOpen(true);
    void loadPerformanceScoreObjections();
  }, [searchParams, objectionModalOpen]);

  const handleReviewObjection = async (
    objection: PerformanceScoreObjection,
    status: PerformanceScoreObjectionReviewAction,
  ) => {
    if (objectionReviewingAction) return;

    let changedTotalScore: number | null = null;
    let changedScoreLabel = "";
    let reviewMemo = "";
    if (status === "accepted") {
      const defaultScore =
        objection.changedTotalScore ?? objection.totalScore ?? "";
      const rawScore = await promptDialog({
        title: "변경 후 점수 입력",
        message: [
          `${objection.studentName} 학생의 ${objection.scoreTitle} 이의 제기를 수용합니다.`,
          `현재 점수: ${objection.scoreLabel}`,
          "수용 전 점수표에서 실제 점수를 수정·저장한 뒤, 학생 화면에 반영된 변경 후 총점을 입력해 주세요.",
        ].join("\n"),
        inputLabel: "변경 후 총점",
        initialValue: String(defaultScore),
        placeholder: "예: 29",
        inputMode: "decimal",
        confirmLabel: "점수 확인",
        required: true,
        requiredMessage: "변경 후 총점을 입력해 주세요.",
        tone: "info",
      });
      if (rawScore === null) return;
      changedTotalScore = getFiniteNumber(rawScore.replace(/,/g, "").trim());
      if (changedTotalScore === null) {
        showToast({
          tone: "warning",
          title: "변경 후 점수를 확인해 주세요.",
          message: "수용 처리에는 학생에게 안내할 변경 후 총점이 필요합니다.",
        });
        return;
      }
      if (
        changedTotalScore < 0 ||
        (objection.totalMaxScore !== null &&
          objection.totalMaxScore > 0 &&
          changedTotalScore > objection.totalMaxScore)
      ) {
        showToast({
          tone: "warning",
          title: "점수 범위를 확인해 주세요.",
          message: `변경 후 점수는 0점 이상 ${formatPerformanceScore(
            objection.totalMaxScore || 0,
          )}점 이하로 입력해야 합니다.`,
        });
        return;
      }
      changedScoreLabel = getObjectionScoreLabel(
        changedTotalScore,
        objection.totalMaxScore,
      );
      const memo = await promptDialog({
        title: "처리 메모 입력",
        message: "학생에게 함께 보낼 처리 메모가 있으면 입력해 주세요.",
        inputLabel: "처리 메모",
        initialValue: objection.reviewMemo || "",
        placeholder: "예: 확인 결과 총점이 수정되었습니다.",
        confirmLabel: "메모 확인",
        multiline: true,
        maxLength: 240,
        tone: "info",
      });
      if (memo === null) return;
      reviewMemo = memo.trim().slice(0, 240);
    } else {
      const memo = await promptDialog({
        title: "반려 사유 입력",
        message: `${objection.studentName} 학생에게 전달할 ${objection.scoreTitle} 이의 반려 사유를 입력해 주세요.`,
        inputLabel: "반려 사유",
        initialValue: objection.reviewMemo || "",
        placeholder: "예: 해당 부분은 채점 기준상 추가 점수 대상이 아닙니다.",
        confirmLabel: "반려 사유 확인",
        multiline: true,
        maxLength: 240,
        required: true,
        requiredMessage: "반려 사유를 입력해 주세요.",
        tone: "danger",
      });
      if (memo === null) return;
      reviewMemo = memo.trim().slice(0, 240);
      if (!reviewMemo) {
        showToast({
          tone: "warning",
          title: "반려 사유를 입력해 주세요.",
          message:
            "학생이 처리 결과를 이해할 수 있도록 반려 사유가 필요합니다.",
        });
        return;
      }
    }

    const confirmed = await confirm({
      title:
        status === "accepted"
          ? "이의 제기를 수용할까요?"
          : "이의 제기를 반려할까요?",
      message:
        status === "accepted"
          ? `${objection.studentName} 학생에게 ${objection.scoreTitle} 이의 제기가 수용되었고 변경 후 점수가 ${changedScoreLabel}이라고 알립니다. 입력한 총점이 저장된 학생 점수와 일치할 때만 처리됩니다.`
          : `${objection.studentName} 학생에게 ${objection.scoreTitle} 이의 제기가 반려되었다고 알립니다.`,
      confirmLabel:
        status === "accepted" ? "수용 알림 보내기" : "반려 알림 보내기",
      tone: status === "accepted" ? "info" : "danger",
    });
    if (!confirmed) return;

    setObjectionReviewingAction({ id: objection.id, status });
    try {
      const result = await reviewPerformanceScoreObjection(config, {
        objectionId: objection.id,
        status,
        changedTotalScore,
        reviewMemo,
      });
      await loadPerformanceScoreObjections();
      showToast({
        tone: "success",
        title:
          status === "accepted"
            ? "이의 제기를 수용했습니다."
            : "이의 제기를 반려했습니다.",
        message: result.notificationCreated
          ? status === "accepted"
            ? `학생에게 변경 후 점수 ${changedScoreLabel} 안내를 보냈습니다.`
            : "학생에게 반려 알림을 보냈습니다."
          : "처리 상태는 저장했지만 알림 설정 때문에 학생 알림은 새로 생성되지 않았습니다.",
      });
    } catch (error) {
      console.error("Failed to review performance score objection:", error);
      showToast({
        tone: "error",
        title: "이의 제기 처리에 실패했습니다.",
        message: getObjectionReviewErrorMessage(error),
      });
    } finally {
      setObjectionReviewingAction(null);
    }
  };

  const startScoreEdit = () => {
    if (!selectedScoreRoster || !scoreListReady || scoreListLoading) return;
    const editableRecords = scoreListRecords.map(
      prepareScoreListRecordForInstantEdit,
    );
    setScoreEditOriginalRecords(cloneScoreListRecords(scoreListRecords));
    setScoreListRecords(editableRecords);
    setSelectedScoreListRecordKeys(new Set<string>());
    setScoreEditing(true);
  };

  const cancelScoreEdit = () => {
    setScoreListRecords(cloneScoreListRecords(scoreEditOriginalRecords));
    setScoreEditOriginalRecords([]);
    setScoreEditing(false);
    setSelectedScoreListRecordKeys(new Set<string>());
  };

  const addScoreListStudent = () => {
    if (!selectedScoreRoster || !scoreEditing || savingScoreEdits) return;
    const defaultGrade =
      scoreListGradeFilter !== "all"
        ? scoreListGradeFilter
        : selectedScoreRoster.targetGrade || targetGrade;
    const defaultClass =
      activeScoreListClass ||
      (scoreListClassFilter !== "all" ? scoreListClassFilter : "") ||
      selectedScoreRoster.targetClass ||
      selectedScoreRoster.classes?.[0] ||
      fallbackClass;
    const localKey = `manual:${selectedScoreRoster.id}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const manualRecord = createManualScoreListRecord(selectedScoreRoster, {
      year,
      semester,
      grade: defaultGrade,
      classValue: defaultClass,
      localKey,
    });
    setScoreListSearch("");
    setScoreListRecords((current) => [...current, manualRecord]);
  };

  const toggleScoreListRecordSelection = (
    recordKey: string,
    checked: boolean,
  ) => {
    if (!scoreEditing || savingScoreEdits) return;
    setSelectedScoreListRecordKeys((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(recordKey);
      } else {
        next.delete(recordKey);
      }
      return next;
    });
  };

  const toggleVisibleScoreListRecordSelection = (checked: boolean) => {
    if (!scoreEditing || savingScoreEdits) return;
    setSelectedScoreListRecordKeys((current) => {
      const next = new Set(current);
      visibleScoreListRecordKeys.forEach((key) => {
        if (checked) {
          next.add(key);
        } else {
          next.delete(key);
        }
      });
      return next;
    });
  };

  const removeSelectedScoreListStudents = async () => {
    if (!scoreEditing || savingScoreEdits || selectedScoreListRecordCount === 0)
      return;
    const selectedKeys = new Set(selectedVisibleScoreListRecordKeys);
    const selectedCount = selectedKeys.size;
    const confirmed = await confirm({
      title: "선택 학생 삭제",
      message: [
        `선택한 학생 ${selectedCount}명을 이 수행평가 점수표에서 삭제합니다.`,
        "저장된 학생은 변경 저장을 눌러야 DB와 다른 수행평가 명단에 반영됩니다.",
      ].join("\n"),
      confirmLabel: "학생 삭제",
      tone: "danger",
    });
    if (!confirmed) return;
    setScoreListRecords((current) =>
      current.filter(
        (record) => !selectedKeys.has(getScoreListRecordKey(record)),
      ),
    );
    setSelectedScoreListRecordKeys(new Set<string>());
  };

  const updateScoreListIdentity = (
    recordKey: string,
    field: "grade" | "class" | "number" | "studentName",
    value: string,
  ) => {
    const nextValue =
      field === "studentName"
        ? value.replace(/\s+/g, " ").slice(0, 40)
        : normalizeSchoolValue(value).slice(0, 10);
    setScoreListRecords((current) =>
      current.map((record) =>
        getScoreListRecordKey(record) === recordKey &&
        isManualScoreListRecord(record)
          ? {
              ...record,
              [field]: nextValue,
            }
          : record,
      ),
    );
  };

  const updateScoreListAcademicStatus = (
    recordKey: string,
    statusValue: string,
  ) => {
    const academicStatus = normalizeAcademicStatus(statusValue);
    setScoreListRecords((current) =>
      current.map((record) => {
        if (getScoreListRecordKey(record) !== recordKey) return record;
        const statusMeta = getAcademicStatusRecordMeta(academicStatus);
        if (!academicStatus) {
          const original = scoreEditOriginalRecords.find(
            (item) => getScoreListRecordKey(item) === recordKey,
          );
          const restoredFromOriginal =
            original && !isTransferredScoreRecord(original);
          const restoredItems = restoredFromOriginal
            ? (original.items || []).map((item) => ({ ...item }))
            : record.items || [];
          return {
            ...record,
            items: restoredItems,
            enteredScoreCount: restoredFromOriginal
              ? original.enteredScoreCount
              : getEnteredItemScoreCount(restoredItems),
            totalScore: restoredFromOriginal
              ? original.totalScore
              : (getEnteredItemsTotalScore(restoredItems) ?? Number.NaN),
            academicStatus: undefined,
            isTransferred: false,
            transferStatus: undefined,
          };
        }
        const items = selectedScoreRoster
          ? getRecordItemsForRoster(record, selectedScoreRoster)
          : record.items || [];
        return {
          ...record,
          items: items.map((item) => ({
            ...item,
            score: 0,
            scoreEntered: false,
          })),
          enteredScoreCount: 1,
          totalScore: Number.NaN,
          ...statusMeta,
        };
      }),
    );
  };

  const updateScoreListItemScore = (
    recordKey: string,
    itemIndex: number,
    value: string,
  ) => {
    if (!selectedScoreRoster) return;
    const parsedScore = parseScoreIntegerInput(value);

    setScoreListRecords((current) =>
      current.map((record) => {
        if (getScoreListRecordKey(record) !== recordKey) return record;
        const items = getRecordItemsForRoster(record, selectedScoreRoster);
        const currentItem = items[itemIndex];
        if (!currentItem) return record;
        const nextItems = items.map((item, index) =>
          index === itemIndex
            ? {
                ...item,
                score: parsedScore === null ? 0 : parsedScore,
                scoreEntered: parsedScore !== null,
              }
            : item,
        );
        const nextTotalScore = getEnteredItemsTotalScore(nextItems);
        return {
          ...record,
          items: nextItems,
          enteredScoreCount: getScoreRecordEnteredScoreCount(record, nextItems),
          totalScore: nextTotalScore ?? Number.NaN,
        };
      }),
    );
  };

  const updateScoreListEvidence = (recordKey: string, value: string) => {
    const evidence = value.slice(0, 1000);
    setScoreListRecords((current) =>
      current.map((record) =>
        getScoreListRecordKey(record) === recordKey
          ? {
              ...record,
              feedback: evidence,
              evidence,
            }
          : record,
      ),
    );
  };

  const editScoreListEvidence = async (recordKey: string) => {
    const record = scoreListRecords.find(
      (item) => getScoreListRecordKey(item) === recordKey,
    );
    if (!record) return;
    const result = await promptDialog({
      title: "사유 작성",
      message: `${record.class}반 ${record.number}번 ${record.studentName || "학생"}의 감점 요인 또는 학적 변동 사유를 작성합니다.`,
      inputLabel: "사유",
      initialValue: String(record.evidence || record.feedback || ""),
      placeholder: "학생에게 보여줄 사유를 입력하세요.",
      confirmLabel: "사유 저장",
      multiline: true,
      maxLength: 1000,
      tone: "info",
    });
    if (result === null) return;
    updateScoreListEvidence(recordKey, result);
  };

  const showScoreListEvidence = async (record: PerformanceScoreRecord) => {
    await confirm({
      title: "사유",
      message: String(
        record.evidence || record.feedback || "작성된 사유가 없습니다.",
      ),
      confirmLabel: "닫기",
      tone: "info",
    });
  };

  const saveScoreListEdits = async () => {
    if (
      !selectedScoreRoster ||
      !scoreListReady ||
      !scoreEditing ||
      savingScoreEdits
    ) {
      return;
    }

    const originalByKey = new Map(
      scoreEditOriginalRecords.map((record) => [
        getScoreListRecordKey(record),
        record,
      ]),
    );
    const persistableScoreListRecords = scoreListRecords.filter(
      (record) => !isEmptyManualScoreListRecord(record),
    );
    const persistableRecordKeys = new Set(
      persistableScoreListRecords.map(getScoreListRecordKey),
    );
    const deletedRecords = scoreEditOriginalRecords.filter(
      (record) => !persistableRecordKeys.has(getScoreListRecordKey(record)),
    );
    const manualRecordsToSave = persistableScoreListRecords.filter((record) =>
      isManualScoreListRecord(record),
    );
    const incompleteManualRecord = manualRecordsToSave.find(
      (record) =>
        !normalizeSchoolValue(record.grade) ||
        !normalizeSchoolValue(record.class) ||
        !normalizeSchoolValue(record.number) ||
        !normalizeStudentName(record.studentName),
    );
    if (incompleteManualRecord) {
      showToast({
        tone: "warning",
        title: "추가 학생 정보를 확인해 주세요.",
        message:
          "수동으로 추가한 학생은 학년, 반, 번호, 이름을 모두 입력해야 저장할 수 있습니다.",
      });
      return;
    }

    const unscoredManualRecord = manualRecordsToSave.find(
      (record) =>
        isNewManualScoreListRecord(record) &&
        !isTransferredScoreRecord(record) &&
        getEnteredTotalScore(record) === null,
    );
    if (unscoredManualRecord) {
      showToast({
        tone: "warning",
        title: "추가 학생 점수를 입력해 주세요.",
        message: `${unscoredManualRecord.class}반 ${unscoredManualRecord.number}번 ${unscoredManualRecord.studentName} 학생의 점수가 비어 있습니다.`,
      });
      return;
    }

    const changedRecords = persistableScoreListRecords.filter((record) =>
      hasScoreRecordChanged(
        originalByKey.get(getScoreListRecordKey(record)),
        record,
      ),
    );
    const changedRecordKeys = new Set(
      changedRecords.map(getScoreListRecordKey),
    );
    const studentDocumentSyncRecords = persistableScoreListRecords.filter(
      (record) =>
        needsStudentScoreDocumentSync(record) &&
        !changedRecordKeys.has(getScoreListRecordKey(record)),
    );
    const recordsToWrite = [...changedRecords, ...studentDocumentSyncRecords];
    const manualIdentityReplacements = getManualScoreIdentityReplacements(
      persistableScoreListRecords,
      originalByKey,
    );

    if (!recordsToWrite.length && !deletedRecords.length) {
      const cleanRecords = cloneScoreListRecords(persistableScoreListRecords);
      setScoreListRecords(cleanRecords);
      setScoreEditing(false);
      setScoreEditOriginalRecords([]);
      setSelectedScoreListRecordKeys(new Set<string>());
      showToast({
        tone: "success",
        title: "수정할 변경 사항이 없습니다.",
        message: "현재 DB 점수표와 동일합니다.",
      });
      return;
    }

    const invalidRecord = scoreListRecords.find(
      (record) =>
        !isTransferredScoreRecord(record) &&
        (getRecordItemsForRoster(record, selectedScoreRoster) || []).some(
          (item) => {
            const score = getEnteredItemScore(item);
            const maxScore = getFiniteNumber(item.maxScore);
            return (
              score !== null &&
              (!Number.isInteger(score) ||
                score < 0 ||
                (maxScore !== null && maxScore > 0 && score > maxScore))
            );
          },
        ),
    );
    if (invalidRecord) {
      showToast({
        tone: "warning",
        title: "점수 범위를 확인해 주세요.",
        message: `${invalidRecord.class}반 ${invalidRecord.number}번 ${invalidRecord.studentName} 학생의 점수가 허용 범위를 벗어났습니다.`,
      });
      return;
    }

    const signedChangedCount = [...changedRecords, ...deletedRecords].filter(
      (record) => {
        const original = originalByKey.get(getScoreListRecordKey(record));
        return Boolean(
          record.signatureImage ||
          record.confirmation?.signatureImage ||
          original?.signatureImage ||
          original?.confirmation?.signatureImage,
        );
      },
    ).length;

    if (signedChangedCount > 0) {
      const confirmed = await confirm({
        title: "서명 완료 학생의 점수 변경",
        message: [
          `이미 점수 확인 서명이 완료된 학생 ${signedChangedCount}명의 점수, 근거 또는 명단 포함 여부가 변경됩니다.`,
          "변경된 학생의 기존 확인 서명은 자동으로 반려되어 학생이 다시 확인할 수 있게 됩니다.",
          "",
          "계속 저장할까요?",
        ].join("\n"),
        confirmLabel: "계속 저장",
        tone: "warning",
      });
      if (!confirmed) return;
    }

    setSavingScoreEdits(true);
    try {
      const timestamp = serverTimestamp();
      const editedBy = currentUser?.uid || "";
      const editedByEmail = currentUser?.email || "";
      const recordByUid = new Map(
        persistableScoreListRecords
          .filter((record) => record.uid)
          .map((record) => [record.uid, record]),
      );
      const recordByLocalKey = new Map(
        persistableScoreListRecords
          .filter((record) => !record.uid && record.localKey)
          .map((record) => [record.localKey || "", record]),
      );
      const deletedUidSet = new Set(
        deletedRecords.map((record) => record.uid).filter(Boolean),
      );
      const deletedLocalKeySet = new Set(
        deletedRecords
          .filter((record) => !record.uid)
          .map((record) => record.localKey || "")
          .filter(Boolean),
      );
      const deletedManualIdentityKeys = new Set(
        deletedRecords
          .filter(hasSyncableManualScoreIdentity)
          .map(getManualScoreStudentIdentityKey)
          .filter(Boolean),
      );
      const shouldDeleteExistingRosterRow = (
        row: PerformanceScoreRosterRow,
      ) => {
        if (row.uid && deletedUidSet.has(row.uid)) return true;
        const rowLocalKey = getRosterRowLocalKey(selectedScoreRoster.id, row);
        if (deletedLocalKeySet.has(rowLocalKey)) return true;
        if (!isManualRosterRow(row)) return false;
        const manualKey = getManualScoreStudentIdentityKey(row);
        return Boolean(manualKey && deletedManualIdentityKeys.has(manualKey));
      };
      const usedRecordKeys = new Set<string>();
      const rowNumberByRecordKey = new Map<string, number>();
      const existingRows = selectedScoreRoster.rows || [];
      const updatedExistingRows = existingRows.flatMap((row) => {
        if (shouldDeleteExistingRosterRow(row)) return [];
        const record = row.uid
          ? recordByUid.get(row.uid)
          : recordByLocalKey.get(
              getRosterRowLocalKey(selectedScoreRoster.id, row),
            );
        if (!record) return [row];
        const recordKey = getScoreListRecordKey(record);
        usedRecordKeys.add(recordKey);
        rowNumberByRecordKey.set(recordKey, row.rowNumber);
        return [
          buildRosterRowFromScoreRecord(row, record, selectedScoreRoster),
        ];
      });
      let nextRowNumber = existingRows.reduce(
        (max, row) => Math.max(max, Number(row.rowNumber) || 0),
        0,
      );
      const addedRows = persistableScoreListRecords
        .filter(
          (record) =>
            !record.uid && !usedRecordKeys.has(getScoreListRecordKey(record)),
        )
        .map((record) => {
          nextRowNumber += 1;
          const recordKey = getScoreListRecordKey(record);
          rowNumberByRecordKey.set(recordKey, nextRowNumber);
          return buildRosterRowFromScoreRecord(
            {
              rowNumber: nextRowNumber,
              uid: "",
              grade: record.grade,
              class: record.class,
              number: record.number,
              studentName: record.studentName,
              items: [],
              totalScore: 0,
              totalMaxScore: selectedScoreRoster.totalMaxScore,
              feedback: "",
              evidence: "",
              matchStatus: "unmatched",
              matchMessage: MANUAL_SCORE_ROW_MESSAGE,
              isManual: true,
            },
            record,
            selectedScoreRoster,
          );
        });
      const updatedRows = [...updatedExistingRows, ...addedRows];
      const latestOtherRosters = (
        await Promise.all(
          rosters
            .filter((roster) => roster.id !== selectedScoreRoster.id)
            .map(async (roster) => {
              const snap = await getDoc(
                doc(db, rosterCollectionPath, roster.id),
              );
              if (!snap.exists()) return null;
              return normalizePerformanceScoreRoster(
                snap.id,
                snap.data() as Omit<PerformanceScoreRoster, "id">,
              );
            }),
        )
      ).filter((roster): roster is PerformanceScoreRoster => roster !== null);
      const rostersWithEditedRows = [
        {
          ...selectedScoreRoster,
          rows: updatedRows,
        },
        ...latestOtherRosters,
      ];
      const syncedRosterRowsById = syncManualScoreRowsAcrossAssessments(
        rostersWithEditedRows,
        persistableScoreListRecords,
        manualIdentityReplacements,
        deletedRecords,
      );
      const finalUpdatedRows =
        syncedRosterRowsById.get(selectedScoreRoster.id) || updatedRows;
      const selectedRowsMeta = buildRosterRowsMeta(
        selectedScoreRoster,
        finalUpdatedRows,
      );
      const batchQueue = createBatchQueue();

      batchQueue.update(doc(db, rosterCollectionPath, selectedScoreRoster.id), {
        rows: finalUpdatedRows,
        classes: selectedRowsMeta.classes,
        targetClass: selectedRowsMeta.targetClass,
        rowCount: selectedRowsMeta.rowCount,
        matchedCount: selectedRowsMeta.matchedCount,
        unmatchedCount: selectedRowsMeta.unmatchedCount,
        updatedAt: timestamp,
      });

      syncedRosterRowsById.forEach((rows, rosterId) => {
        if (rosterId === selectedScoreRoster.id) return;
        const roster = rostersWithEditedRows.find(
          (item) => item.id === rosterId,
        );
        if (!roster) return;
        const meta = buildRosterRowsMeta(roster, rows);
        batchQueue.update(doc(db, rosterCollectionPath, rosterId), {
          rows,
          classes: meta.classes,
          targetClass: meta.targetClass,
          rowCount: meta.rowCount,
          matchedCount: meta.matchedCount,
          unmatchedCount: meta.unmatchedCount,
          updatedAt: timestamp,
        });
      });

      deletedRecords.forEach((record) => {
        if (!record.uid) return;
        const scoreId = selectedScoreRoster.id;
        const scoreRef = doc(
          db,
          "users",
          record.uid,
          PERFORMANCE_SCORE_USER_COLLECTION,
          scoreId,
        );
        const confirmationRef = doc(
          db,
          "users",
          record.uid,
          PERFORMANCE_SCORE_USER_COLLECTION,
          scoreId,
          PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION,
          record.uid,
        );
        batchQueue.delete(confirmationRef);
        batchQueue.delete(scoreRef);
      });

      recordsToWrite.forEach((record) => {
        if (!record.uid) return;
        const scoreId = selectedScoreRoster.id;
        const scoreRef = doc(
          db,
          "users",
          record.uid,
          PERFORMANCE_SCORE_USER_COLLECTION,
          scoreId,
        );
        const confirmationRef = doc(
          db,
          "users",
          record.uid,
          PERFORMANCE_SCORE_USER_COLLECTION,
          scoreId,
          PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION,
          record.uid,
        );
        const original = originalByKey.get(getScoreListRecordKey(record));
        const hadSignature = Boolean(
          record.signatureImage ||
          record.confirmation?.signatureImage ||
          original?.signatureImage ||
          original?.confirmation?.signatureImage,
        );
        const academicStatus = getAcademicStatusLabel(record);
        const hasAcademicStatus = Boolean(academicStatus);
        const items = getRecordItemsForRoster(record, selectedScoreRoster).map(
          (item) =>
            hasAcademicStatus
              ? {
                  ...item,
                  score: 0,
                  scoreEntered: false,
                }
              : item,
        );
        const itemTotalScore = getEnteredItemsTotalScore(items);
        const totalScore = hasAcademicStatus
          ? 0
          : (itemTotalScore ?? getScoreRecordFallbackTotalScore(record));
        const enteredScoreCount = getScoreRecordEnteredScoreCount(
          record,
          items,
        );

        if (hadSignature) {
          batchQueue.delete(confirmationRef);
        }

        if (!hasAcademicStatus && totalScore === null) {
          batchQueue.delete(scoreRef);
          return;
        }

        const payload: PerformanceScoreRecord = {
          rosterId: scoreId,
          title: selectedScoreRoster.title,
          subject: selectedScoreRoster.subject,
          ...(selectedScoreRoster.assessmentOrder
            ? { assessmentOrder: selectedScoreRoster.assessmentOrder }
            : {}),
          academicYear: selectedScoreRoster.academicYear || year,
          semester: selectedScoreRoster.semester || semester,
          grade: record.grade,
          class: record.class,
          number: record.number,
          studentName: record.studentName,
          uid: record.uid,
          items,
          enteredScoreCount,
          totalScore: totalScore ?? 0,
          totalMaxScore:
            getRecordTotalMaxScore(record) ||
            selectedScoreRoster.totalMaxScore ||
            0,
          feedback: String(record.feedback || "").slice(0, 1000),
          evidence: String(record.evidence || record.feedback || "").slice(
            0,
            1000,
          ),
          sourceFileName: selectedScoreRoster.sourceFileName,
          uploadedBy:
            record.uploadedBy || selectedScoreRoster.uploadedBy || editedBy,
          uploadedByEmail:
            record.uploadedByEmail ||
            selectedScoreRoster.uploadedByEmail ||
            editedByEmail,
          uploadedAt:
            record.uploadedAt || selectedScoreRoster.createdAt || timestamp,
          updatedAt: timestamp,
          ...getAcademicStatusRecordMeta(academicStatus),
        };
        batchQueue.set(scoreRef, payload);
      });

      await batchQueue.commit();

      const persistedRecordKeys = new Set(
        recordsToWrite.map((record) => getScoreListRecordKey(record)),
      );
      const finalSelectedRowNumbers = new Set(
        finalUpdatedRows.map((row) => Number(row.rowNumber) || 0),
      );
      const normalizedRecords: ScoreListRecord[] = persistableScoreListRecords
        .filter((record) => {
          if (record.uid) return true;
          const rowNumber = rowNumberByRecordKey.get(
            getScoreListRecordKey(record),
          );
          return Boolean(rowNumber && finalSelectedRowNumbers.has(rowNumber));
        })
        .map((record) => {
          const recordKey = getScoreListRecordKey(record);
          const rowNumber = rowNumberByRecordKey.get(recordKey);
          const keyedRecord =
            !record.uid && rowNumber
              ? {
                  ...record,
                  localKey: `row:${selectedScoreRoster.id}:${rowNumber}`,
                  rosterRowNumber: rowNumber,
                  isManual: true,
                }
              : record;
          if (!persistedRecordKeys.has(recordKey)) return keyedRecord;
          const hasScore =
            isTransferredScoreRecord(record) ||
            getScoreRecordEnteredScoreCount(record) > 0 ||
            getEnteredTotalScore(record) !== null;
          const cleared = clearRecordSignature(record) || record;
          return {
            ...keyedRecord,
            ...cleared,
            localKey: keyedRecord.localKey,
            rosterRowNumber: keyedRecord.rosterRowNumber,
            isManual: keyedRecord.isManual,
            scoreSource:
              keyedRecord.uid && hasScore ? "student-doc" : "roster-row",
            scoreDocumentExists: Boolean(keyedRecord.uid && hasScore),
            updatedAt: new Date(),
          };
        });

      setScoreListRecords(normalizedRecords);
      setScoreEditOriginalRecords(cloneScoreListRecords(normalizedRecords));
      setScoreEditing(false);
      setSelectedScoreListRecordKeys(new Set<string>());
      setScoreStatsRecords([]);
      setScoreStatsLoadedRosterId("");
      setClassSheetPreviewStudents([]);
      setClassSheetPreviewLoadedKey("");
      setRosters((current) =>
        sortPerformanceScoreRosters(
          current.map((roster) => {
            const rows =
              roster.id === selectedScoreRoster.id
                ? finalUpdatedRows
                : syncedRosterRowsById.get(roster.id);
            if (!rows) return roster;
            const meta = buildRosterRowsMeta(roster, rows);
            return {
              ...roster,
              rows,
              classes: meta.classes,
              targetClass: meta.targetClass,
              rowCount: meta.rowCount,
              matchedCount: meta.matchedCount,
              unmatchedCount: meta.unmatchedCount,
              updatedAt: new Date(),
            };
          }),
        ),
      );
      await loadRosters();
      showToast({
        tone: "success",
        title: "수행평가 점수표를 수정했습니다.",
        message:
          signedChangedCount > 0
            ? "변경된 점수와 근거를 DB에 저장하고 기존 확인 서명을 반려했습니다."
            : "변경된 점수와 근거를 DB에 저장했습니다.",
      });
    } catch (error) {
      console.error("Failed to update performance scores:", error);
      showToast({
        tone: "error",
        title: "점수표 수정에 실패했습니다.",
        message: getFirestoreWriteErrorMessage(error),
      });
    } finally {
      setSavingScoreEdits(false);
    }
  };

  const loadRosterRecordsForClass = async (
    roster: PerformanceScoreRoster | undefined,
    classValue: string,
    gradeValue: string,
  ) => {
    if (!roster) return [];
    const classRows = (roster.rows || []).filter(
      (row) =>
        normalizeSchoolValue(row.class) === normalizeSchoolValue(classValue) &&
        (!gradeValue ||
          normalizeSchoolValue(row.grade) === normalizeSchoolValue(gradeValue)),
    );
    const linkedRows = classRows.filter((row) => row.uid);
    const loaded: PerformanceScoreRecord[] = [];
    for (let index = 0; index < linkedRows.length; index += 40) {
      const chunk = linkedRows.slice(index, index + 40);
      const snaps = await Promise.all(
        chunk.map((row) =>
          getDoc(
            doc(
              db,
              "users",
              row.uid,
              PERFORMANCE_SCORE_USER_COLLECTION,
              roster.id,
            ),
          ),
        ),
      );
      snaps.forEach((snap, rowIndex) => {
        const row = chunk[rowIndex];
        if (snap.exists()) {
          const data = snap.data() as PerformanceScoreRecord;
          loaded.push({
            id: snap.id,
            ...data,
            items: Array.isArray(data.items) ? data.items : [],
          });
          return;
        }
        if (rosterRowHasScore(row)) {
          loaded.push(buildRecordFromRosterRow(roster, row));
        }
      });
    }
    classRows
      .filter((row) => !row.uid && shouldShowRosterRowInScoreList(row))
      .forEach((row) => {
        loaded.push(buildRecordFromRosterRow(roster, row));
      });
    const withConfirmations = await Promise.all(
      loaded.map(async (record) =>
        record.uid
          ? applyPerformanceScoreConfirmation(
              record,
              await loadPerformanceScoreConfirmation(record.uid, roster.id),
            )
          : record,
      ),
    );
    return sortPerformanceScoreRecords(withConfirmations).sort(
      (a, b) =>
        Number(a.grade) - Number(b.grade) ||
        Number(a.class) - Number(b.class) ||
        Number(a.number) - Number(b.number) ||
        String(a.studentName || "").localeCompare(
          String(b.studentName || ""),
          "ko",
        ),
    );
  };

  const ensureClassSheetSelection = () => {
    if (
      !summaryExportRosters.firstRoster ||
      !summaryExportRosters.secondRoster
    ) {
      showToast({
        tone: "warning",
        title: "일람표 점수표를 선택해 주세요.",
        message:
          "1차와 2차 수행평가 점수표를 모두 선택해야 확인할 수 있습니다.",
      });
      return false;
    }
    if (!classSheetClassFilter) {
      showToast({
        tone: "warning",
        title: "반을 선택해 주세요.",
        message: "일람표는 학급별로 생성합니다.",
      });
      return false;
    }
    return true;
  };

  const loadClassSheetStudentsForSelection = async () => {
    const [firstRecords, secondRecords] = await Promise.all([
      loadRosterRecordsForClass(
        summaryExportRosters.firstRoster,
        classSheetClassFilter,
        classSheetGradeFilter,
      ),
      loadRosterRecordsForClass(
        summaryExportRosters.secondRoster,
        classSheetClassFilter,
        classSheetGradeFilter,
      ),
    ]);

    const studentMap = new Map<string, ClassSheetStudent>();
    firstRecords.forEach((record) =>
      addRecordToClassSheetStudentMap(studentMap, record, "firstRecord"),
    );
    secondRecords.forEach((record) =>
      addRecordToClassSheetStudentMap(studentMap, record, "secondRecord"),
    );

    return getClassSheetStudentsFromMap(studentMap).sort(
      (a, b) =>
        Number(a.grade) - Number(b.grade) ||
        Number(a.class) - Number(b.class) ||
        Number(a.number) - Number(b.number) ||
        String(a.studentName || "").localeCompare(
          String(b.studentName || ""),
          "ko",
        ),
    );
  };

  const refreshClassSheetPreview = async () => {
    if (!ensureClassSheetSelection() || classSheetPreviewLoading) return;
    setClassSheetPreviewLoading(true);
    try {
      const studentsForSheet = await loadClassSheetStudentsForSelection();
      setClassSheetPreviewStudents(studentsForSheet);
      setClassSheetPreviewLoadedKey(classSheetSelectionKey);
      if (!studentsForSheet.length) {
        showToast({
          tone: "warning",
          title: "조회할 학생 점수가 없습니다.",
          message: "선택한 학년과 반에 저장된 수행평가 점수가 없습니다.",
        });
      }
    } catch (error) {
      console.error("Failed to load class sheet status:", error);
      showToast({
        tone: "error",
        title: "일람표 현황을 불러오지 못했습니다.",
        message: "점수와 서명 기록을 다시 확인한 뒤 시도해 주세요.",
      });
    } finally {
      setClassSheetPreviewLoading(false);
    }
  };

  const downloadClassSummarySheet = async () => {
    if (!ensureClassSheetSelection() || exportingClassSheet) return;
    const exportGrade = classSheetGradeFilter || targetGrade;
    setExportingClassSheet(true);
    try {
      const studentsForSheet = await loadClassSheetStudentsForSelection();
      setClassSheetPreviewStudents(studentsForSheet);
      setClassSheetPreviewLoadedKey(classSheetSelectionKey);

      if (!studentsForSheet.length) {
        showToast({
          tone: "warning",
          title: "다운로드할 학생 점수가 없습니다.",
          message: "현재 선택한 학년과 반에 저장된 수행평가 점수가 없습니다.",
        });
        return;
      }

      const unsignedStudents = studentsForSheet.filter(
        (student) =>
          !getConfirmedSignatureRecord(
            student,
            classSheetSignatureRequirements,
          ),
      );
      if (unsignedStudents.length > 0) {
        const visibleUnsignedStudents = unsignedStudents.slice(0, 50);
        const remaining = unsignedStudents.length - 50;
        const confirmed = await confirm({
          tone: "warning",
          title: `${classSheetClassFilter}반 서명 미완료 학생이 있습니다.`,
          message: (
            <div className="space-y-3">
              <p>
                서명 미완료 학생 {unsignedStudents.length}명이 있습니다. 그래도
                일람표를 다운로드할까요?
              </p>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2">
                <ol className="space-y-1 text-sm font-bold text-amber-950">
                  {visibleUnsignedStudents.map((student, index) => (
                    <li
                      key={`${student.class}-${student.number}-${student.uid || student.studentName}`}
                    >
                      {index + 1}. {student.class}반 {student.number}번{" "}
                      {student.studentName}
                    </li>
                  ))}
                </ol>
                {remaining > 0 && (
                  <div className="mt-2 text-xs font-black text-amber-700">
                    외 {remaining}명
                  </div>
                )}
              </div>
            </div>
          ),
          confirmLabel: "그래도 다운로드",
        });
        if (!confirmed) return;
      }

      const teacherName = currentUser?.displayName || "방재석";
      const printClientInfo = await loadClassSheetPrintClientInfo();
      const exportParams = {
        year,
        semester,
        grade: exportGrade,
        classValue: classSheetClassFilter,
        subject:
          summaryExportRosters.firstRoster?.subject ||
          summaryExportRosters.secondRoster?.subject ||
          selectedScoreRoster?.subject ||
          "역사",
        teacherName,
        schoolName: CLASS_SHEET_SCHOOL_NAME,
        printedAt: new Date(),
        clientIp: printClientInfo.clientIp,
        firstRoster: summaryExportRosters.firstRoster,
        secondRoster: summaryExportRosters.secondRoster,
        students: studentsForSheet,
      };
      const blob = await buildClassSummaryWorkbookFromTemplate(exportParams);
      saveBlobAsFile(
        blob,
        `${year}학년도 ${semester}학기 ${exportGrade}학년 역사과 수행평가 일람표 ${classSheetClassFilter}반.xlsx`,
      );
      showToast({
        tone: "success",
        title: "일람표를 다운로드했습니다.",
        message: `${classSheetClassFilter}반 ${studentsForSheet.length}명의 점수와 서명 상태를 반영했습니다.`,
      });
    } catch (error) {
      console.error("Failed to export performance score class sheet:", error);
      showToast({
        tone: "error",
        title: "일람표 다운로드에 실패했습니다.",
        message:
          error instanceof Error
            ? `원본 일람표 양식과 서명 기록을 다시 확인해 주세요. (${error.message})`
            : "원본 일람표 양식과 점수, 서명 기록을 다시 확인해 주세요.",
      });
    } finally {
      setExportingClassSheet(false);
    }
  };

  const rejectClassSheetSignature = async (student: ClassSheetStudent) => {
    if (rejectingSignatureKey) return;
    if (!student.uid) {
      showToast({
        tone: "warning",
        title: "학생 계정 연결을 확인해 주세요.",
        message: "서명 반려는 위스토리 학생 계정과 연결된 명단만 가능합니다.",
      });
      return;
    }

    const recordsToReject = [
      summaryExportRosters.firstRoster ? student.firstRecord : undefined,
      summaryExportRosters.secondRoster ? student.secondRecord : undefined,
    ].filter((record): record is PerformanceScoreRecord =>
      Boolean(record && getRecordScoreId(record)),
    );
    const signedRecords = recordsToReject.filter(
      (record) => record.signatureImage || record.confirmation?.signatureImage,
    );

    if (!signedRecords.length) {
      showToast({
        tone: "warning",
        title: "반려할 서명이 없습니다.",
        message: "이미 서명 미완료 상태인 학생입니다.",
      });
      return;
    }

    const scoreTitles = signedRecords
      .map((record, index) => `${index + 1}. ${record.title}`)
      .join("\n");
    const confirmed = await confirm({
      title: "점수 확인 서명을 반려할까요?",
      message: [
        `${student.class}반 ${student.number}번 ${student.studentName} 학생의 점수 확인 서명을 반려할까요?`,
        "학생 점수는 유지되고, 확인 서명만 삭제됩니다.",
        "반려 후에만 학생이 다시 서명할 수 있습니다.",
        "",
        scoreTitles,
      ].join("\n"),
      confirmLabel: "서명 반려",
      tone: "danger",
    });
    if (!confirmed) return;

    const studentKey = getClassSheetStudentKey(student);
    setRejectingSignatureKey(studentKey);
    try {
      const batchQueue = createBatchQueue();
      signedRecords.forEach((record) => {
        const scoreId = getRecordScoreId(record);
        batchQueue.update(
          doc(
            db,
            "users",
            student.uid,
            PERFORMANCE_SCORE_USER_COLLECTION,
            scoreId,
          ),
          {
            signatureName: deleteField(),
            signatureImage: deleteField(),
            signedAt: deleteField(),
          },
        );
        batchQueue.delete(
          doc(
            db,
            "users",
            student.uid,
            PERFORMANCE_SCORE_USER_COLLECTION,
            scoreId,
            PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION,
            student.uid,
          ),
        );
      });
      await batchQueue.commit();

      const rejectedScoreTitles = signedRecords
        .map((record) => record.title)
        .filter(Boolean);
      const rejectedScoreTitle =
        rejectedScoreTitles.length === 1
          ? rejectedScoreTitles[0]
          : `${rejectedScoreTitles.length}개 수행평가`;
      const rejectedScoreIds = signedRecords
        .map(getRecordScoreId)
        .filter(Boolean);
      const rejectedSignatureTokens = signedRecords
        .map((record) => {
          const scoreId = getRecordScoreId(record);
          const signatureMillis = getTimestampMillis(
            record.confirmation?.confirmedAt ||
              record.signedAt ||
              record.confirmation?.updatedAt ||
              record.updatedAt,
          );
          return `${scoreId}:${signatureMillis}`;
        })
        .filter(Boolean)
        .sort();
      let notificationSent = false;
      try {
        const notificationResult = await createManagedNotifications(config, {
          recipientUids: [student.uid],
          type: "performance_score_signature_rejected",
          title: "수행평가 서명 반려",
          body: `교사가 ${rejectedScoreTitle} 점수 확인 서명을 반려했습니다. 점수를 다시 확인한 뒤 서명해 주세요.`,
          targetUrl: "/student/score/performance",
          entityType: "performance_score_signature",
          entityId: rejectedScoreIds.join("|"),
          priority: "high",
          dedupeKey: `performance_score_signature_rejected:${year}:${semester}:${student.uid}:${rejectedSignatureTokens.join("|") || rejectedScoreIds.join("|")}`,
          templateValues: {
            studentName: student.studentName,
            studentScope: `${student.class}반 ${student.number}번`,
            scoreTitle: rejectedScoreTitle,
            scoreCount: signedRecords.length,
          },
        });
        notificationSent = notificationResult.createdCount > 0;
      } catch (notificationError) {
        console.warn(
          "Failed to create performance score signature rejection notification:",
          notificationError,
        );
      }

      setClassSheetPreviewStudents((current) =>
        current.map((item) =>
          getClassSheetStudentKey(item) === studentKey
            ? {
                ...item,
                firstRecord: clearRecordSignature(item.firstRecord),
                secondRecord: clearRecordSignature(item.secondRecord),
              }
            : item,
        ),
      );
      showToast({
        tone: "success",
        title: "서명을 반려했습니다.",
        message: notificationSent
          ? `${student.studentName} 학생에게 서명 반려 알림을 보냈습니다.`
          : `${student.studentName} 학생은 다시 점수 확인 및 서명을 진행할 수 있습니다. 알림은 전송하지 못했습니다.`,
      });
    } catch (error) {
      console.error("Failed to reject performance score signature:", error);
      showToast({
        tone: "error",
        title: "서명 반려에 실패했습니다.",
        message: getFirestoreWriteErrorMessage(error),
      });
    } finally {
      setRejectingSignatureKey("");
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!targetGrade.trim()) {
      showToast({
        tone: "warning",
        title: "대상 학년을 선택해 주세요.",
        message: "파일에 학년 컬럼이 없을 때 학생 연결에 사용됩니다.",
      });
      return;
    }

    setParsing(true);
    try {
      const rows = await readWorkbookRows(file);
      const parsedUpload = parsePerformanceScoreWorkbook(rows, {
        fileName: file.name,
        targetGrade,
        fallbackClass,
      });
      const detectedPreset = getDefaultAssessmentPreset(parsedUpload);
      const selectedPreset = uploadAssessmentPreset;
      const assessmentConfig = getAssessmentConfig(
        parsedUpload,
        selectedPreset,
      );
      setTitle(assessmentConfig.title || parsedUpload.title);
      if (assessmentConfig.subject) {
        setSubject(assessmentConfig.subject);
      }
      const matchedRows = matchRowsToStudents(parsedUpload.rows, students);
      setAssessmentPreset(selectedPreset);
      setPreviewClassFilter("all");
      setPreviewPage(1);
      setParsed({
        ...parsedUpload,
        title: assessmentConfig.title || parsedUpload.title,
        subject: assessmentConfig.subject || parsedUpload.subject,
        assessmentOrder: assessmentConfig.assessmentOrder,
        rows: matchedRows,
      });
      setUploadModalOpen(false);
      showToast({
        tone:
          detectedPreset !== "auto" && detectedPreset !== selectedPreset
            ? "warning"
            : "success",
        title: "수행평가 명단을 인식했습니다.",
        message:
          detectedPreset !== "auto" && detectedPreset !== selectedPreset
            ? `${matchedRows.length}개 행을 선택한 수행평가 기준으로 불러왔습니다. 파일명과 선택한 수행평가가 맞는지 확인해 주세요.`
            : `${matchedRows.length}개 행을 확인했습니다. 저장 전 미연결 학생을 점검해 주세요.`,
      });
    } catch (error) {
      console.error("Failed to parse performance score workbook:", error);
      showToast({
        tone: "error",
        title: "파일 인식에 실패했습니다.",
        message:
          error instanceof Error
            ? error.message
            : "엑셀 파일의 헤더와 점수 컬럼을 확인해 주세요.",
      });
    } finally {
      setParsing(false);
    }
  };

  const updateFeedback = (rowKey: string, feedback: string) => {
    setParsed((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.rowKey === rowKey
                ? {
                    ...row,
                    feedback: feedback.slice(0, 1000),
                    evidence: feedback.slice(0, 1000),
                  }
                : row,
            ),
          }
        : current,
    );
  };

  const updateAssessmentPreset = (preset: AssessmentPresetKey) => {
    setAssessmentPreset(preset);
    if (!parsed) return;
    const config = getAssessmentConfig(parsed, preset);
    if (config.title) setTitle(config.title);
    if (config.subject) setSubject(config.subject);
    setParsed({
      ...parsed,
      title: config.title || parsed.title,
      subject: config.subject || parsed.subject,
      assessmentOrder: config.assessmentOrder,
    });
  };

  const saveParsedScores = async () => {
    if (!parsed || saving) return;
    const assessmentConfig = getAssessmentConfig(parsed, assessmentPreset);
    const safeTitle = title.trim() || assessmentConfig.title;
    if (!safeTitle) {
      showToast({
        tone: "warning",
        title: "평가명을 입력해 주세요.",
        message: "학생 화면에 표시될 수행평가 이름이 필요합니다.",
      });
      return;
    }

    const linkedRows = parsed.rows.filter((row) => row.uid);
    if (!linkedRows.length) {
      showToast({
        tone: "warning",
        title: "연결된 학생이 없습니다.",
        message: "학생 명단과 연결된 행이 있어야 저장할 수 있습니다.",
      });
      return;
    }

    const saveableRows = linkedRows.filter((row) => row.enteredScoreCount > 0);
    if (!saveableRows.length) {
      showToast({
        tone: "warning",
        title: "점수가 입력된 학생 행이 없습니다.",
        message: "점수 칸에 입력된 값이 있는 연결 학생만 저장할 수 있습니다.",
      });
      return;
    }

    const connectedBlankScoreCount = linkedRows.length - saveableRows.length;
    const unmatchedRows = parsed.rows.filter((row) => !row.uid);
    const warningRows = parsed.rows.filter(
      (row) => row.matchStatus === "name-mismatch",
    );
    const skippedMessages = [
      parsedSummary.unmatchedCount > 0
        ? `미연결 학생 ${parsedSummary.unmatchedCount}명`
        : "",
      connectedBlankScoreCount > 0
        ? `점수가 비어 있는 연결 학생 ${connectedBlankScoreCount}명`
        : "",
      parsedSummary.warningCount > 0
        ? `이름 확인이 필요한 연결 학생 ${parsedSummary.warningCount}명`
        : "",
    ].filter(Boolean);
    if (skippedMessages.length > 0) {
      const confirmed = await confirm({
        title: "저장 전 확인이 필요합니다.",
        message: [
          `확인 사항: ${skippedMessages.join(", ")}`,
          `점수가 입력된 연결 학생 ${saveableRows.length}명만 저장됩니다.`,
          unmatchedRows.length > 0 ? "" : "",
          unmatchedRows.length > 0 ? "미연결 학생 명단:" : "",
          unmatchedRows.length > 0 ? formatRowsForConfirm(unmatchedRows) : "",
          warningRows.length > 0 ? "" : "",
          warningRows.length > 0 ? "이름 확인 필요 학생 명단:" : "",
          warningRows.length > 0 ? formatRowsForConfirm(warningRows) : "",
          "",
          "정말 저장할까요?",
        ]
          .filter((line) => line !== "")
          .join("\n"),
        confirmLabel: "입력된 학생만 저장",
        tone: "warning",
      });
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      const safeSubject = subject.trim() || assessmentConfig.subject;
      const assessmentOrder = assessmentConfig.assessmentOrder;
      const rosterRef = doc(collection(db, rosterCollectionPath));
      const rosterId = rosterRef.id;
      const timestamp = serverTimestamp();
      const rosterRows: PerformanceScoreRosterRow[] = parsed.rows.map(
        ({
          rowKey: _rowKey,
          enteredScoreCount: _enteredScoreCount,
          items: _items,
          feedback: _feedback,
          evidence: _evidence,
          ...row
        }) => ({
          rowNumber: row.rowNumber,
          uid: row.uid,
          grade: row.grade,
          class: row.class,
          number: row.number,
          studentName: row.studentName,
          items: Array.isArray(_items) ? _items : [],
          enteredScoreCount: _enteredScoreCount,
          totalScore: row.totalScore,
          totalMaxScore: row.totalMaxScore,
          feedback: _feedback || "",
          evidence: _evidence || _feedback || "",
          matchStatus: row.matchStatus,
          matchMessage: row.matchMessage,
        }),
      );
      const classList = Array.from(
        new Set(parsed.rows.map((row) => row.class).filter(Boolean)),
      ).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"));

      const batchQueue = createBatchQueue();
      batchQueue.set(rosterRef, {
        title: safeTitle,
        subject: safeSubject,
        ...(assessmentOrder ? { assessmentOrder } : {}),
        academicYear: year,
        semester,
        targetGrade,
        targetClass:
          classList.length === 1 ? classList[0] : fallbackClass.trim(),
        classes: classList,
        items: parsed.items,
        totalMaxScore: parsed.totalMaxScore,
        rowCount: parsed.rows.length,
        matchedCount: saveableRows.length,
        unmatchedCount: parsed.rows.length - saveableRows.length,
        sourceFileName: parsed.sourceFileName,
        rows: rosterRows,
        uploadedBy: currentUser?.uid || "",
        uploadedByEmail: currentUser?.email || "",
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies Omit<PerformanceScoreRoster, "id">);

      const savedScoreRecords: ScoreListRecord[] = [];
      saveableRows.forEach((row) => {
        const userScoreRef = doc(
          db,
          "users",
          row.uid,
          PERFORMANCE_SCORE_USER_COLLECTION,
          rosterId,
        );
        const payload: PerformanceScoreRecord = {
          rosterId,
          title: safeTitle,
          subject: safeSubject,
          ...(assessmentOrder ? { assessmentOrder } : {}),
          academicYear: year,
          semester,
          grade: row.grade,
          class: row.class,
          number: row.number,
          studentName: row.studentName,
          uid: row.uid,
          items: row.items,
          enteredScoreCount: row.enteredScoreCount,
          totalScore: row.totalScore,
          totalMaxScore: row.totalMaxScore,
          feedback: row.feedback,
          evidence: row.evidence || row.feedback,
          sourceFileName: parsed.sourceFileName,
          uploadedBy: currentUser?.uid || "",
          uploadedByEmail: currentUser?.email || "",
          uploadedAt: timestamp,
          updatedAt: timestamp,
        };
        batchQueue.set(userScoreRef, payload);
        savedScoreRecords.push({
          id: rosterId,
          ...payload,
          scoreSource: "student-doc",
          scoreDocumentExists: true,
        });
      });

      await batchQueue.commit();
      setParsed(null);
      setScoreListRosterId(rosterId);
      setScoreListLoadedRosterId(rosterId);
      setScoreListLoadError("");
      setScoreEditing(false);
      setScoreEditOriginalRecords([]);
      setScoreListGradeFilter("all");
      setScoreListClassFilter("all");
      setScoreListSearch("");
      setScoreListSummaryStudents([]);
      setScoreListSummaryLoadedKey("");
      setScoreListRecords(sortStudentIdentityRows(savedScoreRecords));
      await loadRosters();
      showToast({
        tone: "success",
        title: "수행평가 점수를 저장했습니다.",
        message: `${saveableRows.length}명의 학생 화면에 본인 점수만 표시됩니다.`,
      });
    } catch (error) {
      console.error("Failed to save performance scores:", error);
      showToast({
        tone: "error",
        title: "점수 저장에 실패했습니다.",
        message: getFirestoreWriteErrorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteRoster = async (roster: PerformanceScoreRoster) => {
    if (deletingRosterId || scoreEditing || savingScoreEdits) return;
    const confirmed = await confirm({
      title: "수행평가 점수표를 삭제할까요?",
      message: `${roster.title} 업로드 기록과 학생별 점수 문서를 삭제합니다.`,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!confirmed) return;

    scoreDocumentSyncRunRef.current += 1;
    setDeletingRosterId(roster.id);
    try {
      const batchQueue = createBatchQueue();
      batchQueue.delete(doc(db, rosterCollectionPath, roster.id));
      const staleScoreDocs = await getDocs(
        query(
          collectionGroup(db, PERFORMANCE_SCORE_USER_COLLECTION),
          where("rosterId", "==", roster.id),
        ),
      );
      staleScoreDocs.forEach((scoreDoc) => {
        const ownerUid =
          scoreDoc.ref.parent.parent?.id ||
          String((scoreDoc.data() as PerformanceScoreRecord).uid || "");
        if (ownerUid) {
          batchQueue.delete(
            doc(
              scoreDoc.ref,
              PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION,
              ownerUid,
            ),
          );
        }
        batchQueue.delete(scoreDoc.ref);
      });
      (roster.rows || [])
        .filter((row) => row.uid)
        .forEach((row) => {
          batchQueue.delete(
            doc(
              db,
              "users",
              row.uid,
              PERFORMANCE_SCORE_USER_COLLECTION,
              roster.id,
              PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION,
              row.uid,
            ),
          );
          batchQueue.delete(
            doc(
              db,
              "users",
              row.uid,
              PERFORMANCE_SCORE_USER_COLLECTION,
              roster.id,
            ),
          );
        });
      await batchQueue.commit();
      if (scoreListRosterId === roster.id || scoreListAllSelected) {
        setScoreListLoadedRosterId("");
        setScoreListRecords([]);
        setScoreListSummaryStudents([]);
        setScoreListSummaryLoadedKey("");
        setScoreEditing(false);
        setScoreEditOriginalRecords([]);
      }
      if (
        scoreStatsLoadedRosterId.split(":").includes(roster.id) ||
        scoreStatsLoadedRosterId.startsWith(SCORE_LIST_ALL_ROSTERS_VALUE)
      ) {
        setScoreStatsRecords([]);
        setScoreStatsLoadedRosterId("");
      }
      setClassSheetPreviewStudents([]);
      setClassSheetPreviewLoadedKey("");
      await loadRosters();
      showToast({
        tone: "success",
        title: "업로드 기록을 삭제했습니다.",
        message: "학생별 수행평가 점수 문서도 함께 삭제했습니다.",
      });
    } catch (error) {
      console.error("Failed to delete performance score roster:", error);
      showToast({
        tone: "error",
        title: "삭제에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setDeletingRosterId("");
    }
  };

  const selectScoreRoster = (rosterId: string) => {
    setScoreListRosterId(rosterId);
    setScoreListLoadedRosterId("");
    setScoreListRecords([]);
    setScoreListSummaryStudents([]);
    setScoreListSummaryLoadedKey("");
    setScoreListLoadError("");
    setScoreEditing(false);
    setScoreEditOriginalRecords([]);
    setScoreListClassFilter("all");
    setScoreListClassPage(1);
  };

  const openRosterForEditing = async (roster: PerformanceScoreRoster) => {
    if (scoreListLoading || scoreEditing || savingScoreEdits) return;
    setScoreListRosterId(roster.id);
    setScoreListSummaryStudents([]);
    setScoreListSummaryLoadedKey("");
    setScoreListClassFilter("all");
    setScoreListClassPage(1);
    setScoreListSearch("");
    setUploadModalOpen(false);
    await loadScoreListRecords(roster, { startEdit: true });
  };

  const openScoreStatsModal = () => {
    if (!scoreStatsAnyAvailable) return;
    if (!scoreStatsSelectionReady) {
      setScoreStatsMode(
        scoreStatsFirstRoster && scoreStatsSecondRoster
          ? "all"
          : scoreStatsFirstRoster
            ? "first"
            : "second",
      );
    }
    setScoreStatsModalOpen(true);
  };

  useEffect(() => {
    if (!scoreStatsModalOpen || !scoreStatsSelectionReady) return;
    void loadScoreStatsRecords();
  }, [scoreStatsModalOpen, scoreStatsLoadKey, scoreStatsSelectionReady]);

  const selectedScoreClassLabel = scoreStatsClassFilter
    ? `${scoreStatsClassFilter}반`
    : "선택 학급";
  const scoreStatsButtonDisabled =
    rostersLoading ||
    !scoreStatsAnyAvailable ||
    scoreEditing ||
    savingScoreEdits;
  const scoreStatsButtonTitle = scoreStatsButtonDisabled
    ? "저장된 수행평가 점수표가 있어야 통계를 확인할 수 있습니다."
    : `전체, 1차 ${SCORE_LIST_FIRST_SUMMARY_LABEL}, 2차 ${SCORE_LIST_SECOND_SUMMARY_LABEL} 수행평가 통계 보기`;

  const toggleScoreListSort = (key: ScoreListSortKey) => {
    setScoreListSort((current) =>
      current.key === key
        ? {
            key,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : { key, direction: "asc" },
    );
  };

  const toggleClassStatsSort = (key: ClassStatsSortKey) => {
    setClassStatsSort((current) =>
      current.key === key
        ? {
            key,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : { key, direction: "asc" },
    );
  };

  const getScoreListAriaSort = (
    key: ScoreListSortKey,
  ): "ascending" | "descending" | "none" =>
    scoreListSort.key === key
      ? scoreListSort.direction === "asc"
        ? "ascending"
        : "descending"
      : "none";

  const getClassStatsAriaSort = (
    key: ClassStatsSortKey,
  ): "ascending" | "descending" | "none" =>
    classStatsSort.key === key
      ? classStatsSort.direction === "asc"
        ? "ascending"
        : "descending"
      : "none";

  const getSortIconClass = (active: boolean, direction: SortDirection) => {
    if (!active) return "fas fa-sort text-[10px] text-slate-300";
    return direction === "asc"
      ? "fas fa-sort-up text-[10px] text-blue-600"
      : "fas fa-sort-down text-[10px] text-blue-600";
  };

  const renderScoreListHeader = (
    key: ScoreListSortKey,
    label: React.ReactNode,
    align: "left" | "right" = "left",
  ) => {
    const active = scoreListSort.key === key;
    return (
      <th
        key={String(key)}
        className={`whitespace-nowrap px-3 py-3 ${align === "right" ? "text-right" : ""}`}
        aria-sort={getScoreListAriaSort(key)}
      >
        <button
          type="button"
          onClick={() => toggleScoreListSort(key)}
          className={`inline-flex w-full items-center gap-1 text-xs font-black text-slate-500 transition hover:text-blue-700 ${
            align === "right" ? "justify-end" : "justify-start"
          }`}
        >
          <span>{label}</span>
          <i
            className={getSortIconClass(active, scoreListSort.direction)}
            aria-hidden="true"
          ></i>
        </button>
      </th>
    );
  };

  const renderClassStatsHeader = (
    key: ClassStatsSortKey,
    label: React.ReactNode,
    align: "left" | "right" = "left",
  ) => {
    const active = classStatsSort.key === key;
    return (
      <th
        key={String(key)}
        className={`whitespace-nowrap px-3 py-3 ${align === "right" ? "text-right" : ""}`}
        aria-sort={getClassStatsAriaSort(key)}
      >
        <button
          type="button"
          onClick={() => toggleClassStatsSort(key)}
          className={`inline-flex w-full items-center gap-1 text-xs font-black text-slate-500 transition hover:text-blue-700 ${
            align === "right" ? "justify-end" : "justify-start"
          }`}
        >
          <span>{label}</span>
          <i
            className={getSortIconClass(active, classStatsSort.direction)}
            aria-hidden="true"
          ></i>
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-6" aria-busy={savingScoreEdits || undefined}>
      {savingScoreEdits && (
        <LoadingOverlay
          message="수행평가 점수표를 저장하는 중입니다."
          detail="학생 점수와 학적 변동을 DB에 반영하고 있습니다."
          warning="저장이 완료될 때까지 다른 버튼을 누르지 마세요."
          zIndexClassName="z-[240]"
        />
      )}

      {scoreWarningModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="performance-score-warning-title"
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0 break-keep">
                <h3
                  id="performance-score-warning-title"
                  className="text-lg font-black text-slate-900"
                >
                  학생 점수 확인 경고 문구
                </h3>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
                  학생은 이 문구에 동의해야 내 수행평가 점수 확인, 서명, 이의
                  제기를 진행할 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setScoreWarningModalOpen(false)}
                disabled={scoreWarningSaving}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="경고 문구 설정 닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void loadScoreWarningSettings()}
                  disabled={scoreWarningLoading || scoreWarningSaving}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <i
                    className={`fas fa-sync-alt text-xs ${
                      scoreWarningLoading ? "animate-spin" : ""
                    }`}
                    aria-hidden="true"
                  />
                  새로고침
                </button>
              </div>

              <textarea
                value={scoreWarningDraft}
                onChange={(event) => setScoreWarningDraft(event.target.value)}
                disabled={scoreWarningLoading || scoreWarningSaving}
                maxLength={PERFORMANCE_SCORE_WARNING_MAX_LENGTH + 1}
                rows={6}
                className="mt-3 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-bold leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-50 disabled:bg-slate-50"
                placeholder={DEFAULT_PERFORMANCE_SCORE_WARNING_TEXT}
              />
              <div
                className={`mt-2 text-xs font-bold ${
                  scoreWarningDraft.length >
                  PERFORMANCE_SCORE_WARNING_MAX_LENGTH
                    ? "text-rose-600"
                    : "text-slate-500"
                }`}
              >
                {scoreWarningDraft.length}/
                {PERFORMANCE_SCORE_WARNING_MAX_LENGTH}자 · 현재 버전{" "}
                {scoreWarningSettings.warningVersion}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={() =>
                  setScoreWarningDraft(DEFAULT_PERFORMANCE_SCORE_WARNING_TEXT)
                }
                disabled={scoreWarningLoading || scoreWarningSaving}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                기본 문구
              </button>
              <button
                type="button"
                onClick={() => void saveScoreWarningSettings()}
                disabled={
                  scoreWarningLoading ||
                  scoreWarningSaving ||
                  scoreWarningDraft.length >
                    PERFORMANCE_SCORE_WARNING_MAX_LENGTH
                }
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <i className="fas fa-save text-xs" aria-hidden="true" />
                {scoreWarningSaving ? "저장 중" : "문구 저장"}
              </button>
            </div>
          </section>
        </div>
      )}

      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
          <section className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  수행평가 점수표 업로드
                </h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  업로드할 수행평가를 선택한 뒤 엑셀 파일을 골라 주세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                disabled={parsing}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="업로드 창 닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>

            <div className="max-h-[78vh] overflow-y-auto px-5 py-5">
              <label className="block">
                <span className="text-xs font-black text-slate-600">
                  수행평가 선택
                </span>
                <select
                  value={uploadAssessmentPreset}
                  onChange={(event) =>
                    setUploadAssessmentPreset(
                      event.target.value as UploadAssessmentPresetKey,
                    )
                  }
                  disabled={parsing}
                  className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-50 disabled:bg-slate-100"
                >
                  {UPLOAD_ASSESSMENT_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-black text-slate-600">
                    대상 학년
                  </span>
                  <select
                    value={targetGrade}
                    onChange={(event) => setTargetGrade(event.target.value)}
                    disabled={parsing}
                    className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-50 disabled:bg-slate-100"
                  >
                    {DEFAULT_GRADE_OPTIONS.map((grade) => (
                      <option key={grade} value={grade}>
                        {grade}학년
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-black text-slate-600">
                    기본 반
                  </span>
                  <select
                    value={fallbackClass}
                    onChange={(event) => setFallbackClass(event.target.value)}
                    disabled={parsing}
                    className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-50 disabled:bg-slate-100"
                  >
                    <option value="">파일에서 인식</option>
                    {DEFAULT_CLASS_OPTIONS.map((classValue) => (
                      <option key={classValue} value={classValue}>
                        {classValue}반
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {UPLOAD_ASSESSMENT_OPTIONS.map((option) => {
                  const selected = uploadAssessmentPreset === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setUploadAssessmentPreset(option.key)}
                      disabled={parsing}
                      className={`rounded-lg border px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="text-sm font-black text-slate-900">
                        {option.label}
                      </div>
                      <div className="mt-1 text-xs font-bold leading-5 text-slate-500">
                        {option.description}
                      </div>
                    </button>
                  );
                })}
              </div>

              <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-blue-200 bg-blue-50 px-4 py-8 text-center transition hover:bg-blue-100">
                <i
                  className="fas fa-file-excel mb-3 text-2xl text-blue-600"
                  aria-hidden="true"
                ></i>
                <span className="text-sm font-black text-blue-900">
                  {parsing ? "파일 인식 중..." : "엑셀 파일 선택"}
                </span>
                <span className="mt-1 text-xs font-bold text-blue-700">
                  .xlsx 파일을 선택하면 미리보기 화면으로 이동합니다.
                </span>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(event) => void handleUpload(event)}
                  disabled={parsing}
                />
              </label>

              <div className="mt-5 border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-black text-slate-800">
                    업로드 기록
                  </h4>
                  <span className="text-xs font-bold text-slate-400">
                    {rosters.length}개
                  </span>
                </div>
                {rostersLoading ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-400">
                    업로드 기록을 불러오는 중입니다.
                  </div>
                ) : rosters.length === 0 ? (
                  <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-400">
                    아직 저장된 업로드 기록이 없습니다.
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {rosters.map((roster) => (
                      <div
                        key={roster.id}
                        className={`flex flex-col gap-3 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${
                          scoreListRosterId === roster.id
                            ? "border-blue-200 bg-blue-50/60"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h5 className="truncate text-sm font-black text-slate-900">
                              {roster.title}
                            </h5>
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-black text-blue-700">
                              {roster.targetGrade}학년
                            </span>
                            {roster.classes?.length > 0 && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">
                                {roster.classes.join(", ")}반
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500">
                            <span>저장 {roster.matchedCount}명</span>
                            <span>전체 {roster.rowCount}명</span>
                            <span>
                              만점{" "}
                              {formatPerformanceScore(roster.totalMaxScore)}점
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              selectScoreRoster(roster.id);
                              setUploadModalOpen(false);
                            }}
                            disabled={scoreEditing || savingScoreEdits}
                            className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <i className="fas fa-list" aria-hidden="true"></i>
                            선택
                          </button>
                          <button
                            type="button"
                            onClick={() => void openRosterForEditing(roster)}
                            disabled={
                              scoreListLoading ||
                              scoreEditing ||
                              savingScoreEdits
                            }
                            className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-black text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <i
                              className="fas fa-pen-to-square"
                              aria-hidden="true"
                            ></i>
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteRoster(roster)}
                            disabled={
                              deletingRosterId === roster.id ||
                              scoreEditing ||
                              savingScoreEdits
                            }
                            className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-white px-3 text-xs font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <i className="fas fa-trash" aria-hidden="true"></i>
                            {deletingRosterId === roster.id
                              ? "삭제 중"
                              : "삭제"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {scoreStatsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="performance-score-stats-title"
            className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
          >
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h3
                  id="performance-score-stats-title"
                  className="text-lg font-black text-slate-900"
                >
                  수행평가 통계
                </h3>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
                  {scoreStatsTitle} · {selectedScoreClassLabel} 기준 · 평균은
                  점수 입력 학생만 산출합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setScoreStatsModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                aria-label="통계 보기 창 닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              {!scoreStatsSelectionReady ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm font-bold text-slate-400">
                  저장된 수행평가 점수표가 있으면 통계를 확인할 수 있습니다.
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 xl:grid-cols-[1fr_auto_220px]">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-slate-900">
                        {scoreStatsTitle}
                      </div>
                      <div className="mt-1 text-xs font-bold text-slate-500">
                        전체 {scoreStats.overall.count}명 산출 · 반별 비교 기준
                        · 개별 학생 점수는 표시하지 않습니다.
                      </div>
                    </div>
                    <div>
                      <div className="mb-1.5 text-xs font-black text-slate-500">
                        보기 기준
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {scoreStatsModeOptions.map((option) => {
                          const selected = scoreStatsMode === option.mode;
                          return (
                            <button
                              key={option.mode}
                              type="button"
                              onClick={() => setScoreStatsMode(option.mode)}
                              disabled={option.disabled || scoreStatsLoading}
                              className={`inline-flex min-h-10 max-w-full items-center justify-center rounded-lg border px-3 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${
                                selected
                                  ? "border-blue-600 bg-blue-600 text-white"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-blue-700"
                              }`}
                            >
                              <span className="whitespace-normal leading-5">
                                {option.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-black text-slate-500">
                        자세히 볼 반
                      </span>
                      <select
                        value={scoreStatsClassFilter}
                        onChange={(event) =>
                          setScoreStatsClassFilter(event.target.value)
                        }
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                      >
                        {scoreStatsClassOptions.length === 0 ? (
                          <option value="">반 정보 없음</option>
                        ) : (
                          scoreStatsClassOptions.map((classValue) => (
                            <option key={classValue} value={classValue}>
                              {classValue}반
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                  </div>

                  {scoreStatsLoading && (
                    <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
                      통계용 점수 데이터를 불러오는 중입니다. 불러오기 전에는
                      업로드 기록에 남은 범위에서 먼저 계산됩니다.
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg bg-slate-50 px-4 py-3">
                      <div className="text-xs font-black text-slate-500">
                        전체 평균
                      </div>
                      <div className="mt-1 text-2xl font-black text-slate-900">
                        {formatScoreStat(scoreStats.overall.average)}
                        <span className="ml-1 text-sm text-slate-400">
                          / {formatPerformanceScore(scoreStats.totalMaxScore)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs font-bold text-slate-500">
                        평균 산출 {scoreStats.overall.count}명
                      </div>
                    </div>
                    <div className="rounded-lg bg-blue-50 px-4 py-3">
                      <div className="text-xs font-black text-blue-700">
                        {selectedScoreClassLabel} 평균
                      </div>
                      <div className="mt-1 text-2xl font-black text-blue-900">
                        {formatScoreStat(scoreStats.selected.average)}
                        <span className="ml-1 text-sm text-blue-400">
                          / {formatPerformanceScore(scoreStats.totalMaxScore)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs font-bold text-blue-700">
                        평균 산출 {scoreStats.selected.count}명
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-4 py-3">
                      <div className="text-xs font-black text-slate-500">
                        전체 평균 대비
                      </div>
                      <div
                        className={`mt-1 text-2xl font-black ${getDifferenceTextClass(
                          scoreStats.selectedDifference,
                        )}`}
                      >
                        {formatDifferenceStat(scoreStats.selectedDifference)}
                      </div>
                      <div className="mt-1 text-xs font-bold text-slate-500">
                        선택 학급 평균 - 전체 평균
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-4 py-3">
                      <div className="text-xs font-black text-slate-500">
                        선택 학급 최고 / 최저
                      </div>
                      <div className="mt-1 text-2xl font-black text-slate-900">
                        {formatScoreStat(scoreStats.selected.max)}
                        <span className="mx-1 text-sm text-slate-400">/</span>
                        {formatScoreStat(scoreStats.selected.min)}
                      </div>
                      <div className="mt-1 text-xs font-bold text-slate-500">
                        현재 표시 학급 기준
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-5 xl:grid-cols-2">
                    <section className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <h4 className="text-sm font-black text-slate-900">
                            전체 평균과 선택 학급 평균
                          </h4>
                          <p className="mt-1 text-xs font-bold text-slate-500">
                            막대 길이는 만점 안에서 평균 점수 크기를 나타냅니다.
                          </p>
                        </div>
                        <span className="text-xs font-black text-slate-400">
                          만점{" "}
                          {formatPerformanceScore(scoreStats.totalMaxScore)}점
                        </span>
                      </div>
                      <div className="mt-4 space-y-3">
                        {[
                          {
                            label: "전체",
                            summary: scoreStats.overall,
                            barClass: "bg-slate-500",
                          },
                          {
                            label: selectedScoreClassLabel,
                            summary: scoreStats.selected,
                            barClass: "bg-blue-600",
                          },
                        ].map((item) => {
                          const width = Math.min(
                            100,
                            Math.max(
                              item.summary.count > 0 ? 4 : 0,
                              item.summary.percent || 0,
                            ),
                          );
                          return (
                            <div
                              key={item.label}
                              className="grid gap-2 sm:grid-cols-[120px_1fr_130px]"
                            >
                              <div className="text-sm font-black text-slate-700">
                                {item.label}
                              </div>
                              <div className="h-7 overflow-hidden rounded-lg bg-slate-100">
                                <div
                                  className={`h-full rounded-lg ${item.barClass}`}
                                  style={{ width: `${width}%` }}
                                />
                              </div>
                              <div className="text-right text-sm font-black text-slate-800">
                                {formatScoreStat(item.summary.average)}
                                <span className="ml-1 text-xs text-slate-400">
                                  /{" "}
                                  {formatPerformanceScore(
                                    scoreStats.totalMaxScore,
                                  )}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    {scoreStatsAllSelected && (
                      <section className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h4 className="text-sm font-black text-slate-900">
                              학급별 1·2차 수행평가 점수
                            </h4>
                            <p className="mt-1 text-xs font-bold text-slate-500">
                              막대는{" "}
                              {formatPerformanceScore(scoreStats.totalMaxScore)}
                              점 만점 총점 안에서 1차와 2차 평균 점수를 누적해
                              표시합니다.
                            </p>
                          </div>
                          <div className="flex max-w-full flex-col gap-1 text-[11px] font-black sm:items-end">
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <span className="h-2 w-5 rounded-full bg-amber-400" />
                              1차 {SCORE_LIST_FIRST_SUMMARY_LABEL}
                            </span>
                            <span className="inline-flex items-center gap-1 text-indigo-700">
                              <span className="h-2 w-5 rounded-full bg-indigo-500" />
                              2차 {SCORE_LIST_SECOND_SUMMARY_LABEL}
                            </span>
                          </div>
                        </div>
                        <div className="mt-4 space-y-3">
                          {scoreStats.assessmentContributions.length === 0 ? (
                            <div className="flex h-32 items-center justify-center text-center text-sm font-bold leading-6 text-slate-400">
                              반별 1·2차 점수 평균을 계산할 데이터가 없습니다.
                            </div>
                          ) : (
                            scoreStats.assessmentContributions.map(
                              (summary) => {
                                const firstAverage = summary.firstAverage;
                                const secondAverage = summary.secondAverage;
                                const firstWidth =
                                  firstAverage !== null &&
                                  scoreStats.totalMaxScore > 0
                                    ? Math.min(
                                        100,
                                        Math.max(
                                          0,
                                          (firstAverage /
                                            scoreStats.totalMaxScore) *
                                            100,
                                        ),
                                      )
                                    : 0;
                                const secondWidth =
                                  secondAverage !== null &&
                                  scoreStats.totalMaxScore > 0
                                    ? Math.min(
                                        100,
                                        Math.max(
                                          0,
                                          (secondAverage /
                                            scoreStats.totalMaxScore) *
                                            100,
                                        ),
                                      )
                                    : 0;
                                const tooltipId = `assessment-score-tooltip-${summary.classValue}`;
                                const tooltipText = `${summary.classValue}반 ${SCORE_LIST_FIRST_SUMMARY_LABEL} 평균 ${formatScoreStatWithUnit(
                                  firstAverage,
                                )}, ${SCORE_LIST_SECOND_SUMMARY_LABEL} 평균 ${formatScoreStatWithUnit(
                                  secondAverage,
                                )}, 합산 총점 평균 ${formatScoreStatWithUnit(
                                  summary.combinedAverage,
                                )}`;
                                return (
                                  <div
                                    key={`assessment-contribution-${summary.classValue}`}
                                    className="grid gap-2 lg:grid-cols-[90px_1fr_130px]"
                                  >
                                    <div className="text-sm font-black text-slate-800">
                                      {summary.classValue}반
                                    </div>
                                    <div
                                      className="group relative h-8 min-w-0 outline-none"
                                      tabIndex={0}
                                      aria-describedby={tooltipId}
                                      title={tooltipText}
                                    >
                                      <div className="h-8 overflow-hidden rounded-lg bg-slate-100">
                                        <div className="flex h-full">
                                          <div
                                            className="h-full shrink-0 bg-amber-400"
                                            style={{ width: `${firstWidth}%` }}
                                          />
                                          <div
                                            className="h-full shrink-0 bg-indigo-500"
                                            style={{ width: `${secondWidth}%` }}
                                          />
                                        </div>
                                      </div>
                                      <div
                                        id={tooltipId}
                                        role="tooltip"
                                        className="pointer-events-none absolute left-1/2 top-0 z-20 hidden w-max max-w-[90vw] -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-lg bg-slate-900 px-3 py-2 text-left text-xs font-bold leading-5 text-white shadow-xl group-hover:block group-focus:block sm:max-w-[520px]"
                                      >
                                        <div className="text-[11px] font-black text-slate-300">
                                          {summary.classValue}반 · 산출{" "}
                                          {summary.combinedCount}명
                                        </div>
                                        <div className="mt-1 grid gap-1">
                                          <div>
                                            1차 {SCORE_LIST_FIRST_SUMMARY_LABEL}
                                            :{" "}
                                            {formatScoreStatWithUnit(
                                              firstAverage,
                                            )}{" "}
                                            /{" "}
                                            {formatPerformanceScore(
                                              firstScoreListSummaryMaxScore,
                                            )}
                                            점
                                          </div>
                                          <div>
                                            2차{" "}
                                            {SCORE_LIST_SECOND_SUMMARY_LABEL}:{" "}
                                            {formatScoreStatWithUnit(
                                              secondAverage,
                                            )}{" "}
                                            /{" "}
                                            {formatPerformanceScore(
                                              secondScoreListSummaryMaxScore,
                                            )}
                                            점
                                          </div>
                                          <div className="border-t border-white/15 pt-1 font-black">
                                            합산 총점 평균:{" "}
                                            {formatScoreStatWithUnit(
                                              summary.combinedAverage,
                                            )}{" "}
                                            /{" "}
                                            {formatPerformanceScore(
                                              scoreStats.totalMaxScore,
                                            )}
                                            점
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="text-right text-sm font-black text-slate-900">
                                      {formatScoreStat(summary.combinedAverage)}
                                      <span className="ml-1 text-xs text-slate-400">
                                        /{" "}
                                        {formatPerformanceScore(
                                          scoreStats.totalMaxScore,
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                );
                              },
                            )
                          )}
                        </div>
                      </section>
                    )}

                    <section className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h4 className="text-sm font-black text-slate-900">
                            정규분포 곡선
                          </h4>
                          <p className="mt-1 text-xs font-bold text-slate-500">
                            전체와 {selectedScoreClassLabel}의 총점 분포를
                            평균과 표준편차로 근사합니다.
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-[11px] font-bold text-slate-500">
                          <div>
                            전체 평균{" "}
                            {formatScoreStat(
                              scoreStats.normalCurve.overall.mean,
                            )}
                          </div>
                          <div>
                            선택 평균{" "}
                            {formatScoreStat(
                              scoreStats.normalCurve.selected.mean,
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
                        {scoreStats.normalCurve.maxDensity > 0 ? (
                          <svg
                            viewBox="0 0 420 180"
                            className="h-48 w-full"
                            role="img"
                            aria-label="전체와 선택 학급의 정규분포 곡선"
                          >
                            <line
                              x1="10"
                              y1="166"
                              x2="410"
                              y2="166"
                              stroke="#cbd5e1"
                              strokeWidth="1"
                            />
                            {[0, 0.5, 1].map((ratio) => (
                              <g key={ratio}>
                                <line
                                  x1={10 + ratio * 400}
                                  y1="162"
                                  x2={10 + ratio * 400}
                                  y2="170"
                                  stroke="#cbd5e1"
                                  strokeWidth="1"
                                />
                                <text
                                  x={10 + ratio * 400}
                                  y="178"
                                  textAnchor="middle"
                                  className="fill-slate-500 text-[10px] font-bold"
                                >
                                  {formatPerformanceScore(
                                    scoreStats.totalMaxScore * ratio,
                                  )}
                                </text>
                              </g>
                            ))}
                            <path
                              d={buildNormalCurvePath(
                                scoreStats.normalCurve.overall,
                                scoreStats.totalMaxScore,
                                scoreStats.normalCurve.maxDensity,
                                420,
                                180,
                              )}
                              fill="none"
                              stroke="#64748b"
                              strokeWidth="3"
                              strokeLinecap="round"
                            />
                            <path
                              d={buildNormalCurvePath(
                                scoreStats.normalCurve.selected,
                                scoreStats.totalMaxScore,
                                scoreStats.normalCurve.maxDensity,
                                420,
                                180,
                              )}
                              fill="none"
                              stroke="#2563eb"
                              strokeWidth="3"
                              strokeLinecap="round"
                            />
                          </svg>
                        ) : (
                          <div className="flex h-48 items-center justify-center text-center text-sm font-bold leading-6 text-slate-400">
                            정규분포 곡선을 그리려면 같은 반에 서로 다른 점수의
                            산출 대상이 2명 이상 필요합니다.
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-black">
                        <span className="inline-flex items-center gap-1 text-slate-600">
                          <span className="h-2 w-5 rounded-full bg-slate-500" />
                          전체
                        </span>
                        <span className="inline-flex items-center gap-1 text-blue-700">
                          <span className="h-2 w-5 rounded-full bg-blue-600" />
                          {selectedScoreClassLabel}
                        </span>
                        <span className="text-slate-400">
                          표준편차 전체{" "}
                          {formatScoreStat(
                            scoreStats.normalCurve.overall.standardDeviation,
                          )}{" "}
                          · 선택{" "}
                          {formatScoreStat(
                            scoreStats.normalCurve.selected.standardDeviation,
                          )}
                        </span>
                      </div>
                    </section>

                    <section className="rounded-xl border border-slate-200 bg-white">
                      <div className="border-b border-slate-100 px-4 py-3">
                        <h4 className="text-sm font-black text-slate-900">
                          학급별 평균 비교
                        </h4>
                        <p className="mt-1 text-xs font-bold text-slate-500">
                          헤더를 누르면 해당 기준으로 오름차순과 내림차순을
                          전환합니다.
                        </p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[480px] text-left text-sm">
                          <thead className="bg-slate-50 text-xs font-black text-slate-500">
                            <tr>
                              {renderClassStatsHeader("class", "반")}
                              {renderClassStatsHeader(
                                "count",
                                "산출 인원",
                                "right",
                              )}
                              {renderClassStatsHeader(
                                "average",
                                "평균",
                                "right",
                              )}
                              {renderClassStatsHeader(
                                "difference",
                                "전체 평균 대비",
                                "right",
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {scoreStats.classSummaries.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={4}
                                  className="px-4 py-10 text-center text-sm font-bold text-slate-400"
                                >
                                  비교할 학급 통계가 없습니다.
                                </td>
                              </tr>
                            ) : (
                              scoreStats.classSummaries.map((summary) => {
                                const selected =
                                  normalizeSchoolValue(summary.classValue) ===
                                  normalizeSchoolValue(scoreStatsClassFilter);
                                return (
                                  <tr
                                    key={summary.classValue}
                                    className={selected ? "bg-blue-50/50" : ""}
                                  >
                                    <td className="whitespace-nowrap px-3 py-3">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setScoreStatsClassFilter(
                                            summary.classValue,
                                          )
                                        }
                                        className="font-black text-slate-900 transition hover:text-blue-700"
                                      >
                                        {summary.classValue}반
                                      </button>
                                      {selected && (
                                        <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-black text-white">
                                          선택
                                        </span>
                                      )}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 text-right font-bold text-slate-700">
                                      {summary.count}명
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 text-right font-black text-slate-900">
                                      {formatScoreStat(summary.average)}
                                    </td>
                                    <td
                                      className={`whitespace-nowrap px-3 py-3 text-right font-black ${getDifferenceTextClass(
                                        summary.difference,
                                      )}`}
                                    >
                                      {formatDifferenceStat(summary.difference)}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    {!scoreStatsAllSelected && (
                      <section className="rounded-xl border border-slate-200 bg-white">
                        <div className="border-b border-slate-100 px-4 py-3">
                          <h4 className="text-sm font-black text-slate-900">
                            평가 요소별 평균 비교
                          </h4>
                          <p className="mt-1 text-xs font-bold text-slate-500">
                            각 평가 요소는 해당 요소 점수가 입력된 학생만 평균에
                            포함합니다.
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[600px] text-left text-sm">
                            <thead className="bg-slate-50 text-xs font-black text-slate-500">
                              <tr>
                                <th className="px-3 py-3">평가 요소</th>
                                <th className="px-3 py-3 text-right">만점</th>
                                <th className="px-3 py-3 text-right">
                                  전체 평균
                                </th>
                                <th className="px-3 py-3 text-right">
                                  {selectedScoreClassLabel} 평균
                                </th>
                                <th className="px-3 py-3 text-right">
                                  전체 대비
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {scoreStats.itemSummaries.length === 0 ? (
                                <tr>
                                  <td
                                    colSpan={5}
                                    className="px-4 py-10 text-center text-sm font-bold text-slate-400"
                                  >
                                    평가 요소 정보가 없습니다.
                                  </td>
                                </tr>
                              ) : (
                                scoreStats.itemSummaries.map((item) => (
                                  <tr key={`${item.name}-${item.index}`}>
                                    <td className="px-3 py-3">
                                      <div
                                        className="max-w-[280px] truncate font-black text-slate-900"
                                        title={item.name}
                                      >
                                        {item.label}
                                      </div>
                                      <div className="mt-1 text-[11px] font-bold text-slate-400">
                                        전체 {item.overall.count}명 · 선택{" "}
                                        {item.selected.count}명 산출
                                      </div>
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 text-right font-bold text-slate-700">
                                      {formatPerformanceScore(item.maxScore)}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 text-right font-bold text-slate-700">
                                      {formatScoreStat(item.overall.average)}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 text-right font-black text-blue-700">
                                      {formatScoreStat(item.selected.average)}
                                    </td>
                                    <td
                                      className={`whitespace-nowrap px-3 py-3 text-right font-black ${getDifferenceTextClass(
                                        item.difference,
                                      )}`}
                                    >
                                      {formatDifferenceStat(item.difference)}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    )}

                    <section className="rounded-xl border border-slate-200 bg-white p-4">
                      <div>
                        <h4 className="text-sm font-black text-slate-900">
                          총점 점수 구간별 분포
                        </h4>
                        <p className="mt-1 text-xs font-bold text-slate-500">
                          전체와 {selectedScoreClassLabel}의 점수 구간별 학생
                          수를 비교합니다.
                        </p>
                      </div>
                      <div className="mt-4 space-y-4">
                        {scoreStats.distribution.map((bucket) => {
                          const overallWidth =
                            (bucket.overallCount /
                              scoreStats.maxDistributionCount) *
                            100;
                          const selectedWidth =
                            (bucket.selectedCount /
                              scoreStats.maxDistributionCount) *
                            100;
                          return (
                            <div
                              key={bucket.label}
                              className="grid gap-2 md:grid-cols-[90px_1fr]"
                            >
                              <div className="text-xs font-black text-slate-600">
                                {formatScoreDistributionBucketLabel(
                                  bucket,
                                  scoreStats.totalMaxScore,
                                )}
                              </div>
                              <div className="space-y-1.5">
                                <div className="grid grid-cols-[64px_1fr_48px] items-center gap-2">
                                  <span className="text-[11px] font-black text-slate-500">
                                    전체
                                  </span>
                                  <div className="h-4 rounded-full bg-slate-100">
                                    <div
                                      className="h-4 rounded-full bg-slate-500"
                                      style={{ width: `${overallWidth}%` }}
                                    />
                                  </div>
                                  <span className="text-right text-[11px] font-black text-slate-600">
                                    {bucket.overallCount}명
                                  </span>
                                </div>
                                <div className="grid grid-cols-[64px_1fr_48px] items-center gap-2">
                                  <span className="text-[11px] font-black text-blue-700">
                                    선택
                                  </span>
                                  <div className="h-4 rounded-full bg-blue-50">
                                    <div
                                      className="h-4 rounded-full bg-blue-600"
                                      style={{ width: `${selectedWidth}%` }}
                                    />
                                  </div>
                                  <span className="text-right text-[11px] font-black text-blue-700">
                                    {bucket.selectedCount}명
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setScoreStatsModalOpen(false)}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50"
              >
                닫기
              </button>
            </div>
          </section>
        </div>
      )}

      {objectionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="performance-score-objections-title"
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
          >
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h3
                  id="performance-score-objections-title"
                  className="text-lg font-black text-slate-900"
                >
                  수행평가 이의 목록
                </h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  학생이 제출한 이의 제기 항목과 점수, 사유, 처리 상태를
                  확인합니다.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadPerformanceScoreObjections()}
                  disabled={
                    objectionsLoading || Boolean(objectionReviewingAction)
                  }
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <i
                    className={`fas fa-sync-alt text-xs ${
                      objectionsLoading ? "animate-spin" : ""
                    }`}
                    aria-hidden="true"
                  />
                  새로고침
                </button>
                <button
                  type="button"
                  onClick={closeObjectionModal}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                  aria-label="이의 목록 창 닫기"
                >
                  <i className="fas fa-times" aria-hidden="true"></i>
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    label: "전체 이의",
                    value: objectionSummary.total,
                    className: "bg-slate-50 text-slate-900",
                  },
                  {
                    label: "처리 대기",
                    value: objectionSummary.pending,
                    className: "bg-amber-50 text-amber-800",
                  },
                  {
                    label: "수용",
                    value: objectionSummary.accepted,
                    className: "bg-emerald-50 text-emerald-800",
                  },
                  {
                    label: "반려",
                    value: objectionSummary.rejected,
                    className: "bg-rose-50 text-rose-800",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`rounded-lg px-4 py-3 ${item.className}`}
                  >
                    <div className="text-xs font-black opacity-80">
                      {item.label}
                    </div>
                    <div className="mt-1 text-2xl font-black">
                      {item.value}건
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                {objectionsLoading ? (
                  <InlineLoading message="수행평가 이의 목록을 불러오는 중입니다." />
                ) : objectionsLoaded && objections.length === 0 ? (
                  <div className="bg-slate-50 px-4 py-12 text-center text-sm font-bold text-slate-400">
                    제출된 수행평가 이의 제기가 없습니다.
                  </div>
                ) : !objectionsLoaded ? (
                  <div className="bg-slate-50 px-4 py-12 text-center text-sm font-bold text-slate-400">
                    새로고침을 누르면 제출된 이의 제기 목록을 조회합니다.
                  </div>
                ) : (
                  <table className="w-full min-w-[1070px] table-fixed text-left text-sm">
                    <colgroup>
                      <col className="w-[150px]" />
                      <col className="w-[210px]" />
                      <col className="w-[130px]" />
                      <col className="w-[280px]" />
                      <col className="w-[110px]" />
                      <col className="w-[190px]" />
                    </colgroup>
                    <thead className="bg-slate-50 text-xs font-black text-slate-500">
                      <tr>
                        <th className="px-4 py-3">학생</th>
                        <th className="px-4 py-3">수행평가 항목</th>
                        <th className="px-4 py-3">해당 점수</th>
                        <th className="px-4 py-3">이의 제기 사유</th>
                        <th className="px-4 py-3">시간</th>
                        <th className="px-4 py-3 text-center">상태/처리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {objections.map((objection) => {
                        const statusMeta = getObjectionStatusMeta(
                          objection.status,
                        );
                        const reviewingStatus =
                          objectionReviewingAction?.id === objection.id
                            ? objectionReviewingAction.status
                            : null;
                        return (
                          <tr
                            key={objection.id}
                            className={statusMeta.rowClass}
                          >
                            <td className="px-4 py-4 align-top">
                              <div className="font-black text-slate-900">
                                {objection.studentName}
                              </div>
                              <div className="mt-1 text-xs font-bold text-slate-500">
                                {objection.grade || "-"}학년{" "}
                                {objection.class || "-"}반{" "}
                                {objection.number || "-"}번
                              </div>
                            </td>
                            <td className="px-4 py-4 align-top">
                              <div className="font-black text-slate-900">
                                {objection.scoreTitle}
                              </div>
                              <div className="mt-1 text-xs font-bold text-slate-500">
                                {objection.subject || "과목 정보 없음"}
                              </div>
                            </td>
                            <td className="px-4 py-4 align-top">
                              <div className="font-black text-blue-700">
                                {objection.scoreLabel}
                              </div>
                              {objection.status === "accepted" &&
                                objection.changedScoreLabel && (
                                  <div className="mt-1 text-xs font-bold text-emerald-700">
                                    변경 후 {objection.changedScoreLabel}
                                  </div>
                                )}
                            </td>
                            <td className="px-4 py-4 align-top">
                              <p className="whitespace-pre-wrap break-words font-semibold leading-6 text-slate-700">
                                {objection.reason || "사유 없음"}
                              </p>
                              {objection.reviewMemo && (
                                <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold leading-5 text-slate-500">
                                  처리 메모: {objection.reviewMemo}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-4 align-top text-xs font-bold leading-5 text-slate-500">
                              <div>
                                요청{" "}
                                {formatObjectionTime(objection.requestedAt)}
                              </div>
                              {objection.status !== "pending" && (
                                <div className="mt-1">
                                  처리{" "}
                                  {formatObjectionTime(objection.reviewedAt)}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-4 align-top">
                              {objection.status === "pending" ? (
                                <div className="flex justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleReviewObjection(
                                        objection,
                                        "rejected",
                                      )
                                    }
                                    disabled={Boolean(objectionReviewingAction)}
                                    className="inline-flex h-8 min-w-[44px] items-center justify-center whitespace-nowrap rounded-lg border border-rose-200 bg-white px-2.5 text-xs font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {reviewingStatus === "rejected"
                                      ? "반려 처리 중"
                                      : "반려"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleReviewObjection(
                                        objection,
                                        "accepted",
                                      )
                                    }
                                    disabled={Boolean(objectionReviewingAction)}
                                    className="inline-flex h-8 min-w-[44px] items-center justify-center whitespace-nowrap rounded-lg bg-blue-600 px-2.5 text-xs font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                                  >
                                    {reviewingStatus === "accepted"
                                      ? "수용 처리 중"
                                      : "수용"}
                                  </button>
                                </div>
                              ) : (
                                <div className="flex justify-center">
                                  <span
                                    className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-black ${statusMeta.badgeClass}`}
                                  >
                                    {statusMeta.label}
                                  </span>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="flex justify-end border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={closeObjectionModal}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50"
              >
                닫기
              </button>
            </div>
          </section>
        </div>
      )}

      {classSheetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
          <section className="flex max-h-[calc(100vh-2rem)] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  일람표 다운로드
                </h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  수행평가 강의실별 일람표 양식으로 학급별 점수와 서명을
                  확인합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setClassSheetModalOpen(false)}
                disabled={classSheetPreviewLoading || exportingClassSheet}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="일람표 다운로드 창 닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_130px_130px_auto]">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-slate-500">
                    1차 점수표
                  </span>
                  <select
                    value={classSheetFirstRosterId}
                    onChange={(event) =>
                      setClassSheetFirstRosterId(event.target.value)
                    }
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                  >
                    {firstAssessmentRosterOptions.length === 0 ? (
                      <option value="">1차 점수표 없음</option>
                    ) : (
                      firstAssessmentRosterOptions.map((roster) => (
                        <option key={roster.id} value={roster.id}>
                          {roster.title}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-slate-500">
                    2차 점수표
                  </span>
                  <select
                    value={classSheetSecondRosterId}
                    onChange={(event) =>
                      setClassSheetSecondRosterId(event.target.value)
                    }
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                  >
                    {secondAssessmentRosterOptions.length === 0 ? (
                      <option value="">2차 점수표 없음</option>
                    ) : (
                      secondAssessmentRosterOptions.map((roster) => (
                        <option key={roster.id} value={roster.id}>
                          {roster.title}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-slate-500">
                    학년
                  </span>
                  <select
                    value={classSheetGradeFilter}
                    onChange={(event) =>
                      setClassSheetGradeFilter(event.target.value)
                    }
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                  >
                    {(classSheetGradeOptions.length
                      ? classSheetGradeOptions
                      : DEFAULT_GRADE_OPTIONS
                    ).map((grade) => (
                      <option key={grade} value={grade}>
                        {grade}학년
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-slate-500">
                    반
                  </span>
                  <select
                    value={classSheetClassFilter}
                    onChange={(event) =>
                      setClassSheetClassFilter(event.target.value)
                    }
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                  >
                    {classSheetClassOptions.length === 0 ? (
                      <option value="">반 없음</option>
                    ) : (
                      classSheetClassOptions.map((classValue) => (
                        <option key={classValue} value={classValue}>
                          {classValue}반
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => void refreshClassSheetPreview()}
                    disabled={
                      classSheetPreviewLoading ||
                      exportingClassSheet ||
                      !classSheetClassFilter
                    }
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 lg:w-auto"
                  >
                    <i
                      className={`fas fa-search text-xs ${classSheetPreviewLoading ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    ></i>
                    {classSheetPreviewLoading ? "조회 중" : "현황 조회"}
                  </button>
                </div>
              </div>

              {classSheetPreviewReady ? (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    {[
                      {
                        label: "학급 인원",
                        value: `${classSheetStatusSummary.totalCount}명`,
                        tone: "bg-slate-50 text-slate-700",
                      },
                      {
                        label: "1차 점수",
                        value: `${classSheetStatusSummary.firstScoredCount}명`,
                        tone: "bg-blue-50 text-blue-700",
                      },
                      {
                        label: "2차 점수",
                        value: `${classSheetStatusSummary.secondScoredCount}명`,
                        tone: "bg-blue-50 text-blue-700",
                      },
                      {
                        label: "서명 완료",
                        value: `${classSheetStatusSummary.signedCount}명`,
                        tone: "bg-emerald-50 text-emerald-700",
                      },
                      {
                        label: "서명 미완료",
                        value: `${classSheetStatusSummary.unsignedCount}명`,
                        tone: "bg-rose-50 text-rose-700",
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className={`rounded-lg px-3 py-3 ${item.tone}`}
                      >
                        <div className="text-[11px] font-black">
                          {item.label}
                        </div>
                        <div className="mt-1 text-lg font-black">
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="max-h-[min(46vh,520px)] overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full table-fixed text-left text-sm">
                      <colgroup>
                        <col className="w-[10%]" />
                        <col className="w-[7%]" />
                        <col className="w-[14%]" />
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                        <col className="w-[8%]" />
                        <col className="w-[1%]" />
                        <col className="w-[40%]" />
                      </colgroup>
                      <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-black text-slate-500">
                        <tr>
                          <th className="px-3 py-3 text-center">상태</th>
                          <th className="px-3 py-3 text-center">번호</th>
                          <th className="px-3 py-3">이름</th>
                          <th className="px-3 py-3 text-right">1차</th>
                          <th className="px-3 py-3 text-right">2차</th>
                          <th className="px-3 py-3 text-right">합계</th>
                          <th aria-hidden="true"></th>
                          <th className="px-3 py-3 text-center">서명 현황</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {classSheetPreviewStudents.length === 0 ? (
                          <tr>
                            <td
                              colSpan={8}
                              className="px-4 py-10 text-center text-sm font-bold text-slate-400"
                            >
                              선택한 학급에 저장된 점수가 없습니다.
                            </td>
                          </tr>
                        ) : (
                          classSheetPreviewStudents.map((student) => {
                            const academicStatusLabel =
                              getClassSheetAcademicStatusLabel(student);
                            const transferredStudent =
                              isClassSheetTransferredStudent(student);
                            const firstScore = getScoreNumber(
                              student.firstRecord,
                            );
                            const secondScore = getScoreNumber(
                              student.secondRecord,
                            );
                            const totalScore =
                              !transferredStudent &&
                              (firstScore !== null || secondScore !== null)
                                ? roundScore(
                                    (firstScore ?? 0) + (secondScore ?? 0),
                                  )
                                : null;
                            const signatureRecord = getConfirmedSignatureRecord(
                              student,
                              classSheetSignatureRequirements,
                            );
                            const signatureDisplayRecord =
                              signatureRecord ||
                              [student.secondRecord, student.firstRecord].find(
                                (record) =>
                                  record?.signatureImage ||
                                  record?.confirmation?.signatureImage,
                              ) ||
                              null;
                            const signatureImage =
                              signatureDisplayRecord?.signatureImage ||
                              signatureDisplayRecord?.confirmation
                                ?.signatureImage ||
                              "";
                            const signatureSubmittedAtValue =
                              getSignatureSubmittedAtValue(
                                signatureDisplayRecord,
                              );
                            const signatureSubmittedAtMillis =
                              getTimestampMillis(signatureSubmittedAtValue);
                            const signatureSubmittedAtLabel =
                              formatClassSheetSignatureSubmittedAt(
                                signatureSubmittedAtValue,
                              );
                            const studentKey = getClassSheetStudentKey(student);
                            const missingLabels = [
                              !transferredStudent && !student.firstRecord
                                ? "1차 점수"
                                : "",
                              !transferredStudent && !student.secondRecord
                                ? "2차 점수"
                                : "",
                            ].filter(Boolean);
                            const statusLabel = transferredStudent
                              ? academicStatusLabel
                              : missingLabels.length
                                ? "점수 누락"
                                : signatureRecord
                                  ? "확인 완료"
                                  : "서명 필요";
                            const statusClass = transferredStudent
                              ? "bg-rose-50 text-rose-700"
                              : missingLabels.length
                                ? "bg-amber-50 text-amber-700"
                                : signatureRecord
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-rose-50 text-rose-700";
                            return (
                              <tr key={studentKey}>
                                <td className="whitespace-nowrap px-3 py-3 text-center">
                                  <span
                                    className={`inline-flex min-w-[4.25rem] items-center justify-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-black ${statusClass}`}
                                  >
                                    {statusLabel}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-center font-bold text-slate-600">
                                  {student.number}번
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 font-black text-slate-900">
                                  {student.studentName || "(이름 없음)"}
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-right font-bold text-slate-700">
                                  {transferredStudent ? (
                                    <span className="font-black text-rose-600">
                                      {academicStatusLabel}
                                    </span>
                                  ) : (
                                    <>
                                      {firstScore === null
                                        ? "-"
                                        : formatPerformanceScore(firstScore)}
                                      <span className="ml-1 text-slate-400">
                                        /{" "}
                                        {formatPerformanceScore(
                                          summaryExportRosters.firstRoster
                                            ?.totalMaxScore,
                                        )}
                                      </span>
                                    </>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-right font-bold text-slate-700">
                                  {transferredStudent ? (
                                    <span className="font-black text-rose-600">
                                      {academicStatusLabel}
                                    </span>
                                  ) : (
                                    <>
                                      {secondScore === null
                                        ? "-"
                                        : formatPerformanceScore(secondScore)}
                                      <span className="ml-1 text-slate-400">
                                        /{" "}
                                        {formatPerformanceScore(
                                          summaryExportRosters.secondRoster
                                            ?.totalMaxScore,
                                        )}
                                      </span>
                                    </>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-right font-black text-blue-700">
                                  {totalScore === null
                                    ? "-"
                                    : formatPerformanceScore(totalScore)}
                                </td>
                                <td aria-hidden="true"></td>
                                <td className="px-3 py-3 text-center">
                                  {signatureDisplayRecord && signatureImage ? (
                                    <div className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-2">
                                      <div className="flex h-8 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-blue-100 bg-blue-50 px-1.5">
                                        <img
                                          src={signatureImage}
                                          alt={`${student.studentName} 서명`}
                                          className="max-h-6 max-w-full object-contain"
                                        />
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void rejectClassSheetSignature(
                                            student,
                                          )
                                        }
                                        disabled={
                                          rejectingSignatureKey === studentKey
                                        }
                                        className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-rose-200 bg-white px-2 text-[11px] font-black text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        {rejectingSignatureKey === studentKey
                                          ? "반려 중..."
                                          : "반려"}
                                      </button>
                                      {signatureSubmittedAtLabel ? (
                                        <time
                                          dateTime={new Date(
                                            signatureSubmittedAtMillis,
                                          ).toISOString()}
                                          title={`서명 제출 일시 ${signatureSubmittedAtLabel}`}
                                          className="shrink-0 whitespace-nowrap text-[11px] font-bold leading-4 text-slate-500"
                                        >
                                          {signatureSubmittedAtLabel}
                                        </time>
                                      ) : (
                                        <span className="shrink-0 whitespace-nowrap text-[11px] font-bold leading-4 text-slate-400">
                                          일시 없음
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="mx-auto w-fit text-center text-xs font-bold leading-5 text-slate-500">
                                      {transferredStudent
                                        ? `${academicStatusLabel} 학생`
                                        : missingLabels.length
                                          ? `${missingLabels.join(", ")} 없음`
                                          : "학생 점수 확인 서명 전"}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-400">
                  학년과 반을 선택한 뒤 현황 조회를 누르면 점수와 서명 현황이
                  표시됩니다.
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={() => setClassSheetModalOpen(false)}
                disabled={classSheetPreviewLoading || exportingClassSheet}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => void downloadClassSummarySheet()}
                disabled={
                  classSheetPreviewLoading ||
                  exportingClassSheet ||
                  !classSheetClassFilter
                }
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <i
                  className={`fas fa-file-excel text-xs ${exportingClassSheet ? "animate-pulse" : ""}`}
                  aria-hidden="true"
                ></i>
                {exportingClassSheet ? "생성 중" : "일람표 다운로드"}
              </button>
            </div>
          </section>
        </div>
      )}

      {parsed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
          <section className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h3 className="text-lg font-black text-slate-900">
                  업로드 미리보기
                </h3>
                <p className="mt-1 truncate text-sm font-semibold text-slate-500">
                  {parsed.sourceFileName} · 헤더 {parsed.headerRowNumber}행 ·{" "}
                  {parsed.detectedClasses.length
                    ? `${parsed.detectedClasses.join(", ")}반`
                    : "반 정보 없음"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700">
                  총 {parsedSummary.rowCount}명
                </span>
                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
                  연결 {parsedSummary.matchedCount}명
                </span>
                <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700">
                  점수 입력 {parsedSummary.scoredCount}명
                </span>
                {parsedSummary.blankScoreCount > 0 && (
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">
                    점수 빈칸 {parsedSummary.blankScoreCount}명
                  </span>
                )}
                {parsedSummary.warningCount > 0 && (
                  <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-700">
                    확인 {parsedSummary.warningCount}명
                  </span>
                )}
                {parsedSummary.unmatchedCount > 0 && (
                  <span className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700">
                    미연결 {parsedSummary.unmatchedCount}명
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setParsed(null)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                  aria-label="미리보기 닫기"
                >
                  <i className="fas fa-times" aria-hidden="true"></i>
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <div className="grid gap-3 lg:grid-cols-[1fr_220px_180px]">
                <label className="block">
                  <span className="text-xs font-black text-slate-600">
                    수행평가 선택
                  </span>
                  <select
                    value={assessmentPreset}
                    onChange={(event) =>
                      updateAssessmentPreset(
                        event.target.value as AssessmentPresetKey,
                      )
                    }
                    className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-50"
                  >
                    {UPLOAD_ASSESSMENT_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-black text-slate-600">
                    평가명
                  </span>
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-50"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-black text-slate-600">
                    반 필터
                  </span>
                  <select
                    value={previewClassFilter}
                    onChange={(event) =>
                      setPreviewClassFilter(event.target.value)
                    }
                    className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-50"
                  >
                    <option value="all">전체 반</option>
                    {parsed.detectedClasses.map((classValue) => (
                      <option key={classValue} value={classValue}>
                        {classValue}반
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {parsed.items.map((item, index) => (
                  <div
                    key={`${item.name}-${index}`}
                    className="rounded-lg border border-slate-200 px-3 py-3"
                  >
                    <div
                      className="truncate text-sm font-black text-slate-800"
                      title={item.name}
                    >
                      {getItemLabel(item)}
                    </div>
                    <div className="mt-1 text-xs font-bold text-slate-500">
                      {formatPerformanceScore(item.maxScore)}점 만점
                      {item.ratio
                        ? ` · ${formatPerformanceScore(item.ratio)}%`
                        : ""}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm font-bold text-slate-500">
                  {previewClassFiltered
                    ? `${previewRangeLabel} / ${filteredPreviewRows.length}명 전체 표시`
                    : `${previewRangeLabel} / ${filteredPreviewRows.length}명 표시 · ${safePreviewPage} / ${previewTotalPages}쪽`}
                </div>
                {!previewClassFiltered && (
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {previewPageItems.map((item) =>
                      typeof item === "number" ? (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setPreviewPage(item)}
                          className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-xs font-black transition ${
                            item === safePreviewPage
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                          aria-current={
                            item === safePreviewPage ? "page" : undefined
                          }
                        >
                          {item}
                        </button>
                      ) : (
                        <span
                          key={item.key}
                          className="inline-flex h-9 min-w-9 items-center justify-center px-2 text-xs font-black text-slate-400"
                        >
                          {item.label}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[1120px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black text-slate-500">
                    <tr>
                      <th className="px-3 py-3 text-center">상태</th>
                      <th className="px-3 py-3 text-center">반</th>
                      <th className="px-3 py-3 text-center">번호</th>
                      <th className="px-3 py-3">이름</th>
                      {parsed.items.map((item, index) => (
                        <th
                          key={`${item.name}-${index}-head`}
                          className="px-3 py-3 text-right"
                          title={item.name}
                        >
                          {getItemLabel(item)}
                        </th>
                      ))}
                      <th className="px-3 py-3 text-right">총점</th>
                      <th className="w-80 px-3 py-3">감점 요인 및 평가 근거</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {previewRows.map((row) => (
                      <tr key={row.rowKey} className="align-top">
                        <td className="px-3 py-3 text-center">
                          <span
                            title={row.matchMessage}
                            className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${getMatchBadgeClass(row.matchStatus)}`}
                          >
                            {getMatchLabel(row.matchStatus)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center font-bold text-slate-700">
                          {row.class || "-"}
                        </td>
                        <td className="px-3 py-3 text-center font-bold text-slate-700">
                          {row.number || "-"}
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-black text-slate-900">
                            {row.studentName || "(이름 없음)"}
                          </div>
                          <div className="mt-1 truncate text-[11px] font-bold text-slate-400">
                            {row.matchMessage}
                          </div>
                        </td>
                        {row.items.map((item, index) => (
                          <td
                            key={`${row.rowKey}-${item.name}-${index}`}
                            className="px-3 py-3 text-right font-bold text-slate-700"
                          >
                            {item.scoreEntered === false
                              ? "-"
                              : formatPerformanceScore(item.score)}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-3 py-3 text-right font-black text-blue-700">
                          {formatPerformanceScore(row.totalScore)} /{" "}
                          {formatPerformanceScore(row.totalMaxScore)}
                        </td>
                        <td className="px-3 py-2">
                          <textarea
                            value={row.feedback}
                            onChange={(event) =>
                              updateFeedback(row.rowKey, event.target.value)
                            }
                            rows={2}
                            className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                            placeholder="학생에게 보여줄 감점 요인 또는 평가 근거"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={() => setParsed(null)}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void saveParsedScores()}
                disabled={saving || parsedSummary.saveableCount === 0}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <i className="fas fa-save text-xs" aria-hidden="true"></i>
                {saving ? "저장 중..." : "학생별 점수 저장"}
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">
              수행평가 점수 관리
            </h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
              평가명을 선택해 학생별 점수와 평가 근거를 조회합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadStudents()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              aria-label="명단 새로고침"
              title="명단 새로고침"
            >
              <i
                className={`fas fa-sync-alt text-xs ${studentsLoading ? "animate-spin" : ""}`}
                aria-hidden="true"
              ></i>
            </button>
            <button
              type="button"
              onClick={() => setScoreWarningModalOpen(true)}
              disabled={scoreWarningLoading || scoreWarningSaving}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="학생 점수 확인 경고 문구 설정"
              title="학생 점수 확인 경고 문구 설정"
            >
              <i
                className={`fas fa-cog text-xs ${
                  scoreWarningLoading || scoreWarningSaving
                    ? "animate-spin"
                    : ""
                }`}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              onClick={openScoreStatsModal}
              disabled={scoreStatsButtonDisabled}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-sm font-black text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              title={scoreStatsButtonTitle}
            >
              <i className="fas fa-chart-column text-xs" aria-hidden="true" />
              통계
            </button>
            <button
              type="button"
              onClick={openObjectionModal}
              disabled={objectionsLoading || scoreEditing || savingScoreEdits}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-sm font-black text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i
                className={`fas fa-circle-question text-xs ${
                  objectionsLoading ? "animate-spin" : ""
                }`}
                aria-hidden="true"
              />
              이의제기
              {objectionSummary.pending > 0 && (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-black text-rose-600">
                  {objectionSummary.pending}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setUploadModalOpen(true)}
              disabled={parsing || scoreEditing || savingScoreEdits}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <i
                className="fas fa-file-arrow-up text-xs"
                aria-hidden="true"
              ></i>
              {parsing ? "인식 중..." : "업로드"}
            </button>
            <button
              type="button"
              onClick={() => setClassSheetModalOpen(true)}
              disabled={
                rostersLoading ||
                rosters.length === 0 ||
                scoreEditing ||
                savingScoreEdits
              }
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-sm font-black text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i className="fas fa-file-download text-xs" aria-hidden="true" />
              일람표
            </button>
          </div>
        </div>

        {studentLoadError && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-800">
            {studentLoadError}
          </div>
        )}

        {rostersLoading ? (
          <InlineLoading message="저장된 점수를 불러오는 중입니다." />
        ) : rosters.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm font-bold text-slate-400">
            아직 저장된 수행평가 점수 명단이 없습니다.
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="grid gap-3 xl:grid-cols-[1.1fr_0.65fr_0.65fr_1fr_auto]">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-slate-500">
                    평가명
                  </span>
                  <select
                    value={scoreListRosterId}
                    onChange={(event) => {
                      selectScoreRoster(event.target.value);
                    }}
                    disabled={scoreEditing || savingScoreEdits}
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                  >
                    <option value={SCORE_LIST_ALL_ROSTERS_VALUE}>전체</option>
                    {rosters.map((roster) => (
                      <option key={roster.id} value={roster.id}>
                        {roster.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-slate-500">
                    학년
                  </span>
                  <select
                    value={scoreListGradeFilter}
                    onChange={(event) =>
                      setScoreListGradeFilter(event.target.value)
                    }
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                  >
                    <option value="all">전체 학년</option>
                    {(scoreListGradeOptions.length
                      ? scoreListGradeOptions
                      : DEFAULT_GRADE_OPTIONS
                    ).map((grade) => (
                      <option key={grade} value={grade}>
                        {grade}학년
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-slate-500">
                    반
                  </span>
                  <select
                    value={scoreListClassFilter}
                    onChange={(event) =>
                      setScoreListClassFilter(event.target.value)
                    }
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                  >
                    <option value="all">전체 반</option>
                    {(scoreListClassOptions.length
                      ? scoreListClassOptions
                      : DEFAULT_CLASS_OPTIONS
                    ).map((classValue) => (
                      <option key={classValue} value={classValue}>
                        {classValue}반
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-slate-500">
                    학생 이름 검색
                  </span>
                  <input
                    type="search"
                    value={scoreListSearch}
                    onChange={(event) => setScoreListSearch(event.target.value)}
                    placeholder="이름, 반, 번호"
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void loadScoreListRecords()}
                  disabled={
                    (!scoreListAllSelected && !selectedScoreRoster) ||
                    scoreListLoading ||
                    scoreEditing ||
                    savingScoreEdits
                  }
                  className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 xl:mt-6"
                >
                  <i
                    className={`fas fa-search text-xs ${scoreListLoading ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  ></i>
                  {scoreListLoading ? "조회 중" : "조회"}
                </button>
              </div>
            </div>

            {scoreListLoadError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold leading-6 text-rose-700">
                {scoreListLoadError}
                {!scoreListAllSelected &&
                  " 다시 조회하기 전에는 점수 수정이 비활성화됩니다."}
              </div>
            )}

            {scoreListSummaryReady ? (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <h4 className="truncate text-base font-black text-slate-900">
                      전체 수행평가 총점
                    </h4>
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      {activeScoreListClass
                        ? `${activeScoreListClass}반 ${filteredScoreListSummaryStudents.length}명 표시`
                        : `${filteredScoreListSummaryStudents.length}명 표시`}{" "}
                      · 명단 {scoreListSummaryStudents.length}명 ·{" "}
                      {firstScoreListSummaryHeader} ·{" "}
                      {secondScoreListSummaryHeader}
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[880px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-black text-slate-500">
                      <tr>
                        <th className="whitespace-nowrap px-3 py-3">학년</th>
                        <th className="whitespace-nowrap px-3 py-3">반</th>
                        <th className="whitespace-nowrap px-3 py-3">번호</th>
                        <th className="whitespace-nowrap px-3 py-3">이름</th>
                        <th className="whitespace-nowrap px-3 py-3 text-right">
                          {firstScoreListSummaryHeader}
                        </th>
                        <th className="whitespace-nowrap px-3 py-3 text-right">
                          {secondScoreListSummaryHeader}
                        </th>
                        <th className="whitespace-nowrap px-3 py-3 text-right">
                          {combinedScoreListSummaryHeader}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredScoreListSummaryStudents.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-10 text-center text-sm font-bold text-slate-400"
                          >
                            조건에 맞는 학생 점수가 없습니다.
                          </td>
                        </tr>
                      ) : (
                        filteredScoreListSummaryStudents.map((student) => {
                          const studentKey = getClassSheetStudentKey(student);
                          const academicStatusLabel =
                            getClassSheetAcademicStatusLabel(student);
                          const transferredStudent =
                            isClassSheetTransferredStudent(student);
                          const firstRecordAvailable = Boolean(
                            student.firstRecord,
                          );
                          const secondRecordAvailable = Boolean(
                            student.secondRecord,
                          );
                          const combinedTotalScore =
                            getScoreListCombinedTotalScore(student);
                          return (
                            <tr key={studentKey}>
                              <td className="whitespace-nowrap px-3 py-3 font-bold text-slate-600">
                                {student.grade}학년
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 font-bold text-slate-600">
                                {student.class}반
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 font-bold text-slate-600">
                                {student.number}번
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 font-black text-slate-900">
                                {student.studentName || "(이름 없음)"}
                              </td>
                              <td
                                className={`whitespace-nowrap px-3 py-3 text-right font-black ${
                                  transferredStudent
                                    ? "text-rose-600"
                                    : firstRecordAvailable
                                      ? "text-blue-700"
                                      : "text-slate-400"
                                }`}
                              >
                                {getScoreListSummaryTotalOnlyLabel(
                                  student.firstRecord,
                                  academicStatusLabel,
                                )}
                              </td>
                              <td
                                className={`whitespace-nowrap px-3 py-3 text-right font-black ${
                                  transferredStudent
                                    ? "text-rose-600"
                                    : secondRecordAvailable
                                      ? "text-blue-700"
                                      : "text-slate-400"
                                }`}
                              >
                                {getScoreListSummaryTotalOnlyLabel(
                                  student.secondRecord,
                                  academicStatusLabel,
                                )}
                              </td>
                              <td
                                className={`whitespace-nowrap px-3 py-3 text-right text-xl font-black ${
                                  transferredStudent
                                    ? "text-rose-600"
                                    : combinedTotalScore !== null
                                      ? "text-blue-700"
                                      : "text-slate-400"
                                }`}
                              >
                                {getScoreListCombinedTotalLabel(student)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {scoreListClassFilter === "all" &&
                  scoreListClassPageOptions.length > 1 && (
                    <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-slate-100 px-4 py-3">
                      {scoreListClassPageOptions.map((classValue, index) => {
                        const page = index + 1;
                        return (
                          <button
                            key={classValue}
                            type="button"
                            onClick={() => setScoreListClassPage(page)}
                            className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-xs font-black transition ${
                              page === safeScoreListClassPage
                                ? "border-blue-600 bg-blue-600 text-white"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                            aria-current={
                              page === safeScoreListClassPage
                                ? "page"
                                : undefined
                            }
                            title={`${classValue}반`}
                          >
                            {classValue}
                          </button>
                        );
                      })}
                    </div>
                  )}
              </div>
            ) : scoreListReady ? (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <h4 className="truncate text-base font-black text-slate-900">
                      {selectedScoreRoster?.title}
                    </h4>
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      {activeScoreListClass
                        ? `${activeScoreListClass}반 ${filteredScoreListRecords.length}명 표시`
                        : `${filteredScoreListRecords.length}명 표시`}{" "}
                      · 명단 {scoreListRecords.length}명 · 저장{" "}
                      {
                        scoreListRecords.filter(
                          (record) =>
                            isTransferredScoreRecord(record) ||
                            getEnteredTotalScore(record) !== null,
                        ).length
                      }
                      명 · 만점{" "}
                      {formatPerformanceScore(
                        selectedScoreRoster?.totalMaxScore,
                      )}
                      점
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {scoreEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={cancelScoreEdit}
                          disabled={savingScoreEdits}
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={addScoreListStudent}
                          disabled={savingScoreEdits}
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <i className="fas fa-plus" aria-hidden="true"></i>
                          학생 추가
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeSelectedScoreListStudents()}
                          disabled={
                            savingScoreEdits ||
                            selectedScoreListRecordCount === 0
                          }
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-white px-3 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <i
                            className="fas fa-trash-can"
                            aria-hidden="true"
                          ></i>
                          학생 삭제
                          {selectedScoreListRecordCount > 0
                            ? ` ${selectedScoreListRecordCount}`
                            : ""}
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveScoreListEdits()}
                          disabled={savingScoreEdits}
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          <i
                            className={`fas fa-save ${savingScoreEdits ? "animate-pulse" : ""}`}
                            aria-hidden="true"
                          ></i>
                          {savingScoreEdits ? "저장 중" : "변경 저장"}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void startScoreEdit()}
                        disabled={scoreListLoading || savingScoreEdits}
                        className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-black text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <i
                          className="fas fa-pen-to-square"
                          aria-hidden="true"
                        ></i>
                        점수 수정
                      </button>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1180px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-black text-slate-500">
                      <tr>
                        {scoreEditing && (
                          <th className="w-12 px-3 py-3 text-center">
                            <input
                              ref={scoreListSelectAllRef}
                              type="checkbox"
                              checked={visibleScoreListRecordsSelected}
                              onChange={(event) =>
                                toggleVisibleScoreListRecordSelection(
                                  event.target.checked,
                                )
                              }
                              disabled={
                                savingScoreEdits ||
                                visibleScoreListRecordKeys.length === 0
                              }
                              aria-checked={
                                visibleScoreListRecordsPartiallySelected
                                  ? "mixed"
                                  : visibleScoreListRecordsSelected
                              }
                              aria-label={
                                visibleScoreListRecordsPartiallySelected
                                  ? "현재 표시 학생 일부 선택됨"
                                  : "현재 표시 학생 전체 선택"
                              }
                              className="h-4 w-4 rounded border-slate-300 text-blue-600 accent-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                          </th>
                        )}
                        {renderScoreListHeader("grade", "학년")}
                        {renderScoreListHeader("class", "반")}
                        {renderScoreListHeader("number", "번호")}
                        {renderScoreListHeader("studentName", "이름")}
                        {(selectedScoreRoster?.items || []).map((item, index) =>
                          renderScoreListHeader(
                            `item-${index}` as ScoreListSortKey,
                            getItemLabel(item),
                            "right",
                          ),
                        )}
                        {renderScoreListHeader("totalScore", "총점", "right")}
                        <th className="w-32 whitespace-nowrap px-3 py-3 text-center">
                          사유
                        </th>
                        <th className="w-48 whitespace-nowrap px-3 py-3 text-center">
                          학적 변동
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredScoreListRecords.length === 0 ? (
                        <tr>
                          <td
                            colSpan={
                              (selectedScoreRoster?.items.length || 0) +
                              7 +
                              (scoreEditing ? 1 : 0)
                            }
                            className="px-4 py-10 text-center text-sm font-bold text-slate-400"
                          >
                            조건에 맞는 학생 점수가 없습니다.
                          </td>
                        </tr>
                      ) : (
                        sortedFilteredScoreListRecords.map((record) => {
                          const recordKey = getScoreListRecordKey(record);
                          const manualRecord = isManualScoreListRecord(record);
                          const academicStatusLabel =
                            getAcademicStatusLabel(record);
                          const hasAcademicStatus =
                            Boolean(academicStatusLabel);
                          const academicStatusListed =
                            !academicStatusLabel ||
                            ACADEMIC_STATUS_OPTIONS.includes(
                              academicStatusLabel,
                            );
                          const evidenceText = String(
                            record.evidence || record.feedback || "",
                          ).trim();
                          const editableItems = selectedScoreRoster
                            ? getRecordItemsForRoster(
                                record,
                                selectedScoreRoster,
                              )
                            : record.items || [];
                          const percent = getPerformanceScorePercent(
                            record.totalScore,
                            record.totalMaxScore,
                          );
                          const enteredTotalScore =
                            getEnteredTotalScore(record);
                          const selected =
                            selectedScoreListRecordKeys.has(recordKey);
                          return (
                            <tr key={recordKey}>
                              {scoreEditing && (
                                <td className="whitespace-nowrap px-3 py-3 text-center">
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={(event) =>
                                      toggleScoreListRecordSelection(
                                        recordKey,
                                        event.target.checked,
                                      )
                                    }
                                    disabled={savingScoreEdits}
                                    aria-label={`${record.studentName || "학생"} 선택`}
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 accent-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                                  />
                                </td>
                              )}
                              <td className="whitespace-nowrap px-3 py-3 font-bold text-slate-600">
                                {scoreEditing && manualRecord ? (
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={record.grade || ""}
                                    onChange={(event) =>
                                      updateScoreListIdentity(
                                        recordKey,
                                        "grade",
                                        event.target.value,
                                      )
                                    }
                                    disabled={savingScoreEdits}
                                    aria-label="수동 추가 학생 학년"
                                    className="h-9 w-16 rounded-lg border border-slate-200 px-2 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50 disabled:bg-slate-50"
                                  />
                                ) : (
                                  `${record.grade}학년`
                                )}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 font-bold text-slate-600">
                                {scoreEditing && manualRecord ? (
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={record.class || ""}
                                    onChange={(event) =>
                                      updateScoreListIdentity(
                                        recordKey,
                                        "class",
                                        event.target.value,
                                      )
                                    }
                                    disabled={savingScoreEdits}
                                    aria-label="수동 추가 학생 반"
                                    className="h-9 w-16 rounded-lg border border-slate-200 px-2 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50 disabled:bg-slate-50"
                                  />
                                ) : (
                                  `${record.class}반`
                                )}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 font-bold text-slate-600">
                                {scoreEditing && manualRecord ? (
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={record.number || ""}
                                    onChange={(event) =>
                                      updateScoreListIdentity(
                                        recordKey,
                                        "number",
                                        event.target.value,
                                      )
                                    }
                                    disabled={savingScoreEdits}
                                    aria-label="수동 추가 학생 번호"
                                    className="h-9 w-16 rounded-lg border border-slate-200 px-2 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50 disabled:bg-slate-50"
                                  />
                                ) : (
                                  `${record.number}번`
                                )}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 font-black text-slate-900">
                                {scoreEditing && manualRecord ? (
                                  <div className="flex min-w-36 items-center">
                                    <input
                                      type="text"
                                      value={record.studentName || ""}
                                      onChange={(event) =>
                                        updateScoreListIdentity(
                                          recordKey,
                                          "studentName",
                                          event.target.value,
                                        )
                                      }
                                      disabled={savingScoreEdits}
                                      aria-label="수동 추가 학생 이름"
                                      className="h-9 w-32 rounded-lg border border-slate-200 px-2 text-sm font-bold text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50 disabled:bg-slate-50"
                                      placeholder="이름"
                                    />
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <span>
                                      {record.studentName || "(이름 없음)"}
                                    </span>
                                  </div>
                                )}
                              </td>
                              {(selectedScoreRoster?.items || []).map(
                                (item, index) => {
                                  const scoreItem = editableItems[index];
                                  const itemScore =
                                    getEnteredItemScore(scoreItem);
                                  return (
                                    <td
                                      key={`${recordKey}-${item.name}-${index}`}
                                      className="whitespace-nowrap px-3 py-3 text-right font-bold text-slate-700"
                                    >
                                      {hasAcademicStatus ? (
                                        <span className="inline-flex rounded-full bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-600">
                                          {academicStatusLabel}
                                        </span>
                                      ) : scoreEditing ? (
                                        <div className="flex items-center justify-end gap-1.5">
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            value={
                                              itemScore === null
                                                ? ""
                                                : String(
                                                    toScoreEditInteger(
                                                      itemScore,
                                                    ) ?? "",
                                                  )
                                            }
                                            onChange={(event) =>
                                              updateScoreListItemScore(
                                                recordKey,
                                                index,
                                                sanitizeScoreIntegerInput(
                                                  event.target.value,
                                                ),
                                              )
                                            }
                                            disabled={savingScoreEdits}
                                            aria-label={`${record.studentName} ${getItemLabel(item)} 점수`}
                                            className="h-9 w-14 rounded-lg border border-slate-200 px-1.5 text-right text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50 disabled:bg-slate-50"
                                          />
                                          <span className="text-slate-400">
                                            /{" "}
                                            {formatPerformanceScore(
                                              scoreItem?.maxScore ??
                                                item.maxScore,
                                            )}
                                          </span>
                                        </div>
                                      ) : (
                                        <>
                                          {itemScore === null
                                            ? "-"
                                            : formatPerformanceScore(itemScore)}
                                          <span className="ml-1 text-slate-400">
                                            /{" "}
                                            {formatPerformanceScore(
                                              scoreItem?.maxScore ??
                                                item.maxScore,
                                            )}
                                          </span>
                                        </>
                                      )}
                                    </td>
                                  );
                                },
                              )}
                              <td className="whitespace-nowrap px-3 py-3 text-right">
                                {hasAcademicStatus ? (
                                  <span className="inline-flex rounded-full bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-600">
                                    {academicStatusLabel}
                                  </span>
                                ) : (
                                  <>
                                    <div className="font-black text-blue-700">
                                      {formatPerformanceScore(
                                        enteredTotalScore ?? Number.NaN,
                                      )}{" "}
                                      /{" "}
                                      {formatPerformanceScore(
                                        record.totalMaxScore,
                                      )}
                                    </div>
                                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                      <div
                                        className="h-full rounded-full bg-blue-500"
                                        style={{ width: `${percent}%` }}
                                      />
                                    </div>
                                  </>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    scoreEditing
                                      ? void editScoreListEvidence(recordKey)
                                      : void showScoreListEvidence(record)
                                  }
                                  disabled={savingScoreEdits}
                                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                    evidenceText
                                      ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                                  }`}
                                  title={
                                    scoreEditing ? "사유 작성" : "사유 보기"
                                  }
                                  aria-label={
                                    scoreEditing ? "사유 작성" : "사유 보기"
                                  }
                                >
                                  <i
                                    className="fas fa-comment-dots"
                                    aria-hidden="true"
                                  ></i>
                                </button>
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-center">
                                {scoreEditing ? (
                                  <select
                                    value={academicStatusLabel}
                                    onChange={(event) =>
                                      updateScoreListAcademicStatus(
                                        recordKey,
                                        event.target.value,
                                      )
                                    }
                                    disabled={savingScoreEdits}
                                    className="h-9 w-44 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50 disabled:bg-slate-50"
                                    aria-label={`${record.studentName || "학생"} 학적 변동`}
                                  >
                                    <option value="">해당 없음</option>
                                    {!academicStatusListed && (
                                      <option value={academicStatusLabel}>
                                        {academicStatusLabel}
                                      </option>
                                    )}
                                    {ACADEMIC_STATUS_OPTIONS.map((status) => (
                                      <option key={status} value={status}>
                                        {status}
                                      </option>
                                    ))}
                                  </select>
                                ) : academicStatusLabel ? (
                                  <span className="inline-flex rounded-full bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-600">
                                    {academicStatusLabel}
                                  </span>
                                ) : (
                                  <span className="text-xs font-bold text-slate-400">
                                    -
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {scoreListClassFilter === "all" &&
                  scoreListClassPageOptions.length > 1 && (
                    <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-slate-100 px-4 py-3">
                      {scoreListClassPageOptions.map((classValue, index) => {
                        const page = index + 1;
                        return (
                          <button
                            key={classValue}
                            type="button"
                            onClick={() => setScoreListClassPage(page)}
                            className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-xs font-black transition ${
                              page === safeScoreListClassPage
                                ? "border-blue-600 bg-blue-600 text-white"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                            aria-current={
                              page === safeScoreListClassPage
                                ? "page"
                                : undefined
                            }
                            title={`${classValue}반`}
                          >
                            {classValue}
                          </button>
                        );
                      })}
                    </div>
                  )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-400">
                평가명과 조건을 선택한 뒤 조회를 누르면 학생별 점수 목록이
                표시됩니다.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default PerformanceScoreManager;
