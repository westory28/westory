// Real MainLayout/Header/DeveloperLog and CSS, with synthetic identities and
// local reads only. Firebase is excluded from the bundle and remote requests blocked.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence =
  process.env.DEVELOPER_LOG_EVIDENCE_DIR ||
  path.join(root, "output", "developer-log-layout");
await fs.mkdir(evidence, { recursive: true });
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const service = `
import {MENUS} from ${imp("src/constants/menus.ts")};
const identity=new URLSearchParams(location.search).get('identity')||'student';
const email=identity==='developer'?'westoria28@gmail.com':'fixture@example.invalid';
const user={uid:'fixture-user',email,getIdTokenResult:async()=>({claims:{auth_time:Math.floor(Date.now()/1000)}})};
const userData={uid:user.uid,email,name:'화면 검증',role:identity==='student'||identity==='staff'?'student':'teacher',teacherPortalEnabled:identity==='staff',staffPermissions:identity==='staff'?['lesson_read']:[]};
export const config={year:'2026',semester:'2',showLesson:true,showQuiz:true,showScore:true};
const state={currentUser:user,userData,config,loading:false,authPhase:'ready',configReady:true,menuConfigReady:true,interfaceConfigReady:true,settingsLoadedAt:Date.now(),menuConfig:MENUS,interfaceConfig:{},logout:async()=>{},refreshConfig:async()=>{},refreshMenuConfig:async()=>{}};
export const useAuth=()=>state;export const auth={currentUser:user};
export const preloadStudentWeplay=()=>{};
export const resolveStudentProfileEmoji=()=>({rank:null,allowedEmojiIds:['smile'],entry:{id:'smile',emoji:'😀'}});
export const loadStudentRankPromotionSnapshot=async()=>({wallet:{balance:0},rank:null,policy:{rankPolicy:null}});export const getPointRankDefaultEmojiValue=()=>"😀";
const toast={showToast(){}};export const useAppToast=()=>toast;
export const db={};export const doc=(...args)=>({path:args.map(x=>x?.path||x).join('/')});export const collection=doc;export const query=(ref)=>ref;export const orderBy=()=>null;export const limit=()=>null;export const serverTimestamp=()=>null;export const increment=(value)=>({increment:value});
const post={title:'개발자 일지 화면 개선',category:'feature',summary:'포털 탐색 유지',bodyHtml:'<p>교사와 학생 포털에서 개발자 일지를 확인합니다.</p>',publishedAt:new Date('2026-10-20T00:00:00Z'),viewCount:3,likeCount:2};
const eventPost={...post,title:'아바타 콘테스트',category:'event',summary:'나의 아바타를 소개해 주세요.',bodyHtml:'<p>옷장에서 저장한 아바타와 소개를 보내세요. 계정당 1회, 교사가 확인한 뒤 100위스를 지급합니다.</p>',images:[{imageUrl:'/poster.svg',imageStoragePath:'fixture/poster.webp',imageWidth:1086,imageHeight:1448,imageByteSize:100,imageMimeType:'image/webp',alt:'아바타 콘테스트 포스터',order:0}]};
window.developerLogQa={writes:[],reads:0};
export const onSnapshot=(ref,callback)=>{window.developerLogQa.reads++;callback({docs:[{id:'fixture-post',data:()=>post},{id:'fixture-event',data:()=>eventPost}]});return()=>{}};
export const getDoc=async(ref)=>{window.developerLogQa.reads++;const id=ref.path.split('/').at(-1);return{id,exists:()=>['fixture-post','fixture-event','fixture-created'].includes(id),data:()=>id==='fixture-event'?eventPost:id==='fixture-created'?window.developerLogQa.created:post}};export const getDocFromServer=getDoc;
const forbidWrite=async()=>{window.developerLogQa.writes.push('blocked');throw Error('Fixture writes disabled')};
export const setDoc=forbidWrite,deleteDoc=forbidWrite,tryDeleteDeveloperLogImage=forbidWrite;
export const addDoc=async(ref,data)=>{if(!window.developerLogQa.allowWrites)return forbidWrite();window.developerLogQa.writes.push({op:'create',data});window.developerLogQa.created=data;return{id:'fixture-created',path:'site_settings/developer_logs/items/fixture-created'}};
export const updateDoc=async(ref,data)=>{if(!window.developerLogQa.allowWrites)return forbidWrite();window.developerLogQa.writes.push({op:'update',data});Object.assign(window.developerLogQa.created,data)};
export const uploadDeveloperLogImage=async()=>{if(!window.developerLogQa.allowWrites)return forbidWrite();window.developerLogQa.writes.push({op:'upload'});return eventPost.images[0]};
export const runTransaction=async()=>{if(!window.developerLogQa.deferWrites)return forbidWrite();window.developerLogQa.writes.push('local-transaction');await new Promise((resolve,reject)=>Object.assign(window.developerLogQa,{resolve,reject}));};
`;
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {HashRouter,Routes,Route} from 'react-router-dom';
import MainLayout from './src/components/layout/MainLayout';import DeveloperLog from './src/pages/DeveloperLog';
import {LoadingProvider} from './src/components/common/LoadingState';
import './src/assets/index.css';import './src/components/common/portalPage.css';
localStorage.setItem('developerLogViewed:fixture-post','1');
localStorage.setItem('developerLogViewed:fixture-event','1');
localStorage.setItem('developerLogViewed:fixture-created','1');
createRoot(document.getElementById('root')).render(<LoadingProvider><HashRouter><MainLayout><Routes><Route path="/developer-log" element={<DeveloperLog/>}/><Route path="/developer-log/:postId" element={<DeveloperLog/>}/></Routes></MainLayout></HashRouter></LoadingProvider>);
`;
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  metafile: true,
  outdir: "fixture",
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  loader: { ".svg": "dataurl", ".webp": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "local-developer-log",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /firebase\/firestore$|lib\/(firebase|developerLogImages|weplayPreload|studentProfileEmoji|pointRankPromotion|pointRanks)$|contexts\/AuthContext$|(?:common\/|\.\/)AppToastProvider$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "js",
          resolveDir: root,
        }));
        plugin.onResolve(
          {
            filter:
              /(?:StudentHistoryDictionaryController|StudentRankPromotionController|TeacherPatchMemoController|NotificationBell|HeaderStudentWis|QuillEditor)$/,
          },
          (args) => ({
            path: args.path.endsWith("QuillEditor") ? "editor" : "widget",
            namespace: "widget",
          }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "widget" }, (args) => ({
          contents:
            args.path === "editor"
              ? 'import React from "react";export default function Editor({value,onChange}){return <textarea aria-label="본문" value={value} onChange={event=>onChange(event.target.value)}/>;}'
              : "export default function Widget(){return null}",
          loader: "jsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
assert(
  !Object.keys(built.metafile.inputs).some((name) =>
    /node_modules[\\/](@firebase|firebase)[\\/]/.test(name),
  ),
  "Firebase must not enter fixture bundle",
);
const js = built.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = built.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+(?:url\([^;]+|"[^"]+")\s*;/g, "");
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/poster.svg") {
    response.setHeader("Content-Type", "image/svg+xml");
    response.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1086" height="1448"><rect width="1086" height="1448" fill="#eff6ff"/><text x="80" y="180" font-size="70">아바타 콘테스트</text><text x="80" y="1340" font-size="45">교사 확인 후 100위스</text></svg>',
    );
    return;
  }
  const [type, body] = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  }[pathname] || ["text/html", html];
  response.setHeader("Content-Type", `${type};charset=utf-8`);
  response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
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
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const checks = [];
  for (const identity of ["student", "developer", "teacher", "staff"]) {
    for (const width of [390, 768, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
      for (const mode of ["list", "detail"]) {
        const pathname = `/developer-log${mode === "detail" ? "/fixture-post" : ""}`;
        await page.goto(`${origin}/?identity=${identity}#${pathname}`);
        await page
          .getByRole("heading", { name: "개발자 일지", exact: true })
          .waitFor();
        await page
          .getByText("개발자 일지 화면 개선", { exact: true })
          .waitFor();
        const portal = identity === "student" ? "student" : "teacher";
        assert.equal(
          await page.locator(`.${portal}-layout`).count(),
          1,
          `${identity}/${mode}: portal shell`,
        );
        assert.equal(
          await page
            .locator(
              `[aria-label="${portal === "student" ? "학생" : "교사"} 메뉴"]`,
            )
            .count(),
          1,
        );
        assert.equal(await page.locator(".teacher-layout-footer").count(), 1);
        assert.equal(
          await page.locator(".ws-page.developer-log-page").count(),
          1,
        );
        assert.equal(
          await page
            .locator(".developer-log-page")
            .evaluate((node) => getComputedStyle(node).maxWidth),
          "1536px",
          "Current shared page width contract",
        );
        assert.equal(
          await page
            .getByRole("button", { name: "글쓰기", exact: true })
            .count(),
          identity === "developer" ? 1 : 0,
        );
        assert.equal(
          await page.getByText("학생은 좋아요만 가능", { exact: true }).count(),
          0,
        );
        const dimensions = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        assert(
          dimensions.scroll <= dimensions.width + 1,
          `${identity}/${mode}/${width}: horizontal overflow ${JSON.stringify(dimensions)}`,
        );
        if (mode === "list") {
          assert.equal(await page.locator(".ws-page-tabs").count(), 1);
          const before = await page.evaluate(() => window.developerLogQa.reads);
          await page
            .locator(".ws-page-tabs")
            .getByRole("button", { name: "이벤트", exact: true })
            .click();
          await page.getByText("아바타 콘테스트", { exact: true }).waitFor();
          assert.equal(
            await page
              .getByText("개발자 일지 화면 개선", { exact: true })
              .count(),
            0,
          );
          assert.equal(
            await page.evaluate(() => window.developerLogQa.reads),
            before,
            "Existing loaded category tabs add no reads",
          );
          await page
            .locator(".ws-page-tabs")
            .getByRole("button", { name: "전체", exact: true })
            .click();
          await page
            .getByLabel("개발자 일지 검색", { exact: true })
            .fill("없는 글");
          await page
            .getByText("등록된 개발자 일지가 없습니다.", { exact: true })
            .waitFor();
          await page.getByLabel("개발자 일지 검색", { exact: true }).fill("");
          await page
            .getByText("개발자 일지 화면 개선", { exact: true })
            .waitFor();
        }
        await page.screenshot({
          path: path.join(evidence, `${identity}-${mode}-${width}.png`),
          fullPage: true,
        });
        assert.deepEqual(
          await page.evaluate(() => window.developerLogQa.writes),
          [],
        );
        assert.deepEqual(errors, []);
        if (identity === "student" && width === 390 && mode === "detail") {
          await page.evaluate(() => {
            window.developerLogQa.deferWrites = true;
          });
          await page
            .getByRole("button", { name: "좋아요", exact: true })
            .click();
          await page
            .getByRole("status", { name: "처리 중", exact: true })
            .waitFor();
          assert.equal(
            await page.locator(".ws-loading-container-overlay").count(),
            1,
          );
          assert.equal(await page.locator(".ws-loading-screen").count(), 0);
          assert.equal(
            await page.locator("#root").evaluate((node) => node.inert),
            false,
          );
          assert.equal(
            await page.locator(".developer-log-page").count(),
            1,
            "Pending mutation preserves the current article DOM",
          );
          await page.evaluate(() => window.developerLogQa.resolve());
          await page
            .locator(".ws-loading-container-overlay")
            .waitFor({ state: "detached" });
          await page
            .getByRole("button", { name: "좋아요", exact: true })
            .click();
          await page.locator(".ws-loading-container-overlay").waitFor();
          await page.evaluate(() =>
            window.developerLogQa.reject(new Error("synthetic-write-failure")),
          );
          await page
            .locator(".ws-loading-container-overlay")
            .waitFor({ state: "detached" });
          assert.equal(
            await page.locator("#root").evaluate((node) => node.inert),
            false,
          );
          assert.deepEqual(
            await page.evaluate(() => window.developerLogQa.writes),
            ["local-transaction", "local-transaction"],
            "One existing command per click; no polling or extra writes",
          );
          checks.push({
            mutation: "like",
            pending: true,
            successReleased: true,
            errorReleased: true,
            calls: 2,
          });
        }
        checks.push({
          identity,
          mode,
          width,
          shell: portal,
          writeVisible: identity === "developer",
          overflow: false,
        });
      }
      await page.close();
    }
  }
  for (const identity of ["student", "teacher"]) {
    for (const width of [320, 390, 768, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        route.request().url().startsWith(origin)
          ? route.continue()
          : route.abort(),
      );
      await page.goto(
        `${origin}/?identity=${identity}#/developer-log/fixture-event`,
      );
      const image = page.locator(".developer-log-event-images img");
      await image.waitFor();
      await image.evaluate((img) => img.decode());
      assert.equal(
        await page.locator('[aria-label="카드뉴스 이미지 슬라이드"]').count(),
        0,
      );
      assert.equal(
        await page.locator(".developer-log-event-layout").count(),
        1,
      );
      const dimensions = await image.evaluate((img) => {
        const box = img.getBoundingClientRect();
        return {
          width: box.width,
          ratio: box.width / box.height,
          natural: img.naturalWidth / img.naturalHeight,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      assert(dimensions.width <= 720 && dimensions.width > 200);
      assert(Math.abs(dimensions.ratio - dimensions.natural) < 0.001);
      assert.equal(dimensions.overflow, false);
      await page
        .getByText(/계정당 1회, 교사가 확인한 뒤 100위스를 지급합니다/)
        .waitFor();
      const before = await page.evaluate(() => window.developerLogQa.reads);
      await page
        .getByRole("button", {
          name: "1번째 이벤트 이미지 크게 보기",
          exact: true,
        })
        .click();
      await page
        .getByRole("dialog", { name: "1 / 1 크게 보기", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "확대 이미지 닫기", exact: true })
        .click();
      assert.equal(
        await page.evaluate(() => window.developerLogQa.reads),
        before,
      );
      assert.deepEqual(
        await page.evaluate(() => window.developerLogQa.writes),
        [],
      );
      await page.screenshot({
        path: path.join(evidence, `${identity}-event-${width}.png`),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      checks.push({
        identity,
        width,
        eventPoster: true,
        originalRatio: true,
        expanded: true,
        extraReads: 0,
        writes: 0,
      });
      await page.close();
    }
  }
  const writer = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await writer.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await writer.goto(`${origin}/?identity=developer#/developer-log`);
  await writer
    .locator(".ws-page-tabs")
    .getByRole("button", { name: "이벤트", exact: true })
    .click();
  await writer.getByRole("button", { name: "글쓰기", exact: true }).click();
  assert.equal(
    await writer
      .getByRole("button", { name: "이벤트", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await writer
    .getByLabel("제목", { exact: true })
    .fill("나만의 아바타 콘테스트 — 참여하고 100위스 받자!");
  await writer
    .getByLabel("요약", { exact: true })
    .fill("1인 1회, 교사가 확인한 뒤 100위스를 지급합니다.");
  const eventBody =
    "옷장에서 내 아바타를 저장하고 소개를 보내 주세요. 계정당 1회 참여할 수 있으며, 교사가 확인한 뒤 100위스를 지급합니다.";
  await writer.getByLabel("본문", { exact: true }).fill(eventBody);
  await writer.locator('input[type="file"]').setInputFiles({
    name: "event.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZSoYAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await writer.getByRole("button", { name: "미리보기", exact: true }).click();
  await writer.locator(".developer-log-event-images img").waitFor();
  await writer.getByText(eventBody, { exact: true }).waitFor();
  assert.deepEqual(
    await writer.evaluate(() => window.developerLogQa.writes),
    [],
  );
  await writer.evaluate(() => {
    window.developerLogQa.allowWrites = true;
  });
  await writer.getByRole("button", { name: "게시하기", exact: true }).click();
  await writer.waitForURL(/fixture-created/);
  await writer.locator(".developer-log-event-images img").waitFor();
  const writes = await writer.evaluate(() => window.developerLogQa.writes);
  assert.equal(writes.filter((x) => x.op === "create").length, 1);
  assert.equal(writes.filter((x) => x.op === "upload").length, 1);
  assert.equal(writes.filter((x) => x.op === "update").length, 1);
  const saved = writes.find((x) => x.op === "update").data;
  assert.equal(saved.category, "event");
  assert.equal(saved.images.length, 1);
  assert.equal(saved.title, "나만의 아바타 콘테스트 — 참여하고 100위스 받자!");
  assert.equal(saved.bodyHtml, eventBody);
  checks.push({
    eventWriting: true,
    categoryDefault: "event",
    imageUpload: true,
    preview: true,
    bodyPreserved: true,
    created: 1,
    updated: 1,
  });
  await writer.screenshot({
    path: path.join(evidence, "event-created-1280.png"),
    fullPage: true,
  });
  await writer.close();
  await fs.writeFile(
    path.join(evidence, "checks.json"),
    JSON.stringify(checks, null, 2),
  );
  console.log(
    `PASS ${checks.length} developer-log role/route/viewport scenarios. Evidence: ${evidence}`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
