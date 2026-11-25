/** Real teacher route, unified Wis navigation and feature bodies; synthetic service adapters only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { reportServiceFixture } from "./verify-wis-stock-weekly-reports-browser.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const output = path.join(root, "output/wis-menu-integration-20261117");
await fs.mkdir(output, { recursive: true });
// Reuse the existing checked-in synthetic adapters, not their browser runners.
async function adapter(file, next) {
  const source = await fs.readFile(path.join(root, "scripts", file), "utf8");
  const literal = source.match(
    new RegExp("const service = (`[\\s\\S]*?`);\\r?\\nconst " + next),
  );
  assert(literal, `Synthetic adapter missing in ${file}`);
  return Function("root", "path", "reportServiceFixture", `return ${literal[1]}`)(root, path, reportServiceFixture);
}
const wallet =
  "import {cloneDefaultMenus} from './src/constants/menus';\n" +
  (await adapter("verify-wis-wallet-browser.mjs", "entry"))
    .replace(
      "config,configReady:true",
      "config,menuConfig:cloneDefaultMenus(),configReady:true",
    )
    .replace(
      "canManagePoints=()=>true",
      "canManagePoints=()=>!new URLSearchParams(location.search).has('readonly')",
    )
    .replace(
      "canManageSettings=()=>false,isAdminUser=()=>false",
      "canManageSettings=()=>!new URLSearchParams(location.search).has('readonly'),isAdminUser=()=>true",
    );
const stocks = (
  await adapter("verify-wis-stocks-browser.mjs", "bundle")
).replace(
  "qa.hidden=params.has('hidden');",
  "qa.failRead=params.has('error');qa.holdRead=params.has('loading');qa.hidden=params.has('hidden');",
);
const avatar = `
import {AVATAR_ITEMS} from './src/features/avatar/catalog';
export const avatarErrorMessage=e=>e.message,avatarPricingFromError=()=>null,avatarPurchaseTiersFromError=()=>null;
export const getAvatarCatalogPricing=async()=>{window.villageQa.avatarReads++;return{revision:1,prices:Object.fromEntries(AVATAR_ITEMS.map(item=>[item.id,item.price])),metadata:{}}};
const reject=async()=>{throw Error('Unexpected avatar write/read')};
export const updateAvatarCatalogPricing=reject,getTeacherMyPage=reject,saveTeacherAvatar=reject,updateTeacherProfileIcon=reject,makeAvatarThumbnail=()=>'',getAvatarStudioState=reject,purchaseAvatarItem=reject,saveStudentAvatar=reject;
`;
const board = `
export const watchWisStockExchange=()=>{throw Error("Unexpected exchange subscription")};
export const getWisStockInvestmentHistories=async()=>{throw Error('Unexpected investment history read')};
export const getWisStockRankTrace=async()=>{throw Error('Unexpected rank trace read')};
export const wisStockInvestmentHistoryError=error=>error.message;
export function watchWisStockInvestmentBoard(scope,onData,onConnection){
  window.villageQa.boardSubscriptions++;
  onConnection('CONNECTED');
  onData({status:'NOT_READY',semesterId:scope.year+'-'+scope.semester,grade:'',classNumber:'',revision:0,asOfMs:0,sourceRevision:0,priceRevision:0,classes:[],rows:[],totals:null});
  return()=>{window.villageQa.boardStops++};
}
`;
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';
import TeacherPointsRoute from './src/pages/teacher/ManagePoints';
import WisShopNavigation from './src/components/common/WisShopNavigation';
import TeacherSidebar from './src/components/layout/TeacherSidebar';
import {PortalWorkspaceFooterProvider,PortalFallbackFooter} from './src/components/common/PortalWorkspace';
import './src/assets/index.css';import './src/components/common/portalPage.css';import './src/components/layout/teacherLayout.css';import './src/pages/teacher/teacherSettings.css';
window.villageQa={avatarReads:0,boardSubscriptions:0,boardStops:0};
const params=new URLSearchParams(location.search),student=params.has('student');
const management={name:'위스 관리',resolvedUrl:'/teacher/points',children:[{name:'위스 현황',resolvedUrl:'/teacher/points'}]};
const groups=[{id:'quiz',name:'평가 관리',icon:'assessment',children:[],directUrl:'/teacher/quiz'},{id:'points',name:'위스',icon:'wis',children:[management,{name:'명예의 전당 관리',resolvedUrl:'/teacher/points?tab=hall-of-fame'},{name:'위스 상점',resolvedUrl:'/teacher/points?tab=products'},...(!params.has('readonly')?[{name:'아바타 상점',resolvedUrl:'/teacher/points?tab=products&shop=avatar'}]:[]),{name:'위스피(WsPI)',resolvedUrl:'/teacher/points?tab=stocks'}]}];
// Actual primary navigation/styles and workspace footer; the account header has no service reads.
function Shell(){const[collapsed,setCollapsed]=useState(params.has('collapsed'));const[mobileOpen,setMobileOpen]=useState(false);return <PortalWorkspaceFooterProvider><div className={'teacher-layout flex min-h-screen flex-col bg-gray-50'+(collapsed?' is-sidebar-collapsed':'')}><TeacherSidebar groups={groups} home='/teacher/dashboard' semesterLabel='2026학년도 2학기' showDashboard showSettings collapsed={collapsed} mobileOpen={mobileOpen} onToggleCollapsed={()=>setCollapsed(v=>!v)} onCloseMobile={()=>setMobileOpen(false)} isChildActive={url=>location.hash.slice(1)===url||(url==='/teacher/points?tab=products'&&location.hash.endsWith('?tab=requests'))}/><header className='teacher-header teacher-account-header'><div className='header-container'><button type='button' className='teacher-navigation-toggle' aria-label='메뉴 열기' onClick={()=>setMobileOpen(true)}>메뉴</button><div className='header-right'><span>검증 교사</span></div></div></header><main className='min-h-0 w-full flex-1' data-fixture-main><TeacherPointsRoute/></main><PortalFallbackFooter teacher/></div></PortalWorkspaceFooterProvider>}
createRoot(document.getElementById('root')).render(<HashRouter>{student?<main className="ws-page"><WisShopNavigation portal="student" active="products"/></main>:<Shell/>}</HashRouter>);
`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  outfile: "fixture.js",
  loader: { ".svg": "dataurl", ".webp": "dataurl" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "synthetic-services",
      setup(plugin) {
        plugin.onResolve({ filter: /lib\/weplayPreload$/ }, () => ({
          path: "preload",
          namespace: "fixture",
        }));
        plugin.onResolve(
          { filter: /lib\/wisStockExchangeDisplayClient$|lib\/wisStockInvestment(?:Board|History)Client$/ },
          () => ({ path: "board", namespace: "fixture" }),
        );
        plugin.onResolve({ filter: /lib\/wisStocksClient$/ }, () => ({
          path: "stocks",
          namespace: "fixture",
        }));
        plugin.onResolve(
          { filter: /lib\/wisStockListingSubscription$/ },
          () => ({
            path: "stocks",
            namespace: "fixture",
          }),
        );
        plugin.onResolve({ filter: /hooks\/useStudentWisStocks$/ }, () => ({
          path: "stock-status",
          namespace: "fixture",
        }));
        plugin.onResolve(
          { filter: /features\/avatar\/service$|^\.\/service$/ },
          (args) =>
            args.path.includes("avatar") || args.importer.includes("avatar")
              ? { path: "avatar", namespace: "fixture" }
              : null,
        );
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)contexts\/AuthContext$|(?:^|\/)(?:common\/)?AppToastProvider$|(?:^|\/)(?:common\/)?AppDialogProvider$|(?:^|\/)(?:lib\/)?(points|studentWis|pointEconomyAdapter|wisEconomyClient|firebase|sensitiveOperation|semesterArchive|pointShopArchive|permissions)$/,
          },
          () => ({ path: "wallet", namespace: "fixture" }),
        );
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)(PointPolicyTab|PointRanksTab|HallOfFameManagementTab)$/,
          },
          () => ({ path: "empty", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: {
            wallet,
            stocks,
            avatar,
            board,
            "stock-status":
              "export const useStudentWisStockStatus=()=>({status:'ready',data:{studentOpen:false},error:'',retry(){}});",
            preload: "export const preloadStudentWeplay=()=>{};",
            empty: "export default ()=>null",
          }[args.path],
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
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (/\.(svg|png|webp)$/.test(pathname)) {
    const local = path.resolve(
      root,
      "public",
      "." + decodeURIComponent(pathname),
    );
    if (local.startsWith(path.join(root, "public") + path.sep))
      try {
        res.setHeader(
          "Content-Type",
          pathname.endsWith("svg")
            ? "image/svg+xml"
            : pathname.endsWith("webp")
              ? "image/webp"
              : "image/png",
        );
        res.end(await fs.readFile(local));
        return;
      } catch {}
    res.writeHead(404);
    res.end();
    return;
  }
  const [type, data] = {
    "/qa.js": ["text/javascript", js],
    "/qa.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  }[pathname] || ["text/html", html];
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
  layouts = [],
  checks = [];
async function open(width, tab, extra = "", height = 960) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await page.goto(`${origin}/?teacher=1${extra}#/teacher/points?tab=${tab}`);
  return page;
}
const wisMenu = (page) => page.locator("#teacher-menu-points");
const shopLinks = (page) =>
  wisMenu(page).locator('a[href*="tab=products"],a[href*="tab=stocks"]');
const contentTitle = (page) => page.locator("[data-fixture-main] h1").first();
async function expandWis(page) {
  if (
    page.viewportSize().width < 1024 &&
    !(await page.locator(".teacher-sidebar").getAttribute("class")).includes(
      "is-mobile-open",
    )
  )
    await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  const toggle = page
    .locator(".teacher-sidebar")
    .getByRole("button", { name: "위스", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
}
async function closeMobile(page) {
  if (
    page.viewportSize().width < 1024 &&
    (await page.locator(".teacher-sidebar").getAttribute("class")).includes(
      "is-mobile-open",
    )
  )
    await page.getByRole("button", { name: "메뉴 닫기", exact: true }).click();
}
async function saveFailure(page, name) {
  await page.screenshot({
    path: path.join(output, `${name}-failure.png`),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(output, `${name}-failure.html`),
    await page.content(),
  );
}
try {
  const cases = [
    ...[320, 390, 768, 1024, 1280, 1440].map((width) => ({
      width,
      collapsed: false,
    })),
    ...[1024, 1280, 1440].map((width) => ({ width, collapsed: true })),
  ];
  for (const { width, collapsed } of cases)
    for (const tab of [
      "products",
      "requests",
      "stocks",
      "products&shop=avatar",
    ]) {
      const page = await open(width, tab, collapsed ? "&collapsed=1" : ""),
        kind = tab.includes("avatar") ? "avatar" : tab,
        name = `${width}-${collapsed ? "collapsed" : "expanded"}-${kind}`;
      try {
        await contentTitle(page).waitFor();
        if (kind === "stocks")
          await page
            .getByRole("button", { name: "종목 관리", exact: true })
            .waitFor();
        if (kind === "avatar")
          await page
            .locator(".avatar-pricing-categories button")
            .last()
            .waitFor();
        await page.evaluate(() => document.fonts.ready);
        const layout = await page.evaluate(() => {
          const nav = document.querySelector("#teacher-menu-points"),
            main = document.querySelector("[data-fixture-main]"),
            content = main.querySelector(".ws-page"),
            title = main.querySelector("h1"),
            primary = document.querySelector(".teacher-sidebar");
          const rect = (e) => {
            const r = e.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              right: r.right,
              bottom: r.bottom,
            };
          };
          return {
            nav: rect(nav),
            content: rect(content),
            title: rect(title),
            main: rect(main),
            primary: rect(primary),
            footerCount: document.querySelectorAll("footer").length,
            secondaryCount: document.querySelectorAll(
              ".wis-village-navigation,.wis-village-workspace",
            ).length,
            titleBackground: getComputedStyle(title.closest("header") || title)
              .backgroundColor,
            titleShadow: getComputedStyle(title.closest("header") || title)
              .boxShadow,
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            links: [
              ...nav.querySelectorAll(
                'a[href*="tab=products"],a[href*="tab=stocks"]',
              ),
            ].map((e) => ({
              name: e.getAttribute("aria-label") || e.textContent.trim(),
              active: e.getAttribute("aria-current"),
              ...rect(e),
            })),
            calls: window.wisWalletQa.calls,
            stockReads: window.stockQa?.reads || 0,
            avatarReads: window.villageQa.avatarReads,
            offenders: [...document.querySelectorAll("body *")]
              .filter(
                (e) =>
                  e.getBoundingClientRect().right > innerWidth + 1 &&
                  getComputedStyle(e).position !== "fixed",
              )
              .slice(0, 10)
              .map((e) => e.className),
          };
        });
        layouts.push({ width, collapsed, kind, ...layout });
        assert.equal(
          layout.secondaryCount,
          0,
          "No separate village rail remains",
        );
        assert.equal(layout.titleBackground, "rgba(0, 0, 0, 0)");
        assert.equal(layout.titleShadow, "none");
        assert.equal(layout.footerCount, 1, "Exactly one page footer");
        assert.equal(
          layout.overflow,
          false,
          `${name}: overflow ${JSON.stringify(layout.offenders)}`,
        );
        assert.equal(layout.main.x, width >= 1024 ? (collapsed ? 88 : 232) : 0);
        assert.equal(layout.main.right, width);
        assert.equal(
          layout.content.x,
          layout.main.x,
          "Content starts after only the primary sidebar",
        );
        assert.equal(
          layout.content.width,
          layout.main.width,
          "Content uses the available main width",
        );
        assert(
          layout.title.x >= layout.main.x &&
            layout.title.x < layout.main.x + 64,
        );
        assert.deepEqual(
          layout.links.map((link) => link.name),
          ["위스 상점", "아바타 상점", "위스피(WsPI)"],
        );
        assert.equal(
          layout.links.filter((link) => link.active === "page").length,
          1,
        );
        assert.equal(
          layout.links.find((link) => link.active === "page").name,
          kind === "stocks"
            ? "위스피(WsPI)"
            : kind === "avatar"
              ? "아바타 상점"
              : "위스 상점",
        );
        assert.deepEqual(
          layout.calls.map((call) => call.kind),
          kind === "products"
            ? ["products"]
            : kind === "requests"
              ? ["orders"]
              : [],
        );
        assert.equal(layout.stockReads, kind === "stocks" ? 1 : 0);
        assert.equal(layout.avatarReads, kind === "avatar" ? 1 : 0);
        assert.equal(
          await page.evaluate(
            () =>
              window.wisWalletQa.grantCount +
              window.stockQa.saves +
              window.stockQa.ruleSaves +
              window.stockQa.emergencySaves,
          ),
          0,
        );
        assert.equal(
          await page.evaluate(() => window.villageQa.boardSubscriptions),
          0,
        );
        await expandWis(page);
        await shopLinks(page).first().focus();
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() => document.activeElement?.textContent.trim()),
          "아바타 상점",
        );
        assert.equal(
          await shopLinks(page)
            .nth(1)
            .evaluate((e) => getComputedStyle(e).outlineStyle),
          "solid",
        );
        await closeMobile(page);
        if (kind === "avatar") {
          const categories = await page.evaluate(() => {
            const category = document.querySelector(
                ".avatar-pricing-categories",
              ),
              filter = document.querySelector(".avatar-pricing-filters"),
              search = document.querySelector(".avatar-pricing-search"),
              input = search.querySelector("input");
            const rect = (e) => {
              const r = e.getBoundingClientRect();
              return {
                x: r.x,
                y: r.y,
                right: r.right,
                bottom: r.bottom,
                width: r.width,
                height: r.height,
              };
            };
            return {
              category: rect(category),
              filter: rect(filter),
              search: rect(search),
              input: rect(input),
              scrollWidth: category.scrollWidth,
              clientWidth: category.clientWidth,
              overflowX: getComputedStyle(category).overflowX,
              flexWrap: getComputedStyle(category).flexWrap,
              buttons: [...category.querySelectorAll("button")].map((e) => ({
                name: e.textContent.trim(),
                ...rect(e),
              })),
            };
          });
          layouts.push({
            width,
            collapsed,
            kind: "avatar-categories",
            ...categories,
          });
          assert.deepEqual(
            categories.buttons.map((button) => button.name),
            [
              "전체 종류",
              "캐릭터",
              "헤어",
              "표정",
              "피부",
              "상의",
              "하의",
              "신발",
              "장식",
              "염색",
              "얼굴형",
              "포즈",
            ],
          );
          assert(
            categories.scrollWidth <= categories.clientWidth,
            "Categories must never need horizontal scrolling",
          );
          assert(!["auto", "scroll"].includes(categories.overflowX));
          assert(
            categories.buttons.every(
              (b) =>
                b.x >= categories.category.x - 1 &&
                b.right <= categories.category.right + 1 &&
                b.y >= categories.category.y - 1 &&
                b.bottom <= categories.category.bottom + 1,
            ),
            "All 12 existing category buttons remain inside the wrapping container",
          );
          assert(
            categories.search.x >= categories.filter.x - 1 &&
              categories.search.right <= categories.filter.right + 1,
          );
          assert(categories.input.width <= categories.search.width + 1);
          assert(
            categories.search.x >= categories.category.right - 1 ||
              categories.search.y >= categories.category.bottom - 1 ||
              categories.category.y >= categories.search.bottom - 1,
            "Search and category regions must not overlap",
          );
          assert.equal(categories.flexWrap, "wrap");
          if (
            categories.buttons.reduce((sum, button) => sum + button.width, 0) +
              4 * (categories.buttons.length - 1) >
            categories.category.width + 1
          ) {
            assert(
              new Set(categories.buttons.map((button) => button.y)).size > 1,
              "Categories wrap when one row cannot contain all labels",
            );
          }
          await page
            .locator(".avatar-pricing-categories button")
            .last()
            .click();
          assert.equal(
            await page
              .locator(".avatar-pricing-categories button")
              .last()
              .getAttribute("aria-pressed"),
            "true",
          );
          assert.equal(
            await page
              .locator(".avatar-pricing-categories")
              .evaluate((e) => e.scrollLeft),
            0,
          );
          await page
            .locator(".avatar-pricing-categories button")
            .first()
            .click();
          await page
            .locator(".avatar-pricing-search input")
            .fill("없는 합성 아이템");
          await page.locator(".avatar-pricing-search input").fill("");
          assert.equal(
            await page.evaluate(() => window.villageQa.avatarReads),
            1,
          );
          await page.evaluate(() => scrollTo(0, 0));
        }
        await page.screenshot({
          path: path.join(output, `${name}.png`),
          fullPage: false,
        });
        if (kind === "stocks") {
          const before = await contentTitle(page).boundingBox();
          await page
            .getByRole("button", { name: "학생 투자 현황", exact: true })
            .click();
          await page
            .getByText("아직 집계된 투자 현황이 없습니다.", {
              exact: true,
            })
            .waitFor();
          assert.equal(
            await page.evaluate(() => window.villageQa.boardSubscriptions),
            1,
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
            false,
          );
          assert.equal((await contentTitle(page).boundingBox()).y, before.y);
          await page.screenshot({
            path: path.join(output, `${name}-investment.png`),
            fullPage: false,
          });
          await page
            .getByRole("button", { name: "종목 관리", exact: true })
            .click();
          assert.equal(
            await page.evaluate(() => window.villageQa.boardStops),
            1,
          );
          assert.equal(await page.evaluate(() => window.stockQa.reads), 1);
        }
      } catch (error) {
        await saveFailure(page, name);
        throw error;
      } finally {
        await page.close();
      }
    }
  checks.push(
    "36 real route layouts: 320/390/768/1024/1280/1440 and 1024/1280/1440 collapsed primary; single 232px/88px primary sidebar, no village rail, full-width main content, transparent headings, one footer, keyboard-accessible shop links and no page overflow.",
  );
  checks.push(
    "Nine avatar layouts: all 12 existing category buttons wrap within their container, no horizontal scrolling or clipped items, search region fits and does not overlap, last category and search work locally without extra reads.",
  );
  {
    const page = await open(390, "requests");
    await contentTitle(page).waitFor();
    for (const [link, title] of [
      ["아바타 상점", "아바타 상점"],
      ["위스피(WsPI)", "위스피(WsPI)"],
      ["위스 상점", "위스 상점"],
    ]) {
      await expandWis(page);
      await wisMenu(page)
        .getByRole("link", { name: link, exact: true })
        .click();
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
    }
    await page.close();
  }
  {
    const page = await open(390, "overview");
    await page.getByText("충무공 도전 비용", { exact: true }).waitFor();
    assert.equal(
      await page
        .locator(".wis-village-workspace,.wis-village-navigation")
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () => window.stockQa.reads + window.villageQa.avatarReads,
      ),
      0,
    );
    await page.close();
  }
  {
    const page = await open(390, "products&shop=avatar", "&readonly=1");
    await page.getByRole("alert").waitFor();
    await expandWis(page);
    assert.equal(
      await wisMenu(page)
        .getByRole("link", { name: "아바타 상점", exact: true })
        .count(),
      0,
    );
    assert.equal(await page.evaluate(() => window.villageQa.avatarReads), 0);
    await page.close();
  }
  for (const width of [320, 1440]) {
    const page = await open(width, "products", "&student=1");
    await page.getByRole("navigation", { name: "위스", exact: true }).waitFor();
    assert.equal(await page.locator(".wis-village-navigation").count(), 0);
    assert.equal(
      await page
        .getByRole("link", { name: "위스피(WsPI)", exact: true })
        .count(),
      0,
    );
    assert.equal(await page.locator("nav.ws-page-tabs a").count(), 2);
    assert.equal(
      await page
        .locator("nav.ws-page-tabs")
        .evaluate((e) => getComputedStyle(e).flexDirection),
      "row",
    );
    await page.close();
  }
  checks.push(
    "Real destination changes, ordinary Wis management without a separate rail, denied avatar access with zero reads, and unchanged two-tab student navigation with WsPI closed.",
  );
  for (const state of ["loading", "error"]) {
    const page = await open(320, "stocks", `&${state}=1`);
    await (
      state === "loading"
        ? page.locator(".wis-stocks").getByRole("status", { name: "처리 중" })
        : page.getByRole("alert")
    ).waitFor();
    assert.equal(await shopLinks(page).count(), 3);
    const before = await contentTitle(page).boundingBox();
    if (state === "loading")
      await page.evaluate(() => window.stockQa.release());
    else {
      await page.evaluate(() => (window.stockQa.failRead = false));
      await page
        .getByRole("button", { name: "다시 불러오기", exact: true })
        .click();
    }
    await page.getByRole("button", { name: /합성 역사 종목/ }).waitFor();
    assert.equal((await contentTitle(page).boundingBox()).y, before.y);
    await page.close();
  }
  {
    const page = await open(1280, "stocks");
    await contentTitle(page).waitFor();
    const main = page.locator("[data-fixture-main]");
    const initial = await main.boundingBox();
    await page.locator(".teacher-sidebar-collapse").click();
    assert.equal((await main.boundingBox()).x, 88);
    assert.equal((await main.boundingBox()).width, 1280 - 88);
    await page.locator(".teacher-sidebar-collapse").click();
    assert.equal((await main.boundingBox()).x, initial.x);
    assert.equal(await page.locator(".wis-village-navigation").count(), 0);
    assert.equal(
      await wisMenu(page)
        .getByRole("link", { name: "위스피(WsPI)", exact: true })
        .getAttribute("aria-current"),
      "page",
    );
    await page.screenshot({
      path: path.join(output, "1280-primary-expanded.png"),
    });
    assert.equal(await page.evaluate(() => window.stockQa.reads), 1);
    await page.close();
  }
  checks.push(
    "Loading/error/retry retain content title position; actual primary-sidebar collapse/expand preserves the selected destination without additional service reads; all scenarios perform zero writes.",
  );
  for (const [width, height] of [
    [1920, 900],
    [390, 844],
  ]) {
    const page = await open(width, "products&shop=avatar", "", height);
    await page.locator(".avatar-pricing-categories button").last().waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    assert.equal(
      await page
        .locator(".avatar-pricing-categories")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
      true,
    );
    await page.screenshot({
      path: path.join(output, `avatar-${width}x${height}-viewport.png`),
      fullPage: false,
    });
    await page.close();
  }
  checks.push(
    "Assessment/settings CSS is also loaded; clean viewport-only avatar screenshots recorded at 1920×900 and 390×844 with all category choices inside a non-scrolling container.",
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, checks, errors }, null, 2));
} finally {
  await fs.writeFile(
    path.join(output, "summary.json"),
    JSON.stringify({ checks, errors, layouts }, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
