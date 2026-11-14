/** Real teacher route, village navigation and feature bodies; synthetic service adapters only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const output = path.join(root, "output/wispi-board-20261115/navigation");
await fs.mkdir(output, { recursive: true });
// Reuse the existing checked-in synthetic adapters, not their browser runners.
async function adapter(file, next) {
  const source = await fs.readFile(path.join(root, "scripts", file), "utf8");
  const literal = source.match(
    new RegExp("const service = (`[\\s\\S]*?`);\\r?\\nconst " + next),
  );
  assert(literal, `Synthetic adapter missing in ${file}`);
  return Function("root", "path", `return ${literal[1]}`)(root, path);
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
export const avatarErrorMessage=e=>e.message,avatarPricingFromError=()=>null;
export const getAvatarCatalogPricing=async()=>{window.villageQa.avatarReads++;return{revision:1,prices:Object.fromEntries(AVATAR_ITEMS.map(item=>[item.id,item.price])),metadata:{}}};
const reject=async()=>{throw Error('Unexpected avatar write/read')};
export const updateAvatarCatalogPricing=reject,getTeacherMyPage=reject,saveTeacherAvatar=reject,updateTeacherProfileIcon=reject,makeAvatarThumbnail=()=>'',getAvatarStudioState=reject,purchaseAvatarItem=reject,saveStudentAvatar=reject;
`;
const board = `
export function watchWisStockInvestmentBoard(scope,onData,onConnection){
  window.villageQa.boardSubscriptions++;
  onConnection('CONNECTED');
  onData({status:'NOT_READY',semesterId:scope.year+'-'+scope.semester,grade:'',classNumber:'',revision:0,asOfMs:0,sourceRevision:0,priceRevision:0,classes:[],rows:[],totals:null});
  return()=>{window.villageQa.boardStops++};
}
`;
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';
import TeacherPointsRoute from './src/pages/teacher/ManagePoints';
import WisShopNavigation from './src/components/common/WisShopNavigation';
import './src/assets/index.css';import './src/components/common/portalPage.css';
window.villageQa={avatarReads:0,boardSubscriptions:0,boardStops:0};
const student=new URLSearchParams(location.search).has('student');
createRoot(document.getElementById('root')).render(<HashRouter>{student?<main className="ws-page"><WisShopNavigation portal="student" active="products"/></main>:<TeacherPointsRoute/>}</HashRouter>);
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
        plugin.onResolve(
          { filter: /lib\/wisStockInvestmentBoardClient$/ },
          () => ({ path: "board", namespace: "fixture" }),
        );
        plugin.onResolve({ filter: /lib\/wisStocksClient$/ }, () => ({
          path: "stocks",
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
async function open(width, tab, extra = "") {
  const page = await browser.newPage({ viewport: { width, height: 960 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await page.goto(`${origin}/?teacher=1${extra}#/teacher/points?tab=${tab}`);
  return page;
}
try {
  for (const width of [320, 390, 768, 1280, 1440])
    for (const tab of [
      "products",
      "requests",
      "stocks",
      "products&shop=avatar",
    ]) {
      const page = await open(width, tab),
        kind = tab.includes("avatar") ? "avatar" : tab;
      try {
        await page.locator(".wis-village-rail").waitFor();
        await page.locator("h1").waitFor();
        if (kind === "stocks")
          await page
            .getByRole("button", { name: "종목 관리", exact: true })
            .waitFor();
        if (kind === "avatar")
          await page
            .getByRole("button", { name: "아바타 아이템 관리", exact: true })
            .waitFor();
        await page.evaluate(() => document.fonts.ready);
        const layout = await page.evaluate(() => {
          const nav = document.querySelector(".wis-village-rail"),
            content = document.querySelector(".wis-village-content"),
            title = content.querySelector("h1"),
            main = document.querySelector("main");
          const rect = (e) => {
            const r = e.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              right: r.right,
            };
          };
          return {
            nav: rect(nav),
            content: rect(content),
            title: rect(title),
            main: rect(main),
            background: getComputedStyle(nav).backgroundColor,
            shadow: getComputedStyle(nav).boxShadow,
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            links: [...nav.querySelectorAll("a")].map((e) => ({
              name: e.getAttribute("aria-label"),
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
              .slice(0, 8)
              .map((e) => e.className),
          };
        });
        layouts.push({ width, kind, ...layout });
        assert.equal(layout.nav.width, width < 768 ? 64 : 128);
        assert(
          layout.title.y <= layout.main.y + 25,
          `${width}/${kind}: title must begin at page top, allowing vertical alignment with its 44px action`,
        );
        assert(layout.content.x >= layout.nav.right + 7);
        assert.equal(layout.background, "rgba(0, 0, 0, 0)");
        assert.equal(layout.shadow, "none");
        assert.equal(
          layout.overflow,
          false,
          `${width}/${kind} overflow: ${JSON.stringify(layout.offenders)}`,
        );
        assert.deepEqual(
          layout.links.map((link) => link.name),
          ["위스 상점", "아바타 상점", "위스피(WsPI)"],
        );
        assert(
          layout.links.every((link) => link.height >= 44 && link.width >= 44),
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
        await page.locator(".wis-village-rail a").first().focus();
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() =>
            document.activeElement?.getAttribute("aria-label"),
          ),
          "아바타 상점",
        );
        assert.equal(
          await page
            .locator(".wis-village-rail a")
            .nth(1)
            .evaluate((e) => getComputedStyle(e).outlineStyle),
          "solid",
        );
        await page.screenshot({
          path: path.join(output, `${width}-${kind}.png`),
          fullPage: false,
        });
        if (kind === "stocks") {
          await page
            .getByRole("button", { name: "학생 투자 현황", exact: true })
            .click();
          await page
            .getByText("학생 투자 자료가 아직 연결되지 않았습니다.", {
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
            `${width}: board overflow inside rail`,
          );
          assert.equal(
            (await page.locator("h1").boundingBox()).y,
            layout.title.y,
          );
          await page.screenshot({
            path: path.join(output, `${width}-investment-board.png`),
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
        await page.screenshot({
          path: path.join(output, "failure.png"),
          fullPage: true,
        });
        await fs.writeFile(
          path.join(output, "failure.html"),
          await page.content(),
        );
        throw error;
      } finally {
        await page.close();
      }
    }
  checks.push(
    "20 real page layouts: 320/390/768/1280/1440 × products/requests/WsPI/avatar, top title, 64/128px rail, no page overflow, keyboard focus, transparent surfaces, scoped reads. Five investment-tab layouts preserve title and unsubscribe on exit, with zero board subscriptions before selection.",
  );
  {
    const page = await open(390, "requests");
    await page.locator("h1").waitFor();
    await page.getByRole("link", { name: "아바타 상점", exact: true }).click();
    await page
      .getByRole("heading", { name: "아바타 상점", exact: true })
      .waitFor();
    await page.getByRole("link", { name: "위스피(WsPI)", exact: true }).click();
    await page
      .getByRole("heading", { name: "위스피(WsPI)", exact: true })
      .waitFor();
    await page.getByRole("link", { name: "위스 상점", exact: true }).click();
    await page
      .getByRole("heading", { name: "위스 상점", exact: true })
      .waitFor();
    await page.close();
  }
  {
    const page = await open(390, "overview");
    await page.getByText("충무공 도전 비용", { exact: true }).waitFor();
    assert.equal(
      await page.locator(".wis-village-workspace,.wis-village-rail").count(),
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
    assert.equal(
      await page
        .getByRole("link", { name: "아바타 상점", exact: true })
        .count(),
      0,
    );
    assert.equal(await page.evaluate(() => window.villageQa.avatarReads), 0);
    await page.close();
  }
  for (const width of [320, 1440]) {
    const page = await open(width, "products", "&student=1");
    await page
      .getByRole("navigation", { name: "위스 마을", exact: true })
      .waitFor();
    assert.equal(await page.locator(".wis-village-rail").count(), 0);
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
    "Real link transitions, ordinary Wis overview excluded, avatar permission boundary, and both student widths retain two top tabs with no WsPI exposure.",
  );
  for (const state of ["loading", "error"]) {
    const page = await open(320, "stocks", `&${state}=1`);
    await page.getByRole(state === "loading" ? "status" : "alert").waitFor();
    assert.equal(await page.locator(".wis-village-rail a").count(), 3);
    const before = await page.locator("h1").boundingBox();
    if (state === "loading")
      await page.evaluate(() => window.stockQa.release());
    else {
      await page.evaluate(() => (window.stockQa.failRead = false));
      await page
        .getByRole("button", { name: "다시 불러오기", exact: true })
        .click();
    }
    await page.getByRole("button", { name: /합성 역사 종목/ }).waitFor();
    assert.equal((await page.locator("h1").boundingBox()).y, before.y);
    await page.close();
  }
  {
    const page = await open(1280, "stocks");
    await page.locator("h1").waitFor();
    await page.addStyleTag({ content: "#root{margin-left:240px}" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    assert.equal(
      (await page.locator(".wis-village-rail").boundingBox()).width,
      128,
    );
    await page.screenshot({
      path: path.join(output, "1280-reserved-primary-sidebar.png"),
    });
    await page.close();
  }
  checks.push(
    "Loading/error/retry preserve navigation/title position and 1280px viewport with 240px primary-sidebar space has no overflow; all tests perform zero writes.",
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
