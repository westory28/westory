import type { SystemConfig } from "../types";
import { getSemesterDocPath } from "./semesterScope";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

export type QuizSubmissionStatus = "in_progress" | "submitted" | "timed_out";

export interface QuizSubmissionDoc {
  id: string;
  uid: string;
  name: string;
  email: string;
  class: string;
  number: string;
  gradeClass: string;
  unitId: string;
  category: string;
  title: string;
  status: QuizSubmissionStatus;
  questionIds: string[];
  answers: Record<string, string>;
  currentIndex: number;
  hintUsedCount: number;
  revealedHintIds: string[];
  orderOptionMap: Record<string, string[]>;
  timeLimitSeconds: number;
  clientStartedAtMs: number;
  lastClientSavedAtMs: number;
  startedAt?: unknown;
  lastSavedAt?: unknown;
  submittedAt?: unknown;
  resultId: string;
}

export const buildQuizSubmissionId = (
  uid: string,
  unitId: string,
  category: string,
) =>
  [
    // Keep the uid segment raw so the doc id stays aligned with Firestore rules.
    String(uid || "").trim(),
    encodeURIComponent(String(unitId || "").trim()),
    encodeURIComponent(String(category || "").trim()),
  ].join("__");

export const getQuizSubmissionDocPath = (
  config: ConfigLike,
  uid: string,
  unitId: string,
  category: string,
) =>
  getSemesterDocPath(
    config,
    "quiz_submissions",
    buildQuizSubmissionId(uid, unitId, category),
  );

export const readTimestampMs = (value: unknown) => {
  if (!value || typeof value !== "object") return 0;

  const timestampLike = value as {
    seconds?: number;
    nanoseconds?: number;
    toDate?: () => Date;
  };

  if (typeof timestampLike.toDate === "function") {
    const date = timestampLike.toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  if (typeof timestampLike.seconds === "number") {
    const nanos = Number(timestampLike.nanoseconds || 0);
    return timestampLike.seconds * 1000 + Math.floor(nanos / 1_000_000);
  }

  return 0;
};

export const normalizeQuizSubmissionDoc = (
  id: string,
  raw: Partial<QuizSubmissionDoc> | null | undefined,
): QuizSubmissionDoc => {
  const source =
    raw && typeof raw === "object"
      ? raw
      : ({} as Partial<QuizSubmissionDoc>);

  return {
    id,
    uid: String(source.uid || "").trim(),
    name: String(source.name || "").trim(),
    email: String(source.email || "").trim(),
    class: String(source.class || "").trim(),
    number: String(source.number || "").trim(),
    gradeClass: String(source.gradeClass || "").trim(),
    unitId: String(source.unitId || "").trim(),
    category: String(source.category || "").trim(),
    title: String(source.title || "").trim(),
    status:
      source.status === "submitted" || source.status === "timed_out"
        ? source.status
        : "in_progress",
    questionIds: Array.isArray(source.questionIds)
      ? source.questionIds
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    answers:
      source.answers && typeof source.answers === "object"
        ? Object.fromEntries(
            Object.entries(source.answers).map(([key, value]) => [
              String(key || "").trim(),
              String(value || ""),
            ]),
          )
        : {},
    currentIndex: Math.max(0, Number(source.currentIndex) || 0),
    hintUsedCount: Math.max(0, Number(source.hintUsedCount) || 0),
    revealedHintIds: Array.isArray(source.revealedHintIds)
      ? source.revealedHintIds
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    orderOptionMap:
      source.orderOptionMap && typeof source.orderOptionMap === "object"
        ? Object.fromEntries(
            Object.entries(source.orderOptionMap).map(([key, value]) => [
              String(key || "").trim(),
              Array.isArray(value)
                ? value
                    .map((item) => String(item || "").trim())
                    .filter(Boolean)
                : [],
            ]),
          )
        : {},
    timeLimitSeconds: Math.max(60, Number(source.timeLimitSeconds) || 60),
    clientStartedAtMs: Math.max(0, Number(source.clientStartedAtMs) || 0),
    lastClientSavedAtMs: Math.max(0, Number(source.lastClientSavedAtMs) || 0),
    startedAt: source.startedAt,
    lastSavedAt: source.lastSavedAt,
    submittedAt: source.submittedAt,
    resultId: String(source.resultId || "").trim(),
  };
};

export const getQuizSubmissionServerOffsetMs = (
  submission: QuizSubmissionDoc | null | undefined,
) => {
  if (!submission) return 0;

  const lastSavedAtMs = readTimestampMs(submission.lastSavedAt);
  if (lastSavedAtMs > 0 && submission.lastClientSavedAtMs > 0) {
    return lastSavedAtMs - submission.lastClientSavedAtMs;
  }

  const startedAtMs = readTimestampMs(submission.startedAt);
  if (startedAtMs > 0 && submission.clientStartedAtMs > 0) {
    return startedAtMs - submission.clientStartedAtMs;
  }

  return 0;
};

export const getQuizSubmissionDeadlineMs = (
  submission: QuizSubmissionDoc | null | undefined,
) => {
  if (!submission) return 0;
  const startedAtMs = readTimestampMs(submission.startedAt);
  if (!startedAtMs) return 0;
  return startedAtMs + submission.timeLimitSeconds * 1000;
};

export const getQuizSubmissionRemainingSeconds = (
  submission: QuizSubmissionDoc | null | undefined,
  nowMs = Date.now(),
) => {
  const deadlineMs = getQuizSubmissionDeadlineMs(submission);
  if (!deadlineMs) {
    return submission?.timeLimitSeconds || 0;
  }

  const serverNowMs = nowMs + getQuizSubmissionServerOffsetMs(submission);
  return Math.max(0, Math.ceil((deadlineMs - serverNowMs) / 1000));
};
