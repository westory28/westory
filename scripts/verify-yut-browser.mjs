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
const evidence = path.join(root, "output/yut-20261018");
await fs.mkdir(evidence, { recursive: true });
const modulePath = (value) =>
  JSON.stringify(path.join(root, value).replaceAll("\\", "/"));
const service = `
const params=new URLSearchParams(location.search);
const uid=params.get('uid')||'qa-teacher';
export const useAuth=()=>({config:{year:'2026',semester:'2'},currentUser:{uid,email:'qa@yongshin-ms.ms.kr'},userData:{uid,role:params.get('portal')==='student'?'student':'teacher',name:'검증 교사'}});
const qa=window.yutQA={calls:[],failNext:false,dropNextResponse:false};
async function request(endpoint,data){qa.calls.push({endpoint,data});if(qa.failNext){qa.failNext=false;throw new Error('검증용 연결 오류: 다시 시도해 주세요.');}const response=await fetch('/qa/'+endpoint+'?uid='+uid,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error),{code:'aborted'});if(qa.dropNextResponse){qa.dropNextResponse=false;throw new Error('응답 연결이 끊겼습니다.');}return result;}
export const getYutLobby=()=>request('lobby');
export const commandYutRoom=(_config,data)=>request('command',data);
export function subscribeYutRoom(_config,roomId,onRoom,onError){let stopped=false,last=-1;const read=async()=>{try{const response=await fetch('/qa/state?uid='+uid);const value=await response.json();if(!stopped&&(value.room?.revision??-2)!==last){last=value.room?.revision??-2;onRoom(value.room);}}catch(error){if(!stopped)onError(error);}};read();const timer=setInterval(read,100);return()=>{stopped=true;clearInterval(timer);};}
export const yutErrorMessage=error=>error?.message||'다시 시도해 주세요.';
`;
const harness = `
import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import Entry from ${modulePath("src/components/common/weplay/YutGameEntry.tsx")};
import {AppDialogProvider} from ${modulePath("src/components/common/AppDialogProvider.tsx")};
import ${modulePath("src/assets/index.css")};import ${modulePath("assets/css/style.css")};
const params=new URLSearchParams(location.search),portal=params.get('portal')==='student'?'student':'teacher';
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/'+portal+'/weplay?game=joseon-yut'+(params.has('preview')?'&view=preview':'')]}><AppDialogProvider><Entry portal={portal}/></AppDialogProvider></MemoryRouter>);
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
      commands.length = 0;
      history.clear();
      throwIndex = 0;
      return json({ ok: true });
    }
    if (url.pathname === "/qa/lobby")
      return json({
        room:
          room?.participantUids.includes(uid) && room.status !== "closed"
            ? room
            : null,
        classes: [{ id: "qa-class", label: "1학년 1반" }],
        classId: "qa-class",
        serverNowMs: Date.now(),
      });
    if (url.pathname === "/qa/state")
      return json({ room: room?.participantUids.includes(uid) ? room : null });
    if (url.pathname === "/qa/command") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString());
      commands.push({ uid, ...data });
      if (history.has(data.requestKey))
        return json(history.get(data.requestKey));
      if (
        !["create", "join"].includes(data.action) &&
        data.expectedRevision !== room?.revision
      )
        throw new Error("방 상태가 바뀌었습니다. 다시 시도해 주세요.");
      const now = Date.now();
      if (data.action === "create")
        room = core.createYutRoom({
          id: "browser-qa-room",
          code: "AB2345",
          classId: "qa-class",
          classLabel: "1학년 1반",
          host: { uid, name: "첫째 학생" },
          nowMs: now,
        });
      else if (data.action === "join") {
        if (data.code !== "AB2345")
          throw new Error("참가 코드를 확인해 주세요.");
        room = core.addYutPlayer(room, { uid, name: "둘째 학생" }, now);
      } else if (data.action === "ready")
        room = core.readyYutPlayer(room, uid, data.ready, now);
      else if (data.action === "start") room = core.startYutGame(room, now);
      else if (data.action === "throw") {
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
        );
      } else if (data.action === "move")
        room = core.moveYut(room, uid, data.pieceId, data.route, now);
      else if (data.action === "skip") room = core.skipYutTurn(room, now);
      else if (data.action === "leave")
        room = core.leaveYutRoom(room, uid, now);
      else if (data.action === "close") room = core.closeYutRoom(room, now);
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
async function open(width, query = "") {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
  });
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
// Acceptance steps below intentionally use user-visible controls, not internal component state.
try {
  const intro = await open(1280, "portal=student&uid=qa-intro");
  await intro.getByRole("dialog", { name: "WEPLAY", exact: true }).waitFor();
  assert.equal(await intro.evaluate(() => window.yutQA?.calls.length || 0), 0);
  await intro.waitForTimeout(1050);
  await capture(intro, "studio-intro");
  await intro.keyboard.press("Escape");
  await intro
    .getByRole("button", { name: "새로운 판 만들기", exact: true })
    .waitFor();
  checks.push(
    "Studio opening precedes all game network calls; Escape skips and restores lobby.",
  );
  await intro.close();
  for (const width of [320, 390, 768, 1280, 1440]) {
    const page = await open(width, "portal=teacher&uid=qa-teacher");
    await skip(page);
    await page
      .getByRole("button", { name: "새로운 판 만들기", exact: true })
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
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
    await capture(page, "yut-match-" + width);
    await page
      .getByRole("button", { name: "게임 규칙 보기", exact: true })
      .click();
    await page.getByRole("dialog", { name: "윷판의 약속" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "윷 던지기", exact: true }).click();
    await page.locator(".yut-throw-3d.is-rolling").waitFor();
    assert.equal(
      await page.locator(".yut-isometric-destination").count(),
      0,
      "no move destinations before landing",
    );
    await page.waitForTimeout(850);
    await capture(page, "yut-3d-flight-" + width);
    await page.locator(".yut-isometric-destination").first().waitFor();
    await capture(page, "yut-move-" + width);
    await page.locator(".yut-isometric-destination").first().click();
    assert.equal(
      await page.evaluate(() => window.yutQA.calls.length),
      before,
      "preview must not call backend",
    );
    await page.close();
  }
  checks.push(
    "Teacher preview opens waiting room; play/throw/move/rules at 320/390/768/1280/1440 without network writes or horizontal overflow.",
  );
  await fetch(base + "/qa/reset");
  const host = await open(1280, "portal=student&uid=qa-host");
  await skip(host);
  const guest = await open(390, "portal=student&uid=qa-guest");
  await skip(guest);
  await host
    .getByRole("button", { name: "새로운 판 만들기", exact: true })
    .click();
  await host.getByRole("heading", { name: "한 판의 인연" }).waitFor();
  assert.equal(
    await host
      .getByRole("button", { name: "윷판 펼치기", exact: true })
      .isEnabled(),
    false,
  );
  await guest.getByLabel("친구의 방 코드").fill("AB2345");
  await guest.getByRole("button", { name: "들어가기", exact: true }).click();
  await guest.getByRole("heading", { name: "한 판의 인연" }).waitFor();
  await guest.getByRole("button", { name: "준비 완료", exact: true }).click();
  await host.getByRole("button", { name: "윷판 펼치기", exact: true }).click();
  await host.getByRole("button", { name: "윷 던지기", exact: true }).waitFor();
  await guest.locator(".yut-board").waitFor();
  assert.equal(
    await guest.getByRole("button", { name: "윷 던지기", exact: true }).count(),
    0,
  );
  await host.getByRole("button", { name: "윷 던지기", exact: true }).click();
  await host
    .getByRole("button", { name: /바깥 2칸으로 이동/, exact: true })
    .click();
  await guest.getByRole("button", { name: "윷 던지기", exact: true }).waitFor();
  assert.equal(room.players[0].pieces[0].node, "o2");
  await capture(host, "yut-online-host");
  await capture(guest, "yut-online-guest");
  await guest.reload();
  await skip(guest);
  await guest.getByRole("button", { name: "윷 던지기", exact: true }).waitFor();
  await guest.getByRole("button", { name: "윷 던지기", exact: true }).click();
  await guest
    .getByRole("button", { name: /바깥 1칸으로 이동/, exact: true })
    .click();
  await host.getByRole("button", { name: "윷 던지기", exact: true }).waitFor();
  assert.equal(room.players[1].pieces[0].node, "o1");
  await guest.getByRole("button", { name: "방 나가기", exact: true }).click();
  await guest
    .getByRole("dialog")
    .getByRole("button", { name: "방 나가기", exact: true })
    .click();
  await host.getByRole("heading", { name: "첫째 학생", exact: true }).waitFor();
  await capture(host, "yut-result");
  assert.equal(room.status, "finished");
  assert.equal(room.winnerUid, "qa-host");
  await host.close();
  await guest.close();
  checks.push(
    "Two independent browsers create/join/ready/start, enforce turn visibility, synchronize both moves, reload/rejoin the same match, and settle when opponent leaves.",
  );
  await fetch(base + "/qa/reset");
  const recovery = await open(390, "portal=student&uid=qa-recovery");
  await skip(recovery);
  await recovery
    .getByRole("button", { name: "새로운 판 만들기", exact: true })
    .waitFor();
  await recovery.evaluate(() => {
    window.yutQA.dropNextResponse = true;
  });
  await recovery
    .getByRole("button", { name: "새로운 판 만들기", exact: true })
    .click();
  await recovery
    .getByRole("button", { name: "방 상태 다시 확인", exact: true })
    .waitFor();
  assert.equal(
    await recovery
      .getByRole("button", { name: "새로운 판 만들기", exact: true })
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
  assert.deepEqual(errors, []);
} finally {
  await fs.writeFile(
    path.join(evidence, "browser-report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
  server.close();
}
console.log(checks.join("\n"));
