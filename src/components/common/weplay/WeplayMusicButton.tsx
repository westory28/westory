import React from "react";
import "./weplay-music.css";

export default function WeplayMusicButton({
  enabled,
  failed,
  toggle,
}: {
  enabled: boolean;
  failed: boolean;
  toggle: () => void;
}) {
  const label = failed ? "음악 재시도" : enabled ? "음악 끄기" : "음악 켜기";
  return (
    <button
      type="button"
      className="weplay-music-button"
      aria-label={`배경${label}`}
      aria-pressed={enabled}
      title={
        failed
          ? "음악을 재생하지 못했습니다. 눌러서 다시 시도해 주세요."
          : label
      }
      onClick={toggle}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M11 4 5 9H2v6h3l6 5V4Z" />
        {enabled ? (
          <>
            <path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
          </>
        ) : (
          <path d="m16 9 6 6m0-6-6 6" />
        )}
      </svg>
      <span>{label}</span>
    </button>
  );
}
