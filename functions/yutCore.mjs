// Shared, deterministic rules. Online randomness and authority live in yut.js.
export const YUT_TURN_MS = 60_000;
export const YUT_ROOM_MS = 24 * 60 * 60_000;
export const YUT_ROLES = ['sa', 'nong', 'gong', 'sang'];
const labels = ['', '도', '개', '걸', '윷', '모'];
const diagonals = {
  a: ['o5', 'a1', 'a2', 'center', 'a4', 'a5', 'o15'],
  b: ['o10', 'b1', 'b2', 'center', 'b4', 'b5', 'o20'],
};
const fail = (message) => { throw new Error(message); };
const copy = (room) => JSON.parse(JSON.stringify(room));
const event = (room, kind, text, nowMs) => {
  room.revision += 1;
  room.updatedAtMs = nowMs;
  room.lastEvent = { kind, text, atMs: nowMs };
  return room;
};
const playerFor = (room, uid) => room.players.find((player) => player.uid === uid && player.active);
const piecesFor = () => [1, 2].map((id) => ({ id: String(id), node: 'home', lane: 'outer' }));
export function createYutRoom({ id, code, classId, classLabel, host, nowMs }) {
  return {
    id, code, classId, classLabel, hostUid: host.uid, status: 'waiting', revision: 0,
    players: [{ ...host, role: 'sa', ready: true, active: true, pieces: piecesFor() }],
    participantUids: [host.uid], turnUid: null, phase: 'throw', pendingThrow: null,
    extraThrows: 0, turnDeadlineMs: 0, winnerUid: null,
    lastEvent: { kind: 'create', text: '새 판이 열렸습니다.', atMs: nowMs },
    createdAtMs: nowMs, updatedAtMs: nowMs, expiresAtMs: nowMs + YUT_ROOM_MS,
  };
}
export function addYutPlayer(source, player, nowMs) {
  if (source.status !== 'waiting') fail('이미 시작되었거나 닫힌 방입니다.');
  if (playerFor(source, player.uid)) return source;
  if (source.players.length >= 4) fail('방이 가득 찼습니다.');
  const room = copy(source);
  const role = YUT_ROLES.find((value) => !room.players.some((entry) => entry.role === value));
  room.players.push({ uid: player.uid, name: player.name, role, ready: false, active: true, pieces: piecesFor() });
  room.participantUids.push(player.uid);
  return event(room, 'join', `${player.name} 님이 들어왔습니다.`, nowMs);
}
export function readyYutPlayer(source, uid, ready, nowMs) {
  if (source.status !== 'waiting') fail('대기실에서만 준비 상태를 바꿀 수 있습니다.');
  const room = copy(source), player = playerFor(room, uid);
  if (!player) fail('이 방의 참가자가 아닙니다.');
  player.ready = uid === room.hostUid || ready === true;
  return event(room, 'ready', player.ready ? `${player.name} 님이 준비했습니다.` : `${player.name} 님이 준비를 취소했습니다.`, nowMs);
}
export function startYutGame(source, nowMs) {
  if (source.status !== 'waiting') fail('대기 중인 방에서 시작해 주세요.');
  if (source.players.length < 2 || source.players.some((player) => !player.ready)) fail('2명 이상 모두 준비하면 시작할 수 있습니다.');
  const room = copy(source);
  room.status = 'playing';
  room.turnUid = room.players[0].uid;
  room.turnDeadlineMs = nowMs + YUT_TURN_MS;
  return event(room, 'start', '윷판이 시작되었습니다.', nowMs);
}
const assertTurn = (room, uid, phase, nowMs) => {
  if (room.status !== 'playing' || room.turnUid !== uid || !playerFor(room, uid)) fail('지금은 자신의 차례가 아닙니다.');
  if (room.phase !== phase) fail(phase === 'throw' ? '먼저 말을 옮겨 주세요.' : '먼저 윷을 던져 주세요.');
  if (nowMs >= room.turnDeadlineMs) fail('차례 시간이 지났습니다. 다음 차례로 넘겨 주세요.');
};
export function throwYut(source, uid, sticks, nowMs) {
  assertTurn(source, uid, 'throw', nowMs);
  if (!Array.isArray(sticks) || sticks.length !== 4 || sticks.some((value) => typeof value !== 'boolean')) fail('윷 결과가 올바르지 않습니다.');
  const room = copy(source), count = sticks.filter(Boolean).length, value = count || 5;
  room.pendingThrow = { value, label: labels[value], sticks: [...sticks] };
  room.phase = 'move';
  if (value >= 4) room.extraThrows += 1;
  return event(room, 'throw', `${playerFor(room, uid).name} · ${labels[value]}`, nowMs);
}
const routesFor = (piece) => {
  if (piece.node === 'o5') return ['outer', 'a'];
  if (piece.node === 'o10') return ['outer', 'b'];
  if (piece.node === 'center') return ['a', 'b'];
  return [piece.lane];
};
function advance(piece, steps, route) {
  let node = piece.node, lane = route;
  for (let step = 0; step < steps && node !== 'finish'; step += 1) {
    if (node === 'home') { node = 'o1'; lane = 'outer'; }
    else if (lane !== 'outer' && diagonals[lane].includes(node)) {
      const next = diagonals[lane][diagonals[lane].indexOf(node) + 1];
      if (next) { node = next; if (node.startsWith('o')) lane = 'outer'; }
      else fail('이동 경로를 확인해 주세요.');
    } else {
      const index = Number(node.slice(1));
      if (!/^o\d+$/.test(node) || index < 1 || index > 20) fail('말 위치를 확인해 주세요.');
      node = index === 20 ? 'finish' : `o${index + 1}`;
      lane = 'outer';
    }
  }
  return { node, lane };
}
export function getLegalYutMoves(room, uid) {
  const player = playerFor(room, uid);
  if (!player || room.status !== 'playing' || room.turnUid !== uid || room.phase !== 'move' || !room.pendingThrow) return [];
  const moves = [];
  for (const piece of player.pieces) {
    if (piece.node === 'finish') continue;
    for (const route of routesFor(piece)) {
      const destination = advance(piece, room.pendingThrow.value, route);
      moves.push({ pieceId: piece.id, route, targetNode: destination.node,
        stackSize: piece.node === 'home' ? 1 : player.pieces.filter((other) => other.node === piece.node).length });
    }
  }
  return moves;
}
function nextTurn(room, nowMs) {
  const index = room.players.findIndex((entry) => entry.uid === room.turnUid);
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const player = room.players[(index + offset) % room.players.length];
    if (player.active) { room.turnUid = player.uid; break; }
  }
  room.phase = 'throw'; room.pendingThrow = null; room.extraThrows = 0;
  room.turnDeadlineMs = nowMs + YUT_TURN_MS;
}
export function moveYut(source, uid, pieceId, route, nowMs) {
  assertTurn(source, uid, 'move', nowMs);
  if (!getLegalYutMoves(source, uid).some((move) => move.pieceId === pieceId && move.route === route)) fail('이동할 말과 길을 다시 선택해 주세요.');
  const room = copy(source), player = playerFor(room, uid), piece = player.pieces.find((entry) => entry.id === pieceId);
  const origin = piece.node, destination = advance(piece, room.pendingThrow.value, route);
  const moving = player.pieces.filter((entry) => entry.id === pieceId || (origin !== 'home' && entry.node === origin));
  let captured = 0;
  if (destination.node !== 'finish') {
    for (const opponent of room.players.filter((entry) => entry.uid !== uid && entry.active)) {
      for (const target of opponent.pieces.filter((entry) => entry.node === destination.node)) {
        target.node = 'home'; target.lane = 'outer'; captured += 1;
      }
    }
  }
  for (const target of moving) Object.assign(target, destination);
  // A newly formed stack has one continuing route, regardless of arrival side.
  for (const target of player.pieces.filter((entry) => entry.node === destination.node)) target.lane = destination.lane;
  if (captured) room.extraThrows += 1;
  room.pendingThrow = null;
  if (player.pieces.every((entry) => entry.node === 'finish')) {
    room.status = 'finished'; room.winnerUid = uid; room.turnUid = null; room.turnDeadlineMs = 0; room.extraThrows = 0;
    return event(room, 'finish', `${player.name} 님이 승리했습니다.`, nowMs);
  }
  if (room.extraThrows > 0) { room.extraThrows -= 1; room.phase = 'throw'; }
  else nextTurn(room, nowMs);
  return event(room, captured ? 'capture' : 'move', captured ? `${player.name} · 말 ${captured}개 잡기! 한 번 더 던집니다.` : `${player.name} 님이 말을 옮겼습니다.`, nowMs);
}
export function skipYutTurn(source, nowMs) {
  if (source.status !== 'playing' || nowMs < source.turnDeadlineMs) fail('차례 시간이 지나야 넘길 수 있습니다.');
  const room = copy(source); nextTurn(room, nowMs);
  return event(room, 'skip', '시간이 지나 다음 차례로 넘어갑니다.', nowMs);
}
export function leaveYutRoom(source, uid, nowMs) {
  const room = copy(source), player = playerFor(room, uid);
  if (!player) fail('이 방의 참가자가 아닙니다.');
  room.participantUids = room.participantUids.filter((value) => value !== uid);
  if (room.status === 'waiting') room.players = room.players.filter((entry) => entry.uid !== uid);
  else { player.active = false; player.pieces = piecesFor(); }
  const remaining = room.players.filter((entry) => entry.active && entry.uid !== uid);
  if (room.hostUid === uid) { room.hostUid = remaining[0]?.uid || ''; if (remaining[0]) remaining[0].ready = true; }
  if (!remaining.length) { room.status = 'closed'; room.turnUid = null; room.turnDeadlineMs = 0; }
  else if (room.status === 'playing' && remaining.length === 1) {
    room.status = 'finished'; room.winnerUid = remaining[0].uid; room.turnUid = null; room.turnDeadlineMs = 0;
  } else if (room.status === 'playing' && room.turnUid === uid) nextTurn(room, nowMs);
  return event(room, 'leave', `${player.name} 님이 나갔습니다.`, nowMs);
}
export function closeYutRoom(source, nowMs) {
  const room = copy(source); room.status = 'closed'; room.turnUid = null; room.turnDeadlineMs = 0; room.pendingThrow = null;
  return event(room, 'close', '방이 닫혔습니다.', nowMs);
}
