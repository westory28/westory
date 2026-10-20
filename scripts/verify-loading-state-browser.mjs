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
// Preserve the existing system-Edge default; opt into installed browser engines.
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
    "Unknown loading browser: " + engine,
  );
const evidence =
  process.env.LOADING_EVIDENCE_DIR ||
  path.join(root, ".superloopy/sessions/globe-loading/evidence");
await fs.mkdir(evidence, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      "import React from 'react';import{createRoot}from'react-dom/client';import{PageLoading,InlineLoading,LoadingOverlay}from'./src/components/common/LoadingState';const mode=new URLSearchParams(location.search).get('mode');const root=createRoot(document.getElementById('root'));window.unmountLoading=()=>root.unmount();root.render(React.createElement(mode==='inline'?InlineLoading:mode==='overlay'?LoadingOverlay:PageLoading,{message:'OLD MESSAGE',detail:'OLD DETAIL',warning:'OLD WARNING'}));",
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "esm",
  outfile: "fixture.js",
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:Noto Sans KR,sans-serif;background:#f9fafb}.z-\\[90\\]{z-index:90}' +
  css +
  '</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/fixture.js" ? "text/javascript" : "text/html; charset=utf-8",
  );
  res.end(req.url === "/fixture.js" ? js : html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;

// Keep native rendering/intersections; only explicit compatibility cases omit APIs.
async function makePage(browser, scenario = "normal", options = {}) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "no-preference",
    ...options,
  });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(url) ? route.continue() : route.abort(),
  );
  await page.addInitScript((scenario) => {
    const frames = new Set(),
      timers = new Set(),
      listeners = new Map(),
      targets = [],
      observers = [];
    let frameCalls = 0,
      timerCalls = 0,
      disconnects = 0;
    const originalRaf = window.requestAnimationFrame?.bind(window),
      originalCancel = window.cancelAnimationFrame?.bind(window);
    if (originalRaf)
      window.requestAnimationFrame = (callback) => {
        const handle = originalRaf((time) => {
          frames.delete(handle);
          frameCalls++;
          callback(time);
        });
        frames.add(handle);
        return handle;
      };
    if (originalCancel)
      window.cancelAnimationFrame = (handle) => {
        frames.delete(handle);
        originalCancel(handle);
      };
    const originalTimeout = window.setTimeout.bind(window),
      originalClear = window.clearTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => {
      if (typeof callback !== "function" || delay < 30 || delay > 34)
        return originalTimeout(callback, delay, ...args);
      const handle = originalTimeout(() => {
        timers.delete(handle);
        timerCalls++;
        callback(...args);
      }, delay);
      timers.add(handle);
      return handle;
    };
    window.clearTimeout = (handle) => {
      timers.delete(handle);
      originalClear(handle);
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
    if (scenario === "missing-matchMedia") window.matchMedia = undefined;
    if (scenario === "legacy-matchMedia") {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const result = original(query);
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
    window.loadingQA = {
      state: () => ({
        pendingFrames: frames.size,
        pendingTimers: timers.size,
        frameCalls,
        timerCalls,
        targets,
        disconnects,
        listeners: Object.fromEntries(
          [...listeners].map(([type, set]) => [type, set.size]),
        ),
      }),
      setHidden: (hidden) => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => hidden,
        });
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => (hidden ? "hidden" : "visible"),
        });
        document.dispatchEvent(new Event("visibilitychange"));
      },
      fireStaleIntersection: () => observers.forEach((callback) => callback()),
    };
  }, scenario);
  return { page, errors };
}
const snapshot = (page) =>
  page.evaluate(() => ({
    land: document.querySelector("[data-land]")?.getAttribute("d"),
    orbit: document
      .querySelector("[data-orbit-front]")
      ?.getAttribute("transform"),
    dots: [...document.querySelectorAll(".ws-loading__dots span")]
      .map((node) => getComputedStyle(node).opacity)
      .join(","),
  }));
async function waitRunning(page) {
  await page.locator(".ws-loading:not(.ws-loading--paused)").waitFor();
  await page.waitForFunction(
    () => {
      const state = window.loadingQA.state();
      return state.pendingFrames + state.pendingTimers > 0;
    },
    null,
    { polling: 50 },
  );
}
async function assertMotion(page, label, dots = false) {
  const samples = [await snapshot(page)];
  for (let i = 0; i < (dots ? 5 : 2); i++) {
    // Wall time checks computed CSS dots as well as JavaScript SVG frames.
    await page.waitForTimeout(dots ? 230 : 150);
    samples.push(await snapshot(page));
  }
  for (const key of dots ? ["land", "orbit", "dots"] : ["land", "orbit"])
    assert.ok(
      new Set(samples.map((sample) => sample[key])).size > 1,
      label + ": " + key + " must animate",
    );
  return {
    label,
    dots: dots ? samples.map((sample) => sample.dots) : undefined,
  };
}
async function assertPaused(page, label) {
  await page.locator(".ws-loading--paused").waitFor();
  const before = await snapshot(page);
  await page.waitForTimeout(180);
  const after = await snapshot(page);
  assert.equal(after.land, before.land, label + ": land must pause");
  assert.equal(after.orbit, before.orbit, label + ": orbit must pause");
  assert.deepEqual(
    await page
      .locator(".ws-loading__dots span")
      .evaluateAll((nodes) =>
        nodes.map((node) => getComputedStyle(node).animationPlayState),
      ),
    ["paused", "paused", "paused"],
  );
  const state = await page.evaluate(() => window.loadingQA.state());
  assert.equal(
    state.pendingFrames + state.pendingTimers,
    0,
    label + ": scheduled animation must be cancelled",
  );
}
async function assertCleanup(page, observerExpected = true) {
  await page.evaluate(() => window.unmountLoading());
  const before = await page.evaluate(() => window.loadingQA.state());
  await page.evaluate(() => {
    window.loadingQA.setHidden(false);
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));
    window.loadingQA.fireStaleIntersection();
  });
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.loadingQA.state());
  assert.equal(await page.locator(".ws-loading").count(), 0);
  assert.equal(
    after.pendingFrames + after.pendingTimers,
    0,
    "unmount must cancel outstanding animation",
  );
  assert.equal(
    after.frameCalls + after.timerCalls,
    before.frameCalls + before.timerCalls,
    "unmounted callbacks must not restart animation",
  );
  assert.ok(
    Object.values(after.listeners).every((count) => count === 0),
    "unmount must remove lifecycle listeners",
  );
  if (observerExpected)
    assert.ok(
      after.disconnects > 0,
      "unmount must disconnect intersection observer",
    );
  return after;
}
async function checkLayout(page, width, label, directory) {
  await page.setViewportSize({ width, height: 900 });
  await page.locator(".ws-loading__land").waitFor();
  assert.equal(await page.getByRole("status", { name: "처리 중" }).count(), 1);
  assert.equal(
    (await page.locator("#root").textContent()).replace(/\s+/g, ""),
    "Westory처리중...",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    label + ": no horizontal overflow",
  );
  const box = await page.locator(".ws-loading").boundingBox();
  assert.ok(
    Math.abs(box.x + box.width / 2 - width / 2) < 1,
    label + ": centered loading",
  );
  await page.screenshot({ path: path.join(directory, label + ".png") });
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
    orbit: [],
  };
  try {
    const { page, errors } = await makePage(browser);
    await page.goto(url);
    await waitRunning(page);
    for (const width of [320, 390, 768, 1280])
      await checkLayout(page, width, "page-" + width, directory);
    result.checks.push(
      "320/390/768/1280px: accessible status, centered, no old copy or horizontal overflow",
    );
    result.motion.push(await assertMotion(page, "no-preference", true));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await waitRunning(page);
    result.motion.push(
      await assertMotion(page, "runtime switch to reduce", true),
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    result.motion.push(
      await assertMotion(page, "runtime switch back to no-preference", true),
    );
    for (const mode of ["inline", "overlay"]) {
      await page.goto(url + "?mode=" + mode);
      await waitRunning(page);
      await checkLayout(page, 1280, mode + "-1280", directory);
      result.motion.push(await assertMotion(page, mode));
    }
    await page.goto(url);
    await waitRunning(page);
    assert.deepEqual(
      await page.evaluate(() => window.loadingQA.state().targets),
      ["DIV"],
      "intersection must observe HTML loading container",
    );
    await page.evaluate(() => window.loadingQA.setHidden(true));
    await assertPaused(page, "hidden document");
    await page.evaluate(() => window.loadingQA.setHidden(false));
    await waitRunning(page);
    await assertMotion(page, "visible document resumes");
    await page.evaluate(() => {
      document.querySelector(".ws-loading-page").style.marginTop = "2000px";
    });
    await assertPaused(page, "offscreen");
    await page.evaluate(() => {
      document.querySelector(".ws-loading-page").style.marginTop = "0";
      window.scrollTo(0, 0);
    });
    await waitRunning(page);
    await assertMotion(page, "onscreen resumes");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await assertPaused(page, "pagehide");
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) window.dispatchEvent(new Event("pageshow"));
    });
    await waitRunning(page);
    await assertMotion(page, "pageshow resumes");
    assert.equal(
      await page.evaluate(() => {
        const s = window.loadingQA.state();
        return s.pendingFrames + s.pendingTimers;
      }),
      1,
      "repeated pageshow must keep a single animation loop",
    );
    await assertCleanup(page);
    assert.deepEqual(errors, []);
    result.checks.push(
      "native HTML intersection, hidden/offscreen/pagehide pause and return/pageshow resume; single loop and unmount cleanup",
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
    await checkLayout(mobile.page, 390, "touch-reduce-390", directory);
    result.motion.push(
      await assertMotion(
        mobile.page,
        "touch viewport with reduce on initial load",
        true,
      ),
    );
    await checkLayout(mobile.page, 320, "touch-reduce-320", directory);
    await assertCleanup(mobile.page);
    assert.deepEqual(mobile.errors, []);
    await mobile.page.close();
    result.checks.push(
      "390/320px touch viewport under initial reduced-motion (browser emulation, not physical device)",
    );

    for (const scenario of [
      "missing-matchMedia",
      "legacy-matchMedia",
      "missing-IntersectionObserver",
      "missing-requestAnimationFrame",
      "missing-cancelAnimationFrame",
    ]) {
      const compatibility = await makePage(browser, scenario, {
        reducedMotion: "reduce",
      });
      await compatibility.page.goto(url);
      await waitRunning(compatibility.page);
      await assertMotion(compatibility.page, scenario);
      const state = await compatibility.page.evaluate(() =>
        window.loadingQA.state(),
      );
      if (scenario.includes("AnimationFrame")) {
        assert.ok(
          state.timerCalls > 0 &&
            state.pendingTimers === 1 &&
            state.pendingFrames === 0,
          scenario + ": use one timer fallback loop",
        );
        await compatibility.page.evaluate(() =>
          window.loadingQA.setHidden(true),
        );
        await assertPaused(compatibility.page, scenario + " hidden");
        await compatibility.page.evaluate(() =>
          window.loadingQA.setHidden(false),
        );
        await waitRunning(compatibility.page);
        await assertMotion(compatibility.page, scenario + " resumes");
      }
      await assertCleanup(
        compatibility.page,
        scenario !== "missing-IntersectionObserver",
      );
      assert.deepEqual(compatibility.errors, []);
      result.compatibility.push({
        scenario,
        usesTimerFallback: state.timerCalls > 0,
        errors: compatibility.errors,
      });
      await compatibility.page.close();
    }
    result.checks.push(
      "missing/legacy matchMedia, missing IntersectionObserver, missing request/cancelAnimationFrame: animate without errors and clean up",
    );

    const orbitPage = await makePage(browser);
    await orbitPage.page.clock.install();
    await orbitPage.page.goto(url);
    await waitRunning(orbitPage.page);
    const firstLand = await orbitPage.page
      .locator("[data-land]")
      .getAttribute("d");
    for (let i = 0; i < 45; i++) {
      await orbitPage.page.clock.runFor(400);
      result.orbit.push(
        await orbitPage.page.evaluate(() => {
          const layer = [
            ...document.querySelectorAll(
              "[data-orbit-front],[data-orbit-back]",
            ),
          ].find((node) => node.style.display !== "none");
          const matrix = layer.transform.baseVal.consolidate().matrix;
          return {
            rear: layer.hasAttribute("data-orbit-back"),
            x: matrix.e,
            y: matrix.f,
            radius: 6 * matrix.a,
          };
        }),
      );
    }
    assert.notEqual(
      await orbitPage.page.locator("[data-land]").getAttribute("d"),
      firstLand,
      "land must rotate on sphere",
    );
    assert.ok(
      result.orbit.some(
        (p) => p.rear && Math.hypot(p.x - 104, p.y - 88) + p.radius < 56,
      ),
      "dot must fully disappear behind globe",
    );
    assert.ok(
      result.orbit.some(
        (p) => p.rear && Math.hypot(p.x - 104, p.y - 88) - p.radius > 56,
      ),
      "rear arc must emerge outside globe",
    );
    assert.ok(
      result.orbit.some((p) => !p.rear && p.x < 104) &&
        result.orbit.some((p) => !p.rear && p.x > 104),
      "dot must cross front in both directions",
    );
    const turns = result.orbit.slice(1).map((p, index) => {
      const previous = result.orbit[index],
        difference =
          Math.atan2(p.y - 88, p.x - 104) -
          Math.atan2(previous.y - 88, previous.x - 104);
      return Math.atan2(Math.sin(difference), Math.cos(difference));
    });
    assert.ok(
      turns.some((turn) => turn > 0.05) && turns.some((turn) => turn < -0.05),
      "orbit must reverse smoothly",
    );
    assert.deepEqual(orbitPage.errors, []);
    await orbitPage.page.close();
    result.checks.push(
      "18 simulated seconds: SVG rotation, rear occlusion, re-emergence, front passage and smooth reversal",
    );
    result.passed = true;
    return result;
  } catch (error) {
    result.passed = false;
    result.error = error.stack || String(error);
    for (const [index, page] of browser
      .contexts()
      .flatMap((context) => context.pages())
      .entries())
      await page
        .screenshot({ path: path.join(directory, "failure-" + index + ".png") })
        .catch(() => {});
    return result;
  } finally {
    await browser.close();
    await fs.writeFile(
      path.join(directory, "loading-checks.json"),
      JSON.stringify(result, null, 2),
    );
  }
}

const results = [];
try {
  // Sequential engines avoid CPU contention in short animation samples.
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
      engine +
        ": " +
        (latest.passed ? "PASS" : "FAIL") +
        (latest.error ? "\n" + latest.error : ""),
    );
  }
  await fs.writeFile(
    path.join(evidence, "loading-checks.json"),
    JSON.stringify(
      {
        engines,
        results,
        limitations:
          "Automated desktop engines and emulated touch viewports; physical iOS/Android devices and every browser version were not tested.",
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
