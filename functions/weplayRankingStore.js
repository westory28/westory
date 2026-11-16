const { createHash } = require('node:crypto');

const hash = value => createHash('sha256').update(value).digest('hex');
const LIMIT = 50;
const root = scope => `years/${scope.year}/semesters/${scope.semester}`;
const boardId = (gameId, category, classId) => `${gameId}_${hash(`${category}\n${classId}`).slice(0, 40)}`;
const compare = (a, b) => b.score - a.score || a.achievedAtMs - b.achievedAtMs || a.uid.localeCompare(b.uid);
const studentLabel = (profile, enrollment = {}) => {
  const name = String(enrollment.studentName || profile.name || profile.studentName || '').trim();
  const number = String(enrollment.studentNumber || profile.studentNumber || profile.number || '').replace(/[^0-9]/g, '').slice(0, 3);
  return `${number ? `${number}번 ` : ''}${name ? `${name[0]}${'○'.repeat(Math.min(3, Math.max(1, name.length - 1)))}` : '학생'}`;
};

// Called before any transaction writes. A board is a bounded projection, never
// a query of every student's record. The caller owns its idempotency receipt.
async function prepareRankingUpdate({ db, transaction, scope, gameId, category, actor, score, increment = false, atMs }) {
  const id = boardId(gameId, category, actor.classId);
  const boardRef = db.doc(`${root(scope)}/weplay_rankings/${id}`);
  const entryRef = boardRef.collection('players').doc(actor.uid);
  const [boardSnap, entrySnap] = await transaction.getAll(boardRef, entryRef);
  const board = boardSnap.data() || {}, previous = entrySnap.data();
  const candidate = { uid: actor.uid, studentLabel: actor.rankingLabel, score: increment ? Number(previous?.score || 0) + score : score, achievedAtMs: atMs };
  if (!Number.isSafeInteger(candidate.score) || candidate.score < 0) throw new Error('Invalid ranking score');
  if (previous && compare(candidate, previous) >= 0) return { apply() {}, changed: false };
  const previousRows = Array.isArray(board.rows) ? board.rows : [];
  const rows = [...previousRows.filter(row => row.uid !== actor.uid), candidate].sort(compare).slice(0, LIMIT);
  const boardChanged = !boardSnap.exists || JSON.stringify(rows) !== JSON.stringify(previousRows);
  return { changed: true, apply() {
    transaction.set(entryRef, candidate);
    if (boardChanged) transaction.set(boardRef, { schemaVersion: 1, gameId, category, classId: actor.classId, rows,
      updatedAtMs: atMs, trackingSinceMs: board.trackingSinceMs || atMs });
  } };
}

module.exports = { LIMIT, root, boardId, compare, studentLabel, prepareRankingUpdate };
