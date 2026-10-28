/** Render the real bundled rigs and clothing without Firebase or external requests. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
const require = createRequire(import.meta.url);
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
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(
  process.env.GARMENT_REVIEW_OUTPUT ||
    path.join(root, "output/avatar-garments-20261028"),
);
await mkdir(out, { recursive: true });
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 5188 },
  logLevel: "error",
});
await server.listen();
const origin = server.resolvedUrls.local[0];
let browser;
const report = [],
  errors = [];
try {
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: 440, height: 600 },
    deviceScaleFactor: 1,
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(origin).origin) return route.abort();
    if (url.pathname === "/__garment-review")
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><body style="margin:0;background:#f5f7fa"><div id="stage" style="width:440px;height:570px"></div><div id="label" style="text-align:center;font:16px sans-serif"></div></body></html>',
      });
    return route.continue();
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("__garment-review", origin).href);
  const looks = [
    ["hanbok", { top: "hanbok-ivory", bottom: "baji-navy", accessory: "none" }],
    [
      "robe",
      {
        top: "official-navy",
        bottom: "plain-bottom",
        accessory: "official-samo",
      },
    ],
    [
      "summer",
      { top: "summer-white", bottom: "summer-shorts", accessory: "none" },
    ],
  ];
  for (const character of ["boy", "girl"]) {
    await page.evaluate(async (character) => {
      window.garmentStage?.dispose();
      const { createAvatarStage } =
        await import("/src/features/avatar/renderer/engine.js");
      window.garmentStage = await createAvatarStage(
        document.querySelector("#stage"),
        {
          character,
          skinTone: "original",
          faceShape: "natural",
          expression: "natural",
          hairStyle: character === "boy" ? "curtain" : "bob",
          hairTone: "original",
          pose: "idle",
          top: "plain-top",
          bottom: "plain-bottom",
          shoes: "plain-shoes",
          accessory: "none",
        },
        { maxPixelRatio: 1 },
      );
      window.garmentStage.stop();
    }, character);
    for (const [name, raw] of looks) {
      const look = { ...raw };
      if (character === "girl" && name === "hanbok") look.bottom = "chima-rose";
      for (const view of ["idle", "think", "cheer", "side", "back"]) {
        await page.evaluate(
          ({ look, view, label }) => {
            window.garmentStage.setLook(look);
            window.garmentStage.setPose(
              ["side", "back"].includes(view) ? "idle" : view,
            );
            window.garmentStage.resetView();
            if (view === "side") window.garmentStage.rotate(4);
            if (view === "back") window.garmentStage.rotate(8);
            window.garmentStage.stop();
            document.querySelector("#label").textContent = label;
          },
          { look, view, label: `${character} / ${name} / ${view}` },
        );
        await page.screenshot({
          path: path.join(out, `${character}-${name}-${view}.png`),
        });
        const stats = await page.evaluate(() => window.garmentStage.stats);
        assert(
          stats.triangles < 120000,
          `${character}/${name}: geometry budget`,
        );
        assert(stats.drawCalls < 70, `${character}/${name}: draw-call budget`);
        report.push({ character, name, view, stats });
      }
    }
  }
  assert.deepEqual(errors, [], "no browser renderer failures");
  await writeFile(
    path.join(out, "render-report.json"),
    JSON.stringify({ report, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      out,
      cases: report.length,
      errors,
      maxTriangles: Math.max(...report.map((r) => r.stats.triangles)),
      maxDrawCalls: Math.max(...report.map((r) => r.stats.drawCalls)),
    }),
  );
} finally {
  await browser?.close();
  await server.close();
}
