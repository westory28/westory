import React, { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import ProvenanceBadge from "../../../components/common/ProvenanceBadge";
import StatePanel from "../../../components/common/StatePanel";
import { useAuth } from "../../../contexts/AuthContext";
import {
  GradeEvidenceError,
  acknowledgeGradeEvidence,
  getGradeEvidenceDetail,
  getGradeEvidenceState,
  requestGradeReview,
  signOfficialGrade,
  type GradeEvidenceLifecycleStatus,
  type GradeEvidenceProvenance,
  type GradeEvidenceRecord,
  type GradeEvidenceScoreKind,
  type GradeEvidenceState,
} from "../../../lib/gradeEvidence";
import "../../gradeEvidence.css";

const SCORE_KIND_LABELS: Record<GradeEvidenceScoreKind, string> = {
  performance: "수행평가",
  written_exam_essay: "정기시험",
};

const STATUS_LABELS: Record<GradeEvidenceLifecycleStatus, string> = {
  DRAFT: "공개 전",
  AUTO_EVALUATED_UNOFFICIAL: "공개 전",
  TEACHER_REVIEW_REQUIRED: "공개 전",
  REVIEWED: "공개 전",
  EVIDENCE_LOCKED: "공개 전",
  OFFICIAL_PENDING_SIGNATURE: "확인·서명 필요",
  OFFICIAL: "확인 완료",
  CORRECTED: "정정 반영",
  UNKNOWN: "상태 확인 필요",
};

const formatScore = (value: number | null) =>
  value === null
    ? "-"
    : new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(
        value,
      );

const formatDate = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const statePanelForError = (error: GradeEvidenceError | null) => {
  if (error?.kind === "PERMISSION") return "PERMISSION" as const;
  if (error?.kind === "SESSION_EXPIRED") return "SESSION_EXPIRED" as const;
  if (error?.kind === "NETWORK") return "OFFLINE" as const;
  return "ERROR" as const;
};

const provenanceFromQuery = (
  value: string | null,
  semesterId: string,
  currentSemesterId: string,
): GradeEvidenceProvenance => {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "LEGACY") return "LEGACY";
  if (
    normalized === "ARCHIVE" ||
    (semesterId && semesterId !== currentSemesterId)
  ) {
    return "ARCHIVE";
  }
  return "CURRENT";
};

interface StudentGradeEvidenceViewProps {
  scoreKind: GradeEvidenceScoreKind;
}

const StudentGradeEvidenceView: React.FC<StudentGradeEvidenceViewProps> = ({
  scoreKind,
}) => {
  const { config, configReady, userData } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedSemesterId = String(
    searchParams.get("semesterId") || "",
  ).trim();
  const currentSemesterId = `${config?.year || ""}-${config?.semester || ""}`;
  const requestedProvenance = provenanceFromQuery(
    searchParams.get("source"),
    requestedSemesterId,
    currentSemesterId,
  );
  const [state, setState] = useState<GradeEvidenceState | null>(null);
  const [selectedHeadId, setSelectedHeadId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<GradeEvidenceError | null>(null);
  const [detail, setDetail] = useState<GradeEvidenceRecord | null>(null);
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<GradeEvidenceError | null>(
    null,
  );
  const [requestReason, setRequestReason] = useState("");
  const [attestationChecked, setAttestationChecked] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

  const loadState = useCallback(async () => {
    if (!configReady) return;
    setLoading(true);
    setError(null);
    try {
      const nextState = await getGradeEvidenceState({
        config,
        semesterId: requestedSemesterId || undefined,
        scoreKind,
        audience: "student",
        provenance: requestedProvenance,
      });
      setState(nextState);
      setSelectedHeadId((current) =>
        nextState.records.some((record) => record.headId === current)
          ? current
          : nextState.records[0]?.headId || "",
      );
    } catch (caught) {
      setState(null);
      setError(
        caught instanceof GradeEvidenceError
          ? caught
          : new GradeEvidenceError(
              "UNKNOWN",
              "성적 자료를 불러오지 못했습니다.",
            ),
      );
    } finally {
      setLoading(false);
    }
  }, [
    config,
    configReady,
    requestedProvenance,
    requestedSemesterId,
    scoreKind,
  ]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const selectedSummary = useMemo(
    () =>
      state?.records.find((record) => record.headId === selectedHeadId) ||
      state?.records[0] ||
      null,
    [selectedHeadId, state],
  );

  useEffect(() => {
    if (!selectedSummary?.headId) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    void getGradeEvidenceDetail({
      config,
      semesterId: requestedSemesterId || undefined,
      recordId: selectedSummary.headId,
      scoreKind,
      provenance: state?.provenance || requestedProvenance,
    })
      .then((nextDetail) => {
        if (!cancelled) setDetail(nextDetail);
      })
      .catch((caught) => {
        if (cancelled) return;
        setDetailError(
          caught instanceof GradeEvidenceError
            ? caught
            : new GradeEvidenceError(
                "UNKNOWN",
                "성적 근거 상세를 불러오지 못했습니다.",
              ),
        );
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    config,
    detailRefreshKey,
    scoreKind,
    selectedSummary?.headId,
    selectedSummary?.gradeRevision,
    selectedSummary?.revision,
    selectedSummary?.status,
    selectedSummary?.versionId,
    requestedProvenance,
    requestedSemesterId,
    state?.provenance,
  ]);

  const selected =
    detail?.headId === selectedSummary?.headId &&
    detail?.revision === selectedSummary?.revision &&
    detail?.gradeRevision === selectedSummary?.gradeRevision &&
    detail?.status === selectedSummary?.status
      ? detail
      : selectedSummary;

  useEffect(() => {
    setRequestReason("");
    setAttestationChecked(false);
    setActionMessage("");
    setActionError("");
  }, [selected?.headId]);

  const runAction = async (
    actionName: string,
    action: () => Promise<unknown>,
    successMessage: string,
  ) => {
    setPendingAction(actionName);
    setActionMessage("");
    setActionError("");
    try {
      await action();
      await loadState();
      setDetailRefreshKey((current) => current + 1);
      setActionMessage(successMessage);
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : "요청을 처리하지 못했습니다.",
      );
    } finally {
      setPendingAction("");
    }
  };

  const submitReviewRequest = async () => {
    if (!selected || requestReason.trim().length < 5) {
      setActionError("확인이 필요한 내용을 5자 이상 적어 주세요.");
      return;
    }
    const expectedSemesterRevision = state?.manifestRevision;
    if (!expectedSemesterRevision) {
      setActionError(
        "현재 학기 기준을 확인할 수 없어 요청을 보내지 않았습니다.",
      );
      return;
    }
    await runAction(
      "request",
      () =>
        requestGradeReview({
          config,
          headId: selected.headId,
          versionId: selected.versionId,
          expectedRevision: selected.revision,
          expectedGradeRevision: selected.gradeRevision,
          expectedSemesterRevision,
          requestKind: "OBJECTION",
          reason: requestReason,
        }),
      "담당 교사에게 확인 요청을 보냈습니다.",
    );
  };

  const submitAcknowledgement = async () => {
    if (!selected) return;
    const expectedSemesterRevision = state?.manifestRevision;
    if (!expectedSemesterRevision) {
      setActionError(
        "현재 학기 기준을 확인할 수 없어 확인 기록을 남기지 않았습니다.",
      );
      return;
    }
    await runAction(
      "acknowledge",
      () =>
        acknowledgeGradeEvidence({
          config,
          headId: selected.headId,
          versionId: selected.versionId,
          expectedRevision: selected.revision,
          expectedGradeRevision: selected.gradeRevision,
          expectedSemesterRevision,
        }),
      "점수와 근거를 확인한 기록이 남았습니다.",
    );
  };

  const submitSignature = async () => {
    if (!selected || !attestationChecked) {
      setActionError("서명 내용을 읽고 확인란을 선택해 주세요.");
      return;
    }
    const expectedSemesterRevision = state?.manifestRevision;
    if (!expectedSemesterRevision) {
      setActionError(
        "현재 학기 기준을 확인할 수 없어 서명을 제출하지 않았습니다.",
      );
      return;
    }
    const signerName = String(userData?.name || "").trim();
    if (!signerName) {
      setActionError("내 정보에서 이름을 확인한 뒤 다시 시도해 주세요.");
      return;
    }
    await runAction(
      "sign",
      () =>
        signOfficialGrade({
          config,
          headId: selected.headId,
          versionId: selected.versionId,
          expectedRevision: selected.revision,
          expectedGradeRevision: selected.gradeRevision,
          expectedSemesterRevision,
          signerName,
        }),
      "서명이 안전하게 제출되었습니다.",
    );
  };

  if (userData && userData.role !== "student") {
    return <StatePanel state="PERMISSION" contactAdmin />;
  }

  if (!configReady || loading) {
    return <StatePanel state="LOADING" />;
  }

  if (error) {
    return (
      <StatePanel
        state={statePanelForError(error)}
        description={error.message}
        retryable={error.kind !== "PERMISSION"}
        contactAdmin={error.kind === "PERMISSION"}
        action={
          error.kind !== "PERMISSION"
            ? { label: "다시 불러오기", onClick: () => void loadState() }
            : undefined
        }
      />
    );
  }

  if (!state || state.records.length === 0) {
    if (state?.provenance === "LEGACY") {
      return (
        <div className="ws-grade-evidence">
          <StudentRouteTabs
            scoreKind={scoreKind}
            provenance={state.provenance}
            semesterId={requestedSemesterId || state.semesterId}
          />
          <StatePanel state="LEGACY" readOnly />
        </div>
      );
    }
    if (state?.provenance === "ARCHIVE") {
      return (
        <div className="ws-grade-evidence">
          <StudentRouteTabs
            scoreKind={scoreKind}
            provenance={state.provenance}
            semesterId={requestedSemesterId || state.semesterId}
          />
          <StatePanel state="ARCHIVED" readOnly />
        </div>
      );
    }
    return (
      <div className="ws-grade-evidence">
        <StudentRouteTabs
          scoreKind={scoreKind}
          provenance={requestedProvenance}
          semesterId={requestedSemesterId}
        />
        <StatePanel
          state="EMPTY"
          title={`공개된 ${SCORE_KIND_LABELS[scoreKind]} 점수가 없습니다.`}
          description="담당 교사가 공식 점수를 공개하면 이곳에서 근거와 함께 확인할 수 있습니다."
        />
      </div>
    );
  }

  return (
    <section
      className="ws-grade-evidence"
      aria-label={`${SCORE_KIND_LABELS[scoreKind]} 성적 근거`}
    >
      <StudentRouteTabs
        scoreKind={scoreKind}
        provenance={state.provenance}
        semesterId={state.readOnly ? state.semesterId : ""}
      />

      <div className="ws-grade-evidence__context">
        <p>
          {state.year}학년도 {state.semester}학기 · 내 공식 점수
        </p>
        <ProvenanceBadge value={state.provenance} readOnly={state.readOnly} />
      </div>

      {state.readOnly && (
        <StatePanel
          state={state.provenance === "LEGACY" ? "LEGACY" : "ARCHIVED"}
          compact
          readOnly
        />
      )}

      <div className="ws-grade-evidence__workspace">
        <section
          className="ws-grade-evidence__list"
          aria-labelledby="my-grades"
        >
          <header className="ws-grade-evidence__list-heading">
            <h2 id="my-grades">내 점수</h2>
          </header>
          <ul className="ws-grade-evidence__list-items">
            {state.records.map((record) => (
              <li key={record.headId}>
                <button
                  type="button"
                  className="ws-grade-evidence__record-button"
                  aria-current={record.headId === selectedSummary?.headId}
                  onClick={() => setSelectedHeadId(record.headId)}
                >
                  <span className="ws-grade-evidence__record-title">
                    {record.title}
                  </span>
                  <span className="ws-grade-evidence__score-line">
                    <span className="ws-grade-evidence__meta">
                      {STATUS_LABELS[record.status]}
                    </span>
                    <strong>
                      {formatScore(record.score)} /{" "}
                      {formatScore(record.maxScore)}
                    </strong>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {detailLoading && <StatePanel state="LOADING" compact />}
        {detailError && (
          <StatePanel
            state={statePanelForError(detailError)}
            compact
            description={detailError.message}
            retryable
            action={{
              label: "목록 다시 불러오기",
              onClick: () => void loadState(),
            }}
          />
        )}
        {selected && !detailLoading && !detailError && (
          <StudentGradeDetail
            record={selected}
            readOnly={state.readOnly || selected.readOnly}
            requestReason={requestReason}
            setRequestReason={setRequestReason}
            attestationChecked={attestationChecked}
            setAttestationChecked={setAttestationChecked}
            pendingAction={pendingAction}
            actionMessage={actionMessage}
            actionError={actionError}
            onRequest={() => void submitReviewRequest()}
            onAcknowledge={() => void submitAcknowledgement()}
            onSign={() => void submitSignature()}
          />
        )}
      </div>
    </section>
  );
};

const StudentRouteTabs: React.FC<{
  scoreKind: GradeEvidenceScoreKind;
  provenance: GradeEvidenceProvenance;
  semesterId: string;
}> = ({ scoreKind, provenance, semesterId }) => {
  const params = new URLSearchParams();
  if (provenance !== "CURRENT") params.set("source", provenance);
  if (semesterId) params.set("semesterId", semesterId);
  const query = params.toString();
  const search = query ? `?${query}` : "";
  return (
    <nav className="ws-grade-evidence__route-tabs" aria-label="성적 종류">
      <NavLink
        to={`/student/score/performance${search}`}
        className="ws-grade-evidence__route-tab"
        aria-current={scoreKind === "performance" ? "page" : undefined}
      >
        수행평가
      </NavLink>
      <NavLink
        to={`/student/score/written-exam${search}`}
        className="ws-grade-evidence__route-tab"
        aria-current={scoreKind === "written_exam_essay" ? "page" : undefined}
      >
        정기시험
      </NavLink>
    </nav>
  );
};

interface StudentGradeDetailProps {
  record: GradeEvidenceRecord;
  readOnly: boolean;
  requestReason: string;
  setRequestReason: (value: string) => void;
  attestationChecked: boolean;
  setAttestationChecked: (value: boolean) => void;
  pendingAction: string;
  actionMessage: string;
  actionError: string;
  onRequest: () => void;
  onAcknowledge: () => void;
  onSign: () => void;
}

const StudentGradeDetail: React.FC<StudentGradeDetailProps> = ({
  record,
  readOnly,
  requestReason,
  setRequestReason,
  attestationChecked,
  setAttestationChecked,
  pendingAction,
  actionMessage,
  actionError,
  onRequest,
  onAcknowledge,
  onSign,
}) => {
  const currentAttestations = record.attestations.filter(
    (item) =>
      item.versionId === record.versionId &&
      item.gradeRevision === record.gradeRevision,
  );
  const hasAcknowledged = currentAttestations.some(
    (item) => item.kind === "ACKNOWLEDGEMENT",
  );
  const signature = currentAttestations.find(
    (item) => item.kind === "SIGNATURE",
  );
  const previousAttestationCount =
    record.attestations.length - currentAttestations.length;
  const hasOpenRequest = record.requests.some(
    (item) =>
      item.versionId === record.versionId &&
      item.gradeRevision === record.gradeRevision &&
      (item.status === "PENDING" ||
        item.status === "REQUESTED" ||
        item.status === "IN_REVIEW"),
  );
  const actionDisabled = readOnly || Boolean(pendingAction);

  return (
    <article
      className={`ws-grade-evidence__detail ${readOnly ? "ws-grade-evidence__detail--readonly" : ""}`}
      aria-live="polite"
    >
      <header className="ws-grade-evidence__detail-header">
        <div className="ws-grade-evidence__score-line">
          <div>
            <h2>{record.title}</h2>
            <p className="ws-grade-evidence__meta">
              {record.assessmentLabel || "공식 성적"}
            </p>
          </div>
          <span className="ws-grade-evidence__status">
            {STATUS_LABELS[record.status]}
          </span>
        </div>
        <div className="ws-grade-evidence__score-line">
          <strong className="ws-grade-evidence__score">
            {formatScore(record.score)}점
          </strong>
          <span className="ws-grade-evidence__meta">
            총 {formatScore(record.maxScore)}점
            {record.percent !== null
              ? ` · ${formatScore(record.percent)}%`
              : ""}
          </span>
        </div>
      </header>

      <div className="ws-grade-evidence__detail-main">
        <section
          className="ws-grade-evidence__section"
          aria-labelledby="evidence-heading"
        >
          <div className="ws-grade-evidence__section-heading">
            <h3 id="evidence-heading">점수 근거</h3>
            <span className="ws-grade-evidence__meta">
              {record.evidence.length}개 항목
            </span>
          </div>
          {record.evidence.length > 0 ? (
            <ul className="ws-grade-evidence__evidence-list">
              {record.evidence.map((item) => (
                <li key={item.id} className="ws-grade-evidence__evidence-item">
                  <div className="ws-grade-evidence__evidence-title">
                    <span>{item.label}</span>
                    <span>
                      {formatScore(item.score)} / {formatScore(item.maxScore)}
                    </span>
                  </div>
                  {item.summary && (
                    <p className="ws-grade-evidence__meta">{item.summary}</p>
                  )}
                  {(item.studentAnswer || item.autoCorrect !== null) && (
                    <p className="ws-grade-evidence__meta">
                      제출 답안: {item.studentAnswer || "미응답"}
                      {item.autoCorrect !== null
                        ? ` · 자동 판정: ${item.autoCorrect ? "정답" : "오답"}`
                        : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ws-grade-evidence__empty-copy">
              점수 합계 근거를 확인할 수 있습니다. 세부 항목은 담당 교사에게
              확인해 주세요.
            </p>
          )}
        </section>

        <section
          className="ws-grade-evidence__section"
          aria-labelledby="request-history-heading"
        >
          <h3 id="request-history-heading">확인 요청 기록</h3>
          {record.requests.length > 0 ? (
            <ul className="ws-grade-evidence__timeline">
              {record.requests.map((request) => (
                <li
                  key={request.id}
                  className="ws-grade-evidence__timeline-item"
                >
                  <div className="ws-grade-evidence__evidence-title">
                    <span>{request.reason || "점수 확인 요청"}</span>
                    <span className="ws-grade-evidence__meta">
                      {request.versionId !== record.versionId ||
                      request.gradeRevision !== record.gradeRevision
                        ? "이전 점수 이력"
                        : request.status === "RESOLVED" ||
                            request.status === "ACCEPTED" ||
                            request.status === "REJECTED"
                          ? "답변 완료"
                          : "확인 중"}
                    </span>
                  </div>
                  {request.response && (
                    <p className="ws-grade-evidence__meta">
                      {request.response}
                    </p>
                  )}
                  {request.createdAt && (
                    <time
                      className="ws-grade-evidence__meta"
                      dateTime={request.createdAt}
                    >
                      {formatDate(request.createdAt)}
                    </time>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ws-grade-evidence__empty-copy">
              확인 요청 기록이 없습니다.
            </p>
          )}
        </section>
      </div>

      {!readOnly && (
        <aside
          className="ws-grade-evidence__detail-aside"
          aria-label="성적 확인 행동"
        >
          <section
            className="ws-grade-evidence__form"
            aria-labelledby="review-request-heading"
          >
            <h3 id="review-request-heading">점수 확인 요청</h3>
            <label
              className="ws-grade-evidence__label"
              htmlFor={`review-${record.headId}`}
            >
              확인이 필요한 내용
              <textarea
                id={`review-${record.headId}`}
                className="ws-grade-evidence__textarea"
                value={requestReason}
                maxLength={500}
                disabled={actionDisabled || hasOpenRequest}
                onChange={(event) => setRequestReason(event.target.value)}
                placeholder="항목과 이유를 구체적으로 적어 주세요."
              />
            </label>
            <div className="ws-grade-evidence__actions">
              <button
                type="button"
                className="ws-grade-evidence__button"
                disabled={
                  actionDisabled ||
                  hasOpenRequest ||
                  requestReason.trim().length < 5
                }
                onClick={onRequest}
              >
                {pendingAction === "request"
                  ? "요청 중…"
                  : "교사에게 확인 요청"}
              </button>
            </div>
            {hasOpenRequest && (
              <p className="ws-grade-evidence__notice">
                이미 확인 중인 요청이 있습니다.
              </p>
            )}
          </section>

          <section
            className="ws-grade-evidence__form"
            aria-labelledby="attestation-heading"
          >
            <h3 id="attestation-heading">확인·서명</h3>
            {previousAttestationCount > 0 && (
              <p className="ws-grade-evidence__meta">
                이전 점수 버전의 확인·서명 {previousAttestationCount}건은
                이력으로 보존됩니다.
              </p>
            )}
            {signature ? (
              <p className="ws-grade-evidence__notice">
                {signature.signerName || "본인"} 이름으로
                {signature.signedAt
                  ? ` ${formatDate(signature.signedAt)}에`
                  : ""}
                서명했습니다.
              </p>
            ) : (
              <>
                <p className="ws-grade-evidence__meta">
                  점수와 근거를 먼저 확인한 뒤 본인 이름으로 서명해 주세요.
                </p>
                <div className="ws-grade-evidence__actions">
                  <button
                    type="button"
                    className="ws-grade-evidence__button"
                    disabled={actionDisabled || hasAcknowledged}
                    onClick={onAcknowledge}
                  >
                    {pendingAction === "acknowledge"
                      ? "기록 중…"
                      : hasAcknowledged
                        ? "근거 확인 완료"
                        : "점수·근거 확인"}
                  </button>
                </div>
                <label className="ws-grade-evidence__check">
                  <input
                    type="checkbox"
                    checked={attestationChecked}
                    disabled={actionDisabled || !hasAcknowledged}
                    onChange={(event) =>
                      setAttestationChecked(event.target.checked)
                    }
                  />
                  <span>
                    표시된 점수와 근거가 본인의 성적임을 확인하고 서명합니다.
                  </span>
                </label>
                <button
                  type="button"
                  className="ws-grade-evidence__button ws-grade-evidence__button--primary"
                  disabled={
                    actionDisabled ||
                    !hasAcknowledged ||
                    !attestationChecked ||
                    hasOpenRequest
                  }
                  onClick={onSign}
                >
                  {pendingAction === "sign"
                    ? "서명 제출 중…"
                    : "본인 이름으로 서명"}
                </button>
              </>
            )}
          </section>

          {(actionMessage || actionError) && (
            <section
              className="ws-grade-evidence__section"
              aria-label="처리 결과"
            >
              {actionMessage && (
                <p className="ws-grade-evidence__notice" role="status">
                  {actionMessage}
                </p>
              )}
              {actionError && (
                <p
                  className="ws-grade-evidence__notice ws-grade-evidence__notice--error"
                  role="alert"
                >
                  {actionError}
                </p>
              )}
            </section>
          )}
        </aside>
      )}
    </article>
  );
};

export default StudentGradeEvidenceView;
