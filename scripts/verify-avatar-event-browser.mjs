/** Real student event component, availability hook and transport; synthetic data only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const root = process.cwd(),
  evidence = path.join(root, "output/avatar-polish-20261114/event-student");
await fs.mkdir(evidence, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const thumbnail =
  "data:image/webp;base64," +
  (await fs.readFile(
    "public/avatar/minimi-v2/previews/girl/character-girl.webp",
    "base64",
  ));
const fixture = `
import {useSyncExternalStore} from 'react';
const listeners=new Set(), gates=new Set();
const qa=window.eventQa={uid:'student-a',generation:1,enabled:true,rewardWis:100,participated:false,reads:[],writes:[],subscriptions:0,stops:0,failRead:false,failSend:false,hold:false,ready:true,changed:false,refreshes:0};
let state={user:{uid:qa.uid},authGeneration:1};
export const auth={currentUser:state.user}, db={};
export const useAuth=()=>{useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state);return {...state,currentUser:state.user,config:{year:'2026',semester:'2'}}};
qa.switchAccount=()=>{qa.generation++;state={user:{uid:'student-b'},authGeneration:qa.generation};auth.currentUser=state.user;listeners.forEach(fn=>fn())};
qa.gate=value=>{qa.enabled=value;gates.forEach(fn=>fn({data:()=>({enabled:true,avatarEventEnabled:value,avatarEventRewardWis:qa.rewardWis})}))};
export const doc=(_db,path)=>({path});
export const onSnapshot=(ref,ok)=>{qa.subscriptions++;gates.add(ok);queueMicrotask(()=>ok({data:()=>({enabled:true,avatarEventEnabled:qa.enabled,avatarEventRewardWis:100})}));return()=>{qa.stops++;gates.delete(ok)}};
export async function callWithApplicationSession(name,input){
 if(name==='getGongsinmoongo'){qa.reads.push(structuredClone(input));if(qa.hold)await new Promise(r=>qa.release=r);if(qa.failRead){qa.failRead=false;throw Error('접수 상태 조회 실패')};return{data:{enabled:qa.enabled,rewardWis:100,participated:qa.participated,submission:qa.submission}}}
 if(name!=='manageGongsinmoongo'||input.action!=='submitAvatar')throw Error('Unexpected transport');
 qa.writes.push(structuredClone(input));if(qa.changed&&input.expectedAvatarRevision===1)throw Object.assign(Error('아바타가 변경되었습니다'),{details:{reason:'GONGSIN_AVATAR_CHANGED'}});if(qa.hold)await new Promise(r=>qa.release=r);if(qa.failSend){qa.failSend=false;throw Error('접수 연결 오류')};if(!qa.enabled)throw Error('접수가 종료되었습니다');
 qa.participated=true;qa.submission={questionId:'avatar-a',semesterId:'2026-2',description:input.description,thumbnailUrl:${JSON.stringify(thumbnail)},look:{},avatarRevision:input.expectedAvatarRevision,rewardWis:100,submittedAt:1};
 return{data:{replayed:false,avatarEvent:{enabled:true,rewardWis:100,participated:true,submission:qa.submission}}};
}
`;
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import AvatarEventSubmission from './src/features/avatar/AvatarEventSubmission';import {defaultAvatarLook} from './src/features/avatar/catalog';import {useAuth} from './src/contexts/AuthContext';import {useGongsinAvailability} from './src/lib/gongsinmoongo';import './src/features/avatar/avatarStudio.css';
function App(){const auth=useAuth();useGongsinAvailability();const[ready,setReady]=useState(true);window.eventQa.setReady=setReady;const avatar={schemaVersion:1,catalogVersion:2,look:defaultAvatarLook(),revision:1,lookHash:'test',ownedItemIds:[],thumbnailUrl:${JSON.stringify(thumbnail)}};return <main className="avatar-studio"><AvatarEventSubmission key={auth.user.uid+auth.authGeneration} readyForSubmission={ready} avatar={avatar} refreshAvatar={async()=>{window.eventQa.refreshes++;return {...avatar,revision:2}}}/></main>};createRoot(document.getElementById('root')).render(<App/>);`;
const result = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  outdir: "out",
  plugins: [
    {
      name: "event-local",
      setup(b) {
        b.onResolve(
          {
            filter:
              /\/AuthContext$|\/firebase$|\/applicationSession$|^firebase\/firestore$/,
          },
          (args) => ({ path: "event-fixture", namespace: "fixture" }),
        );
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: fixture,
          loader: "js",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = result.outputFiles.find((f) => f.path.endsWith(".js")).text,
  css = result.outputFiles.find((f) => f.path.endsWith(".css")).text;
const server = http.createServer((req, res) => {
  const file =
    req.url === "/fixture.js"
      ? ["text/javascript", js]
      : req.url === "/fixture.css"
        ? ["text/css", css]
        : [
            "text/html",
            `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;padding:16px;font:16px Arial;background:#f8fafc}main{max-width:480px;margin:auto}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`,
          ];
  res.setHeader("Content-Type", file[0] + ";charset=utf-8");
  res.end(file[1]);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`,
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  });
let errors = [],
  requests = [];
const reports = [];
try {
  for (const width of [320, 390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (r) =>
      r.request().url().startsWith(origin) ||
      r.request().url().startsWith("data:")
        ? r.continue()
        : (requests.push(r.request().url()), r.abort()),
    );
    await page.goto(origin);
    const open = page.getByRole("button", {
      name: "내 아바타 보내기",
      exact: true,
    });
    await open.waitFor();
    assert.equal(await page.evaluate(() => window.eventQa.reads.length), 0);
    assert.equal(
      await page.evaluate(() => window.eventQa.subscriptions),
      1,
      "shared availability listener",
    );
    await page.evaluate(() => window.eventQa.setReady(false));
    assert(await open.isDisabled());
    await page.getByText("아바타를 저장한 뒤 보내주세요.").waitFor();
    await page.evaluate(() => window.eventQa.setReady(true));
    await page.evaluate(() => (window.eventQa.failRead = true));
    await open.click();
    await page.getByRole("alert").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "공부의 神문고로 보내기" })
        .count(),
      0,
    );
    await page.getByRole("button", { name: "다시 불러오기" }).click();
    const intro = page.getByRole("textbox", { name: "내 아바타 소개" }),
      send = page.getByRole("button", { name: "공부의 神문고로 보내기" });
    await intro.waitFor();
    assert(await send.isDisabled());
    await intro.fill("반짝이는 리본과 한복으로 꾸민 나의 아바타입니다.");
    const modal = await page.locator("dialog").boundingBox();
    assert(modal.x >= 0 && modal.x + modal.width <= width + 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: path.join(evidence, `dialog-${width}.png`) });
    await page.evaluate(() => window.eventQa.gate(false));
    assert(await send.isDisabled());
    await page.evaluate(() => window.eventQa.gate(true));
    await page.evaluate(() => {
      window.eventQa.failSend = true;
      window.eventQa.hold = true;
    });
    await send.click();
    await page.evaluate(() =>
      document.querySelector(".avatar-event-dialog-actions button").click(),
    );
    assert.equal(
      await page.evaluate(() => window.eventQa.writes.length),
      1,
      "duplicate click suppressed",
    );
    await page.evaluate(() => {
      window.eventQa.hold = false;
      window.eventQa.release();
    });
    await page.getByRole("alert").waitFor();
    assert.equal(
      await intro.inputValue(),
      "반짝이는 리본과 한복으로 꾸민 나의 아바타입니다.",
    );
    await send.click();
    await page.getByText("아바타를 접수했습니다", { exact: true }).waitFor();
    const calls = await page.evaluate(() => window.eventQa.writes);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].requestId, calls[1].requestId);
    assert.deepEqual(
      Object.keys(calls[1]).sort(),
      [
        "action",
        "description",
        "expectedAvatarRevision",
        "requestId",
        "semesterId",
      ].sort(),
    );
    assert.equal(
      await page.evaluate(() => window.eventQa.submission.rewardedAt),
      undefined,
      "submission never grants reward",
    );
    await page
      .getByText(
        "교사가 확인한 뒤 보상을 지급합니다. 추가 접수는 할 수 없습니다.",
      )
      .waitFor();
    await page.getByRole("button", { name: "확인", exact: true }).click();
    assert(
      await page.getByRole("button", { name: "아바타 접수 완료" }).isDisabled(),
    );
    reports.push({
      width,
      reads: await page.evaluate(() => window.eventQa.reads.length),
      submitCalls: calls.length,
      rewardWrites: 0,
    });
    await page.close();
  }
  const page = await browser.newPage();
  await page.goto(origin);
  await page.getByRole("button", { name: "내 아바타 보내기" }).click();
  await page
    .getByRole("textbox", { name: "내 아바타 소개" })
    .fill("새 모습으로 보낼게요");
  await page.evaluate(() => {
    window.eventQa.rewardWis = 10;
    window.eventQa.gate(true);
    window.eventQa.changed = true;
  });
  await page
    .getByText("1인 1회 · 교사 확인 후 10위스 지급", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "공부의 神문고로 보내기" }).click();
  await page
    .getByRole("button", { name: "아바타 다시 불러오기", exact: true })
    .click();
  assert.equal(
    await page.getByRole("textbox", { name: "내 아바타 소개" }).inputValue(),
    "새 모습으로 보낼게요",
  );
  await page.getByRole("button", { name: "공부의 神문고로 보내기" }).click();
  await page.getByText("아바타를 접수했습니다", { exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(() =>
      window.eventQa.writes.map((x) => x.expectedAvatarRevision),
    ),
    [1, 2],
  );
  assert.equal(await page.evaluate(() => window.eventQa.refreshes), 1);
  await page.goto(origin);
  await page.getByRole("button", { name: "내 아바타 보내기" }).waitFor();
  await page.evaluate(() => (window.eventQa.hold = true));
  await page.getByRole("button", { name: "내 아바타 보내기" }).click();
  await page.evaluate(() => window.eventQa.switchAccount());
  await page.evaluate(() => {
    window.eventQa.hold = false;
    window.eventQa.release();
  });
  await page.waitForTimeout(30);
  assert.equal(
    await page.locator("dialog[open]").count(),
    0,
    "old-account result discarded",
  );
  await page.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      { passed: true, reports, errors, externalRequests: requests },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, reports, evidence }));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
