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
const authListeners=new Set(),subscriptions=new Set();
const teacher=new URLSearchParams(location.search).has('teacher');
const qa=window.rhythmQA={
 hidden:false,online:true,hold:false,reads:[],saves:[],toasts:[],listeners:subscriptions,
 publication:{status:'closed',enabled:false,revision:0},audio:[],hits:[],time:null,saveFailure:false,saveHold:false,pendingSaves:[],confirms:[],confirmFailure:false,
 auth:{config:{year:'2026',semester:'2',showQuiz:true,showScore:true,showLesson:true},menuConfig:{student:[],teacher:[]},configReady:true,menuConfigReady:true,authGeneration:1,
 currentUser:{uid:teacher?'qa-teacher':'qa-student',email:teacher?'teacher@yongshin-ms.ms.kr':'2630001@yongshin-ms.ms.kr'},
 userData:{role:teacher?'teacher':'student',registrationApprovalStatus:'APPROVED'}}
};
Object.defineProperty(document,'hidden',{configurable:true,get:()=>qa.hidden});
Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>qa.online});
qa.visibility=value=>{qa.hidden=!value;document.dispatchEvent(new Event('visibilitychange'))};
qa.network=value=>{qa.online=value;window.dispatchEvent(new Event(value?'online':'offline'))};
qa.emit=value=>{qa.publication={...qa.publication,...value};for(const item of subscriptions)item.callback({...qa.publication})};
qa.account=(uid,changes={})=>{qa.auth={...qa.auth,...changes,currentUser:{...qa.auth.currentUser,uid}};authListeners.forEach(fn=>fn())};
qa.config=changes=>{qa.auth={...qa.auth,config:{...qa.auth.config,...changes}};authListeners.forEach(fn=>fn())};
export const useAuth=()=>useSyncExternalStore(fn=>{authListeners.add(fn);return()=>authListeners.delete(fn)},()=>qa.auth);
export function subscribeRhythmPublication(config,callback){
 const record={id:qa.reads.length,uid:qa.auth.currentUser.uid,config:{...config},callback};
 qa.reads.push({uid:record.uid,config:record.config});subscriptions.add(record);qa.lastCallback=callback;
 queueMicrotask(()=>{if(subscriptions.has(record)&&!qa.hold)callback({...qa.publication})});
 return()=>subscriptions.delete(record);
}
export async function saveRhythmPublication(config,enabled,expectedRevision){
 qa.saves.push({config:{...config},enabled,expectedRevision});
 if(qa.saveHold)await new Promise(resolve=>qa.pendingSaves.push(resolve));
 if(qa.saveFailure)throw new Error('검증용 저장 실패');
 if(expectedRevision!==qa.publication.revision)throw new Error('검증용 충돌');
 qa.emit({status:enabled?'open':'closed',enabled,revision:qa.publication.revision+1});
 return {enabled,revision:qa.publication.revision};
}
export async function confirmRhythmPublication(config){
 qa.confirms.push({config:{...config},uid:qa.auth.currentUser.uid});
 if(qa.confirmFailure)throw new Error('검증용 만료 세션');
 return qa.publication.status==='open'&&qa.publication.enabled;
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
const realSetTimeout=window.setTimeout.bind(window),realClearTimeout=window.clearTimeout.bind(window),deadlines=new Map();
window.setTimeout=(callback,delay,...args)=>{const id=realSetTimeout(()=>{deadlines.delete(id);callback(...args)},delay);if(delay===10000)deadlines.set(id,()=>callback(...args));return id};
window.clearTimeout=id=>{deadlines.delete(id);realClearTimeout(id)};
qa.expireDeadlines=()=>{for(const [id,callback] of [...deadlines]){window.clearTimeout(id);callback()}};
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
  external = [];
const pageFor = async (width = 1280, height = 900) => {
  const page = await browser.newPage({
    viewport: { width, height },
    hasTouch: width <= 844,
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(base)) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  return page;
};
const open = (page) =>
  page.evaluate(() =>
    window.rhythmQA.emit({ status: "open", enabled: true, revision: 1 }),
  );
const phase = (page, value) => page.locator(`.rhythm-game--${value}`).waitFor();
const score = (page) =>
  page
    .locator(".rhythm-scorebar > div:first-child strong")
    .evaluate((el) => Number(el.textContent.replace(/\D/g, "")));
const tap = async (page, x, y) => {
  const box = await page.locator(".rhythm-drum-touch").boundingBox();
  assert(box);
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
};
const time = async (page, value) => {
  await page.evaluate((v) => (window.rhythmQA.time = v), value);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
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
    const page = await pageFor(width, height);
    await page.goto(base);
    await page.getByText("지금은 이용할 수 없는 게임입니다.").waitFor();
    assert.equal(await page.locator(".rhythm-game").count(), 0);
    assert.equal(await page.evaluate(() => window.rhythmQA.reads.length), 1);
    await open(page);
    await phase(page, "ready");
    const header = await page
      .locator(".rhythm-entry-heading")
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          background: s.backgroundColor,
          shadow: s.boxShadow,
          position: s.position,
        };
      });
    assert.equal(header.background, "rgba(0, 0, 0, 0)");
    assert.equal(header.shadow, "none");
    assert.notEqual(header.position, "sticky");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    assert.equal(overflow, false, `Lobby overflow ${width}`);
    await page.screenshot({
      path: path.join(evidence, `lobby-${width}x${height}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: /연주 시작/ }).click();
    await phase(page, "playing");
    assert.equal(
      await page.evaluate(() => window.rhythmQA.audio.at(-1).state),
      "running",
    );
    await time(page, 2.75);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      `Play overflow ${width}`,
    );
    await page.screenshot({
      path: path.join(evidence, `play-${width}x${height}.png`),
      fullPage: true,
    });
    const drum = await page.locator(".rhythm-drum-touch").boundingBox();
    assert(
      drum.width >= (height < 500 ? 100 : 160),
      `Drum touch width ${width}: ${drum.width}`,
    );
    if (height < 500) {
      for (const selector of [".rhythm-center-button", ".rhythm-rim-button"]) {
        const target = await page.locator(selector).boundingBox();
        assert(
          target.width >= 44 && target.height >= 44,
          "Landscape touch controls retain 44px targets",
        );
      }
      const line = await page.locator(".rhythm-hit-line").boundingBox();
      assert(
        line.y >= 0 && line.y + line.height <= height,
        "Landscape judgement line stays in viewport",
      );
      assert(
        drum.y >= 0 && drum.y + drum.height <= height,
        "Landscape drum stays in viewport with the judgement line",
      );
    }
    if (width <= 844) {
      await time(
        page,
        await page.evaluate(() => window.rhythmQA.chart()[0].time),
      );
      const touch = await page.locator(".rhythm-drum-touch").boundingBox();
      await page.touchscreen.tap(
        touch.x + touch.width / 2,
        touch.y + touch.height / 2,
      );
      assert.equal(
        await score(page),
        1000,
        `Touchscreen center scores ${width}`,
      );
    }
    checks.push({
      viewport: [width, height],
      header,
      lobbyOverflow: overflow,
      drumWidth: drum.width,
    });
    await page.close();
  }
  const page = await pageFor();
  await page.goto(base);
  await page.getByText("지금은 이용할 수 없는 게임입니다.").waitFor();
  await open(page);
  await phase(page, "ready");
  await page.getByRole("button", { name: /연주 시작/ }).click();
  await phase(page, "playing");
  const chart = await page.evaluate(() => window.rhythmQA.chart());
  assert(chart.length > 10);
  await time(page, chart[0].time);
  const first = chart[0];
  await tap(page, ...(first.kind === "center" ? [0.5, 0.08] : [0.5, 0.5]));
  assert.equal(await score(page), 0, "Wrong zone does not score");
  const hitsBefore = await page.evaluate(() => window.rhythmQA.hits.length);
  await tap(page, 0.01, 0.01);
  assert.equal(
    await page.evaluate(() => window.rhythmQA.hits.length),
    hitsBefore,
    "Outside circle does not strike",
  );
  await tap(page, ...(first.kind === "center" ? [0.5, 0.5] : [0.5, 0.08]));
  assert.equal(
    await score(page),
    1000,
    "Correct pointer zone scores a perfect note",
  );
  await tap(page, ...(first.kind === "center" ? [0.5, 0.5] : [0.5, 0.08]));
  assert.equal(await score(page), 1000, "Duplicate note cannot score twice");
  const next = chart[1];
  await time(page, next.time);
  await page.evaluate(
    (code) =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { code, repeat: true, bubbles: true }),
      ),
    next.kind === "center" ? "KeyF" : "KeyD",
  );
  assert.equal(await score(page), 1000, "Held key repeats are ignored");
  await page.keyboard.press(next.kind === "center" ? "f" : "d");
  assert.equal(await score(page), 2000, "Keyboard scores matched note");
  const rim = chart.find(
    (note) => note.kind === "rim" && note.time > next.time,
  );
  assert(rim);
  await time(page, rim.time);
  await tap(page, 0.5, 0.08);
  assert.equal(await score(page), 3000, "Rim touch scores");
  await page.keyboard.press("Escape");
  await phase(page, "paused");
  await page.waitForFunction(
    () => window.rhythmQA.audio.at(-1).state === "suspended",
  );
  const pausedScore = await score(page);
  await page.keyboard.press("f");
  assert.equal(await score(page), pausedScore);
  await page.getByRole("button", { name: "계속 연주", exact: true }).click();
  await phase(page, "playing");
  await page.evaluate(() =>
    window.rhythmQA.emit({ status: "checking", enabled: false }),
  );
  await phase(page, "paused");
  await page.waitForFunction(
    () => window.rhythmQA.audio.at(-1).state === "suspended",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "계속 연주", exact: true })
      .isDisabled(),
    true,
  );
  await phase(page, "paused");
  await page.evaluate(() => window.rhythmQA.expireDeadlines());
  await page
    .getByRole("alert")
    .filter({ hasText: "게임을 확인하지 못했습니다." })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.rhythmQA.listeners.size),
    0,
    "Cache downgrade timeout releases listener",
  );
  await page.evaluate(
    () =>
      (window.rhythmQA.publication = {
        status: "open",
        enabled: true,
        revision: 1,
      }),
  );
  await page.getByRole("button", { name: "다시 확인", exact: true }).click();
  await page.evaluate(() =>
    window.rhythmQA.emit({ status: "open", enabled: true }),
  );
  await page.getByRole("button", { name: "계속 연주", exact: true }).click();
  await phase(page, "playing");
  await page.evaluate(() => window.rhythmQA.network(false));
  await phase(page, "paused");
  assert.equal(await page.evaluate(() => window.rhythmQA.listeners.size), 0);
  await page
    .getByRole("alert")
    .filter({ hasText: "게임을 확인하지 못했습니다." })
    .waitFor();
  await page.evaluate(() => window.rhythmQA.network(true));
  await page.getByRole("button", { name: "계속 연주", exact: true }).click();
  await phase(page, "playing");
  await page.evaluate(() => window.rhythmQA.visibility(false));
  await phase(page, "paused");
  assert.equal(await page.evaluate(() => window.rhythmQA.listeners.size), 0);
  const reads = await page.evaluate(() => window.rhythmQA.reads.length);
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => window.rhythmQA.reads.length),
    reads,
    "Hidden tabs do not poll",
  );
  await page.evaluate(() => window.rhythmQA.visibility(true));
  await page.getByRole("button", { name: "계속 연주", exact: true }).click();
  await phase(page, "playing");
  await time(
    page,
    await page.evaluate(() => window.rhythmQA.songs[0].duration + 1),
  );
  await phase(page, "result");
  assert.equal(
    await page
      .getByRole("heading", { name: "한 판, 얼쑤!" })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(
    await page.evaluate(() => window.rhythmQA.audio.at(-1).state),
    "idle",
  );
  await page.screenshot({
    path: path.join(evidence, "result-1280.png"),
    fullPage: true,
  });
  await page.evaluate(() => (window.rhythmQA.time = 0));
  await page.getByRole("button", { name: "한 번 더", exact: true }).click();
  await phase(page, "playing");
  await page.evaluate(() =>
    window.rhythmQA.emit({ status: "closed", enabled: false, revision: 2 }),
  );
  await page.getByText("지금은 이용할 수 없는 게임입니다.").waitFor();
  assert.equal(await page.locator(".rhythm-game").count(), 0);
  assert.equal(
    await page.evaluate(() => window.rhythmQA.audio.at(-1).state),
    "closed",
  );
  await open(page);
  await phase(page, "ready");
  await page.evaluate(() => {
    window.rhythmQA.confirmFailure = true;
    window.rhythmQA.time = 0;
  });
  await page.getByRole("button", { name: /연주 시작/ }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "연주를 시작하지 못했습니다." })
    .waitFor();
  await phase(page, "ready");
  assert.equal(
    await page.evaluate(() => window.rhythmQA.audio.at(-1).state),
    "closed",
    "Expired start closes audio",
  );
  await page.evaluate(() => (window.rhythmQA.confirmFailure = false));
  await page.getByRole("button", { name: /연주 시작/ }).click();
  await phase(page, "playing");
  const centerNotes = chart.filter((note) => note.kind === "center");
  await time(page, centerNotes[0].time);
  await page
    .getByRole("button", { name: "북 가운데 쿵 (F 또는 J)", exact: true })
    .focus();
  await page.keyboard.down("Enter");
  assert.equal(await score(page), 1000);
  await time(page, centerNotes[1].time);
  await page.keyboard.down("Enter");
  assert.equal(
    await score(page),
    1000,
    "Native Enter repeat does not auto-hit",
  );
  await page.keyboard.up("Enter");
  await page.keyboard.press("Escape");
  await phase(page, "paused");
  await page.evaluate(() => (window.rhythmQA.confirmFailure = true));
  await page.getByRole("button", { name: "계속 연주", exact: true }).click();
  await phase(page, "paused");
  assert.equal(
    await page.evaluate(() => window.rhythmQA.audio.at(-1).state),
    "suspended",
    "Expired resume remains suspended",
  );
  assert(
    (await page.evaluate(() => window.rhythmQA.confirms.length)) >= 7,
    "Student starts and resumes recheck server authorization",
  );
  await page.evaluate(() => (window.rhythmQA.confirmFailure = false));
  await page.getByRole("button", { name: "곡 고르기", exact: true }).click();
  await phase(page, "ready");
  await page.getByText("소리·판정 시차", { exact: true }).click();
  await page.locator("#rhythm-offset").focus();
  for (let step = 0; step < 10; step++) await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#rhythm-offset").inputValue(), "100");
  await page.evaluate(() => (window.rhythmQA.time = 0));
  await page.getByRole("button", { name: /연주 시작/ }).click();
  await phase(page, "playing");
  await time(page, chart[0].time + 0.1);
  const calibrated = await page
    .locator(".rhythm-note--center")
    .first()
    .evaluate((el) => Number.parseFloat(el.style.top));
  assert(
    Math.abs(calibrated - 86) < 0.01,
    "Offset moves the visible note to the same judgement line",
  );
  await tap(page, 0.5, 0.5);
  assert.equal(
    await score(page),
    1000,
    "Calibrated visible note receives a perfect hit",
  );
  await page.evaluate(() => {
    window.rhythmQA.stale = window.rhythmQA.lastCallback;
    window.rhythmQA.hold = true;
    window.rhythmQA.account("qa-other-student");
  });
  await page.waitForFunction(
    () => window.rhythmQA.reads.at(-1).uid === "qa-other-student",
  );
  assert.equal(await page.locator(".rhythm-game").count(), 0);
  await page.evaluate(() =>
    window.rhythmQA.stale({ status: "open", enabled: true, revision: 99 }),
  );
  assert.equal(
    await page.locator(".rhythm-game").count(),
    0,
    "Old account callback cannot reopen game",
  );
  await page.evaluate(() => {
    window.rhythmQA.hold = false;
    window.rhythmQA.emit({ status: "closed", enabled: false, revision: 0 });
  });
  await page.getByText("지금은 이용할 수 없는 게임입니다.").waitFor();
  checks.push({
    interaction:
      "pointer/touch/keyboard-repeat/offset/pause/cache-timeout/offline/hidden/result/live-close/session-start-resume/account-boundary",
    passed: true,
  });
  await page.close();

  const teacher = await pageFor();
  await teacher.goto(base + "/?teacher");
  await teacher.getByText("학생 비공개", { exact: true }).waitFor();
  assert.equal(await teacher.locator(".rhythm-game").count(), 0);
  await teacher.getByRole("button", { name: "미리보기", exact: true }).click();
  await phase(teacher, "ready");
  assert.equal(
    await teacher.evaluate(() => window.rhythmQA.saves.length),
    0,
    "Preview must not publish",
  );
  await teacher.getByRole("button", { name: /연주 시작/ }).click();
  await phase(teacher, "playing");
  assert.equal(
    await teacher.evaluate(() => window.rhythmQA.confirms.length),
    0,
    "Teacher preview does not make student admission reads",
  );
  await teacher
    .getByRole("button", { name: "미리보기 닫기", exact: true })
    .click();
  assert.equal(
    await teacher.evaluate(() => window.rhythmQA.audio.at(-1).state),
    "closed",
  );
  await teacher.evaluate(() => (window.rhythmQA.saveHold = true));
  await teacher
    .getByRole("button", { name: "학생에게 공개", exact: true })
    .click();
  await teacher
    .getByRole("button", { name: "저장 중…", exact: true })
    .waitFor();
  assert.equal(
    await teacher
      .getByRole("button", { name: "저장 중…", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(await teacher.evaluate(() => window.rhythmQA.saves.length), 1);
  await teacher.evaluate(() => {
    window.rhythmQA.saveHold = false;
    window.rhythmQA.pendingSaves.shift()();
  });
  await teacher.getByText("학생 공개 중", { exact: true }).waitFor();
  await teacher
    .getByRole("button", { name: "학생 공개 닫기", exact: true })
    .click();
  await teacher.getByText("학생 비공개", { exact: true }).waitFor();
  assert.deepEqual(
    await teacher.evaluate(() =>
      window.rhythmQA.saves.map((x) => [x.enabled, x.expectedRevision]),
    ),
    [
      [true, 0],
      [false, 1],
    ],
  );
  await teacher.evaluate(() => (window.rhythmQA.saveFailure = true));
  await teacher
    .getByRole("button", { name: "학생에게 공개", exact: true })
    .click();
  await teacher
    .getByRole("alert")
    .filter({ hasText: "공개 설정을 저장하지 못했습니다." })
    .waitFor();
  await teacher.getByText("학생 비공개", { exact: true }).waitFor();
  await teacher.evaluate(() =>
    window.rhythmQA.account("qa-staff", {
      userData: {
        role: "staff",
        teacherPortalEnabled: true,
        staffPermissions: ["lesson_read"],
      },
    }),
  );
  assert.equal(
    await teacher
      .getByRole("button", { name: "학생에게 공개", exact: true })
      .count(),
    0,
  );
  await teacher.getByRole("button", { name: "미리보기", exact: true }).click();
  await phase(teacher, "ready");
  await teacher.evaluate(() =>
    window.rhythmQA.account("qa-unprivileged", {
      userData: {
        role: "staff",
        teacherPortalEnabled: true,
        staffPermissions: [],
      },
    }),
  );
  await teacher
    .getByRole("alert")
    .filter({ hasText: "위플레이 관리 화면을 볼 권한이 없습니다." })
    .waitFor();
  checks.push({
    management:
      "preview without publication, one save, close, failed-save recovery, staff read-only, denied role",
    passed: true,
  });
  await teacher.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ checks, errors, external }, null, 2),
  );
  console.log(
    JSON.stringify(
      { passed: checks.length, checks, errors, external },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
