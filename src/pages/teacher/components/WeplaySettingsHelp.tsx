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
          90초 기준 일반 단어 60개이며, 시간을 늘리면 출제량도 늘어납니다.
          필살기 기회는 2회입니다. 초반·중반·후반은 전체 제한시간의 ⅓씩입니다.
          입력 시간이 짧을수록 단어가 빨리 사라지고 적의 공격도 빨라집니다.
          착한맛·중간맛·매운맛은 각각 2·3·4단어를 맞히면 화포를 발사합니다.
          필살기는 긴 단어를 5초 안에 입력해야 합니다. 단어 길이는 공백을
          제외하고 셉니다.
        </span>
      )}
    </span>
  );
}
