import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence = path.resolve(
  ".superloopy/sessions/loading-consistency/student",
);
await fs.mkdir(evidence, { recursive: true });
const service = `
export const qa=window.calendarQa={calls:[],pending:[],failure:new URLSearchParams(location.search).get('fail')||''};
const wait=async kind=>{qa.calls.push(kind);await new Promise(resolve=>qa.pending.push({kind,resolve}));if(qa.failure===kind)throw Error('Synthetic '+kind+' failure')};
qa.release=kind=>{const pending=qa.pending.filter(item=>item.kind===kind);qa.pending=qa.pending.filter(item=>item.kind!==kind);pending.forEach(item=>item.resolve())};
export const useAuth=()=>({user:{uid:'student'},menuConfig:{}});
export const db={};export const doc=(_,collection,id)=>({collection,id});
export const getDoc=async ref=>{const kind=ref.collection==='users'?'class':'config';await wait(kind);return{exists:()=>qa.failure!=='missing-'+kind,data:()=>kind==='config'?{year:'2026',semester:'2'}:{grade:'3',class:'1'}}};
export const loadVisibleCalendarEvents=async()=>{await wait('events');return[{id:'event',title:'합성 일정',start:'2026-11-10',eventType:'event'}]};
export const getKoreanPublicHolidays=async()=>{await wait('holidays');return[]};
export const mergeEventsWithKoreanPublicHolidays=events=>events;
export const getStudentMenuLabel=(_,__,label)=>label;
export const getScheduleEventColor=()=> '#2563eb';
export const getSchedulePeriodRangeLabel=()=>'';
export const useAttendanceDates=()=>({dates:[],loading:false,error:null,retry:()=>{}});
`;
const bundled = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import Calendar from './src/pages/student/Calendar';import{LoadingProvider}from'./src/components/common/LoadingState';function Fixture(){const[count,setCount]=React.useState(0);return <LoadingProvider><aside><button onClick={()=>setCount(count+1)}>외부 메뉴 {count}</button></aside><Calendar/></LoadingProvider>}createRoot(document.getElementById('root')).render(<Fixture/>);`,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  outfile: "fixture.js",
  loader: { ".webp": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "calendar-boundaries",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /(?:AuthContext|lib\/firebase|firebase\/firestore|koreanPublicHolidays|schedulePeriods|scheduleCategories|visibleSchedule|constants\/menus|useAttendanceDates)$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "js",
        }));
        plugin.onResolve({ filter: /StudentCalendarSection$/ }, () => ({
          path: "calendar-view",
          namespace: "view",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "view" }, () => ({
          contents:
            "import React from 'react';export default function Calendar({events}){return <div><button data-testid='calendar-inside'>일정 내부 작업</button><div data-testid='events'>{events.map(item=>item.title).join(',')}</div></div>}",
          loader: "jsx",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const js = bundled.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundled.outputFiles.find((file) => file.path.endsWith(".css")).text;
const server = http.createServer((request, response) => {
  if (request.url === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(js);
    return;
  }
  response.setHeader("Content-Type", "text/html;charset=utf-8");
  response.end(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [],
  external = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", (route) => {
  if (route.request().url().startsWith(origin)) return route.continue();
  external.push(route.request().url());
  return route.abort();
});
const overlay = () =>
  page.getByRole("status", { name: "처리 중", exact: true });
const release = async (kind) => {
  await page.waitForFunction(
    (kind) => window.calendarQa.pending.some((item) => item.kind === kind),
    kind,
  );
  await page.evaluate((kind) => window.calendarQa.release(kind), kind);
};
const checkPending = async () => {
  await overlay().waitFor();
  assert.equal(await overlay().count(), 1);
  assert.equal(await page.getByRole("status", { name: "처리 중" }).count(), 1);
  assert.equal(await page.locator(".ws-loading-screen").count(), 0);
  assert.equal(
    await page.locator("#root").evaluate((node) => node.inert),
    false,
  );
  const local = page.locator(
    '.ws-loading-container-overlay[data-loading-scope="container"]',
  );
  const bounds = await local.evaluate((node) => {
    const rect = node.getBoundingClientRect(),
      owner = node.parentElement.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      ownerX: owner.x,
      ownerY: owner.y,
      ownerWidth: owner.width,
      ownerHeight: owner.height,
      blur: getComputedStyle(node).backdropFilter,
    };
  });
  for (const dimension of ["x", "y", "width", "height"]) {
    const ownerKey = "owner" + dimension[0].toUpperCase() + dimension.slice(1);
    assert.ok(
      Math.abs(bounds[dimension] - bounds[ownerKey]) < 1,
      `Calendar overlay ${dimension} stays inside its owner`,
    );
  }
  assert.equal(bounds.blur, "blur(4px)");
  const outside = page.getByRole("button", { name: /^외부 메뉴/ });
  const before = await outside.innerText();
  await outside.click({ timeout: 2000 }).catch(async (error) => {
    await page.screenshot({
      path: path.join(evidence, "calendar-outside-blocked.png"),
    });
    const state = await page.evaluate(() => ({
      calls: window.calendarQa.calls,
      pending: window.calendarQa.pending.map((item) => item.kind),
      surfaces: [...document.querySelectorAll(".ws-loading-surface")].map(
        (node) => {
          const rect = node.getBoundingClientRect(),
            owner = node.parentElement;
          return {
            classes: node.className,
            ownerClasses: owner.className,
            position: getComputedStyle(node).position,
            ownerPosition: getComputedStyle(owner).position,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
          };
        },
      ),
    }));
    await fs.writeFile(
      path.join(evidence, "calendar-outside-blocked.json"),
      JSON.stringify(state, null, 2),
    );
    throw error;
  });
  assert.notEqual(
    await outside.innerText(),
    before,
    "outside menu remains operable while calendar is loading",
  );
  await assert.rejects(
    page.getByTestId("calendar-inside").click({ timeout: 200 }),
    /Timeout/,
    "only loading calendar content is locked",
  );
};
const results = [];
try {
  for (const failure of [
    "",
    "config",
    "class",
    "events",
    "holidays",
    "missing-config",
    "missing-class",
  ]) {
    await page.goto(`${origin}/?fail=${failure}`);
    await checkPending();
    await release("config");
    await checkPending();
    await release("class");
    const reachesEvents = ![
      "config",
      "class",
      "missing-config",
      "missing-class",
    ].includes(failure);
    if (reachesEvents) {
      await checkPending();
      await release("events");
      if (failure !== "events") {
        await checkPending();
        await release("holidays");
      }
    }
    await overlay().waitFor({ state: "detached" });
    assert.equal(await page.locator("#root").getAttribute("inert"), null);
    if (failure) {
      await page.getByRole("alert").waitFor();
      await page.evaluate(() => {
        window.calendarQa.failure = "";
      });
      await page
        .getByRole("button", { name: "다시 시도", exact: true })
        .click();
      await checkPending();
      await release("config");
      await release("class");
      await release("events");
      await release("holidays");
      await overlay().waitFor({ state: "detached" });
      assert.equal(await page.getByRole("alert").count(), 0);
    }
    assert.equal(await page.getByTestId("events").textContent(), "합성 일정");
    const calls = await page.evaluate(() => window.calendarQa.calls);
    assert.equal(
      calls.filter((kind) => kind === "config").length,
      failure ? 2 : 1,
    );
    assert.equal(
      calls.filter((kind) => kind === "class").length,
      failure ? 2 : 1,
    );
    assert.equal(
      calls.filter((kind) => kind === "events").length,
      failure && reachesEvents ? 2 : 1,
    );
    assert.equal(
      calls.filter((kind) => kind === "holidays").length,
      failure === "holidays" ? 2 : 1,
    );
    results.push({ failure: failure || "success", calls });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await page.screenshot({ path: path.join(evidence, "calendar-restored.png") });
  await fs.writeFile(
    path.join(evidence, "calendar-lifecycle.json"),
    JSON.stringify({ passed: true, results, errors, external }, null, 2),
  );
  console.log(
    "PASS student calendar: local bounds/blur, live outside menu, staged loading, 6 failure/missing-data paths, retry and exact read counts; external requests 0",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
