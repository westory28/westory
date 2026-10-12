import assert from "node:assert/strict";
import { build } from "esbuild";

// Exercise the real reader's paint observer using deterministic renderer events.
// The separate browser check uses the user's real embedded Korean fonts.
let scenario = [];
let destroyed = 0;
let canvases = [];
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
      getContext: () => ctx,
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
  Math.abs(stroked.regions[0].inkBounds.width - 3) < 1e-9,
  "Ink union includes the stroke without antialias padding",
);
assert.ok(stroked.regions[0].width > stroked.regions[0].inkBounds.width);
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
assert.equal(
  (await read()).regions.length,
  2,
  "repeated characters at different positions survive",
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
assert.equal(embedded.regions[0].inkBounds.left, 9);
assert.ok(Math.abs(embedded.regions[0].inkBounds.width - 6.4) < 1e-9);
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
scenario = [];
assert.deepEqual(
  await read(),
  { regions: [], maskUrl: "" },
  "scanned PDF has no guessed glyphs or unused mask",
);
assert.equal(
  destroyed,
  7,
  "documents released after success and unsupported text",
);
console.log(
  "PDF glyph reader: original white glyph mask/font/transform/clip, ink/baseline geometry, repeated glyphs, fill/stroke union, completeness, scanned page and cleanup passed.",
);
