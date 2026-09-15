// Actual Dashboard, editor, image compression and callable transport; synthetic backend only.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const output = mkdtempSync(join(tmpdir(), "westory-banner-ui-"));
const mock = join(output, "backend.tsx");
writeFileSync(mock, `
import React from '${root.replaceAll("\\", "/")}/node_modules/react/index.js';
const scenario=new URLSearchParams(location.search).get('scenario')||'normal';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const useAuth=()=>({config:{year:'2026',semester:'2'},configReady:true,currentUser:{uid:'fixture-teacher',email:'fixture@example.test'},userData:{role:scenario==='readonly'?'staff':'teacher',name:'검증 교사'}});
export const db={}; export const auth={currentUser:{uid:'fixture-teacher'}};
export const doc=()=>({}); export const getDoc=async()=>({exists:()=>false,data:()=>undefined});
export const collection=(_db,...paths)=>({path:paths.join('/')});
export const query=reference=>reference;export const orderBy=()=>({});export const limit=()=>({});
export const getDocs=async reference=>{if(reference.path.startsWith('site_settings/'))return {docs:[{id:'post-1',data:()=>({title:'학교 소식',publishedAt:'2026-01-01T00:00:00Z',version:'1.0'})}]};if(reference.path!=='years/2026/semesters/2/notices')throw Error('Wrong banner path: '+reference.path);state.reads++;await wait(20);return {docs:state.notices.map(item=>({id:item.id,data:()=>({...item})}))};};
export const onSnapshot=(_ref,next)=>{queueMicrotask(()=>next({exists:()=>false,data:()=>undefined}));return ()=>{};};
export const getFirebaseStorage=()=>{throw Error('Direct storage is forbidden');};
export const ref=()=>{};export const deleteObject=()=>{};export const getDownloadURL=()=>{};export const uploadBytes=()=>{throw Error('Direct storage is forbidden');};
const fixtureCanvas=document.createElement('canvas');fixtureCanvas.width=1200;fixtureCanvas.height=675;
const fixtureContext=fixtureCanvas.getContext('2d');fixtureContext.fillStyle='#2563eb';fixtureContext.fillRect(0,0,1200,675);fixtureContext.fillStyle='white';fixtureContext.font='bold 64px sans-serif';fixtureContext.textAlign='center';fixtureContext.fillText('WESTORY',600,360);
const pixel=fixtureCanvas.toDataURL('image/png');
const record=(id,content,fields={})=>({id,content,imageUrl:pixel,imageStoragePath:'notices/'+id+'.webp',revision:1,noticeOrder:0,targetType:'common',category:'notice',publishAt:null,expiresAt:null,...fields});
const seeded=['manage','conflict','edit-conflict'].includes(scenario)?[
 record('active','게시 중 배너',{noticeOrder:0}),
 record('scheduled','예약 배너',{noticeOrder:1,publishAt:'2099-09-15T00:00:00.000Z',expiresAt:'2099-09-30T14:59:00.000Z',category:'normal',targetDate:'2099-09-20'}),
 record('expired','종료 배너',{noticeOrder:2,publishAt:'2020-09-01T00:00:00.000Z',expiresAt:'2020-09-02T00:00:00.000Z'}),
 record('class','학급 배너',{noticeOrder:3,targetType:'class',targetClass:'2-1'}),
]:scenario==='clock'?[record('clock','시각 경계 배너',{publishAt:new Date(Date.now()+2000).toISOString(),expiresAt:new Date(Date.now()+4500).toISOString()})]:[];
const state=window.__bannerFixture={calls:[],notices:seeded,reads:0};
export const loadVisibleNotices=async()=>{state.reads++;await wait(20);return state.notices;};
export const getHttpsCallable=async(name,options)=>async payload=>{
 if(!['registerSchoolBanner','manageSchoolBanners'].includes(name)||options.expectedUid!=='fixture-teacher')throw Error('Wrong command identity');
 state.calls.push({...payload,command:name});await wait(180);
 if(scenario==='retry'&&state.calls.length<=2)throw Object.assign(Error('Synthetic unavailable'),{code:'functions/unavailable'});
 if(scenario==='denied')throw Object.assign(Error('Synthetic denied'),{code:'functions/permission-denied'});
 if(scenario==='conflict'&&name==='manageSchoolBanners'||scenario==='edit-conflict'&&payload.noticeId)throw Object.assign(Error('Synthetic revision conflict'),{code:'functions/aborted'});
 if(name==='manageSchoolBanners'){
   if(payload.action==='REORDER'){
     if(payload.items.some(item=>!state.notices.some(existing=>existing.id===item.id&&existing.revision===item.revision)))throw Error('Bad expected revisions');
     state.notices=payload.items.map((item,index)=>({...state.notices.find(existing=>existing.id===item.id),noticeOrder:index,revision:item.revision+1}));
   } else if(payload.action==='DELETE'){
     if(!state.notices.some(item=>item.id===payload.noticeId&&item.revision===payload.expectedRevision))throw Error('Bad delete revision');
     state.notices=state.notices.filter(item=>item.id!==payload.noticeId);
   } else throw Error('Unknown management action');
   return {data:{ok:true}};
 }
 const previous=state.notices.find(item=>item.id===payload.noticeId);
 if(payload.noticeId&&(!previous||previous.revision!==payload.expectedRevision))throw Error('Bad update revision');
 const saved={...record(payload.noticeId||'fixture-notice-'+state.calls.length,payload.title),...previous,...payload,content:payload.title,revision:(previous?.revision||0)+1,imageUrl:payload.contentBase64?'data:image/webp;base64,'+payload.contentBase64:previous?.imageUrl};
 state.notices=previous?state.notices.map(item=>item.id===previous.id?saved:item):[...state.notices,saved];
 return {data:{noticeId:saved.id,imageUrl:saved.imageUrl,revision:saved.revision,replayed:state.calls.length>1}};
};
export class W8DomainError extends Error {constructor(kind,message){super(message);this.kind=kind;}}
export const toW8LocalDateTimeInput=value=>String(value).slice(0,16);
export const toW8ServerDateTime=value=>new Date(value).toISOString();
export const toW8StatePanelState=()=> 'ERROR_RETRYABLE';
export const getArchiveEnrollmentState=async()=>({semesterId:'2026-2',classes:[]});
export const getW8DomainState=async()=>({semesterId:'2026-2',domain:'SCHEDULE',readOnly:false,manifestRevision:1,scheduleEvents:[]});
export const createScheduleEvent=()=>{};export const updateScheduleEvent=()=>{};export const deleteScheduleEvent=()=>{};
export const getKoreanPublicHolidays=async()=>[];export const mergeEventsWithKoreanPublicHolidays=events=>events;
export default function Ranking(){return <section aria-label="위스 순위">위스 순위</section>;}
`);
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Dashboard from './src/pages/teacher/Dashboard';createRoot(document.getElementById('root')).render(<Dashboard/>);`, resolveDir: root, loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", metafile: true,
  define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
  plugins: [{ name: "synthetic-backend", setup(api) {
    api.onResolve({ filter: /AuthContext$|\/firebase$|firebase\/firestore$|firebase\/storage$|\/archiveEnrollment$|\/w8Domains$|\/koreanPublicHolidays$|\/WisRankingPanel$|\/visibleSchedule$/ }, () => ({ path: mock }));
  } }],
});
const inputs = Object.keys(bundle.metafile.inputs);
assert.ok(!inputs.some(path => /node_modules\/(?:@firebase|firebase)\//u.test(path)));
for (const source of ["teacher/Dashboard.tsx", "SchoolBannerModal.tsx", "SchoolBannerManager.tsx", "ModalSurface.tsx", "noticeImages.ts", "schoolBanners.ts", "permissions.ts"]) {
  assert.ok(inputs.some(path => path.endsWith(source)), `Missing actual source: ${source}`);
}
const cssFile = readdirSync(join(root, "dist/assets")).find(name => /^main-.*\.css$/u.test(name));
assert.ok(cssFile, "Run npm run build first");
const css = readFileSync(join(root, "dist/assets", cssFile), "utf8") + "\n" + readFileSync(join(root, "src/assets/index.css"), "utf8");
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  res.setHeader("Content-Security-Policy", "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data: blob:;script-src 'self'");
  res.setHeader("Content-Type", path === "/app.js" ? "text/javascript" : path === "/app.css" ? "text/css" : "text/html");
  res.end(path === "/app.js" ? bundle.outputFiles[0].contents : path === "/app.css" ? css : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');
});
for(let attempt=0;;attempt++){
  try {
    await new Promise((resolve,reject)=>{
      const fail=error=>reject(error);server.once("error",fail);
      server.listen(42000+Math.floor(Math.random()*10000),"127.0.0.1",()=>{server.removeListener("error",fail);resolve();});
    });
    break;
  } catch(error) {if(error.code!=="EADDRINUSE"||attempt>=5)throw error;}
}
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
let activePage;
const checks = [];
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  activePage = page;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const banner = page.getByRole("region", { name: "학교 배너", exact: true });
  const manager = page.getByRole("dialog", { name: "학교 배너 관리", exact: true });
  const preview = page.getByRole("dialog", { name: "학교 배너 미리보기", exact: true });
  const form = manager.locator("form");
  const field = name => form.getByLabel(name, { exact: true });
  const button = name => manager.getByRole("button", { name, exact: true });
  const calls = () => page.evaluate(() => window.__bannerFixture.calls);
  const titles = async () => (await manager.locator("ol > li h3").allTextContents()).map(text => text.replace(/^\d+\.\s*/, ""));
  const row = title => manager.locator("ol > li").filter({ has: page.getByRole("heading", { name: new RegExp(`(?:^|\\s)${title}$`) }) });
  const sameDialog = async () => assert.equal(await page.evaluate(() => document.querySelector('dialog[open]') === window.__originalDialog && document.querySelectorAll('dialog[open]').length === 1), true, "Operations must retain a single native dialog");
  const open = async (scenario = "normal") => {
    await page.goto(`${base}/?scenario=${scenario}`);
    assert.equal(await banner.getByRole("button", { name: "+ 등록", exact: true }).count(), 0);
    await banner.getByRole("button", { name: "배너 관리", exact: true }).click();
    await manager.waitFor();
    await manager.getByRole("heading", { name: /새 배너 등록|학교 배너 등록/, exact: true }).waitFor();
    await page.evaluate(() => { window.__originalDialog = document.querySelector('dialog[open]'); });
  };
  const close = async () => {
    await button("닫기").last().click();
    await manager.waitFor({ state: "hidden" });
  };
  const reopen = async () => {
    await close();
    await banner.getByRole("button", { name: "배너 관리", exact: true }).click();
    await manager.waitFor();
    await page.evaluate(() => { window.__originalDialog = document.querySelector('dialog[open]'); });
  };
  const image = async () => {
    const data = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720; const ctx = canvas.getContext("2d"); ctx.fillStyle = "#2563eb"; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = "white"; ctx.font = "bold 52px sans-serif"; ctx.fillText("WESTORY", 420, 375); return canvas.toDataURL("image/png").split(",")[1]; });
    await field("배너 이미지").setInputFiles({ name: "school.png", mimeType: "image/png", buffer: Buffer.from(data, "base64") });
    await form.locator("img").waitFor();
    assert.equal(await field("배너 이미지").evaluate(input => input.files?.[0]?.name), "school.png");
  };
  const saved = async title => {
    await row(title).waitFor();
    await page.waitForFunction(() => document.querySelector('#school-banner-title')?.value === '');
    await sameDialog();
  };
  const assertFits = async (width, height, strict = false, surface = manager) => {
    const bounds = await surface.evaluate(el => {
      const r = el.getBoundingClientRect();
      const scrolls = [el, ...el.querySelectorAll('*')].filter(node => {
        const style = getComputedStyle(node);
        return node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 1 && ['auto', 'scroll'].includes(style.overflowY);
      }).map(node => ({ tag: node.tagName, class: node.className, client: node.clientHeight, scroll: node.scrollHeight }));
      return { left: r.left, right: r.right, bottom: r.bottom, top: r.top, horizontal: el.scrollWidth > el.clientWidth + 1, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, scrolls };
    });
    assert.ok(bounds.left >= -1 && bounds.right <= width + 1 && bounds.top >= -1 && bounds.bottom <= height + 1, JSON.stringify(bounds));
    assert.equal(bounds.horizontal, false, JSON.stringify(bounds));
    assert.equal(bounds.pageOverflow, false, JSON.stringify(bounds));
    if (strict) assert.deepEqual(bounds.scrolls, [], `Desktop must not require internal scrolling: ${JSON.stringify(bounds.scrolls)}`);
    else assert.ok(bounds.scrolls.length <= 1, `Mobile must use at most one scrolling container: ${JSON.stringify(bounds.scrolls)}`);
  };
  for (const [width, height] of [[320,900],[390,900],[768,900],[1280,720],[1366,768],[1440,900]]) {
    await page.setViewportSize({ width, height });
    await open("manage");
    assert.deepEqual(await titles(), ["게시 중 배너", "예약 배너", "종료 배너"]);
    await field("배너 제목").fill("새 학기 학교 안내 배너"); await image();
    await assertFits(width, height, width >= 1280);
    await field("분류").selectOption("dday"); await field("D-Day 목표 날짜").fill("2099-09-20");
    await field("게시 대상").selectOption("class"); await field("학년").fill("2"); await field("반").fill("3");
    await assertFits(width, height, width >= 1280);
    await page.screenshot({ animations: "disabled", path: join(output, `combined-${width}x${height}.png`) });
    await button("크게 미리보기").click(); await preview.waitFor(); await sameDialog();
    await assertFits(width, height, false, preview);
    await page.keyboard.press("Escape"); await manager.waitFor(); await sameDialog();
    assert.equal(await field("배너 제목").inputValue(), "새 학기 학교 안내 배너");
    assert.equal(await field("게시 대상").inputValue(), "class");
    await page.waitForFunction(() => document.activeElement?.textContent === '크게 미리보기');
    await field("게시 대상").selectOption("common"); await field("분류").selectOption("notice");
    await button("등록").click();
    await page.waitForFunction(() => window.__bannerFixture.calls.length === 1 && window.__bannerFixture.notices.length === 5);
    await page.waitForFunction(() => document.querySelector('#school-banner-title')?.value === ''); await sameDialog();
    await assertFits(width, height, width >= 1280);
    const payload = (await calls())[0]; assert.equal(payload.semesterId, "2026-2"); assert.ok(payload.contentBase64.length > 100); assert.ok(payload.requestId);
    checks.push(`combined-layout-no-scroll-and-preview-draft-${width}x${height}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(); await image(); await close(); assert.equal((await calls()).length, 0);
  await banner.getByRole("button", { name: "배너 관리", exact: true }).click(); await manager.waitFor(); await page.keyboard.press("Escape"); await manager.waitFor({ state: "hidden" });
  if (!(await banner.getByRole("button", { name: "배너 관리", exact: true }).evaluate(el => el === document.activeElement))) errors.push("Escape close did not return focus to banner management button"); checks.push("close-escape-no-write-focus-return");
  await open(); assert.equal(await button("등록").isDisabled(), true);
  await field("배너 이미지").setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") }); await manager.getByRole("alert").waitFor(); assert.equal(await button("등록").isDisabled(), true);
  await field("배너 제목").fill("   "); await image(); await button("등록").click(); assert.match(await manager.getByRole("alert").innerText(), /제목과 이미지/); assert.equal((await calls()).length, 0); checks.push("invalid-file-and-empty-title");
  await open("retry"); await field("배너 제목").fill("재시도 배너"); await image(); await button("등록").click(); await manager.getByRole("alert").waitFor(); assert.equal((await calls()).length, 2); await button("등록").click(); await saved("재시도 배너"); const retried = await calls(); assert.equal(retried.length, 3); assert.equal(new Set(retried.map(call => call.requestId)).size, 1); checks.push("automatic-and-user-retry-same-request-id");
  await open(); await field("배너 제목").fill("중복 방지 배너"); await image(); await form.evaluate(el => { el.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); el.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await page.waitForFunction(() => window.__bannerFixture.calls.length === 1); await page.keyboard.press("Escape"); assert.equal(await manager.isVisible(), true); await saved("중복 방지 배너"); assert.equal((await calls()).length, 1); checks.push("double-submit-and-saving-dismiss-guard");
  await open("denied"); await field("배너 제목").fill("권한 확인"); await image(); await button("등록").click(); await manager.getByRole("alert").waitFor(); assert.match(await manager.getByRole("alert").innerText(), /저장 권한/); checks.push("permission-error-actionable");
  await page.goto(`${base}/?scenario=readonly`); await banner.waitFor(); assert.equal(await banner.getByRole("button", { name: "배너 관리", exact: true }).count(), 0); assert.equal((await calls()).length, 0); checks.push("readonly-staff-no-management");
  await open(); await field("배너 제목").fill("미래 행사 안내"); await image();
  await field("게시 시작").fill("2099-09-15T09:00"); await field("게시 종료").fill("2099-09-15T08:00"); await button("등록").click(); assert.match(await manager.getByRole("alert").innerText(), /게시 종료는 게시 시작보다/); assert.equal((await calls()).length, 0);
  await field("게시 종료").fill("2099-09-30T23:59"); await field("분류").selectOption("dday"); await field("D-Day 목표 날짜").fill("2099-09-20"); await field("연동 게시물").selectOption("post-1"); await button("등록").click(); await saved("미래 행사 안내");
  const scheduledPayload = (await calls())[0]; assert.equal(scheduledPayload.publishAt, "2099-09-15T00:00:00.000Z"); assert.equal(scheduledPayload.expiresAt, "2099-09-30T14:59:00.000Z"); assert.equal(scheduledPayload.targetDate, "2099-09-20"); assert.equal(scheduledPayload.developerLogPostId, "post-1"); assert.equal(await banner.getByRole("img", { name: "미래 행사 안내", exact: true }).count(), 0); assert.match(await row("미래 행사 안내").innerText(), /예약 게시/); checks.push("period-validation-kst-and-scheduled-registration");
  const originalImage = await page.evaluate(() => window.__bannerFixture.notices[0].imageUrl);
  await row("미래 행사 안내").getByRole("button", { name: "수정", exact: true }).click(); await manager.getByRole("heading", { name: /배너 수정/, exact: true }).waitFor(); await sameDialog();
  assert.equal(await field("게시 시작").inputValue(), "2099-09-15T09:00"); assert.equal(await field("D-Day 목표 날짜").inputValue(), "2099-09-20");
  await field("배너 제목").fill("수정한 미래 행사"); await field("게시 대상").selectOption("class"); await field("학년").fill("2"); await field("반").fill("3"); await button("수정 저장").click(); await saved("수정한 미래 행사");
  const edited = (await calls()).at(-1); assert.equal(edited.noticeId, "fixture-notice-1"); assert.equal(edited.expectedRevision, 1); assert.equal(edited.targetClass, "2-3"); assert.equal(edited.contentBase64, undefined); assert.equal(edited.developerLogPostId, "post-1"); assert.equal(await page.evaluate(() => window.__bannerFixture.notices[0].imageUrl), originalImage); checks.push("metadata-edit-retains-image-link-and-single-dialog");
  await open("manage"); await button("다음 페이지").click(); assert.deepEqual(await titles(), ["학급 배너"]); await button("이전 페이지").click(); assert.deepEqual(await titles(), ["게시 중 배너", "예약 배너", "종료 배너"]); await sameDialog(); checks.push("list-pagination-without-scroll");
  await field("배너 제목").fill("목록 미리보기 중 유지할 초안");
  await row("예약 배너").getByRole("button", { name: "예약 배너 미리보기", exact: true }).click(); await preview.waitFor(); await sameDialog(); await preview.getByRole("img", { name: "예약 배너", exact: true }).waitFor(); await page.screenshot({ animations: "disabled", path: join(output, "preview-desktop.png") });
  await page.keyboard.press("Escape"); await manager.waitFor(); await sameDialog(); assert.equal(await field("배너 제목").inputValue(), "목록 미리보기 중 유지할 초안");
  await page.keyboard.press("Tab"); assert.equal(await manager.evaluate(el => el.contains(document.activeElement)), true); await page.keyboard.press("Shift+Tab"); assert.equal(await manager.evaluate(el => el.contains(document.activeElement)), true); checks.push("list-preview-retains-form-and-keyboard-focus"); await button("취소").click();
  await row("예약 배너").getByRole("button", { name: "예약 배너 위로 이동", exact: true }).click(); assert.deepEqual(await titles(), ["예약 배너", "게시 중 배너", "종료 배너"]); await button("순서 저장").click(); await page.waitForFunction(() => window.__bannerFixture.notices[0].id === 'scheduled' && window.__bannerFixture.notices[0].revision === 2); await sameDialog(); await reopen(); assert.deepEqual(await titles(), ["예약 배너", "게시 중 배너", "종료 배너"]);
  const reorder = (await calls()).at(-1); assert.deepEqual(reorder.items.map(item => item.id), ["scheduled", "active", "expired", "class"]); assert.ok(reorder.items.every(item => item.revision === 1)); checks.push("reorder-persists-all-pages-with-revisions");
  await row("종료 배너").getByRole("button", { name: "삭제", exact: true }).click(); await button("삭제 취소").click(); assert.equal((await calls()).length, 1);
  await row("종료 배너").getByRole("button", { name: "삭제", exact: true }).click(); await button("배너 삭제").click(); await row("종료 배너").waitFor({ state: "hidden" }); await sameDialog();
  const deletion = (await calls()).at(-1); assert.equal(deletion.noticeId, "expired"); assert.equal(deletion.expectedRevision, 2); await reopen(); assert.deepEqual(await titles(), ["예약 배너", "게시 중 배너", "학급 배너"]); checks.push("delete-confirm-cancel-and-single-dialog-persistence");
  await open("conflict"); await row("예약 배너").getByRole("button", { name: "예약 배너 위로 이동", exact: true }).click(); await button("순서 저장").click(); await manager.getByRole("alert").waitFor(); assert.match(await manager.getByRole("alert").innerText(), /다시 불러|다시 열/); assert.equal(await button("순서 저장").isDisabled(), true); assert.deepEqual(await titles(), ["예약 배너", "게시 중 배너", "종료 배너"]); await reopen(); assert.deepEqual(await titles(), ["게시 중 배너", "예약 배너", "종료 배너"]); checks.push("stale-revision-preserves-and-reloads-records");
  await open("manage"); await row("예약 배너").getByRole("button", { name: "수정", exact: true }).click(); assert.equal(await field("분류").inputValue(), "normal"); await field("배너 제목").fill("기존 분류 유지"); await button("수정 저장").click(); await saved("기존 분류 유지"); assert.equal((await calls()).at(-1).category, "normal"); checks.push("legacy-normal-category-preserved");
  await open("edit-conflict"); await row("예약 배너").getByRole("button", { name: "수정", exact: true }).click(); await field("배너 제목").fill("보존할 수정 내용"); await button("수정 저장").click(); await manager.getByRole("alert").waitFor(); assert.match(await manager.getByRole("alert").innerText(), /다른 변경/); assert.equal(await field("배너 제목").inputValue(), "보존할 수정 내용"); assert.equal((await calls()).length, 1); checks.push("edit-conflict-retains-draft");
  await open("manage"); await close(); await banner.getByRole("img", { name: "게시 중 배너", exact: true }).waitFor(); for (const title of ["예약 배너", "종료 배너", "학급 배너"]) assert.equal(await banner.getByRole("img", { name: title, exact: true }).count(), 0);
  await banner.getByRole("button", { name: "현재 학교 배너 미리보기", exact: true }).click(); await preview.waitFor(); await page.keyboard.press("Escape"); await preview.waitFor({ state: "hidden" }); checks.push("public-carousel-target-period-filter-and-preview");
  await page.goto(`${base}/?scenario=clock`); await banner.getByText("현재 게시 중인 공통 배너가 없습니다.", { exact: false }).waitFor(); await banner.getByRole("img", { name: "시각 경계 배너", exact: true }).waitFor({ timeout: 7000 }); await banner.getByRole("img", { name: "시각 경계 배너", exact: true }).waitFor({ state: "hidden", timeout: 7000 }); checks.push("publish-and-expire-without-refresh");
  assert.deepEqual(errors, []);
  writeFileSync(join(output, "result.json"), JSON.stringify({ passed: true, checks, inputs, errors, network: "blocked", productionWrites: 0 }, null, 2));
  console.log(JSON.stringify({ passed: true, output, checks }));
} catch (error) {
  await activePage?.screenshot({ animations: "disabled", path: join(output, "failure.png"), fullPage: true }).catch(() => {});
  writeFileSync(join(output, "failure.json"), JSON.stringify({ error: String(error), checks }, null, 2));
  console.error(`UI failure artifacts: ${output}`);
  throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
