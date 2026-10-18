import React from "react";

export type YutProfession = "sa" | "nong" | "gong" | "sang";
export const PROFESSIONS: Record<
  YutProfession,
  { name: string; job: string; color: string; clan: string; animal: string }
> = {
  sa: { name: "사", job: "선비", color: "#7c9aa1", clan: "마가", animal: "말" },
  nong: {
    name: "농",
    job: "농부",
    color: "#88a382",
    clan: "우가",
    animal: "소",
  },
  gong: {
    name: "공",
    job: "장인",
    color: "#bc8068",
    clan: "저가",
    animal: "돼지",
  },
  sang: {
    name: "상",
    job: "상인",
    color: "#c1a568",
    clan: "구가",
    animal: "개",
  },
};

/** Four original costumed animal sprites from the shared transparent 2 × 2 atlas. */
export function YutSprite({
  role,
  className = "",
}: {
  role: YutProfession;
  className?: string;
}) {
  return (
    <span
      className={`yut-sprite yut-character--${role} ${className}`}
      aria-hidden="true"
      style={{
        backgroundImage: `url(${import.meta.env.BASE_URL}assets/weplay/yut/characters.webp)`,
      }}
    />
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
