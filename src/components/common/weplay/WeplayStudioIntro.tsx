import { useCallback, useEffect, useId, useRef, useState } from "react";
import "./weplay-studio-intro.css";

/** Mount before the game/lobby, so the opening never spends a paid game clock. */
export default function WeplayStudioIntro({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const completed = useRef(false);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const titleId = useId();
  const [reduced] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    dialog.current?.close();
    callback.current();
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Native modal behavior contains focus and makes the portal behind it inert.
    element.showModal();
    skip.current?.focus({ preventScroll: true });
    let remaining = reduced ? 700 : 2400;
    let since = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resume = () => {
      if (document.hidden || completed.current) return;
      clearTimeout(timer);
      since = performance.now();
      element.classList.remove("weplay-studio-intro--paused");
      timer = setTimeout(finish, remaining);
    };
    const visibility = () => {
      if (document.hidden) {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
          remaining = Math.max(0, remaining - (performance.now() - since));
        }
        element.classList.add("weplay-studio-intro--paused");
      } else resume();
    };
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      element.close();
    };
  }, [finish, reduced]);

  return (
    <dialog
      ref={dialog}
      className="weplay-studio-intro"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        finish();
      }}
    >
      <div className="weplay-studio-intro__composition">
        <svg
          className="weplay-studio-intro__seal"
          viewBox="0 0 160 160"
          fill="none"
          aria-hidden="true"
        >
          <path
            className="weplay-studio-intro__frame"
            d="M28 56V28h28m48 0h28v28m0 48v28h-28m-48 0H28v-28"
          />
          <path
            className="weplay-studio-intro__mark"
            pathLength="1"
            d="M40 54v30l20 24 20-25 20 25 20-24V54"
          />
          <path className="weplay-studio-intro__spark" d="M80 34v16m-8-8h16" />
        </svg>
        <p className="weplay-studio-intro__origin">WESTORY</p>
        <p id={titleId} className="weplay-studio-intro__title">
          WEPLAY
        </p>
        <span className="weplay-studio-intro__rule" aria-hidden="true" />
      </div>
      <button
        ref={skip}
        type="button"
        className="weplay-studio-intro__skip"
        onClick={finish}
      >
        건너뛰기 <span aria-hidden="true">→</span>
      </button>
    </dialog>
  );
}
