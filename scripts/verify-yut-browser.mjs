/** Browser acceptance: actual game/intro UI, synthetic transport only. No production writes. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as core from "../functions/yutCore.mjs";

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
const evidence = path.join(root, "output/yut-final-20261018");
await fs.mkdir(evidence, { recursive: true });
const modulePath = (value) =>
  JSON.stringify(path.join(root, value).replaceAll("\\", "/"));
const service = `
const params=new URLSearchParams(location.search);
const uid=params.get('uid')||'qa-teacher';
export const useAuth=()=>({config:{year:'2026',semester:'2'},currentUser:{uid,email:'qa@yongshin-ms.ms.kr'},userData:{uid,role:params.get('portal')==='student'?'student':'teacher',name:'검증 교사'}});
const qa=window.yutQA={calls:[],failNext:false,dropNextResponse:false};
async function request(endpoint,data){qa.calls.push({endpoint,data});if(qa.failNext){qa.failNext=false;throw new Error('검증용 연결 오류: 다시 시도해 주세요.');}const response=await fetch('/qa/'+endpoint+'?uid='+uid,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error),{code:'aborted'});if(qa.dropNextResponse){qa.dropNextResponse=false;throw new Error('응답 연결이 끊겼습니다.');}return result;}
export const YUT_PRIVATE_DAILY_LIMIT=5;
export const DEFAULT_YUT_SETTINGS={enabled:false,version:0,allowSolo:true,allowMultiplayer:true,allowPrivateRooms:true,defaultPlayerCount:4,throwSeconds:5,moveSeconds:25};
export const normalizeYutSettings=value=>({...DEFAULT_YUT_SETTINGS,...(value||{})});
export const getYutLobby=()=>request('lobby');
export const commandYutRoom=(_config,data)=>request('command',data);
export function subscribeYutRoom(_config,roomId,onRoom,onError){let stopped=false,last=-1;const read=async()=>{try{const response=await fetch('/qa/state?uid='+uid);const value=await response.json();const revision=value.room?.syncRevision??value.room?.revision??-2;if(!stopped&&revision!==last){last=revision;onRoom(value.room);}}catch(error){if(!stopped)onError(error);}};read();const timer=setInterval(read,100);return()=>{stopped=true;clearInterval(timer);};}
export const yutErrorMessage=error=>error?.message||'다시 시도해 주세요.';
`;
const harness = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import Entry from ${modulePath("src/components/common/weplay/YutGameEntry.tsx")};
import {YutPowerThrow} from ${modulePath("src/components/common/weplay/yut/YutGame.tsx")};
import {AppDialogProvider} from ${modulePath("src/components/common/AppDialogProvider.tsx")};
import ${modulePath("src/assets/index.css")};import ${modulePath("assets/css/style.css")};
const params=new URLSearchParams(location.search),portal=params.get('portal')==='student'?'student':'teacher';
function PowerFixture(){const[disabled,setDisabled]=useState(false);window.yutPowerDisable=setDisabled;window.yutPowerThrows??=[];return <section className="yut-game"><YutPowerThrow disabled={disabled} onThrow={value=>window.yutPowerThrows.push(value)}/></section>}
createRoot(document.getElementById('root')).render(params.has('power')?<PowerFixture/>:<><div style={{height:params.has("chrome")?96:0}}/><MemoryRouter initialEntries={['/'+portal+'/weplay?game=joseon-yut'+(params.has('preview')?'&view=preview':'')]}><AppDialogProvider><Entry portal={portal}/></AppDialogProvider></MemoryRouter></>);
`;
const bundled = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "westory-yut-qa.js"),
  loader: {
    ".svg": "dataurl",
    ".png": "dataurl",
    ".webp": "dataurl",
    ".woff2": "file",
    ".woff": "file",
  },
  assetNames: "qa-fonts/[name]-[hash]",
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "yut-fixture",
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
          loader: "ts",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundled.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundled.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+[^;]+;/g, "");
const fontFiles = new Map(
  bundled.outputFiles
    .filter((file) => /\.woff2?$/.test(file.path))
    .map((file) => [
      "/" + path.relative(os.tmpdir(), file.path).replaceAll("\\", "/"),
      file.contents,
    ]),
);
let room = null;
let enabled = true;
let modeSettings = {
  allowSolo: true,
  allowMultiplayer: true,
  allowPrivateRooms: true,
};
const privateUses = new Map();
const commands = [];
const history = new Map();
let throwIndex = 0;
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1"),
      uid = url.searchParams.get("uid");
    const json = (value) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(value));
    };
    if (fontFiles.has(url.pathname)) {
      response.setHeader(
        "Content-Type",
        url.pathname.endsWith(".woff2") ? "font/woff2" : "font/woff",
      );
      return response.end(fontFiles.get(url.pathname));
    }
    if (url.pathname === "/qa/reset") {
      room = null;
      enabled = true;
      modeSettings = {
        allowSolo: true,
        allowMultiplayer: true,
        allowPrivateRooms: true,
      };
      privateUses.clear();
      commands.length = 0;
      history.clear();
      throwIndex = 0;
      return json({ ok: true });
    }
    if (url.pathname === "/qa/settings") {
      for (const key of Object.keys(modeSettings))
        if (url.searchParams.has(key))
          modeSettings[key] = url.searchParams.get(key) === "true";
      if (url.searchParams.has("remaining"))
        privateUses.set(uid, 5 - Number(url.searchParams.get("remaining")));
      return json(modeSettings);
    }
    if (url.pathname === "/qa/publication") {
      enabled = url.searchParams.get("enabled") === "true";
      return json({ enabled });
    }
    if (url.pathname === "/qa/lobby")
      return json({
        enabled,
        settings: {
          enabled,
          version: 1,
          ...modeSettings,
          defaultPlayerCount: 4,
          throwSeconds: 5,
          moveSeconds: 25,
        },
        privatePlaysRemaining: Math.max(0, 5 - (privateUses.get(uid) || 0)),
        room:
          room?.participantUids.includes(uid) && room.status !== "closed"
            ? room
            : null,
        classes: [],
        classId: "",
        serverNowMs: Date.now(),
      });
    if (url.pathname === "/qa/state")
      return json({ room: room?.participantUids.includes(uid) ? room : null });
    if (url.pathname === "/qa/command") {
      if (!enabled) throw new Error("지금은 이 게임을 이용할 수 없습니다.");
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString());
      commands.push({ uid, ...data });
      if (history.has(data.requestKey))
        return json(history.get(data.requestKey));
      if (
        !["create", "join", "match", "emote"].includes(data.action) &&
        data.expectedRevision !== room?.revision
      )
        throw new Error("방 상태가 바뀌었습니다. 다시 시도해 주세요.");
      const now = Date.now();
      if (
        data.action === "create" ||
        (data.action === "match" && (!room || room.status !== "waiting"))
      )
        room = core.createYutRoom({
          id: "browser-qa-room",
          code: "AB2345",
          classId: "",
          classLabel: "함께하는 윷판",
          host: { uid, name: "첫째 학생" },
          nowMs: now,
          visibility: data.action === "match" ? "public" : data.visibility,
          maxPlayers: data.maxPlayers || 4,
        });
      else if (data.action === "join" || data.action === "match") {
        if (data.action === "join" && data.code !== "AB2345")
          throw new Error("참가 코드를 확인해 주세요.");
        room = core.addYutPlayer(room, { uid, name: "둘째 학생" }, now);
      } else if (data.action === "ready")
        room = core.readyYutPlayer(room, uid, data.ready, now);
      else if (data.action === "seat")
        room = core.setYutSeat(room, uid, data.seat, data.blocked, now);
      else if (data.action === "start") {
        room = core.startYutGame(room, now);
        if (room.visibility === "private")
          for (const player of room.players)
            privateUses.set(player.uid, (privateUses.get(player.uid) || 0) + 1);
      } else if (data.action === "throw") {
        const throws = [
          [true, true, false, false],
          [true, false, false, false],
          [true, true, true, false],
        ];
        room = core.throwYut(
          room,
          uid,
          throws[throwIndex++ % throws.length],
          now,
          data.power,
        );
      } else if (data.action === "move")
        room = core.moveYut(room, uid, data.pieceId, data.route, now);
      else if (data.action === "skip") room = core.skipYutTurn(room, now);
      else if (data.action === "leave")
        room = core.leaveYutRoom(room, uid, now);
      else if (data.action === "close") room = core.closeYutRoom(room, now);
      else if (data.action === "emote")
        room = core.addYutEmote(room, uid, data.kind, data.requestKey, now);
      const result = {
        room:
          room?.participantUids.includes(uid) && data.action !== "leave"
            ? room
            : null,
        serverNowMs: now,
      };
      history.set(data.requestKey, result);
      return json(result);
    }
    if (url.pathname === "/qa.js") {
      response.setHeader("Content-Type", "text/javascript");
      return response.end(js);
    }
    if (url.pathname === "/qa.css") {
      response.setHeader("Content-Type", "text/css");
      return response.end(css);
    }
    if (url.pathname.startsWith("/assets/")) {
      const target = path.resolve(root, "public", "." + url.pathname);
      if (!target.startsWith(path.join(root, "public") + path.sep))
        throw new Error("Bad path");
      const ext = path.extname(target);
      response.setHeader(
        "Content-Type",
        {
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
          ".wav": "audio/wav",
          ".webp": "image/webp",
        }[ext] || "application/octet-stream",
      );
      return response.end(await fs.readFile(target));
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>*,::before,::after{box-sizing:border-box}body{margin:0}</style></head><body style="margin:0"><div id="root"></div><script type="module" src="/qa.js"></script></body></html>',
    );
  } catch (error) {
    response.statusCode = 409;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: error.message }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
console.log("Yut browser fixture: " + base);
if (process.env.YUT_QA_SERVE_ONLY === "1") await new Promise(() => {});
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  errors = [];
async function open(
  width,
  query = "",
  height = 900,
  reducedMotion = "no-preference",
) {
  const page = await browser.newPage({
    viewport: { width, height },
    reducedMotion,
    deviceScaleFactor: 1,
  });
  await page.addInitScript((realFullscreen) => {
    if (realFullscreen) return;
    HTMLElement.prototype.requestFullscreen = async function () {
      window.qaFullscreenRequests = (window.qaFullscreenRequests || 0) + 1;
      throw new Error("QA unsupported fullscreen fallback");
    };
  }, query.includes("real-fullscreen=1"));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort(),
  );
  await page.goto(base + "/?" + query, { waitUntil: "domcontentloaded" });
  return page;
}
async function skip(page) {
  const button = page.getByRole("button", { name: /건너뛰기/ });
  await button.waitFor();
  await button.click();
}
async function capture(page, name) {
  await page.screenshot({
    path: path.join(evidence, name + ".png"),
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  assert.equal(overflow, false, name + " horizontal overflow");
}
async function throwWithPower(page, duration = 420) {
  const button = page.getByRole("button", { name: "윷 던지기", exact: true });
  await button.waitFor();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "윷 던지기",
    );
    return button && !button.disabled;
  });
  const box = await button.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(duration);
  await page.mouse.up();
}
// Acceptance steps below intentionally use user-visible controls, not internal component state.
try {
  if (process.env.YUT_QA_ONLY_MODES !== "1") {
    const powerPage = await open(1280, "power=1");
    const powerButton = powerPage.getByRole("button", {
      name: "윷 던지기",
      exact: true,
    });
    await powerButton.waitFor();
    await powerButton.focus();
    await powerPage.keyboard.down("Space");
    const samples = [];
    for (let sample = 0; sample < 12; sample++) {
      await powerPage.waitForTimeout(150);
      samples.push(
        Number(
          await powerPage.getByRole("meter").getAttribute("aria-valuenow"),
        ),
      );
    }
    assert.ok(
      samples.every(
        (value, index) => index === 0 || value >= samples[index - 1],
      ),
      "held charge never falls",
    );
    assert.equal(samples.at(-1), 100);
    assert.equal(samples.at(-3), 100, "full charge remains full");
    await powerPage.keyboard.up("Space");
    assert.deepEqual(
      await powerPage.evaluate(() => window.yutPowerThrows),
      [1],
    );
    await throwWithPower(powerPage, 100);
    const shortPower = await powerPage.evaluate(() =>
      window.yutPowerThrows.at(-1),
    );
    assert.ok(shortPower >= 0.12 && shortPower < 0.35);
    await powerButton.press("Enter");
    await powerPage.waitForTimeout(600);
    await powerPage
      .getByRole("button", { name: "힘을 멈추고 던지기", exact: true })
      .press("Enter");
    const mediumPower = await powerPage.evaluate(() =>
      window.yutPowerThrows.at(-1),
    );
    assert.ok(mediumPower > shortPower && mediumPower < 1);
    await powerButton.focus();
    await powerPage.keyboard.down("Space");
    await powerPage.keyboard.press("Escape");
    await powerPage.keyboard.up("Space");
    assert.equal(
      await powerPage.evaluate(() => window.yutPowerThrows.length),
      3,
    );
    await powerButton.press("Enter");
    await powerPage.evaluate(() => window.dispatchEvent(new Event("blur")));
    assert.equal(
      await powerPage.getByRole("meter").getAttribute("aria-valuenow"),
      "0",
    );
    await powerButton.press("Enter");
    await powerPage.evaluate(() => window.yutPowerDisable(true));
    await powerPage.waitForFunction(
      () =>
        document
          .querySelector('[role="meter"]')
          .getAttribute("aria-valuenow") === "0",
    );
    assert.equal(
      await powerPage.getByRole("meter").getAttribute("aria-valuenow"),
      "0",
    );
    assert.equal(
      await powerPage.evaluate(() => window.yutPowerThrows.length),
      3,
    );
    await powerPage.close();
    checks.push(
      "Power rises monotonically for 1.2s and holds at 100%; short pointer, Space-release and Enter-toggle each throw once; Escape, blur and disabled state cancel safely.",
    );
    const intro = await open(1280, "portal=student&uid=qa-intro");
    await intro.locator("section.weplay-studio-intro").waitFor();
    assert.ok(
      await intro.evaluate(() =>
        window.yutQA.calls.every((call) => call.endpoint === "lobby"),
      ),
    );
    await intro.waitForTimeout(1050);
    await capture(intro, "studio-intro");
    await intro.getByRole("button", { name: /건너뛰기/ }).press("Escape");
    await intro
      .getByRole("button", { name: "새 판 만들기", exact: true })
      .waitFor();
    checks.push(
      "Publication is checked before intro; opening performs no game commands and Escape restores lobby.",
    );
    await intro.close();
    for (const width of process.env.YUT_QA_WIDTHS
      ? process.env.YUT_QA_WIDTHS.split(",").map(Number)
      : [320, 390, 768, 1280, 1440]) {
      const page = await open(
        width,
        "portal=teacher&uid=qa-teacher" + (width === 1280 ? "&chrome=1" : ""),
        width === 1280 ? 720 : 900,
      );
      await skip(page);
      if (width < 1024) {
        await page
          .getByText("휴대폰을 가로로 돌려 주세요.", { exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "새 판 만들기", exact: true })
            .count(),
          0,
        );
        await capture(page, "yut-portrait-gate-" + width);
        await page.setViewportSize({
          width: width === 320 ? 640 : width === 390 ? 844 : 1024,
          height: width === 768 ? 768 : 390,
        });
      }
      await page
        .getByRole("button", { name: "새 판 만들기", exact: true })
        .waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(
        await page.getByLabel("함께할 학급", { exact: true }).count(),
        0,
      );
      await capture(page, "yut-lobby-" + width);
      await page
        .getByRole("button", { name: "대기실부터 체험하기", exact: true })
        .click();
      await page.getByRole("heading", { name: "한 판의 인연" }).waitFor();
      const before = await page.evaluate(() => window.yutQA.calls.length);
      await capture(page, "yut-preview-waiting-" + width);
      await page
        .getByRole("button", { name: "윷판 펼치기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "윷 던지기", exact: true })
        .waitFor();
      assert.equal(
        await page.locator(".yut-match-heading").count(),
        0,
        "duplicate match banner removed",
      );
      await page
        .locator(".yut-topbar-title")
        .getByText("마우저구 윷놀이", { exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator(".weplay-game-navigation .weplay-music-button")
          .count(),
        1,
        "header sound remains after intro",
      );
      assert.equal(
        await page
          .locator(".weplay-game-navigation")
          .getByRole("link", { name: "전체 게임", exact: true })
          .count(),
        1,
      );
      const topbarBounds = await page.locator(".yut-topbar").boundingBox();
      const stageBounds = await page.locator(".yut-match-stage").boundingBox();
      assert.ok(
        stageBounds.y >= topbarBounds.y + topbarBounds.height - 1,
        "topbar does not cover board stage",
      );
      const buttonStyle = await page
        .getByRole("button", { name: "윷 던지기", exact: true })
        .evaluate((node) => ({
          radius: getComputedStyle(node).borderRadius,
          size: getComputedStyle(node).fontSize,
          weight: getComputedStyle(node).fontWeight,
          height: node.getBoundingClientRect().height,
        }));
      assert.equal(buttonStyle.radius, "12px");
      assert.ok(
        parseFloat(buttonStyle.size) >= 16 &&
          Number(buttonStyle.weight) >= 700 &&
          buttonStyle.height >= 44,
      );
      if (width === 1280) {
        const title = await page.locator(".weplay-heading h1").boundingBox();
        const navigation = await page
          .locator(".weplay-game-navigation")
          .boundingBox();
        assert.ok(
          navigation.x > title.x + title.width &&
            Math.abs(
              navigation.y +
                navigation.height / 2 -
                (title.y + title.height / 2),
            ) < 8,
          "title and navigation share one row",
        );
      }
      await capture(page, "yut-match-" + width);
      const bounds = await page.locator(".yut-isometric-board").boundingBox();
      await fs.writeFile(
        path.join(evidence, `layout-${width}.json`),
        JSON.stringify(
          await page.evaluate(() =>
            Object.fromEntries(
              [
                ".weplay-heading",
                ".weplay-game-frame",
                ".yut-game",
                ".yut-topbar",
                ".yut-match",
                ".yut-match-stage",
                ".yut-board-area",
                ".yut-isometric-board",
                ".yut-isometric-board-wrap",
                ".yut-action-dock",
                ".yut-event",
              ].map((selector) => {
                const el = document.querySelector(selector),
                  style = getComputedStyle(el),
                  rect = el.getBoundingClientRect();
                return [
                  selector,
                  {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    paddingTop: style.paddingTop,
                    paddingBottom: style.paddingBottom,
                    marginTop: style.marginTop,
                    maxWidth: style.maxWidth,
                    boardWidth: style.getPropertyValue("--yut-board-max-width"),
                  },
                ];
              }),
            ),
          ),
          null,
          2,
        ),
      );
      if (width === 1280)
        assert.ok(
          bounds.width >= 750,
          "desktop board remains at least 750px wide at 720px height",
        );
      if (width === 390)
        assert.ok(
          bounds.width >= 450,
          "landscape board fills available middle",
        );
      await page
        .getByRole("button", { name: "게임 규칙 보기", exact: true })
        .click();
      await page.getByRole("dialog", { name: "윷판의 약속" }).waitFor();
      await page.keyboard.press("Escape");
      await throwWithPower(page);
      await page.locator(".yut-throw-3d.is-rolling").waitFor();
      assert.equal(
        await page.locator(".yut-isometric-destination").count(),
        0,
        "no move destinations before landing",
      );
      await page.waitForTimeout(850);
      await capture(page, "yut-3d-flight-" + width);
      await page.locator(".yut-landing-result").waitFor();
      assert.equal(await page.locator(".yut-isometric-destination").count(), 0);
      await capture(page, "yut-large-result-" + width);
      await page.locator(".yut-isometric-destination").first().waitFor();
      assert.ok(await page.locator(".yut-player-last").count());
      await capture(page, "yut-move-" + width);
      await page.locator(".yut-isometric-destination").first().click();
      assert.ok(
        (await page.locator(".yut-isometric-board .is-preview").count()) ||
          (await page
            .getByRole("button", { name: "결정", exact: true })
            .isEnabled()),
      );
      await capture(page, "yut-route-selected-" + width);
      await page.getByRole("button", { name: "결정", exact: true }).click();
      assert.equal(
        await page.evaluate(() => window.yutQA.calls.length),
        before,
        "preview must not call backend",
      );
      await page.close();
    }
    checks.push(
      "Portrait 320/390/768 shows rotation gate without room-start controls; 640/844/1024 landscape and 1280/1440 desktop support waiting/play/throw/move/rules without network writes or overflow; class selector removed.",
    );
    const full = await open(
      844,
      "portal=teacher&uid=qa-fullscreen&real-fullscreen=1",
      390,
    );
    await skip(full);
    await full
      .getByRole("button", { name: "대기실부터 체험하기", exact: true })
      .click();
    await full.waitForFunction(() =>
      document.fullscreenElement?.classList.contains("yut-game"),
    );
    await full
      .getByRole("button", { name: "윷판 펼치기", exact: true })
      .click();
    await full
      .getByRole("button", { name: "윷 던지기", exact: true })
      .waitFor();
    const fullBounds = await full.locator(".yut-game").boundingBox();
    const fullButton = await full
      .getByRole("button", { name: "윷 던지기", exact: true })
      .boundingBox();
    assert.equal(
      Math.round(fullBounds.y),
      0,
      "fullscreen starts at viewport top",
    );
    assert.equal(
      Math.round(fullBounds.height),
      390,
      "fullscreen uses viewport height",
    );
    assert.ok(
      fullButton.y + fullButton.height <= 390,
      "throw remains visible in fullscreen",
    );
    assert.equal(
      await full
        .locator(".yut-topbar")
        .getByRole("button", { name: /소리 (켜기|끄기)/ })
        .count(),
      1,
      "fullscreen retains mute",
    );
    await full.screenshot({
      path: path.join(evidence, "yut-fullscreen-844.png"),
      fullPage: false,
    });
    await full
      .getByRole("button", { name: "전체 화면 나가기", exact: true })
      .click();
    await full.waitForFunction(() => !document.fullscreenElement);
    await full.close();
    checks.push(
      "Native fullscreen at844×390 keeps the title, sound, exit, board and throw action visible.",
    );
    if (process.env.YUT_QA_ONLY_UI === "1") {
      await fs.writeFile(
        path.join(evidence, "ui-report.json"),
        JSON.stringify({ checks, errors }, null, 2),
      );
      console.log(checks.join("\n"));
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
      process.exit(0);
    }
    await fetch(base + "/qa/reset");
    const host = await open(1280, "portal=student&uid=qa-host");
    await skip(host);
    const guest = await open(844, "portal=student&uid=qa-guest", 390);
    await skip(guest);
    await host
      .getByRole("button", { name: "새 판 만들기", exact: true })
      .click();
    const createDialog = host.getByRole("dialog", { name: "새 판 만들기" });
    await createDialog.getByRole("checkbox").check();
    await createDialog
      .getByRole("button", { name: "만들기", exact: true })
      .click();
    await host.getByRole("heading", { name: "한 판의 인연" }).waitFor();
    await host
      .getByRole("button", { name: "4번 자리 막기", exact: true })
      .click();
    await host
      .getByRole("button", { name: "4번 자리 열기", exact: true })
      .waitFor();
    await host
      .getByRole("button", { name: "3번 자리 막기", exact: true })
      .click();
    await host
      .getByRole("button", { name: "3번 자리 열기", exact: true })
      .waitFor();
    assert.deepEqual(room.blockedSeats, [2, 3]);
    assert.equal(
      await host
        .getByRole("button", { name: "2번 자리 막기", exact: true })
        .isEnabled(),
      false,
    );
    await capture(host, "yut-online-two-seat-waiting");
    assert.equal(
      await host
        .getByRole("button", { name: "윷판 펼치기", exact: true })
        .isEnabled(),
      false,
    );
    await guest.getByLabel("비밀방 코드").fill("AB2345");
    await guest.getByRole("button", { name: "들어가기", exact: true }).click();
    await guest.getByRole("heading", { name: "한 판의 인연" }).waitFor();
    await guest.getByRole("button", { name: "준비 완료", exact: true }).click();
    // Capture the revision only after the preceding ready command is acknowledged.
    await guest
      .getByRole("button", { name: "준비 취소", exact: true })
      .waitFor();
    const emoteRevision = room.revision;
    await guest.getByRole("button", { name: "감정표현", exact: true }).click();
    await guest.getByRole("button", { name: "으으!", exact: true }).click();
    await host.locator('[data-emote-kind="angry"]').waitFor();
    assert.equal(
      room.revision,
      emoteRevision,
      "emotes do not invalidate game commands",
    );
    await guest.getByRole("button", { name: "감정표현", exact: true }).click();
    assert.equal(
      await guest
        .getByRole("button", { name: "좋아요!", exact: true })
        .isEnabled(),
      false,
    );
    await guest.keyboard.press("Escape");
    await host
      .getByRole("button", { name: "윷판 펼치기", exact: true })
      .click();
    await host
      .getByRole("button", { name: "윷 던지기", exact: true })
      .waitFor();
    await guest.locator(".yut-board").waitFor();
    assert.equal(
      await guest
        .getByRole("button", { name: "윷 던지기", exact: true })
        .count(),
      0,
    );
    await throwWithPower(host);
    await host.locator(".yut-landing-result").waitFor();
    assert.equal(
      await host
        .locator(".yut-landing-result")
        .innerText()
        .then((text) => text.includes("개!")),
      true,
    );
    await capture(host, "yut-online-large-result");
    await host
      .getByRole("button", { name: /바깥길, 바깥 2칸 경로 선택/ })
      .click();
    assert.equal(
      room.players[0].pieces[0].node,
      "home",
      "route selection does not move before confirmation",
    );
    await host.getByRole("button", { name: "결정", exact: true }).click();
    await guest
      .getByRole("button", { name: "윷 던지기", exact: true })
      .waitFor();
    assert.equal(room.players[0].pieces[0].node, "o2");
    await capture(host, "yut-online-host");
    await capture(guest, "yut-online-guest");
    await guest.reload();
    await skip(guest);
    await guest
      .getByRole("button", { name: "윷 던지기", exact: true })
      .waitFor();
    await throwWithPower(guest);
    await guest
      .getByRole("button", { name: /바깥길, 바깥 1칸 경로 선택/ })
      .click();
    await guest.getByRole("button", { name: "결정", exact: true }).click();
    await host
      .getByRole("button", { name: "윷 던지기", exact: true })
      .waitFor();
    assert.equal(room.players[1].pieces[0].node, "o1");
    await guest.getByRole("button", { name: "방 나가기", exact: true }).click();
    await guest
      .getByRole("dialog")
      .getByRole("button", { name: "방 나가기", exact: true })
      .click();
    await host
      .getByRole("heading", { name: "첫째 학생", exact: true })
      .waitFor();
    await capture(host, "yut-result");
    assert.equal(room.status, "finished");
    assert.equal(room.winnerUid, "qa-host");
    await host.close();
    await guest.close();
    checks.push(
      "Two independent browsers create/join/ready/start, enforce turn visibility, synchronize both moves, reload/rejoin the same match, and settle when opponent leaves.",
    );
    await fetch(base + "/qa/reset");
    const recovery = await open(844, "portal=student&uid=qa-recovery", 390);
    await skip(recovery);
    await recovery
      .getByRole("button", { name: "새 판 만들기", exact: true })
      .waitFor();
    await recovery.evaluate(() => {
      window.yutQA.dropNextResponse = true;
    });
    await recovery
      .getByRole("button", { name: "새 판 만들기", exact: true })
      .click();
    await recovery
      .getByRole("dialog", { name: "새 판 만들기" })
      .getByRole("button", { name: "만들기", exact: true })
      .click();
    await recovery
      .getByRole("button", { name: "방 상태 다시 확인", exact: true })
      .waitFor();
    assert.equal(
      await recovery
        .getByRole("button", { name: "새 판 만들기", exact: true })
        .isEnabled(),
      false,
    );
    assert.equal(
      commands.filter((command) => command.action === "create").length,
      1,
    );
    await recovery
      .getByRole("button", { name: "방 상태 다시 확인", exact: true })
      .click();
    await recovery.getByRole("heading", { name: "한 판의 인연" }).waitFor();
    assert.equal(
      commands.filter((command) => command.action === "create").length,
      1,
    );
    await capture(recovery, "yut-response-recovery");
    await recovery.close();
    checks.push(
      "Lost create response blocks duplicate commands; authoritative refresh restores the one committed room.",
    );
    await fetch(base + "/qa/reset");
    const solo = await open(1280, "portal=student&uid=qa-solo", 800, "reduce");
    await skip(solo);
    await solo.getByRole("button", { name: "2명", exact: true }).click();
    await solo
      .getByRole("button", { name: "혼자서 시작", exact: true })
      .click();
    await solo
      .getByRole("button", { name: "윷 던지기", exact: true })
      .waitFor();
    assert.equal(await solo.locator(".yut-player").count(), 2);
    await capture(solo, "yut-student-single");
    await solo.getByRole("button", { name: "감정표현", exact: true }).click();
    await solo.getByRole("button", { name: "우와!", exact: true }).click();
    await solo.locator('[data-emote-kind="wow"]').waitFor();
    const started = Date.now();
    const soloThrow = solo.getByRole("button", {
      name: "윷 던지기",
      exact: true,
    });
    await soloThrow.focus();
    await solo.keyboard.down("Space");
    await solo.waitForTimeout(350);
    await solo.keyboard.press("Escape");
    await solo.keyboard.up("Space");
    assert.equal(
      await solo.locator(".yut-throw-3d.is-rolling").count(),
      0,
      "Escape cancels charging without a throw",
    );
    await throwWithPower(solo);
    await solo.locator(".yut-throw-3d.is-rolling").waitFor();
    await solo.waitForTimeout(700);
    assert.equal(
      await solo.locator(".yut-isometric-destination").count(),
      0,
      "reduced motion still shows flight",
    );
    await capture(solo, "yut-reduced-motion-flight");
    await solo.locator(".yut-isometric-destination").first().waitFor();
    assert.ok(
      Date.now() - started >= 3500,
      "flight and result hold are not skipped under reduced motion",
    );
    await solo.locator(".yut-isometric-destination").first().click();
    await solo.getByRole("button", { name: "결정", exact: true }).click();
    await solo
      .getByRole("button", { name: "윷 던지기", exact: true })
      .waitFor({ timeout: 45000 });
    assert.equal(
      await solo.evaluate(
        () =>
          window.yutQA.calls.filter((call) => call.endpoint === "command")
            .length,
      ),
      0,
      "solo bot play has no server commands; publication reads remain active",
    );
    assert.equal(commands.length, 0);
    await solo.setViewportSize({ width: 390, height: 844 });
    await solo
      .getByText("휴대폰을 가로로 돌려 주세요.", { exact: true })
      .waitFor();
    await solo.waitForTimeout(1500);
    await solo.setViewportSize({ width: 844, height: 390 });
    await solo
      .getByRole("button", { name: "윷 던지기", exact: true })
      .waitFor();
    await solo.close();
    checks.push(
      "Student 2-player single mode plays with one randomized bot without server writes; angry emote synchronizes online, cooldown blocks repeat, game revision stays stable; reduced-motion flight and large result remain visible; Escape cancels charging and portrait pauses/restores solo.",
    );
  }
  await fetch(base + "/qa/reset");
  const fast = await open(1280, "portal=student&uid=qa-fast");
  await skip(fast);
  await fast
    .getByRole("button", { name: "여럿이서 시작", exact: true })
    .click();
  await fast.getByRole("heading", { name: "한 판의 인연" }).waitFor();
  assert.equal(room.visibility, "public");
  assert.equal(room.players[0].pieces.length, 1);
  const fastGuest = await open(1280, "portal=student&uid=qa-fast-guest");
  await skip(fastGuest);
  await fastGuest
    .getByRole("button", { name: "여럿이서 시작", exact: true })
    .click();
  await fastGuest
    .getByRole("button", { name: "준비 완료", exact: true })
    .click();
  await fast.getByRole("button", { name: "윷판 펼치기", exact: true }).click();
  await fastGuest
    .getByRole("button", { name: "윷 던지기", exact: true })
    .waitFor({ timeout: 12000 });
  assert.equal(
    commands.filter((command) => command.action === "skip").length,
    1,
    "expired 5-second throw automatically advances exactly once",
  );
  await fetch(base + "/qa/settings?allowMultiplayer=false");
  await fast.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await fast
    .getByRole("button", { name: "혼자서 시작", exact: true })
    .waitFor();
  assert.equal(
    await fast.locator(".yut-board").count(),
    0,
    "live multiplayer option stops the active match",
  );
  assert.equal(
    await fast
      .getByRole("button", { name: "여럿이서 시작", exact: true })
      .isEnabled(),
    false,
  );
  await fast.close();
  await fastGuest.close();
  await fetch(base + "/qa/reset");
  const liveSolo = await open(1280, "portal=student&uid=qa-live-solo");
  await skip(liveSolo);
  await liveSolo
    .getByRole("button", { name: "혼자서 시작", exact: true })
    .click();
  await liveSolo.locator(".yut-board").waitFor();
  await fetch(base + "/qa/settings?allowSolo=false");
  await liveSolo.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await liveSolo
    .getByRole("button", { name: "혼자서 시작", exact: true })
    .waitFor();
  assert.equal(
    await liveSolo.locator(".yut-board").count(),
    0,
    "live solo option stops local play",
  );
  assert.equal(
    await liveSolo
      .getByRole("button", { name: "혼자서 시작", exact: true })
      .isEnabled(),
    false,
  );
  await liveSolo.close();
  await fetch(base + "/qa/reset");
  const privateMode = await open(1280, "portal=student&uid=qa-private-mode");
  await skip(privateMode);
  await privateMode
    .getByRole("button", { name: "새 판 만들기", exact: true })
    .click();
  await privateMode
    .getByRole("dialog")
    .getByRole("button", { name: "2명", exact: true })
    .click();
  await privateMode.getByRole("dialog").getByRole("checkbox").check();
  await privateMode
    .getByRole("dialog")
    .getByRole("button", { name: "만들기", exact: true })
    .click();
  await privateMode.getByRole("heading", { name: "한 판의 인연" }).waitFor();
  assert.equal(room.maxPlayers, 2);
  assert.equal(room.visibility, "private");
  await fetch(base + "/qa/settings?allowPrivateRooms=false");
  await privateMode.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await privateMode
    .getByRole("button", { name: "여럿이서 시작", exact: true })
    .waitFor();
  assert.equal(
    await privateMode
      .getByRole("button", { name: "여럿이서 시작", exact: true })
      .isEnabled(),
    true,
    "private mode closure leaves public mode available",
  );
  assert.equal(
    await privateMode.getByRole("heading", { name: "한 판의 인연" }).count(),
    0,
  );
  await privateMode.close();
  await fetch(base + "/qa/reset");
  await fetch(base + "/qa/settings?uid=qa-quota&remaining=0");
  const quota = await open(1280, "portal=student&uid=qa-quota");
  await skip(quota);
  await quota
    .getByText("오늘 비밀방 참가 0/5회 남음", { exact: true })
    .waitFor();
  await quota.getByLabel("비밀방 코드", { exact: true }).fill("AB2345");
  assert.equal(
    await quota
      .getByRole("button", { name: "들어가기", exact: true })
      .isEnabled(),
    false,
  );
  await quota
    .getByRole("button", { name: "새 판 만들기", exact: true })
    .click();
  assert.equal(
    await quota.getByRole("dialog").getByRole("checkbox").isEnabled(),
    false,
  );
  await quota.keyboard.press("Escape");
  await quota.close();
  checks.push(
    "Public random matchmaking joins one room; new games use one pawn; five-second throw expiry advances automatically; live solo/multiplayer/private switches stop affected rooms while public mode remains available; exhausted private quota disables create/join.",
  );
  assert.deepEqual(errors, []);
} finally {
  await fs.writeFile(
    path.join(
      evidence,
      process.env.YUT_QA_ONLY_MODES === "1"
        ? "browser-mode-report.json"
        : "browser-report.json",
    ),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
  server.close();
}
console.log(checks.join("\n"));
