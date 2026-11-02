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
const output = path.resolve(
  process.env.WEPLAY_QA_EVIDENCE_DIR ||
    path.join(root, "output/weplay-stability-20261102"),
);
await fs.mkdir(output, { recursive: true });
const modulePath = (p) =>
  JSON.stringify(path.join(root, p).replaceAll("\\", "/"));
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Game from ${modulePath("src/components/common/weplay/NavalBattleGame.tsx")};
import Frame from ${modulePath("src/components/common/weplay/WeplayGameFrame.tsx")};
import {createWeplayPreviewTransport} from ${modulePath("src/lib/weplayPreview.ts")};
import ${modulePath("src/assets/index.css")};
import ${modulePath("src/components/common/weplay/weplay.css")};
const session={id:'qa-loading',mode:'practice',difficulty:'mild',difficultySettings:${JSON.stringify(core.DEFAULT_GAME_SETTINGS.difficulties.mild)},battleVersion:1,acceptedEvents:[],status:'active',startsAtMs:Date.now()-200,endsAtMs:Date.now()+89800,serverNowMs:Date.now(),words:${JSON.stringify(words)},acceptedWordIds:[],correctCount:0,policy:${JSON.stringify(core.DEFAULT_POLICY)},result:null};
const qa=window.loadingQA={answers:[],finishes:[],completions:[],outside:0,help:0,holdAnswer:false,holdFinish:false,failAnswer:false,failFinish:false,session};
const real=createWeplayPreviewTransport(session);
const transport={answer:async data=>{qa.answers.push(structuredClone(data));const result=await real.answer(data);if(qa.holdAnswer){qa.holdAnswer=false;await new Promise(resolve=>qa.releaseAnswer=resolve);}if(qa.failAnswer){qa.failAnswer=false;throw new Error('답변 확인 실패');}return result;},finish:async options=>{qa.finishes.push(structuredClone(options||{}));if(qa.holdFinish){qa.holdFinish=false;await new Promise(resolve=>qa.releaseFinish=resolve);}if(qa.failFinish){qa.failFinish=false;throw new Error('정산 확인 실패');}return real.finish(options);}};
function App(){const[result,setResult]=useState(null);return <main className='weplay-page weplay-game-page'><button id='outside' onClick={()=>qa.outside++}>게임 밖 메뉴</button><Frame>{result?<output>종료 완료</output>:<Game session={session} config={{year:'2026',semester:'2'}} transport={transport} onShowGuide={()=>qa.help++} onComplete={value=>{qa.completions.push(value);setResult(value);}}/>}</Frame></main>;}
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
const open = async (
  width = 1280,
  { visualOnly = false, noVisualViewport = false } = {},
) => {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    hasTouch: width < 768,
  });
  if (visualOnly)
    await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), {
        height: innerHeight,
        width: innerWidth,
        offsetTop: 0,
        offsetLeft: 0,
        scale: 1,
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: viewport,
      });
      window.setVisualViewport = (values) => {
        Object.assign(viewport, values);
        viewport.dispatchEvent(new Event("resize"));
      };
    });
  if (noVisualViewport)
    await page.addInitScript(() => {
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: undefined,
      });
    });
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
    await page.waitForFunction(() => window.loadingQA.answers.length === 1);
    assert.equal(
      await overlay(page).count(),
      0,
      "Answer progress must not steal keyboard focus",
    );
    assert.equal(
      await page.locator(".naval-scene").evaluate((el) => el.inert),
      false,
    );
    assert.equal(await page.locator("#naval-answer-input").isDisabled(), false);
    assert.equal(
      await page
        .locator("#naval-answer-input")
        .evaluate((el) => document.activeElement === el),
      true,
    );
    await page.locator("#naval-answer-input").fill("다음 단어 초안");
    assert.equal(
      await page
        .getByRole("button", { name: "장전", exact: true })
        .isDisabled(),
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
    await page.screenshot({
      path: path.join(output, `naval-answer-pending-${width}.png`),
      fullPage: true,
    });
    await page.evaluate(() => window.loadingQA.releaseAnswer());
    await page.waitForFunction(
      () =>
        document.querySelector(".naval-game").getAttribute("aria-busy") ===
        "false",
    );
    assert.equal(
      await page.locator("#naval-answer-input").inputValue(),
      "다음 단어 초안",
    );
    assert.equal(
      await page
        .locator("#outside")
        .evaluate((el) => document.activeElement === el),
      true,
      "A late answer response must not steal focus from the user's chosen control",
    );
    await page.close();
  }
  checks.push(
    "390/768/1280/1366px: delayed answers preserve keyboard focus and next-word draft, reject duplicate form/key/exit actions, keep the battle clock running, and never steal explicitly moved focus.",
  );
  const compact = await open(390);
  await compact.setViewportSize({ width: 390, height: 360 });
  await compact.clock.runFor(250);
  await compact.evaluate(() => {
    window.loadingQA.holdAnswer = true;
  });
  await answer(compact);
  await compact.waitForFunction(() => window.loadingQA.answers.length === 1);
  const readGeometry = () =>
    compact.evaluate(() => {
      const rect = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      };
      return {
        scene: rect(".naval-scene"),
        input: rect("#naval-answer-input"),
        prompts: rect(".naval-prompts"),
        scrollY,
        viewport: visualViewport.height,
      };
    });
  const before = await readGeometry();
  assert.ok(
    before.input.top >= 0 && before.input.bottom <= before.viewport,
    JSON.stringify(before),
  );
  assert.ok(
    before.prompts.top >= 0 && before.prompts.bottom <= before.viewport,
    JSON.stringify(before),
  );
  await compact.evaluate(() => {
    window.viewportScrollCalls = 0;
    const real = window.scrollBy.bind(window);
    window.scrollBy = (...args) => {
      window.viewportScrollCalls++;
      real(...args);
    };
    for (let i = 0; i < 20; i++)
      visualViewport.dispatchEvent(new Event("scroll"));
  });
  await compact.clock.runFor(300);
  assert.equal(
    await compact.evaluate(() => window.viewportScrollCalls),
    0,
    "Viewport scroll events cannot trigger corrective scrolling loops",
  );
  await compact.locator("#naval-answer-input").fill("한글 조합");
  await compact
    .locator("#naval-answer-input")
    .dispatchEvent("compositionstart", { data: "한" });
  await compact.locator("#naval-answer-input").press("Enter");
  assert.equal(
    await compact.evaluate(() => window.loadingQA.answers.length),
    1,
  );
  await compact
    .locator("#naval-answer-input")
    .dispatchEvent("compositionend", { data: "글" });
  await compact.evaluate(() => window.loadingQA.releaseAnswer());
  await compact.waitForFunction(
    () =>
      document.querySelector(".naval-game").getAttribute("aria-busy") ===
      "false",
  );
  const after = await readGeometry();
  assert.ok(
    Math.abs(after.input.top - before.input.top) < 1 &&
      Math.abs(after.scene.height - before.scene.height) < 1,
    JSON.stringify({ before, after }),
  );
  assert.equal(
    await compact
      .locator("#naval-answer-input")
      .evaluate((el) => document.activeElement === el),
    true,
  );
  assert.equal(
    await compact.locator("#naval-answer-input").inputValue(),
    "한글 조합",
  );
  await compact.screenshot({
    path: path.join(output, "naval-keyboard-stable-390x360.png"),
    fullPage: false,
  });
  await compact.setViewportSize({ width: 390, height: 900 });
  await compact.evaluate(() => window.dispatchEvent(new Event("resize")));
  await compact.clock.runFor(250);
  assert.equal(await compact.locator(".naval-game--compact").count(), 0);
  assert.equal(
    await compact
      .locator(".weplay-game-frame")
      .evaluate((el) => el.getBoundingClientRect().height),
    560,
  );
  await compact.close();
  checks.push(
    "390x360 keyboard viewport: prompt/input visible, answer delay and IME retain exact position, viewport scroll bursts cannot loop, keyboard closing restores 560px frame.",
  );
  const visual = await open(390, { visualOnly: true });
  for (const height of [620, 500, 420, 360]) {
    await visual.evaluate(
      (height) => window.setVisualViewport({ height }),
      height,
    );
    await visual.clock.runFor(50);
  }
  assert.equal(
    await visual.locator(".naval-game--compact").count(),
    0,
    "Do not relayout on every keyboard animation frame",
  );
  await visual.clock.runFor(200);
  assert.equal(await visual.locator(".naval-game--compact").count(), 1);
  const visualBounds = await visual
    .locator("#naval-answer-input")
    .boundingBox();
  assert.ok(visualBounds.y >= 0 && visualBounds.y + visualBounds.height <= 360);
  await visual.evaluate(() =>
    window.setVisualViewport({ height: 180, scale: 2 }),
  );
  await visual.clock.runFor(250);
  assert.deepEqual(
    await visual.locator("#naval-answer-input").boundingBox(),
    visualBounds,
    "Pinch zoom must not trigger keyboard relayout",
  );
  await visual.evaluate(() =>
    window.setVisualViewport({ height: 360, scale: 1 }),
  );
  await visual.clock.runFor(250);
  const imeText = await visual
    .locator(".naval-word > strong")
    .first()
    .textContent();
  await visual.locator("#naval-answer-input").fill(imeText);
  await visual
    .locator("#naval-answer-input")
    .dispatchEvent("compositionstart", { data: imeText });
  await visual.locator("#naval-answer-input").press("Enter");
  assert.equal(
    await visual.evaluate(() => window.loadingQA.answers.length),
    0,
    "IME confirm Enter is not an answer",
  );
  await visual
    .locator("#naval-answer-input")
    .dispatchEvent("compositionend", { data: imeText });
  await visual.locator("#naval-answer-input").press("Enter");
  await visual.waitForFunction(() => window.loadingQA.answers.length === 1);
  await visual.waitForFunction(
    () =>
      document.querySelector(".naval-game").getAttribute("aria-busy") ===
      "false",
  );
  await visual.locator("#naval-answer-input").focus();
  await visual.evaluate(() => {
    window.hiddenFixture = true;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => window.hiddenFixture,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenTime = await visual
    .locator(".naval-hud-time")
    .getAttribute("aria-label");
  await visual.clock.runFor(2000);
  assert.equal(
    await visual.locator(".naval-hud-time").getAttribute("aria-label"),
    hiddenTime,
    "Hidden tabs stop frame updates",
  );
  await visual.evaluate(() => {
    window.hiddenFixture = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await visual.waitForFunction(
    (time) =>
      document.querySelector(".naval-hud-time").getAttribute("aria-label") !==
      time,
    hiddenTime,
  );
  assert.equal(
    await visual.evaluate(() => window.loadingQA.answers.length),
    1,
    "Visibility recovery adds no game request",
  );
  await visual.close();
  const fallback = await open(390, { noVisualViewport: true });
  await fallback.setViewportSize({ width: 390, height: 360 });
  await fallback.evaluate(() => window.dispatchEvent(new Event("resize")));
  await fallback.clock.runFor(250);
  assert.equal(await fallback.locator(".naval-game--compact").count(), 1);
  await fallback.setViewportSize({ width: 844, height: 390 });
  await fallback.evaluate(() => window.dispatchEvent(new Event("resize")));
  await fallback.clock.runFor(250);
  assert.equal(
    await fallback.locator(".naval-game--compact").count(),
    0,
    "Orientation resets the old portrait height baseline",
  );
  await fallback.close();
  checks.push(
    "Visual-viewport-only keyboard animation coalesces into one layout; pinch zoom is preserved; IME Enter waits for composition; hidden tabs stop ticks and resync without RPCs; no-VisualViewport fallback and orientation restore pass.",
  );
  const touch = await open(390);
  await touch.evaluate(() => {
    window.loadingQA.holdAnswer = true;
  });
  await touch
    .locator("#naval-answer-input")
    .fill(await touch.locator(".naval-word > strong").first().textContent());
  await touch.getByRole("button", { name: "장전", exact: true }).tap();
  await touch.waitForFunction(() => window.loadingQA.answers.length === 1);
  assert.equal(
    await touch
      .locator("#naval-answer-input")
      .evaluate((el) => document.activeElement === el),
    true,
    "Touch submit keeps the keyboard focused",
  );
  await touch.evaluate(() => window.loadingQA.releaseAnswer());
  await touch.close();
  checks.push("Real touch pointer submission preserves answer input focus.");
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
  await failed.locator("#naval-answer-input").fill("새 초안");
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
  assert.equal(
    await failed.locator("#naval-answer-input").inputValue(),
    "새 초안",
    "Retry retains a newer draft",
  );
  await failed.close();
  const timeout = await open();
  await timeout.evaluate(() => {
    window.loadingQA.holdAnswer = true;
  });
  await answer(timeout);
  await timeout.waitForFunction(() => window.loadingQA.answers.length === 1);
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
