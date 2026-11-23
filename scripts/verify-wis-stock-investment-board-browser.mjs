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
const output = path.join(root, "output/wispi-charts-20261117/investment");
await fs.mkdir(output, { recursive: true });
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const audited = [
  "src/components/common/WisStockLoadMore.tsx",
  "src/components/common/WisStockLoadMore.css",
  "src/pages/teacher/components/points/WisStockInvestmentBoard.tsx",
  "src/pages/teacher/components/points/WisStockInvestmentBoard.css",
  "src/pages/teacher/components/points/WisStockExchangeDisplay.tsx",
  "src/pages/teacher/components/points/WisStockExchangeDisplay.css",
  "src/pages/teacher/components/points/useWisStockExchangeDisplay.ts",
  "src/pages/teacher/components/points/wisStockDisplayBulletins.ts",
  "src/pages/teacher/components/points/WisStockQuotePrice.tsx",
  "src/pages/teacher/components/points/WisStockQuotePrice.css",
  "src/pages/teacher/components/points/WisStockQuotePages.tsx",
  "src/pages/teacher/components/points/WisStockQuotePages.css",
  "src/pages/teacher/components/points/WisStockQuoteHelp.tsx",
  "src/pages/teacher/components/points/WisStockTradeFeed.tsx",
  "src/pages/teacher/components/points/WisStockTradeFeed.css",
  "src/pages/teacher/components/points/WisStockMovement.tsx",
  "src/pages/teacher/components/points/useWisStockDisplayRows.ts",
  "src/pages/teacher/components/points/WisStockFlapFaces.tsx",
  "src/pages/teacher/components/points/WisStockFlapFaces.css",
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
 stockCash:1000+(i+1)*10,reservedCash:100+i+1,holdingCount:i===0?2:1,holdingValue:500+(i+1)*20,
 holdingCostBasis:600+(i+1)*5,realizedPnl:(i+1-25)*3}));
qa.setRows=next=>{rows=next};
qa.push=(mode='READY',revision=1)=>{for(const listener of listeners.filter(item=>item.active)){
 const scope=listener.scope;let raw=null;
 if(mode!=='NOT_READY')raw=build({scope,revision,asOfMs:1794787200000+revision*1000,sourceRevision:revision,priceRevision:revision,
 classes:scope.grade?[{grade:scope.grade,classNumber:scope.classNumber}]:[{grade:'3',classNumber:'1'},{grade:'3',classNumber:'2'}],
 rows:mode==='EMPTY'?[]:rows.filter(row=>!scope.grade||row.grade===scope.grade&&row.classNumber===scope.classNumber)
 .map(row=>qa.accountRevisions?{...row,...(qa.legacyKeys?.includes(row.studentKey)?{}:{accountRevision:qa.accountRevisions[row.studentKey]??1})}:row)});
 qa.last=raw;listener.onConnection('CONNECTED');listener.onData(parse(raw,scope));
}};
qa.connection=state=>listeners.filter(item=>item.active).forEach(item=>item.onConnection(state));
qa.fail=()=>listeners.filter(item=>item.active).forEach(item=>{item.stop();item.onError(new Error('투자 현황 조회 권한이나 로그인 상태를 확인해 주세요.'));});
qa.active=()=>listeners.filter(item=>item.active).length;
qa.pricePush=raw=>{qa.last=raw;listeners.filter(item=>item.active).forEach(item=>item.onData(parse(raw,item.scope)));};
export function watchWisStockExchange(year,semester,group,send){
 qa.displayStarts=(qa.displayStarts||0)+1;qa.displayActive=true;qa.displayGroup=group;
 const names=['조선상회','금강철도','한양은행','한글 이름이 긴 주식회사'];
 const stocks=Array.from({length:23},(_,i)=>({id:'S'+i,name:names[i]||'합성종목'+i,price:i===22?9876543:300+i*5,previousClose:i===22?9654321:300+i*5+[2,-2,0][i%3]}));
 const initialAt=Date.now();
 let market={updatedAtMs:initialAt,halted:false,index:{value:1052.16,previousClose:1034.5},stocks:qa.displayFixture??stocks.map(stock=>({...stock,previousPrice:stock.price-1,priceAtMs:initialAt-60_000}))};
 let trades=Array.from({length:20},(_,i)=>({id:'F'+i,displayName:i===0?'검증학생':'합성학생'+i,atMs:1794787200000-i*10000,stockName:'한양은행',side:i%2?'SELL':'BUY',quantity:i+2,unitPrice:340-i}));
 const emit=()=>{if(qa.displayActive)send({status:'ready',market,trades});};
 qa.displayTick=({prices={},prior={},legacy=false,index=market.index,added=[],halted=market.halted}={})=>{
   const atMs=market.updatedAtMs+1000;
   market={...market,updatedAtMs:atMs,index,halted,stocks:[...market.stocks.map(stock=>
     prices[stock.id]!==undefined&&prices[stock.id]!==stock.price
       ? {...stock,price:prices[stock.id],previousPrice:legacy?undefined:prior[stock.id]??stock.price,priceAtMs:legacy?undefined:atMs}:stock),...added]};emit();
 };
 let sequence=0;
 qa.displayTrade=(count=1)=>{
   const atMs=trades[0].atMs+1000;
   const added=Array.from({length:count},()=>{sequence++;return {...trades[0],atMs,id:'new'+sequence,displayName:sequence===1?'새체결학생':'새체결학생'+sequence};});
   trades=[...added.reverse(),...trades].slice(0,20);emit();
 };
 qa.replayTrades=()=>{trades=trades.map(trade=>({...trade}));emit();};
 qa.displayStatus=status=>{if(qa.displayActive)send({status});};
 emit();return()=>{qa.displayActive=false;qa.displayStops=(qa.displayStops||0)+1};
}
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
 return <><aside className="fixture-teacher-rail" aria-hidden="true">교사</aside>
 <main className="ws-page wis-stocks"><h1>학생 투자 현황</h1>{mounted&&<Board key={account} {...scope} displayMarket={{updatedAtMs:0,studentOpen:true,rules:{halted:false},stocks:[]}}/>}</main></>;
}createRoot(document.getElementById('root')).render(<App/>);`;
const historyService = `
export async function getWisStockInvestmentHistories(scope){
 const qa=window.boardQa;qa.historyRequests??=[];qa.historyRequests.push(scope);
 if(qa.historyFailure)throw new Error('Synthetic history error');
 const results=scope.studentKeys.map(studentKey=>{
 const row=qa.last.rows.find(row=>row.studentKey===studentKey);
 const asOfMs=qa.last.asOfMs;
 const points=[{atMs:asOfMs-40*86400000,holdingValue:700,holdingCostBasis:1000},
 {atMs:asOfMs-10*86400000,holdingValue:900,holdingCostBasis:1000},
 {atMs:asOfMs-2*86400000,holdingValue:950,holdingCostBasis:1000},
 {atMs:asOfMs-3600000,holdingValue:1000,holdingCostBasis:1000},
 {atMs:asOfMs-2400000,holdingValue:1200,holdingCostBasis:1000},
 {atMs:asOfMs-1800000,holdingValue:null,holdingCostBasis:null},
 {atMs:asOfMs-1200000,holdingValue:800,holdingCostBasis:1000},
 {atMs:asOfMs,holdingValue:row.holdingValue,holdingCostBasis:row.holdingCostBasis}];
 const result={semesterId:scope.year+'-'+scope.semester,studentKey,
 grade:row.grade,classNumber:row.classNumber,asOfMs,sourceRevision:qa.detailsRevision??row.accountRevision??qa.last.revision,priceRevision:qa.last.priceRevision,
 holdings:Array.from({length:row.holdingCount},(_,i)=>({stockId:'stock_'+String(i+1).padStart(24,'0'),name:i?'보유 종목 2':'역사 속 교류와 산업의 발전을 함께 살펴보는 긴 이름의 합성 기업',quantity:(qa.holdingQuantity||3)+i*2})),
 points:qa.historyMode==='null'?points.map(point=>({...point,holdingValue:null,holdingCostBasis:null})):qa.historyMode==='empty'||(qa.historyMode==='partial'&&studentKey===scope.studentKeys[0])?[]:qa.historyMode==='single'?points.slice(-1):points,incompleteBeforeMs:null};
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
  loader: { ".svg": "dataurl", ".webp":"dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "synthetic-board",
      setup(plugin) {
        plugin.onResolve(
          { filter: /lib\/wisStockInvestmentHistoryClient$/ },
          () => ({ path: "history", namespace: "history-fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "history-fixture" }, () => ({
          contents: historyService,
          loader: "tsx",
          resolveDir: root,
        }));
        plugin.onResolve(
          { filter: /lib\/wisStockInvestmentBoardClient$|lib\/wisStockExchangeDisplayClient$/ },
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
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/qa.css"><style>body{margin:0;background:#f3f4f6}*{box-sizing:border-box}main.ws-page{padding:16px!important}main>h1{font-size:24px;margin:0 0 12px}.fixture-teacher-rail{display:none}@media(min-width:1024px){.fixture-teacher-rail{display:block;position:fixed;top:0;bottom:0;padding:16px 8px;font-size:14px;background:#fff}.fixture-teacher-rail{left:0;width:232px}main.ws-page{margin-left:232px!important;width:calc(100% - 232px)!important}}</style><div id="root"></div><script type="module" src="/qa.js"></script></html>';
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
const rows = (page) => page.locator(".wis-investment-board__student");
const firstName = (page) =>
  rows(page)
    .first()
    .locator(".wis-investment-board__identity strong")
    .innerText();
const stats = (page) => page.locator(".wis-investment-board__stats");
const countRequests = (page) =>
  page.evaluate(() => window.boardQa.historyRequests?.length || 0);
const plotted = (page) => page.locator(".wis-return-history__plot");
const dots = (page) => page.locator(".wis-return-history__plot circle").count();
async function push(page, mode = "READY", revision = 1) {
  await page.evaluate(
    ([mode, revision]) => window.boardQa.push(mode, revision),
    [mode, revision],
  );
  await page.waitForFunction(
    (mode) =>
      Boolean(document.querySelector(".wis-investment-board__student")) ===
      (mode === "READY"),
    mode,
  );
}
async function chartReady(page, count = 5) {
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".wis-return-history__plot").length === count,
    count,
  );
}
async function assertBlank(page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".wis-investment-board__student").length === 0,
  );
  assert.equal(await plotted(page).count(), 0);
  assert.equal(
    await stats(page).locator("strong").filter({ hasText: "—" }).count(),
    6,
  );
}
const period = (page, name) =>
  page
    .locator(".wis-investment-board__chart-controls")
    .getByRole("button", { name, exact: true });

const stockRows = ".wis-exchange__quote-grid > li[data-quote-id]";
const fillRows = ".wis-exchange__trade-window > ol > li";
const fillNames = fillRows + " > .wis-exchange__trade-content .wis-exchange__trade-head strong";
async function afterLayout(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function quoteGeometry(display) {
  return display.evaluate(dialog => {
    const box = node => {
      const {x, y, width, height} = node.getBoundingClientRect();
      return {x, y, width, height};
    };
    return {
      heading: box(dialog.querySelector('.wis-exchange__quote-heading')),
      window: box(dialog.querySelector('.wis-exchange__quote-window')),
      rows: [...dialog.querySelectorAll('.wis-exchange__quote-grid > li[data-quote-id]')].map(box),
    };
  });
}
function assertStableQuotes(before, after, reason) {
  const sameBox = (first, second, label) => {
    for (const key of ['x', 'y', 'width', 'height']) {
      assert(Math.abs(first[key] - second[key]) < 1, `${reason}: ${label}.${key}: ${first[key]} -> ${second[key]}`);
    }
  };
  sameBox(before.heading, after.heading, 'heading');
  sameBox(before.window, after.window, 'quote window');
  for (let i = 0; i < Math.min(before.rows.length, after.rows.length); i++) {
    sameBox(before.rows[i], after.rows[i], `row ${i}`);
  }
}
async function checkQuoteHelp(page, display) {
  const info = display.getByRole('button', {name:'종목 시세 표시 기준', exact:true});
  await info.hover();
  await info.focus();
  assert.equal(await info.getAttribute('aria-expanded'), 'false', 'quote help opens only on activation');
  const before = await quoteGeometry(display);
  await info.click();
  assert.equal(await info.getAttribute('aria-expanded'), 'true');
  const popup = display.locator('[id="' + await info.getAttribute('aria-controls') + '"]');
  await popup.waitFor({state:'visible'});
  for (const term of ['현재가', '전일 대비', '위스']) assert((await popup.innerText()).includes(term));
  assert(await popup.evaluate(node => !document.fullscreenElement || document.fullscreenElement.contains(node)), 'quote help belongs to the fullscreen subtree');
  assertStableQuotes(before, await quoteGeometry(display), 'opening help');
  await page.keyboard.press('Escape');
  assert.equal(await info.getAttribute('aria-expanded'), 'false');
  assert(await display.isVisible(), 'help Escape leaves the exchange open');
  await info.press('Enter');
  assert.equal(await info.getAttribute('aria-expanded'), 'true');
  await display.locator('.wis-exchange__bar h2').click();
  assert.equal(await info.getAttribute('aria-expanded'), 'false', 'outside click closes quote help');
  await info.press('Enter');
  await page.keyboard.press('Tab');
  assert.equal(await info.getAttribute('aria-expanded'), 'false', 'focus leaving closes quote help');
  assertStableQuotes(before, await quoteGeometry(display), 'closing help');
  const heading = await display.locator('.wis-exchange__quote-heading').evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return {height:bounds.height, scroll:node.scrollWidth, width:node.clientWidth, children:[...node.children].map(child=>({top:child.getBoundingClientRect().top,bottom:child.getBoundingClientRect().bottom})),top:bounds.top,bottom:bounds.bottom};
  });
  assert(heading.height <= 48 && heading.scroll <= heading.width + 1, JSON.stringify(heading));
  assert(heading.children.every(child=>child.top>=heading.top-1&&child.bottom<=heading.bottom+1), 'one-row quote heading');
}
async function checkBoardFit(display, kind) {
  const problems = await display.evaluate((dialog, kind) => {
    const board = dialog.querySelector(".wis-exchange");
    const panel = board.querySelector(kind === "quotes" ? ".wis-exchange__quote-window" : ".wis-exchange__trade-window");
    const selector = kind === "quotes" ? ".wis-exchange__quote-grid > li[data-quote-id]" : "ol > li";
    const windowBox = panel.getBoundingClientRect();
    const outside = (element, bounds) => {
      const rect = element.getBoundingClientRect();
      return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 ||
        rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1;
    };
    const regions = [board, panel, board.querySelector(".wis-exchange__index")];
    const failed = [];
    const surge = board.querySelector(".wis-exchange__surge");
    if (surge) {
      const list = surge.querySelector(".wis-exchange__surge-page > ul");
      if (["auto","scroll"].includes(getComputedStyle(list).overflowY) ||
          [...list.children].some(row => outside(row,surge.getBoundingClientRect())))
        failed.push(["scrolling or clipped surge headlines"]);
    }
    for (const node of regions) {
      if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)
        failed.push([node.className, node.scrollHeight, node.clientHeight, node.scrollWidth, node.clientWidth]);
    }
    if (outside(panel, {left:0, top:0, right:innerWidth, bottom:innerHeight}))
      failed.push(["panel outside viewport", windowBox.toJSON()]);
    for (const row of panel.querySelectorAll(selector)) {
      if (outside(row, windowBox)) failed.push(["clipped row", row.textContent, row.getBoundingClientRect().toJSON(), windowBox.toJSON()]);
      for (const field of row.querySelectorAll(".wis-exchange__movement, .wis-exchange__quote-name, .wis-exchange__trade-content")) {
        if (field.closest("[aria-hidden=true]")) continue;
        if (field.scrollWidth > field.clientWidth + 1 || outside(field, row.getBoundingClientRect()))
          failed.push(["clipped field", field.className, field.textContent]);
      }
    }
    return failed;
  }, kind);
  assert.deepEqual(problems, [], kind + " page should fit the viewport without clipping or scrolling");
}
async function visitQuotePages(page, display) {
  const quotes = display.locator(stockRows);
  const next = display.getByRole("button", {name:"다음 종목 페이지", exact:true});
  const seen = new Set();
  const geometry = await quoteGeometry(display);
  for (let pageNumber = 0; pageNumber < 24; pageNumber++) {
    const ids = await quotes.evaluateAll(cells => cells.map(cell => cell.dataset.quoteId));
    if (pageNumber && ids[0] === "S0") break;
    await checkBoardFit(display, "quotes");
    assertStableQuotes(geometry, await quoteGeometry(display), 'quote page transition');
    for (const id of ids) { assert(!seen.has(id), "repeated quote " + id); seen.add(id); }
    if (!(await next.count())) break;
    await next.press("Enter");
    await page.waitForFunction(({selector, first}) => document.querySelector(selector)?.dataset.quoteId !== first, {selector:stockRows, first:ids[0]});
    await afterLayout(page);
    await page.clock.fastForward(1_200);
    await afterLayout(page);
    assertStableQuotes(geometry, await quoteGeometry(display), 'settled quote page');
  }
  assert.deepEqual([...seen], Array.from({length:23}, (_,i) => "S" + i), "all listed quotes reachable in source order");
  assert.equal(await quotes.first().getAttribute("data-quote-id"), "S0", "quote pages wrap to first");
}
async function visitTradePages(page, display) {
  const next = display.getByRole("button", {name:"다음 체결 페이지",exact:true});
  const previous = display.getByRole("button", {name:"이전 체결 페이지",exact:true});
  const names = display.locator(fillNames);
  const all = [];
  while (all.length < 20) {
    await checkBoardFit(display, "trades");
    const visible = await names.allTextContents();
    assert(visible.length && !all.includes(visible[0]), "older trade page advances");
    all.push(...visible);
    if (all.length < 20) { await next.press("Enter"); await afterLayout(page); }
  }
  assert.deepEqual(all, Array.from({length:20},(_,i) => i ? "합성학생"+i : "검증학생"));
  assert(!await next.isEnabled(), "oldest trade page ends at the 20th entry");
  while (await previous.isEnabled()) { await previous.press("Enter"); await afterLayout(page); }
  assert.equal(await names.first().innerText(), "검증학생");
}
async function waitForVisibleRotation(page, selector) {
  await page.waitForFunction(selector => [...document.querySelectorAll(selector)].some(face => {
    const style = getComputedStyle(face);
    if (!face.getClientRects().length || style.visibility !== "visible" || style.transform === "none") return false;
    // An intermediate X rotation proves that an actual rendered face is moving.
    const tilt = Math.abs(new DOMMatrixReadOnly(style.transform).m23);
    return tilt > 0.01 && tilt < 0.99;
  }), selector, { timeout: 2000 });
}
async function checkAutomaticQuotePages(page, display) {
  const quotes = display.locator(stockRows);
  const first = await quotes.first().getAttribute("data-quote-id");
  const oldName = await quotes.first().locator(".wis-exchange__quote-name").first().textContent();
  await page.clock.fastForward(8_050);
  await page.waitForFunction(({selector, first}) => document.querySelector(selector)?.dataset.quoteId !== first, {selector:stockRows, first});
  const incoming = quotes.first().locator(".wis-ticker-tile__current .wis-exchange__quote-name");
  const expectedName = await incoming.textContent();
  assert.notEqual(expectedName, oldName);
  const frames = await quotes.evaluateAll(cells => cells.slice(0, 3).map(cell => {
    const fold=cell.querySelector(".wis-flap__fold"), unfold=cell.querySelector(".wis-flap__unfold");
    const turning = face => !!face && face.getAnimations().some(a => a.effect.getKeyframes().some(k => String(k.transform).includes("rotateX")));
    return {old:fold?.textContent, next:unfold?.textContent, delay:fold && parseFloat(getComputedStyle(fold).animationDelay), turning:turning(fold)&&turning(unfold)};
  }));
  assert(frames[0].old?.includes(oldName) && frames[0].next?.includes(expectedName) && frames[0].turning, JSON.stringify(frames));
  if (frames.length >= 3) assert(frames[0].delay === frames[1].delay && frames[0].delay < frames[2].delay);
  await waitForVisibleRotation(page, ".wis-ticker-tile__turn .wis-flap__fold");
  await display.getByRole("button",{name:"종목 자동 넘김 일시정지",exact:true}).click();
  const paused = await quotes.first().getAttribute("data-quote-id");
  await page.clock.fastForward(16_100);
  assert.equal(await quotes.first().getAttribute("data-quote-id"), paused, "automatic paging pauses");
  const next = display.getByRole("button",{name:"다음 종목 페이지",exact:true});
  for (let i = 0; i < 23 && await quotes.first().getAttribute("data-quote-id") !== first; i++) {
    await next.press("Enter"); await afterLayout(page);
  }
  assert.equal(await quotes.first().getAttribute("data-quote-id"),first);
}
async function checkLiveExchange(page, display, surge) {
  const quotes = display.locator(stockRows);
  const trades = display.locator(fillRows);
  const names = display.locator(fillNames);
  const start = await names.allTextContents();
  const movement = await page.evaluate(async ({selector, names}) => {
    window.boardQa.displayTrade();
    await new Promise(requestAnimationFrame);
    const fills = document.querySelectorAll(selector);
    const motions = node => node?.getAnimations().flatMap(a => a.effect?.getKeyframes().map(frame=>String(frame.transform)));
    return {
      names: Array.from(document.querySelectorAll(names), name=>name.textContent),
      fold: motions(fills[0]?.querySelector(".wis-flap__fold")),
      unfold: motions(fills[0]?.querySelector(".wis-flap__unfold")),
      shift: motions(fills[1]),
    };
  }, {selector:fillRows, names:fillNames});
  assert.deepEqual(movement.names,["새체결학생", ...start.slice(0,-1)]);
  assert(movement.fold?.some(frame=>frame.includes("rotateX")) && movement.unfold?.some(frame=>frame.includes("rotateX")), JSON.stringify(movement));
  assert(movement.shift?.some(frame=>frame.includes("translate")), "previous first trade moves down into row two");
  await page.waitForFunction(selector => {
    const row = document.querySelectorAll(selector)[1];
    const transform = getComputedStyle(row).transform;
    return transform !== "none" && new DOMMatrixReadOnly(transform).m42 < -1;
  }, fillRows, {timeout: 2000});
  await trades.first().locator(".wis-flap__fold").waitFor({state:"detached"});
  await page.evaluate(() => window.boardQa.replayTrades());
  await afterLayout(page);
  assert.equal(await trades.locator(".wis-flap__fold").count(), 0, "repeated snapshot does not animate");
  await display.getByRole("button",{name:"다음 체결 페이지",exact:true}).press("Enter");
  await page.evaluate(() => window.boardQa.displayTrade(2));
  await names.filter({hasText:"새체결학생3"}).waitFor();
  assert.deepEqual((await names.allTextContents()).slice(0,3), ["새체결학생3","새체결학생2","새체결학생"], "batch with tied timestamps returns to newest page in server order");
  assert(!(await surge.allTextContents()).join("").includes("새체결학생"), "trade rows do not become market popups");
  assert.equal(await quotes.locator(".wis-quote-price__fold").count(), 0, "trade does not turn quote flaps");

  // Check the full eight-second lifetime without waiting on real time for the timeout.
  const samples = await page.evaluate(async () => {
    window.boardQa.surgeStartedAt = Date.now();
    window.boardQa.displayTick({ prices: { S0: 315, S1: 310, S2: 341, S3: 310, S4: 321 } });
    await new Promise(requestAnimationFrame);
    return Array.from(document.querySelectorAll(".wis-exchange__quote-grid > li")).slice(0, 6).map(cell => {
      const top = cell.querySelector(".wis-quote-price__fold");
      const bottom = cell.querySelector(".wis-quote-price__unfold");
      if (!top || !bottom) return null;
      const times = node => {
        const css = getComputedStyle(node);
        return {
          delay: parseFloat(css.animationDelay), duration: parseFloat(css.animationDuration),
          hasRotation: node.getAnimations().some(animation =>
            animation.effect.getKeyframes().some(frame => String(frame.transform).includes("rotateX")),
          ),
        };
      };
      const glyphs = node => Array.from(node.querySelectorAll("path"), path => path.getAttribute("d")).join("|");
      const oldTop = glyphs(top), newBottom = glyphs(bottom);
      if (oldTop === newBottom || oldTop !== glyphs(cell.querySelector(".wis-quote-price__old-lower")) ||
          newBottom !== glyphs(cell.querySelector(".wis-quote-price__face"))) {
        throw new Error("The old and new segment faces must match their two respective halves");
      }
      return { top: times(top), bottom: times(bottom) };
    });
  });
  // Screenshots and DOM assertions must not consume the lifetime under test.
  // install() alone continues real time between explicit clock advances.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  const advanceSurgeTo = async elapsed => {
    const remaining = await page.evaluate(elapsed =>
      window.boardQa.surgeStartedAt + elapsed - Date.now(), elapsed);
    if (remaining > 0) await page.clock.fastForward(remaining);
  };
  assert(samples.slice(0, 5).every(sample => sample && sample.top.duration > 0 &&
    sample.top.hasRotation && sample.bottom.hasRotation && sample.bottom.delay > sample.top.delay), JSON.stringify(samples));
  assert.equal(samples[5], null, "an unchanged quote has no flip");
  const delays = samples.slice(0, 5).map(sample => sample.top.delay);
  assert.equal(delays[0], delays[1]);
  assert.equal(delays[2], delays[3]);
  assert(delays[0] < delays[2] && delays[2] < delays[4], "top-to-bottom row delays " + delays);
  await surge.waitFor();
  const headline = await surge.innerText();
  const surgePercentSize = await surge.locator("li > strong").first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  assert(surgePercentSize >= 38, "TV surge percentage font size " + surgePercentSize);
  for (const term of ["조선상회", "한양은행", "+5.00%", "+10.00%"]) assert(headline.includes(term), headline);
  for (const below of ["금강철도", "한글 이름이 긴 주식회사", "합성종목4"]) assert(!headline.includes(below), headline);
  await page.screenshot({ path: path.join(output, "board-dialog-surge-1920.png") });
  await advanceSurgeTo(5_000);
  await page.evaluate(() => window.boardQa.displayTrade());
  await advanceSurgeTo(7_000);
  assert(await surge.isVisible(), "alert still visible before eight seconds");
  await advanceSurgeTo(8_100);
  await surge.waitFor({ state: "hidden", timeout: 1_000 });
  await page.clock.resume();
  const first = quotes.first().locator(".wis-quote-price");
  assert.match(await first.textContent(), /315/);

  await page.evaluate(() => window.boardQa.displayTick({
    added: [{ id: "new", name: "신규상장", price: 700, previousClose: 100 }],
  }));
  await afterLayout(page);
  await display.getByRole("button", {name:"이전 종목 페이지",exact:true}).press("Enter");
  await quotes.locator(".wis-ticker-tile__current").getByText("신규상장").waitFor();
  await surge.waitFor();
  assert.match(await surge.innerText(), /신규\s*상장/);
  assert(!(await surge.innerText()).includes("+600.00%"), "a listing does not create a price jump from the previous close");
  await page.evaluate(() => window.boardQa.displayTick({prices:{S0:325}}));
  await display.getByRole("button", {name:"다음 종목 페이지",exact:true}).press("Enter");
  const currentFace = quotes.first().locator(".wis-ticker-tile__current");
  await currentFace.getByText("현재가 325위스").waitFor({state:"attached"});
  assert.equal(await currentFace.locator(".wis-quote-price__fold").count(),0,"returning to a stock does not replay its offscreen ticks");
  await page.evaluate(() => window.boardQa.displayStatus("paused"));
  await quotes.first().waitFor({ state: "hidden" });
  await page.evaluate(() => window.boardQa.displayTick({ prices: { S0: 500 }, prior: { S0: 499 } }));
  await first.waitFor();
  assert.match(await first.textContent(), /500/);
  assert(!(await surge.allTextContents()).join("").includes("+53.85%"), "the pre-pause price is not a confirmed prior tick");
  assert.equal(await quotes.locator(".wis-quote-price__fold").count(), 0);
  assert.equal(await trades.locator(".wis-flap__fold").count(), 0, "reconnection establishes a fresh feed baseline");
  await page.evaluate(() => {
    window.boardQa.displayTick({ prices: { S0: 501 } });
    window.boardQa.displayTick({ prices: { S0: 502 } });
  });
  await first.getByText("현재가 502위스").waitFor({ state: "attached" });
  await first.locator(".wis-quote-price__transition").waitFor({ state: "detached" });
  assert.match(await first.textContent(), /502/, "quick successive updates settle on the final price");
  await page.evaluate(() => window.boardQa.displayTick({prices:{S0:1004,S1:608,S2:614,S3:527,S4:513,S5:487}}));
  const headlines = surge.locator(".wis-exchange__surge-page > ul > li b");
  const reached = new Set();
  let sawBreak = false;
  for (let step = 0; step < 18 && reached.size < 6; step++) {
    await afterLayout(page);
    if (!await surge.isVisible()) sawBreak = true;
    for (const name of await headlines.allTextContents()) {
      if (["조선상회","금강철도","한양은행","한글 이름이 긴 주식회사","합성종목4","합성종목5"].includes(name)) reached.add(name);
    }
    if (!step) assert.deepEqual(await headlines.allTextContents(), ["조선상회","금강철도"]);
    if (step === 1) await waitForVisibleRotation(page, ".wis-exchange__surge-page .wis-flap__fold, .wis-exchange__surge-page .wis-flap__unfold");
    await checkBoardFit(display,"quotes");
    await page.clock.fastForward(4_010);
  }
  assert.equal(reached.size, 6, "all six eligible headlines return across bursts");
  assert(sawBreak, "bursts yield the view to the main board");
  const beforeBulletin = await quoteGeometry(display);
  await page.evaluate(() => window.boardQa.displayTick({prices:{S0:1000,S1:600,S2:600}}));
  await afterLayout(page);
  assert(!(await surge.allTextContents()).join("").includes("-0.40%"), 'a move smaller than 3% is not a rapid-move headline');
  await page.evaluate(() => window.boardQa.displayTick({prices:{S0:950,S1:660,S2:480}}));
  await surge.waitFor();
  assert.equal(await surge.locator('.wis-exchange__surge-heading strong').innerText(), '급등·급락 속보');
  assert.deepEqual(await headlines.allTextContents(), ['한양은행','금강철도'], 'mixed moves sort by absolute percentage');
  const mixed = surge.locator('.wis-exchange__surge-page > ul');
  assert((await mixed.locator('.is-down').innerText()).includes('-20.00%'));
  assert((await mixed.locator('.is-up').innerText()).includes('+10.00%'));
  const overlay = await surge.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const board = node.closest('.wis-exchange');
    const index = board.querySelector('.wis-exchange__index').getBoundingClientRect();
    return {width:rect.width,indexWidth:index.width,center:(rect.left+rect.right)/2,viewport:innerWidth,parent:node.parentElement.parentElement.className};
  });
  assert(overlay.width > overlay.indexWidth * 1.5 && Math.abs(overlay.center - overlay.viewport/2) < 1, JSON.stringify(overlay));
  assert.equal(overlay.parent,'wis-exchange','bulletin escapes the center column');
  assertStableQuotes(beforeBulletin, await quoteGeometry(display), 'mixed bulletin opens');
  await page.clock.fastForward(4_010);
  await afterLayout(page);
  await page.clock.fastForward(4_010);
  await surge.waitFor({state:'hidden', timeout:2000});
  assertStableQuotes(beforeBulletin, await quoteGeometry(display), 'mixed bulletin closes');
  await page.evaluate(() => window.boardQa.displayTick({prices:{S0:760}}));
  await surge.waitFor();
  assert.match(await surge.locator('.wis-exchange__surge-heading strong').innerText(), /급락 속보/);
  assert((await surge.locator('.wis-exchange__surge-page > ul > li').filter({hasText:"조선상회"}).innerText()).includes('-20.00%'));
  await page.evaluate(() => window.boardQa.displayTick({ halted: true, prices: { S0: 700 } }));
  await display.getByText("거래 정지", { exact: true }).waitFor();
  assert.equal(await surge.isVisible(), false);
  await page.evaluate(() => {
    window.boardQa.displayStatus("offline");
    window.boardQa.displayTrade();
  });
  await afterLayout(page);
  assert.equal(await names.first().textContent(),"새체결학생5");
  assert.equal(await trades.locator(".wis-flap__fold").count(),0,"a batched offline/reconnect snapshot is a baseline");
}

async function checkBulletinCycle(width, height) {
  const page = await open(width);
  await page.setViewportSize({width, height});
  await push(page);
  await chartReady(page);
  await page.evaluate(() => {
    const atMs = Date.now() - 60_000;
    window.boardQa.displayFixture = [
      {id:"rise", name:"오름상회", price:103, previousClose:103, previousPrice:100, priceAtMs:atMs},
      {id:"fall", name:"내림철도", price:97, previousClose:97, previousPrice:100, priceAtMs:atMs},
      {id:"listed", name:"새상회", price:800, previousClose:800, listedAtMs:atMs, listingPrice:800},
      {id:"old", name:"옛철도", price:200, previousClose:200, listedAtMs:atMs-86_400_000, listingPrice:100},
    ];
    Object.defineProperty(Element.prototype, "requestFullscreen", {configurable:true, value:undefined});
  });
  await page.clock.install();
  const show = () => page.getByRole("button", {name:"전광판 보기", exact:true}).click();
  await show();
  const display = page.getByRole("dialog", {name:"위스피 전광판"});
  const popup = display.locator(".wis-exchange__surge");
  const heading = popup.locator(".wis-exchange__surge-heading strong");
  const close = display.getByRole("button", {name:"전광판 닫기", exact:true});
  const reads = () => page.evaluate(() => [window.boardQa.subscriptions, window.boardQa.displayStarts, window.boardQa.historyRequests.length]);
  const budget = await reads();
  await heading.filter({hasText:"신규 상장"}).waitFor();
  const initial = await popup.innerText();
  for (const term of ["새상회", "상장가", "800"]) assert(initial.includes(term), initial);
  assert(!initial.includes("옛철도"), "a listing older than 24 hours is excluded");
  await page.screenshot({path:path.join(output, "board-listing-popup-" + width + ".png")});
  const pages = [];
  for (let i = 0; i < 16; i++) {
    const text = await popup.isVisible() ? await popup.innerText() : "";
    assert(!text.includes("검증학생") && !text.includes("매수") && !text.includes("매도"), "fills stay in the trade panel");
    assert(!text.includes("옛철도"));
    if (text !== pages.at(-1)) pages.push(text);
    await checkBoardFit(display, "quotes");
    await page.clock.fastForward(4_050);
  }
  assert(pages.some(text=>text.includes("오름상회") && text.includes("+3.00%") && text.includes("직전 시세 대비")), JSON.stringify(pages));
  assert(pages.some(text=>text.includes("내림철도") && text.includes("-3.00%")), JSON.stringify(pages));
  assert(pages.includes(""), "the unobstructed exchange is visible between bulletin cycles");
  assert(pages.filter(text=>text.includes("신규 상장")).length >= 2, "eligible bulletins repeat without waiting for another market update");
  assert.deepEqual(await reads(), budget, "rotating cached market news adds zero observer starts and history calls");
  await page.evaluate(() => window.boardQa.displayStatus("paused"));
  await popup.waitFor({state:"hidden"});
  await page.clock.fastForward(40_000);
  assert.equal(await popup.isVisible(), false);
  await page.evaluate(() => window.boardQa.replayTrades());
  await heading.filter({hasText:"신규 상장"}).waitFor();
  await close.click();
  assert.equal(await page.evaluate(() => window.boardQa.displayActive), false);
  await show();
  await heading.filter({hasText:"신규 상장"}).waitFor();
  await close.click();
  if (width === 320) {
    // Legacy snapshots have no listing date or confirmed previous tick.
    await page.evaluate(() => {
      window.boardQa.displayFixture = [{id:"legacy", name:"옛상회", price:101, previousClose:100}];
    });
    await show();
    await heading.filter({hasText:"상승 종목"}).waitFor();
    assert((await popup.innerText()).includes("전일 대비"));
    await page.evaluate(() => window.boardQa.displayTick({prices:{legacy:111}, legacy:true}));
    await heading.filter({hasText:"급등 속보"}).waitFor();
    assert((await popup.innerText()).includes("직전 수신 시세 대비"));
    await close.click();
    await page.evaluate(() => {
      window.boardQa.displayFixture = [{id:"flat", name:"보합상회", price:100, previousClose:100}];
    });
    await show();
    await display.getByText("실시간 연결", {exact:true}).waitFor();
    assert.equal(await popup.isVisible(), false, "a flat legacy snapshot invents neither an IPO nor a move");
    await close.click();
  }
  await page.close();
}

try {
  await checkBulletinCycle(320, 568);
  await checkBulletinCycle(1280, 720);
  checks.push("Center popups replay recent confirmed listings and ±3% observed prices on entry, show both types with an unobstructed board between cycles, omit expired listings and trade details, and restart after pause or re-entry. Rotation adds zero watcher registrations and history requests at 320×568 and 1280×720.");
  for (const width of [320, 390, 768, 1280, 1440]) {
    const page = await open(width);
    await assertBlank(page);
    await push(page);
    await chartReady(page);
    assert.equal(await rows(page).count(), 20);
    assert.equal(await firstName(page), "검증학생01");
    const more = page.getByRole("button", { name: "더보기", exact: true });
    const moreLayout = await more.evaluate(element => {
      const list = element.closest('.wis-investment-board__list');
      const style = getComputedStyle(element);
      return { internal: !!list, width: element.getBoundingClientRect().width, listWidth: list?.clientWidth, height: element.getBoundingClientRect().height, filter: style.filter, backdrop: style.backdropFilter, position: style.position };
    });
    assert(moreLayout.internal && Math.abs(moreLayout.width - moreLayout.listWidth) < 2 && moreLayout.height >= 44, 'Load more fills the final row inside the list');
    assert.equal(moreLayout.filter, 'none');
    assert.equal(moreLayout.backdrop, 'none');
    assert(!['fixed', 'sticky', 'absolute'].includes(moreLayout.position), 'Load more remains in list flow');
    await more.scrollIntoViewIfNeeded();
    await page.locator('.wis-investment-board__list').screenshot({ path: path.join(output, `load-more-${width}.png`) });
    const scrollBefore = await page
      .locator(".wis-investment-board__list")
      .evaluate((el) => {
        return { top: el.scrollTop, height: el.clientHeight };
      });
    await more.press("Enter");
    assert.equal(await rows(page).count(), 40);
    assert.equal(await firstName(page), "검증학생01");
    assert.deepEqual(
      await page
        .locator(".wis-investment-board__list")
        .evaluate((el) => ({ top: el.scrollTop, height: el.clientHeight })),
      scrollBefore,
    );
    await more.click();
    assert.equal(await rows(page).count(), 50);
    assert.equal(await more.count(), 0);
    assert.equal(
      await countRequests(page),
      1,
      "load more does not reread histories",
    );
    await page
      .getByLabel("투자 현황 정렬", { exact: true })
      .selectOption("assets");
    assert.equal(await rows(page).count(), 20);
    await page
      .getByLabel("투자 현황 정렬", { exact: true })
      .selectOption("class");
    await page.locator(".wis-investment-board__list").evaluate((el) => {
      el.scrollTop = 0;
    });
    assert.equal(
      await page
        .locator(".wis-return-history__legend strong")
        .first()
        .innerText(),
      "1. 검증학생50",
    );
    assert.equal(
      await page
        .locator(".wis-return-history__legend li > span")
        .first()
        .innerText(),
      "+76.47%",
    );
    assert.equal(
      await plotted(page).locator("polyline").count(),
      10,
      "actual null gaps split each series",
    );
    assert.equal(await dots(page), 35);
    assert.deepEqual(
      await page.evaluate(() =>
        window.boardQa.historyRequests.map((r) => r.studentKeys.length),
      ),
      [5],
    );
    const layout = await page
      .locator(".wis-investment-board")
      .evaluate((el) => {
        const list = el
          .querySelector(".wis-investment-board__students")
          .getBoundingClientRect();
        const graph = el
          .querySelector(".wis-investment-board__returns")
          .getBoundingClientRect();
        return {
          width: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          list: {
            x: list.x,
            y: list.y,
            right: list.right,
            bottom: list.bottom,
          },
          graph: { x: graph.x, y: graph.y },
          toolbarBackground: getComputedStyle(
            el.querySelector(".wis-investment-board__toolbar"),
          ).backgroundColor,
          headingBackground: getComputedStyle(
            el.querySelector(".wis-investment-board__returns-heading"),
          ).backgroundColor,
          controlsBackground: getComputedStyle(
            el.querySelector(".wis-investment-board__chart-controls"),
          ).backgroundColor,
          periodBackground: getComputedStyle(
            el.querySelector(".ws-page-tabs button"),
          ).backgroundColor,
          shadow: getComputedStyle(
            el.querySelector(".wis-investment-board__returns-heading"),
          ).boxShadow,
          chartWidth: el
            .querySelector(".wis-return-history__canvas")
            .getBoundingClientRect().width,
          boardWidth: el.getBoundingClientRect().width,
        };
      });
    assert(layout.documentWidth <= width, JSON.stringify(layout));
    assert(layout.chartWidth <= layout.boardWidth);
    if (width >= 1280) {
      assert(layout.list.right < layout.graph.x);
      assert.equal(layout.list.y, layout.graph.y);
    } else assert(layout.list.bottom < layout.graph.y);
    for (const key of [
      "toolbarBackground",
      "headingBackground",
      "controlsBackground",
      "periodBackground",
    ])
      assert.equal(layout[key], "rgba(0, 0, 0, 0)");
    assert.equal(layout.shadow, "none");
    layouts.push(layout);
    const controls = await page
      .locator(
        ".wis-investment-board__chart-controls button, .wis-investment-board__student, .wis-investment-board__load-more button",
      )
      .evaluateAll((items) =>
        items.map((item) => ({
          width: item.getBoundingClientRect().width,
          height: item.getBoundingClientRect().height,
        })),
      );
    assert(controls.every((item) => item.width >= 44 && item.height >= 44));
    await page.screenshot({
      path: path.join(output, "board-" + width + ".png"),
      fullPage: true,
    });
    for (const [name, expected] of [
      ["1일", 20],
      ["1주", 25],
      ["1개월", 30],
      ["전체", 35],
    ]) {
      await period(page, name).click();
      await page.waitForFunction(
        (expected) =>
          document.querySelectorAll(".wis-return-history__plot circle")
            .length === expected,
        expected,
      );
      assert.equal(
        await countRequests(page),
        1,
        "period changes reuse the same actual records",
      );
    }
    const chart = page.locator(".wis-return-history__canvas");
    await chart.focus();
    await chart.press("Home");
    assert.equal(
      await page
        .locator(".wis-return-history__tooltip")
        .getAttribute("data-return"),
      "-30",
    );
    for (let i = 0; i < 5; i++) await chart.press("ArrowRight");
    assert.match(
      await page.locator(".wis-return-history__tooltip").innerText(),
      /시세 기록 없음/,
    );
    await chart.press("ArrowDown");
    assert.match(
      await page.locator(".wis-return-history__tooltip").innerText(),
      /검증학생49/,
    );
    await chart.press("Escape");
    assert.equal(await page.locator(".wis-return-history__tooltip").count(), 0);
    await rows(page).first().focus();
    await rows(page).first().press("Enter");
    await chartReady(page, 1);
    assert.equal(await rows(page).first().getAttribute("aria-pressed"), "true");
    assert.equal(
      await page.locator(".wis-investment-board__returns h3").innerText(),
      "검증학생01의 보유 수익률",
    );
    assert.equal(
      await page.locator(".wis-investment-board__detail dt").count(),
      8,
    );
    assert.deepEqual(
      await page
        .locator(".wis-investment-board__holdings tbody td:last-child")
        .allTextContents(),
      ["3주", "5주"],
    );
    assert.equal(
      await page
        .locator(".wis-investment-board__holdings th")
        .allTextContents()
        .then((labels) => labels.join(",")),
      "종목,보유 수량",
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.equal(
      await page.locator(".wis-return-history__legend strong").innerText(),
      "검증학생01",
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.boardQa.historyRequests.map((r) => r.studentKeys.length),
      ),
      [5, 1],
    );
    await period(page, "1일").click();
    assert.equal(await countRequests(page), 2);
    await page.screenshot({
      path: path.join(output, "student-" + width + ".png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "상위 5명 보기", exact: true })
      .click();
    await chartReady(page);
    assert.equal(await countRequests(page), 2);
    assert.equal(
      await page.locator(".wis-investment-board__detail").count(),
      0,
    );
    assert.equal(
      await period(page, "1일").getAttribute("aria-pressed"),
      "true",
      "period remains selected when changing chart subject",
    );
    await page.evaluate(() =>
      window.boardQa.setRows(
        window.boardQa.last.rows.map((row, index) => ({
          ...row,
          displayName:
            index === 0
              ? "김이름이아주길어도생략하지않는학생"
              : row.displayName,
        })),
      ),
    );
    await push(page, "READY", 2);
    await chartReady(page);
    await rows(page).first().click();
    await chartReady(page, 1);
    assert.equal(await firstName(page), "김이름이아주길어도생략하지않는학생");
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(output, "student-long-name-" + width + ".png"),
      fullPage: true,
    });
    await page.close();
  }
  checks.push(
    "320/390/768/1280/1440px: desktop left list/right graph; mobile reflow without overflow; transparent headings and period controls; 44px controls; keyboard student selection; all eight accounting values; period preservation and top-five return; long Korean names.",
  );
  checks.push(
    "One initial five-key request; outside student fetches one key; four periods and return to cached top five add zero requests; real timestamps/null gaps/KST keyboard inspection preserved.",
  );

  const page = await open();
  await push(page);
  await chartReady(page);
  const initialKeys = await page.evaluate(
    () => window.boardQa.historyRequests[0].studentKeys,
  );
  assert.deepEqual(
    await plotted(page).evaluateAll((items) =>
      items.map((item) => item.dataset.studentKey).sort(),
    ),
    initialKeys,
  );
  await page
    .getByLabel("투자 현황 정렬", { exact: true })
    .selectOption("assets");
  await rows(page).first().click();
  await chartReady(page, 1);
  assert.equal(
    await countRequests(page),
    1,
    "cached ranked student requires no request",
  );
  await page
    .getByRole("button", { name: "상위 5명 보기", exact: true })
    .click();
  await chartReady(page);
  await page.getByRole("button", { name: "더보기", exact: true }).click();
  assert.equal(await rows(page).count(), 40);
  assert.equal(await firstName(page), "검증학생50");
  assert.equal(
    await rows(page)
      .nth(20)
      .locator(".wis-investment-board__identity strong")
      .innerText(),
    "검증학생30",
  );
  assert.equal(
    await countRequests(page),
    1,
    "sort and load more do not reread",
  );
  const priorDots = await dots(page);
  await page.evaluate(() => {
    const raw = {
      ...window.boardQa.last,
      revision: 2,
      priceRevision: 2,
      asOfMs: window.boardQa.last.asOfMs + 1000,
    };
    window.boardQa.pricePush(raw);
  });
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll(".wis-return-history__plot circle").length ===
      n + 5,
    priorDots,
  );
  assert.equal(
    await countRequests(page),
    1,
    "price-only observations do not reread ledger",
  );
  await page
    .getByRole("button", { name: "수익률 기록 새로고침", exact: true })
    .click();
  await page.waitForFunction(() => window.boardQa.historyRequests.length === 2);
  await chartReady(page);
  await page.getByLabel("투자 현황 학급", { exact: true }).selectOption("3:1");
  await assertBlank(page);
  assert.equal(
    await countRequests(page),
    2,
    "class change never requests previous-class keys",
  );
  await push(page);
  await chartReady(page);
  assert.equal(
    await rows(page).count(),
    20,
    "class change resets visible count",
  );
  await page.getByRole("button", { name: "더보기", exact: true }).click();
  assert.equal(await rows(page).count(), 25);
  assert.equal(
    await page.getByRole("button", { name: "더보기", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .locator(".wis-return-history__legend strong")
      .first()
      .innerText(),
    "1. 검증학생25",
  );
  assert.deepEqual(
    await page.evaluate(() => {
      const r = window.boardQa.historyRequests.at(-1);
      return [r.grade, r.classNumber, r.studentKeys.length];
    }),
    ["3", "1", 5],
  );
  await rows(page).first().click();
  await chartReady(page, 1);
  assert.equal(
    await countRequests(page),
    3,
    JSON.stringify(await page.evaluate(() => window.boardQa.historyRequests)),
  );
  await page.getByRole("button", { name: "전광판 보기", exact: true }).click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  assert.equal(
    await page.locator(".wis-investment-board__returns h3").innerText(),
    "검증학생25의 보유 수익률",
  );
  await page
    .getByRole("button", { name: "전광판 닫기", exact: true })
    .click();
  await page.waitForFunction(() => !document.fullscreenElement);
  for (const connection of ["PAUSED", "OFFLINE", "CONNECTING"]) {
    const requests = await countRequests(page);
    await page.evaluate(
      (state) => window.boardQa.connection(state),
      connection,
    );
    await assertBlank(page);
    await push(page);
    await chartReady(page, 1);
    assert.equal(
      await countRequests(page),
      requests + 1,
      "reconnect discards even previously cached same-owner history",
    );
  }
  const requests = await countRequests(page);
  await push(page, "READY", 5);
  await page.waitForFunction(
    (n) => window.boardQa.historyRequests.length === n + 1,
    requests,
  );
  await chartReady(page, 1);
  await page.evaluate(() => window.boardQa.switchAccount());
  await assertBlank(page);
  await push(page);
  await chartReady(page);
  assert.equal(
    await countRequests(page),
    requests + 2,
    "account remount discards history cache",
  );
  const beforeSemester = await countRequests(page);
  await page.evaluate(() => window.boardQa.switchSemester());
  await assertBlank(page);
  assert.equal(
    await countRequests(page),
    beforeSemester,
    "same mounted board never requests old snapshot after semester change",
  );
  await push(page);
  await chartReady(page);
  assert.equal(
    await page.evaluate(() => window.boardQa.historyRequests.at(-1).year),
    "2027",
  );
  await page.evaluate(() => window.boardQa.fail());
  await assertBlank(page);
  await page.getByRole("button", { name: "다시 조회", exact: true }).click();
  await push(page);
  await chartReady(page);
  await page.evaluate(() => window.boardQa.leave());
  await page.waitForFunction(() => window.boardQa.active() === 0);
  await page.close();
  checks.push(
    "Price updates append actual observations without ledger requests; current-class ranking, source revision, refresh, PAUSED/OFFLINE/CONNECTING, account/same-component semester and permission-error transitions clear or reload appropriate scopes; native fullscreen retains selection.",
  );

  const states = await open(390);
  await states.evaluate(() => {
    window.boardQa.holdHistory = true;
  });
  await push(states);
  await states.waitForFunction(() => Boolean(window.boardQa.releaseHistory));
  assert.match(
    await states.locator(".wis-investment-board__returns").innerText(),
    /기록을 확인/,
  );
  await rows(states).first().click();
  await chartReady(states, 1);
  await states.evaluate(() => window.boardQa.releaseHistory());
  assert.equal(
    await states.locator(".wis-return-history__legend strong").innerText(),
    "검증학생01",
    "late top-five response cannot overwrite selected student",
  );
  await states.evaluate(() => {
    window.boardQa.holdHistory = true;
  });
  await rows(states).nth(1).click();
  await states.waitForFunction(
    () => window.boardQa.historyRequests.length === 3,
  );
  assert.equal(
    await states.locator(".wis-investment-board__holdings tbody tr").count(),
    0,
    "previous student's holdings disappear during a new request",
  );
  await states
    .getByLabel("투자 현황 학급", { exact: true })
    .selectOption("3:2");
  await assertBlank(states);
  await push(states);
  await chartReady(states);
  await states.evaluate(() => window.boardQa.releaseHistory());
  assert.equal(
    await states
      .locator(".wis-return-history__legend strong")
      .first()
      .innerText(),
    "1. 검증학생50",
    "late prior-class response discarded",
  );
  for (const mode of ["single", "empty", "null"]) {
    await states.evaluate((mode) => {
      window.boardQa.historyMode = mode;
    }, mode);
    await states
      .getByRole("button", { name: "수익률 기록 새로고침", exact: true })
      .click();
    await chartReady(states);
    if (mode !== "single")
      await states
        .getByText(
          mode === "empty"
            ? "아직 수익률 기록이 없습니다."
            : "확인할 수 있는 보유 수익률 기록이 없습니다.",
        )
        .waitFor();
    assert.equal(await plotted(states).locator("polyline").count(), 0);
    assert.equal(await dots(states), mode === "single" ? 5 : 0);
  }
  await period(states, "1일").click();
  await states.evaluate(() => {
    window.boardQa.historyMode = "empty";
  });
  await states
    .getByRole("button", { name: "수익률 기록 새로고침", exact: true })
    .click();
  await states.getByText("선택한 기간에 수익률 기록이 없습니다.").waitFor();
  await period(states, "전체").click();
  await states.evaluate(() => {
    window.boardQa.historyMode = "partial";
  });
  await states
    .getByRole("button", { name: "수익률 기록 새로고침", exact: true })
    .click();
  await chartReady(states);
  assert.match(
    await states.locator(".wis-return-history__legend").innerText(),
    /기록 없음/,
  );
  assert.equal(await plotted(states).locator("polyline").count(), 8);
  await states.evaluate(() => {
    window.boardQa.historyFailure = true;
  });
  await states
    .getByRole("button", { name: "수익률 기록 새로고침", exact: true })
    .click();
  await states
    .getByRole("button", { name: "수익률 기록 다시 조회", exact: true })
    .waitFor();
  assert.equal(await states.locator(".wis-return-history__canvas").count(), 0);
  const failedRequests = await countRequests(states);
  await period(states, "1주").click();
  assert.equal(
    await countRequests(states),
    failedRequests,
    "period does not retry a failed request",
  );
  await states.evaluate(() => {
    window.boardQa.historyFailure = false;
    window.boardQa.historyMode = "";
  });
  await states
    .getByRole("button", { name: "수익률 기록 다시 조회", exact: true })
    .click();
  await chartReady(states);
  assert.equal(await countRequests(states), failedRequests + 1);
  await states.evaluate(() =>
    window.boardQa.setRows(
      window.boardQa.last.rows.map((row) => ({
        ...row,
        holdingCount: 0,
        holdingValue: 0,
        holdingCostBasis: 0,
      })),
    ),
  );
  await push(states, "READY", 4);
  await states.getByText("보유 주식이 있는 학생이 없습니다.").waitFor();
  assert.equal(await states.locator(".wis-return-history__canvas").count(), 0);
  await rows(states).first().click();
  await chartReady(states, 1);
  await states.getByText("보유한 주식이 없습니다.", { exact: true }).waitFor();
  assert.equal(
    await states.locator(".wis-return-history__legend li > span").innerText(),
    "미보유",
  );
  assert(
    (await dots(states)) > 0,
    "currently unheld student retains historical returns",
  );
  await states.locator(".wis-return-history__canvas").focus();
  await states.locator(".wis-return-history__canvas").press("End");
  assert.match(
    await states.locator(".wis-return-history__tooltip").innerText(),
    /보유 주식 없음/,
  );
  await states.close();
  checks.push(
    "Loading, single/empty/null/partial histories, period-empty state, missing quote and no-holding gaps, explicit error retry, current non-holder with genuine past returns; late responses after selection/class change are discarded.",
  );

  const holdings = await open(390);
  await push(holdings);
  await chartReady(holdings);
  await rows(holdings).first().click();
  await chartReady(holdings, 1);
  await holdings.evaluate(() => {
    window.boardQa.holdHistory = true;
    window.boardQa.holdingQuantity = 7;
  });
  await push(holdings, "READY", 2);
  await holdings.waitForFunction(() => Boolean(window.boardQa.releaseHistory));
  assert.equal(
    await holdings.locator(".wis-investment-board__holdings tbody tr").count(),
    0,
    "new trading revision clears old holdings before response",
  );
  await holdings.evaluate(() => window.boardQa.releaseHistory());
  await chartReady(holdings, 1);
  assert.deepEqual(
    await holdings
      .locator(".wis-investment-board__holdings tbody td:last-child")
      .allTextContents(),
    ["7주", "9주"],
  );
  const holdingRequests = await countRequests(holdings);
  await holdings.evaluate(() =>
    window.boardQa.pricePush({
      ...window.boardQa.last,
      priceRevision: 3,
      asOfMs: window.boardQa.last.asOfMs + 1000,
    }),
  );
  assert.deepEqual(
    await holdings
      .locator(".wis-investment-board__holdings tbody td:last-child")
      .allTextContents(),
    ["7주", "9주"],
  );
  assert.equal(await countRequests(holdings), holdingRequests);
  await holdings.close();
  checks.push(
    "Load more appends 20/40/50 without rereads or inner-scroll reset; sort/class reset to 20. Selected holdings show each actual quantity, handle long names/empty/loading, discard prior student/revision quantities, and survive quote-only updates without additional calls.",
  );

  const revisions = await open();
  await revisions.evaluate(() => { window.boardQa.accountRevisions = {}; });
  await push(revisions);
  await chartReady(revisions);
  const rankedKeys = await revisions.evaluate(() => window.boardQa.historyRequests[0].studentKeys);
  await revisions.evaluate(() => {
    window.boardQa.accountRevisions['student_000000000000000000000001'] = 2;
  });
  await push(revisions, 'READY', 2);
  await revisions.waitForTimeout(50);
  assert.equal(await countRequests(revisions), 1, 'another student trade adds zero history reads');
  await revisions.evaluate(key => { window.boardQa.accountRevisions[key] = 2; }, rankedKeys[0]);
  await push(revisions, 'READY', 3);
  await chartReady(revisions);
  assert.equal(await countRequests(revisions), 2);
  assert.deepEqual(await revisions.evaluate(() => window.boardQa.historyRequests.at(-1).studentKeys), [rankedKeys[0]], 'one changed ranked account rereads one ledger, not five');
  await revisions.evaluate(key => { window.boardQa.legacyKeys = [key]; }, rankedKeys[1]);
  await push(revisions, 'READY', 4);
  await chartReady(revisions);
  assert.deepEqual(await revisions.evaluate(() => window.boardQa.historyRequests.at(-1).studentKeys), [rankedKeys[1]], 'mixed legacy row alone uses global revision');
  await push(revisions, 'READY', 5);
  await chartReady(revisions);
  assert.equal(await countRequests(revisions), 4);
  assert.deepEqual(await revisions.evaluate(() => window.boardQa.historyRequests.at(-1).studentKeys), [rankedKeys[1]]);
  await revisions.evaluate(() => { window.boardQa.legacyKeys = []; });
  await push(revisions, 'READY', 6);
  await chartReady(revisions);
  const revisionRequests = await countRequests(revisions);
  await revisions.evaluate(() => { window.boardQa.accountRevisions['student_000000000000000000000001'] = 3; });
  await push(revisions, 'READY', 7);
  await revisions.waitForTimeout(50);
  assert.equal(await countRequests(revisions), revisionRequests);
  await revisions.getByRole('button', { name: '수익률 기록 새로고침', exact: true }).click();
  await chartReady(revisions);
  assert.equal(await countRequests(revisions), revisionRequests + 1);
  assert.equal(await revisions.evaluate(() => window.boardQa.historyRequests.at(-1).studentKeys.length), 5, 'explicit refresh still rereads all displayed students');
  await revisions.evaluate(() => { window.boardQa.detailsRevision=99; });
  await revisions.getByRole("button", {name:"수익률 기록 새로고침",exact:true}).click();
  await revisions.getByRole("button", {name:"투자 현황 다시 조회",exact:true}).click();
  await revisions.waitForFunction(() => window.boardQa.subscriptions === 2);
  await assertBlank(revisions);
  await revisions.evaluate(() => { window.boardQa.detailsRevision=undefined; });
  await push(revisions, "READY", 8);
  await chartReady(revisions);
  await revisions.close();
  checks.push('Per-account revisions: unrelated trade adds 0 requests (formerly 1 call / 5 ledgers); one ranked trade reads 1 ledger (formerly 5); mixed legacy rows alone follow the global revision; explicit refresh still reads the displayed five.');

  for (const [width,height,motion="reduce"] of [[320,568],[390,844],[768,1024],[1280,720],[1440,900],[1920,1080],[1920,1080,"no-preference"]]) {
    const tv = width === 1920;
    const mobile = width < 640;
    const page = await open(width, motion);
    assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), motion === "reduce");
    await page.setViewportSize({width,height});
    await push(page);
    await chartReady(page);
    await page.evaluate(() =>
      Object.defineProperty(Element.prototype, "requestFullscreen", {
        configurable: true,
        value: async () => {
          throw new DOMException("Synthetic rejection", "NotAllowedError");
        },
      }),
    );
    await page.clock.install();
    await page
      .getByRole("button", { name: "전광판 보기", exact: true })
      .click();
    await page.locator("dialog[open]").waitFor();
    const display = page.getByRole("dialog", { name: "위스피 전광판" });
    const quotes = display.locator(stockRows);
    const trades = display.locator(fillRows);
    const setPanel = async name => {
      if (mobile) {
        const button = display.getByRole("button", {name, exact:true});
        await button.click();
        assert.equal(await button.getAttribute("aria-pressed"), "true");
      }
      await afterLayout(page);
    };
    const surge = display.locator(".wis-exchange__surge");
    await setPanel("시세");
    await checkQuoteHelp(page, display);
    assert((await quotes.count()) > 0 && (await quotes.count()) < 23);
    await page.screenshot({path:path.join(output, "board-dialog-" + width + ".png")});
    if (tv || width===390) await checkAutomaticQuotePages(page,display);
    else await display.getByRole("button", {name:"종목 자동 넘김 일시정지",exact:true}).click();
    await visitQuotePages(page,display);
    await setPanel("체결");
    await visitTradePages(page,display);
    const trade = (await trades.first().innerText()).replace(/\s+/g, "");
    for (const field of ["매수", "검증학생", "한양은행", "2주", "주당340위스"]) {
      assert(trade.includes(field), field + " visible in first trade");
    }
    await setPanel("시세");
    assert.equal(await display.locator(".wis-exchange__index-value").innerText(), "1,052.16pt");
    assert(!/급등|급락/.test((await surge.locator(".wis-exchange__surge-heading strong").allTextContents()).join("")), "small daily moves do not become rapid-move alerts");
    await page.evaluate(() => window.boardQa.displayTick({ index: { value: 987.23, previousClose: 1000 } }));
    await display.locator(".wis-exchange__index-change .is-down").waitFor();
    assert.match(await display.locator(".wis-exchange__index-value").innerText(), /987.23/);
    assert.equal(await display.locator(".wis-quote-price__fold").count(), 0, "unchanged quotes stay still");
    const geometry = await display.evaluate(el => {
      const board = el.querySelector(".wis-exchange");
      const measure = node => {
        const { x, y, right, bottom } = node.getBoundingClientRect();
        return { x, y, right, bottom };
      };
      const cells = Array.from(el.querySelectorAll(".wis-exchange__quote-grid > li[data-quote-id]"));
      const font = selector => {
        const field=el.querySelector(selector);
        return field ? parseFloat(getComputedStyle(field).fontSize) : null;
      };
      return {
        width: board.scrollWidth, client: board.clientWidth,
        index: measure(el.querySelector(".wis-exchange__index")),
        quotes: measure(el.querySelector(".wis-exchange__quotes")),
        trades: el.querySelector(".wis-exchange__trades") && measure(el.querySelector(".wis-exchange__trades")),
        header: getComputedStyle(el.querySelector(".wis-exchange__bar")).backgroundColor,
        cells: cells.map(measure),
        fonts: {
          quote: font(".wis-exchange__quote-name"), price: font(".wis-exchange__quote-price"),
          name: font(".wis-exchange__trade-head strong"), stock: font(".wis-exchange__trade-stock"),
          amount: font(".wis-exchange__trade-amount strong"),
          change: font(".wis-exchange__quote-values .wis-exchange__movement"),
          changePercent: font(".wis-exchange__quote-values .wis-exchange__movement small"),
          indexChange: font(".wis-exchange__index-change .wis-exchange__movement"),
          indexPercent: font(".wis-exchange__index-change .wis-exchange__movement small"),
        },
      };
    });
    assert(geometry.width <= geometry.client + 1);
    for (let i = 1; i < geometry.cells.length; i++) {
      const previous = geometry.cells[i - 1], cell = geometry.cells[i];
      if (i % 2) {
        assert(Math.abs(previous.y - cell.y) < 1 && previous.right <= cell.x + 1, "two quotes per row at " + width);
      } else {
        assert(previous.bottom <= cell.y + 1 && Math.abs(cell.x - geometry.cells[0].x) < 1, "new quote row at " + width);
      }
    }
    if (tv) {
      const { quote, price, name, stock, amount } = geometry.fonts;
      assert(quote >= 24 && price >= 30 && name >= 24 && stock >= 20 && amount >= 22, JSON.stringify(geometry.fonts));
      const { change, changePercent, indexChange, indexPercent } = geometry.fonts;
      assert(Math.round(change) >= 35 && changePercent >= 32 && indexChange >= 43 && indexPercent >= 39, JSON.stringify(geometry.fonts));
    }
    layouts.push({ screen: "exchange", width, height, quoteColumns: 2, fonts: geometry.fonts });
    assert.equal(geometry.header, "rgba(0, 0, 0, 0)");
    assert.deepEqual(await display.evaluate(el=>[".is-up",".is-down"].map(css=>getComputedStyle(el.querySelector(css)).color)),["rgb(255, 121, 121)","rgb(118, 181, 255)"]);
    if(width>=960)assert(geometry.quotes.right<=geometry.index.x && geometry.index.right<=geometry.trades.x);
    else assert(geometry.index.bottom<=geometry.quotes.y);

    assert(
      await page
        .locator("dialog[open]")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    if (tv) {
      await checkLiveExchange(page, display, surge);
    } else if (width === 1440) {
      const previousCount = await quotes.count();
      const originalGeometry = await quoteGeometry(display);
      await page.setViewportSize({width,height:610});
      await page.waitForFunction(({selector, previousCount}) => {
        const count = document.querySelectorAll(selector).length;
        return count > 0 && count < previousCount;
      }, {selector:stockRows, previousCount});
      await afterLayout(page);
      await checkBoardFit(display,"quotes");
      await checkBoardFit(display,"trades");
      await visitQuotePages(page,display);
      await page.setViewportSize({width,height});
      await page.waitForFunction(({selector, previousCount}) => document.querySelectorAll(selector).length === previousCount, {selector:stockRows, previousCount});
      await afterLayout(page);
      await checkBoardFit(display,"quotes");
      await checkBoardFit(display,"trades");
      assertStableQuotes(originalGeometry, await quoteGeometry(display), 'height-only resize returns to its original layout');
      await page.setViewportSize({width:1024,height});
      await afterLayout(page);
      await checkBoardFit(display,"quotes");
      await checkBoardFit(display,"trades");
      await visitQuotePages(page,display);
      await page.setViewportSize({width,height});
      await page.waitForFunction(({selector, previousCount}) => document.querySelectorAll(selector).length === previousCount, {selector:stockRows, previousCount});
      await afterLayout(page);
      await checkBoardFit(display,"quotes");
      await checkBoardFit(display,"trades");
      assertStableQuotes(originalGeometry, await quoteGeometry(display), 'width resize returns to its original layout');
    } else if (width === 320) {
      await page.evaluate(() => window.boardQa.displayTick({prices:{S0:600,S1:610,S2:620,S3:630,S4:640,S5:650}}));
      await surge.waitFor();
      await afterLayout(page);
      await checkBoardFit(display,"quotes");
      await setPanel("체결");
      await checkBoardFit(display,"trades");
      await page.screenshot({path:path.join(output,"board-dialog-surge-320.png")});
    } else if (width === 390) {
      await page.evaluate(() => window.boardQa.displayTick({ prices: { S0: 315 } }));
      await surge.waitFor();
      await checkBoardFit(display,"quotes");
      const price = quotes.first().locator(".wis-ticker-tile__current .wis-quote-price");
      assert.match(await price.textContent(), /315/);
      await waitForVisibleRotation(page, ".wis-quote-price__fold, .wis-quote-price__unfold");
      await setPanel("체결");
      await page.evaluate(() => window.boardQa.displayTrade());
      await afterLayout(page);
      assert.deepEqual((await display.locator(fillNames).allTextContents()).slice(0,2),["새체결학생","검증학생"]);
      await waitForVisibleRotation(page, ".wis-exchange__trades .wis-flap__fold, .wis-exchange__trades .wis-flap__unfold");
    }
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => document.activeElement?.textContent?.trim() === "전광판 보기",
    );
    assert.equal(await page.evaluate(() => window.boardQa.subscriptions), 1);
    assert.deepEqual(await page.evaluate(()=>[window.boardQa.displayStarts,window.boardQa.displayStops,window.boardQa.displayActive]),[1,1,false]);
    await page.close();
  }
  {
    const page = await open(1280);
    await push(page);
    await chartReady(page);
    await page.getByRole('button', {name:'전광판 보기', exact:true}).click();
    const display = page.getByRole('dialog', {name:'위스피 전광판'});
    await display.waitFor();
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('wis-exchange'));
    await checkQuoteHelp(page, display);
    await page.screenshot({path:path.join(output,'board-dialog-native-fullscreen-1280.png')});
    await display.getByRole('button', {name:'전광판 닫기', exact:true}).click();
    await display.waitFor({state:'hidden'});
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.deepEqual(await page.evaluate(()=>[window.boardQa.displayStarts,window.boardQa.displayStops,window.boardQa.displayActive]),[1,1,false]);
    await page.close();
  }
  checks.push(
    "Fullscreen exchange at six viewport sizes including 320×568 and 1280×720: no scrolling/clipping, two quotes per row, all 23 stocks and all 20 fills reachable, mobile panel switching, TV font sizes, Escape focus restoration and watcher disposal. Native fullscreen keeps help visible within its subtree.",
    "In both motion settings the eight-second quote cycle visibly folds old/new faces row by row, with pause and manual paging. Prices and trades flip with reduced motion enabled. A new fill moves the previous first row down; replays and reconnects do not replay fills.",
    "Live quote sequence: row-ordered split flaps, initial/unchanged/reconnected prices, confirmed ±3% headlines, absolute-magnitude ordered mixed bulletins, timed breaks, new listings and halted market.",
    "One-row quote heading, click/keyboard help with Escape/outside/focus dismissal, stable row boundaries throughout all pages and bulletin appearance/disappearance, and wide centered overlay outside the index column.",
    "Height-only and width-only resize: every quote page remains readable, rows fit without clipping, and returning to the original viewport restores the same heading/window/row geometry.",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  assert.deepEqual(await hashes(), before, "Source changed during QA");
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
