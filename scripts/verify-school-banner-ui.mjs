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
export const onSnapshot=(_ref,next)=>{queueMicrotask(()=>next({exists:()=>false,data:()=>undefined}));return ()=>{};};
export const getFirebaseStorage=()=>{throw Error('Direct storage is forbidden');};
export const ref=()=>{};export const deleteObject=()=>{};export const getDownloadURL=()=>{};export const uploadBytes=()=>{throw Error('Direct storage is forbidden');};
const state=window.__bannerFixture={calls:[],notices:[],reads:0};
export const loadVisibleNotices=async()=>{state.reads++;await wait(20);return state.notices;};
export const getHttpsCallable=async(name,options)=>async payload=>{
 if(name!=='registerSchoolBanner'||options.expectedUid!=='fixture-teacher')throw Error('Wrong command identity');
 state.calls.push({...payload});await wait(180);
 if(scenario==='retry'&&state.calls.length<=2)throw Object.assign(Error('Synthetic unavailable'),{code:'functions/unavailable'});
 if(scenario==='denied')throw Object.assign(Error('Synthetic denied'),{code:'functions/permission-denied'});
 state.notices=[{id:'fixture-notice',content:payload.title,imageUrl:'data:image/webp;base64,'+payload.contentBase64}];
 return {data:{noticeId:'fixture-notice',imageUrl:state.notices[0].imageUrl,replayed:state.calls.length>1}};
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
for (const source of ["teacher/Dashboard.tsx", "SchoolBannerModal.tsx", "ModalSurface.tsx", "noticeImages.ts", "schoolBanners.ts", "permissions.ts"]) {
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
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
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
  const calls = () => page.evaluate(() => window.__bannerFixture.calls);
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
  const assertFits = async width => {
    const bounds = await dialog.evaluate(el => {const r=el.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,top:r.top,innerOverflow:el.scrollWidth>el.clientWidth+1,pageOverflow:document.documentElement.scrollWidth>innerWidth+1};});
    assert.ok(bounds.left >= 0 && bounds.right <= width+1 && bounds.top>=0 && bounds.bottom<=901, JSON.stringify(bounds));
    assert.equal(bounds.innerOverflow,false); assert.equal(bounds.pageOverflow,false);
  };
  for (const width of [390,768,1280,1440]) {
    await page.setViewportSize({width,height:900});
    await open("normal");
    await dialog.getByLabel("배너 제목",{exact:true}).fill("새 학기 학교 안내 배너");
    await image();
    await assertFits(width);
    await page.screenshot({path:join(output,`modal-${width}.png`)});
    await dialog.getByRole("button",{name:"등록",exact:true}).click();
    await dialog.waitFor({state:"hidden"});
    await banner.getByRole("img",{name:"새 학기 학교 안내 배너",exact:true}).waitFor();
    assert.equal((await calls()).length,1);
    const payload=(await calls())[0];assert.equal(payload.semesterId,"2026-2");assert.ok(payload.contentBase64.length>100);assert.ok(payload.requestId);
    await page.screenshot({path:join(output,`saved-${width}.png`),fullPage:true});
    checks.push(`register-preview-refresh-${width}`);
  }
  await open("normal");await image();await dialog.getByRole("button",{name:"취소",exact:true}).click();await dialog.waitFor({state:"hidden"});assert.equal((await calls()).length,0);
  await banner.getByRole("button",{name:"+ 등록",exact:true}).click();await dialog.waitFor();await dialog.press("Escape");await dialog.waitFor({state:"hidden"});assert.equal(await banner.getByRole("button",{name:"+ 등록",exact:true}).evaluate(el=>el===document.activeElement),true);assert.equal((await calls()).length,0);checks.push("cancel-and-escape-no-writes-focus-return");
  await open("normal");assert.equal(await dialog.getByRole("button",{name:"등록",exact:true}).isDisabled(),true);
  await dialog.getByLabel("배너 이미지",{exact:true}).setInputFiles({name:"bad.txt",mimeType:"text/plain",buffer:Buffer.from("invalid")});await dialog.getByRole("alert").waitFor();assert.equal(await dialog.getByRole("button",{name:"등록",exact:true}).isDisabled(),true);
  await dialog.getByLabel("배너 제목",{exact:true}).fill("   ");await image();await dialog.getByRole("button",{name:"등록",exact:true}).click();assert.match(await dialog.getByRole("alert").innerText(),/제목과 이미지/);assert.equal((await calls()).length,0);checks.push("invalid-file-and-empty-title");
  await open("retry");await dialog.getByLabel("배너 제목",{exact:true}).fill("재시도 배너");await image();await dialog.getByRole("button",{name:"등록",exact:true}).click();await dialog.getByRole("alert").waitFor();assert.equal((await calls()).length,2);await dialog.getByRole("button",{name:"등록",exact:true}).click();await dialog.waitFor({state:"hidden"});const retried=await calls();assert.equal(retried.length,3);assert.equal(new Set(retried.map(call=>call.requestId)).size,1);checks.push("automatic-and-user-retry-same-request-id");
  await open("normal");await dialog.getByLabel("배너 제목",{exact:true}).fill("중복 방지 배너");await image();await dialog.locator("form").evaluate(form=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});await page.waitForFunction(()=>window.__bannerFixture.calls.length===1);await page.keyboard.press("Escape");assert.equal(await dialog.isVisible(),true);await dialog.waitFor({state:"hidden"});assert.equal((await calls()).length,1);checks.push("double-submit-and-saving-dismiss-guard");
  await open("denied");await dialog.getByLabel("배너 제목",{exact:true}).fill("권한 확인");await image();await dialog.getByRole("button",{name:"등록",exact:true}).click();await dialog.getByRole("alert").waitFor();assert.match(await dialog.getByRole("alert").innerText(),/등록 권한/);assert.equal((await calls()).length,1);checks.push("permission-error-actionable");
  await page.goto(`${base}/?scenario=readonly`);await banner.waitFor();assert.equal(await banner.getByRole("button",{name:"+ 등록",exact:true}).count(),0);assert.equal((await calls()).length,0);checks.push("readonly-staff-no-registration");
  assert.deepEqual(errors,[]);
  writeFileSync(join(output,"result.json"),JSON.stringify({passed:true,checks,inputs,errors,network:"blocked",productionWrites:0},null,2));
  console.log(JSON.stringify({passed:true,output,checks}));
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
