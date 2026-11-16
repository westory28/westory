/** Real ranking component and cache; synthetic auth/callable boundary, no live writes. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const root = process.cwd();
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
const evidence = path.join(
  root,
  "output/weplay-ranking-weekly-browser-20261116",
);
await fs.mkdir(evidence, { recursive: true });
const fixture = `
import {useSyncExternalStore} from 'react';
const listeners=new Set();
const teacher=new URLSearchParams(location.search).has('teacher');
const qa=window.rankingQA={calls:[],hold:false,pending:[],fail:false,offset:0,auth:{config:{year:'2026',semester:'2'},currentUser:{uid:teacher?'teacher-a':'student-a'},userData:{role:teacher?'teacher':'student',grade:'3',class:'1',enrollmentStatus:'active',registrationApprovalStatus:'APPROVED'},authGeneration:1,authPhase:'ready'}};
const dateNow=Date.now;Date.now=()=>dateNow()+qa.offset;
qa.update=value=>{qa.auth={...qa.auth,...value};listeners.forEach(fn=>fn())};
export const useAuth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>qa.auth);
export const getHistoryDictionaryCallable=async name=>async data=>{
 qa.calls.push({name,data,uid:qa.auth.currentUser.uid});
 const classId=data.classId||'3_1';
 const period=window.rankingQA.service.getWeplayRankingWeek();
 const value={gameId:data.gameId,category:data.category,view:data.view,period,rows:Array.from({length:qa.empty?0:18},(_,i)=>({rank:i+1,classLabel:classId==='3_1'?'3학년 1반':'3학년 2반',studentLabel:classId==='3_2'?'박*생':(qa.auth.currentUser.uid==='student-b'?'이*생':'김*생'),score:1800-i*50,isMe:!teacher&&i===3})),updatedAtMs:Date.now(),scoreLabel:'점',selectedClassId:data.classId||'',...(data.includeClasses?{classes:[{id:'3_1',label:'3학년 1반'},{id:'3_2',label:'3학년 2반'}]}:{})};
 if(qa.hold)await new Promise(resolve=>qa.pending.push(resolve));
 if(qa.fail)throw new Error('Synthetic network failure');
 return {data:value};
};
export const YUT_PRIVATE_DAILY_LIMIT=5;
export const normalizeYutSettings=value=>({enabled:true,version:1,allowSolo:true,allowMultiplayer:true,allowPrivateRooms:true,defaultPlayerCount:4,throwSeconds:5,moveSeconds:25,...value});
export const getYutLobby=async()=>({enabled:true,settings:normalizeYutSettings(),room:null,classes:[],classId:'3_1',serverNowMs:Date.now(),playerName:'검증 학생'});
export const commandYutRoom=async()=>{throw new Error('No online commands in visual QA')};
export const subscribeYutRoom=()=>()=>{};
export const yutErrorMessage=error=>error.message;
`;
const harness = `
import React,{StrictMode,useState} from 'react';import{createRoot}from'react-dom/client';
import Ranking from './src/components/common/weplay/WeplayRanking';
import * as service from './src/lib/weplayRanking';
import Naval from './src/components/common/weplay/HistoryRainGame';
import Yut from './src/components/common/weplay/yut/YutGame';
import Rhythm from './src/components/common/weplay/rhythm/RhythmGame';
import {RhythmAudio} from './src/components/common/weplay/rhythm/rhythmAudio';
import Frame from './src/components/common/weplay/WeplayGameFrame';
import {createWeplayPreviewTransport} from './src/lib/weplayPreview';
import './src/assets/index.css';import './assets/css/style.css';
import './src/components/common/weplay/weplay.css';
import './src/components/common/weplay/naval-battle.css';
import './src/components/common/weplay/yut/yut.css';
import './src/components/common/weplay/yut/yut-menu-controls.css';
import './src/components/common/weplay/rhythm/rhythm.css';
window.rankingQA.service=service;
const params=new URLSearchParams(location.search),teacher=params.has('teacher');
const originalTime=Object.getOwnPropertyDescriptor(RhythmAudio.prototype,'currentTime').get;
Object.defineProperty(RhythmAudio.prototype,'currentTime',{get(){return window.rankingQA.time??originalTime.call(this)}});
function Fixture(){const[disabled,setDisabled]=useState(false);window.rankingQA.disable=setDisabled;const gameId=params.get('game')||'history-rain';return <main><div className='stage' style={{position:'relative',height:560,background:gameId==='history-rain'?'#173644':gameId==='joseon-yut'?'#51331d':'#f5e8bc'}}><Ranking gameId={gameId} portal={teacher?'teacher':'student'} disabled={disabled}/></div></main>}
const now=Date.now(),session={id:'ranking-visual',difficulty:'mild',mode:'practice',status:'active',startsAtMs:now-1000,endsAtMs:now+89000,serverNowMs:now,battleVersion:1,words:Array.from({length:30},(_,i)=>({id:'word-'+i,text:'조선',unitId:'qa',lessonTitle:'수업',context:'',stage:1,spawnAtMs:i*2000,fallDurationMs:12000})),acceptedWordIds:[],acceptedEvents:[],correctCount:0,policy:{enabled:true,challengeCost:0,dailyChallengeLimit:5,resultRewards:[],rankingPeriod:'weekly',rankingRewards:{}},result:null};
const transport=createWeplayPreviewTransport(session),music={muted:true,toggle:()=>{},start:()=>{},enabled:false,failed:false,loading:false,playing:false};
const mode=new URLSearchParams(location.search).get('actual');
createRoot(document.getElementById('root')).render(mode==='naval'?<main className='weplay-page'><Frame><Naval session={session} preview={teacher} config={window.rankingQA.auth.config} transport={transport} onComplete={()=>{}} onShowGuide={()=>{}} showRanking/></Frame></main>:mode==='yut'?<main><Frame theme='yut'><Yut portal={teacher?'teacher':'student'} onBack={()=>{}} music={music} onMusicActiveChange={()=>{}}/></Frame></main>:mode==='rhythm'?<main><Frame theme='rhythm'><Rhythm preview={teacher}/></Frame></main>:<StrictMode><Fixture/></StrictMode>);
`;
const bundled = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "ranking-qa.js"),
  loader: {
    ".woff2": "dataurl",
    ".woff": "dataurl",
    ".svg": "dataurl",
    ".png": "dataurl",
    ".webp": "dataurl",
  },
  define: {
    "process.env.NODE_ENV": '"development"',
    "import.meta.env.BASE_URL": '"/"',
  },
  metafile: true,
  plugins: [
    {
      name: "fixture",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)contexts\/AuthContext$|(?:^|\/)historyDictionarySession$|(?:^|\/)lib\/yut$/,
          },
          () => ({ path: "fixture", namespace: "fixture" }),
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
);
const js = bundled.outputFiles.find((file) => file.path.endsWith(".js")).text;
// Font URLs contain semicolons; strip whole esbuild import lines, not half a URL.
const css = bundled.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/^@import .*;$/gm, "");
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
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>body{margin:0;background:#f3f4f6}main{padding:16px}.stage{max-width:1100px;margin:auto}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const errors = [],
  external = [],
  checks = [];
const open = async (page) => {
  await page.getByRole("button", { name: "랭킹", exact: true }).click();
  await page.locator(".weplay-ranking-rows > tr").first().waitFor();
  await page.locator(".weplay-ranking-state").waitFor({ state: "detached" });
};
const close = async (page) => {
  await page.getByRole("button", { name: "랭킹 닫기" }).click();
  await page.locator('[role="dialog"]').waitFor({ state: "detached" });
};
const auditTable = async (page, name) => {
  assert.equal(
    await page.locator(".weplay-ranking-table thead th").count(),
    4,
    `${name}: persistent column headers`,
  );
  assert.equal(await page.locator(".weplay-ranking-table tbody").count(), 1);
  const measure = await page
    .locator(".weplay-ranking-close")
    .evaluate((button) => {
      const svg = button.querySelector("svg"),
        b = button.getBoundingClientRect(),
        s = svg.getBoundingClientRect(),
        style = getComputedStyle(button);
      return {
        width: style.width,
        height: style.height,
        padding: style.padding,
        dx: Math.abs((b.left + b.right - s.left - s.right) / 2),
        dy: Math.abs((b.top + b.bottom - s.top - s.bottom) / 2),
        svgWidth: getComputedStyle(svg).width,
        svgHeight: getComputedStyle(svg).height,
        dialogHeight: button.closest('[role="dialog"]').offsetHeight,
      };
    });
  assert.equal(measure.width, "44px");
  assert.equal(measure.height, "44px");
  assert.equal(measure.padding, "0px");
  assert.equal(measure.svgWidth, "20px");
  assert.equal(measure.svgHeight, "20px");
  assert(
    measure.dx < 1 && measure.dy < 1,
    `${name}: close SVG center ${JSON.stringify(measure)}`,
  );
  return measure;
};
try {
  for (const width of [390, 768, 1280])
    for (const gameId of ["history-rain", "joseon-yut", "gungdeok-rock"]) {
      const page = await browser.newPage({
        viewport: { width, height: 800 },
        hasTouch: width < 1000,
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).origin !== base) {
          external.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(`${base}/?game=${gameId}`);
      await page.locator(".weplay-ranking-launch").waitFor();
      assert.equal(
        await page.evaluate(() => window.rankingQA.calls.length),
        0,
        "no read before opening",
      );
      const anchor = await page
        .locator(".weplay-ranking-launch")
        .evaluate((el) => {
          const r = el.getBoundingClientRect(),
            p = el.parentElement.getBoundingClientRect();
          return {
            width: r.width,
            height: r.height,
            left: r.left - p.left,
            bottom: p.bottom - r.bottom,
            color: getComputedStyle(el).color,
            background: getComputedStyle(el).backgroundColor,
          };
        });
      assert(
        anchor.width >= 44 &&
          anchor.height >= 44 &&
          anchor.left <= 16 &&
          anchor.bottom <= 16,
      );
      assert.notEqual(
        anchor.background,
        "rgba(0, 0, 0, 0)",
        "theme button has visible background",
      );
      if (gameId === "history-rain")
        assert.equal(
          anchor.color,
          "rgb(244, 229, 197)",
          "naval parchment contrast",
        );
      await open(page);
      await auditTable(page, `${gameId}/${width}`);
      assert.equal(
        await page
          .getByLabel("랭킹 범위", { exact: true })
          .locator("option")
          .count(),
        3,
        "student can select overall and active classes",
      );
      assert.equal(
        await page.evaluate(() => window.rankingQA.calls.length),
        1,
        "StrictMode single request",
      );
      assert.equal(
        await page.evaluate(() =>
          document.activeElement?.getAttribute("aria-label"),
        ),
        "랭킹 닫기",
      );
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page.evaluate(
          () => document.activeElement?.closest('[role="dialog"]') !== null,
        ),
        true,
        "focus trapped",
      );
      const layout = await page.locator('[role="dialog"]').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          bottom: r.bottom,
          scroll:
            el.querySelector(".weplay-ranking-content").scrollHeight >
            el.querySelector(".weplay-ranking-content").clientHeight,
        };
      });
      assert(
        layout.left >= 0 &&
          layout.right <= width &&
          layout.bottom <= 800 &&
          layout.scroll,
      );
      assert.equal(
        await page.locator(".weplay-ranking-rows tr.is-me").count(),
        1,
      );
      await page.screenshot({
        path: path.join(evidence, `${gameId}-${width}.png`),
      });
      await page.keyboard.press("Escape");
      assert.equal(await page.locator('[role="dialog"]').count(), 0);
      assert.equal(
        await page.evaluate(() =>
          document.activeElement?.textContent.includes("랭킹"),
        ),
        true,
      );
      await open(page);
      assert.equal(
        await page.evaluate(() => window.rankingQA.calls.length),
        1,
        "repeat open served from cache",
      );
      await close(page);
      await page.evaluate(() => (window.rankingQA.offset += 61000));
      await open(page);
      assert.equal(
        await page.evaluate(() => window.rankingQA.calls.length),
        2,
        "expired cache reloads",
      );
      await close(page);
      if (width === 390) {
        await page.evaluate(() => {
          window.rankingQA.fail = true;
          window.rankingQA.offset += 61000;
        });
        await page.getByRole("button", { name: "랭킹", exact: true }).click();
        await page.getByText("랭킹을 불러오지 못했습니다.").waitFor();
        const count = await page.evaluate(() => window.rankingQA.calls.length);
        await page.evaluate(() => (window.rankingQA.fail = false));
        await page.getByRole("button", { name: "다시 불러오기" }).click();
        await page
          .locator(".weplay-ranking-rows tr:not(:has(.weplay-ranking-state))")
          .first()
          .waitFor();
        assert.equal(
          await page.evaluate(() => window.rankingQA.calls.length),
          count + 1,
          "failed response not cached",
        );
        await close(page);
        await page.evaluate(() =>
          window.rankingQA.update({ currentUser: { uid: "student-b" } }),
        );
        await open(page);
        assert.match(
          await page.locator(".weplay-ranking-rows tr").first().innerText(),
          /이\*생/,
        );
        await close(page);
        await page.evaluate(() =>
          window.rankingQA.update({ config: { year: "2026", semester: "1" } }),
        );
        await open(page);
        assert.equal(
          await page.evaluate(
            () => window.rankingQA.calls.at(-1).data.semester,
          ),
          "1",
        );
        await page.evaluate(() => window.rankingQA.disable(true));
        assert.equal(await page.locator('[role="dialog"]').count(), 0);
        assert.equal(
          await page.locator(".weplay-ranking-launch").isDisabled(),
          true,
        );
      }
      checks.push({ gameId, width, anchor, layout, passed: true });
      await page.close();
    }
  const page = await browser.newPage();
  await page.goto(base);
  await page.locator(".weplay-ranking-launch").waitFor();
  const counts = await page.evaluate(async () => {
    const qa = window.rankingQA,
      { getWeplayRanking, invalidateWeplayRanking } = qa.service;
    const config = qa.auth.config;
    qa.hold = true;
    const a = getWeplayRanking(config, "shared", "history-rain", "mild"),
      b = getWeplayRanking(config, "shared", "history-rain", "mild");
    await new Promise((r) => setTimeout(r, 0));
    const simultaneous = qa.calls.length;
    qa.hold = false;
    qa.pending.splice(0).forEach((r) => r());
    await Promise.all([a, b]);
    invalidateWeplayRanking("history-rain");
    await getWeplayRanking(config, "shared", "history-rain", "mild");
    return { simultaneous, afterInvalidation: qa.calls.length };
  });
  assert.deepEqual(counts, { simultaneous: 1, afterInvalidation: 2 });
  assert.equal(
    await page.evaluate(() => window.rankingQA.calls.at(-1).data.refresh),
    true,
    "saved results bypass the server ranking cache once",
  );
  await page.evaluate(() => {
    const qa = window.rankingQA;
    qa.hold = true;
    qa.offset += 61000;
  });
  await page.getByRole("button", { name: "랭킹", exact: true }).click();
  await page.getByText("랭킹을 불러오고 있습니다.").waitFor();
  await page.evaluate(() =>
    window.rankingQA.update({ currentUser: { uid: "student-b" } }),
  );
  await page.locator('[role="dialog"]').waitFor({ state: "detached" });
  await page.evaluate(() => {
    window.rankingQA.hold = false;
    window.rankingQA.pending.splice(0).forEach((r) => r());
  });
  await open(page);
  assert.match(
    await page.locator(".weplay-ranking-rows tr").first().innerText(),
    /이\*생/,
  );
  await page.close();
  for (const mode of ["naval", "yut"])
    for (const [width, height] of [
      [390, 844],
      [768, 1024],
      [1280, 800],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch: width < 1000,
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === base
          ? route.continue()
          : route.abort(),
      );
      await page.addInitScript(() => {
        HTMLElement.prototype.requestFullscreen = undefined;
      });
      await page.goto(`${base}/?actual=${mode}`);
      await page.locator(".weplay-ranking-launch").waitFor();
      if (mode === "yut") {
        if (width < 1000) {
          await page
            .getByRole("button", { name: /전체 화면/ })
            .first()
            .click();
          await page.locator(".yut-game--rotated-fullscreen").waitFor();
        }
        await page.getByRole("button", { name: /혼자서 시작/ }).click();
        await page
          .getByRole("button", { name: "싱글 시작", exact: true })
          .click();
        await page.locator(".yut-match").waitFor();
      }
      const collisions = await page
        .locator(".weplay-ranking-launch")
        .evaluate((el) => {
          const r = el.getBoundingClientRect(),
            root = el.closest(".naval-game,.yut-game");
          return Array.from(root.querySelectorAll("button,input,label"))
            .filter(
              (other) =>
                other !== el &&
                !el.contains(other) &&
                !other.contains(el) &&
                !other.disabled &&
                other.getClientRects().length,
            )
            .filter((other) => {
              const x = other.getBoundingClientRect();
              return (
                Math.min(r.right, x.right) - Math.max(r.left, x.left) > 2 &&
                Math.min(r.bottom, x.bottom) - Math.max(r.top, x.top) > 2
              );
            })
            .map(
              (other) => other.textContent || other.getAttribute("aria-label"),
            );
        });
      assert.deepEqual(
        collisions,
        [],
        `${mode}/${width} ranking must not overlap game controls`,
      );
      const themeButton = await page
        .locator(".weplay-ranking-launch")
        .evaluate((el) => ({
          color: getComputedStyle(el).color,
          background: getComputedStyle(el).backgroundColor,
        }));
      assert.notEqual(
        themeButton.background,
        "rgb(255, 255, 255)",
        "portal button style cannot override the game theme",
      );
      await page.screenshot({
        path: path.join(evidence, `actual-${mode}-${width}.png`),
        timeout: 30000,
      });
      await open(page);
      if (mode === "naval")
        assert.equal(
          await page
            .getByRole("button", { name: "중간맛", exact: true })
            .evaluate((el) => getComputedStyle(el).backgroundColor),
          "rgb(23, 54, 68)",
        );
      await page.screenshot({
        path: path.join(evidence, `actual-${mode}-${width}-dialog.png`),
        timeout: 30000,
      });
      const box = await page.locator('[role="dialog"]').boundingBox();
      assert(
        box.x >= -1 &&
          box.y >= -1 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= height + 1,
        `${mode}/${width} dialog in viewport`,
      );
      await close(page);
      checks.push({ actual: mode, width, collisions });
      await page.close();
    }
  for (const mode of ["naval", "yut", "rhythm"])
    for (const [width, height] of [
      [390, 844],
      [768, 1024],
      [1280, 800],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch: width < 1000,
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === base
          ? route.continue()
          : route.abort(),
      );
      await page.addInitScript(() => {
        HTMLElement.prototype.requestFullscreen = undefined;
      });
      await page.goto(`${base}/?actual=${mode}&teacher`);
      await page.locator(".weplay-ranking-launch").waitFor();
      assert.equal(
        await page.locator(".weplay-ranking-launch").count(),
        1,
        "exactly one teacher launcher",
      );
      assert.equal(
        await page.evaluate(() => window.rankingQA.calls.length),
        0,
        "teacher initial state has no ranking query",
      );
      if (mode !== "naval" && width < 1000) {
        await page
          .getByRole("button", { name: /전체 화면/ })
          .first()
          .click();
        await page
          .locator(
            mode === "yut"
              ? ".yut-game--rotated-fullscreen"
              : ".rhythm-game--rotated",
          )
          .waitFor();
      }
      await open(page);
      assert.equal(
        await page.evaluate(() => window.rankingQA.calls.length),
        1,
        "teacher first class and list in one query",
      );
      const picker = page.getByLabel("랭킹 범위", { exact: true });
      assert.equal(await picker.inputValue(), "");
      assert.equal(await picker.locator("option").count(), 3);
      assert.equal(
        await page.locator(".weplay-ranking-rows tr.is-me").count(),
        0,
        "teacher has no student self row",
      );
      await picker.selectOption("3_2");
      await page.waitForFunction(() =>
        document
          .querySelector(".weplay-ranking-rows")
          ?.textContent.includes("박*생"),
      );
      assert.equal(await page.evaluate(() => window.rankingQA.calls.length), 2);
      assert.equal(
        await page.evaluate(() => window.rankingQA.calls.at(-1).data.classId),
        "3_2",
      );
      await picker.selectOption("");
      await page.waitForFunction(() =>
        document
          .querySelector(".weplay-ranking-rows")
          ?.textContent.includes("김*생"),
      );
      assert.equal(
        await page.evaluate(() => window.rankingQA.calls.length),
        2,
        "return to overall reuses cache",
      );
      const box = await page.locator('[role="dialog"]').boundingBox();
      assert(
        box.x >= -1 &&
          box.y >= -1 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= height + 1,
        `teacher ${mode}/${width} dialog fits`,
      );
      await page.screenshot({
        path: path.join(evidence, `teacher-${mode}-${width}-dialog.png`),
      });
      await auditTable(page, `teacher ${mode}/${width}`);
      await close(page);
      await open(page);
      assert.equal(
        await page.evaluate(() => window.rankingQA.calls.length),
        2,
        "teacher reopen no query",
      );
      await close(page);
      if (mode === "yut") {
        await page.getByRole("button", { name: /대기실부터 체험하기/ }).click();
        await page.locator(".yut-waiting").waitFor();
        await open(page);
        await close(page);
        await page
          .getByRole("button", { name: "게임 시작", exact: true })
          .click();
        await page.locator(".yut-match").waitFor();
        await open(page);
        await close(page);
      }
      if (mode === "rhythm") {
        await page.getByRole("button", { name: /연주 시작/ }).click();
        await page
          .getByRole("button", { name: "일시정지", exact: true })
          .waitFor();
        await open(page);
        await close(page);
        await page.getByRole("button", { name: /계속 연주/ }).click();
        await page.evaluate(() => (window.rankingQA.time = 1000));
        await page.locator(".rhythm-result").waitFor();
        await open(page);
        await close(page);
      }
      assert(
        await page.evaluate(() =>
          window.rankingQA.calls.every(
            (call) => call.name === "getWeplayRanking",
          ),
        ),
        "teacher preview never submits score",
      );
      const states = [];
      for (const state of ["loading", "empty", "error"]) {
        await page.evaluate(
          ({ state, gameId }) => {
            const qa = window.rankingQA;
            qa.service.invalidateWeplayRanking(gameId, false);
            qa.hold = state === "loading";
            qa.empty = state === "empty";
            qa.fail = state === "error";
          },
          {
            state,
            gameId:
              mode === "naval"
                ? "history-rain"
                : mode === "yut"
                  ? "joseon-yut"
                  : "gungdeok-rock",
          },
        );
        await page.getByRole("button", { name: "랭킹", exact: true }).click();
        await page
          .getByText(
            state === "loading"
              ? "랭킹을 불러오고 있습니다."
              : state === "empty"
                ? "이번 주 기록이 없습니다."
                : "랭킹을 불러오지 못했습니다.",
            { exact: true },
          )
          .waitFor();
        const measure = await auditTable(page, `${mode}/${width}/${state}`);
        if (mode !== "rhythm")
          assert(
            measure.dialogHeight < 420,
            "empty/loading record book fits content without a tall blank area",
          );
        await page.screenshot({
          path: path.join(evidence, `teacher-${mode}-${width}-${state}.png`),
        });
        states.push({ state, ...measure });
        await close(page);
        await page.evaluate(() => {
          const qa = window.rankingQA;
          qa.hold = false;
          qa.empty = false;
          qa.fail = false;
          qa.pending.splice(0).forEach((resolve) => resolve());
        });
      }
      await page.evaluate(
        (gameId) =>
          window.rankingQA.service.invalidateWeplayRanking(gameId, false),
        mode === "naval"
          ? "history-rain"
          : mode === "yut"
            ? "joseon-yut"
            : "gungdeok-rock",
      );
      if (width === 1280) {
        await open(page);
        await page.evaluate(() => {
          window.rankingQA.savedUserData = window.rankingQA.auth.userData;
        });
        await page.evaluate(() =>
          window.rankingQA.update({
            userData: {
              role: "staff",
              teacherPortalEnabled: false,
              staffPermissions: ["lesson_read"],
            },
          }),
        );
        await page
          .locator(".weplay-ranking-launch")
          .waitFor({ state: "detached" });
        assert.equal(
          await page.locator('[role="dialog"]').count(),
          0,
          "revoked permission closes cached ranking",
        );
        await page.evaluate(() =>
          window.rankingQA.update({
            userData: {
              role: "student",
              teacherPortalEnabled: true,
              staffPermissions: ["lesson_read"],
            },
          }),
        );
        assert.equal(
          await page.locator(".weplay-ranking-launch").count(),
          0,
          "student cannot enter teacher ranking by permission-shaped fields",
        );
        const beforeRestore = await page.evaluate(
          () => window.rankingQA.calls.length,
        );
        await page.evaluate(() =>
          window.rankingQA.update({ userData: window.rankingQA.savedUserData }),
        );
        await page.locator(".weplay-ranking-launch").waitFor();
        await open(page);
        assert.equal(
          await page.evaluate(() => window.rankingQA.calls.length),
          beforeRestore + 1,
          "returning to the same permission scope must reauthorize after revocation",
        );
        await close(page);
        await page.evaluate(() =>
          window.rankingQA.update({
            userData: {
              role: "staff",
              teacherPortalEnabled: true,
              staffPermissions: ["lesson_read"],
            },
          }),
        );
        await page.locator(".weplay-ranking-launch").waitFor();
        await open(page);
        assert.equal(
          await page.evaluate(() => window.rankingQA.calls.at(-1).data.classId),
          undefined,
          "new role reloads its authorized class list",
        );
      }
      checks.push({
        teacher: mode,
        width,
        classes: 2,
        lazyReads: 2,
        previewWrites: 0,
        states,
      });
      await page.close();
    }
  const weekly = await browser.newPage({
    viewport: { width: 390, height: 800 },
  });
  await weekly.goto(base);
  await weekly.locator(".weplay-ranking-launch").waitFor();
  await weekly.evaluate(() => {
    const qa = window.rankingQA;
    const nextMonday = Date.parse("2026-11-22T15:00:00Z");
    qa.offset = nextMonday - Date.now() - 500;
  });
  await open(weekly);
  await weekly.waitForFunction(() => window.rankingQA.calls.length === 2);
  assert.equal(
    await weekly.evaluate(() => window.rankingQA.calls[0].data.includeClasses),
    true,
  );
  assert.equal(
    await weekly.evaluate(() => window.rankingQA.calls[1].data.includeClasses),
    undefined,
    "week rollover does not reread class metadata",
  );
  assert.match(
    await weekly.locator(".weplay-ranking-metric").first().innerText(),
    /11\. 23\./,
    "visible weekly period rolls at KST Monday midnight",
  );
  await weekly.getByLabel("랭킹 범위").selectOption("3_2");
  await weekly.waitForFunction(() => window.rankingQA.calls.length === 3);
  assert.equal(
    await weekly.evaluate(() => window.rankingQA.calls.at(-1).data.view),
    "class",
  );
  assert.equal(
    await weekly.evaluate(() => window.rankingQA.calls.at(-1).data.classId),
    "3_2",
    "student can read another active class",
  );
  await weekly.getByLabel("랭킹 범위").selectOption("");
  await weekly.waitForFunction(() =>
    document
      .querySelector(".weplay-ranking-rows")
      ?.textContent.includes("김*생"),
  );
  assert.equal(
    await weekly.evaluate(() => window.rankingQA.calls.length),
    3,
    "student return to overall reuses cache",
  );
  await weekly.evaluate(() => {
    const qa = window.rankingQA;
    qa.hidden = true;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (qa.hidden ? "hidden" : "visible"),
    });
    qa.offset += 7 * 86400000;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(
    await weekly.evaluate(() => window.rankingQA.calls.length),
    3,
    "hidden dialog does not query on week change",
  );
  await weekly.evaluate(() => {
    window.rankingQA.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await weekly.waitForFunction(() => window.rankingQA.calls.length === 4);
  assert.match(
    await weekly.locator(".weplay-ranking-metric").first().innerText(),
    /11\. 30\./,
  );
  const boundary = await weekly.evaluate(() => {
    const monday = Date.parse("2026-11-22T15:00:00Z"),
      get = window.rankingQA.service.getWeplayRankingWeek;
    return { before: get(monday - 1), after: get(monday) };
  });
  assert.equal(boundary.before.endsAtMs, boundary.after.startsAtMs);
  assert.equal(boundary.after.startsAtMs, Date.parse("2026-11-22T15:00:00Z"));
  checks.push({
    weeklyRollover: true,
    hiddenNoRead: true,
    studentClassSwitch: true,
    calls: 4,
  });
  await weekly.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  checks.push({ cache: counts, staleResponseDiscarded: true });
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ checks, errors, external }, null, 2),
  );
  console.log(
    `PASS ranking responsive/cache/error/account checks (${checks.length})`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
