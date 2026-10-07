const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');

const hasActiveRosterStatus = (data = {}) => ['', 'active'].includes(String(data.enrollmentStatus ?? '').trim());
const isActiveStudent = (data = {}) => hasActiveRosterStatus(data)
  && (!Object.hasOwn(data, 'registrationApprovalStatus') || data.registrationApprovalStatus === 'APPROVED');
const token = (value) => String(value ?? '').trim().replace(/^(\d+)\D*$/, '$1').replace(/^0+(?=\d)/, '');
const identity = (data) => [token(data.grade ?? data.studentGrade), token(data.class ?? data.studentClass), token(data.number ?? data.studentNumber)].join('/');
const validateIdentity = (data) => {
  if (!/^[1-9]\d*\/[1-9]\d*\/[1-9]\d*$/.test(identity(data))) {
    throw new HttpsError('invalid-argument', '학년, 반, 번호를 확인해 주세요.');
  }
};
const assertUniqueIdentity = (snapshot, candidate, excludedUid = '') => {
  const conflict = snapshot.docs.some((entry) => entry.id !== excludedUid
    && (!entry.data().role || entry.data().role === 'student') && hasActiveRosterStatus(entry.data())
    && identity(entry.data()) === identity(candidate));
  if (conflict) throw new HttpsError('already-exists', '같은 학년·반·번호의 재학생이 이미 등록되어 있습니다.');
};

function createStudentRosterHandlers({ db, auth, assertManager, assertScope }) {
  const assertTransactionScope = async (transaction, year, semester) => {
    const [config, pointer] = await Promise.all([
      transaction.get(db.doc('site_settings/config')),
      transaction.get(db.doc('site_settings/semester_active')),
    ]);
    if (!config.exists || String(config.data().year) !== year || String(config.data().semester) !== semester
      || (pointer.exists && pointer.data().semesterId !== `${year}-${semester}`)) {
      throw new HttpsError('failed-precondition', '현재 학기가 바뀌었습니다. 명단을 새로고침해 주세요.');
    }
  };
  const currentScope = async (data) => {
    const scope = assertScope(data);
    if (!/^\d{4}$/.test(scope.year) || !/^[12]$/.test(scope.semester)) {
      throw new HttpsError('invalid-argument', '학년도와 학기를 확인해 주세요.');
    }
    const current = (await db.doc('site_settings/config').get()).data();
    if (!current || String(current.year) !== scope.year || String(current.semester) !== scope.semester) {
      throw new HttpsError('failed-precondition', '현재 학기의 학생 명단에서 변경해 주세요.');
    }
    return scope;
  };
  const createStudentData = async (request) => {
    const manager = await assertManager(request);
    const { year, semester } = await currentScope(request.data || {});
    const data = request.data || {};
    validateIdentity(data);
    const email = String(data.email || '').trim().toLowerCase();
    const name = String(data.name || '').replace(/\s+/g, ' ').trim();
    if (!/^[^\s@]+@yongshin-ms\.ms\.kr$/.test(email) || !name || name.length > 20) {
      throw new HttpsError('invalid-argument', '학생 이름과 학교 이메일을 확인해 주세요.');
    }
    const [grade, classValue, number] = identity(data).split('/');
    const existingStudents = await db.collection('users').get();
    const existingEmail = existingStudents.docs.find((entry) => entry.data().email === email);
    assertUniqueIdentity(existingStudents, data, existingEmail?.id);
    let account;
    try {
      account = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
      try {
        account = await auth.createUser({ email, displayName: name });
      } catch (createError) {
        if (createError.code !== 'auth/email-already-exists') throw createError;
        account = await auth.getUserByEmail(email);
      }
    }
    const uid = account.uid;
    const registrationApprovalStatus = await db.runTransaction(async (transaction) => {
      await assertTransactionScope(transaction, year, semester);
      const ref = db.doc(`users/${uid}`);
      const [existing, students] = await Promise.all([
        transaction.get(ref), transaction.get(db.collection('users')),
      ]);
      if (existing.exists) {
        const saved = existing.data();
        if (saved.role === 'student' && saved.email === email && identity(saved) === identity(data)
          && saved.name === name && hasActiveRosterStatus(saved)) {
          return Object.hasOwn(saved, 'registrationApprovalStatus') ? saved.registrationApprovalStatus : 'APPROVED';
        }
        throw new HttpsError('already-exists', '이 이메일의 학생 정보가 이미 있습니다. 기존 학생 정보를 수정해 주세요.');
      }
      assertUniqueIdentity(students, data, uid);
      transaction.create(ref, {
        uid, email, role: 'student', name, studentName: name, grade, class: classValue, number,
        studentGrade: grade, studentClass: classValue, studentNumber: number,
        customNameConfirmed: true, teacherPortalEnabled: false, staffPermissions: [],
        registrationApprovalStatus: 'PENDING', registrationRequestedAt: FieldValue.serverTimestamp(),
        enrollmentStatus: 'active', enrollmentReason: '', enrollmentYear: year, enrollmentSemester: semester,
        enrollmentUpdatedAt: FieldValue.serverTimestamp(), enrollmentUpdatedBy: manager.uid,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      return 'PENDING';
    });
    return { uid, enrollmentStatus: 'active', registrationApprovalStatus, requiresFirstSignIn: account.emailVerified !== true };
  };

  const updateStudentEnrollment = async (request) => {
    const manager = await assertManager(request);
    const { year, semester } = await currentScope(request.data || {});
    const uid = String(request.data?.uid || '').trim();
    const status = String(request.data?.status || '').trim();
    const reason = String(request.data?.reason || '').replace(/\s+/g, ' ').trim();
    if (!uid || uid.includes('/') || !['active', 'transferred', 'outside_quota', 'other'].includes(status)
      || reason.length > 200 || (status === 'other' && !reason)) {
      throw new HttpsError('invalid-argument', '학적 상태와 제외 사유를 확인해 주세요.');
    }
    const root = `years/${year}/semesters/${semester}`;
    await db.runTransaction(async (transaction) => {
      await assertTransactionScope(transaction, year, semester);
      const userRef = db.doc(`users/${uid}`);
      const [user, students, rosters, scores, enrollments] = await Promise.all([
        transaction.get(userRef),
        transaction.get(db.collection('users')),
        transaction.get(db.collection(`${root}/performance_score_rosters`)),
        transaction.get(db.collection(`users/${uid}/performance_scores`)),
        transaction.get(db.collection('semester_enrollments').where('studentUid', '==', uid)),
      ]);
      if (!user.exists || user.data().role !== 'student') {
        throw new HttpsError('not-found', '학생 정보를 찾을 수 없습니다.');
      }
      if (Object.hasOwn(user.data(), 'registrationApprovalStatus') && user.data().registrationApprovalStatus !== 'APPROVED') {
        throw new HttpsError('failed-precondition', '학생 등록 승인을 먼저 완료해 주세요.');
      }
      if (status === 'active') assertUniqueIdentity(students, user.data(), uid);
      if ((user.data().enrollmentStatus || 'active') === status
        && (user.data().enrollmentReason || '') === (status === 'active' ? '' : reason)) return;
      const patch = {
        enrollmentStatus: status, enrollmentReason: status === 'active' ? '' : reason,
        enrollmentYear: year, enrollmentSemester: semester,
        enrollmentUpdatedAt: FieldValue.serverTimestamp(), enrollmentUpdatedBy: manager.uid,
      };
      transaction.update(userRef, { ...patch, updatedAt: FieldValue.serverTimestamp() });
      transaction.set(userRef.collection('enrollment_history').doc(), {
        ...patch, previousStatus: user.data().enrollmentStatus || 'active',
      });
      // This is the score-roster inclusion classification, not an enrollment
      // lifecycle transition. Preserve ACTIVE/closed records and Wis bindings.
      enrollments.docs.forEach((enrollment) => {
        if (enrollment.data().semesterId !== `${year}-${semester}`) return;
        transaction.update(enrollment.ref, {
          rosterExclusionStatus: status,
          rosterExclusionReason: patch.enrollmentReason,
          rosterExclusionUpdatedAt: patch.enrollmentUpdatedAt,
          rosterExclusionUpdatedBy: manager.uid,
        });
      });
      scores.docs.forEach((score) => {
        const data = score.data();
        if (String(data.academicYear) === year && String(data.semester) === semester) {
          transaction.update(score.ref, patch);
        }
      });
      rosters.docs.forEach((roster) => {
        const rows = Array.isArray(roster.data().rows) ? roster.data().rows : [];
        if (!rows.some((row) => row.uid === uid)) return;
        transaction.update(roster.ref, {
          rows: rows.map((row) => row.uid === uid ? {
            ...row, enrollmentStatus: status, enrollmentReason: patch.enrollmentReason,
          } : row),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    });
    return { uid, status };
  };
  const updateStudentData = async (request) => {
    await assertManager(request);
    const { year, semester } = await currentScope(request.data || {});
    const input = request.data || {};
    const uid = String(input.uid || input.studentUid || input.targetUid || '').trim();
    if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', '학생을 확인해 주세요.');
    validateIdentity(input);
    const [grade, classValue, number] = identity(input).split('/');
    const name = String(input.name ?? input.studentName ?? '').trim();
    if (!name || name.length > 20) throw new HttpsError('invalid-argument', '학생 이름을 확인해 주세요.');
    return db.runTransaction(async (transaction) => {
      await assertTransactionScope(transaction, year, semester);
      await require('./scoreWorkflowGuard').assertLegacyProfileWritable({ db, transaction, uid, year, semester });
      const [user, students, rosters, scores] = await Promise.all([
        transaction.get(db.doc(`users/${uid}`)), transaction.get(db.collection('users')),
        transaction.get(db.collection(`years/${year}/semesters/${semester}/performance_score_rosters`)),
        transaction.get(db.collection(`users/${uid}/performance_scores`)),
      ]);
      if (!user.exists) throw new HttpsError('not-found', '학생 정보를 찾을 수 없습니다.');
      if (isActiveStudent(user.data())) assertUniqueIdentity(students, input, uid);
      const timestamp = FieldValue.serverTimestamp();
      const email = String(input.email ?? user.data().email ?? '').trim().toLowerCase();
      const patch = { grade, class: classValue, number, name, email, studentName: name,
        studentGrade: grade, studentClass: classValue, studentNumber: number,
        gradeClass: `${grade}학년 ${classValue}반 ${number}번`, updatedAt: timestamp };
      transaction.update(user.ref, patch);
      let updatedRosterCount = 0, updatedRosterRowCount = 0, scoreCount = 0;
      rosters.docs.forEach((roster) => {
        const rows = Array.isArray(roster.data().rows) ? roster.data().rows : [];
        if (!rows.some((row) => row.uid === uid)) return;
        const nextRows = rows.map((row) => {
          if (row.uid !== uid) return row;
          updatedRosterRowCount++;
          return { ...row, grade, class: classValue, number, studentName: name };
        });
        const classes = [...new Set(nextRows.map((row) => row.class).filter(Boolean))];
        transaction.update(roster.ref, { rows: nextRows, classes, targetClass: classes.length === 1 ? classes[0] : '', updatedAt: timestamp });
        updatedRosterCount++;
      });
      scores.docs.forEach((score) => {
        const data = score.data();
        if (String(data.academicYear) !== year || String(data.semester) !== semester) return;
        transaction.update(score.ref, { grade, class: classValue, number, studentName: name, profileUpdatedAt: timestamp });
        scoreCount++;
      });
      return { uid, year, semester, updatedRosterCount, updatedRosterRowCount, updatedRelatedDocCount: 1 + scoreCount + updatedRosterCount };
    });
  };
  return { createStudentData, updateStudentEnrollment, updateStudentData };
}

module.exports = { createStudentRosterHandlers, assertUniqueIdentity, validateIdentity, isActiveStudent };
