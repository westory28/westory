import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import ExcelJS from "exceljs";
import readXlsxFile from "read-excel-file/node";
import JSZip from "jszip";

const load = (source, dependencies, globals = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText, { exports, require: (name) => {
    assert.ok(name in dependencies, `Unexpected module ${name}`);
    return dependencies[name];
  }, TextEncoder, Blob, Uint8Array, ArrayBuffer, Date, console, ...globals });
  return exports;
};
const scores = load(await fs.readFile("src/lib/performanceScores.ts", "utf8"), {
  "firebase/firestore": {}, "./firebase": {}, "./semesterScope": {},
});
const parser = load(await fs.readFile("src/lib/performanceScoreWorkbook.ts", "utf8"), { "./performanceScores": scores });
const reader = load(await fs.readFile("src/lib/scoreWorkbookReader.ts", "utf8"), { jszip: JSZip });
const fixture = [
  ["학과", "반", "번호", "성명", "새 학기 역사 탐구", "역사 자료 해석"],
  [null, null, null, null, "만점(25)", "만점(35)"],
  [null, null, null, null, "점수", "점수"],
  ["일반", 1, 1, "검증학생", 17, 29],
  ["일반", 1, 2, "확인학생", 0, null],
];
const params = { fileName: "수행평가 파일일괄등록 - 2026학년도 2학기 주간 3학년 역사_전체_1강의실.xlsx", targetGrade: "2", fallbackClass: "" };
const parsed = parser.parsePerformanceScoreWorkbook(fixture, params);
assert.equal(parsed.format, "neis");
assert.equal(parsed.rows[0].grade, "3");
assert.equal(parsed.subject, "역사");
assert.equal(parsed.academicYear, "2026");
assert.equal(parsed.semester, "2");
assert.equal(parsed.items[0].maxScore, 25, "Declared max, not observed student maximum");
assert.equal(parsed.rows[1].items[0].scoreEntered, true, "Zero is entered");
assert.equal(parsed.rows[1].items[1].scoreEntered, false, "Blank remains unentered");
const split = parser.splitPerformanceScoreUpload(parsed);
assert.equal(split.length, 2);
assert.equal(split[1].title, "역사 자료 해석");
assert.equal(split[1].rows[0].totalScore, 29);
assert.equal(split[1].rows[1].enteredScoreCount, 0);
for (const invalid of [-1, 26, "결시"]) {
  const rows = structuredClone(fixture); rows[3][4] = invalid;
  assert.throws(() => parser.parsePerformanceScoreWorkbook(rows, params));
}
assert.throws(() => parser.parsePerformanceScoreWorkbook([...fixture, fixture[3]], params), /중복/);
const allBlank = structuredClone(fixture); allBlank[3][4] = null; allBlank[3][5] = null;
assert.equal(parser.parsePerformanceScoreWorkbook(allBlank, params).items[1].maxScore, 35);
if (process.argv[2]) {
  const input = await fs.readFile(process.argv[2]);
  const normalized = await reader.normalizeScoreWorkbookNamespaces(input);
  const result = await readXlsxFile(Buffer.from(normalized));
  const fileRows = result[0]?.data || result;
  const attached = parser.parsePerformanceScoreWorkbook(fileRows, { ...params, fileName: process.argv[2].split(/[\\/]/).at(-1) });
  assert.equal(attached.rows.length, 32);
  assert.equal(attached.items.length, 2);
  assert.equal(attached.items[0].maxScore, 20);
  assert.equal(attached.items[1].maxScore, 30);
  assert.equal(attached.rows[0].grade, "3");
  console.log("Attached NEIS workbook: 32 rows, 2 assessments, explicit maxima verified (personal data omitted).");
}

const stamp = (seconds, nanoseconds = 0) => ({ seconds, nanoseconds });
const record = { uid: "qa", rosterId: "r1", updatedAt: stamp(100, 2) };
const signature = { uid: "qa", rosterId: "r1", signatureName: "검증", signatureImage: "data:image/png;base64,qa", scoreUpdatedAt: stamp(100, 2), confirmedAt: stamp(101) };
assert.ok(scores.applyPerformanceScoreConfirmation(record, signature).signatureImage);
assert.equal(scores.applyPerformanceScoreConfirmation({ ...record, updatedAt: stamp(100, 3) }, signature).signatureImage, undefined);
assert.equal(scores.applyPerformanceScoreConfirmation(record, { ...signature, uid: "other" }).signatureImage, undefined);
assert.equal(scores.applyPerformanceScoreConfirmation(record, { ...signature, scoreUpdatedAt: undefined, confirmedAt: stamp(99) }).signatureImage, undefined);

const failedConfirmationRead = load(await fs.readFile("src/lib/performanceScores.ts", "utf8"), {
  "firebase/firestore": { doc: () => ({}), getDoc: async () => { throw new Error("signature-read-unavailable"); } },
  "./firebase": { db: {} }, "./semesterScope": {},
}, { console: { ...console, warn: () => {} } });
await assert.rejects(
  failedConfirmationRead.loadPerformanceScoreConfirmation("qa", "r1", { throwOnError: true }),
  /signature-read-unavailable/,
  "Export must not treat an unreadable signature as unsigned",
);

const source = await fs.readFile("src/pages/teacher/components/PerformanceScoreManager.tsx", "utf8");
assert.ok(!source.includes("UPLOAD_ASSESSMENT_OPTIONS"));
assert.ok(!source.includes("10.182.***.93"));
const file = ts.createSourceFile("manager.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const dependencies = {};
for (const node of file.statements) if (ts.isImportDeclaration(node)) dependencies[node.moduleSpecifier.text] = {};
dependencies["../../../lib/performanceScores"] = scores;
dependencies["exceljs"] = ExcelJS;
const manager = load((source + "\nexport { buildClassSummaryWorkbookFromTemplate };\n").replaceAll("import.meta.env.BASE_URL", '"/"'), dependencies, {
  fetch: async () => new Response(await fs.readFile("public/templates/performance-score-class-sheet-template.xlsx")),
});
const firstRoster = { title: "새 학기 역사 탐구", totalMaxScore: 25, items: [{ ratio: 25 }], id: "first" };
const secondRoster = { title: "역사 자료 해석", totalMaxScore: 35, items: [{ ratio: 35 }], id: "second" };
const students = Array.from({ length: 32 }, (_, i) => ({
  uid: `qa-${i}`, grade: "3", class: "2", number: String(i + 1), studentName: `검증${i + 1}`,
  firstRecord: { uid: `qa-${i}`, items: [{ score: 17, maxScore: 25, scoreEntered: true }], totalScore: 17, totalMaxScore: 25 },
  secondRecord: { uid: `qa-${i}`, items: [{ score: 29, maxScore: 35, scoreEntered: true }], totalScore: 29, totalMaxScore: 35 },
}));
const blob = await manager.buildClassSummaryWorkbookFromTemplate({
  year: "2026", semester: "2", grade: "3", classValue: "2", subject: "역사", teacherName: "검증교사",
  clientIp: "192.0.*.*", printedAt: new Date("2026-10-07T04:05:00Z"), firstRoster, secondRoster, students,
});
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(await blob.arrayBuffer());
const ws = wb.worksheets[0];
assert.equal(ws.getCell("E6").value, "새 학기 역사 탐구\n(만점 25.00,\n25.00%)");
assert.equal(ws.getCell("G6").value, "역사 자료 해석\n(만점 35.00,\n35.00%)");
assert.equal(ws.getCell("B7").value, "2/1");
assert.equal(ws.getCell("D7").value, "검증1");
assert.equal(ws.getCell("E7").value, 17);
assert.equal(ws.getCell("G7").value, 29);
assert.equal(ws.getCell("H7").value, 46);
assert.ok(ws.getCell("H45").value.includes("192.0.*.*/검증교사"));
assert.equal(ws.getCell("E39").value, "32 명");
assert.equal(ws.getCell("E40").value, 544);
assert.equal(ws.getCell("H40").value, 1472);
assert.equal(ws.getRow(7).height, 14.1);
assert.ok(ws.model.merges.includes("J7:M7"));
assert.equal(ws.pageSetup.paperSize, 9);
if (process.env.SCORE_QA_OUTPUT) await fs.writeFile(process.env.SCORE_QA_OUTPUT, Buffer.from(await blob.arrayBuffer()));
console.log("NEIS import, zero/blank/range validation, versioned signatures and template cell/layout contracts passed.");
