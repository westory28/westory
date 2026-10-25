import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Real pure model, synthetic records only. No Firebase or browser access.
const compiled = ts.transpileModule(
  readFileSync("src/lib/quizAnalysis.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;
const {
  buildQuizAnalysis,
  buildQuizItemStatistics,
  deduplicateQuizAnalysisRecords,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const semesterId = "2026-2";
const students = [
  { uid: "a", name: "가상학생 A", classId: "3-1" },
  { uid: "b", name: "가상학생 B", classId: "3-1" },
  { uid: "c", name: "가상학생 C", classId: "3-2" },
];
const questions = [1, 2, 3].map((id) => ({
  id,
  contentRevision: 2,
  unitId: "unit-a",
  refSmall: id === 3 ? "leaf-b" : "leaf-a",
  category: "diagnostic",
  concepts: ["현재 은행 태그"],
  options: ["선지 A", "선지 B"],
}));
const item = (questionId, correct, answer = "선지 A", extra = {}) => ({
  questionId,
  correct,
  answer,
  sourceRevision: "2",
  concepts: ["통치 체제"],
  reviewLessonId: "lesson-a",
  ...extra,
});
const record = (
  id,
  studentUid,
  submittedAt,
  scorePercent,
  items = [item(1, true)],
  extra = {},
) => ({
  id,
  source: "canonical",
  studentUid,
  semesterId,
  submittedAt,
  scorePercent,
  items,
  unitId: "unit-a",
  category: "diagnostic",
  attemptId: id,
  resultId: id,
  submissionRef: `semester_assessment_submissions/${id}`,
  ...extra,
});
const run = (records = [], overrides = {}) =>
  buildQuizAnalysis({ semesterId, students, questions, records, ...overrides });
const student = (analysis, uid = "a") =>
  analysis.students.find((row) => row.uid === uid);
const question = (analysis, id = "1") =>
  analysis.questions.find((row) => row.id === id);
let cases = 0;
const test = (name, body) => {
  body();
  cases += 1;
  console.log(`PASS ${name}`);
};

const psychQuestions = [1, 2, 3, 4].map((id) => ({ ...questions[0], id }));
const psychRecord = (id, studentUid, outcomes, extra = {}) =>
  record(
    id,
    studentUid,
    10,
    99,
    outcomes.map((correct, index) =>
      item(index + 1, correct, correct ? "선지 A" : "선지 B"),
    ),
    { totalCount: outcomes.length, ...extra },
  );
const psych = (records, extra = {}) =>
  buildQuizItemStatistics({
    semesterId,
    students,
    questions: psychQuestions,
    records,
    scope: { unitIds: ["unit-a"], category: "diagnostic" },
    ...extra,
  });
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const positiveRecords = [
  psychRecord("a", "a", [false, false, false]),
  psychRecord("b", "b", [true, false, false]),
  psychRecord("c", "c", [true, true, false]),
  psychRecord("d", "d", [true, true, true]),
];

test("Corrected point-biserial removes the item; complete-form alpha uses all 0/1 items", () => {
  const result = psych(positiveRecords);
  const row = result.questions[0].cohorts[0];
  assert.equal(result.eligibleSubmissionCount, 4);
  assert.equal(row.sampleSize, 4);
  assert.equal(row.smallSample, true);
  assert.equal(row.difficultyPercent, 75);
  near(row.correctedItemTotalCorrelation, 0.75 / Math.sqrt(0.75 * 2.75));
  near(row.alphaReliability, 0.75);
  assert.equal(row.correlationUnavailableReason, null);
  assert.equal(row.alphaUnavailableReason, null);
  assert.equal(
    row.options.find((option) => option.answer === "선지 A").meanRestPercent,
    50,
  );
  assert.equal(
    row.options.find((option) => option.answer === "선지 B").meanRestPercent,
    0,
  );
  // Deliberately wrong stored percentages (99) must never supply rest scores.
  assert.equal(
    row.options.find((option) => option.answer === "선지 A").percent,
    75,
  );
});

test("Negative discrimination and reliability remain negative, never clamped to favorable scores", () => {
  const result = psych(
    [true, true, false, false].map((value, index) =>
      psychRecord(String(index), String(index), [value, !value, !value]),
    ),
  );
  const row = result.questions[0].cohorts[0];
  near(row.correctedItemTotalCorrelation, -1);
  near(row.alphaReliability, -3);
});

test("Different random forms never pool; presentation order does not split an identical form", () => {
  const records = structuredClone(positiveRecords);
  records[1].items.reverse();
  records[3].items[2].questionId = 4;
  const result = psych(records);
  const row = result.questions[0];
  assert.equal(row.formCount, 2);
  assert.deepEqual(
    row.cohorts.map((cohort) => cohort.sampleSize).sort(),
    [1, 3],
  );
  assert.equal(
    row.cohorts.find((cohort) => cohort.sampleSize === 1)
      .correctedItemTotalCorrelation,
    null,
  );
});

test("A retake never replaces the first submission or gives a student another observation", () => {
  const later = psychRecord("a-later", "a", [true, true, true], {
    submittedAt: 20,
  });
  const result = psych([...positiveRecords, later, positiveRecords[0]]);
  assert.equal(result.firstSubmissionCount, 4);
  assert.equal(result.eligibleSubmissionCount, 4);
  assert.equal(result.questions[0].cohorts[0].difficultyPercent, 75);
  const badFirst = { ...positiveRecords[0], totalCount: undefined };
  const excluded = psych([badFirst, later]);
  assert.equal(excluded.excludedIncompleteCount, 1);
  assert.equal(excluded.eligibleSubmissionCount, 0);
});

test("Incomplete grading, duplicate item IDs and missing totals are excluded as whole forms", () => {
  for (const mutate of [
    (row) => {
      row.items[0].correct = null;
    },
    (row) => {
      row.items[1].questionId = 1;
    },
    (row) => {
      row.totalCount = 4;
    },
    (row) => {
      delete row.totalCount;
    },
  ]) {
    const first = structuredClone(positiveRecords[0]);
    mutate(first);
    const result = psych([first]);
    assert.equal(result.excludedIncompleteCount, 1);
    assert.equal(result.eligibleSubmissionCount, 0);
  }
});

test("Every item in the form needs its explicit current revision, not only the focal item", () => {
  for (const value of ["1", "legacy", undefined]) {
    const first = structuredClone(positiveRecords[0]);
    first.items[2].sourceRevision = value;
    const result = psych([first]);
    assert.equal(result.excludedRevisionCount, 1);
    assert.equal(result.eligibleSubmissionCount, 0);
  }
  const result = psych(positiveRecords, {
    questions: psychQuestions.slice(0, 2),
  });
  assert.equal(result.excludedRevisionCount, 4);
});

test("Unknown or tied first chronology cannot pick a favorable first submission", () => {
  for (const submittedAt of [10, null]) {
    const result = psych([
      positiveRecords[0],
      psychRecord("later", "a", [true, true, true], { submittedAt }),
    ]);
    assert.equal(result.excludedChronologyCount, 1);
    assert.equal(result.eligibleSubmissionCount, 0);
  }
  assert.equal(
    psych([{ ...positiveRecords[0], submittedAt: null }])
      .excludedChronologyCount,
    1,
  );
});

test("Undefined correlations distinguish few students, one item, constant item and constant rest", () => {
  const few = psych(positiveRecords.slice(0, 2)).questions[0].cohorts[0];
  assert.equal(few.correctedItemTotalCorrelation, null);
  assert.equal(few.correlationUnavailableReason, "insufficient_students");
  assert.equal(few.alphaUnavailableReason, "insufficient_students");
  const single = psych(
    [false, true, true].map((value, index) =>
      psychRecord(String(index), String(index), [value]),
    ),
  ).questions[0].cohorts[0];
  assert.equal(single.correlationUnavailableReason, "single_item");
  assert.equal(single.alphaUnavailableReason, "single_item");
  assert.equal(single.options[0].meanRestPercent, null);
  const constant = psych(
    [false, true, true].map((value, index) =>
      psychRecord(String(index), String(index), [true, value]),
    ),
  );
  assert.equal(
    constant.questions[0].cohorts[0].correlationUnavailableReason,
    "constant_item",
  );
  assert.equal(
    constant.questions[1].cohorts[0].correlationUnavailableReason,
    "constant_rest_score",
  );
  const equalTotals = psych(
    [false, true, true].map((value, index) =>
      psychRecord(String(index), String(index), [value, !value]),
    ),
  );
  assert.equal(
    equalTotals.questions[0].cohorts[0].alphaUnavailableReason,
    "constant_total_score",
  );
});

test("First-submission option percentages use the complete cohort, preserving blank and absent answers", () => {
  const records = structuredClone(positiveRecords);
  records[0].items[0].answer = "";
  delete records[1].items[0].answer;
  const row = psych(records).questions[0].cohorts[0];
  assert.equal(row.unansweredCount, 1);
  assert.equal(row.missingAnswerCount, 1);
  assert.equal(
    row.options.find((option) => option.answer === "선지 A").percent,
    50,
  );
  assert.equal(row.sampleSize, 4);
});

test("First-form analysis rechecks semester, class and assessment without reusing another population", () => {
  const result = psych(
    [
      ...positiveRecords,
      { ...positiveRecords[0], id: "past", semesterId: "2025-2" },
    ],
    {
      scope: { unitIds: ["unit-a"], category: "diagnostic", classId: "3-1" },
    },
  );
  assert.equal(result.firstSubmissionCount, 2);
  assert.equal(result.questions[0].cohorts[0].sampleSize, 2);
  assert.equal(
    psych(positiveRecords, {
      rosterAvailable: false,
      scope: { classId: "3-1" },
    }).eligibleSubmissionCount,
    0,
  );
  const before = structuredClone(positiveRecords);
  psych(positiveRecords);
  assert.deepEqual(positiveRecords, before);
});

test("Empty records keep missing distinct from zero", () => {
  const result = run();
  assert.equal(result.averageScore, null);
  assert.equal(result.participantCount, 0);
  assert.equal(student(result).latestScore, null);
  assert.equal(student(result).scoreUnavailableReason, "no_attempt");
  assert.equal(question(result).correctRate, null);
  assert.equal(question(result).assessedStudentCount, 0);
});

test("One latest attempt per student determines score distribution", () => {
  const result = run([
    record("a-old", "a", 10, 100),
    record("a-new", "a", 20, 0),
    record("b", "b", 30, 80),
    record("c", "c", 30, null),
  ]);
  assert.equal(result.averageScore, 40);
  assert.equal(result.scoredStudentCount, 2);
  assert.equal(result.missingScoreStudentCount, 1);
  assert.equal(result.participantCount, 3);
  assert.equal(student(result).latestRecord.id, "a-new");
  assert.equal(student(result).latestScore, 0);
  assert.deepEqual(
    result.scoreHistogram.map((band) => band.count),
    [1, 0, 0, 0, 1],
  );
});

test("Latest missing score does not fall back to an older high score", () => {
  const result = run([
    record("old", "a", 1, 100),
    record("new", "a", 2, undefined),
  ]);
  assert.equal(student(result).latestScore, null);
  assert.equal(student(result).scoreUnavailableReason, "missing_score");
  for (const invalid of [NaN, Infinity, -1, 101, "80", "", false]) {
    assert.equal(
      student(run([record("invalid", "a", 1, invalid)])).latestScore,
      null,
    );
  }
});

test("Histogram bands cover decimal scores and 100 without gaps", () => {
  const values = [0, 19.9, 20, 39.9, 40, 59.9, 60, 79.9, 80, 100];
  const roster = values.map((_, i) => ({ uid: String(i) }));
  const result = run(
    values.map((value, i) => record(String(i), String(i), 1, value)),
    { students: roster },
  );
  assert.deepEqual(
    result.scoreHistogram.map((band) => band.count),
    [2, 2, 2, 2, 2],
  );
});

test("Repeated submissions and repeated fetching never inflate students", () => {
  const values = Array.from({ length: 25 }, (_, index) =>
    record(`repeat-${index}`, "a", index, index, [
      item(1, index === 24, index === 24 ? "선지 A" : "선지 B"),
    ]),
  );
  const result = run([...values, values[0], values[24]]);
  assert.equal(result.recordCount, 25);
  assert.equal(result.duplicateRecordCount, 2);
  assert.equal(result.scoredStudentCount, 1);
  assert.equal(question(result).distinctStudents, 1);
  assert.equal(question(result).assessedStudentCount, 1);
  assert.equal(question(result).correctRate, 100);
  assert.equal(
    question(result).optionDistribution.find((row) => row.answer === "선지 B")
      .count,
    0,
  );
  assert.equal(student(result).changes.wrongToCorrectCount, 1);
});

test("Canonical/legacy mirrors require explicit references and prefer canonical", () => {
  const canonical = record("canonical", "a", 10, 0);
  const legacy = record("legacy", "a", 10, 100, [], {
    source: "legacy",
    attemptId: undefined,
    resultId: undefined,
    submissionRef: undefined,
    resultRef: "semester_assessment_results/canonical",
  });
  const result = run([legacy, canonical]);
  assert.equal(result.recordCount, 1);
  assert.equal(student(result).latestScore, 0);
  assert.equal(result.duplicateRecordCount, 1);
  const unrelated = { ...legacy, id: "independent", resultRef: undefined };
  assert.equal(
    deduplicateQuizAnalysisRecords([canonical, unrelated]).length,
    2,
  );
  assert.equal(
    deduplicateQuizAnalysisRecords([
      canonical,
      { ...unrelated, id: "canonical" },
    ]).length,
    2,
  );
});

test("Explicit links join transitively but never cross student/semester", () => {
  const canonical = record("main", "a", 10, 75);
  const linked = record("old-a", "a", 10, 75, [], {
    source: "legacy",
    canonicalAttemptId: "main",
    attemptId: undefined,
    resultId: undefined,
    submissionRef: undefined,
  });
  const bridge = {
    ...linked,
    id: "old-b",
    canonicalAttemptId: undefined,
    legacyResultId: "old-a",
  };
  assert.equal(
    deduplicateQuizAnalysisRecords([bridge, linked, canonical]).length,
    1,
  );
  assert.equal(
    deduplicateQuizAnalysisRecords([
      canonical,
      { ...linked, studentUid: "b" },
      { ...linked, semesterId: "2025-2" },
    ]).length,
    3,
  );
});

test("Semester, roster, class, assessment category and round remain isolated", () => {
  const values = [
    record("a", "a", 1, 0),
    record("b", "b", 2, 100, undefined, {
      category: "exam_prep",
      examRound: "round_2",
    }),
    record("c", "c", 3, 50),
    record("foreign", "foreign", 4, 90),
    record("past", "a", 5, 90, undefined, { semesterId: "2025-2" }),
  ];
  const result = run(values, {
    scope: { classId: "3-1", category: "diagnostic" },
  });
  assert.equal(result.recordCount, 1);
  assert.equal(result.averageScore, 0);
  assert.equal(result.students.length, 2);
  assert.equal(result.excludedRecordCount, 4);
  const round = run(values, {
    scope: { category: "exam_prep", examRound: "round_2" },
  });
  assert.equal(round.recordCount, 1);
  assert.equal(round.averageScore, 100);
});

test("A unit-partial record never supplies a fabricated unit score", () => {
  const result = run(
    [record("r", "a", 1, 100, [item(1, false), item(3, true)])],
    { scope: { unitIds: ["leaf-a"] } },
  );
  assert.equal(result.questions.length, 2);
  assert.equal(student(result).latestScore, null);
  assert.equal(student(result).scoreUnavailableReason, "partial_scope");
  assert.equal(result.averageScore, null);
  assert.equal(question(result).correctCount, 0);
  assert.equal(question(result).wrongCount, 1);
  assert.equal(
    run([record("r", "a", 1, 80)], { scope: { unitIds: ["unit-a"] } })
      .averageScore,
    80,
  );
  assert.equal(
    run([record("r", "a", 1, 80)], { scope: { unitIds: [] } }).recordCount,
    0,
  );
});

test("Canonical scope wins before a stale legacy mirror is filtered", () => {
  const canonical = record("r", "a", 2, 50, [], { category: "exam_prep" });
  const legacy = record("old", "a", 2, 50, [], {
    source: "legacy",
    canonicalAttemptId: "r",
    category: "diagnostic",
  });
  assert.equal(
    run([legacy, canonical], { scope: { category: "diagnostic" } }).recordCount,
    0,
  );
});

test("Old and unverified revisions remain outside current item statistics", () => {
  const result = run([
    record("old", "a", 1, 0, [
      item(1, false, "선지 B", { sourceRevision: "1" }),
    ]),
    record("new", "a", 2, 100, [item(1, true)]),
    record("unknown", "b", 3, 100, [
      item(1, true, "선지 A", { sourceRevision: "legacy" }),
    ]),
    record("missing", "c", 3, 0, [
      item(1, false, "선지 B", { sourceRevision: undefined }),
    ]),
  ]);
  const row = question(result);
  assert.equal(row.attemptedStudentCount, 3);
  assert.equal(row.distinctStudents, 1);
  assert.equal(row.revisionExcludedCount, 1);
  assert.equal(row.revisionUnknownCount, 2);
  assert.equal(row.correctRate, 100);
  assert.equal(student(result).changes.comparedQuestionCount, 0);
  assert.equal(result.scoredStudentCount, 3);
  assert.equal(
    question(run([record("r", "a", 1, 100)], { questions: [{ id: 1 }] }))
      .correctRate,
    null,
  );
});

test("Unknown grading is neither wrong nor a correct-rate denominator", () => {
  const result = run([
    record("a", "a", 1, 100, [item(1, true)]),
    record("b", "b", 1, 0, [item(1, null, "선지 B")]),
    record("c", "c", 1, 0, [item(1, false, "")]),
  ]);
  const row = question(result);
  assert.equal(row.distinctStudents, 3);
  assert.equal(row.assessedStudentCount, 2);
  assert.equal(row.correctRate, 50);
  assert.equal(row.unknownCorrectnessCount, 1);
  assert.equal(row.unansweredCount, 1);
  assert.equal(row.knownAnswerStudentCount, 2);
  assert.equal(
    row.optionDistribution.find((option) => option.answer === "선지 A").percent,
    50,
  );
});

test("Absent answer, recorded blank answer and unseen option stay distinct", () => {
  const result = run([
    record("a", "a", 1, 0, [
      { questionId: 1, correct: false, sourceRevision: "2" },
    ]),
    record("b", "b", 1, 0, [item(1, false, "")]),
    record("c", "c", 1, 0, [item(1, false, "기타 답")]),
  ]);
  const row = question(result);
  assert.equal(row.missingAnswerCount, 1);
  assert.equal(row.unansweredCount, 1);
  assert.equal(row.knownAnswerStudentCount, 1);
  assert.deepEqual(
    row.optionDistribution.find((option) => option.answer === "기타 답"),
    { answer: "기타 답", count: 1, percent: 100, listedOption: false },
  );
});

test("Latest outcome and snapshot concepts determine review evidence", () => {
  const result = run([
    record("old", "a", 1, 0, [item(1, false), item(2, true)]),
    record("new", "a", 2, 50, [
      item(1, true),
      item(2, false, "선지 B", { concepts: ["정치 기구"] }),
    ]),
  ]);
  const row = student(result);
  assert.equal(row.correctCount, 1);
  assert.equal(row.wrongCount, 1);
  assert.deepEqual(
    row.wrongConcepts.map((entry) => entry.concept),
    ["정치 기구"],
  );
  assert.deepEqual(row.wrongConcepts[0].wrongQuestionIds, ["2"]);
  assert.deepEqual(row.wrongConcepts[0].reviewLessonIds, ["lesson-a"]);
  assert.equal(row.changes.comparedQuestionCount, 2);
  assert.equal(row.changes.wrongToCorrectCount, 1);
  assert.equal(row.changes.correctToWrongCount, 1);
  const untagged = student(
    run([record("u", "a", 1, 0, [item(1, false, "선지 B", { concepts: [] })])]),
  );
  assert.deepEqual(untagged.wrongConcepts, []);
  assert.equal(untagged.missingConceptQuestionCount, 1);
});

test("Different question pools do not produce a learning-gain comparison", () => {
  const result = run([
    record("old", "a", 1, 0, [item(1, false)]),
    record("new", "a", 2, 100, [item(2, true)]),
  ]);
  assert.equal(student(result).latestScore, 100);
  assert.equal(student(result).changes.comparedQuestionCount, 0);
  assert.equal(student(result).changes.wrongToCorrectCount, 0);
});

test("Missing or tied chronology cannot invent a latest record or improvement", () => {
  for (const secondTime of [null, 1]) {
    const result = run([
      record("first", "a", 1, 0, [item(1, false)]),
      record("second", "a", secondTime, 100, [item(1, true)]),
    ]);
    assert.equal(student(result).latestRecord, null);
    assert.equal(student(result).latestScore, null);
    assert.equal(student(result).scoreUnavailableReason, "chronology_unknown");
    assert.equal(question(result).correctRate, null);
    assert.equal(question(result).chronologyUnknownCount, 1);
    assert.equal(student(result).changes.chronologyUnknownQuestionCount, 1);
  }
  const result = run([record("r", "a", null, 0)]);
  assert.equal(student(result).latestScore, 0);
});

test("Firestore nanoseconds establish order without a false tie", () => {
  const result = run([
    record("old", "a", { seconds: 1, nanoseconds: 1e6 }, 0),
    record("new", "a", { seconds: 1, nanoseconds: 2e6 }, 100),
  ]);
  assert.equal(student(result).latestScore, 100);
  assert.equal(student(result).changes.comparedQuestionCount, 1);
});

test("Malformed duplicate item outcomes do not choose a favorable answer", () => {
  const row = question(
    run([record("r", "a", 1, 100, [item(1, false), item(1, true)])]),
  );
  assert.equal(row.distinctStudents, 1);
  assert.equal(row.assessedStudentCount, 0);
  assert.equal(row.unknownCorrectnessCount, 1);
  assert.equal(row.correctRate, null);
});

test("Roster failure has explicit all-class aggregate fallback only", () => {
  const records = [record("r", "a", 1, 0)];
  const emptyRoster = run(records, { students: [] });
  assert.equal(emptyRoster.recordCount, 1);
  assert.equal(emptyRoster.unlistedParticipantCount, 1);
  assert.deepEqual(emptyRoster.students, []);
  const fallback = run(records, { students: [], rosterAvailable: false });
  assert.deepEqual(fallback.students, []);
  assert.equal(fallback.rosterAvailable, false);
  assert.equal(fallback.averageScore, 0);
  assert.equal(question(fallback).assessedStudentCount, 1);
  const classScope = run(records, {
    students: [],
    rosterAvailable: false,
    scope: { classId: "3-1" },
  });
  assert.equal(classScope.recordCount, 0);
  assert.equal(classScope.averageScore, null);
});

test("Transferred students remain in whole-class aggregates, never the current class roster", () => {
  const records = [
    record("known", "a", 1, 0),
    record("transferred", "former", 1, 100),
  ];
  const whole = run(records);
  assert.equal(whole.averageScore, 50);
  assert.equal(whole.unlistedParticipantCount, 1);
  assert.equal(question(whole).assessedStudentCount, 2);
  assert.equal(
    whole.students.some((row) => row.uid === "former"),
    false,
  );
  const scoped = run(records, { scope: { classId: "3-1" } });
  assert.equal(scoped.averageScore, 0);
  assert.equal(question(scoped).assessedStudentCount, 1);
  assert.equal(scoped.unlistedParticipantCount, 0);
});

test("Telemetry cannot influence any aggregate and source records stay unchanged", () => {
  const plain = [record("r", "a", 1, 0, [item(1, false)])];
  const timed = structuredClone(plain);
  timed[0].analytics = {
    questions: {
      1: {
        activeMs: 1,
        firstResponseMs: 1,
        finalResponseMs: 1,
        confidence: "sure",
      },
    },
  };
  const before = structuredClone(timed);
  const a = run(plain),
    b = run(timed);
  // The selected record remains available for its provenance; it is not an analysis field.
  b.students[0].latestRecord = a.students[0].latestRecord;
  assert.deepEqual(b, a);
  assert.deepEqual(timed, before);
  assert.equal(
    Object.keys(question(b)).some((key) =>
      /time|confidence|ability|risk/i.test(key),
    ),
    false,
  );
});

const loadPureExports = (path, dependencies = {}) => {
  const exports = {};
  const script = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  vm.runInNewContext(
    script,
    {
      exports,
      require: (name) => {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        throw new Error(`Unexpected dependency ${name}`);
      },
    },
    { filename: path },
  );
  return exports;
};
const rounds = loadPureExports("src/lib/mockExamRounds.ts");
const { adaptQuizAnalysisRecords, quizAnalysisConfiguredClasses } =
  loadPureExports("src/pages/teacher/components/useQuizAnalysisData.ts", {
    react: {},
    "firebase/firestore": {},
    "../../../lib/firebase": {},
    "../../../lib/semesterScope": {},
    "../../../lib/assessmentRelease": {},
    "../../../lib/mockExamRounds": rounds,
  });

test("Actual teacher adapter preserves server percentage, current revisions and result linkage", () => {
  const data = adaptQuizAnalysisRecords(
    [
      {
        id: "attempt-real-shape",
        source: "canonical",
        raw: {
          assessmentKind: "QUIZ",
          studentUid: "a",
          semesterId,
          attemptId: "attempt-real-shape",
          resultId: "attempt-real-shape",
          definitionId: "quiz:2026-2:unit-a:diagnostic",
          sourceId: "unit-a",
          category: "diagnostic",
          submittedAtIso: "2026-10-15T01:00:00Z",
          percent: 50,
          score: 1,
          total: 2,
          answerChecks: [
            { id: "1", correct: true },
            { id: "2", correct: false },
          ],
          answers: { 1: "선지 A", 2: "선지 B" },
          learningSnapshot: [
            { id: "1", sourceRevision: "2", concepts: ["통치 체제"] },
            { id: "2", sourceRevision: "2", concepts: ["정치 기구"] },
          ],
          questionSnapshots: [{ id: "1", question: "당시 원문" }],
          submissionRef: "semester_assessment_submissions/attempt-real-shape",
        },
      },
      {
        id: "old-mirror",
        source: "legacy",
        raw: {
          uid: "a",
          unitId: "unit-a",
          category: "diagnostic",
          score: 100,
          timestamp: { seconds: 1 },
          resultRef: "semester_assessment_results/attempt-real-shape",
          details: [{ id: 1, correct: false, u: "선지 B" }],
        },
      },
      {
        id: "history",
        source: "canonical",
        raw: {
          assessmentKind: "HISTORY_CLASSROOM",
          studentUid: "a",
          percent: 100,
        },
      },
    ],
    students,
    semesterId,
  );
  const result = run(data.records);
  assert.equal(result.recordCount, 1);
  assert.equal(data.records[0].totalCount, 2);
  assert.equal(data.records[0].definitionId, "quiz:2026-2:unit-a:diagnostic");
  assert.equal(student(result).latestScore, 50);
  assert.equal(question(result).correctRate, 100);
  assert.equal(question(result, "2").correctRate, 0);
  assert.equal(student(result).wrongConcepts[0].concept, "정치 기구");
  assert.equal(
    data.snapshots["canonical:attempt-real-shape"]["1"].question,
    "당시 원문",
  );
});

test("School configuration includes every grade and empty class without a grade-3 fallback", () => {
  const result = quizAnalysisConfiguredClasses({
    grades: [
      { value: "1", label: "1학년" },
      { value: "3", label: "3학년" },
    ],
    classes: [
      { value: "2", label: "2반" },
      { value: "1", label: "1반" },
      { value: "1" },
    ],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { id: "1-1", label: "1학년 1반" },
    { id: "1-2", label: "1학년 2반" },
    { id: "3-1", label: "3학년 1반" },
    { id: "3-2", label: "3학년 2반" },
  ]);
  assert.equal(quizAnalysisConfiguredClasses(null).length, 0);
});

test("Unrelated config changes cannot restart semester analysis reads or listeners", () => {
  const dependencies = [];
  const { useQuizAnalysisData } = loadPureExports(
    "src/pages/teacher/components/useQuizAnalysisData.ts",
    {
      react: {
        useEffect: (_body, deps) => dependencies.push(deps),
        useState: (initial) => [initial, () => {}],
        useRef: (value) => ({ current: value }),
        useMemo: (calculate) => calculate(),
      },
      "firebase/firestore": {},
      "../../../lib/firebase": {},
      "../../../lib/semesterScope": {
        getYearSemester: (config) => ({
          year: config.year,
          semester: config.semester,
        }),
      },
      "../../../lib/assessmentRelease": {
        getAssessmentSemesterId: (config) =>
          `${config.year}-${config.semester}`,
      },
      "../../../lib/mockExamRounds": rounds,
    },
  );
  useQuizAnalysisData({ year: "2026", semester: "2", unrelated: "old" });
  useQuizAnalysisData({ year: "2026", semester: "2", unrelated: "new" });
  useQuizAnalysisData({ year: "2026", semester: "1" });
  assert.deepEqual(dependencies[0], dependencies[1]);
  assert.notDeepEqual(dependencies[1], dependencies[2]);
  assert.equal(
    dependencies[0].some((value) => typeof value === "object"),
    false,
  );
});

test("Actual adapter preserves missing legacy data and source-qualified snapshot identity", () => {
  const data = adaptQuizAnalysisRecords(
    [
      {
        id: "collision",
        source: "legacy",
        raw: {
          uid: "a",
          unitId: "unit-a",
          category: "diagnostic",
          timestamp: { seconds: 2 },
          details: [{ id: 1, q: "과거 발문", u: "" }],
        },
      },
      {
        id: "collision",
        source: "canonical",
        raw: {
          assessmentKind: "QUIZ",
          studentUid: "b",
          semesterId,
          sourceId: "unit-a",
          category: "diagnostic",
          percent: 0,
          submittedAtIso: "2026-10-15T01:00:00Z",
          answerChecks: [{ id: "1", correct: false }],
          learningSnapshot: [{ id: "1", sourceRevision: "2" }],
          questionSnapshots: [{ id: "1", question: "다른 학생 당시 발문" }],
        },
      },
    ],
    students,
    semesterId,
  );
  const result = run(data.records);
  assert.equal(result.recordCount, 2);
  assert.equal(student(result).latestScore, null);
  assert.equal(student(result, "b").latestScore, 0);
  assert.equal(question(result).revisionUnknownCount, 1);
  assert.equal(question(result).missingAnswerCount, 1);
  assert.equal(data.snapshots["legacy:collision"]["1"].question, "과거 발문");
  assert.equal(
    data.snapshots["canonical:collision"]["1"].question,
    "다른 학생 당시 발문",
  );
});

test("Canonical absent answer keys are non-answers only when the submitted answer map exists", () => {
  const rawResult = (studentUid, answers) => ({
    assessmentKind: "QUIZ",
    studentUid,
    semesterId,
    sourceId: "unit-a",
    category: "diagnostic",
    percent: 0,
    total: 2,
    submittedAtIso: "2026-10-15T01:00:00Z",
    answerChecks: [
      { id: "1", correct: false },
      { id: "2", correct: false },
    ],
    learningSnapshot: [
      { id: "1", sourceRevision: "2" },
      { id: "2", sourceRevision: "2" },
    ],
    ...(answers === undefined ? {} : { answers }),
  });
  const { records } = adaptQuizAnalysisRecords(
    [
      { id: "normal-timeout", source: "canonical", raw: rawResult("a", {}) },
      {
        id: "unavailable",
        source: "canonical",
        raw: rawResult("b", undefined),
      },
      {
        id: "explicit-blank",
        source: "canonical",
        raw: rawResult("c", { 1: "", 2: "선지 B" }),
      },
    ],
    students,
    semesterId,
  );
  assert.equal(records[0].items[0].answer, "");
  assert.equal(Object.hasOwn(records[1].items[0], "answer"), false);
  const recent = question(run(records));
  assert.equal(recent.unansweredCount, 2);
  assert.equal(recent.missingAnswerCount, 1);
  assert.equal(recent.assessedStudentCount, 3);
  assert.equal(recent.correctRate, 0);
  const first = psych(records).questions[0].cohorts[0];
  assert.equal(first.unansweredCount, 2);
  assert.equal(first.missingAnswerCount, 1);
  assert.equal(first.sampleSize, 3);
  assert.equal(first.difficultyPercent, 0);
  for (const malformed of [null, [], "", { 1: null }]) {
    const { records: invalid } = adaptQuizAnalysisRecords(
      [{ id: "invalid", source: "canonical", raw: rawResult("a", malformed) }],
      students,
      semesterId,
    );
    assert.equal(Object.hasOwn(invalid[0].items[0], "answer"), false);
  }
});

test("Legacy saved question content survives the actual teacher adapter", () => {
  const choice = {
    id: 1,
    q: "  과거 발문\n둘째 줄  ",
    a: "저장된 정답",
    exp: "당시 해설",
    type: "choice",
    image: "https://example.invalid/old-question.png",
    passage: "{box}당시 사료{/box}",
    options: ["저장된 정답", "과거 오답"],
    choiceOptionImages: [null, "https://example.invalid/old-option.png"],
    hint: "당시 힌트",
    hintEnabled: false,
    correct: false,
    u: "과거 오답",
  };
  const matching = {
    id: 2,
    q: "과거 연결형 발문",
    a: "태조=>조선 건국||세종=>훈민정음",
    exp: "과거 연결형 해설",
    type: "matching",
    matchingPairs: [
      {
        left: "태조",
        right: "조선 건국",
        rightImage: "https://example.invalid/old-pair.png",
      },
      { left: "세종", right: "훈민정음" },
    ],
    u: "태조=>훈민정음",
    correct: false,
  };
  const rows = [
    {
      id: "legacy-rich",
      source: "legacy",
      raw: {
        uid: "a",
        unitId: "unit-a",
        category: "diagnostic",
        score: 0,
        timestamp: { seconds: 1 },
        details: [choice, matching],
      },
    },
  ];
  const before = structuredClone(rows);
  const data = adaptQuizAnalysisRecords(rows, students, semesterId);
  const saved = JSON.parse(
    JSON.stringify(data.snapshots["legacy:legacy-rich"]),
  );
  assert.deepEqual(saved["1"], {
    question: choice.q,
    answer: choice.a,
    explanation: choice.exp,
    type: choice.type,
    image: choice.image,
    passage: choice.passage,
    options: choice.options,
    choiceOptionImages: choice.choiceOptionImages,
    hint: choice.hint,
    hintEnabled: choice.hintEnabled,
  });
  assert.deepEqual(saved["2"], {
    question: matching.q,
    answer: matching.a,
    explanation: matching.exp,
    type: matching.type,
    matchingPairs: matching.matchingPairs,
  });
  assert.equal(data.records[0].items[0].answer, "과거 오답");
  assert.deepEqual(rows, before);
});

test("Stored nested snapshots take priority and retain known legacy fallback fields", () => {
  const nested = {
    question: "중첩 스냅샷 발문",
    answer: 0,
    explanation: "",
    type: "choice",
    options: ["0", "1"],
    choiceOptionImages: [null, "https://example.invalid/snapshot-option.png"],
  };
  const data = adaptQuizAnalysisRecords(
    [
      {
        id: "nested",
        source: "legacy",
        raw: {
          uid: "a",
          unitId: "unit-a",
          category: "diagnostic",
          timestamp: { seconds: 1 },
          details: [
            {
              id: 1,
              q: "다른 과거 별칭 발문",
              a: "다른 정답",
              exp: "다른 해설",
              passage: "실제로 저장된 과거 사료",
              image: "https://example.invalid/saved-image.png",
              questionSnapshot: nested,
              u: "1",
              correct: false,
            },
          ],
        },
      },
    ],
    students,
    semesterId,
  );
  const saved = data.snapshots["legacy:nested"]["1"];
  assert.equal(saved.question, nested.question);
  assert.equal(saved.answer, 0);
  assert.equal(saved.explanation, "");
  assert.equal(saved.passage, "실제로 저장된 과거 사료");
  assert.equal(saved.image, "https://example.invalid/saved-image.png");
  assert.deepEqual(Array.from(saved.options), nested.options);
  assert.deepEqual(
    Array.from(saved.choiceOptionImages),
    nested.choiceOptionImages,
  );
});

test("Top-level immutable snapshot is not replaced by legacy detail content", () => {
  const original = {
    id: "1",
    question: "응시 시작 원문",
    answer: "시작 정답",
    explanation: "시작 해설",
    options: ["시작 정답", "시작 오답"],
  };
  const data = adaptQuizAnalysisRecords(
    [
      {
        id: "top-level",
        source: "legacy",
        raw: {
          uid: "a",
          unitId: "unit-a",
          category: "diagnostic",
          timestamp: { seconds: 1 },
          questionSnapshots: [original],
          details: [
            {
              id: 1,
              q: "다른 상세 발문",
              a: "다른 상세 정답",
              exp: "다른 상세 해설",
              questionSnapshot: { question: "다른 중첩 원문" },
              u: "학생 답",
            },
          ],
        },
      },
    ],
    students,
    semesterId,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(data.snapshots["legacy:top-level"]["1"])),
    original,
  );
});

test("Missing originals and submitted answers never become fabricated question content", () => {
  const data = adaptQuizAnalysisRecords(
    [
      {
        id: "partial",
        source: "legacy",
        raw: {
          uid: "a",
          unitId: "unit-a",
          category: "diagnostic",
          timestamp: { seconds: 1 },
          learningSnapshot: [
            {
              id: "1",
              sourceRevision: "2",
              question: "현재 은행처럼 보이는 발문",
              answer: "현재 정답",
              explanation: "현재 해설",
              options: ["현재 보기"],
            },
          ],
          details: [
            {
              id: 1,
              q: "발문만 보관됨",
              answer: "학생 제출 답",
              correct: false,
            },
            { id: 2, u: "학생 답만 보관됨", correct: false },
            { id: 3, q: "정답 숫자 0 보존", a: 0 },
          ],
        },
      },
    ],
    students,
    semesterId,
  );
  const saved = data.snapshots["legacy:partial"];
  assert.deepEqual(JSON.parse(JSON.stringify(saved["1"])), {
    question: "발문만 보관됨",
  });
  assert.equal(saved["2"], undefined);
  assert.equal(saved["3"].answer, 0);
  assert.equal(data.records[0].items[0].answer, "학생 제출 답");
  for (const absent of [
    "answer",
    "explanation",
    "image",
    "passage",
    "options",
    "matchingPairs",
  ]) {
    assert.equal(Object.hasOwn(saved["1"], absent), false);
  }
});

test("global keyword scope recomputes matched item scores across units", () => {
  const analysis = run([
    record("a-old", "a", 10, 99, [item(1, false), item(2, true)]),
    record("a-new", "a", 20, 10, [item(1, true)]),
    record("a-other-unit", "a", 30, 80, [item(3, false)], { unitId: "unit-b", category: "formative" }),
    record("b-other", "b", 40, 100, [item(2, true)]),
  ], { scope: { questionIds: ["1", "3"], scoreBasis: "latest_current_revision_items", classId: "3-1" } });
  assert.equal(student(analysis).latestScore, 50);
  assert.equal(student(analysis).attemptCount, 3);
  assert.equal(student(analysis, "b").attemptCount, 0);
  assert.equal(student(analysis, "b").latestScore, null);
  assert.equal(analysis.averageScore, 50);
  assert.equal(analysis.scoreBasis, "latest_current_revision_items");
  assert.equal(analysis.scoreHistogram.find(row => row.lower === 40).count, 1);
  assert.deepEqual(analysis.questions.map(row => row.id), ["1", "3"]);
});

test("empty keyword match excludes all attempts and scores", () => {
  const analysis = run([record("a", "a", 10, 100)], { scope: { questionIds: [], scoreBasis: "latest_current_revision_items" } });
  assert.equal(analysis.participantCount, 0);
  assert.equal(analysis.averageScore, null);
  assert.equal(analysis.questions.length, 0);
});

test("keyword scores exclude old revisions, unknown outcomes and ambiguous chronology", () => {
  const analysis = run([
    record("old-revision", "a", 10, 100, [item(1, true, "선지 A", { sourceRevision: "1" }), item(2, null)]),
    record("same-time-a", "a", 20, 100, [item(3, true)]),
    record("same-time-b", "a", 20, 0, [item(3, false)]),
  ], { scope: { questionIds: ["1", "2", "3"], scoreBasis: "latest_current_revision_items" } });
  assert.equal(student(analysis).latestScore, null);
  assert.equal(analysis.averageScore, null);
  assert.equal(analysis.scoredStudentCount, 0);
});

test("keyword filtering follows canonical deduplication", () => {
  const analysis = run([
    record("canonical", "a", 10, 100, [item(2, true)]),
    record("mirror", "a", 10, 0, [item(1, false)], { source: "legacy", canonicalAttemptId: "canonical" }),
  ], { scope: { questionIds: ["1"], scoreBasis: "latest_current_revision_items" } });
  assert.equal(analysis.participantCount, 0);
  assert.equal(analysis.averageScore, null);
});

console.log(`quiz analysis verified: ${cases} scenarios`);
