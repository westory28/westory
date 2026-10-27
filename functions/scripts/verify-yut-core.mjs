import test from 'node:test';
import assert from 'node:assert/strict';
import { createYutRoom, addYutPlayer, readyYutPlayer, startYutGame, throwYut, moveYut as coreMoveYut, getLegalYutMoves, skipYutTurn, leaveYutRoom, closeYutRoom, addYutEmote, setYutSeat, kickYutPlayer, getYutThrowProbabilities, sampleYutSticks, YUT_EMOTE_KINDS, YUT_EMOTE_COOLDOWN_MS, YUT_EMOTE_VISIBLE_MS, YUT_WAITING_MS } from '../yutCore.mjs';
const now = 10000;
function game(count = 2, pieces = 1, version = 1) {
  let room = createYutRoom({ id: 'room', code: 'ABC234', classId: 'class', classLabel: '1학년 1반', host: { uid: 'a', name: '가' }, nowMs: now });
  for (let index = 1; index < count; index += 1) {
    const uid = String.fromCharCode(97 + index);
    room = readyYutPlayer(addYutPlayer(room, { uid, name: uid }, now), uid, true, now);
  }
  room = startYutGame(room, now - 2000);
  if (version !== 2) delete room.rulesVersion;
  room.pieceCount = pieces;
  for (const player of room.players) player.pieces = player.pieces.slice(0, pieces);
  return room;
}
const roll = (room, value) => throwYut(room, room.turnUid, Array.from({ length: 4 }, (_, index) => index < (value === 5 ? 0 : value)), Math.max(now + 1, room.phaseStartsAtMs || 0));
const moveYut = (room, uid, piece, route, atMs) => coreMoveYut(room, uid, piece, route, Math.max(atMs, room.phaseStartsAtMs || 0));

test('waiting expiry follows only host activity, including ready emotes and host transfer', () => {
  const original = createYutRoom({ id: 'waiting', code: 'ABC234', classId: '', classLabel: '', host: { uid: 'a', name: '가' }, nowMs: now });
  let room = addYutPlayer(original, { uid: 'b', name: '나' }, now + 1000);
  room = readyYutPlayer(room, 'b', true, now + 2000);
  room = addYutEmote(room, 'b', 'ready', 'guest_ready_0001', now + 3000);
  assert.equal(room.expiresAtMs, now + YUT_WAITING_MS, 'guest actions do not keep an idle host room alive');
  const revision = room.revision, event = room.lastEvent;
  room = addYutEmote(room, 'a', 'ready', 'host_ready_00001', now + 5000);
  assert.equal(room.hostActivityAtMs, now + 5000);
  assert.equal(room.expiresAtMs, now + 5000 + YUT_WAITING_MS);
  assert.equal(room.revision, revision);
  assert.deepEqual(room.lastEvent, event);
  assert.equal(original.expiresAtMs, now + YUT_WAITING_MS, 'source is immutable');
  room = setYutSeat(room, 'a', 3, true, now + 6000);
  assert.equal(room.expiresAtMs, now + 6000 + YUT_WAITING_MS);
  room = leaveYutRoom(room, 'a', now + 7000);
  assert.equal(room.hostUid, 'b');
  assert.equal(room.hostActivityAtMs, now + 7000);
  assert.equal(room.expiresAtMs, now + 7000 + YUT_WAITING_MS);
});

test('only the waiting host may kick an unready guest; memberships and emotes are removed', () => {
  let room = createYutRoom({ id: 'waiting', code: 'ABC234', classId: '', classLabel: '', host: { uid: 'a', name: '가' }, nowMs: now });
  room = addYutPlayer(room, { uid: 'b', name: '나' }, now);
  room = addYutEmote(room, 'b', 'hello', 'guest_hello_0001', now);
  room.enrollmentIds = { a: 'ea', b: 'eb' };
  room.enrollmentSlotIds = { a: 'sa', b: 'sb' };
  assert.throws(() => kickYutPlayer(room, 'b', 'a', now));
  assert.throws(() => kickYutPlayer(room, 'outsider', 'b', now));
  assert.throws(() => kickYutPlayer(room, 'a', 'a', now));
  assert.throws(() => kickYutPlayer(readyYutPlayer(room, 'b', true, now), 'a', 'b', now));
  assert.throws(() => kickYutPlayer(startYutGame(readyYutPlayer(room, 'b', true, now), now), 'a', 'b', now));
  const kicked = kickYutPlayer(room, 'a', 'b', now + 1000);
  assert.deepEqual(kicked.participantUids, ['a']);
  assert.equal(kicked.players.length, 1);
  assert.equal(kicked.emotes.b, undefined);
  assert.equal(kicked.enrollmentIds.b, undefined);
  assert.equal(kicked.enrollmentSlotIds.b, undefined);
  assert.equal(kicked.lastEvent.kind, 'kick');
  assert.equal(kicked.expiresAtMs, now + 1000 + YUT_WAITING_MS);
  assert.equal(room.players.length, 2);
});
test('legacy matches retain independent 5-second throw / 25-second move deadlines after animations', () => {
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

test('new and waiting-upgraded matches use two independent pieces; overshoot stops at finish and both must finish', () => {
  let room = game(2, 2, 2);
  assert.equal(room.rulesVersion, 2); assert.equal(room.pieceCount, 2);
  assert.deepEqual(room.players[0].pieces.map(({ id, node, stackId }) => ({ id, node, stackId })), [{ id: '1', node: 'home', stackId: undefined }, { id: '2', node: 'home', stackId: undefined }]);
  room.players[0].pieces[0].node = 'o19';
  room = moveYut(roll(room, 5), 'a', '1', 'outer', now + 2);
  assert.equal(room.status, 'playing'); assert.equal(room.winnerUid, null);
  assert.deepEqual(room.lastEvent.move.path, ['o20', 'finish']);
  assert.deepEqual(room.lastEvent.move.movingPieceIds, ['1']);
  room = roll(room, 5);
  assert.equal(getLegalYutMoves(room, 'a').some(move => move.pieceId === '1'), false);
  room.players[0].pieces[1].node = 'o20';
  room = moveYut(room, 'a', '2', 'outer', now + 3);
  assert.equal(room.status, 'finished'); assert.equal(room.winnerUid, 'a');
  assert.deepEqual(room.lastEvent.move.path, ['finish']);
  const waiting = game(2, 1); waiting.status = 'waiting';
  const started = startYutGame(waiting, now);
  assert.equal(started.rulesVersion, 2); assert.equal(started.pieceCount, 2);
  assert.equal(started.players.every(player => player.pieces.length === 2 && player.pieces.every(piece => piece.node === 'home' && !piece.stackId)), true);
  assert.equal(waiting.players[0].pieces.length, 1, 'upgrade does not mutate source');
});

test('v2 same-tile pieces stay independent and keep their routes until explicit stacking', () => {
  const source = game(2, 2, 2);
  source.players[0].pieces[0].node = 'o4';
  Object.assign(source.players[0].pieces[1], { node: 'o5', lane: 'a' });
  const thrown = roll(source, 1), at = thrown.phaseStartsAtMs;
  assert.equal(getLegalYutMoves(thrown, 'a')[0].canStack, true);
  let separate = coreMoveYut(thrown, 'a', '1', 'outer', at, false);
  assert.equal(separate.players[0].pieces.every(piece => !piece.stackId), true);
  assert.equal(separate.players[0].pieces[1].lane, 'a');
  assert.equal(separate.lastEvent.move.stacked, false);
  assert.equal(separate.phaseStartsAtMs, at + 1500);
  separate.turnUid = 'a'; separate.phase = 'throw';
  const separatedRoll = roll(separate, 1);
  assert.equal(getLegalYutMoves(separatedRoll, 'a').every(move => move.stackSize === 1), true);
  separate = moveYut(separatedRoll, 'a', '1', 'outer', now + 2);
  assert.deepEqual(separate.players[0].pieces.map(piece => piece.node), ['o6', 'o5']);
  let stacked = coreMoveYut(thrown, 'a', '1', 'outer', at, true);
  assert.equal(stacked.players[0].pieces[0].stackId, stacked.players[0].pieces[1].stackId);
  assert.ok(stacked.players[0].pieces[0].stackId);
  assert.equal(stacked.lastEvent.move.stacked, true);
  assert.equal(stacked.turnUid, 'b');
  assert.equal(stacked.phaseStartsAtMs, at + 2100);
  assert.equal(stacked.turnDeadlineMs, at + 2100 + 5000);
  assert.throws(() => throwYut(stacked, 'b', [true, false, false, false], at + 2099), /연출/);
  assert.equal(throwYut(stacked, 'b', [true, false, false, false], at + 2100).phase, 'move');
  stacked.turnUid = 'a'; stacked.phase = 'throw';
  stacked = roll(stacked, 1);
  assert.equal(getLegalYutMoves(stacked, 'a').every(move => move.stackSize === 2), true);
  stacked = moveYut(stacked, 'a', '2', 'a', now + 3);
  assert.deepEqual(stacked.lastEvent.move.movingPieceIds, ['1', '2']);
  assert.deepEqual(stacked.players[0].pieces.map(piece => piece.node), ['a1', 'a1']);
  assert.equal(stacked.phaseStartsAtMs, stacked.lastEvent.atMs + 1500, 'moving an existing stack does not repeat the stacking pose');
  const invalid = roll(game(2, 2, 2), 1);
  assert.throws(() => coreMoveYut(invalid, 'a', '1', 'outer', invalid.phaseStartsAtMs, true), /업을 말/);
  assert.throws(() => coreMoveYut(thrown, 'a', '1', 'outer', at, 'yes'), /업을 말/);
});

test('new stacking reserves 2100ms for a bonus turn too; simultaneous capture uses the larger 2700ms grace', () => {
  for (const capture of [false, true]) {
    let room = game(2, 2, 2);
    room.players[0].pieces[0].node = 'o1'; room.players[0].pieces[1].node = 'o5';
    if (capture) room.players[1].pieces[0].node = 'o5';
    room = roll(room, 4);
    const at = room.phaseStartsAtMs;
    room = coreMoveYut(room, 'a', '1', 'outer', at, true);
    assert.equal(room.turnUid, 'a');
    assert.equal(room.phaseStartsAtMs, at + (capture ? 2700 : 2100));
    assert.equal(room.turnDeadlineMs - room.phaseStartsAtMs, 5000);
    assert.equal(room.lastEvent.move.stacked, true);
  }
});

test('v2 capture reports both pieces and releases their group; a finishing stack completes both together', () => {
  let room = game(2, 2, 2);
  room.players[1].pieces.forEach(piece => Object.assign(piece, { node: 'o2', stackId: 'stack-1-2' }));
  room = moveYut(roll(room, 2), 'a', '1', 'outer', now + 1);
  assert.deepEqual(room.lastEvent.move.capturedPieces, [{ uid: 'b', pieceId: '1' }, { uid: 'b', pieceId: '2' }]);
  assert.equal(room.players[1].pieces.every(piece => piece.node === 'home' && !piece.stackId), true);
  assert.equal(room.extraThrows, 0, 'capturing two pieces still grants one bonus throw');
  room.players[0].pieces.forEach(piece => Object.assign(piece, { node: 'o19', stackId: 'stack-1-2' }));
  room = moveYut(roll(room, 5), 'a', '2', 'outer', now + 2);
  assert.equal(room.status, 'finished');
  assert.deepEqual(room.lastEvent.move.movingPieceIds, ['1', '2']);
  assert.equal(room.players[0].pieces.every(piece => piece.node === 'finish' && !piece.stackId), true);
});

test('power probabilities interpolate exact weak/middle/strong tables and sampled faces match each outcome', () => {
  const tables = [[30, 33, 22, 10, 5], [12, 25, 35, 18, 10], [8, 17, 25, 27, 23]];
  for (const [index, power] of [0.12, 0.56, 1].entries()) {
    assert.deepEqual(getYutThrowProbabilities(power), tables[index]);
    const counts = [0, 0, 0, 0, 0];
    for (let sample = 0; sample < 10000; sample += 1) {
      let draws = 0;
      const sticks = sampleYutSticks(power, () => draws++ ? 0.45 : (sample + 0.5) / 10000);
      assert.equal(sticks.length, 4); assert.equal(sticks.every(value => typeof value === 'boolean'), true);
      counts[(sticks.filter(Boolean).length || 5) - 1] += 1;
    }
    assert.deepEqual(counts, tables[index].map(value => value * 100));
  }
  assert.deepEqual(getYutThrowProbabilities(0), tables[0]);
  assert.deepEqual(getYutThrowProbabilities(2), tables[2]);
  assert.deepEqual(getYutThrowProbabilities(0.34), tables[0].map((value, index) => (value + tables[1][index]) / 2));
  assert.deepEqual(getYutThrowProbabilities(0.78), tables[1].map((value, index) => (value + tables[2][index]) / 2));
});
test('captures reserve 2700ms for movement and reaction, then preserve the full configured throw time', () => {
  for (const throwSeconds of [3, 5, 15]) {
    for (let value = 1; value <= 5; value += 1) {
      let room = game();
      room.throwSeconds = throwSeconds;
      room.players[0].pieces[0].node = 'o1';
      room.players[1].pieces[0].node = `o${value + 1}`;
      room = roll(room, value);
      const moveAt = room.phaseStartsAtMs;
      room = coreMoveYut(room, 'a', '1', 'outer', moveAt);
      assert.equal(room.lastEvent.kind, 'capture');
      assert.equal(room.turnUid, 'a');
      assert.equal(room.extraThrows, value >= 4 ? 1 : 0);
      assert.equal(room.phaseStartsAtMs, moveAt + 2700);
      assert.equal(room.turnDeadlineMs, moveAt + 2700 + throwSeconds * 1000);
      assert.throws(() => throwYut(room, 'a', [true, false, false, false], room.phaseStartsAtMs - 1), /연출/);
      assert.equal(throwYut(room, 'a', [true, false, false, false], room.phaseStartsAtMs).phase, 'move');
      assert.throws(() => skipYutTurn(room, room.turnDeadlineMs - 1));
      const skipped = skipYutTurn(room, room.turnDeadlineMs);
      assert.equal(skipped.turnUid, 'b');
      assert.equal(skipped.phaseStartsAtMs, room.turnDeadlineMs + 1500);
    }
  }
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
  assert.deepEqual(getLegalYutMoves(room, 'a').filter((move) => move.pieceId === '1').map((move) => move.targetNode), ['o15', 'finish']);
  assert.deepEqual(getLegalYutMoves(room, 'a').find((move) => move.route === 'b').path, ['b4', 'b5', 'o20', 'finish']);
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
  assert.equal(room.phaseStartsAtMs, room.lastEvent.atMs + 1500);
  room = moveYut(roll(room, 1), 'a', '1', 'outer', now + 4);
  assert.equal(room.turnUid, 'b');
});
test('home pieces do not stack; exact final corner completes without an extra step', () => {
  let room = moveYut(roll(game(2, 2), 1), 'a', '1', 'outer', now + 2);
  assert.deepEqual(room.players[0].pieces.map((piece) => piece.node), ['o1', 'home']);
  room = game(); room.players[0].pieces.forEach((piece) => { piece.node = 'o19'; });
  room = moveYut(roll(room, 1), 'a', '1', 'outer', now + 2);
  assert.equal(room.status, 'finished'); assert.equal(room.winnerUid, 'a');
  assert.equal(room.finishReason, 'completion');
  assert.deepEqual(room.lastEvent.move.path, ['o20', 'finish']);
  assert.throws(() => throwYut(room, 'b', [true, false, false, false], now + 4));
  assert.throws(() => coreMoveYut(room, 'b', '1', 'outer', now + 4));
  assert.throws(() => skipYutTurn(room, now + 4));
});
test('every final approach completes on exact distance or overshoot for either independent piece and rules version', () => {
  // Independent board-route oracle: o20 is the arrival pad, not another step
  // before completion. Both incoming corridors cover remaining distances 1–5.
  const corridors = [
    { route: 'outer', nodes: ['o15', 'o16', 'o17', 'o18', 'o19', 'o20'] },
    { route: 'b', nodes: ['b1', 'b2', 'center', 'b4', 'b5', 'o20'] },
  ];
  for (const version of [1, 2]) for (const { route, nodes } of corridors) {
    for (let start = 0; start < nodes.length - 1; start += 1) for (let value = 1; value <= 5; value += 1) {
      for (const pieceIndex of [0, 1]) for (const otherNode of ['home', 'o2', 'finish']) {
        const source = game(2, 2, version);
        Object.assign(source.players[0].pieces[pieceIndex], { node: nodes[start], lane: route });
        source.players[0].pieces[1 - pieceIndex].node = otherNode;
        const thrown = roll(source, value), snapshot = JSON.stringify(thrown);
        const pieceId = String(pieceIndex + 1), remaining = nodes.length - 1 - start;
        const completes = value >= remaining;
        const expectedPath = nodes.slice(start + 1, Math.min(start + value + 1, nodes.length));
        if (completes) expectedPath.push('finish');
        const targetNode = completes ? 'finish' : nodes[start + value];
        const legal = getLegalYutMoves(thrown, 'a').find(move => move.pieceId === pieceId && move.route === route);
        const context = `v${version} ${nodes[start]} ${route} +${value} piece ${pieceId}, other ${otherNode}`;
        assert.equal(legal.targetNode, targetNode, context);
        assert.deepEqual(legal.path, expectedPath, context);
        assert.equal(legal.canStack === true, false, context);
        const moved = coreMoveYut(thrown, 'a', pieceId, route, thrown.phaseStartsAtMs);
        assert.equal(moved.players[0].pieces[pieceIndex].node, targetNode, context);
        assert.equal(moved.players[0].pieces[1 - pieceIndex].node, otherNode, context);
        assert.deepEqual(moved.lastEvent.move.path, expectedPath, context);
        assert.deepEqual(moved.lastEvent.move.capturedUids, [], context);
        assert.equal(moved.pendingThrow, null, context);
        assert.equal(JSON.stringify(thrown), snapshot, `source immutable: ${context}`);
        if (completes && otherNode === 'finish') {
          assert.equal(moved.status, 'finished', context);
          assert.equal(moved.winnerUid, 'a', context);
          assert.equal(moved.turnUid, null, context);
          assert.equal(moved.turnDeadlineMs, 0, context);
          assert.equal(moved.extraThrows, 0, context);
          assert.equal(moved.finishReason, 'completion', context);
        } else {
          assert.equal(moved.status, 'playing', context);
          assert.equal(moved.winnerUid, null, context);
          assert.equal(moved.turnUid, value >= 4 ? 'a' : 'b', context);
          assert.equal(moved.phase, 'throw', context);
          assert.equal(moved.extraThrows, 0, context);
          assert.equal(moved.phaseStartsAtMs, thrown.phaseStartsAtMs + 1500, context);
          assert.equal(moved.turnDeadlineMs, moved.phaseStartsAtMs + 5000, context);
        }
      }
    }
  }
});

test('exact finishing stacks complete together and never capture or stack at the arrival pad', () => {
  for (const version of [1, 2]) for (const route of ['outer', 'b']) {
    for (let value = 1; value <= 5; value += 1) {
      const source = game(2, 2, version);
      source.players[0].pieces.forEach(piece => Object.assign(piece, {
        node: route === 'outer' ? `o${20 - value}` : ['b5', 'b4', 'center', 'b2', 'b1'][value - 1],
        lane: route, ...(version === 2 ? { stackId: 'stack-1-2' } : {}),
      }));
      source.players[1].pieces[0].node = 'o20';
      const thrown = roll(source, value);
      const legal = getLegalYutMoves(thrown, 'a').find(move => move.pieceId === '2' && move.route === route);
      assert.equal(legal.targetNode, 'finish');
      assert.equal(legal.stackSize, 2);
      assert.equal(legal.canStack === true, false);
      const moved = coreMoveYut(thrown, 'a', '2', route, thrown.phaseStartsAtMs);
      assert.equal(moved.status, 'finished');
      assert.equal(moved.players[0].pieces.every(piece => piece.node === 'finish' && !piece.stackId), true);
      assert.equal(moved.players[1].pieces[0].node, 'o20', 'completion cannot capture a legacy arrival-pad occupant');
      assert.deepEqual(moved.lastEvent.move.capturedUids, []);
      assert.equal(moved.extraThrows, 0);
      if (version === 2) {
        assert.deepEqual(moved.lastEvent.move.movingPieceIds, ['1', '2']);
        assert.deepEqual(moved.lastEvent.move.capturedPieces, []);
        assert.equal(moved.lastEvent.move.stacked, false);
        assert.throws(() => coreMoveYut(thrown, 'a', '2', route, thrown.phaseStartsAtMs, true), /업을 말/);
      }
    }
  }
});

test('legacy arrival-pad pieces remain finishable and an expired finish choice still cannot bypass turn expiry', () => {
  for (const version of [1, 2]) for (let value = 1; value <= 5; value += 1) {
    const source = game(2, 2, version);
    source.players[0].pieces[0].node = 'o20';
    const thrown = roll(source, value);
    assert.deepEqual(getLegalYutMoves(thrown, 'a').find(move => move.pieceId === '1').path, ['finish']);
    const moved = coreMoveYut(thrown, 'a', '1', 'outer', thrown.phaseStartsAtMs);
    assert.equal(moved.players[0].pieces[0].node, 'finish');
    assert.equal(moved.players[0].pieces[1].node, 'home');
    assert.throws(() => coreMoveYut(thrown, 'a', '1', 'outer', thrown.turnDeadlineMs), /시간/);
    const skipped = skipYutTurn(thrown, thrown.turnDeadlineMs);
    assert.equal(skipped.players[0].pieces[0].node, 'o20');
    assert.equal(skipped.pendingThrow, null);
    assert.equal(skipped.turnUid, 'b');
  }
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
