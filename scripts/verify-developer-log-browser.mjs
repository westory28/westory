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
import {useSyncExternalStore} from 'react';
import {MENUS} from ${imp("src/constants/menus.ts")};
const identity=new URLSearchParams(location.search).get('identity')||'student';
const email=identity==='developer'?'westoria28@gmail.com':'fixture@example.invalid';
const user={uid:'fixture-user',email,getIdTokenResult:async()=>({claims:{auth_time:Math.floor(Date.now()/1000)}})};
const userData={uid:user.uid,email,name:'화면 검증',role:identity==='student'||identity==='staff'?'student':'teacher',teacherPortalEnabled:identity==='staff',staffPermissions:identity==='staff'?['lesson_read']:[]};
export const config={year:'2026',semester:'2',showLesson:true,showQuiz:true,showScore:true};
const state={currentUser:user,userData,config,loading:false,authPhase:'ready',configReady:true,menuConfigReady:true,interfaceConfigReady:true,settingsLoadedAt:Date.now(),menuConfig:MENUS,interfaceConfig:{},logout:async()=>{},refreshConfig:async()=>{},refreshMenuConfig:async()=>{}};
export const useAuth=()=>{useSyncExternalStore(callback=>{window.addEventListener('fixture-auth-change',callback);return()=>window.removeEventListener('fixture-auth-change',callback)},()=>state.currentUser);return state};export const auth={currentUser:user};
export const preloadStudentWeplay=()=>{};
export const useStudentWisStockStatus=()=>({data:{studentOpen:true},loading:false});
export const resolveStudentProfileEmoji=()=>({rank:null,allowedEmojiIds:['smile'],entry:{id:'smile',emoji:'😀'}});
export const loadStudentRankPromotionSnapshot=async()=>({wallet:{balance:0},rank:null,policy:{rankPolicy:null}});export const getPointRankDefaultEmojiValue=()=>"😀";
const toast={showToast(value){window.developerLogQa.toasts.push(value)}};export const useAppToast=()=>toast;
export const db={};export const collection=(...args)=>({path:args.map(x=>x?.path||x).join('/'),kind:'collection'});export const doc=(...args)=>{if(args.length===1&&args[0].kind==='collection'){const id='fixture-created';window.developerLogQa.reservations.push(id);return{path:args[0].path+'/'+id,id}}const path=args.map(x=>x?.path||x).join('/');return{path,id:path.split('/').at(-1)}};export const query=(ref)=>ref;export const orderBy=()=>null;export const limit=()=>null;export const serverTimestamp=()=>null;export const increment=(value)=>({increment:value});
const post={title:'개발자 일지 화면 개선',createdByName:'방재석',category:'feature',summary:'포털 탐색 유지',bodyHtml:'<p>교사와 학생 포털에서 개발자 일지를 확인합니다.</p>',publishedAt:new Date('2026-11-14T00:00:00Z'),viewCount:3,likeCount:2};
const eventPost={...post,action:'wispi',title:'아바타 콘테스트',category:'event',summary:'나의 아바타를 소개해 주세요.',bodyHtml:'<p>옷장에서 저장한 아바타와 소개를 보내세요. 계정당 1회, 교사가 확인한 뒤 100위스를 지급합니다.</p>',images:[{imageUrl:'/poster.svg',imageStoragePath:'fixture/poster.webp',imageWidth:1086,imageHeight:1448,imageByteSize:100,imageMimeType:'image/webp',alt:'아바타 콘테스트 포스터',order:0}]};
window.developerLogQa={writes:[],reads:0,reservations:[],toasts:[],uploads:0,liked:false,likeStudentCalls:[],documents:{'fixture-post':post,'fixture-event':eventPost},switchAccount(){state.currentUser={...user,uid:'fixture-second'};state.userData={...userData,uid:'fixture-second'};auth.currentUser=state.currentUser;window.dispatchEvent(new Event('fixture-auth-change'));},switchRole(role){state.currentUser={...state.currentUser};state.userData={...state.userData,role};auth.currentUser=state.currentUser;window.dispatchEvent(new Event('fixture-auth-change'));}};
export const callWithApplicationSession=async(name,input,caller,options={})=>{const qa=window.developerLogQa;if(name!=='getDeveloperLogLikeStudents')throw Error('Unexpected fixture callable');if(qa.holdLikeStudentsDispatch)await new Promise(resolve=>qa.releaseLikeStudentsDispatch=resolve);options.beforeDispatch?.();qa.likeStudentCalls.push({...input,uid:caller.uid});if(qa.holdLikeStudents)await new Promise(resolve=>qa.releaseLikeStudents=resolve);if(qa.failLikeStudents){qa.failLikeStudents=false;throw Object.assign(Error('synthetic-roster-failure'),{code:qa.likeStudentsErrorCode||'functions/unavailable'})}const count=qa.emptyLikeStudents?0:85;const students=Array.from({length:count},(_,i)=>({id:'fixture-student-'+String(i+1).padStart(3,'0'),name:i===0?'긴 이름도 생략하지 않는 검증 학생':'명단 학생 '+(i+1),grade:'3',class:String(Math.floor(i/30)+1),number:String(i%30+1)}));const start=input.cursor?students.findIndex(s=>s.id===input.cursor)+1:0;const page=students.slice(start,start+input.pageSize);const hasMore=start+page.length<students.length;return{data:{students:page,nextCursor:hasMore?page.at(-1).id:null,hasMore}}};
export const onSnapshot=(ref,callback)=>{window.developerLogQa.reads++;callback({docs:[{id:'fixture-post',data:()=>post},{id:'fixture-event',data:()=>eventPost}]});return()=>{}};
export const getDoc=async(ref)=>{const qa=window.developerLogQa;qa.reads++;if(qa.failReads)throw Error('synthetic-read-failure');const id=ref.path.split('/').at(-1);return{id,exists:()=>ref.path.includes('/likes/')?qa.liked:['fixture-post','fixture-event','fixture-created'].includes(id),data:()=>id==='fixture-event'?eventPost:id==='fixture-created'?qa.created:post}};export const getDocFromServer=getDoc;
const forbidWrite=async()=>{window.developerLogQa.writes.push('blocked');throw Error('Fixture writes disabled')};
export const deleteDoc=forbidWrite,addDoc=forbidWrite;
export const setDoc=async(ref,data)=>{const qa=window.developerLogQa;if(!qa.allowWrites)return forbidWrite();qa.writes.push({op:'set',id:ref.id,data});if(qa.failPublish){qa.failPublish=false;throw Error('synthetic-publish-failure')}qa.documents[ref.id]=structuredClone(data);qa.created=data;};
export const updateDoc=async(ref,data)=>{const qa=window.developerLogQa;if(!qa.allowWrites)return forbidWrite();qa.writes.push({op:'update',id:ref.id,data});Object.assign(qa.documents[ref.id]||qa.created,data)};
export const tryDeleteDeveloperLogImage=async(path)=>{if(!window.developerLogQa.allowWrites)return forbidWrite();window.developerLogQa.writes.push({op:'delete-image',path});return true};
export const uploadDeveloperLogImage=async({postId})=>{const qa=window.developerLogQa;if(!qa.allowWrites)return forbidWrite();const index=++qa.uploads;qa.writes.push({op:'upload',id:postId,index});if(qa.holdUpload)await new Promise(resolve=>qa.releaseUpload=resolve);if(qa.failUploadAt===index)throw Error('synthetic-upload-failure');return{...eventPost.images[0],imageStoragePath:'fixture/upload-'+index+'.webp'}};
export const writeBatch=()=>{let desired,delta;return{set(){desired=true},delete(){desired=false},update(ref,data){delta=data.likeCount.increment},async commit(){const qa=window.developerLogQa;if(!qa.deferWrites)return forbidWrite();qa.writes.push('local-batch');await new Promise((resolve,reject)=>Object.assign(qa,{resolve(){qa.liked=desired;post.likeCount+=delta;resolve()},reject}));}}};
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
              /firebase\/firestore$|(?:lib\/|\.\/)firebase$|(?:lib\/|\.\/)applicationSession$|lib\/(developerLogImages|weplayPreload|studentProfileEmoji|pointRankPromotion|pointRanks)$|hooks\/useStudentWisStocks$|contexts\/AuthContext$|(?:common\/|\.\/)AppToastProvider$/,
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
    for (const width of [320, 390, 768, 1280, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
      for (const mode of ["list", "detail"]) {
        const readsBeforeNavigation =
          mode === "detail"
            ? await page.evaluate(() => window.developerLogQa.reads)
            : 0;
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
        assert.equal(
          (await page.evaluate(() => window.developerLogQa.reads)) -
            readsBeforeNavigation,
          mode === "list"
            ? 1
            : identity === "student" || identity === "staff"
              ? 2
              : 1,
          "Detail reads only post and eligible own like; no list subscription",
        );
        if (mode === "detail")
          assert.equal(
            await page.getByRole("link", { name: "위스피 하러 가기" }).count(),
            0,
            "Existing posts have no unsolicited CTA",
          );
        if (mode === "detail") {
          const rosterButton = page.getByRole("button", {
            name: "좋아요 누른 학생 보기",
            exact: true,
          });
          assert.equal(
            await rosterButton.count(),
            identity === "teacher" || identity === "developer" ? 1 : 0,
          );
          assert.equal(
            await page.evaluate(
              () => window.developerLogQa.likeStudentCalls.length,
            ),
            0,
            "No roster request before explicit teacher action",
          );
          if (identity === "teacher" || identity === "developer") {
            await rosterButton.click();
            const dialog = page.getByRole("dialog", {
              name: "좋아요 누른 학생",
              exact: true,
            });
            await dialog.getByText("명단 학생 40", { exact: true }).waitFor();
            assert.equal(await dialog.getByRole("listitem").count(), 40);
            assert.equal(
              await dialog
                .getByText("긴 이름도 생략하지 않는 검증 학생", { exact: true })
                .count(),
              1,
            );
            assert.equal(
              await dialog.getByText("3학년 1반 1번", { exact: true }).count(),
              1,
            );
            assert.equal(
              await page.evaluate(() => document.activeElement?.textContent),
              "닫기",
            );
            await page.keyboard.press("Tab");
            assert.equal(
              await page.evaluate(() => document.activeElement?.textContent),
              "더 보기",
            );
            await page.keyboard.press("Tab");
            assert.equal(
              await page.evaluate(() => document.activeElement?.textContent),
              "닫기",
              "Native modal traps focus",
            );
            const dimensions = await dialog.evaluate((node) => ({
              width: node.clientWidth,
              scroll: node.scrollWidth,
              viewport: innerWidth,
            }));
            assert(
              dimensions.scroll <= dimensions.width + 1 &&
                dimensions.width <= dimensions.viewport,
            );
            await dialog.getByRole("listitem").first().scrollIntoViewIfNeeded();
            await page.screenshot({
              path: path.join(evidence, `${identity}-likers-${width}.png`),
              fullPage: true,
            });
            await dialog
              .getByRole("button", { name: "더 보기", exact: true })
              .click();
            await dialog.getByText("명단 학생 80", { exact: true }).waitFor();
            await dialog
              .getByRole("button", { name: "더 보기", exact: true })
              .click();
            await dialog.getByText("명단 학생 85", { exact: true }).waitFor();
            assert.equal(
              await dialog.getByRole("listitem").count(),
              85,
              "Every page available without truncation",
            );
            assert.equal(
              await dialog
                .getByRole("button", { name: "더 보기", exact: true })
                .count(),
              0,
            );
            const calls = await page.evaluate(
              () => window.developerLogQa.likeStudentCalls,
            );
            assert.deepEqual(
              calls.map((call) => call.cursor || null),
              [null, "fixture-student-040", "fixture-student-080"],
            );
            assert(
              calls.every(
                (call) =>
                  call.pageSize === 40 && call.postId === "fixture-post",
              ),
            );
            await page.keyboard.press("Escape");
            assert.equal(await dialog.count(), 0);
            assert.equal(
              await rosterButton.evaluate(
                (node) => node === document.activeElement,
              ),
              true,
            );
            assert.notEqual(
              await page.evaluate(() => document.body.style.overflowY),
              "hidden",
            );
            assert.deepEqual(
              await page.evaluate(() => window.developerLogQa.writes),
              [],
            );
            checks.push({
              identity,
              width,
              roster:
                "all 85 paged; on demand; zero writes; keyboard and layout",
            });
          }
        }
        if (identity === "student" && width === 390 && mode === "detail") {
          await page.evaluate(() => {
            window.developerLogQa.deferWrites = true;
          });
          const likeButton = page.getByRole("button", {
            name: "좋아요",
            exact: true,
          });
          const beforeReads = await page.evaluate(
            () => window.developerLogQa.reads,
          );
          await likeButton.click();
          assert.equal(
            await likeButton.getAttribute("aria-pressed"),
            "true",
            "Optimistic feedback before server ack",
          );
          assert.equal(
            await page.locator(".developer-log-like-count").innerText(),
            "3",
          );
          assert.equal(
            await likeButton.isDisabled(),
            true,
            "Duplicate clicks blocked synchronously",
          );
          assert.equal(
            await page.locator(".ws-loading-container-overlay").count(),
            0,
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
          await page.waitForFunction(
            () =>
              document.querySelector(".developer-log-like")?.disabled === false,
          );
          assert.equal(
            await page.evaluate(() => window.developerLogQa.reads),
            beforeReads,
            "Successful batch has zero pre/post reads",
          );
          await likeButton.click();
          assert.equal(await likeButton.getAttribute("aria-pressed"), "false");
          await page.evaluate(() =>
            window.developerLogQa.reject(new Error("synthetic-write-failure")),
          );
          await page.waitForFunction(
            () =>
              document.querySelector(".developer-log-like")?.disabled === false,
          );
          assert.equal(
            await likeButton.getAttribute("aria-pressed"),
            "true",
            "Rejected mutation restores server state",
          );
          assert.equal(
            await page.locator(".developer-log-like-count").innerText(),
            "3",
          );
          assert.equal(
            await page.evaluate(() => window.developerLogQa.reads),
            beforeReads + 2,
            "Only error reconciliation reads post + own like",
          );
          await likeButton.click();
          await page.evaluate(() => window.developerLogQa.resolve());
          await page.waitForFunction(
            () =>
              document.querySelector(".developer-log-like")?.disabled === false,
          );
          assert.equal(
            await likeButton.getAttribute("aria-pressed"),
            "false",
            "Retry applies intended removal once",
          );
          assert.equal(
            await page.locator(".developer-log-like-count").innerText(),
            "2",
          );
          assert.equal(
            await page.evaluate(() => window.developerLogQa.reads),
            beforeReads + 2,
          );
          assert.equal(
            await page.locator("#root").evaluate((node) => node.inert),
            false,
          );
          assert.deepEqual(
            await page.evaluate(() => window.developerLogQa.writes),
            ["local-batch", "local-batch", "local-batch"],
            "One existing command per click; no polling or extra writes",
          );
          checks.push({
            mutation: "like",
            pending: true,
            successReleased: true,
            errorReleased: true,
            calls: 3,
            normalReads: 0,
            recoveryReads: 2,
          });
          const toastCount = await page.evaluate(
            () => window.developerLogQa.toasts.length,
          );
          await likeButton.click();
          await page.evaluate(() => {
            const qa = window.developerLogQa;
            qa.liked = true;
            qa.documents["fixture-post"].likeCount += 1;
            qa.reject(new Error("synthetic-lost-response"));
          });
          await page.waitForFunction(
            () =>
              document.querySelector(".developer-log-like")?.disabled === false,
          );
          assert.equal(await likeButton.getAttribute("aria-pressed"), "true");
          assert.equal(
            await page.evaluate(() => window.developerLogQa.toasts.length),
            toastCount,
            "Lost response reconciles successful intent without false failure",
          );
          await likeButton.click();
          await page.evaluate(() => {
            window.developerLogQa.failReads = true;
            window.developerLogQa.reject(new Error("synthetic-offline"));
          });
          await page.waitForFunction(
            () =>
              document.querySelector(".developer-log-like")?.disabled === false,
          );
          assert.equal(
            await likeButton.getAttribute("aria-pressed"),
            "true",
            "Offline rollback preserves last displayed state",
          );
          await page.evaluate(() => {
            window.developerLogQa.failReads = false;
          });
          await likeButton.click();
          await page.evaluate(() => {
            window.developerLogQa.liked = false;
            window.developerLogQa.switchAccount();
          });
          await page.waitForFunction(
            () =>
              document.querySelector(".developer-log-like")?.disabled === false,
          );
          assert.equal(await likeButton.getAttribute("aria-pressed"), "false");
          await page.evaluate(() =>
            window.developerLogQa.reject(new Error("old-account-response")),
          );
          await page.waitForTimeout(50);
          assert.equal(
            await likeButton.getAttribute("aria-pressed"),
            "false",
            "Old account response cannot overwrite new account",
          );
          checks.push({
            lostResponse: true,
            offlineRollback: true,
            accountSwitch: true,
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
      assert.equal(
        await page
          .getByRole("link", { name: "위스피 하러 가기" })
          .getAttribute("href"),
        identity === "student"
          ? "#/student/wispi"
          : "#/teacher/points?tab=stocks",
      );
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
      const layout = await page
        .locator(".developer-log-post")
        .evaluate((article) => {
          const meta = article.querySelector(".developer-log-meta");
          const parts = [...meta.children].map((node) =>
            node.getBoundingClientRect(),
          );
          const date = article.querySelector(".developer-log-meta-date");
          const body = article.querySelector(".developer-log-body-copy");
          const paragraph = body.querySelector("p").getBoundingClientRect();
          const bounds = article.getBoundingClientRect();
          return {
            centers: parts.map((box) => box.top + box.height / 2),
            dateWhiteSpace: getComputedStyle(date).whiteSpace,
            leftInset: paragraph.left - bounds.left,
            rightInset: bounds.right - paragraph.right,
            buttonHeight: article
              .querySelector(".developer-log-like")
              .getBoundingClientRect().height,
          };
        });
      assert(
        Math.max(...layout.centers) - Math.min(...layout.centers) < 2,
        `${identity}/${width}: metadata stays on one row`,
      );
      assert.equal(layout.dateWhiteSpace, "nowrap");
      assert(
        layout.leftInset >= 20 && layout.rightInset >= 20,
        `${identity}/${width}: readable prose inset ${JSON.stringify(layout)}`,
      );
      assert(layout.buttonHeight >= 44);
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
        metadataOneRow: true,
        proseInset: layout.leftInset,
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
  await writer.getByLabel("위스피 이동 버튼", { exact: true }).check();
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
  assert.equal(writes.filter((x) => x.op === "set").length, 1);
  assert.equal(writes.filter((x) => x.op === "upload").length, 1);
  assert.equal(writes.filter((x) => x.op === "update").length, 0);
  assert.deepEqual(
    writes.map((x) => x.op),
    ["upload", "set"],
  );
  const saved = writes.find((x) => x.op === "set").data;
  assert.equal(saved.category, "event");
  assert.equal(saved.images.length, 1);
  assert.equal(saved.title, "나만의 아바타 콘테스트 — 참여하고 100위스 받자!");
  assert.equal(saved.bodyHtml, eventBody);
  assert.equal(saved.action, "wispi");
  assert.equal(
    await writer
      .getByRole("link", { name: "위스피 하러 가기" })
      .getAttribute("href"),
    "#/teacher/points?tab=stocks",
  );
  checks.push({
    eventWriting: true,
    categoryDefault: "event",
    imageUpload: true,
    preview: true,
    bodyPreserved: true,
    created: 1,
    updated: 0,
  });
  await writer.screenshot({
    path: path.join(evidence, "event-created-1280.png"),
    fullPage: true,
  });
  await writer.close();
  const imageFile = (name) => ({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZSoYAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  for (const failure of ["upload", "publish", "edit-upload"]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 900 },
    });
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    const editing = failure === "edit-upload";
    await page.goto(
      `${origin}/?identity=developer#/developer-log${editing ? "/fixture-event" : ""}`,
    );
    await page
      .getByRole("button", { name: editing ? "수정" : "글쓰기", exact: true })
      .click();
    await page.getByLabel("제목", { exact: true }).fill("업로드 재시도 이벤트");
    await page.getByLabel("본문", { exact: true }).fill(eventBody);
    await page
      .locator('input[type="file"]')
      .setInputFiles([imageFile("first.png"), imageFile("second.png")]);
    const before = await page.evaluate((failure) => {
      const qa = window.developerLogQa;
      qa.allowWrites = true;
      qa.failUploadAt = failure === "publish" ? 0 : 2;
      qa.failPublish = failure === "publish";
      qa.holdUpload = true;
      return {
        reads: qa.reads,
        original: structuredClone(qa.documents["fixture-event"]),
      };
    }, failure);
    const submit = page.getByRole("button", {
      name: editing ? "수정 저장" : "게시하기",
      exact: true,
    });
    // Same-render double click: the first request must lock synchronously.
    await submit.evaluate((button) => {
      button.click();
      button.click();
    });
    await page.waitForFunction(() => window.developerLogQa.releaseUpload);
    assert.equal(await page.evaluate(() => window.developerLogQa.uploads), 1);
    assert.equal(
      await page.evaluate(
        () =>
          window.developerLogQa.writes.filter((entry) =>
            ["set", "update"].includes(entry.op),
          ).length,
      ),
      0,
    );
    await page.evaluate(() => {
      window.developerLogQa.holdUpload = false;
      window.developerLogQa.releaseUpload();
    });
    await page.waitForFunction(() =>
      window.developerLogQa.toasts.some((entry) => entry.tone === "error"),
    );
    await page
      .locator(".ws-loading-container-overlay")
      .waitFor({ state: "detached" });
    const failed = await page.evaluate(() => window.developerLogQa);
    assert.equal(
      failed.documents["fixture-created"],
      undefined,
      "Failed upload or publication leaves no document",
    );
    assert.deepEqual(
      failed.documents["fixture-event"],
      before.original,
      "Existing post stays intact on failure",
    );
    assert.equal(
      failed.reads,
      before.reads,
      "Failure does not perform extra reads",
    );
    assert.equal(
      failed.writes.filter((entry) => entry.op === "delete-image").length,
      failure === "publish" ? 2 : 1,
    );
    assert.equal(
      await page.getByLabel("제목", { exact: true }).inputValue(),
      "업로드 재시도 이벤트",
    );
    assert.equal(
      await page.getByLabel("본문", { exact: true }).inputValue(),
      eventBody,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "새 이미지 제거", exact: true })
        .count(),
      2,
    );
    await page.evaluate(() => {
      window.developerLogQa.failUploadAt = 0;
    });
    await submit.click();
    if (!editing) await page.waitForURL(/fixture-created/);
    await page.waitForFunction(() =>
      window.developerLogQa.toasts.some((entry) => entry.tone === "success"),
    );
    const completed = await page.evaluate(() => window.developerLogQa);
    const result =
      completed.documents[editing ? "fixture-event" : "fixture-created"];
    assert.equal(result.title, "업로드 재시도 이벤트");
    assert.equal(result.bodyHtml, eventBody);
    assert.equal(result.images.length, editing ? 3 : 2);
    await page
      .getByRole("heading", { name: "업로드 재시도 이벤트", exact: true })
      .waitFor();
    if (editing) {
      assert.equal(
        result.action,
        "wispi",
        "Editing preserves the configured action",
      );
      assert.equal(
        await page.getByRole("link", { name: "위스피 하러 가기" }).count(),
        1,
      );
    }
    assert.equal(
      completed.reservations.length,
      editing ? 0 : 1,
      "Retry reuses its locally reserved post ID",
    );
    assert.equal(
      completed.writes.filter((entry) => entry.op === "update").length,
      editing ? 1 : 0,
    );
    assert.equal(
      completed.writes.filter((entry) => entry.op === "set").length,
      editing ? 0 : failure === "publish" ? 2 : 1,
    );
    if (editing) {
      assert.equal(result.viewCount, 3);
      assert.equal(result.likeCount, 2);
      const update = completed.writes.find(
        (entry) => entry.op === "update",
      ).data;
      assert.equal("viewCount" in update, false);
      assert.equal("likeCount" in update, false);
      assert.equal(
        result.images[0].imageStoragePath,
        before.original.images[0].imageStoragePath,
      );
    }
    checks.push({
      failure,
      failedDocumentWrites: failure === "publish" ? 1 : 0,
      failedDocumentsCreated: 0,
      draftPreserved: true,
      retryDocumentsCreated: editing ? 0 : 1,
      duplicateClicksBlocked: true,
      originalCountersPreserved: editing,
    });
    await page.close();
  }
  for (const scenario of [
    "empty",
    "failure",
    "more-failure",
    "permission",
    "closed",
    "account",
    "role",
    "post",
  ]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await page.goto(`${origin}/?identity=teacher#/developer-log/fixture-post`);
    const opener = page.getByRole("button", {
      name: "좋아요 누른 학생 보기",
      exact: true,
    });
    await opener.waitFor();
    await page.evaluate((scenario) => {
      const qa = window.developerLogQa;
      qa.emptyLikeStudents = scenario === "empty";
      qa.failLikeStudents = scenario === "failure";
      qa.holdLikeStudents = ["closed", "account", "role", "post"].includes(
        scenario,
      );
    }, scenario);
    await opener.click();
    const dialog = page.getByRole("dialog", {
      name: "좋아요 누른 학생",
      exact: true,
    });
    if (scenario === "empty") {
      await dialog
        .getByText("좋아요를 누른 학생이 없습니다.", { exact: true })
        .waitFor();
      assert.equal(await dialog.getByRole("listitem").count(), 0);
    } else if (["failure", "more-failure", "permission"].includes(scenario)) {
      if (scenario !== "failure") {
        await dialog.getByText("명단 학생 40", { exact: true }).waitFor();
        await page.evaluate((scenario) => {
          window.developerLogQa.failLikeStudents = true;
          if (scenario === "permission")
            window.developerLogQa.likeStudentsErrorCode =
              "functions/permission-denied";
        }, scenario);
        await dialog
          .getByRole("button", { name: "더 보기", exact: true })
          .click();
      }
      await dialog.getByRole("alert").waitFor();
      assert.equal(
        await dialog.getByRole("listitem").count(),
        scenario === "more-failure" ? 40 : 0,
      );
      await dialog
        .getByRole("button", { name: "다시 시도", exact: true })
        .click();
      await dialog
        .getByText(
          scenario === "more-failure" ? "명단 학생 80" : "명단 학생 40",
          { exact: true },
        )
        .waitFor();
      assert.equal(await dialog.getByRole("alert").count(), 0);
      const calls = await page.evaluate(
        () => window.developerLogQa.likeStudentCalls,
      );
      assert.equal(calls.length, scenario !== "failure" ? 3 : 2);
      if (scenario === "permission")
        assert.equal(
          calls.at(-1).cursor,
          undefined,
          "Permission denial clears earlier names and restarts only after explicit action",
        );
      else
        assert.equal(
          calls.at(-1).cursor,
          calls.at(-2).cursor,
          "Retry the failed page only",
        );
      await dialog.getByRole("button", { name: "닫기", exact: true }).click();
      await opener.click();
      await dialog.getByText("명단 학생 40", { exact: true }).waitFor();
      assert.equal(
        await dialog.getByRole("listitem").count(),
        40,
        "Reopen refreshes first page instead of caching student names",
      );
      assert.equal(
        (await page.evaluate(() => window.developerLogQa.likeStudentCalls)).at(
          -1,
        ).cursor,
        undefined,
      );
    } else {
      await dialog.locator(".ws-loading-slot").waitFor();
      assert.equal(
        await page.evaluate(
          () => window.developerLogQa.likeStudentCalls.length,
        ),
        1,
      );
      if (scenario === "closed") await page.keyboard.press("Escape");
      if (scenario === "account")
        await page.evaluate(() => window.developerLogQa.switchAccount());
      if (scenario === "role")
        await page.evaluate(() => window.developerLogQa.switchRole("student"));
      if (scenario === "post")
        await page.evaluate(() => {
          location.hash = "/developer-log/fixture-event";
        });
      await dialog.waitFor({ state: "detached" });
      await page.evaluate(() => {
        window.developerLogQa.holdLikeStudents = false;
        window.developerLogQa.releaseLikeStudents();
      });
      await page.waitForTimeout(60);
      assert.equal(await dialog.count(), 0);
      assert.equal(
        await page
          .getByText("긴 이름도 생략하지 않는 검증 학생", { exact: true })
          .count(),
        0,
        "Stale response cannot expose old names",
      );
      assert.equal(
        await page.evaluate(
          () => window.developerLogQa.likeStudentCalls.length,
        ),
        1,
        "Account/role/post changes never trigger automatic roster reads",
      );
      if (scenario === "role") assert.equal(await opener.count(), 0);
      if (scenario === "post") {
        await opener.click();
        await dialog.getByText("명단 학생 40", { exact: true }).waitFor();
        assert.equal(
          (
            await page.evaluate(() => window.developerLogQa.likeStudentCalls)
          ).at(-1).postId,
          "fixture-event",
        );
        await page.evaluate(() => {
          location.hash = "/developer-log/fixture-post";
        });
        await dialog.waitFor({ state: "detached" });
        await page
          .getByRole("heading", { name: "개발자 일지 화면 개선", exact: true })
          .waitFor();
        assert.equal(
          await page.evaluate(
            () => window.developerLogQa.likeStudentCalls.length,
          ),
          2,
          "Returning to a previous post does not reopen its old roster",
        );
      }
    }
    if (await dialog.count()) {
      await dialog.click({ position: { x: 2, y: 2 } });
      assert.equal(
        await dialog.count(),
        0,
        "Clicking outside closes the modal",
      );
    }
    assert.deepEqual(
      await page.evaluate(() => window.developerLogQa.writes),
      [],
    );
    assert.deepEqual(errors, []);
    checks.push({ rosterScenario: scenario, zeroWrites: true });
    await page.close();
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
