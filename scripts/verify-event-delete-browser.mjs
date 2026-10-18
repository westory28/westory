import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence =
  process.env.EVENT_DELETE_EVIDENCE ||
  path.join(os.tmpdir(), "westory-event-delete-qa");
await fs.mkdir(evidence, { recursive: true });
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: "tsx",
    contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import EventModal from './src/pages/teacher/components/EventModal';import {AppDialogProvider} from './src/components/common/AppDialogProvider';import './src/assets/index.css';
window.qa={calls:[],saved:0,closed:0,toasts:[]};
const event={id:'event-delete-fixture',title:'설 연휴 (수동 등록 검증)',start:'2027-02-06',end:'2027-02-08',eventType:'event',targetType:'common',startPeriod:'allDay',endPeriod:'allDay',revision:7};
function Fixture(){const [open,setOpen]=useState(true);return <AppDialogProvider><EventModal isOpen={open} eventData={event} onSave={()=>window.qa.saved++} onClose={()=>{window.qa.closed++;setOpen(false);}}/></AppDialogProvider>;}
createRoot(document.getElementById('root')).render(<Fixture/>);`,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  loader: { ".svg": "dataurl" },
  outfile: path.join(evidence, "fixture.js"),
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "isolated-calendar-services",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^firebase\/firestore$|(?:^|\/)(firebase|AuthContext|academicCalendar|AppToastProvider)$/,
          },
          (args) => ({ path: args.path, namespace: "fixture" }),
        );
        plugin.onLoad(
          { filter: /.*/, namespace: "fixture" },
          ({ path: name }) => ({
            contents: name.endsWith("AuthContext")
              ? "export const useAuth=()=>({config:{year:2026,semester:2}});"
              : name.endsWith("academicCalendar")
                ? "export const mutateAcademicCalendar=operation=>{window.qa.calls.push(operation);return new Promise((resolve,reject)=>{window.qa.resolve=resolve;window.qa.reject=()=>reject(new Error('검증 오류'));});};export const academicCalendarErrorMessage=error=>error.message;"
                : name.endsWith("AppToastProvider")
                  ? "export const useAppToast=()=>({showToast:toast=>window.qa.toasts.push(toast)});"
                  : "export const db={};export const doc=()=>({});export const getDoc=async()=>({exists:()=>false});export const onSnapshot=()=>()=>{};",
            loader: "js",
          }),
        );
      },
    },
  ],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const [type, body] =
    pathname === "/fixture.js"
      ? ["text/javascript", js]
      : pathname === "/fixture.css"
        ? ["text/css", css]
        : pathname === "/tailwind.js"
          ? ["text/javascript", tailwind]
          : ["text/html", html];
  response.setHeader("Content-Type", `${type};charset=utf-8`);
  response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
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
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [];
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const nativeDialogs = [],
      errors = [];
    page.on("dialog", (dialog) => {
      nativeDialogs.push(dialog.message());
      void dialog.dismiss();
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    const deleteButton = page.getByRole("button", {
      name: "일정 삭제",
      exact: true,
    });
    const confirm = page.getByRole("alertdialog", {
      name: "일정을 삭제하시겠습니까?",
      exact: true,
    });
    await deleteButton.click();
    await confirm.waitFor();
    assert(
      await confirm
        .getByText("“설 연휴 (수동 등록 검증)” 일정을 삭제합니다.", {
          exact: true,
        })
        .isVisible(),
    );
    assert(
      await confirm.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        );
      }),
      "Confirmation appears above the editor",
    );
    await page.screenshot({
      path: path.join(evidence, `${width}-confirmation.png`),
      fullPage: true,
    });
    await confirm.getByRole("button", { name: "취소", exact: true }).click();
    await confirm.waitFor({ state: "hidden" });
    assert.deepEqual(
      await page.evaluate(() => ({
        calls: qa.calls.length,
        closed: qa.closed,
        saved: qa.saved,
      })),
      { calls: 0, closed: 0, saved: 0 },
    );
    assert(await deleteButton.isEnabled());
    await deleteButton.click();
    await confirm.waitFor();
    await confirm.getByRole("button", { name: "취소", exact: true }).focus();
    await page.keyboard.press("Escape");
    await confirm.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => qa.calls.length), 0);
    assert(await deleteButton.isEnabled());
    await deleteButton.evaluate((button) => {
      button.click();
      button.click();
    });
    await confirm.waitFor();
    assert.equal(await page.getByRole("alertdialog").count(), 1);
    await confirm.getByRole("button", { name: "삭제", exact: true }).click();
    await page.waitForFunction(() => qa.calls.length === 1);
    assert(await deleteButton.isDisabled());
    assert.deepEqual(await page.evaluate(() => qa.calls[0]), {
      action: "DELETE_EVENT",
      year: 2026,
      semester: 2,
      eventId: "event-delete-fixture",
      expectedRevision: 7,
    });
    await deleteButton.evaluate((button) => button.click());
    assert.equal(await page.evaluate(() => qa.calls.length), 1);
    await page.evaluate(() => qa.reject());
    await page.waitForFunction(() => qa.toasts.length === 1);
    assert(await deleteButton.isEnabled());
    assert.deepEqual(
      await page.evaluate(() => ({
        closed: qa.closed,
        saved: qa.saved,
        tone: qa.toasts[0].tone,
      })),
      { closed: 0, saved: 0, tone: "error" },
    );
    await deleteButton.click();
    await confirm.waitFor();
    await confirm.getByRole("button", { name: "삭제", exact: true }).click();
    await page.waitForFunction(() => qa.calls.length === 2);
    await page.evaluate(() =>
      qa.resolve({ eventId: "event-delete-fixture", revision: 8 }),
    );
    await page.waitForFunction(() => qa.closed === 1);
    assert.deepEqual(
      await page.evaluate(() => ({
        closed: qa.closed,
        saved: qa.saved,
        tone: qa.toasts.at(-1).tone,
      })),
      { closed: 1, saved: 1, tone: "success" },
    );
    assert.deepEqual(nativeDialogs, []);
    assert.deepEqual(errors, []);
    checks.push({
      width,
      cancel: true,
      escape: true,
      singleConfirmation: true,
      singlePendingMutation: true,
      revisionAndScopePreserved: true,
      errorRetry: true,
      confirmedDelete: true,
    });
    await page.close();
  }
  await fs.writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify(checks, null, 2),
  );
  console.log(
    `Event delete confirmation passed at 390/1280px: visible app dialog, cancel/Escape, duplicate protection, unchanged ID/revision/scope, error retry and confirmed deletion. Evidence: ${evidence}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
