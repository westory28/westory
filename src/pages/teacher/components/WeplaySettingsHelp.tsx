import { useEffect, useId, useRef, useState } from "react";

export default function WeplaySettingsHelp() {
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
      className="teacher-weplay-help"
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
        aria-label="난이도 설정 도움말"
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
        <span id={id} role="tooltip" className="teacher-weplay-help-popover">
          한 판은 20개 단어로 구성됩니다. 초반·중반·후반은 전체 제한시간의
          ⅓씩입니다. 낙하 시간은 단어가 바닥에 닿기까지 걸리는 시간으로,
          짧을수록 빠릅니다. 단어 길이는 공백을 제외하고 셉니다.
        </span>
      )}
    </span>
  );
}
