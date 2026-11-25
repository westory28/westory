/** Yut screens when another player, the room or the network acts at the same
 * moment: the real YutGame with a scripted service. No network or emulator.
 *   node scripts/verify-yut-races-browser.mjs [only=part-of-a-name]
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
const only = process.argv.find((entry) => entry.startsWith("only="))?.slice(5);
const source = (value) =>
  JSON.stringify(path.join(root, value).replaceAll("\\", "/"));
const service = `
import * as core from ${source("functions/yutCore.mjs")};
import { defaultAvatarLook } from ${source("src/features/avatar/catalog.ts")};
export * from ${source("functions/yutCore.mjs")};
const uid=new URLSearchParams(location.search).get('uid')||'a';
const config={year:'2026',semester:'2'};
const auth={config,currentUser:{uid,email:uid+'@yongshin-ms.ms.kr'},userData:{uid,role:'student',name:uid}};
export const useAuth=()=>auth;
const qa=window.qa={core,uid,commands:[],lobbyCalls:0,listeners:[],room:null,handler:null,cast:null,castCalls:0,defaultLook:defaultAvatarLook};
qa.fail=(code,message)=>Object.assign(new Error(message||code),{code:'functions/'+code});
qa.steady=room=>{const now=Date.now();return{...room,phaseStartsAtMs:Math.min(room.phaseStartsAtMs||0,now-1000),turnDeadlineMs:now+900000,expiresAtMs:now+3600000}};
qa.waiting=(members,extra={})=>{
  const now=Date.now();
  let room=core.createYutRoom({id:'room-a',code:'RM234A',classId:'',classLabel:'함께하는 윷판',host:{uid:members[0],name:members[0]},nowMs:now,maxPlayers:4});
  for(const member of members.slice(1))room=core.addYutPlayer(room,{uid:member,name:member},now);
  return{...room,...extra};
};
qa.playing=members=>{let room=qa.waiting(members);for(const member of members.slice(1))room=core.readyYutPlayer(room,member,true,Date.now());return qa.steady(core.startYutGame(room,Date.now()-30000))};
// A match in which 'member' has thrown 'value' and may move; pieces placed as given.
qa.toMove=(room,member,value,layout={})=>{
  const turn=structuredClone({...room,turnUid:member,phase:'throw',pendingThrow:null,extraThrows:0,phaseStartsAtMs:0,turnDeadlineMs:Date.now()+900000});
  for(const person of turn.players)(layout[person.uid]||[]).forEach((node,index)=>{person.pieces[index].node=node;person.pieces[index].lane='outer'});
  return qa.steady(core.throwYut(turn,member,[0,1,2,3].map(index=>index<value),Date.now()-8000));
};
qa.push=room=>{qa.room=room;for(const item of qa.listeners.filter(item=>item.active)){item.connection?.(true);item.next(room)}};
qa.refuse=()=>{for(const item of qa.listeners.filter(item=>item.active)){item.active=false;item.error(Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'}))}};
qa.motions=[];
const seen=new Set();
(function watch(){for(const node of document.querySelectorAll('.yut-isometric-piece[data-motion-id]')){const key=node.dataset.motionId+'|'+node.dataset.motion;if(seen.has(key))continue;seen.add(key);const box=node.getBoundingClientRect(),board=document.querySelector('.yut-board').getBoundingClientRect();qa.motions.push({id:node.dataset.motionId,kind:node.dataset.motion,node:node.dataset.pawnNode,x:(box.left+box.width/2-board.left)/board.width*720})}requestAnimationFrame(watch)})();
export const YUT_PRIVATE_DAILY_LIMIT=5;
export const DEFAULT_YUT_SETTINGS={enabled:true,version:1,allowSolo:true,allowMultiplayer:true,allowPrivateRooms:true,defaultPlayerCount:4,throwSeconds:15,moveSeconds:60};
export const normalizeYutSettings=value=>({...DEFAULT_YUT_SETTINGS,...(value||{})});
export const getYutLobby=async()=>{qa.lobbyCalls++;if(qa.holdLobby)await new Promise(resolve=>{qa.releaseLobby=resolve});return{enabled:true,playerName:uid,settings:DEFAULT_YUT_SETTINGS,privatePlaysRemaining:5,room:qa.room,classes:[],classId:'',serverNowMs:Date.now()}};
export const getYutPublication=async()=>({enabled:true,settings:DEFAULT_YUT_SETTINGS});
export const commandYutRoom=async(_config,data)=>{qa.commands.push(structuredClone(data));return await qa.handler(data)};
export function subscribeYutRoom(_config,id,next,error,connection){const item={id,next,error,connection,active:true};qa.listeners.push(item);queueMicrotask(()=>{if(item.active&&qa.room){connection?.(true);next(qa.room)}});return()=>{item.active=false}}
export const yutErrorMessage=error=>error?.message||'다시 시도해 주세요.';
export const getYutCast=async(_config,roomId)=>{qa.castCalls++;if(!qa.cast)throw qa.fail('unavailable');return await qa.cast(roomId)};
export const setYutPiece=async()=>({piece:'avatar'});
export const getHistoryDictionaryCallable=async name=>async data=>({data:{gameId:data.gameId,category:data.category,rows:[],updatedAtMs:Date.now(),scoreLabel:'승'}});
`;
const harness = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Game from ${source("src/components/common/weplay/yut/YutGame.tsx")};
import {MINIMI_VALUES} from ${source("src/features/avatar/minimi/draw.ts")};window.MINIMI_VALUES=MINIMI_VALUES;
import ${source("src/assets/index.css")};import ${source("assets/css/style.css")};
const music={enabled:false,failed:false,start(){},toggle(){}};
function App(){
  const[settings,setSettings]=useState();window.setSettings=setSettings;
  return <Game portal="student" music={music} onBack={()=>{}} onMusicActiveChange={()=>{}} initialSettings={settings}/>;
}
window.start=()=>createRoot(document.getElementById('root')).render(<App/>);
`;
const bundled = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  splitting: false,
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "westory-yut-races.js"),
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
      name: "scripted-service",
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
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
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
    return response.end(await fs.readFile(target).catch(() => ""));
  }
  response.setHeader("Content-Type", "text/html");
  response.end(
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>*,::before,::after{box-sizing:border-box}body{margin:0}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
  args: ["--disable-3d-apis"],
});
let passed = 0,
  failed = 0;
async function scene(name, setup, run) {
  if (only && !name.includes(only)) return;
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(8000);
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.start && window.qa);
    await page.evaluate(setup);
    await page.evaluate(() => window.start());
    await run(page);
    assert.deepEqual(errors, []);
    passed += 1;
    console.log("PASS", name);
  } catch (error) {
    failed += 1;
    console.log(
      "FAIL",
      name,
      "\n    ",
      String(error.message).split("\n").slice(0, 9).join("\n     "),
    );
  }
  await page.close();
}
const button = (page, name) => page.getByRole("button", { name, exact: true });
const alerts = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".yut-message.is-error")].map(
      (node) => node.innerText,
    ),
  );
const motions = (page) => page.evaluate(() => window.qa.motions);
async function chooseAndDecide(page, pieceName) {
  await button(page, "결정").waitFor();
  if (pieceName) {
    const piece = button(page, pieceName);
    if (await piece.isEnabled()) await piece.click();
  }
  await page.locator(".yut-isometric-destination").first().click();
  await button(page, "결정").click();
}

// --- my move while somebody else takes the same revision --------------------
for (const [label, origin_] of [
  ["from the board", "o6"],
  ["from home", "home"],
])
  await scene(
    `a move ${label} refused because an opponent left first is drawn again when repeated`,
    `qa.room=qa.toMove(qa.playing(['a','b','c']),'a',2,{a:['${origin_}','home'],b:['${origin_ === "home" ? "o2" : "o8"}','home']});
     qa.handler=data=>new Promise((resolve,reject)=>{qa.reply=resolve;qa.reject=reject})`,
    async (page) => {
      await chooseAndDecide(
        page,
        origin_ === "home" ? "1번 말 출발" : "1번 말 이동",
      );
      await page.waitForFunction(() => window.qa.motions.length > 0);
      // The opponent's leave is committed first; the server refuses the move.
      await page.evaluate(() => {
        window.qa.motions.length = 0;
        window.qa.push(
          window.qa.steady(
            window.qa.core.leaveYutRoom(window.qa.room, "c", Date.now()),
          ),
        );
        window.qa.reject(window.qa.fail("aborted"));
      });
      await page.waitForTimeout(2600);
      const back = await page.evaluate(() =>
        [...document.querySelectorAll(".yut-isometric-piece")].map((node) => [
          node.getAttribute("aria-label"),
          node.dataset.pawnNode,
          node.dataset.motion,
        ]),
      );
      assert.ok(
        back.some(
          ([text, node, motion]) =>
            /마가 1번/.test(text) && node === origin_ && motion === "idle",
        ),
        "the piece is back where the server has it: " + JSON.stringify(back),
      );
      assert.ok(
        back.some(([text, node]) => /우가 1번/.test(text) && node !== "home"),
        "the opponent was not captured after all",
      );
      assert.equal(
        (await motions(page)).filter((entry) => entry.kind === "caught").length,
        0,
        "nobody is shown as caught by a refused move",
      );
      assert.deepEqual(await alerts(page), [], "an expected race is silent");
      await page.evaluate(() => {
        window.qa.motions.length = 0;
      });
      await chooseAndDecide(
        page,
        origin_ === "home" ? "1번 말 출발" : "1번 말 이동",
      );
      await page.waitForTimeout(700);
      const again = await motions(page);
      assert.deepEqual(
        again.map((entry) => entry.kind).sort(),
        ["capture", "caught"],
        "the repeated move is animated exactly once",
      );
    },
  );
await scene(
  "another player's next event after a refused move replays nothing",
  `qa.room=qa.toMove(qa.playing(['a','b','c']),'a',2,{a:['o6','home']});
   qa.handler=data=>new Promise((resolve,reject)=>{qa.reply=resolve;qa.reject=reject})`,
  async (page) => {
    await chooseAndDecide(page, "1번 말 이동");
    await page.waitForFunction(() => window.qa.motions.length > 0);
    await page.evaluate(() => {
      window.qa.push(
        window.qa.core.skipYutTurn(
          { ...window.qa.room, turnDeadlineMs: 1 },
          Date.now(),
        ),
      );
      window.qa.reject(window.qa.fail("aborted"));
    });
    await page.waitForTimeout(2200);
    await page.evaluate(() => {
      window.qa.motions.length = 0;
      const room = window.qa.steady(window.qa.room);
      window.qa.push(
        window.qa.core.throwYut(
          room,
          "b",
          [true, false, false, false],
          Date.now(),
        ),
      );
    });
    await page.waitForTimeout(900);
    assert.deepEqual(await motions(page), [], "a throw moves no piece");
  },
);
await scene(
  "a refused move from home is not shown as a capture",
  `qa.room=qa.toMove(qa.playing(['a','b','c']),'a',2,{b:['o2','home']});
   qa.handler=data=>new Promise((resolve,reject)=>{qa.reply=resolve;qa.reject=reject})`,
  async (page) => {
    await chooseAndDecide(page, "1번 말 출발");
    await page.waitForFunction(() => window.qa.motions.length > 0);
    await page.evaluate(() => {
      window.qa.motions.length = 0;
      window.qa.reject(
        window.qa.fail("failed-precondition", "차례 시간이 지났습니다."),
      );
    });
    await page.waitForTimeout(400);
    const nodes = await page.evaluate(() =>
      [...document.querySelectorAll(".yut-isometric-piece")].map((node) => [
        node
          .getAttribute("aria-label")
          .match(/(..) (\d)번/)
          .slice(1)
          .join(""),
        node.dataset.pawnNode,
      ]),
    );
    assert.deepEqual(Object.fromEntries(nodes), {
      마가1: "home",
      마가2: "home",
      우가1: "o2",
    });
    assert.equal(
      (await motions(page)).filter((entry) => entry.kind === "caught").length,
      0,
      "taking a move back is not a capture",
    );
    await page.waitForTimeout(2000);
    assert.equal(await button(page, "결정").count(), 1);
    await page.locator(".yut-isometric-destination").first().waitFor();
  },
);

// --- a player who leaves while a piece is still moving -----------------------
await scene(
  "my turn opens although the opponent left in the middle of the move",
  `{const room=qa.toMove(qa.playing(['a','b','c']),'c',3);qa.room=room;qa.handler=async()=>({room:qa.room,serverNowMs:Date.now()})}`,
  async (page) => {
    await page.locator(".yut-board").waitFor();
    await page.waitForTimeout(2800);
    await page.evaluate(() => {
      window.qa.push(
        window.qa.core.moveYut(window.qa.room, "c", "1", "outer", Date.now()),
      );
    });
    await page.locator(".yut-isometric-piece.is-moving").waitFor();
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      window.qa.left = Date.now();
      window.qa.push(
        window.qa.core.leaveYutRoom(window.qa.room, "c", Date.now()),
      );
    });
    await page.waitForFunction(
      () => !!document.querySelector('[aria-label="윷 던지기"]:not(:disabled)'),
      null,
      { timeout: 8000 },
    );
    const waited = await page.evaluate(() => Date.now() - window.qa.left);
    assert.ok(waited < 2000, `the throw opened after ${waited}ms`);
  },
);
await scene(
  "a move after a missed update starts from that piece's own place",
  `{let room=qa.toMove(qa.playing(['a','b']),'b',4,{b:['o2','o12']});qa.room=room;qa.handler=async()=>({room:qa.room,serverNowMs:Date.now()})}`,
  async (page) => {
    await page.locator(".yut-board").waitFor();
    await page.waitForTimeout(2800);
    await page.evaluate(() => {
      const { core } = window.qa;
      // Two of b's moves arrive as one update after a reconnection.
      let room = core.moveYut(window.qa.room, "b", "1", "outer", Date.now());
      room = window.qa.toMove(room, "b", 2);
      room = core.moveYut(room, "b", "2", "outer", Date.now());
      window.qa.push(room);
    });
    await page.waitForFunction(() => window.qa.motions.length > 0);
    const first = (await motions(page)).find((entry) => /:2$/.test(entry.id));
    // o12 is drawn at x=244; piece 1 came from o2, at x=476.
    assert.ok(first && first.x < 300, JSON.stringify(first));
  },
);

// --- waiting room and menu ----------------------------------------------------
for (const order of ["snapshot first", "refusal first"]) {
  await scene(
    `two players readying at once (${order}) both become ready without a popup`,
    `{const room=qa.waiting(['h','b','a']);qa.room=room;let refused=false;
      qa.handler=async data=>{
        if(!refused){refused=true;const next=qa.core.readyYutPlayer(qa.room,'b',true,Date.now());
          ${order === "snapshot first" ? "qa.push(next);await new Promise(r=>setTimeout(r,150));" : "setTimeout(()=>qa.push(next),250);"}
          throw qa.fail('aborted')}
        if(data.expectedRevision!==qa.room.revision)throw qa.fail('aborted');
        const next=qa.core.readyYutPlayer(qa.room,'a',data.ready,Date.now());setTimeout(()=>qa.push(next),30);return{room:next,serverNowMs:Date.now()}}}`,
    async (page) => {
      await button(page, "준비 완료").click();
      await page.waitForTimeout(1200);
      assert.deepEqual(await alerts(page), []);
      assert.equal(await button(page, "준비 취소").isEnabled(), true);
      const sent = await page.evaluate(() => window.qa.commands);
      assert.equal(new Set(sent.map((entry) => entry.requestKey)).size, 2);
      assert.equal(sent.length, 2);
    },
  );
  await scene(
    `leaving a finished match while the others leave (${order}) needs one press`,
    `{let room=qa.playing(['a','b','c']);room={...room,status:'finished',winnerUid:'b',turnUid:null,finishReason:'completion',revision:room.revision+1,syncRevision:room.syncRevision+1,lastEvent:{kind:'finish',text:'b 님이 승리했습니다.',atMs:Date.now()-9000}};
      qa.room=room;let refused=false;
      qa.handler=async data=>{
        if(!refused){refused=true;const next=qa.core.leaveYutRoom(qa.room,'b',Date.now());
          ${order === "snapshot first" ? "qa.push(next);await new Promise(r=>setTimeout(r,150));" : "setTimeout(()=>qa.push(next),250);"}
          throw qa.fail('aborted')}
        if(data.expectedRevision!==qa.room.revision)throw qa.fail('aborted');
        qa.room=null;return{room:null,serverNowMs:Date.now()}}}`,
    async (page) => {
      await button(page, "새 판 준비하기").click();
      await page.locator(".yut-entry").waitFor({ timeout: 4000 });
      await page.waitForTimeout(200);
      assert.deepEqual(await alerts(page), []);
      assert.equal(await button(page, "새 판 만들기").isEnabled(), true);
    },
  );
}
for (const action of ["throw", "move", "skip"])
  for (const late of [false, true])
    await scene(
      `a 409 on ${action} recovers ${late ? "even when no room update comes" : "with the room update"}`,
      `{const base=qa.playing(['a','b','c']);
        qa.room=${action === "move" ? "qa.toMove(base,'a',2)" : action === "throw" ? "base" : "{...qa.toMove(base,'b',2),turnDeadlineMs:Date.now()-100}"};
        qa.handler=async data=>{const next=qa.steady(qa.core.leaveYutRoom({...qa.room,turnDeadlineMs:Date.now()+9e5},'c',Date.now()));
          ${late ? "qa.room=next;" : "setTimeout(()=>qa.push(next),400);"}throw qa.fail('aborted','다른 참가자의 동작이 먼저 반영되었습니다.')}}`,
      async (page) => {
        await page.locator(".yut-board").waitFor();
        if (action === "move") await chooseAndDecide(page, "1번 말 출발");
        else if (action === "skip")
          await button(page, "다음 차례로 넘기기").click();
        else {
          await button(page, "윷 던지기").press("Enter");
          await button(page, "힘을 멈추고 던지기").press("Enter");
        }
        let scary = [];
        for (let wait = 0; wait < 45; wait += 1) {
          scary = scary.concat(await alerts(page));
          await page.waitForTimeout(100);
        }
        assert.deepEqual(scary, [], "no popup at any time");
        assert.equal(await page.locator(".yut-player.is-left").count(), 1);
        const control = {
          throw: "윷 던지기",
          move: "1번 말 출발",
          skip: null,
        }[action];
        if (control) {
          await button(page, control).waitFor();
          assert.equal(await button(page, control).isEnabled(), true);
        }
        assert.equal(
          (await motions(page)).filter((entry) => entry.kind === "caught")
            .length,
          0,
        );
      },
    );
await scene(
  "a room that ended during an unanswered throw leaves a usable menu",
  `qa.room=qa.playing(['a','b']);qa.handler=async()=>{throw qa.fail('not-found','방을 찾을 수 없거나 이용 시간이 지났습니다.')}`,
  async (page) => {
    await button(page, "윷 던지기").press("Enter");
    await button(page, "힘을 멈추고 던지기").press("Enter");
    await button(page, "방 상태 다시 확인").waitFor();
    await page.evaluate(() => window.qa.push(null));
    await page.locator(".yut-entry").waitFor();
    await page.waitForTimeout(200);
    assert.deepEqual(await alerts(page), []);
    assert.equal(await button(page, "새 판 만들기").isEnabled(), true);
  },
);
await scene(
  "a kicked player's refused press ends at a usable menu",
  `qa.room=qa.waiting(['h','a']);qa.handler=async()=>{qa.room=null;setTimeout(()=>qa.refuse(),300);throw qa.fail('permission-denied','참가 중인 방에서만 이용할 수 있습니다.')}`,
  async (page) => {
    await button(page, "준비 완료").click();
    await page.locator(".yut-entry").waitFor();
    await page.waitForTimeout(400);
    assert.deepEqual(await alerts(page), []);
    assert.equal(await button(page, "새 판 만들기").isEnabled(), true);
  },
);
for (const message of [
  "열린 자리가 모두 찼습니다.",
  "이미 시작되었거나 닫힌 방입니다.",
])
  await scene(
    `a refused join (${message}) is explained and can be changed at once`,
    `qa.handler=async()=>{throw qa.fail('failed-precondition','${message}')}`,
    async (page) => {
      await page.locator("#yut-room-code").fill("ABC234");
      await button(page, "들어가기").click();
      await page.getByText(message, { exact: true }).waitFor();
      assert.equal(await page.locator("#yut-room-code").isEnabled(), true);
      assert.equal(await button(page, "여럿이서 시작").isEnabled(), true);
      await button(page, "알림 닫기").click();
      assert.deepEqual(await alerts(page), []);
    },
  );
await scene(
  "a race in the waiting room never locks the host",
  `{const room=qa.core.readyYutPlayer(qa.waiting(['a','b']),'b',true,Date.now());qa.room=room;
    qa.handler=async()=>{const next=qa.core.readyYutPlayer(qa.room,'b',false,Date.now());qa.push(next);await new Promise(r=>setTimeout(r,120));throw qa.fail('aborted')}}`,
  async (page) => {
    await button(page, "게임 시작").click();
    await page.waitForTimeout(500);
    assert.deepEqual(await alerts(page), []);
    assert.equal(await button(page, "b 강퇴").isEnabled(), true);
  },
);
await scene(
  "a wrong room code can be corrected at once",
  `qa.handler=async()=>{throw qa.fail('not-found','참가 코드를 확인해 주세요.')}`,
  async (page) => {
    const input = page.locator("#yut-room-code");
    await input.fill("abc234");
    await button(page, "들어가기").click();
    await page
      .getByText("참가 코드를 확인해 주세요.", { exact: true })
      .waitFor();
    assert.equal(await input.isEnabled(), true, "the code stays editable");
    await input.fill("xyz789");
    assert.equal(await button(page, "들어가기").isEnabled(), true);
  },
);
await scene(
  "a room code typed in full-width or lower-case letters is accepted",
  "qa.handler=async()=>{throw qa.fail('not-found','참가 코드를 확인해 주세요.')}",
  async (page) => {
    await page.locator("#yut-room-code").fill("ｒＭ２３４ａ");
    assert.equal(await page.locator("#yut-room-code").inputValue(), "RM234A");
    await button(page, "들어가기").click();
    await page.waitForFunction(() => window.qa.commands.length === 1);
    assert.equal(
      await page.evaluate(() => window.qa.commands[0].code),
      "RM234A",
    );
  },
);
await scene(
  "a lost create reply still blocks another create",
  `qa.handler=async()=>{throw qa.fail('unavailable')}`,
  async (page) => {
    await button(page, "새 판 만들기").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "만들기", exact: true })
      .click();
    await button(page, "방 상태 다시 확인").waitFor();
    assert.equal(await button(page, "새 판 만들기").isEnabled(), false);
  },
);
await scene(
  "the leave question closes with the room",
  `qa.room=qa.playing(['a','b']);qa.handler=async()=>{throw qa.fail('invalid-argument','방 정보를 새로 불러와 주세요.')}`,
  async (page) => {
    await button(page, "방 나가기").click();
    await page.getByText("이 판에서 나갈까요?").waitFor();
    await page.evaluate(() =>
      window.qa.push(window.qa.core.closeYutRoom(window.qa.room, Date.now())),
    );
    await page.locator(".yut-entry").waitFor();
    await page.waitForTimeout(200);
    assert.equal(await page.locator("dialog[open]").count(), 0);
  },
);
await scene(
  "withdrawing the mode while the room is being checked leaves the menu usable",
  `qa.room=qa.playing(['a','b']);qa.handler=async()=>({room:qa.room,serverNowMs:Date.now()})`,
  async (page) => {
    await page.locator(".yut-board").waitFor();
    await page.evaluate(() => {
      window.qa.holdLobby = true;
      for (const item of window.qa.listeners.filter((entry) => entry.active)) {
        item.active = false;
        item.error(window.qa.fail("unavailable"));
      }
    });
    await button(page, "방 상태 다시 확인").click();
    await page.waitForFunction(() => window.qa.releaseLobby);
    await page.evaluate(() => window.setSettings({ allowMultiplayer: false }));
    await page.locator(".yut-entry").waitFor();
    await page.evaluate(() => {
      window.qa.room = null;
      window.qa.holdLobby = false;
      window.qa.releaseLobby();
      window.setSettings({ allowMultiplayer: true });
    });
    await page.waitForTimeout(600);
    assert.equal(
      await page.getByText("윷판을 준비하고 있습니다.").count(),
      0,
      "the menu never stays in its loading state",
    );
    assert.equal(await button(page, "새 판 만들기").isEnabled(), true);
  },
);

// --- avatars -------------------------------------------------------------------
await scene(
  "a failed second answer keeps the avatars already shown",
  `qa.room=qa.waiting(['a','b']);let calls=0;
   qa.cast=async()=>{calls++;if(calls>1)throw qa.fail('unavailable');return{cast:{a:{look:qa.defaultLook('girl')},b:{look:qa.defaultLook('boy')}},piece:'avatar'}}`,
  async (page) => {
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".yut-seat .yut-avatar-sprite").length === 2,
    );
    await page.evaluate(() =>
      window.qa.push(
        window.qa.core.addYutPlayer(
          window.qa.room,
          { uid: "c", name: "c" },
          Date.now(),
        ),
      ),
    );
    await page.waitForFunction(() => window.qa.castCalls === 2);
    await page.waitForTimeout(500);
    assert.equal(
      await page.locator(".yut-seat .yut-avatar-sprite").count(),
      2,
      "a and b are still drawn as their avatars",
    );
  },
);
await scene(
  "a look met again after its frames were given back is never drawn from a dead address",
  `qa.made=new Set();qa.dead=new Set();
   const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{qa.dead.add(url);revoke(url)};
   qa.broken=[];
   (function watch(){for(const image of document.querySelectorAll('.yut-avatar-sprite image')){const href=image.getAttribute('href');if(qa.dead.has(href)&&!qa.broken.includes(href))qa.broken.push(href)}requestAnimationFrame(watch)})();
   qa.room=null;qa.cast=async roomId=>({cast:Object.fromEntries((roomId?qa.members:['a']).map(m=>[m,{look:qa.lookFor(m)}])),piece:'avatar'});
   qa.handler=async data=>{if(data.action==='leave'){qa.room=null;return{room:null,serverNowMs:Date.now()}}return{room:qa.room,serverNowMs:Date.now()}}`,
  async (page) => {
    // Distinct valid looks: combinations of real catalogue values.
    const values = await page.evaluate(async () => {
      const base = window.qa.defaultLook("girl");
      const options = window.MINIMI_VALUES;
      window.qa.lookFor = (member) => {
        if (member === "a") return base;
        const index = Number(member.replace(/\D/g, ""));
        const slots = Object.keys(options).filter(
          (slot) => options[slot].length > 2 && slot !== "character",
        );
        const look = { ...base };
        look[slots[0]] = options[slots[0]][index % options[slots[0]].length];
        look[slots[1]] =
          options[slots[1]][
            Math.floor(index / options[slots[0]].length) %
              options[slots[1]].length
          ];
        return look;
      };
      return Object.keys(options || {}).length;
    });
    assert.ok(values > 0, "catalogue values are available");
    await button(page, "새 판 만들기").waitFor();
    const play = async (members, id) => {
      await page.evaluate(
        ({ members, id }) => {
          window.qa.members = members;
          window.qa.room = { ...window.qa.waiting(members), id };
        },
        { members, id },
      );
      await button(page, "새 판 만들기").click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "만들기", exact: true })
        .click();
      await page.locator(".yut-waiting").waitFor();
      await page.waitForFunction(
        (size) =>
          document.querySelectorAll(".yut-seat .yut-avatar-sprite").length ===
          size,
        members.length,
        { timeout: 20000 },
      );
      await button(page, "방 나가기").click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "방 나가기", exact: true })
        .click();
      await button(page, "새 판 만들기").waitFor();
      await page.waitForTimeout(150);
    };
    for (let game = 0; game < 5; game += 1)
      await play(
        [`p${game * 3}`, "a", `p${game * 3 + 1}`, `p${game * 3 + 2}`],
        `room-${game}`,
      );
    await play(["p0", "a", "p1", "p2"], "room-again");
    const found = await page.evaluate(() => ({
      dead: window.qa.dead.size,
      broken: window.qa.broken.length,
    }));
    assert.ok(found.dead > 0, "old frames are given back");
    assert.equal(found.broken, 0, "no piece points at frames given back");
  },
);
await browser.close();
await new Promise((resolve) => server.close(resolve));
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
