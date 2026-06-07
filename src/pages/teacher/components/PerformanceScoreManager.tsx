import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteField,
  doc,
  type DocumentData,
  type DocumentReference,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  type WithFieldValue,
  writeBatch,
} from "firebase/firestore";
import { InlineLoading } from "../../../components/common/LoadingState";
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
  PERFORMANCE_SCORE_USER_COLLECTION,
  applyPerformanceScoreConfirmation,
  buildStudentLookupKey,
  buildStudentNameLookupKey,
  formatPerformanceScore,
  getPerformanceScorePercent,
  loadPerformanceScoreConfirmation,
  normalizeSchoolValue,
  normalizeStudentName,
  roundScore,
  sortPerformanceScoreRecords,
  type PerformanceScoreRecord,
  type PerformanceScoreRoster,
  type PerformanceScoreRosterRow,
} from "../../../lib/performanceScores";
import {
  parsePerformanceScoreWorkbook,
  type ParsedPerformanceScoreRow,
  type ParsedPerformanceScoreUpload,
} from "../../../lib/performanceScoreWorkbook";

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
const CLASS_SHEET_SIGNATURE_START_COLUMN = 9;
const CLASS_SHEET_SIGNATURE_HORIZONTAL_PADDING = 0.12;
const CLASS_SHEET_SIGNATURE_VERTICAL_PADDING = 0.08;
const CLASS_SHEET_SIGNATURE_IMAGE_MAX_WIDTH = 58;
const CLASS_SHEET_SIGNATURE_IMAGE_MAX_HEIGHT = 14;
const CLASS_SHEET_SIGNATURE_COLUMN_PIXEL_WIDTH = 64;
const CLASS_SHEET_SIGNATURE_ROW_PIXEL_HEIGHT = 19;
const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

const matchRowsToStudents = (
  rows: ParsedScoreRow[],
  students: StudentProfile[],
): ParsedScoreRow[] => {
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

  return rows.map((row) => {
    const numberMatches = byNumber.get(
      buildStudentLookupKey(row.grade, row.class, row.number),
    );
    const numberMatch =
      numberMatches && numberMatches.length === 1 ? numberMatches[0] : null;
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

    const nameMatches = byName.get(
      buildStudentNameLookupKey(row.grade, row.class, row.studentName),
    );
    const nameMatch =
      nameMatches && nameMatches.length === 1 ? nameMatches[0] : null;
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
  if (!record) return null;
  const score = Number(record.totalScore);
  return Number.isFinite(score) ? roundScore(score) : null;
};

const getConfirmedSignatureRecord = (
  student: ClassSheetStudent,
  expected: { requireFirst?: boolean; requireSecond?: boolean } = {},
) => {
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
  student.uid ||
  buildStudentLookupKey(student.grade, student.class, student.number);

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
    const firstScore = getScoreNumber(student.firstRecord);
    const secondScore = getScoreNumber(student.secondRecord);
    const totalScore =
      (firstScore ?? 0) + (secondScore ?? 0) > 0
        ? roundScore((firstScore ?? 0) + (secondScore ?? 0))
        : "";
    const row = makeExcelRow(18);
    setExcelCell(row, 1, `${student.class}/${student.number}`, {
      columnSpan: 2,
    });
    setExcelCell(row, 3, student.studentName);
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
    .map((student) => getScoreNumber(student.firstRecord))
    .filter((score): score is number => score !== null);
  const secondScores = params.students
    .map((student) => getScoreNumber(student.secondRecord))
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

  rows.push(makeExcelRow(120));

  const footer = makeExcelRow(18);
  footer[8] = plainExcelCell(1, { columnSpan: 2 });
  footer[10] = plainExcelCell("/", { columnSpan: 2 });
  footer[12] = plainExcelCell(1, { columnSpan: 2 });
  footer[14] = plainExcelCell("용신중학교", { columnSpan: 2 });
  rows.push(footer);

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

const cloneWorksheetStyle = (style: unknown) =>
  JSON.parse(JSON.stringify(style || {}));

const unmergeWorksheetRange = (
  worksheet: { unMergeCells?: (range: string) => void },
  range: string,
) => {
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

const getClassSheetSignatureImageSize = (dataUrl: string) => {
  const dimensions = getClassSheetSignaturePngDimensions(dataUrl);
  const sourceWidth =
    dimensions?.width || CLASS_SHEET_SIGNATURE_IMAGE_MAX_WIDTH;
  const sourceHeight =
    dimensions?.height || CLASS_SHEET_SIGNATURE_IMAGE_MAX_HEIGHT;
  const ratio = sourceWidth / sourceHeight;
  const maxRatio =
    CLASS_SHEET_SIGNATURE_IMAGE_MAX_WIDTH /
    CLASS_SHEET_SIGNATURE_IMAGE_MAX_HEIGHT;

  if (!Number.isFinite(ratio) || ratio <= 0) {
    return {
      width: CLASS_SHEET_SIGNATURE_IMAGE_MAX_WIDTH,
      height: CLASS_SHEET_SIGNATURE_IMAGE_MAX_HEIGHT,
    };
  }

  if (ratio > maxRatio) {
    return {
      width: CLASS_SHEET_SIGNATURE_IMAGE_MAX_WIDTH,
      height: Math.max(1, CLASS_SHEET_SIGNATURE_IMAGE_MAX_WIDTH / ratio),
    };
  }

  return {
    width: Math.max(1, CLASS_SHEET_SIGNATURE_IMAGE_MAX_HEIGHT * ratio),
    height: CLASS_SHEET_SIGNATURE_IMAGE_MAX_HEIGHT,
  };
};

const getClassSheetSignatureImagePosition = (row: number, dataUrl: string) => {
  const size = getClassSheetSignatureImageSize(dataUrl);
  const horizontalCenterOffset =
    Math.max(0, CLASS_SHEET_SIGNATURE_IMAGE_MAX_WIDTH - size.width) /
    2 /
    CLASS_SHEET_SIGNATURE_COLUMN_PIXEL_WIDTH;
  const verticalCenterOffset =
    Math.max(0, CLASS_SHEET_SIGNATURE_IMAGE_MAX_HEIGHT - size.height) /
    2 /
    CLASS_SHEET_SIGNATURE_ROW_PIXEL_HEIGHT;

  return {
    tl: {
      col:
        CLASS_SHEET_SIGNATURE_START_COLUMN +
        CLASS_SHEET_SIGNATURE_HORIZONTAL_PADDING +
        horizontalCenterOffset,
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
        if (alpha <= 8) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < 0 || maxY < 0) return dataUrl;
    const padding = Math.max(
      4,
      Math.ceil(Math.max(maxX - minX, maxY - minY) * 0.04),
    );
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(width - 1, maxX + padding);
    maxY = Math.min(height - 1, maxY + padding);

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
    return croppedCanvas.toDataURL("image/png");
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
  const { studentEndRow, summaryStartRow } = resizeClassSheetStudentRows(
    worksheet,
    params.students.length,
  );

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
  setWorksheetCellValue(
    worksheet,
    6,
    5,
    `${params.firstRoster?.title || "고조선 8조법 4컷 만화 그리기"}\n(만점 ${formatPerformanceScore(
      params.firstRoster?.totalMaxScore || 20,
    )})`,
  );
  setWorksheetCellValue(
    worksheet,
    6,
    7,
    `${params.secondRoster?.title || "삼국 시대 인물의 무덤에 평점 남기기"}\n(만점 ${formatPerformanceScore(
      params.secondRoster?.totalMaxScore || 30,
    )})`,
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
    const firstScore = getScoreNumber(student.firstRecord);
    const secondScore = getScoreNumber(student.secondRecord);
    const totalScore =
      firstScore !== null || secondScore !== null
        ? roundScore((firstScore ?? 0) + (secondScore ?? 0))
        : "";
    setWorksheetCellValue(
      worksheet,
      row,
      2,
      `${student.class}/${student.number}`,
    );
    setWorksheetCellValue(worksheet, row, 3, "");
    setWorksheetCellValue(worksheet, row, 4, student.studentName);
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
    .map((student) => getScoreNumber(student.firstRecord))
    .filter((score): score is number => score !== null);
  const secondScores = params.students
    .map((student) => getScoreNumber(student.secondRecord))
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
      ...getClassSheetSignatureImagePosition(image.row, image.dataUrl),
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME_TYPE });
};

const PerformanceScoreManager: React.FC = () => {
  const { config, currentUser } = useAuth();
  const { showToast } = useAppToast();
  const { confirm } = useAppDialog();
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
  const [previewClassFilter, setPreviewClassFilter] = useState("all");
  const [previewPage, setPreviewPage] = useState(1);
  const [assessmentPreset, setAssessmentPreset] =
    useState<AssessmentPresetKey>("auto");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadAssessmentPreset, setUploadAssessmentPreset] =
    useState<UploadAssessmentPresetKey>("first");
  const [scoreListRosterId, setScoreListRosterId] = useState("");
  const [scoreListLoadedRosterId, setScoreListLoadedRosterId] = useState("");
  const [scoreListGradeFilter, setScoreListGradeFilter] = useState("all");
  const [scoreListClassFilter, setScoreListClassFilter] = useState("all");
  const [scoreListClassPage, setScoreListClassPage] = useState(1);
  const [scoreListSearch, setScoreListSearch] = useState("");
  const [scoreListRecords, setScoreListRecords] = useState<
    PerformanceScoreRecord[]
  >([]);
  const [scoreListLoading, setScoreListLoading] = useState(false);
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
    void loadRosters();
  }, [year, semester]);

  useEffect(() => {
    setScoreListRosterId((current) =>
      current && rosters.some((roster) => roster.id === current)
        ? current
        : rosters[0]?.id || "",
    );
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
    (selectedScoreRoster?.classes || []).forEach((classValue) => {
      if (classValue) values.add(classValue);
    });
    (selectedScoreRoster?.rows || []).forEach((row) => {
      if (row.class) values.add(row.class);
    });
    return Array.from(values).sort(
      (a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"),
    );
  }, [selectedScoreRoster]);
  const scoreListReady =
    !!selectedScoreRoster && scoreListLoadedRosterId === selectedScoreRoster.id;
  const scoreListBaseRecords = useMemo(() => {
    if (!scoreListReady) return [];
    const searchKey = normalizeStudentName(scoreListSearch).toLocaleLowerCase();
    return scoreListRecords.filter((record) => {
      const gradeMatched =
        scoreListGradeFilter === "all" ||
        normalizeSchoolValue(record.grade) ===
          normalizeSchoolValue(scoreListGradeFilter);
      const identityKey = normalizeStudentName(
        `${record.studentName} ${record.class}반 ${record.number}번`,
      ).toLocaleLowerCase();
      const searchMatched = !searchKey || identityKey.includes(searchKey);
      return gradeMatched && searchMatched;
    });
  }, [scoreListGradeFilter, scoreListReady, scoreListRecords, scoreListSearch]);
  const scoreListClassPageOptions = useMemo(() => {
    if (scoreListClassFilter !== "all") return [scoreListClassFilter];
    const values = new Set<string>();
    scoreListBaseRecords.forEach((record) => {
      if (record.class) values.add(record.class);
    });
    return Array.from(values).sort(
      (a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"),
    );
  }, [scoreListBaseRecords, scoreListClassFilter]);
  const scoreListClassTotalPages = Math.max(
    1,
    scoreListClassPageOptions.length,
  );
  const safeScoreListClassPage = Math.min(
    Math.max(1, scoreListClassPage),
    scoreListClassTotalPages,
  );
  const activeScoreListClass =
    scoreListClassFilter !== "all"
      ? scoreListClassFilter
      : scoreListClassPageOptions[safeScoreListClassPage - 1] || "";
  const filteredScoreListRecords = useMemo(() => {
    if (!scoreListReady || !activeScoreListClass) return [];
    return scoreListBaseRecords.filter(
      (record) =>
        normalizeSchoolValue(record.class) ===
        normalizeSchoolValue(activeScoreListClass),
    );
  }, [activeScoreListClass, scoreListBaseRecords, scoreListReady]);
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
      (student) => student.firstRecord,
    ).length;
    const secondScoredCount = classSheetPreviewStudents.filter(
      (student) => student.secondRecord,
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

  const loadRosters = async () => {
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
        return {
          id: item.id,
          ...data,
          rows: Array.isArray(data.rows) ? data.rows : [],
          classes: Array.isArray(data.classes) ? data.classes : [],
          items: Array.isArray(data.items) ? data.items : [],
        };
      });
      setRosters(sortPerformanceScoreRosters(loaded));
    } catch (error) {
      console.error("Failed to load performance score rosters:", error);
    } finally {
      setRostersLoading(false);
    }
  };

  const loadScoreListRecords = async () => {
    if (!selectedScoreRoster || scoreListLoading) return;
    setScoreListLoading(true);
    try {
      const linkedRows = (selectedScoreRoster.rows || []).filter(
        (row) => row.uid,
      );
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
                selectedScoreRoster.id,
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
          loaded.push({
            id: selectedScoreRoster.id,
            rosterId: selectedScoreRoster.id,
            title: selectedScoreRoster.title,
            subject: selectedScoreRoster.subject,
            ...(selectedScoreRoster.assessmentOrder
              ? { assessmentOrder: selectedScoreRoster.assessmentOrder }
              : {}),
            academicYear: selectedScoreRoster.academicYear,
            semester: selectedScoreRoster.semester,
            grade: row.grade,
            class: row.class,
            number: row.number,
            studentName: row.studentName,
            uid: row.uid,
            items: Array.isArray(row.items) ? row.items : [],
            totalScore: row.totalScore || 0,
            totalMaxScore:
              row.totalMaxScore || selectedScoreRoster.totalMaxScore || 0,
            feedback: row.feedback || "",
            evidence: row.evidence || row.feedback || "",
            sourceFileName: selectedScoreRoster.sourceFileName,
          });
        });
      }
      setScoreListRecords(
        sortPerformanceScoreRecords(loaded).sort(
          (a, b) =>
            Number(a.grade) - Number(b.grade) ||
            Number(a.class) - Number(b.class) ||
            Number(a.number) - Number(b.number) ||
            String(a.studentName || "").localeCompare(
              String(b.studentName || ""),
              "ko",
            ),
        ),
      );
      setScoreListLoadedRosterId(selectedScoreRoster.id);
    } catch (error) {
      console.error("Failed to load performance score list:", error);
      showToast({
        tone: "error",
        title: "점수 목록을 불러오지 못했습니다.",
        message: "권한과 네트워크 상태를 확인한 뒤 다시 조회해 주세요.",
      });
    } finally {
      setScoreListLoading(false);
    }
  };

  const loadRosterRecordsForClass = async (
    roster: PerformanceScoreRoster | undefined,
    classValue: string,
    gradeValue: string,
  ) => {
    if (!roster) return [];
    const linkedRows = (roster.rows || []).filter(
      (row) =>
        row.uid &&
        normalizeSchoolValue(row.class) === normalizeSchoolValue(classValue) &&
        (!gradeValue ||
          normalizeSchoolValue(row.grade) === normalizeSchoolValue(gradeValue)),
    );
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
        loaded.push({
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
          items: Array.isArray(row.items) ? row.items : [],
          totalScore: row.totalScore || 0,
          totalMaxScore: row.totalMaxScore || roster.totalMaxScore || 0,
          feedback: row.feedback || "",
          evidence: row.evidence || row.feedback || "",
          sourceFileName: roster.sourceFileName,
        });
      });
    }
    const withConfirmations = await Promise.all(
      loaded.map(async (record) =>
        applyPerformanceScoreConfirmation(
          record,
          await loadPerformanceScoreConfirmation(record.uid, roster.id),
        ),
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
    const addRecord = (
      record: PerformanceScoreRecord,
      slot: "firstRecord" | "secondRecord",
    ) => {
      const key =
        record.uid ||
        buildStudentLookupKey(record.grade, record.class, record.number);
      const current = studentMap.get(key) || {
        uid: record.uid,
        grade: record.grade,
        class: record.class,
        number: record.number,
        studentName: record.studentName,
      };
      studentMap.set(key, {
        ...current,
        uid: current.uid || record.uid,
        grade: current.grade || record.grade,
        class: current.class || record.class,
        number: current.number || record.number,
        studentName: current.studentName || record.studentName,
        [slot]: record,
      });
    };
    firstRecords.forEach((record) => addRecord(record, "firstRecord"));
    secondRecords.forEach((record) => addRecord(record, "secondRecord"));

    return Array.from(studentMap.values()).sort(
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
        teacherName: currentUser?.displayName || "방재석",
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
    const confirmed = window.confirm(
      [
        `${student.class}반 ${student.number}번 ${student.studentName} 학생의 점수 확인 서명을 반려할까요?`,
        "학생 점수는 유지되고, 확인 서명만 삭제됩니다.",
        "반려 후에만 학생이 다시 서명할 수 있습니다.",
        "",
        scoreTitles,
      ].join("\n"),
    );
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
        message: `${student.studentName} 학생은 다시 점수 확인 및 서명을 진행할 수 있습니다.`,
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
    if (
      skippedMessages.length > 0 &&
      !window.confirm(
        [
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
      )
    ) {
      return;
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
          totalScore: row.totalScore,
          totalMaxScore: row.totalMaxScore,
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

      const savedScoreRecords: PerformanceScoreRecord[] = [];
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
        });
      });

      await batchQueue.commit();
      setParsed(null);
      setScoreListRosterId(rosterId);
      setScoreListLoadedRosterId(rosterId);
      setScoreListGradeFilter("all");
      setScoreListClassFilter("all");
      setScoreListSearch("");
      setScoreListRecords(
        sortPerformanceScoreRecords(savedScoreRecords).sort(
          (a, b) =>
            Number(a.grade) - Number(b.grade) ||
            Number(a.class) - Number(b.class) ||
            Number(a.number) - Number(b.number) ||
            String(a.studentName || "").localeCompare(
              String(b.studentName || ""),
              "ko",
            ),
        ),
      );
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
    if (deletingRosterId) return;
    if (
      !window.confirm(
        `${roster.title} 업로드 기록과 학생별 점수 문서를 삭제할까요?`,
      )
    ) {
      return;
    }

    setDeletingRosterId(roster.id);
    try {
      const batchQueue = createBatchQueue();
      batchQueue.delete(doc(db, rosterCollectionPath, roster.id));
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
      if (scoreListRosterId === roster.id) {
        setScoreListLoadedRosterId("");
        setScoreListRecords([]);
      }
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

  return (
    <div className="space-y-6">
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
                              setScoreListRosterId(roster.id);
                              setScoreListClassFilter("all");
                              setUploadModalOpen(false);
                            }}
                            className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-blue-700 transition hover:bg-blue-50"
                          >
                            <i className="fas fa-list" aria-hidden="true"></i>
                            선택
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteRoster(roster)}
                            disabled={deletingRosterId === roster.id}
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

      {classSheetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
          <section className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
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

            <div className="overflow-y-auto px-5 py-4">
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

              <div className="mt-3 grid gap-2 text-xs font-bold text-slate-500 md:grid-cols-2">
                <div className="truncate rounded-lg bg-slate-50 px-3 py-2">
                  1차 원본:{" "}
                  {summaryExportRosters.firstRoster?.sourceFileName || "-"}
                </div>
                <div className="truncate rounded-lg bg-slate-50 px-3 py-2">
                  2차 원본:{" "}
                  {summaryExportRosters.secondRoster?.sourceFileName || "-"}
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

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[1100px] table-fixed text-left text-sm">
                      <colgroup>
                        <col className="w-24" />
                        <col className="w-20" />
                        <col className="w-40" />
                        <col className="w-28" />
                        <col className="w-28" />
                        <col className="w-20" />
                        <col className="w-12" />
                        <col className="w-[300px]" />
                      </colgroup>
                      <thead className="bg-slate-50 text-xs font-black text-slate-500">
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
                            const firstScore = getScoreNumber(
                              student.firstRecord,
                            );
                            const secondScore = getScoreNumber(
                              student.secondRecord,
                            );
                            const totalScore =
                              firstScore !== null || secondScore !== null
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
                            const signatureName =
                              signatureDisplayRecord?.signatureName ||
                              signatureDisplayRecord?.confirmation
                                ?.signatureName ||
                              student.studentName;
                            const studentKey = getClassSheetStudentKey(student);
                            const missingLabels = [
                              !student.firstRecord ? "1차 점수" : "",
                              !student.secondRecord ? "2차 점수" : "",
                            ].filter(Boolean);
                            const statusLabel = missingLabels.length
                              ? "점수 누락"
                              : signatureRecord
                                ? "확인 완료"
                                : "서명 필요";
                            const statusClass = missingLabels.length
                              ? "bg-amber-50 text-amber-700"
                              : signatureRecord
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-rose-50 text-rose-700";
                            return (
                              <tr
                                key={`${student.uid}-${student.class}-${student.number}`}
                              >
                                <td className="px-3 py-3 text-center">
                                  <span
                                    className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${statusClass}`}
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
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-right font-bold text-slate-700">
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
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-right font-black text-blue-700">
                                  {totalScore === null
                                    ? "-"
                                    : formatPerformanceScore(totalScore)}
                                </td>
                                <td aria-hidden="true"></td>
                                <td className="px-3 py-3 text-center">
                                  {signatureDisplayRecord && signatureImage ? (
                                    <div className="mx-auto flex w-fit min-w-[230px] items-center justify-center gap-2 whitespace-nowrap">
                                      <div className="flex h-8 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-blue-100 bg-blue-50 px-1.5">
                                        <img
                                          src={signatureImage}
                                          alt={`${student.studentName} 서명`}
                                          className="max-h-6 max-w-full object-contain"
                                        />
                                      </div>
                                      <div className="min-w-0">
                                        <div
                                          className={`text-[11px] font-black leading-4 ${
                                            signatureRecord
                                              ? "text-emerald-700"
                                              : "text-amber-700"
                                          }`}
                                        >
                                          {signatureRecord
                                            ? "서명 완료"
                                            : "부분 서명"}
                                        </div>
                                        <div className="max-w-[3.5rem] truncate text-[11px] font-bold leading-4 text-slate-500">
                                          {signatureName}
                                        </div>
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
                                        className="inline-flex h-7 w-16 shrink-0 items-center justify-center rounded-md border border-rose-200 bg-white text-[11px] font-black text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        {rejectingSignatureKey === studentKey
                                          ? "반려 중..."
                                          : "반려"}
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="mx-auto w-fit text-center text-xs font-bold leading-5 text-slate-500">
                                      {missingLabels.length
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
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
            >
              <i
                className={`fas fa-sync-alt text-xs ${studentsLoading ? "animate-spin" : ""}`}
                aria-hidden="true"
              ></i>
              명단 새로고침
            </button>
            <button
              type="button"
              onClick={() => setUploadModalOpen(true)}
              disabled={parsing}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <i
                className="fas fa-file-arrow-up text-xs"
                aria-hidden="true"
              ></i>
              {parsing ? "인식 중..." : "점수표 업로드"}
            </button>
            <button
              type="button"
              onClick={() => setClassSheetModalOpen(true)}
              disabled={rostersLoading || rosters.length === 0}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-4 text-sm font-black text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i className="fas fa-file-download text-xs" aria-hidden="true" />
              일람표 다운로드
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
                      setScoreListRosterId(event.target.value);
                      setScoreListClassFilter("all");
                    }}
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                  >
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
                  disabled={!selectedScoreRoster || scoreListLoading}
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

            {scoreListReady ? (
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
                      · 저장 {scoreListRecords.length}명 · 만점{" "}
                      {formatPerformanceScore(
                        selectedScoreRoster?.totalMaxScore,
                      )}
                      점
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="inline-flex max-w-[360px] items-center truncate rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                      {selectedScoreRoster?.sourceFileName}
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1080px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-black text-slate-500">
                      <tr>
                        <th className="whitespace-nowrap px-3 py-3">학년</th>
                        <th className="whitespace-nowrap px-3 py-3">반</th>
                        <th className="whitespace-nowrap px-3 py-3">번호</th>
                        <th className="whitespace-nowrap px-3 py-3">이름</th>
                        {(selectedScoreRoster?.items || []).map(
                          (item, index) => (
                            <th
                              key={`${item.name}-${index}`}
                              className="whitespace-nowrap px-3 py-3 text-right"
                            >
                              {getItemLabel(item)}
                            </th>
                          ),
                        )}
                        <th className="whitespace-nowrap px-3 py-3 text-right">
                          총점
                        </th>
                        <th className="whitespace-nowrap px-3 py-3">
                          감점 요인 및 평가 근거
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredScoreListRecords.length === 0 ? (
                        <tr>
                          <td
                            colSpan={
                              (selectedScoreRoster?.items.length || 0) + 6
                            }
                            className="px-4 py-10 text-center text-sm font-bold text-slate-400"
                          >
                            조건에 맞는 학생 점수가 없습니다.
                          </td>
                        </tr>
                      ) : (
                        filteredScoreListRecords.map((record) => {
                          const percent = getPerformanceScorePercent(
                            record.totalScore,
                            record.totalMaxScore,
                          );
                          return (
                            <tr key={`${record.uid}-${record.rosterId}`}>
                              <td className="whitespace-nowrap px-3 py-3 font-bold text-slate-600">
                                {record.grade}학년
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 font-bold text-slate-600">
                                {record.class}반
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 font-bold text-slate-600">
                                {record.number}번
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 font-black text-slate-900">
                                {record.studentName || "(이름 없음)"}
                              </td>
                              {(selectedScoreRoster?.items || []).map(
                                (item, index) => {
                                  const scoreItem = record.items?.[index];
                                  return (
                                    <td
                                      key={`${record.uid}-${item.name}-${index}`}
                                      className="whitespace-nowrap px-3 py-3 text-right font-bold text-slate-700"
                                    >
                                      {scoreItem?.scoreEntered === false
                                        ? "-"
                                        : formatPerformanceScore(
                                            scoreItem?.score,
                                          )}
                                      <span className="ml-1 text-slate-400">
                                        /{" "}
                                        {formatPerformanceScore(
                                          scoreItem?.maxScore ?? item.maxScore,
                                        )}
                                      </span>
                                    </td>
                                  );
                                },
                              )}
                              <td className="whitespace-nowrap px-3 py-3 text-right">
                                <div className="font-black text-blue-700">
                                  {formatPerformanceScore(record.totalScore)} /{" "}
                                  {formatPerformanceScore(record.totalMaxScore)}
                                </div>
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className="h-full rounded-full bg-blue-500"
                                    style={{ width: `${percent}%` }}
                                  />
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <div className="max-w-[360px] text-xs font-semibold leading-5 text-slate-600">
                                  {record.evidence || record.feedback || "-"}
                                </div>
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
