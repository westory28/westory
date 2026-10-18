import { useEffect, useRef } from "react";
import "./weplay-game-frame.css";

/** Local to the game stage. The caller makes its game controls inert while busy. */
export default function WeplayGameLoading({
  theme = "naval",
  label = "잠시만 기다려 주세요",
}: {
  theme?: "naval" | "yut";
  label?: string;
}) {
  const status = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    status.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className={`weplay-game-loading is-${theme}`}>
      <div
        className="weplay-game-loading__plaque"
        role="status"
        aria-live="polite"
        tabIndex={-1}
        ref={status}
      >
        <span className="weplay-game-loading__seal" aria-hidden="true">
          W
        </span>
        <strong>{label}</strong>
        <span className="weplay-game-loading__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
