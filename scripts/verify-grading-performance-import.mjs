import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import readXlsxFile from "read-excel-file/node";

const load = (source, dependencies) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require: (name) => {
    assert.ok(name in dependencies, `Unexpected module: ${name}`);
    return dependencies[name];
  } });
  return exports;
};
const scores = load(await fs.readFile("src/lib/performanceScores.ts", "utf8"), {
  "firebase/firestore": {}, "./firebase": {}, "./semesterScope": {},
});
const parser = load(await fs.readFile("src/lib/performanceScoreWorkbook.ts", "utf8"), { "./performanceScores": scores });
const params = { fileName: "unrelated-name.xlsx", targetGrade: "3", fallbackClass: "" };
const criteria = [
  "고려 말 조선 초의 역사적 맥락 이해하기",
  "정몽주와 이방원의 입장과 가치관 비교하기",
  "선택한 입장을 유교적 통치 이념과 국가 운영 사례로 논증하기",
  "선택한 입장을 새로운 시조로 표현하기",
  "시조의 3장 구조와 4음보 적용하기",
  "시조의 표현 의도와 역사적 의미 설명하기",
];
const maximums = [6, 6, 6, 4, 4, 4];
const fixture = [
  ["3-1반 채점 결과"], ["평가: 하여가와 단심가 다시 쓰기(논술형)"], [],
  ["학년", "반", "번호", "이름", "총점", ...criteria, "AI 채점 수준", "선생님 작성 피드백"],
  [3, 1, 1, "가상학생", 30, ...maximums, 99, "1\\. 관점을 구분했습니다.\\n2\\. 근거를 보완해 주세요. 3\\. 표현을 다듬어 주세요."],
  [3, 1, 2, "가상학생둘", 0, 0, 0, 0, 0, 0, 0, 100, "1. 첫 기준입니다. 2. 둘째 기준입니다."],
  [3, 1, 3, "가상학생셋", null, null, null, null, null, null, null, 80, ""],
];
const parsed = parser.parsePerformanceScoreWorkbook(fixture, params);
assert.equal(parsed.format, "legacy");
assert.deepEqual(Array.from(parsed.inferredMaxScoreItemIndexes), [0, 1, 2, 3, 4, 5]);
assert.equal(parsed.title, "하여가와 단심가 다시 쓰기(논술형)");
assert.equal(parsed.subject, "역사");
assert.equal(parsed.headerRowNumber, 4);
assert.deepEqual(Array.from(parsed.items, (item) => item.name), criteria);
assert.deepEqual(Array.from(parsed.items, (item) => item.shortName), criteria);
assert.deepEqual(Array.from(parsed.items, (item) => item.maxScore), maximums);
assert.equal(parsed.totalMaxScore, 30);
assert.equal(parser.splitPerformanceScoreUpload(parsed).length, 1);
assert.equal(parsed.rows[0].feedback, "1. 관점을 구분했습니다.\n2. 근거를 보완해 주세요.\n3. 표현을 다듬어 주세요.");
assert.equal(parsed.rows[0].evidence, parsed.rows[0].feedback);
assert.equal(parsed.rows[1].totalScore, 0);
assert.ok(parsed.rows[1].items.every((item) => item.scoreEntered && item.score === 0));
assert.equal(parsed.rows[1].enteredScoreCount, 7);
assert.ok(parsed.rows[2].items.every((item) => !item.scoreEntered));
assert.equal(parsed.rows[2].enteredScoreCount, 0);
const renamed = parser.parsePerformanceScoreWorkbook(fixture, { ...params, fileName: "국어-다른평가-고조선.xlsx" });
assert.equal(renamed.title, parsed.title);
assert.equal(renamed.subject, "역사");
assert.equal(renamed.assessmentOrder, undefined);
const missingTitle = structuredClone(fixture); missingTitle[1] = [];
assert.equal(parser.parsePerformanceScoreWorkbook(missingTitle, params).title, "");

for (const label of ["평가명", "수행평가", "수행 평가명", "평가 제목", "수행평가제목", "Assessment", "Assessment Name", "Title"]) {
  for (const metadata of [[`${label}： 새 평가`], [label, null, "새 평가"]]) {
    const rows = structuredClone(fixture); rows[1] = metadata;
    assert.equal(parser.parsePerformanceScoreWorkbook(rows, params).title, "새 평가");
  }
}
for (const label of ["AI 채점 수준", "AI 평가 수준", "채점 수준", "평가 수준", "성취 수준", "AI 신뢰도", "채점 상태", "비고"]) {
  const rows = structuredClone(fixture); rows[3][11] = label;
  assert.equal(parser.parsePerformanceScoreWorkbook(rows, params).items.length, 6);
}
for (const totalLabel of ["총점", "합계", "총합", "계"]) {
  const rows = structuredClone(fixture); rows[3][4] = totalLabel;
  assert.equal(parser.parsePerformanceScoreWorkbook(rows, params).format, "legacy");
}
const declared = structuredClone(fixture);
declared[3][4] = "총점 (30점)";
maximums.forEach((maximum, index) => { declared[3][index + 5] = `${criteria[index]} (배점 ${maximum}점)`; });
declared[4][4] = 15; maximums.forEach((maximum, index) => { declared[4][index + 5] = maximum / 2; });
assert.deepEqual(Array.from(parser.parsePerformanceScoreWorkbook(declared, params).items, (item) => item.maxScore), maximums);
assert.deepEqual(Array.from(parser.parsePerformanceScoreWorkbook(declared, params).inferredMaxScoreItemIndexes), []);
const mixedMaxima = structuredClone(declared); mixedMaxima[3][5] = criteria[0];
assert.deepEqual(Array.from(parser.parsePerformanceScoreWorkbook(mixedMaxima, params).inferredMaxScoreItemIndexes), [0]);
for (const invalid of [-1, 7, "결시", Infinity]) {
  const rows = structuredClone(declared); rows[4][5] = invalid;
  assert.throws(() => parser.parsePerformanceScoreWorkbook(rows, params), /범위/);
}
for (const invalid of [-1, 31, "총점 없음"]) {
  const rows = structuredClone(declared); rows[4][4] = invalid;
  assert.throws(() => parser.parsePerformanceScoreWorkbook(rows, params), /총점/);
}
const allBlank = structuredClone(declared); allBlank.splice(4, 2);
assert.equal(parser.parsePerformanceScoreWorkbook(allBlank, params).items.length, 6);
assert.equal(parser.parsePerformanceScoreWorkbook(allBlank, params).totalMaxScore, 30);
const blankCriteria = [
  "가상 사림의 성장 과정 파악하기\n\n(6점)",
  "가상 붕당 정치의 전개 나타내기\n\n(6점)",
  "가상 관심사와 붕당 정치 연결하기\n\n(4점)",
  "가상 정치 흐름 전개도 구성하기\n\n(4점)",
];
const blankFixture = [
  ["3-1반 채점 결과"],
  ["평가: 가상 미채점 두 번째 평가"],
  [],
  [
    "학년",
    "반",
    "번호",
    "이름",
    "총점",
    ...blankCriteria,
    "AI 채점 수준",
    "선생님 작성 피드백",
  ],
  ...Array.from({ length: 32 }, (_, index) => [
    3,
    1,
    index + 1,
    `가상학생${index + 1}`,
    ...Array.from({ length: 5 }, (_, column) =>
      (index + column) % 2 ? "-" : null,
    ),
    "-",
    "",
  ]),
];
const blankParsed = parser.parsePerformanceScoreWorkbook(blankFixture, params);
assert.equal(blankParsed.title, "가상 미채점 두 번째 평가");
assert.equal(blankParsed.subject, "역사");
assert.equal(blankParsed.rows.length, 32);
assert.equal(blankParsed.items.length, 4);
assert.equal(blankParsed.totalMaxScore, 20);
assert.deepEqual(
  Array.from(blankParsed.items, (item) => item.maxScore),
  [6, 6, 4, 4],
);
assert.ok(
  blankParsed.rows.every(
    (row) =>
      row.enteredScoreCount === 0 &&
      row.items.every((item) => item.scoreEntered === false),
  ),
);
assert.equal(parser.splitPerformanceScoreUpload(blankParsed).length, 1);
const blankWithZero = structuredClone(blankFixture);
blankWithZero[4].splice(4, 5, 0, 0, 0, 0, 0);
const blankZeroParsed = parser.parsePerformanceScoreWorkbook(
  blankWithZero,
  params,
);
assert.equal(blankZeroParsed.rows[0].totalScore, 0);
assert.equal(blankZeroParsed.rows[0].enteredScoreCount, 5);
assert.ok(
  blankZeroParsed.rows[0].items.every(
    (item) => item.scoreEntered === true && item.score === 0,
  ),
);
assert.ok(
  blankZeroParsed.rows.slice(1).every((row) => row.enteredScoreCount === 0),
);
for (const invalid of ["결시", "6점", "--", "NaN"]) {
  for (const column of [4, 5]) {
    const rows = structuredClone(blankFixture);
    rows[4][column] = invalid;
    assert.throws(
      () => parser.parsePerformanceScoreWorkbook(rows, params),
      /범위|숫자/,
    );
  }
}
assert.throws(() => parser.parsePerformanceScoreWorkbook([...fixture, fixture[4]], params), /중복/);
const inconsistent = structuredClone(fixture); inconsistent[4][4] = 29;
assert.throws(() => parser.parsePerformanceScoreWorkbook(inconsistent, params), /합계/);
const partial = structuredClone(fixture); partial[4][4] = 25; partial[4][5] = null;
assert.equal(parser.parsePerformanceScoreWorkbook(partial, params).rows[0].totalScore, 25);
const calculated = structuredClone(fixture); calculated[4][4] = null;
assert.equal(parser.parsePerformanceScoreWorkbook(calculated, params).rows[0].totalScore, 30);
const calculatedOverMaximum = structuredClone(fixture);
calculatedOverMaximum[3][4] = "총점 (20점)"; calculatedOverMaximum[4][4] = null;
assert.throws(() => parser.parsePerformanceScoreWorkbook(calculatedOverMaximum, params), /총점.*범위/);
const calculatedWithinMaximum = structuredClone(declared);
calculatedWithinMaximum[3][4] = "총점 (20점)"; calculatedWithinMaximum[4][4] = null;
const validCalculated = parser.parsePerformanceScoreWorkbook(calculatedWithinMaximum, params);
assert.equal(validCalculated.rows[0].totalScore, 15);
assert.equal(validCalculated.totalMaxScore, 20);
assert.equal(validCalculated.items.reduce((sum, item) => sum + item.maxScore, 0), 30);
const tooMany = fixture.slice(0, 4).concat(Array.from({ length: 401 }, (_, i) => [3, 1, i + 1, "가상학생", 0, 0, 0, 0, 0, 0, 0]));
assert.throws(() => parser.parsePerformanceScoreWorkbook(tooMany, params), /400명/);

const normalize = parser.normalizePerformanceScoreFeedback;
assert.equal(normalize("1₩. 첫 기준입니다. 2￦. 둘째 기준입니다."), "1. 첫 기준입니다.\n2. 둘째 기준입니다.");
assert.equal(normalize("1. 2.5점의 근거입니다. 2. 날짜 2026. 10. 7.을 확인합니다."), "1. 2.5점의 근거입니다.\n2. 날짜 2026. 10. 7.을 확인합니다.");
assert.equal(normalize("2026. 1. 2. 날짜와 3.14 수치를 보존합니다."), "2026. 1. 2. 날짜와 3.14 수치를 보존합니다.");
assert.equal(normalize(String.raw`자료 C:\new\notes.txt 경로를 보존합니다.`), String.raw`자료 C:\new\notes.txt 경로를 보존합니다.`);
assert.equal(normalize("첫 문장.\\n다음 문장.\r\n마지막 문장."), "첫 문장.\n다음 문장.\n마지막 문장.");
assert.equal(normalize(normalize(fixture[4][12])), normalize(fixture[4][12]));

const neis = parser.parsePerformanceScoreWorkbook([
  ["학과", "반", "번호", "성명", "다른 수행평가"],
  [null, null, null, null, "만점(20)"], [null, null, null, null, "점수"],
  ["일반", 1, 1, "가상학생", 0],
], { ...params, fileName: "2026학년도 2학기 3학년 국어_전체.xlsx" });
assert.equal(neis.subject, "역사");
assert.equal(neis.format, "neis");
assert.equal(neis.inferredMaxScoreItemIndexes, undefined);
assert.equal(neis.academicYear, "2026");
assert.equal(neis.title, "다른 수행평가");
assert.equal(neis.rows[0].items[0].scoreEntered, true);

// The optional real workbook is read only. Never print student names, values,
// feedback, parsed rows or error objects that might contain their contents.
if (process.argv[2]) {
  let success = false;
  try {
    const raw = await readXlsxFile(process.argv[2]);
    const rows = raw[0]?.data || raw;
    const real = parser.parsePerformanceScoreWorkbook(rows, params);
    success = real.rows.length === 32 && real.items.length === 6 && real.totalMaxScore === 30
      && real.title === "하여가와 단심가 다시 쓰기(논술형)" && real.subject === "역사"
      && real.items.every((item, i) => item.name === criteria[i] && item.shortName === criteria[i] && item.maxScore === maximums[i])
      && parser.splitPerformanceScoreUpload(real).length === 1
      && real.rows.every((row) => row.totalScore === row.items.reduce((sum, item) => sum + item.score, 0))
      && real.rows.every((row) => row.feedback === row.evidence && !/(?:^|\s)\d{1,2}[\\₩￦]+\./.test(row.feedback));
  } catch {
    // Do not expose workbook contents in a failing assertion or stack trace.
  }
  assert.ok(success, "Attached workbook aggregate contract failed; personal data omitted.");
  console.log("Attached workbook: 32 students, one assessment, six criteria, 30-point maximum and feedback normalization verified; personal data omitted.");
}
if (process.argv[3] || process.env.SCORE_QA_BLANK_REFERENCE_XLSX) {
  let success = false;
  try {
    const raw = await readXlsxFile(
      process.argv[3] || process.env.SCORE_QA_BLANK_REFERENCE_XLSX,
    );
    const real = parser.parsePerformanceScoreWorkbook(
      raw[0]?.data || raw,
      params,
    );
    success =
      real.rows.length === 32 &&
      real.items.length === 4 &&
      real.totalMaxScore === 20 &&
      real.subject === "역사" &&
      Boolean(real.title) &&
      real.items.every(
        (item, index) => item.maxScore === [6, 6, 4, 4][index],
      ) &&
      real.rows.every(
        (row) =>
          row.enteredScoreCount === 0 &&
          row.items.every((item) => item.scoreEntered === false),
      ) &&
      parser.splitPerformanceScoreUpload(real).length === 1;
  } catch {
    // Do not expose real workbook rows or their contents in failure output.
  }
  assert.ok(
    success,
    "Attached blank workbook aggregate contract failed; personal data omitted.",
  );
  console.log(
    "Attached blank workbook: 32 students, one assessment, four declared criteria, 20-point maximum and no entered scores verified; personal data omitted.",
  );
}
console.log("Grading workbook metadata, one-assessment criteria, fixed subject, zero/blank/range handling, feedback and NEIS compatibility passed.");
