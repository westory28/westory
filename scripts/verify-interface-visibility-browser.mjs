/**
 * Real AuthContext, MainLayout, menu policy, Weplay controller and catalogue
 * with synthetic Firebase responses. No production accounts or writes are used.
 * Header, generic page bodies and game scenes are mount probes; portal-design
 * covers the actual Header. Delayed replies prove hidden content never mounts.
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
  process.env.INTERFACE_VISIBILITY_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-interface-visibility-")));
await fs.mkdir(evidence, { recursive: true });

const policyBundle = await build({
  stdin: {
    contents: `export * from ${imp("src/lib/studentMenuAccess.ts")}; export * from ${imp("src/constants/menus.ts")};`,
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
let assertions = 0;
const check = (condition, message) => {
  assert(condition, message);
  assertions++;
};
const allowed = (url, menus, config = system) => {
  const [pathname, search] = url.split("?");
  return policy.getStudentRouteAccess({ pathname, search }, config, menus)
    .allowed;
};
const hidden = (url, parent = false) => {
  const menus = policy.cloneDefaultMenus();
  for (const item of menus.student) {
    if (parent && item.url === url) item.hidden = true;
    for (const child of item.children || [])
      if (!parent && child.url === url) child.hidden = true;
  }
  return menus;
};
const defaults = policy.cloneDefaultMenus();
for (const key of ["profile", "avatar", "score", "wrong_note"]) {
  const url =
    key === "profile" ? "/student/mypage" : `/student/mypage?menu=${key}`;
  const menus = hidden(url);
  check(!allowed(url, menus), `${key} direct URL is hidden`);
  check(
    !allowed(`${url}${url.includes("?") ? "&" : "?"}attemptId=fixture`, menus),
    `${key} extra parameters do not bypass hiding`,
  );
  check(
    !policy.buildStudentMenuVisibility(menus)[key],
    `${key} server projection is closed`,
  );
}
for (const key of ["avatar", "score", "wrong_note"])
  check(
    !allowed(`/student/mypage?menu=${key}`, hidden("/student/mypage", true)),
    "parent hide blocks every MyPage child",
  );
check(
  !allowed("/student/mypage?menu=profile", hidden("/student/mypage")),
  "explicit profile alias is hidden",
);
check(
  !allowed("/student/mypage?menu=avatar", null),
  "unknown menus fail closed",
);
check(
  !allowed("/student/mypage?menu=score", defaults, {
    ...system,
    showScore: false,
  }),
  "system score setting applies to MyPage",
);
check(
  !allowed("/student/mypage?menu=wrong_note", defaults, {
    ...system,
    showQuiz: false,
  }),
  "system quiz setting applies to MyPage",
);
check(
  !allowed("/student/weplay?game=history-rain", hidden("/student/weplay")),
  "naval legacy root child hides game alias",
);
check(
  allowed("/student/weplay?game=joseon-yut", hidden("/student/weplay")),
  "naval hiding preserves independently open yut",
);
check(
  allowed("/student/weplay", hidden("/student/weplay")),
  "catalogue stays reachable for remaining game",
);
check(
  !allowed(
    "/student/weplay?game=joseon-yut",
    hidden("/student/weplay?game=joseon-yut"),
  ),
  "yut direct link hidden",
);
for (const suffix of ["", "?game=history-rain", "?game=joseon-yut"])
  check(
    !allowed(`/student/weplay${suffix}`, hidden("/student/weplay", true)),
    "Weplay parent closes every route",
  );
check(
  !allowed("/student/weplay?game=unknown-game", defaults),
  "unknown game never opens a fallback game",
);
check(
  !allowed("/student/mypage?menu=avatar", defaults, {
    ...system,
    studentMenuVisibility: { avatar: false },
  }),
  "server projection closes before menu snapshot arrives",
);
const legacy = policy.sanitizeMenuConfig({
  student: [
    { name: "마이페이지", url: "/student/mypage", hidden: true },
    {
      name: "위플레이",
      url: "/student/weplay",
      children: [{ name: "충무공", url: "/student/weplay", hidden: true }],
    },
  ],
});
check(
  !allowed("/student/mypage?menu=avatar", legacy),
  "legacy parent hiding survives normalization",
);
check(
  legacy.student
    .find((item) => item.url === "/student/weplay")
    .children.some((child) => child.url.includes("joseon-yut")),
  "saved menus gain yut control",
);

const service = `
import React from 'react';
import {cloneDefaultMenus} from ${imp("src/constants/menus.ts")};
const listeners=new Map(); const pending=new Map(); const navalPending=[];
const fixtureUser={uid:'visibility-fixture',email:'fixture@example.invalid'};
export const auth={currentUser:fixtureUser}; export const db={}; export const authPersistenceReady=Promise.resolve();
export const baseConfig=${JSON.stringify(system)};
const values={config:baseConfig,menu_config:cloneDefaultMenus(),interface_config:{dashboard:{notice:true,calendar:true,ranking:true}}};
window.visibilityQa={mounts:[],toasts:[],reads:[],publication:'open',navalReads:0,
  deferNaval:new URLSearchParams(location.search).get('fixture')==='weplay',
  resolveNaval(value){this.navalReply=value;navalPending.splice(0).forEach(resolve=>resolve(value));},
  resolve(id,data){if(data!==undefined)values[id]=data;const requests=pending.get(id)||[];pending.delete(id);requests.forEach(x=>x.resolve(values[id]));},
  reject(id){const requests=pending.get(id)||[];pending.delete(id);requests.forEach(x=>x.reject(Error('synthetic settings failure')));},
  resolveAll(){for(const id of ['config','menu_config','interface_config'])this.resolve(id);},
  update(id,data,{fromCache=false,hasPendingWrites=false}={}){values[id]=data;for(const listener of listeners.get('site_settings/'+id)||[])listener.next({exists:()=>data!==null,data:()=>data,metadata:{fromCache,hasPendingWrites}});},
  failListener(id){const active=listeners.get('site_settings/'+id);for(const listener of active||[])listener.error(Error('synthetic terminal listener failure'));active?.clear();},
  values, listeners,
};
export const readFreshSiteSettingDoc=id=>{window.visibilityQa.reads.push(id);return new Promise((resolve,reject)=>{if(!pending.has(id))pending.set(id,[]);pending.get(id).push({resolve,reject});});};
export const readSiteSettingDoc=readFreshSiteSettingDoc;
export const invalidateSiteSettingDocCache=()=>{};
export const doc=(_, ...parts)=>({path:parts.join('/')});
export const onSnapshot=(ref,options,next,error)=>{const listener={next,error};if(!listeners.has(ref.path))listeners.set(ref.path,new Set());listeners.get(ref.path).add(listener);return()=>listeners.get(ref.path)?.delete(listener);};
export const onIdTokenChanged=(_,next)=>{queueMicrotask(()=>next(fixtureUser));return()=>{};};export const signOut=async()=>{};
export class AuthStartupController{constructor(deps){this.deps=deps;}observe(user){this.deps.change({phase:'ready',generation:1,currentUser:user,onboardingUser:null,userData:{uid:user.uid,role:location.hash.startsWith('#/teacher')?'teacher':'student',name:'검증학생'},error:null});this.deps.sessionReady(user,1);}dispose(){} }
export const invalidateApplicationSession=()=>{},prepareApplicationSession=async()=>{},clearDeviceSession=()=>{},setAuthDeadline=setTimeout,clearAuthDeadline=clearTimeout;
export const subscribeMenuConfigUpdated=()=>()=>{},subscribeSystemConfigUpdated=()=>()=>{},notifyPointsUpdated=()=>{};
export const archiveScope=null,isSemesterArchive=false;
export const markLoginPerf=()=>{},measureLoginPerf=()=>{};
const toast={showToast(value){window.visibilityQa.toasts.push(value);}};export const useAppToast=()=>toast;
export const WEPLAY_GAMES=[{id:'history-rain',name:'충무공'},{id:'joseon-yut',name:'마우저구 윷놀이'}];
export const getWeplayLobby=async()=>{window.visibilityQa.navalReads++;return window.visibilityQa.navalReply??(window.visibilityQa.deferNaval?new Promise(resolve=>navalPending.push(resolve)):{gameEnabled:true});};
export const prepareWeplayIntroAudio=()=>{},preloadWeplayAssets=()=>{};
export const startWeplayGame=()=>{throw Error('Fixture forbids paid game starts')};
export const weplayErrorMessage=(_error,fallback)=>fallback;
export const WEPLAY_DIFFICULTY_LABELS={mild:'쉬움',normal:'보통',hard:'어려움'};
`;
const header = `import React from 'react'; import {useAuth} from ${imp("src/contexts/AuthContext.tsx")}; import {getStudentVisibleMenuItems} from ${imp("src/lib/studentMenuAccess.ts")}; export default function Header(){const {config,menuConfig}=useAuth();React.useEffect(()=>{window.visibilityQa.mounts.push('header')},[]);return <nav data-testid="portal-header">{getStudentVisibleMenuItems(menuConfig?.student||[],config).map(item=><div key={item.url}>{item.name}{item.children?.map(child=><a href={'#'+child.url} key={child.url}>{child.name}</a>)}</div>)}</nav>;}`;
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter,useLocation} from 'react-router-dom';
import {AuthProvider} from ${imp("src/contexts/AuthContext.tsx")};
import MainLayout from ${imp("src/components/layout/MainLayout.tsx")};
import WeplayGameCatalog from ${imp("src/components/common/weplay/WeplayGameCatalog.tsx")};
import Weplay from ${imp("src/pages/student/Weplay.tsx")};
import ${imp("src/assets/index.css")};
function Body(){const location=useLocation();const marker=location.pathname+location.search;React.useLayoutEffect(()=>{window.visibilityQa.mounts.push(marker)},[marker]);return <div data-testid="body" data-route={marker}>{new URLSearchParams(window.location.search).get('fixture')==='weplay'?<Weplay/>:marker==='/student/weplay'?<WeplayGameCatalog portal="student" gameTitle="내가 충무공이라고?!"/>:<h1>{marker}</h1>}</div>}
function App(){return <AuthProvider><HashRouter><MainLayout><Body/></MainLayout></HashRouter></AuthProvider>};
createRoot(document.getElementById('root')).render(<App/>);
`;
const output = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  loader: { ".svg": "dataurl", ".webp": "dataurl" },
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
              /^firebase\/(auth|firestore)$|(?:^|\/)lib\/(firebase|applicationSession|deviceSession|authDeadline|authStartup|siteSettings|appEvents|semesterArchive|loginPerf|weplay|weplayAssets)$|^\.\/AppToastProvider$|(?:^|\/)common\/AppToastProvider$|weplayIntroAudio$/,
          },
          () => ({ path: "services", namespace: "fixture" }),
        );
        plugin.onResolve({ filter: /(?:^|\/)Header$/ }, () => ({
          path: "header",
          namespace: "fixture",
        }));
        plugin.onResolve(
          {
            filter:
              /(?:StudentHistoryDictionaryController|StudentRankPromotionController|TeacherPatchMemoController|AuthRecoveryState)$/,
          },
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
        plugin.onResolve({ filter: /useYutPublication$/ }, () => ({
          path: "publication",
          namespace: "fixture",
        }));
        plugin.onResolve(
          {
            filter:
              /(?:HistoryRainGame|WeplayStudioIntro|WeplayGameFrame|WeplayLaunchPanel|NavalBattleResult|WeplayGuide|useWeplayGuide|useWeplayMusic|WeplayMusicButton|WeplayRecordsDialog|YutGameEntry)$/,
          },
          (args) => ({
            path: args.path.split("/").pop(),
            namespace: "fixture-weplay",
          }),
        );
        plugin.onLoad(
          { filter: /.*/, namespace: "fixture-weplay" },
          (args) => ({
            loader: "tsx",
            resolveDir: root,
            contents:
              args.path === "HistoryRainGame"
                ? `import React from 'react';export default function Game({session}){React.useLayoutEffect(()=>{window.visibilityQa.mounts.push('game:'+session.id)},[]);return <div data-testid="naval-game">{session.id}</div>}`
                : args.path === "WeplayStudioIntro"
                  ? `import React from 'react';export default function Intro({onComplete}){React.useLayoutEffect(()=>{window.visibilityQa.mounts.push('intro')},[]);return <button data-testid="naval-intro" onClick={onComplete}>인트로 완료</button>}`
                  : args.path === "WeplayGameFrame"
                    ? `export default function Frame({children}){return children}`
                    : args.path === "useWeplayGuide"
                      ? `export default function Guide(){return {open:false,openGuide(){},finishGuide(){},closeForNow(){}}}`
                      : args.path === "useWeplayMusic"
                        ? `export default function Music(){return {}}`
                        : `export default function Unused(){return null}`,
          }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "tsx",
          resolveDir: root,
          contents:
            args.path === "services"
              ? service
              : args.path === "header"
                ? header
                : args.path === "archive"
                  ? "export const SemesterArchiveBanner=()=>null,SemesterArchiveUnavailable=()=>null,isArchiveUnavailableRoute=()=>false"
                  : args.path === "workspace"
                    ? "export const PortalWorkspaceFooterProvider=({children})=>children;export const PortalFallbackFooter=()=>null;"
                    : args.path === "publication"
                      ? `export default function useYutPublication(){return {status:window.visibilityQa.publication,retry(){}}}`
                      : "export default function Empty(){return null}",
        }));
      },
    },
  ],
});
const js = output.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css =
  output.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const files = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  };
  if (pathname.startsWith("/assets/")) {
    try {
      const data = await fs.readFile(path.join(root, "public", pathname));
      response.setHeader("Content-Type", "image/webp");
      response.end(data);
    } catch {
      response.writeHead(404);
      response.end();
    }
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
const checks = [];
const errors = [];
let visit = 0;
const open = async (page, route, fixture = "") => {
  await page.goto(
    origin + "/?case=" + ++visit + "&fixture=" + fixture + "#" + route,
  );
  await page.waitForFunction(() =>
    window.visibilityQa?.reads.includes("menu_config"),
  );
};
const settle = async (page) => {
  await page.evaluate(() => window.visibilityQa.resolveAll());
};
const zeroProtected = async (page, label) => {
  check(
    (await page.getByTestId("portal-header").count()) === 0,
    label + ": no header",
  );
  check(
    (await page.getByTestId("body").count()) === 0,
    label + ": no protected body",
  );
  check(
    (await page.evaluate(() => window.visibilityQa.mounts)).length === 0,
    label + ": no transient mounts",
  );
};
try {
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page, "/student/dashboard");
    await zeroProtected(page, "slow settings");
    await page.evaluate(() => {
      window.visibilityQa.resolve("config");
      window.visibilityQa.resolve("menu_config");
    });
    await page.waitForTimeout(120);
    await zeroProtected(page, "slow interface settings");
    await settle(page);
    await page.getByTestId("body").waitFor();
    checks.push(`${width}: dashboard waits for every server setting`);

    await open(page, "/student/mypage?menu=avatar");
    await page.evaluate(
      (menus) => window.visibilityQa.resolve("menu_config", menus),
      hidden("/student/mypage?menu=avatar"),
    );
    await settle(page);
    await page.waitForURL(/#\/student\/dashboard$/);
    check(
      !(await page.evaluate(() => window.visibilityQa.mounts)).includes(
        "/student/mypage?menu=avatar",
      ),
      "hidden avatar never mounted",
    );
    check(
      (await page
        .getByRole("link", { name: "아바타 꾸미기", exact: true })
        .count()) === 0,
      "hidden avatar absent from menu",
    );
    checks.push(`${width}: hidden avatar direct entry has no transient render`);

    await open(page, "/student/weplay?game=joseon-yut");
    await page.evaluate(
      (menus) => window.visibilityQa.resolve("menu_config", menus),
      hidden("/student/weplay?game=joseon-yut"),
    );
    await settle(page);
    await page.waitForURL(/#\/student\/dashboard$/);
    check(
      !(await page.evaluate(() => window.visibilityQa.mounts)).includes(
        "/student/weplay?game=joseon-yut",
      ),
      "hidden yut never mounted",
    );
    checks.push(`${width}: hidden yut direct entry blocked`);

    await open(page, "/student/mypage?menu=avatar");
    await page.evaluate(() => {
      window.visibilityQa.reject("config");
      window.visibilityQa.resolve("menu_config");
      window.visibilityQa.resolve("interface_config");
    });
    await page.getByRole("alert").waitFor();
    await zeroProtected(page, "settings error");
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    await settle(page);
    await page.getByTestId("body").waitFor();
    check(
      (await page.getByTestId("body").getAttribute("data-route")) ===
        "/student/mypage?menu=avatar",
      "retry opens permitted requested page",
    );
    checks.push(
      `${width}: failed settings stay closed; explicit retry recovers`,
    );

    await page.evaluate(() => window.visibilityQa.failListener("config"));
    await page.getByRole("alert").waitFor();
    check(
      (await page.getByTestId("body").count()) === 0,
      "listener error closes existing page",
    );
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    await settle(page);
    await page.getByTestId("body").waitFor();
    check(
      await page.evaluate(
        () =>
          window.visibilityQa.listeners.get("site_settings/config")?.size === 1,
      ),
      "retry renews terminal settings listener",
    );
    checks.push(
      `${width}: terminal listener error closes and retry resubscribes`,
    );

    await page.evaluate(
      (menus) => window.visibilityQa.update("menu_config", menus),
      hidden("/student/mypage", true),
    );
    await page.waitForURL(/#\/student\/dashboard$/);
    check(
      (await page
        .getByRole("link", { name: "아바타 꾸미기", exact: true })
        .count()) === 0,
      "live parent closure removes menu",
    );
    await page.evaluate(
      (menus) =>
        window.visibilityQa.update("menu_config", menus, { fromCache: true }),
      defaults,
    );
    await page.waitForTimeout(100);
    check(
      (await page
        .getByRole("link", { name: "아바타 꾸미기", exact: true })
        .count()) === 0,
      "cached snapshot cannot reopen hidden menu",
    );
    await page.evaluate(
      (menus) =>
        window.visibilityQa.update("menu_config", menus, {
          hasPendingWrites: true,
        }),
      defaults,
    );
    await page.waitForTimeout(100);
    check(
      (await page
        .getByRole("link", { name: "아바타 꾸미기", exact: true })
        .count()) === 0,
      "uncommitted snapshot cannot reopen hidden menu",
    );
    checks.push(`${width}: live hiding and cache/pending-write protection`);

    await open(page, "/student/weplay");
    await page.evaluate(
      (menus) => window.visibilityQa.resolve("menu_config", menus),
      hidden("/student/weplay?game=joseon-yut"),
    );
    await settle(page);
    await page
      .getByRole("heading", { name: "위플레이", exact: true })
      .waitFor();
    check(
      (await page.locator(".weplay-game-card").count()) === 1,
      "catalogue excludes hidden yut",
    );
    check(
      (await page.locator('.weplay-game-card[href*="joseon-yut"]').count()) ===
        0,
      "hidden yut has no catalogue link",
    );
    await page.screenshot({
      path: path.join(evidence, `catalogue-${width}.png`),
      fullPage: true,
    });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "no horizontal overflow",
    );
    checks.push(`${width}: filtered catalogue and responsive layout`);
    await open(page, "/teacher/weplay");
    await page.getByTestId("body").waitFor();
    check(
      (await page.getByTestId("body").getAttribute("data-route")) ===
        "/teacher/weplay",
      "student settings gate does not block teacher preview",
    );
    checks.push(`${width}: teacher preview remains separate`);

    const lobby = {
      gameEnabled: true,
      policy: { enabled: true, challengeCost: 5 },
      balance: 10,
      dailyRemaining: 1,
      wordCount: 3,
      activeSession: null,
    };
    const paid = {
      ...lobby,
      activeSession: {
        id: "paid-fixture",
        mode: "challenge",
        difficulty: "mild",
      },
    };
    await open(page, "/student/weplay", "weplay");
    await settle(page);
    await page.waitForFunction(() => window.visibilityQa.navalReads > 0);
    await page.evaluate(
      (value) => window.visibilityQa.resolveNaval(value),
      paid,
    );
    await page.getByTestId("naval-game").waitFor();
    check(
      (await page.getByTestId("naval-game").textContent()) === "paid-fixture",
      "root entry restores the paid session",
    );
    check(
      page.url().endsWith("#/student/weplay?game=history-rain"),
      "restoration selects naval route",
    );
    checks.push(`${width}: existing paid session restores from catalogue root`);

    await open(page, "/student/weplay", "weplay");
    await settle(page);
    await page.waitForFunction(() => window.visibilityQa.navalReads > 0);
    await page.evaluate(
      (value) => window.visibilityQa.resolveNaval(value),
      lobby,
    );
    const navalCard = page.locator('.weplay-game-card[href*="history-rain"]');
    await navalCard.waitFor();
    await page.evaluate(
      (value) => window.visibilityQa.resolveNaval(value),
      paid,
    );
    await navalCard.click();
    await page.getByTestId("naval-game").waitFor();
    await page.goBack();
    await page.waitForFunction(
      () => location.hash === "#/student/weplay?game=history-rain",
    );
    await page.getByTestId("naval-game").waitFor();
    check(
      (await page.getByTestId("naval-game").textContent()) === "paid-fixture",
      "back to catalogue preserves or restores same paid session",
    );
    checks.push(`${width}: back navigation cannot lose an active paid session`);

    await open(page, "/student/weplay", "weplay");
    await page.evaluate(
      (menus) => window.visibilityQa.resolve("menu_config", menus),
      hidden("/student/weplay"),
    );
    await settle(page);
    await page.locator('.weplay-game-card[href*="joseon-yut"]').waitFor();
    check(
      (await page.evaluate(() => window.visibilityQa.navalReads)) === 0,
      "hidden naval never queries its lobby",
    );
    check(
      (await page.getByTestId("naval-intro").count()) === 0,
      "hidden naval has no intro",
    );
    checks.push(
      `${width}: naval hiding leaves yut catalogue without naval calls`,
    );

    await open(page, "/student/weplay?game=history-rain", "weplay");
    await settle(page);
    await page.waitForFunction(() => window.visibilityQa.navalReads > 0);
    check(
      (await page.getByTestId("naval-intro").count()) === 0,
      "unverified game has no intro",
    );
    check(
      (await page.getByTestId("naval-game").count()) === 0,
      "unverified game has no play scene",
    );
    await page.evaluate((value) => window.visibilityQa.resolveNaval(value), {
      ...paid,
      gameEnabled: false,
    });
    await page
      .getByText("지금은 게임이 열려 있지 않습니다.", { exact: true })
      .waitFor();
    check(
      !(await page.evaluate(() => window.visibilityQa.mounts)).some(
        (value) => value === "intro" || value.startsWith("game:"),
      ),
      "disabled game never transiently mounts intro or saved session",
    );
    checks.push(
      `${width}: disabled direct game remains closed before and after response`,
    );
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
