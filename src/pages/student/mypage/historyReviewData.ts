import type { AssessmentQuestionSnapshot } from "../../../lib/assessmentLifecycle";
import type { QuizRelearningItem } from "../quiz/quizPracticeData";
import {
  formatMockExamRoundLabel,
  normalizeMockExamCategory,
} from "../../../lib/mockExamRounds";
import {
  savedReviewQuestion,
  type MyAssessmentDetail,
} from "./assessmentRecords";

const types = new Set(["choice", "ox", "short", "word", "order", "matching"]);
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export function historyReviewQuestion(
  detail: MyAssessmentDetail,
  index: number,
) {
  const saved = savedReviewQuestion(detail);
  const type =
    typeof saved.type === "string" && types.has(saved.type)
      ? (saved.type as AssessmentQuestionSnapshot["type"])
      : null;
  const answer =
    typeof saved.answer === "string" || typeof saved.answer === "number"
      ? String(saved.answer)
      : "";
  const snapshot: QuizRelearningItem = {
    id: String(detail.id ?? index),
    type: type || "short",
    question: saved.question,
    answer,
    explanation: saved.explanation,
    passage: typeof saved.passage === "string" ? saved.passage : undefined,
    image: typeof saved.image === "string" ? saved.image : undefined,
    options: strings(saved.options),
    choiceOptionImages: Array.isArray(saved.choiceOptionImages)
      ? saved.choiceOptionImages.map((item) =>
          typeof item === "string" ? item : null,
        )
      : undefined,
    matchingPairs: Array.isArray(saved.matchingPairs)
      ? saved.matchingPairs.flatMap((item) => {
          if (
            !item ||
            typeof item !== "object" ||
            typeof item.left !== "string" ||
            typeof item.right !== "string"
          )
            return [];
          return [
            {
              left: item.left,
              right: item.right,
              rightImage:
                typeof item.rightImage === "string" ? item.rightImage : null,
            },
          ];
        })
      : undefined,
    submittedAnswer: saved.userAnswer,
    submittedAnswerAvailable: saved.userAnswerAvailable,
    concepts: strings(detail.concepts),
    reviewLessonId:
      typeof detail.reviewLessonId === "string"
        ? detail.reviewLessonId
        : undefined,
  };
  return {
    snapshot,
    saved,
    correct: detail.correct,
    practiceAvailable:
      detail.correct === false &&
      !!type &&
      saved.questionAvailable &&
      answer.trim().length > 0,
  };
}

export function formatHistoryDate(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return "날짜 미보관";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

export const historyCategoryLabel = (value: string, examRound?: unknown) =>
  normalizeMockExamCategory(value) === "exam_prep" && examRound
    ? formatMockExamRoundLabel(examRound)
    : {
        diagnostic: "진단평가",
        formative: "형성평가",
        exam_prep: "모의고사",
        summative: "총괄평가",
      }[value] || "평가";
