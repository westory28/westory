import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import {
  createStudentData,
  getStudentEnrollmentLabel,
  isActiveRosterStudent,
  STUDENT_ENROLLMENT_OPTIONS,
  StudentEnrollmentStatus,
  updateStudentEnrollment,
} from "../../../lib/studentRoster";
import { approveStudentRegistration } from "../../../lib/studentRegistration";

interface RosterStudent {
  id: string;
  grade: string;
  class: string;
  number: number;
  name: string;
  email: string;
  enrollmentStatus: StudentEnrollmentStatus;
  enrollmentReason: string;
}

interface StudentRosterModalProps {
  mode: "create" | "enrollment" | "registration" | null;
  targets: RosterStudent[];
  students: RosterStudent[];
  gradeOptions: Array<{ value: string; label: string }>;
  classOptions: Array<{ value: string; label: string }>;
  defaultGrade: string;
  defaultClass: string;
  onClose: () => void;
  onComplete: (result?: {
    requiresFirstSignIn?: boolean;
    registrationPending?: boolean;
    registrationApproved?: boolean;
  }) => void;
}

const getSaveError = (error: unknown) => {
  const code = String((error as { code?: string })?.code || "");
  const reason = String(
    (error as { details?: { reason?: string } })?.details?.reason || "",
  );
  if (reason === "REGISTRATION_SCHOOL_ACCOUNT_REQUIRED")
    return "학생이 학교 계정으로 처음 로그인한 뒤 등록 승인을 다시 진행해 주세요. 아직 점수 명단에는 표시되지 않습니다.";
  if (reason.startsWith("REGISTRATION_") && error instanceof Error)
    return error.message;
  if (
    /unavailable|deadline-exceeded|internal|network-request-failed/.test(code)
  )
    return "저장 결과를 확인하지 못했습니다. 입력 내용을 유지한 채 다시 시도해 주세요.";
  if (code.includes("already-exists"))
    return "같은 학년·반·번호 또는 이메일로 등록된 학생이 있습니다. 기존 명단을 확인해 주세요.";
  if (code.includes("permission-denied"))
    return "학생 명단 수정 권한이 없습니다. 로그인 권한을 확인해 주세요.";
  if (code.includes("not-found"))
    return "학생 정보를 찾지 못했습니다. 명단을 새로고침한 뒤 다시 시도해 주세요.";
  if (code.includes("invalid-argument"))
    return "학생 이름(20자 이내), 학교 이메일(@yongshin-ms.ms.kr), 학년·반·번호를 확인해 주세요.";
  if (code.includes("failed-precondition"))
    return "입력 정보 또는 계정 상태를 확인해 주세요. 같은 이메일의 기존 계정은 중복 등록할 수 없습니다.";
  return error instanceof Error
    ? error.message
    : "저장하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
};

const StudentRosterModal: React.FC<StudentRosterModalProps> = ({
  mode,
  targets,
  students,
  gradeOptions,
  classOptions,
  defaultGrade,
  defaultClass,
  onClose,
  onComplete,
}) => {
  const { config } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [grade, setGrade] = useState("");
  const [classValue, setClassValue] = useState("");
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<StudentEnrollmentStatus>("transferred");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [rosterConfirmed, setRosterConfirmed] = useState(false);

  useEffect(() => {
    if (!mode) {
      dialogRef.current?.close();
      return;
    }
    setGrade(
      defaultGrade === "all" ? gradeOptions[0]?.value || "" : defaultGrade,
    );
    setClassValue(
      defaultClass === "all" ? classOptions[0]?.value || "" : defaultClass,
    );
    setNumber("");
    setName("");
    setEmail("");
    setStatus(
      targets.length === 1 ? targets[0].enrollmentStatus : "transferred",
    );
    setReason(targets.length === 1 ? targets[0].enrollmentReason : "");
    setError("");
    setRosterConfirmed(false);
    dialogRef.current?.showModal();
  }, [mode]);

  const handleClose = () => {
    if (!saving) onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError("");
    if (mode === "create") {
      const studentNumber = Number(number);
      if (
        !grade ||
        !classValue ||
        !Number.isInteger(studentNumber) ||
        studentNumber <= 0 ||
        !name.trim() ||
        !email.trim()
      ) {
        setError("학년, 반, 번호, 이름, 이메일을 모두 입력해 주세요.");
        return;
      }
      if (
        students.some(
          (student) =>
            (isActiveRosterStudent(student) &&
              student.grade === grade &&
              student.class === classValue &&
              student.number === studentNumber) ||
            student.email.toLowerCase() === email.trim().toLowerCase(),
        )
      ) {
        setError(
          "같은 학년·반·번호 또는 이메일로 등록된 학생이 있습니다. 기존 명단을 확인해 주세요.",
        );
        return;
      }
    } else if (!targets.length) {
      setError("학적을 변경할 학생을 다시 선택해 주세요.");
      return;
    } else if (mode === "registration" && !rosterConfirmed) {
      setError("학급·번호·이름을 확인해 주세요.");
      return;
    } else if (mode === "enrollment" && status === "other" && !reason.trim()) {
      setError("기타 제외 사유를 입력해 주세요.");
      return;
    }

    setSaving(true);
    let savedCount = 0;
    let requiresFirstSignIn = false;
    let registrationPending = false;
    try {
      if (mode === "create") {
        const result = await createStudentData(config, {
          grade,
          class: classValue,
          number: Number(number),
          name: name.trim(),
          email: email.trim().toLowerCase(),
        });
        requiresFirstSignIn = result.requiresFirstSignIn === true;
        registrationPending = result.registrationApprovalStatus !== "APPROVED";
      } else if (mode === "registration") {
        const student = targets[0];
        await approveStudentRegistration(config, {
          uid: student.id,
          grade: student.grade,
          class: student.class,
          number: student.number,
          name: student.name,
          email: student.email,
        });
      } else {
        for (const student of targets) {
          await updateStudentEnrollment(config, {
            uid: student.id,
            status,
            reason: status === "active" ? "" : reason.trim(),
          });
          savedCount += 1;
        }
      }
      onComplete({
        requiresFirstSignIn,
        registrationPending,
        registrationApproved: mode === "registration",
      });
      onClose();
    } catch (saveError) {
      if (savedCount || mode === "registration") onComplete();
      setError(
        `${savedCount ? `${savedCount}명은 반영되었습니다. ` : ""}${getSaveError(saveError)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="student-roster-modal-title"
      onCancel={(event) => {
        event.preventDefault();
        handleClose();
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-lg overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 text-gray-800 shadow-xl backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit}>
        <h3 id="student-roster-modal-title" className="mb-5 text-lg font-bold">
          {mode === "create"
            ? "학생 등록"
            : mode === "registration"
              ? "학생 등록 승인"
              : "학적 상태 변경"}
        </h3>
        <fieldset disabled={saving} className="space-y-4">
          {mode === "create" ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <label className="block text-sm font-bold">
                  학년
                  <select
                    aria-label="학년"
                    value={grade}
                    onChange={(event) => setGrade(event.target.value)}
                    required
                    className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-2 text-base font-normal"
                  >
                    {gradeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-bold">
                  반
                  <select
                    aria-label="반"
                    value={classValue}
                    onChange={(event) => setClassValue(event.target.value)}
                    required
                    className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-2 text-base font-normal"
                  >
                    {classOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-bold">
                  번호
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={number}
                    onChange={(event) => setNumber(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-2 text-base font-normal"
                  />
                </label>
              </div>
              <label className="block text-sm font-bold">
                이름
                <input
                  required
                  maxLength={20}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                  className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base font-normal"
                />
              </label>
              <label className="block text-sm font-bold">
                학교 이메일 (로그인 계정)
                <input
                  type="email"
                  required
                  maxLength={160}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="off"
                  className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base font-normal"
                />
              </label>
            </>
          ) : mode === "registration" ? (
            <>
              <p className="font-bold">
                {targets[0]?.grade}학년 {targets[0]?.class}반{" "}
                {targets[0]?.number}번 {targets[0]?.name}
              </p>
              <p className="break-all text-sm text-gray-600">
                {targets[0]?.email}
              </p>
              <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={rosterConfirmed}
                  onChange={(event) => setRosterConfirmed(event.target.checked)}
                  required
                  className="h-4 w-4"
                />
                학급·번호·이름을 확인했습니다.
              </label>
            </>
          ) : (
            <>
              <p className="text-sm font-bold">
                {targets.length === 1
                  ? targets[0].name
                  : `선택한 학생 ${targets.length}명`}
              </p>
              <label className="block text-sm font-bold">
                학적 상태
                <select
                  aria-label="학적 상태"
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as StudentEnrollmentStatus)
                  }
                  className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base font-normal"
                >
                  {STUDENT_ENROLLMENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {status !== "active" && (
                <label className="block text-sm font-bold">
                  제외 사유 {status === "other" ? "(필수)" : "(선택)"}
                  <input
                    required={status === "other"}
                    maxLength={200}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base font-normal"
                  />
                </label>
              )}
              <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                {status === "active"
                  ? "재학으로 변경하면 수행평가·정기시험 명단에 다시 표시됩니다."
                  : `${getStudentEnrollmentLabel(status)} 학생은 수행평가·정기시험 명단에서 제외됩니다. 기존 점수와 서명은 보존됩니다.`}
              </p>
            </>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="min-h-11 rounded-lg border border-gray-300 px-4 text-sm font-bold text-gray-700 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving
              ? "저장 중…"
              : mode === "create"
                ? "등록"
                : mode === "registration"
                  ? "등록 승인"
                  : "저장"}
          </button>
        </div>
      </form>
    </dialog>
  );
};

export default StudentRosterModal;
