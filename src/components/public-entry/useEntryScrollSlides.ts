import { useEffect, useState, type RefObject } from "react";
import { useEntryMotionEnabled } from "./EntryMotionContext";

/** Give each preview a full reading interval, without intercepting scrolling. */
export function useEntryScrollSlides(
  root: RefObject<HTMLElement>,
  minimumHeight: number,
) {
  const enabled = useEntryMotionEnabled();
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let lastAutomaticSlide: number | null = null;
    const read = () => {
      frame = 0;
      const scene = root.current;
      if (!scene || document.hidden || innerHeight < minimumHeight) return;
      const stage = scene.querySelector<HTMLElement>(".entry-stage");
      if (!stage) return;
      const style = getComputedStyle(stage);
      if (style.position !== "sticky") return;
      const rect = scene.getBoundingClientRect();
      if (rect.top >= innerHeight || rect.bottom <= 0) return;
      const distance = rect.height - stage.offsetHeight;
      if (distance <= 100) return;
      const progress = Math.max(
        0,
        Math.min(1, (parseFloat(style.top) - rect.top) / distance),
      );
      let next = lastAutomaticSlide ?? Math.min(2, Math.floor(progress / 0.34));
      // A little scroll jitter at a boundary must not switch back and forth.
      while (next < 2 && progress >= (next + 1) * 0.34 + 0.025) next++;
      while (next > 0 && progress < next * 0.34 - 0.025) next--;
      if (next !== lastAutomaticSlide) {
        lastAutomaticSlide = next;
        setSlide(next);
      }
    };
    const request = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(read);
    };
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else request();
    };
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(request);
    if (root.current) resize?.observe(root.current);
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    request();
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [root, enabled, minimumHeight]);

  // Manual selection stays until the next automatic scroll boundary is crossed.
  return [slide, setSlide] as const;
}
