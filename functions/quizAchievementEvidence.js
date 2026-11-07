const { normalizeAchievementMetadata } = require('./historyAchievementMetadata');
const { buildLessonAnswerKey } = require('./productionGateway/lessonAnswers');
const { createHash } = require('node:crypto');

const text = value => String(value ?? '').trim();
const iso = value => {
  if (value === null || value === undefined || value === '') return '';
  const date = value?.toDate ? value.toDate() : typeof value?.seconds === 'number'
    ? new Date(value.seconds * 1000) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
};
const knownRevision = value => typeof value === 'string' || typeof value === 'number'
  ? text(value) !== '' && text(value) !== 'legacy' : false;
const categoryOf = raw => text(raw.category || text(raw.definitionId).split(':')[3]);
const studentOf = raw => text(raw.studentUid || raw.uid || raw.studentId || raw.userId);
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

// Evidence is descriptive only. No grades, rewards or student records are written.
function buildQuizAchievementEvidence({ semesterId, students, questions, priorRows,
  examRows, attempts = [], lessons = [], progressRows = [] }) {
  const observations = [], examCutoffs = [], exclusions = {};
  const exclude = reason => { exclusions[reason] = (exclusions[reason] || 0) + 1; };
  const studentIds = new Set(students.map(student => student.uid));
  const byEmail = new Map(students.filter(student => student.email).map(student => [student.email, student.uid]));
  const owner = raw => studentOf(raw) || byEmail.get(text(raw.email || raw.studentEmail)) || '';
  const attemptById = new Map(attempts.map(attempt => [attempt.id, attempt.raw]));
  for (const row of examRows) {
    const raw = row.raw, studentUid = owner(raw), attemptId = text(raw.attemptId || row.id);
    if (!studentIds.has(studentUid)) continue;
    if (row.source === 'canonical' && (raw.semesterId !== semesterId || raw.assessmentKind !== 'QUIZ')) {
      exclude('wrongExamScope'); continue;
    }
    const submittedAt = iso(raw.submittedAtIso || raw.timestamp || raw.createdAt);
    let startedAt = row.source === 'canonical' ? iso(raw.startedAtIso) : '';
    let source = 'result';
    if (!startedAt && row.source === 'canonical') {
      const attempt = attemptById.get(attemptId);
      if (attempt && attempt.attemptId === attemptId && attempt.studentUid === studentUid
        && attempt.semesterId === semesterId && attempt.assessmentKind === 'QUIZ'
        && attempt.definitionId === raw.definitionId && attempt.resultRef === `semester_assessment_results/${row.id}`
        && iso(attempt.submittedAtIso) === submittedAt) {
        startedAt = iso(attempt.startedAtIso); source = 'attempt';
      }
    }
    if (!startedAt || !submittedAt || startedAt > submittedAt) { exclude('missingExamStart'); continue; }
    examCutoffs.push({ attemptId, resultId: row.id, studentUid, startedAt, source });
  }
  const canonicalIds = new Set(priorRows.filter(row => row.source === 'canonical')
    .flatMap(row => [row.id, row.raw.attemptId, row.raw.resultId].map(text).filter(Boolean)));
  const seen = new Set();
  for (const row of priorRows) {
    const raw = row.raw, studentUid = owner(raw), source = categoryOf(raw);
    if (!studentIds.has(studentUid) || !['diagnostic', 'formative'].includes(source)) continue;
    if ((raw.semesterId && raw.semesterId !== semesterId)
      || (row.source === 'canonical' && (raw.semesterId !== semesterId || raw.assessmentKind !== 'QUIZ'))) {
      exclude('wrongSemester'); continue;
    }
    if (row.source === 'legacy' && [raw.canonicalAttemptId, raw.attemptId, raw.resultId,
      text(raw.resultRef).split('/').at(-1), text(raw.submissionRef).split('/').at(-1)]
      .some(id => id && canonicalIds.has(text(id)))) { exclude('duplicateLegacyResult'); continue; }
    const observedAt = iso(raw.submittedAtIso || raw.timestamp || raw.createdAt);
    if (!observedAt) { exclude('missingObservationTime'); continue; }
    const metadata = new Map((Array.isArray(raw.learningSnapshot) ? raw.learningSnapshot : [])
      .map(item => [text(item.id), item]));
    const items = row.source === 'canonical' ? raw.answerChecks : raw.details;
    for (const item of Array.isArray(items) ? items : []) {
      const itemId = text(item.id ?? item.qid ?? item.questionId);
      const id = `${row.source}:${row.id}:${itemId}`;
      if (!itemId || seen.has(id)) continue;
      seen.add(id);
      const historical = row.source === 'canonical' ? historicalQuestionEvidence(raw, itemId) : null;
      const snapshot = historical?.metadata || metadata.get(itemId);
      const rawRevision = historical?.sourceRevision ?? snapshot?.sourceRevision ?? item.sourceRevision;
      if (!knownRevision(rawRevision)) { exclude('missingSourceRevision'); continue; }
      const sourceRevision = text(rawRevision);
      const meta = snapshot;
      if (!meta) { exclude('unavailableHistoricalMetadata'); continue; }
      if (typeof item.correct !== 'boolean') { exclude('missingCorrectness'); continue; }
      const telemetry = raw.analytics?.questions?.[itemId];
      const hintViewed = telemetry?.hintViewed === true ? true
        : telemetry?.quality === 'complete' && telemetry?.hintViewed === false ? false : null;
      const answer = row.source === 'canonical' ? raw.answers?.[itemId] : item.u ?? item.userAnswer ?? item.answer;
      const achievement = normalizeAchievementMetadata(meta);
      const limited = row.source !== 'canonical' || !snapshot || historical?.revisionBasis === 'frozen-snapshot' || meta.metadataLimited === true
        || hintViewed === null || !achievement.achievementStandardCodes?.length;
      observations.push({ id, studentUid, semesterId, source, itemId, sourceRevision, observedAt,
        ...achievement, achievementStandardCodes: achievement.achievementStandardCodes || [],
        correct: item.correct, filled: answer == null ? null : Boolean(text(answer)), hintViewed,
        unitId: text(meta.unitId || raw.sourceId || raw.unitId), subUnitId: text(meta.subUnitId),
        refBig: text(meta.refBig), refMid: text(meta.refMid), refSmall: text(meta.refSmall),
        familyId: text(meta.familyId), attemptId: text(raw.attemptId || row.id), resultId: row.id, questionId: itemId,
        recordSource: row.source, metadataSource: snapshot ? 'snapshot' : 'current',
        revisionBasis: historical?.revisionBasis || 'version',
        quality: limited ? 'limited' : 'complete' });
    }
  }
  const lessonByUnit = new Map();
  for (const lesson of lessons) {
    const unitId = text(lesson.unitId);
    if (!unitId) continue;
    lessonByUnit.set(unitId, lessonByUnit.has(unitId) ? null : lesson);
  }
  for (const row of progressRows) {
    if (!studentIds.has(row.studentUid)) continue;
    const progress = row.raw, unitId = text(progress.unitId || row.id), lesson = lessonByUnit.get(unitId);
    if (!lesson) { exclude('unavailableLesson'); continue; }
    if ((progress.studentUid && progress.studentUid !== row.studentUid)
      || (progress.semesterId && progress.semesterId !== semesterId)) { exclude('wrongWorksheetOwner'); continue; }
    const observedAt = iso(progress.updatedAt);
    if (!observedAt) { exclude('missingWorksheetTime'); continue; }
    if (!Object.hasOwn(progress, 'contentRevision')
      || !Number.isSafeInteger(progress.contentRevision) || progress.contentRevision < 0
      || progress.contentRevision !== (lesson.contentRevision ?? 0)) { exclude('worksheetRevisionMismatch'); continue; }
    let keys;
    try { keys = [...buildLessonAnswerKey(lesson).keys()]; }
    catch { exclude('invalidLessonBlanks'); continue; }
    const achievement = normalizeAchievementMetadata(lesson);
    for (const itemId of keys) {
      const answer = progress.answers?.[itemId], filled = Boolean(text(answer?.value));
      observations.push({ id: `worksheet:${row.studentUid}:${unitId}:${itemId}`,
        studentUid: row.studentUid, semesterId, source: 'worksheet', itemId: `${unitId}:${itemId}`,
        sourceRevision: String(progress.contentRevision), observedAt,
        ...achievement, achievementStandardCodes: achievement.achievementStandardCodes || [],
        correct: !filled ? false : answer?.status === 'correct' ? true : answer?.status === 'wrong' ? false : null,
        filled, hintViewed: null, unitId, subUnitId: text(lesson.subUnitId),
        familyId: `worksheet:${unitId}:${itemId}`, metadataSource: 'lesson', quality: 'limited' });
    }
  }
  return { version: 1, status: Object.keys(exclusions).length || observations.some(item => item.quality === 'limited')
    ? 'partial' : 'ready', observations, examCutoffs, exclusions };
}

module.exports = { buildQuizAchievementEvidence, historicalQuestionEvidence, packHistoricalQuestionSnapshots };
