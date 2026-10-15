import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const moduleExports = (path, dependencies = {}) => {
  const exports = {};
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  vm.runInNewContext(
    source,
    {
      exports,
      Date,
      require: (name) => {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        throw new Error(`Unexpected dependency ${name}`);
      },
    },
    { filename: path },
  );
  return exports;
};
const database = new Map();
let queries = [],
  failedPath = "";
const firestore = {
  collection: (_db, path) => ({ path }),
  where: (field, operator, value) => ({ field, operator, value }),
  query: (source, ...filters) => ({ ...source, filters }),
  getDocs: async (request) => {
    queries.push(request);
    if (request.path === failedPath) throw new Error("Synthetic read failure");
    return {
      docs: (database.get(request.path) || []).map((row) => ({
        id: row.id,
        data: () => row.data,
      })),
    };
  },
};
const analysis = moduleExports("src/lib/quizAnalysis.ts");
const rounds = moduleExports("src/lib/mockExamRounds.ts");
const {
  compareQuizScores: compare,
  loadQuizScoreComparison: load,
  formatQuizScoreComparison: format,
} = moduleExports("src/lib/quizScoreComparison.ts", {
  "firebase/firestore": firestore,
  "./firebase": { db: {} },
  "./semesterScope": {
    getYearSemester: (config) => ({
      year: config?.year || "2026",
      semester: config?.semester || "1",
    }),
    getSemesterCollectionPath: (config, name) =>
      `years/${config.year}/semesters/${config.semester}/${name}`,
  },
  "./mockExamRounds": rounds,
  "./quizAnalysis": analysis,
});
const request = {
  studentUid: "student-a",
  semesterId: "2026-2",
  definitionId: "quiz:2026-2:unit-a:diagnostic",
  currentAttemptId: "current",
  currentScorePercent: 80,
};
const canonical = (id, percent, submittedAtIso, changes = {}) => ({
  id,
  source: "canonical",
  data: {
    assessmentKind: "QUIZ",
    studentUid: "student-a",
    semesterId: "2026-2",
    definitionId: request.definitionId,
    sourceId: "unit-a",
    category: "diagnostic",
    attemptId: id,
    resultId: id,
    submissionRef: `semester_assessment_submissions/${id}`,
    percent,
    score: 1,
    total: 2,
    submittedAtIso,
    sourceHash: "a".repeat(64),
    answerChecks: [
      { id: "q1", correct: true },
      { id: "q2", correct: false },
    ],
    learningSnapshot: [
      { id: "q1", sourceRevision: "2" },
      { id: "q2", sourceRevision: "1" },
    ],
    ...changes,
  },
});
const legacy = (id, score, timestamp, changes = {}) => ({
  id,
  source: "legacy",
  data: {
    uid: "student-a",
    unitId: "unit-a",
    category: "diagnostic",
    score,
    timestamp,
    details: [
      { id: "q1", correct: true, sourceRevision: "2" },
      { id: "q2", correct: false, sourceRevision: "1" },
    ],
    ...changes,
  },
});
const current = canonical("current", 80, "2026-10-15T02:00:00Z");
const old = canonical("old", 20, "2026-10-15T01:00:00Z");
const run = (records, override = {}) =>
  compare({ ...request, records, ...override });
let count = 0;
const test = async (name, fn) => {
  await fn();
  count += 1;
  console.log(`PASS ${name}`);
};

await test("Only the immediately previous real score is compared", () => {
  const result = run([
    canonical("best", 100, "2026-10-14T01:00:00Z"),
    current,
    old,
  ]);
  assert.equal(result.previousScore, 20);
  assert.equal(result.currentScore, 80);
  assert.equal(result.delta, 60);
  assert.equal(result.direction, "up");
  assert.equal(result.previousAttemptId, "old");
  assert.equal(format(result), "이전보다 60점 올랐어요");
});

await test("Zero is a score; decline and equal results remain factual", () => {
  assert.equal(
    run([canonical("old", 0, old.data.submittedAtIso), current]).delta,
    80,
  );
  const decline = run(
    [old, canonical("current", 0, current.data.submittedAtIso)],
    { currentScorePercent: 0 },
  );
  assert.equal(decline.delta, -20);
  assert.equal(format(decline), "이전보다 20점 내려갔어요");
  const same = run([canonical("old", 80, old.data.submittedAtIso), current]);
  assert.equal(same.direction, "same");
  assert.equal(format(same), "이전 점수와 같아요");
  assert.equal(
    run([canonical("old", 79.9, old.data.submittedAtIso), current]).delta,
    0.1,
  );
});

await test("Missing, malformed and mismatched current scores do not compare", () => {
  for (const value of [undefined, null, "80", NaN, Infinity, -1, 101]) {
    assert.equal(
      run([old, canonical("current", value, current.data.submittedAtIso)]),
      null,
    );
    assert.equal(
      run([canonical("old", value, old.data.submittedAtIso), current]),
      null,
    );
  }
  assert.equal(run([old, current], { currentScorePercent: 70 }), null);
  assert.equal(run([old]), null);
  assert.equal(run([current]), null);
});

await test("Current attempt and its explicitly linked mirrors never compare to themselves", () => {
  const mirror = legacy(
    "legacy-current",
    80,
    { seconds: 1 },
    { canonicalAttemptId: "current" },
  );
  assert.equal(run([current, mirror]), null);
  const result = run([old, current, mirror, current, { ...old }]);
  assert.equal(result.previousAttemptId, "old");
  assert.equal(result.delta, 60);
  assert.equal(run([current, legacy("current", 80, { seconds: 1 })]), null);
});

await test("Ref-linked canonical copies win without score/date identity guesses", () => {
  const mirror = legacy(
    "legacy-old",
    100,
    { seconds: 1 },
    { resultRef: "semester_assessment_results/old" },
  );
  assert.equal(run([current, old, mirror]).previousScore, 20);
  const independent = canonical(
    "different-attempt",
    20,
    old.data.submittedAtIso,
  );
  assert.equal(run([current, old, independent]), null);
});

await test("Student, semester, unit, category and mock round cannot mix", () => {
  const invalid = [
    { studentUid: "other" },
    { uid: "other" },
    { semesterId: "2025-2" },
    { definitionId: "quiz:2026-2:unit-b:diagnostic", sourceId: "unit-b" },
    { definitionId: "quiz:2026-2:unit-a:formative", category: "formative" },
    {
      definitionId: "quiz:2026-2:exam_prep:exam_prep:round_1",
      sourceId: "exam_prep",
      category: "exam_prep",
      examRound: "round_1",
    },
    { sourceId: "unit-b" },
    { assessmentKind: "HISTORY_CLASSROOM" },
  ];
  for (const change of invalid)
    assert.equal(
      run([canonical("other", 20, old.data.submittedAtIso, change), current]),
      null,
    );
  assert.equal(
    run([
      legacy("past", 20, { seconds: 1 }, { year: 2025, semester: 2 }),
      current,
    ]),
    null,
  );
  const mockRequest = {
    ...request,
    definitionId: "quiz:2026-2:exam_prep:exam_prep:round_2",
  };
  const mockCurrent = canonical("current", 80, current.data.submittedAtIso, {
    definitionId: mockRequest.definitionId,
    sourceId: "exam_prep",
    category: "exam_prep",
    examRound: "round_2",
  });
  assert.equal(
    run(
      [
        legacy(
          "wrong-round",
          0,
          { seconds: 1 },
          { unitId: "exam_prep", category: "exam_prep__round_1" },
        ),
        mockCurrent,
      ],
      mockRequest,
    ),
    null,
  );
  assert.equal(
    run(
      [
        legacy(
          "same-round",
          0,
          { seconds: 1 },
          { unitId: "exam_prep", category: "exam_prep__round_2" },
        ),
        mockCurrent,
      ],
      mockRequest,
    ).delta,
    80,
  );
});

await test("Unfinished or cancelled records are not previous completed results", () => {
  for (const status of [
    "STARTED",
    "IN_PROGRESS",
    "RECOVERABLE",
    "LOCKED",
    "EXPIRED",
    "cancelled",
  ]) {
    assert.equal(
      run([canonical("old", 20, old.data.submittedAtIso, { status }), current]),
      null,
    );
    assert.equal(
      run([
        old,
        canonical("current", 80, current.data.submittedAtIso, { status }),
      ]),
      null,
    );
  }
  assert.equal(
    run([
      legacy("timeout", 0, { seconds: 1 }, { status: "timed_out" }),
      current,
    ]).previousScore,
    0,
  );
});

await test("Unknown or tied dates never manufacture a previous record", () => {
  assert.equal(run([old, canonical("undated", 50, undefined), current]), null);
  assert.equal(run([old, canonical("current", 80, undefined)]), null);
  assert.equal(
    run([canonical("tie", 50, current.data.submittedAtIso), old, current]),
    null,
  );
  assert.equal(run([canonical("invalid-date", 50, "invalid"), current]), null);
  const future = canonical("future", 100, "2026-10-16T02:00:00Z");
  assert.equal(run([future, old, current]).previousAttemptId, "old");
});

await test("Changed source version stops comparison instead of jumping to older compatible scores", () => {
  const changed = canonical("recent-changed", 0, "2026-10-15T01:30:00Z", {
    sourceHash: "b".repeat(64),
  });
  assert.equal(run([old, changed, current]), null);
  assert.equal(
    run([
      old,
      canonical("current", 80, current.data.submittedAtIso, {
        sourceHash: "b".repeat(64),
      }),
    ]),
    null,
  );
});

await test("Source-less legacy comparison requires the exact question set and explicit revisions", () => {
  assert.equal(
    run([legacy("saved", 0, { seconds: 1 }), current]).basis,
    "same_question_revisions",
  );
  const invalid = [
    [
      { id: "q1", sourceRevision: "legacy" },
      { id: "q2", sourceRevision: "1" },
    ],
    [
      { id: "q1", sourceRevision: "3" },
      { id: "q2", sourceRevision: "1" },
    ],
    [{ id: "q1", sourceRevision: "2" }],
    [
      { id: "q1", sourceRevision: "2" },
      { id: "other", sourceRevision: "1" },
    ],
    [
      { id: "q1", sourceRevision: "2" },
      { id: "q1", sourceRevision: "2" },
    ],
    [],
  ];
  for (const details of invalid)
    assert.equal(
      run([legacy("invalid", 0, { seconds: 1 }, { details }), current]),
      null,
    );
  const unknownSource = canonical("current", 80, current.data.submittedAtIso, {
    sourceHash: "legacy",
    learningSnapshot: [],
  });
  assert.equal(
    run([
      legacy(
        "unknown-source",
        0,
        { seconds: 1 },
        { sourceHash: "legacy", details: [] },
      ),
      unknownSource,
    ]),
    null,
  );
});

await test("Same source allows randomized pools but makes no learning or ability claim", () => {
  const randomized = canonical("old", 20, old.data.submittedAtIso, {
    answerChecks: [{ id: "different", correct: false }],
    learningSnapshot: [{ id: "different", sourceRevision: "9" }],
  });
  const result = run([randomized, current]);
  assert.equal(result.basis, "same_source");
  assert.equal(result.delta, 60);
  assert.equal(/학습|능력|숙달|성장/.test(format(result)), false);
});

await test("Query reads are owner and semester scoped, with no truncation or write", async () => {
  database.set("semester_assessment_results", [old, current]);
  database.set("years/2026/semesters/2/quiz_results", []);
  queries = [];
  const result = await load({
    ...request,
    config: { year: "2026", semester: "2" },
  });
  assert.equal(result.delta, 60);
  assert.equal(queries.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(queries[0])), {
    path: "semester_assessment_results",
    filters: [
      { field: "studentUid", operator: "==", value: "student-a" },
      { field: "semesterId", operator: "==", value: "2026-2" },
    ],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(queries[1])), {
    path: "years/2026/semesters/2/quiz_results",
    filters: [{ field: "uid", operator: "==", value: "student-a" }],
  });
});

await test("Either query failure yields no comparison and does not reject the result UI", async () => {
  for (const path of [
    "semester_assessment_results",
    "years/2026/semesters/2/quiz_results",
  ]) {
    failedPath = path;
    assert.equal(
      await load({ ...request, config: { year: "2026", semester: "2" } }),
      null,
    );
  }
  failedPath = "";
});

await test("Semester transition and absent identity avoid even starting queries", async () => {
  queries = [];
  assert.equal(
    await load({ ...request, config: { year: "2026", semester: "1" } }),
    null,
  );
  assert.equal(
    await load({
      ...request,
      studentUid: "",
      config: { year: "2026", semester: "2" },
    }),
    null,
  );
  assert.equal(queries.length, 0);
});

console.log(`quiz score comparison verified: ${count} scenarios`);
