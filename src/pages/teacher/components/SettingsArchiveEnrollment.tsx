import React, { useMemo, useState } from "react";

import {
  getArchiveEnrollmentState,
  previewEnrollmentRoster,
  type ArchiveEnrollmentState,
  type EnrollmentProvenanceSource,
  type RosterPreviewResult,
} from "../../../lib/archiveEnrollment";
import {
  executeWestoryCommand,
  type EnrollmentRosterPayload,
} from "../../../lib/commandGateway";
import { getServerSemesterCoreState } from "../../../lib/semesterCore";

const DEFAULT_ROSTER = JSON.stringify(
  {
    semesterId: "2026-2",
    expectedSemesterRevision: 1,
    rosterId: "synthetic-roster-2026-2-v1",
    importRevision: 1,
    sourceLabel: "Dedicated Staging 합성 명단",
    effectiveFrom: "2026-08-01",
    expectedStudentUids: ["synthetic-student-001"],
    classes: [
      {
        grade: "1",
        classNumber: "1",
        displayName: "1학년 1반",
        homeroomTeacherUid: "synthetic-teacher-001",
      },
    ],
    entries: [
      {
        studentUid: "synthetic-student-001",
        displayName: "합성 학생 001",
        classKey: "1::1",
        studentNumber: "1",
      },
    ],
    reason: "W4 Dedicated Staging 합성 명단 검증",
  },
  null,
  2,
);

const digest = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
};

const errorMessage = (error: unknown) => {
  const details = (error as { details?: { reason?: string } })?.details;
  const reason = details?.reason;
  const message = String(
    (error as { message?: unknown })?.message || "요청을 처리하지 못했습니다.",
  );
  return reason ? `${message} (${reason})` : message;
};

const SettingsArchiveEnrollment: React.FC = () => {
  const [source, setSource] = useState<EnrollmentProvenanceSource>("CURRENT");
  const [semesterId, setSemesterId] = useState("2026-2");
  const [state, setState] = useState<ArchiveEnrollmentState | null>(null);
  const [readiness, setReadiness] = useState<{
    current: boolean;
    reason: string | null;
    dependencyHash: string | null;
  } | null>(null);
  const [rosterText, setRosterText] = useState(DEFAULT_ROSTER);
  const [preview, setPreview] = useState<RosterPreviewResult | null>(null);
  const [previewedRoster, setPreviewedRoster] =
    useState<EnrollmentRosterPayload | null>(null);
  const [archiveIntegrityHash, setArchiveIntegrityHash] = useState("");
  const [moveStudentUid, setMoveStudentUid] = useState("");
  const [moveEnrollmentId, setMoveEnrollmentId] = useState("");
  const [moveTargetClassId, setMoveTargetClassId] = useState("");
  const [moveStudentNumber, setMoveStudentNumber] = useState("");
  const [moveEffectiveAt, setMoveEffectiveAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const sourceNeedsSemester = source !== "CURRENT";
  const statusTone = state?.readOnly
    ? "border-amber-200 bg-amber-50 text-amber-800"
    : "border-emerald-200 bg-emerald-50 text-emerald-800";
  const canApplyRoster = preview?.passed === true && previewedRoster !== null;
  const summaryRows = useMemo(
    () =>
      preview
        ? [
            ["대상 학생", preview.summary.expectedStudentCount],
            ["학급", preview.summary.classCount],
            ["학적", preview.summary.enrollmentCount],
            ["중복 학생", preview.summary.duplicateStudentCount],
            ["중복 학급", preview.summary.duplicateClassCount],
            ["학생 참조 오류", preview.summary.orphanStudentCount],
            ["담임 참조 오류", preview.summary.orphanTeacherCount],
            ["학급 참조 오류", preview.summary.orphanClassCount],
            ["누락 학생", preview.summary.missingStudentCount],
          ]
        : [],
    [preview],
  );

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const loadState = () =>
    run(async () => {
      const selectedSemesterId = sourceNeedsSemester
        ? semesterId.trim()
        : undefined;
      const [nextState, core] = await Promise.all([
        getArchiveEnrollmentState({
          source,
          ...(selectedSemesterId ? { semesterId: selectedSemesterId } : {}),
          callSite: "SettingsArchiveEnrollment.loadState",
        }),
        getServerSemesterCoreState(selectedSemesterId),
      ]);
      setState(nextState);
      setReadiness(core.readiness);
      setArchiveIntegrityHash(nextState.archive?.integrityHash || "");
      setNotice("선택한 출처에서 학급·학적 상태를 불러왔습니다.");
    });

  const parseRoster = async (): Promise<EnrollmentRosterPayload> => {
    const parsed = JSON.parse(rosterText) as EnrollmentRosterPayload;
    const sourceHash =
      typeof parsed.sourceHash === "string" &&
      /^[a-f0-9]{64}$/i.test(parsed.sourceHash)
        ? parsed.sourceHash.toLowerCase()
        : await digest(rosterText);
    return { ...parsed, sourceHash };
  };

  const handlePreview = () =>
    run(async () => {
      const payload = await parseRoster();
      const result = await previewEnrollmentRoster(payload);
      setPreview(result);
      setPreviewedRoster(payload);
      setNotice(
        result.passed
          ? "명단 검증을 통과했습니다. 검증 해시가 같은 동안에만 적용할 수 있습니다."
          : "명단에서 해결해야 할 중복·누락·참조 오류가 발견됐습니다.",
      );
    });

  const handleApplyRoster = () =>
    run(async () => {
      if (!preview || !previewedRoster || !preview.passed) {
        throw new Error("먼저 명단 검증을 통과해 주세요.");
      }
      const result = await executeWestoryCommand("importEnrollmentRoster", {
        ...previewedRoster,
        validationHash: preview.validationHash,
      });
      setNotice(
        `명단을 적용했습니다. 새 학적 ${result.result.createdEnrollmentCount}건, 새 학생 identity ${result.result.createdIdentityCount}건입니다.`,
      );
      setPreview(null);
      setPreviewedRoster(null);
    });

  const handleMove = () =>
    run(async () => {
      if (!state) throw new Error("먼저 학기 상태를 불러와 주세요.");
      const active = state.enrollments.find(
        (item) => item.enrollmentId === moveEnrollmentId,
      );
      if (!active?.revision)
        throw new Error("이동할 ACTIVE 학적을 확인해 주세요.");
      await executeWestoryCommand("moveEnrollment", {
        semesterId: state.semesterId,
        studentUid: moveStudentUid,
        activeEnrollmentId: moveEnrollmentId,
        expectedRevision: active.revision,
        targetClassId: moveTargetClassId,
        studentNumber: moveStudentNumber,
        effectiveAt: moveEffectiveAt,
        reason: "관리자 화면에서 학급 이동",
      });
      setNotice("기존 학적 이력을 보존하고 새 학급으로 이동했습니다.");
    });

  const handlePrepareArchive = () =>
    run(async () => {
      if (!state) throw new Error("먼저 보관할 학기 상태를 불러와 주세요.");
      const result = await executeWestoryCommand("prepareSemesterArchive", {
        semesterId: state.semesterId,
        expectedRevision: Number(
          (await getServerSemesterCoreState(state.semesterId)).requested
            ?.revision || 0,
        ),
        accessPolicy: "ADMIN_ONLY",
        sourcePaths: [
          "semester_classes",
          "semester_enrollments",
          "enrollment_roster_imports",
        ],
        unresolvedLegacyItems: [],
        reason: "관리자 화면에서 학기 보관 무결성 준비",
      });
      setArchiveIntegrityHash(result.result.integrityHash);
      setNotice("보관 대상 수와 무결성 해시를 기록했습니다.");
    });

  const handleFreezeArchive = () =>
    run(async () => {
      if (!state || !archiveIntegrityHash) {
        throw new Error("먼저 아카이브 준비 결과를 확인해 주세요.");
      }
      const core = await getServerSemesterCoreState(state.semesterId);
      await executeWestoryCommand("freezeSemesterArchive", {
        semesterId: state.semesterId,
        expectedRevision: Number(core.requested?.revision || 0),
        expectedIntegrityHash: archiveIntegrityHash,
        reason: "관리자 화면에서 학기 보관 동결",
      });
      setNotice(
        "학기 아카이브를 동결했습니다. 일반 수정은 서버에서 차단됩니다.",
      );
    });

  return (
    <section className="space-y-6" aria-labelledby="archive-enrollment-heading">
      <header className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold text-blue-700">W4 학기 데이터 기반</p>
        <h1
          id="archive-enrollment-heading"
          className="mt-1 text-2xl font-extrabold text-gray-900"
        >
          학급·학적·아카이브
        </h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          현재, 준비, 보관, 레거시 출처를 구분해 조회합니다. 레거시와 보관
          학기는 자동으로 대신 읽지 않으며, 명시적으로 선택한 경우에만 읽기
          전용으로 표시합니다.
        </p>
      </header>

      {(notice || error) && (
        <div
          role={error ? "alert" : "status"}
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            error
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-blue-200 bg-blue-50 text-blue-800"
          }`}
        >
          {error || notice}
        </div>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[180px_1fr_auto] lg:items-end">
          <label className="text-sm font-bold text-gray-700">
            데이터 출처
            <select
              value={source}
              onChange={(event) =>
                setSource(event.target.value as EnrollmentProvenanceSource)
              }
              className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2"
            >
              <option value="CURRENT">CURRENT · 현재</option>
              <option value="PREPARING">PREPARING · 준비</option>
              <option value="ARCHIVE">ARCHIVE · 보관</option>
              <option value="LEGACY">LEGACY · 레거시</option>
              <option value="EXPLICIT">EXPLICIT · 학기 지정</option>
            </select>
          </label>
          <label className="text-sm font-bold text-gray-700">
            학기 ID
            <input
              value={semesterId}
              onChange={(event) => setSemesterId(event.target.value)}
              disabled={!sourceNeedsSemester}
              placeholder="2026-2"
              className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2 disabled:bg-gray-100"
            />
          </label>
          <button
            type="button"
            disabled={busy || (sourceNeedsSemester && !semesterId.trim())}
            onClick={() => void loadState()}
            className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            상태 불러오기
          </button>
        </div>

        {state && (
          <div className="mt-5 space-y-4">
            <div
              className={`flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold ${statusTone}`}
            >
              <span>{state.semesterId}</span>
              <span>·</span>
              <span>{state.provenance}</span>
              <span>·</span>
              <span>{state.status}</span>
              <span>·</span>
              <span>{state.readOnly ? "읽기 전용" : "명령으로 변경 가능"}</span>
              {state.legacy && (
                <span className="rounded-full bg-white/80 px-2 py-0.5">
                  LEGACY 명시 조회
                </span>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="text-xs font-bold text-gray-500">학급</div>
                <div className="mt-1 text-2xl font-extrabold text-gray-900">
                  {state.classes.length}
                </div>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="text-xs font-bold text-gray-500">학적</div>
                <div className="mt-1 text-2xl font-extrabold text-gray-900">
                  {state.enrollments.length}
                </div>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="text-xs font-bold text-gray-500">준비도</div>
                <div className="mt-1 text-sm font-extrabold text-gray-900">
                  {readiness?.current
                    ? "현재 PASS"
                    : readiness?.reason || "미확인"}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-3">학생</th>
                    <th className="px-4 py-3">당시 학급</th>
                    <th className="px-4 py-3">번호</th>
                    <th className="px-4 py-3">상태</th>
                    <th className="px-4 py-3">학적 ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {state.enrollments.map((item, index) => (
                    <tr
                      key={item.enrollmentId || `${item.studentUid}-${index}`}
                    >
                      <td className="px-4 py-3 font-bold text-gray-800">
                        {item.snapshot?.displayName ||
                          item.displayName ||
                          item.studentUid}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {item.snapshot?.classDisplayName ||
                          `${item.grade || "-"}학년 ${item.classNumber || "-"}반`}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {item.studentNumber || "-"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {item.enrollmentStatus || "LEGACY"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {item.enrollmentId || "legacy"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-extrabold text-gray-900">
          승인 명단 검증·적용
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          합성 명단 JSON을 먼저 dry run으로 검증합니다. 검증이 통과해야 적용
          버튼이 열립니다.
        </p>
        <textarea
          value={rosterText}
          onChange={(event) => {
            setRosterText(event.target.value);
            setPreview(null);
            setPreviewedRoster(null);
          }}
          rows={14}
          spellCheck={false}
          className="mt-4 w-full rounded-xl border border-gray-300 bg-gray-950 p-4 font-mono text-xs leading-5 text-gray-100"
          aria-label="승인 명단 JSON"
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handlePreview()}
            className="rounded-xl border border-blue-300 bg-blue-50 px-5 py-2.5 text-sm font-bold text-blue-800 disabled:opacity-50"
          >
            명단 dry run
          </button>
          <button
            type="button"
            disabled={busy || !canApplyRoster}
            onClick={() => void handleApplyRoster()}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            검증한 명단 적용
          </button>
        </div>
        {preview && (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {summaryRows.map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg bg-gray-50 px-3 py-2 text-sm"
              >
                <span className="text-gray-500">{label}</span>{" "}
                <strong className="text-gray-900">{value}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-extrabold text-gray-900">
            학생 학급 이동
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            기존 ACTIVE 학적을 TRANSFERRED로 남기고 새 학적을 만듭니다.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              ["학생 UID", moveStudentUid, setMoveStudentUid],
              ["현재 학적 ID", moveEnrollmentId, setMoveEnrollmentId],
              ["이동할 학급 ID", moveTargetClassId, setMoveTargetClassId],
              ["새 번호", moveStudentNumber, setMoveStudentNumber],
              ["효력일", moveEffectiveAt, setMoveEffectiveAt],
            ].map(([label, value, setter]) => (
              <label
                key={String(label)}
                className="text-sm font-bold text-gray-700"
              >
                {String(label)}
                <input
                  value={String(value)}
                  onChange={(event) =>
                    (setter as React.Dispatch<React.SetStateAction<string>>)(
                      event.target.value,
                    )
                  }
                  type={label === "효력일" ? "date" : "text"}
                  className="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || state?.readOnly !== false}
            onClick={() => void handleMove()}
            className="mt-4 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            이력 보존 후 이동
          </button>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-extrabold text-gray-900">
            아카이브 무결성
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            CLOSED 학기의 개수와 해시를 준비한 뒤 동결합니다. 접근 정책은 결정
            전까지 ADMIN_ONLY입니다.
          </p>
          <div className="mt-4 break-all rounded-xl bg-gray-50 p-3 font-mono text-xs text-gray-600">
            {archiveIntegrityHash || "준비된 무결성 해시가 없습니다."}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={
                busy || !state || !["CLOSING", "CLOSED"].includes(state.status)
              }
              onClick={() => void handlePrepareArchive()}
              className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-bold text-amber-900 disabled:opacity-40"
            >
              아카이브 준비
            </button>
            <button
              type="button"
              disabled={
                busy || state?.status !== "CLOSED" || !archiveIntegrityHash
              }
              onClick={() => void handleFreezeArchive()}
              className="rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              무결성 확인 후 동결
            </button>
          </div>
        </div>
      </section>
    </section>
  );
};

export default SettingsArchiveEnrollment;
