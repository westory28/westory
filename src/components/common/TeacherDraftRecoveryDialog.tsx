import React, { useEffect, useId, useRef } from "react";
import type { TeacherDraftRecord } from "../../lib/teacherOperations";

const TeacherDraftRecoveryDialog: React.FC<{
  draft: TeacherDraftRecord | null;
  onRecover: () => void;
  onDiscard: () => void;
  onKeepCurrent: () => void;
}> = ({ draft, onRecover, onDiscard, onKeepCurrent }) => {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const keepButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!draft) return undefined;
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    keepButtonRef.current?.focus();
    return () => {
      if (dialogRef.current?.open) dialogRef.current.close();
    };
  }, [draft]);

  if (!draft) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onKeepCurrent();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) || [],
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="teacher-operation-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onKeepCurrent();
      }}
    >
      <div className="teacher-operation-dialog__heading">
        <div>
          <p className="teacher-operation-dialog__eyebrow">임시 저장 복구</p>
          <h2 id={titleId}>
            {draft.status === "CONFLICT"
              ? "저장 충돌을 확인해 주세요."
              : "작성하던 내용을 찾았습니다."}
          </h2>
        </div>
        <span className="w8-status w8-status--accent">
          revision {draft.draftRevision}
        </span>
      </div>
      <p id={descriptionId}>
        같은 계정과 학기에서 작성한 내용입니다. 복구해도 공식 자료에는 바로
        반영되지 않으며, 저장 버튼을 다시 눌러야 합니다.
      </p>
      {draft.conflictReason && (
        <p className="teacher-operation-dialog__warning">
          최신 자료의 revision이 달라 자동으로 덮어쓰지 않았습니다.
        </p>
      )}
      <dl className="teacher-operation-dialog__meta">
        <div>
          <dt>화면</dt>
          <dd>{draft.key.surfaceKey}</dd>
        </div>
        <div>
          <dt>대상</dt>
          <dd>
            {draft.key.entityId === "new" ? "새 항목" : draft.key.entityId}
          </dd>
        </div>
        <div>
          <dt>보관 기한</dt>
          <dd>
            {draft.expiresAt
              ? new Intl.DateTimeFormat("ko-KR", {
                  timeZone: "Asia/Seoul",
                  dateStyle: "medium",
                }).format(new Date(draft.expiresAt))
              : "확인 중"}
          </dd>
        </div>
      </dl>
      <div className="teacher-operation-dialog__actions">
        <button
          ref={keepButtonRef}
          type="button"
          className="w8-button w8-button--secondary"
          onClick={onKeepCurrent}
        >
          현재 화면 유지
        </button>
        <button
          type="button"
          className="w8-button w8-button--danger"
          onClick={onDiscard}
        >
          임시 저장 폐기
        </button>
        <button type="button" className="w8-button" onClick={onRecover}>
          작성 내용 복구
        </button>
      </div>
    </dialog>
  );
};

export default TeacherDraftRecoveryDialog;
