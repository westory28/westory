import { useEffect, useId, useRef, useState } from "react";
import {
  InfoHelpContent,
  InfoHelpIcon,
  type InfoHelpSection,
} from "../../InfoHelp";

/** Keep shared help styling inside the native-fullscreen / rotated canvas. */
export default function RhythmHelp({
  label,
  sections,
}: {
  label: string;
  sections: readonly InfoHelpSection[];
}) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => {
      pinned.current = false;
      setOpen(false);
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
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
      className="rhythm-help"
      ref={root}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setOpen(true);
      }}
      onPointerLeave={() => {
        if (!pinned.current && !root.current?.contains(document.activeElement))
          setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          pinned.current = false;
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="rhythm-tool rhythm-icon-button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => {
          pinned.current = !pinned.current;
          setOpen(pinned.current);
        }}
      >
        <InfoHelpIcon />
      </button>
      {open && (
        <span id={id} className="rhythm-help-popover" role="tooltip">
          <InfoHelpContent sections={sections} />
        </span>
      )}
    </span>
  );
}
