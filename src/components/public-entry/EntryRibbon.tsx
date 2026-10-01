import { useEffect, useId, useRef, useState } from "react";
import { useEntryMotionEnabled } from "./EntryMotionContext";
import {
  createEntryBrush,
  type Curve,
  type Point,
} from "./entryRibbonGeometry";

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

/** A curved comet is absorbed into this scene, never joined at a section seam. */
export default function EntryRibbon({
  variant = "wrap",
}: {
  variant?: Variant;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const reveal = useRef<SVGPathElement>(null);
  const head = useRef<SVGCircleElement>(null);
  const enabled = useEntryMotionEnabled();
  const id = `entry-ink-${useId().replace(/:/g, "")}`;
  const [shape, setShape] = useState<
    ReturnType<typeof createEntryBrush> & {
      width: number;
      height: number;
    }
  >();

  useEffect(() => {
    const stage = svg.current?.parentElement;
    const scene = stage?.closest<HTMLElement>("[data-entry-scene]");
    if (!stage || !scene || !enabled) return;
    const source = stage.querySelector<HTMLElement>(".entry-hero-da");
    const target =
      stage.querySelector<HTMLElement>("[data-entry-absorb]") ??
      stage.querySelector<HTMLElement>(
        variant === "hero"
          ? ".entry-opening-screen"
          : variant === "finish"
            ? ".entry-finale-ri"
            : "[data-entry-absorb], .entry-motion-title .entry-type-mask:last-child > span",
      );
    if (!target) return;
    let frame = 0,
      startTime = 0,
      pausedAt = 0,
      glowTime = 0;
    let active = true,
      running = false,
      completed = false;
    let sourceInk: ReturnType<typeof letterStroke> | undefined;
    let pathLength = 0;
    let geometryKey = "";
    let measuredPath = "";
    scene.dataset.ink = "ready";
    target.setAttribute("data-ink-target", "");

    const measure = () => {
      const width = stage.offsetWidth,
        height = stage.offsetHeight;
      if (!width || !height) return;
      const box = stage.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      const sr = source?.getBoundingClientRect();
      const key = [
        width,
        height,
        tr.left - box.left,
        tr.top - box.top,
        tr.width,
        tr.height,
        sr ? sr.left - box.left : 0,
        sr ? sr.top - box.top : 0,
      ]
        .map((value) => value.toFixed(1))
        .join(":");
      if (key === geometryKey) return;
      geometryKey = key;
      const compact = window.innerWidth < 768;
      const edge = compact ? 16 : 32;
      let curves: Curve[];
      let startWidth: number | undefined;
      let end: Point = [
        tr.right - box.left - Math.min(64, tr.width * 0.2),
        tr.top - box.top + tr.height * 0.5,
      ];
      if (variant === "hero" && source) {
        const sr = source.getBoundingClientRect();
        const baseline = source
          .querySelector(".entry-hero-baseline")!
          .getBoundingClientRect();
        sourceInk ??= letterStroke(source, true);
        const start: Point = [
          sr.left - box.left + sourceInk.point[0],
          baseline.top - box.top + sourceInk.point[1],
        ];
        startWidth = sourceInk.width;
        // Land inside the opening screen, following its actual transformed bounds.
        end = [
          tr.right - box.left - tr.width * 0.12,
          tr.top - box.top + tr.height * 0.25,
        ];
        const side = width - edge;
        const turn: Point = [
          side - Math.min(40, width * 0.04),
          start[1] + Math.max(96, (end[1] - start[1]) * 0.5),
        ];
        curves = [
          [
            start,
            [start[0] + (side - start[0]) * 0.72, start[1]],
            [side, turn[1] - 80],
            turn,
          ],
          [
            turn,
            [2 * turn[0] - side, turn[1] + 80],
            [end[0] + 72, end[1] + 64],
            end,
          ],
        ];
      } else {
        if (variant === "finish") {
          const ink = letterStroke(target);
          const baseline = target
            .querySelector(".entry-finale-baseline")
            ?.getBoundingClientRect();
          end = [
            tr.left - box.left + ink.point[0],
            (baseline?.top ?? tr.bottom) - box.top + ink.point[1],
          ];
        }
        const side = width - edge;
        const start: Point = [
          Math.max(width * 0.54, end[0] - width * 0.2),
          Math.max(16, end[1] - 240),
        ];
        const shoulder: Point = [
          side - Math.min(32, width * 0.035),
          Math.max(start[1] + 32, end[1] - 64),
        ];
        curves = [
          [
            start,
            [start[0] + (side - start[0]) * 0.45, start[1] - 24],
            [side, shoulder[1] - 64],
            shoulder,
          ],
          [
            shoulder,
            [2 * shoulder[0] - side, shoulder[1] + 64],
            variant === "finish"
              ? [end[0], end[1] - 32]
              : [
                  end[0] + Math.max(8, (shoulder[0] - end[0]) * 0.45),
                  end[1] + 32,
                ],
            end,
          ],
        ];
      }
      setShape({
        ...createEntryBrush(
          curves.map(
            (curve) => curve.map(([x, y]) => [x / width, y / height]) as Curve,
          ),
          width,
          height,
          {
            compact,
            startWidth,
            taperStart: !source,
            taperEnd: true,
            emphasisSegment: 0,
          },
        ),
        width,
        height,
      });
    };
    const hide = () => {
      if (reveal.current) reveal.current.style.strokeDasharray = "0 2";
      head.current?.setAttribute("opacity", "0");
    };
    const clearGlow = () => {
      delete target.dataset.inkGlow;
      glowTime = 0;
    };
    const paint = (time: number) => {
      frame = 0;
      if (!active || document.hidden) return;
      const t = Math.max(0, Math.min(1, (time - startTime - 180) / 1600));
      const ease = (v: number) => {
        const x = Math.max(0, Math.min(1, v));
        return x * x * (3 - 2 * x);
      };
      const front = ease(t / 0.72);
      const tail = ease((t - 0.24) / 0.76);
      measure();
      const path = reveal.current;
      if (path) {
        path.style.strokeDasharray = `${Math.max(0, front - tail)} 2`;
        path.style.strokeDashoffset = String(-tail);
        if (measuredPath !== path.getAttribute("d")) {
          measuredPath = path.getAttribute("d") || "";
          pathLength = path.getTotalLength();
        }
        const point = path.getPointAtLength(pathLength * front);
        head.current?.setAttribute("cx", String(point.x));
        head.current?.setAttribute("cy", String(point.y));
        head.current?.setAttribute(
          "r",
          String((innerWidth < 768 ? 3 : 4) * (1 - ease((t - 0.72) / 0.28))),
        );
        head.current?.setAttribute("opacity", t > 0 && t < 1 ? "1" : "0");
      }
      if (t >= 0.72 && !glowTime) {
        target.dataset.inkGlow = "true";
        glowTime = window.setTimeout(clearGlow, 900);
      }
      if (t < 1) frame = requestAnimationFrame(paint);
      else {
        running = false;
        completed = true;
        scene.dataset.ink = "absorbed";
        hide();
      }
    };
    const inspect = () => {
      if (!active || document.hidden || running || completed) return;
      const rect = scene.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      // Reading the page at the top must never start the hero ink.
      const ready =
        variant === "hero"
          ? window.scrollY >= 96
          : variant === "finish"
            ? scene.dataset.entered === "true"
            : tr.top < innerHeight * 0.82;
      if (
        !ready ||
        rect.bottom <= 80 ||
        tr.bottom <= 80 ||
        tr.top >= innerHeight
      )
        return;
      measure();
      running = true;
      scene.dataset.ink = "running";
      startTime = performance.now();
      frame = requestAnimationFrame(paint);
    };
    const resize = () => {
      sourceInk = undefined;
      geometryKey = "";
      measure();
      inspect();
    };
    const scroll = () => {
      // Returning to the very top starts a fresh, scroll-triggered hero sequence.
      if (variant === "hero" && window.scrollY < 8) {
        cancelAnimationFrame(frame);
        frame = 0;
        running = false;
        completed = false;
        scene.dataset.ink = "ready";
        hide();
        if (reveal.current) reveal.current.style.strokeDasharray = "0 2";
        clearTimeout(glowTime);
        clearGlow();
      }
      inspect();
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (document.hidden) pausedAt = performance.now();
      else {
        if (pausedAt) startTime += performance.now() - pausedAt;
        pausedAt = 0;
        if (running) frame = requestAnimationFrame(paint);
        else inspect();
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    observer.observe(target);
    const finale = variant === "finish" ? new MutationObserver(inspect) : null;
    finale?.observe(scene, {
      attributes: true,
      attributeFilter: ["data-entered"],
    });
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    measure();
    inspect();
    void document.fonts.ready.then(() => {
      if (active) resize();
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      clearTimeout(glowTime);
      observer.disconnect();
      finale?.disconnect();
      clearGlow();
      hide();
      delete scene.dataset.ink;
      target.removeAttribute("data-ink-target");
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [variant, enabled]);

  if (!enabled) return null;

  return (
    <svg
      ref={svg}
      className={`entry-ribbon entry-ribbon--${variant}`}
      data-comet="true"
      viewBox={shape ? `0 0 ${shape.width} ${shape.height}` : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {shape && (
        <>
          <defs>
            <mask
              id={id}
              maskUnits="userSpaceOnUse"
              x="-32"
              y="-32"
              width={shape.width + 64}
              height={shape.height + 64}
            >
              <path
                ref={reveal}
                className="entry-comet-reveal"
                d={shape.center}
                pathLength="1"
                fill="none"
                stroke="white"
                strokeWidth="48"
                strokeLinecap="butt"
                strokeDasharray="0 2"
              />
            </mask>
          </defs>
          <path
            className="entry-ribbon-body"
            d={shape.outline}
            mask={`url(#${id})`}
          />
          <circle ref={head} className="entry-comet-head" r="0" opacity="0" />
        </>
      )}
    </svg>
  );
}
