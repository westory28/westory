import React from "react";

export type YutProfession = "sa" | "nong" | "gong" | "sang";
export const PROFESSIONS: Record<
  YutProfession,
  { name: string; job: string; color: string }
> = {
  sa: { name: "사", job: "선비", color: "#829fc4" },
  nong: { name: "농", job: "농부", color: "#83aa78" },
  gong: { name: "공", job: "장인", color: "#d58970" },
  sang: { name: "상", job: "상인", color: "#c6a263" },
};

/** Original 16 × 24 pixel characters, drawn on an integer grid. */
export function YutSprite({
  role,
  className = "",
}: {
  role: YutProfession;
  className?: string;
}) {
  const color = PROFESSIONS[role].color;
  return (
    <svg
      className={`yut-sprite ${className}`}
      viewBox="0 0 20 28"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path fill="#111627" d="M5 25h10v2H5z" opacity=".45" />
      <path fill="#111627" d="M6 7h8v8h2v8h-3v3H7v-3H4v-8h2z" />
      <path fill="#e2b78d" d="M7 8h6v5H7zM5 15h2v5H5zM13 15h2v5h-2z" />
      <path fill="#f3d1a4" d="M7 8h5v3H7z" />
      <path fill="#322c36" d="M7 10h1v1H7zM11 10h1v1h-1z" />
      <path fill={color} d="M7 13h6v10H7zM5 14h2v4H5zM13 14h2v4h-2z" />
      <path fill="#eee0b9" d="M8 13h2v3H8zM10 14h1v2h-1zM7 18h6v1H7z" />
      <path fill="#33404d" d="M7 23h2v2H7zM11 23h2v2h-2z" />
      {role === "sa" && (
        <>
          <path fill="#111627" d="M7 3h6v4H7zM3 7h14v2H3z" />
          <path fill="#354258" d="M8 4h4v3H8z" />
          <path fill="#ead9ad" d="M14 16h3v5h-3z" />
        </>
      )}
      {role === "nong" && (
        <>
          <path fill="#c6a263" d="M7 4h6v1H7zM5 5h10v2H5zM3 7h14v2H3z" />
          <path fill="#ead9ad" d="M6 6h8v1H6z" />
          <path fill="#927452" d="M16 11h1v13h-1z" />
          <path fill="#7c8d9b" d="M15 11h4v2h-4z" />
        </>
      )}
      {role === "gong" && (
        <>
          <path fill="#433843" d="M6 5h8v3H6z" />
          <path fill="#d58970" d="M5 8h10v2H5zM14 9h2v4h-2z" />
          <path fill="#ead9ad" d="M7 16h4v6H7z" />
          <path fill="#907151" d="M16 14h1v8h-1z" />
          <path fill="#7c8d9b" d="M14 13h5v3h-5z" />
        </>
      )}
      {role === "sang" && (
        <>
          <path fill="#796044" d="M6 6h8v3H6zM8 4h4v2H8z" />
          <path fill="#c6a263" d="M5 8h10v1H5z" />
          <path fill="#897558" d="M15 13h3v8h-3z" />
          <path fill="#ead9ad" d="M15 14h2v1h-2zM15 18h2v1h-2z" />
        </>
      )}
    </svg>
  );
}

export function YutSticks({
  sticks,
  moving = false,
}: {
  sticks?: boolean[];
  moving?: boolean;
}) {
  return (
    <div
      className={`yut-sticks ${moving ? "is-tossing" : ""}`}
      aria-hidden="true"
    >
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className={`yut-stick ${sticks?.[index] ? "is-flat" : ""}`}
          style={{ "--stick-index": index } as React.CSSProperties}
        >
          <i />
          <i />
          <i />
        </span>
      ))}
    </div>
  );
}
