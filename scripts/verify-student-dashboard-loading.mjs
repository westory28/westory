import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/pages/student/Dashboard.tsx", "utf8");
const tree = ts.createSourceFile(
  "Dashboard.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let loader;
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "load")
    loader = node.initializer.getText(tree);
  ts.forEachChild(node, visit);
};
visit(tree);
assert.ok(loader);
const compiled = ts.transpileModule(`const load = ${loader}; return load;`, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
class W8DomainError extends Error {}
const harness = () => {
  const request = deferred();
  const values = { loading: false, events: [], loadedScope: "", error: null };
  const loadSequence = { current: 0 };
  const calls = [];
  const context = {
    useCallback: (callback) => callback,
    config: { year: "2026", semester: "2" },
    configReady: true,
    currentUser: { uid: "student-a" },
    studentClassKey: "3-1",
    dashboardScope: "student-a/2026/2/3-1",
    loadSequence,
    W8DomainError,
    getW8DomainState: (query) => {
      calls.push(query);
      return request.promise;
    },
    getKoreanPublicHolidays: async () => [],
    projectScheduleEvent: (event) => event,
    mergeEventsWithKoreanPublicHolidays: (events) => events,
    console: { error() {} },
  };
  for (const key of [
    "Loading",
    "Error",
    "Events",
    "LoadedScope",
    "DetailEvent",
    "IsSearchOpen",
  ])
    context["set" + key] = (value) => {
      values[key[0].toLowerCase() + key.slice(1)] = value;
    };
  const run = new Function(...Object.keys(context), compiled)(
    ...Object.values(context),
  );
  return { run, request, values, loadSequence, calls };
};
const normal = harness();
const work = normal.run();
assert.equal(normal.values.loading, true);
assert.deepEqual(normal.calls[0], {
  config: { year: "2026", semester: "2" },
  domain: "SCHEDULE",
  audience: "student",
  studentUid: "student-a",
  source: "CURRENT",
});
normal.request.resolve({
  semesterId: "2026-2",
  scheduleEvents: [
    { status: "ACTIVE", title: "현재 일정" },
    { status: "CANCELLED", title: "취소 일정" },
  ],
});
await work;
assert.equal(normal.values.loading, false);
assert.equal(normal.values.loadedScope, "student-a/2026/2/3-1");
assert.deepEqual(
  normal.values.events.map((event) => event.title),
  ["현재 일정"],
);
const denied = harness();
const deniedWork = denied.run();
const denial = new W8DomainError("허용되지 않은 조회입니다.");
denied.request.reject(denial);
await deniedWork;
assert.equal(denied.values.error, denial);
assert.equal(denied.values.events.length, 0);
assert.equal(denied.values.loadedScope, "");
for (const outcome of ["success", "error"]) {
  const stale = harness();
  const staleWork = stale.run();
  stale.loadSequence.current++;
  const before = structuredClone(stale.values);
  if (outcome === "success")
    stale.request.resolve({
      semesterId: "2026-1",
      scheduleEvents: [{ status: "ACTIVE", title: "이전 학생 일정" }],
    });
  else stale.request.reject(new W8DomainError("이전 요청 오류"));
  await staleWork;
  assert.deepEqual(
    stale.values,
    before,
    "old scope results never change data, errors, or loading state",
  );
}
assert.match(source, /CalendarSection\.preload\(\)\.catch/);
assert.doesNotMatch(source, /if \(loading\) return <StatePanel/);
assert.match(source, /loadedScope !== dashboardScope/);
console.log(
  JSON.stringify({
    suite: "student-dashboard-loading",
    passed: true,
    scenarios: 4,
    networkRequests: 0,
    writes: 0,
  }),
);

if (process.argv.includes("--browser")) {
  const { build } = await import("esbuild");
  const { chromium } = await import("playwright-core");
  const { createServer } = await import("node:http");
  const { mkdtempSync, writeFileSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, basename } = await import("node:path");
  const root = process.cwd().replaceAll("\\", "/");
  const output = mkdtempSync(join(tmpdir(), "westory-student-dashboard-"));
  const fixture = join(output, "fixture.tsx");
  writeFileSync(
    fixture,
    `
import React from '${root}/node_modules/react/index.js';
const initial={config:{year:'2026',semester:'2'},configReady:true,currentUser:{uid:'student-a'},userData:{uid:'student-a',name:'합성 학생',grade:'3',class:'1'},interfaceConfig:{}};
const Context=React.createContext(initial);export const useAuth=()=>React.useContext(Context);
const state=window.fixture={requests:[],rankings:[],finish(index,kind='success') {const request=this.requests[index];if(!request)throw Error('Missing request');if(kind==='error')request.reject(new W8DomainError('PERMISSION','현재 일정에 접근할 수 없습니다.'));else request.resolve({semesterId:request.input.config.year+'-'+request.input.config.semester,scheduleEvents:kind==='empty'?[]:[{eventId:'event-'+index,title:'합성 일정 '+index,status:'ACTIVE',startAt:new Date().toISOString(),endAt:new Date().toISOString(),classIds:[],sourceReference:'',eventType:'SCHOOL'}]});}};
export function Provider({children}){const [value,setValue]=React.useState(initial);state.setScope=(uid,semester)=>setValue({...initial,config:{year:'2026',semester},currentUser:{uid},userData:{...initial.userData,uid}});return <Context.Provider value={value}>{children}</Context.Provider>;}
export class W8DomainError extends Error{constructor(kind,message){super(message);this.kind=kind;}}
export const getW8DomainState=input=>new Promise((resolve,reject)=>state.requests.push({input,resolve,reject}));
export const toW8StatePanelState=error=>error.kind==='PERMISSION'?'PERMISSION':'ERROR';
export const toW8LocalDateTimeInput=value=>value;
export const getStudentClassKey=(grade,schoolClass)=>grade+'-'+schoolClass;
export const getKoreanPublicHolidays=async()=>[];
export const mergeEventsWithKoreanPublicHolidays=events=>events;
export const loadHallOfFameRecognition=async()=>null;export const markHallOfFameRecognitionSeen=()=>{};
export const readSiteSettingDoc=async()=>null;
export const db={};export const doc=()=>({});export const onSnapshot=(_ref,next)=>{queueMicrotask(()=>next({exists:()=>false,data:()=>undefined}));return()=>{};};
export default function Ranking(){const {currentUser,config}=useAuth();React.useEffect(()=>{state.rankings.push(currentUser.uid+'/'+config.semester);},[]);return <section className="rounded-xl border border-gray-200 bg-white p-4"><h2 className="text-lg font-bold">위스 순위</h2><p className="mt-4">일정 조회와 별도로 준비한 합성 순위입니다.</p></section>;}
`,
  );
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import Dashboard from './src/pages/student/Dashboard';import {Provider} from '${fixture.replaceAll("\\", "/")}';createRoot(document.getElementById('root')).render(<HashRouter><Provider><Dashboard/></Provider></HashRouter>);`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    outdir: output,
    entryNames: "app",
    splitting: true,
    platform: "browser",
    format: "esm",
    metafile: true,
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env": "{}",
    },
    plugins: [
      {
        name: "isolated-student-dashboard",
        setup(api) {
          api.onResolve(
            {
              filter:
                /AuthContext$|\/firebase$|firebase\/firestore$|\/w8Domains$|\/koreanPublicHolidays$|\/WisRankingPanel$|\/visibleSchedule$|\/wisHallOfFameRecognition$|\/siteSettings$/,
            },
            () => ({ path: fixture }),
          );
        },
      },
    ],
  });
  const inputs = Object.keys(bundle.metafile.inputs);
  assert.ok(
    inputs.some((file) =>
      file.endsWith("student/components/CalendarSection.tsx"),
    ),
  );
  assert.ok(
    !inputs.some((file) => /node_modules\/(?:@firebase|firebase)\//.test(file)),
  );
  const assets = new Map(
    bundle.outputFiles.map((file) => [
      "/" + basename(file.path),
      file.contents,
    ]),
  );
  const cssFile = readdirSync("dist/assets").find((name) =>
    /^main-.*\.css$/.test(name),
  );
  assert.ok(cssFile, "Build the app before browser QA");
  assets.set("/app.css", readFileSync(join("dist/assets", cssFile)));
  const fetched = [];
  const server = createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    fetched.push(pathname);
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'",
    );
    response.setHeader(
      "Content-Type",
      pathname.endsWith(".js")
        ? "text/javascript"
        : pathname.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    response.end(
      assets.get(pathname) ||
        '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>학생 대시보드 합성 검증</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  const checks = [];
  try {
    browser = await chromium.launch({
      ...(process.platform === "win32" ? { channel: "chrome" } : {}),
      headless: true,
    });
    for (const width of [390, 768, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 980 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.getByText("위스 순위", { exact: true }).waitFor();
      await page
        .getByText("학사 일정을 불러오는 중입니다.", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator(".fc").count(),
        0,
        "loading must not look like an empty schedule",
      );
      assert.ok(
        fetched.some((path) => path.includes("CalendarSection-")),
        "calendar chunk downloads before the schedule resolves",
      );
      assert.equal(
        await page.evaluate(() => window.fixture.rankings.length),
        1,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await page.screenshot({
        path: join(output, `loading-${width}.png`),
        fullPage: true,
      });
      await page.evaluate(() => window.fixture.finish(0));
      await page.locator(".fc").waitFor();
      await page.getByText("합성 일정 0", { exact: true }).first().waitFor();
      await page.screenshot({
        path: join(output, `ready-${width}.png`),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await page.evaluate(() => window.fixture.setScope("student-b", "1"));
      await page
        .getByText("학사 일정을 불러오는 중입니다.", { exact: true })
        .waitFor();
      assert.equal(
        await page.getByText("합성 일정 0", { exact: true }).count(),
        0,
      );
      await page.waitForFunction(() => window.fixture.requests.length === 2);
      await page.evaluate(() => window.fixture.setScope("student-c", "2"));
      await page.waitForFunction(() => window.fixture.requests.length === 3);
      await page.evaluate(() => window.fixture.finish(1));
      assert.equal(
        await page.locator(".fc").count(),
        0,
        "prior student/semester result stays hidden",
      );
      await page.evaluate(() => window.fixture.finish(2, "error"));
      await page
        .getByText("현재 일정에 접근할 수 없습니다.", { exact: true })
        .waitFor();
      assert.equal(await page.locator(".fc").count(), 0);
      await page.getByText("위스 순위", { exact: true }).waitFor();
      await page.screenshot({
        path: join(output, `permission-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "다시 불러오기", exact: true })
        .click();
      await page.waitForFunction(() => window.fixture.requests.length === 4);
      await page.evaluate(() => window.fixture.finish(3, "empty"));
      await page.locator(".fc").waitFor();
      assert.equal(
        await page.getByText("합성 일정 0", { exact: true }).count(),
        0,
      );
      assert.deepEqual(errors, []);
      checks.push({
        width,
        pageErrors: errors.length,
        scenarios: [
          "slow",
          "ready",
          "scope-change",
          "permission",
          "retry-empty",
        ],
      });
      await page.close();
    }
    console.log(
      JSON.stringify({
        suite: "student-dashboard-browser",
        passed: true,
        output,
        checks,
        firebaseIncluded: false,
        externalNetwork: "blocked by CSP",
      }),
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
