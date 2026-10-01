import { RefObject, useEffect, useState } from "react";
import { useEntryMotionEnabled } from "./EntryMotionContext";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const settleDistance = 0.0005;
const motionProperties = [
  "--scene",
  "--enter",
  "--phase",
  "--pass",
  "--ribbon",
  "--open",
  "--hero-reveal",
  "--thought-reveal",
  "--connect-reveal",
  "--title-enter",
] as const;
type MotionProperty = (typeof motionProperties)[number];
type MotionValues = Partial<Record<MotionProperty, number>>;

function approach(current: number, target: number, elapsed: number) {
  const next = current + (target - current) * (1 - Math.exp(-elapsed / 100));
  return Math.abs(target - next) < settleDistance ? target : next;
}

function sceneProgress(
  rect: DOMRect,
  stageHeight: number,
  viewport: number,
  timeline: boolean,
) {
  if (timeline && viewport < 700) {
    return clamp(
      (viewport * 0.9 - rect.top) / (viewport * 0.35 + rect.height * 0.15),
    );
  }
  if (rect.height <= stageHeight + 100) {
    return clamp(
      (viewport * 0.9 - rect.top) / (viewport * 0.3 + rect.height * 0.3),
    );
  }
  return clamp(
    (80 - rect.top) / Math.max(1, (rect.height - stageHeight) * 0.6),
  );
}

/** The graph keeps reading time before and after its full scroll interval. */
export function useEntrySceneProgress(
  root: RefObject<HTMLElement>,
  visual: RefObject<SVGSVGElement>,
) {
  const enabled = useEntryMotionEnabled();
  const [progress, setProgress] = useState(enabled ? 0 : 1);
  useEffect(() => {
    if (!enabled) {
      setProgress(1);
      return;
    }
    let frame = 0;
    let previousTime = 0;
    let dirty = true;
    let current = 0;
    let target = 0;
    let visible = false;
    const update = (time: number) => {
      frame = 0;
      const scene = root.current;
      const chart = visual.current;
      if (!scene || !chart || document.hidden) return;
      if (dirty) {
        dirty = false;
        const rect = scene.getBoundingClientRect();
        const chartRect = chart.getBoundingClientRect();
        visible = chartRect.bottom >= 0 && chartRect.top <= innerHeight;
        if (visible) {
          const stage = scene.querySelector<HTMLElement>(".entry-stage");
          const style = stage ? getComputedStyle(stage) : null;
          const distance = rect.height - (stage?.offsetHeight || rect.height);
          if (style?.position === "sticky" && distance > 100) {
            const inset = parseFloat(style.top);
            const travelled =
              ((Number.isFinite(inset) ? inset : 80) - rect.top) / distance;
            // Preserve the opening 12% and the completed final 10% of the stage.
            target = clamp((travelled - 0.12) / 0.78);
          } else {
            // On a flowing page, wait for the graph itself rather than its heading.
            const start = innerHeight * 0.8;
            const finish = Math.max(80, innerHeight * 0.2);
            target = clamp(
              (start - chartRect.top) / Math.max(1, start - finish),
            );
          }
        }
      }
      if (!visible) {
        previousTime = 0;
        return;
      }
      const elapsed = previousTime ? Math.min(64, time - previousTime) : 16.67;
      previousTime = time;
      const next = approach(current, target, elapsed);
      if (next !== current) {
        current = next;
        setProgress(next);
      }
      if (current !== target) frame = requestAnimationFrame(update);
      else previousTime = 0;
    };
    const request = () => {
      dirty = true;
      if (!frame && !document.hidden) frame = requestAnimationFrame(update);
    };
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        previousTime = 0;
      } else request();
    };
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(request);
    if (root.current) resize?.observe(root.current);
    if (visual.current) resize?.observe(visual.current);
    const stage = root.current?.querySelector<HTMLElement>(".entry-stage");
    if (stage) resize?.observe(stage);
    setProgress(0);
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
  }, [root, visual, enabled]);
  return enabled ? progress : 1;
}

/** Native scrolling stays in control; only the visual progress is softened. */
export function useEntryMotion(root: RefObject<HTMLDivElement>) {
  const enabled = useEntryMotionEnabled();
  useEffect(() => {
    const page = root.current;
    if (!page) return;
    const scenes = Array.from(
      page.querySelectorAll<HTMLElement>("[data-entry-scene]"),
    );
    const states = scenes.map((scene) => ({
      scene,
      stage: scene.querySelector<HTMLElement>(".entry-stage"),
      title: scene.querySelector<HTMLElement>(".entry-motion-title"),
      current: {} as MotionValues,
      target: {} as MotionValues,
      visible: false,
    }));
    const fitStages = () => {
      states.forEach(({ scene, stage }) => {
        if (
          stage &&
          (getComputedStyle(stage).position === "sticky" ||
            scene.dataset.stageOverflow === "true")
        ) {
          let contentHeight = stage.scrollHeight;
          const preview = stage.querySelector<HTMLElement>(
            "[data-entry-slide-stage]",
          );
          const copy = stage.querySelector<HTMLElement>(".entry-confirm-copy");
          if (preview && copy) {
            // The compact preview has its own scroll track; it is not content overflow.
            const style = getComputedStyle(stage);
            contentHeight =
              (innerWidth < 768
                ? copy.offsetHeight +
                  preview.offsetHeight +
                  parseFloat(style.rowGap)
                : Math.max(copy.offsetHeight, preview.offsetHeight)) +
              parseFloat(style.paddingTop) +
              parseFloat(style.paddingBottom);
          }
          const overflow = String(contentHeight > innerHeight - 78);
          if (scene.dataset.stageOverflow !== overflow)
            scene.dataset.stageOverflow = overflow;
        }
      });
    };
    let frame = 0;
    let previousTime = 0;
    let dirty = true;
    let needsFit = true;
    const update = (time: number) => {
      frame = 0;
      if (document.hidden || !enabled) return;
      if (needsFit) {
        needsFit = false;
        fitStages();
      }
      if (dirty) {
        dirty = false;
        const viewport = window.innerHeight;
        // Layout is read only after scroll/resize, not on every damping frame.
        const positions = states.map((state) => ({
          state,
          rect: state.scene.getBoundingClientRect(),
          stage: state.stage?.getBoundingClientRect(),
          title: state.title?.getBoundingClientRect(),
        }));
        for (const { state, rect, stage, title } of positions) {
          state.visible = rect.bottom >= 0 && rect.top <= viewport;
          if (!state.visible) continue;
          const progress = sceneProgress(
            rect,
            stage?.height || viewport - 80,
            viewport,
            state.scene.hasAttribute("data-entry-timeline"),
          );
          const enter = clamp((viewport * 0.95 - rect.top) / (viewport * 0.35));
          const pinned = stage && rect.height > stage.height + 100;
          const target: MotionValues = {
            "--scene": progress,
            "--enter": enter,
            "--pass": clamp(
              (viewport * 0.8 - rect.top) / (rect.height + viewport * 0.35),
            ),
            "--ribbon": pinned
              ? enter * 0.18 + progress * 0.82
              : clamp((viewport * 0.85 - rect.top) / Math.max(1, rect.height)),
            "--phase": clamp((progress - 0.15) / 0.7),
          };
          if (title)
            target["--title-enter"] = clamp(
              (viewport * 0.95 - title.top) / (viewport * 0.3),
            );
          if (state.scene.classList.contains("entry-hero")) {
            const travelled = Math.max(0, 80 - rect.top);
            target["--hero-reveal"] = clamp(travelled / 48);
            target["--thought-reveal"] = clamp(travelled / 40);
            target["--connect-reveal"] = clamp((travelled - 16) / 48);
            target["--open"] = clamp(0.06 + travelled / 96);
          }
          state.target = target;
        }
      }
      const elapsed = previousTime ? Math.min(64, time - previousTime) : 16.67;
      previousTime = time;
      let pending = false;
      for (const state of states) {
        if (!state.visible) continue;
        for (const property of motionProperties) {
          const target = state.target[property];
          if (target === undefined) continue;
          const current = state.current[property] ?? target;
          const next = approach(current, target, elapsed);
          if (state.current[property] !== next) {
            state.current[property] = next;
            state.scene.style.setProperty(property, next.toFixed(5));
          }
          pending ||= next !== target;
        }
      }
      if (pending) frame = window.requestAnimationFrame(update);
      else previousTime = 0;
    };
    const request = () => {
      page.dataset.scrolled = String(window.scrollY > 600);
      dirty = true;
      if (!frame && !document.hidden && enabled)
        frame = window.requestAnimationFrame(update);
    };
    const onResize = () => {
      needsFit = true;
      request();
    };
    const visibility = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(frame);
        frame = 0;
        previousTime = 0;
      } else request();
    };
    const resize =
      !enabled || typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(onResize);
    resize?.observe(page);
    states.forEach(({ stage }) => {
      if (stage) resize?.observe(stage);
    });
    const entrances = new Map<Element, () => void>();
    page
      .querySelectorAll<HTMLElement>("[data-entry-reveal]")
      .forEach((element) => {
        entrances.set(element, () => {
          const scene = element.closest<HTMLElement>("[data-entry-scene]");
          if (scene) scene.dataset.entered = "true";
        });
      });
    page
      .querySelectorAll<HTMLElement>(".entry-overview > button")
      .forEach((badge) => {
        entrances.set(badge, () => {
          badge.dataset.badgeEntered = "true";
        });
      });
    page
      .querySelectorAll<HTMLElement>(".entry-section-glow")
      .forEach((glow) => {
        entrances.set(glow, () => {
          glow.dataset.glowEntered = "true";
          const scene = glow.closest<HTMLElement>("[data-entry-scene]");
          if (scene) scene.dataset.glowEntered = "true";
        });
      });
    const entrance =
      !enabled || typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                entrances.get(entry.target)?.();
                entrance?.unobserve(entry.target);
              }
            },
            { threshold: 0.12, rootMargin: "0px 0px -4% 0px" },
          );
    entrances.forEach((enter, element) => {
      if (!enabled) return;
      if (entrance) entrance.observe(element);
      else enter();
    });
    const titleEntrance =
      !enabled || typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                (entry.target as HTMLElement).dataset.titleEntered = "true";
                titleEntrance?.unobserve(entry.target);
              }
            },
            { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
          );
    states.forEach(({ title }) => {
      if (!enabled || !title) return;
      if (titleEntrance) titleEntrance.observe(title);
      else title.dataset.titleEntered = "true";
    });
    page.dataset.motion = enabled ? "on" : "off";
    if (!enabled)
      scenes.forEach((scene) => {
        motionProperties.forEach((property) =>
          scene.style.removeProperty(property),
        );
      });
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    request();
    return () => {
      window.cancelAnimationFrame(frame);
      resize?.disconnect();
      entrance?.disconnect();
      titleEntrance?.disconnect();
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [root, enabled]);
}
