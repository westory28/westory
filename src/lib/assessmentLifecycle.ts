import { getHistoryDictionaryCallable as getHttpsCallable } from "./historyDictionarySession";
import { auth } from "./firebase";
import { ensureSensitiveOperation } from "./sensitiveOperation";
import { getIdTokenResult } from "firebase/auth";

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
  `westory:w6a:${auth.currentUser?.uid || ""}:${commandType}:${stableStringify(payload)}`;

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

const captureAssessmentOwner = async () => {
  const owner = auth.currentUser;
  const changed = () =>
    Object.assign(
      new Error("로그인 상태가 변경되었습니다. 다시 확인해 주세요."),
      { code: "functions/unauthenticated" },
    );
  if (!owner) throw changed();
  const epoch = (await getIdTokenResult(owner)).authTime;
  if (!epoch || auth.currentUser !== owner) throw changed();
  return async () => {
    if (
      auth.currentUser !== owner ||
      (await getIdTokenResult(owner)).authTime !== epoch ||
      auth.currentUser !== owner
    )
      throw changed();
  };
};

export const executeStudentAssessmentCommand = async <T>(
  commandType: string,
  payload: Record<string, unknown>,
) => {
  const assertOwner = await captureAssessmentOwner();
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
    await assertOwner();
    const response = await execute({ commandId, commandType, payload });
    await assertOwner();
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
      await assertOwner();
      const status = await getStatus({ commandId, commandType });
      await assertOwner();
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

export const executeAssessmentManagementCommand = async <T>(
  commandType: string,
  payload: Record<string, unknown>,
): Promise<T> => {
  await ensureSensitiveOperation();
  return executeStudentAssessmentCommand<T>(commandType, payload);
};

export const getAssessmentState = async (input: {
  definitionId?: string;
  attemptId?: string;
}) => {
  const assertOwner = await captureAssessmentOwner();
  const callable = await getHttpsCallable<
    typeof input,
    AssessmentStateResponse
  >("getAssessmentState");
  await assertOwner();
  const response = await callable(input);
  await assertOwner();
  return response.data;
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
  const assertOwner = await captureAssessmentOwner();
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
  const key = pendingKey("saveAssessmentProgress", input);
  const saveId = input.saveId || readPendingCommandId(key) || createCommandId();
  rememberPendingCommandId(key, saveId);
  try {
    await assertOwner();
    const saved = await callable({ ...input, saveId });
    await assertOwner();
    forgetPendingCommandId(key);
    return saved.data;
  } catch (error) {
    if (!isAmbiguous(error)) forgetPendingCommandId(key);
    throw error;
  }
};

export const submitAssessmentAttempt = async (input: {
  attemptId: string;
  expectedRevision: number;
  answers: Record<string, string>;
  submitReason: "STUDENT" | "TIMEOUT";
}) => {
  // A different writer may have saved this revision. Preserve local answers
  // and surface the conflict rather than submitting them over that writer.
  return executeStudentAssessmentCommand<AssessmentSubmissionResult>(
    "submitAssessmentAttempt",
    input,
  );
};

export const isAssessmentRevisionConflict = (error: unknown) => {
  const failure = error as {
    details?: { reason?: unknown };
    customData?: { details?: { reason?: unknown } };
  };
  return (
    (failure?.details?.reason || failure?.customData?.details?.reason) ===
    "ASSESSMENT_ATTEMPT_REVISION_CONFLICT"
  );
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

export interface AssessmentAttemptState {
  attemptId: string;
  definitionId: string;
  semesterId: string;
  assessmentKind: "QUIZ" | "HISTORY_CLASSROOM";
  attemptNumber: number;
  status:
    | "STARTED"
    | "IN_PROGRESS"
    | "RECOVERABLE"
    | "SUBMITTED"
    | "EXPIRED"
    | "LOCKED";
  revision: number;
  answers: Record<string, string>;
  currentItemId: string;
  questionIds: string[];
  startedAtIso: string;
  deadlineAtIso: string;
  lastSavedAtIso: string;
  submittedAtIso: string;
  resultRef: string;
  resumed: boolean;
}

export interface AssessmentRewardResult {
  status:
    | "AWARDED"
    | "DUPLICATE"
    | "DISABLED"
    | "NOT_ELIGIBLE"
    | "NOT_RECORDED";
  awarded: boolean;
  duplicate: boolean;
  amount: number;
  bonusAwarded: boolean;
  bonusAmount: number;
  totalAwarded: number;
  blockedReason: string;
  blockedMessage: string;
  ledgerEntryIds: string[];
  balance?: number;
  nextEligibleAt?: string;
}

export interface AssessmentSubmissionResult {
  attemptId: string;
  status: "SUBMITTED";
  revision: number;
  score: number;
  total: number;
  percent: number;
  answerChecks: Array<{ id: string; correct: boolean }>;
  resultRef: string;
  submissionRef: string;
  replayedSubmission: boolean;
  reward?: AssessmentRewardResult;
}
