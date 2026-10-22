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
  process.env.ATLAS_UI_EVIDENCE ||
  path.join(root, "output/atlas-revision-20261018/ui");
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
  server.listen(Number(process.env.ATLAS_UI_PORT || 0), "127.0.0.1", resolve),
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
async function expectFilterReset(page, view) {
  const reset = page.getByRole("button", {
    name: "지도 필터 초기화",
    exact: true,
  });
  const search = page.getByRole("searchbox", {
    name: "지명 검색",
    exact: true,
  });
  const target = await reset.boundingBox();
  const input = await search.boundingBox();
  assert(target.width >= 44 && target.height >= 44, "Reset touch target");
  assert(
    target.x >= input.x + input.width &&
      Math.abs(target.y + target.height / 2 - input.y - input.height / 2) < 2,
    "Reset stays at the right of the search on the same row",
  );
  const camera = async () =>
    page.evaluate((globe) => {
      if (!globe) {
        const matrix = document
          .querySelector(".history-atlas__geography")
          .getCTM();
        return {
          zoom: document.querySelector(".history-atlas__zoom").textContent,
          transform: [matrix.a, matrix.e, matrix.f].map(
            (value) => Math.round(value * 1e6) / 1e6 || 0,
          ),
          land: document
            .querySelector(".history-atlas__land")
            .getAttribute("d"),
        };
      }
      return {
        zoom: document.querySelector(".history-globe__zoom").textContent,
        bearing: document
          .querySelector(".history-globe .atlas-compass")
          ?.getAttribute("style"),
      };
    }, view === "globe");
  const resetAndCompare = async () => {
    await page.waitForTimeout(350);
    if (view !== "globe")
      await page.waitForFunction(
        () => !document.querySelector(".history-atlas--focusing"),
      );
    const before = await camera();
    await reset.press("Enter");
    await page.waitForTimeout(350);
    if (view !== "globe")
      await page.waitForFunction(
        () => !document.querySelector(".history-atlas--focusing"),
      );
    assert.deepEqual(await camera(), before, view + ": reset preserves camera");
    for (const name of [
      "단원",
      "시대",
      view === "korea" ? "지역 · 8도" : "지역",
    ])
      assert.equal(
        await page.getByRole("combobox", { name, exact: true }).inputValue(),
        "",
      );
    assert.equal(await search.inputValue(), "");
    assert.equal(
      await page
        .locator(".history-atlas__overlay, .history-globe__overlay")
        .count(),
      0,
    );
  };
  // First clear the selected region/country left by the preceding interaction.
  await resetAndCompare();
  for (const name of ["단원", "시대"])
    await page
      .getByRole("combobox", { name, exact: true })
      .selectOption({ index: 1 });
  const region = page.getByRole("combobox", {
    name: view === "korea" ? "지역 · 8도" : "지역",
    exact: true,
  });
  await region.selectOption(
    view === "korea"
      ? "area:giho"
      : view === "globe"
        ? "world:africa"
        : "africa",
  );
  if (view !== "korea")
    await page
      .getByRole("combobox", { name: "세부 지역", exact: true })
      .selectOption("africa-east");
  await search.fill("초기화검증없는지명");
  await page
    .getByRole("button", {
      name: view === "globe" ? "지구본 확대" : "지도 확대",
      exact: true,
    })
    .click();
  await page
    .locator(view === "globe" ? "canvas" : ".history-atlas__map")
    .press("ArrowRight");
  await resetAndCompare();
  assert.equal(
    await page
      .getByRole("combobox", { name: "세부 지역", exact: true })
      .count(),
    0,
  );
  // Repeating reset must remain stable, and navigation must still work afterwards.
  await resetAndCompare();
  await page
    .getByRole("button", {
      name: view === "globe" ? "지구본 전체 보기" : "전체 보기",
      exact: true,
    })
    .click();
}
async function expectRegionDescription(page) {
  const article = page.getByRole("article", { name: "지역 설명", exact: true });
  await article.locator(".atlas-place-details__definition").waitFor();
  assert(
    (await article.locator(".atlas-place-details__definition").innerText())
      .length > 10,
  );
  assert.equal(await article.locator("details").getAttribute("open"), null);
  await expectPopupReading(article);
}
async function expectPopupReading(
  article,
  { leaveScrolled = false, requireScroll = false } = {},
) {
  const body = article.locator(".atlas-place-details__body");
  assert.equal(
    await body.evaluate((element) => element.scrollTop),
    0,
    "New selection starts at the top",
  );
  assert.equal(await body.getAttribute("tabindex"), "0");
  assert.equal(await body.getAttribute("role"), "region");
  assert(await body.getAttribute("aria-label"), "Reading region has a name");
  await article.locator("h2").evaluate((title) => {
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  });
  for (let step = 0; step < 3; step++) {
    if (await body.evaluate((element) => document.activeElement === element))
      break;
    await article.page().keyboard.press("Tab");
  }
  assert(
    await body.evaluate((element) => document.activeElement === element),
    "Tab reaches the reading body from the title",
  );
  if (
    await body.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    )
  ) {
    await body.press("PageDown");
    await article
      .page()
      .waitForFunction(
        () =>
          document.activeElement?.matches(".atlas-place-details__body") &&
          document.activeElement.scrollTop > 0,
      );
    await body.evaluate((element) =>
      element.scrollTo({ top: 0, behavior: "instant" }),
    );
  }
  const reading = await article.evaluate(async (element, leaveScrolled) => {
    const body = element.querySelector(".atlas-place-details__body");
    const header = element.querySelector(".atlas-place-details__header");
    const shell = element.parentElement;
    const headerTop = header.getBoundingClientRect().top;
    body.scrollTop = body.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const paragraphs = element.querySelectorAll(
      ".atlas-place-details__definition, .atlas-place-details__paragraphs p, .atlas-place-details__name-note, .atlas-place-details__relation-context",
    );
    const typography = [...paragraphs].map((paragraph) => {
      const style = getComputedStyle(paragraph);
      return {
        left: paragraph.getBoundingClientRect().left,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
      };
    });
    const result = {
      headerTop,
      headerAfter: header.getBoundingClientRect().top,
      headerBottom: header.getBoundingClientRect().bottom,
      bodyTop: body.getBoundingClientRect().top,
      bodyHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyScroll: body.scrollTop,
      bodyWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      outerScroll: shell.scrollTop,
      outerOverflow: getComputedStyle(shell).overflowY,
      typography,
    };
    if (!leaveScrolled) body.scrollTop = 0;
    return result;
  }, leaveScrolled);
  assert.equal(
    reading.headerAfter,
    reading.headerTop,
    "Popup title stays fixed",
  );
  assert(
    reading.bodyTop >= reading.headerBottom,
    "Scrollbar starts below title",
  );
  assert.equal(reading.outerScroll, 0, "Outer popup does not scroll");
  assert.equal(reading.outerOverflow, "hidden", "Only the popup body scrolls");
  assert(reading.bodyHeight > 60, "Popup retains a readable body height");
  assert(
    reading.bodyScrollWidth <= reading.bodyWidth + 1,
    "No body horizontal overflow",
  );
  if (requireScroll)
    assert(
      reading.bodyScrollHeight > reading.bodyHeight,
      "Long narrative needs scrolling",
    );
  if (reading.bodyScrollHeight > reading.bodyHeight)
    assert(reading.bodyScroll > 0, "Long narrative scrolls inside the body");
  assert(reading.typography.length > 0, "Popup has readable narrative text");
  for (const paragraph of reading.typography) {
    assert(
      Math.abs(paragraph.left - reading.typography[0].left) < 1,
      "Overview, narrative and notes share the same left column",
    );
    assert.equal(paragraph.fontFamily, reading.typography[0].fontFamily);
    assert.equal(paragraph.fontSize, "16px");
    assert.equal(paragraph.fontWeight, "400");
    assert.equal(paragraph.lineHeight, "26.4px");
  }
  return reading;
}
async function expectCountryTypography(article) {
  const reading = await expectPopupReading(article, { requireScroll: true });
  assert(
    reading.typography.length > 1,
    "Country narrative uses readable paragraphs",
  );
}
async function expectFreePanning(page, view) {
  const map = page.locator(".history-atlas__map");
  const homeLand = await page.locator(".history-atlas__land").getAttribute("d");
  const camera = () =>
    page.locator(".history-atlas__geography").evaluate((element) => {
      const matrix = element.getCTM();
      return { x: matrix.e, y: matrix.f, scale: matrix.a };
    });
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    await page.getByRole("button", { name: "전체 보기", exact: true }).click();
    await page.getByRole("button", { name: "지도 확대", exact: true }).click();
    const box = await map.boundingBox();
    const before = await camera();
    const stepX = dx * box.width * 0.5;
    const stepY = dy * box.height * 0.5;
    for (let drag = 0; drag < 5; drag++) {
      const start = [
        box.x + box.width / 2 - stepX / 2,
        box.y + box.height / 2 - stepY / 2,
      ];
      await page.mouse.move(...start);
      await page.mouse.down();
      await page.mouse.move(start[0] + stepX, start[1] + stepY, { steps: 3 });
      await page.mouse.up();
    }
    const after = await camera();
    assert(
      Math.abs(after.x - before.x - stepX * 5) < 5,
      `${view}: repeated horizontal drag is not capped`,
    );
    assert(
      Math.abs(after.y - before.y - stepY * 5) < 5,
      `${view}: repeated vertical drag is not capped`,
    );
    assert.equal(after.scale, before.scale);
  }
  await map.press("Home");
  const reset = await camera();
  assert.deepEqual(reset, { x: 0, y: 0, scale: 1 });
  await page.waitForFunction(
    (land) =>
      document.querySelector(".history-atlas__land")?.getAttribute("d") ===
      land,
    homeLand,
  );
}
async function waitForTerrainRaster(page) {
  await page
    .locator("[data-atlas-terrain-raster]")
    .first()
    .waitFor({ state: "attached" });
  await page.waitForFunction(
    () =>
      document
        .querySelector(".history-atlas__terrain")
        ?.getAttribute("data-atlas-terrain-ready") !== "false",
  );
}
async function terrainTileState(page, includeBuffer = true) {
  return page.evaluate((buffer) => {
    const map = document
      .querySelector(".history-atlas__map")
      .getBoundingClientRect();
    const tiles = Array.from(
      document.querySelectorAll("[data-atlas-terrain-tile]"),
    ).map((image) => {
      const bounds = image.getBoundingClientRect();
      return {
        key: image.getAttribute("data-atlas-terrain-tile"),
        href: image.getAttribute("href"),
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
      };
    });
    const covered =
      tiles.length > 0 &&
      (buffer
        ? [-300, 4, map.width / 2, map.width - 4, map.width + 300]
        : [4, map.width / 2, map.width - 4]
      ).every((x) =>
        (buffer
          ? [-300, 4, map.height / 2, map.height - 4, map.height + 300]
          : [4, map.height / 2, map.height - 4]
        ).every((y) =>
          tiles.some(
            (tile) =>
              tile.left <= map.left + x &&
              tile.right >= map.left + x &&
              tile.top <= map.top + y &&
              tile.bottom >= map.top + y,
          ),
        ),
      );
    return { tiles, covered, encoded: window.__terrainEncodeCalls };
  }, includeBuffer);
}
async function expectBufferedNavigation(page, view) {
  const map = page.locator(".history-atlas__map");
  await page.getByRole("button", { name: "전체 보기", exact: true }).click();
  await map.scrollIntoViewIfNeeded();
  const bitmap = page.locator('[data-atlas-gesture-current="true"]');
  await bitmap.waitFor({ state: "attached" });
  const pixels = await bitmap.evaluate((canvas) => {
    const data = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    let painted = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (!data[offset + 3]) continue;
      painted++;
      if (colors.size < 256)
        colors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
    }
    return {
      colors: colors.size,
      painted,
      width: canvas.width,
      height: canvas.height,
    };
  });
  assert(
    pixels.width * pixels.height <= 2_000_000,
    "The gesture bitmap stays within its pixel budget",
  );
  assert(
    pixels.painted > 1000 && pixels.colors > 10,
    "The prepared gesture image contains geographic detail",
  );
  const width = page.viewportSize().width;
  await map.screenshot({
    path: path.join(out, `${view}-${width}-settled-map.png`),
  });
  const camera = () =>
    page.locator(".history-atlas__geography").evaluate((element) => {
      const matrix = element.getCTM();
      return { x: matrix.e, y: matrix.f, scale: matrix.a };
    });
  const before = await camera();
  const box = await map.boundingBox();
  const start = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.8 };
  const initialTiles = await terrainTileState(page);
  if (initialTiles.tiles.length) {
    assert(
      initialTiles.covered,
      "Terrain tiles cover the viewport and its pan buffer",
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 48, start.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    await waitForTerrainRaster(page);
    await bitmap.waitFor({ state: "attached" });
    const afterPan = await terrainTileState(page);
    const originals = new Map(
      initialTiles.tiles.map((tile) => [tile.key, tile.href]),
    );
    const reused = afterPan.tiles.filter((tile) => originals.has(tile.key));
    const added = afterPan.tiles.filter((tile) => !originals.has(tile.key));
    assert(
      reused.length > 0 &&
        reused.every((tile) => originals.get(tile.key) === tile.href),
      "Panning reuses the same encoded terrain tiles",
    );
    assert(
      afterPan.encoded - initialTiles.encoded <= added.length,
      "Panning encodes only newly exposed tiles",
    );
    assert(
      afterPan.covered,
      "New terrain tiles complete the translated viewport and buffer",
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 48, start.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    await waitForTerrainRaster(page);
    await bitmap.waitFor({ state: "attached" });
  }
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y + 8);
  await page.mouse.move(start.x, start.y);
  await page.waitForFunction(
    () =>
      document.querySelector("[data-atlas-gesture-surface]")?.style.display ===
      "block",
  );
  await map.screenshot({
    path: path.join(out, `${view}-${width}-moving-map.png`),
  });
  // A single captured pointer crosses the clip buffer and then comes back.
  // Separate short drags would never exercise the mid-gesture buffer refresh.
  await page.mouse.move(start.x + 700, start.y, { steps: 18 });
  await page.waitForFunction((originX) => {
    const element = document.querySelector(".history-atlas__geography");
    return Math.abs(element.getCTM().e - originX) >= 300;
  }, before.x);
  if (initialTiles.tiles.length) {
    await waitForTerrainRaster(page);
    assert(
      (await terrainTileState(page, false)).covered,
      "Terrain coverage remains complete while a captured long drag is held",
    );
  }
  await page.mouse.move(start.x, start.y, { steps: 18 });
  await page.mouse.up();
  const restored = await camera();
  assert(
    Math.abs(restored.x - before.x) < 2 && Math.abs(restored.y - before.y) < 2,
    `${view}: a 700px drag out and back retains the pointer's original anchor`,
  );
  for (let index = 0; index < 3; index++)
    await page.getByRole("button", { name: "지도 확대", exact: true }).click();
  await map.evaluate(
    (target) =>
      new Promise((resolve) => {
        const box = target.getBoundingClientRect();
        let step = 0;
        const zoomOut = () => {
          target.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              clientX: box.x + box.width / 2,
              clientY: box.y + box.height / 2,
              deltaY: 40,
            }),
          );
          if (++step < 24) requestAnimationFrame(zoomOut);
          else resolve();
        };
        requestAnimationFrame(zoomOut);
      }),
  );
  await page.waitForTimeout(250);
  await map.press("Home");
  assert.deepEqual(await camera(), { x: 0, y: 0, scale: 1 });
  assert(
    (await page.locator(".history-atlas__land").getAttribute("d")).length > 100,
    `${view}: Home restores the geographic surface after buffered navigation`,
  );
  await waitForTerrainRaster(page);
  assert.equal(
    await page
      .locator("[data-atlas-gesture-surface]")
      .evaluate((canvas) => canvas.style.display),
    "none",
    "Home restores the exact SVG and hides the temporary bitmap",
  );
}
async function expectKoreanForeignPlaces(page) {
  const search = page.getByRole("searchbox", {
    name: "지명 검색",
    exact: true,
  });
  for (const [name, narrative] of [
    ["교토", "황윤길"],
    ["에도", "회답 겸 쇄환사"],
    ["심양", "소현세자"],
    ["북경", "아담 샬"],
    ["도쿄", "조선청년독립단"],
  ]) {
    await search.fill(name);
    const detail = page.locator(".history-atlas__overlay");
    await detail.getByRole("heading", { name, exact: true }).waitFor();
    assert(
      (await detail.innerText()).includes(narrative),
      `${name}: Korean historical context`,
    );
    const marker = page.locator(".history-atlas__point.is-active");
    await marker.waitFor();
    await page.waitForFunction(
      () => !document.querySelector(".history-atlas--focusing"),
    );
    // Leave each story at the bottom so the next existing selection also
    // verifies that the shared detail body resets its own scroll position.
    await expectPopupReading(detail.locator(".atlas-place-details"), {
      leaveScrolled: true,
      requireScroll: true,
    });
    const point = await marker.boundingBox();
    const map = await page.locator(".history-atlas__map").boundingBox();
    assert(
      point.x >= map.x &&
        point.x + point.width <= map.x + map.width &&
        point.y >= map.y &&
        point.y + point.height <= map.y + map.height,
      `${name}: selection moves its marker into the map`,
    );
  }
  await search.fill("");
  await page
    .getByRole("button", { name: "장소 설명 닫기", exact: true })
    .click();
  await page.getByRole("button", { name: "전체 보기", exact: true }).click();
}
async function expectSelectedCountryBitmap(page) {
  await page.locator(".history-atlas__country-label").first().press("Enter");
  await page.waitForFunction(
    () => !document.querySelector(".history-atlas--focusing"),
  );
  await waitForTerrainRaster(page);
  await page
    .locator('[data-atlas-gesture-current="true"]')
    .waitFor({ state: "attached" });
  const active = page.locator(".history-atlas__country.is-active");
  assert.equal(await active.count(), 1);
  assert(
    await active.evaluate((path) => !!path.closest("[clip-path]")),
    "The selected country keeps its land clip",
  );
  const map = page.locator(".history-atlas__map");
  await map.scrollIntoViewIfNeeded();
  const width = page.viewportSize().width;
  await map.screenshot({
    path: path.join(out, `world-${width}-selected-settled-map.png`),
  });
  const start = await map.evaluate((target) => {
    const bounds = target.getBoundingClientRect();
    for (const y of [0.2, 0.5, 0.8])
      for (const x of [0.2, 0.5, 0.8]) {
        const point = {
          x: bounds.left + bounds.width * x,
          y: bounds.top + bounds.height * y,
        };
        const hit = document.elementFromPoint(point.x, point.y);
        if (
          hit === target ||
          (hit instanceof SVGElement && target.contains(hit))
        )
          return point;
      }
    return null;
  });
  assert(
    start,
    "An uncovered map point can start the selected-country gesture",
  );
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y + 8);
  await page.mouse.move(start.x, start.y);
  await page.waitForFunction(
    () =>
      document.querySelector("[data-atlas-gesture-surface]")?.style.display ===
      "block",
  );
  await map.screenshot({
    path: path.join(out, `world-${width}-selected-moving-map.png`),
  });
  await page.mouse.up();
  assert.equal(
    await active.count(),
    1,
    "The selected country remains active after bitmap navigation",
  );
}
const terrainPixelCount = () => {
  const canvas = document.querySelector(".history-globe canvas");
  if (!canvas) return 0;
  const pixels = canvas
    .getContext("2d")
    .getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (
      (pixels[index] === 203 &&
        pixels[index + 1] === 216 &&
        pixels[index + 2] === 202) ||
      (pixels[index] === 222 &&
        pixels[index + 1] === 215 &&
        pixels[index + 2] === 200) ||
      (pixels[index] === 237 &&
        pixels[index + 1] === 213 &&
        pixels[index + 2] === 165) ||
      (pixels[index] === 230 &&
        pixels[index + 1] === 237 &&
        pixels[index + 2] === 223)
    )
      count++;
  }
  return count;
};
async function expectGlobeRendering(
  page,
  width,
  contextLoss = false,
  suffix = "gpu",
) {
  const canvas = page.locator(".history-globe canvas");
  await canvas.scrollIntoViewIfNeeded();
  if (suffix === "gpu")
    await page.waitForFunction(
      () =>
        document
          .querySelector(".history-globe canvas")
          ?.getAttribute("data-globe-texture-ready") === "true",
    );
  else await page.waitForTimeout(2000);
  await canvas.screenshot({
    path: path.join(out, `globe-${width}-${suffix}-settled.png`),
  });
  const point = await canvas.evaluate((target) => {
    const box = target.getBoundingClientRect();
    for (const y of [0.5, 0.65, 0.35])
      for (const x of [0.45, 0.6, 0.3]) {
        const point = { x: box.x + box.width * x, y: box.y + box.height * y };
        if (document.elementFromPoint(point.x, point.y) === target)
          return point;
      }
  });
  assert(point, "A visible globe surface receives the captured pointer");
  const paintedPixels = () =>
    canvas.evaluate((target) => {
      const pixels = target
        .getContext("2d")
        .getImageData(0, 0, target.width, target.height).data;
      let painted = 0;
      const colors = new Set();
      for (let index = 0; index < pixels.length; index += 4)
        if (pixels[index + 3]) {
          painted++;
          if (colors.size < 256)
            colors.add(
              `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`,
            );
        }
      return { painted, colors: colors.size };
    });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 12, point.y + 8);
  await page.mouse.move(point.x, point.y);
  await canvas.screenshot({
    path: path.join(out, `globe-${width}-${suffix}-moving.png`),
  });
  let pixels = await paintedPixels();
  assert.equal(
    await canvas.getAttribute("data-globe-renderer"),
    suffix === "gpu" ? "webgl" : "canvas",
    "The measured gesture uses its intended renderer",
  );
  assert(
    pixels.painted > 1000 && pixels.colors > 10,
    "The moving globe retains visible geographic detail",
  );
  if (contextLoss) {
    const contexts = await page.evaluate(() => window.__globeContexts.length);
    checks.push({ globeWebGLContexts: contexts, width });
    assert(
      contexts > 0,
      "The normal Chromium fixture can exercise WebGL context recovery",
    );
    await page.evaluate(() => {
      window.__globeRecovery = window.__globeContexts.map((context) =>
        context.getExtension("WEBGL_lose_context"),
      );
      window.__globeRecovery.forEach((extension) => extension?.loseContext());
    });
    await page.waitForFunction(() =>
      window.__globeContexts.every((context) => context.isContextLost()),
    );
    await page.mouse.move(point.x + 18, point.y + 8);
    await page.waitForFunction(
      () =>
        document
          .querySelector(".history-globe canvas")
          ?.getAttribute("data-globe-renderer") === "canvas",
    );
    pixels = await paintedPixels();
    assert(
      pixels.painted > 1000 && pixels.colors > 10,
      "Context loss keeps a visible CPU fallback",
    );
    await canvas.screenshot({
      path: path.join(out, `globe-${width}-context-lost.png`),
    });
    await page.mouse.up();
    await page.waitForTimeout(200);
    await page.evaluate(() =>
      window.__globeRecovery.forEach((extension) =>
        extension?.restoreContext(),
      ),
    );
    await page.waitForFunction(() =>
      window.__globeContexts.every((context) => !context.isContextLost()),
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector(".history-globe canvas")
          ?.getAttribute("data-globe-texture-ready") === "true",
    );
    const restart = await canvas.evaluate((target) => {
      const bounds = target.getBoundingClientRect();
      for (const [x, y] of [
        [0.1, 0.8],
        [0.85, 0.8],
        [0.1, 0.2],
      ]) {
        const point = {
          x: bounds.x + bounds.width * x,
          y: bounds.y + bounds.height * y,
        };
        if (document.elementFromPoint(point.x, point.y) === target)
          return point;
      }
    });
    assert(
      restart,
      "Restored interaction starts on uncovered canvas, not a moved country label",
    );
    await page.mouse.move(restart.x, restart.y);
    await page.mouse.down();
    await page.mouse.move(restart.x + 20, restart.y + 12);
    await page.waitForFunction(
      () =>
        document
          .querySelector(".history-globe canvas")
          ?.getAttribute("data-globe-renderer") === "webgl",
    );
    pixels = await paintedPixels();
    assert.equal(
      await canvas.getAttribute("data-globe-renderer"),
      "webgl",
      "Restoration returns interaction to the accelerated renderer",
    );
    assert(
      pixels.painted > 1000 && pixels.colors > 10,
      "The globe remains usable after context restoration",
    );
  }
  await page.mouse.up();
  await canvas.press("Home");
}
try {
  for (const width of process.env.ATLAS_UI_WIDTHS
    ? process.env.ATLAS_UI_WIDTHS.split(",").map(Number)
    : [320, 390, 768, 1280, 1366, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 1366 ? 768 : 900 },
    });
    activePage = page;
    await page.addInitScript(() => {
      window.__globeContexts = [];
      window.__terrainEncodeCalls = 0;
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (...args) {
        window.__terrainEncodeCalls++;
        return toBlob.apply(this, args);
      };
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        const context = getContext.call(this, type, ...args);
        if (context && (type === "webgl" || type === "webgl2"))
          window.__globeContexts.push(context);
        return context;
      };
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    for (const view of (
      process.env.ATLAS_UI_VIEWS || "korea,world,globe"
    ).split(",")) {
      await page.goto(`${origin}/#/teacher/lesson/maps?view=${view}`);
      await page.reload();
      if (view === "globe")
        await page.locator(".history-globe canvas").waitFor();
      else
        await page
          .locator(".history-atlas__land")
          .waitFor({ state: "attached" });
      await page.waitForFunction(
        () =>
          !document.querySelector('[role="alert"]') &&
          !document.body.textContent.includes("지도를 불러오는 중"),
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${view}/${width} overflow`,
      );
      const terrainToggle = page.getByRole("button", {
        name: "지형",
        exact: true,
      });
      assert.equal(
        await terrainToggle.getAttribute("aria-pressed"),
        "false",
        `${view}/${width}: terrain defaults off`,
      );
      const target = await terrainToggle.boundingBox();
      const title = await page.getByRole("heading", { level: 1 }).boundingBox();
      assert(
        target.x >= title.x + title.width &&
          target.x - title.x - title.width < 80 &&
          Math.abs(target.y + target.height / 2 - title.y - title.height / 2) <
            2,
        `${view}/${width}: terrain badge stays beside the title`,
      );
      assert.equal(
        await terrainToggle.locator("[data-terrain-eye-slash]").count(),
        1,
      );
      assert(
        target.width >= 44 && target.height >= 44,
        "Terrain toggle has a touch target",
      );
      if (view === "globe") {
        await page.waitForFunction(`(${terrainPixelCount.toString()})() === 0`);
      } else {
        assert.equal(
          await page
            .locator(
              "[data-terrain-id], [data-terrain-label], [data-atlas-terrain-raster]",
            )
            .count(),
          0,
        );
        if (view === "korea")
          assert(
            (await page.locator("[data-traditional-region]").count()) >= 9,
          );
      }
      assert.equal(await terrainToggle.getAttribute("aria-pressed"), "false");
      assert.equal(
        await page.evaluate(
          () =>
            performance
              .getEntriesByType("resource")
              .filter((entry) => entry.name.endsWith("/assets/terrain.json"))
              .length,
        ),
        0,
        "The default map does not request the optional terrain payload",
      );
      assert.equal(
        await terrainToggle.locator("[data-terrain-eye-slash]").count(),
        1,
      );
      await terrainToggle.press("Space");
      assert.equal(
        await terrainToggle.getAttribute("aria-pressed"),
        "true",
        "Keyboard restores terrain",
      );
      assert.equal(
        await terrainToggle.locator("[data-terrain-eye-slash]").count(),
        0,
      );
      if (view === "globe") await page.waitForFunction(terrainPixelCount);
      else await waitForTerrainRaster(page);
      // Toggling back off must remove geometry as well as names, then a second
      // enable must recover the cached terrain without leaving an empty image.
      await terrainToggle.click();
      if (view === "globe")
        await page.waitForFunction(`(${terrainPixelCount.toString()})() === 0`);
      else
        assert.equal(
          await page
            .locator("[data-atlas-terrain-raster], [data-terrain-label]")
            .count(),
          0,
        );
      await terrainToggle.click();
      if (view === "globe") await page.waitForFunction(terrainPixelCount);
      else {
        const raster = page.locator("[data-atlas-terrain-raster]");
        await waitForTerrainRaster(page);
        const rasterPixels = await raster.evaluateAll(async (elements) => {
          let painted = 0;
          let pixels = 0;
          for (const element of elements) {
            const image = new Image();
            image.src = element.getAttribute("href");
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            pixels += canvas.width * canvas.height;
            const context = canvas.getContext("2d");
            context.drawImage(image, 0, 0);
            const data = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            for (let index = 3; index < data.length; index += 4)
              if (data[index]) painted++;
          }
          return { painted, pixels };
        });
        assert(
          rasterPixels.painted > 100,
          `${view}/${width}: restored terrain contains painted pixels`,
        );
        assert(
          rasterPixels.pixels <= 2_005_000,
          "Decoded terrain tiles stay within their bounded pixel budget",
        );
      }
      for (const enabled of [false, true, false]) {
        await terrainToggle.click();
        assert.equal(
          await terrainToggle.getAttribute("aria-pressed"),
          String(enabled),
        );
      }
      await page.waitForTimeout(250);
      if (view === "globe")
        await page.waitForFunction(`(${terrainPixelCount.toString()})() === 0`);
      else
        assert.equal(
          await page
            .locator("[data-atlas-terrain-raster], [data-terrain-label]")
            .count(),
          0,
          "Canceled terrain work does not reappear after rapid toggles",
        );
      await terrainToggle.click();
      if (view === "globe") await page.waitForFunction(terrainPixelCount);
      else await waitForTerrainRaster(page);
      if (view === "korea") {
        if (process.env.ATLAS_UI_RENDERING_ONLY === "1") {
          await expectBufferedNavigation(page, view);
          assert.deepEqual(
            errors,
            [],
            `${view}/${width}: rendering runtime errors`,
          );
          checks.push({ view, width, rendering: true, passed: true });
          continue;
        }
        await expectBufferedNavigation(page, view);
        if (width === 1280) await expectFreePanning(page, view);
        await expectKoreanForeignPlaces(page);
        assert((await page.locator("[data-traditional-region]").count()) >= 9);
        await page
          .getByRole("combobox", { name: "지역 · 8도", exact: true })
          .selectOption("area:giho");
        await page
          .getByRole("heading", { name: "기호", exact: true })
          .waitFor();
        await expectRegionDescription(page);
        await page
          .getByRole("button", { name: "장소 설명 닫기", exact: true })
          .click();
        await page
          .getByRole("button", { name: "전체 보기", exact: true })
          .click();
      }
      if (view === "world") {
        if (process.env.ATLAS_UI_RENDERING_ONLY === "1") {
          await expectBufferedNavigation(page, view);
          await expectSelectedCountryBitmap(page);
          assert.deepEqual(
            errors,
            [],
            `${view}/${width}: rendering runtime errors`,
          );
          checks.push({ view, width, rendering: true, passed: true });
          continue;
        }
        await expectBufferedNavigation(page, view);
        if (width === 1280) await expectFreePanning(page, view);
        await page
          .getByRole("combobox", { name: "지역", exact: true })
          .selectOption("africa");
        await page
          .getByRole("combobox", { name: "세부 지역", exact: true })
          .selectOption("africa-east");
        await page.locator(".history-atlas__province-label").click();
        await expectRegionDescription(page);
        await page
          .getByRole("searchbox", { name: "지명 검색", exact: true })
          .fill("올두바이");
        await page.locator(".history-atlas__overlay").waitFor();
        await page.waitForFunction(
          () => !document.querySelector(".history-atlas--focusing"),
        );
        await expectPopupReading(page.locator(".atlas-place-details"), {
          requireScroll: width <= 768,
        });
        await page
          .getByRole("button", { name: "장소 설명 닫기", exact: true })
          .click();
        const label = page.locator('[data-country-label="TZA"]');
        await page
          .getByRole("button", { name: "지도 필터 초기화", exact: true })
          .click();
        assert.equal(
          await page
            .locator('path[data-country-id="TZA"]')
            .evaluate((element) => getComputedStyle(element).pointerEvents),
          "none",
          "Country fills cannot intercept pointer events intended for overlapping terrain",
        );
        await page
          .locator('path[data-country-id="TZA"]')
          .dispatchEvent("click");
        assert.equal(
          await page.locator(".history-atlas__country.is-active").count(),
          0,
          "Country geometry must not select a country",
        );
        // Reset intentionally retains the Olduvai camera. On a narrow map,
        // Tanzania's geographic name anchor can remain below the viewport.
        // Use normal map navigation to bring that name into view before testing
        // its keyboard action; never activate an offscreen or synthetic label.
        for (
          let attempt = 0;
          attempt < 12 && !(await label.count());
          attempt++
        ) {
          const map = page.locator(".history-atlas__map");
          const mapBox = await map.boundingBox();
          const countryBox = await page
            .locator('path[data-country-id="TZA"]')
            .boundingBox();
          const dx =
            countryBox.x + countryBox.width / 2 - mapBox.x - mapBox.width / 2;
          const dy =
            countryBox.y + countryBox.height / 2 - mapBox.y - mapBox.height / 2;
          if (Math.abs(dx) < 48 && Math.abs(dy) < 48) {
            const zoomIn = page.getByRole("button", {
              name: "지도 확대",
              exact: true,
            });
            if (await zoomIn.isDisabled()) break;
            await zoomIn.click();
          } else
            await map.press(
              Math.abs(dx) > Math.abs(dy)
                ? dx > 0
                  ? "ArrowRight"
                  : "ArrowLeft"
                : dy > 0
                  ? "ArrowDown"
                  : "ArrowUp",
            );
        }
        assert(
          await label.count(),
          "Tanzania's name must be reachable by normal panning and zooming, including when terrain names overlap",
        );
        await label.waitFor();
        await label.press("Enter");
        await page
          .getByRole("article", { name: "탄자니아 설명", exact: true })
          .waitFor();
        await expectCountryTypography(
          page.getByRole("article", { name: "탄자니아 설명", exact: true }),
        );
        await page.screenshot({
          path: path.join(out, `country-world-${width}.png`),
          fullPage: true,
        });
        assert(
          await page
            .getByRole("heading", { name: "대한민국과의 관계", exact: true })
            .count(),
        );
        assert(
          await page
            .getByRole("heading", { name: "역사", exact: true })
            .count(),
        );
        assert(
          (await page.locator(".history-atlas__country.is-active").count()) ===
            1,
        );
      }
      if (view === "globe") {
        await expectGlobeRendering(page, width, width === 390);
        const countryLabel = page
          .locator(
            '[data-globe-country]:not([data-globe-country="KOR"]):visible',
          )
          .first();
        await countryLabel.waitFor();
        const countryName = (
          await countryLabel.getAttribute("aria-label")
        ).replace(/ 설명 보기$/, "");
        await countryLabel.press("Enter");
        await page
          .getByRole("article", { name: `${countryName} 설명`, exact: true })
          .waitFor();
        await expectCountryTypography(
          page.getByRole("article", {
            name: `${countryName} 설명`,
            exact: true,
          }),
        );
        await page.screenshot({
          path: path.join(out, `country-globe-${width}.png`),
          fullPage: true,
        });
        assert(
          await page
            .getByRole("heading", { name: "역사", exact: true })
            .count(),
        );
        assert(
          await page
            .getByRole("heading", { name: "대한민국과의 관계", exact: true })
            .count(),
        );
        await page
          .getByRole("button", { name: "장소 설명 닫기", exact: true })
          .press("Enter");
        await page.locator("canvas").press("ArrowRight");
        await page
          .getByRole("combobox", { name: "지역", exact: true })
          .selectOption("world:europe");
        const regionLabel = page.locator('[data-globe-region="europe"]');
        // The active badge's decorative ripple changes its bounding box even
        // after camera motion ends. Wait for the geographic transform itself.
        await page.waitForFunction(async () => {
          const started = performance.now();
          let previous = "",
            stableSince = started;
          return new Promise((resolve) => {
            const frame = (now) => {
              const label = document.querySelector(
                '[data-globe-region="europe"]',
              );
              const current =
                label && label.style.display !== "none"
                  ? label.getAttribute("transform")
                  : "";
              if (current !== previous) {
                previous = current;
                stableSince = now;
              }
              if (current && now - started >= 350 && now - stableSince >= 100)
                resolve(true);
              else requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          });
        });
        await regionLabel.press("Enter");
        await expectRegionDescription(page);
        await page
          .getByRole("button", { name: "장소 설명 닫기", exact: true })
          .click();
        await page
          .getByRole("combobox", { name: "지역", exact: true })
          .selectOption("");
      }
      await expectFilterReset(page, view);
      assert.deepEqual(errors, [], `${view}/${width} browser errors`);
      await page.screenshot({
        path: path.join(out, `${view}-${width}.png`),
        fullPage: true,
      });
      checks.push({ view, width, passed: true });
    }
    await page.close();
  }
  const retry = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  let fail = true;
  await retry.route("**/assets/terrain.json", (route) =>
    fail
      ? route.fulfill({ status: 503, body: "unavailable" })
      : route.continue(),
  );
  await retry.goto(`${origin}/#/student/lesson/maps`);
  await retry.getByRole("button", { name: "지형", exact: true }).click();
  await retry
    .getByRole("alert")
    .filter({ hasText: "지형을 불러오지 못했습니다." })
    .waitFor();
  fail = false;
  await retry
    .getByRole("alert")
    .getByRole("button", { name: "다시 시도" })
    .click();
  await waitForTerrainRaster(retry);
  await retry.getByRole("alert").waitFor({ state: "hidden" });
  checks.push({ retry: true, passed: true });
  await retry.getByRole("button", { name: "지형", exact: true }).click();
  for (const name of ["세계사", "지구본", "한국사"]) {
    await retry.getByRole("button", { name, exact: true }).click();
    assert.equal(
      await retry
        .getByRole("button", { name: "지형", exact: true })
        .getAttribute("aria-pressed"),
      "false",
      `${name}: terrain preference survives view switching`,
    );
  }
  checks.push({ terrainPreferenceAcrossViews: true, passed: true });
  await retry.close();
  if (
    !process.env.ATLAS_UI_VIEWS ||
    process.env.ATLAS_UI_VIEWS.includes("globe")
  ) {
    const fallback = await browser.newPage({
      viewport: { width: 390, height: 900 },
    });
    activePage = fallback;
    const errors = [];
    fallback.on("pageerror", (error) => errors.push(error.message));
    await fallback.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type === "webgl" || type === "webgl2"
          ? null
          : getContext.call(this, type, ...args);
      };
    });
    await fallback.goto(`${origin}/#/student/lesson/maps?view=globe`);
    await fallback.getByRole("button", { name: "지형", exact: true }).click();
    await fallback.waitForFunction(terrainPixelCount);
    await expectGlobeRendering(fallback, 390, false, "forced-fallback");
    assert.deepEqual(
      errors,
      [],
      "WebGL-unavailable devices retain a working globe",
    );
    checks.push({ globeForcedFallback: true, passed: true });
    await fallback.close();
  }
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ checks }, null, 2),
  );
  console.log(`Atlas browser UI verified: ${checks.length} cases. ${out}`);
} catch (error) {
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
