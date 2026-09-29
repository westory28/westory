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
export const doc=(...parts)=>{const r=reference(...parts);if(parts.length===1)r.path+='/fixture-result-'+(++idCounter);return {...r,id:r.path.split('/').at(-1)};};
export const where=(key,operator,value)=>({key,value});
export const query=(ref,...constraints)=>({...ref,constraints});
export const serverTimestamp=()=>({seconds:Date.now()/1000});
const snap=(id,value)=>({id,exists:()=>value!==undefined,data:()=>structuredClone(value)});
export const getDoc=async(ref)=>{if(ref.path.endsWith('/history_classrooms/assignment-1')){if(fixture.denyAssignmentRead){const error=new Error('assignment access denied');error.code='permission-denied';throw error;}return snap('assignment-1',fixture.assignment);}return snap(ref.id,fixture.results[ref.id]);};
export const getDocs=async(ref)=>{const docs=ref.path===scope+'/history_classroom_results'?Object.entries(fixture.results).map(([id,value])=>snap(id,value)):[];return {docs,empty:!docs.length};};
export const setDoc=async(ref,data)=>{fixture.directWrites.push({path:ref.path,data});persist();};
export const getHttpsCallable=async()=>async(input)=>{
fixture.calls.push(structuredClone(input));persist();
const failure=fixture.failures.shift();if(failure){persist();const error=new Error(typeof failure==='string'?failure:failure.message);error.code=typeof failure==='string'?failure:failure.code;throw error;}
if(!navigator.onLine){const error=new Error('network unavailable');error.code='functions/unavailable';throw error;}
let result=fixture.results[input.resultId];
if(!result){const checks=fixture.assignment.blanks.map((b,i)=>({blankId:b.id,blankNumber:i+1,page:b.page,studentAnswer:input.answers[b.id]||'',correctAnswer:b.answer,correct:!fixture.forceZero&&(input.answers[b.id]||'').replace(/\s/g,'')===b.answer.replace(/\s/g,'')}));const score=checks.filter(c=>c.correct).length,percent=score/checks.length*100,passed=input.status!=='cancelled'&&percent>=80;result=fixture.results[input.resultId]={assignmentId:input.assignmentId,uid:'student-1',resultId:input.resultId,score,total:checks.length,percent,passed,passThresholdPercent:fixture.forceZero?90:80,status:input.status==='cancelled'?'cancelled':passed?'passed':'failed',answerChecks:checks,createdAt:{seconds:Date.now()/1000}};persist();}
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
  // Offline keeps editing and pauses the deadline; normal reload restores page,
  // answer and deadline even after the old eight-second rotation window.
  for (const width of [390, 768, 1280]) {
    const t = await open(`offline-reload-${width}`, width);
    await fillFirst(t.page);
    await advance(t.page, 1000);
    await t.context.setOffline(true);
    await advance(t.page, 1000);
    const before = await draft(t.page);
    assert(before.offlineStartedAt);
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
      await t.page.getByText(/전체 2문제 중 정답 0개/).isVisible(),
      "zero server score must not fall back to local score",
    );
    assert(
      await t.page.getByText("90% 이상", { exact: true }).isVisible(),
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
