/** Real portal/game components and CSS, with offline service boundaries only. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const core = require("../functions/weplayCore.js");
const audioOnly = process.argv.includes("--audio-only");
const frameOnly = process.argv.includes("--frame-only");
const introOnly = process.argv.includes("--intro-only");
const evidence = path.resolve(
  process.env.WEPLAY_QA_EVIDENCE_DIR ||
    path.join(
      root,
      audioOnly
        ? "output/weplay-intro-sound-20261018"
        : "output/weplay-opening-layout-20261018",
    ),
);
await fs.mkdir(evidence, { recursive: true });
const source = (relative) =>
  JSON.stringify(path.join(root, relative).replaceAll("\\", "/"));
const lessons = [
  {
    unitId: "public-1",
    title: "조선의 문화",
    isVisibleToStudents: true,
    wordCount: 3,
    words: ["훈민정음", "집현전", "경국대전"],
  },
  {
    unitId: "public-2",
    title: "삼국의 발전과 통일",
    isVisibleToStudents: true,
    wordCount: 3,
    words: ["고구려", "백제", "신라"],
  },
  {
    unitId: "private-1",
    title: "다음 수업 준비 자료",
    isVisibleToStudents: false,
    wordCount: 3,
    words: ["고려", "발해", "거란"],
  },
];
const words = core.buildWords(
  lessons.flatMap((lesson) =>
    lesson.words.map((text) => ({
      text,
      unitId: lesson.unitId,
      lessonTitle: lesson.title,
    })),
  ),
  "opening-qa",
  "mild",
  core.DEFAULT_GAME_SETTINGS.difficulties.mild,
);
const mocks = {
  "qa-service": `
import {MENUS} from ${source("src/constants/menus.ts")};
const params=new URLSearchParams(location.search),teacher=params.has('teacher');
export const qa=window.openingQa={calls:[],writes:[],settings:${JSON.stringify({ ...core.DEFAULT_GAME_SETTINGS, enabled: true })}};
export const config={year:'2026',semester:'2',showLesson:true,showQuiz:true,showScore:true};
export const auth={currentUser:{uid:'opening-qa',email:teacher?'westoria28@gmail.com':'student@example.invalid',getIdTokenResult:async()=>({claims:{auth_time:Math.floor(Date.now()/1000)}})}};
const state={config,currentUser:auth.currentUser,userData:{uid:'opening-qa',role:teacher?'teacher':'student',teacherPortalEnabled:teacher,staffPermissions:[],name:'검증 계정',weplayGuideCompleted:!params.has('guide')},loading:false,authPhase:'ready',configReady:true,menuConfigReady:true,menuConfig:MENUS,settingsLoadedAt:Date.now(),refreshConfig:async()=>{},refreshMenuConfig:async()=>{},refreshInterfaceConfig:async()=>{},logout:async()=>{}};
export const useAuth=()=>state;
export const db={};
const lessons=${JSON.stringify(lessons)},policy=${JSON.stringify(core.DEFAULT_POLICY)};
const management=()=>({settings:structuredClone(qa.settings),lessons,availableWordCount:6,previewWordCount:9});
const session=(mode='practice')=>({id:'opening-qa-session',mode,difficulty:'mild',difficultySettings:qa.settings.difficulties.mild,policy,battleVersion:1,status:'active',startsAtMs:Date.now()+3000,endsAtMs:Date.now()+93000,serverNowMs:Date.now(),acceptedEvents:[],acceptedWordIds:[],correctCount:0,result:null,words:${JSON.stringify(words)}});
export const getHttpsCallable=async name=>async data=>{
 qa.calls.push({name,data});
 if(name==='getWeplayManagement')return {data:management()};
 if(name==='saveWeplayGameSettings'){qa.settings={...data.settings,version:qa.settings.version+1};qa.writes.push({name,data});return {data:management()};}
 if(name==='getWeplayLobby')return {data:{gameEnabled:true,policy,balance:34,dailyUsed:0,dailyRemaining:3,lessons,wordCount:6,difficulties:qa.settings.difficulties,challengeDifficulties:qa.settings.difficulties,activeSession:params.has('active')?session('challenge'):null,records:[],period:null,rankingByDifficulty:{mild:[],medium:[],spicy:[]},serverNowMs:Date.now()}};
 if(name==='previewWeplayGame'||name==='startWeplayGame')return {data:session(data?.mode)};
 throw new Error('Unexpected service call: '+name);
};
export const getYutLobby=async()=>{qa.calls.push({name:'getYutLobby'});return {enabled:true,room:null,classes:[{id:'qa-class',label:'1학년 1반'}],classId:'qa-class',serverNowMs:Date.now()}};
export const getYutManagement=async()=>{qa.calls.push({name:'getYutManagement'});return {settings:normalizeYutSettings(),rooms:[],truncated:false,serverNowMs:Date.now()}};
export const saveYutSettings=async()=>{throw new Error('Unexpected Yut settings write')};
export const commandYutRoom=async()=>{throw new Error('Unexpected Yut command')};
export const subscribeYutRoom=()=>()=>{};
export const subscribeYutManagement=(_config,onChange,_onError,onConnectionChange)=>{let active=true;queueMicrotask(()=>{if(active){onConnectionChange?.(true);onChange();}});return()=>{active=false;};};
export const yutErrorMessage=error=>error?.message||'다시 시도해 주세요.';
export const YUT_PRIVATE_DAILY_LIMIT=5;
export const normalizeYutSettings=value=>({enabled:true,version:1,allowSolo:true,allowMultiplayer:true,allowPrivateRooms:true,defaultPlayerCount:4,throwSeconds:5,moveSeconds:25,...(value||{})});
`,
  "qa-null": "export default ()=>null;",
  "qa-rank":
    "export const loadStudentRankPromotionSnapshot=async()=>({rank:null,wallet:{balance:0},policy:{rankPolicy:null}});export const invalidateStudentRankPromotionSnapshotCache=()=>{};",
  "qa-point-ranks": "export const getPointRankDefaultEmojiValue=()=>'';",
  "qa-archive":
    "export const isSemesterArchive=false;export const archiveScope=null;",
  "qa-boundary":
    "export const SemesterArchiveBanner=()=>null;export const SemesterArchiveUnavailable=()=>null;export const isArchiveUnavailableRoute=()=>false;",
  "qa-firestore":
    "export const doc=()=>({});export const getDoc=async()=>{throw new Error('Unexpected Firestore read')};export const getDocFromServer=getDoc;export const runTransaction=async()=>{throw new Error('Unexpected Firestore write')};export const serverTimestamp=()=>({});",
  "qa-session":
    "export {getHttpsCallable as getHistoryDictionaryCallable} from 'qa-service';",
};
const bundle = await build({
  stdin: {
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {HashRouter,useLocation,useNavigate} from 'react-router-dom';
import MainLayout from ${source("src/components/layout/MainLayout.tsx")};
import ManageWeplay from ${source("src/pages/teacher/ManageWeplay.tsx")};
import Weplay from ${source("src/pages/student/Weplay.tsx")};
import {AppToastProvider} from ${source("src/components/common/AppToastProvider.tsx")};
import {AppDialogProvider} from ${source("src/components/common/AppDialogProvider.tsx")};
import ${source("src/assets/index.css")};
import ${source("src/pages/teacher/teacherSettings.css")};
import {qa} from 'qa-service';
function Fixture(){const location=useLocation();qa.navigate=useNavigate();return <MainLayout>{location.pathname==='/teacher/weplay'?<ManageWeplay/>:location.pathname==='/student/weplay'?<Weplay/>:<h1>다른 화면</h1>}</MainLayout>}
const app=<HashRouter><AppToastProvider><AppDialogProvider><Fixture/></AppDialogProvider></AppToastProvider></HashRouter>;
createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('strict')?<React.StrictMode>{app}</React.StrictMode>:app);`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  metafile: true,
  outdir: path.join(os.tmpdir(), "westory-opening-qa"),
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: ["/assets/*"],
  loader: {
    ".svg": "dataurl",
    ".webp": "dataurl",
    ".png": "dataurl",
    ".woff2": "file",
    ".woff": "file",
  },
  assetNames: "qa-fonts/[name]-[hash]",
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      audioOnly ? "development" : "production",
    ),
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "offline-opening-services",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          const request = args.path.replaceAll("\\", "/");
          let id = request in mocks ? request : null;
          if (
            /contexts\/AuthContext$|lib\/(firebase|yut)$|^\.\/firebase$/.test(
              request,
            )
          )
            id = "qa-service";
          if (
            /(StudentHistoryDictionaryController|StudentRankPromotionController|TeacherPatchMemoController|NotificationBell|HeaderStudentWis)(\.tsx)?$/.test(
              request,
            )
          )
            id = "qa-null";
          if (/lib\/pointRankPromotion$/.test(request)) id = "qa-rank";
          if (/lib\/pointRanks$/.test(request)) id = "qa-point-ranks";
          if (/lib\/semesterArchive$/.test(request)) id = "qa-archive";
          if (/SemesterArchiveBoundary$/.test(request)) id = "qa-boundary";
          if (request === "firebase/firestore") id = "qa-firestore";
          if (/historyDictionarySession$/.test(request)) id = "qa-session";
          return id ? { path: id, namespace: "qa" } : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "qa" }, (args) => ({
          contents: mocks[args.path],
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
assert(
  !Object.keys(bundle.metafile.inputs).some((file) =>
    /node_modules[\\/](firebase|@firebase)[\\/]/.test(file),
  ),
  "No live Firebase SDK may enter this fixture",
);
const files = new Map(
  bundle.outputFiles.map((file) => [
    "/" +
      path
        .relative(path.join(os.tmpdir(), "westory-opening-qa"), file.path)
        .replaceAll("\\", "/"),
    file.contents,
  ]),
);
const js = bundle.outputFiles.find((file) =>
  file.path.endsWith(".js"),
).contents;
const css = (
  (await fs.readFile(path.join(root, "assets/css/style.css"), "utf8")) +
  bundle.outputFiles.find((file) => file.path.endsWith(".css")).text
).replace(/@import\s+[^;]+;/g, "");
const tailwind = await fs.readFile(
  path.join(os.tmpdir(), "westory-qa-tailwind.js"),
);
const html =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const contents =
      pathname === "/fixture.js"
        ? js
        : pathname === "/fixture.css"
          ? css
          : pathname === "/tailwind.js"
            ? tailwind
            : files.get(pathname);
    if (contents) {
      response.setHeader(
        "Content-Type",
        pathname.endsWith(".css")
          ? "text/css"
          : pathname.endsWith(".js")
            ? "text/javascript"
            : "application/octet-stream",
      );
      return response.end(contents);
    }
    if (pathname.startsWith("/assets/")) {
      const target = path.resolve(root, "public", "." + pathname);
      assert(target.startsWith(path.join(root, "public") + path.sep));
      return response.end(await fs.readFile(target));
    }
    response.setHeader("Content-Type", "text/html;charset=utf-8");
    response.end(html);
  } catch (error) {
    response.statusCode = 500;
    response.end(error.message);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
  args: audioOnly
    ? ["--autoplay-policy=document-user-activation-required"]
    : [],
});
const errors = [],
  externalRequests = [],
  checks = [],
  screenshots = [],
  geometry = [],
  linkedFrames = [],
  diagnostics = [];
let failure;
async function openAudio(route, extra = "") {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(message.text());
  });
  await page.route("**/*", (request) => {
    if (request.request().url().startsWith(origin)) return request.continue();
    externalRequests.push(request.request().url());
    return request.abort();
  });
  await page.addInitScript(() => {
    const qa = (window.audioQa = { contexts: [], voices: [], players: [] });
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) {
        super(...args);
        qa.contexts.push(this);
      }
      createBufferSource() {
        const source = super.createBufferSource(),
          record = {
            context: this,
            source,
            starts: [],
            stops: [],
            ended: false,
          };
        qa.voices.push(record);
        const start = source.start.bind(source),
          stop = source.stop.bind(source);
        source.start = (...args) => {
          record.starts.push(args);
          return start(...args);
        };
        source.stop = (...args) => {
          record.stops.push(args);
          return stop(...args);
        };
        source.addEventListener("ended", () => {
          record.ended = true;
        });
        return source;
      }
    };
    const NativeAudio = window.Audio;
    window.Audio = function (...args) {
      const player = new NativeAudio(...args);
      qa.players.push(player);
      return player;
    };
    window.Audio.prototype = NativeAudio.prototype;
    Object.setPrototypeOf(window.Audio, NativeAudio);
  });
  await page.goto(
    `${origin}/?${route.startsWith("/teacher") ? "teacher&" : ""}${extra}#${route}`,
  );
  await page.locator(".teacher-layout,.student-layout").waitFor();
  return page;
}
const audioState = (page) =>
  page.evaluate(() => ({
    states: window.audioQa.contexts.map((context) => context.state),
    voices: window.audioQa.voices.map((voice) => ({
      offset: voice.starts[0]?.[1],
      stopped: voice.stops.length > 0,
      ended: voice.ended,
    })),
    players: window.audioQa.players.map((player) => ({
      paused: player.paused,
      src: player.src,
    })),
  }));
async function verifyAudioBrowser() {
  for (const [route, entry] of [
    ["/student/weplay", "catalog"],
    ["/teacher/weplay?game=history-rain", "preview"],
  ]) {
    const page = await openAudio(route);
    if (entry === "catalog")
      await page.locator('a.weplay-game-card[href*="history-rain"]').click();
    else
      await page.getByRole("button", { name: "체험하기", exact: true }).click();
    await page.waitForFunction(() =>
      window.audioQa.voices.some((voice) => voice.starts.length > 0),
    );
    let state = await audioState(page);
    assert.equal(
      state.states.length,
      1,
      "Entry click's prepared context must be reused",
    );
    assert.equal(state.states[0], "running");
    assert(state.voices[0].offset < 0.5, JSON.stringify(state));
    await page.getByRole("button", { name: "소리 끄기", exact: true }).click();
    await page.waitForFunction(() =>
      window.audioQa.voices.every((voice) => voice.stops.length > 0),
    );
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "소리 켜기", exact: true }).click();
    await page.waitForFunction(() => window.audioQa.voices.length >= 2);
    state = await audioState(page);
    assert(state.voices.at(-1).offset > state.voices[0].offset + 0.1);
    await capture(page, "audio-" + entry + "-audible");
    await page.getByRole("button", { name: /건너뛰기/ }).click();
    await page.waitForFunction(() =>
      window.audioQa.contexts.every((context) => context.state === "closed"),
    );
    assert.equal(
      (await audioState(page)).players.length,
      0,
      "Opening sound must not opt the user into background music",
    );
    await page.close();
  }
  checks.push(
    "Real AudioContext: student catalogue and teacher preview clicks reuse their unlocked context; mute/unmute resumes at the current offset; skip closes it and does not start previously-off BGM.",
  );
  for (const gesture of ["pointer", "space"]) {
    const page = await openAudio("/student/weplay?game=history-rain");
    await page.locator(".weplay-studio-intro").waitFor();
    await page.waitForTimeout(350);
    const initial = await audioState(page);
    assert(
      initial.states.every((state) => state === "suspended"),
      JSON.stringify(initial),
    );
    assert.equal(initial.voices.length, 0, "Blocked direct entry stays silent");
    const sound = page.getByRole("button", { name: "소리 켜기", exact: true });
    if (gesture === "pointer") {
      const box = await sound.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(150);
      assert.equal(
        (await audioState(page)).voices.length,
        0,
        "Pointer hold must not preempt the enable click",
      );
      await page.mouse.up();
    } else {
      await sound.focus();
      await page.keyboard.down("Space");
      await page.waitForTimeout(150);
      assert.equal(
        (await audioState(page)).voices.length,
        0,
        "Space hold must not preempt the enable click",
      );
      await page.keyboard.up("Space");
    }
    await page.waitForFunction(() =>
      window.audioQa.voices.some((voice) => voice.starts.length),
    );
    const state = await audioState(page);
    assert(
      state.voices[0].offset > 0.35 && state.voices[0].offset < 2.5,
      JSON.stringify(state),
    );
    assert.equal(
      await page
        .getByRole("button", { name: "소리 끄기", exact: true })
        .count(),
      1,
    );
    await page.getByRole("button", { name: /건너뛰기/ }).click();
    await page.waitForFunction(() =>
      window.audioQa.contexts.every((context) => context.state === "closed"),
    );
    await page.close();
  }
  checks.push(
    "Autoplay-blocked direct entry stays silent; 150ms pointer and Space holds on Enable Sound remain silent until click/release, then start at the current visual offset without toggling back to mute.",
  );
  const visibility = await openAudio("/student/weplay");
  await visibility.locator('a.weplay-game-card[href*="history-rain"]').click();
  await visibility.waitForFunction(() => window.audioQa.voices.length === 1);
  await visibility.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await visibility.waitForFunction(
    () => window.audioQa.voices[0].stops.length > 0,
  );
  await visibility.waitForTimeout(100);
  await visibility.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await visibility.waitForFunction(() => window.audioQa.voices.length === 2);
  await visibility.evaluate(() => {
    document.body.style.paddingBottom = "1800px";
    window.scrollTo(0, 1800);
  });
  await visibility.waitForFunction(
    () => window.audioQa.voices[1].stops.length > 0,
  );
  await visibility.waitForTimeout(100);
  await visibility.evaluate(() => window.scrollTo(0, 0));
  await visibility.waitForFunction(() => window.audioQa.voices.length === 3);
  await visibility
    .getByRole("link", { name: "전체 게임", exact: true })
    .click();
  await visibility.waitForFunction(() =>
    window.audioQa.contexts.every((context) => context.state === "closed"),
  );
  await visibility.close();
  checks.push(
    "Real sources stop on simulated document visibility loss and actual IntersectionObserver offscreen scrolling, resume with the visual clock, and close on route unmount.",
  );
  const bgm = await openAudio("/teacher/weplay?game=history-rain");
  await bgm.getByRole("button", { name: "소리 켜기", exact: true }).click();
  await bgm.waitForFunction(() =>
    window.audioQa.players.some((player) => !player.paused),
  );
  await bgm.getByRole("button", { name: "체험하기", exact: true }).click();
  await bgm.waitForFunction(() =>
    window.audioQa.voices.some((voice) => voice.starts.length),
  );
  assert((await audioState(bgm)).players.every((player) => player.paused));
  await bgm.getByRole("button", { name: /건너뛰기/ }).click();
  await bgm.waitForFunction(() =>
    window.audioQa.players.some((player) => !player.paused),
  );
  assert.equal((await audioState(bgm)).players.length, 1);
  await bgm.close();
  checks.push(
    "An already-enabled BGM pauses under the sonic logo and resumes through the same audio element after completion; previously-off BGM remains off.",
  );
  const strict = await openAudio("/student/weplay", "strict");
  await strict.locator('a.weplay-game-card[href*="history-rain"]').click();
  await strict.waitForFunction(() =>
    window.audioQa.voices.some((voice) => voice.starts.length),
  );
  await strict.getByRole("link", { name: "전체 게임", exact: true }).click();
  await strict.locator('a.weplay-game-card[href*="history-rain"]').click();
  await strict.waitForTimeout(120);
  const active = await strict.evaluate(
    () =>
      window.audioQa.voices.filter(
        (voice) => voice.starts.length && !voice.stops.length && !voice.ended,
      ).length,
  );
  assert.equal(
    active,
    1,
    "Development StrictMode and rapid remount leave exactly one source playing",
  );
  await strict.getByRole("button", { name: /건너뛰기/ }).click();
  await strict.waitForFunction(() =>
    window.audioQa.contexts.every((context) => context.state === "closed"),
  );
  await strict.close();
  checks.push(
    "Real React development StrictMode setup/cleanup and rapid route remount keep one active source and close every retired context.",
  );
}
async function open(
  route,
  width = 1280,
  extra = "",
  reducedMotion = "no-preference",
) {
  const page = await browser.newPage({
    viewport: { width, height: width === 1366 ? 768 : 900 },
    reducedMotion,
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(message.text());
  });
  await page.route("**/*", (request) => {
    if (request.request().url().startsWith(origin)) return request.continue();
    externalRequests.push(request.request().url());
    return request.abort();
  });
  await page.clock.install({ time: new Date("2026-10-18T02:00:00Z") });
  // Advance before loading the fixture; pausing at installation time can race
  // the few real milliseconds spent setting up Playwright's clock.
  await page.clock.pauseAt(new Date("2026-10-18T02:00:10Z"));
  await page.goto(
    `${origin}/?${route.startsWith("/teacher") ? "teacher&" : ""}${extra}#${route}`,
  );
  await page.clock.runFor(100);
  await page.locator(".teacher-layout,.student-layout").waitFor();
  return page;
}
async function capture(page, name) {
  await page.screenshot({
    path: path.join(evidence, name + ".png"),
    fullPage: true,
  });
  screenshots.push(name + ".png");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    name + " horizontal page overflow",
  );
}
async function headerOrder(page, expectManage = false) {
  const value = await page.evaluate(() => {
    const music = document.querySelector(".weplay-music-button");
    if (!music) return null;
    const box = (element) => {
      const r = element.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        right: r.right,
      };
    };
    const group = music.parentElement;
    const links = [...group.querySelectorAll("a")].filter((element) =>
      /전체 게임|게임 관리/.test(element.textContent),
    );
    return {
      music: box(music),
      links: links.map((element) => ({
        text: element.textContent.trim(),
        ...box(element),
      })),
      preceding: music.previousElementSibling?.textContent.trim(),
    };
  });
  assert(value, "music button exists in the page heading");
  assert.deepEqual(
    value.links.map((link) => link.text),
    expectManage ? ["전체 게임", "게임 관리"] : ["전체 게임"],
  );
  for (const link of value.links) {
    assert(link.right <= value.music.x + 1, JSON.stringify(value));
    assert(Math.abs(link.y - value.music.y) <= 4, JSON.stringify(value));
  }
  assert.match(value.preceding, expectManage ? /게임 관리/ : /전체 게임/);
  assert.equal(
    await page.getByRole("link", { name: "위스 설정", exact: true }).count(),
    0,
  );
}
async function introSample(page) {
  return page.locator(".weplay-studio-intro").evaluate((element) => {
    const westory = element.querySelector(".weplay-studio-intro__westory"),
      weplay = element.querySelector(".weplay-studio-intro__weplay");
    const sample = (node) => ({
      opacity: Number(getComputedStyle(node).opacity),
      transform: getComputedStyle(node).transform,
    });
    return {
      phase: element.dataset.phase,
      westory: sample(westory),
      weplay: sample(weplay),
      paths: [...element.querySelectorAll("svg path")].map((node) =>
        node.getAttribute("d"),
      ),
    };
  });
}
async function verifyLinkedIntro() {
  for (const width of [390, 768, 1280, 1366]) {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const page = await open(
        "/student/weplay?game=history-rain",
        width,
        "",
        reducedMotion,
      );
      await page.locator("[data-intro-point]").waitFor();
      await page
        .locator(".weplay-studio-intro__westory")
        .evaluate((image) => image.decode());
      await page.clock.runFor(500);
      await page.evaluate(() => {
        const intro = document.querySelector(".weplay-studio-intro");
        const dot = intro.querySelector("[data-intro-point]");
        const prefix = intro.querySelector(".weplay-studio-intro__prefix");
        const svg = dot.ownerSVGElement;
        const opacity = (element) => {
          let value = 1;
          for (
            let node = element;
            node && node !== intro.parentElement;
            node = node.parentElement
          ) {
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden")
              return 0;
            value *= Number(style.opacity);
          }
          return value;
        };
        const start = performance.now();
        const samples = (window.linkedIntroQa = []);
        const captureFrame = (now) => {
          if (!intro.isConnected) return;
          const currentDot = intro.querySelector("[data-intro-point]");
          const currentPrefix = intro.querySelector(
            ".weplay-studio-intro__prefix",
          );
          const center = new DOMPoint(
            currentDot.cx.baseVal.value,
            currentDot.cy.baseVal.value,
          )
            .matrixTransform(currentDot.getScreenCTM())
            .matrixTransform(svg.getScreenCTM().inverse());
          const rect = intro
            .querySelector(".weplay-studio-intro__wordmarks")
            .getBoundingClientRect();
          const story = intro.querySelector(".weplay-studio-intro__westory");
          const play = intro.querySelector(".weplay-studio-intro__weplay");
          samples.push({
            time: now - start,
            sameDot: currentDot === dot,
            dotCount: intro.querySelectorAll("[data-intro-point]").length,
            x: center.x,
            y: center.y,
            radius: currentDot.r.baseVal.value,
            dotOpacity: opacity(currentDot),
            samePrefix: currentPrefix === prefix,
            prefixCount: intro.querySelectorAll(".weplay-studio-intro__prefix")
              .length,
            prefixText: currentPrefix.textContent,
            wordmarkBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            prefixOpacity: opacity(currentPrefix),
            story: {
              tagName: story.tagName,
              complete: story.complete && story.naturalWidth > 0,
              aspectRatio: story.naturalWidth / story.naturalHeight,
              renderedRatio:
                story.getBoundingClientRect().width /
                story.getBoundingClientRect().height,
              opacity: opacity(story),
              transform: getComputedStyle(story).transform,
            },
            play: {
              text: play.textContent,
              opacity: opacity(play),
              transform: getComputedStyle(play).transform,
            },
            secondaryRadius: intro.querySelector(
              "[data-intro-secondary-button]",
            ).r.baseVal.value,
          });
          if (now - start < 1800) requestAnimationFrame(captureFrame);
        };
        requestAnimationFrame(captureFrame);
      });
      await page.clock.runFor(700);
      await capture(page, `linked-${width}-${reducedMotion}-departure`);
      await page.clock.runFor(350);
      await capture(page, `linked-${width}-${reducedMotion}-middle`);
      await page.clock.runFor(650);
      await capture(page, `linked-${width}-${reducedMotion}-landing`);
      const samples = await page.evaluate(() => window.linkedIntroQa);
      assert(
        samples.length >= 80,
        "Continuous frame sampling must cover the transfer",
      );
      const first = samples[0],
        last = samples.at(-1);
      let maximumStep = 0,
        maximumSpeed = 0;
      for (const [index, sample] of samples.entries()) {
        assert(
          sample.sameDot && sample.dotCount === 1,
          "One identical circle must survive the entire transfer",
        );
        assert(sample.dotOpacity > 0.99, JSON.stringify(sample));
        assert(
          sample.samePrefix &&
            sample.prefixCount === 1 &&
            sample.prefixText === "We",
        );
        for (const key of ["x", "y", "width", "height"])
          assert(
            Math.abs(sample.wordmarkBox[key] - first.wordmarkBox[key]) < 0.1,
            "The logo transition must not shift its layout: " +
              JSON.stringify(sample),
          );
        assert.equal(sample.story.tagName, "IMG");
        assert(sample.story.complete, "The supplied Westory logo must decode");
        assert(
          Math.abs(sample.story.renderedRatio - sample.story.aspectRatio) <
            0.01,
          "The supplied logo must keep its original proportions",
        );
        assert.equal(sample.play.text, "Weplay");
        assert.equal(sample.prefixOpacity, sample.play.opacity);
        if (index) {
          const previous = samples[index - 1];
          const step = Math.hypot(sample.x - previous.x, sample.y - previous.y);
          maximumStep = Math.max(maximumStep, step);
          maximumSpeed = Math.max(
            maximumSpeed,
            step / (sample.time - previous.time),
          );
          assert(
            step < 10 && step / (sample.time - previous.time) < 0.6,
            "The dot must not jump between consecutive frames",
          );
          assert(sample.story.opacity <= previous.story.opacity + 0.001);
          assert(sample.play.opacity >= previous.play.opacity - 0.001);
        }
      }
      assert(
        Math.abs(Math.hypot(first.x - 180, first.y - 180) - 148) < 0.1,
        "The same dot starts on the globe orbit",
      );
      assert(
        Math.abs(last.x - 233) < 0.01 &&
          Math.abs(last.y - 166) < 0.01 &&
          Math.abs(last.radius - 8) < 0.01,
        JSON.stringify(last),
      );
      assert(first.story.opacity > 0.99 && first.play.opacity < 0.01);
      assert(last.story.opacity < 0.01 && last.play.opacity > 0.99);
      assert(
        samples.some(
          (sample) =>
            sample.story.opacity > 0.1 &&
            sample.story.opacity < 0.9 &&
            sample.play.opacity < 0.01,
        ),
        "story fades before play appears",
      );
      assert(
        samples.some(
          (sample) =>
            sample.story.opacity < 0.01 &&
            sample.play.opacity > 0.1 &&
            sample.play.opacity < 0.9,
        ),
        "play rises after story leaves",
      );
      assert.equal(first.secondaryRadius, 0);
      assert(Math.abs(last.secondaryRadius - 8) < 0.01);
      linkedFrames.push({
        width,
        reducedMotion,
        maximumStep,
        maximumSpeed,
        samples,
      });
      await page.getByRole("button", { name: /건너뛰기/ }).click();
      await page.close();
    }
  }
  checks.push(
    "390/768/1280/1366px normal/reduced motion: the identical fully-visible orbit dot travels continuously to (233,166), radius 8; the supplied Westory image retains its proportions and its stage stays fixed while it fades into Weplay; the secondary button appears afterward.",
  );
}
async function verifyOpeningLayout() {
  for (const width of [390, 768, 1280, 1366, 1440, 1920]) {
    const page = await open("/teacher/weplay?game=history-rain", width);
    await page
      .getByRole("heading", { name: "게임 운영", exact: true })
      .waitFor();
    await headerOrder(page);
    const layout = await page.evaluate(() => {
      const box = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          right: r.right,
        };
      };
      return {
        width: innerWidth,
        settings: box(".teacher-weplay-settings-column"),
        preview: box(".teacher-weplay-preview-controls"),
        table: box(".teacher-weplay-settings-table"),
      };
    });
    geometry.push(layout);
    if (width >= 1280) {
      assert(
        Math.abs(layout.settings.y - layout.preview.y) <= 1,
        JSON.stringify(layout),
      );
      assert(layout.settings.right <= layout.preview.x, JSON.stringify(layout));
      assert(
        layout.table.width <= (layout.preview.right - layout.settings.x) * 0.7,
        JSON.stringify(layout),
      );
      assert(
        layout.preview.y < 350,
        "Teacher preview must start near the top on PC",
      );
    }
    if (width === 1366) {
      for (const control of [
        page.getByRole("button", { name: "게임 설정 저장", exact: true }),
        page.getByRole("button", { name: "체험하기", exact: true }),
        page.getByRole("spinbutton", {
          name: "매운맛 최대 단어 길이",
          exact: true,
        }),
      ]) {
        const box = await control.boundingBox();
        assert(
          box.y >= 0 && box.y + box.height <= 768,
          "Main controls and final difficulty input must fit the 1366x768 first viewport",
        );
      }
    }
    assert.equal(await page.getByRole("spinbutton").count(), 18);
    await page
      .getByRole("spinbutton", { name: "착한맛 전체 제한시간", exact: true })
      .fill("120");
    assert.equal(
      await page
        .getByRole("button", { name: "게임 설정 저장", exact: true })
        .isEnabled(),
      true,
    );
    await capture(page, "management-" + width);
    assert.equal(await page.evaluate(() => window.openingQa.writes.length), 0);
    await page.close();
  }
  checks.push(
    "Teacher management at 390/768/1280/1366/1440/1920px: 18 labeled inputs, bounded table, desktop operation/preview start on one row, heading actions precede mute, no page overflow or writes.",
  );

  for (const [route, label] of [
    ["/student/weplay?game=history-rain", "student-naval"],
    ["/teacher/weplay?game=history-rain&view=preview", "teacher-naval"],
    ["/student/weplay?game=joseon-yut", "student-yut"],
    ["/teacher/weplay?game=joseon-yut&view=preview", "teacher-yut"],
  ]) {
    for (const reduced of ["no-preference", "reduce"]) {
      const page = await open(route, 1280, "", reduced);
      const intro = page.locator(".weplay-studio-intro");
      await intro.waitFor();
      assert.equal(
        await intro.evaluate((element) => element.tagName),
        "SECTION",
      );
      assert.equal(await page.locator("dialog:modal").count(), 0);
      const containment = await intro.evaluate((element) => {
        const r = element.getBoundingClientRect(),
          main = element.closest("main"),
          m = main?.getBoundingClientRect();
        return {
          position: getComputedStyle(element).position,
          main: !!main,
          left: r.left,
          right: r.right,
          top: r.top,
          mainLeft: m?.left,
          mainRight: m?.right,
          width: innerWidth,
        };
      });
      assert(containment.main, JSON.stringify(containment));
      assert.notEqual(containment.position, "fixed");
      assert(
        containment.left >= containment.mainLeft &&
          containment.right <= containment.mainRight + 1,
        JSON.stringify(containment),
      );
      assert(
        containment.left > 0 && containment.top > 0,
        JSON.stringify(containment),
      );
      await page.clock.runFor(400);
      const first = await introSample(page);
      assert.equal(first.phase, "westory");
      assert(
        first.westory.opacity > 0.5 && first.weplay.opacity < 0.1,
        JSON.stringify(first),
      );
      await capture(page, `${label}-${reduced}-westory`);
      await page.clock.runFor(400);
      const moved = await introSample(page);
      assert.notDeepEqual(
        first.paths,
        moved.paths,
        "Globe SVG geometry must rotate, including reduced motion",
      );
      await page.clock.runFor(1500);
      const second = await introSample(page);
      assert.equal(second.phase, "weplay");
      assert(
        second.weplay.opacity > 0.5 && second.westory.opacity < 0.1,
        JSON.stringify(second),
      );
      await capture(page, `${label}-${reduced}-weplay`);
      const sidebar = page.locator(".teacher-sidebar-collapse");
      const before = await sidebar.getAttribute("aria-expanded");
      await sidebar.click();
      assert.notEqual(
        await sidebar.getAttribute("aria-expanded"),
        before,
        "Site navigation remains usable during opening",
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await intro.count(),
        1,
        "Escape outside the opening does not dismiss it",
      );
      await intro.getByRole("button", { name: /건너뛰기/ }).press("Escape");
      await intro.waitFor({ state: "detached" });
      if (label.endsWith("naval"))
        await headerOrder(page, label.startsWith("teacher"));
      else {
        await page.locator(".yut-game").waitFor();
        assert.equal(
          await page.locator(".weplay-yut-page .weplay-game-frame .yut-game").count(),
          1,
        );
        assert.equal(await page.locator(".weplay-page .yut-game").count(), 0);
        assert((await page.locator(".yut-game").boundingBox()).width < 1280);
        const music = page.getByRole("button", {
          name: /음악 켜기|음악 끄기/,
        });
        assert.equal(
          await music.evaluate((element) =>
            element.previousElementSibling?.getAttribute("aria-label"),
          ),
          label.startsWith("teacher") ? "방 나가기" : "전체 게임",
        );
        await capture(page, `${label}-${reduced}-game`);
      }
      const calls = await page.evaluate(() =>
        window.openingQa.calls.map((call) => call.name),
      );
      assert(
        !calls.some((name) =>
          /startWeplayGame|previewWeplayGame|completeWeplayGuide/.test(name),
        ),
        JSON.stringify(calls),
      );
      await page.close();
    }
  }
  checks.push(
    "Actual student/teacher naval and Yut entry, normal/reduced motion: Westory then Weplay, changing globe SVG, inline section containment, live navigation, local Escape skip, no paid/start/guide writes.",
  );

  for (const [route, label] of [
    ["/student/weplay?game=history-rain", "student"],
    ["/teacher/weplay?game=history-rain&view=preview", "teacher"],
  ]) {
    const page = await open(route, 768, "guide");
    await page.locator(".weplay-studio-intro").waitFor();
    assert.equal(
      await page.locator("dialog:modal").count(),
      0,
      "Guide must not open over the opening",
    );
    await page.clock.runFor(2500);
    assert.equal(await page.locator("dialog:modal").count(), 0);
    await page.clock.runFor(1300);
    await page.locator(".weplay-studio-intro").waitFor({ state: "detached" });
    await page.getByRole("dialog").waitFor();
    await capture(page, label + "-guide-after-opening");
    assert.equal(await page.evaluate(() => window.openingQa.writes.length), 0);
    await page.close();
  }
  checks.push(
    "First-use guide opens only after the full opening has naturally completed in both naval portals.",
  );

  const active = await open(
    "/student/weplay?game=history-rain",
    1280,
    "active",
  );
  await active.locator(".naval-game").waitFor();
  assert.equal(await active.locator(".weplay-studio-intro").count(), 0);
  assert.deepEqual(
    await active.evaluate(() =>
      window.openingQa.calls.map((call) => call.name),
    ),
    ["getWeplayLobby"],
  );
  await capture(active, "restored-paid-session");
  await active.close();
  checks.push(
    "A restored active challenge session immediately shows the running game with no opening delay or duplicate start request.",
  );

  for (const width of [390, 768]) {
    const page = await open("/student/weplay?game=history-rain", width);
    await page.locator(".weplay-studio-intro").waitFor();
    await page.clock.runFor(500);
    await capture(page, "student-opening-" + width);
    await page.getByRole("button", { name: /건너뛰기/ }).click();
    await page.locator(".weplay-start").waitFor();
    await capture(page, "student-lobby-" + width);
    await page.close();
  }
  checks.push(
    "390/768px student opening/lobby remain within the document width and support pointer skip.",
  );
  for (const width of [390, 768]) {
    const page = await open("/student/weplay?game=joseon-yut", width);
    await page.locator(".weplay-studio-intro").waitFor();
    await page.getByRole("button", { name: /건너뛰기/ }).click();
    await page.locator(".yut-orientation-gate").waitFor();
    assert.equal(
      await page.getByRole("button", { name: /혼자서 시작/ }).count(),
      0,
    );
    await capture(page, "student-yut-portrait-" + width);
    const callsBeforeRotation = await page.evaluate(() =>
      window.openingQa.calls.map((call) => call.name),
    );
    await page.setViewportSize({
      width: width === 390 ? 844 : 1024,
      height: width === 390 ? 390 : 768,
    });
    await page.clock.runFor(50);
    await page.getByRole("button", { name: /혼자서 시작/ }).waitFor();
    assert.equal(await page.locator(".yut-orientation-gate").count(), 0);
    assert.equal(await page.locator(".weplay-yut-page .weplay-game-frame .yut-game").count(), 1);
    await capture(page, "student-yut-landscape-" + width);
    assert.deepEqual(
      await page.evaluate(() =>
        window.openingQa.calls.map((call) => call.name),
      ),
      callsBeforeRotation,
    );
    await page.close();
  }
  checks.push(
    "Merged Yut under the real portal layout retains the game-specific wrapper and 1360px bound; portrait 390/768 gates entry, and landscape rotation restores the lobby without duplicate reads/writes or page overflow.",
  );
  await verifyLinkedIntro();
}
async function verifyCommonGameFrame() {
  for (const width of [320, 390, 768, 1280, 1366, 1920]) {
    for (const portal of ["student", "teacher"]) {
      const bounds = [];
      for (const game of ["history-rain", "joseon-yut"]) {
        const page = await open(`/${portal}/weplay?game=${game}${portal === "teacher" ? "&view=preview" : ""}`, width);
        const frame = page.locator('.weplay-game-frame');
        await page.locator('.weplay-studio-intro').waitFor();
        const opening = await frame.boundingBox();
        assert(opening.x >= 16 && opening.x + opening.width <= width - 15, 'Game stage must keep page gutters');
        const intro = await page.locator('.weplay-studio-intro').boundingBox();
        assert(Math.abs(intro.width-opening.width)<2 && Math.abs(intro.height-opening.height)<2);
        await page.getByRole('button',{name:/건너뛰기/}).click();
        await page.clock.runFor(100);
        await page.locator(game === 'joseon-yut' ? '.yut-game' : '.weplay-launch').waitFor();
        const lobby = await frame.boundingBox();
        assert.equal(lobby.width, opening.width); assert.equal(lobby.height, opening.height);
        const inner = await page.locator(game === 'joseon-yut' ? '.yut-game' : '.weplay-launch').boundingBox();
        assert(Math.abs(inner.width-opening.width)<2, JSON.stringify({game,inner,opening}));
        if(game === 'history-rain') {
          await page.getByRole('region',{name:'게임 대기 화면',exact:true}).waitFor();
          await page.locator('.weplay-launch-art > img').evaluate(image=>image.decode());
          assert.equal(await page.locator('.weplay-launch-art > img').evaluate(image=>image.naturalWidth===1672 && image.naturalHeight===941 && image.src.includes('lobby-yi-sunsin.webp')),true);
          assert.equal(await page.getByRole('heading',{name:'대기 화면 미리보기',exact:true}).count(),0);
          if(portal==='teacher') assert.equal(await page.locator('.teacher-weplay-preview > .teacher-weplay-section-title').count(),0,'Removing the preview title also removes its row');
          const menu = await page.locator('.weplay-launch-controls').boundingBox();
          assert(menu.x>=inner.x-1 && menu.y>=inner.y-1 && menu.x+menu.width<=inner.x+inner.width+1 && menu.y+menu.height<=inner.y+inner.height+1,JSON.stringify({portal,width,inner,menu}));
          const controls = await page.locator('.weplay-launch button').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return {label:button.getAttribute('aria-label')||button.textContent,x:r.x,y:r.y,width:r.width,height:r.height};}));
          assert(controls.every(control=>control.width>=44 && control.height>=44 && control.x>=inner.x-1 && control.y>=inner.y-1 && control.x+control.width<=inner.x+inner.width+1 && control.y+control.height<=inner.y+inner.height+1),JSON.stringify({portal,width,inner,controls}));
          assert.equal(await page.getByRole('button',{name:'깃 움직임 멈추기',exact:true}).count(),1);
          const controlPlacement = await page.locator('.weplay-launch').evaluate(element=>{
            const image=element.querySelector('.weplay-launch-art > img'), imageBox=image.getBoundingClientRect(), scale=Math.max(imageBox.width/image.naturalWidth,imageBox.height/image.naturalHeight);
            const pause=element.querySelector('.weplay-lobby-motion').getBoundingClientRect();
            const crest={left:imageBox.left+400*scale,right:imageBox.left+480*scale,top:imageBox.top,bottom:imageBox.top+180*scale};
            const overlaps=(a,b)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);
            return {helmetClear:!overlaps(pause,crest),recordsClear:[...element.querySelectorAll('.weplay-lobby-actions button')].every(button=>!overlaps(pause,button.getBoundingClientRect()))};
          });
          assert(controlPlacement.helmetClear && controlPlacement.recordsClear,JSON.stringify({portal,width,controlPlacement}));
          if(width===320 || width===390) {
            const actions = await page.locator('.weplay-launch-actions').boundingBox();
            assert(actions.y+actions.height<=menu.y,JSON.stringify({portal,width,actions,menu}));
            await capture(page,`frame-${portal}-${game}-${width}-lobby`);
          }
        }
        if(game === 'joseon-yut') await page.waitForFunction(()=>document.fonts.check('400 120px "Yut Brush"','도개걸윷모!'));
        if(game === 'joseon-yut' && width >= 1280) {
          if(portal === 'student') await page.getByRole('button',{name:/혼자서 시작/}).click();
          else await page.getByRole('button',{name:'윷판 펼치기',exact:true}).click();
          await page.clock.runFor(2500);
          await page.getByRole('button',{name:'윷 던지기',exact:true}).click();
          await page.clock.runFor(2300);
          await page.evaluate(()=>document.fonts.ready);
          await page.clock.runFor(400);
          const brush = await page.locator('.yut-landing-result strong').evaluate(el=>({font:getComputedStyle(el).fontFamily,loaded:document.fonts.check('120px "Yut Brush"','도개걸윷모')}));
          assert(brush.font.includes('Yut Brush') && brush.loaded, JSON.stringify(brush));
          await capture(page,`frame-${portal}-${game}-${width}-brush`);
          await page.clock.runFor(1500);
          const gameBox = await page.locator('.yut-game').boundingBox();
          assert.equal(gameBox.height,opening.height);
        } else if(game === 'history-rain' && width >= 1280) {
          await page.getByRole('button',{name:portal === 'teacher' ? '연습 체험 시작' : '연습 시작',exact:true}).click();
          await page.clock.runFor(100);
          await page.locator('.naval-scene').waitFor();
          assert.equal((await frame.boundingBox()).height,opening.height);
        }
        await capture(page,`frame-${portal}-${game}-${width}`);
        geometry.push({portal,game,width,opening,lobby}); bounds.push(opening);
        await page.close();
      }
      assert(Math.abs(bounds[0].width-bounds[1].width)<2, JSON.stringify({portal,width,bounds}));
      assert.equal(bounds[0].height,bounds[1].height);
    }
  }
  checks.push('Both portals: naval/Yut share stage width, height and page gutters at320/390/768/1280/1366/1920, including late-loaded settings styles; the new 44px plume control and wrapped lobby actions stay inside the stage and above the menu; opening/lobby/play keep the same viewport; brush font loads before the first throw.');
}
try {
  if (audioOnly) await verifyAudioBrowser();
  else if(frameOnly) await verifyCommonGameFrame();
  else if(introOnly) await verifyLinkedIntro();
  else await verifyOpeningLayout();
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
} catch (error) {
  failure = error.stack || String(error);
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .at(-1);
  if (page) {
    diagnostics.push(await page.locator("body").innerHTML());
    await page
      .screenshot({
        path: path.join(evidence, "failure-current.png"),
        fullPage: true,
      })
      .catch(() => {});
  }
} finally {
  await fs.writeFile(
    path.join(
      evidence,
      audioOnly ? "audio-browser-results.json" : "opening-layout-results.json",
    ),
    JSON.stringify(
      {
        status: failure ? "failed" : "passed",
        failure,
        checks,
        screenshots,
        geometry,
        linkedFrames,
        errors,
        externalRequests,
        diagnostics,
      },
      null,
      2,
    ),
  );
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
if (failure) throw new Error(failure);
console.log(JSON.stringify({ status: "passed", checks, evidence }, null, 2));
