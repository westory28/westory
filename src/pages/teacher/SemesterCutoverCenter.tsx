import React, { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppToast } from "../../components/common/AppToastProvider";
import {
  applySemesterCutoverBatch,
  createSemesterRollbackPlan,
  dryRunSemesterCutover,
  getSemesterCutoverState,
  resumeSemesterCutover,
  verifySemesterCutover,
  type SemesterCutoverState,
  type CutoverItem,
  type CutoverOperation,
} from "../../lib/semesterCutover";
import SemesterCutoverCenterView, {
  type CutoverActionId,
  type CutoverActionView,
  type CutoverDatasetView,
  type CutoverReadinessView,
  type CutoverSourceView,
} from "./SemesterCutoverCenterView";

const CANONICAL_TARGET_SEMESTER_ID = "2026-2";
const SYNTHETIC_REHEARSAL_TARGET_SEMESTER_ID = "2098-2";

const OPERATION_LABELS: Record<string, string> = {
  SEMESTER_MANIFEST: "학기 기준 정보",
  SEMESTER_SETTINGS: "학기 설정",
  SEMESTER_CLASSES: "학급",
  SEMESTER_ENROLLMENTS: "학적",
  ASSESSMENT_DEFINITIONS: "평가 정의",
  GRADE_MASTER: "성적 기준",
  LEARNING_CONTENT: "학습 콘텐츠",
  SCHEDULE_EVENTS: "일정",
  NOTICE_TEMPLATES: "공지 템플릿",
  WIS_CATALOG_REFERENCE: "위스 상품 기준",
  WIS_ECONOMY: "위스 학기 운영",
  WIS_ACCOUNTS: "위스 계정",
};

const SUGGESTED_PLAN_REASON_LABELS: Record<string, string> = {
  CANONICAL_TARGET_QUERY_ONLY:
    "실제 학기는 조회만 할 수 있습니다. 합성 계획을 만들 수 없습니다.",
  REHEARSAL_MANIFESTS_REQUIRED:
    "예약된 source와 target의 합성 학기 manifest가 모두 필요합니다.",
  REHEARSAL_LIFECYCLE_INVALID:
    "합성 source와 target의 학기 상태가 리허설 조건에 맞지 않습니다.",
  APPROVED_CHILD_COMMAND_BLUEPRINT_REQUIRED:
    "승인된 Domain command blueprint가 아직 준비되지 않았습니다.",
  PLAN_ALREADY_EXISTS: "이미 생성된 합성 계획을 사용합니다.",
};

const OPERATOR_ERROR_MESSAGES: Array<[RegExp, string]> = [
  [
    /W11_(ADMIN|PREPARING_ADMIN)_REQUIRED/u,
    "관리자 권한과 최근 인증 상태를 확인한 뒤 다시 시도해 주세요.",
  ],
  [
    /W11_(PLAN|ATTEMPT)_REVISION_CONFLICT|W11_.*MISMATCH/u,
    "계획이나 학기 정보가 바뀌었습니다. 최신 상태를 불러온 뒤 다시 확인해 주세요.",
  ],
  [
    /W11_(PROJECT_FORBIDDEN|TARGET_READ_ONLY)/u,
    "이 작업은 Dedicated Staging의 예약된 합성 학기에서만 실행할 수 있습니다.",
  ],
  [
    /W11_(DRY_RUN_DIFF|VERIFY_DIFF|ACTIVITY_ZERO_REQUIRED|ITEMS_NOT_COMPLETE)/u,
    "비교 결과에 차단 항목이 남아 있습니다. 데이터 비교와 준비도 결과를 확인해 주세요.",
  ],
  [
    /W11_(CHILD_RECEIPT|RECEIPT_OPERATION)/u,
    "적용 작업의 실행 근거가 서로 맞지 않습니다. 서버 실행 기록을 다시 확인해 주세요.",
  ],
  [
    /W11_(PLAN|ATTEMPT)_STATE_INVALID|W11_RESUME_ITEM_INVALID/u,
    "현재 단계에서는 이 작업을 실행할 수 없습니다. 리허설 순서와 최신 상태를 확인해 주세요.",
  ],
  [
    /W11_(RESOURCE_NOT_FOUND|ITEM_NOT_FOUND)/u,
    "필요한 계획이나 실행 기록을 찾지 못했습니다. 최신 상태를 다시 불러와 주세요.",
  ],
  [
    /W11_(ROLLBACK_NOT_REQUIRED|ROLLBACK_TARGET_MISSING)/u,
    "되돌릴 성공 항목이나 안전한 복구 기준이 없습니다. 실행 결과와 대상 데이터를 다시 확인해 주세요.",
  ],
  [
    /W11_SNAPSHOT_OVERFLOW/u,
    "비교할 데이터가 안전한 처리 범위를 넘었습니다. 데이터를 나누어 준비해 주세요.",
  ],
];

const errorReason = (error: unknown) =>
  String(
    (error as { reason?: unknown })?.reason ||
      (error as { details?: { reason?: unknown } })?.details?.reason ||
      (error as { customData?: { reason?: unknown } })?.customData?.reason ||
      (error as { message?: unknown })?.message ||
      "W11_CUTOVER_REQUEST_FAILED",
  );

const operatorErrorMessage = (error: unknown) => {
  const reason = errorReason(error);
  return (
    OPERATOR_ERROR_MESSAGES.find(([pattern]) => pattern.test(reason))?.[1] ||
    "요청을 처리하지 못했습니다. 최신 상태를 다시 불러온 뒤 한 단계씩 진행해 주세요."
  );
};

const formatTimestamp = (value: unknown) => {
  const date =
    typeof (value as { toDate?: unknown })?.toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : new Date(String(value || ""));
  return Number.isNaN(date.getTime())
    ? "기록됨"
    : new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
};

const isCutoverItem = (
  value: CutoverItem | CutoverOperation,
): value is CutoverItem => "itemId" in value;

const SemesterCutoverCenter: React.FC = () => {
  const { showToast } = useAppToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const targetSemesterId =
    searchParams.get("target") === SYNTHETIC_REHEARSAL_TARGET_SEMESTER_ID
      ? SYNTHETIC_REHEARSAL_TARGET_SEMESTER_ID
      : CANONICAL_TARGET_SEMESTER_ID;
  const isSyntheticTarget =
    targetSemesterId === SYNTHETIC_REHEARSAL_TARGET_SEMESTER_ID;
  const [state, setState] = useState<SemesterCutoverState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [permissionError, setPermissionError] = useState(false);
  const [busyAction, setBusyAction] = useState<CutoverActionId | "">("");
  const actionInFlightRef = React.useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setPermissionError(false);
    try {
      const next = await getSemesterCutoverState({
        targetSemesterId,
        planId: searchParams.get("plan") || undefined,
        attemptId: searchParams.get("attempt") || undefined,
      });
      setState(next);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("target", targetSemesterId);
      if (next.plan?.planId) nextParams.set("plan", next.plan.planId);
      if (next.attempt?.attemptId)
        nextParams.set("attempt", next.attempt.attemptId);
      if (nextParams.toString() !== searchParams.toString()) {
        setSearchParams(nextParams, { replace: true });
      }
    } catch (error) {
      setPermissionError(
        /W11_(ADMIN|PREPARING_ADMIN)_REQUIRED/u.test(errorReason(error)),
      );
      setLoadError(operatorErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [searchParams, setSearchParams, targetSemesterId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const context =
    state?.plan && state.attempt
      ? {
          planId: state.plan.planId,
          attemptId: state.attempt.attemptId,
          expectedPlanRevision: state.plan.planRevision,
          expectedAttemptRevision: state.attempt.attemptRevision,
        }
      : null;
  const pendingKeys =
    state?.items
      .filter((item) => item.status === "PENDING")
      .map((item) => item.operationKey) || [];
  const recoverableKeys =
    state?.items
      .filter((item) => ["FAILED", "PENDING"].includes(item.status))
      .map((item) => item.operationKey) || [];
  const evidenceStale = Boolean(
    (state?.plan &&
      state.plan.targetManifestRevision !== state.manifestRevision) ||
    (state?.evidence &&
      state.evidence.targetManifestRevision !== state.manifestRevision),
  );

  const runAction = async (action: CutoverActionId) => {
    if (!state?.plan || action === "CREATE_PLAN" || actionInFlightRef.current)
      return;
    if (evidenceStale) {
      showToast({
        tone: "error",
        title: "최신 학기 정보를 먼저 확인해 주세요.",
        message: "현재 근거의 revision이 대상 학기와 달라 작업을 차단했습니다.",
      });
      return;
    }
    actionInFlightRef.current = true;
    setBusyAction(action);
    try {
      if (action === "DRY_RUN") {
        const expectedAttemptRevision =
          state.plan.status === "BLOCKED"
            ? state.attempt?.attemptRevision
            : undefined;
        if (
          state.plan.status === "BLOCKED" &&
          !Number.isSafeInteger(expectedAttemptRevision)
        ) {
          showToast({
            tone: "error",
            title: "차단된 실행 기록을 다시 확인해 주세요.",
            message:
              "재시도에 필요한 실행 revision이 없어 사전 비교를 시작하지 않았습니다.",
          });
          return;
        }
        await dryRunSemesterCutover({
          planId: state.plan.planId,
          expectedPlanRevision: state.plan.planRevision,
          ...(expectedAttemptRevision !== undefined
            ? { expectedAttemptRevision }
            : {}),
        });
      } else if (action === "APPLY_SYNTHETIC_BATCH" && context) {
        await applySemesterCutoverBatch({
          ...context,
          operationKeys: pendingKeys.slice(0, 25),
        });
      } else if (action === "VERIFY" && context) {
        await verifySemesterCutover(context);
      } else if (action === "RESUME" && context) {
        await resumeSemesterCutover({
          ...context,
          operationKeys: recoverableKeys.slice(0, 25),
          reason:
            "관리자 합성 리허설 화면에서 미완료 operation을 명시적으로 복구",
        });
      } else if (action === "CREATE_ROLLBACK_PLAN" && context) {
        await createSemesterRollbackPlan({
          ...context,
          reason: "합성 학기 전환 리허설의 수동 복구 순서를 기록",
        });
      } else {
        return;
      }
      showToast({
        tone: "success",
        title: "합성 리허설 단계를 처리했습니다.",
        message: "서버 실행 근거와 최신 상태를 다시 확인합니다.",
      });
      await reload();
    } catch (error) {
      showToast({
        tone: "error",
        title: "합성 리허설 단계를 처리하지 못했습니다.",
        message: operatorErrorMessage(error),
      });
    } finally {
      actionInFlightRef.current = false;
      setBusyAction("");
    }
  };

  const sources = useMemo<CutoverSourceView[]>(() => {
    if (!state) return [];
    const rows: CutoverSourceView[] = [];
    if (state.plan) {
      rows.push({
        label: "원본 학기",
        semesterId: state.plan.sourceSemesterId,
        provenance:
          state.plan.sourceStatus === "ARCHIVED" ? "ARCHIVE" : "CURRENT",
        readOnly: true,
        status: state.plan.sourceStatus || null,
        revision: state.plan.sourceManifestRevision,
        schemaVersion: state.schemaVersion,
        description:
          "리허설의 기준 snapshot입니다. 이 화면에서 수정하지 않습니다.",
      });
    }
    rows.push({
      label: "대상 학기",
      semesterId: state.targetSemesterId,
      provenance: state.provenance,
      readOnly: state.readOnly,
      status: state.manifestStatus,
      revision: state.manifestRevision,
      schemaVersion: state.schemaVersion,
      description: isSyntheticTarget
        ? "Dedicated Staging의 예약된 합성 target입니다."
        : "실제 학기 상태를 변경하지 않고 조회만 하는 기준 target입니다.",
    });
    if (state.evidence) {
      rows.push({
        label: "검증 근거",
        semesterId: state.targetSemesterId,
        provenance: "EXPLICIT",
        readOnly: true,
        status: state.evidence.status,
        revision: state.evidence.targetManifestRevision,
        schemaVersion: state.schemaVersion,
        description: "검증 당시 target revision에 고정된 읽기 전용 근거입니다.",
      });
    }
    return rows;
  }, [isSyntheticTarget, state]);

  const actions = useMemo<CutoverActionView[]>(() => {
    const planStatus = state?.plan?.status || "";
    const attemptStatus = state?.attempt?.status || "";
    const rehearsalWritable =
      isSyntheticTarget && state?.readOnly === false && !evidenceStale;
    const common = (id: CutoverActionId, busy = busyAction === id) => ({
      id,
      busy,
      locked: Boolean(busyAction),
    });
    const nextActions: CutoverActionView[] = [
      {
        ...common("CREATE_PLAN"),
        label: "계획 준비 상태",
        description: "승인된 서버 리허설에서 만든 계획만 사용합니다.",
        allowed: false,
        disabledReason: state?.plan?.planId
          ? "공식 runner가 만든 기존 계획을 사용합니다."
          : SUGGESTED_PLAN_REASON_LABELS[
              state?.suggestedPlanUnavailableReason || ""
            ] || "공식 리허설이 서버 실행 근거와 함께 계획을 준비합니다.",
        group: "flow",
      },
      {
        ...common("DRY_RUN"),
        label: "사전 비교 실행",
        description: "실제 데이터를 쓰지 않고 source와 target을 비교합니다.",
        allowed:
          rehearsalWritable &&
          !!state?.plan &&
          (planStatus === "CREATED" ||
            (planStatus === "BLOCKED" && attemptStatus === "BLOCKED")),
        disabledReason: evidenceStale
          ? "대상 학기의 최신 revision을 다시 확인해야 합니다."
          : rehearsalWritable
            ? "생성됨 또는 차단 상태의 계획이 필요합니다."
            : "예약된 합성 target에서만 실행할 수 있습니다.",
        group: "flow",
      },
      {
        ...common("APPLY_SYNTHETIC_BATCH"),
        label: "적용 근거 맞추기",
        description: "기존 도메인 명령의 실행 근거와 작업 상태를 맞춥니다.",
        allowed:
          rehearsalWritable &&
          !!context &&
          pendingKeys.length > 0 &&
          ["DRY_RUN_PASSED", "APPLYING", "PARTIAL"].includes(attemptStatus),
        disabledReason: evidenceStale
          ? "대상 학기의 최신 revision을 다시 확인해야 합니다."
          : "먼저 기존 도메인 명령 runner에서 합성 작업을 실행해야 합니다.",
        group: "flow",
      },
      {
        ...common("VERIFY"),
        label: "결과 검증",
        description: "건수, 연결, hash와 새 활동 0건을 확인합니다.",
        allowed: rehearsalWritable && !!context && attemptStatus === "APPLIED",
        disabledReason: evidenceStale
          ? "대상 학기의 최신 revision을 다시 확인해야 합니다."
          : "모든 적용 작업이 완료되어야 합니다.",
        group: "flow",
      },
      {
        ...common("RESUME"),
        label: "미완료 항목 복구",
        description: "실패하거나 대기 중인 항목만 같은 ID로 다시 처리합니다.",
        allowed:
          rehearsalWritable &&
          !!context &&
          recoverableKeys.length > 0 &&
          ["PARTIAL", "FAILED", "APPLYING"].includes(attemptStatus),
        disabledReason: evidenceStale
          ? "대상 학기의 최신 revision을 다시 확인해야 합니다."
          : "복구할 실패 또는 대기 항목이 없습니다.",
        group: "recovery",
      },
      {
        ...common("CREATE_ROLLBACK_PLAN"),
        label: "복구 계획 기록",
        description:
          "실제 데이터를 되돌리지 않고 운영자가 확인할 수동 복구 순서만 기록합니다.",
        allowed:
          rehearsalWritable &&
          !!context &&
          ["APPLIED", "VERIFIED", "PARTIAL", "FAILED"].includes(attemptStatus),
        disabledReason: evidenceStale
          ? "대상 학기의 최신 revision을 다시 확인해야 합니다."
          : "복구 계획의 기준이 될 실행 결과가 없습니다.",
        group: "recovery",
        tone: "danger",
      },
    ];
    const primaryAction = nextActions.find(
      (action) => action.group === "flow" && action.allowed,
    );
    return nextActions.map((action) => ({
      ...action,
      primary: action.id === primaryAction?.id,
    }));
  }, [
    busyAction,
    context,
    evidenceStale,
    isSyntheticTarget,
    pendingKeys.length,
    recoverableKeys.length,
    state,
  ]);

  const datasets = useMemo<CutoverDatasetView[]>(() => {
    const evidenceDiffs = new Map(
      (state?.evidence?.diffs || []).map((diff) => [diff.operationKey, diff]),
    );
    return (
      state?.items.length ? state.items : state?.plan?.operations || []
    ).map((item) => {
      const resultItem = isCutoverItem(item) ? item : null;
      const evidenceDiff = evidenceDiffs.get(item.operationKey);
      return {
        id: item.operationKey,
        label: OPERATION_LABELS[item.operationType] || item.operationType,
        operation: item.strategy || "확인",
        sourceCount:
          evidenceDiff?.actualSource.count ??
          resultItem?.dryRun?.actualSource?.count ??
          item.sourceSnapshot.count,
        targetCount:
          evidenceDiff?.actualTarget.count ??
          resultItem?.dryRun?.actualTargetBefore?.count ??
          item.targetBeforeSnapshot.count,
        orphanCount: null,
        duplicateCount: null,
        sourceHash:
          evidenceDiff?.actualSource.hash ??
          resultItem?.dryRun?.actualSource?.hash ??
          item.sourceSnapshot.hash,
        targetHash:
          evidenceDiff?.actualTarget.hash ??
          resultItem?.dryRun?.actualTargetBefore?.hash ??
          item.targetBeforeSnapshot.hash,
        status:
          evidenceDiff?.status ||
          (resultItem
            ? resultItem.status
            : item.applicable
              ? "PENDING"
              : "NOT_APPLICABLE"),
        detail:
          (resultItem?.errorReason
            ? operatorErrorMessage({ reason: resultItem.errorReason })
            : undefined) ||
          (evidenceDiff?.status === "FAIL"
            ? `원본 상태 ${evidenceDiff.sourceStatus} · 대상 상태 ${evidenceDiff.targetStatus}`
            : undefined),
      };
    });
  }, [state]);

  const readiness = useMemo<CutoverReadinessView[]>(() => {
    if (!state?.evidence) return [];
    return [
      {
        checkId: "semester_cutover_readiness",
        label: "학기 전환 검증 근거",
        required: true,
        status:
          state.evidence.status === "PASS" &&
          state.evidence.targetManifestRevision === state.manifestRevision
            ? "PASS"
            : "STALE",
        evidence: `검증 근거 ID ${state.evidence.evidenceId} · 의존성 해시 ${state.evidence.dependencyHash}`,
      },
    ];
  }, [state]);

  return (
    <SemesterCutoverCenterView
      status={
        loading
          ? "LOADING"
          : permissionError
            ? "PERMISSION"
            : loadError
              ? "ERROR"
              : evidenceStale
                ? "STALE"
                : state?.plan
                  ? "CONTENT"
                  : "EMPTY"
      }
      reason={loadError || undefined}
      sources={sources}
      actions={actions}
      datasets={datasets}
      readiness={readiness}
      attempts={
        state?.attempt
          ? [
              {
                attemptId: state.attempt.attemptId,
                phase: state.attempt.status,
                status: state.attempt.status,
                itemCount: state.attempt.operationCount,
                succeededCount: state.attempt.succeededCount,
                failedCount: state.attempt.failedCount,
                pendingCount: state.attempt.pendingCount,
                updatedAtLabel: formatTimestamp(state.attempt.updatedAt),
              },
            ]
          : []
      }
      selectedPlanLabel={state?.plan?.status}
      targetLabel={`${targetSemesterId}${isSyntheticTarget ? " · 합성 리허설" : " · 조회 전용"}`}
      writeCount={state?.writeCount ?? 0}
      onReload={() => void reload()}
      onAction={(action) => void runAction(action)}
    />
  );
};

export default SemesterCutoverCenter;
