const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { withStudentMaintenanceGuard } = require('./studentMaintenance');
const { assertActiveApplicationSession } = require('./sessionAuthority');

// The session/maintenance modules were restored verbatim from the deployed
// openApplicationSession source (2026-09-17). They are dependencies only: this
// module deliberately does not export or redeploy the session callables.
const assertScoreWorkflowSession = (request, options = {}) =>
  withStudentMaintenanceGuard((current) => assertActiveApplicationSession(current, options))(request);

const assertLegacyScoreWritable = async ({ db, transaction, uid, year, semester }) => {
  const query = db.collection('semester_grade_records').where('studentUid', '==', uid);
  const snapshot = await transaction.get(query);
  if (snapshot.docs.some((entry) => entry.data().semesterId === `${year}-${semester}`)) {
    throw new HttpsError('failed-precondition', '공식 성적 원장의 이의 신청 절차를 이용해 주세요.', {
      reason: 'CLIENT_UPDATE_REQUIRED', replacement: 'requestGradeReview via executeCommand',
    });
  }
};

const assertLegacyProfileWritable = async ({ db, transaction, uid, year, semester }) => {
  const semesterId = `${year}-${semester}`;
  const slotId = `slot_${createHash('sha256').update(`${semesterId}\n${uid}`).digest('hex').slice(0, 40)}`;
  const [user, pointer, slot, enrollments] = await Promise.all([
    transaction.get(db.doc(`users/${uid}`)),
    transaction.get(db.doc('site_settings/semester_active')),
    transaction.get(db.doc(`semester_enrollment_slots/${slotId}`)),
    transaction.get(db.collection('semester_enrollments').where('studentUid', '==', uid)),
  ]);
  const data = user.data() || {};
  if (Object.hasOwn(data, 'registrationApprovalStatus') && data.registrationApprovalStatus !== 'APPROVED') {
    throw new HttpsError('failed-precondition', '학생 등록 승인을 먼저 완료해 주세요.');
  }
  if (pointer.exists && pointer.data().semesterId !== semesterId) {
    throw new HttpsError('failed-precondition', '현재 학기가 바뀌었습니다. 명단을 새로고침해 주세요.');
  }
  if (slot.exists || enrollments.docs.some((entry) => entry.data().semesterId === semesterId || entry.data().enrollmentStatus === 'ACTIVE')) {
    throw new HttpsError('failed-precondition', '현재 학적이 있는 학생입니다. 명단을 새로고침한 뒤 다시 저장해 주세요.', {
      reason: 'STUDENT_PROFILE_CANONICAL_COMMAND_REQUIRED',
    });
  }
};

module.exports = { assertScoreWorkflowSession, assertLegacyScoreWritable, assertLegacyProfileWritable };
