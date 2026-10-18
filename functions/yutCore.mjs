// Shared, deterministic rules. Online randomness and authority live in yut.js.
export const YUT_TURN_MS = 5_000;
export const YUT_THROW_ANIMATION_MS = 3_600;
export const YUT_MOVE_ANIMATION_MS = 1_500;
export const YUT_STACK_ANIMATION_MS = 2_100;
// Up to 1.1s of tile hops, then a 1.4s capture reaction and a small frame margin.
export const YUT_CAPTURE_ANIMATION_MS = 2_700;
export const YUT_START_ANIMATION_MS = 2_000;
export const YUT_ROOM_MS = 24 * 60 * 60_000;
export const YUT_ROLES = ['sa', 'nong', 'gong', 'sang'];
export const YUT_EMOTE_KINDS = ['hello', 'nice', 'oops', 'wow', 'thanks', 'gg', 'angry'];
export const YUT_EMOTE_COOLDOWN_MS = 5_000;
export const YUT_EMOTE_VISIBLE_MS = 4_000;
const labels = ['', '도', '개', '걸', '윷', '모'];
const probabilityAnchors = [[30, 33, 22, 10, 5], [12, 25, 35, 18, 10], [8, 17, 25, 27, 23]];
export function getYutThrowProbabilities(power = 0.65) {
  const strength = Math.max(0, Math.min(1, Math.round(((Number.isFinite(power) ? power : 0.65) - 0.12) / 0.88 * 1e12) / 1e12));
  const segment = strength <= 0.5 ? 0 : 1, fraction = strength <= 0.5 ? strength * 2 : (strength - 0.5) * 2;
  return probabilityAnchors[segment].map((value, index) => value + (probabilityAnchors[segment + 1][index] - value) * fraction);
}
export function sampleYutSticks(power = 0.65, random = Math.random) {
  const probabilities = getYutThrowProbabilities(power);
  const draw = random() * 100;
  let cumulative = 0, value = 5;
  for (let index = 0; index < probabilities.length; index += 1) {
    cumulative += probabilities[index];
    if (draw < cumulative) { value = index + 1; break; }
  }
  const sticks = Array.from({ length: 4 }, (_, index) => index < (value === 5 ? 0 : value));
  for (let index = 3; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [sticks[index], sticks[swap]] = [sticks[swap], sticks[index]];
  }
  return sticks;
}
const diagonals = {
  a: ['o5', 'a1', 'a2', 'center', 'a4', 'a5', 'o15'],
  b: ['o10', 'b1', 'b2', 'center', 'b4', 'b5', 'o20'],
};
const fail = (message) => { throw new Error(message); };
const copy = (room) => JSON.parse(JSON.stringify(room));
const event = (room, kind, text, nowMs, move) => {
  room.syncRevision = (room.syncRevision ?? room.revision) + 1;
  room.revision += 1;
  room.updatedAtMs = nowMs;
  room.lastEvent = { kind, text, atMs: nowMs, ...(move ? { move } : {}) };
  return room;
};
const playerFor = (room, uid) => room.players.find((player) => player.uid === uid && player.active);
const piecesFor = (count = 2) => Array.from({ length: count }, (_, index) => ({ id: String(index + 1), node: 'home', lane: 'outer' }));
const movingGroup = (room, player, piece) => player.pieces.filter((entry) => entry.id === piece.id || (piece.node !== 'home' && piece.node !== 'finish' && entry.node === piece.node
  && (room.rulesVersion === 2 ? Boolean(piece.stackId && entry.stackId === piece.stackId) : true)));
const beginPhase = (room, phase, nowMs, graceMs) => {
  room.phase = phase;
  room.phaseStartsAtMs = nowMs + graceMs;
  room.turnDeadlineMs = room.phaseStartsAtMs + (phase === 'throw' ? room.throwSeconds ?? 5 : room.moveSeconds ?? 25) * 1000;
};
export function createYutRoom({ id, code, classId, classLabel, host, nowMs, visibility = 'private', maxPlayers = 4, throwSeconds = 5, moveSeconds = 25 }) {
  if (!['public', 'private'].includes(visibility) || ![2, 3, 4].includes(maxPlayers)
    || !Number.isInteger(throwSeconds) || throwSeconds < 3 || throwSeconds > 15
    || !Number.isInteger(moveSeconds) || moveSeconds < 15 || moveSeconds > 60) fail('게임 설정을 확인해 주세요.');
  return {
    id, code, classId, classLabel, visibility, maxPlayers, rulesVersion: 2, pieceCount: 2, throwSeconds, moveSeconds,
    hostUid: host.uid, status: 'waiting', revision: 0, syncRevision: 0, emotes: {}, blockedSeats: [0, 1, 2, 3].filter((seat) => seat >= maxPlayers),
    players: [{ ...host, role: 'sa', ready: true, active: true, pieces: piecesFor() }],
    participantUids: [host.uid], turnUid: null, phase: 'throw', pendingThrow: null,
    extraThrows: 0, phaseStartsAtMs: 0, turnDeadlineMs: 0, winnerUid: null,
    lastEvent: { kind: 'create', text: '새 판이 열렸습니다.', atMs: nowMs },
    createdAtMs: nowMs, updatedAtMs: nowMs, expiresAtMs: nowMs + YUT_ROOM_MS,
  };
}
export function addYutEmote(source, uid, kind, id, nowMs) {
  if (!YUT_EMOTE_KINDS.includes(kind)) fail('정해진 감정표현을 선택해 주세요.');
  if (!['waiting', 'playing', 'finished'].includes(source.status) || !source.participantUids.includes(uid) || !playerFor(source, uid)) fail('참가 중인 방에서만 감정표현을 보낼 수 있습니다.');
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(id) || !Number.isFinite(nowMs)) fail('감정표현 요청을 확인해 주세요.');
  if (source.emotes?.[uid]?.id === id) {
    if (source.emotes[uid].kind !== kind) fail('같은 요청 번호로 다른 감정표현을 보낼 수 없습니다.');
    return source;
  }
  if (source.emotes?.[uid] && nowMs < source.emotes[uid].atMs + YUT_EMOTE_COOLDOWN_MS) fail('감정표현은 5초마다 보낼 수 있습니다.');
  const room = copy(source);
  room.emotes = Object.fromEntries(Object.entries(room.emotes || {}).filter(([memberUid]) => room.participantUids.includes(memberUid) && playerFor(room, memberUid)));
  room.emotes[uid] = { id, uid, kind, atMs: nowMs };
  room.syncRevision = (room.syncRevision ?? room.revision) + 1;
  return room;
}
export function addYutPlayer(source, player, nowMs) {
  if (source.status !== 'waiting') fail('이미 시작되었거나 닫힌 방입니다.');
  if (playerFor(source, player.uid)) return source;
  const role = YUT_ROLES.find((value, seat) => !(source.blockedSeats || []).includes(seat) && !source.players.some((entry) => entry.role === value));
  if (!role) fail('열린 자리가 모두 찼습니다.');
  const room = copy(source);
  room.players.push({ uid: player.uid, name: player.name, role, ready: false, active: true, pieces: piecesFor(room.pieceCount ?? room.players[0]?.pieces.length ?? 2) });
  room.participantUids.push(player.uid);
  return event(room, 'join', `${player.name} 님이 들어왔습니다.`, nowMs);
}
export function setYutSeat(source, uid, seat, blocked, nowMs) {
  if (source.status !== 'waiting' || source.hostUid !== uid || !playerFor(source, uid)) fail('대기실의 방장만 자리를 바꿀 수 있습니다.');
  if (!Number.isInteger(seat) || seat < 0 || seat >= YUT_ROLES.length || typeof blocked !== 'boolean') fail('변경할 자리를 확인해 주세요.');
  if (blocked && source.players.some((player) => player.role === YUT_ROLES[seat])) fail('참가자가 있는 자리는 닫을 수 없습니다.');
  const blockedSeats = new Set(source.blockedSeats || []);
  if (blocked === blockedSeats.has(seat)) return source;
  if (blocked) blockedSeats.add(seat); else blockedSeats.delete(seat);
  if (YUT_ROLES.length - blockedSeats.size < 2) fail('자리는 2개 이상 열어 두어야 합니다.');
  const room = copy(source);
  room.blockedSeats = [...blockedSeats].sort((a, b) => a - b);
  room.maxPlayers = YUT_ROLES.length - blockedSeats.size;
  return event(room, 'seat', blocked ? '빈자리를 닫았습니다.' : '빈자리를 열었습니다.', nowMs);
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
  // Waiting rooms have no played state to preserve. Upgrade together at start;
  // already-playing legacy rooms keep their original count and automatic stacks.
  room.rulesVersion = 2; room.pieceCount = 2;
  for (const player of room.players) player.pieces = piecesFor();
  room.status = 'playing';
  room.turnUid = room.players[0].uid;
  beginPhase(room, 'throw', nowMs, YUT_START_ANIMATION_MS);
  return event(room, 'start', '윷판이 시작되었습니다.', nowMs);
}
const assertTurn = (room, uid, phase, nowMs) => {
  if (room.status !== 'playing' || room.turnUid !== uid || !playerFor(room, uid)) fail('지금은 자신의 차례가 아닙니다.');
  if (room.phase !== phase) fail(phase === 'throw' ? '먼저 말을 옮겨 주세요.' : '먼저 윷을 던져 주세요.');
  if (nowMs < (room.phaseStartsAtMs || 0)) fail('연출이 끝나면 진행해 주세요.');
  if (nowMs >= room.turnDeadlineMs) fail('차례 시간이 지났습니다. 다음 차례로 넘겨 주세요.');
};
export function throwYut(source, uid, sticks, nowMs, power) {
  assertTurn(source, uid, 'throw', nowMs);
  if (!Array.isArray(sticks) || sticks.length !== 4 || sticks.some((value) => typeof value !== 'boolean')) fail('윷 결과가 올바르지 않습니다.');
  if (power !== undefined && (!Number.isFinite(power) || power < 0 || power > 1)) fail('던지는 세기를 확인해 주세요.');
  const room = copy(source), count = sticks.filter(Boolean).length, value = count || 5;
  room.pendingThrow = { value, label: labels[value], sticks: [...sticks] };
  playerFor(room, uid).lastThrow = { value, label: labels[value], atMs: nowMs, ...(power === undefined ? {} : { power }) };
  beginPhase(room, 'move', nowMs, YUT_THROW_ANIMATION_MS);
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
  const path = [];
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
    path.push(node);
  }
  return { node, lane, path };
}
export function getLegalYutMoves(room, uid) {
  const player = playerFor(room, uid);
  if (!player || room.status !== 'playing' || room.turnUid !== uid || room.phase !== 'move' || !room.pendingThrow) return [];
  const moves = [];
  for (const piece of player.pieces) {
    if (piece.node === 'finish') continue;
    for (const route of routesFor(piece)) {
      const destination = advance(piece, room.pendingThrow.value, route);
      const group = movingGroup(room, player, piece);
      moves.push({ pieceId: piece.id, route, targetNode: destination.node, path: destination.path,
        stackSize: group.length,
        ...(room.rulesVersion === 2 ? { canStack: destination.node !== 'finish' && player.pieces.some((other) => other.node === destination.node && !group.includes(other)) } : {}) });
    }
  }
  return moves;
}
function nextTurn(room, nowMs, graceMs = YUT_MOVE_ANIMATION_MS) {
  const index = room.players.findIndex((entry) => entry.uid === room.turnUid);
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const player = room.players[(index + offset) % room.players.length];
    if (player.active) { room.turnUid = player.uid; break; }
  }
  room.pendingThrow = null; room.extraThrows = 0;
  beginPhase(room, 'throw', nowMs, graceMs);
}
export function moveYut(source, uid, pieceId, route, nowMs, stack = false) {
  assertTurn(source, uid, 'move', nowMs);
  const legal = getLegalYutMoves(source, uid).find((move) => move.pieceId === pieceId && move.route === route);
  if (!legal) fail('이동할 말과 길을 다시 선택해 주세요.');
  if (typeof stack !== 'boolean' || (source.rulesVersion === 2 && stack && !legal.canStack)) fail('업을 말을 다시 확인해 주세요.');
  const room = copy(source), player = playerFor(room, uid), piece = player.pieces.find((entry) => entry.id === pieceId);
  const destination = advance(piece, room.pendingThrow.value, route);
  const moving = movingGroup(room, player, piece);
  let captured = 0;
  const capturedUids = new Set();
  const capturedPieces = [];
  if (destination.node !== 'finish') {
    for (const opponent of room.players.filter((entry) => entry.uid !== uid && entry.active)) {
      for (const target of opponent.pieces.filter((entry) => entry.node === destination.node)) {
        target.node = 'home'; target.lane = 'outer'; delete target.stackId;
        captured += 1; capturedUids.add(opponent.uid); capturedPieces.push({ uid: opponent.uid, pieceId: target.id });
      }
    }
  }
  for (const target of moving) Object.assign(target, { node: destination.node, lane: destination.lane });
  if (room.rulesVersion === 2) {
    if (destination.node === 'finish') for (const target of moving) delete target.stackId;
    else if (stack) {
      const joined = player.pieces.filter((entry) => entry.node === destination.node);
      const stackId = `stack-${joined.map((entry) => entry.id).sort().join('-')}`;
      for (const target of joined) { target.stackId = stackId; target.lane = destination.lane; }
    }
  } else {
    // Legacy games keep automatic grouping and a shared continuing route.
    for (const target of player.pieces.filter((entry) => entry.node === destination.node)) target.lane = destination.lane;
  }
  if (captured) room.extraThrows += 1;
  room.pendingThrow = null;
  const movement = { uid, pieceId, route, path: destination.path, capturedUids: [...capturedUids],
    ...(room.rulesVersion === 2 ? { movingPieceIds: moving.map((entry) => entry.id), capturedPieces, stacked: stack } : {}) };
  if (player.pieces.every((entry) => entry.node === 'finish')) {
    room.status = 'finished'; room.winnerUid = uid; room.turnUid = null; room.phaseStartsAtMs = 0; room.turnDeadlineMs = 0; room.extraThrows = 0;
    room.finishReason = 'completion';
    return event(room, 'finish', `${player.name} 님이 승리했습니다.`, nowMs, movement);
  }
  const graceMs = Math.max(YUT_MOVE_ANIMATION_MS, captured ? YUT_CAPTURE_ANIMATION_MS : 0, room.rulesVersion === 2 && stack ? YUT_STACK_ANIMATION_MS : 0);
  if (room.extraThrows > 0) { room.extraThrows -= 1; beginPhase(room, 'throw', nowMs, graceMs); }
  else nextTurn(room, nowMs, graceMs);
  return event(room, captured ? 'capture' : 'move', captured ? `${player.name} · 말 ${captured}개 잡기! 한 번 더 던집니다.` : `${player.name} 님이 말을 옮겼습니다.`, nowMs, movement);
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
  if (room.emotes) delete room.emotes[uid];
  if (room.status === 'waiting') room.players = room.players.filter((entry) => entry.uid !== uid);
  else { player.active = false; player.pieces = piecesFor(player.pieces.length); }
  const remaining = room.players.filter((entry) => entry.active && entry.uid !== uid);
  if (room.hostUid === uid) { room.hostUid = remaining[0]?.uid || ''; if (remaining[0]) remaining[0].ready = true; }
  if (!remaining.length) { room.status = 'closed'; room.turnUid = null; room.phaseStartsAtMs = 0; room.turnDeadlineMs = 0; }
  else if (room.status === 'playing' && remaining.length === 1) {
    room.status = 'finished'; room.winnerUid = remaining[0].uid; room.turnUid = null; room.phaseStartsAtMs = 0; room.turnDeadlineMs = 0;
    room.finishReason = 'forfeit';
  } else if (room.status === 'playing' && room.turnUid === uid) nextTurn(room, nowMs);
  return event(room, 'leave', `${player.name} 님이 나갔습니다.`, nowMs);
}
export function closeYutRoom(source, nowMs) {
  const room = copy(source); room.status = 'closed'; room.turnUid = null; room.phaseStartsAtMs = 0; room.turnDeadlineMs = 0; room.pendingThrow = null;
  return event(room, 'close', '방이 닫혔습니다.', nowMs);
}
