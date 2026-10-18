import React from "react";
import frameAtlases from "./yutCharacterFrames.json";
import "./yut-character.css";

export type YutProfession = "sa" | "nong" | "gong" | "sang";
export type YutSpritePose =
  | "idle"
  | "turn"
  | "throw"
  | "walk"
  | "carry"
  | "boarding"
  | "win"
  | "lose"
  | "caught"
  | "pair-caught";
export const PROFESSIONS: Record<
  YutProfession,
  { color: string; clan: string; animal: string }
> = {
  sa: { color: "#7c9aa1", clan: "마가", animal: "말" },
  nong: { color: "#88a382", clan: "우가", animal: "소" },
  gong: { color: "#bc8068", clan: "저가", animal: "돼지" },
  sang: { color: "#c1a568", clan: "구가", animal: "개" },
};
export const YUT_CHARACTER_SHEETS = [
  "idle",
  "walk",
  "carry",
  "boarding",
  "win",
  "lose",
  "caught",
  "pair-caught",
] as const;
const asset = (file: string) =>
  `${import.meta.env.BASE_URL}assets/weplay/yut/${file}`;

/** Every column is a separately drawn complete pose. Never deform body parts. */
export function YutSprite({
  role,
  className = "",
  pose = "idle",
  motionKey,
}: {
  role: YutProfession;
  className?: string;
  pose?: YutSpritePose;
  motionKey?: string;
}) {
  const action = pose === "turn" || pose === "throw" ? "idle" : pose;
  const atlas = frameAtlases[action];
  const row = atlas.rows[["sa", "nong", "gong", "sang"].indexOf(role)];
  const roleIndex = ["sa", "nong", "gong", "sang"].indexOf(role);
  const phase = Array.from(motionKey || role).reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) % 997,
    0,
  );
  return (
    <span
      className={`yut-sprite yut-character--${role} yut-sprite--${pose} yut-frame-sprite yut-frame--${action} ${className}`}
      data-sprite-action={action}
      data-sprite-frames="3"
      style={
        {
          "--idle-duration": `${1400 + roleIndex * 110 + (phase % 4) * 40}ms`,
          "--idle-delay": `${-(roleIndex * 330 + ((phase * 307) % 600))}ms`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      {row.frames.map(([x, y, width, height, dx, dy], index) => (
        <svg
          key={index}
          className="yut-drawn-frame"
          data-frame-index={index}
          data-source-rect={[x, y, width, height].join(",")}
          viewBox={`0 0 ${row.size} ${row.size}`}
          focusable="false"
        >
          {/* A rectangular viewport isolates one complete drawing, never a limb. */}
          <svg
            x={dx}
            y={dy}
            width={width}
            height={height}
            viewBox={`${x} ${y} ${width} ${height}`}
            overflow="hidden"
          >
            <image
              href={asset(`animation-${action}.webp`)}
              width={atlas.width}
              height={atlas.height}
            />
          </svg>
        </svg>
      ))}
    </span>
  );
}

export function YutPawnArt({
  role,
  carried = false,
  boarding = false,
  walking = false,
  pose = "idle",
  className = "",
  motionKey,
}: {
  role: YutProfession;
  carried?: boolean;
  boarding?: boolean;
  walking?: boolean;
  pose?: YutSpritePose;
  className?: string;
  motionKey?: string;
}) {
  const action =
    pose === "lose" || pose === "caught" || pose === "win"
      ? pose
      : boarding
        ? "boarding"
        : carried
          ? "carry"
          : walking
            ? "walk"
            : "idle";
  return (
    <span
      className={`yut-pawn-art ${carried ? "is-carried" : ""} ${walking ? "is-walking" : ""} ${className}`}
      data-carried={carried}
      data-boarding={boarding}
    >
      <YutSprite role={role} pose={action} motionKey={motionKey} />
    </span>
  );
}

export function YutStackOptionArt({
  role,
  carried,
}: {
  role: YutProfession;
  carried: boolean;
}) {
  return (
    <span
      className={`yut-stack-option-art yut-character--${role}`}
      aria-hidden="true"
      style={{
        backgroundImage: `url(${asset(`stack-choice-${carried ? "carry" : "separate"}.webp`)})`,
      }}
    />
  );
}

export function YutPortrait({
  role,
}: {
  role: YutProfession;
  pose?: YutSpritePose;
}) {
  return (
    <span className="yut-portrait" aria-hidden="true">
      <YutSprite role={role} pose="idle" />
    </span>
  );
}

export function YutIcon({
  name,
}: {
  name:
    | "back"
    | "info"
    | "sound"
    | "muted"
    | "arrow"
    | "copy"
    | "emote"
    | "rotate";
}) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "back" && <path d="m14 5-7 7 7 7M7 12h13" />}
      {name === "arrow" && <path d="M4 12h15m-6-6 6 6-6 6" />}
      {name === "info" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6" />
          <circle cx="12" cy="7.5" r=".7" fill="currentColor" />
        </>
      )}
      {(name === "sound" || name === "muted") && (
        <>
          <path d="M11 4 5 9H2v6h3l6 5Z" />
          {name === "sound" ? (
            <>
              <path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
            </>
          ) : (
            <path d="m16 9 6 6m0-6-6 6" />
          )}
        </>
      )}
      {name === "emote" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 14q4 5 8 0M8 8h.01M16 8h.01" />
        </>
      )}
      {name === "rotate" && (
        <>
          <rect
            x="8"
            y="3"
            width="9"
            height="16"
            rx="2"
            transform="rotate(30 12 12)"
          />
          <path d="M3 11a9 9 0 0 1 4-7m-4 0v7h6M21 13a9 9 0 0 1-4 7m4 0v-7h-6" />
        </>
      )}
      {name === "copy" && (
        <>
          <rect x="8" y="8" width="11" height="13" rx="1" />
          <path d="M15 8V3H4v13h4" />
        </>
      )}
    </svg>
  );
}
