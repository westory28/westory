// Missing approval metadata belongs only to accounts created before approval.
// New student profiles are required to carry PENDING by Firestore Rules.
export const isStudentRegistrationPending = (
  profile: { registrationApprovalStatus?: unknown } | null | undefined,
) =>
  !!profile &&
  Object.prototype.hasOwnProperty.call(profile, "registrationApprovalStatus") &&
  profile.registrationApprovalStatus !== "APPROVED";
