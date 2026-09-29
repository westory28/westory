import { useEffect, useId, useRef, useState } from "react";
import type { WeplaySession } from "../../../lib/weplay";
import "./naval-battle.css";

interface Props {
  open: boolean;
  confirmed: boolean;
  error: string;
  preview: boolean;
  mode: WeplaySession["mode"];
  onCancel: () => void;
  onConfirm: () => void;
}

export default function WeplayExitDialog({
  open,
  confirmed,
  error,
  preview,
  mode,
  onCancel,
  onConfirm,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [viewport, setViewport] = useState({
    top: 0,
    height: window.visualViewport?.height || window.innerHeight,
  });
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      continueButton.current?.focus({ preventScroll: true });
    } else if (!open && element.open) element.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const measure = () =>
      setViewport({
        top: window.visualViewport?.offsetTop || 0,
        height: window.visualViewport?.height || window.innerHeight,
      });
    measure();
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [open]);
  useEffect(() => {
    if (error) retryButton.current?.focus({ preventScroll: true });
  }, [error]);
  useEffect(() => {
    if (confirmed && !error) dialog.current?.focus({ preventScroll: true });
  }, [confirmed, error]);
  return (
    <dialog
      ref={dialog}
      className="weplay-exit-dialog"
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={confirmed && !error}
      style={{
        top: viewport.top + viewport.height / 2,
        maxHeight: Math.max(160, viewport.height - 32),
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!confirmed) onCancel();
      }}
    >
      <h2 id={titleId}>전투를 종료하시겠어요?</h2>
      <p id={descriptionId}>
        {preview
          ? "체험만 종료하며 위스·랭킹·학생 기록에 반영되지 않습니다."
          : mode === "challenge"
            ? "참가비는 반환되지 않으며, 처리한 단어를 기준으로 위스를 정산합니다."
            : "현재 기록으로 연습을 종료합니다. 위스는 변동되지 않습니다."}
      </p>
      {error ? (
        <p className="weplay-exit-error" role="alert">
          {error} 결과 확인 전에는 게임을 계속할 수 없습니다. 다시 시도해
          주세요.
        </p>
      ) : (
        <p className="weplay-exit-status" role="status">
          {confirmed
            ? "입력한 단어와 전투 결과를 확인하고 있습니다."
            : "확인 중에도 제한시간은 계속 흐릅니다."}
        </p>
      )}
      <div className="weplay-exit-actions">
        {!confirmed && (
          <button ref={continueButton} type="button" onClick={onCancel}>
            계속하기
          </button>
        )}
        <button
          ref={retryButton}
          type="button"
          className="weplay-exit-confirm"
          disabled={confirmed && !error}
          onClick={onConfirm}
        >
          {error
            ? "종료 다시 시도"
            : confirmed
              ? "종료 확인 중…"
              : "현재 기록으로 종료"}
        </button>
      </div>
    </dialog>
  );
}
