export type HistoryClassroomSubmissionReason =
  | "manual"
  | "time-limit"
  | "due-window";

export const HISTORY_CLASSROOM_HINT_LIMIT = 3;

export const normalizeHistoryClassroomHintUseCount = (raw: unknown): number => {
  const count = Number(raw);
  return Number.isFinite(count)
    ? Math.max(0, Math.min(HISTORY_CLASSROOM_HINT_LIMIT, Math.floor(count)))
    : 0;
};

export interface HistoryClassroomPendingSubmission {
  status: "failed" | "cancelled";
  reason: HistoryClassroomSubmissionReason;
  cancellationReason?: string;
  answers: Record<string, string>;
}

export const getHistoryClassroomSaveErrorCode = (error: unknown) =>
  String(
    error && typeof error === "object" && "code" in error ? error.code : "",
  ).replace(/^functions\//, "");

export const isHistoryClassroomTransientSaveError = (error: unknown) => {
  const code = getHistoryClassroomSaveErrorCode(error);
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    [
      "unavailable",
      "deadline-exceeded",
      "internal",
      "resource-exhausted",
    ].includes(code) ||
    /timed out|network|failed to fetch|load failed/i.test(message)
  );
};

export const canUseHistoryClassroomLegacySave = (error: unknown) => {
  const code = getHistoryClassroomSaveErrorCode(error);
  const message = error instanceof Error ? error.message.trim() : "";
  // A deployed function can also return not-found for a removed assignment.
  // Only the generic missing-endpoint response permits the legacy write path.
  return (
    code === "unimplemented" ||
    (code === "not-found" && /^(functions\/)?not[-_ ]?found$/i.test(message))
  );
};

export const getHistoryClassroomRetryDelay = (failureCount: number) =>
  [2000, 5000, 10000, 30000][Math.min(3, Math.max(0, failureCount - 1))];

export const readHistoryClassroomPendingSubmission = (
  raw: unknown,
): HistoryClassroomPendingSubmission | null => {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<HistoryClassroomPendingSubmission>;
  if (
    !value.answers ||
    typeof value.answers !== "object" ||
    !["failed", "cancelled"].includes(String(value.status))
  )
    return null;
  return {
    status: value.status === "cancelled" ? "cancelled" : "failed",
    reason:
      value.reason === "time-limit" || value.reason === "due-window"
        ? value.reason
        : "manual",
    cancellationReason: String(value.cancellationReason || ""),
    answers: Object.fromEntries(
      Object.entries(value.answers).map(([key, answer]) => [
        key,
        String(answer ?? ""),
      ]),
    ),
  };
};
