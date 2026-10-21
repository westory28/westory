/** Real runner/view regression fixture. Backend and point/notification boundaries
 * are local mocks; no live student data or Firebase requests are used. */
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
const evidence = path.join(
  root,
  ".superloopy/sessions/history-classroom-stabilization/evidence",
);
await fs.mkdir(evidence, { recursive: true });
const cache = path.join(os.tmpdir(), "westory-tailwind-fixture.js");
let tailwind;
try {
  tailwind = await fs.readFile(cache, "utf8");
} catch {
  const response = await fetch("https://cdn.tailwindcss.com/3.4.17");
  assert(response.ok);
  tailwind = await response.text();
  await fs.writeFile(cache, tailwind);
}
const assignment = {
  title: "통신 복구 검증",
  sourceType: "lesson",
  lessonUnitId: "unit-a",
  lessonTitle: "고조선",
  lessonUnitPath: ["I. 고대", "고조선"],
  isPublished: true,
  targetStudentUid: "student-1",
  targetStudentUids: ["student-1"],
  cooldownMinutes: 10,
  timeLimitMinutes: 1,
  passThresholdPercent: 80,
  answerOptions: ["고조선", "백제"],
  pdfPageImages: [1, 3].map((page) => ({
    page,
    imageUrl: "/worksheet.svg",
    width: 1000,
    height: 1400,
  })),
  pdfRegions: [],
  blanks: [
    {
      id: "blank-a",
      page: 1,
      left: 100,
      top: 150,
      width: 250,
      height: 45,
      answer: "고조선",
      prompt: "첫 빈칸",
      source: "manual",
    },
    {
      id: "blank-b",
      page: 3,
      left: 100,
      top: 150,
      width: 250,
      height: 45,
      answer: "백제",
      prompt: "둘째 빈칸",
      source: "manual",
    },
  ],
};
const mock = `const scope='years/2026/semesters/2';
const stored=JSON.parse(localStorage.getItem('runnerFixtureBackend')||'null');
const params=new URLSearchParams(location.search);
export const fixture=window.__fixture=stored||{assignment:${JSON.stringify(assignment)},results:{},calls:[],directWrites:[],notifications:[],points:[],failures:[],loseNextResponse:false,forceZero:false};
if(params.get('resultCase')==='long'&&!stored){
 fixture.assignment.passThresholdPercent=90;
 fixture.assignment.blanks=Array.from({length:46},(_,index)=>({
 ...fixture.assignment.blanks[0],id:'internal-blank-'+index,prompt:index===0?'첫 빈칸':'검증 빈칸 '+index,
 answer:index<3?'고조선':index<5?'백제':index===5?'공백없는매우긴역사정답'.repeat(20):'확인할 정답 '+index,
 top:150+(index%20)*50,left:index<20?100:450,
 }));
}
if(params.get('untimed')==='1')fixture.assignment.timeLimitMinutes=0;
if(params.get('lowerBlank')==='1'&&!stored)fixture.assignment.blanks[0].top=1150;
if(params.get('due')==='1'&&!stored)fixture.assignment.dueAt={seconds:(Date.now()+6000)/1000};
const persist=()=>localStorage.setItem('runnerFixtureBackend',JSON.stringify(fixture));
window.__persistBackend=persist;
export const config={year:'2026',semester:'2'};
export const db={};
const userData={uid:'student-1',role:'student',name:'검증학생',grade:'1',class:'2',number:'3'}; export const useAuth=()=>({config,userData});
export const useAppToast=()=>({showToast:()=>{}});
const reference=(...parts)=>({path:parts.flatMap(p=>typeof p==='string'?[p]:p?.path?[p.path]:[]).join('/')});
export const collection=(_db,...parts)=>reference(...parts);
let idCounter=0;
export const doc=(...parts)=>{const r=reference(...parts);if(parts.length===1)r.path+='/fixture-result-'+crypto.randomUUID();return {...r,id:r.path.split('/').at(-1)};};
export const where=(key,operator,value)=>({key,value});
export const query=(ref,...constraints)=>({...ref,constraints});
export const serverTimestamp=()=>({seconds:Date.now()/1000});
const snap=(id,value)=>({id,exists:()=>value!==undefined,data:()=>structuredClone(value)});
const assignmentSnapshot=(ref)=>snap('assignment-1',fixture.legacyAssignment&&ref.path.startsWith(scope)?undefined:fixture.assignment);
export const getDoc=async(ref)=>{if(ref.path.endsWith('/history_classrooms/assignment-1')||ref.path==='history_classrooms/assignment-1'){if(fixture.denyAssignmentRead){const error=new Error('assignment access denied');error.code='permission-denied';throw error;}return assignmentSnapshot(ref);}return snap(ref.id,fixture.results[ref.id]);};
const listeners=new Set();
export const onSnapshot=(ref,next,error)=>{const listener=()=>fixture.denyAssignmentRead?error?.(new Error('denied')):next(assignmentSnapshot(ref));listeners.add(listener);queueMicrotask(listener);return()=>listeners.delete(listener);};
window.__emitAssignment=()=>{persist();for(const listener of listeners)listener();};
export const getDocs=async(ref)=>{const docs=ref.path===scope+'/history_classroom_results'?Object.entries(fixture.results).map(([id,value])=>snap(id,value)):[];return {docs,empty:!docs.length};};
export const setDoc=async(ref,data)=>{fixture.directWrites.push({path:ref.path,data});persist();};
export const getHttpsCallable=async()=>async(input)=>{
fixture.calls.push(structuredClone(input));persist();
const failure=fixture.failures.shift();if(failure){persist();const error=new Error(typeof failure==='string'?failure:failure.message);error.code=typeof failure==='string'?failure:failure.code;throw error;}
if(!navigator.onLine){const error=new Error('network unavailable');error.code='functions/unavailable';throw error;}
let result=fixture.results[input.resultId];
if(!result){const checks=fixture.assignment.blanks.map((b,i)=>({blankId:b.id,blankNumber:i+1,page:b.page,studentAnswer:input.answers[b.id]||'',correctAnswer:b.answer,correct:!fixture.forceZero&&(input.answers[b.id]||'').replace(/\\s/g,'')===b.answer.replace(/\\s/g,'')}));const score=checks.filter(c=>c.correct).length,percent=Math.round(score/checks.length*100),passed=input.status!=='cancelled'&&percent>=80;result=fixture.results[input.resultId]={assignmentId:input.assignmentId,uid:'student-1',resultId:input.resultId,score,total:checks.length,percent,passed,passThresholdPercent:fixture.forceZero?90:fixture.assignment.passThresholdPercent,status:input.status==='cancelled'?'cancelled':passed?'passed':'failed',answerChecks:checks,createdAt:{seconds:Date.now()/1000}};persist();}
if(fixture.loseNextResponse){fixture.loseNextResponse=false;persist();return new Promise(()=>{});}return {data:result};};
export const notifyPointsUpdated=()=>{};
export const notifyHistoryClassroomSubmitted=async()=>{};
export const claimPointActivityReward=async(input)=>{fixture.points.push(input);persist();return {awarded:false,amount:0};};
export const buildHistoryClassroomRewardSourceId=id=>'history:'+id;
export const emitSessionActivity=()=>{};

export const buildAssessmentDefinitionId=(semester,kind,id)=>kind.toLowerCase()+':'+semester+':'+id;
export const executeAssessmentManagementCommand=async()=>{throw new Error('Unexpected management write');};
export const executeStudentAssessmentCommand=async()=>{throw new Error('Unexpected generic write');};
const failure=(code='functions/unavailable')=>Object.assign(new Error(code),{code});
const online=()=>{if(!navigator.onLine)throw failure();};
const record=(kind,input)=>{fixture.calls.push({kind,...structuredClone(input)});persist();};
export const getAssessmentState=async()=>{online();return {status:fixture.attempt?fixture.attempt.status==='SUBMITTED'?'SUBMITTED':'RECOVERABLE':'READY',definition:{definitionId:'history_classroom:2026-2:assignment-1'},attempt:fixture.attempt||null,serverNowIso:new Date().toISOString()};};
export const startAssessmentAttempt=async(input)=>{online();record('start',input);if(fixture.failStart){fixture.failStart=false;persist();throw failure();}if(fixture.holdStart)await new Promise(resolve=>{window.__releaseStart=resolve;});if(fixture.attempt)return fixture.attempt;fixture.attempt={attemptId:fixture.nextAttemptId||'attempt-1',definitionId:input.definitionId,semesterId:'2026-2',assessmentKind:'HISTORY_CLASSROOM',attemptNumber:1,status:'STARTED',revision:1,answers:{},currentItemId:'1',questionIds:fixture.assignment.blanks.map(b=>b.id),startedAtIso:new Date().toISOString(),deadlineAtIso:new Date(Date.now()+60000).toISOString(),lastSavedAtIso:new Date().toISOString(),resultRef:''};persist();return fixture.attempt;};
export const saveAssessmentProgress=async(input)=>{
 online();record('save',input);const key=JSON.stringify(input);fixture.saves||={};if(fixture.saves[key])return fixture.saves[key];
 if(fixture.failSave){fixture.failSave=false;persist();throw failure();}
 if(Date.now()>Date.parse(fixture.attempt.deadlineAtIso))throw Object.assign(failure('functions/deadline-exceeded'),{details:{reason:'ASSESSMENT_DEADLINE_EXPIRED'}});
 if(input.expectedRevision!==fixture.attempt.revision)throw Object.assign(failure('functions/aborted'),{details:{reason:'ASSESSMENT_ATTEMPT_REVISION_CONFLICT'}});
 fixture.attempt={...fixture.attempt,status:'IN_PROGRESS',revision:fixture.attempt.revision+1,answers:input.answers,currentItemId:input.currentItemId,lastSavedAtIso:new Date().toISOString()};
 const result=fixture.saves[key]={...fixture.attempt,savedAtIso:fixture.attempt.lastSavedAtIso};persist();
 if(fixture.loseSaveResponse){fixture.loseSaveResponse=false;persist();throw failure();}return result;
};
export const submitAssessmentAttempt=async(input)=>{
 online();record('submit',input);const existing=fixture.results[input.attemptId];if(existing)return {...existing,replayedSubmission:true};
 const fail=fixture.failures.shift();if(fail){persist();throw failure(fail);}
 if(input.expectedRevision!==fixture.attempt.revision)throw Object.assign(failure('functions/aborted'),{details:{reason:'ASSESSMENT_ATTEMPT_REVISION_CONFLICT'}});
 const answerChecks=fixture.assignment.blanks.map(b=>({id:b.id,correct:(input.answers[b.id]||'').replace(/\\s/g,'')===b.answer.replace(/\\s/g,'')}));
 const score=answerChecks.filter(b=>b.correct).length,total=answerChecks.length;
 const result=fixture.results[input.attemptId]={studentUid:'student-1',attemptId:input.attemptId,semesterId:'2026-2',score,total,percent:Math.round(score/total*100),passed:Math.round(score/total*100)>=(fixture.serverThreshold??fixture.assignment.passThresholdPercent),passThresholdPercent:fixture.serverThreshold??fixture.assignment.passThresholdPercent,answerChecks,status:'SUBMITTED',revision:fixture.attempt.revision+1,resultRef:scope+'/assessment_results/'+input.attemptId,replayedSubmission:false};
 fixture.attempt={...fixture.attempt,status:'SUBMITTED',revision:result.revision,answers:input.answers,resultRef:result.resultRef};persist();
 if(fixture.loseSubmitResponse){fixture.loseSubmitResponse=false;persist();throw failure();}return result;
};
export const lockHistoryClassroomAttempt=async(input)=>{online();record('lock',input);const a=fixture.attempt;if(a.status!=='SUBMITTED')a.status='LOCKED';persist();return {attemptId:a.attemptId,status:a.status,revision:a.revision};};
export const isAssessmentRevisionConflict=error=>error?.details?.reason==='ASSESSMENT_ATTEMPT_REVISION_CONFLICT';

`;
const entry = JSON.stringify(
  path
    .join(
      root,
      "src/pages/student/history-classroom/HistoryClassroomRunner.tsx",
    )
    .replaceAll("\\", "/"),
);
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import Runner from ${entry};createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/student/history-classroom/run?id=assignment-1']}><Runner/></MemoryRouter>);`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  outfile: path.join(evidence, "student-runner-fixture.js"),
  platform: "browser",
  format: "esm",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  plugins: [
    {
      name: "local-only-boundaries",
      setup(build) {
        build.onResolve(
          { filter: /components\/common\/HistoryClassroomAssignmentView$/ },
          () => ({
            path: "actual-view-with-hint-probe",
            namespace: "hint-probe",
          }),
        );
        build.onLoad({ filter: /.*/, namespace: "hint-probe" }, () => ({
          contents: `import React from 'react';import View from ${JSON.stringify(path.join(root, "src/components/common/HistoryClassroomAssignmentView.tsx").replaceAll("\\", "/"))};export default function Probe(props){window.__useHint=props.onUseHint;window.__hintCount=props.hintUseCount;window.__changeAnswer=props.onAnswerChange;return React.createElement(View,props);}`,
          loader: "jsx",
          resolveDir: root,
        }));
        build.onResolve(
          {
            filter:
              /^firebase\/firestore$|(?:lib\/|^\.\/)(?:firebase|notifications|points|appEvents|sessionActivity|assessmentLifecycle)$|contexts\/AuthContext$|common\/AppToastProvider$/,
          },
          () => ({ path: "mock", namespace: "mock" }),
        );
        build.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: mock,
          loader: "js",
        }));
      },
    },
  ],
});
const css = (
  await Promise.all(
    ["assets/css/style.css", "src/assets/index.css"].map((file) =>
      fs.readFile(path.join(root, file), "utf8"),
    ),
  )
)
  .join("\n")
  .replaceAll(/@import[^;]+;/g, "")
  .replaceAll(/@tailwind[^;]+;/g, "");
const importedCss = bundle.outputFiles
  .filter((file) => file.path.endsWith(".css"))
  .map((file) => file.text)
  .join("\n");
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}\n${importedCss}body{margin:0}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="1000" height="1400" fill="white"/><text x="100" y="100" font-size="36">인터넷 연결과 답안 복구 검증</text></svg>';
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  res.setHeader(
    "Content-Type",
    url.endsWith(".js")
      ? "text/javascript"
      : url.endsWith(".svg")
        ? "image/svg+xml"
        : "text/html;charset=utf-8",
  );
  res.end(
    url === "/fixture.js"
      ? bundle.outputFiles.find((file) => file.path.endsWith(".js")).text
      : url === "/tailwind.js"
        ? tailwind
        : url === "/worksheet.svg"
          ? svg
          : req.url.includes("accountHeader=1")
            ? html.replace(
                '<div id="root">',
                '<header style="height:48px">계정 영역 검증</header><div id="root">',
              )
            : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const reports = [];
const key = "westoryHistoryClassroomAttempt:assignment-1:student-1";
const draft = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), key);
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
const advance = async (page, ms) => {
  await page.clock.runFor(ms);
};
const getCalls = (page) => page.evaluate(() => window.__fixture.calls);
const callsOf = async (page, kind) =>
  (await getCalls(page)).filter((call) => call.kind === kind);
const firstInput = (page) => page.locator('input[placeholder="첫 빈칸"]');
const submit = (page) =>
  page.getByRole("button", { name: /^(제출하기|다시 제출)$/ }).click();
async function open(
  label,
  width = 800,
  height = 1280,
  query = "",
  start = true,
) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(`http://127.0.0.1:${server.address().port}`)
      ? route.continue()
      : route.abort(),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/${query}`);
  await page.getByRole("button", { name: "응시 시작", exact: true }).waitFor();
  assert.equal(
    (await getCalls(page)).length,
    0,
    "opening the assignment is read-only",
  );
  await page.clock.install({ time: Date.now() });
  if (start) {
    await page.getByRole("button", { name: "응시 시작", exact: true }).click();
    await page.getByRole("button", { name: "제출하기", exact: true }).waitFor();
  }
  return { label, page, context, errors };
}
async function finish(test) {
  assert.deepEqual(test.errors, []);
  await test.page.screenshot({
    path: path.join(evidence, `runner-${test.label}.png`),
    fullPage: true,
  });
  reports.push({
    label: test.label,
    calls: await getCalls(test.page),
    errors: test.errors,
  });
  await test.context.close();
  console.log(`${test.label}: passed`);
}
const visibility = (page, state) =>
  page.evaluate((state) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: state,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
try {
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1280, 800],
    [1366, 768],
  ]) {
    const t = await open(
      `start-overlay-${width}x${height}`,
      width,
      height,
      "",
      false,
    );
    const start = t.page.getByRole("button", {
      name: "응시 시작",
      exact: true,
    });
    const overlay = t.page.locator("[data-history-start-overlay]");
    const viewport = t.page.locator("[data-history-viewport]");
    const [buttonRect, viewportRect] = await Promise.all([
      start.boundingBox(),
      viewport.boundingBox(),
    ]);
    assert(buttonRect && viewportRect);
    assert(
      Math.abs(
        buttonRect.x +
          buttonRect.width / 2 -
          viewportRect.x -
          viewportRect.width / 2,
      ) < 2,
    );
    assert(
      Math.abs(
        buttonRect.y +
          buttonRect.height / 2 -
          viewportRect.y -
          viewportRect.height / 2,
      ) < 2,
    );
    assert(buttonRect.y >= 0 && buttonRect.y + buttonRect.height <= height);
    assert.equal(
      await overlay.evaluate(
        (element) => getComputedStyle(element).backdropFilter,
      ),
      "blur(2px)",
    );
    assert.equal(await viewport.locator("[inert]").count(), 1);
    assert.equal(
      await t.page.getByRole("textbox").count(),
      0,
      "unstarted blanks are not keyboard targets",
    );
    assert.equal(
      await t.page
        .getByRole("button", { name: "제출하기", exact: true })
        .count(),
      0,
    );
    await advance(t.page, 5000);
    assert.equal(
      (await getCalls(t.page)).length,
      0,
      "waiting before start never creates an attempt",
    );
    assert.equal(
      await t.page
        .getByRole("timer", { name: "남은 시간", exact: true })
        .count(),
      0,
    );
    const disclosure = t.page.getByRole("button", { name: /^단어 목록/ });
    assert.equal(
      await disclosure.locator('svg[aria-hidden="true"]').count(),
      1,
    );
    assert(!/[∨∧]/u.test(await disclosure.innerText()));
    await disclosure.click();
    assert.equal(await disclosure.getAttribute("aria-expanded"), "true");
    assert(
      (await disclosure.locator("svg").getAttribute("class")).includes(
        "rotate-180",
      ),
    );
    await disclosure.click();
    await t.page.screenshot({
      path: path.join(evidence, `runner-${t.label}-ready.png`),
      fullPage: true,
    });
    await start.click();
    await t.page
      .getByRole("button", { name: "제출하기", exact: true })
      .waitFor();
    assert.equal((await callsOf(t.page, "start")).length, 1);
    assert.equal(await overlay.count(), 0);
    assert.equal(await viewport.locator("[inert]").count(), 0);
    await firstInput(t.page).fill("고조선");
    assert.equal(await firstInput(t.page).inputValue(), "고조선");
    const timer = t.page.getByRole("timer", { name: "남은 시간", exact: true });
    const before = await timer.innerText();
    await advance(t.page, 2100);
    assert.notEqual(
      await timer.innerText(),
      before,
      "the same start click enables answers and countdown",
    );
    await finish(t);
  }
  {
    const t = await open("start-overlay-request-failure", 768, 1024, "", false);
    await t.page.evaluate(() => {
      window.__fixture.failStart = true;
    });
    await t.page
      .getByRole("button", { name: "응시 시작", exact: true })
      .click();
    await t.page
      .getByRole("status")
      .filter({ hasText: "functions/unavailable" })
      .waitFor();
    assert.equal(
      await t.page.locator("[data-history-start-overlay]").count(),
      1,
    );
    assert.equal(
      await t.page
        .getByRole("timer", { name: "남은 시간", exact: true })
        .count(),
      0,
    );
    await t.page.evaluate(() => {
      window.__fixture.holdStart = true;
    });
    await t.page
      .getByRole("button", { name: "응시 시작", exact: true })
      .click();
    const pending = t.page.getByRole("button", {
      name: "시작 중...",
      exact: true,
    });
    await pending.waitFor();
    assert.equal(await pending.isDisabled(), true);
    await advance(t.page, 3000);
    assert.equal((await callsOf(t.page, "start")).length, 2);
    assert.equal(await t.page.getByRole("textbox").count(), 0);
    await t.page.evaluate(() => window.__releaseStart());
    await t.page
      .getByRole("button", { name: "제출하기", exact: true })
      .waitFor();
    assert.equal(
      await t.page.locator("[data-history-start-overlay]").count(),
      0,
    );
    await finish(t);
  }
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1280, 800],
    [800, 1280],
    [1280, 400],
  ]) {
    const t = await open(`tablet-${width}x${height}`, width, height);
    const accordion = t.page.getByRole("button", { name: /^단어 목록/ });
    assert.equal(await accordion.getAttribute("aria-expanded"), "false");
    await accordion.click();
    assert.equal(await accordion.getAttribute("aria-expanded"), "true");
    assert(
      await t.page
        .getByRole("region", { name: "단어 목록", exact: true })
        .getByText("고조선", { exact: true })
        .isVisible(),
    );
    await accordion.click();
    assert(
      await t.page
        .getByRole("timer", { name: "남은 시간", exact: true })
        .isVisible(),
    );
    const geometry = await t.page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      toolbar: document
        .querySelector("[data-history-toolbar]")
        .getBoundingClientRect()
        .toJSON(),
      submit: [...document.querySelectorAll("button")]
        .find((b) => b.textContent === "제출하기")
        .getBoundingClientRect()
        .toJSON(),
    }));
    assert.equal(geometry.overflow, false, JSON.stringify(geometry));
    assert(geometry.submit.height >= 44 && geometry.submit.right <= width);
    await t.page.screenshot({
      path: path.join(evidence, `runner-active-${width}x${height}.png`),
      fullPage: true,
    });
    await firstInput(t.page).fill("고조선");
    await submit(t.page);
    const dialog = t.page.getByRole("dialog", { name: "미통과", exact: true });
    await dialog.waitFor();
    assert.equal(
      await dialog.getByLabel("정답 수", { exact: true }).textContent(),
      "1/2문제",
    );
    assert(await dialog.getByText("백제", { exact: true }).isVisible());
    assert(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      "result takes focus away from keyboard input",
    );
    await dialog.getByRole("button", { name: "확인", exact: true }).focus();
    await t.page.keyboard.press("Tab");
    assert.equal(
      await t.page.evaluate(() => document.activeElement.textContent),
      "닫기",
    );
    await t.page.keyboard.press("Escape");
    assert.equal(await dialog.count(), 0);
    await t.page
      .getByRole("button", { name: "결과 보기", exact: true })
      .click();
    await dialog.waitFor();
    const panel = await dialog.evaluate((el) =>
      el.firstElementChild.getBoundingClientRect().toJSON(),
    );
    assert(
      panel.top >= 0 &&
        panel.bottom <= height &&
        panel.left >= 0 &&
        panel.right <= width,
      JSON.stringify(panel),
    );
    await finish(t);
  }
  {
    const t = await open("offline-expiry-reconnect");
    await firstInput(t.page).fill("고조선");
    await advance(t.page, 1100);
    const deadline = (await draft(t.page)).deadlineMs;
    await t.context.setOffline(true);
    await advance(t.page, 1000);
    await firstInput(t.page).fill("백제");
    await advance(t.page, 65000);
    assert.equal(
      (await draft(t.page)).deadlineMs,
      deadline,
      "offline never extends the deadline",
    );
    assert.equal((await draft(t.page)).pendingSubmission.reason, "time-limit");
    assert.equal((await callsOf(t.page, "lock")).length, 0);
    assert.equal((await callsOf(t.page, "submit")).length, 0);
    assert.equal(await firstInput(t.page).isEditable(), false);
    assert.equal(
      await t.page
        .getByRole("timer", { name: "남은 시간", exact: true })
        .textContent(),
      "00:00",
    );
    await t.context.setOffline(false);
    await advance(t.page, 1000);
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    const calls = await callsOf(t.page, "submit");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].answers["blank-a"], "백제");
    assert.equal(calls[0].submitReason, "TIMEOUT");
    await finish(t);
  }
  {
    const t = await open("network-interruption-reload");
    await firstInput(t.page).fill("고조선 보존");
    await t.context.setOffline(true);
    await advance(t.page, 12000);
    const before = await draft(t.page);
    await t.context.setOffline(false);
    await t.page.reload();
    await t.page
      .getByRole("button", { name: "제출하기", exact: true })
      .waitFor();
    assert.equal(await firstInput(t.page).inputValue(), "고조선 보존");
    assert.equal((await draft(t.page)).deadlineMs, before.deadlineMs);
    assert.equal((await callsOf(t.page, "start")).length, 1);
    assert.equal((await callsOf(t.page, "lock")).length, 0);
    await finish(t);
  }
  {
    const t = await open("blur-rotation-transient-visibility");
    await t.page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await advance(t.page, 4000);
    await visibility(t.page, "hidden");
    await advance(t.page, 500);
    await visibility(t.page, "visible");
    await t.page.evaluate(() =>
      window.dispatchEvent(new Event("orientationchange")),
    );
    await visibility(t.page, "hidden");
    await advance(t.page, 4000);
    await visibility(t.page, "visible");
    assert.equal((await callsOf(t.page, "lock")).length, 0);
    assert.equal(await firstInput(t.page).isDisabled(), false);
    await finish(t);
  }
  for (const offline of [false, true]) {
    const t = await open(`tab-switch-${offline ? "offline" : "online"}`);
    if (offline) await t.context.setOffline(true);
    await visibility(t.page, "hidden");
    await advance(t.page, 3500);
    assert.equal((await draft(t.page)).pendingViolation, "VISIBILITY_HIDDEN");
    await visibility(t.page, "visible");
    assert(
      await t.page
        .getByRole("heading", {
          name: "응시 화면 이탈로 재응시가 제한되었습니다.",
        })
        .isVisible(),
    );
    if (offline) {
      assert.equal((await callsOf(t.page, "lock")).length, 0);
      await t.context.setOffline(false);
      await advance(t.page, 100);
    }
    assert.equal((await callsOf(t.page, "lock")).length, 1);
    await t.page.reload();
    await t.page
      .getByRole("button", { name: "다시 확인", exact: true })
      .waitFor();
    assert.equal(
      (await callsOf(t.page, "start")).length,
      1,
      "locked attempt cannot start again",
    );
    await finish(t);
  }
  {
    const t = await open("suspended-background-timer");
    await visibility(t.page, "hidden");
    await t.page.clock.setSystemTime(Date.now() + 10000);
    await visibility(t.page, "visible");
    assert.equal((await draft(t.page)).pendingViolation, "VISIBILITY_HIDDEN");
    await finish(t);
  }
  {
    const t = await open("lost-autosave-response");
    await t.page.evaluate(() => {
      window.__fixture.loseSaveResponse = true;
    });
    await firstInput(t.page).fill("고조선");
    await advance(t.page, 1000);
    assert((await draft(t.page)).pendingProgress);
    await firstInput(t.page).fill("고조선 수정");
    await advance(t.page, 1000);
    await submit(t.page);
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    assert.equal(
      (await callsOf(t.page, "submit"))[0].answers["blank-a"],
      "고조선 수정",
    );
    assert.equal(await draft(t.page), null);
    await finish(t);
  }
  {
    const t = await open("lost-submit-response-reload");
    await firstInput(t.page).fill("고조선");
    await t.page.evaluate(() => {
      window.__fixture.loseSubmitResponse = true;
    });
    await submit(t.page);
    assert((await draft(t.page)).pendingSubmission);
    await t.page.reload();
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    assert.equal((await callsOf(t.page, "submit")).length, 1);
    assert.equal((await callsOf(t.page, "start")).length, 1);
    await finish(t);
  }
  {
    const t = await open("manual-navigation-lock");
    await t.page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "/#/student/history-classroom";
      link.textContent = "검증 나가기";
      document.body.appendChild(link);
    });
    await t.page.getByRole("link", { name: "검증 나가기" }).click();
    await t.page.getByRole("button", { name: "나가기", exact: true }).click();
    assert.equal((await callsOf(t.page, "lock"))[0].reason, "NAVIGATION");
    assert.equal((await callsOf(t.page, "submit")).length, 0);
    await finish(t);
  }
  {
    const t = await open("keyboard-preserves-scale", 1280, 800);
    await firstInput(t.page).focus();
    const before = await firstInput(t.page).boundingBox();
    await t.page.setViewportSize({ width: 1280, height: 400 });
    await advance(t.page, 100);
    const after = await firstInput(t.page).boundingBox();
    assert(
      Math.abs(after.width - before.width) < 1,
      "opening keyboard must not shrink the worksheet",
    );
    const canvas = await t.page
      .locator("[data-history-viewport]")
      .boundingBox();
    assert(
      after.y >= canvas.y && after.y + after.height <= canvas.y + canvas.height,
    );
    assert(
      await t.page
        .getByRole("timer", { name: "남은 시간", exact: true })
        .isVisible(),
    );
    await finish(t);
  }
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1280, 800],
  ]) {
    const t = await open(
      `worksheet-keyboard-${width}`,
      width,
      height,
      "?lowerBlank=1&accountHeader=1",
    );
    const frame = t.page.locator("[data-history-viewport]");
    const canvas = frame.locator(":scope > div").first();
    assert.equal(
      await t.page.locator("[data-history-student-view] aside").count(),
      0,
      "student worksheet has no unit footer",
    );
    const initial = await frame.boundingBox();
    const image = await frame.getByRole("img").boundingBox();
    assert(
      initial.y + initial.height <= height - 4,
      "worksheet fits below the actual account header",
    );
    assert(
      image.width >= Math.min(1000, initial.width - 20),
      "worksheet fits width, not the full-page height",
    );
    const hasOverflow = await canvas.evaluate(
      (element) => element.scrollHeight > element.clientHeight + 30,
    );
    if (hasOverflow) {
      const beforePan = await canvas.evaluate((element) => element.scrollTop);
      await canvas.dispatchEvent("touchstart", {
        touches: [
          { identifier: 1, clientX: initial.x + 10, clientY: initial.y + 100 },
        ],
      });
      await canvas.dispatchEvent("touchmove", {
        touches: [
          { identifier: 1, clientX: initial.x + 10, clientY: initial.y + 50 },
        ],
      });
      await canvas.dispatchEvent("touchend", { touches: [] });
      assert(
        (await canvas.evaluate((element) => element.scrollTop)) >
          beforePan + 20,
        "one-finger pan works at width-fit base scale",
      );
    }
    await firstInput(t.page).focus();
    await firstInput(t.page).fill("가독성 검증");
    const before = await firstInput(t.page).boundingBox();
    const visibleHeight = Math.floor(height / 2);
    await t.page.evaluate((nextHeight) => {
      Object.defineProperties(window.visualViewport, {
        height: { configurable: true, value: nextHeight },
        offsetTop: { configurable: true, value: 0 },
      });
      window.visualViewport.dispatchEvent(new Event("resize"));
    }, visibleHeight);
    await advance(t.page, 150);
    const reduced = await frame.boundingBox();
    const after = await firstInput(t.page).boundingBox();
    assert(reduced.height < initial.height - 100);
    assert(
      reduced.y + reduced.height <= visibleHeight - 4,
      "worksheet stays above the virtual keyboard",
    );
    assert(
      Math.abs(after.width - before.width) < 1,
      "virtual keyboard keeps the readable answer scale",
    );
    assert(
      after.y >= reduced.y &&
        after.y + after.height <= reduced.y + reduced.height,
      "lower-page focused answer remains visible",
    );
    assert.equal(await firstInput(t.page).inputValue(), "가독성 검증");
    assert.equal(
      (await callsOf(t.page, "lock")).length,
      0,
      "keyboard is not an exit violation",
    );
    await t.page.screenshot({
      path: path.join(evidence, `runner-${t.label}-open.png`),
      fullPage: false,
    });
    await t.page.evaluate(() => {
      Object.defineProperty(window.visualViewport, "offsetTop", {
        configurable: true,
        value: 24,
      });
      window.visualViewport.dispatchEvent(new Event("scroll"));
    });
    await advance(t.page, 100);
    const panned = await frame.boundingBox();
    assert(
      panned.y + panned.height <= visibleHeight + 24 - 4,
      "visual viewport panning preserves keyboard clearance",
    );
    await t.page.evaluate(() => {
      delete window.visualViewport.height;
      delete window.visualViewport.offsetTop;
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await advance(t.page, 150);
    const restored = await frame.boundingBox();
    assert(
      restored.height > reduced.height + 100,
      "dismissing keyboard restores worksheet space",
    );
    assert.equal(await firstInput(t.page).inputValue(), "가독성 검증");
    const scrollBeforeWords = await canvas.evaluate(
      (element) => element.scrollTop,
    );
    await t.page.getByRole("button", { name: /^단어 목록/ }).click();
    await advance(t.page, 150);
    assert(
      (await canvas.evaluate((element) => element.scrollTop)) >=
        scrollBeforeWords - 1,
      "opening reference words preserves the current worksheet position",
    );
    await t.page.getByRole("button", { name: /^단어 목록/ }).click();
    await finish(t);
  }
  for (const width of [390, 768, 1280]) {
    const t = await open(
      `long-empty-results-${width}`,
      width,
      800,
      "?resultCase=long",
    );
    await submit(t.page);
    const dialog = t.page.getByRole("dialog", { name: "미통과", exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel("정답 수").textContent(), "0/46문제");
    const wrong = dialog.getByRole("region", {
      name: "못 쓴 답들",
      exact: true,
    });
    const text = await wrong.textContent();
    assert.equal(
      (text.match(/고조선/g) || []).length,
      1,
      "deduplicate answer labels",
    );
    assert(text.includes("공백없는매우긴역사정답"));
    assert.equal(
      await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      false,
    );
    assert(
      await dialog
        .getByRole("button", { name: "확인", exact: true })
        .isVisible(),
    );
    await finish(t);
  }
  {
    const t = await open("all-correct-double-submit");
    await firstInput(t.page).fill("고조선");
    await t.page.getByRole("button", { name: "다음", exact: true }).click();
    await t.page.locator('input[placeholder="둘째 빈칸"]').fill("백제");
    await t.page
      .getByRole("button", { name: "제출하기", exact: true })
      .evaluate((button) => {
        button.click();
        button.click();
      });
    await t.page.getByRole("dialog", { name: "통과", exact: true }).waitFor();
    assert.equal((await callsOf(t.page, "submit")).length, 1);
    assert(
      await t.page
        .getByRole("region", { name: "못 쓴 답들" })
        .getByText("없음")
        .isVisible(),
    );
    await t.page.reload();
    await t.page.getByRole("dialog", { name: "통과", exact: true }).waitFor();
    assert.equal((await callsOf(t.page, "submit")).length, 1);
    await finish(t);
  }
  {
    const t = await open("server-threshold-snapshot");
    await firstInput(t.page).fill("고조선");
    await t.page.evaluate(() => {
      window.__fixture.serverThreshold = 50;
    });
    await submit(t.page);
    const dialog = t.page.getByRole("dialog", { name: "통과", exact: true });
    await dialog.waitFor();
    assert(
      await dialog
        .getByText("50% · 통과 기준 50%", { exact: true })
        .isVisible(),
    );
    await finish(t);
  }
  {
    const t = await open("autosave-offline-expiry");
    await t.page.evaluate(() => {
      window.__fixture.failSave = true;
    });
    await firstInput(t.page).fill("고조선");
    await advance(t.page, 1000);
    assert((await draft(t.page)).pendingProgress);
    await t.context.setOffline(true);
    await advance(t.page, 65000);
    await t.context.setOffline(false);
    await advance(t.page, 1000);
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    assert.equal((await callsOf(t.page, "submit")).length, 1);
    await finish(t);
  }
  {
    const t = await open("due-window-offline", 800, 1280, "?due=1");
    await firstInput(t.page).fill("고조선");
    await t.context.setOffline(true);
    await advance(t.page, 10000);
    assert.equal((await draft(t.page)).pendingSubmission.reason, "due-window");
    assert.equal(await firstInput(t.page).isEditable(), false);
    await t.context.setOffline(false);
    await advance(t.page, 1000);
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    assert.equal((await callsOf(t.page, "submit"))[0].submitReason, "TIMEOUT");
    await finish(t);
  }
  {
    const t = await open("server-rejection-and-explicit-retry");
    await firstInput(t.page).fill("고조선");
    await t.page.evaluate(() => {
      window.__fixture.failures.push("functions/permission-denied");
    });
    await submit(t.page);
    await advance(t.page, 6000);
    assert.equal(
      (await callsOf(t.page, "submit")).length,
      1,
      "permission failures do not auto-retry",
    );
    assert((await draft(t.page)).pendingSubmission);
    await submit(t.page);
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    assert.equal(
      await t.page.evaluate(() => window.__fixture.directWrites.length),
      0,
    );
    await finish(t);
  }
  for (const scope of ["semester", "attempt"]) {
    const t = await open(`draft-${scope}-isolation`);
    await firstInput(t.page).fill("고조선");
    await advance(t.page, 1000);
    await t.page.evaluate(
      ({ key, scope }) => {
        const saved = JSON.parse(localStorage.getItem(key));
        saved.answers = { "blank-a": "다른 응시 답안" };
        saved.pendingSubmission = {
          status: "failed",
          reason: "manual",
          answers: saved.answers,
        };
        if (scope === "semester") saved.semester = "1";
        else saved.attemptId = "other-attempt";
        localStorage.setItem(key, JSON.stringify(saved));
      },
      { key, scope },
    );
    await t.page.reload();
    await t.page
      .getByRole("button", { name: "제출하기", exact: true })
      .waitFor();
    assert.equal(await firstInput(t.page).inputValue(), "고조선");
    assert.equal((await callsOf(t.page, "submit")).length, 0);
    await finish(t);
  }
  for (const field of ["studentUid", "attemptId", "semesterId"]) {
    const t = await open(`receipt-${field}-isolation`);
    await t.page.evaluate(() => {
      window.__changeAnswer("blank-a", "고조선");
      window.__changeAnswer("blank-b", "백제");
    });
    await submit(t.page);
    await t.page.getByRole("dialog", { name: "통과", exact: true }).waitFor();
    await t.page.evaluate((field) => {
      window.__fixture.results["attempt-1"][field] = "other";
      window.__persistBackend();
    }, field);
    await t.page.reload();
    await t.page
      .getByRole("button", { name: "다시 확인", exact: true })
      .waitFor();
    assert.equal(await t.page.getByRole("dialog").count(), 0);
    await finish(t);
  }
  {
    const t = await open("teacher-reset-new-attempt");
    await visibility(t.page, "hidden");
    await advance(t.page, 3500);
    await visibility(t.page, "visible");
    await t.page.reload();
    await t.page
      .getByRole("button", { name: "다시 확인", exact: true })
      .waitFor();
    await t.page.evaluate(() => {
      window.__fixture.attempt = null;
      window.__fixture.nextAttemptId = "attempt-2";
      window.__fixture.assignment.retryResetByStudentUid = {
        "student-1": { seconds: Date.now() / 1000 },
      };
      window.__emitAssignment();
    });
    await t.page
      .getByRole("button", { name: "응시 시작", exact: true })
      .waitFor();
    await t.page
      .getByRole("button", { name: "응시 시작", exact: true })
      .click();
    await t.page
      .getByRole("button", { name: "제출하기", exact: true })
      .waitFor();
    assert.equal((await draft(t.page)).attemptId, "attempt-2");
    assert.equal((await draft(t.page)).pendingViolation, null);
    assert.equal(await firstInput(t.page).inputValue(), "");
    await finish(t);
  }
  {
    const t = await open("hints-ime-and-reload");
    await t.page.evaluate(() => {
      window.__useHint();
      window.__useHint();
      window.__useHint();
      window.__useHint();
    });
    assert.equal((await draft(t.page)).hintUseCount, 3);
    await firstInput(t.page).focus();
    await firstInput(t.page).dispatchEvent("compositionstart");
    await firstInput(t.page).fill("고조선");
    await t.page.getByRole("button", { name: /^단어 목록/ }).focus();
    assert.equal(
      await t.page.locator("[data-blank-feedback]").count(),
      0,
      "IME does not show correctness mid-composition",
    );
    await firstInput(t.page).dispatchEvent("compositionend");
    await advance(t.page, 100);
    assert.equal(await t.page.locator("[data-blank-feedback]").count(), 1);
    await t.page.reload();
    await t.page
      .getByRole("button", { name: "제출하기", exact: true })
      .waitFor();
    assert.equal((await draft(t.page)).hintUseCount, 3);
    assert.equal(await t.page.evaluate(() => window.__useHint()), false);
    await finish(t);
  }
  await fs.writeFile(
    path.join(evidence, "runner-report.json"),
    JSON.stringify(reports, null, 2),
  );
  console.log(
    `History classroom runner: ${reports.length} browser scenarios passed.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
