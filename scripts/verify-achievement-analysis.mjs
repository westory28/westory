import assert from "node:assert/strict";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/lib/achievementAnalysis.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const {
  adaptAchievementAttempts,
  buildAchievementAnalysis,
  buildCumulativeAchievementScores,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
let cases = 0;
const test = (name, run) => {
  run();
  cases++;
  console.log(`ok ${name}`);
};
const semesterId = "2026-2",
  code = "[9역07-01]",
  cutoff = Date.parse("2026-11-06T00:00:00Z");
const students = [{ uid: "s1", name: "합성학생" }];
const metadata = {
  curriculumVersion: "2018-162",
  achievementStandardCodes: [code],
  achievementMappingSource: "manual",
  targetAchievementLevel: "C",
  intendedDifficulty: "medium",
};
const resolveCodes = (value) => ({
  codes: value.achievementStandardCodes || [],
  source: value.achievementMappingSource || "none",
});
const questions = [1, 2].map((id) => ({
  id: `q${id}`,
  ...metadata,
  sourceRevision: "2",
  options: ["정답", "오답"],
  answer: "정답",
  paperOrder: id,
}));
const raw = {
  semesterId,
  studentUid: "s1",
  attemptId: "exam1",
  total: 2,
  percent: 75,
  maxPoints: 4,
  score: 1,
  submittedAtIso: new Date(cutoff + 60000).toISOString(),
  startedAtIso: new Date(cutoff).toISOString(),
  learningSnapshot: questions.map((q) => ({ ...q, familyId: q.id })),
  questionSnapshots: questions.map((q, i) => ({ ...q, points: i ? 1 : 3 })),
  answerChecks: [
    { id: "q1", correct: true },
    { id: "q2", correct: false },
  ],
  answers: { q1: "정답", q2: "오답" },
};
const scoreRow = (round = 1, score = 75, overrides = {}) => ({
  id: `score-${round}`,
  source: "canonical",
  raw: {
    ...raw,
    category: "exam_prep",
    examRound: `round_${round}`,
    attemptId: `attempt-${round}`,
    percent: score,
    cutScoreQuestions: questions.map((q, i) => ({ ...q, points: i ? 1 : 3 })),
    ...overrides,
  },
});
const adapt = (rawRows = [{ id: "exam1", source: "canonical", raw }]) =>
  adaptAchievementAttempts({
    semesterId,
    students,
    questions,
    rawRows,
    resolveCodes,
  });
const run = (extra = {}) =>
  buildAchievementAnalysis({
    semesterId,
    students,
    questions,
    attempts: adapt(),
    resolveCodes,
    examRound: "round_1",
    scoreRows: [scoreRow()],
    ...extra,
  });
const cumulative = (scoreRows, examRound = "round_3", extra = {}) =>
  buildCumulativeAchievementScores({
    semesterId,
    students,
    examRound,
    scoreRows,
    ...extra,
  });
test("weighted standard rate uses frozen 3+1 points", () => {
  const value = run();
  assert.equal(value.standards[0].weighted.percent, 75);
  assert.equal(value.standards[0].actual.percent, 50);
});
test("one round classifies by its frozen paper, not fixed 90/80/70/60 cuts", () => {
  const row = cumulative([scoreRow()], "round_1")[0];
  assert.equal(row.scorePercent, 75);
  assert.equal(row.level, "C");
  assert.equal(row.rounds.length, 1);
  assert.deepEqual(row.missingRounds, []);
  assert.equal(row.provisional, false);
});
test("round two and three use equal round weighting and exclude future rounds", () => {
  const records = [scoreRow(1, 90), scoreRow(2, 60), scoreRow(3, 30)];
  assert.equal(cumulative(records, "round_1")[0].scorePercent, 90);
  assert.equal(cumulative(records, "round_2")[0].scorePercent, 75);
  assert.equal(cumulative(records)[0].scorePercent, 60);
  assert.equal(cumulative(records)[0].rounds.length, 3);
});
test("frozen paper-specific cut scores are accumulated with each score", () => {
  const first = scoreRow(1, 70);
  const second = scoreRow(2, 60, {
    maxPoints: 40,
    cutScoreQuestions: questions.map((q) => ({
      ...q,
      points: 20,
      targetAchievementLevel: "A",
    })),
  });
  const one = cumulative([first], "round_1")[0];
  const twoOnly = cumulative([second], "round_2")[0];
  const both = cumulative([first, second], "round_2")[0];
  assert.equal(both.scorePercent, 65);
  for (const value of ["A", "B", "C", "D"]) {
    assert.ok(
      Math.abs(
        both.cutScores[value] -
          (one.cutScores[value] + twoOnly.cutScores[value]) / 2,
      ) < 1e-10,
    );
  }
  assert.notEqual(one.cutScores.A, twoOnly.cutScores.A);
});
test("a historically unweighted score uses equal-weight paper cuts", () => {
  const cutScoreQuestions = [
    { ...questions[0], points: 1, targetAchievementLevel: "E" },
    { ...questions[1], points: 9, targetAchievementLevel: "A" },
  ];
  const sameWeight = cumulative(
    [scoreRow(1, 70, { maxPoints: undefined, cutScoreQuestions })],
    "round_1",
  )[0];
  const explicitSameWeight = cumulative(
    [
      scoreRow(1, 70, {
        maxPoints: 2,
        cutScoreQuestions: cutScoreQuestions.map((q) => ({ ...q, points: 1 })),
      }),
    ],
    "round_1",
  )[0];
  assert.deepEqual(sameWeight.cutScores, explicitSameWeight.cutScores);
  assert.equal(sameWeight.rounds[0].weighted, false);
});
test("paper difficulty changes the level for the same earned percentage", () => {
  const easy = cumulative(
    [
      scoreRow(1, 75, {
        cutScoreQuestions: questions.map((q, i) => ({
          ...q,
          points: i ? 1 : 3,
          targetAchievementLevel: "E",
        })),
      }),
    ],
    "round_1",
  )[0];
  const hard = cumulative(
    [
      scoreRow(1, 75, {
        cutScoreQuestions: questions.map((q, i) => ({
          ...q,
          points: i ? 1 : 3,
          targetAchievementLevel: "A",
        })),
      }),
    ],
    "round_1",
  )[0];
  assert.equal(hard.level, "A");
  assert.equal(easy.level, "E");
});
test("exact paper boundaries classify inclusively and below D is E", () => {
  const initial = cumulative([scoreRow()], "round_1")[0];
  for (const value of ["A", "B", "C", "D"]) {
    assert.equal(
      cumulative([scoreRow(1, initial.cutScores[value])], "round_1")[0].level,
      value,
    );
  }
  assert.equal(cumulative([scoreRow(1, 0)], "round_1")[0].level, "E");
  assert.equal(cumulative([], "round_1")[0].level, null);
});
test("later retries never replace the first valid round submission", () => {
  const retry = scoreRow(1, 100, {
    attemptId: "retry",
    submittedAtIso: new Date(cutoff + 120000).toISOString(),
  });
  retry.id = "retry";
  const row = cumulative([retry, scoreRow(1, 30)], "round_1")[0];
  assert.equal(row.scorePercent, 30);
  assert.equal(row.rounds.length, 1);
});
test("canonical and legacy aliases are deduplicated before round selection", () => {
  const original = scoreRow();
  const legacy = {
    id: "legacy",
    source: "legacy",
    raw: { ...original.raw, score: 100, canonicalAttemptId: "attempt-1" },
  };
  const row = cumulative([legacy, original], "round_1")[0];
  assert.equal(row.scorePercent, 75);
  assert.equal(row.rounds.length, 1);
});
test("missing rounds are never imputed as zero and other students stay unknown", () => {
  const [row, absent] = cumulative([scoreRow(1, 80)], "round_3", {
    students: [...students, { uid: "absent" }],
  });
  assert.equal(row.scorePercent, 80);
  assert.equal(row.level, "C");
  assert.deepEqual(row.missingRounds, ["round_2", "round_3"]);
  assert.equal(row.provisional, true);
  assert.equal(absent.scorePercent, null);
  assert.equal(absent.level, null);
});
test("foreign semesters, students, categories, malformed rounds and missing scores are excluded", () => {
  const variants = [
    { semesterId: "2025-2" },
    { studentUid: "outsider" },
    { category: "formative" },
    { examRound: "round_0" },
    { category: "exam_prep__round_2", examRound: "round_1" },
    { percent: undefined },
    { percent: NaN },
    { percent: -1 },
    { percent: 101 },
    { submittedAtIso: "invalid", timestamp: undefined, createdAt: undefined },
  ];
  for (const change of variants)
    assert.equal(
      cumulative([scoreRow(1, 80, change)], "round_1")[0].level,
      null,
    );
});
test("legacy encoded round uses its percentage score", () => {
  const row = scoreRow(2, 0, {
    category: "exam_prep__round_2",
    examRound: undefined,
    score: 75,
  });
  row.source = "legacy";
  assert.equal(cumulative([row], "round_2")[0].scorePercent, 75);
});
test("missing or inconsistent frozen paper data leaves a score unclassified", () => {
  for (const change of [
    { cutScoreQuestions: [] },
    { total: 3 },
    { maxPoints: 99 },
    { cutScoreQuestions: [questions[0], questions[0]] },
    { cutScoreQuestions: questions.map((q) => ({ ...q, points: undefined })) },
  ]) {
    const row = cumulative([scoreRow(1, 100, change)], "round_1")[0];
    assert.equal(row.scorePercent, 100);
    assert.equal(row.level, null);
    assert.equal(row.excludedRoundCount, 1);
  }
});
test("missing original paper cannot be replaced by a later retry paper", () => {
  const first = scoreRow(1, 30, { cutScoreQuestions: [] });
  const retry = scoreRow(1, 100, {
    attemptId: "retry",
    submittedAtIso: new Date(cutoff + 120000).toISOString(),
  });
  retry.id = "retry";
  const row = cumulative([first, retry], "round_1")[0];
  assert.equal(row.scorePercent, 30);
  assert.equal(row.level, null);
});
test("ambiguous equal-time first submissions are excluded", () => {
  const tied = scoreRow(1, 100, { attemptId: "tied" });
  tied.id = "tied";
  const row = cumulative([scoreRow(), tied], "round_1")[0];
  assert.equal(row.level, null);
  assert.equal(row.excludedRoundCount, 1);
});
test("cumulative levels consistently drive cohorts and option distributions", () => {
  const value = run();
  assert.equal(value.levelCohorts.find((row) => row.level === "C").count, 1);
  assert.equal(
    value.forms[0].items[0].levelChoices.find((row) => row.level === "C")
      .choices[0],
    1,
  );
  assert.equal(value.students[0].achievement.level, "C");
  assert.equal(value.cumulativeScores[0].level, "C");
});
test("old revision never borrows new metadata or choices", () => {
  const old = {
    ...raw,
    learningSnapshot: [
      { id: "q1", sourceRevision: "1" },
      { id: "q2", sourceRevision: "1" },
    ],
    questionSnapshots: [],
  };
  const attempts = adapt([{ id: "exam1", source: "canonical", raw: old }]);
  assert.deepEqual(attempts[0].items[0].codes, []);
  assert.equal(attempts[0].items[0].options, null);
});
test("missing canonical percent is not converted from correct-item count", () =>
  assert.equal(
    adapt([
      { id: "exam1", source: "canonical", raw: { ...raw, percent: undefined } },
    ])[0].scorePercent,
    null,
  ));
test("duplicate item outcomes cannot inflate aggregate denominators", () => {
  const attempts = adapt([
    {
      id: "exam1",
      source: "canonical",
      raw: {
        ...raw,
        total: 3,
        answerChecks: [...raw.answerChecks, { id: "q1", correct: true }],
      },
    },
  ]);
  assert.equal(attempts[0].complete, false);
  assert.equal(attempts[0].items[0].correct, null);
});
test("missing answers remain unknown rather than non-answer", () => {
  const attempts = adapt([
    { id: "exam1", source: "canonical", raw: { ...raw, answers: undefined } },
  ]);
  assert.equal(attempts[0].items[0].answer, null);
});
test("different forms retain each student's first submission per form", () => {
  const first = adapt()[0],
    second = {
      ...first,
      id: "exam2",
      attemptId: "exam2",
      submittedAt: first.submittedAt + 1000,
      items: first.items.map((item) => ({ ...item, sourceRevision: "3" })),
    };
  const value = run({ attempts: [first, second] });
  assert.equal(value.attempts.length, 1);
  assert.equal(value.forms.length, 2);
});
test("analysis does not mutate immutable results", () => {
  const rows = [scoreRow()];
  const before = JSON.stringify(rows);
  cumulative(rows, "round_1");
  assert.equal(JSON.stringify(rows), before);
});
console.log(`Achievement analysis verified: ${cases} synthetic cases.`);
