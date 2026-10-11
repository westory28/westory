// Real layout, navigation, student lobby and game; synthetic services only.
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
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const core = require("../functions/weplayCore.js");
const out = path.resolve(
  process.env.WEPLAY_QA_EVIDENCE_DIR ||
    path.join(os.tmpdir(), "westory-weplay-navigation"),
);
await fs.mkdir(out, { recursive: true });
const source = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const lessons = [
  {
    unitId: "qa",
    title: "임진왜란",
    words: ["이순신", "거북선", "한산도"],
    wordCount: 3,
  },
];
const mocks = {
  "qa-service": `
import {MENUS} from ${source("src/constants/menus.ts")};
export const qa=window.weplayNavigationQa={calls:[],session:null};
const teacher=new URLSearchParams(location.search).has('teacher');
export const config={year:'2026',semester:'2',showLesson:true,showQuiz:true,showScore:true};
export const auth={currentUser:{uid:'navigation-qa',email:'navigation@example.invalid'}};
const state={config,currentUser:auth.currentUser,userData:{uid:'navigation-qa',email:auth.currentUser.email,role:teacher?'teacher':'student',teacherPortalEnabled:teacher,staffPermissions:[],name:'화면 검증',weplayGuideCompleted:true},loading:false,authPhase:'ready',configReady:true,menuConfigReady:true,menuConfig:MENUS,settingsLoadedAt:Date.now(),refreshConfig:async()=>{},refreshMenuConfig:async()=>{},logout:async()=>{}};
export const useAuth=()=>state;
export const db={};
const settings=${JSON.stringify(core.DEFAULT_GAME_SETTINGS)};
const policy=${JSON.stringify(core.DEFAULT_POLICY)};
export const getHttpsCallable=async name=>async data=>{
 qa.calls.push(name);
 if(name==='getWeplayLobby')return {data:{gameEnabled:true,policy,balance:34,dailyUsed:0,dailyRemaining:3,lessons:${JSON.stringify(lessons)},wordCount:3,difficulties:settings.difficulties,challengeDifficulties:settings.difficulties,activeSession:null,records:[],period:null,rankingByDifficulty:{mild:[],medium:[],spicy:[]},serverNowMs:Date.now()}};
 if(name==='startWeplayGame'){
  qa.session=await (await fetch('/session',{method:'POST',body:JSON.stringify({...data,now:Date.now()})})).json();
  return {data:qa.session};
 }
 throw new Error('Unexpected service call: '+name);
};`,
  "qa-null": "export default ()=>null;",
  "qa-rank":
    "export const loadStudentRankPromotionSnapshot=async()=>({rank:null,wallet:{balance:0},policy:{rankPolicy:{}}});export const invalidateStudentRankPromotionSnapshotCache=()=>{};",
  "qa-point-ranks": "export const getPointRankDefaultEmojiValue=()=>'';",
  "qa-archive":
    "export const isSemesterArchive=false;export const archiveScope=null;",
  "qa-boundary":
    "export const SemesterArchiveBanner=()=>null;export const SemesterArchiveUnavailable=()=>null;export const isArchiveUnavailableRoute=()=>false;",
  "qa-firestore":
    "export const doc=()=>({});export const getDoc=async()=>{throw new Error('Unexpected Firestore read')};",
  "qa-session":
    "export {getHttpsCallable as getHistoryDictionaryCallable} from 'qa-service';",
};
const bundled = await build({
  stdin: {
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {HashRouter,useLocation,useNavigate} from 'react-router-dom';
import MainLayout from ${source("src/components/layout/MainLayout.tsx")};
import Weplay from ${source("src/pages/student/Weplay.tsx")};
import {AppToastProvider} from ${source("src/components/common/AppToastProvider.tsx")};
import {AppDialogProvider} from ${source("src/components/common/AppDialogProvider.tsx")};
import ${source("src/assets/index.css")};
import {qa} from 'qa-service';
function Fixture(){const location=useLocation();qa.navigate=useNavigate();return <MainLayout>{location.pathname.startsWith('/student/weplay')?<Weplay/>:<h1>다른 화면</h1>}</MainLayout>}
createRoot(document.getElementById('root')).render(<HashRouter><AppToastProvider><AppDialogProvider><Fixture/></AppDialogProvider></AppToastProvider></HashRouter>);`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  metafile: true,
  outdir: "fixture",
  format: "esm",
  platform: "browser",
  external: ["/assets/*"],
  loader: { ".svg": "dataurl", ".webp": "dataurl", ".png": "dataurl" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "offline-services",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          const request = args.path.replaceAll("\\", "/");
          let id = request in mocks ? request : null;
          if (
            /contexts\/AuthContext$|lib\/firebase$|^\.\/firebase$/.test(request)
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
assert.equal(
  Object.keys(bundled.metafile.inputs).some((file) =>
    /node_modules[\\/](firebase|@firebase)[\\/]/.test(file),
  ),
  false,
  "Fixture must not import a live Firebase SDK: " +
    Object.entries(bundled.metafile.inputs)
      .filter(
        ([file, info]) =>
          file.startsWith("src/") &&
          info.imports.some((item) =>
            /node_modules\/(firebase|@firebase)\//.test(item.path),
          ),
      )
      .map(([file]) => file)
      .join(", "),
);
const js = bundled.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = (
  (await fs.readFile(path.join(root, "assets/css/style.css"), "utf8")) +
  bundled.outputFiles.find((file) => file.path.endsWith(".css")).text
).replace(/@import\s+[^;]+;/g, "");
const tailwind = await fs.readFile(
  path.join(os.tmpdir(), "westory-qa-tailwind.js"),
);
const html =
  '<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/session") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks));
      const difficultySettings =
        core.DEFAULT_GAME_SETTINGS.difficulties[data.difficulty];
      const startsAtMs = data.now + 3000;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          id: "navigation-session",
          mode: data.mode,
          difficulty: data.difficulty,
          difficultySettings,
          policy: core.DEFAULT_POLICY,
          battleVersion: 1,
          status: "active",
          startsAtMs,
          endsAtMs: startsAtMs + difficultySettings.durationSeconds * 1000,
          serverNowMs: data.now,
          acceptedEvents: [],
          acceptedWordIds: [],
          correctCount: 0,
          result: null,
          words: core.buildWords(
            lessons[0].words.map((text) => ({
              text,
              unitId: "qa",
              lessonTitle: "임진왜란",
            })),
            "navigation",
            data.difficulty,
            difficultySettings,
          ),
        }),
      );
      return;
    }
    const files = {
      "/fixture.js": ["text/javascript", js],
      "/fixture.css": ["text/css", css],
      "/tailwind.js": ["text/javascript", tailwind],
    };
    if (files[pathname]) {
      response.setHeader("Content-Type", files[pathname][0]);
      response.end(files[pathname][1]);
      return;
    }
    if (pathname.startsWith("/assets/")) {
      const target = path.resolve(root, "public", "." + pathname);
      assert(target.startsWith(path.join(root, "public") + path.sep));
      response.end(await fs.readFile(target));
      return;
    }
    response.setHeader("Content-Type", "text/html;charset=utf-8");
    response.end(html);
  } catch (error) {
    console.error(request.url, error.message);
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
  checks = [];
const dimensions = async (page) =>
  page.evaluate(() => ({
    width: innerWidth,
    padding: parseFloat(
      getComputedStyle(
        document.querySelector(".student-layout,.teacher-layout"),
      ).paddingLeft,
    ),
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
async function open(width, touch = false, route = "/student/weplay") {
  const page = await browser.newPage({
    viewport: { width, height: width >= 1024 && touch ? 768 : 900 },
    hasTouch: touch,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await page.clock.install({ time: new Date("2026-10-11T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-11T03:00:00Z"));
  await page.goto(
    `${origin}/?${route.startsWith("/teacher") ? "teacher" : ""}#${route}`,
  );
  await page
    .locator(".student-layout,.teacher-layout")
    .waitFor({ timeout: 10000 })
    .catch(async (error) => {
      console.error({ errors, body: await page.locator("body").innerHTML() });
      throw error;
    });
  return page;
}
try {
  for (const [width, touch] of [
    [320, true],
    [390, true],
    [768, true],
    [1024, true],
    [1180, false],
    [1280, true],
    [1366, true],
    [1280, false],
    [1440, false],
  ]) {
    const page = await open(width, touch);
    await page.locator(".weplay-start").waitFor();
    const compact = width < 1280 || touch;
    assert.deepEqual(await dimensions(page), {
      width,
      padding: width < 1024 ? 0 : compact ? 88 : 232,
      overflow: false,
    });
    if (width < 1024) {
      const toggle = page.locator("#student-navigation-toggle");
      await toggle.click();
      await page
        .getByRole("dialog", { name: "학생 메뉴", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "메뉴 닫기", exact: true })
        .press("Escape");
      assert.equal(
        await toggle.evaluate((el) => el === document.activeElement),
        true,
      );
    } else {
      const toggle = page.locator(".teacher-sidebar-collapse");
      assert.equal(
        await toggle.getAttribute("aria-expanded"),
        String(!compact),
      );
      const box = await toggle.boundingBox();
      assert(box.width >= 44 && box.height >= 44);
      await toggle.press("Enter");
      assert.equal((await dimensions(page)).padding, compact ? 232 : 88);
      await toggle.press("Space");
      assert.equal((await dimensions(page)).padding, compact ? 88 : 232);
    }
    await page.locator(".weplay-start").click();
    await page.locator(".naval-game").waitFor();
    await page.clock.runFor(3500);
    const input = page.getByRole("textbox", { name: "단어 입력" });
    await input.fill("입력 유지");
    await input.evaluate((el) => {
      window.originalGameInput = el;
    });
    const calls = await page.evaluate(() => [
      ...window.weplayNavigationQa.calls,
    ]);
    if (width >= 1024) {
      await page.locator(".teacher-sidebar-collapse").click();
      await page.locator(".teacher-sidebar-collapse").click();
    }
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.setViewportSize({
      width,
      height: width >= 1024 && touch ? 768 : 900,
    });
    await page.clock.runFor(50);
    assert.deepEqual(await dimensions(page), {
      width,
      padding: width < 1024 ? 0 : compact ? 88 : 232,
      overflow: false,
    });
    assert.equal(
      await input.evaluate(
        (el) => el === window.originalGameInput && el.value === "입력 유지",
      ),
      true,
    );
    assert.deepEqual(
      await page.evaluate(() => window.weplayNavigationQa.calls),
      calls,
    );
    assert.equal((await dimensions(page)).overflow, false);
    await page.screenshot({
      path: path.join(out, `game-${width}-${touch ? "touch" : "mouse"}.png`),
      fullPage: true,
    });
    checks.push(
      `${width}px ${touch ? "touch" : "mouse"}: automatic rail, keyboard/menu controls, game/input/request preservation, rotation, no overflow`,
    );
    await page.close();
  }
  const navigation = await open(1024, true, "/student/dashboard");
  assert.equal((await dimensions(navigation)).padding, 232);
  await navigation.evaluate(() =>
    window.weplayNavigationQa.navigate("/student/weplay/"),
  );
  await navigation.locator(".weplay-start").waitFor();
  assert.equal((await dimensions(navigation)).padding, 88);
  await navigation.locator(".teacher-sidebar-collapse").click();
  await navigation.evaluate(() =>
    window.weplayNavigationQa.navigate("/student/dashboard"),
  );
  assert.equal((await dimensions(navigation)).padding, 232);
  await navigation.locator(".teacher-sidebar-collapse").click();
  await navigation.evaluate(() =>
    window.weplayNavigationQa.navigate("/student/weplay"),
  );
  await navigation.locator(".weplay-start").waitFor();
  assert.equal((await dimensions(navigation)).padding, 88);
  await navigation.locator(".teacher-sidebar-collapse").click();
  await navigation.evaluate(() =>
    window.weplayNavigationQa.navigate("/student/dashboard"),
  );
  assert.equal((await dimensions(navigation)).padding, 88);
  checks.push(
    "Route entry/re-entry resets Weplay override; both expanded and collapsed preferences on other routes survive",
  );
  await navigation.close();
  const teacher = await open(1024, true, "/teacher/weplay");
  assert.equal((await dimensions(teacher)).padding, 232);
  await teacher.locator(".teacher-sidebar-collapse").click();
  assert.equal((await dimensions(teacher)).padding, 88);
  checks.push(
    "Teacher Weplay stays expanded by default and still toggles manually",
  );
  await teacher.close();
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, "results.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(`PASS ${checks.length} groups; screenshots and results: ${out}`);
} finally {
  await browser.close();
  server.close();
}
