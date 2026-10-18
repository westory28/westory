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
function seed(kind){let room=core.createYutRoom({id:'qa-'+kind,code:'AB1234',classId:'',classLabel:'검증 윷판',host:{uid:'qa',name:'검증 학생'},nowMs:Date.now(),maxPlayers:2});room=core.addYutPlayer(room,{uid:'other',name:'상대 학생'},Date.now());room=core.readyYutPlayer(room,'other',true,Date.now());if(kind==='waiting')return room;room=core.startYutGame(room,Date.now()-10000);room.players[0].pieces[0].node=kind==='finish'?'o18':'o5';room=core.throwYut(room,'qa',kind==='finish'?[true,true,true,false]:[false,false,false,false],Date.now()-4000);room.turnDeadlineMs=Date.now()+25000;return room;}
const qa=window.qa={room:seed(params.get('scenario')||'finish'),delay:0,fail:false,claimPaid:false,calls:[],motion:[],frames:[],steps:[]};
qa.emit=room=>{qa.room=room;listeners.forEach(listener=>listener(room));};
qa.move=(route='a')=>{const room=core.moveYut(qa.room,'qa','1',route,Date.now());if(room.status==='finished')room.reward={status:'pending',uid:'qa',amount:7,policyVersion:1,reason:'account-unavailable'};qa.emit(room)};
qa.bump=()=>qa.emit({...qa.room,revision:qa.room.revision+1,syncRevision:qa.room.syncRevision+1,lastEvent:{kind:'leave',atMs:Date.now(),text:'연결 상태 갱신'}});
export const getYutLobby=async()=>{if(params.has('slow-lobby'))await new Promise(r=>setTimeout(r,700));return{enabled:true,settings:DEFAULT_YUT_SETTINGS,privatePlaysRemaining:5,room:qa.room,classes:[],classId:'',serverNowMs:Date.now()}};
export const subscribeYutRoom=(_config,_id,onRoom)=>{listeners.add(onRoom);return()=>listeners.delete(onRoom)};
export const commandYutRoom=async(_config,data)=>{qa.calls.push(data);if(qa.delay)await new Promise(r=>setTimeout(r,qa.delay));if(qa.fail){qa.fail=false;throw new Error('검증용 연결 오류')}if(data.action==='move')qa.move(data.route);else if(data.action==='claimReward'){qa.emit({...qa.room,syncRevision:(qa.room.syncRevision||0)+1,reward:{...qa.room.reward,status:qa.claimPaid?'paid':'pending'}})}else if(data.action==='start')qa.emit(core.startYutGame(qa.room,Date.now()));else if(data.action==='throw')qa.emit(core.throwYut(qa.room,'qa',[true,false,false,false],Date.now(),data.power));else if(data.action==='leave')qa.emit(null);return{room:qa.room,serverNowMs:Date.now()}};
export const yutErrorMessage=error=>error.message;
export const getLegalYutMoves=core.getLegalYutMoves;
`;
const harness = `import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import Game from ${source("src/components/common/weplay/yut/YutGame.tsx")};import Board from ${source("src/components/common/weplay/yut/YutBoard.tsx")};import Frame from ${source("src/components/common/weplay/WeplayGameFrame.tsx")};import{getYutLobby,subscribeYutRoom,getLegalYutMoves}from ${source("src/lib/yut.ts")};
function App(){const[room,setRoom]=useState(window.qa.room);useEffect(()=>{const off=subscribeYutRoom(null,null,setRoom);const timer=setInterval(()=>setRoom(old=>({...old})),35);return()=>{off();clearInterval(timer)}},[]);const board=new URLSearchParams(location.search).has('board');return board?<div className="board-fixture yut-game"><Board room={room} uid="qa" selectedPiece="1" onSelectPiece={()=>{}} moves={getLegalYutMoves(room,'qa')} onMove={()=>{}} disabled={room.status==='finished'} onMotionChange={value=>window.qa.motion.push({value,at:performance.now()})} onStep={index=>{const node=document.querySelector('[data-motion="land"]'),style=getComputedStyle(node),bounds=node.closest('.yut-board').getBoundingClientRect();window.qa.steps.push({index,at:performance.now(),x:parseFloat(style.left)/bounds.width*720,y:parseFloat(style.top)/bounds.height*560,lift:new DOMMatrixReadOnly(style.transform).m42+node.offsetHeight*.88});}}/></div>:<Frame theme="yut"><Game portal="student" onBack={()=>{}} music={{enabled:false,failed:false,start:()=>{},toggle:()=>{}}} onMusicActiveChange={()=>{}}/></Frame>};createRoot(document.getElementById('root')).render(<App/>);`;
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
const report = { checks: [], errors: [], paths: {} };
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
try {
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
        if (performance.now() - start < 2000) requestAnimationFrame(sample);
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
        (f, i) => i > last && Math.abs(f.x - x) < 2 && Math.abs(f.y - y) < 2,
      );
      assert.ok(index > last, `${reduced}: reached ${x},${y} in sequence`);
      last = index;
    }
    assert.ok(frames.length > 20, `${reduced}: actual intermediate frames`);
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
    const page = await open(
      "scenario=finish",
      reduced,
      reduced === "reduce" ? 844 : 1280,
      reduced === "reduce" ? 390 : 800,
    );
    await page.locator(".yut-isometric-destination").first().waitFor();
    await page.locator(".yut-isometric-destination").first().click();
    await page.getByRole("button", { name: "결정", exact: true }).click();
    await page.locator('[data-motion="win"]').waitFor();
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
    await page.screenshot({
      path: path.join(evidence, "victory-pending-" + reduced + ".png"),
    });
    await page.evaluate(() => (window.qa.claimPaid = true));
    await page
      .getByRole("button", { name: "보상 지급 다시 시도", exact: true })
      .click();
    await page.getByText("우승 보상 지급 완료", { exact: true }).waitFor();
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
      `${reduced}: actual game plays three landing cues once before celebration; completion closes gameplay and pending reward retries to paid receipt`,
    );
    await page.close();
  }
  const loading = await open("scenario=waiting&slow-lobby=1");
  await loading.locator(".weplay-game-loading").waitFor();
  assert.equal(
    await loading.locator(".yut-game-content").evaluate((node) => node.inert),
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
    await loading.locator(".yut-game-content").evaluate((node) => node.inert),
    true,
  );
  await loading.keyboard.press("Tab");
  assert.equal(
    await loading.evaluate(() => !!document.activeElement.closest("[inert]")),
    false,
  );
  await loading.getByText("검증용 연결 오류", { exact: true }).waitFor();
  assert.equal(
    await loading.locator(".yut-game-content").evaluate((node) => node.inert),
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
  const toss = loading.getByRole("button", { name: "윷 던지기", exact: true });
  await toss.waitFor();
  await loading.waitForFunction(
    () => !document.querySelector('[aria-label="윷 던지기"]').disabled,
  );
  await loading.evaluate(() => (window.qa.delay = 3200));
  await toss.press("Enter");
  await loading
    .getByRole("button", { name: "힘을 멈추고 던지기", exact: true })
    .press("Enter");
  await loading.waitForTimeout(700);
  assert.equal(
    await loading.locator(".weplay-game-loading").count(),
    0,
    "normal toss interval has no loading overlay",
  );
  await loading
    .getByText("윷 결과를 기다리고 있습니다.", { exact: true })
    .waitFor();
  assert.equal(
    await loading.locator(".yut-game-content").evaluate((node) => node.inert),
    true,
  );
  await loading.locator(".yut-isometric-destination").first().waitFor();
  assert.equal(
    await loading.locator(".yut-game-content").evaluate((node) => node.inert),
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
  await loading
    .getByText("연결이 지연되었습니다. 방 상태를 다시 확인해 주세요.", {
      exact: true,
    })
    .waitFor({ timeout: 17000 });
  assert.equal(
    await loading.locator(".yut-game-content").evaluate((node) => node.inert),
    false,
    "timeout releases inert for recovery",
  );
  assert.equal(await loading.locator(".weplay-game-loading").count(), 0);
  report.checks.push(
    "15-second request timeout removes the loading overlay and unlocks the recovery control",
  );
  await loading.close();
  assert.deepEqual(report.errors, []);
} finally {
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  server.close();
}
console.log(report.checks.join("\n"));
