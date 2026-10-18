import { useEffect, useRef, useState } from "react";
import { YutStackOptionArt, type YutProfession } from "./YutArt";
import "./yut-stack-choice.css";

/** Choosing a card is reversible; only the final button sends a move. */
export default function YutStackChoice({
  role,
  blocked,
  onClose,
  onConfirm,
}: {
  role: YutProfession;
  blocked: boolean;
  onClose: () => void;
  onConfirm: (stack: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState<boolean | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="yut-dialog yut-stack-choice"
      aria-label="내 말과 만났습니다"
      {...(blocked ? { inert: "" } : {})}
      onCancel={(event) => {
        event.preventDefault();
        if (!blocked) onClose();
      }}
    >
      <div className="yut-dialog-top">
        <h2>내 말과 만났습니다</h2>
        <button
          type="button"
          className="yut-plain"
          aria-label="이동 선택으로 돌아가기"
          disabled={blocked}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="yut-stack-options" role="group" aria-label="말 이동 방식">
        {[true, false].map((carried) => (
          <button
            key={String(carried)}
            type="button"
            className={`yut-stack-option${choice === carried ? " is-selected" : ""}`}
            aria-label={carried ? "업고 가기" : "따로 가기"}
            aria-pressed={choice === carried}
            disabled={blocked}
            onClick={() => setChoice(carried)}
          >
            <span className="yut-stack-option-picture" aria-hidden="true">
              <YutStackOptionArt role={role} carried={carried} />
            </span>
            <strong>{carried ? "업고 가기" : "따로 가기"}</strong>
          </button>
        ))}
      </div>
      <div className="yut-dialog-actions">
        <button
          type="button"
          className="yut-button"
          disabled={blocked}
          onClick={onClose}
        >
          취소
        </button>
        <button
          type="button"
          className="yut-button yut-button--primary"
          disabled={blocked || choice === null}
          onClick={() => {
            if (choice !== null) onConfirm(choice);
          }}
        >
          결정
        </button>
      </div>
    </dialog>
  );
}
