import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";

const bundle = await build({
  entryPoints: ["src/lib/achievementEstimates.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module,
  exports: module.exports,
});
const {
  boundaryProbability,
  buildEstimatedCutScores,
  buildCurrentAchievementEstimates,
} = module.exports;
const levels = ["A", "B", "C", "D", "E"];
levels.forEach((level, index) =>
  assert.ok(Math.abs(boundaryProbability(4 - index, level) - 0.65) < 1e-12),
);
for (const target of levels)
  for (let ability = -2; ability < 6; ability += 0.1)
    assert.ok(
      boundaryProbability(ability, target) <
        boundaryProbability(ability + 0.1, target),
    );

const questions = [
  {
    id: "q1",
    points: 2,
    intendedDifficulty: "easy",
    targetAchievementLevel: "D",
    achievementStandardCodes: ["standard-1"],
  },
  {
    id: "q2",
    points: 8,
    intendedDifficulty: "hard",
    targetAchievementLevel: "A",
    achievementStandardCodes: ["standard-1"],
  },
];
const cuts = buildEstimatedCutScores(questions);
assert.equal(cuts.totalPoints, 10);
cuts.cuts.forEach((cut, index) => {
  const expected =
    2 * boundaryProbability(4 - index, "D") +
    8 * boundaryProbability(4 - index, "A");
  assert.ok(Math.abs(cut.score - expected) < 1e-12);
  assert.ok(Math.abs(cut.percent - expected * 10) < 1e-12);
  if (index) assert.ok(cuts.cuts[index - 1].score > cut.score);
});
const mixed = buildEstimatedCutScores([
  { ...questions[0], points: undefined },
  questions[1],
]);
assert.equal(mixed.totalPoints, null);
assert.equal(mixed.weighted, false);
assert.equal(mixed.cuts[0].score, null);
assert.ok(
  Math.abs(
    mixed.cuts[0].percent -
      (boundaryProbability(4, "D") + boundaryProbability(4, "A")) * 50,
  ) < 1e-12,
);
const defaults = buildEstimatedCutScores([
  { id: 1, intendedDifficulty: "easy", points: 3 },
  { id: 2, points: 4 },
]);
assert.equal(defaults.assumedTargets, 2);
assert.equal(
  defaults.rows.find((row) => row.difficulty === "unassigned").questionCount,
  1,
);
assert.ok(
  buildEstimatedCutScores([]).cuts.every(
    (cut) => cut.percent === null && cut.score === null,
  ),
);

const makeObservation = (index, overrides = {}) => ({
  id: `result-${index}`,
  studentUid: "a",
  semesterId: "2026-2",
  source: "diagnostic",
  itemId: `item-${index}`,
  familyId: `family-${index}`,
  observedAt: "2026-11-01T00:00:00Z",
  correct: index % 3 !== 0,
  filled: true,
  hintViewed: false,
  quality: "complete",
  targetAchievementLevel: "C",
  achievementStandardCodes: ["standard-1"],
  ...overrides,
});
const input = (observations) => ({
  semesterId: "2026-2",
  students: [{ uid: "a" }, { uid: "b" }],
  questions,
  evidence: { version: 1, status: "ready", observations },
  asOf: "2026-11-08T00:00:00Z",
  resolveCodes: (value) => ({
    codes: value.achievementStandardCodes || [],
    source: "manual",
  }),
});
const report = buildCurrentAchievementEstimates(
  input(Array.from({ length: 12 }, (_, i) => makeObservation(i))),
);
assert.ok(levels.includes(report.standards[0].students[0].level));
assert.equal(report.standards[0].students[0].evidenceCount, 12);
assert.equal(report.standards[0].students[0].correctCount, 8);
assert.equal(
  report.standards[0].students[1].level,
  null,
  "No answer evidence must never fabricate a pupil level",
);
assert.equal(report.standards[0].unknownCount, 1);
assert.equal(
  Object.values(report.standards[0].counts).reduce((a, b) => a + b, 0),
  1,
);
assert.ok(report.standards[0].students[0].possibleLevels.length);

const excluded = [
  makeObservation(10, { source: "worksheet" }),
  makeObservation(11, { source: "exam_prep" }),
  makeObservation(12, { studentUid: "outsider" }),
  makeObservation(13, { semesterId: "2025-2" }),
  makeObservation(14, { observedAt: "2026-12-01T00:00:00Z" }),
  makeObservation(15, { observedAt: null }),
  makeObservation(16, { correct: null }),
  makeObservation(17, { hintViewed: true }),
];
const sparse = buildCurrentAchievementEstimates(
  input([makeObservation(0), makeObservation(1), ...excluded]),
);
assert.equal(sparse.excludedCount, excluded.length);
assert.equal(sparse.standards[0].students[0].evidenceCount, 2);
assert.equal(sparse.standards[0].students[0].level, null);
const retries = buildCurrentAchievementEstimates(
  input([
    makeObservation(0),
    makeObservation(1),
    ...Array.from({ length: 20 }, (_, i) =>
      makeObservation(i + 2, {
        familyId: "family-0",
        observedAt: "2026-11-02T00:00:00Z",
        correct: true,
      }),
    ),
  ]),
);
assert.equal(
  retries.standards[0].students[0].evidenceCount,
  2,
  "Retries never multiply independent evidence",
);
const hintedFirst = buildCurrentAchievementEstimates(
  input([
    makeObservation(0, { hintViewed: true }),
    makeObservation(1),
    makeObservation(2),
    makeObservation(3, {
      familyId: "family-0",
      observedAt: "2026-11-02T00:00:00Z",
      correct: true,
    }),
  ]),
);
assert.equal(
  hintedFirst.standards[0].students[0].evidenceCount,
  2,
  "An unhinted retry cannot replace a hinted first response",
);
assert.equal(hintedFirst.standards[0].students[0].level, null);
assert.equal(hintedFirst.excludedCount, 1);
const tied = buildCurrentAchievementEstimates(
  input([
    makeObservation(0),
    makeObservation(1),
    makeObservation(2),
    makeObservation(20, { familyId: "family-2" }),
  ]),
);
assert.equal(
  tied.standards[0].students[0].evidenceCount,
  2,
  "Ambiguous equal-time first responses are excluded",
);
const provisional = buildCurrentAchievementEstimates(
  input(
    Array.from({ length: 5 }, (_, i) =>
      makeObservation(i, { hintViewed: null }),
    ),
  ),
);
assert.equal(provisional.standards[0].students[0].provisional, true);
const easy = buildCurrentAchievementEstimates(
  input(
    Array.from({ length: 12 }, (_, i) =>
      makeObservation(i, { targetAchievementLevel: "E" }),
    ),
  ),
);
const hard = buildCurrentAchievementEstimates(
  input(
    Array.from({ length: 12 }, (_, i) =>
      makeObservation(i, { targetAchievementLevel: "A" }),
    ),
  ),
);
assert.ok(
  levels.indexOf(hard.standards[0].students[0].level) <
    levels.indexOf(easy.standards[0].students[0].level),
  "Difficulty matters; raw success rate is not blindly converted to A–E",
);
const before = JSON.stringify(questions);
buildEstimatedCutScores(questions);
assert.equal(JSON.stringify(questions), before);
console.log(
  "PASS achievement estimates: 65% anchors, monotonic model, point weighting, missing-point fallback, empty evidence, scoped diagnostic/formative-only inference, retries/ties, uncertainty and no mutation",
);
