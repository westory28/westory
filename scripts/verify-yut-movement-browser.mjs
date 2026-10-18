/** Real rendered pawn frames, finish ordering, receipts and busy input guards. Synthetic transport only. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url),
  { build } = require("esbuild");
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
  );
}
const evidence = path.join(root, "output/yut-movement-20261018");
await fs.mkdir(evidence, { recursive: true });
const source = (p) => JSON.stringify(path.join(root, p).replaceAll("\\", "/"));
const service = `import * as core from ${source("functions/yutCore.mjs")};
const params=new URLSearchParams(location.search),listeners=new Set();
export const useAuth=()=>({config:{year:'2026',semester:'2'},currentUser:{uid:'qa'},userData:{role:'student',name:'검증 학생'}});
export const YUT_PRIVATE_DAILY_LIMIT=5;
export const DEFAULT_YUT_SETTINGS={enabled:true,version:1,allowSolo:true,allowMultiplayer:true,allowPrivateRooms:true,defaultPlayerCount:2,throwSeconds:5,moveSeconds:25};
export const normalizeYutSettings=value=>({...DEFAULT_YUT_SETTINGS,...value});
const sticks=value=>Array.from({length:4},(_,index)=>value!==5&&index<value);
function seed(kind){
  const four=kind.endsWith('four')||kind==='two-capture-many';
  let room=core.createYutRoom({id:'qa-'+kind,code:'AB1234',classId:'',classLabel:'검증 윷판',host:{uid:'qa',name:'검증 학생'},nowMs:Date.now(),maxPlayers:four?4:2,moveSeconds:Number(params.get('move-seconds')||25)});
  room=core.addYutPlayer(room,{uid:'other',name:'상대 학생'},Date.now());room=core.readyYutPlayer(room,'other',true,Date.now());
  if(four){room=core.addYutPlayer(room,{uid:'third',name:'셋째 학생'},Date.now());room=core.readyYutPlayer(room,'third',true,Date.now());room=core.addYutPlayer(room,{uid:'fourth',name:'넷째 학생'},Date.now());room=core.readyYutPlayer(room,'fourth',true,Date.now());}
  if(kind.startsWith('waiting'))return room;
  room=core.startYutGame(room,Date.now()-10000);
  const own=room.players[0].pieces;
  own[0].node=kind.startsWith('finish')||kind==='two-finish-first'?'o18':kind==='corner'?'o14':'o5';
  if(kind.startsWith('finish')&&own[1])own[1].node='finish';
  if(kind.startsWith('finish')||kind==='two-finish-first')room.players.slice(1).forEach((player,index)=>player.pieces.forEach(piece=>piece.node=['o5','o10','o15'][index]));
  if(kind.startsWith('capture'))room.players[1].pieces[0].node='a5';
  if(kind==='two-home')own.forEach(piece=>piece.node='home');
  if(kind==='two-choice'){own[0].node='o1';own[1].node='o3';}
  if(kind==='two-group')own.forEach(piece=>Object.assign(piece,{node:'o3',stackId:'qa-stack'}));
  if(kind==='two-capture-many'){
    own.forEach(piece=>Object.assign(piece,{node:'o5',stackId:'qa-stack'}));
    room.players.slice(1,3).forEach(player=>player.pieces.forEach(piece=>Object.assign(piece,{node:'a5',lane:'a',stackId:player.uid+'-stack'})));
  }
  const value=['two-home','two-choice','two-group'].includes(kind)?2:kind.startsWith('finish')||['corner','vertical'].includes(kind)?3:5;
  room=core.throwYut(room,'qa',sticks(value),Date.now()-4000);room.turnDeadlineMs=Date.now()+room.moveSeconds*1000;
  if(kind==='capture-initial')room=core.moveYut(room,'qa','1','a',Date.now());return room;
}
const qa=window.qa={room:seed(params.get('scenario')||'finish'),delay:0,fail:false,claimPaid:false,calls:[],motion:[],frames:[],steps:[]};
qa.emit=room=>{qa.room=room;listeners.forEach(listener=>listener(room));};
qa.move=(route='a',pieceId='1',stack=false)=>{const room=core.moveYut(qa.room,'qa',pieceId,route,Date.now(),stack);if(room.status==='finished')room.reward={status:'pending',uid:'qa',amount:7,policyVersion:1,reason:'account-unavailable'};qa.emit(room)};
qa.bump=()=>qa.emit({...qa.room,revision:qa.room.revision+1,syncRevision:qa.room.syncRevision+1,lastEvent:{kind:'leave',atMs:Date.now(),text:'연결 상태 갱신'}});
qa.repeat=()=>qa.emit({...qa.room,syncRevision:qa.room.syncRevision+1});
qa.prepareThrow=value=>{const room={...qa.room,turnUid:'qa',phase:'throw',phaseStartsAtMs:Date.now()-5000,turnDeadlineMs:Date.now()+25000};qa.emit(core.throwYut(room,'qa',sticks(value),Date.now()-4000));};
qa.preparePiece=(pieceId,node,value)=>{const room=JSON.parse(JSON.stringify(qa.room));if(node)room.players[0].pieces.find(piece=>piece.id===pieceId).node=node;Object.assign(room,{turnUid:'qa',phase:'throw',phaseStartsAtMs:Date.now()-5000,turnDeadlineMs:Date.now()+25000});qa.emit(core.throwYut(room,'qa',sticks(value),Date.now()-4000));};
export const getYutLobby=async()=>{if(params.has('slow-lobby'))await new Promise(r=>setTimeout(r,700));return{enabled:true,settings:DEFAULT_YUT_SETTINGS,privatePlaysRemaining:5,room:qa.room,classes:[],classId:'',serverNowMs:Date.now()}};
export const subscribeYutRoom=(_config,_id,onRoom)=>{listeners.add(onRoom);return()=>listeners.delete(onRoom)};
export const commandYutRoom=async(_config,data)=>{qa.calls.push(data);if(qa.delay)await new Promise(r=>setTimeout(r,qa.delay));if(qa.fail){qa.fail=false;throw new Error('검증용 연결 오류')}if(data.action==='move')qa.move(data.route,data.pieceId,data.stack);else if(data.action==='claimReward'){qa.emit({...qa.room,syncRevision:(qa.room.syncRevision||0)+1,reward:{...qa.room.reward,status:qa.claimPaid?'paid':'pending'}})}else if(data.action==='start')qa.emit(core.startYutGame(qa.room,Date.now()));else if(data.action==='throw')qa.emit(core.throwYut(qa.room,'qa',[true,false,false,false],Date.now(),data.power));else if(data.action==='leave')qa.emit(null);return{room:qa.room,serverNowMs:Date.now()}};
export const yutErrorMessage=error=>error.message;
export const getLegalYutMoves=core.getLegalYutMoves;
`;
const harness = `import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import Game from ${source("src/components/common/weplay/yut/YutGame.tsx")};import Board from ${source("src/components/common/weplay/yut/YutBoard.tsx")};import Frame from ${source("src/components/common/weplay/WeplayGameFrame.tsx")};import{getYutLobby,subscribeYutRoom,getLegalYutMoves}from ${source("src/lib/yut.ts")};
function App(){const[room,setRoom]=useState(window.qa.room),[key,setKey]=useState(0),[mounted,setMounted]=useState(true);window.qa.remount=()=>setKey(old=>old+1);window.qa.unmount=()=>setMounted(false);useEffect(()=>{const off=subscribeYutRoom(null,null,setRoom);const timer=setInterval(()=>setRoom(old=>({...old})),35);return()=>{off();clearInterval(timer)}},[]);const board=new URLSearchParams(location.search).has('board');return board?<div className="board-fixture yut-game">{mounted&&<Board key={key} room={room} uid="qa" selectedPiece="1" onSelectPiece={()=>{}} moves={getLegalYutMoves(room,'qa')} onMove={()=>{}} disabled={room.status==='finished'} onMotionChange={value=>window.qa.motion.push({value,at:performance.now()})} onStep={index=>{const node=document.querySelector('.is-moving:not(.is-caught)'),style=getComputedStyle(node),bounds=node.closest('.yut-board').getBoundingClientRect(),facing=node.querySelector('.yut-pawn-facing');window.qa.steps.push({index,at:performance.now(),x:parseFloat(style.left)/bounds.width*720,y:parseFloat(style.top)/bounds.height*560,lift:new DOMMatrixReadOnly(style.transform).m42+node.offsetHeight*.88,facing:facing?.dataset.facing,mirror:facing?new DOMMatrixReadOnly(getComputedStyle(facing).transform).m11:null,pieceIds:node.dataset.pieceIds,movingGroups:document.querySelectorAll('.is-moving:not(.is-caught)').length});}}/>}</div>:<Frame theme="yut"><Game portal="student" onBack={()=>{}} music={{enabled:false,failed:false,start:()=>{},toggle:()=>{}}} onMusicActiveChange={()=>{}}/></Frame>};createRoot(document.getElementById('root')).render(<App/>);`;
const artHarness = `import {YutSprite,YutStackOptionArt} from ${source("src/components/common/weplay/yut/YutArt.tsx")};
function Art(){const action=new URLSearchParams(location.search).get('art');return <div className="art-fixture yut-game" style={{display:'grid',gridTemplateColumns:'repeat(3, 190px)',gap:8,padding:16,height:'auto',width:610,background:'#d8c28e',color:'#241b14'}}><style>{'.art-fixture .yut-frame-sprite,.art-fixture .yut-stack-option-art{width:168px!important;height:168px!important;margin:auto}'}</style>{['sa','nong','gong','sang'].flatMap(role=>[0,1,2].map(frame=><div key={role+frame} data-art-frame={frame} style={{border:'1px solid #887045',background:'repeating-conic-gradient(#f5edd9 0% 25%,#dfd2b0 0% 50%) 50% / 20px 20px',textAlign:'center'}}><span style={{display:'block',background:'#f5edd9'}}>{action+' / '+role+' / '+(frame+1)}</span>{action==='stack-choice'?<YutStackOptionArt role={role} carried={frame===0}/>:<YutSprite role={role} pose={action}/>}</div>))}</div>};createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('art')?<Art/>:<App/>);`;
const bundle = await build({
  stdin: {
    contents:
      harness.replace(
        "createRoot(document.getElementById('root')).render(<App/>);",
        "",
      ) + artHarness,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  outfile: path.join(os.tmpdir(), "yut-motion.js"),
  loader: { ".woff2": "file", ".woff": "file" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "qa",
      setup(b) {
        b.onResolve({ filter: /^\/assets\// }, (args) => ({
          path: args.path,
          external: true,
        }));
        b.onResolve(
          {
            filter: /(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/yut(?:\.ts)?$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "ts",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).contents,
  css = bundle.outputFiles.find((f) => f.path.endsWith(".css")).contents;
const fonts = new Map(
  bundle.outputFiles
    .filter((f) => /\.woff2?$/.test(f.path))
    .map((f) => ["/" + path.basename(f.path), f.contents]),
);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let body;
  if (url.pathname === "/qa.js") {
    res.setHeader("Content-Type", "text/javascript");
    body = js;
  } else if (url.pathname === "/qa.css") {
    res.setHeader("Content-Type", "text/css");
    body = css;
  } else if (fonts.has(url.pathname)) {
    body = fonts.get(url.pathname);
  } else if (url.pathname.startsWith("/assets/")) {
    const target = path.resolve(root, "public", "." + url.pathname);
    if (!target.startsWith(path.join(root, "public") + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      body = await fs.readFile(target);
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
  } else {
    res.setHeader("Content-Type", "text/html");
    body =
      '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>*,::before,::after{box-sizing:border-box}body{margin:0;background:#1d2419}.board-fixture.yut-game{width:min(900px,100vw);--yut-board-ratio:2.1;display:block;height:auto;margin:0 auto}.weplay-game-frame{margin:24px auto}</style><div id="root"></div><script type="module" src="/qa.js"></script></html>';
  }
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await playwright.chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const presentationOnly = process.env.YUT_MOVEMENT_QA_SECTION === "presentation";
const gaugeOnly = process.env.YUT_MOVEMENT_QA_SECTION === "gauge";
const captureOnly = process.env.YUT_MOVEMENT_QA_SECTION === "capture";
const twoPiecesOnly = process.env.YUT_MOVEMENT_QA_SECTION === "two-pieces";
const artOnly = process.env.YUT_MOVEMENT_QA_SECTION === "art";
const report = {
  passed: false,
  section: artOnly
    ? "art"
    : twoPiecesOnly
      ? process.env.YUT_TWO_QA_PHASE
        ? "two-pieces-" + process.env.YUT_TWO_QA_PHASE
        : "two-pieces"
      : captureOnly
        ? "capture"
        : gaugeOnly
          ? "gauge"
          : presentationOnly
            ? "presentation"
            : "all",
  checks: [],
  errors: [],
  paths: {},
};
async function open(
  query,
  reducedMotion = "no-preference",
  width = 1280,
  height = 800,
) {
  const page = await browser.newPage({
    viewport: { width, height },
    reducedMotion,
  });
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("westory.weplay.musicMuted", "false");
    window.motionAudio = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      createBufferSource() {
        const source = super.createBufferSource(),
          start = source.start.bind(source);
        source.start = (...args) => {
          window.motionAudio.push({
            duration: source.buffer?.duration,
            rate: source.playbackRate.value,
            at: performance.now(),
          });
          return start(...args);
        };
        return source;
      }
    };
  });
  await page.goto(base + "/?" + query);
  await page.locator(".yut-game").waitFor();
  return page;
}
async function hidePage(page, hidden) {
  await page.evaluate((value) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => value,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
async function observeCapture(page) {
  await page.evaluate(() => {
    window.qa.reactions = [];
    let visible = false;
    new MutationObserver(() => {
      const reaction = document.querySelector(".yut-capture-reaction");
      if (Boolean(reaction) === visible) return;
      visible = Boolean(reaction);
      window.qa.reactions.push({
        visible,
        at: performance.now(),
        text: reaction?.textContent,
      });
    }).observe(document.getElementById("root"), {
      childList: true,
      subtree: true,
    });
  });
}
async function inspectSpriteFrames(locator) {
  const frames = await locator.evaluateAll(async (nodes) =>
    Promise.all(
      nodes.map(async (node) => {
        const drawn = Array.from(node.querySelectorAll(".yut-drawn-frame"));
        const style = getComputedStyle(node);
        if (drawn.length !== 3)
          return {
            missing: true,
            count: drawn.length,
            action: node.dataset.spriteAction,
          };
        const animations = drawn.flatMap((frame) => frame.getAnimations());
        if (animations.length < 3)
          return {
            missing: true,
            animations: animations.length,
            action: node.dataset.spriteAction,
          };
        const previous = animations.map((animation) => ({
          animation,
          time: animation.currentTime,
          state: animation.playState,
        }));
        animations.forEach((animation) => animation.pause());
        const poses = [0.04, 0.4, 0.85].map((progress) => {
          animations.forEach(
            (animation) =>
              (animation.currentTime =
                animation.effect.getTiming().delay > 0
                  ? 0
                  : Number(animation.effect.getTiming().duration) * progress),
          );
          return drawn.map((frame) => ({
            opacity: Number(getComputedStyle(frame).opacity),
            transform: getComputedStyle(frame).transform,
          }));
        });
        const latePoses =
          node.dataset.spriteAction === "lose"
            ? [880, 1780, 2680].map((time) => {
                animations.forEach(
                  (animation) => (animation.currentTime = time),
                );
                return drawn.map((frame) =>
                  Number(getComputedStyle(frame).opacity),
                );
              })
            : [];
        const animationTimings = animations.map((animation) => ({
          duration: animation.effect.getTiming().duration,
          delay: animation.effect.getTiming().delay,
          iterations: animation.effect.getTiming().iterations,
        }));
        previous.forEach((item) => {
          item.animation.currentTime = item.time;
          if (item.state === "running") item.animation.play();
        });
        const sources = drawn.map((frame) => {
          const [x, y, width, height] = frame.dataset.sourceRect
              .split(",")
              .map(Number),
            inner = frame.querySelector("svg"),
            image = frame.querySelector("image");
          return {
            index: Number(frame.dataset.frameIndex),
            x,
            y,
            width,
            height,
            dx: inner.x.baseVal.value,
            dy: inner.y.baseVal.value,
            size: frame.viewBox.baseVal.width,
            url: image?.href.baseVal,
            preserveAspectRatio: frame.getAttribute("preserveAspectRatio"),
          };
        });
        const images = new Map();
        const raster = await Promise.all(
          sources.map(async (source) => {
            if (!images.has(source.url))
              images.set(
                source.url,
                new Promise((resolve, reject) => {
                  const image = new Image();
                  image.onload = () => resolve(image);
                  image.onerror = () =>
                    reject(
                      new Error("Missing whole-character atlas: " + source.url),
                    );
                  image.src = source.url;
                }),
              );
            const atlas = await images.get(source.url),
              canvas = document.createElement("canvas");
            canvas.width = 64;
            canvas.height = 64;
            const context = canvas.getContext("2d", {
                willReadFrequently: true,
              }),
              scale = 64 / source.size,
              width = source.width * scale,
              height = source.height * scale;
            context.drawImage(
              atlas,
              source.x,
              source.y,
              source.width,
              source.height,
              source.dx * scale,
              source.dy * scale,
              width,
              height,
            );
            source.atlasWidth = atlas.width;
            source.atlasHeight = atlas.height;
            return context.getImageData(0, 0, 64, 64).data;
          }),
        );
        const differences = [
          [0, 1],
          [1, 2],
          [0, 2],
        ].map(([a, b]) => {
          let different = 0;
          for (let i = 0; i < raster[a].length; i += 4)
            if (
              Math.abs(raster[a][i] - raster[b][i]) +
                Math.abs(raster[a][i + 1] - raster[b][i + 1]) +
                Math.abs(raster[a][i + 2] - raster[b][i + 2]) +
                Math.abs(raster[a][i + 3] - raster[b][i + 3]) >
              24
            )
              different++;
          return different / (64 * 64);
        });
        return {
          action: node.dataset.spriteAction,
          width: parseFloat(style.width),
          height: parseFloat(style.height),
          transform: style.transform,
          masks: node.querySelectorAll("mask,clipPath,.yut-waiting-arm").length,
          maskImage: style.maskImage,
          easing: drawn.map(
            (frame) => getComputedStyle(frame).animationTimingFunction,
          ),
          poses,
          latePoses,
          animationTimings,
          sources,
          differences,
        };
      }),
    ),
  );
  assert.ok(frames.length > 0, "Expected whole-character sprite frames");
  for (const frame of frames) {
    assert.equal(
      frame.missing,
      undefined,
      "Three complete SVG frame animations must exist: " +
        JSON.stringify(frame),
    );
    assert.ok(
      Math.abs(frame.width - frame.height) < 0.6,
      "Character viewports retain square proportions",
    );
    assert.equal(frame.masks, 0, "No cut sleeve/body masks remain");
    assert.equal(frame.maskImage, "none");
    assert.equal(
      frame.transform,
      "none",
      "Whole-body wrappers remain undeformed",
    );
    const visible = frame.poses.map((pose) => {
      assert.ok(
        pose.every((item) => item.opacity === 0 || item.opacity === 1),
        "Discrete drawings do not crossfade",
      );
      assert.equal(
        pose.filter((item) => item.opacity === 1).length,
        1,
        "Exactly one complete drawing is visible",
      );
      assert.ok(
        pose.every((item) => item.transform === "none"),
        "No individual drawing is deformed",
      );
      return pose.findIndex((item) => item.opacity === 1);
    });
    assert.equal(
      new Set(visible).size,
      3,
      "The three separately drawn frames are all displayed",
    );
    assert.ok(
      frame.easing.every((value) => value.includes("steps")),
      "Frame replacement uses steps timing",
    );
    if (frame.action === "lose")
      assert.deepEqual(
        frame.latePoses.map((pose) => {
          assert.equal(pose.filter((opacity) => opacity === 1).length, 1);
          return pose.findIndex((opacity) => opacity === 1);
        }),
        [1, 2, 1],
        "After falling, only the two prone drawings repeat",
      );
    if (frame.action === "win")
      assert.ok(
        frame.animationTimings.every((timing) => timing.iterations === 3),
        "Winner drawing sequence repeats three finite times",
      );
    assert.deepEqual(
      frame.sources.map((source) => source.index),
      [0, 1, 2],
    );
    assert.equal(
      new Set(
        frame.sources.map((source) =>
          [source.x, source.y, source.width, source.height].join(","),
        ),
      ).size,
      3,
      "Each frame has its own complete source region",
    );
    assert.ok(
      frame.sources.every(
        (source) =>
          source.width > 0 &&
          source.height > 0 &&
          source.preserveAspectRatio !== "none",
      ),
      "Frame viewport preserves the original body aspect ratio",
    );
    assert.ok(
      frame.differences.every((value) => value > 0.005),
      "All three source drawings are materially different: " +
        JSON.stringify(frame.differences),
    );
  }
  return frames;
}

async function openStackDialog(page) {
  await page
    .getByRole("progressbar", { name: "말 이동 남은 시간", exact: true })
    .waitFor();
  await page.locator(".yut-isometric-destination").first().press("Enter");
  await page.getByRole("button", { name: "결정", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "내 말과 만났습니다",
    exact: true,
  });
  await dialog.waitFor();
  return dialog;
}
async function verifyArtSheets() {
  for (const action of [
    "idle",
    "walk",
    "carry",
    "boarding",
    "win",
    "lose",
    "caught",
    "pair-caught",
    "stack-choice",
  ]) {
    const page = await open("art=" + action, "no-preference", 680, 900);
    if (action !== "stack-choice") {
      const frames = await inspectSpriteFrames(
        page.locator(".art-fixture .yut-frame-sprite"),
      );
      report.paths["atlas-" + action] = frames;
      await page
        .locator(".art-fixture .yut-frame-sprite")
        .evaluateAll((nodes) =>
          nodes.forEach((node) => {
            const animations = Array.from(
              node.querySelectorAll(".yut-drawn-frame"),
            ).flatMap((frame) => frame.getAnimations());
            animations.forEach((animation) => {
              animation.pause();
              animation.currentTime = 0;
            });
            animations.forEach((animation) => {
              animation.currentTime =
                animation.effect.getTiming().delay > 0
                  ? 0
                  : Number(animation.effect.getTiming().duration) *
                    [0.04, 0.4, 0.85][
                      Number(node.parentElement.dataset.artFrame)
                    ];
            });
          }),
        );
    }
    await page.screenshot({
      path: path.join(evidence, "atlas-" + action + ".png"),
      fullPage: true,
    });
    await page.close();
  }
  report.checks.push(
    "Eight full-body sheets use square character viewports, three distinct source drawings per role and discrete opacity frames; contact sheets include stack-choice art for visual clipping inspection",
  );
}
async function verifyTwoViewports() {
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [768, 600],
    [844, 390],
    [1280, 800],
  ]) {
    const page = await open(
      "scenario=two-home",
      "no-preference",
      width,
      height,
    );
    if (height > width && width < 1024) {
      await page.locator(".yut-orientation-gate").waitFor();
      assert.equal(await page.locator(".yut-board").count(), 0);
    } else {
      await page
        .getByRole("progressbar", { name: "말 이동 남은 시간", exact: true })
        .waitFor();
      const own = page.locator('.yut-board-piece[aria-label^="검증 학생"]');
      assert.equal(
        await own.count(),
        2,
        "Both home pieces have independently selectable numbered pawns",
      );
      assert.deepEqual(
        (await own.locator(".yut-pawn-number").allTextContents()).sort(),
        ["1", "2"],
      );
      const portraits = await page
        .locator(".yut-player .yut-portrait")
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const style = getComputedStyle(node);
            return {
              width: parseFloat(style.width),
              height: parseFloat(style.height),
              radius: style.borderRadius,
            };
          }),
        );
      assert.equal(portraits.length, 2, "Each corner HUD uses one portrait");
      assert.ok(
        portraits.every(
          (item) =>
            Math.abs(item.width - item.height) < 0.6 &&
            item.radius.includes("50%"),
        ),
        "HUD portraits are circular without vertical stretching",
      );
      assert.equal(
        await page.locator(".yut-isometric-destination-symbol").count(),
        0,
        "Golden directional-arrow targets are removed",
      );
      assert.ok(
        (
          await page.locator(".yut-isometric-destination").allTextContents()
        ).every((text) => !/[←↑→↓↖↗↘↙]/.test(text)),
      );
      const numberGeometry = await own
        .locator(".yut-pawn-number")
        .evaluateAll((nodes) => {
          const gauge = document
            .querySelector(".yut-turn-gauge")
            ?.getBoundingClientRect();
          return nodes.map((node) => {
            const box = node.getBoundingClientRect();
            const overlap = gauge
              ? Math.max(
                  0,
                  Math.min(box.right, gauge.right) -
                    Math.max(box.left, gauge.left),
                ) *
                Math.max(
                  0,
                  Math.min(box.bottom, gauge.bottom) -
                    Math.max(box.top, gauge.top),
                )
              : 0;
            return {
              text: node.textContent,
              box: box.toJSON(),
              gauge: gauge?.toJSON(),
              overlapRatio: overlap / (box.width * box.height),
            };
          });
        });
      report.paths[`two-home-${width}`] = { portraits, numberGeometry };
      assert.ok(
        numberGeometry.every((item) => item.overlapRatio < 0.1),
        "The central turn gauge must not hide the numbered home pieces: " +
          JSON.stringify(numberGeometry),
      );
      const footerOverlap = await own.evaluateAll((nodes) => {
        const controls = Array.from(
          document.querySelectorAll(
            ".yut-action-dock button,.yut-action-dock .yut-throw-result,.yut-action-dock .yut-move-hint",
          ),
          (node) => node.getBoundingClientRect(),
        );
        return nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return Math.max(
            ...controls.map(
              (footer) =>
                Math.max(
                  0,
                  Math.min(box.right, footer.right) -
                    Math.max(box.left, footer.left),
                ) *
                Math.max(
                  0,
                  Math.min(box.bottom, footer.bottom) -
                    Math.max(box.top, footer.top),
                ),
            ),
          );
        });
      });
      assert.ok(
        footerOverlap.every((area) => area === 0),
        "Mobile home pieces never cover the decision dock",
      );
      report.paths[`two-home-${width}`].footerOverlap = footerOverlap;
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: path.join(evidence, `two-pieces-${width}-${height}.png`),
    });
    await page.close();
  }
  report.checks.push(
    "Two numbered home pieces, circular HUD portraits, tile targets and portrait orientation gates fit 390/768/844/1280 viewports",
  );
}
async function verifyTwoChoices() {
  for (const carry of [false, true]) {
    const page = await open(
      "scenario=two-choice",
      "no-preference",
      carry ? 1280 : 844,
      carry ? 800 : 390,
    );
    let dialog = await openStackDialog(page);
    if (!carry) {
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.equal(
        await page.evaluate(
          () => window.qa.calls.filter((call) => call.action === "move").length,
        ),
        0,
      );
      dialog = await openStackDialog(page);
      await dialog
        .getByRole("button", { name: "이동 선택으로 돌아가기", exact: true })
        .click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(
        await page.evaluate(
          () => window.qa.calls.filter((call) => call.action === "move").length,
        ),
        0,
      );
      dialog = await openStackDialog(page);
    }
    assert.equal(
      await dialog
        .getByRole("button", { name: "결정", exact: true })
        .isEnabled(),
      false,
      "Card selection is required before committing",
    );
    const pictures = await dialog
      .locator(".yut-stack-option-picture")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
      );
    assert.equal(pictures.length, 2);
    assert.ok(
      pictures.every((box) => Math.abs(box.width - box.height) < 1),
      "Stack drawings retain square cells",
    );
    await page.screenshot({
      path: path.join(
        evidence,
        carry ? "stack-choice-desktop.png" : "stack-choice-landscape.png",
      ),
    });
    await dialog
      .getByRole("button", {
        name: carry ? "업고 가기" : "따로 가기",
        exact: true,
      })
      .press("Enter");
    await page.evaluate(() => (window.qa.delay = 800));
    await dialog
      .getByRole("button", { name: "결정", exact: true })
      .press("Enter");
    await page.locator(".weplay-game-loading").waitFor();
    assert.equal(
      await page.locator(".yut-game-content").evaluate((node) => node.inert),
      true,
    );
    assert.ok(
      await dialog
        .locator("button")
        .evaluateAll((nodes) =>
          nodes.every((node) => node.disabled || node.closest("[inert]")),
        ),
    );
    assert.equal(
      await page.evaluate(() => window.qa.room.players[0].pieces[0].node),
      "o1",
      "Server wait never moves or merges pieces optimistically",
    );
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => window.qa.room.players[0].pieces[0].node === "o3",
    );
    await dialog.waitFor({ state: "detached" });
    if (carry) {
      await page
        .locator('.yut-pawn-art[data-boarding="true"]')
        .waitFor({ state: "attached" });
      const boarding = await page.evaluate(() => ({
        at: performance.now(),
        number: document.querySelector(".is-moving .yut-pawn-number")
          ?.textContent,
        phaseStart: window.qa.room.phaseStartsAtMs,
        deadline: window.qa.room.turnDeadlineMs,
        moveAt: window.qa.room.lastEvent.atMs,
      }));
      assert.equal(boarding.number, "1·2");
      assert.equal(boarding.phaseStart - boarding.moveAt, 2100);
      assert.equal(boarding.deadline - boarding.phaseStart, 5000);
      assert.equal(
        await page.locator(".yut-turn-gauge").count(),
        0,
        "Boarding never consumes a visible next-turn gauge",
      );
      await page
        .locator('.yut-pawn-art[data-boarding="true"]')
        .waitFor({ state: "detached" });
      const boardingEnd = await page.evaluate(() => performance.now());
      assert.ok(
        boardingEnd - boarding.at >= 600,
        "New group keeps the boarding scene for about 700ms",
      );
      report.paths["boarding-timing"] = { ...boarding, endedAt: boardingEnd };
    }
    await page.locator(".is-moving").waitFor({ state: "detached" });
    const result = await page.evaluate(() => ({
      pieces: window.qa.room.players[0].pieces,
      calls: window.qa.calls.filter((call) => call.action === "move"),
    }));
    assert.equal(
      result.calls.length,
      1,
      "Pending keyboard input never duplicates a move",
    );
    assert.equal(result.calls[0].pieceId, "1");
    assert.equal(result.calls[0].stack, carry);
    if (carry) {
      assert.ok(
        result.pieces[0].stackId &&
          result.pieces[0].stackId === result.pieces[1].stackId,
      );
      assert.equal(
        await page
          .locator(
            '.yut-board-piece[aria-label^="검증 학생"][data-piece-ids="1,2"]',
          )
          .count(),
        1,
      );
    } else {
      assert.ok(result.pieces.every((piece) => !piece.stackId));
      const sameTile = page.locator(
        '.yut-board-piece[aria-label^="검증 학생"]',
      );
      assert.equal(await sameTile.count(), 2);
      const boxes = await sameTile.evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, width: rect.width };
        }),
      );
      assert.ok(
        Math.abs(boxes[0].x - boxes[1].x) >= 30,
        "Independent pieces on one tile stay visibly separated",
      );
      await page.evaluate(() => {
        window.qa.delay = 0;
        window.qa.preparePiece("1", null, 1);
      });
      await page
        .getByRole("progressbar", { name: "말 이동 남은 시간", exact: true })
        .waitFor();
      await page
        .locator(
          '.yut-board-piece[aria-label^="검증 학생"][data-piece-ids="1"]',
        )
        .click();
      await page.locator(".yut-isometric-destination").first().click();
      await page.getByRole("button", { name: "결정", exact: true }).click();
      await page.waitForFunction(
        () => window.qa.room.players[0].pieces[0].node === "o4",
      );
      assert.equal(
        await page.evaluate(() => window.qa.room.players[0].pieces[1].node),
        "o3",
        "Separate choice preserves independent movement next turn",
      );
    }
    report.paths[carry ? "carry-choice" : "separate-choice"] = {
      result,
      pictures,
    };
    await page.close();
  }
  report.checks.push(
    "Stack dialog supports reversible Escape/back and keyboard choice; pending input locks while one authoritative move keeps pieces independent or forms their explicit group",
  );
}
async function verifyTwoPieces() {
  if (process.env.YUT_TWO_QA_PHASE === "viewports") {
    await verifyTwoViewports();
    return;
  }
  if (process.env.YUT_TWO_QA_PHASE === "selection") {
    await verifySelectedPiece();
    return;
  }
  if (!process.env.YUT_TWO_QA_PHASE) await verifySelectedPiece();
  if (process.env.YUT_TWO_QA_PHASE !== "choices") await verifyTwoViewports();
  await verifyTwoChoices();
  if (process.env.YUT_TWO_QA_PHASE !== "choices")
    await verifyTwoGroupAndFinish();
}
async function verifySelectedPiece() {
  const page = await open("scenario=two-home", "no-preference", 844, 390);
  await page
    .getByRole("progressbar", { name: "말 이동 남은 시간", exact: true })
    .waitFor();
  await page.locator(".yut-isometric-destination").first().click();
  assert.equal(
    await page.locator(".yut-isometric-destination.is-previewed").count(),
    1,
  );
  await page
    .locator('.yut-board-piece[aria-label^="검증 학생"][data-piece-ids="2"]')
    .click();
  assert.equal(
    await page.locator(".yut-isometric-destination.is-previewed").count(),
    0,
    "Changing the selected piece clears the previous destination",
  );
  assert.equal(
    await page.getByRole("button", { name: "결정", exact: true }).isEnabled(),
    false,
  );
  assert.equal(
    await page.evaluate(
      () => window.qa.calls.filter((call) => call.action === "move").length,
    ),
    0,
  );
  await page.locator(".yut-isometric-destination").first().click();
  const movingPawn = page.locator(
    '.yut-board-piece[aria-label^="검증 학생"][data-piece-ids="2"]',
  );
  const beforeMotion = await movingPawn.boundingBox();
  await page.getByRole("button", { name: "결정", exact: true }).click();
  await page.locator('.is-moving[data-piece-ids="2"]').waitFor();
  const originMotion = await movingPawn.evaluate((node) => {
    const animation = node.getAnimations()[0],
      time = animation.currentTime;
    animation.pause();
    animation.currentTime = 0;
    const result = {
      box: node.getBoundingClientRect().toJSON(),
      frame: animation.effect.getKeyframes()[0],
    };
    animation.currentTime = time;
    animation.play();
    return result;
  });
  assert.ok(
    Math.abs(originMotion.box.x - beforeMotion.x) < 1 &&
      Math.abs(originMotion.box.y - beforeMotion.y) < 1,
    "A home piece starts its first hop from its actual mobile waiting position",
  );
  await page.waitForFunction(
    () => window.qa.room.players[0].pieces[1].node === "o2",
  );
  const result = await page.evaluate(() => ({
    pieces: window.qa.room.players[0].pieces,
    calls: window.qa.calls.filter((call) => call.action === "move"),
  }));
  assert.equal(result.pieces[0].node, "home");
  assert.deepEqual(
    result.calls.map((call) => call.pieceId),
    ["2"],
  );
  report.paths["selected-piece-switch"] = {
    ...result,
    beforeMotion,
    originMotion,
  };
  report.checks.push(
    "Changing from piece 1 to piece 2 clears the old destination, disables commit, and sends only a newly selected piece 2 move",
  );
  await page.close();
}
async function verifyTwoGroupAndFinish() {
  for (const scenario of ["two-group", "two-capture-many"]) {
    const page = await open("board=1&scenario=" + scenario);
    await page.evaluate(
      (route) => window.qa.move(route),
      scenario === "two-group" ? "outer" : "a",
    );
    await page.locator(".is-moving:not(.is-caught)").waitFor();
    assert.equal(
      await page.locator(".is-moving:not(.is-caught)").count(),
      1,
      "A carried group renders one moving pawn",
    );
    assert.equal(
      await page
        .locator(".is-moving:not(.is-caught)")
        .getAttribute("data-piece-ids"),
      "1,2",
    );
    const spriteFrames = await inspectSpriteFrames(
      page.locator(".is-moving:not(.is-caught) .yut-sprite"),
    );
    await page.waitForFunction(
      (count) => window.qa.steps.length === count,
      scenario === "two-group" ? 2 : 5,
    );
    const steps = await page.evaluate(() => window.qa.steps);
    assert.deepEqual(
      steps.map((step) => step.index),
      scenario === "two-group" ? [0, 1] : [0, 1, 2, 3, 4],
      "One landing effect per group per tile",
    );
    assert.ok(
      steps.every((step) => step.movingGroups === 1 && step.pieceIds === "1,2"),
    );
    if (scenario === "two-capture-many") {
      await page.locator(".yut-capture-reaction").waitFor();
      const event = await page.evaluate(() => window.qa.room.lastEvent.move);
      assert.equal(event.capturedPieces.length, 4);
      assert.deepEqual(event.capturedUids.sort(), ["other", "third"]);
      assert.equal(
        await page.locator(".yut-capture-portrait").count(),
        2,
        "Two caught players each get their own expression",
      );
      assert.deepEqual(
        await page
          .locator(".yut-capture-portrait")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.dataset.caughtCount),
          ),
        ["2", "2"],
      );
      assert.equal(
        await page
          .locator(".yut-capture-portrait .yut-sprite--pair-caught")
          .count(),
        2,
        "A captured two-piece group uses the two-character reaction drawing",
      );
      const caughtFrames = await inspectSpriteFrames(
        page.locator(".yut-capture-portrait .yut-sprite"),
      );
      assert.match(
        await page.locator(".yut-capture-reaction").innerText(),
        /상대 학생/,
      );
      assert.match(
        await page.locator(".yut-capture-reaction").innerText(),
        /셋째 학생/,
      );
      assert.ok(
        await page.evaluate(() =>
          window.qa.room.players
            .slice(1, 3)
            .every((player) =>
              player.pieces.every(
                (piece) => piece.node === "home" && !piece.stackId,
              ),
            ),
        ),
      );
      await page.screenshot({
        path: path.join(evidence, "capture-two-players.png"),
      });
      report.paths["captured-two-players"] = { event, caughtFrames };
    }
    report.paths[scenario] = { steps, spriteFrames };
    await page.close();
  }
  report.checks.push(
    "Two carried pieces use one hop and landing cue per tile; capturing two opponents returns all four pieces and shows both caught players",
  );
  const board = await open("board=1&scenario=two-finish-first");
  await board.evaluate(() => window.qa.move("outer"));
  await board.waitForFunction(() => window.qa.steps.length === 3);
  const finish = await board.evaluate(() => ({
    steps: window.qa.steps,
    status: window.qa.room.status,
    pieces: window.qa.room.players[0].pieces,
    path: window.qa.room.lastEvent.move.path,
  }));
  assert.deepEqual(
    finish.path,
    ["o19", "o20", "finish"],
    "Overshooting finishes without extra off-board tiles",
  );
  assert.ok(
    Math.abs(finish.steps.at(-1).x - 360) < 2 &&
      Math.abs(finish.steps.at(-1).y - 455) < 2,
    "Finish animation lands on the starting tile",
  );
  assert.equal(finish.status, "playing");
  assert.deepEqual(
    finish.pieces.map((piece) => piece.node),
    ["finish", "home"],
  );
  report.paths["first-piece-finish"] = finish;
  await board.close();
  const game = await open(
    "scenario=two-finish-first",
    "no-preference",
    844,
    390,
  );
  await game.locator(".yut-isometric-destination").first().waitFor();
  await game.locator(".yut-isometric-destination").first().click();
  await game.getByRole("button", { name: "결정", exact: true }).click();
  await game.waitForFunction(
    () => window.qa.room.players[0].pieces[0].node === "finish",
  );
  await game.locator(".is-moving").waitFor({ state: "detached" });
  assert.equal(
    await game.locator(".yut-victory").count(),
    0,
    "First piece completion never ends the game",
  );
  await game.evaluate(() => window.qa.preparePiece("2", "o18", 5));
  await game
    .getByRole("progressbar", { name: "말 이동 남은 시간", exact: true })
    .waitFor();
  await game
    .locator('.yut-board-piece[aria-label^="검증 학생"][data-piece-ids="2"]')
    .click();
  await game.locator(".yut-isometric-destination").first().click();
  await game.getByRole("button", { name: "결정", exact: true }).click();
  await game.locator(".is-moving").waitFor();
  assert.equal(
    await game.locator(".yut-victory").count(),
    0,
    "Second-piece victory waits for its final landing",
  );
  await game.locator(".yut-victory").waitFor();
  assert.equal(await game.evaluate(() => window.qa.room.status), "finished");
  assert.deepEqual(
    await game.evaluate(() =>
      window.qa.calls
        .filter((call) => call.action === "move")
        .map((call) => call.pieceId),
    ),
    ["1", "2"],
  );
  assert.equal(
    await game
      .locator(
        ".yut-victory .yut-victory-cast-others,.yut-victory .yut-defeated-sprite",
      )
      .count(),
    0,
    "The central result contains only the winner",
  );
  const winnerFrames = await inspectSpriteFrames(
    game.locator(".yut-victory .yut-sprite"),
  );
  const loserFrames = await inspectSpriteFrames(
    game.locator(".yut-board-piece .yut-sprite--lose"),
  );
  const loserLocations = await game
    .locator(".yut-board-piece:has(.yut-sprite--lose)")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        pieceIds: node.dataset.pieceIds,
        node: node.dataset.pawnNode,
      })),
    );
  assert.deepEqual(
    loserLocations,
    [
      { pieceIds: "1", node: "o5" },
      { pieceIds: "2", node: "o5" },
    ],
    "Losing pieces stay at their actual last tile with individual numbers",
  );
  report.paths["two-piece-victory"] = {
    winnerFrames,
    loserFrames,
    loserLocations,
  };
  await game.screenshot({
    path: path.join(evidence, "two-piece-victory-landscape.png"),
  });
  report.checks.push(
    "Overshooting first-piece completion lands exactly on start and remains playable; only the second completion shows the central winner, with defeated frames left on their own board tiles",
  );
  await game.close();
}
try {
  if (artOnly) {
    await verifyArtSheets();
  } else if (twoPiecesOnly) {
    await verifyTwoPieces();
  } else if (gaugeOnly) {
    for (const [scenario, label, maximum] of [
      ["path", "말 이동 남은 시간", "25"],
      ["waiting", "윷 던지기 남은 시간", "5"],
    ]) {
      const page = await open(
        "scenario=" + scenario,
        "no-preference",
        844,
        390,
      );
      if (scenario === "waiting")
        await page
          .getByRole("button", { name: "윷판 펼치기", exact: true })
          .click();
      const gauge = page.getByRole("progressbar", { name: label, exact: true });
      await gauge.waitFor();
      assert.equal(await gauge.getAttribute("aria-valuemax"), maximum);
      const bounds = await gauge.boundingBox(),
        board = await page.locator(".yut-board").boundingBox();
      assert.ok(
        Math.abs(bounds.x + bounds.width / 2 - (board.x + board.width / 2)) < 1,
        "Gauge is centered on the board",
      );
      assert.ok(
        bounds.x >= board.x &&
          bounds.x + bounds.width <= board.x + board.width &&
          bounds.y >= board.y &&
          bounds.y + bounds.height <= board.y + board.height,
      );
      await page.screenshot({
        path: path.join(evidence, `gauge-${scenario}-844-390.png`),
      });
      report.paths[scenario] = { bounds, board, maximum };
      report.checks.push(
        `${label}: centered ${maximum}-second gauge fits the mobile landscape board`,
      );
      await page.close();
    }
  } else {
    if (!presentationOnly) {
      if (!captureOnly) {
        for (const reduced of ["no-preference", "reduce"]) {
          const page = await open("board=1&scenario=path", reduced);
          assert.equal(await page.locator(".yut-board-finish-mark").count(), 0);
          await page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all(
              ["characters.webp", "materials.webp"].map((file) => {
                const image = new Image();
                image.src = "/assets/weplay/yut/" + file;
                return image.decode();
              }),
            );
          });
          await page.waitForTimeout(300);
          await page.evaluate(() => {
            const start = performance.now();
            window.qa.frames = [];
            function sample() {
              const node = document.querySelector('[data-motion="land"]');
              if (node) {
                const style = getComputedStyle(node),
                  board = node.closest(".yut-board").getBoundingClientRect(),
                  matrix = new DOMMatrixReadOnly(style.transform);
                window.qa.frames.push({
                  t: performance.now() - start,
                  x: (parseFloat(style.left) / board.width) * 720,
                  y: (parseFloat(style.top) / board.height) * 560,
                  lift: matrix.m42 + node.offsetHeight * 0.88,
                  start: node.getAnimations()[0]?.startTime,
                });
              }
              if (performance.now() - start < 2000)
                requestAnimationFrame(sample);
            }
            requestAnimationFrame(sample);
            window.qa.move("a");
            setTimeout(() => window.qa.bump(), 300);
          });
          await page.waitForTimeout(430);
          await page.screenshot({
            path: path.join(evidence, "hop-" + reduced + ".png"),
          });
          await page.waitForTimeout(1750);
          const frames = await page.evaluate(() => window.qa.frames),
            motion = await page.evaluate(() => window.qa.motion);
          report.paths[reduced] = frames;
          const expected = [
            [553.33, 255],
            [456.67, 255],
            [360, 255],
            [263.33, 255],
            [166.67, 255],
          ];
          let last = -1;
          for (const [x, y] of expected) {
            const index = frames.findIndex(
              (f, i) =>
                i > last && Math.abs(f.x - x) < 2 && Math.abs(f.y - y) < 2,
            );
            assert.ok(
              index > last,
              `${reduced}: reached ${x},${y} in sequence`,
            );
            last = index;
          }
          assert.ok(
            frames.length > 20,
            `${reduced}: actual intermediate frames`,
          );
          assert.ok(
            Math.min(...frames.map((f) => f.lift)) <
              (reduced === "reduce" ? -9 : -24),
            `${reduced}: increased hop height exceeds the former 7/16px arc`,
          );
          const starts = new Set(
            frames.map((frame) => frame.start).filter((value) => value != null),
          );
          assert.equal(
            starts.size,
            5,
            "one animation per tile, without restarts during unrelated revisions",
          );
          assert.deepEqual(
            motion.map((item) => item.value),
            [true, false],
          );
          const steps = await page.evaluate(() => window.qa.steps);
          assert.deepEqual(
            steps.map((step) => step.index),
            [0, 1, 2, 3, 4],
            "Each real landing calls its effect once despite changing callback identities",
          );
          steps.forEach((step, index) => {
            assert.ok(
              Math.abs(step.x - expected[index][0]) < 2 &&
                Math.abs(step.y - expected[index][1]) < 2,
              "Landing callback matches the reached tile",
            );
            assert.ok(
              Math.abs(step.lift) < 1,
              "Landing effect runs at ground contact, not midair",
            );
          });
          report.paths[reduced + "-landings"] = steps;
          report.paths[reduced] = frames;
          report.checks.push(
            `${reduced}: higher hops and five ground-contact callbacks in tile order survive 35ms re-renders plus a mid-move revision without duplicate effects`,
          );
          await page.close();
        }
        for (const reduced of ["no-preference", "reduce"]) {
          const corner = await open("board=1&scenario=corner", reduced);
          await corner.evaluate(() => window.qa.move("outer"));
          await corner.waitForFunction(() => window.qa.steps.length === 3);
          const cornerSteps = await corner.evaluate(() => window.qa.steps);
          assert.deepEqual(
            cornerSteps.map((step) => step.facing),
            ["left", "right", "right"],
            "Each tile uses its own dx, including a change halfway through a move",
          );
          assert.equal(cornerSteps[0].mirror, -cornerSteps[1].mirror);
          assert.ok(cornerSteps.every((step) => Math.abs(step.mirror) === 1));
          assert.equal(
            await corner
              .locator(
                ".yut-pawn-facing .yut-pawn-expression, .yut-pawn-facing .yut-pawn-foot-shadow",
              )
              .count(),
            0,
            "Only the character sprite is mirrored; shadow and labels stay outside",
          );
          report.paths[reduced + "-corner-facing"] = cornerSteps;
          await corner.close();

          const vertical = await open("board=1&scenario=vertical", reduced);
          await vertical.evaluate(() => window.qa.move("a"));
          await vertical.waitForFunction(
            () => window.qa.motion.at(-1)?.value === false,
          );
          assert.deepEqual(
            await vertical.evaluate(() =>
              window.qa.steps.map((step) => step.facing),
            ),
            ["left", "left", "left"],
          );
          await vertical.evaluate(() => window.qa.prepareThrow(3));
          await vertical.waitForTimeout(60);
          await vertical.evaluate(() => {
            window.qa.steps = [];
            window.qa.move("b");
          });
          await vertical.waitForFunction(() => window.qa.steps.length === 3);
          const verticalSteps = await vertical.evaluate(() => window.qa.steps);
          assert.deepEqual(
            verticalSteps.map((step) => step.facing),
            ["left", "left", "left"],
          );
          assert.ok(verticalSteps.every((step) => Math.abs(step.x - 360) < 2));
          report.paths[reduced + "-vertical-facing"] = verticalSteps;
          report.checks.push(
            `${reduced}: per-tile left/right facing flips at the outer corner; center vertical traversal preserves the preceding left-facing sprite`,
          );
          await vertical.close();
        }
        for (const [width, height, reduced] of [
          [390, 844, "no-preference"],
          [844, 390, "reduce"],
          [1280, 800, "no-preference"],
        ]) {
          const page = await open(
            "board=1&scenario=capture",
            reduced,
            width,
            height,
          );
          await observeCapture(page);
          await page.evaluate(() => {
            window.qa.move("a");
            setTimeout(() => window.qa.repeat(), 120);
            setTimeout(() => window.qa.bump(), 350);
          });
          await page.waitForTimeout(500);
          assert.equal(
            await page.locator(".yut-capture-reaction").count(),
            0,
            "Capture reaction waits until the actual final landing",
          );
          await page.locator(".yut-capture-reaction").waitFor();
          const shown = await page.evaluate(() => ({
            reactions: window.qa.reactions,
            steps: window.qa.steps,
            motion: window.qa.motion,
          }));
          const reaction = page.locator('.yut-capture-reaction[role="status"]');
          assert.match(await reaction.innerText(), /상대 학생/);
          assert.equal(
            await reaction.locator(".yut-character--nong").count(),
            1,
            "Capture portrait belongs to the caught opponent, not the mover",
          );
          assert.equal(shown.steps.length, 5);
          assert.ok(
            shown.reactions[0].at >= shown.steps.at(-1).at - 2,
            "Reaction begins after ground contact, never by a nominal travel timer",
          );
          assert.equal(
            shown.motion.at(-1).value,
            true,
            "Gameplay stays locked while the reaction is visible",
          );
          const bounds = await reaction.boundingBox();
          assert.ok(
            bounds.x >= 0 &&
              bounds.x + bounds.width <= width &&
              bounds.y >= 0 &&
              bounds.y + bounds.height <= height,
            `${width}: reaction stays in the viewport`,
          );
          await page.screenshot({
            path: path.join(evidence, `capture-${width}-${height}.png`),
          });
          await page.evaluate(() => {
            window.qa.repeat();
            window.qa.bump();
          });
          await page.waitForTimeout(350);
          assert.equal(
            await reaction.count(),
            1,
            "Unrelated snapshots preserve the active reaction",
          );
          assert.equal(
            await page.evaluate(() => window.qa.motion.at(-1).value),
            true,
          );
          await reaction.waitFor({ state: "detached" });
          const ended = await page.evaluate(() => ({
            reactions: window.qa.reactions,
            motion: window.qa.motion,
          }));
          assert.equal(
            ended.reactions.length,
            2,
            "One show and one hide despite repeated snapshots",
          );
          const duration = ended.reactions[1].at - ended.reactions[0].at;
          assert.ok(
            duration >= 1350 && duration < 1800,
            `Capture reaction lasts 1400ms (observed ${duration}ms)`,
          );
          assert.deepEqual(
            ended.motion.map((item) => item.value),
            [true, false],
          );
          await page.evaluate(() => {
            window.qa.repeat();
            window.qa.remount();
          });
          await page.waitForTimeout(180);
          assert.equal(
            await reaction.count(),
            0,
            "Remounting the current room does not replay a historical capture",
          );
          report.paths[`capture-${width}-${height}`] = {
            shown,
            ended,
            bounds,
            duration,
          };
          report.checks.push(
            `${width}x${height} ${reduced}: actual capture shows the victim after all five landings for 1400ms, holds the input gate, fits the viewport, and ignores repeat snapshots/remounts`,
          );
          await page.close();
        }
        const historical = await open("board=1&scenario=capture-initial");
        await historical.waitForTimeout(180);
        assert.equal(
          await historical.locator(".yut-capture-reaction").count(),
          0,
        );
        assert.equal(await historical.locator(".is-moving").count(), 0);
        await historical.close();
        for (const cleanup of [
          "hidden-during-move",
          "hidden-during-reaction",
          "unmount",
        ]) {
          const page = await open("board=1&scenario=capture");
          await observeCapture(page);
          await page.evaluate(() => window.qa.move("a"));
          if (cleanup === "hidden-during-move") await page.waitForTimeout(200);
          else await page.locator(".yut-capture-reaction").waitFor();
          if (cleanup === "unmount")
            await page.evaluate(() => window.qa.unmount());
          else await hidePage(page, true);
          await page.waitForTimeout(100);
          assert.equal(
            await page.locator(".yut-capture-reaction").count(),
            0,
            `${cleanup}: clears the reaction`,
          );
          assert.equal(
            await page.evaluate(() => window.qa.motion.at(-1)?.value),
            false,
            `${cleanup}: releases the movement gate`,
          );
          if (cleanup !== "unmount") {
            await hidePage(page, false);
            await page.evaluate(() => window.qa.repeat());
            await page.waitForTimeout(1700);
            assert.equal(
              await page.locator(".yut-capture-reaction").count(),
              0,
              "Returning to the page does not replay a hidden capture",
            );
          }
          report.paths[cleanup] = await page.evaluate(() => ({
            reactions: window.qa.reactions,
            motion: window.qa.motion,
          }));
          await page.close();
        }
        report.checks.push(
          "Initial capture snapshots are quiet; hiding during movement or reaction and unmounting clear the effect and gate without replay",
        );
      }
      const captureGame = await open(
        "scenario=capture",
        "no-preference",
        844,
        390,
      );
      await captureGame
        .getByRole("progressbar", { name: "말 이동 남은 시간", exact: true })
        .waitFor();
      await captureGame
        .locator('.yut-isometric-destination[aria-label^="지름길"]')
        .click();
      await captureGame
        .getByRole("button", { name: "결정", exact: true })
        .click();
      await captureGame.locator(".yut-capture-reaction").waitFor();
      assert.equal(
        await captureGame.locator(".yut-turn-gauge").count(),
        0,
        "Actual game keeps its countdown hidden throughout the capture reaction",
      );
      assert.equal(
        await captureGame
          .getByRole("button", { name: "윷 던지기", exact: true })
          .isEnabled(),
        false,
        "Capture reaction holds the actual game's next throw action",
      );
      await captureGame.screenshot({
        path: path.join(evidence, "capture-game-landscape.png"),
      });
      await captureGame
        .locator(".yut-capture-reaction")
        .waitFor({ state: "detached" });
      const reactionEndMs = await captureGame.evaluate(() => Date.now());
      await captureGame.waitForFunction(
        () => !document.querySelector('[aria-label="윷 던지기"]').disabled,
      );
      await captureGame
        .getByRole("progressbar", { name: "윷 던지기 남은 시간", exact: true })
        .waitFor();
      const timing = await captureGame.evaluate(() => ({
        interactiveAtMs: Date.now(),
        phaseStartsAtMs: window.qa.room.phaseStartsAtMs,
        turnDeadlineMs: window.qa.room.turnDeadlineMs,
        moveAtMs: window.qa.room.lastEvent.atMs,
        gaugeSeconds: Number(
          document
            .querySelector('.yut-turn-gauge [role="progressbar"]')
            .getAttribute("aria-valuenow"),
        ),
        gaugeMaximum: Number(
          document
            .querySelector('.yut-turn-gauge [role="progressbar"]')
            .getAttribute("aria-valuemax"),
        ),
      }));
      assert.equal(
        timing.phaseStartsAtMs - timing.moveAtMs,
        2700,
        "Capture reserves 2700ms for traversal and reaction",
      );
      assert.equal(
        timing.turnDeadlineMs - timing.phaseStartsAtMs,
        5000,
        "Server throw limit remains five seconds",
      );
      assert.ok(
        timing.interactiveAtMs >= timing.phaseStartsAtMs &&
          timing.interactiveAtMs >= reactionEndMs,
        "Input resumes only after both capture reaction and server phase grace",
      );
      assert.equal(timing.gaugeMaximum, 5);
      assert.equal(
        timing.gaugeSeconds,
        5,
        "First actionable throw gauge starts with all five seconds remaining",
      );
      report.paths["capture-next-turn-timing"] = { reactionEndMs, ...timing };
      await captureGame.screenshot({
        path: path.join(evidence, "capture-next-turn-five-seconds.png"),
      });
      report.checks.push(
        "Actual mobile landscape game holds input through capture and 2700ms grace, then starts the next five-second server turn with a visible 5-second gauge",
      );
      await captureGame.close();
    }
    if (!captureOnly) {
      for (const [width, height, reduced] of [
        [390, 844, "no-preference"],
        [844, 390, "no-preference"],
        [1280, 800, "no-preference"],
        [844, 390, "reduce"],
      ]) {
        const page = await open(
          "scenario=waiting-four",
          reduced,
          width,
          height,
        );
        if (width < height) {
          await page.locator(".yut-orientation-gate").waitFor();
          assert.equal(await page.locator(".yut-seat .yut-sprite").count(), 0);
          await page.screenshot({
            path: path.join(
              evidence,
              "waiting-portrait-" + width + "-" + height + ".png",
            ),
          });
          await page.setViewportSize({ width: 844, height: 390 });
          await page.locator(".yut-seat .yut-sprite").first().waitFor();
          assert.equal(await page.locator(".yut-seat .yut-sprite").count(), 4);
          await page.setViewportSize({ width, height });
          await page.locator(".yut-orientation-gate").waitFor();
          assert.equal(await page.locator(".yut-seat .yut-sprite").count(), 0);
          report.checks.push(
            "390 portrait orientation gate unmounts whole-character animations and restores them after landscape rotation",
          );
        } else {
          await page.locator(".yut-seat .yut-sprite").first().waitFor();
          const frames = await inspectSpriteFrames(
            page.locator(".yut-seat .yut-sprite"),
          );
          assert.equal(frames.length, 4);
          const size = await page.evaluate(() => ({
            viewport: innerWidth,
            width: document.documentElement.scrollWidth,
          }));
          assert.ok(size.width <= size.viewport + 1);
          await page.screenshot({
            path: path.join(
              evidence,
              "waiting-full-frames-" + width + "-" + reduced + ".png",
            ),
          });
          await hidePage(page, true);
          const paused = await page
            .locator(".yut-seat .yut-drawn-frame")
            .evaluateAll((nodes) =>
              nodes.map((node) => getComputedStyle(node).animationPlayState),
            );
          assert.ok(paused.every((value) => value === "paused"));
          report.paths["waiting-full-frames-" + width + "-" + reduced] = {
            frames,
            size,
            paused,
          };
          report.checks.push(
            width +
              "x" +
              height +
              " " +
              reduced +
              ": four square whole-character atlases switch between three discrete drawings without masks and pause when hidden",
          );
        }
        await page.close();
      }
      for (const reduced of ["no-preference", "reduce"]) {
        const page = await open(
          "scenario=finish-four",
          reduced,
          reduced === "reduce" ? 844 : 1280,
          reduced === "reduce" ? 390 : 800,
        );
        await page.locator(".yut-isometric-destination").first().waitFor();
        await page
          .getByRole("progressbar", { name: "말 이동 남은 시간", exact: true })
          .waitFor();
        assert.equal(
          await page.getByRole("progressbar").getAttribute("aria-valuemax"),
          "25",
        );
        await page.locator(".yut-isometric-destination").first().click();
        await page.getByRole("button", { name: "결정", exact: true }).click();
        await page.locator('[data-motion="win"]').waitFor();
        assert.equal(
          await page.locator(".yut-turn-gauge").count(),
          0,
          "Time gauge is hidden during movement",
        );
        assert.equal(
          await page.evaluate(() => window.qa.room.status),
          "finished",
          "server game ends immediately",
        );
        assert.equal(
          await page
            .getByRole("button", { name: "윷 던지기", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await page.getByRole("button", { name: "결정", exact: true }).count(),
          0,
        );
        assert.equal(
          await page.locator(".yut-victory").count(),
          0,
          "celebration waits for final traversal",
        );
        await page.screenshot({
          path: path.join(evidence, "winning-hop-" + reduced + ".png"),
        });
        await page.locator(".yut-victory").waitFor();
        const stepsPlayed = await page.evaluate(() =>
          window.motionAudio.filter(
            (event) => Math.abs(event.duration - 0.14) < 0.001,
          ),
        );
        assert.equal(
          stepsPlayed.length,
          3,
          "Actual game plays one step sound per o19/o20/finish landing",
        );
        assert.deepEqual(
          stepsPlayed.map((event) => Math.round(event.rate * 100) / 100),
          [1, 1.06, 1.12],
        );
        report.paths[reduced + "-completion-audio"] = stepsPlayed;
        await page.locator(".yut-victory-cast").waitFor();
        assert.equal(
          await page
            .locator(
              ".yut-victory .yut-victory-cast-others,.yut-victory .yut-defeated-sprite",
            )
            .count(),
          0,
          "Only the winner is shown in the central result",
        );
        assert.equal(
          await page
            .locator(".yut-victory-cast-winner .yut-character--sa")
            .count(),
          1,
        );
        const castAnimation = await inspectSpriteFrames(
          page.locator(".yut-victory .yut-sprite"),
        );
        const loserAnimation = await inspectSpriteFrames(
          page.locator(".yut-board-piece .yut-sprite--lose"),
        );
        assert.equal(
          loserAnimation.length,
          6,
          "Each defeated player's two pieces remain visible at their last tile",
        );
        const loserNodes = await page
          .locator(".yut-board-piece:has(.yut-sprite--lose)")
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              ids: node.dataset.pieceIds,
              left: node.style.left,
              top: node.style.top,
              node: node.dataset.pawnNode,
            })),
          );
        assert.equal(loserNodes.filter((node) => node.ids === "1").length, 3);
        assert.equal(loserNodes.filter((node) => node.ids === "2").length, 3);
        assert.deepEqual(loserNodes.map((node) => node.node).sort(), [
          "o10",
          "o10",
          "o15",
          "o15",
          "o5",
          "o5",
        ]);
        report.paths[reduced + "-loser-animation"] = {
          frames: loserAnimation,
          nodes: loserNodes,
        };
        const applause = await page.evaluate(() =>
          window.motionAudio.filter(
            (event) => Math.abs(event.duration - 1.65) < 0.001,
          ),
        );
        assert.equal(
          applause.length,
          1,
          "Completion plays one quiet applause cue",
        );
        assert.ok(
          applause[0].at >= stepsPlayed.at(-1).at,
          "Applause waits for final arrival",
        );
        report.paths[reduced + "-completion-applause"] = applause;
        report.paths[reduced + "-winner-animation"] = castAnimation;
        await page.getByText("7 위스 지급 대기", { exact: true }).waitFor();
        const victoryBox = await page.locator(".yut-victory").boundingBox(),
          frameBox = await page.locator(".weplay-game-frame").boundingBox();
        assert.ok(
          victoryBox.x >= frameBox.x &&
            victoryBox.x + victoryBox.width <= frameBox.x + frameBox.width,
          "winner panel fits stage width",
        );
        assert.ok(
          victoryBox.y >= frameBox.y &&
            victoryBox.y + victoryBox.height <= frameBox.y + frameBox.height,
          "winner receipt fits stage height",
        );
        const castBox = await page.locator(".yut-victory-cast").boundingBox(),
          receiptBox = await page.locator(".yut-reward-receipt").boundingBox();
        const overlap =
          Math.max(
            0,
            Math.min(
              castBox.x + castBox.width,
              receiptBox.x + receiptBox.width,
            ) - Math.max(castBox.x, receiptBox.x),
          ) *
          Math.max(
            0,
            Math.min(
              castBox.y + castBox.height,
              receiptBox.y + receiptBox.height,
            ) - Math.max(castBox.y, receiptBox.y),
          );
        assert.equal(
          overlap,
          0,
          "Winner illustration does not overlap reward status or retry button",
        );
        await page.screenshot({
          path: path.join(evidence, "victory-pending-" + reduced + ".png"),
        });
        await page.evaluate(() => (window.qa.claimPaid = true));
        await page
          .getByRole("button", { name: "보상 지급 다시 시도", exact: true })
          .click();
        await page.getByText("우승 보상 지급 완료", { exact: true }).waitFor();
        await page.evaluate(() => {
          window.qa.repeat();
          window.qa.bump();
        });
        await hidePage(page, true);
        await hidePage(page, false);
        await page.waitForTimeout(100);
        assert.equal(
          await page.evaluate(
            () =>
              window.motionAudio.filter(
                (event) => Math.abs(event.duration - 1.65) < 0.001,
              ).length,
          ),
          1,
          "Reward refresh, snapshots and hide/resume never replay applause",
        );
        assert.equal(
          await page
            .getByRole("button", { name: "보상 지급 다시 시도", exact: true })
            .count(),
          0,
        );
        await page.screenshot({
          path: path.join(evidence, "victory-paid-" + reduced + ".png"),
        });
        report.checks.push(
          `${reduced}: completion hides the gauge, plays three landing cues and one applause, renders three-frame winner artwork centrally and defeated pieces on their board tiles without receipt overlap, and reward/snapshot/visibility refresh does not replay applause`,
        );
        await page.close();
      }
      const shortMove = await open("scenario=path&move-seconds=15");
      const shortGauge = shortMove.getByRole("progressbar", {
        name: "말 이동 남은 시간",
        exact: true,
      });
      await shortGauge.waitFor();
      assert.equal(await shortGauge.getAttribute("aria-valuemax"), "15");
      const beforeGauge = await shortGauge
        .locator("i")
        .evaluate(
          (node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m11,
        );
      await shortMove.waitForTimeout(900);
      const afterGauge = await shortGauge
        .locator("i")
        .evaluate(
          (node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m11,
        );
      assert.ok(
        afterGauge < beforeGauge && afterGauge >= 0,
        "Central move gauge visibly counts down the configured 15 seconds",
      );
      await shortMove.evaluate(() =>
        window.qa.emit({
          ...window.qa.room,
          revision: window.qa.room.revision + 1,
          phaseStartsAtMs: Date.now() + 1000,
          turnDeadlineMs: Date.now() + 16000,
        }),
      );
      await shortGauge.waitFor({ state: "detached" });
      await shortGauge.waitFor();
      report.paths["move-gauge-15"] = { beforeGauge, afterGauge };
      report.checks.push(
        "Central move gauge respects 15/25-second room settings, visibly shrinks, and waits for phase animation grace",
      );
      await shortMove.close();
      const loading = await open("scenario=waiting&slow-lobby=1");
      await loading.locator(".weplay-game-loading").waitFor();
      assert.equal(
        await loading
          .locator(".yut-game-content")
          .evaluate((node) => node.inert),
        true,
      );
      await loading
        .getByRole("button", { name: "윷판 펼치기", exact: true })
        .waitFor();
      await loading.evaluate(() => {
        window.qa.delay = 650;
        window.qa.fail = true;
      });
      await loading
        .getByRole("button", { name: "윷판 펼치기", exact: true })
        .click();
      await loading.locator(".weplay-game-loading").waitFor();
      assert.equal(
        await loading
          .locator(".yut-game-content")
          .evaluate((node) => node.inert),
        true,
      );
      await loading.keyboard.press("Tab");
      assert.equal(
        await loading.evaluate(
          () => !!document.activeElement.closest("[inert]"),
        ),
        false,
      );
      await loading.getByText("검증용 연결 오류", { exact: true }).waitFor();
      assert.equal(
        await loading
          .locator(".yut-game-content")
          .evaluate((node) => node.inert),
        false,
      );
      assert.equal(await loading.locator(".weplay-game-loading").count(), 0);
      await loading
        .getByRole("button", { name: "방 상태 다시 확인", exact: true })
        .click();
      await loading
        .getByRole("button", { name: "윷판 펼치기", exact: true })
        .waitFor();
      await loading.evaluate(() => (window.qa.delay = 0));
      await loading
        .getByRole("button", { name: "윷판 펼치기", exact: true })
        .click();
      const toss = loading.getByRole("button", {
        name: "윷 던지기",
        exact: true,
      });
      await toss.waitFor();
      assert.equal(
        await loading.locator(".yut-turn-gauge").count(),
        0,
        "Starting grace hides the turn gauge",
      );
      await loading.waitForFunction(
        () => !document.querySelector('[aria-label="윷 던지기"]').disabled,
      );
      await loading
        .getByRole("progressbar", { name: "윷 던지기 남은 시간", exact: true })
        .waitFor();
      assert.equal(
        await loading.getByRole("progressbar").getAttribute("aria-valuemax"),
        "5",
      );
      await loading.evaluate(() => (window.qa.delay = 3200));
      await toss.press("Enter");
      await loading
        .getByRole("button", { name: "힘을 멈추고 던지기", exact: true })
        .press("Enter");
      await loading.waitForTimeout(700);
      assert.equal(
        await loading.locator(".yut-turn-gauge").count(),
        0,
        "Throw settlement hides the turn gauge",
      );
      assert.equal(
        await loading.locator(".weplay-game-loading").count(),
        0,
        "normal toss interval has no loading overlay",
      );
      await loading
        .getByText("윷 결과를 기다리고 있습니다.", { exact: true })
        .waitFor();
      assert.equal(
        await loading
          .locator(".yut-game-content")
          .evaluate((node) => node.inert),
        true,
      );
      await loading.locator(".yut-isometric-destination").first().waitFor();
      await loading
        .getByRole("progressbar", { name: "말 이동 남은 시간", exact: true })
        .waitFor();
      assert.equal(
        await loading.getByRole("progressbar").getAttribute("aria-valuemax"),
        "25",
      );
      assert.equal(
        await loading
          .locator(".yut-game-content")
          .evaluate((node) => node.inert),
        false,
      );
      const throwAudio = await loading.evaluate(() => window.motionAudio);
      assert.equal(
        throwAudio.filter((event) => Math.abs(event.duration - 0.28) < 0.001)
          .length,
        1,
        "Actual YutGame connects one release cue to its throw",
      );
      assert.equal(
        throwAudio.filter((event) => Math.abs(event.duration - 0.17) < 0.001)
          .length,
        4,
        "Actual YutGame connects four first-contact cues without duplicate callbacks",
      );
      report.paths["game-throw-audio"] = throwAudio;
      report.checks.push(
        "Actual YutGame plays one release and four contacts; themed loading locks input, failure unlocks, and delayed throw shows loading only after 2.5 seconds",
      );
      await loading.evaluate(() => (window.qa.delay = 16000));
      await loading.locator(".yut-isometric-destination").first().click();
      await loading.getByRole("button", { name: "결정", exact: true }).click();
      assert.equal(
        await loading.locator(".yut-turn-gauge").count(),
        0,
        "Network move wait hides the turn gauge",
      );
      await loading
        .getByText("연결이 지연되었습니다. 방 상태를 다시 확인해 주세요.", {
          exact: true,
        })
        .waitFor({ timeout: 17000 });
      assert.equal(
        await loading
          .locator(".yut-game-content")
          .evaluate((node) => node.inert),
        false,
        "timeout releases inert for recovery",
      );
      assert.equal(await loading.locator(".weplay-game-loading").count(), 0);
      report.checks.push(
        "15-second request timeout removes the loading overlay and unlocks the recovery control",
      );
      await loading.close();
    }
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  for (const [index, page] of browser
    .contexts()
    .flatMap((context) => context.pages())
    .entries()) {
    await page
      .screenshot({ path: path.join(evidence, `failure-${index}.png`) })
      .catch(() => {});
  }
  throw error;
} finally {
  await fs.writeFile(
    path.join(
      evidence,
      artOnly
        ? "report-art.json"
        : twoPiecesOnly
          ? process.env.YUT_TWO_QA_PHASE
            ? "report-two-pieces-" + process.env.YUT_TWO_QA_PHASE + ".json"
            : "report-two-pieces.json"
          : captureOnly
            ? "report-capture-timing.json"
            : gaugeOnly
              ? "report-gauge.json"
              : presentationOnly
                ? "report-presentation.json"
                : "report.json",
    ),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  server.close();
}
console.log(report.checks.join("\n"));
