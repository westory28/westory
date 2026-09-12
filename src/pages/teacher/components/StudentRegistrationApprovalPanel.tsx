import React, { useEffect, useRef, useState } from "react";
import ModalSurface from "../../../components/common/ModalSurface";
import { useAuth } from "../../../contexts/AuthContext";
import { auth } from "../../../lib/firebase";
import { WestoryCommandError } from "../../../lib/commandGateway";
import {
  approveStudentRegistration,
  getStudentRegistrationApprovalState,
  type RegistrationApprovalState,
  type StudentRegistrationApprovalInput,
} from "../../../lib/studentRegistrationApproval";

interface Props {
  semesterId: string;
  onApproved?: () => void;
  onClose?: () => void;
}
interface Flight {
  payload: StudentRegistrationApprovalInput;
  commandId: string;
  expectedUid: string;
}
const StudentRegistrationApprovalPanel: React.FC<Props> = ({
  semesterId,
  onApproved,
  onClose,
}) => {
  const { user } = useAuth();
  const [state, setState] = useState<RegistrationApprovalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedUid, setSelectedUid] = useState("");
  const [classId, setClassId] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [unconfirmed, setUnconfirmed] = useState(false);
  const flight = useRef<Flight | null>(null);
  const epoch = useRef(0);
  const context = useRef({ semesterId, uid: user?.uid || "" });
  context.current = { semesterId, uid: user?.uid || "" };
  const selected = state?.students.find(
    (row) => row.studentUid === selectedUid,
  );
  const reload = async (append = false) => {
    const run = epoch.current;
    setLoading(true);
    setError("");
    try {
      const next = await getStudentRegistrationApprovalState({
        semesterId,
        ...(append && state?.nextCursor ? { cursor: state.nextCursor } : {}),
      });
      if (run !== epoch.current) return;
      setState((previous) =>
        append && previous
          ? {
              ...next,
              students: [...previous.students, ...next.students].filter(
                (row, index, all) =>
                  all.findIndex(
                    (item) => item.studentUid === row.studentUid,
                  ) === index,
              ),
            }
          : next,
      );
    } catch (cause) {
      if (run === epoch.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "승인 목록을 불러오지 못했습니다.",
        );
    } finally {
      if (run === epoch.current) setLoading(false);
    }
  };
  useEffect(() => {
    epoch.current += 1;
    flight.current = null;
    setState(null);
    setSelectedUid("");
    setConfirmed(false);
    setBusy(false);
    setUnconfirmed(false);
    setMessage("");
    void reload();
    return () => {
      epoch.current += 1;
    };
    // A semester/account change discards only this view; Gateway receipts and
    // the server's pending stage remain available to the appropriate teacher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semesterId, user?.uid]);

  const select = (uid: string) => {
    const row = state?.students.find((item) => item.studentUid === uid);
    setSelectedUid(uid);
    setDisplayName(row?.submittedProfile.name || "");
    setStudentNumber(row?.submittedProfile.number || "");
    // Never treat the requested class as the confirmed roster selection.
    setClassId("");
    setConfirmed(false);
    setError("");
    setMessage("");
  };
  const save = async () => {
    if (!selected || !state || busy || !user?.uid) return;
    const run = epoch.current,
      ownerUid = user.uid,
      targetUid = selected.studentUid;
    const valid = () =>
      run === epoch.current &&
      context.current.semesterId === semesterId &&
      context.current.uid === ownerUid &&
      auth.currentUser?.uid === ownerUid;
    const guard = () => {
      if (!valid())
        throw new Error("계정 또는 학기가 바뀌어 승인 처리를 중단했습니다.");
    };
    const command = async (payload: StudentRegistrationApprovalInput) => {
      guard();
      flight.current ||= {
        payload,
        commandId: crypto.randomUUID(),
        expectedUid: ownerUid,
      };
      const current = flight.current;
      await approveStudentRegistration(current.payload, {
        commandId: current.commandId,
        expectedUid: current.expectedUid,
      });
      guard();
      flight.current = null;
      setUnconfirmed(false);
    };
    setBusy(true);
    setError("");
    setMessage("등록 승인을 처리하고 있습니다.");
    try {
      let justFinalized = false;
      if (flight.current) {
        justFinalized = flight.current.payload.action === "FINALIZE";
        await command(flight.current.payload);
      } else if (selected.status === "PENDING") {
        const target = state.classes.find((item) => item.classId === classId);
        if (
          !target ||
          !confirmed ||
          !displayName.trim() ||
          !/^[1-9]\d{0,5}$/.test(studentNumber)
        )
          throw new Error(
            "명부에서 학급·번호·이름을 확인하고 확인란을 선택해 주세요.",
          );
        await command({
          action: "APPROVE",
          semesterId,
          expectedSemesterRevision: state.manifestRevision,
          studentUid: targetUid,
          expectedProfileVersion: selected.profileVersion,
          classId: target.classId,
          expectedClassRevision: target.revision,
          studentNumber,
          displayName: displayName.trim(),
          rosterConfirmed: true,
        });
      }
      if (!justFinalized) {
        guard();
        let current = await getStudentRegistrationApprovalState({
          semesterId,
          studentUid: targetUid,
        });
        guard();
        let row = current.students[0];
        if (!row)
          throw new Error(
            "승인 대기 목록이 바뀌었습니다. 새로고침 후 승인 상태를 확인해 주세요.",
          );
        if (row) {
          if (row.status !== "APPROVED_PENDING_ACCOUNT" || row.blockedReason)
            throw new Error(
              row.blockedReason || "승인 상태를 새로 확인해 주세요.",
            );
          if (!current.economyReady || !current.economyRevision)
            throw new Error(
              "학적 확인은 저장했습니다. Wis 운영 준비 후 ‘승인 이어서 완료’를 눌러 주세요.",
            );
          if (row.accountState === "NOT_PREPARED") {
            setMessage("확정한 학적의 빈 Wis 계좌를 준비하고 있습니다.");
            await command({
              action: "PREPARE_ACCOUNT",
              semesterId,
              expectedSemesterRevision: current.manifestRevision,
              studentUid: targetUid,
              expectedProfileVersion: row.profileVersion,
              expectedEnrollmentId: row.enrollmentId,
              expectedEconomyRevision: current.economyRevision,
            });
            current = await getStudentRegistrationApprovalState({
              semesterId,
              studentUid: targetUid,
            });
            guard();
            row = current.students[0];
            if (!row)
              throw new Error(
                "승인 대기 목록이 바뀌었습니다. 새로고침 후 승인 상태를 확인해 주세요.",
              );
          }
          if (row) {
            if (!row.accountRevision)
              throw new Error(
                "계좌 준비 결과를 확인하지 못했습니다. 새로고침 후 이어서 완료해 주세요.",
              );
            setMessage("학적과 계좌를 확인하고 등록 승인을 완료하고 있습니다.");
            await command({
              action: "FINALIZE",
              semesterId,
              expectedSemesterRevision: current.manifestRevision,
              studentUid: targetUid,
              expectedProfileVersion: row.profileVersion,
              expectedEnrollmentId: row.enrollmentId,
              expectedAccountRevision: row.accountRevision,
            });
          }
        }
      }
      guard();
      setMessage(
        "등록 승인을 완료했습니다. 학생이 다시 확인하면 학습을 시작할 수 있습니다.",
      );
      setSelectedUid("");
      setConfirmed(false);
      onApproved?.();
      await reload();
    } catch (cause) {
      if (!valid()) return;
      const uncertain =
        Boolean(flight.current) &&
        (!(cause instanceof WestoryCommandError) || !cause.outcomeConfirmed);
      setUnconfirmed(uncertain);
      if (!uncertain) flight.current = null;
      setMessage(
        uncertain
          ? "저장 결과를 확인하지 못했습니다. 같은 요청의 결과를 다시 확인해 주세요."
          : "완료하지 못한 단계는 승인 목록에 남아 있습니다.",
      );
      if (!uncertain) {
        setConfirmed(false);
        await reload();
      }
      if (valid())
        setError(
          cause instanceof Error
            ? cause.message
            : "등록 승인을 완료하지 못했습니다.",
        );
    } finally {
      if (valid()) setBusy(false);
    }
  };
  const disabled = busy || unconfirmed;
  const controlClass =
    "min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100";
  const content = (
    <section
      className={
        onClose
          ? undefined
          : "mb-6 rounded-xl border border-gray-200 bg-white p-4 md:p-6"
      }
      aria-labelledby={onClose ? undefined : "registration-approval-title"}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          {!onClose && (
            <h2
              id="registration-approval-title"
              className="text-lg font-bold text-gray-800"
            >
              신규 학생 등록 승인
            </h2>
          )}
          <p className="mt-1 text-sm text-gray-600">
            {semesterId}학기 명부와 신청 정보를 대조한 뒤 승인해 주세요.
          </p>
        </div>
        <button
          type="button"
          className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          disabled={disabled || loading}
          onClick={() => void reload()}
        >
          새로고침
        </button>
      </div>
      {loading && !state && (
        <p role="status" className="py-4 text-gray-600">
          승인 대기 학생을 불러오고 있습니다.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mb-3 text-sm text-blue-800">
          {message}
        </p>
      )}
      {state?.students.length === 0 && (
        <p className="py-3 text-gray-600">
          등록 승인 또는 계좌 준비를 기다리는 학생이 없습니다.
        </p>
      )}
      {Boolean(state?.students.length) && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="registration-student"
              className="mb-1 block text-sm font-semibold text-gray-700"
            >
              승인 대기 학생
            </label>
            <select
              id="registration-student"
              className={controlClass}
              disabled={disabled}
              value={selectedUid}
              onChange={(event) => select(event.target.value)}
            >
              <option value="">학생 선택</option>
              {state?.students.map((row) => (
                <option key={row.studentUid} value={row.studentUid}>
                  {row.submittedProfile.name || "이름 미입력"} ·{" "}
                  {row.submittedProfile.email} ·{" "}
                  {row.status === "PENDING"
                    ? "명부 확인 대기"
                    : "승인 완료 대기"}
                </option>
              ))}
            </select>
            {state?.nextCursor && (
              <button
                type="button"
                className="mt-2 min-h-[44px] text-sm font-semibold text-blue-700 disabled:opacity-50"
                disabled={disabled || loading}
                onClick={() => void reload(true)}
              >
                대기 학생 더 불러오기
              </button>
            )}
            {selected && (
              <dl className="mt-4 space-y-2 text-sm text-gray-700">
                <div>
                  <dt className="font-semibold">학생 신청 정보</dt>
                  <dd className="mt-1">
                    {selected.submittedProfile.grade || "미입력"}학년{" "}
                    {selected.submittedProfile.class || "미입력"}반{" "}
                    {selected.submittedProfile.number || "미입력"}번 ·{" "}
                    {selected.submittedProfile.name || "이름 미입력"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">학교 계정</dt>
                  <dd className="break-all">
                    {selected.submittedProfile.email}
                  </dd>
                </div>
              </dl>
            )}
          </div>
          {selected && (
            <div className="space-y-3">
              {selected.status === "PENDING" ? (
                <>
                  <label
                    className="block text-sm font-semibold text-gray-700"
                    htmlFor="registration-class"
                  >
                    명부에서 확인한 학급
                  </label>
                  <select
                    id="registration-class"
                    className={controlClass}
                    value={classId}
                    disabled={disabled}
                    onChange={(event) => {
                      setClassId(event.target.value);
                      setConfirmed(false);
                    }}
                  >
                    <option value="">확정 학급 선택</option>
                    {state?.classes.map((item) => (
                      <option key={item.classId} value={item.classId}>
                        {item.displayName}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="registration-number"
                        className="mb-1 block text-sm font-semibold text-gray-700"
                      >
                        확정 번호
                      </label>
                      <input
                        id="registration-number"
                        className={controlClass}
                        inputMode="numeric"
                        maxLength={6}
                        value={studentNumber}
                        disabled={disabled}
                        onChange={(event) => {
                          setStudentNumber(event.target.value);
                          setConfirmed(false);
                        }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="registration-name"
                        className="mb-1 block text-sm font-semibold text-gray-700"
                      >
                        확정 이름
                      </label>
                      <input
                        id="registration-name"
                        className={controlClass}
                        maxLength={80}
                        value={displayName}
                        disabled={disabled}
                        onChange={(event) => {
                          setDisplayName(event.target.value);
                          setConfirmed(false);
                        }}
                      />
                    </div>
                  </div>
                  <label className="flex min-h-[44px] items-start gap-2 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={disabled}
                      onChange={(event) => setConfirmed(event.target.checked)}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      교사 명부와 대조해 학급·번호·이름을 확인했습니다.
                    </span>
                  </label>
                </>
              ) : (
                <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
                  명부 확인은 저장했습니다. 빈 Wis 계좌를 준비하고 학적과
                  일치하는지 확인하면 학생이 학습을 시작할 수 있습니다.
                </p>
              )}
              {selected.blockedReason && (
                <p className="text-sm text-red-700">{selected.blockedReason}</p>
              )}
              <button
                type="button"
                onClick={() => void save()}
                disabled={
                  busy ||
                  Boolean(selected.blockedReason) ||
                  (!unconfirmed &&
                    selected.status === "PENDING" &&
                    (!confirmed ||
                      !classId ||
                      !displayName.trim() ||
                      !studentNumber))
                }
                className="min-h-[44px] w-full rounded-lg bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {busy
                  ? "승인 처리 중…"
                  : unconfirmed
                    ? "저장 결과 다시 확인"
                    : selected.status === "PENDING"
                      ? "명부 확인 후 승인"
                      : "승인 이어서 완료"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
  return onClose ? (
    <ModalSurface
      open
      title="신규 학생 등록 승인"
      onClose={onClose}
      dismissible={!disabled}
      size="wide"
    >
      {content}
    </ModalSurface>
  ) : (
    content
  );
};
export default StudentRegistrationApprovalPanel;
