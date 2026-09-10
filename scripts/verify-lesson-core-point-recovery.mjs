// Actual LessonContent/worksheet UI; controlled asynchronous I/O, no Firebase/network.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = process.cwd(),
  output = mkdtempSync(join(tmpdir(), "westory-core-recovery-"));
const fixture = join(output, "fixture.tsx");
writeFileSync(
  fixture,
  String.raw`
import React,{useSyncExternalStore} from '${root.replaceAll("\\", "/")}/node_modules/react/index.js';
const params=new URLSearchParams(location.search);
const config={year:'2026',semester:'2'},listeners=new Set();
let identity={config,currentUser:{uid:'student-a'},unit:'unit-a',preview:params.has('preview'),fetch:params.has('fetch')};
export const useAuth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>identity);
window.selectLesson=(uid,unit)=>{identity={...identity,currentUser:uid?{uid}:null,unit};listeners.forEach(fn=>fn());};
window.refreshConfig=()=>{identity={...identity,config:{...identity.config}};listeners.forEach(fn=>fn());};
window.refreshTitle=title=>{identity={...identity,fallbackTitle:title};listeners.forEach(fn=>fn());};
window.coreCalls=[];window.coreToasts=[];window.corePointsUpdated=0;
window.addEventListener('points-updated',()=>window.corePointsUpdated++);
const image='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="700"><rect width="800" height="700" fill="white"/><text x="60" y="100" font-size="30">학습 검증</text></svg>');
const lessons=Object.fromEntries(['unit-a','unit-b'].map(unit=>[unit,{unitId:unit,title:unit,contentRevision:1,contentHtml:'<p>[고려] 시대</p>',isVisibleToStudents:true,worksheetPageImages:[{page:1,imageUrl:image,width:800,height:700}],worksheetExamHighlights:[{id:'point-a',page:1,leftRatio:.12,topRatio:.25,widthRatio:.3,heightRatio:.08}],worksheetBlanks:[]}]));
if(params.has('answers'))Object.values(lessons).forEach(lesson=>{lesson.contentHtml='<p>[고려] 시대와 [발해]</p>';lesson.worksheetBlanks=[{id:'worksheet-a',page:1,leftRatio:.12,topRatio:.45,widthRatio:.3,heightRatio:.08,answer:'고려'}];});
if(params.has('noAnswers'))Object.values(lessons).forEach(lesson=>{lesson.contentHtml='';lesson.worksheetBlanks=[];lesson.worksheetExamHighlights=[];});
if(params.has('legacy'))Object.values(lessons).forEach(lesson=>{lesson.contentRevision=0;});
if(params.has('multipage'))Object.values(lessons).forEach(lesson=>{lesson.worksheetPageImages.push({page:2,imageUrl:image,width:800,height:700});lesson.worksheetBlanks.push({id:'worksheet-b',page:2,leftRatio:.12,topRatio:.45,widthRatio:.3,heightRatio:.08,answer:'정답2'});});
export const lessonFor=unit=>lessons[unit];
window.replaceLesson=patch=>{lessons[identity.unit]={...lessons[identity.unit],...patch};identity={...identity};listeners.forEach(fn=>fn());};
window.delayLesson=false;window.lessonReadCalls=[];const lessonReads=[];
window.pendingLessonReads=()=>lessonReads.length;
window.finishLesson=(ok=true,patch={},index=0,code='unavailable')=>{const item=lessonReads.splice(index,1)[0];if(!item)throw Error('No pending lesson read');if(!ok){item.reject(Object.assign(Error('Synthetic lesson read failure'),{code}));return;}item.resolve(patch===null?null:{...item.data,...patch});};
window.delaySave=false;const answerWrites=[];
window.finishAnswerSave=(ok=true)=>{const item=answerWrites.shift();if(!item)throw Error('No pending answer save');if(ok)item.resolve(item.result);else item.reject(Error('Synthetic uncertain save'));};
const progress=new Map(),rewards=new Set(),pending=[],restores=[],overviews=[];
if(params.has('reward'))progress.set('student-a/unit-a',{corePointFinds:['point-a']});
window.delayRestore=params.has('restore');window.delayOverview=params.has('overview');window.failOverview=false;
const unitData=(uid,unit)=>({...params.has('answers')?{answerRevision:uid==='student-b'||unit==='unit-b'?11:7,answers:{'0':{value:'고려',status:'correct'},'1':{value:'발해',status:'correct'},'worksheet-a':{value:'고려',status:'correct'}}}:{},...progress.get(uid+'/'+unit)||{}});
window.cachedAnswerReads=0;
const answerReads=[];window.answerReadCalls=[];window.answerSaves=[];
export const getDocFromServer=ref=>{
 if(!params.has('answers'))return getDoc(ref);
 window.answerReadCalls.push(ref.path);
 const revision=ref.path.includes('student-b')||ref.path.endsWith('unit-b')?11:7;
 const data={answerRevision:revision,answers:{'0':{value:'고려',status:'correct'},'1':{value:'발해',status:'correct'},'worksheet-a':{value:'고려',status:'correct'}},corePointFinds:[]};
 return new Promise((resolve,reject)=>answerReads.push({resolve,reject,data}));
};
window.finishAnswerRead=(ok=true,index=0,revision)=>{const item=answerReads.splice(index,1)[0];if(!item)throw Error('No pending answer read');if(!ok){item.reject(Error('Synthetic answer read failure'));return;}if(revision!==undefined)item.data.answerRevision=revision;item.resolve(snapshot(item.data));};
window.pendingAnswerReads=()=>answerReads.length;
const snapshot=data=>({exists:()=>Object.keys(data).length>0,data:()=>data});
export const db={}; export const doc=(_db,...parts)=>({path:parts.join('/')});export const collection=doc;
export const getDoc=async ref=>{const m=ref.path.match(/lesson_progress\/([^/]+)(?:\/units\/([^/]+))?$/);if(!m)return snapshot({});const [,uid,unit]=m;
 if(unit){window.cachedAnswerReads++;const data=structuredClone(unitData(uid,unit));if(window.delayRestore)return new Promise(resolve=>restores.push(()=>resolve(snapshot(data))));return snapshot(data);}
 if(window.failOverview)throw Error('Synthetic overview failure');const data={corePointRewardClaimed:params.has('staleReward')?false:rewards.has(uid)};if(window.delayOverview)return new Promise((resolve,reject)=>overviews.push(ok=>ok?resolve(snapshot(data)):reject(Error('Old overview failure'))));return snapshot(data);};
export const getDocs=async ref=>{if(window.failOverview)throw Error('Synthetic overview failure');const uid=ref.path.split('/').at(-2);return {docs:['unit-a','unit-b'].map(unit=>({id:unit,data:()=>unitData(uid,unit)}))};};
export const readStudentLesson=async(_config,unit)=>{window.lessonReadCalls.push(unit);const data=structuredClone(lessons[unit]);if(window.delayLesson)return new Promise((resolve,reject)=>lessonReads.push({data,resolve,reject}));return data;};
export const readStudentVisibleLessons=async()=>[lessons[identity.unit]];
const write=(kind,input)=>{const uid=identity.currentUser?.uid;window.coreCalls.push({kind,input,uid});return new Promise((resolve,reject)=>pending.push({kind,input,uid,resolve,reject}));};
export const recordLessonCorePointFind=input=>write('find',input);
export const claimLessonCorePointReward=input=>write('reward',input);
export const saveLessonAnswers=async input=>{window.answerSaves.push(input);const result={unitId:input.unitId,answerRevision:input.expectedAnswerRevision+1,answers:Object.fromEntries(Object.entries(input.answers).map(([key,value])=>[key,{value,status:value==='고려'||value==='발해'?'correct':'wrong'}])),correctCount:1,totalCount:1};if(window.delaySave)return new Promise((resolve,reject)=>answerWrites.push({result,resolve,reject}));return result;};
window.finishCore=(kind,ok=true)=>{const index=pending.findIndex(v=>v.kind===kind);if(index<0)throw Error('No pending '+kind);const item=pending.splice(index,1)[0];if(!ok){item.reject(Error('Synthetic command failure'));return;}if(kind==='find'){progress.set(item.uid+'/'+item.input.unitId,{corePointFinds:['point-a']});item.resolve({result:{settled:true}});}else{rewards.add(item.uid);item.resolve({result:{awarded:true,settled:true,amount:500,totalAwarded:500}});}};
window.finishRestores=()=>{window.delayRestore=false;restores.splice(0).forEach(fn=>fn());};
window.finishOverviews=(ok=true)=>{window.delayOverview=false;overviews.splice(0).forEach(fn=>fn(ok));};
window.seedReward=uid=>rewards.add(uid);
window.pendingCounts=()=>({restore:restores.length,overview:overviews.length,write:pending.length});
export const useAppToast=()=>({showToast:toast=>window.coreToasts.push(toast)});
export const getFirebaseStorage=async()=>({});export const ref=(_storage,path)=>({path});export const getDownloadURL=async()=>image;
export const lazyWithRetry=load=>React.lazy(load);
`,
);
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Lesson from './src/pages/student/lesson/components/LessonContent';import {useAuth,lessonFor} from '${fixture.replaceAll("\\", "/")}';function App(){const state=useAuth();return <React.Suspense fallback="loading"><Lesson unitId={state.unit} fallbackTitle={state.fallbackTitle} lessonOverride={state.fetch?null:lessonFor(state.unit)} disablePersistence={state.preview}/></React.Suspense>};createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('strict')?<React.StrictMode><App/></React.StrictMode>:<App/>);`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  metafile: true,
  define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
  plugins: [
    {
      name: "controlled-lesson-io",
      setup(api) {
        api.onResolve(
          {
            filter:
              /AuthContext$|AppToastProvider$|studentLessonReadCache$|lessonAnswers$|lessonCorePointReward$|lazyWithRetry$|\/lib\/firebase$|firebase\/(firestore|storage)$/,
          },
          () => ({ path: fixture }),
        );
      },
    },
  ],
});
assert.ok(
  !Object.keys(bundle.metafile.inputs).some((path) =>
    /node_modules\/@firebase\//.test(path.replaceAll("\\", "/")),
  ),
);
const css = readFileSync(
  join(
    "dist/assets",
    readdirSync("dist/assets").find((name) => /^main-.*\.css$/.test(name)),
  ),
);
const server = createServer((req, res) => {
  const path = req.url.split("?")[0];
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' data: blob:;connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'",
  );
  res.setHeader(
    "Content-Type",
    path === "/app.js"
      ? "text/javascript"
      : path === "/app.css"
        ? "text/css"
        : "text/html;charset=utf-8",
  );
  res.end(
    path === "/app.js"
      ? bundle.outputFiles[0].contents
      : path === "/app.css"
        ? css
        : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser,
  checks = 0;
const errors = [],
  results = [];
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await context.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(origin + "/")
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  const point = () => page.locator("button.lesson-core-point");
  const found = async (expected) => {
    await page.waitForFunction(
      (expected) =>
        Boolean(
          document.querySelector("button.lesson-core-point:not(.is-unfound)"),
        ) === expected,
      expected,
    );
    checks++;
  };
  const ready = () =>
    page.getByRole("button", { name: /핵심포인트 완주 보상.*받기/ });
  const open = async (query = "") => {
    await page.goto(origin + "/" + query);
    await point().waitFor();
    await page.waitForTimeout(100);
  };
  const finish = (kind, ok = true) =>
    page.evaluate(([kind, ok]) => window.finishCore(kind, ok), [kind, ok]);
  for (const query of ["?strict", "?strict&fetch"]) {
    await open(query);
    assert.equal(await point().count(), 1);
    checks++;
  }
  for (const width of [390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await open();
    await point().click();
    await finish("find");
    await ready().waitFor();
    await ready().click();
    await finish("reward");
    await page.waitForFunction(() =>
      window.coreToasts.some((value) => value.message?.includes("+500")),
    );
    checks++;
    await found(true);
    await page.screenshot({
      path: join(output, `core-normal-${width}.png`),
      fullPage: true,
    });
    await open();
    await point().click();
    await page.evaluate(() => {
      window.failOverview = true;
    });
    await finish("find");
    await page.waitForFunction(() =>
      window.coreToasts.some(
        (value) => value.title === "핵심포인트를 저장했습니다.",
      ),
    );
    await found(true);
    await open("?restore");
    await page.waitForFunction(() => window.pendingCounts().restore > 0);
    await point().click();
    await finish("find");
    await ready().waitFor();
    await page.evaluate(() => window.finishRestores());
    await page.waitForTimeout(100);
    await found(true);
    for (const change of ["unit", "account"]) {
      await open();
      await point().click();
      await page.evaluate(
        (change) =>
          window.selectLesson(
            change === "account" ? "student-b" : "student-a",
            change === "unit" ? "unit-b" : "unit-a",
          ),
        change,
      );
      await found(false);
      await point().click();
      const before = await page.evaluate(() => window.coreToasts.length);
      await finish("find", false);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.coreToasts.length), before);
      checks++;
      await found(true);
      await finish("find");
      await ready().waitFor();
      checks++;
    }
    await open("?reward");
    await ready().waitFor();
    await ready().click();
    await page.evaluate(() => window.selectLesson("student-b", "unit-a"));
    await found(false);
    const before = await page.evaluate(() => window.coreToasts.length);
    await finish("reward");
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.coreToasts.length), before);
    assert.equal(await ready().count(), 0);
    checks += 2;
    await open("?reward");
    await ready().waitFor();
    await ready().click();
    await page.evaluate(() => {
      window.failOverview = true;
    });
    await finish("reward");
    await page.waitForFunction(() =>
      window.coreToasts.some((value) => value.message?.includes("+500")),
    );
    assert.equal(await ready().count(), 0);
    checks++;
    for (const ok of [true, false]) {
      await open("?overview");
      await page.waitForFunction(() => window.pendingCounts().overview > 0);
      await page.evaluate(() => {
        window.delayOverview = false;
      });
      await point().click();
      await finish("find");
      await ready().waitFor();
      await ready().click();
      await finish("reward");
      await page.waitForFunction(() =>
        window.coreToasts.some((value) => value.message?.includes("+500")),
      );
      await page
        .locator(".lesson-core-point-floating-status.is-pending")
        .waitFor({ state: "hidden" });
      const status = await page
        .locator(".lesson-core-point-floating-status")
        .textContent();
      await page.evaluate((ok) => window.finishOverviews(ok), ok);
      await page.waitForTimeout(100);
      assert.equal(
        await page.locator(".lesson-core-point-floating-status").textContent(),
        status,
      );
      assert.equal(await ready().count(), 0);
      checks += 2;
    }
    await open("?reward&staleReward");
    await ready().waitFor();
    await ready().click();
    await finish("reward");
    await page.waitForFunction(() =>
      window.coreToasts.some((value) => value.message?.includes("+500")),
    );
    await page
      .locator(".lesson-core-point-floating-status.is-pending")
      .waitFor({ state: "hidden" });
    assert.equal(await ready().count(), 0);
    checks++;
    await open();
    await point().click();
    await finish("find", false);
    await found(false);
    await point().click();
    await finish("find");
    await ready().waitFor();
    checks++;
    await open("?preview");
    await point().click();
    await found(true);
    assert.equal(await page.evaluate(() => window.coreCalls.length), 0);
    checks++;
    results.push({ width, passed: true });
  }
  const retryAnswers = () =>
    page.getByRole("button", { name: "저장된 답안 다시 확인", exact: true });
  const inline = (index) =>
    page.locator(`.cloze-input[data-blank-index="${index}"]`);
  const pdfBlank = () =>
    page.locator('.worksheet-blank-input[data-blank-id="worksheet-a"]');
  const finishRead = (ok = true, index = 0, revision) =>
    page.evaluate(
      ([ok, index, revision]) => window.finishAnswerRead(ok, index, revision),
      [ok, index, revision],
    );
  const openAnswers = async () => {
    await open("?answers");
    await page.waitForFunction(() => window.pendingAnswerReads() > 0);
    // lessonOverride is normalized again on mount; settle cancelled reads separately.
    while (await page.evaluate(() => window.pendingAnswerReads() > 1))
      await finishRead(false);
    return page.evaluate(() => window.answerReadCalls.length);
  };
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const initialReads = await openAnswers();
    await inline(0).fill("새 초안");
    await pdfBlank().fill("학습지 초안");
    assert.equal(
      await page
        .getByRole("button", { name: "답안 확인 중", exact: true })
        .isDisabled(),
      true,
    );
    checks++;
    await finishRead(false);
    await retryAnswers().waitFor();
    assert.equal(await inline(0).inputValue(), "새 초안");
    assert.equal(await pdfBlank().inputValue(), "학습지 초안");
    checks += 2;
    await retryAnswers().focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (count) => window.answerReadCalls.length === count + 1,
      initialReads,
    );
    await finishRead(false);
    await retryAnswers().waitFor();
    await retryAnswers().evaluate((button) => {
      button.click();
      button.click();
      button.click();
    });
    await page.waitForFunction(
      (count) => window.answerReadCalls.length === count + 2,
      initialReads,
    );
    assert.equal(await page.evaluate(() => window.pendingAnswerReads()), 1);
    checks++;
    await inline(0).fill("재시도 중 초안");
    await point().click();
    await finish("find");
    await finishRead();
    await retryAnswers().waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "저장 가능", exact: true })
      .waitFor();
    assert.equal(await inline(0).inputValue(), "재시도 중 초안");
    assert.equal(await pdfBlank().inputValue(), "학습지 초안");
    assert.equal(await inline(1).inputValue(), "발해");
    checks += 3;
    await found(true);
    await page.getByRole("button", { name: "저장 가능", exact: true }).click();
    await page.waitForFunction(() => window.answerSaves.length === 1);
    const saved = await page.evaluate(() => window.answerSaves[0]);
    assert.equal(saved.expectedAnswerRevision, 7);
    assert.deepEqual(saved.answers, {
      0: "재시도 중 초안",
      1: "발해",
      "worksheet-a": "학습지 초안",
    });
    checks += 2;
    await page.getByRole("button", { name: "저장", exact: true }).waitFor();
    await openAnswers();
    await finishRead(false);
    await retryAnswers().waitFor();
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      button: [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "저장된 답안 다시 확인")
        ?.getBoundingClientRect().height,
    }));
    assert.ok(layout.width <= layout.viewport, JSON.stringify(layout));
    assert.ok(layout.button >= 44);
    checks += 2;
    await page.screenshot({
      path: join(output, `answer-read-error-${width}.png`),
      fullPage: true,
    });
    await retryAnswers().click();
    await finishRead(true, 0, -1);
    await retryAnswers().waitFor();
    assert.equal(await page.evaluate(() => window.answerSaves.length), 0);
    checks++;
    await retryAnswers().click();
    await finishRead(true, 0, 0);
    await page.getByRole("button", { name: "저장", exact: true }).waitFor();
    assert.equal(await inline(0).inputValue(), "고려");
    checks++;
    results.push({ width, scenario: "answer read retry", passed: true });
  }
  for (const change of ["account", "unit", "signout"]) {
    for (const oldSuccess of [true, false]) {
      await openAnswers();
      await finishRead(false);
      await retryAnswers().click();
      await page.waitForFunction(() => window.pendingAnswerReads() === 1);
      await page.evaluate(
        (change) =>
          window.selectLesson(
            change === "signout"
              ? null
              : change === "account"
                ? "student-b"
                : "student-a",
            change === "unit" ? "unit-b" : "unit-a",
          ),
        change,
      );
      if (change !== "signout") {
        await page.waitForFunction(() => window.pendingAnswerReads() === 2);
        await finishRead(true, 1);
        await page.getByRole("button", { name: "저장", exact: true }).waitFor();
        await inline(0).fill("새 문맥 답안");
      }
      await finishRead(oldSuccess);
      await page.waitForTimeout(100);
      assert.equal(await retryAnswers().count(), 0);
      checks++;
      if (change !== "signout") {
        assert.equal(await inline(0).inputValue(), "새 문맥 답안");
        checks++;
        await page
          .getByRole("button", { name: "저장 가능", exact: true })
          .click();
        await page.waitForFunction(() => window.answerSaves.length === 1);
        assert.equal(
          await page.evaluate(
            () => window.answerSaves[0].expectedAnswerRevision,
          ),
          11,
        );
        checks++;
      }
    }
  }
  await open("?answers&preview");
  assert.equal(await page.evaluate(() => window.answerReadCalls.length), 0);
  assert.equal(await retryAnswers().count(), 0);
  checks += 2;
  await open("?answers&fetch");
  await page.waitForFunction(() => window.pendingAnswerReads() === 1);
  await finishRead(false);
  await retryAnswers().click();
  await finishRead();
  await page.getByRole("button", { name: "저장", exact: true }).waitFor();
  await page.evaluate(() => window.refreshConfig());
  await page.waitForFunction(() => window.lessonReadCalls.length === 2);
  assert.equal(await page.evaluate(() => window.cachedAnswerReads), 0);
  checks++;
  await page.waitForFunction(
    () => document.querySelector(".worksheet-blank-input")?.value === "고려",
  );
  assert.equal(await inline(1).inputValue(), "발해");
  checks++;
  await inline(0).fill("변경한 답안");
  await page.getByRole("button", { name: "저장 가능", exact: true }).click();
  await page.waitForFunction(() => window.answerSaves.length === 1);
  assert.deepEqual(await page.evaluate(() => window.answerSaves[0].answers), {
    0: "변경한 답안",
    1: "발해",
    "worksheet-a": "고려",
  });
  checks++;
  await page.goto(origin + "/?answers&noAnswers");
  await page.getByRole("button", { name: "저장", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.answerReadCalls.length), 0);
  checks++;
  const openReadyAnswers = async (fetch = true, extra = "") => {
    await open((fetch ? "?answers&fetch" : "?answers") + extra);
    await page.waitForFunction(() => window.pendingAnswerReads() === 1);
    await finishRead();
    await page.getByRole("button", { name: "저장", exact: true }).waitFor();
  };
  const startLessonRefresh = async () => {
    await page.evaluate(() => {
      window.delayLesson = true;
      window.refreshConfig();
    });
    await page.waitForFunction(() => window.pendingLessonReads() === 1);
  };
  const finishLesson = (ok = true, patch = {}, index = 0, code) =>
    page.evaluate(
      (args) => window.finishLesson(...args),
      [ok, patch, index, code],
    );
  const ownDraft = async () => {
    await inline(0).fill("본문 초안");
    await inline(1).fill("두 번째 초안");
    await pdfBlank().fill("PDF 초안");
  };
  const assertDraft = async () => {
    assert.equal(await inline(0).inputValue(), "본문 초안");
    assert.equal(await inline(1).inputValue(), "두 번째 초안");
    assert.equal(await pdfBlank().inputValue(), "PDF 초안");
    checks += 3;
  };
  const downloadDraft = async () => {
    const promise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "내 답안 내려받기", exact: true })
      .click();
    const download = await promise;
    const contents = readFileSync(await download.path(), "utf8");
    for (const value of ["본문 초안", "두 번째 초안", "PDF 초안"])
      assert.ok(contents.includes(value));
    for (const value of ["student-a", "고려", "비밀정답", "<input"])
      assert.ok(!contents.includes(value));
    assert.equal(download.suggestedFilename(), "내-수업-답안.txt");
    checks += 8;
  };
  for (const width of [390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openReadyAnswers();
    await ownDraft();
    await page.evaluate(() => {
      window.originalInput = document.querySelector(".cloze-input");
      window.originalPdfInput = document.querySelector(
        ".worksheet-blank-input",
      );
    });
    await startLessonRefresh();
    await assertDraft();
    await finishLesson(true, {
      title: "새 수업 제목",
      updatedAt: { seconds: 1 },
    });
    await page
      .getByRole("heading", { name: "새 수업 제목", exact: true })
      .waitFor();
    await assertDraft();
    assert.equal(
      await page.evaluate(
        () =>
          window.originalInput === document.querySelector(".cloze-input") &&
          window.originalPdfInput ===
            document.querySelector(".worksheet-blank-input"),
      ),
      true,
    );
    checks++;
    assert.equal(await page.evaluate(() => window.answerReadCalls.length), 1);
    checks++;
    await startLessonRefresh();
    await finishLesson(false);
    await page
      .getByRole("button", { name: "수업 자료 다시 확인", exact: true })
      .waitFor();
    await assertDraft();
    await page
      .getByRole("button", { name: "수업 자료 다시 확인", exact: true })
      .evaluate((button) => {
        button.click();
        button.click();
      });
    await page.waitForFunction(() => window.pendingLessonReads() === 1);
    await finishLesson();
    await page
      .getByRole("button", { name: "수업 자료 다시 확인", exact: true })
      .waitFor({ state: "hidden" });
    await assertDraft();
    await page.getByRole("button", { name: "저장 가능", exact: true }).click();
    await page.waitForFunction(() => window.answerSaves.length === 1);
    const refreshedSave = await page.evaluate(() => window.answerSaves[0]);
    assert.equal(refreshedSave.expectedAnswerRevision, 7);
    assert.equal(refreshedSave.expectedContentRevision, 1);
    assert.deepEqual(refreshedSave.answers, {
      0: "본문 초안",
      1: "두 번째 초안",
      "worksheet-a": "PDF 초안",
    });
    checks += 3;

    await openReadyAnswers(false);
    await ownDraft();
    await page.evaluate(() =>
      window.replaceLesson({
        title: "동등한 미리보기 자료",
        updatedAt: { seconds: 2 },
      }),
    );
    await page
      .getByRole("heading", { name: "동등한 미리보기 자료", exact: true })
      .waitFor();
    await assertDraft();
    assert.equal(await page.evaluate(() => window.answerReadCalls.length), 1);
    checks++;

    await openReadyAnswers();
    await ownDraft();
    await page.evaluate(() => {
      window.delaySave = true;
    });
    await page.getByRole("button", { name: "저장 가능", exact: true }).click();
    await startLessonRefresh();
    await finishLesson(true, {
      contentRevision: 2,
      contentHtml: "<p>[비밀정답] 새 자료</p>",
    });
    const lockedSave = page.getByRole("button", {
      name: "자료 확인 필요",
      exact: true,
    });
    await lockedSave.waitFor();
    assert.equal(await lockedSave.isDisabled(), true);
    checks++;
    await assertDraft();
    assert.equal(await point().isDisabled(), true);
    checks++;
    await point().evaluate((button) => button.click());
    assert.equal(await page.evaluate(() => window.coreCalls.length), 0);
    checks++;
    await page.evaluate(() => window.finishAnswerSave());
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(() => window.coreToasts.at(-1)?.title),
      "이전 요청의 답안이 저장되었습니다.",
    );
    checks++;
    assert.equal(await lockedSave.isDisabled(), true);
    assert.equal(
      await page.getByText("답안 저장 완료", { exact: true }).count(),
      0,
    );
    checks += 2;
    await downloadDraft();
    await page.screenshot({
      path: join(output, `lesson-changed-draft-${width}.png`),
      fullPage: true,
    });

    for (const kind of ["hidden", "missing", "denied"]) {
      await openReadyAnswers();
      await ownDraft();
      await startLessonRefresh();
      await finishLesson(
        kind !== "denied",
        kind === "missing" ? null : { isVisibleToStudents: false },
        0,
        "permission-denied",
      );
      await page
        .getByRole("button", { name: "내 답안 내려받기", exact: true })
        .waitFor();
      assert.equal(await inline(0).count(), 0);
      assert.equal(await point().count(), 0);
      checks += 2;
      await downloadDraft();
      await page.evaluate(() => {
        window.delayLesson = false;
        window.selectLesson("student-b", "unit-a");
      });
      await page.waitForFunction(() => window.pendingAnswerReads() === 1);
      await finishRead();
      await page.getByRole("button", { name: "저장", exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "내 답안 내려받기", exact: true })
          .count(),
        0,
      );
      assert.equal(await inline(0).inputValue(), "고려");
      checks += 2;
    }
    results.push({
      width,
      scenario: "lesson refresh draft preservation",
      passed: true,
    });
  }
  // A failed save remains based on its original revisions through metadata refresh.
  await openReadyAnswers();
  await ownDraft();
  await page.evaluate(() => {
    window.delaySave = true;
  });
  await page.getByRole("button", { name: "저장 가능", exact: true }).click();
  await page.evaluate(() => window.finishAnswerSave(false));
  await page.getByRole("button", { name: "저장 가능", exact: true }).waitFor();
  await startLessonRefresh();
  await finishLesson();
  await assertDraft();
  await page.getByRole("button", { name: "저장 가능", exact: true }).click();
  await page.waitForFunction(() => window.answerSaves.length === 2);
  assert.deepEqual(
    await page.evaluate(() => window.answerSaves[0]),
    await page.evaluate(() => window.answerSaves[1]),
  );
  checks++;
  await page.evaluate(() => window.finishAnswerSave());
  // Superseded material responses must not lock the current screen.
  await openReadyAnswers();
  await ownDraft();
  await startLessonRefresh();
  await page.evaluate(() => window.refreshTitle("새 목차 제목"));
  await page.waitForFunction(() => window.pendingLessonReads() === 2);
  await finishLesson(true, {}, 1);
  await finishLesson(true, { isVisibleToStudents: false });
  await assertDraft();
  assert.equal(
    await page
      .getByRole("button", { name: "저장 가능", exact: true })
      .isEnabled(),
    true,
  );
  checks++;
  // Legacy revision zero still detects a changed body, while preview accepts explicit material edits.
  await openReadyAnswers(false, "&legacy");
  await ownDraft();
  await page.evaluate(() =>
    window.replaceLesson({ contentHtml: "<p>[비밀정답] 다른 본문</p>" }),
  );
  await page
    .getByRole("button", { name: "자료 확인 필요", exact: true })
    .waitFor();
  await assertDraft();
  await openReadyAnswers(true, "&multipage");
  await ownDraft();
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await page
    .locator('.worksheet-blank-input[data-blank-id="worksheet-b"]')
    .fill("다른 페이지 초안");
  await page.getByRole("button", { name: "이전 페이지", exact: true }).click();
  await startLessonRefresh();
  await finishLesson(true, { isVisibleToStudents: false });
  const multiDownloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "내 답안 내려받기", exact: true })
    .click();
  const multiDownload = await multiDownloadEvent;
  const multiText = readFileSync(await multiDownload.path(), "utf8");
  for (const value of [
    "본문 초안",
    "두 번째 초안",
    "PDF 초안",
    "다른 페이지 초안",
  ])
    assert.ok(multiText.includes(value));
  assert.ok(!multiText.includes("정답2"));
  checks += 5;
  await open("?answers&preview");
  await inline(0).fill("미리보기 초안");
  await page.evaluate(() =>
    window.replaceLesson({
      contentRevision: 2,
      contentHtml: "<p>[새정답] 새 미리보기</p>",
    }),
  );
  await page.locator('.cloze-input[data-answer="새정답"]').waitFor();
  assert.equal(await page.locator(".cloze-input").inputValue(), "");
  assert.equal(
    await page
      .getByRole("button", { name: "내 답안 내려받기", exact: true })
      .count(),
    0,
  );
  checks += 2;
  assert.deepEqual(errors, []);
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(
      {
        checks,
        results,
        errors,
        passed: true,
        network: "localhost fixture only",
        actualGoogleOrBackendVerified: false,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      suite: "lesson-core-point-recovery",
      checks,
      results,
      errors,
      output,
      passed: true,
    }),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
