import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Synthetic records; execute the same pure model used by browser and Functions.
const compiled = ts.transpileModule(
  readFileSync("src/lib/quizAnalysis.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { classifyQuizResponseBehavior: classify, buildQuizAnalysis } =
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
const questions = Array.from({ length: 10 }, (_, i) => ({
  id: String(i + 1),
  type: "choice",
  contentRevision: 1,
  unitId: "unit",
  category: "formative",
  options: ["가", "나", "다", "라"],
}));
const make = ({ fast = false, repeat = false, correct = false } = {}) => ({
  id: "attempt",
  source: "canonical",
  studentUid: "a",
  semesterId: "2026-2",
  unitId: "unit",
  category: "formative",
  submittedAt: 1000,
  scorePercent: 40,
  behaviorAnswersAvailable: true,
  items: questions.map((q, i) => ({
    questionId: q.id,
    sourceRevision: "1",
    answer: q.options[repeat ? 0 : i % 4],
    correct,
  })),
  analytics: {
    version: 1,
    quality: "complete",
    questions: Object.fromEntries(
      questions.map((q) => [
        q.id,
        {
          activeMs: fast ? 1000 : 40000,
          hiddenMs: 0,
          firstResponseMs: fast ? 500 : 20000,
          finalResponseMs: fast ? 800 : 30000,
          answerChangeCount: 0,
          revisitCount: 0,
          quality: "complete",
        },
      ]),
    ),
  },
});
let scenarios = 0;
const test = (name, action) => {
  action();
  scenarios++;
  console.log(`PASS ${name}`);
};
const check = (record, category, bank = questions) => {
  const before = structuredClone(record),
    result = classify(record, bank);
  assert.equal(result.category, category);
  assert.deepEqual(record, before);
  return result;
};
test("Rapid wrong answers and rapid repeated options are uncertain guessing signals", () => {
  const wrong = check(make({ fast: true }), "suspected_guessing");
  assert.equal(wrong.fastWrongCount, 10);
  assert.equal(wrong.fastAccuracy, 0);
  assert.equal(wrong.flags.repeated, false);
  assert.equal(wrong.medianActiveMs, 1000);
  check(
    make({ fast: true, repeat: true, correct: true }),
    "suspected_guessing",
  );
});
test("Fast accurate varied answers and low accuracy alone do not imply guessing", () => {
  assert.equal(
    check(make({ fast: true, correct: true }), "unflagged").flags.rapid,
    true,
  );
  check(make(), "unflagged");
});
test("Repeated choice is descriptive even without timing or with partial timing", () => {
  const slow = check(make({ repeat: true }), "repeated_choice");
  assert.deepEqual(slow.repeatedChoice, {
    label: "1번 보기",
    count: 10,
    total: 10,
    percent: 100,
  });
  for (const analytics of [
    null,
    { version: 2 },
    { ...make().analytics, quality: "partial" },
  ]) {
    const result = check(
      { ...make({ repeat: true }), analytics },
      "repeated_choice",
    );
    assert.equal(result.medianActiveMs, null);
    assert.equal(result.answerChangeCount, null);
    assert.equal(result.flags.rapid, false);
  }
});
test("Unknown, partial, malformed and resumed time never becomes normal timing", () => {
  for (const analytics of [
    undefined,
    null,
    [],
    {},
    { version: 2 },
    { ...make().analytics, quality: "partial" },
  ]) {
    check({ ...make({ fast: true }), analytics }, "insufficient");
  }
});
test("Timing validity rejects nonfinite, negative, reversed and absent fields", () => {
  for (const patch of [
    { activeMs: NaN },
    { activeMs: -1 },
    { hiddenMs: -1 },
    { activeMs: 21600001 },
    { firstResponseMs: null },
    { finalResponseMs: null },
    { firstResponseMs: 900, finalResponseMs: 500 },
    { finalResponseMs: 1001 },
    { answerChangeCount: 0.5 },
    { revisitCount: -1 },
    { hintViewed: "false" },
    { quality: "partial" },
  ]) {
    const record = make({ fast: true });
    Object.values(record.analytics.questions).forEach((q) =>
      Object.assign(q, patch),
    );
    check(record, "insufficient");
  }
});
test("Hidden time, hints, answer edits and revisits exclude rapid evidence", () => {
  for (const patch of [
    { hiddenMs: 1 },
    { hintViewed: true },
    { answerChangeCount: 1 },
    { revisitCount: 1 },
  ]) {
    const record = make({ fast: true });
    Object.values(record.analytics.questions).forEach((q) =>
      Object.assign(q, patch),
    );
    assert.equal(check(record, "unflagged").fastQuestionCount, 0);
  }
});
test("Current explicit revision and original answer availability are mandatory", () => {
  for (const sourceRevision of [undefined, "legacy", "2"]) {
    const record = make({ fast: true, repeat: true });
    record.items.forEach((item) => (item.sourceRevision = sourceRevision));
    check(record, "insufficient");
  }
  const record = make({ fast: true, repeat: true });
  check({ ...record, source: "legacy" }, "insufficient");
  check({ ...record, behaviorAnswersAvailable: false }, "insufficient");
  check(
    record,
    "insufficient",
    questions.map((q) => ({
      ...q,
      contentRevision: undefined,
      sourceRevision: "legacy",
    })),
  );
});
test("Blank, unavailable, duplicate option text and unmatched answers are not mapped", () => {
  for (const answer of [undefined, null, "", " ", "없는 보기"]) {
    const record = make();
    record.items.forEach((item) => (item.answer = answer));
    check(record, "insufficient");
  }
  check(
    make({ repeat: true }),
    "insufficient",
    questions.map((q) => ({ ...q, options: ["가", "가"] })),
  );
});
test("Duplicate item IDs cannot inflate the observed sample", () => {
  const record = make({ fast: true, repeat: true });
  record.items[9] = { ...record.items[0] };
  check(record, "insufficient");
});
test("At least five items, eighty percent observation and sixty percent rapid responses", () => {
  const record = make({ fast: true });
  check(record, "insufficient", questions.slice(0, 4));
  check(record, "suspected_guessing", questions.slice(0, 5));
  for (const key of ["9", "10"]) delete record.analytics.questions[key];
  assert.equal(check(record, "suspected_guessing").coveragePercent, 80);
  delete record.analytics.questions["8"];
  check(record, "insufficient");
  const mixed = make({ fast: true });
  for (let i = 7; i <= 10; i++)
    mixed.analytics.questions[i] = make().analytics.questions[i];
  check(mixed, "suspected_guessing");
  mixed.analytics.questions[6] = make().analytics.questions[6];
  check(mixed, "unflagged");
});
test("Three seconds is inclusive and both wrong-count and wrong-ratio boundaries apply", () => {
  const record = make({ fast: true, correct: true });
  Object.values(record.analytics.questions).forEach((q) => (q.activeMs = 3000));
  record.items.slice(0, 4).forEach((item) => (item.correct = false));
  check(record, "unflagged");
  record.items[4].correct = false;
  check(record, "suspected_guessing");
  Object.values(record.analytics.questions).forEach((q) => (q.activeMs = 3001));
  check(record, "unflagged");
  const five = make({ fast: true, correct: true });
  five.items.slice(0, 2).forEach((item) => (item.correct = false));
  check(five, "unflagged", questions.slice(0, 5));
  five.items[2].correct = false;
  check(five, "suspected_guessing", questions.slice(0, 5));
});
test("Repeat threshold needs five actual identical answers and eighty percent within type", () => {
  const record = make();
  record.items.slice(0, 8).forEach((item) => (item.answer = "가"));
  record.items[8].answer = "나";
  check(record, "repeated_choice");
  record.items[7].answer = "나";
  check(record, "unflagged");
  const six = make({ repeat: true });
  six.items[5].answer = "나";
  check(six, "repeated_choice", questions.slice(0, 6));
  six.items[4].answer = "나";
  check(six, "unflagged", questions.slice(0, 6));
});
test("OX and choice positions are never pooled and unsupported types are excluded", () => {
  const bank = questions.map((q, i) => ({
    ...q,
    type: i < 4 ? "choice" : i < 8 ? "ox" : "order",
  }));
  const record = make({ repeat: true });
  record.items.slice(4).forEach((item) => (item.answer = "O"));
  assert.equal(check(record, "unflagged", bank).flags.repeated, false);
  const ox = questions.map((q) => ({ ...q, type: "ox" }));
  record.items.forEach((item) => (item.answer = "X"));
  assert.equal(check(record, "repeated_choice", ox).repeatedChoice.label, "X");
});
test("Unknown revision answers reduce coverage rather than shrink the denominator", () => {
  const record = make({ fast: true, repeat: true });
  record.items.slice(0, 3).forEach((item) => (item.sourceRevision = "old"));
  const result = check(record, "insufficient");
  assert.equal(result.eligibleQuestionCount, 10);
  assert.equal(result.coveragePercent, 70);
});
const run = (records, extra = {}) =>
  buildQuizAnalysis({
    semesterId: "2026-2",
    scope: { classId: "3-1", unitIds: ["unit"], category: "formative" },
    students: [
      { uid: "a", classId: "3-1" },
      { uid: "b", classId: "3-2" },
    ],
    questions,
    records,
    ...extra,
  });
test("Latest single submission replaces old patterns and never pools attempts", () => {
  const old = make({ fast: true, repeat: true }),
    newer = { ...make(), id: "new", submittedAt: 2000 };
  assert.equal(run([old, newer]).students[0].behavior.category, "unflagged");
  old.items = old.items.slice(0, 5);
  newer.items = newer.items.slice(5, 9);
  assert.equal(run([old, newer]).students[0].behavior.category, "insufficient");
});
test("Ambiguous chronology and no attempt remain separate", () => {
  const first = make({ fast: true, repeat: true });
  assert.equal(
    run([first, { ...first, id: "tied" }]).students[0].behavior.category,
    "insufficient",
  );
  assert.equal(run([]).students[0].behavior.category, "no_attempt");
});
test("Semester, class, assessment, canonical identity and keyword boundaries remain enforced", () => {
  const record = make({ fast: true, repeat: true });
  for (const patch of [
    { semesterId: "2026-1" },
    { studentUid: "b" },
    { category: "diagnostic" },
  ]) {
    assert.equal(
      run([{ ...record, ...patch }]).students[0].behavior.category,
      "no_attempt",
    );
  }
  const canonical = { ...make(), legacyResultId: "mirror" };
  const mirror = {
    ...record,
    id: "mirror",
    source: "legacy",
    submittedAt: 2000,
  };
  assert.equal(
    run([canonical, mirror]).students[0].behavior.category,
    "unflagged",
  );
  assert.equal(
    run([record], { scope: { classId: "3-1", questionIds: ["1", "2"] } })
      .students[0].behavior.category,
    "insufficient",
  );
});
test("Classification is immutable and cannot change scores, item outcomes or rewards", () => {
  const fast = make({ fast: true, repeat: true }),
    slow = structuredClone(fast);
  slow.analytics = make().analytics;
  const first = run([fast]),
    second = run([slow]);
  assert.notEqual(
    first.students[0].behavior.category,
    second.students[0].behavior.category,
  );
  const grades = (result) => ({
    average: result.averageScore,
    histogram: result.scoreHistogram,
    questions: result.questions,
    student: [
      result.students[0].latestScore,
      result.students[0].correctCount,
      result.students[0].wrongCount,
      result.students[0].changes,
    ],
  });
  assert.deepEqual(grades(first), grades(second));
});
console.log(`quiz response behavior verified: ${scenarios} scenarios`);
