import type {
  AssessmentQuestionSnapshot,
  AssessmentSubmissionResult,
} from "../../../lib/assessmentLifecycle";

export interface QuizRelearningItem extends AssessmentQuestionSnapshot {
  submittedAnswer: string;
  submittedAnswerAvailable?: boolean;
  concepts: string[];
  reviewLessonId?: string;
}

/** Only a submitted server snapshot may disclose answers or enter practice. */
export function buildQuizRelearningItems(
  submitted: Pick<
    AssessmentSubmissionResult,
    "answerChecks" | "questionSnapshots" | "learningSnapshot"
  >,
  answers: Record<string, string>,
): QuizRelearningItem[] {
  const snapshots = new Map(
    (submitted.questionSnapshots || []).map((item) => [String(item.id), item]),
  );
  const metadata = new Map(
    (submitted.learningSnapshot || []).map((item) => [String(item.id), item]),
  );
  const seen = new Set<string>();
  return submitted.answerChecks.flatMap((check) => {
    const id = String(check.id);
    const snapshot = snapshots.get(id);
    if (
      check.correct !== false ||
      seen.has(id) ||
      !snapshot?.question ||
      !snapshot.answer?.trim()
    )
      return [];
    seen.add(id);
    const learning = metadata.get(id);
    return [
      {
        ...snapshot,
        id,
        submittedAnswer: answers[id] || "",
        concepts: learning?.concepts || [],
        reviewLessonId: learning?.reviewLessonId,
      },
    ];
  });
}

/** Match the existing assessment server's whitespace normalization exactly. */
export function isQuizPracticeAnswerCorrect(
  answer: string,
  expected: string,
): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, "").trim();
  return (
    normalize(answer).length > 0 && normalize(answer) === normalize(expected)
  );
}

export const formatQuizPracticeAnswer = (answer: string) =>
  answer
    .split("||")
    .map((part) => part.replace("=>", " → "))
    .join(" → ");

export function getQuizPracticeOrderOptions(
  item: QuizRelearningItem,
): string[] {
  return [
    ...(item.options?.length ? item.options : item.answer.split("||")),
  ].sort((a, b) => a.localeCompare(b, "ko"));
}

export function getQuizPracticePairs(item: QuizRelearningItem): Array<{
  left: string;
  right: string;
  rightImage?: string | null;
}> {
  return item.matchingPairs?.length
    ? item.matchingPairs
    : item.answer
        .split("||")
        .map((part) => {
          const [left, right] = part.split("=>");
          return { left, right };
        })
        .filter((pair) => pair.left && pair.right);
}

export function encodeQuizPracticeMatching(
  item: QuizRelearningItem,
  values: Record<string, string>,
): string {
  return getQuizPracticePairs(item)
    .map(({ left }) => (values[left] ? `${left}=>${values[left]}` : ""))
    .filter(Boolean)
    .join("||");
}
