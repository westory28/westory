import { useEffect, useId, useRef, useState } from "react";

type Point = [number, number];
type Curve = [Point, Point, Point, Point];
type Variant = "hero" | "wide" | "wrap" | "finish";

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
        (width < 768 ? 2.6 : 5.2) *
        (0.2 + Math.sin((i / (points.length - 1)) * Math.PI * 3) ** 2);
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
    const protectedText = Array.from(
      stage.querySelectorAll<HTMLElement>(
        ".entry-heading, .entry-hero-copy, .entry-deck-heading, .entry-confirm-copy, :scope > .entry-eyebrow, :scope > .entry-motion-title",
      ),
    );
    const measure = () => {
      const width = stage.offsetWidth,
        height = stage.offsetHeight;
      if (!width || !height) return;
      const mobile = width < 768;
      let curves: Curve[];
      if (variant === "finish") {
        const target = stage.querySelector<HTMLElement>(".entry-finale-story");
        const sr = stage.getBoundingClientRect(),
          tr = target?.getBoundingClientRect();
        const end: Point = tr
          ? [
              (tr.left + tr.width * 0.68 - sr.left) / width,
              (tr.top + tr.height * 0.6 - sr.top) / height,
            ]
          : [0.65, 0.5];
        curves = [
          [
            [0.5, 0],
            [0.5, 0.12],
            [0.18, 0.15],
            [0.24, 0.35],
          ],
          [
            [0.24, 0.35],
            [0.3, 0.63],
            [end[0] - 0.2, end[1]],
            [end[0], end[1]],
          ],
        ];
      } else if (variant === "hero") {
        curves = mobile
          ? [
              [
                [0.5, 0],
                [0.97, 0.1],
                [0.98, 0.48],
                [0.91, 0.68],
              ],
              [
                [0.91, 0.68],
                [0.86, 0.84],
                [0.06, 0.9],
                [0.09, 0.72],
              ],
              [
                [0.09, 0.72],
                [0.1, 0.57],
                [0.75, 0.88],
                [0.5, 1],
              ],
            ]
          : [
              [
                [0.5, 0],
                [0.73, 0.1],
                [0.98, 0.02],
                [0.97, 0.43],
              ],
              [
                [0.97, 0.43],
                [0.97, 0.8],
                [0.4, 0.87],
                [0.47, 0.56],
              ],
              [
                [0.47, 0.56],
                [0.51, 0.36],
                [0.77, 0.83],
                [0.5, 1],
              ],
            ];
      } else if (variant === "wide") {
        curves = [
          [
            [0.5, 0],
            [0.5, 0.12],
            [0.98, 0.08],
            [0.96, 0.52],
          ],
          [
            [0.96, 0.52],
            [0.97, 0.96],
            [0.06, 0.94],
            [0.04, 0.65],
          ],
          [
            [0.04, 0.65],
            [0.04, 0.5],
            [0.5, 0.88],
            [0.5, 1],
          ],
        ];
      } else {
        curves = mobile
          ? [
              [
                [0.5, 0],
                [0.18, 0.07],
                [0.98, 0.29],
                [0.96, 0.56],
              ],
              [
                [0.96, 0.56],
                [0.95, 0.99],
                [0.02, 0.9],
                [0.04, 0.59],
              ],
              [
                [0.04, 0.59],
                [0.08, 0.48],
                [0.49, 0.91],
                [0.5, 1],
              ],
            ]
          : [
              [
                [0.5, 0],
                [0.53, 0.14],
                [0.97, 0.08],
                [0.96, 0.48],
              ],
              [
                [0.96, 0.48],
                [0.96, 0.97],
                [0.41, 0.86],
                [0.43, 0.54],
              ],
              [
                [0.43, 0.54],
                [0.45, 0.35],
                [0.5, 0.85],
                [0.5, 1],
              ],
            ];
      }
      if (variant !== "finish") {
        curves[0][1] = [0.5, 0.12];
        curves[curves.length - 1][2] = [0.5, 0.88];
      }
      const stageRect = stage.getBoundingClientRect();
      const textBounds = protectedText.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.left - stageRect.left - 8,
          y: rect.top - stageRect.top - 8,
          width: rect.width + 16,
          height: rect.height + 16,
        };
      });
      setShape({ ...brush(curves, width, height), width, height, textBounds });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    protectedText.forEach((element) => observer.observe(element));
    const target = stage.querySelector(".entry-finale-story");
    if (target) observer.observe(target);
    measure();
    return () => observer.disconnect();
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
