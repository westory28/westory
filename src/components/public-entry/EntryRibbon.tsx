import { useEffect, useId, useRef, useState } from "react";
import {
  createEntryBrush,
  type Curve,
  type Point,
} from "./entryRibbonGeometry";

type Variant = "hero" | "wide" | "wrap" | "left" | "finish";

// Read layout coordinates without the title's entrance animation transform.
function layoutBox(element: HTMLElement, stage: HTMLElement) {
  let left = 0,
    top = 0;
  let node: HTMLElement | null = element;
  while (node && node !== stage) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return {
    left,
    top,
    right: left + element.offsetWidth,
    bottom: top + element.offsetHeight,
  };
}

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

/** One solid, pressure-shaped stroke, routed through the composition's whitespace. */
export default function EntryRibbon({
  variant = "wrap",
}: {
  variant?: Variant;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const id = `entry-ink-${useId().replace(/:/g, "")}`;
  const [shape, setShape] = useState<
    ReturnType<typeof createEntryBrush> & {
      width: number;
      height: number;
      endWidth?: number;
      startWidth?: number;
    }
  >();

  useEffect(() => {
    const stage = svg.current?.parentElement;
    if (!stage) return;
    const scene = stage.closest<HTMLElement>("[data-entry-scene]");
    const source = stage.querySelector<HTMLElement>(".entry-hero-da");
    const target = stage.querySelector<HTMLElement>(".entry-finale-ri");
    const anchor = stage.querySelector<HTMLElement>(
      ".entry-motion-title .entry-type-mask:last-child > span",
    );
    let active = true;
    let visible = true;
    let frame = 0;
    let introUntil = 0;
    let sourceInk: ReturnType<typeof letterStroke> | undefined;
    const measure = () => {
      frame = 0;
      if (!active || document.hidden) return;
      const width = stage.offsetWidth,
        height = stage.offsetHeight;
      if (!width || !height) return;
      const compact = window.innerWidth < 768;
      const edge = compact ? 10 : 16;
      const joinX = compact ? 48 : 96;
      const joinY = compact ? 24 : 32;
      const center = width / 2;
      const side = width - edge;
      const stageRect = stage.getBoundingClientRect();
      let curves: Curve[];
      let emphasisSegment: number | undefined;
      let endWidth: number | undefined;
      let startWidth: number | undefined;
      let taperStart = false;

      // Pixel coordinates make tangents identical across stages of different widths.
      if (variant === "finish" && target) {
        const tr = target.getBoundingClientRect();
        const baseline = target
          .querySelector(".entry-finale-baseline")
          ?.getBoundingClientRect();
        const ink = letterStroke(target);
        const end: Point = [
          tr.left + ink.point[0] - stageRect.left,
          (baseline?.top ?? tr.bottom) + ink.point[1] - stageRect.top,
        ];
        endWidth = ink.width;
        const guideX = Math.min(side, end[0] + 32);
        const guideY = end[1] * 0.42;
        curves = [
          [
            [center, 0],
            [center - joinX, joinY],
            [guideX, guideY * 0.25],
            [guideX, guideY],
          ],
          [
            [guideX, guideY],
            [guideX, end[1] * 0.68],
            [end[0], end[1] * 0.84],
            end,
          ],
        ];
      } else if (variant === "hero" && source) {
        const sr = source.getBoundingClientRect();
        const baseline = source
          .querySelector(".entry-hero-baseline")!
          .getBoundingClientRect();
        sourceInk ??= letterStroke(source, true);
        const start: Point = [
          sr.left + sourceInk.point[0] - stageRect.left,
          baseline.top + sourceInk.point[1] - stageRect.top,
        ];
        startWidth = sourceInk.width;
        const visual = stage.querySelector<HTMLElement>(".entry-hero-visual");
        const bottom = visual ? layoutBox(visual, stage).bottom : height - 128;
        const radius = Math.min(compact ? 96 : 180, (side - start[0]) * 0.8);
        const turnY = Math.max(
          start[1] + radius + 40,
          bottom - (compact ? 72 : 120),
        );
        curves = [
          [
            start,
            [start[0] + (side - start[0]) * 0.7, start[1]],
            [side, start[1] + radius * 0.4],
            [side, start[1] + radius],
          ],
          [
            [side, start[1] + radius],
            [side, start[1] + radius + 64],
            [side, turnY - 64],
            [side, turnY],
          ],
          [
            [side, turnY],
            [side, turnY + (height - turnY) * 0.65],
            [center + joinX, height - joinY],
            [center, height],
          ],
        ];
        emphasisSegment = 0;
      } else {
        const ar = anchor
          ? layoutBox(anchor, stage)
          : {
              left: width * 0.3,
              right: width * 0.7,
              top: height * 0.15,
              bottom: height * 0.25,
            };
        const titleRows = Array.from(
          stage.querySelectorAll<HTMLElement>(
            ".entry-motion-title .entry-type-mask > span",
          ),
        );
        const rowBoxes = titleRows.map((element) => layoutBox(element, stage));
        const menuNumber =
          stage.querySelector<HTMLElement>(".entry-menu-number");
        const menuLeft = menuNumber
          ? layoutBox(menuNumber, stage).left
          : ar.left;
        const outside = Math.max(
          edge,
          Math.min(ar.left, menuLeft, ...rowBoxes.map((r) => r.left)) -
            (window.innerWidth < 1024 ? 32 : 56),
        );
        const approachY = Math.max(
          48,
          Math.min(ar.top - 24, ...rowBoxes.map((r) => r.top - 16)),
        );
        const titleY = ar.bottom + 12;
        const left = Math.max(edge + 32, ar.left + (ar.right - ar.left) * 0.1);
        const right = Math.min(
          side - 16,
          ar.right - (ar.right - ar.left) * 0.08,
        );
        // Turn back toward the shared endpoint only below the final content row.
        const contentBottom = Math.max(
          titleY,
          ...Array.from(stage.children)
            .filter((node): node is HTMLElement => node instanceof HTMLElement)
            .map((node) => layoutBox(node, stage).bottom),
        );
        const turnY = Math.max(
          titleY + 96,
          Math.min(height * 0.78, contentBottom - 48),
        );
        // An elliptical shoulder uses the available whitespace, never a 16px elbow.
        const shoulder = Math.min(
          compact ? 64 : 120,
          Math.max(32, (side - right) * 0.6),
        );
        curves = [
          [
            [center, 0],
            [center - joinX, joinY],
            [outside, Math.max(joinY, approachY * 0.2)],
            [outside, approachY],
          ],
          [
            [outside, approachY],
            [outside, approachY + (titleY - approachY) * 0.65],
            [left - (left - outside) * 0.55, titleY],
            [left, titleY],
          ],
          [
            [left, titleY],
            [left + (right - left) / 3, titleY],
            [right - (right - left) / 3, titleY],
            [right, titleY],
          ],
          [
            [right, titleY],
            [right + (side - right) * 0.55, titleY],
            [side, titleY + shoulder * 0.45],
            [side, titleY + shoulder],
          ],
          [
            [side, titleY + shoulder],
            [side, titleY + shoulder + (turnY - titleY - shoulder) / 3],
            [side, turnY - (turnY - titleY - shoulder) / 3],
            [side, turnY],
          ],
          [
            [side, turnY],
            [side, turnY + (height - turnY) * 0.72],
            [center + joinX, height - joinY],
            [center, height],
          ],
        ];
        emphasisSegment = 2;
      }
      const normalized = curves.map(
        (curve) => curve.map(([x, y]) => [x / width, y / height]) as Curve,
      );
      setShape({
        ...createEntryBrush(normalized, width, height, {
          compact,
          emphasisSegment,
          taperStart,
          startWidth,
          endWidth,
        }),
        width,
        height,
        endWidth,
        startWidth,
      });
      if (variant === "hero" && visible && performance.now() < introUntil)
        frame = requestAnimationFrame(measure);
    };
    const request = () => {
      if (!frame && active && !document.hidden)
        frame = requestAnimationFrame(measure);
    };
    const remeasure = () => {
      sourceInk = undefined;
      request();
    };
    const observer = new ResizeObserver(remeasure);
    observer.observe(stage);
    stage
      .querySelectorAll<HTMLElement>(
        ".entry-motion-title, .entry-hero-da, .entry-finale-ri",
      )
      .forEach((element) => observer.observe(element));
    // Only the hero needs to follow a transformed object while scrolling.
    const visibility =
      variant === "hero"
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible) request();
          })
        : null;
    if (visibility) visibility.observe(stage);
    const motion =
      variant === "hero"
        ? new MutationObserver((records) => {
            if (
              records.some((record) => record.attributeName === "data-entered")
            )
              introUntil = performance.now() + 1400;
            if (visible) request();
          })
        : null;
    if (motion && scene)
      motion.observe(scene, {
        attributes: true,
        attributeFilter: ["style", "data-entered"],
      });
    if (scene?.dataset.entered === "true")
      introUntil = performance.now() + 1400;
    window.addEventListener("resize", remeasure, { passive: true });
    document.addEventListener("visibilitychange", request);
    measure();
    void document.fonts.ready.then(remeasure);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      visibility?.disconnect();
      motion?.disconnect();
      window.removeEventListener("resize", remeasure);
      document.removeEventListener("visibilitychange", request);
    };
  }, [variant]);

  return (
    <svg
      ref={svg}
      className={`entry-ribbon entry-ribbon--${variant}`}
      viewBox={shape ? `0 0 ${shape.width} ${shape.height}` : undefined}
      data-end-width={shape?.endWidth}
      data-start-width={shape?.startWidth}
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
                className="entry-ribbon-reveal"
                d={shape.center}
                pathLength="1"
                fill="none"
                stroke="white"
                strokeWidth={Math.max(
                  40,
                  (shape.endWidth ?? 0) + 8,
                  (shape.startWidth ?? 0) + 8,
                )}
                strokeLinecap="round"
              />
            </mask>
          </defs>
          <path
            className="entry-ribbon-body"
            d={shape.outline}
            mask={`url(#${id})`}
          />
        </>
      )}
    </svg>
  );
}
