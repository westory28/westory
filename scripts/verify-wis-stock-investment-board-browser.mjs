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
 stockCash:1000+(i+1)*10,reservedCash:100+i+1,holdingCount:i===0?2:1,holdingValue:500+(i+1)*20,
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
 return <><aside className="fixture-teacher-rail" aria-hidden="true">교사</aside>
 <main className="ws-page wis-stocks"><h1>학생 투자 현황</h1>{mounted&&<Board key={account} {...scope}/>}</main></>;
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
 grade:row.grade,classNumber:row.classNumber,asOfMs,sourceRevision:qa.last.revision,priceRevision:qa.last.priceRevision,
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
  loader: { ".svg": "dataurl" },
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
try {
  for (const width of [320, 390, 768, 1280, 1440]) {
    const page = await open(width);
    await assertBlank(page);
    await push(page);
    await chartReady(page);
    assert.equal(await rows(page).count(), 20);
    assert.equal(await firstName(page), "검증학생01");
    const more = page.getByRole("button", { name: "더보기", exact: true });
    const scrollBefore = await page
      .locator(".wis-investment-board__list")
      .evaluate((el) => {
        el.scrollTop = 480;
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
    .getByRole("button", { name: "전체 화면 닫기", exact: true })
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
  await page.getByRole("button", { name: "다시 연결", exact: true }).click();
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

  for (const width of [320, 390, 768, 1280, 1440]) {
    const page = await open(width, "reduce");
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
    await page
      .getByRole("button", { name: "전광판 보기", exact: true })
      .click();
    await page.locator("dialog[open]").waitFor();
    assert.equal(await firstName(page), "검증학생01");
    assert.equal(
      await page
        .locator(".wis-return-history__legend strong")
        .first()
        .innerText(),
      "1. 검증학생50",
    );
    assert(
      await page
        .locator("dialog[open]")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await page.screenshot({
      path: path.join(output, "board-dialog-" + width + ".png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => document.activeElement?.textContent?.trim() === "전광판 보기",
    );
    assert.equal(await page.evaluate(() => window.boardQa.subscriptions), 1);
    await page.close();
  }
  checks.push(
    "Fullscreen dialog fallback at all five widths: overflow containment, reduced-motion, names and series preserved, Escape focus restoration, no additional subscription.",
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
