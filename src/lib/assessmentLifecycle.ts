import { getHistoryDictionaryCallable as getHttpsCallable } from "./historyDictionarySession";
import { auth } from "./firebase";
import { ensureSensitiveOperation } from "./sensitiveOperation";
import { getIdTokenResult } from "firebase/auth";
import { withRequestDeadline } from "./requestDeadline";
import type { AssessmentTelemetrySnapshot } from "./assessmentTelemetry";
import type { AssessmentLearningQuestion } from "./assessmentLearning";
import type { MockExamPassageSet } from "./mockExamMaterials";

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
  questionCount: number;
  presentationSettings?: Record<string, unknown> | null;
  provenance: string;
}

export interface AssessmentStateResponse {
  status:
    | "READY"
    | "RECOVERABLE"
    | "SUBMITTED"
    | "INVALID_LINK"
    | "PERMISSION"
    | "PREREQUISITE_REQUIRED"
    | "NOT_OPEN"
    | "CLOSED"
    | "ARCHIVED";
  definition: AssessmentDefinitionState | null;
  attempt: AssessmentAttemptState | null;
  serverNowIso: string;
  writeCount: 0;
  requiredRound?: string;
  preparedAssets?: {
    sourceHash: string;
    imageUrls: string[];
    fontCharacters: string;
  };
}

export interface MockExamOverview {
  semesterId: string;
  rounds: {
    examRound: string;
    completed: boolean;
    retakeBlocked: boolean;
    prerequisiteMet: boolean;
    requiredRound: string;
  }[];
  writeCount: 0;
}

// Read only when the student opens the round picker, never the full history.
export const getMockExamOverview = async (input: { semesterId: string }) => {
  const assertOwner = await captureAssessmentOwner();
  const callable = await getHttpsCallable<
    { semesterId: string; mockExamOverview: true },
    MockExamOverview
  >("getAssessmentState");
  await assertOwner();
  const response = await callable({ ...input, mockExamOverview: true });
  await assertOwner();
  if (
    response.data?.semesterId !== input.semesterId ||
    !Array.isArray(response.data?.rounds)
  ) {
    throw new Error(
      "모의고사 응시 상태를 확인하지 못했습니다. 다시 확인해 주세요.",
    );
  }
  return response.data;
};

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

const pendingCommandIds = new Map<string, string>();

const readPendingCommandId = (key: string) => {
  const remembered = pendingCommandIds.get(key);
  if (remembered) return remembered;
  try {
    return window.sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
};

const rememberPendingCommandId = (key: string, commandId: string) => {
  pendingCommandIds.set(key, commandId);
  try {
    window.sessionStorage.setItem(key, commandId);
  } catch {
    // Explicit retries in this page retain their ID even if storage is blocked.
  }
};

const forgetPendingCommandId = (key: string, expectedId: string) => {
  if (readPendingCommandId(key) !== expectedId) return;
  pendingCommandIds.delete(key);
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

const receivedSessionResponse = (error: unknown) =>
  (error as { applicationSessionResponseReceived?: boolean })
    ?.applicationSessionResponseReceived === true;

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

const assertAssessmentResponseOwner = async (
  assertOwner: () => Promise<void>,
) => {
  try {
    await assertOwner();
  } catch (error) {
    // The write already responded. A changed login must reject its result
    // without discarding the receipt needed by the owner's explicit retry.
    throw Object.assign(error as Error, {
      applicationSessionResponseReceived: true,
    });
  }
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
    await assertAssessmentResponseOwner(assertOwner);
    if (
      response.data?.status !== "SUCCEEDED" ||
      response.data.commandId !== commandId ||
      response.data.commandType !== commandType ||
      response.data.result == null
    ) {
      throw Object.assign(
        new Error(
          "처리 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.",
        ),
        { code: "functions/unknown" },
      );
    }
    forgetPendingCommandId(key, commandId);
    if (commandType === "submitAssessmentAttempt" && response.data.replayed) {
      return { ...response.data.result, replayedSubmission: true };
    }
    return response.data.result;
  } catch (error) {
    if (receivedSessionResponse(error)) throw error;
    if (!isAmbiguous(error)) {
      forgetPendingCommandId(key, commandId);
      throw error;
    }
    const getStatus = await getHttpsCallable<
      { commandId: string; commandType: string },
      {
        commandId: string;
        commandType: string;
        status: string;
        result: T | null;
      }
    >("getCommandStatus");
    try {
      await assertOwner();
      const status = await getStatus({ commandId, commandType });
      await assertOwner();
      if (
        status.data?.status === "SUCCEEDED" &&
        status.data.commandId === commandId &&
        status.data.commandType === commandType &&
        status.data.result != null
      ) {
        forgetPendingCommandId(key, commandId);
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
  // Match the server's routine classroom policy. These commands still verify
  // the current session, teacher role, semester and enrollment on the server.
  const routineClassroomCommand = [
    "grantHistoryClassroomExemptions",
    "revokeHistoryClassroomExemptions",
    "reviewHistoryClassroomExemptionRequest",
    "applyHistoryClassroomExemption",
    "upsertHistoryClassroomSource",
    "saveHistoryClassroomAssignment",
    "deleteHistoryClassroomSource",
    "createAssessmentDefinition",
    "updateAssessmentDefinition",
    "saveQuizAssessmentSettings",
    "upsertQuizQuestion",
    "saveAchievementProfile",
    "transitionAssessmentDefinition",
  ].includes(commandType);
  if (!routineClassroomCommand) await ensureSensitiveOperation();
  return executeStudentAssessmentCommand<T>(commandType, payload);
};

const pendingStateReads = new WeakMap<
  object,
  Map<string, Promise<AssessmentStateResponse>>
>();

export const getAssessmentState = async (input: {
  definitionId?: string;
  attemptId?: string;
  prepareAssets?: boolean;
}) => {
  const owner = auth.currentUser;
  if (!owner)
    throw Object.assign(new Error("로그인 상태를 확인해 주세요."), {
      code: "functions/unauthenticated",
    });
  const key = stableStringify(input);
  const reads =
    pendingStateReads.get(owner!) ||
    new Map<string, Promise<AssessmentStateResponse>>();
  pendingStateReads.set(owner!, reads);
  const pending = reads.get(key);
  if (pending) return pending;
  const request = withRequestDeadline(
    (async () => {
      const assertOwner = await captureAssessmentOwner();
      const callable = await getHttpsCallable<
        typeof input,
        AssessmentStateResponse
      >("getAssessmentState");
      await assertOwner();
      const response = await callable(input);
      await assertOwner();
      return response.data;
    })(),
    15_000,
    "응시 상태 확인이 지연되고 있습니다. 다시 시도해 주세요.",
  );
  reads.set(key, request);
  try {
    return await request;
  } finally {
    if (reads.get(key) === request) reads.delete(key);
  }
};

export const startAssessmentAttempt = (input: {
  definitionId: string;
  preparedSourceHash?: string;
}) => {
  const ownerCheck = captureAssessmentOwner();
  const request = ownerCheck.then(() =>
    executeStudentAssessmentCommand<AssessmentAttemptState>(
      "startAssessmentAttempt",
      input,
    ),
  );
  // A committed START can have a delayed/lost HTTP response. Read its exact
  // receipt at most three times while pending, then restore its live attempt.
  // Never infer commitment from a different active attempt or replay a write.
  let stopRecovery = () => {};
  const recovered = new Promise<AssessmentAttemptState>((resolve, reject) => {
    let settled = false;
    let recovering = false;
    let recoveryCommandId: string | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    stopRecovery = () => {
      settled = true;
      timers.forEach(clearTimeout);
    };
    const finish = (value: AssessmentAttemptState) => {
      if (settled) return;
      stopRecovery();
      resolve(value);
    };
    const recover = async () => {
      if (settled || recovering) return;
      recovering = true;
      try {
        const assertOwner = await ownerCheck;
        await assertOwner();
        if (settled) return;
        const key = pendingKey("startAssessmentAttempt", input);
        const commandId = recoveryCommandId || readPendingCommandId(key);
        if (!commandId) return;
        recoveryCommandId = commandId;
        const getStatus = await getHttpsCallable<
          { commandId: string; commandType: string },
          {
            commandId: string;
            commandType: string;
            status: string;
            result?: AssessmentAttemptState;
          }
        >("getCommandStatus");
        await assertOwner();
        if (settled) return;
        const response = await withRequestDeadline(
          getStatus({ commandId, commandType: "startAssessmentAttempt" }),
          7_000,
          "시험 시작 확인이 지연되고 있습니다.",
        );
        await assertOwner();
        if (
          settled ||
          response.data?.status !== "SUCCEEDED" ||
          response.data.commandId !== commandId ||
          response.data.commandType !== "startAssessmentAttempt" ||
          !response.data.result?.attemptId
        )
          return;
        const state = await getAssessmentState({
          attemptId: response.data.result.attemptId,
        });
        await assertOwner();
        if (
          settled ||
          !state.attempt ||
          state.attempt.attemptId !== response.data.result.attemptId ||
          state.attempt.definitionId !== input.definitionId ||
          !["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(
            state.attempt.status,
          ) ||
          !["READY", "RECOVERABLE"].includes(state.status)
        )
          return;
        forgetPendingCommandId(key, commandId);
        finish({
          ...state.attempt,
          resumed: true,
          serverNowIso: state.serverNowIso,
        });
      } catch {
        // The original request still owns its outcome and stable receipt ID.
      } finally {
        recovering = false;
      }
    };
    for (const delay of [8_000, 16_000, 24_000]) {
      timers.push(setTimeout(recover, delay));
    }
    request.then(finish, (error) => {
      if (settled) return;
      stopRecovery();
      reject(error);
    });
  });
  return withRequestDeadline(
    recovered,
    40_000,
    "시험 시작 확인이 지연되고 있습니다. 다시 시도하면 저장된 응시를 확인합니다.",
  ).finally(stopRecovery);
};

export const saveAssessmentProgress = async (input: {
  attemptId: string;
  expectedRevision: number;
  answers: Record<string, string>;
  currentItemId: string;
  saveId?: string;
  analytics?: AssessmentTelemetrySnapshot;
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
    await assertAssessmentResponseOwner(assertOwner);
    forgetPendingCommandId(key, saveId);
    return saved.data;
  } catch (error) {
    if (!isAmbiguous(error) && !receivedSessionResponse(error))
      forgetPendingCommandId(key, saveId);
    throw error;
  }
};

export const submitAssessmentAttempt = async (input: {
  attemptId: string;
  expectedRevision: number;
  answers: Record<string, string>;
  submitReason: "STUDENT" | "TIMEOUT";
  analytics?: AssessmentTelemetrySnapshot;
}) => {
  // A different writer may have saved this revision. Preserve local answers
  // and surface the conflict rather than submitting them over that writer.
  return executeStudentAssessmentCommand<AssessmentSubmissionResult>(
    "submitAssessmentAttempt",
    input,
  );
};

export const lockHistoryClassroomAttempt = (input: {
  attemptId: string;
  reason: "VISIBILITY_HIDDEN" | "NAVIGATION";
}) =>
  executeStudentAssessmentCommand<{
    attemptId: string;
    status: "LOCKED" | "SUBMITTED";
    revision: number;
  }>("lockHistoryClassroomAttempt", input);

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

export interface AssessmentQuestionSnapshot {
  examRound?: string;
  paperOrder?: number;
  points?: number;
  paperBreakBefore?: boolean;
  id: string;
  type: "choice" | "ox" | "short" | "word" | "order" | "matching";
  question: string;
  answer: string;
  explanation?: string;
  passage?: string;
  examplePassage?: string | null;
  passageSet?: MockExamPassageSet | null;
  image?: string;
  options?: string[];
  choiceOptionImages?: Array<string | null>;
  hint?: string;
  hintEnabled?: boolean;
  matchingPairs?: Array<{
    left: string;
    right: string;
    rightImage?: string | null;
  }>;
  unitId?: string;
  subUnitId?: string;
  refBig?: string;
  refMid?: string;
  refSmall?: string;
}

export type AssessmentQuestionPresentation = Omit<
  AssessmentQuestionSnapshot,
  "answer" | "explanation" | "matchingPairs"
> & {
  matchingLeftOptions?: string[];
  matchingRightOptions?: Array<{ right: string; rightImage?: string | null }>;
};

export interface AssessmentAttemptState {
  paperHeader?: { paperTitle?: string; paperHeading?: string };
  serverNowIso?: string;
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
  analytics?: AssessmentTelemetrySnapshot | null;
  learningSnapshot?: AssessmentLearningQuestion[];
  questionPresentation?: AssessmentQuestionPresentation[];
  questionSnapshotOmittedIds?: string[];
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
  answers?: Record<string, string>;
  paperHeader?: { paperTitle?: string; paperHeading?: string };
  earnedPoints?: number;
  maxPoints?: number;
  attemptId: string;
  status: "SUBMITTED";
  revision: number;
  score: number;
  total: number;
  percent: number;
  passed?: boolean;
  passThresholdPercent?: number;
  answerChecks: Array<{ id: string; correct: boolean }>;
  resultRef: string;
  submissionRef: string;
  replayedSubmission: boolean;
  reward?: AssessmentRewardResult;
  analytics?: AssessmentTelemetrySnapshot | null;
  learningSnapshot?: AssessmentLearningQuestion[];
  questionSnapshots?: AssessmentQuestionSnapshot[];
  questionSnapshotOmittedIds?: string[];
}
