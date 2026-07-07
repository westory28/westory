import {
  WRITTEN_EXAM_SECTION_ESSAY,
  WRITTEN_EXAM_SECTION_OBJECTIVE,
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
      | "name"
      | "shortName"
      | "itemKey"
      | "groupKey"
      | "groupLabel"
      | "maxScore"
      | "examSection"
      | "questionNumber"
      | "correctAnswer"
      | "studentAnswer"
      | "answerCorrect"
      | "answerStatus"
      | "answerChoices"
    >
  >;
  rows: ParsedWrittenExamEssayScoreRow[];
  totalMaxScore: number;
  detectedClasses: string[];
  scoreContentKind?: "objective" | "essay" | "mixed";
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

interface ObjectiveQuestionColumn {
  index: number;
  questionNumber: number;
  correctAnswer: string;
  maxScore: number;
}

interface ObjectiveScoreLayout {
  headerRowIndex: number;
  answerRowIndex: number;
  maxScoreRowIndex: number;
  classNumberIndex: number;
  studentCodeIndex: number;
  nameIndex: number;
  totalIndex: number;
  questionColumns: ObjectiveQuestionColumn[];
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

const OBJECTIVE_ANSWER_CHOICES = ["1", "2", "3", "4", "5"];

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

const parseQuestionNumber = (value: unknown) => {
  const text = toText(value);
  if (!text) return null;
  const numeric = Number(text.replace(/[^\d]/g, ""));
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 200) return null;
  return numeric;
};

const normalizeObjectiveAnswer = (value: unknown) =>
  toText(value).replace(/[.．]/g, ".").toUpperCase();

const OBJECTIVE_CHOICE_ALIASES: Record<string, string> = {
  "1": "1",
  "１": "1",
  "①": "1",
  "❶": "1",
  "➀": "1",
  "⑴": "1",
  "2": "2",
  "２": "2",
  "②": "2",
  "❷": "2",
  "➁": "2",
  "⑵": "2",
  "3": "3",
  "３": "3",
  "③": "3",
  "❸": "3",
  "➂": "3",
  "⑶": "3",
  "4": "4",
  "４": "4",
  "④": "4",
  "❹": "4",
  "➃": "4",
  "⑷": "4",
  "5": "5",
  "５": "5",
  "⑤": "5",
  "❺": "5",
  "➄": "5",
  "⑸": "5",
};

const parseObjectiveAnswerChoices = (value: unknown) => {
  const text = normalizeObjectiveAnswer(value);
  if (!text || text === ".") return [];
  return Array.from(
    new Set(
      Array.from(text)
        .map((character) => OBJECTIVE_CHOICE_ALIASES[character])
        .filter((choice): choice is string => Boolean(choice)),
    ),
  ).sort();
};

const areObjectiveAnswersEqual = (
  studentAnswer: string,
  correctAnswer: string,
) => {
  const studentChoices = parseObjectiveAnswerChoices(studentAnswer);
  const correctChoices = parseObjectiveAnswerChoices(correctAnswer);
  if (studentChoices.length === 0 || correctChoices.length === 0) {
    return Boolean(correctAnswer) && studentAnswer === correctAnswer;
  }
  if (correctChoices.length > 1) {
    return studentChoices.every((choice) => correctChoices.includes(choice));
  }
  return studentChoices.length === 1 && studentChoices[0] === correctChoices[0];
};

const splitClassAndNumber = (value: unknown) => {
  const text = toText(value);
  const match = /^(\d+)\s*[/／-]\s*(\d+)$/.exec(text);
  if (match) {
    return {
      classValue: normalizeSchoolValue(match[1]),
      numberValue: normalizeSchoolValue(match[2]),
    };
  }
  return {
    classValue: "",
    numberValue: normalizeSchoolValue(text),
  };
};

const findObjectiveScoreLayout = (
  rows: unknown[][],
): ObjectiveScoreLayout | null => {
  const scanLimit = Math.min(rows.length, 30);
  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const questionColumns = row
      .map((cell, index) => ({
        index,
        questionNumber: parseQuestionNumber(cell),
      }))
      .filter(
        (item): item is { index: number; questionNumber: number } =>
          item.questionNumber !== null,
      )
      .sort((left, right) => left.index - right.index);

    if (questionColumns.length < 5) continue;

    const firstQuestionIndex = questionColumns[0].index;
    const beforeQuestionColumns = row.slice(0, firstQuestionIndex);
    if (beforeQuestionColumns.length < 2) continue;

    const expectedSequenceCount = questionColumns.filter(
      (item, index) => item.questionNumber === index + 1,
    ).length;
    if (expectedSequenceCount < Math.min(5, questionColumns.length)) continue;

    const answerRowIndex = rowIndex + 1;
    const maxScoreRowIndex = rowIndex + 2;
    const answerRow = rows[answerRowIndex] || [];
    const maxScoreRow = rows[maxScoreRowIndex] || [];
    const normalizedQuestionColumns = questionColumns
      .map((column) => {
        const maxScore = toFiniteScore(maxScoreRow[column.index]);
        return {
          index: column.index,
          questionNumber: column.questionNumber,
          correctAnswer: normalizeObjectiveAnswer(answerRow[column.index]),
          maxScore: roundScore(maxScore ?? 0),
        };
      })
      .filter((column) => column.maxScore > 0 || column.correctAnswer);

    if (normalizedQuestionColumns.length < 5) continue;

    const lastQuestionIndex =
      normalizedQuestionColumns[normalizedQuestionColumns.length - 1].index;
    const totalOffset = row
      .slice(lastQuestionIndex + 1)
      .findIndex((cell) => toText(cell).length > 0);
    const totalIndex =
      totalOffset >= 0 ? lastQuestionIndex + 1 + totalOffset : -1;

    return {
      headerRowIndex: rowIndex,
      answerRowIndex,
      maxScoreRowIndex,
      classNumberIndex: 0,
      studentCodeIndex: firstQuestionIndex >= 3 ? 1 : -1,
      nameIndex: Math.max(0, firstQuestionIndex - 1),
      totalIndex,
      questionColumns: normalizedQuestionColumns,
    };
  }
  return null;
};

const isObjectiveStudentRow = (
  row: unknown[],
  layout: ObjectiveScoreLayout,
) => {
  const name = getCellText(row, layout.nameIndex);
  const classNumber = splitClassAndNumber(
    getCell(row, layout.classNumberIndex),
  );
  if (!name || !classNumber.numberValue) return false;
  if (!/^\d+$/.test(classNumber.numberValue)) return false;
  return !classNumber.classValue || /^\d+$/.test(classNumber.classValue);
};

const parseObjectiveItemScore = (
  rawValue: unknown,
  correctAnswer: string,
  maxScore: number,
) => {
  const rawAnswer = normalizeObjectiveAnswer(rawValue);
  const normalizedCorrectAnswer = normalizeObjectiveAnswer(correctAnswer);
  if (!rawAnswer) {
    return {
      studentAnswer: "",
      answerCorrect: false,
      answerStatus: "blank" as const,
      score: 0,
      scoreEntered: true,
    };
  }
  if (rawAnswer === ".") {
    return {
      studentAnswer: normalizedCorrectAnswer,
      answerCorrect: true,
      answerStatus: "correct" as const,
      score: maxScore,
      scoreEntered: true,
    };
  }
  const answerCorrect =
    normalizedCorrectAnswer.length > 0 &&
    areObjectiveAnswersEqual(rawAnswer, normalizedCorrectAnswer);
  return {
    studentAnswer: rawAnswer,
    answerCorrect,
    answerStatus: answerCorrect ? ("correct" as const) : ("incorrect" as const),
    score: answerCorrect ? maxScore : 0,
    scoreEntered: true,
  };
};

const parseWrittenExamObjectiveScoreWorkbook = (
  rows: unknown[][],
  params: {
    fileName: string;
    targetGrade: string;
    fallbackClass: string;
    title?: string;
    subject?: string;
  },
): ParsedWrittenExamEssayScoreUpload | null => {
  const layout = findObjectiveScoreLayout(rows);
  if (!layout) return null;

  const items = layout.questionColumns.map((column) => ({
    name: `서답형 ${column.questionNumber}번`,
    shortName: `${column.questionNumber}번`,
    itemKey: `objective-${column.questionNumber}`,
    groupKey: "objective",
    groupLabel: "서답형",
    examSection: WRITTEN_EXAM_SECTION_OBJECTIVE,
    questionNumber: column.questionNumber,
    correctAnswer: column.correctAnswer,
    studentAnswer: "",
    answerCorrect: false,
    answerStatus: "blank" as const,
    answerChoices: OBJECTIVE_ANSWER_CHOICES,
    maxScore: column.maxScore,
  }));
  const totalMaxScore = roundScore(
    layout.questionColumns.reduce(
      (sum, column) => sum + Number(column.maxScore || 0),
      0,
    ),
  );

  const candidateRows = rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .slice(layout.maxScoreRowIndex + 1)
    .slice(0, MAX_UPLOAD_ROWS)
    .filter(({ row }) => row.some((cell) => toText(cell).length > 0));
  const scoreRows = candidateRows.filter(({ row }) =>
    isObjectiveStudentRow(row, layout),
  );
  if (!scoreRows.length) {
    throw new Error("등록할 서답형 학생 답안 행을 찾지 못했습니다.");
  }

  const rowsWithScores: ParsedWrittenExamEssayScoreRow[] = scoreRows.map(
    ({ row, rowIndex }) => {
      const classNumber = splitClassAndNumber(
        getCell(row, layout.classNumberIndex),
      );
      const rowClass =
        classNumber.classValue || normalizeSchoolValue(params.fallbackClass);
      const rowNumber = classNumber.numberValue;
      const studentName = getCellText(row, layout.nameIndex);
      const rowItems = layout.questionColumns.map((column) => {
        const parsed = parseObjectiveItemScore(
          getCell(row, column.index),
          column.correctAnswer,
          column.maxScore,
        );
        return {
          name: `서답형 ${column.questionNumber}번`,
          shortName: `${column.questionNumber}번`,
          itemKey: `objective-${column.questionNumber}`,
          groupKey: "objective",
          groupLabel: "서답형",
          examSection: WRITTEN_EXAM_SECTION_OBJECTIVE,
          questionNumber: column.questionNumber,
          correctAnswer: column.correctAnswer,
          studentAnswer: parsed.studentAnswer,
          answerCorrect: parsed.answerCorrect,
          answerStatus: parsed.answerStatus,
          answerChoices: OBJECTIVE_ANSWER_CHOICES,
          score: parsed.score,
          maxScore: column.maxScore,
          scoreEntered: parsed.scoreEntered,
          feedback: "",
        };
      });
      const calculatedTotal = roundScore(
        rowItems.reduce(
          (sum, item) =>
            item.scoreEntered ? sum + Number(item.score || 0) : sum,
          0,
        ),
      );
      const parsedTotal =
        layout.totalIndex >= 0
          ? toFiniteScore(getCell(row, layout.totalIndex))
          : null;
      const totalScore = roundScore(parsedTotal ?? calculatedTotal);
      const correctCount = rowItems.filter((item) => item.answerCorrect).length;
      const enteredScoreCount = rowItems.filter(
        (item) => item.scoreEntered,
      ).length;

      return {
        rowKey: `row-${rowIndex + 1}-${studentName}-${rowNumber}`,
        rowNumber: rowIndex + 1,
        enteredScoreCount,
        uid: "",
        grade: normalizeSchoolValue(params.targetGrade),
        class: rowClass,
        number: rowNumber,
        studentName,
        items: rowItems,
        totalScore,
        totalMaxScore,
        feedback: "",
        evidence: `${layout.questionColumns.length}문항 중 ${correctCount}문항 정답`,
        matchStatus: "unmatched",
        matchMessage: "학생 명단과 아직 연결되지 않았습니다.",
      };
    },
  );

  return {
    sourceFileName: params.fileName,
    headerRowNumber: layout.headerRowIndex + 1,
    title: toText(params.title) || cleanExamTitle(params.fileName),
    subject: toText(params.subject) || "역사",
    itemName: "서답형",
    items,
    rows: rowsWithScores,
    totalMaxScore,
    detectedClasses: sortSchoolValues(
      Array.from(
        new Set(rowsWithScores.map((row) => row.class).filter(Boolean)),
      ),
    ),
    scoreContentKind: "objective",
  };
};

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
  const objectiveUpload = parseWrittenExamObjectiveScoreWorkbook(rows, params);
  if (objectiveUpload) return objectiveUpload;

  const fallbackMaxScore = roundScore(Number(params.maxScore || 0));

  const headerRowIndex = findEssayScoreHeaderRow(rows);
  if (headerRowIndex < 0) {
    throw new Error(
      "번호, 이름, 총점 또는 정기시험 세부 문항이 포함된 점수표 헤더 행을 찾지 못했습니다.",
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
          examSection: WRITTEN_EXAM_SECTION_ESSAY,
          maxScore: column.maxScore,
        }))
      : [
          {
            name: itemName,
            shortName: "논술형",
            itemKey: "essay-total",
            groupKey: "essay",
            groupLabel: "논술형",
            examSection: WRITTEN_EXAM_SECTION_ESSAY,
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
              examSection: WRITTEN_EXAM_SECTION_ESSAY,
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
              examSection: WRITTEN_EXAM_SECTION_ESSAY,
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
    scoreContentKind: "essay",
  };
};
