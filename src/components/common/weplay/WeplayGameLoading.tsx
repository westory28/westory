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
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    status.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const element = overlay.current;
    if (theme !== "naval" || !element) return;
    let visible = false;
    const syncMotion = () => {
      element.dataset.motion =
        visible && !document.hidden ? "running" : "paused";
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncMotion();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", syncMotion);
    syncMotion();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncMotion);
    };
  }, [theme]);
  return (
    <div
      ref={overlay}
      className={`weplay-game-loading is-${theme}`}
      data-motion={theme === "naval" ? "paused" : undefined}
    >
      <div
        className="weplay-game-loading__plaque"
        role="status"
        aria-live="polite"
        tabIndex={-1}
        ref={status}
      >
        {theme === "naval" ? (
          <svg
            className="weplay-game-loading__fleet"
            viewBox="0 0 240 136"
            aria-hidden="true"
            focusable="false"
          >
            <g className="weplay-game-loading__ship">
              <path className="weplay-game-loading__mast" d="M119 22v63" />
              <path
                className="weplay-game-loading__flag"
                d="M120 23h34l-9 9 9 9h-34z"
              />
              <path
                className="weplay-game-loading__roof"
                d="M70 62l13-15h65l18 15z"
              />
              <path
                className="weplay-game-loading__deck"
                d="M77 63v20m18-20v20m18-20v20m18-20v20m18-20v20m18-20v20M68 73h108"
              />
              <path
                className="weplay-game-loading__hull"
                d="M43 81h139l20-10-9 24-20 14H73L53 96z"
              />
              <path
                className="weplay-game-loading__hull-line"
                d="M55 92h132M68 101h106"
              />
              <g className="weplay-game-loading__ports">
                <circle cx="78" cy="91" r="3" />
                <circle cx="103" cy="91" r="3" />
                <circle cx="128" cy="91" r="3" />
                <circle cx="153" cy="91" r="3" />
              </g>
              <g className="weplay-game-loading__oars">
                <path d="M82 96l-15 22m40-22-15 22m40-22-15 22m40-22-15 22" />
              </g>
            </g>
            <g className="weplay-game-loading__water">
              <path
                className="weplay-game-loading__wave"
                d="M-120 120q15-7 30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0"
              />
              <path
                className="weplay-game-loading__wave is-distant"
                d="M-120 129q15-5 30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0"
              />
            </g>
          </svg>
        ) : (
          <span className="weplay-game-loading__seal" aria-hidden="true">
            W
          </span>
        )}
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
