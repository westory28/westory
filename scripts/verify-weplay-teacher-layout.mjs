/** Real three-game teacher management UI; only Auth and server boundaries are synthetic. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url),{build}=require('esbuild');
let playwright;try{playwright=require('playwright')}catch{playwright=require(process.env.PLAYWRIGHT_MODULE_PATH||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
const core=require(path.join(root,'functions/weplayCore.js'));
const evidence=path.join(root,'output/weplay-teacher-layout-20261123');await fs.mkdir(evidence,{recursive:true});
const m=name=>JSON.stringify(path.join(root,name).replaceAll('\\','/'));
const service=`
import {useSyncExternalStore} from 'react';
import {MENUS} from ${m('src/constants/menus.ts')};
import {RHYTHM_SONGS} from ${m('src/components/common/weplay/rhythm/rhythmSongs.ts')};
const params=new URLSearchParams(location.search),readonly=params.has('readonly');
const listeners=new Set();
const currentUser={uid:'teacher-layout-qa',email:'qa@example.invalid'};
let state={config:{year:'2026',semester:'2'},currentUser,userData:{uid:currentUser.uid,role:readonly?'student':'teacher',teacherPortalEnabled:true,staffPermissions:readonly?['lesson_read']:[],weplayGuideCompleted:true},authPhase:'ready',authGeneration:1,configReady:true,menuConfigReady:true,menuConfig:MENUS,interfaceConfig:{},refreshInterfaceConfig:async()=>{}};
export const auth={get currentUser(){return state.currentUser}};
export const useAuth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state);
export const qa=window.teacherLayoutQa={calls:[],writes:[],fail:{},settings:${JSON.stringify(core.DEFAULT_GAME_SETTINGS)},policy:${JSON.stringify(core.DEFAULT_POLICY)},rhythm:{enabled:false,revision:1},yut:{enabled:false,version:1,allowSolo:true,allowMultiplayer:true,allowPrivateRooms:true,defaultPlayerCount:4,throwSeconds:5,moveSeconds:25}};
qa.changeAccount=()=>{state={...state,currentUser:{uid:'another-teacher',email:'qa@example.invalid'}};listeners.forEach(fn=>fn());};
const lessons=[{unitId:'public-1',title:'임진왜란과 수군',isVisibleToStudents:true,words:['이순신','거북선','판옥선','한산도','학익진','명량해전'],wordCount:6}];
const management=()=>({settings:structuredClone(qa.settings),lessons,availableWordCount:6,previewWordCount:6});
export const getHttpsCallable=async name=>async data=>{qa.calls.push({name,data});if(qa.fail[name]){qa.fail[name]--;throw new Error('합성 저장 오류');}
if(name==='getWeplayManagement')return {data:management()};
if(name==='saveWeplayGameSettings'){qa.settings={...data.settings,version:qa.settings.version+1};qa.writes.push({name,data});return {data:management()};}
if(name==='getWeplayPolicy')return {data:{policy:qa.policy,currentRankingPeriod:null}};
if(name==='getRhythmChallengeState')return {data:{weekId:'2026-11-23',week:{id:'2026-11-23',startsAtMs:Date.now(),endsAtMs:Date.now()+604800000},songId:RHYTHM_SONGS[0].id,automaticSongId:RHYTHM_SONGS[0].id,selection:'automatic',allowedDifficulties:['normal','hard'],missLimit:30,revision:1,dailyFreeLimit:3,paidCost:50,freeRemaining:3,dailyUsed:0,dayId:'2026-11-23',preview:true}};
if(name==='getYutManagement')return {data:{settings:qa.yut,rooms:[],truncated:false,serverNowMs:Date.now()}};
if(name==='saveYutSettings'){qa.yut={...qa.yut,...data,version:qa.yut.version+1};qa.writes.push({name,data});return {data:{settings:qa.yut,serverNowMs:Date.now()}};}
throw new Error('Unexpected callable: '+name);};
export const getHistoryDictionaryCallable=getHttpsCallable;
export const ensureHistoryDictionarySession=async()=>{};
export const db={};export const getFirebaseStorage=async()=>({});
export const getRhythmPublication=async config=>{qa.calls.push({name:'getRhythmPublication',config});return {...qa.rhythm}};
export const saveRhythmPublication=async(config,enabled,revision)=>{qa.calls.push({name:'saveRhythmPublication',config,enabled,revision});if(qa.holdRhythm)await new Promise(resolve=>qa.releaseRhythm=resolve);if(qa.fail.rhythm){qa.fail.rhythm--;throw new Error('합성 저장 오류');}qa.rhythm={enabled,revision:revision+1};qa.writes.push({name:'saveRhythmPublication',enabled});return {...qa.rhythm}};
`;
const firestore=`export * from 'fixture:real-firestore';export const doc=(_db,...parts)=>({path:parts.join('/')});export const collection=doc;export const query=ref=>ref;export const where=(...args)=>args;export const orderBy=(...args)=>args;export const limit=(...args)=>args;export const onSnapshot=(_ref,next)=>{next({exists:()=>false,data:()=>undefined,docs:[],metadata:{fromCache:false,hasPendingWrites:false}});return()=>{}};export const getDoc=async()=>({exists:()=>false,data:()=>undefined});`;
const harness=`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import Manage from ${m('src/pages/teacher/ManageWeplay.tsx')};import{AppToastProvider}from ${m('src/components/common/AppToastProvider.tsx')};import{AppDialogProvider}from ${m('src/components/common/AppDialogProvider.tsx')};import ${m('src/assets/index.css')};import ${m('src/components/layout/teacherLayout.css')};import ${m('src/components/common/portalPage.css')};const game=new URLSearchParams(location.search).get('game');createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/teacher/weplay?game='+game]}><AppToastProvider><AppDialogProvider><div className='teacher-layout'><Manage/></div></AppDialogProvider></AppToastProvider></MemoryRouter>);`;
const bundle=await build({stdin:{contents:harness,loader:'tsx',resolveDir:root},bundle:true,write:false,format:'esm',target:'es2022',outfile:path.join(os.tmpdir(),'westory-teacher-layout.js'),loader:{'.woff':'dataurl','.woff2':'dataurl','.svg':'dataurl','.webp':'dataurl','.png':'dataurl'},external:['/assets/*'],define:{'process.env.NODE_ENV':'"production"','import.meta.env.BASE_URL':'"/"'},plugins:[{name:'teacher-boundaries',setup(plugin){
plugin.onResolve({filter:/^fixture:real-firestore$/},()=>({path:require.resolve('firebase/firestore')}));
plugin.onResolve({filter:/contexts\/AuthContext$|(?:^|\/)lib\/firebase$|^\.\/firebase$|historyDictionarySession$|(?:^|\/)rhythmPublication$/},()=>({path:'service',namespace:'fixture'}));
plugin.onResolve({filter:/^firebase\/firestore$/},()=>({path:'firestore',namespace:'fixture'}));
plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='service'?service:firestore,loader:'tsx',resolveDir:root}));
}}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text.replace(/@import\s+[^;]+;/g,'');
const tailwind=await fs.readFile(path.join(os.tmpdir(),'westory-qa-tailwind.js'),'utf8');
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://local').pathname;if(pathname==='/qa.js'){res.setHeader('Content-Type','text/javascript');return res.end(js)}if(pathname==='/qa.css'){res.setHeader('Content-Type','text/css');return res.end(css)}if(pathname==='/tailwind.js'){res.setHeader('Content-Type','text/javascript');return res.end(tailwind)}if(pathname.startsWith('/assets/')){const file=path.resolve(root,'public','.'+pathname);if(!file.startsWith(path.join(root,'public')+path.sep))throw Error('Bad asset');res.setHeader('Content-Type',file.endsWith('.webp')?'image/webp':file.endsWith('.json')?'application/json':'application/octet-stream');return res.end(await fs.readFile(file))}res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/qa.css"><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>')}catch(error){res.statusCode=404;res.end(error.message)}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge',headless:true});
const checks=[],errors=[],requests=[],layouts=[];let failure;
async function open(game,width=1280,query=''){const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();requests.push(route.request().url());return route.abort()});await page.goto(origin+'/?game='+game+'&'+query);await page.getByRole('heading',{name:'게임 운영',exact:true}).waitFor();await page.getByText('저장된 설정과 동일',{exact:true}).first().waitFor();await page.locator('.ws-loading-exit-surface').waitFor({state:'detached'});return page}
try{
for(const width of [390,768,1280]){
 const widths=[];
 for(const game of ['joseon-yut','history-rain','gungdeok-rock']){
  const page=await open(game,width);
  const layout=await page.evaluate(()=>{const shell=document.querySelector('.ws-page.yut-management'),grid=document.querySelector('.yut-management-layout'),left=grid.children[0].getBoundingClientRect(),right=grid.children[1].getBoundingClientRect(),art=document.querySelector('.teacher-weplay-preview-cover')||grid.children[1].querySelector('img'),button=grid.children[1].querySelector('.yut-management-preview-actions'),header=document.querySelector('.ws-page-header')||document.querySelector('.weplay-heading');return{width:innerWidth,shell:shell.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth,left:{x:left.x,y:left.y,width:left.width,bottom:left.bottom},right:{x:right.x,y:right.y,width:right.width,bottom:right.bottom},artBottom:art.getBoundingClientRect().bottom,buttonTop:button.getBoundingClientRect().top,headerBackground:getComputedStyle(header).backgroundColor,headerShadow:getComputedStyle(header).boxShadow,weeklyTop:document.querySelector('.weplay-weekly-rewards').getBoundingClientRect().top,closed:[...document.querySelectorAll('.weplay-weekly-rewards,.weplay-policy')].every(el=>!el.open)}});
  assert.equal(layout.overflow,false,JSON.stringify(layout));assert.equal(layout.headerBackground,'rgba(0, 0, 0, 0)');assert.equal(layout.headerShadow,'none');assert.ok(layout.buttonTop>=layout.artBottom-1);assert.ok(layout.weeklyTop>=Math.max(layout.left.bottom,layout.right.bottom));assert.equal(layout.closed,true);
  if(width===1280)assert.ok(layout.right.x>layout.left.x&&Math.abs(layout.right.y-layout.left.y)<1);else assert.ok(layout.right.y>=layout.left.bottom);
  assert.equal(await page.evaluate(()=>window.teacherLayoutQa.writes.length),0);
  widths.push(layout.shell);layouts.push({game,...layout});await page.screenshot({path:path.join(evidence,`${game}-${width}.png`),fullPage:true});await page.close();
 }
 assert.ok(widths.every(value=>Math.abs(value-widths[0])<1),'All games share one content width');
}
checks.push('All three real game management screens share width, game-operation/preview columns, image-before-action order and initially collapsed rewards/policy at 390/768/1280; transparent headings, no overflow or initial writes');
for(const game of ['history-rain','gungdeok-rock']){
 const page=await open(game);const form=page.locator('.yut-management-layout').locator('> *').first();const toggle=form.getByRole('checkbox').first();await toggle.setChecked(!await toggle.isChecked());assert.equal(await page.evaluate(()=>window.teacherLayoutQa.writes.length),0);
 await form.getByRole('button',{name:'게임 설정 저장',exact:true}).click();await page.waitForFunction(()=>window.teacherLayoutQa.writes.length===1);await form.getByText('저장된 설정과 동일',{exact:true}).waitFor();
 await page.getByRole('button',{name:'체험하기',exact:true}).click();await page.locator('.weplay-studio-intro').waitFor();assert.equal(await page.evaluate(()=>window.teacherLayoutQa.writes.length),1);
 if(game==='gungdeok-rock'){await page.locator('.weplay-studio-intro').getByRole('button',{name:/건너뛰기/}).click();await page.waitForFunction(()=>document.activeElement?.tagName==='H1'&&document.activeElement.textContent==='덩기덕 쿵더Rock');assert.equal(await page.evaluate(()=>window.teacherLayoutQa.writes.length),1);}
 await page.close();
 const readonly=await open(game,390,'readonly=1');assert.equal(await readonly.locator('.yut-management-layout').getByRole('button',{name:'게임 설정 저장',exact:true}).count(),0);assert.equal(await readonly.locator('.yut-management-layout').getByRole('checkbox').first().isDisabled(),true);await readonly.close();
}
checks.push('Naval/rhythm publication needs an explicit save, writes once, read-only staff cannot edit, preview entry writes no game/Wis/ranking data');
const retry=await open('gungdeok-rock');await retry.evaluate(()=>window.teacherLayoutQa.fail.rhythm=1);await retry.getByRole('checkbox',{name:'학생에게 공개',exact:true}).check();await retry.getByRole('button',{name:'게임 설정 저장',exact:true}).click();await retry.getByRole('button',{name:'다시 확인',exact:true}).waitFor();assert.equal(await retry.evaluate(()=>window.teacherLayoutQa.writes.length),0);await retry.getByRole('button',{name:'다시 확인',exact:true}).click();await retry.getByText('저장된 설정과 동일',{exact:true}).waitFor();await retry.getByRole('checkbox',{name:'학생에게 공개',exact:true}).check();await retry.getByRole('button',{name:'게임 설정 저장',exact:true}).click();await retry.waitForFunction(()=>window.teacherLayoutQa.writes.length===1);assert.equal(await retry.evaluate(()=>window.teacherLayoutQa.calls.filter(c=>c.name==='getRhythmPublication').length),2);await retry.close();
checks.push('Rhythm publication failure blocks edits until one explicit reread; retry succeeds with one write and no background polling');
const policy=await open('gungdeok-rock',390);assert.equal(await policy.evaluate(()=>window.teacherLayoutQa.calls.filter(c=>c.name==='getRhythmChallengeState').length),0);await policy.locator('.weplay-policy > summary').click();await policy.getByLabel('아이쿠 종료 횟수').waitFor();assert.equal(await policy.getByLabel('아이쿠 종료 횟수').inputValue(),'30');assert.equal(await policy.getByLabel('곡 배정').inputValue(),'automatic');assert.equal(await policy.evaluate(()=>window.teacherLayoutQa.calls.filter(c=>c.name==='getRhythmChallengeState').length),1);await policy.screenshot({path:path.join(evidence,'rhythm-policy-390.png'),fullPage:true});await policy.close();checks.push('Rhythm song assignment and miss limit remain in the policy disclosure, with one read only when opened; intro skip restores teacher heading focus');
assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}catch(error){failure=error.stack;const page=browser.contexts().flatMap(c=>c.pages()).at(-1);if(page)await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:true});process.exitCode=1}
finally{await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify({status:failure?'failed':'passed',failure,checks,errors,requests,layouts},null,2));await browser.close();await new Promise(resolve=>server.close(resolve))}
if(failure)throw Error(failure);console.log(JSON.stringify({checks,layouts},null,2));
