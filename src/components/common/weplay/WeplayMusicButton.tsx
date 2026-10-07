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
  const label = failed
    ? "배경음악 재시도"
    : enabled
      ? "소리 끄기"
      : "소리 켜기";
  return (
    <button
      type="button"
      className="weplay-music-button"
      aria-label={label}
      aria-pressed={enabled}
      title={
        failed
          ? "배경음악을 재생하지 못했습니다. 눌러서 다시 시도해 주세요."
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
    </button>
  );
}
