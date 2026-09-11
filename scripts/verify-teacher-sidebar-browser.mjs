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
import {MENUS} from '${root.replaceAll("\\","/")}/src/constants/menus';
export const useAuth=()=>({currentUser:{uid:'sidebar-test',email:'westoria28@gmail.com'},userData:{role:'teacher',name:'테스트 교사'},loading:false,config:{year:'2026',semester:'2'},configReady:true,menuConfig:MENUS,menuConfigReady:true,applicationSessionAuthorityMode:'server',logout:async()=>{}});
export const useAppToast=()=>({showToast:()=>{}});export const inferToastFromAlertMessage=()=>({});
export const loadStudentRankPromotionSnapshot=async()=>({rank:null,policy:{rankPolicy:{}}});export const invalidateStudentRankPromotionSnapshotCache=()=>{};export const db={};export const doc=()=>({});export const getDoc=async()=>({exists:()=>false});export const runtimeEnvironment='local';export const touchApplicationSession=async()=>({});
export default function Stub(){return null;} export const lazyWithRetry=()=>()=>null;`);
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import MainLayout from './src/components/layout/MainLayout';import StatePanel from './src/components/common/StatePanel';import {LoadingOverlay} from './src/components/common/LoadingState';const Pending=React.lazy(()=>new Promise(()=>{}));import {LessonTreePanel} from './src/pages/teacher/components/LessonEditorPanels';
createRoot(document.getElementById('root')).render(<HashRouter><MainLayout>{location.hash.endsWith("/loading")?<React.Suspense fallback={<LoadingOverlay/>}><Pending/></React.Suspense>:location.hash.endsWith("/data-loading")?<StatePanel state="LOADING"/>:location.hash.endsWith("/inline-loading")?<StatePanel state="LOADING" compact/>:location.hash.endsWith("/error")?<StatePanel state="ERROR"/>:<><h1>수업 자료 확인</h1><button>본문 동작</button><LessonTreePanel treeData={[{id:"qa",title:"검증용 자료",children:[]}]} sidebarOpen={false} onCloseSidebar={()=>{}} onOpenRootModal={()=>{}} onSaveTree={()=>{}} renderTreeNode={node=><button>{node.title}</button>}/></>}</MainLayout></HashRouter>);`;
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,loader:{'.svg':'dataurl'},platform:'browser',format:'iife',metafile:true,define:{'process.env.NODE_ENV':'"development"','import.meta.env':'{}'},plugins:[{name:'no-network-fixture',setup(api){api.onResolve({filter:/LessonContent$|LessonWorksheetStage$|StorageImage$|AuthContext$|AppToastProvider$|\/firebase$|applicationSession$|lazyWithRetry$|firebase\/firestore$|StudentHistoryDictionaryController$|StudentRankPromotionController$|TeacherPatchMemoController$|NotificationBell$|pointRankPromotion$/},()=>({path:fixture}));}}]});
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
  await page.setViewportSize({width,height:900});await page.goto(`http://127.0.0.1:${server.address().port}/#/teacher/lesson`);
  await page.getByRole('heading',{name:'수업 자료 확인'}).waitFor();
  const top=page.getByRole('navigation',{name:'교사 메인 메뉴',exact:true});
  await top.waitFor({state:'visible'});
  assert.equal(await top.getByRole('link',{name:'학습 자료 관리',exact:true}).isVisible(),true);
  const alignment=await top.evaluate(nav=>Array.from(nav.querySelectorAll(':scope > .nav-link, :scope > .ws-top-menu > .nav-link')).map(e=>{const r=e.getBoundingClientRect();return r.top+r.height/2;}));assert.ok(Math.max(...alignment)-Math.min(...alignment)<2,'main menu vertical alignment at '+width);assert.equal(await top.locator('button, .fa-chevron-down').count(),0);
  const side=page.getByRole('complementary',{name:'교사 하위 메뉴'});
  assert.equal(await side.count(),width>=768?1:0);
  if(width>=768){
   assert.equal(await side.getByRole('link',{name:'평가 관리',exact:true}).count(),0);
   assert.equal(await side.getByRole('link',{name:'수업 자료',exact:true}).getAttribute('aria-current'),'page');
  }
  const bounds=await page.evaluate(()=>{const s=document.querySelector('.ws-teacher-sidebar');const r=s?.getBoundingClientRect();const m=document.getElementById('main-content').getBoundingClientRect();const h=document.querySelector('header').getBoundingClientRect();return {sideRight:r?.right??0,sideLeft:r?.left??0,sideTop:r?.top??0,headerBottom:h.bottom,mainLeft:m.left,overflow:document.documentElement.scrollWidth>innerWidth+1};});
  assert.equal(bounds.overflow,false,`page overflow at ${width}`);assert.ok(bounds.mainLeft>=bounds.sideRight-1,`sidebar overlap at ${width}`);
  if(width>=768){assert.ok(bounds.sideLeft>0);assert.ok(bounds.sideTop>bounds.headerBottom);}
  const menu=top.getByRole('link',{name:'학습 자료 관리',exact:true});
  await page.mouse.move(width-1,850);
  await menu.focus();await menu.press('ArrowDown');
  await page.waitForFunction(()=>document.querySelector('.ws-top-menu.is-open .ws-top-menu__panel'));
  const drop=top.locator('.ws-top-menu.is-open .ws-top-menu__panel');
  assert.equal(await drop.getByRole('link',{name:'역사 사전 관리',exact:true}).isVisible(),true);
  await menu.press('Escape');assert.equal(await menu.getAttribute('aria-expanded'),'false');
  if(width>=1024){await top.getByRole('link',{name:'학습 자료 관리',exact:true}).hover();assert.equal(await drop.isVisible(),true);await page.mouse.move(width-1,850);}
  assert.equal(await page.getByRole('heading',{name:'수업 자료 트리',exact:true}).isVisible(),width>=1024);
  if(width>=768){await side.getByRole('link',{name:'역사 사전 관리',exact:true}).click();await page.waitForFunction(()=>location.hash.endsWith('history-dictionary'));assert.equal(await side.getByRole('link',{name:'역사 사전 관리',exact:true}).getAttribute('aria-current'),'page');}
  await top.getByRole('link',{name:'평가 관리',exact:true}).click();
  await page.waitForFunction(()=>location.hash==='#/teacher/quiz');
  if(width>=768){await side.getByRole('link',{name:'문제 은행',exact:true}).click();await page.waitForFunction(()=>location.hash.endsWith('?tab=bank'));assert.equal(await side.getByRole('link',{name:'문제 은행',exact:true}).getAttribute('aria-current'),'page');assert.equal(await side.getByRole('link',{name:'수업 자료',exact:true}).count(),0);}
  await page.mouse.move(width-1,850);
  await page.screenshot({path:join(output,`teacher-${width}.png`)});checks.push({width,teacher:true,...bounds});
 }
 await page.goto(`http://127.0.0.1:${server.address().port}/#/teacher/dashboard`);await page.getByRole('heading',{name:'수업 자료 확인'}).waitFor();assert.equal(await page.getByRole('complementary',{name:'교사 하위 메뉴'}).count(),0);
 await page.setViewportSize({width:1280,height:900});await page.goto(`http://127.0.0.1:${server.address().port}/#/student/mypage`);await page.getByRole('heading',{name:'수업 자료 확인'}).waitFor();assert.equal(await page.getByRole('complementary',{name:'교사 하위 메뉴'}).count(),0);assert.equal(await page.locator('.ws-teacher-layout').count(),0);
 const studentTop=page.getByRole('navigation',{name:'학생 메인 메뉴',exact:true});
 await studentTop.getByRole('link',{name:'학습',exact:true}).hover();
 assert.equal(await studentTop.getByRole('link',{name:'수업 자료',exact:true}).isVisible(),true);
 await studentTop.getByRole('link',{name:'수업 자료',exact:true}).click();await page.waitForFunction(()=>location.hash==='#/student/lesson/note');
 await page.getByRole('button',{name:'본문 동작',exact:true}).focus();assert.equal(await studentTop.locator('.ws-top-menu.is-open').count(),0);
 const touch=await browser.newContext({viewport:{width:768,height:900},hasTouch:true});
 try {const touchPage=await touch.newPage();touchPage.on('pageerror',e=>errors.push(e.message));await touchPage.goto(`http://127.0.0.1:${server.address().port}/#/teacher/lesson`);
 const toggle=touchPage.getByRole('navigation',{name:'교사 메인 메뉴',exact:true}).getByRole('link',{name:'학습 자료 관리',exact:true});
 await toggle.tap();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 await touchPage.getByRole('navigation',{name:'교사 메인 메뉴',exact:true}).getByRole('link',{name:'역사 사전 관리',exact:true}).tap();await touchPage.waitForFunction(()=>location.hash.endsWith('history-dictionary'));assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 } finally {await touch.close();}
 for(const route of ['loading','data-loading'])for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});await page.goto(`http://127.0.0.1:${server.address().port}/#/teacher/${route}`);await page.reload();const card=page.getByRole('status');await card.waitFor();const b=await card.boundingBox();assert.ok(Math.abs(b.x+b.width/2-width/2)<2);assert.ok(Math.abs(b.y+b.height/2-450)<2);assert.equal(await card.locator('.animate-spin').evaluate(e=>getComputedStyle(e).animationName),'spin');await page.screenshot({path:join(output,`${route}-${width}.png`)});}
 for(const route of ['inline-loading','error']){await page.goto(`http://127.0.0.1:${server.address().port}/#/teacher/${route}`);await page.reload();assert.equal(await page.locator('.fixed.inset-0').count(),0);await page.getByRole(route==='error'?'alert':'status').waitFor();}
 assert.deepEqual(errors,[]);writeFileSync(join(output,'result.json'),JSON.stringify({checks,studentSidebarAbsent:true,errors,network:'blocked',productionAccess:0},null,2));console.log(JSON.stringify({passed:true,output,checks:checks.length,studentSidebarAbsent:true}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
