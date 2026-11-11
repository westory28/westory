import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  out =
    process.env.DASHBOARD_LOADING_EVIDENCE ||
    path.join(root, ".superloopy/sessions/dashboard-loading/evidence");
await fs.mkdir(out, { recursive: true });
const require = createRequire(import.meta.url);
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const mocks = {
  state: `export const config={year:'2026',semester:'2'},currentUser={uid:'synthetic-teacher'},userData={grade:'3',class:'1'};export const qa=window.jitterQA={subscriptions:[],callbacks:{},phase:'pending',reads:0};const noticeCount=Number(new URLSearchParams(location.search).get('notices')??5);export const notices=Array.from({length:noticeCount},(_,i)=>({id:'notice-'+i,category:'notice',content:'합성 알림',imageUrl:'/notice.svg',imageWidth:1600,imageHeight:900,developerLogPostId:new URLSearchParams(location.search).get('linked')==='1'?'synthetic-post':'',createdAt:null}));const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});export const events=Array.from({length:noticeCount===0?0:18},(_,i)=>({id:'event-'+i,title:'합성 학사 일정 '+(i+1),start:date,eventType:'event',targetType:'common',startPeriod:'allDay'}));export const release=kind=>{qa.phase=kind+'-complete';(qa.callbacks[kind]||[]).forEach(fn=>fn());};window.jitterRelease=release;`,
  auth: `import {config,currentUser,userData} from 'fixture:state';export const useAuth=()=>({config,currentUser,userData,configReady:true,loading:false});`,
  firebase: `export const db={};`,
  firestore: `import {qa,notices,events} from 'fixture:state';export const collection=(_db,path)=>({path});export const doc=(_db,...parts)=>({path:parts.join('/')});export const query=(ref)=>ref;export const limit=()=>({});export const orderBy=()=>({});export const getDoc=async()=>{qa.reads++;return{exists:()=>false,data:()=>({})};};export const onSnapshot=(ref,next)=>{const kind=ref.path.endsWith('/calendar')?'calendar':ref.path.endsWith('/notices')?'notices':'config';qa.subscriptions.push({kind,path:ref.path});const emit=()=>{const data=kind==='calendar'?events:notices;const docs=data.map(d=>({id:d.id,data:()=>d}));next({docs,forEach:fn=>docs.forEach(fn),exists:()=>false});};if(kind==='config')next({exists:()=>false,data:()=>({})});else (qa.callbacks[kind]??=[]).push(emit);return()=>{};};`,
  semester: `export const getYearSemester=config=>config;`,
  archive: `export const isSemesterArchive=false,archiveScope=null;`,
  holiday: `export const getKoreanPublicHolidays=async()=>[];export const mergeEventsWithKoreanPublicHolidays=events=>events;export const ensureKoreanPublicHolidaysSynced=async()=>{};`,
  idle: `export const runWhenIdle=()=>()=>{};`,
  visible: `import {qa,notices} from 'fixture:state';export const getStudentClassKey=()=> '3-1';export const loadVisibleCalendarEvents=async()=>[];export const subscribeVisibleNotices=(_db,path,_class,next)=>{qa.subscriptions.push({kind:'notices',path});(qa.callbacks.notices??=[]).push(()=>next(notices));return()=>{};};`,
  modal: `export default function Modal(){return null;}`,
  ranking: `import React from 'react';export default function Ranking(){return <div className="wis-ranking-panel"><h3>위스 순위</h3>{Array.from({length:5},(_,i)=><div key={i} style={{height:52,marginTop:8}}>{i+1}위 합성 학생</div>)}</div>}`,
  images: `export const NOTICE_IMAGE_RECOMMENDED_WIDTH=1600;`,
};
const entry = `import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{LoadingProvider}from'./src/components/common/LoadingState';import TeacherDashboard from './src/pages/teacher/Dashboard';import StudentWeekSchedule from './src/pages/student/components/StudentWeekSchedule';import NoticeBoard from './src/pages/student/components/NoticeBoard';import Ranking from 'fixture:ranking';import{qa,events}from'fixture:state';import{getKoreanDateKey,getWeekStart}from'./src/pages/teacher/components/teacherDashboardWeek';import './src/assets/index.css';import './src/pages/teacher/teacherDashboard.css';import './src/pages/student/studentDashboard.css';
function Student(){const[loading,setLoading]=useState(true);useEffect(()=>{(qa.callbacks.calendar??=[]).push(()=>setLoading(false));},[]);const date=getKoreanDateKey();return <main className="student-portal-dashboard"><div className="student-portal-dashboard__grid"><div className="student-portal-dashboard__calendar"><StudentWeekSchedule events={loading?[]:events} categories={[{key:'event',label:'행사',color:'#10b981',emoji:'',order:1}]} weekStart={getWeekStart(date)} selectedDate={date} loading={loading} error={false} onWeekChange={()=>{}} onDateClick={()=>{}} onSearchSelect={()=>{}} onEventClick={()=>{}} attendanceLoading={false} attendanceChecked={true} attendanceMessage="" attendanceDates={[]} attendanceGoalText="" onAttendanceCheck={()=>{}}/></div><div className="student-portal-dashboard__notice"><NoticeBoard/></div><div className="student-portal-dashboard__ranking"><Ranking/></div></div></main>};const role=new URLSearchParams(location.search).get('role');const contentWidth=Number(new URLSearchParams(location.search).get('contentWidth'));if(contentWidth)document.getElementById('root').style.width=contentWidth+'px';createRoot(document.getElementById('root')).render(<LoadingProvider><MemoryRouter>{role==='student'?<Student/>:<main className="teacher-layout"><TeacherDashboard/></main>}</MemoryRouter></LoadingProvider>);`;
const plugin = {
  name: "jitter-mocks",
  setup(p) {
    p.onResolve({ filter: /^fixture:/ }, (a) => ({
      path: a.path.slice(8),
      namespace: "mock",
    }));
    p.onResolve(
      {
        filter:
          /firebase\/firestore$|(?:^|\/)(firebase|AuthContext|semesterScope|semesterArchive|koreanPublicHolidays|browserTasks|visibleSchedule|noticeImages|WisRankingPanel|NoticeManagerModal|EventModal|ScheduleEventDetailModal)$/,
      },
      (a) => {
        const name = a.path.split("/").at(-1);
        const key =
          a.path === "firebase/firestore"
            ? "firestore"
            : {
                firebase: "firebase",
                AuthContext: "auth",
                semesterScope: "semester",
                semesterArchive: "archive",
                koreanPublicHolidays: "holiday",
                browserTasks: "idle",
                visibleSchedule: "visible",
                noticeImages: "images",
                WisRankingPanel: "ranking",
              }[name] || "modal";
        return { path: key, namespace: "mock" };
      },
    );
    p.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
      contents: mocks[a.path],
      loader: "tsx",
      resolveDir: root,
    }));
  },
};
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  loader: {
    ".webp": "dataurl",
    ".svg": "dataurl",
    ".woff": "dataurl",
    ".woff2": "dataurl",
  },
  outfile: path.join(out, "fixture.js"),
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [plugin],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text,
  css = bundle.outputFiles
    .find((f) => f.path.endsWith(".css"))
    // Font URLs contain semicolons; remove through the closing URL quote.
    .text.replace(
      /@import\s+(?:url\(\s*)?["']https?:[^"']+["']\s*\)?[^;]*;/g,
      "",
    );
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#f9fafb}.fixture{padding-top:16px}@media(min-width:1024px){.fixture{margin-left:232px}}</style><div class="fixture" id="root"></div><div role="toolbar" aria-label="합성 로딩 검증" style="position:fixed;right:8px;bottom:8px;z-index:30000;display:flex;gap:8px;background:#dbeafe;padding:8px;border:1px solid #93c5fd"><button type="button" onclick="window.jitterRelease(&quot;notices&quot;)">알림장 완료</button><button type="button" onclick="window.jitterRelease(&quot;calendar&quot;)">일정 완료</button></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer((req, res) => {
  const key = new URL(req.url, "http://localhost").pathname;
  const [type, data] =
    key === "/fixture.js"
      ? ["text/javascript", js]
      : key === "/fixture.css"
        ? ["text/css", css]
        : key === "/tailwind.js"
          ? ["text/javascript", tailwind]
          : key === "/notice.svg"
            ? [
                "image/svg+xml",
                '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#dbeafe"/><text x="120" y="450" font-size="100">Synthetic Notice</text></svg>',
              ]
            : ["text/html", html];
  res.setHeader("Content-Type", type);
  res.end(data);
});
await new Promise((r) =>
  server.listen(
    Number(process.env.DASHBOARD_LOADING_PORT || 0),
    "127.0.0.1",
    r,
  ),
);
const origin = "http://127.0.0.1:" + server.address().port;
if (process.argv.includes("--serve")) {
  console.log(`Dashboard loading fixture: ${origin}/?role=teacher&notices=5`);
  console.log(
    "Student: ?role=student&notices=5; notices=1 or notices=0. Bottom controls release only synthetic data.",
  );
  await new Promise(() => {});
}

// Actual teacher Dashboard and both portals' schedule/notice components are used.
// The student shell mirrors its dashboard grid; ranking is a stable synthetic
// neighbour. Every data boundary is local. No production credentials are used.
const engines = (process.env.DASHBOARD_LOADING_ENGINES || "msedge").split(",");
const results = [];
const sourceHashes = {};
for (const file of [
  "src/components/common/LoadingLogo.tsx",
  "src/components/common/LoadingState.tsx",
  "src/components/common/loadingState.css",
  "src/pages/teacher/Dashboard.tsx",
  "src/pages/teacher/components/TeacherNoticeBoard.tsx",
  "src/pages/teacher/components/TeacherWeekSchedule.tsx",
  "src/pages/student/components/NoticeBoard.tsx",
  "src/pages/student/components/StudentWeekSchedule.tsx",
  "src/pages/teacher/teacherDashboard.css",
  "src/pages/student/studentDashboard.css",
  "src/pages/student/components/studentWeekSchedule.css",
]) {
  sourceHashes[file] = createHash("sha256")
    .update(await fs.readFile(path.join(root, file)))
    .digest("hex");
}
await fs.writeFile(
  path.join(out, "source-hashes.json"),
  JSON.stringify(sourceHashes, null, 2),
);

async function startRecording(page, role) {
  await page.evaluate((role) => {
    const prefix =
      role === "teacher"
        ? "teacher-weekly-dashboard"
        : "student-portal-dashboard";
    const selectors = {
      grid: "." + prefix + "__grid",
      schedule:
        "." + prefix + "__" + (role === "teacher" ? "schedule" : "calendar"),
      notice: "." + prefix + "__notice",
      ranking: "." + prefix + "__ranking",
      scheduleHeader: "." + role + "-week-schedule__heading",
      scheduleToolbar: "." + role + "-week-schedule__toolbar",
      scheduleEvents: "." + role + "-week-events",
      noticeHeader: "." + role + "-notice-board__header",
      noticeControls: "." + role + "-notice-board__controls",
      noticeViewport: "." + role + "-notice-board__viewport",
    };
    const rect = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    window.dashboardFrames = [];
    window.dashboardRecording = true;
    const sample = () => {
      if (!window.dashboardRecording) return;
      const row = {
        at: performance.now(),
        phase: window.jitterQA.phase,
        scrollY,
        scrollHeight: document.documentElement.scrollHeight,
      };
      for (const [key, selector] of Object.entries(selectors))
        row[key] = rect(document.querySelector(selector));
      row.scheduleLogo = rect(
        document.querySelector(
          selectors.schedule +
            " .ws-loading__logo:not(.ws-loading__logo--exit)",
        ),
      );
      row.exits = [
        ...document.querySelectorAll(".ws-loading-exit-surface"),
      ].map((node) => ({
        box: rect(node),
        scope: node.dataset.loadingScope,
        body: node.parentElement === document.body,
      }));
      window.dashboardFrames.push(row);
      requestAnimationFrame(sample);
    };
    sample();
  }, role);
}
function span(values) {
  return Math.max(...values) - Math.min(...values);
}
function summarize(frames) {
  const summary = {};
  for (const phase of ["pending", "notices-complete", "calendar-complete"]) {
    const current = frames.filter((frame) => frame.phase === phase);
    assert.ok(current.length >= 8, phase + ": enough actual animation frames");
    const last = current.at(-1);
    summary[phase] = {
      frames: current.length,
      noticeHeight: last.notice.height,
      scheduleHeight: last.schedule.height,
      gridHeight: last.grid.height,
      scheduleLogoY: last.scheduleLogo?.y ?? null,
      scrollY: last.scrollY,
    };
  }
  return summary;
}
async function verifyCase(
  browser,
  engine,
  role,
  width,
  count,
  linked,
  contentWidth,
) {
  const id = `${engine}-${role}-${width}${contentWidth ? "-available" + contentWidth : ""}-${count}-${linked ? "linked" : "unlinked"}`,
    page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [],
    requests = [];
  page.setDefaultTimeout(6000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) =>
    requests.push({
      url: request.url(),
      type: request.resourceType(),
      method: request.method(),
    }),
  );
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  const result = {
    id,
    engine,
    role,
    width,
    contentWidth,
    notices: count,
    linked,
    passed: false,
  };
  try {
    await page.goto(
      `${origin}/?role=${role}&notices=${count}&linked=${linked ? 1 : 0}${contentWidth ? "&contentWidth=" + contentWidth : ""}`,
    );
    await page.locator(".ws-loading__logo").last().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const appearance = await page
      .locator(".ws-loading-surface")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          blur:
            getComputedStyle(node).backdropFilter ||
            getComputedStyle(node).webkitBackdropFilter,
          background: getComputedStyle(node).backgroundColor,
          letters: [...node.querySelectorAll("[data-loading-letter]")].map(
            (letter) => ({
              animation: getComputedStyle(letter).animationName,
              running: letter
                .getAnimations()
                .some((animation) => animation.playState === "running"),
            }),
          ),
        })),
      );
    assert.ok(
      appearance.length >= 2,
      "both actual loading surfaces are present",
    );
    for (const surface of appearance) {
      assert.equal(
        surface.blur,
        "blur(4px)",
        "actual loading stylesheet applies blur",
      );
      assert.equal(
        surface.background,
        "rgba(0, 0, 0, 0)",
        "local loading has a transparent background",
      );
      assert.equal(surface.letters.length, 7);
      assert.ok(
        surface.letters.every(
          (letter) =>
            letter.animation === "ws-loading-bounce" && letter.running,
        ),
        "all seven glyphs use active CSS animation",
      );
    }
    await page.waitForFunction(
      () =>
        window.jitterQA.callbacks.notices?.length &&
        window.jitterQA.callbacks.calendar?.length,
    );
    const before = await page.evaluate(() => ({
      subscriptions: window.jitterQA.subscriptions,
      reads: window.jitterQA.reads,
    }));
    assert.equal(
      before.subscriptions.filter((s) => s.kind === "notices").length,
      1,
      "one notice subscription",
    );
    if (role === "teacher")
      assert.equal(
        before.subscriptions.filter((s) => s.kind === "calendar").length,
        1,
        "one teacher calendar subscription",
      );
    await startRecording(page, role);
    await page.waitForTimeout(350);
    if (count === 5)
      await page.screenshot({
        path: path.join(out, `${id}-pending.png`),
        fullPage: true,
      });
    await page.evaluate(() => window.jitterRelease("notices"));
    await page.waitForTimeout(400);
    if (count === 5)
      await page.screenshot({
        path: path.join(out, `${id}-notice-complete.png`),
        fullPage: true,
      });
    await page.evaluate(() => window.jitterRelease("calendar"));
    await page.waitForTimeout(400);
    await page.waitForFunction(
      () =>
        !document.querySelector(".ws-loading-surface,.ws-loading-exit-surface"),
    );
    await page.screenshot({
      path: path.join(out, `${id}-complete.png`),
      fullPage: true,
    });
    const measured = await page.evaluate(() => {
      window.dashboardRecording = false;
      return {
        frames: window.dashboardFrames,
        subscriptions: window.jitterQA.subscriptions,
        reads: window.jitterQA.reads,
      };
    });
    await fs.writeFile(
      path.join(out, `${id}-frames.json`),
      JSON.stringify(measured, null, 2),
    );
    result.metrics = summarize(measured.frames);
    result.subscriptionCount = measured.subscriptions.length;
    result.backendRequests = requests.filter(
      (request) =>
        !request.url.startsWith(origin) ||
        ["fetch", "xhr", "websocket"].includes(request.type) ||
        request.method !== "GET",
    );
    assert.deepEqual(errors, [], "no runtime errors");
    assert.deepEqual(
      result.backendRequests,
      [],
      "no backend requests, writes or external media",
    );
    assert.deepEqual(
      measured.subscriptions,
      before.subscriptions,
      "completion does not resubscribe",
    );
    assert.equal(
      measured.reads,
      before.reads,
      "completion does not reread configuration",
    );
    const frames = measured.frames;
    for (const part of [
      "grid",
      "schedule",
      "notice",
      "ranking",
      "scheduleHeader",
      "scheduleToolbar",
      "scheduleEvents",
      "noticeHeader",
      "noticeControls",
      "noticeViewport",
    ])
      for (const axis of ["y", "height"]) {
        const values = frames
          .map((frame) => frame[part]?.[axis])
          .filter(Number.isFinite);
        assert.ok(
          span(values) <= 1,
          `${id}: ${part}.${axis} moves ${span(values)}px across loading completion`,
        );
      }
    const pending = frames.filter(
      (frame) => frame.phase !== "calendar-complete",
    );
    assert.ok(
      pending.every((frame) => frame.scheduleLogo?.height > 0),
      `${id}: schedule logo remains visible while pending`,
    );
    const logoY = pending.map((frame) => frame.scheduleLogo.y);
    result.scheduleLogoMovement = span(logoY);
    assert.ok(
      result.scheduleLogoMovement <= 1,
      `${id}: notice completion moves pending schedule logo ${result.scheduleLogoMovement}px`,
    );
    assert.ok(
      span(frames.map((frame) => frame.scrollY)) <= 1,
      `${id}: scroll anchoring stays stable`,
    );
    assert.ok(
      frames
        .flatMap((frame) => frame.exits)
        .every((exit) => exit.scope === "container" && !exit.body),
      `${id}: completion stays in local containers`,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `${id}: no horizontal overflow`,
    );
    const controlLayout = await page
      .locator(`.${role}-notice-board__controls`)
      .evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return [...node.querySelectorAll("button,a")]
          .filter(
            (control) => getComputedStyle(control).visibility !== "hidden",
          )
          .map((control) => {
            const box = control.getBoundingClientRect();
            return {
              name: control.getAttribute("aria-label") || control.textContent,
              inside:
                box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1,
            };
          });
      });
    assert.ok(
      controlLayout.every((control) => control.inside),
      `${id}: linked and pagination controls stay inside their reserved rows: ${JSON.stringify(controlLayout)}`,
    );
    result.passed = true;
  } catch (error) {
    result.error = error.stack || String(error);
    result.runtimeErrors = errors;
    await page
      .screenshot({ path: path.join(out, `${id}-failure.png`), fullPage: true })
      .catch(() => {});
    console.error(`FAIL ${id}: ${error.message}`);
  } finally {
    await page.close();
  }
  results.push(result);
  console.log(
    `${result.passed ? "PASS" : "FAIL"} ${id}${result.metrics ? " " + JSON.stringify(result.metrics) : ""}`,
  );
}
try {
  for (const engine of engines) {
    assert.ok(
      ["msedge", "chromium", "webkit"].includes(engine),
      "supported browser engine",
    );
    const browser = await playwright[
      engine === "msedge" ? "chromium" : engine
    ].launch({
      headless: true,
      ...(engine === "msedge" ? { channel: "msedge" } : {}),
    });
    try {
      for (const role of ["teacher", "student"])
        for (const width of [390, 768, 1280, 1440])
          for (const count of [5, 1, 0])
            for (const linked of count ? [false, true] : [false])
              await verifyCase(browser, engine, role, width, count, linked);
      for (const contentWidth of [800, 850, 900])
        for (const count of [5, 1, 0])
          for (const linked of count ? [false, true] : [false])
            await verifyCase(
              browser,
              engine,
              "teacher",
              1440,
              count,
              linked,
              contentWidth,
            );
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.writeFile(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        sourceHashes,
        results,
        limitations:
          "Synthetic data; stable ranking stub. Actual teacher Dashboard and both schedule/notice components, student dashboard grid shell. No physical mobile device verification.",
      },
      null,
      2,
    ),
  );
  console.log("Evidence: " + out);
}
assert.ok(
  results.length > 0 && results.every((result) => result.passed),
  "dashboard loading geometry regression",
);
