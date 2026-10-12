import type { LessonPdfGlyphInkRow } from "./lessonPdfGlyphTypes";

type Span = { left: number; right: number };
type Point = { x: number; y: number };
export interface LessonInkClipBand {
  top: number;
  bottom: number;
  spans: Span[];
}
export interface LessonInkClipResult {
  /** Relative to the rectangle; render with CSS polygon(evenodd, ...). */
  polygon: Point[];
  /** Absolute page coordinates of the area that the blank will cover. */
  bands: LessonInkClipBand[];
}

const EPSILON = 1e-7;
const MAX_POINTS = 2048;
const MAX_INPUT_INTERVALS = 32_768;
const MAX_COORDINATES = 16_384;
const MAX_EDGES = 65_536;
const MAX_WORK = 1_000_000;

const sameSpans = (a: Span[], b: Span[]) =>
  a.length === b.length &&
  a.every(
    (span, index) =>
      span.left === b[index].left && span.right === b[index].right,
  );

const unionSpans = (spans: Span[]) => {
  const sorted = spans
    .slice()
    .sort((a, b) => a.left - b.left || a.right - b.right);
  const result: Span[] = [];
  for (const span of sorted) {
    const last = result[result.length - 1];
    if (last && span.left <= last.right)
      last.right = Math.max(last.right, span.right);
    else result.push({ ...span });
  }
  return result;
};

/** A and B are sorted, disjoint interval sets. */
const difference = (a: Span[], b: Span[]) => {
  const result: Span[] = [];
  let index = 0;
  for (const span of a) {
    let left = span.left;
    while (index < b.length && b[index].right <= left) index++;
    for (let i = index; i < b.length && b[i].left < span.right; i++) {
      if (b[i].left > left)
        result.push({ left, right: Math.min(b[i].left, span.right) });
      left = Math.max(left, b[i].right);
      if (left >= span.right) break;
    }
    if (left < span.right) result.push({ left, right: span.right });
  }
  return result;
};

/** Only reconcile floating-point coincidences; never quantize sampled contours. */
const coordinates = (values: number[], maximum: number) => {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const map = new Map<number, number>();
  const unique: number[] = [];
  for (let i = 0; i < sorted.length; ) {
    let end = i + 1;
    while (end < sorted.length && sorted[end] - sorted[i] <= EPSILON) end++;
    const value = sorted[end - 1] === maximum ? maximum : sorted[i];
    unique.push(value);
    for (; i < end; i++) map.set(sorted[i], value);
  }
  return { map, unique };
};

const simplifyRing = (ring: Point[]) =>
  ring.filter((point, index) => {
    const previous = ring[(index + ring.length - 1) % ring.length];
    const next = ring[(index + 1) % ring.length];
    return !(
      (previous.x === point.x && point.x === next.x) ||
      (previous.y === point.y && point.y === next.y)
    );
  });

/**
 * Exact orthogonal difference between a blank and neighbouring occupied ink.
 * Missing precise spans conservatively protect the whole outer row interval.
 * Multiple boundary rings use reversed zero-width bridges so evenodd fill
 * preserves both holes and disconnected mask components.
 */
export const createLessonInkClip = (
  rectangle: { left: number; top: number; right: number; bottom: number },
  blockerRows: readonly LessonPdfGlyphInkRow[],
): LessonInkClipResult | undefined => {
  const { left, top, right, bottom } = rectangle;
  if (
    ![left, top, right, bottom].every(Number.isFinite) ||
    right - left <= EPSILON ||
    bottom - top <= EPSILON ||
    blockerRows.length > MAX_INPUT_INTERVALS
  )
    return undefined;

  const rows: LessonInkClipBand[] = [];
  const xs = [left, right],
    ys = [top, bottom];
  let inputIntervals = 0;
  for (const row of blockerRows) {
    if (
      ![row.top, row.bottom, row.left, row.right].every(Number.isFinite) ||
      row.bottom < row.top ||
      row.right < row.left
    )
      return undefined;
    const rowTop = Math.max(top, row.top),
      rowBottom = Math.min(bottom, row.bottom);
    if (rowBottom <= rowTop) continue;
    const spans: Span[] = [];
    for (const span of row.spans?.length
      ? row.spans
      : [{ left: row.left, right: row.right }]) {
      if (
        ++inputIntervals > MAX_INPUT_INTERVALS ||
        ![span.left, span.right].every(Number.isFinite) ||
        span.right < span.left
      )
        return undefined;
      const spanLeft = Math.max(left, span.left),
        spanRight = Math.min(right, span.right);
      if (spanRight <= spanLeft) continue;
      spans.push({ left: spanLeft, right: spanRight });
      xs.push(spanLeft, spanRight);
    }
    if (!spans.length) continue;
    rows.push({ top: rowTop, bottom: rowBottom, spans });
    ys.push(rowTop, rowBottom);
  }
  const xCoords = coordinates(xs, right),
    yCoords = coordinates(ys, bottom);
  if (
    xCoords.unique.length > MAX_COORDINATES ||
    yCoords.unique.length > MAX_COORDINATES
  )
    return undefined;
  const events = new Map<number, { add: number[]; remove: number[] }>();
  const event = (y: number) => {
    let value = events.get(y);
    if (!value) {
      value = { add: [], remove: [] };
      events.set(y, value);
    }
    return value;
  };
  rows.forEach((row, index) => {
    row.top = yCoords.map.get(row.top)!;
    row.bottom = yCoords.map.get(row.bottom)!;
    row.spans = unionSpans(
      row.spans
        .map((span) => ({
          left: xCoords.map.get(span.left)!,
          right: xCoords.map.get(span.right)!,
        }))
        .filter((span) => span.right > span.left),
    );
    if (row.bottom > row.top && row.spans.length) {
      event(row.top).add.push(index);
      event(row.bottom).remove.push(index);
    }
  });
  const active = new Set<number>();
  const bands: LessonInkClipBand[] = [];
  let work = 0;
  for (let i = 0; i < yCoords.unique.length - 1; i++) {
    const bandTop = yCoords.unique[i],
      bandBottom = yCoords.unique[i + 1];
    const changes = events.get(bandTop);
    changes?.remove.forEach((index) => active.delete(index));
    changes?.add.forEach((index) => active.add(index));
    const blocked: Span[] = [];
    for (const index of active) {
      work += rows[index].spans.length;
      if (work > MAX_WORK) return undefined;
      blocked.push(...rows[index].spans);
    }
    const spans = difference([{ left, right }], unionSpans(blocked));
    const last = bands[bands.length - 1];
    if (last && sameSpans(last.spans, spans)) last.bottom = bandBottom;
    else bands.push({ top: bandTop, bottom: bandBottom, spans });
  }
  if (!bands.some((band) => band.spans.length)) return undefined;

  const vertices: Point[] = [];
  const vertexIds = new Map<string, number>();
  const vertex = (x: number, y: number) => {
    const key = `${x}:${y}`;
    let id = vertexIds.get(key);
    if (id === undefined) {
      id = vertices.length;
      vertices.push({ x, y });
      vertexIds.set(key, id);
    }
    return id;
  };
  const edges: Array<{ from: number; to: number; direction: number }> = [];
  const outgoing = new Map<number, number[]>();
  const edge = (x1: number, y1: number, x2: number, y2: number) => {
    if (x1 === x2 && y1 === y2) return;
    const from = vertex(x1, y1),
      to = vertex(x2, y2);
    const direction = x2 > x1 ? 0 : y2 > y1 ? 1 : x2 < x1 ? 2 : 3;
    const next = outgoing.get(from) ?? [];
    next.push(edges.length);
    outgoing.set(from, next);
    edges.push({ from, to, direction });
  };
  let above: Span[] = [];
  for (const band of bands) {
    // Oppositely directed horizontal edges cancel wherever two bands meet.
    for (const span of difference(above, band.spans))
      edge(span.right, band.top, span.left, band.top);
    for (const span of difference(band.spans, above))
      edge(span.left, band.top, span.right, band.top);
    for (const span of band.spans) {
      edge(span.right, band.top, span.right, band.bottom);
      edge(span.left, band.bottom, span.left, band.top);
    }
    above = band.spans;
    if (edges.length > MAX_EDGES) return undefined;
  }
  for (const span of above) edge(span.right, bottom, span.left, bottom);
  if (edges.length > MAX_EDGES) return undefined;

  const visited = new Set<number>();
  const rings: Point[][] = [];
  let pointCount = 0;
  const turnPriority = [1, 0, 3, 2]; // Interior stays on the right at a diagonal contact.
  for (let start = 0; start < edges.length; start++) {
    if (visited.has(start)) continue;
    const first = edges[start].from;
    const ring: Point[] = [];
    let current = start;
    while (true) {
      if (visited.has(current)) return undefined;
      const segment = edges[current];
      visited.add(current);
      ring.push(vertices[segment.from]);
      if (segment.to === first) break;
      const candidates = (outgoing.get(segment.to) ?? []).filter(
        (index) => !visited.has(index),
      );
      if (!candidates.length) return undefined;
      current = candidates.reduce((best, index) =>
        turnPriority.indexOf(
          (edges[index].direction - segment.direction + 4) % 4,
        ) <
        turnPriority.indexOf(
          (edges[best].direction - segment.direction + 4) % 4,
        )
          ? index
          : best,
      );
    }
    const reduced = simplifyRing(ring);
    if (reduced.length < 4) return undefined;
    pointCount += reduced.length;
    if (pointCount + rings.length * 3 > MAX_POINTS) return undefined;
    rings.push(reduced);
  }
  const anchor = rings[0][0];
  const polygon = [...rings[0]];
  if (rings.length > 1) {
    polygon.push(anchor);
    for (const ring of rings.slice(1)) polygon.push(...ring, ring[0], anchor);
  }
  if (polygon.length > MAX_POINTS) return undefined;
  return {
    polygon: polygon.map((point) => ({
      x: (point.x - left) / (right - left),
      y: (point.y - top) / (bottom - top),
    })),
    bands,
  };
};
