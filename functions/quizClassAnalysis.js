const { createHash, randomUUID } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const { FieldPath, FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { buildEnrollmentSlotId } = require('./productionGateway/archiveEnrollment');
const { buildQuizAnalysis } = require('./quizClassAnalysisCore.cjs');
const { ACHIEVEMENT_FIELDS, normalizeAchievementMetadata } = require('./historyAchievementMetadata');
const { historicalQuestionEvidence, packHistoricalQuestionSnapshots } = require('./quizAchievementEvidence');

const SCHEMA = 4;
const CACHE_TTL = 6 * 60 * 60 * 1000;
const PAGE_SIZE = 250;
const MAX_RESULTS = 10000;
const MAX_QUESTIONS = 5000;
const MAX_STUDENTS = 150;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_GRADE_CLASSES = 30;
const MAX_SEARCH_MATCHES = 500;
const RESULT_QUERY_CONCURRENCY = 8;
const KEYWORD_BASIS = 'latest_current_revision_keyword_items';
const BEHAVIOR_CATEGORIES = ['suspected_guessing', 'repeated_choice', 'unflagged', 'insufficient', 'no_attempt'];
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
const mockExamTitle = round => {
  const n = Number(text(round).replace('round_', '')) || 1;
  return `${['초시', '복시', '전시'][n - 1] || '모의고사'} (${n}회 모의고사)`;
};
const definitionId = q => ['quiz', q.semesterId, q.unitId, q.category, q.examRound].filter(Boolean).join(':')
  .replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 180);
const classAlias = data => `${number(data.grade || data.studentGrade)}-${number(data.classNumber || data.class || data.studentClass)}`;
const stateRef = (db, scope) => db.doc(`quiz_class_analysis_state/${scope}`);
const classStateRef = (db, scope, id) => db.doc(`quiz_class_analysis_state/${scope}/classes/${hash(id)}`);
const studentRevisionRef = (db, scope, uid) => db.doc(`quiz_analysis_student_revisions/${hash(`${scope}\n${uid}`)}`);
const dataOf = snap => snap?.exists ? snap.data() : {};

function normalizeQuery(data) {
  const allowed = ['semesterId', 'mode', 'unitId', 'category', 'examRound', 'classIds', 'grade', 'forceRefresh', 'keyword', 'comparisonGrade', 'compactEvidence', '_session'];
  if (!data || typeof data !== 'object' || Object.keys(data).some(key => !allowed.includes(key))
    || !validScope(data.semesterId) || !['catalog', 'summary', 'detail', 'achievement'].includes(data.mode)
    || (data.forceRefresh !== undefined && typeof data.forceRefresh !== 'boolean')
    || (data.compactEvidence !== undefined && typeof data.compactEvidence !== 'boolean')
    || (data.compactEvidence === true && data.mode !== 'achievement')) {
    fail('invalid-argument', '조회할 학기와 평가를 확인해 주세요.', 'QUIZ_ANALYSIS_QUERY_INVALID');
  }
  // The prior client dereferences diagnostic evidence in successful responses.
  // Fail explicitly before any analysis reads rather than returning a new shape
  // to an already-open tab that has not received the cumulative-score client.
  if (data.compactEvidence === true)
    fail('failed-precondition', '모의고사 점수 분석으로 변경되었습니다. 화면을 새로고침해 주세요.', 'QUIZ_ACHIEVEMENT_CLIENT_RETIRED');
  const query = { semesterId: data.semesterId, mode: data.mode, forceRefresh: data.forceRefresh === true };
  const keyword = typeof data.keyword === 'string' ? data.keyword.normalize('NFC').trim().replace(/\s+/g, ' ') : undefined;
  if (data.keyword !== undefined && (typeof data.keyword !== 'string' || !keyword
    || keyword.length > 80 || /[\x00-\x1f]/.test(keyword) || !searchText(keyword))) {
    fail('invalid-argument', '검색어는 1~80자로 입력해 주세요.', 'QUIZ_ANALYSIS_KEYWORD_INVALID');
  }
  if (data.comparisonGrade !== undefined && (data.mode !== 'summary' || typeof data.comparisonGrade !== 'string'
    || !/^[1-9]\d?$/.test(data.comparisonGrade))) {
    fail('invalid-argument', '비교할 학년을 확인해 주세요.', 'QUIZ_ANALYSIS_GRADE_INVALID');
  }
  if (data.grade !== undefined && (data.mode === 'catalog' || typeof data.grade !== 'string'
    || !/^[1-9]\d?$/.test(data.grade) || data.comparisonGrade !== undefined)) {
    fail('invalid-argument', '분석할 학년을 확인해 주세요.', 'QUIZ_ANALYSIS_GRADE_INVALID');
  }
  if (query.mode === 'catalog') return query;
  if (!Array.isArray(data.classIds) || (data.grade ? data.classIds.length !== 0
    : data.classIds.length < 1 || data.classIds.length > (['detail', 'achievement'].includes(query.mode) ? 1 : 4))
    || !data.classIds.every(validId) || new Set(data.classIds).size !== data.classIds.length
    || (!keyword && (!validId(data.unitId) || !['diagnostic', 'formative', 'exam_prep'].includes(data.category)
      || (data.category === 'exam_prep' && !/^round_[1-9]\d*$/.test(data.examRound || 'round_1'))
      || (data.category !== 'exam_prep' && data.examRound)))) {
    fail('invalid-argument', '평가와 학급 또는 학년을 선택해 주세요. 학급 비교는 최대 4개까지 가능합니다.', 'QUIZ_ANALYSIS_QUERY_INVALID');
  }
  if (query.mode === 'achievement' && (keyword || data.comparisonGrade || data.category !== 'exam_prep'))
    fail('invalid-argument', '성취 분석은 모의고사와 학급 또는 학년을 선택해 주세요.', 'QUIZ_ACHIEVEMENT_SCOPE_INVALID');
  return { ...query, unitId: keyword ? '' : data.unitId, category: keyword ? '' : data.category,
    examRound: keyword ? '' : roundOf(data.category, data.examRound), classIds: data.classIds,
    ...(keyword ? { keyword } : {}), ...(data.grade ? { grade: data.grade } : {}),
    ...(data.comparisonGrade ? { comparisonGrade: data.comparisonGrade } : {}) };
}

// Every source query is paginated and has a hard failure bound. A partial page
// is never returned as a complete class or used to calculate statistics.
async function readBounded(query, maximum, label, budget) {
  let cursor;
  const documents = [];
  let bytes = 0;
  do {
    let page = query.orderBy(FieldPath.documentId()).limit(Math.min(PAGE_SIZE, maximum + 1 - documents.length));
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await page.get();
    let pageBytes = 0;
    for (const document of snapshot.docs) pageBytes += Buffer.byteLength(JSON.stringify(document.data()));
    bytes += pageBytes;
    if (budget) {
      budget.documents += snapshot.size; budget.bytes += pageBytes;
      if (budget.documents > 30000 || budget.bytes > MAX_BYTES * 8) {
        fail('resource-exhausted', '선택한 범위의 조회 한도를 초과했습니다. 일부 학급만으로 비교하지 않습니다.', 'QUIZ_ANALYSIS_REQUEST_LIMIT');
      }
    }
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
  'learningSnapshot', 'earnedPoints', 'maxPoints', 'questionSnapshots', 'questionSnapshotOmittedIds', 'analytics', 'score', 'percent', 'total', 'submittedAtIso', 'timestamp', 'createdAt',
  'attemptId', 'canonicalAttemptId', 'submissionRef', 'resultRef', 'resultId', 'legacyResultId', 'startedAtIso', 'sourceHash'];
const RESULT_SCOPE_FIELDS = ['studentUid', 'uid', 'studentId', 'userId', 'email', 'studentEmail',
  'assessmentKind', 'semesterId', 'sourceId', 'unitId', 'category', 'examRound', 'definitionId'];
const SCORE_FIELDS = [...RESULT_SCOPE_FIELDS, 'percent', 'score', 'total', 'earnedPoints', 'maxPoints',
  'learningSnapshot', 'submittedAtIso', 'timestamp', 'createdAt', 'attemptId', 'canonicalAttemptId',
  'submissionRef', 'resultRef', 'resultId', 'legacyResultId', 'sourceHash'];
const QUESTION_FIELDS = ['id', 'unitId', 'subUnitId', 'category', 'type', 'refBig', 'refMid', 'refSmall',
  'contentRevision', 'revision', 'concepts', 'reviewLessonId', 'question', 'options', 'examRound', 'paperOrder', 'points', 'paperBreakBefore',
  'familyId', 'cognitiveProcess', 'cognitiveProcesses', ...ACHIEVEMENT_FIELDS];
const SEARCH_FIELDS = [...QUESTION_FIELDS, 'passage', 'explanation', 'matchingPairs'];
const searchText = value => text(value).normalize('NFC').toLocaleLowerCase('ko')
  .replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi, ' ').replace(/\s+/g, ' ').trim();
const questionSearchText = question => searchText([question.question, question.passage, question.explanation,
  ...(Array.isArray(question.options) ? question.options : []), ...(Array.isArray(question.concepts) ? question.concepts : []),
  ...(Array.isArray(question.matchingPairs) ? question.matchingPairs.flatMap(pair => [pair.left, pair.right]) : [])].filter(Boolean).join(' '));

const versionOf = (snapshots, kind) => {
  const state = dataOf(snapshots[0]);
  // The picker catalog has no student roster, answers or result statistics.
  // Its source triggers advance catalogGeneration independently of those data.
  if (kind === 'catalog') return hash(JSON.stringify({ catalog: state.catalogGeneration || '' }));
  return hash(JSON.stringify(kind === 'content' ? { content: state.contentGeneration || '' }
    : { catalog: state.catalogGeneration || '', roster: state.rosterGeneration || '',
      content: state.contentGeneration || '', results: dataOf(snapshots[1]).generation || '' }));
};

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
      analytics: raw.analytics,
      behaviorAnswersAvailable: raw.behaviorAnswersAvailable !== false && source === 'canonical' && !!answerMap,
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
    records, scope: query.keyword ? { questionIds: questions.map(question => String(question.id)),
      scoreBasis: 'latest_current_revision_items', classId: targetClass.id }
      : { unitIds: [query.unitId], category: query.category, examRound: query.examRound, classId: targetClass.id } });
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
  const behaviorCounts = Object.fromEntries(BEHAVIOR_CATEGORIES.map(category => [category, 0]));
  for (const student of summary.students) {
    const behaviorCategory = student.behavior?.category;
    behaviorCounts[BEHAVIOR_CATEGORIES.includes(behaviorCategory) ? behaviorCategory : student.attemptCount > 0 ? 'insufficient' : 'no_attempt']++;
    for (const concept of student.assessedConcepts) {
      const value = concepts.get(concept) || { concept, wrongCount: 0, respondentCount: 0, reviewLessonIds: new Set() };
      value.respondentCount++;
      concepts.set(concept, value);
    }
    for (const item of student.wrongConcepts) {
      const value = concepts.get(item.concept) || { concept: item.concept, wrongCount: 0, respondentCount: 0, reviewLessonIds: new Set() };
      value.wrongCount++;
      item.reviewLessonIds.forEach(id => value.reviewLessonIds.add(id));
      concepts.set(item.concept, value);
    }
  }
  return { classId: targetClass.id, label: targetClass.label, rosterCount: students.length,
    submittedCount: summary.participantCount, unsubmittedCount: Math.max(0, students.length - summary.participantCount),
    scoredCount: summary.scoredStudentCount, averageScore: summary.averageScore, scoreHistogram: summary.scoreHistogram,
    missingScoreCount: summary.missingScoreStudentCount, questions: questionRows, behaviorCounts,
    concepts: [...concepts.values()].map(value => ({ ...value, reviewLessonIds: [...value.reviewLessonIds] })).sort((a, b) => b.wrongCount - a.wrongCount),
    relearning: { repeatedStudentCount: summary.students.filter(s => s.changes.comparedQuestionCount > 0).length,
      wrongToCorrectCount: summary.students.reduce((sum, s) => sum + s.changes.wrongToCorrectCount, 0),
      correctToWrongCount: summary.students.reduce((sum, s) => sum + s.changes.correctToWrongCount, 0) },
    generatedAt, version, smallSample: summary.scoredStudentCount < 20,
    basis: query.keyword ? KEYWORD_BASIS : 'latest_student_score_and_latest_current_revision_item', complete: true };
}

function summarizeGrade(grade, classes, generatedAt) {
  const sum = key => classes.reduce((total, value) => total + (value[key] || 0), 0);
  const scoredCount = sum('scoredCount');
  const questions = new Map(), concepts = new Map();
  for (const value of classes) {
    for (const item of value.questions) {
      const combined = questions.get(item.id) || { ...item, correctCount: 0, wrongCount: 0,
        respondentCount: 0, revisionExcludedCount: 0, revisionUnknownCount: 0 };
      for (const field of ['correctCount', 'wrongCount', 'respondentCount', 'revisionExcludedCount', 'revisionUnknownCount']) combined[field] += item[field] || 0;
      combined.correctRate = combined.respondentCount ? 100 * combined.correctCount / combined.respondentCount : null;
      questions.set(item.id, combined);
    }
    for (const item of value.concepts) {
      const combined = concepts.get(item.concept) || { concept: item.concept, wrongCount: 0, respondentCount: 0, reviewLessonIds: [] };
      combined.wrongCount += item.wrongCount; combined.respondentCount += item.respondentCount;
      combined.reviewLessonIds = [...new Set([...combined.reviewLessonIds, ...(item.reviewLessonIds || [])])];
      concepts.set(item.concept, combined);
    }
  }
  return { classId: `grade:${grade}`, label: `${grade}학년 전체`, grade, classCount: classes.length,
    respondingClassCount: classes.filter(value => value.scoredCount > 0).length, weighting: 'scored_students',
    rosterCount: sum('rosterCount'), submittedCount: sum('submittedCount'), unsubmittedCount: sum('unsubmittedCount'),
    scoredCount, missingScoreCount: sum('missingScoreCount'), averageScore: scoredCount
      ? classes.reduce((total, value) => total + (value.averageScore ?? 0) * value.scoredCount, 0) / scoredCount : null,
    behaviorCounts: Object.fromEntries(BEHAVIOR_CATEGORIES.map(category => [category,
      classes.reduce((total, value) => total + (value.behaviorCounts?.[category] || 0), 0)])),
    scoreHistogram: (classes[0]?.scoreHistogram || []).map((band, index) => ({ ...band,
      count: classes.reduce((total, value) => total + value.scoreHistogram[index].count, 0) })),
    questions: [...questions.values()], concepts: [...concepts.values()].filter(value => value.wrongCount > 0).sort((a, b) => b.wrongCount - a.wrongCount),
    relearning: Object.fromEntries(['repeatedStudentCount', 'wrongToCorrectCount', 'correctToWrongCount']
      .map(field => [field, classes.reduce((total, value) => total + value.relearning[field], 0)])),
    generatedAt, version: hash(classes.map(value => `${value.classId}:${value.version}`).sort().join('\n')),
    smallSample: scoredCount < 20, basis: classes[0]?.basis, complete: true };
}

function selectClasses(classes, input) {
  const selected = input.grade ? classes.filter(entry => entry.grade === input.grade)
    : input.classIds.map(id => classes.find(entry => entry.id === id || `${number(entry.grade)}-${number(entry.classNumber)}` === id));
  if (input.grade && (!selected.length || selected.length > MAX_GRADE_CLASSES))
    fail('invalid-argument', '분석할 학년의 학급 범위를 확인해 주세요.', 'QUIZ_ANALYSIS_GRADE_INVALID');
  if (input.grade && new Set(selected.map(entry => entry.classNumber)).size !== selected.length)
    fail('aborted', '학급 정보가 중복되어 있습니다. 학급 목록을 확인한 뒤 다시 조회해 주세요.', 'QUIZ_ANALYSIS_ROSTER_CONFLICT');
  if (selected.some(entry => !entry) || new Set(selected.map(entry => entry.id)).size !== selected.length)
    fail('invalid-argument', '현재 학기의 학급을 다시 선택해 주세요.', 'QUIZ_ANALYSIS_CLASS_INVALID');
  return selected;
}

function createQuizClassAnalysisService({ db, now = () => Date.now() }) {
  const inFlight = new Map();
  const serial = (key, build) => {
    if (!inFlight.has(key)) inFlight.set(key, Promise.resolve().then(build).finally(() => inFlight.delete(key)));
    return inFlight.get(key);
  };
  const revision = async (scope, classId, kind) => {
    const refs = [stateRef(db, scope), ...(classId ? [classStateRef(db, scope, classId)] : [])];
    const snapshots = await db.getAll(...refs);
    const state = dataOf(snapshots[0]);
    const value = { catalog: state.catalogGeneration || '', roster: state.rosterGeneration || '',
      content: state.contentGeneration || '', results: dataOf(snapshots[1]).generation || '' };
    return { refs, value, version: versionOf(snapshots, kind) };
  };
  const scopeRevision = async (scope, classes) => {
    const snapshots = await db.getAll(stateRef(db, scope), ...classes.map(entry => classStateRef(db, scope, entry.id)));
    return hash(classes.map((entry, index) => `${entry.id}:${versionOf([snapshots[0], snapshots[index + 1]])}`).join('\n'));
  };
  const cached = async (scope, key, classId, forceRefresh, build, kind) => serial(key, async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = await revision(scope, classId, kind);
      const ref = db.doc(`quiz_class_analysis_cache/${hash(key)}`);
      const saved = dataOf(await ref.get());
      if (!forceRefresh && saved.schemaVersion === SCHEMA && saved.version === before.version
        && Number(saved.expiresAtMs) > now() && saved.payload) return saved.payload;
      const payload = json(await build(before.version));
      if (Buffer.byteLength(JSON.stringify(payload)) > 850000) fail('resource-exhausted', '학급 분석 요약이 너무 큽니다. 평가 범위를 확인해 주세요.', 'QUIZ_ANALYSIS_CACHE_TOO_LARGE');
      const written = await db.runTransaction(async tx => {
        const snapshots = await tx.getAll(...before.refs);
        const currentVersion = versionOf(snapshots, kind);
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
  const loadSearchCatalog = async query => {
    const packed = await cached(query.semesterId, `search:v1:${query.semesterId}`, '', false, async version => {
      const documents = await readBounded(db.collection(`${root(query.semesterId)}/quiz_questions`).select(...SEARCH_FIELDS), MAX_QUESTIONS, '검색 문항');
      const rows = documents.filter(doc => ['diagnostic', 'formative', 'exam_prep'].includes(categoryOf(doc.data().category)))
        .map(doc => {
          const data = doc.data();
          return { ...Object.fromEntries(QUESTION_FIELDS.filter(field => Object.hasOwn(data, field)).map(field => [field, json(data[field])])),
            id: data.id ?? Number(doc.id), docId: doc.id, sourceRevision: String(data.contentRevision || data.revision || 'legacy'),
            searchText: questionSearchText(data) };
        });
      return { compressed: gzipSync(JSON.stringify(rows)).toString('base64'), version, generatedAt: new Date(now()).toISOString() };
    }, 'content');
    const rows = JSON.parse(gunzipSync(Buffer.from(packed.compressed, 'base64'), { maxOutputLength: MAX_BYTES * 4 }).toString('utf8'));
    const tokens = searchText(query.keyword).split(' ');
    const matches = rows.filter(row => tokens.every(token => row.searchText.includes(token))).map(({ searchText: _text, ...row }) => row);
    if (matches.length > MAX_SEARCH_MATCHES) fail('resource-exhausted', '검색 문항이 500개를 초과했습니다. 검색어를 더 구체적으로 입력해 주세요.', 'QUIZ_ANALYSIS_SEARCH_LIMIT');
    return { questions: matches, version: packed.version, search: { keyword: query.keyword,
      matchedQuestionCount: matches.length, unitCount: new Set(matches.map(row => row.unitId).filter(Boolean)).size,
      questionIds: matches.map(row => String(row.id)), generatedAt: packed.generatedAt } };
  };
  const loadCatalog = async query => cached(query.semesterId, `catalog:${query.semesterId}`, '', query.forceRefresh, async () => {
    const [classes, definitions, questionDocs, treeData] = await Promise.all([
      readBounded(db.collection('semester_classes').where('semesterId', '==', query.semesterId)
        .select('status', 'grade', 'classNumber'), 300, '학급'),
      readBounded(db.collection('semester_assessment_definitions').where('semesterId', '==', query.semesterId)
        .select('assessmentKind', 'sourceId', 'category', 'examRound'), 1000, '평가'),
      readBounded(db.collection(`${root(query.semesterId)}/quiz_questions`).select('unitId', 'category', 'examRound'), MAX_QUESTIONS, '문항 목록'),
      loadTree(query.semesterId),
    ]);
    const unitTitles = new Map(treeData.flatMap(big => (big.children || []).map(mid => [String(mid.id), `${big.title} · ${mid.title}`])));
    const counts = new Map();
    questionDocs.forEach(doc => { const q = doc.data(); const key = `${q.unitId}\n${categoryOf(q.category)}`; counts.set(key, (counts.get(key) || 0) + 1); });
    const taggedUnits = new Set(questionDocs.filter(doc => categoryOf(doc.data().category) === 'exam_prep' && doc.data().examRound).map(doc => text(doc.data().unitId)));
    const paperCounts = new Map();
    questionDocs.forEach(doc => { const q = doc.data(); if (categoryOf(q.category) !== 'exam_prep' || !q.examRound) return;
      const key = `${q.unitId}\n${q.examRound}`; paperCounts.set(key, (paperCounts.get(key) || 0) + 1); });
    const questionCountFor = (unitId, category, round) => category === 'exam_prep' && taggedUnits.has(unitId)
      ? paperCounts.get(`${unitId}\n${round}`) || 0 : counts.get(`${unitId}\n${category}`) || 0;
    const assessments = new Map();
    definitions.forEach(doc => {
      const item = doc.data();
      if (item.assessmentKind !== 'QUIZ') return;
      const category = categoryOf(item.category);
      if (!['diagnostic', 'formative', 'exam_prep'].includes(category)) return;
      const unitId = text(item.sourceId); const examRound = roundOf(item.category, item.examRound);
      const title = category === 'exam_prep' ? mockExamTitle(examRound) : category === 'diagnostic' ? '진단평가' : '형성평가';
      assessments.set(`${unitId}\n${category}\n${examRound}`, { id: doc.id, unitId, unitTitle: unitTitles.get(unitId) || '모의고사', category, examRound,
        title, questionCount: questionCountFor(unitId, category, examRound) });
    });
    for (const [key, questionCount] of counts) {
      const [unitId, category] = key.split('\n');
      if (!['diagnostic', 'formative', 'exam_prep'].includes(category)) continue;
      if (category === 'exam_prep' && taggedUnits.has(unitId)) {
        for (const [paperKey, paperCount] of paperCounts) {
          const [paperUnit, examRound] = paperKey.split('\n');
          if (paperUnit !== unitId) continue;
          const identity = `${unitId}\n${category}\n${examRound}`;
          if (!assessments.has(identity)) assessments.set(identity, { id: definitionId({ ...query, unitId, category, examRound }),
            unitId, unitTitle: '모의고사', category, examRound, title: mockExamTitle(examRound), questionCount: paperCount });
        }
        continue;
      }
      const examRound = roundOf(category, ''); const identity = `${unitId}\n${category}\n${examRound}`;
      if (!assessments.has(identity)) assessments.set(identity, { id: definitionId({ ...query, unitId, category, examRound }),
        unitId, unitTitle: unitTitles.get(unitId) || (category === 'exam_prep' ? '모의고사' : '단원명 미등록'), category, examRound,
        title: category === 'exam_prep' ? mockExamTitle(examRound) : category === 'diagnostic' ? '진단평가' : '형성평가', questionCount });
    }
    return { semesterId: query.semesterId, classes: classes.filter(doc => doc.data().status === 'ACTIVE').map(doc => {
      const data = doc.data(); return { id: doc.id, label: `${data.grade}학년 ${data.classNumber}반`, grade: text(data.grade), classNumber: text(data.classNumber) };
    }).sort((a, b) => a.label.localeCompare(b.label, 'ko', { numeric: true })),
    assessments: [...assessments.values()].filter(item => item.questionCount > 0), treeData, generatedAt: new Date(now()).toISOString() };
  }, 'catalog');
  const loadRoster = async (scope, targetClass, budget) => {
    // Both historical class fields accept string/number values. Read each field
    // once and overlap those independent reads with the canonical roster.
    const classValues = [...new Set([targetClass.classNumber, Number(targetClass.classNumber)])]
      .filter(value => value !== '' && (typeof value !== 'number' || Number.isFinite(value)));
    const [enrollmentDocs, ...profileGroups] = await Promise.all([
      readBounded(db.collection('semester_enrollments').where('classId', '==', targetClass.id)
        .select('semesterId', 'studentUid', 'enrollmentStatus', 'rosterExclusionStatus',
          'displayName', 'studentName', 'studentNumber', 'snapshot'), MAX_STUDENTS * 4, '학급 명단', budget),
      ...['class', 'studentClass'].map(field => classValues.length ? readBounded(db.collection('users')
        .where(field, 'in', classValues).select('role', 'grade', 'studentGrade', 'classNumber', 'class', 'studentClass',
          'enrollmentStatus', 'registrationApprovalStatus', 'studentName', 'name', 'displayName',
          'studentNumber', 'number', 'email'), 2000, '이전 학급 명단', budget) : []),
    ]);
    const active = enrollmentDocs.filter(doc => {
      const d = doc.data(); return d.semesterId === scope && d.enrollmentStatus === 'ACTIVE'
        && ['', 'active'].includes(text(d.rosterExclusionStatus));
    });
    const candidates = new Map();
    for (const docs of profileGroups) for (const doc of docs) {
      const data = doc.data();
      if ((!data.role || data.role === 'student') && classAlias(data) === `${targetClass.grade}-${targetClass.classNumber}`
        && ['', 'active'].includes(text(data.enrollmentStatus))
        && (data.registrationApprovalStatus === undefined || data.registrationApprovalStatus === 'APPROVED')) candidates.set(doc.id, data);
    }
    const slotUids = [...new Set([...active.map(doc => doc.data().studentUid), ...candidates.keys()])];
    const slotDocs = slotUids.length ? await db.getAll(...slotUids.map(uid => db.doc(`semester_enrollment_slots/${buildEnrollmentSlotId(scope, uid)}`)),
      { fieldMask: ['activeEnrollmentId', 'studentUid', 'semesterId', 'status'] }) : [];
    const slots = new Map(slotUids.map((uid, index) => [uid, slotDocs[index]]));
    const students = new Map();
    active.forEach(doc => {
      const data = doc.data(), slot = dataOf(slots.get(data.studentUid));
      if (slot.activeEnrollmentId !== doc.id || slot.studentUid !== data.studentUid || slot.semesterId !== scope || (slot.status && slot.status !== 'ACTIVE')) return;
      students.set(data.studentUid, { uid: data.studentUid, name: text(data.displayName || data.studentName || data.snapshot?.displayName) || '이름 미등록',
        classId: targetClass.id, number: number(data.studentNumber || data.snapshot?.studentNumber) });
    });
    // Legacy profiles are considered only when no canonical slot owns that
    // student's semester. A stale profile can never bring a moved pupil back.
    const entries = [...candidates.entries()];
    entries.forEach(([uid, data]) => {
      if (students.has(uid)) { students.get(uid).email = text(data.email); return; }
      if (slots.get(uid)?.exists) return;
      students.set(uid, { uid, name: text(data.studentName || data.name || data.displayName) || '이름 미등록',
        classId: targetClass.id, number: number(data.studentNumber || data.number), email: text(data.email) });
    });
    if (students.size > MAX_STUDENTS) fail('resource-exhausted', '학급 학생 수가 조회 한도를 초과했습니다.', 'QUIZ_ANALYSIS_ROSTER_LIMIT');
    return [...students.values()].sort((a, b) => Number(a.number) - Number(b.number) || a.uid.localeCompare(b.uid));
  };
  const loadScopeRoster = async (scope, classes, budget) => {
    const rosters = new Array(classes.length);
    let cursor = 0, failure;
    await Promise.all(Array.from({ length: Math.min(3, classes.length) }, async () => {
      while (!failure && cursor < classes.length) {
        const index = cursor++;
        try { rosters[index] = await loadRoster(scope, classes[index], budget); }
        catch (error) { failure ||= error; }
      }
    }));
    if (failure) throw failure;
    const students = rosters.flat();
    if (new Set(students.map(student => student.uid)).size !== students.length)
      fail('aborted', '학생의 소속 학급이 중복되어 있습니다. 학급 명단을 확인한 뒤 다시 조회해 주세요.', 'QUIZ_ANALYSIS_ROSTER_CONFLICT');
    return students;
  };
  const loadQuestions = async (query, detail, budget, fields = detail ? null : QUESTION_FIELDS) => {
    const collection = () => db.collection(`${root(query.semesterId)}/quiz_questions`).where('unitId', '==', query.unitId);
    const projected = request => fields ? request.select(...fields) : request;
    let documents;
    if (query.category === 'exam_prep') {
      // A fixed paper needs only its own round, including historical category
      // aliases. Do not transfer other rounds' passages, images or answers.
      documents = (await readBounded(projected(collection().where('examRound', '==', query.examRound)), MAX_QUESTIONS, '문항', budget))
        .filter(doc => categoryOf(doc.data().category) === query.category);
      if (!documents.length) {
        const metadata = (await readBounded(collection().select('category', 'examRound'), MAX_QUESTIONS, '문항 범위', budget))
          .filter(doc => categoryOf(doc.data().category) === query.category);
        // Preserve the original untagged bank only when no authored round
        // exists. An empty fixed round must never borrow a different paper.
        documents = [];
        if (!metadata.some(doc => doc.data().examRound)) {
          let bytes = 0;
          for (let offset = 0; offset < metadata.length; offset += 100) {
            const refs = metadata.slice(offset, offset + 100).map(doc => doc.ref);
            const rows = await db.getAll(...refs, ...(fields ? [{ fieldMask: fields }] : []));
            if (rows.some(doc => !doc.exists || doc.data().unitId !== query.unitId
              || categoryOf(doc.data().category) !== query.category || doc.data().examRound))
              fail('aborted', '조회 중 평가 문항이 갱신되었습니다. 다시 조회해 주세요.', 'QUIZ_ANALYSIS_CHANGED');
            const batchBytes = rows.reduce((sum, doc) => sum + Buffer.byteLength(JSON.stringify(doc.data())), 0);
            bytes += batchBytes;
            if (bytes > MAX_BYTES * 4) fail('resource-exhausted', '문항의 자료 크기가 조회 한도를 초과했습니다.', 'QUIZ_ANALYSIS_BYTE_LIMIT');
            if (budget) {
              budget.documents += rows.length; budget.bytes += batchBytes;
              if (budget.documents > 30000 || budget.bytes > MAX_BYTES * 8)
                fail('resource-exhausted', '선택한 범위의 조회 한도를 초과했습니다. 일부 학급만으로 비교하지 않습니다.', 'QUIZ_ANALYSIS_REQUEST_LIMIT');
            }
            documents.push(...rows);
          }
        }
      }
    } else {
      documents = await readBounded(projected(collection().where('category', '==', query.category)), MAX_QUESTIONS, '문항', budget);
    }
    return documents.map(doc => ({
      ...json(doc.data()), id: doc.data().id ?? (query.mode === 'achievement' ? doc.id : Number(doc.id)), docId: doc.id,
      sourceRevision: String(query.mode === 'achievement'
        ? doc.data().contentRevision ?? doc.data().revision ?? 'legacy'
        : doc.data().contentRevision || doc.data().revision || 'legacy'),
    }));
  };
  const loadResults = async (query, students, detail = false, budget, cumulativeMockExams = false) => {
    const rows = new Map(), candidates = new Map(), jobs = [];
    const uids = [...new Set(students.map(student => student.uid))];
    const emails = [...new Set(students.map(student => student.email).filter(Boolean))];
    const uidSet = new Set(uids), emailSet = new Set(emails);
    const fields = detail ? RESULT_FIELDS : RESULT_FIELDS.filter(field => field !== 'questionSnapshots');
    const sources = [{ source: 'canonical', path: 'semester_assessment_results', fields: ['studentUid'], ids: uids },
      { source: 'legacy', path: `${root(query.semesterId)}/quiz_results`, fields: ['uid', 'studentUid', 'studentId', 'userId'], ids: uids },
      { source: 'legacy', path: `${root(query.semesterId)}/quiz_results`, fields: ['email', 'studentEmail'], ids: emails }];
    const matches = (data, source) => {
      const owner = text(data.studentUid || data.uid || data.studentId || data.userId);
      if (owner ? !uidSet.has(owner) : !emailSet.has(text(data.email || data.studentEmail))) return false;
      if ((data.semesterId && data.semesterId !== query.semesterId) || (source === 'canonical'
        && (data.assessmentKind !== 'QUIZ' || data.semesterId !== query.semesterId))) return false;
      const parts = text(data.definitionId).split(':'), category = categoryOf(data.category || parts[3]);
      const round = roundOf(data.category || parts[3], data.examRound || parts[4]);
      return query.keyword || (text(data.sourceId || data.unitId || parts[2]) === query.unitId && category === query.category
        && (round === query.examRound || (cumulativeMockExams && Number(round.slice(6)) <= Number(query.examRound.slice(6)))));
    };
    const add = (doc, source) => {
      const data = doc.data(), raw = json(data);
      raw.behaviorAnswersAvailable = source === 'canonical' && !!data.answers
        && typeof data.answers === 'object' && !Array.isArray(data.answers);
      if (!detail && Array.isArray(raw.details)) raw.details = raw.details.map(item => ({ id: item.id ?? item.qid ?? item.questionId,
        correct: typeof item.correct === 'boolean' ? item.correct : null, sourceRevision: item.sourceRevision || '' }));
      rows.set(`${source}:${doc.id}`, { id: doc.id, source, raw });
      if (rows.size > MAX_RESULTS) fail('resource-exhausted', '학급 평가 기록이 조회 한도를 초과했습니다.', 'QUIZ_ANALYSIS_LIMIT');
    };
    const schedule = (source, filters, metadataOnly) => {
      // Firestore's 30-disjunction bound includes both the pupil and category/definition lists.
      const alternatives = filters.reduce((count, [, operator, value]) => count * (operator === 'in' ? value.length : 1), 1);
      const batchSize = Math.max(1, Math.floor(30 / alternatives));
      for (const field of source.fields) for (let offset = 0; offset < source.ids.length; offset += batchSize) {
        const ids = source.ids.slice(offset, offset + batchSize);
        jobs.push(async () => {
          let request = db.collection(source.path).where(field, 'in', ids);
          if (source.source === 'canonical') request = request.where('semesterId', '==', query.semesterId).where('assessmentKind', '==', 'QUIZ');
          for (const filter of filters) request = request.where(...filter);
          const docs = await readBounded(request.select(...(metadataOnly ? RESULT_SCOPE_FIELDS : fields)), MAX_RESULTS, '학급 평가 기록', budget);
          for (const doc of docs) {
            if (!matches(doc.data(), source.source)) continue;
            const key = `${source.source}:${doc.id}`;
            if (!metadataOnly) add(doc, source.source);
            else candidates.set(key, { source: source.source, path: `${source.path}/${doc.id}`,
              scope: json(doc.data()) });
          }
          if (candidates.size > MAX_RESULTS) fail('resource-exhausted', '학급 평가 기록이 조회 한도를 초과했습니다.', 'QUIZ_ANALYSIS_LIMIT');
        });
      }
    };
    const selectedDefinitions = query.keyword ? [] : [...new Set([definitionId(query),
      ...(query.category === 'exam_prep' ? [definitionId({ ...query, category: `exam_prep__${query.examRound}`, examRound: '' }),
        ...(query.examRound === 'round_1' ? [definitionId({ ...query, examRound: '' })] : [])] : [])])];
    if (cumulativeMockExams && uids.length) {
      // The original three rounds also had results without source/category
      // fields and definitions without sourceId. Keep exact ID compatibility.
      for (const examRound of ['round_1', 'round_2', 'round_3'].filter(round => Number(round.slice(6)) <= Number(query.examRound.slice(6)))) {
        for (const id of [definitionId({ ...query, examRound }),
          definitionId({ ...query, category: `exam_prep__${examRound}`, examRound: '' }),
          ...(examRound === 'round_1' ? [definitionId({ ...query, examRound: '' })] : [])])
          if (!selectedDefinitions.includes(id)) selectedDefinitions.push(id);
      }
      const definitions = await readBounded(db.collection('semester_assessment_definitions')
        .where('semesterId', '==', query.semesterId).where('assessmentKind', '==', 'QUIZ')
        .where('sourceId', '==', query.unitId).select('sourceId', 'category', 'examRound'),
        1000, '모의고사 정의', budget);
      for (const document of definitions) {
        const value = document.data(), parts = document.id.split(':');
        const category = categoryOf(value.category || parts[3]);
        const round = roundOf(value.category || parts[3], value.examRound || parts[4]);
        if (category === 'exam_prep' && Number(round.slice(6)) <= Number(query.examRound.slice(6))
          && !selectedDefinitions.includes(document.id)) selectedDefinitions.push(document.id);
      }
    }
    for (const source of sources) {
      if (!source.ids.length) continue;
      if (query.keyword) { schedule(source, [], false); continue; }
      // Legacy plain exam_prep records may have no examRound (round 1). Read
      // only small scope fields first; other rounds' bodies are never fetched.
      const categories = query.category === 'exam_prep' ? ['exam_prep', `exam_prep__${query.examRound}`] : [query.category];
      // Legacy QuizRunner always stored unitId/category. Only canonical results
      // predate sourceId/category and need the definition-id compatibility path.
      schedule(source, [[source.source === 'canonical' ? 'sourceId' : 'unitId', '==', query.unitId],
        ...(cumulativeMockExams ? [] : [['category', categories.length === 1 ? '==' : 'in', categories.length === 1 ? categories[0] : categories]])], true);
      if (source.source === 'canonical') for (let offset = 0; offset < selectedDefinitions.length; offset += 30) {
        const ids = selectedDefinitions.slice(offset, offset + 30);
        schedule(source, [['definitionId', ids.length === 1 ? '==' : 'in', ids.length === 1 ? ids[0] : ids]], true);
      }
    }
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(RESULT_QUERY_CONCURRENCY, jobs.length) }, async () => {
      while (cursor < jobs.length) await jobs[cursor++]();
    }));
    const pending = [...candidates.entries()].filter(([key]) => !rows.has(key)).map(([, candidate]) => candidate);
    let bodyBytes = 0;
    const isSelectedRound = candidate => {
      const raw = candidate.scope, parts = text(raw.definitionId).split(':');
      return roundOf(raw.category || parts[3], raw.examRound || parts[4]) === query.examRound;
    };
    const groups = cumulativeMockExams
      ? [{ entries: pending.filter(isSelectedRound), fields },
        { entries: pending.filter(candidate => !isSelectedRound(candidate)), fields: SCORE_FIELDS }]
      : [{ entries: pending, fields }];
    for (const group of groups) for (let offset = 0; offset < group.entries.length; offset += 100) {
      const batch = group.entries.slice(offset, offset + 100);
      const docs = await db.getAll(...batch.map(candidate => db.doc(candidate.path)), { fieldMask: group.fields });
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i], candidate = batch[i];
        if (!doc.exists || !matches(doc.data(), candidate.source)
          || RESULT_SCOPE_FIELDS.some(field => Object.hasOwn(doc.data(), field) !== Object.hasOwn(candidate.scope, field)
            || JSON.stringify(json(doc.data()[field])) !== JSON.stringify(candidate.scope[field])))
          fail('aborted', '조회 중 평가 기록이 변경되었습니다. 다시 조회해 주세요.', 'QUIZ_ANALYSIS_CHANGED');
        const bytes = Buffer.byteLength(JSON.stringify(doc.data()));
        bodyBytes += bytes;
        if (budget) {
          budget.documents++; budget.bytes += bytes;
          if (budget.documents > 30000 || budget.bytes > MAX_BYTES * 8)
            fail('resource-exhausted', '선택한 범위의 조회 한도를 초과했습니다. 일부 학급만으로 비교하지 않습니다.', 'QUIZ_ANALYSIS_REQUEST_LIMIT');
        }
        if (bodyBytes > MAX_BYTES * 4) fail('resource-exhausted', '평가 기록의 자료 크기가 조회 한도를 초과했습니다.', 'QUIZ_ANALYSIS_BYTE_LIMIT');
        add(doc, candidate.source);
      }
    }
    return [...rows.values()];
  };
  const buildMockExamScoreRows = async (rows, students, input, budget) => {
    const byEmail = new Map(students.filter(student => student.email).map(student => [student.email, student.uid]));
    const result = rows.map(row => {
      const raw = row.raw, parts = text(raw.definitionId).split(':');
      const studentUid = text(raw.studentUid || raw.uid || raw.studentId || raw.userId)
        || byEmail.get(text(raw.email || raw.studentEmail));
      const metadata = Array.isArray(raw.learningSnapshot) ? raw.learningSnapshot : [];
      const presentations = new Map((Array.isArray(raw.questionSnapshots) ? raw.questionSnapshots : []).map(item => [text(item.id), item]));
      const cutScoreQuestions = metadata.map(item => ({ id: text(item.id),
        ...(Number.isFinite(item.points ?? presentations.get(text(item.id))?.points)
          ? { points: item.points ?? presentations.get(text(item.id)).points } : {}),
        ...(item.targetAchievementLevel ? { targetAchievementLevel: item.targetAchievementLevel } : {}),
        ...(item.intendedDifficulty ? { intendedDifficulty: item.intendedDifficulty } : {}) }));
      const projected = Object.fromEntries(SCORE_FIELDS.filter(field => Object.hasOwn(raw, field)
        && field !== 'learningSnapshot').map(field => [field, raw[field]]));
      return { id: row.id, source: row.source, raw: { ...projected, studentUid,
        semesterId: input.semesterId, category: 'exam_prep',
        examRound: roundOf(raw.category || parts[3], raw.examRound || parts[4]), cutScoreQuestions } };
    });
    // Learning metadata predates frozen points. Recover only the matching
    // attempt's small grading snapshot; never read a previous paper's images,
    // answer telemetry, submissions, or the current question bank as a fallback.
    const missingPoints = result.filter(row => row.source === 'canonical' && Number.isFinite(row.raw.maxPoints)
      && row.raw.maxPoints > 0 && row.raw.cutScoreQuestions.length
      && row.raw.cutScoreQuestions.some(item => !Number.isFinite(item.points)));
    const fields = ['attemptId', 'studentUid', 'semesterId', 'assessmentKind', 'definitionId',
      'resultRef', 'submittedAtIso', 'sourceHash', 'gradingSnapshot'];
    for (let offset = 0; offset < missingPoints.length; offset += 100) {
      const entries = missingPoints.slice(offset, offset + 100).map(row => ({ row, id: text(row.raw.attemptId || row.id) }))
        .filter(entry => validId(entry.id));
      if (!entries.length) continue;
      const docs = await db.getAll(...entries.map(entry => db.doc(`semester_assessment_attempts/${entry.id}`)), { fieldMask: fields });
      entries.forEach(({ row, id }, index) => {
        const attempt = dataOf(docs[index]);
        const bytes = Buffer.byteLength(JSON.stringify(attempt));
        budget.documents++; budget.bytes += bytes;
        if (budget.documents > 30000 || budget.bytes > MAX_BYTES * 8)
          fail('resource-exhausted', '선택한 범위의 조회 한도를 초과했습니다.', 'QUIZ_ANALYSIS_REQUEST_LIMIT');
        if (attempt.attemptId !== id || attempt.studentUid !== row.raw.studentUid
          || attempt.semesterId !== input.semesterId || attempt.assessmentKind !== 'QUIZ'
          || attempt.definitionId !== row.raw.definitionId
          || attempt.resultRef !== `semester_assessment_results/${row.id}`
          || !iso(row.raw.submittedAtIso) || iso(attempt.submittedAtIso) !== iso(row.raw.submittedAtIso)
          || (row.raw.sourceHash && attempt.sourceHash !== row.raw.sourceHash)) return;
        const grading = new Map((Array.isArray(attempt.gradingSnapshot) ? attempt.gradingSnapshot : []).map(item => [text(item.id), item]));
        row.raw.cutScoreQuestions = row.raw.cutScoreQuestions.map(item => ({ ...item,
          ...(!Number.isFinite(item.points) && Number.isFinite(grading.get(item.id)?.points)
            ? { points: grading.get(item.id).points } : {}) }));
      });
    }
    return result;
  };
  const query = async input => {
    const budget = { documents: 0, bytes: 0 };
    const gradeRevision = input.grade ? await revision(input.semesterId, '') : null;
    if (input.mode === 'achievement') {
      // Explicitly requested evidence is read afresh. This route never creates
      // a catalog/cache record and never changes grading or worksheet progress.
      const classDocs = await readBounded(db.collection('semester_classes').where('semesterId', '==', input.semesterId), 300, '학급', budget);
      const selectedClasses = selectClasses(classDocs.filter(doc => doc.data().status === 'ACTIVE').map(doc => ({
        id: doc.id, grade: text(doc.data().grade), classNumber: text(doc.data().classNumber),
        label: `${doc.data().grade}학년 ${doc.data().classNumber}반`,
      })).sort((a, b) => a.label.localeCompare(b.label, 'ko', { numeric: true })), input);
      const version = await scopeRevision(input.semesterId, selectedClasses);
      const students = await loadScopeRoster(input.semesterId, selectedClasses, budget);
      const [allRows, questions, treeData] = await Promise.all([
        loadResults(input, students, true, budget, true),
        loadQuestions(input, false, budget, [...QUESTION_FIELDS, 'answer']),
        loadTree(input.semesterId),
      ]);
      if (!questions.length) fail('not-found', '선택한 모의고사를 찾을 수 없습니다.', 'QUIZ_ANALYSIS_ASSESSMENT_NOT_FOUND');
      const rawRows = allRows.filter(row => {
        const raw = row.raw, parts = text(raw.definitionId).split(':');
        return text(raw.sourceId || raw.unitId || parts[2]) === input.unitId
          && categoryOf(raw.category || parts[3]) === 'exam_prep'
          && roundOf(raw.category || parts[3], raw.examRound || parts[4]) === input.examRound;
      });
      for (const row of rawRows.filter(row => row.source === 'canonical')) {
        const metadata = new Map((row.raw.learningSnapshot || []).map(item => [text(item.id), item]));
        for (const item of row.raw.answerChecks || []) {
          const itemId = text(item.id), historical = historicalQuestionEvidence(row.raw, itemId);
          if (historical?.revisionBasis !== 'frozen-snapshot') continue;
          const source = historical.metadata;
          metadata.set(itemId, { ...(metadata.get(itemId) || {}), id: itemId,
            sourceRevision: historical.sourceRevision, revisionBasis: historical.revisionBasis, metadataLimited: true,
            unitId: text(source.unitId), subUnitId: text(source.subUnitId), refBig: text(source.refBig),
            refMid: text(source.refMid), refSmall: text(source.refSmall), familyId: text(source.familyId),
            ...normalizeAchievementMetadata(source) });
        }
        row.raw.learningSnapshot = [...metadata.values()];
      }
      const missingAnswers = rawRows.filter(row => row.source === 'canonical'
        && (!row.raw.answers || typeof row.raw.answers !== 'object' || Array.isArray(row.raw.answers)));
      for (let offset = 0; offset < missingAnswers.length; offset += 100) {
        const entries = missingAnswers.slice(offset, offset + 100).map(row => ({ row,
          id: text(row.raw.submissionRef).match(/^semester_assessment_submissions\/([^/]+)$/)?.[1] || text(row.raw.attemptId || row.id) }))
          .filter(entry => validId(entry.id));
        if (!entries.length) continue;
        const documents = await db.getAll(...entries.map(entry => db.doc(`semester_assessment_submissions/${entry.id}`)));
        entries.forEach(({ row, id }, index) => {
          const submission = dataOf(documents[index]);
          if (submission.studentUid !== row.raw.studentUid || submission.semesterId !== input.semesterId
            || (submission.attemptId && submission.attemptId !== (row.raw.attemptId || row.id))
            || (submission.submissionId && submission.submissionId !== id)
            || (submission.definitionId && submission.definitionId !== row.raw.definitionId)
            || !submission.answers || typeof submission.answers !== 'object' || Array.isArray(submission.answers)) return;
          row.raw.answers = json(submission.answers);
        });
      }
      const mockExamScoreRows = await buildMockExamScoreRows(allRows, students, input, budget);
      const packed = packHistoricalQuestionSnapshots(rawRows);
      const result = { semesterId: input.semesterId, students, ...packed, questions, treeData,
        configuredClasses: selectedClasses.map(({ id, label }) => ({ id, label })), generatedAt: new Date(now()).toISOString(),
        version, complete: true, mockExamScoreRows,
        ...(input.grade ? { grade: input.grade } : {}) };
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) fail('resource-exhausted', '성취 분석 자료가 조회 한도를 초과했습니다. 일부 자료만으로 분석하지 않습니다.', 'QUIZ_ACHIEVEMENT_RESPONSE_LIMIT');
      if (await scopeRevision(input.semesterId, selectedClasses) !== version
        || (gradeRevision && (await revision(input.semesterId, '')).version !== gradeRevision.version))
        fail('aborted', '조회 중 평가 자료가 갱신되었습니다. 다시 조회해 주세요.', 'QUIZ_ANALYSIS_CHANGED');
      return result;
    }
    const requestRevision = gradeRevision || (input.keyword || input.comparisonGrade ? await revision(input.semesterId, '') : null);
    const catalog = await loadCatalog({ ...input, forceRefresh: input.mode === 'catalog' && input.forceRefresh });
    if (input.mode === 'catalog') return catalog;
    const selectedClasses = selectClasses(catalog.classes, input);
    if (!input.keyword && !catalog.assessments.some(a => a.unitId === input.unitId && a.category === input.category && a.examRound === input.examRound)) fail('not-found', '선택한 평가를 찾을 수 없습니다. 목록을 다시 불러와 주세요.', 'QUIZ_ANALYSIS_ASSESSMENT_NOT_FOUND');
    const searchResult = input.keyword ? await loadSearchCatalog(input) : null;
    const aggregateGrade = input.grade || input.comparisonGrade;
    const gradeClasses = aggregateGrade ? catalog.classes.filter(c => c.grade === aggregateGrade) : [];
    if (input.comparisonGrade && (!gradeClasses.length || gradeClasses.length > MAX_GRADE_CLASSES)) {
      fail('invalid-argument', '비교할 학년의 학급 범위를 확인해 주세요.', 'QUIZ_ANALYSIS_GRADE_INVALID');
    }
    let questionPromise;
    const questions = () => questionPromise ||= searchResult ? (async () => {
      if (input.mode !== 'detail') return searchResult.questions;
      const documents = [];
      for (let offset = 0; offset < searchResult.questions.length; offset += 100) {
        const snapshots = await db.getAll(...searchResult.questions.slice(offset, offset + 100)
          .map(q => db.doc(`${root(input.semesterId)}/quiz_questions/${q.docId}`)));
        if (snapshots.some(snapshot => !snapshot.exists)) fail('aborted', '검색 문항이 갱신되었습니다. 다시 검색해 주세요.', 'QUIZ_ANALYSIS_CHANGED');
        documents.push(...snapshots.map(snapshot => ({ ...json(snapshot.data()), docId: snapshot.id,
          id: snapshot.data().id ?? Number(snapshot.id), sourceRevision: String(snapshot.data().contentRevision || snapshot.data().revision || 'legacy') })));
      }
      return documents;
    })() : loadQuestions(input, input.mode === 'detail');
    const verifySearch = async () => {
      if (!requestRevision) return;
      const current = await revision(input.semesterId, '');
      if (requestRevision.version !== current.version || (searchResult
        && searchResult.version !== hash(JSON.stringify({ content: current.value.content })))) {
        fail('aborted', '조회 범위가 갱신되었습니다. 다시 조회해 주세요.', 'QUIZ_ANALYSIS_CHANGED');
      }
    };
    if (input.mode === 'detail') {
      const version = await scopeRevision(input.semesterId, selectedClasses);
      const students = await loadScopeRoster(input.semesterId, selectedClasses, budget);
      const [rawRows, questionRows] = await Promise.all([searchResult && !searchResult.questions.length ? [] : loadResults(input, students, true, budget), questions()]);
      // Older canonical results contain checks but keep answers only in the
      // immutable submission. Fetch these only for explicit detail requests.
      const missingAnswers = rawRows.filter(row => row.source === 'canonical'
        && (!searchResult || (row.raw.answerChecks || []).some(item => searchResult.search.questionIds.includes(text(item.id))))
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
      if (searchResult) {
        const ids = new Set(searchResult.search.questionIds);
        for (const row of rawRows) {
          for (const field of ['details', 'answerChecks', 'learningSnapshot', 'questionSnapshots']) {
            if (Array.isArray(row.raw[field])) row.raw[field] = row.raw[field].filter(item => ids.has(text(item.id ?? item.qid ?? item.questionId)));
          }
          if (row.raw.answers) row.raw.answers = Object.fromEntries(Object.entries(row.raw.answers).filter(([id]) => ids.has(id)));
          const analyticsQuestions = row.raw.analytics?.questions;
          if (analyticsQuestions && typeof analyticsQuestions === 'object' && !Array.isArray(analyticsQuestions)) {
            row.raw.analytics = { ...row.raw.analytics, questions: Object.fromEntries(Object.entries(analyticsQuestions).filter(([id]) => ids.has(id))) };
          }
        }
      }
      const result = { semesterId: input.semesterId, students, rawRows, questions: questionRows, treeData: catalog.treeData,
        configuredClasses: selectedClasses.map(({ id, label }) => ({ id, label })), generatedAt: new Date(now()).toISOString(), version, complete: true,
        ...(input.grade ? { grade: input.grade } : {}),
        ...(searchResult ? { keyword: input.keyword, search: searchResult.search, basis: KEYWORD_BASIS } : {}) };
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) fail('resource-exhausted', '학급 상세 자료가 너무 큽니다. 요약을 확인하거나 평가 기록 범위를 점검해 주세요.', 'QUIZ_ANALYSIS_DETAIL_TOO_LARGE');
      await verifySearch();
      if (await scopeRevision(input.semesterId, selectedClasses) !== version)
        fail('aborted', '조회 중 평가 자료가 갱신되었습니다. 다시 조회해 주세요.', 'QUIZ_ANALYSIS_CHANGED');
      return result;
    }
    const allClasses = [...new Map([...selectedClasses, ...gradeClasses].map(c => [c.id, c])).values()];
    // Whole-grade analysis must not combine a pre-transfer class cache with a
    // freshly read destination class while the enrollment trigger is pending.
    // Resolve the roster once, then keep result caches keyed by that membership.
    const gradeRosters = input.grade ? new Map(selectedClasses.map(entry => [entry.id, []])) : null;
    if (gradeRosters) {
      const students = await loadScopeRoster(input.semesterId, selectedClasses, budget);
      for (const student of students) gradeRosters.get(student.classId).push(student);
    }
    const summaries = new Map();
    // A small pool avoids serial cold-start round trips for a whole grade while
    // preserving the shared read/byte budget and per-class cache coalescing.
    let nextClass = 0, buildError;
    await Promise.all(Array.from({ length: Math.min(3, allClasses.length) }, async () => {
      while (!buildError && nextClass < allClasses.length) {
        const targetClass = allClasses[nextClass++];
        try {
          const roster = gradeRosters?.get(targetClass.id);
          const rosterKey = roster ? `:roster:${hash(JSON.stringify(roster.map(student => [student.uid, student.email || ''])
            .sort((a, b) => a[0].localeCompare(b[0]))))}` : '';
          const cacheKey = searchResult ? `keyword:v1:${input.semesterId}:${hash(searchText(input.keyword))}:${searchResult.version}:${targetClass.id}`
            : `summary:${input.semesterId}:${input.unitId}:${input.category}:${input.examRound}:${targetClass.id}`;
          const summary = await cached(input.semesterId, cacheKey + rosterKey, targetClass.id, input.forceRefresh, async version => {
              const students = roster || await loadRoster(input.semesterId, targetClass, budget);
              const [rawRows, questionRows] = await Promise.all([searchResult && !searchResult.questions.length ? [] : loadResults(input, students, false, budget), questions()]);
              return summarizeClass(input, targetClass, students, questionRows, rawRows, new Date(now()).toISOString(), version);
            });
          summaries.set(targetClass.id, summary);
        } catch (error) { buildError ||= error; }
      }
    }));
    if (buildError) throw buildError;
    await verifySearch();
    if (aggregateGrade) {
      const states = await db.getAll(stateRef(db, input.semesterId), ...allClasses.map(c => classStateRef(db, input.semesterId, c.id)));
      if (allClasses.some((c, index) => summaries.get(c.id).version !== versionOf([states[0], states[index + 1]]))) {
        fail('aborted', '비교 중 학급 결과가 갱신되었습니다. 다시 조회해 주세요.', 'QUIZ_ANALYSIS_CHANGED');
      }
    }
    const result = { semesterId: input.semesterId, unitId: input.unitId, category: input.category, examRound: input.examRound,
      classes: selectedClasses.map(c => { const value = summaries.get(c.id); return { ...value, concepts: value.concepts.filter(item => item.wrongCount > 0) }; }), generatedAt: new Date(now()).toISOString(),
      ...(input.grade ? { grade: input.grade } : {}),
      ...(searchResult ? { keyword: input.keyword, search: searchResult.search } : {}),
      ...(aggregateGrade ? { gradeComparison: summarizeGrade(aggregateGrade,
        gradeClasses.map(c => summaries.get(c.id)), new Date(now()).toISOString()) } : {}) };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES)
      fail('resource-exhausted', '평가 분석 자료가 조회 한도를 초과했습니다. 학급을 선택해 다시 조회해 주세요.', 'QUIZ_ANALYSIS_RESPONSE_LIMIT');
    return result;
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
  const result = await service.query(query);
  return result;
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
  adaptRecords, summarizeClass, summarizeGrade, questionSearchText, createQuizClassAnalysisService, createQuizClassAnalysisHandler,
  createQuizAnalysisInvalidation, createQuizAnalysisTriggers, hash, studentRevisionRef };
