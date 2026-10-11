import assert from "node:assert/strict";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: ["src/lib/lessonTextSelection.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { selectLessonText } = await import(
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
