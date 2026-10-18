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
const evidence = path.resolve(
  process.env.WEPLAY_QA_EVIDENCE_DIR ||
    path.join(root, "output/weplay-opening-layout-20261018"),
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
export const qa=window.openingQa={calls:[],writes:[],settings:${JSON.stringify(core.DEFAULT_GAME_SETTINGS)}};
export const config={year:'2026',semester:'2',showLesson:true,showQuiz:true,showScore:true};
export const auth={currentUser:{uid:'opening-qa',email:teacher?'westoria28@gmail.com':'student@example.invalid'}};
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
export const getYutLobby=async()=>{qa.calls.push({name:'getYutLobby'});return {room:null,classes:[{id:'qa-class',label:'1학년 1반'}],classId:'qa-class',serverNowMs:Date.now()}};
export const commandYutRoom=async()=>{throw new Error('Unexpected Yut command')};
export const subscribeYutRoom=()=>()=>{};
export const yutErrorMessage=error=>error?.message||'다시 시도해 주세요.';
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
import {qa} from 'qa-service';
function Fixture(){const location=useLocation();qa.navigate=useNavigate();return <MainLayout>{location.pathname==='/teacher/weplay'?<ManageWeplay/>:location.pathname==='/student/weplay'?<Weplay/>:<h1>다른 화면</h1>}</MainLayout>}
createRoot(document.getElementById('root')).render(<HashRouter><AppToastProvider><AppDialogProvider><Fixture/></AppDialogProvider></AppToastProvider></HashRouter>);`,
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
    "process.env.NODE_ENV": '"production"',
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
});
const errors = [],
  externalRequests = [],
  checks = [],
  screenshots = [],
  geometry = [],
  diagnostics = [];
let failure;
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
try {
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
        const music = page.getByRole("button", { name: /음악 켜기|음악 끄기/ });
        assert.equal(
          await music.evaluate((element) =>
            element.previousElementSibling?.getAttribute("aria-label"),
          ),
          label.startsWith("teacher") ? "방 나가기" : "전체 게임",
        );
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
    path.join(evidence, "opening-layout-results.json"),
    JSON.stringify(
      {
        status: failure ? "failed" : "passed",
        failure,
        checks,
        screenshots,
        geometry,
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
