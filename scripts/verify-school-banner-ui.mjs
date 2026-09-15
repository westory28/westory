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
const checks = [];
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const banner = page.getByRole("region", { name: "학교 배너", exact: true });
  const dialog = page.getByRole("dialog", { name: "학교 배너 등록", exact: true });
  const manager = page.getByRole("dialog", { name: "학교 배너 관리", exact: true });
  const editor = page.getByRole("dialog", { name: "학교 배너 수정", exact: true });
  const preview = page.getByRole("dialog", { name: "학교 배너 미리보기", exact: true });
  const calls = () => page.evaluate(() => window.__bannerFixture.calls);
  const openManager = async scenario => {
    if(scenario) await page.goto(`${base}/?scenario=${scenario}`);
    await banner.getByRole("button",{name:"배너 관리",exact:true}).click();
    await manager.waitFor();
  };
  const titles = () => manager.locator("ol > li h3").allTextContents();
  const row = title => manager.locator("ol > li").filter({has:page.getByRole("heading",{name:title,exact:true})});
  const open = async scenario => {
    await page.goto(`${base}/?scenario=${scenario}`);
    await banner.getByRole("button", { name: "+ 등록", exact: true }).click();
    await dialog.waitFor();
    await page.waitForFunction(() => document.activeElement?.id === "school-banner-title");
  };
  const image = async () => {
    const data = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 1280; c.height = 720; const ctx = c.getContext("2d"); ctx.fillStyle = "#2563eb"; ctx.fillRect(0,0,c.width,c.height); ctx.fillStyle = "white"; ctx.font = "bold 52px sans-serif"; ctx.fillText("WESTORY",420,375); return c.toDataURL("image/png").split(",")[1]; });
    await dialog.getByLabel("배너 이미지", { exact: true }).setInputFiles({ name: "school.png", mimeType: "image/png", buffer: Buffer.from(data,"base64") });
    await dialog.locator("img").waitFor();
    assert.equal(await dialog.getByLabel("배너 이미지", { exact: true }).evaluate(input => input.files?.[0]?.name), "school.png", "Selected filename stays visible after image preparation");
  };
  const assertFits = async (width, surface = dialog) => {
    const bounds = await surface.evaluate(el => {const r=el.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,top:r.top,innerOverflow:el.scrollWidth>el.clientWidth+1,pageOverflow:document.documentElement.scrollWidth>innerWidth+1};});
    assert.ok(bounds.left >= 0 && bounds.right <= width+1 && bounds.top>=0 && bounds.bottom<=901, JSON.stringify(bounds));
    assert.equal(bounds.innerOverflow,false); assert.equal(bounds.pageOverflow,false);
  };
  for (const width of [320,390,768,1280,1440]) {
    await page.setViewportSize({width,height:900});
    await open("normal");
    await dialog.getByLabel("배너 제목",{exact:true}).fill("새 학기 학교 안내 배너");
    await image();
    await assertFits(width);
    await dialog.getByRole("button",{name:"크게 미리보기",exact:true}).click();await preview.waitFor();await assertFits(width,preview);
    await preview.press("Escape");await dialog.waitFor();await page.waitForFunction(()=>document.activeElement?.textContent==='크게 미리보기');
    await page.screenshot({animations:"disabled",path:join(output,`modal-${width}.png`)});
    await dialog.getByRole("button",{name:"등록",exact:true}).click();
    await dialog.waitFor({state:"hidden"});
    await banner.getByRole("img",{name:"새 학기 학교 안내 배너",exact:true}).waitFor();
    assert.equal((await calls()).length,1);
    const payload=(await calls())[0];assert.equal(payload.semesterId,"2026-2");assert.ok(payload.contentBase64.length>100);assert.ok(payload.requestId);
    await page.screenshot({animations:"disabled",path:join(output,`saved-${width}.png`),fullPage:true});
    checks.push(`register-preview-refresh-${width}`);
  }
  await open("normal");await image();await dialog.getByRole("button",{name:"취소",exact:true}).click();await dialog.waitFor({state:"hidden"});assert.equal((await calls()).length,0);
  await banner.getByRole("button",{name:"+ 등록",exact:true}).click();await dialog.waitFor();await dialog.press("Escape");await dialog.waitFor({state:"hidden"});assert.equal(await banner.getByRole("button",{name:"+ 등록",exact:true}).evaluate(el=>el===document.activeElement),true);assert.equal((await calls()).length,0);checks.push("cancel-and-escape-no-writes-focus-return");
  await open("normal");assert.equal(await dialog.getByRole("button",{name:"등록",exact:true}).isDisabled(),true);
  await dialog.getByLabel("배너 이미지",{exact:true}).setInputFiles({name:"bad.txt",mimeType:"text/plain",buffer:Buffer.from("invalid")});await dialog.getByRole("alert").waitFor();assert.equal(await dialog.getByRole("button",{name:"등록",exact:true}).isDisabled(),true);
  await dialog.getByLabel("배너 제목",{exact:true}).fill("   ");await image();await dialog.getByRole("button",{name:"등록",exact:true}).click();assert.match(await dialog.getByRole("alert").innerText(),/제목과 이미지/);assert.equal((await calls()).length,0);checks.push("invalid-file-and-empty-title");
  await open("retry");await dialog.getByLabel("배너 제목",{exact:true}).fill("재시도 배너");await image();await dialog.getByRole("button",{name:"등록",exact:true}).click();await dialog.getByRole("alert").waitFor();assert.equal((await calls()).length,2);await dialog.getByRole("button",{name:"등록",exact:true}).click();await dialog.waitFor({state:"hidden"});const retried=await calls();assert.equal(retried.length,3);assert.equal(new Set(retried.map(call=>call.requestId)).size,1);checks.push("automatic-and-user-retry-same-request-id");
  await open("normal");await dialog.getByLabel("배너 제목",{exact:true}).fill("중복 방지 배너");await image();await dialog.locator("form").evaluate(form=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});await page.waitForFunction(()=>window.__bannerFixture.calls.length===1);await page.keyboard.press("Escape");assert.equal(await dialog.isVisible(),true);await dialog.waitFor({state:"hidden"});assert.equal((await calls()).length,1);checks.push("double-submit-and-saving-dismiss-guard");
  await open("denied");await dialog.getByLabel("배너 제목",{exact:true}).fill("권한 확인");await image();await dialog.getByRole("button",{name:"등록",exact:true}).click();await dialog.getByRole("alert").waitFor();assert.match(await dialog.getByRole("alert").innerText(),/저장 권한/);assert.equal((await calls()).length,1);checks.push("permission-error-actionable");
  await page.goto(`${base}/?scenario=readonly`);await banner.waitFor();assert.equal(await banner.getByRole("button",{name:"+ 등록",exact:true}).count(),0);assert.equal((await calls()).length,0);checks.push("readonly-staff-no-registration");
  assert.equal(await banner.getByRole("button",{name:"배너 관리",exact:true}).count(),0);
  await open("normal");await dialog.getByLabel("배너 제목",{exact:true}).fill("미래 행사 안내");await image();
  await dialog.getByLabel("게시 시작",{exact:true}).fill("2099-09-15T09:00");await dialog.getByLabel("게시 종료",{exact:true}).fill("2099-09-15T08:00");
  await dialog.getByRole("button",{name:"등록",exact:true}).click();assert.match(await dialog.getByRole("alert").innerText(),/게시 종료는 게시 시작보다/);assert.equal((await calls()).length,0);
  await dialog.getByLabel("게시 종료",{exact:true}).fill("2099-09-30T23:59");
  await dialog.getByLabel("분류",{exact:true}).selectOption("dday");await dialog.getByLabel("D-Day 목표 날짜",{exact:true}).fill("2099-09-20");
  await dialog.getByLabel("연동 게시물",{exact:true}).selectOption("post-1");
  await dialog.getByRole("button",{name:"등록",exact:true}).click();await dialog.waitFor({state:"hidden"});
  let scheduledPayload=(await calls())[0];assert.equal(scheduledPayload.publishAt,"2099-09-15T00:00:00.000Z");assert.equal(scheduledPayload.expiresAt,"2099-09-30T14:59:00.000Z");assert.equal(scheduledPayload.targetDate,"2099-09-20");assert.equal(scheduledPayload.category,"dday");assert.equal(scheduledPayload.developerLogPostId,"post-1");
  assert.equal(await banner.getByRole("img",{name:"미래 행사 안내",exact:true}).count(),0);await openManager();assert.deepEqual(await titles(),["미래 행사 안내"]);assert.match(await row("미래 행사 안내").innerText(),/예약 게시/);checks.push("period-validation-kst-payload-and-scheduled-registration");
  const originalImage=await page.evaluate(()=>window.__bannerFixture.notices[0].imageUrl);
  await row("미래 행사 안내").getByRole("button",{name:"수정",exact:true}).click();await editor.waitFor();
  assert.equal(await editor.getByLabel("게시 시작",{exact:true}).inputValue(),"2099-09-15T09:00");assert.equal(await editor.getByLabel("게시 종료",{exact:true}).inputValue(),"2099-09-30T23:59");assert.equal(await editor.getByLabel("D-Day 목표 날짜",{exact:true}).inputValue(),"2099-09-20");
  await editor.getByLabel("배너 제목",{exact:true}).fill("수정한 미래 행사");await editor.getByLabel("게시 대상",{exact:true}).selectOption("class");await editor.getByLabel("학년",{exact:true}).fill("2");await editor.getByLabel("반",{exact:true}).fill("3");
  await editor.getByRole("button",{name:"크게 미리보기",exact:true}).click();await preview.waitFor();await preview.getByRole("button",{name:"편집으로 돌아가기",exact:true}).click();await editor.waitFor();
  await editor.getByRole("button",{name:"수정 저장",exact:true}).click();await editor.waitFor({state:"hidden"});await manager.waitFor();
  const editedPayload=(await calls()).at(-1);assert.equal(editedPayload.noticeId,'fixture-notice-1');assert.equal(editedPayload.expectedRevision,1);assert.equal(editedPayload.targetClass,"2-3");assert.equal(editedPayload.targetType,"class");assert.equal(editedPayload.contentBase64,undefined);assert.equal(editedPayload.developerLogPostId,"post-1");assert.equal(await page.evaluate(()=>window.__bannerFixture.notices[0].imageUrl),originalImage);checks.push("metadata-only-edit-retains-image-period-and-link");
  for(const width of [320,390,768,1280,1440]){
    await page.setViewportSize({width,height:900});
    await openManager("manage");
    assert.deepEqual(await titles(),["게시 중 배너","예약 배너","종료 배너","학급 배너"]);
    assert.match(await row("예약 배너").innerText(),/예약 게시/);
    assert.match(await row("종료 배너").innerText(),/게시 종료/);
    await assertFits(width,manager);
    await page.screenshot({animations:"disabled",path:join(output,`manager-${width}.png`)});
    await row("예약 배너").getByRole("button",{name:"예약 배너 미리보기",exact:true}).click();
    await preview.waitFor();await preview.getByRole("img",{name:"예약 배너",exact:true}).waitFor();
    await assertFits(width,preview);await page.screenshot({animations:"disabled",path:join(output,`preview-${width}.png`)});
    await preview.getByRole("button",{name:"목록으로",exact:true}).click();await manager.waitFor();
    await page.keyboard.press("Tab");assert.equal(await manager.evaluate(el=>el.contains(document.activeElement)),true);
    await page.keyboard.press("Shift+Tab");assert.equal(await manager.evaluate(el=>el.contains(document.activeElement)),true);
    checks.push(`manager-preview-keyboard-${width}`);
  }
  await manager.getByRole("button",{name:"닫기",exact:true}).last().click();await manager.waitFor({state:"hidden"});
  await banner.getByRole("img",{name:"게시 중 배너",exact:true}).waitFor();
  assert.equal(await banner.getByRole("img",{name:"예약 배너",exact:true}).count(),0);
  assert.equal(await banner.getByRole("img",{name:"종료 배너",exact:true}).count(),0);
  assert.equal(await banner.getByRole("img",{name:"학급 배너",exact:true}).count(),0);
  await banner.getByRole("button",{name:"현재 학교 배너 미리보기",exact:true}).click();await preview.waitFor();
  await preview.press("Escape");await preview.waitFor({state:"hidden"});checks.push("public-carousel-period-target-filter-and-preview");
  await openManager("manage");
  await row("예약 배너").getByRole("button",{name:"예약 배너 위로 이동",exact:true}).click();
  assert.deepEqual(await titles(),["예약 배너","게시 중 배너","종료 배너","학급 배너"]);
  await manager.getByRole("button",{name:"순서 저장",exact:true}).click();await manager.waitFor({state:"hidden"});
  let submitted=(await calls()).at(-1);assert.equal(submitted.action,"REORDER");assert.deepEqual(submitted.items.map(item=>item.id),["scheduled","active","expired","class"]);assert.ok(submitted.items.every(item=>item.revision===1));
  await openManager();assert.deepEqual(await titles(),["예약 배너","게시 중 배너","종료 배너","학급 배너"]);checks.push("reorder-persisted-after-reopen-with-revisions");
  await row("종료 배너").getByRole("button",{name:"삭제",exact:true}).click();
  await row("종료 배너").getByRole("button",{name:"삭제 취소",exact:true}).click();assert.equal((await calls()).length,1);
  await row("종료 배너").getByRole("button",{name:"삭제",exact:true}).click();
  await row("종료 배너").getByRole("button",{name:"배너 삭제",exact:true}).click();await manager.waitFor({state:"hidden"});
  submitted=(await calls()).at(-1);assert.equal(submitted.action,"DELETE");assert.equal(submitted.noticeId,"expired");assert.equal(submitted.expectedRevision,2);
  await openManager();assert.deepEqual(await titles(),["예약 배너","게시 중 배너","학급 배너"]);checks.push("delete-confirm-cancel-and-persistence");
  await openManager("conflict");await row("예약 배너").getByRole("button",{name:"예약 배너 위로 이동",exact:true}).click();await manager.getByRole("button",{name:"순서 저장",exact:true}).click();
  await manager.getByRole("alert").waitFor();assert.match(await manager.getByRole("alert").innerText(),/닫고 다시 불러온/);assert.equal(await manager.getByRole("button",{name:"순서 저장",exact:true}).isDisabled(),true);
  assert.deepEqual(await titles(),["예약 배너","게시 중 배너","종료 배너","학급 배너"]);
  assert.deepEqual(await page.evaluate(()=>window.__bannerFixture.notices.map(item=>item.id)),["active","scheduled","expired","class"]);
  await manager.getByRole("button",{name:"닫기",exact:true}).last().click();await openManager();assert.deepEqual(await titles(),["게시 중 배너","예약 배너","종료 배너","학급 배너"]);checks.push("stale-revision-keeps-records-and-reloads");
  await openManager("manage");await row("예약 배너").getByRole("button",{name:"수정",exact:true}).click();await editor.waitFor();
  assert.equal(await editor.getByLabel("분류",{exact:true}).inputValue(),"normal");
  await editor.getByLabel("배너 제목",{exact:true}).fill("기존 분류 유지");await editor.getByRole("button",{name:"수정 저장",exact:true}).click();await manager.waitFor();
  assert.equal((await calls()).at(-1).category,"normal");checks.push("legacy-normal-category-preserved");
  await openManager("edit-conflict");await row("예약 배너").getByRole("button",{name:"수정",exact:true}).click();await editor.waitFor();
  await editor.getByLabel("배너 제목",{exact:true}).fill("보존할 수정 내용");await editor.getByRole("button",{name:"수정 저장",exact:true}).click();await editor.getByRole("alert").waitFor();
  assert.match(await editor.getByRole("alert").innerText(),/다른 변경/);assert.equal(await editor.getByLabel("배너 제목",{exact:true}).inputValue(),"보존할 수정 내용");assert.equal((await calls()).length,1);checks.push("edit-conflict-retains-draft");
  await page.goto(`${base}/?scenario=clock`);await banner.getByText("현재 게시 중인 공통 배너가 없습니다.",{exact:false}).waitFor();
  await banner.getByRole("img",{name:"시각 경계 배너",exact:true}).waitFor({timeout:7000});
  await banner.getByRole("img",{name:"시각 경계 배너",exact:true}).waitFor({state:"hidden",timeout:7000});checks.push("publish-and-expire-without-refresh");
  assert.deepEqual(errors,[]);
  writeFileSync(join(output,"result.json"),JSON.stringify({passed:true,checks,inputs,errors,network:"blocked",productionWrites:0},null,2));
  console.log(JSON.stringify({passed:true,output,checks}));
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
