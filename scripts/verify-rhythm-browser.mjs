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
const evidence = path.join(root, "output/rhythm-browser-20261117");
await fs.mkdir(evidence, { recursive: true });
const modulePath = (value) =>
  JSON.stringify(path.join(root, value).replaceAll("\\", "/"));
const fixture = `
import {useSyncExternalStore} from 'react';
const authListeners=new Set();
const query=new URLSearchParams(location.search),teacher=query.has('teacher');
const qa=window.rhythmQA={
 hidden:false,online:true,hold:false,pending:[],failure:false,reads:[],saves:[],toasts:[],rankingCalls:[],
 publication:{enabled:query.has('open'),revision:query.has('open')?1:0},audio:[],hits:[],time:null,saveFailure:false,
 challenge:{songId:'eolssu-run',automaticSongId:'eolssu-run',selection:'automatic',revision:0,allowedDifficulties:['normal','hard'],missLimit:30,freeRemaining:3,paidCost:50,weekId:'2026-11-16',week:{startsAtMs:1794754800000,endsAtMs:1795359600000},dailyFreeLimit:3,dailyUsed:0,preview:teacher},finishFailure:false,settingsFailure:false,weeklyPlans:{},weeklyFailure:false,
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
export const getHistoryDictionaryCallable=async name=>async data=>{
 qa.rankingCalls.push({name,data:structuredClone(data)});
 if(name==='getWeplayWeeklyRewards'||name==='saveWeplayWeeklyRewards'){
   const key=[data.gameId,data.category,data.weekId].join('/');
   const current=qa.weeklyPlans[key]||{tiers:[],revision:0,status:'unscheduled',paidCount:0,paidWis:0,skippedCount:0,week:{endsAtMs:Date.now()+7*86400000}};
   if(name==='getWeplayWeeklyRewards')return {data:structuredClone(current)};
   if(qa.weeklyFailure)throw new Error('검증용 보상 저장 실패');
   const saved=qa.weeklyPlans[key]={...current,tiers:structuredClone(data.tiers),revision:current.revision+1,status:data.tiers.length?'scheduled':'disabled'};
   return {data:structuredClone(saved)};
 }
 if(name==='getRhythmChallengeState')return {data:{...qa.challenge}};
 if(name==='saveRhythmChallengeSettings'){if(qa.settingsFailure)throw new Error('검증용 설정 저장 실패');qa.challenge={...qa.challenge,...data,revision:qa.challenge.revision+1};return {data:{...qa.challenge}};}
 if(name==='startRhythmRankingGame'){qa.challenge.freeRemaining=Math.max(0,qa.challenge.freeRemaining-1);return {data:{...qa.challenge,...data,sessionId:data.requestId,chargedCost:data.paid?50:0}};}
 if(name==='finishRhythmRankingGame'){if(qa.finishFailure)throw new Error('검증용 기록 실패');return {data:{score:0}};}
 if(name==='getWeplayRanking')return {data:{gameId:data.gameId,category:data.category,rows:[],classes:[],updatedAtMs:Date.now(),scoreLabel:'점'}};
 throw new Error('Unexpected callable '+name);
};
`;
const harness = `
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';
import Entry from ${modulePath("src/components/common/weplay/rhythm/RhythmGameEntry.tsx")};
import WeeklyRewards from ${modulePath("src/components/common/weplay/WeplayWeeklyRewards.tsx")};
import {RhythmAudio} from ${modulePath("src/components/common/weplay/rhythm/rhythmAudio.ts")};
import {RHYTHM_SONGS} from ${modulePath("src/components/common/weplay/rhythm/rhythmSongs.ts")};
import {createChart, replayRhythmPerformance, HIT_WINDOW_SECONDS} from ${modulePath("src/components/common/weplay/rhythm/rhythmCore.ts")};
import ${modulePath("src/assets/index.css")};import ${modulePath("assets/css/style.css")};
const qa=window.rhythmQA;
qa.songs=RHYTHM_SONGS;qa.chart=(song=0,difficulty='normal')=>createChart(RHYTHM_SONGS[song],difficulty);
qa.replay=replayRhythmPerformance;qa.hitWindow=HIT_WINDOW_SECONDS;
const originalTime=Object.getOwnPropertyDescriptor(RhythmAudio.prototype,'currentTime').get;
Object.defineProperty(RhythmAudio.prototype,'currentTime',{get(){
  const value=qa.time??originalTime.call(this);
  if (qa.captureStrikeTime) {qa.strikeTime=value;qa.captureStrikeTime=false;}
  return value;
}});
const originalStart=RhythmAudio.prototype.start;
RhythmAudio.prototype.start=async function(...args){qa.audio.push(this);return originalStart.apply(this,args)};
const originalHit=RhythmAudio.prototype.hit;
RhythmAudio.prototype.hit=function(kind){qa.hits.push(kind);return originalHit.call(this,kind)};
qa.audioStates=()=>qa.audio.map(player=>player.state);
const query=new URLSearchParams(location.search);
createRoot(document.getElementById('root')).render(<MemoryRouter>{query.has('rewards')?<main className='ws-page'><WeeklyRewards gameId={query.get('rewards')}/></main>:<Entry portal={query.has('teacher')?'teacher':'student'}/>}</MemoryRouter>);
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
        if (!process.argv.includes('--rewards-only')) plugin.onResolve({filter: /\/WeplayWeeklyRewards(?:\.tsx)?$/}, () => ({path:'teacher-settings',namespace:'isolated-panel'}));
        plugin.onLoad({filter: /.*/, namespace:'isolated-panel'}, () => ({contents:'export default function Panel(){return null}',loader:'js'}));
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/rhythmPublication$|(?:^|\/)AppToastProvider$|(?:^|\/)historyDictionarySession$/,
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
  .text.replace(/^@import .*;$/gm, "");
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
  args: ["--autoplay-policy=document-user-activation-required"],
});
const checks = [],
  errors = [],
  external = [],
  assets = new Set();
let activePage;
const pageFor = async (
  width = 1280, height = 900, fallback = true, hasTouch = width <= 844, deviceScaleFactor = 1,
) => {
  const page = await browser.newPage({
    viewport: { width, height },
    hasTouch,
    deviceScaleFactor,
    reducedMotion: "reduce",
  });
  activePage = page;
  page.rhythmHasTouch = hasTouch;
  page.setDefaultTimeout(15000);
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
      window.rhythmContexts = [];
      const NativeAudio = window.AudioContext;
      window.AudioContext = class extends NativeAudio {
        constructor(...args) {
          super(...args);
          window.rhythmSound.contexts++;
          window.rhythmContexts.push(this);
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
const phase = async (page, value) => {
  if (value === "ready") {
    await page
      .locator(".rhythm-game--ready, .weplay-studio-intro")
      .first()
      .waitFor();
    if (await page.locator(".weplay-studio-intro").count()) {
      const before = await readCount(page);
      if (page.viewportSize().width === 1440) {
        await page
          .locator(".weplay-studio-intro")
          .click({ position: { x: 20, y: 20 } });
        await page.waitForFunction(() => window.rhythmSound.buffers > 0);
        await shot(page, "1440x1000-opening");
      }
      await page.evaluate(() => {
        window.rhythmQA.intros = (window.rhythmQA.intros || 0) + 1;
      });
      await page.getByRole("button", { name: /건너뛰기/ }).click();
      assert.equal(
        await readCount(page),
        before,
        "intro completion adds zero reads",
      );
      await page.waitForFunction(() =>
        window.rhythmContexts.every((context) => context.state === "closed"),
      );
    }
  }
  await page.locator(`.rhythm-game--${value}`).waitFor();
};
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
    timeout: 30000,
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
const hitSpot = (page, kind, hand) =>
  page.locator(`[data-hit-kind="${kind}"][data-hand="${hand}"]`);
const spotPosition = (kind, hand) => ({
  x:
    kind === "center"
      ? hand === "left"
        ? 0.38
        : 0.62
      : hand === "left"
        ? 0.28
        : 0.72,
  y: kind === "center" ? 0.32 : 0.12,
});
const tapSpot = async (page, kind, hand, edge = false) => {
  const p = spotPosition(kind, hand);
  return tap(page, p.x + (edge ? (hand === "left" ? 0.03 : -0.03) : 0), p.y);
};
const noteKey = (note) =>
  note.kind === "center"
    ? note.hand === "left"
      ? "ArrowLeft"
      : "ArrowRight"
    : note.hand === "left"
      ? "KeyZ"
      : "KeyX";
const malletIds = (page) =>
  page
    .locator(".rhythm-mallet")
    .evaluateAll((elements) =>
      Object.fromEntries(
        elements.map((el) => [
          el.classList.contains("rhythm-mallet--left") ? "left" : "right",
          Number(el.dataset.strikeId),
        ]),
      ),
    );
const combo = (page) =>
  page
    .locator(".rhythm-combo strong")
    .evaluate((el) => Number(el.textContent.replace(/\D/g, "")));
const targetCenter = (page) =>
  page.locator(".rhythm-scorebar > div:first-child strong").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
const collectCheck = async (page, target, grade) => {
  const result = await page
    .locator(`.rhythm-collected-note--${grade}`)
    .last()
    .evaluate((el) => {
      const animation = el
        .getAnimations()
        .find((item) => item.animationName === "rhythm-collect");
      if (!animation) throw Error("Missing note collection animation");
      animation.pause();
      animation.currentTime = 600;
      const r = el.getBoundingClientRect(),
        duration = animation.effect.getTiming().duration;
      const result = {
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        duration,
        points: el.querySelector("strong").textContent,
      };
      animation.finish();
      return result;
    });
  assert(
    Math.hypot(result.x - target.x, result.y - target.y) < 1,
    `collection reaches physical score target after rotation: ${JSON.stringify({ target, result })}`,
  );
  assert.equal(result.duration, 600);
  assert.equal(
    result.points,
    grade === "perfect" ? "+1,000" : grade === "good" ? "+650" : "+300",
  );
  await page
    .locator(`.rhythm-collected-note--${grade}`)
    .waitFor({ state: "detached" });
  await page.waitForFunction(() => {
    const el = document.querySelector(".rhythm-score-arrival");
    return el && getComputedStyle(el).animationName === "rhythm-score-arrival";
  });
};
const start = async (page) => {
  await time(page, 0);
  await page.getByRole("button", { name: "연주 시작", exact: false }).click();
  await phase(page, "playing");
};
const resetToLobby = async (page) => {
  if (await page.locator(".rhythm-game--playing").count()) {
    await page.getByRole("button", { name: "일시정지", exact: true }).click();
    await phase(page, "paused");
  }
  await page.getByRole("button", { name: "곡 고르기", exact: true }).click();
  await phase(page, "ready");
};
const feedbackStyle = (page) =>
  page.locator(".rhythm-feedback").evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      font: style.fontFamily,
      size: parseFloat(style.fontSize),
      color: style.color,
    };
  });
const missCheck = async (page, label) => {
  assert.equal(
    await page.locator(".rhythm-feedback").textContent(),
    "어이쿠",
    label,
  );
  assert.equal(await combo(page), 0, `${label}: miss resets combo`);
  assert.equal(
    await page.locator(".rhythm-collected-note").count(),
    0,
    `${label}: miss creates no score flight`,
  );
  const style = await feedbackStyle(page);
  assert.match(style.font, /Dokdo/, `${label}: Korean brush judgement font`);
  const [red, green, blue] = style.color.match(/[\d.]+/g).map(Number);
  assert(
    red > green + 35 && red > blue + 35,
    `${label}: red miss text ${style.color}`,
  );
};
const localFontCheck = async (page, selector, family) => {
  const info = await page
    .locator(selector)
    .first()
    .evaluate(async (el) => {
      const style = getComputedStyle(el);
      const loaded = await document.fonts.load(
        `${style.fontSize} ${style.fontFamily}`,
        "장단 어이쿠 한 판 얼쑤",
      );
      return {
        family: style.fontFamily,
        loaded: loaded.map((face) => ({
          family: face.family,
          status: face.status,
        })),
      };
    });
  assert.match(info.family, family, `${selector}: intended Korean font`);
  assert(
    info.loaded.some(
      (face) => family.test(face.family) && face.status === "loaded",
    ),
    `${selector}: bundled font actually loads: ${JSON.stringify(info)}`,
  );
  return info;
};
const resultActionsCheck = async (page, label) => {
  const actions = await page
    .locator(".rhythm-result-actions button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return {
          label: button.textContent.trim(),
          rect: rect.toJSON(),
          viewport: { width: innerWidth, height: innerHeight },
          clickable: !!hit && button.contains(hit),
        };
      }),
    );
  assert.equal(actions.length, 2);
  for (const action of actions)
    assert(
      action.clickable &&
        action.rect.left >= -1 &&
        action.rect.top >= -1 &&
        action.rect.right <= action.viewport.width + 1 &&
        action.rect.bottom <= action.viewport.height + 1,
      `${label}: result actions fully visible after rotation: ${JSON.stringify(action)}`,
    );
};
const physicalNoteKey = (note) => {
  const code = noteKey(note);
  return code === "KeyZ" ? "z" : code === "KeyX" ? "x" : code;
};
const antiSpamCheck = async () => {
  const page = await pageFor();
  await page.goto(`${base}/?open`);
  await phase(page, "ready");
  await start(page);
  const notes = await page.evaluate(() => window.rhythmQA.chart());
  await time(page, notes[0].time);
  const wrongHand = {
    ...notes[0],
    hand: notes[0].hand === "left" ? "right" : "left",
  };
  await page.keyboard.press(physicalNoteKey(wrongHand));
  await missCheck(page, "physical wrong hand starts lock");
  await page.keyboard.press(physicalNoteKey(notes[0]));
  assert.equal(
    await score(page),
    0,
    "physical valid key during lock is blocked",
  );
  let spamEnd = notes[0].time;
  for (let index = 1; spamEnd <= notes[1].time + 0.08; index++) {
    spamEnd = notes[0].time + index * 0.08;
    await time(page, spamEnd);
    await page.keyboard.press(index % 2 ? "ArrowLeft" : "ArrowRight");
    assert.equal(
      await score(page),
      0,
      "80ms alternating physical spam never scores",
    );
    await missCheck(page, "80ms physical spam across next note");
  }
  const recoveryIndex = notes.findIndex((note) => note.time > spamEnd + 0.22);
  assert(recoveryIndex > 1, "recovery follows the spammed note");
  const recovery = notes[recoveryIndex];
  await time(page, recovery.time);
  const recoveryTarget = await targetCenter(page);
  await page.keyboard.press(physicalNoteKey(recovery));
  assert.equal(
    await score(page),
    1000,
    "stopping for 220ms restores a valid hit",
  );
  assert.equal(await combo(page), 1);
  await collectCheck(page, recoveryTarget, "perfect");
  const resumeNote = notes[recoveryIndex + 1];
  await time(page, resumeNote.time);
  await page.keyboard.press(
    physicalNoteKey({
      ...resumeNote,
      hand: resumeNote.hand === "left" ? "right" : "left",
    }),
  );
  await missCheck(page, "penalty before pause");
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  await phase(page, "paused");
  const pausedHits = await hitCount(page);
  await page.keyboard.press(physicalNoteKey(resumeNote));
  assert.equal(
    await hitCount(page),
    pausedHits,
    "paused physical input stays ignored",
  );
  await page.getByRole("button", { name: "계속 연주", exact: true }).click();
  await phase(page, "playing");
  await page.keyboard.press(physicalNoteKey(resumeNote));
  assert.equal(
    await score(page),
    2000,
    "pause/resume clears the old penalty lock",
  );
  await resetToLobby(page);
  await page.locator(".rhythm-difficulty button").nth(2).click();
  await start(page);
  const fastNotes = await page.evaluate(() => window.rhythmQA.chart(0, "hard"));
  const fastCount = 12;
  const minGap = Math.min(
    ...fastNotes
      .slice(1, fastCount)
      .map((note, index) => note.time - fastNotes[index].time),
  );
  assert(
    minGap < 0.22,
    "real hard chart includes valid hits less than 220ms apart",
  );
  for (let index = 0; index < fastCount; index++) {
    await time(page, fastNotes[index].time);
    await page.keyboard.press(physicalNoteKey(fastNotes[index]));
    assert.equal(
      await score(page),
      (index + 1) * 1000 + Math.max(0, index - 8) * 50,
      "valid fast notes retain full score",
    );
    assert.equal(await combo(page), index + 1, "valid fast notes retain combo");
  }
  const last = fastNotes[fastCount - 1];
  for (let index = 0; index < fastNotes.length; index++)
    await page.keyboard.press(physicalNoteKey(last));
  assert.equal(
    await score(page),
    fastCount * 1000 + (fastCount - 9) * 50,
    "duplicate physical taps add no points",
  );
  assert.equal(await combo(page), 0, "duplicate physical taps reset combo");
  await time(page, fastNotes.at(-1).time + 0.17);
  for (const code of ["ArrowLeft", "ArrowRight", "z", "x"])
    await page.keyboard.press(code);
  await time(
    page,
    await page.evaluate(() => window.rhythmQA.songs[0].duration + 0.1),
  );
  await phase(page, "result");
  const result = await page
    .locator(".rhythm-result dl > div")
    .evaluateAll((rows) =>
      Object.fromEntries(
        rows.map((row) => [
          row.querySelector("dt").textContent,
          row.querySelector("dd").textContent,
        ]),
      ),
    );
  assert.equal(Number(result["지화자 좋다!"]), fastCount);
  assert.equal(
    Number(result["어이쿠"]),
    fastNotes.length * 2 - fastCount,
    "every invalid active tap counts once, expired notes count once, outro taps count zero",
  );
  const expectedAccuracy = Math.round(
    (fastCount / (fastNotes.length * 2)) * 100,
  );
  assert.equal(
    result["정확도"],
    `${expectedAccuracy}%`,
    "accuracy includes all invalid judgements",
  );
  assert.notEqual(
    result["정확도"],
    `${Math.round((fastCount / fastNotes.length) * 100)}%`,
    "extra misses cannot keep the original chart-only accuracy",
  );
  await localFontCheck(page, ".rhythm-result", /Yeon Sung/);
  await resultActionsCheck(page, "physical spam");
  const gradeStyles = await page
    .locator(".rhythm-result dt[data-grade]")
    .evaluateAll((labels) =>
      Object.fromEntries(
        labels.map((label) => [
          label.dataset.grade,
          {
            font: getComputedStyle(label).fontFamily,
            size: parseFloat(getComputedStyle(label).fontSize),
          },
        ]),
      ),
    );
  for (const grade of ["perfect", "good", "ok", "miss"])
    assert.match(
      gradeStyles[grade].font,
      /Dokdo/,
      `result ${grade} uses brush lettering`,
    );
  assert(
    gradeStyles.perfect.size > gradeStyles.good.size &&
      gradeStyles.good.size > gradeStyles.ok.size,
    "result judgement labels preserve the brush size hierarchy",
  );
  await shot(page, "physical-spam-accuracy-result");
  assert.equal(
    await readCount(page),
    1,
    "spam/recovery/reset/fast chart adds zero reads",
  );
  assert.equal(await page.evaluate(() => window.rhythmQA.saves.length), 0);
  checks.push({
    antiSpam:
      "physical keys at 80ms audio-clock intervals; 220ms recovery; wrong hand lock; pause/resume; reset; real sub-220ms chart; invalid accuracy; outro ignored",
    minFastGap: minGap,
    result,
    entryReads: 1,
    gameplayReads: 0,
    gameplayWrites: 0,
    passed: true,
  });
  await page.close();
};
const startVisible = (page) =>
  page
    .getByRole("button", { name: "연주 시작", exact: false })
    .evaluate((el) => {
      const r = el.getBoundingClientRect(),
        panel = el.closest(".rhythm-song-panel").getBoundingClientRect(),
        hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        visible:
          !!hit &&
          el.contains(hit) &&
          r.left >= panel.left - 1 &&
          r.right <= panel.right + 1 &&
          r.top >= panel.top - 1 &&
          r.bottom <= panel.bottom + 1 &&
          r.left >= -1 &&
          r.top >= -1 &&
          r.right <= innerWidth + 1 &&
          r.bottom <= innerHeight + 1,
        button: r.toJSON(),
        panel: panel.toJSON(),
        viewport: { width: innerWidth, height: innerHeight },
        scrollY,
        canvas: el.closest(".rhythm-canvas").getBoundingClientRect().toJSON(),
        hit: hit?.className,
      };
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
if (process.argv.includes('--rewards-only')) {
  try {
    for (const width of [390, 768, 1280]) for (const gameId of ['history-rain','joseon-yut','gungdeok-rock']) {
      const page = await pageFor(width, 900);
      await page.goto(`${base}/?teacher&rewards=${gameId}`);
      const rewards = page.locator('.weplay-weekly-rewards');
      const summary = rewards.locator('summary');
      await summary.waitFor();
      assert.equal(await summary.getAttribute('aria-expanded'), 'false');
      assert.equal(await summary.locator('svg[aria-hidden="true"]').count(), 1);
      assert.equal(await page.evaluate(() => window.rhythmQA.rankingCalls.length), 0, 'closed rewards fetch nothing');
      await summary.click();
      assert.equal(await summary.getAttribute('aria-expanded'), 'true');
      const save = rewards.getByRole('button', {name:'보상 설정 저장'});
      await save.waitFor();
      assert.equal(await save.isDisabled(), true);
      let reads = 1;
      assert.equal(await page.evaluate(() => window.rhythmQA.rankingCalls.length), reads);
      const categories = await rewards.getByLabel('보상 랭킹').locator('option').count();
      if (categories > 1) {
        await rewards.getByLabel('보상 랭킹').selectOption({index:1});
        reads++;
        await page.waitForFunction(count => window.rhythmQA.rankingCalls.length === count, reads);
        await save.waitFor();
      }
      const previousWeek = await rewards.getByLabel('보상 주차').inputValue();
      const nextWeek = new Date(Date.parse(previousWeek+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
      await rewards.getByLabel('보상 주차').fill(nextWeek);
      reads++;
      await page.waitForFunction(count => window.rhythmQA.rankingCalls.length === count, reads);
      await rewards.getByRole('button', {name:'보상 구간 추가'}).click();
      await rewards.getByLabel('1구간 마지막 순위').fill('1');
      await rewards.getByLabel('1구간 지급 위스').fill('100');
      await rewards.getByRole('button', {name:'보상 구간 추가'}).click();
      await rewards.getByLabel('2구간 마지막 순위').fill('5');
      await rewards.getByLabel('2구간 지급 위스').fill('50');
      assert.equal(await page.evaluate(() => window.rhythmQA.rankingCalls.length), reads, 'tier drafts fetch nothing');
      await save.click();
      await page.waitForFunction(() => window.rhythmQA.toasts.length === 1);
      assert.equal(await save.isDisabled(), true);
      await rewards.getByLabel('1구간 지급 위스').fill('110');
      await page.evaluate(() => window.rhythmQA.weeklyFailure=true);
      await save.click();
      await rewards.getByText('검증용 보상 저장 실패').waitFor();
      const failed = await page.evaluate(() => window.rhythmQA.rankingCalls.at(-1).data);
      await page.evaluate(() => window.rhythmQA.weeklyFailure=false);
      await save.click();
      await page.waitForFunction(() => window.rhythmQA.toasts.length === 2);
      assert.deepEqual(await page.evaluate(() => window.rhythmQA.rankingCalls.at(-1).data), failed, 'reward save retry preserves request');
      assert.equal(await page.evaluate(() => window.rhythmQA.rankingCalls.length), reads+3);
      const layout = await rewards.evaluate(node => {
        const r=node.getBoundingClientRect();
        return {left:r.left,right:r.right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,summaryBackground:getComputedStyle(node.querySelector('summary')).backgroundColor,background:getComputedStyle(node).backgroundColor};
      });
      assert(layout.left>=0 && layout.right<=layout.width && !layout.overflow, JSON.stringify(layout));
      assert.equal(layout.summaryBackground,'rgba(0, 0, 0, 0)');
      assert.equal(layout.background,'rgba(0, 0, 0, 0)');
      await shot(page, `rewards-${gameId}-${width}`);
      checks.push({width,gameId,reads,saves:3,layout,retrySameRequest:true});
      await page.close();
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await fs.writeFile(path.join(evidence,'rewards-report.json'),JSON.stringify({checks,errors,external},null,2));
    console.log(JSON.stringify({rewardsPassed:checks.length,errors,external}));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  process.exit(0);
}
if (process.argv.includes('--settings-only')) {
  try {
    for (const width of [390, 768, 1280]) {
      const page = await pageFor(width, 900);
      await page.goto(`${base}/?teacher`);
      const settings = page.locator('.rhythm-challenge-settings');
      await settings.getByRole('button', { name: '도전 설정 저장' }).waitFor();
      const save = settings.getByRole('button', { name: '도전 설정 저장' });
      assert.equal(await save.isDisabled(), true);
      assert.equal(await page.evaluate(() => window.rhythmQA.rankingCalls.length), 1);
      assert.equal(await settings.getByRole('combobox').nth(1).isDisabled(), true);
      await settings.getByRole('combobox').nth(0).selectOption('manual');
      await settings.getByRole('combobox').nth(1).selectOption('harvest-yard');
      await settings.getByLabel('아이쿠 종료 횟수').fill('25');
      assert.equal(await page.evaluate(() => window.rhythmQA.rankingCalls.length), 1, 'draft edits have no requests');
      await save.click();
      await page.waitForFunction(() => window.rhythmQA.toasts.length === 1);
      assert.equal(await save.isDisabled(), true);
      assert.equal(await page.evaluate(() => window.rhythmQA.rankingCalls.length), 2);
      await settings.getByLabel('아이쿠 종료 횟수').fill('0');
      assert.equal(await save.isDisabled(), true);
      await settings.getByLabel('아이쿠 종료 횟수').fill('26');
      await page.evaluate(() => window.rhythmQA.settingsFailure = true);
      await save.click();
      await settings.getByText('검증용 설정 저장 실패', { exact: false }).waitFor();
      const failed = await page.evaluate(() => window.rhythmQA.rankingCalls.at(-1).data);
      await page.evaluate(() => window.rhythmQA.settingsFailure = false);
      await save.click();
      await page.waitForFunction(() => window.rhythmQA.toasts.length === 2);
      assert.deepEqual(await page.evaluate(() => window.rhythmQA.rankingCalls.at(-1).data), failed, 'retry keeps idempotency key');
      const layout = await settings.evaluate(node => {
        const r = node.getBoundingClientRect(), title = node.querySelector('h2');
        return {left:r.left,right:r.right,width:innerWidth,titleBackground:getComputedStyle(title).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      assert(layout.left >= 0 && layout.right <= layout.width && !layout.overflow);
      assert.equal(layout.titleBackground, 'rgba(0, 0, 0, 0)');
      await shot(page, `settings-${width}`);
      checks.push({width, layout, reads:1, saves:3, unchangedSaveDisabled:true, retrySameRequest:true});
      await page.close();
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await fs.writeFile(path.join(evidence, 'settings-report.json'), JSON.stringify({checks,errors,external}, null, 2));
    console.log(JSON.stringify({settingsPassed:checks.length,errors,external}));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  process.exit(0);
}
if (process.argv.includes("--lane-motion-only")) {
  try {
    const page = await pageFor(844, 390);
    await page.goto(`${base}/?open`);
    await phase(page, "ready");
    await page.getByLabel("소리·판정 시차", { exact: true }).click();
    await page.locator("#rhythm-offset").focus();
    await page.keyboard.press("Home");
    assert.equal(await page.locator("#rhythm-offset").inputValue(), "-250");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "연주 시작" }).tap();
    await phase(page, "playing");
    await page.locator("[data-note-id]").first().waitFor();
    const movement = await page.evaluate(async () => {
      // A native transform timeline should keep advancing without JS writing
      // a new position into the DOM after a busy input handler.
      const note = document.querySelector("[data-note-id]");
      const motion = note.getAnimations()[0];
      const inline = note.style.transform;
      const before = motion.currentTime;
      const start = performance.now();
      while (performance.now() - start < 90) { /* simulate one busy frame */ }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        elapsed: motion.currentTime - before,
        retained: note.getAnimations().includes(motion),
        unchanged: note.style.transform === inline,
      };
    });
    assert(movement.elapsed >= 80 && movement.retained && movement.unchanged, JSON.stringify(movement));
    await page.getByRole("button", { name: "일시정지", exact: true }).tap();
    await phase(page, "paused");
    const alignment = () => page.evaluate(() => {
      const node = document.querySelector("[data-note-id]");
      const note = window.rhythmQA.chart().find(item => item.id === node.dataset.noteId);
      const animation = node.getAnimations()[0];
      const chartTime = window.rhythmQA.audio.at(-1).currentTime + 0.25;
      const travel = animation.effect.getTiming().duration / 1000 - window.rhythmQA.hitWindow;
      return {
        playState: animation.playState, currentTime: animation.currentTime,
        errorMs: Math.abs(animation.currentTime - (chartTime - note.time + travel) * 1000),
      };
    });
    const paused = await alignment();
    await frames(page);
    assert.equal(paused.playState, "paused");
    assert.equal((await alignment()).currentTime, paused.currentTime);
    assert(paused.errorMs < 12, JSON.stringify(paused));
    await page.getByRole("button", { name: "계속 연주", exact: true }).tap();
    await phase(page, "playing");
    await frames(page);
    const resumed = await alignment();
    assert.equal(resumed.playState, "running");
    assert(resumed.errorMs < 40, JSON.stringify(resumed));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ movement, paused, resumed }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  process.exit(0);
}
if (process.argv.includes("--dense-touch-only")) {
  try {
    const [width, height] = process.argv.includes("--tablet") ? [1180, 820] : [844, 390];
    const rate = Number(process.env.RHYTHM_QA_CPU_RATE || 4);
    // Dedicated native-tempo check. Set a repeatable frame budget for the
    // device running it, e.g. RHYTHM_QA_MAX_FRAME_P95_MS=100 for 4x Chrome.
    const maxFrameP95 = Number(process.env.RHYTHM_QA_MAX_FRAME_P95_MS || 100);
    assert(Number.isFinite(maxFrameP95) && maxFrameP95 > 0, "Frame budget must be a positive millisecond value");
    const deviceScaleFactor = 2;
    const page = await pageFor(width, height, true, true, deviceScaleFactor);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`${base}/?open`);
    if (process.env.RHYTHM_QA_TAILWIND) {
      await page.addScriptTag({ path: process.env.RHYTHM_QA_TAILWIND });
    }
    await phase(page, "ready");
    await page.locator(".rhythm-difficulty button").nth(2).tap();
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate });
    await page.getByRole("button", { name: "연주 시작" }).tap();
    await phase(page, "playing");
    const measured = await page.evaluate(async () => {
      const qa = window.rhythmQA;
      const player = qa.audio.at(-1);
      const notes = qa.chart(0, "hard");
      // The hardest Arirang phrase crosses the 100-combo fever boundary.
      const startIndex = 72;
      const stopIndex = 107;
      const frameIntervals = [], inputTimes = [], timerDelays = [], nextFrames = [], allNextFrames = [];
      const touches = [];
      const controls = new Map(Array.from(document.querySelectorAll("[data-hit-kind]"),
        button => [button.dataset.hitKind + button.dataset.hand, button]));
      let previousFrame;
      let frameId;
      let changedLaneNodes = 0;
      const lane = document.querySelector(".rhythm-note-track");
      const laneChanges = new MutationObserver(records => {
        for (const record of records) changedLaneNodes += record.addedNodes.length + record.removedNodes.length;
      });
      const measureFrame = now => {
        if (previousFrame !== undefined) frameIntervals.push(now - previousFrame);
        previousFrame = now;
        frameId = requestAnimationFrame(measureFrame);
      };
      let index = 0;
      let highestFever = 0;
      let compactEffects = false;
      await new Promise(resolve => {
        const hit = () => {
          const note = notes[index];
          const remainingMs = (note.time - player.currentTime) * 1000;
          if (remainingMs > 1) {
            setTimeout(hit, remainingMs);
            return;
          }
          if (index === startIndex) {
            laneChanges.observe(lane, { childList: true });
            frameId = requestAnimationFrame(measureFrame);
          }
          const button = controls.get(note.kind + note.hand);
          const started = performance.now();
          qa.captureStrikeTime = true;
          button.dispatchEvent(new PointerEvent("pointerdown", {
            bubbles: true, cancelable: true, pointerType: "touch", button: 0,
          }));
          touches.push({ kind: note.kind, hand: note.hand, time: qa.strikeTime });
          const inPhrase = index >= startIndex;
          requestAnimationFrame(() => {
            const latency = performance.now() - started;
            allNextFrames.push(latency);
            if (inPhrase) nextFrames.push(latency);
          });
          if (inPhrase) {
            inputTimes.push(performance.now() - started);
            timerDelays.push(Math.max(0, -remainingMs));
            highestFever = Math.max(highestFever, Number(document.querySelector(".rhythm-game").dataset.fever));
            compactEffects ||= Boolean(document.querySelector("[data-compact-effects]"));
          }
          if (index++ < stopIndex) setTimeout(hit, Math.max(0, (notes[index].time - player.currentTime) * 1000));
          else requestAnimationFrame(() => requestAnimationFrame(resolve));
        };
        hit();
      });
      cancelAnimationFrame(frameId);
      laneChanges.disconnect();
      const p = (values, percentile) =>
        [...values].sort((a, b) => a - b)[Math.ceil(values.length * percentile) - 1];
      const scoreAtEnd = qa.replay(notes, touches, player.currentTime).score;
      const flights = document.querySelectorAll(".rhythm-collected-note--compact");
      const compactVisuals = flights.length === 1 && flights[0].style.visibility === "visible"
        && Boolean(document.querySelector(".rhythm-hit-pulse[data-grade]"));
      return {
        song: "arirang", difficulty: "hard", firstNote: startIndex + 1, lastNote: stopIndex + 1,
        startAudioSeconds: notes[startIndex].time, endAudioSeconds: notes[stopIndex].time,
        frames: frameIntervals.length, frameP95Ms: p(frameIntervals, 0.95),
        frameP99Ms: p(frameIntervals, 0.99), maxFrameMs: Math.max(...frameIntervals),
        framesOver40ms: frameIntervals.filter(ms => ms > 40).length,
        inputP95Ms: p(inputTimes, 0.95), inputToRafP95Ms: p(nextFrames, 0.95),
        allInputToRafP95Ms: p(allNextFrames, 0.95),
        timerDelayP95Ms: p(timerDelays, 0.95), highestFever, totalTaps: qa.hits.length,
        compactEffects, compactVisuals, changedLaneNodes,
        hasTouch: navigator.maxTouchPoints > 0,
        expectedScore: scoreAtEnd.score, successfulNotes: scoreAtEnd.perfect + scoreAtEnd.good + scoreAtEnd.ok,
        maxCombo: scoreAtEnd.maxCombo,
        rankingCalls: qa.rankingCalls.length, writes: qa.saves.length,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      };
    });
    measured.profile = { width, height, deviceScaleFactor, cpuRate: rate, maxFrameP95, tailwind: Boolean(process.env.RHYTHM_QA_TAILWIND) };
    measured.combo = await combo(page);
    measured.score = await score(page);
    console.log(JSON.stringify(measured, null, 2));
    await fs.writeFile(path.join(evidence, "dense-touch-report.json"), JSON.stringify(measured, null, 2));
    assert.equal(measured.totalTaps, measured.lastNote);
    assert(measured.frameP95Ms <= maxFrameP95, `Dense frame p95 ${measured.frameP95Ms.toFixed(1)}ms exceeds ${maxFrameP95}ms`);
    assert.equal(measured.reducedMotion, false);
    assert.equal(measured.hasTouch, true);
    if (measured.compactEffects) assert(measured.compactVisuals, "Compact strikes retain a visible score flight and a drum pulse");
    assert.equal(measured.changedLaneNodes, 0, "Dense play reuses the same note nodes");
    assert.equal(measured.score, measured.expectedScore, "Native-tempo touches match the server's scoring at their actual audio deadlines");
    assert.equal(measured.rankingCalls + measured.writes, 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  process.exit(0);
}
if (process.argv.includes("--performance-only")) {
  try {
    const page = await pageFor();
    await page.goto(`${base}/?open`);
    await phase(page, "ready");
    await page.locator(".rhythm-song").nth(1).click();
    await page.locator(".rhythm-difficulty button").nth(2).click();
    await start(page);
    const session = await page.context().newCDPSession(page);
    await session.send("Performance.enable");
    const before = await session.send("Performance.getMetrics");
    const result = await page.evaluate(async () => {
      const qa = window.rhythmQA;
      const notes = qa.chart(1, "hard").slice(0, 120);
      const intervals = [], inputTimes = [];
      let previousFrame = performance.now();
      const frame = () => new Promise(resolve => requestAnimationFrame(now => {
        intervals.push(now - previousFrame);
        previousFrame = now;
        resolve();
      }));
      let expectedScore = 0;
      let chartTime = notes[0].time - 0.25;
      for (const [index, note] of notes.entries()) {
        // Advance every frame so the benchmark includes moving notes between
        // hits, as a real AudioContext does. Frozen timestamps hide rerenders.
        const from = chartTime;
        const steps = Math.max(1, Math.ceil((note.time - from) * 60));
        for (let step = 1; step <= steps; step++) {
          chartTime = from + ((note.time - from) * step) / steps;
          qa.time = chartTime;
          await frame();
        }
        const code = note.kind === "center"
          ? note.hand === "left" ? "ArrowLeft" : "ArrowRight"
          : note.hand === "left" ? "KeyZ" : "KeyX";
        const started = performance.now();
        window.dispatchEvent(new KeyboardEvent("keydown", {
          code, key: code, bubbles: true, cancelable: true,
        }));
        window.dispatchEvent(new KeyboardEvent("keyup", {
          code, key: code, bubbles: true,
        }));
        inputTimes.push(performance.now() - started);
        const hit = index + 1;
        expectedScore += hit >= 100 ? 1500 : hit >= 50 ? 1250 : hit >= 20 ? 1100 : hit >= 10 ? 1050 : 1000;
        await frame();
      }
      const percentile = values => [...values].sort((a,b) => a-b)[Math.floor(values.length * .95)];
      return {
        hits: notes.length, expectedScore,
        inputP95Ms: percentile(inputTimes), frameP95Ms: percentile(intervals.slice(2)),
        frames: intervals.length,
        minChartGapSeconds: Math.min(...notes.slice(1).map((note,index) => note.time-notes[index].time)),
        rankingCalls: qa.rankingCalls.length, saves: qa.saves.length,
      };
    });
    const after = await session.send("Performance.getMetrics");
    const metric = (values,name) => values.metrics.find(item => item.name === name)?.value ?? 0;
    for (const name of ["LayoutCount", "RecalcStyleCount", "LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration"])
      result[name] = metric(after,name)-metric(before,name);
    assert(result.LayoutCount < result.frames * 0.75,
      `Moving notes must avoid per-frame layout: ${result.LayoutCount} layouts / ${result.frames} frames`);
    assert.equal(await score(page), result.expectedScore, "Dense valid inputs preserve every fever-adjusted point");
    assert.equal(await combo(page), result.hits, "Dense valid inputs preserve the full combo");
    assert.equal(result.rankingCalls, 0, "Dense practice inputs send no ranking requests");
    assert.equal(result.saves, 0, "Dense practice inputs write no publication state");
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await fs.writeFile(path.join(evidence, "performance-report.json"), JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  process.exit(0);
}
try {
  // Real Web Audio output after touch/click, including an old shared mute and
  // a browser/device interruption. Synthetic services never write student data.
  for (const [width, height] of [[844, 390], [1280, 900]]) {
    const soundPage = await pageFor(width, height);
    await soundPage.addInitScript(() => localStorage.setItem("westory.weplay.musicMuted", "true"));
    await soundPage.goto(`${base}/?open`);
    await phase(soundPage, "ready");
    assert.equal(await soundPage.getByRole("button", {name:"소리 끄기",exact:true}).count(), 1,
      "Other games' saved mute must not silence a new rhythm session");
    const activate = locator => width <= 844 ? locator.tap() : locator.click();
    await activate(soundPage.getByRole("button", {name:"연주 시작",exact:false}));
    await phase(soundPage, "playing");
    const energy = () => soundPage.evaluate(async () => {
      const player = window.rhythmQA.audio.at(-1);
      const analyser = player.context.createAnalyser();
      player.compressor.connect(analyser);
      const values = new Float32Array(analyser.fftSize);
      const startTime = player.context.currentTime;
      let maximum = 0;
      // The device can start its audio clock after the UI is already playing.
      // Sample through a real count-in beat, with a wall-clock bound for failure.
      const audioDeadline = Math.max(player.origin, startTime) + 1.4;
      const wallDeadline = performance.now() + 10000;
      while (maximum <= 0.001 && player.context.currentTime < audioDeadline && performance.now() < wallDeadline) {
        analyser.getFloatTimeDomainData(values);
        maximum = Math.max(maximum, ...values.map(Math.abs));
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      player.compressor.disconnect(analyser);
      return {maximum, state:player.state, volume:player.master.gain.value, startTime, endTime:player.context.currentTime, origin:player.origin, sources:player.sources.size};
    });
    const initial = await energy();
    assert.equal(initial.state, "running");
    assert(initial.maximum > 0.001 && initial.volume > 0, `Started song emits an audible signal: ${JSON.stringify(initial)}`);
    const reads = await readCount(soundPage);
    await soundPage.evaluate(() => window.rhythmQA.audio.at(-1).pause());
    await phase(soundPage, "paused");
    await activate(soundPage.getByRole("button", {name:"계속 연주",exact:true}));
    await phase(soundPage, "playing");
    const resumed = await energy();
    assert.equal(resumed.state, "running");
    assert(resumed.maximum > 0.001, "Continue restores actual audio output after interruption");
    await activate(soundPage.getByRole("button", {name:"소리 끄기",exact:true}));
    await soundPage.waitForFunction(() => window.rhythmQA.audio.at(-1).master.gain.value < 0.001);
    await activate(soundPage.getByRole("button", {name:"소리 켜기",exact:true}));
    const unmuted = await energy();
    assert(unmuted.maximum > 0.001 && unmuted.volume > 0, "Unmute restores the output signal");
    assert.equal(await readCount(soundPage), reads, "Audio controls make no additional server reads");
    assert.equal(await soundPage.evaluate(() => localStorage.getItem("westory.weplay.musicMuted")), "true",
      "Rhythm controls preserve other games' music preference");
    checks.push({audioRecovery:{width,height,initial,resumed,unmuted},additionalReads:0});
    await soundPage.close();
  }
  if (process.argv.includes("--audio-only")) {
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await fs.writeFile(path.join(evidence,"audio-recovery-report.json"),JSON.stringify({checks,errors,external},null,2));
    console.log(JSON.stringify({audioRecoveryPassed:checks.length,errors,external}));
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    process.exit(0);
  }
  const challengePage = await pageFor();
  await challengePage.goto(`${base}/?open`);
  await phase(challengePage, "ready");
  assert.equal(await challengePage.locator('.rhythm-mode-options [aria-pressed="true"]').textContent(), "연습");
  await challengePage.locator('.rhythm-song').nth(1).click();
  await start(challengePage);
  const feverNotes = await challengePage.evaluate(() => window.rhythmQA.chart(1, "normal"));
  let expectedFeverScore = 0;
  for (let index = 0; index < 100; index++) {
    await time(challengePage, feverNotes[index].time);
    await challengePage.keyboard.press(physicalNoteKey(feverNotes[index]));
    const hit = index + 1;
    expectedFeverScore += hit >= 100 ? 1500 : hit >= 50 ? 1250 : hit >= 20 ? 1100 : hit >= 10 ? 1050 : 1000;
    if ([10, 20, 50, 100].includes(hit)) {
      assert.equal(await score(challengePage), expectedFeverScore);
      assert.equal(await challengePage.locator('.rhythm-game').getAttribute('data-fever'), String([10, 20, 50, 100].indexOf(hit) + 1));
      assert.equal(await challengePage.locator('.rhythm-fever-aura').count(), 2);
      await shot(challengePage, `fever-${hit}`);
    }
  }
  assert.equal(expectedFeverScore, 116500);
  await challengePage.keyboard.press(physicalNoteKey(feverNotes[99]));
  assert.equal(await challengePage.locator('.rhythm-game').getAttribute('data-fever'), '0');
  assert.equal(await challengePage.locator('.rhythm-fever-aura').count(), 0);
  assert.equal(await challengePage.evaluate(() => window.rhythmQA.rankingCalls.length), 0, 'practice has zero ranking network requests');
  await resetToLobby(challengePage);
  await challengePage.getByRole('button', { name: '도전', exact: true }).click();
  await challengePage.locator('.rhythm-game[data-mode="challenge"]').waitFor();
  assert.equal(await challengePage.locator('.rhythm-song').count(), 1);
  assert.equal(await challengePage.locator('.rhythm-difficulty button').count(), 2);
  await time(challengePage, 0);
  await challengePage.getByRole('button', { name: '도전 시작', exact: true }).click();
  await phase(challengePage, 'playing');
  // A challenge has no pause: every former pause path leaves the song running.
  assert.equal(await challengePage.getByRole('button', { name: '일시정지', exact: true }).count(), 0, 'challenge shows no pause button');
  assert.equal(await challengePage.locator('.weplay-ranking-launch').isDisabled(), true, 'ranking cannot cover a running challenge');
  await challengePage.keyboard.press('Escape');
  await challengePage.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.rhythmQA.visibility(false);
  });
  await frames(challengePage);
  assert.equal(await challengePage.locator('.rhythm-game--playing').count(), 1, 'Escape, blur and a hidden tab do not pause a challenge');
  assert.equal(await challengePage.evaluate(() => window.rhythmQA.audioStates().at(-1)), 'running', 'challenge song keeps real time while hidden');
  await challengePage.evaluate(() => window.rhythmQA.visibility(true));
  await challengePage.getByRole('button', { name: '전체 화면', exact: true }).click();
  await challengePage.locator('.rhythm-game--fullscreen').waitFor();
  await challengePage.getByRole('button', { name: '전체 화면 나가기', exact: true }).click();
  await challengePage.locator('.rhythm-game--fullscreen').waitFor({ state: 'detached' });
  assert.equal(await challengePage.locator('.rhythm-game--playing').count(), 1, 'screen changes do not pause a challenge');
  // The browser, not the player, holds the sound: continue without a pause screen.
  await challengePage.evaluate(() => window.rhythmQA.audio.at(-1).pause());
  await challengePage.waitForFunction(() => window.rhythmQA.audioStates().at(-1) === 'running');
  assert.equal(await challengePage.locator('.rhythm-game--playing').count(), 1, 'an interrupted challenge continues by itself');
  await challengePage.evaluate(async () => {
    const player = window.rhythmQA.audio.at(-1);
    player.context.nativeResume = player.context.resume;
    player.context.resume = () => Promise.reject(new Error('QA sound still held'));
    await player.pause();
  });
  await phase(challengePage, 'paused');
  assert.equal(await challengePage.locator('.rhythm-pause-timer').count(), 0, 'a held challenge has no countdown');
  assert.match(await challengePage.locator('.rhythm-error').textContent(), /계속 연주/);
  await challengePage.evaluate(() => {
    const context = window.rhythmQA.audio.at(-1).context;
    context.resume = context.nativeResume;
  });
  await challengePage.getByRole('button', { name: '계속 연주', exact: true }).click();
  await phase(challengePage, 'playing');
  assert.equal(await challengePage.locator('.rhythm-error').count(), 0);
  assert.equal(await challengePage.evaluate(() => window.rhythmQA.rankingCalls.filter(call => call.name === 'finishRhythmRankingGame').length), 0, 'no pause path ends or saves the challenge');
  const challengeNote = feverNotes[0];
  await time(challengePage, challengeNote.time);
  await challengePage.evaluate(() => window.rhythmQA.finishFailure = true);
  const wrongKey = challengeNote.kind === 'center' ? 'x' : 'ArrowRight';
  for (let count = 0; count < 30; count++) await challengePage.keyboard.press(wrongKey);
  await phase(challengePage, 'result');
  assert.equal(await challengePage.locator('.rhythm-result h2').textContent(), '도전 종료');
  await challengePage.getByRole('button', { name: '기록 다시 저장' }).waitFor();
  let calls = await challengePage.evaluate(() => window.rhythmQA.rankingCalls);
  assert.equal(calls.filter(call => call.name === 'getRhythmChallengeState').length, 1);
  assert.equal(calls.filter(call => call.name === 'startRhythmRankingGame').length, 1);
  assert.equal(calls.filter(call => call.name === 'finishRhythmRankingGame').length, 1);
  const finishRequest = calls.find(call => call.name === 'finishRhythmRankingGame').data;
  assert.equal(finishRequest.events.length, 30);
  assert.equal(calls.find(call => call.name === 'startRhythmRankingGame').data.paid, false);
  await challengePage.evaluate(() => window.rhythmQA.finishFailure = false);
  await challengePage.getByRole('button', { name: '기록 다시 저장' }).click();
  await frames(challengePage);
  calls = await challengePage.evaluate(() => window.rhythmQA.rankingCalls);
  assert.deepEqual(calls.filter(call => call.name === 'finishRhythmRankingGame').at(-1).data, finishRequest, 'finish retries preserve the same events and endTime');
  await resetToLobby(challengePage);
  await challengePage.evaluate(() => window.rhythmQA.challenge.freeRemaining = 0);
  await challengePage.getByRole('button', { name: '도전', exact: true }).click();
  await challengePage.getByRole('button', { name: '50위스로 도전', exact: true }).waitFor();
  await time(challengePage, 0);
  await challengePage.getByRole('button', { name: '50위스로 도전', exact: true }).click();
  await phase(challengePage, 'playing');
  calls = await challengePage.evaluate(() => window.rhythmQA.rankingCalls);
  assert.equal(calls.filter(call => call.name === 'startRhythmRankingGame').at(-1).data.paid, true);
  await time(challengePage, feverNotes[29].time + .17);
  await phase(challengePage, 'result');
  await shot(challengePage, 'challenge-limit');
  checks.push({ name: 'fever and challenge', fever: [10, 20, 50, 100], score: expectedFeverScore, practiceRequests: 0, challengeStateRequests: 2, challengeStarts: 2, limit: 30, retrySameRequest: true, paidExplicit: true });
  await challengePage.close();
  // Practice: a pause shows its remaining seconds and ends by itself after 10 s.
  const pausePage = await pageFor();
  await pausePage.goto(`${base}/?open`);
  await phase(pausePage, 'ready');
  await pausePage.getByRole('button', { name: '연주 시작', exact: false }).click();
  await phase(pausePage, 'playing');
  const pauseSeconds = () => pausePage.locator('.rhythm-pause-timer strong').evaluate(el => Number(el.textContent));
  const audioClock = () => pausePage.evaluate(() => window.rhythmQA.audio.at(-1).currentTime);
  await pausePage.locator('.weplay-ranking-launch').click();
  await phase(pausePage, 'paused');
  assert.equal(await pauseSeconds(), 10);
  await pausePage.waitForTimeout(1600);
  assert.equal(await pauseSeconds(), 10, 'an open ranking holds the pause limit');
  await pausePage.keyboard.press('Escape');
  await pausePage.getByRole('button', { name: '계속 연주', exact: true }).click();
  await phase(pausePage, 'playing');
  await pausePage.keyboard.press('Escape');
  await phase(pausePage, 'paused');
  const pausedAt = Date.now(), pausedClock = await audioClock();
  assert.equal(await pauseSeconds(), 10, 'every pause starts a full limit');
  await pausePage.waitForFunction(() => Number(document.querySelector('.rhythm-pause-timer strong')?.textContent) <= 8);
  await pausePage.evaluate(() => window.rhythmQA.visibility(false));
  const heldSeconds = await pauseSeconds();
  await pausePage.waitForTimeout(1600);
  assert.equal(await pauseSeconds(), heldSeconds, 'hidden seconds do not count and never restart the sound');
  assert.equal(await pausePage.evaluate(() => window.rhythmQA.audioStates().at(-1)), 'suspended');
  await pausePage.evaluate(() => window.rhythmQA.visibility(true));
  await shot(pausePage, 'pause-limit');
  await phase(pausePage, 'playing');
  const pausedFor = Date.now() - pausedAt;
  assert(pausedFor >= 10000 && pausedFor < 14500, `practice pause ends by itself: ${pausedFor}ms`);
  assert(Math.abs(await audioClock() - pausedClock) < 0.5, 'the pause limit continues from the paused audio position');
  assert.equal(await pausePage.evaluate(() => window.rhythmQA.audioStates().at(-1)), 'running');
  checks.push({ name: 'pause rules', challenge: 'no pause by button, Escape, blur, hidden tab, fullscreen or ranking; held sound continues', practiceLimitSeconds: 10, pausedForMs: pausedFor, heldWhileHiddenOrRanking: true });
  await pausePage.close();
  await antiSpamCheck();
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
    await localFontCheck(page, ".rhythm-song-panel", /Yeon Sung/);
    const rankingLauncher = page.getByRole("button", { name: "랭킹", exact: true });
    await rankingLauncher.click();
    await page.getByText("이번 주 기록이 없습니다.").waitFor();
    const rankingBounds = await page.locator('.weplay-ranking-dialog').boundingBox();
    assert(rankingBounds && rankingBounds.x >= 0 && rankingBounds.y >= 0 && rankingBounds.x + rankingBounds.width <= width + 1 && rankingBounds.y + rankingBounds.height <= height + 1, `${label}: ranking remains inside rotated/native game`);
    await shot(page, `${label}-ranking`);
    await page.getByRole('button', { name: '랭킹 닫기' }).click();
    assert.equal(await page.evaluate(() => window.rhythmQA.rankingCalls.filter(call => call.name === 'getWeplayRanking').length), 1);
    await rankingLauncher.click();
    await page.getByText('이번 주 기록이 없습니다.').waitFor();
    assert.equal(await page.evaluate(() => window.rhythmQA.rankingCalls.filter(call => call.name === 'getWeplayRanking').length), 1, 'reopen reuses ranking');
    await page.keyboard.press('Escape');
    if (portrait) assert.equal(await page.locator('.rhythm-game--rotated').count(), 1, 'ranking Escape preserves fullscreen');
    await shot(page, `${label}-lobby`);
    await helpCheck(page, label);
    assert.equal(await page.locator(".rhythm-song").count(), 4);
    assert.deepEqual(await page.locator(".rhythm-song").allTextContents(), [
      "아리랑",
      "얼쑤, 달려라",
      "풍년 마당",
      "우리의 강산",
    ]);
    assert.deepEqual(
      await page.locator(".rhythm-difficulty button").allTextContents(),
      ["중모리 장단", "자진모리 장단", "휘모리 장단"],
    );
    for (let difficulty = 0; difficulty < 3; difficulty++) {
      await page.locator(".rhythm-difficulty button").nth(difficulty).click();
      const styles = await page
        .locator(".rhythm-difficulty button")
        .evaluateAll((buttons) =>
          buttons.map((button) => ({
            selected: button.getAttribute("aria-pressed") === "true",
            filter: getComputedStyle(button).filter,
          })),
        );
      assert.equal(styles.filter((item) => item.selected).length, 1);
      assert(styles[difficulty].selected, "clicked jangdan is selected");
      for (const item of styles)
        assert.equal(
          item.filter.includes("grayscale(1)"),
          !item.selected,
          `${label}: all three jangdan use selected color and grey alternatives`,
        );
    }
    await page.locator(".rhythm-difficulty button").nth(1).click();
    const lobbyStyles = await page
      .locator(".rhythm-song-panel")
      .evaluate((el) => {
        const button = el.querySelector(".rhythm-start-button");
        const short =
          document.querySelector(".rhythm-canvas").clientHeight <= 540;
        return {
          short,
          titleSize: parseFloat(
            getComputedStyle(el.querySelector(".rhythm-song-name strong"))
              .fontSize,
          ),
          startHeight: button.offsetHeight,
          startWidth: button.offsetWidth,
          rowWidth: el.querySelector(".rhythm-start-row").clientWidth,
        };
      });
    assert(
      lobbyStyles.titleSize >= (lobbyStyles.short ? 18 : 26),
      `${label} enlarged song titles`,
    );
    assert(
      lobbyStyles.startHeight >= (lobbyStyles.short ? 64 : 92),
      `${label} prominent start height`,
    );
    assert(
      Math.abs(lobbyStyles.startWidth - lobbyStyles.rowWidth) < 2,
      `${label} full width start`,
    );
    assert.equal(
      await page.locator(".rhythm-brand").getAttribute("alt"),
      "덩기덕 쿵더락",
    );
    for (let songIndex = 0; songIndex < 4; songIndex++) {
      const choice = page.locator(".rhythm-song").nth(songIndex);
      assert(await choice.isEnabled(), "Grey song remains selectable");
      await choice.click();
      assert.equal(await choice.getAttribute("aria-pressed"), "true");
      assert.equal(
        await page
          .locator('.rhythm-song[aria-pressed="true"] .rhythm-song-check')
          .count(),
        1,
      );
      const filters = await page
        .locator(".rhythm-song")
        .evaluateAll((elements) =>
          elements.map((el) => ({
            selected: el.getAttribute("aria-pressed") === "true",
            filter: getComputedStyle(el).filter,
          })),
        );
      for (const item of filters)
        assert.equal(
          item.filter.includes("grayscale(1)"),
          !item.selected,
          "Color selection and grey alternatives",
        );
    }
    const firstSong = page.locator(".rhythm-song").first();
    const firstSongBox = await firstSong.boundingBox();
    assert(
      firstSongBox &&
        firstSongBox.x >= 0 &&
        firstSongBox.y >= 0 &&
        firstSongBox.x + firstSongBox.width <= width &&
        firstSongBox.y + firstSongBox.height <= height,
      "first song is already visible before returning to it",
    );
    // A real pointer preserves the visible stage; locator.click may scroll this
    // already-visible transformed button and move the whole short landscape page.
    const firstSongPoint = {
      x: firstSongBox.x + firstSongBox.width / 2,
      y: firstSongBox.y + firstSongBox.height / 2,
    };
    if (page.rhythmHasTouch)
      await page.touchscreen.tap(firstSongPoint.x, firstSongPoint.y);
    else await page.mouse.click(firstSongPoint.x, firstSongPoint.y);
    assert.equal(await firstSong.getAttribute("aria-pressed"), "true");
    await shot(page, `${label}-lobby`);
    const startPlacement = await startVisible(page);
    assert(
      startPlacement.visible,
      `${label} start button visible without scrolling: ${JSON.stringify(startPlacement)}`,
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
    await rankingLauncher.click();
    await phase(page, 'paused');
    await page.getByText('이번 주 기록이 없습니다.').waitFor();
    const hitsBeforeRankingKey = await hitCount(page);
    await page.getByLabel('랭킹 장단', { exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await hitCount(page), hitsBeforeRankingKey, 'ranking keys do not hit drum');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '계속 연주' }).click();
    await phase(page, 'playing');
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
    assert.equal(
      await page.locator(".rhythm-hit-spot").count(),
      4,
      "four distinct hand/surface controls",
    );
    await hitSpot(page, "rim", "left").focus();
    for (const [kind, hand] of [
      ["rim", "right"],
      ["center", "left"],
      ["center", "right"],
    ]) {
      await page.keyboard.press("Tab");
      assert.equal(
        await hitSpot(page, kind, hand).evaluate(
          (el) => el === document.activeElement,
        ),
        true,
        `Tab reaches ${hand} ${kind}`,
      );
      assert.deepEqual(
        await focusGeometry(),
        beforeFocus,
        "drum geometry remains fixed after keyboard focus",
      );
    }
    const activationStart = await hitCount(page);
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    assert.equal(
      await hitCount(page),
      activationStart + 1,
      "Enter repeat causes one accessible hit",
    );
    await page.keyboard.down("Space");
    await page.keyboard.down("Space");
    await page.keyboard.up("Space");
    assert.equal(
      await hitCount(page),
      activationStart + 2,
      "Space repeat causes one accessible hit",
    );
    await page.locator(".rhythm-game").focus();
    for (const [code, kind, hand] of [
      ["ArrowLeft", "center", "left"],
      ["ArrowRight", "center", "right"],
      ["KeyZ", "rim", "left"],
      ["KeyX", "rim", "right"],
    ]) {
      const beforeIds = await malletIds(page),
        beforeHits = await hitCount(page);
      await key(page, code);
      const afterIds = await malletIds(page);
      assert(
        afterIds[hand] > beforeIds[hand],
        `${code} animates ${hand} mallet`,
      );
      const other = hand === "left" ? "right" : "left";
      assert.equal(
        afterIds[other],
        beforeIds[other],
        "opposite mallet remains independent",
      );
      assert.equal(await hitCount(page), beforeHits + 1);
      assert.equal(
        await page.evaluate(() => window.rhythmQA.hits.at(-1)),
        kind,
      );
    }
    await page.evaluate(() => {
      window.rhythmQA.leftMallet = document.querySelector(
        ".rhythm-mallet--left",
      );
      window.rhythmQA.rightMallet = document.querySelector(
        ".rhythm-mallet--right",
      );
    });
    await key(page, "ArrowLeft");
    assert(
      await page.evaluate(
        () =>
          window.rhythmQA.leftMallet ===
            document.querySelector(".rhythm-mallet--left") &&
          window.rhythmQA.rightMallet ===
            document.querySelector(".rhythm-mallet--right"),
      ),
      "repeated strikes reuse both illustrated mallets",
    );
    for (const kind of ["center", "rim"])
      for (const hand of ["left", "right"]) {
        for (const edge of [false, true]) {
          const before = await hitCount(page),
            ids = await malletIds(page);
          await tapSpot(page, kind, hand, edge);
          assert.equal(
            await hitCount(page),
            before + 1,
            `${hand} ${kind} ${edge ? "edge" : "center"} touch registers exactly once`,
          );
          assert.equal(
            await page.evaluate(() => window.rhythmQA.hits.at(-1)),
            kind,
          );
          const after = await malletIds(page);
          assert(after[hand] > ids[hand]);
          assert.equal(
            after[hand === "left" ? "right" : "left"],
            ids[hand === "left" ? "right" : "left"],
          );
          assert(
            await page
              .locator(`.rhythm-mallet--${hand}`)
              .evaluate((el, kind) => el.getAnimations().some(animation =>
                animation.id === `rhythm-mallet-${kind}`), kind),
            `${hand} mallet plays the ${kind} strike`,
          );
        }
      }
    const notes = await page.evaluate(() => window.rhythmQA.chart());
    assert.equal(await score(page), 0, "count-in practice hits add no score");
    assert.equal(await combo(page), 0, "count-in practice hits add no combo");
    assert.equal(
      await page.locator('.rhythm-feedback[data-grade="miss"]').count(),
      0,
      "count-in practice hits add no miss",
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".rhythm-hit-effect").length === 0,
    );
    // Physical pointer positions are transformed by the actual DOM and game inverse.
    const first = notes[0];
    await time(page, first.time);
    await page.getByRole("button", { name: "일시정지", exact: true }).click();
    await phase(page, "paused");
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
    await page.getByRole("button", { name: "계속 연주", exact: true }).click();
    await phase(page, "playing");
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
    await tapSpot(page, wrong, first.hand);
    assert.equal(await score(page), 0, "wrong surface cannot score");
    await missCheck(page, "wrong surface");
    await tapSpot(page, first.kind, first.hand === "left" ? "right" : "left");
    assert.equal(
      await score(page),
      0,
      "correct surface with wrong hand cannot score",
    );
    await missCheck(page, "wrong hand during lock");
    await tapSpot(page, first.kind, first.hand);
    assert.equal(
      await score(page),
      0,
      "valid touch within penalty lock cannot score",
    );
    await missCheck(page, "valid touch during lock");
    await resetToLobby(page);
    await start(page);
    await time(page, first.time);
    const firstTarget = await targetCenter(page);
    const correctPoint = await tapSpot(page, first.kind, first.hand);
    assert.equal(
      await score(page),
      1000,
      "perfect transformed matching-hand touch",
    );
    assert.equal(
      await page.locator(".rhythm-feedback").textContent(),
      "지화자 좋다!+1,000",
    );
    const perfectStyle = await feedbackStyle(page);
    assert.match(perfectStyle.font, /Dokdo/);
    await localFontCheck(page, ".rhythm-feedback", /Dokdo/);
    assert.equal(
      await page.locator(".rhythm-hit-effect--perfect .rhythm-sparks").getAttribute("data-sparks"),
      "12",
    );
    assert.equal(
      await page
        .locator(".rhythm-hit-effect--perfect .rhythm-shockwave")
        .count(),
      2,
    );
    assert.equal(
      await page.locator(".rhythm-collected-note--perfect").count(),
      1,
      "one scored note creates one score flight",
    );
    await page.locator(".rhythm-collected-note--perfect").evaluate((el) => {
      const animation = el.getAnimations()[0];
      animation.pause();
      animation.currentTime = 200;
    });
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
    await collectCheck(page, firstTarget, "perfect");
    const second = notes[1];
    await time(page, second.time + 0.1);
    const secondTarget = await targetCenter(page),
      repeatBefore = await hitCount(page);
    await key(page, noteKey(second), true);
    assert.equal(await hitCount(page), repeatBefore, "repeat key suppressed");
    await key(page, noteKey(second));
    assert.equal(await score(page), 1650, "great hit adds exactly 650");
    assert.equal(
      await page.locator(".rhythm-feedback").textContent(),
      "얼씨구+650",
    );
    const goodStyle = await feedbackStyle(page);
    assert.match(goodStyle.font, /Dokdo/);
    assert.equal(
      await page.locator(".rhythm-hit-effect--good .rhythm-sparks").getAttribute("data-sparks"),
      "6",
    );
    await collectCheck(page, secondTarget, "good");
    const third = notes[2];
    await time(page, third.time + 0.15);
    const thirdTarget = await targetCenter(page);
    await tapSpot(page, third.kind, third.hand, true);
    assert.equal(await score(page), 1950, "good hit adds exactly 300");
    assert.equal(
      await page.locator(".rhythm-feedback").textContent(),
      "좋다+300",
    );
    const okStyle = await feedbackStyle(page);
    assert.match(okStyle.font, /Dokdo/);
    assert(
      perfectStyle.size > goodStyle.size && goodStyle.size > okStyle.size,
      `${label}: perfect > good > ok brush size: ${JSON.stringify({ perfectStyle, goodStyle, okStyle })}`,
    );
    assert.equal(
      await page.locator(".rhythm-hit-effect--ok .rhythm-sparks").getAttribute("data-sparks"),
      "3",
    );
    assert.equal(await combo(page), 3);
    await collectCheck(page, thirdTarget, "ok");
    const thirdHits = await hitCount(page);
    await tapSpot(page, third.kind, third.hand);
    assert.equal(await score(page), 1950, "same note never scores twice");
    assert.equal(
      await hitCount(page),
      thirdHits + 1,
      "one touch emits one strike",
    );
    await missCheck(page, "duplicate touch");
    await time(page, notes[3].time + 0.161);
    assert.equal(await score(page), 1950, "miss adds zero points");
    assert.equal(await combo(page), 0, "miss resets combo");
    assert.equal(
      await page.locator(".rhythm-feedback").textContent(),
      "어이쿠",
    );
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
      1950,
    );
    assert.equal(
      await page
        .locator(".rhythm-result h2")
        .evaluate((el) => el === document.activeElement),
      true,
      "result focus",
    );
    await imageCheck(page);
    await localFontCheck(page, ".rhythm-result", /Yeon Sung/);
    await resultActionsCheck(page, label);
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
      introSeen: await page.evaluate(() => window.rhythmQA.intros || 0),
      handAndJudgementChecks:
        "four spot centers/edges; wrong hand/type and lock miss; clean reset; three grades; success-only score flight and arrival; independent mallets",
      typography:
        "local Yeon Sung/Dokdo loaded; perfect > good > ok; red 어이쿠",
      jangdan:
        "all three actual choices show selected color and grey alternatives",
      resultActions:
        "both buttons fit inside the physical viewport after rotation",
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
    "title-logo",
    "start-plaque",
    "mallet-left",
    "mallet-right",
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
