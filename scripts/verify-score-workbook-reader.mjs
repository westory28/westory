import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import readXlsxFile from "read-excel-file/browser";

// Exercise the app's actual browser XLSX reader locally. Only DOM parsing is
// supplied by Node; no Firebase, network, or original-file write is involved.
globalThis.DOMParser = DOMParser;
const load = async (file, dependencies) => {
  const exports = {};
  const code = ts.transpileModule(await readFile(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    TextEncoder,
    Blob,
    Uint8Array,
    ArrayBuffer,
    require: (id) => {
      assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
      return dependencies[id];
    },
  });
  return exports;
};
const reader = await load("src/lib/scoreWorkbookReader.ts", {
  jszip: JSZip,
  "read-excel-file/browser": readXlsxFile,
});
const scores = await load("src/lib/performanceScores.ts", {
  "firebase/firestore": {},
  "./firebase": {},
  "./semesterScope": {},
});
const parser = await load("src/lib/writtenExamEssayScoreWorkbook.ts", {
  "./performanceScores": scores,
  "./writtenExamFeedback": await load("src/lib/writtenExamFeedback.ts", {}),
});
const { readWrittenExamScoreWorkbooks: readWorkbooks } = await load(
  "src/lib/writtenExamScoreWorkbooks.ts",
  {
    "./scoreWorkbookReader": reader,
    "./writtenExamEssayScoreWorkbook": parser,
    "read-excel-file/browser": readXlsxFile,
  },
);
const options = {
  targetGrade: "3",
  fallbackClass: "",
  subject: "역사",
  maxScore: 10,
};
const asFile = (bytes, name) =>
  new File([bytes], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
const fixture = (klass) => [
  [null, "반/번호", "학번", "번호", 1, 2, 3, 4, 5, "총점"],
  [null, null, null, "정답", 1, 2, 3, 4, 5],
  [null, null, null, "배점", 2, 2, 2, 2, 2],
  [
    null,
    `${klass}-1`,
    30000 + klass * 100 + 1,
    "합성학생",
    ".",
    2,
    "-",
    null,
    1,
    4,
  ],
];
const workbook = async (sheets) => {
  const book = new ExcelJS.Workbook();
  for (const [name, rows] of sheets) book.addWorksheet(name).addRows(rows);
  return book.xlsx.writeBuffer();
};
const changeDimension = async (bytes, ref, prefix = false) => {
  const zip = await JSZip.loadAsync(bytes);
  for (const name of Object.keys(zip.files).filter((name) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  )) {
    let xml = await zip.file(name).async("string");
    xml = xml.replace(
      /<dimension\b[^>]*\/>/,
      ref === null ? "" : `<dimension ref="${ref}"/>`,
    );
    if (prefix)
      xml = xml
        .replace(/<(\/?)([A-Za-z][\w.-]*)/g, "<$1x:$2")
        .replace(
          'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
          'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        );
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: "arraybuffer" });
};
const valid = await workbook([
  ["첫 시트", fixture(1)],
  ["둘째 시트", fixture(2)],
]);
assert.equal(
  await reader.normalizeScoreWorkbookNamespaces(valid),
  valid,
  "Valid dimensions preserve the original buffer",
);
const truncated = await changeDimension(valid, "A1");
assert.ok(
  (await readXlsxFile(truncated)).every((sheet) => sheet.data.length === 0),
  "Reproduce NEIS A1 truncation",
);
for (const [label, bytes] of [
  ["truncated", truncated],
  ["partial", await changeDimension(valid, "A1:E2")],
  ["invalid", await changeDimension(valid, "invalid")],
  ["missing", await changeDimension(valid, null)],
  ["prefixed", await changeDimension(valid, "A1", true)],
]) {
  const result = await readWorkbooks([asFile(bytes, `${label}.xlsx`)], options);
  assert.equal(result.rows.length, 2, `${label}: all sheets and students`);
  assert.equal(result.items.length, 5, `${label}: all questions`);
  assert.equal(result.rows[0].class, "1");
  assert.equal(result.rows[1].class, "2");
  assert.equal(result.rows[0].totalScore, 4);
  assert.equal(result.rows[0].items[0].answerCorrect, true);
  assert.equal(result.rows[0].items[2].answerStatus, "blank");
}
const normalized = await reader.normalizeScoreWorkbookNamespaces(truncated);
const before = await JSZip.loadAsync(truncated);
const after = await JSZip.loadAsync(normalized);
for (const name of Object.keys(before.files).filter(
  (name) => !before.files[name].dir,
)) {
  const original = await before.file(name).async("string");
  const expected = /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
    ? original.replace(/<dimension\b[^>]*\/>/, "")
    : original;
  assert.equal(
    await after.file(name).async("string"),
    expected,
    "Only inconsistent dimensions may change in the in-memory ZIP",
  );
}
const single = await workbook([["한 칸", [["유효한 한 칸"]]]]);
assert.equal(
  await reader.normalizeScoreWorkbookNamespaces(single),
  single,
  "A real single-cell sheet remains valid",
);
const third = await changeDimension(
  await workbook([["셋째 시트", fixture(3)]]),
  "A1",
);
assert.equal(
  (
    await readWorkbooks(
      [asFile(truncated, "첫 파일.xlsx"), asFile(third, "둘째 파일.xlsx")],
      options,
    )
  ).rows.length,
  3,
);
await assert.rejects(
  () =>
    readWorkbooks(
      [asFile(truncated, "첫 파일.xlsx"), asFile(truncated, "중복 파일.xlsx")],
      options,
    ),
  /중복/,
);
const empty = await workbook([["빈 시트", []]]);
await assert.rejects(
  () => readWorkbooks([asFile(empty, "빈 파일.xlsx")], options),
  /빈 파일.xlsx.*내용이 있는 점수표 시트가 없습니다/,
);
const legacy = await reader.readScoreWorkbookRows(
  asFile(truncated, "기존 단일 읽기.xlsx"),
);
assert.equal(legacy.length, 4);
assert.equal(legacy[3][3], "합성학생");
console.log(
  "PASS XLSX reader: truncated/partial/invalid/missing/prefixed dimensions, valid buffer preservation, unchanged cells/styles, all sheets/files, class-column offset, legacy reader, duplicate/empty errors",
);

// Explicit local paths only. Keep real workbooks and all student-level values
// out of repository fixtures, output, snapshots, and assertion diagnostics.
const localPaths = process.argv.slice(2);
if (localPaths.length) {
  const files = [];
  const fingerprints = [];
  let expectedStudents = 0;
  for (const filePath of localPaths) {
    const bytes = await readFile(filePath);
    fingerprints.push(createHash("sha256").update(bytes).digest("hex"));
    const file = asFile(bytes, path.basename(filePath));
    files.push(file);
    const parsed = await readWorkbooks([file], { ...options, maxScore: 100 });
    const independent = new ExcelJS.Workbook();
    await independent.xlsx.load(bytes);
    let sourceStudents = 0;
    for (const sheet of independent.worksheets) {
      sheet.eachRow((row) => {
        const values = row.values;
        if (
          values.some((value) =>
            /^\d+\s*[/／-]\s*\d+$/.test(String(value ?? "").trim()),
          )
        )
          sourceStudents++;
      });
    }
    assert.ok(
      sourceStudents === parsed.rows.length,
      "Actual source student count must match parsed count (personal data omitted)",
    );
    expectedStudents += sourceStudents;
    console.log(
      JSON.stringify({
        file: path.basename(filePath),
        students: parsed.rows.length,
        items: parsed.items.length,
      }),
    );
  }
  const merged = await readWorkbooks(files, { ...options, maxScore: 100 });
  assert.ok(
    merged.rows.length === expectedStudents,
    "All actual-file students must survive the combined upload (personal data omitted)",
  );
  for (let index = 0; index < localPaths.length; index++) {
    assert.ok(
      createHash("sha256")
        .update(await readFile(localPaths[index]))
        .digest("hex") === fingerprints[index],
      "Original workbook bytes must remain unchanged",
    );
  }
  console.log(
    JSON.stringify({
      files: files.length,
      mergedStudents: merged.rows.length,
      classes: merged.detectedClasses.length,
      items: merged.items.length,
      originalsUnchanged: true,
    }),
  );
}
