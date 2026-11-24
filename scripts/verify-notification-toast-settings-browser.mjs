// Real settings, bell, shared setting subscription and toast timers; synthetic
// Firestore and notification boundaries. No production records are accessed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
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
const evidence =
  process.env.NOTIFICATION_TOAST_EVIDENCE_DIR ||
  path.join(root, "output/notification-toast-20261124");
await fs.mkdir(evidence, { recursive: true });
const service = `
const params = new URLSearchParams(location.search);
export const qa=window.notificationQa={
  value:params.has('stored')?{teacherToastDurationSeconds:12}:{},reads:0,writes:[],commits:0,subscriptions:0,unsubscribes:0,itemLoads:0,readReceipts:0,
  failRead:params.has('failRead'),failWrite:false,hold:false,rows:[],inboxListeners:new Set(),settingListeners:new Set(),
  auth:{currentUser:{uid:'synthetic-teacher',email:'fixture@example.invalid'},config:{year:'2026',semester:'2'},userData:{role:'teacher'}}
};
export const useAuth=()=>qa.auth;
export const useAppDialog=()=>({confirm:async()=>true});
export const db={};
export const doc=(_db,...parts)=>({path:parts.join('/')});
const snapshot=()=>({exists:()=>true,data:()=>structuredClone(qa.value),metadata:{hasPendingWrites:false}});
export const getDoc=async reference=>{if(reference.path!=='site_settings/notification_config')throw Error('Unexpected read');qa.reads++;if(qa.failRead)throw Error('synthetic-read-failure');return snapshot();};
export const setDoc=async(reference,value,options)=>{
  if(reference.path!=='site_settings/notification_config'||!options.merge)throw Error('Unexpected write');
  qa.writes.push(structuredClone(value));
  if(qa.hold)await new Promise(resolve=>qa.release=resolve);
  if(qa.failWrite)throw Error('synthetic-save-failure');
  qa.value={...qa.value,...value};qa.commits++;qa.settingListeners.forEach(s=>s.next(snapshot()));
};
export const serverTimestamp=()=>({syntheticTimestamp:true});
export const onSnapshot=(reference,options,next,error)=>{
  if(reference.path!=='site_settings/notification_config')throw Error('Unexpected subscription');
  if(!options.includeMetadataChanges)throw Error('Committed setting must be received after a pending local write');
  qa.subscriptions++;const listener={next,error};qa.settingListeners.add(listener);
  queueMicrotask(()=>{if(qa.settingListeners.has(listener))next(snapshot());});
  return ()=>{qa.unsubscribes++;qa.settingListeners.delete(listener);};
};
export const invalidateSiteSettingDocCache=()=>{};
qa.setting=(seconds)=>{qa.value.teacherToastDurationSeconds=seconds;qa.settingListeners.forEach(s=>s.next(snapshot()));};
qa.settingError=()=>[...qa.settingListeners].forEach(s=>s.error(Error('synthetic-watch-failure')));
export const subscribeNotificationInbox=(_scope,uid,callback)=>{qa.inboxListeners.add(callback);callback({uid,unreadCount:0});return()=>qa.inboxListeners.delete(callback);};
export const subscribeBroadcastNotifications=(_scope,callback)=>{callback([]);return()=>{};};
export const loadNotifications=async()=>{qa.itemLoads++;return qa.rows;};
export const markNotificationsRead=async()=>{qa.readReceipts++;};
export const clearNotifications=async()=>{throw Error('Must not clear records');};
qa.notify=(title='학생 활동 알림',priority='normal')=>{
  qa.rows.unshift({id:'fixture-'+(qa.rows.length+1),title,body:'수신 내용 '.repeat(50),type:'system_notice',priority,createdAt:{toMillis:()=>Date.now()},readAt:null});
  qa.inboxListeners.forEach(callback=>callback({uid:qa.auth.currentUser.uid,unreadCount:qa.rows.length}));
};
`;
const harness = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import Settings from './src/pages/teacher/components/SettingsNotifications';
import Bell from './src/components/common/NotificationBell';
import {AppToastProvider} from './src/components/common/AppToastProvider';
import './src/assets/index.css';
import {qa} from 'fixture:service';
function Fixture(){const [version,setVersion]=React.useState(0);const [settingsVersion,setSettingsVersion]=React.useState(0);const [extra,setExtra]=React.useState(false);
  qa.render=()=>setVersion(v=>v+1);qa.remount=()=>setSettingsVersion(v=>v+1);qa.extra=setExtra;
  return <main style={{padding:16,maxWidth:1200,margin:'auto'}}><div><Bell/>{extra&&<Bell/>}</div><Settings key={settingsVersion}/></main>;
}
createRoot(document.getElementById('root')).render(<MemoryRouter><AppToastProvider><Fixture/></AppToastProvider></MemoryRouter>);
`;
const result = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(evidence, "fixture.js"),
  loader: {
    ".svg": "dataurl",
    ".webp": "dataurl",
    ".woff": "dataurl",
    ".woff2": "dataurl",
  },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "notification-boundaries",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^fixture:|^firebase\/firestore$|(?:^|\/)contexts\/AuthContext$|(?:^|\/)(firebase|siteSettings|notifications|AppDialogProvider)$/,
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
const js = result.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = result.outputFiles
  .find((f) => f.path.endsWith(".css"))
  .text.replace(/@import\s+(?:url\()?['"]https?:[^;]+;/g, "");
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://localhost").pathname;
  const [type, value] =
    p === "/fixture.js"
      ? ["text/javascript", js]
      : p === "/tailwind.js"
        ? ["text/javascript", tailwind]
        : p === "/fixture.css"
          ? ["text/css", css]
          : ["text/html", html];
  res.setHeader("Content-Type", type);
  res.end(value);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  const input = () =>
    page.getByRole("spinbutton", { name: "교사 수신 알림 표시 시간(초)" });
  const save = () =>
    page.getByRole("button", { name: "알림 설정 저장", exact: true });
  const qa = async (fn) => page.evaluate(fn);
  const reset = async (query = "") => {
    await page.goto(origin + query);
    await input().waitFor();
    await page.mouse.move(0, 0);
  };
  const clearToasts = async () => {
    while (await page.locator(".ws-toast__close").count())
      await page.locator(".ws-toast__close").first().click();
    await page.mouse.move(0, 0);
  };
  await reset();
  assert.equal(await input().inputValue(), "5");
  assert(await save().isDisabled());
  assert.equal(await qa(() => window.notificationQa.reads), 1);
  assert.equal(await qa(() => window.notificationQa.subscriptions), 1);
  await page.clock.install();
  await qa(() => window.notificationQa.notify("기본 5초", "high"));
  await page.locator(".ws-toast").waitFor();
  await page.clock.runFor(4900);
  assert.equal(await page.locator(".ws-toast").count(), 1);
  await page.clock.runFor(200);
  assert.equal(await page.locator(".ws-toast").count(), 0);
  assert.equal(await qa(() => window.notificationQa.readReceipts), 0);
  checks.push(
    "legacy default: high-priority long notification expires at 5 seconds; no read receipt",
  );

  await input().fill("3");
  await save().click();
  await page.waitForFunction(() => window.notificationQa.commits === 1);
  assert.equal(
    await qa(() => window.notificationQa.value.teacherToastDurationSeconds),
    3,
  );
  assert(await save().isDisabled());
  await clearToasts();
  await qa(() => window.notificationQa.notify("설정 3초"));
  await page.locator(".ws-toast").waitFor();
  await page.clock.runFor(2900);
  assert.equal(await page.locator(".ws-toast").count(), 1);
  await page.clock.runFor(200);
  assert.equal(await page.locator(".ws-toast").count(), 0);
  assert.equal(await qa(() => window.notificationQa.reads), 1);
  assert.equal(await qa(() => window.notificationQa.writes.length), 1);
  await qa(() => window.notificationQa.remount());
  await input().waitFor();
  await page.waitForFunction(() => window.notificationQa.reads === 2);
  assert.equal(await input().inputValue(), "3");
  checks.push(
    "one save persists, updates next toast immediately and reopens as 3 seconds; unchanged save disabled",
  );

  for (const invalid of ["", "0", "61", "1.5"]) {
    await input().fill(invalid);
    assert(await save().isDisabled());
    assert.equal(await input().getAttribute("aria-invalid"), "true");
  }
  await input().fill("9");
  await qa(() => {
    window.notificationQa.failWrite = true;
  });
  await save().click();
  await page.waitForFunction(() => window.notificationQa.writes.length === 2);
  await page
    .getByText("알림 설정 저장에 실패했습니다.", { exact: true })
    .first()
    .waitFor();
  assert.equal(await input().inputValue(), "9");
  assert.equal(await qa(() => window.notificationQa.commits), 1);
  await clearToasts();
  await qa(() => window.notificationQa.notify("실패 후 3초"));
  await page.locator(".ws-toast").waitFor();
  await page.clock.runFor(3100);
  assert.equal(await page.locator(".ws-toast").count(), 0);
  await qa(() => {
    window.notificationQa.failWrite = false;
    window.notificationQa.hold = true;
  });
  await save().click();
  await page.getByRole("button", { name: "저장 중..." }).waitFor();
  assert(await page.getByRole("button", { name: "저장 중..." }).isDisabled());
  assert.equal(await qa(() => window.notificationQa.writes.length), 3);
  await qa(() => {
    window.notificationQa.hold = false;
    window.notificationQa.release();
  });
  await page.waitForFunction(() => window.notificationQa.commits === 2);
  await clearToasts();
  await qa(() => window.notificationQa.notify("재시도 9초"));
  await page.locator(".ws-toast").waitFor();
  await page.clock.runFor(8900);
  assert.equal(await page.locator(".ws-toast").count(), 1);
  await page.clock.runFor(200);
  assert.equal(await page.locator(".ws-toast").count(), 0);
  checks.push(
    "invalid/empty/decimal bounds blocked; failed save retains input and old duration; explicit retry commits once",
  );

  await qa(() => window.notificationQa.extra(true));
  await page.waitForFunction(
    () => window.notificationQa.inboxListeners.size === 2,
  );
  assert.equal(await qa(() => window.notificationQa.subscriptions), 1);
  await qa(() => window.notificationQa.extra(false));
  await page.waitForFunction(
    () => window.notificationQa.inboxListeners.size === 1,
  );
  assert.equal(await qa(() => window.notificationQa.unsubscribes), 0);
  await qa(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await qa(() => window.notificationQa.settingListeners.size), 0);
  await qa(() => {
    window.notificationQa.setting(4);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(() => window.notificationQa.subscriptions === 2);
  await qa(() => window.notificationQa.notify("복귀 4초"));
  await page.locator(".ws-toast").waitFor();
  await page.clock.runFor(4100);
  assert.equal(await page.locator(".ws-toast").count(), 0);
  await qa(() => window.notificationQa.settingError());
  assert.equal(await qa(() => window.notificationQa.settingListeners.size), 0);
  await qa(() => window.notificationQa.notify("구독 실패 기본 5초"));
  await page.locator(".ws-toast").waitFor();
  await page.clock.runFor(4900);
  assert.equal(await page.locator(".ws-toast").count(), 1);
  await page.clock.runFor(200);
  assert.equal(await page.locator(".ws-toast").count(), 0);
  checks.push(
    "same-scope headers share one subscription; hidden tab releases it; error falls back to 5 seconds without polling",
  );

  await qa(() => {
    window.notificationQa.auth = {
      ...window.notificationQa.auth,
      currentUser: { uid: "synthetic-second" },
      config: { year: "2026", semester: "1" },
    };
    window.notificationQa.render();
  });
  await page.waitForFunction(() => window.notificationQa.subscriptions === 3);
  await qa(() => {
    window.notificationQa.auth.userData.role = "student";
    window.notificationQa.render();
  });
  await page.waitForFunction(
    () => window.notificationQa.settingListeners.size === 0,
  );
  assert.equal(await qa(() => window.notificationQa.readReceipts), 0);
  assert.equal(await qa(() => window.notificationQa.itemLoads), 6);
  checks.push(
    "account/semester changes recreate subscription; student role releases teacher subscription; toast expiry never writes read state",
  );

  await page.clock.resume();
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await reset("?stored");
    assert.equal(await input().inputValue(), "12");
    const bounds = await input().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        right: r.right,
        width: r.width,
        height: r.height,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert(bounds.right <= width && bounds.height >= 44 && !bounds.overflow);
    await page.screenshot({
      path: path.join(evidence, `settings-${width}.png`),
      fullPage: true,
    });
  }
  await page.goto(origin + "?failRead");
  await page.getByRole("button", { name: "다시 불러오기" }).waitFor();
  assert.equal(await save().count(), 0);
  assert.equal(await qa(() => window.notificationQa.writes.length), 0);
  await qa(() => {
    window.notificationQa.failRead = false;
  });
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await input().waitFor();
  assert.equal(await input().inputValue(), "5");
  assert.equal(await qa(() => window.notificationQa.reads), 2);
  checks.push(
    "390/768/1280px input reachable without horizontal overflow; read failure blocks editing until explicit successful retry",
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify({ checks }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, checks, evidence }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
