import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: ["src/lib/lessonTextSelection.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { selectLessonText, selectLessonTextDrag, createLessonTextBlank } =
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
  );
const page = { page: 1, width: 1348, height: 953, imageUrl: "fixture" };
const point = (x, y) => ({ x: x / page.width, y: y / page.height });
const ink = (glyph) => glyph.inkBounds || glyph;
const center = (glyph) => ink(glyph).left + ink(glyph).width / 2;
const stripSpaces = (text) => text.replaceAll(" ", "");
const variants = (regions) => [
  ["exact rows", regions],
  ["without rows", regions.map(({ inkRows: _rows, ...glyph }) => glyph)],
  [
    "without spans",
    regions.map((glyph) => ({
      ...glyph,
      inkRows: glyph.inkRows?.map(({ spans: _spans, ...row }) => row),
    })),
  ],
];
const assertSelection = (result, expected, label) => {
  assert.ok(!("error" in result), `${label}: ${result.error}`);
  assert.equal(
    stripSpaces(result.answer),
    expected.map((glyph) => glyph.label).join(""),
    label,
  );
  assert.equal(result.regions.length, expected.length, label);
  expected.forEach((glyph, index) =>
    assert.equal(
      result.regions[index],
      glyph,
      `${label}: exact glyph identity ${index}`,
    ),
  );
  assert.equal(
    result.rect.inkClip,
    undefined,
    "Character selection has no mask-specific contour",
  );
};
let gestureChecks = 0,
  rectangleChecks = 0;
const assertEverySubstring = (
  source,
  name,
  { targetIndices = source.map((_, index) => index) } = {},
) => {
  const reorderedSources = [
    ["reversed input", [...source].reverse()],
    [
      "shuffled input",
      [
        ...source.filter((_, index) => index % 2 === 1),
        ...source.filter((_, index) => index % 2 === 0),
      ],
    ],
  ];
  for (let start = 0; start < targetIndices.length; start++) {
    for (let end = start; end < targetIndices.length; end++) {
      const indices = targetIndices.slice(start, end + 1);
      let reference;
      for (const [variant, regions] of variants(source)) {
        const expected = indices.map((index) => regions[index]);
        const first = expected[0],
          last = expected.at(-1);
        // Caret boundaries lie on either side of ink centres. They remain
        // unambiguous when neighbouring painted glyph boxes overlap.
        const x1 = center(first) - 0.1,
          x2 = center(last) + 0.1;
        const y1 = ink(first).top + ink(first).height / 2;
        const y2 = ink(last).top + ink(last).height / 2;
        for (const wobble of [-1, 0, 1]) {
          const a = point(x1, y1),
            b = point(x2, y2 + wobble);
          for (const reverse of [false, true]) {
            const result = selectLessonTextDrag(
              regions,
              page,
              reverse ? b : a,
              reverse ? a : b,
            );
            const label = `${name}/${variant}/${start}:${end}/${reverse}/${wobble}`;
            assertSelection(result, expected, label);
            const summary = { answer: result.answer, rect: result.rect };
            if (reference)
              assert.deepEqual(
                summary,
                reference,
                `${label}: direction, wobble and paint metadata must not alter selection`,
              );
            else reference = summary;
            gestureChecks++;
          }
        }
        const top = Math.min(...expected.map((glyph) => glyph.top)) - 0.05;
        const bottom =
          Math.max(...expected.map((glyph) => glyph.top + glyph.height)) + 0.05;
        const result = selectLessonText(regions, page, {
          leftRatio: x1 / page.width,
          topRatio: top / page.height,
          widthRatio: (x2 - x1) / page.width,
          heightRatio: (bottom - top) / page.height,
        });
        assertSelection(
          result,
          expected,
          `${name}/${variant}/${start}:${end}/rectangle`,
        );
        assert.deepEqual(
          { answer: result.answer, rect: result.rect },
          reference,
        );
        rectangleChecks++;
      }
      const expected = indices.map((index) => source[index]);
      const first = expected[0],
        last = expected.at(-1);
      const a = point(
        center(first) - 0.1,
        ink(first).top + ink(first).height / 2,
      );
      const b = point(center(last) + 0.1, ink(last).top + ink(last).height / 2);
      for (const [order, regions] of reorderedSources) {
        for (const reverse of [false, true]) {
          const result = selectLessonTextDrag(
            regions,
            page,
            reverse ? b : a,
            reverse ? a : b,
          );
          const label = `${name}/${order}/${start}:${end}/${reverse}`;
          assertSelection(result, expected, label);
          assert.deepEqual(
            { answer: result.answer, rect: result.rect },
            reference,
            label,
          );
          gestureChecks++;
        }
        const top = Math.min(...expected.map((item) => item.top)) - 0.05;
        const bottom =
          Math.max(...expected.map((item) => item.top + item.height)) + 0.05;
        const result = selectLessonText(regions, page, {
          leftRatio: a.x,
          topRatio: top / page.height,
          widthRatio: b.x - a.x,
          heightRatio: (bottom - top) / page.height,
        });
        assertSelection(
          result,
          expected,
          `${name}/${order}/${start}:${end}/rectangle`,
        );
        assert.deepEqual(
          { answer: result.answer, rect: result.rect },
          reference,
        );
        rectangleChecks++;
      }
    }
  }
};
const glyph = (label, left, width, top = 100, height = 20, baseline = 118) => ({
  label,
  page: 1,
  left: left - 0.3,
  top: top - 0.3,
  width: width + 0.6,
  height: height + 0.6,
  baseline,
  inkBounds: { left, top, width, height },
  inkRows: [
    {
      left,
      right: left + width,
      top,
      bottom: top + height,
      spans: [{ left, right: left + width }],
    },
  ],
});
const widths = [11, 3, 12, 7, 4, 13, 8, 10];
const labels = ["가", "7", "(", "β", ",", "의", ")", "J"];
const renamedLabels = ["α", "8", "]", "한", ".", "은", "(", "Z"];
const makeSequence = (gaps, useShortMarks = false) => {
  let left = 100;
  return labels.map((label, index) => {
    const short = useShortMarks && [0, 1, 4, 5].includes(index);
    const item = glyph(
      label,
      left,
      widths[index],
      short ? 116 : 100,
      short ? 2 : 20,
    );
    left += widths[index] + gaps[index % gaps.length];
    return item;
  });
};
for (const [name, gaps, short] of [
  ["regular", [2], false],
  ["tight", [0.1], false],
  ["paint-overlap", [-1.25], false],
  ["wide", [14], false],
  ["mixed", [2, -0.75, 10, 0, 14, 1, 6], false],
  ["short-marks", [2], true],
  ["short-marks-wide", [14], true],
]) {
  const sequence = makeSequence(gaps, short);
  assertEverySubstring(sequence, name);
  // A dictionary or suffix exception would fail the same geometry with these
  // unrelated labels. The intended result is always the same indexed slice.
  assertEverySubstring(
    sequence.map((item, index) => ({ ...item, label: renamedLabels[index] })),
    `${name}/relabeled`,
  );
}

// The line's vertical envelope must include small body text even when a tall
// decoration starts far above the median-height glyphs on the same baseline.
assertEverySubstring(
  [
    glyph("◆", 100, 25, 30, 120, 148),
    glyph("A", 130, 30, 90, 60, 148),
    glyph("B", 165, 30, 90, 60, 148),
    glyph("가", 200, 12, 130, 20, 148),
    glyph("나", 217, 12, 130, 20, 148),
  ],
  "tall decoration and small body text",
);

// A direct hit in overlapping ink boxes belongs to the closest glyph centre,
// independently of which box happened to be returned first by the PDF reader.
const deeplyOverlapping = [glyph("A", 100, 24), glyph("B", 112, 8)];
for (const [metadata, source] of variants(deeplyOverlapping)) {
  for (const regions of [source, [...source].reverse()]) {
    const expected = [source[1]];
    for (const [a, b] of [
      [point(116, 110), point(116, 110)],
      [point(115.8, 109.8), point(116.2, 110.2)],
      [point(116.2, 110.2), point(115.8, 109.8)],
    ]) {
      assertSelection(
        selectLessonTextDrag(regions, page, a, b),
        expected,
        `deep overlap/${metadata}/click or microdrag`,
      );
      gestureChecks++;
    }
    assertSelection(
      selectLessonText(regions, page, {
        leftRatio: 116 / page.width,
        topRatio: 110 / page.height,
        widthRatio: 0,
        heightRatio: 0,
      }),
      expected,
      `deep overlap/${metadata}/point rectangle`,
    );
    rectangleChecks++;
  }
}

// Selection must succeed before any conservative mask rejection. Exact spans,
// row envelopes and absent rows all describe the same selectable characters.
let rejectedMasks = 0;
const collision = [glyph("X", 100, 10), glyph("의", 104, 16)];
for (const [name, regions] of variants(collision)) {
  for (const reverse of [false, true]) {
    const a = point(102, 110),
      b = point(108, 110);
    const selected = selectLessonTextDrag(
      regions,
      page,
      reverse ? b : a,
      reverse ? a : b,
    );
    assertSelection(
      selected,
      [regions[0]],
      `mask collision/${name}/${reverse}`,
    );
    const before = JSON.stringify(selected),
      originalRegions = selected.regions;
    const mask = createLessonTextBlank(selected, regions, page);
    assert.ok("error" in mask, "An excessive overlap remains unsafe to blank");
    assert.equal(
      selected.regions,
      originalRegions,
      "A failed mask cannot replace the selected glyph array",
    );
    assert.equal(
      JSON.stringify(selected),
      before,
      "A failed mask cannot change answer, regions or rect",
    );
    rejectedMasks++;
  }
}

// The same full-line geometry defines continuity for every substring. A large
// cell gap and a separate line remain boundaries, including reverse gestures.
const line = makeSequence([2]);
const secondLine = line.map((item) => ({
  ...item,
  top: item.top + 40,
  baseline: item.baseline + 40,
  inkBounds: { ...item.inkBounds, top: item.inkBounds.top + 40 },
  inkRows: item.inkRows.map((row) => ({
    ...row,
    top: row.top + 40,
    bottom: row.bottom + 40,
  })),
}));
const right = ink(line.at(-1)).left + ink(line.at(-1)).width;
const otherCell = glyph("셀", right + 50, 12);
for (const reverse of [false, true]) {
  for (const [regions, a, b, reason] of [
    [
      [...line, ...secondLine],
      point(center(line[0]), 110),
      point(center(secondLine.at(-1)), 150),
      "different lines",
    ],
    [
      [...line, otherCell],
      point(center(line[0]), 110),
      point(center(otherCell), 110),
      "different cells",
    ],
  ]) {
    assert.ok(
      "error" in
        selectLessonTextDrag(regions, page, reverse ? b : a, reverse ? a : b),
      reason,
    );
  }
}
assert.ok(
  "error" in
    selectLessonText([...line, ...secondLine], page, {
      leftRatio: 95 / page.width,
      topRatio: 95 / page.height,
      widthRatio: (right - 90) / page.width,
      heightRatio: 70 / page.height,
    }),
  "A rectangle spanning two lines cannot become a single blank",
);
assert.ok(
  "error" in selectLessonTextDrag(line, page, point(40, 50), point(45, 50)),
  "Whitespace never selects a nearby word",
);
assert.ok(
  "error" in
    selectLessonTextDrag(
      line.map((item) => ({ ...item, page: 2 })),
      page,
      point(100, 110),
      point(right, 110),
    ),
  "Page identity is a boundary",
);

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/lesson-text-ink.json", import.meta.url),
    "utf8",
  ),
);
const actual = fixture.cases.find(
  (context) => context.name === "internal-hollow-chunchu",
);
assert.ok(actual, "The actual 춘추관 contour fixture must remain available");
const targetIndices = actual.regions
  .map((item, index) => [item, index])
  .filter(([item]) => ["춘", "추", "관"].includes(item.label))
  .map(([, index]) => index);
assert.equal(targetIndices.length, 3);
assertEverySubstring(actual.regions, "actual 춘추관 every substring", {
  targetIndices,
});
console.log(
  `Character selection principles: ${gestureChecks} forward/reverse/wobble gestures and ${rectangleChecks} rectangles cover every synthetic/춘추관 substring independently of paint rows and input order; tall decorations and overlapping centre hits passed; ${rejectedMasks} mask rejections preserve selection; line/cell/page boundaries passed.`,
);
