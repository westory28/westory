import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as excelBrowser from "write-excel-file/browser";
import { unzipSync, strFromU8 } from "fflate";

const read = (path) => readFileSync(path, "utf8");
const evaluate = (source, dependencies = {}) => {
  const exports = {};
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  new Function("exports", "require", outputText)(exports, (name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  });
  return exports;
};
const extract = (path, names) => {
  const source = read(path);
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declarations = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      names.includes(node.name.text)
    ) {
      declarations.set(node.name.text, `const ${node.getText(file)};`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  names.forEach((name) => assert.ok(declarations.has(name), `Missing ${name}`));
  return `${names.map((name) => declarations.get(name)).join("\n")}\nexport { ${names.join(", ")} };`;
};

const rounds = evaluate(read("src/lib/mockExamRounds.ts"));
for (const [input, expected] of [
  [" ROUND_2 ", "round_2"],
  ["4회", "round_4"],
  ["round_0", "round_1"],
  ["bad", "round_1"],
  [null, "round_1"],
]) {
  assert.equal(rounds.normalizeMockExamRound(input), expected);
}
assert.equal(
  rounds.getMockExamRoundFromCategory("exam_prep__round_3"),
  "round_3",
);
assert.equal(
  rounds.getMockExamResultCategory("exam_prep", "round_2"),
  "exam_prep__round_2",
);

const { normalizeSchoolOptions } = evaluate(
  extract("src/lib/assessmentConfig.ts", [
    "normalizeSchoolToken",
    "compareSchoolTokens",
    "formatGradeLabel",
    "formatClassLabel",
    "normalizeSchoolOptions",
  ]),
);
assert.deepEqual(normalizeSchoolOptions(undefined, "grade"), [
  { value: "1", label: "1학년" },
  { value: "2", label: "2학년" },
  { value: "3", label: "3학년" },
]);
assert.equal(normalizeSchoolOptions([], "class").length, 12);
assert.deepEqual(
  normalizeSchoolOptions(
    [{ label: "2학년" }, { value: "1", label: "첫 학년" }, { value: "2" }],
    "grade",
  ),
  [
    { value: "1", label: "첫 학년" },
    { value: "2", label: "2학년" },
  ],
);

const markup = evaluate(read("src/lib/quizPassageMarkup.ts"));
assert.equal(
  markup.stripQuizPassageMarkup(
    "{{bullet}}첫째\n{{bullet}}둘째 {{u:강조}} {{blank:정답}} {{box:상자}}",
  ),
  "첫째\n둘째 강조 ____ 상자",
);
assert.equal(
  markup.stripQuizPassageMarkup("{{bullet:옛 목록}}\r\n{{bullet}}새 목록"),
  "옛 목록\r\n새 목록",
);
assert.equal(markup.stripQuizPassageMarkup(null), "");

const { cloneMapResourceBlanks } = evaluate(
  extract("src/pages/teacher/ManageHistoryClassroom.tsx", [
    "cloneMapResourceBlanks",
  ]),
);
const blanks = cloneMapResourceBlanks({
  pdfBlanks: [
    { id: "manual", answer: " 수동 ", page: 2, source: "manual" },
    { id: "ocr", answer: " 자동 ", page: 1, source: "ocr" },
    { id: "empty", answer: " ", page: 1 },
  ],
});
assert.equal(blanks.length, 2);
assert.equal(blanks[0].source, "ocr");
assert.equal(blanks[1].source, "manual");
assert.equal(blanks[1].answer, "수동");
assert.equal(blanks[0].width, 1);
assert.equal(cloneMapResourceBlanks(null).length, 0);

// Exercise the installed browser writer and the actual download handler.
// Read the generated archive to ensure the download contains the intended sheet.
let downloadedBlob;
let downloadedName;
const originalDocument = globalThis.document;
globalThis.document = {
  body: { appendChild() {}, removeChild() {} },
  createElement: (tag) => {
    assert.equal(tag, "a");
    return {
      style: {},
      click() {
        downloadedName = this.download;
        downloadedBlob = fetch(this.href).then((response) =>
          response.arrayBuffer(),
        );
      },
    };
  },
};
try {
  const { handleDownloadExcelTemplate } = evaluate(
    extract("src/pages/teacher/ManageHistoryDictionary.tsx", [
      "EXCEL_TEMPLATE_HEADERS",
      "handleDownloadExcelTemplate",
    ]),
    { "write-excel-file/browser": excelBrowser },
  );
  await handleDownloadExcelTemplate();
  assert.equal(downloadedName, "westory_history_dictionary_template.xlsx");
  const archive = unzipSync(new Uint8Array(await downloadedBlob));
  assert.match(strFromU8(archive["xl/workbook.xml"]), /역사 사전 업로드/);
  const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  const strings = Object.entries(archive)
    .filter(([name]) => /sheet1.xml|sharedStrings.xml/.test(name))
    .map(([, data]) => strFromU8(data))
    .join("\n");
  assert.match(strings, /임진왜란/);
  assert.match(strings, /학생용 풀이/);
  assert.match(sheet, /width="54"/);
  // Let the browser writer finish its object URL and anchor cleanup.
  await new Promise((resolve) => setTimeout(resolve, 120));
} finally {
  globalThis.document = originalDocument;
}

console.log(
  "Type contract regressions passed: school options, mock rounds, passage markup, map blanks, dictionary Excel download.",
);
