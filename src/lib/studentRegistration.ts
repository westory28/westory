import { auth } from "./firebase";
import { getYearSemester } from "./semesterScope";
import { callStudentDataService } from "./studentProfileCommands";

type Profile = {
  uid: string;
  grade: string;
  class: string;
  number: string | number;
  name: string;
  email: string;
};
type ApprovalStudent = {
  studentUid: string;
  status: "PENDING" | "APPROVED_PENDING_ACCOUNT";
  profileVersion: string;
  submittedProfile: {
    grade: string;
    class: string;
    number: string;
    name: string;
    email: string;
  };
  enrollmentId: string;
  accountState: "NOT_PREPARED" | "PREPARED";
  accountRevision: number | null;
  blockedReason: string;
};
type ApprovalState = {
  semesterId: string;
  manifestRevision: number;
  economyRevision: number | null;
  economyReady: boolean;
  students: ApprovalStudent[];
  classes: Array<{
    classId: string;
    revision: number;
    grade: string;
    classNumber: string;
  }>;
};
type Envelope = {
  commandId: string;
  commandType: string;
  payload: Record<string, unknown>;
};
type CommandResponse = {
  status: string;
  result?: {
    studentUid: string;
    semesterId?: string;
    enrollmentId: string;
    status: string;
    action: string;
  };
};
const pending = new Map<string, Envelope>();
const flights = new Map<string, Promise<void>>();
const ambiguous = (error: unknown) =>
  /(?:unavailable|deadline-exceeded|internal|network-request-failed)$/.test(
    String((error as { code?: string })?.code || ""),
  );

// Each stage uses the deployed approval command and its receipt. A created user
// is not an approved enrollment; neither query omissions nor timeouts mean success.
export const approveStudentRegistration = (
  config: Parameters<typeof getYearSemester>[0],
  profile: Profile,
): Promise<void> => {
  const ownerUid = auth.currentUser?.uid || "";
  const { year, semester } = getYearSemester(config);
  const semesterId = `${year}-${semester}`;
  const key = JSON.stringify([ownerUid, semesterId, profile.uid]);
  const existing = flights.get(key);
  if (existing) return existing;
  const flight = (async () => {
    for (let stage = 0; stage < 4; stage += 1) {
      let envelope = pending.get(key);
      if (!envelope) {
        const state = await callStudentDataService<
          { semesterId: string; studentUid: string },
          ApprovalState
        >(
          "getStudentRegistrationApprovalState",
          { semesterId, studentUid: profile.uid },
          ownerUid,
        );
        if (state.semesterId !== semesterId)
          throw new Error(
            "현재 학기가 바뀌었습니다. 명단을 새로고침해 주세요.",
          );
        const student = state.students.find(
          (item) => item.studentUid === profile.uid,
        );
        if (!student)
          throw new Error(
            "등록 대기 상태를 확인하지 못했습니다. 명단을 새로고침해 주세요.",
          );
        if (student.blockedReason) throw new Error(student.blockedReason);
        const payload: Record<string, unknown> = {
          semesterId,
          expectedSemesterRevision: state.manifestRevision,
          studentUid: profile.uid,
          expectedProfileVersion: student.profileVersion,
        };
        if (student.status === "PENDING") {
          const submitted = student.submittedProfile;
          if (
            submitted.grade !== profile.grade ||
            submitted.class !== profile.class ||
            String(submitted.number) !== String(profile.number) ||
            submitted.name !== profile.name ||
            submitted.email.toLowerCase() !== profile.email.toLowerCase()
          ) {
            throw new Error(
              "학생 등록 정보가 바뀌었습니다. 명단을 새로고침한 뒤 다시 확인해 주세요.",
            );
          }
          const targets = state.classes.filter(
            (item) =>
              item.grade === profile.grade &&
              item.classNumber === profile.class,
          );
          if (targets.length !== 1)
            throw new Error(
              "현재 학기의 대상 학급을 찾지 못했습니다. 학년과 반을 확인해 주세요.",
            );
          Object.assign(payload, {
            action: "APPROVE",
            classId: targets[0].classId,
            expectedClassRevision: targets[0].revision,
            studentNumber: String(profile.number),
            displayName: profile.name,
            rosterConfirmed: true,
          });
        } else if (student.status === "APPROVED_PENDING_ACCOUNT") {
          if (!state.economyReady)
            throw new Error(
              "학적 승인은 반영되었습니다. 현재 학기의 Wis 운영 준비 후 등록 승인을 이어서 진행해 주세요.",
            );
          Object.assign(payload, {
            expectedEnrollmentId: student.enrollmentId,
            ...(student.accountState === "PREPARED"
              ? {
                  action: "FINALIZE",
                  expectedAccountRevision: student.accountRevision,
                }
              : {
                  action: "PREPARE_ACCOUNT",
                  expectedEconomyRevision: state.economyRevision,
                }),
          });
        } else
          throw new Error(
            "등록 상태를 확인하지 못했습니다. 명단을 새로고침해 주세요.",
          );
        envelope = {
          commandId: crypto.randomUUID(),
          commandType: "approveStudentRegistration",
          payload,
        };
        pending.set(key, envelope);
      }
      try {
        let response: CommandResponse;
        try {
          response = await callStudentDataService<Envelope, CommandResponse>(
            "executeCommand",
            envelope,
            ownerUid,
          );
        } catch (error) {
          if (!ambiguous(error)) throw error;
          const receipt = await callStudentDataService<
            { commandId: string; commandType: string },
            CommandResponse
          >(
            "getCommandStatus",
            {
              commandId: envelope.commandId,
              commandType: envelope.commandType,
            },
            ownerUid,
          ).catch(() => null);
          if (receipt?.status !== "SUCCEEDED") throw error;
          response = receipt;
        }
        const result = response.result;
        if (response.status !== "SUCCEEDED")
          throw Object.assign(
            new Error(
              "저장 결과를 확인하지 못했습니다. 등록 승인을 다시 눌러 주세요.",
            ),
            { code: "functions/unavailable" },
          );
        if (
          !result ||
          result.studentUid !== profile.uid ||
          result.action !== envelope.payload.action ||
          (result.semesterId !== undefined &&
            result.semesterId !== semesterId) ||
          (envelope.payload.expectedEnrollmentId !== undefined &&
            result.enrollmentId !== envelope.payload.expectedEnrollmentId) ||
          !result.enrollmentId
        )
          throw new Error(
            "승인한 학생과 학적을 확인하지 못했습니다. 명단을 새로고침해 주세요.",
          );
        pending.delete(key);
        if (result.action === "FINALIZE" && result.status === "APPROVED")
          return;
        if (result.status !== "APPROVED_PENDING_ACCOUNT")
          throw new Error(
            "등록 완료 상태를 확인하지 못했습니다. 명단을 새로고침해 주세요.",
          );
      } catch (error) {
        if (!ambiguous(error)) pending.delete(key);
        throw error;
      }
    }
    throw new Error(
      "등록 처리가 진행 중입니다. 명단을 새로고침한 뒤 승인을 이어서 진행해 주세요.",
    );
  })().finally(() => flights.delete(key));
  flights.set(key, flight);
  return flight;
};
