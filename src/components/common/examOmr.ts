export type ExamOmrChoice = 1 | 2 | 3 | 4 | 5;

export type ExamOmrAnswerValue =
  | ExamOmrChoice
  | number
  | string
  | null
  | undefined;

export type ExamOmrQuestionResult = {
  questionNumber: number | string;
  correctAnswer: ExamOmrAnswerValue;
  studentAnswer: ExamOmrAnswerValue;
  normalizedAnswer?: ExamOmrAnswerValue;
  correct?: boolean;
  score?: number | string | null;
  maxScore?: number | string | null;
  scoreEntered?: boolean;
  invalid?: boolean;
};

export const EXAM_OMR_CHOICES: ExamOmrChoice[] = [1, 2, 3, 4, 5];

const EXAM_OMR_CHOICE_ALIASES: Record<string, ExamOmrChoice> = {
  "1": 1,
  "１": 1,
  "①": 1,
  "❶": 1,
  "➀": 1,
  "⑴": 1,
  "2": 2,
  "２": 2,
  "②": 2,
  "❷": 2,
  "➁": 2,
  "⑵": 2,
  "3": 3,
  "３": 3,
  "③": 3,
  "❸": 3,
  "➂": 3,
  "⑶": 3,
  "4": 4,
  "４": 4,
  "④": 4,
  "❹": 4,
  "➃": 4,
  "⑷": 4,
  "5": 5,
  "５": 5,
  "⑤": 5,
  "❺": 5,
  "➄": 5,
  "⑸": 5,
};

const uniqueChoices = (choices: ExamOmrChoice[]) =>
  Array.from(new Set(choices)).sort((left, right) => left - right);

export const normalizeExamOmrChoices = (
  answer: ExamOmrAnswerValue,
  correctAnswer?: ExamOmrAnswerValue,
): ExamOmrChoice[] => {
  const source = answer === "." ? correctAnswer : answer;

  if (typeof source === "number") {
    return EXAM_OMR_CHOICES.includes(source as ExamOmrChoice)
      ? [source as ExamOmrChoice]
      : [];
  }

  if (typeof source !== "string") return [];

  const trimmed = source.trim();
  if (!trimmed) return [];

  const parsed = Number(trimmed);
  if (EXAM_OMR_CHOICES.includes(parsed as ExamOmrChoice)) {
    return [parsed as ExamOmrChoice];
  }

  return uniqueChoices(
    Array.from(trimmed)
      .map((character) => EXAM_OMR_CHOICE_ALIASES[character])
      .filter((choice): choice is ExamOmrChoice =>
        EXAM_OMR_CHOICES.includes(choice as ExamOmrChoice),
      ),
  );
};

export const normalizeExamOmrChoice = (
  answer: ExamOmrAnswerValue,
  correctAnswer?: ExamOmrAnswerValue,
): ExamOmrChoice | null =>
  normalizeExamOmrChoices(answer, correctAnswer)[0] || null;

export const getExamOmrStudentChoices = (
  result: ExamOmrQuestionResult,
): ExamOmrChoice[] =>
  normalizeExamOmrChoices(
    result.normalizedAnswer ?? result.studentAnswer,
    result.correctAnswer,
  );

export const getExamOmrStudentChoice = (
  result: ExamOmrQuestionResult,
): ExamOmrChoice | null => getExamOmrStudentChoices(result)[0] || null;

export const getExamOmrCorrectChoices = (
  result: ExamOmrQuestionResult,
): ExamOmrChoice[] => normalizeExamOmrChoices(result.correctAnswer);

export const getExamOmrCorrectChoice = (
  result: ExamOmrQuestionResult,
): ExamOmrChoice | null => getExamOmrCorrectChoices(result)[0] || null;

export const getExamOmrCorrectState = (
  result: ExamOmrQuestionResult,
): boolean | null => {
  if (result.invalid) return null;

  const studentChoices = getExamOmrStudentChoices(result);
  const correctChoices = getExamOmrCorrectChoices(result);

  if (!studentChoices.length || !correctChoices.length) {
    return typeof result.correct === "boolean" ? result.correct : null;
  }
  const computedCorrect =
    correctChoices.length > 1
      ? studentChoices.every((choice) => correctChoices.includes(choice))
      : studentChoices.length === 1 && studentChoices[0] === correctChoices[0];
  if (computedCorrect) return true;
  return typeof result.correct === "boolean" ? result.correct : false;
};
