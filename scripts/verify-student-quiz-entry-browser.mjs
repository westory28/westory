/** Synthetic services only: round discovery, sequential gates and compact unit actions. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = process.cwd();
const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const evidence = process.env.STUDENT_QUIZ_ENTRY_EVIDENCE_DIR || await fs.mkdtemp(path.join(os.tmpdir(), "westory-student-quiz-entry-"));
await fs.mkdir(evidence, { recursive: true });
const stub = `
import React from 'react';
const params=new URLSearchParams(location.search);const completed=Number(params.get('completed')||0);
const opensAt='2026-11-11T06:00:00.000Z';
const config={year:'2026',semester:'2'};const currentUser={uid:'synthetic-student'};
export const useAuth=()=>({config,currentUser,userData:{uid:currentUser.uid,grade:Number(params.get('grade')||3),class:Number(params.get('class')||1)},menuConfig:{}});
export const getYearSemester=()=>({year:'2026',semester:'2'});
export const getSemesterDocPath=(_config,collection,id)=>'years/2026/semesters/2/'+collection+'/'+id;
export const readStudentCurriculumTree=async()=>[{id:'big',title:'Ⅴ. 조선 사회의 변동',children:[{id:'mid',title:'1. 조선 후기의 정치 변동과 제도 개혁'},{id:'mid2',title:'2. 사회 변화와 농민의 봉기'}]}];
// Exercise the real config reader/normalizer with synthetic Firestore only.
// A school/roster helper in this student path must fail instead of silently reading users.
window.fixtureReads=[];
export const db={};
export const doc=(_db,...parts)=>({path:parts.join('/')});
export const collection=(_db,...parts)=>({path:parts.join('/')});
export const query=(ref,...filters)=>({...ref,filters});
export const where=(...filter)=>filter;
export const getDocs=async()=>{throw Error('Student quiz must not query a school roster or question collection')};
export const readSiteSettingDoc=async()=>{throw Error('Student quiz must not fetch school_config or roster defaults')};
export const getHttpsCallable=async()=>{throw Error('Unexpected callable')};
export const getHistoryDictionaryCallable=getHttpsCallable;
export const getStudentClassKey=()=> '3-1';
window.noticeSubscriptions=0;
export const subscribeVisibleNotices=(_db,_path,_class,next)=>{window.noticeSubscriptions++;next([{id:'fixture-round-3',targetType:'all',category:'exam',content:params.has('emptyNotice')?'':'오늘 오후 3시 모의고사 3회 전시 공개',imageUrl:'/fixture-notice.svg',imageWidth:1200,imageHeight:675,mockExamRound:params.get('noticeRound')||'round_3'}]);return()=>{}};
export const getDoc=async ref=>{
 window.fixtureReads.push(ref.path);
 if(!['years/2026/semesters/2/assessment_config/settings','years/2026/semesters/2/assessment_config/status'].includes(ref.path))throw Error('Unexpected student read: '+ref.path);
 const active=params.has('refresh')?localStorage.getItem('synthetic-mock-published')==='true':!params.has('closed');
 const keys=['exam_prep_exam_prep__round_1','exam_prep_exam_prep__round_2','exam_prep_exam_prep__round_3','mid_diagnostic','mid_formative','mid2_diagnostic','mid2_formative'];
 const metadata=params.has('missingMetadata')?{}:{questionCount:params.has('scheduled')?23:20,timeLimit:Number(params.get('seconds')||(params.has('scheduled')?2100:1800))};
 if(params.has('extraRound'))keys.push('exam_prep_exam_prep__round_4');
 const visibility=params.has('legacy')?{visibleTargetGrade:params.get('targetGrade')||'3'}:{visibilityVersion:2,visibleClassIds:params.has('noClasses')?[]:['3-1']};
 const data=params.has('legacyStatus')
  ?(ref.path.endsWith('/status')?{exam_prep_exam_prep:active,mid_diagnostic:active,mid_formative:active}:{})
  :ref.path.endsWith('/settings')?Object.fromEntries(keys.map(key=>[key,{active,allowRetake:!params.has('noRetake'),...visibility,...metadata,...(params.has('scheduled')&&key.endsWith('round_3')?{opensAt,lockPaper:true,questionOrder:'created',randomOrder:false}:{} )}])):{};
 return {exists:()=>true,data:()=>data};
};
window.entryReads=[];window.entryReturned=0;
export const getMockExamOverview=async input=>{window.entryReads.push(input);await new Promise(r=>setTimeout(r,100));if(params.has('error')&&window.entryReads.length===1)throw Error('synthetic read failure');window.entryReturned++;return {semesterId:input.semesterId,serverNowIso:new Date(Date.now()-Number(params.get('clockSkewMs')||0)).toISOString(),writeCount:0,rounds:[1,2,3].map(n=>({examRound:'round_'+n,completed:n<=completed,retakeBlocked:n<=completed&&(params.has('noRetake')||params.has('limitReached'))&&!params.has('reset')&&!params.has('resumable'),prerequisiteMet:n<=completed+1,requiredRound:n>completed+1?'round_'+(completed+1):''}))}};
`;
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route,useLocation}from'react-router-dom';import QuizIndex from './src/pages/student/quiz/QuizIndex';import NoticeBoard from './src/pages/student/components/NoticeBoard';import './src/components/common/portalPage.css';import './src/pages/student/studentDashboard.css';import {getNoticeDestination} from './src/lib/noticeDestination';import {normalizeAssessmentConfigEntry} from './src/lib/assessmentConfig';const metadata=normalizeAssessmentConfigEntry({questionCount:20,timeLimit:1800});window.metadataQA={count:metadata.hasExplicitQuestionCount,time:metadata.hasExplicitTimeLimit,spread:{...metadata},serialized:JSON.parse(JSON.stringify(metadata)),missing:normalizeAssessmentConfigEntry({active:true}).hasExplicitQuestionCount};window.noticeDestinationQA=getNoticeDestination;window.scheduleConfigQA=normalizeAssessmentConfigEntry({active:true,opensAt:'2026-11-11T15:00:00+09:00',lockPaper:true,questionCount:23,questionOrder:'created',randomOrder:false,timeLimit:2100,allowRetake:false});const Destination=()=>{const location=useLocation();window.fixtureDestinationState=location.state;return <p role="status">{location.pathname+location.search}</p>};const initialPath=new URLSearchParams(location.search).has('notice')?'/student/dashboard':'/student/quiz';createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[initialPath+location.search]}><Routes><Route path="/student/dashboard" element={<div className="student-portal-dashboard"><NoticeBoard/></div>}/><Route path="/student/quiz" element={<QuizIndex/>}/><Route path="/student/quiz/run" element={<Destination/>}/><Route path="/student/mypage" element={<Destination/>}/></Routes></MemoryRouter>);`;
const built = await build({ stdin: { contents:entry,loader:'tsx',resolveDir:root },bundle:true,write:false,metafile:true,outdir:'fixture',assetNames:'assets/[name]-[hash]',loader:{'.webp':'file'},format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic',setup(p){p.onResolve({filter:/(?:contexts\/AuthContext|lib\/(?:assessmentLifecycle|semesterScope|studentLessonReadCache|firebase|visibleSchedule)|\.\/(?:firebase|semesterScope|siteSettings|historyDictionarySession)|firebase\/firestore)$/},()=>({path:'stub',namespace:'synthetic'}));p.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:stub,loader:'tsx',resolveDir:root}));}}]});
assert(!Object.keys(built.metafile.inputs).some(name=>/node_modules[\\/](@firebase|firebase)[\\/]/.test(name)),'No live Firebase runtime in the entry/notice fixture');
let tailwind;
for(const candidate of [process.env.PORTAL_DESIGN_TAILWIND_PATH,path.join(os.tmpdir(),'westory-qa-tailwind.js'),path.join(os.tmpdir(),'westory-assessment-qa-tailwind.js')].filter(Boolean)){try{tailwind=await fs.readFile(candidate,'utf8');break;}catch{}}
assert(tailwind,'Existing browser QA Tailwind cache is required');
const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text;
const imageAssets=new Map(built.outputFiles.filter(f=>f.path.endsWith('.webp')).map(f=>['/assets/'+path.basename(f.path),f.contents]));
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/app.css"><body style="margin:0;background:#f8fafc"><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/fixture-notice.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#e2e8f0"/><text x="100" y="200" font-size="48">15:00</text></svg>');return;}if(imageAssets.has(pathname)){res.setHeader('Content-Type','image/webp');res.setHeader('Cache-Control','public,max-age=31536000,immutable');res.end(imageAssets.get(pathname));return;}if(pathname.startsWith('/assets/')){res.writeHead(404);res.end();return;}const [type,body]=({'/app.js':['text/javascript',js],'/app.css':['text/css',css],'/tailwind.js':['text/javascript',tailwind]})[pathname]||['text/html',html];res.setHeader('Content-Type',type+';charset=utf-8');res.end(body);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge',headless:true});
const errors=[],external=[],report=[],imageRequests=[],sceneReport=[],scheduledReport=[];
const isExamIllustration=url=>/^\/assets\/(?:chosi|boksi|jeonsi)-[^/]+\.webp$/.test(new URL(url).pathname);
try{
  const context=await browser.newContext();
  await context.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();external.push(route.request().url());return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(isExamIllustration(request.url()))imageRequests.push(request.url());});
  const tab=label=>page.getByRole('tab',{name:label,exact:true});
  const enter=()=>page.getByRole('button',{name:'시험 입장',exact:true});
  const firstRound=()=>page.getByRole('button',{name:'초시 (1회) · 응시 가능',exact:true});
  const openMock=async()=>{await tab('모의고사').click();await page.locator('.student-exam-lobby').waitFor()};
  const scene=()=>page.locator('.student-exam-lobby__scene');
  const sceneImage=()=>scene().locator(':scope > img');
  const sceneTransform=()=>scene().evaluate(element=>getComputedStyle(element).transform);
  const readyScene=async()=>{assert.equal(await sceneImage().count(),1,'Only the selected round image is mounted');await sceneImage().evaluate(async image=>{await image.decode();if(!image.naturalWidth||!image.naturalHeight)throw Error('Scene image failed to load');});return sceneImage().getAttribute('src');};
  if(!process.argv.includes('--scheduled-only')){
  for(const width of [320,390,768,1280,1440]){
    const requestStart=imageRequests.length;
    await page.setViewportSize({width,height:900});await page.goto(origin);await tab('단원별 평가').waitFor();
    assert.equal(await page.getByRole('heading',{level:1}).textContent(),'문제 풀이');
    const tabStyles=await page.getByRole('tab').evaluateAll(tabs=>tabs.map(tab=>{const style=getComputedStyle(tab);return{size:parseFloat(style.fontSize),weight:Number(style.fontWeight),height:tab.getBoundingClientRect().height}}));
    assert(tabStyles.every(tab=>tab.size===18&&tab.weight===800&&tab.height>=56),'Assessment tabs match the score confirmation tab size and weight');
    assert.equal(await page.evaluate(()=>window.entryReads.length),0,'No overview query before mock tab');
    assert.equal(await page.locator('.student-exam-lobby').count(),0);
    assert.equal(imageRequests.length,requestStart,'Hidden mock exam tab does not request illustrations');
    assert.deepEqual(await page.evaluate(()=>window.fixtureReads.slice().sort()),['years/2026/semesters/2/assessment_config/settings','years/2026/semesters/2/assessment_config/status']);
    const unit=await page.locator('.student-quiz-unit').first().evaluate(el=>{const g=el.querySelector('.student-quiz-unit__actions');const buttons=[...g.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}});return{groupWidth:g.getBoundingClientRect().width,innerWidth:el.clientWidth-32,buttons}});
    assert.equal(unit.buttons[0].y,unit.buttons[1].y);assert(Math.abs(unit.buttons[0].width-unit.buttons[1].width)<1);assert(unit.buttons.every(b=>b.height>=44));if(width<1024)assert(Math.abs(unit.groupWidth-unit.innerWidth)<2);
    await tab('단원별 평가').press('ArrowRight');await firstRound().waitFor();
    assert.equal(await tab('모의고사').getAttribute('aria-selected'),'true');
    assert(await enter().isEnabled());
    assert.match(await readyScene(),/chosi-/,'First round displays the local examination scene');
    const entryLayout=await enter().evaluate(button=>{const rect=button.getBoundingClientRect(),art=button.closest('.student-exam-lobby__art').getBoundingClientRect(),style=getComputedStyle(button);return{width:rect.width,height:rect.height,rightGap:art.right-rect.right,available:art.width-32,size:parseFloat(style.fontSize),weight:Number(style.fontWeight)}});
    assert(entryLayout.height>=64&&entryLayout.size===20&&entryLayout.weight===800,'Entry action has a larger box and bold text');
    assert(entryLayout.width>=Math.min(240,entryLayout.available)-1&&Math.abs(entryLayout.rightGap-16)<=1,'Entry action fits the illustration and aligns to its right edge');
    assert.equal(imageRequests.length-requestStart,1,'Opening the mock tab requests only its selected illustration');
    assert.equal(await page.locator('.student-exam-lobby__facts').innerText(),'출제 문항\n20문항\n제한 시간\n30분');
    const second=page.getByRole('button',{name:'복시 (2회) · 1회 제출 후',exact:true});assert(await second.isEnabled());await second.click();
    assert.equal(await page.locator('#student-exam-heading').textContent(),'복시');assert(await enter().isDisabled());
    assert.match(await readyScene(),/boksi-/,'Second round displays its own Seoul scene even while locked');
    await tab('단원별 평가').click();await tab('모의고사').click();assert.equal(await page.evaluate(()=>window.entryReads.length),1,'Tab changes reuse the loaded overview');
    await firstRound().click();assert.equal(await firstRound().getAttribute('aria-pressed'),'true');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
    const layout=await page.evaluate(()=>{const a=document.querySelector('.student-exam-lobby__rounds').getBoundingClientRect(),b=document.querySelector('.student-exam-lobby__detail').getBoundingClientRect();return{listX:a.x,listY:a.y,listRight:a.right,detailX:b.x,detailY:b.y}});
    if(width<768)assert(layout.detailY>layout.listY,'Mobile lists rounds above details');else assert(layout.detailX>=layout.listRight-1,'Desktop details follow the left round list');
    await page.screenshot({path:path.join(evidence,`quiz-entry-${width}.png`),fullPage:true});report.push({width,unit,layout});
  }
  // Real local illustration loading and CSS-only interactions must not add service or asset reads.
  for(const width of [390,768,1280]){
    await page.setViewportSize({width,height:900});await page.goto(origin+'?completed=3');await openMock();await page.getByRole('button',{name:'초시 (1회) · 응시 완료',exact:true}).waitFor();
    const sources=[];
    for(const [index,name] of ['초시','복시','전시'].entries()){
      await page.getByRole('button',{name:name+' ('+(index+1)+'회) · 응시 완료',exact:true}).click();
      const source=await readyScene();sources.push(source);
      assert.match(source,new RegExp(['chosi','boksi','jeonsi'][index]+'-'));
      await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur());
      await page.waitForTimeout(350);
      const baseline=await sceneTransform();
      const reads=await page.evaluate(()=>({overview:window.entryReads.length,settings:window.fixtureReads.length}));
      const requests=imageRequests.length;
      await enter().hover();await page.waitForTimeout(350);
      const hovered=await sceneTransform();assert.notEqual(hovered,baseline,'Enabled entry hover raises the scene');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Raised illustration must not cause horizontal overflow');
      await page.screenshot({path:path.join(evidence,'scene-'+(index+1)+'-hover-'+width+'.png'),fullPage:true});
      await page.mouse.move(0,0);await page.keyboard.press('Tab');await enter().focus();await page.waitForTimeout(350);
      assert(await enter().evaluate(button=>button.matches(':focus-visible')),'Keyboard entry has a visible focus state');
      assert.notEqual(await sceneTransform(),baseline,'Keyboard focus also raises the illustration');
      await page.evaluate(()=>document.activeElement?.blur());await page.waitForTimeout(350);
      await enter().hover();await page.mouse.down();await page.waitForTimeout(350);
      assert.notEqual(await sceneTransform(),baseline,'Pointer press keeps the illustration raised');
      await page.mouse.move(0,0);await page.mouse.up();
      assert.deepEqual(await page.evaluate(()=>({overview:window.entryReads.length,settings:window.fixtureReads.length})),reads,'Illustration interactions add no server reads');
      assert.equal(imageRequests.length,requests,'Illustration interactions add no image requests');
      sceneReport.push({width,round:index+1,source,hovered,reads,imageRequestsDuringInteraction:0});
    }
    assert.equal(new Set(sources).size,3,'All three round scenes are distinct');
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur());await page.waitForTimeout(350);
  const reducedBaseline=await sceneTransform();await enter().hover();await page.waitForTimeout(350);
  assert.equal(await sceneTransform(),reducedBaseline,'Reduced-motion preference keeps the scene still on hover');
  await page.mouse.move(0,0);await page.keyboard.press('Tab');await enter().focus();await page.waitForTimeout(350);
  assert.equal(await sceneTransform(),reducedBaseline,'Reduced-motion preference keeps the scene still on keyboard focus');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto(origin+'?completed=3&noRetake');await openMock();await page.getByRole('button',{name:'초시 (1회) · 응시 완료',exact:true}).waitFor();await readyScene();await page.mouse.move(0,0);await page.waitForTimeout(350);
  const disabledBaseline=await sceneTransform();const disabledEntry=page.getByRole('button',{name:'재응시 불가',exact:true});await disabledEntry.hover();await page.waitForTimeout(350);
  assert.equal(await sceneTransform(),disabledBaseline,'Disabled entry does not advertise an active hover effect');
  assert.deepEqual(await page.evaluate(()=>({count:window.metadataQA.count,time:window.metadataQA.time,missing:window.metadataQA.missing,spread:Object.hasOwn(window.metadataQA.spread,'hasExplicitQuestionCount'),serialized:Object.hasOwn(window.metadataQA.serialized,'hasExplicitTimeLimit')})),{count:true,time:true,missing:false,spread:false,serialized:false},'Display-only metadata provenance is excluded from save payloads');
  // A fast tab round trip while the overview is pending must not launch another read.
  await page.goto(origin);await openMock();await tab('단원별 평가').click();await openMock();await firstRound().waitFor();assert.equal(await page.evaluate(()=>window.entryReads.length),1);
  for(const completed of [1,2]){
    await page.goto(origin+'?completed='+completed);await openMock();
    const name=completed===1?'복시 (2회) · 응시 가능':'전시 (3회) · 응시 가능';await page.getByRole('button',{name,exact:true}).click();await enter().click();
    assert((await page.getByRole('status').textContent()).includes('round=round_'+(completed+1)));assert.equal(await page.evaluate(()=>window.fixtureDestinationState?.startAssessment),true,'A list entry explicitly requests immediate start');
  }
  for(const width of [390,768,1280,1366]){
    await page.setViewportSize({width,height:768});
    for(const [index,name] of ['초시','복시','전시'].entries()){
      await page.goto(origin+'?completed=3&noRetake');await openMock();
      await page.getByRole('button',{name:name+' ('+(index+1)+'회) · 응시 완료',exact:true}).click();
      const blocked=page.getByRole('button',{name:'재응시 불가',exact:true});
      assert(await blocked.isDisabled(),'Completed non-retakable round must disable entry');
      await blocked.evaluate(button=>button.click());
      assert.equal(await page.locator('#student-exam-heading').textContent(),name,'Disabled entry must not navigate to the old intro');
      assert.equal(await page.evaluate(()=>window.fixtureDestinationState),undefined);
      assert.equal(await page.evaluate(()=>window.entryReads.length),1,'Retake guard reuses the existing overview');
      assert.equal(await page.locator('.student-exam-lobby__notice').count(),0,'Known retake restriction must not claim the state is unknown');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(index===0)await page.screenshot({path:path.join(evidence,'retake-blocked-'+width+'.png'),fullPage:true});
    }
  }
  await page.goto(origin+'?noRetake');await openMock();await firstRound().waitFor();assert(await enter().isEnabled(),'First attempt remains available when retakes are disabled');
  await page.goto(origin+'?completed=1&noRetake');await openMock();await page.getByRole('button',{name:'복시 (2회) · 응시 가능',exact:true}).click();assert(await enter().isEnabled(),'Completing a non-retakable round still unlocks the next round');
  await page.goto(origin+'?completed=1');await openMock();await page.getByRole('button',{name:'초시 (1회) · 응시 완료',exact:true}).click();await enter().click();assert((await page.getByRole('status').textContent()).includes('round=round_1'),'Explicitly allowed retakes retain direct entry');
  await page.goto(origin+'?completed=1&limitReached');await openMock();await page.getByRole('button',{name:'초시 (1회) · 응시 완료',exact:true}).click();assert(await page.getByRole('button',{name:'재응시 불가',exact:true}).isDisabled(),'Server attempt limit overrides locally enabled retakes');
  for(const state of ['reset','resumable']){
    await page.goto(origin+'?completed=1&noRetake&'+state);await openMock();await page.getByRole('button',{name:'초시 (1회) · 응시 완료',exact:true}).click();assert(await enter().isEnabled(),'Server-authorized reset/resume must remain available');
  }
  await page.goto(origin+'?error');await openMock();await page.getByRole('alert').waitFor();assert(await enter().isDisabled());
  await page.getByRole('button',{name:'다시 확인',exact:true}).click();await firstRound().waitFor();assert.equal(await page.evaluate(()=>window.entryReads.length),2);
  await page.goto(origin+'?closed');await openMock();assert.equal(await page.evaluate(()=>window.entryReads.length),0);assert(await enter().isDisabled());
  await page.getByRole('button',{name:'복시 (2회) · 준비 중',exact:true}).click();assert.equal(await page.locator('#student-exam-heading').textContent(),'복시');assert.equal(await page.locator('.student-exam-lobby__facts > div').count(),0,'Unpublished metadata is not advertised');
  await page.screenshot({path:path.join(evidence,'unpublished.png'),fullPage:true});
  const visibilityCases=[{search:'?class=2',visible:false},{search:'?noClasses',visible:false},{search:'?legacy',visible:true},{search:'?legacy&grade=2',visible:false},{search:'?legacy&grade=2&targetGrade=2',visible:true},{search:'?legacyStatus',visible:true},{search:'?legacyStatus&grade=2',visible:false}];
  for(const scenario of visibilityCases){
    await page.goto(origin+scenario.search);await tab('단원별 평가').waitFor();assert.equal(await page.getByRole('button',{name:'진단평가',exact:true}).first().isEnabled(),scenario.visible);await openMock();
    if(scenario.visible)await firstRound().waitFor();assert.equal(await enter().isEnabled(),scenario.visible,'Class/legacy visibility: '+scenario.search);assert.equal(await page.evaluate(()=>window.fixtureReads.length),2);
  }
  await page.goto(origin+'?extraRound');await openMock();await firstRound().waitFor();await page.getByRole('button',{name:'추가 모의고사 (4회) · 확인 필요',exact:true}).click();assert(await enter().isDisabled());assert.equal(await page.locator('.student-exam-lobby__notice').innerText(),'응시 상태를 확인할 수 없습니다.');
  for(const seconds of [61,89]){
    await page.goto(origin+'?seconds='+seconds);await openMock();await firstRound().waitFor();assert.equal(await page.locator('.student-exam-lobby__facts dd').last().innerText(),'1분'+(seconds-60)+'초','Preserve exact saved seconds');
  }
  for(const search of ['?missingMetadata','?legacyStatus']){
    await page.goto(origin+search);await openMock();await firstRound().waitFor();assert.equal(await page.locator('.student-exam-lobby__facts > div').count(),0,'Do not present normalized fallback counts/times as saved metadata');
  }
  await page.goto(origin+'?refresh');await openMock();assert(await enter().isDisabled());
  await page.evaluate(()=>localStorage.setItem('synthetic-mock-published','true'));await page.reload();await openMock();await firstRound().waitFor();
  assert.equal(await page.evaluate(()=>window.fixtureReads.length),2);assert.equal(await page.evaluate(()=>window.entryReads.length),1);await enter().click();
  assert((await page.getByRole('status').textContent()).includes('round=round_1'),'Freshly published paper enters its own runner');
  const failedImagePage=await context.newPage();failedImagePage.on('pageerror',error=>errors.push(error.message));
  const failedImageRequests=[];
  await failedImagePage.route('**/*.webp',route=>{if(!isExamIllustration(route.request().url()))return route.continue();failedImageRequests.push(route.request().url());return route.fulfill({status:503,contentType:'image/webp',body:''});});
  await failedImagePage.goto(origin);await failedImagePage.getByRole('tab',{name:'모의고사',exact:true}).click();
  await failedImagePage.getByRole('button',{name:'초시 (1회) · 응시 가능',exact:true}).waitFor();
  await failedImagePage.waitForFunction(()=>{const image=document.querySelector('.student-exam-lobby__scene > img');return image?.complete&&image.naturalWidth===0;});
  const fallbackEntry=failedImagePage.getByRole('button',{name:'시험 입장',exact:true});assert(await fallbackEntry.isEnabled(),'Illustration download failure must not block exam entry');
  assert.equal(failedImageRequests.length,1,'Failed illustration does not start retry polling');
  assert.equal(await failedImagePage.evaluate(()=>window.entryReads.length),1,'Image failure does not repeat assessment reads');
  await failedImagePage.screenshot({path:path.join(evidence,'scene-download-failure.png'),fullPage:true});
  await fallbackEntry.click();assert((await failedImagePage.getByRole('status').textContent()).includes('round=round_1'),'Exam entry still works when its illustration is unavailable');
  await failedImagePage.close();
  }
  const openingTime=Date.parse('2026-11-11T06:00:00.000Z');
  for(const scenario of [
    ...[320,390,768,1280,1440].map(width=>({width,mode:'timer',completed:2})),
    {width:390,mode:'timer',completed:2,skew:3600000},
    {width:390,mode:'timer',completed:2,skew:-3600000},
    {width:390,mode:'visibilitychange',completed:2},
    {width:768,mode:'pageshow',completed:2},
    {width:390,mode:'timer',completed:1},
    {width:390,mode:'timer',completed:3},
    {width:390,mode:'timer',completed:2,notice:true},
    {width:390,mode:'timer',completed:2,error:true},
    {width:390,mode:'timer',completed:2,round:' ROUND_3 ',noTab:true},
    {width:390,mode:'timer',completed:2,notice:true,noticeRound:' ROUND_3 '},
    {width:390,mode:'timer',completed:2,notice:true,emptyNotice:true},
  ]){
    const scheduledPage=await context.newPage();scheduledPage.on('pageerror',error=>errors.push(error.message));
    await scheduledPage.setViewportSize({width:scenario.width,height:900});
    const skew=scenario.skew||0;
    await scheduledPage.clock.install({time:new Date(openingTime-10000+skew)});
    const params=new URLSearchParams({scheduled:'',completed:String(scenario.completed),noRetake:'',clockSkewMs:String(skew),...(scenario.error?{error:''}:{}),...(scenario.emptyNotice?{emptyNotice:''}:{}),...(scenario.notice?{notice:'',noticeRound:scenario.noticeRound||'round_3'}:{...(scenario.noTab?{}:{tab:'mock'}),round:scenario.round||'round_3'})});
    await scheduledPage.goto(origin+'?'+params);
    if(scenario.notice){
      const notice=scheduledPage.getByRole('button',{name:'모의고사 응시 화면 열기',exact:true});
      assert.equal(await notice.locator('img').getAttribute('alt'),scenario.emptyNotice?'알림장':'오늘 오후 3시 모의고사 3회 전시 공개','Notice image preserves its announcement text and empty-text fallback');
      await notice.focus();await scheduledPage.keyboard.press('Enter');
      assert.equal(await scheduledPage.evaluate(()=>window.noticeSubscriptions),1,'Notice click does not duplicate its subscription');
    }
    await scheduledPage.getByRole('button',{name:'Coming soon',exact:true}).waitFor();
    if(scenario.error){
      await scheduledPage.getByRole('alert').waitFor();
      assert(await scheduledPage.getByRole('button',{name:'Coming soon',exact:true}).isDisabled());
      assert.match(await scheduledPage.locator('.student-exam-lobby__notice').innerText(),/3:00.*공개/,'Scheduled opening remains visible with the error');
      assert((await scheduledPage.evaluate(()=>Date.now()))<openingTime,'Retry is offered before opening time');
      assert.equal(await scheduledPage.evaluate(()=>window.entryReads.length),1);
      await scheduledPage.screenshot({path:path.join(evidence,'scheduled-retry-before-opening-390.png'),fullPage:true});
      await scheduledPage.getByRole('button',{name:'다시 확인',exact:true}).click();
    }
    await scheduledPage.waitForFunction(()=>window.entryReturned===1);
    assert.equal(await scheduledPage.getByRole('alert').count(),0,'Successful status retry clears the error');
    assert.equal(await scheduledPage.getByRole('tab',{name:'모의고사',exact:true}).getAttribute('aria-selected'),'true','Direct link selects the mock exam tab');
    assert.equal(await scheduledPage.locator('#student-exam-heading').textContent(),'전시','Direct link selects round 3');
    assert.equal(await scheduledPage.locator('.student-exam-lobby__facts').innerText(),'출제 문항\n23문항\n제한 시간\n35분');
    assert(await scheduledPage.getByRole('button',{name:'Coming soon',exact:true}).isDisabled(),'Entry is disabled before 15:00 server time');
    const image=scheduledPage.locator('.student-exam-lobby__scene > img');
    await image.evaluate(image=>image.decode());
    assert.equal(await image.evaluate(image=>getComputedStyle(image).filter),'grayscale(1)');
    assert.match(await scheduledPage.locator('.student-exam-lobby__notice').innerText(),/11월 11일.*3:00.*공개/);
    assert.equal(await scheduledPage.evaluate(()=>window.fixtureDestinationState),undefined,'Opening the scheduled lobby does not start an attempt');
    const reads=await scheduledPage.evaluate(()=>({settings:window.fixtureReads.length,overview:window.entryReads.length}));
    assert.deepEqual(reads,{settings:2,overview:scenario.error?2:1});
    if(!skew&&scenario.completed===2&&!scenario.notice)await scheduledPage.screenshot({path:path.join(evidence,`scheduled-before-${scenario.mode}-${scenario.width}.png`),fullPage:true});
    if(scenario.mode==='timer'){
      const remaining=await scheduledPage.evaluate(({openingTime,skew})=>openingTime-(Date.now()-skew)+30,{openingTime,skew});
      await scheduledPage.clock.fastForward(Math.max(0,remaining));
    }else{
      await scheduledPage.clock.setSystemTime(new Date(openingTime+skew+1000));
      await scheduledPage.evaluate(mode=>(mode==='pageshow'?window:document).dispatchEvent(new Event(mode)),scenario.mode);
    }
    await scheduledPage.waitForFunction(()=>getComputedStyle(document.querySelector('.student-exam-lobby__scene > img')).filter==='none');
    assert.equal(await scheduledPage.getByRole('button',{name:'Coming soon',exact:true}).count(),0);
    const entry=scheduledPage.getByRole('button',{name:scenario.completed===3?'재응시 불가':'시험 입장',exact:true});
    assert.equal(await entry.isEnabled(),scenario.completed===2,'Opening time retains prerequisite and no-retake restrictions');
    assert.deepEqual(await scheduledPage.evaluate(()=>({settings:window.fixtureReads.length,overview:window.entryReads.length})),reads,'Clock and tab recovery add no server reads');
    assert.equal(await scheduledPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    const header=await scheduledPage.locator('.ws-page-header').evaluate(node=>{const style=getComputedStyle(node);return{background:style.backgroundColor,position:style.position,minHeight:style.minHeight,shadow:style.boxShadow}});
    assert.deepEqual(header,{background:'rgba(0, 0, 0, 0)',position:'static',minHeight:'0px',shadow:'none'},'Page heading stays on the page background');
    if(!skew&&scenario.completed===2&&!scenario.notice)await scheduledPage.screenshot({path:path.join(evidence,`scheduled-open-${scenario.mode}-${scenario.width}.png`),fullPage:true});
    if(scenario.completed===2){
      await entry.click();
      const destination=await scheduledPage.getByRole('status').textContent();
      assert(destination.includes('/student/quiz/run?')&&destination.includes('category=exam_prep')&&destination.includes('round=round_3'));
      assert.equal(await scheduledPage.evaluate(()=>window.fixtureDestinationState?.startAssessment),true,'Only explicit entry requests a timed attempt');
    }
    scheduledReport.push({...scenario,reads,passed:true});
    await scheduledPage.close();
  }
  await page.goto(origin);
  const destinations=await page.evaluate(()=>[null,{},
    {mockExamRound:'round_3'},
    {mockExamRound:' ROUND_3 '},
    {developerLogPostId:'exam_3-announcement'},
    {mockExamRound:'javascript:alert(1)'},
    {mockExamRound:'//evil.invalid'},
    {developerLogPostId:'https://evil.invalid'},
    {developerLogPostId:'../outside'},
    {developerLogPostId:'safe?redirect=//evil.invalid'},
  ].map(window.noticeDestinationQA));
  assert.deepEqual(destinations,[null,null,{path:'/student/quiz?tab=mock&round=round_3',label:'모의고사 응시 화면 열기'},{path:'/student/quiz?tab=mock&round=round_3',label:'모의고사 응시 화면 열기'},{path:'/developer-log/exam_3-announcement',label:'연결된 개발자 일지 열기'},null,null,null,null,null]);
  assert.deepEqual(await page.evaluate(()=>{const config=window.scheduleConfigQA;return{opensAt:config.opensAt,lockPaper:config.lockPaper,questionCount:config.questionCount,questionOrder:config.questionOrder,randomOrder:config.randomOrder,timeLimit:config.timeLimit,allowRetake:config.allowRetake}}),{opensAt:'2026-11-11T06:00:00.000Z',lockPaper:true,questionCount:23,questionOrder:'created',randomOrder:false,timeLimit:2100,allowRetake:false},'Normalization preserves the scheduled fixed-paper contract');
  assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(external.length,0,JSON.stringify(external));
  await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed:true,report,sceneReport,scheduledReport,noticeSafeRoutes:true,actualConfigReader:true,settingsReads:2,schoolOrRosterReads:0,overviewReadsPerVisit:1,metadataProvenance:true,errors,external},null,2));console.log(evidence);
}finally{await browser.close();await new Promise(r=>server.close(r));}
