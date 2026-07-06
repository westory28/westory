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

export const normalizeExamOmrChoice = (
  answer: ExamOmrAnswerValue,
  correctAnswer?: ExamOmrAnswerValue,
): ExamOmrChoice | null => {
  const source = answer === "." ? correctAnswer : answer;

  if (typeof source === "number") {
    return EXAM_OMR_CHOICES.includes(source as ExamOmrChoice)
      ? (source as ExamOmrChoice)
      : null;
  }

  if (typeof source !== "string") return null;

  const trimmed = source.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  return EXAM_OMR_CHOICES.includes(parsed as ExamOmrChoice)
    ? (parsed as ExamOmrChoice)
    : null;
};

export const getExamOmrStudentChoice = (
  result: ExamOmrQuestionResult,
): ExamOmrChoice | null =>
  normalizeExamOmrChoice(
    result.normalizedAnswer ?? result.studentAnswer,
    result.correctAnswer,
  );

export const getExamOmrCorrectChoice = (
  result: ExamOmrQuestionResult,
): ExamOmrChoice | null => normalizeExamOmrChoice(result.correctAnswer);

export const getExamOmrCorrectState = (
  result: ExamOmrQuestionResult,
): boolean | null => {
  if (result.invalid) return null;
  if (typeof result.correct === "boolean") return result.correct;

  const studentChoice = getExamOmrStudentChoice(result);
  const correctChoice = getExamOmrCorrectChoice(result);

  if (!studentChoice || !correctChoice) return null;
  return studentChoice === correctChoice;
};
