import { getYearSemester } from "./semesterScope";
import { callStudentDataService } from "./studentProfileCommands";
import { isStudentRegistrationPending } from "./studentRegistrationStatus";
export { isStudentRegistrationPending } from "./studentRegistrationStatus";

export type StudentEnrollmentStatus =
  | "active"
  | "transferred"
  | "outside_quota"
  | "other";

export const STUDENT_ENROLLMENT_OPTIONS: ReadonlyArray<{
  value: StudentEnrollmentStatus;
  label: string;
}> = [
  { value: "active", label: "재학" },
  { value: "transferred", label: "전출" },
  { value: "outside_quota", label: "정원외 학적관리" },
  { value: "other", label: "기타 제외" },
];

export interface StudentEnrollmentProfile {
  enrollmentStatus?: unknown;
  enrollmentReason?: unknown;
  registrationApprovalStatus?: unknown;
}

export const isStudentRosterProfile = (profile: Record<string, unknown>) => {
  const role = String(profile.role || "").trim();
  if (role === "student") return true;
  const hasStudentProfile = [
    "studentName",
    "studentGrade",
    "studentClass",
    "studentNumber",
    "grade",
    "class",
    "number",
  ].some((key) => String(profile[key] ?? "").trim());
  if (!hasStudentProfile) return false;
  return (
    !role ||
    String(profile.email || "")
      .trim()
      .toLowerCase() === "westoria28@gmail.com"
  );
};

export const getStudentEnrollmentStatus = (
  profile: StudentEnrollmentProfile | null | undefined,
): StudentEnrollmentStatus => {
  const status = String(profile?.enrollmentStatus ?? "").trim();
  // Accounts created before enrollment management were all on the active roster.
  if (!status || status === "active") return "active";
  if (status === "transferred" || status === "outside_quota") return status;
  return "other";
};

export const isActiveRosterStudent = (
  profile: StudentEnrollmentProfile | null | undefined,
) =>
  !isStudentRegistrationPending(profile) &&
  getStudentEnrollmentStatus(profile) === "active";

export const getStudentEnrollmentLabel = (status: StudentEnrollmentStatus) =>
  STUDENT_ENROLLMENT_OPTIONS.find((option) => option.value === status)?.label ||
  "기타 제외";

type ConfigLike = Parameters<typeof getYearSemester>[0];

export interface StudentRosterCreateInput {
  grade: string;
  class: string;
  number: number;
  name: string;
  email: string;
}

export const createStudentData = async (
  config: ConfigLike,
  input: StudentRosterCreateInput,
) => {
  return callStudentDataService<
    StudentRosterCreateInput & { year: string; semester: string },
    {
      uid: string;
      requiresFirstSignIn?: boolean;
      registrationApprovalStatus?: string;
    }
  >("createStudentData", { ...input, ...getYearSemester(config) });
};

export const updateStudentEnrollment = async (
  config: ConfigLike,
  input: {
    uid: string;
    status: StudentEnrollmentStatus;
    reason: string;
  },
) => {
  return callStudentDataService<
    typeof input & { year: string; semester: string },
    { uid: string; status: StudentEnrollmentStatus }
  >("updateStudentEnrollment", { ...input, ...getYearSemester(config) });
};
