export type Point = [number, number];
export type Curve = [Point, Point, Point, Point];

type Sample = { point: Point; tangent: Point; distance: number };
type BrushOptions = {
  emphasisSegment?: number;
  taperStart?: boolean;
  taperEnd?: boolean;
  compact?: boolean;
  endWidth?: number;
};

const smoothstep = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
const coordinate = (point: Point) =>
  `${point[0].toFixed(2)} ${point[1].toFixed(2)}`;

/** A single filled ribbon; pressure is measured in pixels along its center. */
export function createEntryBrush(
  curves: Curve[],
  width: number,
  height: number,
  options: BrushOptions = {},
): { center: string; outline: string } {
  const empty = { center: "", outline: "" };
  if (
    !curves.length ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return empty;

  const dense: Sample[] = [];
  const spans: [number, number][] = [];
  let total = 0;
  for (const curve of curves) {
    const [a, b, c, d] = curve.map(([x, y]) => [
      x * width,
      y * height,
    ]) as Curve;
    if (![a, b, c, d].every((point) => point.every(Number.isFinite)))
      return empty;
    const longest = Math.max(
      Math.hypot(b[0] - a[0], b[1] - a[1]),
      Math.hypot(c[0] - b[0], c[1] - b[1]),
      Math.hypot(d[0] - c[0], d[1] - c[1]),
    );
    // |B'(t)| <= 3 × longest control edge: the lookup chords are <= 1.5px
    // at normal layout sizes. Keep even malformed huge inputs bounded.
    const steps = Math.max(4, Math.min(8192, Math.ceil(longest * 2)));
    const start = total;
    for (let i = dense.length ? 1 : 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const point: Point = [
        u ** 3 * a[0] +
          3 * u * u * t * b[0] +
          3 * u * t * t * c[0] +
          t ** 3 * d[0],
        u ** 3 * a[1] +
          3 * u * u * t * b[1] +
          3 * u * t * t * c[1] +
          t ** 3 * d[1],
      ];
      const tangent: Point = [
        3 * u * u * (b[0] - a[0]) +
          6 * u * t * (c[0] - b[0]) +
          3 * t * t * (d[0] - c[0]),
        3 * u * u * (b[1] - a[1]) +
          6 * u * t * (c[1] - b[1]) +
          3 * t * t * (d[1] - c[1]),
      ];
      const previous = dense[dense.length - 1];
      const gap = previous
        ? Math.hypot(point[0] - previous.point[0], point[1] - previous.point[1])
        : 0;
      if (previous && gap < 0.000001) continue;
      total += gap;
      dense.push({ point, tangent, distance: total });
    }
    spans.push([start, total]);
  }
  if (total < 0.000001 || !Number.isFinite(total)) return empty;

  // Equal physical spacing prevents short curves from receiving more pressure
  // than long ones. Include joins and the emphasis midpoint exactly.
  const count = Math.min(32768, Math.ceil(total / 3));
  const distances = Array.from(
    { length: count + 1 },
    (_, i) => (i * total) / count,
  );
  const emphasis = spans[options.emphasisSegment ?? -1];
  spans.forEach(([start, end]) => distances.push(start, end));
  if (emphasis) distances.push((emphasis[0] + emphasis[1]) / 2);
  distances.sort((a, b) => a - b);
  let cursor = 1;
  const samples: Sample[] = [];
  for (const distance of distances) {
    if (
      samples.length &&
      distance - samples[samples.length - 1].distance < 0.000001
    )
      continue;
    while (cursor < dense.length - 1 && dense[cursor].distance < distance)
      cursor++;
    const before = dense[cursor - 1];
    const after = dense[cursor];
    const t = (distance - before.distance) / (after.distance - before.distance);
    samples.push({
      point: [
        before.point[0] + (after.point[0] - before.point[0]) * t,
        before.point[1] + (after.point[1] - before.point[1]) * t,
      ],
      tangent: [
        before.tangent[0] + (after.tangent[0] - before.tangent[0]) * t,
        before.tangent[1] + (after.tangent[1] - before.tangent[1]) * t,
      ],
      distance,
    });
  }

  const compact = options.compact ?? width < 768;
  const base = compact ? 3 : 4;
  const peak = compact ? 10 : 16;
  const taperLength = Math.min(total * 0.15, 48);
  const endWidth = Number.isFinite(options.endWidth)
    ? Math.max(0.02, options.endWidth!)
    : undefined;
  const radii = samples.map(({ distance }) => {
    let thickness = base;
    if (
      emphasis &&
      emphasis[1] > emphasis[0] &&
      distance >= emphasis[0] &&
      distance <= emphasis[1]
    ) {
      const phase = (distance - emphasis[0]) / (emphasis[1] - emphasis[0]);
      thickness += (peak - base) * Math.sin(phase * Math.PI) ** 2;
    }
    if (options.taperStart)
      thickness =
        0.02 + (thickness - 0.02) * smoothstep(distance / taperLength);
    if (endWidth !== undefined) {
      const blend = smoothstep(
        1 - (total - distance) / Math.min(total * 0.3, 120),
      );
      thickness += (endWidth - thickness) * blend;
    } else if (options.taperEnd) {
      thickness =
        0.02 +
        (thickness - 0.02) * smoothstep((total - distance) / taperLength);
    }
    return thickness / 2;
  });
  const left: Point[] = [];
  const right: Point[] = [];
  samples.forEach(({ point, tangent }, i) => {
    let [dx, dy] = tangent;
    if (Math.hypot(dx, dy) < 0.000001) {
      const before = samples[Math.max(0, i - 1)].point;
      const after = samples[Math.min(samples.length - 1, i + 1)].point;
      dx = after[0] - before[0];
      dy = after[1] - before[1];
    }
    const length = Math.hypot(dx, dy) || 1;
    const x = (-dy / length) * radii[i];
    const y = (dx / length) * radii[i];
    left.push([point[0] + x, point[1] + y]);
    right.push([point[0] - x, point[1] - y]);
  });
  const path = (points: Point[]) => points.map(coordinate).join(" L");
  const last = samples.length - 1;
  const cap = (radius: number, point: Point) =>
    `A${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 0 ${coordinate(point)}`;
  // A measured glyph connection ends on its normal, without a round bulge.
  const terminalCap =
    endWidth === undefined
      ? cap(radii[last], right[last])
      : `L${coordinate(right[last])}`;
  return {
    center: `M${path(samples.map(({ point }) => point))}`,
    outline: `M${path(left)} ${terminalCap} L${path(right.slice(0, -1).reverse())} ${cap(radii[0], left[0])} Z`,
  };
}
