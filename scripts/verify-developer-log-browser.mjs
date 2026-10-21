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
const state={currentUser:user,userData,config,loading:false,authPhase:'ready',configReady:true,menuConfigReady:true,settingsLoadedAt:Date.now(),menuConfig:MENUS,interfaceConfig:{},logout:async()=>{},refreshConfig:async()=>{},refreshMenuConfig:async()=>{}};
export const useAuth=()=>state;export const auth={currentUser:user};
export const preloadStudentWeplay=()=>{};
export const resolveStudentProfileEmoji=()=>({rank:null,allowedEmojiIds:['smile'],entry:{id:'smile',emoji:'😀'}});
export const loadStudentRankPromotionSnapshot=async()=>({wallet:{balance:0},rank:null,policy:{rankPolicy:null}});export const getPointRankDefaultEmojiValue=()=>"😀";
const toast={showToast(){}};export const useAppToast=()=>toast;
export const db={};export const doc=(...args)=>({path:args.map(x=>x?.path||x).join('/')});export const collection=doc;export const query=(ref)=>ref;export const orderBy=()=>null;export const limit=()=>null;export const serverTimestamp=()=>null;
const post={title:'개발자 일지 화면 개선',category:'feature',summary:'포털 탐색 유지',bodyHtml:'<p>교사와 학생 포털에서 개발자 일지를 확인합니다.</p>',publishedAt:new Date('2026-10-20T00:00:00Z'),viewCount:3,likeCount:2};
export const onSnapshot=(ref,callback)=>{callback({docs:[{id:'fixture-post',data:()=>post}]});return()=>{}};
export const getDoc=async(ref)=>({id:'fixture-post',exists:()=>ref.path.endsWith('/fixture-post'),data:()=>post});export const getDocFromServer=getDoc;
window.developerLogQa={writes:[]};const forbidWrite=async()=>{window.developerLogQa.writes.push('blocked');throw Error('Fixture writes disabled')};
export const setDoc=forbidWrite,updateDoc=forbidWrite,deleteDoc=forbidWrite,addDoc=forbidWrite,runTransaction=forbidWrite,uploadDeveloperLogImage=forbidWrite,tryDeleteDeveloperLogImage=forbidWrite;
`;
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {HashRouter,Routes,Route} from 'react-router-dom';
import MainLayout from './src/components/layout/MainLayout';import DeveloperLog from './src/pages/DeveloperLog';
import './src/assets/index.css';import './src/components/common/portalPage.css';
localStorage.setItem('developerLogViewed:fixture-post','1');
createRoot(document.getElementById('root')).render(<HashRouter><MainLayout><Routes><Route path="/developer-log" element={<DeveloperLog/>}/><Route path="/developer-log/:postId" element={<DeveloperLog/>}/></Routes></MainLayout></HashRouter>);
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
          () => ({ path: "widget", namespace: "widget" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "widget" }, () => ({
          contents: "export default function Widget(){return null}",
          loader: "js",
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
          await page.locator(".ws-page.ws-page--reading").count(),
          1,
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
