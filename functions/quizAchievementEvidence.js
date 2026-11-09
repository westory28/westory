const { createHash } = require('node:crypto');

const text = value => String(value ?? '').trim();
const knownRevision = value => typeof value === 'string' || typeof value === 'number'
  ? text(value) !== '' && text(value) !== 'legacy' : false;
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const snapshotHash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

function packHistoricalQuestionSnapshots(rows) {
  const historicalQuestionSnapshots = {};
  const rawRows = rows.map(row => {
    if (!Array.isArray(row.raw.questionSnapshots)) return row;
    const { questionSnapshots, ...raw } = row.raw;
    const questionSnapshotRefs = questionSnapshots.map(snapshot => {
      const hash = snapshotHash(snapshot);
      if (!Object.hasOwn(historicalQuestionSnapshots, hash)) historicalQuestionSnapshots[hash] = snapshot;
      return hash;
    });
    return { ...row, raw: { ...raw, questionSnapshotRefs } };
  });
  return { rawRows, historicalQuestionSnapshots };
}

// An immutable historical presentation can identify a pre-revision question.
// Its current bank entry never participates in this recovery.
function historicalQuestionEvidence(raw, itemId) {
  const metadata = (Array.isArray(raw.learningSnapshot) ? raw.learningSnapshot : [])
    .find(item => text(item.id) === itemId);
  if (knownRevision(metadata?.sourceRevision)) return { metadata,
    sourceRevision: text(metadata.sourceRevision), revisionBasis: 'version' };
  const frozen = (Array.isArray(raw.questionSnapshots) ? raw.questionSnapshots : [])
    .find(item => text(item.id) === itemId);
  if (!/^[a-f0-9]{64}$/i.test(raw.sourceHash || '') || !frozen
    || typeof frozen.question !== 'string' || !frozen.question.trim()
    || typeof frozen.answer !== 'string' || !frozen.answer.trim()
    || !['choice', 'ox', 'short', 'word', 'order', 'matching'].includes(frozen.type)) return null;
  return { metadata: { ...frozen, ...(metadata || {}) },
    sourceRevision: `snapshot:${snapshotHash(frozen)}`,
    revisionBasis: 'frozen-snapshot' };
}

module.exports = { historicalQuestionEvidence, packHistoricalQuestionSnapshots };
