import { getHttpsCallable } from "./firebase";
import { executeWestoryCommand } from "./commandGateway";

export interface RegistrationSubmittedProfile {
  name: string;
  grade: string;
  class: string;
  number: string;
  email: string;
}
export interface RegistrationApprovalStudent {
  studentUid: string;
  status: "PENDING" | "APPROVED_PENDING_ACCOUNT";
  profileVersion: string;
  submittedProfile: RegistrationSubmittedProfile;
  enrollmentId: string;
  accountState: "NOT_PREPARED" | "PREPARED";
  accountRevision: number | null;
  blockedReason: string;
}
export interface RegistrationApprovalClass {
  classId: string;
  revision: number;
  grade: string;
  classNumber: string;
  displayName: string;
}
export interface RegistrationApprovalState {
  semesterId: string;
  manifestRevision: number;
  economyRevision: number | null;
  economyReady: boolean;
  students: RegistrationApprovalStudent[];
  classes: RegistrationApprovalClass[];
  nextCursor: string | null;
}
interface ApprovalCommon {
  semesterId: string;
  expectedSemesterRevision: number;
  studentUid: string;
  expectedProfileVersion: string;
}
export type StudentRegistrationApprovalInput = ApprovalCommon &
  (
    | {
        action: "APPROVE";
        classId: string;
        expectedClassRevision: number;
        studentNumber: string;
        displayName: string;
        rosterConfirmed: true;
      }
    | {
        action: "PREPARE_ACCOUNT";
        expectedEnrollmentId: string;
        expectedEconomyRevision: number;
      }
    | {
        action: "FINALIZE";
        expectedEnrollmentId: string;
        expectedAccountRevision: number;
      }
  );
export const getStudentRegistrationApprovalState = async (input: {
  semesterId: string;
  cursor?: string;
  studentUid?: string;
}): Promise<RegistrationApprovalState> => {
  const callable = await getHttpsCallable<
    typeof input,
    RegistrationApprovalState
  >("getStudentRegistrationApprovalState");
  return (await callable(input)).data;
};
export const approveStudentRegistration = (
  input: StudentRegistrationApprovalInput,
  options: { expectedUid: string; commandId: string },
) => executeWestoryCommand("approveStudentRegistration", input, options);
