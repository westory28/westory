/** Real entry/publication hook/game; all account, room and transport data is synthetic. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

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
const evidence = path.join(root, "output/yut-stability-20261102");
await fs.mkdir(evidence, { recursive: true });
const modulePath = (value) =>
  JSON.stringify(path.join(root, value).replaceAll("\\", "/"));
const service = `
import {useSyncExternalStore} from 'react';
import * as core from ${modulePath("functions/yutCore.mjs")};
const listeners=new Set(),subscriptions=new Set();
const qa=window.yutStabilityQA={account:{config:{year:'2026',semester:'2'},currentUser:{uid:'qa-yut-host'}},failure:null,enabled:true,reads:0,commands:[],commits:0,freeze:false,drop:false,subscriptions:0,receipts:new Set()};
qa.setAccount=uid=>{qa.account={...qa.account,currentUser:{uid}};listeners.forEach(fn=>fn());};
export const useAuth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>qa.account);
export const YUT_PRIVATE_DAILY_LIMIT=5;
export const DEFAULT_YUT_SETTINGS={enabled:true,version:1,allowSolo:true,allowMultiplayer:true,allowPrivateRooms:true,defaultPlayerCount:2,throwSeconds:15,moveSeconds:60};
export const normalizeYutSettings=value=>({...DEFAULT_YUT_SETTINGS,...value});
const now=Date.now();
qa.room=core.createYutRoom({id:'qa-stable-room',code:'AB2345',classId:'',classLabel:'검증 방',host:{uid:'qa-yut-host',name:'검증 첫째'},nowMs:now,visibility:'private',maxPlayers:2,throwSeconds:15,moveSeconds:60});
qa.room=core.addYutPlayer(qa.room,{uid:'qa-yut-guest',name:'검증 둘째'},now);
qa.room=core.readyYutPlayer(qa.room,'qa-yut-guest',true,now);
qa.room=core.startYutGame(qa.room,now-2000);
qa.room.turnDeadlineMs=Date.now()+120000;
if(new URLSearchParams(location.search).has('single'))qa.room=null;
qa.emit=()=>{if(!qa.freeze)subscriptions.forEach(callback=>callback(structuredClone(qa.room)));};
export async function getYutLobby(){
 qa.reads++;
 if(qa.failure)throw Object.assign(new Error('검증용 연결 실패'),{code:qa.failure});
 return {enabled:qa.enabled,settings:{...DEFAULT_YUT_SETTINGS,enabled:qa.enabled},room:qa.account.currentUser.uid==='qa-yut-host'?structuredClone(qa.room):null,classes:[],classId:'',playerName:'검증 첫째',serverNowMs:Date.now()};
}
export async function commandYutRoom(_config,data){
 qa.commands.push(structuredClone(data));
 if(!qa.receipts.has(data.requestKey)){
  if(data.action!=='throw')throw new Error('Unexpected action '+data.action);
  qa.room=core.throwYut(qa.room,'qa-yut-host',[true,true,false,false],Date.now(),data.power);
  qa.commits++;qa.receipts.add(data.requestKey);qa.emit();
 }
 if(qa.drop){qa.drop=false;throw Object.assign(new Error('검증용 응답 유실'),{code:'unavailable'});}
 return {room:structuredClone(qa.room),serverNowMs:Date.now()};
}
export function subscribeYutRoom(_config,_id,onRoom,_onError,onConnectionChange){
 qa.subscriptions++;subscriptions.add(onRoom);
 queueMicrotask(()=>{if(subscriptions.has(onRoom)&&!qa.freeze){onConnectionChange?.(true);onRoom(structuredClone(qa.room));}});
 return ()=>{qa.subscriptions--;subscriptions.delete(onRoom);};
}
export const yutErrorMessage=error=>error.message;
`;
const harness = `
import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import Entry from ${modulePath("src/components/common/weplay/YutGameEntry.tsx")};
import ${modulePath("src/assets/index.css")};import ${modulePath("assets/css/style.css")};
createRoot(document.getElementById('root')).render(<MemoryRouter><Entry portal="student"/></MemoryRouter>);
`;
const bundled = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "yut-stability.js"),
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
      name: "synthetic-yut-transport",
      setup(plugin) {
        plugin.onResolve({ filter: /^\/assets\// }, (args) => ({
          path: args.path,
          external: true,
        }));
        plugin.onResolve(
          { filter: /(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/yut$/ },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "tsx",
          resolveDir: root,
        }));
        plugin.onResolve(
          { filter: /\/WeplayStudioIntro$|^\.\/WeplayStudioIntro$/ },
          () => ({ path: "intro", namespace: "intro" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "intro" }, () => ({
          contents:
            "import React from 'react'; export default function Intro({onComplete}){return <button onClick={onComplete}>검증 게임 시작</button>}",
          loader: "tsx",
          resolveDir: root,
        }));
        if (process.env.YUT_STABILITY_BASELINE === "1")
          plugin.onLoad(
            {
              filter:
                /[\\/]weplay[\\/](YutGameEntry\.tsx|yut[\\/]YutGame\.tsx)$/,
            },
            (args) => ({
              contents: execFileSync(
                "git",
                [
                  "show",
                  "HEAD:" +
                    path.relative(root, args.path).replaceAll("\\", "/"),
                ],
                { cwd: root, encoding: "utf8" },
              ),
              loader: "tsx",
              resolveDir: path.dirname(args.path),
            }),
          );
      },
    },
  ],
});
const js = bundled.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundled.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+[^;]+;/g, "");
const server = http.createServer(async (req, res) => {
  try {
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
      assert.ok(target.startsWith(path.join(root, "public") + path.sep));
      res.setHeader(
        "Content-Type",
        {
          ".webp": "image/webp",
          ".wav": "audio/wav",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
        }[path.extname(target)] || "application/octet-stream",
      );
      return res.end(await fs.readFile(target));
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>*,::before,::after{box-sizing:border-box}body{margin:0}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>',
    );
  } catch (error) {
    res.statusCode = 500;
    res.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  errors = [];
try {
  for (const [width, height] of [
    [1280, 800],
    [768, 640],
    [844, 390],
    [390, 844],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(base) ? route.continue() : route.abort(),
    );
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "검증 게임 시작", exact: true })
      .click();
    if (width === 390) {
      await page
        .getByRole("button", { name: "전체 화면으로 열기", exact: true })
        .waitFor();
      await page.evaluate(() =>
        Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
          configurable: true,
          value: undefined,
        }),
      );
      await page
        .getByRole("button", { name: "전체 화면으로 열기", exact: true })
        .click();
    }
    await page.locator(".yut-board").waitFor();
    await page.evaluate(() => {
      window.retainedGame = document.querySelector(".yut-game");
      window.yutStabilityQA.failure = "unavailable";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page
      .getByText(
        "게임을 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.querySelector(".yut-game") === window.retainedGame,
      ),
      true,
      "failed refresh preserves mounted match at " + width,
    );
    assert.equal(
      await page.locator(".yut-game").isVisible(),
      false,
      "unverified publication hides all gameplay",
    );
    await page.waitForFunction(() => window.yutStabilityQA.subscriptions === 0);
    const commandsBefore = await page.evaluate(
      () => window.yutStabilityQA.commands.length,
    );
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(() => window.yutStabilityQA.commands.length),
      commandsBefore,
      "suspension does not submit commands",
    );
    await page.evaluate(() => (window.yutStabilityQA.failure = null));
    await page.getByRole("button", { name: "다시 확인", exact: true }).click();
    await page.locator(".yut-game").waitFor({ state: "visible" });
    assert.equal(
      await page.evaluate(
        () => document.querySelector(".yut-game") === window.retainedGame,
      ),
      true,
      "successful refresh resumes the same match",
    );
    if (width === 390)
      await page
        .getByRole("button", { name: "전체 화면으로 열기", exact: true })
        .click();
    await page.screenshot({
      path: path.join(evidence, `recovered-${width}.png`),
    });
    // A confirmed closure and permission rejection are still fail-closed.
    for (const reason of ["closed", "permission-denied"]) {
      await page.evaluate((reason) => {
        window.yutStabilityQA.enabled = reason !== "closed";
        window.yutStabilityQA.failure = reason === "closed" ? null : reason;
        document.dispatchEvent(new Event("visibilitychange"));
      }, reason);
      await page
        .getByText("지금은 윷놀이가 열려 있지 않습니다.", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator(".yut-game").isVisible(),
        false,
        reason + " hides game",
      );
      await page.waitForFunction(
        () => window.yutStabilityQA.subscriptions === 0,
      );
      await page.evaluate(() => {
        window.yutStabilityQA.enabled = true;
        window.yutStabilityQA.failure = null;
      });
      await page
        .getByRole("button", { name: "다시 확인", exact: true })
        .click();
      await page.locator(".yut-game").waitFor({ state: "visible" });
    }
    if (width === 1280) {
      await page.evaluate(() => {
        window.yutStabilityQA.drop = true;
        window.yutStabilityQA.freeze = true;
      });
      const throwing = page.getByRole("button", {
        name: "윷 던지기",
        exact: true,
      });
      await throwing.waitFor();
      const box = await throwing.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(150);
      await page.mouse.up();
      await page
        .getByRole("button", { name: "방 상태 다시 확인", exact: true })
        .waitFor();
      const first = await page.evaluate(() =>
        window.yutStabilityQA.commands.at(-1),
      );
      await page.evaluate(() => {
        window.yutStabilityQA.failure = "unavailable";
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page
        .getByRole("button", { name: "다시 확인", exact: true })
        .waitFor();
      await page.evaluate(() => (window.yutStabilityQA.failure = null));
      await page
        .getByRole("button", { name: "다시 확인", exact: true })
        .click();
      await page
        .getByRole("button", { name: "방 상태 다시 확인", exact: true })
        .click();
      await page.waitForFunction(
        () => window.yutStabilityQA.commands.length === 2,
      );
      const recovered = await page.evaluate(() => ({
        last: window.yutStabilityQA.commands.at(-1),
        commits: window.yutStabilityQA.commits,
      }));
      assert.deepEqual(
        recovered.last,
        first,
        "exact uncertain request survives publication failure",
      );
      assert.equal(
        recovered.commits,
        1,
        "one authoritative throw after receipt recovery",
      );
      checks.push(
        "Lost response plus failed publication refresh retains exact command receipt and commits one throw.",
      );
    }
    await page.evaluate(() => {
      window.yutStabilityQA.failure = "unavailable";
      window.yutStabilityQA.setAccount("qa-other-student");
    });
    await page
      .getByText(
        "게임을 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page.locator(".yut-game").count(),
      0,
      "account switch discards prior board and receipt",
    );
    checks.push(
      `${width}x${height}: network interruption recovery, public closure/permission rejection, stopped subscription and account isolation.`,
    );
    await page.close();
  }
  const solo = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  solo.on("pageerror", (error) => errors.push(error.message));
  await solo.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort(),
  );
  await solo.goto(base + "/?single=1");
  await solo
    .getByRole("button", { name: "검증 게임 시작", exact: true })
    .click();
  await solo.getByRole("button", { name: "혼자서 시작", exact: true }).click();
  await solo.getByRole("button", { name: "싱글 시작", exact: true }).click();
  await solo.locator(".yut-board").waitFor();
  await solo.waitForTimeout(2400);
  const remaining = () =>
    solo
      .locator('.yut-turn-gauge [role="progressbar"]')
      .first()
      .getAttribute("aria-valuenow");
  const beforePause = Number(await remaining());
  await solo
    .getByRole("button", { name: "게임 규칙 보기", exact: true })
    .click();
  await solo.locator("dialog[open]").waitFor();
  await solo.evaluate(() => {
    window.retainedGame = document.querySelector(".yut-game");
    window.yutStabilityQA.failure = "unavailable";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await solo.getByRole("button", { name: "다시 확인", exact: true }).waitFor();
  assert.equal(
    await solo.locator("dialog[open]").count(),
    0,
    "suspension dismisses native top-layer dialogs",
  );
  await solo.waitForTimeout(1600);
  await solo.evaluate(() => (window.yutStabilityQA.failure = null));
  await solo.getByRole("button", { name: "다시 확인", exact: true }).click();
  await solo.locator(".yut-board").waitFor({ state: "visible" });
  assert.equal(
    await solo.evaluate(
      () => document.querySelector(".yut-game") === window.retainedGame,
    ),
    true,
    "single match is retained",
  );
  const afterPause = Number(await remaining());
  assert.ok(
    Math.abs(beforePause - afterPause) <= 1,
    `single turn clock pauses during unverified access: ${beforePause} -> ${afterPause}`,
  );
  assert.equal(
    await solo.evaluate(() => window.yutStabilityQA.commands.length),
    0,
    "local recovery performs no game command",
  );
  checks.push(
    "Single-player match and turn deadline survive publication outage; native modal closes and no server game command runs.",
  );
  await solo.close();
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      { passed: true, checks, pageErrors: errors, productionWrites: 0 },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { passed: true, checks, pageErrors: errors, productionWrites: 0 },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
