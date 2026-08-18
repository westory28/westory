import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ProvenanceBadge from "../../../components/common/ProvenanceBadge";
import StatePanel from "../../../components/common/StatePanel";
import { useAuth } from "../../../contexts/AuthContext";
import {
  GradeEvidenceError,
  correctOfficialGrade,
  createGradeDraft,
  finalizeGradeEvidence,
  getGradeEvidenceDetail,
  getGradeEvidenceState,
  publishOfficialGrade,
  reviewGradeDraft,
  type GradeEvidenceCommandItem,
  type GradeEvidenceLifecycleStatus,
  type GradeEvidenceProvenance,
  type GradeEvidenceRecord,
  type GradeEvidenceScoreKind,
  type GradeEvidenceState,
} from "../../../lib/gradeEvidence";
import "../../gradeEvidence.css";

const KIND_LABELS: Record<GradeEvidenceScoreKind, string> = {
  performance: "수행평가",
  written_exam_essay: "정기시험",
};

const STATUS_LABELS: Record<GradeEvidenceLifecycleStatus, string> = {
  DRAFT: "채점 초안",
  AUTO_EVALUATED_UNOFFICIAL: "자동 판정·미공개",
  TEACHER_REVIEW_REQUIRED: "교사 검토 필요",
  REVIEWED: "검토 완료",
  EVIDENCE_LOCKED: "근거 잠금",
  OFFICIAL_PENDING_SIGNATURE: "학생 확인 대기",
  OFFICIAL: "공식 성적",
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

const mergeGradeQueuePage = (
  current: GradeEvidenceState,
  next: GradeEvidenceState,
): GradeEvidenceState => {
  const mergeBy = <T,>(
    existing: T[],
    incoming: T[],
    keyFor: (value: T) => string,
  ) => {
    const merged = new Map(existing.map((value) => [keyFor(value), value]));
    incoming.forEach((value) => merged.set(keyFor(value), value));
    return [...merged.values()];
  };
  return {
    ...next,
    records: mergeBy(current.records, next.records, (record) => record.headId),
    pendingSources: mergeBy(
      current.pendingSources,
      next.pendingSources,
      (candidate) => candidate.attemptId,
    ),
    activeStudents: mergeBy(
      current.activeStudents,
      next.activeStudents,
      (student) => student.studentUid,
    ),
  };
};

interface GradeEvidenceManagerProps {
  scoreKind: GradeEvidenceScoreKind;
}

const GradeEvidenceManager: React.FC<GradeEvidenceManagerProps> = ({
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
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingNextPage, setLoadingNextPage] = useState(false);
  const [nextPageError, setNextPageError] = useState("");
  const [error, setError] = useState<GradeEvidenceError | null>(null);
  const [detail, setDetail] = useState<GradeEvidenceRecord | null>(null);
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<GradeEvidenceError | null>(
    null,
  );
  const [pendingAction, setPendingAction] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [itemDrafts, setItemDrafts] = useState<
    Record<string, { awardedScore: string; reason: string }>
  >({});
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");

  const loadState = useCallback(
    async (cursor = "") => {
      if (!configReady) return;
      const appending = Boolean(cursor);
      if (appending) {
        setLoadingNextPage(true);
        setNextPageError("");
      } else {
        setLoading(true);
        setError(null);
        setNextPageError("");
      }
      try {
        const nextState = await getGradeEvidenceState({
          config,
          semesterId: requestedSemesterId || undefined,
          scoreKind,
          audience: "teacher",
          provenance: requestedProvenance,
          ...(cursor ? { cursor } : {}),
        });
        setState((current) => {
          const mergedState =
            appending && current
              ? mergeGradeQueuePage(current, nextState)
              : nextState;
          return mergedState;
        });
        setSelectedHeadId((current) => {
          if (appending && current) return current;
          return nextState.records.some((record) => record.headId === current)
            ? current
            : nextState.records[0]?.headId || "";
        });
      } catch (caught) {
        const resolvedError =
          caught instanceof GradeEvidenceError
            ? caught
            : new GradeEvidenceError(
                "UNKNOWN",
                "성적 근거 자료를 불러오지 못했습니다.",
              );
        if (appending) {
          setNextPageError(resolvedError.message);
        } else {
          setState(null);
          setError(resolvedError);
        }
      } finally {
        if (appending) setLoadingNextPage(false);
        else setLoading(false);
      }
    },
    [config, configReady, requestedProvenance, requestedSemesterId, scoreKind],
  );

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const filteredRecords = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return state?.records || [];
    return (state?.records || []).filter((record) =>
      [
        record.studentName,
        record.enrollmentLabel,
        record.title,
        record.assessmentLabel,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [searchText, state]);

  const selectedSummary = useMemo(
    () =>
      state?.records.find((record) => record.headId === selectedHeadId) ||
      filteredRecords[0] ||
      null,
    [filteredRecords, selectedHeadId, state],
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
    setItemDrafts(
      Object.fromEntries(
        (selected?.evidence || []).map((item) => [
          item.id,
          {
            awardedScore: item.score === null ? "" : String(item.score),
            reason: "",
          },
        ]),
      ),
    );
  }, [
    detail,
    selected?.gradeRevision,
    selected?.headId,
    selected?.revision,
    selected?.versionId,
  ]);

  useEffect(() => {
    setLifecycleReason("");
    setCorrectionReason("");
    setActionMessage("");
    setActionError("");
  }, [selectedSummary?.headId]);

  const buildCommandItems = (
    record: GradeEvidenceRecord,
  ): GradeEvidenceCommandItem[] | null => {
    const items = record.evidence.map((item) => {
      const maxScore = Number(item.maxScore);
      const awardedScore = Number(itemDrafts[item.id]?.awardedScore);
      return {
        itemId: item.id,
        maxScore,
        awardedScore,
        evaluationKind: item.sourceType === "AUTO" ? "AUTO" : "TEACHER",
        evidence: item.summary || "채점 근거 확인",
        reason: itemDrafts[item.id]?.reason.trim() || "",
      } satisfies GradeEvidenceCommandItem;
    });
    if (
      items.length === 0 ||
      items.some(
        (item) =>
          !Number.isFinite(item.maxScore) ||
          item.maxScore <= 0 ||
          !Number.isFinite(item.awardedScore) ||
          item.awardedScore < 0 ||
          item.awardedScore > item.maxScore,
      )
    ) {
      setActionError("모든 항목의 점수를 0점부터 배점 사이로 입력해 주세요.");
      return null;
    }
    return items;
  };

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
      setLifecycleReason("");
      setCorrectionReason("");
      setActionMessage(successMessage);
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : "명령을 처리하지 못했습니다.",
      );
    } finally {
      setPendingAction("");
    }
  };

  const createDraftFromCandidate = async (
    candidate: GradeEvidenceState["pendingSources"][number],
  ) => {
    const expectedSemesterRevision = state?.manifestRevision;
    if (!expectedSemesterRevision || state.readOnly || candidate.readOnly) {
      setActionError("현재 학기 제출만 성적 초안으로 만들 수 있습니다.");
      return;
    }
    await runAction(
      `create-${candidate.attemptId}`,
      () =>
        createGradeDraft(config, {
          attemptId: candidate.attemptId,
          scoreKind: candidate.scoreKind,
          title: candidate.title,
          rubricVersion: "w6b-assessment-v1",
          reason: "제출 원본에서 성적 초안을 생성합니다.",
          expectedSemesterRevision,
        }),
      "제출 원본에서 성적 초안을 만들었습니다.",
    );
  };

  const executeLifecycleAction = async (
    actionName: "review" | "finalize" | "publish",
  ) => {
    if (!selected) return;
    const expectedSemesterRevision = state?.manifestRevision;
    if (!expectedSemesterRevision) {
      setActionError(
        "현재 학기 revision을 확인할 수 없어 명령을 실행하지 않았습니다.",
      );
      return;
    }
    if (lifecycleReason.trim().length < 5) {
      setActionError("처리 사유를 5자 이상 입력해 주세요.");
      return;
    }
    const context = {
      config,
      headId: selected.headId,
      versionId: selected.versionId,
      expectedRevision: selected.revision,
      expectedGradeRevision: selected.gradeRevision,
      expectedSemesterRevision,
    };
    if (actionName === "review") {
      const items = buildCommandItems(selected);
      if (!items) return;
      await runAction(
        actionName,
        () =>
          reviewGradeDraft({
            ...context,
            items,
            reason: lifecycleReason,
          }),
        "검토 완료 상태로 반영했습니다.",
      );
      return;
    }
    if (actionName === "finalize") {
      await runAction(
        actionName,
        () =>
          finalizeGradeEvidence({
            ...context,
            reason: lifecycleReason,
          }),
        "근거를 잠그고 공식화 준비를 마쳤습니다.",
      );
      return;
    }
    await runAction(
      actionName,
      () =>
        publishOfficialGrade({
          ...context,
          reason: lifecycleReason,
          signatureRequired: true,
        }),
      "학생 확인이 가능한 공식 점수로 공개했습니다.",
    );
  };

  const submitCorrection = async () => {
    if (!selected) return;
    const expectedSemesterRevision = state?.manifestRevision;
    if (!expectedSemesterRevision) {
      setActionError(
        "현재 학기 revision을 확인할 수 없어 정정하지 않았습니다.",
      );
      return;
    }
    if (correctionReason.trim().length < 5) {
      setActionError("정정 사유를 5자 이상 입력해 주세요.");
      return;
    }
    const items = buildCommandItems(selected);
    if (!items) return;
    const pendingRequest = selected.requests.find(
      (request) =>
        request.status === "PENDING" &&
        request.versionId === selected.versionId &&
        request.gradeRevision === selected.gradeRevision,
    );
    await runAction(
      "correct",
      () =>
        correctOfficialGrade({
          config,
          headId: selected.headId,
          versionId: selected.versionId,
          expectedRevision: selected.revision,
          expectedGradeRevision: selected.gradeRevision,
          expectedSemesterRevision,
          items,
          reason: correctionReason,
          requestId: pendingRequest?.id,
          resolution: "CORRECT",
        }),
      "이전 버전을 보존한 새 정정 버전을 만들었습니다.",
    );
  };

  const rejectPendingRequest = async () => {
    if (!selected || !state?.manifestRevision) return;
    const pendingRequest = selected.requests.find(
      (request) =>
        request.status === "PENDING" &&
        request.versionId === selected.versionId &&
        request.gradeRevision === selected.gradeRevision,
    );
    if (!pendingRequest) return;
    if (correctionReason.trim().length < 5) {
      setActionError("요청을 받아들이기 어려운 이유를 5자 이상 입력해 주세요.");
      return;
    }
    await runAction(
      "reject-request",
      () =>
        correctOfficialGrade({
          config,
          headId: selected.headId,
          versionId: selected.versionId,
          expectedRevision: selected.revision,
          expectedGradeRevision: selected.gradeRevision,
          expectedSemesterRevision: state.manifestRevision || 0,
          items: [],
          reason: correctionReason,
          requestId: pendingRequest.id,
          resolution: "REJECT",
        }),
      "학생 확인 요청을 사유와 함께 기각했습니다.",
    );
  };

  if (userData?.role === "student") {
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

  if (state?.provenance === "LEGACY" && state.records.length === 0) {
    return <StatePanel state="LEGACY" readOnly />;
  }

  if (
    state?.provenance === "ARCHIVE" &&
    state.records.length === 0 &&
    state.pendingSources.length === 0 &&
    !state.nextCursor
  ) {
    return <StatePanel state="ARCHIVED" readOnly />;
  }

  if (
    !state ||
    (state.records.length === 0 &&
      state.pendingSources.length === 0 &&
      !state.nextCursor)
  ) {
    return (
      <StatePanel
        state="EMPTY"
        title={`${KIND_LABELS[scoreKind]} 성적 작업이 없습니다.`}
        description="제출 원본에서 성적 초안이 만들어지면 이곳에서 검토할 수 있습니다."
        action={{ label: "다시 불러오기", onClick: () => void loadState() }}
      />
    );
  }

  return (
    <section
      className="ws-grade-evidence"
      aria-label={`${KIND_LABELS[scoreKind]} 성적 근거 관리`}
    >
      <div className="ws-grade-evidence__context">
        <p>
          {state.year}학년도 {state.semester}학기 · {state.records.length}건
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

      {state.pendingSources.length > 0 && (
        <section
          className="ws-grade-evidence__list"
          aria-labelledby={`pending-grade-${scoreKind}`}
        >
          <header className="ws-grade-evidence__list-heading">
            <div className="ws-grade-evidence__section-heading">
              <h2 id={`pending-grade-${scoreKind}`}>성적 초안 생성 대기</h2>
              <span className="ws-grade-evidence__meta">
                제출 원본 {state.pendingSources.length}건
              </span>
            </div>
          </header>
          <ul className="ws-grade-evidence__list-items">
            {state.pendingSources.map((candidate) => (
              <li
                key={candidate.attemptId}
                className="ws-grade-evidence__candidate"
              >
                <div>
                  <strong className="ws-grade-evidence__record-title">
                    {candidate.studentName || "학생 정보 확인 필요"}
                  </strong>
                  <p className="ws-grade-evidence__meta">
                    {[candidate.enrollmentLabel, candidate.title]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <button
                  type="button"
                  className="ws-grade-evidence__button"
                  disabled={
                    state.readOnly ||
                    candidate.readOnly ||
                    Boolean(pendingAction)
                  }
                  onClick={() => void createDraftFromCandidate(candidate)}
                >
                  {pendingAction === `create-${candidate.attemptId}`
                    ? "초안 생성 중…"
                    : "성적 초안 만들기"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!selected && (actionMessage || actionError) && (
        <div aria-label="명령 처리 결과">
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
        </div>
      )}

      <div className="ws-grade-evidence__toolbar">
        <label
          className="ws-grade-evidence__label"
          htmlFor={`grade-search-${scoreKind}`}
        >
          학생·평가 검색
          <input
            id={`grade-search-${scoreKind}`}
            className="ws-grade-evidence__input"
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="이름, 반, 평가명"
          />
        </label>
        <button
          type="button"
          className="ws-grade-evidence__button"
          onClick={() => void loadState()}
        >
          최신 상태 불러오기
        </button>
        {state.nextCursor && (
          <button
            type="button"
            className="ws-grade-evidence__button"
            disabled={loadingNextPage}
            onClick={() => void loadState(state.nextCursor)}
          >
            {loadingNextPage ? "다음 목록 불러오는 중…" : "목록 더 보기"}
          </button>
        )}
      </div>

      {nextPageError && (
        <div aria-label="다음 목록 불러오기 오류">
          <p
            className="ws-grade-evidence__notice ws-grade-evidence__notice--error"
            role="alert"
          >
            {nextPageError}
          </p>
          <button
            type="button"
            className="ws-grade-evidence__button"
            disabled={loadingNextPage || !state.nextCursor}
            onClick={() => void loadState(state.nextCursor)}
          >
            다시 시도
          </button>
        </div>
      )}

      {state.records.length === 0 ? (
        <StatePanel
          state="EMPTY"
          compact
          title="아직 생성된 성적 초안이 없습니다."
          description="위 제출 원본에서 초안을 만든 뒤 항목별 점수를 검토해 주세요."
        />
      ) : filteredRecords.length === 0 ? (
        <StatePanel
          state="EMPTY"
          compact
          title="검색 결과가 없습니다."
          description="검색어를 바꾸거나 전체 목록을 확인해 주세요."
          action={{ label: "검색 초기화", onClick: () => setSearchText("") }}
        />
      ) : (
        <div className="ws-grade-evidence__workspace">
          <section
            className="ws-grade-evidence__list"
            aria-labelledby={`grade-list-${scoreKind}`}
          >
            <header className="ws-grade-evidence__list-heading">
              <h2 id={`grade-list-${scoreKind}`}>성적 작업 목록</h2>
            </header>
            <ul className="ws-grade-evidence__list-items">
              {filteredRecords.map((record) => (
                <li key={record.headId}>
                  <button
                    type="button"
                    className="ws-grade-evidence__record-button"
                    aria-current={record.headId === selectedSummary?.headId}
                    onClick={() => setSelectedHeadId(record.headId)}
                  >
                    <span className="ws-grade-evidence__record-title">
                      {record.studentName || "학생 정보 확인 필요"}
                    </span>
                    <span className="ws-grade-evidence__score-line">
                      <span className="ws-grade-evidence__meta">
                        {[record.enrollmentLabel, record.title]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <strong>
                        {formatScore(record.score)} /{" "}
                        {formatScore(record.maxScore)}
                      </strong>
                    </span>
                    <span className="ws-grade-evidence__meta">
                      {STATUS_LABELS[record.status]}
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
            <TeacherGradeDetail
              record={selected}
              readOnly={state.readOnly || selected.readOnly}
              pendingAction={pendingAction}
              actionMessage={actionMessage}
              actionError={actionError}
              itemDrafts={itemDrafts}
              setItemDraft={(itemId, field, value) =>
                setItemDrafts((current) => ({
                  ...current,
                  [itemId]: {
                    awardedScore: current[itemId]?.awardedScore || "",
                    reason: current[itemId]?.reason || "",
                    [field]: value,
                  },
                }))
              }
              lifecycleReason={lifecycleReason}
              setLifecycleReason={setLifecycleReason}
              correctionReason={correctionReason}
              setCorrectionReason={setCorrectionReason}
              onLifecycleAction={(action) =>
                void executeLifecycleAction(action)
              }
              onCorrection={() => void submitCorrection()}
              onRejectRequest={() => void rejectPendingRequest()}
            />
          )}
        </div>
      )}
    </section>
  );
};

interface TeacherGradeDetailProps {
  record: GradeEvidenceRecord;
  readOnly: boolean;
  pendingAction: string;
  actionMessage: string;
  actionError: string;
  itemDrafts: Record<string, { awardedScore: string; reason: string }>;
  setItemDraft: (
    itemId: string,
    field: "awardedScore" | "reason",
    value: string,
  ) => void;
  lifecycleReason: string;
  setLifecycleReason: (value: string) => void;
  correctionReason: string;
  setCorrectionReason: (value: string) => void;
  onLifecycleAction: (action: "review" | "finalize" | "publish") => void;
  onCorrection: () => void;
  onRejectRequest: () => void;
}

const TeacherGradeDetail: React.FC<TeacherGradeDetailProps> = ({
  record,
  readOnly,
  pendingAction,
  actionMessage,
  actionError,
  itemDrafts,
  setItemDraft,
  lifecycleReason,
  setLifecycleReason,
  correctionReason,
  setCorrectionReason,
  onLifecycleAction,
  onCorrection,
  onRejectRequest,
}) => {
  const actionDisabled = readOnly || Boolean(pendingAction);
  const currentAttestations = record.attestations.filter(
    (item) =>
      item.versionId === record.versionId &&
      item.gradeRevision === record.gradeRevision,
  );
  const signature = currentAttestations.find(
    (item) => item.kind === "SIGNATURE",
  );
  const acknowledgement = currentAttestations.find(
    (item) => item.kind === "ACKNOWLEDGEMENT",
  );
  const canReview =
    record.status === "DRAFT" ||
    record.status === "AUTO_EVALUATED_UNOFFICIAL" ||
    record.status === "TEACHER_REVIEW_REQUIRED";
  const canFinalize = record.status === "REVIEWED";
  const canPublish = record.status === "EVIDENCE_LOCKED";
  const canCorrect =
    record.status === "OFFICIAL_PENDING_SIGNATURE" ||
    record.status === "OFFICIAL" ||
    record.status === "CORRECTED";
  const canEditItems = !readOnly && (canReview || canCorrect);
  const pendingRequest = record.requests.find(
    (request) =>
      request.status === "PENDING" &&
      request.versionId === record.versionId &&
      request.gradeRevision === record.gradeRevision,
  );

  return (
    <article
      className={`ws-grade-evidence__detail ${readOnly ? "ws-grade-evidence__detail--readonly" : ""}`}
    >
      <header className="ws-grade-evidence__detail-header">
        <div className="ws-grade-evidence__score-line">
          <div>
            <h2>{record.studentName || "학생 정보 확인 필요"}</h2>
            <p className="ws-grade-evidence__meta">
              {[record.enrollmentLabel, record.title]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <span className="ws-grade-evidence__status">
            {STATUS_LABELS[record.status]}
          </span>
        </div>
        <div className="ws-grade-evidence__score-line">
          <strong className="ws-grade-evidence__score">
            {formatScore(record.score)} / {formatScore(record.maxScore)}
          </strong>
          <span className="ws-grade-evidence__meta">
            revision {record.revision}
          </span>
        </div>
      </header>

      <div className="ws-grade-evidence__detail-main">
        <section
          className="ws-grade-evidence__section"
          aria-labelledby={`teacher-evidence-${record.headId}`}
        >
          <div className="ws-grade-evidence__section-heading">
            <h3 id={`teacher-evidence-${record.headId}`}>채점 근거</h3>
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
                    {canEditItems ? (
                      <label className="ws-grade-evidence__inline-score">
                        <span className="ws-grade-evidence__meta">
                          부여 점수
                        </span>
                        <input
                          className="ws-grade-evidence__input"
                          type="number"
                          min="0"
                          max={item.maxScore ?? undefined}
                          step="0.001"
                          value={itemDrafts[item.id]?.awardedScore || ""}
                          disabled={actionDisabled}
                          aria-label={`${item.label} 부여 점수`}
                          onChange={(event) =>
                            setItemDraft(
                              item.id,
                              "awardedScore",
                              event.target.value,
                            )
                          }
                        />
                        <span>/ {formatScore(item.maxScore)}</span>
                      </label>
                    ) : (
                      <span>
                        {formatScore(item.score)} / {formatScore(item.maxScore)}
                      </span>
                    )}
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
                  {(item.sourceType || item.sourceRef) && (
                    <p className="ws-grade-evidence__meta">
                      {[item.sourceType, item.sourceRef]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {canEditItems && (
                    <label className="ws-grade-evidence__label">
                      항목별 채점 사유(선택)
                      <input
                        className="ws-grade-evidence__input"
                        type="text"
                        maxLength={500}
                        value={itemDrafts[item.id]?.reason || ""}
                        disabled={actionDisabled}
                        onChange={(event) =>
                          setItemDraft(item.id, "reason", event.target.value)
                        }
                      />
                    </label>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ws-grade-evidence__empty-copy">
              근거 항목이 없어 공식화할 수 없습니다. 원본 제출 상태를 확인해
              주세요.
            </p>
          )}
        </section>

        <section
          className="ws-grade-evidence__section"
          aria-labelledby={`teacher-requests-${record.headId}`}
        >
          <h3 id={`teacher-requests-${record.headId}`}>학생 확인 요청</h3>
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
                        ? `이전 점수 이력 · ${request.status}`
                        : request.status}
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
              학생 확인 요청이 없습니다.
            </p>
          )}
        </section>
      </div>

      {!readOnly && (
        <aside
          className="ws-grade-evidence__detail-aside"
          aria-label="성적 처리 명령"
        >
          <section
            className="ws-grade-evidence__form"
            aria-labelledby={`teacher-actions-${record.headId}`}
          >
            <h3 id={`teacher-actions-${record.headId}`}>공식화 단계</h3>
            <p className="ws-grade-evidence__meta">
              각 단계는 현재 revision을 확인한 뒤 감사 기록과 함께 실행됩니다.
            </p>
            {(canReview || canFinalize || canPublish) && (
              <label className="ws-grade-evidence__label">
                처리 사유
                <textarea
                  className="ws-grade-evidence__textarea"
                  value={lifecycleReason}
                  maxLength={500}
                  disabled={actionDisabled}
                  onChange={(event) => setLifecycleReason(event.target.value)}
                  placeholder="검토·잠금·공개 근거를 적어 주세요."
                />
              </label>
            )}
            <div className="ws-grade-evidence__actions">
              {canReview && (
                <button
                  type="button"
                  className="ws-grade-evidence__button ws-grade-evidence__button--primary"
                  disabled={
                    actionDisabled ||
                    record.evidence.length === 0 ||
                    lifecycleReason.trim().length < 5
                  }
                  onClick={() => onLifecycleAction("review")}
                >
                  {pendingAction === "review" ? "검토 반영 중…" : "검토 완료"}
                </button>
              )}
              {canFinalize && (
                <button
                  type="button"
                  className="ws-grade-evidence__button ws-grade-evidence__button--primary"
                  disabled={
                    actionDisabled ||
                    record.evidence.length === 0 ||
                    lifecycleReason.trim().length < 5
                  }
                  onClick={() => onLifecycleAction("finalize")}
                >
                  {pendingAction === "finalize" ? "근거 잠금 중…" : "근거 잠금"}
                </button>
              )}
              {canPublish && (
                <button
                  type="button"
                  className="ws-grade-evidence__button ws-grade-evidence__button--primary"
                  disabled={actionDisabled || lifecycleReason.trim().length < 5}
                  onClick={() => onLifecycleAction("publish")}
                >
                  {pendingAction === "publish" ? "공개 중…" : "학생 확인 요청"}
                </button>
              )}
            </div>
            {!canReview && !canFinalize && !canPublish && (
              <p className="ws-grade-evidence__notice">
                이 성적은 현재 단계에서 추가 공식화 명령이 필요하지 않습니다.
              </p>
            )}
          </section>

          <section
            className="ws-grade-evidence__section"
            aria-labelledby={`teacher-attestation-${record.headId}`}
          >
            <h3 id={`teacher-attestation-${record.headId}`}>확인·서명 상태</h3>
            <p className="ws-grade-evidence__meta">
              근거 확인: {acknowledgement ? "완료" : "대기"}
            </p>
            <p className="ws-grade-evidence__meta">
              본인 서명: {signature ? "완료" : "대기"}
              {signature?.signedAt
                ? ` · ${formatDate(signature.signedAt)}`
                : ""}
            </p>
            {record.attestations.length > currentAttestations.length && (
              <p className="ws-grade-evidence__meta">
                이전 점수 버전 확인·서명{" "}
                {record.attestations.length - currentAttestations.length}건은
                감사 이력으로 보존됩니다.
              </p>
            )}
          </section>

          {canCorrect && (
            <section
              className="ws-grade-evidence__form"
              aria-labelledby={`teacher-correction-${record.headId}`}
            >
              <h3 id={`teacher-correction-${record.headId}`}>공식 성적 정정</h3>
              <p className="ws-grade-evidence__meta">
                기존 공식 버전은 보존됩니다. 새 점수와 사유를 정확히 입력해
                주세요.
              </p>
              <label className="ws-grade-evidence__label">
                정정 사유
                <textarea
                  className="ws-grade-evidence__textarea"
                  value={correctionReason}
                  maxLength={500}
                  disabled={actionDisabled}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  placeholder="정정 근거와 변경 이유를 적어 주세요."
                />
              </label>
              <div className="ws-grade-evidence__actions">
                <button
                  type="button"
                  className="ws-grade-evidence__button ws-grade-evidence__button--primary"
                  disabled={
                    actionDisabled || correctionReason.trim().length < 5
                  }
                  onClick={onCorrection}
                >
                  {pendingAction === "correct"
                    ? "정정 반영 중…"
                    : pendingRequest
                      ? "요청 수용·새 정정 버전 만들기"
                      : "새 정정 버전 만들기"}
                </button>
                {pendingRequest && (
                  <button
                    type="button"
                    className="ws-grade-evidence__button"
                    disabled={
                      actionDisabled || correctionReason.trim().length < 5
                    }
                    onClick={onRejectRequest}
                  >
                    {pendingAction === "reject-request"
                      ? "요청 처리 중…"
                      : "요청 기각"}
                  </button>
                )}
              </div>
            </section>
          )}

          {(actionMessage || actionError) && (
            <section
              className="ws-grade-evidence__section"
              aria-label="명령 처리 결과"
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

export default GradeEvidenceManager;
