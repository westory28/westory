/** Real student event component, availability hook and transport; synthetic data only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const root = process.cwd(),
  evidence =
    process.env.AVATAR_EVENT_EVIDENCE_DIR ||
    path.join(root, "output/avatar-polish-20261114/event-student");
await fs.mkdir(evidence, { recursive: true });
const require = createRequire(import.meta.url);
const playwright = require(
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
const listeners=new Set(), gates=new Set(), gateFailures=new Set(), params=new URLSearchParams(location.search);
const qa=window.eventQa={uid:'student-a',generation:1,enabled:!params.has('closed'),rewardWis:100,participated:false,reads:[],writes:[],subscriptions:0,stops:0,failRead:false,failSend:false,hold:false,ready:true,changed:false,refreshes:0,failGateReads:params.has('gate-error')?1:0};
let state={user:{uid:qa.uid},authGeneration:1};
export const auth={currentUser:state.user}, db={};
export const getHistoryDictionaryCallable=()=>{throw Error('Unexpected avatar transport')};
export const useAuth=()=>{useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state);return {...state,currentUser:state.user,config:{year:'2026',semester:'2'}}};
qa.switchAccount=()=>{qa.generation++;state={user:{uid:'student-b'},authGeneration:qa.generation};auth.currentUser=state.user;listeners.forEach(fn=>fn())};
qa.gate=value=>{qa.enabled=value;gates.forEach(fn=>fn({data:()=>({enabled:true,avatarEventEnabled:value,avatarEventRewardWis:qa.rewardWis})}))};
qa.failGate=()=>gateFailures.forEach(fn=>fn(Error('공개 상태 조회 실패')));
export const doc=(_db,path)=>({path});
export const onSnapshot=(ref,ok,error)=>{qa.subscriptions++;gates.add(ok);gateFailures.add(error);queueMicrotask(()=>qa.failGateReads-->0?error(Error('공개 상태 조회 실패')):ok({data:()=>({enabled:true,avatarEventEnabled:qa.enabled,avatarEventRewardWis:100})}));return()=>{qa.stops++;gates.delete(ok);gateFailures.delete(error)}};
export async function callWithApplicationSession(name,input){
 if(name==='getGongsinmoongo'){qa.reads.push(structuredClone(input));if(qa.hold)await new Promise(r=>qa.release=r);if(qa.failRead){qa.failRead=false;throw Error('접수 상태 조회 실패')};return{data:{enabled:qa.enabled,rewardWis:100,participated:qa.participated,submission:qa.submission}}}
 if(name!=='manageGongsinmoongo'||input.action!=='submitAvatar')throw Error('Unexpected transport');
 qa.writes.push(structuredClone(input));if(qa.changed&&input.expectedAvatarRevision===1)throw Object.assign(Error('아바타가 변경되었습니다'),{details:{reason:'GONGSIN_AVATAR_CHANGED'}});if(qa.hold)await new Promise(r=>qa.release=r);if(qa.failSend){qa.failSend=false;throw Error('접수 연결 오류')};if(!qa.enabled)throw Error('접수가 종료되었습니다');
 qa.participated=true;qa.submission={questionId:'avatar-a',semesterId:'2026-2',description:input.description,thumbnailUrl:${JSON.stringify(thumbnail)},look:{},avatarRevision:input.expectedAvatarRevision,rewardWis:100,submittedAt:1};
 return{data:{replayed:false,avatarEvent:{enabled:true,rewardWis:100,participated:true,submission:qa.submission}}};
}
`;
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import AvatarEventSubmission from './src/features/avatar/AvatarEventSubmission';import {AvatarStudio} from './src/features/avatar/AvatarStudio';import {AppToastProvider} from './src/components/common/AppToastProvider';import {defaultAvatarLook} from './src/features/avatar/catalog';import {useAuth} from './src/contexts/AuthContext';import {useGongsinAvailability} from './src/lib/gongsinmoongo';import './src/features/avatar/avatarStudio.css';
const studio=new URLSearchParams(location.search).has('studio'),qa=window.eventQa;
qa.studioLoads=0;qa.studioSaves=[];qa.saveAttempts=[];qa.failSave=false;qa.studioAvatar={schemaVersion:1,catalogVersion:2,look:defaultAvatarLook(),revision:0,lookHash:'test',ownedItemIds:[]};
const adapter={load:async()=>{qa.studioLoads++;return{avatar:qa.studioAvatar,balance:0,pricing:{revision:0,prices:{}}}},purchase:async()=>{throw Error('Unexpected purchase')},save:async(look,revision,thumbnailUrl)=>{qa.saveAttempts.push({look,revision,thumbnailUrl});if(qa.failSave){qa.failSave=false;throw Object.assign(Error('Save unavailable'),{code:'functions/unavailable'})}if(revision!==qa.studioAvatar.revision)throw Error('Stale avatar save');qa.studioAvatar={...qa.studioAvatar,look,revision:revision+1,thumbnailUrl,requiresThumbnailRefresh:false};qa.studioSaves.push({revision:revision+1,thumbnailUrl});return qa.studioAvatar}};
function App(){const auth=useAuth();useGongsinAvailability();const[ready,setReady]=useState(true);window.eventQa.setReady=setReady;const avatar={schemaVersion:1,catalogVersion:2,look:defaultAvatarLook(),revision:1,lookHash:'test',ownedItemIds:[],thumbnailUrl:${JSON.stringify(thumbnail)}};return <AppToastProvider>{studio?<AvatarStudio key={auth.user.uid+auth.authGeneration} adapter={adapter} mode="wardrobe" studentAvatarEvent/>:<main className="avatar-studio"><AvatarEventSubmission key={auth.user.uid+auth.authGeneration} readyForSubmission={ready} avatar={avatar} refreshAvatar={async()=>{window.eventQa.refreshes++;return {...avatar,revision:2}}}/></main>}</AppToastProvider>};createRoot(document.getElementById('root')).render(<App/>);`;
const result = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  outdir: "out",
  define: {
    "import.meta.env.BASE_URL": '"/"',
    "process.env.NODE_ENV": '"production"',
  },
  plugins: [
    {
      name: "event-local",
      setup(b) {
        b.onResolve(
          {
            filter:
              /\/AuthContext$|\/firebase$|\/applicationSession$|\/historyDictionarySession$|^firebase\/firestore$/,
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
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname.startsWith("/avatar/")) {
    const publicRoot = path.resolve(root, "public");
    const file = path.resolve(publicRoot, `.${pathname}`);
    if (!file.startsWith(publicRoot + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const content = await fs.readFile(file);
      const type = file.endsWith(".png")
        ? "image/png"
        : file.endsWith(".webp")
          ? "image/webp"
          : "application/json";
      res.writeHead(200, { "Content-Type": type });
      res.end(content);
    } catch {
      res.writeHead(404).end();
    }
    return;
  }
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
  browserName = process.env.AVATAR_EVENT_BROWSER || "chromium",
  browser = await playwright[browserName].launch({
    ...(browserName === "chromium"
      ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge" }
      : {}),
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
    await page.waitForFunction(
      () =>
        document.querySelector(".avatar-event-entry > button")?.disabled ===
        true,
    );
    assert(await open.isDisabled());
    await page.getByText("아바타를 저장한 뒤 보내주세요.").waitFor();
    await page.evaluate(() => window.eventQa.setReady(true));
    await page.waitForFunction(
      () =>
        document.querySelector(".avatar-event-entry > button")?.disabled ===
        false,
    );
    await page.evaluate(() => (window.eventQa.failRead = true));
    await open.click();
    await page.locator('.avatar-event-dialog p[role="alert"]').waitFor();
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
    await page.waitForFunction(
      () => document.querySelector(".gongsin-drum-button")?.disabled === true,
    );
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
    await page.locator('.avatar-event-dialog p[role="alert"]').waitFor();
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
  const recovery = await browser.newPage({
    viewport: { width: 390, height: 900 },
  });
  await recovery.goto(`${origin}/?gate-error=1`);
  await recovery
    .getByText("이벤트 참여 정보를 불러오지 못했습니다.", { exact: true })
    .waitFor();
  assert.equal(
    await recovery
      .getByRole("button", { name: "내 아바타 보내기", exact: true })
      .count(),
    0,
  );
  assert.deepEqual(
    await recovery.evaluate(() => ({
      reads: window.eventQa.reads.length,
      writes: window.eventQa.writes.length,
      subscriptions: window.eventQa.subscriptions,
    })),
    { reads: 0, writes: 0, subscriptions: 1 },
  );
  await recovery
    .getByRole("button", { name: "다시 확인하기", exact: true })
    .click();
  await recovery
    .getByRole("button", { name: "내 아바타 보내기", exact: true })
    .click();
  await recovery
    .getByRole("textbox", { name: "내 아바타 소개" })
    .fill("연결을 다시 확인한 아바타 소개");
  await recovery.evaluate(() => window.eventQa.failGate());
  await recovery
    .getByText("이벤트 참여 정보를 불러오지 못했습니다.", { exact: true })
    .waitFor();
  assert(
    await recovery
      .getByRole("button", { name: "공부의 神문고로 보내기", exact: true })
      .isDisabled(),
  );
  await recovery
    .getByRole("button", { name: "다시 확인하기", exact: true })
    .click();
  await recovery.waitForFunction(() => window.eventQa.subscriptions === 3);
  await recovery.waitForFunction(
    () => document.querySelector(".gongsin-drum-button")?.disabled === false,
  );
  assert(
    await recovery
      .getByRole("button", { name: "공부의 神문고로 보내기", exact: true })
      .isEnabled(),
  );
  assert.equal(
    await recovery
      .getByRole("textbox", { name: "내 아바타 소개" })
      .inputValue(),
    "연결을 다시 확인한 아바타 소개",
  );
  assert.deepEqual(
    await recovery.evaluate(() => ({
      reads: window.eventQa.reads.length,
      writes: window.eventQa.writes.length,
      subscriptions: window.eventQa.subscriptions,
      stops: window.eventQa.stops,
    })),
    { reads: 1, writes: 0, subscriptions: 3, stops: 2 },
  );
  reports.push({
    availabilityRecovery: true,
    explicitRetries: 2,
    subscriptions: 3,
    extraEventReads: 0,
    writes: 0,
    draftPreserved: true,
  });
  await recovery.goto(`${origin}/?closed=1`);
  await recovery.waitForFunction(() => window.eventQa.subscriptions === 1);
  assert.equal(
    await recovery.locator(".avatar-event-entry").count(),
    0,
    "Normal closure stays hidden without an error or retry",
  );
  assert.equal(
    await recovery.evaluate(
      () => window.eventQa.reads.length + window.eventQa.writes.length,
    ),
    0,
  );
  await recovery.close();
  for (const width of [320, 390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    if (process.env.AVATAR_EVENT_PNG_FALLBACK === "1") {
      await page.addInitScript(() => {
        const encode = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (type, ...args) {
          return encode.call(
            this,
            type === "image/webp" ? "image/png" : type,
            ...args,
          );
        };
        window.createImageBitmap = undefined;
      });
    }
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      /^(data|blob):/.test(route.request().url()) ||
      route.request().url().startsWith(origin)
        ? route.continue()
        : (requests.push(route.request().url()), route.abort()),
    );
    await page.goto(`${origin}/?studio=1`);
    const opener = page.getByRole("button", {
      name: "내 아바타 보내기",
      exact: true,
    });
    await opener.waitFor({ timeout: 10000 }).catch(async (failure) => {
      console.error(
        JSON.stringify({
          errors,
          body: await page.locator("body").innerText(),
          qa: await page.evaluate(() => window.eventQa),
        }),
      );
      throw failure;
    });
    assert(await opener.isDisabled(), "An unsaved avatar cannot be submitted");
    assert.equal(await page.evaluate(() => window.eventQa.reads.length), 0);
    await page
      .getByRole("button", { name: "여학생 아바타", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector(".avatar-studio")?.dataset.rendererReady ===
        "true",
    );
    const saveButton = page.getByRole("button", {
      name: "아바타 저장",
      exact: true,
    });
    const saveStyle = await saveButton.evaluate((element) => {
      const style = getComputedStyle(element),
        bounds = element.getBoundingClientRect();
      return {
        color: style.color,
        background: style.backgroundColor,
        height: bounds.height,
        width: bounds.width,
      };
    });
    assert.equal(saveStyle.color, "rgb(255, 255, 255)");
    assert.equal(
      saveStyle.background,
      "rgb(37, 99, 235)",
      "Primary save must not be white on white",
    );
    assert(saveStyle.height >= 44 && saveStyle.width >= 44);
    await saveButton.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(evidence, `studio-save-${width}.png`),
    });
    await page.evaluate(() => {
      window.eventQa.failSave = true;
    });
    await saveButton.click();
    await page
      .getByText(
        "처리를 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.eventQa.studioSaves.length),
      0,
    );
    assert(await opener.isDisabled());
    await saveButton.click();
    await page.waitForFunction(() => window.eventQa.studioSaves.length === 1);
    await page.waitForFunction(
      () =>
        document.querySelector(".avatar-event-entry > button")?.disabled ===
        false,
    );
    assert(
      await opener.isEnabled(),
      "Saving enables submission without refreshing the page",
    );
    const savedStyle = await saveButton.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        background: style.backgroundColor,
        opacity: style.opacity,
        disabled: element.disabled,
      };
    });
    assert.equal(savedStyle.disabled, true);
    assert.equal(savedStyle.opacity, "1");
    assert.notEqual(
      savedStyle.color,
      savedStyle.background,
      "Disabled save remains readable",
    );
    assert.equal(await page.evaluate(() => window.eventQa.studioLoads), 1);
    assert.equal(await page.evaluate(() => window.eventQa.reads.length), 0);
    await opener.click();
    await page
      .getByRole("textbox", { name: "내 아바타 소개" })
      .fill("저장한 아바타를 선생님께 소개합니다.");
    await page
      .getByRole("button", { name: "공부의 神문고로 보내기", exact: true })
      .click();
    await page.getByText("아바타를 접수했습니다", { exact: true }).waitFor();
    const submission = await page.evaluate(() => ({
      writes: window.eventQa.writes,
      saves: window.eventQa.studioSaves,
      reads: window.eventQa.reads,
    }));
    assert.equal(submission.writes.length, 1);
    assert.equal(
      submission.writes[0].expectedAvatarRevision,
      submission.saves[0].revision,
    );
    assert.equal(submission.writes[0].semesterId, "2026-2");
    assert.equal(submission.reads.length, 1);
    const thumbnailMime = submission.saves[0].thumbnailUrl.match(
      /^data:image\/([^;]+);/,
    )[1];
    assert(["png", "webp"].includes(thumbnailMime));
    if (process.env.AVATAR_EVENT_PNG_FALLBACK === "1")
      assert.equal(thumbnailMime, "png");
    const attempts = await page.evaluate(() => window.eventQa.saveAttempts);
    assert.equal(attempts.length, 2);
    assert.deepEqual(
      attempts[0],
      attempts[1],
      "Failed save preserves look, revision and thumbnail for retry",
    );
    await page.screenshot({
      path: path.join(evidence, `studio-submitted-${width}.png`),
    });
    reports.push({
      width,
      studioIntegration: true,
      avatarSaves: 1,
      saveAttempts: 2,
      eventReads: 1,
      submitCalls: 1,
      rewardWrites: 0,
      browser: browserName,
      thumbnailMime,
      saveStyle,
      savedStyle,
    });
    await page.close();
  }
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
