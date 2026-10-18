/** Actual policy panel and callable adapter; synthetic authenticated transport only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
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
const evidence = path.join(root, "output/yut-policy-20261018");
await fs.mkdir(evidence, { recursive: true });
const core = require(path.join(root, "functions/weplayCore.js"));
const initialPolicy = { ...structuredClone(core.DEFAULT_POLICY), version: 3 };
delete initialPolicy.yutWinnerReward;
const modulePath = (value) =>
  JSON.stringify(path.join(root, value).replaceAll("\\", "/"));
const service = `
import {useSyncExternalStore} from 'react';
const listeners=new Set(),query=new URLSearchParams(location.search),scenario=query.get('case')||'normal';
const qa=window.yutPolicyQA={calls:[],policies:{'2':${JSON.stringify(initialPolicy)},'1':{...${JSON.stringify(initialPolicy)},version:8,challengeCost:77,yutWinnerReward:{enabled:true,amount:11}}},state:{config:{year:'2026',semester:'2'},currentUser:{uid:'policy-teacher'},canManage:scenario!=='readonly',active:scenario!=='inactive'},holdRead:scenario==='pending-read',failRead:scenario==='load-error',holdSave:false,failSave:false};
qa.setState=patch=>{qa.state={...qa.state,...patch};listeners.forEach(fn=>fn());};
export const useQA=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>qa.state);
export const useAuth=()=>useQA();
export const getHistoryDictionaryCallable=async name=>async data=>{
 qa.calls.push({name,data:structuredClone(data)});const key=data.semester;
 if(name==='getWeplayPolicy'){
   const policy=structuredClone(qa.policies[key]);
   if(qa.holdRead){qa.holdRead=false;await new Promise(resolve=>qa.releaseRead=resolve);}
   if(qa.failRead){qa.failRead=false;throw new Error('load failure');}
   return {data:{policy,currentRankingPeriod:null}};
 }
 if(name==='saveWeplayPolicy'){
   if(qa.holdSave){qa.holdSave=false;await new Promise(resolve=>qa.releaseSave=resolve);}
   if(qa.failSave){qa.failSave=false;throw new Error('save failure');}
   if(data.policy.version!==qa.policies[key].version)throw Object.assign(new Error('conflict'),{code:'functions/aborted'});
   qa.policies[key]={...structuredClone(data.policy),version:data.policy.version+1};
   qa.saved=structuredClone(data);
   return {data:{policy:structuredClone(qa.policies[key]),currentRankingPeriod:null}};
 }
 throw new Error('Unexpected callable '+name);
};
`;
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';
import Panel from ${modulePath("src/pages/teacher/components/points/WeplayPolicyPanel.tsx")};
import {AppToastProvider} from ${modulePath("src/components/common/AppToastProvider.tsx")};
import ${modulePath("src/assets/index.css")};
import {useQA} from 'fixture:service';
function App(){const state=useQA();return <main style={{maxWidth:1100,margin:'0 auto',padding:16}}><h1>위스 운영 정책</h1><form onSubmit={event=>{event.preventDefault();window.yutPolicyQA.outerSubmitted=true;}}><Panel {...state}/></form></main>;}
createRoot(document.getElementById('root')).render(<AppToastProvider><App/></AppToastProvider>);
`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "yut-policy-qa.js"),
  loader: { ".svg": "dataurl", ".woff2": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "synthetic-transport",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^fixture:|(?:^|\/)contexts\/AuthContext$|(?:^|\/)historyDictionarySession$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
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
  .text.replace(/@import\s+[^;]+;/g, "");
const server = http.createServer((req, res) => {
  if (req.url === "/qa.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(js);
  }
  if (req.url === "/qa.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(css);
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>*,::before,::after{box-sizing:border-box}body{margin:0;font-family:sans-serif}h1{margin:0 0 24px;font-size:28px}button,input{font:inherit}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  reducedMotion: "reduce",
});
const errors = [],
  checks = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", (route) =>
  new URL(route.request().url()).origin === base
    ? route.continue()
    : route.abort(),
);
const go = async (scenario) => {
  await page.goto(base + "/?case=" + scenario);
};
const amount = () =>
  page.getByRole("spinbutton", {
    name: "윷놀이 1등 지급액 (위스)",
    exact: true,
  });
const toggle = () =>
  page.getByRole("checkbox", { name: "멀티플레이 1등 위스 지급", exact: true });
const save = () =>
  page.getByRole("button", { name: "위플레이 정책 저장", exact: true });
const saved = async () => {
  const toast = page.getByRole("group", {
    name: "정책 저장 완료",
    exact: true,
  });
  await toast
    .getByText("위플레이 정책을 저장했습니다.", { exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".weplay-policy__feedback").count(),
    0,
    "Save success is a toast rather than a persistent panel message",
  );
  await toast
    .getByRole("button", { name: "정책 저장 완료 알림 닫기", exact: true })
    .click();
  await toast.waitFor({ state: "hidden" });
};
const saveCalls = () =>
  page.evaluate(
    () =>
      window.yutPolicyQA.calls.filter(
        (call) => call.name === "saveWeplayPolicy",
      ).length,
  );
try {
  await go("normal");
  await amount().waitFor();
  assert.equal(await toggle().isChecked(), false);
  assert.equal(await amount().inputValue(), "0");
  assert.equal(await save().isDisabled(), true);
  assert.equal(await saveCalls(), 0);
  await page.getByRole("button", { name: "윷놀이 1등 지급 기준" }).click();
  await page.getByText(/온라인에서 완주한 1등 학생에게만 지급합니다/).waitFor();
  await page.keyboard.press("Escape");
  await toggle().check();
  await amount().fill("23");
  await amount().press("Enter");
  await saved();
  assert.deepEqual(
    await page.evaluate(() => window.yutPolicyQA.saved.policy.yutWinnerReward),
    { enabled: true, amount: 23 },
  );
  const savedPolicy = await page.evaluate(
    () => window.yutPolicyQA.saved.policy,
  );
  const { yutWinnerReward, ...unchanged } = savedPolicy;
  assert.deepEqual(
    unchanged,
    initialPolicy,
    "Adding Yut reward must preserve every existing naval policy field and version",
  );
  assert.equal(
    await page.evaluate(() => window.yutPolicyQA.outerSubmitted || false),
    false,
  );
  assert.deepEqual(
    await page.evaluate(() => [
      window.yutPolicyQA.saved.year,
      window.yutPolicyQA.saved.semester,
    ]),
    ["2026", "2"],
  );
  checks.push(
    "Missing Yut policy defaults disabled/0; explicit save includes CAS version and preserves all naval fields; Enter does not submit the parent form.",
  );

  for (const invalid of ["", "-1", "1.5", "10001"]) {
    const before = await saveCalls();
    await amount().fill(invalid);
    await save().click();
    assert.equal(await amount().getAttribute("aria-invalid"), "true");
    assert.equal(await saveCalls(), before);
  }
  await amount().fill("0");
  await save().click();
  await saved();
  assert.equal(
    await page.evaluate(
      () => window.yutPolicyQA.saved.policy.yutWinnerReward.amount,
    ),
    0,
  );
  await amount().fill("31");
  await page.evaluate(() => {
    window.yutPolicyQA.failSave = true;
  });
  await save().click();
  const failureToast = page.getByRole("group", {
    name: "정책 저장 실패",
    exact: true,
  });
  await failureToast
    .getByText(
      "정책을 저장하지 못했습니다. 입력한 값은 유지됩니다. 다시 저장해 주세요.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.locator(".weplay-policy__feedback").count(),
    0,
    "Ordinary save failure uses the shared error toast",
  );
  assert.equal(await amount().inputValue(), "31");
  await failureToast
    .getByRole("button", { name: "정책 저장 실패 알림 닫기", exact: true })
    .click();
  await failureToast.waitFor({ state: "hidden" });
  await save().click();
  await saved();
  await amount().fill("41");
  await page.evaluate(() => {
    window.yutPolicyQA.policies["2"].version += 1;
    window.yutPolicyQA.policies["2"].yutWinnerReward.amount = 17;
  });
  await save().click();
  await page
    .getByText(
      "다른 곳에서 정책이 변경되었습니다. 최신 정책을 불러온 뒤 다시 확인해 주세요.",
      { exact: true },
    )
    .waitFor();
  assert.match(
    await page.locator(".weplay-policy__feedback.is-error").textContent(),
    /다른 곳에서 정책이 변경되었습니다/,
  );
  assert.equal(
    await page.locator(".ws-toast").count(),
    0,
    "CAS conflict stays in the panel with its reload action",
  );
  assert.equal(await amount().inputValue(), "41");
  assert.equal(await save().isDisabled(), true);
  await page
    .getByRole("button", { name: "최신 정책 불러오기", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector("#weplay-yut-winner-amount")?.value === "17",
  );
  checks.push(
    "Empty/negative/fraction/out-of-range amounts are rejected; zero is valid; success and ordinary failure use shared dismissible toasts; failure keeps draft; CAS conflict remains persistent and requires explicit reload.",
  );

  await amount().fill("37");
  await page.evaluate(() => window.yutPolicyQA.setState({ active: false }));
  assert.equal(await amount().isVisible(), false);
  await page.evaluate(() => window.yutPolicyQA.setState({ active: true }));
  assert.equal(await amount().inputValue(), "37");
  await page.evaluate(() => {
    window.yutPolicyQA.holdSave = true;
  });
  await save().click();
  assert.equal(await amount().isDisabled(), true);
  assert.equal(
    await page.getByRole("button", { name: "저장 중…" }).isDisabled(),
    true,
  );
  await page.evaluate(() =>
    window.yutPolicyQA.setState({ config: { year: "2026", semester: "1" } }),
  );
  await page.waitForFunction(
    () => document.querySelector("#weplay-yut-winner-amount")?.value === "11",
  );
  await page.evaluate(() => window.yutPolicyQA.releaseSave());
  assert.equal(await amount().inputValue(), "11");
  assert.equal(
    await page
      .getByText("위플레이 정책을 저장했습니다.", { exact: true })
      .count(),
    0,
  );
  await amount().fill("49");
  await page.evaluate(() => {
    window.yutPolicyQA.holdSave = true;
  });
  await save().click();
  await page.evaluate(() => window.yutPolicyQA.setState({ canManage: false }));
  await amount().waitFor();
  await page.evaluate(() => window.yutPolicyQA.releaseSave());
  assert.equal(await amount().isDisabled(), true);
  assert.equal(await toggle().isDisabled(), true);
  checks.push(
    "Inactive tab preserves draft; pending save disables edits; semester and permission changes reject stale save UI responses.",
  );

  await go("pending-read");
  await page
    .getByText("위플레이 정책을 불러오는 중입니다.", { exact: true })
    .waitFor();
  await page.evaluate(() =>
    window.yutPolicyQA.setState({ config: { year: "2026", semester: "1" } }),
  );
  await page.waitForFunction(
    () => document.querySelector("#weplay-yut-winner-amount")?.value === "11",
  );
  await page.evaluate(() => window.yutPolicyQA.releaseRead());
  assert.equal(await amount().inputValue(), "11");
  await go("load-error");
  await page
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .click();
  await amount().waitFor();
  await go("readonly");
  await amount().waitFor();
  assert.equal(await amount().isDisabled(), true);
  assert.equal(await toggle().isDisabled(), true);
  assert.equal(await save().isDisabled(), true);
  assert.equal(await saveCalls(), 0);
  await page.getByRole("button", { name: "윷놀이 1등 지급 기준" }).focus();
  await page.getByText(/온라인에서 완주한 1등 학생에게만 지급합니다/).waitFor();
  await page.keyboard.press("Escape");
  await go("inactive");
  assert.equal(await page.evaluate(() => window.yutPolicyQA.calls.length), 0);
  checks.push(
    "Stale reads are ignored; load retry works; read-only cannot save; inactive policy makes no read.",
  );

  await go("normal");
  await amount().waitFor();
  await toggle().check();
  await amount().fill("25");
  for (const width of [390, 768, 1280, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await page.mouse.move(0, 0);
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    assert((await amount().boundingBox()).height >= 44);
    await page.screenshot({
      path: path.join(evidence, `yut-policy-${width}.png`),
      fullPage: true,
    });
  }
  checks.push(
    "390/768/1280/1366px render without page overflow; numeric input has a 44px target.",
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
