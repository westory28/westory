/** Read-only spectator rendering and subscription lifecycle; synthetic transport only. */
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
  playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
}
const evidence = path.join(root, "output/yut-spectator-20261021");
await fs.mkdir(evidence, { recursive: true });
const source = (file) => JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const service = `
import * as core from ${source("functions/yutCore.mjs")};
const qa=window.qa={listeners:[],writes:[],intervals:new Set(),failSubscribe:false};
const nativeInterval=window.setInterval.bind(window),nativeClear=window.clearInterval.bind(window);
window.setInterval=(fn,ms,...args)=>{const id=nativeInterval(fn,ms,...args);qa.intervals.add(id);return id};
window.clearInterval=id=>{qa.intervals.delete(id);nativeClear(id)};
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze)}return value};
qa.seed=(id='room-a',status='playing')=>{
 let room=core.createYutRoom({id,code:'RM001A',classId:'',classLabel:'검증 방',host:{uid:'student-a',name:'김검증(3학년 2반)'},nowMs:Date.now(),maxPlayers:4});
 for(const [uid,name] of [['student-b','박상대(3학년 2반)'],['student-c','이참가(3학년 2반)'],['student-d','정친구(3학년 2반)']]){room=core.addYutPlayer(room,{uid,name},Date.now());room=core.readyYutPlayer(room,uid,true,Date.now())}
 if(status!=='waiting'){
  room=core.startYutGame(room,Date.now()-10000);
  room.players.forEach((player,index)=>{player.pieces[0].node=['o5','o10','o15','center'][index]});
  room=core.throwYut(room,'student-a',[true,true,false,false],Date.now()-4000);
 }
 room.status=status;room.turnDeadlineMs=Date.now()+60000;room.expiresAtMs=Date.now()+120000;
 if(status==='finished'){room.winnerUid='student-b';room.players[1].pieces.forEach(piece=>piece.node='finish')}
 return room;
};
qa.confirm=room=>{qa.room=freeze(structuredClone(room));for(const item of qa.listeners.filter(item=>item.active)){item.connection?.(true);item.next(qa.room)}};
qa.cached=()=>qa.listeners.filter(item=>item.active).forEach(item=>item.connection?.(false));
qa.fail=()=>qa.listeners.filter(item=>item.active).forEach(item=>item.error({code:'permission-denied'}));
qa.force=(index,room)=>qa.listeners[index].next(room);
qa.active=()=>qa.listeners.filter(item=>item.active).length;
qa.hide=hidden=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});document.dispatchEvent(new Event('visibilitychange'))};
export const subscribeYutRoom=(config,id,next,error,connection)=>{
 const item={config,id,next,error,connection,active:true,stops:0};qa.listeners.push(item);connection?.(false);
 if(qa.failSubscribe){qa.failSubscribe=false;error({code:'permission-denied'})}
 return()=>{item.active=false;item.stops++};
};
export const yutErrorMessage=error=>error?.code==='permission-denied'?'방에 연결할 수 없습니다. 방 상태를 다시 확인해 주세요.':error?.message||'다시 시도해 주세요.';
export const getYutLobby=()=>{qa.writes.push('lobby');throw new Error('Spectator called lobby')};
export const commandYutRoom=()=>{qa.writes.push('command');throw new Error('Spectator sent command')};
`;
const harness = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Spectator from ${source("src/pages/teacher/components/YutSpectator.tsx")};
import ${source("src/assets/index.css")};import ${source("src/pages/teacher/components/YutManagement.css")};
function App(){const[props,setProps]=useState({roomId:'room-a',config:{year:'2026',semester:'2'},actorKey:'teacher-a/2026/2/true'}),[mounted,setMounted]=useState(true);window.qa.setProps=patch=>setProps(old=>({...old,...patch}));window.qa.close=()=>setMounted(false);window.qa.open=()=>setMounted(true);return <div className="fixture-shell"><header>RM001A 관전</header><div className="fixture-body yut-management">{mounted&&<Spectator {...props}/>}</div></div>};createRoot(document.getElementById('root')).render(<App/>);
`;
const bundle = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root }, bundle: true, write: false, format: "esm", outfile: path.join(os.tmpdir(), "yut-spectator-qa.js"),
  loader: { ".woff": "file", ".woff2": "file", ".svg": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env.BASE_URL": '"/"' },
  plugins: [{ name: "spectator-fixture", setup(plugin) {
    plugin.onResolve({ filter: /^\/assets\// }, (args) => ({path:args.path,external:true}));
    plugin.onResolve({ filter: /(?:^|\/)lib\/yut$/ }, () => ({path:"service",namespace:"fixture"}));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({contents:service,loader:"ts",resolveDir:root}));
  }}],
});
const files = new Map(bundle.outputFiles.map(file => ["/"+path.basename(file.path),file.contents]));
const server = http.createServer(async (request,response) => {
  const url=new URL(request.url,"http://127.0.0.1");
  if(files.has(url.pathname)){
    response.setHeader("Content-Type",url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'font/woff2');
    response.end(files.get(url.pathname));return;
  }
  if(url.pathname.startsWith('/assets/')){
    const target=path.resolve(root,'public','.'+url.pathname);
    if(!target.startsWith(path.join(root,'public')+path.sep)){response.writeHead(403);response.end();return}
    try{response.end(await fs.readFile(target))}catch{response.writeHead(404);response.end()}return;
  }
  response.setHeader('Content-Type','text/html');
  response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/yut-spectator-qa.css"><style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#f8fafc;font-family:Arial,sans-serif}.fixture-shell{display:flex;flex-direction:column;max-width:1536px;height:calc(100dvh - 32px);margin:auto;background:white;border:1px solid #e5e7eb;border-radius:12px}.fixture-shell>header{padding:16px 24px;border-bottom:1px solid #e5e7eb;font-weight:bold}.fixture-body{flex:1;min-height:0;overflow:auto;padding:24px}@media(max-width:767px){.fixture-body{padding:16px}}</style><div id="root"></div><script type="module" src="/yut-spectator-qa.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge',headless:true});
const report={passed:false,checks:[],errors:[],layouts:{}};
async function open(width=1280,height=800){
  const page=await browser.newPage({viewport:{width,height}});
  await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(base);await page.waitForFunction(()=>window.qa?.listeners.length===1);return page;
}
const count=(page)=>page.evaluate(()=>({active:window.qa.active(),total:window.qa.listeners.length,intervals:window.qa.intervals.size,writes:window.qa.writes.length}));
async function confirm(page,id='room-a',status='playing'){
  await page.evaluate(({id,status})=>window.qa.confirm(window.qa.seed(id,status)),{id,status});await page.locator('.yut-board').waitFor();
}
try {
  const page=await open();
  assert.deepEqual(await count(page),{active:1,total:1,intervals:0,writes:0});
  assert.equal(await page.locator('.yut-board').count(),0,'No board before server confirmation');
  await confirm(page);
  assert.equal(await page.locator('.yut-spectator button:enabled').count(),0,'Board has no playable controls');
  assert.equal(await page.locator('.yut-isometric-destination').count(),0);
  assert.equal(await page.locator('.yut-isometric-piece').count(),4);
  assert.equal((await count(page)).intervals,1);
  assert.equal(await page.getByRole('timer').getAttribute('aria-label'),'말 이동 남은 시간');
  await page.evaluate(()=>window.qa.hide(true));
  await page.waitForFunction(()=>window.qa.active()===0&&window.qa.intervals.size===0);
  assert.equal(await page.locator('.yut-board').count(),0);
  await page.evaluate(()=>window.qa.force(0,window.qa.seed()));
  assert.equal(await page.locator('.yut-board').count(),0,'Late callback cannot restore hidden room');
  await page.evaluate(()=>window.qa.hide(false));
  await page.waitForFunction(()=>window.qa.listeners.length===2);
  assert.equal(await page.locator('.yut-board').count(),0,'Resume clears board until server confirms');
  await confirm(page);
  await page.evaluate(()=>window.qa.cached());
  await page.locator('.yut-board').waitFor({state:'detached'});
  assert.equal((await count(page)).intervals,0);
  await confirm(page);
  await page.evaluate(()=>window.qa.fail());
  await page.getByRole('button',{name:'다시 연결',exact:true}).waitFor();
  assert.equal((await count(page)).active,0);
  assert.equal(await page.locator('.yut-board').count(),0);
  await page.evaluate(()=>{window.qa.hide(true);window.qa.hide(false)});
  await page.waitForTimeout(100);
  assert.equal((await count(page)).total,2,'Visibility changes never auto-retry a denied subscription');
  await page.getByRole('button',{name:'다시 연결',exact:true}).click();
  await page.waitForFunction(()=>window.qa.listeners.length===3);
  assert.equal(await page.locator('.yut-board').count(),0);
  await confirm(page);
  for(const patch of [{actorKey:'teacher-b/2026/2/true'},{config:{year:'2026',semester:'1'}},{roomId:'room-b'}]){
    const before=await count(page);
    await page.evaluate(patch=>window.qa.setProps(patch),patch);
    await page.waitForFunction(total=>window.qa.listeners.length===total+1,before.total);
    assert.equal(await page.locator('.yut-board').count(),0,'Identity/scope/room changes clear old board');
    assert.equal((await count(page)).active,1,'Only selected room has a listener');
    await page.evaluate(index=>window.qa.force(index,window.qa.seed()),before.total-1);
    assert.equal(await page.locator('.yut-board').count(),0,'Old callback rejected after selection change');
    await confirm(page,patch.roomId||'room-a');
  }
  await page.evaluate(()=>{const room=window.qa.seed('room-b');room.expiresAtMs=Date.now()+120;window.qa.confirm(room)});
  await page.getByText('방 이용 시간이 지났습니다.',{exact:true}).waitFor();
  assert.equal((await count(page)).active,0);
  assert.equal((await count(page)).intervals,0);
  const expiredTotal=(await count(page)).total;
  await page.evaluate(()=>{window.qa.hide(true);window.qa.hide(false)});
  await page.waitForTimeout(100);
  assert.equal((await count(page)).total,expiredTotal,'Expired room never reconnects automatically');
  await page.evaluate(()=>window.qa.close());
  assert.equal((await count(page)).active,0);
  await page.evaluate(()=>window.qa.open());
  await page.waitForFunction(total=>window.qa.listeners.length===total+1,expiredTotal);
  await confirm(page,'room-b','waiting');
  assert.equal((await count(page)).intervals,0);
  assert.match(await page.locator('.yut-spectator-status').textContent(),/시작 대기/);
  await page.evaluate(()=>{const room=window.qa.seed('room-b','waiting');room.createdAtMs=Date.now()-600000+120;window.qa.confirm(room)});
  await page.getByText('방 이용 시간이 지났습니다.',{exact:true}).waitFor();
  assert.equal((await count(page)).active,0,'Waiting-room ten-minute fence releases its listener');
  assert.equal(await page.locator('.yut-board').count(),0);
  const waitingExpiredTotal=(await count(page)).total;
  await page.waitForTimeout(100);
  assert.equal((await count(page)).total,waitingExpiredTotal,'Waiting expiry does not poll or auto-retry');
  await page.getByRole('button',{name:'다시 연결',exact:true}).click();
  await page.waitForFunction(total=>window.qa.listeners.length===total+1,waitingExpiredTotal);
  assert.equal(await page.locator('.yut-board').count(),0,'Manual recovery awaits new server state');
  await confirm(page,'room-b','playing');
  assert.equal((await count(page)).active,1,'Playing snapshot can recover after delayed waiting-room start');
  await confirm(page,'room-b','finished');
  assert.match(await page.locator('.yut-spectator-status').textContent(),/박상대.*승리/);
  assert.equal((await count(page)).intervals,0,'Finished screen has no countdown or automatic command');
  await page.evaluate(()=>window.qa.confirm({...window.qa.seed('room-b'),status:'closed'}));
  await page.getByText('방이 닫혔습니다.',{exact:true}).waitFor();
  assert.equal((await count(page)).active,0);
  await page.evaluate(()=>{window.qa.close();window.qa.failSubscribe=true});
  await page.waitForTimeout(20);
  await page.evaluate(()=>window.qa.open());
  await page.getByRole('button',{name:'다시 연결',exact:true}).waitFor();
  assert.equal((await count(page)).active,0,'Synchronous listener error releases its unsubscribe');
  assert.equal(await page.evaluate(()=>window.qa.listeners.at(-1).stops),1);
  assert.equal((await count(page)).writes,0);
  await page.evaluate(()=>window.qa.close());
  assert.equal((await count(page)).active,0);
  await page.close();
  report.checks.push('One selected-room listener; hidden/unmount/scope/identity/room cleanup; cached and late snapshots cannot restore stale data; explicit error retry only; precise expiry cleanup; waiting/finished read-only; synchronous listener error cleanup; zero lobby/command writes');

  for(const [width,height] of [[390,844],[768,1024],[1280,800]]){
    const page=await open(width,height);await confirm(page);
    const layout=await page.evaluate(()=>{
      const box=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
      return{root:box('.yut-spectator'),board:box('.yut-spectator-board'),players:box('.yut-spectator-players'),body:box('.fixture-body'),overflow:document.documentElement.scrollWidth>innerWidth,labels:Array.from(document.querySelectorAll('.yut-spectator-players strong')).map(node=>({text:node.textContent,overflow:node.scrollWidth>node.clientWidth})),buttons:Array.from(document.querySelectorAll('.yut-spectator button')).map(node=>({disabled:node.disabled}))};
    });
    assert.equal(layout.overflow,false,`${width}: no horizontal page overflow`);
    assert.ok(layout.root.left>=0&&layout.root.right<=width+.5);
    assert.ok(layout.labels.every(item=>!item.overflow),`${width}: full player names fit`);
    assert.ok(layout.buttons.every(item=>item.disabled));
    if(width===1280)assert.ok(layout.players.left>=layout.board.right,`${width}: roster beside board`);
    else assert.ok(layout.players.top>=layout.board.bottom,`${width}: roster below board`);
    await page.screenshot({path:path.join(evidence,`spectator-${width}-${height}.png`)});
    report.layouts[`${width}x${height}`]=layout;
    await page.evaluate(()=>window.qa.confirm({...window.qa.seed(),phase:'throw',pendingThrow:null}));
    assert.equal(await page.getByRole('timer').getAttribute('aria-label'),'윷 던지기 남은 시간');
    assert.equal(await page.locator('.yut-spectator button:enabled').count(),0);
    await page.keyboard.press('Space');await page.keyboard.press('Enter');
    await page.evaluate(()=>window.qa.close());
    await page.waitForFunction(()=>window.qa.active()===0&&window.qa.intervals.size===0);
    assert.equal((await count(page)).active,0);
    assert.equal((await count(page)).intervals,0);
    assert.equal((await count(page)).writes,0);
    await page.close();
    report.checks.push(`${width}x${height}: readable board and full player names, correct responsive arrangement, throw/move display, no enabled gameplay controls or writes, close unsubscribes`);
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
} catch(error){
  report.failure=error.stack;
  for(const [index,page]of browser.contexts().flatMap(context=>context.pages()).entries())await page.screenshot({path:path.join(evidence,`failure-${index}.png`)}).catch(()=>{});
  throw error;
}finally{
  await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));await browser.close();server.close();
}
console.log(report.checks.join('\n'));
