/** Real interface controls and dashboard; synthetic server boundaries only. */
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
  process.env.INTERFACE_CONTROLS_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-interface-controls-")));
await fs.mkdir(evidence, { recursive: true });
const source = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));

const service = `
import React from 'react';
export const qa=window.interfaceQa={reads:[],writes:[],toasts:[],notifies:[],fail:false,calendarReads:0,recognitionReads:0};
export const config={year:'2026',semester:'2',showLesson:true,showQuiz:true,showScore:true};
export const db={};
export const docs={'site_settings/interface_config':{dashboard:{notice:true,calendar:true,ranking:true},footerText:'Existing footer'},'site_settings/config':config};
export const useAuth=()=>({user:{uid:'fixture'},userData:{uid:'fixture',grade:3,class:1},config,interfaceConfig:window.dashboardConfig||docs['site_settings/interface_config'],menuConfig:null,refreshInterfaceConfig:async()=>{}});
export const doc=(_db,...segments)=>({path:segments.join('/')});
export const getDocFromServer=async ref=>{qa.reads.push(ref.path);if(qa.fail)throw new Error('fixture-read-failure');return {exists:()=>docs[ref.path]!==undefined,data:()=>structuredClone(docs[ref.path])};};
export const setDoc=async(ref,value)=>{qa.writes.push({path:ref.path,value});docs[ref.path]={...docs[ref.path],...value};};
export const runTransaction=async(_db,callback)=>{const writes=[];await callback({get:async ref=>({exists:()=>docs[ref.path]!==undefined,data:()=>structuredClone(docs[ref.path])}),set:(ref,value)=>writes.push({ref,value})});for(const {ref,value}of writes)await setDoc(ref,value);};
export const serverTimestamp=()=>0;
export const useAppToast=()=>({showToast:value=>qa.toasts.push(value)});
export const invalidateSiteSettingDocCache=()=>{};
export const notifySystemConfigUpdated=()=>qa.notifies.push('config');
export const notifyMenuConfigUpdated=()=>qa.notifies.push('menus');
export const notifyPointsUpdated=()=>{};
export const useAttendanceDates=()=>({dates:[],confirmedDates:[],error:false,retry(){}});
export const checkStudentAttendance=async()=>{};
export const attendanceErrorMessage=()=>'';
export const buildAttendanceSourceId=()=> 'attendance-2026-11-10';
export const buildPointRewardFeedback=()=>null;
export const useScheduleCategories=()=>({categories:[]});
export const getKoreanPublicHolidays=async()=>[];
export const mergeEventsWithKoreanPublicHolidays=events=>events;
export const getStudentClassKey=()=> '3-1';
export const subscribeVisibleCalendarEvents=(_db,_path,_class,next)=>{qa.calendarReads++;next([]);return ()=>{};};
export const loadHallOfFameRecognition=async()=>{qa.recognitionReads++;return null;};
export const markHallOfFameRecognitionSeen=()=>{};
export const WisRankingPanel=()=> <div data-testid='ranking'>위스 순위</div>;
export const StudentWeekSchedule=()=> <div data-testid='calendar'>주간 일정</div>;
export const NoticeBoard=()=> <div data-testid='notice'>알림장</div>;
export const NullPanel=()=>null;
`;
const harness = `
import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import Settings from ${source("src/pages/teacher/components/SettingsInterface.tsx")};
import Dashboard from ${source("src/pages/student/Dashboard.tsx")};
import ${source("src/assets/index.css")};
import {qa} from 'fixture:service';
const params=new URLSearchParams(location.search);qa.fail=params.has('fail');
window.dashboardConfig={dashboard:Object.fromEntries(['notice','calendar','ranking'].map(key=>[key,!params.has('hide-'+key)]))};
createRoot(document.getElementById('root')).render(<MemoryRouter><main style={{containerType:'inline-size',containerName:'teacher-settings',padding:16}}>{params.has('dashboard')?<Dashboard/>:<Settings/>}</main></MemoryRouter>);
`;
const componentStubs = {
  WisRankingPanel: "WisRankingPanel",
  StudentWeekSchedule: "StudentWeekSchedule",
  NoticeBoard: "NoticeBoard",
  WisHallOfFameRecognitionModal: "NullPanel",
  ScheduleEventDetailModal: "NullPanel",
};
const bundle = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(evidence, "fixture.js"),
  loader: {
    ".svg": "dataurl",
    ".webp": "dataurl",
    ".woff": "dataurl",
    ".woff2": "dataurl",
  },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "interface-fixture",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^fixture:|^firebase\/firestore$|(?:^|\/)contexts\/AuthContext$|(?:^|\/)(firebase|siteSettings|appEvents|attendance|points|scheduleCategories|koreanPublicHolidays|visibleSchedule|wisHallOfFameRecognition|useAttendanceDates|AppToastProvider)$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)(WisRankingPanel|StudentWeekSchedule|NoticeBoard|WisHallOfFameRecognitionModal|ScheduleEventDetailModal)$/,
          },
          (args) => ({
            path: args.path.split("/").at(-1),
            namespace: "component",
          }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "tsx",
          resolveDir: root,
        }));
        plugin.onLoad({ filter: /.*/, namespace: "component" }, (args) => ({
          contents:
            "export { " +
            componentStubs[args.path] +
            ' as default } from "fixture:service";',
          loader: "js",
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
  const appHtml = await fs.readFile(path.join(root, "index.html"), "utf8");
  const tailwindUrl = Array.from(
    appHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi),
    (match) => match[1],
  ).find((url) => /^https:\/\/cdn\.tailwindcss\.com(?:\/|$)/.test(url));
  assert(
    tailwindUrl,
    "index.html must declare the official Tailwind CDN runtime",
  );
  try {
    const response = await fetch(tailwindUrl, {
      signal: AbortSignal.timeout(30000),
    });
    assert(response.ok, `Tailwind CDN returned HTTP ${response.status}`);
    assert.equal(new URL(response.url).origin, "https://cdn.tailwindcss.com");
    assert.match(
      response.headers.get("content-type") || "",
      /(?:java|ecma)script/i,
    );
    tailwind = await response.text();
    assert(tailwind.trim(), "Tailwind CDN returned an empty runtime");
  } catch (cause) {
    throw new Error(
      `Could not cache ${tailwindUrl}. Connect once, or set PORTAL_DESIGN_TAILWIND_PATH to a downloaded runtime.`,
      { cause },
    );
  }
  await fs.mkdir(path.dirname(tailwindPath), { recursive: true });
  try {
    await fs.writeFile(tailwindPath, tailwind, {
      encoding: "utf8",
      flag: "wx",
    });
    console.log(`Cached production Tailwind runtime: ${tailwindPath}`);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    tailwind = await fs.readFile(tailwindPath, "utf8");
  }
}
const html =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const asset =
    pathname === "/fixture.js"
      ? ["text/javascript", js]
      : pathname === "/tailwind.js"
        ? ["text/javascript", tailwind]
        : pathname === "/fixture.css"
          ? ["text/css", css]
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

const screenshots = [];
const checks = [];
try {
  const context = await browser.newContext();
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await page.getByRole("checkbox", { name: "알림장 표시" }).waitFor();
    assert.equal(
      await page.getByText("메인 이모지", { exact: true }).count(),
      0,
    );
    await page.getByRole("checkbox", { name: "위스 순위 표시" }).uncheck();
    await page.getByRole("button", { name: "대시보드·푸터 저장" }).click();
    await page.waitForFunction(() => window.interfaceQa.writes.length > 0);
    assert.equal(
      await page.evaluate(
        () => window.interfaceQa.writes[0].value.dashboard.ranking,
      ),
      false,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const shot = path.join(evidence, "settings-" + width + ".png");
    await page.screenshot({ path: shot, fullPage: true });
    screenshots.push(shot);
    await page.getByRole("tab", { name: "사이트맵 메뉴", exact: true }).click();
    await page
      .getByRole("button", { name: "마이페이지 전체 숨기기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "사이트맵 저장", exact: true })
      .click();
    await page.waitForFunction(() =>
      window.interfaceQa.writes.some(
        (write) => write.path === "site_settings/config",
      ),
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.interfaceQa.writes.find(
            (write) => write.path === "site_settings/config",
          ).value.studentMenuVisibility.mypage,
      ),
      false,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const shotMenus = path.join(evidence, "menus-" + width + ".png");
    await page.screenshot({ path: shotMenus, fullPage: true });
    screenshots.push(shotMenus);
    checks.push(
      "Settings toggle, atomic menu save and no overflow at " + width,
    );
  }
  await page.goto(origin);
  await page.getByRole("tab", { name: "사이트맵 메뉴", exact: true }).click();
  await page
    .getByRole("button", { name: "아바타 꾸미기 숨기기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "마우저구 윷놀이 숨기기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "사이트맵 저장", exact: true })
    .click();
  await page.waitForFunction(() =>
    window.interfaceQa.writes.some(
      (write) => write.path === "site_settings/config",
    ),
  );
  const visibility = await page.evaluate(
    () =>
      window.interfaceQa.writes.find(
        (write) => write.path === "site_settings/config",
      ).value.studentMenuVisibility,
  );
  assert.equal(visibility.avatar, false);
  assert.equal(visibility.yut, false);
  assert.equal(visibility.mypage, true);
  assert.equal(visibility.profile, true);
  checks.push("Individual avatar and yut hide while profile remains available");
  await page.goto(origin + "/?fail");
  await page.getByRole("button", { name: "다시 시도", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "사이트맵 저장", exact: true })
      .count(),
    0,
  );
  await page.evaluate(() => (window.interfaceQa.fail = false));
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await page.getByRole("checkbox", { name: "알림장 표시" }).waitFor();
  checks.push("Failed initial server read blocks editing and retry recovers");
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + "/?dashboard&hide-calendar&hide-ranking");
    await page.getByTestId("notice").waitFor();
    assert.equal(await page.getByTestId("calendar").count(), 0);
    assert.equal(await page.getByTestId("ranking").count(), 0);
    assert.equal(
      await page.evaluate(() => window.interfaceQa.calendarReads),
      0,
    );
    assert.equal(
      await page.evaluate(() => window.interfaceQa.recognitionReads),
      0,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const shot = path.join(evidence, "dashboard-" + width + ".png");
    await page.screenshot({ path: shot });
    screenshots.push(shot);
    checks.push("Dashboard hidden panels do not mount or query at " + width);
  }
  await page.goto(origin + "/?dashboard");
  await page.getByTestId("calendar").waitFor();
  await page.getByTestId("ranking").waitFor();
  await page.getByTestId("notice").waitFor();
  checks.push("Legacy missing settings keep all dashboard panels");
  await fs.writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify({ checks, screenshots }, null, 2),
  );
  console.log(JSON.stringify({ checks, evidence }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
