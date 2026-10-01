import { RefObject, useEffect, useState } from "react";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function sceneProgress(
  rect: DOMRect,
  stageHeight: number,
  viewport: number,
  timeline: boolean,
) {
  if (timeline && viewport < 700) {
    return clamp(
      (viewport * 0.82 - rect.top) / (viewport * 0.65 + rect.height * 0.3),
    );
  }
  return clamp((80 - rect.top) / Math.max(1, rect.height - stageHeight));
}

/** A small SVG chart needs numeric progress; the other scenes stay CSS-driven. */
export function useEntrySceneProgress(root: RefObject<HTMLElement>) {
  const [progress, setProgress] = useState(1);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const read = () => {
      frame = 0;
      if (preference.matches) {
        setProgress(1);
        return;
      }
      const scene = root.current;
      if (!scene || document.hidden) return;
      const rect = scene.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) return;
      const stage = scene.firstElementChild as HTMLElement;
      const next = sceneProgress(rect, stage.offsetHeight, innerHeight, true);
      setProgress(Math.round(next * 200) / 200);
    };
    const request = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(read);
    };
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request, { passive: true });
    document.addEventListener("visibilitychange", request);
    if (preference.addEventListener)
      preference.addEventListener("change", request);
    else preference.addListener(request);
    request();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
      document.removeEventListener("visibilitychange", request);
      if (preference.removeEventListener)
        preference.removeEventListener("change", request);
      else preference.removeListener(request);
    };
  }, [root]);
  return progress;
}

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
      if (
        document.hidden ||
        preference.matches ||
        page.dataset.finaleLocked === "true"
      )
        return;
      const viewport = window.innerHeight;
      // Read layout in one pass, then write only compositor properties via CSS variables.
      const positions = scenes.map((scene) => ({
        scene,
        rect: scene.getBoundingClientRect(),
        stage: scene.firstElementChild?.getBoundingClientRect(),
      }));
      for (const { scene, rect, stage } of positions) {
        if (rect.bottom < 0 || rect.top > viewport) continue;
        const progress = sceneProgress(
          rect,
          stage?.height || viewport - 80,
          viewport,
          scene.hasAttribute("data-entry-timeline"),
        );
        const enter = clamp((viewport - rect.top) / Math.max(1, viewport - 80));
        const pass = clamp(
          (viewport * 0.8 - rect.top) / (rect.height + viewport * 0.35),
        );
        const pinned = stage && rect.height > stage.height + 100;
        const ribbon = pinned
          ? enter * 0.18 + progress * 0.82
          : clamp((viewport * 0.85 - rect.top) / Math.max(1, rect.height));
        scene.style.setProperty("--scene", progress.toFixed(4));
        scene.style.setProperty("--enter", enter.toFixed(4));
        scene.style.setProperty("--pass", pass.toFixed(4));
        scene.style.setProperty("--ribbon", ribbon.toFixed(4));
        scene.style.setProperty(
          "--phase",
          clamp((progress - 0.15) / 0.7).toFixed(4),
        );
      }
    };
    const request = () => {
      page.dataset.scrolled = String(
        window.scrollY > 600 || page.dataset.finaleLocked === "true",
      );
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
          scene.style.removeProperty("--pass");
          scene.style.removeProperty("--ribbon");
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
    const reveals = Array.from(
      page.querySelectorAll<HTMLElement>("[data-entry-reveal]"),
    );
    const entrance =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const scene =
                  entry.target.closest<HTMLElement>("[data-entry-scene]");
                if (scene) scene.dataset.entered = "true";
                entrance?.unobserve(entry.target);
              }
            },
            { threshold: 0.3, rootMargin: "0px 0px -12% 0px" },
          );
    reveals.forEach((element) => {
      if (entrance) entrance.observe(element);
      else
        element
          .closest<HTMLElement>("[data-entry-scene]")
          ?.setAttribute("data-entered", "true");
    });
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
      entrance?.disconnect();
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
      document.removeEventListener("visibilitychange", visibility);
      if (preference.removeEventListener)
        preference.removeEventListener("change", sync);
      else preference.removeListener(sync);
    };
  }, [root]);
}
