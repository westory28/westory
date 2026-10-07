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
  items: PerformanceScoreItem[];
  totalScore: number;
  totalMaxScore: number;
  feedback: string;
}

export interface ParsedPerformanceScoreUpload {
  format?: "neis" | "legacy";
  academicYear?: string;
  semester?: string;
  sourceFileName: string;
  headerRowNumber: number;
  title: string;
  subject: string;
  assessmentOrder?: number;
  items: Array<
    Pick<
      PerformanceScoreItem,
      | "name"
      | "shortName"
      | "itemKey"
      | "groupKey"
      | "groupLabel"
      | "examSection"
      | "questionNumber"
      | "correctAnswer"
      | "studentAnswer"
      | "answerCorrect"
      | "answerStatus"
      | "answerChoices"
      | "maxScore"
      | "ratio"
    >
  >;
  rows: ParsedPerformanceScoreRow[];
  totalMaxScore: number;
  detectedClasses: string[];
  scoreContentKind?: "performance" | "objective" | "essay" | "mixed";
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

export const getPerformanceScoreItemShortName = (
  name: unknown,
  fallbackIndex = 0,
) => {
  const normalized = toHeaderKey(name);
  if (/범죄행위|형벌결과|만화서사/.test(normalized)) return "법 조항 서사";
  if (/유물|생활모습|배경/.test(normalized)) return "당대 생활상";
  if (/사건발생|갈등|재판|판결|인과관계|4컷/.test(normalized))
    return "서사 표현";
  if (/심리|계급적입장|말풍선/.test(normalized)) return "말풍선 표현";
  if (/비유적|평점제목|제목/.test(normalized)) return "비유 제목";
  if (/업적|과오|객관적사실/.test(normalized)) return "업적·과오";
  if (/별점|평점.*근거|역사적맥락/.test(normalized)) return "평점 근거";
  if (/대중매체|이미지|주체적인역사적평가/.test(normalized)) return "매체 비교";
  if (/정치적선택|사회와타인의삶|비판적으로성찰/.test(normalized))
    return "비판적 성찰";
  if (/온라인지도|리뷰|정제된언어|형식/.test(normalized)) return "리뷰 형식";
  return toText(name) || `요소 ${fallbackIndex + 1}`;
};

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

  const neis = parseNeisPerformanceScoreWorkbook(rows, params);
  if (neis) return neis;

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

  const items = scoreColumns.map((column, index) => ({
    name: column.header,
    shortName: getPerformanceScoreItemShortName(column.header, index),
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
          shortName: item.shortName,
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
    format: "legacy",
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

// NEIS file import: identity columns span the first three rows; each
// assessment has its own title, declared maximum, and score column.
const parseNeisPerformanceScoreWorkbook = (
  rows: unknown[][],
  params: { fileName: string; targetGrade: string; fallbackClass: string },
): ParsedPerformanceScoreUpload | null => {
  const headerIndex = rows.slice(0, 20).findIndex((row) => {
    const keys = row.map(toHeaderKey);
    return (
      keys.includes("반") &&
      keys.includes("번호") &&
      keys.some((key) => /^(성명|이름)$/.test(key)) &&
      !keys.includes("총점")
    );
  });
  if (headerIndex < 0) return null;
  const headers = rows[headerIndex].map(toText);
  const keys = headers.map(toHeaderKey);
  const classIndex = keys.indexOf("반");
  const numberIndex = keys.indexOf("번호");
  const nameIndex = keys.findIndex((key) => /^(성명|이름)$/.test(key));
  const gradeIndex = keys.indexOf("학년");
  const maxRow = rows[headerIndex + 1] || [];
  const scoreRow = rows[headerIndex + 2] || [];
  const columns = headers.flatMap((name, index) => {
    if (index <= nameIndex || !name) return [];
    const maxMatch = /만점\s*[（(]\s*(\d+(?:\.\d+)?)\s*[)）]/.exec(
      toText(maxRow[index]),
    );
    if (!maxMatch || toHeaderKey(scoreRow[index]) !== "점수") {
      throw new Error(`${name}: 만점과 점수 행을 확인해 주세요.`);
    }
    const maxScore = Number(maxMatch[1]);
    if (!(maxScore > 0)) throw new Error(`${name}: 만점은 0보다 커야 합니다.`);
    return [{ name, index, maxScore }];
  });
  if (!columns.length)
    throw new Error("나이스 파일에서 수행평가명과 만점을 찾지 못했습니다.");
  if (
    new Set(columns.map((column) => toHeaderKey(column.name))).size !==
    columns.length
  ) {
    throw new Error(
      "중복된 수행평가명이 있습니다. 파일의 평가명을 확인해 주세요.",
    );
  }
  const fileGrade = /(?:^|\s)([1-6])\s*학년(?:\s|_)/.exec(params.fileName)?.[1];
  const year = /(\d{4})\s*학년도/.exec(params.fileName)?.[1];
  const semester = /(\d+)\s*학기/.exec(params.fileName)?.[1];
  const subject =
    /학년\s+(.+?)(?:_전체|_\d+강의실|\.xlsx$)/
      .exec(params.fileName)?.[1]
      ?.trim() || "";
  const totalMaxScore = roundScore(
    columns.reduce((sum, column) => sum + column.maxScore, 0),
  );
  const seen = new Set<string>();
  const parsedRows: ParsedPerformanceScoreRow[] = [];
  rows.slice(headerIndex + 3).forEach((row, offset) => {
    if (!row.some((cell) => toText(cell))) return;
    const rowNumber = headerIndex + 4 + offset;
    const studentName = toText(row[nameIndex]);
    const classValue = normalizeSchoolValue(
      row[classIndex] || params.fallbackClass,
    );
    const number = normalizeSchoolValue(row[numberIndex]);
    const grade = normalizeSchoolValue(
      (gradeIndex >= 0 ? row[gradeIndex] : "") ||
        fileGrade ||
        params.targetGrade,
    );
    if (
      !studentName ||
      !/^\d+$/.test(classValue) ||
      !/^\d+$/.test(number) ||
      !/^\d+$/.test(grade)
    ) {
      throw new Error(`${rowNumber}행의 학년, 반, 번호, 성명을 확인해 주세요.`);
    }
    const identity = `${grade}|${classValue}|${number}`;
    if (seen.has(identity))
      throw new Error(`${rowNumber}행: 같은 학년·반·번호가 중복되었습니다.`);
    seen.add(identity);
    const items = columns.map((column, index) => {
      const raw = row[column.index];
      const score = toFiniteScore(raw);
      if (toText(raw) && score === null)
        throw new Error(
          `${rowNumber}행 ${column.name}: 숫자 점수 또는 빈칸만 입력해 주세요.`,
        );
      if (score !== null && (score < 0 || score > column.maxScore))
        throw new Error(
          `${rowNumber}행 ${column.name}: 점수는 0~${column.maxScore}점이어야 합니다.`,
        );
      return {
        name: column.name,
        shortName: column.name,
        itemKey: `assessment-${index + 1}`,
        maxScore: column.maxScore,
        score: score ?? 0,
        scoreEntered: score !== null,
      };
    });
    parsedRows.push({
      rowKey: `row-${rowNumber}`,
      rowNumber,
      uid: "",
      grade,
      class: classValue,
      number,
      studentName,
      items,
      enteredScoreCount: items.filter((item) => item.scoreEntered).length,
      totalScore: roundScore(items.reduce((sum, item) => sum + item.score, 0)),
      totalMaxScore,
      feedback: "",
      evidence: "",
      matchStatus: "unmatched",
      matchMessage: "학생 명단과 아직 연결되지 않았습니다.",
    });
  });
  if (!parsedRows.length) throw new Error("등록할 학생 행이 없습니다.");
  if (parsedRows.length > MAX_UPLOAD_ROWS)
    throw new Error(`한 파일에는 ${MAX_UPLOAD_ROWS}명까지 등록할 수 있습니다.`);
  return {
    format: "neis",
    academicYear: year,
    semester,
    sourceFileName: params.fileName,
    headerRowNumber: headerIndex + 1,
    title: columns.length === 1 ? columns[0].name : "수행평가 일괄등록",
    subject,
    items: columns.map((column, index) => ({
      name: column.name,
      shortName: column.name,
      itemKey: `assessment-${index + 1}`,
      maxScore: column.maxScore,
    })),
    rows: parsedRows,
    totalMaxScore,
    detectedClasses: sortSchoolValues([
      ...new Set(parsedRows.map((row) => row.class)),
    ]),
  };
};

export const splitPerformanceScoreUpload = (
  upload: ParsedPerformanceScoreUpload,
): ParsedPerformanceScoreUpload[] => {
  if (upload.format !== "neis") return [upload];
  return upload.items.map((item, index) => ({
    ...upload,
    title: item.name,
    assessmentOrder: index + 1,
    items: [item],
    totalMaxScore: item.maxScore,
    rows: upload.rows.map((row) => ({
      ...row,
      items: [row.items[index]],
      enteredScoreCount: row.items[index].scoreEntered === false ? 0 : 1,
      totalScore: row.items[index].score,
      totalMaxScore: item.maxScore,
    })),
  }));
};
