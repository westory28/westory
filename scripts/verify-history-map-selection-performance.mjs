import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const label = process.env.HISTORY_MAP_SELECTION_LABEL || "after";
const baseline = process.env.HISTORY_MAP_SELECTION_BASELINE === "1";
const includeDrag = process.env.HISTORY_MAP_SELECTION_DRAG !== "0";
const slowdown = Number(process.env.HISTORY_MAP_SELECTION_CPU || 4);
const widths = (process.env.HISTORY_MAP_SELECTION_WIDTHS || "390,768,1280")
  .split(",")
  .map(Number);
const views = (process.env.HISTORY_MAP_SELECTION_VIEWS || "korea,world").split(
  ",",
);
const output = path.resolve(
  root,
  process.env.HISTORY_MAP_SELECTION_OUTPUT ||
    `output/atlas-selection-performance-20261020/${label}.json`,
);
const round = (number) => Math.round(number * 1000) / 1000;
const percentile = (values, fraction) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] || 0;
};
assert(Number.isFinite(slowdown) && slowdown >= 1);
assert(widths.every((width) => Number.isFinite(width) && width >= 320));
assert(views.every((view) => view === "korea" || view === "world"));

async function fixture() {
  if (process.env.HISTORY_MAP_SELECTION_ORIGIN)
    return { origin: process.env.HISTORY_MAP_SELECTION_ORIGIN };
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
      const timer = setTimeout(
        () => reject(new Error(`Map fixture timed out: ${logs}`)),
        60_000,
      );
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
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
          clearTimeout(timer);
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
const { origin, child } = await fixture();
const report = {
  label,
  baseline,
  includeDrag,
  widths,
  views,
  origin,
  measuredAt: new Date().toISOString(),
  cpuSlowdown: slowdown,
  caveat:
    "Headless desktop Edge CPU emulation, not physical phone/tablet GPU or touch-to-photon measurements. Timings depend on variable host load and are diagnostic observations, not a controlled-device FPS benchmark. React commits are observed through the standard React DevTools hook. Geographic scale uses a fixed source boundary's screen-space width, including regenerated projection paths, rather than the displayed zoom percentage.",
  cases: [],
};
let browser;
await fs.mkdir(path.dirname(output), { recursive: true });
async function save() {
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
const settled = async (page) => {
  await page.waitForFunction(
    () => !document.querySelector(".history-atlas--focusing"),
  );
  await page.waitForTimeout(180);
};
const search = (page) =>
  page.getByRole("searchbox", { name: "지명 검색", exact: true });
const clear = async (page) => {
  await page
    .getByRole("button", { name: "지도 필터 초기화", exact: true })
    .click();
  await settled(page);
};
const zoom = async (page, count = 2) => {
  const button = page.getByRole("button", { name: "지도 확대", exact: true });
  for (let index = 0; index < count && !(await button.isDisabled()); index++)
    await button.click();
  await settled(page);
};
// The same fixed boundary is present even when it is outside the viewport.
// Its two horizontal geographic extrema give a projection-aware screen distance.
async function geography(page, view) {
  return page
    .locator(
      view === "world"
        ? 'path[data-country-id="FRA"]'
        : 'path[data-traditional-region="gyeonggi"]',
    )
    .first()
    .evaluate((shape) => {
      const box = shape.getBBox();
      const matrix = shape.getScreenCTM();
      const first = new DOMPoint(box.x, box.y + box.height / 2).matrixTransform(
        matrix,
      );
      const second = new DOMPoint(
        box.x + box.width,
        box.y + box.height / 2,
      ).matrixTransform(matrix);
      return {
        screenDistance: Math.hypot(second.x - first.x, second.y - first.y),
        pathWidth: box.width,
        cameraScale: Math.hypot(matrix.a, matrix.b),
      };
    });
}
async function dragPoint(map) {
  return map.evaluate((target) => {
    const bounds = target.getBoundingClientRect();
    const left = Math.max(0, bounds.left),
      right = Math.min(innerWidth, bounds.right);
    const top = Math.max(0, bounds.top),
      bottom = Math.min(innerHeight, bounds.bottom);
    for (const y of [0.8, 0.65, 0.5, 0.35])
      for (const x of [0.8, 0.6, 0.4, 0.2]) {
        const point = {
          x: left + (right - left) * x,
          y: top + (bottom - top) * y,
        };
        const hit = document.elementFromPoint(point.x, point.y);
        if (
          hit &&
          target.contains(hit) &&
          !hit.closest(
            "button, .history-atlas__overlay, .history-atlas__attribution",
          )
        )
          return point;
      }
    return null;
  });
}
async function measure(
  page,
  session,
  view,
  width,
  name,
  action,
  preserveScale = true,
) {
  await settled(page);
  const before = await geography(page, view);
  await page.evaluate(() => {
    window.__selectionStart = performance.now();
    window.__selectionFrames = [];
    window.__selectionCommits = [];
    window.__selectionLongTasks = [];
    window.__selectionMeasuring = true;
    let previous;
    const frame = (now) => {
      if (!window.__selectionMeasuring) return;
      if (previous !== undefined) window.__selectionFrames.push(now - previous);
      previous = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const initial = await session.send("Performance.getMetrics");
  await action();
  await settled(page);
  const final = await session.send("Performance.getMetrics");
  const after = await geography(page, view);
  const measured = await page.evaluate(() => {
    window.__selectionMeasuring = false;
    return {
      elapsedMs: performance.now() - window.__selectionStart,
      frames: window.__selectionFrames,
      commits: window.__selectionCommits,
      longTasks: window.__selectionLongTasks,
    };
  });
  const metrics = (value) =>
    Object.fromEntries(value.metrics.map(({ name, value }) => [name, value]));
  const first = metrics(initial),
    last = metrics(final);
  const ratio = after.screenDistance / before.screenDistance;
  const result = {
    name,
    view,
    width,
    deviceScaleFactor: width === 390 ? 3 : 2,
    preserveScale,
    scaleRatio: round(ratio),
    scalePreserved: !preserveScale || ratio >= 0.99,
    before,
    after,
    elapsedMs: round(measured.elapsedMs),
    reactCommits: measured.commits.length,
    commitTimesMs: measured.commits.map(round),
    longTasks: measured.longTasks,
    p50FrameMs: round(percentile(measured.frames, 0.5)),
    p95FrameMs: round(percentile(measured.frames, 0.95)),
    maxFrameMs: round(Math.max(0, ...measured.frames)),
    frameIntervalsMs: measured.frames.map(round),
    metricsDeltaMs: Object.fromEntries(
      [
        "TaskDuration",
        "ScriptDuration",
        "LayoutDuration",
        "RecalcStyleDuration",
      ].map((key) => [key, round((last[key] - first[key]) * 1000)]),
    ),
  };
  report.cases.push(result);
  await save();
  console.log(
    `${label} ${view} ${width}px ${name}: scale=${result.scaleRatio} commits=${result.reactCommits} p95=${result.p95FrameMs}ms Task=${result.metricsDeltaMs.TaskDuration}ms`,
  );
  return result;
}

try {
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  report.browserVersion = browser.version();
  for (const width of widths)
    for (const view of views) {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        deviceScaleFactor: width === 390 ? 3 : 2,
      });
      page.setDefaultTimeout(60_000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.__selectionMeasuring = false;
        window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
          supportsFiber: true,
          inject: () => 1,
          onCommitFiberUnmount() {},
          onCommitFiberRoot() {
            if (window.__selectionMeasuring)
              window.__selectionCommits.push(
                performance.now() - window.__selectionStart,
              );
          },
        };
        new PerformanceObserver((list) => {
          if (window.__selectionMeasuring)
            for (const entry of list.getEntries())
              window.__selectionLongTasks.push({
                startMs: Math.round(entry.startTime - window.__selectionStart),
                durationMs: Math.round(entry.duration),
              });
        }).observe({ type: "longtask", buffered: false });
      });
      await page.route("**/*", (route) =>
        route.request().url().startsWith(origin)
          ? route.continue()
          : route.abort(),
      );
      await page.goto(`${origin}/#/teacher/lesson/maps?view=${view}`);
      await page.waitForLoadState("networkidle");
      await page
        .locator(
          view === "world"
            ? '[data-country-id="FRA"]'
            : '[data-traditional-region="gyeonggi"]',
        )
        .first()
        .waitFor({ state: "attached" });
      const session = await page.context().newCDPSession(page);
      await session.send("Performance.enable");
      await session.send("Emulation.setCPUThrottlingRate", { rate: slowdown });
      const place = view === "korea" ? "종묘" : "로마";
      const river = view === "korea" ? "한강" : "나일강";
      for (const [name, query] of [
        ["place-reselection", place],
        ["river-reselection", river],
      ]) {
        await clear(page);
        await search(page).fill(query);
        await settled(page);
        await clear(page);
        await zoom(page, 3);
        await measure(page, session, view, width, name, () =>
          search(page).fill(query),
        );
        assert(
          await page.locator(".history-atlas__overlay").count(),
          "Selection opens its description",
        );
      }
      await clear(page);
      await page
        .getByRole("button", { name: "전체 보기", exact: true })
        .click();
      await settled(page);
      if (view === "world") {
        await zoom(page, 2);
        const country = page.locator(".history-atlas__country-label").first();
        await country.waitFor();
        await measure(page, session, view, width, "country-label", () =>
          country.press("Enter"),
        );
        assert.equal(
          await page.locator(".history-atlas__country.is-active").count(),
          1,
        );
        await clear(page);
        await page
          .getByRole("combobox", { name: "지역", exact: true })
          .selectOption("africa");
        await settled(page);
        await zoom(page, 2);
        await measure(page, session, view, width, "region-description", () =>
          page.locator(".history-atlas__province-label").press("Enter"),
        );
      } else {
        await page
          .getByRole("combobox", { name: "지역 · 8도", exact: true })
          .selectOption("area:giho");
        await settled(page);
        await page
          .getByRole("button", { name: "장소 설명 닫기", exact: true })
          .click();
        await zoom(page, 2);
        await measure(page, session, view, width, "region-description", () =>
          page.locator(".history-atlas__province-label").press("Enter"),
        );
      }
      await clear(page);
      await measure(
        page,
        session,
        view,
        width,
        "rapid-selections",
        async () => {
          await search(page).fill(place);
          await search(page).fill(river);
          await search(page).fill(place);
        },
      );
      assert(
        (await page.locator(".history-atlas__overlay").textContent()).includes(
          place,
        ),
        "Rapid selections retain the last requested place",
      );
      if (includeDrag) {
        await clear(page);
        const map = page.locator(".history-atlas__map");
        await map.scrollIntoViewIfNeeded();
        await map.evaluate((target) => {
          window.__selectionDragInterrupted = false;
          window.__selectionCameraAtRelease = null;
          target.addEventListener(
            "pointerdown",
            () => {
              window.__selectionDragInterrupted = !!document.querySelector(
                ".history-atlas--focusing",
              );
            },
            { once: true, capture: true },
          );
          target.addEventListener(
            "pointerup",
            () =>
              requestAnimationFrame(() => {
                const matrix = document
                  .querySelector(".history-atlas__geography")
                  .getScreenCTM();
                window.__selectionCameraAtRelease = [
                  matrix.a,
                  matrix.e,
                  matrix.f,
                ];
              }),
            { once: true },
          );
        });
        await measure(
          page,
          session,
          view,
          width,
          "selection-interrupted-by-drag",
          async () => {
            await search(page).fill(river);
            // Filling the toolbar can scroll it into view and move the map.
            // Expose enough map for the complete drag before the genuine down.
            const visibleHeight = await map.evaluate((target) => {
              const bounds = target.getBoundingClientRect();
              return (
                Math.min(innerHeight, bounds.bottom) - Math.max(0, bounds.top)
              );
            });
            if (visibleHeight < 120) await map.scrollIntoViewIfNeeded();
            const from = await dragPoint(map);
            assert(
              from,
              "An uncovered visible map surface can receive the drag",
            );
            await page.mouse.move(from.x, from.y);
            await page.mouse.down();
            await page.mouse.move(from.x - 48, from.y - 20, {
              steps: 3,
            });
            await page.mouse.up();
          },
          false,
        );
        report.cases.at(-1).interruptedActiveAnimation = await page.evaluate(
          () => window.__selectionDragInterrupted,
        );
        const releasedCamera = await page.evaluate(() => {
          const matrix = document
            .querySelector(".history-atlas__geography")
            .getScreenCTM();
          return {
            released: window.__selectionCameraAtRelease,
            settled: [matrix.a, matrix.e, matrix.f],
          };
        });
        report.cases.at(-1).releasedCamera = releasedCamera;
        assert(
          releasedCamera.released,
          "The map receives a real pointer release",
        );
        assert(
          releasedCamera.released.every(
            (value, index) =>
              Math.abs(value - releasedCamera.settled[index]) < 1,
          ),
          "Interrupted selection must not resume and pull the map away after drag release",
        );
        await save();
      }
      assert.deepEqual(
        errors,
        [],
        "No runtime error during selection or interrupted camera motion",
      );
      await page.close();
    }
  const failures = report.cases.filter((result) => !result.scalePreserved);
  report.scaleRegressionCount = failures.length;
  report.interruptedSubjects = [
    ...new Set(
      report.cases
        .filter((result) => result.interruptedActiveAnimation)
        .map((result) => result.view),
    ),
  ];
  await save();
  assert(
    report.cases.every((result) => result.reactCommits > 0),
    "The React commit observer is active for every case",
  );
  if (!baseline)
    assert.deepEqual(
      failures.map(({ view, width, name, scaleRatio }) => ({
        view,
        width,
        name,
        scaleRatio,
      })),
      [],
      "Selections must preserve actual geographic scale",
    );
  console.log(`Map selection evidence saved: ${output}`);
} finally {
  await browser?.close();
  child?.kill();
}
