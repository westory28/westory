/** Whole online matches (2, 3 and 4 players) through the real screen, the real
 * client service and the real command handlers, on an in-memory database with
 * random delays, reordered replies and snapshots, lost replies and leavers.
 * No production service, emulator or account is used.
 *
 *   node scripts/verify-yut-full-game-browser.mjs [rooms=2,3,4] [rounds=1] [seed=1] [minutes=7] [chaos=0]
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { createHash } from "node:crypto";
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
const options = Object.fromEntries(
  process.argv.slice(2).map((entry) => entry.split("=")),
);
const sizes = (options.rooms || "2,3,4").split(",").map(Number);
const rounds = Number(options.rounds || 1);
const chaos = options.chaos !== "0";
const maxMinutes = Number(options.minutes || 7);
let seed = Number(options.seed || Date.now() % 1e6);
console.log("seed", seed);
const rand = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const between = (low, high) => low + rand() * (high - low);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- the real command handlers on an in-memory database ---------------------
class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "firebase-functions/v2/https") return { HttpsError };
  if (request === "./scoreWorkflowGuard")
    return { assertScoreWorkflowSession: async () => {} };
  if (request === "./studentMenuVisibility")
    return { assertStudentMenuVisible: () => {} };
  if (request === "./weplayRankingStore")
    return {
      studentLabel: () => "학생",
      prepareRankingUpdate: async () => ({ apply() {}, week: { id: "w" } }),
    };
  if (request === "./yutReward")
    return {
      createYutReward: () => ({
        snapshot: async () => ({ enabled: true, amount: 30, version: 1 }),
        prepare: async (_transaction, _scope, room) => ({
          reward: { uid: room.winnerUid, amount: 30, status: "paid" },
          apply() {},
        }),
      }),
    };
  return load.call(this, request, parent, ...rest);
};
const { createYutHandlers } = require("../functions/yut.js");
const documents = new Map();
const watchers = new Map();
const base = "years/2026/semesters/2";
const slotId = (uid) =>
  `slot_${createHash("sha256").update(`2026-2\n${uid}`).digest("hex").slice(0, 40)}`;
const snapshot = (reference) => ({
  exists: documents.has(reference.path),
  id: reference.id,
  ref: reference,
  data: () => structuredClone(documents.get(reference.path)),
});
const matches = (data, [field, operator, value]) =>
  operator === "=="
    ? data[field] === value
    : operator === ">"
      ? data[field] > value
      : operator === "<="
        ? data[field] <= value
        : value.includes(data[field]);
const query = (collection, filters = []) => ({
  isQuery: true,
  where: (...filter) => query(collection, [...filters, filter]),
  orderBy: () => query(collection, filters),
  limit: () => query(collection, filters),
  run: () => ({
    docs: [...documents.entries()]
      .filter(
        ([key, data]) =>
          key.startsWith(collection + "/") &&
          filters.every((filter) => matches(data, filter)),
      )
      .map(([key]) => snapshot({ path: key, id: key.split("/").pop() })),
  }),
});
let lock = Promise.resolve();
const roomLog = new Map();
const db = {
  doc: (key) => ({ path: key, id: key.split("/").pop() }),
  collection: (key) => query(key),
  collectionGroup: () => query("none"),
  runTransaction(work, settings) {
    const run = async () => {
      const staged = [];
      const stage = (kind) => (reference, data, merge) =>
        staged.push({
          kind,
          path: reference.path,
          data: structuredClone(data),
          merge: Boolean(merge?.merge),
        });
      const result = await work({
        get: async (target) =>
          target.isQuery ? target.run() : snapshot(target),
        set: stage("set"),
        update: stage("update"),
      });
      for (const write of staged) {
        const next =
          write.kind === "update" || write.merge
            ? { ...(documents.get(write.path) || {}), ...write.data }
            : write.data;
        documents.set(write.path, next);
        if (!write.path.includes("/yut_rooms/")) continue;
        const log = roomLog.get(next.id) || [];
        if (log.at(-1)?.revision !== next.revision)
          log.push(structuredClone(next));
        roomLog.set(next.id, log);
        for (const notify of watchers.get(write.path) || []) notify();
      }
      return result;
    };
    if (settings?.readOnly) return run();
    const result = lock.then(run);
    lock = result.catch(() => {});
    return result;
  },
};
const put = (records) => {
  for (const [key, data] of Object.entries(records)) documents.set(key, data);
};
put({
  "site_settings/config": { year: "2026", semester: "2" },
  "site_settings/semester_active": { semesterId: "2026-2", revision: 3 },
  "semester_manifests/2026-2": { status: "ACTIVE", revision: 3 },
  [`${base}/weplay_games/joseon-yut`]: { enabled: true, version: 4 },
  "semester_classes/class-3-2": {
    semesterId: "2026-2",
    status: "ACTIVE",
    grade: "3",
    classNumber: "2",
  },
});
const enrol = (uid) =>
  put({
    [`users/${uid}`]: {
      role: "student",
      name: uid,
      registrationApprovalStatus: "APPROVED",
    },
    [`semester_enrollment_slots/${slotId(uid)}`]: {
      studentUid: uid,
      semesterId: "2026-2",
      activeEnrollmentId: `enrollment-${uid}`,
      status: "ACTIVE",
    },
    [`semester_enrollments/enrollment-${uid}`]: {
      studentUid: uid,
      semesterId: "2026-2",
      enrollmentStatus: "ACTIVE",
      classId: "class-3-2",
      studentName: uid,
    },
  });
const handlers = createYutHandlers({
  db,
  random: (maximum) => Math.floor(rand() * maximum),
});
const refusals = {};
const applied = {};
const count = (table, key) => {
  table[key] = (table[key] || 0) + 1;
};

// --- the real client with only its network boundary replaced ----------------
const modulePath = (value) =>
  JSON.stringify(path.join(root, value).replaceAll("\\", "/"));
const service = `
const uid=new URLSearchParams(location.search).get('uid');
const config={year:'2026',semester:'2'};
export const useAuth=()=>({config,currentUser:{uid,email:uid+'@yongshin-ms.ms.kr'},userData:{uid,role:'student',name:uid},menuConfig:{}});
const sim=window.sim={delivered:null,calls:[],snapshots:0};
const newest=room=>{if(room&&room.participantUids.includes(uid)&&(!sim.delivered||sim.delivered.id!==room.id||sim.delivered.syncRevision<=room.syncRevision))sim.delivered=room};
export const db={};
export const doc=(_db,path)=>path;
export function onSnapshot(path,_options,next,fail){
  let active=true;
  const source=new EventSource('/sim/watch?uid='+uid+'&path='+encodeURIComponent(path));
  source.onmessage=event=>{
    if(!active)return;
    const value=JSON.parse(event.data);
    if(value.denied){active=false;source.close();fail(Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'}));return;}
    sim.snapshots++;newest(value.room);
    next({metadata:{fromCache:false},exists:()=>!!value.room,data:()=>value.room,id:path.split('/').pop()});
  };
  return()=>{active=false;source.close();};
}
export const getHistoryDictionaryCallable=async name=>async data=>{
  if(name==='getWeplayRanking')return{data:{gameId:data.gameId,category:data.category,rows:[],updatedAtMs:Date.now(),scoreLabel:'승'}};
  const entry={name,action:data.action,at:Date.now(),revision:data.expectedRevision};
  sim.calls.push(entry);
  const response=await fetch('/sim/call?uid='+uid+'&name='+name,{method:'POST',body:JSON.stringify(data)});
  const result=await response.json();
  entry.doneAt=Date.now();entry.code=result.code;
  if(result.code)throw Object.assign(new Error(result.message),{code:'functions/'+result.code});
  newest(result.value.room);
  return{data:result.value};
};
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
  outfile: path.join(os.tmpdir(), "westory-yut-full-game.js"),
  loader: {
    ".svg": "dataurl",
    ".png": "dataurl",
    ".webp": "dataurl",
    ".woff2": "empty",
    ".woff": "empty",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "simulated-boundary",
      setup(plugin) {
        plugin.onResolve({ filter: /^\/assets\// }, (args) => ({
          path: args.path,
          external: true,
        }));
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)contexts\/AuthContext$|^\.\/firebase$|\/lib\/firebase$|^firebase\/firestore$|(?:^|\/)historyDictionarySession$/,
          },
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

const latency = () => (rand() < 0.15 ? between(700, 1500) : between(50, 450));
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const uid = url.searchParams.get("uid");
  try {
    if (url.pathname === "/sim/watch") {
      const key = url.searchParams.get("path");
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      let open = true,
        last = "",
        ready = Date.now();
      const push = () => {
        const room = documents.get(key);
        const body = JSON.stringify(
          room && !room.participantUids.includes(uid)
            ? { denied: true }
            : { room: room || null },
        );
        const wait = chaos ? between(20, rand() < 0.1 ? 1200 : 250) : 20;
        // One listener stays in order, as Firestore's does.
        ready = Math.max(ready, Date.now() + wait);
        setTimeout(() => {
          if (!open || body === last) return;
          last = body;
          response.write(`data: ${body}\n\n`);
        }, ready - Date.now());
      };
      if (!watchers.has(key)) watchers.set(key, new Set());
      watchers.get(key).add(push);
      request.on("close", () => {
        open = false;
        watchers.get(key).delete(push);
      });
      push();
      return;
    }
    if (url.pathname === "/sim/call") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString());
      const name = url.searchParams.get("name");
      if (chaos) await delay(latency() / 2);
      let body;
      try {
        const handler =
          name === "commandYutRoomFast"
            ? handlers.commandYutRoom
            : handlers[name];
        body = {
          value: await handler({
            auth: { uid, token: { email: `${uid}@yongshin-ms.ms.kr` } },
            data,
          }),
        };
        if (data.action) count(applied, data.action);
      } catch (error) {
        if (!(error instanceof HttpsError)) console.error("handler", error);
        body = { code: error.code || "internal", message: error.message };
        count(refusals, `${data.action}:${body.code}`);
      }
      if (chaos) await delay(latency());
      if (chaos && ["throw", "move"].includes(data.action) && rand() < 0.04) {
        body = { code: "unavailable", message: "lost" };
        count(refusals, `${data.action}:lost-reply`);
      }
      response.setHeader("Content-Type", "application/json");
      return response.end(JSON.stringify(body));
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
      response.setHeader(
        "Content-Type",
        { ".webp": "image/webp", ".svg": "image/svg+xml", ".wav": "audio/wav" }[
          path.extname(target)
        ] || "application/octet-stream",
      );
      return response.end(await fs.readFile(target));
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>*,::before,::after{box-sizing:border-box}body{margin:0}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>',
    );
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
  args: ["--disable-3d-apis"],
});

// Runs inside every page: a player who uses only the visible controls, and an
// observer that compares the board with what the server told this client.
const player = ({ uid, seedValue, pace }) => {
  let state = seedValue;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const bot = (window.bot = {
    on: true,
    problems: [],
    errors: [],
    motions: [],
    checks: 0,
    throws: 0,
  });
  const $ = (selector) => [...document.querySelectorAll(selector)];
  const usable = (node) =>
    node &&
    !node.disabled &&
    node.getClientRects().length &&
    !node.closest("[inert]");
  const named = (label) =>
    $("button").find(
      (node) =>
        (node.getAttribute("aria-label") || node.textContent.trim()) ===
          label && usable(node),
    );
  const seen = new Set();
  let active = new Map(),
    lastError = "",
    calm = 0,
    charging = 0,
    stuckSince = 0,
    errorSince = 0,
    auditKey = "";
  const problem = (kind, detail) => {
    const room = window.sim.delivered;
    if (bot.problems.length < 60)
      bot.problems.push({
        kind,
        detail,
        room: room && {
          revision: room.revision,
          event: room.lastEvent.kind,
          turn: room.turnUid,
          phase: room.phase,
        },
      });
  };
  const watch = () => {
    const now = new Map();
    for (const node of $(".yut-isometric-piece[data-motion-id]")) {
      const key = node.dataset.motionId + "|" + node.dataset.motion;
      now.set(key, node);
      if (active.has(key)) continue;
      // A move whose reply was lost is taken back, and drawn when it is confirmed.
      const unanswered = window.sim.calls.some(
        (call) =>
          call.action === "move" &&
          call.code === "unavailable" &&
          key.includes(`:${call.revision + 1}:`),
      );
      if (seen.has(key) && !unanswered) problem("motion-twice", key);
      seen.add(key);
      bot.motions.push({
        id: node.dataset.motionId,
        kind: node.dataset.motion,
        label: node.getAttribute("aria-label"),
      });
    }
    active = now;
    requestAnimationFrame(watch);
  };
  watch();
  const clans = { sa: "마가", nong: "우가", gong: "저가", sang: "구가" };
  const expected = (room) => {
    const result = new Map();
    for (const person of room.players.filter((entry) => entry.active))
      for (const piece of person.pieces)
        if (
          piece.node !== "finish" &&
          (piece.node !== "home" ||
            person.uid === uid ||
            room.status === "finished")
        )
          result.set(clans[person.role] + piece.id, piece.node);
    return result;
  };
  const audit = () => {
    const room = window.sim.delivered;
    const message = document.querySelector(".yut-message.is-error");
    const text = message ? message.textContent : "";
    if (text && text !== lastError) {
      const last = window.sim.calls.at(-1);
      bot.errors.push({
        text,
        call: last && `${last.action}:${last.code || "ok"}`,
        status: room?.status,
        event: room?.lastEvent.kind,
      });
      errorSince = Date.now();
    }
    lastError = text;
    if (!room || !document.querySelector(".yut-board")) {
      calm = 0;
      return;
    }
    const now = Date.now();
    const inFlight = window.sim.calls.some(
      (call) =>
        !call.doneAt &&
        now - call.at < 14000 &&
        !["cast", "emote", "lobby"].includes(call.action),
    );
    const key = room.id + room.revision;
    const throwing = named("윷 던지기");
    const mine = room.status === "playing" && room.turnUid === uid;
    if (throwing && !(mine && room.phase === "throw"))
      problem("throw-out-of-turn", room.turnUid);
    if (
      $(".yut-isometric-destination").some(usable) &&
      !(mine && room.phase === "move")
    )
      problem("move-out-of-turn", room.turnUid);
    const control =
      room.phase === "throw"
        ? throwing || charging
        : named("결정") ||
          $(".yut-piece-choice").some(usable) ||
          $(".yut-isometric-destination").some(usable) ||
          $(".yut-isometric-piece:not(:disabled)").length;
    if (
      mine &&
      !control &&
      !inFlight &&
      !text &&
      now > room.phaseStartsAtMs + 1200 &&
      now < (room.turnInputDeadlineMs || room.turnDeadlineMs) - 600 &&
      !document.querySelector("dialog[open]")
    ) {
      stuckSince ||= now;
      if (now - stuckSince > 1300) {
        problem("my-turn-without-control", {
          phase: room.phase,
          sinceStart: now - room.phaseStartsAtMs,
          motions: active.size,
          dock: document.querySelector(".yut-action-dock")?.innerText,
        });
        stuckSince = now + 60000;
      }
    } else if (stuckSince < now) stuckSince = 0;
    if (
      active.size ||
      inFlight ||
      text ||
      document.querySelector(".yut-match-stage.is-tossing") ||
      auditKey !== key
    ) {
      auditKey = key;
      calm = 0;
      return;
    }
    calm += 1;
    if (calm !== 5) return;
    bot.checks += 1;
    const shown = new Map();
    const board = document.querySelector(".yut-board").getBoundingClientRect();
    for (const node of $(".yut-isometric-piece"))
      for (const id of node.dataset.pieceIds.split(",")) {
        const piece =
          node.getAttribute("aria-label").match(/(마가|우가|저가|구가)/)[0] +
          id;
        if (shown.has(piece)) problem("piece-drawn-twice", piece);
        shown.set(piece, node.dataset.pawnNode);
        const box = node.getBoundingClientRect();
        const x = box.left + box.width / 2 - board.left,
          left = (parseFloat(node.style.left) / 100) * board.width;
        if (node.dataset.pawnNode !== "home" && Math.abs(x - left) > 100)
          problem("piece-off-node", { piece, x, left });
      }
    const want = expected(room);
    for (const [piece, node] of want)
      if (shown.get(piece) !== node)
        problem("wrong-position", { piece, want: node, got: shown.get(piece) });
    for (const piece of shown.keys())
      if (!want.has(piece)) problem("extra-piece", piece);
  };
  const act = () => {
    if (!bot.on) return;
    // A student presses it only after a moment; an expected race clears itself.
    const recheck = named("방 상태 다시 확인");
    if (recheck && Date.now() - errorSince > 3000) return recheck.click();
    const dialog = document.querySelector("dialog[open]");
    if (dialog?.classList.contains("yut-stack-choice")) {
      const choices = [...dialog.querySelectorAll(".yut-stack-option")].filter(
        usable,
      );
      if (!dialog.querySelector(".yut-stack-option.is-selected"))
        return choices[Math.floor(rnd() * choices.length)]?.click();
      return [...dialog.querySelectorAll("button")]
        .find((node) => node.textContent.trim() === "결정" && usable(node))
        ?.click();
    }
    if (dialog) return;
    const stop = named("힘을 멈추고 던지기");
    if (stop) {
      if (Date.now() - charging < 200 + rnd() * 400) return;
      charging = 0;
      bot.throws += 1;
      return stop.click();
    }
    charging = 0;
    const toss = named("윷 던지기");
    if (toss) {
      if (rnd() < 0.2)
        $(".yut-boost-choices button")
          .filter(usable)
          [Math.floor(rnd() * 2)]?.click();
      charging = Date.now();
      return toss.click();
    }
    const decide = named("결정");
    if (decide) {
      decide.click();
      if (rnd() < 0.3) decide.click();
      return;
    }
    const pads = $(".yut-isometric-destination").filter(usable);
    if (pads.length) return pads[Math.floor(rnd() * pads.length)].click();
    const pieces = $(".yut-piece-choice").filter(usable);
    if (pieces.length && !$(".yut-piece-choice.is-selected").length)
      return pieces[Math.floor(rnd() * pieces.length)].click();
    for (const label of ["준비 완료", "게임 시작"]) {
      const node = named(label);
      if (
        node &&
        (label !== "게임 시작" ||
          window.startWhen <= $(".yut-seat.is-filled").length)
      )
        return node.click();
    }
    if (window.leaveAtEnd) return named("새 판 준비하기")?.click();
    if (rnd() < 0.012 && document.querySelector(".yut-board")) {
      named("감정표현")?.click();
      setTimeout(() => {
        const list = $(".yut-emote-options button").filter(usable);
        list[Math.floor(rnd() * list.length)]?.click();
      }, 120);
    }
  };
  setInterval(audit, 100);
  setInterval(act, pace);
};

const report = [];
async function open(uid, size, [width, height]) {
  enrol(uid);
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push("pageerror " + error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/Failed to load resource|WebGL/.test(message.text())
    )
      failures.push("console " + message.text());
  });
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await page.goto(`${origin}/?uid=${uid}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((value) => {
    window.startWhen = value;
  }, size);
  await page.evaluate(player, {
    uid,
    seedValue: Math.floor(rand() * 1e9),
    pace: Math.round(between(140, 260)),
  });
  return { uid, page, failures };
}
async function match(size, round, table) {
  const label = `r${round}t${table}p${size}`;
  const viewports = [
    [1280, 800],
    [1180, 820],
    [844, 390],
    [1280, 800],
  ];
  const seats = [];
  for (let index = 0; index < size; index += 1)
    seats.push(await open(`${label}-${index}`, size, viewports[index]));
  const host = seats[0].page;
  await host.getByRole("button", { name: "새 판 만들기", exact: true }).click();
  const dialog = host.getByRole("dialog");
  await dialog.getByRole("button", { name: `${size}명`, exact: true }).click();
  await dialog.getByText("비밀방으로 만들기").click();
  await dialog.getByRole("button", { name: "만들기", exact: true }).click();
  const code = await host.locator(".yut-room-code strong").textContent();
  // Everyone joins, and then readies, at about the same moment.
  await Promise.all(
    seats.slice(1).map(async ({ page }) => {
      const input = page.locator("#yut-room-code");
      for (let attempt = 0; attempt < 6; attempt += 1) {
        if (!(await input.isVisible().catch(() => false))) return;
        await input.fill(code, { timeout: 20000 });
        await page
          .getByRole("button", { name: "들어가기", exact: true })
          .click();
        await page
          .locator(".yut-waiting")
          .waitFor({ timeout: 8000 })
          .catch(() => {});
      }
    }),
  );
  await host.locator(".yut-board").waitFor({ timeout: 60000 });
  const roomId = await host.evaluate(() => window.sim.delivered.id);
  const key = `${base}/yut_rooms/${roomId}`;
  const startedAt = Date.now();
  const willLeave = chaos && size > 2 && round % 2 === 0;
  let left = null;
  while (Date.now() - startedAt < maxMinutes * 60000) {
    const room = documents.get(key);
    if (room.status !== "playing") break;
    // One player walks out in the middle, right after somebody's move.
    if (
      willLeave &&
      !left &&
      room.revision > 24 &&
      Date.now() - room.lastEvent.atMs < 150
    ) {
      left = seats.at(-1);
      await left.page.evaluate(() => {
        window.bot.on = false;
      });
      const out = { name: "방 나가기", exact: true };
      await left.page
        .getByRole("button", out)
        .first()
        .click({ timeout: 4000 })
        .catch(() => {});
      await left.page
        .getByRole("dialog")
        .getByRole("button", out)
        .click({ timeout: 4000 })
        .catch(() => {});
    }
    await delay(100);
  }
  await delay(5000);
  const finished = documents.get(key).status;
  const victory = [];
  for (const seat of seats)
    if (seat !== left)
      victory.push(await seat.page.locator(".yut-victory").count());
  // Everyone prepares a new match at the same moment.
  await Promise.all(
    seats.map((seat) =>
      seat.page.evaluate(() => {
        window.leaveAtEnd = true;
      }),
    ),
  );
  await delay(9000);
  const result = {
    label,
    status: finished,
    seconds: Math.round((Date.now() - startedAt) / 1000),
    revisions: documents.get(key).revision,
    left: left?.uid,
    victory,
    backAtMenu: 0,
    players: [],
  };
  const log = roomLog.get(roomId);
  const moves = new Map(
    log
      .filter((room) => room.lastEvent.move)
      .map((room) => [String(room.revision), room.lastEvent.move]),
  );
  for (const seat of seats) {
    const data = await seat.page.evaluate(() => ({
      ...window.bot,
      menu: document.querySelectorAll(".yut-entry").length,
    }));
    result.backAtMenu += data.menu;
    // Each motion belongs to the server move of its own revision.
    const drawn = new Set();
    for (const motion of data.motions) {
      const [, revision, uid, ids] = motion.id.match(
        /^.*?:(\d+):(.+):([\d,]+)$/,
      );
      const move = moves.get(revision);
      const own =
        move?.uid === uid &&
        move.movingPieceIds.slice().sort().join() === ids &&
        motion.kind !== "caught";
      const caught =
        motion.kind === "caught" &&
        move?.capturedPieces.some((piece) => piece.uid === uid);
      if (own) drawn.add(revision);
      if (!own && !caught)
        data.problems.push({
          kind: "phantom-motion",
          detail: {
            ...motion,
            server: log.find((room) => String(room.revision) === revision)
              ?.lastEvent,
          },
        });
    }
    result.players.push({
      uid: seat.uid,
      checks: data.checks,
      throws: data.throws,
      motions: data.motions.length,
      moves: moves.size,
      undrawn:
        seat === left
          ? "left"
          : [...moves.keys()].filter((revision) => !drawn.has(revision)).length,
      errors: data.errors,
      problems: data.problems,
      failures: seat.failures,
    });
  }
  report.push(result);
  console.log(
    JSON.stringify({
      ...result,
      players: result.players.map((entry) => ({
        ...entry,
        errors: entry.errors.length,
        problems: entry.problems.length,
      })),
    }),
  );
  for (const entry of result.players) {
    for (const error of entry.errors)
      console.log("  error", entry.uid, JSON.stringify(error));
    for (const found of entry.problems)
      console.log("  PROBLEM", entry.uid, JSON.stringify(found));
    for (const failure of entry.failures)
      console.log("  FAILURE", entry.uid, failure);
  }
  for (const seat of seats) await seat.page.context().close();
}
try {
  for (let round = 0; round < rounds; round += 1)
    await Promise.all(
      sizes.map((size, table) =>
        match(size, round, table).catch((error) => {
          console.log("MATCH FAILED", size, error.message);
          report.push({ failed: error.message, players: [] });
        }),
      ),
    );
} finally {
  await browser.close();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}
console.log("applied", JSON.stringify(applied));
console.log("refused", JSON.stringify(refusals));
const everyone = report.flatMap((entry) => entry.players);
const sum = (pick) => everyone.reduce((total, entry) => total + pick(entry), 0);
console.log(
  `matches ${report.length}, settled-board checks ${sum((entry) => entry.checks)}, motions ${sum((entry) => entry.motions)}, undrawn moves ${sum((entry) => Number(entry.undrawn) || 0)}, error popups ${sum((entry) => entry.errors.length)}, problems ${sum((entry) => entry.problems.length)}, page errors ${sum((entry) => entry.failures.length)}`,
);
assert.equal(
  report.filter((entry) => entry.failed).length,
  0,
  "every match ran",
);
assert.equal(
  sum((entry) => entry.problems.length),
  0,
  "no invariant was broken",
);
assert.equal(
  sum((entry) => entry.failures.length),
  0,
  "no page or console error",
);
// A lost reply is told to the player; a race with another player never is.
assert.equal(
  sum(
    (entry) =>
      entry.errors.filter((error) => /:(aborted|ok)$/.test(error.call || ""))
        .length,
  ),
  0,
  "no popup for an expected race",
);
