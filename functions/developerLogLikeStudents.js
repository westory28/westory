const { FieldPath } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertActiveApplicationSession } = require('./sessionAuthority');
const { assertStudentRegistrationAccess } = require('./studentRegistrationAccess');

const ADMIN_EMAIL = 'westoria28@gmail.com';
const READER_FIELDS = Object.freeze([
  'role', 'disabled', 'isDeleted', 'deletedAt', 'registrationApprovalStatus',
]);
const STUDENT_FIELDS = Object.freeze([
  'role', 'studentName', 'name', 'displayName', 'studentGrade', 'studentClass',
  'studentNumber', 'grade', 'class', 'number', 'disabled', 'isDeleted', 'deletedAt',
]);
const text = value => typeof value === 'string' || typeof value === 'number'
  ? String(value).trim() : '';
const safeDocumentId = value => typeof value === 'string' && value.length > 0
  && value.length <= 128 && value === value.trim() && !/[\/\u0000-\u001f\u007f]/.test(value)
  && value !== '.' && value !== '..';

function parseInput(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).some(key => !['postId', 'cursor', 'pageSize', '_session'].includes(key))
    || typeof data.postId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(data.postId)
    || (data.cursor !== undefined && !safeDocumentId(data.cursor))
    || (data.pageSize !== undefined && (!Number.isInteger(data.pageSize)
      || data.pageSize < 1 || data.pageSize > 100))) {
    throw new HttpsError('invalid-argument', '좋아요를 누른 학생의 조회 범위를 확인해 주세요.');
  }
  return { postId: data.postId, cursor: data.cursor, pageSize: data.pageSize ?? 40 };
}

function studentRow(id, snapshot) {
  const profile = snapshot?.exists ? snapshot.data() : undefined;
  if (!profile || profile.role !== 'student' || profile.disabled === true
    || profile.isDeleted === true || profile.deletedAt) {
    return { id, name: '학생 정보 없음', grade: '', class: '', number: '' };
  }
  return {
    id,
    name: text(profile.studentName) || text(profile.name) || text(profile.displayName) || '이름 미등록',
    grade: text(profile.studentGrade) || text(profile.grade),
    class: text(profile.studentClass) || text(profile.class),
    number: text(profile.studentNumber) || text(profile.number),
  };
}

function createDeveloperLogLikeStudentsHandler({ db, assertSession = assertActiveApplicationSession }) {
  if (!db || typeof assertSession !== 'function') throw new TypeError('Database and session guard are required.');
  return async request => {
    const uid = request.auth?.uid;
    const email = text(request.auth?.token?.email).toLowerCase();
    if (!safeDocumentId(uid)) throw new HttpsError('unauthenticated', '다시 로그인해 주세요.');
    if (email !== ADMIN_EMAIL && !/^[^@\s]+@yongshin-ms\.ms\.kr$/.test(email)) {
      throw new HttpsError('permission-denied', '좋아요를 누른 학생은 교사만 확인할 수 있습니다.');
    }
    const { postId, cursor, pageSize } = parseInput(request.data);
    const identity = await assertSession(request);
    if (identity?.uid && identity.uid !== uid) throw new HttpsError('unauthenticated', '다시 로그인해 주세요.');
    const [reader] = await db.getAll(db.doc(`users/${uid}`), { fieldMask: READER_FIELDS });
    const profile = reader?.data();
    assertStudentRegistrationAccess(profile, reader?.exists === true);
    if (profile.disabled === true || profile.isDeleted === true || profile.deletedAt
      || (email !== ADMIN_EMAIL && profile.role !== 'teacher')) {
      throw new HttpsError('permission-denied', '좋아요를 누른 학생은 교사만 확인할 수 있습니다.');
    }
    const postRef = db.doc(`site_settings/developer_logs/items/${postId}`);
    // The body/images are not needed to check that this exact post still exists.
    const [post] = await db.getAll(postRef, { fieldMask: [] });
    if (!post?.exists) throw new HttpsError('not-found', '게시글을 찾을 수 없습니다.');
    let query = postRef.collection('likes').orderBy(FieldPath.documentId()).select('uid');
    if (cursor !== undefined) query = query.startAfter(cursor);
    const snapshot = await query.limit(pageSize + 1).get();
    const page = snapshot.docs.slice(0, pageSize);
    const hasMore = snapshot.docs.length > pageSize;
    // Document IDs are the owner key enforced by like-write rules. Never trust
    // a legacy payload's uid to choose a different student's profile.
    const validIds = page.map(doc => doc.id).filter(safeDocumentId);
    const profiles = validIds.length
      ? await db.getAll(...validIds.map(id => db.doc(`users/${id}`)), { fieldMask: STUDENT_FIELDS })
      : [];
    const byId = new Map(profiles.map(doc => [doc.id, doc]));
    return {
      students: page.map(doc => studentRow(doc.id, byId.get(doc.id))),
      nextCursor: hasMore ? page.at(-1).id : null,
      hasMore,
    };
  };
}

module.exports = { createDeveloperLogLikeStudentsHandler, READER_FIELDS, STUDENT_FIELDS };
