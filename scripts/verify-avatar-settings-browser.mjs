/** Local-only real Settings + price editor regression fixture. No Firebase calls. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(
  process.env.AVATAR_SETTINGS_EVIDENCE ||
    path.join(root, "output/avatar-settings-20261028"),
);
await fs.mkdir(output, { recursive: true });
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import MainLayout from './src/components/layout/MainLayout';
import Settings from './src/pages/teacher/Settings';
import {AVATAR_ITEMS,defaultAvatarLook} from './src/features/avatar/catalog';
const qa=window.avatarPricingQa={reads:0,saves:[],revision:4,failLoad:false,conflict:false,deferred:false,errors:[],prices:Object.fromEntries(AVATAR_ITEMS.map(i=>[i.id,i.price]))};
qa.avatar={schemaVersion:1,catalogVersion:1,look:defaultAvatarLook('boy'),revision:1,lookHash:'fixture',ownedItemIds:[],thumbnailUrl:''};
window.addEventListener('error',e=>qa.errors.push(e.message));
window.addEventListener('unhandledrejection',e=>qa.errors.push(String(e.reason)));
qa.load=async()=>{qa.reads++;if(qa.failLoad)throw Error('가격표를 불러오지 못했습니다. 다시 불러와 주세요.');return{revision:qa.revision,prices:{...qa.prices}}};
qa.save=async input=>{qa.saves.push(structuredClone(input));if(qa.conflict||input.expectedRevision!==qa.revision)throw Error('다른 관리자가 가격을 변경했습니다. 저장된 가격을 다시 불러와 주세요.');if(qa.deferred)await new Promise(resolve=>qa.release=resolve);qa.prices={...input.prices};qa.revision++;return{revision:qa.revision,prices:{...qa.prices}}};
function App(){const[mode,setMode]=useState('normal');return <><div className="qa-controls"><button onClick={()=>{qa.conflict=!qa.conflict;setMode(qa.conflict?'conflict':'normal')}}>동시 수정 오류</button><button onClick={()=>{qa.failLoad=!qa.failLoad;setMode(qa.failLoad?'load-error':'normal')}}>조회 오류</button><button onClick={()=>{qa.deferred=!qa.deferred;setMode(qa.deferred?'delayed':'normal')}}>저장 지연</button><button onClick={()=>qa.release?.()}>저장 응답</button><output>{mode}</output></div><MainLayout><Settings/></MainLayout></>}
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/teacher/settings']}><App/></MemoryRouter>);
`;
const mockSections =
  /\/(SettingsGeneral|SettingsSchool|SettingsInterface|SettingsPrivacy|SettingsAccess|SettingsNotifications|SettingsSemesterArchive)$/;
const shellMocks = {
  Header: `import React from 'react';import TeacherSidebar from './src/components/layout/TeacherSidebar';const groups=[{id:'lesson',name:'학습 자료 관리',icon:'lesson',children:[{name:'수업 자료',resolvedUrl:'/teacher/lesson'}]},{id:'quiz',name:'평가 관리',icon:'quiz',children:[]},{id:'points',name:'위스 관리',icon:'wis',children:[]}];export default function Header({sidebarCollapsed,onToggleSidebar}){return <><TeacherSidebar groups={groups} home="/teacher/dashboard" semesterLabel="2026학년도 2학기" showDashboard showSettings collapsed={sidebarCollapsed} mobileOpen={false} onToggleCollapsed={onToggleSidebar} onCloseMobile={()=>{}} isChildActive={()=>false}/><header className="teacher-account-header"><div className="header-container">검증 교사</div></header></>}`,
  AppToastProvider: `export const useAppToast=()=>({showToast:()=>{}});`,
  safeStorage: `export const readStorage=()=>null;`,
  loginPerf: `export const markLoginPerf=()=>{},measureLoginPerf=()=>{};`,
  browserTasks: `export const runAfterNextPaint=callback=>{callback();return()=>{}};`,
  semesterArchive: `export const isSemesterArchive=false;`,
  SemesterArchiveBoundary: `export const SemesterArchiveBanner=()=>null,SemesterArchiveUnavailable=()=>null,isArchiveUnavailableRoute=()=>false;`,
  studentMenuAccess: `export const getStudentRouteAccess=()=>({allowed:true}),isStudentVisibilityControlledPath=()=>false;`,
  AuthRecoveryState: `export default ()=>null;`,
  weplayPreload: `export const preloadStudentWeplay=()=>{};`,
};
const result = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  outdir: output,
  loader: { ".webp": "dataurl" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "isolated-settings-data",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /\/(Header|AppToastProvider|safeStorage|loginPerf|browserTasks|semesterArchive|SemesterArchiveBoundary|studentMenuAccess|AuthRecoveryState|weplayPreload)$/,
          },
          (args) => ({ path: path.basename(args.path), namespace: "shell" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "shell" }, (args) => ({
          contents: shellMocks[args.path],
          loader: "tsx",
          resolveDir: root,
        }));
        plugin.onResolve({ filter: /Controller$/ }, (args) => ({
          path: args.path,
          namespace: "controller",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "controller" }, () => ({
          contents: "export default ()=>null",
          loader: "js",
        }));
        plugin.onResolve({ filter: mockSections }, (args) => ({
          path: args.path,
          namespace: "section",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "section" }, (args) => ({
          contents: `import React from 'react';export default function Section(){return <div><h2>${path.basename(args.path)}</h2><p>설정 본문 검증</p><button>검증 작업</button></div>}`,
          loader: "tsx",
          resolveDir: root,
        }));
        plugin.onResolve({ filter: /\/AuthContext$/ }, (args) => ({
          path: args.path,
          namespace: "auth",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "auth" }, () => ({
          contents: `const user={uid:'qa-admin',email:'test@example.invalid'};const common={user,currentUser:user,userData:{uid:'qa-admin',role:'teacher',name:'검증 교사'},authGeneration:1,loading:false,authPhase:'ready',configReady:true,menuConfigReady:true,settingsLoadedAt:Date.now(),refreshConfig:async()=>{},refreshMenuConfig:async()=>{},config:{year:2026,semester:2},menuConfig:{},interfaceConfig:{}};export const useAuth=()=>common;`,
          loader: "js",
        }));
        plugin.onResolve(
          { filter: /(?:\/avatar\/service|^\.\/service)$/ },
          (args) => ({
            path: args.path,
            namespace: "pricing",
          }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "pricing" }, () => ({
          contents: `export const avatarErrorMessage=e=>e.message,avatarPricingFromError=()=>null;export const getAvatarCatalogPricing=()=>window.avatarPricingQa.load();export const updateAvatarCatalogPricing=x=>window.avatarPricingQa.save(x);export const getTeacherMyPage=async()=>({avatar:window.avatarPricingQa.avatar,profileEmojiId:'sun',profileIcon:'☀️',emojiRegistry:[{id:'sun',emoji:'☀️',label:'햇살'}],allAvailable:true});export const saveTeacherAvatar=async()=>{throw Error('Unexpected avatar write')},updateTeacherProfileIcon=async()=>{throw Error('Unexpected emoji write')},makeAvatarThumbnail=()=>'',getAvatarStudioState=async()=>{throw Error('Unexpected student read')},purchaseAvatarItem=async()=>{throw Error('Unexpected purchase')},saveStudentAvatar=async()=>{throw Error('Unexpected student write')};`,
          loader: "js",
        }));
        plugin.onResolve({ filter: /\/permissions$/ }, (args) => ({
          path: args.path,
          namespace: "permission",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "permission" }, () => ({
          contents: `export const isAdminUser=()=>true,canAccessTeacherPortal=()=>true,canAccessTeacherPath=()=>true,getDefaultTeacherRoute=()=>'/teacher/dashboard';`,
          loader: "js",
        }));
        plugin.onResolve({ filter: /^\.\/Footer$/ }, (args) => ({
          path: args.path,
          namespace: "footer",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "footer" }, () => ({
          contents: `import React from 'react';export default function Footer(){return <footer className="qa-footer">Westory</footer>}`,
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const files = new Map(
  result.outputFiles.map((file) => [
    "/" + path.basename(file.path),
    file.contents,
  ]),
);
for (const file of result.outputFiles)
  await fs.writeFile(file.path, file.contents);
const baseline = `*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#1f2937;font:16px 'Malgun Gothic',Arial,sans-serif;word-break:keep-all}button,input,select{font:inherit}button{cursor:pointer}a{color:inherit;text-decoration:none}h1,h2,h3,h4,p{margin-top:0}.header-container{display:flex;align-items:center}.flex{display:flex}.flex-col{flex-direction:column}.min-h-screen{min-height:100vh}.flex-1{flex:1 1 0%}.min-h-0{min-height:0}.w-full{width:100%}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.qa-controls{position:relative;z-index:100;display:flex;flex-wrap:wrap;gap:8px;padding:8px;border-bottom:1px solid #ddd;background:white}.qa-controls button{min-height:44px;padding:8px;background:white;border:1px solid #ddd;border-radius:8px}.qa-footer{padding:24px;color:#64748b;text-align:center;font-size:12px}.teacher-nav-icon{width:20px;height:20px;flex:0 0 20px}`;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>설정·아바타 가격 검증</title><link rel="stylesheet" href="/stdin.css"><style>${baseline}</style><div id="root"></div><script type="module" src="/stdin.js"></script></html>`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let data = files.get(url.pathname),
      type = url.pathname.endsWith(".css") ? "text/css" : "text/javascript";
    if (url.pathname === "/") {
      data = html;
      type = "text/html";
    } else if (url.pathname.startsWith("/avatar/")) {
      const base = path.resolve(root, "public/avatar");
      const file = path.resolve(
        root,
        "public",
        "." + decodeURIComponent(url.pathname),
      );
      if (!file.startsWith(base + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      data = await fs.readFile(file);
      type = file.endsWith(".glb")
        ? "model/gltf-binary"
        : file.endsWith(".json")
          ? "application/json"
          : file.endsWith(".png")
            ? "image/png"
            : "image/webp";
    }
    if (!data) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      type + (type.startsWith("text/") ? ";charset=utf-8" : ""),
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; font-src 'self' data:",
    );
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) =>
  server.listen(
    Number(process.env.AVATAR_SETTINGS_PORT || 0),
    "127.0.0.1",
    resolve,
  ),
);
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(`AVATAR_SETTINGS_FIXTURE=${origin}`);
console.log(`EVIDENCE=${output}`);
if (process.argv.includes("--serve")) await new Promise(() => {});
const require = createRequire(import.meta.url);
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
const reports = [];
let browser;
try {
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  for (const width of process.env.AVATAR_SETTINGS_WIDTHS?.split(",").map(
    Number,
  ) || [320, 390, 768, 1280, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const rendererErrors = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /THREE|WebGL|shader|texture|blob:/i.test(message.text())
      )
        rendererErrors.push(message.text());
    });
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin);
    const nav = page.getByRole("navigation", { name: "관리자 설정 메뉴" }),
      toggle = page.locator(".teacher-settings-menu-toggle");
    if (width < 768) {
      assert.equal(await nav.isVisible(), false);
      await toggle.focus();
      await page.keyboard.press("Enter");
      assert.equal(await nav.isVisible(), true);
    }
    await nav
      .getByRole("button", { name: "아바타 가격 관리", exact: true })
      .click();
    await page.locator(".avatar-pricing-item").first().waitFor();
    if (width < 768) {
      assert.equal(await nav.isVisible(), false);
      assert.equal(
        await toggle.evaluate((el) => el === document.activeElement),
        true,
      );
      await toggle.click();
      await page.keyboard.press("Escape");
      assert.equal(await nav.isVisible(), false);
    }
    const before = await page.evaluate(() => window.avatarPricingQa.reads);
    await page
      .getByLabel("꾸미기 종류", { exact: true })
      .selectOption("character");
    await page.getByLabel("아바타", { exact: true }).selectOption("boy");
    assert.equal(
      await page.locator(".avatar-pricing-item").count(),
      1,
      "Character cards filter by their own gender, not purchase eligibility",
    );
    assert.equal(
      await page.locator(".avatar-pricing-item h4").innerText(),
      "남학생",
    );
    assert.match(
      await page.locator(".avatar-pricing-labels").innerText(),
      /남성형/,
    );
    await page.getByLabel("꾸미기 종류", { exact: true }).selectOption("top");
    await page.getByLabel("유형", { exact: true }).selectOption("관복");
    assert.equal(await page.locator(".avatar-pricing-item").count(), 3);
    await page.getByLabel("아바타", { exact: true }).selectOption("boy");
    if (process.argv.includes("--require-previews"))
      assert.equal(
        await page
          .locator(".avatar-pricing-preview img")
          .first()
          .getAttribute("src"),
        "/avatar/v2/previews/boy/top-official-navy.webp",
      );
    await page.getByLabel("아이템 검색", { exact: true }).fill("흑색");
    assert.equal(await page.locator(".avatar-pricing-item").count(), 1);
    const name = await page.locator(".avatar-pricing-item h4").innerText();
    await page
      .getByLabel(name + " 무료·유료", { exact: true })
      .selectOption("paid");
    const price = page.getByLabel(name + " 위스 가격", { exact: true });
    await price.fill("");
    assert.equal(await price.getAttribute("aria-invalid"), "true");
    assert.equal(
      await page
        .getByRole("button", { name: "가격 저장", exact: true })
        .isEnabled(),
      false,
    );
    await price.fill("1000001");
    assert.equal(await price.getAttribute("aria-invalid"), "true");
    await price.fill("750");
    assert.equal(await price.getAttribute("aria-invalid"), "false");
    await page.getByLabel("변경한 항목만", { exact: true }).check();
    assert.equal(await page.locator(".avatar-pricing-item").count(), 1);
    assert.equal(
      await page.evaluate(() => window.avatarPricingQa.reads),
      before,
      "Filtering does not fetch",
    );
    await page
      .getByRole("button", { name: "동시 수정 오류", exact: true })
      .click();
    await page.getByRole("button", { name: "가격 저장", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "다른 관리자" }).waitFor();
    assert.equal(await price.inputValue(), "750", "Conflict preserves draft");
    await page
      .getByRole("button", { name: "동시 수정 오류", exact: true })
      .click();
    await page.getByRole("button", { name: "가격 저장", exact: true }).click();
    await page.getByText("저장했습니다.", { exact: true }).waitFor();
    const requests = await page.evaluate(() => window.avatarPricingQa.saves);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].expectedRevision, 4);
    assert.deepEqual(requests[0], requests[1]);
    await page.getByLabel("변경한 항목만", { exact: true }).uncheck();
    assert.equal(
      await page.locator(".avatar-pricing-current").innerText(),
      "현재 750 위스",
    );
    if (width === 1280) {
      await price.fill("800");
      await page
        .getByRole("button", { name: "저장 지연", exact: true })
        .click();
      await page
        .getByRole("button", { name: "가격 저장", exact: true })
        .click();
      assert.equal(
        await price.isEnabled(),
        false,
        "Price controls lock while saving",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "저장 중", exact: true })
          .isEnabled(),
        false,
      );
      assert.equal(
        await page
          .getByRole("button", {
            name: "저장된 가격 다시 불러오기",
            exact: true,
          })
          .isEnabled(),
        false,
      );
      assert.equal(
        await page.evaluate(() => window.avatarPricingQa.saves.length),
        3,
        "One request for an explicit save",
      );
      await page
        .getByRole("button", { name: "저장 응답", exact: true })
        .click();
      await page.getByText("저장했습니다.", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "조회 오류", exact: true })
        .click();
      await page
        .getByRole("button", { name: "저장된 가격 다시 불러오기", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "불러오지 못했습니다" })
        .waitFor();
      assert.equal(
        await price.inputValue(),
        "800",
        "Failed reload preserves current state",
      );
      await page
        .getByRole("button", { name: "조회 오류", exact: true })
        .click();
      await page
        .getByRole("button", { name: "저장된 가격 다시 불러오기", exact: true })
        .click();
      await page.getByText("현재 800 위스", { exact: true }).waitFor();
    }
    await page.getByLabel("아이템 검색", { exact: true }).fill("");
    await page.addStyleTag({ content: ".qa-controls{display:none}" });
    await page.evaluate(() => window.scrollTo(0, 0));
    if (process.argv.includes("--require-previews")) {
      for (const img of await page
        .locator(".avatar-pricing-preview img")
        .all()) {
        await img.scrollIntoViewIfNeeded();
        await img.evaluate((el) => el.decode());
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    const report = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      items: document.querySelectorAll(".avatar-pricing-item").length,
      canvas: document.querySelectorAll("canvas").length,
      errors: window.avatarPricingQa.errors,
      reads: window.avatarPricingQa.reads,
      sidebar: document
        .querySelector(".teacher-sidebar")
        ?.getBoundingClientRect()
        .toJSON(),
      submenu: document
        .querySelector(".teacher-settings-navigation")
        ?.getBoundingClientRect()
        .toJSON(),
      content: document
        .querySelector("#teacher-settings-content")
        ?.getBoundingClientRect()
        .toJSON(),
      previews: [
        ...document.querySelectorAll(".avatar-pricing-preview img"),
      ].map((i) => ({
        src: i.getAttribute("src"),
        loaded: i.complete && i.naturalWidth > 0,
      })),
    }));
    if (process.argv.includes("--require-previews")) {
      assert.equal(report.previews.length, report.items);
      assert(
        report.previews.every((item) => item.loaded),
        "Every rendered item has a real preview",
      );
    }
    assert(report.scrollWidth <= width, "No page overflow");
    assert.equal(report.canvas, 0);
    assert.deepEqual(report.errors, []);
    if (width >= 1024) {
      assert(
        Math.abs(report.sidebar.right - report.submenu.left) < 2,
        "Settings submenu adjoins global sidebar",
      );
      assert(
        report.content.left >= report.submenu.right,
        "Content does not overlap settings submenu",
      );
    }
    await page.screenshot({
      path: path.join(output, `pricing-${width}.png`),
      fullPage: false,
    });
    reports.push(report);
    if (
      !process.argv.includes("--skip-studio") &&
      [390, 768, 1280].includes(width)
    ) {
      if (width < 768) await toggle.click();
      await nav
        .getByRole("button", { name: "마이페이지", exact: true })
        .click();
      await page
        .getByRole("button", { name: "아바타 꾸미기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "남성 아바타", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector(".avatar-studio-camera button")?.disabled ===
          false,
        undefined,
        { timeout: 60000 },
      );
      assert.equal(
        await page.locator("canvas").count(),
        1,
        "Only the active studio owns a canvas",
      );
      await page.evaluate(() => window.scrollTo(0, 0));
      const studio = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        canvas: document
          .querySelector("canvas")
          .getBoundingClientRect()
          .toJSON(),
        content: document
          .querySelector("#teacher-settings-content")
          .getBoundingClientRect()
          .toJSON(),
      }));
      assert(
        studio.scrollWidth <= width,
        "Settings studio has no page overflow",
      );
      assert(
        studio.canvas.left >= studio.content.left &&
          studio.canvas.right <= studio.content.right,
        "Canvas fits real settings content",
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
          ),
      );
      await page.screenshot({
        path: path.join(output, `studio-${width}.png`),
        fullPage: false,
      });
      if (width === 390) {
        await page.locator(".avatar-studio-picker").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(output, `studio-items-${width}.png`),
          fullPage: false,
        });
      }
      await page
        .getByRole("button", { name: "프로필 이모지", exact: true })
        .click();
      assert.equal(
        await page.locator("canvas").count(),
        0,
        "Hidden avatar tab disposes canvas",
      );
      await page
        .getByRole("button", { name: "아바타 꾸미기", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector(".avatar-studio-camera button")?.disabled ===
          false,
        undefined,
        { timeout: 60000 },
      );
      if (width < 768) await toggle.click();
      await nav
        .getByRole("button", { name: "아바타 가격 관리", exact: true })
        .click();
      await page.locator(".avatar-pricing-item").first().waitFor();
      assert.equal(
        await page.locator("canvas").count(),
        0,
        "Switching settings disposes the previous stage",
      );
      report.studio = studio;
      report.rendererErrors = rendererErrors;
      assert.deepEqual(rendererErrors, [], "Renderer reports no shader errors");
      assert.deepEqual(
        await page.evaluate(() => window.avatarPricingQa.errors),
        [],
      );
    }
    await page.close();
  }
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify({ passed: true, reports }, null, 2),
  );
  console.log(
    `PASS settings navigation and avatar pricing: ${reports.length} widths, local filters, invalid/empty prices, explicit save, busy lock, failed reload, CAS draft preservation${process.argv.includes("--skip-studio") ? "" : ", hidden stage disposal"}${process.argv.includes("--require-previews") ? ", real static previews" : ""}.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
