/** Actual board/CSS and shared DTO; synthetic watcher only. No live services. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const output = path.join(root, "output/wispi-top-five-20261117/board");
await fs.mkdir(output, { recursive: true });
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const audited = [
  "src/pages/teacher/components/points/WisStockInvestmentBoard.tsx",
  "src/pages/teacher/components/points/WisStockInvestmentBoard.css",
  "src/pages/teacher/components/points/wisStockInvestmentReturns.ts",
  "functions/wisStockInvestmentBoard.mjs",
  "src/pages/teacher/components/points/WisStockReturnHistoryChart.tsx",
  "src/pages/teacher/components/points/WisStockReturnHistoryChart.css",
];
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      audited.map(async (file) => [
        file,
        createHash("sha256")
          .update(await fs.readFile(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
  );
const before = await hashes();
const services = `
import {normalizeWisStockInvestmentBoardScope as normalize,buildWisStockInvestmentBoard as build,
 parseWisStockInvestmentBoardSnapshot as parse} from ${imp("functions/wisStockInvestmentBoard.mjs")};
const listeners=[];
export const qa=window.boardQa={subscriptions:0,stops:0,scopes:[],last:null};
let rows=Array.from({length:50},(_,i)=>({studentKey:'student_'+(i+1).toString(16).padStart(24,'0'),
 grade:'3',classNumber:i<25?'1':'2',studentNumber:String(i%25+1),displayName:'검증학생'+String(i+1).padStart(2,'0'),
 stockCash:1000+(i+1)*10,reservedCash:100+i+1,holdingCount:1,holdingValue:500+(i+1)*20,
 holdingCostBasis:600+(i+1)*5,realizedPnl:(i+1-25)*3}));
qa.setRows=next=>{rows=next};
qa.push=(mode='READY',revision=1)=>{for(const listener of listeners.filter(item=>item.active)){
 const scope=listener.scope;let raw=null;
 if(mode!=='NOT_READY')raw=build({scope,revision,asOfMs:1794787200000+revision*1000,sourceRevision:revision,priceRevision:revision,
 classes:scope.grade?[{grade:scope.grade,classNumber:scope.classNumber}]:[{grade:'3',classNumber:'1'},{grade:'3',classNumber:'2'}],
 rows:mode==='EMPTY'?[]:rows.filter(row=>!scope.grade||row.grade===scope.grade&&row.classNumber===scope.classNumber)});
 qa.last=raw;listener.onConnection('CONNECTED');listener.onData(parse(raw,scope));
}};
qa.connection=state=>listeners.filter(item=>item.active).forEach(item=>item.onConnection(state));
qa.fail=()=>listeners.filter(item=>item.active).forEach(item=>{item.stop();item.onError(new Error('투자 현황 조회 권한이나 로그인 상태를 확인해 주세요.'));});
qa.active=()=>listeners.filter(item=>item.active).length;
qa.pricePush=raw=>{qa.last=raw;listeners.filter(item=>item.active).forEach(item=>item.onData(parse(raw,item.scope)));};
export function watchWisStockInvestmentBoard(input,onData,onConnection,onError){
 const scope=normalize(input),listener={scope,onData,onConnection,onError,active:true,stop(){if(listener.active){listener.active=false;qa.stops++;}}};
 listeners.push(listener);qa.subscriptions++;qa.scopes.push(scope);onConnection('CONNECTING');return listener.stop;
}`;
const entry = `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import Board from ${imp("src/pages/teacher/components/points/WisStockInvestmentBoard.tsx")};
import{qa}from ${imp("src/lib/wisStockInvestmentBoardClient")};
import ${imp("src/assets/index.css")};
import ${imp("src/pages/teacher/components/points/TeacherWisStocks.css")};
function App(){const[mounted,setMounted]=useState(true),[account,setAccount]=useState(1),[scope,setScope]=useState({year:'2026',semester:'2'});
 qa.leave=()=>setMounted(false);qa.enter=()=>setMounted(true);qa.switchAccount=()=>setAccount(value=>value+1);
 qa.switchSemester=()=>setScope({year:'2027',semester:'1'});
 return <><aside className="fixture-teacher-rail" aria-hidden="true">교사</aside><aside className="fixture-village-rail" aria-hidden="true">위스<br/>마을</aside>
 <main className="ws-page wis-stocks"><h1>학생 투자 현황</h1>{mounted&&<Board key={account+':'+scope.year+':'+scope.semester} {...scope}/>}</main></>;
}createRoot(document.getElementById('root')).render(<App/>);`;
const historyService = `
export async function getWisStockInvestmentHistories(scope){
 const qa=window.boardQa;qa.historyRequests??=[];qa.historyRequests.push(scope);
 if(qa.historyFailure)throw new Error('Synthetic history error');
 const results=scope.studentKeys.map(studentKey=>{
 const row=qa.last.rows.find(row=>row.studentKey===studentKey);
 const asOfMs=qa.last.asOfMs;
 const points=[{atMs:asOfMs-3600000,holdingValue:1000,holdingCostBasis:1000},
 {atMs:asOfMs-2400000,holdingValue:1200,holdingCostBasis:1000},
 {atMs:asOfMs-1800000,holdingValue:null,holdingCostBasis:null},
 {atMs:asOfMs-1200000,holdingValue:800,holdingCostBasis:1000},
 {atMs:asOfMs,holdingValue:row.holdingValue,holdingCostBasis:row.holdingCostBasis}];
 const result={semesterId:scope.year+'-'+scope.semester,studentKey,
 grade:row.grade,classNumber:row.classNumber,asOfMs,sourceRevision:qa.last.revision,priceRevision:qa.last.priceRevision,
 points:qa.historyMode==='empty'||(qa.historyMode==='partial'&&studentKey===scope.studentKeys[0])?[]:qa.historyMode==='single'?points.slice(-1):points,incompleteBeforeMs:null};
 return result;});
 if(qa.holdHistory){qa.holdHistory=false;await new Promise(resolve=>qa.releaseHistory=resolve);}
 return results;
}
export function wisStockInvestmentHistoryError(){return '수익률 기록을 불러오지 못했습니다. 다시 시도해 주세요.';}
`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  outfile: "board.js",
  loader: { ".svg": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "synthetic-board",
      setup(plugin) {
        plugin.onResolve({ filter: /lib\/wisStockInvestmentHistoryClient$/ }, () => ({ path: "history", namespace: "history-fixture" }));
        plugin.onLoad({ filter: /.*/, namespace: "history-fixture" }, () => ({ contents: historyService, loader: "tsx", resolveDir: root }));
        plugin.onResolve(
          { filter: /lib\/wisStockInvestmentBoardClient$/ },
          () => ({ path: "watcher", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: services,
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(
    /@import\s+(?:url\(["']?https?:[^)]*\)|["']https?:[^"']*["'])\s*;/g,
    "",
  );
const tailwind = await fs.readFile(
  process.env.WIS_WALLET_QA_TAILWIND ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/qa.css"><style>body{margin:0;background:#f3f4f6}*{box-sizing:border-box}main.ws-page{padding:16px!important}main>h1{font-size:24px;margin:0 0 12px}.fixture-teacher-rail,.fixture-village-rail{display:none}@media(min-width:1024px){.fixture-teacher-rail,.fixture-village-rail{display:block;position:fixed;top:0;bottom:0;padding:16px 8px;font-size:14px;background:#fff}.fixture-teacher-rail{left:0;width:128px}.fixture-village-rail{left:128px;width:64px;background:#f8fafc}main.ws-page{margin-left:192px!important;width:calc(100% - 192px)!important}}</style><div id="root"></div><script type="module" src="/qa.js"></script></html>';
const server = http.createServer((req, res) => {
  const file = {
    "/qa.js": ["text/javascript", js],
    "/qa.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  }[new URL(req.url, "http://localhost").pathname] || ["text/html", html];
  res.setHeader("Content-Type", file[0] + ";charset=utf-8");
  res.end(file[1]);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const errors = [],
  blocked = [],
  checks = [],
  layouts = [];
let failure;
async function open(width = 1440, reducedMotion = "no-preference") {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    reducedMotion,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(origin)) return route.continue();
    blocked.push(route.request().url());
    return route.abort();
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.boardQa?.subscriptions === 1);
  return page;
}
const rows = (page) => page.locator(".wis-investment-board tbody tr");
const firstName = (page) => rows(page).first().locator("td").nth(2).innerText();
const stats = (page) => page.locator(".wis-investment-board__stats");
async function push(page, mode = "READY", revision = 1) {
  await page.evaluate(
    ([mode, revision]) => window.boardQa.push(mode, revision),
    [mode, revision],
  );
  await page.waitForFunction(
    (mode) =>
      mode === "READY"
        ? document.querySelectorAll(".wis-investment-board tbody tr").length > 0
        : document.querySelectorAll(".wis-investment-board tbody tr").length ===
          0,
    mode,
  );
}
async function assertBlank(page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".wis-investment-board tbody tr").length === 0,
  );
  assert.equal(await rows(page).count(), 0);
  assert.equal(await page.locator(".wis-investment-board__returns").count(), 0);
  assert.equal(
    await stats(page).locator("strong").filter({ hasText: "—" }).count(),
    6,
  );
}
try {
  for (const width of [320, 390, 768, 1280]) {
    const page = await open(width);
    await assertBlank(page); await push(page);
    await page.locator('.wis-return-history__plot').first().waitFor();
    assert.equal(await rows(page).count(),20);
    assert.equal(await firstName(page),'검증학생01');
    assert.equal(await page.locator('.wis-return-history__legend li').count(),5);
    assert.equal(await page.locator('.wis-return-history__legend strong').first().innerText(),'1. 검증학생50');
    assert.equal(await page.locator('.wis-return-history__legend li > span').first().innerText(),'+76.47%');
    assert.equal(await page.locator('.wis-return-history__plot').count(),5);
    assert.equal(await page.locator('.wis-return-history__plot polyline').count(),10,'each missing-price gap splits its line');
    assert.equal(await page.locator('.wis-investment-board__returns-bar, .wis-investment-board__history, .wis-investment-board__mask').count(),0);
    assert.equal(await page.getByLabel('수익률 확인 학생',{exact:true}).count(),0);
    assert.equal(await page.getByLabel('이름 숨김',{exact:true}).count(),0);
    assert.deepEqual(await page.evaluate(()=>window.boardQa.historyRequests.map(r=>r.studentKeys.length)),[5]);
    const layout=await page.locator('.wis-investment-board').evaluate(el=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,
      toolbarBackground:getComputedStyle(el.querySelector('.wis-investment-board__toolbar')).backgroundColor,
      headingBackground:getComputedStyle(el.querySelector('.wis-investment-board__returns-heading')).backgroundColor,
      shadow:getComputedStyle(el.querySelector('.wis-investment-board__returns-heading')).boxShadow,
      chartWidth:el.querySelector('.wis-return-history__canvas').getBoundingClientRect().width,boardWidth:el.getBoundingClientRect().width}));
    assert(layout.documentWidth<=width,JSON.stringify(layout));assert(layout.chartWidth<=layout.boardWidth);
    assert.equal(layout.toolbarBackground,'rgba(0, 0, 0, 0)');assert.equal(layout.headingBackground,'rgba(0, 0, 0, 0)');assert.equal(layout.shadow,'none');layouts.push(layout);
    const chart=page.locator('.wis-return-history__canvas');await chart.focus();await chart.press('Home');
    assert.equal(await page.locator('.wis-return-history__tooltip').getAttribute('data-return'),'0');await chart.press('ArrowRight');
    assert.equal(await page.locator('.wis-return-history__tooltip').getAttribute('data-return'),'20');await chart.press('ArrowRight');
    assert.match(await page.locator('.wis-return-history__tooltip').innerText(),/시세 기록 없음/);await chart.press('ArrowDown');
    assert.match(await page.locator('.wis-return-history__tooltip').innerText(),/검증학생49/);await chart.press('Escape');
    assert.equal(await page.locator('.wis-return-history__tooltip').count(),0);
    await page.screenshot({path:path.join(output,'board-'+width+'.png'),fullPage:true});
    await page.evaluate(()=>window.boardQa.setRows(window.boardQa.last.rows.map((row,index)=>({...row,displayName:index===49?'김이름이아주길어도생략하지않는학생':row.displayName}))));
    await push(page,'READY',2);await page.locator('.wis-return-history__legend strong').first().waitFor();
    assert.equal(await page.locator('.wis-return-history__legend strong').first().innerText(),'1. 김이름이아주길어도생략하지않는학생');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(output,'board-long-name-'+width+'.png'),fullPage:true});
    await page.close();
  }
  checks.push('320/390/768/1280px: exactly five real history series; one bounded request; missing-price gaps; no bar/individual selector/mask; transparent headers; long full names without page overflow; keyboard exact-point and per-student inspection.');
  const page=await open();await push(page);await page.locator('.wis-return-history__plot').first().waitFor();
  const requested=await page.evaluate(()=>window.boardQa.historyRequests[0].studentKeys);
  const plotted=await page.locator('.wis-return-history__plot').evaluateAll(items=>items.map(item=>item.dataset.studentKey).sort());assert.deepEqual(requested,plotted);
  await page.getByLabel('투자 현황 정렬',{exact:true}).selectOption('assets');await page.getByRole('button',{name:'다음',exact:true}).click();
  assert.equal(await firstName(page),'검증학생30');assert.equal(await page.evaluate(()=>window.boardQa.historyRequests.length),1);
  // A price-only board notification has a stable source revision and adds real points without a ledger reread.
  const dots=await page.locator('.wis-return-history__plot circle').count();
  await page.evaluate(()=>{ const raw={...window.boardQa.last,revision:2,priceRevision:2,asOfMs:window.boardQa.last.asOfMs+1000};window.boardQa.pricePush(raw); });
  await page.waitForFunction(n=>document.querySelectorAll('.wis-return-history__plot circle').length===n+5,dots);
  assert.equal(await page.evaluate(()=>window.boardQa.historyRequests.length),1);
  await page.getByRole('button',{name:'수익률 기록 새로고침',exact:true}).click();await page.waitForFunction(()=>window.boardQa.historyRequests.length===2);
  await page.getByLabel('투자 현황 학급',{exact:true}).selectOption('3:1');await assertBlank(page);await push(page);
  await page.locator('.wis-return-history__plot').first().waitFor();assert.equal(await page.locator('.wis-return-history__legend strong').first().innerText(),'1. 검증학생25');
  assert.deepEqual(await page.evaluate(()=>[window.boardQa.historyRequests.at(-1).grade,window.boardQa.historyRequests.at(-1).classNumber,window.boardQa.historyRequests.at(-1).studentKeys.length]),['3','1',5]);
  await page.getByRole('button',{name:'전광판 보기',exact:true}).click();await page.waitForFunction(()=>Boolean(document.fullscreenElement));
  assert.equal(await firstName(page),'검증학생25');assert.equal(await page.getByLabel('이름 숨김',{exact:true}).count(),0);
  await page.getByRole('button',{name:'전체 화면 닫기',exact:true}).click();await page.waitForFunction(()=>!document.fullscreenElement);
  for(const connection of ['PAUSED','OFFLINE','CONNECTING']){await page.evaluate(state=>window.boardQa.connection(state),connection);await assertBlank(page);await push(page);}
  await page.evaluate(()=>window.boardQa.switchSemester());await assertBlank(page);await push(page);await page.locator('.wis-return-history__plot').first().waitFor();
  assert.equal(await page.evaluate(()=>window.boardQa.historyRequests.at(-1).year),'2027');
  await page.evaluate(()=>window.boardQa.leave());await page.waitForFunction(()=>window.boardQa.active()===0);await page.close();
  checks.push('Requests match only ranked five; sorting/pagination do not reread; price-only live observations retain real points without history requests; refresh one request; class/semester/offline scope changes clear prior histories; native fullscreen keeps names.');
  const states=await open(390);await states.evaluate(()=>{window.boardQa.holdHistory=true;});await push(states);
  await states.waitForFunction(()=>Boolean(window.boardQa.releaseHistory));assert.match(await states.locator('.wis-investment-board__returns').innerText(),/기록을 확인/);
  await states.getByLabel('투자 현황 학급',{exact:true}).selectOption('3:1');await push(states);await states.locator('.wis-return-history__plot').first().waitFor();
  await states.evaluate(()=>window.boardQa.releaseHistory());assert.equal(await states.locator('.wis-return-history__legend strong').first().innerText(),'1. 검증학생25');
  for(const mode of ['single','empty']){await states.evaluate(mode=>{window.boardQa.historyMode=mode;},mode);await states.getByRole('button',{name:'수익률 기록 새로고침',exact:true}).click();
    await states.getByText(mode==='single'?'첫 기록입니다. 다음 기록부터 변화가 선으로 이어집니다.':'아직 수익률 기록이 없습니다.').waitFor();
    assert.equal(await states.locator('.wis-return-history__plot polyline').count(),0);assert.equal(await states.locator('.wis-return-history__plot circle').count(),mode==='single'?5:0);
  }
  await states.evaluate(()=>{window.boardQa.historyMode='partial';});await states.getByRole('button',{name:'수익률 기록 새로고침',exact:true}).click();await states.locator('.wis-return-history__plot').first().waitFor();
  assert.match(await states.locator('.wis-return-history__legend').innerText(),/기록 없음/);assert.equal(await states.locator('.wis-return-history__plot polyline').count(),8);
  await states.evaluate(()=>{window.boardQa.historyFailure=true;});await states.getByRole('button',{name:'수익률 기록 새로고침',exact:true}).click();
  await states.getByRole('button',{name:'수익률 기록 다시 조회',exact:true}).waitFor();assert.equal(await states.locator('.wis-return-history__canvas').count(),0);
  await states.evaluate(()=>{window.boardQa.historyFailure=false;window.boardQa.historyMode='';});await states.getByRole('button',{name:'수익률 기록 다시 조회',exact:true}).click();await states.locator('.wis-return-history__plot').first().waitFor();
  await states.evaluate(()=>window.boardQa.setRows(window.boardQa.last.rows.map(row=>({...row,holdingCount:0,holdingValue:0,holdingCostBasis:0}))));await push(states,'READY',4);
  await states.getByText('보유 주식이 있는 학생이 없습니다.').waitFor();assert.equal(await states.locator('.wis-return-history__canvas').count(),0);await states.close();
  checks.push('Loading, single-point, empty history, no holdings, failed request and explicit retry are visible; late prior-class response discarded.');
  for(const width of [320,390,768,1280]){
    const page=await open(width,'reduce');await push(page);await page.locator('.wis-return-history__plot').first().waitFor();
    await page.evaluate(()=>Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:async()=>{throw new DOMException('Synthetic rejection','NotAllowedError');}}));
    await page.getByRole('button',{name:'전광판 보기',exact:true}).click();await page.locator('dialog[open]').waitFor();
    assert.equal(await firstName(page),'검증학생01');assert.equal(await page.locator('.wis-return-history__legend strong').first().innerText(),'1. 검증학생50');
    assert(await page.locator('dialog[open]').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.screenshot({path:path.join(output,'board-dialog-'+width+'.png'),fullPage:true});await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='전광판 보기');assert.equal(await page.evaluate(()=>window.boardQa.subscriptions),1);await page.close();
  }
  checks.push('Fullscreen rejection fallback at four widths preserves every name, contains horizontal overflow, restores keyboard focus on Escape, and adds no watcher.');
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(await hashes(),before,'Source changed during QA');

} catch (error) {
  failure = error;
  console.error(error);
} finally {
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        passed: !failure,
        checks,
        layouts,
        errors,
        blocked,
        sourceHashes: before,
        realClient: false,
        syntheticWatcher: true,
        productionReads: 0,
        productionWrites: 0,
        failure: failure?.stack,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
if (failure) throw failure;
console.log(
  JSON.stringify({
    passed: checks.length,
    evidence: output,
    productionReads: 0,
    productionWrites: 0,
  }),
);
