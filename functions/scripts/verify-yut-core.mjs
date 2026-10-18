import test from 'node:test';
import assert from 'node:assert/strict';
import { createYutRoom, addYutPlayer, readyYutPlayer, startYutGame, throwYut, moveYut as coreMoveYut, getLegalYutMoves, skipYutTurn, leaveYutRoom, closeYutRoom, addYutEmote, setYutSeat, YUT_EMOTE_KINDS, YUT_EMOTE_COOLDOWN_MS, YUT_EMOTE_VISIBLE_MS } from '../yutCore.mjs';
const now = 10000;
function game(count = 2, pieces = 1) {
  let room = createYutRoom({ id: 'room', code: 'ABC234', classId: 'class', classLabel: '1학년 1반', host: { uid: 'a', name: '가' }, nowMs: now });
  for (let index = 1; index < count; index += 1) {
    const uid = String.fromCharCode(97 + index);
    room = readyYutPlayer(addYutPlayer(room, { uid, name: uid }, now), uid, true, now);
  }
  if (pieces === 2) {
    delete room.pieceCount;
    for (const player of room.players) player.pieces.push({ id: '2', node: 'home', lane: 'outer' });
  }
  return startYutGame(room, now - 2000);
}
const roll = (room, value) => throwYut(room, room.turnUid, Array.from({ length: 4 }, (_, index) => index < (value === 5 ? 0 : value)), Math.max(now + 1, room.phaseStartsAtMs || 0));
const moveYut = (room, uid, piece, route, atMs) => coreMoveYut(room, uid, piece, route, Math.max(atMs, room.phaseStartsAtMs || 0));
test('new matches use one piece and independent 5-second throw / 25-second move deadlines after animations', () => {
  let room = game();
  assert.equal(room.players.every((player) => player.pieces.length === 1), true);
  assert.equal(room.turnDeadlineMs - room.phaseStartsAtMs, 5000);
  assert.throws(() => throwYut(room, 'a', [true, false, false, false], room.phaseStartsAtMs - 1));
  assert.throws(() => skipYutTurn(room, room.turnDeadlineMs - 1));
  assert.equal(skipYutTurn(room, room.turnDeadlineMs).turnUid, 'b');
  const throwAt = room.phaseStartsAtMs + 4999;
  room = throwYut(room, 'a', [true, false, false, false], throwAt);
  assert.equal(room.phaseStartsAtMs, throwAt + 3600);
  assert.equal(room.turnDeadlineMs, room.phaseStartsAtMs + 25000);
  assert.throws(() => coreMoveYut(room, 'a', '1', 'outer', room.phaseStartsAtMs - 1));
  const moveAt = room.phaseStartsAtMs;
  room = coreMoveYut(room, 'a', '1', 'outer', moveAt);
  assert.equal(room.phaseStartsAtMs, moveAt + 1500);
  assert.equal(room.turnDeadlineMs, moveAt + 1500 + 5000);
  assert.deepEqual(room.lastEvent.move, { uid: 'a', pieceId: '1', route: 'outer', path: ['o1'], capturedUids: [] });
});
test('host controls empty waiting seats; role seats stay fixed through leave and rejoin', () => {
  const original = createYutRoom({ id: 'r', code: 'ABC234', classId: '', classLabel: '', host: { uid: 'a', name: 'a' }, nowMs: now });
  assert.throws(() => setYutSeat(original, 'b', 1, true, now));
  assert.throws(() => setYutSeat(original, 'a', 0, true, now));
  assert.throws(() => setYutSeat(original, 'a', 4, true, now));
  let room = setYutSeat(setYutSeat(original, 'a', 1, true, now), 'a', 3, true, now);
  assert.deepEqual(original.blockedSeats, []);
  assert.throws(() => setYutSeat(room, 'a', 2, true, now), /2개/);
  room = addYutPlayer(room, { uid: 'b', name: 'b' }, now);
  assert.equal(room.players[1].role, 'gong');
  assert.throws(() => addYutPlayer(room, { uid: 'c', name: 'c' }, now));
  assert.throws(() => setYutSeat(room, 'a', 2, true, now));
  room = leaveYutRoom(room, 'a', now);
  assert.equal(room.hostUid, 'b'); assert.equal(room.players[0].role, 'gong');
  room = addYutPlayer(room, { uid: 'c', name: 'c' }, now);
  assert.equal(room.players[1].role, 'sa');
  room = readyYutPlayer(room, 'c', true, now);
  room = startYutGame(room, now);
  assert.throws(() => setYutSeat(room, 'b', 1, false, now));
});
test('last throw persists after a move; visual power cannot alter the result', () => {
  const original = game(), sticks = [true, false, false, false];
  const soft = throwYut(original, 'a', sticks, now + 1, 0), strong = throwYut(original, 'a', sticks, now + 1, 1);
  assert.deepEqual(soft.pendingThrow, strong.pendingThrow);
  assert.equal(original.players[0].lastThrow, undefined);
  assert.deepEqual(strong.players[0].lastThrow, { value: 1, label: '도', atMs: now + 1, power: 1 });
  const moved = moveYut(strong, 'a', '1', 'outer', now + 2);
  assert.deepEqual(moved.players[0].lastThrow, strong.players[0].lastThrow);
  assert.throws(() => throwYut(original, 'a', sticks, now + 1, 2));
  assert.throws(() => throwYut(original, 'a', sticks, now + 1, NaN));
});
test('fixed emotes are immutable and isolated from the game revision, deadline and event', () => {
  const original = game(4);
  let room = original;
  for (const player of room.players) room = addYutEmote(room, player.uid, 'hello', `emote_${player.uid}_000001`, now);
  assert.equal(room.revision, original.revision);
  assert.equal(room.syncRevision, original.syncRevision + 4);
  assert.equal(room.turnDeadlineMs, original.turnDeadlineMs);
  assert.deepEqual(room.lastEvent, original.lastEvent);
  assert.equal(room.updatedAtMs, original.updatedAtMs);
  assert.deepEqual(original.emotes, {});
  assert.equal(Object.keys(room.emotes).length, 4);
  assert.equal(addYutEmote(room, 'a', 'hello', 'emote_a_000001', now + 1), room);
  assert.throws(() => addYutEmote(room, 'a', 'nice', 'emote_a_000001', now + 1));
  assert.throws(() => addYutEmote(room, 'a', 'nice', 'emote_a_000002', now + YUT_EMOTE_COOLDOWN_MS - 1));
  room = addYutEmote(room, 'a', 'nice', 'emote_a_000002', now + YUT_EMOTE_COOLDOWN_MS);
  assert.equal(room.emotes.a.kind, 'nice');
  assert.equal(Object.keys(room.emotes).length, 4);
  room = leaveYutRoom(room, 'a', now + YUT_EMOTE_COOLDOWN_MS + 1);
  assert.equal(room.emotes.a, undefined);
  assert.equal(YUT_EMOTE_VISIBLE_MS, 4000);
});
test('emotes reject arbitrary text, nonparticipants and closed rooms; legacy rooms gain sync revision', () => {
  const original = game();
  for (const kind of YUT_EMOTE_KINDS) assert.equal(addYutEmote(original, 'a', kind, 'emote_allowlist', now).emotes.a.kind, kind);
  assert.throws(() => addYutEmote(original, 'a', '자유 채팅', 'emote_invalid', now));
  assert.throws(() => addYutEmote(original, 'outsider', 'hello', 'emote_invalid', now));
  assert.throws(() => addYutEmote(closeYutRoom(original, now), 'a', 'hello', 'emote_invalid', now));
  const finished = leaveYutRoom(original, 'b', now);
  assert.equal(addYutEmote(finished, 'a', 'gg', 'emote_finished', now).emotes.a.kind, 'gg');
  delete original.syncRevision; delete original.emotes;
  assert.equal(addYutEmote(original, 'a', 'wow', 'emote_legacy1', now).syncRevision, original.revision + 1);
  assert.equal(roll(original, 2).syncRevision, original.revision + 1);
});
test('all 16 physical throws give correct values; no back-do; source immutable', () => {
  const original = game(), frequencies = {};
  for (let bits = 0; bits < 16; bits += 1) {
    const result = throwYut(original, 'a', [0, 1, 2, 3].map((bit) => Boolean(bits & (1 << bit))), now + 1);
    frequencies[result.pendingThrow.value] = (frequencies[result.pendingThrow.value] || 0) + 1;
    assert.equal(result.phase, 'move');
  }
  assert.deepEqual(frequencies, { 1: 4, 2: 6, 3: 4, 4: 1, 5: 1 });
  assert.equal(original.pendingThrow, null);
});
test('diagonals only chosen from exact corners; center can choose either exit', () => {
  const base = game();
  base.players[0].pieces[0].node = 'o4';
  let room = roll(base, 3);
  assert.deepEqual(getLegalYutMoves(room, 'a').filter((move) => move.pieceId === '1').map((move) => move.targetNode), ['o7']);
  base.players[0].pieces[0].node = 'o5';
  room = roll(base, 3);
  assert.deepEqual(getLegalYutMoves(room, 'a').filter((move) => move.pieceId === '1').map((move) => move.targetNode), ['o8', 'center']);
  assert.deepEqual(getLegalYutMoves(room, 'a').find((move) => move.route === 'a').path, ['a1', 'a2', 'center']);
  room = moveYut(room, 'a', '1', 'a', now + 2);
  assert.deepEqual(room.lastEvent.move.path, ['a1', 'a2', 'center']);
  room.turnUid = 'a'; room.phase = 'throw';
  room = roll(room, 3);
  assert.deepEqual(getLegalYutMoves(room, 'a').filter((move) => move.pieceId === '1').map((move) => move.targetNode), ['o15', 'o20']);
  assert.deepEqual(getLegalYutMoves(room, 'a').find((move) => move.route === 'b').path, ['b4', 'b5', 'o20']);
});
test('stack moves and captures all opposing stacked pieces; yut plus capture gives two bonus throws', () => {
  let room = game(2, 2);
  room.players[0].pieces.forEach((piece) => { piece.node = 'o1'; });
  room.players[1].pieces.forEach((piece) => { piece.node = 'o5'; });
  room = moveYut(roll(room, 4), 'a', '2', 'outer', now + 2);
  assert.deepEqual(room.players[0].pieces.map((piece) => piece.node), ['o5', 'o5']);
  assert.deepEqual(room.players[1].pieces.map((piece) => piece.node), ['home', 'home']);
  assert.deepEqual(room.lastEvent.move, { uid: 'a', pieceId: '2', route: 'outer', path: ['o2', 'o3', 'o4', 'o5'], capturedUids: ['b'] });
  assert.equal(room.turnUid, 'a'); assert.equal(room.extraThrows, 1);
  room = moveYut(roll(room, 1), 'a', '1', 'outer', now + 3);
  assert.equal(room.turnUid, 'a'); assert.equal(room.extraThrows, 0);
  room = moveYut(roll(room, 1), 'a', '1', 'outer', now + 4);
  assert.equal(room.turnUid, 'b');
});
test('home pieces do not stack; exact final corner requires one extra step', () => {
  let room = moveYut(roll(game(2, 2), 1), 'a', '1', 'outer', now + 2);
  assert.deepEqual(room.players[0].pieces.map((piece) => piece.node), ['o1', 'home']);
  room = game(); room.players[0].pieces.forEach((piece) => { piece.node = 'o19'; });
  room = moveYut(roll(room, 1), 'a', '1', 'outer', now + 2);
  assert.equal(room.status, 'playing');
  room.turnUid = 'a'; room.phase = 'throw';
  room = moveYut(roll(room, 1), 'a', '1', 'outer', now + 3);
  assert.equal(room.status, 'finished'); assert.equal(room.winnerUid, 'a');
  assert.equal(room.finishReason, 'completion');
  assert.deepEqual(room.lastEvent.move.path, ['finish']);
  assert.throws(() => throwYut(room, 'b', [true, false, false, false], now + 4));
  assert.throws(() => coreMoveYut(room, 'b', '1', 'outer', now + 4));
  assert.throws(() => skipYutTurn(room, now + 4));
});
test('invalid turn, phase, route and expiry cannot mutate the game', () => {
  const room = game();
  assert.throws(() => throwYut(room, 'b', [true, false, false, false], now + 1));
  assert.throws(() => throwYut(room, 'a', [true, false, false, false], room.turnDeadlineMs));
  assert.throws(() => skipYutTurn(room, room.turnDeadlineMs - 1));
  assert.throws(() => moveYut(roll(room, 1), 'a', '1', 'a', now + 1));
  assert.equal(skipYutTurn(room, room.turnDeadlineMs).turnUid, 'b');
});
test('host migrates in waiting; active leaving forfeits and last remaining player wins', () => {
  let waiting = createYutRoom({ id: 'r', code: 'ABC234', classId: 'c', classLabel: 'c', host: { uid: 'a', name: 'a' }, nowMs: now });
  waiting = addYutPlayer(waiting, { uid: 'b', name: 'b' }, now);
  waiting = leaveYutRoom(waiting, 'a', now);
  assert.equal(waiting.hostUid, 'b'); assert.equal(waiting.players[0].ready, true);
  let room = leaveYutRoom(game(3), 'a', now);
  assert.equal(room.turnUid, 'b'); assert.equal(room.status, 'playing');
  room = leaveYutRoom(room, 'c', now);
  assert.equal(room.status, 'finished'); assert.equal(room.winnerUid, 'b');
  assert.equal(room.finishReason, 'forfeit');
});
test('many seeded matches end with valid positions and exactly one winner', () => {
  let seed = 8221;
  const rng = (max) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let match = 0; match < 40; match += 1) {
    let room = game(2 + match % 3), tick = now;
    for (let step = 0; step < 2000 && room.status === 'playing'; step += 1) {
      tick = Math.max(tick + 1, room.phaseStartsAtMs || 0);
      if (room.phase === 'throw') room = throwYut(room, room.turnUid, [0, 1, 2, 3].map(() => rng(16) > 7), tick);
      else {
        const moves = getLegalYutMoves(room, room.turnUid), move = moves[rng(moves.length)];
        room = moveYut(room, room.turnUid, move.pieceId, move.route, tick);
      }
    }
    assert.equal(room.status, 'finished');
    assert.equal(room.players.filter((player) => player.pieces.every((piece) => piece.node === 'finish')).length, 1);
  }
});
