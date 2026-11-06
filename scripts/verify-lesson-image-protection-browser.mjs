/** Actual lesson UI, synthetic data, offline adapters; never reads or writes Firebase. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
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
const evidence = path.join(root, "output/lesson-image-protection");
await fs.mkdir(evidence, { recursive: true });
const tailwindCache = path.join(os.tmpdir(), "westory-tailwind-fixture.js");
let tailwind;
try {
  tailwind = await fs.readFile(tailwindCache, "utf8");
} catch {
  const response = await fetch("https://cdn.tailwindcss.com/3.4.17");
  assert(response.ok, "Tailwind fixture preparation failed");
  tailwind = await response.text();
  await fs.writeFile(tailwindCache, tailwind);
}
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const source = `import React from 'react';import{createRoot}from'react-dom/client';
import LessonContent from ${imp("src/pages/student/lesson/components/LessonContent.tsx")};
const params=new URLSearchParams(location.search);
const lesson={title:'이미지 저장 방지 검증',isVisibleToStudents:true,
contentHtml:'<p id="plain-text">선택 가능한 본문 [고조선]</p><img id="body-image" src="/image.svg" alt="본문 이미지"><a id="image-link" href="/image.svg"><img src="/image.svg" alt="연결 이미지"></a><a id="text-link" href="#reference">일반 텍스트 링크</a><p>[fn:image-note] [fn:archive-note]</p>',
worksheetPageImages:[{page:1,imageUrl:'/worksheet.svg',width:1000,height:1800}],
worksheetBlanks:[{id:'blank-1',page:1,leftRatio:.15,topRatio:.2,widthRatio:.2,heightRatio:.04,answer:'고조선',prompt:'빈칸'}],
worksheetFootnoteAnchors:[{id:'anchor-1',footnoteId:'image-note',page:1,leftRatio:.55,topRatio:.2,widthRatio:.05,heightRatio:.04}],
footnotes:[{id:'image-note',anchorKey:'image-note',title:'그림 각주',contentType:'image',imageUrl:'/image.svg',bodyHtml:'<p>각주 본문</p><img id="footnote-body-image" src="/image.svg" alt="각주 본문 이미지">',order:0},{id:'archive-note',anchorKey:'archive-note',title:'사료 각주',contentType:'sourceArchiveImage',sourceArchiveImagePath:'synthetic/archive.svg',order:1}]};
createRoot(document.getElementById('root')).render(<main style={{padding:12,maxWidth:1280,margin:'auto'}}><LessonContent unitId="fixture-unit" lessonOverride={lesson} disablePersistence={params.has('preview')} fullscreenPreview={params.has('fullscreen')} allowHiddenAccess={params.has('preview')} onClosePreview={()=>{}}/></main>);`;
const forbidden =
  "const forbidden=()=>{throw new Error('Unexpected data operation in offline fixture')};";
const adapters = new Map([
  [
    "AuthContext",
    "const config={year:2026,semester:2};export const useAuth=()=>({config,currentUser:null});",
  ],
  ["AppToastProvider", "export const useAppToast=()=>({showToast:()=>{}});"],
  [
    "firebase/firestore",
    forbidden +
      "export const collection=forbidden,doc=forbidden,getDoc=forbidden,getDocs=forbidden;",
  ],
  [
    "firebase/storage",
    "export const ref=(_storage,path)=>({path});export const getDownloadURL=async()=>'/image.svg';",
  ],
  [
    "firebase",
    forbidden +
      "export const db={};export const getHttpsCallable=forbidden;export const getFirebaseStorage=async()=>({});",
  ],
  ["points", forbidden + "export const claimPointActivityReward=forbidden;"],
  [
    "learningCommands",
    forbidden +
      "export const saveLessonAnswers=forbidden,recordLessonCorePointFind=forbidden,claimLessonCorePointReward=forbidden;",
  ],
  [
    "studentLessonReadCache",
    forbidden +
      "export const readStudentLesson=forbidden,readStudentVisibleLessons=forbidden;",
  ],
]);
const bundle = await build({
  stdin: { contents: source, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  outdir: "fixture",
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "offline-adapters",
      setup(build) {
        if (process.env.LESSON_IMAGE_PROTECTION_BASELINE) {
          build.onLoad({ filter: /[/\\]LessonContent\.tsx$/ }, () => ({
            contents: execFileSync(
              "git",
              [
                "show",
                `${process.env.LESSON_IMAGE_PROTECTION_BASELINE}:src/pages/student/lesson/components/LessonContent.tsx`,
              ],
              { cwd: root, encoding: "utf8" },
            ),
            loader: "tsx",
            resolveDir: path.join(root, "src/pages/student/lesson/components"),
          }));
        }
        build.onResolve({ filter: /./ }, (args) => {
          const key = args.path.startsWith("firebase/")
            ? args.path
            : args.path.split("/").at(-1);
          return adapters.has(key)
            ? { path: key, namespace: "offline" }
            : undefined;
        });
        build.onLoad({ filter: /.*/, namespace: "offline" }, (args) => ({
          contents: adapters.get(args.path),
          loader: "js",
        }));
      },
    },
  ],
});
const css =
  (
    await Promise.all(
      ["assets/css/style.css", "src/assets/index.css"].map((file) =>
        fs.readFile(path.join(root, file), "utf8"),
      ),
    )
  )
    .join("\n")
    .replaceAll(/@import[^;]+;/g, "")
    .replaceAll(/@tailwind[^;]+;/g, "") +
  bundle.outputFiles
    .filter((file) => file.path.endsWith(".css"))
    .map((file) => file.text)
    .join("\n");
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}body{margin:0}#root{min-width:0}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const svg = (worksheet) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${worksheet ? 1800 : 220}"><rect width="1000" height="2000" fill="white"/><text x="100" y="110" font-size="40">합성 검증 자료</text><text x="150" y="410" font-size="30">고조선</text></svg>`;
const server = http.createServer((req, res) => {
  const route = req.url.split("?")[0];
  res.setHeader(
    "Content-Type",
    route.endsWith(".js")
      ? "text/javascript"
      : route.endsWith(".svg")
        ? "image/svg+xml"
        : "text/html;charset=utf-8",
  );
  res.end(
    route === "/fixture.js"
      ? bundle.outputFiles.find((file) => file.path.endsWith(".js")).text
      : route === "/tailwind.js"
        ? tailwind
        : route.endsWith(".svg")
          ? svg(route === "/worksheet.svg")
          : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const reports = [];
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
const cancelled = (locator, type) =>
  locator.evaluate((element, type) => {
    const event =
      type === "contextmenu"
        ? new MouseEvent(type, { bubbles: true, cancelable: true, button: 2 })
        : new Event(type, { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, type);
async function protectedImage(
  page,
  selector,
  protectedMode,
  label,
  { stage = false } = {},
) {
  const locator = page.locator(selector).first();
  await locator.waitFor();
  assert.equal(
    await cancelled(locator, "contextmenu"),
    protectedMode,
    `${label}: image context menu`,
  );
  // The existing shared stage already blocks drag in teacher preview.
  assert.equal(
    await cancelled(locator, "dragstart"),
    protectedMode || stage,
    `${label}: image drag`,
  );
  const computed = await locator.evaluate((el) => ({
    select: getComputedStyle(el).userSelect,
    drag: getComputedStyle(el).getPropertyValue("-webkit-user-drag"),
  }));
  if (protectedMode) {
    assert.equal(computed.select, "none", `${label}: image selection`);
    assert.equal(computed.drag, "none", `${label}: native image drag`);
  }
}
try {
  for (const width of [390, 768, 1280])
    for (const mode of ["student", "fullscreen", "preview"]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        hasTouch: true,
      });
      const errors = [],
        external = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        if (route.request().url().startsWith(origin)) return route.continue();
        external.push(route.request().url());
        return route.abort();
      });
      await page.goto(`${origin}/?${mode === "student" ? "" : mode + "=1"}`);
      const worksheet = page.locator('img[alt="학습지 1페이지"]');
      await worksheet.waitFor();
      await settle(page);
      const protectedMode = mode !== "preview",
        label = `${mode}-${width}`;
      await protectedImage(
        page,
        'img[alt="학습지 1페이지"]',
        protectedMode,
        label,
        { stage: true },
      );
      assert.equal(
        await page.locator("[data-lesson-image-protection]").count(),
        protectedMode ? 1 : 0,
        `${label}: protection scope`,
      );
      await protectedImage(page, "#body-image", protectedMode, label);
      await protectedImage(page, "#image-link img", protectedMode, label);
      assert.equal(
        await cancelled(page.locator("#image-link"), "contextmenu"),
        protectedMode,
        `${label}: surrounding image link`,
      );
      assert.equal(
        await cancelled(page.locator("#image-link"), "dragstart"),
        protectedMode,
        `${label}: image link drag`,
      );
      for (const selector of [
        ".worksheet-blank-input",
        ".cloze-input",
        "#plain-text",
        "#text-link",
      ])
        assert.equal(
          await cancelled(page.locator(selector).first(), "contextmenu"),
          false,
          `${label}: ${selector} context menu preserved`,
        );
      for (const selector of [".worksheet-blank-input", ".cloze-input"]) {
        const input = page.locator(selector).first();
        await input.focus();
        await input.dispatchEvent("compositionstart", { data: "" });
        await input.fill("고");
        await input.dispatchEvent("compositionupdate", { data: "고" });
        await input.fill("고조선");
        await input.dispatchEvent("compositionend", { data: "고조선" });
        await settle(page);
        assert.equal(
          await input.inputValue(),
          "고조선",
          `${label}: IME value survives`,
        );
        await input.evaluate((el) => el.blur());
        await settle(page);
        assert.equal(
          await input.inputValue(),
          "고조선",
          `${label}: blur preserves value`,
        );
      }
      // Existing scrolling and zoom must remain interactive under the scoped handlers.
      await worksheet.scrollIntoViewIfNeeded();
      const before = await worksheet.boundingBox();
      await worksheet.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const emit = (type, gap) => {
          const touches = gap
            ? [
                new Touch({
                  identifier: 11,
                  target: el,
                  clientX: rect.x + 30,
                  clientY: rect.y + 80,
                }),
                new Touch({
                  identifier: 12,
                  target: el,
                  clientX: rect.x + 30 + gap,
                  clientY: rect.y + 80,
                }),
              ]
            : [];
          el.dispatchEvent(
            new TouchEvent(type, {
              bubbles: true,
              cancelable: true,
              touches,
              targetTouches: touches,
              changedTouches: touches,
            }),
          );
        };
        emit("touchstart", 80);
        emit("touchmove", 120);
        emit("touchend", 0);
      });
      await settle(page);
      assert(
        (await worksheet.boundingBox()).width > before.width * 1.05,
        `${label}: two-finger worksheet pinch zoom`,
      );
      for (let step = 0; step < 6; step++) {
        await worksheet.dispatchEvent("wheel", {
          deltaY: -700,
          deltaMode: 0,
          ctrlKey: true,
          clientX: before.x + 100,
          clientY: before.y + 100,
        });
        await settle(page);
      }
      assert(
        (await worksheet.boundingBox()).width > before.width * 1.05,
        `${label}: worksheet wheel zoom`,
      );
      const scroll = await worksheet.evaluate((img) => {
        const host = img.parentElement.parentElement;
        host.scrollTop = 100;
        return {
          top: host.scrollTop,
          height: host.scrollHeight,
          client: host.clientHeight,
          action: getComputedStyle(host).touchAction,
        };
      });
      assert(
        scroll.top > 0,
        `${label}: worksheet scroll remains available ${JSON.stringify(scroll)}`,
      );
      const touchAllowed = await worksheet.evaluate((el) => {
        const touch = new Touch({
          identifier: 1,
          target: el,
          clientX: 30,
          clientY: 30,
        });
        const event = new TouchEvent("touchstart", {
          bubbles: true,
          cancelable: true,
          touches: [touch],
          targetTouches: [touch],
          changedTouches: [touch],
        });
        el.dispatchEvent(event);
        return !event.defaultPrevented;
      });
      assert(touchAllowed, `${label}: single touch is not cancelled`);
      await page
        .locator('.lesson-footnote-trigger[data-anchor-key="image-note"]')
        .click();
      await protectedImage(page, 'img[alt="그림 각주"]', protectedMode, label);
      await protectedImage(page, "#footnote-body-image", protectedMode, label);
      await page
        .getByRole("button", { name: "닫기", exact: true })
        .last()
        .click();
      await page
        .locator('.lesson-footnote-trigger[data-anchor-key="archive-note"]')
        .click();
      await protectedImage(page, 'img[alt="사료 각주"]', protectedMode, label);
      await page
        .getByRole("button", { name: "닫기", exact: true })
        .last()
        .click();
      assert.deepEqual(errors, [], `${label}: no runtime errors`);
      assert.deepEqual(external, [], `${label}: no external requests`);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${label}: no page overflow`,
      );
      reports.push({
        label,
        protectedMode,
        contextMenu: true,
        drag: true,
        inputMenu: true,
        ime: true,
        scroll: true,
        zoom: true,
        pinch: true,
        footnotes: true,
      });
      await page.screenshot({
        path: path.join(evidence, `${label}.png`),
        fullPage: false,
      });
      await page.close();
      console.log(`${label}: passed`);
    }
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      {
        reports,
        limits:
          "Synthetic offline content and Edge touch emulation; native iOS Safari long-press menus require physical-device verification.",
      },
      null,
      2,
    ),
  );
  console.log("Lesson image protection browser checks passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
