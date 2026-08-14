import React from "react";
import ResponsiveDataContainer from "../../components/common/ResponsiveDataContainer";
import SemesterSourceSummary from "../../components/common/SemesterSourceSummary";
import StatePanel from "../../components/common/StatePanel";
import type { ProvenanceKind } from "../../constants/routeMetadata";
import "../../assets/semesterCutover.css";

export type CutoverActionId =
  | "CREATE_PLAN"
  | "DRY_RUN"
  | "APPLY_SYNTHETIC_BATCH"
  | "VERIFY"
  | "RESUME"
  | "CREATE_ROLLBACK_PLAN";

export interface CutoverSourceView {
  label: string;
  semesterId: string | null;
  provenance: ProvenanceKind;
  readOnly: boolean;
  status: string | null;
  revision: number | null;
  schemaVersion: number | null;
  description?: string;
}

export interface CutoverActionView {
  id: CutoverActionId;
  label: string;
  description: string;
  allowed: boolean;
  disabledReason?: string;
  busy?: boolean;
  locked?: boolean;
  primary?: boolean;
  group: "flow" | "recovery";
  tone?: "danger";
}

export interface CutoverDatasetView {
  id: string;
  label: string;
  operation: string;
  sourceCount: number | null;
  targetCount: number | null;
  orphanCount: number | null;
  duplicateCount: number | null;
  sourceHash?: string | null;
  targetHash?: string | null;
  status: string;
  detail?: string;
}

export interface CutoverReadinessView {
  checkId: string;
  label: string;
  required: boolean;
  status: string;
  evidence?: string;
}

export interface CutoverAttemptView {
  attemptId: string;
  phase: string;
  status: string;
  itemCount: number;
  succeededCount: number;
  failedCount: number;
  pendingCount: number;
  updatedAtLabel: string;
}

export interface SemesterCutoverCenterViewProps {
  status: "LOADING" | "CONTENT" | "EMPTY" | "ERROR" | "PERMISSION" | "STALE";
  reason?: string;
  sources: CutoverSourceView[];
  actions: CutoverActionView[];
  datasets: CutoverDatasetView[];
  readiness: CutoverReadinessView[];
  attempts: CutoverAttemptView[];
  selectedPlanLabel?: string;
  targetLabel: string;
  writeCount: number;
  onReload: () => void;
  onAction: (action: CutoverActionId) => void;
}

const STATUS_LABELS: Record<string, string> = {
  PASS: "통과",
  FAIL: "실패",
  FAILED: "실패",
  BLOCKED: "차단",
  STALE: "다시 확인 필요",
  READY: "실행 준비",
  RUNNING: "처리 중",
  PARTIAL: "일부 실패",
  SUCCEEDED: "완료",
  VERIFIED: "검증 완료",
  PENDING: "대기",
  NOT_APPLICABLE: "해당 없음",
  CREATED: "계획 생성됨",
  DRY_RUN_PASSED: "사전 비교 통과",
  APPLYING: "적용 확인 중",
  APPLIED: "적용 근거 확인",
  ROLLBACK_PLANNED: "복구 계획 기록됨",
};

const statusClassName = (status: string) =>
  `ws-cutover-status ws-cutover-status--${status.toLowerCase().split("_").join("-")}`;

const CutoverStatus: React.FC<{ status: string }> = ({ status }) => (
  <span className={statusClassName(status)}>
    {STATUS_LABELS[status] || status}
  </span>
);

const compactHash = (value?: string | null) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "없음";
  return normalized.length > 16
    ? `${normalized.slice(0, 8)}…${normalized.slice(-6)}`
    : normalized;
};

const SemesterCutoverCenterView: React.FC<SemesterCutoverCenterViewProps> = ({
  status,
  reason,
  sources,
  actions,
  datasets,
  readiness,
  attempts,
  selectedPlanLabel,
  targetLabel,
  writeCount,
  onReload,
  onAction,
}) => {
  if (status === "LOADING") {
    return (
      <StatePanel
        state="LOADING"
        title="학기 전환 준비 상태를 불러오고 있습니다."
        description="조회 중에는 계획이나 합성 데이터가 변경되지 않습니다."
      />
    );
  }

  if (status === "PERMISSION") {
    return (
      <StatePanel
        state="PERMISSION"
        title="학기 전환 준비 화면을 볼 권한이 없습니다."
        description={reason || "관리자 계정으로 다시 확인해 주세요."}
        contactAdmin
      />
    );
  }

  if (status === "ERROR") {
    return (
      <StatePanel
        state="ERROR"
        title="학기 전환 준비 상태를 불러오지 못했습니다."
        description={reason || "잠시 뒤 다시 불러와 주세요."}
        retryable
        action={{ label: "다시 불러오기", onClick: onReload }}
      />
    );
  }

  return (
    <div className="ws-cutover-page">
      <section
        className="ws-cutover-scope"
        aria-labelledby="cutover-scope-title"
      >
        <div className="ws-cutover-scope__copy">
          <h2 id="cutover-scope-title">Dedicated Staging 합성 리허설</h2>
          <p>
            이 화면은 학기 전환 계획과 검증 근거만 다룹니다. Production 활성화와
            Maintenance 변경 기능은 제공하지 않습니다.
          </p>
        </div>
        <div className="ws-cutover-scope__flags" aria-label="안전 범위">
          <span className="ws-cutover-flag">대상 {targetLabel}</span>
          <span className="ws-cutover-flag">Production 작업 0</span>
          <span className="ws-cutover-flag">활성화 제어 0</span>
          <span className="ws-cutover-flag">조회 중 쓰기 {writeCount}</span>
        </div>
      </section>

      {sources.length > 0 && (
        <div className="ws-cutover-context-grid" aria-label="학기 출처 비교">
          {sources.map((source) => (
            <SemesterSourceSummary
              key={`${source.label}-${source.semesterId || source.provenance}`}
              {...source}
              audience="operator"
            />
          ))}
        </div>
      )}

      {status === "STALE" && (
        <StatePanel
          state="STALE"
          title="선택한 기준이 최신 학기 정보와 다릅니다."
          description={
            reason || "최신 상태를 다시 불러온 뒤 preview를 확인해 주세요."
          }
          retryable
          action={{ label: "최신 상태 불러오기", onClick: onReload }}
          compact
        />
      )}

      <section
        className="ws-cutover-section ws-cutover-section--actions"
        aria-labelledby="cutover-actions-title"
      >
        <div className="ws-cutover-section__heading">
          <div>
            <h2 id="cutover-actions-title">리허설 단계</h2>
            <p>
              계획과 드라이런을 먼저 확인하고, 서버가 허용한 합성 작업만
              명시적으로 실행합니다.
            </p>
          </div>
          {selectedPlanLabel && <CutoverStatus status={selectedPlanLabel} />}
        </div>
        <div className="ws-cutover-actions">
          {actions
            .filter((action) => action.group === "flow")
            .map((action) => (
              <button
                key={action.id}
                type="button"
                className={`ws-cutover-action${action.primary ? " ws-cutover-action--primary" : ""}${action.busy ? " is-busy" : ""}`}
                disabled={!action.allowed || action.locked}
                title={!action.allowed ? action.disabledReason : undefined}
                aria-label={`${action.label}. ${action.description}`}
                aria-busy={action.busy || undefined}
                onClick={() => onAction(action.id)}
              >
                <strong>{action.busy ? "처리 중" : action.label}</strong>
                <span>{action.description}</span>
              </button>
            ))}
        </div>
        <div className="ws-cutover-recovery">
          <h3>문제가 있을 때</h3>
          <p>
            일반 진행과 분리된 복구 작업입니다. 최신 상태를 확인한 뒤
            실행하세요.
          </p>
          <div className="ws-cutover-actions ws-cutover-actions--recovery">
            {actions
              .filter((action) => action.group === "recovery")
              .map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={`ws-cutover-action${action.tone === "danger" ? " ws-cutover-action--danger" : ""}${action.busy ? " is-busy" : ""}`}
                  disabled={!action.allowed || action.locked}
                  title={!action.allowed ? action.disabledReason : undefined}
                  aria-label={`${action.label}. ${action.description}`}
                  aria-busy={action.busy || undefined}
                  onClick={() => onAction(action.id)}
                >
                  <strong>{action.busy ? "처리 중" : action.label}</strong>
                  <span>{action.description}</span>
                </button>
              ))}
          </div>
        </div>
        {actions.some((action) => !action.allowed && action.disabledReason) && (
          <ul className="ws-cutover-action-notes" aria-label="비활성 단계 안내">
            {actions
              .filter((action) => !action.allowed && action.disabledReason)
              .map((action) => (
                <li key={action.id}>
                  <strong>{action.label}</strong>: {action.disabledReason}
                </li>
              ))}
          </ul>
        )}
      </section>

      <section
        className="ws-cutover-section ws-cutover-section--readiness"
        aria-labelledby="cutover-readiness-title"
      >
        <div className="ws-cutover-section__heading">
          <div>
            <h2 id="cutover-readiness-title">준비도와 차단 항목</h2>
            <p>필수 검증 결과와 지금 해결해야 할 문제를 먼저 확인합니다.</p>
          </div>
        </div>
        {readiness.length === 0 ? (
          <p className="ws-cutover-empty">아직 준비도 검증 결과가 없습니다.</p>
        ) : (
          <ul className="ws-cutover-result-list">
            {readiness.map((check) => (
              <li key={check.checkId}>
                <div>
                  <strong>{check.label}</strong>
                  <span>
                    {check.required ? "필수" : "참고"} · {check.checkId}
                  </span>
                  {check.evidence && <p>{check.evidence}</p>}
                </div>
                <CutoverStatus status={check.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="ws-cutover-section ws-cutover-section--datasets"
        aria-labelledby="cutover-dataset-title"
      >
        <div className="ws-cutover-section__heading">
          <div>
            <h2 id="cutover-dataset-title">데이터 비교</h2>
            <p>원본과 대상의 건수, 연결 상태, 해시 차이를 확인합니다.</p>
          </div>
        </div>
        {datasets.length === 0 ? (
          <p className="ws-cutover-empty">
            아직 비교 결과가 없습니다. 계획을 선택하고 사전 비교를 실행해
            주세요.
          </p>
        ) : (
          <ResponsiveDataContainer label="학기 전환 데이터 비교 표">
            <table className="ws-cutover-table">
              <thead>
                <tr>
                  <th scope="col">영역과 상태</th>
                  <th scope="col">작업</th>
                  <th scope="col">원본</th>
                  <th scope="col">대상</th>
                  <th scope="col">연결 끊김</th>
                  <th scope="col">중복</th>
                  <th scope="col">해시</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((dataset) => (
                  <tr key={dataset.id}>
                    <td>
                      <strong>{dataset.label}</strong>
                      <CutoverStatus status={dataset.status} />
                      {dataset.detail && <div>{dataset.detail}</div>}
                    </td>
                    <td>{dataset.operation}</td>
                    <td>{dataset.sourceCount ?? "미확인"}</td>
                    <td>{dataset.targetCount ?? "미확인"}</td>
                    <td>{dataset.orphanCount ?? "미확인"}</td>
                    <td>{dataset.duplicateCount ?? "미확인"}</td>
                    <td>
                      {compactHash(dataset.sourceHash)} →{" "}
                      {compactHash(dataset.targetHash)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveDataContainer>
        )}
      </section>

      <section
        className="ws-cutover-section ws-cutover-section--attempts"
        aria-labelledby="cutover-attempt-title"
      >
        <div className="ws-cutover-section__heading">
          <div>
            <h2 id="cutover-attempt-title">최근 합성 실행</h2>
            <p>응답이 끊겨도 같은 항목 ID와 실행 근거를 사용해 복구합니다.</p>
          </div>
        </div>
        {attempts.length === 0 ? (
          <p className="ws-cutover-empty">기록된 합성 실행이 없습니다.</p>
        ) : (
          <ResponsiveDataContainer label="최근 합성 실행 결과 표">
            <table className="ws-cutover-table">
              <thead>
                <tr>
                  <th scope="col">단계</th>
                  <th scope="col">실행 ID</th>
                  <th scope="col">전체</th>
                  <th scope="col">완료</th>
                  <th scope="col">실패</th>
                  <th scope="col">대기</th>
                  <th scope="col">갱신</th>
                  <th scope="col">상태</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.attemptId}>
                    <td>{attempt.phase}</td>
                    <td>{attempt.attemptId}</td>
                    <td>{attempt.itemCount}</td>
                    <td>{attempt.succeededCount}</td>
                    <td>{attempt.failedCount}</td>
                    <td>{attempt.pendingCount}</td>
                    <td>{attempt.updatedAtLabel}</td>
                    <td>
                      <CutoverStatus status={attempt.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveDataContainer>
        )}
      </section>
    </div>
  );
};

export default SemesterCutoverCenterView;
