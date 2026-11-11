const { createHash } = require('node:crypto');

const text = value => String(value ?? '').trim();
const knownRevision = value => typeof value === 'string' || typeof value === 'number'
  ? text(value) !== '' && text(value) !== 'legacy' : false;
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const snapshotHash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

// Intern only complete snapshot contents, never sourceHash/version metadata.
// The same source hash can coexist with different historical text or images.
// Callers keep normal questionSnapshots arrays until the transport boundary.
function createHistoricalQuestionSnapshotPool(knownHashes = new WeakMap()) {
  const snapshots = new Map();
  return {
    intern(raw, normalize = value => value) {
      if (!Array.isArray(raw.questionSnapshots)) {
        const normalized = normalize(raw), bytes = Buffer.byteLength(JSON.stringify(normalized));
        return { raw: normalized, retainedBytes: bytes, readBytes: bytes };
      }
      const { questionSnapshots, ...rest } = raw;
      const normalized = normalize(rest), refs = [], interned = [];
      let uniqueBytes = 0, snapshotBytes = 0;
      for (const snapshot of questionSnapshots) {
        const value = normalize(snapshot), serialized = JSON.stringify(stable(value));
        const bytes = Buffer.byteLength(serialized), hash = createHash('sha256').update(serialized).digest('hex');
        snapshotBytes += bytes;
        if (!snapshots.has(hash)) {
          snapshots.set(hash, value);
          uniqueBytes += bytes + hash.length + 4;
          if (value && typeof value === 'object') knownHashes.set(value, hash);
        }
        refs.push(hash); interned.push(snapshots.get(hash));
      }
      return {
        raw: { ...normalized, questionSnapshots: interned },
        retainedBytes: Buffer.byteLength(JSON.stringify({ ...normalized, questionSnapshotRefs: refs })) + uniqueBytes,
        readBytes: Buffer.byteLength(JSON.stringify({ ...normalized, questionSnapshots: [] }))
          + snapshotBytes + Math.max(0, interned.length - 1),
      };
    },
  };
}

function packHistoricalQuestionSnapshots(rows, knownHashes) {
  const historicalQuestionSnapshots = {};
  const rawRows = rows.map(row => {
    if (!Array.isArray(row.raw.questionSnapshots)) return row;
    const { questionSnapshots, ...raw } = row.raw;
    const questionSnapshotRefs = questionSnapshots.map(snapshot => {
      const hash = knownHashes?.get(snapshot) || snapshotHash(snapshot);
      if (!Object.hasOwn(historicalQuestionSnapshots, hash)) historicalQuestionSnapshots[hash] = snapshot;
      return hash;
    });
    return { ...row, raw: { ...raw, questionSnapshotRefs } };
  });
  return { rawRows, historicalQuestionSnapshots };
}

// An immutable historical presentation can identify a pre-revision question.
// Its current bank entry never participates in this recovery.
function historicalQuestionEvidence(raw, itemId, knownHashes) {
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
  // The derived material digest is transport metadata, not part of the original
  // immutable snapshot's provenance hash.
  const { paperMaterialHash, ...original } = frozen;
  return { metadata: { ...frozen, ...(metadata || {}) },
    sourceRevision: `snapshot:${paperMaterialHash ? snapshotHash(original) : knownHashes?.get(frozen) || snapshotHash(frozen)}`,
    revisionBasis: 'frozen-snapshot' };
}

module.exports = { historicalQuestionEvidence, packHistoricalQuestionSnapshots, createHistoricalQuestionSnapshotPool };
