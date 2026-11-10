import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const engines = [
  ...new Set(
    (
      process.env.LOADING_BROWSER_ENGINES ||
      process.env.PLAYWRIGHT_BROWSER_CHANNEL ||
      "msedge"
    )
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  ),
];
for (const engine of engines)
  assert.ok(
    ["chromium", "firefox", "webkit", "msedge", "chrome"].includes(engine),
    "Unknown browser: " + engine,
  );
const evidence =
  process.env.LOADING_EVIDENCE_DIR ||
  path.join(root, ".superloopy/sessions/logo-loading/evidence");
await fs.mkdir(evidence, { recursive: true });

const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {PageLoading, InlineLoading, LoadingOverlay} from './src/components/common/LoadingState';
const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'page';
const root = createRoot(document.getElementById('root'));
let key = 0;
const component = mode === 'inline' ? InlineLoading : mode === 'overlay' ? LoadingOverlay : PageLoading;
const render = (node) => flushSync(() => root.render(params.has('strict') ? React.createElement(React.StrictMode, null, node) : node));
const loading = () => mode === 'multiple' ? React.createElement(React.Fragment, null, React.createElement(InlineLoading, {key:'a'+key}), React.createElement(InlineLoading, {key:'b'+key})) : React.createElement(component, {key, message:'OLD MESSAGE', detail:'OLD DETAIL', warning:'OLD WARNING'});
window.startLoading = () => render(loading());
window.replaceLoading = () => { key++; render(loading()); };
window.finishLoading = (error=false) => render(React.createElement('main', null, React.createElement('h1', null, error ? '연결 오류' : '준비 완료'), React.createElement('button', {onClick: error ? window.startLoading : () => { window.clicked = true; }}, error ? '다시 시도' : '계속')));
window.instantLoading = () => { window.startLoading(); window.finishLoading(); };
window.unmountLoading = () => root.unmount();
window.startLoading();
`;
const files = new Map();
let css = "";
for (const env of ["production", "development"]) {
  const bundle = await build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    format: "esm",
    outfile: env === "production" ? "fixture.js" : "fixture-dev.js",
    loader: { ".webp": "file" },
    publicPath: "/",
    define: { "process.env.NODE_ENV": JSON.stringify(env) },
  });
  for (const file of bundle.outputFiles) {
    files.set("/" + path.basename(file.path), file.contents);
    if (file.path.endsWith(".css")) css = file.text;
  }
}
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (files.has(pathname)) {
    res.setHeader(
      "Content-Type",
      pathname.endsWith(".webp")
        ? "image/webp"
        : pathname.endsWith(".css")
          ? "text/css"
          : "text/javascript",
    );
    res.end(files.get(pathname));
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:Noto Sans KR,sans-serif;background:#f9fafb}.z-\\[90\\]{z-index:90}' +
      css +
      '</style><div id="root"></div><script type="module" src="' +
      (req.url.includes("strict") ? "/fixture-dev.js" : "/fixture.js") +
      '"></script></html>',
  );
});
await new Promise((resolve) =>
  server.listen(
    Number(process.env.LOADING_PREVIEW_PORT || 0),
    "127.0.0.1",
    resolve,
  ),
);
const url = "http://127.0.0.1:" + server.address().port;
if (process.env.LOADING_PREVIEW_ONLY === "1") {
  console.log("Loading preview: " + url);
  await new Promise(() => {});
}

async function makePage(browser, scenario = "normal", options = {}) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "no-preference",
    ...options,
  });
  page.setDefaultTimeout(5000);
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      type: request.resourceType(),
    }),
  );
  await page.route("**/*", (route) =>
    route.request().url().startsWith(url) ? route.continue() : route.abort(),
  );
  await page.addInitScript((scenario) => {
    const listeners = new Map(),
      targets = [],
      observers = [],
      exits = [];
    let frameCalls = 0,
      timerCalls = 0,
      disconnects = 0;
    const raf = window.requestAnimationFrame?.bind(window);
    if (raf)
      window.requestAnimationFrame = (...args) => {
        frameCalls++;
        return raf(...args);
      };
    const timeout = window.setTimeout.bind(window),
      interval = window.setInterval.bind(window);
    window.setTimeout = (...args) => {
      timerCalls++;
      return timeout(...args);
    };
    window.setInterval = (...args) => {
      timerCalls++;
      return interval(...args);
    };
    for (const [target, types] of [
      [document, ["visibilitychange"]],
      [window, ["pagehide", "pageshow"]],
    ]) {
      const add = target.addEventListener.bind(target),
        remove = target.removeEventListener.bind(target);
      target.addEventListener = (type, listener, options) => {
        if (types.includes(type)) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type).add(listener);
        }
        return add(type, listener, options);
      };
      target.removeEventListener = (type, listener, options) => {
        listeners.get(type)?.delete(listener);
        return remove(type, listener, options);
      };
    }
    const NativeObserver = window.IntersectionObserver;
    if (NativeObserver)
      window.IntersectionObserver = class extends NativeObserver {
        constructor(callback, options) {
          super(callback, options);
          observers.push(() => callback([{ isIntersecting: true }], this));
        }
        observe(target) {
          targets.push(target.tagName);
          super.observe(target);
        }
        disconnect() {
          disconnects++;
          super.disconnect();
        }
      };
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (
            !(node instanceof Element) ||
            !node.matches(".ws-loading__logo--exit")
          )
            continue;
          const animations = node.getAnimations({ subtree: true });
          exits.push({
            ariaHidden: node.getAttribute("aria-hidden"),
            pointerEvents: getComputedStyle(node).pointerEvents,
            animations: animations.map((animation) => ({
              duration: animation.effect.getTiming().duration,
              frames: animation.effect
                .getKeyframes()
                .map(({ transform, opacity }) => ({ transform, opacity })),
            })),
          });
        }
    }).observe(document, { subtree: true, childList: true });
    if (scenario === "missing-matchMedia") window.matchMedia = undefined;
    if (scenario === "legacy-matchMedia") {
      const match = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const result = match(query);
        return {
          get matches() {
            return result.matches;
          },
          media: result.media,
          addListener: result.addListener.bind(result),
          removeListener: result.removeListener.bind(result),
        };
      };
    }
    if (scenario === "missing-IntersectionObserver")
      window.IntersectionObserver = undefined;
    if (scenario === "missing-requestAnimationFrame")
      window.requestAnimationFrame = undefined;
    if (scenario === "missing-cancelAnimationFrame")
      window.cancelAnimationFrame = undefined;
    if (scenario === "missing-animate")
      SVGElement.prototype.animate = undefined;
    window.loadingQA = {
      state: () => ({
        frameCalls,
        timerCalls,
        disconnects,
        targets,
        exits,
        listeners: Object.fromEntries(
          [...listeners].map(([type, set]) => [type, set.size]),
        ),
      }),
      setHidden: (hidden) => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => hidden,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      },
      staleIntersection: () => observers.forEach((callback) => callback()),
    };
  }, scenario);
  return { page, errors, requests };
}
const snapshot = (page) =>
  page.evaluate(() => ({
    letters: [...document.querySelectorAll("[data-loading-letter]")].map(
      (node) => getComputedStyle(node).transform,
    ),
    fill: getComputedStyle(document.querySelector("[data-loading-fill]"))
      .transform,
  }));
async function waitRunning(page) {
  await page.locator(".ws-loading:not(.ws-loading--paused)").first().waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".ws-loading__letter")?.getAnimations().length > 0,
    null,
    { polling: 50 },
  );
}
async function assertMotion(page, label) {
  const samples = [];
  for (let i = 0; i < 7; i++) {
    samples.push(await snapshot(page));
    await page.waitForTimeout(180);
  }
  for (let i = 0; i < 7; i++)
    assert.ok(
      new Set(samples.map((sample) => sample.letters[i])).size > 1,
      label + ": letter " + i + " animates",
    );
  assert.ok(
    new Set(samples.map((sample) => sample.fill)).size > 1,
    label + ": color progresses",
  );
  assert.ok(
    samples.some((sample) => new Set(sample.letters).size > 1),
    label + ": independent staggered glyphs",
  );
  return label;
}
async function assertPaused(page, label) {
  await page.locator(".ws-loading--paused").waitFor();
  // CSS pause resolves on the next animation timeline tick in Chromium/WebKit.
  await page.waitForTimeout(60);
  const before = await snapshot(page);
  await page.waitForTimeout(220);
  assert.deepEqual(
    await snapshot(page),
    before,
    label + ": all visual motion pauses",
  );
  assert.ok(
    (
      await page
        .locator("[data-loading-letter], [data-loading-fill]")
        .evaluateAll((nodes) =>
          nodes.map((node) => getComputedStyle(node).animationPlayState),
        )
    ).every((state) => state === "paused"),
  );
}
async function assertCleanup(page, observerExpected = true) {
  await page.evaluate(() => window.unmountLoading());
  await page.waitForFunction(
    () => document.querySelectorAll(".ws-loading__logo").length === 0,
    null,
    { polling: 25 },
  );
  await page.evaluate(() => {
    window.loadingQA.setHidden(false);
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));
    window.loadingQA.staleIntersection();
  });
  const state = await page.evaluate(() => window.loadingQA.state());
  assert.equal(await page.locator(".ws-loading").count(), 0);
  assert.ok(
    Object.values(state.listeners).every((count) => count === 0),
    "all lifecycle and exit listeners removed",
  );
  if (observerExpected)
    assert.ok(state.disconnects > 0, "intersection disconnected");
}
async function checkLayout(page, width, label, directory) {
  await page.setViewportSize({ width, height: 900 });
  await page.locator("[data-loading-letter]").first().waitFor();
  assert.equal(await page.getByRole("status", { name: "처리 중" }).count(), 1);
  assert.equal(
    (await page.locator("#root").textContent()).replace(/\s+/g, ""),
    "",
  );
  assert.equal(await page.locator("[data-loading-letter]").count(), 7);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    label + ": no horizontal overflow",
  );
  const box = await page.locator(".ws-loading__logo").boundingBox();
  assert.ok(
    Math.abs(box.x + box.width / 2 - width / 2) < 1,
    label + ": centered",
  );
  await page.screenshot({ path: path.join(directory, label + ".png") });
}
async function seekFill(page, ms) {
  return page.evaluate((ms) => {
    const node = document.querySelector("[data-loading-fill]");
    const animation = node.getAnimations()[0];
    animation.pause();
    animation.currentTime = ms;
    return new DOMMatrixReadOnly(getComputedStyle(node).transform).a;
  }, ms);
}
async function checkExit(page, error = false) {
  await page.waitForTimeout(150);
  const oldExits = await page.evaluate(
    () => window.loadingQA.state().exits.length,
  );
  await page.evaluate((error) => window.finishLoading(error), error);
  await page
    .getByRole("heading", { name: error ? "연결 오류" : "준비 완료" })
    .waitFor();
  await page.waitForFunction(
    (old) => window.loadingQA.state().exits.length > old,
    oldExits,
    { polling: 10 },
  );
  const exit = await page.evaluate(() => window.loadingQA.state().exits.at(-1));
  assert.equal(exit.ariaHidden, "true");
  assert.equal(exit.pointerEvents, "none");
  assert.deepEqual(
    exit.animations
      .map((animation) => animation.duration)
      .sort((a, b) => a - b),
    [180, 240],
  );
  const fill = exit.animations.find((animation) => animation.duration === 180);
  assert.equal(fill.frames.at(-1).transform, "scaleX(1)");
  if (!error) {
    await page.getByRole("button", { name: "계속" }).click();
    assert.equal(await page.evaluate(() => window.clicked), true);
  }
  await page.waitForFunction(
    () => document.querySelectorAll(".ws-loading__logo--exit").length === 0,
    null,
    { polling: 25 },
  );
  return exit;
}

async function runEngine(engine) {
  const type = ["msedge", "chrome"].includes(engine) ? "chromium" : engine;
  const browser = await playwright[type].launch({
    headless: true,
    ...(type !== engine ? { channel: engine } : {}),
  });
  const directory = path.join(evidence, engine);
  await fs.mkdir(directory, { recursive: true });
  const result = {
    engine,
    version: browser.version(),
    checks: [],
    motion: [],
    compatibility: [],
  };
  try {
    const main = await makePage(browser),
      { page } = main;
    await page.goto(url);
    await waitRunning(page);
    for (const mode of ["page", "inline", "overlay"]) {
      await page.goto(url + "?mode=" + mode);
      await waitRunning(page);
      for (const width of [320, 390, 768, 1280, 1440])
        await checkLayout(page, width, mode + "-" + width, directory);
    }
    result.checks.push(
      "Page/inline/overlay at 320/390/768/1280/1440px: seven glyphs, accessible status, centered, no horizontal overflow",
    );
    await page.goto(url);
    await waitRunning(page);
    result.motion.push(await assertMotion(page, "no-preference"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    result.motion.push(await assertMotion(page, "runtime reduce"));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    result.motion.push(await assertMotion(page, "runtime no-preference"));
    const activityBefore = await page.evaluate(() => window.loadingQA.state());
    await page.waitForTimeout(500);
    const activityAfter = await page.evaluate(() => window.loadingQA.state());
    assert.equal(
      activityAfter.frameCalls,
      activityBefore.frameCalls,
      "no animation frame loop",
    );
    assert.equal(
      activityAfter.timerCalls,
      activityBefore.timerCalls,
      "no animation timer loop",
    );
    const times = [0, 1500, 4500, 10500, 19500, 30000, 60000],
      fills = [];
    for (const time of times) fills.push(await seekFill(page, time));
    assert.deepEqual(
      fills.map((value) => +value.toFixed(2)),
      [0, 0.32, 0.58, 0.78, 0.89, 0.94, 0.94],
    );
    const rates = fills
      .slice(1, -1)
      .map((value, i) => (value - fills[i]) / (times[i + 1] - times[i]));
    assert.ok(
      rates.every((rate, i) => i === 0 || rate < rates[i - 1]),
      "pending color slows and never completes early",
    );
    result.fill = { times, fills };
    await seekFill(page, 4500);
    await page.screenshot({ path: path.join(directory, "partial-color.png") });
    await page.goto(url);
    await waitRunning(page);
    assert.deepEqual(
      await page.evaluate(() => window.loadingQA.state().targets),
      ["DIV"],
    );
    await page.evaluate(() => window.loadingQA.setHidden(true));
    await assertPaused(page, "hidden");
    await page.evaluate(() => window.loadingQA.setHidden(false));
    await waitRunning(page);
    result.motion.push(await assertMotion(page, "visible resumes"));
    await page.evaluate(() => {
      document.querySelector(".ws-loading-page").style.marginTop = "2000px";
    });
    await assertPaused(page, "offscreen");
    await page.evaluate(() => {
      document.querySelector(".ws-loading-page").style.marginTop = "0";
      window.scrollTo(0, 0);
    });
    await waitRunning(page);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await assertPaused(page, "pagehide");
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) window.dispatchEvent(new Event("pageshow"));
    });
    await waitRunning(page);
    result.motion.push(await assertMotion(page, "pageshow resumes"));
    assert.equal(
      await page.evaluate(() => window.loadingQA.state().listeners.pageshow),
      1,
    );
    await assertCleanup(page);
    assert.deepEqual(main.errors, []);
    result.checks.push(
      "CSS-only motion: no requestAnimationFrame/timer loop; slow 94% plateau; hidden/offscreen/pagehide pause and clean resume/unmount",
    );
    await page.close();

    const mobile = await makePage(browser, "normal", {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      ...(type !== "firefox" ? { isMobile: true } : {}),
      reducedMotion: "reduce",
    });
    await mobile.page.goto(url);
    await waitRunning(mobile.page);
    result.motion.push(await assertMotion(mobile.page, "initial reduce touch"));
    await checkLayout(mobile.page, 390, "touch-reduce-390", directory);
    await checkLayout(mobile.page, 320, "touch-reduce-320", directory);
    await assertCleanup(mobile.page);
    assert.deepEqual(mobile.errors, []);
    await mobile.page.close();

    for (const scenario of [
      "missing-matchMedia",
      "legacy-matchMedia",
      "missing-IntersectionObserver",
      "missing-requestAnimationFrame",
      "missing-cancelAnimationFrame",
      "missing-animate",
    ]) {
      const c = await makePage(browser, scenario, { reducedMotion: "reduce" });
      await c.page.goto(url);
      await waitRunning(c.page);
      await assertMotion(c.page, scenario);
      await assertCleanup(c.page, scenario !== "missing-IntersectionObserver");
      assert.deepEqual(c.errors, []);
      result.compatibility.push(scenario);
      await c.page.close();
    }
    const life = await makePage(browser),
      lp = life.page;
    await lp.goto(url);
    await waitRunning(lp);
    result.fastExit = await checkExit(lp);
    await lp.evaluate(() => window.startLoading());
    await waitRunning(lp);
    await seekFill(lp, 30000);
    result.slowExit = await checkExit(lp, true);
    await lp.getByRole("button", { name: "다시 시도" }).click();
    await waitRunning(lp);
    await assertMotion(lp, "error retry restarts");
    const before = await lp.evaluate(
      () => window.loadingQA.state().exits.length,
    );
    await lp.evaluate(() => window.replaceLoading());
    await waitRunning(lp);
    await lp.waitForTimeout(300);
    assert.equal(
      await lp.evaluate(() => window.loadingQA.state().exits.length),
      before,
      "continuous same-place loading must not finish visually",
    );
    await lp.evaluate(() => window.finishLoading());
    await lp.waitForTimeout(300);
    const instantBefore = await lp.evaluate(
      () => window.loadingQA.state().exits.length,
    );
    await lp.evaluate(() => window.instantLoading());
    await lp.waitForTimeout(300);
    assert.equal(
      await lp.evaluate(() => window.loadingQA.state().exits.length),
      instantBefore,
      "sub-100ms waits do not flash an exit",
    );
    await lp.evaluate(() => window.startLoading());
    await waitRunning(lp);
    await lp.waitForTimeout(150);
    await lp.evaluate(() => {
      window.finishLoading();
      queueMicrotask(() => window.loadingQA.setHidden(true));
    });
    await lp.waitForTimeout(100);
    assert.equal(
      await lp.locator(".ws-loading__logo--exit").count(),
      0,
      "hidden exit cleans up",
    );
    await assertCleanup(lp);
    assert.deepEqual(life.errors, []);
    await lp.close();
    result.checks.push(
      "Fast and slow exits fully fill in 180ms/fade in 240ms without blocking content; errors remain actionable, retry resets; rapid and consecutive loading have no false exit",
    );

    for (const mode of ["page", "multiple"]) {
      const strict = await makePage(browser),
        sp = strict.page;
      await sp.goto(url + "?strict=1&mode=" + mode);
      await waitRunning(sp);
      await sp.waitForTimeout(180);
      assert.equal(
        await sp.locator(".ws-loading__logo--exit").count(),
        0,
        "StrictMode leaves no ghost",
      );
      const ids = await sp
        .locator("clipPath[id]")
        .evaluateAll((nodes) => nodes.map((n) => n.id));
      assert.equal(
        new Set(ids).size,
        ids.length,
        "multiple instances have unique clips",
      );
      const expected = mode === "multiple" ? 2 : 1;
      assert.equal(
        await sp.evaluate(
          () => window.loadingQA.state().listeners.visibilitychange,
        ),
        expected,
        "StrictMode keeps one listener per loader",
      );
      await assertCleanup(sp);
      assert.deepEqual(strict.errors, []);
      await sp.close();
    }
    result.checks.push(
      "Development StrictMode cleanup and multiple-instance unique IDs/lifecycle listeners",
    );
    const network = await makePage(browser),
      np = network.page;
    await np.goto(url + "?mode=multiple");
    await waitRunning(np);
    await np.waitForTimeout(1200);
    assert.equal(
      network.requests.filter((r) => r.type === "image").length,
      1,
      "one shared optimized logo fetch for multiple loaders",
    );
    assert.ok(
      network.requests.every(
        (r) =>
          r.url.startsWith(url) &&
          r.method === "GET" &&
          !["fetch", "xhr", "websocket"].includes(r.type),
      ),
      "no backend calls, writes or external media requests",
    );
    result.network = network.requests;
    await assertCleanup(np);
    assert.deepEqual(network.errors, []);
    await np.close();
    result.checks.push(
      "Exactly one shared WebP fetch; no fetch/XHR/WebSocket, writes, polling or external requests",
    );
    result.passed = true;
  } catch (error) {
    result.passed = false;
    result.error = error.stack || String(error);
    for (const [i, page] of browser
      .contexts()
      .flatMap((c) => c.pages())
      .entries())
      await page
        .screenshot({ path: path.join(directory, `failure-${i}.png`) })
        .catch(() => {});
  } finally {
    await browser.close();
    await fs.writeFile(
      path.join(directory, "loading-checks.json"),
      JSON.stringify(result, null, 2),
    );
  }
  return result;
}
const results = [];
try {
  for (const engine of engines) {
    try {
      results.push(await runEngine(engine));
    } catch (error) {
      results.push({
        engine,
        passed: false,
        error: error.stack || String(error),
      });
    }
    const latest = results.at(-1);
    console.log(
      `${engine}: ${latest.passed ? "PASS" : "FAIL"}${latest.error ? "\n" + latest.error : ""}`,
    );
  }
  await fs.writeFile(
    path.join(evidence, "loading-checks.json"),
    JSON.stringify(
      {
        engines,
        results,
        limitations:
          "Automated desktop engines and emulated touch viewports; no physical iOS/Android device verification.",
      },
      null,
      2,
    ),
  );
  assert.ok(
    results.length > 0 && results.every((result) => result.passed),
    "One or more loading browser checks failed",
  );
  console.log("Evidence: " + evidence);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
