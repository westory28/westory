import React, { useEffect, useRef, useState } from "react";
import "./yut-entry-scene.css";

const asset = (file: string) =>
  `${import.meta.env.BASE_URL}assets/weplay/yut/${file}`;
const FRAMES = ["entry-toss-b.webp", "entry-toss-c.webp"];

/** Complete painted frames; no separated limbs, streaming media or polling. */
export function YutEntryScene() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false;
    // The small whole-art frame set stays available with reduced motion; save-data
    // users keep the shared still without downloading decorative frames.
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) return;
    const preload = FRAMES.map(
      (file) =>
        new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("entry-frame"));
          image.src = asset(file);
        }),
    );
    void Promise.all(preload)
      .then(() => {
        if (!disposed) setReady(true);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);
  return (
    <>
      <div
        ref={host}
        className="yut-entry-scene"
        data-scene-ready={ready}
        data-scene-visible={visible}
        data-scene-paused={paused}
        aria-hidden="true"
      >
        <img
          className="yut-entry-scene-frame yut-entry-scene-still"
          src={asset("catalog-toss.webp")}
          alt=""
          draggable={false}
        />
        {ready &&
          FRAMES.map((file, index) => (
            <img
              key={file}
              className={`yut-entry-scene-frame yut-entry-scene-frame--${index + 1}`}
              src={asset(file)}
              alt=""
              draggable={false}
            />
          ))}
      </div>
      {ready && (
        <button
          type="button"
          className="yut-icon-button yut-entry-motion-toggle"
          onClick={() => setPaused((value) => !value)}
          aria-label={paused ? "대기 그림 재생" : "대기 그림 멈추기"}
          title={paused ? "대기 그림 재생" : "대기 그림 멈추기"}
          aria-pressed={paused}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            {paused ? (
              <path d="M7 4v16l14-8Z" />
            ) : (
              <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
            )}
          </svg>
        </button>
      )}
    </>
  );
}
