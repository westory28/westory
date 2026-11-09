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
const { boundaryProbability, buildEstimatedCutScores } = module.exports;
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

const before = JSON.stringify(questions);
buildEstimatedCutScores(questions);
assert.equal(JSON.stringify(questions), before);
console.log(
  "PASS estimated paper cuts: 65% anchors, monotonic model, point weighting, missing-point fallback, empty paper and no mutation",
);
