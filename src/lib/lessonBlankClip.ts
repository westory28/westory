export interface LessonBlankClipPoint {
  x: number;
  y: number;
}

/** Points are relative to the saved blank, and remain Firestore map values. */
export const normalizeLessonBlankClip = (
  raw: unknown,
): LessonBlankClipPoint[] | undefined => {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 2048) {
    return undefined;
  }
  const points: LessonBlankClipPoint[] = [];
  for (const point of raw) {
    if (
      !point ||
      typeof point !== "object" ||
      Array.isArray(point) ||
      typeof point.x !== "number" ||
      typeof point.y !== "number" ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1
    ) {
      return undefined;
    }
    points.push({ x: point.x, y: point.y });
  }
  return points;
};

export const getLessonBlankClipPath = (raw: unknown): string | undefined => {
  const points = normalizeLessonBlankClip(raw);
  return points
    ? `polygon(evenodd, ${points.map(({ x, y }) => `${x * 100}% ${y * 100}%`).join(", ")})`
    : undefined;
};
