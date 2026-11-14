import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import readXlsxFile from "read-excel-file/node";

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
const scoreHelpers = await load("src/lib/performanceScores.ts", {
  "firebase/firestore": {},
  "./firebase": {},
  "./semesterScope": {},
});
const {
  parseWrittenExamEssayScoreWorkbook: parse,
  parseWrittenExamFeedbackByItemKey,
} = await load("src/lib/writtenExamEssayScoreWorkbook.ts", {
  "./performanceScores": scoreHelpers,
  "./writtenExamFeedback": await load("src/lib/writtenExamFeedback.ts", {}),
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const criteria = [
  "‘임진왜란’으로 명확하게 식별되는 답안",
  "명의 참전으로 삼국이 참여하는 전쟁으로 확대되었다는 의미가 드러나면 인정함. ‘동아시아’, ‘국제전쟁’이라는 용어를 반드시 사용할 필요는 없음.",
  "당시 행정구역의 명칭인 ‘전라도’를 정확하게 제시한 답안",
  "신하 1과 신하 2를 지지하는 답안을 모두 인정함. 인물명은 ‘도쿠가와 이에야스’ 또는 ‘덕천가강’을 인정함. 정권 교체, 관계 정상화 요청, 전쟁 피해, 포로 송환 등 타당한 역사적 사실을 자신의 입장과 연결하면 인정함.",
];
const headers = [
  "학년",
  "반",
  "번호",
  "이름",
  "총점",
  ...criteria,
  "AI 채점 수준",
  "선생님 작성 피드백",
];
const feedback =
  "(1) 정답. 1점.\n\n(2) (1)에 적힌 답은 옮기지 않음. 명 참전만 인정하여 1점.\n\n(3) 미작성하여 0점.\n\n(4) 입장과 인물명만 인정하여 2/5점.";
const fixture = [
  ["3-1반 채점 결과"],
  ["평가: 2026학년도 2학기 3학년 2차 정기시험 역사과"],
  [],
  headers,
  [3, 1, 1, "학생가", 4, 1, 1, 0, 2, "비교적 관대하게 채점", feedback],
  [3, 1, 2, "학생나", 0, 0, 0, 0, 0, "비교적 관대하게 채점", "질병결"],
  [3, 1, 3, "학생다", 0, "-", "-", "-", "-", "-", "고사별 학적변동: 전출"],
];
const params = {
  fileName: "01반.xlsx",
  targetGrade: "3",
  fallbackClass: "1",
  maxScore: 20,
};
const result = parse(fixture, params);
assert.equal(result.title, "2026학년도 2학기 3학년 2차 정기시험 역사과");
assert.equal(result.headerRowNumber, 4);
assert.equal(
  result.totalMaxScore,
  10,
  "The known rubric overrides a stale total-only form default",
);
assert.deepEqual(
  plain(result.items.map(({ itemKey, maxScore }) => [itemKey, maxScore])),
  [
    ["1-(1)", 1],
    ["1-(2)", 3],
    ["1-(3)", 1],
    ["1-(4)", 5],
  ],
);
assert.equal(result.rows[0].feedback, feedback);
assert.equal(result.rows[0].evidence, feedback);
assert.deepEqual(
  plain(result.rows[0].items.map((item) => item.score)),
  [1, 1, 0, 2],
);
assert.equal(
  result.rows[0].items[1].feedback,
  "(1)에 적힌 답은 옮기지 않음. 명 참전만 인정하여 1점.",
);
assert.equal(
  result.rows[0].items[3].feedback,
  "입장과 인물명만 인정하여 2/5점.",
);
assert.equal(
  result.rows[1].enteredScoreCount,
  4,
  "A real zero remains an entered score",
);
assert.equal(result.rows[1].feedback, "질병결");
assert.equal(
  result.rows[2].enteredScoreCount,
  0,
  "Transfer dashes must not become entered zero scores",
);
assert.equal(
  result.rows[2].items.every((item) => !item.scoreEntered),
  true,
);
assert.equal(
  result.items.some((item) => item.name.includes("AI")),
  false,
);
assert.equal(
  parse(fixture, { ...params, title: "교사가 입력한 평가명" }).title,
  "교사가 입력한 평가명",
);

const replace = (rowIndex, columnIndex, value) => {
  const next = structuredClone(fixture);
  next[rowIndex][columnIndex] = value;
  return next;
};
assert.throws(
  () => parse(replace(3, 5, "다른 평가 기준"), params),
  /하위 문항 배점을 확인/,
);
assert.throws(
  () => parse(replace(4, 4, 5), params),
  /총점과 하위 문항 점수 합계/,
);
assert.throws(() => parse(replace(4, 5, 2), params), /배점 범위/);
assert.throws(() => parse(replace(4, 6, ""), params), /하위 문항 점수를 모두/);
assert.equal(
  parse([headers, [3, 1, 1, "학생가", 0, 0, 0, 0, 0, "", ""]], params)
    .totalMaxScore,
  10,
);

const split = parseWrittenExamFeedbackByItemKey(
  "전체 안내\n1-(1): 첫 사유\n1-(2): 두 번째 사유",
);
assert.deepEqual(plain(Array.from(split.entries())), [
  ["1-(1)", "첫 사유"],
  ["1-(2)", "두 번째 사유"],
]);
const numbered = parseWrittenExamFeedbackByItemKey(
  "(1) 첫 사유&#x20;\n\n(2) 문장 안 (1)은 인용임.\n(3) 세 번째.",
);
assert.equal(numbered.get("1-(1)"), "첫 사유");
assert.equal(numbered.get("1-(2)"), "문장 안 (1)은 인용임.");
assert.equal(numbered.size, 3);
assert.equal(
  parseWrittenExamFeedbackByItemKey("일반 사유에서 (1)을 언급함.").size,
  0,
);
const legacy = parse(
  [
    ["번호", "이름", "1-(1)", "1-(2)", "피드백"],
    [1, "학생가", 0, 3, "1-(1): 근거 확인"],
  ],
  params,
);
assert.equal(legacy.rows[0].items[0].scoreEntered, true);
assert.equal(legacy.rows[0].items[0].feedback, "근거 확인");
const totalOnly = parse(
  [
    ["번호", "이름", "총점", "교사 작성 피드백"],
    [1, "학생가", 7, "전체 사유"],
  ],
  params,
);
assert.equal(totalOnly.rows[0].items.length, 1);
assert.equal(totalOnly.rows[0].totalScore, 7);
assert.equal(totalOnly.rows[0].feedback, "전체 사유");
console.log(
  "PASS rubric export: stable 1/3/1/5 maxima, metadata title, item feedback, zero/dash distinction, validation and legacy formats",
);

// Exercise the actual upload gate and persistence filters. A transfer row may
// have no matching active student; its unentered scores must not block the class.
const managerSource = await readFile(
  "src/pages/teacher/components/PerformanceScoreManager.tsx",
  "utf8",
);
const managerAst = ts.createSourceFile(
  "manager.tsx",
  managerSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const findInitializer = (root, name) => {
  let initializer;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      assert.equal(initializer, undefined, `Duplicate variable: ${name}`);
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(initializer, `Missing upload variable: ${name}`);
  return initializer;
};
const saveParsedScores = findInitializer(managerAst, "saveParsedScores");
const evaluateFilter = (name, rows, isWrittenExamMode) =>
  vm.runInNewContext(
    findInitializer(saveParsedScores, name).getText(managerAst),
    { freshRows: rows, upload: { rows }, isWrittenExamMode },
  );
const matchedZero = {
  ...result.rows[1],
  uid: "matched-zero-student",
  matchStatus: "matched",
};
const unenteredTransfer = {
  ...result.rows[2],
  uid: "",
  matchStatus: "unmatched",
};
const mixedClass = [matchedZero, unenteredTransfer];
assert.equal(evaluateFilter("unresolved", mixedClass, true).length, 0);
assert.deepEqual(
  plain(evaluateFilter("uploadRows", mixedClass, true)),
  plain([matchedZero]),
);
for (const mismatch of [
  { uid: "", matchStatus: "unmatched" },
  { uid: "different-student", matchStatus: "name-mismatch" },
]) {
  const mismatchedZero = { ...matchedZero, ...mismatch };
  assert.deepEqual(
    plain(evaluateFilter("unresolved", [mismatchedZero], true)),
    plain([mismatchedZero]),
    "An entered zero must still require a matching student",
  );
  const mismatchedPositive = { ...result.rows[0], ...mismatch };
  assert.equal(
    evaluateFilter("unresolved", [mismatchedPositive], true).length,
    1,
  );
}
assert.equal(evaluateFilter("unresolved", mixedClass, false).length, 1);
assert.equal(evaluateFilter("uploadRows", mixedClass, false).length, 2);
console.log(
  "PASS upload gate: unentered transfer rows are excluded; entered zero and nonzero scores retain student matching checks",
);

const directoryFlag = process.argv.indexOf("--source-directory");
if (directoryFlag >= 0) {
  const directory = process.argv[directoryFlag + 1];
  assert.ok(directory, "--source-directory requires a directory");
  let rowsChecked = 0;
  let scoresChecked = 0;
  let missingScoreRows = 0;
  for (const classNumber of [1, 2, 3, 4, 5, 6, 7, 8, 10]) {
    const fileName = `${String(classNumber).padStart(2, "0")}반.xlsx`;
    const filePath = path.join(directory, fileName);
    const original = await readFile(filePath);
    const digest = createHash("sha256").update(original).digest("hex");
    const workbook = await readXlsxFile(original);
    const rows = Array.isArray(workbook[0]?.data) ? workbook[0].data : workbook;
    const actual = parse(rows, {
      ...params,
      fileName,
      fallbackClass: String(classNumber),
    });
    assert.equal(
      actual.title,
      String(rows[1][0]).replace(/^평가\s*[:：]\s*/, ""),
    );
    assert.deepEqual(
      plain(actual.items.map((item) => item.maxScore)),
      [1, 3, 1, 5],
    );
    assert.equal(actual.rows.length, classNumber === 4 ? 30 : 32);
    for (const row of actual.rows) {
      const source = rows[row.rowNumber - 1];
      const originalFeedback = String(source[10] ?? "").trim();
      assert.equal(row.feedback, originalFeedback);
      assert.equal(row.evidence, originalFeedback);
      assert.equal(
        row.totalScore,
        typeof source[4] === "number" ? source[4] : 0,
      );
      row.items.forEach((item, index) => {
        const sourceScore = source[5 + index];
        assert.equal(
          item.score,
          typeof sourceScore === "number" ? sourceScore : 0,
        );
        assert.equal(item.scoreEntered, typeof sourceScore === "number");
        assert.equal(item.maxScore, [1, 3, 1, 5][index]);
        scoresChecked++;
      });
      if (!row.enteredScoreCount) missingScoreRows++;
      rowsChecked++;
    }
    assert.equal(
      createHash("sha256")
        .update(await readFile(filePath))
        .digest("hex"),
      digest,
    );
    console.log(
      `PASS ${fileName}: ${actual.rows.length} rows, 4 subitems, source file unchanged`,
    );
  }
  assert.equal(rowsChecked, 286);
  assert.equal(missingScoreRows, 1);
  console.log(
    `PASS real files: ${rowsChecked} student rows, ${scoresChecked} subitem values, one unentered transfer row; files unchanged`,
  );
}
