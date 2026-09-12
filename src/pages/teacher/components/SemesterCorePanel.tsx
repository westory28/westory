import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { InlineLoading } from "../../../components/common/LoadingState";
import { executeWestoryCommand } from "../../../lib/commandGateway";
import { getDefaultSemesterDates } from "./semesterDates";
import {
  getServerSemesterCoreState,
  isReadinessCurrent,
  loadSemesterCoreSnapshot,
  resolveSemester,
  type SemesterCoreSnapshot,
  type SemesterManifest,
  type SemesterReadinessCheck,
  type ServerSemesterCoreState,
  type SemesterStatus,
} from "../../../lib/semesterCore";

const EMPTY_SNAPSHOT: SemesterCoreSnapshot = {
  manifests: [],
  readinessReports: {},
  activePointer: null,
};

const STATUS_LABEL: Record<SemesterStatus, string> = {
  DRAFT: "초안",
  PREPARING: "준비 중",
  VALIDATING: "검증 중",
  READY: "활성화 준비 완료",
  ACTIVE: "현재 운영",
  CLOSING: "종료 준비",
  CLOSED: "종료",
  ARCHIVED: "보관",
  FAILED: "검증 실패",
  QUARANTINED: "격리",
};

const STATUS_CLASS: Record<SemesterStatus, string> = {
  DRAFT: "border-gray-200 bg-gray-50 text-gray-700",
  PREPARING: "border-blue-200 bg-blue-50 text-blue-800",
  VALIDATING: "border-amber-200 bg-amber-50 text-amber-800",
  READY: "border-emerald-200 bg-emerald-50 text-emerald-800",
  ACTIVE: "border-blue-600 bg-blue-600 text-white",
  CLOSING: "border-amber-300 bg-amber-100 text-amber-900",
  CLOSED: "border-slate-300 bg-slate-100 text-slate-700",
  ARCHIVED: "border-slate-400 bg-slate-800 text-white",
  FAILED: "border-red-200 bg-red-50 text-red-800",
  QUARANTINED: "border-red-400 bg-red-950 text-white",
};

const CHECK_CLASS: Record<string, string> = {
  PASS: "border-emerald-200 bg-emerald-50 text-emerald-800",
  FAIL: "border-red-200 bg-red-50 text-red-800",
  WARNING: "border-amber-200 bg-amber-50 text-amber-800",
  PENDING: "border-gray-200 bg-gray-50 text-gray-700",
  NOT_APPLICABLE: "border-slate-200 bg-slate-50 text-slate-600",
};

const formatTimestamp = (value: unknown) => {
  if (!value) return "아직 없음";
  const millis =
    typeof (value as { toMillis?: unknown }).toMillis === "function"
      ? (value as { toMillis: () => number }).toMillis()
      : typeof value === "string" || typeof value === "number"
        ? new Date(value).getTime()
        : NaN;
  if (!Number.isFinite(millis)) return "기록됨";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(millis);
};

const getErrorMessage = (error: unknown) => {
  const reason = String(
    (error as { reason?: unknown })?.reason ||
      (error as { message?: unknown })?.message ||
      "SEMESTER_COMMAND_FAILED",
  );
  const known: Record<string, string> = {
    SEMESTER_REVISION_CONFLICT:
      "다른 관리자가 학기 정보를 먼저 변경했습니다. 최신 상태를 다시 불러와 주세요.",
    SEMESTER_READINESS_STALE:
      "학기 정보가 바뀌어 이전 검증 결과를 사용할 수 없습니다. 준비도를 다시 검증해 주세요.",
    SEMESTER_REQUIRED_CHECKS_INCOMPLETE:
      "필수 준비 항목이 모두 통과하지 않아 다음 상태로 진행할 수 없습니다.",
    SEMESTER_ACTIVE_CONFLICT:
      "활성 학기 기준이 달라졌습니다. 현재 활성 학기를 다시 확인해 주세요.",
    SEMESTER_TRANSITION_INVALID:
      "현재 상태에서는 요청한 학기 상태로 변경할 수 없습니다.",
    SEMESTER_IDENTITY_CONFLICT:
      "같은 학년도와 학기의 Manifest가 이미 있습니다.",
  };
  return known[reason] || reason;
};

const ReadinessCheckRow: React.FC<{ check: SemesterReadinessCheck }> = ({
  check,
}) => (
  <li className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-gray-900">{check.label}</span>
        <span className="text-[11px] font-bold text-gray-500">
          {check.required ? "필수" : "참고"} · {check.ownerWave || "W3"}
        </span>
      </div>
      {(check.failureReason || check.resultSummary || check.evidence) && (
        <p className="mt-1 break-words text-xs leading-5 text-gray-600">
          {check.failureReason || check.resultSummary || check.evidence}
        </p>
      )}
    </div>
    <span
      className={`inline-flex shrink-0 self-start rounded-full border px-2 py-1 text-[11px] font-bold ${CHECK_CLASS[check.status] || CHECK_CLASS.PENDING}`}
    >
      {check.status}
    </span>
  </li>
);

const SemesterCorePanel: React.FC = () => {
  const { showToast } = useAppToast();
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [loadError, setLoadError] = useState("");
  const [serverReadiness, setServerReadiness] =
    useState<ServerSemesterCoreState["readiness"]>(null);
  const [form, setForm] = useState({
    schoolYear: String(new Date().getFullYear()),
    term: "2" as "1" | "2",
    displayName: "",
    ...getDefaultSemesterDates(String(new Date().getFullYear()), "2"),
  });

  const reload = useCallback(async () => {
    setLoadError("");
    try {
      const next = await loadSemesterCoreSnapshot();
      setSnapshot(next);
      setSelectedId((current) =>
        current && next.manifests.some((item) => item.semesterId === current)
          ? current
          : next.activePointer?.semesterId ||
            next.manifests[0]?.semesterId ||
            "",
      );
    } catch (error) {
      console.error("Failed to load semester core:", error);
      setLoadError("학기 Manifest와 준비도 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    setServerReadiness(null);
    if (!selectedId) return () => undefined;
    void getServerSemesterCoreState(selectedId)
      .then((state) => {
        if (!cancelled) setServerReadiness(state.readiness);
      })
      .catch((error) => {
        console.error("Failed to load canonical semester readiness:", error);
        if (!cancelled) setServerReadiness(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, snapshot]);

  const selected = useMemo(
    () =>
      snapshot.manifests.find((item) => item.semesterId === selectedId) || null,
    [selectedId, snapshot.manifests],
  );
  const report = selected
    ? snapshot.readinessReports[selected.semesterId]
    : null;
  const reportMatchesManifest = selected
    ? isReadinessCurrent(selected, report)
    : false;
  const readinessCurrent =
    reportMatchesManifest && serverReadiness?.current === true;
  const activeResult = resolveSemester(snapshot, { mode: "ACTIVE" });
  const preparingResult = resolveSemester(snapshot, { mode: "PREPARING" });

  const runCommand = async (label: string, action: () => Promise<unknown>) => {
    setBusyAction(label);
    try {
      await action();
      await reload();
      showToast({
        tone: "success",
        title: `${label} 요청을 반영했습니다.`,
        message: "서버가 기록한 최신 Manifest와 준비도를 다시 불러왔습니다.",
      });
    } catch (error) {
      console.error(`Failed semester command: ${label}`, error);
      showToast({
        tone: "error",
        title: `${label} 요청을 처리하지 못했습니다.`,
        message: getErrorMessage(error),
      });
    } finally {
      setBusyAction("");
    }
  };

  const createManifest = () => {
    const schoolYear = form.schoolYear.trim();
    if (!/^\d{4}$/.test(schoolYear) || !form.startAt || !form.endAt) {
      showToast({
        tone: "warning",
        title: "학기 기본 정보를 확인해 주세요.",
        message: "4자리 학년도와 시작일·종료일을 모두 입력해야 합니다.",
      });
      return;
    }
    void runCommand("Manifest 생성", () =>
      executeWestoryCommand("createSemesterManifest", {
        schoolYear,
        term: form.term,
        displayName:
          form.displayName.trim() || `${schoolYear}학년도 ${form.term}학기`,
        startDate: form.startAt,
        endDate: form.endAt,
      }),
    );
  };

  const transition = (
    manifest: SemesterManifest,
    targetStatus: Exclude<SemesterStatus, "DRAFT">,
  ) =>
    runCommand(`${STATUS_LABEL[targetStatus]} 전환`, () =>
      executeWestoryCommand("transitionSemesterStatus", {
        semesterId: manifest.semesterId,
        expectedRevision: manifest.revision,
        targetStatus,
        reason: `관리자 학기 화면에서 ${STATUS_LABEL[targetStatus]} 상태로 전환`,
      }),
    );

  if (loading) {
    return (
      <InlineLoading message="학기 Manifest를 불러오는 중입니다." showWarning />
    );
  }

  return (
    <section className="space-y-5" aria-labelledby="semester-core-title">
      <div>
        <h4
          id="semester-core-title"
          className="text-base font-extrabold text-gray-900"
        >
          학기 Manifest와 활성화
        </h4>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          학기 생성, 준비도 검증, 상태 변경과 활성화는 서버 명령으로만
          처리됩니다.
        </p>
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
          {loadError}
          <button
            type="button"
            onClick={() => void reload()}
            className="ml-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs"
          >
            다시 불러오기
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="text-xs font-bold text-blue-700">현재 활성 학기</div>
          <div className="mt-1 text-lg font-extrabold text-blue-950">
            {activeResult.ok
              ? activeResult.manifest.displayName
              : "활성 학기 없음"}
          </div>
          <div className="mt-2 text-xs font-bold text-blue-700">
            {activeResult.ok
              ? `${activeResult.manifest.semesterId} · CURRENT · revision ${activeResult.manifest.revision}`
              : activeResult.reason}
          </div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs font-bold text-amber-800">준비 중 학기</div>
          <div className="mt-1 text-lg font-extrabold text-amber-950">
            {preparingResult.ok
              ? preparingResult.manifest.displayName
              : "준비 중 학기 없음"}
          </div>
          <div className="mt-2 text-xs font-bold text-amber-800">
            {preparingResult.ok
              ? `${preparingResult.manifest.semesterId} · PREPARING · ${STATUS_LABEL[preparingResult.manifest.status]}`
              : preparingResult.reason}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="text-sm font-extrabold text-gray-900">
          새 학기 Manifest
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-bold text-gray-700">
            학년도
            <input
              value={form.schoolYear}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  schoolYear: event.target.value,
                  ...getDefaultSemesterDates(event.target.value, current.term),
                }))
              }
              inputMode="numeric"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm"
            />
          </label>
          <label className="text-xs font-bold text-gray-700">
            학기
            <select
              value={form.term}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  term: event.target.value as "1" | "2",
                  ...getDefaultSemesterDates(
                    current.schoolYear,
                    event.target.value,
                  ),
                }))
              }
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm"
            >
              <option value="1">1학기</option>
              <option value="2">2학기</option>
            </select>
          </label>
          <label className="text-xs font-bold text-gray-700">
            시작일
            <input
              type="date"
              value={form.startAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  startAt: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm"
            />
          </label>
          <label className="text-xs font-bold text-gray-700">
            종료일
            <input
              type="date"
              value={form.endAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  endAt: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm"
            />
          </label>
          <label className="text-xs font-bold text-gray-700 sm:col-span-2 lg:col-span-1">
            표시 이름
            <input
              value={form.displayName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))
              }
              placeholder="자동 생성 가능"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={createManifest}
          disabled={!!busyAction}
          className="mt-3 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busyAction === "Manifest 생성" ? "생성 중..." : "Manifest 생성"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-2">
          <div className="text-sm font-extrabold text-gray-900">
            등록된 학기
          </div>
          {snapshot.manifests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-600">
              등록된 Semester Manifest가 없습니다.
            </div>
          ) : (
            snapshot.manifests.map((manifest) => (
              <button
                key={manifest.semesterId}
                type="button"
                onClick={() => setSelectedId(manifest.semesterId)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${
                  selectedId === manifest.semesterId
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 bg-white hover:bg-gray-50"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-extrabold text-gray-900">
                    {manifest.displayName}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-1 text-[11px] font-bold ${STATUS_CLASS[manifest.status]}`}
                  >
                    {STATUS_LABEL[manifest.status]}
                  </span>
                </div>
                <div className="mt-2 text-xs font-bold text-gray-500">
                  {manifest.semesterId} · {manifest.provenance} · revision{" "}
                  {manifest.revision}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
          {!selected ? (
            <div className="text-sm text-gray-600">
              확인할 학기를 선택해 주세요.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-lg font-extrabold text-gray-950">
                    {selected.displayName}
                  </div>
                  <div className="mt-1 text-xs font-bold text-gray-500">
                    {selected.semesterId} · {selected.provenance} · schema{" "}
                    {selected.schemaVersion} · policy{" "}
                    {selected.readinessPolicyVersion}
                  </div>
                </div>
                <span
                  className={`self-start rounded-full border px-3 py-1 text-xs font-bold ${STATUS_CLASS[selected.status]}`}
                >
                  {STATUS_LABEL[selected.status]}
                </span>
              </div>

              <div
                className={`rounded-lg border p-3 text-sm ${readinessCurrent ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}
              >
                <div className="font-extrabold">
                  {report
                    ? readinessCurrent
                      ? `서버 기준 필수 ${report.requiredPassed}/${report.requiredTotal} 통과`
                      : report.status === "STALE"
                        ? "검증 결과가 오래되었습니다"
                        : `보고서 기준 필수 ${report.requiredPassed}/${report.requiredTotal} 통과 · 서버 재확인 필요`
                    : "아직 준비도 검증을 실행하지 않았습니다"}
                </div>
                <div className="mt-1 text-xs font-bold opacity-80">
                  revision {selected.revision} · 마지막 검증{" "}
                  {formatTimestamp(report?.evaluatedAt)}
                </div>
                <div className="mt-1 text-xs font-medium opacity-80">
                  READY 전환과 활성화 전에 서버가 설정 의존성까지 다시
                  확인합니다.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {selected.status === "DRAFT" && (
                  <button
                    type="button"
                    disabled={!!busyAction}
                    onClick={() => void transition(selected, "PREPARING")}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
                  >
                    준비 시작
                  </button>
                )}
                {["PREPARING", "VALIDATING", "READY"].includes(
                  selected.status,
                ) && (
                  <button
                    type="button"
                    disabled={!!busyAction}
                    onClick={() =>
                      void runCommand("Readiness 검증", () =>
                        executeWestoryCommand("validateSemesterReadiness", {
                          semesterId: selected.semesterId,
                          expectedRevision: selected.revision,
                        }),
                      )
                    }
                    className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-bold text-blue-700 disabled:opacity-60"
                  >
                    Readiness 검증
                  </button>
                )}
                {selected.status === "VALIDATING" && (
                  <>
                    <button
                      type="button"
                      disabled={!!busyAction || !readinessCurrent}
                      onClick={() => void transition(selected, "READY")}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      READY 전환
                    </button>
                    {report?.status === "FAIL" && (
                      <button
                        type="button"
                        disabled={!!busyAction}
                        onClick={() => void transition(selected, "FAILED")}
                        className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-60"
                      >
                        실패 항목 확인 상태로 전환
                      </button>
                    )}
                  </>
                )}
                {selected.status === "READY" && (
                  <>
                    <button
                      type="button"
                      disabled={!!busyAction || !readinessCurrent}
                      onClick={() =>
                        void runCommand("학기 활성화", () =>
                          executeWestoryCommand("activateSemester", {
                            semesterId: selected.semesterId,
                            expectedRevision: selected.revision,
                            readinessPolicyVersion:
                              selected.readinessPolicyVersion,
                            expectedActiveSemesterId:
                              snapshot.activePointer?.semesterId || null,
                          }),
                        )
                      }
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      활성화 요청
                    </button>
                    <button
                      type="button"
                      disabled={!!busyAction}
                      onClick={() => void transition(selected, "PREPARING")}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-60"
                    >
                      준비 상태로 되돌리기
                    </button>
                  </>
                )}
                {selected.status === "CLOSED" && (
                  <button
                    type="button"
                    disabled={!!busyAction}
                    onClick={() => void transition(selected, "ARCHIVED")}
                    className="rounded-lg border border-slate-400 bg-slate-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
                  >
                    ARCHIVED 전환
                  </button>
                )}
                {selected.status === "FAILED" && (
                  <>
                    <button
                      type="button"
                      disabled={!!busyAction}
                      onClick={() => void transition(selected, "PREPARING")}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
                    >
                      보완 후 준비 재개
                    </button>
                    <button
                      type="button"
                      disabled={!!busyAction}
                      onClick={() => void transition(selected, "QUARANTINED")}
                      className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-60"
                    >
                      출처 확인이 필요한 학기로 격리
                    </button>
                  </>
                )}
                {["ACTIVE", "CLOSING"].includes(selected.status) && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold leading-5 text-gray-600">
                    운영 학기 종료는 새 학기 원자 활성화 과정에서 처리됩니다.
                    수동 종료는 W4의 전체 write fence가 적용되기 전까지 화면에서
                    제공하지 않습니다.
                  </div>
                )}
              </div>

              {report && report.checks.length > 0 && (
                <ul className="space-y-2" aria-label="학기 준비도 검사 결과">
                  {report.checks.map((check) => (
                    <ReadinessCheckRow key={check.checkId} check={check} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default SemesterCorePanel;
