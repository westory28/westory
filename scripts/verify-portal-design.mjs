/**
 * Real portal header/sidebar, sub-navigation, maps and repository CSS.
 * Synthetic identities/read services only; all network requests stay on localhost.
 * Run with --serve for a persistent fixture, or --kind=map|tabs|tree|settings to narrow QA.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const evidence =
  process.env.PORTAL_DESIGN_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-portal-design-")));
await fs.mkdir(evidence, { recursive: true });
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const service = `
import {MENUS} from ${imp("src/constants/menus.ts")};
export const config={year:"2026",semester:"2",showLesson:true,showQuiz:true,showScore:true,availableSemesters:[{year:"2026",semester:"1"},{year:"2026",semester:"2"}]};
export const useAuth=()=>{const student=location.hash.startsWith("#/student");return {currentUser:{uid:"portal-design-fixture",email:"fixture@example.invalid"},userData:{uid:"portal-design-fixture",email:"fixture@example.invalid",role:student?"student":"teacher",name:student?"검증학생":"검증교사",staffPermissions:[]},config,configReady:true,menuConfig:MENUS,menuConfigReady:true,interfaceConfig:{},logout:async()=>{},refreshConfig:async()=>{},refreshMenuConfig:async()=>{}}};
const toast={showToast(){}};export const useAppToast=()=>toast;
export const db={};export const doc=(_, ...parts)=>({path:parts.join("/")});
export const getDoc=async(ref)=>({exists:()=>ref.path==="site_settings/config",data:()=>ref.path==="site_settings/config"?config:{}});
export const getDocFromServer=getDoc;export const getDocs=async()=>({docs:[],empty:true,size:0});
export const collection=doc;export const query=(ref)=>ref;export const orderBy=()=>({});export const serverTimestamp=()=>({});
window.portalDesignQa={writes:[]};
const forbidWrite=()=>{window.portalDesignQa.writes.push("blocked");throw new Error("Fixture forbids all application writes")};
export const setDoc=forbidWrite, updateDoc=forbidWrite, deleteDoc=forbidWrite, addDoc=forbidWrite, runTransaction=forbidWrite;
export const getHttpsCallable=()=>forbidWrite;export const createManagedNotifications=forbidWrite;
export const invalidateSiteSettingDocCache=()=>{};export const getDefaultPointPolicy=()=>({});
export const loadSemesterReadiness=async()=>({status:"ready",requiredItems:[],advisoryItems:[]});
export const preloadStudentWeplay=()=>{};
export const invalidateStudentRankPromotionSnapshotCache=()=>{};
export const getPointRankDefaultEmojiValue=()=>"😀";
export const loadStudentRankPromotionSnapshot=async()=>({wallet:{balance:0},rank:null,policy:{rankPolicy:null}});
`;
const assets = new Map();
const bundle = await build({
  entryPoints: [path.join(root, "scripts/fixtures/PortalDesignFixture.tsx")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(evidence, "fixture.js"),
  loader: { ".svg": "dataurl", ".webp": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "offline-portal-fixture",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)contexts\/AuthContext$|(?:^|\/)common\/AppToastProvider$|^\.\/AppToastProvider$|^firebase\/firestore$|^\.\/firebase$|(?:^|\/)lib\/(firebase|weplayPreload|pointRankPromotion|pointRanks|points|siteSettings|semesterReadiness|notifications)$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "ts",
          resolveDir: root,
        }));
        plugin.onResolve({ filter: /NotificationBell$/ }, () => ({
          path: "notification",
          namespace: "notification",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "notification" }, () => ({
          contents:
            'import React from "react"; export default function Bell(){return <button type="button" aria-label="알림" style={{width:40,height:40}}>♧</button>}',
          loader: "tsx",
          resolveDir: root,
        }));
        plugin.onResolve({ filter: /SettingsStudentAccess$/ }, () => ({
          path: "access",
          namespace: "read-only-widget",
        }));
        plugin.onResolve({ filter: /QuillEditor$/ }, () => ({
          path: "editor",
          namespace: "read-only-widget",
        }));
        plugin.onLoad(
          { filter: /.*/, namespace: "read-only-widget" },
          (args) => ({
            contents:
              args.path === "access"
                ? "export default function Access(){return null}"
                : 'import React from "react";export default function Editor({value}){return <div aria-label="약관 본문" style={{minHeight:180}} dangerouslySetInnerHTML={{__html:value}}/>}',
            loader: "tsx",
            resolveDir: root,
          }),
        );
        plugin.onResolve({ filter: /\?url$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.replace(/\?url$/, "")),
          namespace: "fixture-asset",
        }));
        plugin.onLoad(
          { filter: /.*/, namespace: "fixture-asset" },
          async (args) => {
            const url = `/assets/${path.basename(args.path)}`;
            assets.set(url, await fs.readFile(args.path));
            return {
              contents: `export default ${JSON.stringify(url)}`,
              loader: "js",
            };
          },
        );
      },
    },
  ],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
const tailwindPath =
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
  path.join(os.tmpdir(), "westory-qa-tailwind.js");
let tailwind;
try {
  tailwind = await fs.readFile(tailwindPath, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const appHtml = await fs.readFile(path.join(root, "index.html"), "utf8");
  const tailwindUrl = Array.from(
    appHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi),
    (match) => match[1],
  ).find((source) => /^https:\/\/cdn\.tailwindcss\.com(?:\/|$)/.test(source));
  assert(
    tailwindUrl,
    "index.html must declare the official Tailwind CDN runtime",
  );
  try {
    const response = await fetch(tailwindUrl, {
      signal: AbortSignal.timeout(30000),
    });
    assert(response.ok, `Tailwind CDN returned HTTP ${response.status}`);
    assert.equal(new URL(response.url).origin, "https://cdn.tailwindcss.com");
    assert.match(
      response.headers.get("content-type") || "",
      /(?:java|ecma)script/i,
      "Tailwind CDN must return JavaScript",
    );
    tailwind = await response.text();
    assert(tailwind.trim(), "Tailwind CDN returned an empty runtime");
  } catch (cause) {
    throw new Error(
      `Could not cache ${tailwindUrl}. Connect once, or set PORTAL_DESIGN_TAILWIND_PATH to a previously downloaded runtime.`,
      { cause },
    );
  }
  await fs.mkdir(path.dirname(tailwindPath), { recursive: true });
  try {
    await fs.writeFile(tailwindPath, tailwind, {
      encoding: "utf8",
      flag: "wx",
    });
    console.log(`Cached production Tailwind runtime: ${tailwindPath}`);
  } catch (error) {
    // A parallel fixture may have populated the same cache during the download.
    if (error.code !== "EEXIST") throw error;
    tailwind = await fs.readFile(tailwindPath, "utf8");
  }
}
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost").pathname;
  const files = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  };
  const [type, data] = assets.has(url)
    ? ["application/json", assets.get(url)]
    : files[url] || ["text/html", html];
  response.setHeader("Content-Type", `${type};charset=utf-8`);
  response.end(data);
});
await new Promise((resolve) =>
  server.listen(
    Number(process.env.PORTAL_DESIGN_PORT || 0),
    "127.0.0.1",
    resolve,
  ),
);
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(`Portal fixture: ${origin}/?kind=map#/teacher/lesson/maps`);
if (process.argv.includes("--serve")) {
  console.log(
    `Also available: ?kind=tabs and ?kind=tree, with #/student/lesson/maps for the student portal. Evidence: ${evidence}`,
  );
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await new Promise((resolve) => server.close(resolve));
  process.exit(0);
}
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
const checks = [],
  errors = [],
  failures = [];
const sizes = [
  [320, 844],
  [390, 844],
  [768, 1024],
  [1280, 900],
  [1366, 768],
  [1440, 900],
];
const kindFilter = process.argv
  .find((value) => value.startsWith("--kind="))
  ?.split("=")[1];
const kinds = kindFilter ? [kindFilter] : ["map", "tabs", "tree", "settings"];
async function noOverflow(page, label) {
  const size = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  assert(
    size.scroll <= size.viewport + 1,
    `${label}: horizontal overflow ${size.scroll}/${size.viewport}`,
  );
}
async function mapLayout(page, selector, width, height) {
  const layout = await page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const header = document
      .querySelector(".teacher-account-header")
      .getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      height: r.height,
      headerBottom: header.bottom,
      viewportHeight: innerHeight,
      documentHeight: document.documentElement.scrollHeight,
    };
  });
  assert(
    layout.top >= layout.headerBottom,
    "Map does not cover account controls",
  );
  if (width >= 1024)
    assert(
      layout.bottom <= height + 1,
      `Map bottom is below first viewport: ${JSON.stringify(layout)}`,
    );
  return layout;
}
async function sidebarChecks(page, portal, width) {
  const mobile = width < 1024;
  const menuLabel = portal === "teacher" ? "학습 자료 관리" : "학습";
  const toggle = page.getByRole("button", {
    name: `${portal === "teacher" ? "교사" : "학생"} 메뉴 열기`,
    exact: true,
  });
  const sidebar = page.locator(".teacher-sidebar");
  const group = sidebar.getByRole("button", { name: menuLabel, exact: true });
  const expanded = async (button, expected, message) => {
    await page.waitForFunction(
      ([element, value]) => element?.getAttribute("aria-expanded") === value,
      [await button.elementHandle(), String(expected)],
    );
    assert.equal(
      await button.getAttribute("aria-expanded"),
      String(expected),
      message,
    );
  };
  const openMobile = async () => {
    if (
      mobile &&
      !(await sidebar.getAttribute("class")).includes("is-mobile-open")
    )
      await toggle.click();
  };
  const checkMobileReturn = async () => {
    if (!mobile) return;
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.waitForFunction(
      (element) => element === document.activeElement,
      await toggle.elementHandle(),
    );
    await openMobile();
  };
  const navigateLink = async (name) => {
    const link = sidebar.getByRole("link", { name, exact: true });
    const target = new URL(await link.getAttribute("href"), page.url()).hash;
    await link.press("Enter");
    await page.waitForFunction((hash) => location.hash === hash, target);
    await checkMobileReturn();
    return link;
  };
  const navigateHash = async (hash) => {
    await page.evaluate((next) => {
      location.hash = next;
    }, hash);
    await page.waitForFunction((next) => location.hash === next, hash);
    await checkMobileReturn();
  };
  await openMobile();
  await expanded(group, true, "An initial deep link opens its selected group");
  assert.equal(
    await sidebar.getByRole("link", { name: "역사 지도", exact: true }).count(),
    1,
  );
  assert.equal(
    await sidebar.getByRole("link", { name: "지도", exact: true }).count(),
    0,
  );
  const lessonLink = await navigateLink("수업 자료");
  await expanded(group, true, "Selecting a child keeps its group open");
  if (!mobile)
    assert(
      await lessonLink.evaluate((el) => el === document.activeElement),
      "A visible child retains keyboard focus",
    );
  const mapLink = await navigateLink("역사 지도");
  await expanded(
    group,
    true,
    "Another child in the same group remains exposed",
  );
  if (!mobile)
    assert(
      await mapLink.evaluate((el) => el === document.activeElement),
      "Same-group navigation does not move child focus",
    );
  await navigateHash(`#/${portal}/lesson/maps?view=world`);
  await expanded(group, true, "Map query changes keep the group open");

  await group.press("Enter");
  await expanded(group, false, "Manual folding is available");
  if (mobile) {
    await page.keyboard.press("Escape");
    await checkMobileReturn();
  } else {
    await sidebar
      .getByRole("button", { name: "메뉴 접기", exact: true })
      .click();
    await sidebar
      .getByRole("button", { name: "메뉴 펼치기", exact: true })
      .click();
  }
  await expanded(
    group,
    false,
    "Unchanged-route rerenders preserve a manual fold",
  );
  await navigateHash(`#/${portal}/lesson/maps?view=korea`);
  await expanded(group, true, "A new route reveals the selected group again");

  const points = sidebar.getByRole("button", {
    name: portal === "teacher" ? "위스 관리" : "위스",
    exact: true,
  });
  await points.press("Enter");
  await expanded(
    group,
    false,
    "Opening another upper menu closes the old group",
  );
  await navigateLink(portal === "teacher" ? "위스 현황" : "내 위스");
  await expanded(points, true, "The newly selected group remains open");
  const queryLink = await navigateLink(
    portal === "teacher" ? "명예의 전당 관리" : "명예의 전당",
  );
  await expanded(
    points,
    true,
    "Query-only child navigation keeps its group open",
  );
  if (!mobile)
    assert(
      await queryLink.evaluate((el) => el === document.activeElement),
      "Query-only navigation preserves child focus",
    );
  let currentHash = `#/${portal}/points?tab=hall-of-fame`;
  let currentGroup = points;
  if (portal === "teacher") {
    currentHash = "#/teacher/points?tab=products";
    await navigateHash(currentHash);
    currentGroup = sidebar.getByRole("button", { name: "상점", exact: true });
    await expanded(
      currentGroup,
      true,
      "A query selecting another group opens that group",
    );
    await expanded(
      points,
      false,
      "A cross-group query closes the previous group",
    );
  }
  await page.goBack();
  await page.waitForFunction(
    (hash) => location.hash === hash,
    portal === "teacher"
      ? "#/teacher/points?tab=hall-of-fame"
      : "#/student/points",
  );
  await checkMobileReturn();
  await expanded(points, true, "Back restores the selected group");
  await page.goForward();
  await page.waitForFunction((hash) => location.hash === hash, currentHash);
  await checkMobileReturn();
  await expanded(currentGroup, true, "Forward restores the selected group");

  await navigateLink(portal === "teacher" ? "캘린더" : "마이페이지");
  await expanded(
    currentGroup,
    false,
    "A standalone destination closes the previous group",
  );
  assert.equal(
    await sidebar
      .locator('.teacher-sidebar-submenu[aria-hidden="false"]')
      .count(),
    0,
  );
  assert.equal(
    await sidebar
      .locator(
        '.teacher-sidebar-submenu[aria-hidden="true"] a:not([tabindex="-1"])',
      )
      .count(),
    0,
    "Hidden children are excluded from keyboard navigation",
  );
  await page.goBack();
  await page.waitForFunction((hash) => location.hash === hash, currentHash);
  await checkMobileReturn();
  await expanded(
    currentGroup,
    true,
    "Back from a standalone destination restores its group",
  );
  await page.screenshot({
    path: path.join(evidence, `${portal}-sidebar-${width}.png`),
    fullPage: true,
  });
  if (mobile) {
    await page.keyboard.press("Escape");
    assert.equal(
      await toggle.evaluate((el) => el === document.activeElement),
      true,
      "Escape returns focus to the menu toggle",
    );
  }
  checks.push({
    label: `${portal}-sidebar-${width}`,
    deepLink: true,
    sameGroup: true,
    queryNavigation: true,
    backForward: true,
    manualFold: true,
    mobileFocus: mobile,
  });
}
try {
  for (const portal of ["teacher", "student"])
    for (const kind of kinds)
      for (const [width, height] of sizes) {
        if (portal === "student" && kind === "settings") continue;
        const page = await browser.newPage({ viewport: { width, height } });
        page.setDefaultTimeout(10000);
        const pageErrors = [];
        page.on("pageerror", (error) => {
          pageErrors.push(error.message);
          console.log(`BROWSER ERROR: ${error.message}`);
        });
        await page.route("**/*", (route) =>
          route.request().url().startsWith(origin)
            ? route.continue()
            : route.abort(),
        );
        const label = `${portal}-${kind}-${width}x${height}`;
        try {
          await page.goto(`${origin}/?kind=${kind}#/${portal}/lesson/maps`);
          if (kind === "settings") {
            const navigation = page.locator(".teacher-sub-navigation");
            await navigation.waitFor();
            const menu = navigation.locator("nav");
            assert.equal(await menu.isVisible(), true);
            const navBox = await navigation.boundingBox();
            const contentBox = await page
              .locator("#teacher-settings-content")
              .boundingBox();
            assert(
              navBox.y + navBox.height <= contentBox.y + 1,
              "Settings sections sit above the settings body",
            );
            const sectionLabels = [
              "기본 환경 설정",
              "이전 학기 조회",
              "학교/학년/학기",
              "인터페이스 설정",
              "세부 권한 관리",
              "알림 관리",
              "개인정보 동의 관리",
            ];
            for (const sectionLabel of sectionLabels) {
              const button = menu.getByRole("button", {
                name: sectionLabel,
                exact: true,
              });
              await button.press("Enter");
              await page
                .locator(
                  `#teacher-settings-content[aria-label="${sectionLabel}"]`,
                )
                .waitFor();
              assert.equal(await button.getAttribute("aria-current"), "page");
              await noOverflow(page, `${label}-${sectionLabel}`);
              if (
                [
                  "기본 환경 설정",
                  "학교/학년/학기",
                  "인터페이스 설정",
                ].includes(sectionLabel)
              ) {
                await page.screenshot({
                  path: path.join(
                    evidence,
                    `${label}-${sectionLabels.indexOf(sectionLabel)}.png`,
                  ),
                  fullPage: true,
                });
              }
            }
            assert.equal(
              await page.evaluate(() => window.portalDesignQa.writes.length),
              0,
              "Browsing settings never writes application data",
            );
            checks.push({ label, sections: sectionLabels, keyboard: true });
          } else if (kind === "map") {
            await page.locator(".history-atlas__map").waitFor();
            await page.waitForFunction(
              () =>
                document.querySelectorAll(".history-atlas__map svg path")
                  .length > 1,
            );
            await noOverflow(page, label);
            const layout = await mapLayout(
              page,
              ".history-atlas__map",
              width,
              height,
            );
            if (width === 1366) {
              await page.evaluate(() => window.scrollTo(0, 80));
              await page.waitForTimeout(200);
              assert.equal(
                await page
                  .locator(".history-atlas__map")
                  .evaluate((el) => el.getBoundingClientRect().height),
                layout.height,
                "Scrolling does not resize the map",
              );
              await page.evaluate(() => window.scrollTo(0, 0));
            }
            await page.screenshot({
              path: path.join(evidence, `${label}.png`),
              fullPage: true,
            });
            const view = page.getByRole("group", {
              name: "지도 보기",
              exact: true,
            });
            await view
              .getByRole("button", { name: "세계사", exact: true })
              .press("Enter");
            assert.equal(
              await view
                .getByRole("button", { name: "세계사", exact: true })
                .getAttribute("aria-pressed"),
              "true",
            );
            await noOverflow(page, `${label}-world`);
            const worldLayout = await mapLayout(
              page,
              ".history-atlas__map",
              width,
              height,
            );
            await view
              .getByRole("button", { name: "지구본", exact: true })
              .press("Enter");
            await page.locator(".history-globe canvas").waitFor();
            await noOverflow(page, `${label}-globe`);
            const globeLayout = await mapLayout(
              page,
              ".history-globe__map-shell",
              width,
              height,
            );
            await page.screenshot({
              path: path.join(evidence, `${label}-globe.png`),
              fullPage: true,
            });
            checks.push({
              label,
              layout,
              worldLayout,
              globeLayout,
              views: ["korea", "world", "globe"],
            });
          } else {
            const navigation = page.locator(".teacher-sub-navigation");
            await navigation.waitFor();
            const menu = navigation.locator("nav");
            const toggle = navigation.locator(".teacher-settings-menu-toggle");
            if (kind === "tabs") {
              assert.equal(
                await menu.isVisible(),
                true,
                "Simple navigation is visible at every width",
              );
              assert.equal(
                await toggle.isVisible(),
                false,
                "Simple tabs need no extra accordion",
              );
              const navBox = await navigation.boundingBox();
              const contentBox = await page
                .locator(".teacher-sub-content")
                .boundingBox();
              assert(
                navBox.y + navBox.height <= contentBox.y + 1,
                "Tabs sit above content",
              );
              await menu.getByRole("button").nth(1).press("Enter");
            } else {
              if (await toggle.isVisible()) await toggle.press("Enter");
              await menu
                .getByRole("button", { name: "한국사의 전개", exact: true })
                .press("Enter");
              await menu.getByRole("button").nth(1).press("Enter");
              if (await toggle.isVisible()) {
                assert.equal(
                  await toggle.getAttribute("aria-expanded"),
                  "false",
                );
                assert.equal(
                  await toggle.evaluate((el) => el === document.activeElement),
                  true,
                );
                await toggle.press("Enter");
                await page.keyboard.press("Escape");
                assert.equal(
                  await toggle.getAttribute("aria-expanded"),
                  "false",
                );
              }
            }
            assert.match(
              await page.getByTestId("selected").textContent(),
              /^등록된 자료/,
            );
            const headerStyle = await page
              .locator("header.ws-page-header")
              .evaluate((el) => ({
                position: getComputedStyle(el).position,
                background: getComputedStyle(el).backgroundColor,
                border: getComputedStyle(el).borderBottomWidth,
              }));
            assert.equal(
              headerStyle.position,
              "static",
              "Page header does not inherit the global sticky header",
            );
            assert.equal(
              headerStyle.background,
              "rgba(0, 0, 0, 0)",
              "Page header stays on the page background",
            );
            assert.equal(headerStyle.border, "0px");
            assert.equal(await page.locator("button button").count(), 0);
            await noOverflow(page, label);
            await page.screenshot({
              path: path.join(evidence, `${label}.png`),
              fullPage: true,
            });
            checks.push({ label, navigation: kind, keyboard: true });
          }
          await sidebarChecks(page, portal, width);
          assert.deepEqual(pageErrors, [], `${label}: browser errors`);
          console.log(`PASS ${label}`);
        } catch (error) {
          failures.push({ label, error: error.stack });
          await page
            .screenshot({
              path: path.join(evidence, `${label}-failure.png`),
              fullPage: true,
            })
            .catch(() => {});
          console.log(`FAIL ${label}: ${error.message}`);
        } finally {
          errors.push(...pageErrors.map((message) => ({ label, message })));
          await page.close();
        }
      }
} finally {
  await fs.writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        status: failures.length ? "FAIL" : "PASS",
        origin,
        checks,
        errors,
        failures,
        limitations:
          "Synthetic identities and read services, real components/CSS/map data. External network blocked, no app writes, local font fallback if Noto Sans KR is unavailable.",
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(`Evidence: ${evidence}`);
assert.equal(
  failures.length,
  0,
  `${failures.length} portal design checks failed; see result.json`,
);
