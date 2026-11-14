/** Real rules component, synthetic services only; no production reads or writes. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence =
  process.env.WIS_STOCK_RULES_QA_DIR ||
  path.join(root, "output/wispi-market-20261114/rules");
await fs.mkdir(evidence, { recursive: true });
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const services = `
export const qa=window.rulesQa={writes:[],reloads:0,toasts:[],fail:false,conflict:false,hold:false};
export const useAppToast=()=>({showToast:value=>qa.toasts.push(value)});
export const isWisStockRevisionConflict=e=>e.reason==='conflict';
export const wisStockErrorMessage=e=>e.message;
export const saveWisStockMarketRules=async(config,revision,rules)=>{
 qa.writes.push({config,revision,rules:structuredClone(rules)});
 if(qa.hold)await new Promise(resolve=>qa.release=resolve);
 if(qa.fail)throw Error('저장하지 못했습니다. 다시 시도해 주세요.');
 if(qa.conflict){qa.conflict=false;throw Object.assign(Error('다른 변경을 확인해 주세요.'),{reason:'conflict'})}
 return {...qa.market,revision:qa.market.revision+1,rules:{...structuredClone(rules),halted:qa.market.rules.halted}};
};`;
const entry = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Rules from ${imp("src/pages/teacher/components/points/WisStockMarketRules.tsx")};
import{DEFAULT_WIS_STOCK_MARKET_RULES}from ${imp("functions/wisStockMarketRules.mjs")};
import{qa}from ${imp("src/lib/wisStocksClient")};
import ${imp("src/assets/index.css")};
import ${imp("src/components/common/portalPage.css")};
import ${imp("src/pages/teacher/components/points/TeacherWisStocks.css")};
qa.defaults=structuredClone(DEFAULT_WIS_STOCK_MARKET_RULES);
function App(){
 const[market,setMarket]=useState({semesterId:'2026-2',revision:7,rules:qa.defaults,stocks:[],maxStocks:60});
 const[busy,setBusy]=useState(false);qa.market=market;
 qa.halt=()=>setMarket(current=>({...current,revision:current.revision+1,rules:{...current.rules,halted:true}}));
 const accepted=result=>{setMarket(result);return result};
 return <main className="ws-page wis-stocks"><h1>시장 규칙 검증</h1><Rules market={market} config={{year:'2026',semester:'2'}} canManage={!new URLSearchParams(location.search).has('readonly')} busy={busy} onBusyChange={setBusy} onSaved={accepted} onReload={async()=>{qa.reloads++;const value={...qa.market,revision:qa.market.revision+1};setMarket(value);return value}}/></main>
}createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  loader: { ".svg": "dataurl" },
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  outfile: "rules.js",
  plugins: [
    {
      name: "synthetic-rules",
      setup(plugin) {
        plugin.onResolve(
          { filter: /common\/AppToastProvider$|lib\/wisStocksClient$/ },
          () => ({ path: "services", namespace: "fixture" }),
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
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f3f4f6;font-family:Arial,sans-serif}*{box-sizing:border-box}@media(min-width:1024px){main{margin-left:240px!important;width:calc(100% - 240px)!important}}</style><link rel="stylesheet" href="/qa.css"><div id="root"></div><script type="module" src="/qa.js"></script></html>';
const server = http.createServer((req, res) => {
  const file = {
    "/qa.js": ["text/javascript", js],
    "/qa.css": ["text/css", css],
  }[new URL(req.url, "http://localhost").pathname] || ["text/html", html];
  res.setHeader("Content-Type", file[0] + ";charset=utf-8");
  res.end(file[1]);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const errors = [],
  checks = [],
  layouts = [];
let failure;
async function open(width = 1280, query = "") {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await page.goto(origin + query);
  await page.getByRole("form", { name: "시장 규칙", exact: true }).waitFor();
  return page;
}
const save = (page) =>
  page.getByRole("button", { name: "규칙 저장", exact: true });
try {
  for (const width of [320, 390, 768, 1280, 1440]) {
    const page = await open(width);
    const form = page.getByRole("form", { name: "시장 규칙", exact: true });
    assert.equal(await form.locator("input[type=number]").count(), 15);
    assert.equal(await save(page).isDisabled(), true);
    const layout = await form.evaluate((element) => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      height: element.getBoundingClientRect().height,
      groups: [...element.querySelectorAll(".wis-stock-rules__section")].map(
        (group) => ({
          background: getComputedStyle(group).backgroundColor,
          shadow: getComputedStyle(group).boxShadow,
          border: getComputedStyle(group).borderBottomWidth,
        }),
      ),
      inputs: [
        ...element.querySelectorAll("input[type=number],input[type=time]"),
      ].map((input) => ({
        width: input.getBoundingClientRect().width,
        height: input.getBoundingClientRect().height,
      })),
      orderRows: [...element.querySelectorAll(".wis-stock-rules__section")][1]
        .querySelectorAll(".wis-stock-rules__field")
        .values()
        .toArray()
        .map((field) => field.getBoundingClientRect().top),
    }));
    assert(layout.scroll <= width, JSON.stringify(layout));
    assert.equal(layout.groups.length, 6);
    for (const group of layout.groups) {
      assert.equal(group.background, "rgba(0, 0, 0, 0)");
      assert.equal(group.shadow, "none");
      assert.equal(group.border, "1px");
    }
    for (const input of layout.inputs) {
      assert(input.width <= 145);
      assert(input.height >= 44);
    }
    assert.equal(new Set(layout.orderRows).size, width > 900 ? 1 : 2);
    layouts.push(layout);
    const help = page.getByRole("button", {
      name: "주식계좌 최소 잔액",
      exact: true,
    });
    await help.focus();
    await page.getByRole("tooltip").waitFor();
    assert.match(
      await page.getByRole("tooltip").innerText(),
      /일반 지갑 잔액은 계산하지 않으며/,
    );
    assert.match(await page.getByRole("tooltip").innerText(), /예약금/);
    await help.press("Escape");
    await page.getByRole("tooltip").waitFor({ state: "hidden" });
    assert.deepEqual(
      await page.evaluate(() => [
        window.rulesQa.writes.length,
        window.rulesQa.reloads,
      ]),
      [0, 0],
    );
    await page.getByLabel("매수 수수료 (%)", { exact: true }).fill("2.25");
    await page
      .getByLabel("주식계좌 최소 잔액 (위스)", { exact: true })
      .fill("700");
    await save(page).press("Enter");
    await page.waitForFunction(() => window.rulesQa.toasts.length === 1);
    assert.deepEqual(
      await page.evaluate(() => window.rulesQa.writes[0].rules),
      await page.evaluate(() => ({
        ...window.rulesQa.defaults,
        buyFeeBps: 225,
        minimumCashReserve: 700,
      })),
    );
    assert.equal(await save(page).isDisabled(), true);
    await page.screenshot({
      path: path.join(evidence, `rules-${width}.png`),
      fullPage: true,
    });
    await page.close();
  }
  checks.push(
    "Five widths: 15 numeric values unchanged, four order fields in one desktop row, narrow inputs/units, transparent groups, visible separators, 44px inputs, keyboard help/save, zero implicit calls.",
  );
  const page = await open(390);
  await page.getByLabel("매수 수수료 (%)", { exact: true }).fill("3");
  await page.evaluate(() => {
    window.rulesQa.fail = true;
  });
  await save(page).click();
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page.getByLabel("매수 수수료 (%)", { exact: true }).inputValue(),
    "3",
  );
  await page.evaluate(() => {
    window.rulesQa.fail = false;
  });
  await save(page).click();
  await page.waitForFunction(() => window.rulesQa.toasts.length === 1);
  await page.getByLabel("매수 수수료 (%)", { exact: true }).fill("4");
  await page.evaluate(() => {
    window.rulesQa.conflict = true;
  });
  await save(page).click();
  await page
    .getByRole("button", { name: "최신 자료 확인", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("매수 수수료 (%)", { exact: true }).inputValue(),
    "4",
  );
  await page.evaluate(() => window.rulesQa.halt());
  await page.waitForFunction(() => window.rulesQa.market.rules.halted);
  await save(page).click();
  await page.waitForFunction(
    () => window.rulesQa.market.rules.buyFeeBps === 400,
  );
  assert.equal(
    await page.evaluate(() => window.rulesQa.market.rules.halted),
    true,
  );
  assert.deepEqual(
    await page.evaluate(() => [
      window.rulesQa.writes.length,
      window.rulesQa.reloads,
    ]),
    [4, 1],
  );
  await page.close();
  checks.push(
    "Failed save and CAS retry preserve drafts, one explicit reload, and external emergency halt survives a rule save.",
  );
  const busy = await open();
  await busy.getByLabel("매수 수수료 (%)", { exact: true }).fill("2");
  await busy.evaluate(() => (window.rulesQa.hold = true));
  await save(busy).click();
  await busy.waitForFunction(
    () => typeof window.rulesQa.release === "function",
  );
  assert.equal(await busy.locator("input:not(:disabled)").count(), 0);
  await busy.evaluate(() => window.rulesQa.release());
  await busy.waitForFunction(() => window.rulesQa.toasts.length === 1);
  assert.equal(await busy.evaluate(() => window.rulesQa.writes.length), 1);
  await busy.close();
  checks.push("Pending save disables editing and duplicate submission.");
  const readonly = await open(320, "?readonly");
  assert.equal(await readonly.locator("input:not(:disabled)").count(), 0);
  assert.equal(await save(readonly).count(), 0);
  assert.equal(await readonly.evaluate(() => window.rulesQa.writes.length), 0);
  await readonly.close();
  checks.push("Read-only teachers cannot edit or submit.");
  const conditions = await open(320);
  await conditions
    .getByLabel("1회 주문 금액 (위스)", { exact: true })
    .fill("1000000000000");
  assert.equal(
    await conditions
      .getByLabel("1회 주문 금액 (위스)", { exact: true })
      .inputValue(),
    "1000000000000",
  );
  assert.equal(
    await conditions.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await conditions
    .getByLabel("종료 시각 (한국)", { exact: true })
    .fill("00:00");
  await conditions
    .getByLabel("1회 주문 금액 (위스)", { exact: true })
    .fill("10000");
  await save(conditions).click();
  await conditions.waitForFunction(() => window.rulesQa.toasts.length === 1);
  assert.equal(
    await conditions.evaluate(() => window.rulesQa.market.rules.closeMinuteKst),
    1440,
  );
  for (const day of ["월", "화", "수", "목", "금"])
    await conditions
      .getByRole("group", { name: "거래 요일", exact: true })
      .getByLabel(day, { exact: true })
      .uncheck();
  assert.equal(await save(conditions).isDisabled(), true);
  await conditions
    .getByText("거래 요일을 하나 이상 선택해 주세요.", { exact: true })
    .waitFor();
  await conditions.close();
  checks.push(
    "Large values stay intact without overflow, midnight remains 1440, and empty trading days prevent submission.",
  );
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
} finally {
  await fs.writeFile(
    path.join(evidence, "summary.json"),
    JSON.stringify(
      {
        status: failure ? "FAIL" : "PASS",
        checks,
        layouts,
        errors,
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
console.log(JSON.stringify({ status: "PASS", checks, evidence }, null, 2));
