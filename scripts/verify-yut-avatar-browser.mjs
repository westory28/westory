/**
 * Avatar pieces in the Yut game: who is drawn as an avatar, every action's
 * three frames, the fallbacks to the animal piece, the cast being asked only
 * when the players change, the piece choice, the teacher's view, and an
 * unchanged layout. Synthetic transport and synthetic looks only.
 * Screenshots go to YUT_AVATAR_EVIDENCE (default output/yut-avatar-20261125).
 */
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
const evidence =
  process.env.YUT_AVATAR_EVIDENCE ||
  path.join(root, "output/yut-avatar-20261125");
await fs.mkdir(evidence, { recursive: true });
const source = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));

// Four players: two saved avatars, one who chose the animal piece, one without an avatar.
const LOOKS = {
  a: {
    character: "girl",
    top: "mm-hanbok-plum",
    bottom: "mm-hanbok-chima-red",
    shoes: "mm-hanbok-flower-red",
    hairStyle: "mm-braided-twin",
    accessory: "mm-hanbok-daenggi",
  },
  b: {
    character: "boy",
    top: "mm-hanbok-jade-dopo",
    bottom: "mm-hanbok-baji-indigo",
    shoes: "mm-hanbok-mokhwa",
    accessory: "mm-hanbok-wide-gat",
    hairStyle: "mm-parted",
  },
  c: {
    character: "girl",
    top: "mm-moon-cape",
    bottom: "mm-cargo-sage",
    shoes: "mm-ankle-boots",
    hairStyle: "mm-twin-ribbon",
    accessory: "mm-glasses",
  },
};
const service = (withCast) => `
import * as core from ${source("functions/yutCore.mjs")};
import { defaultAvatarLook } from ${source("src/features/avatar/catalog.ts")};
const params=new URLSearchParams(location.search),uid=params.get('uid')||'a',portal=params.get('portal')||'student';
const config={year:'2026',semester:'2'};
export const useAuth=()=>({config,currentUser:{uid,email:uid+'@yongshin-ms.ms.kr'},userData:{uid,role:portal==='teacher'?'teacher':'student',name:uid}});
const names={a:'김하늘(3학년 2반)',b:'박도윤(3학년 2반)',c:'이서연(3학년 5반)',d:'정민준(3학년 5반)',e:'최지우(3학년 1반)'};
const qa=window.yutQA={core,commands:[],castCalls:[],pieceCalls:[],listeners:[],room:null,castMode:params.get('cast')||'ok',pieces:{c:'classic'},looks:{}};
for(const[member,look]of Object.entries(${JSON.stringify(LOOKS)}))qa.looks[member]={...defaultAvatarLook(look.character),...look};
if(params.get('saver'))Object.defineProperty(navigator,'connection',{configurable:true,value:{saveData:true}});
// A started match whose clocks never run out while a scene is inspected.
qa.steady=room=>{const now=Date.now();return{...room,phaseStartsAtMs:Math.min(room.phaseStartsAtMs||0,now-1000),turnDeadlineMs:now+900000,turnInputDeadlineMs:now+900000,expiresAtMs:now+3600000}};
qa.seed=(status='playing',members=['a','b','c','d'])=>{
  const now=Date.now();
  let room=core.createYutRoom({id:'room-a',code:'RM234A',classId:'',classLabel:'함께하는 윷판',host:{uid:members[0],name:names[members[0]]},nowMs:now,maxPlayers:4});
  for(const member of members.slice(1)){room=core.addYutPlayer(room,{uid:member,name:names[member]},now);room=core.readyYutPlayer(room,member,true,now)}
  if(status==='waiting')return room;
  return qa.steady(core.startYutGame(room,now-30000));
};
// Places pieces: {a:['o3','home'],...}; a node may carry a stack mark as 'o6+'.
qa.place=(room,layout)=>{const next=structuredClone(room);for(const player of next.players){(layout[player.uid]||[]).forEach((spot,index)=>{const piece=player.pieces[index];piece.node=spot.replace('+','');piece.lane='outer';if(spot.endsWith('+'))piece.stackId='stack-1-2';else delete piece.stackId})}next.revision+=1;next.syncRevision=(next.syncRevision??next.revision)+1;return next};
// One real turn through the rule functions: a throw of the given value, then the move.
qa.play=(room,member,pieceId,value,stack)=>{
  const sticks=[true,true,true,true].map((_,index)=>index<value);
  const turn={...room,turnUid:member,phase:'throw',pendingThrow:null,extraThrows:0,phaseStartsAtMs:0,turnDeadlineMs:Date.now()+900000};
  const thrown=core.throwYut(turn,member,value===5?[false,false,false,false]:sticks,Date.now()-8000);
  return qa.steady(core.moveYut(thrown,member,pieceId,'outer',thrown.phaseStartsAtMs+1,stack));
};
// The room exists before anything subscribes or asks for the lobby.
if(params.get('seed')!=='none'){const room=qa.seed(params.get('seed')||'playing'),layout=params.get('layout');qa.room=layout?qa.place(room,JSON.parse(layout)):room}
qa.push=room=>{qa.room=room;for(const item of qa.listeners.filter(item=>item.active)){item.connection?.(true);item.next(room)}};
export const YUT_PRIVATE_DAILY_LIMIT=5;
export const DEFAULT_YUT_SETTINGS={enabled:true,version:1,allowSolo:true,allowMultiplayer:true,allowPrivateRooms:true,defaultPlayerCount:4,throwSeconds:15,moveSeconds:60};
export const normalizeYutSettings=value=>({...DEFAULT_YUT_SETTINGS,...(value||{})});
export const getYutLobby=async()=>({enabled:true,playerName:names[uid],settings:DEFAULT_YUT_SETTINGS,privatePlaysRemaining:5,room:qa.room,classes:[],classId:'',serverNowMs:Date.now()});
export const getYutPublication=async()=>({enabled:true,settings:DEFAULT_YUT_SETTINGS});
export const commandYutRoom=async(_config,data)=>{qa.commands.push(data);return{room:qa.room,serverNowMs:Date.now()}};
export function subscribeYutRoom(_config,id,next,error,connection){const item={id,next,error,connection,active:true};qa.listeners.push(item);queueMicrotask(()=>{if(item.active){connection?.(true);next(qa.room)}});return()=>{item.active=false}}
export const yutErrorMessage=error=>error?.message||'다시 시도해 주세요.';
export const getHistoryDictionaryCallable=async name=>async data=>{if(name==='getWeplayRanking')return{data:{gameId:data.gameId,category:data.category,rows:[],updatedAtMs:Date.now(),scoreLabel:'승'}};throw new Error('Unexpected callable '+name)};
${
  withCast
    ? `
export const getYutCast=async(_config,roomId)=>{
  qa.castCalls.push({roomId:roomId||null,at:Date.now()});
  if(qa.castMode==='old')throw Object.assign(new Error('게임 요청을 다시 확인해 주세요.'),{code:'functions/invalid-argument'});
  if(qa.castMode==='fail')throw Object.assign(new Error('unavailable'),{code:'functions/unavailable'});
  if(qa.castMode==='hold')await new Promise(resolve=>{qa.releaseCast=resolve});
  const members=roomId?qa.room.players.filter(player=>player.active).map(player=>player.uid):[uid],cast={};
  for(const member of members)if(qa.looks[member]&&qa.pieces[member]!=='classic')cast[member]={look:qa.looks[member]};
  if(qa.castMode==='unknown-item')for(const entry of Object.values(cast))entry.look={...entry.look,top:'mm-item-from-a-newer-catalogue'};
  return{cast,...(members.includes(uid)&&qa.looks[uid]?{piece:qa.pieces[uid]==='classic'?'classic':'avatar'}:{})};
};
export const setYutPiece=async(_config,piece)=>{
  qa.pieceCalls.push(piece);
  if(qa.failPiece){qa.failPiece=false;throw Object.assign(new Error('말 모양을 저장하지 못했습니다.'),{code:'functions/unavailable'})}
  qa.pieces[uid]=piece;return{piece};
};`
    : ""
}
`;
const harness = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Game from ${source("src/components/common/weplay/yut/YutGame.tsx")};
import Spectator from ${source("src/pages/teacher/components/YutSpectator.tsx")};
import {YutSprite} from ${source("src/components/common/weplay/yut/YutArt.tsx")};
import {YUT_PIECE_ACTIONS} from ${source("src/components/common/weplay/yut/yutAvatar.ts")};
import {bakeYutAvatarSheet} from ${source("src/components/common/weplay/yut/yutAvatarSheet.ts")};
import ${source("src/assets/index.css")};import ${source("assets/css/style.css")};import ${source("src/pages/teacher/components/YutManagement.css")};
const params=new URLSearchParams(location.search),view=params.get('view')||'game';
const music={enabled:false,failed:false,start(){},toggle(){}};
function Sprites(){
  const[sheets,setSheets]=useState(null);
  window.showSprites=async()=>{const baked=[];for(const look of Object.values(window.yutQA.looks))baked.push(await bakeYutAvatarSheet(look,2));window.yutQA.sheets=baked;setSheets(baked);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))};
  return <section className="yut-game" style={{display:'grid',gridTemplateColumns:'repeat(8,96px)',gap:'40px 16px',padding:48,background:'#838578'}}>
    {sheets&&[...sheets,null].flatMap((sheet,row)=>YUT_PIECE_ACTIONS.map(action=><div key={row+action} style={{width:96,height:96,position:'relative'}} data-gallery={sheet?'avatar':'animal'}><YutSprite role={['sa','nong','gong','sang'][row]} pose={action} avatar={sheet||undefined} motionKey={'gallery'}/></div>))}
  </section>;
}
function App(){
  if(view==='sprites')return <Sprites/>;
  if(view==='spectator')return <div className="fixture-shell"><div className="fixture-body yut-management"><Spectator roomId="room-a" config={{year:'2026',semester:'2'}} actorKey="teacher-t/2026/2/true"/></div></div>;
  return <Game portal={params.get('portal')==='teacher'?'teacher':'student'} music={music} onBack={()=>{}} onMusicActiveChange={()=>{}}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
`;
async function bundleFor(withCast) {
  const bundled = await build({
    stdin: { contents: harness, loader: "tsx", resolveDir: root },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
    outfile: path.join(os.tmpdir(), "westory-yut-avatar.js"),
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
            {
              filter:
                /(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/yut$|(?:^|\/)historyDictionarySession$/,
            },
            () => ({ path: "service", namespace: "fixture" }),
          );
          plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: service(withCast),
            loader: "ts",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  return {
    js: bundled.outputFiles.find((file) => file.path.endsWith(".js")).text,
    // The web-font address contains semicolons: drop the whole import, not its first part.
    css: bundled.outputFiles
      .find((file) => file.path.endsWith(".css"))
      .text.replace(/@import\s+url\((["'])[^"']*\1\)[^;]*;/g, ""),
    warnings: bundled.warnings.map((warning) => warning.text),
  };
}
const bundles = { cast: await bundleFor(true), plain: await bundleFor(false) };
// A service double without the view still builds: the game only loses its avatars.
assert.ok(
  bundles.plain.warnings.some((text) => /getYutCast/.test(text)),
  "the missing view is only a build warning",
);
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const bundle = bundles[url.pathname.split("/")[1]];
  if (bundle && url.pathname.endsWith(".js"))
    return response.setHeader("Content-Type", "text/javascript").end(bundle.js);
  if (bundle && url.pathname.endsWith(".css"))
    return response.setHeader("Content-Type", "text/css").end(bundle.css);
  if (url.pathname.startsWith("/assets/")) {
    const target = path.resolve(root, "public", "." + url.pathname);
    if (!target.startsWith(path.join(root, "public") + path.sep))
      return response.writeHead(403).end();
    try {
      return response.end(await fs.readFile(target));
    } catch {
      return response.writeHead(404).end();
    }
  }
  if (!bundle) return response.writeHead(404).end();
  response.setHeader("Content-Type", "text/html");
  response.end(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${url.pathname.split("/")[1]}/app.css"><style>body{margin:0;background:#1d2119}.fixture-shell{max-width:1536px;margin:16px auto;background:#fff;border-radius:12px}.fixture-body{padding:24px}</style><div id="root"></div><script type="module" src="/${url.pathname.split("/")[1]}/app.js"></script>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const report = { passed: false, checks: [], errors: [], layout: {}, bake: {} };
const pass = (text) => {
  report.checks.push(text);
  console.log(text);
};
async function open(
  query = "",
  {
    width = 1280,
    height = 800,
    bundle = "cast",
    dpr = 1,
    seed = "playing",
    layout,
  } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
  });
  const page = await context.newPage();
  await page.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort(),
  );
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/Failed to load resource/.test(message.text())
    )
      report.errors.push(message.text());
  });
  const state = new URLSearchParams({
    seed,
    ...(layout ? { layout: JSON.stringify(layout) } : {}),
  });
  await page.goto(`${base}/${bundle}/?${query}&${state}`);
  await page.waitForFunction(() => window.yutQA);
  return page;
}
const START = {
  a: ["o3", "home"],
  b: ["o8", "home"],
  c: ["o13", "home"],
  d: ["o18", "home"],
};
const art = (page, scope = ".yut-board-piece") =>
  page.evaluate((scope) => {
    return Array.from(document.querySelectorAll(scope)).map((node) => {
      const sprite = node.matches(".yut-sprite")
        ? node
        : node.querySelector(".yut-sprite");
      const images = Array.from(sprite.querySelectorAll("image")).map((image) =>
        image.getAttribute("href"),
      );
      return {
        label: node.getAttribute("aria-label") || node.className,
        avatar: sprite.classList.contains("yut-avatar-sprite"),
        blob: images.every((href) => href.startsWith("blob:")),
        animal: images.every((href) =>
          href.startsWith("/assets/weplay/yut/animation-"),
        ),
        action: sprite.dataset.spriteAction,
        frames: sprite.dataset.spriteFrames,
        drawn: sprite.querySelectorAll(".yut-drawn-frame").length,
      };
    });
  }, scope);
const owner = (rows, name) => rows.filter((row) => row.label.includes(name));
const settle = (page, count) =>
  page.waitForFunction(
    (count) => document.querySelectorAll(".yut-avatar-sprite").length >= count,
    count,
    { timeout: 15000 },
  );
const rects = (page, selectors) =>
  page.evaluate(
    (selectors) =>
      Object.fromEntries(
        selectors.map((selector) => [
          selector,
          Array.from(document.querySelectorAll(selector)).map((node) => {
            const box = node.getBoundingClientRect();
            return [box.x, box.y, box.width, box.height].map(
              (value) => Math.round(value * 100) / 100,
            );
          }),
        ]),
      ),
    selectors,
  );
const shot = (page, name) =>
  page.screenshot({ path: path.join(evidence, name + ".png") });

/**
 * One match played through the real rule functions, scene by scene. Run with
 * avatars and again with animal pieces only: every action appears at the same
 * moment either way, and each scene is photographed for comparison.
 */
async function playScenes(page, kind) {
  const mine =
      kind === "avatar"
        ? ".yut-avatar-sprite"
        : ".yut-sprite:not(.yut-avatar-sprite)",
    prefix = kind === "avatar" ? "match-after-" : "match-before-";
  // Walk, then land: a real move through the rule functions.
  await page.evaluate(() =>
    window.yutQA.push(window.yutQA.play(window.yutQA.room, "a", "1", 3)),
  );
  await page.waitForFunction(
    (selector) => document.querySelector(selector),
    `.yut-board-piece.is-moving ${mine}[data-sprite-action="walk"]`,
  );
  await shot(page, prefix + "walk-1280x800");
  await page.waitForFunction(
    () => !document.querySelector(".yut-board-piece.is-moving"),
    null,
    { timeout: 8000 },
  );
  // The second piece climbs onto the first, then they travel as one.
  await page.evaluate(() => {
    const qa = window.yutQA;
    qa.push(
      qa.play(qa.place(qa.room, { a: ["o3", "home"] }), "a", "2", 3, true),
    );
  });
  await page.waitForFunction(
    (selector) => document.querySelector(selector),
    `.yut-board-piece ${mine}[data-sprite-action="boarding"]`,
    { timeout: 8000 },
  );
  await shot(page, prefix + "boarding-1280x800");
  await page.waitForFunction(
    () => !document.querySelector(".yut-board-piece.is-moving"),
    null,
    { timeout: 8000 },
  );
  await page.waitForFunction(
    (selector) => document.querySelector(selector),
    `.yut-board-piece[data-piece-ids="1,2"] ${mine}[data-sprite-action="carry"]`,
  );
  await shot(page, prefix + "carry-idle-1280x800");
  await page.evaluate(() =>
    window.yutQA.push(window.yutQA.play(window.yutQA.room, "a", "1", 2)),
  );
  await page.waitForFunction(
    (selector) => document.querySelector(selector),
    `.yut-board-piece.is-moving[data-piece-ids="1,2"] ${mine}[data-sprite-action="carry"]`,
  );
  await shot(page, prefix + "carry-walk-1280x800");
  await page.waitForFunction(
    () => !document.querySelector(".yut-board-piece.is-moving"),
    null,
    { timeout: 8000 },
  );
  // An animal piece catches the stacked avatar pieces: both the board and the reaction use the avatar.
  await page.evaluate(() => {
    const qa = window.yutQA;
    qa.push(qa.play(qa.place(qa.room, { d: ["o2", "home"] }), "d", "1", 3));
  });
  await page.waitForFunction(
    (selector) => document.querySelector(selector),
    `.yut-board-piece.is-caught ${mine}[data-sprite-action="caught"]`,
    { timeout: 8000 },
  );
  await page.waitForFunction(
    (selector) => document.querySelector(selector),
    `.yut-capture-portrait ${mine}[data-sprite-action="pair-caught"]`,
    { timeout: 8000 },
  );
  await shot(page, prefix + "caught-1280x800");
  await page.waitForFunction(
    () =>
      !document.querySelector(
        ".yut-board-piece.is-moving, .yut-capture-reaction",
      ),
    null,
    { timeout: 8000 },
  );
  // An avatar catches a single animal piece: the animal art is unchanged.
  await page.evaluate(() => {
    const qa = window.yutQA;
    qa.push(
      qa.play(
        qa.place(qa.room, { b: ["o10", "home"], c: ["o13", "home"] }),
        "b",
        "1",
        3,
      ),
    );
  });
  await page.waitForFunction(
    () =>
      document.querySelector(
        '.yut-capture-portrait .yut-sprite[data-sprite-action="caught"]:not(.yut-avatar-sprite)',
      ),
    null,
    { timeout: 8000 },
  );
  await page.waitForFunction(
    () =>
      !document.querySelector(
        ".yut-board-piece.is-moving, .yut-capture-reaction",
      ),
    null,
    { timeout: 8000 },
  );
  assert.equal(
    await page.evaluate(() => window.yutQA.castCalls.length),
    1,
    "six moves later the cast was still asked once",
  );
  // The last piece comes home: the winner's avatar cheers, the others slump where they stand.
  await page.evaluate(() => {
    const qa = window.yutQA;
    qa.push(
      qa.play(
        qa.place(qa.room, {
          a: ["finish", "o19"],
          b: ["o13", "home"],
          c: ["o8", "home"],
          d: ["o5", "home"],
        }),
        "a",
        "2",
        3,
      ),
    );
  });
  await page.waitForFunction(
    (selector) => document.querySelector(selector),
    `.yut-board-piece.is-win ${mine}[data-sprite-action="win"]`,
    { timeout: 8000 },
  );
  await shot(page, prefix + "win-1280x800");
  await page.waitForFunction(
    (selector) => document.querySelector(selector),
    `.yut-victory ${mine}[data-sprite-action="win"]`,
    { timeout: 12000 },
  );
  const defeated = await art(page);
  assert.ok(
    owner(defeated, "박도윤").some(
      (row) => row.avatar === (kind === "avatar") && row.action === "lose",
    ),
    "the defeated second player slumps on its tile",
  );
  assert.ok(
    owner(defeated, "이서연").every(
      (row) => !row.avatar && row.action === "lose",
    ),
    "a defeated animal is unchanged",
  );
  await page.waitForTimeout(900);
  await shot(page, prefix + "lose-1280x800");
}

try {
  // 1. Every action plays three complete frames from the baked sheet, by the CSS steps of the animal pieces.
  {
    const page = await open("view=sprites", { seed: "none" });
    const watched = await page.evaluate(async () => {
      await window.showSprites();
      const nodes = Array.from(
        document.querySelectorAll("[data-gallery] .yut-sprite"),
      );
      const seen = nodes.map(() => new Set()),
        several = nodes.map(() => 0),
        started = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          nodes.forEach((node, index) => {
            const visible = Array.from(
              node.querySelectorAll(".yut-drawn-frame"),
            ).map((frame) => getComputedStyle(frame).opacity === "1");
            visible.forEach((value, frame) => value && seen[index].add(frame));
            if (visible.filter(Boolean).length !== 1) several[index] += 1;
          });
          if (performance.now() - started < 3400) requestAnimationFrame(tick);
          else resolve();
        };
        tick();
      });
      return nodes.map((node, index) => ({
        avatar: node.classList.contains("yut-avatar-sprite"),
        action: node.dataset.spriteAction,
        frames: node.dataset.spriteFrames,
        scale: node.dataset.avatarScale,
        seen: [...seen[index]].sort().join(""),
        several: several[index],
        rects: Array.from(node.querySelectorAll(".yut-drawn-frame")).map(
          (frame) => frame.dataset.sourceRect,
        ),
        href: node.querySelector("image").getAttribute("href").slice(0, 5),
        rendering: getComputedStyle(node).imageRendering,
        overflow: getComputedStyle(node.querySelector(".yut-drawn-frame"))
          .overflow,
      }));
    });
    const avatars = watched.filter((row) => row.avatar),
      animals = watched.filter((row) => !row.avatar);
    assert.equal(avatars.length, 24, "three outfits x eight actions");
    assert.equal(animals.length, 8);
    for (const row of watched) {
      assert.equal(row.frames, "3", row.action);
      assert.equal(
        row.seen,
        "012",
        `${row.avatar ? "avatar" : "animal"} ${row.action} shows each of its three frames`,
      );
      assert.equal(
        row.several,
        0,
        `${row.action}: exactly one frame at a time`,
      );
      assert.equal(
        new Set(row.rects).size,
        3,
        `${row.action}: three different drawings`,
      );
    }
    for (const row of avatars)
      assert.deepEqual(
        [row.href, row.scale, row.rendering, row.overflow],
        ["blob:", "2", "pixelated", "visible"],
      );
    for (const row of animals)
      assert.deepEqual(
        [row.href, row.scale, row.overflow],
        ["/asse", undefined, "hidden"],
      );
    assert.deepEqual(
      [...new Set(avatars.map((row) => row.action))],
      [
        "idle",
        "walk",
        "carry",
        "boarding",
        "win",
        "lose",
        "caught",
        "pair-caught",
      ],
    );
    // The three drawings of an action really differ, pixel for pixel.
    const distinct = await page.evaluate(async () => {
      const sheet = window.yutQA.sheets[0],
        image = new Image();
      image.src = sheet.url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return Object.fromEntries(
        Object.entries(sheet.actions).map(([action, record]) => [
          action,
          new Set(
            record.frames.map(([x, y, w, h]) => {
              const data = context.getImageData(
                x * sheet.scale,
                y * sheet.scale,
                w * sheet.scale,
                h * sheet.scale,
              ).data;
              let hash = 0,
                painted = 0;
              for (let index = 0; index < data.length; index += 4) {
                if (data[index + 3]) painted += 1;
                hash =
                  (hash * 31 +
                    data[index] * 7 +
                    data[index + 1] * 3 +
                    data[index + 2] +
                    data[index + 3]) >>>
                  0;
              }
              return painted ? hash : "empty";
            }),
          ).size,
        ]),
      );
    });
    for (const [action, count] of Object.entries(distinct))
      assert.equal(count, 3, `${action}: three distinct painted frames`);
    await shot(page, "sprites-gallery");
    await page.context().close();
    pass(
      "All 8 actions (idle, walk, carry, boarding, win, lose, caught, pair-caught) switch through 3 distinct baked frames for 3 outfits, one frame at a time, by the same CSS steps as the animal atlas.",
    );
  }

  // 2. A match of four: two avatars, one who chose the animal piece, one without an avatar.
  const page = await open("uid=a", { layout: START });
  await settle(page, 4);
  {
    const pieces = await art(page);
    assert.equal(
      pieces.length,
      5,
      "four pieces on the board and my waiting piece",
    );
    for (const row of pieces)
      assert.deepEqual([row.frames, row.drawn, row.action], ["3", 3, "idle"]);
    for (const name of ["김하늘", "박도윤"])
      for (const row of owner(pieces, name))
        assert.ok(row.avatar && row.blob, name + " plays as an avatar");
    for (const name of ["이서연", "정민준"])
      for (const row of owner(pieces, name))
        assert.ok(!row.avatar && row.animal, name + " keeps the animal piece");
    const portraits = await art(page, ".yut-player .yut-portrait");
    assert.deepEqual(
      portraits.map((row) => row.avatar),
      [true, true, false, false],
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.yutQA.castCalls.map((call) => call.roomId),
      ),
      ["room-a"],
    );
    // Seat colour base, ring and number stay; avatars never mirror, animals still do.
    const marks = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".yut-board-piece")).map((piece) => {
        const facing = piece.querySelector(".yut-pawn-facing");
        facing.dataset.facing = "left";
        const base = getComputedStyle(
          piece.querySelector(".yut-pawn-foot-shadow"),
        );
        return {
          avatar: piece.dataset.pieceArt === "avatar",
          seat: getComputedStyle(piece)
            .getPropertyValue("--piece-color")
            .trim(),
          base: base.backgroundColor,
          number: piece.querySelector(".yut-pawn-number").textContent,
          ring: getComputedStyle(piece.querySelector(".yut-pawn-number"))
            .boxShadow,
          mirrored: getComputedStyle(facing).transform,
        };
      }),
    );
    const rgb = (hex) =>
      `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;
    for (const mark of marks) {
      assert.ok(/^[12]$/.test(mark.number));
      if (mark.avatar) {
        assert.equal(
          mark.base,
          rgb(mark.seat),
          "an avatar stands on its seat colour",
        );
        assert.ok(
          mark.ring.includes(rgb(mark.seat)),
          "its number wears the seat colour",
        );
        assert.equal(mark.mirrored, "none", "an avatar is never mirrored");
      } else
        assert.equal(
          mark.mirrored,
          "matrix(-1, 0, 0, 1, 0, 0)",
          "an animal still turns",
        );
    }
    assert.equal(
      new Set(marks.filter((mark) => mark.avatar).map((mark) => mark.seat))
        .size,
      2,
    );
    await shot(page, "match-after-idle-1280x800");
    pass(
      "In a four-player match the two saved avatars are drawn on the board and in the HUD, the opted-out player and the player without an avatar keep the animal piece; avatars keep seat colour base, ring and number and are never mirrored.",
    );
  }

  // 3. The cast is asked when the players change, never per command or per room update.
  {
    for (let turn = 0; turn < 6; turn += 1) {
      await page.evaluate(() => {
        const qa = window.yutQA;
        qa.push({
          ...qa.room,
          syncRevision: (qa.room.syncRevision ?? qa.room.revision) + 1,
          emotes: {},
        });
      });
    }
    await page.waitForTimeout(900);
    assert.equal(
      await page.evaluate(() => window.yutQA.castCalls.length),
      1,
      "room updates do not ask again",
    );
    await playScenes(page, "avatar");
    pass(
      "Walk, boarding, carried idle, carried walk, caught on the board, pair-caught in the capture reaction, win on the board and in the victory scene, and lose all play as the avatar exactly when the animal piece plays them; the cast was asked once across all of it.",
    );
    // A new player is a new question; players arriving together are asked about once.
    await page.evaluate(() => {
      const qa = window.yutQA,
        room = structuredClone(qa.room);
      room.players[3] = {
        ...room.players[3],
        uid: "e",
        name: "최지우(3학년 1반)",
      };
      room.participantUids[3] = "e";
      qa.push({
        ...room,
        syncRevision: (room.syncRevision ?? room.revision) + 1,
      });
      qa.push({
        ...room,
        syncRevision: (room.syncRevision ?? room.revision) + 2,
      });
    });
    await page.waitForFunction(
      () => window.yutQA.castCalls.length === 2,
      null,
      { timeout: 5000 },
    );
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => window.yutQA.castCalls.length), 2);
    assert.equal(await page.evaluate(() => window.yutQA.pieceCalls.length), 0);
    await page.context().close();
    pass(
      "A changed player list asks once more (2 calls in total); no polling, no call per command.",
    );
  }

  // The same match with animal pieces only: the existing motions are untouched.
  {
    const animals = await open("uid=a&cast=fail", { layout: START });
    await animals.locator(".yut-board-piece").first().waitFor();
    await animals.waitForTimeout(500);
    await shot(animals, "match-before-idle-1280x800");
    await playScenes(animals, "animal");
    await animals.context().close();
    pass(
      "Without avatars the same match plays walk, boarding, carry, caught, pair-caught, win and lose as animal pieces at the same moments.",
    );
  }

  // 4. Every failure keeps the animal pieces and the game.
  for (const [name, query, options, calls] of [
    ["cast refused by the network", "uid=a&cast=fail", {}, 1],
    ["a server without the view (invalid-argument)", "uid=a&cast=old", {}, 1],
    ["a service without the view", "uid=a", { bundle: "plain" }, 0],
    ["data saver", "uid=a&saver=1", {}, 0],
    ["a look this client cannot draw", "uid=a&cast=unknown-item", {}, 1],
  ]) {
    const fallback = await open(query, { ...options, layout: START });
    await fallback.locator(".yut-board-piece").first().waitFor();
    await fallback.waitForTimeout(700);
    const pieces = await art(fallback);
    assert.equal(pieces.length, 5, name);
    assert.ok(
      pieces.every((row) => !row.avatar && row.animal && row.frames === "3"),
      name + ": every piece is the animal piece",
    );
    assert.equal(
      await fallback.evaluate(() => window.yutQA.castCalls?.length || 0),
      calls,
      name,
    );
    // Play goes on: a move still animates and lands.
    await fallback.evaluate(() =>
      window.yutQA.push(window.yutQA.play(window.yutQA.room, "a", "1", 2)),
    );
    await fallback.waitForFunction(() =>
      document.querySelector(".yut-board-piece.is-moving"),
    );
    await fallback.waitForFunction(
      () => !document.querySelector(".yut-board-piece.is-moving"),
      null,
      { timeout: 8000 },
    );
    if (name.startsWith("a server without")) {
      // Not asked again for this page load, even when the players change.
      await fallback.evaluate(() => {
        const qa = window.yutQA,
          room = structuredClone(qa.room);
        room.players[3] = { ...room.players[3], uid: "e" };
        room.participantUids[3] = "e";
        qa.push({
          ...room,
          syncRevision: (room.syncRevision ?? room.revision) + 1,
        });
      });
      await fallback.waitForTimeout(1100);
      assert.equal(
        await fallback.evaluate(() => window.yutQA.castCalls.length),
        1,
      );
    }
    await fallback.context().close();
  }
  {
    // While the answer and the baking are pending the animal piece is shown; nothing waits for them.
    const pending = await open("uid=a&cast=hold", { layout: START });
    await pending.locator(".yut-board-piece").first().waitFor();
    await pending.waitForTimeout(400);
    assert.ok((await art(pending)).every((row) => !row.avatar && row.animal));
    await pending.evaluate(() =>
      window.yutQA.push(window.yutQA.play(window.yutQA.room, "a", "1", 2)),
    );
    await pending.waitForFunction(() =>
      document.querySelector(".yut-board-piece.is-moving"),
    );
    await pending.evaluate(() => window.yutQA.releaseCast());
    await settle(pending, 4);
    await pending.context().close();
  }
  pass(
    "Fallback to the animal piece: failed cast, old server (asked once, never again), a service without the view, data saver (not asked), an undrawable look, and while the answer is pending; a move plays in every case.",
  );

  // 5. No layout shift: the same scene with and without avatars has the same boxes.
  const SCENE = [
    "room-a",
    {
      a: ["o3+", "o3+"],
      b: ["o8", "home"],
      c: ["o13", "home"],
      d: ["o18", "home"],
    },
  ];
  const BOXES = [
    ".yut-isometric-board",
    ".yut-board-piece",
    ".yut-board-piece .yut-sprite",
    ".yut-pawn-number",
    ".yut-player",
    ".yut-portrait",
    ".yut-player-details",
    ".yut-action-dock",
    ".yut-match",
  ];
  const SEATS = [
    ".yut-waiting",
    ".yut-waiting-seats",
    ".yut-seat",
    ".yut-seat .yut-sprite",
    ".yut-seat-name",
    ".yut-seat-status",
    ".yut-waiting-footer",
  ];
  for (const [width, height] of [
    [844, 390],
    [1024, 768],
    [1280, 800],
  ]) {
    const size = `${width}x${height}`,
      measured = {};
    for (const mode of ["animals", "avatars"]) {
      const query = mode === "avatars" ? "uid=a" : "uid=a&cast=fail";
      const board = await open(query, { width, height, layout: SCENE[1] });
      await board.locator(".yut-board-piece").first().waitFor();
      if (mode === "avatars") await settle(board, 4);
      await board.waitForTimeout(500);
      const waiting = await open(query, { width, height, seed: "waiting" });
      await waiting.locator(".yut-seat .yut-sprite").first().waitFor();
      if (mode === "avatars") await settle(waiting, 2);
      await waiting.waitForTimeout(300);
      measured[mode] = {
        ...(await rects(board, BOXES)),
        ...(await rects(waiting, SEATS)),
      };
      const overflow = await board.evaluate(() => ({
        page: document.documentElement.scrollWidth > innerWidth + 1,
        pieces: Array.from(document.querySelectorAll(".yut-board-piece")).map(
          (node) => Math.round(node.getBoundingClientRect().width),
        ),
      }));
      assert.equal(
        overflow.page,
        false,
        `${size} ${mode}: no horizontal overflow`,
      );
      if (mode === "avatars")
        report.layout[size] = {
          pieceWidths: overflow.pieces,
          boxes: Object.fromEntries(
            Object.entries(measured[mode]).map(([key, value]) => [
              key,
              value.length,
            ]),
          ),
        };
      await shot(
        board,
        `match-${mode === "avatars" ? "after" : "before"}-stack-${size}`,
      );
      await shot(
        waiting,
        `waiting-${mode === "avatars" ? "after" : "before"}-${size}`,
      );
      if (mode === "avatars") {
        const seats = await art(waiting, ".yut-seat.is-filled");
        assert.deepEqual(
          seats.map((row) => row.avatar),
          [true, true, false, false],
          "waiting seats show the same cast",
        );
        // The stacked avatar pieces idle as a carried pair.
        assert.ok(
          (await art(board)).some(
            (row) => row.avatar && row.action === "carry",
          ),
        );
      }
      await board.context().close();
      await waiting.context().close();
    }
    for (const selector of [...BOXES, ...SEATS]) {
      assert.ok(
        measured.animals[selector].length > 0,
        `${size}: ${selector} exists`,
      );
      assert.deepEqual(
        measured.avatars[selector],
        measured.animals[selector],
        `${size}: ${selector} keeps its box with avatars`,
      );
    }
  }
  pass(
    "No layout shift at 844x390, 1024x768 and 1280x800: board, pieces, piece sprites, numbers, HUD cards, portraits, action dock, waiting seats, seat sprites and footer have identical boxes with and without avatars; no horizontal overflow.",
  );

  // 6. The piece choice on the entry screen, and a student's own single-player match.
  {
    const entry = await open("uid=a", { seed: "none" });
    const group = entry.getByRole("group", { name: "내 말" });
    await group.waitFor();
    assert.deepEqual(
      await entry.evaluate(() =>
        window.yutQA.castCalls.map((call) => call.roomId),
      ),
      [null],
      "without a room only my own piece is asked",
    );
    assert.equal(
      await group
        .getByRole("button", { name: "내 아바타" })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await entry
        .locator(".yut-piece-style")
        .evaluate(
          (node) => node.querySelectorAll("p,small,[role=note]").length,
        ),
      0,
      "no helper sentence",
    );
    await shot(entry, "entry-choice-1280x800");
    // A refused save changes nothing and says so in the game's own message.
    await entry.evaluate(() => {
      window.yutQA.failPiece = true;
    });
    await group.getByRole("button", { name: "동물 말" }).click();
    await entry.getByRole("alert").waitFor();
    assert.equal(
      await group
        .getByRole("button", { name: "내 아바타" })
        .getAttribute("aria-pressed"),
      "true",
    );
    await entry.getByRole("button", { name: "알림 닫기" }).click();
    await group.getByRole("button", { name: "동물 말" }).click();
    await entry.waitForFunction(
      () =>
        document.querySelector(".yut-piece-style button[aria-pressed=true]")
          ?.textContent === "동물 말",
    );
    assert.deepEqual(await entry.evaluate(() => window.yutQA.pieceCalls), [
      "classic",
      "classic",
    ]);
    await group.getByRole("button", { name: "동물 말" }).click();
    assert.equal(
      await entry.evaluate(() => window.yutQA.pieceCalls.length),
      2,
      "the chosen piece is not saved again",
    );
    // Single player with the animal piece, then back to the avatar.
    await entry.getByRole("button", { name: /혼자서 시작/ }).click();
    await entry.getByRole("button", { name: "싱글 시작" }).click();
    await entry.locator(".yut-board-piece").first().waitFor();
    await entry.waitForTimeout(600);
    assert.ok(
      (await art(entry)).every((row) => !row.avatar && row.animal),
      "the animal piece was chosen",
    );
    await entry.context().close();
    const single = await open("uid=a", { seed: "none" });
    await single.getByRole("group", { name: "내 말" }).waitFor();
    await single.getByRole("button", { name: /혼자서 시작/ }).click();
    await single.getByRole("button", { name: "싱글 시작" }).click();
    await settle(single, 2);
    const pieces = await art(single);
    assert.ok(
      pieces.filter((row) => row.avatar).length >= 1 &&
        pieces
          .filter((row) => row.avatar)
          .every((row) => /나|김하늘/.test(row.label)),
      "only my own pieces are my avatar",
    );
    assert.deepEqual(
      await art(single, ".yut-player .yut-portrait").then((rows) =>
        rows.map((row) => row.avatar),
      ),
      [true, false, false, false],
      "computer players keep the animal piece",
    );
    assert.deepEqual(
      await single.evaluate(() => [
        window.yutQA.castCalls.length,
        window.yutQA.commands.length,
      ]),
      [1, 0],
      "a single-player match asks nothing more and sends no command",
    );
    await shot(single, "single-after-1280x800");
    await single.context().close();
    // On short and medium screens the choice stays inside the menu and can be reached.
    for (const [width, height] of [
      [844, 390],
      [1024, 768],
    ]) {
      const small = await open("uid=a", { seed: "none", width, height });
      const choice = small.getByRole("group", { name: "내 말" });
      await choice.waitFor({ state: "attached" });
      await choice.scrollIntoViewIfNeeded();
      const fits = await small.evaluate(() => {
        const menu = document
          .querySelector(".yut-entry-menu")
          .getBoundingClientRect();
        return Array.from(
          document.querySelectorAll(".yut-piece-style button"),
        ).map((button) => {
          const box = button.getBoundingClientRect();
          return (
            box.left >= menu.left - 0.5 &&
            box.right <= menu.right + 0.5 &&
            box.top >= menu.top - 0.5 &&
            box.bottom <= menu.bottom + 0.5 &&
            box.height >= 44
          );
        });
      });
      assert.deepEqual(
        fits,
        [true, true],
        `${width}x${height}: both choices are 44px targets inside the menu`,
      );
      assert.equal(
        await small.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      await shot(small, `entry-choice-${width}x${height}`);
      await small.context().close();
    }
    // No saved avatar, and a teacher: no choice is offered and nothing is drawn as an avatar.
    for (const query of ["uid=d", "uid=a&portal=teacher"]) {
      const none = await open(query, { seed: "none" });
      await none.getByRole("button", { name: /여럿이서 시작/ }).waitFor();
      await none.waitForTimeout(500);
      assert.equal(
        await none.getByRole("group", { name: "내 말" }).count(),
        0,
        query,
      );
      assert.equal(
        await none.evaluate(() => window.yutQA.castCalls.length),
        query.includes("teacher") ? 0 : 1,
        query,
      );
      await none.context().close();
    }
    pass(
      "The entry screen offers 내 아바타 / 동물 말 only to a student with a saved avatar; a refused save keeps the choice and shows the game's message; single-player uses my avatar for my pieces only and sends no command.",
    );
  }

  // 7. The teacher's read-only spectator shows the same cast and sends nothing else.
  {
    const spectator = await open(
      "view=spectator&uid=teacher-t&portal=teacher",
      { layout: START },
    );
    await spectator.locator(".yut-board").waitFor();
    await settle(spectator, 4);
    const pieces = await art(spectator);
    assert.equal(pieces.filter((row) => row.avatar).length, 2);
    assert.deepEqual(
      (await art(spectator, ".yut-spectator-players .yut-portrait")).map(
        (row) => row.avatar,
      ),
      [true, true, false, false],
    );
    assert.deepEqual(
      await spectator.evaluate(() => [
        window.yutQA.castCalls.length,
        window.yutQA.commands.length,
        window.yutQA.pieceCalls.length,
      ]),
      [1, 0, 0],
    );
    await shot(spectator, "spectator-after-1280x800");
    await spectator.context().close();
    pass(
      "The teacher spectator shows the two avatars on the board and in the player list with one cast request and no command.",
    );
  }

  // 8. Dense screens bake a 1x sheet and enlarge its pixels as they are.
  {
    const dense = await open("uid=a", { dpr: 2, layout: START });
    await settle(dense, 4);
    const sprites = await dense.evaluate(() =>
      Array.from(document.querySelectorAll(".yut-avatar-sprite")).map(
        (node) => [
          node.dataset.avatarScale,
          getComputedStyle(node).imageRendering,
        ],
      ),
    );
    assert.ok(
      sprites.every(
        ([scale, rendering]) => scale === "1" && rendering === "pixelated",
      ),
    );
    await shot(dense, "match-after-idle-1280x800-dpr2");
    await dense.context().close();
    const plain = await open("uid=a", { layout: START });
    await settle(plain, 4);
    assert.deepEqual(
      await plain.evaluate(() =>
        [
          ".yut-board-piece .yut-avatar-sprite",
          ".yut-portrait .yut-avatar-sprite",
        ].map(
          (selector) =>
            getComputedStyle(document.querySelector(selector)).imageRendering,
        ),
      ),
      ["pixelated", "auto"],
      "pieces stay unsmoothed; larger portraits of a doubled sheet are smoothed",
    );
    await plain.context().close();
    pass(
      "Device pixel ratio 2 uses a 1x sheet with unsmoothed pixels everywhere; ratio 1 uses a 2x sheet, unsmoothed on the board and smoothed in larger portraits.",
    );
  }

  // 9. Back-do: one piece home and one on the board, the word, the single way back and the start pad.
  {
    const page = await open("uid=a", {
      layout: {
        a: ["o2", "finish"],
        b: ["o8", "home"],
        c: ["o13", "home"],
        d: ["o18", "home"],
      },
    });
    await page.waitForFunction(
      () =>
        document.querySelector("[data-board-art]")?.dataset.boardArt ===
        "ready",
    );
    const backThrow = () =>
      page.evaluate(() => {
        const qa = window.yutQA;
        const turn = {
          ...qa.room,
          turnUid: "a",
          phase: "throw",
          pendingThrow: null,
          extraThrows: 0,
          revision: qa.room.revision + 1,
          phaseStartsAtMs: 0,
          turnDeadlineMs: Date.now() + 900000,
        };
        const thrown = qa.core.throwYut(
          turn,
          "a",
          [false, false, true, false],
          Date.now() - 10,
          0.5,
          undefined,
          undefined,
          true,
        );
        qa.push({ ...thrown, turnInputDeadlineMs: Date.now() + 900000 });
      });
    const idle = () =>
      page.waitForFunction(
        () => !document.querySelector(".yut-board-piece.is-moving"),
        null,
        { timeout: 8000 },
      );
    const boxes = (selector) =>
      page.evaluate((selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return [box.x, box.y, box.width, box.height].map(Math.round);
      }, selector);
    for (const [from, to] of [
      ["o2", "o1"],
      ["o1", "o20"],
    ]) {
      await backThrow();
      await page.locator('.yut-landing-result[data-result="-1"]').waitFor();
      assert.equal(
        await page.locator(".yut-landing-result").textContent(),
        "빽도!뒤로 1칸",
      );
      assert.deepEqual(
        await boxes(".yut-toss-stage"),
        await boxes(".yut-match"),
        "the throw covers the whole match, centred on the screen",
      );
      await shot(page, `back-do-${from}`);
      await page.locator(".yut-isometric-destination").first().waitFor();
      assert.equal(await page.locator(".yut-isometric-destination").count(), 1);
      assert.equal(
        await page
          .locator(".yut-toss-stage")
          .evaluate((node) => getComputedStyle(node).visibility),
        "hidden",
        "the sticks leave the board before the move is chosen",
      );
      assert.deepEqual(
        await page
          .locator(".yut-destination-pad")
          .evaluateAll((nodes) => nodes.map((node) => node.dataset.padNode)),
        [to],
      );
      assert.match(
        await page.locator(".yut-throw-result").textContent(),
        /빽도.*뒤로 1칸/,
      );
      await page.evaluate(() => {
        const qa = window.yutQA;
        const move = qa.core.getLegalYutMoves(qa.room, "a")[0];
        qa.push(
          qa.steady(
            qa.core.moveYut(
              qa.room,
              "a",
              move.pieceId,
              move.route,
              qa.room.phaseStartsAtMs + 1,
            ),
          ),
        );
      });
      await page.waitForFunction(() =>
        document.querySelector(
          '.yut-board-piece.is-moving[data-motion="land"]',
        ),
      );
      await idle();
      assert.equal(
        await page
          .locator('.yut-board-piece[data-piece-ids="1"][aria-label*="김하늘"]')
          .getAttribute("data-pawn-node"),
        to,
      );
    }
    // Any forward throw takes the piece on the start pad home.
    await page.evaluate(() =>
      window.yutQA.push(window.yutQA.play(window.yutQA.room, "a", "1", 1)),
    );
    await page.locator(".yut-victory").waitFor({ timeout: 8000 });
    await page.context().close();
    // Not eligible before a piece is home: the rule refuses the result itself.
    const early = await open("uid=a", { layout: START });
    assert.equal(
      await early.evaluate(() =>
        window.yutQA.core.canThrowYutBack(window.yutQA.room, "a"),
      ),
      false,
    );
    await early.context().close();
    pass(
      "Back-do appears only after one piece is home, shows 빽도! over a match-wide throw, offers the one pad back (to the start pad from the first) and the waiting piece then finishes.",
    );
  }

  assert.deepEqual(report.errors, [], "no page or console error");
  report.passed = true;
} finally {
  await fs.writeFile(
    path.join(evidence, "verify-yut-avatar-browser.json"),
    JSON.stringify(report, null, 1),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
