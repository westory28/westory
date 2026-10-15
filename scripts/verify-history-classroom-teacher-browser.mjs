/** Exercises the actual teacher component with an in-memory Firestore boundary.
 * No live Firebase reads, writes, notifications, or callable requests are made.
 * Manual browser QA: node scripts/verify-history-classroom-teacher-browser.mjs --serve --port=4176
 * Scenarios: /?scenario=dashboard, new, failure, or edit. Use the app's controls
 * to open forms; the fixture toolbar only seeds scenarios and arms one failure.
 * --serve never imports Playwright, starts a browser, or downloads assets.
 */
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
const serveOnly = process.argv.includes("--serve");
const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
const servePort = Number(portArgument?.split("=")[1] || process.env.HISTORY_CLASSROOM_FIXTURE_PORT || 4176);
assert(Number.isInteger(servePort) && servePort >= 0 && servePort <= 65535, "Fixture port must be an integer from 0 to 65535");
let playwright;
if (!serveOnly) {
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
}
const evidence = path.join(
  root,
  ".superloopy/sessions/history-classroom-followup/evidence",
);
if (!serveOnly) await fs.mkdir(evidence, { recursive: true });
const cache = process.env.TAILWIND_FIXTURE_PATH || path.join(os.tmpdir(), "westory-tailwind-fixture.js");
let tailwind;
try {
  tailwind = await fs.readFile(cache, "utf8");
} catch {
  if (serveOnly) throw new Error(`Offline fixture requires a local Tailwind script: ${cache}. Set TAILWIND_FIXTURE_PATH to an existing local file.`);
  const response = await fetch("https://cdn.tailwindcss.com/3.4.17");
  assert(response.ok);
  tailwind = await response.text();
  await fs.writeFile(cache, tailwind);
}
const scope = "years/2026/semesters/2";
const longTitle =
  "고대 국가의 성립과 발전 및 한반도와 동아시아의 교류를 살펴보는 긴 수업 자료 목차";
const pageImages = [1, 3].map((page) => ({
  page,
  imageUrl: `/worksheet.svg?page=${page}`,
  width: 1000,
  height: 1400,
}));
const originalBlanks = [
  {
    id: "saved-ocr",
    page: 1,
    leftRatio: 0.125,
    topRatio: 0.235,
    widthRatio: 0.1875,
    heightRatio: 0.0275,
    answer: "고조선",
    prompt: "나라 이름",
    source: "ocr",
  },
  {
    id: "saved-manual",
    page: 3,
    leftRatio: 0.325,
    topRatio: 0.435,
    widthRatio: 0.1375,
    heightRatio: 0.0375,
    answer: "삼국 시대",
    prompt: "시대 이름",
    source: "manual",
  },
];
const lesson = (unitId, title, answer) => ({
  unitId,
  title,
  worksheetPageImages: pageImages,
  worksheetBlanks: answer
    ? [{ ...originalBlanks[0], id: `saved-${unitId}`, answer }]
    : originalBlanks,
  worksheetTextRegions: [],
});
const map = {
  title: "한반도 지도",
  type: "pdf",
  sortOrder: 0,
  pdfPageImages: pageImages,
  pdfRegions: [],
  pdfBlanks: [
    {
      id: "map-blank",
      page: 1,
      left: 120,
      top: 240,
      width: 160,
      height: 40,
      answer: "평양",
      prompt: "도시",
      source: "manual",
    },
  ],
};
const store = {
  [`${scope}/curriculum/tree`]: {
    tree: [
      {
        id: "chapter",
        title: "II. 고대 사회",
        children: [
          {
            id: "middle",
            title: "국가의 형성",
            children: [
              { id: "b", title: "2. 삼국", children: [] },
              { id: "a", title: longTitle, children: [] },
            ],
          },
          {
            id: "middle-other",
            title: "국가의 형성",
            children: [{ id: "d", title: "2. 삼국", children: [] }],
          },
        ],
      },
      {
        id: "chapter-copy",
        title: "II. 고대 사회",
        children: [
          {
            id: "middle-copy",
            title: "국가의 형성",
            children: [{ id: "c", title: "2. 삼국", children: [] }],
          },
        ],
      },
    ],
  },
  [`${scope}/lessons/c`]: lesson("c", "중복 제목 수업", "신라"),
  [`${scope}/lessons/d`]: lesson("d", "다른 중목차 수업", "고구려"),
  [`${scope}/lessons/b`]: lesson("b", "삼국 수업", "백제"),
  [`${scope}/lessons/a`]: lesson("a", longTitle),
  [`${scope}/map_resources/map-1`]: map,
  "users/student-1": {
    role: "student",
    name: "검증학생",
    grade: "3",
    class: "2",
    number: "3",
  },
};
// The server mode uses only synthetic students. New/failure scenarios start
// with an empty dashboard; use the actual app's new/edit controls to enter forms.
const serveStore = structuredClone(store);
delete serveStore["users/student-1"];
const syntheticStudents = Array.from({ length: 34 }, (_, index) => ({
  uid: `synthetic-student-${String(index + 1).padStart(2, "0")}`,
  name: `합성학생${String(index + 1).padStart(2, "0")}`,
  number: String(index + 1),
}));
for (const student of syntheticStudents) {
  serveStore[`users/${student.uid}`] = { role: "student", name: student.name, grade: "3", class: "2", number: student.number };
}
const assignedStudents = syntheticStudents.slice(0, 24);
const seededAssignmentPath = `${scope}/history_classrooms/synthetic-long-assignment`;
serveStore[seededAssignmentPath] = {
  title: longTitle,
  sourceType: "lesson", lessonUnitId: "a", lessonTitle: longTitle,
  lessonUnitPath: ["II. 고대 사회", "국가의 형성", longTitle],
  mapResourceId: "", mapTitle: "", description: "",
  pdfPageImages: pageImages, pdfRegions: [],
  blanks: originalBlanks.map((blank) => ({ id: blank.id, page: blank.page,
    left: blank.leftRatio * 1000, top: blank.topRatio * 1400,
    width: blank.widthRatio * 1000, height: blank.heightRatio * 1400,
    answer: blank.answer, prompt: blank.prompt, source: blank.source })),
  answerOptions: originalBlanks.map((blank) => blank.answer),
  timeLimitMinutes: 10, cooldownMinutes: 5, dueWindowDays: null, passThresholdPercent: 90,
  targetGrade: "3", targetClass: "2", targetStudentUid: assignedStudents[0].uid,
  targetStudentUids: assignedStudents.map((student) => student.uid),
  targetStudentNames: assignedStudents.map((student) => student.name),
  targetStudentName: assignedStudents.map((student) => student.name).join(", "),
  targetStudentNumber: assignedStudents.map((student) => student.number).join(", "),
  targetStudentAccessMap: Object.fromEntries(assignedStudents.map((student) => [student.uid, true])),
  targetStudentReasons: Object.fromEntries(assignedStudents.map((student, index) => [student.uid,
    index % 3 === 0 ? "지각" : index % 3 === 1 ? "수업 태도" : "합성 검증용 개별 사유"])),
  contentRevision: 1, isPublished: true,
  createdAt: { seconds: 1792022400, nanoseconds: 0 },
  updatedAt: { seconds: 1792022400, nanoseconds: 0 },
  publishedAt: { seconds: 1792022400, nanoseconds: 0 }, dueAt: null,
};
const mock = `
const fixture=window.__fixture={store:${JSON.stringify(serveOnly ? serveStore : store)},writes:[],successfulWrites:[],failedWrites:[],notifications:[],reads:[],alerts:[],commands:[]};
const serveMode=${serveOnly};
fixture.scenario=serveMode ? new URLSearchParams(window.location.search).get('scenario') || 'dashboard' : 'automated';
if(serveMode && ['new','failure'].includes(fixture.scenario)) delete fixture.store[${JSON.stringify(seededAssignmentPath)}];
if(serveMode && fixture.scenario==='failure') fixture.failNextWrite=true;
const changed=()=>window.dispatchEvent(new CustomEvent('fixture-change'));
if(serveMode){window.alert=(message)=>{fixture.alerts.push(String(message));changed();};changed();}
export const config={year:'2026',semester:'2'};
export const db={};
export const useAuth=()=>({config,userData:{uid:'teacher-fixture',role:'teacher',name:'검증교사'}});
const ref=(...parts)=>({path:parts.filter(p=>typeof p==='string').join('/')});
export const collection=(_db,...parts)=>ref(...parts);
export const doc=(_db,...parts)=>ref(...parts);
export const query=(reference)=>reference;
export const orderBy=()=>null;
export const limit=()=>null;
export const serverTimestamp=()=>({seconds:1790676000,nanoseconds:0});
const snap=(key,value)=>({id:key.split('/').at(-1),exists:()=>value!==undefined,data:()=>structuredClone(value)});
export const getDoc=async(reference)=>{fixture.reads.push(reference.path);return snap(reference.path,fixture.store[reference.path]);};
export const getDocs=async(reference)=>{fixture.reads.push(reference.path);const docs=Object.entries(fixture.store).filter(([key])=>key.startsWith(reference.path+'/')&&!key.slice(reference.path.length+1).includes('/')).map(([key,value])=>snap(key,value));return {docs,empty:!docs.length,size:docs.length};};
export const getDocFromServer=getDoc;
export const getDocsFromServer=getDocs;
export const setDoc=async(reference,payload,options)=>{
 const data=structuredClone(payload);fixture.writes.push({path:reference.path,data,options});changed();
 if(fixture.pauseWrite){fixture.pauseWrite=false;await new Promise(resolve=>fixture.releaseWrite=resolve);}
 if(fixture.failNextWrite){fixture.failNextWrite=false;fixture.failedWrites.push({path:reference.path,data});changed();throw new Error('Expected fixture write failure');}
 if(options?.mergeFields){fixture.store[reference.path]={...(fixture.store[reference.path]||{}),...Object.fromEntries(options.mergeFields.map(key=>[key,data[key]]))};}
 else if(options?.merge){const previous=fixture.store[reference.path]||{};fixture.store[reference.path]={...previous,...data,retryResetByStudentUid:{...previous.retryResetByStudentUid,...data.retryResetByStudentUid}};}
 else fixture.store[reference.path]=data;
 fixture.successfulWrites.push({path:reference.path,data});changed();
};
export const createManagedNotifications=async(_config,payload)=>{fixture.notifications.push(payload);changed();return [];};
export const getHttpsCallable=()=>{throw new Error('Callable use is outside this fixture');};
export const callStudentDataService=()=>{throw new Error('Roster mutation is outside this fixture');};
export const getAssessmentSemesterId=()=> '2026-2';
export const buildAssessmentDefinitionId=(semesterId,kind,sourceId)=>kind.toLowerCase()+':'+semesterId+':'+sourceId;
export const readAssessmentContentRevision=async()=>0;
export const saveHistoryAssessmentSource=async(_config,sourceId,payload,expectedRevision)=>{
 const reference={path:${JSON.stringify(scope)}+'/history_classrooms/'+sourceId};
 const fields=Object.keys(payload).filter(key=>key!=='retryResetByStudentUid');
 await setDoc(reference,payload,{mergeFields:fields});
 return {contentRevision:expectedRevision+1};
};
export const deleteHistoryAssessmentSource=async()=>{throw new Error('Deletion is outside this fixture');};
export const executeAssessmentManagementCommand=async(commandType,payload)=>{
 fixture.commands.push({commandType,payload:structuredClone(payload)});changed();
 if(commandType==='resetAssessmentAttempt'){
  const id=payload.definitionId.split(':').at(-1);
  const key=Object.keys(fixture.store).find(key=>key.endsWith('/history_classrooms/'+id)||key==='history_classrooms/'+id);
  await setDoc({path:key},{retryResetByStudentUid:{[payload.studentUid]:serverTimestamp()},updatedAt:serverTimestamp()},{merge:true});
  return {};
 }
 if(commandType==='grantHistoryClassroomExemptions') {
  if(fixture.pauseGrant){fixture.pauseGrant=false;await new Promise(resolve=>fixture.releaseGrant=resolve);}
  if(fixture.failNextGrant){fixture.failNextGrant=false;throw Object.assign(new Error('INTERNAL'),{code:'functions/internal'});}
  return {createdCount:payload.recipientUids.length,exemptionIds:payload.recipientUids.map(uid=>'exemption-'+uid)};
 }
 throw new Error('Unexpected command '+commandType);
};
export const executeStudentAssessmentCommand=async()=>{throw new Error('Student mutation is outside this teacher fixture');};
`;
const component = JSON.stringify(
  path
    .join(root, "src/pages/teacher/ManageHistoryClassroom.tsx")
    .replaceAll("\\", "/"),
);
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import Manage from ${component};const root=createRoot(document.getElementById('root'));let revision=0;window.__remount=()=>root.render(<MemoryRouter key={++revision}><Manage/></MemoryRouter>);window.__remount();`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  outfile: "fixture.js",
  write: false,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  plugins: [
    {
      name: "in-memory-boundaries",
      setup(build) {
        build.onResolve(
          {
            filter:
              /^firebase\/firestore$|(?:lib\/|^\.\/)(?:firebase|notifications|assessmentLifecycle|assessmentRelease|studentProfileCommands)$|contexts\/AuthContext$/,
          },
          () => ({ path: "fixture-boundaries", namespace: "fixture" }),
        );
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
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
  .concat(bundle.outputFiles.filter((file) => file.path.endsWith(".css")).map((file) => file.text))
  .join("\n")
  .replaceAll(/@import[^;]+;/g, "")
  .replaceAll(/@tailwind[^;]+;/g, "");
const fixtureShellCss = `
#fixture-shell{display:grid;grid-template-columns:224px minmax(0,1fr);min-height:100dvh}
#fixture-sidebar{width:224px;box-sizing:border-box;padding:24px 16px;background:#fff;border-right:1px solid #e2e8f0;position:sticky;top:0;height:100dvh}
#fixture-sidebar strong{display:block;color:#2563eb;font-size:24px;margin-bottom:24px}
#fixture-sidebar p{margin:16px 0;color:#475569;font-size:14px}
#fixture-sidebar [aria-current]{padding:12px;border-radius:8px;background:#eff6ff;color:#2563eb}
#fixture-main{min-width:0}
#fixture-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;background:#fff;border-bottom:1px solid #e2e8f0;font-size:12px}
#fixture-toolbar nav{display:flex;flex-wrap:wrap;gap:4px}
#fixture-toolbar a,#fixture-toolbar button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;text-decoration:none}
#fixture-toolbar a[aria-current]{background:#eff6ff;color:#2563eb;border-color:#2563eb}
#fixture-toolbar button:focus-visible,#fixture-toolbar a:focus-visible,#fixture-records summary:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
#fixture-status{flex-basis:100%;overflow-wrap:anywhere;color:#475569}
#fixture-records{margin:16px;padding:12px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;min-width:0}
#fixture-records summary{min-height:44px;cursor:pointer;font-weight:700;color:#334155}
#fixture-records p{font-size:12px;color:#475569}
#fixture-records pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:480px;overflow:auto}
@media(max-width:768px){#fixture-shell{grid-template-columns:minmax(0,1fr)}#fixture-sidebar{display:none}}
`;
const fixtureControls = `
<div id="fixture-toolbar" aria-label="합성 QA 도구">
  <strong>합성 QA</strong>
  <nav aria-label="QA 시나리오">
    <a href="/?scenario=dashboard" data-scenario="dashboard">대시보드</a>
    <a href="/?scenario=new" data-scenario="new">신규 등록</a>
    <a href="/?scenario=failure" data-scenario="failure">저장 실패·재시도</a>
    <a href="/?scenario=edit" data-scenario="edit">편집</a>
  </nav>
  <button type="button" id="fixture-fail-once">다음 저장 1회 실패</button>
  <button type="button" id="fixture-clear-records">QA 기록 지우기</button>
  <span id="fixture-status" role="status" aria-live="polite"></span>
</div>`;
const fixtureRecords = `<details id="fixture-records"><summary id="fixture-records-summary">QA 기록</summary><p>저장과 알림은 이 페이지 메모리에만 기록됩니다. 새로고침하면 초기화됩니다.</p><pre id="fixture-records-json" aria-label="QA 저장 payload와 처리 기록"></pre></details>`;
const fixtureUiScript = `
const updateFixtureRecords=()=>{
 const fixture=window.__fixture;if(!fixture)return;
 const data={scenario:fixture.scenario,writeAttempts:fixture.writes.length,successfulWrites:fixture.successfulWrites.length,failedWrites:fixture.failedWrites.length,notifications:fixture.notifications.length,notificationRecipients:fixture.notifications.reduce((sum,item)=>sum+(item.recipientUids?.length||0),0),failNextWrite:!!fixture.failNextWrite,lastWritePath:fixture.writes.at(-1)?.path||null,payload:fixture.writes.at(-1)?.data||null,writes:fixture.writes,notificationPayloads:fixture.notifications,alerts:fixture.alerts,commands:fixture.commands};
 document.getElementById('fixture-records-summary').textContent='QA 기록 · 저장 시도 '+data.writeAttempts+' / 성공 '+data.successfulWrites+' / 실패 '+data.failedWrites+' · 알림 '+data.notifications+'회';
 document.getElementById('fixture-records-json').textContent=JSON.stringify(data,null,2);
 const hint=['new','failure'].includes(fixture.scenario)?'앱의 새 역사교실 버튼으로 등록을 시작하세요.':'긴 제목 과제 1개 · 합성 학생 34명 · 배정 24명. 앱의 행 수정 버튼으로 편집하세요.';
 document.getElementById('fixture-status').textContent=(fixture.failNextWrite?'다음 저장은 합성 오류로 1회 실패합니다. ':'')+hint+(fixture.alerts.length?' 최근 메시지: '+fixture.alerts.at(-1):'');
 document.querySelectorAll('[data-scenario]').forEach(link=>{if(link.dataset.scenario===fixture.scenario)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
};
window.addEventListener('fixture-change',updateFixtureRecords);
document.getElementById('fixture-fail-once').addEventListener('click',()=>{if(window.__fixture){window.__fixture.failNextWrite=true;updateFixtureRecords();}});
document.getElementById('fixture-clear-records').addEventListener('click',()=>{const fixture=window.__fixture;if(!fixture)return;for(const key of ['writes','successfulWrites','failedWrites','notifications','alerts','commands'])fixture[key].length=0;updateFixtureRecords();});
`;
const fixtureBody = serveOnly
  ? `<div id="fixture-shell"><aside id="fixture-sidebar" aria-label="합성 교사 사이드바"><strong>Westory</strong><p>교사 포털 · 합성 화면</p><p>대시보드</p><p>수업 관리</p><p aria-current="page">역사교실</p><p>학생 관리</p><p>설정</p><p>가로 폭 224px</p></aside><div id="fixture-main">${fixtureControls}<div id="root"></div>${fixtureRecords}</div></div><script>${fixtureUiScript}</script>`
  : '<div id="root"></div>';
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>역사교실 합성 QA</title><script src="/tailwind.js"></script><style>${css}body{margin:0}#root{min-width:0}${serveOnly ? fixtureShellCss : ""}</style>${fixtureBody}<script type="module" src="/fixture.js"></script></html>`;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="1000" height="1400" fill="white"/><text x="100" y="100" font-size="36">교사 자료 검증</text></svg>';
const server = http.createServer((req, res) => {
  const route = req.url.split("?")[0];
  res.setHeader("Cache-Control", "no-store");
  // Block external fonts, images, frames and network calls in server-only QA.
  // Tailwind's local browser compiler requires inline styles/scripts and eval.
  if (serveOnly) res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:");
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
        : route === "/worksheet.svg"
          ? svg
          : html,
  );
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(serveOnly ? servePort : 0, "127.0.0.1", resolve);
});
if (serveOnly) {
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`History Classroom fixture ready (HTTP server only; synthetic data; external requests blocked): ${base}/?scenario=dashboard`);
  console.log(`Scenarios: ${base}/?scenario=new | ${base}/?scenario=failure | ${base}/?scenario=edit`);
  console.log("Use the app's new/edit controls; inspect the QA records panel for payloads and synthetic write/notification counts. Restart this server after source changes.");
  await new Promise((resolve) => {
    const stop = () => { server.closeAllConnections(); server.close(resolve); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  process.exit(0);
}
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const reports = [];
const expectedBlanks = originalBlanks.map((b) => ({
  id: b.id,
  page: b.page,
  left: b.leftRatio * 1000,
  top: b.topRatio * 1400,
  width: b.widthRatio * 1000,
  height: b.heightRatio * 1400,
  answer: b.answer,
  prompt: b.prompt,
  source: b.source,
}));
const snapshotFields = (assignment) =>
  Object.fromEntries(
    [
      "sourceType",
      "lessonUnitId",
      "lessonTitle",
      "lessonUnitPath",
      "mapResourceId",
      "mapTitle",
      "pdfPageImages",
      "pdfRegions",
      "blanks",
      "answerOptions",
    ].map((key) => [key, assignment[key]]),
  );
const waitWrite = async (page, count) => {
  await page.waitForFunction(
    (count) => window.__fixture.writes.length === count,
    count,
  );
  return page.evaluate(() => window.__fixture.writes.at(-1));
};
const measure = async (page, id) =>
  page.locator(id).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      width: r.width,
      height: r.height,
      viewport: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      label: el.selectedOptions[0]?.textContent,
    };
  });
const assertNewDefaults = async (page) => {
  assert.deepEqual(
    await page
      .locator('input[type="number"]')
      .evaluateAll((inputs) => inputs.map((input) => input.value)),
    ["10", "5", "", "90"],
  );
  assert.equal(
    await page.getByLabel("대상 학년", { exact: true }).inputValue(),
    "3",
  );
  assert.equal(
    await page.getByLabel("대상 학급", { exact: true }).inputValue(),
    "2",
  );
};
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: true });
    const errors = [],
      alerts = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    page.on("dialog", async (dialog) => {
      alerts.push(dialog.message());
      await dialog.accept();
    });
    await page.route("**/*", (route) =>
      route
        .request()
        .url()
        .startsWith(`http://127.0.0.1:${server.address().port}`)
        ? route.continue()
        : route.abort(),
    );
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page
      .getByRole("button", { name: "+ 새 역사교실", exact: true })
      .click();
    await assertNewDefaults(page);
    assert.equal(
      await page.locator("#history-create-source-type").count(),
      0,
      "New assignments offer only lesson worksheets",
    );
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#history-create-source option").length === 2,
    );
    const options = await page
      .locator("#history-create-source option")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({ value: node.value, label: node.textContent })),
      );
    assert.deepEqual(
      options.map((item) => item.value),
      ["b", "a"],
      "curriculum order must win over alphabetical sorting",
    );
    assert.equal(options[1].label, longTitle);
    assert.deepEqual(
      await page
        .locator("#history-create-source-level-0 option")
        .evaluateAll((nodes) => nodes.map((node) => node.value)),
      ["chapter", "chapter-copy"],
    );
    await page
      .locator("#history-create-source-level-0")
      .selectOption("chapter-copy");
    assert.deepEqual(
      await page
        .locator("#history-create-source option")
        .evaluateAll((nodes) => nodes.map((node) => node.value)),
      ["c"],
    );
    await page
      .locator("#history-create-source-level-0")
      .selectOption("chapter");
    await page
      .locator("#history-create-source-level-1")
      .selectOption("middle-other");
    assert.deepEqual(
      await page
        .locator("#history-create-source option")
        .evaluateAll((nodes) => nodes.map((node) => node.value)),
      ["d"],
    );
    await page.locator("#history-create-source-level-1").selectOption("middle");
    await page.locator("#history-create-source").selectOption("a");
    const geometry = await measure(page, "#history-create-source");
    assert(
      !geometry.overflow &&
        geometry.right <= viewport.width &&
        geometry.left >= 0,
      `source selector stays in the viewport: ${JSON.stringify(geometry)}`,
    );
    assert(
      geometry.height >= 44,
      "source selector has a tablet-sized touch target",
    );
    await page.screenshot({
      path: path.join(evidence, `teacher-create-${viewport.width}.png`),
      fullPage: true,
    });
    assert.equal(
      await page
        .getByRole("button", { name: "지도 관리", exact: true })
        .count(),
      0,
    );
    await page.getByPlaceholder("이름으로 전체 학생 검색").fill("검증학생");
    await page.getByRole("button", { name: /검증학생.*3-2/ }).click();
    assert.equal(await page.getByLabel("검증학생 배정 사유", { exact: true }).count(), 0, "A student is not added without a reason");
    await page.getByText("배정 사유를 선택해 주세요.", { exact: true }).waitFor();
    const reasonSelect = page.getByLabel("추가할 학생 배정 사유", { exact: true });
    assert.deepEqual(await reasonSelect.locator("option").allTextContents(), [
      "사유 선택",
      "1인 1역 및 청소 안함",
      "지각",
      "수업 태도",
      "교사 지시 불이행",
      "기타",
    ]);
    await reasonSelect.selectOption("__other__");
    await page.getByRole("button", { name: /검증학생.*3-2/ }).click();
    assert.equal(
      await page.evaluate(() => window.__fixture.writes.length),
      0,
      "Explicit other requires a reason",
    );
    assert(
      await page
        .getByText("기타 사유를 입력해 주세요.", { exact: true })
        .isVisible(),
    );
    await page.screenshot({
      path: path.join(
        evidence,
        `teacher-create-other-required-${viewport.width}.png`,
      ),
      fullPage: true,
    });
    await page
      .getByLabel("추가할 학생 기타 사유", { exact: true })
      .fill("교사가 작성한 세부 사유");
    await reasonSelect.selectOption("지각");
    assert.equal(
      await page.getByLabel("추가할 학생 기타 사유", { exact: true }).count(),
      0,
      "Standard reasons do not show a free text field",
    );
    await page.getByRole("button", { name: /검증학생.*3-2/ }).click();
    const assignedReason = page.getByLabel("검증학생 배정 사유", { exact: true });
    assert.equal(await assignedReason.inputValue(), "지각");
    await assignedReason.fill("같은 행에서 직접 수정한 사유");
    assert.equal(await assignedReason.inputValue(), "같은 행에서 직접 수정한 사유");
    await assignedReason.fill("지각");
    await page
      .getByRole("button", { name: "역사교실 저장", exact: true })
      .click();
    const created = await waitWrite(page, 1);
    assert(created.path.startsWith(`${scope}/history_classrooms/`));
    assert.equal(created.data.sourceType, "lesson");
    assert.equal(created.data.lessonUnitId, "a");
    assert.deepEqual(created.data.lessonUnitPath, [
      "II. 고대 사회",
      "국가의 형성",
      longTitle,
    ]);
    assert.deepEqual(
      created.data.blanks,
      expectedBlanks,
      "saved blanks keep ids, answer, prompt, source, page and exact geometry",
    );
    assert.deepEqual(created.data.pdfPageImages, pageImages);
    assert.equal(created.data.mapResourceId, "");
    assert.deepEqual(created.data.targetStudentUids, ["student-1"]);
    assert.equal(created.data.targetStudentReasons["student-1"], "지각");
    assert.deepEqual(
      [
        created.data.timeLimitMinutes,
        created.data.cooldownMinutes,
        created.data.passThresholdPercent,
        created.data.targetGrade,
        created.data.targetClass,
      ],
      [10, 5, 90, "3", "2"],
    );
    await page
      .getByRole("button", { name: "+ 새 역사교실", exact: true })
      .click();
    await assertNewDefaults(page);
    await page.locator('input[type="number"]').first().fill("17");
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page
      .getByRole("button", { name: "+ 새 역사교실", exact: true })
      .click();
    await assertNewDefaults(page);
    await page.getByRole("button", { name: "닫기", exact: true }).click();

    // Reload the actual teacher component after the source lesson changes.
    // Existing assignments must keep their published snapshot on a settings save.
    await page.evaluate(
      ({ scope }) => {
        window.__fixture.store[`${scope}/lessons/a`].worksheetBlanks[0].answer =
          "원본에서 수정된 정답";
        window.__fixture.store[
          `${scope}/lessons/a`
        ].worksheetPageImages[0].imageUrl = "/worksheet.svg?revision=2";
        const assignment = Object.entries(window.__fixture.store).find(
          ([key]) => key.startsWith(`${scope}/history_classrooms/`),
        )[1];
        assignment.timeLimitMinutes = 17;
        assignment.cooldownMinutes = 8;
        assignment.passThresholdPercent = 75;
        window.__remount();
      },
      { scope },
    );
    await page
      .getByRole("button", { name: `${longTitle} 설정 수정`, exact: true })
      .click();
    assert.equal(await page.locator("#history-edit-source-type").count(), 0);
    assert.equal(await page.locator("#history-edit-source").inputValue(), "a");
    await page.locator("#history-edit-source").scrollIntoViewIfNeeded();
    const editGeometry = await measure(page, "#history-edit-source");
    await page.screenshot({
      path: path.join(evidence, `teacher-edit-${viewport.width}.png`),
      fullPage: true,
    });
    assert(
      !editGeometry.overflow &&
        editGeometry.right <= viewport.width &&
        editGeometry.left >= 0,
      `edit selector fits: ${JSON.stringify(editGeometry)}`,
    );
    assert.deepEqual(
      await page
        .locator('input[type="number"]')
        .evaluateAll((inputs) => inputs.map((input) => input.value)),
      ["17", "8", "", "75"],
      "Editing keeps existing policy instead of new assignment defaults",
    );
    assert.equal(
      await page.getByLabel("검증학생 배정 사유", { exact: true }).inputValue(),
      "지각",
    );
    await page
      .getByLabel("검증학생 배정 사유", { exact: true })
      .fill("");
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.__fixture.writes.length),
      1,
      "An edited reason cannot be cleared",
    );
    await page.screenshot({
      path: path.join(
        evidence,
        `teacher-edit-other-required-${viewport.width}.png`,
      ),
      fullPage: true,
    });
    await page
      .getByLabel("검증학생 배정 사유", { exact: true })
      .fill("기존 자유 입력 사유를 유지합니다");
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    const preserved = await waitWrite(page, 2);
    assert.deepEqual(
      [
        preserved.data.timeLimitMinutes,
        preserved.data.cooldownMinutes,
        preserved.data.passThresholdPercent,
      ],
      [17, 8, 75],
    );
    assert.equal(
      preserved.data.targetStudentReasons["student-1"],
      "기존 자유 입력 사유를 유지합니다",
    );
    assert.deepEqual(
      snapshotFields(preserved.data),
      snapshotFields(created.data),
      "unchanged source preserves the original assignment snapshot",
    );

    // A pre-existing map assignment keeps its own pages and blanks even when
    // its old live map changes. OCR regions were optional in production.
    await page.evaluate(
      ({ assignmentPath, map, scope }) => {
        Object.assign(window.__fixture.store[assignmentPath], {
          sourceType: "map",
          title: map.title,
          mapTitle: map.title,
          mapResourceId: "map-1",
          lessonUnitId: "",
          lessonTitle: "",
          lessonUnitPath: [],
          pdfPageImages: map.pdfPageImages,
          pdfRegions: [],
          blanks: map.pdfBlanks,
          answerOptions: map.pdfBlanks.map((blank) => blank.answer),
          targetStudentReasons: {},
        });
        window.__fixture.store[`${scope}/map_resources/map-1`].pdfBlanks = [];
        window.__remount();
      },
      { assignmentPath: created.path, map, scope },
    );
    await page
      .getByRole("button", { name: "한반도 지도 설정 수정", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("검증학생 배정 사유", { exact: true }).inputValue(),
      "",
      "An untouched legacy assignment may have no saved reason",
    );
    assert.equal(await page.locator("#history-edit-source-type").count(), 0);
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    const mapped = await waitWrite(page, 3);
    assert.equal(
      mapped.data.targetStudentReasons["student-1"] || "",
      "",
      "Untouched legacy reasons remain allowed for compatibility",
    );
    assert.equal(mapped.data.sourceType, "map");
    assert.equal(mapped.data.mapResourceId, "map-1");
    assert.equal(mapped.data.lessonUnitId, "");
    assert.deepEqual(mapped.data.lessonUnitPath, []);
    assert.deepEqual(mapped.data.blanks, map.pdfBlanks);
    assert.deepEqual(mapped.data.pdfPageImages, map.pdfPageImages);
    assert.deepEqual(mapped.data.pdfRegions, []);

    await page
      .getByRole("button", { name: "한반도 지도 설정 수정", exact: true })
      .click();
    await page.locator("#history-edit-source").selectOption("chapter");
    assert.equal(await page.locator("#history-edit-source").inputValue(), "b");
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    const changed = await waitWrite(page, 4);
    assert.equal(changed.data.sourceType, "lesson");
    assert.equal(changed.data.lessonUnitId, "b");
    assert.equal(changed.data.mapResourceId, "");
    assert.equal(changed.data.blanks[0].answer, "백제");
    assert.deepEqual(changed.data.lessonUnitPath, [
      "II. 고대 사회",
      "국가의 형성",
      "2. 삼국",
    ]);

    await page.evaluate(
      ({ scope }) => {
        delete window.__fixture.store[`${scope}/lessons/b`];
        window.__remount();
      },
      { scope },
    );
    await page
      .getByRole("button", {
        name: `${changed.data.title} 설정 수정`,
        exact: true,
      })
      .click();
    assert.equal(
      await page.locator("#history-edit-source").inputValue(),
      "",
      "missing source shows a placeholder without replacing the saved snapshot",
    );
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    const missingSource = await waitWrite(page, 5);
    assert.deepEqual(
      snapshotFields(missingSource.data),
      snapshotFields(changed.data),
      "removed lesson source does not erase the published snapshot",
    );
    // One row per student, complete submission history, and live reset with no result.
    await page.evaluate(
      ({ scope, assignmentPath }) => {
        const f = window.__fixture;
        const assignment = f.store[assignmentPath];
        assignment.targetStudentUids = ["student-1", "student-2", "student-3"];
        assignment.targetStudentAccessMap = {
          "student-1": true,
          "student-2": true,
          "student-3": true,
        };
        for (const [id, name, number] of [
          ["student-2", "종료학생", "4"],
          ["student-3", "통과학생", "5"],
          ["student-4", "추가학생", "6"],
        ]) {
          f.store["users/" + id] = {
            role: "student",
            name,
            grade: "3",
            class: "2",
            number,
          };
        }
        for (const [id, uid, status, percent, seconds] of [
          ["cancelled", "student-2", "cancelled", 0, 200],
          ["failed", "student-2", "failed", 50, 100],
          ["passed-later-failed", "student-3", "failed", 50, 300],
          ["passed", "student-3", "passed", 100, 100],
        ]) {
          f.store[`${scope}/history_classroom_results/${id}`] = {
            assignmentId: assignmentPath.split("/").at(-1),
            uid,
            status,
            passed: status === "passed",
            percent,
            score: percent / 50,
            total: 2,
            studentName: uid === "student-2" ? "종료학생" : "통과학생",
            createdAt: { seconds, nanoseconds: 0 },
            answers: { "saved-b": "백제" },
            answerChecks: [],
          };
        }
        window.__remount();
      },
      { scope, assignmentPath: created.path },
    );
    await page
      .getByRole("button", {
        name: `${changed.data.title} 설정 수정`,
        exact: true,
      })
      .click();
    const panel = page.getByRole("region", { name: "응시 현황 및 제출 내역" });
    assert.equal(await panel.locator("tr[aria-label]").count(), 3);
    const pending = panel.getByRole("row", {
      name: "검증학생 응시 현황",
      exact: true,
    });
    const cancelled = panel.getByRole("row", {
      name: "종료학생 응시 현황",
      exact: true,
    });
    const passed = panel.getByRole("row", {
      name: "통과학생 응시 현황",
      exact: true,
    });
    assert.equal(
      await passed.getByRole("button", { name: /재응시 제한 리셋$/ }).count(),
      0,
      "any passed result remains completed",
    );
    assert.deepEqual(await panel.getByRole("columnheader").allTextContents(), [
      "학년",
      "반",
      "번호",
      "이름",
      "점수",
      "상태",
      "리셋",
    ]);
    for (const row of [pending, cancelled, passed]) {
      const geometry = await row.boundingBox();
      assert(
        geometry.height >= 44 && geometry.height <= 52,
        `compact one-line student row: ${JSON.stringify(geometry)}`,
      );
    }
    for (const row of [pending, cancelled]) {
      const reset = row.getByRole("button", { name: /재응시 제한 리셋$/ });
      const geometry = await reset.evaluate((el) => {
        const hit = el.getBoundingClientRect();
        const visual = el.querySelector("span").getBoundingClientRect();
        return { hitHeight: hit.height, visualHeight: visual.height };
      });
      assert(
        geometry.hitHeight >= 44,
        "compact reset retains a 44px touch area",
      );
      assert(
        Math.abs(geometry.visualHeight - 28) < 1,
        `reset visual height is 28px: ${JSON.stringify(geometry)}`,
      );
    }
    await cancelled.click();
    assert.equal(await cancelled.getAttribute("aria-expanded"), "true");
    await cancelled.focus();
    await cancelled.press("Enter");
    assert.equal(await cancelled.getAttribute("aria-expanded"), "false");
    await cancelled.press("Space");
    assert.equal(await cancelled.getAttribute("aria-expanded"), "true");
    const cancelledHistory = page.locator(
      `#${await cancelled.getAttribute("aria-controls")}`,
    );
    assert.equal(
      await cancelledHistory.getByRole("listitem").count(),
      2,
      "all prior submissions remain accessible",
    );
    assert.equal(
      await cancelledHistory
        .getByRole("button", { name: "종료학생 제출 자료 확인" })
        .count(),
      2,
    );
    await cancelledHistory
      .getByRole("button", { name: "종료학생 제출 자료 확인" })
      .first()
      .click();
    const reviewImage = page.getByRole("img", {
      name: `${changed.data.title} 1`,
      exact: true,
    });
    await reviewImage.waitFor();
    const reviewWidths = [];
    for (let sample = 0; sample < 5; sample++) {
      await page.waitForTimeout(300);
      reviewWidths.push((await reviewImage.boundingBox()).width);
    }
    assert(
      reviewWidths.at(-1) > 150,
      `teacher result page must remain readable: ${reviewWidths}`,
    );
    assert(
      Math.abs(reviewWidths[0] - reviewWidths.at(-1)) < 2,
      `teacher result fit must not shrink repeatedly: ${reviewWidths}`,
    );
    await page.getByRole("button", { name: "자료 확대", exact: true }).click();
    await page.waitForTimeout(350);
    assert(
      (await reviewImage.boundingBox()).width > reviewWidths.at(-1),
      "result review zoom enlarges source",
    );
    await page.getByRole("button", { name: "다음", exact: true }).click();
    await page
      .getByRole("img", { name: `${changed.data.title} 3`, exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "응시 주의사항", exact: true })
        .count(),
      0,
      "read-only review does not show student test instructions",
    );
    assert.equal(
      await page.getByText("안내", { exact: true }).count(),
      0,
      "no redundant bottom guidance card",
    );
    await page.screenshot({
      path: path.join(evidence, `teacher-result-review-${viewport.width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "닫기", exact: true })
      .last()
      .click();
    await page.locator('input[type="number"]').first().fill("22");
    await page
      .getByLabel("검증학생 배정 사유", { exact: true })
      .fill("수업 태도");
    await page.evaluate(() => (window.__fixture.pauseWrite = true));
    const resetButton = pending.getByRole("button", {
      name: "검증학생 재응시 제한 리셋",
      exact: true,
    });
    await resetButton.evaluate((button) => {
      button.click();
      button.click();
    });
    const reset = await waitWrite(page, 6);
    assert.deepEqual(Object.keys(reset.data).sort(), [
      "retryResetByStudentUid",
      "updatedAt",
    ]);
    assert.deepEqual(Object.keys(reset.data.retryResetByStudentUid), [
      "student-1",
    ]);
    assert(
      await page
        .getByRole("button", { name: "설정 저장", exact: true })
        .isDisabled(),
      "settings save waits for reset",
    );
    await page.evaluate(() => window.__fixture.releaseWrite());
    await pending.getByRole("status").waitFor();
    assert.equal(
      await pending.getByRole("status").textContent(),
      "재응시 대기 해제됨",
    );
    assert.equal(
      await page.locator('input[type="number"]').first().inputValue(),
      "22",
    );
    assert.equal(
      await page.getByLabel("검증학생 배정 사유", { exact: true }).inputValue(),
      "수업 태도",
    );
    assert.equal(
      await page.evaluate(() => window.__fixture.writes.length),
      6,
      "double click writes once",
    );
    await page.evaluate(() => (window.__fixture.failNextWrite = true));
    await cancelled.getByRole("button", { name: /재응시 제한 리셋$/ }).click();
    await waitWrite(page, 7);
    await cancelled
      .getByText("해제하지 못했습니다. 다시 시도해 주세요.", { exact: true })
      .waitFor();
    await cancelled.getByRole("button", { name: /재응시 제한 리셋$/ }).click();
    await waitWrite(page, 8);
    await cancelled.getByText("재응시 대기 해제됨", { exact: true }).waitFor();
    assert.equal(
      await cancelled.getAttribute("aria-expanded"),
      "true",
      "reset click does not toggle submission history",
    );
    assert.equal(
      await cancelled
        .getByRole("button", { name: /재응시 제한 리셋$/ })
        .textContent(),
      "리셋",
    );
    await pending.scrollIntoViewIfNeeded();
    const statusGeometry = await panel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        viewport: innerWidth,
        overflow: el.scrollWidth > el.clientWidth + 1,
      };
    });
    assert(
      statusGeometry.left >= 0 &&
        statusGeometry.right <= viewport.width &&
        !statusGeometry.overflow,
      JSON.stringify(statusGeometry),
    );
    for (const button of await panel.getByRole("button").all()) {
      if (await button.isVisible())
        assert(
          (await button.boundingBox()).height >= 44,
          "tablet touch controls remain at least 44px",
        );
    }
    await panel.locator("table").evaluate((table) => {
      table.parentElement.scrollLeft = 0;
    });
    await page.screenshot({
      path: path.join(evidence, `teacher-attempts-${viewport.width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    const savedAfterReset = await waitWrite(page, 9);
    assert(
      !savedAfterReset.options.mergeFields.includes("retryResetByStudentUid"),
    );
    const savedResetMarkers = await page.evaluate(
      (path) => window.__fixture.store[path].retryResetByStudentUid,
      created.path,
    );
    assert.deepEqual(
      savedResetMarkers,
      {
        "student-1": { seconds: 1790676000, nanoseconds: 0 },
        "student-2": { seconds: 1790676000, nanoseconds: 0 },
      },
      "settings save preserves both server timestamps",
    );
    assert.equal(savedAfterReset.data.timeLimitMinutes, 22);
    assert.equal(
      savedAfterReset.data.targetStudentReasons["student-1"],
      "수업 태도",
    );
    // Legacy fallback must update the original document without creating a scoped stub.
    const legacyPath = "history_classrooms/" + created.path.split("/").at(-1);
    await page.evaluate(
      ({ from, to }) => {
        window.__fixture.store[to] = window.__fixture.store[from];
        delete window.__fixture.store[from];
        window.__remount();
      },
      { from: created.path, to: legacyPath },
    );
    await page
      .getByRole("button", {
        name: `${changed.data.title} 설정 수정`,
        exact: true,
      })
      .click();
    await page
      .getByRole("row", { name: "검증학생 응시 현황", exact: true })
      .getByRole("button", { name: /재응시 제한 리셋$/ })
      .click();
    const legacyReset = await waitWrite(page, 10);
    assert.equal(legacyReset.path, legacyPath);
    assert.equal(
      await page.evaluate(
        (path) => Boolean(window.__fixture.store[path]),
        created.path,
      ),
      false,
    );
    await page
      .getByRole("button", { name: "배정 학생 추가", exact: true })
      .click();
    await page.getByLabel("추가할 학생 배정 사유", { exact: true }).selectOption("수업 태도");
    await page.getByPlaceholder("학년 반 번호 또는 이름 검색").fill("추가학생");
    await page.getByRole("button", { name: /추가학생.*3-2/ }).click();
    const unsavedReset = page
      .getByRole("row", { name: "추가학생 응시 현황", exact: true })
      .getByRole("button", { name: /재응시 제한 리셋$/ });
    assert(
      await unsavedReset.isDisabled(),
      "unsaved assignment cannot issue a live reset",
    );
    assert.equal(
      await unsavedReset.getAttribute("title"),
      "학생 배정을 먼저 저장해 주세요.",
    );
    assert.equal(await page.evaluate(() => window.__fixture.writes.length), 10);
    await page.getByRole("button", { name: "취소", exact: true }).click();
    // A lesson edited since publication is imported only by the explicit action.
    await page.evaluate(
      ({ legacyPath, original, scope }) => {
        const f = window.__fixture;
        delete f.store[legacyPath];
        f.store[`${scope}/history_classrooms/refresh-fixture`] = original;
        f.store["users/inactive-student"] = {
          role: "student",
          name: "전출학생",
          grade: "3",
          class: "2",
          number: "20",
          enrollmentStatus: "transferred",
        };
        f.store["users/pending-student"] = {
          role: "student",
          name: "승인대기학생",
          grade: "3",
          class: "2",
          number: "21",
          registrationApprovalStatus: "pending",
        };
        window.__remount();
      },
      { legacyPath, original: created.data, scope },
    );
    await page
      .getByRole("button", { name: `${longTitle} 설정 수정`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "최신 수업 자료 반영", exact: true })
      .click();
    await page.getByText(/최신 학습지와 빈칸 2개를 반영합니다/).waitFor();
    assert.equal(
      await page.evaluate(() => window.__fixture.writes.length),
      10,
      "Refresh changes the draft only",
    );
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    const refreshed = await waitWrite(page, 11);
    assert.equal(refreshed.data.blanks[0].answer, "원본에서 수정된 정답");
    assert.equal(
      refreshed.data.pdfPageImages[0].imageUrl,
      "/worksheet.svg?revision=2",
    );
    assert.equal(refreshed.data.blanks[0].id, created.data.blanks[0].id);
    assert.equal(refreshed.data.blanks[0].left, created.data.blanks[0].left);
    assert.equal(refreshed.data.blanks[0].top, created.data.blanks[0].top);

    await page.evaluate(() => {
      for (let index = 1; index <= 30; index++) {
        const suffix = String(index).padStart(2, "0");
        window.__fixture.store[`users/class-grant-${suffix}`] = {
          role: "student",
          name: `학급검증${suffix}`,
          grade: "3",
          class: "2",
          number: String(40 + index),
        };
      }
      window.__remount();
    });
    await page
      .getByRole("button", { name: "면제권 관리", exact: true })
      .click();
    await page
      .getByRole("button", { name: "학급 단위 부여", exact: true })
      .click();
    const exemptionModal = page.locator("div.fixed.inset-0").last();
    await exemptionModal.locator("select").nth(0).selectOption("3");
    await exemptionModal.locator("select").nth(1).selectOption("2");
    await page
      .getByRole("button", { name: "추가학생 제외", exact: true })
      .click();
    await page
      .getByRole("button", { name: "학급검증30 제외", exact: true })
      .click();
    await exemptionModal.getByText("부여 대상 32명 · 제외 2명", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "전출학생 제외", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "승인대기학생 제외", exact: true })
        .count(),
      0,
    );
    await exemptionModal
      .getByPlaceholder("예: 학교 행사, 공결, 상담 등")
      .fill("학급 활동 참여");
    await page.evaluate(() => {
      window.__fixture.pauseGrant = true;
      window.__fixture.failNextGrant = true;
    });
    const grantButton = exemptionModal
      .getByRole("button", { name: "면제권 부여", exact: true })
      .last();
    // Dispatch both events in one turn, before React's disabled state commits.
    await grantButton.evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForFunction(() =>
      window.__fixture.commands.some(
        (command) => command.commandType === "grantHistoryClassroomExemptions",
      ),
    );
    assert.equal(
      await page.evaluate(() => window.__fixture.commands.filter(command => command.commandType === "grantHistoryClassroomExemptions").length),
      1,
      "Repeated clicks issue one class grant while the first request is pending",
    );
    assert(await exemptionModal.getByRole("button", { name: "부여 중", exact: true }).isDisabled());
    await page.evaluate(() => window.__fixture.releaseGrant());
    await grantButton.waitFor();
    assert.equal(await exemptionModal.getByPlaceholder("예: 학교 행사, 공결, 상담 등").inputValue(), "학급 활동 참여");
    await exemptionModal.getByText("부여 대상 32명 · 제외 2명", { exact: true }).waitFor();
    assert(alerts.includes("서버 처리 결과를 확인하지 못했습니다. 잠시 후 같은 내용으로 다시 시도해 주세요."));
    const failedGrant = await page.evaluate(() => window.__fixture.commands.at(-1));
    await grantButton.click();
    await page.waitForFunction(() => window.__fixture.commands.filter(command => command.commandType === "grantHistoryClassroomExemptions").length === 2);
    const granted = await page.evaluate(() => window.__fixture.commands.at(-1));
    assert.deepEqual(granted, failedGrant, "Explicit retry preserves the 32 recipients, exclusions, semester and reason");
    assert.equal(granted.payload.semesterId, "2026-2");
    assert.equal(granted.payload.classId, "3-2");
    assert.deepEqual(granted.payload.recipientUids, [
      ...Array.from({ length: 29 }, (_, index) => `class-grant-${String(index + 1).padStart(2, "0")}`),
      "student-1", "student-2", "student-3",
    ].sort());
    await page.waitForFunction(() => document.querySelector('textarea[placeholder="예: 학교 행사, 공결, 상담 등"]')?.value === "");
    await page.screenshot({
      path: path.join(evidence, `teacher-exemption-${viewport.width}.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, [], "no runtime errors");
    assert(
      alerts.every(
        (message) =>
          message === "역사교실 과제를 저장했습니다." ||
          message === "32명에게 면제권을 부여했습니다." ||
          message === "서버 처리 결과를 확인하지 못했습니다. 잠시 후 같은 내용으로 다시 시도해 주세요.",
      ),
      `unexpected alert: ${alerts.join(", ")}`,
    );
    const capture = await page.evaluate(() => ({
      writes: window.__fixture.writes,
      reads: window.__fixture.reads,
      notifications: window.__fixture.notifications,
    }));
    assert(
      capture.reads.every((read) => !read.includes("map_resources")),
      "History classroom never reads a live map resource",
    );
    reports.push({
      viewport,
      options,
      geometry,
      editGeometry,
      statusGeometry,
      reviewWidths,
      errors,
      alerts,
      ...capture,
    });
    await page.close();
    console.log(
      `teacher ${viewport.width}px create/edit/source-switch/snapshot/attempt-history/reset: passed`,
    );
  }
} finally {
  await fs.writeFile(
    path.join(evidence, "teacher-browser-report.json"),
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        coverage:
          "actual ManageHistoryClassroom and source builder; in-memory backend; Edge touch emulation, no production data",
        reports,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(`Evidence: ${evidence}`);
