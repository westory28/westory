/** Actual launcher/editor/account hook with a local synthetic callable boundary. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const remainingOnly = process.argv.includes("--remaining");
const visualOnly = process.argv.includes("--visual-only");
const routesOnly = process.argv.includes("--routes-only");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence = path.resolve(
  process.env.SHORTCUTS_EVIDENCE || "output/student-shortcuts-20261117/browser",
);
await fs.mkdir(evidence, { recursive: true });
const ownedSources = [
  "src/components/common/StudentHistoryDictionaryController.tsx",
  "src/components/common/StudentLearningShortcutsEditor.tsx",
  "src/components/common/studentLearningTools.css",
  "src/lib/studentLearningShortcuts.ts",
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    ownedSources.map(async (file) => [
      file,
      createHash("sha256")
        .update(await fs.readFile(path.join(root, file)))
        .digest("hex"),
    ]),
  ),
);
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import Student from ${imp("src/components/common/StudentHistoryDictionaryController.tsx")};
import ${imp("src/assets/index.css")};
import ${imp("assets/css/style.css")};
import ${imp("src/components/common/historyDictionary.css")};
import ${imp("src/components/common/portalPage.css")};
createRoot(document.getElementById('root')).render(<BrowserRouter><Student/></BrowserRouter>);
`;
const services = `
import {useSyncExternalStore} from 'react';
import {cloneDefaultMenus} from ${imp("src/constants/menus.ts")};
const uid=new URLSearchParams(location.search).get('fixture')||'synthetic';
const user=id=>({uid:id,email:id+'@example.invalid'});
let context={currentUser:user(uid),userData:{role:'student'},authGeneration:1,configReady:true,config:{year:'2026',semester:'2',showLesson:true,showQuiz:true,showScore:true},menuConfig:cloneDefaultMenus()};
const listeners=new Set();
export const auth={currentUser:context.currentUser},db={};
export const useAuth=()=>useSyncExternalStore(callback=>{listeners.add(callback);return()=>listeners.delete(callback)},()=>context);
window.shortcutQa={failedCalls:0,change(patch){context={...context,...patch,...(patch.uid?{currentUser:user(patch.uid)}:{})};auth.currentUser=context.currentUser;listeners.forEach(fn=>fn());},context:()=>context};
export const doc=(_db,...parts)=>({path:parts.join('/')});
export const onSnapshot=(_ref,next)=>{queueMicrotask(()=>next({data:()=>({enabled:true,revision:1})}));return()=>{}};
export const callWithApplicationSession=async(name,payload,user)=>{
 if(name!=='manageStudentLearningShortcuts')throw Error('Unexpected private callable: '+name);
 const response=await fetch('/synthetic/shortcuts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:user.uid,payload})});
 const data=await response.json();if(!response.ok){window.shortcutQa.failedCalls++;throw Error(data.error)}return {data};
};
export default function Workspace(){return null}
`;
const bundle = await build({
  stdin: {
    contents: source,
    loader: "tsx",
    resolveDir: root,
    sourcefile: "shortcuts-fixture.tsx",
  },
  bundle: true,
  write: false,
  metafile: true,
  outdir: "out",
  format: "esm",
  platform: "browser",
  loader: {
    ".webp": "dataurl",
    ".svg": "dataurl",
    ".png": "dataurl",
    ".woff2": "dataurl",
  },
  plugins: [
    {
      name: "synthetic-boundaries",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^firebase\/firestore$|(?:^|\/)(?:firebase|applicationSession|AuthContext|StudentHistoryDictionaryWorkspace)$/,
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
  "No live Firebase may enter the fixture",
);
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html = `<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;min-height:2400px}#root{transform:translateZ(0);min-height:1800px}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const ids = ["lesson", "maps", "wispi", "avatar-shop", "weplay", "calendar"];
const labels = [
  "학습 자료",
  "역사 지도",
  "위스피",
  "아바타 상점",
  "위플레이",
  "캘린더",
];
const store = new Map(),
  calls = [],
  writes = [],
  failures = [],
  holds = [];
const clone = (value) => structuredClone(value);
const seed = (uid, items = []) =>
  store.set(uid, { items: [...items], revision: 0 });
const holdNext = (uid, action) => {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  const item = { uid, action, promise, release, captured: false };
  holds.push(item);
  return item;
};
const server = http.createServer(async (req, res) => {
  if (req.url === "/synthetic/shortcuts") {
    let text = "";
    for await (const chunk of req) text += chunk;
    const { uid, payload } = JSON.parse(text);
    calls.push({ uid, ...payload });
    if (!store.has(uid)) seed(uid);
    const value = clone(store.get(uid));
    const hold = holds.find(
      (item) =>
        item.uid === uid && item.action === payload.action && !item.captured,
    );
    if (hold) {
      hold.captured = true;
      await hold.promise;
    }
    const failIndex = failures.findIndex(
      (item) => item.uid === uid && item.action === payload.action,
    );
    let error = "",
      status = 200,
      output = value;
    if (failIndex >= 0) {
      error = failures.splice(failIndex, 1)[0].error;
      status = 503;
    } else if (payload.action === "save") {
      if (
        !Array.isArray(payload.items) ||
        payload.items.length > 6 ||
        new Set(payload.items).size !== payload.items.length ||
        payload.items.some((id) => !ids.includes(id))
      ) {
        error = "허용하지 않은 바로가기";
        status = 400;
      } else if (store.get(uid).revision !== payload.expectedRevision) {
        error =
          "다른 기기에서 설정이 변경되었습니다. 다시 불러온 뒤 저장해 주세요.";
        status = 409;
      } else {
        output = { items: payload.items, revision: value.revision + 1 };
        store.set(uid, clone(output));
        writes.push({ uid, ...clone(output) });
      }
    }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(error ? { error } : output));
    return;
  }
  const [body, type] =
    req.url === "/fixture.js"
      ? [js, "text/javascript"]
      : req.url === "/fixture.css"
        ? [css, "text/css"]
        : req.url === "/tailwind.js"
          ? [tailwind, "text/javascript"]
          : [html, "text/html"];
  res.writeHead(200, { "Content-Type": type });
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  pages = [];
const wait = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw Error("Synthetic condition did not settle");
};
async function pageFor(uid, width = 390, height = 844) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
  });
  const page = await context.newPage();
  pages.push(page);
  page.on("pageerror", (error) => {
    page.fixtureErrors.push(error.message);
  });
  page.fixtureErrors = [];
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === base
      ? route.continue()
      : route.abort(),
  );
  await page.goto(`${base}/student/dashboard?fixture=${uid}`);
  await page.locator("[data-history-dictionary-launcher]").waitFor();
  return page;
}
const launcher = (page) => page.locator("[data-history-dictionary-launcher]");
const dialog = (page) => page.getByRole("dialog", { name: "바로가기 편집" });
const order = (page) =>
  page
    .locator(".student-shortcuts-selected li")
    .evaluateAll((rows) => rows.map((row) => row.dataset.shortcutId));
async function menu(page) {
  if (!(await page.getByRole("menu", { name: "학습 도구" }).count()))
    await launcher(page).click();
  await page
    .getByRole("menuitem", { name: "바로가기 편집", exact: true })
    .waitFor();
}
async function edit(page) {
  await menu(page);
  await page
    .getByRole("menuitem", { name: "바로가기 편집", exact: true })
    .click();
  await dialog(page).waitFor();
  await page
    .locator(".student-shortcuts-available")
    .waitFor({ state: "attached" });
}
async function addAll(page) {
  for (const label of labels) {
    const add = page.getByRole("button", {
      name: `${label} 추가`,
      exact: true,
    });
    if (await add.count()) await add.click();
  }
}
async function save(page) {
  await dialog(page).getByRole("button", { name: "저장", exact: true }).click();
  await dialog(page).waitFor({ state: "hidden" });
}
async function assertOrder(page, expected) {
  await wait(
    async () => JSON.stringify(await order(page)) === JSON.stringify(expected),
  );
}
async function check(name, body) {
  if (
    remainingOnly &&
    !/^(initial read|hidden destinations|late read|duplicate save|visual CSS)/.test(
      name,
    )
  )
    return;
  if (visualOnly && !name.startsWith("visual CSS")) return;
  if (routesOnly && !name.startsWith("shortcut destinations")) return;
  await body();
  checks.push(name);
  console.log(`PASS ${name}`);
}
try {
  await check(
    "shortcut destinations navigate to all six allowed routes",
    async () => {
      const targets = [
        "/student/lesson/note",
        "/student/lesson/maps",
        "/student/wispi",
        "/student/points?tab=shop&shop=avatar",
        "/student/weplay",
        "/student/calendar",
      ];
      for (const [index, target] of targets.entries()) {
        const uid = `route_${index}`;
        seed(uid, ids);
        const page = await pageFor(uid, 390, 460);
        await menu(page);
        await page
          .getByRole("menuitem", { name: labels[index], exact: true })
          .click();
        await page.waitForURL(`${base}${target}`);
        assert.equal(
          await page.getByRole("menu", { name: "학습 도구" }).count(),
          0,
        );
        assert.equal(writes.filter((x) => x.uid === uid).length, 0);
        await page.context().close();
      }
    },
  );
  for (const width of [390, 768, 1280])
    await check(
      `editor add/remove/cancel/save, grayscale and scroll anchoring ${width}px`,
      async () => {
        const uid = `size_${width}`;
        seed(uid);
        const page = await pageFor(uid, width);
        assert.equal(
          calls.filter((x) => x.uid === uid).length,
          0,
          "Closed launcher does not read account preferences",
        );
        assert.equal(
          await launcher(page)
            .locator("img")
            .evaluate((el) => getComputedStyle(el).filter),
          "grayscale(1)",
        );
        const top = await launcher(page).boundingBox();
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        );
        const bottom = await launcher(page).boundingBox();
        assert.equal(top.y, bottom.y);
        assert(await launcher(page).isVisible());
        await menu(page);
        assert.equal(
          await launcher(page)
            .locator("img")
            .evaluate((el) => getComputedStyle(el).filter),
          "none",
        );
        await edit(page);
        assert.equal(
          await page.getByRole("tooltip").count(),
          0,
          "Help stays closed when the editor first opens",
        );
        assert.equal(
          await page.locator(".student-shortcuts-available button").count(),
          6,
        );
        assert(
          await dialog(page)
            .getByRole("button", { name: "저장", exact: true })
            .isDisabled(),
        );
        await addAll(page);
        await assertOrder(page, ids);
        await page
          .getByRole("button", { name: "역사 지도 삭제", exact: true })
          .click();
        await assertOrder(
          page,
          ids.filter((id) => id !== "maps"),
        );
        await dialog(page)
          .getByRole("button", { name: "취소", exact: true })
          .click();
        assert.equal(writes.filter((x) => x.uid === uid).length, 0);
        await edit(page);
        await assertOrder(page, []);
        await addAll(page);
        const header = await page
          .locator(".student-shortcuts-heading")
          .evaluate((el) => {
            const s = getComputedStyle(el);
            return {
              background: s.backgroundColor,
              shadow: s.boxShadow,
              position: s.position,
              minHeight: s.minHeight,
            };
          });
        assert.deepEqual(header, {
          background: "rgba(0, 0, 0, 0)",
          shadow: "none",
          position: "static",
          minHeight: "0px",
        });
        assert(
          await dialog(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
        );
        await page.screenshot({
          path: path.join(evidence, `editor-${width}.png`),
        });
        await save(page);
        assert.deepEqual(store.get(uid).items, ids);
        assert.equal(writes.filter((x) => x.uid === uid).length, 1);
        await edit(page);
        assert(
          await dialog(page)
            .getByRole("button", { name: "저장", exact: true })
            .isDisabled(),
        );
        await dialog(page)
          .getByRole("button", { name: "취소", exact: true })
          .click();
        assert.equal(
          writes.filter((x) => x.uid === uid).length,
          1,
          "Unchanged settings cause no write",
        );
        await page.reload();
        await edit(page);
        await assertOrder(page, ids);
        await dialog(page)
          .getByRole("button", { name: "취소", exact: true })
          .click();
        const second = await pageFor(uid, width);
        await edit(second);
        await assertOrder(second, ids);
        await second.context().close();
        await page.setViewportSize({ width, height: 460 });
        await menu(page);
        const bounds = await page
          .getByRole("menu", { name: "학습 도구" })
          .evaluate((el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return {
              top: r.top,
              bottom: r.bottom,
              right: r.right,
              left: r.left,
              maxHeight: parseFloat(s.maxHeight),
              scroll: s.overflowY,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
            };
          });
        assert(
          bounds.top >= 0 &&
            bounds.bottom <= 460 &&
            bounds.left >= 0 &&
            bounds.right <= width,
        );
        assert.equal(bounds.scroll, "auto");
        assert(bounds.scrollHeight > bounds.clientHeight);
        await page.screenshot({
          path: path.join(evidence, `long-menu-${width}.png`),
        });
        await page.context().close();
      },
    );
  await check(
    "mouse, touch grip dragging and keyboard reorder preserve one saved order",
    async () => {
      const uid = "reorder";
      seed(uid, ids);
      const page = await pageFor(uid);
      await edit(page);
      const first = await page
        .getByRole("button", { name: "학습 자료 순서 이동", exact: true })
        .boundingBox();
      const last = await page
        .locator('[data-shortcut-id="calendar"]')
        .boundingBox();
      await page.mouse.move(
        first.x + first.width / 2,
        first.y + first.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(last.x + 20, last.y + last.height / 2, {
        steps: 12,
      });
      await page.mouse.up();
      await assertOrder(page, [...ids.slice(1), ids[0]]);
      await page
        .getByRole("button", { name: "학습 자료 순서 이동", exact: true })
        .press("Home");
      await assertOrder(page, ids);
      const keyboardHandle = page.getByRole("button", {
        name: "학습 자료 순서 이동",
        exact: true,
      });
      assert(
        await keyboardHandle.evaluate((el) => el === document.activeElement),
      );
      await keyboardHandle.press("End");
      await assertOrder(page, [...ids.slice(1), ids[0]]);
      assert(
        await keyboardHandle.evaluate((el) => el === document.activeElement),
      );
      await keyboardHandle.press("Home");
      await keyboardHandle.press("ArrowDown");
      await keyboardHandle.press("ArrowDown");
      await assertOrder(page, [
        "maps",
        "wispi",
        "lesson",
        "avatar-shop",
        "weplay",
        "calendar",
      ]);
      assert(
        await keyboardHandle.evaluate((el) => el === document.activeElement),
      );
      await keyboardHandle.press("ArrowUp");
      await keyboardHandle.press("ArrowUp");
      await assertOrder(page, ids);
      const cdp = await page.context().newCDPSession(page);
      const handle = await page
        .getByRole("button", { name: "학습 자료 순서 이동", exact: true })
        .boundingBox();
      const third = await page
        .locator('[data-shortcut-id="wispi"]')
        .boundingBox();
      const x = handle.x + handle.width / 2,
        y = handle.y + handle.height / 2;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let i = 1; i <= 8; i++)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            { x, y: y + ((third.y + third.height / 2 - y) * i) / 8 },
          ],
        });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await assertOrder(page, [
        "maps",
        "wispi",
        "lesson",
        "avatar-shop",
        "weplay",
        "calendar",
      ]);
      await page
        .getByRole("button", { name: "학습 자료 순서 이동", exact: true })
        .press("ArrowUp");
      const result = [
        "maps",
        "lesson",
        "wispi",
        "avatar-shop",
        "weplay",
        "calendar",
      ];
      await assertOrder(page, result);
      await save(page);
      assert.deepEqual(store.get(uid).items, result);
      await page.context().close();
    },
  );
  await check(
    "failed save keeps draft, one retry succeeds, CAS conflict explicitly reloads",
    async () => {
      const uid = "recovery";
      seed(uid, ["lesson"]);
      const page = await pageFor(uid);
      await edit(page);
      await page
        .getByRole("button", { name: "역사 지도 추가", exact: true })
        .click();
      failures.push({ uid, action: "save", error: "합성 네트워크 오류" });
      await dialog(page)
        .getByRole("button", { name: "저장", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "합성 네트워크 오류" })
        .waitFor();
      await assertOrder(page, ["lesson", "maps"]);
      assert.equal(writes.filter((x) => x.uid === uid).length, 0);
      await save(page);
      assert.equal(writes.filter((x) => x.uid === uid).length, 1);
      await edit(page);
      await page
        .getByRole("button", { name: "캘린더 추가", exact: true })
        .click();
      store.set(uid, {
        items: ["weplay"],
        revision: store.get(uid).revision + 1,
      });
      await dialog(page)
        .getByRole("button", { name: "저장", exact: true })
        .click();
      await page.getByRole("alert").filter({ hasText: "다른 기기" }).waitFor();
      await assertOrder(page, ["lesson", "maps", "calendar"]);
      await page
        .getByRole("button", { name: "다시 불러오기", exact: true })
        .click();
      await assertOrder(page, ["weplay"]);
      assert(
        await dialog(page)
          .getByRole("button", { name: "저장", exact: true })
          .isDisabled(),
      );
      await page.context().close();
    },
  );
  await check(
    "initial read failure explicitly retries without polling or writes",
    async () => {
      const uid = "read_error";
      seed(uid, ["calendar"]);
      failures.push({ uid, action: "get", error: "합성 조회 오류" });
      const page = await pageFor(uid);
      await menu(page);
      await page.waitForFunction(() => window.shortcutQa.failedCalls === 1);
      await page
        .getByRole("menuitem", { name: "바로가기 편집", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "합성 조회 오류" })
        .waitFor();
      assert.equal(
        calls.filter((x) => x.uid === uid && x.action === "get").length,
        1,
        "Opening the error state does not poll",
      );
      await page
        .getByRole("button", { name: "다시 불러오기", exact: true })
        .click();
      await page
        .locator(".student-shortcuts-available")
        .waitFor({ state: "attached" });
      await assertOrder(page, ["calendar"]);
      assert.equal(
        calls.filter((x) => x.uid === uid && x.action === "get").length,
        2,
      );
      assert.equal(writes.filter((x) => x.uid === uid).length, 0);
      await page.context().close();
    },
  );
  await check(
    "hidden destinations disappear from saved shortcuts and cannot be added",
    async () => {
      const uid = "hidden";
      seed(uid, ids);
      const page = await pageFor(uid);
      await menu(page);
      await page.evaluate(() =>
        window.shortcutQa.change({
          config: {
            ...window.shortcutQa.context().config,
            showLesson: false,
            studentMenuVisibility: {
              wispi: false,
              avatar_shop: false,
              weplay: false,
            },
          },
        }),
      );
      await menu(page);
      await wait(async () =>
        (await page.getByRole("menuitem").allTextContents()).includes("캘린더"),
      );
      for (const label of labels.slice(0, 5))
        assert.equal(
          await page
            .getByRole("menuitem", { name: label, exact: true })
            .count(),
          0,
        );
      await edit(page);
      await page
        .getByRole("button", { name: "위스피 삭제", exact: true })
        .click();
      assert(
        await page
          .getByRole("button", { name: "위스피 추가", exact: true })
          .isDisabled(),
      );
      assert.equal(writes.filter((x) => x.uid === uid).length, 0);
      await page.context().close();
    },
  );
  for (const boundary of ["account", "session", "semester"])
    await check(`late read is discarded after ${boundary} change`, async () => {
      const uid = `late_${boundary}`;
      seed(uid, ["lesson"]);
      seed(`${uid}_next`, ["calendar"]);
      const hold = holdNext(uid, "get");
      const page = await pageFor(uid);
      await menu(page);
      await wait(() => hold.captured);
      store.set(uid, { items: ["calendar"], revision: 1 });
      await page.evaluate(
        ({ boundary, uid }) => {
          const qa = window.shortcutQa,
            c = qa.context();
          qa.change(
            boundary === "account"
              ? { uid: `${uid}_next` }
              : boundary === "session"
                ? { authGeneration: c.authGeneration + 1 }
                : { config: { ...c.config, semester: "1" } },
          );
        },
        { boundary, uid },
      );
      await page
        .getByRole("menu", { name: "학습 도구" })
        .waitFor({ state: "hidden" });
      await menu(page);
      await page
        .getByRole("menuitem", { name: "캘린더", exact: true })
        .waitFor();
      hold.release();
      await wait(() => calls.filter((x) => x.uid.startsWith(uid)).length >= 2);
      await edit(page);
      await assertOrder(page, ["calendar"]);
      assert.equal(writes.filter((x) => x.uid.startsWith(uid)).length, 0);
      await page.context().close();
    });
  await check(
    "duplicate save is locked and late save cannot revive another account editor",
    async () => {
      const uid = "late_save";
      seed(uid);
      seed(`${uid}_next`, ["calendar"]);
      const page = await pageFor(uid);
      await edit(page);
      await page
        .getByRole("button", { name: "학습 자료 추가", exact: true })
        .click();
      const hold = holdNext(uid, "save");
      await dialog(page)
        .getByRole("button", { name: "저장", exact: true })
        .click();
      await wait(() => hold.captured);
      assert(
        await dialog(page)
          .getByRole("button", { name: "저장 중…", exact: true })
          .isDisabled(),
      );
      await page.evaluate(
        (uid) => window.shortcutQa.change({ uid }),
        `${uid}_next`,
      );
      await dialog(page).waitFor({ state: "hidden" });
      await edit(page);
      await assertOrder(page, ["calendar"]);
      hold.release();
      await wait(() => writes.some((x) => x.uid === uid));
      await assertOrder(page, ["calendar"]);
      assert.equal(
        calls.filter((x) => x.uid === uid && x.action === "save").length,
        1,
      );
      await page.context().close();
    },
  );
  for (const width of [390, 768, 1280])
    await check(
      `visual CSS title20px transparent header ${width}px`,
      async () => {
        const uid = `visual_${width}`;
        seed(uid, ids);
        const page = await pageFor(uid, width);
        await edit(page);
        const styles = await page
          .locator(".student-shortcuts-heading")
          .evaluate((el) => {
            const h = getComputedStyle(el),
              t = getComputedStyle(el.querySelector("h2"));
            return {
              background: h.backgroundColor,
              shadow: h.boxShadow,
              position: h.position,
              minHeight: h.minHeight,
              titleFontSize: t.fontSize,
            };
          });
        assert.deepEqual(styles, {
          background: "rgba(0, 0, 0, 0)",
          shadow: "none",
          position: "static",
          minHeight: "0px",
          titleFontSize: "20px",
        });
        assert.equal(await page.getByRole("tooltip").count(), 0);
        await page.screenshot({
          path: path.join(evidence, `editor-${width}.png`),
        });
        await dialog(page)
          .getByRole("button", { name: "취소", exact: true })
          .click();
        await page.setViewportSize({ width, height: 460 });
        await menu(page);
        await page.screenshot({
          path: path.join(evidence, `long-menu-${width}.png`),
        });
        assert.equal(writes.filter((x) => x.uid === uid).length, 0);
        await page.context().close();
      },
    );
  for (const page of pages) assert.deepEqual(page.fixtureErrors, []);
  for (const file of ownedSources)
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(path.join(root, file)))
        .digest("hex"),
      sourceHashes[file],
      `${file} changed during verification; rerun the current source`,
    );
  const summary = {
    status: "PASS",
    checks,
    calls: calls.length,
    writes: writes.length,
    viewports: [390, 768, 1280],
    sourceHashes,
    actualComponents: [
      "StudentHistoryDictionaryController",
      "StudentLearningShortcutsEditor",
      "useStudentLearningShortcuts",
    ],
    syntheticOnly: true,
    productionReads: 0,
    productionWrites: 0,
  };
  await fs.writeFile(
    path.join(
      evidence,
      routesOnly
        ? "routes-summary.json"
        : remainingOnly
          ? "remaining-summary.json"
          : visualOnly
            ? "visual-summary.json"
            : "summary.json",
    ),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  for (const [index, page] of pages.entries())
    if (!page.isClosed())
      await page
        .screenshot({ path: path.join(evidence, `failure-${index}.png`) })
        .catch(() => undefined);
  throw error;
} finally {
  for (const hold of holds) hold.release();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
