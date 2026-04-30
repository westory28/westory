export type LessonAnswerStatus = "" | "correct" | "wrong";

export interface LessonProgressAnswer {
  value?: string;
  status?: LessonAnswerStatus;
}

export interface RenderedLessonAnswer {
  key: string;
  value: string;
  status: LessonAnswerStatus;
}

export interface LessonAnswerSnapshot {
  answers: Record<string, { value: string; status: LessonAnswerStatus }>;
  totalCount: number;
  filledCount: number;
}

const normalizeStatus = (status?: LessonAnswerStatus): LessonAnswerStatus =>
  status === "correct" || status === "wrong" ? status : "";

const normalizeAnswer = (
  answer?: LessonProgressAnswer | RenderedLessonAnswer | null,
) => ({
  value: String(answer?.value || ""),
  status: normalizeStatus(answer?.status),
});

export const buildLessonAnswerSnapshot = ({
  existingAnswers = {},
  renderedAnswers = [],
  worksheetBlankIds = [],
}: {
  existingAnswers?: Record<string, LessonProgressAnswer>;
  renderedAnswers?: RenderedLessonAnswer[];
  worksheetBlankIds?: string[];
}): LessonAnswerSnapshot => {
  const renderedAnswerMap = new Map(
    renderedAnswers
      .filter((answer) => answer.key)
      .map((answer) => [answer.key, normalizeAnswer(answer)]),
  );
  const worksheetBlankIdSet = new Set(
    worksheetBlankIds.map((blankId) => String(blankId || "")).filter(Boolean),
  );
  const answers: LessonAnswerSnapshot["answers"] = {};
  let totalCount = 0;
  let filledCount = 0;

  const includeAnswer = (
    key: string,
    answer?: LessonProgressAnswer | RenderedLessonAnswer | null,
  ) => {
    if (!key) return;
    const normalized = normalizeAnswer(answer);
    answers[key] = normalized;
    totalCount += 1;
    if (normalized.value.trim()) {
      filledCount += 1;
    }
  };

  worksheetBlankIds.forEach((blankId) => {
    const key = String(blankId || "");
    includeAnswer(key, renderedAnswerMap.get(key) || existingAnswers[key]);
  });

  renderedAnswers.forEach((answer) => {
    if (!answer.key || worksheetBlankIdSet.has(answer.key)) return;
    includeAnswer(answer.key, answer);
  });

  return {
    answers,
    totalCount,
    filledCount,
  };
};
