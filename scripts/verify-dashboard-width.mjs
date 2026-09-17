// Uses the actual dashboard wrapper classes, calendar and production CSS.
// All calendar data is synthetic and Firebase I/O is replaced at bundle time.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const root = process.cwd();
const require = createRequire(import.meta.url);
const dashboard = readFileSync("src/pages/teacher/Dashboard.tsx", "utf8");
const classFor = (name) => {
  const match = dashboard.match(
    new RegExp(`className="([^"]*\\b${name}\\b[^"]*)"`),
  );
  assert.ok(match, `Missing actual dashboard class: ${name}`);
  return match[1];
};
const classes = Object.fromEntries(
  ["container", "grid", "calendar", "side"].map((name) => [
    name,
    classFor(`teacher-dashboard-${name}`),
  ]),
);
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import Calendar from './src/pages/teacher/components/TeacherCalendarSection';
const classes = ${JSON.stringify(classes)};
function App() {
  const ref = React.useRef(null);
  const [populated,setPopulated] = React.useState(false);
  const [filter,setFilter] = React.useState('all');
  const day = new Date().toISOString().slice(0,10);
  const events = populated ? [{id:'synthetic',title:'긴 한글 학사 일정 이름으로 너비 확인',start:day,eventType:'event',targetType:'common'}] : [];
  return <>
    <button className="m-4 min-h-11 rounded-lg border px-4" onClick={()=>setPopulated(value=>!value)}>합성 데이터 전환</button>
    <div className={classes.container}><h1 className="mb-4 text-xl font-bold">대시보드 너비 검증</h1>
      <div className={classes.grid}><div className={classes.calendar}>
        <Calendar events={events} calendarRef={ref} filterClass={filter} availableClassTargets={[]} onFilterChange={setFilter} onDateClick={()=>{}} onDateDoubleClick={()=>{}} onEventClick={()=>{}} onSearchClick={()=>{}} />
      </div><div className={classes.side}><section className="rounded-xl border bg-white p-6">{populated?'학교 배너 및 위스 순위':'표시할 위스 순위가 없습니다.'}</section></div></div>
    </div>
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
`;
const bundled = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  metafile: true,
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "synthetic-calendar-io",
      setup(api) {
        api.onResolve({ filter: /firebase\/firestore$|\/firebase$/ }, () => ({
          path: "calendar-io",
          namespace: "fixture",
        }));
        api.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `export const db={}; export const doc=(...args)=>args; const snapshot={exists:()=>false,data:()=>({})}; export const getDoc=async()=>snapshot; export const onSnapshot=(ref,callback)=>{callback(snapshot);return ()=>{};};`,
          loader: "js",
        }));
      },
    },
  ],
});
assert.ok(
  Object.keys(bundled.metafile.inputs).some((name) =>
    name.endsWith("TeacherCalendarSection.tsx"),
  ),
);
assert.ok(
  !Object.keys(bundled.metafile.inputs).some((name) =>
    /node_modules\/(?:@firebase|firebase)\//u.test(name),
  ),
);
const styles = await postcss([
  tailwindcss(require(resolve("tailwind.config.cjs"))),
]).process(
  readFileSync("src/assets/tailwind.css", "utf8").replace(
    /^@import[^\r\n]+/gmu,
    "",
  ),
  { from: resolve("src/assets/tailwind.css") },
);
const css = [
  styles.css,
  readFileSync("assets/css/style.css", "utf8"),
  readFileSync("src/assets/index.css", "utf8"),
]
  .join("\n")
  .replace(/^@import[^\r\n]+/gmu, "");
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'none'",
  );
  response.setHeader(
    "Content-Type",
    path === "/app.js"
      ? "text/javascript"
      : path === "/app.css"
        ? "text/css"
        : "text/html; charset=utf-8",
  );
  response.end(
    path === "/app.js"
      ? bundled.outputFiles[0].contents
      : path === "/app.css"
        ? css
        : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Westory 달력 너비 검증</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/`;
if (process.argv.includes("--serve-only"))
  console.log(JSON.stringify({ url, syntheticOnly: true }));
else {
  let browser;
  try {
    const { chromium } = await import("playwright-core");
    const executablePath = [
      process.env.WESTORY_PLAYWRIGHT_EXECUTABLE,
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    ].find((path) => path && existsSync(path));
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const rows = [];
    for (const width of [390, 768, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await page.locator(".fc-daygrid").waitFor();
      const measure = () =>
        page.evaluate(() => ({
          calendar: document
            .querySelector(".teacher-dashboard-calendar")
            .getBoundingClientRect().width,
          container: document
            .querySelector(".teacher-dashboard-container")
            .getBoundingClientRect().width,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }));
      const before = await measure();
      assert.equal(before.overflow, false, `${width}: no page overflow`);
      if (width >= 1280)
        assert.ok(
          before.calendar >= { 1280: 690, 1440: 785, 1920: 863 }[width],
          `${width}: preserve wide calendar`,
        );
      await page.getByRole("button", { name: "합성 데이터 전환" }).click();
      await page.getByRole("button", { name: "다음 달" }).click();
      await page.getByRole("button", { name: "목록", exact: true }).click();
      const after = await measure();
      assert.ok(
        Math.abs(after.calendar - before.calendar) < 1,
        `${width}: data/month/view must not shrink calendar`,
      );
      assert.equal(after.overflow, false);
      rows.push({ width, ...before });
    }
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({ suite: "dashboard-width", passed: true, rows }),
    );
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
}
