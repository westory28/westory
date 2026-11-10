const { HttpsError } = require('firebase-functions/v2/https');
const { assertActiveApplicationSession } = require('./sessionAuthority');

const ADMIN_EMAIL = 'westoria28@gmail.com';
const STUDENT_FIELDS = [
  'studentName', 'studentGrade', 'studentClass', 'studentNumber', 'grade', 'class', 'number',
];
const ROSTER_FIELDS = Object.freeze([
  'role', 'email', ...STUDENT_FIELDS, 'name', 'displayName', 'nickname', 'customName', 'gradeClass',
  'enrollmentStatus', 'enrollmentReason', 'enrollmentYear', 'enrollmentSemester',
  'enrollmentMovementTiming', 'enrollmentMovementDate', 'registrationApprovalStatus',
]);
const READER_FIELDS = ['role', 'teacherPortalEnabled', 'staffPermissions', 'disabled', 'isDeleted', 'deletedAt'];
const text = value => String(value ?? '').trim();

const isRosterProfile = profile => {
  const role = text(profile.role);
  if (role === 'student') return true;
  return STUDENT_FIELDS.some(field => text(profile[field]))
    && (!role || text(profile.email).toLowerCase() === ADMIN_EMAIL);
};
const options = value => Array.isArray(value) ? value.map(item => ({
  value: text(item?.value), label: text(item?.label),
})).filter(item => item.value && item.label) : [];

function createTeacherStudentRosterHandler({ db, assertSession = assertActiveApplicationSession }) {
  return async request => {
    const uid = text(request.auth?.uid), email = text(request.auth?.token?.email).toLowerCase();
    if (!uid || (email !== ADMIN_EMAIL && !/^[^@\s]+@yongshin-ms\.ms\.kr$/.test(email)))
      throw new HttpsError('permission-denied', '학교 계정으로 다시 로그인해 주세요.');
    const input = request.data;
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['year', 'semester', '_session'].includes(key))
      || !/^\d{4}$/.test(String(input.year)) || !/^[12]$/.test(String(input.semester)))
      throw new HttpsError('invalid-argument', '조회할 학년도를 확인해 주세요.');
    await assertSession(request);
    const [readerDocs, config] = await Promise.all([
      db.getAll(db.doc(`users/${uid}`), { fieldMask: READER_FIELDS }),
      db.doc('site_settings/config').get(),
    ]);
    const profile = readerDocs[0]?.data() || {};
    if (profile.disabled === true || profile.isDeleted === true || profile.deletedAt
      || (email !== ADMIN_EMAIL && profile.role !== 'teacher'
        && !(profile.teacherPortalEnabled === true && Array.isArray(profile.staffPermissions)
          && profile.staffPermissions.includes('student_list_read'))))
      throw new HttpsError('permission-denied', '학생 명단 조회 권한이 없습니다.');
    const year = String(input.year), semester = String(input.semester);
    if (!config.exists || text(config.data()?.year) !== year || text(config.data()?.semester) !== semester)
      throw new HttpsError('failed-precondition', '현재 학기가 바뀌었습니다. 화면을 새로고침해 주세요.');

    // This screen needs the complete roster for whole-school search, class
    // pages and duplicate identity checks. Legacy profiles can lack role, so
    // a role filter would silently drop pupils. Until that index is migrated,
    // read only this projection, without an arbitrary truncation limit. Field
    // selection reduces payload size, not Firestore document-read charges.
    const [snapshot, school] = await Promise.all([
      db.collection('users').select(...ROSTER_FIELDS).get(),
      db.doc('site_settings/school_config').get().catch(() => null),
    ]);
    return {
      year, semester,
      students: snapshot.docs.flatMap(doc => {
        const data = doc.data();
        if (!isRosterProfile(data)) return [];
        return [{ id: doc.id, ...Object.fromEntries(ROSTER_FIELDS
          .filter(field => Object.hasOwn(data, field))
          .map(field => [field, data[field]])) }];
      }),
      schoolConfig: school?.exists ? {
        grades: options(school.data()?.grades), classes: options(school.data()?.classes),
      } : null,
    };
  };
}

module.exports = { createTeacherStudentRosterHandler, ROSTER_FIELDS };
