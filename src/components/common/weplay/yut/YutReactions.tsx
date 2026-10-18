import React from "react";
import type { YutRole } from "../../../../lib/yut";
import { PROFESSIONS } from "./YutArt";
import "./yut-reactions.css";

export type YutCaughtPlayer = { uid: string; name: string; role: YutRole };

export function YutCaptureReaction({
  players,
}: {
  players: YutCaughtPlayer[];
}) {
  return (
    <div
      className="yut-capture-reaction"
      role="status"
      aria-label={`${players.map((player) => player.name).join(", ")}의 말이 잡혔습니다`}
    >
      <div className="yut-capture-burst" aria-hidden="true">
        <svg viewBox="0 0 280 230" preserveAspectRatio="none">
          <path d="M22 48 52 40 42 18 86 28 107 7 139 23 174 7 192 27 237 17 229 42 261 51 251 78 274 105 254 127 267 157 234 167 237 190 194 183 173 205 147 191 111 222 111 195 76 202 65 183 28 190 33 164 8 146 24 121 7 94 29 79Z" />
        </svg>
        <strong>앗!</strong>
        <div className="yut-capture-portraits">
          {players.map((player) => (
            <span
              key={player.uid}
              className={`yut-capture-portrait yut-reaction-role--${player.role}`}
              style={{
                backgroundImage: `url(${import.meta.env.BASE_URL}assets/weplay/yut/characters-surprised.webp)`,
              }}
            />
          ))}
        </div>
      </div>
      <span className="yut-capture-name" aria-hidden="true">
        {players
          .map((player) => `${player.name} · ${PROFESSIONS[player.role].clan}`)
          .join(" / ")}
      </span>
    </div>
  );
}

export function YutTurnGauge({
  remainingMs,
  totalMs,
  phase,
}: {
  remainingMs: number;
  totalMs: number;
  phase: "throw" | "move";
}) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const ratio = Math.max(0, Math.min(1, remainingMs / Math.max(1, totalMs)));
  return (
    <div className={`yut-turn-gauge ${seconds <= 2 ? "is-low" : ""}`}>
      <div className="yut-turn-gauge-label">
        <span>{phase === "throw" ? "던지기" : "말 이동"}</span>
        <strong>
          {seconds}
          <small>초</small>
        </strong>
      </div>
      <div
        className="yut-turn-gauge-track"
        role="progressbar"
        aria-label={`${phase === "throw" ? "윷 던지기" : "말 이동"} 남은 시간`}
        aria-valuemin={0}
        aria-valuemax={Math.ceil(totalMs / 1000)}
        aria-valuenow={seconds}
        aria-valuetext={`${seconds}초 남음`}
      >
        <i style={{ transform: `scaleX(${ratio})` }} />
      </div>
    </div>
  );
}
