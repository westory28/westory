const { createHash } = require('node:crypto');
const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { buildEnrollmentSlotId } = require('./productionGateway/archiveEnrollment');
const { accountIdFor } = require('./studentWisWallet');
const { resolveStudentProfileEmoji } = require('./studentProfileEmojiPolicy');
const { frozenWrongQuestion } = require('./studentQuizReviewNotes');

const ADMIN_EMAIL = 'westoria28@gmail.com';
const PAGE_SIZE = 20;
const SOURCE_KINDS = ['lesson', 'dictionary', 'mock', 'formative', 'diagnostic'];
const DURATIONS = [0, 3600000, 10800000, 86400000, 259200000, 604800000];
const hash = value => createHash('sha256').update(value).digest('hex');
const root = scope => `years/${scope.slice(0, 4)}/semesters/${scope.slice(-1)}`;
const path = (scope, collection, id) => `${root(scope)}/gongsinmoongo_${collection}${id ? `/${id}` : ''}`;
const fail = (code, message, reason) => { throw new HttpsError(code, message, { reason }); };
const validId = value => typeof value === 'string' && /^[^/\x00-\x1f]{1,180}$/.test(value)
  && value === value.trim() && !['.', '..'].includes(value);
const clean = (value, max, optional = false) => {
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max
    || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    fail('invalid-argument', '입력한 내용과 글자 수를 확인해 주세요.', 'GONGSIN_INPUT_INVALID');
  return value.trim();
};
const checkKeys = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
    fail('invalid-argument', '요청 정보를 다시 확인해 주세요.', 'GONGSIN_INPUT_INVALID');
};
const safeRevision = value => Number.isSafeInteger(value) && value >= 0;
const activeProfile = profile => profile && !profile.deletedAt && profile.isDeleted !== true && profile.weplayDeletionPending !== true;
const defaultSettings = () => ({
  enabled: false, revision: 0, acceptingQuestions: true, storiesVisible: true,
  teacherQuestionNotifications: true, studentReplyNotifications: true,
  warning: { enabled: true, title: '질문하기 전에 확인해 주세요',
    body: '학습과 관련된 질문만 보내 주세요.\n사담·욕설·같은 질문의 반복 전송은 하지 않아요.\n반복하면 정해진 시간이나 기간 동안 질문이 제한될 수 있어요.', revision: 1 },
  allowedSources: [...SOURCE_KINDS], defaultRestrictionMs: 3600000,
});
function normalizeSettings(raw, previous = defaultSettings()) {
  checkKeys(raw, ['enabled', 'revision', 'acceptingQuestions', 'storiesVisible', 'teacherQuestionNotifications',
    'studentReplyNotifications', 'warning', 'allowedSources', 'defaultRestrictionMs']);
  for (const key of ['enabled', 'acceptingQuestions', 'storiesVisible', 'teacherQuestionNotifications', 'studentReplyNotifications'])
    if (typeof raw[key] !== 'boolean') fail('invalid-argument', '운영 설정을 확인해 주세요.', 'GONGSIN_SETTINGS_INVALID');
  checkKeys(raw.warning, ['enabled', 'title', 'body', 'revision']);
  if (typeof raw.warning.enabled !== 'boolean' || !Array.isArray(raw.allowedSources)
    || raw.allowedSources.some(kind => !SOURCE_KINDS.includes(kind)) || !DURATIONS.slice(1).includes(raw.defaultRestrictionMs))
    fail('invalid-argument', '운영 설정을 확인해 주세요.', 'GONGSIN_SETTINGS_INVALID');
  const warning = { enabled: raw.warning.enabled, title: clean(raw.warning.title, 80), body: clean(raw.warning.body, 1000) };
  const changed = ['enabled', 'title', 'body'].some(key => warning[key] !== previous.warning[key]);
  return { enabled: raw.enabled, revision: previous.revision + 1, acceptingQuestions: raw.acceptingQuestions,
    storiesVisible: raw.storiesVisible, teacherQuestionNotifications: raw.teacherQuestionNotifications,
    studentReplyNotifications: raw.studentReplyNotifications,
    warning: { ...warning, revision: previous.warning.revision + (changed ? 1 : 0) },
    allowedSources: SOURCE_KINDS.filter(kind => raw.allowedSources.includes(kind)), defaultRestrictionMs: raw.defaultRestrictionMs };
}
function normalizeInput(data, mutation) {
  const common = ['semesterId', '_session'];
  const fields = mutation ? ['action', 'requestId', 'settings', 'expectedRevision', 'warningRevision', 'question', 'source',
    'questionId', 'reply', 'publicQuestion', 'publicReply', 'selected', 'studentId', 'durationMs', 'reason']
    : ['mode', 'cursor', 'filter', 'questionId', 'studentId'];
  checkKeys(data, [...common, ...fields]);
  if (!/^\d{4}-[12]$/.test(data.semesterId || '')) fail('invalid-argument', '현재 학기를 확인해 주세요.', 'GONGSIN_SCOPE_INVALID');
  if (mutation) {
    if (!['settings', 'ack', 'submit', 'answer', 'story', 'restrict'].includes(data.action)
      || !/^[A-Za-z0-9_-]{16,100}$/.test(data.requestId || '')) fail('invalid-argument', '저장 요청을 다시 확인해 주세요.', 'GONGSIN_ACTION_INVALID');
  } else if (!['state', 'questions', 'detail', 'stories', 'restrictions'].includes(data.mode)
    || (data.filter !== undefined && !['all', 'waiting', 'selected'].includes(data.filter))
    || (data.cursor !== undefined && data.cursor !== null && (typeof data.cursor !== 'string' || data.cursor.length > 500)))
    fail('invalid-argument', '조회할 목록을 확인해 주세요.', 'GONGSIN_QUERY_INVALID');
  for (const key of ['questionId', 'studentId']) if (data[key] !== undefined && !validId(data[key]))
    fail('invalid-argument', '선택한 대상을 확인해 주세요.', 'GONGSIN_TARGET_INVALID');
  return Object.fromEntries(Object.entries(data).filter(([key]) => key !== '_session'));
}
function normalizeSource(raw) {
  checkKeys(raw, ['kind', 'unitId', 'termId', 'resultKey', 'questionId', 'page', 'origin']);
  if (!['general', ...SOURCE_KINDS].includes(raw.kind)) fail('invalid-argument', '질문의 학습 자료를 확인해 주세요.', 'GONGSIN_SOURCE_INVALID');
  for (const key of ['unitId', 'questionId']) if (raw[key] !== undefined && !validId(raw[key]))
    fail('invalid-argument', '연결할 학습 자료를 확인해 주세요.', 'GONGSIN_SOURCE_INVALID');
  const validTerm = typeof raw.termId === 'string' && raw.termId.length > 0 && Buffer.byteLength(raw.termId) <= 1500
    && !/[\/\\\x00-\x1f\x7f]/.test(raw.termId) && !['.', '..'].includes(raw.termId);
  if (raw.page !== undefined && (!Number.isSafeInteger(raw.page) || raw.page < 1 || raw.page > 1000))
    fail('invalid-argument', '학습지 쪽수를 확인해 주세요.', 'GONGSIN_SOURCE_INVALID');
  if (['mock', 'formative', 'diagnostic'].includes(raw.kind)
    && (typeof raw.resultKey !== 'string' || !/^(canonical|legacy):[^/\x00-\x1f]{1,180}$/.test(raw.resultKey)
      || !validId(raw.questionId) || (raw.kind === 'mock' && raw.origin !== 'wrong-note')))
    fail('invalid-argument', '평가 제출 후 오답 노트에서 질문해 주세요.', 'GONGSIN_RESULT_REQUIRED');
  if (raw.kind === 'lesson' && !validId(raw.unitId) || raw.kind === 'dictionary' && !validTerm)
    fail('invalid-argument', '연결할 자료를 선택해 주세요.', 'GONGSIN_SOURCE_REQUIRED');
  return raw;
}
const projectQuestion = (id, data, teacher) => ({ id, studentId: data.studentId, studentLabel: data.studentLabel,
  profileEmojiId: data.profileEmojiId, source: data.source, question: data.question, reply: data.reply,
  ...(teacher ? { publicQuestion: data.publicQuestion || '', publicReply: data.publicReply || '', selected: data.selected === true } : {}),
  createdAt: data.createdAt, updatedAt: data.updatedAt, revision: data.revision });
const projectStory = (id, data) => ({ id, question: data.question, answer: data.answer, source: data.source,
  createdAt: data.createdAt, updatedAt: data.updatedAt });
const projectRestriction = (studentId, data) => data?.until > 0
  ? { studentId, studentLabel: data.studentLabel || '', until: data.until, reason: data.reason, updatedAt: data.updatedAt } : null;

async function readContext(db, tx, request, scope) {
  const uid = request.auth?.uid, email = request.auth?.token?.email;
  if (!uid || !(email === ADMIN_EMAIL || typeof email === 'string' && /@yongshin-ms\.ms\.kr$/i.test(email)))
    fail('permission-denied', '위스토리 계정으로 로그인해 주세요.', 'GONGSIN_IDENTITY_REQUIRED');
  const [profileDoc, pointerDoc, manifestDoc, settingsDoc] = await tx.getAll(db.doc(`users/${uid}`),
    db.doc('site_settings/semester_active'), db.doc(`semester_manifests/${scope}`), db.doc(path(scope, 'config', 'settings')));
  const profile = profileDoc.data(), pointer = pointerDoc.data(), manifest = manifestDoc.data();
  if (!activeProfile(profile)) fail('permission-denied', '이용할 수 있는 계정을 확인해 주세요.', 'GONGSIN_PROFILE_INVALID');
  const admin = email === ADMIN_EMAIL, teacher = admin || profile.role === 'teacher';
  if (!teacher && (profile.role !== 'student' || profile.registrationApprovalStatus && profile.registrationApprovalStatus !== 'APPROVED'))
    fail('permission-denied', '승인된 학생 계정이 필요합니다.', 'GONGSIN_STUDENT_REQUIRED');
  if (!pointer || !manifest || pointer.semesterId !== scope || manifest.semesterId !== scope || manifest.status !== 'ACTIVE'
    || manifest.readOnly === true || !safeRevision(manifest.revision) || manifest.revision < 1 || pointer.revision !== manifest.revision)
    fail('failed-precondition', '현재 학기에서 다시 열어 주세요.', 'GONGSIN_SEMESTER_INACTIVE');
  let enrollment = null;
  if (!teacher) {
    const slot = (await tx.get(db.doc(`semester_enrollment_slots/${buildEnrollmentSlotId(scope, uid)}`))).data();
    if (!slot || slot.studentUid !== uid || slot.semesterId !== scope || !validId(slot.activeEnrollmentId)
      || slot.status && slot.status !== 'ACTIVE') fail('permission-denied', '현재 학기의 학적을 확인해 주세요.', 'GONGSIN_ENROLLMENT_REQUIRED');
    enrollment = (await tx.get(db.doc(`semester_enrollments/${slot.activeEnrollmentId}`))).data();
    if (!enrollment || enrollment.studentUid !== uid || enrollment.semesterId !== scope || enrollment.enrollmentStatus !== 'ACTIVE'
      || enrollment.readOnly === true || !validId(enrollment.classId)) fail('permission-denied', '현재 학기의 학적을 확인해 주세요.', 'GONGSIN_ENROLLMENT_REQUIRED');
    const classroom = (await tx.get(db.doc(`semester_classes/${enrollment.classId}`))).data();
    if (!classroom || classroom.semesterId !== scope || classroom.status !== 'ACTIVE' || classroom.readOnly === true)
      fail('permission-denied', '현재 학급을 확인해 주세요.', 'GONGSIN_CLASS_REQUIRED');
  }
  return { uid, profile, admin, teacher, enrollment, settings: settingsDoc.data() || defaultSettings(), scope };
}
const requireOpen = context => {
  if (!context.teacher && context.settings.enabled !== true)
    fail('failed-precondition', '공부의 神문고는 지금 운영하지 않습니다.', 'GONGSIN_CLOSED');
};
const requireTeacher = context => { if (!context.teacher) fail('permission-denied', '교사만 처리할 수 있습니다.', 'GONGSIN_TEACHER_REQUIRED'); };
const requireRevision = (actual, expected) => {
  if (!safeRevision(expected)) fail('invalid-argument', '저장할 버전을 확인해 주세요.', 'GONGSIN_REVISION_INVALID');
  if (actual !== expected) fail('aborted', '다른 화면에서 변경되었습니다. 다시 불러온 뒤 저장해 주세요.', 'GONGSIN_REVISION_CONFLICT');
};
async function readQuestion(db, tx, context, id) {
  if (!validId(id)) fail('invalid-argument', '질문을 선택해 주세요.', 'GONGSIN_QUESTION_REQUIRED');
  const doc = await tx.get(db.doc(path(context.scope, 'questions', id))), value = doc.data();
  if (!value || value.semesterId !== context.scope || (!context.teacher && value.studentId !== context.uid))
    fail('not-found', '질문을 찾을 수 없습니다.', 'GONGSIN_QUESTION_NOT_FOUND');
  return { ref: doc.ref, value };
}
async function paginate(tx, query, input, mapper, sort = 'createdAt') {
  query = query.orderBy(sort, 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (input.cursor) {
    let cursor;
    try { cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()); } catch { /* validated below */ }
    if (!cursor || !Number.isSafeInteger(cursor.time) || !validId(cursor.id))
      fail('invalid-argument', '목록을 처음부터 다시 열어 주세요.', 'GONGSIN_CURSOR_INVALID');
    query = query.startAfter(cursor.time, cursor.id);
  }
  const rows = (await tx.get(query.limit(PAGE_SIZE + 1))).docs;
  const visible = rows.slice(0, PAGE_SIZE), last = visible.at(-1);
  return { items: visible.map(doc => mapper(doc.id, doc.data())), nextCursor: rows.length > PAGE_SIZE
    ? Buffer.from(JSON.stringify({ time: last.data()[sort], id: last.id })).toString('base64url') : null };
}
async function validateSource(db, tx, context, raw) {
  const source = normalizeSource(raw), { scope, uid } = context;
  if (source.kind === 'general') return { kind: 'general', title: '학습 질문' };
  if (!context.settings.allowedSources.includes(source.kind)) fail('failed-precondition', '이 자료의 질문 접수가 꺼져 있습니다.', 'GONGSIN_SOURCE_DISABLED');
  if (source.kind === 'lesson') {
    let docs = (await tx.get(db.collection(`${root(scope)}/lessons`).where('unitId', '==', source.unitId)
      .select('title', 'isVisibleToStudents', 'deletedAt', 'assignedClassIds', 'updatedAt', 'createdAt').limit(101))).docs;
    if (!docs.length) docs = (await tx.get(db.collection('lessons').where('unitId', '==', source.unitId)
      .select('title', 'isVisibleToStudents', 'deletedAt', 'assignedClassIds', 'updatedAt', 'createdAt').limit(101))).docs;
    if (docs.length > 100) fail('resource-exhausted', '자료 버전을 정리한 뒤 다시 연결해 주세요.', 'GONGSIN_LESSON_VERSION_LIMIT');
    const millis = x => x?.toMillis?.() || (typeof x === 'string' ? Date.parse(x) : Number(x?.seconds || 0) * 1000);
    const lesson = docs.map(doc => doc.data()).sort((a, b) => millis(b.updatedAt || b.createdAt) - millis(a.updatedAt || a.createdAt))[0];
    if (!lesson || lesson.isVisibleToStudents === false || lesson.deletedAt || Array.isArray(lesson.assignedClassIds)
      && lesson.assignedClassIds.length && !lesson.assignedClassIds.includes(context.enrollment.classId))
      fail('permission-denied', '공개된 본인 수업자료만 연결할 수 있습니다.', 'GONGSIN_LESSON_HIDDEN');
    return { kind: source.kind, unitId: source.unitId, title: String(lesson.title || '수업자료').slice(0, 160), ...(source.page ? { page: source.page } : {}) };
  }
  if (source.kind === 'dictionary') {
    const catalog = source.termId.startsWith('catalog-');
    let doc = await tx.get(db.doc(catalog ? `history_dictionary_catalog/${source.termId}` : `${root(scope)}/history_dictionary_terms/${source.termId}`));
    if (!catalog && !doc.exists) doc = await tx.get(db.doc(`history_dictionary_terms/${source.termId}`));
    const term = doc.data();
    if (!term || term.deletedAt || term.isVisibleToStudents === false || !String(term.word || '').trim()
      || (catalog ? term.managedBy !== 'westory-history-dictionary-catalog' || term.schemaVersion !== 1 : term.status !== 'published'))
      fail('not-found', '공개된 역사 사전 용어를 확인해 주세요.', 'GONGSIN_TERM_NOT_FOUND');
    return { kind: source.kind, termId: source.termId, title: String(term.word).slice(0, 160) };
  }
  const [resultType, resultId] = [source.resultKey.slice(0, source.resultKey.indexOf(':')), source.resultKey.slice(source.resultKey.indexOf(':') + 1)];
  if (!validId(resultId)) fail('invalid-argument', '제출 기록을 확인해 주세요.', 'GONGSIN_RESULT_INVALID');
  const result = (await tx.get(db.doc(resultType === 'canonical' ? `semester_assessment_results/${resultId}` : `${root(scope)}/quiz_results/${resultId}`))).data();
  const time = result?.submittedAtIso || result?.timestamp;
  const millis = time?.toMillis?.() || (typeof time === 'string' ? Date.parse(time) : Number(time?.seconds || 0) * 1000);
  const category = String(result?.category || result?.definitionId?.split(':')[3] || '');
  if (!result || (result.studentUid || result.uid) !== uid || result.uid && result.uid !== uid
    || result.semesterId && result.semesterId !== scope || resultType === 'canonical' && (result.semesterId !== scope || result.assessmentKind !== 'QUIZ')
    || !millis || ['STARTED', 'IN_PROGRESS', 'RECOVERABLE', 'LOCKED', 'in_progress', 'cancelled'].includes(result.status)
    || (source.kind === 'mock' ? !category.startsWith('exam_prep') : category !== source.kind))
    fail('permission-denied', '본인이 제출한 평가 기록만 연결할 수 있습니다.', 'GONGSIN_RESULT_FORBIDDEN');
  if (source.kind === 'mock') frozenWrongQuestion(result, source.resultKey, uid, scope, source.questionId);
  else if (!(resultType === 'canonical' ? result.answerChecks : result.details)?.some(item => String(item.id ?? item.qid ?? item.questionId) === source.questionId))
    fail('invalid-argument', '제출 기록에 없는 문항입니다.', 'GONGSIN_RESULT_QUESTION_INVALID');
  const checks = resultType === 'canonical' ? result.answerChecks : result.details;
  const position = checks.findIndex(item => String(item.id ?? item.qid ?? item.questionId) === source.questionId);
  const snapshot = result.questionSnapshots?.find(item => String(item.id) === source.questionId) || checks[position]?.questionSnapshot || checks[position];
  const explicitNumber = Number(snapshot?.displayNo ?? snapshot?.questionNumber);
  const questionNumber = Number.isSafeInteger(explicitNumber) && explicitNumber > 0 ? explicitNumber : position + 1;
  return { kind: source.kind, resultKey: source.resultKey, questionId: source.questionId,
    title: `${source.kind === 'mock' ? '모의고사' : source.kind === 'formative' ? '형성평가' : '진단평가'} · ${questionNumber}번`,
    ...(source.kind === 'mock' ? { origin: 'wrong-note' } : {}) };
}
async function profileEmoji(db, tx, context) {
  const id = accountIdFor(context.scope, context.uid);
  const [accountDoc, policyDoc] = await tx.getAll(db.doc(`semester_wis_accounts/${id}`), db.doc(`${root(context.scope)}/point_policies/current`));
  const account = accountDoc.data();
  const valid = account?.accountId === id && account.studentUid === context.uid && account.semesterId === context.scope
    && account.schemaVersion === 1 && account.policyVersion === 'w7-v1' && account.status === 'ACTIVE' && account.readOnly !== true
    && Number.isSafeInteger(account.rankEarnedTotal) && account.rankEarnedTotal >= 0;
  return resolveStudentProfileEmoji({ profileEmojiId: context.profile.profileEmojiId, profileIcon: context.profile.profileIcon,
    rankEarnedTotal: valid ? account.rankEarnedTotal : 0, rankPolicy: policyDoc.data()?.rankPolicy }).profileEmojiId;
}
async function notificationPlan(db, tx, context, type, questionId, revision, now) {
  const teachers = type === 'question_created', settings = context.settings;
  if (!settings.enabled || (teachers ? !settings.teacherQuestionNotifications : !settings.studentReplyNotifications)) return [];
  const config = (await tx.get(db.doc('site_settings/notification_config'))).data() || {};
  const policy = config.eventPolicies?.[type];
  if (config.enabled === false || policy?.enabled === false || (teachers ? config.teacherNotificationsEnabled : config.studentNotificationsEnabled) === false) return [];
  let uids;
  if (teachers) {
    const [staff, admins] = await Promise.all([
      tx.get(db.collection('users').where('role', '==', 'teacher').select('role', 'email', 'deletedAt', 'isDeleted', 'weplayDeletionPending').limit(51)),
      tx.get(db.collection('users').where('email', '==', ADMIN_EMAIL).select('email', 'deletedAt', 'isDeleted', 'weplayDeletionPending').limit(2)),
    ]);
    if (staff.size > 50 || admins.size > 1) fail('resource-exhausted', '담당 교사 알림 수신 범위를 확인해 주세요.', 'GONGSIN_RECIPIENT_LIMIT');
    uids = [...new Set([...staff.docs, ...admins.docs].filter(doc => activeProfile(doc.data())
      && (doc.data().email === ADMIN_EMAIL || /@yongshin-ms\.ms\.kr$/i.test(doc.data().email || ''))).map(doc => doc.id))];
  } else uids = [context.recipientUid];
  const values = { studentName: context.studentLabel || '학생', title: '공부의 神문고', questionId };
  const render = (template, fallback) => typeof template === 'string' && template.trim()
    && [...template.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].every(match => Object.hasOwn(values, match[1]))
    ? template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => values[key]) : fallback;
  return uids.map(uid => ({ uid, id: `n_${hash(`gongsin:${type}:${questionId}:${revision}:${uid}`)}`, value: {
    type, title: render(policy?.titleTemplate, teachers ? '공부의 神문고 새 질문' : '공부의 神문고 답변 도착').slice(0, 80),
    body: render(policy?.bodyTemplate, teachers ? `${values.studentName} 학생이 학습 질문을 보냈습니다.` : '선생님이 질문에 답변해 주셨습니다.').slice(0, 500),
    targetUrl: `/${teachers ? 'teacher' : 'student'}/gongsinmoongo?question=${encodeURIComponent(questionId)}`,
    entityType: 'gongsinmoongo_question', entityId: questionId, actorUid: context.uid, recipientUid: uid,
    priority: policy?.priority === 'high' ? 'high' : 'normal', dedupeKey: `gongsin:${type}:${questionId}:${revision}:${uid}`,
    readAt: null, createdAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + 30 * 86400000),
  } }));
}
function writeNotifications(db, tx, scope, plans) {
  for (const plan of plans) {
    const inbox = `${root(scope)}/notification_inboxes/${plan.uid}`;
    tx.create(db.doc(`${inbox}/items/${plan.id}`), plan.value);
    tx.set(db.doc(inbox), { uid: plan.uid, unreadCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}

function createGongsinmoongoHandlers({ db, assertSession = assertScoreWorkflowSession, now = () => Date.now() }) {
  const session = async request => { const identity = await assertSession(request, { recentAuth: false, highRisk: false });
    if (!request.auth?.uid || identity?.uid && identity.uid !== request.auth.uid) fail('unauthenticated', '로그인 상태를 확인해 주세요.', 'GONGSIN_SESSION_INVALID'); };
  const getGongsinmoongo = async request => {
    await session(request);
    const input = normalizeInput(request.data, false);
    return db.runTransaction(async tx => {
      const context = await readContext(db, tx, request, input.semesterId), { scope, uid, teacher, settings } = context;
      if (input.studentId !== undefined && !teacher) fail('permission-denied', '본인의 질문만 조회할 수 있습니다.', 'GONGSIN_OWNER_REQUIRED');
      if (input.mode === 'state') {
        const [restriction, ack] = teacher ? [null, null] : await tx.getAll(db.doc(path(scope, 'restrictions', uid)), db.doc(path(scope, 'acknowledgments', uid)));
        return { role: teacher ? 'teacher' : 'student', canManageSettings: context.admin, settings,
          restriction: projectRestriction(uid, restriction?.data()), acknowledgedWarningRevision: ack?.data()?.warningRevision || 0 };
      }
      requireOpen(context);
      if (input.mode === 'detail') {
        const { value } = await readQuestion(db, tx, context, input.questionId);
        return { question: projectQuestion(input.questionId, value, teacher) };
      }
      if (input.mode === 'questions') {
        let query = db.collection(path(scope, 'questions'));
        if (!teacher || input.studentId) query = query.where('studentId', '==', teacher ? input.studentId : uid);
        if (input.filter === 'waiting') query = query.where('status', '==', 'waiting');
        if (input.filter === 'selected') { requireTeacher(context); query = query.where('selected', '==', true); }
        return paginate(tx, query, input, (id, value) => projectQuestion(id, value, teacher));
      }
      if (input.mode === 'stories') {
        if (!teacher && !settings.storiesVisible) return { items: [], nextCursor: null };
        return paginate(tx, db.collection(path(scope, 'stories')), input, projectStory);
      }
      requireTeacher(context);
      return paginate(tx, db.collection(path(scope, 'restrictions')).where('until', '>', now()), input, projectRestriction, 'until');
    }, { readOnly: true });
  };
  const manageGongsinmoongo = async request => {
    await session(request);
    const input = normalizeInput(request.data, true), scope = input.semesterId, payloadHash = hash(JSON.stringify(input));
    return db.runTransaction(async tx => {
      const context = await readContext(db, tx, request, scope), { uid, teacher, settings } = context;
      const receiptRef = db.doc(path(scope, 'receipts', hash(`${uid}:${input.requestId}`)));
      const receipt = (await tx.get(receiptRef)).data();
      if (['settings', 'answer', 'story', 'restrict'].includes(input.action)) requireTeacher(context);
      else if (teacher) fail('permission-denied', '학생 본인만 질문을 보낼 수 있습니다.', 'GONGSIN_STUDENT_REQUIRED');
      if (input.action === 'settings' && !context.admin) fail('permission-denied', '관리자만 운영 설정을 변경할 수 있습니다.', 'GONGSIN_ADMIN_REQUIRED');
      requireOpen(context);
      if (receipt) {
        if (receipt.payloadHash !== payloadHash) fail('invalid-argument', '변경한 내용은 새 요청으로 저장해 주세요.', 'GONGSIN_REQUEST_REUSED');
        return { ...receipt.response, replayed: true };
      }
      const stamp = now();
      let response;
      if (input.action === 'settings') {
        requireRevision(settings.revision, input.expectedRevision);
        const value = normalizeSettings(input.settings, settings);
        const unchanged = JSON.stringify({ ...value, revision: 0 }) === JSON.stringify({ ...settings, revision: 0 });
        if (unchanged) return { settings, replayed: false };
        const publicState = (await tx.get(db.doc(path(scope, 'config', 'public')))).data();
        if (!unchanged) {
          tx.set(db.doc(path(scope, 'config', 'settings')), value);
          tx.set(db.doc(path(scope, 'config', 'public')), { enabled: value.enabled, revision: value.revision,
            contentRevision: publicState?.contentRevision || 0 });
        }
        response = { settings: unchanged ? settings : value };
      } else if (input.action === 'ack') {
        if (input.warningRevision !== settings.warning.revision) fail('failed-precondition', '변경된 이용 안내를 확인해 주세요.', 'GONGSIN_WARNING_CHANGED');
        const existing = (await tx.get(db.doc(path(scope, 'acknowledgments', uid)))).data();
        if (existing?.warningRevision === input.warningRevision) return { acknowledgedWarningRevision: input.warningRevision, replayed: false };
        tx.set(db.doc(path(scope, 'acknowledgments', uid)), { studentId: uid, warningRevision: input.warningRevision, acknowledgedAt: stamp });
        response = { acknowledgedWarningRevision: input.warningRevision };
      } else if (input.action === 'submit') {
        if (!settings.acceptingQuestions) fail('failed-precondition', '지금은 새 질문을 받지 않습니다.', 'GONGSIN_NOT_ACCEPTING');
        const question = clean(input.question, 2000), questionId = `q_${hash(`${uid}:${input.requestId}`)}`;
        const [restrictionDoc, ackDoc, rateDoc, attempts] = await Promise.all([
          tx.get(db.doc(path(scope, 'restrictions', uid))), tx.get(db.doc(path(scope, 'acknowledgments', uid))),
          tx.get(db.doc(path(scope, 'submission_rates', uid))),
          tx.get(db.collection('semester_assessment_attempts').where('studentUid', '==', uid).where('semesterId', '==', scope)
            .where('assessmentKind', '==', 'QUIZ').where('status', 'in', ['STARTED', 'IN_PROGRESS', 'RECOVERABLE'])
            .select('category', 'definitionId', 'deadlineAtIso').limit(51)),
        ]);
        if (attempts.size > 50 || attempts.docs.some(doc => {
          const attempt = doc.data(), category = String(attempt.category || attempt.definitionId?.split(':')[3] || '');
          const deadline = Date.parse(attempt.deadlineAtIso || '');
          return (!category || category.startsWith('exam_prep')) && (!Number.isFinite(deadline) || deadline > stamp);
        })) fail('failed-precondition', '모의고사 중에는 질문할 수 없습니다. 제출한 뒤 오답 노트에서 질문해 주세요.', 'GONGSIN_EXAM_IN_PROGRESS');
        if (restrictionDoc.data()?.until > stamp) fail('permission-denied', '질문 제한 기간이 끝난 뒤 이용해 주세요.', 'GONGSIN_STUDENT_RESTRICTED');
        if (settings.warning.enabled && ackDoc.data()?.warningRevision !== settings.warning.revision)
          fail('failed-precondition', '처음 이용 안내를 확인해 주세요.', 'GONGSIN_WARNING_REQUIRED');
        if (rateDoc.data()?.lastSubmittedAt > stamp - 10000) fail('resource-exhausted', '잠시 후 질문을 보내 주세요.', 'GONGSIN_RATE_LIMIT');
        const source = await validateSource(db, tx, context, input.source), profileEmojiId = await profileEmoji(db, tx, context);
        const studentLabel = String(context.enrollment?.snapshot?.displayName || context.profile.name || context.profile.displayName || '학생').slice(0, 80);
        const plans = await notificationPlan(db, tx, { ...context, studentLabel }, 'question_created', questionId, 1, stamp);
        const value = { semesterId: scope, studentId: uid, studentLabel, profileEmojiId, source, question, reply: '', publicQuestion: '',
          publicReply: '', selected: false, status: 'waiting', revision: 1, createdAt: stamp, updatedAt: stamp };
        tx.create(db.doc(path(scope, 'questions', questionId)), value);
        tx.set(db.doc(path(scope, 'submission_rates', uid)), { studentId: uid, lastSubmittedAt: stamp });
        writeNotifications(db, tx, scope, plans);
        response = { question: projectQuestion(questionId, value, false) };
      } else if (input.action === 'answer' || input.action === 'story') {
        const { value, ref } = await readQuestion(db, tx, context, input.questionId);
        requireRevision(value.revision, input.expectedRevision);
        if (input.action === 'answer') {
          const reply = clean(input.reply, 2000);
          if (value.reply === reply) return { question: projectQuestion(input.questionId, value, true), replayed: false };
          else {
            const next = { ...value, reply, status: 'answered', revision: value.revision + 1, updatedAt: stamp, answeredBy: uid };
            const plans = await notificationPlan(db, tx, { ...context, recipientUid: value.studentId }, 'question_replied', input.questionId, next.revision, stamp);
            tx.set(ref, next); writeNotifications(db, tx, scope, plans);
            response = { question: projectQuestion(input.questionId, next, true) };
          }
        } else {
          if (typeof input.selected !== 'boolean') fail('invalid-argument', '스토리 공개 여부를 확인해 주세요.', 'GONGSIN_STORY_INVALID');
          const publicQuestion = clean(input.publicQuestion, 500, !input.selected), publicReply = clean(input.publicReply, 2000, !input.selected);
          if (input.selected && !value.reply) fail('failed-precondition', '개별 답변을 먼저 작성해 주세요.', 'GONGSIN_ANSWER_REQUIRED');
          if (value.publicQuestion === publicQuestion && value.publicReply === publicReply && value.selected === input.selected)
            return { question: projectQuestion(input.questionId, value, true), replayed: false };
          const publicState = (await tx.get(db.doc(path(scope, 'config', 'public')))).data();
          const next = { ...value, publicQuestion, publicReply, selected: input.selected, revision: value.revision + 1, updatedAt: stamp };
          const storyRef = db.doc(path(scope, 'stories', `s_${hash(input.questionId)}`));
          tx.set(ref, next);
          if (input.selected) {
            const source = { kind: value.source.kind, title: value.source.title,
              ...Object.fromEntries(['unitId', 'termId', 'page'].filter(key => value.source[key] !== undefined).map(key => [key, value.source[key]])) };
            tx.set(storyRef, { question: publicQuestion, answer: publicReply, source, createdAt: value.createdAt, updatedAt: stamp });
          } else tx.delete(storyRef);
          tx.set(db.doc(path(scope, 'config', 'public')), { enabled: settings.enabled, revision: settings.revision,
            contentRevision: (publicState?.contentRevision || 0) + 1 });
          response = { question: projectQuestion(input.questionId, next, true) };
        }
      } else {
        if (!validId(input.studentId) || !DURATIONS.includes(input.durationMs)) fail('invalid-argument', '학생과 질문 제한 기간을 확인해 주세요.', 'GONGSIN_RESTRICTION_INVALID');
        const target = (await tx.get(db.doc(`users/${input.studentId}`))).data();
        if (!activeProfile(target) || target.role !== 'student') fail('not-found', '학생 계정을 찾을 수 없습니다.', 'GONGSIN_STUDENT_NOT_FOUND');
        const reason = clean(input.reason, 300, input.durationMs === 0), until = input.durationMs ? stamp + input.durationMs : 0;
        const value = { studentId: input.studentId, studentLabel: String(target.name || target.displayName || '학생').slice(0, 80),
          until, reason, updatedAt: stamp, updatedBy: uid };
        tx.set(db.doc(path(scope, 'restrictions', input.studentId)), value);
        response = { restriction: projectRestriction(input.studentId, value) };
      }
      // The mutation, notifications, and replay receipt commit together; a retry
      // cannot send a second message or increment an inbox twice.
      tx.create(receiptRef, { actorUid: uid, studentId: response.question?.studentId || input.studentId || (!teacher ? uid : ''),
        action: input.action, payloadHash, response, createdAt: stamp });
      return { ...response, replayed: false };
    });
  };
  return { getGongsinmoongo, manageGongsinmoongo };
}

async function collectGongsinmoongoStudentRefs(db, semesterId, uid) {
  const references = new Map();
  for (const [name, field] of [['questions', 'studentId'], ['receipts', 'actorUid'], ['receipts', 'studentId']]) {
    let after;
    do {
      let query = db.collection(path(semesterId, name)).where(field, '==', uid).orderBy(FieldPath.documentId()).select().limit(250);
      if (after) query = query.startAfter(after);
      const rows = (await query.get()).docs;
      for (const row of rows) {
        references.set(row.ref.path, row.ref);
        if (name === 'questions') {
          const story = db.doc(path(semesterId, 'stories', `s_${hash(row.id)}`));
          references.set(story.path, story);
        }
      }
      after = rows.length === 250 ? rows.at(-1) : null;
    } while (after);
  }
  for (const name of ['restrictions', 'acknowledgments', 'submission_rates']) {
    const ref = db.doc(path(semesterId, name, uid)); references.set(ref.path, ref);
  }
  return [...references.values()];
}
module.exports = { createGongsinmoongoHandlers, collectGongsinmoongoStudentRefs, defaultSettings, normalizeSettings,
  normalizeInput, normalizeSource, projectQuestion, projectStory, root, path };
