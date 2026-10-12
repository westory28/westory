import { pdfjs } from "react-pdf";
import type { LessonWorksheetPageImage } from "./lessonWorksheet";
import type { LessonPdfGlyph, LessonPdfGlyphPage } from "./lessonPdfGlyphTypes";
import {
  createLessonPdfInkSampler,
  paintLessonPdfGlyph,
  snapshotLessonPdfGlyphPaint,
  type LessonPdfGlyphPaintState,
  type LessonPdfInkBounds,
  type LessonPdfInkSample,
} from "./lessonPdfGlyphInk";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PdfGlyph {
  fontChar: string;
  unicode: string;
  accent?: unknown;
  isInFont?: boolean;
}

interface CapturedPaint {
  state: LessonPdfGlyphPaintState;
  text: string;
  x: number;
  y: number;
  stroke: boolean;
  candidate: LessonPdfInkBounds;
}

const inkIntersects = (a: LessonPdfGlyph, b: LessonPdfGlyph) => {
  const left = a.inkBounds,
    right = b.inkBounds;
  if (
    !left ||
    !right ||
    left.left >= right.left + right.width ||
    right.left >= left.left + left.width ||
    left.top >= right.top + right.height ||
    right.top >= left.top + left.height
  )
    return false;
  return (
    a.inkRows?.some((row) =>
      b.inkRows?.some(
        (other) =>
          row.left < other.right &&
          other.left < row.right &&
          row.top < other.bottom &&
          other.top < row.bottom,
      ),
    ) ?? false
  );
};

/**
 * Observe PDF.js's real paint calls: embedded font, kerning, crop and viewport
 * transforms have already been applied. No OCR model, network API, estimated
 * character widths or persisted glyph metadata. Unsupported path/Type3 text
 * deliberately produces no selectable glyphs.
 * Tested against the locked pdfjs-dist 5.4 renderer; keep the browser regression
 * check when updating react-pdf/pdfjs-dist.
 */
export const createLessonPdfGlyphReader = (source: File | string) => {
  let destroyed = false;
  const taskPromise = (async () =>
    pdfjs.getDocument(
      typeof source === "string"
        ? { url: source }
        : { data: new Uint8Array(await source.arrayBuffer()) },
    ))();
  const cache = new Map<string, Promise<LessonPdfGlyphPage>>();
  return {
    read(pageImage: LessonWorksheetPageImage) {
      const key = `${pageImage.page}:${pageImage.width}:${pageImage.height}`;
      if (cache.has(key)) return cache.get(key)!;
      const result = (async () => {
        const task = await taskPromise;
        if (destroyed) throw new Error("cancelled");
        const pdf = await task.promise;
        const page = await pdf.getPage(pageImage.page);
        const base = page.getViewport({ scale: 1 });
        // Coordinates must describe the very same saved page (including rotation).
        if (
          Math.abs(
            base.width / base.height - pageImage.width / pageImage.height,
          ) > 0.01
        )
          throw new Error("page-size-mismatch");
        const viewport = page.getViewport({
          scale: Math.min(3, 2400 / Math.max(base.width, base.height)),
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas-unavailable");
        const metricsCanvas = document.createElement("canvas");
        const metricsContext = metricsCanvas.getContext("2d")!;
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = canvas.width;
        maskCanvas.height = canvas.height;
        const maskContext = maskCanvas.getContext("2d");
        if (!metricsContext || !maskContext)
          throw new Error("canvas-unavailable");
        const inkSampler = createLessonPdfInkSampler();
        const ops = await page.getOperatorList();
        const expected = new Map<number, Map<string, number>>();
        for (let index = 0; index < ops.fnArray.length; index++) {
          if (ops.fnArray[index] !== pdfjs.OPS.showText) continue;
          const counts = new Map<string, number>();
          expected.set(index, counts);
          for (const glyph of (ops.argsArray[index]?.[0] || []) as Array<
            PdfGlyph | number
          >) {
            if (
              typeof glyph === "object" &&
              glyph?.isInFont &&
              glyph.unicode?.trim()
            ) {
              counts.set(glyph.unicode, (counts.get(glyph.unicode) || 0) + 1);
            }
          }
        }
        let glyphMap = new Map<string, string>();
        let operationIndex = -1;
        const captured = new Map<number, Map<string, Set<string>>>();
        const regions: LessonPdfGlyph[] = [];
        const originalPaints = new Map<LessonPdfGlyph, CapturedPaint[]>();
        const scaleX = pageImage.width / viewport.width,
          scaleY = pageImage.height / viewport.height;
        const pageInk = (ink: LessonPdfInkSample) => {
          // Keep only a small antialias margin around the actual painted ink.
          const left = Math.max(0, ink.left - 0.6) * scaleX,
            top = Math.max(0, ink.top - 0.6) * scaleY;
          const inkLeft = Math.max(0, ink.left) * scaleX,
            inkTop = Math.max(0, ink.top) * scaleY;
          return {
            left,
            top,
            width:
              Math.min(pageImage.width, (ink.left + ink.width + 0.6) * scaleX) -
              left,
            height:
              Math.min(
                pageImage.height,
                (ink.top + ink.height + 0.6) * scaleY,
              ) - top,
            inkBounds: {
              left: inkLeft,
              top: inkTop,
              width:
                Math.min(pageImage.width, (ink.left + ink.width) * scaleX) -
                inkLeft,
              height:
                Math.min(pageImage.height, (ink.top + ink.height) * scaleY) -
                inkTop,
            },
            inkRows: ink.rows
              .map((row) => ({
                left: Math.max(0, row.left) * scaleX,
                right: Math.min(pageImage.width, row.right * scaleX),
                top: Math.max(0, row.top) * scaleY,
                bottom: Math.min(pageImage.height, row.bottom * scaleY),
                ...(row.spans
                  ? {
                      spans: row.spans
                        .map((span) => ({
                          left: Math.max(0, span.left) * scaleX,
                          right: Math.min(pageImage.width, span.right * scaleX),
                        }))
                        .filter((span) => span.right > span.left),
                    }
                  : {}),
              }))
              .filter((row) => row.right > row.left && row.bottom > row.top),
          };
        };
        const capture = (
          text: string,
          x: number,
          y: number,
          stroke: boolean,
        ) => {
          const label = glyphMap.get(text);
          if (!label || !label.trim() || ctx.globalAlpha < 0.95) return;
          const t = ctx.getTransform();
          // Preserve the actual ink of decorative/rotated glyphs as blockers.
          // They must neither disable unrelated text nor enter a blank answer.
          const selectable =
            !/[\uFFFD\uE000-\uF8FF]/u.test(label) &&
            t.a > 0 &&
            t.d > 0 &&
            Math.abs(t.b) <= 0.001 &&
            Math.abs(t.c) <= 0.001;
          // These rounded font metrics reserve a scratch tile, never the final ink box.
          metricsContext.font = ctx.font.replace(
            /([\d.]+)px/u,
            (_, size) => `${Number(size) * 32}px`,
          );
          const measured = metricsContext.measureText(text);
          const m = {
            actualBoundingBoxLeft: measured.actualBoundingBoxLeft / 32,
            actualBoundingBoxRight: measured.actualBoundingBoxRight / 32,
            actualBoundingBoxAscent: measured.actualBoundingBoxAscent / 32,
            actualBoundingBoxDescent: measured.actualBoundingBoxDescent / 32,
          };
          const edge = stroke ? ctx.lineWidth / 2 : 0;
          const corners = [
            [
              x - m.actualBoundingBoxLeft - edge,
              y - m.actualBoundingBoxAscent - edge,
            ],
            [
              x + m.actualBoundingBoxRight + edge,
              y - m.actualBoundingBoxAscent - edge,
            ],
            [
              x - m.actualBoundingBoxLeft - edge,
              y + m.actualBoundingBoxDescent + edge,
            ],
            [
              x + m.actualBoundingBoxRight + edge,
              y + m.actualBoundingBoxDescent + edge,
            ],
          ].map(([cx, cy]) => [
            cx * t.a + cy * t.c + t.e,
            cx * t.b + cy * t.d + t.f,
          ]);
          const x1 = Math.min(...corners.map(([cx]) => cx));
          const x2 = Math.max(...corners.map(([cx]) => cx));
          const y1 = Math.min(...corners.map(([, cy]) => cy));
          const y2 = Math.max(...corners.map(([, cy]) => cy));
          if (![x1, x2, y1, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1)
            return;
          const candidate = {
            left: x1,
            top: y1,
            width: x2 - x1,
            height: y2 - y1,
          };
          const ink = inkSampler.measure(ctx, text, x, y, stroke, candidate);
          if (!ink) return;
          const operation =
            captured.get(operationIndex) || new Map<string, Set<string>>();
          captured.set(operationIndex, operation);
          const paints = operation.get(label) || new Set<string>();
          operation.set(label, paints);
          // Fill+stroke at one origin is one glyph, even though the ink bounds differ.
          paints.add(
            `${text}:${x}:${y}:${t.a}:${t.b}:${t.c}:${t.d}:${t.e}:${t.f}`,
          );
          const region: LessonPdfGlyph = {
            label,
            ...(selectable ? {} : { selectable: false as const }),
            page: pageImage.page,
            ...pageInk(ink),
            baseline: (y * t.d + t.f) * scaleY,
          };
          regions.push(region);
          originalPaints.set(region, [
            {
              state: snapshotLessonPdfGlyphPaint(ctx),
              text,
              x,
              y,
              stroke,
              candidate,
            },
          ]);
          if (selectable)
            paintLessonPdfGlyph(maskContext, ctx, text, x, y, stroke, t);
        };
        const maskPathMethods = new Set([
          "save",
          "restore",
          "beginPath",
          "closePath",
          "moveTo",
          "lineTo",
          "bezierCurveTo",
          "quadraticCurveTo",
          "rect",
          "arc",
          "arcTo",
          "ellipse",
          "roundRect",
          "clip",
        ]);
        const observed = new Proxy(ctx, {
          get(target, property) {
            // Keep the PDF's clipping path so glyphs outside the crop stay hidden.
            if (typeof property === "string" && maskPathMethods.has(property))
              return (...args: unknown[]) => {
                maskContext.setTransform(target.getTransform());
                Reflect.get(maskContext, property, maskContext).apply(
                  maskContext,
                  args,
                );
                return Reflect.get(target, property, target).apply(
                  target,
                  args,
                );
              };
            if (property === "fillText" || property === "strokeText")
              return (
                text: string,
                x: number,
                y: number,
                maxWidth?: number,
              ) => {
                if (maxWidth === undefined)
                  capture(text, x, y, property === "strokeText");
                if (maxWidth === undefined) target[property](text, x, y);
                else target[property](text, x, y, maxWidth);
              };
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
          set(target, property, value) {
            return Reflect.set(target, property, value, target);
          },
        });
        try {
          await page.render({
            canvas: null,
            canvasContext: observed,
            viewport,
            operationsFilter: (index) => {
              operationIndex = index;
              glyphMap = new Map();
              if (ops.fnArray[index] === pdfjs.OPS.showText) {
                const glyphs = ops.argsArray[index]?.[0];
                if (Array.isArray(glyphs))
                  for (const glyph of glyphs as Array<PdfGlyph | number>) {
                    if (
                      typeof glyph !== "object" ||
                      !glyph ||
                      glyph.accent ||
                      typeof glyph.fontChar !== "string" ||
                      typeof glyph.unicode !== "string"
                    )
                      continue;
                    const previous = glyphMap.get(glyph.fontChar);
                    glyphMap.set(
                      glyph.fontChar,
                      previous !== undefined && previous !== glyph.unicode
                        ? ""
                        : glyph.unicode,
                    );
                  }
              }
              return true;
            },
          }).promise;
          if (destroyed) throw new Error("cancelled");
          // A transparency group or outlined font may paint on another canvas.
          // Reject partial capture so a missing glyph cannot silently disappear
          // from the answer or from our neighbouring-text collision check.
          if (
            [...expected].some(([index, counts]) =>
              [...counts].some(
                ([label, count]) =>
                  (captured.get(index)?.get(label)?.size || 0) < count,
              ),
            )
          ) {
            throw new Error("unsupported-pdf-text-paint");
          }
          // Filled/stroked copies and faux-bold overprints refer to one glyph.
          const unique: LessonPdfGlyph[] = [];
          for (const r of regions) {
            if (r.width <= 0 || r.height <= 0) continue;
            const previous = unique.find(
              (p) =>
                p.label === r.label &&
                Math.abs(p.left - r.left) < 0.8 &&
                Math.abs(p.top - r.top) < 0.8,
            );
            if (!previous) unique.push(r);
            else {
              originalPaints.get(previous)!.push(...originalPaints.get(r)!);
              originalPaints.delete(r);
              if (r.selectable === false) previous.selectable = false;
              const right = Math.max(
                previous.left + previous.width,
                r.left + r.width,
              );
              const bottom = Math.max(
                previous.top + previous.height,
                r.top + r.height,
              );
              previous.left = Math.min(previous.left, r.left);
              previous.top = Math.min(previous.top, r.top);
              previous.width = right - previous.left;
              previous.height = bottom - previous.top;
              if (r.inkRows)
                previous.inkRows = [...(previous.inkRows || []), ...r.inkRows];
              if (previous.inkBounds && r.inkBounds) {
                const inkRight = Math.max(
                  previous.inkBounds.left + previous.inkBounds.width,
                  r.inkBounds.left + r.inkBounds.width,
                );
                const inkBottom = Math.max(
                  previous.inkBounds.top + previous.inkBounds.height,
                  r.inkBounds.top + r.inkBounds.height,
                );
                previous.inkBounds.left = Math.min(
                  previous.inkBounds.left,
                  r.inkBounds.left,
                );
                previous.inkBounds.top = Math.min(
                  previous.inkBounds.top,
                  r.inkBounds.top,
                );
                previous.inkBounds.width = inkRight - previous.inkBounds.left;
                previous.inkBounds.height = inkBottom - previous.inkBounds.top;
              }
            }
          }
          // A single coarse alpha cell can straddle a narrow but real gap.
          // Spend higher resolution only on neighbouring ink that actually overlaps.
          const refine = new Set<LessonPdfGlyph>();
          for (let i = 0; i < unique.length; i++) {
            const a = unique[i];
            if (a.selectable === false || a.baseline === undefined) continue;
            for (let j = i + 1; j < unique.length; j++) {
              const b = unique[j];
              if (
                b.selectable === false ||
                b.baseline === undefined ||
                Math.abs(a.baseline - b.baseline) >
                  Math.max(a.height, b.height) * 0.3
              )
                continue;
              if (inkIntersects(a, b)) {
                refine.add(a);
                refine.add(b);
              }
            }
          }
          let refinedCount = 0;
          for (const region of refine) {
            try {
              const samples = originalPaints
                .get(region)!
                .map((paint) =>
                  inkSampler.measure(
                    paint.state,
                    paint.text,
                    paint.x,
                    paint.y,
                    paint.stroke,
                    paint.candidate,
                    64,
                  ),
                );
              if (
                samples.every(
                  (sample): sample is LessonPdfInkSample => !!sample,
                )
              ) {
                const left = Math.min(...samples.map((sample) => sample.left));
                const top = Math.min(...samples.map((sample) => sample.top));
                Object.assign(
                  region,
                  pageInk({
                    left,
                    top,
                    width:
                      Math.max(
                        ...samples.map((sample) => sample.left + sample.width),
                      ) - left,
                    height:
                      Math.max(
                        ...samples.map((sample) => sample.top + sample.height),
                      ) - top,
                    rows: samples.flatMap((sample) => sample.rows),
                  }),
                );
              }
            } catch (error) {
              // A larger tile must never relax the allocation cap or the collision guard.
              if (
                !(error instanceof Error) ||
                !/^unsupported-pdf-glyph-(size|crop|complexity)$/u.test(
                  error.message,
                )
              )
                throw error;
            }
            if (++refinedCount % 4 === 0) {
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              if (destroyed) throw new Error("cancelled");
            }
          }
          return {
            regions: unique,
            maskUrl: unique.some((r) => r.selectable !== false)
              ? maskCanvas.toDataURL("image/png")
              : "",
          };
        } finally {
          canvas.width = 0;
          canvas.height = 0;
          metricsCanvas.width = 0;
          metricsCanvas.height = 0;
          maskCanvas.width = 0;
          maskCanvas.height = 0;
          inkSampler.destroy();
          page.cleanup();
        }
      })();
      cache.set(key, result);
      result.catch(() => cache.delete(key));
      return result;
    },
    async destroy() {
      destroyed = true;
      cache.clear();
      const task = await taskPromise;
      await task.destroy();
    },
  };
};
