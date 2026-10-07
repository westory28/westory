const { HttpsError } = require("firebase-functions/v2/https");

// Missing approval metadata belongs to an existing account. New self-created
// student profiles must carry PENDING under Firestore Rules.
const assertStudentRegistrationAccess = (profile, profileExists) => {
  const status = profile?.registrationApprovalStatus;
  if (!profileExists || !["student", "teacher", "staff"].includes(profile?.role)
    || (status !== undefined && status !== "APPROVED")) {
    throw new HttpsError(
      "permission-denied",
      "Teacher registration approval is required.",
      { reason: "STUDENT_REGISTRATION_APPROVAL_REQUIRED" },
    );
  }
};

module.exports = { assertStudentRegistrationAccess };
