import { getLegalYutMoves } from './yutCore.mjs';

// A display-only projection. Use the actual legal route graph, including the
// center fork and legacy o20 position, without changing any room or game rule.
const distances = new Map();
function remainingSteps(piece) {
  const key = `${piece.node}:${piece.lane}`;
  if (distances.has(key)) return distances.get(key);
  const queue = [{ ...piece, steps: 0 }], visited = new Set();
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index], state = `${current.node}:${current.lane}`;
    if (current.node === 'finish') {
      distances.set(key, current.steps);
      return current.steps;
    }
    if (visited.has(state)) continue;
    visited.add(state);
    const moves = getLegalYutMoves({
      status: 'playing', phase: 'move', turnUid: 'monitor', rulesVersion: 2,
      pendingThrow: { value: 1 },
      players: [{ uid: 'monitor', active: true, pieces: [{ id: '1', node: current.node, lane: current.lane }] }],
    }, 'monitor');
    for (const move of moves) queue.push({
      node: move.targetNode,
      lane: move.targetNode.startsWith('o') ? 'outer' : move.route,
      steps: current.steps + 1,
    });
  }
  throw new Error('말 위치를 확인해 주세요.');
}

export function getYutManagementProgress(room) {
  if (room.status !== 'playing') return { standings: [], leadingUids: [] };
  let standings;
  try {
    standings = room.players.filter(player => player.active && player.pieces?.length).map(player => ({
      uid: player.uid,
      finishedPieces: player.pieces.filter(piece => piece.node === 'finish').length,
      totalPieces: player.pieces.length,
      progress: -player.pieces.reduce((sum, piece) => sum + remainingSteps(piece), 0),
    }));
  } catch {
    // An unrecognized old position must not break the rest of the monitor or
    // incorrectly name a leader. No fallback writes or migrations are needed.
    return { standings: [], leadingUids: [] };
  }
  standings.sort((a, b) => b.finishedPieces - a.finishedPieces || b.progress - a.progress);
  const first = standings[0];
  return {
    standings,
    leadingUids: first ? standings.filter(player => player.finishedPieces === first.finishedPieces && player.progress === first.progress).map(player => player.uid) : [],
  };
}
