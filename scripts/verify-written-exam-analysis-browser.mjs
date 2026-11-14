import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const root = process.cwd().replaceAll("\\", "/");
const out = path.resolve(
  process.env.WRITTEN_EXAM_UI_EVIDENCE_DIR ||
    path.join(root, "..", "evidence", "written-exam-analysis"),
);
await fs.mkdir(out, { recursive: true });
const require = createRequire(root + "/package.json");
const { build } = require("esbuild");
const ExcelJS = require("exceljs");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const questions = Array.from({ length: 8 }, (_, index) => ({
  number: index + 1,
  answer: String((index % 5) + 1),
  points: 10,
  options: ["1", "2", "3", "4", "5"],
  achievementStandardCodes: [`9역11-0${(index % 4) + 1}`],
  targetAchievementLevel: ["A", "B", "C", "D", "E"][index % 5],
  intendedDifficulty: ["hard", "medium", "easy"][index % 3],
  concepts: ["조선"],
}));
const students = Array.from({ length: 24 }, (_, index) => {
  const room = index < 12 ? "1" : "2",
    number = String((index % 12) + 1);
  const responses = questions.map((question, item) => {
    const correct = (index + item * 3) % 9 < (index % 8) + 1;
    return {
      questionNumber: question.number,
      correct,
      answer: correct
        ? question.answer
        : String((Number(question.answer) % 5) + 1),
      score: correct ? 10 : 0,
    };
  });
  return {
    key: `3-${room}-${number}`,
    grade: "3",
    class: room,
    number,
    name: index < 2 ? "동명이름" : `합성학생${index + 1}`,
    responses,
    totalScore: responses.reduce((sum, response) => sum + response.score, 0),
  };
});
const metadata = {
  id: "qa-exam",
  schemaVersion: 1,
  year: "2026",
  semester: "2",
  title: "가상 정기시험",
  examDate: "2026-11-14",
  grade: "3",
  revision: "qa-revision",
  classIds: ["3-1", "3-2"],
  studentCount: students.length,
  questions,
  crops: [],
  files: [],
  updatedBy: "qa-teacher",
  updatedAt: null,
};
const state = `
export const qa = window.examQa = {calls:[],failLoad:false,failMock:false,failAsset:false,pause:false,releases:[],metadata:${JSON.stringify(metadata)},students:${JSON.stringify(students)},assets:new Map(),saved:null};
export async function begin(op,data={}){qa.calls.push({op,...data});if(qa.pause)await new Promise(resolve=>qa.releases.push(resolve));}
`;
const mocks = {
  "qa-state": state,
  "qa-auth": `const config={year:'2026',semester:'2'};export const useAuth=()=>({config,currentUser:{uid:'qa-teacher'},authGeneration:1,userData:{role:'teacher'}});`,
  "qa-toast": `export const useAppToast=()=>({showToast:value=>window.examQa.calls.push({op:'toast',...value})});`,
  "qa-archive": `export const isSemesterArchive=false;`,
  "qa-assessment-release": `export const getAssessmentSemesterId=config=>config.year+'-'+config.semester;`,
  "qa-score-kind": `export const WRITTEN_EXAM_SCORE_KIND='written_exam_essay';`,
  "qa-score-manager": `import React from 'react';export default function Manager({navigation}){return <section><div className="ws-page-header"><h2>정기시험 점수 관리</h2><button>이의제기</button><button>업로드</button><button>서명 현황</button></div>{navigation}<p>기존 점수 운영 검증 경계</p></section>}`,
  "qa-store": `import{qa,begin}from'qa-state';
export async function listWrittenExamAnalyses(){await begin('list');return [qa.metadata]}
export async function loadWrittenExamAnalysis(config,id,options={}){await begin('load',{id,...options});if(qa.failLoad)throw new Error('합성 서버 읽기 실패');return{metadata:qa.metadata,students:qa.students.filter(s=>!options.classId||('3-'+s.class)===options.classId)}}
export async function saveWrittenExamAnalysis(config,input){await begin('save',{count:input.students.length});qa.saved=input;qa.metadata={...qa.metadata,...input,revision:'qa-revision-next',studentCount:input.students.length,files:input.files.map(({blob,...file})=>({...file,size:blob.size,contentType:blob.type}))};qa.students=input.students;for(const file of input.files)qa.assets.set(file.fileName,file.blob);return qa.metadata}
export async function loadWrittenExamAnalysisAsset(config,id,revision,fileName){await begin('asset',{fileName});if(qa.failAsset)throw new Error('합성 이미지 읽기 실패');const blob=qa.assets.get(fileName);if(!blob)throw new Error('합성 이미지 없음');return blob}
`,
  "qa-class": `import{qa,begin}from'qa-state';
export const quizClassAnalysisError=e=>e.message;
export async function getQuizClassQuestion(){throw new Error('Imported question must not fetch mock paper')}
export async function getQuizClassAchievement(scope){await begin('mock',{scope});if(qa.failMock)throw new Error('합성 모의고사 읽기 실패');const students=qa.students.filter(s=>!scope.classIds.length||scope.classIds.includes(s.grade+'-'+s.class)).map((s,i)=>({uid:'qa-uid-'+s.key,name:s.name,classId:s.grade+'-'+s.class,number:s.number,grade:s.grade,classNumber:s.class}));return{semesterId:'2026-2',grade:'3',complete:true,questions:[],students,treeData:[],rawRows:[],configuredClasses:[],mockExamScoreRows:students.filter((s,i)=>i%2===0).map(s=>({id:'mock-'+s.uid,source:'legacy',raw:{studentUid:s.uid,semesterId:'2026-2',category:'exam_prep',examRound:'round_1',timestamp:'2026-11-01T00:00:00Z',score:50,total:qa.metadata.questions.length,maxPoints:80,cutScoreQuestions:qa.metadata.questions.map(q=>({...q,id:q.number}))}}))}}`,
  "qa-updates": `export const useQuizClassUpdates=options=>{if(options.enabled)throw new Error('Imported analysis must not subscribe to live mock updates')};`,
  "qa-loading": `import React from'react';export const LoadingOverlay=({loading})=>loading?<p role="status">불러오는 중</p>:null;`,
};
const mappings = [
  ["/contexts/AuthContext", "qa-auth"],
  ["/components/common/AppToastProvider", "qa-toast"],
  ["/lib/semesterArchive", "qa-archive"],
  ["/lib/assessmentRelease", "qa-assessment-release"],
  ["/lib/performanceScores", "qa-score-kind"],
  ["/PerformanceScoreManager", "qa-score-manager"],
  ["/lib/writtenExamAnalysisStore", "qa-store"],
  ["/lib/quizClassAnalysis", "qa-class"],
  ["/useQuizClassUpdates", "qa-updates"],
  ["/components/common/LoadingState", "qa-loading"],
];
await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import Manager from'./src/pages/teacher/components/WrittenExamEssayScoreManager';import{readWrittenExamInfoWorkbook,readWrittenExamResponsesWorkbook}from'./src/lib/writtenExamAnalysisWorkbook';import'./src/assets/index.css';import'qa-state';window.examQa.readInfo=readWrittenExamInfoWorkbook;window.examQa.readResponses=readWrittenExamResponsesWorkbook;createRoot(document.getElementById('root')).render(<MemoryRouter><main className="ws-page"><Manager/></main></MemoryRouter>);`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  outdir: out,
  entryNames: "app",
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  loader: {
    ".png": "dataurl",
    ".webp": "dataurl",
    ".jpg": "dataurl",
    ".svg": "dataurl",
    ".woff2": "dataurl",
    ".woff": "dataurl",
  },
  plugins: [
    {
      name: "synthetic-read-only-boundaries",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.path in mocks) return { path: args.path, namespace: "qa" };
          const normalized = args.path
            .replaceAll("\\", "/")
            .replace(/\.(tsx?|jsx?)$/, "");
          const found = mappings.find(([suffix]) =>
            normalized.endsWith(suffix),
          );
          if (found) return { path: found[1], namespace: "qa" };
        });
        build.onLoad({ filter: /.*/, namespace: "qa" }, (args) => ({
          contents: mocks[args.path],
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const infoWorkbook = new ExcelJS.Workbook();
infoWorkbook.addWorksheet("빈 시트");
const infoHeader = [
  "문항번호",
  "정답",
  "배점",
  "성취기준",
  "목표 성취수준",
  "난이도",
];
const infoRow = (q) => [
  q.number,
  q.answer,
  q.points,
  q.achievementStandardCodes[0],
  q.targetAchievementLevel,
  q.intendedDifficulty,
];
const infoSheet = infoWorkbook.addWorksheet("문항정보 1");
infoSheet.addRow(infoHeader);
questions.slice(0, 4).forEach((q) => infoSheet.addRow(infoRow(q)));
const infoSheet2 = infoWorkbook.addWorksheet("문항정보 2");
infoSheet2.addRow(infoHeader);
questions.slice(4).forEach((q) => infoSheet2.addRow(infoRow(q)));
infoSheet2.addRow(infoRow(questions[0]));
const infoFile = path.join(out, "synthetic-item-info.xlsx");
await infoWorkbook.xlsx.writeFile(infoFile);
const answerWorkbook = new ExcelJS.Workbook();
answerWorkbook.addWorksheet("빈 시트");
const answerHeader = [
  "학년",
  "번호",
  "이름",
  ...questions.map((q) => q.number),
  "선택형 소계",
];
const answerRow = (s) => [
  s.grade,
  s.number,
  s.name,
  ...s.responses.map((r) => r.answer),
  s.totalScore,
];
for (const room of ["1", "2"]) {
  const sheet = answerWorkbook.addWorksheet(room + "반");
  sheet.addRow(answerHeader);
  students
    .filter((s) => s.class === room)
    .forEach((s) => sheet.addRow(answerRow(s)));
}
const answerFile = path.join(out, "synthetic-responses.xlsx");
await answerWorkbook.xlsx.writeFile(answerFile);
const fixtureFiles = new Map([
  [path.basename(infoFile), infoFile],
  [path.basename(answerFile), answerFile],
]);
async function variant(original, name, modify) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await original.xlsx.writeBuffer());
  modify(workbook);
  const file = path.join(out, name);
  await workbook.xlsx.writeFile(file);
  fixtureFiles.set(name, file);
}
await variant(
  infoWorkbook,
  "conflicting-info.xlsx",
  (book) => (book.getWorksheet("문항정보 2").getRow(6).getCell(2).value = "5"),
);
await variant(infoWorkbook, "missing-info.xlsx", (book) =>
  book.getWorksheet("문항정보 1").spliceRows(5, 1),
);
await variant(answerWorkbook, "invalid-sheet.xlsx", (book) =>
  book.addWorksheet("알 수 없는 시트").addRow(["참고 자료"]),
);
await variant(answerWorkbook, "duplicate-students.xlsx", (book) => {
  const sheet = book.addWorksheet("중복 학생");
  sheet.addRow([...answerHeader, "반"]);
  sheet.addRow([...answerRow(students[0]), "1"]);
});
const pdfFile = path.resolve(
  root,
  "..",
  "evidence",
  "written-exam-paper-crop",
  "synthetic-paper.pdf",
);
await fs.access(pdfFile);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (
      url.pathname.startsWith("/qa-fixture/") &&
      fixtureFiles.has(url.pathname.slice(12))
    ) {
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.end(await fs.readFile(fixtureFiles.get(url.pathname.slice(12))));
      return;
    }
    if (url.pathname.endsWith("pdf.worker.min.mjs")) {
      res.setHeader("Content-Type", "text/javascript");
      res.end(
        await fs.readFile(
          path.join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
        ),
      );
      return;
    }
    if (url.pathname === "/app.js" || url.pathname === "/app.css") {
      res.setHeader(
        "Content-Type",
        url.pathname.endsWith("js") ? "text/javascript" : "text/css",
      );
      res.end(await fs.readFile(path.join(out, url.pathname.slice(1))));
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;font-family:Arial,sans-serif;background:#f7f8fa}*{box-sizing:border-box}.ws-page{padding:24px;max-width:1536px;margin:auto}</style><div id="root"></div><script type="module" src="/app.js"></script></html>',
    );
  } catch (error) {
    res.statusCode = 500;
    res.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const errors = [];
const evidence = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.log("PAGE ERROR:", error.message);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "평가 분석", exact: true }).waitFor();
  const workbookChecks = await page.evaluate(async () => {
    const file = async (name) =>
      new File([await (await fetch("/qa-fixture/" + name)).blob()], name);
    const info = await window.examQa.readInfo(
      await file("synthetic-item-info.xlsx"),
    );
    const answers = await window.examQa.readResponses(
      await file("synthetic-responses.xlsx"),
      { questions: info.questions, targetGrade: "3" },
    );
    const checks = {
      questionCount: info.questions.length,
      studentCount: answers.students.length,
      classes: [...new Set(answers.students.map((s) => s.class))],
      errors: {},
    };
    for (const [name, kind] of [
      ["conflicting-info.xlsx", "info"],
      ["missing-info.xlsx", "info"],
      ["invalid-sheet.xlsx", "answers"],
      ["duplicate-students.xlsx", "answers"],
    ]) {
      try {
        const input = await file(name);
        await (kind === "info"
          ? window.examQa.readInfo(input)
          : window.examQa.readResponses(input, {
              questions: info.questions,
              targetGrade: "3",
            }));
        checks.errors[name] = "ACCEPTED";
      } catch (error) {
        checks.errors[name] = error.message;
      }
    }
    try {
      await window.examQa.readInfo(
        new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.xlsx"),
      );
      checks.errors.large = "ACCEPTED";
    } catch (error) {
      checks.errors.large = error.message;
    }
    return checks;
  });
  assert.equal(workbookChecks.questionCount, 8);
  assert.equal(workbookChecks.studentCount, 24);
  assert.deepEqual(workbookChecks.classes, ["1", "2"]);
  assert.match(
    workbookChecks.errors["conflicting-info.xlsx"],
    /문항정보 2.*문항정보 1/,
  );
  assert.match(workbookChecks.errors["missing-info.xlsx"], /전체 시트.*4번/);
  assert.match(workbookChecks.errors["invalid-sheet.xlsx"], /알 수 없는 시트/);
  assert.match(
    workbookChecks.errors["duplicate-students.xlsx"],
    /중복 학생.*1반.*중복/,
  );
  assert.match(workbookChecks.errors.large, /20MB/);
  assert.equal(
    await page.evaluate(() => window.examQa.calls.length),
    0,
    "Hidden analysis tab must not read data",
  );
  await page.getByRole("button", { name: "평가 분석", exact: true }).click();
  await page
    .locator(".written-exam-filters select")
    .nth(0)
    .selectOption("qa-exam");
  await page.locator(".written-exam-filters select").nth(2).selectOption("3");
  await page
    .getByText("모의고사 1회 + 정기시험", { exact: true })
    .first()
    .waitFor();
  assert.ok(
    (await page.getByRole("cell", { name: "정기시험", exact: true }).count()) >
      0,
    "Students without mock attempts must retain regular-only estimates",
  );
  const initialCalls = await page.evaluate(() => window.examQa.calls.slice());
  assert.equal(initialCalls.filter((call) => call.op === "mock").length, 1);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const css = await page
      .locator(".written-exam-analysis > .ws-page-header")
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          background: style.backgroundColor,
          shadow: style.boxShadow,
          minHeight: style.minHeight,
          position: style.position,
        };
      });
    assert.equal(css.background, "rgba(0, 0, 0, 0)");
    assert.equal(css.shadow, "none");
    for (let view = 0; view < 7; view++) {
      await page
        .locator(".written-exam-filters select")
        .nth(2)
        .selectOption(String(view));
      await page
        .locator(
          ".written-exam-analysis table, .written-exam-analysis .qaa-summary-grid, .written-exam-analysis .qaa-empty",
        )
        .first()
        .waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      assert.equal(
        overflow,
        false,
        `Page overflow at ${width}px / report ${view}`,
      );
      await page.screenshot({
        path: path.join(out, `report-${view}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    evidence.push({ width, header: css, reports: 7 });
  }
  assert.equal(
    await page.evaluate(
      () => window.examQa.calls.filter((call) => call.op === "mock").length,
    ),
    1,
    "Report switching must not fetch again",
  );
  await page.locator(".written-exam-filters select").nth(1).selectOption("3-2");
  await page.locator(".written-exam-filters select").nth(2).selectOption("5");
  await page.waitForFunction(
    () => window.examQa.calls.filter((call) => call.op === "mock").length === 2,
  );
  const before = await page.evaluate(() => window.examQa.calls.length);
  await page.getByRole("button", { name: "정기시험 분석 새로고침" }).click();
  await page.waitForFunction(
    () => window.examQa.calls.filter((call) => call.op === "mock").length === 3,
  );
  assert.equal(
    await page.locator(".written-exam-filters select").nth(1).inputValue(),
    "3-2",
  );
  assert.equal(
    await page.locator(".written-exam-filters select").nth(0).inputValue(),
    "qa-exam",
  );
  assert.equal(
    await page.locator(".written-exam-filters select").nth(2).inputValue(),
    "5",
  );
  const refresh = await page.evaluate(
    (before) => window.examQa.calls.slice(before),
    before,
  );
  assert.deepEqual(
    refresh.map((call) => call.op),
    ["list", "load", "mock"],
  );
  assert.equal(refresh[1].classId, "3-2");
  assert.deepEqual(refresh[2].scope.classIds, ["3-2"]);
  await page.evaluate(() => (window.examQa.failLoad = true));
  await page.getByRole("button", { name: "정기시험 분석 새로고침" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "합성 서버 읽기 실패" })
    .waitFor();
  assert.equal(
    await page.locator(".written-exam-filters select").nth(1).inputValue(),
    "3-2",
  );
  await page.evaluate(() => (window.examQa.failLoad = false));
  await page.getByRole("button", { name: "정기시험 분석 새로고침" }).click();
  await page.waitForFunction(() => !document.querySelector(".qca-error"));
  const duplicateBefore = await page.evaluate(() => {
    window.examQa.pause = true;
    const count = window.examQa.calls.length;
    const button = document.querySelector(
      'button[aria-label="정기시험 분석 새로고침"]',
    );
    button.click();
    button.click();
    return count;
  });
  assert.deepEqual(
    await page.evaluate(
      (before) => window.examQa.calls.slice(before).map((call) => call.op),
      duplicateBefore,
    ),
    ["list"],
    "Same-tick double click must produce one refresh",
  );
  await page.evaluate(() => {
    window.examQa.pause = false;
    window.examQa.releases.splice(0).forEach((resolve) => resolve());
  });
  await page.waitForFunction(
    () =>
      document.querySelector('button[aria-label="정기시험 분석 새로고침"]')
        .disabled === false,
  );
  await page.evaluate(() => (window.examQa.failMock = true));
  await page.getByRole("button", { name: "정기시험 분석 새로고침" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "모의고사 자료를 불러오지 못해" })
    .waitFor();
  await page.locator(".written-exam-filters select").nth(2).selectOption("3");
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("td")].some(
        (cell) => cell.textContent === "모의고사 1회 + 정기시험",
      ),
  );
  assert.equal(
    await page
      .getByRole("cell", { name: "모의고사 1회 + 정기시험", exact: true })
      .count(),
    0,
    "Failed mock lookup must not show stale mock estimates",
  );
  await page.evaluate(() => (window.examQa.failMock = false));
  await page
    .getByRole("button", { name: "분석 자료 업로드", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "정기시험 분석 자료 업로드" });
  await dialog.getByLabel("문항정보표 엑셀").setInputFiles(infoFile);
  await dialog.getByLabel("학생답 정오표 엑셀").setInputFiles(answerFile);
  await dialog.getByLabel("원안지 PDF").setInputFiles(pdfFile);
  await dialog.getByRole("button", { name: "자료 확인", exact: true }).click();
  await dialog
    .getByText(/3학년 · 24명 · 선택형 8문항 · PDF 2쪽/)
    .waitFor({ timeout: 30000 });
  const highlight = await dialog
    .locator(".written-exam-highlight")
    .first()
    .evaluate((el) => ({
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      width: parseFloat(el.style.width),
      height: parseFloat(el.style.height),
    }));
  await dialog
    .getByRole("button", { name: "형광펜 지우기", exact: true })
    .click();
  assert.equal(
    await dialog
      .getByRole("button", { name: "분석 자료 교체 저장", exact: true })
      .isDisabled(),
    true,
  );
  await dialog
    .locator(".written-exam-crop-review select")
    .nth(2)
    .selectOption("highlight");
  for (const [field, label] of [
    ["x", "왼쪽 %"],
    ["y", "위 %"],
    ["width", "너비 %"],
    ["height", "높이 %"],
  ])
    await dialog
      .getByLabel(label, { exact: true })
      .fill(String(highlight[field]));
  await dialog
    .getByRole("button", { name: "입력한 영역에 형광펜 추가", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await dialog
    .getByRole("button", { name: "이 문항 영역 확인", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await dialog
    .getByRole("button", { name: "분석 자료 교체 저장", exact: true })
    .click();
  await dialog.waitFor({ state: "detached" });
  const saved = await page.evaluate(() => ({
    count: window.examQa.saved.students.length,
    crops: window.examQa.saved.crops.map((c) => ({
      number: c.questionNumber,
      status: c.status,
      highlights: c.highlights.length,
    })),
    files: window.examQa.saved.files.map((f) => ({
      kind: f.kind,
      size: f.blob.size,
    })),
  }));
  assert.equal(saved.count, 24);
  assert.equal(saved.crops.length, 8);
  assert.ok(
    saved.crops.every(
      (crop) => crop.status === "ready" && crop.highlights === 1,
    ),
  );
  await page.locator(".written-exam-filters select").nth(2).selectOption("1");
  const buttons = await page
    .locator(".quiz-achievement-analysis button")
    .allTextContents();
  await fs.writeFile(
    path.join(out, "question-buttons.json"),
    JSON.stringify(buttons),
  );
  const questionButton = page
    .getByRole("button", { name: "1번", exact: true })
    .first();
  await page.evaluate(() => (window.examQa.failAsset = true));
  await questionButton.click();
  dialog = page.getByRole("dialog", { name: "1번 문항", exact: true });
  await dialog
    .getByRole("alert")
    .filter({ hasText: "합성 이미지 읽기 실패" })
    .waitFor();
  await page.evaluate(() => (window.examQa.failAsset = false));
  await dialog.getByRole("button", { name: "다시 시도", exact: true }).click();
  await dialog
    .getByRole("img", { name: "1번 원안지 문항, 정답 선지 강조" })
    .waitFor();
  assert.equal(
    await dialog
      .locator('input[type="checkbox"], .fa-check, .mock-exam-pencil-score')
      .count(),
    0,
  );
  await page.screenshot({
    path: path.join(out, "question-image.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.ok(
    await questionButton.evaluate((el) => document.activeElement === el),
    "Escape restores focus to question trigger",
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        evidence,
        workbookChecks,
        refresh,
        saved,
        errors,
        calls: await page.evaluate(() => window.examQa.calls),
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS written exam UI: 7 reports at 390/768/1440; scoped refresh/filter preservation/retry; mock linkage; all-sheet XLSX+PDF upload, dedup/conflict/missing/invalid-sheet checks; question image/focus. Evidence: ${out}`,
  );
} catch (error) {
  await page?.screenshot({
    path: path.join(out, "failure.png"),
    fullPage: true,
  });
  await fs.writeFile(path.join(out, "failure.html"), await page.content());
  console.log("FINAL QA CALLS", await page.evaluate(() => window.examQa.calls));
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
