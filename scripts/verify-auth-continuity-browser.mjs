/** Actual auth controller/session adapter + MainLayout; synthetic transports only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
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
const evidence = path.resolve(
  process.env.AUTH_CONTINUITY_EVIDENCE_DIR ||
    path.join(root, "..", "evidence", "auth-continuity-browser"),
);
await fs.mkdir(evidence, { recursive: true });
const tailwind = await fs.readFile(
  process.env.AUTH_BROWSER_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
);
const source = (file) =>
  JSON.stringify(path.join(root, "src", file).replaceAll("\\", "/"));
const mocks = {
  "qa-auth": `
import {useSyncExternalStore} from "react";
import {AuthStartupController} from ${source("lib/authStartup.ts")};
import {prepareApplicationSession,invalidateApplicationSession} from ${source("lib/applicationSession.ts")};
import {cloneDefaultMenus} from ${source("constants/menus.ts")};
const listeners=new Set();
const role=new URLSearchParams(location.search).get("role") || "student";
let state,tokenFailure=null;
export const profile={role,privacyAgreed:true,customNameConfirmed:true,teacherPortalEnabled:false,staffPermissions:[]};
const account={uid:"synthetic-"+role,email:"synthetic@example.invalid",epoch:1234,getIdTokenResult:async()=>{backend.tokenCalls++;if(tokenFailure){const error=tokenFailure;tokenFailure=null;throw error;}return {claims:{auth_time:account.epoch}};}};
export const auth={currentUser:account};
const profileSnapshot=(extra={})=>({exists:true,data:profile,fromCache:false,hasPendingWrites:false,...extra});
export const backend={handshakes:0,tokenCalls:0,profiles:[],autoProfile:true,settings:0,open:async()=>{backend.handshakes++;return {data:{status:"active",authTime:account.epoch,authorityGeneration:"w1r2-2026-08-09",protocolVersion:2,revision:"a".repeat(64)}};}};
const controller=new AuthStartupController({currentUser:()=>auth.currentUser,prepareSession:prepareApplicationSession,
listenProfile:(user,next,error)=>{const subscription={next,error,stopped:false};backend.profiles.push(subscription);if(backend.autoProfile)next(profileSnapshot());return ()=>{subscription.stopped=true;};},
change:next=>{state=next;listeners.forEach(fn=>fn());},sessionReady:()=>{backend.settings++;},mark:()=>{},setTimer:(fn,delay)=>window.setTimeout(fn,delay),clearTimer:id=>window.clearTimeout(id)});
const config={year:"2026",semester:"2",showLesson:true,showQuiz:true,showScore:true};
const menuConfig=cloneDefaultMenus(), interfaceConfig={};
const refresh=async()=>{};
const logout=async()=>{invalidateApplicationSession(auth.currentUser);controller.invalidate();auth.currentUser=null;};
export const useAuth=()=>{const current=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>state);return {...current,authPhase:current.phase,authError:current.error,authGeneration:current.generation,loading:["resolving","opening-session","loading-profile"].includes(current.phase),config,configReady:true,menuConfig,menuConfigReady:true,interfaceConfig,interfaceConfigReady:true,settingsLoadedAt:Date.now(),refreshConfig:refresh,refreshMenuConfig:refresh,refreshInterfaceConfig:refresh,retryAuth:controller.retry,logout};};
export const qa={start:()=>controller.observe(account),stats:()=>({phase:state.phase,generation:state.generation,role:state.userData?.role,handshakes:backend.handshakes,subscriptions:backend.profiles.length,settings:backend.settings,tokenCalls:backend.tokenCalls}),
profileFailure:(code="unavailable")=>{backend.autoProfile=false;backend.profiles.at(-1).error({code});},
profileAck:()=>backend.profiles.at(-1).next(profileSnapshot()),
cachedEscalation:()=>backend.profiles.at(-1).next(profileSnapshot({fromCache:true,data:{role:"teacher"}})),
tokenFailure:()=>{tokenFailure={code:"auth/network-request-failed"};void controller.observe(account);},
logout};
`,
  "qa-firebase": `export {auth} from "qa-auth";import {backend} from "qa-auth";export const getHttpsCallable=async()=>async()=>backend.open();`,
  "qa-archive": `export const isSemesterArchive=false;`,
  "qa-toast": `export const useAppToast=()=>({showToast:()=>{}});`,
  "qa-header": `import React from "react";export default ()=> <div data-testid="fixture-header" className="p-4">위스토리 로그인 복구 검증</div>;`,
  "qa-workspace": `import React from "react";export const PortalWorkspaceFooterProvider=({children})=><>{children}</>;export const PortalFallbackFooter=()=>null;`,
  "qa-archive-boundary": `export const SemesterArchiveBanner=()=>null;export const SemesterArchiveUnavailable=()=>null;export const isArchiveUnavailableRoute=()=>false;`,
  "qa-lazy": `export const lazyWithRetry=()=>()=>null;`,
  "qa-null": `export default ()=>null;`,
};
const mappings = [
  [/contexts\/AuthContext$/, "qa-auth"],
  [/lib\/firebase$/, "qa-firebase"],
  [/lib\/semesterArchive$/, "qa-archive"],
  [/common\/AppToastProvider$/, "qa-toast"],
  [/common\/Header$/, "qa-header"],
  [/common\/PortalWorkspace$/, "qa-workspace"],
  [/common\/SemesterArchiveBoundary$/, "qa-archive-boundary"],
  [/lib\/lazyWithRetry$/, "qa-lazy"],
  [
    /common\/(StudentHistoryDictionaryController|StudentRankPromotionController|TeacherPatchMemoController)$/,
    "qa-null",
  ],
];
const harness = `
import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {HashRouter,Route,Routes} from "react-router-dom";
import MainLayout from ${source("components/layout/MainLayout.tsx")};
import {qa} from "qa-auth";
window.authQa=qa;window.mounts=0;window.unmounts=0;
function Work(){const [draft,setDraft]=useState("");useEffect(()=>{window.mounts++;return()=>{window.unmounts++;};},[]);return <section className="p-6" data-testid="work"><h1 className="text-xl font-bold">작성 중인 내용</h1><label className="block mt-4">연습 답안<textarea className="block w-full max-w-xl border rounded p-3 mt-2" value={draft} onChange={e=>setDraft(e.target.value)}/></label></section>;}
const portal=<MainLayout><Work/></MainLayout>;
createRoot(document.getElementById("root")).render(<HashRouter><Routes><Route path="/student/*" element={portal}/><Route path="/teacher/*" element={portal}/><Route path="/" element={<p>로그아웃 완료</p>}/></Routes></HashRouter>);
void qa.start();
`;
const result = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "browser",
  loader: { ".css": "empty", ".svg": "dataurl", ".webp": "dataurl" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "synthetic-only",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          const value = (
            args.path.startsWith(".")
              ? path.resolve(args.resolveDir, args.path)
              : args.path
          ).replaceAll("\\", "/");
          const id =
            value in mocks
              ? value
              : mappings.find(([pattern]) => pattern.test(value))?.[1];
          return id ? { path: id, namespace: "qa-mocks" } : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "qa-mocks" }, (args) => ({
          contents: mocks[args.path],
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
assert.deepEqual(
  Object.keys(result.metafile.inputs).filter((file) =>
    /node_modules[\\/](?:firebase|@firebase)[\\/]/.test(file),
  ),
  [],
);
const css = (
  await Promise.all(
    [
      "assets/css/style.css",
      "src/assets/index.css",
      "src/components/layout/teacherLayout.css",
      "src/components/layout/studentLayout.css",
      "src/components/common/loadingState.css",
    ].map((file) => fs.readFile(path.join(root, file), "utf8")),
  )
)
  .join("\n")
  .replace(/@import[^;]+;/g, "")
  .replace(/@tailwind[^;]+;/g, "");
const html = `<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auth continuity QA</title><script src="/tailwind.js"></script><style>${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((request, response) => {
  const target = request.url?.split("?")[0];
  response.setHeader(
    "Content-Type",
    target?.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8",
  );
  response.end(
    target === "/fixture.js"
      ? result.outputFiles[0].text
      : target === "/tailwind.js"
        ? tailwind
        : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = {
  status: "running",
  checks: [],
  screenshots: [],
  pageErrors: [],
  externalRequests: [],
  limitations: [
    "Actual controller, application session adapter and MainLayout; synthetic SDK user, callable transport, profile listener and settings. This does not verify a real account, production network latency or mobile OS persistence.",
  ],
};
report.sourceSha256 = Object.fromEntries(
  await Promise.all(
    [
      "src/lib/authStartup.ts",
      "src/lib/applicationSession.ts",
      "src/components/layout/MainLayout.tsx",
    ].map(async (file) => [
      file,
      createHash("sha256")
        .update(await fs.readFile(path.join(root, file)))
        .digest("hex"),
    ]),
  ),
);
let browser;
try {
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  report.browser = browser.version();
  for (const width of [390, 768, 1280])
    for (const role of ["student", "teacher"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on("pageerror", (error) => report.pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        if (route.request().url().startsWith(origin)) return route.continue();
        report.externalRequests.push(new URL(route.request().url()).origin);
        return route.abort();
      });
      await page.clock.install();
      await page.goto(`${origin}/?role=${role}#/${role}/dashboard`);
      const input = page.getByRole("textbox", { name: "연습 답안" });
      await input.fill("작성 중인 답안이 유지됩니다.");
      await input.focus();
      const before = await page.evaluate(() => {
        window.draftElement = document.querySelector("textarea");
        return window.authQa.stats();
      });
      assert.equal(before.handshakes, 1);
      assert.equal(before.subscriptions, 1);
      await page.evaluate(() => window.authQa.profileFailure());
      assert.equal(await input.inputValue(), "작성 중인 답안이 유지됩니다.");
      await page.clock.runFor(1000);
      await page.waitForFunction(
        () => window.authQa.stats().subscriptions === 2,
      );
      await page.evaluate(() => window.authQa.cachedEscalation());
      assert.equal(
        (await page.evaluate(() => window.authQa.stats())).role,
        role,
      );
      await page.evaluate(() => window.authQa.profileAck());
      await page.evaluate(() => window.authQa.tokenFailure());
      await page.clock.runFor(1000);
      await page.waitForFunction(() => window.authQa.stats().phase === "ready");
      const after = await page.evaluate(() => ({
        ...window.authQa.stats(),
        mounts: window.mounts,
        unmounts: window.unmounts,
        sameInput: window.draftElement === document.querySelector("textarea"),
        focused: document.activeElement === window.draftElement,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.equal(after.generation, before.generation);
      assert.equal(after.handshakes, 1);
      assert.equal(after.subscriptions, 2);
      assert.equal(after.settings, 1);
      assert.equal(after.mounts, 1);
      assert.equal(after.unmounts, 0);
      assert.equal(after.sameInput, true);
      assert.equal(after.focused, true);
      assert.equal(after.overflow, false);
      assert.equal(await input.inputValue(), "작성 중인 답안이 유지됩니다.");
      assert.equal(
        await page
          .getByRole("button", { name: "다시 확인", exact: true })
          .count(),
        0,
      );
      const screenshot = `${role}-recovered-${width}.png`;
      await page.screenshot({
        path: path.join(evidence, screenshot),
        fullPage: true,
      });
      report.screenshots.push(screenshot);
      report.checks.push({
        width,
        role,
        name: "transient-profile-token-preserve-draft-focus-mount",
        counts: after,
      });

      await page.evaluate(() =>
        window.authQa.profileFailure("permission-denied"),
      );
      await page
        .getByRole("heading", { name: "로그인을 확인하지 못했습니다" })
        .waitFor();
      assert.equal(await input.count(), 0);
      assert.equal(
        await page
          .getByRole("button", { name: "다시 확인", exact: true })
          .count(),
        0,
      );
      await page.clock.runFor(5000);
      assert.equal(
        (await page.evaluate(() => window.authQa.stats())).subscriptions,
        2,
      );
      report.checks.push({
        width,
        role,
        name: "permission-denied-immediately-removes-protected-work-without-retry",
      });
      const deniedScreenshot = `${role}-denied-${width}.png`;
      await page.screenshot({
        path: path.join(evidence, deniedScreenshot),
        fullPage: true,
      });
      report.screenshots.push(deniedScreenshot);
      await page.close();
    }
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.externalRequests, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = error.message;
  throw error;
} finally {
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks.length,
      screenshots: report.screenshots.length,
      evidence,
    }),
  );
}
