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
function finaleStroke(target: HTMLElement) {
  const style = getComputedStyle(target);
  const size = parseFloat(style.fontSize);
  const fallback = {
    point: [size * 0.82, -size * 0.76] as Point,
    width: size * 0.12,
  };
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 200;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.font = `${style.fontWeight} 100px ${style.fontFamily}`;
  ctx.fillText("리", 16, 150);
  const { data } = ctx.getImageData(0, 0, 160, 200);
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
    }
  >();

  useEffect(() => {
    const stage = svg.current?.parentElement;
    if (!stage) return;
    const scene = stage.closest<HTMLElement>("[data-entry-scene]");
    const source = stage.querySelector<HTMLElement>(".entry-hero-ink-source");
    const target = stage.querySelector<HTMLElement>(".entry-finale-ri");
    const anchor = stage.querySelector<HTMLElement>(
      ".entry-motion-title .entry-type-mask:last-child > span",
    );
    let active = true;
    let visible = true;
    let frame = 0;
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
      let taperStart = false;

      // Pixel coordinates make tangents identical across stages of different widths.
      if (variant === "finish" && target) {
        const tr = target.getBoundingClientRect();
        const baseline = target
          .querySelector(".entry-finale-baseline")
          ?.getBoundingClientRect();
        const ink = finaleStroke(target);
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
        const start: Point = [sr.left - stageRect.left, sr.top - stageRect.top];
        const visual = stage.querySelector<HTMLElement>(".entry-hero-visual");
        const bottom = visual ? layoutBox(visual, stage).bottom : height - 128;
        const turnY = Math.min(
          height - 48,
          Math.max(start[1] + 80, bottom + 24),
        );
        curves = [
          [start, [side, start[1]], [side, turnY - 48], [side, turnY]],
          [
            [side, turnY],
            [side, turnY + (height - turnY) * 0.3],
            [center + joinX, height - joinY],
            [center, height],
          ],
        ];
        emphasisSegment = 0;
        taperStart = true;
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
        const outside = Math.max(
          edge,
          Math.min(ar.left, ...rowBoxes.map((r) => r.left)) - 28,
        );
        const approachY = Math.max(
          48,
          Math.min(ar.top - 24, ...rowBoxes.map((r) => r.top - 16)),
        );
        const titleY = ar.bottom + 12;
        const left = Math.max(edge + 24, ar.left + (ar.right - ar.left) * 0.04);
        const right = Math.min(
          side - 16,
          ar.right - (ar.right - ar.left) * 0.04,
        );
        // Turn back toward the shared endpoint only below the final content row.
        const contentBottom = Math.max(
          titleY,
          ...Array.from(stage.children)
            .filter((node): node is HTMLElement => node instanceof HTMLElement)
            .map((node) => layoutBox(node, stage).bottom),
        );
        const turnY = Math.min(
          height - 24,
          Math.max(titleY + 64, contentBottom + 12),
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
            [outside, titleY],
            [left - 24, titleY],
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
            [side, titleY],
            [side, titleY],
            [side, titleY + 16],
          ],
          [
            [side, titleY + 16],
            [side, titleY + 48],
            [side, turnY - 32],
            [side, turnY],
          ],
          [
            [side, turnY],
            [side, turnY + (height - turnY) * 0.3],
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
          endWidth,
        }),
        width,
        height,
        endWidth,
      });
    };
    const request = () => {
      if (!frame && active && !document.hidden)
        frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(request);
    observer.observe(stage);
    stage
      .querySelectorAll<HTMLElement>(
        ".entry-motion-title, .entry-hero-tablet, .entry-finale-ri",
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
        ? new MutationObserver(() => {
            if (visible) request();
          })
        : null;
    if (motion && scene)
      motion.observe(scene, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", request, { passive: true });
    document.addEventListener("visibilitychange", request);
    measure();
    void document.fonts.ready.then(request);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      visibility?.disconnect();
      motion?.disconnect();
      window.removeEventListener("resize", request);
      document.removeEventListener("visibilitychange", request);
    };
  }, [variant]);

  return (
    <svg
      ref={svg}
      className={`entry-ribbon entry-ribbon--${variant}`}
      viewBox={shape ? `0 0 ${shape.width} ${shape.height}` : undefined}
      data-end-width={shape?.endWidth}
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
                strokeWidth={Math.max(40, (shape.endWidth ?? 0) + 8)}
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
