import React from "react";
import ProvenanceBadge from "../../components/common/ProvenanceBadge";
import ResponsiveDataContainer from "../../components/common/ResponsiveDataContainer";
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
  ACTIVE: "운영 중",
  ARCHIVED: "보관됨",
  PREPARING: "준비 중",
  PARTIAL_SHELL: "일부 화면만 준비됨",
  DRAFT: "준비 중",
};

const statusClassName = (status: string) =>
  `ws-cutover-status ws-cutover-status--${status.toLowerCase().split("_").join("-")}`;

const CutoverStatus: React.FC<{ status: string }> = ({ status }) => (
  <span className={statusClassName(status)}>
    {STATUS_LABELS[status] || "확인 필요"}
  </span>
);

const statusLabel = (status?: string | null) =>
  STATUS_LABELS[String(status || "")] || "확인 필요";

const contentComparisonLabel = (
  sourceHash?: string | null,
  targetHash?: string | null,
) => {
  if (!sourceHash || !targetHash) return "비교값을 아직 확인하지 못했습니다.";
  return sourceHash === targetHash
    ? "현재 학기와 준비 학기의 내용이 일치합니다."
    : "현재 학기와 준비 학기의 내용이 다릅니다.";
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
          <h2 id="cutover-scope-title">전용 검증 환경 합성 리허설</h2>
          <p>
            이 화면은 학기 전환 계획과 검증 근거만 다룹니다. 운영 학기 활성화와
            점검 모드 변경 기능은 제공하지 않습니다.
          </p>
        </div>
        <div className="ws-cutover-scope__flags" aria-label="안전 범위">
          <span className="ws-cutover-flag">준비 학기 {targetLabel}</span>
          <span className="ws-cutover-flag">운영 환경 변경 없음</span>
          <span className="ws-cutover-flag">활성화 기능 없음</span>
          <span className="ws-cutover-flag">조회 중 저장 {writeCount}건</span>
        </div>
      </section>

      {sources.length > 0 && (
        <div className="ws-cutover-context-grid" aria-label="학기 출처 비교">
          {sources.map((source) => (
            <section
              key={`${source.label}-${source.semesterId || source.provenance}`}
              className={`ws-semester-source ws-semester-source--${source.provenance.toLowerCase()}`}
              aria-label={source.label}
            >
              <div className="ws-semester-source__heading">
                <div>
                  <p className="ws-semester-source__label">{source.label}</p>
                  <h2>{source.semesterId || "학기 정보 없음"}</h2>
                </div>
                <ProvenanceBadge
                  value={source.provenance}
                  readOnly={source.readOnly}
                />
              </div>
              {source.description && (
                <p className="ws-semester-source__description">
                  {source.description}
                </p>
              )}
              {source.status && <CutoverStatus status={source.status} />}
              <details className="ws-cutover-evidence">
                <summary>기술 근거 보기</summary>
                <dl className="ws-semester-source__metadata">
                  <div>
                    <dt>표시 상태</dt>
                    <dd>{statusLabel(source.status)}</dd>
                  </div>
                  <div>
                    <dt>기준 버전</dt>
                    <dd>
                      {Number.isFinite(source.revision)
                        ? source.revision
                        : "확인되지 않음"}
                    </dd>
                  </div>
                  <div>
                    <dt>자료 구조 버전</dt>
                    <dd>
                      {Number.isFinite(source.schemaVersion)
                        ? source.schemaVersion
                        : "확인되지 않음"}
                    </dd>
                  </div>
                </dl>
              </details>
            </section>
          ))}
        </div>
      )}

      {status === "STALE" && (
        <StatePanel
          state="STALE"
          title="선택한 기준이 최신 학기 정보와 다릅니다."
          description={
            reason || "최신 상태를 다시 불러온 뒤 미리보기를 확인해 주세요."
          }
          retryable
          action={{ label: "최신 상태 불러오기", onClick: onReload }}
          compact
        />
      )}

      <section
        className="ws-cutover-section ws-cutover-section--readiness"
        aria-labelledby="cutover-readiness-title"
      >
        <div className="ws-cutover-section__heading">
          <div>
            <h2 id="cutover-readiness-title">일반 설정과 준비도 검증</h2>
            <p>준비 학기의 기본 상태와 필수 확인 결과를 먼저 살펴봅니다.</p>
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
                  <span>{check.required ? "필수 확인" : "참고 확인"}</span>
                  <details className="ws-cutover-evidence">
                    <summary>검증 근거 보기</summary>
                    <p>검증 항목: {check.label}</p>
                    {check.evidence && <p>{check.evidence}</p>}
                  </details>
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
            <h2 id="cutover-dataset-title">자료 비교 검증</h2>
            <p>
              현재 학기와 준비 학기의 건수, 연결 상태, 중복 여부를 확인합니다.
            </p>
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
              <caption className="sr-only">
                현재 운영 학기와 준비 학기의 자료 비교 결과
              </caption>
              <thead>
                <tr>
                  <th scope="col">영역과 상태</th>
                  <th scope="col">처리 방식</th>
                  <th scope="col">현재 학기</th>
                  <th scope="col">준비 학기</th>
                  <th scope="col">연결 안 됨</th>
                  <th scope="col">중복 항목</th>
                  <th scope="col">상세 근거</th>
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
                      <details className="ws-cutover-evidence">
                        <summary>내용 일치값 보기</summary>
                        <span>
                          {contentComparisonLabel(
                            dataset.sourceHash,
                            dataset.targetHash,
                          )}
                        </span>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveDataContainer>
        )}
      </section>

      <section
        className="ws-cutover-section ws-cutover-section--actions"
        aria-labelledby="cutover-actions-title"
      >
        <div className="ws-cutover-section__heading">
          <div>
            <h2 id="cutover-actions-title">단계별 진행</h2>
            <p>
              계획을 확인한 뒤 사전 비교, 합성 적용 확인, 결과 검증 순서로
              진행합니다.
            </p>
          </div>
          {selectedPlanLabel && <CutoverStatus status={selectedPlanLabel} />}
        </div>
        <div className="ws-cutover-actions">
          {actions
            .filter((action) => action.group === "flow")
            .map((action, index) => (
              <button
                key={action.id}
                type="button"
                className={`ws-cutover-action${action.primary ? " ws-cutover-action--primary" : ""}${action.busy ? " is-busy" : ""}`}
                disabled={!action.allowed || action.locked}
                title={!action.allowed ? action.disabledReason : undefined}
                aria-label={`${index + 1}단계 ${action.label}. ${action.description}`}
                aria-busy={action.busy || undefined}
                onClick={() => onAction(action.id)}
              >
                <strong>
                  {index + 1}. {action.busy ? "처리 중" : action.label}
                </strong>
                <span>{action.description}</span>
              </button>
            ))}
        </div>
        {actions.some(
          (action) =>
            action.group === "flow" && !action.allowed && action.disabledReason,
        ) && (
          <ul
            className="ws-cutover-action-notes"
            aria-label="진행 전 확인 사항"
          >
            {actions
              .filter(
                (action) =>
                  action.group === "flow" &&
                  !action.allowed &&
                  action.disabledReason,
              )
              .map((action) => (
                <li key={action.id}>
                  <strong>{action.label}</strong>: {action.disabledReason}
                </li>
              ))}
          </ul>
        )}
      </section>

      <section
        className="ws-cutover-section ws-cutover-section--attempts"
        aria-labelledby="cutover-attempt-title"
      >
        <div className="ws-cutover-section__heading">
          <div>
            <h2 id="cutover-attempt-title">진행 결과와 실패 항목</h2>
            <p>
              완료, 실패, 대기 건수를 확인합니다. 연결이 끊겨도 같은 실행 근거로
              복구할 수 있습니다.
            </p>
          </div>
        </div>
        {attempts.length === 0 ? (
          <p className="ws-cutover-empty">기록된 합성 실행이 없습니다.</p>
        ) : (
          <ResponsiveDataContainer label="최근 합성 실행 결과 표">
            <table className="ws-cutover-table">
              <caption className="sr-only">
                최근 합성 실행의 완료, 실패, 대기 건수와 상태
              </caption>
              <thead>
                <tr>
                  <th scope="col">단계</th>
                  <th scope="col">전체</th>
                  <th scope="col">완료</th>
                  <th scope="col">실패</th>
                  <th scope="col">대기</th>
                  <th scope="col">갱신</th>
                  <th scope="col">상태</th>
                  <th scope="col">상세 근거</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.attemptId}>
                    <td>{STATUS_LABELS[attempt.phase] || "진행 확인"}</td>
                    <td>{attempt.itemCount}</td>
                    <td>{attempt.succeededCount}</td>
                    <td>{attempt.failedCount}</td>
                    <td>{attempt.pendingCount}</td>
                    <td>{attempt.updatedAtLabel}</td>
                    <td>
                      <CutoverStatus status={attempt.status} />
                    </td>
                    <td>
                      <details className="ws-cutover-evidence">
                        <summary>실행 근거 보기</summary>
                        <span>진행 단계 {statusLabel(attempt.phase)}</span>
                        <span>처리 상태 {statusLabel(attempt.status)}</span>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveDataContainer>
        )}
      </section>

      <section
        className="ws-cutover-section ws-cutover-section--recovery"
        aria-labelledby="cutover-recovery-title"
      >
        <div className="ws-cutover-section__heading">
          <div>
            <h2 id="cutover-recovery-title">실패·복구와 위험 작업</h2>
            <p>
              일반 진행과 분리된 작업입니다. 실패 항목과 최신 상태를 확인한
              뒤에만 실행해 주세요.
            </p>
          </div>
        </div>
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
        {actions.some(
          (action) =>
            action.group === "recovery" &&
            !action.allowed &&
            action.disabledReason,
        ) && (
          <ul
            className="ws-cutover-action-notes"
            aria-label="복구 전 확인 사항"
          >
            {actions
              .filter(
                (action) =>
                  action.group === "recovery" &&
                  !action.allowed &&
                  action.disabledReason,
              )
              .map((action) => (
                <li key={action.id}>
                  <strong>{action.label}</strong>: {action.disabledReason}
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default SemesterCutoverCenterView;
