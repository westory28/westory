const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');

const PAGE_SIZE = 20;
const MAX_RECORDS = 5000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const FIELDS = ['studentUid', 'uid', 'semesterId', 'assessmentKind', 'definitionId',
  'unitId', 'sourceId', 'category', 'examRound', 'title', 'unitTitle', 'score', 'percent',
  'total', 'correctCount', 'wrongCount', 'answerChecks', 'timestamp', 'submittedAtIso',
  'attemptId', 'canonicalAttemptId', 'resultId', 'legacyResultId', 'submissionRef', 'resultRef', 'status'];
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw new HttpsError(code, message); };
const milliseconds = value => typeof value?.toMillis === 'function' ? value.toMillis()
  : typeof value?.seconds === 'number' ? value.seconds * 1000
    : typeof value === 'string' ? Date.parse(value) || 0 : 0;
const scoreValue = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const validate = data => {
  if (!data || Object.keys(data).some(key => !['semesterId', 'mode', 'key', 'cursor', 'category', 'forceRefresh', '_session'].includes(key))
    || !/^\d{4}-[12]$/.test(data.semesterId || '')
    || !['list', 'detail'].includes(data.mode)
    || (data.category && !['diagnostic', 'formative', 'exam_prep'].includes(data.category))
    || (data.cursor && (typeof data.cursor !== 'string' || data.cursor.length > 100))
    || (data.forceRefresh !== undefined && typeof data.forceRefresh !== 'boolean')) {
    fail('invalid-argument', '조회할 평가 기록을 확인해 주세요.');
  }
  if (data.mode === 'detail' && (typeof data.key !== 'string' || !/^(canonical|legacy):[^/\x00-\x1f]{1,180}$/.test(data.key))) {
    fail('invalid-argument', '선택한 응시 기록을 확인해 주세요.');
  }
  return data;
};

function normalizeRows(documents, uid, semesterId, titles = {}) {
  const rows = documents.flatMap(({ id, source, raw }) => {
    if ((raw.studentUid || raw.uid) !== uid || (raw.uid && raw.uid !== uid)
      || (raw.semesterId && raw.semesterId !== semesterId)
      || (source === 'canonical' && raw.assessmentKind !== 'QUIZ')
      || ['cancelled', 'in_progress', 'STARTED', 'IN_PROGRESS', 'RECOVERABLE', 'LOCKED'].includes(raw.status)) return [];
    const parts = text(raw.definitionId).split(':');
    const unitId = text(raw.sourceId || raw.unitId || parts[2]);
    const originalCategory = text(raw.category || parts[3]);
    const category = originalCategory.startsWith('exam_prep') ? 'exam_prep' : originalCategory;
    const examRound = text(raw.examRound || parts[4] || (originalCategory.match(/round_\d+/) || [])[0]);
    const checks = Array.isArray(raw.answerChecks) ? raw.answerChecks.filter(x => typeof x?.correct === 'boolean') : [];
    const wrongCount = checks.length ? checks.filter(x => !x.correct).length
      : Number.isSafeInteger(raw.wrongCount) && raw.wrongCount >= 0 ? raw.wrongCount : null;
    return [{ key: `${source}:${id}`, source, id, unitId, category, examRound,
      title: text(raw.unitTitle || raw.title || titles[unitId]) || (category === 'exam_prep' ? '모의고사' : '단원명 미보관'),
      score: scoreValue(source === 'canonical' ? raw.percent : raw.score),
      submittedAtMs: milliseconds(raw.submittedAtIso || raw.timestamp) || null,
      totalCount: Number.isSafeInteger(raw.total) && raw.total >= 0 ? raw.total : checks.length || null,
      wrongCount,
      references: [id, raw.attemptId, raw.canonicalAttemptId, raw.resultId, raw.legacyResultId,
        text(raw.resultRef).split('/').pop(), text(raw.submissionRef).split('/').pop()].map(text).filter(Boolean) }];
  }).sort((a, b) => Number(b.source === 'canonical') - Number(a.source === 'canonical'));
  // Only explicit links identify a mirror; equal dates/scores never do.
  const parents = rows.map((_, index) => index), owners = new Map();
  const root = index => parents[index] === index ? index : (parents[index] = root(parents[index]));
  rows.forEach((row, index) => row.references.forEach(id => {
    if (owners.has(id)) {
      const a = root(owners.get(id)), b = root(index);
      parents[Math.max(a, b)] = Math.min(a, b);
    } else owners.set(id, index);
  }));
  return rows.filter((_, i) => root(i) === i).map(({ references, ...row }) => row)
    .sort((a, b) => (b.submittedAtMs || 0) - (a.submittedAtMs || 0) || a.key.localeCompare(b.key));
}

function canonicalDetail(id, raw, answers) {
  const parts = text(raw.definitionId).split(':');
  const originalCategory = text(raw.category || parts[3]);
  const recordedAtMs = milliseconds(raw.submittedAtIso || raw.timestamp) || null;
  const metadata = new Map((raw.learningSnapshot || []).map(q => [String(q.id), q]));
  const snapshots = new Map((raw.questionSnapshots || []).map(q => [String(q.id), q]));
  return {
    id, attemptId: raw.attemptId, studentUid: raw.studentUid, semesterId: raw.semesterId,
    unitId: raw.sourceId || raw.unitId || parts[2], title: text(raw.unitTitle || raw.title),
    category: originalCategory.startsWith('exam_prep') ? 'exam_prep' : originalCategory,
    examRound: text(raw.examRound || parts[4] || (originalCategory.match(/round_\d+/) || [])[0]),
    score: scoreValue(raw.percent), submittedAtIso: raw.submittedAtIso || '',
    timestamp: { seconds: (recordedAtMs || 0) / 1000 }, recordedAtMs,
    details: (raw.answerChecks || []).map(check => ({ ...metadata.get(String(check.id)),
      id: check.id, correct: typeof check.correct === 'boolean' ? check.correct : undefined,
      questionSnapshot: snapshots.get(String(check.id)) || null,
      ...(answers ? { u: text(answers[String(check.id)]), displayU: text(answers[String(check.id)]) } : {}) })),
  };
}

const createStudentQuizHistoryHandler = ({ db, assertSession = assertScoreWorkflowSession, now = () => Date.now() }) => async request => {
  const identity = await assertSession(request, { recentAuth: false, highRisk: false });
  const uid = request.auth?.uid;
  if (!uid || identity?.uid !== uid) fail('unauthenticated', '로그인 상태를 확인해 주세요.');
  const input = validate(request.data);
  const { semesterId } = input;
  // No caller-controlled UID is accepted, including on detail and cached reads.
  const [profile, manifest] = await db.getAll(db.doc(`users/${uid}`), db.doc(`semester_manifests/${semesterId}`));
  if (!profile.exists || !manifest.exists || !['ACTIVE', 'CLOSED', 'ARCHIVED'].includes(manifest.data().status)) {
    fail('permission-denied', '현재 계정의 학기 기록을 확인할 수 없습니다.');
  }
  const [year, semester] = semesterId.split('-');
  if (input.mode === 'detail') {
    const split = input.key.indexOf(':'), source = input.key.slice(0, split), id = input.key.slice(split + 1);
    const path = source === 'canonical' ? `semester_assessment_results/${id}` : `years/${year}/semesters/${semester}/quiz_results/${id}`;
    const snapshot = await db.doc(path).get(), raw = snapshot.data();
    if (!snapshot.exists || (raw.studentUid || raw.uid) !== uid || (raw.uid && raw.uid !== uid)
      || (source === 'canonical' && (raw.semesterId !== semesterId || raw.assessmentKind !== 'QUIZ'))
      || (raw.semesterId && raw.semesterId !== semesterId)) {
      fail('not-found', '본인의 제출 기록을 찾을 수 없습니다.');
    }
    const unitId = text(raw.sourceId || raw.unitId || text(raw.definitionId).split(':')[2]);
    if (!text(raw.unitTitle || raw.title) && unitId) {
      const tree = await db.doc(`years/${year}/semesters/${semester}/curriculum/tree`).get();
      const find = nodes => (Array.isArray(nodes) ? nodes : []).reduce((title, node) =>
        title || (String(node.id) === unitId ? text(node.title) : find(node.children)), '');
      raw.unitTitle = find(tree.data()?.tree);
    }
    if (source === 'legacy') return { semesterId, key: input.key, record: { ...raw, id,
      recordedAtMs: milliseconds(raw.timestamp) || null,
      timestamp: { seconds: milliseconds(raw.timestamp) / 1000 }, score: scoreValue(raw.score) } };
    let answers = raw.answers && typeof raw.answers === 'object' && !Array.isArray(raw.answers) ? raw.answers : null;
    if (!answers && raw.submissionRef === `semester_assessment_submissions/${id}` && raw.attemptId === id) {
      const submission = (await db.doc(raw.submissionRef).get()).data();
      if (submission && submission.studentUid === uid && submission.semesterId === semesterId && submission.attemptId === id) {
        answers = submission.answers && typeof submission.answers === 'object' && !Array.isArray(submission.answers) ? submission.answers : null;
      }
    }
    return { semesterId, key: input.key, record: canonicalDetail(id, raw, answers) };
  }
  const cacheId = hash(`${semesterId}\n${uid}`), cacheRef = db.doc(`quiz_analysis_student_history/${cacheId}`);
  const revisionRef = db.doc(`quiz_analysis_student_revisions/${cacheId}`);
  const [revision, cached] = await db.getAll(revisionRef, cacheRef);
  const generation = text(revision.data()?.generation);
  let cache = cached.data();
  if (input.forceRefresh || !cache || cache.schemaVersion !== 1 || cache.studentUid !== uid
    || cache.semesterId !== semesterId || cache.generation !== generation || now() - cache.generatedAt > CACHE_TTL_MS) {
    const read = async (collection, field, source) => {
      let query = db.collection(collection).where(field, '==', uid);
      if (source === 'canonical') query = query.where('semesterId', '==', semesterId);
      const result = await query.select(...FIELDS).limit(MAX_RECORDS + 1).get();
      if (result.size > MAX_RECORDS) fail('resource-exhausted', '응시 기록이 많아 조회를 완료하지 못했습니다. 담당 교사에게 문의해 주세요.');
      return result.docs.map(doc => ({ id: doc.id, source, raw: doc.data() }));
    };
    const [canonical, legacy, tree] = await Promise.all([
      read('semester_assessment_results', 'studentUid', 'canonical'),
      read(`years/${year}/semesters/${semester}/quiz_results`, 'uid', 'legacy'),
      db.doc(`years/${year}/semesters/${semester}/curriculum/tree`).get(),
    ]);
    const titles = {};
    const walk = nodes => (Array.isArray(nodes) ? nodes : []).forEach(node => { titles[node.id] = text(node.title); walk(node.children); });
    walk(tree.data()?.tree);
    const rows = normalizeRows([...canonical, ...legacy], uid, semesterId, titles);
    cache = { schemaVersion: 1, studentUid: uid, semesterId, generation, generatedAt: now(), rows,
      version: hash(JSON.stringify(rows)) };
    if (Buffer.byteLength(JSON.stringify(cache), 'utf8') < 900000) await cacheRef.set(cache);
    // A simultaneous submission invalidates this version on the next read; it
    // never waits for, or fails because of, this optional history cache.
  }
  const rows = cache.rows.filter(row => !input.category || row.category === input.category);
  let offset = 0;
  if (input.cursor) {
    const match = /^([a-f0-9]{64}):(\d+)$/.exec(input.cursor);
    if (!match || match[1] !== cache.version) fail('aborted', '새 응시 기록이 있습니다. 목록을 새로고침해 주세요.');
    offset = Number(match[2]);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > rows.length) fail('invalid-argument', '조회 위치를 확인해 주세요.');
  }
  return { semesterId, rows: rows.slice(offset, offset + PAGE_SIZE), totalCount: rows.length,
    nextCursor: offset + PAGE_SIZE < rows.length ? `${cache.version}:${offset + PAGE_SIZE}` : null,
    generatedAt: cache.generatedAt, version: cache.version };
};

module.exports = { createStudentQuizHistoryHandler, normalizeRows, canonicalDetail, validate, PAGE_SIZE, FIELDS };
