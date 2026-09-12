import { auth, getHttpsCallable } from "./firebase";
import { getYearSemester } from "./semesterScope";
import {
  executeWestoryCommand,
  hasPendingWestoryCommand,
  WestoryCommandError,
  type W2CommandPayloads,
} from "./commandGateway";

type ConfigLike = Parameters<typeof getYearSemester>[0];

export interface StudentProfileEditState {
  studentUid: string;
  semesterId: string;
  ownerUid: string;
  source: "CANONICAL" | "LEGACY" | "BLOCKED";
  expectedVersion: string | null;
  error?: string;
  profile: {
    grade: string;
    class: string;
    number: string;
    name: string;
    email: string;
  } | null;
  classes: Array<{
    classId: string;
    grade: string;
    classNumber: string;
    revision: number;
  }>;
}
type ProfilePayload = W2CommandPayloads["updateStudentEnrollmentProfile"];
const pendingProfiles = new Map<string, ProfilePayload>();
const profileFlights = new Map<string, Promise<StudentDataUpdateResult>>();
const assertOwner = (ownerUid: string) => {
  if (!ownerUid || auth.currentUser?.uid !== ownerUid)
    throw new Error("로그인 사용자가 바뀌었습니다. 명단을 다시 열어 주세요.");
};
export const loadStudentProfileEditStates = async (
  config: ConfigLike,
  studentUids: string[],
) => {
  const ownerUid = auth.currentUser?.uid || "",
    { year, semester } = getYearSemester(config);
  assertOwner(ownerUid);
  const semesterId = `${year}-${semester}`,
    states = new Map<string, StudentProfileEditState>();
  const callable = await getHttpsCallable<
    { semesterId: string; studentUids: string[] },
    {
      semesterId: string;
      students: Array<
        Omit<StudentProfileEditState, "semesterId" | "ownerUid" | "classes">
      >;
      classes: StudentProfileEditState["classes"];
    }
  >("getStudentEnrollmentProfileState");
  const uniqueUids = [...new Set(studentUids)];
  // At most four bounded requests at once, instead of waiting for every batch.
  for (let offset = 0; offset < uniqueUids.length; offset += 400) {
    const batches = Array.from(
      { length: Math.ceil(Math.min(400, uniqueUids.length - offset) / 100) },
      (_, index) =>
        uniqueUids.slice(offset + index * 100, offset + (index + 1) * 100),
    );
    const responses = await Promise.all(
      batches.map((batch) => callable({ semesterId, studentUids: batch })),
    );
    assertOwner(ownerUid);
    for (const { data } of responses) {
      if (data.semesterId !== semesterId)
        throw new Error("조회 학기가 바뀌었습니다. 명단을 다시 열어 주세요.");
      for (const value of data.students)
        states.set(value.studentUid, {
          ...value,
          semesterId,
          ownerUid,
          classes: data.classes,
        });
    }
  }
  return states;
};
const mutationKey = (ownerUid: string, semesterId: string, uid: string) =>
  `${ownerUid}:${semesterId}:${uid}`;
export const hasPendingStudentProfileUpdate = (
  state?: StudentProfileEditState,
) =>
  Boolean(
    state &&
    pendingProfiles.has(
      mutationKey(state.ownerUid, state.semesterId, state.studentUid),
    ),
  );
export const getPendingStudentProfileDraft = (
  state?: StudentProfileEditState,
) => {
  if (!state || auth.currentUser?.uid !== state.ownerUid) return null;
  const payload = pendingProfiles.get(
    mutationKey(state.ownerUid, state.semesterId, state.studentUid),
  );
  if (!payload || payload.operation !== "EDIT_PROFILE") return null;
  const target = state.classes.find(
    (item) => item.classId === payload.targetClassId,
  );
  return {
    ...(target ? { grade: target.grade, class: target.classNumber } : {}),
    number: Number(payload.studentNumber) || 0,
    name: payload.displayName,
    email: payload.email,
  };
};
export const studentProfileUpdateError = (error: unknown) =>
  error instanceof WestoryCommandError && error.retryable
    ? "저장 결과를 확인하지 못했습니다. 입력을 유지한 채 ‘이전 요청 결과 확인’을 눌러 주세요."
    : error instanceof Error
      ? error.message
      : "학생 정보를 저장하지 못했습니다. 입력 내용을 확인해 주세요.";
const sendPendingProfile = (
  state: StudentProfileEditState,
): Promise<StudentDataUpdateResult> => {
  assertOwner(state.ownerUid);
  const key = mutationKey(state.ownerUid, state.semesterId, state.studentUid);
  const flight = profileFlights.get(key);
  if (flight) return flight;
  const payload = pendingProfiles.get(key);
  if (!payload)
    return Promise.reject(new Error("확인할 이전 요청이 없습니다."));
  const next = executeWestoryCommand(
    "updateStudentEnrollmentProfile",
    payload,
    { expectedUid: state.ownerUid },
  )
    .then(({ result }) => {
      assertOwner(state.ownerUid);
      pendingProfiles.delete(key);
      const [year, semester] = result.semesterId.split("-");
      return {
        uid: result.studentUid,
        year,
        semester,
        updatedRelatedDocCount: 0,
        updatedRosterCount: 0,
        updatedRosterRowCount: 0,
      };
    })
    .catch(async (error: unknown) => {
      if (
        !(error instanceof WestoryCommandError && error.retryable) &&
        !(await hasPendingWestoryCommand(
          "updateStudentEnrollmentProfile",
          payload,
          { expectedUid: state.ownerUid },
        ).catch(() => true))
      )
        pendingProfiles.delete(key);
      throw error;
    })
    .finally(() => profileFlights.delete(key));
  profileFlights.set(key, next);
  return next;
};
export const retryStudentProfileUpdate = (state: StudentProfileEditState) =>
  sendPendingProfile(state);

export interface StudentDataDeleteResult {
  uid: string;
  year: string;
  semester: string;
  userDocumentDeleted?: boolean;
  userProfileCleared?: boolean;
  authUserDeleted?: boolean;
  authUserDeleteError?: string;
  deletedRelatedDocCount: number;
  updatedRosterCount: number;
  removedRosterRowCount: number;
}

export interface StudentDataUpdateInput {
  uid: string;
  grade: string;
  class: string;
  number: string | number;
  name: string;
  email: string;
  editState?: StudentProfileEditState;
  operation?: ProfilePayload["operation"];
}

export interface StudentDataUpdateResult {
  uid: string;
  year: string;
  semester: string;
  updatedRelatedDocCount: number;
  updatedRosterCount: number;
  updatedRosterRowCount: number;
}

export const deleteStudentData = async (
  config: ConfigLike,
  uid: string,
): Promise<StudentDataDeleteResult> => {
  const { year, semester } = getYearSemester(config);
  const callable = await getHttpsCallable<
    { uid: string; year: string; semester: string },
    StudentDataDeleteResult
  >("deleteStudentData");
  const result = await callable({
    uid,
    year,
    semester,
  });
  return result.data;
};

export const updateStudentData = async (
  config: ConfigLike,
  input: StudentDataUpdateInput,
): Promise<StudentDataUpdateResult> => {
  const { year, semester } = getYearSemester(config);
  const state = input.editState;
  if (state) {
    assertOwner(state.ownerUid);
    if (
      state.studentUid !== input.uid ||
      state.semesterId !== `${year}-${semester}`
    )
      throw new Error(
        "학생 또는 학기가 바뀌었습니다. 명단을 다시 열어 주세요.",
      );
    if (state.source === "BLOCKED")
      throw new Error(state.error || "현재 학적 정보를 확인해 주세요.");
    if (state.source === "CANONICAL") {
      if (!state.expectedVersion)
        throw new Error("수정 기준이 없습니다. 명단을 새로고침해 주세요.");
      const key = mutationKey(
        state.ownerUid,
        state.semesterId,
        state.studentUid,
      );
      if (pendingProfiles.has(key))
        throw new Error("이전 요청 결과를 먼저 확인해 주세요.");
      const candidates = state.classes.filter(
        (item) =>
          item.grade === String(input.grade).trim() &&
          item.classNumber === String(input.class).trim(),
      );
      if (candidates.length !== 1)
        throw new Error("현재 학기에 등록된 학급을 선택해 주세요.");
      const target = candidates[0];
      pendingProfiles.set(key, {
        semesterId: state.semesterId,
        studentUid: input.uid,
        expectedVersion: state.expectedVersion,
        operation: input.operation || "EDIT_PROFILE",
        targetClassId: target.classId,
        expectedTargetClassRevision: target.revision,
        studentNumber: String(input.number).trim(),
        displayName: input.name.trim(),
        email: input.email.trim(),
        reason: "교사 학생 정보 수정",
      });
      return sendPendingProfile(state);
    }
  }
  const callable = await getHttpsCallable<
    StudentDataUpdateInput & { year: string; semester: string },
    StudentDataUpdateResult
  >("updateStudentData");
  const result = await callable({
    uid: input.uid,
    grade: input.grade,
    class: input.class,
    number: input.number,
    name: input.name,
    email: input.email,
    year,
    semester,
  });
  return result.data;
};
