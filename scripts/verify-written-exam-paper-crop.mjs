import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
const source = (
  await readFile("src/lib/writtenExamPaperCrop.ts", "utf8")
).replaceAll("import.meta.url", '"file:///test"');
const exports = {};
vm.runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText,
  { exports },
);
const {
  detectWrittenExamPaperCrops: detect,
  normalizeWrittenExamPaperRect: normalize,
} = exports;
const text = (text, x, y, width = 0.3, height = 0.012) => ({
  text,
  rect: { x, y, width, height },
});
const block = (n, x, y) => [
  text(`${n}. 가상 역사 문항`, x, y),
  ...[..."①②③④⑤"].map((marker, index) =>
    text(`${marker} 선택지 ${index + 1}`, x + 0.01, y + 0.035 + index * 0.025),
  ),
];
const page = {
  page: 1,
  width: 600,
  height: 850,
  items: [
    ...block(1, 0.06, 0.08),
    ...block(2, 0.06, 0.4),
    ...block(3, 0.55, 0.08),
    ...block(4, 0.55, 0.4),
  ],
};
const questions = [1, 2, 3, 4].map((number) => ({
  number,
  answer: String(number),
}));
const result = detect([page], questions);
assert.equal(result.crops.length, 4);
assert.ok(result.crops.every((crop) => crop.status === "ready"));
assert.ok(result.crops.every((crop) => crop.highlights.length === 1));
assert.ok(result.crops[0].rect.x + result.crops[0].rect.width < 0.5);
assert.ok(result.crops[2].rect.x > 0.5);
assert.ok(
  result.crops[0].rect.y + result.crops[0].rect.height < result.crops[1].rect.y,
);
assert.equal(result.crops[1].highlights[0].y, 0.4 + 0.035 + 0.025);
const missing = detect([{ ...page, items: [] }], questions);
assert.ok(
  missing.crops.every(
    (crop) => crop.status === "review" && !crop.highlights.length,
  ),
);
assert.ok(missing.warnings.some((message) => message.includes("글자 정보")));
const duplicate = detect(
  [{ ...page, items: [...page.items, text("1. 중복 문항", 0.06, 0.75)] }],
  questions,
);
assert.equal(duplicate.crops[0].status, "review");
assert.equal(duplicate.crops[0].highlights.length, 0);
const merged = detect(
  [
    {
      ...page,
      items: [
        text("1. 가상 문항", 0.06, 0.08),
        text("① 하나 ② 둘 ③ 셋 ④ 넷 ⑤ 다섯", 0.06, 0.12, 0.7),
      ],
    },
  ],
  [{ number: 1, answer: "2" }],
);
assert.equal(merged.crops[0].status, "review");
assert.equal(
  merged.crops[0].highlights.length,
  0,
  "Unknown glyph positions must not silently paint a guessed answer",
);
assert.throws(
  () => normalize({ x: 0, y: 0, width: NaN, height: 0.1 }),
  /위치와 크기/,
);
assert.equal(normalize({ x: -0.2, y: 0, width: 2, height: 1 }).width, 1);
assert.throws(
  () => normalize({ x: 1, y: 0, width: 0.2, height: 0.2 }),
  /페이지 밖/,
);
assert.throws(
  () => normalize({ x: 0, y: 1, width: 0.2, height: 0.2 }),
  /페이지 밖/,
);
console.log(
  "PASS written exam PDF crop: two-column boundaries, answer-only highlight, scanned/missing/duplicate/ambiguous recovery, rectangle validation",
);
