import type { ReactNode } from "react";
import WeplayGameLoading from "./WeplayGameLoading";
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
  return (
    <div className="weplay-game-frame" aria-busy={busy}>
      <div className="weplay-game-frame__body" {...(busy ? { inert: "" } : {})}>
        {children}
      </div>
      {busy && <WeplayGameLoading theme={theme} label={label} />}
    </div>
  );
}
