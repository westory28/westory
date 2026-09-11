import { getHttpsCallable } from "./firebase";
import type {
  AssessmentAttemptState,
  AssessmentSubmissionResult,
} from "./commandGateway";

export type AssessmentKind = "QUIZ" | "HISTORY_CLASSROOM";

export const buildAssessmentDefinitionId = (
  semesterId: string,
  kind: AssessmentKind,
  sourceId: string,
  category = "",
  examRound = "",
) =>
  [kind.toLowerCase(), semesterId, sourceId, category, examRound]
    .filter(Boolean)
    .join(":")
    .replace(/[^A-Za-z0-9_.:-]/g, "-")
    .slice(0, 180);

export interface AssessmentDefinitionState {
  definitionId: string;
  semesterId: string;
  assessmentKind: AssessmentKind;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "PAUSED" | "CLOSED";
  revision: number;
  durationSeconds: number;
  maxAttempts: number;
  cooldownMinutes: number;
  opensAt: string;
  closesAt: string;
  itemCount: number;
  provenance: string;
}

export interface AssessmentStateResponse {
  status:
    | "READY"
    | "RECOVERABLE"
    | "SUBMITTED"
    | "INVALID_LINK"
    | "PERMISSION"
    | "NOT_OPEN"
    | "CLOSED"
    | "ARCHIVED";
  definition: AssessmentDefinitionState | null;
  attempt: AssessmentAttemptState | null;
  serverNowIso: string;
  writeCount: 0;
}

interface CommandResponse<T> {
  commandId: string;
  commandType: string;
  status: "SUCCEEDED";
  replayed: boolean;
  result: T;
}

const createCommandId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
};

const pendingKey = (commandType: string, payload: unknown) =>
  `westory:w6a:${commandType}:${stableStringify(payload)}`;

const readPendingCommandId = (key: string) => {
  try {
    return window.sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
};

const rememberPendingCommandId = (key: string, commandId: string) => {
  try {
    window.sessionStorage.setItem(key, commandId);
  } catch {
    // The in-flight call remains receipt protected even without browser storage.
  }
};

const forgetPendingCommandId = (key: string) => {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // A stale command id is safe because the receipt remains idempotent.
  }
};

const isAmbiguous = (error: unknown) =>
  [
    "functions/cancelled",
    "functions/deadline-exceeded",
    "functions/internal",
    "functions/unknown",
    "functions/unavailable",
  ].includes(String((error as { code?: unknown })?.code || "").toLowerCase());

const executeStudentAssessmentCommand = async <T>(
  commandType: "startAssessmentAttempt" | "submitAssessmentAttempt",
  payload: Record<string, unknown>,
) => {
  const key = pendingKey(commandType, payload);
  const commandId = readPendingCommandId(key) || createCommandId();
  rememberPendingCommandId(key, commandId);
  const execute = await getHttpsCallable<
    {
      commandId: string;
      commandType: string;
      payload: Record<string, unknown>;
    },
    CommandResponse<T>
  >("executeCommand");
  try {
    const response = await execute({ commandId, commandType, payload });
    forgetPendingCommandId(key);
    if (commandType === "submitAssessmentAttempt" && response.data.replayed) {
      return { ...response.data.result, replayedSubmission: true };
    }
    return response.data.result;
  } catch (error) {
    if (!isAmbiguous(error)) {
      forgetPendingCommandId(key);
      throw error;
    }
    const getStatus = await getHttpsCallable<
      { commandId: string; commandType: string },
      { status: string; result: T | null }
    >("getCommandStatus");
    try {
      const status = await getStatus({ commandId, commandType });
      if (status.data.status === "SUCCEEDED" && status.data.result) {
        forgetPendingCommandId(key);
        if (commandType === "submitAssessmentAttempt") {
          return { ...status.data.result, replayedSubmission: true };
        }
        return status.data.result;
      }
    } catch {
      // Keep the stable command id so the next explicit retry cannot duplicate.
    }
    throw error;
  }
};

export const getAssessmentState = async (input: {
  definitionId?: string;
  attemptId?: string;
}) => {
  const callable = await getHttpsCallable<
    typeof input,
    AssessmentStateResponse
  >("getAssessmentState");
  return (await callable(input)).data;
};

export const startAssessmentAttempt = (input: { definitionId: string }) =>
  executeStudentAssessmentCommand<AssessmentAttemptState>(
    "startAssessmentAttempt",
    input,
  );

export const saveAssessmentProgress = async (input: {
  attemptId: string;
  expectedRevision: number;
  answers: Record<string, string>;
  currentItemId: string;
  saveId?: string;
}) => {
  const callable = await getHttpsCallable<
    typeof input & { saveId: string },
    {
      attemptId: string;
      status: "IN_PROGRESS";
      revision: number;
      deadlineAtIso: string;
      savedAtIso: string;
      replayed: boolean;
    }
  >("saveAssessmentProgress");
  return (
    await callable({
      ...input,
      saveId: input.saveId || createCommandId(),
    })
  ).data;
};

export const submitAssessmentAttempt = async (input: {
  attemptId: string;
  expectedRevision: number;
  answers: Record<string, string>;
  submitReason: "STUDENT" | "TIMEOUT";
}) => {
  try {
    return await executeStudentAssessmentCommand<AssessmentSubmissionResult>(
      "submitAssessmentAttempt",
      input,
    );
  } catch (error) {
    const reason = String(
      (
        error as {
          details?: { reason?: unknown };
          customData?: { details?: { reason?: unknown } };
        }
      )?.details?.reason ||
        (error as { customData?: { details?: { reason?: unknown } } })
          ?.customData?.details?.reason ||
        "",
    );
    if (reason !== "ASSESSMENT_ATTEMPT_REVISION_CONFLICT") throw error;
    const current = await getAssessmentState({ attemptId: input.attemptId });
    if (
      !current.attempt ||
      current.attempt.status === "SUBMITTED" ||
      current.attempt.revision === input.expectedRevision
    ) {
      throw error;
    }
    return executeStudentAssessmentCommand<AssessmentSubmissionResult>(
      "submitAssessmentAttempt",
      { ...input, expectedRevision: current.attempt.revision },
    );
  }
};

export const getAssessmentRemainingSeconds = (
  attempt: AssessmentAttemptState | null,
  serverNowIso: string,
) => {
  if (!attempt) return 0;
  const deadlineMs = Date.parse(attempt.deadlineAtIso);
  const serverNowMs = Date.parse(serverNowIso);
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(serverNowMs)) return 0;
  const offset = serverNowMs - Date.now();
  return Math.max(0, Math.ceil((deadlineMs - (Date.now() + offset)) / 1000));
};
