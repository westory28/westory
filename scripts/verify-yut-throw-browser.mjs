import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  evidence = path.join(root, "output/weplay-3d-qa");
await fs.mkdir(evidence, { recursive: true });
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
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
const { chromium } = playwright;
const source = (f) =>
  JSON.stringify(
    path
      .join(root, "src/components/common/weplay/yut", f)
      .replaceAll("\\", "/"),
  );
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import YutThrow3D from ${source("YutThrow3D.tsx")};import{finalYutRotation,createYutGeometry}from ${source("YutThrowScene.ts")};import{Vector3}from'three';function App(){const[state,setState]=useState({throwKey:null,sticks:null,rolling:false});const[mounted,setMounted]=useState(true);window.qa.update=patch=>setState(old=>({...old,...patch}));window.qa.mount=setMounted;window.qa.faces=()=>[false,true].map(flat=>new Vector3(0,-1,0).applyEuler(finalYutRotation(flat,0)).y);window.qa.geometry=()=>{const g=createYutGeometry();g.computeBoundingBox();const r={count:g.getAttribute('position').count,min:g.boundingBox.min,max:g.boundingBox.max};g.dispose();return r};return <><div className="board">${'<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M12 12H88V88H12ZM12 12L88 88M88 12L12 88" fill="none" stroke="#886e4b" stroke-width=".7"/></svg>'}{mounted&&<YutThrow3D {...state} onComplete={()=>{window.qa.count++;window.qa.completedAt=performance.now()}}/>}</div><button onClick={()=>{window.qa.update({rolling:true})}}>던지기</button></>};createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  outdir: "out",
  format: "iife",
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).contents,
  css = bundle.outputFiles.find((f) => f.path.endsWith(".css")).contents;
const html =
  '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:#0e242b;display:grid;place-items:center;padding:16px}.board{position:relative;width:min(650px,calc(100vw - 36px));aspect-ratio:1;background:#d9c59c;border:2px solid #b59054;border-radius:20px;box-shadow:inset 0 0 50px #8a6d3e55}.board>svg{position:absolute;inset:0;width:100%;height:100%;opacity:.5}button{min-height:44px}</style><div id="root"></div><script src="/main.js"></script></html>';
const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://localhost").pathname;
  res.setHeader(
    "Content-Type",
    p === "/main.js"
      ? "text/javascript"
      : p === "/style.css"
        ? "text/css"
        : "text/html",
  );
  res.end(p === "/main.js" ? js : p === "/style.css" ? css : html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const report = { checks: [], errors: [] };
async function fresh(options = {}, noGL = false) {
  const context = await browser.newContext(options);
  await context.addInitScript(
    ({ noGL }) => {
      window.qa = { count: 0, hidden: false };
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => window.qa.hidden,
      });
      window.qa.hide = (value) => {
        window.qa.hidden = value;
        document.dispatchEvent(new Event("visibilitychange"));
      };
      if (noGL) {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
          if (
            kind === "webgl" ||
            kind === "webgl2" ||
            kind === "experimental-webgl"
          )
            return null;
          return get.call(this, kind, ...rest);
        };
      }
    },
    { noGL },
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.goto(origin);
  await page.waitForFunction(() => !!window.qa.update);
  return { context, page };
}
try {
  for (const width of [390, 768, 1280]) {
    const { context, page } = await fresh({ viewport: { width, height: 900 } });
    assert.ok(
      (await page.evaluate(() => window.qa.faces())).every(
        (v, i) => Math.abs(v - (i ? 1 : -1)) < 1e-8,
      ),
    );
    const geometry = await page.evaluate(() => window.qa.geometry());
    assert.ok(geometry.count > 100);
    await page.getByRole("button", { name: "던지기" }).click();
    await page.evaluate(() =>
      window.qa.update({
        throwKey: "one",
        sticks: [true, false, true, false],
        rolling: false,
      }),
    );
    await page.waitForTimeout(700);
    assert.equal(
      await page.locator('[data-renderer="webgl"] canvas').count(),
      1,
    );
    await page.screenshot({
      path: path.join(evidence, `throw-${width}-flight.png`),
    });
    await page.waitForFunction(() => window.qa.count === 1);
    await page.screenshot({
      path: path.join(evidence, `throw-${width}-settled.png`),
    });
    const result = await page.evaluate(() => ({
      count: window.qa.count,
      overflow: document.documentElement.scrollWidth > innerWidth,
      pointer: getComputedStyle(document.querySelector(".yut-throw-3d"))
        .pointerEvents,
    }));
    assert.equal(result.overflow, false);
    assert.equal(result.pointer, "none");
    await page.evaluate(() =>
      window.qa.update({ sticks: [true, false, true, false] }),
    );
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.qa.count), 1);
    report.checks.push(
      `${width}px real WebGL flight/settle, half-cylinder geometry, correct final face normals, same-key no replay`,
    );
    await context.close();
  }
  {
    const { context, page } = await fresh();
    await page.evaluate(() =>
      window.qa.update({
        throwKey: "first",
        sticks: [true, true, true, true],
        rolling: false,
      }),
    );
    await page.waitForFunction(() => window.qa.count === 1);
    await page.evaluate(() => window.qa.update({ rolling: true }));
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => window.qa.count), 1);
    await page.evaluate(() =>
      window.qa.update({
        throwKey: "second",
        sticks: [false, false, false, false],
        rolling: false,
      }),
    );
    await page.waitForFunction(() => window.qa.count === 2);
    await page.evaluate(() => window.qa.update({ rolling: true }));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.qa.update({ rolling: false }));
    await page.waitForFunction(() => window.qa.count === 3);
    report.checks.push(
      "next throw does not reuse previous faces; rejected command releases visual wait",
    );
    await context.close();
  }
  {
    const { context, page } = await fresh();
    await page.evaluate(() => {
      window.qa.hide(true);
      window.qa.update({
        throwKey: "hidden",
        sticks: [false, true, false, true],
      });
    });
    await page.waitForTimeout(2500);
    assert.equal(await page.evaluate(() => window.qa.count), 0);
    await page.evaluate(() => window.qa.hide(false));
    await page.waitForFunction(() => window.qa.count === 1);
    report.checks.push("hidden tab suspends render and animation clock");
    await context.close();
  }
  {
    const { context, page } = await fresh({ reducedMotion: "reduce" });
    await page.evaluate(() =>
      window.qa.update({
        throwKey: "reduce",
        sticks: [true, false, true, false],
      }),
    );
    await page.waitForFunction(() => window.qa.count === 1);
    await page.screenshot({ path: path.join(evidence, "reduced.png") });
    report.checks.push("reduced motion settles immediately");
    await context.close();
  }
  {
    const { context, page } = await fresh({}, true);
    await page.evaluate(() =>
      window.qa.update({
        throwKey: "fallback",
        sticks: [true, false, true, false],
      }),
    );
    await page.waitForFunction(() => window.qa.count === 1);
    assert.equal(await page.locator('[data-renderer="fallback"]').count(), 1);
    assert.equal(await page.locator('[data-face="flat"]').count(), 2);
    await page.screenshot({ path: path.join(evidence, "fallback.png") });
    report.checks.push(
      "WebGL unavailable: marked static fallback and completion",
    );
    await context.close();
  }
  {
    const { context, page } = await fresh();
    await page.evaluate(() =>
      window.qa.update({
        throwKey: "lost",
        sticks: [true, false, true, false],
      }),
    );
    await page.waitForTimeout(250);
    await page.evaluate(() =>
      document
        .querySelector("canvas")
        .getContext("webgl2")
        .getExtension("WEBGL_lose_context")
        .loseContext(),
    );
    await page.waitForFunction(() => window.qa.count === 1);
    assert.equal(await page.locator('[data-renderer="fallback"]').count(), 1);
    await page.evaluate(() =>
      window.qa.update({
        throwKey: "afterlost",
        sticks: [false, false, true, false],
      }),
    );
    await page.waitForFunction(() => window.qa.count === 2);
    report.checks.push(
      "context loss releases result and later throws use static fallback",
    );
    await context.close();
  }
  {
    const { context, page } = await fresh();
    await page.evaluate(() =>
      window.qa.update({
        throwKey: "unmount",
        sticks: [true, false, true, false],
      }),
    );
    await page.waitForTimeout(300);
    await page.evaluate(() => window.qa.mount(false));
    assert.equal(await page.locator("canvas").count(), 0);
    await page.waitForTimeout(2400);
    assert.equal(await page.evaluate(() => window.qa.count), 0);
    report.checks.push(
      "unmount removes canvas and cancels animation callbacks",
    );
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
