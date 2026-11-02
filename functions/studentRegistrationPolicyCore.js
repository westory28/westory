const { HttpsError } = require("firebase-functions/v2/https");

// Account issue year/grade is independent of the teaching semester. Existing
// approved students retain access when the next intake policy changes.
const POLICY_PATH = "site_settings/student_registration_policy";
const DEFAULT_POLICY = Object.freeze({ schemaVersion: 1, admissionYear: "2026", admissionGrade: "3", revision: 0 });
const validFields = value => typeof value?.admissionYear === "string" && /^20[0-9]{2}$/.test(value.admissionYear)
  && typeof value?.admissionGrade === "string" && /^[1-3]$/.test(value.admissionGrade);
const publicPolicy = value => ({ schemaVersion: 1, admissionYear: value.admissionYear,
  admissionGrade: value.admissionGrade, revision: value.revision,
  emailPatternLabel: `${value.admissionYear.slice(-2)}${value.admissionGrade}NNNN@yongshin-ms.ms.kr` });
const normalizePolicy = (value, exists = true) => {
  if (!exists) return publicPolicy(DEFAULT_POLICY);
  if (!value || value.schemaVersion !== 1 || !validFields(value)
    || !Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new HttpsError("failed-precondition", "학생 가입 기준을 확인하지 못했습니다. 관리자에게 확인을 요청해 주세요.",
      { reason: "STUDENT_REGISTRATION_POLICY_INVALID" });
  }
  return publicPolicy(value);
};
const matchesPolicy = (email, policy) => typeof email === "string"
  && new RegExp(`^${policy.admissionYear.slice(-2)}${policy.admissionGrade}[0-9]{4}@yongshin-ms\\.ms\\.kr$`, "i").test(email);
const isEstablishedProfile = profile => profile && ["student", "teacher", "staff"].includes(profile.role)
  && (profile.registrationApprovalStatus === undefined || profile.registrationApprovalStatus === "APPROVED");
const assertRegistrationEmail = (email, policy) => {
  if (!matchesPolicy(email, policy)) throw new HttpsError("permission-denied",
    `신규 가입은 ${policy.emailPatternLabel} 형식의 학교 계정만 가능합니다.`,
    { reason: "STUDENT_REGISTRATION_EMAIL_NOT_ALLOWED", policy });
};

module.exports = { POLICY_PATH, DEFAULT_POLICY, validFields, publicPolicy, normalizePolicy,
  matchesPolicy, isEstablishedProfile, assertRegistrationEmail };
