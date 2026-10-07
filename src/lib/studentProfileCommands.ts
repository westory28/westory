import { auth, getHttpsCallable } from "./firebase";
import { getYearSemester } from "./semesterScope";

const SESSION_GENERATION = "w1r2-2026-08-09";
const COMMAND_TYPE = "updateStudentEnrollmentProfile";
type ConfigLike = Parameters<typeof getYearSemester>[0];
type SessionProof = {
  authorityGeneration: string;
  protocolVersion: number;
  revision: string;
};
type Session = SessionProof & { status: string; authTime: number };
export type StudentProfileOperation =
  | "EDIT_PROFILE"
  | "MOVE_CLASS"
  | "PROMOTE_GRADE";
export interface StudentProfileInput {
  uid: string;
  grade: string;
  class: string;
  number: string | number;
  name: string;
  email: string;
  operation?: StudentProfileOperation;
}
type ProfileState = {
  semesterId: string;
  students: Array<{
    studentUid: string;
    source: "CANONICAL" | "LEGACY" | "BLOCKED";
    expectedVersion: string | null;
    profile: {
      grade: string;
      class: string;
      number: string;
      name: string;
      email: string;
    } | null;
    error?: string;
  }>;
  classes: Array<{
    classId: string;
    grade: string;
    classNumber: string;
    revision: number;
  }>;
};
type ProfileResult = { studentUid: string; semesterId: string };
type CommandResponse = { status: string; result: ProfileResult };
type Envelope = {
  commandId: string;
  commandType: string;
  payload: Record<string, unknown>;
};
const pending = new Map<string, Envelope>();
const flights = new Map<string, Promise<boolean>>();
const ambiguous = (error: unknown) =>
  /(?:unavailable|deadline-exceeded|internal|network-request-failed)$/.test(
    String((error as { code?: string })?.code || ""),
  );
const assertOwner = (uid: string) => {
  if (!uid || auth.currentUser?.uid !== uid)
    throw new Error("로그인 사용자가 바뀌었습니다. 다시 로그인해 주세요.");
};

// The deployed roster services require the same owner-bound session proof as
// the existing lesson/patch-note command clients. Never bypass their fences.
export const callStudentDataService = async <Request extends object, Response>(
  name: string,
  input: Request,
  ownerUid = auth.currentUser?.uid || "",
): Promise<Response> => {
  assertOwner(ownerUid);
  const user = auth.currentUser!;
  const token = await user.getIdTokenResult();
  assertOwner(ownerUid);
  const open = await getHttpsCallable<
    { authorityGeneration: string; protocolVersion: number },
    Session
  >("openApplicationSession");
  const { data: session } = await open({
    authorityGeneration: SESSION_GENERATION,
    protocolVersion: 2,
  });
  assertOwner(ownerUid);
  if (
    session.status !== "active" ||
    session.authTime !== Number(token.claims.auth_time) ||
    session.authorityGeneration !== SESSION_GENERATION ||
    !Number.isInteger(session.protocolVersion) ||
    session.protocolVersion < 2 ||
    !/^[a-f0-9]{64}$/.test(session.revision)
  ) {
    throw new Error("로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.");
  }
  const callable = await getHttpsCallable<
    Request & { _session: SessionProof },
    Response
  >(name);
  const currentToken = await user.getIdTokenResult();
  assertOwner(ownerUid);
  if (currentToken.claims.auth_time !== token.claims.auth_time)
    throw new Error("로그인 상태가 바뀌었습니다. 다시 저장해 주세요.");
  const result = await callable({
    ...input,
    _session: {
      authorityGeneration: session.authorityGeneration,
      protocolVersion: session.protocolVersion,
      revision: session.revision,
    },
  });
  assertOwner(ownerUid);
  return result.data;
};

// Returns false only for a positively identified legacy student. Query errors,
// closed enrollments and conflicts must never fall back to the legacy writer.
export const updateCanonicalStudentProfile = (
  config: ConfigLike,
  input: StudentProfileInput,
): Promise<boolean> => {
  const ownerUid = auth.currentUser?.uid || "";
  const { year, semester } = getYearSemester(config);
  const semesterId = `${year}-${semester}`;
  const snapshot = {
    ...input,
    grade: String(input.grade).trim(),
    class: String(input.class).trim(),
    number: String(input.number).trim(),
    name: input.name.trim(),
    email: input.email.trim(),
    operation: input.operation || "EDIT_PROFILE",
  };
  const key = JSON.stringify([ownerUid, semesterId, snapshot]);
  const existing = flights.get(key);
  if (existing) return existing;
  const flight = (async () => {
    assertOwner(ownerUid);
    let envelope = pending.get(key);
    if (!envelope) {
      const state = await callStudentDataService<
        { semesterId: string; studentUids: string[] },
        ProfileState
      >(
        "getStudentEnrollmentProfileState",
        { semesterId, studentUids: [input.uid] },
        ownerUid,
      );
      if (state.semesterId !== semesterId)
        throw new Error("현재 학기가 바뀌었습니다. 명단을 새로고침해 주세요.");
      const student = state.students.find(
        (item) => item.studentUid === input.uid,
      );
      if (student?.source === "LEGACY") return false;
      if (
        student?.source !== "CANONICAL" ||
        !student.expectedVersion ||
        !student.profile
      ) {
        throw new Error(
          student?.error ||
            "현재 학적 정보를 확인할 수 없습니다. 명단을 새로고침해 주세요.",
        );
      }
      if (snapshot.email !== student.profile.email)
        throw new Error("로그인 이메일은 학생 정보에서 변경할 수 없습니다.");
      const targets = state.classes.filter(
        (item) =>
          item.grade === snapshot.grade && item.classNumber === snapshot.class,
      );
      if (targets.length !== 1)
        throw new Error(
          "현재 학기의 대상 학급을 찾지 못했습니다. 학년과 반을 확인해 주세요.",
        );
      const target = targets[0];
      envelope = {
        commandId: crypto.randomUUID(),
        commandType: COMMAND_TYPE,
        payload: {
          semesterId,
          studentUid: input.uid,
          expectedVersion: student.expectedVersion,
          operation: snapshot.operation,
          targetClassId: target.classId,
          expectedTargetClassRevision: target.revision,
          studentNumber: snapshot.number,
          displayName: snapshot.name,
          email: snapshot.email,
          reason:
            snapshot.operation === "MOVE_CLASS"
              ? "학생 명단 관리에서 반 이동"
              : snapshot.operation === "PROMOTE_GRADE"
                ? "학생 명단 관리에서 진급"
                : "학생 명단 관리에서 학생 정보 수정",
        },
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
        const status = await callStudentDataService<
          { commandId: string; commandType: string },
          CommandResponse
        >(
          "getCommandStatus",
          { commandId: envelope.commandId, commandType: envelope.commandType },
          ownerUid,
        ).catch(() => null);
        if (status?.status !== "SUCCEEDED") throw error;
        response = status;
      }
      if (response.status !== "SUCCEEDED")
        throw Object.assign(
          new Error(
            "저장 결과를 확인하지 못했습니다. 입력 내용을 유지한 채 다시 저장해 주세요.",
          ),
          { code: "functions/unavailable" },
        );
      if (
        response.result?.studentUid !== input.uid ||
        response.result?.semesterId !== semesterId
      )
        throw new Error(
          "저장한 학생과 학기를 확인하지 못했습니다. 명단을 새로고침해 주세요.",
        );
      pending.delete(key);
      return true;
    } catch (error) {
      if (!ambiguous(error)) pending.delete(key);
      throw error;
    }
  })().finally(() => flights.delete(key));
  flights.set(key, flight);
  return flight;
};
