import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence = await fs.mkdtemp(
  path.join(os.tmpdir(), "westory-history-loading-"),
);
const service = `
export const qa=window.historyQa={calls:[],pending:[],holdQuestions:true,holdResults:false,holdTree:true,failQuestion:false,failResult:false,config:{year:'2026',semester:'2'},epoch:1,uid:'teacher'};
const pause=kind=>qa['hold'+kind]?new Promise(resolve=>qa.pending.push({kind,resolve})):Promise.resolve();
qa.release=kind=>{qa['hold'+kind]=false;const ready=qa.pending.filter(p=>p.kind===kind);qa.pending=qa.pending.filter(p=>p.kind!==kind);ready.forEach(p=>p.resolve())};
export const useAuth=()=>({config:qa.config,currentUser:{uid:qa.uid},authGeneration:qa.epoch});
export const db={};
export const collection=(_,path)=>({path});
export const doc=(_,path,id)=>({path:path+'/'+id});
export const documentId=()=> '__name__';
export const where=(field,op,value)=>({field,op,value});
export const query=(ref,...filters)=>({...ref,filters});
const snap=rows=>({forEach:fn=>rows.forEach(([id,data])=>fn({id,data:()=>data}))});
export async function getDoc(ref){qa.calls.push({kind:'tree',path:ref.path});await pause('Tree');return {exists:()=>true,data:()=>({tree:[]})}}
export async function getDocs(ref){
 const isQuestion=ref.path.endsWith('quiz_questions'),kind=isQuestion?'questions':'results';
 const ids=isQuestion?ref.filters[0].value:[],uid=isQuestion?'':ref.filters[0].value;
 qa.calls.push({kind,path:ref.path,ids,uid});
 if(isQuestion){await pause('Questions');if(qa.failQuestion){qa.failQuestion=false;throw Error('Synthetic detail failure')}
 return snap(ids.map(id=>[id,{question:'현재 문항 '+id,answer:'현재 정답',explanation:'현재 해설'}]));}
 const label=(ref.path==='quiz_results'?'legacy':ref.path.includes('/2027/')?'next':uid);
 const rows=Array.from({length:25},(_,i)=>['r'+i,{uid,unitId:label+'-u'+i,category:'formative',score:80-i,timestamp:{seconds:1000-i},details:Array.from({length:20},(_,j)=>({id:label+'-q'+(i*20+j),u:'선택',correct:j%2===0}))}]);
 rows.push(['frozen',{uid,unitId:label+'-frozen',category:'formative',score:100,timestamp:{seconds:1},details:[{id:'frozen-q',correct:true,u:'응시 정답'}],questionSnapshots:[{id:'frozen-q',question:'응시 당시 문항',answer:'응시 당시 정답',explanation:'응시 당시 해설'}]}]);
 await pause('Results');if(qa.failResult){qa.failResult=false;throw Error('Synthetic list failure')}return snap(rows);
}
`;
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{StudentQuizHistoryPanel}from './src/pages/teacher/components/StudentHistoryModal';import{qa}from'fixture:service';
function App(){const[props,setProps]=useState({studentId:'student-a',studentName:'합성 학생',readScope:'history'});qa.render=next=>setProps(p=>({...p,...next}));return <div style={{height:'90vh'}}><StudentQuizHistoryPanel {...props}/></div>}createRoot(document.getElementById('root')).render(<App/>);`;
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd() },
  bundle: true,
  write: false,
  metafile: true,
  platform: "browser",
  outdir: "fixture",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "synthetic-history",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^fixture:service$|(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/firebase$|^firebase\/firestore$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "js",
        }));
      },
    },
  ],
});
assert(
  !Object.keys(built.metafile.inputs).some((name) =>
    /node_modules[\\/](@firebase|firebase)[\\/]/.test(name),
  ),
  "Fixture must not contain Firebase",
);
const js = built.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css =
  built.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const server = http.createServer((request, response) => {
  const resources = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  };
  const [type, body] = resources[request.url] || [
    "text/html",
    '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>:root{--ws-text:#111827;--ws-text-muted:#64748b;--ws-border:#e2e8f0;--ws-primary:#2563eb;--ws-surface:#fff;--ws-primary-soft:#eff6ff;--ws-bg:#f8fafc;--ws-accent:#f59e0b;--ws-border-blue:#bfdbfe}body{margin:0;padding:12px}</style><div id="root"></div><script src="/fixture.js"></script></html>',
  ];
  response.setHeader("content-type", type + ";charset=utf-8");
  response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const errors = [],
  external = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (
      route.request().url().startsWith(origin) ||
      route.request().url().startsWith("data:")
    )
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  const record = (unit) =>
    page
      .getByRole("button")
      .filter({ has: page.getByText(unit, { exact: true }) });
  const count = () =>
    page.evaluate(
      () => window.historyQa.calls.filter((c) => c.kind === "questions").length,
    );
  await page.goto(origin);
  await record("student-a-u0").waitFor();
  await page.getByRole("status", { name: "처리 중", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      window.historyQa.calls.filter((c) => c.kind === "questions").length === 2,
  );
  assert.equal(await page.getByText("26회 응시", { exact: true }).count(), 1);
  assert.equal(
    await count(),
    2,
    "Only selected 20 questions, not all 500, are fetched",
  );
  await page.screenshot({
    path: path.join(evidence, "history-loading-1280.png"),
    fullPage: true,
  });
  await record("student-a-u1").click();
  await page.waitForFunction(
    () =>
      window.historyQa.calls.filter((c) => c.kind === "questions").length === 4,
  );
  await record("student-a-u0").click();
  assert.equal(
    await count(),
    4,
    "Returning during an in-flight read shares its requests",
  );
  await page.evaluate(() => window.historyQa.release("Questions"));
  await page.getByText("현재 문항 student-a-q0", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.historyQa.pending.some((p) => p.kind === "Tree"),
    ),
    true,
    "List/details do not await optional labels",
  );
  await record("student-a-u1").click();
  await page.getByText("현재 문항 student-a-q20", { exact: true }).waitFor();
  assert.equal(await count(), 4);
  await record("student-a-u0").click();
  await page.getByText("현재 문항 student-a-q0", { exact: true }).waitFor();
  assert.equal(await count(), 4, "Revisiting a record reuses scoped memory");
  await record("student-a-frozen").click();
  await page.getByText("응시 당시 문항", { exact: true }).waitFor();
  assert.equal(await count(), 4, "Frozen snapshot never reads current bank");
  await page.getByRole("button").filter({ hasText: "응시 당시 문항" }).click();
  await page.getByText("응시 당시 정답", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.historyQa.failQuestion = true;
  });
  await record("student-a-u2").click();
  await page.getByRole("alert").waitFor();
  assert(
    await record("student-a-u0").isVisible(),
    "Detail failure preserves result list",
  );
  await page.getByRole("button", { name: "다시 조회", exact: true }).click();
  await page.getByText("현재 문항 student-a-q40", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.historyQa.holdResults = true;
  });
  await page.getByRole("button", { name: "이전 기록", exact: true }).click();
  await page.getByRole("status", { name: "처리 중", exact: true }).waitFor();
  await page.evaluate(() =>
    window.historyQa.render({ studentId: "student-b" }),
  );
  await page.evaluate(() => window.historyQa.release("Results"));
  await record("student-b-u0").waitFor();
  assert.equal(
    await record("legacy-u0").count(),
    0,
    "Late source/student responses are discarded",
  );
  assert.equal(await record("student-a-u0").count(), 0);
  await page.evaluate(() => {
    window.historyQa.holdQuestions = true;
  });
  await record("student-b-u1").click();
  await page.getByRole("status", { name: "처리 중", exact: true }).waitFor();
  await page.evaluate(() => {
    window.historyQa.config = { year: "2027", semester: "1" };
    window.historyQa.render({});
  });
  await record("next-u0").waitFor();
  await page.evaluate(() => window.historyQa.release("Questions"));
  await page.getByText("현재 문항 next-q0", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("현재 문항 student-b-q20", { exact: true }).count(),
    0,
    "Semester switch rejects late detail",
  );
  await page.evaluate(() =>
    window.historyQa.render({
      initialFilter: { unitId: "next-u3", category: "formative" },
    }),
  );
  await record("next-u3").waitFor();
  await page.getByText("현재 문항 next-q60", { exact: true }).waitFor();
  assert.equal(
    await record("next-u0").count(),
    0,
    "Parent filter resets before old records can show",
  );
  await page.evaluate(() => {
    window.historyQa.failResult = true;
    window.historyQa.render({ studentId: "retry-student" });
  });
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "다시 조회", exact: true }).click();
  await record("next-u3").waitFor();
  await page.evaluate(() => {
    window.historyQa.epoch++;
    window.historyQa.render({});
  });
  await record("next-u3").waitFor();
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: path.join(evidence, `history-${width}.png`),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "No horizontal overflow",
    );
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS student history: selected-only reads, cache, snapshots, delayed labels, failure retry, source/student/semester/filter guards, responsive loading. Evidence: " +
      evidence,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
