import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const url = (text) =>
  `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const psych = url(compile("src/lib/achievementPsychometrics.ts"));
const model = compile("src/lib/achievementAnalysis.ts").replace(
  '"./achievementPsychometrics"',
  JSON.stringify(psych),
);
const {
  adaptAchievementAttempts,
  buildAchievementAnalysis,
  confirmedAchievementLevel,
} = await import(url(model));
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
const prior = (id, extra = {}) => ({
  id,
  resultId: id,
  questionId: id,
  studentUid: "s1",
  semesterId,
  source: "formative",
  itemId: id,
  familyId: id,
  sourceRevision: "1",
  observedAt: cutoff - 10000,
  correct: true,
  filled: true,
  hintViewed: false,
  quality: "complete",
  recordSource: "canonical",
  ...metadata,
  ...extra,
});
const baseEvidence = {
  version: 1,
  status: "ready",
  examCutoffs: [
    {
      studentUid: "s1",
      resultId: "exam1",
      attemptId: "exam1",
      startedAt: new Date(cutoff).toISOString(),
    },
  ],
  observations: [prior("p1"), prior("p2"), prior("p3", { correct: false })],
};
const adapt = (
  rawRows = [{ id: "exam1", source: "canonical", raw }],
  evidence = baseEvidence,
) =>
  adaptAchievementAttempts({
    semesterId,
    students,
    questions,
    rawRows,
    evidence,
    resolveCodes,
  });
const run = (evidence = baseEvidence, extra = {}) =>
  buildAchievementAnalysis({
    semesterId,
    students,
    questions,
    attempts: adapt(undefined, evidence),
    evidence,
    resolveCodes,
    ...extra,
  });
test("weighted standard rate uses frozen 3+1 points", () => {
  const value = run();
  assert.equal(value.standards[0].weighted.percent, 75);
  assert.equal(value.standards[0].actual.percent, 50);
});
test("expected baseline and paired actual have explicit denominators", () => {
  const cell = run().cells[0];
  assert.ok(Math.abs(cell.expectedPercent - 200 / 3) < 1e-9);
  assert.equal(cell.pairedActual.percent, 50);
  assert.equal(cell.pairedStudentCount, 1);
});
test("completion never changes achievement or generates A-E", () => {
  const value = run({
    ...baseEvidence,
    observations: [
      ...baseEvidence.observations,
      prior("w1", { source: "worksheet", filled: false, correct: false }),
      prior("w2", { source: "worksheet", correct: true }),
    ],
  });
  assert.deepEqual(value.standards[0].worksheet, {
    recorded: 2,
    filled: 1,
    gradedFilled: 1,
    correct: 1,
  });
  assert.equal(value.cells[0].expectedPercent, run().cells[0].expectedPercent);
  assert.equal(
    value.levelCohorts.find((r) => r.level === "unclassified").count,
    1,
  );
});
test("future evidence is excluded", () => {
  const value = run({
    ...baseEvidence,
    observations: [
      ...baseEvidence.observations.slice(0, 2),
      prior("future", { observedAt: cutoff }),
    ],
  });
  assert.equal(value.cells[0].expectedPercent, null);
  assert.equal(value.futureEvidenceCount, 1);
});
test("same family and unknown help cannot establish baseline", () => {
  for (const extra of [
    { familyId: "q1" },
    { hintViewed: null },
    { hintViewed: true },
    { quality: "limited" },
  ]) {
    const value = run({
      ...baseEvidence,
      observations: [prior("a", extra), prior("b"), prior("c")],
    });
    if (extra.familyId) assert.equal(value.cells[0].pairedActual.total, 1);
    else assert.equal(value.cells[0].expectedPercent, null);
  }
});
test("first wrong exposure is not replaced by later correct retry", () => {
  const value = run({
    ...baseEvidence,
    observations: [
      prior("p1", { correct: false }),
      prior("p1retry", {
        itemId: "p1",
        familyId: "p1",
        observedAt: cutoff - 1000,
      }),
      prior("p2"),
      prior("p3"),
    ],
  });
  assert.ok(Math.abs(value.cells[0].expectedPercent - 200 / 3) < 1e-9);
  assert.equal(value.standards[0].formative.correct, 3);
});
test("cutoff must be authorized; raw timestamps cannot restore rejected cutoff", () => {
  const value = run({ ...baseEvidence, examCutoffs: [] });
  assert.equal(value.missingCutoffCount, 1);
  assert.equal(value.cells[0].expectedPercent, null);
  assert.equal(value.standards[0].formative.total, 0);
});
test("review after exam is valid only for pre-exam evidence asOf", () => {
  const profile = {
    studentUid: "s1",
    standardCode: code,
    curriculumVersion: "2018-162",
    level: "B",
    asOf: cutoff,
    reviewedAt: cutoff + 999999,
    examAttemptId: "exam1",
  };
  assert.equal(
    confirmedAchievementLevel([profile], "s1", [code], cutoff, "exam1"),
    "B",
  );
  assert.equal(
    confirmedAchievementLevel(
      [{ ...profile, asOf: cutoff + 1 }],
      "s1",
      [code],
      cutoff,
      "exam1",
    ),
    "unclassified",
  );
  assert.equal(
    confirmedAchievementLevel(
      [{ ...profile, stale: true }],
      "s1",
      [code],
      cutoff,
      "exam1",
    ),
    "unclassified",
  );
});
test("confirmed levels drive option distributions without score thresholds", () => {
  const profiles = [
    {
      studentUid: "s1",
      standardCode: code,
      curriculumVersion: "2018-162",
      level: "E",
      asOf: cutoff,
      reviewedAt: cutoff + 999,
      examAttemptId: "exam1",
    },
  ];
  const value = run(baseEvidence, {
    reviewedProfiles: profiles,
    standardCode: code,
  });
  assert.equal(value.levelCohorts.find((row) => row.level === "E").count, 1);
  assert.equal(
    value.forms[0].items[0].levelChoices.find((row) => row.level === "E")
      .choices[0],
    1,
  );
});
test("overall level is never synthesized from standard profiles", () => {
  const value = run(baseEvidence, {
    reviewedProfiles: [
      {
        studentUid: "s1",
        standardCode: code,
        curriculumVersion: "2018-162",
        level: "A",
        asOf: cutoff,
        reviewedAt: cutoff + 1,
      },
    ],
  });
  assert.equal(value.levelCohorts.find((row) => row.level === "A").count, 0);
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
test("all-negative point outcomes and absent evidence are not zero mastery", () => {
  const value = run({ ...baseEvidence, observations: [] });
  assert.equal(value.standards[0].formative.percent, null);
  assert.equal(value.cells[0].expectedPercent, null);
});
test("different semesters are excluded", () => {
  const value = run({
    ...baseEvidence,
    observations: baseEvidence.observations.map((row) => ({
      ...row,
      semesterId: "2025-2",
    })),
  });
  assert.equal(value.standards[0].formative.total, 0);
});
test("same item with changed family is not independent evidence", () => {
  const evidence = {
    ...baseEvidence,
    observations: [
      prior("oldq", { itemId: "q1", familyId: "changed-family" }),
      prior("p2"),
      prior("p3"),
    ],
  };
  const value = run(evidence);
  assert.equal(value.cells[0].pairedActual.total, 1);
});
test("revisions or changed families cannot count one prior item twice", () => {
  const value = run({
    ...baseEvidence,
    observations: [
      prior("a", {
        itemId: "same",
        familyId: "old",
        observedAt: cutoff - 20000,
      }),
      prior("b", { itemId: "same", familyId: "new" }),
      prior("p3"),
    ],
  });
  assert.equal(value.cells[0].expectedPercent, null);
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
  const value = run(baseEvidence, { attempts: [first, second] });
  assert.equal(value.attempts.length, 1);
  assert.equal(value.forms.length, 2);
});
console.log(`Achievement analysis verified: ${cases} synthetic cases.`);
