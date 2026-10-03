/** Isolated, real React UI checks with synthetic auth data. Never contacts Firebase. */
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
const serveOnly = process.env.AUTH_BROWSER_SERVE_ONLY === "1";
let playwright;
if (!serveOnly) {
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
}
const evidence = path.resolve(
  process.env.AUTH_BROWSER_EVIDENCE_DIR ||
    path.join(root, "..", "evidence", "auth-startup-browser"),
);
await fs.mkdir(evidence, { recursive: true });
const tailwindPath =
  process.env.AUTH_BROWSER_TAILWIND_PATH ||
  path.join(os.tmpdir(), "westory-qa-tailwind.js");
let tailwind;
try {
  tailwind = await fs.readFile(tailwindPath);
} catch {
  throw new Error(
    "A local copy of the app's Tailwind CDN runtime is required. Set AUTH_BROWSER_TAILWIND_PATH; this fixture never downloads or contacts a CDN.",
  );
}
const normalize = (value) => value.replaceAll("\\", "/");
const source = (name) =>
  JSON.stringify(normalize(path.join(root, "src", name)));
const fakeAuth = `
import React, {useSyncExternalStore} from "react";
const listeners = new Set(), profileWaiters = new Set();
const empty = {authPhase:"signed-out",loading:false,currentUser:null,onboardingUser:null,userData:null,authError:null,authGeneration:1};
export const user = {uid:"synthetic-student",email:"qa-fixture@yongshin-ms.ms.kr",displayName:"",photoURL:"",getIdTokenResult:async()=>({authTime:"fixture-epoch",claims:{auth_time:1}})};
export const profile = {uid:user.uid,email:user.email,role:"student",name:"가나다",grade:"1",class:"1",number:"1",customNameConfirmed:true,privacyAgreed:true,consentAgreedItems:[],staffPermissions:[],teacherPortalEnabled:false};
export const auth = {currentUser:null};
let generation = 1, flow = 0, pending = null, profilePayload = null;
export const events = [];
let state = {...empty};
const publish = (next) => {state={...state,...next};listeners.forEach(fn=>fn());profileWaiters.forEach(fn=>fn());};
export const phase = (name, extra={}) => {
  const ready=name==="ready", onboarding=name==="onboarding";
  auth.currentUser=name==="signed-out" ? null : user;
  publish({...empty,authPhase:name,loading:["resolving","opening-session","loading-profile"].includes(name),authGeneration:++generation,currentUser:ready?user:null,userData:ready?profile:null,onboardingUser:onboarding?user:null,...extra});
};
export const timeout = () => phase("error",{authError:{code:"auth/startup-timeout",message:"로그인 확인이 지연되고 있습니다. 연결 상태를 확인한 뒤 다시 확인해 주세요.",retryable:true}});
export const forced = () => phase("error",{authError:{code:"SESSION_REAUTH_REQUIRED",message:"안전한 접속을 위해 다시 로그인해 주세요.",retryable:false}});
const retryAuth = async () => {events.push("retry");phase("opening-session");return new Promise((resolve,reject)=>{pending={resolve,reject};});};
const logout = async () => {events.push("logout");const previous=pending;pending=null;phase("signed-out");previous?.reject(new Error("synthetic cancelled attempt"));};
export const serverProfile = () => {events.push("server-profile");phase("ready");const previous=pending;pending=null;previous?.resolve();};
export const offline = () => {events.push("offline-failure");timeout();const previous=pending;pending=null;previous?.reject(new Error("synthetic offline"));};
export const profileWritten = (payload) => {events.push("synthetic-write");profilePayload=payload;};
export const ackProfile = () => {if(!profilePayload)throw new Error("No synthetic write to acknowledge");events.push("server-profile-ack");publish({authPhase:"ready",loading:false,currentUser:user,onboardingUser:null,userData:{...profile,...profilePayload,uid:user.uid},authError:null});profilePayload=null;};
const config={showLesson:true,showQuiz:true,showScore:true};
const refresh = async () => {};
export const useAuth = () => {
  const current = useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state);
  return {...current,config,configReady:true,menuConfig:null,menuConfigReady:true,settingsLoadedAt:Date.now(),interfaceConfig:{},refreshConfig:refresh,refreshMenuConfig:refresh,logout,retryAuth,
    beginLoginFlow:(resume=false)=>{++flow;if(!resume)publish({...empty,authGeneration:++generation,authPhase:"resolving",loading:true});return flow;},
    isLoginFlowCurrent:attempt=>attempt===flow,
    abandonLoginFlow:attempt=>{if(attempt===flow){events.push("flow-abandoned");flow++;}},
    discardStaleLoginUser:async(loginUser,attempt)=>{if(attempt!==flow && auth.currentUser===loginUser){events.push("stale-user-discarded");phase("signed-out");}},
    failLoginFlow:(attempt,error)=>{if(attempt!==flow)return;events.push("login-flow-failed");if(!auth.currentUser)phase("signed-out");else timeout();},
    claimLoginBootstrap:async(loginUser)=>({generation:state.authGeneration,user:loginUser,authTime:"fixture-epoch",profile:state.userData}),
    waitForAuthProfile:async(attempt,loginUser,matches)=>new Promise((resolve,reject)=>{const check=()=>{if(attempt!==state.authGeneration || loginUser!==auth.currentUser){profileWaiters.delete(check);reject(Object.assign(new Error("synthetic stale"),{code:"auth/stale-attempt"}));}else if(state.authPhase==="ready" && state.userData && matches(state.userData)){events.push("profile-ack-accepted");profileWaiters.delete(check);resolve();}};profileWaiters.add(check);check();}),
    isAuthAttemptCurrent:(attempt,loginUser)=>attempt===state.authGeneration && loginUser===auth.currentUser && state.authPhase!=="error",
    assertAuthAttemptCurrent:async(attempt,loginUser)=>{if(attempt!==state.authGeneration || loginUser!==auth.currentUser || state.authPhase==="error")throw Object.assign(new Error("synthetic stale"),{code:"auth/stale-attempt"});}
  };
};
`;
const mocks = {
  "qa-auth": fakeAuth,
  "qa-firebase": `export {auth} from "qa-auth";import {events} from "qa-auth";export const db={};export const authPersistenceReady=Promise.resolve();export const configuredAuthDomain="127.0.0.1";export const getFirebaseFunctions=async()=>{events.push("functions-sdk-prepared");return {};};`,
  "qa-firebase-auth": `import {auth,phase,user,events} from "qa-auth";export class GoogleAuthProvider {setCustomParameters(){}addScope(){}};export const getRedirectResult=async()=>{if(new URLSearchParams(location.search).get("scenario")==="redirect-timeout"){events.push("redirect-result-pending");return new Promise(()=>{});}return null};export const signInWithPopup=async()=>{events.push("popup");const scenario=new URLSearchParams(location.search).get("scenario");if(scenario==="popup-cancel")throw Object.assign(new Error("synthetic popup cancelled"),{code:"auth/popup-closed-by-user"});phase("onboarding");return {user}};export const signInWithRedirect=async()=>{throw new Error("Unexpected redirect in localhost fixture")};export const signOut=async()=>{events.push("sdk-signout");phase("signed-out")};`,
  "qa-firestore": `import {events,profileWritten} from "qa-auth";export const doc=(db,...parts)=>({parts});export const collection=(db,...parts)=>({parts});export const query=(base,...filters)=>({...base,filters});export const where=(...parts)=>parts;export const limit=(n)=>n;export const orderBy=(...parts)=>parts;export const serverTimestamp=()=>({synthetic:true});export const getDoc=async()=>({exists:()=>false,data:()=>({})});export const getDocs=async(ref)=>{const consent=ref.parts?.includes("consent");const docs=consent?[{id:"fixture-consent",data:()=>({title:"합성 개인정보 동의",text:"로컬 QA를 위한 합성 동의 내용입니다.",required:true,order:1})}]:[];return {empty:!docs.length,docs,forEach:fn=>docs.forEach(fn)}};export const setDoc=async(ref,payload)=>{profileWritten(payload)};`,
  "qa-settings": `export const readSiteSettingDoc=async()=>null;`,
  "qa-toast": `export const useAppToast=()=>({showToast:()=>{}});export const inferToastFromAlertMessage=()=>null;`,
  "qa-header": `import React from "react";export default function Header(){return <header data-testid="protected-header">합성 포털 헤더</header>}`,
  "qa-workspace": `import React from "react";export const PortalWorkspaceFooterProvider=({children})=><>{children}</>;export const PortalFallbackFooter=()=>null;`,
  "qa-archive": `export const isSemesterArchive=false;`,
  "qa-archive-boundary": `export const SemesterArchiveBanner=()=>null;export const SemesterArchiveUnavailable=()=>null;export const isArchiveUnavailableRoute=()=>false;`,
  "qa-lazy": `import React from "react";export const lazyWithRetry=()=>()=>null;`,
  "qa-null-controller": `export default ()=>null;`,
};
const moduleFor = (request) => {
  const value = normalize(request);
  if (value in mocks) return value;
  if (value === "firebase/auth") return "qa-firebase-auth";
  if (value === "firebase/firestore") return "qa-firestore";
  if (/(?:^|\/)contexts\/AuthContext$/.test(value)) return "qa-auth";
  if (/(?:^|\/)lib\/firebase$/.test(value)) return "qa-firebase";
  if (/(?:^|\/)lib\/siteSettings$/.test(value)) return "qa-settings";
  if (/(?:^|\/)common\/AppToastProvider$/.test(value)) return "qa-toast";
  if (/(?:^|\/)common\/Header$/.test(value)) return "qa-header";
  if (/(?:^|\/)common\/PortalWorkspace$/.test(value)) return "qa-workspace";
  if (/(?:^|\/)lib\/semesterArchive$/.test(value)) return "qa-archive";
  if (/(?:^|\/)common\/SemesterArchiveBoundary$/.test(value))
    return "qa-archive-boundary";
  if (/(?:^|\/)lib\/lazyWithRetry$/.test(value)) return "qa-lazy";
  if (
    /(?:^|\/)(?:StudentHistoryDictionaryController|StudentRankPromotionController|TeacherPatchMemoController)$/.test(
      value,
    )
  )
    return "qa-null-controller";
};
const harness = `
import React from "react";
import {createRoot} from "react-dom/client";
import {HashRouter,Routes,Route} from "react-router-dom";
import Login from ${source("pages/Login.tsx")};
import MainLayout from ${source("components/layout/MainLayout.tsx")};
import {phase,timeout,forced,serverProfile,offline,events,ackProfile} from "qa-auth";
window.authQa={phase,timeout,forced,serverProfile,offline,events,ackProfile};
const scenario=new URLSearchParams(location.search).get("scenario") || "loading";
if(scenario==="redirect-timeout")localStorage.setItem("westoryRedirectAttempt",JSON.stringify({mode:"student",startedAt:Date.now()}));
if(scenario==="timeout")timeout();else if(scenario==="forced")forced();else if(scenario==="onboarding-complete")phase("ready",{userData:{uid:"synthetic-student",role:"student",privacyAgreed:true}});else if(scenario==="onboarding")phase("onboarding");else if(scenario==="signed-out" || scenario.startsWith("popup") || scenario==="redirect-timeout")phase("signed-out");else phase("opening-session");
function Protected(){return <MainLayout><section data-testid="protected-child" className="p-6"><h1 className="text-2xl font-bold">합성 학생 포털</h1><button className="mt-4 rounded-lg bg-blue-600 px-4 py-3 text-white">합성 학습 시작</button></section></MainLayout>}
createRoot(document.getElementById("root")).render(<HashRouter><Routes><Route path="/" element={<Login/>}/><Route path="/student/*" element={<Protected/>}/><Route path="/teacher/*" element={<Protected/>}/></Routes></HashRouter>);
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
      name: "synthetic-auth-services",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          const id =
            moduleFor(args.path) ||
            (args.path.startsWith(".")
              ? moduleFor(path.resolve(args.resolveDir, args.path))
              : undefined);
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
assert.equal(
  Object.keys(result.metafile.inputs).filter((file) =>
    /node_modules[\\/](?:firebase|@firebase)[\\/]/.test(file),
  ).length,
  0,
  "All Firebase runtime imports must resolve to synthetic fixture services",
);
const script = result.outputFiles[0].text;
assert.equal(
  script.includes("import.meta.env"),
  false,
  "Every Vite environment reference in the fixture must have an explicit local value",
);
const cssFiles = [
  "assets/css/style.css",
  "src/assets/index.css",
  "src/components/layout/teacherLayout.css",
  "src/components/layout/studentLayout.css",
  "src/components/public-entry/public-entry.css",
];
const css = (
  await Promise.all(
    cssFiles.map((file) => fs.readFile(path.join(root, file), "utf8")),
  )
)
  .join("\n")
  .replace(/@import[^;]+;/g, "")
  .replace(/@tailwind[^;]+;/g, "");
const html = `<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated Westory Auth UI QA</title><script src="/tailwind.js"></script><style>${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((request, response) => {
  if (serveOnly) {
    // CUA uses the local fixture without Playwright's request interception.
    // Keep remote fonts, images, fetches and preconnects out of this QA page.
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:",
    );
  }
  const target = request.url?.split("?")[0];
  if (target === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(script);
  } else if (target === "/tailwind.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(tailwind);
  } else if (target === "/" || target === "/favicon.ico") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  } else {
    response.statusCode = 404;
    response.end("Fixture resource unavailable");
  }
});
const requestedPort = Number(process.env.AUTH_BROWSER_PORT || 0);
assert.ok(
  Number.isInteger(requestedPort) &&
    requestedPort >= 0 &&
    requestedPort <= 65535,
  "AUTH_BROWSER_PORT must be an integer between 0 and 65535",
);
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(requestedPort, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const report = {
  kind: "isolated-real-browser-synthetic-auth-ui",
  limitations: [
    "Synthetic AuthContext and Firebase services; this does not verify real account login, Firebase, production latency, redirects, Safari persistence, or production access settings.",
    "The Tailwind CDN runtime is served from an existing local copy. Remote font and icon assets are blocked; screenshots use system font fallback.",
  ],
  viewports: [390, 768, 1280],
  screenshots: [],
  checks: [],
  issues: [],
  externalRequests: [],
  pageErrors: [],
  tailwindSha256: createHash("sha256").update(tailwind).digest("hex"),
};
report.sourceSha256 = Object.fromEntries(
  await Promise.all(
    [
      "src/pages/Login.tsx",
      "src/components/layout/MainLayout.tsx",
      "src/components/common/AuthRecoveryState.tsx",
      "src/components/public-entry/PublicEntry.tsx",
      "src/components/public-entry/public-entry.css",
    ].map(async (file) => [
      file,
      createHash("sha256")
        .update(await fs.readFile(path.join(root, file)))
        .digest("hex"),
    ]),
  ),
);
if (serveOnly) {
  console.log(
    JSON.stringify({
      status: "serving",
      origin,
      exampleUrl: `${origin}/?scenario=popup-cancel#/`,
      scenarios: [
        "signed-out",
        "popup-cancel",
        "redirect-timeout",
        "loading",
        "timeout",
        "forced",
        "onboarding",
        "onboarding-complete",
      ],
      sourceSha256: report.sourceSha256,
      limitations: [
        "Serve-only mode does not load Playwright or launch a browser. Inspect with CUA; no automated browser assertions have run.",
        ...report.limitations,
      ],
    }),
  );
  const closed = new Promise((resolve) => server.once("close", resolve));
  const close = () => server.close();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  await closed;
  process.exit(0);
}
let browser;
const check = (name, details = {}) => report.checks.push({ name, ...details });
const capture = async (page, label, width) => {
  await page.screenshot({
    path: path.join(evidence, `${label}-${width}.png`),
    fullPage: true,
  });
  report.screenshots.push(`${label}-${width}.png`);
};
const noProtected = async (page) => {
  assert.equal(await page.getByTestId("protected-child").count(), 0);
  assert.equal(await page.getByTestId("protected-header").count(), 0);
};
const noOverflow = async (page, label, width) => {
  const size = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(
    size.document <= size.viewport + 1,
    `${label} at ${width}px must not overflow: ${JSON.stringify(size)}`,
  );
  check("no-horizontal-overflow", { label, width, ...size });
};
const focusStyle = async (button) =>
  button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focused: element === document.activeElement,
      outline: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
      color: style.color,
      backgroundColor: style.backgroundColor,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    };
  });
const contrastRatio = (foreground, background) => {
  const luminance = (value) => {
    const channels = value
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((channel) => {
        const scaled = channel / 255;
        return scaled <= 0.04045
          ? scaled / 12.92
          : ((scaled + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const [low, high] = [luminance(foreground), luminance(background)].sort(
    (a, b) => a - b,
  );
  return (high + 0.05) / (low + 0.05);
};
const newPage = async (
  width,
  scenario,
  route = "/",
  touch = false,
  variant = "public",
) => {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    hasTouch: touch,
  });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(origin)) return route.continue();
    report.externalRequests.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  await page.goto(
    `${origin}/?scenario=${scenario}${variant === "classic" ? "&entry=classic" : ""}#${route}`,
  );
  await page.waitForTimeout(150);
  return page;
};
try {
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  report.browser = browser.version();
  for (const width of report.viewports) {
    const loading = await newPage(width, "loading");
    await loading.getByRole("status").waitFor();
    await noProtected(loading);
    await noOverflow(loading, "login-loading", width);
    await capture(loading, "login-loading", width);
    await loading.close();
    const loginError = await newPage(width, "timeout");
    await loginError.getByRole("alert").waitFor();
    await noProtected(loginError);
    await noOverflow(loginError, "login-timeout", width);
    await capture(loginError, "login-timeout", width);
    await loginError
      .getByRole("button", { name: "다시 확인", exact: true })
      .click();
    await loginError.getByRole("status").waitFor();
    await noProtected(loginError);
    check("public-login-error-retry-returns-to-loading", { width });
    await loginError.close();
    const page = await newPage(
      width,
      "timeout",
      "/student/dashboard",
      width === 390,
    );
    await page.getByRole("alert").waitFor();
    await noProtected(page);
    await noOverflow(page, "timeout", width);
    await capture(page, "timeout", width);
    const retry = page.getByRole("button", { name: "다시 확인", exact: true });
    await page.keyboard.press("Tab");
    const focus = await focusStyle(retry);
    assert.equal(focus.focused, true);
    assert.ok(
      focus.boxShadow !== "none" ||
        (focus.outline !== "none" && parseFloat(focus.outlineWidth) > 0),
      "Keyboard focus must be visible",
    );
    assert.ok(focus.width >= 44 && focus.height >= 44);
    const contrast = contrastRatio(focus.color, focus.backgroundColor);
    assert.ok(
      contrast >= 4.5,
      "Recovery action text must have WCAG AA contrast",
    );
    check("recovery-action-text-contrast", { width, ratio: contrast });
    check("keyboard-recovery-focus-and-target", {
      viewportWidth: width,
      ...focus,
    });
    await capture(page, "timeout-keyboard-focus", width);
    if (width === 390) await retry.tap();
    else await page.keyboard.press("Enter");
    await page.getByRole("status").waitFor();
    await noProtected(page);
    await capture(page, "retry-loading", width);
    check(width === 390 ? "touch-retry-started" : "keyboard-retry-started", {
      width,
    });
    await page.evaluate(() => window.authQa.phase("loading-profile"));
    await noProtected(page);
    await page.evaluate(() => window.authQa.serverProfile());
    await page.getByTestId("protected-child").waitFor();
    await page.getByTestId("protected-header").waitFor();
    await noOverflow(page, "ready", width);
    await capture(page, "verified-ready", width);
    check("protected-content-after-synthetic-server-profile-only", { width });
    await page.evaluate(() => window.authQa.timeout());
    await page.getByRole("alert").waitFor();
    await noProtected(page);
    await page.getByRole("button", { name: "다시 확인", exact: true }).click();
    await page.getByRole("status").waitFor();
    await page.evaluate(() => window.authQa.offline());
    await page.getByRole("alert").waitFor();
    await noProtected(page);
    await capture(page, "retry-offline-failure", width);
    check("failed-retry-stays-closed-and-recovers", { width });
    await page
      .getByRole("button", { name: "다시 로그인", exact: true })
      .click();
    await page.waitForURL(/#\/$/);
    await page.locator(".public-entry").waitFor();
    await noProtected(page);
    check("restart-logs-out-and-opens-login", { width });
    await capture(page, "restart-signed-out", width);
    await page.close();
    const forcedPage = await newPage(width, "forced", "/student/dashboard");
    await forcedPage.getByRole("alert").waitFor();
    assert.equal(
      await forcedPage
        .getByRole("button", { name: "다시 확인", exact: true })
        .count(),
      0,
    );
    await noProtected(forcedPage);
    await noOverflow(forcedPage, "forced-reauth", width);
    await capture(forcedPage, "forced-reauth", width);
    check("forced-reauth-only-offers-login", { width });
    await forcedPage.close();
    const onboard = await newPage(width, "onboarding", "/", width === 390);
    await onboard
      .getByRole("button", { name: "입력 완료", exact: true })
      .waitFor();
    await noProtected(onboard);
    await noOverflow(onboard, "onboarding", width);
    await capture(onboard, "onboarding", width);
    const dialog = onboard.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(
      await dialog.count(),
      1,
      "Exactly one accessible dialog must be exposed",
    );
    assert.equal(await dialog.getAttribute("aria-modal"), "true");
    assert.equal(
      await onboard
        .locator(".public-entry")
        .evaluate((element) => element.hasAttribute("inert")),
      true,
    );
    assert.equal(
      await onboard.evaluate(() => document.body.style.overflow),
      "hidden",
    );
    await onboard
      .getByRole("textbox", { name: "이름", exact: true })
      .evaluate((element) =>
        element.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            isComposing: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    await dialog.waitFor();
    check("public-modal-inert-scroll-lock-and-composing-escape-safe", {
      width,
    });
    const modalFocus = await onboard.evaluate(() => {
      const overlay = document.querySelector("[data-auth-dialog]");
      return {
        insideModal: Boolean(overlay?.contains(document.activeElement)),
        tag: document.activeElement?.tagName,
        dialogRole: overlay?.getAttribute("role") === "dialog",
      };
    });
    check("onboarding-modal-keyboard-entry", { width, ...modalFocus });
    assert.equal(
      modalFocus.insideModal,
      true,
      "Initial focus must enter onboarding dialog",
    );
    assert.equal(modalFocus.dialogRole, true);
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let i = 0; i < 12; i++) {
        await onboard.keyboard.press(key);
        assert.equal(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
          true,
          "Onboarding keyboard focus must stay in dialog",
        );
      }
    }
    check("onboarding-tab-and-shift-tab-trap", { width });
    const cancel = onboard.getByRole("button", { name: "취소", exact: true });
    const cancelSize = await cancel.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }));
    check("onboarding-cancel-touch-target", {
      viewportWidth: width,
      ...cancelSize,
    });
    if (cancelSize.width < 44 || cancelSize.height < 44)
      report.issues.push({
        viewportWidth: width,
        issue: "Onboarding cancel target is below 44 CSS px.",
        ...cancelSize,
      });
    if (width === 390) await cancel.tap();
    else if (width === 768) await onboard.keyboard.press("Escape");
    else {
      await cancel.focus();
      await onboard.keyboard.press("Enter");
    }
    await onboard
      .getByRole("button", { name: "입력 완료", exact: true })
      .waitFor({ state: "hidden" });
    await noProtected(onboard);
    assert.ok(
      (await onboard.evaluate(() => window.authQa.events)).some(
        (event) => event === "logout" || event === "sdk-signout",
      ),
    );
    check(
      width === 390
        ? "touch-onboarding-cancel-signs-out"
        : width === 768
          ? "escape-onboarding-cancel-signs-out"
          : "keyboard-onboarding-cancel-signs-out",
      { width },
    );
    await capture(onboard, "onboarding-cancel", width);
    await onboard.close();
    const complete = await newPage(width, "onboarding-complete");
    await complete
      .getByRole("button", { name: "입력 완료", exact: true })
      .waitFor();
    await complete.getByRole("combobox").nth(0).focus();
    await complete.keyboard.press("Home");
    await complete.keyboard.press("Tab");
    await complete.keyboard.press("ArrowDown");
    await complete.keyboard.press("Tab");
    await complete.keyboard.press("ArrowDown");
    await complete.keyboard.press("Tab");
    await complete.keyboard.insertText("가나다");
    await complete.keyboard.press("Tab");
    await complete.keyboard.press("Tab");
    assert.equal(
      await complete
        .getByRole("button", { name: "입력 완료", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await complete.keyboard.press("Enter");
    await complete.waitForFunction(() =>
      window.authQa.events.includes("synthetic-write"),
    );
    await noProtected(complete);
    await complete.evaluate(() => window.authQa.ackProfile());
    await complete.getByTestId("protected-child").waitFor();
    const onboardingEvents = await complete.evaluate(
      () => window.authQa.events,
    );
    assert.ok(
      onboardingEvents.includes("server-profile-ack") &&
        onboardingEvents.includes("profile-ack-accepted"),
    );
    assert.ok(
      onboardingEvents.indexOf("synthetic-write") <
        onboardingEvents.indexOf("server-profile-ack"),
    );
    check("keyboard-onboarding-completes-after-server-profile-ack", {
      width,
      events: onboardingEvents,
    });
    await capture(complete, "onboarding-completed", width);
    await complete.close();
    const popup = await newPage(width, "popup-cancel");
    await popup
      .getByRole("button", { name: /학생 로그인/ })
      .first()
      .click();
    await popup.locator(".public-entry").waitFor();
    await popup.waitForFunction(() =>
      window.authQa.events.includes("login-flow-failed"),
    );
    assert.equal(await popup.getByRole("status").count(), 0);
    assert.equal(
      await popup
        .getByRole("button", { name: /학생 로그인/ })
        .first()
        .isEnabled(),
      true,
    );
    await noProtected(popup);
    check("popup-cancel-exits-spinner-and-restores-login-action", { width });
    await capture(popup, "popup-cancel", width);
    await popup.close();
  }
  for (const width of [320, 390, 768, 1280]) {
    const entry = await newPage(width, "signed-out");
    await entry.locator(".public-entry").waitFor();
    await entry.locator(".entry-hero-screen img").waitFor();
    await entry.waitForFunction(() => {
      const image = document.querySelector(".entry-hero-screen img");
      return image?.complete && image.naturalWidth > 0;
    });
    assert.equal(
      await entry
        .locator(".entry-header")
        .evaluate((element) => getComputedStyle(element).display),
      "flex",
      "Actual PublicEntry CSS must be applied",
    );
    await noOverflow(entry, "actual-public-entry", width);
    const height = await entry.evaluate(
      () => document.documentElement.scrollHeight,
    );
    for (let y = 0; y < height; y += 850) {
      await entry.evaluate((position) => window.scrollTo(0, position), y);
      await entry.waitForTimeout(30);
    }
    await entry.evaluate(() => window.scrollTo(0, 0));
    await capture(entry, "actual-public-entry", width);
    check("public-local-screen-assets-loaded", {
      width,
      heroNaturalWidth: await entry
        .locator(".entry-hero-screen img")
        .evaluate((image) => image.naturalWidth),
    });
    await entry.close();
  }
  for (const width of [390, 768, 1280]) {
    const classic = await newPage(
      width,
      "onboarding",
      "/",
      width === 390,
      "classic",
    );
    const dialog = classic.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(await dialog.count(), 1);
    assert.equal(await classic.locator(".public-entry").count(), 0);
    assert.equal(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
      true,
    );
    await classic
      .getByRole("textbox", { name: "이름", exact: true })
      .evaluate((element) =>
        element.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            isComposing: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    await dialog.waitFor();
    for (let i = 0; i < 10; i++) {
      await classic.keyboard.press("Tab");
      assert.equal(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
        true,
      );
    }
    await noProtected(classic);
    await noOverflow(classic, "classic-onboarding", width);
    await capture(classic, "classic-onboarding", width);
    await classic.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await noProtected(classic);
    await classic
      .getByRole("heading", { name: "Westory", exact: true })
      .waitFor();
    check("classic-modal-focus-ime-tab-escape-and-signout", { width });
    await classic.close();
    const fallback = await newPage(
      width,
      "popup-cancel",
      "/",
      false,
      "classic",
    );
    await fallback
      .getByRole("button", { name: /학생 로그인/ })
      .first()
      .click();
    await fallback.waitForFunction(() =>
      window.authQa.events.includes("login-flow-failed"),
    );
    assert.equal(
      await fallback
        .getByRole("button", { name: /학생 로그인/ })
        .first()
        .isEnabled(),
      true,
    );
    await noProtected(fallback);
    await capture(fallback, "classic-popup-cancel", width);
    check("classic-login-cancel-recovery", { width });
    await fallback.close();
  }
  const redirectPage = await newPage(390, "redirect-timeout");
  const redirectStarted = Date.now();
  await redirectPage.waitForFunction(() =>
    window.authQa.events.includes("redirect-result-pending"),
  );
  await noProtected(redirectPage);
  await capture(redirectPage, "redirect-pending", 390);
  await redirectPage
    .getByText(/auth\/startup-timeout/)
    .waitFor({ timeout: 20000 });
  await redirectPage
    .getByRole("button", { name: /학생 로그인/ })
    .first()
    .waitFor();
  assert.equal(
    await redirectPage
      .getByRole("button", { name: /학생 로그인/ })
      .first()
      .isEnabled(),
    true,
  );
  assert.equal(await redirectPage.getByRole("status").count(), 0);
  await noProtected(redirectPage);
  check("redirect-acquisition-real-15-second-deadline-restores-actions", {
    width: 390,
    elapsedMs: Date.now() - redirectStarted,
    synthetic: true,
  });
  await capture(redirectPage, "redirect-timeout", 390);
  await redirectPage.close();
  assert.equal(
    report.pageErrors.length,
    0,
    "UI fixture must have no runtime errors",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = error.message;
  const pages = browser?.contexts().flatMap((context) => context.pages()) || [];
  if (pages.length)
    await capture(pages.at(-1), "failure", pages.at(-1).viewportSize().width);
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
      limitations: report.limitations,
    }),
  );
}
