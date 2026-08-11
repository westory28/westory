import { auth, getHttpsCallable } from "./firebase";
import {
  createHighRiskCommandFlightKey,
  createHighRiskCommandLockName,
  requestStepUpReauthentication,
  runHighRiskCommandSingleFlight,
  StepUpReauthError,
} from "./stepUpReauth";

export type W2ACommandType =
  | "updateTermsSettings"
  | "addConsentItem"
  | "syncKoreanPublicHolidays";

export interface CommandGatewayResponse<Result = unknown> {
  commandId: string;
  commandType: W2ACommandType;
  status: "SUCCEEDED";
  replayed: boolean;
  result: Result;
}

interface CommandStatusResponse<Result = unknown> {
  commandId: string;
  commandType: W2ACommandType;
  status: "SUCCEEDED" | "NOT_FOUND";
  replayed: boolean;
  result: Result | null;
}

interface ExecuteCommandRequest {
  commandId: string;
  commandType: W2ACommandType;
  payload: unknown;
}

interface GetCommandStatusRequest {
  commandId: string;
  commandType: W2ACommandType;
}

const AMBIGUOUS_FUNCTION_CODES = new Set([
  "functions/cancelled",
  "functions/deadline-exceeded",
  "functions/internal",
  "functions/unknown",
  "functions/unavailable",
]);
const pendingCommandIds = new Map<string, string>();

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

const isAmbiguousFunctionError = (error: unknown) =>
  AMBIGUOUS_FUNCTION_CODES.has(
    String((error as { code?: unknown })?.code || "").toLowerCase(),
  );

const getRetryStorageKey = async (logicalCommandKey: string) => {
  const prefix = "westory:pending-command:v1:";
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const bytes = new TextEncoder().encode(logicalCommandKey);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    return `${prefix}${hash}`;
  }
  return `${prefix}${createHighRiskCommandLockName(logicalCommandKey).split(":").pop()}`;
};

const readPendingCommandId = async (logicalCommandKey: string) => {
  const inMemory = pendingCommandIds.get(logicalCommandKey);
  if (inMemory) return inMemory;
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(
      await getRetryStorageKey(logicalCommandKey),
    );
    if (!stored) return null;
    pendingCommandIds.set(logicalCommandKey, stored);
    return stored;
  } catch {
    return null;
  }
};

const rememberPendingCommandId = async (
  logicalCommandKey: string,
  commandId: string,
) => {
  pendingCommandIds.set(logicalCommandKey, commandId);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      await getRetryStorageKey(logicalCommandKey),
      commandId,
    );
  } catch {
    // In-memory reuse still protects retries in the current page.
  }
};

const forgetPendingCommandId = async (
  logicalCommandKey: string,
  commandId: string,
) => {
  if (pendingCommandIds.get(logicalCommandKey) === commandId) {
    pendingCommandIds.delete(logicalCommandKey);
  }
  if (typeof window === "undefined") return;
  try {
    const storageKey = await getRetryStorageKey(logicalCommandKey);
    if (window.localStorage.getItem(storageKey) === commandId) {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // A stale browser entry is safe: the server receipt still fences replay.
  }
};

const recoverCommittedCommand = async <Result>(
  commandId: string,
  commandType: W2ACommandType,
) => {
  const getStatus = await getHttpsCallable<
    GetCommandStatusRequest,
    CommandStatusResponse<Result>
  >("getCommandStatus");
  const response = await getStatus({ commandId, commandType });
  if (response.data.status !== "SUCCEEDED") {
    throw new Error("명령 처리 결과를 아직 확인할 수 없습니다.");
  }
  return response.data as CommandGatewayResponse<Result>;
};

export const executeWestoryCommand = async <Result = unknown>(
  commandType: W2ACommandType,
  payload: unknown,
  options: { commandId?: string } = {},
): Promise<CommandGatewayResponse<Result>> => {
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
  const commandId =
    options.commandId ||
    (await readPendingCommandId(logicalCommandKey)) ||
    createCommandId();

  return runHighRiskCommandSingleFlight(
    commandType,
    { commandId, payload },
    async () => {
      await requestStepUpReauthentication(commandType);
      if (auth.currentUser?.uid !== ownerUid) {
        throw new StepUpReauthError(
          "IDENTITY_CHANGED",
          "로그인 사용자가 바뀌어 작업을 실행하지 않았습니다.",
        );
      }

      const execute = await getHttpsCallable<
        ExecuteCommandRequest,
        CommandGatewayResponse<Result>
      >("executeCommand");
      await rememberPendingCommandId(logicalCommandKey, commandId);
      try {
        const response = await execute({ commandId, commandType, payload });
        await forgetPendingCommandId(logicalCommandKey, commandId);
        return response.data;
      } catch (error) {
        if (!isAmbiguousFunctionError(error)) {
          await forgetPendingCommandId(logicalCommandKey, commandId);
          throw error;
        }
        try {
          const recovered = await recoverCommittedCommand<Result>(
            commandId,
            commandType,
          );
          await forgetPendingCommandId(logicalCommandKey, commandId);
          return recovered;
        } catch {
          // Preserve this ID so a later user-initiated retry cannot duplicate
          // a command whose commit result is still unknown.
          throw error;
        }
      }
    },
    ownerUid,
  );
};

export const getWestoryCommandStatus = <Result = unknown>(
  commandId: string,
  commandType: W2ACommandType,
) => recoverCommittedCommand<Result>(commandId, commandType);
