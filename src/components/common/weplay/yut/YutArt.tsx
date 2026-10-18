import React, { useId } from "react";

export type YutProfession = "sa" | "nong" | "gong" | "sang";
export const PROFESSIONS: Record<
  YutProfession,
  { name: string; job: string; color: string }
> = {
  sa: { name: "사", job: "선비", color: "#7c9aa1" },
  nong: { name: "농", job: "농부", color: "#88a382" },
  gong: { name: "공", job: "장인", color: "#bc8068" },
  sang: { name: "상", job: "상인", color: "#c1a568" },
};

/** Original engraved profession seals; the stable export is shared with board pieces. */
export function YutSprite({
  role,
  className = "",
}: {
  role: YutProfession;
  className?: string;
}) {
  const id = useId();
  const color = PROFESSIONS[role].color;
  return (
    <svg
      className={`yut-sprite ${className}`}
      viewBox="0 0 88 88"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={id}>
          <stop stopColor="#455044" />
          <stop offset=".68" stopColor="#2b332c" />
          <stop offset="1" stopColor="#17201c" />
        </radialGradient>
      </defs>
      <circle cx="44" cy="46" r="39" fill="#100f0c" opacity=".4" />
      <circle
        cx="44"
        cy="43"
        r="38"
        fill={`url(#${id})`}
        stroke={color}
        strokeWidth="1.5"
      />
      <circle cx="44" cy="43" r="33" stroke={color} strokeOpacity=".38" />
      <path
        d="m44 3 3 5-3 5-3-5ZM44 73l3 5-3 5-3-5ZM4 43l5-3 5 3-5 3ZM74 43l5-3 5 3-5 3Z"
        fill={color}
      />
      <g
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {role === "sa" && (
          <>
            <path d="M24 31c8-2 14 0 20 4 6-4 12-6 20-4v26c-8-2-14 0-20 4-6-4-12-6-20-4Z" />
            <path d="M44 35v26M29 38l9 3M29 45l9 3M50 41l9-3M50 48l9-3M52 23l-5 10" />
            <path d="m53 18 3 1-3 7-3-1Z" fill={color} />
          </>
        )}
        {role === "nong" && (
          <>
            <path d="M43 61c1-13 0-27 4-39M44 55c-5-1-11-6-14-10M45 46c6-2 11-8 13-14M44 39c-3-2-7-5-8-9" />
            <path
              d="M46 24c-6-7-10-1-2 7M45 35c7-8 11-1 1 7M41 42c-9-6-10 1 2 7M47 48c9-8 13 0-2 8M34 38c-10-3-8 6 4 5"
              fill={color}
              fillOpacity=".2"
            />
            <path d="m33 62 9-5 12 4M36 66h16" />
          </>
        )}
        {role === "gong" && (
          <>
            <path d="m35 29 17 30-5 3-17-30Z" fill={color} fillOpacity=".25" />
            <path d="m27 23 9-5 10 14-13 8-9-13ZM48 46l12-20 6 4-13 21M29 60h31M32 56h24l4 5H28Z" />
            <path d="m31 24 7 10M60 26l3 4" />
          </>
        )}
        {role === "sang" && (
          <>
            <path d="M44 23v38M27 62h34M35 57h18M24 32h40M44 23l4 7-4 5-4-5Z" />
            <path
              d="m29 33-8 17h16ZM59 33l-8 17h16Z"
              fill={color}
              fillOpacity=".15"
            />
            <path d="M21 50q8 12 16 0M51 50q8 12 16 0" />
          </>
        )}
      </g>
    </svg>
  );
}

export function YutIcon({
  name,
}: {
  name: "back" | "info" | "sound" | "muted" | "arrow" | "copy";
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
      {name === "copy" && (
        <>
          <rect x="8" y="8" width="11" height="13" rx="1" />
          <path d="M15 8V3H4v13h4" />
        </>
      )}
    </svg>
  );
}
