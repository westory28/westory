/** Real teacher/student launchers with synthetic services; no live data access. */
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
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence = await fs.mkdtemp(
  path.join(os.tmpdir(), "westory-floating-launchers-"),
);
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const source = `
import React from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter} from "react-router-dom";
import Teacher from ${imp("src/components/common/TeacherPatchMemoController.tsx")};
import Student from ${imp("src/components/common/StudentHistoryDictionaryController.tsx")};
import ${imp("src/assets/index.css")};
import ${imp("src/components/common/historyDictionary.css")};
const teacher=location.pathname.startsWith("/teacher");
if(!teacher)document.body.classList.add('student-fixture');
createRoot(document.getElementById("root")).render(<BrowserRouter>{teacher?<Teacher/>:<Student/>}</BrowserRouter>);
`;
const services = `
const params=new URLSearchParams(location.search);
export const qa=window.launcherQa={reads:0,stops:0,recovered:false};
const context={currentUser:{uid:"synthetic",email:"fixture@example.invalid",getIdTokenResult:async()=>({claims:{}})},userData:{role:"admin"},authGeneration:1,config:{year:'2026',semester:'2'}};
export const auth={currentUser:context.currentUser},db={};
export const useAuth=()=>context;
export const doc=(_db,...segments)=>({path:segments.join('/')});
export const onSnapshot=(ref,next,error)=>{qa.reads++;queueMicrotask(()=>params.has('gate-error')&&!qa.recovered?error(Error('Synthetic publication error')):next({data:()=>({enabled:params.has('open')||qa.recovered,revision:1})}));return()=>{qa.stops++}};
export const callWithApplicationSession=async()=>{throw Error('Launcher must not query personal data')};
export const useStudentLearningShortcuts=()=>({items:[],loading:false,loaded:true,error:'',reload:async()=>{},save:async()=>{}});
export const isAdminUser=()=>true,canAccessTeacherPath=()=>true;
export const teacherShortcutOptions=[{id:"/teacher/quiz",label:"평가 관리",icon:"M1 1h20"}];
export const readTeacherShortcuts=async()=>JSON.parse(sessionStorage.getItem("teacherItems")||"[]");
export const saveTeacherShortcuts=async(_uid,_before,items)=>sessionStorage.setItem("teacherItems",JSON.stringify(items));
const toast={showToast(){}};export const useAppToast=()=>toast;
export const prepareTeacherPatchNoteSession=async()=>{};
export const getTeacherPatchNoteErrorMessage=()=>"fixture error";
export const subscribeTeacherPatchNotes=(_uid,next)=>{next([]);return()=>{}};
export const createTeacherPatchNote=async()=>{}, deleteTeacherPatchNote=async()=>{}, updateTeacherPatchNote=async()=>{}, updateTeacherPatchNoteStatus=async()=>{};
export default function Workspace(){return null}
`;
const bundle = await build({
  stdin: {
    contents: source,
    loader: "tsx",
    resolveDir: root,
    sourcefile: "floating-fixture.tsx",
  },
  bundle: true,
  metafile: true,
  write: false,
  outdir: "out",
  format: "esm",
  platform: "browser",
  loader: { ".svg": "dataurl", ".webp": "dataurl" },
  plugins: [
    {
      name: "synthetic-boundaries",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^firebase\/firestore$|(?:^|\/)(?:firebase|applicationSession|AuthContext|permissions|teacherPatchNoteCommands|teacherPatchNotes|AppToastProvider|StudentHistoryDictionaryWorkspace|studentLearningShortcuts|teacherShortcuts)$/,
          },
          () => ({ path: "services", namespace: "fixture" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: services,
          loader: "jsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
assert(
  !Object.keys(bundle.metafile.inputs).some((file) =>
    /node_modules[\\/](?:firebase|@firebase)[\\/]/.test(file),
  ),
  "Fixture must not bundle live Firebase",
);
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html = `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;min-height:2600px}.student-fixture #root{transform:translateZ(0);min-height:1800px}#action{position:fixed;z-index:1;right:16px;bottom:16px;width:56px;height:56px;background:orange}#action.off{right:160px}#overlay{position:fixed;inset:0;background:#fff;z-index:50}#overlay[hidden]{display:none}#save{position:absolute;right:16px;bottom:16px;width:56px;height:56px}</style><button id="action" class="off">동작</button><div id="root"></div><div id="overlay" role="dialog" aria-modal="true" hidden><button id="save">저장</button></div><script>window.clicks=0;document.getElementById('action').onclick=()=>window.clicks++;document.getElementById('save').onclick=()=>window.clicks++</script><script type="module" src="/fixture.js"></script>`;
const server = http.createServer((req, res) => {
  const asset =
    req.url === "/fixture.js"
      ? [js, "text/javascript"]
      : req.url === "/fixture.css"
        ? [css, "text/css"]
        : req.url === "/tailwind.js"
          ? [tailwind, "text/javascript"]
          : [html, "text/html"];
  res.writeHead(200, { "Content-Type": asset[1] });
  res.end(asset[0]);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
try {
  for (const width of [320, 390, 768, 1280, 1440])
    for (const role of ["teacher", "student"]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === base ||
        route.request().url().startsWith("data:")
          ? route.continue()
          : route.abort(),
      );
      await page.goto(`${base}/${role}/dashboard`);
      const launcher = page.locator(
        role === "teacher"
          ? "button[data-patch-memo-root]"
          : "button[data-history-dictionary-launcher]",
      );
      await launcher.waitFor();
      await page.waitForFunction(
        () =>
          !document
            .querySelector(
              "button[data-patch-memo-root],button[data-history-dictionary-launcher]",
            )
            .hasAttribute("data-launcher-obscured"),
      );
      assert(
        await launcher.isVisible(),
        `${role}/${width}: hidden inactive dialog must not hide launcher`,
      );
      const box = await launcher.boundingBox();
      await page.locator("#action").evaluate((element, rect) => {
        element.classList.remove("off");
        element.style.left = `${rect.x}px`;
        element.style.top = `${rect.y}px`;
      }, box);
      if (role === "teacher") {
        await page.waitForFunction(() =>
          document.querySelector("[data-launcher-obscured]"),
        );
        assert.equal(await launcher.isVisible(), false);
        await page.mouse.click(box.x + 28, box.y + 28);
        assert.equal(
          await page.evaluate(() => window.clicks),
          1,
          `${role}/${width}: underlying button receives click`,
        );
      } else {
        assert.equal(
          await launcher.isVisible(),
          true,
          "Student launcher stays visible over ordinary page actions",
        );
        assert.equal(
          await launcher.evaluate((el) => el.parentElement === document.body),
          true,
          "Launcher escapes transformed page ancestors",
        );
        assert.equal(
          await launcher
            .locator("img")
            .evaluate((el) => getComputedStyle(el).filter),
          "grayscale(1)",
        );
        for (const scroll of [0, 900, 2600]) {
          await page.evaluate((y) => window.scrollTo(0, y), scroll);
          const position = await launcher.boundingBox();
          assert(
            position && position.y >= 0 && position.y + position.height <= 844,
            `Student launcher visible at scroll ${scroll}`,
          );
          assert(
            Math.abs(position.y - box.y) < 1,
            "Viewport fixed position is stable",
          );
          assert.equal(await launcher.isVisible(), true);
          await page.screenshot({
            path: path.join(evidence, `student-${width}-scroll-${scroll}.png`),
          });
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      await page.locator("#action").evaluate((element) => {
        element.style.left = "160px";
      });
      await page.waitForFunction(
        () => !document.querySelector("[data-launcher-obscured]"),
      );
      await page
        .locator("#overlay")
        .evaluate((element) => (element.hidden = false));
      await page.waitForFunction(() =>
        document.querySelector("[data-launcher-obscured]"),
      );
      await page.locator("#save").click();
      assert.equal(
        await page.evaluate(() => window.clicks),
        role === "teacher" ? 2 : 1,
      );
      await page.screenshot({
        path: path.join(evidence, `${role}-${width}-modal.png`),
      });
      await page
        .locator("#overlay")
        .evaluate((element) => (element.hidden = true));
      await page.waitForFunction(
        () => !document.querySelector("[data-launcher-obscured]"),
      );
      await page.evaluate(() => {
        document.body.style.overflow = "hidden";
      });
      await page.waitForFunction(() =>
        document.querySelector("[data-launcher-obscured]"),
      );
      await page.evaluate(() => {
        document.body.style.overflow = "";
      });
      await page.waitForFunction(
        () => !document.querySelector("[data-launcher-obscured]"),
      );
      await page.evaluate(() => {
        const menu = document.createElement("div");
        menu.id = "menu";
        menu.className = "fixed inset-0";
        document.body.append(menu);
      });
      await page.waitForFunction(() =>
        document.querySelector("[data-launcher-obscured]"),
      );
      await page.evaluate(() => document.querySelector("#menu").remove());
      await page.waitForFunction(
        () => !document.querySelector("[data-launcher-obscured]"),
      );
      if (role === "teacher") {
        await launcher.click();
        const menu = page.getByRole("dialog", {name:"교사 바로가기"});
        await menu.getByRole("button", {name:"바로가기 편집"}).click();
        const editor = page.getByRole("dialog", {name:"바로가기 편집"});
        await editor.getByRole("button", {name:"평가 관리 추가"}).click();
        await editor.getByRole("button", {name:"저장", exact:true}).click();
        await page.reload();
        await launcher.click();
        await menu.getByRole("button", {name:"평가 관리"}).waitFor();
        await menu.getByRole("button", {name:"평가 관리"}).click();
        assert.equal(new URL(page.url()).pathname, "/teacher/quiz");
        await launcher.click();
        await page.keyboard.press("Escape");
        await launcher.click();
        await menu.getByRole("button", {name:"패치 메모", exact:true}).click();
        await page.waitForFunction(() => document.querySelector("button[data-launcher-obscured]"));
        assert.equal(await launcher.isVisible(), false);
        assert(
          await page.getByRole("heading", { name: "패치 메모" }).isVisible(),
        );
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "패치 메모 닫기" })
          .click();
      } else {
        await launcher.click();
        const menu = page.getByRole("menu", { name: "학습 도구" });
        await menu.waitFor();
        assert.equal(
          await launcher
            .locator("img")
            .evaluate((el) => getComputedStyle(el).filter),
          "none",
          "Opening menu restores supplied logo colors",
        );
        await page.screenshot({
          path: path.join(evidence, `student-${width}-menu-color.png`),
        });
        const menuBox = await menu.boundingBox();
        const launcherBox = await launcher.boundingBox();
        assert(
          menuBox.y + menuBox.height < launcherBox.y,
          "menu expands above launcher",
        );
        assert.equal(
          await menu.getByRole("menuitem").count(),
          2,
          "unreleased Q&A stays hidden",
        );
        await page.locator("#action").click();
        assert.equal(await menu.count(), 0, "outside click dismisses menu");
        await launcher.click();
        await page.keyboard.press("Escape");
        assert.equal(await menu.count(), 0);
        assert.equal(
          await launcher
            .locator("img")
            .evaluate((el) => getComputedStyle(el).filter),
          "grayscale(1)",
        );
        assert(
          await launcher.evaluate(
            (element) => document.activeElement === element,
          ),
        );
        await launcher.press("ArrowUp");
        await page.getByRole("menuitem", { name: "역사 사전" }).press("Enter");
        await page.waitForFunction(() => document.querySelector("dialog").open);
        assert.equal(await launcher.isVisible(), false);
        await page.getByRole("button", { name: "역사 사전 닫기" }).click();
      }
      await page.waitForFunction(
        () => !document.querySelector("[data-launcher-obscured]"),
      );
      assert(
        await launcher.evaluate(
          (element) => document.activeElement === element,
        ),
        `${role}/${width}: closing the panel restores launcher focus`,
      );
      await page.evaluate(() => window.scrollTo(0, 900));
      await page.screenshot({
        path: path.join(evidence, `${role}-${width}-restored.png`),
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${role} ${width}px: dialog, covered action, scroll lock, menu, own panel, restoration`,
      );
      await page.close();
    }
  for (const width of [390, 768, 1280]) {
    for (const scenario of [
      {
        path: "/student/dashboard?open",
        label: "공부의 神문고",
        target: "/student/gongsinmoongo?source=general",
        reads: 1,
      },
      {
        path: "/student/lesson/note?open&id=unit-a",
        label: "공부의 神문고",
        target: "/student/gongsinmoongo?source=lesson&unitId=unit-a",
        reads: 1,
      },
      {
        path: "/student/lesson/history-dictionary?open",
        label: "공부의 神문고",
        target: "/student/gongsinmoongo?source=general",
        reads: 1,
      },
      {
        path: "/student/dashboard?gate-error",
        label: "공부의 神문고 다시 시도",
        target: "/student/gongsinmoongo?source=general",
        reads: 2,
      },
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === base ||
        route.request().url().startsWith("data:")
          ? route.continue()
          : route.abort(),
      );
      await page.goto(base + scenario.path);
      const launcher = page.locator("button[data-history-dictionary-launcher]");
      await launcher.click();
      const item = page.getByRole("menuitem", {
        name: scenario.label,
        exact: true,
      });
      await item.waitFor();
      if (scenario.path.includes("history-dictionary"))
        assert.equal(
          await page
            .getByRole("menuitem", { name: "역사 사전", exact: true })
            .count(),
          0,
        );
      if (scenario.path.includes("gate-error"))
        await page.evaluate(() => (window.launcherQa.recovered = true));
      await item.click();
      await page.waitForURL(base + scenario.target);
      assert.equal(
        await page.getByRole("menu", { name: "학습 도구" }).count(),
        0,
      );
      assert.equal(
        await page.evaluate(() => window.launcherQa.reads),
        scenario.reads,
      );
      assert.equal(
        await page.evaluate(
          () => window.launcherQa.reads - window.launcherQa.stops,
        ),
        1,
      );
      await page.close();
    }
    console.log(
      `PASS student ${width}px: direct/lesson/dictionary entry, gate failure retry, one shared publication listener`,
    );
  }
  console.log(`Evidence: ${evidence}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
