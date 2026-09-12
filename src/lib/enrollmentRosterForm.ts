import type {
  ArchiveEnrollmentState,
  SemesterEnrollmentRecord,
} from "./archiveEnrollment";
import type {
  EnrollmentRosterPayload,
  SemesterClassInput,
} from "./commandGateway";
import type { SemesterManifest } from "./semesterCore";

export const enrollmentName = (row: SemesterEnrollmentRecord) =>
  row.snapshot?.displayName || row.displayName || "이름 미등록";
export const enrollmentClassName = (row: SemesterEnrollmentRecord) =>
  row.snapshot?.classDisplayName ||
  `${row.snapshot?.grade || row.grade || "—"}학년 ${row.snapshot?.classNumber || row.classNumber || "—"}반`;
export const editableEnrollmentSemester = (status: string) =>
  ["DRAFT", "PREPARING", "VALIDATING", "READY", "FAILED", "ACTIVE"].includes(
    status,
  );
export const enrollmentStatusLabel = (status = "") =>
  ({
    ACTIVE: "재학",
    PENDING: "승인 대기",
    TRANSFERRED: "이동 전 기록",
    WITHDRAWN: "학적 종료",
    COMPLETED: "이수",
    CLOSED: "종료",
    ARCHIVED: "보관 완료",
    PREPARING: "준비 중",
    DRAFT: "준비 중",
    VALIDATING: "확인 중",
    READY: "준비 완료",
    FAILED: "확인 필요",
    CLOSING: "마감 중",
  })[status] || "확인 필요";

export const getRosterCandidates = (
  source: ArchiveEnrollmentState,
  target: ArchiveEnrollmentState,
  classId: string,
) => {
  const registered = new Set(
    target.enrollments
      .filter((row) => row.enrollmentStatus === "ACTIVE")
      .map((row) => row.studentUid),
  );
  return source.enrollments.filter(
    (row) =>
      row.classId === classId &&
      ["ACTIVE", "COMPLETED"].includes(row.enrollmentStatus || "") &&
      !registered.has(row.studentUid),
  );
};

export const validateEnrollmentDate = (
  date: string,
  manifest: SemesterManifest,
) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    throw new Error("적용 날짜를 올바르게 입력해 주세요.");
  if (
    (manifest.startDate && date < manifest.startDate) ||
    (manifest.endDate && date > manifest.endDate)
  )
    throw new Error(
      "적용 날짜는 선택한 학기의 시작일과 종료일 사이여야 합니다.",
    );
};

export const buildEnrollmentRosterFormPayload = (input: {
  manifest: SemesterManifest;
  targetState: ArchiveEnrollmentState;
  sourceState: ArchiveEnrollmentState;
  sourceClassId: string;
  selectedUids: string[];
  numbers: Record<string, string>;
  targetClass: SemesterClassInput;
  effectiveFrom: string;
  rosterId: string;
  sourceHash: string;
}): EnrollmentRosterPayload => {
  const { manifest, targetState, targetClass, selectedUids } = input;
  if (
    manifest.semesterId !== targetState.semesterId ||
    targetState.readOnly ||
    !editableEnrollmentSemester(manifest.status)
  )
    throw new Error(
      "선택한 학기는 명부를 등록할 수 없습니다. 학기 상태를 다시 확인해 주세요.",
    );
  if (input.sourceState.semesterId === manifest.semesterId)
    throw new Error("가져올 명부는 다른 학기에서 선택해 주세요.");
  if (!selectedUids.length || selectedUids.length > 120)
    throw new Error("등록할 학생을 1명 이상 120명 이하로 선택해 주세요.");
  if (new Set(selectedUids).size !== selectedUids.length)
    throw new Error("같은 학생을 중복 선택할 수 없습니다.");
  if (
    ![targetClass.grade, targetClass.classNumber].every(
      (value) => /^\d{1,2}$/.test(value) && Number(value) > 0,
    )
  )
    throw new Error("새 학년과 반을 숫자로 입력해 주세요.");
  if (!targetClass.homeroomTeacherUid || !targetClass.displayName.trim())
    throw new Error("학급 이름과 담당 교사를 확인해 주세요.");
  validateEnrollmentDate(input.effectiveFrom, manifest);
  const classKey = `${targetClass.grade}::${targetClass.classNumber}`;
  const existingClass = targetState.classes.find(
    (row) => row.classKey === classKey,
  );
  if (
    existingClass &&
    (existingClass.status !== "ACTIVE" ||
      existingClass.displayName !== targetClass.displayName ||
      existingClass.homeroomTeacherUid !== targetClass.homeroomTeacherUid)
  )
    throw new Error(
      "이미 있는 학급의 이름과 담당 교사는 기존 설정을 사용해 주세요.",
    );
  const candidates = new Map(
    getRosterCandidates(
      input.sourceState,
      targetState,
      input.sourceClassId,
    ).map((row) => [row.studentUid, row]),
  );
  const used = new Set(
    targetState.enrollments
      .filter(
        (row) =>
          row.classId === existingClass?.classId &&
          row.enrollmentStatus === "ACTIVE",
      )
      .map((row) => String(Number(row.studentNumber))),
  );
  const entries = selectedUids.map((studentUid) => {
    const candidate = candidates.get(studentUid);
    if (!candidate)
      throw new Error(
        "이미 등록되었거나 가져올 수 없는 학생이 포함되어 있습니다. 명부를 다시 불러와 주세요.",
      );
    const studentNumber = input.numbers[studentUid]?.trim() || "";
    if (!/^\d{1,3}$/.test(studentNumber) || Number(studentNumber) < 1)
      throw new Error(
        `${enrollmentName(candidate)} 학생의 번호를 확인해 주세요.`,
      );
    const normalized = String(Number(studentNumber));
    if (used.has(normalized))
      throw new Error(
        `${targetClass.displayName} ${normalized}번이 중복됩니다. 학생 번호를 확인해 주세요.`,
      );
    used.add(normalized);
    const displayName = enrollmentName(candidate);
    if (displayName === "이름 미등록")
      throw new Error("이름이 없는 학생은 먼저 원래 명부에서 확인해 주세요.");
    return { studentUid, displayName, classKey, studentNumber: normalized };
  });
  return {
    semesterId: manifest.semesterId,
    expectedSemesterRevision: manifest.revision,
    rosterId: input.rosterId,
    importRevision: 1,
    sourceLabel: "관리자 화면에서 이전 학기 명부 가져오기",
    sourceHash: input.sourceHash,
    effectiveFrom: input.effectiveFrom,
    expectedStudentUids: [...selectedUids],
    classes: [targetClass],
    entries,
    reason: "관리자가 학급과 학생을 확인한 명부 등록",
  };
};
