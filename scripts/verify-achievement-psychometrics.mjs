import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Synthetic matrices only. No application, credentials, student data, or network.
const load = async (path) => {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
};
const { analyzeAchievementPsychometrics: analyze } = await load(
  "src/lib/achievementPsychometrics.ts",
);
const { buildQuizItemStatistics } = await load("src/lib/quizAnalysis.ts");
const near = (actual, expected, tolerance = 1e-10) =>
  assert.ok(
    typeof actual === "number" && Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );
const input = (
  matrix,
  itemIds = matrix[0]?.map((_, index) => `q${index + 1}`) || [],
) => ({
  itemIds,
  rows: matrix.map((responses, index) => ({
    studentId: `s${index + 1}`,
    responses,
  })),
});
let cases = 0;
const test = (name, callback) => {
  callback();
  cases += 1;
  console.log(`PASS ${name}`);
};
const guttman = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [1, 1, 1],
];

test("hand-calculated mean, sample SD, alpha, SEM, item-rest r and deletion alpha", () => {
  const result = analyze(input(guttman));
  assert.equal(result.sampleSize, 4);
  assert.equal(result.maximumScore, 3);
  assert.equal(result.scoreScale, "correct_item_count");
  near(result.mean, 1.5);
  near(result.standardDeviation, Math.sqrt(5 / 3));
  near(result.alpha, 0.75);
  near(result.sem, Math.sqrt(5 / 12));
  near(result.meanPercent, 50);
  near(result.semPercent, (Math.sqrt(5 / 12) * 100) / 3);
  near(result.items[0].discrimination, 3 / Math.sqrt(33));
  near(result.items[1].discrimination, 1 / Math.sqrt(2));
  near(result.items[0].alphaIfDeleted, 8 / 11);
  near(result.items[1].alphaIfDeleted, 0.5);
  assert.deepEqual(
    result.scoreHistogram,
    [0, 1, 2, 3].map((score) => ({ score, count: 1 })),
  );
});

test("S-P totals, ordering, curves, and ideal response patterns", () => {
  const result = analyze(input(guttman));
  assert.deepEqual(result.spItemOrder, ["q1", "q2", "q3"]);
  assert.deepEqual(result.spItemTotals, [3, 2, 1]);
  assert.deepEqual(
    result.spRows.map((row) => row.studentId),
    ["s4", "s3", "s2", "s1"],
  );
  assert.deepEqual(
    result.spRows.map((row) => row.sCurve),
    [3, 2, 1, 0],
  );
  assert.deepEqual(
    result.spRows.map((row) => row.cautionIndex),
    [null, 0, 0, null],
  );
  assert.equal(result.spRows[0].cautionUnavailableReason, "extreme_score");
});

test("Sato index retains values over one and cannot imply carelessness", () => {
  const result = analyze(
    input([
      [1, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ]),
  );
  const row = result.spRows.find((entry) => entry.studentId === "s4");
  near(row.cautionIndex, 2);
  assert.equal(row.cautionUnavailableReason, null);
  assert.equal("careless" in row, false);
  assert.equal("level" in row, false);
});

test("zero Sato denominator and all-correct/all-wrong totals remain unknown", () => {
  const balanced = analyze(
    input([
      [1, 0],
      [0, 1],
      [1, 0],
      [0, 1],
    ]),
  );
  assert.ok(balanced.spRows.every((row) => row.cautionIndex === null));
  assert.ok(
    balanced.spRows.every(
      (row) => row.cautionUnavailableReason === "zero_caution_denominator",
    ),
  );
  const allCorrect = analyze(
    input([
      [1, 1],
      [1, 1],
      [1, 1],
    ]),
  );
  assert.equal(allCorrect.alpha, null);
  assert.equal(allCorrect.alphaUnavailableReason, "constant_total_score");
  assert.equal(allCorrect.sem, null);
  near(allCorrect.standardDeviation, 0);
});

test("negative alpha is preserved while SEM is withheld", () => {
  const result = analyze(
    input([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 0],
    ]),
  );
  near(result.alpha, -4);
  assert.equal(result.sem, null);
  assert.equal(result.semUnavailableReason, "invalid_alpha");
  assert.ok(result.notices.includes("negative_alpha"));
});

test("D uses actual floor-27-percent denominators", () => {
  const result = analyze(input(guttman));
  assert.equal(result.upperLower.targetCount, 1);
  assert.equal(result.upperLower.actualCount, 1);
  assert.ok(result.items.every((item) => item.upperLower27 === 1));
  assert.ok(
    result.items.every(
      (item) => item.upperCorrectCount === 1 && item.lowerCorrectCount === 0,
    ),
  );
  const eight = analyze(
    input(
      Array.from({ length: 8 }, (_, row) =>
        Array.from({ length: 7 }, (_, column) => Number(column < row)),
      ),
    ),
  );
  assert.equal(eight.upperLower.actualCount, 2);
  near(eight.items[0].upperLower27, 0.5);
  near(eight.items[6].upperLower27, 0.5);
});

test("SEM handles valid zero and one reliability boundaries", () => {
  const zero = analyze(
    input([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]),
  );
  near(zero.alpha, 0);
  near(zero.sem, Math.sqrt(2 / 3));
  const one = analyze(
    input([
      [0, 0, 0],
      [0, 0, 0],
      [1, 1, 1],
      [1, 1, 1],
    ]),
  );
  near(one.alpha, 1);
  near(one.sem, 0);
});

test("D is unavailable at upper or lower group cutoff ties", () => {
  const upper = analyze(
    input([
      [1, 1, 1],
      [1, 1, 1],
      [1, 0, 0],
      [0, 0, 0],
    ]),
  );
  const lower = analyze(
    input([
      [1, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]),
  );
  for (const result of [upper, lower]) {
    assert.equal(result.upperLower.actualCount, 0);
    assert.equal(result.upperLower.unavailableReason, "boundary_ties");
    assert.ok(result.items.every((item) => item.upperLower27 === null));
  }
});

test("three-student product policy and fewer-than-four D sample", () => {
  const two = analyze(
    input([
      [0, 0],
      [1, 1],
    ]),
  );
  assert.equal(two.alpha, null);
  assert.equal(two.items[0].discrimination, null);
  assert.equal(two.alphaUnavailableReason, "insufficient_students");
  const three = analyze(
    input([
      [0, 0],
      [1, 0],
      [1, 1],
    ]),
  );
  near(three.alpha, 2 / 3);
  assert.equal(three.items[0].upperLower27, null);
  assert.equal(three.upperLower.unavailableReason, "insufficient_students");
});

test("single item, constant item, constant rest and deletion edge cases", () => {
  const single = analyze(input([[0], [1], [1]]));
  assert.equal(single.alphaUnavailableReason, "insufficient_items");
  const pair = analyze(
    input([
      [0, 0],
      [1, 0],
      [1, 0],
    ]),
  );
  assert.equal(
    pair.items[0].discriminationUnavailableReason,
    "constant_rest_score",
  );
  assert.equal(pair.items[1].discriminationUnavailableReason, "constant_item");
  assert.equal(
    pair.items[0].alphaIfDeletedUnavailableReason,
    "insufficient_items",
  );
});

test("unknown cells exclude the entire row rather than become wrong answers", () => {
  const result = analyze({
    ...input(guttman),
    rows: [
      ...input(guttman).rows,
      { studentId: "missing", responses: [1, null, 1] },
    ],
  });
  assert.equal(result.sampleSize, 4);
  assert.equal(result.excludedRows.incomplete, 1);
  near(result.alpha, 0.75);
  assert.ok(result.items.every((item) => item.sampleSize === 4));
});

test("malformed, sparse, nonbinary, duplicate rows and duplicate item IDs fail closed", () => {
  const sparse = Array(3);
  sparse[0] = 1;
  const result = analyze({
    itemIds: ["q1", "q2", "q3"],
    rows: [
      ...input(guttman).rows,
      { studentId: "s1", responses: [1, 1, 1] },
      { studentId: "sparse", responses: sparse },
      { studentId: "number", responses: [1, 0.5, 0] },
      { studentId: "short", responses: [1, 0] },
    ],
  });
  assert.equal(result.sampleSize, 3);
  assert.deepEqual(result.excludedRows, {
    incomplete: 0,
    invalid: 3,
    duplicateStudent: 2,
  });
  const duplicateItems = analyze(input([[1, 0]], ["q", "q"]));
  assert.equal(duplicateItems.sampleSize, 0);
  assert.equal(duplicateItems.itemCount, 0);
  assert.ok(duplicateItems.notices.includes("invalid_item_ids"));
});

test("recorded percent or weighted score cannot contaminate binary totals", () => {
  const original = input(guttman);
  const result = analyze({
    ...original,
    rows: original.rows.map((row) => ({ ...row, score: 100 })),
  });
  near(result.mean, 1.5);
  near(result.alpha, 0.75);
});

test("row order and column order do not change statistics or the S-P chart", () => {
  const base = input(guttman);
  const expected = analyze(base);
  const permuted = analyze({
    itemIds: ["q3", "q1", "q2"],
    rows: [...base.rows].reverse().map((row) => ({
      ...row,
      responses: [row.responses[2], row.responses[0], row.responses[1]],
    })),
  });
  near(permuted.alpha, expected.alpha);
  near(permuted.sem, expected.sem);
  assert.deepEqual(permuted.spRows, expected.spRows);
  assert.deepEqual(permuted.spItemOrder, expected.spItemOrder);
  for (const item of expected.items)
    assert.deepEqual(
      permuted.items.find((entry) => entry.id === item.id),
      item,
    );
});

test("empty and degenerate matrices contain no NaN or Infinity", () => {
  const walk = (value) => {
    if (typeof value === "number") assert.ok(Number.isFinite(value));
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object")
      Object.values(value).forEach(walk);
  };
  [
    { rows: [], itemIds: [] },
    { rows: [], itemIds: ["q1", "q2"] },
    input([[0, 0]]),
    input([[1, 1]]),
    input([
      [0, 0],
      [0, 0],
      [0, 0],
    ]),
    input([
      [1, 0],
      [0, 1],
      [1, 0],
      [0, 1],
    ]),
  ].forEach((value) => walk(analyze(value)));
});

test("alpha and item-rest correlations agree with the established quiz analysis engine", () => {
  const data = input(guttman);
  const comparison = buildQuizItemStatistics({
    semesterId: "synthetic-semester",
    students: data.rows.map((row) => ({ uid: row.studentId })),
    questions: data.itemIds.map((id) => ({ id, contentRevision: 1 })),
    records: data.rows.map((row, index) => ({
      id: `record-${index}`,
      source: "canonical",
      studentUid: row.studentId,
      semesterId: "synthetic-semester",
      submittedAt: 100,
      scorePercent: 0,
      totalCount: data.itemIds.length,
      items: row.responses.map((correct, itemIndex) => ({
        questionId: data.itemIds[itemIndex],
        sourceRevision: "1",
        correct: Boolean(correct),
      })),
    })),
  });
  const actual = analyze(data);
  for (const item of actual.items) {
    const cohort = comparison.questions.find((row) => row.id === item.id)
      .cohorts[0];
    assert.ok(cohort);
    near(item.discrimination, cohort.correctedItemTotalCorrelation);
    near(actual.alpha, cohort.alphaReliability);
    near(item.correctRate, cohort.difficultyPercent);
  }
});

console.log(`Verified ${cases} achievement psychometric cases.`);
