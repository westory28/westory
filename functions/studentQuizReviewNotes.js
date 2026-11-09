const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { isQuizAnswerCorrect } = require('./quizAnswerMatching');

const COLLECTION = 'semester_quiz_review_notes';
const REASONS = ['', '개념이 헷갈렸어요', '자료의 근거를 놓쳤어요', '답을 잘못 입력했어요',
  '몰랐어요', '잘못 읽었어요', '찍었어요', '실수했어요'];
const hash = value => createHash('sha256').update(value).digest('hex');
const noteId = (semesterId, uid, key) => hash(JSON.stringify([semesterId, uid, key]));
const fail = (code, message, reason) => { throw new HttpsError(code, message, { reason }); };
const emptyNotes = () => ({ revision: 0, items: [], updatedAt: '' });
const validKey = key => typeof key === 'string' && /^(canonical|legacy):[^/\x00-\x1f]{1,180}$/.test(key)
  && !['.', '..'].includes(key.slice(key.indexOf(':') + 1));
const resultPath = (semesterId, key) => {
  const split = key.indexOf(':'), id = key.slice(split + 1);
  return key.slice(0, split) === 'canonical' ? `semester_assessment_results/${id}`
    : `years/${semesterId.slice(0, 4)}/semesters/${semesterId.slice(-1)}/quiz_results/${id}`;
};
const publicNotes = (data, semesterId, uid, key) => {
  if (!data) return emptyNotes();
  if (data.semesterId !== semesterId || data.studentUid !== uid || data.resultKey !== key
    || !Number.isSafeInteger(data.revision) || data.revision < 1 || !Array.isArray(data.items))
    fail('failed-precondition', '오답노트 기록을 다시 확인해 주세요.', 'QUIZ_REVIEW_SCOPE_INVALID');
  return { revision: data.revision, updatedAt: data.updatedAt,
    items: data.items.map(({ questionId, practiceAnswer, reason, note, correct, updatedAt }) =>
      ({ questionId, practiceAnswer, reason, note, correct, updatedAt })) };
};
const loadQuizReviewNotes = async (db, semesterId, uid, key) =>
  publicNotes((await db.doc(`${COLLECTION}/${noteId(semesterId, uid, key)}`).get()).data(), semesterId, uid, key);
const collectQuizReviewNoteRefs = async (db, semesterId, uid) =>
  (await db.collection(COLLECTION).where('studentUid', '==', uid).where('semesterId', '==', semesterId).select().get()).docs.map(doc => doc.ref);

function normalizeSave(data) {
  const allowed = ['semesterId', 'key', 'questionId', 'practiceAnswer', 'reason', 'note', 'expectedRevision', 'saveId', '_session'];
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowed.includes(key))
    || !/^\d{4}-[12]$/.test(data.semesterId || '') || !validKey(data.key)
    || typeof data.questionId !== 'string' || !data.questionId || data.questionId.length > 160 || /[\x00-\x1f/]/.test(data.questionId)
    || typeof data.practiceAnswer !== 'string' || data.practiceAnswer.length > 12000
    || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(data.practiceAnswer)
    || !REASONS.includes(data.reason) || typeof data.note !== 'string' || data.note.length > 1000
    || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(data.note)
    || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0
    || typeof data.saveId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(data.saveId))
    fail('invalid-argument', '오답노트 입력과 저장 상태를 확인해 주세요.', 'QUIZ_REVIEW_INPUT_INVALID');
  return Object.fromEntries(allowed.filter(key => key !== '_session').map(key => [key, data[key]]));
}

function frozenWrongQuestion(raw, key, uid, semesterId, questionId) {
  const canonical = key.startsWith('canonical:');
  const time = raw?.submittedAtIso || raw?.timestamp;
  const submitted = typeof time?.toMillis === 'function' ? time.toMillis()
    : typeof time?.seconds === 'number' ? time.seconds * 1000 : typeof time === 'string' ? Date.parse(time) : NaN;
  if (!raw || (raw.studentUid || raw.uid) !== uid || (raw.uid && raw.uid !== uid)
    || (raw.semesterId && raw.semesterId !== semesterId)
    || (canonical && (raw.semesterId !== semesterId || raw.assessmentKind !== 'QUIZ'))
    || !Number.isFinite(submitted) || ['STARTED', 'IN_PROGRESS', 'RECOVERABLE', 'LOCKED', 'in_progress', 'cancelled'].includes(raw.status))
    fail('not-found', '본인의 제출 기록을 찾을 수 없습니다.', 'QUIZ_REVIEW_RESULT_NOT_FOUND');
  const checks = canonical ? raw.answerChecks : raw.details;
  const check = (Array.isArray(checks) ? checks : []).find(item => item &&
    String(item.id ?? item.qid ?? item.questionId) === questionId);
  if (check?.correct !== false)
    fail('invalid-argument', '이 제출에서 틀린 문항만 오답노트에 작성할 수 있습니다.', 'QUIZ_REVIEW_QUESTION_INVALID');
  const original = (Array.isArray(raw.questionSnapshots) ? raw.questionSnapshots : []).find(item => item && String(item.id) === questionId)
    || (!canonical ? { ...check, ...(check.questionSnapshot || {}) } : null);
  // Old submissions stored the frozen question fields directly on each detail.
  // Never fill a missing original from today's mutable question bank.
  const answer = original && (Object.hasOwn(original, 'a') ? original.a : original.answer);
  const snapshot = original ? { ...original,
    question: typeof original.q === 'string' ? original.q : original.question,
    answer: ['string', 'number'].includes(typeof answer) ? String(answer) : '',
  } : null;
  if (!snapshot || typeof snapshot.question !== 'string' || !snapshot.question.trim()
    || typeof snapshot.answer !== 'string' || !snapshot.answer.trim()
    || !['choice', 'ox', 'short', 'word', 'order', 'matching'].includes(snapshot.type))
    fail('failed-precondition', '문항 원문과 정답이 보관된 오답만 저장할 수 있습니다.', 'QUIZ_REVIEW_SOURCE_UNAVAILABLE');
  return snapshot;
}

function gradePractice(question, answer) {
  if (!answer.trim()) return null;
  const reject = () => fail('invalid-argument', '문항 형식에 맞는 연습 답안을 입력해 주세요.', 'QUIZ_REVIEW_ANSWER_INVALID');
  const options = Array.isArray(question.options) ? question.options.filter(value => typeof value === 'string') : [];
  if (['short', 'word'].includes(question.type)) {
    if (answer.length > 20) reject();
  } else if (question.type === 'ox') {
    if (!['O', 'X'].includes(answer)) reject();
  } else if (question.type === 'choice') {
    if (!options.includes(answer)) reject();
  } else if (question.type === 'order') {
    const available = [...(options.length ? options : question.answer.split('||'))];
    const selected = answer.split('||');
    if (selected.length > available.length) reject();
    for (const value of selected) {
      const index = available.indexOf(value);
      if (index < 0) reject();
      available.splice(index, 1);
    }
    if (available.length) return null;
  } else {
    const pairs = Array.isArray(question.matchingPairs) && question.matchingPairs.length ? question.matchingPairs
      : question.answer.split('||').map(part => { const [left, right] = part.split('=>'); return { left, right }; });
    const selected = answer.split('||').map(part => part.split('=>'));
    if (selected.length > pairs.length) reject();
    // The existing runner serializes the original left-hand order and permits
    // repeated right-hand choices in an incorrect practice answer.
    let previousIndex = -1;
    selected.forEach(parts => {
      const index = pairs.findIndex(pair => pair.left === parts[0]);
      if (parts.length !== 2 || index <= previousIndex || !pairs.some(pair => pair.right === parts[1])) reject();
      previousIndex = index;
    });
    if (selected.length < pairs.length) return null;
  }
  return isQuizAnswerCorrect(question.type, answer, question.answer);
}

const createQuizReviewNoteHandler = ({ db, assertSession = assertScoreWorkflowSession, now = () => new Date() }) => async request => {
  const identity = await assertSession(request, { recentAuth: false, highRisk: false });
  const uid = request.auth?.uid;
  if (!uid || identity?.uid !== uid) fail('unauthenticated', '로그인 상태를 확인해 주세요.', 'QUIZ_REVIEW_SESSION_INVALID');
  const input = normalizeSave(request.data), { semesterId, key } = input;
  const ref = db.doc(`${COLLECTION}/${noteId(semesterId, uid, key)}`);
  const payloadHash = hash(JSON.stringify(input));
  return db.runTransaction(async transaction => {
    const [profileDoc, pointerDoc, manifestDoc, resultDoc, noteDoc] = await transaction.getAll(
      db.doc(`users/${uid}`), db.doc('site_settings/semester_active'), db.doc(`semester_manifests/${semesterId}`),
      db.doc(resultPath(semesterId, key)), ref);
    const profile = profileDoc.data(), pointer = pointerDoc.data(), manifest = manifestDoc.data();
    if (!profileDoc.exists || profile.role !== 'student' || profile.weplayDeletionPending === true
      || (profile.registrationApprovalStatus && profile.registrationApprovalStatus !== 'APPROVED'))
      fail('permission-denied', '학생 본인의 오답노트만 저장할 수 있습니다.', 'QUIZ_REVIEW_STUDENT_REQUIRED');
    if (!pointerDoc.exists || !manifestDoc.exists || pointer.semesterId !== semesterId
      || manifest.semesterId !== semesterId || manifest.status !== 'ACTIVE' || manifest.readOnly === true
      || !Number.isSafeInteger(manifest.revision) || manifest.revision < 1 || pointer.revision !== manifest.revision)
      fail('failed-precondition', '현재 학기의 오답노트만 수정할 수 있습니다.', 'QUIZ_REVIEW_SEMESTER_INACTIVE');
    const question = frozenWrongQuestion(resultDoc.data(), key, uid, semesterId, input.questionId);
    const correct = gradePractice(question, input.practiceAnswer);
    const saved = noteDoc.data(), notes = publicNotes(saved, semesterId, uid, key);
    if (saved?.lastSaveId === input.saveId) {
      if (saved.lastSaveHash !== payloadHash) fail('invalid-argument', '변경한 내용을 새 저장 요청으로 보내 주세요.', 'QUIZ_REVIEW_SAVE_ID_REUSED');
      return { semesterId, key, reviewNotes: notes, replayed: true };
    }
    if (notes.revision !== input.expectedRevision)
      fail('aborted', '다른 화면에서 오답노트를 변경했습니다. 다시 불러온 뒤 저장해 주세요.', 'QUIZ_REVIEW_REVISION_CONFLICT');
    const updatedAt = now().toISOString();
    const item = { questionId: input.questionId, practiceAnswer: input.practiceAnswer, reason: input.reason,
      note: input.note, correct, updatedAt };
    const items = [...notes.items.filter(entry => entry.questionId !== input.questionId), item];
    const value = { schemaVersion: 1, semesterId, studentUid: uid, resultKey: key, revision: notes.revision + 1,
      items, updatedAt, lastSaveId: input.saveId, lastSaveHash: payloadHash };
    if (Buffer.byteLength(JSON.stringify(value)) > 850000)
      fail('resource-exhausted', '오답노트 저장 용량을 초과했습니다.', 'QUIZ_REVIEW_SIZE_LIMIT');
    transaction.set(ref, value);
    return { semesterId, key, reviewNotes: publicNotes(value, semesterId, uid, key), replayed: false };
  });
};

module.exports = { COLLECTION, noteId, loadQuizReviewNotes, collectQuizReviewNoteRefs, normalizeSave, frozenWrongQuestion, gradePractice, createQuizReviewNoteHandler };
