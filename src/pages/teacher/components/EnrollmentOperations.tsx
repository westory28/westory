import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  getArchiveEnrollmentState,
  type ArchiveEnrollmentState,
} from "../../../lib/archiveEnrollment";
import {
  executeWestoryCommand,
  WestoryCommandError,
  type W2CommandPayloads,
} from "../../../lib/commandGateway";
import {
  getServerSemesterCoreState,
  type SemesterManifest,
} from "../../../lib/semesterCore";
import {
  enrollmentClassName,
  enrollmentName,
  validateEnrollmentDate,
} from "../../../lib/enrollmentRosterForm";

const field =
  "mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-3 disabled:bg-gray-100";
const button =
  "rounded-lg border border-gray-200 bg-white px-4 py-3 font-bold text-gray-800 disabled:opacity-50";
interface Props {
  manifest: SemesterManifest;
  state: ArchiveEnrollmentState;
  onSaved: () => void;
  onBusy: (value: boolean) => void;
}

export function EnrollmentMove({ manifest, state, onSaved, onBusy }: Props) {
  const [studentId, setStudentId] = useState("");
  const [targetClassId, setTargetClassId] = useState("");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(
    new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }),
  );
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const flight = useRef<{
    commandId: string;
    payload: W2CommandPayloads["moveEnrollment"];
  } | null>(null);
  const running = useRef(false);
  const active = state.enrollments.filter(
    (row) => row.enrollmentStatus === "ACTIVE",
  );
  const selected = active.find((row) => row.enrollmentId === studentId);
  const target = state.classes.find(
    (row) => row.classId === targetClassId && row.status === "ACTIVE",
  );
  const writable =
    !state.readOnly &&
    ["PREPARING", "VALIDATING", "READY", "FAILED", "ACTIVE"].includes(
      manifest.status,
    );
  const submit = async () => {
    if (running.current || !writable) return;
    setError("");
    if (!flight.current) {
      try {
        if (
          !selected?.enrollmentId ||
          !selected.revision ||
          !target ||
          !confirmed
        )
          throw new Error(
            "학생과 이동할 학급을 선택하고 변경 내용을 확인해 주세요.",
          );
        if (!/^\d{1,3}$/.test(number) || Number(number) < 1)
          throw new Error("새 번호를 올바르게 입력해 주세요.");
        if (
          active.some(
            (row) =>
              row.studentUid !== selected.studentUid &&
              row.classId === target.classId &&
              Number(row.studentNumber) === Number(number),
          )
        )
          throw new Error("이 학급에서 이미 사용 중인 번호입니다.");
        if (
          selected.classId === target.classId &&
          Number(selected.studentNumber) === Number(number)
        )
          throw new Error("학급이나 번호가 바뀌지 않았습니다.");
        if (!reason.trim()) throw new Error("변경 사유를 입력해 주세요.");
        validateEnrollmentDate(date, manifest);
        flight.current = {
          commandId: crypto.randomUUID(),
          payload: {
            semesterId: state.semesterId,
            studentUid: selected.studentUid,
            activeEnrollmentId: selected.enrollmentId,
            expectedRevision: selected.revision,
            targetClassId: target.classId,
            studentNumber: String(Number(number)),
            effectiveAt: date,
            reason: reason.trim(),
          },
        };
      } catch (cause) {
        setError((cause as Error).message);
        return;
      }
    }
    running.current = true;
    setBusy(true);
    onBusy(true);
    try {
      await executeWestoryCommand("moveEnrollment", flight.current.payload, {
        commandId: flight.current.commandId,
      });
      flight.current = null;
      setUncertain(false);
      onSaved();
    } catch (cause) {
      const pending =
        !(cause instanceof WestoryCommandError) || !cause.outcomeConfirmed;
      setUncertain(pending);
      if (!pending) flight.current = null;
      setError(
        pending
          ? "변경 결과를 확인하지 못했습니다. 입력 내용을 유지한 채 같은 요청의 결과를 다시 확인해 주세요."
          : "학급 이동을 완료하지 못했습니다. 최신 명부를 불러온 뒤 다시 확인해 주세요.",
      );
    } finally {
      running.current = false;
      setBusy(false);
      onBusy(Boolean(flight.current));
    }
  };
  const resetConfirm = () => {
    setConfirmed(false);
    setError("");
  };
  return (
    <section className="space-y-4" aria-label="학생 학급 이동">
      <h3 className="text-lg font-bold">학생 학급 이동</h3>
      <p className="text-sm text-gray-600">
        이동 전 명부는 이력으로 보존합니다. 같은 학급에서 번호만 바꾸는 경우도
        이곳에서 처리할 수 있습니다.
      </p>
      {!writable && (
        <p className="rounded-lg bg-gray-50 p-4">
          이 학기는 읽기 전용입니다. 현재 또는 준비 중인 학기를 선택해 주세요.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}
      <fieldset
        disabled={!writable || busy || uncertain}
        className="grid gap-4 sm:grid-cols-2"
      >
        <legend className="sr-only">학급 이동 정보</legend>
        <label className="text-sm font-bold">
          학생
          <select
            className={field}
            value={studentId}
            onChange={(event) => {
              resetConfirm();
              setStudentId(event.target.value);
              const row = active.find(
                (item) => item.enrollmentId === event.target.value,
              );
              setNumber(row?.studentNumber || "");
              setTargetClassId(row?.classId || "");
            }}
          >
            <option value="">학생 선택</option>
            {active.map((row) => (
              <option key={row.enrollmentId} value={row.enrollmentId}>
                {enrollmentClassName(row)} {row.studentNumber}번{" "}
                {enrollmentName(row)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-bold">
          이동할 학급
          <select
            className={field}
            value={targetClassId}
            onChange={(event) => {
              resetConfirm();
              setTargetClassId(event.target.value);
            }}
          >
            <option value="">학급 선택</option>
            {state.classes
              .filter((row) => row.status === "ACTIVE")
              .map((row) => (
                <option key={row.classId} value={row.classId}>
                  {row.displayName}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm font-bold">
          새 번호
          <input
            className={field}
            type="number"
            min="1"
            max="999"
            value={number}
            onChange={(event) => {
              resetConfirm();
              setNumber(event.target.value);
            }}
          />
        </label>
        <label className="text-sm font-bold">
          적용 날짜
          <input
            className={field}
            type="date"
            min={manifest.startDate || undefined}
            max={manifest.endDate || undefined}
            value={date}
            onChange={(event) => {
              resetConfirm();
              setDate(event.target.value);
            }}
          />
        </label>
        <label className="text-sm font-bold sm:col-span-2">
          변경 사유
          <input
            className={field}
            value={reason}
            maxLength={500}
            placeholder="예: 학급 편성 변경"
            onChange={(event) => {
              resetConfirm();
              setReason(event.target.value);
            }}
          />
        </label>
        <label className="flex gap-3 py-3 sm:col-span-2">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            {selected && target
              ? `${enrollmentName(selected)} 학생을 ${target.displayName} ${number || "—"}번으로 변경하는 내용을 확인했습니다.`
              : "변경할 학생과 학급·번호를 확인했습니다."}
          </span>
        </label>
      </fieldset>
      <button
        className="rounded-lg bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-50"
        disabled={busy || !writable || (!uncertain && !confirmed)}
        onClick={() => void submit()}
      >
        {busy
          ? "처리 중…"
          : uncertain
            ? "변경 결과 다시 확인"
            : "학급 이동 적용"}
      </button>
    </section>
  );
}

export function EnrollmentArchive({ manifest, state, onSaved, onBusy }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(false);
  const running = useRef(false);
  type ArchiveFlight =
    | {
        type: "prepareSemesterArchive";
        payload: W2CommandPayloads["prepareSemesterArchive"];
        commandId: string;
      }
    | {
        type: "freezeSemesterArchive";
        payload: W2CommandPayloads["freezeSemesterArchive"];
        commandId: string;
      };
  const flight = useRef<ArchiveFlight | null>(null);
  const archive = state.archive;
  const frozen = archive?.archiveStatus === "FROZEN";
  const blocked = (archive?.unresolvedBlockingCount || 0) > 0;
  const allowed =
    ["CLOSING", "CLOSED"].includes(manifest.status) && !frozen && !blocked;
  const run = async (freeze: boolean) => {
    if (
      running.current ||
      !allowed ||
      (!flight.current && freeze && !confirmed)
    )
      return;
    running.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      if (!flight.current) {
        const core = await getServerSemesterCoreState(manifest.semesterId);
        if (!core.requested || core.requested.semesterId !== state.semesterId)
          throw new Error("학기 상태를 다시 확인해 주세요.");
        const latest = await getArchiveEnrollmentState({
          source: "EXPLICIT",
          semesterId: state.semesterId,
          callSite: "EnrollmentArchive.beforeSave",
        });
        if (
          latest.semesterId !== state.semesterId ||
          latest.archive?.archiveStatus === "FROZEN" ||
          (latest.archive?.unresolvedBlockingCount || 0) > 0
        )
          throw new Error("최신 보관 상태를 다시 확인해 주세요.");
        if (freeze && latest.archive?.integrityHash !== archive?.integrityHash)
          throw new Error("보관할 기록이 바뀌었습니다. 다시 확인해 주세요.");
        const base = {
          semesterId: state.semesterId,
          expectedRevision: core.requested.revision,
        };
        flight.current = freeze
          ? {
              type: "freezeSemesterArchive",
              commandId: crypto.randomUUID(),
              payload: {
                ...base,
                expectedIntegrityHash: archive?.integrityHash || "",
                reason: "관리자가 학급·학적 기록 보관을 확인함",
              },
            }
          : {
              type: "prepareSemesterArchive",
              commandId: crypto.randomUUID(),
              payload: {
                ...base,
                accessPolicy: "ADMIN_ONLY",
                sourcePaths: [
                  "semester_classes",
                  "semester_enrollments",
                  "enrollment_roster_imports",
                ],
                unresolvedLegacyItems: [],
                reason: "관리자가 학급·학적 기록의 보관 상태를 확인함",
              },
            };
      }
      if (flight.current.type === "prepareSemesterArchive")
        await executeWestoryCommand(
          "prepareSemesterArchive",
          flight.current.payload,
          { commandId: flight.current.commandId },
        );
      else
        await executeWestoryCommand(
          "freezeSemesterArchive",
          flight.current.payload,
          { commandId: flight.current.commandId },
        );
      flight.current = null;
      setRetry(false);
      onSaved();
    } catch (cause) {
      const pending =
        Boolean(flight.current) &&
        (!(cause instanceof WestoryCommandError) || !cause.outcomeConfirmed);
      setRetry(pending);
      if (!pending) flight.current = null;
      setError(
        pending
          ? "보관 결과를 확인하지 못했습니다. 같은 요청의 결과를 다시 확인해 주세요."
          : "보관 확인을 완료하지 못했습니다. 최신 학기 상태를 불러온 뒤 다시 시도해 주세요.",
      );
    } finally {
      running.current = false;
      setBusy(false);
      onBusy(Boolean(flight.current));
    }
  };
  return (
    <section className="space-y-4" aria-label="학급 학적 기록 보관">
      <h3 className="text-lg font-bold">학급·학적 기록 보관</h3>
      <p className="text-sm text-gray-600">
        마감한 학기의 학급·학생 명부와 명부 등록 이력을 확인해 보관합니다. 이
        작업은 학기를 전환하거나 위스·성적을 초기화하지 않습니다.
      </p>
      <p className="rounded-lg bg-gray-50 p-4 font-bold">
        {frozen
          ? "기록 보관을 완료했습니다."
          : blocked
            ? "보관 전에 확인해야 할 항목이 남아 있습니다."
            : archive
              ? "보관할 기록을 확인했습니다. 최종 보관을 진행할 수 있습니다."
              : "아직 보관할 기록을 확인하지 않았습니다."}
      </p>
      {archive && (
        <p className="text-sm text-gray-600">
          학급 {archive.counts.classCount || 0}개 · 학적{" "}
          {archive.counts.enrollmentCount || 0}건 · 명부 등록{" "}
          {archive.counts.rosterImportCount || 0}건
        </p>
      )}
      {blocked && (
        <p role="alert" className="text-red-700">
          확인 필요 항목 {archive?.unresolvedBlockingCount}건이 남아 있어 보관을
          진행할 수 없습니다. 학기 전환 준비 화면에서 상태를 확인해 주세요.
        </p>
      )}
      {!allowed && !frozen && !blocked && (
        <p className="text-gray-600">
          학기 마감 후 보관할 수 있습니다. 현재 학기의 기록은 그대로 유지됩니다.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}
      {allowed && !retry && (
        <div className="space-y-4">
          <button
            className={button}
            disabled={busy}
            onClick={() => void run(false)}
          >
            {archive ? "보관할 기록 다시 확인" : "보관할 기록 확인"}
          </button>
          {archive && manifest.status === "CLOSED" && (
            <>
              <label className="flex gap-3 py-3">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  {manifest.displayName}의 학급·학적 기록을 관리자 조회 전용으로
                  보관하는 내용을 확인했습니다.
                </span>
              </label>
              <button
                className="rounded-lg bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-50"
                disabled={busy || !confirmed}
                onClick={() => void run(true)}
              >
                확인한 기록 보관 완료
              </button>
            </>
          )}
        </div>
      )}
      {retry && (
        <button
          className={button}
          disabled={busy}
          onClick={() => void run(false)}
        >
          보관 결과 다시 확인
        </button>
      )}
      <Link
        className="inline-block py-3 font-bold text-blue-800"
        to={`/teacher/settings?tab=archive-records&semesterId=${manifest.semesterId}`}
      >
        지난 학기 기록 보기
      </Link>
    </section>
  );
}
