/** The local game uses the production rules but never the network service. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import {
  addYutEmote,
  getLegalYutMoves,
  throwYut,
  YUT_EMOTE_COOLDOWN_MS,
} from "../functions/yutCore.mjs";

const result = await build({
  entryPoints: ["src/lib/yutPreview.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "node20",
});
const source = result.outputFiles[0].text;
assert.ok(
  !source.includes("firebase"),
  "local game has no Firebase dependency",
);
const {
  createYutPreview,
  previewYutCommand,
  chooseYutBotMove,
  advanceYutPreviewBot,
  YUT_PREVIEW_UID,
} = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const randomFor = (seed) => {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};
const profiles = new Set();
assert.equal(
  createYutPreview({ mode: "single", playerName: "방재석(3학년 2반)" })
    .players[0].name,
  "방재석(3학년 2반)",
  "local student display uses the server-provided label",
);
assert.equal(
  createYutPreview().players[0].name,
  "나",
  "teacher preview keeps its default label",
);
const winners = new Set();
let played = 0;
let stackedMoves = 0;
for (let seed = 1; seed <= 60; seed++) {
  const playerCount = 2 + ((seed - 1) % 3);
  const random = randomFor(seed),
    start = 100000;
  let room = createYutPreview({
    mode: "single",
    playerCount,
    random,
    nowMs: start,
  });
  assert.equal(room.status, "playing");
  assert.equal(room.players.length, playerCount);
  assert.equal(room.turnUid, YUT_PREVIEW_UID);
  assert.equal(
    new Set(Object.values(room.localBotStrategies)).size,
    playerCount - 1,
  );
  assert.equal(room.blockedSeats.length, 4 - playerCount);
  profiles.add(JSON.stringify(room.localBotStrategies));
  assert.equal(
    advanceYutPreviewBot(room, random, start),
    room,
    "bots cannot act for the human",
  );
  assert.ok(
    room.players.every((player) => player.pieces.length === 2),
    "new game uses two pawns per player",
  );
  let actions = 0,
    actionTime = start;
  while (room.status === "playing" && actions < 1500) {
    ++actions;
    const nowMs = (actionTime = Math.max(
        actionTime + 25,
        (room.phaseStartsAtMs || 0) + 1,
      )),
      previous = JSON.stringify(room);
    if (room.turnUid === YUT_PREVIEW_UID) {
      if (room.phase === "throw")
        room = previewYutCommand(
          room,
          { action: "throw" },
          YUT_PREVIEW_UID,
          random,
          nowMs,
        );
      else {
        const move = chooseYutBotMove(room, random);
        assert.ok(move);
        assert.ok(
          getLegalYutMoves(room, room.turnUid).some(
            (candidate) =>
              candidate.pieceId === move.pieceId &&
              candidate.route === move.route,
          ),
        );
        room = previewYutCommand(
          room,
          { action: "move", ...move },
          YUT_PREVIEW_UID,
          random,
          nowMs,
        );
      }
    } else {
      const before = room;
      room = advanceYutPreviewBot(room, random, nowMs);
      assert.equal(
        JSON.stringify(before),
        previous,
        "bot does not mutate previous state",
      );
    }
    if (room.lastEvent.move?.stacked) stackedMoves++;
  }
  assert.equal(room.status, "finished", `seed ${seed} completes a full match`);
  assert.ok(
    room.players
      .find((player) => player.uid === room.winnerUid)
      .pieces.every((piece) => piece.node === "finish"),
  );
  assert.equal(
    Object.keys(room.localBotStrategies).length,
    playerCount - 1,
    "strategy metadata survives rules transitions",
  );
  winners.add(room.winnerUid);
  played += actions;
}
assert.ok(profiles.size > 1, "strategy assignments vary across games");
assert.ok(winners.size > 1, "different opponents can win");
assert.ok(
  stackedMoves > 0,
  "bot strategies explicitly choose stacking in actual matches",
);
const preview = createYutPreview({
  mode: "preview",
  random: randomFor(88),
  nowMs: 500000,
});
assert.equal(preview.status, "waiting");
assert.equal(
  previewYutCommand(
    preview,
    { action: "start" },
    YUT_PREVIEW_UID,
    Math.random,
    500001,
  ).status,
  "playing",
);
const emote = addYutEmote(
  preview,
  YUT_PREVIEW_UID,
  "hello",
  "local_emote_123456",
  500010,
);
assert.equal(emote.revision, preview.revision);
assert.equal(emote.turnDeadlineMs, preview.turnDeadlineMs);
assert.equal(emote.phase, preview.phase);
assert.equal(emote.syncRevision, preview.syncRevision + 1);
assert.throws(() =>
  addYutEmote(emote, YUT_PREVIEW_UID, "nice", "local_emote_654321", 500011),
);
assert.equal(
  addYutEmote(
    emote,
    YUT_PREVIEW_UID,
    "nice",
    "local_emote_654321",
    500010 + YUT_EMOTE_COOLDOWN_MS,
  ).emotes[YUT_PREVIEW_UID].kind,
  "nice",
);
console.log(
  `PASS: 60 complete 2/3/4-player single games / ${played} legal actions; varied bot strategies and winners; teacher waiting preview; immutable bot state; local emote cooldown without game revision changes; no Firebase dependency.`,
);

const powerRoom = createYutPreview({
  mode: "single",
  random: randomFor(901),
  nowMs: 600000,
});
const low = previewYutCommand(
  powerRoom,
  { action: "throw", power: 0.12 },
  YUT_PREVIEW_UID,
  () => 0.5,
  powerRoom.phaseStartsAtMs + 1,
);
const high = previewYutCommand(
  powerRoom,
  { action: "throw", power: 1 },
  YUT_PREVIEW_UID,
  () => 0.5,
  powerRoom.phaseStartsAtMs + 1,
);
assert.equal(low.pendingThrow.value, 2);
assert.equal(high.pendingThrow.value, 4);
assert.equal(low.pendingThrow.sticks.filter(Boolean).length, 2);
assert.equal(high.pendingThrow.sticks.filter(Boolean).length, 4);
assert.equal(low.players[0].lastThrow.power, 0.12);
assert.equal(high.players[0].lastThrow.power, 1);
assert.equal(
  addYutEmote(preview, YUT_PREVIEW_UID, "angry", "local_angry_123456", 500020)
    .emotes[YUT_PREVIEW_UID].kind,
  "angry",
);
console.log(
  "PASS: power uses shared weighted outcomes and exact result faces; seventh angry emote.",
);

for (const [node, lane, value, completedFirst, stacked] of [
  ["o19", "outer", 1, false, false],
  ["o18", "outer", 5, false, false],
  ["b5", "b", 1, false, false],
  ["o19", "outer", 1, true, false],
  ["o19", "outer", 1, false, true],
]) {
  const fixture = createYutPreview({ mode: "single", playerCount: 2, nowMs: 700000, random: randomFor(1) });
  const own = fixture.players[0].pieces;
  Object.assign(own[completedFirst ? 1 : 0], { node, lane });
  if (completedFirst) own[0].node = "finish";
  if (stacked) own.forEach((piece) => Object.assign(piece, { node, lane, stackId: "finish-pair" }));
  const before = JSON.stringify(fixture);
  const rolled = throwYut(fixture, YUT_PREVIEW_UID, Array.from({ length: 4 }, (_, index) => value !== 5 && index < value), fixture.phaseStartsAtMs + 1);
  const legal = getLegalYutMoves(rolled, YUT_PREVIEW_UID);
  const finish = legal.find((move) => move.pieceId === (completedFirst ? "2" : "1") && move.targetNode === "finish");
  assert.ok(finish, `${node} + ${value} produces a local finish move`);
  assert.equal(finish.canStack, false, "the arrival pad never opens a stack choice");
  const result = previewYutCommand(rolled, { action: "move", ...finish }, YUT_PREVIEW_UID, randomFor(2), rolled.phaseStartsAtMs + 1);
  assert.equal(JSON.stringify(fixture), before, "local completion keeps the source room immutable");
  assert.equal(result.players[0].pieces[completedFirst ? 1 : 0].node, "finish");
  assert.equal(result.lastEvent.move.path.at(-1), "finish");
  assert.equal(result.status, completedFirst || stacked ? "finished" : "playing");
  if (completedFirst || stacked) assert.ok(result.players[0].pieces.every((piece) => piece.node === "finish" && !piece.stackId));
  assert.ok(!getLegalYutMoves(result, YUT_PREVIEW_UID).some((move) => result.players[0].pieces.find((piece) => piece.id === move.pieceId).node === "finish"));
}
console.log("PASS: local exact arrival, overshoot and diagonal completion; first completion preserves the match, the remaining pawn and carried pair finish with shared production rules.");
