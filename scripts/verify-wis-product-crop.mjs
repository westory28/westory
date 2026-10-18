import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const file = fileURLToPath(
  new URL("../src/lib/pointProductCrop.ts", import.meta.url),
);
const exports = {};
const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
vm.runInNewContext(compiled, { exports }, { filename: file });
const { getProductCropRect } = exports;
const center = { zoom: 1, x: 0.5, y: 0.5 };
let cases = 0;
const equalRectangle = (width, height, crop, expected) => {
  const actual = getProductCropRect(width, height, crop);
  assert.deepEqual({ ...actual }, expected);
  cases++;
};

equalRectangle(1600, 900, center, { x: 350, y: 0, size: 900 });
equalRectangle(900, 1600, center, { x: 0, y: 350, size: 900 });
equalRectangle(1200, 1200, center, { x: 0, y: 0, size: 1200 });
equalRectangle(
  1600,
  900,
  { zoom: 3, x: 0.5, y: 0.5 },
  {
    x: 650,
    y: 300,
    size: 300,
  },
);
equalRectangle(
  1600,
  900,
  { zoom: 2, x: 0, y: 1 },
  {
    x: 0,
    y: 450,
    size: 450,
  },
);
equalRectangle(
  1600,
  900,
  { zoom: 2, x: 1, y: 0 },
  {
    x: 1150,
    y: 0,
    size: 450,
  },
);
equalRectangle(
  1600,
  900,
  { zoom: -20, x: -10, y: 20 },
  {
    x: 0,
    y: 0,
    size: 900,
  },
);
equalRectangle(
  1600,
  900,
  { zoom: 100, x: 20, y: -10 },
  {
    x: 1300,
    y: 0,
    size: 300,
  },
);
equalRectangle(1, 1, { zoom: 3, x: 1, y: 1 }, { x: 0, y: 0, size: 1 });
equalRectangle(
  1,
  500,
  { zoom: 3, x: 0.5, y: 1 },
  {
    x: 0,
    y: 499,
    size: 1,
  },
);

for (const invalid of [0, -1, 0.5, NaN, Infinity, -Infinity, "100", null]) {
  assert.throws(() => getProductCropRect(invalid, 500, center));
  assert.throws(() => getProductCropRect(500, invalid, center));
  cases += 2;
}
for (const field of ["zoom", "x", "y"]) {
  for (const invalid of [NaN, Infinity, -Infinity, "1", undefined, null]) {
    assert.throws(() =>
      getProductCropRect(500, 500, { ...center, [field]: invalid }),
    );
    cases++;
  }
}
for (const crop of [undefined, null, {}]) {
  assert.throws(() => getProductCropRect(500, 500, crop));
  cases++;
}

// An exhaustive grid covers portrait/landscape edges, fractional zoom, and tiny
// sources; its assertions describe the crop's geometry, not its implementation.
for (const [width, height] of [
  [1, 1],
  [2, 9],
  [9, 2],
  [317, 211],
  [211, 317],
  [4000, 10000],
  [10000, 4000],
]) {
  for (const zoom of [0, 1, 1.1, 1.5, 2, 2.75, 3, 4]) {
    for (const x of [-1, 0, 0.1, 0.5, 0.9, 1, 2]) {
      for (const y of [-1, 0, 0.1, 0.5, 0.9, 1, 2]) {
        const rectangle = getProductCropRect(width, height, { zoom, x, y });
        assert.ok(Object.values(rectangle).every(Number.isFinite));
        assert.ok(rectangle.size >= 1);
        assert.ok(rectangle.x >= 0 && rectangle.y >= 0);
        assert.ok(rectangle.x + rectangle.size <= width + 1e-9);
        assert.ok(rectangle.y + rectangle.size <= height + 1e-9);
        const reflected = getProductCropRect(width, height, {
          zoom,
          x: 1 - x,
          y: 1 - y,
        });
        assert.ok(
          Math.abs(rectangle.x + reflected.x + rectangle.size - width) < 1e-9,
        );
        assert.ok(
          Math.abs(rectangle.y + reflected.y + rectangle.size - height) < 1e-9,
        );
        cases++;
      }
    }
  }
}

console.log(
  `PASS product crop geometry: ${cases} cases; no browser or network`,
);
