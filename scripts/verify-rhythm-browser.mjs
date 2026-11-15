/** Actual entry, publication hook, game and Web Audio; synthetic account/service only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
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
const evidence = path.join(root, "output/rhythm-browser-20261115");
await fs.mkdir(evidence, { recursive: true });
const modulePath = (value) =>
  JSON.stringify(path.join(root, value).replaceAll("\\", "/"));
const fixture = `
import {useSyncExternalStore} from 'react';
const authListeners=new Set();
const query=new URLSearchParams(location.search),teacher=query.has('teacher');
const qa=window.rhythmQA={
 hidden:false,online:true,hold:false,pending:[],failure:false,reads:[],saves:[],toasts:[],
 publication:{enabled:query.has('open'),revision:query.has('open')?1:0},audio:[],hits:[],time:null,saveFailure:false,
 auth:{config:{year:'2026',semester:'2',showQuiz:true,showScore:true,showLesson:true},menuConfig:{student:[],teacher:[]},configReady:true,menuConfigReady:true,authGeneration:1,authPhase:'ready',
 currentUser:{uid:teacher?'qa-teacher':'qa-student',email:teacher?'teacher@yongshin-ms.ms.kr':'2630001@yongshin-ms.ms.kr'},
 userData:{role:teacher?'teacher':'student',registrationApprovalStatus:'APPROVED'}}
};
Object.defineProperty(document,'hidden',{configurable:true,get:()=>qa.hidden});
Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>qa.online});
qa.visibility=value=>{qa.hidden=!value;document.dispatchEvent(new Event('visibilitychange'))};
qa.network=value=>{qa.online=value;window.dispatchEvent(new Event(value?'online':'offline'))};
qa.publish=value=>{qa.publication={...qa.publication,...value}};
qa.account=(uid,changes={})=>{qa.auth={...qa.auth,...changes,currentUser:{...qa.auth.currentUser,uid}};authListeners.forEach(fn=>fn())};
qa.config=changes=>{qa.auth={...qa.auth,config:{...qa.auth.config,...changes}};authListeners.forEach(fn=>fn())};
export const useAuth=()=>useSyncExternalStore(fn=>{authListeners.add(fn);return()=>authListeners.delete(fn)},()=>qa.auth);
export function getRhythmPublication(config){
 qa.reads.push({uid:qa.auth.currentUser.uid,config:{...config}});
 if(qa.failure)return Promise.reject(new Error('검증용 읽기 실패'));
 const value={...qa.publication};
 if(qa.hold)return new Promise(resolve=>qa.pending.push(()=>resolve(value)));
 return Promise.resolve(value);
}
export async function saveRhythmPublication(config,enabled,expectedRevision){
 qa.saves.push({config:{...config},enabled,expectedRevision});
 if(qa.saveFailure)throw new Error('검증용 저장 실패');
 if(expectedRevision!==qa.publication.revision)throw new Error('검증용 충돌');
 qa.publish({enabled,revision:qa.publication.revision+1});
 return {enabled,revision:qa.publication.revision};
}
export const useAppToast=()=>({showToast:value=>qa.toasts.push(value)});
`;
const harness = `
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';
import Entry from ${modulePath("src/components/common/weplay/rhythm/RhythmGameEntry.tsx")};
import {RhythmAudio} from ${modulePath("src/components/common/weplay/rhythm/rhythmAudio.ts")};
import {RHYTHM_SONGS} from ${modulePath("src/components/common/weplay/rhythm/rhythmSongs.ts")};
import {createChart} from ${modulePath("src/components/common/weplay/rhythm/rhythmCore.ts")};
import ${modulePath("src/assets/index.css")};import ${modulePath("assets/css/style.css")};
const qa=window.rhythmQA;
qa.songs=RHYTHM_SONGS;qa.chart=(song=0,difficulty='normal')=>createChart(RHYTHM_SONGS[song],difficulty);
const originalTime=Object.getOwnPropertyDescriptor(RhythmAudio.prototype,'currentTime').get;
Object.defineProperty(RhythmAudio.prototype,'currentTime',{get(){return qa.time??originalTime.call(this)}});
const originalStart=RhythmAudio.prototype.start;
RhythmAudio.prototype.start=async function(...args){qa.audio.push(this);return originalStart.apply(this,args)};
const originalHit=RhythmAudio.prototype.hit;
RhythmAudio.prototype.hit=function(kind){qa.hits.push(kind);return originalHit.call(this,kind)};
qa.audioStates=()=>qa.audio.map(player=>player.state);
createRoot(document.getElementById('root')).render(<MemoryRouter><Entry portal={new URLSearchParams(location.search).has('teacher')?'teacher':'student'}/></MemoryRouter>);
`;
const bundled = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "rhythm-browser.js"),
  metafile: true,
  loader: {
    ".svg": "dataurl",
    ".png": "dataurl",
    ".webp": "dataurl",
    ".woff2": "dataurl",
    ".woff": "dataurl",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "rhythm-synthetic-services",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/rhythmPublication$|(?:^|\/)AppToastProvider$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: fixture,
          loader: "tsx",
          resolveDir: root,
        }));
        plugin.onResolve({ filter: /^\/assets\// }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
  ],
});
assert(
  !Object.keys(bundled.metafile.inputs).some((name) =>
    /node_modules[\\/](@firebase|firebase)[\\/]/.test(name),
  ),
  "No live Firebase code in browser fixture",
);
const js = bundled.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundled.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+[^;]+;/g, "");
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  if (pathname === "/qa.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(js);
  }
  if (pathname === "/qa.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(css);
  }
  if (pathname.startsWith("/assets/")) {
    const target = path.resolve(root, "public", "." + pathname);
    if (!target.startsWith(path.join(root, "public") + path.sep)) {
      res.statusCode = 403;
      return res.end();
    }
    try {
      return res.end(await fs.readFile(target));
    } catch {
      res.statusCode = 404;
      return res.end();
    }
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>*,::before,::after{box-sizing:border-box}body{margin:0;background:#f3f4f6}#root{min-width:0}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  errors = [],
  external = [],
  assets = new Set();
let activePage;
const pageFor = async (width = 1280, height = 900, fallback = true) => {
  const page = await browser.newPage({
    viewport: { width, height },
    hasTouch: width <= 844,
    reducedMotion: "reduce",
  });
  activePage = page;
  page.rhythmHasTouch = width <= 844;
  page.setDefaultTimeout(6000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/assets/weplay/rhythm/")) {
      assert.equal(response.status(), 200, `Asset ${response.url()}`);
      assets.add(new URL(response.url()).pathname);
    }
  });
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(base)) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(
    ({ fallback }) => {
      if (fallback)
        Element.prototype.requestFullscreen = () =>
          Promise.reject(new Error("QA page fallback"));
      window.rhythmAnimations = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        window.rhythmAnimations.push({
          target: this.className,
          duration: args[1]?.duration,
        });
        return animate.apply(this, args);
      };
      window.rhythmSound = {
        contexts: 0,
        oscillators: 0,
        buffers: 0,
        resumes: 0,
      };
      const NativeAudio = window.AudioContext;
      window.AudioContext = class extends NativeAudio {
        constructor(...args) {
          super(...args);
          window.rhythmSound.contexts++;
        }
        createOscillator(...args) {
          window.rhythmSound.oscillators++;
          return super.createOscillator(...args);
        }
        createBufferSource(...args) {
          window.rhythmSound.buffers++;
          return super.createBufferSource(...args);
        }
        resume(...args) {
          window.rhythmSound.resumes++;
          return super.resume(...args);
        }
      };
    },
    { fallback },
  );
  return page;
};
const frames = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
const phase = (page, value) => page.locator(`.rhythm-game--${value}`).waitFor();
const readCount = (page) => page.evaluate(() => window.rhythmQA.reads.length);
const hitCount = (page) => page.evaluate(() => window.rhythmQA.hits.length);
const score = (page) =>
  page
    .locator(".rhythm-scorebar > div:first-child strong")
    .evaluate((el) => Number(el.textContent.replace(/\D/g, "")));
const time = async (page, value) => {
  await page.evaluate((value) => (window.rhythmQA.time = value), value);
  await frames(page);
};
const shot = async (page, name) => {
  await page.screenshot({
    path: path.join(evidence, `${name}.png`),
    fullPage: true,
  });
};
const imageCheck = async (page) => {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".rhythm-game img")).every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  return page
    .locator(".rhythm-game img")
    .evaluateAll((imgs) => [
      ...new Set(imgs.map((img) => new URL(img.src).pathname)),
    ]);
};
const overflowCheck = async (page, label) => {
  const info = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    header: (() => {
      const s = getComputedStyle(
        document.querySelector(".rhythm-entry-heading"),
      );
      return {
        background: s.backgroundColor,
        shadow: s.boxShadow,
        position: s.position,
      };
    })(),
  }));
  assert(
    info.scroll <= info.width + 1,
    `${label} horizontal overflow: ${JSON.stringify(info)}`,
  );
  assert.equal(
    info.header.background,
    "rgba(0, 0, 0, 0)",
    `${label} transparent header`,
  );
  assert.equal(info.header.shadow, "none");
  assert.equal(info.header.position, "static");
  return info;
};
const touchPoint = async (page, x, y) =>
  page.locator(".rhythm-drum-touch").evaluate(
    (el, { x, y }) => {
      const rect = el.getBoundingClientRect(),
        rotated = !!el.closest(".rhythm-game--rotated");
      return rotated
        ? { x: rect.left + (1 - y) * rect.width, y: rect.top + x * rect.height }
        : { x: rect.left + x * rect.width, y: rect.top + y * rect.height };
    },
    { x, y },
  );
const tap = async (page, x, y) => {
  const point = await touchPoint(page, x, y);
  if (page.rhythmHasTouch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  return point;
};
const key = async (page, code, repeat = false) =>
  page.evaluate(
    ({ code, repeat }) =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code,
          key: code,
          repeat,
          bubbles: true,
          cancelable: true,
        }),
      ),
    { code, repeat },
  );
const start = async (page) => {
  await time(page, 0);
  await page.getByRole("button", { name: "연주 시작", exact: false }).click();
  await phase(page, "playing");
};
const startVisible = (page) =>
  page
    .getByRole("button", { name: "연주 시작", exact: false })
    .evaluate((el) => {
      const r = el.getBoundingClientRect(),
        hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && el.contains(hit);
    });
const helpCheck = async (page, label) => {
  await page
    .getByRole("button", { name: "리듬 게임 조작 방법", exact: true })
    .click();
  const help = page.getByRole("tooltip");
  await help.waitFor();
  const placement = await help.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      inside: !!el.closest(".rhythm-canvas"),
      x: r.x,
      y: r.y,
      right: r.right,
      bottom: r.bottom,
      width: innerWidth,
      height: innerHeight,
    };
  });
  assert(placement.inside, `${label} help stays inside fullscreen canvas`);
  assert(
    placement.x >= -1 &&
      placement.y >= -1 &&
      placement.right <= placement.width + 1 &&
      placement.bottom <= placement.height + 1,
    `${label} help clipped: ${JSON.stringify(placement)}`,
  );
  const fullscreen = await page.locator(".rhythm-game--fullscreen").count();
  await page.keyboard.press("Escape");
  await help.waitFor({ state: "detached" });
  assert.equal(
    await page.locator(".rhythm-game--fullscreen").count(),
    fullscreen,
    "help Escape does not exit fullscreen",
  );
  return placement;
};
const assertLayout = async (page, label) => {
  const result = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        right: r.right,
        bottom: r.bottom,
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      canvas: rect(".rhythm-canvas"),
      lane: rect(".rhythm-lanes"),
      crop: rect(".rhythm-drum-crop"),
      drum: rect(".rhythm-drum-touch"),
      rotated: !!document.querySelector(".rhythm-game--rotated"),
      matrix: getComputedStyle(document.querySelector(".rhythm-canvas"))
        .transform,
    };
  });
  for (const target of ["lane", "crop"]) {
    const r = result[target];
    assert(
      r.x >= -1 &&
        r.y >= -1 &&
        r.right <= result.viewport.width + 1 &&
        r.bottom <= result.viewport.height + 1,
      `${label} ${target} clipped: ${JSON.stringify(result)}`,
    );
  }
  assert.equal(
    await page.locator(".rhythm-lanes").count(),
    1,
    "single score lane",
  );
  assert(
    Math.abs(
      (result.rotated
        ? result.crop.width / result.drum.width
        : result.crop.height / result.drum.height) - 0.5,
    ) < 0.01,
    `exact upper half drum: ${JSON.stringify(result)}`,
  );
  if (result.rotated)
    assert.match(result.matrix, /matrix\(0, 1, -1, 0,/, "clockwise canvas");
  return result;
};
try {
  for (const [width, height] of [
    [1440, 1000],
    [1280, 900],
    [768, 1024],
    [390, 844],
    [320, 760],
    [844, 390],
  ]) {
    const page = await pageFor(width, height),
      label = `${width}x${height}`;
    await page.goto(`${base}/?open`);
    await phase(page, "ready");
    assert.equal(
      await readCount(page),
      1,
      "entry gets exactly one publication read",
    );
    await overflowCheck(page, label);
    const portrait = height > width;
    if (portrait) {
      await page.locator(".rhythm-orientation-gate").waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "연주 시작", exact: false })
          .count(),
        0,
        "portrait blocks starting",
      );
      const animations = await page
        .locator(".rhythm-orientation-phone")
        .evaluate((el) => ({
          name: getComputedStyle(el).animationName,
          duration: parseFloat(getComputedStyle(el).animationDuration),
        }));
      assert.equal(animations.name, "rhythm-phone");
      assert(
        animations.duration >= 3,
        "rotation guide remains animated in reduced motion",
      );
      await imageCheck(page);
      await shot(page, `${label}-portrait`);
      await page
        .getByRole("button", { name: "전체 화면으로 열기", exact: true })
        .click();
      await page.locator(".rhythm-game--rotated").waitFor();
      assert.equal(
        await page.evaluate(() => document.fullscreenElement),
        null,
        "forced page fallback",
      );
    }
    await imageCheck(page);
    await shot(page, `${label}-lobby`);
    await helpCheck(page, label);
    assert.equal(await page.locator(".rhythm-song").count(), 4);
    assert(
      await startVisible(page),
      `${label} start button visible without scrolling`,
    );
    const calibration = page.getByLabel("소리·판정 시차", { exact: true });
    await calibration.click();
    const offsetPanel = page.locator(".rhythm-calibration-popover");
    await offsetPanel.waitFor();
    const offsetBox = await offsetPanel.boundingBox();
    assert(
      offsetBox &&
        offsetBox.x >= 0 &&
        offsetBox.y >= 0 &&
        offsetBox.x + offsetBox.width <= width + 1 &&
        offsetBox.y + offsetBox.height <= height + 1,
      `${label} calibration visible`,
    );
    await page.locator("#rhythm-offset").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#rhythm-offset").inputValue(), "10");
    await page.keyboard.press("ArrowLeft");
    const fullscreenBeforeEscape = await page
      .locator(".rhythm-game--fullscreen")
      .count();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator(".rhythm-calibration").evaluate((el) => el.open),
      false,
    );
    assert.equal(
      await page.locator(".rhythm-game--fullscreen").count(),
      fullscreenBeforeEscape,
    );
    await calibration.click();
    await page.locator(".rhythm-eyebrow").first().click();
    assert.equal(
      await page.locator(".rhythm-calibration").evaluate((el) => el.open),
      false,
      "outside pointer closes calibration",
    );
    await start(page);
    const layout = await assertLayout(page, label);
    await imageCheck(page);
    const focusGeometry = () =>
      page.locator(".rhythm-drum-crop").evaluate((el) => ({
        scroll: el.scrollTop,
        rect: el.getBoundingClientRect().toJSON(),
        drum: el
          .querySelector(".rhythm-drum-touch")
          .getBoundingClientRect()
          .toJSON(),
      }));
    const beforeFocus = await focusGeometry();
    await page.locator(".rhythm-rim-button").focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .locator(".rhythm-center-button")
        .evaluate((el) => el === document.activeElement),
      true,
      "Tab reaches center button",
    );
    assert.deepEqual(
      await focusGeometry(),
      beforeFocus,
      "drum geometry remains fixed after keyboard focus",
    );
    const activationStart = await hitCount(page);
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    assert.equal(
      await hitCount(page),
      activationStart + 1,
      "Enter repeat causes one accessible center hit",
    );
    await page.keyboard.down("Space");
    await page.keyboard.down("Space");
    await page.keyboard.up("Space");
    assert.equal(
      await hitCount(page),
      activationStart + 2,
      "Space repeat causes one accessible center hit",
    );
    await page.locator(".rhythm-game").focus();
    const keyStart = await hitCount(page);
    for (const code of ["ArrowLeft", "ArrowRight", "KeyZ", "KeyX"])
      await key(page, code);
    assert.deepEqual(
      await page.evaluate(
        (start) => window.rhythmQA.hits.slice(start),
        keyStart,
      ),
      ["center", "center", "rim", "rim"],
      "all four physical keys",
    );
    const notes = await page.evaluate(() => window.rhythmQA.chart());
    // Physical pointer positions are transformed by the actual DOM and game inverse.
    const first = notes[0];
    await time(page, first.time);
    const alignment = await page.evaluate((id) => {
      const note = document
          .querySelector(`[data-note-id="${id}"]`)
          .getBoundingClientRect(),
        target = document
          .querySelector(".rhythm-hit-line")
          .getBoundingClientRect();
      return Math.hypot(
        note.x + note.width / 2 - target.x - target.width / 2,
        note.y + note.height / 2 - target.y - target.height / 2,
      );
    }, first.id);
    assert(alignment < 1, "chart time and visible judgement flower align");
    const before = await hitCount(page);
    const outside = await tap(page, 0.02, 0.02);
    assert.equal(await hitCount(page), before, "outside circular drum ignored");
    const lower = await touchPoint(page, 0.5, 0.56);
    await page.mouse.click(lower.x, lower.y);
    assert.equal(
      await hitCount(page),
      before,
      "cropped lower half is not touchable",
    );
    const wrong = first.kind === "center" ? "rim" : "center";
    await tap(page, 0.5, wrong === "center" ? 0.3 : 0.06);
    assert.equal(await score(page), 0, "wrong type does not consume note");
    const correctPoint = await tap(
      page,
      0.5,
      first.kind === "center" ? 0.3 : 0.06,
    );
    assert.equal(await score(page), 1000, "perfect transformed touch");
    const firstHits = await hitCount(page);
    await tap(page, 0.5, first.kind === "center" ? 0.3 : 0.06);
    assert.equal(await score(page), 1000, "same note never scores twice");
    assert.equal(
      await hitCount(page),
      firstHits + 1,
      "one touch emits one strike",
    );
    const effects = await page.evaluate(() => ({
      effects: document.querySelectorAll(".rhythm-hit-effect").length,
      animation: getComputedStyle(document.querySelector(".rhythm-hit-effect"))
        .animationDuration,
      wa: window.rhythmAnimations,
      reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
    }));
    assert(
      effects.reduce &&
        effects.effects > 0 &&
        parseFloat(effects.animation) >= 0.4,
      "hit effects survive reduced motion",
    );
    assert(
      effects.wa.some(
        (item) => item.target === "rhythm-drum-visual" && item.duration === 220,
      ),
    );
    assert(
      effects.wa.some(
        (item) =>
          item.target === "rhythm-stage-mascot" && item.duration === 320,
      ),
    );
    await shot(page, `${label}-play`);
    await page.screenshot({
      path: path.join(evidence, `${label}-play-viewport.png`),
    });
    const second = notes.find((note) => note.time > first.time + 0.2);
    await time(page, second.time);
    const repeatBefore = await hitCount(page);
    await key(page, second.kind === "center" ? "ArrowLeft" : "KeyZ", true);
    assert.equal(await hitCount(page), repeatBefore, "repeat key suppressed");
    await key(page, second.kind === "center" ? "ArrowRight" : "KeyX");
    assert.equal(await score(page), 2000, "arrow/Z/X mapped to second note");
    await page.getByRole("button", { name: "일시정지", exact: true }).click();
    await phase(page, "paused");
    await page.waitForFunction(
      () => window.rhythmQA.audioStates().at(-1) === "suspended",
    );
    const paused = await hitCount(page);
    await key(page, "ArrowLeft");
    assert.equal(await hitCount(page), paused, "paused hits ignored");
    await page.getByRole("button", { name: "계속 연주", exact: true }).click();
    await phase(page, "playing");
    await page.evaluate(() => {
      window.rhythmQA.publish({ enabled: false, revision: 2 });
      window.rhythmQA.network(false);
      window.rhythmQA.network(true);
    });
    await frames(page);
    await phase(page, "playing");
    await page.evaluate(() => window.rhythmQA.visibility(false));
    await phase(page, "paused");
    await page.evaluate(() => window.rhythmQA.visibility(true));
    await frames(page);
    await phase(page, "paused");
    await page.getByRole("button", { name: "계속 연주", exact: true }).click();
    await phase(page, "playing");
    await time(
      page,
      await page.evaluate(() => window.rhythmQA.songs[0].duration + 0.1),
    );
    await phase(page, "result");
    assert.equal(
      await page
        .locator(".rhythm-result-score")
        .evaluate((el) => Number(el.textContent.replace(/\D/g, ""))),
      2000,
    );
    assert.equal(
      await page
        .locator(".rhythm-result h2")
        .evaluate((el) => el === document.activeElement),
      true,
      "result focus",
    );
    await imageCheck(page);
    await shot(page, `${label}-result`);
    await time(page, 0);
    await page.getByRole("button", { name: "한 번 더", exact: true }).click();
    await phase(page, "playing");
    assert.equal(await score(page), 0, "retry resets score");
    assert.equal(
      await readCount(page),
      1,
      "play/touch/pause/resume/retry/visibility/online all add zero reads",
    );
    assert.equal(
      await page.evaluate(() => window.rhythmQA.saves.length),
      0,
      "student gameplay writes zero",
    );
    const sound = await page.evaluate(() => window.rhythmSound);
    assert(
      sound.contexts >= 2 &&
        sound.oscillators > 0 &&
        sound.buffers > 0 &&
        sound.resumes >= 2,
      "actual Web Audio produced local oscillators and buffers",
    );
    if (portrait) {
      await page
        .getByRole("button", { name: "전체 화면 나가기", exact: true })
        .click();
      const gateButton = page.getByRole("button", {
        name: "전체 화면으로 열기",
        exact: true,
      });
      await gateButton.waitFor();
      assert.equal(
        await gateButton.evaluate((el) => el === document.activeElement),
        true,
        "fullscreen exit restores portrait gate focus",
      );
      assert.equal(await readCount(page), 1);
    }
    checks.push({
      viewport: label,
      portraitFallback: portrait,
      layout,
      pointer: { outside, lower, correctPoint },
      sound,
      entryReads: 1,
      gameplayReads: 0,
      gameplayWrites: 0,
      passed: true,
    });
    await page.close();
  }
  // Default absent, failed reads, and account/semester remounts use the actual Entry/hook.
  const boundary = await pageFor();
  await boundary.goto(base);
  await boundary.getByText("지금은 이용할 수 없는 게임입니다.").waitFor();
  assert.equal(await boundary.locator(".rhythm-game").count(), 0);
  assert.equal(await readCount(boundary), 1);
  await boundary.evaluate(() => {
    window.rhythmQA.publish({ enabled: true, revision: 1 });
    window.rhythmQA.account("student-2");
  });
  await phase(boundary, "ready");
  assert.equal(await readCount(boundary), 2);
  await start(boundary);
  await boundary.evaluate(() => {
    window.rhythmQA.hold = true;
    window.rhythmQA.config({ semester: "1" });
  });
  await boundary.locator(".rhythm-game").waitFor({ state: "detached" });
  assert.equal(await readCount(boundary), 3);
  assert(
    await boundary.evaluate(() =>
      window.rhythmQA.audioStates().every((state) => state === "closed"),
    ),
    "semester exits and disposes audio immediately",
  );
  await boundary.evaluate(() => {
    window.rhythmQA.hold = false;
    window.rhythmQA.pending.splice(0).forEach((resolve) => resolve());
  });
  await phase(boundary, "ready");
  await start(boundary);
  await boundary.evaluate(() => {
    window.rhythmQA.failure = true;
    window.rhythmQA.account("student-3");
  });
  await boundary.getByRole("button", { name: "다시 확인" }).waitFor();
  assert(
    await boundary.evaluate(() =>
      window.rhythmQA.audioStates().every((state) => state === "closed"),
    ),
    "account exits and disposes audio",
  );
  const failedCount = await readCount(boundary);
  await boundary.evaluate(() => {
    window.rhythmQA.network(false);
    window.rhythmQA.network(true);
    window.rhythmQA.visibility(false);
    window.rhythmQA.visibility(true);
  });
  await frames(boundary);
  assert.equal(
    await readCount(boundary),
    failedCount,
    "failure requires explicit retry",
  );
  await boundary.evaluate(() => (window.rhythmQA.failure = false));
  await boundary.getByRole("button", { name: "다시 확인" }).click();
  await phase(boundary, "ready");
  assert.equal(await readCount(boundary), failedCount + 1);
  checks.push({
    boundary: "absent, semester/account stop, failed read, explicit retry",
    passed: true,
  });
  await boundary.close();
  const teacher = await pageFor();
  await teacher.goto(`${base}/?teacher`);
  await teacher
    .getByRole("button", { name: "학생에게 공개", exact: true })
    .waitFor();
  assert.equal(await readCount(teacher), 1);
  await teacher.getByRole("button", { name: "미리보기", exact: true }).click();
  await phase(teacher, "ready");
  await start(teacher);
  assert.equal(
    await teacher.evaluate(() => window.rhythmQA.saves.length),
    0,
    "preview does not publish",
  );
  await teacher
    .getByRole("button", { name: "학생에게 공개", exact: true })
    .click();
  await teacher
    .getByRole("button", { name: "학생 공개 닫기", exact: true })
    .waitFor();
  assert.equal(
    await readCount(teacher),
    1,
    "save accepts local transaction result",
  );
  await teacher
    .getByRole("button", { name: "학생 공개 닫기", exact: true })
    .click();
  await teacher
    .getByRole("button", { name: "학생에게 공개", exact: true })
    .waitFor();
  await phase(teacher, "playing");
  assert.equal(await teacher.evaluate(() => window.rhythmQA.saves.length), 2);
  checks.push({
    teacher:
      "preview remains separate; publish/close use transaction result without re-read",
    passed: true,
  });
  await teacher.close();
  const native = await pageFor(1280, 900, false);
  await native.goto(`${base}/?open`);
  await phase(native, "ready");
  await native.getByRole("button", { name: "전체 화면", exact: true }).click();
  await native.waitForFunction(() =>
    document.fullscreenElement?.classList.contains("rhythm-game"),
  );
  await helpCheck(native, "native fullscreen");
  await start(native);
  await assertLayout(native, "native fullscreen");
  await shot(native, "1280x900-native-fullscreen");
  await native
    .getByRole("button", { name: "전체 화면 나가기", exact: true })
    .click();
  await native.waitForFunction(() => !document.fullscreenElement);
  await phase(native, "paused");
  assert.equal(await readCount(native), 1, "native fullscreen adds zero reads");
  checks.push({
    nativeFullscreen: "enter, help, play, exit pauses",
    passed: true,
  });
  await native.close();
  for (const name of [
    "bg-stage",
    "button-plaque",
    "mascot",
    "note-center",
    "note-rim",
    "drum",
  ])
    assert(
      assets.has(`/assets/weplay/rhythm/v2/${name}.webp`),
      `loaded artwork ${name}`,
    );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ checks, assets: [...assets], errors, external }, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        passed: checks.length,
        viewports: checks
          .filter((check) => check.viewport)
          .map((check) => check.viewport),
        assets: assets.size,
        errors,
        external,
        report: path.join(evidence, "report.json"),
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (activePage && !activePage.isClosed())
    await shot(activePage, "FAILURE").catch(() => {});
  await fs.writeFile(
    path.join(evidence, "failure.json"),
    JSON.stringify(
      { error: String(error), stack: error.stack, checks, errors, external },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
