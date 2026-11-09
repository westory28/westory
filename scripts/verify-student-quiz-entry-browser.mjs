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
export const getDoc=async ref=>{
 window.fixtureReads.push(ref.path);
 if(!['years/2026/semesters/2/assessment_config/settings','years/2026/semesters/2/assessment_config/status'].includes(ref.path))throw Error('Unexpected student read: '+ref.path);
 const active=params.has('refresh')?localStorage.getItem('synthetic-mock-published')==='true':!params.has('closed');
 const keys=['exam_prep_exam_prep__round_1','exam_prep_exam_prep__round_2','exam_prep_exam_prep__round_3','mid_diagnostic','mid_formative','mid2_diagnostic','mid2_formative'];
 const metadata=params.has('missingMetadata')?{}:{questionCount:20,timeLimit:Number(params.get('seconds')||1800)};
 if(params.has('extraRound'))keys.push('exam_prep_exam_prep__round_4');
 const visibility=params.has('legacy')?{visibleTargetGrade:params.get('targetGrade')||'3'}:{visibilityVersion:2,visibleClassIds:params.has('noClasses')?[]:['3-1']};
 const data=params.has('legacyStatus')
  ?(ref.path.endsWith('/status')?{exam_prep_exam_prep:active,mid_diagnostic:active,mid_formative:active}:{})
  :ref.path.endsWith('/settings')?Object.fromEntries(keys.map(key=>[key,{active,allowRetake:!params.has('noRetake'),...visibility,...metadata}])):{};
 return {exists:()=>true,data:()=>data};
};
window.entryReads=[];
export const getMockExamOverview=async input=>{window.entryReads.push(input);await new Promise(r=>setTimeout(r,100));if(params.has('error')&&window.entryReads.length===1)throw Error('synthetic read failure');return {semesterId:input.semesterId,writeCount:0,rounds:[1,2,3].map(n=>({examRound:'round_'+n,completed:n<=completed,retakeBlocked:n<=completed&&(params.has('noRetake')||params.has('limitReached'))&&!params.has('reset')&&!params.has('resumable'),prerequisiteMet:n<=completed+1,requiredRound:n>completed+1?'round_'+(completed+1):''}))}};
`;
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route,useLocation}from'react-router-dom';import QuizIndex from './src/pages/student/quiz/QuizIndex';import './src/components/common/portalPage.css';import {normalizeAssessmentConfigEntry} from './src/lib/assessmentConfig';const metadata=normalizeAssessmentConfigEntry({questionCount:20,timeLimit:1800});window.metadataQA={count:metadata.hasExplicitQuestionCount,time:metadata.hasExplicitTimeLimit,spread:{...metadata},serialized:JSON.parse(JSON.stringify(metadata)),missing:normalizeAssessmentConfigEntry({active:true}).hasExplicitQuestionCount};const Destination=()=>{const location=useLocation();window.fixtureDestinationState=location.state;return <p role="status">{location.pathname+location.search}</p>};createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/student/quiz']}><Routes><Route path="/student/quiz" element={<QuizIndex/>}/><Route path="/student/quiz/run" element={<Destination/>}/><Route path="/student/mypage" element={<Destination/>}/></Routes></MemoryRouter>);`;
const built = await build({ stdin: { contents:entry,loader:'tsx',resolveDir:root },bundle:true,write:false,outdir:'fixture',format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic',setup(p){p.onResolve({filter:/(?:contexts\/AuthContext|lib\/(?:assessmentLifecycle|semesterScope|studentLessonReadCache)|\.\/(?:firebase|semesterScope|siteSettings|historyDictionarySession)|firebase\/firestore)$/},()=>({path:'stub',namespace:'synthetic'}));p.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:stub,loader:'tsx',resolveDir:root}));}}]});
let tailwind;
for(const candidate of [process.env.PORTAL_DESIGN_TAILWIND_PATH,path.join(os.tmpdir(),'westory-qa-tailwind.js'),path.join(os.tmpdir(),'westory-assessment-qa-tailwind.js')].filter(Boolean)){try{tailwind=await fs.readFile(candidate,'utf8');break;}catch{}}
assert(tailwind,'Existing browser QA Tailwind cache is required');
const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text;
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/app.css"><body style="margin:0;background:#f8fafc"><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const [type,body]=({'/app.js':['text/javascript',js],'/app.css':['text/css',css],'/tailwind.js':['text/javascript',tailwind]})[pathname]||['text/html',html];res.setHeader('Content-Type',type+';charset=utf-8');res.end(body);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge',headless:true});
const errors=[],external=[],report=[];
try{
  const context=await browser.newContext();
  await context.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();external.push(route.request().url());return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const tab=label=>page.getByRole('tab',{name:label,exact:true});
  const enter=()=>page.getByRole('button',{name:'시험 입장',exact:true});
  const firstRound=()=>page.getByRole('button',{name:'초시 (1회) · 응시 가능',exact:true});
  const openMock=async()=>{await tab('모의고사').click();await page.locator('.student-exam-lobby').waitFor()};
  for(const width of [320,390,768,1280,1440]){
    await page.setViewportSize({width,height:900});await page.goto(origin);await tab('단원별 평가').waitFor();
    assert.equal(await page.getByRole('heading',{level:1}).textContent(),'문제 풀이');
    assert.equal(await page.evaluate(()=>window.entryReads.length),0,'No overview query before mock tab');
    assert.equal(await page.locator('.student-exam-lobby').count(),0);
    assert.deepEqual(await page.evaluate(()=>window.fixtureReads.slice().sort()),['years/2026/semesters/2/assessment_config/settings','years/2026/semesters/2/assessment_config/status']);
    const unit=await page.locator('.student-quiz-unit').first().evaluate(el=>{const g=el.querySelector('.student-quiz-unit__actions');const buttons=[...g.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}});return{groupWidth:g.getBoundingClientRect().width,innerWidth:el.clientWidth-32,buttons}});
    assert.equal(unit.buttons[0].y,unit.buttons[1].y);assert(Math.abs(unit.buttons[0].width-unit.buttons[1].width)<1);assert(unit.buttons.every(b=>b.height>=44));if(width<1024)assert(Math.abs(unit.groupWidth-unit.innerWidth)<2);
    await tab('단원별 평가').press('ArrowRight');await firstRound().waitFor();
    assert.equal(await tab('모의고사').getAttribute('aria-selected'),'true');
    assert(await enter().isEnabled());
    assert.equal(await page.locator('.student-exam-lobby__facts').innerText(),'출제 문항\n20문항\n제한 시간\n30분');
    const second=page.getByRole('button',{name:'복시 (2회) · 1회 제출 후',exact:true});assert(await second.isEnabled());await second.click();
    assert.equal(await page.locator('#student-exam-heading').textContent(),'복시');assert(await enter().isDisabled());
    await tab('단원별 평가').click();await tab('모의고사').click();assert.equal(await page.evaluate(()=>window.entryReads.length),1,'Tab changes reuse the loaded overview');
    await firstRound().click();assert.equal(await firstRound().getAttribute('aria-pressed'),'true');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
    const layout=await page.evaluate(()=>{const a=document.querySelector('.student-exam-lobby__rounds').getBoundingClientRect(),b=document.querySelector('.student-exam-lobby__detail').getBoundingClientRect();return{listX:a.x,listY:a.y,listRight:a.right,detailX:b.x,detailY:b.y}});
    if(width<768)assert(layout.detailY>layout.listY,'Mobile lists rounds above details');else assert(layout.detailX>=layout.listRight-1,'Desktop details follow the left round list');
    await page.screenshot({path:path.join(evidence,`quiz-entry-${width}.png`),fullPage:true});report.push({width,unit,layout});
  }
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
  assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(external.length,0,JSON.stringify(external));
  await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed:true,report,visibilityCases,publicationRefresh:true,actualConfigReader:true,settingsReads:2,schoolOrRosterReads:0,overviewReadsPerVisit:1,metadataProvenance:true,errors,external},null,2));console.log(evidence);
}finally{await browser.close();await new Promise(r=>server.close(r));}
