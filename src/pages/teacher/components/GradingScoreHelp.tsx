import { useEffect, useId, useRef, useState } from "react";
import {
  isThreeLevelSubject,
  SCORE_ACHIEVEMENT_GUIDANCE,
} from "../../../lib/studentScores";

export default function GradingScoreHelp({ subject }: { subject: string }) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const close = () => {
    pinned.current = false;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className="grading-score-help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned.current) setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <button
        type="button"
        aria-label="성취도 기준 도움말"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => {
          pinned.current = !pinned.current;
          setOpen(pinned.current);
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <span id={id} role="tooltip" className="grading-score-help__popover">
          <span>
            {isThreeLevelSubject(subject)
              ? SCORE_ACHIEVEMENT_GUIDANCE.artsPE
              : SCORE_ACHIEVEMENT_GUIDANCE.general}
          </span>
          <span>{SCORE_ACHIEVEMENT_GUIDANCE.rounding}</span>
        </span>
      )}
    </span>
  );
}
