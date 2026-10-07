/** Real Header, student drawer and Wis popover. Only data/auth and unrelated lazy widgets are mocked. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import http from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const evidence = process.env.HEADER_WIS_QA_EVIDENCE_DIR || path.join(root, '.superloopy/sessions/header-wis-20261007/evidence');
await fs.mkdir(evidence, { recursive: true });
const imp = relative => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
const service = `
const teacher=new URLSearchParams(location.search).has('teacher');
const email=teacher?'westoria28@gmail.com':'fixture@example.invalid';
export const qa=window.headerWisQa={calls:[],invalidations:[],balance:1234,hold:false,fail:false,rankEnabled:true};
export const config={year:'2026',semester:'2',showLesson:true,showQuiz:true,showScore:true};
export const useAuth=()=>({currentUser:{uid:'wis-fixture',email},userData:{uid:'wis-fixture',email,role:teacher?'teacher':'student',name:'긴이름의검증학생',staffPermissions:[]},config,configReady:true,menuConfigReady:true,menuConfig:qa.menus,logout:async()=>{}});
export const useAppToast=()=>({showToast(){}});
export const lazyWithRetry=()=>()=>null;
export const isSemesterArchive=false;
export const invalidateStudentRankPromotionSnapshotCache=(scope,uid)=>qa.invalidations.push({scope,uid});
export const getPointRankDefaultEmojiValue=()=> '😀';
export const loadStudentRankPromotionSnapshot=async(scope,uid)=>{
qa.calls.push({scope,uid});
if(qa.hold) await new Promise(resolve=>qa.release=resolve);
if(qa.fail) throw new Error('fixture read failed');
return {wallet:qa.balance===null?null:{balance:qa.balance},rank:qa.rankEnabled?{enabled:true,label:'노비',themeName:'조선',description:'현재 등급',badgeClass:'border-gray-200 bg-gray-50 text-gray-900'}:null,policy:{rankPolicy:{}}};
};
`;
const harness = `
import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter,useLocation,Link} from 'react-router-dom';
import Header from ${imp('src/components/common/Header.tsx')};
import {MENUS} from ${imp('src/constants/menus.ts')};
import ${imp('src/assets/index.css')};import ${imp('src/components/layout/teacherLayout.css')};import ${imp('src/components/layout/studentLayout.css')};
import {qa} from 'fixture:service';qa.menus=structuredClone(MENUS);
function Fixture(){const location=useLocation();const teacher=location.pathname.startsWith('/teacher');return <div className={teacher?'teacher-layout':'student-layout'}><Header studentLayout={!teacher} teacherLayout={teacher}/><main style={{padding:24}}><h1>헤더 검증</h1><Link to='/student/points'>위스 페이지</Link><button type='button' id='outside'>본문 버튼</button></main></div>};
createRoot(document.getElementById('root')).render(<HashRouter><Fixture/></HashRouter>);
`;
const bundle = await build({stdin:{contents:harness,loader:'tsx',resolveDir:root},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',outfile:path.join(os.tmpdir(),'westory-header-wis-qa.js'),loader:{'.svg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'header-data-fixture',setup(plugin){
plugin.onResolve({filter:/^fixture:|(?:^|\/)contexts\/AuthContext$|(?:^|\/)common\/AppToastProvider$|^\.\/AppToastProvider$|(?:^|\/)lib\/(pointRankPromotion|pointRanks|lazyWithRetry|semesterArchive)$/},()=>({path:'service',namespace:'fixture'}));
plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:service,loader:'ts',resolveDir:root}));
}}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const tailwind=await fs.readFile(path.join(os.tmpdir(),'westory-qa-tailwind.js'),'utf8');
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/qa.css"><div id="root"></div><script type="module" src="/qa.js"></script></html>';
const server=http.createServer((req,res)=>{const files={'/qa.js':['text/javascript',js],'/qa.css':['text/css',css],'/tailwind.js':['text/javascript',tailwind]};const [type,data]=files[new URL(req.url,'http://localhost').pathname]||['text/html',html];res.setHeader('Content-Type',type+';charset=utf-8');res.end(data);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge',headless:true});
const checks=[],layouts=[],errors=[];
let failure;
async function open(width=1280,teacher=false){const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(`${origin}/${teacher?'?teacher=1':''}#/${teacher?'teacher':'student'}/dashboard`);await page.getByRole('heading',{name:'헤더 검증'}).waitFor();if(width<1024)await page.getByRole('button',{name:`${teacher?'교사':'학생'} 메뉴 열기`,exact:true}).click();return page;}
const trigger=page=>page.locator('.header-student-wis-trigger:visible');
const panel=page=>page.getByRole('region',{name:'내 위스',exact:true});
try{
for(const width of [320,390,768,1280,1440]){
const page=await open(width);await page.waitForFunction(()=>window.headerWisQa.calls.length>0);await trigger(page).press('Enter');await panel(page).getByText('1,234',{exact:false}).waitFor();assert.equal(await page.locator('a .header-student-wis-trigger').count(),0);assert.match(page.url(),/student\/dashboard$/);
const layout=await panel(page).evaluate(el=>{const r=el.getBoundingClientRect();const b=document.querySelector('.header-student-wis-trigger').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,buttonWidth:b.width,buttonHeight:b.height,overflow:document.documentElement.scrollWidth>innerWidth};});assert(layout.left>=0&&layout.right<=width);assert(layout.buttonWidth>=44&&layout.buttonHeight>=44);assert.equal(layout.overflow,false);layouts.push({width,...layout});await page.screenshot({path:path.join(evidence,`header-wis-${width}.png`),fullPage:true});
await trigger(page).press('Escape');assert.equal(await panel(page).count(),0);assert.equal(await trigger(page).evaluate(el=>el===document.activeElement),true);if(width<1024)assert.equal(await page.getByRole('dialog',{name:'학생 메뉴',exact:true}).isVisible(),true);
await trigger(page).click();await panel(page).waitFor();await trigger(page).press('Tab');await panel(page).waitFor({state:'detached'});
await page.close();}
checks.push('320/390/768/1280/1440: desktop header and mobile drawer expose a separate rank button; keyboard open, Escape focus return, Tab dismissal, minimum 44px target and no viewport overflow.');
const page=await open();await trigger(page).click();await panel(page).getByText('1,234',{exact:false}).waitFor();await page.evaluate(()=>{window.headerWisQa.balance=1227;window.dispatchEvent(new CustomEvent('westory:points-updated'));});await panel(page).getByText('1,227',{exact:false}).waitFor();assert(await page.evaluate(()=>window.headerWisQa.invalidations.length)>0);assert(await page.evaluate(()=>window.headerWisQa.calls.every(call=>call.uid==='wis-fixture'&&call.scope.year==='2026'&&call.scope.semester==='2')));
await page.locator('#outside').click();assert.equal(await panel(page).count(),0);
await page.evaluate(()=>{window.headerWisQa.hold=true;window.headerWisQa.balance=0;});await trigger(page).click();await panel(page).getByText('불러오는 중…',{exact:true}).waitFor();assert.equal(await panel(page).getByText('1,227',{exact:false}).count(),0);await page.evaluate(()=>{window.headerWisQa.hold=false;window.headerWisQa.release();});await panel(page).getByText('0 위스',{exact:true}).waitFor();
await trigger(page).click();await page.evaluate(()=>{window.headerWisQa.fail=true;});await trigger(page).click();await panel(page).getByText('위스를 불러오지 못했습니다.',{exact:true}).waitFor();await page.screenshot({path:path.join(evidence,'header-wis-error-1280.png'),fullPage:true});await page.evaluate(()=>{window.headerWisQa.fail=false;window.headerWisQa.balance=null;});await panel(page).getByRole('button',{name:'다시 불러오기',exact:true}).click();await panel(page).getByText('0 위스',{exact:true}).waitFor();
await page.getByRole('link',{name:'위스 페이지',exact:true}).click();assert.equal(await panel(page).count(),0);await trigger(page).click();await panel(page).getByText('0 위스',{exact:true}).waitFor();assert.match(page.url(),/student\/points$/);await page.close();
checks.push('Own UID/current semester only; balance reloaded on points-updated and every open; loading hides stale balance; true zero/missing wallet, read failure, retry and navigation closure verified.');
const disabled=await open();await disabled.evaluate(()=>{window.headerWisQa.rankEnabled=false;window.dispatchEvent(new CustomEvent('westory:points-updated'));});await disabled.getByRole('button',{name:'내 위스 보기',exact:true}).waitFor();await trigger(disabled).click();await panel(disabled).getByText('1,234',{exact:false}).waitFor();assert.equal(await trigger(disabled).innerText(),'Ws');await disabled.close();
for(const width of [390,1280]){const teacher=await open(width,true);assert.equal(await teacher.locator('.header-student-wis').count(),0);assert.equal(await teacher.evaluate(()=>window.headerWisQa.calls.length),0);assert.equal(await teacher.locator('a.header-user-link').count(),1);await teacher.close();}
checks.push('Disabled rank still exposes a Ws button; teacher desktop/mobile retain profile links and never read student wallets.');
assert.deepEqual(errors,[]);
}catch(error){failure=error;}finally{await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',checks,layouts,errors,failure:failure?.stack},null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
if(failure)throw failure;console.log(JSON.stringify({status:'PASS',checks:checks.length,evidence},null,2));
