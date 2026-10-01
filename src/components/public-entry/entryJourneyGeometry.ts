import type { Curve, Point } from "./entryRibbonGeometry";

/** Each leg shares the exact landing point of its predecessor. */
export function journeyCurves(
  start: Point,
  end: Point,
  width: number,
  leg: number,
): Curve[] {
  const gap = Math.max(80, Math.abs(end[1] - start[1]));
  const bend = Math.min(120, gap * 0.22);
  const inset = width < 768 ? 16 : 40;
  const bound = (x: number) => Math.max(inset, Math.min(width - inset, x));
  const middle = (start[0] + end[0]) / 2;
  const direction = leg % 4;
  const x =
    direction === 0
      ? bound(middle + width * 0.07)
      : direction === 1
        ? inset
        : direction === 2
          ? bound(middle - width * 0.16)
          : width - inset;
  const joint: Point = [x, (start[1] + end[1]) / 2];
  const diagonal = direction === 2 ? Math.min(64, width * 0.08) : 0;
  return [
    [
      start,
      [
        bound(start[0] + (leg === 0 ? 80 : (x - start[0]) * 0.7)),
        start[1] + bend * 0.2,
      ],
      [x - diagonal, joint[1] - bend],
      joint,
    ],
    [
      joint,
      [x + diagonal, joint[1] + bend],
      [bound(end[0] + (x - end[0]) * 0.45), end[1] - bend * 0.2],
      end,
    ],
  ];
}

export function curvePath(curves: Curve[]): string {
  const xy = ([x, y]: Point) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  return curves
    .map(
      ([a, b, c, d], index) =>
        `${index === 0 ? `M${xy(a)} ` : ""}C${xy(b)} ${xy(c)} ${xy(d)}`,
    )
    .join(" ");
}
