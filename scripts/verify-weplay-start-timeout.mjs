/** Actual student/teacher pages and launch controls; synthetic transport only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url),
  { build } = require("esbuild");
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
const core = require(path.join(root, "functions/weplayCore.js"));
const file = (name) =>
  JSON.stringify(path.join(root, name).replaceAll("\\", "/"));
const service = `
const params=new URLSearchParams(location.search);
export let config={year:'2026',semester:'2'};
export const userData={role:params.has('teacher')?'teacher':'student',name:'합성 검증',weplayGuideCompleted:true};
export const auth={currentUser:{uid:'qa-timeout',email:'qa@example.invalid'}};
export const useAuth=()=>({config,currentUser:auth.currentUser,userData,menuConfig:null});
export const changeScope=()=>{config={...config,semester:config.semester==='2'?'1':'2'};};
const settings=${JSON.stringify(core.DEFAULT_GAME_SETTINGS)},policy=${JSON.stringify(core.DEFAULT_POLICY)};
const lessons=[{unitId:'qa',title:'수군',isVisibleToStudents:true,words:['이순신','거북선','판옥선'],wordCount:3}];
const qa=window.startQA={calls:[],hold:{},releases:{},rejects:{},sessions:{},fail:{}};
if(params.get('hold'))qa.hold[params.get('hold')]=1;
const respond=(name,data,index)=>{
 if(name==='getWeplayLobby')return {gameEnabled:!(params.has('staleDisabled')&&index===0),policy,balance:100,dailyRemaining:5,dailyUsed:0,lessons,wordCount:3,difficulties:settings.difficulties,challengeDifficulties:settings.difficulties,wordCountsByDifficulty:{mild:3,medium:3,spicy:3},challengeWordCountsByDifficulty:{mild:3,medium:3,spicy:3},activeSession:params.has('resume')&&!qa.completed?{id:'resumed-session',mode:'practice',difficulty:'mild',status:'active'}:null,records:[],period:null,rankingByDifficulty:{mild:[],medium:[],spicy:[]},serverNowMs:Date.now()};
 if(name==='getWeplayManagement')return {settings:structuredClone(settings),lessons,availableWordCount:3,previewWordCount:3};
 if(name==='startWeplayGame'||name==='previewWeplayGame'){const key=data.requestKey||'preview-'+index;return qa.sessions[key]||=( {id:'session-'+index,mode:data.mode||'practice',difficulty:data.difficulty,status:'active'} );}
 throw new Error('Unexpected callable '+name);
};
export const getHttpsCallable=async name=>async data=>{
 const index=qa.calls.length;qa.calls.push({name,data:structuredClone(data)});
 const result=respond(name,data,index);
 if(qa.hold[name]){qa.hold[name]--;await new Promise((resolve,reject)=>{qa.releases[index]=resolve;qa.rejects[index]=reject;});}
 if(qa.fail[name]){const code=qa.fail[name];delete qa.fail[name];throw Object.assign(new Error('합성 요청 거절'),{code});}
 return {data:result};
};
export const getHistoryDictionaryCallable=getHttpsCallable;
export const db={};
export const getFirebaseStorage=async()=>({});
`;
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import Student from ${file("src/pages/student/Weplay.tsx")};import Teacher from ${file("src/pages/teacher/ManageWeplay.tsx")};
import {AppToastProvider} from ${file("src/components/common/AppToastProvider.tsx")};
import {changeScope} from 'fixture:service';
const teacher=new URLSearchParams(location.search).has('teacher');
function App(){const[visible,setVisible]=useState(true),[tick,setTick]=useState(0);window.startQA.toggle=()=>setVisible(v=>!v);window.startQA.scope=()=>{changeScope();setTick(v=>v+1);};return <MemoryRouter initialEntries={[(teacher?'/teacher':'/student')+'/weplay?game=history-rain'+(teacher?'&view=preview':'')]}><AppToastProvider><div data-tick={tick}>{visible&&(teacher?<Teacher/>:<Student/>)}</div></AppToastProvider></MemoryRouter>;}
createRoot(document.getElementById('root')).render(<App/>);
`;
const stubs = {
  HistoryRainGame:
    'export default ({session,onComplete})=><div><output id="qa-session">{session.id}</output><button id="qa-finish" onClick={()=>{window.startQA.completed=true;onComplete({sessionId:session.id,mode:session.mode,difficulty:session.difficulty,score:1,correctCount:1,totalWords:3,missedWords:[],reward:0,cost:0,netWis:0,balance:100});}}>완료</button></div>;',
  WeplayStudioIntro:
    'export default ({onComplete})=><button id="qa-intro" onClick={onComplete}>인트로 완료</button>;',
  useWeplayGuide:
    "export default ()=>({open:false,openGuide(){},finishGuide(){},closeForNow(){}});",
  useWeplayMusic: "export default ()=>({start(){},toggle(){},enabled:false});",
  WeplayMusicButton: "export default ()=>null;",
  WeplayGuide: "export default ()=>null;",
  YutGameEntry: "export default ()=>null;",
  YutManagement: "export default ()=>null;",
  PortalWorkspace: "export default ({children})=><div>{children}</div>;",
  weplayAssets: "export const preloadWeplayAssets=()=>{};",
  weplayPreview: "export const createWeplayPreviewTransport=()=>({});",
};
const bundled = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "weplay-start-timeout.js"),
  external: ["/assets/*"],
  loader: { ".svg": "dataurl", ".png": "dataurl", ".webp": "dataurl" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "synthetic-boundaries",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^fixture:|(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/firebase$|(?:^|\/)historyDictionarySession$|^\.\/firebase$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onResolve(
          {
            filter: new RegExp(
              "(?:^|/)(?:" + Object.keys(stubs).join("|") + ")$",
            ),
          },
          (args) => ({ path: args.path.split("/").at(-1), namespace: "stub" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "tsx",
          resolveDir: root,
        }));
        plugin.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
          contents: "import React from 'react';" + stubs[args.path],
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundled.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css =
  bundled.outputFiles
    .find((f) => f.path.endsWith(".css"))
    ?.text.replace(/@import\s+[^;]+;/g, "") || "";
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/qa.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(js);
  } else if (pathname === "/qa.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
  } else if (pathname.startsWith("/assets/")) {
    res.statusCode = 404;
    res.end();
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="/qa.css"><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>',
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const errors = [],
  checks = [];
const open = async (query = "") => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === base
      ? route.continue()
      : route.abort(),
  );
  await page.clock.install({ time: new Date("2026-10-18T08:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-18T08:00:01Z"));
  await page.goto(base + "/?" + query);
  await page.waitForFunction(() => window.startQA?.calls.length > 0);
  return page;
};
const launch = (page) => page.locator(".weplay-start");
const intro = async (page, waitForReady = true) => {
  if (waitForReady)
    await page.waitForFunction(() =>
      document.querySelector("#qa-intro, .weplay-start, #qa-session"),
    );
  if (await page.locator("#qa-intro").count())
    await page.locator("#qa-intro").click();
};
const count = (page, name) =>
  page.evaluate(
    (name) => window.startQA.calls.filter((c) => c.name === name).length,
    name,
  );
const waitIdle = (page) =>
  page.waitForFunction(() => !document.querySelector(".weplay-game-loading"));
try {
  for (const teacher of [false, true]) {
    const name = teacher ? "getWeplayManagement" : "getWeplayLobby";
    const page = await open(
      (teacher ? "teacher&" : "") + "hold=" + name + "&staleDisabled",
    );
    await intro(page, false);
    await page.clock.runFor(15010);
    await page.getByRole("button", { name: "다시 불러오기" }).waitFor();
    await page.getByRole("button", { name: "다시 불러오기" }).click();
    await intro(page);
    await launch(page).waitFor();
    assert.equal(await launch(page).isEnabled(), true);
    await page.evaluate(() => window.startQA.releases[0]());
    await page.clock.runFor(30);
    assert.equal(await launch(page).isEnabled(), true);
    assert.equal(await count(page, name), 2);
    checks.push(
      (teacher ? "teacher" : "student") + " read timeout/retry/stale response",
    );
    await page.close();
  }
  {
    const page = await open();
    await intro(page);
    await page.evaluate(() => (window.startQA.hold.startWeplayGame = 1));
    await launch(page).click();
    await page.locator(".weplay-game-loading").waitFor();
    await launch(page).dispatchEvent("click");
    assert.equal(await count(page, "startWeplayGame"), 1);
    await page.clock.runFor(15010);
    await waitIdle(page);
    assert.equal(await launch(page).isEnabled(), true);
    await page.getByRole("button", { name: "도전하기" }).click();
    await page.getByRole("button", { name: "매운맛", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "연습하기" })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "착한맛", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.evaluate(() => window.startQA.releases[1]());
    await page.clock.runFor(30);
    assert.equal(await page.locator("#qa-session").count(), 0);
    await launch(page).click();
    await page.locator("#qa-session").waitFor();
    const calls = await page.evaluate(() =>
      window.startQA.calls.filter((c) => c.name === "startWeplayGame"),
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].data, calls[1].data);
    checks.push(
      "student duplicate guard, 15s unlock, frozen retry payload/key, late success ignored",
    );
    await page.close();
  }
  {
    const page = await open();
    await intro(page);
    await page.evaluate(
      () =>
        (window.startQA.fail.startWeplayGame = "functions/failed-precondition"),
    );
    await launch(page).click();
    await waitIdle(page);
    await page.getByRole("button", { name: "도전하기" }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "도전하기" })
        .getAttribute("aria-pressed"),
      "true",
    );
    await launch(page).click();
    await page.locator("#qa-session").waitFor();
    const calls = await page.evaluate(() =>
      window.startQA.calls.filter((c) => c.name === "startWeplayGame"),
    );
    assert.notEqual(calls[0].data.requestKey, calls[1].data.requestKey);
    assert.equal(calls[1].data.mode, "challenge");
    checks.push(
      "definitive student rejection allows changed settings/new request",
    );
    await page.close();
  }
  {
    const page = await open("teacher");
    await intro(page);
    await page.evaluate(() => (window.startQA.hold.previewWeplayGame = 1));
    await launch(page).click();
    await page.locator(".weplay-game-loading").waitFor();
    await launch(page).dispatchEvent("click");
    assert.equal(await count(page, "previewWeplayGame"), 1);
    await page.clock.runFor(15010);
    await waitIdle(page);
    await launch(page).click();
    await page.locator("#qa-session").waitFor();
    const current = await page.locator("#qa-session").textContent();
    await page.evaluate(() => window.startQA.releases[1]());
    await page.clock.runFor(30);
    assert.equal(await page.locator("#qa-session").textContent(), current);
    checks.push(
      "teacher preview duplicate guard/timeout/retry rejects old success",
    );
    await page.close();
  }
  for (const teacher of [false, true]) {
    const page = await open(teacher ? "teacher" : "");
    await intro(page);
    const name = teacher ? "previewWeplayGame" : "startWeplayGame";
    await page.evaluate((name) => (window.startQA.hold[name] = 1), name);
    await launch(page).click();
    await page.locator(".weplay-game-loading").waitFor();
    await page.evaluate(() => window.startQA.toggle());
    await page.waitForFunction(
      () => !document.querySelector(".weplay-game-frame"),
    );
    await page.evaluate(() => window.startQA.toggle());
    await intro(page);
    await launch(page).waitFor();
    await page.evaluate(() => window.startQA.releases[1]());
    await page.clock.runFor(30);
    assert.equal(await page.locator("#qa-session").count(), 0);
    assert.equal(await launch(page).isEnabled(), true);
    checks.push(
      (teacher ? "teacher" : "student") + " unmount/reentry ignores old start",
    );
    await page.close();
  }
  for (const teacher of [false, true]) {
    const page = await open(teacher ? "teacher" : "");
    await intro(page);
    const name = teacher ? "previewWeplayGame" : "startWeplayGame";
    await page.evaluate((name) => (window.startQA.hold[name] = 1), name);
    await launch(page).click();
    await page.locator(".weplay-game-loading").waitFor();
    await page.evaluate(() => window.startQA.scope());
    await launch(page).waitFor();
    await waitIdle(page);
    await page.evaluate(() => window.startQA.releases[1]());
    await page.clock.runFor(30);
    assert.equal(await page.locator("#qa-session").count(), 0);
    assert.equal(await launch(page).isEnabled(), true);
    checks.push(
      (teacher ? "teacher" : "student") + " semester change ignores old start",
    );
    await page.close();
  }
  {
    const page = await open("resume");
    await page.locator("#qa-session").waitFor();
    assert.equal(await page.locator("#qa-intro").count(), 0);
    await page.locator("#qa-finish").click();
    await waitIdle(page);
    assert.equal(await page.locator("#qa-intro").count(), 0);
    assert.equal((await page.locator(".weplay-result").count()) > 0, true);
    checks.push("restored student session settles without replaying intro");
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
