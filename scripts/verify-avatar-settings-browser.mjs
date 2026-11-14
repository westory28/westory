/** Local-only real avatar shop management + wardrobe regression fixture. No Firebase calls. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "functions/avatarCatalog.json"), "utf8"),
);
const labelFor = (value) =>
  catalog.items.find((item) => item.value === value).label;
const genderFor = (item) =>
  item.gender || (item.characters.length === 1 ? item.characters[0] : "unisex");
const longNames = Object.fromEntries(
  catalog.items
    .filter((item) => item.slot === "top")
    .slice(-5)
    .map((item, index) => [
      item.id,
      {
        label:
          `${index + 1}번째 긴 이름 검증 상품 ${"봄날의 다채로운 우리 옷 ".repeat(5)}`.slice(
            0,
            60,
          ),
        gender: genderFor(item),
        description: "긴 상품명 표시 검증",
      },
    ]),
);
const output = path.resolve(
  process.env.AVATAR_SETTINGS_EVIDENCE ||
    path.join(root, "output/avatar-polish-20261114/admin"),
);
await fs.mkdir(output, { recursive: true });
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import MainLayout from './src/components/layout/MainLayout';
import TeacherAvatarShopPage from './src/pages/teacher/components/points/TeacherAvatarShopPage';
import SettingsMyPage from './src/pages/teacher/components/SettingsMyPage';
import {AVATAR_ITEMS,defaultAvatarLook} from './src/features/avatar/catalog';
const qa=window.avatarPricingQa={reads:0,saves:[],revision:4,failLoad:false,conflict:false,deferred:false,errors:[],toasts:[],metadata:{},prices:Object.fromEntries(AVATAR_ITEMS.map(i=>[i.id,i.price]))};
qa.metadata=${JSON.stringify(longNames)};
qa.prices['minimi-top-knit-cream']=0;qa.prices['minimi-top-school-white']=999;qa.prices['minimi-top-school-hoodie']=999;
qa.avatar={schemaVersion:1,catalogVersion:2,look:defaultAvatarLook('boy'),revision:1,lookHash:'fixture',ownedItemIds:[],thumbnailUrl:''};
window.addEventListener('error',e=>qa.errors.push(e.message));
window.addEventListener('unhandledrejection',e=>qa.errors.push(String(e.reason)));
qa.load=async()=>{qa.reads++;if(qa.failLoad)throw Error('가격표를 불러오지 못했습니다. 다시 불러와 주세요.');return{revision:qa.revision,prices:{...qa.prices},metadata:{...qa.metadata}}};
qa.save=async input=>{qa.saves.push(structuredClone(input));if(qa.conflict){qa.conflict=false;qa.revision++;throw Object.assign(Error('다른 관리자가 변경했습니다. 입력 내용은 유지했습니다. 확인 후 다시 저장해 주세요.'),{details:{pricing:{revision:qa.revision,prices:{...qa.prices},metadata:{...qa.metadata}}}})}if(input.expectedRevision!==qa.revision)throw Error('revision mismatch');if(qa.deferred)await new Promise(resolve=>qa.release=resolve);qa.prices={...qa.prices,...input.prices};qa.metadata={...qa.metadata,...input.metadata};qa.revision++;return{revision:qa.revision,prices:{...qa.prices},metadata:{...qa.metadata}}};
function App(){const[mode,setMode]=useState('normal'),[view,setView]=useState('shop');qa.setView=setView;return <><div className="qa-controls"><button onClick={()=>{qa.conflict=!qa.conflict;setMode(qa.conflict?'conflict':'normal')}}>동시 수정 오류</button><button onClick={()=>{qa.failLoad=!qa.failLoad;setMode(qa.failLoad?'load-error':'normal')}}>조회 오류</button><button onClick={()=>{qa.deferred=!qa.deferred;setMode(qa.deferred?'delayed':'normal')}}>저장 지연</button><button onClick={()=>qa.release?.()}>저장 응답</button><output>{mode}</output></div><MainLayout>{view==='shop'?<TeacherAvatarShopPage/>:<div className="ws-page" id="qa-studio-content"><SettingsMyPage/></div>}</MainLayout></>}
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/teacher/points?tab=products&shop=avatar']}><App/></MemoryRouter>);
`;
const mockSections =
  /\/(SettingsGeneral|SettingsSchool|SettingsInterface|SettingsPrivacy|SettingsAccess|SettingsNotifications|SettingsSemesterArchive)$/;
const shellMocks = {
  Header: `import React from 'react';import TeacherSidebar from './src/components/layout/TeacherSidebar';const groups=[{id:'lesson',name:'학습 자료 관리',icon:'lesson',children:[{name:'수업 자료',resolvedUrl:'/teacher/lesson'}]},{id:'quiz',name:'평가 관리',icon:'quiz',children:[]},{id:'points',name:'위스 관리',icon:'wis',children:[]}];export default function Header({sidebarCollapsed,onToggleSidebar}){return <><TeacherSidebar groups={groups} home="/teacher/dashboard" semesterLabel="2026학년도 2학기" showDashboard showSettings collapsed={sidebarCollapsed} mobileOpen={false} onToggleCollapsed={onToggleSidebar} onCloseMobile={()=>{}} isChildActive={()=>false}/><header className="teacher-account-header"><div className="header-container">검증 교사</div></header></>}`,
  AppToastProvider: `export const useAppToast=()=>({showToast:value=>{window.avatarPricingQa.toasts.push(value)}});`,
  safeStorage: `export const readStorage=()=>null;`,
  loginPerf: `export const markLoginPerf=()=>{},measureLoginPerf=()=>{};`,
  browserTasks: `export const runAfterNextPaint=callback=>{callback();return()=>{}};`,
  semesterArchive: `export const isSemesterArchive=false,archiveScope=null;`,
  SemesterArchiveBoundary: `export const SemesterArchiveBanner=()=>null,SemesterArchiveUnavailable=()=>null,isArchiveUnavailableRoute=()=>false;`,
  studentMenuAccess: `export const getStudentRouteAccess=()=>({allowed:true}),isStudentVisibilityControlledPath=()=>false;`,
  AuthRecoveryState: `export default ()=>null;`,
  weplayPreload: `export const preloadStudentWeplay=()=>{};`,
  gongsinmoongo: `export const useGongsinAvailability=()=>({loaded:true,error:false,enabled:false,avatarEventEnabled:false});export const getGongsinmoongo=()=>{throw Error('Unexpected event read')},manageGongsinmoongo=()=>{throw Error('Unexpected event write')},newGongsinRequestId=()=>crypto.randomUUID();`,
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
              /\/(Header|AppToastProvider|safeStorage|loginPerf|browserTasks|semesterArchive|SemesterArchiveBoundary|studentMenuAccess|AuthRecoveryState|weplayPreload|gongsinmoongo)$/,
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
          contents: `export const avatarErrorMessage=e=>e.message,avatarPricingFromError=e=>e.details?.pricing||null;export const getAvatarCatalogPricing=()=>window.avatarPricingQa.load();export const updateAvatarCatalogPricing=x=>window.avatarPricingQa.save(x);export const getTeacherMyPage=async()=>{const qa=window.avatarPricingQa;qa.teacherReads=(qa.teacherReads||0)+1;return{avatar:qa.avatar,pricing:{revision:qa.revision,prices:{...qa.prices},metadata:{...qa.metadata}},profileEmojiId:'sun',profileIcon:'☀️',emojiRegistry:[{id:'sun',emoji:'☀️',label:'햇살'}],allAvailable:true}};export const saveTeacherAvatar=async()=>{throw Error('Unexpected avatar write')},updateTeacherProfileIcon=async()=>{throw Error('Unexpected emoji write')},makeAvatarThumbnail=()=>'',getAvatarStudioState=async()=>{throw Error('Unexpected student read')},purchaseAvatarItem=async()=>{throw Error('Unexpected purchase')},saveStudentAvatar=async()=>{throw Error('Unexpected student write')};`,
          loader: "js",
        }));
        plugin.onResolve({ filter: /\/permissions$/ }, (args) => ({
          path: args.path,
          namespace: "permission",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "permission" }, () => ({
          contents: `export const isAdminUser=()=>true,canManageSettings=()=>true,canAccessTeacherPortal=()=>true,canAccessTeacherPath=()=>true,getDefaultTeacherRoute=()=>'/teacher/dashboard';`,
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
    await page.locator(".avatar-pricing-item").first().waitFor();
    await page
      .getByRole("navigation", { name: "위스 상점 상품 종류" })
      .getByRole("link", { name: "아바타 아이템 관리", exact: true })
      .waitFor();
    const before = await page.evaluate(() => window.avatarPricingQa.reads);
    const itemCard = (id) => page.locator(`[data-item-id="${id}"]`);
    const knit = itemCard("minimi-top-knit-cream"),
      school = itemCard("minimi-top-school-white");
    const editor = page.getByRole("dialog", {
      name: "아이템 수정",
      exact: true,
    });
    const closeEditor = async () => {
      await editor
        .getByRole("button", { name: "아이템 수정 닫기", exact: true })
        .click();
      await editor.waitFor({ state: "hidden" });
    };
    assert.equal(
      await page
        .getByRole("button", { name: "학생 미리보기", exact: true })
        .count(),
      1,
      "One page-level shop preview",
    );
    assert.equal(
      await knit
        .getByRole("button", { name: "학생 미리보기", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await knit
        .getByRole("button", { name: "저장", exact: true })
        .isDisabled(),
      true,
    );
    await school.locator(".avatar-pricing-edit").click();
    assert.equal(
      await editor
        .getByLabel(labelFor("mm-school-white") + " 무료·유료", { exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await editor
        .getByLabel(labelFor("mm-school-white") + " 위스 가격", { exact: true })
        .isDisabled(),
      true,
    );
    await closeEditor();
    assert.equal(
      await school
        .locator(".avatar-pricing-edit")
        .evaluate((el) => el === document.activeElement),
      true,
      "Editor restores focus",
    );
    const genderFilter = page.getByRole("group", { name: "성별", exact: true });
    const saleFilter = page.getByRole("group", {
      name: "판매 방식",
      exact: true,
    });
    for (const [sale, saleLabel] of [
      ["paid", "유료"],
      ["free", "무료"],
      ["all", "전체"],
    ]) {
      await saleFilter
        .getByRole("button", { name: saleLabel, exact: true })
        .click();
      for (const [gender, genderLabel] of [
        ["boy", "남자"],
        ["girl", "여자"],
        ["unisex", "공용"],
        ["all", "성별 전체"],
      ]) {
        await genderFilter
          .getByRole("button", { name: genderLabel, exact: true })
          .click();
        const ids = await page
          .locator(".avatar-pricing-item")
          .evaluateAll((elements) =>
            elements.map((element) => element.dataset.itemId).sort(),
          );
        const expected = catalog.items
          .filter(
            (item) =>
              item.slot === "top" &&
              (sale === "all" ||
                (sale === "paid" ? item.price > 0 : item.price === 0)) &&
              (gender === "all" || genderFor(item) === gender),
          )
          .map((item) => item.id)
          .sort();
        assert.deepEqual(
          ids,
          expected,
          `Local ${sale}/${gender} filters match saved catalog`,
        );
      }
    }
    assert.equal(
      await page.evaluate(() => window.avatarPricingQa.reads),
      before,
      "All paid/free and gender combinations add zero reads",
    );
    assert.equal(
      await page.evaluate(() => window.avatarPricingQa.saves.length),
      0,
      "Filters add zero writes",
    );
    const badgeTargets = await page
      .locator(".avatar-pricing-filter button")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        }),
      );
    assert(
      badgeTargets.every((bounds) => bounds.width >= 44 && bounds.height >= 44),
      "Badge hit targets are at least 44px",
    );
    await page.getByLabel("꾸미기 종류", { exact: true }).selectOption("all");
    const allKindsBounds = await page
      .locator(".avatar-pricing-item")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        }),
      );
    assert.equal(allKindsBounds.length, catalog.items.length);
    for (const dimension of ["width", "height"])
      assert(
        Math.max(...allKindsBounds.map((bounds) => bounds[dimension])) -
          Math.min(...allKindsBounds.map((bounds) => bounds[dimension])) <
          1,
        `Every catalog category keeps the same card ${dimension}`,
      );
    await page.getByLabel("꾸미기 종류", { exact: true }).selectOption("top");
    assert.equal(
      await page.evaluate(() => window.avatarPricingQa.reads),
      before,
      "Category filters add zero reads",
    );
    assert.equal(
      await page.evaluate(() => window.avatarPricingQa.saves.length),
      0,
      "Category filters add zero writes",
    );
    await page.getByLabel("아이템 검색", { exact: true }).fill("없는상품검증");
    assert.equal(await page.locator(".avatar-pricing-item").count(), 0);
    await page.getByText("해당하는 아이템이 없습니다.").waitFor();
    await page.getByLabel("아이템 검색", { exact: true }).fill("");
    await knit.locator(".avatar-pricing-edit").click();
    const originalName = labelFor("mm-knit-cream"),
      price = editor.getByLabel(originalName + " 위스 가격", { exact: true });
    await price.fill("");
    assert.equal(await price.getAttribute("aria-invalid"), "true");
    await price.fill("1000001");
    assert.equal(await price.getAttribute("aria-invalid"), "true");
    await price.fill("750");
    await editor.getByLabel(originalName + " 이름", { exact: true }).fill("");
    await editor.getByRole("alert").filter({ hasText: "이름은" }).waitFor();
    await editor
      .getByLabel(originalName + " 이름", { exact: true })
      .fill("구름 크림 니트");
    await editor
      .getByLabel(originalName + " 성별", { exact: true })
      .selectOption("boy");
    await editor
      .getByLabel(originalName + " 설명", { exact: true })
      .fill("포근한 짜임의 긴소매 니트입니다.");
    const editorLayout = await editor.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      image: el
        .querySelector(".avatar-pricing-editor-image")
        .getBoundingClientRect()
        .toJSON(),
      name: el.querySelector("input").getBoundingClientRect().toJSON(),
      options: [
        ...el.querySelectorAll(".avatar-pricing-editor-options label"),
      ].map((e) => e.getBoundingClientRect().toJSON()),
      description: el
        .querySelector("textarea")
        .getBoundingClientRect()
        .toJSON(),
    }));
    assert(
      editorLayout.scrollWidth <= editorLayout.clientWidth,
      "Editor has no horizontal overflow",
    );
    if (width >= 768) {
      assert(
        editorLayout.image.right < editorLayout.name.left,
        "Large image left of form",
      );
      assert(
        Math.max(...editorLayout.options.map((e) => e.top)) -
          Math.min(...editorLayout.options.map((e) => e.top)) <
          2,
        "Gender, sales type, price share second row",
      );
      assert(
        editorLayout.name.bottom < editorLayout.options[0].top &&
          editorLayout.options[0].bottom < editorLayout.description.top,
      );
    }
    await page.screenshot({ path: path.join(output, `editor-${width}.png`) });
    await closeEditor();
    assert.equal(
      await page.evaluate(() => window.avatarPricingQa.saves.length),
      0,
      "Closing editor does not save",
    );
    await school.locator(".avatar-pricing-edit").click();
    await editor
      .getByLabel(labelFor("mm-school-white") + " 설명", { exact: true })
      .fill("다른 아이템의 저장 전 설명");
    await closeEditor();
    assert.equal(
      await page.evaluate(() => window.avatarPricingQa.reads),
      before,
      "Editing and filtering do not fetch",
    );
    const previewButton = page.getByRole("button", {
      name: "학생 미리보기",
      exact: true,
    });
    await previewButton.click();
    const dialog = page.getByRole("dialog", {
      name: "학생 미리보기",
      exact: true,
    });
    await dialog
      .getByRole("heading", { name: "아바타 상점", exact: true })
      .waitFor();
    assert(
      (await dialog.locator(".avatar-shop-item").count()) > 1,
      "Preview is the whole shop, not one card",
    );
    await dialog.getByText("저장 전 변경 사항 포함", { exact: true }).waitFor();
    await dialog
      .getByRole("button", { name: "남학생 아바타", exact: true })
      .click();
    await dialog.getByRole("button", { name: "상의", exact: true }).click();
    await dialog
      .getByRole("group", { name: "아이템 성별", exact: true })
      .getByRole("button", { name: "성별 전체", exact: true })
      .click();
    await page.screenshot({
      path: path.join(output, `preview-all-${width}.png`),
    });
    const previewSearch = dialog.getByLabel("아이템 검색", { exact: true });
    if (!(await previewSearch.isVisible()))
      await dialog
        .getByRole("button", { name: "아이템 검색 열기", exact: true })
        .click();
    await previewSearch.fill("구름 크림");
    const previewCard = dialog
      .locator(".avatar-shop-item")
      .filter({ hasText: "구름 크림 니트" });
    await previewCard.click();
    assert.equal(await previewCard.getAttribute("aria-pressed"), "true");
    assert.equal(await dialog.locator(".avatar-shop-item-details").count(), 0);
    const buy = dialog.locator(".avatar-studio-preview").getByRole("button", {
      name: "750 위스로 구매",
      exact: true,
    });
    assert.equal(await buy.isDisabled(), true, "Preview cannot purchase");
    assert.equal(
      await dialog
        .getByRole("button", { name: "아바타 저장", exact: true })
        .count(),
      0,
      "Preview has no avatar save",
    );
    assert.equal(
      await page.evaluate(() => window.avatarPricingQa.saves.length),
      0,
    );
    assert.equal(
      await page.evaluate(() => window.avatarPricingQa.reads),
      before,
      "Whole preview does not query the server",
    );
    const dialogSize = await dialog.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    assert(
      dialogSize.scroll <= dialogSize.client,
      "Preview has no horizontal overflow",
    );
    await page.screenshot({ path: path.join(output, `preview-${width}.png`) });
    await dialog
      .getByRole("button", { name: "학생 미리보기 닫기", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      await previewButton.evaluate((el) => el === document.activeElement),
      true,
      "Preview restores focus",
    );
    assert.equal(
      await page.locator("canvas").count(),
      0,
      "Closing shop preview disposes the canvas",
    );
    await page
      .getByRole("button", { name: "동시 수정 오류", exact: true })
      .click();
    await knit.getByRole("button", { name: "저장", exact: true }).click();
    await knit.getByRole("alert").filter({ hasText: "다른 관리자" }).waitFor();
    const errorHeights = await page
      .locator(".avatar-pricing-item")
      .evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height),
      );
    assert(
      Math.max(...errorHeights) - Math.min(...errorHeights) < 1,
      "Error recovery keeps card heights aligned across rows",
    );
    await knit.locator(".avatar-pricing-edit").click();
    assert.equal(await price.inputValue(), "750");
    await closeEditor();
    await knit.getByRole("button", { name: "저장", exact: true }).click();
    await page.waitForFunction(
      () => window.avatarPricingQa.toasts.length === 1,
    );
    const requests = await page.evaluate(() => window.avatarPricingQa.saves);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].expectedRevision, 4);
    assert.equal(requests[1].expectedRevision, 5);
    assert.deepEqual(Object.keys(requests[1].prices), [
      "minimi-top-knit-cream",
    ]);
    assert.deepEqual(Object.keys(requests[1].metadata), [
      "minimi-top-knit-cream",
    ]);
    assert.deepEqual(requests[1].metadata["minimi-top-knit-cream"], {
      label: "구름 크림 니트",
      gender: "boy",
      description: "포근한 짜임의 긴소매 니트입니다.",
    });
    assert.equal(
      await knit
        .getByRole("button", { name: "저장", exact: true })
        .isDisabled(),
      true,
    );
    await school.locator(".avatar-pricing-edit").click();
    assert.equal(
      await editor
        .getByLabel(labelFor("mm-school-white") + " 설명", { exact: true })
        .inputValue(),
      "다른 아이템의 저장 전 설명",
    );
    await closeEditor();
    await page.getByLabel("변경한 항목만", { exact: true }).check();
    assert.equal(await page.locator(".avatar-pricing-item").count(), 1);
    await page.getByLabel("변경한 항목만", { exact: true }).uncheck();
    if (width === 1280) {
      await knit.locator(".avatar-pricing-edit").click();
      await editor
        .getByLabel("구름 크림 니트 위스 가격", { exact: true })
        .fill("800");
      await closeEditor();
      await page
        .getByRole("button", { name: "저장 지연", exact: true })
        .click();
      await knit.getByRole("button", { name: "저장", exact: true }).click();
      assert.equal(
        await knit.locator(".avatar-pricing-edit").isDisabled(),
        true,
      );
      assert.equal(
        await school
          .getByRole("button", { name: "저장", exact: true })
          .isDisabled(),
        true,
      );
      await page
        .getByRole("button", { name: "저장 응답", exact: true })
        .click();
      await page.waitForFunction(
        () => window.avatarPricingQa.toasts.length === 2,
      );
      await page
        .getByRole("button", { name: "조회 오류", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "저장된 아이템 다시 불러오기",
          exact: true,
        })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "불러오지 못했습니다" })
        .waitFor();
      assert.match(
        await knit.locator(".avatar-pricing-current").innerText(),
        /800/,
      );
      await page
        .getByRole("button", { name: "조회 오류", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "저장된 아이템 다시 불러오기",
          exact: true,
        })
        .click();
      await page.waitForFunction(() => window.avatarPricingQa.reads === 3);
      await school.locator(".avatar-pricing-edit").click();
      assert.equal(
        await editor
          .getByLabel(labelFor("mm-school-white") + " 설명", { exact: true })
          .inputValue(),
        "다른 아이템의 저장 전 설명",
      );
      await closeEditor();
    }
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
      saves: window.avatarPricingQa.saves.length,
      sidebar: document
        .querySelector(".teacher-sidebar")
        ?.getBoundingClientRect()
        .toJSON(),
      submenu: document
        .querySelector(".teacher-settings-navigation")
        ?.getBoundingClientRect()
        .toJSON(),
      content: document
        .querySelector(".avatar-pricing")
        ?.getBoundingClientRect()
        .toJSON(),
      cards: [...document.querySelectorAll(".avatar-pricing-item")].map((el) =>
        el.getBoundingClientRect().toJSON(),
      ),
      titles: [...document.querySelectorAll(".avatar-pricing-item h4")].map(
        (element) => ({
          label: element.textContent,
          title: element.title,
          height: element.getBoundingClientRect().height,
          clipped: element.scrollHeight > element.clientHeight,
          clamp: getComputedStyle(element).webkitLineClamp,
        }),
      ),
      headerBackground: getComputedStyle(
        document.querySelector(".avatar-pricing .ws-page-header"),
      ).backgroundColor,
      previews: [
        ...document.querySelectorAll(".avatar-pricing-preview img"),
      ].map((i) => ({
        src: i.getAttribute("src"),
        loaded: i.complete && i.naturalWidth > 0,
        contained:
          i.getBoundingClientRect().height <=
          i.parentElement.getBoundingClientRect().height + 1,
      })),
    }));
    assert(report.scrollWidth <= width, "No page overflow");
    assert.equal(
      report.headerBackground,
      "rgba(0, 0, 0, 0)",
      "Title has transparent background",
    );
    assert.equal(report.canvas, 0);
    assert.deepEqual(report.errors, []);
    assert(
      Math.max(...report.cards.map((card) => card.width)) -
        Math.min(...report.cards.map((card) => card.width)) <
        1,
      "All card columns keep equal widths",
    );
    assert(
      Math.max(...report.cards.map((card) => card.height)) -
        Math.min(...report.cards.map((card) => card.height)) <
        1,
      "Cards have one height across every grid row, including long names and unsaved changes",
    );
    assert(
      report.titles.every(
        (title) =>
          title.height === 48 &&
          title.clamp === "2" &&
          title.label === title.title,
      ),
      "Every title reserves two lines and exposes the full name",
    );
    assert(
      report.titles.some((title) => title.label.length === 60 && title.clipped),
      "Long-name fixture actually exercises clipping",
    );
    if (width < 640)
      assert(
        Math.abs(report.cards[0].top - report.cards[1].top) < 2,
        "Two compact cards per mobile row",
      );
    if (width >= 1024)
      assert(
        report.content.left >= report.sidebar.right,
        "Management content fits beside main navigation",
      );
    if (process.argv.includes("--require-previews")) {
      assert.equal(report.previews.length, report.items);
      assert(report.previews.every((i) => i.loaded));
      assert(
        report.previews.every((i) => i.contained),
        "Preview image boxes fit the fixed-height item container without cropping",
      );
    }
    await page.screenshot({
      path: path.join(output, `pricing-${width}.png`),
      fullPage: false,
    });
    await itemCard(Object.keys(longNames)[0]).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(output, `long-names-${width}.png`),
    });
    reports.push(report);
    if (
      !process.argv.includes("--skip-studio") &&
      [390, 768, 1280].includes(width)
    ) {
      await page.evaluate(() => {
        const qa = window.avatarPricingQa;
        qa.avatar = {
          ...qa.avatar,
          requiresThumbnailRefresh: true,
          look: {
            ...qa.avatar.look,
            character: "girl",
            hairStyle: "mm-bob",
            top: "mm-knit-cream",
          },
        };
        qa.setView("wardrobe");
      });
      await page
        .getByRole("button", { name: "아바타 꾸미기", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("button", { name: "여성 아바타", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      await page.getByRole("button", { name: "상의", exact: true }).click();
      assert.equal(
        await page
          .locator(
            '.avatar-studio-item[aria-pressed="true"] .avatar-studio-item-name',
          )
          .textContent(),
        labelFor("mm-school-white"),
        "Initial teacher load repairs now-incompatible saved clothing using current metadata",
      );
      await page
        .getByRole("group", { name: "아이템 성별", exact: true })
        .getByRole("button", { name: "성별 전체", exact: true })
        .click();
      const teacherKnit = page.locator(
        '.avatar-studio-items button[title="구름 크림 니트"]',
      );
      assert.equal(
        await teacherKnit.isDisabled(),
        true,
        "Latest male-only classification blocks the female teacher avatar before any failed save",
      );
      await page
        .getByRole("button", { name: "남성 아바타", exact: true })
        .click();
      assert.equal(
        await teacherKnit.isEnabled(),
        true,
        "Male avatar can wear the current male-only item",
      );
      await teacherKnit.click();
      assert.equal(await teacherKnit.getAttribute("aria-pressed"), "true");
      assert.equal(
        await page.evaluate(() => window.avatarPricingQa.teacherReads),
        1,
        "Teacher inventory and current metadata arrive in one combined load",
      );
      await page.waitForFunction(
        () =>
          document.querySelector(".avatar-studio-save .avatar-primary")
            ?.disabled === false,
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
          .querySelector("#qa-studio-content")
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
          document.querySelector(".avatar-studio-save .avatar-primary")
            ?.disabled === false,
        undefined,
        { timeout: 60000 },
      );
      await page.evaluate(() => window.avatarPricingQa.setView("shop"));
      await page.locator(".avatar-pricing-item").first().waitFor();
      assert.equal(
        await page.locator("canvas").count(),
        0,
        "Switching settings disposes the previous stage",
      );
      report.studio = studio;
      report.teacherInitialMetadata = {
        combinedLoads: 1,
        repairedHistoricalGender: true,
        oppositeGenderBlocked: true,
      };
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
    `PASS avatar shop management: ${reports.length} widths, local filters, three-row editing dialog, item-only save, full student shop preview and focus, unchanged save disabled, busy lock, failed reload, CAS draft preservation${process.argv.includes("--skip-studio") ? "" : ", hidden stage disposal"}${process.argv.includes("--require-previews") ? ", real static previews" : ""}.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
