import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the real pure module. No Firebase connection or student records.
const source = ts.transpileModule(
  readFileSync("src/lib/assessmentLearning.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;
const {
  buildAssessmentLearningSummary: summarize,
  getAssessmentLearningUnitId,
} = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

const studentUid = "student-a";
const semesterId = "2026-2";
const questions = [1, 2, 3, 4].map((id) => ({
  id,
  unitId: "exam-prep",
  refSmall: "unit-small",
  concepts: ["조선의 통치 체제"],
  cognitiveProcess: "자료 해석",
  reviewLessonId: "lesson-a",
}));
const attempt = (id, submittedAt, entries, extra = {}) => ({
  id,
  studentUid,
  semesterId,
  submittedAt,
  items: entries.map(([questionId, correct, answer, confidence]) => ({
    questionId,
    correct,
    answer,
    confidence,
  })),
  ...extra,
});
const run = (attempts, overrides = {}) =>
  summarize({
    studentUid,
    semesterId,
    questions,
    attempts,
    ...overrides,
  });

// An empty pool or one error never establishes a learning weakness.
assert.equal(run([]).assessedQuestionCount, 0);
const oneWrong = run([attempt("a", 100, [[1, false]])]);
assert.equal(oneWrong.units[0].evidence, "insufficient");
assert.equal(oneWrong.units[0].wrongQuestions, 1);
assert.deepEqual(oneWrong.units[0].unseenQuestionIds, ["2", "3", "4"]);

// Repeated delivery and repetition of one item cannot inflate independent evidence.
const repeated = Array.from({ length: 20 }, (_, index) =>
  attempt(`r-${index}`, 100 + index, [[1, true]]),
);
const repetitionSummary = run([...repeated, repeated[0], repeated[0]]);
assert.equal(repetitionSummary.attemptCount, 20);
assert.equal(repetitionSummary.assessedQuestionCount, 1);
assert.equal(repetitionSummary.units[0].repeatedAttempts, 19);
assert.equal(repetitionSummary.units[0].evidence, "insufficient");

// Latest evidence and first evidence remain distinct, independent of query order.
const first = attempt("first", "2026-10-01T00:00:00Z", [
  [1, false],
  [2, true],
  [3, true],
]);
const second = attempt("second", "2026-10-02T00:00:00Z", [[1, true]]);
const recovered = run([second, first]);
assert.equal(recovered.units[0].firstCorrectQuestions, 2);
assert.equal(recovered.units[0].correctQuestions, 3);
assert.equal(recovered.units[0].evidence, "recheck");
assert.equal(recovered.units[0].distinctQuestions, 3);
assert.deepEqual(run([first, second]), recovered);

// Wrong answers remain actionable even alongside a high overall score.
const needsReview = run(
  [
    attempt("a", 100, [
      [1, true],
      [2, true],
      [3, false, "승정원", "sure"],
    ]),
  ],
  {
    questions: questions.map((q) => ({
      ...q,
      misconceptionTags: { 승정원: "기관의 역할 혼동" },
    })),
  },
);
assert.equal(needsReview.concepts[0].evidence, "review");
assert.equal(needsReview.concepts[0].confidentWrongQuestionCount, 1);
assert.deepEqual(needsReview.concepts[0].possibleConfusions, [
  "기관의 역할 혼동",
]);
assert.deepEqual(needsReview.concepts[0].reviewLessonIds, ["lesson-a"]);

// Missing tags stay missing; neither prompt text nor correct answer supplies a tag.
const untagged = run([attempt("a", 100, [[1, false]])], {
  questions: [{ id: 1, unitId: "unit-a", question: "조선의 통치 체제" }],
});
assert.deepEqual(untagged.concepts, []);
assert.deepEqual(untagged.cognitiveProcesses, []);
assert.equal(untagged.missingConceptQuestionCount, 1);
assert.equal(untagged.missingCognitiveProcessQuestionCount, 1);

// Snapshot metadata (including no tag) beats metadata edited after the assessment.
const snapshot = run([
  attempt("a", 100, [[1, false]], {
    questionMetadata: [{ id: 1, refSmall: "original-unit", concepts: [] }],
  }),
]);
assert.equal(snapshot.units[0].key, "original-unit");
assert.deepEqual(snapshot.concepts, []);
assert.equal(snapshot.currentMetadataQuestionCount, 0);
assert.equal(oneWrong.currentMetadataQuestionCount, 1);

// No observations may cross student or semester boundaries, including blank identity.
const scoped = run([
  first,
  attempt("other-student", 200, [[4, true]], { studentUid: "student-b" }),
  attempt("other-semester", 300, [[4, true]], { semesterId: "2026-1" }),
  attempt("no-owner", 400, [[4, true]], { studentUid: "" }),
]);
assert.equal(scoped.attemptCount, 1);
assert.equal(scoped.excludedAttemptCount, 3);
assert.equal(run([first], { studentUid: "" }).assessedQuestionCount, 0);
assert.equal(run([first], { semesterId: "" }).assessedQuestionCount, 0);

// Self-reported uncertainty requires reconfirmation, not a guessed-answer verdict.
const uncertain = run([
  attempt("a", 100, [
    [1, true, "a", "unsure"],
    [2, true],
    [3, true],
  ]),
]);
assert.equal(uncertain.units[0].evidence, "recheck");
assert.equal(uncertain.units[0].unsureQuestionCount, 1);
const correct = run([
  attempt("a", 100, [
    [1, true],
    [2, true],
    [3, true],
  ]),
]);
assert.equal(correct.units[0].evidence, "positive");
assert.equal("mastery" in correct.units[0], false);

// Unknown/tied attempt times cannot produce confident chronology or positive evidence.
const unknownTime = run([first, attempt("unknown-time", null, [[1, true]])]);
assert.equal(unknownTime.chronologyIncomplete, true);
assert.equal(unknownTime.units[0].evidence, "insufficient");
const tiedTime = run([
  first,
  attempt("same-time", first.submittedAt, [[1, true]]),
]);
assert.equal(tiedTime.units[0].evidence, "insufficient");

// Firestore timestamps, numeric IDs, empty metadata, and duplicate items are safe.
const firestoreTime = run([
  attempt("a", { seconds: 1, nanoseconds: 0 }, [
    [1, true],
    [1, true],
  ]),
  attempt("b", { toMillis: () => 2000 }, [["1", false]]),
]);
assert.equal(firestoreTime.assessedQuestionCount, 1);
assert.equal(firestoreTime.units[0].wrongQuestions, 1);
assert.equal(firestoreTime.units[0].repeatedAttempts, 1);
assert.equal(getAssessmentLearningUnitId(questions[0]), "unit-small");
assert.equal(
  getAssessmentLearningUnitId({ id: 1, unitId: "u", subUnitId: "s" }),
  "s",
);
assert.equal(getAssessmentLearningUnitId({ id: 1 }), "");

// An answer without the teacher's exact option tag cannot invent a confusion.
const noTagMatch = run([attempt("a", 100, [[1, false, "의정부"]])], {
  questions: [{ ...questions[0], misconceptionTags: { 승정원: "기관 혼동" } }],
});
assert.deepEqual(noTagMatch.units[0].possibleConfusions, []);

// Revisions retain one item identity, but cannot claim recovery on edited content.
const revised = run([
  attempt("old", 100, [[1, false]], {
    questionMetadata: [{ ...questions[0], sourceRevision: "1" }],
  }),
  attempt(
    "new",
    200,
    [
      [1, true],
      [2, true],
      [3, true],
    ],
    {
      questionMetadata: questions
        .slice(0, 3)
        .map((q) => ({ ...q, sourceRevision: q.id === 1 ? "2" : "1" })),
    },
  ),
]);
assert.equal(revised.assessedQuestionCount, 3);
assert.equal(revised.contentChangedQuestionCount, 1);
assert.equal(
  revised.units[0].firstCorrectQuestions,
  3,
  "First comparison refers to the current content revision",
);
assert.equal(revised.units[0].repeatedAttempts, 1);

// A correct response after a hint stays distinct from independent reconfirmation.
const hinted = attempt("hint", 100, [
  [1, true],
  [2, true],
  [3, true],
]);
hinted.items[0].hintViewed = true;
const hintSummary = run([hinted]);
assert.equal(hintSummary.units[0].hintedQuestionCount, 1);
assert.equal(hintSummary.units[0].evidence, "recheck");

const limitedMetadata = run([
  attempt("limited", 100, [[1, false]], {
    questionMetadata: [
      { ...questions[0], concepts: [], metadataLimited: true },
    ],
  }),
]);
assert.equal(limitedMetadata.limitedMetadataQuestionCount, 1);
assert.equal(limitedMetadata.units[0].limitedMetadataQuestionCount, 1);
assert.equal(
  limitedMetadata.concepts.length,
  0,
  "Current bank must not silently fill intentionally limited historical metadata",
);

console.log("Assessment learning evidence: 15 regression scenarios passed.");
