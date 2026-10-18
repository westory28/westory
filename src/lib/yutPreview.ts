import {
  addYutPlayer,
  createYutRoom,
  getLegalYutMoves,
  moveYut,
  readyYutPlayer,
  skipYutTurn,
  startYutGame,
  throwYut,
  setYutSeat,
  type YutRoom,
  type YutMove,
} from "../../functions/yutCore.mjs";
import type { YutCommand } from "./yut";

export const YUT_PREVIEW_UID = "yut-preview-player";
export type YutLocalMode = "single" | "preview";
type BotStrategy = "capture" | "race" | "stack";
type LocalRoom = YutRoom & { localBotStrategies?: Record<string, BotStrategy> };

export function createYutPreview(
  options: {
    mode?: YutLocalMode;
    playerCount?: 2 | 3 | 4;
    random?: () => number;
    nowMs?: number;
    throwSeconds?: number;
    moveSeconds?: number;
  } = {},
): YutRoom {
  const random = options.random || Math.random;
  const nowMs = options.nowMs ?? Date.now();
  const single = options.mode === "single";
  const playerCount = options.playerCount ?? 4;
  let room: LocalRoom = createYutRoom({
    id: `local-${single ? "single" : "preview"}-${nowMs}-${Math.floor(random() * 1e6)}`,
    code: single ? "싱글" : "체험",
    classId: "",
    classLabel: single ? "싱글 모드" : "교사 체험",
    host: { uid: YUT_PREVIEW_UID, name: "나" },
    nowMs,
    maxPlayers: playerCount,
    visibility: "private",
    throwSeconds: options.throwSeconds,
    moveSeconds: options.moveSeconds,
  });
  const strategies: BotStrategy[] = ["capture", "race", "stack"];
  for (let index = strategies.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [strategies[index], strategies[swap]] = [
      strategies[swap],
      strategies[index],
    ];
  }
  room.localBotStrategies = {};
  ["우가", "저가", "구가"].slice(0, playerCount - 1).forEach((name, index) => {
    const uid = `yut-preview-bot-${index}`;
    room = addYutPlayer(room, { uid, name }, nowMs);
    room = readyYutPlayer(room, uid, true, nowMs);
    room.localBotStrategies![uid] = strategies[index];
  });
  for (let seat = playerCount; seat < 4; seat++)
    room = setYutSeat(room, YUT_PREVIEW_UID, seat, true, nowMs);
  return single ? startYutGame(room, nowMs) : room;
}

export function previewYutCommand(
  room: YutRoom,
  data: Pick<
    YutCommand,
    "action" | "pieceId" | "route" | "power" | "seat" | "blocked"
  >,
  uid = YUT_PREVIEW_UID,
  random = Math.random,
  nowMs = Date.now(),
): YutRoom {
  if (data.action === "start") return startYutGame(room, nowMs);
  if (data.action === "throw")
    return throwYut(
      room,
      uid,
      Array.from({ length: 4 }, () => random() < 0.5),
      nowMs,
      data.power ?? 0.65,
    );
  if (data.action === "move" && data.pieceId && data.route)
    return moveYut(room, uid, data.pieceId, data.route, nowMs);
  if (data.action === "skip") return skipYutTurn(room, nowMs);
  if (
    data.action === "seat" &&
    data.seat !== undefined &&
    data.blocked !== undefined
  )
    return setYutSeat(room, uid, data.seat, data.blocked, nowMs);
  throw new Error("현재 화면에서 사용할 수 없는 동작입니다.");
}

/** Bots have a different preference each game; legal moves and win conditions stay shared. */
export function chooseYutBotMove(
  room: YutRoom,
  random = Math.random,
): YutMove | null {
  if (!room.turnUid) return null;
  const moves = getLegalYutMoves(room, room.turnUid);
  if (!moves.length) return null;
  const strategy =
    (room as LocalRoom).localBotStrategies?.[room.turnUid] || "race";
  const player = room.players.find((entry) => entry.uid === room.turnUid)!;
  const scored = moves.map((move) => {
    const captured = room.players
      .filter((entry) => entry.active && entry.uid !== room.turnUid)
      .reduce(
        (total, entry) =>
          total +
          entry.pieces.filter(
            (piece) =>
              piece.node === move.targetNode &&
              !["home", "finish"].includes(piece.node),
          ).length,
        0,
      );
    const stacks = player.pieces.filter(
      (piece) =>
        piece.id !== move.pieceId &&
        piece.node === move.targetNode &&
        !["home", "finish"].includes(piece.node),
    ).length;
    const progress =
      move.targetNode === "finish"
        ? 30
        : move.targetNode.startsWith("o")
          ? Number(move.targetNode.slice(1))
          : move.route === "b"
            ? 20
            : 15;
    const score =
      (move.targetNode === "finish" ? 100 : 0) +
      captured * (strategy === "capture" ? 30 : 12) +
      stacks * (strategy === "stack" ? 24 : 8) +
      progress * (strategy === "race" ? 1.8 : 0.8) +
      random() * 14;
    return { move, score };
  });
  scored.sort((a, b) => b.score - a.score);
  // A little unpredictability keeps three opponents from following one fixed script.
  return random() < 0.14
    ? moves[Math.floor(random() * moves.length)]
    : scored[0].move;
}

export function advanceYutPreviewBot(
  room: YutRoom,
  random = Math.random,
  nowMs = Date.now(),
): YutRoom {
  if (
    room.status !== "playing" ||
    !room.turnUid ||
    room.turnUid === YUT_PREVIEW_UID
  )
    return room;
  if (nowMs < (room.phaseStartsAtMs || 0)) return room;
  if (nowMs >= room.turnDeadlineMs) return skipYutTurn(room, nowMs);
  if (room.phase === "throw")
    return previewYutCommand(
      room,
      { action: "throw" },
      room.turnUid,
      random,
      nowMs,
    );
  const move = chooseYutBotMove(room, random);
  return move
    ? previewYutCommand(
        room,
        { action: "move", ...move },
        room.turnUid,
        random,
        nowMs,
      )
    : room;
}
