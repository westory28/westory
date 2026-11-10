const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
require('./verify-gongsinmoongo-indexes.cjs');
const projectId = 'demo-westory-session-gongsin';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^127\.0\.0\.1:\d+$/.test(host) || process.env.GCLOUD_PROJECT !== projectId)
  throw new Error('Use the dedicated local demo-westory-session-gongsin emulator only.');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, DocumentReference } = require('firebase-admin/firestore');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const client = require('firebase/firestore');
const { createGongsinmoongoHandlers, defaultSettings, collectGongsinmoongoStudentRefs } = require('../gongsinmoongo');
const { buildEnrollmentSlotId } = require('../productionGateway/archiveEnrollment');
const app = initializeApp({ projectId }), db = getFirestore(app);
const root = 'years/2026/semesters/2', scope = '2026-2';
const epoch = Math.floor(Date.now() / 1000), sessionRevision = 'a'.repeat(64);
let tick = Date.now(), metrics = { reads: 0, writes: 0, queries: 0 };
// Include the real session/maintenance guard's direct document reads as well
// as the business transaction reads; credentials and document values are not logged.
const originalDocumentGet = DocumentReference.prototype.get;
DocumentReference.prototype.get = async function (...args) {
  const value = await originalDocumentGet.apply(this, args); metrics.reads++; return value;
};
const instrumented = { doc: (...args) => db.doc(...args), collection: (...args) => db.collection(...args),
  runTransaction: (body, options) => db.runTransaction(async tx => body({
    async get(ref) { const result = await tx.get(ref); metrics.reads += result.docs ? Math.max(1, result.size) : 1;
      if (result.docs) metrics.queries++; return result; },
    async getAll(...refs) { const result = await tx.getAll(...refs); metrics.reads += result.length; return result; },
    create(...args) { metrics.writes++; return tx.create(...args); },
    set(...args) { metrics.writes++; return tx.set(...args); },
    delete(...args) { metrics.writes++; return tx.delete(...args); },
  }), options) };
const api = createGongsinmoongoHandlers({ db: instrumented, now: () => tick });
const session = { status: 'active', authTime: epoch, schemaVersion: 2, authorityGeneration: 'w1r2-2026-08-09',
  protocolVersion: 2, sessionRevision, authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(tick + 3600000),
  highRiskExpiresAt: Timestamp.fromMillis(tick + 3600000) };
const request = (uid, data) => ({ auth: { uid, token: { email: uid === 'admin' ? 'westoria28@gmail.com' : `${uid}@yongshin-ms.ms.kr`, auth_time: epoch } },
  data: { semesterId: scope, ...data, _session: { authorityGeneration: session.authorityGeneration, protocolVersion: 2, revision: sessionRevision } } });
const command = (uid, action, values = {}) => api.manageGongsinmoongo(request(uid, { action, requestId: randomUUID(), ...values }));
const query = (uid, mode, values = {}) => api.getGongsinmoongo(request(uid, { mode, ...values }));
const reason = expected => error => error.details?.reason === expected;
const get = async path => (await db.doc(path).get()).data();
const questionInput = { question: '교린의 뜻을 알려 주세요.', source: { kind: 'general' } };
const resetMetrics = () => { metrics = { reads: 0, writes: 0, queries: 0 }; };
const results = [], counts = {};
async function seed(enabled = true) {
  assert.equal((await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok, true);
  tick = Date.now();
  const settings = { ...defaultSettings(), enabled, revision: 1 };
  const rows = {
    'site_settings/semester_active': { semesterId: scope, revision: 1 },
    'site_settings/config': { year: '2026', semester: '2', activeSemesterId: scope },
    [`semester_manifests/${scope}`]: { semesterId: scope, status: 'ACTIVE', revision: 1 },
    'semester_classes/class_one': { semesterId: scope, status: 'ACTIVE' },
    [`${root}/gongsinmoongo_config/settings`]: settings,
    [`${root}/gongsinmoongo_config/public`]: { enabled, revision: 1 },
    'site_settings/notification_config': { enabled: true },
    'site_settings/student_maintenance': { enabled: false, blockedRoles: ['student'], bypassUids: [],
      title: '접속 설정', message: '합성 검증', startedAt: null, updatedAt: Timestamp.now(), updatedBy: 'admin', revision: 1 },
  };
  for (const uid of ['a', 'b', 'teacher', 'admin', 'staff']) {
    const role = ['teacher', 'admin'].includes(uid) ? 'teacher' : uid === 'staff' ? 'staff' : 'student';
    rows[`users/${uid}`] = { role, name: `합성 ${uid}`, email: uid === 'admin' ? 'westoria28@gmail.com' : `${uid}@yongshin-ms.ms.kr`, registrationApprovalStatus: 'APPROVED' };
    rows[`application_sessions/${uid}/sessions/${epoch}`] = session;
    if (role === 'student') {
      rows[`semester_enrollment_slots/${buildEnrollmentSlotId(scope, uid)}`] = { semesterId: scope, studentUid: uid, activeEnrollmentId: `en_${uid}`, status: 'ACTIVE' };
      rows[`semester_enrollments/en_${uid}`] = { semesterId: scope, studentUid: uid, classId: 'class_one', enrollmentStatus: 'ACTIVE' };
      rows[`${root}/gongsinmoongo_acknowledgments/${uid}`] = { studentId: uid, warningRevision: 1 };
    }
  }
  await Promise.all(Object.entries(rows).map(([path, value]) => db.doc(path).set(value)));
  resetMetrics();
}
async function check(name, callback) { await seed(); await callback(); results.push(name); console.log(`PASS ${name}`); }
let rules;
(async () => {
  await check('real session proof, pending account, stale semester and staff cannot access private service', async () => {
    const bad = request('a', { mode: 'questions' }); delete bad.data._session;
    await assert.rejects(api.getGongsinmoongo(bad), error => error.code === 'unauthenticated');
    await assert.rejects(query('staff', 'questions'), reason('GONGSIN_STUDENT_REQUIRED'));
    await db.doc('users/a').update({ registrationApprovalStatus: 'PENDING' });
    await assert.rejects(query('a', 'questions'));
    await db.doc('users/a').update({ registrationApprovalStatus: 'APPROVED' });
    await assert.rejects(api.getGongsinmoongo(request('a', { mode: 'questions', semesterId: '2026-1' })), reason('GONGSIN_SEMESTER_INACTIVE'));
    assert.equal(metrics.writes, 0);
  });
  await check('private creation is atomic with existing inbox notifications and exact duplicate retry does no writes', async () => {
    const req = request('a', { action: 'submit', requestId: randomUUID(), ...questionInput });
    const first = await api.manageGongsinmoongo(req); counts.submit = { ...metrics };
    assert.equal(first.question.profileEmojiId, 'smile');
    assert.equal((await db.collection(`${root}/gongsinmoongo_questions`).get()).size, 1);
    for (const uid of ['teacher', 'admin']) {
      assert.equal((await get(`${root}/notification_inboxes/${uid}`)).unreadCount, 1);
      const note = (await db.collection(`${root}/notification_inboxes/${uid}/items`).get()).docs[0].data();
      assert.equal(note.type, 'question_created'); assert.match(note.targetUrl, /\/teacher\/gongsinmoongo\?question=/);
    }
    resetMetrics(); const retry = await api.manageGongsinmoongo(req); counts.retry = { ...metrics };
    assert.equal(retry.replayed, true); assert.equal(retry.question.id, first.question.id); assert.equal(metrics.writes, 0);
    await assert.rejects(api.manageGongsinmoongo({ ...req, data: { ...req.data, question: '변경된 내용' } }), reason('GONGSIN_REQUEST_REUSED'));
    await assert.rejects(query('b', 'detail', { questionId: first.question.id }), reason('GONGSIN_QUESTION_NOT_FOUND'));
    await assert.rejects(query('b', 'questions', { studentId: 'a' }), reason('GONGSIN_OWNER_REQUIRED'));
    assert.equal((await query('b', 'questions')).items.length, 0);
    assert.equal((await query('teacher', 'questions', { studentId: 'a' })).items.length, 1);
  });
  await check('concurrent duplicate submissions commit one question and one notification per recipient', async () => {
    const req = request('a', { action: 'submit', requestId: randomUUID(), ...questionInput });
    const values = await Promise.all([api.manageGongsinmoongo(req), api.manageGongsinmoongo(req), api.manageGongsinmoongo(req)]);
    assert.equal(values.filter(value => !value.replayed).length, 1);
    assert.equal(new Set(values.map(value => value.question.id)).size, 1);
    assert.equal((await get(`${root}/notification_inboxes/teacher`)).unreadCount, 1);
  });
  await check('answers use existing student inbox, stale revision rejects, unchanged save does no writes', async () => {
    const created = await command('a', 'submit', questionInput);
    resetMetrics();
    const answer = await command('teacher', 'answer', { questionId: created.question.id, expectedRevision: 1, reply: '이웃 나라와의 교류를 뜻해요.' }); counts.answer = { ...metrics };
    assert.equal(answer.question.revision, 2);
    assert.equal((await get(`${root}/notification_inboxes/a`)).unreadCount, 1);
    const note = (await db.collection(`${root}/notification_inboxes/a/items`).get()).docs[0].data();
    assert.equal(note.type, 'question_replied'); assert.match(note.targetUrl, /\/student\/gongsinmoongo\?question=/);
    await assert.rejects(command('teacher', 'answer', { questionId: created.question.id, expectedRevision: 1, reply: '경합' }), reason('GONGSIN_REVISION_CONFLICT'));
    resetMetrics(); await command('teacher', 'answer', { questionId: created.question.id, expectedRevision: 2, reply: answer.question.reply });
    assert.equal(metrics.writes, 0); counts.unchanged = { ...metrics };
    await assert.rejects(command('b', 'answer', { questionId: created.question.id, expectedRevision: 2, reply: '권한 없음' }), reason('GONGSIN_TEACHER_REQUIRED'));
  });
  await check('curated stories expose only edited text and safe learning source, no student identity or private question ID', async () => {
    const { question } = await command('a', 'submit', questionInput);
    await command('teacher', 'answer', { questionId: question.id, expectedRevision: 1, reply: '개인 답변' });
    await command('teacher', 'story', { questionId: question.id, expectedRevision: 2, selected: true, publicQuestion: '교린이란?', publicReply: '이웃 나라와의 관계입니다.' });
    const page = await query('b', 'stories'); assert.equal(page.items.length, 1);
    assert.equal((await get(`${root}/gongsinmoongo_config/public`)).contentRevision, 1);
    const raw = JSON.stringify(page); for (const forbidden of ['studentId', 'studentLabel', 'profileEmojiId', 'resultKey', question.id, '개인 답변']) assert(!raw.includes(forbidden));
    assert.equal(page.items[0].question, '교린이란?');
    assert.equal(Object.hasOwn((await query('a', 'detail', { questionId: question.id })).question, 'publicQuestion'), false);
    await command('teacher', 'story', { questionId: question.id, expectedRevision: 3, selected: false, publicQuestion: '교린이란?', publicReply: '이웃 나라와의 관계입니다.' });
    assert.equal((await query('b', 'stories')).items.length, 0);
    assert.equal((await get(`${root}/gongsinmoongo_config/public`)).contentRevision, 2);
  });
  await check('closed service, disabled acceptance, first-use warning and timed restriction enforce server-side', async () => {
    await db.doc(`${root}/gongsinmoongo_config/settings`).update({ enabled: false });
    assert.equal((await query('a', 'state')).settings.enabled, false);
    await assert.rejects(command('a', 'submit', questionInput), reason('GONGSIN_CLOSED'));
    await assert.rejects(query('a', 'questions'), reason('GONGSIN_CLOSED'));
    assert.equal((await query('teacher', 'questions')).items.length, 0);
    await db.doc(`${root}/gongsinmoongo_config/settings`).update({ enabled: true, acceptingQuestions: false });
    await assert.rejects(command('a', 'submit', questionInput), reason('GONGSIN_NOT_ACCEPTING'));
    await db.doc(`${root}/gongsinmoongo_config/settings`).update({ acceptingQuestions: true });
    await db.doc(`${root}/gongsinmoongo_acknowledgments/a`).delete();
    await assert.rejects(command('a', 'submit', questionInput), reason('GONGSIN_WARNING_REQUIRED'));
    await command('a', 'ack', { warningRevision: 1 });
    await command('teacher', 'restrict', { studentId: 'a', durationMs: 3600000, reason: '반복된 사담' });
    await assert.rejects(command('a', 'submit', questionInput), reason('GONGSIN_STUDENT_RESTRICTED'));
    assert.equal((await query('teacher', 'restrictions')).items.length, 1);
    tick += 3600001;
    assert.equal((await command('a', 'submit', questionInput)).question.question, questionInput.question);
  });
  await check('active mock exam blocks general questions, missing deadline and legacy category cannot bypass', async () => {
    const attemptRef = db.doc('semester_assessment_attempts/active');
    const attempt = { studentUid: 'a', semesterId: scope, assessmentKind: 'QUIZ', category: 'exam_prep', status: 'STARTED', deadlineAtIso: new Date(tick + 60000).toISOString() };
    for (const variant of [attempt, { ...attempt, category: 'exam_prep__round_2' }, { ...attempt, deadlineAtIso: '' }]) {
      await attemptRef.set(variant); resetMetrics();
      await assert.rejects(command('a', 'submit', questionInput), reason('GONGSIN_EXAM_IN_PROGRESS')); assert.equal(metrics.writes, 0);
    }
    await attemptRef.set({ ...attempt, studentUid: 'b' });
    await command('a', 'submit', questionInput);
  });
  await check('mock source requires own immutable submitted wrong question, dictionary and lesson verify exact published source', async () => {
    const record = { studentUid: 'a', semesterId: scope, assessmentKind: 'QUIZ', status: 'SUBMITTED', category: 'exam_prep', submittedAtIso: new Date(tick).toISOString(),
      answerChecks: [{ id: 'saved-1', correct: false }], questionSnapshots: [{ id: 'saved-1', question: '교린은?', answer: '이웃', type: 'short' }] };
    await db.doc('semester_assessment_results/result').set(record);
    const source = { kind: 'mock', resultKey: 'canonical:result', questionId: 'saved-1', origin: 'wrong-note' };
    await assert.rejects(command('a', 'submit', { ...questionInput, source: { ...source, origin: undefined } }), reason('GONGSIN_RESULT_REQUIRED'));
    await assert.rejects(command('b', 'submit', { ...questionInput, source }), reason('GONGSIN_RESULT_FORBIDDEN'));
    await db.doc('semester_assessment_results/result').update({ answerChecks: [{ id: 'saved-1', correct: true }] });
    await assert.rejects(command('a', 'submit', { ...questionInput, source }), reason('QUIZ_REVIEW_QUESTION_INVALID'));
    await db.doc('semester_assessment_results/result').set(record);
    assert.equal((await command('a', 'submit', { ...questionInput, source })).question.source.title, '모의고사 · 1번');
    tick += 10001;
    await db.doc('history_dictionary_catalog/catalog-history-term').set({ id: 'catalog-history-term', word: '교린', managedBy: 'westory-history-dictionary-catalog', schemaVersion: 1 });
    assert.equal((await command('a', 'submit', { ...questionInput, source: { kind: 'dictionary', termId: 'catalog-history-term' } })).question.source.title, '교린');
    tick += 10001;
    await db.doc('lessons/legacy').set({ unitId: 'unit', title: '옛 공개 자료', isVisibleToStudents: true });
    await db.doc(`${root}/lessons/current`).set({ unitId: 'unit', title: '현재 비공개 자료', isVisibleToStudents: false });
    await assert.rejects(command('a', 'submit', { ...questionInput, source: { kind: 'lesson', unitId: 'unit' } }), reason('GONGSIN_LESSON_HIDDEN'));
  });
  await check('global and local notification toggles suppress inbox writes without losing questions', async () => {
    await db.doc('site_settings/notification_config').set({ enabled: false });
    const { question } = await command('a', 'submit', questionInput);
    assert.equal((await db.doc(`${root}/notification_inboxes/teacher`).get()).exists, false);
    await db.doc('site_settings/notification_config').set({ enabled: true, eventPolicies: { question_replied: { enabled: false } } });
    await command('teacher', 'answer', { questionId: question.id, expectedRevision: 1, reply: '답변' });
    assert.equal((await db.doc(`${root}/notification_inboxes/a`).get()).exists, false);
    await db.doc('site_settings/notification_config').set({ enabled: true });
    await db.doc(`${root}/gongsinmoongo_config/settings`).update({ teacherQuestionNotifications: false, studentReplyNotifications: false });
    tick += 10001;
    await command('a', 'submit', questionInput);
    assert.equal((await db.doc(`${root}/notification_inboxes/teacher`).get()).exists, false);
  });
  await check('admin-only settings use revision and warning changes require acknowledgment again', async () => {
    const state = await query('admin', 'state'); const settings = { ...state.settings, warning: { ...state.settings.warning, body: '변경된 이용 안내' } };
    await assert.rejects(command('teacher', 'settings', { settings, expectedRevision: 1 }), reason('GONGSIN_ADMIN_REQUIRED'));
    const saved = await command('admin', 'settings', { settings, expectedRevision: 1 });
    assert.equal(saved.settings.revision, 2); assert.equal(saved.settings.warning.revision, 2);
    assert.deepEqual(await get(`${root}/gongsinmoongo_config/public`), { enabled: true, revision: 2, contentRevision: 0 });
    await assert.rejects(command('a', 'submit', questionInput), reason('GONGSIN_WARNING_REQUIRED'));
    resetMetrics(); await command('admin', 'settings', { settings: saved.settings, expectedRevision: 2 }); assert.equal(metrics.writes, 0);
  });
  await check('cursor pagination never returns another owner and student cleanup removes teacher receipts with private responses', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => [`${root}/gongsinmoongo_questions/q${i.toString().padStart(2, '0')}`, {
      semesterId: scope, studentId: i === 24 ? 'b' : 'a', studentLabel: '합성', profileEmojiId: 'smile', source: { kind: 'general', title: '질문' },
      question: `질문 ${i}`, reply: '', publicQuestion: '', publicReply: '', selected: false, status: 'waiting', revision: 1, createdAt: i + 1, updatedAt: i + 1,
    }]);
    await Promise.all(rows.map(([path, value]) => db.doc(path).set(value)));
    const first = await query('a', 'questions'); assert.equal(first.items.length, 20); assert(first.nextCursor);
    const second = await query('a', 'questions', { cursor: first.nextCursor }); assert.equal(second.items.length, 4); assert.equal(second.nextCursor, null);
    assert([...first.items, ...second.items].every(row => row.studentId === 'a'));
    await command('teacher', 'answer', { questionId: 'q00', expectedRevision: 1, reply: '개인 답변' });
    const refs = await collectGongsinmoongoStudentRefs(db, scope, 'a');
    const receipts = refs.filter(ref => ref.path.includes('gongsinmoongo_receipts'));
    assert.equal(receipts.length, 1); assert.equal((await get(receipts[0].path)).actorUid, 'teacher');
    assert(!refs.some(ref => ref.path.endsWith('/q24')));
  });
  await check('Firestore rules expose only active nonpersonal gate; content and other inboxes are callable-only', async () => {
    rules = await initializeTestEnvironment({ projectId, firestore: { host: host.split(':')[0], port: Number(host.split(':')[1]), rules: fs.readFileSync('firestore.rules', 'utf8') } });
    const a = rules.authenticatedContext('a', { email: 'a@yongshin-ms.ms.kr', auth_time: epoch }).firestore();
    const teacher = rules.authenticatedContext('teacher', { email: 'teacher@yongshin-ms.ms.kr', auth_time: epoch }).firestore();
    const created = await command('a', 'submit', questionInput);
    await assertSucceeds(client.getDoc(client.doc(a, `${root}/gongsinmoongo_config/public`)));
    for (const connection of [a, teacher]) {
      await assertFails(client.getDoc(client.doc(connection, `${root}/gongsinmoongo_questions/${created.question.id}`)));
      await assertFails(client.getDocs(client.collection(connection, `${root}/gongsinmoongo_questions`)));
      await assertFails(client.getDoc(client.doc(connection, `${root}/gongsinmoongo_config/settings`)));
      await assertFails(client.setDoc(client.doc(connection, `${root}/gongsinmoongo_config/public`), { enabled: true }));
    }
    await assertFails(client.getDocs(client.collection(a, `${root}/notification_inboxes/teacher/items`)));
    await assertSucceeds(client.getDocs(client.collection(teacher, `${root}/notification_inboxes/teacher/items`)));
    await db.doc('site_settings/semester_active').update({ semesterId: '2027-1' });
    await assertFails(client.getDoc(client.doc(a, `${root}/gongsinmoongo_config/public`)));
  });
  console.log(JSON.stringify({ status: 'PASS', cases: results.length, checks: results, operationCounts: counts }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (rules) await rules.cleanup(); await deleteApp(app); });
