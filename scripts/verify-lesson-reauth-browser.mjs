// Actual editor + save service + recovery store. Auth/server timing is controlled
// by a local fixture; no real account, Firebase SDK, or external network is used.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root=process.cwd().replaceAll('\\','/'), output=mkdtempSync(join(tmpdir(),'westory-reauth-'));
const fixture=join(output,'fixture.tsx');
writeFileSync(fixture,`import React from '${root}/node_modules/react/index.js';
export const config={year:'2026',semester:'2'};
export const auth={currentUser:{uid:'teacher-a',email:'westoria28@gmail.com'}};
export const useAuth=()=>({currentUser:auth.currentUser,userData:{role:'teacher'},config});
export const db={};export const getFirebaseStorage=async()=>({});export const getHttpsCallable=()=>{throw Error('Unexpected callable');};
let saved={unitId:'unit',title:'원래 제목',contentRevision:3,updatedAt:100,isVisibleToStudents:true};
let tree=[{id:'root',title:'자료',children:[{id:'middle',title:'단원',children:[{id:'unit',title:'원래 제목',children:[]}]}]}],treeRevision=2;
export const observations={calls:[],reads:[],alerts:[]};
let signal=()=>{},pending;export const setSignal=fn=>signal=fn;
export const collection=(_,path)=>({path});export const doc=(_, ...parts)=>({path:parts.join('/')});
export const where=(key,op,value)=>({key,value});export const limit=()=>({});export const orderBy=()=>({});export const query=(ref,...filters)=>({...ref,filters});export const serverTimestamp=()=>100;
const snapshot=data=>({exists:()=>!!data,data:()=>structuredClone(data),id:'unit',ref:{path:'lesson'}});
export const getDoc=async ref=>ref.path==='site_settings/semester_active'?snapshot({semesterId:'2026-2',revision:1}):getDocFromServer(ref);
export const getDocFromServer=async ref=>{observations.reads.push(ref.path);return ref.path.endsWith('curriculum/tree')?snapshot({tree,contentRevision:treeRevision}):snapshot(null);};
export const getDocsFromServer=async ref=>{observations.reads.push(ref.path);const docs=ref.path==='lessons'?[]:[snapshot(saved)];return {empty:!docs.length,docs};};
export const getDocs=async()=>{throw Error('Editor must read committed server data');};
export const ref=()=>({});export const getBlob=async()=>new Blob();export const getDownloadURL=async()=>'';export const listAll=async()=>({items:[],prefixes:[]});
export const subscribeSourceArchiveAssets=callback=>{callback([]);return()=>{};};
export default function Stub(){return null;}export const lazyWithRetry=()=>Stub;export const processPdfMapFile=()=>{throw Error('Unexpected PDF processing');};
export const executeWestoryCommand=async(type,input,options)=>{
 observations.calls.push({type,input:structuredClone(input),options});
 if(options.expectedUid!=='teacher-a')throw Error('Wrong owner');
 if(input.expectedRevision!==saved.contentRevision)throw Object.assign(Error('다른 화면에서 수정되었습니다.'),{state:'conflict'});
 signal(false);
 return new Promise((resolve,reject)=>pending={resolve,reject,input});
};
export const remount=()=>signal(true);
export const finish=mode=>{const item=pending;if(!item)throw Error('No submitted write');pending=null;
 if(mode==='success'){saved={...saved,...item.input.document,contentRevision:saved.contentRevision+1};if(item.input.tree){tree=item.input.tree;treeRevision++;}item.resolve({result:{contentRevision:saved.contentRevision,treeRevision}});}
 else {if(mode==='conflict')saved={...saved,title:'다른 화면의 제목',contentRevision:saved.contentRevision+1};item.reject(Object.assign(Error(mode==='conflict'?'다른 화면에서 수정되었습니다.':'연결이 끊겼습니다.'),{state:mode==='conflict'?'conflict':'retryable'}));}
};
window.alert=message=>observations.alerts.push(message);window.confirm=()=>true;
`);
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import Editor from './src/pages/teacher/ManageLesson';import {setSignal,remount,finish,observations} from '${fixture.replaceAll('\\','/')}';
function Harness(){const [ready,setReady]=React.useState(true);setSignal(setReady);return <HashRouter><div style={{position:"relative",zIndex:99999}}><button onClick={remount}>본인 확인 완료</button><button onClick={()=>finish('success')}>서버 저장 완료</button><button onClick={()=>finish('failure')}>서버 저장 실패</button><button onClick={()=>finish('conflict')}>다른 화면과 충돌</button></div>{ready?<Editor/>:<p>본인 확인 중</p>}</HashRouter>;}window.fixture=observations;createRoot(document.getElementById('root')).render(<Harness/>);`;
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',metafile:true,loader:{'.svg':'dataurl'},define:{'process.env.NODE_ENV':'"development"','import.meta.env':'{}'},plugins:[{name:'isolated-server',setup(api){api.onResolve({filter:/AuthContext$|\/firebase$|commandGateway$|firebase\/firestore$|firebase\/storage$|sourceArchive$|LessonSourceArchivePickerModal$|LessonContent$|LessonWorksheetStage$|StorageImage$|lazyWithRetry$|pdfMapProcessor$/},()=>({path:fixture}));}}]});
assert.ok(!Object.keys(result.metafile.inputs).some(path=>path.includes('node_modules/@firebase/')));
const cssFile=readdirSync('dist/assets').find(n=>/^main-.*\.css$/.test(n));
const css=readFileSync(join('dist/assets',cssFile),'utf8');
const server=createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'");res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?result.outputFiles[0].contents:req.url==='/app.css'?css:'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,activePage;const checks=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const outcome of ['success','failure','conflict']){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  activePage=page;
  await page.goto('http://127.0.0.1:'+server.address().port);
  const title=page.getByPlaceholder('수업 자료 제목을 입력하세요');
  await title.waitFor();await page.waitForFunction(()=>document.querySelector('input[placeholder="수업 자료 제목을 입력하세요"]')?.value==='원래 제목');
  await title.fill('재인증 중 저장한 제목');
  await page.getByRole('button',{name:'제목/공개 저장',exact:true}).click();
  await page.getByText('본인 확인 중',{exact:true}).waitFor();
  await page.getByRole('button',{name:'본인 확인 완료',exact:true}).click();
  await page.getByText('수업 자료 저장 결과를 확인하는 중입니다...',{exact:true}).waitFor();
  assert.equal(await title.count(),0,'remounted editor must wait before loading an old revision');
  await page.getByRole('button',{name:outcome==='success'?'서버 저장 완료':outcome==='failure'?'서버 저장 실패':'다른 화면과 충돌',exact:true}).click({force:true});
  await title.waitFor();await page.waitForFunction(()=>document.querySelector('input[placeholder="수업 자료 제목을 입력하세요"]')?.value==='재인증 중 저장한 제목');
  assert.deepEqual(await page.evaluate(()=>window.fixture.alerts),[],'unmounted editor must not announce success/failure');
  if(outcome==='conflict')await page.getByText(/필요한 편집 내용을 복사해 둔 뒤/).waitFor();
  if(outcome==='failure')await page.getByText(/저장하려던 내용을 복구했습니다.*다시 저장/).waitFor();
  if(outcome!=='conflict'){
   await title.fill('이어서 저장한 제목');await page.getByRole('button',{name:'제목/공개 저장',exact:true}).click();
   await page.getByText('본인 확인 중',{exact:true}).waitFor();
   const calls=await page.evaluate(()=>window.fixture.calls);assert.equal(calls.length,2);assert.equal(calls[1].input.expectedRevision,outcome==='success'?4:3);
   await page.getByRole('button',{name:'서버 저장 완료',exact:true}).click();await page.getByRole('button',{name:'본인 확인 완료',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('input[placeholder="수업 자료 제목을 입력하세요"]')?.value==='이어서 저장한 제목');
  }
  assert.deepEqual(errors,[]);await page.screenshot({path:join(output,outcome+'.png')});checks.push({outcome,calls:await page.evaluate(()=>window.fixture.calls.length),errors});await page.close();
 }
 writeFileSync(join(output,'result.json'),JSON.stringify({passed:true,checks,network:'blocked',productionAccess:0},null,2));console.log(JSON.stringify({passed:true,output,checks}));
}catch(error){if(activePage&&!activePage.isClosed())console.error(JSON.stringify({body:await activePage.locator('body').innerText(),observations:await activePage.evaluate(()=>window.fixture)}));throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
