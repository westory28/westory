import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
const source = await readFile("src/lib/writtenExamAnalysisImport.ts", "utf8");
const exports = {};
vm.runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText,
  { exports },
);
const {
  parseWrittenExamQuestionInfo: parseInfo,
  parseWrittenExamResponses: parseResponses,
  buildWrittenExamAnalysisDataset: build,
} = exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const info = parseInfo([
  ["가상 정기시험 문항정보표"],
  [],
  [
    "문항번호",
    "정답",
    "배점",
    "성취기준",
    "목표 성취수준",
    "난이도",
    "핵심개념",
    "수업자료ID",
  ],
  [1, "①", 2, "[9역11-01] 조선의 성립", "C", "하", "조선, 건국", "lesson-1"],
  [2, "②", 3, "9역11-02", "B", "상", "사림", "lesson-2"],
  [3, 3, 2, "9역11-03", "A", "중", "문화", "lesson-3"],
  [4, 4, 1, "9역11-04", "D", "쉬움", "왜란", "lesson-4"],
  [5, 5, 2, "9역11-04", "E", "hard", "호란", "lesson-5"],
]);
assert.equal(info.questions.length, 5);
assert.deepEqual(plain(info.questions[0].achievementStandardCodes), [
  "9역11-01",
]);
assert.equal(info.questions[0].targetAchievementLevel, "C");
assert.equal(info.questions[0].intendedDifficulty, "easy");
assert.equal(info.questions[1].intendedDifficulty, "hard");
assert.equal(info.questions[0].reviewLessonId, "lesson-1");
assert.throws(
  () =>
    parseInfo([
      ["문항번호", "정답", "배점"],
      [1, 1, 1],
      [3, 3, 1],
    ]),
  /2번/,
);
assert.throws(
  () =>
    parseInfo([
      ["문항번호", "정답", "배점"],
      [1, 1, 1],
      [1, 2, 1],
    ]),
  /중복/,
);
assert.throws(
  () =>
    parseInfo([
      ["문항번호", "정답", "배점"],
      [1, 1, 0],
    ]),
  /배점/,
);
const options = {
  targetGrade: "3",
  fallbackClass: "1",
  questions: info.questions,
};
const neis = parseResponses(
  [
    ["반/번호", "학번", "성명", 1, 2, 3, 4, 5, "총점"],
    ["정답", "", "", 1, 2, 3, 4, 5],
    ["배점", "", "", 2, 3, 2, 1, 2],
    ["1/1", "30101", "동명이름", ".", 1, "-", 4, 5, 5],
    ["2/1", "30201", "동명이름", "", "", "", "", "", 0],
  ],
  options,
);
assert.equal(neis.students.length, 2);
assert.equal(neis.students[0].totalScore, 5);
assert.equal(neis.students[1].totalScore, 0);
assert.equal(neis.students[0].responses[0].answer, "1");
assert.equal(neis.students[0].responses[2].answer, "");
assert.notEqual(
  neis.students[0].key,
  neis.students[1].key,
  "Names must never join students",
);
const ordinary = [
  ["학년", "반", "번호", "이름", "1번", "2번", "3번", "4번", "5번", "총점"],
  [3, 1, 1, "가상학생", "O", "X", "", "0", "5", 87],
];
const ordinaryParsed = parseResponses(ordinary, options);
assert.equal(ordinaryParsed.students[0].responses[1].answer, null);
assert.equal(ordinaryParsed.students[0].responses[2].answer, "");
assert.equal(ordinaryParsed.students[0].totalScore, 4);
assert.equal(ordinaryParsed.students[0].recordedTotalScore, 87);
assert.ok(
  ordinaryParsed.warnings.some((message) => message.includes("원본 총점")),
);
assert.throws(
  () => parseResponses([ordinary[0], ordinary[1], ordinary[1]], options),
  /중복/,
);
assert.throws(
  () =>
    parseResponses([ordinary[0], [3, "", 1, "가상학생", 1, 2, 3, 4, 5]], {
      ...options,
      fallbackClass: "",
    }),
  /학년·반·번호/,
);
assert.throws(
  () =>
    parseResponses(
      [ordinary[0], [2, 1, 1, "가상학생", 1, 2, 3, 4, 5]],
      options,
    ),
  /학년/,
);
assert.throws(
  () =>
    parseResponses(
      [
        [...ordinary[0], "선택형 소계"],
        [...ordinary[1], 9],
      ],
      options,
    ),
  /선택형 총점/,
);
const many = parseResponses(
  [
    ordinary[0],
    ...Array.from({ length: 480 }, (_, index) => [
      3,
      1 + Math.floor(index / 40),
      1 + (index % 40),
      `합성학생${index}`,
      1,
      2,
      3,
      4,
      5,
      10,
    ]),
  ],
  options,
);
assert.equal(
  many.students.length,
  480,
  "Complete analysis must not inherit the old import's 400-row truncation",
);
const dataset = build({
  examId: "exam-fixture",
  title: "가상 정기시험",
  semesterId: "2026-2",
  importedAt: "2026-11-14T00:00:00Z",
  questions: info.questions,
  students: ordinaryParsed.students,
});
assert.equal(dataset.records[0].behaviorAnswersAvailable, false);
assert.equal(dataset.records[0].scorePercent, 40);
assert.equal(dataset.records[0].examRound, "round_4");
assert.equal(dataset.achievementRecords[0].raw.details[1].answer, null);
assert.equal(dataset.achievementRecords[0].raw.cutScoreQuestions.length, 5);
assert.equal(dataset.achievementRecords[0].raw.maxPoints, 10);
assert.equal(
  dataset.questions[0].sourceRevision,
  dataset.records[0].items[0].sourceRevision,
);
console.log(
  "PASS written exam import: metadata, NEIS/ordinary answers, zero/unknown, identity, total scopes, 480 complete rows, immutable analysis adapters",
);
