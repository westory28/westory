const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { buildEnrollmentSlotId } = require('./productionGateway/archiveEnrollment');

const SHORTCUT_IDS = Object.freeze(['lesson', 'maps', 'wispi', 'avatar-shop', 'weplay', 'calendar']);
const fail = (code, message, reason) => { throw new HttpsError(code, message, { reason }); };
const validId = value => typeof value === 'string' && /^[^/\x00-\x1f]{1,180}$/.test(value)
  && value === value.trim() && !['.', '..'].includes(value);
const validItems = items => Array.isArray(items) && items.length <= SHORTCUT_IDS.length
  && items.every(item => SHORTCUT_IDS.includes(item)) && new Set(items).size === items.length;
const validRevision = value => Number.isSafeInteger(value) && value >= 0;
const normalizeStored = snapshot => {
  if (!snapshot.exists) return { items: [], revision: 0 };
  const data = snapshot.data();
  if (data.schemaVersion !== 1 || !validItems(data.items) || !validRevision(data.revision))
    fail('failed-precondition', '바로가기 설정을 확인하지 못했습니다.', 'SHORTCUTS_STATE_INVALID');
  return { items: data.items, revision: data.revision };
};

// Preferences follow the student's account across semesters and devices, while
// each request still requires a live session and the current canonical enrollment.
function createStudentLearningShortcutsHandler({ db, assertSession = assertScoreWorkflowSession, now = () => Date.now() }) {
  return async request => {
    const identity = await assertSession(request, { recentAuth: false, highRisk: false });
    const uid = request.auth?.uid, email = request.auth?.token?.email;
    if (!uid || (identity?.uid && identity.uid !== uid))
      fail('unauthenticated', '로그인 상태를 확인해 주세요.', 'SHORTCUTS_SESSION_INVALID');
    if (typeof email !== 'string' || !/@yongshin-ms\.ms\.kr$/i.test(email))
      fail('permission-denied', '학생 계정으로 로그인해 주세요.', 'SHORTCUTS_STUDENT_REQUIRED');
    const input = request.data;
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['action', 'semesterId', 'items', 'expectedRevision', '_session'].includes(key))
      || !['get', 'save'].includes(input.action) || !/^\d{4}-[12]$/.test(input.semesterId || '')
      || (input.action === 'get' && (input.items !== undefined || input.expectedRevision !== undefined))
      || (input.action === 'save' && (!validItems(input.items) || !validRevision(input.expectedRevision))))
      fail('invalid-argument', '선택한 바로가기를 다시 확인해 주세요.', 'SHORTCUTS_INPUT_INVALID');
    const scope = input.semesterId;
    return db.runTransaction(async tx => {
      const preferenceRef = db.doc(`users/${uid}/preferences/studentLearningTools`);
      const [profileDoc, pointerDoc, manifestDoc, slotDoc, preferenceDoc] = await tx.getAll(
        db.doc(`users/${uid}`), db.doc('site_settings/semester_active'), db.doc(`semester_manifests/${scope}`),
        db.doc(`semester_enrollment_slots/${buildEnrollmentSlotId(scope, uid)}`), preferenceRef,
      );
      const profile = profileDoc.data(), pointer = pointerDoc.data(), manifest = manifestDoc.data(), slot = slotDoc.data();
      if (!profile || profile.role !== 'student' || profile.deletedAt || profile.isDeleted === true || profile.weplayDeletionPending === true
        || (profile.registrationApprovalStatus && profile.registrationApprovalStatus !== 'APPROVED'))
        fail('permission-denied', '승인된 학생 계정이 필요합니다.', 'SHORTCUTS_STUDENT_REQUIRED');
      if (!pointer || !manifest || pointer.semesterId !== scope || manifest.semesterId !== scope || manifest.status !== 'ACTIVE'
        || manifest.readOnly === true || !validRevision(manifest.revision) || manifest.revision < 1 || pointer.revision !== manifest.revision)
        fail('failed-precondition', '현재 학기에서 다시 열어 주세요.', 'SHORTCUTS_SEMESTER_INACTIVE');
      if (!slot || slot.studentUid !== uid || slot.semesterId !== scope || !validId(slot.activeEnrollmentId)
        || (slot.status && slot.status !== 'ACTIVE'))
        fail('permission-denied', '현재 학기의 학적을 확인해 주세요.', 'SHORTCUTS_ENROLLMENT_REQUIRED');
      const enrollment = (await tx.get(db.doc(`semester_enrollments/${slot.activeEnrollmentId}`))).data();
      if (!enrollment || enrollment.studentUid !== uid || enrollment.semesterId !== scope || enrollment.enrollmentStatus !== 'ACTIVE'
        || enrollment.readOnly === true || !validId(enrollment.classId))
        fail('permission-denied', '현재 학기의 학적을 확인해 주세요.', 'SHORTCUTS_ENROLLMENT_REQUIRED');
      const classroom = (await tx.get(db.doc(`semester_classes/${enrollment.classId}`))).data();
      if (!classroom || classroom.semesterId !== scope || classroom.status !== 'ACTIVE' || classroom.readOnly === true)
        fail('permission-denied', '현재 학급을 확인해 주세요.', 'SHORTCUTS_CLASS_REQUIRED');
      const state = normalizeStored(preferenceDoc);
      if (input.action === 'get' || JSON.stringify(input.items) === JSON.stringify(state.items)) return state;
      if (input.expectedRevision !== state.revision)
        fail('aborted', '다른 기기에서 설정이 바뀌었습니다. 다시 불러와 주세요.', 'SHORTCUTS_REVISION_CONFLICT');
      const next = { items: [...input.items], revision: state.revision + 1 };
      tx.set(preferenceRef, { schemaVersion: 1, ...next, updatedAt: now() });
      return next;
    }, input.action === 'get' ? { readOnly: true } : undefined);
  };
}

module.exports = { SHORTCUT_IDS, createStudentLearningShortcutsHandler };
