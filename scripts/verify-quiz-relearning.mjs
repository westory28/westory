import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function load(relative) {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
  );
}
const practice = await load("../src/pages/student/quiz/quizPracticeData.ts");
const history = await load("../src/pages/student/mypage/historyReviewData.ts");
const types = ["choice", "ox", "short", "word", "order", "matching"];
const questionSnapshots = types.map((type, index) => ({
  id: String(index),
  type,
  question: "당시 원문",
  answer: "정답",
}));
const source = {
  questionSnapshots,
  answerChecks: questionSnapshots.map((q) => ({ id: q.id, correct: false })),
  learningSnapshot: [
    { id: "0", concepts: ["통치 체제"], reviewLessonId: "lesson-1" },
  ],
};
const items = practice.buildQuizRelearningItems(source, { 0: "오답" });
assert.deepEqual(
  items.map((q) => q.type),
  types,
);
assert.deepEqual(items[0].concepts, ["통치 체제"]);
assert.equal(items[0].reviewLessonId, "lesson-1");
assert.equal(items[1].reviewLessonId, undefined);
assert.equal(items[0].submittedAnswer, "오답");
assert.equal(
  practice.buildQuizRelearningItems({ ...source, questionSnapshots: [] }, {})
    .length,
  0,
);
assert.equal(
  practice.buildQuizRelearningItems(
    {
      ...source,
      answerChecks: [
        { id: "0", correct: true },
        { id: "1", correct: false },
        { id: "1", correct: false },
        { id: "missing", correct: false },
      ],
    },
    {},
  ).length,
  1,
);
assert.equal(practice.isQuizPracticeAnswerCorrect("이 성 계", "이성계"), true);
assert.equal(practice.isQuizPracticeAnswerCorrect("", ""), false);
assert.equal(practice.isQuizPracticeAnswerCorrect("X", "O"), false);
const order = {
  ...items[0],
  type: "order",
  answer: "조선 건국||훈민정음 창제||임진왜란",
};
assert.equal(practice.getQuizPracticeOrderOptions(order).length, 3);
assert.equal(
  practice.isQuizPracticeAnswerCorrect(
    "조선 건국||훈민정음 창제||임진왜란",
    order.answer,
  ),
  true,
);
const matching = {
  ...items[0],
  type: "matching",
  answer: "태조=>조선 건국||세종=>훈민정음 창제",
  matchingPairs: [
    { left: "태조", right: "조선 건국" },
    {
      left: "세종",
      right: "훈민정음 창제",
      rightImage: "data:image/png;base64,fixture",
    },
  ],
};
assert.equal(
  practice.encodeQuizPracticeMatching(matching, {
    세종: "훈민정음 창제",
    태조: "조선 건국",
  }),
  matching.answer,
  "Selection order must not change canonical matching order",
);
assert.equal(
  practice.getQuizPracticePairs({ ...matching, matchingPairs: undefined })
    .length,
  2,
);
assert.equal(
  practice.getQuizPracticePairs(matching)[1].rightImage,
  "data:image/png;base64,fixture",
);
const missing = history.historyReviewQuestion(
  {
    id: "old",
    correct: false,
    questionSnapshot: { type: "word", question: "건국자는?", answer: "이성계" },
  },
  0,
);
assert.equal(missing.practiceAvailable, true);
assert.equal(missing.snapshot.submittedAnswerAvailable, false);
assert.equal(
  history.historyReviewQuestion({ id: "old", correct: false, u: "" }, 0)
    .practiceAvailable,
  false,
);
assert.equal(
  history.historyReviewQuestion(
    { id: "old", correct: false, u: "", q: "문제", a: "답", type: "short" },
    0,
  ).snapshot.submittedAnswerAvailable,
  true,
);
assert.equal(
  history.historyCategoryLabel("exam_prep", "round_2"),
  "모의고사 2회",
);
assert.equal(history.formatHistoryDate(null), "날짜 미보관");
console.log(
  "Student relearning: 21 snapshot, six-type, matching, history and missing-answer assertions passed.",
);
