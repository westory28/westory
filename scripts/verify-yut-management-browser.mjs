/** Actual publication gate, catalog and teacher management. Synthetic transport; game mount sentinel only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

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
const evidence = path.join(root, "output/yut-management-20261021");
await fs.mkdir(evidence, { recursive: true });
const modulePath = (value) =>
  JSON.stringify(path.join(root, value).replaceAll("\\", "/"));
const service = `
import {useSyncExternalStore} from 'react';
const params=new URLSearchParams(location.search), scenario=params.get('case')||'closed';
const listeners=new Set();
const qa=window.yutAccessQA={calls:[],enabled:scenario==='open'||scenario==='pending',hold:scenario==='pending',fail:scenario==='failure',missing:scenario==='missing',settings:{enabled:false,version:0,allowSolo:true,allowMultiplayer:true,allowPrivateRooms:true,defaultPlayerCount:4,throwSeconds:5,moveSeconds:25},rooms:[{id:'room-a',code:'AB2345',status:'playing',revision:4,hostUid:'student-a',createdAtMs:Date.now()-60000,expiresAtMs:Date.now()+60000,turnUid:'student-a',players:[{uid:'student-a',name:'검증 학생',role:'sa',classLabel:'3학년 2반',studentNumber:7,active:true},{uid:'student-b',name:'둘째 학생',role:'nong',classLabel:'3학년 2반',studentNumber:8,active:true}]}],auth:{config:{year:'2026',semester:'2'},currentUser:{uid:'qa-user',email:'qa@example.invalid'},userData:{role:scenario==='readonly'?'student':scenario==='denied'?'student':params.get('portal')==='student'?'student':'teacher',teacherPortalEnabled:scenario==='readonly',staffPermissions:scenario==='readonly'?['lesson_read']:[]}}};
qa.spectatorEvents=[];qa.activeSpectators=[];
qa.monitorSubscriptions=[];qa.monitorEvents=[];qa.pendingManagement=[];qa.managementReads=0;qa.maxManagementReads=0;qa.autoMonitorSignal=true;
qa.emitManagement=(server=true)=>qa.monitorSubscriptions.filter(item=>item.active).forEach(item=>{item.onConnectionChange?.(server);if(server)item.onChange();});
qa.failManagement=()=>qa.monitorSubscriptions.filter(item=>item.active).forEach(item=>item.onError(new Error('실시간 연결을 확인하지 못했습니다.')));
qa.releaseManagement=(index=0)=>qa.pendingManagement.splice(index,1)[0]?.resolve();
qa.setHidden=hidden=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));};
qa.rooms[0].expiresAtMs=Date.now()+3600000;
qa.changeAuth=next=>{qa.auth={...qa.auth,...next};listeners.forEach(fn=>fn());};
qa.rooms[0].standings=[{uid:'student-a',finishedPieces:1,totalPieces:2,progress:-11},{uid:'student-b',finishedPieces:0,totalPieces:2,progress:-16}];
qa.rooms[0].leadingUids=['student-a'];
export const useAuth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>qa.auth);
export async function getYutLobby(config){qa.calls.push({name:'getYutLobby',config:structuredClone(config)});const result={enabled:qa.enabled,settings:{...structuredClone(qa.settings),enabled:qa.enabled},room:null,classes:[],classId:'',serverNowMs:Date.now()};if(qa.hold){qa.hold=false;await new Promise(resolve=>qa.release=resolve);}if(qa.fail)throw Object.assign(new Error('연결을 확인해 주세요.'),{code:'functions/unavailable'});if(qa.missing)delete result.enabled;return result;}
export async function getYutManagement(config){qa.calls.push({name:'getYutManagement',config:structuredClone(config)});qa.managementReads++;qa.maxManagementReads=Math.max(qa.maxManagementReads,qa.managementReads);const result={settings:structuredClone(qa.settings),rooms:structuredClone(qa.rooms.filter(room=>['waiting','playing'].includes(room.status)&&room.expiresAtMs>Date.now()+120000)),truncated:false,serverNowMs:Date.now()+120000};try{if(qa.holdManagement){qa.holdManagement=false;await new Promise(resolve=>qa.pendingManagement.push({resolve}));}if(qa.fail)throw new Error('관리 정보를 확인하지 못했습니다.');return result;}finally{qa.managementReads--;}}
export function subscribeYutManagement(config,onChange,onError,onConnectionChange){const item={config:structuredClone(config),onChange,onError,onConnectionChange,active:true};qa.monitorSubscriptions.push(item);qa.monitorEvents.push({kind:'subscribe',config:item.config});queueMicrotask(()=>{if(item.active&&qa.autoMonitorSignal){onConnectionChange?.(true);onChange();}});return()=>{item.active=false;qa.monitorEvents.push({kind:'unsubscribe',config:item.config});};}
export async function saveYutSettings(config,data){qa.calls.push({name:'saveYutSettings',config:structuredClone(config),data});if(qa.fail)throw new Error('저장하지 못했습니다.');if(data.expectedVersion!==qa.settings.version)throw Object.assign(new Error('conflict'),{code:'functions/aborted'});const {expectedVersion,...options}=data;qa.settings={...qa.settings,...options,version:qa.settings.version+1,updatedAtMs:Date.now()};return {settings:structuredClone(qa.settings),serverNowMs:Date.now()};}
export async function commandYutRoom(config,data){qa.calls.push({name:'commandYutRoom',config:structuredClone(config),data});qa.rooms=qa.rooms.filter(room=>room.id!==data.roomId);return {room:null,serverNowMs:Date.now()};}
export const YUT_PRIVATE_DAILY_LIMIT=5;export const yutErrorMessage=error=>error.message;
export const WEPLAY_GAMES=[{id:'history-rain',name:'내가 충무공이라고?!'},{id:'joseon-yut',name:'마우저구 윷놀이'}];
`;
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,useNavigate,useSearchParams} from 'react-router-dom';
import Entry from ${modulePath("src/components/common/weplay/YutGameEntry.tsx")};
import Management from ${modulePath("src/pages/teacher/components/YutManagement.tsx")};
import Catalog from ${modulePath("src/components/common/weplay/WeplayGameCatalog.tsx")};
import {AppDialogProvider} from ${modulePath("src/components/common/AppDialogProvider.tsx")};
import {AppToastProvider} from ${modulePath("src/components/common/AppToastProvider.tsx")};
import ${modulePath("src/components/common/portalPage.css")};
import ${modulePath("src/assets/index.css")};
const query=new URLSearchParams(location.search),portal=query.get('portal')==='student'?'student':'teacher';
function App(){const [params]=useSearchParams();window.yutAccessQA.navigate=useNavigate();return params.get('game')==='joseon-yut'?portal==='teacher'?<Management/>:<Entry portal='student'/>:<main className='ws-page'><Catalog portal={portal} gameTitle='내가 충무공이라고?!'/></main>;}
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/'+portal+'/weplay'+(query.has('catalog')?'':'?game=joseon-yut')]}><AppToastProvider><AppDialogProvider><App/></AppDialogProvider></AppToastProvider></MemoryRouter>);
`;
const bundled = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "westory-yut-management.js"),
  loader: { ".woff2": "dataurl", ".svg": "dataurl" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "fixtures",
      setup(plugin) {
        plugin.onResolve({ filter: /^\/assets\// }, (args) => ({
          path: args.path,
          external: true,
        }));
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/(?:yut|weplay)$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onResolve({ filter: /\/yut\/YutGame$/ }, () => ({
          path: "game",
          namespace: "fixture",
        }));
        plugin.onResolve({ filter: /YutSpectator$/ }, () => ({
          path: "spectator",
          namespace: "fixture",
        }));
        plugin.onResolve({ filter: /useYutMusic$/ }, () => ({
          path: "music",
          namespace: "fixture",
        }));
        plugin.onResolve({ filter: /^\.\/Footer$/ }, () => ({
          path: "footer",
          namespace: "fixture",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents:
            args.path === "service"
              ? service
              : args.path === "game"
                ? `import React from 'react';export default function Game({onBack,preview,initialSettings}){window.yutAccessQA.preview=initialSettings;return <section data-testid='game-mounted'><h1>검증용 게임 대기</h1><span>{preview?'교사 체험':'온라인 대기'}</span><button onClick={onBack}>게임 관리</button></section>}`
                : args.path === "spectator"
                  ? `import React,{useEffect} from 'react';export default function Spectator({roomId,actorKey,config,serverOffsetMs}){window.yutAccessQA.spectatorOffset=serverOffsetMs;useEffect(()=>{const qa=window.yutAccessQA;qa.activeSpectators.push(roomId);qa.spectatorEvents.push({kind:'subscribe',roomId,actorKey,config,serverOffsetMs});return()=>{qa.activeSpectators=qa.activeSpectators.filter(id=>id!==roomId);qa.spectatorEvents.push({kind:'unsubscribe',roomId});};},[roomId,actorKey,config.year,config.semester,serverOffsetMs]);return <section data-testid='spectator-mounted' data-room-id={roomId} style={{minHeight:'100%'}}>읽기 전용 관전 화면</section>}`
                : args.path === "music"
                  ? `export default function useMusic(){return {start(){},toggle(){},enabled:false,failed:false};}`
                  : `export default function Footer(){return null;}`,
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundled.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundled.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+[^;]+;/g, "");
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/qa.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(js);
    }
    if (url.pathname === "/qa.css") {
      res.setHeader("Content-Type", "text/css");
      return res.end(css);
    }
    if (url.pathname.startsWith("/assets/")) {
      const target = path.resolve(root, "public", "." + url.pathname);
      if (!target.startsWith(path.join(root, "public") + path.sep))
        throw new Error("Bad path");
      res.setHeader(
        "Content-Type",
        target.endsWith(".webp") ? "image/webp" : "application/octet-stream",
      );
      return res.end(await fs.readFile(target));
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>*,::before,::after{box-sizing:border-box}body{margin:0;font-family:sans-serif}button,input{font:inherit}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>',
    );
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  errors = [];
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  reducedMotion: "reduce",
});
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", (route) =>
  new URL(route.request().url()).origin === base
    ? route.continue()
    : route.abort(),
);
const goto = async (query) => {
  await page.goto(base + "/?" + query);
};
const managementReads = () => page.evaluate(() => window.yutAccessQA.calls.filter(call => call.name === "getYutManagement").length);
const activeMonitorListeners = () => page.evaluate(() => window.yutAccessQA.monitorSubscriptions.filter(item => item.active).length);
const waitLive = () => page.getByText(/^실시간 반영 중(?: ·|$)/).waitFor();
const openMonitor = async () => {
  const reads = await managementReads();
  await page.getByRole("button", { name: "플레이 모니터링", exact: true }).click();
  await page.waitForFunction(before => window.yutAccessQA.calls.filter(call => call.name === "getYutManagement").length > before, reads);
  await waitLive();
};
const advanceSignal = async () => {
  await page.clock.fastForward(200);
  await page.waitForTimeout(20);
};
async function verifyRealtimeMonitoring() {
  await goto("portal=teacher");
  await page.getByLabel("윷 던지기 제한 시간", { exact: true }).fill("9");
  await openMonitor();
  await waitLive();
  assert.equal(await activeMonitorListeners(), 1);

  // Each fixture update models a server commit notification, never a timer or a manual refresh.
  await page.evaluate(() => {
    const qa = window.yutAccessQA;
    qa.rooms[0].turnUid = "student-b";
    qa.rooms[0].standings[1].finishedPieces = 2;
    qa.rooms[0].leadingUids = ["student-b"];
    qa.rooms.push({ ...structuredClone(qa.rooms[0]), id: "new-room", code: "GH6789", status: "waiting" });
    qa.settings.throwSeconds = 4;
    qa.settings.version++;
    qa.emitManagement();
  });
  await advanceSignal();
  await page.getByRole("button", { name: "GH6789 관전", exact: true }).waitFor();
  const room = page.locator(".yut-management-room-list > li").filter({ has: page.getByRole("button", { name: "AB2345 관전", exact: true }) });
  await room.getByText("선두 둘째 학생", { exact: true }).waitFor();
  await room.getByText("완주 2/2", { exact: true }).waitFor();
  assert.match(await room.locator("li").filter({ hasText: "현재 차례" }).textContent(), /둘째 학생/);
  await page.evaluate(() => { window.yutAccessQA.rooms[1].status = "ended"; window.yutAccessQA.emitManagement(); });
  await advanceSignal();
  await page.getByRole("button", { name: "GH6789 관전", exact: true }).waitFor({ state: "detached" });
  checks.push("Server signals add new rooms, update current turn/completed pieces/leader and remove ended rooms without a refresh click.");

  let before = await managementReads();
  await page.evaluate(() => { for (let index = 0; index < 25; index++) window.yutAccessQA.emitManagement(); });
  await advanceSignal();
  await waitLive();
  assert.equal(await managementReads(), before + 1, "one read coalesces a burst of 25 signals");

  before = await managementReads();
  await page.evaluate(() => { window.yutAccessQA.holdManagement = true; window.yutAccessQA.emitManagement(); });
  await advanceSignal();
  await page.waitForFunction(() => window.yutAccessQA.pendingManagement.length === 1);
  await page.evaluate(() => {
    const qa = window.yutAccessQA;
    qa.rooms[0].code = "JK2345";
    for (let index = 0; index < 25; index++) qa.emitManagement();
  });
  await advanceSignal();
  assert.equal(await managementReads(), before + 1, "signals during a request do not start parallel reads");
  await page.evaluate(() => window.yutAccessQA.releaseManagement());
  await advanceSignal();
  await page.getByRole("button", { name: "JK2345 관전", exact: true }).waitFor();
  await waitLive();
  assert.equal(await managementReads(), before + 2, "inflight signals trigger one trailing read");
  assert.equal(await page.evaluate(() => window.yutAccessQA.maxManagementReads), 1);
  checks.push("Bursts coalesce into one read; signals during a held read produce exactly one trailing read with the newest data and no overlapping requests.");

  before = await managementReads();
  await page.evaluate(() => window.yutAccessQA.emitManagement(false));
  await page.getByText("연결 확인 중…", { exact: true }).waitFor();
  assert.equal(await page.locator(".yut-management-room-list").count(), 0, "cached snapshot cannot present a live list");
  await advanceSignal();
  assert.equal(await managementReads(), before);
  await page.evaluate(() => window.yutAccessQA.emitManagement());
  await advanceSignal();
  await waitLive();
  await page.getByRole("button", { name: "JK2345 관전", exact: true }).waitFor();

  await page.evaluate(() => window.yutAccessQA.failManagement());
  await page.getByText("연결 끊김", { exact: true }).waitFor();
  assert.equal(await page.locator(".yut-management-room-list").count(), 0);
  await page.getByRole("button", { name: "다시 연결", exact: true }).click();
  await advanceSignal();
  await waitLive();
  assert.equal(await activeMonitorListeners(), 1);
  checks.push("Cache-only metadata hides the live list until server confirmation; listener errors hide stale rooms and the reconnect action restores exactly one listener.");

  before = await managementReads();
  await page.evaluate(() => window.yutAccessQA.setHidden(true));
  await page.waitForFunction(() => window.yutAccessQA.monitorSubscriptions.every(item => !item.active));
  assert.equal(await page.locator(".yut-management-room-list").count(), 0, "background tabs do not retain a live label/list");
  await page.evaluate(() => { const old = window.yutAccessQA.monitorSubscriptions.at(-1); old.onConnectionChange?.(true); old.onChange(); });
  await page.clock.fastForward(30000);
  assert.equal(await managementReads(), before, "retired listener callbacks and timers cannot refresh a hidden list");
  await page.evaluate(() => window.yutAccessQA.setHidden(false));
  await advanceSignal();
  await waitLive();
  assert.equal(await activeMonitorListeners(), 1);

  await page.evaluate(() => { window.yutAccessQA.holdManagement = true; window.yutAccessQA.emitManagement(); });
  await advanceSignal();
  await page.waitForFunction(() => window.yutAccessQA.pendingManagement.length === 1);
  await page.getByRole("button", { name: "모니터링 닫기", exact: true }).click();
  assert.equal(await activeMonitorListeners(), 0);
  assert.equal(await page.getByLabel("윷 던지기 제한 시간", { exact: true }).inputValue(), "9", "unsaved draft survives signal refreshes");
  await page.evaluate(() => { window.yutAccessQA.rooms[0].code = "MN2345"; });
  await openMonitor();
  await advanceSignal();
  await waitLive();
  await page.getByRole("button", { name: "MN2345 관전", exact: true }).waitFor();
  await page.evaluate(() => window.yutAccessQA.releaseManagement());
  await advanceSignal();
  assert.equal(await page.getByRole("button", { name: "JK2345 관전", exact: true }).count(), 0, "late closed-monitor response cannot replace new data");
  checks.push("Hidden tabs and closed dialogs release listeners and ignore retired callbacks/late reads. Returning starts fresh monitoring while preserving unsaved settings.");

  // The server supplies the clock offset; the expiry refresh must not need another game command.
  await page.evaluate(() => { const qa = window.yutAccessQA; qa.rooms[0].expiresAtMs = Date.now() + 120000 + 1000; qa.emitManagement(); });
  await advanceSignal();
  await waitLive();
  await page.clock.fastForward(1200);
  await page.getByText("대기 중이거나 진행 중인 방이 없습니다.", { exact: true }).waitFor();
  checks.push("Room expiry uses server time and removes an expired room even when no subsequent game signal arrives.");

  await goto("portal=teacher");
  await openMonitor();
  await page.evaluate(() => {
    const qa = window.yutAccessQA;
    qa.rooms[0].code = "SLOW23";
    qa.rooms[0].expiresAtMs = Date.now() + 120000 + 1000;
    qa.holdManagement = true;
    qa.emitManagement();
  });
  await advanceSignal();
  await page.waitForFunction(() => window.yutAccessQA.pendingManagement.length === 1);
  await page.clock.fastForward(1200);
  await page.evaluate(() => {
    const qa = window.yutAccessQA;
    qa.expiredRoomRendered = false;
    qa.expiredObserver = new MutationObserver(() => {
      if (document.querySelector(".yut-management-room-list")?.textContent.includes("SLOW23")) qa.expiredRoomRendered = true;
    });
    qa.expiredObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    qa.releaseManagement();
  });
  await advanceSignal();
  await waitLive();
  await page.getByText("대기 중이거나 진행 중인 방이 없습니다.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => { window.yutAccessQA.expiredObserver.disconnect(); return window.yutAccessQA.expiredRoomRendered; }), false, "a request-time snapshot arriving after expiry never renders the expired room");
  checks.push("A held response captures server time before its delay; a room expiring during the request is discarded on arrival without briefly rendering it.");

  await goto("portal=teacher");
  await openMonitor();
  await page.evaluate(() => {
    const qa = window.yutAccessQA;
    const now = Date.now() + 120000;
    qa.rooms[0].code = "EXP001";
    qa.rooms[0].expiresAtMs = now + 1000;
    qa.rooms.push({ ...structuredClone(qa.rooms[0]), id: "second-expiry", code: "EXP002", expiresAtMs: now + 2500 });
    qa.emitManagement();
  });
  await advanceSignal();
  await waitLive();
  await page.getByRole("button", { name: "EXP001 관전", exact: true }).waitFor();
  await page.getByRole("button", { name: "EXP002 관전", exact: true }).waitFor();
  await page.evaluate(() => { window.yutAccessQA.holdManagement = true; });
  await page.clock.fastForward(1100);
  await advanceSignal();
  await page.waitForFunction(() => window.yutAccessQA.pendingManagement.length === 1);
  assert.equal(await page.getByRole("button", { name: "EXP001 관전", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "EXP002 관전", exact: true }).count(), 1);
  await page.clock.fastForward(1500);
  await page.getByText("대기 중이거나 진행 중인 방이 없습니다.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.yutAccessQA.pendingManagement.length), 1, "the second room expires while the first expiry's network refresh is still held");
  await page.evaluate(() => window.yutAccessQA.releaseManagement());
  await advanceSignal();
  await waitLive();
  assert.equal(await page.locator(".yut-management-room-list > li").count(), 0);
  checks.push("Two rooms expire on independent deadlines: the second disappears even while the first expiry refresh is held, and releasing that stale response cannot revive either room.");

  for (const change of ["identity", "semester", "permission"]) {
    await goto("portal=teacher");
    await openMonitor();
    await advanceSignal();
    await waitLive();
    await page.evaluate(() => { window.yutAccessQA.holdManagement = true; window.yutAccessQA.emitManagement(); });
    await advanceSignal();
    await page.waitForFunction(() => window.yutAccessQA.pendingManagement.length === 1);
    await page.evaluate(kind => {
      const qa = window.yutAccessQA;
      qa.changeAuth(kind === "identity" ? { currentUser: { uid: "qa-next", email: "qa@example.invalid" } } : kind === "semester" ? { config: { year: "2026", semester: "1" } } : { userData: { role: "student", teacherPortalEnabled: false, staffPermissions: [] } });
    }, change);
    await page.getByRole("dialog", { name: "학생 플레이 모니터링" }).waitFor({ state: "detached" });
    assert.equal(await activeMonitorListeners(), 0);
    await page.evaluate(() => { const qa = window.yutAccessQA; qa.releaseManagement(); const old = qa.monitorSubscriptions.at(-1); old.onConnectionChange?.(true); old.onChange(); });
    await advanceSignal();
    assert.equal(await page.locator(".yut-management-room-list").count(), 0);
    assert.equal(await page.evaluate(() => document.body.style.overflowY), "");
  }
  checks.push("Identity, semester and permission changes close monitoring, release the listener, restore scrolling and reject a prior-scope response/callback.");
}
async function verifyInactiveMonitoring() {
  await goto("portal=teacher");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel("윷 던지기 제한 시간", { exact: true }).fill("9");
  await page.evaluate(() => {
    const qa = window.yutAccessQA;
    const now = Date.now() + 120000;
    qa.rooms[0].code = "ACT123";
    qa.rooms[0].turnDeadlineMs = now + 25000;
    qa.rooms.push(
      { ...structuredClone(qa.rooms[0]), id: "inactive-room", code: "OLD123", turnDeadlineMs: now - 61000 },
      { ...structuredClone(qa.rooms[0]), id: "waiting-room", code: "WAIT23", status: "waiting", turnDeadlineMs: now - 61000 },
    );
    qa.settings.throwSeconds = 4;
    qa.settings.version++;
  });
  await openMonitor();
  await page.getByText("대기·진행 중인 방 2개", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "OLD123 관전", exact: true }).count(), 0);
  await page.getByRole("button", { name: "ACT123 관전", exact: true }).waitFor();
  await page.getByRole("button", { name: "WAIT23 관전", exact: true }).waitFor();
  const expand = page.getByRole("button", { name: "최근 진행이 없는 방 1개 보기", exact: true });
  assert.equal(await expand.getAttribute("aria-expanded"), "false");
  await expand.click();
  const oldRoom = page.locator(".yut-management-room-list > li").filter({ has: page.getByRole("button", { name: "OLD123 관전", exact: true }) });
  await oldRoom.getByText("최근 진행 없음", { exact: true }).waitFor();
  assert.equal(await oldRoom.getByText("현재 차례", { exact: true }).count(), 0);
  assert.equal(await oldRoom.locator(".yut-management-leader").count(), 0);
  await page.getByText("대기·진행 중인 방 2개", { exact: true }).waitFor();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(evidence, "teacher-monitor-inactive-1280.png") });

  await oldRoom.getByRole("button", { name: "OLD123 방 닫기", exact: true }).click();
  await page.getByRole("group", { name: "OLD123 방 닫기 확인", exact: true }).waitFor();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await oldRoom.getByRole("button", { name: "OLD123 관전", exact: true }).click();
  await page.getByTestId("spectator-mounted").waitFor();
  assert.equal(await page.getByTestId("spectator-mounted").getAttribute("data-room-id"), "inactive-room");
  await page.getByRole("button", { name: "목록으로", exact: true }).click();
  await waitLive();
  const collapse = page.getByRole("button", { name: "최근 진행이 없는 방 1개 접기", exact: true });
  assert.equal(await collapse.getAttribute("aria-expanded"), "true");
  await collapse.click();
  assert.equal(await page.getByRole("button", { name: "OLD123 관전", exact: true }).count(), 0);

  await page.evaluate(() => {
    const qa = window.yutAccessQA;
    qa.rooms.find(room => room.id === "inactive-room").turnDeadlineMs = Date.now() + 120000 + 25000;
    qa.emitManagement();
  });
  await advanceSignal();
  await page.getByText("대기·진행 중인 방 3개", { exact: true }).waitFor();
  await oldRoom.getByText("현재 차례", { exact: true }).waitFor();
  await oldRoom.getByText("진행 중", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /최근 진행이 없는 방 .*개 (보기|접기)/ }).count(), 0);
  await page.getByRole("button", { name: "모니터링 닫기", exact: true }).click();
  assert.equal(await page.getByLabel("윷 던지기 제한 시간", { exact: true }).inputValue(), "9");
  assert.equal(await page.evaluate(() => window.yutAccessQA.calls.filter(call => call.name === "commandYutRoom").length), 0);
  checks.push("A playing room over one minute past its turn deadline is collapsed separately from active/waiting rooms; expansion removes current-turn/leader emphasis but retains spectating and close confirmation. A resumed-turn signal restores it to the active list automatically, preserving unsaved settings and issuing no room command.");
}
try {
  if (!process.env.YUT_MANAGEMENT_ONLY) {
    for (const scenario of ["closed", "missing", "failure"]) {
      await goto("portal=student&case=" + scenario);
      await page
        .getByText(
          scenario === "failure"
            ? "게임을 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요."
            : "지금은 윷놀이가 열려 있지 않습니다.",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await page
          .locator('[data-testid="game-mounted"],.weplay-studio-intro')
          .count(),
        0,
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.yutAccessQA.calls.filter(
              (call) => call.name === "commandYutRoom",
            ).length,
        ),
        0,
      );
    }
    checks.push(
      "Direct student URL fails closed for false, missing flag and network error before intro/local game.",
    );
    await goto("portal=student&case=pending");
    await page
      .getByText("게임을 확인하고 있습니다.", { exact: true })
      .waitFor();
    await page.evaluate(() => {
      window.yutAccessQA.enabled = false;
      window.yutAccessQA.changeAuth({
        config: { year: "2026", semester: "1" },
      });
    });
    await page
      .getByText("지금은 윷놀이가 열려 있지 않습니다.", { exact: true })
      .waitFor();
    await page.evaluate(() => window.yutAccessQA.release());
    assert.equal(
      await page
        .locator('[data-testid="game-mounted"],.weplay-studio-intro')
        .count(),
      0,
    );
    checks.push("Semester change rejects old publication response.");
    await goto("portal=student&case=closed&catalog=1");
    await page.getByText("지금은 이용할 수 없음", { exact: true }).waitFor();
    assert.equal(await page.locator('a[href*="joseon-yut"]').count(), 0);
    assert.equal(await page.locator('a[href*="history-rain"]').count(), 1);
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await goto("portal=student&case=open&catalog=1");
      const card = page.locator('a[href*="joseon-yut"]');
      await card.waitFor();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await card.focus();
      await page.waitForTimeout(220);
      const style = await card.evaluate(node => {
        const action = getComputedStyle(node.querySelector(".weplay-game-card-action"));
        return { transform: getComputedStyle(node).transform, shadow: getComputedStyle(node).boxShadow, font: action.fontSize, background: action.backgroundColor, color: action.color, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(style.font, "18px");
      assert.equal(style.color, "rgb(255, 255, 255)");
      assert.notEqual(style.background, "rgba(0, 0, 0, 0)");
      assert.notEqual(style.transform, "none");
      assert.notEqual(style.shadow, "none");
      assert.equal(style.overflow, false);
      await page.screenshot({ path: path.join(evidence, `student-catalog-${width}.png`) });
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    checks.push("Student catalog has a blue 18px action and raised card focus at 390/768/1280px, including the requested reduced-motion override.");
    await goto("portal=student&case=open");
    await page.getByRole("button", { name: /건너뛰기/ }).click();
    await page.getByTestId("game-mounted").waitFor();
    assert.equal(
      await page.evaluate(() => window.yutAccessQA.preview.allowSolo),
      true,
    );
    await page.evaluate(() => {
      window.yutAccessQA.settings.allowSolo = false;
      window.yutAccessQA.settings.allowMultiplayer = false;
      window.yutAccessQA.settings.allowPrivateRooms = false;
    });
    await page.waitForFunction(
      () => window.yutAccessQA.preview?.allowSolo === false,
      undefined,
      { timeout: 18000 },
    );
    assert.deepEqual(
      await page.evaluate(() => [
        window.yutAccessQA.preview.allowSolo,
        window.yutAccessQA.preview.allowMultiplayer,
        window.yutAccessQA.preview.allowPrivateRooms,
      ]),
      [false, false, false],
    );
    assert.equal(await page.getByTestId("game-mounted").count(), 1);
    checks.push(
      "The 15-second student publication refresh passes live solo, multiplayer and private-room restrictions into the mounted game without waiting for re-entry.",
    );
    await page.evaluate(() => {
      window.yutAccessQA.enabled = false;
    });
    await page
      .getByText("지금은 윷놀이가 열려 있지 않습니다.", { exact: true })
      .waitFor({ timeout: 18000 });
    assert.equal(await page.getByTestId("game-mounted").count(), 0);
    await page.evaluate(() => {
      window.yutAccessQA.enabled = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.getByTestId("game-mounted").waitFor();
    await page.evaluate(() => {
      window.yutAccessQA.fail = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page
      .getByText(
        "게임을 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.",
        { exact: true },
      )
      .waitFor();
    assert.equal(await page.getByTestId("game-mounted").count(), 0);
    checks.push(
      "Student catalog disables only Yut; 15-second publication refresh unmounts an already entered game.",
    );
    await page.evaluate(() => {
      window.yutAccessQA.fail = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.getByTestId("game-mounted").waitFor();
    const beforeTimeout = await page.evaluate(
      () => window.yutAccessQA.calls.length,
    );
    await page.evaluate(() => {
      window.yutAccessQA.hold = true;
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(
      await page.evaluate(() => window.yutAccessQA.calls.length),
      beforeTimeout + 1,
    );
    await page
      .getByText(
        "게임을 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.",
        { exact: true },
      )
      .waitFor({ timeout: 12000 });
    assert.equal(await page.getByTestId("game-mounted").count(), 0);
    await page.evaluate(() => window.yutAccessQA.release());
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId("game-mounted").count(), 0);
    checks.push(
      "A stalled publication read times out at 10 seconds, unmounts local play, suppresses duplicate reads and ignores a late open response.",
    );
  }
  if (!process.env.YUT_STUDENT_CATALOG_ONLY) {
  await goto("portal=teacher&catalog=1");
  await page.getByRole("link", { name: /마우저구 윷놀이.*게임 관리/ }).click();
  await page.getByRole("checkbox", { name: "학생에게 공개" }).waitFor();
  assert.equal(await page.locator(".yut-management-preview-actions").getByRole("button", { name: "플레이 모니터링", exact: true }).count(), 1);
  assert.equal(await page.locator(".yut-management-rooms").count(), 0);
  assert.equal(
    await page.locator(".yut-management-settings strong").textContent(),
    "비공개",
  );
  assert.equal(
    await page
      .locator('.weplay-studio-intro,[data-testid="game-mounted"]')
      .count(),
    0,
  );
  const mute = page.locator(
    ".yut-management .weplay-game-navigation .weplay-music-button",
  );
  assert.equal(await mute.getAttribute("aria-label"), "소리 끄기");
  await mute.click();
  assert.equal(await mute.getAttribute("aria-label"), "소리 켜기");
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("westory.weplay.musicMuted"),
    ),
    "true",
  );
  await mute.click();
  assert.equal(await mute.getAttribute("aria-label"), "소리 끄기");
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("westory.weplay.musicMuted"),
    ),
    "false",
  );
  checks.push(
    "Management header mute reflects and updates the shared audio preference without starting music.",
  );
  if (process.env.YUT_MANAGEMENT_ONLY === "headers") {
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const title = await page
        .locator(".yut-management > header h1")
        .boundingBox();
      const navigation = await page
        .locator(".yut-management > header .weplay-game-navigation")
        .boundingBox();
      await page.screenshot({
        path: path.join(evidence, "teacher-header-" + width + ".png"),
        fullPage: true,
      });
      assert.ok(
        navigation.x > title.x + title.width &&
          Math.abs(
            navigation.y + navigation.height / 2 - (title.y + title.height / 2),
          ) < 8,
        "management title/actions row at " + width,
      );
      const style = await page
        .locator(".yut-management > header")
        .getByRole("link", { name: "전체 게임", exact: true })
        .evaluate((node) => ({
          height: node.getBoundingClientRect().height,
          border: getComputedStyle(node).borderTopWidth,
          weight: getComputedStyle(node).fontWeight,
        }));
      assert.ok(
        style.height >= 44 &&
          style.border === "1px" &&
          Number(style.weight) >= 700,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      await page.screenshot({
        path: path.join(evidence, "teacher-header-" + width + ".png"),
        fullPage: true,
      });
    }
    checks.push(
      "Management title, bordered44px catalog button and mute share one row at390/768/1280 without overflow.",
    );
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(evidence, "header-report.json"),
      JSON.stringify({ checks, errors }, null, 2),
    );
    console.log(checks.join("\n"));
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    process.exit(0);
  }

  await page.getByRole("checkbox", { name: "학생에게 공개" }).focus();
  await page.keyboard.press("Space");
  assert.equal(
    await page.getByLabel("기본 인원", { exact: true }).inputValue(),
    "4",
  );
  assert.equal(
    await page.getByLabel("윷 던지기 제한 시간", { exact: true }).inputValue(),
    "5",
  );
  assert.equal(
    await page.getByLabel("말 이동 제한 시간", { exact: true }).inputValue(),
    "25",
  );
  await page.getByText("학생 하루 5회", { exact: true }).waitFor();
  await page.getByLabel("윷 던지기 제한 시간", { exact: true }).fill("");
  assert.equal(
    await page
      .getByRole("button", { name: "게임 설정 저장", exact: true })
      .isEnabled(),
    false,
  );
  await openMonitor();
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.getByRole("button", { name: "모니터링 닫기", exact: true }).click();
  assert.equal(
    await page.getByRole("checkbox", { name: "학생에게 공개" }).isChecked(),
    true,
  );
  assert.equal(
    await page.getByLabel("윷 던지기 제한 시간", { exact: true }).inputValue(),
    "",
  );
  await page.getByLabel("기본 인원", { exact: true }).selectOption("3");
  await page.getByLabel("윷 던지기 제한 시간", { exact: true }).fill("7");
  await page.getByLabel("말 이동 제한 시간", { exact: true }).fill("35");
  await page
    .getByRole("checkbox", { name: "싱글 플레이 허용", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "멀티플레이 허용", exact: true })
    .uncheck();
  assert.equal(
    await page
      .getByRole("checkbox", { name: "비공개 방 허용", exact: true })
      .isEnabled(),
    false,
  );
  await page
    .getByRole("checkbox", { name: "멀티플레이 허용", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "비공개 방 허용", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "게임 설정 저장", exact: true })
    .click();
  await page.getByText("게임 설정을 저장했습니다.", { exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.yutAccessQA.calls.find((call) => call.name === "saveYutSettings")
          .data,
    ),
    {
      enabled: true,
      allowSolo: false,
      allowMultiplayer: true,
      allowPrivateRooms: false,
      defaultPlayerCount: 3,
      throwSeconds: 7,
      moveSeconds: 35,
      expectedVersion: 0,
    },
  );
  await page.getByRole("checkbox", { name: "학생에게 공개" }).uncheck();
  await page.evaluate(() => {
    window.yutAccessQA.settings.version++;
  });
  await page
    .getByRole("button", { name: "게임 설정 저장", exact: true })
    .click();
  await page
    .locator(".yut-management-settings")
    .getByText(
      "다른 곳에서 게임 설정이 바뀌었습니다. 최신 설정을 불러온 뒤 다시 확인해 주세요.",
      { exact: true },
    )
    .waitFor();
  await page
    .getByRole("button", { name: "최신 설정 불러오기", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "학생에게 공개" }).check();
  assert.equal(await page.locator(".yut-management-room-list").count(), 0);
  await openMonitor();
  await page.getByRole("dialog", { name: "학생 플레이 모니터링" }).waitFor();
  await page.getByText("7번", { exact: true }).waitFor();
  await page.getByText("현재 차례", { exact: true }).waitFor();
  await page.getByText("비공개 방", { exact: true }).waitFor();
  await page.getByText("선두 검증 학생", { exact: true }).waitFor();
  await page.getByText("완주 1/2", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.yutAccessQA.rooms[0].visibility = "public";
    window.yutAccessQA.rooms[0].maxPlayers = 3;
    window.yutAccessQA.settings.enabled = false;
    window.yutAccessQA.settings.version++;
  });
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.getByText("공개 방", { exact: true }).waitFor();
  await page.getByText("2/3명", { exact: true }).waitFor();
  await page.getByRole("button", { name: "모니터링 닫기", exact: true }).click();
  assert.equal(
    await page.getByRole("checkbox", { name: "학생에게 공개" }).isChecked(),
    true,
    "monitor refresh keeps the settings editor independent",
  );
  await page.getByLabel("윷 던지기 제한 시간", { exact: true }).fill("9");
  checks.push(
    "Teacher options default closed/4 players/5-second throw/25-second move; editable modes/count/timers, fixed private daily cap, invalid input preserved across refresh, full CAS payload and conflict recovery; public/private room metadata.",
  );
  for (const width of [390, 768, 1280, 1366]) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 });
    await page.mouse.move(0, 0);
    await page.keyboard.press("Escape");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "no overflow at " + width,
    );
    const heading = await page
      .locator(".yut-management > header h1")
      .boundingBox();
    const allGames = await page
      .locator(".yut-management > header")
      .getByRole("link", { name: "전체 게임", exact: true })
      .boundingBox();
    assert.ok(
      allGames.y + allGames.height / 2 >= heading.y + heading.height / 2 - 8,
      "catalog action is no longer above the title",
    );
    if (width >= 768)
      assert.ok(
        allGames.x > heading.x + heading.width &&
          Math.abs(
            allGames.y + allGames.height / 2 - (heading.y + heading.height / 2),
          ) < 12,
        "management actions share title row",
      );
    await page.screenshot({
      path: path.join(evidence, "teacher-management-" + width + ".png"),
      fullPage: true,
    });
  }
  await page.evaluate(() => {
    const source = window.yutAccessQA.rooms[0];
    window.yutAccessQA.rooms.push(
      { ...structuredClone(source), id: "room-b", code: "CD2345", leadingUids: ["student-a", "student-b"] },
      ...Array.from({ length: 10 }, (_, index) => ({ ...structuredClone(source), id: "room-" + index, code: "EF234" + index })),
    );
  });
  // Deliberate conflict toasts must not cover monitoring screenshots.
  while (await page.getByRole("button", { name: /알림 닫기$/ }).count()) {
    await page.getByRole("button", { name: /알림 닫기$/ }).first().click();
  }
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const opener = page.getByRole("button", { name: "플레이 모니터링", exact: true });
    await openMonitor();
    const monitor = page.getByRole("dialog", { name: "학생 플레이 모니터링" });
    await monitor.waitFor();
    await monitor.getByText("공동 선두 검증 학생, 둘째 학생", { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".yut-management-room-list > li").length === 12);
    const layout = await monitor.evaluate((node) => {
      const body = node.querySelector(".yut-management-monitor-body");
      const cards = [...node.querySelectorAll(".yut-management-room-list > li")].map((card) => card.getBoundingClientRect());
      return { first: { x: cards[0].x, y: cards[0].y }, second: { x: cards[1].x, y: cards[1].y }, overflow: body.scrollWidth > body.clientWidth + 1, scrolls: body.scrollHeight > body.clientHeight, pageLocked: document.body.style.overflowY === "hidden", focusedInside: node.contains(document.activeElement) };
    });
    assert.equal(layout.overflow, false);
    assert.equal(layout.scrolls, true);
    assert.equal(layout.pageLocked, true);
    assert.equal(layout.focusedInside, true);
    if (width >= 1280) {
      assert.equal(layout.first.y, layout.second.y);
      assert.ok(layout.second.x > layout.first.x);
    } else {
      assert.equal(layout.first.x, layout.second.x);
      assert.ok(layout.second.y > layout.first.y);
    }
    await page.keyboard.press("Shift+Tab");
    assert.equal(await monitor.evaluate(node => node.contains(document.activeElement)), true);
    await monitor.getByRole("button", { name: "모니터링 닫기", exact: true }).focus();
    await monitor.locator(".yut-management-monitor-body").evaluate(node => { node.scrollTop = 0; });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(evidence, "teacher-monitor-" + width + ".png") });
    await page.keyboard.press("Escape");
    assert.equal(await monitor.count(), 0);
    assert.equal(await opener.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.body.style.overflowY), "");
  }
  const idleReads = await page.evaluate(() => window.yutAccessQA.calls.filter(call => call.name === "getYutManagement").length);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => window.yutAccessQA.calls.filter(call => call.name === "getYutManagement").length), idleReads);
  assert.equal(await page.evaluate(() => window.yutAccessQA.calls.filter(call => call.name === "commandYutRoom").length), 0);
  await page.evaluate(() => { window.yutAccessQA.rooms = window.yutAccessQA.rooms.slice(0, 1); });
  await page.clock.install();
  await openMonitor();
  await page.waitForFunction(() => document.querySelectorAll(".yut-management-room-list > li").length === 1);
  await page.getByText("선두 검증 학생", { exact: true }).waitFor();
  await page.getByRole("button", { name: "선두 기준", exact: true }).click();
  const leadHelp = page.getByRole("tooltip").filter({ hasText: "완주한 말 수" });
  await leadHelp.waitFor();
  assert.equal(await leadHelp.evaluate(node => !!node.closest("dialog")), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog", { name: "학생 플레이 모니터링" }).count(), 1);
  const openReads = await page.evaluate(() => window.yutAccessQA.calls.filter(call => call.name === "getYutManagement").length);
  await page.clock.fastForward(15010);
  assert.equal(await page.evaluate(() => window.yutAccessQA.calls.filter(call => call.name === "getYutManagement").length), openReads, "idle monitoring has no 15-second polling");
  await page.evaluate(() => window.yutAccessQA.emitManagement());
  await page.clock.fastForward(200);
  await page.waitForFunction((reads) => window.yutAccessQA.calls.filter(call => call.name === "getYutManagement").length > reads, openReads);
  await page.mouse.click(5, 5);
  assert.equal(await page.getByRole("dialog", { name: "학생 플레이 모니터링" }).count(), 0);
  const closedReads = await page.evaluate(() => window.yutAccessQA.calls.filter(call => call.name === "getYutManagement").length);
  await page.clock.fastForward(30010);
  assert.equal(await page.evaluate(() => window.yutAccessQA.calls.filter(call => call.name === "getYutManagement").length), closedReads);
  checks.push("Monitoring opens in a modal, shows leaders/co-leaders/completed pieces and uses two desktop columns/one mobile column; 12 rooms share one scroll area with focus containment, Escape/backdrop focus restoration and native-modal tooltips. Server signals refresh the open list without a 15-second polling loop; inspecting rooms performs no room commands.");
  await openMonitor();
  await page.getByRole("button", { name: "AB2345 관전", exact: true }).click();
  await page.getByTestId("spectator-mounted").waitFor();
  assert.equal(await page.getByTestId("spectator-mounted").getAttribute("data-room-id"), "room-a");
  assert.equal(await page.getByRole("dialog", { name: "AB2345 관전" }).count(), 1);
  assert.equal(await page.locator("dialog").count(), 1);
  await page.getByText("읽기 전용", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.yutAccessQA.activeSpectators), ["room-a"]);
  assert.equal(await page.evaluate(() => window.yutAccessQA.monitorSubscriptions.filter(item => item.active).length), 0, "spectating releases the list listener");
  const spectatorOffset = await page.evaluate(() => window.yutAccessQA.spectatorOffset);
  assert.ok(Number.isFinite(spectatorOffset) && Math.abs(spectatorOffset - 120000) < 100);
  const spectatorReads = await page.evaluate(() => window.yutAccessQA.calls.filter(call => call.name === "getYutManagement").length);
  await page.clock.fastForward(45010);
  await page.evaluate(() => window.yutAccessQA.changeAuth({ currentUser: { ...window.yutAccessQA.auth.currentUser } }));
  assert.equal(await page.evaluate(() => window.yutAccessQA.spectatorOffset), spectatorOffset);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  assert.equal(await page.evaluate(() => window.yutAccessQA.calls.filter(call => call.name === "getYutManagement").length), spectatorReads);
  assert.equal(await page.evaluate(() => window.yutAccessQA.calls.filter(call => call.name === "commandYutRoom").length), 0);
  await page.getByRole("button", { name: "목록으로", exact: true }).click();
  await page.getByRole("dialog", { name: "학생 플레이 모니터링" }).waitFor();
  assert.equal(await page.getByTestId("spectator-mounted").count(), 0);
  assert.deepEqual(await page.evaluate(() => window.yutAccessQA.activeSpectators), []);
  await page.waitForFunction(reads => window.yutAccessQA.calls.filter(call => call.name === "getYutManagement").length > reads, spectatorReads);
  await page.evaluate(() => { window.yutAccessQA.rooms[0].status = "waiting"; });
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.getByText("대기 중", { exact: true }).waitFor();
  await page.getByRole("button", { name: "AB2345 관전", exact: true }).click();
  await page.getByTestId("spectator-mounted").waitFor();
  await page.getByRole("button", { name: "모니터링 닫기", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.yutAccessQA.activeSpectators), []);
  await openMonitor();
  assert.equal(await page.getByTestId("spectator-mounted").count(), 0);
  await page.getByRole("button", { name: "AB2345 관전", exact: true }).click();
  await page.getByTestId("spectator-mounted").waitFor();
  await page.evaluate(() => window.yutAccessQA.navigate("/teacher/weplay?game=joseon-yut&view=preview"));
  await page.waitForFunction(() => window.yutAccessQA.activeSpectators.length === 0);
  assert.equal(await page.locator(".yut-management-monitor").count(), 0);
  await page.evaluate(() => window.yutAccessQA.navigate("/teacher/weplay?game=joseon-yut"));
  await page.getByRole("checkbox", { name: "학생에게 공개" }).waitFor();
  assert.equal(await page.locator(".yut-management-monitor").count(), 0);
  await page.evaluate(() => { window.yutAccessQA.rooms[0].status = "playing"; });
  checks.push("Monitoring button is next to teacher preview actions. Watching waiting/playing rooms swaps content inside one modal, mounts one read-only viewer, releases the list listener, and performs no room commands. Back refreshes the list; close/reopen and view changes discard the selection and unmount the viewer.");
  // Earlier deliberate save conflicts leave global toasts; dismiss them before the intro.
  while (await page.getByRole("button", { name: /알림 닫기$/ }).count()) {
    await page
      .getByRole("button", { name: /알림 닫기$/ })
      .first()
      .click();
  }
  await page.getByRole("link", { name: "체험하기", exact: true }).click();
  await page.getByRole("button", { name: /건너뛰기/ }).click();
  await page.getByText("교사 체험", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.yutAccessQA.preview.throwSeconds),
    9,
  );
  assert.equal(
    await page.evaluate(() => window.yutAccessQA.preview.defaultPlayerCount),
    3,
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.yutAccessQA.calls.filter(
          (call) => call.name === "commandYutRoom",
        ).length,
    ),
    0,
  );
  await page.getByRole("button", { name: "게임 관리", exact: true }).click();
  await page.getByRole("checkbox", { name: "학생에게 공개" }).waitFor();
  assert.equal(
    await page.getByLabel("윷 던지기 제한 시간", { exact: true }).inputValue(),
    "9",
  );
  await openMonitor();
  await page
    .getByRole("button", { name: "AB2345 방 닫기", exact: true })
    .click();
  await page.getByText("AB2345 방을 닫으면 참여 중인 학생의 게임이 종료됩니다.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.yutAccessQA.calls.filter(call => call.name === "commandYutRoom").length), 0);
  await page.getByRole("button", { name: "취소", exact: true }).click();
  assert.equal(await page.locator(".yut-management-close-confirm").count(), 0);
  await page.getByRole("button", { name: "AB2345 방 닫기", exact: true }).click();
  await page.getByRole("button", { name: "방 닫기", exact: true }).click();
  await page
    .getByText("대기 중이거나 진행 중인 방이 없습니다.", { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        window.yutAccessQA.calls.find((call) => call.name === "commandYutRoom")
          .data.expectedRevision,
    ),
    4,
  );
  checks.push(
    "Teacher preview route performs no room write; monitor closes selected room with revision and explicit confirmation. Responsive 390/768/1280/1366px checked.",
  );
  await goto("portal=teacher&case=readonly");
  await page.getByRole("checkbox", { name: "학생에게 공개" }).waitFor();
  assert.equal(
    await page.getByRole("checkbox", { name: "학생에게 공개" }).isEnabled(),
    false,
  );
  assert.equal(
    await page.getByLabel("말 이동 제한 시간", { exact: true }).isEnabled(),
    false,
  );
  assert.equal(
    await page.getByLabel("기본 인원", { exact: true }).isEnabled(),
    false,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "게임 설정 저장", exact: true })
      .count(),
    0,
  );
  await openMonitor();
  await page.getByRole("dialog", { name: "학생 플레이 모니터링" }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "AB2345 방 닫기", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "AB2345 관전", exact: true }).click();
  await page.getByTestId("spectator-mounted").waitFor();
  await page.evaluate(() => window.yutAccessQA.changeAuth({ currentUser: { uid: "qa-next", email: "qa@example.invalid" } }));
  await page.waitForFunction(() => window.yutAccessQA.activeSpectators.length === 0);
  assert.equal(await page.locator(".yut-management-monitor").count(), 0);
  await openMonitor();
  await page.getByRole("button", { name: "AB2345 관전", exact: true }).click();
  await page.getByTestId("spectator-mounted").waitFor();
  await page.evaluate(() => window.yutAccessQA.changeAuth({ config: { year: "2026", semester: "1" } }));
  await page.waitForFunction(() => window.yutAccessQA.activeSpectators.length === 0);
  assert.equal(await page.locator(".yut-management-monitor").count(), 0);
  assert.equal(await page.evaluate(() => document.body.style.overflowY), "");
  checks.push("Read-only management can spectate; identity and semester changes unmount the viewer, clear selection, close the modal and restore the page scroll lock.");
  await verifyRealtimeMonitoring();
  await verifyInactiveMonitoring();
  await goto("portal=teacher&case=denied");
  await page
    .getByText("위플레이 관리 화면을 볼 권한이 없습니다.", { exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => window.yutAccessQA.calls.length), 0);
  checks.push(
    "Read-only teacher can inspect/preview but cannot publish or close rooms; unauthorized user performs no management read.",
  );
  }
  assert.deepEqual(errors, []);
} catch (error) {
  errors.push(error.stack || error.message);
  await page.screenshot({ path: path.join(evidence, "failure.png"), fullPage: true });
  throw error;
} finally {
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
  server.close();
}
console.log(checks.join("\n"));
