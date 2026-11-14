import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const load = async (file, dependencies) => {
  const exports = {};
  const code = ts.transpileModule(await readFile(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    TextEncoder,
    require: (id) => {
      assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
      return dependencies[id];
    },
  });
  return exports;
};
const score = await load("src/lib/performanceScores.ts", {
  "firebase/firestore": {},
  "./firebase": {},
  "./semesterScope": {},
});
const parser = await load("src/lib/writtenExamEssayScoreWorkbook.ts", {
  "./performanceScores": score,
});
const { mergeWrittenExamScoreSheets: merge } = await load(
  "src/lib/writtenExamScoreWorkbooks.ts",
  {
    "./scoreWorkbookReader": {},
    "./writtenExamEssayScoreWorkbook": parser,
  },
);
const options = {
  targetGrade: "3",
  fallbackClass: "9",
  subject: "역사",
  maxScore: 10,
};
const objective = (klass, number = 1) => [
  ["반/번호", "학번", "성명", 1, 2, 3, 4, 5, "총점"],
  ["정답", "", "", 1, 2, 3, 4, 5],
  ["배점", "", "", 2, 2, 2, 2, 2],
  [
    `${klass}-${number}`,
    `3${klass}${number}`,
    "가상학생",
    ".",
    "2",
    "",
    "-",
    "1",
    4,
  ],
];
const source = (fileName, sheetName, rows) => ({ fileName, sheetName, rows });
const a = source("한 학급.xlsx", "1반", objective(1));
const b = source("다른 학급.xlsx", "2반", objective(2));
const c = source("다른 학급.xlsx", "3반", objective(3));
const result = merge([a, b, c], options);
assert.equal(result.rows.length, 3);
assert.equal(new Set(result.rows.map((row) => row.rowKey)).size, 3);
assert.equal(result.detectedClasses.join(","), "1,2,3");
assert.equal(result.rows[0].items[0].score, 2);
assert.equal(result.rows[0].items[2].score, 0);
assert.equal(result.rows[0].items[2].answerStatus, "blank");
assert.equal(result.rows[0].items[4].answerStatus, "incorrect");
assert.match(result.sourceFileName, /한 학급.xlsx, 다른 학급.xlsx/);
assert.throws(
  () => merge([a, { ...a, fileName: "중복.xlsx" }], options),
  /중복.xlsx.*1반.*중복/,
);
const conflicting = structuredClone(b);
conflicting.rows[1][3] = 5;
assert.throws(
  () => merge([a, conflicting], options),
  /다른 학급.xlsx.*2반.*문항번호·정답·배점/,
);
conflicting.rows[1][3] = 1;
conflicting.rows[2][3] = 3;
assert.throws(() => merge([a, conflicting], options), /문항번호·정답·배점/);
assert.throws(
  () =>
    merge(
      [a, source("오류.xlsx", "읽어야 하는 시트", [["알 수 없는 자료"]])],
      options,
    ),
  /오류.xlsx.*읽어야 하는 시트/,
);
assert.throws(() => merge([], options), /내용이 있는/);

const essay = (klass, score) => [
  ["학년", "반", "번호", "이름", "총점"],
  [3, klass, 1, "가상학생", score],
];
const zero = merge(
  [
    source("0점.xlsx", "1반", essay(1, 0)),
    source("미입력.xlsx", "2반", essay(2, "-")),
  ],
  options,
);
assert.equal(zero.rows[0].items[0].scoreEntered, true);
assert.equal(zero.rows[0].items[0].score, 0);
assert.equal(zero.rows[1].items[0].scoreEntered, false);
assert.throws(
  () => merge([a, source("논술형.xlsx", "1반", essay(2, 3))], options),
  /논술형 평가 항목이 다릅니다/,
);
const wrongGrade = essay(1, 3);
wrongGrade[1][0] = 2;
assert.throws(
  () => merge([source("다른학년.xlsx", "1반", wrongGrade)], options),
  /대상 학년과 다릅니다/,
);
const titled = (title, klass) => [[`평가: ${title}`], ...essay(klass, 3)];
assert.throws(
  () =>
    merge(
      [
        source("1.xlsx", "1반", titled("1차시험", 1)),
        source("2.xlsx", "2반", titled("2차시험", 2)),
      ],
      options,
    ),
  /평가명이 다릅니다/,
);
const noClass = [
  ["번호", "이름", "총점"],
  [1, "가상학생", 3],
];
assert.equal(
  merge([source("파일.xlsx", "4반", noClass)], options).rows[0].class,
  "4",
);
assert.equal(
  merge([source("05반.xlsx", "Sheet1", noClass)], options).rows[0].class,
  "5",
);
assert.equal(
  merge([source("설명6반.xlsx", "메모7반", noClass)], options).rows[0].class,
  "9",
);
const many = [
  essay(1, 3)[0],
  ...Array.from({ length: 401 }, (_, i) => [3, 1, i + 1, `가상${i + 1}`, 3]),
];
assert.equal(
  merge([source("전체.xlsx", "1반", many)], options).rows.length,
  401,
);
assert.equal(
  parser.parseWrittenExamEssayScoreWorkbook(many, {
    ...options,
    fileName: "전체.xlsx",
  }).rows.length,
  400,
  "Existing callers retain their default limit",
);
console.log(
  "PASS multi-file score workbooks: all sheets, identity conflicts, question/points conflicts, contextual errors, explicit titles, class fallback, zero/blank, 401 rows without truncation",
);
