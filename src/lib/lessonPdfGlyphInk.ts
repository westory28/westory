import type { LessonPdfGlyphInkRow } from "./lessonPdfGlyphTypes";

export type LessonPdfInkBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type LessonPdfInkSample = LessonPdfInkBounds & {
  rows: LessonPdfGlyphInkRow[];
};
type GlyphTransform = Pick<DOMMatrix, "a" | "b" | "c" | "d" | "e" | "f">;
type PaintProperties = Pick<
  CanvasRenderingContext2D,
  | "font"
  | "textAlign"
  | "textBaseline"
  | "direction"
  | "fontKerning"
  | "fontStretch"
  | "fontVariantCaps"
  | "letterSpacing"
  | "wordSpacing"
  | "textRendering"
  | "globalAlpha"
  | "lineWidth"
  | "lineCap"
  | "lineJoin"
  | "miterLimit"
  | "lineDashOffset"
>;
export type LessonPdfGlyphPaintState = Readonly<PaintProperties> & {
  getTransform(): Readonly<GlyphTransform>;
  getLineDash(): number[];
};

/** PDF.js reuses its context; refinements must retain the original paint state. */
export const snapshotLessonPdfGlyphPaint = (
  source: CanvasRenderingContext2D,
): LessonPdfGlyphPaintState => {
  const t = source.getTransform();
  const transform = Object.freeze({
    a: t.a,
    b: t.b,
    c: t.c,
    d: t.d,
    e: t.e,
    f: t.f,
  });
  const lineDash = Object.freeze(source.getLineDash());
  return Object.freeze({
    font: source.font,
    textAlign: source.textAlign,
    textBaseline: source.textBaseline,
    direction: source.direction,
    fontKerning: source.fontKerning,
    fontStretch: source.fontStretch,
    fontVariantCaps: source.fontVariantCaps,
    letterSpacing: source.letterSpacing,
    wordSpacing: source.wordSpacing,
    textRendering: source.textRendering,
    globalAlpha: source.globalAlpha,
    lineWidth: source.lineWidth,
    lineCap: source.lineCap,
    lineJoin: source.lineJoin,
    miterLimit: source.miterLimit,
    lineDashOffset: source.lineDashOffset,
    getTransform: () => transform,
    getLineDash: () => [...lineDash],
  });
};
const shiftRows = (rows: LessonPdfGlyphInkRow[], x: number, y: number) =>
  rows.map((row) => ({
    left: row.left + x,
    right: row.right + x,
    top: row.top + y,
    bottom: row.bottom + y,
    ...(row.spans
      ? {
          spans: row.spans.map((span) => ({
            left: span.left + x,
            right: span.right + x,
          })),
        }
      : {}),
  }));

const MAX_SAMPLE_PIXELS = 8_388_608;
const MAX_SAMPLE_SIDE = 8192;
const MAX_CACHED_ROWS = 65_536;
const MAX_SAMPLE_INTERVALS = 65_536;

/** Use PDF.js's actual embedded font character and paint state in both canvases. */
export const paintLessonPdfGlyph = (
  target: CanvasRenderingContext2D,
  source: LessonPdfGlyphPaintState,
  text: string,
  x: number,
  y: number,
  stroke: boolean,
  transform: DOMMatrix2DInit,
) => {
  target.setTransform(transform);
  target.font = source.font;
  target.textAlign = source.textAlign;
  target.textBaseline = source.textBaseline;
  target.direction = source.direction;
  target.fontKerning = source.fontKerning;
  target.fontStretch = source.fontStretch;
  target.fontVariantCaps = source.fontVariantCaps;
  target.letterSpacing = source.letterSpacing;
  target.wordSpacing = source.wordSpacing;
  target.textRendering = source.textRendering;
  target.globalAlpha = source.globalAlpha;
  target.fillStyle = "#ffffff";
  target.strokeStyle = "#ffffff";
  if (stroke) {
    target.lineWidth = source.lineWidth;
    target.lineCap = source.lineCap;
    target.lineJoin = source.lineJoin;
    target.miterLimit = source.miterLimit;
    target.setLineDash(source.getLineDash());
    target.lineDashOffset = source.lineDashOffset;
    target.strokeText(text, x, y);
  } else {
    target.fillText(text, x, y);
  }
};

/** Metrics only reserve a tile; alpha pixels decide the final, unpadded ink box. */
export const createLessonPdfInkSampler = () => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas-unavailable");
  const cache = new Map<string, LessonPdfInkSample | null>();
  let cachedRows = 0;
  const phase = (value: number, scale: number) =>
    Math.round(((((value * scale) % 1) + 1) % 1) * 1e6) / 1e6;
  return {
    measure(
      source: LessonPdfGlyphPaintState,
      text: string,
      x: number,
      y: number,
      stroke: boolean,
      candidate: LessonPdfInkBounds,
      sampleScale: 16 | 64 = 16,
    ): LessonPdfInkSample | null {
      const t = source.getTransform();
      const originX = x * t.a + y * t.c + t.e;
      const originY = x * t.b + y * t.d + t.f;
      const key = JSON.stringify([
        text,
        sampleScale,
        source.font,
        t.a,
        t.b,
        t.c,
        t.d,
        phase(originX, sampleScale),
        phase(originY, sampleScale),
        source.textAlign,
        source.textBaseline,
        source.direction,
        source.fontKerning,
        source.fontStretch,
        source.fontVariantCaps,
        source.letterSpacing,
        source.wordSpacing,
        source.textRendering,
        source.globalAlpha,
        stroke,
        ...(stroke
          ? [
              source.lineWidth,
              source.lineCap,
              source.lineJoin,
              source.miterLimit,
              source.getLineDash(),
              source.lineDashOffset,
            ]
          : []),
      ]);
      if (cache.has(key)) {
        const bounds = cache.get(key);
        return bounds
          ? {
              ...bounds,
              left: bounds.left + originX,
              top: bounds.top + originY,
              rows: shiftRows(bounds.rows, originX, originY),
            }
          : null;
      }
      const tileLeft = Math.floor(candidate.left - 2);
      const tileTop = Math.floor(candidate.top - 2);
      const width =
        Math.ceil(candidate.left + candidate.width + 2 - tileLeft) *
        sampleScale;
      const height =
        Math.ceil(candidate.top + candidate.height + 2 - tileTop) * sampleScale;
      if (
        !Number.isFinite(width * height) ||
        width <= 0 ||
        height <= 0 ||
        width > MAX_SAMPLE_SIDE ||
        height > MAX_SAMPLE_SIDE ||
        width * height > MAX_SAMPLE_PIXELS
      )
        throw new Error("unsupported-pdf-glyph-size");
      // Resizing clears the previous glyph, clipping path and paint state.
      // Drop the old height first so a wide-after-tall tile cannot over-allocate.
      canvas.height = 0;
      canvas.width = width;
      canvas.height = height;
      paintLessonPdfGlyph(context, source, text, x, y, stroke, {
        a: t.a * sampleScale,
        b: t.b * sampleScale,
        c: t.c * sampleScale,
        d: t.d * sampleScale,
        e: (t.e - tileLeft) * sampleScale,
        f: (t.f - tileTop) * sampleScale,
      });
      const pixels = context.getImageData(0, 0, width, height).data;
      let left = width,
        top = height,
        right = -1,
        bottom = -1;
      const rows: LessonPdfGlyphInkRow[] = [];
      let intervalCount = 0;
      for (let row = 0; row < height; row++) {
        const offset = row * width * 4 + 3;
        let first = 0;
        while (first < width && pixels[offset + first * 4] === 0) first++;
        if (first === width) continue;
        let last = width - 1;
        while (last > first && pixels[offset + last * 4] === 0) last--;
        left = Math.min(left, first);
        right = Math.max(right, last);
        top = Math.min(top, row);
        bottom = row;
        let spans: LessonPdfGlyphInkRow["spans"];
        if (sampleScale === 64) {
          spans = [];
          let column = first;
          while (column <= last) {
            while (column <= last && pixels[offset + column * 4] === 0)
              column++;
            if (column > last) break;
            const runLeft = column;
            while (column <= last && pixels[offset + column * 4] !== 0)
              column++;
            spans.push({ left: runLeft, right: column });
          }
        }
        const previous = rows[rows.length - 1];
        if (
          previous?.bottom === row &&
          previous.left === first &&
          previous.right === last + 1 &&
          (!spans ||
            (previous.spans?.length === spans.length &&
              spans.every(
                (span, index) =>
                  previous.spans![index].left === span.left &&
                  previous.spans![index].right === span.right,
              )))
        )
          previous.bottom = row + 1;
        else {
          intervalCount += 1 + (spans?.length || 0);
          if (intervalCount > MAX_SAMPLE_INTERVALS)
            throw new Error("unsupported-pdf-glyph-complexity");
          rows.push({
            top: row,
            bottom: row + 1,
            left: first,
            right: last + 1,
            ...(spans ? { spans } : {}),
          });
        }
      }
      if (right < left) {
        if (cache.size < 4096) cache.set(key, null);
        return null;
      }
      // Never accept a cropped scratch glyph as its real ink boundary.
      if (
        left === 0 ||
        top === 0 ||
        right === width - 1 ||
        bottom === height - 1
      )
        throw new Error("unsupported-pdf-glyph-crop");
      const bounds = {
        left: tileLeft + left / sampleScale,
        top: tileTop + top / sampleScale,
        width: (right + 1 - left) / sampleScale,
        height: (bottom + 1 - top) / sampleScale,
        rows: rows.map((row) => ({
          left: tileLeft + row.left / sampleScale,
          right: tileLeft + row.right / sampleScale,
          top: tileTop + row.top / sampleScale,
          bottom: tileTop + row.bottom / sampleScale,
          ...(row.spans
            ? {
                spans: row.spans.map((span) => ({
                  left: tileLeft + span.left / sampleScale,
                  right: tileLeft + span.right / sampleScale,
                })),
              }
            : {}),
        })),
      };
      const cacheIntervals = bounds.rows.reduce(
        (count, row) => count + 1 + (row.spans?.length || 0),
        0,
      );
      if (cache.size < 4096 && cachedRows + cacheIntervals <= MAX_CACHED_ROWS) {
        cachedRows += cacheIntervals;
        cache.set(key, {
          ...bounds,
          left: bounds.left - originX,
          top: bounds.top - originY,
          rows: shiftRows(bounds.rows, -originX, -originY),
        });
      }
      return bounds;
    },
    destroy() {
      cache.clear();
      cachedRows = 0;
      canvas.width = 0;
      canvas.height = 0;
    },
  };
};
