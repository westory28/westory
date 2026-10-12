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

// Browser-measured embedded font contours from the reported worksheets. These
// regressions include real negative spacing, rather than evenly spaced mocks.
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/lesson-text-ink.json", import.meta.url),
    "utf8",
  ),
);
const scanLine = (polygon, y) => {
  const xs = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a.y > y !== b.y > y)
      xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  return xs.sort((a, b) => a - b);
};
const mergeSpans = (spans) => {
  const merged = [];
  for (const span of [...spans].sort((a, b) => a.left - b.left)) {
    if (span.right <= span.left) continue;
    const previous = merged.at(-1);
    if (previous && span.left <= previous.right)
      previous.right = Math.max(previous.right, span.right);
    else merged.push({ ...span });
  }
  return merged;
};
const subtractSpans = (source, remove) => {
  const remaining = [];
  for (const span of source) {
    let left = span.left;
    for (const cut of remove) {
      if (cut.right <= left || cut.left >= span.right) continue;
      if (cut.left > left) remaining.push({ left, right: cut.left });
      left = Math.max(left, cut.right);
      if (left >= span.right) break;
    }
    if (left < span.right) remaining.push({ left, right: span.right });
  }
  return remaining;
};
const checkPaint = (selection, all) => {
  const rect = selection.rect,
    left = rect.leftRatio * page.width,
    top = rect.topRatio * page.height;
  const width = rect.widthRatio * page.width,
    height = rect.heightRatio * page.height;
  const polygon = (
    rect.inkClip || [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]
  ).map((p) => ({ x: left + p.x * width, y: top + p.y * height }));
  const selected = new Set(selection.regions);
  const rows = all
    .filter((glyph) => glyph.page === page.page)
    .flatMap((glyph) => {
      const bounds = glyph.inkBounds || glyph;
      return (
        glyph.inkRows || [
          {
            top: bounds.top,
            bottom: bounds.top + bounds.height,
            left: bounds.left,
            right: bounds.left + bounds.width,
          },
        ]
      ).map((row) => ({
        ...row,
        selected: selected.has(glyph),
        label: glyph.label,
      }));
    });
  // Partition at every measured row and polygon boundary. Checking only the
  // selected row midpoint can miss an adjacent glyph's much shorter ink run.
  const ys = [
    ...new Set([
      ...polygon.map((p) => p.y),
      ...rows.flatMap((row) => [row.top, row.bottom]),
    ]),
  ].sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] - ys[i - 1] < 1e-7) continue;
    const y = (ys[i] + ys[i - 1]) / 2;
    const active = rows.filter((row) => row.top < y && row.bottom > y);
    const paint = (wantSelected) =>
      mergeSpans(
        active
          .filter((row) => row.selected === wantSelected)
          .flatMap(
            (row) => row.spans || [{ left: row.left, right: row.right }],
          ),
      );
    const chosenInk = paint(true),
      neighbourInk = paint(false);
    const xs = scanLine(polygon, y);
    assert.equal(
      xs.length % 2,
      0,
      "even-odd polygon crossings form complete pairs",
    );
    const mask = mergeSpans(
      xs.flatMap((x, index) =>
        index % 2 === 0 ? [{ left: x, right: xs[index + 1] }] : [],
      ),
    );
    // Shared original pixels must stay visible with the neighbour. Only the
    // selected glyph's exclusive paint is required to be covered by the mask.
    const exclusive = subtractSpans(chosenInk, neighbourInk);
    assert.ok(
      subtractSpans(exclusive, mask).every(
        (span) => span.right - span.left <= 1e-6,
      ),
      `selected-exclusive ink must be hidden at y=${y}: ${selection.answer}`,
    );
    for (const span of neighbourInk)
      for (const cover of mask)
        assert.ok(
          Math.min(cover.right, span.right) - Math.max(cover.left, span.left) <=
            1e-6,
          `neighbour ink must remain visible at y=${y}: ${selection.answer}`,
        );
  }
};
let actualChecks = 0;
for (const context of fixture.cases) {
  const glyphs = context.regions;
  const text = glyphs.map((g) => g.label).join("");
  for (const expected of context.words) {
    const word = expected.replaceAll(" ", ""),
      start = text.indexOf(word);
    assert.ok(start >= 0, `${context.name}: fixture includes ${word}`);
    const selected = glyphs.slice(start, start + Array.from(word).length);
    const first = selected[0],
      last = selected.at(-1);
    const x1 = first.inkBounds.left + 0.05,
      x2 = last.inkBounds.left + last.inkBounds.width - 0.05;
    const y = first.top + first.height / 2;
    for (const reverse of [false, true])
      for (const wobble of [-1, 0, 1]) {
        const a = { x: (reverse ? x2 : x1) / page.width, y: y / page.height };
        const b = {
          x: (reverse ? x1 : x2) / page.width,
          y: (y + wobble) / page.height,
        };
        const selection = selectLessonTextDrag(glyphs, page, a, b);
        assert.equal(
          selection.answer?.replaceAll(" ", ""),
          word,
          `${context.name}/${word}/${reverse}/${wobble}: ${selection.error || selection.answer}`,
        );
        checkPaint(selection, glyphs);
        actualChecks++;
      }
  }
}
const blocked = { ...fixture.cases[0].regions[0], selectable: false };
const blockedPoint = (x, y) => ({ x: x / page.width, y: y / page.height });
assert.equal(
  findLessonTextAtPoint(
    [blocked],
    page,
    blockedPoint(
      blocked.left + blocked.width / 2,
      blocked.top + blocked.height / 2,
    ),
  ),
  undefined,
  "decorative/rotated glyph is not an I-beam target",
);
assert.ok(
  selectLessonTextDrag(
    [blocked],
    page,
    blockedPoint(blocked.left, blocked.top + 2),
    blockedPoint(blocked.left + blocked.width, blocked.top + 2),
  ).error,
  "decorative glyph is never an answer",
);
console.log(
  `Actual PDF contours: ${actualChecks} comma/particle/parenthesis/negative-spacing gestures; selected-exclusive ink coverage and neighbouring ink preservation passed.`,
);

const point = (x, y) => ({ x: x / page.width, y: y / page.height });
const drag = (glyphs, x1, y1, x2, y2) =>
  selectLessonTextDrag(glyphs, page, point(x1, y1), point(x2, y2));

const inkRow = (top, bottom, spans) => ({
  top,
  bottom,
  left: Math.min(...spans.map((span) => span.left)),
  right: Math.max(...spans.map((span) => span.right)),
  spans,
});
const inkGlyph = (label, rows) => {
  const left = Math.min(...rows.map((row) => row.left)),
    right = Math.max(...rows.map((row) => row.right)),
    top = Math.min(...rows.map((row) => row.top)),
    bottom = Math.max(...rows.map((row) => row.bottom));
  return {
    label,
    page: 1,
    left: left - 0.3,
    top: top - 0.3,
    width: right - left + 0.6,
    height: bottom - top + 0.6,
    inkBounds: { left, top, width: right - left, height: bottom - top },
    baseline: 115,
    inkRows: rows,
  };
};
// A heading marker and full stop contribute two short ink heights to a
// three-glyph selection. Their median must not shrink the ordinary word gap.
const heading = [
  inkGlyph("一", [inkRow(107, 109, [{ left: 100, right: 110 }])]),
  inkGlyph(".", [inkRow(114, 116, [{ left: 111, right: 114 }])]),
  inkGlyph("전", [inkRow(100, 116, [{ left: 124, right: 134 }])]),
  inkGlyph("쟁", [inkRow(100, 116, [{ left: 135, right: 145 }])]),
];
let headingChecks = 0;
for (const reverse of [false, true]) {
  for (const [x1, x2, expected] of [
    [100.1, 133.9, "一.전"],
    [124.1, 144.9, "전쟁"],
  ]) {
    const result = drag(
      heading,
      reverse ? x2 : x1,
      108,
      reverse ? x1 : x2,
      108,
    );
    assert.equal(
      result.answer?.replaceAll(" ", ""),
      expected,
      `short heading marker/${reverse}: ${result.error}`,
    );
    checkPaint(result, heading);
    headingChecks++;
  }
  const separatedCell = inkGlyph("칸", [
    inkRow(100, 116, [{ left: 184, right: 194 }]),
  ]);
  const cells = [...heading.slice(0, 3), separatedCell];
  assert.ok(
    drag(cells, reverse ? 193.9 : 100.1, 108, reverse ? 100.1 : 193.9, 108)
      .error,
    "A short heading marker must not permit a 50px gap into a separate table cell",
  );
}
console.log(
  `Heading punctuation: ${headingChecks} short-marker/full-height-letter and ordinary-word gestures passed; separate table cells remain blocked.`,
);
const centerGlyph = inkGlyph("환", [
  inkRow(100, 116, [{ left: 100, right: 110 }]),
]);
const rightGlyph = inkGlyph("국", [
  inkRow(100, 108, [{ left: 109.95, right: 120 }]),
  inkRow(108, 116, [{ left: 110.5, right: 120 }]),
]);
const leftGlyph = inkGlyph("의", [
  inkRow(100, 108, [{ left: 90, right: 100.05 }]),
  inkRow(108, 116, [{ left: 90, right: 99.5 }]),
]);
let sharedChecks = 0;
for (const glyphs of [
  [centerGlyph, rightGlyph],
  [leftGlyph, centerGlyph],
  [leftGlyph, centerGlyph, rightGlyph],
]) {
  for (const [x1, x2, expected] of [
    [100.2, 109.7, "환"],
    ...(glyphs.includes(leftGlyph) ? [[90.2, 99.8, "의"]] : []),
    ...(glyphs.includes(rightGlyph) ? [[110.2, 119.8, "국"]] : []),
  ]) {
    let forward;
    for (const reverse of [false, true]) {
      const result = drag(
        glyphs,
        reverse ? x2 : x1,
        104,
        reverse ? x1 : x2,
        104,
      );
      assert.equal(
        result.answer,
        expected,
        `shared edge/${expected}/${reverse}: ${result.error}`,
      );
      assert.ok(
        result.rect.inkClip?.length,
        "A shared edge requires an explicit contour",
      );
      checkPaint(result, glyphs);
      if (!reverse) forward = result;
      else
        assert.deepEqual(
          result.rect,
          forward.rect,
          "Reverse gestures must use the same contour",
        );
      sharedChecks++;
    }
  }
}
const sharedSelection = drag([centerGlyph, rightGlyph], 100.2, 104, 109.7, 104);
assert.throws(
  () =>
    checkPaint(
      {
        ...sharedSelection,
        rect: { ...sharedSelection.rect, inkClip: undefined },
      },
      [centerGlyph, rightGlyph],
    ),
  /neighbour ink/,
  "Paint audit catches a mask that hides shared neighbour pixels",
);
assert.throws(
  () =>
    checkPaint(
      {
        ...sharedSelection,
        rect: {
          ...sharedSelection.rect,
          inkClip: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0 },
            { x: 0.5, y: 1 },
            { x: 0, y: 1 },
          ],
        },
      },
      [centerGlyph, rightGlyph],
    ),
  /selected-exclusive ink/,
  "Paint audit catches uncovered independent selected strokes",
);

// A neighbour may have separated strokes. A polygon hole preserves its internal
// stroke while a second mask span still covers the selected independent stroke.
const hollowSelected = inkGlyph("약", [
  inkRow(100, 116, [
    { left: 100, right: 108 },
    { left: 109, right: 110 },
  ]),
]);
const internalNeighbour = inkGlyph("화", [
  inkRow(100, 116, [
    { left: 107.95, right: 108.05 },
    { left: 112, right: 120 },
  ]),
]);
for (const reverse of [false, true]) {
  const a = reverse ? 109.7 : 100.2,
    b = reverse ? 100.2 : 109.7;
  const hollowSelection = drag(
    [hollowSelected, internalNeighbour],
    a,
    104,
    b,
    104,
  );
  assert.equal(
    hollowSelection.answer,
    "약",
    "Exact spans permit a safe internal hole",
  );
  assert.ok(hollowSelection.rect.inkClip?.length);
  checkPaint(hollowSelection, [hollowSelected, internalNeighbour]);
  assert.throws(
    () =>
      checkPaint(
        {
          ...hollowSelection,
          rect: { ...hollowSelection.rect, inkClip: undefined },
        },
        [hollowSelected, internalNeighbour],
      ),
    /neighbour ink/,
    "Removing an internal hole must fail the independent paint audit",
  );
  for (const missing of ["selected", "neighbour", "both"]) {
    const withoutSpans = (glyph) => ({
      ...glyph,
      inkRows: glyph.inkRows.map(({ spans: _spans, ...row }) => row),
    });
    const measured = [
      missing === "neighbour" ? centerGlyph : withoutSpans(centerGlyph),
      missing === "selected" ? rightGlyph : withoutSpans(rightGlyph),
    ];
    assert.ok(
      drag(measured, a, 104, b, 104).error,
      `Shared pixels require exact spans on both glyphs (${missing}, reverse=${reverse})`,
    );
  }
  for (const neighbour of [
    inkGlyph("왼", [inkRow(100, 116, [{ left: 95.1, right: 105.1 }])]),
    inkGlyph("오", [inkRow(100, 116, [{ left: 104.9, right: 114.9 }])]),
  ]) {
    assert.ok(
      drag([centerGlyph, neighbour], a, 104, b, 104).error,
      "A neighbour-priority cut beyond the boundary glyph centre must fail",
    );
  }
}
console.log(
  `Shared ink: ${sharedChecks} forward/reverse left/right/both-edge cases and exact internal holes preserve neighbour paint; missing spans and excessive cut-ins are rejected.`,
);

const sharedOnly = (label, left, right, spans) => ({
  page: 1,
  label,
  left: left - 0.1,
  top: 19.9,
  width: right - left + 0.2,
  height: 10.2,
  baseline: 30,
  inkBounds: { left, top: 20, width: right - left, height: 10 },
  inkRows: [{ left, right, top: 20, bottom: 30, spans }],
});
assert.ok(
  drag(
    [
      sharedOnly("이", 40, 50, [
        { left: 40, right: 42 },
        { left: 48, right: 50 },
      ]),
      sharedOnly("왼", 20, 43, [{ left: 20, right: 43 }]),
      sharedOnly("오", 47, 70, [{ left: 47, right: 70 }]),
    ],
    45,
    25,
    45.2,
    25,
  ).error,
  "a hollow blank may not expose every selected stroke shared with two neighbours",
);
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
    (result.rect.leftRatio + result.rect.widthRatio) * page.width <=
      end + (end === 170 ? 0.3 : 1e-8),
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
