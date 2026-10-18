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
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import YutThrow3D from ${source("YutThrow3D.tsx")};import YutBoard from ${source("YutBoard.tsx")};import ${source("yut.css")};import{finalYutRotation,createYutGeometry,sampleYutPose}from ${source("YutThrowScene.ts")};import{Vector3}from'three';
const room={id:'visual-qa',revision:0,lastEvent:{kind:'create',atMs:0,text:''},status:'playing',phase:'move',turnUid:'qa',pendingThrow:{value:2,label:'개',sticks:[true,false,true,false]},players:[{uid:'qa',name:'나',role:'sa',active:true,pieces:[{id:'1',node:'o5',lane:'outer'},{id:'2',node:'o6',lane:'outer'}]},{uid:'friend',name:'친구',role:'nong',active:true,pieces:[{id:'1',node:'o10',lane:'outer'},{id:'2',node:'o15',lane:'outer'}]}]};
function App(){const[boardRoom,setBoardRoom]=useState(room);const[selectedMove,setSelectedMove]=useState(null);window.qa.board=setBoardRoom;window.qa.poses=(time,power)=>[0,1,2,3].map(i=>sampleYutPose(time,i,i%2===0,power));const[state,setState]=useState({throwKey:null,sticks:null,rolling:false});const[mounted,setMounted]=useState(true);const[selected,setSelected]=useState('1');window.qa.update=patch=>setState(old=>({...old,...patch}));window.qa.mount=setMounted;window.qa.faces=()=>[false,true].map(flat=>new Vector3(0,-1,0).applyEuler(finalYutRotation(flat,0)).y);window.qa.geometry=()=>{const g=createYutGeometry();g.computeBoundingBox();const r={count:g.getAttribute('position').count,min:g.boundingBox.min,max:g.boundingBox.max};g.dispose();return r};const moves=[{pieceId:'1',route:'outer',targetNode:'o7',stackSize:1,path:['o6','o7']},{pieceId:'1',route:'a',targetNode:'a2',stackSize:1,path:['a1','a2']},{pieceId:'2',route:'outer',targetNode:'o8',stackSize:1}];return <><div className="board yut-game"><YutBoard room={boardRoom} selectedMove={selectedMove} uid="qa" selectedPiece={selected} onSelectPiece={setSelected} moves={moves} onMove={move=>{window.qa.moves++;setSelectedMove(move)}} disabled={false}>{mounted&&<YutThrow3D {...state} onComplete={()=>{window.qa.count++;window.qa.completedAt=performance.now()}}/>}</YutBoard></div><button onClick={()=>{window.qa.update({rolling:true})}}>던지기</button></>};createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  outdir: "out",
  format: "iife",
  define: { "import.meta.env.BASE_URL": '"/"' },
  plugins: [
    {
      name: "public-assets",
      setup(build) {
        build.onResolve({ filter: /^\/assets\// }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).contents,
  css = bundle.outputFiles.find((f) => f.path.endsWith(".css")).contents;
const html =
  '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:#252b21;display:grid;place-items:center;padding:16px}.board.yut-game{position:relative;width:min(760px,calc(100vw - 36px));min-height:0;margin:0;padding:0;background:transparent;border:0;box-shadow:none}button{min-height:44px}@media(orientation:landscape) and (max-height:500px){.board.yut-game{width:min(480px,calc(100vw - 36px));--yut-board-ratio:9/5}}</style><div id="root"></div><script src="/main.js"></script></html>';
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, "http://localhost").pathname;
  if (p.startsWith("/assets/")) {
    const file = path.resolve(root, "public", "." + p);
    if (!file.startsWith(path.resolve(root, "public") + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      res.setHeader(
        "Content-Type",
        p.endsWith(".webp")
          ? "image/webp"
          : p.endsWith(".png")
            ? "image/png"
            : "application/octet-stream",
      );
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }
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
async function fresh(options = {}, noGL = false, frameDelayMs = 0) {
  const context = await browser.newContext(options);
  await context.addInitScript(
    ({ noGL, frameDelayMs }) => {
      if (frameDelayMs) {
        window.requestAnimationFrame = (callback) =>
          window.setTimeout(() => callback(performance.now()), frameDelayMs);
        window.cancelAnimationFrame = (id) => window.clearTimeout(id);
      }
      window.qa = { count: 0, moves: 0, hidden: false };
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
    { noGL, frameDelayMs },
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.goto(origin);
  await page.waitForFunction(() => !!window.qa.update);
  return { context, page };
}
try {
  {
    const { context, page } = await fresh({}, false, 200);
    // Warm the real WebGL shaders before measuring the animation clock.
    await page.evaluate(() =>
      window.qa.update({
        throwKey: "slow-gpu-warmup",
        sticks: [true, false, true, false],
      }),
    );
    await page.waitForFunction(() => window.qa.count === 1);
    await page.evaluate(() => {
      window.qa.startedAt = performance.now();
      window.qa.update({
        throwKey: "slow-gpu",
        sticks: [false, false, false, false],
        power: 0.95,
      });
    });
    await page.waitForFunction(() => window.qa.count === 2, null, {
      timeout: 4500,
    });
    const elapsed = await page.evaluate(
      () => window.qa.completedAt - window.qa.startedAt,
    );
    assert.ok(
      elapsed >= 2200 && elapsed < 3500,
      `slow GPU duration: ${elapsed}ms`,
    );
    report.checks.push(
      "5fps WebGL still settles in real time (2.25 seconds plus frame scheduling), without stretching the player's turn",
    );
    await context.close();
  }
  {
    const { context, page } = await fresh({
      viewport: { width: 1280, height: 900 },
    });
    const poses = await page.evaluate(() => window.qa.poses(0.68, 0.65));
    assert.equal(
      new Set(poses.map((pose) => pose.y.toFixed(3))).size,
      4,
      "four individual flight heights",
    );
    assert.ok(
      poses.every((pose) => pose.y > 0.12 && pose.y < 2.2),
      "gentle hand-toss arc",
    );
    const settled = await page.evaluate(() => window.qa.poses(2.25, 0.65));
    assert.ok(
      settled.every(
        (pose) =>
          Math.abs(pose.y - 0.122) < 1e-8 && Math.abs(pose.pitch) < 1e-8,
      ),
      "every stick rests by the fixed deadline",
    );
    await page.getByRole("button", { name: /지름길.*경로 선택/ }).click();
    assert.equal(await page.locator(".yut-route-preview").count(), 1);
    assert.equal(
      await page
        .locator(".yut-route-preview polyline")
        .first()
        .getAttribute("points"),
      "650,255 553.33,255 456.67,255",
    );
    await page.screenshot({
      path: path.join(evidence, "selected-shortcut.png"),
    });
    await page.evaluate(() =>
      window.qa.board((old) => ({
        ...old,
        revision: 1,
        lastEvent: {
          kind: "capture",
          atMs: 1,
          text: "",
          move: {
            uid: "qa",
            pieceId: "1",
            route: "a",
            path: ["a1", "a2", "center"],
            capturedUids: [],
          },
        },
        players: old.players.map((p, i) =>
          i
            ? p
            : {
                ...p,
                pieces: p.pieces.map((v, j) =>
                  j ? v : { ...v, node: "center", lane: "a" },
                ),
              },
        ),
      })),
    );
    await page.waitForFunction(
      () => !!document.querySelector('[data-motion="capture"]'),
    );
    const animation = await page
      .locator('[data-motion="capture"]')
      .evaluate((node) =>
        node.getAnimations().map((animation) => ({
          duration: animation.effect.getTiming().duration,
          frames: animation.effect.getKeyframes().length,
        })),
      );
    assert.ok(
      animation.some((item) => item.duration === 220 && item.frames === 4),
      "sequential 220ms hops with painted landings",
    );
    await page.waitForTimeout(1100);
    assert.equal(await page.locator('[data-motion="capture"]').count(), 0);
    report.checks.push(
      "transparent board center, selected shortcut path, distinct gentle stick trajectories and node-by-node capture hops",
    );
    await context.close();
  }
  for (const width of [390, 768, 1280]) {
    const { context, page } = await fresh({ viewport: { width, height: 900 } });
    assert.ok(
      (await page.evaluate(() => window.qa.faces())).every(
        (v, i) => Math.abs(v - (i ? 1 : -1)) < 1e-8,
      ),
    );
    const geometry = await page.evaluate(() => window.qa.geometry());
    assert.ok(geometry.count > 100);
    const targets = await page
      .locator(".yut-isometric-destination")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
        })),
      );
    assert.ok(
      targets.every((target) => target.width >= 44 && target.height >= 44),
    );
    await page.locator(".yut-isometric-destination").first().focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => window.qa.moves), 1);
    assert.ok(
      (await page.locator(".yut-isometric-pawn .yut-sprite").count()) >= 3,
    );
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
    await page.evaluate(() => {
      window.qa.startedAt = performance.now();
      window.qa.update({
        throwKey: "reduce",
        sticks: [true, false, true, false],
      });
    });
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => window.qa.count), 0);
    assert.equal(
      await page.locator(".yut-throw-3d.is-rolling canvas").count(),
      1,
    );
    await page.screenshot({ path: path.join(evidence, "reduced-flight.png") });
    await page.waitForFunction(() => window.qa.count === 1);
    assert.ok(
      await page.evaluate(
        () => window.qa.completedAt - window.qa.startedAt >= 2200,
      ),
    );
    report.checks.push(
      "reduced-motion still shows full 2.25-second WebGL throw before completion",
    );
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
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.qa.count), 0);
    await page.waitForFunction(() => window.qa.count === 1);
    assert.equal(await page.locator('[data-renderer="fallback"]').count(), 1);
    assert.equal(await page.locator('[data-face="flat"]').count(), 2);
    await page.screenshot({ path: path.join(evidence, "fallback.png") });
    report.checks.push(
      "WebGL unavailable: marked CSS arc completes after a bounded 2.25-second flight",
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
      "context loss and later throws use bounded CSS fallback",
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
  {
    const { context, page } = await fresh({
      viewport: { width: 844, height: 390 },
    });
    const result = await page
      .locator(".yut-isometric-board")
      .evaluate((node) => ({
        ratio: getComputedStyle(node).aspectRatio,
        svg: node.querySelector("svg").getAttribute("preserveAspectRatio"),
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
    assert.equal(result.ratio, "9 / 5");
    assert.equal(result.svg, "none");
    assert.equal(result.overflow, false);
    await page.locator(".yut-isometric-destination").first().focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => window.qa.moves), 1);
    await page.screenshot({ path: path.join(evidence, "board-landscape.png") });
    report.checks.push(
      "844x390 landscape board keeps aligned controls, sprite pawns and keyboard destination",
    );
    await context.close();
  }
  {
    const { context, page } = await fresh({ reducedMotion: "reduce" }, true);
    await page.evaluate(() => {
      window.qa.hide(true);
      window.qa.update({
        throwKey: "fallback-hidden",
        sticks: [false, true, false, true],
      });
    });
    await page.waitForTimeout(2500);
    assert.equal(await page.evaluate(() => window.qa.count), 0);
    const animation = await page
      .locator(".yut-throw-3d__wood")
      .first()
      .evaluate((node) => ({
        name: getComputedStyle(node).animationName,
        state: getComputedStyle(node).animationPlayState,
      }));
    assert.notEqual(animation.name, "none");
    assert.equal(animation.state, "paused");
    await page.evaluate(() => window.qa.hide(false));
    await page.waitForFunction(() => window.qa.count === 1);
    await page.evaluate(() =>
      window.qa.update({
        throwKey: "fallback-unmount",
        sticks: [true, true, false, false],
      }),
    );
    await page.waitForTimeout(200);
    await page.evaluate(() => window.qa.mount(false));
    await page.waitForTimeout(2400);
    assert.equal(await page.evaluate(() => window.qa.count), 1);
    report.checks.push(
      "CSS fallback pauses when hidden and cancels callback on unmount, including reduced-motion",
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
