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
    // Decorative movement can stay on the shared catalog still on slow/data-saving devices.
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (
      connection?.saveData ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
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
    <div
      ref={host}
      className="yut-entry-scene"
      data-scene-ready={ready}
      data-scene-visible={visible}
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
  );
}
