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
  SEMESTER_MANIFEST: "학기 Manifest",
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

const errorReason = (error: unknown) =>
  String(
    (error as { reason?: unknown })?.reason ||
      (error as { details?: { reason?: unknown } })?.details?.reason ||
      (error as { customData?: { reason?: unknown } })?.customData?.reason ||
      (error as { message?: unknown })?.message ||
      "W11_CUTOVER_REQUEST_FAILED",
  );

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
  const [busyAction, setBusyAction] = useState<CutoverActionId | "">("");

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
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
      setLoadError(errorReason(error));
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

  const runAction = async (action: CutoverActionId) => {
    if (!state?.plan || action === "CREATE_PLAN") return;
    setBusyAction(action);
    try {
      if (action === "DRY_RUN") {
        await dryRunSemesterCutover({
          planId: state.plan.planId,
          expectedPlanRevision: state.plan.planRevision,
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
        message: "서버 receipt와 최신 상태를 다시 확인합니다.",
      });
      await reload();
    } catch (error) {
      showToast({
        tone: "error",
        title: "합성 리허설 단계를 처리하지 못했습니다.",
        message: errorReason(error),
      });
    } finally {
      setBusyAction("");
    }
  };

  const sources = useMemo<CutoverSourceView[]>(() => {
    if (!state) return [];
    const rows: CutoverSourceView[] = [];
    if (state.plan) {
      rows.push({
        label: "Source",
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
      label: "Target",
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
        label: "Verified evidence",
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
    const rehearsalWritable = isSyntheticTarget && state?.readOnly === false;
    const common = (id: CutoverActionId, busy = busyAction === id) => ({
      id,
      busy,
    });
    return [
      {
        ...common("CREATE_PLAN"),
        label: "공식 계획 대기",
        description: "승인된 runner가 Gateway로 만든 계획만 사용합니다.",
        allowed: false,
        disabledReason: state?.plan?.planId
          ? "공식 runner가 만든 기존 계획을 사용합니다."
          : SUGGESTED_PLAN_REASON_LABELS[
              state?.suggestedPlanUnavailableReason || ""
            ] || "공식 runner가 Gateway receipt와 함께 계획을 준비합니다.",
        primary: true,
      },
      {
        ...common("DRY_RUN"),
        label: "드라이런",
        description: "canonical write 없이 snapshot을 비교합니다.",
        allowed:
          rehearsalWritable &&
          !!state?.plan &&
          ["CREATED", "BLOCKED"].includes(planStatus),
        disabledReason: rehearsalWritable
          ? "CREATED 또는 BLOCKED 계획이 필요합니다."
          : "예약된 합성 target에서만 실행할 수 있습니다.",
      },
      {
        ...common("APPLY_SYNTHETIC_BATCH"),
        label: "Operation evidence 맞추기",
        description: "기존 Domain command receipt와 operation 상태를 맞춥니다.",
        allowed:
          rehearsalWritable &&
          !!context &&
          pendingKeys.length > 0 &&
          ["DRY_RUN_PASSED", "APPLYING", "PARTIAL"].includes(attemptStatus),
        disabledReason:
          "먼저 기존 Domain command runner에서 합성 operation을 실행해야 합니다.",
      },
      {
        ...common("VERIFY"),
        label: "결과 검증",
        description: "count, join, hash와 activity 0을 확인합니다.",
        allowed: rehearsalWritable && !!context && attemptStatus === "APPLIED",
        disabledReason: "모든 적용 operation이 완료되어야 합니다.",
      },
      {
        ...common("RESUME"),
        label: "미완료 항목 복구",
        description: "실패·대기 item만 같은 ID로 복구합니다.",
        allowed:
          rehearsalWritable &&
          !!context &&
          recoverableKeys.length > 0 &&
          ["PARTIAL", "FAILED", "APPLYING"].includes(attemptStatus),
        disabledReason: "복구할 실패 또는 대기 항목이 없습니다.",
      },
      {
        ...common("CREATE_ROLLBACK_PLAN"),
        label: "Rollback plan 만들기",
        description: "자동 mutation 없는 수동 복구 순서만 기록합니다.",
        allowed:
          rehearsalWritable &&
          !!context &&
          ["APPLIED", "VERIFIED", "PARTIAL", "FAILED"].includes(attemptStatus),
        disabledReason: "rollback 계획의 기준이 될 실행 결과가 없습니다.",
      },
    ];
  }, [
    busyAction,
    context,
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
          resultItem?.errorReason ||
          (evidenceDiff?.status === "FAIL"
            ? `source ${evidenceDiff.sourceStatus}, target ${evidenceDiff.targetStatus}`
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
        evidence: `evidence ${state.evidence.evidenceId} · dependency ${state.evidence.dependencyHash}`,
      },
    ];
  }, [state]);

  const permission = loadError.includes("W11_ADMIN_REQUIRED");
  return (
    <SemesterCutoverCenterView
      status={
        loading
          ? "LOADING"
          : permission
            ? "PERMISSION"
            : loadError
              ? "ERROR"
              : state?.evidence &&
                  state.evidence.targetManifestRevision !==
                    state.manifestRevision
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
      writeCount={state?.writeCount ?? 0}
      onReload={() => void reload()}
      onAction={(action) => void runAction(action)}
    />
  );
};

export default SemesterCutoverCenter;
