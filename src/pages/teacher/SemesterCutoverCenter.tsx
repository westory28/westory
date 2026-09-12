import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useAppToast } from "../../components/common/AppToastProvider";
import { PageDataLoading } from "../../components/common/LoadingState";
import { executeWestoryCommand } from "../../lib/commandGateway";
import {
  loadSemesterCoreSnapshot,
  getServerSemesterCoreState,
  resolveSemester,
  type SemesterCoreSnapshot,
  type ServerSemesterCoreState,
  type SemesterManifest,
} from "../../lib/semesterCore";
import { getDefaultSemesterDates } from "./components/semesterDates";
import {
  canActivateSemester,
  hasCompleteReadiness,
  nextSemester,
  readinessAdvice,
  readinessLabel,
  semesterStatusLabel,
} from "./components/semesterTransitionGuide";
import "./components/SemesterTransitionGuide.css";

const emptySnapshot: SemesterCoreSnapshot = {
  manifests: [],
  readinessReports: {},
  activePointer: null,
};

export default function SemesterCutoverCenter() {
  const { currentUser, studentMaintenanceConfig, refreshConfig } = useAuth();
  const { showToast } = useAppToast();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("targetSemesterId") || "";
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [server, setServer] = useState<ServerSemesterCoreState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingSemester, setEditingSemester] =
    useState<SemesterManifest | null>(null);
  const [form, setForm] = useState({
    schoolYear: "",
    term: "1" as "1" | "2",
    startDate: "",
    endDate: "",
  });
  const actionInFlightRef = useRef(false);
  const loadGeneration = useRef(0);
  const selected = snapshot.manifests.find(
    (item) => item.semesterId === selectedId,
  );
  const report = selected
    ? snapshot.readinessReports[selected.semesterId]
    : undefined;
  const activeResult = resolveSemester(snapshot, { mode: "ACTIVE" });
  const active = activeResult.ok ? activeResult.manifest : null;
  const studentAccessClosed = studentMaintenanceConfig?.enabled === true;
  const admin = currentUser?.email?.toLowerCase() === "westoria28@gmail.com";
  const locked = loading || Boolean(busy) || !admin;
  const readinessComplete = hasCompleteReadiness(selected, report, server);
  const archived = selected && ["CLOSED", "ARCHIVED"].includes(selected.status);
  const preparing =
    selected &&
    ["DRAFT", "PREPARING", "VALIDATING", "READY", "FAILED"].includes(
      selected.status,
    );

  const selectSemester = useCallback(
    (id: string) => {
      setConfirmed(false);
      setServer(null);
      setShowCreate(false);
      setEditingSemester(null);
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("targetSemesterId", id);
          next.delete("planId");
          next.delete("attemptId");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError("");
    setServer(null);
    setConfirmed(false);
    try {
      const next = await loadSemesterCoreSnapshot();
      if (generation !== loadGeneration.current) return;
      setSnapshot(next);
      if (!selectedId) {
        const preferred =
          next.manifests.find((item) =>
            ["PREPARING", "VALIDATING", "READY", "DRAFT", "FAILED"].includes(
              item.status,
            ),
          ) ||
          next.manifests.find(
            (item) => item.semesterId === next.activePointer?.semesterId,
          ) ||
          next.manifests[0];
        if (preferred) {
          selectSemester(preferred.semesterId);
          return;
        }
      }
      if (
        selectedId &&
        next.manifests.some((item) => item.semesterId === selectedId)
      ) {
        const state = await getServerSemesterCoreState(selectedId);
        if (generation !== loadGeneration.current) return;
        setServer(state);
      }
    } catch {
      if (generation === loadGeneration.current)
        setError(
          "학기 정보를 불러오지 못했습니다. 연결 상태와 관리자 로그인을 확인한 뒤 다시 시도해 주세요.",
        );
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [selectedId, selectSemester]);
  useEffect(() => {
    void reload();
    return () => {
      loadGeneration.current += 1;
    };
  }, [reload]);

  const runAction = async (
    label: string,
    action: () => Promise<void>,
    nextSelection?: string,
  ) => {
    if (actionInFlightRef.current || locked) return;
    actionInFlightRef.current = true;
    setBusy(label);
    setError("");
    setConfirmed(false);
    try {
      await action();
      if (nextSelection) selectSemester(nextSelection);
      else await reload();
      showToast({ tone: "success", title: `${label}을 완료했습니다.` });
    } catch (cause) {
      const reason = String((cause as { reason?: string })?.reason || "");
      const message = /REVISION|STALE|CONFLICT/.test(reason)
        ? "학기 정보가 변경되었습니다. 새로고침한 뒤 준비 상태를 다시 확인해 주세요."
        : /READINESS|CUTOVER|APPROVAL|ARCHIVE/.test(reason)
          ? "학기 전환에 필요한 준비가 아직 끝나지 않았습니다. 점검 항목을 확인하고 다시 시도해 주세요."
          : /AUTH|SESSION|IDENTITY|PERMISSION/.test(reason)
            ? "관리자 인증을 마치지 못했습니다. 로그인 상태를 확인하고 다시 시도해 주세요."
            : "요청을 완료했는지 확인하지 못했습니다. 새로고침하여 반영 결과를 확인해 주세요. 같은 요청을 다시 누르면 기존 처리 결과부터 확인합니다.";
      setError(message);
      setServer(null);
    } finally {
      actionInFlightRef.current = false;
      setBusy("");
    }
  };

  const beginCreate = () => {
    setEditingSemester(null);
    const next = nextSemester(active);
    const dates = getDefaultSemesterDates(next.schoolYear, next.term);
    setForm({ ...next, startDate: dates.startAt, endDate: dates.endAt });
    setShowCreate(true);
  };
  const beginEditDates = () => {
    if (!selected || !preparing) return;
    setEditingSemester(selected);
    setForm({
      schoolYear: selected.schoolYear,
      term: selected.term,
      startDate: selected.startDate,
      endDate: selected.endDate,
    });
    setShowCreate(true);
  };
  const changeTerm = (schoolYear: string, term: "1" | "2") => {
    const dates = getDefaultSemesterDates(schoolYear, term);
    setForm({
      schoolYear,
      term,
      startDate: dates.startAt,
      endDate: dates.endAt,
    });
  };
  const createSemester = (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !/^\d{4}$/.test(form.schoolYear) ||
      !form.startDate ||
      !form.endDate ||
      form.startDate >= form.endDate
    ) {
      setError(
        "학년도와 학기 날짜를 확인해 주세요. 종료일은 시작일보다 뒤여야 합니다.",
      );
      return;
    }
    if (
      !editingSemester &&
      snapshot.manifests.some(
        (item) =>
          item.schoolYear === form.schoolYear && item.term === form.term,
      )
    ) {
      setError("이미 등록된 학기입니다. 학기 목록에서 선택해 주세요.");
      return;
    }
    if (editingSemester) {
      const target = editingSemester;
      void runAction("학기 날짜 변경", async () => {
        await executeWestoryCommand("updateSemesterManifest", {
          semesterId: target.semesterId,
          expectedRevision: target.revision,
          displayName: target.displayName,
          startDate: form.startDate,
          endDate: form.endDate,
          reason: "관리자가 학교 일정에 맞게 학기 날짜를 변경했습니다.",
        });
        setShowCreate(false);
        setEditingSemester(null);
      });
      return;
    }
    void runAction(
      "학기 등록",
      async () => {
        await executeWestoryCommand("createSemesterManifest", {
          ...form,
          displayName: `${form.schoolYear}학년도 ${form.term}학기`,
        });
        setShowCreate(false);
      },
      `${form.schoolYear}-${form.term}`,
    );
  };
  const transition = (targetStatus: "PREPARING" | "READY") => {
    if (!selected) return;
    void runAction(
      targetStatus === "READY" ? "전환 준비 확인" : "학기 준비 시작",
      async () => {
        if (targetStatus === "READY") {
          const freshServer = await getServerSemesterCoreState(
            selected.semesterId,
          );
          if (!hasCompleteReadiness(selected, report, freshServer))
            throw { reason: "READINESS_STALE" };
        }
        await executeWestoryCommand("transitionSemesterStatus", {
          semesterId: selected.semesterId,
          expectedRevision: selected.revision,
          targetStatus,
          reason:
            targetStatus === "READY"
              ? "관리자가 최신 준비 점검 결과를 확인했습니다."
              : "관리자가 새 학기 준비를 시작했습니다.",
        });
      },
    );
  };
  const validate = () => {
    if (!selected) return;
    void runAction("준비 상태 점검", async () => {
      await executeWestoryCommand("validateSemesterReadiness", {
        semesterId: selected.semesterId,
        expectedRevision: selected.revision,
      });
    });
  };
  const activationAllowed = canActivateSemester({
    manifest: selected,
    report,
    server,
    activeId: active?.semesterId ?? null,
    studentAccessClosed,
    confirmed,
  });
  const activate = () => {
    if (!selected || !activationAllowed) return;
    const target = selected;
    void runAction("운영 학기 전환", async () => {
      const fresh = await loadSemesterCoreSnapshot();
      const freshTarget = fresh.manifests.find(
        (item) => item.semesterId === target.semesterId,
      );
      const freshActive = resolveSemester(fresh, { mode: "ACTIVE" });
      const freshServer = await getServerSemesterCoreState(target.semesterId);
      if (
        freshTarget?.revision !== target.revision ||
        (freshActive.ok ? freshActive.manifest.semesterId : null) !==
          (active?.semesterId ?? null) ||
        !canActivateSemester({
          manifest: freshTarget,
          report: fresh.readinessReports[target.semesterId],
          server: freshServer,
          activeId: active?.semesterId ?? null,
          studentAccessClosed,
          confirmed: true,
        })
      )
        throw { reason: "READINESS_STALE" };
      await executeWestoryCommand("activateSemester", {
        semesterId: target.semesterId,
        expectedRevision: target.revision,
        readinessPolicyVersion: target.readinessPolicyVersion,
        expectedActiveSemesterId: active?.semesterId ?? null,
      });
      await refreshConfig();
    });
  };

  return (
    <main
      className="ws-semester-guide"
      aria-labelledby="semester-guide-title"
      aria-busy={loading || Boolean(busy)}
    >
      <header className="ws-semester-guide__heading">
        <div>
          <h1 id="semester-guide-title">학기 전환</h1>
          <p>
            새 학기를 준비하고, 이전 학기 기록을 보존한 뒤 운영 학기를 바꿉니다.
          </p>
        </div>
        <Link to="/teacher/settings">설정으로 돌아가기</Link>
      </header>
      <div className="ws-semester-guide__summary">
        <span>
          현재 운영 학기{" "}
          <strong>
            {active?.displayName ||
              (loading ? "확인 중" : "현재 학기 확인 필요")}
          </strong>
        </span>
        <span>
          학생 접속{" "}
          <strong>
            {studentAccessClosed
              ? "중지 중"
              : studentMaintenanceConfig
                ? "허용 중"
                : "확인 중"}
          </strong>
        </span>
        <Link to="/teacher/settings?tab=student-access">학생 접속 관리</Link>
      </div>
      {error && (
        <div role="alert" className="ws-semester-guide__error">
          {error}
        </div>
      )}
      {!admin && <p role="alert">관리자 계정으로 로그인해 주세요.</p>}
      <section className="ws-semester-guide__section">
        <div className="ws-semester-guide__toolbar">
          <label htmlFor="semester-guide-select">
            관리할 학기
            <select
              id="semester-guide-select"
              value={selectedId}
              disabled={locked}
              onChange={(event) => selectSemester(event.target.value)}
            >
              <option value="">학기를 선택해 주세요</option>
              {snapshot.manifests.map((item) => (
                <option key={item.semesterId} value={item.semesterId}>
                  {item.displayName} ·{" "}
                  {semesterStatusLabel[item.status] || "상태 확인 필요"}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={locked} onClick={beginCreate}>
            새 학기 등록
          </button>
          <button
            type="button"
            disabled={Boolean(busy) || loading}
            onClick={() => void reload()}
          >
            새로고침
          </button>
        </div>
        {loading && <PageDataLoading />}
        {!loading && selectedId && !selected && (
          <p role="alert">
            등록된 학기를 찾지 못했습니다. 목록에서 학기를 다시 선택해 주세요.
          </p>
        )}
        {showCreate && (
          <form onSubmit={createSemester} className="ws-semester-guide__form">
            <h2>
              {editingSemester
                ? `${editingSemester.displayName} 날짜 변경`
                : "새 학기 기본 정보"}
            </h2>
            <p>
              학년도를 선택하면 학기 날짜가 채워집니다. 학교 일정에 맞게 수정할
              수 있습니다.
            </p>
            {editingSemester && (
              <p>
                날짜를 변경하면 이전 점검 결과가 초기화됩니다. 변경 후 준비
                상태를 다시 확인해 주세요.
              </p>
            )}
            <div className="ws-semester-guide__fields">
              <label>
                학년도
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  value={form.schoolYear}
                  disabled={locked || Boolean(editingSemester)}
                  onChange={(event) =>
                    changeTerm(event.target.value, form.term)
                  }
                />
              </label>
              <label>
                학기
                <select
                  value={form.term}
                  disabled={locked || Boolean(editingSemester)}
                  onChange={(event) =>
                    changeTerm(form.schoolYear, event.target.value as "1" | "2")
                  }
                >
                  <option value="1">1학기</option>
                  <option value="2">2학기</option>
                </select>
              </label>
              <label>
                시작일
                <input
                  required
                  type="date"
                  value={form.startDate}
                  disabled={locked}
                  onChange={(event) =>
                    setForm({ ...form, startDate: event.target.value })
                  }
                />
              </label>
              <label>
                종료일
                <input
                  required
                  type="date"
                  min={form.startDate}
                  value={form.endDate}
                  disabled={locked}
                  onChange={(event) =>
                    setForm({ ...form, endDate: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="ws-semester-guide__actions">
              <button
                type="submit"
                className="ws-semester-guide__primary"
                disabled={locked}
              >
                {editingSemester ? "학기 날짜 저장" : "기본 정보 등록"}
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => setShowCreate(false)}
              >
                취소
              </button>
            </div>
          </form>
        )}
      </section>
      {selected && (
        <>
          <section className="ws-semester-guide__section">
            <div className="ws-semester-guide__heading">
              <h2>{selected.displayName}</h2>
              <span className="ws-semester-guide__badge">
                {semesterStatusLabel[selected.status] || "상태 확인 필요"}
              </span>
            </div>
            <p>
              {selected.startDate} ~ {selected.endDate}
            </p>
            {preparing && (
              <button disabled={locked} onClick={beginEditDates}>
                학기 날짜 수정
              </button>
            )}
            {archived ? (
              <>
                <p>보존된 이전 학기의 명부와 기록을 조회할 수 있습니다.</p>
                <div className="ws-semester-guide__actions">
                  <Link
                    to={`/teacher/settings?tab=archive-records&semesterId=${selected.semesterId}`}
                  >
                    이 학기 기록 보기
                  </Link>
                  <Link
                    to={`/teacher/settings?tab=archive-enrollment&semesterId=${selected.semesterId}`}
                  >
                    이 학기 명부 보기
                  </Link>
                </div>
              </>
            ) : selected.status === "ACTIVE" ? (
              <>
                <p>
                  현재 운영 중인 학기입니다. 다음 학기로 넘어가려면 새 학기를
                  등록하거나 준비 중인 학기를 선택해 주세요.
                </p>
                <Link
                  to={`/teacher/settings?tab=archive-enrollment&semesterId=${selected.semesterId}`}
                >
                  현재 학급과 학생 명부 관리
                </Link>
              </>
            ) : !preparing ? (
              <p>
                이 학기는 현재 전환을 진행할 수 없습니다. 학기 운영 상태를 먼저
                확인해 주세요.
              </p>
            ) : null}
          </section>
          {preparing && (
            <>
              <ol
                className="ws-semester-guide__steps"
                aria-label="학기 전환 순서"
              >
                <li>1. 기본 정보</li>
                <li>2. 학기 준비</li>
                <li>3. 준비 점검</li>
                <li>4. 운영 학기 전환</li>
              </ol>
              <section className="ws-semester-guide__section">
                <h2>학기 준비</h2>
                {["DRAFT", "FAILED"].includes(selected.status) ? (
                  <>
                    <p>
                      기본 정보가 등록되었습니다. 준비를 시작하면 학생 명부와
                      운영 자료를 확인할 수 있습니다.
                    </p>
                    <button
                      disabled={locked}
                      className="ws-semester-guide__primary"
                      onClick={() => transition("PREPARING")}
                    >
                      학기 준비 시작
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      학생 명부를 준비하고, 이전 학기의 기록이 보존되어 있는지
                      확인해 주세요. 평가 결과와 학생 답안을 새 학기로 옮기지
                      않습니다.
                    </p>
                    <div className="ws-semester-guide__actions">
                      <Link
                        to={`/teacher/settings?tab=archive-enrollment&semesterId=${selected.semesterId}`}
                      >
                        학급·학생 명부 준비
                      </Link>
                      {active && (
                        <Link
                          to={`/teacher/settings?tab=archive-records&semesterId=${active.semesterId}`}
                        >
                          이전 학기 기록 확인
                        </Link>
                      )}
                    </div>
                    <p>
                      자료 이전, 위스 운영 준비, 기록 보존과 전환 승인은 아래
                      점검 결과에서 확인합니다. 준비가 필요한 항목이 남아 있으면
                      학기를 전환할 수 없습니다.
                    </p>
                  </>
                )}
              </section>
              <section className="ws-semester-guide__section">
                <div className="ws-semester-guide__heading">
                  <h2>준비 상태 점검</h2>
                  <button
                    disabled={
                      locked ||
                      !["PREPARING", "VALIDATING", "READY"].includes(
                        selected.status,
                      )
                    }
                    onClick={validate}
                  >
                    준비 상태 확인
                  </button>
                </div>
                <p>
                  현재 저장된 학급·명부·운영 정보를 서버에서 함께 점검합니다.
                  준비 내용을 바꾸셨다면 다시 확인해 주세요.
                </p>
                {!report ? (
                  <p>아직 점검 결과가 없습니다.</p>
                ) : (
                  <>
                    <p role="status">
                      {readinessComplete
                        ? "필수 준비 항목을 모두 확인했습니다."
                        : "준비 항목을 확인해 주세요. 이전 점검 결과만으로 전환할 수 없습니다."}
                    </p>
                    <ul className="ws-semester-guide__checks">
                      {report.checks.map((check, index) => (
                        <li key={`${check.checkId}-${index}`}>
                          <div>
                            <strong>{readinessLabel(check.checkId)}</strong>
                            <span>
                              {check.required ? "필수" : "참고"} ·{" "}
                              {check.status === "PASS"
                                ? "확인됨"
                                : check.status === "WARNING"
                                  ? "확인 권장"
                                  : check.status === "NOT_APPLICABLE"
                                    ? "적용 대상 아님"
                                    : "준비 필요"}
                            </span>
                          </div>
                          {check.status !== "PASS" &&
                            check.status !== "NOT_APPLICABLE" && (
                              <p>{readinessAdvice(check.checkId)}</p>
                            )}
                        </li>
                      ))}
                    </ul>
                    {selected.status === "VALIDATING" && (
                      <button
                        disabled={locked || !readinessComplete}
                        className="ws-semester-guide__primary"
                        onClick={() => transition("READY")}
                      >
                        점검 결과 확인 · 전환 준비 완료
                      </button>
                    )}
                  </>
                )}
              </section>
              <section className="ws-semester-guide__section">
                <h2>운영 학기 전환</h2>
                <p>
                  {active
                    ? `${active.displayName}에서 ${selected.displayName}로 운영 학기를 변경합니다. 이전 학기는 마감되며 관리자 화면에서 계속 조회할 수 있습니다.`
                    : "새 운영 학기를 지정합니다."}
                </p>
                {!studentAccessClosed && (
                  <p className="ws-semester-guide__error">
                    학생 접속 중지 상태를 먼저 확인해 주세요.{" "}
                    <Link to="/teacher/settings?tab=student-access">
                      학생 접속 관리
                    </Link>
                  </p>
                )}
                {selected.status !== "READY" && (
                  <p>학기 준비와 필수 점검을 모두 마치면 전환할 수 있습니다.</p>
                )}
                <label className="ws-semester-guide__confirm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={
                      locked ||
                      selected.status !== "READY" ||
                      !readinessComplete ||
                      !studentAccessClosed
                    }
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>
                    대상 학기와 이전 기록 보존을 확인했습니다. 학생 접속은 중지
                    상태로 유지합니다.
                  </span>
                </label>
                <button
                  className="ws-semester-guide__primary"
                  disabled={locked || !activationAllowed}
                  onClick={activate}
                >
                  {selected.displayName}로 전환
                </button>
              </section>
            </>
          )}
        </>
      )}
      {busy && (
        <p role="status" className="ws-semester-guide__summary">
          {busy} 중입니다. 처리 결과를 확인할 때까지 기다려 주세요.
        </p>
      )}
    </main>
  );
}
