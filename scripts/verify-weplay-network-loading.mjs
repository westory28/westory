/** Real naval game/frame/dialog with delayed preview transport, no production traffic. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url),
  { build } = require("esbuild");
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
const core = require(path.join(root, "functions/weplayCore.js"));
const catalog = ["이순신", "거북선", "판옥선"].map((text) => ({
  text,
  unitId: "qa",
  lessonTitle: "수군",
  context: "검증",
}));
const words = core.buildWords(
  catalog,
  "loading",
  "mild",
  core.DEFAULT_GAME_SETTINGS.difficulties.mild,
);
const output = path.join(root, "output/weplay-network-loading-20261018");
await fs.mkdir(output, { recursive: true });
const modulePath = (p) =>
  JSON.stringify(path.join(root, p).replaceAll("\\", "/"));
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Game from ${modulePath("src/components/common/weplay/NavalBattleGame.tsx")};
import Frame from ${modulePath("src/components/common/weplay/WeplayGameFrame.tsx")};
import {createWeplayPreviewTransport} from ${modulePath("src/lib/weplayPreview.ts")};
import ${modulePath("src/assets/index.css")};
const session={id:'qa-loading',mode:'practice',difficulty:'mild',difficultySettings:${JSON.stringify(core.DEFAULT_GAME_SETTINGS.difficulties.mild)},battleVersion:1,acceptedEvents:[],status:'active',startsAtMs:Date.now()-200,endsAtMs:Date.now()+89800,serverNowMs:Date.now(),words:${JSON.stringify(words)},acceptedWordIds:[],correctCount:0,policy:${JSON.stringify(core.DEFAULT_POLICY)},result:null};
const qa=window.loadingQA={answers:[],finishes:[],completions:[],outside:0,help:0,holdAnswer:false,holdFinish:false,failAnswer:false,failFinish:false,session};
const real=createWeplayPreviewTransport(session);
const transport={answer:async data=>{qa.answers.push(structuredClone(data));const result=await real.answer(data);if(qa.holdAnswer){qa.holdAnswer=false;await new Promise(resolve=>qa.releaseAnswer=resolve);}if(qa.failAnswer){qa.failAnswer=false;throw new Error('답변 확인 실패');}return result;},finish:async options=>{qa.finishes.push(structuredClone(options||{}));if(qa.holdFinish){qa.holdFinish=false;await new Promise(resolve=>qa.releaseFinish=resolve);}if(qa.failFinish){qa.failFinish=false;throw new Error('정산 확인 실패');}return real.finish(options);}};
function App(){const[result,setResult]=useState(null);return <main className='weplay-game-page'><button id='outside' onClick={()=>qa.outside++}>게임 밖 메뉴</button><Frame>{result?<output>종료 완료</output>:<Game session={session} config={{year:'2026',semester:'2'}} transport={transport} onShowGuide={()=>qa.help++} onComplete={value=>{qa.completions.push(value);setResult(value);}}/>}</Frame></main>;}
createRoot(document.getElementById('root')).render(<App/>);
`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "naval-network-qa.js"),
  external: ["/assets/*"],
  loader: { ".svg": "dataurl" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "no-network",
      setup(plugin) {
        plugin.onResolve({ filter: /historyDictionarySession$/ }, () => ({
          path: "service",
          namespace: "fixture",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            'export const getHistoryDictionaryCallable=async()=>{throw new Error("Unexpected production call");};',
          loader: "js",
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+[^;]+;/g, "");
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/qa.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(js);
  }
  if (pathname === "/qa.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(css);
  }
  if (pathname.startsWith("/assets/")) {
    try {
      const file = path.resolve(root, "public", "." + pathname);
      if (!file.startsWith(path.join(root, "public") + path.sep))
        throw new Error("path");
      res.setHeader(
        "Content-Type",
        pathname.endsWith(".webp") ? "image/webp" : "application/octet-stream",
      );
      return res.end(await fs.readFile(file));
    } catch {
      res.statusCode = 404;
      return res.end();
    }
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>*,::before,::after{box-sizing:border-box}body{margin:0}#outside{min-height:44px}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  errors = [];
const open = async (width = 1280) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === base
      ? route.continue()
      : route.abort(),
  );
  await page.clock.install({ time: new Date("2026-10-18T02:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-18T02:00:01Z"));
  await page.goto(base);
  await page.locator(".naval-word > strong").first().waitFor();
  return page;
};
const answer = async (page) => {
  const text = await page.locator(".naval-word > strong").first().textContent();
  await page.locator("#naval-answer-input").fill(text);
  await page.locator("#naval-answer-input").press("Enter");
};
const overlay = (page) => page.locator(".weplay-game-loading");
try {
  for (const width of [390, 768, 1280, 1366]) {
    const page = await open(width);
    await page.evaluate(() => {
      window.loadingQA.holdAnswer = true;
    });
    await answer(page);
    await overlay(page).waitFor();
    assert.equal(
      await page.locator(".naval-scene").evaluate((el) => el.inert),
      true,
    );
    assert.equal(await page.locator("#naval-answer-input").isDisabled(), true);
    assert.equal(
      await page
        .locator(".weplay-game-loading__plaque")
        .evaluate((el) => document.activeElement === el),
      true,
    );
    const time = await page
      .locator(".naval-hud-time")
      .getAttribute("aria-label");
    await page.clock.runFor(1200);
    assert.notEqual(
      await page.locator(".naval-hud-time").getAttribute("aria-label"),
      time,
    );
    await page.locator(".naval-command").dispatchEvent("submit");
    await page.locator(".weplay-exit-button").first().dispatchEvent("click");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.loadingQA.answers.length), 1);
    assert.equal(await page.locator(".weplay-exit-dialog[open]").count(), 0);
    await page.locator("#outside").click();
    assert.equal(
      await page.evaluate(() => window.loadingQA.outside),
      1,
      "Loading stays inside game",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    const bounds = await overlay(page).evaluate((el) => {
      const overlay = el.getBoundingClientRect(),
        stage = el.closest(".naval-game").getBoundingClientRect();
      return (
        Math.abs(overlay.left - stage.left) < 1 &&
        Math.abs(overlay.right - stage.right) < 1 &&
        Math.abs(overlay.top - stage.top) < 1 &&
        Math.abs(overlay.bottom - stage.bottom) < 1
      );
    });
    assert.equal(bounds, true);
    await page.screenshot({
      path: path.join(output, `naval-answer-loading-${width}.png`),
      fullPage: true,
    });
    await page.evaluate(() => window.loadingQA.releaseAnswer());
    await overlay(page).waitFor({ state: "hidden" });
    assert.equal(await page.locator("#naval-answer-input").isDisabled(), false);
    assert.equal(
      await page
        .locator("#naval-answer-input")
        .evaluate((el) => document.activeElement === el),
      true,
      "Answer response returns keyboard focus to typing",
    );
    assert.equal(
      await page.locator(".naval-scene").evaluate((el) => el.inert),
      false,
    );
    await page.close();
  }
  checks.push(
    "390/768/1280/1366px: themed loading covers only the real game/frame, locks click/form/keyboard input and exit, leaves outside controls usable, and preserves the running battle clock.",
  );
  const compact = await open(390);
  await compact.setViewportSize({ width: 390, height: 360 });
  await compact.clock.runFor(250);
  await compact.evaluate(() => {
    window.loadingQA.holdAnswer = true;
  });
  await answer(compact);
  await overlay(compact).waitFor();
  const compactBounds = await compact.evaluate(() => {
    const scene = document
      .querySelector(".naval-scene")
      .getBoundingClientRect();
    const loading = document
      .querySelector(".weplay-game-loading")
      .getBoundingClientRect();
    const plaque = document
      .querySelector(".weplay-game-loading__plaque")
      .getBoundingClientRect();
    return {
      sceneTop: scene.top,
      sceneBottom: scene.bottom,
      sceneHeight: scene.height,
      loadingTop: loading.top,
      loadingBottom: loading.bottom,
      plaqueTop: plaque.top,
      plaqueBottom: plaque.bottom,
      viewport: visualViewport.height,
    };
  });
  assert.ok(
    compactBounds.sceneHeight >= 340 &&
      compactBounds.plaqueTop >= 0 &&
      compactBounds.plaqueBottom <= compactBounds.viewport,
    JSON.stringify(compactBounds),
  );
  assert.ok(
    Math.abs(compactBounds.loadingTop - compactBounds.sceneTop) < 1 &&
      Math.abs(compactBounds.loadingBottom - compactBounds.sceneBottom) < 1,
    JSON.stringify(compactBounds),
  );
  await compact.screenshot({
    path: path.join(output, "naval-loading-keyboard-390x360.png"),
    fullPage: false,
  });
  await compact.evaluate(() => window.loadingQA.releaseAnswer());
  await overlay(compact).waitFor({ state: "hidden" });
  await compact.setViewportSize({ width: 390, height: 900 });
  await compact.clock.runFor(100);
  assert.equal(
    await compact
      .locator(".weplay-game-frame")
      .evaluate((el) => el.getBoundingClientRect().height),
    560,
  );
  await compact.close();
  checks.push(
    "Keyboard-reduced 390x360 viewport keeps the measured compact scene and loading plaque visible; closing the keyboard restores the normal 560px game frame.",
  );
  const failed = await open();
  await failed.evaluate(() => {
    window.loadingQA.failAnswer = true;
  });
  await answer(failed);
  await failed
    .getByRole("button", { name: "입력 다시 전송", exact: true })
    .waitFor();
  assert.equal(await overlay(failed).count(), 0);
  assert.equal(await failed.locator("#naval-answer-input").isDisabled(), false);
  await failed
    .getByRole("button", { name: "입력 다시 전송", exact: true })
    .click();
  await failed.waitForFunction(() => window.loadingQA.answers.length === 2);
  assert.equal(
    await failed.evaluate(
      () =>
        window.loadingQA.answers[0].eventId ===
        window.loadingQA.answers[1].eventId,
    ),
    true,
  );
  await failed.close();
  const timeout = await open();
  await timeout.evaluate(() => {
    window.loadingQA.holdAnswer = true;
  });
  await answer(timeout);
  await overlay(timeout).waitFor();
  await timeout.clock.runFor(15010);
  await timeout
    .getByRole("button", { name: "입력 다시 전송", exact: true })
    .waitFor();
  assert.equal(await overlay(timeout).count(), 0);
  await timeout.evaluate(() => window.loadingQA.releaseAnswer());
  assert.equal(
    await timeout
      .getByRole("button", { name: "입력 다시 전송", exact: true })
      .count(),
    1,
    "Late response cannot silently clear retry",
  );
  await timeout
    .getByRole("button", { name: "입력 다시 전송", exact: true })
    .click();
  await timeout.waitForFunction(() => window.loadingQA.answers.length === 2);
  assert.equal(
    await timeout.evaluate(
      () =>
        window.loadingQA.answers[0].eventId ===
        window.loadingQA.answers[1].eventId,
    ),
    true,
  );
  await timeout.close();
  checks.push(
    "Failed and 15-second stalled answers unlock UI; late acknowledgements are ignored; retry retains the same idempotent event ID.",
  );
  const finish = await open(768);
  await finish.evaluate(() => {
    window.loadingQA.holdFinish = true;
  });
  await finish.getByRole("button", { name: "나가기", exact: true }).click();
  await finish
    .getByRole("button", { name: "현재 기록으로 종료", exact: true })
    .click();
  await finish.clock.runFor(50);
  await overlay(finish).waitFor();
  assert.equal(await finish.locator(".weplay-exit-dialog[open]").count(), 0);
  await finish.keyboard.press("Escape");
  await finish.locator(".weplay-exit-confirm").dispatchEvent("click");
  assert.equal(
    await finish.evaluate(() => window.loadingQA.finishes.length),
    1,
  );
  await finish.screenshot({
    path: path.join(output, "naval-settlement-loading-768.png"),
    fullPage: true,
  });
  await finish.clock.runFor(15010);
  await finish
    .getByRole("button", { name: "종료 다시 시도", exact: true })
    .waitFor();
  assert.equal(await overlay(finish).count(), 0);
  await finish.evaluate(() => window.loadingQA.releaseFinish());
  assert.equal(
    await finish.evaluate(() => window.loadingQA.completions.length),
    0,
  );
  await finish
    .getByRole("button", { name: "종료 다시 시도", exact: true })
    .click();
  await finish.getByText("종료 완료", { exact: true }).waitFor();
  assert.equal(
    await finish.evaluate(() => window.loadingQA.completions.length),
    1,
  );
  assert.equal(
    await finish.evaluate(() =>
      window.loadingQA.finishes.every((options) => options.exitEarly === true),
    ),
    true,
  );
  await finish.close();
  checks.push(
    "Settlement hides the native top-layer exit dialog behind themed loading; duplicate confirmation/Escape cannot act; timeout reopens focused retry and late result cannot complete twice.",
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
