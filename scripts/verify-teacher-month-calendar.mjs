/** Real teacher FullCalendar; only Firebase reads use synthetic fixtures. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
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
const evidence =
  process.env.TEACHER_CALENDAR_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-teacher-calendar-")));
await fs.mkdir(evidence, { recursive: true });
const source = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const service = `
export const db={};
export const doc=(_db,...parts)=>({path:parts.join('/')});
export const getDoc=async()=>({exists:()=>false,data:()=>undefined});
export const onSnapshot=(_ref,callback)=>{queueMicrotask(()=>callback({exists:()=>false,data:()=>undefined}));return ()=>{};};
export const isSemesterArchive=false;
export const archiveScope=null;
`;
const harness = `
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Calendar from ${source("src/pages/teacher/components/TeacherCalendarSection.tsx")};
import ${source("src/assets/index.css")};
import ${source("src/components/common/portalPage.css")};
const event=(id,title,start,end,period='allDay')=>({id,title,start,end,startPeriod:period,eventType:'event',targetType:'common'});
const events=[
 event('range','고입 · 마이스터고 원서 접수','2026-10-19','2026-10-22','period7'),
 event('sports','3학년 스포츠','2026-10-20',undefined,'period6'),
 event('operation','3학년 5교시 운영','2026-10-21',undefined,'allDay'),
 event('fire','자체소방훈련','2026-10-21',undefined,'period4'),
 ...[1,2,3].map(i=>event('three'+i,'하루 세 일정 '+i,'2026-10-12',undefined,'period'+i)),
 ...[1,2,3,4].map(i=>event('four'+i,'하루 네 일정 '+i,'2026-10-23',undefined,'period'+i)),
 event('cross','월 경계 원서 접수','2026-10-30','2026-11-02'),
 event('cross-single','월 경계 단일 일정','2026-11-02',undefined,'period1'),
 event('holiday','한글날','2026-10-09',undefined),
].map(e=>e.id==='holiday'?{...e,eventType:'holiday'}:e).reverse();
window.calendarQa={clicks:[],dates:[],adds:0,searches:0};
function Fixture(){
 const ref=useRef(null);const [items,setItems]=useState(events);const [selected,setSelected]=useState(null);
 useEffect(()=>{window.calendarQa.api=ref.current.getApi();window.calendarQa.setEvents=setItems;window.calendarQa.original=events;window.calendarQa.api.gotoDate('2026-10-01');},[]);
 return <main className='ws-page'><div className='ws-page-header'><h1>학사 일정 관리</h1><span>2026학년도 2학기</span></div><div className='teacher-schedule-calendar'><Calendar events={items} calendarRef={ref} filterClass='all' availableClassTargets={['3-1']} onFilterChange={()=>{}} selectedDate={selected} onDateClick={d=>{setSelected(d);window.calendarQa.dates.push(d);}} onDateDoubleClick={()=>window.calendarQa.adds++} onEventClick={e=>window.calendarQa.clicks.push(e.id)} onAddEvent={()=>window.calendarQa.adds++} onSearchClick={()=>window.calendarQa.searches++}/></div></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const bundle = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(evidence, "fixture.js"),
  loader: { ".svg": "dataurl", ".webp": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "calendar-read-boundaries",
      setup(plugin) {
        plugin.onResolve(
          {
            filter: /^firebase\/firestore$|(?:^|\/)(firebase|semesterArchive)$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "ts",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+(?:url\()?['"]https?:[^;]+;/g, "");
const tailwindPath =
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
  path.join(os.tmpdir(), "westory-qa-tailwind.js");
let tailwind;
try {
  tailwind = await fs.readFile(tailwindPath, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const response = await fetch("https://cdn.tailwindcss.com", {
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok);
  tailwind = await response.text();
  await fs.writeFile(tailwindPath, tailwind, "utf8");
}
const html =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{background:#f8fafc}#root{padding-top:64px}@media(min-width:1024px){#root{margin-left:240px}}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost").pathname;
  const asset =
    url === "/fixture.js"
      ? ["text/javascript", js]
      : url === "/fixture.css"
        ? ["text/css", css]
        : url === "/tailwind.js"
          ? ["text/javascript", tailwind]
          : ["text/html", html];
  response.setHeader("Content-Type", asset[0]);
  response.end(asset[1]);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const report = {
  checks: [],
  layouts: [],
  screenshots: [],
  errors: [],
  externalRequests: [],
};
const titleEvent = (page, title) =>
  page.locator(".fc-daygrid-event:visible").filter({
    has: page.locator(`.student-calendar-event-label[title="${title}"]`),
  });
async function capture(page, name) {
  const file = name + ".png";
  await page.screenshot({ path: path.join(evidence, file), fullPage: true });
  report.screenshots.push(file);
}
async function settled(page) {
  await page.waitForFunction(() => Boolean(window.calendarQa?.api));
  await page.waitForFunction(() =>
    document
      .querySelector(".student-calendar-shell__month-title")
      ?.textContent.includes("2026"),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}
async function checkOctober(page, width) {
  const metrics = await page.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const visibleEvents = [...document.querySelectorAll(".fc-daygrid-event")]
      .filter(
        (el) =>
          getComputedStyle(el).visibility !== "hidden" &&
          el.getBoundingClientRect().height > 0,
      )
      .map((el) => ({
        title: el
          .querySelector(".student-calendar-event-label")
          ?.getAttribute("title"),
        ...rect(el),
        marginTop: getComputedStyle(el.parentElement).marginTop,
        inlineMarginTop: el.parentElement.style.marginTop,
        day: el.closest("[data-date]")?.getAttribute("data-date"),
      }));
    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      events: visibleEvents,
      cells: [...document.querySelectorAll(".fc-daygrid-day")].map((el) => ({
        date: el.dataset.date,
        ...rect(el),
        more: el.querySelector(".fc-more-link")?.textContent,
      })),
      body: rect(document.querySelector(".student-calendar-shell__body")),
      eyebrows: document.querySelectorAll(".student-calendar-shell__eyebrow")
        .length,
    };
  });
  report.layouts.push({ width, ...metrics });
  assert(metrics.documentWidth <= width + 1, `${width}: document overflow`);
  assert.equal(metrics.eyebrows, 0, "duplicate calendar heading removed");
  const range = metrics.events.filter(
    (e) => e.title === "고입 · 마이스터고 원서 접수",
  );
  assert.equal(range.length, 1, `${width}: one continuous ribbon`);
  const start = metrics.cells.find((c) => c.date === "2026-10-19"),
    end = metrics.cells.find((c) => c.date === "2026-10-22");
  assert(
    Math.abs(range[0].x - start.x) <= 2 &&
      Math.abs(range[0].right - end.right) <= 2,
    `${width}: ribbon reaches all 4 days`,
  );
  for (const title of ["3학년 스포츠", "3학년 5교시 운영", "자체소방훈련"]) {
    const item = metrics.events.find((e) => e.title === title);
    assert(item, `${width}: ${title} visible`);
    assert(item.y >= range[0].bottom - 1, `${width}: ${title} below ribbon`);
  }
  const operation = metrics.events.find((e) => e.title === "3학년 5교시 운영");
  assert(
    parseFloat(operation.marginTop) > 0,
    `${width}: FullCalendar preserves range offset`,
  );
  assert.equal(
    operation.marginTop,
    operation.inlineMarginTop,
    `${width}: computed offset equals SDK inline offset`,
  );
  const oct21 = metrics.cells.find((c) => c.date === "2026-10-21");
  assert(!oct21.more, `${width}: 3 overlapping events need no more link`);
  assert.equal(
    metrics.events.filter((e) => e.title?.startsWith("하루 세 일정")).length,
    3,
    `${width}: all 3 single-day events visible`,
  );
  assert(!metrics.cells.find((c) => c.date === "2026-10-12").more);
  assert.equal(
    metrics.events.filter((e) => e.title?.startsWith("하루 네 일정")).length,
    3,
  );
  assert.equal(metrics.cells.find((c) => c.date === "2026-10-23").more, "+1개");
  assert(
    metrics.cells.every((c) => c.height >= 159),
    `${width}: week rows >=160px`,
  );
  assert.equal(
    metrics.events.filter((e) => e.title === "한글날").length,
    0,
    "automatic holiday remains in day heading",
  );
  assert(
    await page
      .locator('[data-date="2026-10-09"] .student-calendar-day-holiday-label')
      .isVisible(),
  );
  report.checks.push(
    `${width}: full ribbon above day events, 3 visible/4th in more, 160px rows, no overflow, no duplicate title`,
  );
}
let failure;
try {
  for (const width of [390, 768, 1280, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      timezoneId: "Asia/Seoul",
    });
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === origin)
        return route.continue();
      report.externalRequests.push(route.request().url());
      return route.abort();
    });
    await page.goto(origin);
    await settled(page);
    await checkOctober(page, width);
    await capture(page, `october-${width}`);
    await page
      .locator('[data-date="2026-10-23"] .fc-more-link')
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await page.locator('[data-date="2026-10-23"] .fc-more-link').click();
    await page.getByRole("dialog").waitFor();
    assert.equal(
      await page
        .getByRole("dialog")
        .locator('[data-testid="schedule-more-popover-list"] > button')
        .count(),
      4,
    );
    await capture(page, `more-${width}`);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await titleEvent(page, "고입 · 마이스터고 원서 접수").click();
    assert.equal(
      await page.evaluate(() => window.calendarQa.clicks.at(-1)),
      "range",
    );
    await page.getByRole("button", { name: "다음 달", exact: true }).click();
    await page.waitForFunction(() =>
      document
        .querySelector(".student-calendar-shell__month-title")
        ?.textContent.includes("11월"),
    );
    await settled(page);
    const crossing = await titleEvent(page, "월 경계 원서 접수").all();
    assert.equal(
      crossing.length,
      1,
      "November starts on Sunday, showing one continuation segment",
    );
    const segments = await Promise.all(crossing.map((el) => el.boundingBox()));
    const novemberStart = await page
      .locator('[data-date="2026-11-01"]')
      .boundingBox();
    const novemberEnd = await page
      .locator('[data-date="2026-11-02"]')
      .boundingBox();
    assert(
      Math.abs(segments[0].x - novemberStart.x) <= 2 &&
        Math.abs(
          segments[0].x + segments[0].width - novemberEnd.x - novemberEnd.width,
        ) <= 2,
      "continuation covers November 1 through the inclusive end of November 2",
    );
    const single = await titleEvent(page, "월 경계 단일 일정").boundingBox();
    assert(
      single.y >= segments[0].y + segments[0].height - 1,
      "next-month daily event stays below continuation",
    );
    await capture(page, `november-boundary-${width}`);
    report.checks.push(
      `${width}: more dialog holds 4 events, Escape closes, event click works, cross-month continuation survives navigation`,
    );
    await page.getByRole("button", { name: "목록", exact: true }).click();
    await page.locator(".custom-schedule-list").waitFor();
    await page.getByRole("button", { name: "달력", exact: true }).click();
    await page.locator(".fc-daygrid").waitFor();
    await page.evaluate(() => {
      window.calendarQa.setEvents([
        {
          id: "two-weeks",
          title: "주 경계 연속 일정",
          start: "2026-11-06",
          end: "2026-11-09",
          eventType: "event",
          targetType: "common",
          startPeriod: "allDay",
        },
      ]);
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          ".fc-daygrid-event.student-calendar-range-event",
        ).length === 2,
    );
    const weekSegments = await titleEvent(page, "주 경계 연속 일정").all();
    assert.equal(
      weekSegments.length,
      2,
      "one event continues on two week rows",
    );
    await capture(page, `two-weeks-${width}`);
    await page.evaluate(() => window.calendarQa.setEvents([]));
    await page.waitForFunction(
      () => document.querySelectorAll(".fc-daygrid-event").length === 0,
    );
    assert(
      await page.getByRole("button", { name: "추가", exact: true }).isVisible(),
    );
    await page.evaluate(() => window.calendarQa.api.gotoDate("2026-08-01"));
    await page.waitForFunction(
      () => document.querySelectorAll(".fc-daygrid-day").length === 42,
    );
    await settled(page);
    const sixWeekRows = await page
      .locator(".fc-daygrid-day")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    assert(
      sixWeekRows.every((height) => height >= 159),
      "six-week month preserves row height",
    );
    report.checks.push(
      `${width}: list/calendar controls, two-week continuation, empty calendar and six-week month height remain available`,
    );
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.externalRequests, []);
} catch (error) {
  failure = error;
  report.failure = error.stack;
  for (const context of browser.contexts())
    for (const page of context.pages())
      await capture(page, "failure").catch(() => {});
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
}
console.log(
  JSON.stringify(
    {
      evidence,
      checks: report.checks,
      screenshots: report.screenshots,
      errors: report.errors,
      failure: report.failure,
    },
    null,
    2,
  ),
);
if (failure) throw failure;
