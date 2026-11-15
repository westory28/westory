/** Actual one-shot service/hook/entry, synthetic SDK/account, React StrictMode enabled. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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
const output = path.join(root, "output/rhythm-network-20261115");
await fs.mkdir(output, { recursive: true });
for (const file of [
  "src/lib/rhythmPublication.ts",
  "src/components/common/weplay/rhythm/useRhythmPublication.ts",
  "src/components/common/weplay/rhythm/RhythmGameEntry.tsx",
]) {
  const source = await fs.readFile(path.join(root, file), "utf8");
  assert.doesNotMatch(
    source,
    /\b(?:onSnapshot|setInterval|beforePlay|confirmRhythmPublication|subscribeRhythmPublication)\b/,
    `${file}: no live or gameplay verification`,
  );
}
const fixture = `
import React,{useSyncExternalStore}from'react';
const listeners=new Set();
const qa=window.rhythmNetworkQA={reads:[],transactionReads:0,queuedWrites:0,committedWrites:0,pending:[],hold:false,failure:'',cache:false,failCommit:false,document:undefined,audit:undefined,effectSetups:0,gameActions:[],toasts:[],
 account:{currentUser:{uid:'student-a',email:'2630001@yongshin-ms.ms.kr'},userData:{role:'student',registrationApprovalStatus:'APPROVED',enrollmentStatus:'active'},authPhase:'ready',authGeneration:1,configReady:true,menuConfigReady:true,config:{year:'2026',semester:'2'},menuConfig:{student:[],teacher:[]}}};
export const auth={currentUser:qa.account.currentUser};export const db={test:true};
export const useAuth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>qa.account);
qa.accountUpdate=value=>{qa.account={...qa.account,...value};auth.currentUser=qa.account.currentUser;listeners.forEach(fn=>fn())};
qa.setPublished=(enabled,revision=1)=>{qa.document={schemaVersion:1,enabled,revision,updatedAt:{toMillis:()=>revision}}};
const snapshot=data=>({metadata:{fromCache:qa.cache,hasPendingWrites:false},data:()=>data,exists:()=>!!data});
export const doc=(_db,...parts)=>({path:parts.join('/')});
export function getDocFromServer(ref){
 qa.reads.push({path:ref.path,uid:auth.currentUser?.uid});
 const value=qa.document?{...qa.document}:undefined;
 const error=qa.failure;qa.failure='';
 if(qa.hold)return new Promise((resolve,reject)=>qa.pending.push({resolve:(data=value)=>resolve(snapshot(data)),reject}));
 return error?Promise.reject(Object.assign(new Error('검증 실패'),{code:error})):Promise.resolve(snapshot(value));
}
export const serverTimestamp=()=>({toMillis:()=>Date.now()});
export async function runTransaction(_db,callback){
 const writes=[];
 const value=await callback({get:async()=>{qa.transactionReads++;return snapshot(qa.document?{...qa.document}:undefined)},set:(ref,data)=>{qa.queuedWrites++;writes.push({ref,data})}});
 if(qa.failCommit)throw new Error('검증용 저장 응답 실패');
 for(const {ref,data} of writes){if(ref.path.includes('rhythm_publication_audit'))qa.audit=data;else qa.document=data;qa.committedWrites++}
 return value;
}
export const useAppToast=()=>({showToast:value=>qa.toasts.push(value)});
export const InlineLoading=()=> <p>확인 중</p>;
export default function Game(props){qa.gameProps=Object.keys(props);return <div data-testid="local-game">{['시작','타격','일시정지','재개','다시하기'].map(action=><button key={action} onClick={()=>qa.gameActions.push(action)}>{action}</button>)}</div>}
`;
const harness = `
import React,{StrictMode,useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';
import usePublication from './src/components/common/weplay/rhythm/useRhythmPublication';
import Entry from './src/components/common/weplay/rhythm/RhythmGameEntry';
import {saveRhythmPublication} from './src/lib/rhythmPublication';
const qa=window.rhythmNetworkQA;
const timeouts=new Map(),set=window.setTimeout.bind(window),clear=window.clearTimeout.bind(window);
window.setTimeout=(callback,delay,...args)=>{const id=set(()=>{timeouts.delete(id);callback(...args)},delay);if(delay===8000)timeouts.set(id,()=>callback(...args));return id};
window.clearTimeout=id=>{timeouts.delete(id);clear(id)};
qa.expire=()=>{for(const[id,callback]of[...timeouts]){window.clearTimeout(id);callback()}};
qa.save=(enabled,revision)=>saveRhythmPublication(qa.account.config,enabled,revision);
function Probe({portal,enabled}){const access=usePublication(portal,enabled);qa.access=access;useEffect(()=>{qa.effectSetups++},[]);return <div><p data-testid="status">{access.status}</p><button onClick={access.retry}>다시 확인</button></div>}
function Harness(){const[props,setProps]=useState({mode:'probe',portal:'student',enabled:true,shown:true});qa.update=value=>setProps(previous=>({...previous,...value}));return props.shown?(props.mode==='entry'?<Entry portal={props.portal}/>:<Probe {...props}/>):<p>unmounted</p>}
createRoot(document.getElementById('root')).render(<StrictMode><MemoryRouter><Harness/></MemoryRouter></StrictMode>);
`;
const result = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  outfile: path.join(output, "fixture.js"),
  define: {
    "process.env.NODE_ENV": '"development"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "network-fixture",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)contexts\/AuthContext$|^\.\/firebase$|^firebase\/firestore$|(?:^|\/)AppToastProvider$|(?:^|\/)LoadingState$|^\.\/RhythmOpening$/,
          },
          () => ({ path: "fixture", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: fixture,
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = result.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css =
  result.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
const server = http.createServer((req, res) => {
  const script = req.url === "/qa.js",
    style = req.url === "/qa.css";
  res.setHeader(
    "Content-Type",
    script ? "text/javascript" : style ? "text/css" : "text/html",
  );
  res.end(
    script
      ? js
      : style
        ? css
        : '<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/qa.css"></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const errors = [],
  external = [],
  checks = [];
const page = await browser.newPage();
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", (route) => {
  if (route.request().url().startsWith(base)) return route.continue();
  external.push(route.request().url());
  return route.abort();
});
const status = (value) =>
  page
    .getByTestId("status")
    .filter({ hasText: new RegExp(`^${value}$`) })
    .waitFor();
const reads = () => page.evaluate(() => window.rhythmNetworkQA.reads.length);
const events = () =>
  page.evaluate(() => {
    for (let i = 0; i < 10; i++) {
      document.dispatchEvent(new Event("visibilitychange"));
      for (const type of ["online", "offline", "focus", "blur"])
        window.dispatchEvent(new Event(type));
    }
  });
try {
  await page.goto(base);
  await status("closed");
  assert.equal(await reads(), 1);
  assert.equal(
    await page.evaluate(() => window.rhythmNetworkQA.effectSetups),
    2,
    "StrictMode really replayed effects",
  );
  await events();
  assert.equal(await reads(), 1);
  checks.push(
    "StrictMode mount reads exactly once; visibility/network/focus events read zero",
  );
  await page.evaluate(() => window.rhythmNetworkQA.setPublished(true, 1));
  await page.getByRole("button", { name: "다시 확인" }).click();
  await status("open");
  assert.equal(await reads(), 2);
  await page.evaluate(() => window.rhythmNetworkQA.setPublished(false, 2));
  await events();
  await status("open");
  assert.equal(
    await reads(),
    2,
    "Server closure is not polled during an admitted visit",
  );
  await page.evaluate(() => window.rhythmNetworkQA.update({ shown: false }));
  await page.getByText("unmounted").waitFor();
  await page.evaluate(() => window.rhythmNetworkQA.update({ shown: true }));
  await status("closed");
  assert.equal(await reads(), 3);
  checks.push(
    "Closure applies on the next actual entry; explicit retry issues one read",
  );
  await page.evaluate(() => (window.rhythmNetworkQA.failure = "unavailable"));
  await page.getByRole("button", { name: "다시 확인" }).click();
  await status("error");
  assert.equal(await reads(), 4);
  await events();
  assert.equal(await reads(), 4);
  await page.evaluate(() => window.rhythmNetworkQA.setPublished(true, 3));
  await page.getByRole("button", { name: "다시 확인" }).click();
  await status("open");
  assert.equal(await reads(), 5);
  checks.push(
    "Read failure remains closed and needs an explicit retry; no automatic recovery request",
  );
  await page.evaluate(() => {
    const qa = window.rhythmNetworkQA;
    qa.hold = true;
    qa.accountUpdate({
      currentUser: { uid: "student-b", email: "2630002@yongshin-ms.ms.kr" },
    });
  });
  await status("checking");
  assert.equal(await reads(), 6);
  await page.evaluate(() =>
    window.rhythmNetworkQA.accountUpdate({
      currentUser: { uid: "student-c", email: "2630003@yongshin-ms.ms.kr" },
    }),
  );
  await status("checking");
  assert.equal(await reads(), 7);
  await page.evaluate(() => window.rhythmNetworkQA.pending.shift().resolve());
  await status("checking");
  await page.evaluate(() => {
    const qa = window.rhythmNetworkQA;
    qa.pending.shift().resolve();
    qa.hold = false;
  });
  await status("open");
  assert.equal(await reads(), 7);
  checks.push(
    "Each account boundary reads once; stale account responses cannot admit a new account",
  );
  await page.evaluate(() =>
    window.rhythmNetworkQA.accountUpdate({
      config: { year: "2027", semester: "1" },
    }),
  );
  await status("open");
  assert.equal(await reads(), 8);
  assert.equal(
    await page.evaluate(() => window.rhythmNetworkQA.reads.at(-1).path),
    "years/2027/semesters/1/rhythm_publication/gungdeok-rock",
  );
  await page.evaluate(() => {
    const qa = window.rhythmNetworkQA;
    qa.accountUpdate({
      config: {
        ...qa.account.config,
        studentMenuVisibility: { rhythm: false },
      },
    });
  });
  await status("closed");
  assert.equal(await reads(), 8);
  await page.evaluate(() => {
    const qa = window.rhythmNetworkQA;
    qa.accountUpdate({
      config: { ...qa.account.config, studentMenuVisibility: { rhythm: true } },
    });
  });
  await status("open");
  assert.equal(await reads(), 9);
  await page.evaluate(() =>
    window.rhythmNetworkQA.accountUpdate({ authPhase: "signed-out" }),
  );
  await status("closed");
  assert.equal(await reads(), 9);
  await page.evaluate(() =>
    window.rhythmNetworkQA.accountUpdate({
      authPhase: "ready",
      authGeneration: 2,
    }),
  );
  await status("open");
  assert.equal(await reads(), 10);
  checks.push(
    "Semester, permission restore and auth generation get fresh scoped admission; denied scopes read zero",
  );
  await page.evaluate(() => (window.rhythmNetworkQA.hold = true));
  await page.getByRole("button", { name: "다시 확인" }).click();
  await status("checking");
  assert.equal(await reads(), 11);
  await page.evaluate(() => window.rhythmNetworkQA.expire());
  await status("error");
  await events();
  assert.equal(await reads(), 11);
  await page.evaluate(() => {
    const qa = window.rhythmNetworkQA;
    qa.hold = false;
    qa.pending.shift().resolve();
  });
  await status("error");
  await page.getByRole("button", { name: "다시 확인" }).click();
  await status("open");
  assert.equal(await reads(), 12);
  checks.push("Timeout rejects late data and needs explicit retry");
  await page.evaluate(() => (window.rhythmNetworkQA.cache = true));
  await page.getByRole("button", { name: "다시 확인" }).click();
  await status("error");
  assert.equal(await reads(), 13);
  await page.evaluate(() => {
    const qa = window.rhythmNetworkQA;
    qa.cache = false;
    qa.update({ mode: "entry" });
  });
  await page.getByTestId("local-game").waitFor();
  assert.equal(await reads(), 14);
  assert.equal(
    await page.evaluate(() =>
      window.rhythmNetworkQA.gameProps.includes("beforePlay"),
    ),
    false,
  );
  for (const name of ["시작", "타격", "일시정지", "재개", "다시하기"])
    await page.getByRole("button", { name, exact: true }).click();
  await events();
  assert.equal(await reads(), 14);
  checks.push(
    "Entry passes no admission callback into the game; all local actions issue zero reads",
  );
  await page.evaluate(() => {
    const qa = window.rhythmNetworkQA;
    qa.setPublished(false, 4);
    qa.accountUpdate({
      currentUser: { uid: "teacher-a", email: "teacher@yongshin-ms.ms.kr" },
      userData: { role: "teacher" },
    });
    qa.update({ portal: "teacher" });
  });
  await page.getByText("학생 비공개", { exact: true }).waitFor();
  const teacherEntryReads = await reads();
  await page.getByRole("button", { name: "미리보기", exact: true }).click();
  await page.getByTestId("local-game").waitFor();
  for (const name of ["시작", "타격", "일시정지", "재개", "다시하기"])
    await page.getByRole("button", { name, exact: true }).click();
  assert.equal(await reads(), teacherEntryReads);
  await page
    .getByRole("button", { name: "학생에게 공개", exact: true })
    .click();
  await page.getByText("학생 공개 중", { exact: true }).waitFor();
  assert.equal(await reads(), teacherEntryReads);
  assert.deepEqual(
    await page.evaluate(() => {
      const q = window.rhythmNetworkQA;
      return [q.transactionReads, q.committedWrites];
    }),
    [1, 2],
  );
  await page.evaluate(() => window.rhythmNetworkQA.save(true, 5));
  assert.deepEqual(
    await page.evaluate(() => {
      const q = window.rhythmNetworkQA;
      return [q.transactionReads, q.committedWrites];
    }),
    [2, 2],
  );
  await page
    .getByRole("button", { name: "학생 공개 닫기", exact: true })
    .click();
  await page.getByText("학생 비공개", { exact: true }).waitFor();
  assert.equal(await reads(), teacherEntryReads);
  assert.deepEqual(
    await page.evaluate(() => {
      const q = window.rhythmNetworkQA;
      return [q.transactionReads, q.committedWrites];
    }),
    [3, 4],
  );
  checks.push(
    "Teacher preview reads zero; publish/close each use one transaction read plus two writes and no reread; unchanged save writes zero",
  );
  await page.evaluate(() => (window.rhythmNetworkQA.failCommit = true));
  await page
    .getByRole("button", { name: "학생에게 공개", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  assert.equal(await reads(), teacherEntryReads);
  await events();
  assert.equal(await reads(), teacherEntryReads);
  await page.evaluate(() => (window.rhythmNetworkQA.failCommit = false));
  await page.getByRole("button", { name: "다시 확인", exact: true }).click();
  await page.getByText("학생 비공개", { exact: true }).waitFor();
  assert.equal(await reads(), teacherEntryReads + 1);
  checks.push(
    "Failed teacher save does not refetch automatically; one explicit retry restores server state",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const counters = await page.evaluate(() => {
    const q = window.rhythmNetworkQA;
    return {
      entryReads: q.reads.length,
      transactionReads: q.transactionReads,
      queuedWrites: q.queuedWrites,
      committedWrites: q.committedWrites,
    };
  });
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify({ checks, counters, errors, external }, null, 2),
  );
  console.log(
    JSON.stringify(
      { passed: checks.length, checks, counters, errors, external },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
