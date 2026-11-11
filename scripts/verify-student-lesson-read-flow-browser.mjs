/** Real Note/LessonContent/cache, synthetic services only; no production access. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const baseline = process.argv.includes("--baseline");
const evidence = path.resolve("output/broad-stability-20261111/lessons");
await fs.mkdir(evidence, { recursive: true });
const service = `
const makeUser=uid=>({uid,getIdTokenResult:async()=>({claims:{auth_time:100}})});
export const qa=window.lessonQa={reads:[],saves:[],toasts:[],config:{year:'2026',semester:'2'},user:makeUser('student-a'),failLesson:false,failProgress:false,failTree:false,gates:{},hidden:false};
export const auth={currentUser:qa.user};export const db={};
export const useAuth=()=>({config:qa.config,currentUser:qa.user,menuConfig:null});
export const useAppToast=()=>({showToast:value=>qa.toasts.push(value)});
export const useGongsinAvailability=()=>({enabled:false,loading:false,semesterId:'2026-2'});
export const getGongsinQuestionUrl=()=>{throw Error('Q&A closed')};
export const isSemesterArchive=false,archiveScope=null;
export const doc=(_db,...paths)=>({path:paths.join('/')});export const collection=doc;
export const orderBy=()=>({});export const query=(ref)=>ref;
const tree=[{id:'big',title:'대단원',children:[{id:'middle',title:'중단원',children:['a','b'].map(id=>({id,title:'자료 '+id}))}]}];
const lesson=id=>({unitId:id,title:'자료 '+id,updatedAt:id==='a'?1:2,contentRevision:2,semesterRevision:1,contentHtml:'<p>합성 수업 자료 '+id+' [고조선]</p>',worksheetPageImages:[1,2].map(page=>({page,width:1000,height:1400,imageUrl:'/worksheet.svg'})),worksheetBlanks:[{id:'blank',page:1,leftRatio:.1,topRatio:.1,widthRatio:.3,heightRatio:.05,answer:'고조선',source:'manual'}],worksheetExamHighlights:[{id:'point',page:1,leftRatio:.1,topRatio:.3,widthRatio:.3,heightRatio:.05}],isVisibleToStudents:true});
qa.previewLesson=lesson('a');
export const getHistoryDictionaryCallable=async()=>async request=>{qa.reads.push({type:'callable',...request});const gate=qa.gates[request.unitId||request.view];if(gate)await gate;if(qa.failLesson&&request.unitId){qa.failLesson=false;throw Error('Lesson offline')}const rows=request.unitId?(qa.hidden?[]:[lesson(request.unitId)]):['a','b'].map(lesson);return{data:{scopedLessons:request.view==='catalog'?rows.map(({unitId,title,updatedAt})=>({unitId,title,updatedAt})):rows,legacyLessons:[]}}};
export const getDoc=async ref=>{qa.reads.push({type:'doc',path:ref.path});if(ref.path.endsWith('/curriculum/tree')){if(qa.failTree){qa.failTree=false;throw Error('Tree offline')}return{exists:()=>true,data:()=>({tree})}}if(ref.path.includes('/units/')){const uid=ref.path.includes('/student-a/')?'student-a':'student-b';if(qa.gates.progress)await qa.gates.progress;if(qa.failProgress){qa.failProgress=false;throw Error('Progress offline')}return{exists:()=>true,data:()=>({answerRevision:4,answers:{blank:{value:uid==='student-a'?'고조선':'조선',status:'correct'},0:{value:uid==='student-a'?'고조선':'조선',status:'correct'}},corePointFinds:['point']})}}return{exists:()=>true,data:()=>({corePointRewardClaimed:false})}};
export const getDocs=async ref=>{qa.reads.push({type:'query',path:ref.path});if(qa.gates.overview)await qa.gates.overview;return{docs:['a','b'].map(id=>({id,data:()=>({unitId:id,corePointFinds:['point']})}))}};
export const getFirebaseStorage=async()=>({});export const ref=(_storage,path)=>({path});export const getDownloadURL=async()=>'/worksheet.svg';
const forbidden=()=>{throw Error('Unexpected command')};
export const recordLessonCorePointFind=forbidden,claimLessonCorePointReward=forbidden,getHttpsCallable=forbidden;
export const claimPointActivityReward=async()=>({awarded:false});
export const saveLessonAnswers=async(_config,input)=>{qa.saves.push(input);return{answerRevision:5,answers:Object.fromEntries(Object.entries(input.answers).map(([id,value])=>[id,{value,status:'correct'}])),totalCount:1,correctCount:1}};
export const changeIdentity=(uid,semester)=>{qa.user=makeUser(uid);auth.currentUser=qa.user;qa.config={year:'2026',semester}};
`;
const entry = `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MemoryRouter,useNavigate}from'react-router-dom';
import Note from './src/pages/student/lesson/Note';import './src/assets/index.css';import {qa,changeIdentity}from'fixture:service';
import LessonContent from './src/pages/student/lesson/components/LessonContent';
function App(){const[tick,setTick]=useState(0);const[preview,setPreview]=useState(false);const navigate=useNavigate();window.lessonNavigate=id=>navigate('/student/lesson/note'+(id?'?id='+id:''));window.lessonIdentity=(uid,semester)=>{changeIdentity(uid,semester);setTick(t=>t+1)};window.lessonConfig=()=>{qa.config={...qa.config,unrelatedSetting:'changed'};setTick(t=>t+1)};window.lessonPreview=()=>setPreview(true);return preview?<LessonContent unitId="a" lessonOverride={qa.previewLesson} fullscreenPreview/>:<Note/>;}
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/student/lesson/note?id=a']}><App/></MemoryRouter>);
`;
const adapters = new Set([
  "AuthContext",
  "AppToastProvider",
  "firebase",
  "firebase/firestore",
  "firebase/storage",
  "historyDictionarySession",
  "semesterArchive",
  "points",
  "learningCommands",
  "gongsinmoongo",
]);
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd() },
  bundle: true,
  write: false,
  outdir: "fixture",
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  loader: {
    ".woff2": "dataurl",
    ".woff": "dataurl",
    ".svg": "dataurl",
    ".webp": "dataurl",
  },
  plugins: [
    {
      name: "offline",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          const key = args.path.startsWith("firebase/")
            ? args.path
            : args.path.split("/").at(-1);
          if (args.path === "fixture:service" || adapters.has(key))
            return { path: "service", namespace: "offline" };
        });
        build.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
          contents: service,
          loader: "js",
        }));
      },
    },
  ],
});
const js = built.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = built.outputFiles
  .filter((file) => file.path.endsWith(".css"))
  .map((file) => file.text)
  .join("\n")
  .replaceAll(/@import[^;]+;/g, "");
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}#root{min-height:100vh}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="1000" height="1400" fill="white"/><text x="100" y="90" font-size="28">합성 학습지</text></svg>';
const server = http.createServer((req, res) => {
  const [type, body] = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
    "/worksheet.svg": ["image/svg+xml", svg],
  }[req.url] || ["text/html", html];
  res.setHeader("content-type", type + ";charset=utf-8");
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const errors = [],
  external = [],
  report = {
    mode: baseline ? "baseline" : "patched",
    productionReads: 0,
    productionWrites: 0,
  };
let page;
try {
  page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (
      route.request().url().startsWith(origin) ||
      route.request().url().startsWith("data:")
    )
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  const waitAnswer = (expected) =>
    page.waitForFunction(
      (value) =>
        [...document.querySelectorAll(".worksheet-blank-input")].find(
          (node) => node.getClientRects().length,
        )?.value === value,
      expected,
    );
  const readCounts = () =>
    page.evaluate(() => ({
      catalog: lessonQa.reads.filter((r) => r.view === "catalog").length,
      detail: lessonQa.reads.filter((r) => r.type === "callable" && r.unitId)
        .length,
      overviewCatalog: lessonQa.reads.filter((r) => r.view === "progress")
        .length,
      progressRoot: lessonQa.reads.filter(
        (r) => r.type === "doc" && /lesson_progress\/[^/]+$/.test(r.path),
      ).length,
      progressUnits: lessonQa.reads.filter(
        (r) => r.type === "query" && r.path.endsWith("/units"),
      ).length,
      answers: lessonQa.reads.filter(
        (r) => r.type === "doc" && r.path.includes("/units/"),
      ).length,
    }));
  await page.goto(origin);
  await waitAnswer("고조선");
  await page.waitForFunction(() =>
    lessonQa.reads.some((r) => r.type === "query"),
  );
  report.initial = await readCounts();
  if (baseline) {
    assert.equal(report.initial.progressRoot, 2);
    assert.equal(report.initial.progressUnits, 2);
  } else {
    assert.deepEqual(report.initial, {
      catalog: 1,
      detail: 1,
      overviewCatalog: 1,
      progressRoot: 1,
      progressUnits: 1,
      answers: 1,
    });
    await page.evaluate(() => window.lessonNavigate("b"));
    await waitAnswer("고조선");
    await page.waitForFunction(
      () => document.querySelector("h1")?.textContent === "자료 b",
    );
    report.secondUnit = await readCounts();
    assert.equal(
      report.secondUnit.progressUnits,
      2,
      "One full progress query per chosen unit, no stale previous-lesson read",
    );
    assert.equal(report.secondUnit.answers, 2);
    await page.evaluate(() => window.lessonNavigate("a"));
    await waitAnswer("고조선");
    await page.waitForFunction(
      () => document.querySelector("h1")?.textContent === "자료 a",
    );
    report.reentry = await readCounts();
    assert.equal(
      report.reentry.detail,
      2,
      "A/B/A reuses authorized in-memory lesson details",
    );
    assert.equal(report.reentry.overviewCatalog, 1);
    assert.equal(report.reentry.catalog, 1);
    await page.locator(".worksheet-blank-input").fill("보존할 답안");
    await page.locator(".cloze-input").fill("보존할 본문");
    const beforePages = await readCounts();
    await page
      .getByRole("button", { name: "다음 페이지", exact: true })
      .click();
    await page.getByText("페이지 2 / 2", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "이전 페이지", exact: true })
      .click();
    await waitAnswer("보존할 답안");
    assert.deepEqual(
      await readCounts(),
      beforePages,
      "Worksheet/PDF page changes do not reread lesson or progress",
    );
    const beforeConfig = await readCounts();
    await page.evaluate(async () => {
      window.lessonConfig();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    assert.equal(
      await page.locator(".worksheet-blank-input").inputValue(),
      "보존할 답안",
    );
    assert.equal(
      await page.locator(".cloze-input").inputValue(),
      "보존할 본문",
    );
    assert.deepEqual(
      await readCounts(),
      beforeConfig,
      "Unrelated settings do not reread or clear a draft",
    );
    const beforeHidden = await readCounts();
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new PageTransitionEvent("pageshow"));
    });
    assert.deepEqual(
      await readCounts(),
      beforeHidden,
      "Visibility notifications do not add polling or duplicate reads",
    );
    await page.evaluate(() => {
      lessonQa.failProgress = true;
      window.lessonIdentity("student-b", "1");
    });
    await page
      .getByRole("alert")
      .filter({ hasText: "저장된 학습지 입력" })
      .waitFor();
    assert.equal(
      await page.locator(".worksheet-blank-input:visible").count(),
      0,
      "Failed answers are not displayed as empty",
    );
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const alert = page
        .getByRole("alert")
        .filter({ hasText: "저장된 학습지 입력" });
      assert.equal(
        await alert.getByRole("button", { name: "다시 불러오기" }).isVisible(),
        true,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      await page.screenshot({
        path: path.join(evidence, `progress-error-${width}.png`),
      });
    }
    await page
      .getByRole("button", { name: "다시 불러오기", exact: true })
      .click();
    await waitAnswer("조선");
    await page.evaluate(() => {
      lessonQa.gates.progress = new Promise(
        (resolve) => (window.releaseSlowProgress = resolve),
      );
      window.lessonIdentity("student-e", "2");
    });
    await page.locator(".worksheet-blank-input").waitFor();
    await page.locator(".worksheet-blank-input").fill("먼저 입력한 답안");
    await page.locator(".cloze-input").fill("먼저 입력한 본문");
    await page.evaluate(async () => {
      delete lessonQa.gates.progress;
      window.releaseSlowProgress();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    assert.equal(
      await page.locator(".worksheet-blank-input").inputValue(),
      "먼저 입력한 답안",
    );
    assert.equal(
      await page.locator(".cloze-input").inputValue(),
      "먼저 입력한 본문",
      "Late saved answers never replace newer typing",
    );
    assert.equal(
      await page
        .getByRole("alert")
        .filter({ hasText: "저장된 학습지 입력" })
        .count(),
      0,
    );
    await page.evaluate(() => {
      lessonQa.failLesson = true;
      window.lessonIdentity("student-c", "2");
    });
    await page
      .getByRole("button", { name: "다시 불러오기", exact: true })
      .waitFor();
    assert.equal(
      await page.locator(".worksheet-blank-input:visible").count(),
      0,
    );
    await page
      .getByRole("button", { name: "다시 불러오기", exact: true })
      .click();
    await waitAnswer("조선");
    assert.equal(
      await page.locator(".cloze-input").inputValue(),
      "조선",
      "Retry also restores inline answers",
    );
    await page.evaluate(() => {
      lessonQa.gates.b = new Promise(
        (resolve) => (window.releaseOldLesson = resolve),
      );
      window.lessonNavigate("b");
    });
    await page.waitForFunction(() => lessonQa.reads.at(-1)?.unitId === "b");
    await page.evaluate(() => window.lessonIdentity("student-d", "1"));
    await page.evaluate(() => {
      delete lessonQa.gates.b;
      window.releaseOldLesson();
    });
    await waitAnswer("조선");
    assert.equal(
      await page.evaluate(() => lessonQa.saves.length),
      0,
      "Read/retry/navigation never writes student progress",
    );
    await page.evaluate(() => {
      lessonQa.failProgress = true;
      window.lessonPreview();
    });
    await page
      .getByRole("alert")
      .filter({ hasText: "저장된 학습지 입력" })
      .waitFor();
    const beforePreviewRetry = await readCounts();
    await page.evaluate(() => {
      lessonQa.gates.progress = new Promise(
        (resolve) => (window.releasePreviewProgress = resolve),
      );
    });
    const retryPreview = page.getByRole("button", {
      name: "다시 불러오기",
      exact: true,
    });
    await retryPreview.click();
    await page.waitForFunction(
      () => document.querySelector('[role="alert"] button')?.disabled === true,
    );
    await retryPreview.evaluate((button) => {
      for (let i = 0; i < 8; i++) button.click();
    });
    assert.equal(
      (await readCounts()).answers,
      beforePreviewRetry.answers + 1,
      "Fullscreen retry is a single pending answer read",
    );
    assert.equal(
      (await readCounts()).detail,
      beforePreviewRetry.detail,
      "Override retry never reloads the lesson body",
    );
    await page.evaluate(() => {
      delete lessonQa.gates.progress;
      window.releasePreviewProgress();
    });
    await waitAnswer("조선");
    assert.equal(await page.locator(".cloze-input").inputValue(), "조선");
    assert.equal(
      await page
        .getByRole("alert")
        .filter({ hasText: "저장된 학습지 입력" })
        .count(),
      0,
    );
    report.fullscreenRetry = {
      answerReads: 1,
      lessonReads: 0,
      repeatedClicks: 8,
    };
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  report.passed = true;
  report.externalRequests = external.length;
  await fs.writeFile(
    path.join(evidence, `${report.mode}-browser.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ ...report, evidence }, null, 2));
} catch (error) {
  if (page) {
    await fs.writeFile(
      path.join(evidence, "failure.html"),
      await page.content(),
    );
    await page.screenshot({ path: path.join(evidence, "failure.png") });
    console.error(
      JSON.stringify({
        errors,
        external,
        state: await page.evaluate(() => ({
          reads: window.lessonQa?.reads,
          text: document.body.innerText.slice(0, 2000),
        })),
      }),
    );
  }
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
