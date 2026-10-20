import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A repeatable desktop-browser comparison, not a physical phone/tablet test.
// Point HISTORY_MAP_PERFORMANCE_ORIGIN at a separately built baseline fixture
// before making changes, then run the same conditions against the new fixture.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const label = process.env.HISTORY_MAP_PERFORMANCE_LABEL || "after";
const output = path.resolve(
  root,
  process.env.HISTORY_MAP_PERFORMANCE_OUTPUT ||
    `output/atlas-performance-20261019/${label}.json`,
);
const slowdown = Number(process.env.HISTORY_MAP_PERFORMANCE_CPU || 4);
const frames = Number(process.env.HISTORY_MAP_PERFORMANCE_FRAMES || 60);
const repeats = Number(process.env.HISTORY_MAP_PERFORMANCE_REPEATS || 2);
const views = (
  process.env.HISTORY_MAP_PERFORMANCE_VIEWS || "world,globe"
).split(",");
assert(views.every((view) => ["world", "globe"].includes(view)));
assert(Number.isFinite(slowdown) && slowdown >= 1);
assert(Number.isInteger(frames) && frames >= 10);
assert(Number.isInteger(repeats) && repeats > 0);
const metricsNames = [
  "TaskDuration",
  "ScriptDuration",
  "LayoutDuration",
  "RecalcStyleDuration",
];
const conditions = [
  { width: 390, height: 844, deviceScaleFactor: 3 },
  { width: 1024, height: 768, deviceScaleFactor: 2 },
];
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};
const round = (value) => Math.round(value * 1000) / 1000;
const metricMap = ({ metrics }) =>
  Object.fromEntries(metrics.map(({ name, value }) => [name, value]));

async function fixture() {
  if (process.env.HISTORY_MAP_PERFORMANCE_ORIGIN)
    return { origin: process.env.HISTORY_MAP_PERFORMANCE_ORIGIN };
  const child = spawn(
    process.execPath,
    ["scripts/verify-history-map-ui.mjs", "--serve"],
    {
      cwd: root,
      env: {
        ...process.env,
        ATLAS_UI_PORT: "0",
        ATLAS_UI_EVIDENCE: path.join(path.dirname(output), "fixture"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  try {
    const origin = await new Promise((resolve, reject) => {
      let logs = "";
      const timeout = setTimeout(() => {
        reject(new Error(`Map fixture startup timed out: ${logs}`));
      }, 60_000);
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Map fixture exited (${code}): ${logs}`));
      });
      child.stderr.on("data", (chunk) => {
        logs += chunk;
      });
      child.stdout.on("data", (chunk) => {
        logs += chunk;
        const match = logs.match(
          /Atlas UI fixture: (http:\/\/127\.0\.0\.1:\d+)/u,
        );
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
    });
    return { origin, child };
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function drag(page, surface, count) {
  const box = await surface.boundingBox();
  assert(box && box.width > 0 && box.height > 0, "Map surface is visible");
  const start = await surface.evaluate((target) => {
    const bounds = target.getBoundingClientRect();
    for (const [x, y] of [
      [0.12, 0.8],
      [0.25, 0.75],
      [0.4, 0.52],
      [0.55, 0.6],
    ]) {
      const point = {
        x: bounds.x + bounds.width * x,
        y: bounds.y + bounds.height * y,
      };
      // Country-name buttons stop pointer down; use uncovered map surface so
      // a fast measurement cannot accidentally benchmark a stationary globe.
      if (document.elementFromPoint(point.x, point.y) === target) return point;
    }
    return null;
  });
  assert(start, "An uncovered map surface receives the real pointer down");
  await surface.evaluate((target) => {
    target.__performancePointerId = null;
    target.addEventListener(
      "pointerdown",
      (event) => {
        target.__performancePointerId = event.pointerId;
      },
      { once: true },
    );
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    const pointerId = await surface.evaluate(
      (target) => target.__performancePointerId,
    );
    assert.notEqual(pointerId, null, "Real pointer down reaches the map");
    return await surface.evaluate(
      (
        target,
        { count: steps, start: from, width, pointerId: activePointer },
      ) =>
        new Promise((resolve) => {
          const intervals = [];
          let step = 0;
          let previous;
          const tick = (timestamp) => {
            if (previous !== undefined) intervals.push(timestamp - previous);
            previous = timestamp;
            if (step === steps) {
              resolve(intervals);
              return;
            }
            step++;
            // A genuine mouse down establishes the active pointer/capture;
            // one bounded move per RAF then gives both revisions equal input.
            target.dispatchEvent(
              new PointerEvent("pointermove", {
                bubbles: true,
                pointerId: activePointer,
                pointerType: "mouse",
                buttons: 1,
                clientX: from.x + (step / steps) * Math.min(width * 0.35, 220),
                clientY: from.y + Math.sin((step / steps) * Math.PI) * 36,
              }),
            );
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      { count, start, width: box.width, pointerId },
    );
  } finally {
    await page.mouse.up();
  }
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
await fs.mkdir(path.dirname(output), { recursive: true });
const { origin, child } = await fixture();
let browser;
const report = {
  label,
  origin,
  measuredAt: new Date().toISOString(),
  browser: "Microsoft Edge headless (desktop Chromium)",
  cpuSlowdown: slowdown,
  input: `${frames} mouse pointer moves, one per requestAnimationFrame`,
  terrainEnabled: true,
  repeats,
  caveat:
    "Desktop browser CPU emulation with viewport/DPR settings; these are not physical iPhone or Galaxy Tab measurements. Frame timestamps do not measure device GPU cost or full touch-to-photon latency.",
  cases: [],
};
try {
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  report.browserVersion = browser.version();
  for (const condition of conditions) {
    for (const view of views) {
      const result = { view, ...condition, samples: [] };
      for (let repeat = 1; repeat <= repeats; repeat++) {
        const page = await browser.newPage({
          viewport: { width: condition.width, height: condition.height },
          deviceScaleFactor: condition.deviceScaleFactor,
        });
        page.setDefaultTimeout(60_000);
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", (route) =>
          route.request().url().startsWith(origin)
            ? route.continue()
            : route.abort(),
        );
        const session = await page.context().newCDPSession(page);
        await session.send("Performance.enable");
        await page.goto(`${origin}/#/teacher/lesson/maps?view=${view}`);
        await page.waitForLoadState("networkidle");
        const surface = page.locator(
          view === "world" ? ".history-atlas__map" : ".history-globe canvas",
        );
        await surface.waitFor();
        await page.waitForFunction(
          () =>
            !document.querySelector('[role="alert"]') &&
            !document.body.textContent.includes("지도를 불러오는 중") &&
            !document.body.textContent.includes("지형을 불러오는 중"),
        );
        assert.equal(
          await page
            .getByRole("button", { name: "지형", exact: true })
            .getAttribute("aria-pressed"),
          "true",
          "Terrain stays on throughout performance measurements",
        );
        if (view === "world")
          await page
            .locator("[data-terrain-id]")
            .first()
            .waitFor({ state: "attached" });
        else await page.locator("[data-globe-country]").first().waitFor();
        await surface.scrollIntoViewIfNeeded();
        await drag(page, surface, 12);
        await surface.press("Home");
        await page.waitForTimeout(350);
        await session.send("Emulation.setCPUThrottlingRate", {
          rate: slowdown,
        });
        await page.waitForTimeout(200);
        const camera = page.locator(
          view === "world"
            ? ".history-atlas__geography"
            : ".history-globe__labels [data-globe-country]",
        );
        const cameraState = () =>
          camera.evaluateAll((elements) =>
            elements
              .map((element) => element.getAttribute("transform"))
              .join("|"),
          );
        const beforeCamera = await cameraState();
        const before = metricMap(await session.send("Performance.getMetrics"));
        const started = performance.now();
        const intervals = await drag(page, surface, frames);
        const elapsedMs = performance.now() - started;
        const after = metricMap(await session.send("Performance.getMetrics"));
        assert.notEqual(
          await cameraState(),
          beforeCamera,
          "The map really moved during the measured drag",
        );
        assert.equal(intervals.length, frames);
        assert.deepEqual(errors, [], "No runtime errors during drag");
        for (const name of metricsNames)
          assert(
            Number.isFinite(before[name]) && Number.isFinite(after[name]),
            `CDP exposes ${name}`,
          );
        const sample = {
          repeat,
          cameraMoved: true,
          rafFrames: intervals.length,
          p50FrameMs: round(percentile(intervals, 0.5)),
          p95FrameMs: round(percentile(intervals, 0.95)),
          maxFrameMs: round(Math.max(...intervals)),
          over34msFrames: intervals.filter((value) => value > 34).length,
          elapsedMs: round(elapsedMs),
          metricsDeltaMs: Object.fromEntries(
            metricsNames.map((name) => [
              name,
              round((after[name] - before[name]) * 1000),
            ]),
          ),
          frameIntervalsMs: intervals.map(round),
        };
        result.samples.push(sample);
        console.log(
          `${label} ${view} ${condition.width}px DPR${condition.deviceScaleFactor} CPU${slowdown} run${repeat}: p50=${sample.p50FrameMs}ms p95=${sample.p95FrameMs}ms Task=${sample.metricsDeltaMs.TaskDuration}ms`,
        );
        await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        await page.close();
      }
      const intervals = result.samples.flatMap(
        (sample) => sample.frameIntervalsMs,
      );
      result.p50FrameMs = round(percentile(intervals, 0.5));
      result.p95FrameMs = round(percentile(intervals, 0.95));
      result.meanMetricsDeltaMs = Object.fromEntries(
        metricsNames.map((name) => [
          name,
          round(
            result.samples.reduce(
              (sum, sample) => sum + sample.metricsDeltaMs[name],
              0,
            ) / repeats,
          ),
        ]),
      );
      report.cases.push(result);
      await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
    }
  }
  console.log(`Map performance evidence saved: ${output}`);
} finally {
  await browser?.close();
  child?.kill();
}
