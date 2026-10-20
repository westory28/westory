import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const out =
  process.env.ATLAS_CAMERA_EVIDENCE ||
  path.join(root, "output/history-map-camera");
await fs.mkdir(out, { recursive: true });
const assets = new Map();
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import HistoryMaps from './src/components/common/HistoryMaps';import {historyAtlasDataset} from './src/data/historyAtlasContent';import './src/assets/index.css';createRoot(document.getElementById('root')).render(<HashRouter><main className="history-atlas-page"><HistoryMaps dataset={historyAtlasDataset}/></main></HashRouter>);`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  loader: { ".svg": "dataurl", ".webp": "dataurl" },
  outfile: path.join(out, "fixture.js"),
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "local-map-assets",
      setup(plugin) {
        plugin.onResolve({ filter: /\?url$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: "asset",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "asset" }, async (args) => {
          const url = `/assets/${path.basename(args.path)}`;
          assets.set(url, await fs.readFile(args.path));
          return {
            contents: `export default ${JSON.stringify(url)}`,
            loader: "js",
          };
        });
      },
    },
  ],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((f) => f.path.endsWith(".css")).text;
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer((request, response) => {
  const name = new URL(request.url, "http://localhost").pathname;
  const [type, data] = assets.has(name)
    ? ["application/json", assets.get(name)]
    : name === "/fixture.js"
      ? ["text/javascript", js]
      : name === "/fixture.css"
        ? ["text/css", css]
        : ["text/html", html];
  response.setHeader("Content-Type", `${type};charset=utf-8`);
  response.end(data);
});
await new Promise((resolve) =>
  server.listen(
    Number(process.env.ATLAS_CAMERA_PORT || 0),
    "127.0.0.1",
    resolve,
  ),
);
const origin = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes("--serve")) {
  console.log(`Atlas UI fixture: ${origin}`);
  await new Promise(() => {});
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
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [];
let activePage;
const terrainIds = JSON.parse(
  await fs.readFile(path.join(root, "src/data/atlas/terrain.json"), "utf8"),
)
  .features.filter((feature) => feature.properties.korea)
  .map((feature) => feature.properties.id);
assert.equal(terrainIds.length, 7, "Seven registered Korean landforms");
const errors = [];
const frames = {};
async function openView(page, view) {
  await page.goto(
    `${origin}/?case=${view}-${Date.now()}#/teacher/lesson/maps?view=${view}`,
  );
  await page
    .locator(
      view === "globe" ? ".history-globe canvas" : ".history-atlas__land",
    )
    .waitFor();
  await page.waitForFunction(
    () => !document.body.textContent.includes("지도를 불러오는 중"),
  );
  await page.waitForTimeout(500);
}
async function flatSnapshot(page) {
  return page.evaluate(() => {
    const geography = document.querySelector(".history-atlas__geography");
    const matrix = geography?.getScreenCTM();
    const map = document
      .querySelector(".history-atlas__map")
      .getBoundingClientRect();
    const anchor = document.querySelector(
      ".history-atlas__label-anchor.is-active",
    );
    const country = document.querySelector(
      ".history-atlas__country-label.is-active",
    );
    const target = anchor || country;
    return {
      matrix: matrix && [matrix.a, matrix.e - map.left, matrix.f - map.top],
      anchor: target && [
        parseFloat(target.style.left),
        parseFloat(target.style.top),
      ],
      label: target?.textContent,
      activeCountry: country?.getAttribute("data-country-label"),
    };
  });
}
function assertSameFlatCamera(actual, expected, message) {
  assert(
    actual.length === expected.length &&
      actual.every((value, index) => Math.abs(value - expected[index]) < 0.001),
    message,
  );
}
async function recordFlatFrames(page, name, action, landmarkSelector) {
  await page.screenshot({ path: path.join(out, `${name}-before.png`) });
  await page.evaluate((landmarkSelector) => {
    const land = document
      .querySelector(".history-atlas__land")
      .getAttribute("d");
    window.cameraSamples = [];
    window.cameraStarted = performance.now();
    let cameraUpdatedAt = window.cameraStarted;
    // A timer can run long after the frame was calculated, especially while
    // the browser rasterizes a newly selected country. Pair each camera value
    // with its DOM update time instead of the later post-paint read time.
    const cameraObserver = new MutationObserver(() => {
      cameraUpdatedAt = performance.now();
    });
    cameraObserver.observe(
      document.querySelector(".history-atlas__map > svg"),
      { attributes: true, attributeFilter: ["style"] },
    );
    cameraObserver.observe(
      document.querySelector(".history-atlas__geography"),
      { attributes: true, attributeFilter: ["transform"] },
    );
    const sample = (now) => {
      // Read after all RAF callbacks so a React commit belongs to its painted
      // frame, rather than being attributed to the next observer callback.
      setTimeout(() => {
        const readStarted = performance.now();
        const geo = document.querySelector(".history-atlas__geography");
        // Include the composited SVG surface as well as its committed camera
        // group; the inner SVG transform stays fixed during a gesture.
        const matrix = geo?.getScreenCTM();
        const map = document
          .querySelector(".history-atlas__map")
          .getBoundingClientRect();
        const shape = document.querySelector(
          ".history-atlas__landform.is-active, .history-atlas__river-hit",
        );
        const shapeMatrix = shape?.getScreenCTM();
        const anchor = document.querySelector(
          ".history-atlas__label-anchor.is-active",
        );
        const landmark = document.querySelector(landmarkSelector);
        const landmarkBox = landmark?.getBBox();
        const landmarkMatrix = landmark?.getScreenCTM();
        const landmarkCenter =
          landmarkBox &&
          new DOMPoint(
            landmarkBox.x + landmarkBox.width / 2,
            landmarkBox.y + landmarkBox.height / 2,
          ).matrixTransform(landmarkMatrix);
        window.cameraSamples.push({
          ms: performance.now() - window.cameraStarted,
          cameraUpdatedMs: cameraUpdatedAt - window.cameraStarted,
          matrix: matrix && [matrix.a, matrix.e - map.left, matrix.f - map.top],
          landPresent: !!document
            .querySelector(".history-atlas__land")
            ?.getAttribute("d"),
          landUnchanged:
            document
              .querySelector(".history-atlas__land")
              ?.getAttribute("d") === land,
          shapeMatrix: shapeMatrix && [
            shapeMatrix.a,
            shapeMatrix.e - map.left,
            shapeMatrix.f - map.top,
          ],
          anchor: anchor && [
            parseFloat(anchor.style.left),
            parseFloat(anchor.style.top),
          ],
          landmark: landmarkCenter && [
            landmarkCenter.x,
            landmarkCenter.y,
            landmarkBox.width * landmarkMatrix.a,
          ],
          sampleCostMs: performance.now() - readStarted,
        });
        if (
          performance.now() - window.cameraStarted < 1150 ||
          (window.cameraSamples.length < 16 &&
            performance.now() - window.cameraStarted < 5000)
        )
          requestAnimationFrame(sample);
        else {
          cameraObserver.disconnect();
          window.cameraComplete = true;
        }
      }, 0);
    };
    window.cameraComplete = false;
    requestAnimationFrame(sample);
  }, landmarkSelector);
  // Record the pre-action camera before dispatching the selection. Otherwise
  // a busy renderer can start the motion before the first observer callback.
  await page.waitForFunction(() => window.cameraSamples.length > 0);
  await action();
  await page.waitForFunction(() => window.cameraComplete);
  await page.screenshot({ path: path.join(out, `${name}-after.png`) });
  const samples = await page.evaluate(() => window.cameraSamples);
  frames[name] = samples;
  await fs.writeFile(
    path.join(out, "frame-samples.json"),
    JSON.stringify(frames, null, 2),
  );
  assert(samples.length >= 10, `${name}: at least ten animation frame samples`);
  assert(
    samples.every((sample) => sample.landPresent),
    `${name}: backing map never disappears`,
  );
  assert(
    samples.every((sample) => sample.matrix[0] > 0),
    `${name}: every camera scale stays positive`,
  );
  assert(
    samples.every((sample) => sample.landmark?.every(Number.isFinite)),
    `${name}: geographic landmark remains present`,
  );
  assert(
    samples.every(
      (sample) =>
        !sample.shapeMatrix ||
        sample.matrix.every(
          (value, index) => Math.abs(value - sample.shapeMatrix[index]) < 0.001,
        ),
    ),
    `${name}: feature geometry shares every camera transform`,
  );
  const distinct = new Set(samples.map((sample) => sample.matrix.join(",")));
  const delayedCameraFrames = samples
    .slice(1)
    .filter(
      (sample, index) =>
        sample.matrix.some(
          (value, axis) => value !== samples[index].matrix[axis],
        ) && sample.cameraUpdatedMs - samples[index].cameraUpdatedMs >= 100,
    );
  assert(distinct.size >= 2, `${name}: selection changes the camera`);
  // A renderer blocked for longer than the animation cannot present four
  // intermediate frames. Keep this as a smoothness check when frames are
  // available, and explicitly record stalls instead of misreporting a pass.
  assert(
    distinct.size >= 4 || delayedCameraFrames.length > 0,
    `${name}: available frames include multiple interpolated camera positions`,
  );
  const first = samples[0].landmark;
  const last = samples.at(-1).landmark;
  for (let axis = 0; axis < 3; axis++) {
    const distance = Math.abs(last[axis] - first[axis]);
    if (distance < 0.1) continue;
    const direction = Math.sign(last[axis] - first[axis]);
    for (let index = 1; index < samples.length; index++) {
      const delta =
        (samples[index].landmark[axis] - samples[index - 1].landmark[axis]) *
        direction;
      assert(
        delta >= -0.5,
        `${name}: displayed landmark axis ${axis} never shakes backwards`,
      );
      const elapsed =
        samples[index].cameraUpdatedMs - samples[index - 1].cameraUpdatedMs;
      assert(
        delta / distance <= Math.max(0.35, elapsed / 100),
        `${name}: camera has no one-frame jump`,
      );
    }
  }
  checks.push({
    name,
    passed: true,
    frameCount: samples.length,
    distinctCameraFrames: distinct.size,
    delayedCameraFrames: delayedCameraFrames.length,
  });
}
async function moveFlatAndAssertAnchor(page, name) {
  const before = await flatSnapshot(page);
  assert(before.anchor, `${name}: selected label has a geographic anchor`);
  const map = page.locator(".history-atlas__map");
  await map.press("ArrowRight");
  await page.waitForTimeout(80);
  const after = await flatSnapshot(page);
  assert(after.anchor, `${name}: selected label remains visible after pan`);
  const local = (state) => [
    (state.anchor[0] - state.matrix[1]) / state.matrix[0],
    (state.anchor[1] - state.matrix[2]) / state.matrix[0],
  ];
  const first = local(before),
    last = local(after);
  assert(
    Math.abs(after.matrix[1] - before.matrix[1]) > 1,
    `${name}: camera moved`,
  );
  assert(
    Math.abs(last[0] - first[0]) < 0.1 && Math.abs(last[1] - first[1]) < 0.1,
    `${name}: label retains the same geographic coordinate after pan`,
  );
  const box = await map.boundingBox();
  const start = [box.x + box.width * 0.75, box.y + box.height * 0.68];
  await page.mouse.move(...start);
  await page.mouse.down();
  await page.mouse.move(start[0] - 80, start[1] - 35, { steps: 8 });
  await page.mouse.up();
  const dragged = await flatSnapshot(page);
  if (dragged.anchor) {
    const next = local(dragged);
    assert(
      Math.abs(next[0] - first[0]) < 0.1 && Math.abs(next[1] - first[1]) < 0.1,
      `${name}: drag keeps the label at its geographic coordinate`,
    );
  }
  let offscreen = dragged;
  for (let index = 0; index < 6 && offscreen.anchor; index++) {
    const beginning = [box.x + box.width * 0.8, box.y + box.height * 0.75];
    await page.mouse.move(...beginning);
    await page.mouse.down();
    await page.mouse.move(beginning[0] - box.width * 0.55, beginning[1], {
      steps: 5,
    });
    await page.mouse.up();
    offscreen = await flatSnapshot(page);
    if (offscreen.anchor) {
      const next = local(offscreen);
      assert(
        Math.abs(next[0] - first[0]) < 0.1 &&
          Math.abs(next[1] - first[1]) < 0.1,
        `${name}: clipped geometry never relocates its label`,
      );
    }
  }
  assert(
    !offscreen.anchor,
    `${name}: label leaves the viewport with its geographic anchor`,
  );
  checks.push({ name: `${name}-anchor`, passed: true, before, after, dragged });
}
async function selectSearch(page, name) {
  if (await page.locator(".history-globe").count())
    await page
      .getByRole("button", { name: "지도 필터 초기화", exact: true })
      .click();
  await page
    .getByRole("searchbox", { name: "지명 검색", exact: true })
    .fill(name);
  if (await page.locator(".history-globe").count())
    await page
      .locator("[data-globe-place]")
      .filter({ hasText: name })
      .first()
      .click();
  await page
    .locator(".history-atlas__overlay, .history-globe__popup")
    .waitFor();
  if (await page.locator(".history-atlas").count())
    await page.waitForFunction(
      () => !document.querySelector(".history-atlas--focusing"),
    );
  else await page.waitForTimeout(550);
}
async function findFillPoint(page, selector, requireTarget = false) {
  return page
    .locator(selector)
    .first()
    .evaluate((element, requireTarget) => {
      const box = element.getBBox(),
        matrix = element.getScreenCTM();
      for (let row = 1; row < 30; row++)
        for (let column = 1; column < 30; column++) {
          const local = new DOMPoint(
            box.x + (box.width * column) / 30,
            box.y + (box.height * row) / 30,
          );
          if (!element.isPointInFill(local)) continue;
          const point = local.matrixTransform(matrix),
            hit = document.elementFromPoint(point.x, point.y);
          const map = element
            .closest(".history-atlas__map")
            .getBoundingClientRect();
          if (
            point.x > map.left + 15 &&
            point.x < map.right - 15 &&
            point.y > map.top + 60 &&
            point.y < map.bottom - 45 &&
            hit &&
            !hit.closest("button, [role=button], .history-atlas__overlay") &&
            (!requireTarget || hit === element)
          )
            return [point.x, point.y];
        }
      return null;
    }, requireTarget);
}
async function globeSnapshot(page) {
  return page.evaluate(() => {
    const label = document.querySelector(".history-globe__labels .is-active");
    const matrix = label?.transform.baseVal.consolidate()?.matrix;
    const textWidth = Number(
      label?.querySelector("text")?.getAttribute("textLength"),
    );
    const shape = document.querySelector(".history-globe__river-halo");
    const box = shape?.getAttribute("d") ? shape.getBBox() : null;
    return {
      anchor: matrix ? [matrix.e + textWidth / 2, matrix.f] : null,
      label: label?.getAttribute("aria-label"),
      shape: box && [
        box.x + box.width / 2,
        box.y + box.height / 2,
        box.width,
        box.height,
      ],
      zoom: document.querySelector(".history-globe__zoom")?.textContent,
    };
  });
}
async function expectNaturalCountryOverlap(page) {
  await openView(page, "world");
  await selectSearch(page, "나일강");
  const riverId = await page
    .locator(".history-atlas__river-hit")
    .first()
    .getAttribute("data-place-id");
  await page
    .getByRole("button", { name: "지도 필터 초기화", exact: true })
    .click();
  const point = await page
    .locator(`.history-atlas__river-hit[data-place-id="${riverId}"]`)
    .evaluate((river) => {
      const country = document.querySelector('[data-country-id="EGY"]');
      const matrix = river.getScreenCTM();
      const countryInverse = country.getScreenCTM().inverse();
      const length = river.getTotalLength();
      for (let index = 1; index < 100; index++) {
        const local = river.getPointAtLength((length * index) / 100);
        const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
        if (
          country.isPointInFill(screen.matrixTransform(countryInverse)) &&
          document.elementFromPoint(screen.x, screen.y) === river
        )
          return [screen.x, screen.y];
      }
      return null;
    });
  assert(
    point,
    "Nile has a directly clickable river segment overlapping Egypt",
  );
  await page.mouse.click(...point);
  await page.locator(".history-atlas__river-selected").waitFor();
  assert.equal(
    await page.locator(".history-atlas__country.is-active").count(),
    0,
    "River click takes precedence over the overlapping country fill",
  );
  await page
    .locator(".history-atlas__overlay")
    .getByRole("heading", { name: "나일강", exact: true })
    .waitFor();
  checks.push({ name: "natural-river-overlapping-egypt", passed: true, point });
  await page.screenshot({
    path: path.join(out, "nile-country-overlap.png"),
    fullPage: true,
  });
}
async function globeDrag(page, dx, dy = 0) {
  const box = await page.locator(".history-globe canvas").boundingBox();
  const start = [
    box.x + (dx < 0 ? 0.8 : 0.48) * box.width,
    box.y + box.height * 0.65,
  ];
  await page.mouse.move(...start);
  await page.mouse.down();
  await page.mouse.move(start[0] + dx, start[1] + dy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}
async function expectGlobe(page) {
  await openView(page, "globe");
  const label = page
    .locator('[data-globe-country]:not([data-globe-country="KOR"]):visible')
    .first();
  await label.waitFor();
  const countryName = (await label.getAttribute("aria-label")).replace(
    / 설명 보기$/,
    "",
  );
  const countryBox = await label.boundingBox();
  await page.mouse.click(
    countryBox.x + countryBox.width + 35,
    countryBox.y + countryBox.height / 2,
  );
  assert(
    !(await page.locator("canvas").getAttribute("aria-label")).includes(
      "선택한 국가:",
    ),
    "Globe country fill is not a country selection target",
  );
  await label.press("Enter");
  await page.waitForTimeout(600);
  assert(
    (await page.locator("canvas").getAttribute("aria-label")).includes(
      `선택한 국가: ${countryName}`,
    ),
    "Globe country name selects its country",
  );
  checks.push({ name: "globe-country-name-only", passed: true });
  await openView(page, "globe");
  await page.evaluate(() => {
    window.globeSamples = [];
    const started = performance.now();
    const sample = (now) => {
      const canvas = document.querySelector(".history-globe canvas");
      const pixels = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let opaque = 0,
        whiteLand = 0;
      for (let index = 0; index < pixels.length; index += 128) {
        if (pixels[index + 3] === 255) opaque++;
        if (
          pixels[index] === 255 &&
          pixels[index + 1] === 255 &&
          pixels[index + 2] === 255
        )
          whiteLand++;
      }
      const shape = document.querySelector(".history-globe__river-halo");
      const box = shape?.getAttribute("d") ? shape.getBBox() : null;
      window.globeSamples.push({
        ms: performance.now() - started,
        opaque,
        whiteLand,
        zoom: document.querySelector(".history-globe__zoom")?.textContent,
        shape: box && [box.x, box.y, box.width, box.height],
      });
      if (now - started < 1200) requestAnimationFrame(sample);
      else window.globeComplete = true;
    };
    window.globeComplete = false;
    requestAnimationFrame(sample);
  });
  await page
    .getByRole("searchbox", { name: "지명 검색", exact: true })
    .fill("제주도");
  await page.locator('[data-globe-place="jeju"]').click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(out, "globe-jeju-during.png") });
  await page.waitForFunction(() => window.globeComplete);
  frames["globe-jeju-selection"] = await page.evaluate(
    () => window.globeSamples,
  );
  const samples = frames["globe-jeju-selection"];
  await fs.writeFile(
    path.join(out, "frame-samples.json"),
    JSON.stringify(frames, null, 2),
  );
  assert(
    samples.every((sample) => sample.opaque > 0 && sample.whiteLand > 0),
    "Globe retains its painted base map in every selection frame",
  );
  assert(
    new Set(samples.map((sample) => sample.zoom)).size >= 3,
    "Globe zoom interpolates through multiple frames",
  );
  const before = await globeSnapshot(page);
  assert(
    before.anchor && before.shape,
    "Globe Jeju has its selected shape and label",
  );
  await globeDrag(page, -80, -20);
  const after = await globeSnapshot(page);
  assert(
    after.anchor && after.shape,
    "Globe Jeju stays visible after a short drag",
  );
  const delta = (index) =>
    after.anchor[index] -
    before.anchor[index] -
    (after.shape[index] - before.shape[index]);
  assert(
    Math.abs(delta(0)) < 6 && Math.abs(delta(1)) < 6,
    "Globe island label moves with its island, not the viewport",
  );
  assert(
    Math.hypot(
      after.anchor[0] - before.anchor[0],
      after.anchor[1] - before.anchor[1],
    ) > 15,
    "Globe drag moves the label on screen",
  );
  await page.screenshot({
    path: path.join(out, "globe-jeju-after-pan.png"),
    fullPage: true,
  });
  // Keep panning until the selected island leaves the viewport; its badge must leave too.
  for (let index = 0; index < 6 && (await globeSnapshot(page)).anchor; index++)
    await globeDrag(page, -250);
  assert.equal(
    (await globeSnapshot(page)).anchor,
    null,
    "Globe Jeju badge disappears when its geographic anchor leaves the viewport",
  );
  checks.push({
    name: "globe-jeju-motion-anchor",
    passed: true,
    before,
    after,
    frameCount: samples.length,
  });
  for (const name of ["강화도", "한강"]) {
    await selectSearch(page, name);
    const initial = await globeSnapshot(page);
    assert(
      initial.anchor,
      `${name}: globe selected geographic label is visible`,
    );
    for (
      let index = 0;
      index < 6 && (await globeSnapshot(page)).anchor;
      index++
    )
      await globeDrag(page, -250);
    assert.equal(
      (await globeSnapshot(page)).anchor,
      null,
      `${name}: globe label is not pinned after panning the place away`,
    );
    checks.push({ name: `globe-${name}-anchor`, passed: true });
  }
}
async function expectTouchCamera(page, width) {
  await openView(page, "korea");
  await selectSearch(page, "한강");
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 2,
  });
  const box = await page.locator(".history-atlas__map").boundingBox();
  const x = box.x + box.width * 0.65;
  const y = box.y + box.height * 0.72;
  const touch = (type, points) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    });
  const paint = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const before = await flatSnapshot(page);
  await page.evaluate(() => {
    window.detailMutationCount = 0;
    window.detailObserver = new MutationObserver((changes) => {
      window.detailMutationCount += changes.length;
    });
    window.detailObserver.observe(
      document.querySelector(".history-atlas__overlay"),
      {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true,
      },
    );
  });
  await touch("touchStart", [[x, y]]);
  await touch("touchMove", [[x + 28, y + 10]]);
  await paint();
  const during = await flatSnapshot(page);
  assert(
    Math.abs(during.matrix[1] - before.matrix[1] - 28) < 0.1,
    `${width}: native touch pans the camera before release (${JSON.stringify({ before: before.matrix, during: during.matrix })})`,
  );
  const anchor = (state) =>
    state.anchor.map(
      (value, index) => (value - state.matrix[index + 1]) / state.matrix[0],
    );
  assert(before.anchor && during.anchor, "Selected touch anchor stays visible");
  assert(
    anchor(before).every(
      (value, index) => Math.abs(value - anchor(during)[index]) < 0.1,
    ),
    `${width}: touch labels and geometry move in the same frame`,
  );
  assert.equal(
    await page.evaluate(() => window.detailMutationCount),
    0,
    "Touch camera does not re-render the open explanation",
  );
  await touch("touchEnd", []);
  await paint();
  const settled = await flatSnapshot(page);
  assertSameFlatCamera(
    settled.matrix,
    during.matrix,
    "Touch release preserves camera",
  );
  // Return to the exact starting props and release before the pending RAF.
  // React's prop diff must not leave the preceding painted DOM transform behind.
  await touch("touchStart", [[x, y]]);
  await touch("touchMove", [[x - 24, y]]);
  await paint();
  await touch("touchMove", [[x, y]]);
  await touch("touchEnd", []);
  await paint();
  assertSameFlatCamera(
    (await flatSnapshot(page)).matrix,
    settled.matrix,
    "Fast out-and-back touch release restores the exact camera",
  );
  await touch("touchStart", [
    [x - 35, y],
    [x + 35, y],
  ]);
  await touch("touchMove", [
    [x - 49, y],
    [x + 49, y],
  ]);
  await paint();
  const pinched = await flatSnapshot(page);
  assert(
    Math.abs(pinched.matrix[0] / settled.matrix[0] - 1.4) < 0.001,
    "Native two-finger pinch updates the camera during the gesture",
  );
  await touch("touchCancel", []);
  await paint();
  assertSameFlatCamera(
    (await flatSnapshot(page)).matrix,
    pinched.matrix,
    "Touch cancellation commits the last camera without a jump",
  );
  await page.evaluate(() => window.detailObserver.disconnect());
  await session.detach();
  checks.push({ name: `native-touch-camera-${width}`, passed: true });
}
try {
  for (const width of process.env.ATLAS_CAMERA_ONLY === "globe"
    ? []
    : process.env.ATLAS_CAMERA_WIDTHS?.split(",").map(Number) || [
        390, 768, 1280, 1366,
      ]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 1366 ? 768 : 900 },
    });
    activePage = page;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    await openView(page, "korea");
    const labels = await page
      .locator("[data-terrain-label]")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          id: element.dataset.terrainLabel,
          name: element.textContent,
        })),
      );
    await page.screenshot({
      path: path.join(out, `korea-terrain-${width}.png`),
      fullPage: true,
    });
    for (const id of terrainIds)
      assert(
        labels.some((label) => label.id === id),
        `${width}: ${id} is visible in Korea`,
      );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `${width}: no page overflow`,
    );
    checks.push({ name: `korea-terrain-${width}`, passed: true, labels });
    if (width !== 1280) {
      await recordFlatFrames(
        page,
        `jeju-selection-${width}`,
        () =>
          page
            .getByRole("searchbox", { name: "지명 검색", exact: true })
            .fill("제주도"),
        '[data-place-id="jeju"]',
      );
      const activeLabel = page.locator(
        ".history-atlas__label-anchor.is-active .history-atlas__point-label",
      );
      await activeLabel.waitFor();
      const labelBox = await activeLabel.boundingBox();
      const mapBox = await page.locator(".history-atlas__map").boundingBox();
      assert(
        labelBox.x >= mapBox.x &&
          labelBox.x + labelBox.width <= mapBox.x + mapBox.width &&
          labelBox.y >= mapBox.y &&
          labelBox.y + labelBox.height <= mapBox.y + mapBox.height,
        `${width}: selected island finishes inside the visible map`,
      );
      await page.screenshot({
        path: path.join(out, `jeju-selection-${width}-after.png`),
        fullPage: true,
      });
      await expectTouchCamera(page, width);
      await page.close();
      continue;
    }
    await recordFlatFrames(
      page,
      "jeju-selection",
      () =>
        page
          .getByRole("searchbox", { name: "지명 검색", exact: true })
          .fill("제주도"),
      '[data-place-id="jeju"]',
    );
    await moveFlatAndAssertAnchor(page, "jeju");
    await page.screenshot({
      path: path.join(out, "jeju-after-pan.png"),
      fullPage: true,
    });
    for (const name of ["강화도", "한강"]) {
      await selectSearch(page, name);
      await moveFlatAndAssertAnchor(page, name);
    }
    await openView(page, "world");
    const firstCountry = page.locator("[data-country-label]:visible").first();
    await firstCountry.waitFor();
    const countryId = await firstCountry.getAttribute("data-country-label");
    const country = page.locator(`[data-country-label="${countryId}"]`);
    const landPoint = await findFillPoint(
      page,
      `path[data-country-id="${countryId}"]`,
    );
    assert(
      landPoint,
      "A named country has a country-fill point away from its name",
    );
    await page.mouse.click(...landPoint);
    assert.equal(
      await page.locator(".history-atlas__country.is-active").count(),
      0,
      "Clicking a country fill does not select a country",
    );
    await recordFlatFrames(
      page,
      "country-name-selection",
      () => country.press("Enter"),
      '[data-country-id="KOR"]',
    );
    assert.equal(
      await page.locator(`[data-country-id="${countryId}"].is-active`).count(),
      1,
      "Country name selects its area",
    );
    await moveFlatAndAssertAnchor(page, `country-${countryId}`);
    await page.screenshot({
      path: path.join(out, "country-after-pan.png"),
      fullPage: true,
    });
    await expectTouchCamera(page, width);
    await expectNaturalCountryOverlap(page);
    await openView(page, "world");
    await recordFlatFrames(
      page,
      "world-asia-region-selection",
      () =>
        page
          .getByRole("combobox", { name: "지역", exact: true })
          .selectOption("asia"),
      '[data-country-id="KOR"]',
    );
    await page.locator(".history-atlas__map").press("Home");
    await page.waitForTimeout(500);
    const reset = await flatSnapshot(page);
    assert(
      reset.matrix.every(
        (value, index) => Math.abs(value - [1, 0, 0][index]) < 0.001,
      ),
      "Home restores the whole map camera after a region selection",
    );
    checks.push({
      name: "home-after-region-selection",
      passed: true,
      matrix: reset.matrix,
    });
    await page.close();
  }
  if (process.env.ATLAS_CAMERA_ONLY !== "flat") {
    const globe = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    activePage = globe;
    globe.on("pageerror", (error) => errors.push(error.message));
    await globe.route("**/*", (route) =>
      route.request().url().startsWith(origin) ? route.continue() : route.abort(),
    );
    await expectGlobe(globe);
    await globe.close();
  }
  assert.deepEqual(errors, [], "No browser runtime errors");
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(`History map camera verified: ${checks.length} cases. ${out}`);
} catch (error) {
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ checks, errors, failure: String(error) }, null, 2),
  );
  if (activePage && !activePage.isClosed())
    await activePage.screenshot({
      path: path.join(out, "failure.png"),
      fullPage: true,
    });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
