import { useEffect, useId, useRef, useState } from "react";

type Point = [number, number];
type Curve = [Point, Point, Point, Point];
type Variant = "hero" | "wide" | "wrap" | "left" | "finish";

// Measure only the upper-right ink of 리: its ㅣ. Local font rendering keeps
// the connection accurate even when Korean falls back to a device's own font.
function finaleStroke(target: HTMLElement): Point {
  const style = getComputedStyle(target);
  const size = parseFloat(style.fontSize);
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 200;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [size * 0.82, -size * 0.76];
  ctx.font = `${style.fontWeight} 100px ${style.fontFamily}`;
  ctx.fillText("리", 16, 150);
  const { data } = ctx.getImageData(0, 0, 160, 200);
  for (let y = 25; y < 150; y++) {
    // The rightmost run excludes the ㄹ on the left of the syllable.
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
    return [
      (((left + right + 1) / 2 - 16) * size) / 100,
      ((y - 148) * size) / 100,
    ];
  }
  return [size * 0.82, -size * 0.76];
}

function brush(curves: Curve[], width: number, height: number) {
  const points = curves.flatMap(([a, b, c, d], segment) =>
    Array.from({ length: 33 }, (_, i) => {
      const t = i / 32,
        u = 1 - t;
      return [
        (u ** 3 * a[0] +
          3 * u * u * t * b[0] +
          3 * u * t * t * c[0] +
          t ** 3 * d[0]) *
          width,
        (u ** 3 * a[1] +
          3 * u * u * t * b[1] +
          3 * u * t * t * c[1] +
          t ** 3 * d[1]) *
          height,
      ] as Point;
    }).slice(segment ? 1 : 0),
  );
  const edge = (direction: number, strand = false) =>
    points.map((p, i) => {
      const before = points[Math.max(0, i - 1)],
        after = points[Math.min(points.length - 1, i + 1)];
      const dx = after[0] - before[0],
        dy = after[1] - before[1];
      const length = Math.hypot(dx, dy) || 1;
      const pressure =
        (width < 768 ? 2 : 4) *
        (0.25 + 0.75 * Math.sin((i / (points.length - 1)) * Math.PI) ** 2);
      const offset = direction * pressure * (strand ? 0.58 : 1);
      return [
        p[0] - (dy / length) * offset,
        p[1] + (dx / length) * offset,
      ] as Point;
    });
  const path = (pts: Point[]) =>
    pts
      .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
      .join(" ");
  return {
    center: path(points),
    outline: `${path(edge(1))} ${path(edge(-1).reverse()).replace(/^M/, "L")} Z`,
    strands: [path(edge(1, true)), path(edge(-1, true))],
  };
}

/** One continuous hand-drawn stroke per stage, joining at the center between scenes. */
export default function EntryRibbon({
  variant = "wrap",
}: {
  variant?: Variant;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const id = `entry-ink-${useId().replace(/:/g, "")}`;
  const [shape, setShape] = useState<
    ReturnType<typeof brush> & {
      width: number;
      height: number;
      textBounds: { x: number; y: number; width: number; height: number }[];
    }
  >();
  useEffect(() => {
    const stage = svg.current?.parentElement;
    if (!stage) return;
    let active = true;
    const protectedText = Array.from(
      stage.querySelectorAll<HTMLElement>(
        ".entry-motion-title .entry-type-mask, .entry-hero-copy h1, .entry-eyebrow, .entry-benefit, .entry-login, .entry-finale-phrase, .entry-record-value, .entry-record-dates, .entry-record-tags, .entry-mypage-demo-note",
      ),
    );
    const measure = () => {
      if (!active) return;
      const width = stage.offsetWidth,
        height = stage.offsetHeight;
      if (!width || !height) return;
      const compact = width < 1024;
      const stageRect = stage.getBoundingClientRect();
      let curves: Curve[];
      if (variant === "finish") {
        const target = stage.querySelector<HTMLElement>(".entry-finale-ri");
        const tr = target?.getBoundingClientRect();
        const baseline = target
          ?.querySelector(".entry-finale-baseline")
          ?.getBoundingClientRect();
        const ink = target ? finaleStroke(target) : [0, 0];
        const end: Point =
          tr && baseline
            ? [
                (tr.left + ink[0] - stageRect.left) / width,
                (baseline.top + ink[1] - stageRect.top) / height,
              ]
            : [0.65, 0.5];
        // The last control point shares the endpoint's x: arrive vertically
        // into the top of ㅣ, just inside its ink rather than across the word.
        curves = [
          [[0.5, 0], [end[0], end[1] * 0.12], [end[0], end[1] * 0.5], end],
        ];
      } else {
        const anchor = stage.querySelector<HTMLElement>(
          ".entry-hero-mask:last-child, .entry-motion-title .entry-type-mask:last-child",
        );
        const ar = anchor?.getBoundingClientRect();
        const text = anchor?.firstElementChild as HTMLElement | null;
        const textWidth = Math.min(
          ar?.width || width * 0.4,
          text?.offsetWidth || width * 0.4,
        );
        const centered =
          anchor && getComputedStyle(anchor).textAlign === "center";
        const textLeft = ar
          ? ar.left -
            stageRect.left +
            (centered ? (ar.width - textWidth) / 2 : 0)
          : width * 0.3;
        const clampX = (x: number) => Math.max(0.06, Math.min(0.94, x));
        const left = clampX((textLeft + textWidth * 0.08) / width);
        const right = clampX((textLeft + textWidth * 0.92) / width);
        const titleY = Math.max(
          0.1,
          Math.min(0.72, ar ? (ar.bottom - stageRect.top + 8) / height : 0.3),
        );
        // Read stable line-box geometry, not the animated inner text transform.
        const reversed = variant === "left" && !compact;
        const start: Point = [reversed ? right : left, titleY];
        const end: Point = [reversed ? left : right, titleY];
        const side = reversed ? 0.04 : 0.96;
        const exitY = Math.max(titleY + 0.1, 0.76);
        const outside = reversed
          ? Math.min(0.975, start[0] + 32 / width)
          : Math.max(0.025, start[0] - 32 / width);
        curves = [
          [
            [0.5, 0],
            [0.5, titleY * 0.1],
            [outside, titleY * 0.25],
            [outside, titleY * 0.6],
          ],
          [
            [outside, titleY * 0.6],
            [outside, titleY * 0.85],
            [outside, titleY],
            start,
          ],
          [
            start,
            [start[0] + (end[0] - start[0]) / 3, titleY],
            [start[0] + ((end[0] - start[0]) * 2) / 3, end[1]],
            end,
          ],
          [
            end,
            [side, end[1] + 0.06],
            [side, Math.max(end[1] + 0.07, exitY - 0.12)],
            [side, exitY],
          ],
          [
            [side, exitY],
            [side, 0.91],
            [0.5, 0.94],
            [0.5, 1],
          ],
        ];
        if (variant === "hero") curves = curves.slice(2);
      }
      const textBounds = protectedText.map((element) => {
        // The finale line passes beside the phrase. Protect its text, not the
        // wider block inherited from the brand, which would cut the ink in midair.
        let rect = element.getBoundingClientRect();
        if (element.classList.contains("entry-finale-phrase")) {
          const range = document.createRange();
          range.selectNodeContents(element);
          rect = range.getBoundingClientRect();
        }
        return {
          x: rect.left - stageRect.left - 4,
          y: rect.top - stageRect.top - 4,
          width: rect.width + 8,
          height: rect.height + 8,
        };
      });
      setShape({ ...brush(curves, width, height), width, height, textBounds });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    protectedText.forEach((element) => observer.observe(element));
    const target = stage.querySelector(".entry-finale-ri");
    if (target) observer.observe(target);
    measure();
    if (variant === "finish") void document.fonts.ready.then(measure);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [variant]);
  return (
    <svg
      ref={svg}
      className={`entry-ribbon entry-ribbon--${variant}`}
      viewBox={shape ? `0 0 ${shape.width} ${shape.height}` : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {shape && (
        <>
          <defs>
            <mask
              id={`${id}-text`}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={shape.width}
              height={shape.height}
            >
              <rect width={shape.width} height={shape.height} fill="white" />
              {shape.textBounds.map((bounds, i) => (
                <rect key={i} {...bounds} fill="black" />
              ))}
            </mask>
            <mask
              id={id}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={shape.width}
              height={shape.height}
            >
              <path
                className="entry-ribbon-reveal"
                d={shape.center}
                pathLength="1"
                fill="none"
                stroke="white"
                strokeWidth="24"
                strokeLinecap="round"
              />
            </mask>
          </defs>
          <g mask={`url(#${id}-text)`}>
            <g mask={`url(#${id})`}>
              <path className="entry-ribbon-body" d={shape.outline} />
              {shape.strands.map((d, i) => (
                <path key={i} className="entry-ribbon-grain" d={d} />
              ))}
            </g>
          </g>
        </>
      )}
    </svg>
  );
}
