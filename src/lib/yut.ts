import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { getSemesterDocPath, getYearSemester } from "./semesterScope";
import type { WeplayConfig } from "./weplay";
import type { YutRoom, YutRoute } from "../../functions/yutCore.mjs";
export { getYutThrowProbabilities } from "../../functions/yutCore.mjs";

export type {
  YutRoom,
  YutPlayer,
  YutPiece,
  YutMove,
  YutRole,
  YutNode,
  YutRoute,
  YutEmoteKind,
} from "../../functions/yutCore.mjs";
export interface YutLobby {
  enabled: boolean;
  playerName?: string;
  settings?: YutSettings;
  privatePlaysRemaining?: number | null;
  room: YutRoom | null;
  classes: { id: string; label: string }[];
  classId: string;
  serverNowMs: number;
}
export interface YutLobbySnapshot {
  scope: string;
  data: YutLobby;
  sentAtMs: number;
  receivedAtMs: number;
}
export interface YutSettings {
  enabled: boolean;
  version: number;
  allowSolo: boolean;
  allowMultiplayer: boolean;
  allowPrivateRooms: boolean;
  defaultPlayerCount: 2 | 3 | 4;
  throwSeconds: number;
  moveSeconds: number;
  updatedAtMs?: number;
}
export const YUT_PRIVATE_DAILY_LIMIT = 5;
export const DEFAULT_YUT_SETTINGS: Readonly<YutSettings> = {
  enabled: false,
  version: 0,
  allowSolo: true,
  allowMultiplayer: true,
  allowPrivateRooms: true,
  defaultPlayerCount: 4,
  throwSeconds: 5,
  moveSeconds: 25,
};
export function normalizeYutSettings(
  value?: Partial<YutSettings> | null,
): YutSettings {
  const validVersion =
    Number.isInteger(value?.version) && Number(value?.version) >= 0;
  const seconds = (
    input: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
  ) =>
    Number.isInteger(input) &&
    Number(input) >= minimum &&
    Number(input) <= maximum
      ? Number(input)
      : fallback;
  return {
    enabled: validVersion && value?.enabled === true,
    version: validVersion ? Number(value?.version) : 0,
    allowSolo: value?.allowSolo !== false,
    allowMultiplayer: value?.allowMultiplayer !== false,
    allowPrivateRooms: value?.allowPrivateRooms !== false,
    defaultPlayerCount:
      value?.defaultPlayerCount === 2 || value?.defaultPlayerCount === 3
        ? value.defaultPlayerCount
        : 4,
    throwSeconds: seconds(value?.throwSeconds, 5, 3, 15),
    moveSeconds: seconds(value?.moveSeconds, 25, 15, 60),
    ...(Number.isFinite(value?.updatedAtMs)
      ? { updatedAtMs: value?.updatedAtMs }
      : {}),
  };
}
export type YutSettingsUpdate = Pick<YutSettings, "enabled"> &
  Partial<
    Pick<
      YutSettings,
      | "allowSolo"
      | "allowMultiplayer"
      | "allowPrivateRooms"
      | "defaultPlayerCount"
      | "throwSeconds"
      | "moveSeconds"
    >
  > & { expectedVersion: number };
export interface YutManagedRoom {
  id: string;
  code: string;
  status: "waiting" | "playing";
  revision: number;
  hostUid: string;
  createdAtMs: number;
  expiresAtMs: number;
  turnUid: string | null;
  visibility?: "public" | "private";
  maxPlayers?: 2 | 3 | 4;
  pieceCount?: number;
  throwSeconds?: number;
  moveSeconds?: number;
  phaseStartsAtMs?: number;
  turnDeadlineMs?: number;
  phase?: "throw" | "move";
  standings?: {
    uid: string;
    finishedPieces: number;
    totalPieces: number;
    // Display-only: negative remaining shortest-path steps; higher is ahead.
    progress: number;
  }[];
  leadingUids?: string[];
  players: {
    uid: string;
    name: string;
    role: string;
    classLabel: string;
    studentNumber: string | number;
    active: boolean;
  }[];
}
export interface YutManagement {
  settings: YutSettings;
  rooms: YutManagedRoom[];
  truncated: boolean;
  serverNowMs: number;
}
export interface YutCommand {
  action:
    | "create"
    | "match"
    | "join"
    | "ready"
    | "start"
    | "throw"
    | "move"
    | "skip"
    | "leave"
    | "close"
    | "claimReward"
    | "seat"
    | "emote";
  requestKey: string;
  roomId?: string;
  expectedRevision?: number;
  code?: string;
  classId?: string;
  visibility?: "public" | "private";
  maxPlayers?: 2 | 3 | 4;
  ready?: boolean;
  pieceId?: string;
  route?: YutRoute;
  stack?: boolean;
  seat?: number;
  blocked?: boolean;
  power?: number;
  kind?: "hello" | "nice" | "oops" | "wow" | "thanks" | "gg" | "angry";
}
async function call<T>(
  name: string,
  config: WeplayConfig,
  data: object = {},
): Promise<T> {
  if (!config?.year || !config?.semester)
    throw new Error("현재 학기를 확인하지 못했습니다. 새로고침해 주세요.");
  const fn = await getHistoryDictionaryCallable<object, T>(name, {
    reuseSessionProof: true,
  });
  return (await fn({ ...getYearSemester(config), ...data })).data;
}
export const getYutLobby = (config: WeplayConfig) =>
  call<YutLobby>("getYutLobby", config);
export const getYutManagement = (config: WeplayConfig) =>
  call<YutManagement>("getYutManagement", config).then((response) => ({
    ...response,
    settings: normalizeYutSettings(response.settings),
  }));
export const saveYutSettings = (
  config: WeplayConfig,
  data: YutSettingsUpdate,
) =>
  call<{ settings: YutSettings; serverNowMs: number }>(
    "saveYutSettings",
    config,
    data,
  ).then((response) => ({
    ...response,
    settings: normalizeYutSettings(response.settings),
  }));
export const commandYutRoom = (config: WeplayConfig, data: YutCommand) =>
  call<{ room: YutRoom | null; serverNowMs: number }>(
    "commandYutRoom",
    config,
    data,
  );
export const subscribeYutRoom = (
  config: WeplayConfig,
  roomId: string,
  onRoom: (room: YutRoom | null) => void,
  onError: (error: unknown) => void,
  onConnectionChange?: (connected: boolean) => void,
) =>
  onSnapshot(
    doc(db, getSemesterDocPath(config, "yut_rooms", roomId)),
    { includeMetadataChanges: true },
    (snapshot) => {
      // Cached data does not establish current participation or server state.
      // Metadata changes deliver the server confirmation even if data is equal.
      onConnectionChange?.(!snapshot.metadata.fromCache);
      if (snapshot.metadata.fromCache) return;
      onRoom(
        snapshot.exists()
          ? ({ ...snapshot.data(), id: snapshot.id } as YutRoom)
          : null,
      );
    },
    onError,
  );

export function yutErrorMessage(error: unknown): string {
  const failure = error as { code?: string; message?: string };
  if (/unauthenticated/.test(failure?.code || ""))
    return "로그인 상태를 확인한 뒤 다시 들어와 주세요.";
  if (/unavailable|deadline|network/.test(failure?.code || ""))
    return "연결이 원활하지 않습니다. 방 상태를 확인한 뒤 다시 시도해 주세요.";
  if (/permission-denied/.test(failure?.code || ""))
    return failure.code?.startsWith("functions/") &&
      failure.message &&
      !/permission|insufficient/i.test(failure.message)
      ? failure.message
      : "방에 연결할 수 없습니다. 방 상태를 다시 확인해 주세요.";
  if (/aborted/.test(failure?.code || ""))
    return "방 상태가 바뀌었습니다. 새로 표시된 차례를 확인해 주세요.";
  return failure?.message && !/^(internal|INTERNAL)$/.test(failure.message)
    ? failure.message
    : "작업을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
