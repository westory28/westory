import assert from "node:assert/strict";
import { build } from "esbuild";

// Exercise the real reader's paint observer using deterministic renderer events.
// The separate browser check uses the user's real embedded Korean fonts.
let scenario = [];
let destroyed = 0;
let canvases = [];
let inkShape = { left: 0.1, right: 0.7, top: -0.7, bottom: 0.05 };
let transparentInk = false;
let contourInk = false;
let interiorWhitespace = false;
let denseInk = false;
const glyph = (label) => ({ unicode: label, fontChar: label, isInFont: true });
const context = () => ({
  font: "10px sans-serif",
  textAlign: "start",
  textBaseline: "alphabetic",
  direction: "ltr",
  fontKerning: "none",
  fontStretch: "normal",
  fontVariantCaps: "normal",
  letterSpacing: "0px",
  wordSpacing: "0px",
  textRendering: "auto",
  globalAlpha: 1,
  fillStyle: "#000000",
  strokeStyle: "#000000",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 10,
  lineDashOffset: 0,
  transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  getTransform() {
    return this.transform;
  },
  setTransform(value) {
    this.transform = { ...value };
  },
  getLineDash: () => [2, 1],
  setLineDash(value) {
    this.lineDash = value;
  },
  paints: [],
  paths: [],
  readCount: 0,
  getImageData(_x, _y, width, height) {
    this.readCount++;
    const data = new Uint8ClampedArray(width * height * 4);
    if (transparentInk) return { data };
    const paint = this.paints.at(-1);
    const size = Number.parseFloat(paint.font);
    const edge = paint.kind === "stroke" ? paint.lineWidth / 2 : 0;
    const t = paint.transform;
    const corners = [
      [
        paint.x + inkShape.left * size - edge,
        paint.y + inkShape.top * size - edge,
      ],
      [
        paint.x + inkShape.right * size + edge,
        paint.y + inkShape.top * size - edge,
      ],
      [
        paint.x + inkShape.left * size - edge,
        paint.y + inkShape.bottom * size + edge,
      ],
      [
        paint.x + inkShape.right * size + edge,
        paint.y + inkShape.bottom * size + edge,
      ],
    ].map(([x, y]) => [x * t.a + y * t.c + t.e, x * t.b + y * t.d + t.f]);
    const left = Math.floor(Math.min(...corners.map(([x]) => x)));
    const right = Math.ceil(Math.max(...corners.map(([x]) => x)));
    const top = Math.floor(Math.min(...corners.map(([, y]) => y)));
    const bottom = Math.ceil(Math.max(...corners.map(([, y]) => y)));
    for (let y = Math.max(0, top); y < Math.min(height, bottom); y++) {
      const rowLeft = contourInk && y < (top + bottom) / 2 ? left + 32 : left;
      const rowRight =
        contourInk && y >= (top + bottom) / 2 ? right - 32 : right;
      for (let x = Math.max(0, rowLeft); x < Math.min(width, rowRight); x++) {
        const holeInset = y < (top + bottom) / 2 ? 0.4 : 0.35;
        if (
          interiorWhitespace &&
          x >= left + (right - left) * holeInset &&
          x < right - (right - left) * holeInset
        )
          continue;
        if (denseInk && (x + y) % 2 === 0) continue;
        // Even the faintest antialias edge must remain inside the reported box.
        data[(y * width + x) * 4 + 3] =
          x === left || x === right - 1 || y === top || y === bottom - 1
            ? 1
            : 255;
      }
    }
    return { data };
  },
  save() {
    this.paths.push(["save", this.getTransform()]);
  },
  restore() {
    this.paths.push(["restore", this.getTransform()]);
  },
  beginPath() {
    this.paths.push(["beginPath", this.getTransform()]);
  },
  rect(...args) {
    this.paths.push(["rect", this.getTransform(), ...args]);
  },
  clip(...args) {
    this.paths.push(["clip", this.getTransform(), ...args]);
  },
  measureText(text) {
    const size = Number.parseFloat(this.font);
    return {
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: size * 0.8,
      actualBoundingBoxAscent: size * 0.8,
      actualBoundingBoxDescent: size * 0.1,
    };
  },
  fillText(text, x, y) {
    this.paints.push({
      kind: "fill",
      text,
      x,
      y,
      font: this.font,
      transform: this.getTransform(),
      color: this.fillStyle,
    });
  },
  strokeText(text, x, y) {
    this.paints.push({
      kind: "stroke",
      text,
      x,
      y,
      font: this.font,
      transform: this.getTransform(),
      color: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      miterLimit: this.miterLimit,
      lineDash: this.lineDash,
      lineDashOffset: this.lineDashOffset,
    });
  },
});
globalThis.document = {
  createElement: () => {
    const ctx = context();
    const canvas = {
      width: 0,
      height: 0,
      getContext: (_kind, options) => {
        canvas.options = options;
        return ctx;
      },
      toDataURL(type) {
        assert.equal(type, "image/png");
        assert.ok(this.width > 0 && this.height > 0);
        return `data:image/png;base64,${Buffer.from(JSON.stringify({ width: this.width, height: this.height, paints: ctx.paints, paths: ctx.paths })).toString("base64")}`;
      },
    };
    canvases.push(canvas);
    return canvas;
  },
};
globalThis.__glyphPdf = {
  OPS: { showText: 44 },
  GlobalWorkerOptions: {},
  getDocument: () => ({
    destroy: async () => {
      destroyed++;
    },
    promise: Promise.resolve({
      getPage: async () => ({
        getViewport: ({ scale }) => ({
          width: 100 * scale,
          height: 100 * scale,
        }),
        getOperatorList: async () => ({
          fnArray: scenario.map(() => 44),
          argsArray: scenario.map((s) => [s.glyphs || s.labels.map(glyph)]),
        }),
        render: ({ canvas, canvasContext, operationsFilter }) => ({
          promise: (async () => {
            assert.equal(
              canvas,
              null,
              "PDF.js requires null canvas to use the supplied context",
            );
            scenario.forEach((s, index) => {
              operationsFilter(index);
              if (s.font) canvasContext.font = s.font;
              if (s.lineWidth) canvasContext.lineWidth = s.lineWidth;
              if (s.transform) canvasContext.setTransform(s.transform);
              if (s.clip) {
                canvasContext.save();
                canvasContext.beginPath();
                canvasContext.rect(0, 0, 50, 30);
                canvasContext.clip("evenodd");
              }
              for (const p of s.paints) {
                canvasContext.fillText(p.label, p.x, 20);
                if (p.stroke) canvasContext.strokeText(p.label, p.x, 20);
              }
              if (s.clip) canvasContext.restore();
            });
          })(),
        }),
        cleanup() {},
      }),
    }),
  }),
};
const compiled = await build({
  entryPoints: ["src/lib/lessonPdfGlyphs.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  define: { "import.meta.url": JSON.stringify("file:///glyph-test.js") },
  plugins: [
    {
      name: "fake-pdf-renderer",
      setup(b) {
        b.onResolve({ filter: /^react-pdf$/ }, () => ({
          path: "pdf",
          namespace: "test",
        }));
        b.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents: "export const pdfjs=globalThis.__glyphPdf",
        }));
      },
    },
  ],
});
const { createLessonPdfGlyphReader } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const page = { page: 1, width: 100, height: 100, imageUrl: "fixture" };
async function read() {
  canvases = [];
  const reader = createLessonPdfGlyphReader("fixture.pdf");
  try {
    return await reader.read(page);
  } finally {
    await reader.destroy();
    assert.ok(
      canvases.every((canvas) => canvas.width === 0 && canvas.height === 0),
      "Release render, metrics and mask canvas backing stores",
    );
  }
}
scenario = [
  {
    labels: ["정", "유"],
    paints: [
      { label: "정", x: 10 },
      { label: "유", x: 22 },
    ],
  },
];
const first = await read();
assert.equal(first.regions.map((r) => r.label).join(""), "정유");
assert.ok(
  first.regions.every((region) =>
    region.inkRows.every((row) => row.spans === undefined),
  ),
  "Ordinary 16x rows retain compact outer contours only",
);
assert.match(first.maskUrl, /^data:image\/png;base64,/);
const decodeMask = (result) =>
  JSON.parse(Buffer.from(result.maskUrl.split(",")[1], "base64").toString());
assert.deepEqual(
  decodeMask(first).paints.map((paint) => paint.color),
  ["#ffffff", "#ffffff"],
);
scenario = [{ labels: ["유"], paints: [{ label: "유", x: 10, stroke: true }] }];
const stroked = await read();
assert.equal(
  stroked.regions.length,
  1,
  "fill and stroke make one selectable glyph",
);
assert.deepEqual(
  decodeMask(stroked).paints.map((paint) => paint.kind),
  ["fill", "stroke"],
);
assert.deepEqual(decodeMask(stroked).paints[1].lineDash, [2, 1]);
assert.ok(
  Math.abs(stroked.regions[0].inkBounds.width - 7 / 3) < 1e-9,
  "Ink union includes the stroke without antialias padding",
);
assert.ok(stroked.regions[0].width > stroked.regions[0].inkBounds.width);
assert.equal(
  stroked.regions[0].inkRows.length,
  2,
  "Merged fill and stroke preserve both occupied row intervals",
);
assert.ok(
  Math.abs(
    stroked.regions[0].width - stroked.regions[0].inkBounds.width - 0.4,
  ) < 1e-9,
  "Saved padding is exactly the measured ink plus 0.6 render pixels on each side",
);
assert.ok(Math.abs(stroked.regions[0].baseline - 20 / 3) < 1e-9);
scenario = [
  { labels: ["유", "유"], paints: [{ label: "유", x: 10, stroke: true }] },
];
await assert.rejects(
  read(),
  /unsupported-pdf-text-paint/,
  "duplicate paint cannot hide missing glyph in same operation",
);
scenario = [
  { labels: ["유"], paints: [{ label: "유", x: 10, stroke: true }] },
  { labels: ["유"], paints: [] },
];
await assert.rejects(
  read(),
  /unsupported-pdf-text-paint/,
  "duplicate paint cannot hide missing offscreen operation",
);
scenario = [
  {
    labels: ["유", "유"],
    paints: [
      { label: "유", x: 10 },
      { label: "유", x: 22 },
    ],
  },
];
const repeated = await read();
assert.equal(
  repeated.regions.length,
  2,
  "repeated characters at different positions survive",
);
assert.ok(
  Math.abs(
    repeated.regions[1].inkRows[0].left -
      repeated.regions[0].inkRows[0].left -
      4,
  ) < 1e-9,
  "Cached contours follow the glyph's translated origin",
);
assert.equal(
  repeated.regions[1].inkRows[0].top,
  repeated.regions[0].inkRows[0].top,
);
const sampledCanvas = canvases.find(
  (canvas) => canvas.options?.willReadFrequently,
);
assert.ok(sampledCanvas, "Readback canvas must request willReadFrequently");
assert.equal(
  sampledCanvas.getContext("2d").readCount,
  1,
  "Repeated glyphs at the same subpixel phase reuse the measured alpha shape",
);
scenario = [
  {
    glyphs: [{ unicode: "정", fontChar: "\uE001", isInFont: true }],
    font: "12px embedded-pdf-font",
    transform: { a: 2, b: 0, c: 0, d: 3, e: 7, f: 11 },
    clip: true,
    paints: [{ label: "\uE001", x: 10 }],
  },
];
const embedded = await read();
const mask = decodeMask(embedded);
assert.equal(embedded.regions[0].label, "정");
assert.ok(Math.abs(embedded.regions[0].inkBounds.left - 29.375 / 3) < 1e-9);
assert.ok(Math.abs(embedded.regions[0].inkBounds.width - 14.4375 / 3) < 1e-9);
assert.ok(
  embedded.regions[0].inkBounds.width < 6.4,
  "Rounded metrics cannot inflate the alpha-derived ink box",
);
assert.ok(Math.abs(embedded.regions[0].baseline - 71 / 3) < 1e-9);
assert.deepEqual(mask.paints[0], {
  kind: "fill",
  text: "\uE001",
  x: 10,
  y: 20,
  font: "12px embedded-pdf-font",
  transform: scenario[0].transform,
  color: "#ffffff",
});
assert.deepEqual(
  mask.paths.map((path) => path[0]),
  ["save", "beginPath", "rect", "clip", "restore"],
);
assert.deepEqual(mask.paths[3], ["clip", scenario[0].transform, "evenodd"]);
assert.equal(mask.width, 300);
assert.equal(mask.height, 300);
scenario = [
  { labels: ["이"], paints: [{ label: "이", x: 10 }] },
  {
    labels: ["\uF0EA", "\uFFFD"],
    paints: [
      { label: "\uF0EA", x: 30 },
      { label: "\uFFFD", x: 42 },
    ],
  },
];
const decorated = await read();
assert.equal(
  decorated.regions.length,
  3,
  "Decorative ink stays available for collision protection",
);
assert.equal(decorated.regions[0].selectable, undefined);
assert.ok(
  decorated.regions
    .slice(1)
    .every((r) => r.selectable === false && r.inkRows.length),
);
assert.deepEqual(
  decodeMask(decorated).paints.map((p) => p.text),
  ["이"],
  "Unmapped decorative Unicode does not enter the selected-text mask",
);
scenario = [
  { labels: ["이"], paints: [{ label: "이", x: 10 }] },
  {
    labels: ["｢"],
    transform: { a: 0, b: 1, c: -1, d: 0, e: 100, f: 30 },
    paints: [{ label: "｢", x: 10 }],
  },
];
const rotated = await read();
assert.equal(
  rotated.regions[0].selectable,
  undefined,
  "A rotated corner bracket must not disable ordinary text on the page",
);
assert.equal(rotated.regions[1].selectable, false);
assert.ok(Math.abs(rotated.regions[1].inkBounds.left - 79.5 / 3) < 1e-9);
assert.ok(Math.abs(rotated.regions[1].inkBounds.top - 41 / 3) < 1e-9);
assert.ok(Math.abs(rotated.regions[1].inkBounds.width - 7.5 / 3) < 1e-9);
assert.ok(Math.abs(rotated.regions[1].inkBounds.height - 6 / 3) < 1e-9);
assert.deepEqual(
  decodeMask(rotated).paints.map((p) => p.text),
  ["이"],
);
scenario = [
  {
    labels: ["｢"],
    transform: { a: -1, b: 0, c: 0, d: -1, e: 100, f: 60 },
    paints: [{ label: "｢", x: 10, stroke: true }],
  },
];
const mirrored = await read();
assert.equal(
  mirrored.regions.length,
  1,
  "Fill/stroke deduplication also applies to local blockers",
);
assert.equal(mirrored.regions[0].selectable, false);
assert.ok(Math.abs(mirrored.regions[0].inkBounds.left - 82.5 / 3) < 1e-9);
assert.ok(Math.abs(mirrored.regions[0].inkBounds.top - 39 / 3) < 1e-9);
assert.ok(Math.abs(mirrored.regions[0].inkBounds.width - 7 / 3) < 1e-9);
assert.equal(
  mirrored.maskUrl,
  "",
  "A decoration-only page has no selected-text mask",
);
scenario = [
  {
    labels: ["종", "의"],
    paints: [
      { label: "종", x: 10 },
      { label: "의", x: 17.9 },
    ],
  },
];
const adjacent = await read();
assert.ok(
  adjacent.regions[0].left + adjacent.regions[0].width <
    adjacent.regions[1].left,
  "Padded alpha boxes no longer retain the legacy metrics overlap",
);
assert.ok(
  adjacent.regions[0].inkBounds.left + adjacent.regions[0].inkBounds.width <
    adjacent.regions[1].inkBounds.left,
  "Separate alpha strokes must not inherit the metrics overlap",
);
scenario = [
  {
    labels: ["국", "을"],
    paints: [
      { label: "국", x: 10.01, stroke: true },
      { label: "을", x: 17.04, stroke: true },
    ],
  },
  {
    labels: ["옷"],
    font: "14px changed-after-original-paint",
    lineWidth: 5,
    paints: [{ label: "옷", x: 90 }],
  },
];
const refined = await read();
assert.ok(
  refined.regions[0].inkBounds.left + refined.regions[0].inkBounds.width <
    refined.regions[1].inkBounds.left,
  "A narrow real gap sharing a 16x alpha cell separates at 64x",
);
assert.ok(
  Math.abs(refined.regions[0].inkBounds.width - 7.015625 / 3) < 1e-9,
  "Refinement preserves original 10px font and 1px stroke after the render context changes",
);
assert.equal(
  refined.regions[0].inkRows.length,
  2,
  "Refinement retains both original fill and stroke contours",
);
let refinementCanvas = canvases.find(
  (canvas) => canvas.options?.willReadFrequently,
);
assert.equal(
  refinementCanvas.getContext("2d").readCount,
  9,
  "Only the overlapping pair is resampled; separated text remains at 16x",
);
scenario = [
  {
    labels: ["국", "을"],
    paints: [
      { label: "국", x: 10.01 },
      { label: "을", x: 16.005 },
    ],
  },
];
const touching = await read();
assert.ok(
  touching.regions[0].inkBounds.left + touching.regions[0].inkBounds.width >
    touching.regions[1].inkBounds.left,
  "Higher sampling does not invent a gap where glyph ink still intersects",
);
refinementCanvas = canvases.find(
  (canvas) => canvas.options?.willReadFrequently,
);
assert.equal(refinementCanvas.getContext("2d").readCount, 4);
scenario = [
  {
    labels: ["국", "을"],
    font: "100px oversized-refinement",
    paints: [
      { label: "국", x: 10.01 },
      { label: "을", x: 70.04 },
    ],
  },
];
const boundedRefinement = await read();
assert.ok(
  boundedRefinement.regions[0].inkBounds.left +
    boundedRefinement.regions[0].inkBounds.width >
    boundedRefinement.regions[1].inkBounds.left,
  "When 64x exceeds the pixel cap, retain the conservative coarse collision bounds",
);
refinementCanvas = canvases.find(
  (canvas) => canvas.options?.willReadFrequently,
);
assert.equal(
  refinementCanvas.getContext("2d").readCount,
  2,
  "Oversized refinements fail before allocation/readback without failing the whole page",
);
scenario = [
  {
    labels: ["국", "국", "국", "국"],
    paints: [
      { label: "국", x: 10.01 },
      { label: "국", x: 16.005 },
      { label: "국", x: 50.01 },
      { label: "국", x: 56.005 },
    ],
  },
];
interiorWhitespace = true;
const hollowRefinement = await read();
interiorWhitespace = false;
const hollowRows = hollowRefinement.regions[0].inkRows;
assert.equal(
  hollowRows.length,
  2,
  "Rows with equal outer edges but different interior gaps must remain separate",
);
assert.ok(
  hollowRows.every(
    (row) => row.spans.length === 2 && row.spans[0].right < row.spans[1].left,
  ),
  "Refined rows retain actual occupied runs instead of filling the interior whitespace",
);
assert.ok(hollowRows[0].spans[0].right > hollowRows[1].spans[0].right);
assert.ok(
  Math.abs(
    hollowRefinement.regions[2].inkRows[0].spans[0].left -
      hollowRows[0].spans[0].left -
      40 / 3,
  ) < 1e-9,
  "Cached 64x run coordinates follow the original glyph transform and page scale",
);
assert.ok(
  Math.abs(
    hollowRefinement.regions[2].inkRows[1].spans[1].right -
      hollowRows[1].spans[1].right -
      40 / 3,
  ) < 1e-9,
);
refinementCanvas = canvases.find(
  (canvas) => canvas.options?.willReadFrequently,
);
assert.equal(
  refinementCanvas.getContext("2d").readCount,
  4,
  "Translated overlapping pairs share their cached coarse and refined samples",
);
scenario = [
  {
    labels: ["국", "을"],
    paints: [
      { label: "국", x: 10.01 },
      { label: "을", x: 16.005 },
    ],
  },
];
denseInk = true;
const complexRefinement = await read();
denseInk = false;
assert.ok(
  complexRefinement.regions.every((region) =>
    region.inkRows.every((row) => row.spans === undefined),
  ),
  "A pathological number of occupied runs keeps coarse protection instead of unbounded geometry",
);
scenario = [{ labels: [","], paints: [{ label: ",", x: 10 }] }];
contourInk = true;
const contoured = (await read()).regions[0];
contourInk = false;
assert.equal(
  contoured.inkRows.length,
  2,
  "Identical consecutive pixel rows are compressed into runs",
);
assert.equal(contoured.inkRows[0].bottom, contoured.inkRows[1].top);
assert.ok(
  contoured.inkRows[0].left > contoured.inkRows[1].left,
  "A comma's upper ink does not inherit the lower tail's leftmost x",
);
assert.ok(contoured.inkRows[0].right > contoured.inkRows[1].right);
assert.equal(contoured.inkBounds.left, contoured.inkRows[1].left);
assert.ok(
  Math.abs(
    contoured.inkBounds.left +
      contoured.inkBounds.width -
      contoured.inkRows[0].right,
  ) < 1e-9,
);
scenario = [
  {
    labels: ["정"],
    transform: { a: 1000, b: 0, c: 0, d: 1000, e: 0, f: 0 },
    paints: [{ label: "정", x: 10 }],
  },
];
await assert.rejects(
  read(),
  /unsupported-pdf-glyph-size/,
  "Oversized glyphs fail before allocating an unbounded scratch bitmap",
);
scenario = [{ labels: ["정"], paints: [{ label: "정", x: 10 }] }];
const regularInk = inkShape;
inkShape = { ...regularInk, left: -10 };
await assert.rejects(
  read(),
  /unsupported-pdf-glyph-crop/,
  "An underestimated candidate tile must fail instead of truncating ink",
);
inkShape = regularInk;
transparentInk = true;
await assert.rejects(
  read(),
  /unsupported-pdf-text-paint/,
  "Empty pixel capture cannot silently remove a glyph",
);
transparentInk = false;
scenario = [];
assert.deepEqual(
  await read(),
  { regions: [], maskUrl: "" },
  "scanned PDF has no guessed glyphs or unused mask",
);
assert.equal(
  destroyed,
  20,
  "documents released after success and unsupported text",
);
console.log(
  "PDF glyph reader: original mask, 16x alpha ink and compressed row contours, bounded adaptive 64x occupied runs, immutable paint snapshots, local decorative/rotated blockers, measured padding, overlap regression, bounded scratch/cache, fill/stroke/clip, completeness and cleanup passed.",
);
