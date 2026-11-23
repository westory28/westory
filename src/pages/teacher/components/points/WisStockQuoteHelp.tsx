import { useEffect, useId, useRef, useState } from "react";
import { InfoHelpIcon } from "../../../../components/common/InfoHelp";

/** Keep click-only help inside both the dialog and its fullscreen element. */
export default function WisStockQuoteHelp() {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <span
      ref={root}
      className="wis-exchange__quote-help"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label="종목 시세 표시 기준"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <InfoHelpIcon />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="wis-exchange__quote-help-content"
        >
          현재가 · 전일 대비 · 단위 위스
        </span>
      )}
    </span>
  );
}
