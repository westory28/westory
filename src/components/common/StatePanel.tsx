import React from "react";

export type CommonUiState =
  | "LOADING"
  | "CONTENT"
  | "EMPTY"
  | "ERROR"
  | "PERMISSION"
  | "SESSION_EXPIRED"
  | "MAINTENANCE"
  | "ARCHIVED"
  | "LEGACY"
  | "STALE"
  | "PARTIAL"
  | "SAVING"
  | "SAVED"
  | "SAVE_FAILED"
  | "CONFLICT"
  | "SUBMITTING"
  | "PROCESSING"
  | "PARTIAL_SUCCESS"
  | "OFFLINE"
  | "DISABLED";

type StatePanelAction = {
  label: string;
  onClick?: () => void;
  href?: string;
};

type StatePanelProps = {
  state: CommonUiState;
  title?: string;
  description?: string;
  action?: StatePanelAction;
  secondaryAction?: StatePanelAction;
  retryable?: boolean;
  contactAdmin?: boolean;
  readOnly?: boolean;
  compact?: boolean;
  className?: string;
  headingLevel?: 1 | 2 | 3;
};

const DEFAULTS: Record<
  CommonUiState,
  { title: string; description: string; iconPath: string }
> = {
  LOADING: {
    title: "자료를 불러오고 있습니다.",
    description: "잠시만 기다려 주세요.",
    iconPath: "M12 3a9 9 0 1 0 9 9",
  },
  CONTENT: {
    title: "자료를 확인할 수 있습니다.",
    description: "현재 범위의 최신 자료입니다.",
    iconPath: "m5 12 4 4L19 6",
  },
  EMPTY: {
    title: "아직 표시할 자료가 없습니다.",
    description: "자료가 등록되면 이곳에서 확인할 수 있습니다.",
    iconPath: "M4 6h16v14H4V6Zm4-3h8v3H8V3Zm1 8h6",
  },
  ERROR: {
    title: "자료를 불러오지 못했습니다.",
    description: "잠시 후 다시 시도해 주세요.",
    iconPath:
      "M12 9v4m0 4h.01M10.3 3.8 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z",
  },
  PERMISSION: {
    title: "이 화면을 볼 권한이 없습니다.",
    description: "허용된 화면으로 돌아가거나 관리자에게 문의해 주세요.",
    iconPath:
      "M7 10V8a5 5 0 0 1 10 0v2m-9 0h8a2 2 0 0 1 2 2v8H6v-8a2 2 0 0 1 2-2Z",
  },
  SESSION_EXPIRED: {
    title: "로그인 시간이 만료되었습니다.",
    description: "다시 로그인하면 안전하게 작업을 이어갈 수 있습니다.",
    iconPath: "M12 7v5l3 2m6-2a9 9 0 1 1-9-9",
  },
  MAINTENANCE: {
    title: "학생 서비스를 점검하고 있습니다.",
    description: "점검이 끝난 뒤 다시 이용해 주세요.",
    iconPath:
      "m14.7 6.3 3 3M6 18l5.8-5.8M5 4l3 1 2 3-2 2-3-2-1-3 1-1Zm10 10 5 5-1 1-5-5",
  },
  ARCHIVED: {
    title: "지난 학기 자료입니다.",
    description: "기록은 확인할 수 있지만 수정할 수 없습니다.",
    iconPath: "M4 5h16v4H4V5Zm2 4h12v11H6V9Zm4 4h4",
  },
  LEGACY: {
    title: "이전 구조에서 가져온 자료입니다.",
    description: "출처를 확인하는 동안 읽기 전용으로 제공합니다.",
    iconPath: "M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5M12 7v5l3 2",
  },
  STALE: {
    title: "최신 상태인지 다시 확인해야 합니다.",
    description: "표시된 자료를 참고하되 변경 전에는 새로고침해 주세요.",
    iconPath: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  },
  PARTIAL: {
    title: "일부 자료만 준비되었습니다.",
    description: "준비된 범위를 확인하고 나머지는 완료 후 다시 이용해 주세요.",
    iconPath: "M4 12a8 8 0 1 0 8-8v8h8",
  },
  SAVING: {
    title: "변경 내용을 저장하고 있습니다.",
    description: "저장이 끝날 때까지 이 화면을 유지해 주세요.",
    iconPath: "M12 3a9 9 0 1 0 9 9",
  },
  SAVED: {
    title: "변경 내용을 저장했습니다.",
    description: "최신 내용이 안전하게 반영되었습니다.",
    iconPath: "m5 12 4 4L19 6",
  },
  SAVE_FAILED: {
    title: "변경 내용을 저장하지 못했습니다.",
    description:
      "입력한 내용은 유지됩니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
    iconPath:
      "M12 9v4m0 4h.01M10.3 3.8 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z",
  },
  CONFLICT: {
    title: "다른 변경 내용과 충돌했습니다.",
    description: "최신 자료와 내 작업을 비교한 뒤 적용할 내용을 선택해 주세요.",
    iconPath: "M8 7h11l-3-3m3 3-3 3M16 17H5l3 3m-3-3 3-3",
  },
  SUBMITTING: {
    title: "요청을 보내고 있습니다.",
    description: "중복 제출을 막기 위해 결과를 확인하고 있습니다.",
    iconPath: "M12 3a9 9 0 1 0 9 9",
  },
  PROCESSING: {
    title: "요청을 처리하고 있습니다.",
    description: "현재 처리 상태를 안전하게 확인하고 있습니다.",
    iconPath: "M12 3a9 9 0 1 0 9 9",
  },
  PARTIAL_SUCCESS: {
    title: "일부 요청만 처리되었습니다.",
    description: "처리 결과를 확인한 뒤 실패한 항목만 다시 시도해 주세요.",
    iconPath: "M4 12a8 8 0 1 0 8-8v8h8",
  },
  OFFLINE: {
    title: "네트워크 연결을 확인해 주세요.",
    description: "연결이 복구되면 안전하게 다시 시도할 수 있습니다.",
    iconPath:
      "M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18",
  },
  DISABLED: {
    title: "현재 사용할 수 없는 기능입니다.",
    description: "운영 설정이 바뀌면 이 화면에서 다시 안내해 드립니다.",
    iconPath: "M5 5l14 14M6 12a6 6 0 0 1 10.5-4M18 12a6 6 0 0 1-10.5 4",
  },
};

const Action: React.FC<{
  action: StatePanelAction;
  secondary?: boolean;
}> = ({ action, secondary = false }) => {
  const className = secondary
    ? "ws-state-panel__action ws-state-panel__action--secondary"
    : "ws-state-panel__action";
  if (action.href) {
    return (
      <a className={className} href={action.href}>
        {action.label}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={action.onClick}>
      {action.label}
    </button>
  );
};

const StatePanel: React.FC<StatePanelProps> = ({
  state,
  title,
  description,
  action,
  secondaryAction,
  retryable = false,
  contactAdmin = false,
  readOnly = false,
  compact = false,
  className = "",
  headingLevel = 2,
}) => {
  const preset = DEFAULTS[state];
  const isUrgent =
    state === "ERROR" ||
    state === "SESSION_EXPIRED" ||
    state === "SAVE_FAILED" ||
    state === "CONFLICT";
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3";
  return (
    <section
      className={`ws-state-panel ws-state-panel--${state.toLowerCase()} ${compact ? "ws-state-panel--compact" : ""} ${className}`}
      role={isUrgent ? "alert" : "status"}
      aria-live={isUrgent ? "assertive" : "polite"}
      aria-busy={
        state === "LOADING" ||
        state === "SAVING" ||
        state === "SUBMITTING" ||
        state === "PROCESSING"
      }
    >
      <span className="ws-state-panel__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            d={preset.iconPath}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      </span>
      <div className="ws-state-panel__body">
        <Heading>{title || preset.title}</Heading>
        <p>{description || preset.description}</p>
        {(retryable || contactAdmin || readOnly) && (
          <ul className="ws-state-panel__meta">
            {retryable && (
              <li>같은 요청을 안전하게 다시 시도할 수 있습니다.</li>
            )}
            {contactAdmin && (
              <li>계속되면 담당 교사나 관리자에게 문의해 주세요.</li>
            )}
            {readOnly && <li>이 자료는 읽기 전용입니다.</li>}
          </ul>
        )}
        {(action || secondaryAction) && (
          <div className="ws-state-panel__actions">
            {action && <Action action={action} />}
            {secondaryAction && <Action action={secondaryAction} secondary />}
          </div>
        )}
      </div>
    </section>
  );
};

export default StatePanel;
