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
createRoot(document.getElementById("root")).render(<BrowserRouter>{teacher?<Teacher/>:<Student/>}</BrowserRouter>);
`;
const services = `
export const useAuth=()=>({currentUser:{uid:"synthetic",email:"fixture@example.invalid"},userData:{role:"admin"}});
export const isAdminUser=()=>true;
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
  write: false,
  outdir: "out",
  format: "esm",
  platform: "browser",
  loader: { ".svg": "dataurl" },
  plugins: [
    {
      name: "synthetic-boundaries",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /AuthContext$|\/permissions$|\/teacherPatchNoteCommands$|\/teacherPatchNotes$|\/AppToastProvider$|\/StudentHistoryDictionaryWorkspace$/,
          },
          () => ({ path: "services", namespace: "fixture" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: services,
          loader: "jsx",
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
const tailwind = await fs.readFile(
  path.join(os.tmpdir(), "westory-tailwind-fixture.js"),
  "utf8",
);
const html = `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;min-height:2000px}#action{position:fixed;right:16px;bottom:16px;width:56px;height:56px;background:orange}#action.off{right:160px}#overlay{position:fixed;inset:0;background:#fff;z-index:50}#overlay[hidden]{display:none}#save{position:absolute;right:16px;bottom:16px;width:56px;height:56px}</style><button id="action" class="off">동작</button><div id="root"></div><div id="overlay" role="dialog" aria-modal="true" hidden><button id="save">저장</button></div><script>window.clicks=0;document.getElementById('action').onclick=()=>window.clicks++;document.getElementById('save').onclick=()=>window.clicks++</script><script type="module" src="/fixture.js"></script>`;
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
  for (const width of [390, 768, 1280])
    for (const role of ["teacher", "student"]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === base
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
      assert.equal(await page.evaluate(() => window.clicks), 2);
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
  console.log(`Evidence: ${evidence}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
