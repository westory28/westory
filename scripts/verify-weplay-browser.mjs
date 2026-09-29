/**
 * Real-component browser checks for Weplay. Only AuthContext and the callable
 * Firebase boundary use synthetic fixtures. No application-service traffic is
 * allowed. Production React components, helpers, inputs, and CSS are bundled.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
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
const evidence = path.join(
  root,
  ".superloopy/sessions/weplay-20260929/evidence",
);
await fs.mkdir(evidence, { recursive: true });
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "westory-weplay-browser-"),
);
const modulePath = (relative) =>
  JSON.stringify(path.join(root, relative).replaceAll("\\", "/"));
const currentCore = require(path.join(root, "functions/weplayCore.js"));
// These regression fixtures deliberately represent already-started rain sessions.
// New naval sessions are exercised in verify-weplay-naval-browser.mjs.
const core = { ...currentCore, GAME_DURATION_MS: 60000, buildWords(catalog, seed, difficulty = 'medium', config = { durationSeconds: 60, fallSeconds: currentCore.FALL_DURATIONS[difficulty].map(ms => ms / 1000) }) {
  return Array.from({ length: 20 }, (_, index) => {
    const stage = index < 7 ? 1 : index < 14 ? 2 : 3;
    const localIndex = index < 7 ? index : index < 14 ? index - 7 : index - 14;
    const phase = config.durationSeconds * 1000 / 3;
    const fallDurationMs = config.fallSeconds[stage - 1] * 1000;
    return { ...catalog[index % catalog.length], id: `word-${index + 1}`, stage, spawnAtMs: Math.floor((stage - 1) * phase + localIndex * (phase - fallDurationMs - 1000) / (stage < 3 ? 6 : 5)), fallDurationMs };
  });
} };
const policy = structuredClone(core.DEFAULT_POLICY);
const catalog = [
  {
    text: "훈민정음",
    unitId: "unit-1",
    lessonTitle: "조선의 문화",
    context: "세종은 훈민정음을 창제하였다.",
  },
  {
    text: "고려",
    unitId: "unit-1",
    lessonTitle: "조선의 문화",
    context: "고려를 건국한 인물은 왕건이다.",
  },
  {
    text: "삼국통일",
    unitId: "unit-2",
    lessonTitle: "통일 신라와 발해",
    context: "삼국통일의 과정을 살펴봅시다.",
  },
  {
    text: "대한민국임시정부",
    unitId: "unit-2",
    lessonTitle: "통일 신라와 발해",
    context: "대한민국임시정부의 활동을 알아봅시다.",
  },
];
const wordsByDifficulty = Object.fromEntries(
  ["mild", "medium", "spicy"].map((difficulty) => [
    difficulty,
    core.buildWords(catalog, "browser-qa", difficulty),
  ]),
);
const configuredGames = Object.fromEntries(
  [30, 90, 180].map((durationSeconds) => {
    const config = {
      durationSeconds,
      fallSeconds:
        durationSeconds === 30
          ? [5, 4, 3]
          : durationSeconds === 90
            ? [18, 12, 6]
            : [30, 20, 10],
      minWordLength: 1,
      maxWordLength: 12,
    };
    return [
      durationSeconds,
      {
        config,
        words: core.buildWords(catalog, "configured-qa", "mild", config),
      },
    ];
  }),
);
const fixture = `
const config = {year:"2026",semester:"2"};
const policy = ${JSON.stringify(policy)};
const wordsByDifficulty = ${JSON.stringify(wordsByDifficulty)};
const difficulty = new URLSearchParams(location.search).get("difficulty") || "medium";
const words = wordsByDifficulty[difficulty];
const mode = new URLSearchParams(location.search).get("view") || "student";
const configuredGame = ${JSON.stringify(configuredGames)}[new URLSearchParams(location.search).get("duration")];
const qa = window.weplayQa = { calls: [], session: null, balance: 30, fail: {}, failAfter: {}, hold: {}, records: [], policy, words, config };
const period = {id:"qa-period",startsAtMs:Date.now()-86400000,endsAtMs:Date.now()+86400000,rankingPeriod:"weekly",rankingRewards:policy.rankingRewards,status:"open"};
const clone = value => structuredClone(value);
const session = (gameMode,level=difficulty) => ({id:"qa-session",mode:gameMode,difficulty:level,status:"active",startsAtMs:Date.now()+3000,endsAtMs:Date.now()+3000+${core.GAME_DURATION_MS},words:clone(wordsByDifficulty[level]),acceptedWordIds:[],correctCount:0,policy:clone(qa.policy),result:null,serverNowMs:Date.now()});
qa.configuredGame = configuredGame;
const result = () => {
  const s = qa.session;
  const correctCount = s.acceptedWordIds.length;
  const reward = s.mode === "practice" ? 0 : [...s.policy.resultRewards].reverse().find(row => correctCount >= row.minCorrect).amount;
  const cost = s.mode === "practice" ? 0 : s.policy.challengeCost;
  return {sessionId:s.id,mode:s.mode,difficulty:s.difficulty,correctCount,totalWords:20,score:correctCount*100,reward,cost,netWis:reward-cost,balance:qa.balance+reward,finishedAtMs:Date.now(),missedWords:s.words.filter(w=>!s.acceptedWordIds.includes(w.id))};
};
qa.call = async (name,data) => {
  const receivedAt=Date.now();
  qa.calls.push({name,data:clone(data),at:Date.now()});
  if (qa.hold[name]) await new Promise(resolve=>{qa.release=resolve});
  if (qa.fail[name]) {qa.fail[name]--;const error=new Error("QA 연결 오류입니다. 다시 시도해 주세요.");error.code="functions/unavailable";throw error;}
  let response;
  if (name === "getWeplayPolicy") response={policy:clone(qa.policy),currentRankingPeriod:clone(period)};
  else if (name === "saveWeplayPolicy") {qa.policy=clone(data.policy);qa.saved=clone(data);response={policy:clone(qa.policy),currentRankingPeriod:clone(period)}}
  else if (name === "getWeplayLobby") response={gameEnabled:!mode.startsWith("disabled"),policy:clone(qa.policy),balance:qa.balance,dailyUsed:0,dailyRemaining:3,lessons:qa.empty?[]:[{unitId:"unit-1",title:"조선의 문화",wordCount:2},{unitId:"unit-2",title:"통일 신라와 발해",wordCount:2}],wordCount:qa.empty?0:4,activeSession:qa.session?.status==="active"?clone({...qa.session,serverNowMs:Date.now()}):null,records:clone(qa.records),period:clone(period),rankingByDifficulty:Object.fromEntries(["mild","medium","spicy"].map((level,index)=>[level,[{rank:1,studentLabel:String(index+1)+"번",score:1800-index*100,correctCount:18-index,isMe:false},{rank:2,studentLabel:"9번",score:1500,correctCount:15,isMe:true}]])),serverNowMs:Date.now()};
  else if (name === "startWeplayGame") {qa.session??=session(data.mode,data.difficulty);response=clone(qa.session)}
  else if (name === "submitWeplayAnswer") {
    const s=qa.session;const word=s.words.find(word=>word.id===data.wordId);
    const accepted=!!word && !s.acceptedWordIds.includes(word.id) && receivedAt>=s.startsAtMs+word.spawnAtMs+100 && receivedAt<=s.startsAtMs+word.spawnAtMs+word.fallDurationMs+750;
    if(accepted)s.acceptedWordIds.push(word.id);
    response={accepted,correctCount:s.acceptedWordIds.length,acceptedWordIds:clone(s.acceptedWordIds),serverNowMs:Date.now()};
  }
  else if (name === "finishWeplayGame") {qa.session.result??=result();qa.session.status="finished";qa.records=[qa.session.result];response=clone(qa.session.result)}
  else throw new Error("Unexpected callable: "+name);
  if(name === "getWeplayLobby" && mode === "configured") {
    response.difficulties=Object.fromEntries(["mild","medium","spicy"].map(level=>[level,{durationSeconds:120,fallSeconds:[20,15,10],minWordLength:1,maxWordLength:4}]));
    response.challengeDifficulties=${JSON.stringify(core.DEFAULT_DIFFICULTY_SETTINGS)};
    response.wordCountsByDifficulty={mild:3,medium:2,spicy:0};
    response.challengeWordCountsByDifficulty={mild:4,medium:4,spicy:4};
    response.lessons[0].wordCountsByDifficulty={mild:1,medium:1,spicy:0};
  }
  if(qa.failAfter[name]){qa.failAfter[name]--;throw new Error("응답을 받지 못했습니다. 다시 시도해 주세요.");}
  return {data:response};
};
export const getHttpsCallable = async name => data => qa.call(name,data);
export const db = {};
export const useAuth = () => ({config,userConfig:config,userData:{uid:"qa-student",role:"student",grade:2,class:1,number:2,name:"검증 학생"},currentUser:{uid:"qa-student"},loading:false,configReady:true});
export { qa, mode, config, session };
`;
const harness = `
import React from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import Weplay from ${modulePath("src/pages/student/Weplay.tsx")};
import Game from ${modulePath("src/pages/student/weplay/HistoryRainGame.tsx")};
import Policy from ${modulePath("src/pages/teacher/components/points/WeplayPolicyPanel.tsx")};
import {AppToastProvider} from ${modulePath("src/components/common/AppToastProvider.tsx")};
import {AppDialogProvider} from ${modulePath("src/components/common/AppDialogProvider.tsx")};
import {MENUS} from ${modulePath("src/constants/menus.ts")};
import {getStudentRouteAccess,isStudentVisibilityControlledPath} from ${modulePath("src/lib/studentMenuAccess.ts")};
import ${modulePath("src/assets/index.css")};
import {qa,mode,config,session} from "fixture:service";
if(mode.startsWith("game")){qa.session=session("practice");qa.session.startsAtMs=Date.now();qa.session.endsAtMs=Date.now()+${core.GAME_DURATION_MS};}
if(qa.configuredGame && mode.startsWith("game")){qa.session.words=structuredClone(qa.configuredGame.words);qa.session.endsAtMs=qa.session.startsAtMs+qa.configuredGame.config.durationSeconds*1000;qa.session.difficultySettings=qa.configuredGame.config;}
if(mode==="game-long")qa.session.words=qa.session.words.map(word=>({...word,text:"대한민국임시정부수립과정"}));
if(mode==="empty")qa.empty=true;
if(mode==="poor")qa.balance=0;
if(mode==="resume"||mode==="disabled-resume")qa.session=session("challenge");
if(mode==="load-error")qa.fail.getWeplayLobby=1;
if(mode==="policy-error")qa.fail.getWeplayPolicy=1;
qa.menuChecks=()=>{
  const target={pathname:"/student/weplay"};const hidden=structuredClone(MENUS);
  const item=hidden.student.find(item=>item.url==="/student/weplay");
  if(item.children?.length)item.children.forEach(child=>child.hidden=true);else hidden.student=hidden.student.filter(item=>item.url!==target.pathname);
  return {controlled:isStudentVisibilityControlledPath(target.pathname),visible:getStudentRouteAccess(target,config,MENUS),hidden:getStudentRouteAccess(target,config,hidden),unverified:getStudentRouteAccess(target,config,null)};
};
function Fixture(){return <MemoryRouter><AppToastProvider><AppDialogProvider>
{mode.startsWith("policy") ? <main style={{maxWidth:1000,padding:16,margin:"0 auto"}}><form onSubmit={event=>{event.preventDefault();qa.outerSubmitted=true}}><Policy config={config} canManage={mode!=="policy-readonly"} active /></form></main> : mode.startsWith("game") ? <main className="weplay-page"><Game session={qa.session} config={config} onComplete={result=>{qa.completed=result}} /></main> : <Weplay />}
</AppDialogProvider></AppToastProvider></MemoryRouter>}
createRoot(document.getElementById("root")).render(<Fixture/>);
`;
const bundle = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(temporary, "fixture.js"),
  loader: { ".svg": "dataurl" },
  external: ["/assets/*"],
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env.BASE_URL": '"/"' },
  plugins: [
    {
      name: "qa-service-boundary",
      setup(plugin) {
        plugin.onResolve({ filter: /^fixture:/ }, () => ({
          path: "service",
          namespace: "fixture",
        }));
        plugin.onResolve({ filter: /(?:^|\/)contexts\/AuthContext$/ }, () => ({
          path: "service",
          namespace: "fixture",
        }));
        plugin.onResolve(
          { filter: /(?:^|\/)lib\/firebase$|^\.\/firebase$/ },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: fixture,
          loader: "ts",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css =
  bundle.outputFiles
    .find((file) => file.path.endsWith(".css"))
    ?.text.replace(/@import\s+[^;]+;/g, "") || "";
// The app already uses this styling runtime; serve its cached copy locally so
// browser assertions cannot contact either Firebase or any other remote host.
const tailwindCache = path.join(os.tmpdir(), "westory-qa-tailwind.js");
let tailwind;
try {
  tailwind = await fs.readFile(tailwindCache, "utf8");
} catch {
  const response = await fetch("https://cdn.tailwindcss.com");
  assert(response.ok);
  tailwind = await response.text();
  await fs.writeFile(tailwindCache, tailwind);
}
const html =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>위플레이 QA</title><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname.startsWith('/assets/')) {
    const target = path.resolve(root, 'public', '.' + pathname);
    if (!target.startsWith(path.join(root, 'public') + path.sep)) { response.writeHead(400); response.end(); return; }
    response.setHeader('Content-Type', 'image/webp');
    response.end(await fs.readFile(target)); return;
  }
  response.setHeader(
    "Content-Type",
    pathname.endsWith(".js")
      ? "text/javascript"
      : pathname.endsWith(".css")
        ? "text/css"
        : "text/html; charset=utf-8",
  );
  response.end(
    pathname === "/fixture.js"
      ? js
      : pathname === "/fixture.css"
        ? css
        : pathname === "/tailwind.js"
          ? tailwind
          : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [];
const errors = [];
const screenshots = [];
const unexpectedRequests = [];
let status = "failed";
let failure = null;
async function pageFor(view, width = 1280, options = {}) {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    ...options,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(origin)) return route.continue();
    unexpectedRequests.push(route.request().url());
    return route.abort();
  });
  await page.clock.install({ time: new Date("2026-09-29T01:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-29T01:00:10Z"));
  await page.goto(`${origin}/?view=${view}`);
  await page.waitForFunction(() => Boolean(window.weplayQa));
  return page;
}
async function capture(page, name) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    `${name} must not overflow horizontally`,
  );
  await page.screenshot({
    path: path.join(evidence, `${name}.png`),
    fullPage: true,
  });
  screenshots.push(`${name}.png`);
}
try {
  for (const width of [390, 768, 1280]) {
    const page = await pageFor("student", width);
    await page
      .getByRole("heading", { name: "내가 충무공이라고?!", exact: true })
      .waitFor();
    await capture(page, `weplay-lobby-${width}`);
    await page.close();

    const policyPage = await pageFor("policy", width);
    const cost = policyPage.getByRole("spinbutton", {
      name: "도전 비용 (위스)",
      exact: true,
    });
    await cost.waitFor();
    await cost.fill("");
    assert.equal(
      await cost.inputValue(),
      "",
      "A cleared amount must remain blank while editing",
    );
    await cost.pressSequentially("12");
    assert.equal(await cost.inputValue(), "12");
    await cost.press("Tab");
    assert.equal(await cost.inputValue(), "12");
    const first = policyPage.getByRole("spinbutton", {
      name: "착한맛 1위 보상 (위스)",
      exact: true,
    });
    await first.fill("0");
    for (const [difficulty, label] of [
      ["mild", "착한맛"],
      ["medium", "중간맛"],
      ["spicy", "매운맛"],
    ]) {
      for (const [rank, key] of [
        [1, "first"],
        [2, "second"],
        [3, "third"],
      ]) {
        const field = policyPage.getByRole("spinbutton", {
          name: `${label} ${rank}위 보상 (위스)`,
          exact: true,
        });
        await field.fill(
          difficulty === "mild" && rank === 1 ? "0" : String(10 + rank),
        );
      }
    }
    await policyPage
      .getByRole("button", { name: "위플레이 정책 저장", exact: true })
      .click();
    await policyPage
      .getByText("위플레이 정책을 저장했습니다.", { exact: true })
      .waitFor();
    assert.equal(
      await policyPage.evaluate(
        () => window.weplayQa.saved.policy.challengeCost,
      ),
      12,
    );
    assert.equal(
      await policyPage.evaluate(
        () => window.weplayQa.saved.policy.rankingRewards.mild.first,
      ),
      0,
    );
    assert.equal(
      await policyPage.evaluate(() => window.weplayQa.outerSubmitted || false),
      false,
      "Saving Weplay must not submit the outer policy form",
    );
    await capture(policyPage, `weplay-policy-${width}`);
    checks.push(
      `${width}px: lobby/policy layout, numeric clear→12, zero reward, scoped save`,
    );
    await policyPage.close();

    const game = await pageFor("game", width);
    await game
      .getByRole("textbox", { name: "단어 입력", exact: true })
      .waitFor();
    await game.clock.runFor(500);
    assert(
      (
        await game
          .getByRole("textbox", { name: "단어 입력", exact: true })
          .boundingBox()
      ).height >= 44,
      "Game input target must be at least 44px high",
    );
    assert(
      (
        await game
          .getByRole("button", { name: "입력", exact: true })
          .boundingBox()
      ).height >= 44,
      "Game submit target must be at least 44px high",
    );
    await capture(game, `weplay-game-${width}`);
    await game.close();
  }

  const policyPage = await pageFor("policy");
  const cost = policyPage.getByRole("spinbutton", {
    name: "도전 비용 (위스)",
    exact: true,
  });
  await cost.fill("");
  await policyPage
    .getByRole("button", { name: "위플레이 정책 저장", exact: true })
    .click();
  await policyPage.getByRole("alert").waitFor();
  assert.equal(
    await policyPage.evaluate(
      () =>
        window.weplayQa.calls.filter((call) => call.name === "saveWeplayPolicy")
          .length,
    ),
    0,
    "Blank amount cannot silently become zero or be saved",
  );
  assert.equal(await cost.getAttribute("aria-invalid"), "true");
  await cost.fill("8");
  await policyPage.evaluate(() => {
    window.weplayQa.fail.saveWeplayPolicy = 1;
  });
  await cost.press("Enter");
  await policyPage
    .getByText(
      "정책을 저장하지 못했습니다. 입력한 값은 유지됩니다. 다시 저장해 주세요.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await cost.inputValue(),
    "8",
    "Failed policy save preserves draft",
  );
  await policyPage.evaluate(() => {
    window.weplayQa.hold.saveWeplayPolicy = true;
  });
  await policyPage
    .getByRole("button", { name: "위플레이 정책 저장", exact: true })
    .click();
  assert.equal(
    await policyPage
      .getByRole("button", { name: "저장 중…", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(await cost.isDisabled(), true);
  await policyPage.evaluate(() => {
    window.weplayQa.release();
    delete window.weplayQa.hold.saveWeplayPolicy;
  });
  await policyPage
    .getByText("위플레이 정책을 저장했습니다.", { exact: true })
    .waitFor();
  assert.equal(
    await policyPage.evaluate(() => window.weplayQa.saved.policy.challengeCost),
    8,
  );
  await capture(policyPage, "weplay-policy-retry");
  checks.push(
    "Policy: blank validation, Enter save, failed-save draft retention, retry, in-flight disabling",
  );
  await policyPage.close();

  const lobby = await pageFor("student", 390);
  await lobby.getByRole("button", { name: "연습 시작", exact: true }).waitFor();
  const menuChecks = await lobby.evaluate(() => window.weplayQa.menuChecks());
  assert.equal(menuChecks.controlled, true);
  assert.equal(menuChecks.visible.allowed, true);
  assert.equal(menuChecks.hidden.allowed, false);
  assert.equal(menuChecks.hidden.redirectTo, "/student/dashboard");
  assert.equal(menuChecks.unverified.allowed, false);
  await lobby
    .getByRole("group", { name: "난이도", exact: true })
    .getByRole("button", { name: "매운맛", exact: true })
    .click();
  assert.equal(
    await lobby
      .getByRole("combobox", { name: "난이도별 랭킹", exact: true })
      .inputValue(),
    "spicy",
  );
  assert.match(
    await lobby
      .getByRole("region", { name: "학급 랭킹", exact: true })
      .textContent(),
    /3번/,
  );
  await lobby.evaluate(() => {
    window.weplayQa.failAfter.startWeplayGame = 1;
  });
  await lobby.getByRole("button", { name: "연습 시작", exact: true }).click();
  await lobby.getByRole("alert").waitFor();
  await lobby.getByRole("button", { name: "연습 시작", exact: true }).click();
  const liveInput = lobby.getByRole("textbox", {
    name: "단어 입력",
    exact: true,
  });
  await liveInput.waitFor();
  assert.equal(await liveInput.isDisabled(), true);
  await lobby.clock.runFor(3000);
  assert.equal(await liveInput.isEnabled(), true);
  assert.equal(
    await liveInput.evaluate((element) => element === document.activeElement),
    true,
    "Keyboard focus enters the answer when the countdown ends",
  );
  const starts = await lobby.evaluate(() =>
    window.weplayQa.calls.filter((call) => call.name === "startWeplayGame"),
  );
  assert.equal(starts.length, 2);
  assert.equal(starts[0].data.difficulty, "spicy");
  assert.equal(
    starts[0].data.requestKey,
    starts[1].data.requestKey,
    "Lost start response retry retains the same idempotency key",
  );
  await lobby.clock.runFor(61000);
  await lobby
    .getByRole("heading", { name: "이번 기록 · 매운맛", exact: true })
    .waitFor();
  await capture(lobby, "weplay-result-390");
  assert.equal(
    await lobby
      .getByRole("button", { name: "다시 하기", exact: true })
      .isVisible(),
    true,
  );
  checks.push(
    "Menu hidden/unverified direct URL denied; lost start acknowledgement reuses request key; countdown focus; full practice result/restart",
  );
  await lobby.close();

  for (const view of [
    "empty",
    "poor",
    "load-error",
    "resume",
    "disabled",
    "disabled-resume",
  ]) {
    const page = await pageFor(view, 390);
    if (view === "empty") {
      assert.equal(
        await page
          .getByRole("button", { name: "연습 시작", exact: true })
          .isDisabled(),
        true,
      );
      await page
        .getByText("선택한 난이도와 범위에 출제할 단어가 없습니다.", {
          exact: true,
        })
        .waitFor();
    } else if (view === "disabled") {
      await page
        .getByText("지금은 게임을 쉬고 있습니다. 나중에 다시 이용해 주세요.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "연습 시작", exact: true })
          .isDisabled(),
        true,
      );
      await page
        .getByRole("button", { name: "위스 도전", exact: true })
        .click();
      assert.equal(
        await page.getByRole("button", { name: /위스 도전 시작/ }).isDisabled(),
        true,
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.weplayQa.calls.filter(
              (call) => call.name === "startWeplayGame",
            ).length,
        ),
        0,
      );
      await capture(page, "weplay-disabled-390");
    } else if (view === "poor") {
      assert.equal(
        await page
          .getByRole("button", { name: "연습 시작", exact: true })
          .isEnabled(),
        true,
      );
      await page
        .getByRole("button", { name: "위스 도전", exact: true })
        .click();
      assert.equal(
        await page.getByRole("button", { name: /위스 도전 시작/ }).isDisabled(),
        true,
      );
      await page
        .getByText("도전에 필요한 위스가 부족합니다.", { exact: true })
        .waitFor();
      await capture(page, "weplay-insufficient-balance-390");
    } else if (view === "load-error") {
      await page
        .getByRole("button", { name: "다시 불러오기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "연습 시작", exact: true })
        .waitFor();
    } else {
      await page
        .getByRole("textbox", { name: "단어 입력", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            window.weplayQa.calls.filter(
              (call) => call.name === "startWeplayGame",
            ).length,
        ),
        0,
        "Restoring an active session never creates a new charged game",
      );
    }
    checks.push(`Lobby ${view}`);
    await page.close();
  }

  for (const view of ["policy-error", "policy-readonly"]) {
    const page = await pageFor(view, 390);
    if (view === "policy-error") {
      await page
        .getByRole("button", { name: "다시 불러오기", exact: true })
        .click();
      await page
        .getByRole("spinbutton", { name: "도전 비용 (위스)", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            window.weplayQa.calls.filter(
              (call) => call.name === "getWeplayPolicy",
            ).length,
        ),
        2,
      );
    } else {
      assert.equal(
        await page
          .getByRole("spinbutton", { name: "도전 비용 (위스)", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "위플레이 정책 저장", exact: true })
          .isDisabled(),
        true,
      );
    }
    checks.push(view);
    await page.close();
  }

  const game = await pageFor("game");
  const answer = game.getByRole("textbox", { name: "단어 입력", exact: true });
  await answer.waitFor();
  await game.clock.runFor(1000);
  const firstWord = await game.evaluate(() => window.weplayQa.words[0].text);
  await answer.dispatchEvent("compositionstart", { data: firstWord });
  await answer.fill(firstWord);
  await answer.press("Enter");
  assert.equal(
    await game.evaluate(
      () =>
        window.weplayQa.calls.filter(
          (call) => call.name === "submitWeplayAnswer",
        ).length,
    ),
    0,
    "Korean composition Enter must not submit",
  );
  await answer.dispatchEvent("compositionend", { data: firstWord });
  await answer.press("Enter");
  await game.getByText("성공 1 / 20", { exact: true }).waitFor();
  assert.equal(
    await game.evaluate(
      () =>
        window.weplayQa.calls.filter(
          (call) => call.name === "submitWeplayAnswer",
        ).length,
    ),
    1,
  );
  await answer.fill("화면에없는단어");
  await answer.press("Enter");
  await game
    .getByText("화면에 있는 단어를 확인해 주세요.", { exact: true })
    .waitFor();
  assert.equal(
    await game.evaluate(
      () =>
        window.weplayQa.calls.filter(
          (call) => call.name === "submitWeplayAnswer",
        ).length,
    ),
    1,
    "Local mismatch must not cause a financial/callable action",
  );
  await game.clock.runFor(19000);
  await game.getByRole("status").filter({ hasText: "중반" }).waitFor();
  await game.clock.runFor(20000);
  await game.getByRole("status").filter({ hasText: "후반" }).waitFor();
  await game.evaluate(() => {
    window.weplayQa.fail.finishWeplayGame = 1;
  });
  await game.clock.runFor(20000);
  assert.equal(
    await answer.isDisabled(),
    true,
    "Input must close at the 60-second boundary",
  );
  assert.equal(
    await game.evaluate(
      () =>
        window.weplayQa.calls.filter((call) => call.name === "finishWeplayGame")
          .length,
    ),
    0,
    "Finalization waits for pending answers",
  );
  await game.clock.runFor(1000);
  await game
    .getByRole("button", { name: "정산 다시 시도", exact: true })
    .waitFor();
  await game
    .getByRole("button", { name: "정산 다시 시도", exact: true })
    .click();
  assert.equal(
    await game.evaluate(() => window.weplayQa.completed.mode),
    "practice",
  );
  assert.equal(await game.evaluate(() => window.weplayQa.completed.netWis), 0);
  assert.equal(
    await game.evaluate(
      () =>
        window.weplayQa.calls.filter((call) => call.name === "finishWeplayGame")
          .length,
    ),
    2,
  );
  checks.push(
    "Game: Korean IME composition guard, Enter success, mismatch handling, 20/40/60-second stage/end boundaries, settlement retry, practice zero Wis",
  );
  await game.close();

  const speedResults = {};
  for (const [difficulty, expectedDurations] of Object.entries({
    mild: [12000, 10000, 8000],
    medium: [10000, 8000, 6000],
    spicy: [8000, 6000, 4000],
  })) {
    const speed = await pageFor(`game&difficulty=${difficulty}`, 390);
    const positions = [];
    const timepoints = [1000, 21000, 41000];
    let previous = 0;
    for (const timepoint of timepoints) {
      await speed.clock.runFor(timepoint - previous);
      previous = timepoint;
      positions.push(
        await speed
          .locator(".weplay-word")
          .first()
          .evaluate(
            (element) => new DOMMatrix(getComputedStyle(element).transform).m42,
          ),
      );
    }
    assert(
      positions[0] < positions[1] && positions[1] < positions[2],
      `${difficulty} must accelerate: ${positions}`,
    );
    assert.deepEqual(
      await speed.evaluate(() =>
        [1, 2, 3].map(
          (stage) =>
            window.weplayQa.session.words.find((word) => word.stage === stage)
              .fallDurationMs,
        ),
      ),
      expectedDurations,
    );
    speedResults[difficulty] = positions;
    await capture(speed, `weplay-${difficulty}-late-390`);
    await speed.close();
  }
  for (let index = 0; index < 3; index++)
    assert(
      speedResults.mild[index] < speedResults.medium[index] &&
        speedResults.medium[index] < speedResults.spicy[index],
    );
  checks.push(
    `All nine fall speeds verified (one-second movement, pixels): ${JSON.stringify(speedResults)}`,
  );

  const reduced = await pageFor("game", 390, { reducedMotion: "reduce" });
  await reduced.clock.runFor(1000);
  assert.equal(
    await reduced
      .locator(".weplay-field")
      .evaluate((element) => element.classList.contains("is-still")),
    true,
  );
  assert.equal(
    await reduced
      .locator(".weplay-word")
      .first()
      .evaluate((element) => getComputedStyle(element).transform),
    "none",
  );
  assert.match(
    await reduced.locator(".weplay-word small").first().textContent(),
    /초$/,
  );
  await capture(reduced, "weplay-reduced-motion-390");
  checks.push("Reduced motion: stationary words and visible remaining seconds");
  await reduced.close();
  for (const width of [320, 390])
    for (const difficulty of ["mild", "medium", "spicy"]) {
      const long = await pageFor(`game-long&difficulty=${difficulty}`, width);
      for (let tick = 0; tick < 60; tick++) {
        await long.clock.runFor(tick === 0 ? 50 : 1000);
        const defects = await long
          .locator(".weplay-field")
          .evaluate((field) => {
            const bounds = field.getBoundingClientRect();
            const words = [
              ...field.querySelectorAll(".weplay-word > span"),
            ].map((element) => element.getBoundingClientRect());
            const defects = [];
            words.forEach((word, index) => {
              if (
                word.left < bounds.left ||
                word.right > bounds.right ||
                word.top < bounds.top ||
                word.bottom > bounds.bottom
              )
                defects.push({
                  kind: "clipped",
                  index,
                  top: word.top - bounds.top,
                  bottom: bounds.bottom - word.bottom,
                });
              for (const [otherIndex, other] of words.entries())
                if (
                  otherIndex > index &&
                  word.left < other.right &&
                  word.right > other.left &&
                  word.top < other.bottom &&
                  word.bottom > other.top
                )
                  defects.push({ kind: "overlap", index, otherIndex });
            });
            return defects;
          });
        if (defects.length)
          await capture(long, `weplay-long-failure-${difficulty}-${width}`);
        assert.deepEqual(
          defects,
          [],
          `${width}px ${difficulty} at ${tick}s must show whole non-overlapping words`,
        );
        if (tick === 5)
          await capture(long, `weplay-long-word-${difficulty}-${width}`);
      }
      checks.push(
        `${width}px ${difficulty}: 12-character words remain fully visible with no pair overlap across all 60 seconds`,
      );
      await long.close();
    }
  for (const duration of [30, 90, 180]) {
    const custom = await pageFor(
      `game-long&difficulty=mild&duration=${duration}`,
      320,
    );
    for (let tick = 0; tick < duration; tick++) {
      await custom.clock.runFor(tick === 0 ? 50 : 1000);
      const stage = Math.floor(tick / (duration / 3));
      assert.equal(
        await custom
          .locator('.weplay-stages li[aria-current="step"] strong')
          .textContent(),
        ["초반", "중반", "후반"][stage],
      );
      const overlap = await custom
        .locator(".weplay-field")
        .evaluate((field) => {
          const words = [...field.querySelectorAll(".weplay-word > span")].map(
            (el) => el.getBoundingClientRect(),
          );
          return words.some((word, index) =>
            words
              .slice(index + 1)
              .some(
                (other) =>
                  word.left < other.right &&
                  word.right > other.left &&
                  word.top < other.bottom &&
                  word.bottom > other.top,
              ),
          );
        });
      assert.equal(
        overlap,
        false,
        `${duration}s configured game at ${tick}s: word overlap`,
      );
    }
    await custom.clock.runFor(2100);
    assert.equal(
      await custom.evaluate(() => window.weplayQa.completed.totalWords),
      20,
    );
    await custom.close();
    checks.push(
      `Configured ${duration}s game: actual third-stage transitions, full duration completion, 20-word result, no 12-character word overlap at 320px`,
    );
  }
  const configuredLobby = await pageFor("configured", 390);
  await configuredLobby
    .getByText("120초 · 2단어마다 화포 발사", { exact: true })
    .waitFor();
  assert.equal(
    await configuredLobby
      .getByRole("button", { name: "연습 시작", exact: true })
      .isEnabled(),
    true,
  );
  await configuredLobby
    .getByRole("group", { name: "난이도", exact: true })
    .getByRole("button", { name: "중간맛", exact: true })
    .click();
  assert.equal(
    await configuredLobby
      .getByRole("button", { name: "연습 시작", exact: true })
      .isDisabled(),
    true,
  );
  await configuredLobby
    .getByRole("group", { name: "게임 모드", exact: true })
    .getByRole("button", { name: "위스 도전", exact: true })
    .click();
  await configuredLobby
    .getByText("90초 · 3단어마다 화포 발사", { exact: true })
    .waitFor();
  assert.equal(
    await configuredLobby
      .getByRole("button", { name: "위스 도전 시작 · 2위스", exact: true })
      .isEnabled(),
    true,
  );
  await configuredLobby
    .getByRole("group", { name: "게임 모드", exact: true })
    .getByRole("button", { name: "연습", exact: true })
    .click();
  await configuredLobby
    .getByRole("group", { name: "난이도", exact: true })
    .getByRole("button", { name: "착한맛", exact: true })
    .click();
  await configuredLobby
    .locator(".weplay-select select")
    .first()
    .selectOption("unit-1");
  assert.equal(
    await configuredLobby
      .getByRole("button", { name: "연습 시작", exact: true })
      .isDisabled(),
    true,
  );
  await configuredLobby.close();
  checks.push(
    "Student lobby uses latest practice and frozen challenge durations/counts; per-lesson filtered word count guards start",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedRequests, []);
  status = "passed";
} catch (error) {
  failure = String(error.stack || error);
  throw error;
} finally {
  await fs.writeFile(
    path.join(evidence, "browser-results.json"),
    JSON.stringify(
      { status, failure, checks, errors, unexpectedRequests, screenshots },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(`PASS Weplay browser checks. Evidence: ${evidence}`);
