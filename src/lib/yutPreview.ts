import {
  addYutPlayer,
  createYutRoom,
  getLegalYutMoves,
  moveYut,
  readyYutPlayer,
  skipYutTurn,
  startYutGame,
  throwYut,
  type YutRoom,
} from "../../functions/yutCore.mjs";
import type { YutCommand } from "./yut";

export const YUT_PREVIEW_UID = "yut-preview-player";
export function createYutPreview(): YutRoom {
  const nowMs = Date.now();
  let room = createYutRoom({
    id: "local-preview",
    code: "체험",
    classId: "preview",
    classLabel: "혼자 연습",
    host: { uid: YUT_PREVIEW_UID, name: "나" },
    nowMs,
  });
  ["벼리", "두루", "마루"].forEach((name, index) => {
    const uid = `yut-preview-bot-${index}`;
    room = addYutPlayer(room, { uid, name }, nowMs);
    room = readyYutPlayer(room, uid, true, nowMs);
  });
  return room;
}
export function previewYutCommand(
  room: YutRoom,
  data: Pick<YutCommand, "action" | "pieceId" | "route">,
  uid = YUT_PREVIEW_UID,
): YutRoom {
  const nowMs = Date.now();
  if (data.action === "start") return startYutGame(room, nowMs);
  if (data.action === "throw")
    return throwYut(
      room,
      uid,
      Array.from({ length: 4 }, () => Math.random() < 0.5),
      nowMs,
    );
  if (data.action === "move" && data.pieceId && data.route)
    return moveYut(room, uid, data.pieceId, data.route, nowMs);
  if (data.action === "skip") return skipYutTurn(room, nowMs);
  throw new Error("체험 화면에서 사용할 수 없는 동작입니다.");
}
export function advanceYutPreviewBot(room: YutRoom): YutRoom {
  if (
    room.status !== "playing" ||
    !room.turnUid ||
    room.turnUid === YUT_PREVIEW_UID
  )
    return room;
  if (Date.now() >= room.turnDeadlineMs) return skipYutTurn(room, Date.now());
  if (room.phase === "throw")
    return previewYutCommand(room, { action: "throw" }, room.turnUid);
  const moves = getLegalYutMoves(room, room.turnUid);
  // Prefer a finish or shortcut, otherwise advance the leading piece.
  const move =
    moves.find((item) => item.targetNode === "finish") ||
    moves.find((item) => item.route !== "outer") ||
    moves[0];
  return move
    ? previewYutCommand(room, { action: "move", ...move }, room.turnUid)
    : room;
}
