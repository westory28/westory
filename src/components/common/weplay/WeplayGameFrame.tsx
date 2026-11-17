import type { ReactNode } from "react";
import WeplayGameLoading from "./WeplayGameLoading";
import useWeplayFullscreen from "./useWeplayFullscreen";
import "./weplay-game-frame.css";

/** All Weplay openings, lobbies and games share this viewport contract. */
export default function WeplayGameFrame({
  children,
  busy = false,
  theme = "naval",
  label,
}: {
  children: ReactNode;
  busy?: boolean;
  theme?: "naval" | "yut";
  label?: string;
}) {
  const stage = useWeplayFullscreen();
  return (
    <div
      ref={stage.host}
      className={`weplay-game-frame weplay-game-frame--${theme}${stage.fullscreen ? " weplay-game-frame--fullscreen" : ""}`}
      aria-busy={busy}
      data-floating-launcher-obstacle={stage.fullscreen || undefined}
    >
      <div className="weplay-game-frame__body" {...(busy ? { inert: "" } : {})}>
        {children}
      </div>
      {busy && <WeplayGameLoading theme={theme} label={label} />}
      {theme === "naval" && !busy && (
        <button
          type="button"
          className="weplay-frame-fullscreen"
          aria-label={stage.fullscreen ? "전체 화면 나가기" : "게임 전체 화면"}
          title={stage.fullscreen ? "전체 화면 나가기" : "게임 전체 화면"}
          onClick={() => (stage.fullscreen ? stage.exit() : void stage.enter())}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path
              d={
                stage.fullscreen
                  ? "M9 3v6H3m12-6v6h6M3 15h6v6m12-6h-6v6"
                  : "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"
              }
            />
          </svg>
          <span>{stage.fullscreen ? "전체 화면 나가기" : "전체 화면"}</span>
        </button>
      )}
    </div>
  );
}
