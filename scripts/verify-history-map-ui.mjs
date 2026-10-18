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
          .transform.baseVal.consolidate().matrix;
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
}
async function expectFreePanning(page, view) {
  const map = page.locator(".history-atlas__map");
  const homeLand = await page.locator(".history-atlas__land").getAttribute("d");
  const camera = () =>
    page.locator(".history-atlas__geography").evaluate((element) => {
      const matrix = element.transform.baseVal.consolidate().matrix;
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
const terrainPixelCount = () => {
  const canvas = document.querySelector(".history-globe canvas");
  if (!canvas) return 0;
  const pixels = canvas
    .getContext("2d")
    .getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const rgb = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`;
    if (
      ["203,216,202", "222,215,200", "237,213,165", "230,237,223"].includes(rgb)
    )
      count++;
  }
  return count;
};
try {
  for (const width of process.env.ATLAS_UI_WIDTHS
    ? process.env.ATLAS_UI_WIDTHS.split(",").map(Number)
    : [320, 390, 768, 1280, 1366, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 1366 ? 768 : 900 },
    });
    activePage = page;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    for (const view of ["korea", "world", "globe"]) {
      await page.goto(`${origin}/#/teacher/lesson/maps?view=${view}`);
      if (view === "globe")
        await page.locator(".history-globe canvas").waitFor();
      else
        await page
          .locator('[data-terrain-id="korea-taebaek"]')
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
        "true",
        `${view}/${width}: terrain defaults on`,
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
        0,
      );
      assert(
        target.width >= 44 && target.height >= 44,
        "Terrain toggle has a touch target",
      );
      if (view === "globe") {
        await page.waitForFunction(terrainPixelCount);
        await terrainToggle.click();
        await page.waitForFunction(`(${terrainPixelCount.toString()})() === 0`);
      } else {
        await terrainToggle.click();
        assert.equal(
          await page.locator("[data-terrain-id], [data-terrain-label]").count(),
          0,
        );
        if (view === "korea")
          assert(
            (await page.locator("[data-traditional-region]").count()) >= 9,
          );
      }
      assert.equal(await terrainToggle.getAttribute("aria-pressed"), "false");
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
      else
        await page
          .locator('[data-terrain-id="korea-taebaek"]')
          .waitFor({ state: "attached" });
      if (view === "korea") {
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
  await retry
    .getByRole("alert")
    .filter({ hasText: "지형을 불러오지 못했습니다." })
    .waitFor();
  fail = false;
  await retry
    .getByRole("alert")
    .getByRole("button", { name: "다시 시도" })
    .click();
  await retry
    .locator('[data-terrain-id="korea-taebaek"]')
    .waitFor({ state: "attached" });
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
