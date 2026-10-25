import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import http from 'node:http';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root = process.cwd(), imp = file => JSON.stringify(path.join(root, file).replaceAll('\\', '/'));
const evidence = await fs.mkdtemp(path.join(os.tmpdir(), 'westory-class-analysis-'));
const service = `
export const qa=window.quizClassQa={calls:[],fail:false,hold:false};
export const config={year:'2026',semester:'2'}, currentUser={uid:'teacher-fixture'};
export const useAuth=()=>({config,currentUser,authGeneration:1});
export const getAssessmentSemesterId=c=>c.year+'-'+c.semester;
export const db={};
const forbidden=()=>{throw new Error('Unexpected direct Firestore access');};
export const collection=forbidden,doc=forbidden,getDoc=forbidden,getDocs=forbidden,limit=forbidden,onSnapshot=forbidden,orderBy=forbidden,query=forbidden,where=forbidden;
const tree=[{id:'big',title:'Ⅳ. 조선의 성립과 발전',children:[{id:'unit-a',title:'사림 세력과 정치 변화',children:[{id:'leaf',title:'훈구와 사림'}]}]}];
const q={id:1,docId:'1',unitId:'unit-a',subUnitId:'leaf',category:'formative',type:'choice',question:'훈구와 사림의 정치적 대립을 설명한 내용으로 옳은 것은?',answer:'정답',options:['정답','오답'],concepts:['훈구와 사림'],sourceRevision:'1',contentRevision:1};
const summary=id=>({classId:id,label:'3학년 '+id.slice(-1)+'반',rosterCount:30,submittedCount:id==='class_1'?24:18,unsubmittedCount:id==='class_1'?6:12,scoredCount:id==='class_1'?24:18,averageScore:id==='class_1'?75:60,
scoreHistogram:[0,20,40,60,80].map((lower,i)=>({label:'',lower,upper:i===4?101:lower+20,count:(id==='class_1'?[0,1,3,8,12]:[1,2,3,6,6])[i]})),
questions:[{id:'1',question:q.question,subUnitId:'leaf',concepts:q.concepts,correctCount:8,wrongCount:12,respondentCount:20,correctRate:40}],concepts:[{concept:'훈구와 사림',wrongCount:12,respondentCount:20}],relearning:{repeatedStudentCount:4,wrongToCorrectCount:3,correctToWrongCount:1},generatedAt:'2026-10-25T10:00:00Z',version:'v1',smallSample:id!=='class_1'});
export const callWithApplicationSession=async(name,data)=>{
 if(name!=='getQuizClassAnalysis')throw new Error('Unexpected callable');qa.calls.push(structuredClone(data));
 if(qa.hold)await new Promise(resolve=>qa.release=resolve);
 if(qa.fail){qa.fail=false;throw new Error('Synthetic outage');}
 if(data.mode==='catalog')return {data:{semesterId:data.semesterId,classes:[1,2,3,4,5].map(n=>({id:'class_'+n,label:'3학년 '+n+'반',grade:'3',classNumber:String(n)})),assessments:[{id:'assessment-a',unitId:'unit-a',unitTitle:'사림 세력과 정치 변화',category:'formative',examRound:'',title:'형성평가',questionCount:100}],treeData:tree,generatedAt:'2026-10-25T10:00:00Z'}};
 if(data.mode==='summary')return {data:{...data,classes:data.classIds.map(summary),generatedAt:'2026-10-25T10:00:00Z'}};
 return {data:{semesterId:data.semesterId,students:[{uid:'pupil-a',name:'가상학생',classId:data.classIds[0],number:'1'}],rawRows:[{id:'attempt',source:'canonical',raw:{assessmentKind:'QUIZ',studentUid:'pupil-a',semesterId:data.semesterId,sourceId:'unit-a',category:'formative',submittedAtIso:'2026-10-25T10:00:00Z',percent:0,total:1,answerChecks:[{id:1,correct:false}],answers:{1:'오답'},learningSnapshot:[{id:1,sourceRevision:'1',concepts:q.concepts}],questionSnapshots:[q]}}],questions:[q],treeData:tree,configuredClasses:[{id:data.classIds[0],label:'3학년 1반'}],generatedAt:'2026-10-25T10:00:00Z',version:'v1'}};
};`;
const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import View from ${imp('src/pages/teacher/components/QuizClassAnalysis.tsx')};import ${imp('src/assets/index.css')};import ${imp('src/components/common/portalPage.css')};
function App(){const[questions,setQuestions]=useState([]);return <main className="ws-page"><h1>평가 분석</h1><View canEdit={false} onEdit={()=>{}} onDetailData={q=>setQuestions(q)} editedQuestions={questions} refreshVersion={0}/></main>;}createRoot(document.getElementById('root')).render(<App/>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',loader:{'.svg':'dataurl'},outfile:path.join(evidence,'fixture.js'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-boundaries',setup(p){p.onResolve({filter:/^firebase\/firestore$|(?:^|\/)contexts\/AuthContext$|(?:^|\/)(firebase|assessmentRelease|applicationSession)$/},()=>({path:'service',namespace:'fixture'}));p.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:service,loader:'ts',resolveDir:root}));}}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text.replace(/@import\s+(?:url\()?['"]https?:[^;]+;/g,'');
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server=http.createServer((req,res)=>{const route=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',route.endsWith('.js')?'text/javascript':route.endsWith('.css')?'text/css':'text/html');res.end(route.endsWith('.js')?js:route.endsWith('.css')?css:html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge',headless:true});
const errors=[],screenshots=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.goto(origin);await page.getByRole('option',{name:'사림 세력과 정치 변화',exact:true}).waitFor({state:'attached'});
 assert.deepEqual(await page.evaluate(()=>window.quizClassQa.calls.map(c=>c.mode)),['catalog']);
 await page.getByRole('combobox',{name:'분석할 중단원',exact:true}).selectOption('unit-a');await page.getByRole('combobox',{name:'분석할 학급',exact:true}).selectOption('class_1');
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.length),1);
 await page.getByRole('button',{name:'결과 조회',exact:true}).click();await page.getByRole('heading',{name:'학급 결과',exact:true}).waitFor();
 assert.equal(await page.getByText('가상학생',{exact:true}).count(),0);
 assert.deepEqual(await page.evaluate(()=>window.quizClassQa.calls.at(-1).classIds),['class_1']);
 await page.getByRole('button',{name:'학급 비교',exact:true}).click();await page.getByRole('checkbox',{name:'3학년 2반',exact:true}).check();
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.length),2);
 await page.getByRole('button',{name:'결과 조회',exact:true}).click();await page.getByRole('heading',{name:'학급별 결과 비교',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.quizClassQa.calls.at(-1).classIds),['class_1','class_2']);
 for(const width of [390,768,1280,1366]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(evidence,`comparison-${width}.png`),fullPage:true});screenshots.push(`comparison-${width}.png`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width}`);}
 await page.getByRole('button',{name:'문항·학생 상세 3학년 1반',exact:true}).click();await page.getByRole('heading',{name:'3학년 1반 · 문항·학생 상세',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.at(-1).mode),'detail');assert.deepEqual(await page.evaluate(()=>window.quizClassQa.calls.at(-1).classIds),['class_1']);
 const detail=page.getByRole('region',{name:'3학년 1반 문항·학생 상세',exact:true});
 await detail.getByRole('button',{name:'학생',exact:true}).click();await detail.getByRole('button',{name:'3학년 1반 1번 가상학생',exact:true}).waitFor();
 await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
 await page.evaluate(()=>window.quizClassQa.fail=true);await page.getByRole('button',{name:'최신 결과 조회',exact:true}).click();await page.getByRole('alert').waitFor();
 await page.getByRole('button',{name:'다시 조회',exact:true}).click();await page.getByRole('heading',{name:'학급별 결과 비교',exact:true}).waitFor();
 await page.evaluate(()=>window.quizClassQa.hold=true);await page.getByRole('button',{name:'최신 결과 조회',exact:true}).click();await page.getByRole('combobox',{name:'분석할 학급',exact:true}).selectOption('class_3');await page.evaluate(()=>{window.quizClassQa.hold=false;window.quizClassQa.release();});
 await page.getByText('평가와 학급을 선택한 뒤 결과를 조회해 주세요.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'학급별 결과 비교',exact:true}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS catalog-only entry, explicit class reads, 2-class comparison, lazy single-class detail, errors/retry, stale response discard, responsive layouts');
}finally{await browser.close();server.close();await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({errors,screenshots},null,2));console.log(evidence);}
