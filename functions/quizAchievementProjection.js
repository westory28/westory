'use strict';

const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { effectiveQuizResult } = require('./quizQuestionCorrections');
const { historicalQuestionEvidence } = require('./quizAchievementEvidence');
const { ACHIEVEMENT_FIELDS, normalizeAchievementMetadata } = require('./historyAchievementMetadata');

const MAX_BYTES = 8 * 1024 * 1024;
const SCOPE_FIELDS = ['studentUid', 'uid', 'studentId', 'userId', 'email', 'studentEmail',
  'assessmentKind', 'semesterId', 'unitId', 'sourceId', 'category', 'examRound', 'definitionId'];
const RAW_FIELDS = [...SCOPE_FIELDS, 'earnedPoints', 'maxPoints', 'score', 'percent', 'total',
  'submittedAtIso', 'timestamp', 'createdAt', 'attemptId', 'canonicalAttemptId', 'submissionRef',
  'resultRef', 'resultId', 'legacyResultId', 'startedAtIso', 'sourceHash', 'questionSnapshotOmittedIds',
  'answers', 'answerChecks', 'behaviorAnswersAvailable'];
const METADATA_FIELDS = ['id', 'sourceRevision', 'revisionBasis', 'metadataLimited', 'points',
  'unitId', 'subUnitId', 'refBig', 'refMid', 'refSmall', 'familyId', ...ACHIEVEMENT_FIELDS];
const PROJECTION_INPUT_FIELDS = [...RAW_FIELDS, 'learningSnapshot', 'questionSnapshots', 'details',
  'gradingCorrections', 'gradingCorrectionSummary'];
const text = value => String(value ?? '').trim();
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => hash(JSON.stringify(stable(value)));
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value || {}, key)
  && value[key] !== undefined).map(key => [key, value[key]]));
const jsonValue = value => {
  if (value?.toDate) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).map(([key, item]) => [key, jsonValue(item)]));
  return value;
};
const failChanged = () => { throw new HttpsError('aborted', '조회 중 평가 기록이 변경되었습니다. 다시 조회해 주세요.', { reason: 'QUIZ_ANALYSIS_CHANGED' }); };
const failBudget = reason => { throw new HttpsError('resource-exhausted', '성취 분석 자료가 조회 한도를 초과했습니다. 일부 자료만으로 분석하지 않습니다.', { reason }); };

function sourceVersionOf(snapshot) {
  const value = snapshot?.updateTime;
  const seconds = Number(value?.seconds), nanos = Number(value?.nanoseconds);
  return Number.isSafeInteger(seconds) && seconds >= 0 && Number.isInteger(nanos) && nanos >= 0 && nanos < 1e9
    ? `${String(seconds).padStart(16, '0')}${String(nanos).padStart(9, '0')}` : '';
}

const projectionRef = (db, sourcePath) => db.doc(`quiz_achievement_result_views/${hash(sourcePath)}`);

function projectAchievementRaw(original) {
  const raw = effectiveQuizResult(jsonValue(original));
  const metadata = new Map((Array.isArray(raw.learningSnapshot) ? raw.learningSnapshot : [])
    .map(item => [text(item.id), pick(item, METADATA_FIELDS)]));
  for (const check of Array.isArray(raw.answerChecks) ? raw.answerChecks : []) {
    const id = text(check.id), historical = historicalQuestionEvidence(raw, id);
    if (historical?.revisionBasis !== 'frozen-snapshot') continue;
    metadata.set(id, { ...(metadata.get(id) || {}), id,
      ...pick(historical.metadata, ['unitId', 'subUnitId', 'refBig', 'refMid', 'refSmall', 'familyId']),
      ...normalizeAchievementMetadata(historical.metadata), sourceRevision: historical.sourceRevision,
      revisionBasis: historical.revisionBasis, metadataLimited: true });
  }
  const result = pick(raw, RAW_FIELDS);
  if (Array.isArray(raw.learningSnapshot) || metadata.size) result.learningSnapshot = [...metadata.values()];
  if (Array.isArray(raw.questionSnapshots)) result.questionSnapshots = raw.questionSnapshots.map(item =>
    pick(item, ['id', 'type', 'options', 'answer', 'points']));
  if (Array.isArray(raw.details)) result.details = raw.details.map(item =>
    pick(item, ['id', 'qid', 'questionId', 'correct', 'u', 'userAnswer', 'answer', 'sourceRevision']));
  return result;
}

function buildAchievementProjection({ sourcePath, source, sourceVersion, semesterId, raw }) {
  const rawCompact = { ...projectAchievementRaw(raw), analysisSourceVersion: sourceVersion };
  const base = { schemaVersion: 1, sourcePath, source, sourceVersion, semesterId };
  if (Buffer.byteLength(JSON.stringify(rawCompact)) > 800000) return { ...base, unavailable: true };
  return { ...base, rawCompact, projectionHash: digest(rawCompact) };
}

function validProjection(value, entry) {
  return !!entry.sourceVersion && value?.schemaVersion === 1 && value.sourcePath === entry.path
    && value.source === entry.source && value.sourceVersion === entry.sourceVersion
    && value.rawCompact?.analysisSourceVersion === entry.sourceVersion
    && value.semesterId === (entry.scope.semesterId || entry.path.match(/^years\/(\d{4})\/semesters\/([12])\//)?.slice(1).join('-'))
    && value.rawCompact && !Array.isArray(value.rawCompact)
    && typeof value.projectionHash === 'string' && value.projectionHash === digest(value.rawCompact)
    && SCOPE_FIELDS.every(field => Object.hasOwn(value.rawCompact, field) === Object.hasOwn(entry.scope, field)
      && JSON.stringify(value.rawCompact[field]) === JSON.stringify(entry.scope[field]));
}

async function readAchievementProjections({ db, entries, json = jsonValue, budget = {} }) {
  const result = new Array(entries.length), missing = [];
  const account = (bytes, original = false) => {
    budget.documents = (budget.documents || 0) + 1;
    budget.projectionReadBytes = (budget.projectionReadBytes || 0) + bytes;
    if (original) {
      budget.resultReadBytes = (budget.resultReadBytes || 0) + bytes;
      if (budget.resultReadBytes > MAX_BYTES * 32) failBudget('QUIZ_ACHIEVEMENT_READ_BYTE_LIMIT');
    }
  };
  const retain = (raw, index) => {
    const entry = entries[index], bytes = Buffer.byteLength(JSON.stringify(raw));
    budget.bytes = (budget.bytes || 0) + bytes;
    budget.projectionRetainedBytes = (budget.projectionRetainedBytes || 0) + bytes;
    if (budget.documents > 30000 || budget.bytes > MAX_BYTES * 8) failBudget('QUIZ_ANALYSIS_REQUEST_LIMIT');
    if (budget.projectionRetainedBytes > MAX_BYTES * 4) failBudget('QUIZ_ANALYSIS_BYTE_LIMIT');
    result[index] = { id: entry.id, source: entry.source, path: entry.path, raw };
  };
  for (let offset = 0; offset < entries.length; offset += 100) {
    const batch = entries.slice(offset, offset + 100);
    const views = await db.getAll(...batch.map(entry => projectionRef(db, entry.path)));
    views.forEach((snapshot, index) => {
      const entry = batch[index], value = snapshot.exists ? snapshot.data() : null;
      budget.projectionReads = (budget.projectionReads || 0) + 1;
      account(value ? Buffer.byteLength(JSON.stringify(value)) : 0);
      if (validProjection(value, entry)) {
        budget.projectionHits = (budget.projectionHits || 0) + 1;
        retain(json(value.rawCompact), offset + index);
      } else missing.push(offset + index);
    });
  }
  for (let offset = 0; offset < missing.length; offset += 20) {
    const batches = [missing.slice(offset, offset + 10), missing.slice(offset + 10, offset + 20)].filter(batch => batch.length);
    const reads = await Promise.allSettled(batches.map(batch => db.getAll(...batch.map(index => db.doc(entries[index].path)),
      { fieldMask: PROJECTION_INPUT_FIELDS })));
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      if (reads[batchIndex].status === 'rejected') throw reads[batchIndex].reason;
      reads[batchIndex].value.forEach((snapshot, position) => {
        const index = batches[batchIndex][position], entry = entries[index];
        if (!snapshot.exists || sourceVersionOf(snapshot) !== entry.sourceVersion) failChanged();
        const raw = json(snapshot.data());
        if (!SCOPE_FIELDS.every(field => Object.hasOwn(raw, field) === Object.hasOwn(entry.scope, field)
          && JSON.stringify(raw[field]) === JSON.stringify(entry.scope[field]))) failChanged();
        budget.projectionFallbackReads = (budget.projectionFallbackReads || 0) + 1;
        account(Buffer.byteLength(JSON.stringify(raw)), true);
        retain({ ...projectAchievementRaw(raw), analysisSourceVersion: sourceVersionOf(snapshot) }, index);
      });
    }
  }
  return result;
}

function eventVersion(event) {
  const exact = sourceVersionOf(event.data?.after);
  if (exact) return exact;
  if (event.data?.after?.exists) return '';
  const match = text(event.time).match(/^(.{19})(?:\.(\d{1,9}))?Z$/);
  return match ? sourceVersionOf({ updateTime: { seconds: Date.parse(`${match[1]}Z`) / 1000,
    nanoseconds: Number((match[2] || '').padEnd(9, '0')) } }) : '';
}

async function updateAchievementProjection(db, event) {
  const source = event.params?.year ? 'legacy' : 'canonical', snapshot = event.data?.after;
  const sourcePath = source === 'canonical' ? `semester_assessment_results/${event.params.resultId}`
    : `years/${event.params.year}/semesters/${event.params.semester}/quiz_results/${event.params.resultId}`;
  const sourceVersion = eventVersion(event);
  if (!sourceVersion) return false;
  const raw = snapshot?.exists ? snapshot.data() : null;
  const previousRaw = event.data?.before?.exists ? event.data.before.data() : null;
  const semesterId = source === 'legacy' ? `${event.params.year}-${event.params.semester}` : raw?.semesterId || previousRaw?.semesterId;
  if (!/^\d{4}-[12]$/.test(semesterId || '')) return false;
  const isEligible = value => value && (source === 'legacy' || value.assessmentKind === 'QUIZ')
    && String(value.category || String(value.definitionId || '').split(':')[3] || '').startsWith('exam_prep');
  const eligible = isEligible(raw);
  if (!eligible && !isEligible(previousRaw)) return false;
  const value = eligible ? buildAchievementProjection({ sourcePath, source, sourceVersion, semesterId, raw })
    : { schemaVersion: 1, sourcePath, source, sourceVersion, semesterId, deleted: true };
  const ref = projectionRef(db, sourcePath);
  return db.runTransaction(async tx => {
    const [prior] = await tx.getAll(ref), current = prior.exists ? prior.data() : {};
    if (current.sourceVersion && current.sourceVersion >= sourceVersion) return false;
    tx.set(ref, value);
    return true;
  });
}

module.exports = { SCOPE_FIELDS, PROJECTION_INPUT_FIELDS, sourceVersionOf, projectionRef, projectAchievementRaw,
  buildAchievementProjection, validProjection, readAchievementProjections, updateAchievementProjection };
