/** Actual lesson components, synthetic data and offline adapters; no production reads/writes. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    process.env.PLAYWRIGHT_MODULE_PATH ||
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
      ),
  );
}
const evidence = path.join(root, "output/lesson-alternative-answers");
await fs.mkdir(evidence, { recursive: true });
const tailwindCache = path.join(os.tmpdir(), "westory-tailwind-fixture.js");
let tailwind;
try {
  tailwind = await fs.readFile(tailwindCache, "utf8");
} catch {
  const response = await fetch("https://cdn.tailwindcss.com/3.4.17");
  assert(response.ok, "Tailwind fixture preparation failed");
  tailwind = await response.text();
  await fs.writeFile(tailwindCache, tailwind);
}
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const source = `import React,{useRef,useState} from 'react';import{createRoot}from'react-dom/client';
import{LessonPdfSection}from ${imp("src/pages/teacher/components/LessonEditorPanels.tsx")};
import LessonContent from ${imp("src/pages/student/lesson/components/LessonContent.tsx")};
import TeacherLessonPresentation from ${imp("src/pages/teacher/components/TeacherLessonPresentation.tsx")};
import{normalizeLessonData}from ${imp("src/lib/lessonData.ts")};
import{normalizeWorksheetBlanks}from ${imp("src/lib/lessonWorksheet.ts")};
const pages=[1,2].map(page=>({page,imageUrl:'/worksheet.svg',width:1000,height:1400}));
const blanks=[{id:'blank-1',page:1,leftRatio:.15,topRatio:.2,widthRatio:.3,heightRatio:.06,answer:'고조선',alternativeAnswers:['조선','단군 조선'],source:'ocr'},
{id:'blank-2',page:2,leftRatio:.15,topRatio:.2,widthRatio:.3,heightRatio:.06,answer:'대한민국',alternativeAnswers:['한국'],source:'manual'}];
const lesson=normalizeLessonData({unitId:'fixture-unit',title:'빈칸 복수 정답 검증',isVisibleToStudents:true,contentRevision:1,semesterRevision:1,contentHtml:'<p>[세종]</p>',worksheetPageImages:pages,worksheetBlanks:blanks});
const mode=new URLSearchParams(location.search).get('mode')||'teacher';
const noop=()=>{};
function Teacher(){const[items,setItems]=useState(()=>JSON.parse(sessionStorage.getItem('teacher-blanks')||'null')||blanks);const[id,setId]=useState(null);const[answer,setAnswer]=useState('');const[alternatives,setAlternatives]=useState('');const[prompt,setPrompt]=useState('');const input=useRef(null);
const select=(id)=>{const item=items.find(b=>b.id===id);setId(id);setAnswer(item.answer);setAlternatives((item.alternativeAnswers||[]).join('\\n'));setPrompt(item.prompt||'')};
const apply=()=>{const next=normalizeWorksheetBlanks(items.map(b=>b.id===id?{...b,answer,alternativeAnswers:alternatives.split(/\\r?\\n/),prompt}:b));setItems(next);sessionStorage.setItem('teacher-blanks',JSON.stringify(next));setId(null)};
return <><output data-testid="teacher-state" className="sr-only">{JSON.stringify(items)}</output><LessonPdfSection pdfBusy={false} selectedPdfFile={null} lessonPdfName="합성 학습지.pdf" lessonPdfUrl="" pdfProcessing={lesson.pdfProcessing} worksheetPageImages={pages} worksheetTextRegions={[]} worksheetBlanks={items} worksheetExamHighlights={[]} worksheetFootnoteAnchors={[]} worksheetTool="ocr" activeBlankId={id} draftBlank={null} draftBlankAnswer={answer} draftBlankAlternativeAnswers={alternatives} draftBlankPrompt={prompt} blankEditorMode={id?'existing':null} sortedBlanks={items} pdfInputRef={input} onPdfFileChange={noop} onPreparePdf={noop} onRemovePdf={noop} onWorksheetToolChange={noop} onSelectBlank={select} onDeleteBlank={noop} onCreateBlankFromSelection={noop} onDraftBlankAnswerChange={setAnswer} onDraftBlankAlternativeAnswersChange={setAlternatives} onDraftBlankPromptChange={setPrompt} onConfirmDraftBlank={apply} onCancelDraftBlank={()=>setId(null)} onUpdateBlank={noop} hasUnsavedPdfChanges={false} pdfSaveState="saved" onSavePdf={noop} disablePdfSave={false}/></>}
window.__fixtureLesson=lesson;window.__savedCalls=[];window.__toasts=[];
const content=mode==='teacher'?<Teacher/>:mode==='present'?<TeacherLessonPresentation lesson={lesson} classId="fixture-class" classLabel="합성 학급"/>:<LessonContent unitId="fixture-unit" lessonOverride={lesson} disablePersistence={mode==='preview'} allowHiddenAccess={mode==='preview'}/>;
createRoot(document.getElementById('root')).render(<main style={{padding:12,maxWidth:1280,margin:'auto'}}>{content}</main>);`;
const forbidden =
  "const forbidden=()=>{throw new Error('Unexpected data operation in offline fixture')};";
const adapters = new Map([
  [
    "AuthContext",
    "const config={year:2026,semester:2};const currentUser={uid:'fixture-student'};export const useAuth=()=>({config,currentUser});",
  ],
  [
    "AppToastProvider",
    "export const useAppToast=()=>({showToast:value=>window.__toasts.push(value)});",
  ],
  [
    "firebase/firestore",
    "export const doc=(_db,path)=>({path}),collection=doc;export const getDoc=async(ref)=>({exists:()=>ref.path.includes('/units/'),data:()=>({answerRevision:0,answers:{'blank-2':{value:'한국',status:'wrong'}}})});export const getDocs=async()=>({docs:[]});",
  ],
  [
    "firebase/storage",
    "export const ref=(_storage,path)=>({path});export const getDownloadURL=async()=>'/worksheet.svg';",
  ],
  [
    "firebase",
    forbidden +
      "export const db={};export const getHttpsCallable=forbidden;export const getFirebaseStorage=async()=>({});",
  ],
  [
    "points",
    "export const claimPointActivityReward=async()=>({awarded:false,amount:0});",
  ],
  [
    "learningCommands",
    forbidden +
      `export const recordLessonCorePointFind=forbidden,claimLessonCorePointReward=forbidden;
export const saveLessonAnswers=async(_config,input)=>{window.__savedCalls.push(input);const normalized=s=>String(s||'').replace(/\\s+/g,'');const answers=Object.fromEntries(Object.entries(input.answers).map(([id,value])=>{const blank=window.__fixtureLesson.worksheetBlanks.find(b=>b.id===id);const accepted=blank?[blank.answer,...(blank.alternativeAnswers||[])]:['세종'];return[id,{value,status:accepted.some(a=>normalized(a)===normalized(value))?'correct':'wrong'}]}));return{answerRevision:1,answers,totalCount:Object.keys(answers).length,correctCount:Object.values(answers).filter(a=>a.status==='correct').length}};`,
  ],
  [
    "studentLessonReadCache",
    forbidden +
      "export const readStudentLesson=forbidden;export const readStudentVisibleLessons=async()=>[];",
  ],
]);
const bundle = await build({
  stdin: { contents: source, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  outdir: "fixture",
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "offline-adapters",
      setup(build) {
        build.onResolve({ filter: /./ }, (args) => {
          const key = args.path.startsWith("firebase/")
            ? args.path
            : args.path.split("/").at(-1);
          return adapters.has(key)
            ? { path: key, namespace: "offline" }
            : undefined;
        });
        build.onLoad({ filter: /.*/, namespace: "offline" }, (args) => ({
          contents: adapters.get(args.path),
          loader: "js",
        }));
      },
    },
  ],
});
const css =
  (
    await Promise.all(
      ["assets/css/style.css", "src/assets/index.css"].map((file) =>
        fs.readFile(path.join(root, file), "utf8"),
      ),
    )
  )
    .join("\n")
    .replaceAll(/@import[^;]+;/g, "")
    .replaceAll(/@tailwind[^;]+;/g, "") +
  bundle.outputFiles
    .filter((file) => file.path.endsWith(".css"))
    .map((file) => file.text)
    .join("\n");
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}body{margin:0}#root{min-width:0}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="1000" height="1400" fill="white"/><text x="150" y="320" font-size="40">고조선</text></svg>';
const server = http.createServer((req, res) => {
  const route = req.url.split("?")[0];
  res.setHeader(
    "Content-Type",
    route.endsWith(".js")
      ? "text/javascript"
      : route.endsWith(".svg")
        ? "image/svg+xml"
        : "text/html;charset=utf-8",
  );
  res.end(
    route === "/fixture.js"
      ? bundle.outputFiles.find((file) => file.path.endsWith(".js")).text
      : route === "/tailwind.js"
        ? tailwind
        : route.endsWith(".svg")
          ? svg
          : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const reports = [];
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
const waitStatus = async (input, status) => {
  await input
    .page()
    .waitForFunction(
      ({ selector, status }) =>
        document.querySelector(selector)?.getAttribute("title") === status,
      {
        selector: await input.evaluate(
          (e) => `input[data-blank-id="${e.dataset.blankId}"]`,
        ),
        status,
      },
      { timeout: 10000 },
    );
};
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 900 },
    { width: 390, height: 420 },
  ]) {
    const context = await browser.newContext({ viewport });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/?mode=teacher`);
    await page.locator('[data-blank-box][data-blank-id="blank-1"]').click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(
      await dialog.getByLabel("기본 정답", { exact: true }).inputValue(),
      "고조선",
    );
    const alternatives = dialog.getByLabel("중복 답안", { exact: false });
    assert.equal(await alternatives.inputValue(), "조선\n단군 조선");
    await alternatives.fill(
      "조선\n단군 조선\n\n 고 조 선 \n조 선\n단군왕검의 조선",
    );
    await page.screenshot({
      path: path.join(
        evidence,
        `teacher-${viewport.width}x${viewport.height}.png`,
      ),
    });
    const bounds = await dialog.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        right: r.right,
        bottom: r.bottom,
        width: innerWidth,
        height: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    assert(
      bounds.x >= 0 &&
        bounds.right <= bounds.width + 1 &&
        bounds.y >= 0 &&
        bounds.bottom <= bounds.height + 1,
      `dialog exceeds ${viewport.width}x${viewport.height}: ${JSON.stringify(bounds)}`,
    );
    assert(!bounds.overflow, "teacher document overflows horizontally");
    await dialog.getByRole("button", { name: "적용", exact: true }).click();
    let stored = JSON.parse(
      await page.getByTestId("teacher-state").textContent(),
    );
    assert.equal(
      stored[0].answer,
      "고조선",
      "canonical OCR answer changed while adding alternatives",
    );
    assert.deepEqual(stored[0].alternativeAnswers, [
      "조선",
      "단군 조선",
      "단군왕검의 조선",
    ]);
    await page.reload();
    await page.locator('[data-blank-box][data-blank-id="blank-1"]').click();
    assert.equal(
      await alternatives.inputValue(),
      "조선\n단군 조선\n단군왕검의 조선",
      "alternatives survive reopen",
    );
    await alternatives.fill("");
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await page.locator('[data-blank-box][data-blank-id="blank-1"]').click();
    assert.equal(
      await alternatives.inputValue(),
      "조선\n단군 조선\n단군왕검의 조선",
      "cancel discarded persisted alternatives",
    );
    await alternatives.fill("");
    await dialog.getByRole("button", { name: "적용", exact: true }).click();
    stored = JSON.parse(await page.getByTestId("teacher-state").textContent());
    assert.equal(stored[0].answer, "고조선");
    assert.deepEqual(
      stored[0].alternativeAnswers || [],
      [],
      "clear removes alternatives",
    );
    assert.deepEqual(errors, []);
    reports.push({ viewport, mode: "teacher", passed: true });
    await context.close();
  }
  for (const width of [390, 768, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/?mode=student`);
    const input = page.locator('input[data-blank-id="blank-1"]');
    await input.waitFor();
    for (const value of ["고조선", "조선", " 단군  조선 "]) {
      await input.fill(value);
      await input.blur();
      await waitStatus(input, "정답");
    }
    await input.fill("고구려");
    await input.blur();
    await waitStatus(input, "오답");
    await input.fill("");
    await input.blur();
    assert.equal(
      await input.getAttribute("title"),
      null,
      "empty blur remains ungraded",
    );
    await input.fill("단군조선");
    await input.blur();
    await waitStatus(input, "정답");
    await page.locator(".cloze-input").fill("세종");
    await page
      .getByRole("button", { name: "다음 페이지", exact: true })
      .click();
    const second = page.locator('input[data-blank-id="blank-2"]');
    await second.waitFor();
    assert.equal(
      await second.inputValue(),
      "한국",
      "hidden-page stored alternative preserved",
    );
    await second.focus();
    await second.blur();
    await waitStatus(second, "정답");
    await page.getByRole("button", { name: "저장 가능", exact: true }).click();
    await page.waitForFunction(() => window.__savedCalls.length === 1);
    assert.deepEqual(
      await page.evaluate(() => window.__savedCalls[0].answers),
      { 0: "세종", "blank-1": "단군조선", "blank-2": "한국" },
    );
    await page
      .getByRole("button", { name: "이전 페이지", exact: true })
      .click();
    await input.waitFor();
    assert.equal(await input.inputValue(), "단군조선");
    await waitStatus(input, "정답");
    assert.equal(
      await page.getByLabel("중복 답안", { exact: false }).count(),
      0,
      "teacher editor leaked to student",
    );
    await page.screenshot({
      path: path.join(evidence, `student-${width}.png`),
    });
    await page.goto(`${origin}/?mode=present`);
    await page.locator('img[alt="학습지 1페이지"]').waitFor();
    assert.equal(
      await page.locator(".worksheet-blank-input").count(),
      0,
      "teacher presentation became student solve",
    );
    assert.equal(
      await page.getByLabel("중복 답안", { exact: false }).count(),
      0,
      "teacher presentation became editor",
    );
    assert.deepEqual(errors, []);
    reports.push({ width, mode: "student and teacher-present", passed: true });
    await context.close();
  }
  await fs.writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify(reports, null, 2),
  );
  console.log(JSON.stringify({ passed: reports.length, evidence }, null, 2));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
