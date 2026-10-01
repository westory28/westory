import { RefObject, useLayoutEffect } from "react";
import { useEntryMotionEnabled } from "./EntryMotionContext";

/** Reveal the ending once, without intercepting scrolling or login focus. */
export function useEntryFinale(
  root: RefObject<HTMLDivElement>,
  suspended: boolean,
) {
  const motionEnabled = useEntryMotionEnabled();
  useLayoutEffect(() => {
    const scene = root.current?.querySelector<HTMLElement>(".entry-finish");
    if (!scene || !motionEnabled) return;
    if (typeof IntersectionObserver === "undefined") {
      scene.dataset.entered = "true";
      scene.dataset.finaleComplete = "true";
      return;
    }
    if (suspended || scene.dataset.entered === "true") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          !entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.55,
          )
        )
          return;
        scene.dataset.entered = "true";
        observer.disconnect();
      },
      { threshold: 0.55, rootMargin: "0px 0px -6% 0px" },
    );
    observer.observe(scene.querySelector(".entry-finale-brand") || scene);
    // A fast jump can pass the letters on a short screen; keep login visible.
    const actions = scene.querySelector(".entry-finish-actions");
    if (actions) observer.observe(actions);
    return () => observer.disconnect();
  }, [root, suspended, motionEnabled]);
}
