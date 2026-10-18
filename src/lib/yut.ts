import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { getSemesterDocPath, getYearSemester } from "./semesterScope";
import type { WeplayConfig } from "./weplay";
import type { YutRoom, YutRoute } from "../../functions/yutCore.mjs";

export type {
  YutRoom,
  YutPlayer,
  YutMove,
  YutRole,
  YutNode,
  YutRoute,
  YutEmoteKind,
} from "../../functions/yutCore.mjs";
export interface YutLobby {
  room: YutRoom | null;
  classes: { id: string; label: string }[];
  classId: string;
  serverNowMs: number;
}
export interface YutCommand {
  action:
    | "create"
    | "join"
    | "ready"
    | "start"
    | "throw"
    | "move"
    | "skip"
    | "leave"
    | "close"
    | "emote";
  requestKey: string;
  roomId?: string;
  expectedRevision?: number;
  code?: string;
  classId?: string;
  ready?: boolean;
  pieceId?: string;
  route?: YutRoute;
  kind?: "hello" | "nice" | "oops" | "wow" | "thanks" | "gg";
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
) =>
  onSnapshot(
    doc(db, getSemesterDocPath(config, "yut_rooms", roomId)),
    (snapshot) => {
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
    return "현재 학교와 학기의 게임 참여 권한을 확인해 주세요.";
  if (/aborted/.test(failure?.code || ""))
    return "방 상태가 바뀌었습니다. 새로 표시된 차례를 확인해 주세요.";
  return failure?.message && !/^(internal|INTERNAL)$/.test(failure.message)
    ? failure.message
    : "작업을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
