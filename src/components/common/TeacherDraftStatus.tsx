import React from "react";
import type { TeacherDraftUiState } from "../../lib/useTeacherDraft";

const LABELS: Record<TeacherDraftUiState, string> = {
  clean: "공식 자료와 같음",
  dirty: "변경 내용 있음",
  saving: "임시 저장 중",
  saved: "임시 저장됨",
  offline: "연결 복구 대기",
  conflict: "저장 충돌 확인 필요",
  error: "임시 저장 실패",
  recoverable: "복구할 내용 있음",
};

const TeacherDraftStatus: React.FC<{
  state: TeacherDraftUiState;
  message?: string;
  savedAt?: string;
  onRetry?: () => void;
}> = ({ state, message, savedAt, onRetry }) => (
  <div
    className={`teacher-draft-status teacher-draft-status--${state}`}
    role={state === "error" || state === "conflict" ? "alert" : "status"}
    aria-live="polite"
  >
    <span className="teacher-draft-status__indicator" aria-hidden="true" />
    <span className="teacher-draft-status__copy">
      <strong>{LABELS[state]}</strong>
      {message && <span>{message}</span>}
      {savedAt && state === "saved" && (
        <time dateTime={savedAt}>
          {new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date(savedAt))}
        </time>
      )}
    </span>
    {(state === "offline" || state === "error") && onRetry && (
      <button type="button" onClick={onRetry}>
        다시 저장
      </button>
    )}
  </div>
);

export default TeacherDraftStatus;
