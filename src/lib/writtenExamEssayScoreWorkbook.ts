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
  items: Array<
    Pick<
      PerformanceScoreItem,
      "name" | "shortName" | "itemKey" | "groupKey" | "groupLabel" | "maxScore"
    >
  >;
  rows: ParsedWrittenExamEssayScoreRow[];
  totalMaxScore: number;
  detectedClasses: string[];
}

interface EssayScoreColumnIndexes {
  gradeIndex: number;
  classIndex: number;
  numberIndex: number;
  nameIndex: number;
  totalIndex: number;
  feedbackIndex: number;
}

interface EssayCriterionColumn {
  header: string;
  itemKey: string;
  groupKey: string;
  groupLabel: string;
  index: number;
  maxScore: number;
}

const MAX_UPLOAD_ROWS = 400;

const DEFAULT_ESSAY_CRITERION_MAX_SCORE: Record<string, number> = {
  "1-(1)": 3,
  "1-(2)": 3,
  "1-(3)": 4,
  "2-(1)": 2,
  "2-(2)": 2,
  "2-(3)": 2,
  "2-(4)": 4,
};

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

const parseEssayCriterionHeader = (header: unknown) => {
  const text = toText(header);
  const match = /^(\d+)\s*-\s*[\(\[]?\s*(\d+)\s*[\)\]]?$/.exec(text);
  if (!match) return null;
  const groupKey = match[1];
  const subKey = match[2];
  const itemKey = `${groupKey}-(${subKey})`;
  return {
    itemKey,
    groupKey,
    groupLabel: `${groupKey}번`,
    label: itemKey,
  };
};

const parseEssayFeedback = (value: unknown) => {
  const text = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!text || text === "-") {
    return {
      fullText: "",
      generalFeedback: "",
      byItemKey: new Map<string, string>(),
    };
  }

  const pattern = /(\d+)\s*-\s*[\(\[]?\s*(\d+)\s*[\)\]]?\s*[:：]/g;
  const matches = Array.from(text.matchAll(pattern));
  if (!matches.length) {
    return {
      fullText: text,
      generalFeedback: text,
      byItemKey: new Map<string, string>(),
    };
  }

  const byItemKey = new Map<string, string>();
  let generalFeedback = text.slice(0, matches[0].index || 0).trim();
  matches.forEach((match, index) => {
    const key = `${match[1]}-(${match[2]})`;
    const start = (match.index || 0) + match[0].length;
    const end =
      index + 1 < matches.length
        ? matches[index + 1].index || text.length
        : text.length;
    const feedback = text.slice(start, end).trim();
    if (feedback) byItemKey.set(key, feedback);
  });

  if (!generalFeedback && byItemKey.size === 0) generalFeedback = text;

  return {
    fullText: text,
    generalFeedback,
    byItemKey,
  };
};

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
  const totalIndex = findColumnIndex(headers, (header) =>
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
    totalIndex,
    feedbackIndex,
  };
};

const getEssayCriterionColumns = (
  displayHeaders: string[],
  scoreRows: Array<{ row: unknown[] }>,
  excludedIndexes: Set<number>,
) =>
  displayHeaders
    .map((header, index) => {
      const parsed = parseEssayCriterionHeader(header);
      return parsed ? { ...parsed, header, index } : null;
    })
    .filter(
      (item): item is NonNullable<typeof item> =>
        item !== null && !excludedIndexes.has(item.index),
    )
    .map((column) => {
      const observedMax = scoreRows.reduce((max, { row }) => {
        const value = toFiniteScore(getCell(row, column.index));
        return value === null ? max : Math.max(max, value);
      }, 0);
      return {
        header: column.header,
        itemKey: column.itemKey,
        groupKey: column.groupKey,
        groupLabel: column.groupLabel,
        index: column.index,
        maxScore: roundScore(
          observedMax || DEFAULT_ESSAY_CRITERION_MAX_SCORE[column.itemKey] || 0,
        ),
      } satisfies EssayCriterionColumn;
    });

const findEssayScoreHeaderRow = (rows: unknown[][]) => {
  const scanLimit = Math.min(rows.length, 20);
  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const headers = (rows[rowIndex] || []).map(toHeaderKey);
    const displayHeaders = (rows[rowIndex] || []).map(toText);
    const indexes = resolveEssayScoreColumns(headers);
    if (
      indexes.numberIndex >= 0 &&
      indexes.nameIndex >= 0 &&
      (indexes.totalIndex >= 0 ||
        displayHeaders.some((header) => parseEssayCriterionHeader(header)))
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
  const fallbackMaxScore = roundScore(Number(params.maxScore || 0));

  const headerRowIndex = findEssayScoreHeaderRow(rows);
  if (headerRowIndex < 0) {
    throw new Error(
      "번호, 이름, 총점 또는 논술형 세부 문항이 포함된 정기시험 논술형 점수표 헤더 행을 찾지 못했습니다.",
    );
  }

  const rawHeaders = rows[headerRowIndex] || [];
  const headers = rawHeaders.map(toHeaderKey);
  const displayHeaders = rawHeaders.map(toText);
  const indexes = resolveEssayScoreColumns(headers);
  if (indexes.numberIndex < 0 || indexes.nameIndex < 0) {
    throw new Error("번호, 이름 컬럼을 모두 확인해 주세요.");
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
  const identityIndexes = new Set([
    indexes.gradeIndex,
    indexes.classIndex,
    indexes.numberIndex,
    indexes.nameIndex,
    indexes.totalIndex,
    indexes.feedbackIndex,
  ]);
  const criterionColumns = getEssayCriterionColumns(
    displayHeaders,
    scoreRows,
    identityIndexes,
  );
  if (!criterionColumns.length && indexes.totalIndex < 0) {
    throw new Error(
      "총점 또는 1-(1) 형식의 논술형 세부 점수 컬럼을 확인해 주세요.",
    );
  }
  const legacyMaxScore = roundScore(
    fallbackMaxScore ||
      scoreRows.reduce((max, { row }) => {
        const value = toFiniteScore(getCell(row, indexes.totalIndex));
        return value === null ? max : Math.max(max, value);
      }, 0),
  );
  if (!criterionColumns.length && legacyMaxScore <= 0) {
    throw new Error("논술형 만점을 먼저 입력해 주세요.");
  }
  const items =
    criterionColumns.length > 0
      ? criterionColumns.map((column) => ({
          name: column.header,
          shortName: column.itemKey,
          itemKey: column.itemKey,
          groupKey: column.groupKey,
          groupLabel: column.groupLabel,
          maxScore: column.maxScore,
        }))
      : [
          {
            name: itemName,
            shortName: "논술형",
            itemKey: "essay-total",
            groupKey: "essay",
            groupLabel: "논술형",
            maxScore: legacyMaxScore,
          },
        ];
  const criteriaMaxSum = items.reduce(
    (sum, item) => sum + Number(item.maxScore || 0),
    0,
  );
  const observedTotalMax = scoreRows.reduce((max, { row }) => {
    const value = toFiniteScore(getCell(row, indexes.totalIndex));
    return value === null ? max : Math.max(max, value);
  }, 0);
  const totalMaxScore = roundScore(
    Math.max(observedTotalMax, criteriaMaxSum, legacyMaxScore),
  );

  const rowsWithScores: ParsedWrittenExamEssayScoreRow[] = scoreRows.map(
    ({ row, rowIndex }) => {
      const rowGrade =
        getCellText(row, indexes.gradeIndex) || params.targetGrade.trim();
      const rowClass =
        getCellText(row, indexes.classIndex) || params.fallbackClass.trim();
      const rowNumber = getCellText(row, indexes.numberIndex);
      const studentName = getCellText(row, indexes.nameIndex);
      const parsedTotal = toFiniteScore(getCell(row, indexes.totalIndex));
      const parsedFeedback = parseEssayFeedback(
        getCell(row, indexes.feedbackIndex),
      );
      const rowItems = criterionColumns.length
        ? criterionColumns.map((column) => {
            const score = toFiniteScore(getCell(row, column.index));
            return {
              name: column.header,
              shortName: column.itemKey,
              itemKey: column.itemKey,
              groupKey: column.groupKey,
              groupLabel: column.groupLabel,
              score: roundScore(score ?? 0),
              maxScore: column.maxScore,
              feedback: (
                parsedFeedback.byItemKey.get(column.itemKey) || ""
              ).slice(0, 1000),
              scoreEntered: score !== null,
            };
          })
        : [
            {
              name: itemName,
              shortName: "논술형",
              itemKey: "essay-total",
              groupKey: "essay",
              groupLabel: "논술형",
              score: roundScore(parsedTotal ?? 0),
              maxScore: legacyMaxScore,
              feedback: parsedFeedback.generalFeedback.slice(0, 1000),
              scoreEntered: parsedTotal !== null,
            },
          ];
      const enteredItemCount = rowItems.filter(
        (item) => item.scoreEntered,
      ).length;
      const calculatedTotal = rowItems.reduce(
        (sum, item) =>
          item.scoreEntered ? sum + Number(item.score || 0) : sum,
        0,
      );
      const hasCriteriaScores = rowItems.some((item) => item.scoreEntered);
      const feedback = parsedFeedback.fullText.slice(0, 1000);

      return {
        rowKey: `row-${rowIndex + 1}-${studentName}-${rowNumber}`,
        rowNumber: rowIndex + 1,
        enteredScoreCount: criterionColumns.length
          ? enteredItemCount
          : parsedTotal !== null
            ? 1
            : 0,
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
