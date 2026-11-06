import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/pages/teacher/components/mockExamAuthoring.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const {
  sortMockExamChoices,
  validateMockExamPlacement,
  mockExamQuestionSizeError,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const options = [
  "긴 선지입니다",
  "나",
  "가",
  "두 글자",
  "마지막으로 가장 긴 선지입니다",
];
const source = options.map((text, sourceIndex) => ({
  text,
  sourceIndex,
  image: sourceIndex === 0 ? "data:image/png;base64,aA==" : null,
}));
const sorted = sortMockExamChoices(source);
assert.deepEqual(
  sorted.map((item) => item.text),
  ["가", "나", "두 글자", "긴 선지입니다", "마지막으로 가장 긴 선지입니다"],
);
assert.deepEqual(
  source.map((item) => item.text),
  options,
  "sorting must not mutate the active edit form",
);
assert.equal(
  sorted[3],
  source[0],
  "option image and source index must move with the original object",
);
assert.equal(
  sorted.find((item) => item.sourceIndex === 0).text,
  "긴 선지입니다",
  "answer selection stays attached to authored text after reordering",
);
assert.equal(sorted[3].image, "data:image/png;base64,aA==");
assert.deepEqual(
  sortMockExamChoices([
    { text: "나", sourceIndex: 0 },
    { text: "가", sourceIndex: 1 },
  ]).map((q) => q.sourceIndex),
  [1, 0],
);

const valid = { examRound: "round_1", paperOrder: 1, points: 3.5 };
for (const value of [
  valid,
  { ...valid, examRound: "round_2", points: 0.01 },
  { ...valid, examRound: "round_3", paperOrder: 200, points: 99.99 },
  { ...valid, points: 100 },
])
  assert.equal(validateMockExamPlacement(value), "", JSON.stringify(value));
for (const change of [
  { examRound: "other_1" },
  { examRound: "round_4" },
  { examRound: undefined },
  { paperOrder: 0 },
  { paperOrder: 201 },
  { paperOrder: 1.5 },
  { paperOrder: true },
  { paperOrder: "2" },
  { points: 0 },
  { points: -1 },
  { points: 101 },
  { points: "4" },
  { points: NaN },
  { points: Infinity },
  { points: 3.333 },
])
  assert.notEqual(
    validateMockExamPlacement({ ...valid, ...change }),
    "",
    JSON.stringify(change),
  );

const question = {
  id: 1001,
  unitId: "exam_prep",
  category: "exam_prep",
  type: "choice",
  ...valid,
  question: "다음 설명으로 옳은 것은?",
  passage: "{{box:(가)}} 제시 자료",
  options: sorted.map((q) => q.text),
  answer: "긴 선지입니다",
  choiceOptionImages: sorted.map((q) => q.image),
  concepts: ["왕권 강화"],
  cognitiveProcess: "사료 해석",
  familyId: "family-1",
  derivedFromQuestionId: "previous-1",
  reviewLessonId: "lesson-1",
  misconceptionTags: { 가: "혼동 지점" },
};
assert.equal(mockExamQuestionSizeError(question), "");
assert.equal(
  mockExamQuestionSizeError({
    ...question,
    image: "https://example.invalid/approved-image.png",
  }),
  "",
);
assert.notEqual(
  mockExamQuestionSizeError({
    ...question,
    image: "data:image/png;base64," + "a".repeat(100000),
  }),
  "",
);
assert.notEqual(
  mockExamQuestionSizeError({
    ...question,
    passage: "한글 자료 ".repeat(10000),
  }),
  "",
  "capacity validation must count UTF-8 bytes",
);
assert.deepEqual(
  question.misconceptionTags,
  { 가: "혼동 지점" },
  "diagnostic tags remain keyed by answer text",
);
console.log(
  "Mock exam authoring: option order/answer/image identity, non-mutating edits, round/order/decimal-point validation and UTF-8 snapshot capacity passed.",
);
