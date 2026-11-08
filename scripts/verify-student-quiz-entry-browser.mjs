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
const evidence = await fs.mkdtemp(path.join(os.tmpdir(), "westory-student-quiz-entry-"));
const stub = `
import React from 'react';
const params=new URLSearchParams(location.search);const completed=Number(params.get('completed')||0);
const config={year:'2026',semester:'2'};const currentUser={uid:'synthetic-student'};
export const useAuth=()=>({config,currentUser,userData:{uid:currentUser.uid,grade:3,class:1},menuConfig:{}});
export const getYearSemester=()=>({year:'2026',semester:'2'});
export const readStudentCurriculumTree=async()=>[{id:'big',title:'Ⅴ. 조선 사회의 변동',children:[{id:'mid',title:'1. 조선 후기의 정치 변동과 제도 개혁'},{id:'mid2',title:'2. 사회 변화와 농민의 봉기'}]}];
export const getAssessmentConfigKey=(unit,category,round)=>[unit,category,round].filter(Boolean).join('_');
export const getGrade3ClassIdsFromSchoolConfig=()=>['3-1'];
export const isAssessmentVisibleToStudent=entry=>!!entry?.active;
export const readAssessmentConfigMap=async()=>Object.fromEntries(['exam_prep_exam_prep_round_1','exam_prep_exam_prep_round_2','exam_prep_exam_prep_round_3','mid_diagnostic','mid_formative','mid2_diagnostic','mid2_formative'].map(key=>[key,{active:!params.has('closed')}])) ;
window.entryReads=[];
export const getMockExamOverview=async input=>{window.entryReads.push(input);await new Promise(r=>setTimeout(r,100));if(params.has('error')&&window.entryReads.length===1)throw Error('synthetic read failure');return {semesterId:input.semesterId,writeCount:0,rounds:[1,2,3].map(n=>({examRound:'round_'+n,completed:n<=completed,prerequisiteMet:n<=completed+1,requiredRound:n>completed+1?'round_'+(completed+1):''}))}};
`;
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route,useLocation}from'react-router-dom';import QuizIndex from './src/pages/student/quiz/QuizIndex';import './src/components/common/portalPage.css';const Destination=()=>{const location=useLocation();return <p role="status">{location.pathname+location.search}</p>};createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/student/quiz']}><Routes><Route path="/student/quiz" element={<QuizIndex/>}/><Route path="/student/quiz/run" element={<Destination/>}/><Route path="/student/mypage" element={<Destination/>}/></Routes></MemoryRouter>);`;
const built = await build({ stdin: { contents:entry,loader:'tsx',resolveDir:root },bundle:true,write:false,outdir:'fixture',format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic',setup(p){p.onResolve({filter:/(?:contexts\/AuthContext|lib\/(?:assessmentLifecycle|assessmentConfig|semesterScope|studentLessonReadCache))$/},()=>({path:'stub',namespace:'synthetic'}));p.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:stub,loader:'tsx',resolveDir:root}));}}]});
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
  for(const width of [320,390,768,1280,1440]){
    await page.setViewportSize({width,height:900});await page.goto(origin);await page.getByRole('button',{name:'모의고사',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.entryReads.length),0,'No history query before disclosure');
    assert.equal(await page.locator('.student-mock-picker__round').count(),0);
    const unit=await page.locator('.student-quiz-unit').first().evaluate(el=>{const g=el.querySelector('.student-quiz-unit__actions');const buttons=[...g.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}});return{groupWidth:g.getBoundingClientRect().width,innerWidth:el.clientWidth-32,buttons}});
    assert.equal(unit.buttons[0].y,unit.buttons[1].y);assert(Math.abs(unit.buttons[0].width-unit.buttons[1].width)<1);assert(unit.buttons.every(b=>b.height>=44));if(width<1024)assert(Math.abs(unit.groupWidth-unit.innerWidth)<2);
    await page.getByRole('button',{name:'모의고사',exact:true}).click();await page.getByRole('button',{name:'초시 (1회) · 응시 가능',exact:true}).waitFor();
    assert(await page.getByRole('button',{name:'초시 (1회) · 응시 가능',exact:true}).isEnabled());
    assert(await page.getByRole('button',{name:'복시 (2회) · 1회 제출 후',exact:true}).isDisabled());
    assert(await page.getByRole('button',{name:'전시 (3회) · 1회 제출 후',exact:true}).isDisabled());
    await page.getByRole('button',{name:'모의고사',exact:true}).click();await page.getByRole('button',{name:'모의고사',exact:true}).press('Enter');
    assert.equal(await page.evaluate(()=>window.entryReads.length),1,'Reuse overview during disclosure toggling');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
    await page.screenshot({path:path.join(evidence,`quiz-entry-${width}.png`),fullPage:true});report.push({width,unit});
  }
  for(const completed of [1,2]){
    await page.goto(origin+'?completed='+completed);await page.getByRole('button',{name:'모의고사',exact:true}).click();
    const name=completed===1?'복시 (2회) · 응시 가능':'전시 (3회) · 응시 가능';await page.getByRole('button',{name,exact:true}).click();
    assert((await page.getByRole('status').textContent()).includes('round=round_'+(completed+1)));
  }
  await page.goto(origin+'?error');await page.getByRole('button',{name:'모의고사',exact:true}).click();await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('.student-mock-picker__round:enabled').count(),0,'Unknown state stays locked');
  await page.getByRole('button',{name:'다시 확인',exact:true}).click();await page.getByRole('button',{name:'초시 (1회) · 응시 가능',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.entryReads.length),2);
  await page.goto(origin+'?closed');await page.getByRole('button',{name:'모의고사',exact:true}).click();assert.equal(await page.evaluate(()=>window.entryReads.length),0);assert.equal(await page.locator('.student-mock-picker__round:enabled').count(),0);
  assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(external.length,0,JSON.stringify(external));
  await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed:true,report,errors,external},null,2));console.log(evidence);
}finally{await browser.close();await new Promise(r=>server.close(r));}
