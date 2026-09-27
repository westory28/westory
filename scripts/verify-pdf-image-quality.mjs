import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the production processor without a browser, Firebase, or PDF worker.
// Canvas/PDF.js are mocked; text-region extraction runs the real implementation.
const compile = (name) =>
  ts.transpileModule(
    readFileSync(
      new URL(`../src/lib/${name}.ts`, import.meta.url),
      "utf8",
    ).replaceAll("import.meta.url", JSON.stringify(import.meta.url)),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;

const textExports = {};
vm.runInNewContext(compile("pdfTextRegions"), { exports: textExports });
const processorCode = compile("pdfMapProcessor");
const textItem = {
  str: "Seoul",
  width: 45,
  height: 12,
  transform: [12, 0, 0, 12, 50, 120],
};
const file = { arrayBuffer: async () => new ArrayBuffer(8) };
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture(pageSpecs) {
  const events = [];
  const canvases = [];
  const renders = [];
  const encodes = [];
  let currentPage = 0;
  let destroys = 0;
  const pdf = {
    numPages: pageSpecs.length,
    async getPage(number) {
      currentPage = number;
      const spec = pageSpecs[number - 1];
      events.push(`get:${number}`);
      return {
        getViewport: ({ scale }) => ({
          width: spec.width * scale,
          height: spec.height * scale,
        }),
        render({ canvas }) {
          renders.push({
            page: number,
            width: canvas.width,
            height: canvas.height,
          });
          events.push(`render:${number}`);
          return {
            promise:
              spec.fail === "render"
                ? Promise.reject(new Error("render-failed"))
                : Promise.resolve(),
          };
        },
        async getTextContent() {
          events.push(`text:${number}`);
          if (spec.fail === "text") throw new Error("text-failed");
          return { items: [textItem, { type: "beginMarkedContent" }] };
        },
        cleanup() {
          events.push(`cleanup:${number}`);
        },
      };
    },
    async destroy() {
      destroys += 1;
      events.push("destroy");
    },
  };
  const exports = {};
  vm.runInNewContext(processorCode, {
    exports,
    URL,
    Uint8Array,
    require(name) {
      if (name === "react-pdf") {
        return {
          pdfjs: {
            GlobalWorkerOptions: {},
            getDocument: () => ({ promise: Promise.resolve(pdf) }),
          },
        };
      }
      if (name === "./pdfTextRegions") return textExports;
      throw new Error(`Unexpected dependency: ${name}`);
    },
    document: {
      createElement(tag) {
        assert.equal(tag, "canvas");
        const number = currentPage;
        const spec = pageSpecs[number - 1];
        let encodeCount = 0;
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => (spec.fail === "context" ? null : {}),
          toBlob(callback, type, quality) {
            events.push(`encode:${number}`);
            encodes.push({ page: number, type, quality });
            const size = spec.sizes ? spec.sizes[encodeCount++] : 100_000;
            callback(size === null ? null : { size, type });
          },
        };
        canvases.push(canvas);
        return canvas;
      },
    },
  });
  return {
    exports,
    events,
    canvases,
    renders,
    encodes,
    get destroys() {
      return destroys;
    },
  };
}

function assertReleased(run) {
  assert.equal(run.destroys, 1, "PDF document must be destroyed once");
  assert.equal(run.events.at(-1), "destroy");
  for (const canvas of run.canvases) {
    assert.equal(canvas.width, 0, "Canvas backing store must be released");
    assert.equal(canvas.height, 0);
  }
}

const cases = [
  { label: "A4", width: 595.28, height: 841.89 },
  { label: "landscape", width: 841.89, height: 595.28 },
  { label: "large square", width: 10_000, height: 10_000 },
  { label: "huge page", width: 100_000, height: 80_000 },
  { label: "narrow page", width: 0.01, height: 100_000 },
  { label: "wide page", width: 100_000, height: 0.01 },
];
const run = fixture(cases);
const result = await run.exports.processPdfMapFile(file);
assert.equal(result.pageImages.length, cases.length);
assert.equal(result.regions.length, cases.length);
for (const [index, spec] of cases.entries()) {
  const image = result.pageImages[index];
  const raster = run.renders[index];
  assert.ok(raster.width >= 1 && raster.height >= 1, spec.label);
  assert.ok(Math.max(raster.width, raster.height) <= 2560, spec.label);
  assert.ok(raster.width * raster.height <= 4_000_000, spec.label);
  assert.equal(
    image.width,
    Math.ceil(spec.width * 1.6),
    "Existing logical width stays stable",
  );
  assert.equal(
    image.height,
    Math.ceil(spec.height * 1.6),
    "Existing logical height stays stable",
  );
  const expected = textExports
    .extractPdfTextRegions([textItem], spec.height, 1.6)
    .map((region) => ({ ...region, page: index + 1 }));
  assert.deepEqual(
    plain(result.regions.filter((region) => region.page === index + 1)),
    plain(expected),
  );
  if (index > 0) {
    assert.ok(
      run.events.indexOf(`cleanup:${index}`) <
        run.events.indexOf(`get:${index + 1}`),
      "Pages must process and release sequentially",
    );
  }
}
assert.ok(
  run.renders[0].width >= result.pageImages[0].width * 1.6,
  "A4 must gain substantial detail",
);
assert.ok(run.renders[0].height >= result.pageImages[0].height * 1.6);
assert.equal(
  run.encodes.length,
  cases.length,
  "Ordinary pages encode only once",
);
assert.ok(
  run.encodes.every(
    ({ quality, type }) => quality === 0.9 && type === "image/webp",
  ),
);
assertReleased(run);

for (const { sizes, expectedSize, expectedEncodes } of [
  { sizes: [1024 * 1024], expectedSize: 1024 * 1024, expectedEncodes: 1 },
  { sizes: [1_200_000, 900_000], expectedSize: 900_000, expectedEncodes: 2 },
  {
    sizes: [1_200_000, 1_300_000],
    expectedSize: 1_200_000,
    expectedEncodes: 2,
  },
  {
    sizes: [2_000_000, 1_500_000],
    expectedSize: 1_500_000,
    expectedEncodes: 2,
  },
]) {
  const budget = fixture([{ ...cases[0], sizes }]);
  const converted = await budget.exports.processPdfMapFile(file);
  assert.equal(
    converted.pageImages[0].blob.size,
    expectedSize,
    "Keep the smaller image without an unbounded retry loop",
  );
  assert.equal(budget.encodes.length, expectedEncodes);
  if (expectedEncodes === 2) assert.equal(budget.encodes[1].quality, 0.82);
  assertReleased(budget);
}

for (const { fail, sizes, error } of [
  { fail: "render", error: /render-failed/ },
  { fail: "text", error: /text-failed/ },
  { fail: "context", error: /pdf-canvas-context-missing/ },
  { sizes: [null], error: /pdf-page-image-blob-failed/ },
  { sizes: [1_200_000, null], error: /pdf-page-image-blob-failed/ },
]) {
  const failed = fixture([{ ...cases[0], fail, sizes }, cases[1]]);
  await assert.rejects(failed.exports.processPdfMapFile(file), error);
  assert.deepEqual(
    failed.events.filter((event) => event.startsWith("cleanup:")),
    ["cleanup:1"],
  );
  assert.ok(!failed.events.includes("get:2"), "Stop after a failed page");
  assertReleased(failed);
}

console.log(
  `PDF image quality checks passed: A4 ${run.renders[0].width}x${run.renders[0].height}, logical ${result.pageImages[0].width}x${result.pageImages[0].height}; size/encode budgets, coordinates, sequential cleanup, and 5 failure paths.`,
);
