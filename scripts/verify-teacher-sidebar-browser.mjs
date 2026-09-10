// Isolated browser check of actual Header/MainLayout. No Firebase or real accounts.
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const root=process.cwd(), output=mkdtempSync(join(tmpdir(),"westory-sidebar-"));
const fixture=join(output,"fixture.tsx");
writeFileSync(fixture,`import React from '${root.replaceAll("\\","/")}/node_modules/react/index.js';
export const useAuth=()=>({currentUser:{uid:'sidebar-test',email:'westoria28@gmail.com'},userData:{role:'teacher',name:'테스트 교사'},loading:false,config:{year:'2026',semester:'2'},configReady:true,menuConfig:null,menuConfigReady:true,applicationSessionAuthorityMode:'server',logout:async()=>{}});
export const useAppToast=()=>({showToast:()=>{}});export const inferToastFromAlertMessage=()=>({});
export const loadStudentRankPromotionSnapshot=async()=>({rank:null,policy:{rankPolicy:{}}});export const invalidateStudentRankPromotionSnapshotCache=()=>{};export const db={};export const doc=()=>({});export const getDoc=async()=>({exists:()=>false});export const runtimeEnvironment='local';export const touchApplicationSession=async()=>({});
export default function Stub(){return null;} export const lazyWithRetry=()=>()=>null;`);
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import MainLayout from './src/components/layout/MainLayout';
createRoot(document.getElementById('root')).render(<HashRouter><MainLayout><h1>수업 자료 확인</h1><button>본문 동작</button></MainLayout></HashRouter>);`;
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,loader:{'.svg':'dataurl'},platform:'browser',format:'iife',metafile:true,define:{'process.env.NODE_ENV':'"development"','import.meta.env':'{}'},plugins:[{name:'no-network-fixture',setup(api){api.onResolve({filter:/AuthContext$|AppToastProvider$|\/lib\/firebase$|applicationSession$|lazyWithRetry$|firebase\/firestore$|StudentHistoryDictionaryController$|StudentRankPromotionController$|TeacherPatchMemoController$|NotificationBell$|pointRankPromotion$/},()=>({path:fixture}));}}]});
assert.ok(!Object.keys(result.metafile.inputs).some(p=>p.includes('node_modules/@firebase/')),'Fixture must not include Firebase');
const cssFile=readdirSync('dist/assets').find(n=>/^main-.*\.css$/.test(n));
const css=readFileSync(join('dist/assets',cssFile),'utf8')+'\n'+readFileSync('src/assets/index.css','utf8');
const server=createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'");res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?result.outputFiles[0].contents:req.url==='/app.css'?css:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const checks=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [390,768,1024,1280,1440]){
  await page.setViewportSize({width,height:900});await page.goto(`http://127.0.0.1:${server.address().port}/#/teacher/lesson`);await page.getByRole('heading',{name:'수업 자료 확인'}).waitFor();
  assert.equal(await page.getByRole('button',{name:/교사용 수업 화면|^수업 화면$/}).count(),0);
  assert.equal(await page.getByRole('navigation',{name:'교사 주요 메뉴'}).count(),width>=768?1:0);
  const measure=()=>page.evaluate(()=>{const side=document.querySelector('.ws-teacher-sidebar')?.getBoundingClientRect();const main=document.getElementById('main-content').getBoundingClientRect();return {sideRight:side?.right??0,mainLeft:main.left,overflow:document.documentElement.scrollWidth>innerWidth+1};});
  let bounds=await measure();assert.equal(bounds.overflow,false);assert.ok(bounds.mainLeft>=bounds.sideRight-1);
  if(width>=768&&width<1280){await page.getByRole('button',{name:'메뉴 펼치기'}).click();await page.waitForFunction(()=>document.querySelector('.ws-teacher-layout--expanded'));bounds=await measure();assert.ok(bounds.mainLeft>=bounds.sideRight-1);assert.equal(bounds.overflow,false);await page.getByRole('link',{name:'역사 사전 관리',exact:true}).click();await page.waitForFunction(()=>location.hash.includes('history-dictionary'));await page.getByRole('button',{name:'메뉴 펼치기'}).waitFor();}
  await page.screenshot({path:join(output,`teacher-${width}.png`)});checks.push({width,teacher:true,...bounds});
 }
 await page.setViewportSize({width:1280,height:900});await page.goto(`http://127.0.0.1:${server.address().port}/#/student/mypage`);assert.equal(await page.getByRole('navigation',{name:'교사 주요 메뉴'}).count(),0);
 assert.deepEqual(errors,[]);writeFileSync(join(output,'result.json'),JSON.stringify({checks,studentSidebarAbsent:true,errors,network:'blocked',productionAccess:0},null,2));console.log(JSON.stringify({passed:true,output,checks:checks.length,studentSidebarAbsent:true}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
