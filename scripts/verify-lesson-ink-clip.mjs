import assert from "node:assert/strict";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: ["src/lib/lessonInkClip.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { createLessonInkClip } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const rectangle = { left: 0, top: 0, right: 10, bottom: 10 };
const row = (top, bottom, spans) => ({
  top,
  bottom,
  left: Math.min(...spans.map((span) => span[0])),
  right: Math.max(...spans.map((span) => span[1])),
  spans: spans.map(([left, right]) => ({ left, right })),
});
const near = (a, b, message) =>
  assert.ok(Math.abs(a - b) < 1e-8, `${message}: ${a} vs ${b}`);

// Independent evenodd scanline evaluator; includes the closing edge and every
// diagonal bridge, without consulting the helper's returned mask bands.
const polygonSpans = (polygon, y, rect) => {
  const points = polygon.map((point) => ({
    x: rect.left + point.x * (rect.right - rect.left),
    y: rect.top + point.y * (rect.bottom - rect.top),
  }));
  const crossings = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (a.y > y !== b.y > y)
      crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  crossings.sort((a, b) => a - b);
  assert.equal(
    crossings.length % 2,
    0,
    "Every scanline has an even number of crossings",
  );
  const spans = [];
  for (let i = 0; i < crossings.length; i += 2) {
    const left = crossings[i],
      right = crossings[i + 1];
    if (right - left < 1e-10) continue;
    const last = spans.at(-1);
    if (last && Math.abs(last.right - left) < 1e-8) last.right = right;
    else spans.push({ left, right });
  }
  return spans;
};

// Independent expected intervals: partition by all original x boundaries,
// evaluate each open cell against the source blockers, then merge filled cells.
const expectedSpans = (rows, y, rect) => {
  const active = rows
    .filter((item) => item.top <= y && item.bottom > y)
    .flatMap((item) =>
      item.spans?.length
        ? item.spans
        : [{ left: item.left, right: item.right }],
    );
  const xs = [
    ...new Set([
      rect.left,
      rect.right,
      ...active.flatMap((span) => [
        Math.max(rect.left, Math.min(rect.right, span.left)),
        Math.max(rect.left, Math.min(rect.right, span.right)),
      ]),
    ]),
  ].sort((a, b) => a - b);
  const spans = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const x = (xs[i] + xs[i + 1]) / 2;
    if (active.some((span) => span.left < x && span.right > x)) continue;
    const last = spans.at(-1);
    if (last && last.right === xs[i]) last.right = xs[i + 1];
    else spans.push({ left: xs[i], right: xs[i + 1] });
  }
  return spans;
};
const compareSpans = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, `${label}: interval count`);
  actual.forEach((span, index) => {
    near(span.left, expected[index].left, `${label}: left`);
    near(span.right, expected[index].right, `${label}: right`);
  });
};
let checked = 0;
const verify = (rows, rect = rectangle, label = "case") => {
  const result = createLessonInkClip(rect, rows);
  const ys = [
    ...new Set([
      rect.top,
      rect.bottom,
      ...rows.flatMap((item) => [
        Math.max(rect.top, Math.min(rect.bottom, item.top)),
        Math.max(rect.top, Math.min(rect.bottom, item.bottom)),
      ]),
    ]),
  ].sort((a, b) => a - b);
  const probes = ys
    .slice(0, -1)
    .flatMap((y, index) => [
      y + (ys[index + 1] - y) * 0.2,
      y + (ys[index + 1] - y) * 0.5,
      y + (ys[index + 1] - y) * 0.8,
    ]);
  if (probes.every((y) => expectedSpans(rows, y, rect).length === 0)) {
    assert.equal(result, undefined, `${label}: fully blocked mask must fail`);
    return;
  }
  assert.ok(result, `${label}: result`);
  assert.ok(result.polygon.length <= 2048 && result.polygon.length >= 4);
  assert.ok(
    result.polygon.every(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= 0 &&
        point.x <= 1 &&
        point.y >= 0 &&
        point.y <= 1,
    ),
  );
  near(result.bands[0].top, rect.top, `${label}: starts at rectangle top`);
  near(
    result.bands.at(-1).bottom,
    rect.bottom,
    `${label}: ends at rectangle bottom`,
  );
  result.bands.forEach((band, index) => {
    assert.ok(band.bottom > band.top);
    if (index)
      near(
        result.bands[index - 1].bottom,
        band.top,
        `${label}: gap-free y partition`,
      );
  });
  for (const y of probes) {
    const expected = expectedSpans(rows, y, rect);
    compareSpans(
      polygonSpans(result.polygon, y, rect),
      expected,
      `${label}: evenodd polygon at ${y}`,
    );
    const band = result.bands.find((item) => item.top <= y && item.bottom > y);
    assert.ok(band, `${label}: probe has band`);
    compareSpans(band.spans, expected, `${label}: returned band at ${y}`);
  }
  checked++;
  return result;
};

verify([], rectangle, "plain rectangle and closing edge");
verify([row(3, 7, [[3, 7]])], rectangle, "interior hole");
verify([row(0, 10, [[4, 6]])], rectangle, "disconnected islands");
verify(
  [row(0, 10, [[4, 6]]), row(2, 8, [[1, 3]]), row(4, 6, [[7, 9]])],
  rectangle,
  "holes inside disconnected islands",
);
verify(
  [row(0, 5, [[5, 10]]), row(5, 10, [[0, 5]])],
  rectangle,
  "components meeting only at a corner",
);
verify(
  [row(0, 5, [[2, 5]]), row(5, 10, [[5, 8]])],
  rectangle,
  "opposite notches meeting at a corner",
);
verify(
  [row(2, 4, [[0, 10]]), row(6, 8, [[0, 10]])],
  rectangle,
  "empty bands between islands",
);
verify(
  [
    row(-5, 4, [
      [-5, 2],
      [7, 15],
    ]),
    row(6, 15, [
      [-3, 3],
      [8, 13],
    ]),
  ],
  rectangle,
  "clipped input rows",
);
verify(
  [{ top: 2, bottom: 8, left: 3, right: 7 }],
  rectangle,
  "coarse rows block their whole outer interval",
);
verify(
  [{ top: 2, bottom: 8, left: 3, right: 7, spans: [] }],
  rectangle,
  "empty precise spans conservatively block the whole outer interval",
);
verify([row(0, 10, [[0, 10]])], rectangle, "fully blocked");
const narrowRect = { left: 236, top: 70, right: 240, bottom: 80 };
const narrow = verify(
  [
    row(70, 80, [
      [236, 236.224],
      [236.294, 240],
    ]),
  ],
  narrowRect,
  "0.07 pixel interior opening",
);
near(
  narrow.bands[0].spans[0].right - narrow.bands[0].spans[0].left,
  0.07,
  "Preserve narrow opening without raster quantization",
);

let seed = 712397;
const random = (max) => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed % max;
};
for (let sample = 0; sample < 200; sample++) {
  const rows = [];
  for (let i = 0; i < 1 + random(8); i++) {
    const x = random(10),
      y = random(10);
    rows.push(row(y, y + 1 + random(10 - y), [[x, x + 1 + random(10 - x)]]));
  }
  verify(rows, rectangle, `deterministic topology ${sample}`);
}
assert.equal(
  createLessonInkClip({ ...rectangle, right: Infinity }, []),
  undefined,
);
assert.equal(
  createLessonInkClip(rectangle, [{ ...row(1, 2, [[1, 2]]), top: NaN }]),
  undefined,
);
assert.equal(
  createLessonInkClip(rectangle, [row(1, 2, [[1, Infinity]])]),
  undefined,
);
const zigzag = Array.from({ length: 1400 }, (_, i) =>
  row(i, i + 1, [[0, i % 2 ? 2 : 3]]),
);
assert.equal(
  createLessonInkClip({ left: 0, top: 0, right: 10, bottom: 1400 }, zigzag),
  undefined,
  "Unrepresentable contours fail at the 2048 point limit instead of approximating ink",
);
console.log(
  `Lesson ink clip: ${checked} independent scanline cases passed (holes, islands, corner contacts, narrow openings, complete bands, reversed bridges, and bounded complexity).`,
);
