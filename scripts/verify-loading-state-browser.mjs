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
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence =
  process.env.LOADING_EVIDENCE_DIR ||
  path.join(root, ".superloopy/sessions/globe-loading/evidence");
await fs.mkdir(evidence, { recursive: true });
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PageLoading,InlineLoading,LoadingOverlay}from'./src/components/common/LoadingState';const mode=new URLSearchParams(location.search).get('mode');const root=createRoot(document.getElementById('root'));window.unmountLoading=()=>root.unmount();root.render(React.createElement(mode==='inline'?InlineLoading:mode==='overlay'?LoadingOverlay:PageLoading,{message:'OLD MESSAGE',detail:'OLD DETAIL',warning:'OLD WARNING'}));`,
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
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:'Noto Sans KR',sans-serif;background:#f9fafb}.z-\\[90\\]{z-index:90}${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/fixture.js" ? "text/javascript" : "text/html; charset=utf-8",
  );
  res.end(req.url === "/fixture.js" ? js : html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", (route) =>
  route.request().url().startsWith(url) ? route.continue() : route.abort(),
);
const checks = [];
try {
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    await page.locator(".ws-loading__land").waitFor();
    assert.equal(
      await page.getByRole("status", { name: "처리 중" }).count(),
      1,
    );
    assert.equal(
      (await page.locator("#root").textContent()).replace(/\s+/g, ""),
      "Westory처리중...",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const box = await page.locator(".ws-loading").boundingBox();
    assert.ok(Math.abs(box.x + box.width / 2 - width / 2) < 1);
    await page.screenshot({ path: path.join(evidence, `page-${width}.png`) });
    checks.push(
      `page ${width}px: centered, accessible, no old copy or overflow`,
    );
  }
  for (const mode of ["inline", "overlay"]) {
    await page.goto(`${url}?mode=${mode}`);
    await page.locator(".ws-loading").waitFor();
    await page.screenshot({ path: path.join(evidence, `${mode}-1280.png`) });
    assert.equal(
      await page.locator(".ws-loading__wordmark").innerText(),
      "Westory",
    );
  }
  await page.goto(url);
  await page.locator(".ws-loading").waitFor();
  const firstLand = await page.locator("[data-land]").getAttribute("d");
  await page.clock.install();
  const orbit = [];
  for (let i = 0; i < 45; i++) {
    await page.clock.runFor(400);
    orbit.push(
      await page.evaluate(() => {
        const layer = [
          ...document.querySelectorAll("[data-orbit-front],[data-orbit-back]"),
        ].find((node) => node.style.display !== "none");
        const m = layer.transform.baseVal.consolidate().matrix;
        return {
          rear: layer.hasAttribute("data-orbit-back"),
          x: m.e,
          y: m.f,
          radius: 6 * m.a,
        };
      }),
    );
  }
  assert.notEqual(
    await page.locator("[data-land]").getAttribute("d"),
    firstLand,
    "land must rotate on the sphere",
  );
  assert.ok(
    orbit.some(
      (p) => p.rear && Math.hypot(p.x - 104, p.y - 88) + p.radius < 56,
    ),
    "dot must fully disappear behind the globe",
  );
  assert.ok(
    orbit.some(
      (p) => p.rear && Math.hypot(p.x - 104, p.y - 88) - p.radius > 56,
    ),
    "rear arc must emerge outside the globe",
  );
  assert.ok(
    orbit.some((p) => !p.rear && p.x < 104) &&
      orbit.some((p) => !p.rear && p.x > 104),
    "dot must cross the front in both directions",
  );
  const turns = orbit.slice(1).map((point, i) => {
    const a = Math.atan2(orbit[i].y - 88, orbit[i].x - 104);
    const b = Math.atan2(point.y - 88, point.x - 104);
    return Math.atan2(Math.sin(b - a), Math.cos(b - a));
  });
  assert.ok(
    turns.some((turn) => turn > 0.05) && turns.some((turn) => turn < -0.05),
    "orbit must reverse smoothly",
  );
  checks.push(
    "SVG rotation, rear occlusion, re-emergence and front passage verified over 18 seconds",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".ws-loading--paused").waitFor();
  const still = await page.locator("[data-land]").getAttribute("d");
  await page.clock.runFor(1600);
  assert.ok(
    (await page.locator("[data-land]").getAttribute("d")) === still,
    "reduced-motion globe must stay still",
  );
  assert.deepEqual(
    await page
      .locator(".ws-loading__dots span")
      .evaluateAll((nodes) =>
        nodes.map((node) => getComputedStyle(node).opacity),
      ),
    ["1", "1", "1"],
  );
  checks.push("reduced motion: static globe and readable dots");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(".ws-loading:not(.ws-loading--paused)").waitFor();
  await page.evaluate(() => {
    document.querySelector(".ws-loading-page").style.marginTop = "2000px";
  });
  await page.locator(".ws-loading--paused").waitFor();
  const offscreen = await page.locator("[data-land]").getAttribute("d");
  await page.clock.runFor(1600);
  assert.ok(
    (await page.locator("[data-land]").getAttribute("d")) === offscreen,
    "offscreen globe must pause",
  );
  await page.evaluate(() => window.unmountLoading());
  await page.clock.runFor(800);
  assert.equal(await page.locator(".ws-loading").count(), 0);
  assert.deepEqual(errors, []);
  checks.push("offscreen pause and unmount cleanup; no browser errors");
  await fs.writeFile(
    path.join(evidence, "loading-checks.json"),
    JSON.stringify({ checks, orbit }, null, 2),
  );
  console.log(checks.join("\n"));
  console.log(`Evidence: ${evidence}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
