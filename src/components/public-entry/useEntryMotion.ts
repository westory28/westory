import { RefObject, useEffect } from "react";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Native scrolling is the timeline, including touch, keyboard and reverse travel. */
export function useEntryMotion(root: RefObject<HTMLDivElement>) {
  useEffect(() => {
    const page = root.current;
    if (!page) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const scenes = Array.from(
      page.querySelectorAll<HTMLElement>("[data-entry-scene]"),
    );
    let frame = 0;
    const update = () => {
      frame = 0;
      if (document.hidden || preference.matches) return;
      const viewport = window.innerHeight;
      page.style.setProperty(
        "--story",
        clamp(
          (window.scrollY + viewport * 0.65 - 700) /
            Math.max(1, page.offsetHeight - 1000),
        ).toFixed(4),
      );
      // Read layout in one pass, then write only compositor properties via CSS variables.
      const positions = scenes.map((scene) => ({
        scene,
        rect: scene.getBoundingClientRect(),
        stage: scene.firstElementChild?.getBoundingClientRect(),
      }));
      for (const { scene, rect, stage } of positions) {
        if (rect.bottom < 0 || rect.top > viewport) continue;
        const travel = Math.max(
          1,
          rect.height - (stage?.height || viewport - 80),
        );
        const progress = clamp((80 - rect.top) / travel);
        const enter = clamp((viewport - rect.top) / Math.max(1, viewport - 80));
        scene.style.setProperty("--scene", progress.toFixed(4));
        scene.style.setProperty("--enter", enter.toFixed(4));
        scene.style.setProperty(
          "--phase",
          clamp((progress - 0.15) / 0.7).toFixed(4),
        );
      }
    };
    const request = () => {
      page.dataset.scrolled = String(window.scrollY > 600);
      if (!frame && !document.hidden && !preference.matches)
        frame = window.requestAnimationFrame(update);
    };
    const sync = () => {
      page.dataset.motion = preference.matches ? "off" : "on";
      page.dataset.scrolled = String(window.scrollY > 600);
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      if (preference.matches) {
        scenes.forEach((scene) => {
          scene.style.removeProperty("--scene");
          scene.style.removeProperty("--enter");
          scene.style.removeProperty("--phase");
        });
      } else request();
    };
    const visibility = () => {
      if (document.hidden) {
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
      } else request();
    };
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(request);
    resize?.observe(page);
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    if (preference.addEventListener)
      preference.addEventListener("change", sync);
    else preference.addListener(sync);
    sync();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
      document.removeEventListener("visibilitychange", visibility);
      if (preference.removeEventListener)
        preference.removeEventListener("change", sync);
      else preference.removeListener(sync);
    };
  }, [root]);
}
