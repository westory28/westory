/**
 * Real AuthContext, MainLayout, menu policy and loading layer with synthetic
 * Firebase replies. No production account, data or network is used.
 * Header, shell tools and page bodies are mount probes. Settings reads stay
 * pending until the test answers them, which proves what is on screen while the
 * server check of a student page is still running:
 * - the shell an account already sees stays mounted, only the page is gated;
 * - a tab change inside a verified page keeps that page, except when the
 *   settings already held or the server answer close it;
 * - a path change, a first entry and a failed check never show the page early;
 * - settings listeners are attached once and equal snapshots change nothing.
 */
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
const imp = (name) =>
  JSON.stringify(path.join(root, name).replaceAll("\\", "/"));
const evidence =
  process.env.LAYOUT_NAVIGATION_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-layout-navigation-")));
await fs.mkdir(evidence, { recursive: true });

const policyBundle = await build({
  stdin: {
    contents: `export * from ${imp("src/constants/menus.ts")};`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const policy = await import(
  `data:text/javascript;base64,${Buffer.from(policyBundle.outputFiles[0].text).toString("base64")}`
);
const system = {
  year: "2026",
  semester: "2",
  showLesson: true,
  showQuiz: true,
  showScore: true,
};
const defaults = () => policy.cloneDefaultMenus();
const hiddenChild = (url) => {
  const menus = defaults();
  for (const item of menus.student)
    for (const child of item.children || [])
      if (child.url === url) child.hidden = true;
  return menus;
};
const hiddenParent = (url) => {
  const menus = defaults();
  for (const item of menus.student) if (item.url === url) item.hidden = true;
  return menus;
};

const service = `
import React from 'react';
import {cloneDefaultMenus} from ${imp("src/constants/menus.ts")};
const listeners=new Map(); const pending=new Map();
const fixtureUser={uid:'layout-fixture',email:'fixture@example.invalid'};
export const auth={currentUser:fixtureUser}; export const db={}; export const authPersistenceReady=Promise.resolve();
const values={config:${JSON.stringify(system)},menu_config:cloneDefaultMenus(),interface_config:{dashboard:{notice:true,calendar:true,ranking:true}}};
const copy=value=>value===null?null:JSON.parse(JSON.stringify(value));
window.layoutQa={mounts:[],toasts:[],reads:[],subscriptions:{},header:{mounts:0,unmounts:0},launcher:{mounts:0,unmounts:0},promotion:{mounts:0,unmounts:0},
  bodySeq:0,bodyUnmounts:[],effects:{config:0,menuConfig:0,interfaceConfig:0},
  pendingCount(id){return (pending.get(id)||[]).length;},
  resolve(id,data){if(data!==undefined)values[id]=data;const requests=pending.get(id)||[];pending.delete(id);requests.forEach(x=>x.resolve(copy(values[id])));},
  reject(id){const requests=pending.get(id)||[];pending.delete(id);requests.forEach(x=>x.reject(Error('synthetic settings failure')));},
  resolveAll(){for(const id of ['config','menu_config','interface_config'])this.resolve(id);},
  update(id,data,{fromCache=false,hasPendingWrites=false}={}){if(data!==undefined)values[id]=data;const next=copy(values[id]);for(const listener of listeners.get('site_settings/'+id)||[])listener.next({exists:()=>next!==null,data:()=>next,metadata:{fromCache,hasPendingWrites}});},
  failListener(id){const active=listeners.get('site_settings/'+id);for(const listener of [...(active||[])])listener.error(Error('synthetic terminal listener failure'));active?.clear();},
  listenerCount(id){return listeners.get('site_settings/'+id)?.size||0;},
};
export const readFreshSiteSettingDoc=id=>{window.layoutQa.reads.push(id);return new Promise((resolve,reject)=>{if(!pending.has(id))pending.set(id,[]);pending.get(id).push({resolve,reject});});};
export const readSiteSettingDoc=readFreshSiteSettingDoc;
export const invalidateSiteSettingDocCache=()=>{};
export const doc=(_, ...parts)=>({path:parts.join('/')});
export const onSnapshot=(ref,options,next,error)=>{const qa=window.layoutQa;qa.subscriptions[ref.path]=(qa.subscriptions[ref.path]||0)+1;const listener={next,error};if(!listeners.has(ref.path))listeners.set(ref.path,new Set());listeners.get(ref.path).add(listener);return()=>listeners.get(ref.path)?.delete(listener);};
export const onIdTokenChanged=(_,next)=>{queueMicrotask(()=>next(fixtureUser));return()=>{};};export const signOut=async()=>{};
export class AuthStartupController{constructor(deps){this.deps=deps;}observe(user){this.deps.change({phase:'ready',generation:1,currentUser:user,onboardingUser:null,userData:{uid:user.uid,role:location.hash.startsWith('#/teacher')?'teacher':'student',name:'검증학생'},error:null});this.deps.sessionReady(user,1);}dispose(){} }
export const invalidateApplicationSession=()=>{},prepareApplicationSession=async()=>{},clearDeviceSession=()=>{},setAuthDeadline=setTimeout,clearAuthDeadline=clearTimeout;
export const invalidateWrittenExamAnalysisCache=()=>{};
export const subscribeMenuConfigUpdated=()=>()=>{},subscribeSystemConfigUpdated=()=>()=>{};
export const archiveScope=null,isSemesterArchive=false;
export const markLoginPerf=()=>{},measureLoginPerf=()=>{};
const toast={showToast(value){window.layoutQa.toasts.push(value);}};export const useAppToast=()=>toast;
`;
const header = `import React from 'react';export default function Header(){React.useEffect(()=>{const qa=window.layoutQa;qa.header.mounts++;return()=>{qa.header.unmounts++;};},[]);return <nav data-testid="portal-header">shell</nav>;}`;
const tool = (name) =>
  `import React from 'react';export default function Tool(){React.useEffect(()=>{const probe=window.layoutQa.${name};probe.mounts++;return()=>{probe.unmounts++;};},[]);return <i data-testid="shell-tool" data-tool="${name}"/>;}`;
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter,useLocation} from 'react-router-dom';
import {AuthProvider,useAuth} from ${imp("src/contexts/AuthContext.tsx")};
import MainLayout from ${imp("src/components/layout/MainLayout.tsx")};
function Body(){const location=useLocation();const {config,menuConfig,interfaceConfig}=useAuth();const marker=location.pathname+location.search;const instance=React.useRef(0);if(!instance.current)instance.current=++window.layoutQa.bodySeq;
  React.useLayoutEffect(()=>{window.layoutQa.mounts.push(marker)},[marker]);
  React.useEffect(()=>{const id=instance.current;return()=>{window.layoutQa.bodyUnmounts.push(id)}},[]);
  React.useEffect(()=>{window.layoutQa.effects.config++},[config]);
  React.useEffect(()=>{window.layoutQa.effects.menuConfig++},[menuConfig]);
  React.useEffect(()=>{window.layoutQa.effects.interfaceConfig++},[interfaceConfig]);
  return <div data-testid="body" data-route={marker} data-instance={instance.current}><h1>{marker}</h1></div>}
// Like the router, a different path is a different page; a query is not.
function Page(){const location=useLocation();return <Body key={location.pathname}/>}
function App(){return <AuthProvider><HashRouter><MainLayout><Page/></MainLayout></HashRouter></AuthProvider>};
createRoot(document.getElementById('root')).render(<App/>);
`;
const output = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  loader: { ".svg": "dataurl", ".webp": "dataurl", ".woff2": "dataurl" },
  external: ["/assets/*"],
  target: "es2022",
  outfile: path.join(evidence, "fixture.js"),
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "synthetic-services",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^firebase\/(auth|firestore)$|(?:^|\/)lib\/(firebase|applicationSession|deviceSession|authDeadline|authStartup|siteSettings|appEvents|semesterArchive|loginPerf|writtenExamAnalysisCache)$|^\.\/AppToastProvider$|(?:^|\/)common\/AppToastProvider$/,
          },
          () => ({ path: "services", namespace: "fixture" }),
        );
        plugin.onResolve({ filter: /(?:^|\/)Header$/ }, () => ({
          path: "header",
          namespace: "fixture",
        }));
        plugin.onResolve(
          { filter: /StudentHistoryDictionaryController$/ },
          () => ({ path: "launcher", namespace: "fixture" }),
        );
        plugin.onResolve({ filter: /StudentRankPromotionController$/ }, () => ({
          path: "promotion",
          namespace: "fixture",
        }));
        plugin.onResolve(
          { filter: /(?:TeacherPatchMemoController|AuthRecoveryState)$/ },
          () => ({ path: "empty", namespace: "fixture" }),
        );
        plugin.onResolve({ filter: /SemesterArchiveBoundary$/ }, () => ({
          path: "archive",
          namespace: "fixture",
        }));
        plugin.onResolve({ filter: /PortalWorkspace$/ }, () => ({
          path: "workspace",
          namespace: "fixture",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "tsx",
          resolveDir: root,
          contents:
            args.path === "services"
              ? service
              : args.path === "header"
                ? header
                : args.path === "launcher" || args.path === "promotion"
                  ? tool(args.path)
                  : args.path === "archive"
                    ? "export const SemesterArchiveBanner=()=>null,SemesterArchiveUnavailable=()=>null,isArchiveUnavailableRoute=()=>false"
                    : args.path === "workspace"
                      ? "export const PortalWorkspaceFooterProvider=({children})=>children;export const PortalFallbackFooter=()=>null;"
                      : "export default function Empty(){return null}",
        }));
      },
    },
  ],
});
const js = output.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css =
  output.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const files = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
  };
  if (pathname.startsWith("/assets/")) {
    response.writeHead(404);
    response.end();
    return;
  }
  const [type, data] = files[pathname] || ["text/html", html];
  response.setHeader("Content-Type", type + ";charset=utf-8");
  response.end(data);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
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
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});

let assertions = 0;
const check = (condition, message) => {
  assert(condition, message);
  assertions++;
};
const checks = [];
const errors = [];
let visit = 0;
const SCREEN_LOADER = 'dialog[data-loading-scope="screen"]';

try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    page.on("pageerror", (error) => errors.push(error.message));
    // The layout trusts settings for five seconds. Move the clock instead of
    // waiting, so every navigation below starts with settings that are older.
    await page.addInitScript(() => {
      const real = Date.now.bind(Date);
      let offset = 0;
      Date.now = () => real() + offset;
      window.advanceClock = (ms) => {
        offset += ms;
      };
    });
    const qa = (fn, arg) => page.evaluate(fn, arg);
    const state = () =>
      qa(() => {
        const body = document.querySelector('[data-testid="body"]');
        return {
          hash: location.hash,
          header: document.querySelectorAll('[data-testid="portal-header"]')
            .length,
          tools: document.querySelectorAll('[data-testid="shell-tool"]').length,
          body: body ? body.getAttribute("data-route") : null,
          instance: body ? Number(body.getAttribute("data-instance")) : 0,
          loader: Boolean(
            document.querySelector('dialog[data-loading-scope="screen"]'),
          ),
          alert: Boolean(document.querySelector('[role="alert"]')),
          reads: window.layoutQa.reads.slice(),
          pending: {
            config: window.layoutQa.pendingCount("config"),
            menu: window.layoutQa.pendingCount("menu_config"),
          },
          mounts: window.layoutQa.mounts.slice(),
          header_: { ...window.layoutQa.header },
          launcher: { ...window.layoutQa.launcher },
          promotion: { ...window.layoutQa.promotion },
          effects: { ...window.layoutQa.effects },
          subscriptions: { ...window.layoutQa.subscriptions },
          toasts: window.layoutQa.toasts.length,
        };
      });
    const open = async (route) => {
      await page.goto(`${origin}/?case=${++visit}#${route}`);
      await page.waitForFunction(() =>
        window.layoutQa?.reads.includes("menu_config"),
      );
    };
    const settle = () => qa(() => window.layoutQa.resolveAll());
    const body = (route) =>
      page.locator(`[data-testid="body"][data-route="${route}"]`);
    // Navigate with settings older than the freshness window and wait until the
    // layout has asked the server again.
    const go = async (route) => {
      const before = (await state()).reads.length;
      await qa((target) => {
        window.advanceClock(6000);
        window.location.hash = `#${target}`;
      }, route);
      await page.waitForFunction(
        (count) =>
          window.layoutQa.reads.length >= count + 2 &&
          window.layoutQa.pendingCount("config") > 0 &&
          window.layoutQa.pendingCount("menu_config") > 0,
        before,
      );
      return before;
    };

    // 1. First entry: nothing protected mounts before the server settings.
    await open("/student/mypage");
    let now = await state();
    check(now.header === 0 && now.body === null, "first entry shows no shell");
    check(now.mounts.length === 0, "first entry mounts no page");
    await settle();
    await body("/student/mypage").waitFor();
    now = await state();
    check(now.header_.mounts === 1, "shell mounts once");
    await page.waitForFunction(
      () =>
        window.layoutQa.launcher.mounts === 1 &&
        window.layoutQa.promotion.mounts === 1,
    );
    check(
      now.subscriptions["site_settings/config"] === 1 &&
        now.subscriptions["site_settings/menu_config"] === 1 &&
        now.subscriptions["site_settings/interface_config"] === 1,
      "each settings listener attaches once",
    );
    checks.push(`${width}: first entry waits for the server settings`);

    // 2. Path change: the shell stays, the next page waits for the re-check.
    let readsBefore = await go("/student/quiz");
    now = await state();
    check(now.loader, "path change shows the screen loader");
    check(now.body === null, "next page is not mounted during the re-check");
    check(
      !now.mounts.includes("/student/quiz"),
      "next page never mounted before the server answered",
    );
    check(now.header === 1, "shell stays in the document");
    check(
      now.header_.mounts === 1 && now.header_.unmounts === 0,
      "shell is not remounted for a page change",
    );
    check(
      now.tools === 2 &&
        now.launcher.unmounts === 0 &&
        now.promotion.unmounts === 0,
      "shell tools stay mounted during the re-check",
    );
    await settle();
    await body("/student/quiz").waitFor();
    now = await state();
    check(!now.loader, "loader leaves after the re-check");
    check(
      now.reads.length === readsBefore + 2,
      "one config and one menu read per page change",
    );
    check(
      now.header_.mounts === 1 && now.launcher.mounts === 1,
      "shell and learning tools were kept across the page change",
    );
    await page.waitForFunction(() => window.layoutQa.promotion.mounts === 2);
    check(
      (await state()).promotion.unmounts === 1,
      "the rank promotion check starts again for the opened page",
    );
    check(
      now.subscriptions["site_settings/config"] === 1 &&
        now.subscriptions["site_settings/menu_config"] === 1 &&
        now.subscriptions["site_settings/interface_config"] === 1,
      "a re-check does not attach the settings listeners again",
    );
    checks.push(`${width}: page change keeps the shell and gates the page`);

    // 3. The two answers arrive apart: still exactly one re-check.
    readsBefore = await go("/student/score");
    await qa(() => window.layoutQa.resolve("config"));
    await page.waitForTimeout(120);
    now = await state();
    check(now.body === null, "one of two answers does not open the page");
    check(
      now.reads.length === readsBefore + 2,
      "the first answer does not start a second re-check",
    );
    await qa(() => window.layoutQa.resolve("menu_config"));
    await body("/student/score").waitFor();
    readsBefore = await go("/student/history");
    await qa(() => window.layoutQa.resolve("config"));
    await page.waitForTimeout(120);
    now = await state();
    check(
      now.reads.length === readsBefore + 2,
      "answers arriving apart never repeat the settings reads",
    );
    await qa(() => window.layoutQa.resolve("menu_config"));
    await body("/student/history").waitFor();
    check((await state()).reads.length === readsBefore + 2, "single re-check");
    checks.push(`${width}: one settings re-check per visit`);

    // 4. Equal snapshots are not a settings change for the page.
    const effectsBefore = (await state()).effects;
    await qa(() => {
      window.layoutQa.update("config");
      window.layoutQa.update("menu_config");
      window.layoutQa.update("interface_config");
    });
    await page.waitForTimeout(80);
    now = await state();
    check(
      now.effects.config === effectsBefore.config &&
        now.effects.menuConfig === effectsBefore.menuConfig &&
        now.effects.interfaceConfig === effectsBefore.interfaceConfig,
      "an identical server snapshot keeps the settings objects",
    );
    await qa((next) => window.layoutQa.update("interface_config", next), {
      dashboard: { notice: false, calendar: true, ranking: true },
    });
    await page.waitForFunction(
      (count) => window.layoutQa.effects.interfaceConfig === count + 1,
      effectsBefore.interfaceConfig,
    );
    now = await state();
    check(
      now.effects.config === effectsBefore.config &&
        now.effects.menuConfig === effectsBefore.menuConfig,
      "a change in one settings document updates only that one",
    );
    checks.push(`${width}: equal snapshots keep settings identity`);

    // 5. Tab change inside a verified page: the page stays while re-checked.
    await go("/student/mypage");
    await settle();
    await body("/student/mypage").waitFor();
    const instance = (await state()).instance;
    const effectsOnPage = (await state()).effects;
    readsBefore = await go("/student/mypage?menu=score");
    now = await state();
    check(!now.loader, "tab change does not cover the page");
    check(
      now.body === "/student/mypage?menu=score" && now.instance === instance,
      "tab change keeps the same page instance",
    );
    check(now.pending.config === 1, "tab change still asks the server");
    await settle();
    await page.waitForTimeout(80);
    now = await state();
    check(
      now.body === "/student/mypage?menu=score" && now.instance === instance,
      "page stays after the server confirmed the tab",
    );
    check(now.reads.length === readsBefore + 2, "one re-check per tab change");
    check(
      now.effects.config === effectsOnPage.config &&
        now.effects.menuConfig === effectsOnPage.menuConfig,
      "an unchanged re-check answer does not reload the page data",
    );
    check(now.header_.mounts === 1, "shell kept through tab changes");
    check(
      now.launcher.mounts === 1 && now.launcher.unmounts === 0,
      "learning tools kept through every page and tab change",
    );
    check(
      now.promotion.mounts === now.promotion.unmounts + 1 &&
        now.promotion.mounts >= 6,
      "the rank promotion check ran once per opened page or tab",
    );
    checks.push(`${width}: tab change keeps the verified page`);

    // 6. The server answer closes a tab that the held settings allowed.
    await go("/student/mypage?menu=avatar");
    now = await state();
    check(
      now.body === "/student/mypage?menu=avatar" && now.instance === instance,
      "tab allowed by the held settings is shown during its re-check",
    );
    const toastsBefore = now.toasts;
    await qa(
      (menus) => window.layoutQa.resolve("menu_config", menus),
      hiddenChild("/student/mypage?menu=avatar"),
    );
    await settle();
    await page.waitForURL(/#\/student\/dashboard$/);
    await body("/student/dashboard").waitFor();
    now = await state();
    check(now.toasts === toastsBefore + 1, "closed tab explains the redirect");
    checks.push(`${width}: server answer closes a tab opened in place`);

    // 7. Held settings already hide the tab: it never mounts, not even once.
    await go("/student/mypage");
    await settle();
    await body("/student/mypage").waitFor();
    let mountsBefore = (await state()).mounts.length;
    await go("/student/mypage?menu=avatar");
    now = await state();
    check(now.body === null && now.loader, "hidden tab keeps the full gate");
    await settle();
    await page.waitForURL(/#\/student\/dashboard$/);
    await body("/student/dashboard").waitFor();
    now = await state();
    check(
      !now.mounts.slice(mountsBefore).includes("/student/mypage?menu=avatar"),
      "a tab hidden in the held settings is never rendered",
    );
    checks.push(`${width}: hidden tab never renders in place`);

    // 8. A live change closes a tab that is already open.
    await qa(
      (menus) => window.layoutQa.update("menu_config", menus),
      defaults(),
    );
    await go("/student/mypage");
    await settle();
    await body("/student/mypage").waitFor();
    await go("/student/mypage?menu=avatar");
    await settle();
    await body("/student/mypage?menu=avatar").waitFor();
    await qa(
      (menus) => window.layoutQa.update("menu_config", menus),
      hiddenParent("/student/mypage"),
    );
    await page.waitForURL(/#\/student\/dashboard$/);
    await qa(
      (menus) => window.layoutQa.update("menu_config", menus),
      defaults(),
    );
    checks.push(`${width}: live hiding still closes an open tab`);

    // 9. A failed re-check closes the page that was kept; retry reopens it.
    await go("/student/points");
    await settle();
    await body("/student/points").waitFor();
    await go("/student/points?tab=shop");
    check(
      (await state()).body === "/student/points?tab=shop",
      "shop tab opens in place",
    );
    await qa(() => {
      window.layoutQa.reject("config");
      window.layoutQa.resolve("menu_config");
    });
    await page.getByRole("alert").waitFor();
    now = await state();
    check(
      now.body === null && now.header === 0,
      "failed re-check closes page and shell",
    );
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    await settle();
    await body("/student/points?tab=shop").waitFor();
    checks.push(`${width}: failed re-check stays closed until retry`);

    // 10. Pages outside the in-place list keep the full gate for a query.
    await go("/student/lesson/note");
    await settle();
    await body("/student/lesson/note").waitFor();
    const noteInstance = (await state()).instance;
    await go("/student/lesson/note?id=unit-a&title=fixture");
    now = await state();
    check(now.body === null && now.loader, "lesson selection is gated");
    await settle();
    await body("/student/lesson/note?id=unit-a&title=fixture").waitFor();
    check(
      (await state()).instance !== noteInstance,
      "lesson selection still starts a fresh page",
    );
    checks.push(`${width}: other pages keep the full gate on query changes`);

    // 11. A path change never reuses the previous page, even to a listed page.
    await go("/student/points");
    now = await state();
    check(now.body === null, "entering a listed page is still gated");
    await settle();
    await body("/student/points").waitFor();
    checks.push(`${width}: listed pages are gated on entry`);

    // 12. Leaving while a re-check is pending must not strand the next page.
    await qa(() => window.layoutQa.resolveAll());
    await qa(() => {
      window.location.hash = "#/student/dashboard";
    });
    await body("/student/dashboard").waitFor();
    await go("/student/quiz");
    check((await state()).loader, "quiz waits for its re-check");
    await qa(() => {
      window.location.hash = "#/student/dashboard";
    });
    await body("/student/dashboard").waitFor();
    now = await state();
    check(
      !now.loader && now.body === "/student/dashboard",
      "a page that needs no check opens while the old check is pending",
    );
    await settle();
    await page.waitForTimeout(80);
    now = await state();
    check(
      now.body === "/student/dashboard" && !now.loader,
      "a late answer for the abandoned page changes nothing",
    );
    check(
      !now.mounts.includes("/student/quiz") ||
        now.mounts.lastIndexOf("/student/quiz") <
          now.mounts.lastIndexOf("/student/dashboard"),
      "the abandoned page did not mount after leaving it",
    );
    checks.push(`${width}: an abandoned re-check does not block the next page`);

    // 13. A terminal listener error closes the page; retry attaches new ones.
    now = await state();
    check(
      now.subscriptions["site_settings/config"] === 1,
      "listeners were attached once for the whole visit",
    );
    await qa(() => window.layoutQa.failListener("config"));
    await page.getByRole("alert").waitFor();
    check((await state()).body === null, "listener error closes the page");
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    await settle();
    await body("/student/dashboard").waitFor();
    now = await state();
    check(
      now.subscriptions["site_settings/config"] === 2 &&
        (await qa(() => window.layoutQa.listenerCount("config"))) === 1,
      "retry renews the ended listener exactly once",
    );
    await qa(
      (menus) => window.layoutQa.update("menu_config", menus),
      hiddenParent("/student/quiz"),
    );
    await go("/student/quiz");
    await settle();
    await page.waitForURL(/#\/student\/dashboard$/);
    check(
      !(await state()).mounts.slice(-3).includes("/student/quiz"),
      "renewed listeners keep hidden pages closed",
    );
    checks.push(`${width}: listener failure closes and retry renews once`);

    // 14. Teacher pages are not behind the student settings.
    await open("/teacher/dashboard");
    await settle();
    await body("/teacher/dashboard").waitFor();
    const teacherReads = (await state()).reads.length;
    await qa(() => {
      window.advanceClock(6000);
      window.location.hash = "#/teacher/lesson";
    });
    await body("/teacher/lesson").waitFor();
    now = await state();
    check(
      now.reads.length === teacherReads && !now.loader,
      "teacher navigation asks for no student visibility check",
    );
    check(now.header_.mounts === 1, "teacher shell stays mounted");
    checks.push(`${width}: teacher navigation is unchanged`);
    await page.close();
  }
  check(errors.length === 0, `browser errors: ${errors.join("; ")}`);
  await fs.writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify({ assertions, checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ assertions, checks, evidence }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
