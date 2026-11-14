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
const output = path.join(root, "output/wispi-board-20261115/board");
await fs.mkdir(output, { recursive: true });
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const audited = [
  "src/pages/teacher/components/points/WisStockInvestmentBoard.tsx",
  "src/pages/teacher/components/points/WisStockInvestmentBoard.css",
  "functions/wisStockInvestmentBoard.mjs",
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
const rows=Array.from({length:50},(_,i)=>({studentKey:'student_'+(i+1).toString(16).padStart(24,'0'),
 grade:'3',classNumber:i<25?'1':'2',studentNumber:String(i%25+1),displayName:'검증학생'+String(i+1).padStart(2,'0'),
 stockCash:1000+(i+1)*10,reservedCash:100+i+1,holdingCount:1,holdingValue:500+(i+1)*20,
 holdingCostBasis:600+(i+1)*5,realizedPnl:(i+1-25)*3}));
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
  assert.equal(
    await stats(page).locator("strong").filter({ hasText: "—" }).count(),
    6,
  );
}
try {
  for (const width of [320, 390, 768, 1280, 1440]) {
    const page = await open(width);
    await assertBlank(page);
    await push(page);
    assert.equal(await rows(page).count(), 20);
    assert.equal(await firstName(page), "검증학생01");
    const summary = await page.evaluate(() => ({
      raw: window.boardQa.last.totals,
      shown: [
        ...document.querySelectorAll(".wis-investment-board__stats>div"),
      ].map((el) => el.innerText),
    }));
    assert.equal(summary.raw.totalAssets, 113250);
    assert.equal(summary.raw.stockCash, 62750);
    assert.equal(summary.raw.reservedCash, 6275);
    assert.match(summary.shown[0], /50/);
    assert.match(summary.shown[1], /62,750/);
    assert.match(summary.shown[2], /6,275/);
    assert.match(summary.shown[3], /50,500/);
    assert.equal(
      await rows(page).first().locator("td").nth(7).innerText(),
      "1,530",
    );
    const layout = await page
      .locator(".wis-investment-board")
      .evaluate((el) => ({
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        boardWidth: el.getBoundingClientRect().width,
        toolbarBackground: getComputedStyle(
          el.querySelector(".wis-investment-board__toolbar"),
        ).backgroundColor,
        toolbarShadow: getComputedStyle(
          el.querySelector(".wis-investment-board__toolbar"),
        ).boxShadow,
        tableViewport: el.querySelector(".wis-investment-board__table")
          .clientWidth,
        tableWidth: el.querySelector("table").getBoundingClientRect().width,
        visibleControls: [...el.querySelectorAll("button,select")].map(
          (control) => ({
            left: control.getBoundingClientRect().left,
            right: control.getBoundingClientRect().right,
            height: control.getBoundingClientRect().height,
          }),
        ),
      }));
    assert(layout.documentWidth <= width, JSON.stringify(layout));
    assert.equal(layout.toolbarBackground, "rgba(0, 0, 0, 0)");
    assert.equal(layout.toolbarShadow, "none");
    assert(layout.tableViewport <= layout.boardWidth);
    for (const control of layout.visibleControls) {
      assert(
        control.left >= 0 && control.right <= width + 1,
        JSON.stringify(control),
      );
    }
    layouts.push(layout);
    const help = page.getByRole("button", {
      name: "투자 현황 기준",
      exact: true,
    });
    await help.focus();
    await page.getByRole("tooltip").waitFor();
    assert.match(
      await page.getByRole("tooltip").innerText(),
      /현금에는 매수 예약금이 포함/,
    );
    await help.press("Escape");
    await page.getByRole("tooltip").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector(".wis-investment-board__number"),
        ).opacity === "1",
    );
    await page.screenshot({
      path: path.join(output, `board-${width}.png`),
      fullPage: true,
    });
    assert.deepEqual(
      await page.evaluate(() => [
        window.boardQa.subscriptions,
        window.boardQa.stops,
      ]),
      [1, 0],
    );
    await page.close();
  }
  checks.push(
    "Five widths 320/390/768/1280/1440: real board/CSS, 128px+64px desktop rails, no document overflow, transparent toolbar, keyboard help, complete 50-row totals and 20-row presentation without extra subscriptions.",
  );
  const page = await open();
  await push(page);
  await page
    .getByLabel("투자 현황 정렬", { exact: true })
    .selectOption("assets");
  assert.equal(await firstName(page), "검증학생50");
  await page.getByRole("button", { name: "다음", exact: true }).press("Enter");
  assert.equal(await firstName(page), "검증학생30");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  assert.equal(await rows(page).count(), 10);
  assert.equal(await firstName(page), "검증학생10");
  assert.equal(
    await page.getByRole("button", { name: "다음", exact: true }).isDisabled(),
    true,
  );
  assert.deepEqual(
    await page.evaluate(() => [
      window.boardQa.subscriptions,
      window.boardQa.stops,
    ]),
    [1, 0],
  );
  await page.getByLabel("투자 현황 정렬", { exact: true }).selectOption("pnl");
  assert.equal(await firstName(page), "검증학생50");
  await page.getByLabel("투자 현황 학급", { exact: true }).selectOption("3:1");
  await page.waitForFunction(() => window.boardQa.subscriptions === 2);
  await assertBlank(page);
  assert.deepEqual(
    await page.evaluate(() => [
      window.boardQa.scopes.at(-1).documentId,
      window.boardQa.stops,
    ]),
    ["class_3_1", 1],
  );
  await push(page);
  assert.equal(await firstName(page), "검증학생25");
  assert.match(await stats(page).innerText(), /25 명/);
  await page.getByRole("button", { name: "다음", exact: true }).click();
  assert.equal(await rows(page).count(), 5);
  await page.getByLabel("이름 숨김", { exact: true }).check();
  assert.equal(await firstName(page), "검•••");
  await page.getByLabel("이름 숨김", { exact: true }).uncheck();
  assert.equal(await firstName(page), "검증학생05");
  await page.getByRole("button", { name: "전광판 보기", exact: true }).click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  assert.equal(
    await page.getByLabel("이름 숨김", { exact: true }).isChecked(),
    true,
  );
  assert.equal(await firstName(page), "검•••");
  await page.screenshot({
    path: path.join(output, "board-fullscreen-1440.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "전체 화면 닫기", exact: true })
    .click();
  await page.waitForFunction(() => !document.fullscreenElement);
  checks.push(
    "Asset/PnL sorting and 20/20/10 pagination are local; class switch unsubscribes all and subscribes only class_3_1; 25-row class aggregate, name masking and actual Fullscreen API work.",
  );
  for (const connection of ["PAUSED", "OFFLINE", "CONNECTING"]) {
    await page.evaluate(
      (state) => window.boardQa.connection(state),
      connection,
    );
    await assertBlank(page);
    await push(page, "READY", 2);
  }
  await push(page, "NOT_READY");
  await assertBlank(page);
  assert.match(
    await page.locator(".wis-investment-board__empty").innerText(),
    /아직 연결되지/,
  );
  await push(page, "EMPTY", 3);
  assert.match(
    await page.locator(".wis-investment-board__empty").innerText(),
    /투자 내역이 없습니다/,
  );
  assert.equal(
    await stats(page).locator("strong").filter({ hasText: "—" }).count(),
    0,
  );
  assert.match(await stats(page).innerText(), /0 명/);
  await page.evaluate(() => window.boardQa.fail());
  await page.getByRole("alert").waitFor();
  await assertBlank(page);
  const count = await page.evaluate(() => window.boardQa.subscriptions);
  await page.getByRole("button", { name: "다시 연결", exact: true }).click();
  await page.waitForFunction(
    (n) => window.boardQa.subscriptions === n + 1,
    count,
  );
  await push(page, "READY", 4);
  checks.push(
    "PAUSED/OFFLINE/CONNECTING clear old financial rows; NOT_READY displays dashes while authoritative READY empty displays zero; error hides values and explicit retry creates one fresh watcher.",
  );
  const previous = await page.evaluate(() => ({
    count: window.boardQa.subscriptions,
    stops: window.boardQa.stops,
  }));
  await page.evaluate(() => window.boardQa.switchAccount());
  await page.waitForFunction(
    (n) => window.boardQa.subscriptions === n + 1,
    previous.count,
  );
  await assertBlank(page);
  assert.equal(
    await page.getByLabel("투자 현황 학급", { exact: true }).inputValue(),
    "all",
  );
  assert.equal(
    await page.getByLabel("이름 숨김", { exact: true }).isChecked(),
    false,
  );
  assert.equal(
    await page.evaluate(() => window.boardQa.stops),
    previous.stops + 1,
  );
  await push(page, "READY", 5);
  await page.evaluate(() => window.boardQa.switchSemester());
  await page.waitForFunction(
    () => window.boardQa.scopes.at(-1).semesterId === "2027-1",
  );
  await assertBlank(page);
  await push(page, "READY", 6);
  assert.equal(
    await page.evaluate(() => window.boardQa.last.semesterId),
    "2027-1",
  );
  await page.evaluate(() => window.boardQa.leave());
  await page.waitForFunction(() => window.boardQa.active() === 0);
  assert.equal(await page.locator(".wis-investment-board").count(), 0);
  checks.push(
    "Owner-key and semester-key remount discard old rows, class selection and mask state; leaving the component closes the only watcher. The real client auth/visibility behavior is separately covered by client tests.",
  );
  await page.close();
  const reduced = await open(390, "reduce");
  await push(reduced);
  await reduced.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(
    await reduced
      .locator(".wis-investment-board__number")
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
    "1",
  );
  await push(reduced, "READY", 2);
  await reduced.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(
    await reduced
      .locator(".wis-investment-board__number")
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
    "1",
  );
  await reduced.screenshot({
    path: path.join(output, "board-reduced-390.png"),
    fullPage: true,
  });
  await reduced.close();
  checks.push(
    "Reduced-motion first feed and revision update keep number opacity at 1; no animated text movement.",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  assert.deepEqual(
    await hashes(),
    before,
    "Board source changed during QA; rerun against frozen source.",
  );
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
