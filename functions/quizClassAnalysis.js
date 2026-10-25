const { createHash, randomUUID } = require('node:crypto');
const { FieldPath, FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { buildEnrollmentSlotId } = require('./productionGateway/archiveEnrollment');
const { buildQuizAnalysis } = require('./quizClassAnalysisCore.cjs');

const SCHEMA = 1;
const CACHE_TTL = 6 * 60 * 60 * 1000;
const PAGE_SIZE = 250;
const MAX_RESULTS = 10000;
const MAX_QUESTIONS = 5000;
const MAX_STUDENTS = 150;
const MAX_BYTES = 8 * 1024 * 1024;
const REGION = 'asia-northeast3';
const ADMIN_EMAIL = 'westoria28@gmail.com';
const text = value => String(value ?? '').trim();
const hash = value => createHash('sha256').update(value).digest('hex');
const root = scope => `years/${scope.slice(0, 4)}/semesters/${scope.slice(-1)}`;
const validScope = scope => typeof scope === 'string' && /^\d{4}-[12]$/.test(scope);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 180
  && value === value.trim() && !/[\x00-\x1f/]/.test(value) && !['.', '..'].includes(value);
const number = value => text(value).match(/\d+/)?.[0]?.replace(/^0+(?=\d)/, '') || '';
const fail = (code, message, reason) => { throw new HttpsError(code, message, { reason }); };
const iso = value => {
  const date = value?.toDate ? value.toDate() : typeof value?.seconds === 'number'
    ? new Date(value.seconds * 1000) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
};
const json = value => {
  if (value?.toDate || value instanceof Date) return iso(value);
  if (Array.isArray(value)) return value.map(json);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).map(([key, item]) => [key, json(item)]));
  return value;
};
const categoryOf = value => text(value).startsWith('exam_prep__round_') ? 'exam_prep' : text(value);
const roundOf = (category, value) => categoryOf(category) === 'exam_prep'
  ? /^round_[1-9]\d*$/.test(text(value)) ? text(value) : text(category).split('__')[1] || 'round_1' : '';
const definitionId = q => ['quiz', q.semesterId, q.unitId, q.category, q.examRound].filter(Boolean).join(':')
  .replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 180);
const classAlias = data => `${number(data.grade || data.studentGrade)}-${number(data.classNumber || data.class || data.studentClass)}`;
const stateRef = (db, scope) => db.doc(`quiz_class_analysis_state/${scope}`);
const classStateRef = (db, scope, id) => db.doc(`quiz_class_analysis_state/${scope}/classes/${hash(id)}`);
const studentRevisionRef = (db, scope, uid) => db.doc(`quiz_analysis_student_revisions/${hash(`${scope}\n${uid}`)}`);
const dataOf = snap => snap?.exists ? snap.data() : {};

function normalizeQuery(data) {
  const allowed = ['semesterId', 'mode', 'unitId', 'category', 'examRound', 'classIds', 'forceRefresh', '_session'];
  if (!data || typeof data !== 'object' || Object.keys(data).some(key => !allowed.includes(key))
    || !validScope(data.semesterId) || !['catalog', 'summary', 'detail'].includes(data.mode)
    || (data.forceRefresh !== undefined && typeof data.forceRefresh !== 'boolean')) {
    fail('invalid-argument', '조회할 학기와 평가를 확인해 주세요.', 'QUIZ_ANALYSIS_QUERY_INVALID');
  }
  const query = { semesterId: data.semesterId, mode: data.mode, forceRefresh: data.forceRefresh === true };
  if (query.mode === 'catalog') return query;
  if (!validId(data.unitId) || !['diagnostic', 'formative', 'exam_prep'].includes(data.category)
    || !Array.isArray(data.classIds) || data.classIds.length < 1 || data.classIds.length > (query.mode === 'detail' ? 1 : 4)
    || !data.classIds.every(validId) || new Set(data.classIds).size !== data.classIds.length
    || (data.category === 'exam_prep' && !/^round_[1-9]\d*$/.test(data.examRound || 'round_1'))
    || (data.category !== 'exam_prep' && data.examRound)) {
    fail('invalid-argument', '평가와 학급을 선택해 주세요. 비교는 최대 4개 학급까지 가능합니다.', 'QUIZ_ANALYSIS_QUERY_INVALID');
  }
  return { ...query, unitId: data.unitId, category: data.category, examRound: roundOf(data.category, data.examRound), classIds: data.classIds };
}

// Every source query is paginated and has a hard failure bound. A partial page
// is never returned as a complete class or used to calculate statistics.
async function readBounded(query, maximum, label) {
  let cursor;
  const documents = [];
  let bytes = 0;
  do {
    let page = query.orderBy(FieldPath.documentId()).limit(Math.min(PAGE_SIZE, maximum + 1 - documents.length));
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await page.get();
    for (const document of snapshot.docs) bytes += Buffer.byteLength(JSON.stringify(document.data()));
    if (bytes > MAX_BYTES * 4) fail('resource-exhausted', `${label}의 자료 크기가 조회 한도를 초과했습니다. 일부 자료만으로 분석하지 않습니다.`, 'QUIZ_ANALYSIS_BYTE_LIMIT');
    documents.push(...snapshot.docs);
    if (documents.length > maximum) fail('resource-exhausted', `${label}의 조회 범위를 초과했습니다. 결과를 일부만 표시하지 않습니다.`, 'QUIZ_ANALYSIS_LIMIT');
    if (snapshot.size < PAGE_SIZE) break;
    cursor = snapshot.docs.at(-1);
  } while (cursor);
  return documents;
}

const RESULT_FIELDS = ['studentUid', 'uid', 'studentId', 'userId', 'email', 'studentEmail', 'assessmentKind',
  'semesterId', 'unitId', 'sourceId', 'category', 'examRound', 'definitionId', 'answerChecks', 'details', 'answers',
  'learningSnapshot', 'questionSnapshots', 'score', 'percent', 'total', 'submittedAtIso', 'timestamp', 'createdAt',
  'attemptId', 'canonicalAttemptId', 'submissionRef', 'resultRef', 'resultId', 'legacyResultId'];
const QUESTION_FIELDS = ['id', 'unitId', 'subUnitId', 'category', 'type', 'refBig', 'refMid', 'refSmall',
  'contentRevision', 'revision', 'concepts', 'reviewLessonId', 'question', 'options'];

function adaptRecords(rawRows, students, semesterId) {
  const byEmail = new Map(students.filter(student => student.email).map(student => [student.email, student.uid]));
  return rawRows.flatMap(({ id, source, raw }) => {
    if (source === 'canonical' && raw.assessmentKind !== 'QUIZ') return [];
    const uid = text(raw.studentUid || raw.uid || raw.studentId || raw.userId) || byEmail.get(text(raw.email || raw.studentEmail));
    if (!uid) return [];
    const parts = text(raw.definitionId).split(':');
    const rawCategory = text(raw.category || parts[3]);
    const metadata = new Map((Array.isArray(raw.learningSnapshot) ? raw.learningSnapshot : []).map(item => [text(item.id), item]));
    const answerMap = raw.answers && typeof raw.answers === 'object' && !Array.isArray(raw.answers) ? raw.answers : null;
    return [{ id, source, studentUid: uid, semesterId: text(raw.semesterId) || semesterId,
      unitId: text(raw.sourceId || raw.unitId || parts[2]), category: categoryOf(rawCategory),
      examRound: roundOf(rawCategory, raw.examRound || parts[4]),
      submittedAt: iso(raw.submittedAtIso || raw.timestamp || raw.createdAt),
      scorePercent: typeof (source === 'canonical' ? raw.percent : raw.score) === 'number'
        ? (source === 'canonical' ? raw.percent : raw.score) : null,
      items: (Array.isArray(source === 'canonical' ? raw.answerChecks : raw.details) ? (source === 'canonical' ? raw.answerChecks : raw.details) : []).flatMap(item => {
        const questionId = text(item.id ?? item.qid ?? item.questionId);
        if (!questionId) return [];
        const meta = metadata.get(questionId) || {};
        const answer = source === 'canonical' ? answerMap ? answerMap[questionId] ?? '' : undefined : item.u ?? item.userAnswer ?? item.answer;
        return [{ questionId, correct: typeof item.correct === 'boolean' ? item.correct : null,
          ...(answer == null ? {} : { answer: String(answer) }), sourceRevision: meta.sourceRevision || item.sourceRevision,
          concepts: Array.isArray(meta.concepts) ? meta.concepts : [], reviewLessonId: meta.reviewLessonId }];
      }),
      attemptId: raw.attemptId, canonicalAttemptId: raw.canonicalAttemptId, submissionRef: raw.submissionRef,
      resultRef: raw.resultRef, resultId: raw.resultId, legacyResultId: raw.legacyResultId,
      totalCount: typeof raw.total === 'number' ? raw.total : undefined, definitionId: text(raw.definitionId),
    }];
  });
}

function summarizeClass(query, targetClass, students, questions, rawRows, generatedAt, version) {
  const records = adaptRecords(rawRows, students, query.semesterId);
  const summary = buildQuizAnalysis({ semesterId: query.semesterId, students, questions,
    records, scope: { unitIds: [query.unitId],
      category: query.category, examRound: query.examRound, classId: targetClass.id } });
  const questionMap = new Map(questions.map(question => [String(question.id), question]));
  const questionRows = summary.questions.map(item => {
    const q = questionMap.get(item.id) || {};
    return { id: item.id, question: text(q.question).replace(/<[^>]+>/g, '').slice(0, 220),
      subUnitId: text(q.subUnitId), concepts: q.concepts || [], reviewLessonId: text(q.reviewLessonId),
      correctCount: item.correctCount, wrongCount: item.wrongCount,
      respondentCount: item.assessedStudentCount, correctRate: item.correctRate,
      revisionExcludedCount: item.revisionExcludedCount, revisionUnknownCount: item.revisionUnknownCount };
  });
  const concepts = new Map();
  for (const student of summary.students) {
    for (const item of student.wrongConcepts) {
      const value = concepts.get(item.concept) || { concept: item.concept, wrongCount: 0, respondentCount: 0, reviewLessonIds: new Set() };
      value.wrongCount++;
      item.reviewLessonIds.forEach(id => value.reviewLessonIds.add(id));
      concepts.set(item.concept, value);
    }
  }
  for (const value of concepts.values()) {
    const ids = new Map(questions.map(q => [String(q.id), q.sourceRevision]));
    value.respondentCount = new Set(records.filter(record => record.items.some(item => ids.has(String(item.questionId))
      && ids.get(String(item.questionId)) === item.sourceRevision && (item.concepts || []).includes(value.concept)
      && typeof item.correct === 'boolean')).map(record => record.studentUid)).size;
  }
  return { classId: targetClass.id, label: targetClass.label, rosterCount: students.length,
    submittedCount: summary.participantCount, unsubmittedCount: Math.max(0, students.length - summary.participantCount),
    scoredCount: summary.scoredStudentCount, averageScore: summary.averageScore, scoreHistogram: summary.scoreHistogram,
    missingScoreCount: summary.missingScoreStudentCount, questions: questionRows,
    concepts: [...concepts.values()].map(value => ({ ...value, reviewLessonIds: [...value.reviewLessonIds] })).sort((a, b) => b.wrongCount - a.wrongCount),
    relearning: { repeatedStudentCount: summary.students.filter(s => s.changes.comparedQuestionCount > 0).length,
      wrongToCorrectCount: summary.students.reduce((sum, s) => sum + s.changes.wrongToCorrectCount, 0),
      correctToWrongCount: summary.students.reduce((sum, s) => sum + s.changes.correctToWrongCount, 0) },
    generatedAt, version, smallSample: summary.scoredStudentCount < 20,
    basis: 'latest_student_score_and_latest_current_revision_item', complete: true };
}

function createQuizClassAnalysisService({ db, now = () => Date.now() }) {
  const inFlight = new Map();
  const serial = (key, build) => {
    if (!inFlight.has(key)) inFlight.set(key, Promise.resolve().then(build).finally(() => inFlight.delete(key)));
    return inFlight.get(key);
  };
  const revision = async (scope, classId) => {
    const refs = [stateRef(db, scope), ...(classId ? [classStateRef(db, scope, classId)] : [])];
    const snapshots = await db.getAll(...refs);
    const state = dataOf(snapshots[0]);
    const value = { catalog: state.catalogGeneration || '', roster: state.rosterGeneration || '',
      content: state.contentGeneration || '', results: dataOf(snapshots[1]).generation || '' };
    return { refs, value, version: hash(JSON.stringify(value)) };
  };
  const cached = async (scope, key, classId, forceRefresh, build) => serial(key, async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = await revision(scope, classId);
      const ref = db.doc(`quiz_class_analysis_cache/${hash(key)}`);
      const saved = dataOf(await ref.get());
      if (!forceRefresh && saved.schemaVersion === SCHEMA && saved.version === before.version
        && Number(saved.expiresAtMs) > now() && saved.payload) return saved.payload;
      const payload = json(await build(before.version));
      if (Buffer.byteLength(JSON.stringify(payload)) > 850000) fail('resource-exhausted', '학급 분석 요약이 너무 큽니다. 평가 범위를 확인해 주세요.', 'QUIZ_ANALYSIS_CACHE_TOO_LARGE');
      const written = await db.runTransaction(async tx => {
        const snapshots = await tx.getAll(...before.refs);
        const state = dataOf(snapshots[0]);
        const currentVersion = hash(JSON.stringify({ catalog: state.catalogGeneration || '', roster: state.rosterGeneration || '',
          content: state.contentGeneration || '', results: dataOf(snapshots[1]).generation || '' }));
        if (currentVersion !== before.version) return false;
        tx.set(ref, { schemaVersion: SCHEMA, version: before.version, expiresAtMs: now() + CACHE_TTL, payload });
        return true;
      });
      if (written) return payload;
    }
    fail('aborted', '조회 중 평가 결과가 갱신되었습니다. 다시 조회해 주세요.', 'QUIZ_ANALYSIS_CHANGED');
  });
  const loadTree = async scope => {
    let snapshot = await db.doc(`${root(scope)}/curriculum/tree`).get();
    if (!snapshot.exists) snapshot = await db.doc('curriculum/tree').get();
    return dataOf(snapshot).tree || [];
  };
  const loadCatalog = async query => cached(query.semesterId, `catalog:${query.semesterId}`, '', query.forceRefresh, async () => {
    const [classes, definitions, questionDocs, treeData] = await Promise.all([
      readBounded(db.collection('semester_classes').where('semesterId', '==', query.semesterId), 300, '학급'),
      readBounded(db.collection('semester_assessment_definitions').where('semesterId', '==', query.semesterId), 1000, '평가'),
      readBounded(db.collection(`${root(query.semesterId)}/quiz_questions`).select('unitId', 'category'), MAX_QUESTIONS, '문항 목록'),
      loadTree(query.semesterId),
    ]);
    const unitTitles = new Map(treeData.flatMap(big => (big.children || []).map(mid => [String(mid.id), `${big.title} · ${mid.title}`])));
    const counts = new Map();
    questionDocs.forEach(doc => { const q = doc.data(); const key = `${q.unitId}\n${categoryOf(q.category)}`; counts.set(key, (counts.get(key) || 0) + 1); });
    const assessments = new Map();
    definitions.forEach(doc => {
      const item = doc.data();
      if (item.assessmentKind !== 'QUIZ') return;
      const category = categoryOf(item.category);
      if (!['diagnostic', 'formative', 'exam_prep'].includes(category)) return;
      const unitId = text(item.sourceId); const examRound = roundOf(item.category, item.examRound);
      const title = category === 'exam_prep' ? `모의고사 ${Number(examRound.replace('round_', ''))}회` : category === 'diagnostic' ? '진단평가' : '형성평가';
      assessments.set(`${unitId}\n${category}\n${examRound}`, { id: doc.id, unitId, unitTitle: unitTitles.get(unitId) || '모의고사', category, examRound,
        title, questionCount: counts.get(`${unitId}\n${category}`) || 0 });
    });
    for (const [key, questionCount] of counts) {
      const [unitId, category] = key.split('\n');
      if (!['diagnostic', 'formative', 'exam_prep'].includes(category)) continue;
      const examRound = roundOf(category, ''); const identity = `${unitId}\n${category}\n${examRound}`;
      if (!assessments.has(identity)) assessments.set(identity, { id: definitionId({ ...query, unitId, category, examRound }),
        unitId, unitTitle: unitTitles.get(unitId) || (category === 'exam_prep' ? '모의고사' : '단원명 미등록'), category, examRound,
        title: category === 'exam_prep' ? '모의고사 1회' : category === 'diagnostic' ? '진단평가' : '형성평가', questionCount });
    }
    return { semesterId: query.semesterId, classes: classes.filter(doc => doc.data().status === 'ACTIVE').map(doc => {
      const data = doc.data(); return { id: doc.id, label: `${data.grade}학년 ${data.classNumber}반`, grade: text(data.grade), classNumber: text(data.classNumber) };
    }).sort((a, b) => a.label.localeCompare(b.label, 'ko', { numeric: true })),
    assessments: [...assessments.values()].filter(item => item.questionCount > 0), treeData, generatedAt: new Date(now()).toISOString() };
  });
  const loadRoster = async (scope, targetClass) => {
    const enrollmentDocs = await readBounded(db.collection('semester_enrollments').where('classId', '==', targetClass.id), MAX_STUDENTS * 4, '학급 명단');
    const active = enrollmentDocs.filter(doc => {
      const d = doc.data(); return d.semesterId === scope && d.enrollmentStatus === 'ACTIVE'
        && ['', 'active'].includes(text(d.rosterExclusionStatus));
    });
    const slots = active.length ? await db.getAll(...active.map(doc => db.doc(`semester_enrollment_slots/${buildEnrollmentSlotId(scope, doc.data().studentUid)}`))) : [];
    const students = new Map();
    active.forEach((doc, index) => {
      const data = doc.data(), slot = dataOf(slots[index]);
      if (slot.activeEnrollmentId !== doc.id || slot.studentUid !== data.studentUid || slot.semesterId !== scope || (slot.status && slot.status !== 'ACTIVE')) return;
      students.set(data.studentUid, { uid: data.studentUid, name: text(data.displayName || data.studentName || data.snapshot?.displayName) || '이름 미등록',
        classId: targetClass.id, number: number(data.studentNumber || data.snapshot?.studentNumber) });
    });
    // Legacy profiles are considered only when no canonical slot owns that
    // student's semester. A stale profile can never bring a moved pupil back.
    const candidates = new Map();
    for (const field of ['class', 'studentClass']) {
      for (const value of [targetClass.classNumber, Number(targetClass.classNumber)]) {
        if (value === '' || (typeof value === 'number' && !Number.isFinite(value))) continue;
        const docs = await readBounded(db.collection('users').where(field, '==', value), 1000, '이전 학급 명단');
        for (const doc of docs) {
          const data = doc.data();
          if ((!data.role || data.role === 'student') && classAlias(data) === `${targetClass.grade}-${targetClass.classNumber}`
            && ['', 'active'].includes(text(data.enrollmentStatus))
            && (data.registrationApprovalStatus === undefined || data.registrationApprovalStatus === 'APPROVED')) candidates.set(doc.id, data);
        }
      }
    }
    const entries = [...candidates.entries()];
    const profileSlots = entries.length ? await db.getAll(...entries.map(([uid]) => db.doc(`semester_enrollment_slots/${buildEnrollmentSlotId(scope, uid)}`))) : [];
    entries.forEach(([uid, data], index) => {
      if (students.has(uid)) { students.get(uid).email = text(data.email); return; }
      if (profileSlots[index].exists) return;
      students.set(uid, { uid, name: text(data.studentName || data.name || data.displayName) || '이름 미등록',
        classId: targetClass.id, number: number(data.studentNumber || data.number), email: text(data.email) });
    });
    if (students.size > MAX_STUDENTS) fail('resource-exhausted', '학급 학생 수가 조회 한도를 초과했습니다.', 'QUIZ_ANALYSIS_ROSTER_LIMIT');
    return [...students.values()].sort((a, b) => Number(a.number) - Number(b.number) || a.uid.localeCompare(b.uid));
  };
  const loadQuestions = async (query, detail) => {
    let q = db.collection(`${root(query.semesterId)}/quiz_questions`).where('unitId', '==', query.unitId);
    if (!detail) q = q.select(...QUESTION_FIELDS);
    return (await readBounded(q, MAX_QUESTIONS, '문항')).filter(doc => categoryOf(doc.data().category) === query.category).map(doc => ({
      ...json(doc.data()), id: doc.data().id ?? Number(doc.id), docId: doc.id,
      sourceRevision: String(doc.data().contentRevision || doc.data().revision || 'legacy'),
    }));
  };
  const loadResults = async (query, students, detail = false) => {
    const rows = new Map(), uids = students.map(student => student.uid), emails = students.map(student => student.email).filter(Boolean);
    const uidSet = new Set(uids);
    const fields = detail ? RESULT_FIELDS : RESULT_FIELDS.filter(field => !['answers', 'questionSnapshots'].includes(field));
    const sources = [{ source: 'canonical', path: 'semester_assessment_results', fields: ['studentUid'], ids: uids },
      { source: 'legacy', path: `${root(query.semesterId)}/quiz_results`, fields: ['uid', 'studentUid', 'studentId', 'userId'], ids: uids },
      { source: 'legacy', path: `${root(query.semesterId)}/quiz_results`, fields: ['email', 'studentEmail'], ids: emails }];
    for (const source of sources) {
      for (const field of source.fields) {
        for (let offset = 0; offset < source.ids.length; offset += 30) {
          // Single-field queries deliberately avoid new composite-index rollout
          // dependencies. All reads are restricted to pupils in this class.
          const docs = await readBounded(db.collection(source.path).where(field, 'in', source.ids.slice(offset, offset + 30)).select(...fields), MAX_RESULTS, '학급 평가 기록');
          for (const doc of docs) {
            const data = doc.data(); const parts = text(data.definitionId).split(':');
            const owner = text(data.studentUid || data.uid || data.studentId || data.userId);
            if (owner && !uidSet.has(owner)) continue;
            if ((data.semesterId && data.semesterId !== query.semesterId) || (source.source === 'canonical' && data.assessmentKind !== 'QUIZ')
              || text(data.sourceId || data.unitId || parts[2]) !== query.unitId
              || categoryOf(data.category || parts[3]) !== query.category
              || roundOf(data.category || parts[3], data.examRound || parts[4]) !== query.examRound) continue;
            const raw = json(data);
            if (!detail && Array.isArray(raw.details)) raw.details = raw.details.map(item => ({ id: item.id ?? item.qid ?? item.questionId,
              correct: typeof item.correct === 'boolean' ? item.correct : null, sourceRevision: item.sourceRevision || '' }));
            rows.set(`${source.source}:${doc.id}`, { id: doc.id, source: source.source, raw });
          }
          if (rows.size > MAX_RESULTS) fail('resource-exhausted', '학급 평가 기록이 조회 한도를 초과했습니다.', 'QUIZ_ANALYSIS_LIMIT');
        }
      }
    }
    return [...rows.values()];
  };
  const query = async input => {
    const catalog = await loadCatalog({ ...input, forceRefresh: input.mode === 'catalog' && input.forceRefresh });
    if (input.mode === 'catalog') return catalog;
    const selectedClasses = input.classIds.map(id => catalog.classes.find(c => c.id === id || `${c.grade}-${c.classNumber}` === id));
    if (selectedClasses.some(c => !c) || new Set(selectedClasses.map(c => c.id)).size !== selectedClasses.length) fail('invalid-argument', '현재 학기의 학급을 다시 선택해 주세요.', 'QUIZ_ANALYSIS_CLASS_INVALID');
    if (!catalog.assessments.some(a => a.unitId === input.unitId && a.category === input.category && a.examRound === input.examRound)) fail('not-found', '선택한 평가를 찾을 수 없습니다. 목록을 다시 불러와 주세요.', 'QUIZ_ANALYSIS_ASSESSMENT_NOT_FOUND');
    let questionPromise;
    const questions = () => questionPromise ||= loadQuestions(input, input.mode === 'detail');
    if (input.mode === 'detail') {
      const targetClass = selectedClasses[0]; const students = await loadRoster(input.semesterId, targetClass);
      const [rawRows, questionRows, state] = await Promise.all([loadResults(input, students, true), questions(), revision(input.semesterId, targetClass.id)]);
      // Older canonical results contain checks but keep answers only in the
      // immutable submission. Fetch these only for explicit detail requests.
      const missingAnswers = rawRows.filter(row => row.source === 'canonical'
        && (!row.raw.answers || typeof row.raw.answers !== 'object' || Array.isArray(row.raw.answers)));
      for (let offset = 0; offset < missingAnswers.length; offset += 100) {
        const entries = missingAnswers.slice(offset, offset + 100).map(row => {
          const submittedId = text(row.raw.submissionRef).match(/^semester_assessment_submissions\/([^/]+)$/)?.[1]
            || text(row.raw.attemptId || row.id);
          return { row, submittedId };
        }).filter(entry => validId(entry.submittedId));
        if (!entries.length) continue;
        const submissions = await db.getAll(...entries.map(entry => db.doc(`semester_assessment_submissions/${entry.submittedId}`)));
        entries.forEach(({ row, submittedId }, index) => {
          const submission = dataOf(submissions[index]);
          if (submission.studentUid !== row.raw.studentUid || submission.semesterId !== input.semesterId
            || (submission.attemptId && submission.attemptId !== (row.raw.attemptId || row.id))
            || (submission.submissionId && submission.submissionId !== submittedId)
            || (submission.definitionId && submission.definitionId !== row.raw.definitionId)
            || !submission.answers || typeof submission.answers !== 'object' || Array.isArray(submission.answers)) return;
          row.raw.answers = json(submission.answers);
        });
      }
      const result = { semesterId: input.semesterId, students, rawRows, questions: questionRows, treeData: catalog.treeData,
        configuredClasses: [{ id: targetClass.id, label: targetClass.label }], generatedAt: new Date(now()).toISOString(), version: state.version, complete: true };
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) fail('resource-exhausted', '학급 상세 자료가 너무 큽니다. 요약을 확인하거나 평가 기록 범위를 점검해 주세요.', 'QUIZ_ANALYSIS_DETAIL_TOO_LARGE');
      return result;
    }
    const classes = [];
    for (const targetClass of selectedClasses) classes.push(await cached(input.semesterId,
      `summary:${input.semesterId}:${input.unitId}:${input.category}:${input.examRound}:${targetClass.id}`, targetClass.id, input.forceRefresh, async version => {
        const students = await loadRoster(input.semesterId, targetClass);
        const [rawRows, questionRows] = await Promise.all([loadResults(input, students), questions()]);
        return summarizeClass(input, targetClass, students, questionRows, rawRows, new Date(now()).toISOString(), version);
      }));
    return { semesterId: input.semesterId, unitId: input.unitId, category: input.category, examRound: input.examRound,
      classes, generatedAt: new Date(now()).toISOString() };
  };
  return { query, loadRoster, loadResults, loadCatalog, revision };
}

const createQuizClassAnalysisHandler = ({ db, assertSession = assertScoreWorkflowSession, service = createQuizClassAnalysisService({ db }) }) => async request => {
  const identity = await assertSession(request, { recentAuth: false, highRisk: false });
  if (!identity?.uid || identity.uid !== request.auth?.uid) fail('unauthenticated', '로그인 세션을 확인해 주세요.', 'QUIZ_ANALYSIS_SESSION_INVALID');
  const query = normalizeQuery(request.data);
  const profile = dataOf(await db.doc(`users/${identity.uid}`).get());
  const admin = text(identity.email).toLowerCase() === ADMIN_EMAIL && text(request.auth?.token?.email).toLowerCase() === ADMIN_EMAIL;
  if (!admin && profile.role !== 'teacher' && !(profile.teacherPortalEnabled === true
    && Array.isArray(profile.staffPermissions) && profile.staffPermissions.includes('quiz_read'))) {
    fail('permission-denied', '평가 분석 조회 권한이 필요합니다.', 'QUIZ_ANALYSIS_READ_FORBIDDEN');
  }
  const [config, pointer, manifest] = await db.getAll(db.doc('site_settings/config'), db.doc('site_settings/semester_active'), db.doc(`semester_manifests/${query.semesterId}`));
  const current = dataOf(config), active = dataOf(pointer), scope = dataOf(manifest);
  if (`${current.year}-${current.semester}` !== query.semesterId || current.activeSemesterId !== query.semesterId
    || active.semesterId !== query.semesterId || scope.semesterId !== query.semesterId || scope.status !== 'ACTIVE'
    || scope.readOnly === true || !Number.isSafeInteger(scope.revision) || scope.revision < 1 || active.revision !== scope.revision) {
    fail('failed-precondition', '현재 운영 학기에서 평가 분석을 다시 열어 주세요.', 'QUIZ_ANALYSIS_SEMESTER_NOT_ACTIVE');
  }
  return service.query(query);
};

function createQuizAnalysisInvalidation({ db }) {
  const invalidate = async (scope, fields) => {
    if (!validScope(scope)) return;
    await stateRef(db, scope).set({ ...Object.fromEntries(fields.map(field => [field, randomUUID()])), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  };
  const invalidateResult = async (scope, data) => {
    if (!validScope(scope) || !data) return;
    const uid = text(data.studentUid || data.uid || data.studentId || data.userId);
    const ids = new Set([text(data.classId)].filter(Boolean));
    if (validId(uid)) {
      const slot = dataOf(await db.doc(`semester_enrollment_slots/${buildEnrollmentSlotId(scope, uid)}`).get());
      if (validId(slot.activeEnrollmentId)) {
        const enrollment = dataOf(await db.doc(`semester_enrollments/${slot.activeEnrollmentId}`).get());
        if (enrollment.semesterId === scope && enrollment.studentUid === uid && validId(enrollment.classId)) ids.add(enrollment.classId);
      }
      await studentRevisionRef(db, scope, uid).set({ semesterId: scope, studentUid: uid, generation: randomUUID(), updatedAt: FieldValue.serverTimestamp() });
    }
    if (!ids.size) { await invalidate(scope, ['contentGeneration']); return; }
    await Promise.all([...ids].map(id => classStateRef(db, scope, id).set({ generation: randomUUID(), updatedAt: FieldValue.serverTimestamp() })));
  };
  const onResult = async event => {
    for (const snapshot of [event.data?.before, event.data?.after]) {
      if (!snapshot?.exists) continue;
      const value = snapshot.data();
      if (event.params?.year || value.assessmentKind === 'QUIZ') await invalidateResult(event.params?.year
        ? `${event.params.year}-${event.params.semester}` : value.semesterId, value);
    }
  };
  const onScope = fields => async event => {
    const scopes = new Set([event.params?.year ? `${event.params.year}-${event.params.semester}` : '',
      event.data?.before?.exists ? event.data.before.data().semesterId : '', event.data?.after?.exists ? event.data.after.data().semesterId : ''].filter(validScope));
    await Promise.all([...scopes].map(scope => invalidate(scope, fields)));
  };
  const onUser = async event => {
    const fields = ['role', 'name', 'studentName', 'displayName', 'grade', 'studentGrade', 'class', 'studentClass', 'number', 'studentNumber', 'email', 'enrollmentStatus', 'registrationApprovalStatus'];
    const before = dataOf(event.data?.before), after = dataOf(event.data?.after);
    if (!fields.some(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]))) return;
    const config = dataOf(await db.doc('site_settings/config').get());
    await invalidate(`${config.year}-${config.semester}`, ['rosterGeneration']);
  };
  return { onResult, onScope, onUser, invalidate, invalidateResult };
}

function createQuizAnalysisTriggers({ db }) {
  const service = createQuizAnalysisInvalidation({ db });
  const trigger = (document, handler) => onDocumentWritten({ document, region: REGION, retry: true, memory: '256MiB', maxInstances: 10 }, handler);
  return {
    invalidateQuizClassCanonicalResult: trigger('semester_assessment_results/{resultId}', service.onResult),
    invalidateQuizClassLegacyResult: trigger('years/{year}/semesters/{semester}/quiz_results/{resultId}', service.onResult),
    invalidateQuizClassQuestion: trigger('years/{year}/semesters/{semester}/quiz_questions/{questionId}', service.onScope(['catalogGeneration', 'contentGeneration'])),
    invalidateQuizClassEnrollment: trigger('semester_enrollments/{enrollmentId}', service.onScope(['rosterGeneration'])),
    invalidateQuizClassDefinition: trigger('semester_assessment_definitions/{definitionId}', service.onScope(['catalogGeneration'])),
    invalidateQuizClassMetadata: trigger('semester_classes/{classId}', service.onScope(['catalogGeneration', 'rosterGeneration'])),
    invalidateQuizClassCurriculum: trigger('years/{year}/semesters/{semester}/curriculum/{documentId}', service.onScope(['catalogGeneration'])),
    invalidateQuizClassProfile: trigger('users/{uid}', service.onUser),
  };
}

module.exports = { SCHEMA, CACHE_TTL, PAGE_SIZE, MAX_RESULTS, MAX_STUDENTS, normalizeQuery, readBounded,
  adaptRecords, summarizeClass, createQuizClassAnalysisService, createQuizClassAnalysisHandler,
  createQuizAnalysisInvalidation, createQuizAnalysisTriggers, hash, studentRevisionRef };
