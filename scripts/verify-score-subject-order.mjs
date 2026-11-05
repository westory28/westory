import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const loadTs = (path, dependencies = {}) => {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require: (id) => {
      assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
      return dependencies[id];
    },
  });
  return exports;
};

const scores = loadTs("src/lib/studentScores.ts");
const expected = [
  "국어",
  "수학",
  "사회",
  "역사",
  "도덕",
  "과학",
  "영어",
  "기가",
  "체육",
  "음악",
  "미술",
];
const shuffled = [
  "정보",
  "미술",
  "영어",
  "음악",
  "수학",
  "체육",
  "국어",
  "기가",
  "사회",
  "도덕",
  "역사",
  "과학",
];
const rows = scores.buildScoreRows(
  shuffled.map((subject, index) => ({ id: String(index), subject, items: [] })),
  {},
);
assert.deepEqual(
  Array.from(rows, (row) => row.subject),
  [...expected, "정보"],
);
for (const alias of [
  "기술",
  "가정",
  "기술가정",
  "기술·가정",
  "기술ㆍ가정",
  "기술・가정",
  "기술/가정",
  "기술 가정",
  "기가",
]) {
  assert.equal(
    scores.getSubjectPriorityIndex(alias),
    7,
    `${alias} shares the 기가 rank`,
  );
}
assert.ok(
  scores.getSubjectPriorityIndex("정보") >
    scores.getSubjectPriorityIndex("미술"),
);
assert.ok(
  scores.getSubjectPriorityIndex("진로") >
    scores.getSubjectPriorityIndex("미술"),
);

const calculatorComponents = {
  react: React,
  "../../../../lib/studentScores": scores,
  "./CalculatorScoreResult": loadTs(
    "src/pages/student/score/components/CalculatorScoreResult.tsx",
    { react: React },
  ),
};
const ScoreCard = loadTs(
  "src/pages/student/score/components/ScoreCard.tsx",
  calculatorComponents,
).default;
const ScoreOverview = loadTs(
  "src/pages/student/score/components/ScoreOverview.tsx",
  calculatorComponents,
).default;
const cardFor = (row) =>
  renderToStaticMarkup(
    React.createElement(ScoreCard, { row, onScoreChange() {} }),
  );
const overviewFor = (row) =>
  renderToStaticMarkup(
    React.createElement(ScoreOverview, { rows: [row], onSelect() {} }),
  );

const plan = {
  id: "weighted",
  subject: "국어",
  items: [
    { name: "정기시험", maxScore: 100, ratio: 50 },
    { name: "수행 1", maxScore: 20, ratio: 20 },
    { name: "수행 2", maxScore: 30, ratio: 30 },
  ],
};
const rowFor = (values) =>
  scores.buildScoreRows([plan], values, { filterByGrade: false })[0];
assert.equal(
  rowFor({ weighted_0: "80", weighted_1: "15", weighted_2: "24" }).total,
  79,
);
assert.equal(rowFor({}).hasData, false);
assert.equal(rowFor({ weighted_0: "0" }).hasData, true);
assert.equal(
  rowFor({ weighted_0: "not a score", weighted_1: " " }).hasData,
  false,
);
assert.equal(
  rowFor({ weighted_0: "1000", weighted_1: "-1", weighted_2: "30" }).total,
  80,
);
const precise = scores.buildScoreRows(
  [
    {
      id: "precision",
      subject: "수학",
      items: Array.from({ length: 3 }, () => ({ maxScore: 3, ratio: 30 })),
    },
  ],
  { precision_0: "1.334", precision_1: "1.334", precision_2: "1.334" },
  { filterByGrade: false },
)[0];
assert.equal(
  precise.total,
  40,
  "Sum the unrounded contributions before rounding the total",
);
const partial = scores.getCalculatorScoreRow(rowFor({ weighted_0: "80" }));
const partialMarkup = cardFor(partial);
for (const markup of [partialMarkup, overviewFor(partial)]) {
  assert.match(markup, /예상/);
  assert.match(markup, /class="score-calculator__grade">B</);
  assert.match(markup, /class="score-calculator__result-score">80점</);
  assert.match(markup, /반영 40점</);
}
assert.equal((partialMarkup.match(/type="range"/g) || []).length, 3);
assert.equal(
  scores.getCalculatorScoreRow(rowFor({ weighted_0: "0" })).band,
  "E",
);
assert.equal(scores.getCalculatorScoreRow(rowFor({})).band, null);
const invalidPlan = scores.buildScoreRows(
  [{ id: "invalid", subject: "음악", items: [{ maxScore: 100, ratio: 50 }] }],
  { invalid_0: "100" },
)[0];
assert.equal(scores.getCalculatorScoreRow(invalidPlan).band, null);
const partialBoundary = scores.getCalculatorScoreRow(
  scores.buildScoreRows(
    [
      {
        id: "boundary",
        subject: "역사",
        items: [
          { maxScore: 200, ratio: 40 },
          { maxScore: 100, ratio: 60 },
        ],
      },
    ],
    { boundary_0: "179" },
  )[0],
);
assert.equal(partialBoundary.achievementScore, 90);
assert.equal(partialBoundary.band, "A");
for (const name of [
  "Earth Science",
  "Computer Studies",
  "Speech",
  "English Language Arts",
  "Physical Science",
]) {
  assert.equal(scores.getGradeBand(85, name), "B", name);
}
for (const name of [
  "Music",
  "Fine Arts",
  "Art",
  "Arts",
  "P.E.",
  "PE",
  "Physical Education",
]) {
  assert.equal(scores.getGradeBand(85, name), "A", name);
}
for (const subject of ["음악", "미술", "체육", "국어", "영어", "기가"]) {
  const threeLevel = ["음악", "미술", "체육"].includes(subject);
  const boundaries = threeLevel
    ? [
        [59.49, "C"],
        [59.5, "B"],
        [60, "B"],
        [79.49, "B"],
        [79.5, "A"],
        [80, "A"],
        [100, "A"],
      ]
    : [
        [59.49, "E"],
        [59.5, "D"],
        [60, "D"],
        [69.49, "D"],
        [69.5, "C"],
        [70, "C"],
        [79.49, "C"],
        [79.5, "B"],
        [80, "B"],
        [89.49, "B"],
        [89.5, "A"],
        [90, "A"],
        [100, "A"],
      ];
  for (const [score, band] of boundaries) {
    assert.equal(
      scores.getGradeBand(score, subject),
      band,
      `${subject} ${score}`,
    );
    const row = scores.getCalculatorScoreRow(
      scores.buildScoreRows(
        [{ id: subject, subject, items: [{ maxScore: 100, ratio: 100 }] }],
        { [`${subject}_0`]: score },
      )[0],
    );
    for (const markup of [cardFor(row), overviewFor(row)]) {
      assert.ok(
        markup.includes(`class="score-calculator__grade">${band}</`),
        `${subject} ${score} must show ${band}`,
      );
      assert.ok(
        markup.includes(
          `class="score-calculator__result-score">${Math.round(score)}점</`,
        ),
      );
      assert.match(markup, />등급</);
    }
  }
}

const GradeChart = loadTs("src/pages/student/score/components/GradeChart.tsx", {
  react: React,
  "../../../../lib/studentScores": scores,
  "./GradeChart.css": {},
}).default;
const chartMarkup = renderToStaticMarkup(
  React.createElement(GradeChart, { rows }),
);
for (const text of Object.values(scores.SCORE_ACHIEVEMENT_GUIDANCE)) {
  assert.ok(
    chartMarkup.includes(text),
    `Student chart must show achievement guidance: ${text}`,
  );
}
console.log(
  "Score subject order verified: requested order and aliases, unchanged general/arts thresholds and rounding, visible student guidance.",
);
