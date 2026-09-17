export type TeacherSemesterScope = { year: string; semester: string };
export type TeacherSemesterOption = TeacherSemesterScope & { label: string };

export const validTeacherSemester = (
  value: unknown,
): value is TeacherSemesterScope => {
  if (!value || typeof value !== "object") return false;
  const item = value as TeacherSemesterScope;
  return /^\d{4}$/.test(item.year) && ["1", "2"].includes(item.semester);
};

export const sameSemester = (
  left: TeacherSemesterScope | null | undefined,
  right: TeacherSemesterScope | null | undefined,
) =>
  Boolean(
    left &&
    right &&
    left.year === right.year &&
    left.semester === right.semester,
  );

export const teacherSemesterStorageKey = (uid: string) =>
  `westory:teacher-semester:${uid}`;

export const readTeacherSemester = (
  uid: string,
): TeacherSemesterScope | null => {
  try {
    const scope: unknown = JSON.parse(
      sessionStorage.getItem(teacherSemesterStorageKey(uid)) || "null",
    );
    return validTeacherSemester(scope) ? scope : null;
  } catch {
    return null;
  }
};

export const storeTeacherSemester = (
  uid: string,
  scope: TeacherSemesterScope | null,
) => {
  try {
    if (scope)
      sessionStorage.setItem(
        teacherSemesterStorageKey(uid),
        JSON.stringify(scope),
      );
    else sessionStorage.removeItem(teacherSemesterStorageKey(uid));
  } catch {
    // The selection still works in memory when browser storage is unavailable.
  }
};

let writeScope: { uid: string; readOnly: boolean } | null = null;
export const setTeacherSemesterWriteScope = (scope: typeof writeScope) => {
  writeScope = scope;
};
export const isTeacherSemesterReadOnly = (uid?: string) =>
  Boolean(
    writeScope?.readOnly &&
    (!uid || writeScope.uid === uid) &&
    typeof window !== "undefined" &&
    /^#\/teacher(?:\/|\?|$)/.test(window.location.hash),
  );

export const assertTeacherSemesterWritable = (uid?: string) => {
  if (isTeacherSemesterReadOnly(uid)) {
    throw new Error(
      "이전 학기 자료는 조회만 할 수 있습니다. 수정하려면 현재 운영 학기로 돌아가 주세요.",
    );
  }
};

// Explicit read/session allowlist: unknown callables remain blocked in view mode.
const VIEW_CALLABLES = new Set([
  "getTeacherSemesterOptions",
  "getAdminSemesterContent",
  "getAdminSemesterLegacyRecords",
  "getArchiveEnrollmentState",
  "getAssessmentState",
  "getCommandStatus",
  "getGradeEvidenceState",
  "getSemesterCoreState",
  "getSemesterCutoverState",
  "getStudentEnrollmentProfileState",
  "getStudentRegistrationApprovalState",
  "getTeacherOperationsState",
  "getW8DomainState",
  "getWisEconomyState",
  "listStudentHistoryDictionaryWordsForTeacher",
  "previewEnrollmentRoster",
  "openApplicationSession",
  "touchApplicationSession",
  "closeApplicationSession",
  "beginApplicationSessionReauthentication",
]);
export const assertTeacherSemesterCallable = (name: string, uid: string) => {
  if (!VIEW_CALLABLES.has(name)) assertTeacherSemesterWritable(uid);
};
