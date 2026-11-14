import type { AchievementRawRecord } from "./achievementAnalysis";
import type { QuizAnalysisRecord, QuizAnalysisStudent } from "./quizAnalysis";
import type {
  Question,
  TreeUnit,
} from "../pages/teacher/components/QuizBankTab";

/** Import-only data: never writes official scores, signatures, or student records. */
export interface WrittenExamQuestionInfo {
  number: number;
  answer: string;
  points: number;
  options: string[];
  question?: string;
  achievementStandardCodes: string[];
  targetAchievementLevel: "A" | "B" | "C" | "D" | "E" | "";
  intendedDifficulty: "easy" | "medium" | "hard" | "";
  concepts: string[];
  reviewLessonId?: string;
  curriculumVersion?: string;
}

export interface WrittenExamImportedResponse {
  questionNumber: number;
  /** null means unavailable (for an X-only report), "" means a recorded blank. */
  answer: string | null;
  correct: boolean | null;
  score: number | null;
}

export interface WrittenExamImportedStudent {
  key: string;
  uid?: string;
  grade: string;
  class: string;
  number: string;
  name: string;
  responses: WrittenExamImportedResponse[];
  totalScore: number | null;
  recordedTotalScore?: number;
}

const text = (value: unknown): string => String(value ?? "").trim();
const key = (value: unknown): string =>
  text(value)
    .normalize("NFKC")
    .replace(/[\s·ㆍ_()（）]/g, "")
    .toLowerCase();
const school = (value: unknown): string => {
  const valueText = text(value).normalize("NFKC");
  return /^\d+$/.test(valueText) ? String(Number(valueText)) : "";
};
const number = (value: unknown): number | null => {
  const valueText = text(value).replace(/,/g, "");
  if (!valueText || !/^\d+(?:\.\d+)?$/.test(valueText)) return null;
  const valueNumber = Number(valueText);
  return Number.isFinite(valueNumber) ? valueNumber : null;
};
const questionNumber = (value: unknown): number | null => {
  const match = /^(?:문항|문제|q)?\s*(\d+)\s*(?:번|번문항|번문제|[.)])?$/.exec(
    text(value).normalize("NFKC").toLowerCase(),
  );
  return match && Number(match[1]) > 0 && Number(match[1]) <= 200
    ? Number(match[1])
    : null;
};
const column = (headers: unknown[], aliases: string[]) =>
  headers.findIndex((value) => aliases.includes(key(value)));
const cell = (row: unknown[], index: number) =>
  index >= 0 ? row[index] : undefined;
const round = (value: number) => Math.round(value * 10000) / 10000;
const choice = (value: unknown): string => {
  const normalized = text(value)
    .normalize("NFKC")
    .replace(/[\s,;/|·]/g, "");
  return /^[1-5]+$/.test(normalized)
    ? [...new Set(normalized)].sort().join("")
    : "";
};
const answerAliases: Record<string, string> = {
  A: "12",
  B: "13",
  C: "14",
  D: "15",
  E: "23",
  F: "24",
  G: "25",
  H: "34",
  I: "35",
  J: "45",
  K: "123",
  L: "124",
  M: "125",
  N: "134",
  O: "135",
  P: "145",
  Q: "234",
  R: "235",
  S: "245",
  T: "345",
  U: "1234",
  V: "1235",
  W: "1245",
  X: "1345",
  Y: "2345",
  Z: "12345",
};
const answerChoice = (value: unknown, allowNeisAliases = false) =>
  choice(value) ||
  (allowNeisAliases ? answerAliases[text(value).toUpperCase()] || "" : "");
const splitList = (value: unknown) => [
  ...new Set(
    text(value)
      .split(/[,;\n|]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

/** Supported vertical item-information sheet; title/blank rows above headers are allowed. */
export function parseWrittenExamQuestionInfo(
  rows: unknown[][],
  options: { fileName?: string; allowPartialSequence?: boolean } = {},
): { questions: WrittenExamQuestionInfo[]; warnings: string[] } {
  const headerIndex = rows.findIndex(
    (row) =>
      column(row, ["문항번호", "문제번호", "번호"]) >= 0 &&
      column(row, ["정답", "정답선지", "정답번호"]) >= 0 &&
      column(row, ["배점", "문항배점", "만점"]) >= 0,
  );
  if (headerIndex < 0)
    throw new Error("문항정보표에서 문항번호·정답·배점 열을 찾지 못했습니다.");
  const headers = rows[headerIndex];
  const columns = {
    number: column(headers, ["문항번호", "문제번호", "번호"]),
    answer: column(headers, ["정답", "정답선지", "정답번호"]),
    points: column(headers, ["배점", "문항배점", "만점"]),
    kind: column(headers, ["문항유형", "유형", "문항형태"]),
    standard: column(headers, ["성취기준", "성취기준코드", "목표성취기준"]),
    level: column(headers, ["성취수준", "목표성취수준", "목표수준"]),
    difficulty: column(headers, ["난이도", "예상난이도", "목표난이도"]),
    concepts: column(headers, ["핵심개념", "개념", "평가요소", "내용영역"]),
    question: column(headers, ["발문", "문항내용", "문제내용"]),
    lesson: column(headers, ["복습자료id", "수업자료id", "reviewlessonid"]),
    curriculum: column(headers, ["교육과정", "교육과정버전"]),
  };
  const warnings: string[] = [];
  const questions: WrittenExamQuestionInfo[] = [];
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (!row.some((value) => text(value))) continue;
    const rawNumber = cell(row, columns.number);
    if (/^(?:합계|총계|평균|계)$/.test(text(rawNumber))) continue;
    if (/서술|논술/.test(text(cell(row, columns.kind)))) {
      warnings.push(
        `${rowIndex + 1}행의 서술·논술형 문항은 이번 선택형 분석에서 제외했습니다.`,
      );
      continue;
    }
    const itemNumber = questionNumber(rawNumber);
    if (!itemNumber)
      throw new Error(
        `문항정보표 ${rowIndex + 1}행의 문항번호를 확인해 주세요.`,
      );
    if (questions.some((item) => item.number === itemNumber))
      throw new Error(`${itemNumber}번 문항정보가 중복되었습니다.`);
    const answer = answerChoice(cell(row, columns.answer));
    const points = number(cell(row, columns.points));
    if (!answer || points === null || points <= 0)
      throw new Error(
        `${itemNumber}번의 정답(1~5)과 0보다 큰 배점을 확인해 주세요.`,
      );
    const rawLevel = text(cell(row, columns.level))
      .toUpperCase()
      .replace(/수준/g, "")
      .trim();
    if (rawLevel && !/^[A-E]$/.test(rawLevel))
      throw new Error(`${itemNumber}번의 목표 성취수준은 A~E로 입력해 주세요.`);
    const rawDifficulty = key(cell(row, columns.difficulty));
    const difficultyMap: Record<
      string,
      WrittenExamQuestionInfo["intendedDifficulty"]
    > = {
      easy: "easy",
      쉬움: "easy",
      하: "easy",
      medium: "medium",
      보통: "medium",
      중: "medium",
      hard: "hard",
      어려움: "hard",
      상: "hard",
    };
    if (rawDifficulty && !difficultyMap[rawDifficulty])
      throw new Error(
        `${itemNumber}번의 난이도는 상·중·하 또는 어려움·보통·쉬움으로 입력해 주세요.`,
      );
    const rawStandard = text(cell(row, columns.standard));
    const standardCodes =
      rawStandard
        .match(/\[?\d{1,2}[가-힣A-Za-z]+\d{2}-\d{2}\]?/g)
        ?.map((value) => value.replace(/[\[\]]/g, "")) ||
      splitList(rawStandard);
    questions.push({
      number: itemNumber,
      answer,
      points,
      options: ["1", "2", "3", "4", "5"],
      achievementStandardCodes: [...new Set(standardCodes)],
      targetAchievementLevel:
        rawLevel as WrittenExamQuestionInfo["targetAchievementLevel"],
      intendedDifficulty: difficultyMap[rawDifficulty] || "",
      concepts: splitList(cell(row, columns.concepts)),
      question: text(cell(row, columns.question)) || undefined,
      reviewLessonId: text(cell(row, columns.lesson)) || undefined,
      curriculumVersion: text(cell(row, columns.curriculum)) || undefined,
    });
  }
  questions.sort((left, right) => left.number - right.number);
  if (!questions.length) throw new Error("분석할 선택형 문항정보가 없습니다.");
  const missing = Array.from(
    { length: questions.at(-1)!.number },
    (_, i) => i + 1,
  ).filter((n) => !questions.some((q) => q.number === n));
  if (missing.length && !options.allowPartialSequence)
    throw new Error(
      `문항정보표에 ${missing.join(", ")}번이 없습니다. 1번부터 끝번호까지 확인해 주세요.`,
    );
  if (questions.some((item) => !item.targetAchievementLevel))
    warnings.push(
      "목표 성취수준이 없는 문항이 있습니다. 수준 추정 시 메타데이터 미입력을 구분합니다.",
    );
  if (questions.some((item) => !item.achievementStandardCodes.length))
    warnings.push(
      "성취기준이 없는 문항은 성취기준별 분석에서 미분류로 남습니다.",
    );
  return { questions, warnings };
}

/** Accepts ordinary student-answer tables and NEIS horizontal answer/correctness reports. */
export function parseWrittenExamResponses(
  rows: unknown[][],
  options: {
    targetGrade: string;
    fallbackClass?: string;
    fileName?: string;
    questions: WrittenExamQuestionInfo[];
  },
): { students: WrittenExamImportedStudent[]; warnings: string[] } {
  const questions = options.questions;
  if (!questions.length) throw new Error("문항정보표를 먼저 등록해 주세요.");
  const headerIndex = rows.findIndex(
    (row) =>
      column(row, ["이름", "성명", "학생명", "학생이름"]) >= 0 &&
      row.some((value) => questionNumber(value) !== null),
  );
  if (headerIndex < 0)
    throw new Error(
      "학생답 정오표에서 이름과 문항번호(1, 2, 3 …)가 있는 헤더를 찾지 못했습니다.",
    );
  const headers = rows[headerIndex];
  const columns = {
    grade: column(headers, ["학년"]),
    class: column(headers, ["반", "학급"]),
    number: column(headers, ["번호", "출석번호", "학생번호"]),
    combined: column(headers, ["반/번호", "반번호", "학급/번호"]),
    code: column(headers, ["학번"]),
    uid: column(headers, ["uid", "학생uid", "학생id"]),
    name: column(headers, ["이름", "성명", "학생명", "학생이름"]),
    total: column(headers, ["총점", "합계", "점수", "원점수"]),
    objectiveTotal: column(headers, [
      "선택형총점",
      "선택형합계",
      "객관식총점",
      "객관식합계",
      "선택형점수",
      "객관식점수",
      "선택형소계",
    ]),
  };
  const questionColumns = headers.flatMap((value, index) => {
    const itemNumber = questionNumber(value);
    return itemNumber === null ? [] : [{ index, number: itemNumber }];
  });
  if (
    new Set(questionColumns.map((q) => q.number)).size !==
    questionColumns.length
  )
    throw new Error("학생답 정오표의 문항번호가 중복되었습니다.");
  if (
    questionColumns.length !== questions.length ||
    questions.some((q) => !questionColumns.some((c) => c.number === q.number))
  )
    throw new Error(
      "학생답 정오표와 문항정보표의 문항번호·문항 수가 다릅니다.",
    );
  const warnings: string[] = [];
  const students: WrittenExamImportedStudent[] = [];
  let neisReport = false;
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (!row.some((value) => text(value))) continue;
    const prefix = row
      .slice(0, questionColumns[0].index)
      .map(text)
      .join(" ")
      .trim();
    if (/정답|배점/.test(prefix)) {
      const isAnswer = /정답/.test(prefix);
      neisReport = true;
      for (const col of questionColumns) {
        const q = questions.find((item) => item.number === col.number)!;
        const value = cell(row, col.index);
        if (
          (isAnswer && answerChoice(value, true) !== q.answer) ||
          (!isAnswer && number(value) !== q.points)
        )
          throw new Error(
            `${col.number}번의 ${isAnswer ? "정답" : "배점"}이 두 엑셀에서 다릅니다.`,
          );
      }
      continue;
    }
    if (/^(?:합계|총계|평균|정답률|응시인원|응시자수|계)(?:\s|$)/.test(prefix))
      continue;
    const name = text(cell(row, columns.name));
    if (!name)
      throw new Error(
        `학생답 정오표 ${rowIndex + 1}행의 이름을 확인해 주세요.`,
      );
    const combinedValue = text(
      cell(row, columns.combined >= 0 ? columns.combined : columns.number),
    );
    const combined = /^(\d+)\s*[/／-]\s*(\d+)$/.exec(combinedValue);
    const studentCode = text(cell(row, columns.code));
    const codeMatch = /^(\d)(\d{2})(\d{2})$/.exec(studentCode);
    const grade =
      school(cell(row, columns.grade)) ||
      (codeMatch ? school(codeMatch[1]) : "") ||
      school(options.targetGrade);
    const classValue =
      school(cell(row, columns.class)) ||
      (combined ? school(combined[1]) : "") ||
      (codeMatch ? school(codeMatch[2]) : "") ||
      school(options.fallbackClass);
    const studentNumber =
      (combined ? school(combined[2]) : school(cell(row, columns.number))) ||
      (codeMatch ? school(codeMatch[3]) : "");
    const uid = text(cell(row, columns.uid));
    if (!grade || !classValue || !studentNumber || Number(studentNumber) <= 0)
      throw new Error(
        `학생답 정오표 ${rowIndex + 1}행의 학년·반·번호를 확인해 주세요. 이름만으로 학생을 연결하지 않습니다.`,
      );
    if (school(options.targetGrade) && grade !== school(options.targetGrade))
      throw new Error(`${rowIndex + 1}행의 학년이 선택한 학년과 다릅니다.`);
    const studentKey = `${grade}-${classValue}-${studentNumber}`;
    if (
      students.some(
        (student) => student.key === studentKey || (uid && student.uid === uid),
      )
    )
      throw new Error(
        `${grade}학년 ${classValue}반 ${studentNumber}번이 중복되었습니다.`,
      );
    const responses: WrittenExamImportedResponse[] = questionColumns.map(
      (col) => {
        const q = questions.find((item) => item.number === col.number)!;
        const raw = text(cell(row, col.index)).normalize("NFKC");
        if (!raw || ["-", "0", "무응답", "미응답"].includes(raw))
          return {
            questionNumber: q.number,
            answer: "",
            correct: false,
            score: 0,
          };
        if (
          [".", "·", "○", "O", "o", "정답"].includes(raw) &&
          !(neisReport && raw === "O")
        )
          return {
            questionNumber: q.number,
            answer: q.answer,
            correct: true,
            score: q.points,
          };
        if (
          ["×", "X", "x", "오답"].includes(raw) &&
          !(neisReport && raw === "X")
        )
          return {
            questionNumber: q.number,
            answer: null,
            correct: false,
            score: 0,
          };
        const answer = answerChoice(raw, neisReport);
        if (!answer)
          throw new Error(
            `${rowIndex + 1}행 ${q.number}번 답안 '${raw}'을 해석할 수 없습니다.`,
          );
        // Multiple official keys are accepted alternatives, matching the existing NEIS import contract.
        const correct = answer.length === 1 && q.answer.includes(answer);
        return {
          questionNumber: q.number,
          answer,
          correct,
          score: correct ? q.points : 0,
        };
      },
    );
    const totalScore = round(
      responses.reduce((sum, response) => sum + (response.score || 0), 0),
    );
    const reportedTotal = number(cell(row, columns.total));
    const objectiveTotal = number(cell(row, columns.objectiveTotal));
    if (
      objectiveTotal !== null &&
      Math.abs(objectiveTotal - totalScore) > 0.001
    )
      throw new Error(
        `${rowIndex + 1}행의 선택형 총점(${objectiveTotal})과 문항별 계산 점수(${totalScore})가 다릅니다.`,
      );
    if (reportedTotal !== null && Math.abs(reportedTotal - totalScore) > 0.001)
      warnings.push(
        `${rowIndex + 1}행의 원본 총점 ${reportedTotal}점은 별도 보관하고 선택형 문항 점수 ${totalScore}점으로 분석합니다.`,
      );
    students.push({
      key: studentKey,
      uid: uid || undefined,
      grade,
      class: classValue,
      number: studentNumber,
      name,
      responses,
      totalScore,
      ...(reportedTotal === null ? {} : { recordedTotalScore: reportedTotal }),
    });
  }
  if (!students.length) throw new Error("분석할 학생 답안 행이 없습니다.");
  if (
    students.some((student) =>
      student.responses.some((response) => response.answer === null),
    )
  )
    warnings.push(
      "오답 여부만 있는 셀은 선택한 선지를 알 수 없어 선지 분포에서 미확인으로 표시합니다.",
    );
  return { students, warnings };
}

export function buildWrittenExamAnalysisDataset(input: {
  examId: string;
  title: string;
  semesterId: string;
  questions: WrittenExamQuestionInfo[];
  students: WrittenExamImportedStudent[];
  importedAt: string | number;
  examRound?: string;
}) {
  const revision = `written:${input.examId}:${input.importedAt}`;
  const unitId = `written:${input.examId}`;
  const examRound = input.examRound || "round_4";
  const questions: Array<Question & { points: number; paperOrder: number }> =
    input.questions.map((q) => ({
      ...q,
      id: q.number,
      docId: `${unitId}:${q.number}`,
      sourceRevision: revision,
      category: "exam_prep",
      examRound,
      unitId,
      type: "choice",
      question: q.question || `${q.number}번`,
      paperOrder: q.number,
      achievementMappingSource: "manual",
      curriculumVersion: q.curriculumVersion || "2018-162",
    }));
  const students: QuizAnalysisStudent[] = input.students.map((student) => ({
    uid: student.uid || `written-student:${student.key}`,
    name: student.name,
    classId: `${student.grade}-${student.class}`,
    number: student.number,
  }));
  const maxPoints = round(
    input.questions.reduce((sum, q) => sum + q.points, 0),
  );
  const records: QuizAnalysisRecord[] = input.students.map(
    (student, index) => ({
      id: `${unitId}:${student.key}`,
      source: "canonical",
      studentUid: students[index].uid,
      semesterId: input.semesterId,
      unitId,
      category: "exam_prep",
      examRound,
      submittedAt: input.importedAt,
      scorePercent:
        student.totalScore === null || maxPoints <= 0
          ? null
          : (student.totalScore / maxPoints) * 100,
      totalCount: input.questions.length,
      behaviorAnswersAvailable: false,
      items: student.responses.map((response) => ({
        questionId: response.questionNumber,
        answer: response.answer,
        correct: response.correct,
        sourceRevision: revision,
        concepts:
          input.questions.find((q) => q.number === response.questionNumber)
            ?.concepts || [],
      })),
    }),
  );
  // Legacy raw adapter preserves null answers; the canonical adapter coerces absent answers to blanks.
  const achievementRecords: AchievementRawRecord[] = records.map(
    (record, index) => ({
      id: record.id,
      source: "legacy",
      raw: {
        studentUid: record.studentUid,
        semesterId: input.semesterId,
        unitId,
        category: "exam_prep",
        examRound,
        timestamp: input.importedAt,
        score: record.scorePercent,
        total: input.questions.length,
        maxPoints,
        questionSnapshots: questions,
        learningSnapshot: questions,
        cutScoreQuestions: questions,
        details: input.students[index].responses.map((response) => ({
          id: response.questionNumber,
          correct: response.correct,
          answer: response.answer,
          sourceRevision: revision,
        })),
      },
    }),
  );
  const tree: TreeUnit[] = [{ id: unitId, title: input.title }];
  return {
    questions,
    students,
    records,
    achievementRecords,
    tree,
    warnings: [] as string[],
  };
}
