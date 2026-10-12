import assert from "node:assert/strict";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: ["src/lib/lessonTextSelection.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { selectLessonText, selectLessonTextDrag, findLessonTextAtPoint } =
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
  );
const page = { page: 1, width: 1348, height: 953, imageUrl: "fixture" };
// Actual embedded-font ink bounds from the supplied worksheet. The year begins
// less than one page pixel beyond the Korean word: average-width splitting fails.
const sample = [
  [
    "정",
    391.78087959732613,
    258.87641405149355,
    14.75912227044222,
    17.24168977085168,
  ],
  [
    "유",
    406.4515010680298,
    259.4286743407533,
    15.863837742633791,
    16.689429481591958,
  ],
  [
    "재",
    420.66918919513495,
    258.87641405149355,
    15.311480006538034,
    17.24168977085168,
  ],
  [
    "란",
    436.16834726998235,
    258.87641405149355,
    15.311480006538034,
    16.96555962622182,
  ],
  [
    "(",
    451.2938185221778,
    259.1525441961234,
    4.264325284622544,
    18.89847063863067,
  ],
  [
    "1",
    456.32027392064936,
    260.80932506390246,
    8.130829437292903,
    13.651997890663722,
  ],
  [
    "5",
    464.05328222599013,
    260.80932506390246,
    9.511723777532382,
    13.928128035293582,
  ],
  [
    "9",
    473.16718487157044,
    260.5331949192726,
    8.959366041436567,
    14.204258179923443,
  ],
  [
    "7",
    482.28108751715064,
    260.80932506390246,
    8.959366041436624,
    13.651997890663722,
  ],
  [
    ")",
    490.8426324266351,
    259.1525441961234,
    4.540504152670451,
    18.89847063863067,
  ],
].map(([label, left, top, width, height]) => ({
  label,
  left,
  top,
  width,
  height,
  page: 1,
}));
const rect = (x1, y1, x2, y2) => ({
  leftRatio: Math.min(x1, x2) / page.width,
  topRatio: Math.min(y1, y2) / page.height,
  widthRatio: Math.abs(x2 - x1) / page.width,
  heightRatio: Math.abs(y2 - y1) / page.height,
});
const selected = selectLessonText(sample, page, rect(389, 267, 450, 267));
assert.equal(selected.answer, "정유재란");
assert.equal(selected.regions.length, 4);
assert.ok(selected.rect.widthRatio * page.width < 60);
assert.ok(selected.rect.heightRatio * page.height < 18);
assert.ok(
  (selected.rect.leftRatio + selected.rect.widthRatio) * page.width <
    sample[4].left + 0.3,
);
assert.deepEqual(
  selectLessonText(sample, page, rect(450, 267, 389, 267)),
  selected,
  "reverse drag",
);
assert.deepEqual(
  selectLessonText(sample, page, rect(389, 250, 450, 283)),
  selected,
  "loose drag snaps to ink",
);
assert.equal(
  selectLessonText(sample, page, rect(391, 260, 407, 276)).answer,
  "정",
  "partial word",
);
assert.equal(
  selectLessonText(sample, page, rect(389, 250, 500, 285)).answer,
  "정유재란(1597)",
  "punctuation retained",
);
assert.ok(
  selectLessonText(sample, page, rect(100, 267, 200, 267)).error,
  "blank-space drag must fail",
);
assert.ok(
  selectLessonText(sample, page, rect(370, 267, 370, 267)).error,
  "no nearest-word click",
);
assert.ok(
  selectLessonText([], page, rect(389, 250, 500, 285)).error,
  "scanned page must fail",
);
const second = sample.map((r) => ({ ...r, top: r.top + 35 }));
assert.ok(
  selectLessonText([...sample, ...second], page, rect(389, 250, 450, 320))
    .error,
  "two lines must fail",
);
assert.equal(
  selectLessonText([...sample, ...second], page, rect(389, 300, 450, 310))
    .answer,
  "정유재란",
  "repeated words preserved",
);
const distant = sample.slice(0, 4).map((r) => ({ ...r, left: r.left + 300 }));
assert.ok(
  selectLessonText([...sample, ...distant], page, rect(389, 250, 752, 285))
    .error,
  "distant words must fail",
);
const interloper = {
  label: "가",
  page: 1,
  left: 410,
  top: 273,
  width: 10,
  height: 10,
};
assert.ok(
  selectLessonText([...sample, interloper], page, rect(389, 267, 450, 267))
    .error,
  "mask may not hide unselected glyphs",
);
const otherPage = sample.map((r) => ({ ...r, page: 2 }));
assert.ok(
  selectLessonText(otherPage, page, rect(389, 267, 450, 267)).error,
  "page boundary",
);
console.log(
  "Lesson text selection: real Korean/year bounds, horizontal/reverse/partial selection, adjacent text, duplicate words, whitespace, multi-line, distant text and page isolation passed.",
);

const point = (x, y) => ({ x: x / page.width, y: y / page.height });
const drag = (glyphs, x1, y1, x2, y2) =>
  selectLessonTextDrag(glyphs, page, point(x1, y1), point(x2, y2));
for (const dy of [-3, -2, -1, 0, 1, 2, 3]) {
  assert.equal(
    drag(sample, 389, 267, 450, 267 + dy).answer,
    "정유재란",
    `vertical wobble ${dy}`,
  );
  assert.equal(
    drag(sample, 450, 267 + dy, 389, 267).answer,
    "정유재란",
    `reverse wobble ${dy}`,
  );
}
// Tight Korean spacing: padding overlaps by 0.6px, actual ink remains separated.
const tight = [..."(임진왜란과)"].map((label, i) => ({
  label,
  page: 1,
  left: 100 + i * 10 - 0.4,
  top: 99.6,
  width: 10.6,
  height: 16.8,
  inkBounds: { left: 100 + i * 10, top: 100, width: 9.8, height: 16 },
  baseline: 115,
}));
for (const [start, end, expected] of [
  [110, 150, "임진왜란"],
  [110, 160, "임진왜란과"],
  [100, 170, "(임진왜란과)"],
  [130, 150, "왜란"],
]) {
  const result = drag(tight, start, 108, end, 110);
  assert.equal(result.answer, expected);
  assert.equal(drag(tight, end, 110, start, 108).answer, expected);
  assert.ok(result.rect.leftRatio * page.width <= start);
  assert.ok(
    (result.rect.leftRatio + result.rect.widthRatio) * page.width >=
      end - 0.2 - 1e-8,
  );
  assert.ok(
    (result.rect.leftRatio + result.rect.widthRatio) * page.width <= end + (end === 170 ? 0.3 : 1e-8),
    "padding must not mask next glyph",
  );
}
const bracketed = tight
  .filter((r) => r.label !== "과")
  .map((r) =>
    r.label === ")"
      ? {
          ...r,
          left: r.left - 10,
          inkBounds: { ...r.inkBounds, left: r.inkBounds.left - 10 },
        }
      : r,
  );
assert.equal(drag(bracketed, 100, 108, 160, 110).answer, "(임진왜란)");
assert.equal(drag(bracketed, 110, 108, 150, 110).answer, "임진왜란");
const trueCollision = tight.map((r) =>
  r.label === "과"
    ? {
        ...r,
        left: r.left - 1,
        inkBounds: { ...r.inkBounds, left: r.inkBounds.left - 1 },
      }
    : r,
);
assert.ok(
  drag(trueCollision, 110, 108, 149, 110).error,
  "genuine neighbouring ink collision must fail",
);
const punctuation = tight.map((r) =>
  r.label === ")"
    ? {
        ...r,
        top: 110,
        height: 5,
        inkBounds: { ...r.inkBounds, top: 110, height: 5 },
      }
    : r,
);
assert.equal(
  drag(punctuation, 100, 108, 170, 110).answer,
  "(임진왜란과)",
  "short punctuation follows baseline",
);
assert.equal(findLessonTextAtPoint(tight, page, point(115, 108))?.label, "임");
assert.equal(
  findLessonTextAtPoint(tight, page, point(109.9, 108)),
  undefined,
  "padding/gap is not a text cursor target",
);
assert.equal(findLessonTextAtPoint(tight, page, point(50, 50)), undefined);
assert.ok(
  drag(tight, 50, 50, 150, 108).error,
  "starting in empty space must not select a nearby line",
);
assert.ok(
  drag([...sample, ...second], 389, 267, 450, 302).error,
  "different endpoint line must fail",
);
assert.ok(drag([...sample, ...distant], 389, 267, 752, 267).error);
assert.ok(drag(otherPage, 389, 267, 450, 267).error);
console.log(
  "Text drag: forward/reverse wobble, Korean particles, parentheses, shared baselines, padding-only overlap, real ink collision, cursor hits and line boundaries passed.",
);
