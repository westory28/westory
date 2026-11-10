/** Real notebook, popup and worksheet; synthetic reads/writes, no production data. */
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
const evidence =
  process.env.QUIZ_LESSON_POPUP_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-lesson-popup-")));
await fs.mkdir(evidence, { recursive: true });
const service = `
export const qa=window.popupQa={reads:[],saves:[],toasts:[],config:{year:'2026',semester:'2'},user:{uid:'student-a'},failTree:false};
export const useAuth=()=>({config:qa.config,currentUser:qa.user});
export const useAppToast=()=>({showToast:value=>qa.toasts.push(value)});
export const db={};export const doc=(_db,...paths)=>({path:paths.join('/')});export const collection=doc;
export const getDoc=async ref=>{qa.reads.push(ref.path);if(qa.failProgress){qa.failProgress=false;throw Error('Progress offline')}return{exists:()=>true,data:()=>({answerRevision:4,answers:{blank:{value:qa.user.uid==='student-a'?'고조선':'조선',status:'correct'}},corePointFinds:['point']})}};
const forbidden=()=>{throw Error('Unexpected bulk read or command')};
export const getDocs=forbidden,getHttpsCallable=forbidden,recordLessonCorePointFind=forbidden,claimLessonCorePointReward=forbidden;
export const getFirebaseStorage=async()=>({});export const ref=(_storage,path)=>({path});export const getDownloadURL=async()=>'/worksheet.svg';
export const readStudentVisibleCurriculumTree=async()=>{qa.reads.push('tree');if(qa.failTree){qa.failTree=false;throw Error('Tree offline')}return[{id:'big',title:'대단원',children:[{id:'middle',title:'중단원',children:[{id:'a',title:'첫 번째 학습지'},{id:'b',title:'두 번째 학습지'}]}]}]};
export const readStudentVisibleLessons=forbidden;
export const readStudentLesson=async(_config,unitId)=>{qa.reads.push('lesson:'+unitId);return {unitId,title:unitId==='a'?'첫 번째 학습지':'두 번째 학습지',contentRevision:2,semesterRevision:1,worksheetPageImages:[1,2].map(page=>({page,width:1000,height:1400,imageUrl:'/worksheet.svg'})),worksheetBlanks:[{id:'blank',page:1,leftRatio:.1,topRatio:.1,widthRatio:.3,heightRatio:.05,answer:'고조선',source:'manual'}],worksheetExamHighlights:[{id:'point',page:1,leftRatio:.1,topRatio:.3,widthRatio:.3,heightRatio:.05}],isVisibleToStudents:true}};
export const claimPointActivityReward=async()=>({awarded:false});
export const saveLessonAnswers=async(_config,input)=>{qa.saves.push(input);return {answerRevision:5,answers:Object.fromEntries(Object.entries(input.answers).map(([id,value])=>[id,{value,status:'correct'}])),totalCount:1,correctCount:1}};
`;
const entry = `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import Review from './src/pages/student/quiz/QuizRelearning';
import './src/pages/student/quiz/QuizLearning.css';
import './src/assets/index.css';
import {qa}from'fixture:service';
const item={id:'q',type:'choice',question:'합성 복습 문항',options:['가','나'],answer:'가',submittedAnswer:'나',concepts:[],explanation:'합성 해설',reviewLessonId:'a'};
function App(){const[tick,setTick]=useState(0);const[open,setOpen]=useState(true);window.changeScope=(uid,semester)=>{qa.user={uid};qa.config={year:'2026',semester};setTick(tick+1)};return open?<Review items={[item]} onClose={()=>setOpen(false)}/>:<span>결과</span>};
createRoot(document.getElementById('root')).render(<App/>);
`;
const adapters = new Set([
  "AuthContext",
  "AppToastProvider",
  "firebase",
  "firebase/firestore",
  "firebase/storage",
  "studentLessonReadCache",
  "points",
  "learningCommands",
]);
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd() },
  bundle: true,
  write: false,
  outdir: "fixture",
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".woff2": "dataurl", ".woff": "dataurl", ".svg": "dataurl" },
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
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;padding:16px}#root{max-width:1000px;margin:auto}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
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
  external = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
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
  await page.goto(origin);
  const open = () =>
    page
      .getByRole("button", { name: "연결된 학습지 열기", exact: true })
      .click();
  await open();
  const popup = page.getByRole("dialog", { name: "학습지", exact: true });
  const input = () =>
    popup.locator(
      ".quiz-lesson-popup__body:not([hidden]) .worksheet-blank-input",
    );
  await input().waitFor();
  await page.waitForFunction(
    () => document.querySelector(".worksheet-blank-input")?.value === "고조선",
  );
  assert.equal(page.url(), origin + "/");
  assert.equal(await page.context().pages().length, 1);
  const menu = () =>
    popup.getByRole("button", { name: "목차", exact: true }).click();
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await menu();
    assert.deepEqual(
      await popup
        .getByRole("navigation", { name: "학습지 목차" })
        .getByRole("button")
        .allTextContents(),
      ["첫 번째 학습지", "두 번째 학습지"],
    );
    const bounds = await popup.evaluate((node) => ({
      right: node.getBoundingClientRect().right,
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    }));
    assert.equal(bounds.overflow, false);
    assert(bounds.right <= bounds.width + 1);
    await page.screenshot({
      path: path.join(evidence, "popup-" + width + ".png"),
    });
    await page.keyboard.press("Escape");
    assert(await popup.isVisible());
  }
  await input().fill("내가 채운 내용");
  await menu();
  await popup
    .getByRole("button", { name: "두 번째 학습지", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(
        ".quiz-lesson-popup__body:not([hidden]) .worksheet-blank-input",
      )?.value === "고조선",
  );
  await menu();
  await popup
    .getByRole("button", { name: "첫 번째 학습지", exact: true })
    .click();
  assert.equal(await input().inputValue(), "내가 채운 내용");
  await popup.getByRole("button", { name: "학습지 닫기", exact: true }).click();
  await open();
  assert.equal(await input().inputValue(), "내가 채운 내용");
  const reads = await page.evaluate(() => window.popupQa.reads);
  assert.equal(reads.filter((value) => value === "tree").length, 1);
  assert.equal(reads.filter((value) => value === "lesson:a").length, 1);
  assert.equal(reads.filter((value) => value === "lesson:b").length, 1);
  assert.equal(reads.filter((value) => value.includes("/units/")).length, 2);
  assert.equal(
    reads.length,
    5,
    "Only catalog and selected lesson/progress reads; no reward bulk reads",
  );
  assert.deepEqual(await page.evaluate(() => window.popupQa.saves), []);
  await popup.getByRole("button", { name: "저장 가능", exact: true }).click();
  await page.waitForFunction(() => window.popupQa.saves.length === 1);
  assert.equal(
    (await page.evaluate(() => window.popupQa.saves[0])).answers.blank,
    "내가 채운 내용",
  );
  assert.equal(
    (await page.evaluate(() => window.popupQa.saves[0])).expectedAnswerRevision,
    4,
  );
  await page.evaluate(() => window.changeScope("student-b", "1"));
  await page.waitForFunction(
    () =>
      document.querySelector(
        ".quiz-lesson-popup__body:not([hidden]) .worksheet-blank-input",
      )?.value === "조선",
  );
  assert.equal(
    await popup.locator(".quiz-lesson-popup__body").count(),
    1,
    "Old account/semester cached lesson panes are discarded",
  );
  assert(
    (await page.evaluate(() => window.popupQa.reads)).includes(
      "years/2026/semesters/1/lesson_progress/student-b/units/a",
    ),
  );
  await page.evaluate(() => {
    window.popupQa.failProgress = true;
    window.changeScope("student-c", "2");
  });
  await popup.getByRole("alert").waitFor();
  assert.equal(
    await popup.locator(".worksheet-blank-input:visible").count(),
    0,
    "Failed saved-answer reads never look like empty answers",
  );
  await popup
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(
        ".quiz-lesson-popup__body:not([hidden]) .worksheet-blank-input",
      )?.value === "조선",
  );
  await page.keyboard.press("Escape");
  assert.equal(await popup.isVisible(), false);
  assert.equal(
    await page
      .getByRole("button", { name: "연결된 학습지 열기", exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    JSON.stringify({
      pass: true,
      evidence,
      checks:
        "390/768/1280, no navigation, saved answers, draft retention, dropdown order, five bounded reads, explicit save revision, account/semester reset, Escape/focus",
    }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
