import {
  normalizeSchoolValue,
  roundScore,
  toFiniteScore,
  type PerformanceScoreItem,
  type PerformanceScoreRosterRow,
} from "./performanceScores";

export interface ParsedWrittenExamEssayScoreRow extends PerformanceScoreRosterRow {
  rowKey: string;
  enteredScoreCount: number;
  items: PerformanceScoreItem[];
  totalScore: number;
  totalMaxScore: number;
  feedback: string;
}

export interface ParsedWrittenExamEssayScoreUpload {
  sourceFileName: string;
  headerRowNumber: number;
  title: string;
  subject: string;
  itemName: string;
  rows: ParsedWrittenExamEssayScoreRow[];
  totalMaxScore: number;
  detectedClasses: string[];
}

interface EssayScoreColumnIndexes {
  gradeIndex: number;
  classIndex: number;
  numberIndex: number;
  nameIndex: number;
  scoreIndex: number;
  feedbackIndex: number;
}

const MAX_UPLOAD_ROWS = 400;

const toText = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const toHeaderKey = (value: unknown) =>
  toText(value).replace(/\s+/g, "").toLowerCase();

const getCell = (row: unknown[], index: number) =>
  index >= 0 ? row[index] : "";

const getCellText = (row: unknown[], index: number) =>
  toText(getCell(row, index));

const findColumnIndex = (
  headers: string[],
  predicate: (header: string) => boolean,
) => headers.findIndex((header) => predicate(header));

const isFeedbackHeader = (header: string) =>
  /^(피드백|교사피드백|선생님피드백|교사의견|평가의견|코멘트|comment|feedback|비고)$/.test(
    header,
  );

const resolveEssayScoreColumns = (
  headers: string[],
): EssayScoreColumnIndexes => {
  const gradeIndex = findColumnIndex(headers, (header) =>
    /^(학년|대상학년)$/.test(header),
  );
  const classIndex = findColumnIndex(headers, (header) =>
    /^(반|학급|학급명|반명)$/.test(header),
  );
  const numberIndex = findColumnIndex(
    headers,
    (header) =>
      header !== "순번" &&
      /^(번호|번|출석번호|학번)$/.test(header.replace(/학생/g, "")),
  );
  const nameIndex = findColumnIndex(
    headers,
    (header) =>
      /^(이름|성명|학생명|학생이름)$/.test(header) || header.includes("성명"),
  );
  const scoreIndex = findColumnIndex(headers, (header) =>
    /^(점수|논술형점수|서술형점수|논술점수|서술점수|총점|합계|원점수)$/.test(
      header,
    ),
  );
  let feedbackIndex = -1;
  for (let index = headers.length - 1; index >= 0; index -= 1) {
    if (isFeedbackHeader(headers[index])) {
      feedbackIndex = index;
      break;
    }
  }

  return {
    gradeIndex,
    classIndex,
    numberIndex,
    nameIndex,
    scoreIndex,
    feedbackIndex,
  };
};

const findEssayScoreHeaderRow = (rows: unknown[][]) => {
  const scanLimit = Math.min(rows.length, 20);
  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const headers = (rows[rowIndex] || []).map(toHeaderKey);
    const indexes = resolveEssayScoreColumns(headers);
    if (
      indexes.numberIndex >= 0 &&
      indexes.nameIndex >= 0 &&
      indexes.scoreIndex >= 0
    ) {
      return rowIndex;
    }
  }
  return -1;
};

const cleanExamTitle = (fileName: string) => {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "").trim();
  return (
    withoutExtension
      .replace(/^\d{4}학년도\s*\d+\s*학기\s*/g, "")
      .replace(/^\d+\s*학년\s*/g, "")
      .trim() || withoutExtension
  );
};

const sortSchoolValues = (values: string[]) =>
  values.sort((a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"));

export const parseWrittenExamEssayScoreWorkbook = (
  rows: unknown[][],
  params: {
    fileName: string;
    targetGrade: string;
    fallbackClass: string;
    title?: string;
    subject?: string;
    itemName?: string;
    maxScore: number;
  },
): ParsedWrittenExamEssayScoreUpload => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("첫 번째 시트를 찾을 수 없습니다.");
  }
  const maxScore = roundScore(Number(params.maxScore || 0));
  if (!Number.isFinite(maxScore) || maxScore <= 0) {
    throw new Error("논술형 만점을 먼저 입력해 주세요.");
  }

  const headerRowIndex = findEssayScoreHeaderRow(rows);
  if (headerRowIndex < 0) {
    throw new Error(
      "번호, 이름, 점수가 포함된 정기시험 논술형 점수표 헤더 행을 찾지 못했습니다.",
    );
  }

  const headers = (rows[headerRowIndex] || []).map(toHeaderKey);
  const indexes = resolveEssayScoreColumns(headers);
  if (
    indexes.numberIndex < 0 ||
    indexes.nameIndex < 0 ||
    indexes.scoreIndex < 0
  ) {
    throw new Error("번호, 이름, 점수 컬럼을 모두 확인해 주세요.");
  }

  const candidateRows = rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .slice(headerRowIndex + 1)
    .slice(0, MAX_UPLOAD_ROWS)
    .filter(({ row }) =>
      row.some((cell) => String(cell ?? "").trim().length > 0),
    );
  const scoreRows = candidateRows.filter(({ row }) =>
    Boolean(getCellText(row, indexes.nameIndex)),
  );
  if (!scoreRows.length) {
    throw new Error("등록할 학생 점수 행을 찾지 못했습니다.");
  }

  const itemName = toText(params.itemName) || "논술형 점수";
  const rowsWithScores: ParsedWrittenExamEssayScoreRow[] = scoreRows.map(
    ({ row, rowIndex }) => {
      const rowGrade =
        getCellText(row, indexes.gradeIndex) || params.targetGrade.trim();
      const rowClass =
        getCellText(row, indexes.classIndex) || params.fallbackClass.trim();
      const rowNumber = getCellText(row, indexes.numberIndex);
      const studentName = getCellText(row, indexes.nameIndex);
      const parsedScore = toFiniteScore(getCell(row, indexes.scoreIndex));
      const score = roundScore(parsedScore ?? 0);
      const feedback = getCellText(row, indexes.feedbackIndex).slice(0, 1000);
      const item = {
        name: itemName,
        shortName: "논술형",
        score,
        maxScore,
        scoreEntered: parsedScore !== null,
      };

      return {
        rowKey: `row-${rowIndex + 1}-${studentName}-${rowNumber}`,
        rowNumber: rowIndex + 1,
        enteredScoreCount: parsedScore !== null ? 1 : 0,
        uid: "",
        grade: normalizeSchoolValue(rowGrade),
        class: normalizeSchoolValue(rowClass),
        number: normalizeSchoolValue(rowNumber),
        studentName,
        items: [item],
        totalScore: score,
        totalMaxScore: maxScore,
        feedback,
        evidence: feedback,
        matchStatus: "unmatched",
        matchMessage: "학생 명단과 아직 연결되지 않았습니다.",
      };
    },
  );

  return {
    sourceFileName: params.fileName,
    headerRowNumber: headerRowIndex + 1,
    title: toText(params.title) || cleanExamTitle(params.fileName),
    subject: toText(params.subject) || "역사",
    itemName,
    rows: rowsWithScores,
    totalMaxScore: maxScore,
    detectedClasses: sortSchoolValues(
      Array.from(
        new Set(rowsWithScores.map((row) => row.class).filter(Boolean)),
      ),
    ),
  };
};
