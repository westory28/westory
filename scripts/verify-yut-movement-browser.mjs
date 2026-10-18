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
function seed(kind){let room=core.createYutRoom({id:'qa-'+kind,code:'AB1234',classId:'',classLabel:'검증 윷판',host:{uid:'qa',name:'검증 학생'},nowMs:Date.now(),maxPlayers:kind.endsWith('four')?4:2,moveSeconds:Number(params.get('move-seconds')||25)});room=core.addYutPlayer(room,{uid:'other',name:'상대 학생'},Date.now());room=core.readyYutPlayer(room,'other',true,Date.now());if(kind.endsWith('four')){room=core.addYutPlayer(room,{uid:'third',name:'셋째 학생'},Date.now());room=core.readyYutPlayer(room,'third',true,Date.now());room=core.addYutPlayer(room,{uid:'fourth',name:'넷째 학생'},Date.now());room=core.readyYutPlayer(room,'fourth',true,Date.now());}if(kind.startsWith('waiting'))return room;room=core.startYutGame(room,Date.now()-10000);room.players[0].pieces[0].node=kind.startsWith('finish')?'o18':kind==='corner'?'o14':'o5';if(kind.startsWith('capture'))room.players[1].pieces[0].node='a5';room=core.throwYut(room,'qa',sticks(kind.startsWith('finish')||['corner','vertical'].includes(kind)?3:5),Date.now()-4000);room.turnDeadlineMs=Date.now()+room.moveSeconds*1000;if(kind==='capture-initial')room=core.moveYut(room,'qa','1','a',Date.now());return room;}
const qa=window.qa={room:seed(params.get('scenario')||'finish'),delay:0,fail:false,claimPaid:false,calls:[],motion:[],frames:[],steps:[]};
qa.emit=room=>{qa.room=room;listeners.forEach(listener=>listener(room));};
qa.move=(route='a')=>{const room=core.moveYut(qa.room,'qa','1',route,Date.now());if(room.status==='finished')room.reward={status:'pending',uid:'qa',amount:7,policyVersion:1,reason:'account-unavailable'};qa.emit(room)};
qa.bump=()=>qa.emit({...qa.room,revision:qa.room.revision+1,syncRevision:qa.room.syncRevision+1,lastEvent:{kind:'leave',atMs:Date.now(),text:'연결 상태 갱신'}});
qa.repeat=()=>qa.emit({...qa.room,syncRevision:qa.room.syncRevision+1});
qa.prepareThrow=value=>{const room={...qa.room,turnUid:'qa',phase:'throw',phaseStartsAtMs:Date.now()-5000,turnDeadlineMs:Date.now()+25000};qa.emit(core.throwYut(room,'qa',sticks(value),Date.now()-4000));};
export const getYutLobby=async()=>{if(params.has('slow-lobby'))await new Promise(r=>setTimeout(r,700));return{enabled:true,settings:DEFAULT_YUT_SETTINGS,privatePlaysRemaining:5,room:qa.room,classes:[],classId:'',serverNowMs:Date.now()}};
export const subscribeYutRoom=(_config,_id,onRoom)=>{listeners.add(onRoom);return()=>listeners.delete(onRoom)};
export const commandYutRoom=async(_config,data)=>{qa.calls.push(data);if(qa.delay)await new Promise(r=>setTimeout(r,qa.delay));if(qa.fail){qa.fail=false;throw new Error('검증용 연결 오류')}if(data.action==='move')qa.move(data.route);else if(data.action==='claimReward'){qa.emit({...qa.room,syncRevision:(qa.room.syncRevision||0)+1,reward:{...qa.room.reward,status:qa.claimPaid?'paid':'pending'}})}else if(data.action==='start')qa.emit(core.startYutGame(qa.room,Date.now()));else if(data.action==='throw')qa.emit(core.throwYut(qa.room,'qa',[true,false,false,false],Date.now(),data.power));else if(data.action==='leave')qa.emit(null);return{room:qa.room,serverNowMs:Date.now()}};
export const yutErrorMessage=error=>error.message;
export const getLegalYutMoves=core.getLegalYutMoves;
`;
const harness = `import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import Game from ${source("src/components/common/weplay/yut/YutGame.tsx")};import Board from ${source("src/components/common/weplay/yut/YutBoard.tsx")};import Frame from ${source("src/components/common/weplay/WeplayGameFrame.tsx")};import{getYutLobby,subscribeYutRoom,getLegalYutMoves}from ${source("src/lib/yut.ts")};
function App(){const[room,setRoom]=useState(window.qa.room),[key,setKey]=useState(0),[mounted,setMounted]=useState(true);window.qa.remount=()=>setKey(old=>old+1);window.qa.unmount=()=>setMounted(false);useEffect(()=>{const off=subscribeYutRoom(null,null,setRoom);const timer=setInterval(()=>setRoom(old=>({...old})),35);return()=>{off();clearInterval(timer)}},[]);const board=new URLSearchParams(location.search).has('board');return board?<div className="board-fixture yut-game">{mounted&&<Board key={key} room={room} uid="qa" selectedPiece="1" onSelectPiece={()=>{}} moves={getLegalYutMoves(room,'qa')} onMove={()=>{}} disabled={room.status==='finished'} onMotionChange={value=>window.qa.motion.push({value,at:performance.now()})} onStep={index=>{const node=document.querySelector('.is-moving:not(.is-caught)'),style=getComputedStyle(node),bounds=node.closest('.yut-board').getBoundingClientRect(),facing=node.querySelector('.yut-pawn-facing');window.qa.steps.push({index,at:performance.now(),x:parseFloat(style.left)/bounds.width*720,y:parseFloat(style.top)/bounds.height*560,lift:new DOMMatrixReadOnly(style.transform).m42+node.offsetHeight*.88,facing:facing?.dataset.facing,mirror:facing?new DOMMatrixReadOnly(getComputedStyle(facing).transform).m11:null});}}/>}</div>:<Frame theme="yut"><Game portal="student" onBack={()=>{}} music={{enabled:false,failed:false,start:()=>{},toggle:()=>{}}} onMusicActiveChange={()=>{}}/></Frame>};createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
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
const report = {
  passed: false,
  section: captureOnly
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
async function verifyFixedCharacterPixels(page) {
  const pictures = [];
  const roles = ["sa", "nong", "gong", "sang"];
  for (const at of [0, 1000, 2600]) {
    await page.evaluate((time) => {
      document.querySelectorAll(".yut-seat .yut-waiting-arm").forEach((arm) => {
        arm.style.animationDelay = "0ms";
        const animation = arm.getAnimations()[0];
        animation.pause();
        animation.currentTime = time;
      });
    }, at);
    const frame = {};
    for (const role of roles) {
      frame[role] = (
        await page.locator(`.yut-seat .yut-character--${role}`).screenshot({
          path: path.join(evidence, `waiting-${role}-${at}.png`),
        })
      ).toString("base64");
    }
    pictures.push(frame);
  }
  const differences = await page.evaluate(async (images) => {
    const chest = {
      sa: [300, 280, 70, 90],
      nong: [280, 285, 65, 85],
      gong: [330, 265, 65, 85],
      sang: [260, 265, 65, 85],
    };
    const pixels = async (base64) => {
      const image = new Image();
      image.src = "data:image/png;base64," + base64;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return {
        width: image.width,
        height: image.height,
        data: context.getImageData(0, 0, image.width, image.height).data,
      };
    };
    const result = {};
    for (const role of Object.keys(chest)) {
      const frames = await Promise.all(
        images.map((frame) => pixels(frame[role])),
      );
      const regions = {
        head: [0, 0, 627, 180],
        feet: [0, 550, 627, 77],
        chest: chest[role],
      };
      result[role] = {};
      for (const [name, [x, y, w, h]] of Object.entries(regions)) {
        let changed = 0;
        const first = frames[0];
        for (const frame of frames.slice(1)) {
          for (
            let py = Math.ceil((y / 627) * first.height);
            py < Math.floor(((y + h) / 627) * first.height);
            py++
          ) {
            for (
              let px = Math.ceil((x / 627) * first.width);
              px < Math.floor(((x + w) / 627) * first.width);
              px++
            ) {
              const index = (py * first.width + px) * 4;
              if (
                [0, 1, 2, 3].some(
                  (channel) =>
                    Math.abs(
                      first.data[index + channel] - frame.data[index + channel],
                    ) > 8,
                )
              )
                changed++;
            }
          }
        }
        result[role][name] = changed;
      }
    }
    return result;
  }, pictures);
  assert.ok(
    Object.values(differences).every((role) =>
      Object.values(role).every((count) => count === 0),
    ),
    "Screenshots prove head, chest crest and feet pixels stay fixed across both sleeve poses: " +
      JSON.stringify(differences),
  );
  return differences;
}
try {
  if (gaugeOnly) {
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
            await reaction.locator(".yut-reaction-role--nong").count(),
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
      for (const [width, height] of [
        [390, 844],
        [844, 390],
        [1280, 800],
      ]) {
        const page = await open(
          "scenario=waiting-four",
          "no-preference",
          width,
          height,
        );
        if (width < height) {
          await page.locator(".yut-orientation-gate").waitFor();
          assert.equal(
            await page.locator(".yut-seat .yut-waiting-arm").count(),
            0,
            "Portrait gate unmounts waiting animations",
          );
          await page.screenshot({
            path: path.join(
              evidence,
              `waiting-portrait-${width}-${height}.png`,
            ),
          });
          await page.setViewportSize({ width: 844, height: 390 });
          await page.locator(".yut-seat .yut-waiting-arm").first().waitFor();
          assert.equal(
            await page.locator(".yut-seat .yut-waiting-arm").count(),
            8,
          );
          await page.setViewportSize({ width, height });
          await page.locator(".yut-orientation-gate").waitFor();
          assert.equal(
            await page.locator(".yut-seat .yut-waiting-arm").count(),
            0,
          );
          report.checks.push(
            `${width}x${height}: portrait orientation gate removes waiting sleeve animations; landscape restores all four characters and returning portrait cleans them up`,
          );
          await page.close();
          continue;
        }
        await page.locator(".yut-seat .yut-waiting-arm").first().waitFor();
        assert.equal(
          await page.locator(".yut-seat .yut-waiting-arm").count(),
          8,
        );
        const frames = await page.evaluate(() => {
          const sprites = [
            ...document.querySelectorAll(".yut-seat .yut-sprite--idle"),
          ];
          const arms = sprites.flatMap((sprite) => [
            ...sprite.querySelectorAll(".yut-waiting-arm"),
          ]);
          const animations = arms.map((arm) => arm.getAnimations()[0]);
          animations.forEach((animation) => animation.pause());
          return [0, 300, 700, 850, 1200, 1590, 1650, 2300, 2450, 3000].map(
            (at) => {
              animations.forEach((animation) => {
                animation.currentTime = at;
              });
              return {
                at,
                roots: sprites.map((sprite) => ({
                  transform: getComputedStyle(sprite).transform,
                  animations: sprite.getAnimations().length,
                })),
                bodyTransforms: sprites.map(
                  (sprite) =>
                    getComputedStyle(
                      sprite.querySelector(".yut-waiting-figure > use"),
                    ).transform,
                ),
                arms: arms.map((arm) => getComputedStyle(arm).transform),
              };
            },
          );
        });
        assert.ok(
          frames.every((frame) =>
            frame.roots.every(
              (root) => root.transform === "none" && root.animations === 0,
            ),
          ),
          "Waiting heads, bodies and feet have no root animation or transform",
        );
        assert.ok(
          frames.every((frame) =>
            frame.bodyTransforms.every((value) => value === "none"),
          ),
          "The masked body stays still in every limited-animation frame",
        );
        for (let index = 0; index < 8; index++) {
          assert.equal(
            new Set(frames.map((frame) => frame.arms[index])).size,
            3,
            "Each arm uses only the three discrete neutral/forward/back poses",
          );
        }
        await page.screenshot({
          path: path.join(evidence, `waiting-arms-${width}-${height}.png`),
        });
        if (width === 1280)
          report.paths["waiting-fixed-pixels"] =
            await verifyFixedCharacterPixels(page);
        const size = await page.evaluate(() => ({
          viewport: innerWidth,
          width: document.documentElement.scrollWidth,
        }));
        assert.ok(
          size.width <= size.viewport + 1,
          "Waiting characters do not cause horizontal overflow",
        );
        await hidePage(page, true);
        const paused = await page
          .locator(".yut-seat .yut-waiting-arm")
          .evaluateAll((arms) =>
            arms.map((arm) => getComputedStyle(arm).animationPlayState),
          );
        assert.ok(
          paused.every((value) => value === "paused"),
          "Hidden games pause sleeve animation",
        );
        report.paths[`waiting-arms-${width}-${height}`] = {
          frames,
          size,
          paused,
        };
        report.checks.push(
          `${width}x${height}: all four waiting characters keep head/body/feet still while eight sleeves use three stepped poses; no horizontal overflow and hidden animation pauses`,
        );
        await page.close();
      }
      const reducedWaiting = await open(
        "scenario=waiting-four",
        "reduce",
        844,
        390,
      );
      await reducedWaiting
        .locator(".yut-seat .yut-waiting-arm")
        .first()
        .waitFor();
      const reducedSleeves = await reducedWaiting
        .locator(".yut-seat .yut-waiting-arm")
        .evaluateAll((arms) =>
          arms.map((arm) => {
            arm.style.animationDelay = "0ms";
            const animation = arm.getAnimations()[0];
            animation.pause();
            const poses = [0, 1400, 3800].map((at) => {
              animation.currentTime = at;
              return getComputedStyle(arm).transform;
            });
            return {
              duration: animation.effect.getTiming().duration,
              poses,
              body: getComputedStyle(arm.closest(".yut-sprite")).transform,
            };
          }),
        );
      assert.ok(
        reducedSleeves.every(
          (arm) =>
            arm.duration === 4800 &&
            new Set(arm.poses).size === 3 &&
            arm.body === "none",
        ),
        "Reduced motion keeps the body fixed and uses three infrequent sleeve poses",
      );
      report.paths["reduced-sleeves"] = reducedSleeves;
      await reducedWaiting.close();
      report.checks.push(
        "Reduced-motion waiting characters use three 4800ms stepped sleeve poses with a stationary body",
      );
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
          await page.locator(".yut-defeated-sprite").count(),
          3,
          "Every nonwinner gets a defeated character",
        );
        assert.equal(
          await page
            .locator(".yut-victory-cast-winner .yut-character--sa")
            .count(),
          1,
        );
        const castAnimation = await page
          .locator(".yut-victory-cast-winner-figure")
          .evaluate((node) => {
            const animation = node.getAnimations()[0];
            if (!animation) return null;
            return {
              duration: animation.effect.getTiming().duration,
              iterations: animation.effect.getTiming().iterations,
              frames: animation.effect.getKeyframes(),
              start: animation.startTime,
            };
          });
        assert.ok(
          castAnimation,
          `${reduced}: winner hop animation is not suppressed by shared reduced-motion CSS`,
        );
        assert.equal(castAnimation.duration, 2200);
        assert.equal(castAnimation.iterations, 1, "Winner hops are finite");
        const raisedFrames = castAnimation.frames.filter((frame) =>
          /translateY\(-/.test(frame.transform || ""),
        );
        assert.equal(
          raisedFrames.length,
          reduced === "reduce" ? 2 : 4,
          "Winner uses four hops, or two small reduced-motion hops",
        );
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
          "Winner and defeated characters do not overlap reward status or retry button",
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
          `${reduced}: completion hides the gauge, plays three landing cues and one applause, renders finite winner hops plus three defeated characters without receipt overlap, and reward/snapshot/visibility refresh does not replay applause`,
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
      captureOnly
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
