import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence =
  process.env.WEEK_SCHEDULE_EVIDENCE ||
  path.join(os.tmpdir(), "westory-week-schedule-qa");
await fs.mkdir(evidence, { recursive: true });
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: "tsx",
    contents: `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import TeacherWeekSchedule from './src/pages/teacher/components/TeacherWeekSchedule';
import StudentWeekSchedule from './src/pages/student/components/StudentWeekSchedule';
import './src/assets/index.css';
import './src/pages/teacher/teacherDashboard.css';
import './src/pages/student/studentDashboard.css';
import './src/pages/student/components/studentCalendar.css';
const categories=[{key:'admission',label:'고입',color:'#8b5cf6',emoji:'',order:9},{key:'exam',label:'정기 시험',color:'#ef4444',emoji:'',order:8},{key:'safety',label:'안전교육',color:'#eab308',emoji:'',order:1},{key:'event',label:'행사',color:'#10b981',emoji:'',order:2},{key:'activity',label:'창의적 체험활동',color:'#3b82f6',emoji:'',order:0}];
const event=(id,title,start,end,eventType='admission',startPeriod='allDay',endPeriod)=>({id,title,start,end,eventType,startPeriod,endPeriod,targetType:'common'});
const events=[
event('same-month','고입 · 마이스터고 원서 접수','2026-10-19','2026-10-22'),
event('cross-month','고입 · 월을 넘기는 원서 접수','2026-10-30','2026-11-02'),
event('cross-year','고입 · 해를 넘기는 원서 접수','2026-12-31','2027-01-02'),
event('long-range','고입 · 긴 일정 제목과 날짜 기간을 함께 확인하는 검증 일정','2026-10-19','2027-10-22'),
event('single','3학년 스포츠','2026-10-20',undefined,'activity','period6','period7'),
event('holiday','자동 공휴일 표시 검증','2026-10-21',undefined,'holiday')];
const markerEvents=[
event('holiday-only','자동 공휴일','2026-10-18',undefined,'holiday'),
...['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23'].map(date=>event('activity-'+date,'창체 '+date,date,undefined,'activity')),
...['2026-10-19','2026-10-21','2026-10-22'].map(date=>event('event-'+date,'학교 행사 '+date,date,undefined,'event')),
...['2026-10-19','2026-10-20','2026-10-21'].map(date=>event('safety-'+date,'안전교육 '+date,date,undefined,'safety')),
...['2026-10-19','2026-10-20'].map(date=>event('exam-'+date,'정기 시험 '+date,date,undefined,'exam')),
{...event('admission-first','고입 원서 접수','2026-10-19'),labelColor:'#ffffff'},
event('admission-second','고입 합격 발표','2026-10-19'),
event('overlap-holiday','공휴일과 고입 중복','2026-10-19',undefined,'holiday'),
event('unknown','기타 일정','2026-10-23',undefined,'unknown'),
...Array.from({length:12},(_,index)=>event('dense-'+index,'같은 색 창체 '+index,'2026-10-24',undefined,'activity'))];
function Calendar({role}) {
 const [weekStart,setWeekStart]=useState(new URLSearchParams(location.search).get('week')||'2026-10-18');
 const [selectedDate,setSelectedDate]=useState(null);
 const [clicked,setClicked]=useState('');
 const state=new URLSearchParams(location.search).get('state');
 const markers=new URLSearchParams(location.search).get('scenario')==='markers';
 const shared={events:state==='empty'?[]:markers?markerEvents:events,categories,weekStart,selectedDate,loading:state==='loading',error:state==='error',onWeekChange:setWeekStart,onDateClick:setSelectedDate,onSearchSelect:setSelectedDate,onEventClick:e=>setClicked(e.id)};
 return <><output data-clicked={role}>{clicked}</output>{role==='teacher'?<main className="teacher-layout"><div className="teacher-weekly-dashboard"><div className="teacher-weekly-dashboard__grid"><div className="teacher-weekly-dashboard__schedule"><TeacherWeekSchedule {...shared} filterClass="all" availableClassTargets={[]} onDateDoubleClick={()=>{}} onAddEvent={()=>{}} onFilterChange={()=>{}}/></div></div></div></main>:<main className="student-portal-dashboard"><div className="student-portal-dashboard__grid"><div className="student-portal-dashboard__calendar"><StudentWeekSchedule {...shared} attendanceLoading={false} attendanceChecked={true} attendanceMessage="" attendanceDates={[]} attendanceGoalText="" onAttendanceCheck={()=>{}}/></div></div></main>}</>;
}
createRoot(document.getElementById('root')).render(<MemoryRouter><div className="fixture"><Calendar role="teacher"/><Calendar role="student"/></div></MemoryRouter>);`,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  loader: { ".webp": "dataurl", ".svg": "dataurl" },
  outfile: path.join(evidence, "fixture.js"),
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "read-only-school-config",
      setup(plugin) {
        plugin.onResolve(
          { filter: /^firebase\/firestore$|(?:^|\/)firebase$/ },
          () => ({ path: "school", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export const db={};export const doc=()=>({});export const getDoc=async()=>({exists:()=>false});export const onSnapshot=()=>()=>{};",
          loader: "js",
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
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
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>.fixture{padding-top:16px}output{display:block;padding:4px 24px} @media(min-width:1024px){.fixture{margin-left:232px}}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const [type, body] =
    pathname === "/fixture.js"
      ? ["text/javascript", js]
      : pathname === "/fixture.css"
        ? ["text/css", css]
        : pathname === "/tailwind.js"
          ? ["text/javascript", tailwind]
          : ["text/html", html];
  response.setHeader("Content-Type", `${type};charset=utf-8`);
  response.end(body);
});
await new Promise((resolve) =>
  server.listen(
    Number(process.env.WEEK_SCHEDULE_PORT || 0),
    "127.0.0.1",
    resolve,
  ),
);
const origin = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes("--serve")) {
  console.log(`Week schedule fixture: ${origin}`);
  await new Promise(() => {});
}
const require = createRequire(import.meta.url);
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
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const results = [];
try {
  for (const width of [320, 390, 768, 1280, 1366, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const [week, expected, expectedCompact] of [
      ["2026-10-18", "10월 19–22일", "10/19–22"],
      ["2026-10-25", "10월 30일–11월 2일", "10/30–11/2"],
      ["2026-12-27", "2026년 12월 31일–2027년 1월 2일", "2026/12/31–2027/1/2"],
    ]) {
      await page.goto(`${origin}/?week=${week}`);
      await page.evaluate(() => document.fonts.ready);
      for (const role of ["teacher", "student"]) {
        const section = page.locator(`.${role}-week-schedule`);
        const row = section.locator(`.${role}-week-event`).filter({
          has: page.locator(`.${role}-week-event__date[title="${expected}"]`),
        });
        assert.equal(
          await row.count(),
          1,
          `${role}: one row for the entire range`,
        );
        const label = row.locator(`.${role}-week-event__date-label:visible`);
        assert.equal(
          await label.innerText(),
          width < 768 ? expectedCompact : expected,
        );
        const layout = await section.evaluate((element, role) => {
          const rows = Array.from(
            element.querySelectorAll(`.${role}-week-event`),
          );
          return rows.map((row) => {
            const badge = row.querySelector(`.${role}-week-event__date`);
            const label = Array.from(badge.children).find(
              (child) => getComputedStyle(child).display !== "none",
            );
            const range = document.createRange();
            range.selectNodeContents(label);
            const rects = Array.from(range.getClientRects());
            const badgeBox = badge.getBoundingClientRect(),
              rowBox = row.getBoundingClientRect();
            const body = row
              .querySelector(`.${role}-week-event__body`)
              .getBoundingClientRect();
            return {
              text: label.textContent,
              lines: rects.length,
              unclipped: label.scrollWidth <= label.clientWidth + 1,
              inside:
                badgeBox.left >= rowBox.left &&
                badgeBox.right <= rowBox.right + 1,
              nowrap: getComputedStyle(badge).whiteSpace,
              bodyVisible: body.width >= 200,
              badgeWidth: badgeBox.width,
              rowWidth: rowBox.width,
            };
          });
        }, role);
        for (const item of layout) {
          assert(
            item.lines === 1 &&
              item.unclipped &&
              item.inside &&
              item.nowrap === "nowrap" &&
              item.bodyVisible,
            JSON.stringify({ width, role, item }),
          );
        }
        if (width < 768) {
          const titleMotion = await section
            .locator(`.${role}-schedule-title__text`)
            .evaluateAll((titles) =>
              titles
                .filter(
                  (title) =>
                    title.scrollWidth > title.parentElement.clientWidth,
                )
                .every((title) => title.getAnimations().length > 0),
            );
          assert(titleMotion, `${role}: overflowing mobile titles keep moving`);
        }
        await row.focus();
        await page.keyboard.press("Enter");
        assert(
          (await page.locator(`output[data-clicked="${role}"]`).textContent())
            .length > 0,
        );
        results.push({ width, week, role, layout });
      }
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `No page overflow at ${width}`,
      );
      await page.screenshot({
        path: path.join(evidence, `${width}-${week}.png`),
        fullPage: true,
      });
    }
    await page.clock.install({ time: new Date("2026-10-19T03:00:00Z") });
    await page.goto(`${origin}/?scenario=markers`);
    await page.evaluate(() => document.fonts.ready);
    for (const role of ["teacher", "student"]) {
      const days = page.locator(`.${role}-week-strip__day`);
      const counts = [1, 7, 3, 3, 2, 2, 12];
      const expectedBackgrounds = [
        null,
        "rgb(139, 92, 246)",
        "rgb(239, 68, 68)",
        "rgb(234, 179, 8)",
        "rgb(16, 185, 129)",
        "rgb(59, 130, 246)",
        "rgb(59, 130, 246)",
      ];
      for (let index = 0; index < counts.length; index++) {
        const day = days.nth(index);
        const dots = day.locator(`.${role}-week-strip__marker`);
        assert.equal(
          await dots.count(),
          counts[index],
          `${role}: one dot per event on day ${index}`,
        );
        const label = await day.getAttribute("aria-label");
        for (const title of await dots.evaluateAll((nodes) =>
          nodes.map((node) => node.title),
        ))
          assert(
            label.includes(title),
            `${role}: every event is named accessibly`,
          );
        const layout = await day.evaluate((element, role) => {
          const group = element.querySelector(`.${role}-week-strip__markers`);
          const parent = element.getBoundingClientRect();
          const rects = Array.from(group.children, (child) =>
            child.getBoundingClientRect(),
          );
          return {
            inside: rects.every(
              (rect) =>
                rect.left >= parent.left &&
                rect.right <= parent.right + 1 &&
                rect.width > 0 &&
                rect.height > 0,
            ),
            oneLine: rects.every(
              (rect) => Math.abs(rect.top - rects[0].top) < 1,
            ),
            overflow: group.scrollWidth > group.clientWidth + 1,
          };
        }, role);
        assert(
          layout.inside && layout.oneLine && !layout.overflow,
          JSON.stringify({ width, role, index, layout }),
        );
        if (expectedBackgrounds[index])
          assert.equal(
            await day
              .locator("strong")
              .evaluate((node) => getComputedStyle(node).backgroundColor),
            expectedBackgrounds[index],
            `${role}: category importance determines the day color`,
          );
      }
      assert.deepEqual(
        await days
          .nth(1)
          .locator(`.${role}-week-strip__marker`)
          .evaluateAll((nodes) =>
            nodes.map((node) => getComputedStyle(node).backgroundColor),
          ),
        [
          "rgb(139, 92, 246)",
          "rgb(139, 92, 246)",
          "rgb(239, 68, 68)",
          "rgb(234, 179, 8)",
          "rgb(16, 185, 129)",
          "rgb(59, 130, 246)",
          "rgb(185, 28, 28)",
        ],
      );
      assert.equal(await days.nth(1).getAttribute("aria-current"), "date");
      assert.equal(
        await days
          .nth(1)
          .locator("strong")
          .evaluate((node) => getComputedStyle(node).outlineWidth),
        "2px",
      );
      assert.equal(
        await days
          .first()
          .locator("strong")
          .evaluate((node) => getComputedStyle(node).color),
        "rgb(185, 28, 28)",
      );
      await days.nth(3).click();
      assert.equal(await days.nth(3).getAttribute("aria-pressed"), "true");
      results.push({
        width,
        role,
        markers: counts,
        importance: true,
        allEventsAccessible: true,
        todayHolidayAndSelectionPreserved: true,
      });
    }
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `No marker overflow at ${width}`,
    );
    await page.screenshot({
      path: path.join(evidence, `${width}-priority-markers.png`),
      fullPage: true,
    });
    if (width === 390) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(origin);
      await page.evaluate(() => document.fonts.ready);
      for (const role of ["teacher", "student"]) {
        const section = page.locator(`.${role}-week-schedule`);
        assert(
          await section
            .locator(`.${role}-schedule-title__text`)
            .evaluateAll((titles) =>
              titles.every((title) => title.getAnimations().length === 0),
            ),
          `${role}: reduced motion stops title movement`,
        );
        await section
          .getByRole("button", { name: "일정 검색", exact: true })
          .click();
        await section.getByRole("searchbox").fill("고입");
        assert.equal(await section.locator(`.${role}-week-event`).count(), 4);
        assert(
          await section
            .locator(`.${role}-week-event__date-label--compact`)
            .filter({ hasText: "2026/12/31–2027/1/2" })
            .isVisible(),
        );
        await section.getByRole("searchbox").press("Escape");
        assert(
          await section
            .getByRole("button", { name: "일정 검색", exact: true })
            .evaluate((element) => element === document.activeElement),
        );
      }
      await page.screenshot({
        path: path.join(evidence, "390-reduced-motion.png"),
        fullPage: true,
      });
      for (const [state, text] of [
        ["empty", "이번 주에 등록된 일정이 없습니다."],
        ["loading", "일정을 불러오는 중입니다."],
        ["error", "일정을 불러오지 못했습니다."],
      ]) {
        await page.goto(`${origin}/?state=${state}`);
        assert.equal(
          await page.getByText(text, { exact: state !== "error" }).count(),
          2,
        );
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  await fs.writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `Week schedule browser checks passed: ${results.length} desktop/mobile range and priority-marker cases, keyboard, search, reduced motion and loading/error/empty states. Evidence: ${evidence}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
