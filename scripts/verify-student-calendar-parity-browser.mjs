/** Real student calendar and shared detail dialog, with synthetic read-only data. */
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
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence =
  process.env.STUDENT_CALENDAR_PARITY_EVIDENCE_DIR ||
  path.join(root, "output/student-calendar-parity");
await fs.mkdir(evidence, { recursive: true });
const source = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const service = `
const date=new Date();date.setMinutes(date.getMinutes()-date.getTimezoneOffset());
const start=date.toISOString().slice(0,10);
const mode=new URLSearchParams(location.search).get('mode')||'normal';
window.calendarParityQa={reads:[],subscriptions:0,eventReads:0,writes:0,fail:mode==='error'};
const qa=window.calendarParityQa;
const event={id:'fixture-event',title:'우리 반 역사 탐방 일정',start,end:start,eventType:'field-trip',targetType:'class',targetClass:'3-1',startPeriod:'period2',endPeriod:'period3',description:'박물관에서 유물을 살펴봅니다.'};
export const db={};
export const doc=(_db,...parts)=>({path:parts.join('/')});
export const getDoc=async(ref)=>{qa.reads.push(ref.path);return {exists:()=>true,data:()=>ref.path==='site_settings/config'?{year:'2026',semester:'2'}:{grade:3,class:1}};};
export const onSnapshot=(ref,cb)=>{qa.subscriptions++;qa.reads.push(ref.path);queueMicrotask(()=>cb({data:()=>({items:[{key:'field-trip',label:'현장 체험',emoji:'🟣',color:'#8b5cf6',order:8}]})}));return ()=>{};};
export const useAuth=()=>({user:{uid:'fixture-student'},menuConfig:null});
export const getStudentMenuLabel=(_config,_path,fallback)=>fallback;
export const useAttendanceDates=()=>({dates:[],loading:false,error:'',retry(){}});
export const getKoreanPublicHolidays=async()=>[];
export const mergeEventsWithKoreanPublicHolidays=(items)=>items;
export const getStudentClassKey=()=> '3-1';
export const loadVisibleCalendarEvents=async(_db,path,target)=>{qa.eventReads++;qa.reads.push({path,target});if(qa.fail)throw Error('Synthetic schedule read failure');return mode==='empty'?[]:[event];};
`;
const bundle = await build({
  stdin: {
    contents: `
import React,{useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Calendar from ${source("src/pages/student/Calendar.tsx")};
import Detail from ${source("src/components/common/ScheduleEventDetailModal.tsx")};
import ${source("src/assets/index.css")};
const role=new URLSearchParams(location.search).get('shared');
const sample={id:'shared-event',title:'공통 상세 확인',start:'2026-11-17',eventType:'event',targetType:'common'};
function Editor(){
 const ref=useRef(null);
 useLayoutEffect(()=>{ref.current.showModal();return ()=>ref.current?.close();},[]);
 return <dialog ref={ref} aria-label='일정 수정'><input aria-label='일정 제목' autoFocus /></dialog>;
}
function SharedFixture(){
 const [selected,setSelected]=useState(null),[mounted,setMounted]=useState(true),[editor,setEditor]=useState(false);
 window.calendarParityQa.unmountDetail=()=>setMounted(false);
 return <main className='ws-page'><button onClick={()=>{setMounted(true);setSelected(sample);}}>일정 열기</button>
 {mounted&&<Detail event={selected} categories={[]} onClose={()=>setSelected(null)} onEdit={role==='teacher'?(event)=>{window.calendarParityQa.editedId=event.id;setSelected(null);setEditor(true);}:undefined}/>}
 {editor&&<Editor/>}</main>;
}
createRoot(document.getElementById('root')).render(role?<SharedFixture/>:<Calendar/>);
`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(evidence, "fixture.js"),
  loader: { ".svg": "dataurl", ".webp": "dataurl", ".png": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "read-only-calendar-fixture",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^firebase\/firestore$|(?:^|\/)(firebase|AuthContext|menus|useAttendanceDates|koreanPublicHolidays|visibleSchedule)$/,
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
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost").pathname;
  const [type, body] =
    url === "/fixture.js"
      ? ["text/javascript", js]
      : url === "/fixture.css"
        ? ["text/css", css]
        : url === "/tailwind.js"
          ? ["text/javascript", tailwind]
          : ["text/html", html];
  response.setHeader("Content-Type", type);
  response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const report = { checks: [], counts: [], errors: [], externalRequests: [] };
try {
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(origin) || url.startsWith("data:"))
        return route.continue();
      report.externalRequests.push(url);
      return route.abort();
    });
    await page.goto(origin);
    await page.getByRole("button", { name: "목록", exact: true }).click();
    const eventButton = page
      .locator(".student-full-calendar__list-event")
      .filter({ hasText: "우리 반 역사 탐방 일정" });
    await eventButton.waitFor();
    assert.match(await eventButton.innerText(), /현장 체험/);
    const countsBefore = await page.evaluate(() => ({
      subscriptions: calendarParityQa.subscriptions,
      eventReads: calendarParityQa.eventReads,
      reads: calendarParityQa.reads.length,
    }));
    await eventButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "일정 상세" });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /현장 체험/);
    assert.match(await dialog.innerText(), /2.*3.*교시/);
    assert.match(await dialog.innerText(), /박물관에서 유물을 살펴봅니다/);
    assert.equal(
      await dialog.getByRole("button", { name: "수정", exact: true }).count(),
      0,
    );
    assert(await dialog.evaluate((el) => el.contains(document.activeElement)));
    await page.keyboard.press("Tab");
    assert(await dialog.evaluate((el) => el.contains(document.activeElement)));
    await page.keyboard.press("Shift+Tab");
    assert(await dialog.evaluate((el) => el.contains(document.activeElement)));
    await page.screenshot({
      path: path.join(evidence, `detail-${width}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert(
      await eventButton.evaluate((el) => document.activeElement === el),
      "Native dialog restores trigger focus",
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        subscriptions: calendarParityQa.subscriptions,
        eventReads: calendarParityQa.eventReads,
        reads: calendarParityQa.reads.length,
      })),
      countsBefore,
      "Opening and closing details adds no reads",
    );
    const header = await page.locator(".ws-page-header").evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, position: style.position };
    });
    assert.deepEqual(header, {
      background: "rgba(0, 0, 0, 0)",
      position: "static",
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    const calls = await page.evaluate(() => calendarParityQa);
    assert.equal(calls.subscriptions, 1);
    assert.equal(calls.eventReads, 1);
    assert.equal(calls.writes, 0);
    assert.deepEqual(
      calls.reads.filter((item) => typeof item === "object"),
      [{ path: "years/2026/semesters/2/calendar", target: "3-1" }],
    );
    report.counts.push({ width, ...calls });
    await page.screenshot({
      path: path.join(evidence, `calendar-${width}.png`),
      fullPage: true,
    });
    await page.goto(`${origin}?mode=empty`);
    await page.getByRole("button", { name: "목록", exact: true }).click();
    await page.getByText("등록된 일정이 없습니다.", { exact: true }).waitFor();
    await page.goto(`${origin}?mode=error`);
    await page
      .getByRole("alert")
      .filter({ hasText: "일정을 불러오지 못했습니다" })
      .waitFor();
    await page.evaluate(() => {
      calendarParityQa.fail = false;
    });
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    await page.getByRole("alert").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "목록", exact: true }).click();
    await page
      .locator(".student-full-calendar__list-event")
      .filter({ hasText: "우리 반 역사 탐방 일정" })
      .waitFor();
    assert.equal(await page.evaluate(() => calendarParityQa.eventReads), 2);
    assert.equal(await page.evaluate(() => calendarParityQa.subscriptions), 1);
    report.checks.push(
      `${width}px: shared custom-category detail, no editing, dialog keyboard/focus, empty/error/retry, one shared category subscription, scoped reads, zero writes`,
    );
    await page.close();
  }
  for (const role of ["student", "teacher"]) {
    for (const width of [390, 768, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      page.on("pageerror", (error) => report.errors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(origin) || url.startsWith("data:"))
          return route.continue();
        report.externalRequests.push(url);
        return route.abort();
      });
      await page.goto(`${origin}?shared=${role}`);
      const opener = page.getByRole("button", {
        name: "일정 열기",
        exact: true,
      });
      for (const closeMethod of ["button", "escape", "backdrop", "unmount"]) {
        await opener.click();
        const detail = page.getByRole("dialog", { name: "일정 상세" });
        await detail.waitFor();
        assert.equal(
          await detail
            .getByRole("button", { name: "수정", exact: true })
            .count(),
          role === "teacher" ? 1 : 0,
        );
        if (closeMethod === "button")
          await detail
            .getByRole("button", { name: "닫기", exact: true })
            .last()
            .click();
        if (closeMethod === "escape") await page.keyboard.press("Escape");
        if (closeMethod === "backdrop")
          await detail.click({ position: { x: 2, y: 2 } });
        if (closeMethod === "unmount")
          await page.evaluate(() => calendarParityQa.unmountDetail());
        await detail.waitFor({ state: "detached" });
        assert(
          await opener.evaluate((el) => el === document.activeElement),
          `${role} ${width}: ${closeMethod} restores opener focus`,
        );
      }
      if (role === "teacher") {
        await opener.click();
        await page.getByRole("button", { name: "수정", exact: true }).click();
        const title = page
          .getByRole("dialog", { name: "일정 수정" })
          .getByRole("textbox", { name: "일정 제목" });
        await title.waitFor();
        assert.equal(
          await page.evaluate(() => calendarParityQa.editedId),
          "shared-event",
        );
        assert(
          await title.evaluate((el) => el === document.activeElement),
          "A replacement editor keeps focus",
        );
      }
      report.checks.push(
        `${role} ${width}px: close/Escape/backdrop/unmount focus restoration; role-specific edit and replacement-dialog focus`,
      );
      await page.close();
    }
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.externalRequests, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ pass: true, ...report }, null, 2),
  );
  console.log(
    JSON.stringify({ pass: true, evidence, checks: report.checks }, null, 2),
  );
} catch (error) {
  await fs.writeFile(
    path.join(evidence, "failure.json"),
    JSON.stringify(
      { message: error.message, stack: error.stack, ...report },
      null,
      2,
    ),
  );
  for (const [index, page] of browser
    .contexts()
    .flatMap((context) => context.pages())
    .entries())
    await page.screenshot({
      path: path.join(evidence, `failure-${index}.png`),
      fullPage: true,
    });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
