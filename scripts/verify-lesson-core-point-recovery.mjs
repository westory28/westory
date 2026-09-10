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
let identity={config,currentUser:{uid:'student-a'},unit:'unit-a',preview:params.has('preview')};
export const useAuth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>identity);
window.selectLesson=(uid,unit)=>{identity={...identity,currentUser:uid?{uid}:null,unit};listeners.forEach(fn=>fn());};
window.coreCalls=[];window.coreToasts=[];window.corePointsUpdated=0;
window.addEventListener('points-updated',()=>window.corePointsUpdated++);
const image='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="700"><rect width="800" height="700" fill="white"/><text x="60" y="100" font-size="30">학습 검증</text></svg>');
const lessons=Object.fromEntries(['unit-a','unit-b'].map(unit=>[unit,{unitId:unit,title:unit,contentRevision:1,contentHtml:'<p>[고려] 시대</p>',isVisibleToStudents:true,worksheetPageImages:[{page:1,imageUrl:image,width:800,height:700}],worksheetExamHighlights:[{id:'point-a',page:1,leftRatio:.12,topRatio:.25,widthRatio:.3,heightRatio:.08}],worksheetBlanks:[]}]));
export const lessonFor=unit=>lessons[unit];
const progress=new Map(),rewards=new Set(),pending=[],restores=[],overviews=[];
if(params.has('reward'))progress.set('student-a/unit-a',{corePointFinds:['point-a']});
window.delayRestore=params.has('restore');window.delayOverview=params.has('overview');window.failOverview=false;
const unitData=(uid,unit)=>progress.get(uid+'/'+unit)||{};
const snapshot=data=>({exists:()=>Object.keys(data).length>0,data:()=>data});
export const db={}; export const doc=(_db,...parts)=>({path:parts.join('/')});export const collection=doc;
export const getDoc=async ref=>{const m=ref.path.match(/lesson_progress\/([^/]+)(?:\/units\/([^/]+))?$/);if(!m)return snapshot({});const [,uid,unit]=m;
 if(unit){const data=structuredClone(unitData(uid,unit));if(window.delayRestore)return new Promise(resolve=>restores.push(()=>resolve(snapshot(data))));return snapshot(data);}
 if(window.failOverview)throw Error('Synthetic overview failure');const data={corePointRewardClaimed:params.has('staleReward')?false:rewards.has(uid)};if(window.delayOverview)return new Promise((resolve,reject)=>overviews.push(ok=>ok?resolve(snapshot(data)):reject(Error('Old overview failure'))));return snapshot(data);};
export const getDocs=async ref=>{if(window.failOverview)throw Error('Synthetic overview failure');const uid=ref.path.split('/').at(-2);return {docs:['unit-a','unit-b'].map(unit=>({id:unit,data:()=>unitData(uid,unit)}))};};
export const readStudentLesson=async(_config,unit)=>lessons[unit];
export const readStudentVisibleLessons=async()=>[lessons[identity.unit]];
const write=(kind,input)=>{const uid=identity.currentUser?.uid;window.coreCalls.push({kind,input,uid});return new Promise((resolve,reject)=>pending.push({kind,input,uid,resolve,reject}));};
export const recordLessonCorePointFind=input=>write('find',input);
export const claimLessonCorePointReward=input=>write('reward',input);
export const saveLessonAnswers=async input=>({unitId:input.unitId,answerRevision:1,answers:Object.fromEntries(Object.entries(input.answers).map(([key,value])=>[key,{value,status:value==='고려'?'correct':'wrong'}])),correctCount:1,totalCount:1});
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
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Lesson from './src/pages/student/lesson/components/LessonContent';import {useAuth,lessonFor} from '${fixture.replaceAll("\\", "/")}';function App(){const state=useAuth();return <React.Suspense fallback="loading"><Lesson unitId={state.unit} lessonOverride={lessonFor(state.unit)} disablePersistence={state.preview}/></React.Suspense>};createRoot(document.getElementById('root')).render(<App/>);`,
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
