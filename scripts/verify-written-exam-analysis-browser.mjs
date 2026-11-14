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
export const qa = window.examQa = {calls:[],failLoad:false,failMock:false,failAsset:false,pause:false,pauseOps:[],releases:[],metadata:${JSON.stringify(metadata)},students:${JSON.stringify(students)},assets:new Map(),saved:null,auth:{config:{year:'2026',semester:'2'},currentUser:{uid:'qa-teacher'},authGeneration:1,userData:{role:'teacher'}}};
export const authListeners=new Set();
qa.setAuth=values=>{qa.auth={...qa.auth,...values,authGeneration:qa.auth.authGeneration+1};authListeners.forEach(listener=>listener())};
export async function begin(op,data={}){qa.calls.push({op,owner:qa.auth.currentUser.uid,...data});if(qa.pause||qa.pauseOps.includes(op))await new Promise(resolve=>qa.releases.push(resolve));}
`;
const mocks = {
  "qa-state": state,
  "qa-auth": `import{useSyncExternalStore}from'react';import{qa,authListeners}from'qa-state';const subscribe=listener=>{authListeners.add(listener);return()=>authListeners.delete(listener)};export const useAuth=()=>useSyncExternalStore(subscribe,()=>qa.auth);`,
  "qa-toast": `export const useAppToast=()=>({showToast:value=>window.examQa.calls.push({op:'toast',...value})});`,
  "qa-archive": `export const isSemesterArchive=false;`,
  "qa-assessment-release": `export const getAssessmentSemesterId=config=>config.year+'-'+config.semester;`,
  "qa-score-kind": `export const WRITTEN_EXAM_SCORE_KIND='written_exam_essay';`,
  "qa-score-manager": `import React,{useState} from 'react';export default function Manager({navigation,writtenExamMaterials}){const[open,setOpen]=useState(false);return <section><div className="ws-page-header"><h2>정기시험 점수 관리</h2></div>{navigation}<button>이의제기</button><button onClick={()=>setOpen(true)}>업로드</button><button>서명 현황</button>{open&&<section role="dialog" aria-label="정기시험 점수표 업로드"><button onClick={()=>setOpen(false)}>업로드 창 닫기</button>{writtenExamMaterials}</section>}</section>}`,
  "qa-source": `import{qa,begin}from'qa-state';
const essayItems=[{itemKey:'essay-1',name:'논술형 1',shortName:'1-(1)',examSection:'essay',maxScore:2},{itemKey:'essay-2',name:'논술형 2',shortName:'1-(2)',examSection:'essay',maxScore:3}];
const scoreRows=()=>qa.students.map((student,index)=>{const scores=[[0,0],[2,3],[1,null],[null,null]][index%4];return{uid:'qa-uid-'+student.key,rowKey:student.key,grade:student.grade,class:student.class,number:student.number,studentName:student.name,items:essayItems.map((item,i)=>({...item,score:scores[i],scoreEntered:scores[i]!==null,feedback:i===0?(index%2===0?'백지':'문항 근거를\\n  다시 확인하세요.'):(index%4===3?'백지':'')})),feedback:'교사가 확인한 기존 피드백 '+student.key+'\\n  역사적 근거를 연결하세요.\\r\\n   다음 학습에서 확인합니다.',evidence:'기존 채점 근거',totalScore:scores.reduce((sum,score)=>sum+(score||0),0),enteredScoreCount:scores.filter(score=>score!==null).length,totalMaxScore:5}});
const source=()=>({id:qa.metadata.id,title:qa.metadata.title,targetGrade:'3',classes:['1','2'],scoreKind:'written_exam_essay',scoreContentKind:'mixed',academicYear:'2026',semester:'2',items:[...qa.metadata.questions.map(q=>({...q,examSection:'objective',questionNumber:q.number,correctAnswer:q.answer,maxScore:q.points,answerChoices:q.options})),...essayItems],rows:scoreRows()});
export async function listWrittenExamScoreSources(config){await begin('list',{from:'score-ledger',year:config.year,semester:config.semester});return[source(),{...source(),id:'qa-other',title:'다른 정기시험'}]}
export async function loadWrittenExamScoreAnalysis(config,id,options={}){const essay=options.analysisKind==='essay';const selected=qa.students.filter(s=>!options.classId||('3-'+s.class)===options.classId);const rows=scoreRows().filter(s=>!options.classId||('3-'+s.class)===options.classId);const result={metadata:essay?{...qa.metadata,questions:[],crops:[],files:[],examDate:'',revision:'scores',studentCount:rows.length}:qa.metadata,hasObjectiveScores:true,students:essay?[]:selected,scoreRows:rows,scoreItems:source().items};await begin('load',{id,...options,analysisKind:options.analysisKind||'objective',from:'score-ledger',readContract:{roster:1,materials:essay?0:1,userDocuments:essay?0:selected.length}});if(qa.failLoad)throw new Error('합성 서버 읽기 실패');return result}
export async function loadWrittenExamScoreRoster(config,id){await begin('roster',{id});return {...source(),id}}
export async function loadWrittenExamMaterials(config,id){await begin('materials',{id});return id==='qa-other'?null:qa.metadata}
export function scoreSourceClasses(s){return s.classes.map(c=>s.targetGrade+'-'+c)}
export function questionsFromScoreSource(s){return s.items.filter(i=>i.examSection==='objective').map(i=>({number:i.questionNumber,answer:i.correctAnswer,points:i.maxScore,options:i.answerChoices,achievementStandardCodes:[],targetAchievementLevel:'',intendedDifficulty:'',concepts:[]}))}
export function mergeScoreSourceQuestions(source,info){if(!info.length)return source;if(source.length!==info.length||source.some(q=>!info.some(i=>i.number===q.number&&i.answer===q.answer&&i.points===q.points)))throw new Error('문항정보표의 문항번호·정답·배점이 등록된 점수표와 다릅니다.');return info}
export async function saveWrittenExamScoreMaterials(config,input){await begin('save',{hasStudentPayload:'students'in input});if('students'in input)throw new Error('Student payload must not reach materials API');qa.saved=input;qa.metadata={...qa.metadata,...input,id:input.examId,revision:qa.metadata.revision+'-next',files:input.files.map(({blob,...file})=>({...file,size:blob.size,contentType:blob.type}))};for(const file of input.files)qa.assets.set(file.fileName,file.blob);return qa.metadata}
`,
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
  ["/lib/writtenExamScoreSource", "qa-source"],
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
await variant(infoWorkbook, "updated-metadata.xlsx", (book) => {
  book.getWorksheet("문항정보 1").getRow(2).getCell(5).value = "E";
  book.getWorksheet("문항정보 2").getRow(6).getCell(5).value = "E";
});
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
const essayChecks = [];
const boundaryChecks = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.log("PAGE ERROR:", error.message);
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "평가 분석", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "점수 등록 및 확인", exact: true })
      .count(),
    1,
  );
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
  assert.equal(
    await page
      .getByRole("button", { name: "분석 자료 업로드", exact: true })
      .count(),
    0,
    "Analysis has no duplicate upload workflow",
  );
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
  assert(
    initialCalls
      .filter((call) => ["list", "load"].includes(call.op))
      .every((call) => call.from === "score-ledger"),
    "Analysis reads the registered score ledger",
  );
  for (const width of [390, 768, 1280, 1440]) {
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
  const objectiveTab = page.getByRole("tab", { name: "선택형", exact: true });
  const essayTab = page.getByRole("tab", { name: "논술형", exact: true });
  const ready = () =>
    page.waitForFunction(
      () =>
        document.querySelector('button[aria-label="정기시험 분석 새로고침"]')
          .disabled === false,
    );
  const callsSince = (start) =>
    page.evaluate((offset) => window.examQa.calls.slice(offset), start);
  const callCount = () => page.evaluate(() => window.examQa.calls.length);
  const failedSwitchCalls = await callCount();
  await essayTab.click();
  await ready();
  assert.equal(
    await page
      .getByRole("alert")
      .filter({ hasText: "모의고사 자료를 불러오지 못해" })
      .count(),
    0,
  );
  const firstEssayLoad = await callsSince(failedSwitchCalls);
  assert.deepEqual(
    firstEssayLoad.map((call) => call.op),
    [],
    "The loaded objective snapshot already contains atomic essay roster rows",
  );
  await essayTab.press("Home");
  await ready();
  assert.deepEqual(
    (await callsSince(failedSwitchCalls)).map((call) => call.op),
    [],
  );
  assert.equal(
    await page
      .getByRole("alert")
      .filter({ hasText: "모의고사 자료를 불러오지 못해" })
      .count(),
    1,
    "Returning to the cached choice snapshot preserves its mock error until an explicit reload",
  );
  await page.locator(".written-exam-filters select").nth(1).selectOption("");
  await ready();
  await objectiveTab.focus();
  await objectiveTab.press("End");
  await ready();
  assert.equal(await essayTab.getAttribute("aria-selected"), "true");
  assert.equal(await essayTab.getAttribute("tabindex"), "0");
  assert.equal(await objectiveTab.getAttribute("tabindex"), "-1");
  assert(await essayTab.evaluate((el) => el === document.activeElement));
  assert.equal(
    await page.getByRole("tabpanel").getAttribute("aria-labelledby"),
    "written-exam-kind-essay",
  );
  for (const [trigger, key, selected] of [
    [essayTab, "ArrowLeft", objectiveTab],
    [objectiveTab, "ArrowRight", essayTab],
    [essayTab, "Home", objectiveTab],
    [objectiveTab, "End", essayTab],
  ]) {
    const start = await callCount();
    await trigger.press(key);
    await ready();
    assert.equal(await selected.getAttribute("aria-selected"), "true");
    assert.deepEqual(
      (await callsSince(start)).map((call) => call.op),
      [],
      "Keyboard tab switching reuses the same complete assessment snapshot",
    );
  }
  const beforeEssay = await callCount();
  const essayTitles = [
    "전체 결과",
    "문항별 점수",
    "학급별 비교",
    "학생별 결과",
  ];
  const chartTitles = [
    "논술형 총점 분포",
    "논술형 문항 평균",
    "논술형 학급 평균",
  ];
  const pagination = page.getByRole("navigation", {
    name: "논술형 학생 결과 페이지",
    exact: true,
  });
  const studentTable = page.getByRole("region", {
    name: "논술형 학생별 점수와 교사 피드백",
    exact: true,
  });
  assert.equal(
    await page
      .locator(".written-exam-filters select")
      .nth(2)
      .locator("option")
      .count(),
    4,
  );
  for (const width of [390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let view = 0; view < 4; view++) {
      await page
        .locator(".written-exam-filters select")
        .nth(2)
        .selectOption(String(view));
      await page
        .getByRole("heading", {
          name: `논술형 ${essayTitles[view]}`,
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        `Essay overflow at ${width}px / ${view}`,
      );
      assert.equal(
        await page
          .locator(".wea-analysis")
          .getByText(/입력 완료/)
          .count(),
        0,
        "Input completion status is removed from essay UI",
      );
      assert.deepEqual(
        await page.locator(".wea-counts dd").allTextContents(),
        ["24명", "18개", "18명"],
        "Blank feedback is counted separately from earned zero and missing scores",
      );
      if (view < 3) {
        const figure = page.getByRole("figure", {
          name: chartTitles[view],
          exact: true,
        });
        await figure.waitFor();
        const chart = await figure
          .locator(".wea-chart-column")
          .evaluateAll((bars) =>
            bars.map((bar) => ({
              value: Number(bar.dataset.value),
              count: Number(bar.dataset.count),
              label: bar.getAttribute("aria-label"),
            })),
          );
        assert.deepEqual(
          chart.map(({ value }) => value),
          [
            [6, 6],
            [1, 1.5],
            [2.5, 2.5],
          ][view],
        );
        assert.deepEqual(
          chart.map(({ count }) => count),
          [
            [6, 6],
            [18, 12],
            [6, 6],
          ][view],
        );
        assert.ok(chart.every((bar) => bar.label.includes("명")));
        const region = figure.getByRole("region", {
          name: `${chartTitles[view]} 그래프`,
          exact: true,
        });
        await region.focus();
        assert.equal(
          await region.evaluate((el) => document.activeElement === el),
          true,
        );
        essayChecks.push({ width, view, chart });
      } else assert.equal(await page.locator(".wea-chart").count(), 0);
      if (view === 0) {
        assert.deepEqual(
          await page
            .getByRole("region", {
              name: "논술형 전체 원점수 결과",
              exact: true,
            })
            .locator("tbody td")
            .allTextContents(),
          ["12명", "2.5", "2.5", "0", "5"],
        );
      }
      if (view === 1) {
        const rows = page
          .getByRole("region", { name: "논술형 문항별 원점수", exact: true })
          .locator("tbody tr");
        assert.deepEqual(
          (await rows.nth(0).locator("td").allTextContents()).slice(0, 4),
          ["18명", "12명", "1", "0.82"],
        );
        assert.deepEqual(
          (await rows.nth(1).locator("td").allTextContents()).slice(0, 4),
          ["12명", "6명", "1.5", "1.5"],
        );
      }
      if (view === 2) {
        const rows = page
          .getByRole("region", {
            name: "논술형 학급별 원점수 비교",
            exact: true,
          })
          .locator("tbody tr");
        assert.equal(await rows.count(), 2);
        assert.deepEqual(
          (await rows.first().locator("td").allTextContents()).slice(0, 5),
          ["12명", "9개", "9명", "2.5", "2.5"],
        );
      }
      if (view === 3) {
        await pagination
          .getByRole("button", { name: "1페이지, 3학년 1반", exact: true })
          .click();
        assert.equal(await studentTable.locator("tbody tr").count(), 12);
        assert.deepEqual(
          await pagination.getByRole("button").allTextContents(),
          ["1", "2"],
        );
        assert.equal(
          await pagination
            .getByRole("button", { name: "1페이지, 3학년 1반", exact: true })
            .getAttribute("aria-current"),
          "page",
        );
        assert.equal(
          await studentTable.getByText(/교사가 확인한 기존 피드백/).count(),
          0,
          "Feedback remains inside its on-demand dialog",
        );
        assert.equal(
          await studentTable
            .getByRole("button", { name: /교사 피드백 보기$/ })
            .count(),
          12,
        );
        const feedbackButton = studentTable.getByRole("button", {
          name: "동명이름(30101) 교사 피드백 보기",
          exact: true,
        });
        await feedbackButton.click();
        const feedbackDialog = page.getByRole("dialog", {
          name: "동명이름(30101) 교사 피드백",
          exact: true,
        });
        await feedbackDialog.waitFor();
        const feedbackLayout = await feedbackDialog
          .locator(".wea-feedback-text")
          .evaluate((el) => ({
            text: el.textContent,
            whiteSpace: getComputedStyle(el).whiteSpace,
            textAlign: getComputedStyle(el).textAlign,
          }));
        assert.equal(feedbackLayout.whiteSpace, "normal");
        assert.equal(feedbackLayout.textAlign, "left");
        assert.doesNotMatch(feedbackLayout.text, /[\r\n]/);
        assert.match(
          feedbackLayout.text,
          /3-1-1 역사적 근거를 연결하세요\. 다음 학습에서 확인합니다\./,
        );
        assert.match(feedbackLayout.text, /1-\(1\): 백지/);
        assert.equal(
          await feedbackDialog
            .getByRole("button", { name: "교사 피드백 닫기", exact: true })
            .evaluate((el) => document.activeElement === el),
          true,
        );
        assert.equal(
          await feedbackDialog.evaluate((el) => {
            const box = el.getBoundingClientRect();
            return (
              box.left >= 0 &&
              box.right <= innerWidth &&
              box.top >= 0 &&
              box.bottom <= innerHeight
            );
          }),
          true,
        );
        await page.screenshot({
          path: path.join(out, `essay-feedback-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
        await feedbackDialog.waitFor({ state: "detached" });
        assert.equal(
          await feedbackButton.evaluate((el) => document.activeElement === el),
          true,
          "Dialog close restores its feedback button focus",
        );
        await pagination
          .getByRole("button", { name: "2페이지, 3학년 2반", exact: true })
          .click();
        assert.equal(await studentTable.locator("tbody tr").count(), 12);
        assert.ok(
          (await studentTable.locator("tbody th").allTextContents()).every(
            (value) => /\(302\d{2}\)/.test(value),
          ),
        );
        assert.equal(
          await pagination
            .getByRole("button", { name: "2페이지, 3학년 2반", exact: true })
            .getAttribute("aria-current"),
          "page",
        );
        const paginationLayout = await pagination.evaluate((el) => {
          const button = el.querySelector('[aria-current="page"]');
          const style = getComputedStyle(button);
          const box = el.getBoundingClientRect();
          return {
            className: el.className,
            bottom: box.bottom,
            background: style.backgroundColor,
            minHeight: style.minHeight,
          };
        });
        assert.ok(
          paginationLayout.className.includes("student-list-pagination"),
        );
        assert.notEqual(paginationLayout.background, "rgba(0, 0, 0, 0)");
        essayChecks.push({
          width,
          view,
          pageRows: 12,
          pageClass: "3-2",
          feedbackLayout,
          paginationLayout,
        });
      }
      await page.screenshot({
        path: path.join(out, `essay-report-${view}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    evidence.push({
      width,
      essayReports: 4,
      actualScoreRows: 24,
      pageRows: 12,
    });
  }
  assert.equal(
    await callCount(),
    beforeEssay,
    "Changing an essay report, page, or feedback dialog issues no server requests",
  );
  await page.locator(".written-exam-filters select").nth(2).selectOption("0");
  assert.deepEqual(
    await page
      .locator(".wea-chart-column")
      .evaluateAll((bars) => bars.map((bar) => Number(bar.dataset.count))),
    [6, 6],
    "The second class page never changes full-group chart denominators",
  );
  await page.locator(".written-exam-filters select").nth(2).selectOption("3");
  assert.equal(
    await pagination
      .getByRole("button", { name: "2페이지, 3학년 2반", exact: true })
      .getAttribute("aria-current"),
    "page",
    "Report switching preserves the class page",
  );
  const essayRefreshStart = await callCount();
  await page.getByRole("button", { name: "정기시험 분석 새로고침" }).click();
  await ready();
  const essayRefresh = await callsSince(essayRefreshStart);
  assert.deepEqual(
    essayRefresh.map((call) => call.op),
    ["list", "load"],
  );
  assert.equal(essayRefresh[1].analysisKind, "essay");
  assert.deepEqual(essayRefresh[1].readContract, {
    roster: 1,
    materials: 0,
    userDocuments: 0,
  });
  assert.equal(
    await pagination
      .getByRole("button", { name: "2페이지, 3학년 2반", exact: true })
      .getAttribute("aria-current"),
    "page",
    "Refresh preserves the second class page",
  );
  assert.equal(
    await page.locator(".written-exam-filters select").nth(2).inputValue(),
    "3",
  );
  await page.evaluate(() => (window.examQa.failLoad = true));
  await page.getByRole("button", { name: "정기시험 분석 새로고침" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "합성 서버 읽기 실패" })
    .waitFor();
  assert.equal(
    await pagination
      .getByRole("button", { name: "2페이지, 3학년 2반", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  assert.equal(
    await studentTable.locator("tbody tr").count(),
    12,
    "A failed refresh retains the existing class page",
  );
  await page.evaluate(() => (window.examQa.failLoad = false));
  await page.getByRole("button", { name: "정기시험 분석 새로고침" }).click();
  await ready();
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(
    await pagination
      .getByRole("button", { name: "2페이지, 3학년 2반", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  const essayClassStart = await callCount();
  await page.locator(".written-exam-filters select").nth(1).selectOption("3-1");
  await ready();
  const essayClassCalls = await callsSince(essayClassStart);
  assert.deepEqual(
    essayClassCalls.map((call) => call.op),
    ["load"],
  );
  assert.equal(essayClassCalls[0].classId, "3-1");
  assert.deepEqual(essayClassCalls[0].readContract, {
    roster: 1,
    materials: 0,
    userDocuments: 0,
  });
  assert.deepEqual(await page.locator(".wea-counts dd").allTextContents(), [
    "12명",
    "9개",
    "9명",
  ]);
  assert.equal(await pagination.getByRole("button").count(), 1);
  assert.equal(await studentTable.locator("tbody tr").count(), 12);
  assert.ok(
    (await studentTable.locator("tbody th").allTextContents()).every((value) =>
      /\(301\d{2}\)/.test(value),
    ),
  );
  await page.getByRole("button", { name: "정기시험 분석 새로고침" }).click();
  await ready();
  assert.equal(
    await page.locator(".written-exam-filters select").nth(1).inputValue(),
    "3-1",
  );
  assert.equal(
    await page.locator(".written-exam-filters select").nth(2).inputValue(),
    "3",
  );
  await page.locator(".written-exam-filters select").nth(1).selectOption("");
  await ready();
  const choiceReturnStart = await callCount();
  await objectiveTab.click();
  await ready();
  assert.equal(
    await objectiveTab.evaluate((el) => document.activeElement === el),
    true,
    "A tab that needs fresh objective details retains focus through loading",
  );
  const choiceReturn = await callsSince(choiceReturnStart);
  assert.deepEqual(
    choiceReturn.map((call) => call.op),
    ["load", "mock"],
    "Returning from an atomic essay snapshot fetches objective responses again",
  );
  assert.equal(choiceReturn[0].analysisKind, "objective");
  assert.deepEqual(choiceReturn[0].readContract, {
    roster: 1,
    materials: 1,
    userDocuments: 24,
  });
  assert.equal(
    await page.locator(".written-exam-filters select").nth(2).inputValue(),
    "3",
    "Choice report selection is preserved independently",
  );
  boundaryChecks.push({ essayRefresh, essayClassCalls, choiceReturn });
  await page
    .getByRole("button", { name: "점수 등록 및 확인", exact: true })
    .click();
  await page.getByRole("button", { name: "업로드", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "정기시험 점수표 업로드" });
  const originalStudents = await page.evaluate(() =>
    JSON.stringify(window.examQa.students),
  );
  await dialog
    .locator(".written-exam-material-fields select")
    .selectOption("qa-exam");
  await dialog
    .getByLabel("문항정보표 엑셀")
    .setInputFiles(path.join(out, "conflicting-info.xlsx"));
  await dialog.getByLabel("원안지 PDF", { exact: true }).setInputFiles(pdfFile);
  await dialog
    .locator(".written-exam-material-fields select")
    .selectOption("qa-other");
  await dialog.getByLabel("시험일", { exact: true }).fill("2026-11-14");
  await dialog.getByRole("button", { name: "자료 확인", exact: true }).click();
  await dialog.getByText(/8문항 · PDF 0쪽/).waitFor();
  assert.equal(
    await dialog.getByRole("alert").count(),
    0,
    "Changing the source clears stale info and PDF file state",
  );
  await dialog
    .getByRole("button", { name: "파일 다시 선택", exact: true })
    .click();
  await dialog
    .locator(".written-exam-material-fields select")
    .selectOption("qa-exam");
  await dialog.getByLabel("시험일", { exact: true }).fill("2026-11-14");
  assert.equal(
    await dialog.getByLabel("학생답 정오표 엑셀").count(),
    0,
    "Materials never ask for student responses again",
  );
  await dialog.getByLabel("문항정보표 엑셀").setInputFiles(infoFile);
  await dialog.getByLabel("원안지 PDF", { exact: true }).setInputFiles(pdfFile);
  await dialog.getByRole("button", { name: "자료 확인", exact: true }).click();
  await dialog.getByText(/8문항 · PDF 2쪽/).waitFor({ timeout: 30000 });
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
      .getByRole("button", { name: "원안지·문항정보 저장", exact: true })
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
    .getByRole("button", { name: "원안지·문항정보 저장", exact: true })
    .click();
  await dialog.getByText(/등록됨 · 8문항 · 원안지 2쪽/).waitFor();
  const saved = await page.evaluate(() => ({
    count: window.examQa.students.length,
    hasStudentPayload: "students" in window.examQa.saved,
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
  assert.equal(saved.hasStudentPayload, false);
  assert.equal(saved.crops.length, 8);
  assert.ok(
    saved.crops.every(
      (crop) => crop.status === "ready" && crop.highlights === 1,
    ),
  );
  const paperBefore = await page.evaluate(async () => {
    const digest = async (blob) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
        ),
      ).join(",");
    return Promise.all(
      window.examQa.saved.files.map(async (file) => [
        file.fileName,
        await digest(file.blob),
      ]),
    );
  });
  assert.equal(
    await dialog
      .getByLabel("원안지 PDF", { exact: true })
      .evaluate((el) => el.files.length),
    0,
    "PDF input clears after successful save",
  );
  await dialog.getByLabel("시험일", { exact: true }).fill("2026-11-15");
  await dialog
    .getByLabel("문항정보표 엑셀")
    .setInputFiles(path.join(out, "updated-metadata.xlsx"));
  await dialog.getByRole("button", { name: "자료 확인", exact: true }).click();
  await dialog.getByText(/8문항 · PDF 2쪽/).waitFor();
  await dialog
    .getByRole("button", { name: "원안지·문항정보 저장", exact: true })
    .click();
  await dialog.getByText(/등록됨 · 8문항 · 원안지 2쪽/).waitFor();
  const paperAfter = await page.evaluate(async () => {
    const digest = async (blob) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
        ),
      ).join(",");
    return Promise.all(
      window.examQa.saved.files.map(async (file) => [
        file.fileName,
        await digest(file.blob),
      ]),
    );
  });
  assert.deepEqual(
    paperAfter,
    paperBefore,
    "Metadata-only changes preserve original PDF and page bytes",
  );
  assert.equal(
    await page.evaluate(() => window.examQa.saved.examDate),
    "2026-11-15",
  );
  assert.equal(
    await page.evaluate(
      () => window.examQa.saved.questions[0].targetAchievementLevel,
    ),
    "E",
  );
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.examQa.students)),
    originalStudents,
    "All ledger responses remain unchanged after both materials saves",
  );
  assert.equal(
    await page.evaluate(() => window.examQa.students.length),
    24,
    "Materials save leaves ledger responses untouched",
  );
  await dialog
    .getByRole("button", { name: "업로드 창 닫기", exact: true })
    .click();
  await page.getByRole("button", { name: "평가 분석", exact: true }).click();
  await page
    .locator(".written-exam-filters select")
    .nth(0)
    .selectOption("qa-exam");
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
  // An old account's delayed essay refresh may finish after a new auth render.
  // The old rows and their feedback must remain hidden and may not start a mock read.
  await essayTab.click();
  await ready();
  await page.locator(".written-exam-filters select").nth(2).selectOption("3");
  await pagination
    .getByRole("button", { name: "2페이지, 3학년 2반", exact: true })
    .click();
  const accountStart = await callCount();
  await page.evaluate(() => {
    window.examQa.pauseOps = ["load"];
  });
  await page.getByRole("button", { name: "정기시험 분석 새로고침" }).click();
  await page.waitForFunction(() => window.examQa.releases.length === 1);
  await page.evaluate(() => {
    window.examQa.pauseOps = [];
    window.examQa.setAuth({ currentUser: { uid: "qa-teacher-second" } });
  });
  await page.waitForFunction(
    () => document.querySelector(".written-exam-filters select").value === "",
  );
  assert.equal(
    await page.locator(".wea-analysis").count(),
    0,
    "Account changes hide the prior student's table immediately",
  );
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.evaluate(async () => {
    window.examQa.releases.splice(0).forEach((resolve) => resolve());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await ready();
  assert.equal(
    await page.locator(".wea-analysis").count(),
    0,
    "An old refresh cannot republish the prior account's result",
  );
  const accountCalls = await callsSince(accountStart);
  assert.deepEqual(
    accountCalls.map(({ op }) => op),
    ["list", "load", "list"],
  );
  assert.equal(accountCalls[2].owner, "qa-teacher-second");
  await page.evaluate(() => {
    window.examQa.failLoad = true;
  });
  await page
    .locator(".written-exam-filters select")
    .nth(0)
    .selectOption("qa-exam");
  await page
    .getByRole("alert")
    .filter({ hasText: "합성 서버 읽기 실패" })
    .waitFor();
  assert.equal(
    await page.locator(".wea-analysis").count(),
    0,
    "New-account errors cannot revive an old account cache",
  );
  await page.evaluate(() => {
    window.examQa.failLoad = false;
  });
  await page.getByRole("button", { name: "정기시험 분석 새로고침" }).click();
  await ready();
  assert.equal(await studentTable.locator("tbody tr").count(), 12);
  assert.equal(
    await pagination
      .getByRole("button", { name: "1페이지, 3학년 1반", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  const semesterStart = await callCount();
  await page.evaluate(() =>
    window.examQa.setAuth({ config: { year: "2027", semester: "1" } }),
  );
  await page.waitForFunction(
    () => document.querySelector(".written-exam-filters select").value === "",
  );
  await ready();
  assert.equal(
    await page.locator(".wea-analysis").count(),
    0,
    "Semester changes clear the prior semester's visible analysis",
  );
  const semesterCalls = await callsSince(semesterStart);
  assert.deepEqual(
    semesterCalls.map(({ op }) => op),
    ["list"],
  );
  assert.equal(semesterCalls[0].year, "2027");
  assert.equal(semesterCalls[0].semester, "1");
  boundaryChecks.push({ accountCalls, semesterCalls, staleResultHidden: true });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        evidence,
        essayChecks,
        boundaryChecks,
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
    `PASS written exam UI: choice 7 + essay 4 reports at 390/768/1280/1440; full-group charts, blank-feedback counts, class pagination, feedback dialogs; typed source calls, refresh/filter/page preservation, account/semester/late-response recovery; materials-only XLSX+PDF save and byte preservation; question image/focus. Source read counts here are facade contracts; real source requests are verified by verify-written-exam-score-source.mjs. Evidence: ${out}`,
  );
} catch (error) {
  await page?.screenshot({
    path: path.join(out, "failure.png"),
    fullPage: true,
  });
  await fs.writeFile(path.join(out, "failure.html"), await page.content());
  const failureCalls = await page.evaluate(() => window.examQa.calls);
  await fs.writeFile(
    path.join(out, "failure-calls.json"),
    JSON.stringify(failureCalls, null, 2),
  );
  console.log("LAST QA CALLS", failureCalls.slice(-8));
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
