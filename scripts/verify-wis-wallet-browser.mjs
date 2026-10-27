/** Actual wallet pages with synthetic services; every non-local request is blocked. */
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
  process.env.WIS_WALLET_QA_EVIDENCE_DIR ||
  path.join(os.tmpdir(), "westory-wis-wallet-qa");
await fs.mkdir(evidence, { recursive: true });
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const service = `
const teacher=new URLSearchParams(location.search).has('teacher');
export const qa=window.wisWalletQa={calls:[],toasts:[],balance:100,revision:4,failRead:false,failCoreRead:false,holdNext:false,grantCount:0};
const user={uid:teacher?'teacher':'student-a',email:'fixture@example.invalid',getIdTokenResult:async()=>({claims:{auth_time:1}})};
let config={year:'2026',semester:'2'};
qa.setSemester=semester=>{config={...config,semester};window.renderWalletFixture()};
const profile={uid:user.uid,role:teacher?'teacher':'student',name:'합성학생',grade:'3',class:'1',number:'7'};
export const useAuth=()=>({currentUser:user,userData:profile,config,configReady:true,authGeneration:1,interfaceConfig:{},refreshInterfaceConfig:async()=>{}});
export const useAppToast=()=>({showToast:value=>qa.toasts.push(value)});
export const useAppDialog=()=>({confirm:async()=>true});
export const isSemesterArchive=false;
export const archiveScope=null;
export const auth={currentUser:user};
qa.setAuthenticated=value=>{auth.currentUser=value?user:null};
export const db={};
export const getHttpsCallable=async()=>{throw Error('Unexpected callable')};
export const getFirebaseStorage=async()=>{throw Error('Unexpected storage')};
export const canManagePoints=()=>true,canReadPoints=()=>true;
export const ensureSensitiveOperation=async()=>{};
export const POINT_POLICY_FALLBACK={manualAdjustEnabled:true,allowNegativeBalance:false,rankPolicy:{enabled:false},rewardPolicy:{},controlPolicy:{}};
export const getPointPolicy=async()=>POINT_POLICY_FALLBACK;
export const getPointRankManualAdjustEarnedPointsMap=async()=>({});
export const getPointRankManualAdjustEarnedPointsByUid=async()=>0;
const wallet=()=>({uid:'student-a',studentName:'합성학생',grade:'3',class:'1',number:'7',balance:qa.balance,revision:qa.revision,earnedTotal:130,rankEarnedTotal:130,spentTotal:30,adjustedTotal:0});
const entry=(id,type,delta,balanceAfter,sourceLabel)=>({id,uid:'student-a',type,activityType:type,delta,balanceAfter,sourceLabel,createdAt:{seconds:1793050000+Number(id.slice(1))},canReverse:false});
const page=async(scope,uid,cursor='')=>{
qa.calls.push({kind:'page',uid,cursor});
const result={wallet:wallet(),transactions:cursor?[entry('l1','manual_adjust',110,110,'시작 지급')]:qa.revision>=6?[entry('l6','manual_adjust',80,qa.balance,'최신 지급 내역')]:qa.editable?[{...entry('l4','manual_adjust',10,qa.balance,'수정할 지급'),canReverse:true}]:[entry('l3','weplay_cost',-30,100,'충무공 도전 비용'),entry('l2','weplay_reward',20,130,'충무공 도전 보상')],nextCursor:cursor?'':'older'};
if(qa.holdNext){qa.holdNext=false;await new Promise(resolve=>qa.release=resolve)}
if(qa.failRead||(!cursor&&qa.failCoreRead))throw Error('synthetic read failed');return result;
};
export const getStudentPointTransactionPage=page,getCanonicalPointTransactionPage=page;
export const getStudentPointWallet=async()=>wallet();
export const listPointWallets=async()=>{qa.calls.push({kind:'roster',semester:config.semester});const result=[wallet()];if(qa.holdRosterNext){qa.holdRosterNext=false;await new Promise(resolve=>qa.releaseRoster=resolve)}return result};
export const listPointStudentTargets=async()=>[wallet()],listPointStudentTargetsByClass=async()=>[wallet()];
export const getPointSchoolOptions=async()=>({grades:[{value:'3',label:'3학년'}],classes:[{value:'1',label:'1반'}]});
export const listStudentPointOrders=async()=>[],listStudentPointProducts=async()=>[];
export const listPointProducts=async()=>[],listPointOrders=async()=>[],listPointTransactionsByUid=async()=>[];
export const getStudentPointHallOfFame=async()=>null;
export const getPendingCanonicalPointAdjustment=()=>null;
export const latestWisWallet=(current,next)=>current&&next&&current.uid===next.uid&&current.revision>next.revision?current:next;
export const adjustPoints=async(input)=>{qa.grantCount++;qa.calls.push({kind:'grant',uid:input.uid});qa.balance+=input.delta;qa.revision++;return{balance:qa.balance,accountRevision:qa.revision}};
export const createSecurePurchaseRequest=async()=>{throw Error('Unexpected purchase')};
export const cancelCanonicalPurchase=async()=>{throw Error('Unexpected cancel')};
export const deletePointProduct=async()=>{},reviewPointOrder=async()=>{},updatePointAdjustment=async()=>{},upsertPointPolicy=async()=>{},upsertPointProduct=async()=>{};
export const readArchivedShopProducts=async()=>[],readArchivedShopOrders=async()=>[];
`;
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';
import Points from ${imp("src/pages/student/Points.tsx")};
import ManagePoints from ${imp("src/pages/teacher/ManagePoints.tsx")};
import {notifyPointsUpdated,subscribePointsForegroundRefresh,getPointsRevision} from ${imp("src/lib/appEvents.ts")};
import {auth} from ${imp("src/lib/firebase")};
import ${imp("src/assets/index.css")};
window.refreshWis=notifyPointsUpdated;
window.getWisRevision=getPointsRevision;
window.addForegroundSubscriber=()=>subscribePointsForegroundRefresh(()=>!!auth.currentUser);
const teacher=new URLSearchParams(location.search).has('teacher');
const reactRoot=createRoot(document.getElementById('root'));
window.renderWalletFixture=()=>reactRoot.render(<HashRouter>{teacher?<ManagePoints/>:<Points/>}</HashRouter>);
window.unmountWalletFixture=()=>reactRoot.unmount();
window.renderWalletFixture();
`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "westory-wallet-qa.js"),
  loader: { ".svg": "dataurl", ".webp": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "synthetic-wallet-services",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)contexts\/AuthContext$|(?:^|\/)(?:common\/)?AppToastProvider$|(?:^|\/)(?:common\/)?AppDialogProvider$|(?:^|\/)(?:lib\/)?(points|studentWis|pointEconomyAdapter|wisEconomyClient|firebase|sensitiveOperation|semesterArchive|pointShopArchive|permissions)$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)(StudentPointHallOfFameTab|PointPolicyTab|PointRanksTab|HallOfFameManagementTab)$/,
          },
          () => ({ path: "empty", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents:
            args.path === "service"
              ? service
              : "export default function Empty(){return null}",
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
const tailwind = await fs.readFile(
  process.env.WIS_WALLET_QA_TAILWIND ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/qa.css"><div id="root"></div><script type="module" src="/qa.js"></script></html>';
const server = http.createServer((req, res) => {
  const files = {
    "/qa.js": ["text/javascript", js],
    "/qa.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  };
  const [type, data] = files[new URL(req.url, "http://localhost").pathname] || [
    "text/html",
    html,
  ];
  res.setHeader("Content-Type", type + ";charset=utf-8");
  res.end(data);
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
async function open(width = 1280, teacher = false, tab = "overview") {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await page.goto(
    `${origin}/${teacher ? "?teacher=1" : ""}#/${teacher ? "teacher/manage-points" : "student/points"}?tab=${tab}`,
  );
  return page;
}
try {
  for (const width of [390, 768, 1280])
    for (const teacher of [false, true]) {
      const page = await open(width, teacher);
      await page.getByText("충무공 도전 비용", { exact: true }).waitFor();
      const more = page.getByRole("button", {
        name: "이전 기록 더 보기",
        exact: true,
      });
      await more.press("Enter");
      await page.getByText("시작 지급", { exact: true }).waitFor();
      assert.equal(await more.count(), 0);
      assert.equal(await page.getByText("-30 ₩s", { exact: true }).count(), 1);
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      assert(
        layout.scrollWidth <= width,
        `${teacher ? "teacher" : "student"} overflow at ${width}`,
      );
      layouts.push({ teacher, ...layout });
      await page.screenshot({
        path: path.join(
          evidence,
          `${teacher ? "teacher" : "student"}-${width}.png`,
        ),
        fullPage: true,
      });
      await page.close();
    }
  checks.push(
    "390/768/1280 student and teacher: negative game entries, keyboard pagination, older records, no overflow.",
  );
  const student = await open();
  await student.getByText("충무공 도전 비용", { exact: true }).waitFor();
  await student.getByRole("button", { name: "사용", exact: true }).click();
  assert.equal(
    await student.getByText("충무공 도전 보상", { exact: true }).count(),
    0,
  );
  await student.getByLabel("위스 상세 유형").selectOption("weplay_cost");
  assert.equal(
    await student.getByText("충무공 도전 비용", { exact: true }).count(),
    1,
  );
  await student.evaluate(() => {
    window.wisWalletQa.holdNext = true;
  });
  await student
    .getByRole("button", { name: "이전 기록 더 보기", exact: true })
    .click();
  await student.waitForFunction(
    () => typeof window.wisWalletQa.release === "function",
  );
  await student.evaluate(() => {
    window.wisWalletQa.balance = 180;
    window.wisWalletQa.revision = 5;
    window.refreshWis();
  });
  await student.getByText("180 ₩s", { exact: true }).waitFor();
  await student.evaluate(() => window.wisWalletQa.release());
  await student.waitForTimeout(75);
  assert.equal(await student.getByText("180 ₩s", { exact: true }).count(), 1);
  assert.equal(
    await student.getByText("시작 지급", { exact: true }).count(),
    0,
  );
  await student.evaluate(() => {
    window.wisWalletQa.failRead = true;
  });
  await student
    .getByRole("button", { name: "이전 기록 더 보기", exact: true })
    .click();
  await student
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .waitFor();
  await student.evaluate(() => {
    window.wisWalletQa.failRead = false;
  });
  await student
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .click();
  await student
    .getByRole("button", { name: "이전 기록 더 보기", exact: true })
    .waitFor();
  checks.push(
    "Student game filtering, late pre-update page response rejected, failure and retry preserve the committed balance.",
  );
  await student.close();
  const revisionRefresh = await open();
  await revisionRefresh
    .getByText("충무공 도전 비용", { exact: true })
    .waitFor();
  await revisionRefresh.evaluate(() => {
    window.wisWalletQa.balance = 180;
    window.wisWalletQa.revision = 5;
    // The older-page read succeeds with a new account revision. Only the
    // required replacement first-page read fails, exercising the handoff.
    window.wisWalletQa.failCoreRead = true;
  });
  await revisionRefresh
    .getByRole("button", { name: "이전 기록 더 보기", exact: true })
    .click();
  const coreRetry = revisionRefresh.getByRole("button", {
    name: "다시 불러오기",
    exact: true,
  });
  await coreRetry.waitFor();
  assert.equal(await coreRetry.isEnabled(), true);
  assert.deepEqual(
    await revisionRefresh.evaluate(() =>
      window.wisWalletQa.calls
        .filter((row) => row.kind === "page")
        .map((row) => row.cursor),
    ),
    ["", "older", ""],
  );
  assert.equal(
    await revisionRefresh.getByText("불러오는 중…", { exact: true }).count(),
    0,
  );
  await revisionRefresh.screenshot({
    path: path.join(evidence, "student-revision-refresh-failed.png"),
    fullPage: true,
  });
  // Repeated failure remains retryable, then a successful read restores both
  // the current balance and the older-page control without a page reload.
  await coreRetry.click();
  await revisionRefresh.waitForFunction(
    () =>
      window.wisWalletQa.calls.filter((row) => row.kind === "page").length ===
      4,
  );
  await coreRetry.waitFor();
  assert.equal(await coreRetry.isEnabled(), true);
  await revisionRefresh.evaluate(() => {
    window.wisWalletQa.failCoreRead = false;
  });
  await coreRetry.click();
  await revisionRefresh.getByText("180 ₩s", { exact: true }).waitFor();
  const recoveredMore = revisionRefresh.getByRole("button", {
    name: "이전 기록 더 보기",
    exact: true,
  });
  await recoveredMore.waitFor();
  assert.equal(await recoveredMore.isEnabled(), true);
  assert.equal(
    await revisionRefresh.getByText("업데이트 중", { exact: true }).count(),
    0,
  );
  await recoveredMore.press("Enter");
  await revisionRefresh.getByText("시작 지급", { exact: true }).waitFor();
  assert.equal(await recoveredMore.count(), 0);
  checks.push(
    "A changed revision during older-page loading triggers a first-page refresh; failed refresh and repeated failure remain retryable, then balance and enabled pagination recover without reloading the page.",
  );
  await revisionRefresh.close();
  const teacher = await open(1280, true, "grant");
  await teacher.getByLabel("학생 이름 검색").fill("합성");
  await teacher.getByPlaceholder("지급할 위스 수량").fill("10");
  await teacher.locator("textarea").fill("수업 참여");
  const rosterReads = await teacher.evaluate(
    () =>
      window.wisWalletQa.calls.filter((row) => row.kind === "roster").length,
  );
  await teacher.evaluate(() => {
    window.wisWalletQa.holdNext = true;
  });
  await teacher.locator('button[type="submit"]').click();
  await teacher.waitForFunction(() =>
    window.wisWalletQa.toasts.some((row) => row.tone === "success"),
  );
  assert.equal(
    await teacher.locator('button[type="submit"]').isDisabled(),
    false,
  );
  assert.equal(await teacher.evaluate(() => window.wisWalletQa.grantCount), 1);
  assert.equal(
    await teacher.evaluate(
      () =>
        window.wisWalletQa.calls.filter((row) => row.kind === "roster").length,
    ),
    rosterReads,
  );
  await teacher.evaluate(() => {
    window.wisWalletQa.failRead = true;
    window.wisWalletQa.release();
  });
  await teacher
    .getByText(
      "지급은 완료되었습니다. 최신 내역은 위스 현황에서 다시 불러와 주세요.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await teacher.evaluate(
      () =>
        window.wisWalletQa.toasts.filter((row) => row.tone === "error").length,
    ),
    0,
  );
  await teacher.screenshot({
    path: path.join(evidence, "teacher-grant-refresh-failed.png"),
    fullPage: true,
  });
  checks.push(
    "Grant acknowledged while follow-up read is held; no full roster reread; failed follow-up does not report grant failure or issue a second command.",
  );
  await teacher.close();
  const race = await open(1280, true, "grant");
  await race.getByLabel("학생 이름 검색").fill("합성");
  await race.getByPlaceholder("지급할 위스 수량").fill("10");
  await race.locator("textarea").fill("수업 참여");
  await race.evaluate(() => {
    window.wisWalletQa.holdNext = true;
  });
  await race.locator('button[type="submit"]').click();
  await race.waitForFunction(
    () => typeof window.wisWalletQa.release === "function",
  );
  await race.evaluate(() => {
    window.wisWalletQa.balance = 180;
    window.wisWalletQa.revision = 6;
    location.hash = "/teacher/manage-points?tab=overview";
  });
  await race.getByText("최신 지급 내역", { exact: true }).waitFor();
  await race.evaluate(() => window.wisWalletQa.release());
  await race.waitForTimeout(75);
  assert.equal(
    await race.getByText("최신 지급 내역", { exact: true }).count(),
    1,
  );
  assert.equal(
    await race.getByText("충무공 도전 비용", { exact: true }).count(),
    0,
  );
  checks.push(
    "Teacher revision 6 wallet and ledger survive a delayed revision 5 grant follow-up response.",
  );
  await race.close();
  const overview = await open(1280, true);
  await overview.getByText("충무공 도전 비용", { exact: true }).waitFor();
  await overview.evaluate(() => {
    window.wisWalletQa.editable = true;
  });
  await overview.getByRole("button", { name: "새로고침", exact: true }).click();
  await overview.getByText("수정할 지급", { exact: true }).click();
  await overview.evaluate(() => {
    window.wisWalletQa.holdRosterNext = true;
  });
  await overview
    .getByRole("button", { name: "내역 취소", exact: true })
    .click();
  await overview.waitForFunction(
    () => typeof window.wisWalletQa.releaseRoster === "function",
  );
  await overview.evaluate(() => {
    window.wisWalletQa.balance = 180;
    window.wisWalletQa.revision = 6;
  });
  await overview.getByRole("button", { name: "새로고침", exact: true }).click();
  await overview.getByText("최신 지급 내역", { exact: true }).waitFor();
  await overview.evaluate(() => {
    window.wisWalletQa.holdNext = true;
    window.wisWalletQa.releaseRoster();
  });
  await overview.waitForFunction(
    () => typeof window.wisWalletQa.release === "function",
  );
  assert((await overview.getByText("180 ₩s", { exact: true }).count()) > 0);
  assert.equal(await overview.getByText("100 ₩s", { exact: true }).count(), 0);
  await overview.evaluate(() => window.wisWalletQa.release());
  await overview.getByText("최신 지급 내역", { exact: true }).waitFor();
  await overview.close();
  checks.push(
    "A delayed overview roster at revision 4 cannot replace the already displayed revision 6 balance, including while its follow-up ledger is pending.",
  );

  const scope = await open(1280, true);
  await scope.getByText("충무공 도전 비용", { exact: true }).waitFor();
  await scope.evaluate(() => {
    window.wisWalletQa.editable = true;
  });
  await scope.getByRole("button", { name: "새로고침", exact: true }).click();
  await scope.getByText("수정할 지급", { exact: true }).click();
  await scope.evaluate(() => {
    window.wisWalletQa.holdRosterNext = true;
  });
  await scope.getByRole("button", { name: "내역 취소", exact: true }).click();
  await scope.waitForFunction(
    () => typeof window.wisWalletQa.releaseRoster === "function",
  );
  await scope.evaluate(() => {
    window.wisWalletQa.balance = 70;
    window.wisWalletQa.revision = 2;
    window.wisWalletQa.setSemester("1");
  });
  await scope.getByText("70 ₩s", { exact: true }).first().waitFor();
  const readsAfterSwitch = await scope.evaluate(
    () => window.wisWalletQa.calls.filter((row) => row.kind === "page").length,
  );
  await scope.evaluate(() => window.wisWalletQa.releaseRoster());
  await scope.waitForTimeout(80);
  assert.equal(
    await scope.evaluate(
      () =>
        window.wisWalletQa.calls.filter((row) => row.kind === "page").length,
    ),
    readsAfterSwitch,
  );
  assert((await scope.getByText("70 ₩s", { exact: true }).count()) > 0);
  assert.equal(await scope.getByText("100 ₩s", { exact: true }).count(), 0);
  await scope.close();
  checks.push(
    "Semester switch resets revision guards; an old overview response cannot overwrite the new semester balance or start another old-scope ledger read.",
  );

  const foreground = await open();
  await foreground.getByText("충무공 도전 비용", { exact: true }).waitFor();
  const initialReads = await foreground.evaluate(
    () => window.wisWalletQa.calls.filter((row) => row.kind === "page").length,
  );
  await foreground.evaluate(() => {
    window.removeExtraForeground = window.addForegroundSubscriber();
    window.wisWalletQa.balance = 180;
    window.wisWalletQa.revision = 6;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
  });
  await foreground.waitForTimeout(260);
  assert.equal(
    await foreground.evaluate(
      () =>
        window.wisWalletQa.calls.filter((row) => row.kind === "page").length,
    ),
    initialReads,
  );
  await foreground.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
  });
  await foreground.getByText("180 ₩s", { exact: true }).waitFor();
  assert.equal(
    await foreground.evaluate(
      () =>
        window.wisWalletQa.calls.filter((row) => row.kind === "page").length,
    ),
    initialReads + 1,
  );
  await foreground.evaluate(() => {
    window.wisWalletQa.setAuthenticated(false);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
  });
  await foreground.waitForTimeout(260);
  assert.equal(
    await foreground.evaluate(
      () =>
        window.wisWalletQa.calls.filter((row) => row.kind === "page").length,
    ),
    initialReads + 1,
  );
  const beforeUnmountRevision = await foreground.evaluate(() =>
    window.getWisRevision(),
  );
  await foreground.evaluate(() => {
    window.wisWalletQa.setAuthenticated(true);
    window.dispatchEvent(new Event("focus"));
    window.removeExtraForeground();
    window.unmountWalletFixture();
  });
  await foreground.waitForTimeout(260);
  assert.equal(
    await foreground.evaluate(() => window.getWisRevision()),
    beforeUnmountRevision,
  );
  await foreground.close();
  const teacherForeground = await open(1280, true);
  await teacherForeground
    .getByText("충무공 도전 비용", { exact: true })
    .waitFor();
  const teacherReads = await teacherForeground.evaluate(
    () => window.wisWalletQa.calls.length,
  );
  await teacherForeground.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
  await teacherForeground.waitForTimeout(260);
  assert.equal(
    await teacherForeground.evaluate(() => window.wisWalletQa.calls.length),
    teacherReads,
  );
  await teacherForeground.close();
  checks.push(
    "Visible student focus/visibility/online bursts refresh once across shared subscribers; hidden, signed-out and teacher sessions do not read; unmount cancels the pending foreground event.",
  );
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
} finally {
  await fs.writeFile(
    path.join(evidence, "result.json"),
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
