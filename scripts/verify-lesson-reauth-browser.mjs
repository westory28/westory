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
export const observations={calls:[],reads:[],alerts:[],commits:0,pointerRevision:1};
const ackLostMode=location.search.includes('acklost'),replaceMode=location.search.includes('replace');
const uploadMode=location.search.includes('upload')||ackLostMode||replaceMode;let uploadAuthUsed=false,assetSequence=0,replaceFailed=false;
const tickets=new Map(),receipts=new Map();
if(replaceMode)saved={...saved,contentHtml:'<p>[fn:delete]</p>',footnotes:[{id:'delete-note',anchorKey:'delete',title:'삭제할 각주',label:'삭제할 각주',bodyHtml:'<p>복구 후 삭제할 이미지</p>',contentType:'sourceArchiveImage',sourceArchiveImagePath:'archive/original.png',order:0}]};
const ticket=input=>{const uploadId='asset-'+(++assetSequence),storagePath='lesson-assets/'+uploadId,url='/uploaded-'+uploadId+'.png';tickets.set(uploadId,{...input,storagePath,url,status:'VERIFIED'});return {uploadId,storagePath};};
let signal=()=>{},pending;export const setSignal=fn=>signal=fn;
export const collection=(_,path)=>({path});export const doc=(_, ...parts)=>({path:parts.join('/')});
export const where=(key,op,value)=>({key,value});export const limit=()=>({});export const orderBy=()=>({});export const query=(ref,...filters)=>({...ref,filters});export const serverTimestamp=()=>100;
const snapshot=data=>({exists:()=>!!data,data:()=>structuredClone(data),id:'unit',ref:{path:'lesson'}});
export const getDoc=async ref=>ref.path==='site_settings/semester_active'?snapshot({semesterId:'2026-2',revision:observations.pointerRevision}):getDocFromServer(ref);
export const getDocFromServer=async ref=>{observations.reads.push(ref.path);return ref.path.startsWith('lesson_asset_uploads/')?snapshot(tickets.get(ref.path.split('/').at(-1))):ref.path.endsWith('curriculum/tree')?snapshot({tree,contentRevision:treeRevision}):snapshot(null);};
export const getDocsFromServer=async ref=>{observations.reads.push(ref.path);const docs=ref.path==='lessons'?[]:[snapshot(saved)];return {empty:!docs.length,docs};};
export const getDocs=async()=>{throw Error('Editor must read committed server data');};
export const ref=()=>({});export const getBlob=async()=>new Blob(['image'],{type:'image/png'});export const getDownloadURL=async()=>'';export const listAll=async()=>({items:[],prefixes:[]});
export const subscribeSourceArchiveAssets=callback=>{callback([]);return()=>{};};
export default function Stub(){return null;}export const lazyWithRetry=()=>Stub;export const processPdfMapFile=async()=>({pageImages:[{page:1,width:600,height:800,blob:new Blob(['page'],{type:'image/png'})}],regions:[]});
export const executeWestoryCommand=async(type,input,options)=>{
 observations.calls.push({type,input:structuredClone(input),options});
 if(options.expectedUid!=='teacher-a')throw Error('Wrong owner');
 const receiptKey=JSON.stringify(input);if(type==='saveLessonDocument'&&receipts.has(receiptKey))return receipts.get(receiptKey);
 if(input.expectedRevision!==saved.contentRevision)throw Object.assign(Error('다른 화면에서 수정되었습니다.'),{state:'conflict'});
 if(type==='prepareLessonAssetUpload'){
  if(uploadAuthUsed||ackLostMode||replaceMode)return {result:ticket(input)};uploadAuthUsed=true;signal(false);
  return new Promise((resolve,reject)=>pending={resolve,reject,input,type});
 }
 if(replaceMode&&!replaceFailed){replaceFailed=true;signal(false);return new Promise((resolve,reject)=>pending={resolve,reject,input});}
 if(uploadMode){
  const d=input.document;for(const id of input.assetUploadIds){const t=tickets.get(id);if(!t||(t.kind==='PDF'?d.pdfStoragePath!==t.storagePath||d.pdfUrl!==t.url:t.kind==='PAGE'?!d.worksheetPageImages.some(p=>p.imageUrl===t.url):!d.footnotes.some(n=>n.imageStoragePath===t.storagePath&&n.imageUrl===t.url)))throw Error('LESSON_ASSET_UNUSED');}
  saved={...saved,...input.document,contentRevision:saved.contentRevision+1};if(input.tree){tree=input.tree;treeRevision++;}observations.commits++;const response={result:{contentRevision:saved.contentRevision,treeRevision}};receipts.set(receiptKey,response);
  if(ackLostMode&&observations.commits===1){observations.pointerRevision=9;throw Object.assign(Error('저장 응답과 결과 조회를 확인하지 못했습니다.'),{state:'retryable',retryable:true});}return response;}
 signal(false);
 return new Promise((resolve,reject)=>pending={resolve,reject,input});
};
export const remount=()=>signal(true);
export const finish=mode=>{const item=pending;if(!item)throw Error('No submitted write');pending=null;
 if(item.type==='prepareLessonAssetUpload'){if(mode==='success')item.resolve({result:ticket(item.input)});else item.reject(Object.assign(Error('업로드 연결이 끊겼습니다.'),{state:'retryable'}));return;}
 if(mode==='success'){saved={...saved,...item.input.document,contentRevision:saved.contentRevision+1};if(item.input.tree){tree=item.input.tree;treeRevision++;}item.resolve({result:{contentRevision:saved.contentRevision,treeRevision}});}
 else {if(mode==='conflict')saved={...saved,title:'다른 화면의 제목',contentRevision:saved.contentRevision+1};item.reject(Object.assign(Error(mode==='conflict'?'다른 화면에서 수정되었습니다.':'서버가 저장을 거절했습니다.'),{state:mode==='conflict'?'conflict':'failed'}));}
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
 for(const outcome of ['success','failure']){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});activePage=page;const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?upload');
  const title=page.getByPlaceholder('수업 자료 제목을 입력하세요');await title.waitFor();
  await page.locator('input[accept="application/pdf"]').setInputFiles({name:'reauth.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 fixture')});
  await page.getByRole('button',{name:'PDF 저장',exact:true}).first().waitFor();
  await title.fill('PDF 저장에 포함하지 않은 제목');
  await page.getByRole('button',{name:'PDF 저장',exact:true}).click();
  await page.getByText('본인 확인 중',{exact:true}).waitFor();await page.getByRole('button',{name:'본인 확인 완료',exact:true}).click();
  await page.getByText('수업 자료 저장 결과를 확인하는 중입니다...',{exact:true}).waitFor();assert.equal(await title.count(),0);
  await page.getByRole('button',{name:outcome==='success'?'서버 저장 완료':'서버 저장 실패',exact:true}).click();
  await title.waitFor();assert.equal(await title.inputValue(),'PDF 저장에 포함하지 않은 제목','unsaved metadata must survive a PDF-only reauthentication');
  if(outcome==='failure'){
   await page.getByText(/업로드 연결이 끊겼습니다.*복구했습니다/).waitFor();
   await page.getByRole('button',{name:'PDF 저장',exact:true}).click();
  }
  await page.waitForFunction(()=>window.fixture.calls.some(c=>c.type==='saveLessonDocument'));
  await page.waitForFunction(()=>!document.querySelector('[role="status"]'));
  const writes=await page.evaluate(()=>window.fixture.calls.filter(c=>c.type==='saveLessonDocument'));
  assert.equal(writes.length,1);assert.equal(writes[0].input.expectedRevision,3);assert.equal(writes[0].input.document.pdfName,'reauth.pdf');assert.equal(writes[0].input.document.title,'원래 제목');assert.equal(writes[0].input.assetUploadIds.length,2);
  assert.deepEqual(await page.evaluate(()=>window.fixture.alerts),[]);assert.deepEqual(errors,[]);
  await page.screenshot({path:join(output,'upload-'+outcome+'.png')});checks.push({outcome:'upload-'+outcome,writes:writes.length,errors});await page.close();
 }
 {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});activePage=page;const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?acklost');
  const title=page.getByPlaceholder('수업 자료 제목을 입력하세요');await title.waitFor();
  await title.fill('별도로 남긴 제목');
  await page.locator('input[accept="application/pdf"]').setInputFiles({name:'acklost.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 fixture')});
  await page.getByRole('button',{name:'PDF 저장',exact:true}).click();
  await page.getByText('저장 결과 확인이 필요합니다.',{exact:true}).waitFor();
  assert.equal(await title.count(),0,'unconfirmed save blocks further editing until original receipt settles');
  const before=await page.evaluate(()=>structuredClone(window.fixture.calls));
  assert.equal(before.filter(c=>c.type==='prepareLessonAssetUpload').length,2);
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:join(output,'unconfirmed-'+width+'.png')});}
  await page.getByRole('button',{name:'저장 결과 다시 확인',exact:true}).click();
  await title.waitFor();assert.equal(await title.inputValue(),'별도로 남긴 제목','PDF-only retry preserves unsaved general metadata');
  const after=await page.evaluate(()=>window.fixture.calls),writes=after.filter(c=>c.type==='saveLessonDocument');
  assert.equal(after.filter(c=>c.type==='prepareLessonAssetUpload').length,2,'receipt retry never uploads files again');
  assert.equal(writes.length,2);assert.deepEqual(writes[1].input,writes[0].input,'full submitted payload including old semester revision is replayed');
  assert.equal(writes[1].input.expectedSemesterRevision,1);assert.equal(await page.evaluate(()=>window.fixture.commits),1);
  assert.deepEqual(errors,[]);checks.push({outcome:'mounted-ack-and-receipt-loss',commits:1,uploads:2,errors});await page.close();
 }
 {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});activePage=page;const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?replace');
  const title=page.getByPlaceholder('수업 자료 제목을 입력하세요');await title.waitFor();
  await page.locator('input[accept="application/pdf"]').setInputFiles({name:'first.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 first')});
  await page.getByRole('button',{name:'PDF 저장',exact:true}).last().click();
  await page.getByText('본인 확인 중',{exact:true}).waitFor();
  await page.getByRole('button',{name:'본인 확인 완료',exact:true}).click();
  await page.getByText('수업 자료 저장 결과를 확인하는 중입니다...',{exact:true}).waitFor();
  await page.getByRole('button',{name:'서버 저장 실패',exact:true}).click();await title.waitFor();
  await page.getByText(/서버가 저장을 거절했습니다.*복구했습니다/).waitFor();
  const firstWrite=await page.evaluate(()=>window.fixture.calls.find(c=>c.type==='saveLessonDocument').input);
  assert.equal(firstWrite.assetUploadIds.length,3,'first draft includes page, PDF, and copied footnote');
  await page.locator('input[accept="application/pdf"]').setInputFiles({name:'replacement.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 replacement')});
  await page.locator('button[aria-label="빈칸과 각주 목록"]:visible').first().click();
  await page.getByRole('button',{name:'각주 1',exact:true}).click();
  await page.getByRole('button',{name:/삭제할 각주/}).click();
  await page.getByText('편집',{exact:true}).click();
  await page.getByText('삭제',{exact:true}).click();
  await page.getByRole('button',{name:'PDF 저장',exact:true}).last().click();
  await page.waitForFunction(()=>window.fixture.commits===1);
  const writes=await page.evaluate(()=>window.fixture.calls.filter(c=>c.type==='saveLessonDocument').map(c=>c.input));
  assert.equal(writes.length,2);assert.equal(writes[1].document.pdfName,'replacement.pdf');assert.equal(writes[1].document.footnotes.length,0);
  assert.equal(writes[1].assetUploadIds.length,2);assert.equal(writes[1].assetUploadIds.some(id=>firstWrite.assetUploadIds.includes(id)),false,'discarded recovered PDF/page/footnote IDs are not sent');
  assert.equal(writes[1].expectedRevision,3,'changing recovered attachments never rebases document CAS');
  assert.deepEqual(errors,[]);await page.screenshot({path:join(output,'recovered-replace-delete.png')});checks.push({outcome:'recovered-pdf-replacement-and-footnote-deletion',commits:1,retainedUnused:0,errors});await page.close();
 }
 writeFileSync(join(output,'result.json'),JSON.stringify({passed:true,checks,network:'blocked',productionAccess:0},null,2));console.log(JSON.stringify({passed:true,output,checks}));
}catch(error){if(activePage&&!activePage.isClosed())console.error(JSON.stringify({body:await activePage.locator('body').innerText(),observations:await activePage.evaluate(()=>window.fixture)}));throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
