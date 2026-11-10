import { LoadingOverlay } from "../../../components/common/LoadingState";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { useAppToast } from "../../../components/common/AppToastProvider";
import {
  getStudentRegistrationPolicy,
  saveStudentRegistrationPolicy,
  type StudentRegistrationPolicy,
} from "../../../lib/studentRegistrationPolicy";

const policyError = (error: unknown, saving: boolean) => {
  const {
    code = "",
    details,
    message,
  } = error as {
    code?: string;
    message?: string;
    details?: { reason?: string };
  };
  if (
    code.endsWith("aborted") ||
    details?.reason === "STUDENT_REGISTRATION_POLICY_REVISION_CONFLICT"
  )
    return "가입 기준이 다른 곳에서 변경되었습니다. 저장된 기준을 다시 불러온 뒤 수정해 주세요.";
  if (
    /unavailable|deadline-exceeded|internal|network-request-failed/.test(code)
  )
    return saving
      ? "저장 결과를 확인하지 못했습니다. 같은 값으로 다시 저장하거나 저장된 기준을 불러와 주세요."
      : "가입 기준을 불러오지 못했습니다. 연결을 확인한 뒤 다시 불러와 주세요.";
  if (/permission-denied|unauthenticated/.test(code))
    return "가입 기준을 관리할 권한이나 로그인 상태를 확인해 주세요.";
  return message || "가입 기준을 처리하지 못했습니다. 다시 시도해 주세요.";
};

export default function StudentRegistrationPolicyModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { currentUser } = useAuth();
  const { showToast } = useAppToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const savingRef = useRef(false);
  const [policy, setPolicy] = useState<StudentRegistrationPolicy | null>(null);
  const [year, setYear] = useState("");
  const [grade, setGrade] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setVerified(false);
    setError("");
    try {
      const result = await getStudentRegistrationPolicy();
      if (generation.current !== request) return;
      setPolicy(result);
      setYear(result.admissionYear);
      setGrade(result.admissionGrade);
      setVerified(true);
    } catch (loadError) {
      if (generation.current === request)
        setError(policyError(loadError, false));
    } finally {
      if (generation.current === request) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      dialogRef.current?.close();
      return;
    }
    setPolicy(null);
    setYear("");
    setGrade("");
    setSaving(false);
    savingRef.current = false;
    dialogRef.current?.showModal();
    void load();
    return () => {
      generation.current += 1;
    };
  }, [open, currentUser?.uid, load]);

  const close = () => {
    if (!savingRef.current) onClose();
  };
  const valid = /^20\d{2}$/.test(year) && /^[123]$/.test(grade);
  const changed =
    policy &&
    (policy.admissionYear !== year || policy.admissionGrade !== grade);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current || !verified || !policy || !valid || !changed) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    const request = generation.current;
    try {
      const result = await saveStudentRegistrationPolicy({
        admissionYear: year,
        admissionGrade: grade,
        expectedRevision: policy.revision,
      });
      if (generation.current !== request) return;
      setPolicy(result);
      setYear(result.admissionYear);
      setGrade(result.admissionGrade);
      showToast({ tone: "success", title: "신규 가입 기준을 저장했습니다." });
    } catch (saveError) {
      if (generation.current === request)
        setError(policyError(saveError, true));
    } finally {
      if (generation.current === request) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="student-registration-policy-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-lg overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 text-gray-800 shadow-xl backdrop:bg-black/50"
    >
      <form onSubmit={save} aria-busy={loading || saving}>
        <h2
          id="student-registration-policy-title"
          className="text-lg font-bold"
        >
          신규 가입 기준
        </h2>
        <p className="mt-3 text-sm text-gray-600">
          새 가입과 승인 대기 계정에 적용됩니다. 이미 승인된 학생의 계정과
          기록은 유지됩니다.
        </p>
        {loading && <LoadingOverlay />}
        {policy && (
          <>
            <p className="mt-4 break-all text-sm text-gray-600">
              현재 기준:{" "}
              <span className="font-mono">{policy.emailPatternLabel}</span>
            </p>
            <fieldset
              disabled={loading || saving || !verified}
              className="mt-4 grid grid-cols-2 gap-3"
            >
              <label className="text-sm font-bold">
                계정 발급 연도
                <input
                  type="number"
                  inputMode="numeric"
                  min="2000"
                  max="2099"
                  step="1"
                  required
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base font-normal"
                />
              </label>
              <label className="text-sm font-bold">
                담당 학년
                <select
                  value={grade}
                  onChange={(event) => setGrade(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base font-normal"
                >
                  {["1", "2", "3"].map((value) => (
                    <option key={value} value={value}>
                      {value}학년
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <div className="mt-4 text-sm">
              <span className="font-bold">허용할 계정</span>
              <output
                className="mt-1 block break-all font-mono"
                aria-live="polite"
              >
                {valid
                  ? `${year.slice(-2)}${grade}NNNN@yongshin-ms.ms.kr`
                  : "발급 연도와 학년을 확인해 주세요."}
              </output>
              <p className="mt-1 text-gray-500">NNNN은 숫자 4자리입니다.</p>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || saving}
            className="mr-auto min-h-11 rounded-lg border border-gray-300 px-3 text-sm disabled:opacity-50"
          >
            다시 불러오기
          </button>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="min-h-11 rounded-lg border border-gray-300 px-4 text-sm disabled:opacity-50"
          >
            닫기
          </button>
          <button
            type="submit"
            disabled={loading || saving || !verified || !valid || !changed}
            className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
