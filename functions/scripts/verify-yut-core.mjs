import test from 'node:test';
import assert from 'node:assert/strict';
import { createYutRoom, addYutPlayer, readyYutPlayer, startYutGame, throwYut, moveYut, getLegalYutMoves, skipYutTurn, leaveYutRoom } from '../yutCore.mjs';
const now = 1000;
function game(count = 2) {
  let room = createYutRoom({ id: 'room', code: 'ABC234', classId: 'class', classLabel: '1학년 1반', host: { uid: 'a', name: '가' }, nowMs: now });
  for (let index = 1; index < count; index += 1) {
    const uid = String.fromCharCode(97 + index);
    room = readyYutPlayer(addYutPlayer(room, { uid, name: uid }, now), uid, true, now);
  }
  return startYutGame(room, now);
}
const roll = (room, value) => throwYut(room, room.turnUid, Array.from({ length: 4 }, (_, index) => index < (value === 5 ? 0 : value)), now + 1);
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
  room = moveYut(room, 'a', '1', 'a', now + 2);
  room.turnUid = 'a'; room.phase = 'throw';
  room = roll(room, 3);
  assert.deepEqual(getLegalYutMoves(room, 'a').filter((move) => move.pieceId === '1').map((move) => move.targetNode), ['o15', 'o20']);
});
test('stack moves and captures all opposing stacked pieces; yut plus capture gives two bonus throws', () => {
  let room = game();
  room.players[0].pieces.forEach((piece) => { piece.node = 'o1'; });
  room.players[1].pieces.forEach((piece) => { piece.node = 'o5'; });
  room = moveYut(roll(room, 4), 'a', '2', 'outer', now + 2);
  assert.deepEqual(room.players[0].pieces.map((piece) => piece.node), ['o5', 'o5']);
  assert.deepEqual(room.players[1].pieces.map((piece) => piece.node), ['home', 'home']);
  assert.equal(room.turnUid, 'a'); assert.equal(room.extraThrows, 1);
  room = moveYut(roll(room, 1), 'a', '1', 'outer', now + 3);
  assert.equal(room.turnUid, 'a'); assert.equal(room.extraThrows, 0);
  room = moveYut(roll(room, 1), 'a', '1', 'outer', now + 4);
  assert.equal(room.turnUid, 'b');
});
test('home pieces do not stack; exact final corner requires one extra step', () => {
  let room = moveYut(roll(game(), 1), 'a', '1', 'outer', now + 2);
  assert.deepEqual(room.players[0].pieces.map((piece) => piece.node), ['o1', 'home']);
  room = game(); room.players[0].pieces.forEach((piece) => { piece.node = 'o19'; });
  room = moveYut(roll(room, 1), 'a', '1', 'outer', now + 2);
  assert.equal(room.status, 'playing');
  room.turnUid = 'a'; room.phase = 'throw';
  room = moveYut(roll(room, 1), 'a', '1', 'outer', now + 3);
  assert.equal(room.status, 'finished'); assert.equal(room.winnerUid, 'a');
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
});
test('many seeded matches end with valid positions and exactly one winner', () => {
  let seed = 8221;
  const rng = (max) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let match = 0; match < 40; match += 1) {
    let room = game(2 + match % 3), tick = now;
    for (let step = 0; step < 2000 && room.status === 'playing'; step += 1) {
      tick += 1;
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
