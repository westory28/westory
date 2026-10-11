import assert from "node:assert/strict";
import { build } from "esbuild";

// Exercise the real reader's paint observer using deterministic renderer events.
// The separate browser check uses the user's real embedded Korean fonts.
let scenario = [];
let destroyed = 0;
const glyph = (label) => ({ unicode: label, fontChar: label, isInFont: true });
const context = () => ({
  font: "10px sans-serif",
  globalAlpha: 1,
  lineWidth: 1,
  getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  measureText(text) {
    const size = Number.parseFloat(this.font);
    return {
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: size * 0.8,
      actualBoundingBoxAscent: size * 0.8,
      actualBoundingBoxDescent: size * 0.1,
    };
  },
  fillText() {},
  strokeText() {},
});
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => context() }),
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
          argsArray: scenario.map((s) => [s.labels.map(glyph)]),
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
              for (const p of s.paints) {
                canvasContext.fillText(p.label, p.x, 20);
                if (p.stroke) canvasContext.strokeText(p.label, p.x, 20);
              }
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
  const reader = createLessonPdfGlyphReader("fixture.pdf");
  try {
    return await reader.read(page);
  } finally {
    await reader.destroy();
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
assert.equal((await read()).map((r) => r.label).join(""), "정유");
scenario = [{ labels: ["유"], paints: [{ label: "유", x: 10, stroke: true }] }];
assert.equal(
  (await read()).length,
  1,
  "fill and stroke make one selectable glyph",
);
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
  (await read()).length,
  2,
  "repeated characters at different positions survive",
);
scenario = [];
assert.deepEqual(await read(), [], "scanned PDF has no guessed glyphs");
assert.equal(
  destroyed,
  6,
  "documents released after success and unsupported text",
);
console.log(
  "PDF glyph reader: actual-context contract, repeated glyphs, fill/stroke union, per-operation completeness, scanned page and cleanup passed.",
);
