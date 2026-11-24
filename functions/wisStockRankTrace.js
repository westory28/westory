const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { parseWisStockInvestmentBoardSnapshot, normalizeWisStockInvestmentBoardScope } = require('./wisStockInvestmentBoard');

const SHARD_SIZE = 128, PAGE_SIZE = 16;
const day = atMs => new Date(atMs).toISOString().slice(0,10);
const shardId = item => day(item.atMs) + '_' + String(Math.floor(item.revision / SHARD_SIZE)).padStart(14, '0');
function leaders(rows) {
  return rows.filter(row => row.holdingCostBasis > 0 && row.holdingCount > 0).sort((a, b) => {
    const left = BigInt(a.holdingValue) * BigInt(b.holdingCostBasis);
    const right = BigInt(b.holdingValue) * BigInt(a.holdingCostBasis);
    return (left === right ? 0 : left > right ? -1 : 1) || Number(a.grade) - Number(b.grade)
      || Number(a.classNumber) - Number(b.classNumber) || Number(a.studentNumber) - Number(b.studentNumber)
      || a.studentKey.localeCompare(b.studentKey);
  }).slice(0, 5).map(({ studentKey, holdingValue, holdingCostBasis }) => ({ studentKey, holdingValue, holdingCostBasis }));
}
const sample = board => ({ revision: board.revision, atMs: board.asOfMs, leaders: leaders(board.rows) });

// Out-of-order Eventarc delivery and backfill use immutable observations addressed by board revision.
// Each document has at most 128 revisions with five values, below Firestore's size/index limits.
async function saveSamples(db, boardRef, samples) {
  const groups = new Map();
  for (const item of samples) {
    const id = shardId(item);
    if (!groups.has(id)) groups.set(id, {});
    groups.get(id)['r' + item.revision] = item;
  }
  for (const [id, values] of groups) {
    const ref = boardRef.collection('rank_trace').doc(id);
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data() || {};
      const fresh = Object.fromEntries(Object.entries(values).filter(([key]) => !Object.hasOwn(current,key)));
      if (Object.keys(fresh).length) tx.set(ref, { ...fresh, updatedAt: FieldValue.serverTimestamp() },
        { mergeFields: [...Object.keys(fresh), 'updatedAt'] });
    });
  }
}
function createRankTraceWriter(db) {
  return async event => {
    const {year, semester, boardId} = event.params;
    const match = /^class_([1-3])_([1-9][0-9]?)$/.exec(boardId);
    if (boardId !== 'all' && !match) return;
    const scope = normalizeWisStockInvestmentBoardScope({year, semester, ...(match && {grade:match[1],classNumber:match[2]})});
    const before = event.data?.before, after = event.data?.after;
    if (!after?.exists) return;
    const next = sample(parseWisStockInvestmentBoardSnapshot(after.data(), scope));
    const prior = before?.exists && sample(parseWisStockInvestmentBoardSnapshot(before.data(), scope));
    if (prior && JSON.stringify(prior.leaders) === JSON.stringify(next.leaders)) return;
    if (!prior && !next.leaders.length) return;
    await saveSamples(db, after.ref, prior ? [prior,next] : [next]);
  };
}
async function readRankTrace(tx, boardRef, board, { after, through, fromMs = 0, sinceMs = 0 }) {
  const allowed = new Set(board.rows.map(row => row.studentKey));
  const collection = boardRef.collection('rank_trace');
  let query;
  if (sinceMs) {
    query = collection.where('updatedAt', '>=', Timestamp.fromMillis(sinceMs)).orderBy('updatedAt').orderBy(FieldPath.documentId());
    if (after) query = query.startAfter(new Timestamp(after.sec, after.nano), after.id);
  } else {
    query = collection.orderBy(FieldPath.documentId()).endAt(day(board.asOfMs) + '_99999999999999');
    query = after ? query.startAfter(after.id) : query.startAt(day(fromMs) + '_');
  }
  const page = await tx.get(query.limit(PAGE_SIZE));
  // A board may refresh just before this read. Revisit shards containing newer
  // revisions on the next incremental request, even if no further writes occur.
  const cutoff = Math.min(through,board.revision);
  let readMs = Math.floor(page.readTime.toMillis());
  for (const doc of page.docs) {
    if (Object.keys(doc.data()).some(key => key.startsWith('r') && Number(key.slice(1)) > cutoff))
      readMs = Math.min(readMs, Math.floor(doc.get('updatedAt').toMillis()));
  }
  const samples = page.docs.flatMap(doc => Object.entries(doc.data()).filter(([k]) => k !== 'updatedAt').map(([,value]) => value))
    .filter(item => item.revision <= Math.min(board.revision, through) && item.atMs >= fromMs)
    .sort((a,b) => a.revision - b.revision)
    .map(({atMs,revision,leaders}) => ({atMs,revision,leaders:leaders.filter(row => allowed.has(row.studentKey))}));
  const last = page.docs.at(-1), updated = last?.get('updatedAt');
  return {semesterId:board.semesterId, grade:board.grade, classNumber:board.classNumber, samples, readMs,
    next:page.size === PAGE_SIZE ? {id:last.id, ...(sinceMs && {sec:updated.seconds,nano:updated.nanoseconds})} : null};
}
module.exports = { leaders, sample, saveSamples, createRankTraceWriter, readRankTrace };
