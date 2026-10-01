import { useEffect, useRef } from "react";
import { useEntryMotionEnabled } from "./EntryMotionContext";
import type { Point } from "./entryRibbonGeometry";
import { curvePath, journeyCurves } from "./entryJourneyGeometry";

type Variant = "hero" | "wide" | "wrap" | "left" | "finish";

// Measure both the position and the full width of the actual font's ㅣ ink.
function letterStroke(target: HTMLElement, origin = false) {
  const style = getComputedStyle(target);
  const size = parseFloat(style.fontSize);
  const fallback = {
    point: origin
      ? ([size * 0.98, -size * 0.43] as Point)
      : ([size * 0.82, -size * 0.76] as Point),
    width: size * 0.12,
  };
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 200;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.font = `${style.fontWeight} 100px ${style.fontFamily}`;
  ctx.fillText(origin ? "다" : "리", 16, 150);
  const { data } = ctx.getImageData(0, 0, 160, 200);
  if (origin) {
    // The rightmost horizontal arm of ㅏ: join one pixel inside its flat edge.
    for (let x = 130; x >= 86; x--) {
      for (let y = 25; y < 150; y++) {
        if (data[(y * 160 + x) * 4 + 3] < 128) continue;
        let top = y,
          bottom = y;
        while (top > 25 && data[((top - 1) * 160 + x - 2) * 4 + 3] >= 128)
          top--;
        while (
          bottom < 149 &&
          data[((bottom + 1) * 160 + x - 2) * 4 + 3] >= 128
        )
          bottom++;
        return {
          point: [
            ((x - 17) * size) / 100,
            (((top + bottom + 1) / 2 - 150) * size) / 100,
          ] as Point,
          width: ((bottom - top + 1) * size) / 100,
        };
      }
    }
    return fallback;
  }
  for (let y = 25; y < 150; y++) {
    let right = -1;
    for (let x = 130; x >= 86; x--) {
      if (data[(y * 160 + x) * 4 + 3] >= 128) {
        right = x;
        break;
      }
    }
    if (right < 0) continue;
    let left = right;
    while (left > 86 && data[(y * 160 + left - 1) * 4 + 3] >= 128) left--;
    return {
      point: [
        (((left + right + 1) / 2 - 16) * size) / 100,
        ((y - 148) * size) / 100,
      ] as Point,
      width: ((right - left + 1) * size) / 100,
    };
  }
  return fallback;
}

/** Mark a story stop without creating a clipped SVG in every section. */
export default function EntryRibbon({
  variant = "wrap",
}: {
  variant?: Variant;
}) {
  return <span hidden data-entry-waypoint={variant} />;
}

type Stop = {
  element: HTMLElement;
  scene: HTMLElement;
  stage: HTMLElement;
  variant: string;
};

/** One viewport-wide comet travels through every stop, across section boundaries. */
export function EntryJourney() {
  const svg = useRef<SVGSVGElement>(null);
  const trail = useRef<SVGPathElement>(null);
  const head = useRef<SVGCircleElement>(null);
  const enabled = useEntryMotionEnabled();

  useEffect(() => {
    const surface = svg.current;
    const page = surface?.closest<HTMLElement>(".public-entry");
    if (!surface || !page || !enabled) return;
    const stops: Stop[] = [];
    page
      .querySelectorAll<HTMLElement>("[data-entry-waypoint]")
      .forEach((marker) => {
        const stage = marker.parentElement;
        const scene = stage?.closest<HTMLElement>("[data-entry-scene]");
        const variant = marker.dataset.entryWaypoint || "wrap";
        const element = stage?.querySelector<HTMLElement>(
          variant === "hero"
            ? ".entry-opening-screen"
            : variant === "finish"
              ? ".entry-finale-ri"
              : "[data-entry-absorb], .entry-motion-title .entry-type-mask:last-child > span",
        );
        if (stage && scene && element)
          stops.push({ element, scene, stage, variant });
      });
    const origin = page.querySelector<HTMLElement>(".entry-hero-da");
    if (!origin || !stops.length) return;
    let frame = 0,
      arrival = 0,
      lastLeg = -1,
      lastProgress = 0,
      refreshUntil = 0;
    let disposed = false;
    const glowTimers = new Map<HTMLElement, number>();
    const inks = new Map<HTMLElement, ReturnType<typeof letterStroke>>();
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    const glyph = (element: HTMLElement, first: boolean): Point => {
      let ink = inks.get(element);
      if (!ink) {
        ink = letterStroke(element, first);
        inks.set(element, ink);
      }
      const rect = element.getBoundingClientRect();
      const baseline = element
        .querySelector(
          first ? ".entry-hero-baseline" : ".entry-finale-baseline",
        )
        ?.getBoundingClientRect();
      return [
        rect.left + ink.point[0],
        (baseline?.top ?? rect.bottom) + ink.point[1],
      ];
    };
    const hide = () => {
      surface.style.visibility = "hidden";
      head.current?.setAttribute("opacity", "0");
    };
    const glow = (element: HTMLElement) => {
      clearTimeout(glowTimers.get(element));
      element.dataset.inkGlow = "true";
      glowTimers.set(
        element,
        window.setTimeout(() => {
          delete element.dataset.inkGlow;
          glowTimers.delete(element);
        }, 600),
      );
    };
    const paint = (time: number) => {
      frame = 0;
      if (disposed || document.hidden) return;
      // A fixed body is used only for the finale; preserve its document offset.
      const y =
        page.dataset.finaleLocked === "true"
          ? -(parseFloat(document.body.style.top) || 0)
          : window.scrollY;
      if (y < 1 || page.hasAttribute("inert")) {
        hide();
        return;
      }
      const height = innerHeight,
        width = document.documentElement.clientWidth;
      surface.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const firstPoint = glyph(origin, true);
      const nodes = stops.map((stop, index) => {
        const rect = stop.element.getBoundingClientRect();
        const scene = stop.scene.getBoundingClientRect();
        const stage = stop.stage.getBoundingClientRect();
        const point: Point =
          stop.variant === "finish"
            ? glyph(stop.element, false)
            : stop.variant === "hero"
              ? [rect.right - rect.width * 0.12, rect.top + rect.height * 0.25]
              : [
                  rect.left + rect.width * (index % 2 ? 0.25 : 0.75),
                  rect.top + rect.height * 0.55,
                ];
        const pinned = getComputedStyle(stop.stage).position === "sticky";
        const naturalY = scene.top + y + point[1] - stage.top;
        const arrive =
          index === 0 ? 112 : Math.max(112, naturalY - height * 0.68);
        const depart =
          index === 0
            ? 320
            : Math.max(
                arrive + height * 0.22,
                pinned
                  ? scene.top + y + scene.height - stage.height - 80
                  : naturalY - height * 0.38,
              );
        return { ...stop, point, arrive, depart };
      });
      // Stop briefly inside the same element before emerging towards the next one.
      let leg = 0;
      while (leg < nodes.length - 1 && y > nodes[leg].depart) leg++;
      const from = leg === 0 ? firstPoint : nodes[leg - 1].point;
      const to = nodes[leg];
      const begin = leg === 0 ? 48 : nodes[leg - 1].depart;
      const end = Math.max(begin + 96, to.arrive);
      const progress = clamp((y - begin) / (end - begin));
      if (leg !== lastLeg || progress < 1) arrival = 0;
      if (progress >= 1 && (lastLeg !== leg || lastProgress < 1)) {
        arrival = time;
        glow(to.element);
      }
      lastLeg = leg;
      lastProgress = progress;
      const absorbed = arrival
        ? clamp((time - arrival) / 320)
        : progress === 1
          ? 1
          : 0;
      const path = trail.current;
      if (!path || progress === 0 || absorbed === 1) {
        hide();
      } else {
        surface.style.visibility = "visible";
        path.setAttribute(
          "d",
          curvePath(journeyCurves(from, to.point, width, leg)),
        );
        const tail = Math.max(0, progress - 0.22 * (1 - absorbed));
        path.style.strokeDasharray = `${Math.max(0, progress - tail)} 2`;
        path.style.strokeDashoffset = String(-tail);
        const point = path.getPointAtLength(path.getTotalLength() * progress);
        head.current?.setAttribute("cx", String(point.x));
        head.current?.setAttribute("cy", String(point.y));
        head.current?.setAttribute(
          "r",
          String((width < 768 ? 3 : 4) * (1 - absorbed)),
        );
        head.current?.setAttribute("opacity", "1");
      }
      surface.dataset.leg = String(leg);
      surface.dataset.progress = progress.toFixed(4);
      surface.dataset.from =
        leg === 0 ? "hero-title" : nodes[leg - 1].scene.id || "hero-screen";
      surface.dataset.to = to.scene.id || "hero-screen";
      // Follow short entrance transforms, then become idle until the next scroll.
      if ((arrival && absorbed < 1) || time < refreshUntil)
        frame = requestAnimationFrame(paint);
    };
    const request = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(paint);
    };
    const resize = () => {
      inks.clear();
      refreshUntil = performance.now() + 650;
      request();
    };
    const scroll = () => {
      refreshUntil = performance.now() + 650;
      request();
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (document.hidden) hide();
      else request();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(page);
    stops.forEach(({ element }) => observer.observe(element));
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    void document.fonts.ready.then(() => {
      if (!disposed) resize();
    });
    request();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      glowTimers.forEach((timer, element) => {
        clearTimeout(timer);
        delete element.dataset.inkGlow;
      });
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <svg
      ref={svg}
      className="entry-journey"
      data-comet="true"
      aria-hidden="true"
      focusable="false"
    >
      <path
        ref={trail}
        className="entry-journey-trail"
        pathLength="1"
        strokeDasharray="0 2"
      />
      <circle ref={head} className="entry-comet-head" r="0" opacity="0" />
    </svg>
  );
}
