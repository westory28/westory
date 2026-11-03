import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { getSemesterDocPath, getYearSemester } from "./semesterScope";
import { callStudentDataService } from "./studentProfileCommands";
import { isStudentRegistrationPending } from "./studentRegistrationStatus";
export { isStudentRegistrationPending } from "./studentRegistrationStatus";

export type StudentEnrollmentStatus =
  | "active"
  | "transferred"
  | "outside_quota"
  | "other";

export type EnrollmentMovementTiming = "before" | "during";

export const needsEnrollmentMovementTiming = (
  status: StudentEnrollmentStatus,
) => status === "transferred" || status === "outside_quota";

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
  enrollmentYear?: unknown;
  enrollmentSemester?: unknown;
  enrollmentMovementTiming?: unknown;
  enrollmentMovementDate?: unknown;
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

export const getStudentEnrollmentMovementTiming = (
  profile: StudentEnrollmentProfile | null | undefined,
  year: string,
  semester: string,
): EnrollmentMovementTiming | null => {
  if (
    !profile ||
    !needsEnrollmentMovementTiming(getStudentEnrollmentStatus(profile)) ||
    String(profile.enrollmentYear) !== year ||
    String(profile.enrollmentSemester) !== semester
  )
    return null;
  const timing = profile.enrollmentMovementTiming;
  return timing === "before" || timing === "during" ? timing : null;
};

export const getPerformanceEnrollmentLabel = (
  profile: StudentEnrollmentProfile | null | undefined,
  { year, semester }: { year: string; semester: string },
): "전출" | "정원외" | "" => {
  if (
    isStudentRegistrationPending(profile) ||
    getStudentEnrollmentMovementTiming(profile, year, semester) !== "during"
  )
    return "";
  return getStudentEnrollmentStatus(profile) === "transferred"
    ? "전출"
    : "정원외";
};

export const getStudentEnrollmentLabel = (status: StudentEnrollmentStatus) =>
  STUDENT_ENROLLMENT_OPTIONS.find((option) => option.value === status)?.label ||
  "기타 제외";

type ConfigLike = Parameters<typeof getYearSemester>[0];

export const loadEnrollmentMovementStartDate = async (config: ConfigLike) => {
  const { year } = getYearSemester(config);
  const override = await getDoc(
    doc(
      db,
      getSemesterDocPath(config, "assessment_config", "enrollment_movement"),
    ),
  );
  // Only this assessment override is readable by regular teachers. The save
  // transaction resolves the protected semester manifest when it is absent.
  const startDate = override.exists() ? override.data().startDate : null;
  if (startDate == null) return null;
  if (
    typeof startDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !startDate.startsWith(year + "-") ||
    new Date(startDate + "T00:00:00Z").toJSON()?.slice(0, 10) !== startDate
  )
    throw new Error("학기 시작일 설정을 확인해 주세요.");
  return startDate;
};

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
    movementTiming?: EnrollmentMovementTiming;
    movementDate?: string;
  },
) => {
  return callStudentDataService<
    typeof input & { year: string; semester: string },
    { uid: string; status: StudentEnrollmentStatus }
  >("updateStudentEnrollment", { ...input, ...getYearSemester(config) });
};
