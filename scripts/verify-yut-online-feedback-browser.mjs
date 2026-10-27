/** Actual YutGame UI with two synthetic clients and delayed localhost transport.
 * No production authentication, room data, or mutations are used.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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
const evidence = path.join(root, "output/yut-online-feedback-20261027");
await fs.mkdir(evidence, { recursive: true });
const modulePath = (value) =>
  JSON.stringify(path.join(root, value).replaceAll("\\", "/"));
const service = `
const uid=new URLSearchParams(location.search).get('uid');
const config={year:'2026',semester:'2'};
export const useAuth=()=>({config,currentUser:{uid},userData:{uid,role:'student',name:uid}});
const qa=window.yutQA={calls:[],delayNextMs:0,delayReplyMs:0,delayLobbyMs:0,lobbyPending:0,dropNextReply:false,freezeSnapshots:false,terminateSubscription:false,subscriptions:0,subscriptionEvents:[]};
export const YUT_PRIVATE_DAILY_LIMIT=5;
export const DEFAULT_YUT_SETTINGS={enabled:true,version:1,allowSolo:true,allowMultiplayer:true,allowPrivateRooms:true,defaultPlayerCount:2,throwSeconds:15,moveSeconds:60};
export const normalizeYutSettings=value=>({...DEFAULT_YUT_SETTINGS,...value});
async function request(endpoint,data){
  const lobby=endpoint==='lobby',lobbyDelay=lobby?qa.delayLobbyMs:0;
  if(lobby){qa.delayLobbyMs=0;qa.lobbyPending++;}
  const meta=data?{delay:qa.delayNextMs,replyDelay:qa.delayReplyMs,drop:qa.dropNextReply}:{};
  qa.delayNextMs=0;qa.delayReplyMs=0;qa.dropNextReply=false;
  qa.calls.push({endpoint,data,at:Date.now()});
  try{
  if(lobbyDelay)await new Promise(resolve=>setTimeout(resolve,lobbyDelay));
  const response=await fetch('/qa/'+endpoint+'?uid='+uid,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify({data,meta}):undefined});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error),{code:'aborted'});
  if(meta.drop)throw Object.assign(new Error('검증용 응답 유실'),{code:'unavailable'});
  return result;
  }finally{if(lobby)qa.lobbyPending--;}
}
export const getYutLobby=()=>request('lobby');
export const commandYutRoom=(_config,data)=>request('command',data);
export function subscribeYutRoom(_config,id,onRoom,onError,onConnectionChange){
  qa.subscriptions++;
  qa.subscriptionEvents.push({id,at:Date.now(),lobbyPending:qa.lobbyPending});
  let active=true,last=-1;
  const read=async()=>{try{if(!active)return;if(qa.terminateSubscription){qa.terminateSubscription=false;active=false;onError(Object.assign(new Error('검증용 구독 종료'),{code:'unavailable'}));return;}if(qa.freezeSnapshots)return;const response=await fetch('/qa/state?uid='+uid);const value=await response.json();if(active&&!value.room){active=false;onError(Object.assign(new Error('검증용 참가 권한 만료'),{code:'permission-denied'}));return;}const revision=value.room?.syncRevision??value.room?.revision??-2;if(active){onConnectionChange?.(true);if(revision!==last){last=revision;onRoom(value.room);}}}catch(error){if(active)onError(error);}};
  read();const timer=setInterval(read,60);return()=>{active=false;clearInterval(timer);};
}
export const yutErrorMessage=error=>error.message;
`;
const harness = `
import React from 'react';import{createRoot}from'react-dom/client';
import Game from ${modulePath("src/components/common/weplay/yut/YutGame.tsx")};
import ${modulePath("src/assets/index.css")};import ${modulePath("assets/css/style.css")};
const music={enabled:false,failed:false,start(){},toggle(){}};
createRoot(document.getElementById('root')).render(<Game portal="student" music={music} onBack={()=>{}} onMusicActiveChange={()=>{}}/>);
`;
const bundled = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "westory-yut-online-feedback.js"),
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
const fonts = new Map(
  bundled.outputFiles
    .filter((file) => /\.woff2?$/.test(file.path))
    .map((file) => [
      "/" + path.relative(os.tmpdir(), file.path).replaceAll("\\", "/"),
      file.contents,
    ]),
);
const hostUid = "qa-feedback-host",
  guestUid = "qa-feedback-guest";
const names = { [hostUid]: "첫째 학생", [guestUid]: "둘째 학생" };
let room;
const receipts = new Map(),
  calls = [],
  commits = [];
function resetRoom() {
  const now = Date.now();
  room = core.createYutRoom({
    id: "feedback-room",
    code: "AB2345",
    classId: "",
    classLabel: "함께하는 윷판",
    host: { uid: hostUid, name: names[hostUid] },
    nowMs: now,
    visibility: "private",
    maxPlayers: 2,
    throwSeconds: 15,
    moveSeconds: 60,
  });
  room = core.addYutPlayer(room, { uid: guestUid, name: names[guestUid] }, now);
}
resetRoom();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function roomFor(uid) {
  return room?.participantUids.includes(uid) && room.status !== "closed"
    ? room
    : null;
}
const server = http.createServer(async (request, response) => {
  const json = (value) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(value));
  };
  try {
    const url = new URL(request.url, "http://127.0.0.1"),
      uid = url.searchParams.get("uid");
    if (url.pathname === "/qa/lobby")
      return json({
        enabled: true,
        settings: {
          enabled: true,
          version: 1,
          allowSolo: true,
          allowMultiplayer: true,
          allowPrivateRooms: true,
          defaultPlayerCount: 2,
          throwSeconds: 15,
          moveSeconds: 60,
        },
        privatePlaysRemaining: 5,
        room: roomFor(uid),
        classes: [],
        classId: "",
        serverNowMs: Date.now(),
      });
    if (url.pathname === "/qa/state") return json({ room: roomFor(uid) });
    if (url.pathname === "/qa/rejoin") {
      room = core.addYutPlayer(
        room,
        { uid: guestUid, name: names[guestUid] },
        Date.now(),
      );
      return json({ ok: true });
    }
    if (url.pathname === "/qa/expire-turn") {
      room = {
        ...room,
        phaseStartsAtMs: Date.now() - 16000,
        turnDeadlineMs: Date.now() - 100,
        revision: room.revision + 1,
        syncRevision: room.syncRevision + 1,
      };
      return json({ ok: true });
    }
    if (url.pathname === "/qa/command") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const { data, meta } = JSON.parse(Buffer.concat(chunks).toString());
      calls.push({ uid, ...data });
      if (meta.delay) await delay(meta.delay);
      const receipt = uid + ":" + data.requestKey;
      if (receipts.has(receipt))
        return json({ room: roomFor(uid), serverNowMs: Date.now() });
      if (data.action !== "emote" && data.expectedRevision !== room.revision)
        throw new Error("방 상태가 바뀌었습니다.");
      const now = Date.now();
      switch (data.action) {
        case "ready":
          room = core.readyYutPlayer(room, uid, data.ready, now);
          break;
        case "start":
          room = core.startYutGame(room, now);
          break;
        case "kick":
          room = core.kickYutPlayer(room, uid, data.targetUid, now);
          break;
        case "emote":
          room = core.addYutEmote(room, uid, data.kind, data.requestKey, now);
          break;
        case "throw":
          room = core.throwYut(
            room,
            uid,
            uid === hostUid
              ? [true, true, false, false]
              : [true, false, false, false],
            now,
            data.power,
          );
          break;
        case "move":
          room = core.moveYut(
            room,
            uid,
            data.pieceId,
            data.route,
            now,
            data.stack,
          );
          break;
        case "skip":
          room = core.skipYutTurn(room, now);
          break;
        default:
          throw new Error("Unexpected fixture action: " + data.action);
      }
      receipts.set(receipt, true);
      commits.push({ uid, ...data });
      const result = { room: roomFor(uid), serverNowMs: now };
      if (meta.replyDelay) await delay(meta.replyDelay);
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
    if (fonts.has(url.pathname)) return response.end(fonts.get(url.pathname));
    if (url.pathname.startsWith("/assets/")) {
      const target = path.resolve(root, "public", "." + url.pathname);
      assert.ok(target.startsWith(path.join(root, "public") + path.sep));
      response.setHeader(
        "Content-Type",
        {
          ".webp": "image/webp",
          ".svg": "image/svg+xml",
          ".wav": "audio/wav",
          ".woff2": "font/woff2",
        }[path.extname(target)] || "application/octet-stream",
      );
      return response.end(await fs.readFile(target));
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>*,::before,::after{box-sizing:border-box}body{margin:0}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>',
    );
  } catch (error) {
    response.statusCode = 409;
    json({ error: error.message });
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  errors = [],
  pages = [];
async function open(uid, width = 1280, height = 800) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  pages.push(page);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort(),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => {} },
    });
  });
  await page.goto(base + "/?uid=" + uid, { waitUntil: "domcontentloaded" });
  await page.locator(".yut-waiting").waitFor();
  return page;
}
async function unobstructed(page, label) {
  assert.equal(
    await page.locator(".weplay-game-loading").count(),
    0,
    label + ": no loading overlay",
  );
  assert.equal(
    await page.locator(".yut-game-content[inert]").count(),
    0,
    label + ": game remains interactive",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "게임 규칙 보기", exact: true })
      .isEnabled(),
    true,
    label + ": tools remain enabled",
  );
}
async function delayed(page, action, run, { reply = false, ms = 3100 } = {}) {
  await page.evaluate(
    ({ reply, ms }) => {
      window.yutQA[reply ? "delayReplyMs" : "delayNextMs"] = ms;
    },
    { reply, ms },
  );
  const count = calls.filter(
    (call) =>
      call.uid === new URL(page.url()).searchParams.get("uid") &&
      call.action === action,
  ).length;
  await run();
  await page.waitForFunction(
    (action) => window.yutQA.calls.some((call) => call.data?.action === action),
    action,
  );
  if (action === "throw" || action === "move") {
    const control = page.getByRole("button", {
      name: action === "throw" ? "윷 던지기" : "결정",
      exact: true,
    });
    if (await control.count()) {
      assert.equal(
        await control.isEnabled(),
        false,
        action + ": only the command control is disabled",
      );
      const box = await control.boundingBox();
      if (box)
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
          clickCount: 2,
        });
    }
  }
  await page.waitForTimeout(450);
  await unobstructed(page, action + " delayed");
  await page.waitForTimeout(2300);
  await unobstructed(page, action + " after old 2.5s overlay threshold");
  if (action === "throw")
    await page.screenshot({ path: path.join(evidence, "delayed-throw.png") });
  assert.equal(
    calls.filter(
      (call) =>
        call.uid === new URL(page.url()).searchParams.get("uid") &&
        call.action === action,
    ).length,
    count + 1,
    action + ": exactly one command while pending",
  );
  await page.waitForTimeout(Math.max(0, ms - 2750) + 150);
}
async function throwYut(page) {
  const button = page.getByRole("button", { name: "윷 던지기", exact: true });
  await button.waitFor();
  await page.waitForFunction(
    () => !!document.querySelector('[aria-label="윷 던지기"]:not(:disabled)'),
  );
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(180);
  await page.mouse.up();
}
async function chooseMove(page) {
  const piece = page.getByRole("button", { name: "1번 말 출발", exact: true });
  await piece.waitFor();
  if (await piece.isEnabled()) await piece.click();
  await page.locator(".yut-isometric-destination").first().click();
}
try {
  const host = await open(hostUid),
    guest = await open(guestUid);
  for (const [width, height] of [
    [1280, 800],
    [768, 640],
    [844, 390],
  ]) {
    await host.setViewportSize({ width, height });
    const before = await host.locator(".yut-waiting").boundingBox();
    await host
      .getByRole("button", { name: "방 코드 복사", exact: true })
      .click();
    await host.getByText("방 코드를 복사했습니다.", { exact: true }).waitFor();
    const after = await host.locator(".yut-waiting").boundingBox();
    assert.deepEqual(
      after,
      before,
      "copy popup must not move waiting layout at " + width,
    );
    assert.equal(
      await host
        .locator(".yut-message")
        .evaluate((el) => getComputedStyle(el).position),
      "absolute",
    );
    await host.screenshot({ path: path.join(evidence, `copy-${width}.png`) });
    await host.getByRole("button", { name: "알림 닫기", exact: true }).click();
  }
  await host.setViewportSize({ width: 1280, height: 800 });
  checks.push(
    "Copy feedback overlays the existing waiting layout without shifting it at 1280, 768, and 844×390.",
  );
  console.log("PASS copy overlay geometry");
  assert.equal(
    await host.locator(".yut-seat-kick").count(),
    1,
    "host can remove only the unready guest",
  );
  assert.equal(
    await guest.locator(".yut-seat-kick").count(),
    0,
    "guest has no host kick control",
  );
  await delayed(guest, "ready", () =>
    guest.getByRole("button", { name: "준비 완료", exact: true }).click(),
  );
  await host.waitForFunction(
    () => document.querySelectorAll(".yut-seat-kick").length === 0,
  );
  assert.equal(room.players[1].ready, true);
  await guest.getByRole("button", { name: "준비 취소", exact: true }).click();
  await host.locator(".yut-seat-kick").waitFor();
  const guestLobbyReadsBeforeKick = await guest.evaluate(
    () => window.yutQA.calls.filter((call) => call.endpoint === "lobby").length,
  );
  await host.locator(".yut-seat-kick").click();
  await guest.locator(".yut-waiting").waitFor({ state: "detached" });
  await guest
    .getByText("방에서 나왔습니다. 새 방에 참가할 수 있습니다.", {
      exact: true,
    })
    .waitFor();
  await guest.waitForTimeout(200);
  assert.equal(
    await guest.evaluate(
      () =>
        window.yutQA.calls.filter((call) => call.endpoint === "lobby").length,
    ),
    guestLobbyReadsBeforeKick + 1,
    "permission-denied reconciles membership once without polling or a retry click",
  );
  assert.equal(room.participantUids.includes(guestUid), false);
  assert.equal(commits.filter((call) => call.action === "kick").length, 1);
  await fetch(base + "/qa/rejoin");
  await guest.reload();
  await guest.locator(".yut-waiting").waitFor();
  checks.push(
    "Host-only kick control appears for an unready guest, disappears when ready, and the guest's permission-denied stream error triggers exactly one authoritative membership read and automatic exit.",
  );
  console.log("PASS ready and kick");

  const subscriptionsBefore = await host.evaluate(
    () => window.yutQA.subscriptions,
  );
  await host.evaluate(() => {
    window.yutQA.terminateSubscription = true;
    window.yutQA.delayLobbyMs = 1800;
  });
  await host
    .getByRole("button", { name: "방 상태 다시 확인", exact: true })
    .click();
  await host.waitForFunction(() => window.yutQA.lobbyPending === 1);
  await host.waitForTimeout(600);
  assert.equal(
    await host.evaluate(() => window.yutQA.subscriptions),
    subscriptionsBefore,
    "no subscription starts while authoritative lobby recovery is pending",
  );
  await unobstructed(host, "terminal listener recovery pending");
  await host.waitForFunction(
    (previous) => window.yutQA.subscriptions > previous,
    subscriptionsBefore,
  );
  await host.waitForTimeout(300);
  assert.equal(
    await host.evaluate(() => window.yutQA.subscriptions),
    subscriptionsBefore + 1,
    "successful lobby recovery resumes exactly one subscription",
  );
  assert.equal(
    await host.evaluate(() =>
      window.yutQA.subscriptionEvents.every(
        (event) => event.lobbyPending === 0,
      ),
    ),
    true,
    "all room subscriptions start after lobby requests finish",
  );
  await host
    .getByRole("button", { name: "방 상태 다시 확인", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    await host.locator(".yut-waiting").count(),
    1,
    "listener recovery retains the room",
  );
  await guest.getByRole("button", { name: "감정표현", exact: true }).click();
  await guest.getByRole("button", { name: "안녕!", exact: true }).click();
  await host.locator('[data-emote-kind="hello"]').waitFor();
  checks.push(
    "A terminal snapshot error followed by explicit retry keeps the room while lobby recovery is pending, opens exactly one fresh subscription after it succeeds, and receives the opponent's next emote.",
  );
  console.log("PASS terminal subscription recovery");

  await host.getByRole("button", { name: "감정표현", exact: true }).click();
  const hostActivityBefore = room.hostActivityAtMs;
  await delayed(host, "emote", () =>
    host.getByRole("button", { name: "준비!", exact: true }).click(),
  );
  await guest.locator('[data-emote-kind="ready"]').waitFor();
  assert.ok(room.hostActivityAtMs > hostActivityBefore);
  assert.equal(room.expiresAtMs, room.hostActivityAtMs + core.YUT_WAITING_MS);
  await guest.getByRole("button", { name: "준비 완료", exact: true }).click();
  await host.getByRole("button", { name: "게임 시작", exact: true }).click();
  await guest.locator(".yut-board").waitFor();
  await delayed(host, "throw", () => throwYut(host));
  assert.equal(room.pendingThrow.value, 2);
  await chooseMove(host);
  await delayed(
    host,
    "move",
    () => host.getByRole("button", { name: "결정", exact: true }).click(),
    { reply: true },
  );
  assert.equal(room.players[0].pieces[0].node, "o2");
  await guest.getByRole("button", { name: "윷 던지기", exact: true }).waitFor();
  assert.equal(await host.locator(".yut-board").count(), 1);
  checks.push(
    "Ready!, ready, throw, and move commands remain unobstructed after 3.1s delay; both clients receive the same committed move.",
  );
  console.log("PASS delayed gameplay feedback");

  await guest.evaluate(() => {
    window.yutQA.dropNextReply = true;
    window.yutQA.delayReplyMs = 3100;
    window.yutQA.freezeSnapshots = true;
  });
  await throwYut(guest);
  await guest.waitForTimeout(2800);
  await unobstructed(guest, "lost throw response pending");
  await guest
    .getByRole("button", { name: "방 상태 다시 확인", exact: true })
    .waitFor();
  assert.equal(
    await guest.locator(".yut-board").count(),
    1,
    "lost reply preserves the board",
  );
  const throwsBeforeRecovery = commits.filter(
    (call) => call.action === "throw" && call.uid === guestUid,
  ).length;
  await guest.evaluate(() => {
    window.yutQA.freezeSnapshots = false;
    window.yutQA.delayNextMs = 3100;
  });
  await guest
    .getByRole("button", { name: "방 상태 다시 확인", exact: true })
    .click();
  await guest.waitForTimeout(500);
  assert.equal(
    await guest.locator(".yut-board").count(),
    1,
    "manual recovery preserves the board",
  );
  await unobstructed(guest, "manual recovery");
  await guest
    .getByRole("button", { name: "방 상태 다시 확인", exact: true })
    .waitFor({ state: "detached", timeout: 12000 });
  assert.equal(
    commits.filter((call) => call.action === "throw" && call.uid === guestUid)
      .length,
    throwsBeforeRecovery,
    "same receipt recovers without a second throw",
  );
  await chooseMove(guest);
  await guest.getByRole("button", { name: "결정", exact: true }).click();
  await host.getByRole("button", { name: "윷 던지기", exact: true }).waitFor();
  checks.push(
    "A lost throw response and explicit receipt replay preserve the match, show no overlay, and do not apply a second throw.",
  );
  console.log("PASS lost reply recovery");

  await host.evaluate(() => {
    window.yutQA.delayNextMs = 3100;
  });
  await fetch(base + "/qa/expire-turn");
  await host.waitForFunction(() =>
    window.yutQA.calls.some((call) => call.data?.action === "skip"),
  );
  await host.waitForTimeout(700);
  await unobstructed(host, "automatic skip");
  await host.waitForTimeout(2100);
  await unobstructed(host, "delayed automatic skip");
  await guest.getByRole("button", { name: "윷 던지기", exact: true }).waitFor();
  await host.screenshot({
    path: path.join(evidence, "playing-after-recovery.png"),
  });
  assert.equal(commits.filter((call) => call.action === "skip").length, 1);
  checks.push(
    "Expired-turn skip remains nonblocking and applies once even when its reply is delayed.",
  );
  console.log("PASS automatic skip");
  assert.deepEqual(errors, []);
} finally {
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      {
        transport:
          "synthetic localhost; delays are injected, not production latency measurements",
        checks,
        errors,
        calls: calls.map(({ uid, action, requestKey }) => ({
          uid,
          action,
          requestKey,
        })),
        committed: commits.map(({ uid, action }) => ({ uid, action })),
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(checks.join("\n"));
