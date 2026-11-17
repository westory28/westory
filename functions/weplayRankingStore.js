const { createHash } = require('node:crypto');

const hash = value => createHash('sha256').update(value).digest('hex');
const LIMIT = 50;
const root = scope => `years/${scope.year}/semesters/${scope.semester}`;
const boardId = (gameId, category, classId) => `${gameId}_${hash(`${category}\n${classId}`).slice(0, 40)}`;
const weekAt = (atMs = Date.now()) => {
  if (!Number.isFinite(atMs) || atMs < 0) throw new Error('Invalid ranking time');
  const shifted = new Date(atMs + 9 * 3600000);
  const startsAtMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
    - 9 * 3600000 - ((shifted.getUTCDay() + 6) % 7) * 86400000;
  return { id: new Date(startsAtMs + 9 * 3600000).toISOString().slice(0, 10), startsAtMs, endsAtMs: startsAtMs + 7 * 86400000 };
};
const weeklyBoardId = (gameId, category, classId, weekId) => `${gameId}_${hash(`${weekId}\n${category}\n${classId ? `class:${classId}` : 'all'}`).slice(0, 40)}`;
const compare = (a, b) => b.score - a.score || a.achievedAtMs - b.achievedAtMs || a.uid.localeCompare(b.uid);
const studentLabel = (profile, enrollment = {}) => {
  const name = String(enrollment.studentName || profile.name || profile.studentName || '').trim();
  const number = String(enrollment.studentNumber || profile.studentNumber || profile.number || '').replace(/[^0-9]/g, '').slice(0, 3);
  return `${number ? `${number}번 ` : ''}${name || '학생'}`;
};

// Called before any transaction writes. A board is a bounded projection, never
// a query of every student's record. The caller owns its idempotency receipt.
async function prepareRankingUpdate({ db, transaction, scope, gameId, category, actor, score, increment = false, atMs, legacySourceId = null }) {
  if (!actor.classId || !actor.uid || !Number.isSafeInteger(score) || score < 0) throw new Error('Invalid ranking record');
  const week = weekAt(atMs);
  const refs = ['', actor.classId].map(classId => db.doc(`${root(scope)}/weplay_weekly_rankings/${weeklyBoardId(gameId, category, classId, week.id)}`));
  const entryRef = refs[0].collection('players').doc(actor.uid);
  const [allSnap, classSnap, entrySnap] = await transaction.getAll(...refs, entryRef);
  const previous = entrySnap.data(), previousClass = previous?.classScores?.[actor.classId];
  const legacySeeds = { ...(previous?.legacySeeds || {}) };
  let delta = score;
  if (legacySourceId !== null) {
    if (!increment || !/^[a-f0-9]{64}$/.test(legacySourceId)) throw new Error('Invalid legacy ranking source');
    const imported = legacySeeds[legacySourceId] || 0;
    if (!Number.isSafeInteger(imported) || imported > score) throw new Error('Legacy ranking source moved backwards');
    delta = score - imported;
    if (delta === 0) return { apply() {}, changed: false, week };
    legacySeeds[legacySourceId] = score;
  }
  const base = { uid: actor.uid, studentLabel: actor.rankingLabel, classId: actor.classId,
    classLabel: String(actor.classLabel || '').slice(0, 60), achievedAtMs: atMs };
  const best = prior => {
    const candidate = { ...base, score: increment ? Number(prior?.score || 0) + delta : score,
      achievedAtMs: increment ? Math.max(atMs, prior?.achievedAtMs || 0) : atMs };
    if (!Number.isSafeInteger(candidate.score)) throw new Error('Invalid ranking score');
    if (prior && compare(candidate, prior) >= 0) {
      const { uid, studentLabel, classId, classLabel, score: previousScore, achievedAtMs } = prior;
      return { uid, studentLabel, classId, classLabel, score: previousScore, achievedAtMs };
    }
    return candidate;
  };
  const allRow = best(previous), classRow = best(previousClass);
  const allChanged = !previous || compare(allRow, previous) < 0;
  const classChanged = !previousClass || compare(classRow, previousClass) < 0;
  if (!allChanged && !classChanged) return { apply() {}, changed: false, week };
  const boards = [allSnap, classSnap].map((snapshot, i) => {
    const board = snapshot.data() || {}, row = [allRow, classRow][i];
    const previousRows = Array.isArray(board.rows) ? board.rows : [];
    const rows = [...previousRows.filter(entry => entry.uid !== actor.uid), row].sort(compare).slice(0, LIMIT);
    return { board, rows, changed: !snapshot.exists || JSON.stringify(rows) !== JSON.stringify(previousRows) };
  });
  return { changed: true, apply() {
    transaction.set(entryRef, { ...allRow, schemaVersion: 2, weekId: week.id, legacySeeds,
      classScores: { ...(previous?.classScores || {}), [actor.classId]: classRow } });
    boards.forEach(({ board, rows, changed }, i) => {
      if (changed) transaction.set(refs[i], { schemaVersion: 2, gameId, category, classId: i ? actor.classId : '', week, rows,
        updatedAtMs: atMs, trackingSinceMs: board.trackingSinceMs || atMs });
    });
  }, week };
}

module.exports = { LIMIT, root, boardId, weeklyBoardId, weekAt, compare, studentLabel, prepareRankingUpdate };
