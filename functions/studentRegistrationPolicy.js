const { FieldValue } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const { assertActiveApplicationSession } = require("./sessionAuthority");
const { POLICY_PATH, validFields, normalizePolicy } = require("./studentRegistrationPolicyCore");
const ADMIN_EMAIL = "westoria28@gmail.com";
const identity = request => {
  const uid = request.auth?.uid, email = String(request.auth?.token?.email || "").toLowerCase();
  if (!uid || (email !== ADMIN_EMAIL && !/^[^@\s]+@yongshin-ms\.ms\.kr$/i.test(email)))
    throw new HttpsError("permission-denied", "학교 계정으로 다시 로그인해 주세요.");
  return { uid, email };
};
const invalid = () => { throw new HttpsError("invalid-argument", "가입 학년도와 학년을 확인해 주세요.",
  { reason: "STUDENT_REGISTRATION_POLICY_INPUT_INVALID" }); };
const createStudentRegistrationPolicyHandlers = ({ db, assertSession = assertActiveApplicationSession }) => ({
  getStudentRegistrationPolicy: async request => {
    identity(request);
    if (!request.data || typeof request.data !== "object" || Array.isArray(request.data)
      || Object.keys(request.data).some(key => key !== "_session")) invalid();
    const snap = await db.doc(POLICY_PATH).get();
    return normalizePolicy(snap.exists ? snap.data() : null, snap.exists);
  },
  saveStudentRegistrationPolicy: async request => {
    const actor = identity(request), data = request.data;
    await assertSession(request, { recentAuth: true, highRisk: true });
    if (!data || typeof data !== "object" || Array.isArray(data)
      || Object.keys(data).some(key => !["admissionYear", "admissionGrade", "expectedRevision", "_session"].includes(key))
      || !validFields(data) || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0) invalid();
    return db.runTransaction(async tx => {
      const profileSnap = await tx.get(db.doc(`users/${actor.uid}`));
      const profile = profileSnap.exists ? profileSnap.data() : null;
      if (actor.email !== ADMIN_EMAIL && (!profile || profile.role !== "teacher"
        || (profile.registrationApprovalStatus !== undefined && profile.registrationApprovalStatus !== "APPROVED")
        || profile.disabled === true || profile.isDeleted === true || profile.deletedAt))
        throw new HttpsError("permission-denied", "교사 계정에서 가입 기준을 변경할 수 있습니다.", { reason: "STUDENT_REGISTRATION_POLICY_MANAGER_REQUIRED" });
      const ref = db.doc(POLICY_PATH), snap = await tx.get(ref), stored = snap.exists ? snap.data() : null;
      const current = normalizePolicy(stored, snap.exists);
      const sameValues = current.admissionYear === data.admissionYear && current.admissionGrade === data.admissionGrade;
      // An acknowledgement can be lost. Only this exact actor/version/value
      // combination can replay the immediately preceding successful save.
      if (current.revision === data.expectedRevision + 1 && stored?.updatedBy === actor.uid && sameValues) return current;
      if (current.revision !== data.expectedRevision) throw new HttpsError("aborted",
        "다른 화면에서 가입 기준이 변경되었습니다. 다시 불러와 확인해 주세요.",
        { reason: "STUDENT_REGISTRATION_POLICY_REVISION_CONFLICT", policy: current });
      if (sameValues && snap.exists) return current;
      if (!Number.isSafeInteger(current.revision + 1)) invalid();
      const next = { schemaVersion: 1, admissionYear: data.admissionYear, admissionGrade: data.admissionGrade,
        revision: current.revision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid };
      tx.set(ref, next);
      return normalizePolicy(next);
    });
  },
});
module.exports = { createStudentRegistrationPolicyHandlers };
