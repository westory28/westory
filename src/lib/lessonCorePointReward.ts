import type { SystemConfig } from "../types";
import { auth, getHttpsCallable } from "./firebase";
import { getYearSemester } from "./semesterScope";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;
type LessonCorePointCommandType =
  | "recordLessonCorePointFind"
  | "claimLessonCorePointReward";

interface LessonCorePointCommandResponse<Result> {
  commandId: string;
  commandType: LessonCorePointCommandType;
  status: "SUCCEEDED";
  replayed: boolean;
  result: Result;
}

export interface LessonCorePointFindResult {
  unitId: string;
  corePointId: string;
  duplicate: boolean;
  foundCount: number;
  totalCount: number;
  progressRevision: number;
  settled: true;
}

export interface LessonCorePointRewardResult {
  awarded: boolean;
  duplicate: boolean;
  settled: true;
  amount: number;
  totalAwarded: number;
  balance: number;
  accountRevision: number;
  ledgerEntryId: string;
  sourceId: string;
  blockedMessage: string;
  corePointTotalCount: number;
  corePointFoundCount: number;
  corePointRemainingCount: number;
}

interface PendingLessonCommand {
  ownerUid: string;
  commandType: LessonCorePointCommandType;
  commandId: string;
}

const pendingCommands = new Map<string, PendingLessonCommand>();
const AMBIGUOUS_FUNCTION_CODES = new Set([
  "functions/cancelled",
  "functions/deadline-exceeded",
  "functions/internal",
  "functions/unknown",
  "functions/unavailable",
]);

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

const digest = async (value: string) => {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), (item) =>
      item.toString(16).padStart(2, "0"),
    ).join("");
  }
  return encodeURIComponent(value).slice(0, 180);
};

const storageKey = async (logicalKey: string) =>
  `westory:lesson-core-point-command:v1:${await digest(logicalKey)}`;

const readPending = async (logicalKey: string) => {
  const memory = pendingCommands.get(logicalKey);
  if (memory) return memory;
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(await storageKey(logicalKey));
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<PendingLessonCommand>;
    if (!parsed.ownerUid || !parsed.commandId || !parsed.commandType) {
      return null;
    }
    const handle = parsed as PendingLessonCommand;
    pendingCommands.set(logicalKey, handle);
    return handle;
  } catch {
    return null;
  }
};

const rememberPending = async (
  logicalKey: string,
  handle: PendingLessonCommand,
) => {
  pendingCommands.set(logicalKey, handle);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      await storageKey(logicalKey),
      JSON.stringify(handle),
    );
  } catch {
    // The in-memory handle still fences retries in this page.
  }
};

const forgetPending = async (logicalKey: string, commandId: string) => {
  if (pendingCommands.get(logicalKey)?.commandId === commandId) {
    pendingCommands.delete(logicalKey);
  }
  if (typeof window === "undefined") return;
  try {
    const key = await storageKey(logicalKey);
    const stored = window.localStorage.getItem(key);
    if (!stored) return;
    const parsed = JSON.parse(stored) as Partial<PendingLessonCommand>;
    if (parsed.commandId === commandId) window.localStorage.removeItem(key);
  } catch {
    // A stale handle is safe because the server receipt and source ledger fence replay.
  }
};

const isAmbiguous = (error: unknown) =>
  AMBIGUOUS_FUNCTION_CODES.has(
    String((error as { code?: unknown })?.code || "").toLowerCase(),
  );

const executeLessonCorePointCommand = async <Result>(options: {
  commandType: LessonCorePointCommandType;
  payload: Record<string, string>;
  logicalSource: string;
}): Promise<LessonCorePointCommandResponse<Result>> => {
  const ownerUid = auth.currentUser?.uid || "";
  if (!ownerUid) {
    throw new Error("로그인 상태를 확인할 수 없어 작업을 실행하지 않았습니다.");
  }
  const logicalKey = [
    ownerUid,
    options.commandType,
    options.logicalSource,
  ].join(":");
  const stored = await readPending(logicalKey);
  const handle =
    stored?.ownerUid === ownerUid && stored.commandType === options.commandType
      ? stored
      : {
          ownerUid,
          commandType: options.commandType,
          commandId: createCommandId(),
        };
  await rememberPending(logicalKey, handle);
  const callable = await getHttpsCallable<
    {
      commandId: string;
      commandType: LessonCorePointCommandType;
      payload: Record<string, string>;
    },
    LessonCorePointCommandResponse<Result>
  >("executeLessonCorePointCommand", { expectedUid: ownerUid });
  try {
    if (auth.currentUser?.uid !== ownerUid) {
      throw new Error("로그인 사용자가 바뀌어 작업을 실행하지 않았습니다.");
    }
    const response = await callable({
      commandId: handle.commandId,
      commandType: options.commandType,
      payload: options.payload,
    });
    if (auth.currentUser?.uid !== ownerUid) {
      throw new Error(
        "로그인 사용자가 바뀌어 이전 작업의 표시를 중단했습니다.",
      );
    }
    await forgetPending(logicalKey, handle.commandId);
    if (auth.currentUser?.uid !== ownerUid) {
      throw new Error(
        "로그인 사용자가 바뀌어 이전 작업의 표시를 중단했습니다.",
      );
    }
    return response.data;
  } catch (error) {
    if (auth.currentUser?.uid === ownerUid && !isAmbiguous(error)) {
      await forgetPending(logicalKey, handle.commandId);
    }
    throw error;
  }
};

export const recordLessonCorePointFind = async (options: {
  config: ConfigLike;
  unitId: string;
  corePointId: string;
}) => {
  const { year, semester } = getYearSemester(options.config);
  return executeLessonCorePointCommand<LessonCorePointFindResult>({
    commandType: "recordLessonCorePointFind",
    payload: {
      year: String(year),
      semester: String(semester),
      unitId: String(options.unitId || "").trim(),
      corePointId: String(options.corePointId || "").trim(),
    },
    logicalSource: `${year}:${semester}:${options.unitId}:${options.corePointId}`,
  });
};

export const claimLessonCorePointReward = async (config: ConfigLike) => {
  const { year, semester } = getYearSemester(config);
  return executeLessonCorePointCommand<LessonCorePointRewardResult>({
    commandType: "claimLessonCorePointReward",
    payload: {
      year: String(year),
      semester: String(semester),
    },
    logicalSource: `${year}:${semester}:lesson-core-points-all`,
  });
};
