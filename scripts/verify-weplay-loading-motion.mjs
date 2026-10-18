/** Actual loading/frame UI; no application services or production traffic. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence = path.resolve(
  process.env.WEPLAY_QA_EVIDENCE_DIR ||
    path.join(root, ".superloopy/yi-sunsin-lobby/loading-motion"),
);
await fs.mkdir(evidence, { recursive: true });
const modulePath = (relative) =>
  JSON.stringify(path.join(root, relative).replaceAll("\\", "/"));
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Frame from ${modulePath("src/components/common/weplay/WeplayGameFrame.tsx")};
function App(){const[busy,setBusy]=useState(false);const theme=new URLSearchParams(location.search).get('theme')||'naval';window.loadingMotionQA={setBusy};return <main className='weplay-game-page'><button id='start' onClick={()=>setBusy(true)}>출항 준비</button><Frame theme={theme} busy={busy} label='출항을 준비하고 있습니다'><button id='game-action'>게임 조작</button></Frame><div style={{height:1200}}/></main>}
createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "loading-motion-qa.js"),
  external: ["/assets/*"],
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/qa.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(js);
  }
  if (pathname === "/qa.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(css);
  }
  if (pathname.startsWith("/assets/")) {
    try {
      const file = path.resolve(root, "public", "." + pathname);
      if (!file.startsWith(path.join(root, "public") + path.sep))
        throw new Error("path");
      res.setHeader("Content-Type", "image/webp");
      return res.end(await fs.readFile(file));
    } catch {
      res.statusCode = 404;
      return res.end();
    }
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>*,::before,::after{box-sizing:border-box}body{margin:0;background:#e5e7eb;font-family:sans-serif}button{min-height:44px}.weplay-game-frame{background:#163c4e}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  errors = [];
const open = async (
  width,
  motion = "no-preference",
  theme = "naval",
  record = false,
) => {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    reducedMotion: motion,
    ...(record
      ? { recordVideo: { dir: evidence, size: { width: 640, height: 900 } } }
      : {}),
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === base
      ? route.continue()
      : route.abort(),
  );
  await page.goto(base + "/?theme=" + theme);
  await page.locator("#start").click();
  await page.locator(".weplay-game-loading").waitFor();
  if (theme === "naval")
    await page.waitForFunction(
      () =>
        document.querySelector(".weplay-game-loading").dataset.motion ===
        "running",
    );
  return { page, context };
};
const sample = (page) =>
  page.evaluate(() => ({
    ship: getComputedStyle(document.querySelector(".weplay-game-loading__ship"))
      .transform,
    waves: getComputedStyle(
      document.querySelector(".weplay-game-loading__wave"),
    ).transform,
    oars: getComputedStyle(document.querySelector(".weplay-game-loading__oars"))
      .transform,
    dots: [...document.querySelectorAll(".weplay-game-loading__dots i")].map(
      (el) => ({
        opacity: Number(getComputedStyle(el).opacity),
        transform: getComputedStyle(el).transform,
        time: el.getAnimations()[0]?.currentTime,
      }),
    ),
  }));
try {
  for (const width of [320, 390, 768, 1280]) {
    const { page, context } = await open(width);
    const bounds = await page.evaluate(() => {
      const frame = document
          .querySelector(".weplay-game-frame")
          .getBoundingClientRect(),
        overlay = document
          .querySelector(".weplay-game-loading")
          .getBoundingClientRect(),
        plaque = document
          .querySelector(".weplay-game-loading__plaque")
          .getBoundingClientRect();
      return {
        contained:
          plaque.left >= overlay.left &&
          plaque.right <= overlay.right &&
          plaque.top >= overlay.top &&
          plaque.bottom <= overlay.bottom,
        same:
          Math.abs(frame.left - overlay.left) < 1 &&
          Math.abs(frame.right - overlay.right) < 1 &&
          Math.abs(frame.top - overlay.top) < 1 &&
          Math.abs(frame.bottom - overlay.bottom) < 1,
        noOverflow: document.documentElement.scrollWidth <= innerWidth,
        focused:
          document.activeElement === document.querySelector("[role=status]"),
        inert: document.querySelector(".weplay-game-frame__body").inert,
        busy: document
          .querySelector(".weplay-game-frame")
          .getAttribute("aria-busy"),
      };
    });
    assert.deepEqual(bounds, {
      contained: true,
      same: true,
      noOverflow: true,
      focused: true,
      inert: true,
      busy: "true",
    });
    assert.equal(
      await page.getByRole("status").textContent(),
      "출항을 준비하고 있습니다",
    );
    await page.screenshot({
      path: path.join(evidence, "naval-loading-" + width + ".png"),
    });
    await page.evaluate(() => window.loadingMotionQA.setBusy(false));
    await page.locator(".weplay-game-loading").waitFor({ state: "hidden" });
    assert.equal(
      await page
        .locator("#start")
        .evaluate((el) => document.activeElement === el),
      true,
    );
    assert.equal(
      await page.locator(".weplay-game-frame__body").evaluate((el) => el.inert),
      false,
    );
    await context.close();
    checks.push(
      width + "px stage bounds, focus, busy/inert and completion cleanup",
    );
  }
  for (const motion of ["no-preference", "reduce"]) {
    const { page, context } = await open(390, motion, "naval", true);
    const samples = [];
    await page.screenshot({
      path: path.join(evidence, "naval-" + motion + "-a.png"),
    });
    for (let i = 0; i < 6; i++) {
      samples.push(await sample(page));
      await page.waitForTimeout(240);
    }
    await page.screenshot({
      path: path.join(evidence, "naval-" + motion + "-b.png"),
    });
    if (motion === "reduce") {
      assert.ok(
        samples.every(
          (value) =>
            value.ship === "none" &&
            value.waves === "none" &&
            value.oars === "none",
        ),
      );
      assert.ok(
        samples.every((value) =>
          value.dots.every((dot) => dot.transform === "none"),
        ),
      );
    } else {
      assert.ok(new Set(samples.map((value) => value.ship)).size > 1);
      assert.ok(new Set(samples.map((value) => value.waves)).size > 1);
      assert.ok(new Set(samples.map((value) => value.oars)).size > 1);
    }
    assert.ok(
      Math.max(...samples.map((value) => value.dots[0].opacity)) -
        Math.min(...samples.map((value) => value.dots[0].opacity)) >
        0.35,
    );
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(
      () =>
        document.querySelector(".weplay-game-loading").dataset.motion ===
        "paused",
    );
    const paused = await sample(page);
    await page.waitForTimeout(220);
    const still = await sample(page);
    assert.deepEqual(still, paused);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(
      () =>
        document.querySelector(".weplay-game-loading").dataset.motion ===
        "running",
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(
      () =>
        document.querySelector(".weplay-game-loading").dataset.motion ===
        "paused",
    );
    const hidden = await sample(page);
    await page.waitForTimeout(220);
    assert.deepEqual(await sample(page), hidden);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(
      () =>
        document.querySelector(".weplay-game-loading").dataset.motion ===
        "running",
    );
    await fs.writeFile(
      path.join(evidence, motion + "-samples.json"),
      JSON.stringify(samples, null, 2),
    );
    const video = page.video();
    await context.close();
    if (video)
      await video.saveAs(
        path.join(evidence, "naval-loading-" + motion + ".webm"),
      );
    checks.push(
      motion +
        " actual motion snapshots/video, offscreen pause, simulated document-hidden pause and resume",
    );
  }
  for (const motion of ["no-preference", "reduce"]) {
    const { page, context } = await open(390, motion, "yut");
    assert.equal(
      await page.locator(".weplay-game-loading__seal").textContent(),
      "W",
    );
    assert.equal(await page.locator(".weplay-game-loading__fleet").count(), 0);
    assert.ok(
      (
        await page
          .locator(".weplay-game-loading__plaque")
          .evaluate((el) => getComputedStyle(el).backgroundImage)
      ).includes("materials.webp"),
    );
    assert.equal(
      await page
        .locator(".weplay-game-loading__dots i")
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
      motion === "reduce" ? "none" : "weplay-game-wait",
    );
    await context.close();
    checks.push("Yut " + motion + " original plaque/motion retained");
  }
  assert.deepEqual(errors, []);
  const report = { passed: true, checks, errors };
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
