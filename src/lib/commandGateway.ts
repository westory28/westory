import { auth, getHttpsCallable } from "./firebase";
import {
  createHighRiskCommandFlightKey,
  createHighRiskCommandLockName,
  requestStepUpReauthentication,
  runHighRiskCommandSingleFlight,
  StepUpReauthError,
} from "./stepUpReauth";

export type W2CommandType =
  | "updateTermsSettings"
  | "addConsentItem"
  | "updateConsentItem"
  | "deleteConsentItem"
  | "syncKoreanPublicHolidays"
  | "adjustTeacherPoints";

interface ConsentCommandItem {
  id: string;
  title: string;
  text: string;
  required: boolean;
  order: number;
  revision?: string | null;
}

interface HolidayCommandItem {
  title: string;
  start: string;
  eventType: "holiday";
  source?: string;
}

export interface W2CommandPayloads {
  updateTermsSettings: { text: string };
  addConsentItem: { title: string; text: string; required: boolean };
  updateConsentItem: {
    itemId: string;
    title: string;
    text: string;
    required: boolean;
    expectedRevision: string | null;
  };
  deleteConsentItem: { itemId: string; expectedRevision: string | null };
  syncKoreanPublicHolidays: {
    year: string | number;
    semester: string | number;
    holidays: HolidayCommandItem[];
  };
  adjustTeacherPoints: {
    year: string | number;
    semester: string | number;
    uid: string;
    delta: number;
    sourceLabel: string;
    policyId?: string;
    mode: "grant" | "reclaim";
  };
}

export interface W2CommandResults {
  updateTermsSettings: unknown;
  addConsentItem: { item: ConsentCommandItem; revision: string };
  updateConsentItem: { item: ConsentCommandItem; revision: string };
  deleteConsentItem: {
    itemId: string;
    revision: string;
    tombstoneRef: string;
  };
  syncKoreanPublicHolidays: { count: number };
  adjustTeacherPoints: {
    walletId: string;
    transactionId: string;
    balance: number;
    type: "manual_adjust" | "manual_reclaim";
    adapterVersion?: "legacyPointV1";
  };
}

export type WestoryCommandClientState =
  | "pending"
  | "succeeded"
  | "failed"
  | "conflict"
  | "unauthorized"
  | "session-expired"
  | "retryable";

export class WestoryCommandError extends Error {
  readonly state: Exclude<WestoryCommandClientState, "pending" | "succeeded">;
  readonly retryable: boolean;
  readonly reason: string;
  readonly originalError?: unknown;

  constructor(
    state: Exclude<WestoryCommandClientState, "pending" | "succeeded">,
    message: string,
    options: {
      retryable?: boolean;
      reason?: string;
      originalError?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "WestoryCommandError";
    this.state = state;
    this.retryable = options.retryable ?? state === "retryable";
    this.reason = options.reason || "COMMAND_FAILED";
    this.originalError = options.originalError;
  }
}

export interface CommandGatewayResponse<
  Result = unknown,
  CommandType extends W2CommandType = W2CommandType,
> {
  commandId: string;
  commandType: CommandType;
  status: "SUCCEEDED";
  replayed: boolean;
  result: Result;
}

export type CommandStatusValue =
  | "RECEIVED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "COMPENSATION_REQUIRED"
  | "NOT_FOUND";

export interface CommandStatusResponse<
  Result = unknown,
  CommandType extends W2CommandType = W2CommandType,
> {
  commandId: string;
  commandType: CommandType;
  status: CommandStatusValue;
  replayed: boolean;
  result: Result | null;
  resultRef?: string | null;
  error?: { reason?: string; message?: string } | null;
  retryable?: boolean;
  checkpoint?: string | null;
  progress?: number | null;
  createdAt?: unknown;
  completedAt?: unknown;
}

interface ExecuteCommandRequest<CommandType extends W2CommandType> {
  commandId: string;
  commandType: CommandType;
  payload: W2CommandPayloads[CommandType];
}

interface GetCommandStatusRequest<CommandType extends W2CommandType> {
  commandId: string;
  commandType: CommandType;
}

interface PendingCommandHandle {
  schemaVersion: 2;
  projectId: string;
  ownerUid: string;
  commandType: W2CommandType;
  commandId: string;
  clientPayloadHash: string;
  requestedAtClient: string;
  lastKnownState: WestoryCommandClientState;
  lastCheckedAtClient: string;
}

const AMBIGUOUS_FUNCTION_CODES = new Set([
  "functions/cancelled",
  "functions/deadline-exceeded",
  "functions/internal",
  "functions/unknown",
  "functions/unavailable",
]);
const pendingCommandHandles = new Map<string, PendingCommandHandle>();

const createCommandId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    throw new Error("안전한 명령 ID를 만들 수 없습니다.");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const getFunctionErrorDetails = (error: unknown) => {
  const raw =
    (error as { details?: unknown })?.details ??
    (error as { customData?: { details?: unknown } })?.customData?.details;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
};

const isAmbiguousFunctionError = (error: unknown) =>
  AMBIGUOUS_FUNCTION_CODES.has(
    String((error as { code?: unknown })?.code || "").toLowerCase(),
  );

const normalizeCommandError = (error: unknown): Error => {
  if (
    error instanceof StepUpReauthError ||
    error instanceof WestoryCommandError
  ) {
    return error;
  }
  const code = String((error as { code?: unknown })?.code || "").toLowerCase();
  const details = getFunctionErrorDetails(error);
  const reason = String(details.reason || details.code || "COMMAND_FAILED");
  const message = String(
    (error as { message?: unknown })?.message || "명령을 처리하지 못했습니다.",
  );
  if (code === "functions/unauthenticated") {
    return new WestoryCommandError("session-expired", message, {
      reason,
      originalError: error,
    });
  }
  if (code === "functions/permission-denied") {
    const state = reason.includes("SESSION")
      ? "session-expired"
      : "unauthorized";
    return new WestoryCommandError(state, message, {
      reason,
      originalError: error,
    });
  }
  if (code === "functions/aborted" || reason.includes("CONFLICT")) {
    return new WestoryCommandError("conflict", message, {
      reason,
      originalError: error,
    });
  }
  if (isAmbiguousFunctionError(error) || details.retryable === true) {
    return new WestoryCommandError("retryable", message, {
      retryable: true,
      reason,
      originalError: error,
    });
  }
  return new WestoryCommandError("failed", message, {
    reason,
    originalError: error,
  });
};

const digestText = async (value: string) => {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (item) =>
      item.toString(16).padStart(2, "0"),
    ).join("");
  }
  return createHighRiskCommandLockName(value).split(":").pop() || "unknown";
};

const getRetryStorageKey = async (logicalCommandKey: string) =>
  `westory:pending-command:v2:${await digestText(logicalCommandKey)}`;

const readPendingCommandHandle = async (logicalCommandKey: string) => {
  const inMemory = pendingCommandHandles.get(logicalCommandKey);
  if (inMemory) return inMemory;
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(
      await getRetryStorageKey(logicalCommandKey),
    );
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<PendingCommandHandle>;
    if (
      parsed.schemaVersion !== 2 ||
      typeof parsed.commandId !== "string" ||
      typeof parsed.ownerUid !== "string" ||
      typeof parsed.commandType !== "string"
    ) {
      return null;
    }
    const handle = parsed as PendingCommandHandle;
    pendingCommandHandles.set(logicalCommandKey, handle);
    return handle;
  } catch {
    return null;
  }
};

const rememberPendingCommandHandle = async (
  logicalCommandKey: string,
  handle: PendingCommandHandle,
) => {
  pendingCommandHandles.set(logicalCommandKey, handle);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      await getRetryStorageKey(logicalCommandKey),
      JSON.stringify(handle),
    );
  } catch {
    // In-memory reuse still protects retries in the current page.
  }
};

const forgetPendingCommandHandle = async (
  logicalCommandKey: string,
  commandId: string,
) => {
  if (pendingCommandHandles.get(logicalCommandKey)?.commandId === commandId) {
    pendingCommandHandles.delete(logicalCommandKey);
  }
  if (typeof window === "undefined") return;
  try {
    const storageKey = await getRetryStorageKey(logicalCommandKey);
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return;
    const parsed = JSON.parse(stored) as Partial<PendingCommandHandle>;
    if (parsed.commandId === commandId)
      window.localStorage.removeItem(storageKey);
  } catch {
    // A stale browser entry is safe: the server receipt still fences replay.
  }
};

const createPendingCommandHandle = async <CommandType extends W2CommandType>(
  commandType: CommandType,
  ownerUid: string,
  logicalCommandKey: string,
  commandId = createCommandId(),
): Promise<PendingCommandHandle> => {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    projectId: String(auth.app.options.projectId || ""),
    ownerUid,
    commandType,
    commandId,
    clientPayloadHash: await digestText(logicalCommandKey),
    requestedAtClient: now,
    lastKnownState: "pending",
    lastCheckedAtClient: now,
  };
};

const fetchCommandStatus = async <CommandType extends W2CommandType>(
  commandId: string,
  commandType: CommandType,
) => {
  const getStatus = await getHttpsCallable<
    GetCommandStatusRequest<CommandType>,
    CommandStatusResponse<W2CommandResults[CommandType], CommandType>
  >("getCommandStatus");
  const response = await getStatus({ commandId, commandType });
  return response.data;
};

const recoverCommittedCommand = async <CommandType extends W2CommandType>(
  commandId: string,
  commandType: CommandType,
) => {
  const status = await fetchCommandStatus(commandId, commandType);
  if (status.status === "SUCCEEDED") {
    return status as CommandGatewayResponse<
      W2CommandResults[CommandType],
      CommandType
    >;
  }
  if (status.status === "RECEIVED" || status.status === "RUNNING") {
    throw new WestoryCommandError("retryable", "명령을 처리하고 있습니다.", {
      retryable: true,
      reason: `COMMAND_${status.status}`,
    });
  }
  const retryable = Boolean(status.retryable || status.status === "NOT_FOUND");
  throw new WestoryCommandError(
    retryable ? "retryable" : "failed",
    status.error?.message || "명령 처리 결과를 아직 확인할 수 없습니다.",
    {
      retryable,
      reason: status.error?.reason || `COMMAND_${status.status}`,
    },
  );
};

export const executeWestoryCommand = async <CommandType extends W2CommandType>(
  commandType: CommandType,
  payload: W2CommandPayloads[CommandType],
  options: { commandId?: string } = {},
): Promise<
  CommandGatewayResponse<W2CommandResults[CommandType], CommandType>
> => {
  const ownerUid = auth.currentUser?.uid || "";
  if (!ownerUid) {
    throw new StepUpReauthError(
      "UNAUTHENTICATED",
      "로그인 사용자를 확인할 수 없어 작업을 실행하지 않았습니다.",
    );
  }
  const logicalCommandKey = createHighRiskCommandFlightKey(
    commandType,
    payload,
    ownerUid,
  );

  return runHighRiskCommandSingleFlight(
    commandType,
    payload,
    async () => {
      const storedHandle = await readPendingCommandHandle(logicalCommandKey);
      const handle =
        options.commandId && storedHandle?.commandId !== options.commandId
          ? await createPendingCommandHandle(
              commandType,
              ownerUid,
              logicalCommandKey,
              options.commandId,
            )
          : storedHandle ||
            (await createPendingCommandHandle(
              commandType,
              ownerUid,
              logicalCommandKey,
              options.commandId,
            ));
      await rememberPendingCommandHandle(logicalCommandKey, handle);

      try {
        await requestStepUpReauthentication(commandType);
        if (auth.currentUser?.uid !== ownerUid) {
          throw new StepUpReauthError(
            "IDENTITY_CHANGED",
            "로그인 사용자가 바뀌어 작업을 실행하지 않았습니다.",
          );
        }

        const execute = await getHttpsCallable<
          ExecuteCommandRequest<CommandType>,
          CommandGatewayResponse<W2CommandResults[CommandType], CommandType>
        >("executeCommand");
        try {
          const response = await execute({
            commandId: handle.commandId,
            commandType,
            payload,
          });
          await forgetPendingCommandHandle(logicalCommandKey, handle.commandId);
          return response.data;
        } catch (error) {
          if (!isAmbiguousFunctionError(error)) throw error;
          try {
            const recovered = await recoverCommittedCommand(
              handle.commandId,
              commandType,
            );
            await forgetPendingCommandHandle(
              logicalCommandKey,
              handle.commandId,
            );
            return recovered;
          } catch {
            // Preserve this handle so a later user-initiated retry cannot
            // duplicate a command whose commit result is still unknown.
            throw error;
          }
        }
      } catch (error) {
        if (!isAmbiguousFunctionError(error)) {
          await forgetPendingCommandHandle(logicalCommandKey, handle.commandId);
        }
        throw normalizeCommandError(error);
      }
    },
    ownerUid,
  );
};

export const getWestoryCommandStatus = async <
  CommandType extends W2CommandType,
>(
  commandId: string,
  commandType: CommandType,
) => {
  await requestStepUpReauthentication(commandType);
  return fetchCommandStatus(commandId, commandType);
};
