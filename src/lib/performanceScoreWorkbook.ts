import {
  normalizeSchoolValue,
  roundScore,
  toFiniteScore,
  type PerformanceScoreItem,
  type PerformanceScoreRosterRow,
} from "./performanceScores";

export interface ParsedPerformanceScoreRow extends PerformanceScoreRosterRow {
  rowKey: string;
  enteredScoreCount: number;
}

export interface ParsedPerformanceScoreUpload {
  sourceFileName: string;
  headerRowNumber: number;
  title: string;
  subject: string;
  assessmentOrder?: number;
  items: Array<Pick<PerformanceScoreItem, "name" | "maxScore" | "ratio">>;
  rows: ParsedPerformanceScoreRow[];
  totalMaxScore: number;
  detectedClasses: string[];
}

interface FinalScoreColumnIndexes {
  gradeIndex: number;
  classIndex: number;
  numberIndex: number;
  nameIndex: number;
  totalIndex: number;
  feedbackIndex: number;
}

interface ScoreColumn {
  header: string;
  index: number;
  maxScore: number;
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
  /^(선생님작성피드백|교사피드백|피드백|교사의견|평가의견|감점요인|평가근거|코멘트|comment|feedback)$/.test(
    header,
  ) ||
  /(선생님작성피드백|교사피드백|피드백|교사의견|평가의견|감점요인|평가근거)/.test(
    header,
  );

const findFinalScoreHeaderRow = (rows: unknown[][]) => {
  const scanLimit = Math.min(rows.length, 20);
  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const headers = (rows[rowIndex] || []).map(toHeaderKey);
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
    const totalIndex = findColumnIndex(headers, (header) =>
      /^(총점|합계|총합|계)$/.test(header),
    );

    if (
      gradeIndex >= 0 &&
      classIndex >= 0 &&
      numberIndex >= 0 &&
      nameIndex >= 0 &&
      totalIndex >= 0
    ) {
      return rowIndex;
    }
  }
  return -1;
};

const resolveFinalScoreColumns = (
  headers: string[],
): FinalScoreColumnIndexes => {
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
  const totalIndex = findColumnIndex(headers, (header) =>
    /^(총점|합계|총합|계)$/.test(header),
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
    totalIndex,
    feedbackIndex,
  };
};

const cleanAssessmentTitle = (fileName: string) => {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "").trim();
  return (
    withoutExtension
      .replace(/^\d{4}학년도\s*\d+\s*학기\s*/g, "")
      .replace(/^\d+\s*학년\s*/g, "")
      .replace(/^(주간|전체)\s*/g, "")
      .trim() || withoutExtension
  );
};

const inferAssessmentOrder = (title: string) => {
  const normalized = toHeaderKey(title);
  if (/고조선|8조법|4컷/.test(normalized)) return 1;
  if (/삼국|무덤|평점/.test(normalized)) return 2;
  return undefined;
};

const inferSubject = (title: string) =>
  /고조선|8조법|삼국|역사/.test(title) ? "역사" : "";

const sortSchoolValues = (values: string[]) =>
  values.sort((a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"));

export const parsePerformanceScoreWorkbook = (
  rows: unknown[][],
  params: {
    fileName: string;
    targetGrade: string;
    fallbackClass: string;
  },
): ParsedPerformanceScoreUpload => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("첫 번째 시트를 찾을 수 없습니다.");
  }

  const headerRowIndex = findFinalScoreHeaderRow(rows);
  if (headerRowIndex < 0) {
    throw new Error(
      "학년, 반, 번호, 이름, 총점이 포함된 최종 점수표 헤더 행을 찾지 못했습니다.",
    );
  }

  const rawHeaders = rows[headerRowIndex] || [];
  const headers = rawHeaders.map(toHeaderKey);
  const displayHeaders = rawHeaders.map(toText);
  const indexes = resolveFinalScoreColumns(headers);

  if (
    indexes.gradeIndex < 0 ||
    indexes.classIndex < 0 ||
    indexes.numberIndex < 0 ||
    indexes.nameIndex < 0 ||
    indexes.totalIndex < 0
  ) {
    throw new Error("학년, 반, 번호, 이름, 총점 컬럼을 모두 확인해 주세요.");
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

  const identityIndexes = new Set([
    indexes.gradeIndex,
    indexes.classIndex,
    indexes.numberIndex,
    indexes.nameIndex,
    indexes.totalIndex,
    indexes.feedbackIndex,
  ]);
  const scoreColumnCandidates = displayHeaders
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header, index }) =>
        header &&
        index > indexes.totalIndex &&
        !identityIndexes.has(index) &&
        scoreRows.some(
          ({ row }) => toFiniteScore(getCell(row, index)) !== null,
        ),
    );

  if (!scoreColumnCandidates.length) {
    throw new Error("평가요소별 점수 컬럼을 찾지 못했습니다.");
  }

  const scoreColumns: ScoreColumn[] = scoreColumnCandidates.map(
    ({ header, index }) => {
      const observedMax = scoreRows.reduce((max, { row }) => {
        const value = toFiniteScore(getCell(row, index));
        return value === null ? max : Math.max(max, value);
      }, 0);
      return {
        header,
        index,
        maxScore: roundScore(observedMax),
      };
    },
  );

  const items = scoreColumns.map((column) => ({
    name: column.header,
    maxScore: column.maxScore,
  }));
  const observedTotalMax = scoreRows.reduce((max, { row }) => {
    const value = toFiniteScore(getCell(row, indexes.totalIndex));
    return value === null ? max : Math.max(max, value);
  }, 0);
  const criteriaMaxSum = items.reduce(
    (sum, item) => sum + Number(item.maxScore || 0),
    0,
  );
  const totalMaxScore = roundScore(Math.max(observedTotalMax, criteriaMaxSum));
  const title = cleanAssessmentTitle(params.fileName);
  const subject = inferSubject(title);
  const assessmentOrder = inferAssessmentOrder(title);

  const rowsWithScores: ParsedPerformanceScoreRow[] = scoreRows.map(
    ({ row, rowIndex }) => {
      const rowGrade =
        getCellText(row, indexes.gradeIndex) || params.targetGrade.trim();
      const rowClass =
        getCellText(row, indexes.classIndex) || params.fallbackClass.trim();
      const rowNumber = getCellText(row, indexes.numberIndex);
      const studentName = getCellText(row, indexes.nameIndex);
      const parsedTotal = toFiniteScore(getCell(row, indexes.totalIndex));
      const rowItems = scoreColumns.map((column, itemIndex) => {
        const score = toFiniteScore(getCell(row, column.index));
        const item = items[itemIndex];
        return {
          name: item.name,
          score: roundScore(score ?? 0),
          maxScore: roundScore(Number(item.maxScore || 0)),
          scoreEntered: score !== null,
        };
      });
      const calculatedTotal = rowItems.reduce(
        (sum, item) =>
          item.scoreEntered ? sum + Number(item.score || 0) : sum,
        0,
      );
      const hasCriteriaScores = rowItems.some((item) => item.scoreEntered);
      const enteredScoreCount =
        (parsedTotal !== null ? 1 : 0) +
        rowItems.filter((item) => item.scoreEntered).length;
      const evidence = getCellText(row, indexes.feedbackIndex).slice(0, 1000);

      return {
        rowKey: `row-${rowIndex + 1}-${studentName}-${rowNumber}`,
        rowNumber: rowIndex + 1,
        enteredScoreCount,
        uid: "",
        grade: normalizeSchoolValue(rowGrade),
        class: normalizeSchoolValue(rowClass),
        number: normalizeSchoolValue(rowNumber),
        studentName,
        items: rowItems,
        totalScore: roundScore(
          parsedTotal ?? (hasCriteriaScores ? calculatedTotal : 0),
        ),
        totalMaxScore,
        feedback: evidence,
        evidence,
        matchStatus: "unmatched",
        matchMessage: "학생 명단과 아직 연결되지 않았습니다.",
      };
    },
  );

  return {
    sourceFileName: params.fileName,
    headerRowNumber: headerRowIndex + 1,
    title,
    subject,
    assessmentOrder,
    items,
    rows: rowsWithScores,
    totalMaxScore,
    detectedClasses: sortSchoolValues(
      Array.from(
        new Set(rowsWithScores.map((row) => row.class).filter(Boolean)),
      ),
    ),
  };
};
