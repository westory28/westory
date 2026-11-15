import type { CSSProperties } from "react";
import type { DrumKind } from "./rhythmCore";
export const rhythmAsset = (name: string) =>
  `${import.meta.env.BASE_URL}assets/weplay/rhythm/v2/${name}.webp`;
export function RhythmMascot({ className = "" }: { className?: string }) {
  return (
    <img
      className={`rhythm-mascot ${className}`}
      src={rhythmAsset("mascot")}
      alt=""
      draggable={false}
      width={512}
      height={512}
    />
  );
}
export function RhythmNoteArt({ kind }: { kind: DrumKind }) {
  return (
    <img
      src={rhythmAsset(`note-${kind}`)}
      alt=""
      draggable={false}
      width={128}
      height={128}
    />
  );
}
export function RhythmBrand() {
  return (
    <img
      className="rhythm-brand"
      src={rhythmAsset("title-logo")}
      alt="덩기덕 쿵더락"
      width={960}
      height={480}
      draggable={false}
    />
  );
}
export function RhythmCover() {
  return (
    <div
      className="rhythm-cover"
      aria-hidden="true"
      style={
        {
          "--rh-background": `url("${rhythmAsset("bg-stage")}")`,
        } as CSSProperties
      }
    >
      <RhythmBrand />
      <RhythmMascot />
      <span className="rhythm-cover-note rhythm-cover-note--one">
        <RhythmNoteArt kind="center" />
      </span>
      <span className="rhythm-cover-note rhythm-cover-note--two">
        <RhythmNoteArt kind="rim" />
      </span>
    </div>
  );
}
export function RhythmOrientationGuide() {
  return (
    <svg
      className="rhythm-orientation-animation"
      width="80"
      height="80"
      viewBox="0 0 72 72"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g className="rhythm-orientation-arrow">
        <path d="M36 6a30 30 0 0 1 30 30m-5-5 5 5 5-5" />
      </g>
      <g className="rhythm-orientation-phone">
        <rect x="26" y="19" width="20" height="34" rx="4" fill="#fff3d6" />
        <path d="M32 23h8M34 48h4" />
      </g>
    </svg>
  );
}
export function RhythmIcon({
  name,
}: {
  name: "sound" | "muted" | "pause" | "expand" | "collapse" | "play";
}) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "play" && <path d="m8 4 12 8-12 8Z" fill="currentColor" />}
      {name === "pause" && <path d="M8 5v14M16 5v14" strokeWidth="4" />}
      {(name === "expand" || name === "collapse") && (
        <path
          d={
            name === "expand"
              ? "M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6"
              : "M3 9h6V3m6 0v6h6M9 21v-6H3m18 0h-6v6"
          }
        />
      )}
      {(name === "sound" || name === "muted") && (
        <>
          <path d="m11 4-6 5H2v6h3l6 5Z" fill="currentColor" />
          {name === "sound" ? (
            <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
          ) : (
            <path d="m16 9 6 6m0-6-6 6" />
          )}
        </>
      )}
    </svg>
  );
}
