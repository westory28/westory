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
  ".superloopy/sessions/history-lesson-worksheets/evidence",
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
if(params.get('due')==='1'&&!stored)fixture.assignment.dueAt={seconds:(Date.now()+6000)/1000};
const persist=()=>localStorage.setItem('runnerFixtureBackend',JSON.stringify(fixture));
window.__persistBackend=persist;
export const config={year:'2026',semester:'2'};
export const db={};
export const useAuth=()=>({config,userData:{uid:'student-1',role:'student',name:'검증학생',grade:'1',class:'2',number:'3'}});
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
if(!result){const checks=fixture.assignment.blanks.map((b,i)=>({blankId:b.id,blankNumber:i+1,page:b.page,studentAnswer:input.answers[b.id]||'',correctAnswer:b.answer,correct:!fixture.forceZero&&(input.answers[b.id]||'').replace(/\s/g,'')===b.answer.replace(/\s/g,'')}));const score=checks.filter(c=>c.correct).length,percent=Math.round(score/checks.length*100),passed=input.status!=='cancelled'&&percent>=80;result=fixture.results[input.resultId]={assignmentId:input.assignmentId,uid:'student-1',resultId:input.resultId,score,total:checks.length,percent,passed,passThresholdPercent:fixture.forceZero?90:fixture.assignment.passThresholdPercent,status:input.status==='cancelled'?'cancelled':passed?'passed':'failed',answerChecks:checks,createdAt:{seconds:Date.now()/1000}};persist();}
if(fixture.loseNextResponse){fixture.loseNextResponse=false;persist();return new Promise(()=>{});}return {data:result};};
export const notifyPointsUpdated=()=>{};
export const notifyHistoryClassroomSubmitted=async()=>{};
export const claimPointActivityReward=async(input)=>{fixture.points.push(input);persist();return {awarded:false,amount:0};};
export const buildHistoryClassroomRewardSourceId=id=>'history:'+id;
export const emitSessionActivity=()=>{};
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
              /^firebase\/firestore$|(?:lib\/|^\.\/)(?:firebase|notifications|points|appEvents|sessionActivity)$|contexts\/AuthContext$|common\/AppToastProvider$/,
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
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}body{margin:0}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
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
      ? bundle.outputFiles[0].text
      : url === "/tailwind.js"
        ? tailwind
        : url === "/worksheet.svg"
          ? svg
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
async function open(label, width = 768, query = "") {
  const context = await browser.newContext({
    viewport: { width, height: 1024 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(`http://127.0.0.1:${server.address().port}`)
      ? route.continue()
      : route.abort(),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/${query}`);
  await page.locator('input[placeholder="첫 빈칸"]').waitFor();
  await page.clock.install({ time: Date.now() });
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
    ...(await test.page.evaluate(() => ({
      calls: window.__fixture.calls,
      directWrites: window.__fixture.directWrites,
      results: window.__fixture.results,
      points: window.__fixture.points,
    }))),
    errors: test.errors,
  });
  await test.context.close();
  console.log(test.label + ": passed");
}
const fillFirst = (page) =>
  page.locator('input[placeholder="첫 빈칸"]').fill("고조선");
const submit = (page) =>
  page
    .getByRole("button", { name: /^(제출|제출하기|답안 제출|다시 제출)$/ })
    .click();
try {
  for (const width of [390, 768, 1280]) {
    for (const mode of ["mixed", "empty", "correct", "cancelled"]) {
      const t = await open(
        `compact-result-${mode}-${width}`,
        width,
        ["mixed", "empty"].includes(mode) ? "?resultCase=long" : "",
      );
      if (mode === "mixed") {
        await t.page.evaluate(() => {
          for (let index = 0; index < 3; index++)
            window.__changeAnswer("internal-blank-" + index, "고조선");
          window.__changeAnswer("internal-blank-3", "학생오입력숨김");
        });
      } else if (mode === "correct") {
        await fillFirst(t.page);
        await t.page.getByRole("button", { name: "다음", exact: true }).click();
        await t.page.locator('input[placeholder="둘째 빈칸"]').fill("백제");
      }
      if (mode === "cancelled") {
        await t.page.evaluate(() => {
          const link = document.createElement("a");
          link.href = "/#/student/history-classroom";
          link.textContent = "검증 나가기";
          document.body.appendChild(link);
        });
        await t.page.getByRole("link", { name: "검증 나가기" }).click();
        await t.page
          .getByRole("button", { name: "나가기", exact: true })
          .click();
        await advance(t.page, 100);
        assert.equal((await getCalls(t.page))[0].status, "cancelled");
        assert.equal(
          await t.page.getByRole("dialog", { name: /^(통과|미통과)$/ }).count(),
          0,
          "cancelled attempt keeps its exit flow",
        );
      } else {
        await submit(t.page);
        const dialog = t.page.getByRole("dialog", {
          name: mode === "correct" ? "통과" : "미통과",
          exact: true,
        });
        await dialog.waitFor();
        const expectedScore = mode === "mixed" ? 3 : mode === "correct" ? 2 : 0;
        const expectedTotal = mode === "correct" ? 2 : 46;
        assert.equal(
          await dialog.getByLabel("정답 수", { exact: true }).textContent(),
          `${expectedScore}/${expectedTotal}문제`,
        );
        const missed = dialog
          .getByRole("region", { name: "못 쓴 답들", exact: true })
          .locator("p");
        const savedResult = await t.page.evaluate(
          () => Object.values(window.__fixture.results)[0],
        );
        const expectedAnswers = [
          ...new Set(
            savedResult.answerChecks
              .filter((check) => !check.correct)
              .map((check) => check.correctAnswer.trim())
              .filter(Boolean),
          ),
        ];
        assert.equal(
          await missed.textContent(),
          expectedAnswers.join(", ") || "없음",
          "one deduplicated answer list includes blanks and wrong input",
        );
        assert.equal(
          await missed.locator("*").count(),
          0,
          "no individual wrong-question cards",
        );
        const content = await dialog.textContent();
        assert(
          !content.includes("internal-blank-") &&
            !content.includes("학생오입력숨김") &&
            !content.includes("학생 입력값"),
          "no internal ids or wrong input exposed",
        );
        const geometry = await dialog.evaluate((el) => {
          const panel = el.firstElementChild,
            r = panel.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            width: innerWidth,
            height: innerHeight,
            overflow: panel.scrollWidth > panel.clientWidth + 1,
          };
        });
        assert(
          geometry.left >= 0 &&
            geometry.right <= width &&
            !geometry.overflow &&
            geometry.top >= 0 &&
            geometry.bottom <= geometry.height,
          JSON.stringify(geometry),
        );
        if (mode === "mixed")
          assert(
            await dialog
              .getByText("7% · 통과 기준 90%", { exact: true })
              .isVisible(),
          );
        if (mode === "empty")
          assert.equal(
            expectedAnswers.filter((answer) => answer === "백제").length,
            1,
          );
        assert(
          (
            await dialog
              .getByRole("button", { name: "확인", exact: true })
              .boundingBox()
          ).height >= 44,
        );
      }
      await finish(t);
    }
  }
  // Offline keeps editing and pauses the deadline; normal reload restores page,
  // answer and deadline even after the old eight-second rotation window.
  for (const width of [390, 768, 1280]) {
    const t = await open(`offline-reload-${width}`, width);
    assert.equal(
      (await draft(t.page)).hintUseCount,
      0,
      "new attempt starts with no hints used",
    );
    assert.equal(await t.page.evaluate(() => window.__useHint()), true);
    assert.equal(
      (await draft(t.page)).hintUseCount,
      1,
      "hint use is persisted synchronously",
    );
    await fillFirst(t.page);
    await advance(t.page, 1000);
    await t.context.setOffline(true);
    await advance(t.page, 1000);
    const before = await draft(t.page);
    assert(before.offlineStartedAt);
    assert.equal(await t.page.evaluate(() => window.__useHint()), true);
    assert.equal(
      (await draft(t.page)).hintUseCount,
      2,
      "offline hint use stays with the attempt",
    );
    await t.page.locator('input[placeholder="첫 빈칸"]').fill("고조선 보존");
    await advance(t.page, 15000);
    assert.equal(
      (await getCalls(t.page)).length,
      0,
      "offline must not cancel or submit",
    );
    await t.context.setOffline(false);
    await advance(t.page, 100);
    const after = await draft(t.page);
    assert(
      after.deadlineMs - before.deadlineMs >= 15000,
      "offline time is credited back",
    );
    await t.page.reload();
    await t.page.locator('input[placeholder="첫 빈칸"]').waitFor();
    assert.equal(
      await t.page.locator('input[placeholder="첫 빈칸"]').inputValue(),
      "고조선 보존",
    );
    assert.equal(
      (await draft(t.page)).resultId,
      before.resultId,
      "same attempt survives normal reload",
    );
    assert.equal(
      (await draft(t.page)).hintUseCount,
      2,
      "same attempt restores hints after offline/reload",
    );
    assert.equal(await t.page.evaluate(() => window.__hintCount), 2);
    assert.deepEqual(
      await t.page.evaluate(() => [
        window.__useHint(),
        window.__useHint(),
        window.__useHint(),
      ]),
      [true, false, false],
      "rapid calls cannot exceed three uses before React rerenders",
    );
    assert.equal((await draft(t.page)).hintUseCount, 3);
    await t.page.reload();
    await t.page.locator('input[placeholder="첫 빈칸"]').waitFor();
    assert.equal(await t.page.evaluate(() => window.__hintCount), 3);
    assert.equal(
      await t.page.evaluate(() => window.__useHint()),
      false,
      "refresh does not replenish hints",
    );
    await finish(t);
  }
  {
    const t = await open("offline-submit-online");
    await fillFirst(t.page);
    await t.context.setOffline(true);
    await advance(t.page, 100);
    await submit(t.page);
    await advance(t.page, 100);
    const saved = await draft(t.page);
    assert.equal(saved.pendingSubmission.answers["blank-a"], "고조선");
    assert.equal(
      await t.page.evaluate(() => window.__useHint()),
      false,
      "queued submissions cannot consume hints",
    );
    assert.equal((await getCalls(t.page)).length, 0);
    await t.context.setOffline(false);
    await advance(t.page, 100);
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    assert.equal((await getCalls(t.page)).length, 1);
    assert.equal(await draft(t.page), null);
    await finish(t);
  }
  {
    const t = await open("timeout-latest-answers-retry");
    await fillFirst(t.page);
    await t.page.getByRole("button", { name: "다음", exact: true }).click();
    await t.page.locator('input[placeholder="둘째 빈칸"]').fill("백제");
    await t.page.evaluate(() => {
      window.__fixture.failures = ["functions/unavailable"];
    });
    await advance(t.page, 61000);
    await advance(t.page, 3000);
    await t.page.getByRole("dialog", { name: "통과", exact: true }).waitFor();
    const calls = await getCalls(t.page);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].resultId, calls[1].resultId);
    assert.deepEqual(calls[1].answers, {
      "blank-a": "고조선",
      "blank-b": "백제",
    });
    assert.equal(
      (await t.page.evaluate(() => window.__fixture.directWrites)).length,
      0,
    );
    await finish(t);
  }
  {
    const t = await open("lost-response-idempotent");
    await fillFirst(t.page);
    await t.page.evaluate(() => {
      window.__fixture.loseNextResponse = true;
    });
    await submit(t.page);
    await advance(t.page, 23000);
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    const calls = await getCalls(t.page);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].resultId, calls[1].resultId);
    assert.equal(
      await t.page.evaluate(() => Object.keys(window.__fixture.results).length),
      1,
    );
    assert.equal(
      (await t.page.evaluate(() => window.__fixture.directWrites)).length,
      0,
    );
    await finish(t);
  }
  {
    const t = await open("pending-reload-and-zero-score");
    await fillFirst(t.page);
    await t.page.evaluate(() => {
      window.__fixture.failures = ["functions/permission-denied"];
      window.__fixture.forceZero = true;
      window.__persistBackend();
    });
    await submit(t.page);
    await advance(t.page, 100);
    const saved = await draft(t.page);
    assert(saved.pendingSubmission);
    await t.page.reload();
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    const calls = await getCalls(t.page);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].resultId, calls[1].resultId);
    assert(
      await t.page.getByText("0/2문제", { exact: true }).isVisible(),
      "zero server score must not fall back to local score",
    );
    assert(
      await t.page.getByText("0% · 통과 기준 90%", { exact: true }).isVisible(),
      "server pass threshold is used with its score",
    );
    await finish(t);
  }
  {
    const t = await open("saved-response-reload");
    await fillFirst(t.page);
    await t.page.evaluate(() => {
      window.__fixture.loseNextResponse = true;
    });
    await submit(t.page);
    await advance(t.page, 100);
    assert((await draft(t.page)).pendingSubmission);
    await t.page.reload();
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    assert.equal(
      (await getCalls(t.page)).length,
      1,
      "confirmed server result is restored without a second attempt",
    );
    assert.equal(await draft(t.page), null);
    assert.equal(
      await t.page.evaluate(() => window.__fixture.points.length),
      1,
      "recovered submission claims the same idempotent reward",
    );
    await finish(t);
  }
  for (const mode of ["hidden", "unassigned", "deleted"]) {
    const t = await open(`saved-result-after-${mode}`);
    await fillFirst(t.page);
    await t.page.evaluate(() => {
      window.__fixture.loseNextResponse = true;
    });
    await submit(t.page);
    await advance(t.page, 100);
    await t.page.evaluate((mode) => {
      if (mode === "hidden") window.__fixture.assignment.isPublished = false;
      if (mode === "unassigned") {
        window.__fixture.assignment.targetStudentUid = "other";
        window.__fixture.assignment.targetStudentUids = ["other"];
      }
      if (mode === "deleted") {
        window.__fixture.assignment.isDeleted = true;
        window.__fixture.denyAssignmentRead = true;
      }
      window.__persistBackend();
    }, mode);
    await t.page.reload();
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    assert.equal(
      (await getCalls(t.page)).length,
      1,
      "confirmed own result survives revoked source access without resubmitting",
    );
    assert.equal(await draft(t.page), null);
    await finish(t);
  }
  for (const mismatch of ["uid", "assignmentId"]) {
    const t = await open(`result-ownership-${mismatch}`);
    await fillFirst(t.page);
    await t.page.evaluate(() => {
      window.__fixture.loseNextResponse = true;
    });
    await submit(t.page);
    await advance(t.page, 100);
    await t.page.evaluate((mismatch) => {
      const saved = Object.values(window.__fixture.results)[0];
      saved[mismatch] = "other";
      window.__fixture.assignment.isPublished = false;
      window.__persistBackend();
    }, mismatch);
    await t.page.reload();
    await t.page
      .getByText("아직 공개되지 않은 과제입니다.", { exact: true })
      .waitFor();
    assert.equal(
      await t.page.getByRole("dialog").count(),
      0,
      "another student or assignment result cannot open the recovery path",
    );
    assert.equal((await getCalls(t.page)).length, 1);
    await finish(t);
  }
  {
    const t = await open("due-window-offline-retry", 768, "?due=1");
    await fillFirst(t.page);
    await t.context.setOffline(true);
    await advance(t.page, 8000);
    assert.equal((await getCalls(t.page)).length, 0);
    await t.page.evaluate(() => {
      window.__fixture.failures = ["functions/unavailable"];
    });
    await t.context.setOffline(false);
    await advance(t.page, 100);
    assert.equal((await draft(t.page)).pendingSubmission.reason, "due-window");
    await advance(t.page, 3000);
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    const calls = await getCalls(t.page);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].resultId, calls[1].resultId);
    assert.equal(calls[1].answers["blank-a"], "고조선");
    await finish(t);
  }
  {
    const t = await open("double-submit");
    await fillFirst(t.page);
    const button = t.page.getByRole("button", {
      name: /^(제출|제출하기|답안 제출)$/,
    });
    await button.evaluate((el) => {
      el.click();
      el.click();
    });
    await advance(t.page, 100);
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    assert.equal((await getCalls(t.page)).length, 1);
    await finish(t);
  }
  {
    const t = await open("server-rejection-no-legacy");
    await fillFirst(t.page);
    await t.page.evaluate(() => {
      window.__fixture.failures = [
        {
          code: "functions/not-found",
          message: "History classroom assignment does not exist.",
        },
      ];
    });
    await submit(t.page);
    await advance(t.page, 5000);
    assert.equal(
      (await getCalls(t.page)).length,
      1,
      "server rejection is not automatically repeated",
    );
    assert.equal(
      await t.page.evaluate(() => window.__fixture.directWrites.length),
      0,
      "missing assignment cannot fall back to an unvalidated client result",
    );
    assert(
      (await draft(t.page)).pendingSubmission,
      "rejected answer is still retained",
    );
    assert(
      await t.page
        .getByRole("button", { name: "다시 제출", exact: true })
        .isEnabled(),
    );
    await finish(t);
  }
  {
    const t = await open("legacy-callable-absent");
    await fillFirst(t.page);
    await t.page.evaluate(() => {
      window.__fixture.failures = ["functions/not-found"];
    });
    await submit(t.page);
    await advance(t.page, 100);
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    const writes = await t.page.evaluate(() => window.__fixture.directWrites);
    assert.equal(
      writes.length,
      1,
      "known absent callable retains the legacy deployment path",
    );
    assert(
      writes[0].path.startsWith(
        "years/2026/semesters/2/history_classroom_results/",
      ),
    );
    assert.equal(writes[0].data.answers["blank-a"], "고조선");
    await finish(t);
  }
  {
    const t = await open("confirmed-exit-cancels");
    await fillFirst(t.page);
    await t.page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "/#/student/history-classroom";
      link.textContent = "검증 나가기";
      document.body.appendChild(link);
    });
    await t.page.getByRole("link", { name: "검증 나가기" }).click();
    await t.page
      .getByRole("dialog", { name: "역사교실을 나가시겠습니까?" })
      .waitFor();
    await t.page.getByRole("button", { name: "나가기", exact: true }).click();
    await advance(t.page, 100);
    const calls = await getCalls(t.page);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, "cancelled");
    assert.equal(await draft(t.page), null);
    await finish(t);
  }
  for (const mode of ["scoped", "legacy"]) {
    const t = await open(`teacher-reset-open-cooldown-${mode}`);
    await fillFirst(t.page);
    await submit(t.page);
    await t.page.getByRole("dialog", { name: "미통과", exact: true }).waitFor();
    await t.page.evaluate((mode) => {
      window.__fixture.legacyAssignment = mode === "legacy";
      window.__persistBackend();
    }, mode);
    await t.page.reload();
    await t.page.getByText(/분 후 다시 응시할 수 있습니다/).waitFor();
    await t.page.evaluate(() => {
      window.__fixture.assignment.retryResetByStudentUid = {
        "other-student": { seconds: Date.now() / 1000 },
      };
      window.__emitAssignment();
    });
    await advance(t.page, 100);
    assert(await t.page.getByText(/분 후 다시 응시할 수 있습니다/).isVisible());
    await t.page.evaluate(() => {
      window.__fixture.assignment.retryResetByStudentUid["student-1"] = {
        seconds: Date.now() / 1000,
      };
      window.__emitAssignment();
    });
    await t.page.locator('input[placeholder="첫 빈칸"]').waitFor();
    assert.equal(
      await t.page.locator('input[placeholder="첫 빈칸"]').inputValue(),
      "",
    );
    assert.equal(
      await t.page.evaluate(() => Object.keys(window.__fixture.results).length),
      1,
    );
    assert.equal((await getCalls(t.page)).length, 1);
    await finish(t);
  }
  for (const mode of ["pending", "committed", "active", "passed"]) {
    const t = await open(`teacher-reset-reentry-${mode}`);
    assert.equal(await t.page.evaluate(() => window.__useHint()), true);
    await fillFirst(t.page);
    const before = await draft(t.page);
    if (mode !== "active") {
      if (mode === "passed") {
        await t.page.getByRole("button", { name: "다음", exact: true }).click();
        await t.page.locator('input[placeholder="둘째 빈칸"]').fill("백제");
      }
      await t.page.evaluate((mode) => {
        if (mode === "pending")
          window.__fixture.failures = ["functions/permission-denied"];
        else window.__fixture.loseNextResponse = true;
      }, mode);
      await submit(t.page);
      await advance(t.page, 100);
    }
    await advance(t.page, 100);
    await t.page.evaluate(() => {
      window.__fixture.assignment.retryResetByStudentUid = {
        "student-1": { seconds: Date.now() / 1000 },
      };
      window.__emitAssignment();
    });
    await advance(t.page, 100);
    if (mode === "active") {
      assert.equal(
        await t.page.locator('input[placeholder="첫 빈칸"]').inputValue(),
        "고조선",
        "reset must not interrupt a normal active attempt",
      );
      assert.equal((await draft(t.page)).resultId, before.resultId);
    }
    // pagehide re-saves the draft after the reset. Its marker version must stay
    // unchanged even though savedAt becomes newer than the teacher's reset.
    await t.page.reload();
    if (mode === "passed") {
      await t.page.getByText(/이미 통과한 역사교실입니다/).waitFor();
      assert.equal(await t.page.getByRole("dialog").count(), 0);
    } else {
      await t.page.locator('input[placeholder="첫 빈칸"]').waitFor();
      assert.equal(
        await t.page.locator('input[placeholder="첫 빈칸"]').inputValue(),
        "",
      );
      assert.notEqual((await draft(t.page)).resultId, before.resultId);
      assert.equal((await draft(t.page)).pendingSubmission, null);
      assert.equal(
        (await draft(t.page)).hintUseCount,
        0,
        "teacher reset starts a fresh hint allowance",
      );
    }
    assert.equal((await getCalls(t.page)).length, mode === "active" ? 0 : 1);
    assert.equal(
      await t.page.evaluate(() => Object.keys(window.__fixture.results).length),
      ["committed", "passed"].includes(mode) ? 1 : 0,
    );
    await finish(t);
  }
  for (const [raw, expected] of [
    [null, 0],
    [-8, 0],
    [99, 3],
    ["invalid", 0],
    [2.9, 2],
  ]) {
    const t = await open(`hint-normalization-${String(raw)}`);
    await t.page.addInitScript(
      ({ key, raw }) => {
        const saved = JSON.parse(localStorage.getItem(key));
        if (raw === null) delete saved.hintUseCount;
        else saved.hintUseCount = raw;
        localStorage.setItem(key, JSON.stringify(saved));
      },
      { key, raw },
    );
    await t.page.reload();
    await t.page.locator('input[placeholder="첫 빈칸"]').waitFor();
    assert.equal((await draft(t.page)).hintUseCount, expected);
    assert.equal(await t.page.evaluate(() => window.__hintCount), expected);
    await finish(t);
  }
  {
    const t = await open("untimed-draft", 768, "?untimed=1");
    await fillFirst(t.page);
    await advance(t.page, 100);
    assert.equal((await draft(t.page)).deadlineMs, 0);
    await t.page.reload();
    await t.page.locator('input[placeholder="첫 빈칸"]').waitFor();
    assert.equal(
      await t.page.locator('input[placeholder="첫 빈칸"]').inputValue(),
      "고조선",
    );
    await finish(t);
  }
} finally {
  await fs.writeFile(
    path.join(evidence, "runner-recovery-report.json"),
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        coverage:
          "actual Runner/View, offline browser state and fake-clock deadlines; mock callable/backend; no physical iPad or live Firebase",
        reports,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log("Evidence: " + evidence);
