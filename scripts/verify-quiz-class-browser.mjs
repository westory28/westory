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
const detailQuestions=Array.from({length:25},(_,i)=>({...q,id:i+1,docId:String(i+1),question:[q.question,'자료의 인물들이 성장한 배경으로 가장 적절한 것은?','기묘사화의 배경을 가장 적절하게 설명한 것은?','광해군의 정책에 대한 설명으로 옳은 것은?'][i%4],concepts:[['훈구와 사림'],['사림 성장'],['기묘사화'],['광해군']][i%4]}));
const behaviorCounts={suspected_guessing:1,repeated_choice:1,unflagged:1,insufficient:1,no_attempt:1};
const behaviorSummary=()=>qa.behaviorNoAttempt?{behaviorCounts:{suspected_guessing:0,repeated_choice:0,unflagged:0,insufficient:0,no_attempt:5},rosterCount:5,submittedCount:0,unsubmittedCount:5,scoredCount:0,averageScore:null,scoreHistogram:[0,20,40,60,80].map((lower,i)=>({label:'',lower,upper:i===4?101:lower+20,count:0}))}:{behaviorCounts,rosterCount:5,submittedCount:4,unsubmittedCount:1,scoredCount:4};
const behaviorData=classId=>({
 students:['빠른학생','반복학생','확인학생','부족학생','미응시학생'].map((name,index)=>({uid:'behavior-'+index,name,classId,number:String(index+1)})),
 rawRows:Array.from({length:4},(_,index)=>{
   const answers=Object.fromEntries(detailQuestions.map(q=>[q.id,index===1||q.id%2?'오답':'정답']));
   return {id:'behavior-attempt-'+index,source:'canonical',raw:{assessmentKind:'QUIZ',studentUid:'behavior-'+index,semesterId:'2026-2',sourceId:'unit-a',category:'formative',submittedAtIso:'2026-10-25T10:00:00Z',percent:48,total:25,behaviorAnswersAvailable:true,answers,
    answerChecks:detailQuestions.map(q=>({id:q.id,correct:answers[q.id]==='정답'})),learningSnapshot:detailQuestions.map(q=>({id:q.id,sourceRevision:'1',concepts:q.concepts})),questionSnapshots:detailQuestions,
    analytics:index===3?null:{version:1,quality:'complete',questions:Object.fromEntries(detailQuestions.map(q=>[q.id,{quality:'complete',activeMs:index===0?2000:12000,hiddenMs:0,firstResponseMs:1000,finalResponseMs:1000,answerChangeCount:0,revisitCount:0,hintViewed:false}]))}}};
 })
});
const summary=id=>({classId:id,label:'3학년 '+id.slice(-1)+'반',rosterCount:30,submittedCount:id==='class_1'?24:18,unsubmittedCount:id==='class_1'?6:12,scoredCount:id==='class_1'?24:18,averageScore:id==='class_1'?75:60,
scoreHistogram:[0,20,40,60,80].map((lower,i)=>({label:'',lower,upper:i===4?101:lower+20,count:(id==='class_1'?[0,1,3,8,12]:[1,2,3,6,6])[i]})),
questions:[{id:'1',question:q.question,subUnitId:'leaf',concepts:q.concepts,correctCount:8,wrongCount:12,respondentCount:20,correctRate:40}],concepts:[{concept:'훈구와 사림',wrongCount:12,respondentCount:20}],relearning:{repeatedStudentCount:4,wrongToCorrectCount:3,correctToWrongCount:1},generatedAt:'2026-10-25T10:00:00Z',version:'v1',smallSample:id!=='class_1',...(qa.behavior?behaviorSummary(): {})});
export const callWithApplicationSession=async(name,data)=>{
 data=JSON.parse(JSON.stringify(data,(_key,value)=>value===undefined?null:value));
 if(data.mode==='detail'&&Object.hasOwn(data,'comparisonGrade'))throw new Error('Summary-only field sent to detail');
 if(name!=='getQuizClassAnalysis')throw new Error('Unexpected callable');qa.calls.push(structuredClone(data));
 if(qa.hold)await new Promise(resolve=>qa.release=resolve);
 if(qa.fail){qa.fail=false;throw new Error('Synthetic outage');}
 if(data.mode==='catalog')return {data:{semesterId:data.semesterId,classes:[1,2,3,4,5].map(n=>({id:'class_'+n,label:'3학년 '+n+'반',grade:'3',classNumber:String(n)})),assessments:[{id:'assessment-a',unitId:'unit-a',unitTitle:'사림 세력과 정치 변화',category:'formative',examRound:'',title:'형성평가',questionCount:100}],treeData:tree,generatedAt:'2026-10-25T10:00:00Z'}};
 const search=data.keyword?{keyword:data.keyword,matchedQuestionCount:data.keyword==='없는검색'?0:25,unitCount:2,questionIds:data.keyword==='없는검색'?[]:detailQuestions.map(q=>String(q.id)),generatedAt:'2026-10-25T10:00:00Z'}:undefined;
 if(data.mode==='summary')return {data:{...data,classes:data.classIds.map(summary),...(search?{search}:{}),...(data.comparisonGrade?{gradeComparison:{...summary('class_1'),classId:'grade:3',label:'3학년 전체',grade:'3',classCount:5,respondingClassCount:5,rosterCount:150,scoredCount:96,submittedCount:96,unsubmittedCount:54,averageScore:66,weighting:'scored_students',...(qa.behavior?{rosterCount:25,submittedCount:qa.behaviorNoAttempt?0:20,scoredCount:qa.behaviorNoAttempt?0:20,unsubmittedCount:qa.behaviorNoAttempt?25:5,behaviorCounts:Object.fromEntries(Object.entries(behaviorSummary().behaviorCounts).map(([key,value])=>[key,value*5]))}:{})}}:{}),generatedAt:'2026-10-25T10:00:00Z'}};
 return {data:{semesterId:data.semesterId,...(search?{keyword:data.keyword,search,basis:'latest_current_revision_keyword_items'}:{}),students:[{uid:'pupil-a',name:'가상학생',classId:data.classIds[0],number:'1'}],rawRows:[{id:'attempt',source:'canonical',raw:{assessmentKind:'QUIZ',studentUid:'pupil-a',semesterId:data.semesterId,sourceId:'unit-a',category:'formative',submittedAtIso:'2026-10-25T10:00:00Z',percent:0,total:25,answerChecks:detailQuestions.map(q=>({id:q.id,correct:false})),answers:Object.fromEntries(detailQuestions.map(q=>[q.id,'오답'])),learningSnapshot:detailQuestions.map(q=>({id:q.id,sourceRevision:'1',concepts:q.concepts})),questionSnapshots:detailQuestions}}],...(qa.behavior?behaviorData(data.classIds[0]):{}),questions:detailQuestions,treeData:tree,configuredClasses:[{id:data.classIds[0],label:'3학년 1반'}],generatedAt:'2026-10-25T10:00:00Z',version:'v1'}};
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
 await page.goto(origin);await page.getByRole('option',{name:'Ⅳ. 조선의 성립과 발전',exact:true}).waitFor({state:'attached'});
 assert.deepEqual(await page.evaluate(()=>window.quizClassQa.calls.map(c=>c.mode)),['catalog']);
 await page.getByRole('combobox',{name:'분석할 대단원',exact:true}).selectOption('big');
 await page.getByRole('combobox',{name:'분석할 중단원',exact:true}).selectOption('unit-a');await page.getByRole('combobox',{name:'분석할 학급',exact:true}).selectOption('class_1');
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.length),1);
 await page.getByRole('button',{name:'결과 조회',exact:true}).click();await page.getByRole('heading',{name:'학급 결과',exact:true}).waitFor();
 assert.ok((await page.getByRole('region',{name:'학급별 풀이 분류 표',exact:true}).innerText()).includes('집계 미확인'),'old summary omission is not zero or normal');
 assert.equal(await page.getByText('가상학생',{exact:true}).count(),0);
 assert.deepEqual(await page.evaluate(()=>window.quizClassQa.calls.at(-1).classIds),['class_1']);
 await page.getByRole('button',{name:'학급 비교',exact:true}).click();await page.getByRole('checkbox',{name:'3학년 2반',exact:true}).check();
 await page.getByRole('checkbox',{name:'3학년 전체 평균',exact:true}).check();
 await page.getByRole('button',{name:'선택 완료',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.length),2);
 await page.getByRole('button',{name:'결과 조회',exact:true}).click();await page.getByRole('heading',{name:'학급별 결과 비교',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.quizClassQa.calls.at(-1).classIds),['class_1','class_2']);
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.at(-1).comparisonGrade),'3');
 for(const width of [320,390,768,1280,1366,1440]){
   await page.setViewportSize({width,height:768});
   await page.screenshot({path:path.join(evidence,`comparison-${width}.png`),fullPage:true});screenshots.push(`comparison-${width}.png`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width}`);
   if(width>=1280){
     const layout=await page.evaluate(()=>{
       const fields=[...document.querySelectorAll('.qca-filters > label')].map(e=>e.getBoundingClientRect());
       const reset=document.querySelector('.qca-reset').getBoundingClientRect();
       const form=document.querySelector('.qca-filters').getBoundingClientRect();
       return {unitWidths:fields.slice(0,2).map(r=>r.width),gap:fields[1].left-fields[0].right,right:form.right-reset.right};
     });
     assert.ok(layout.unitWidths.every(value=>value>=256),'wide unit names have room');
     assert.ok(layout.gap>=16,'columns are separated');
     assert.ok(Math.abs(layout.right)<=1,'reset is at the far right');
   }
 }
 await page.getByRole('button',{name:'문항·학생 상세 3학년 1반',exact:true}).click();await page.getByRole('heading',{name:'3학년 1반 · 문항·학생 상세',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.at(-1).mode),'detail');assert.deepEqual(await page.evaluate(()=>window.quizClassQa.calls.at(-1).classIds),['class_1']);
 const detail=page.getByRole('dialog',{name:'3학년 1반 · 문항·학생 상세',exact:true});
 assert.equal(await page.evaluate(()=>document.querySelector('dialog[open]').contains(document.activeElement)),true,'modal takes focus');
 for(const width of [390,768,1280]){await page.setViewportSize({width,height:768});await page.screenshot({path:path.join(evidence,`detail-${width}.png`),fullPage:true});screenshots.push(`detail-${width}.png`);assert.equal(await detail.getByRole('columnheader',{name:'핵심 개념',exact:true}).isVisible(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`detail overflow ${width}`);}
 await detail.getByRole('button',{name:'학생',exact:true}).click();await detail.getByRole('button',{name:'3학년 1반 1번 가상학생',exact:true}).waitFor();
 await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
 const beforeSearch=await page.evaluate(()=>window.quizClassQa.calls.length);
 await page.getByRole('button',{name:'전체 단원 검색',exact:true}).click();
 await page.getByRole('searchbox',{name:'전체 단원 문항 검색',exact:true}).fill('  광해군  ');
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.length),beforeSearch,'typing never queries');
 await page.getByRole('button',{name:'전체 단원 검색 실행',exact:true}).click();
 await page.getByRole('heading',{name:/전체 단원.*광해군/}).waitFor();
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.at(-1).keyword),'광해군');
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.at(-1).unitId),'');
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.at(-1).category),'');
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.at(-1).comparisonGrade),'3');
 await page.getByRole('button',{name:'문항·학생 상세 3학년 1반',exact:true}).click();
 await detail.waitFor();assert.equal(await page.evaluate(()=>window.quizClassQa.calls.at(-1).keyword),'광해군');
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.at(-1).comparisonGrade),undefined,'grade detail must not be requested');
 await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
 assert.ok((await page.evaluate(()=>document.activeElement.getAttribute('aria-label'))).includes('문항·학생 상세'),'focus returns');
 await page.getByRole('button',{name:'검색 해제',exact:true}).click();
 await page.evaluate(()=>window.quizClassQa.fail=true);await page.getByRole('button',{name:'최신 결과 조회',exact:true}).click();await page.getByRole('alert').waitFor();
 await page.getByRole('button',{name:'다시 조회',exact:true}).click();await page.getByRole('heading',{name:'학급별 결과 비교',exact:true}).waitFor();
 await page.evaluate(()=>window.quizClassQa.hold=true);await page.getByRole('button',{name:'최신 결과 조회',exact:true}).click();await page.getByRole('combobox',{name:'분석할 학급',exact:true}).selectOption('class_3');await page.evaluate(()=>{window.quizClassQa.hold=false;window.quizClassQa.release();});
 await page.getByText('평가와 학급을 선택한 뒤 결과를 조회해 주세요.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'학급별 결과 비교',exact:true}).count(),0);
 await page.reload();await page.getByRole('combobox',{name:'분석할 학급',exact:true}).selectOption('class_1');
 await page.getByRole('button',{name:'전체 단원 검색',exact:true}).click();
 await page.getByRole('searchbox',{name:'전체 단원 문항 검색',exact:true}).fill('사화');
 await page.getByRole('searchbox',{name:'전체 단원 문항 검색',exact:true}).press('Enter');
 await page.getByRole('heading',{name:/전체 단원.*사화/}).waitFor();
 assert.equal(await page.getByRole('combobox',{name:'분석할 대단원',exact:true}).inputValue(),'','search needs no unit selection');
 for(const width of [390,768,1280]){
   await page.setViewportSize({width,height:768});
   const input=await page.getByRole('searchbox',{name:'전체 단원 문항 검색',exact:true}).boundingBox();
   const button=await page.getByRole('button',{name:'전체 단원 검색 실행',exact:true}).boundingBox();
   assert.ok(input.x<button.x,'search input expands before magnifier');
   if(width<=1023)assert.ok(button.x+button.width<=width,'search action stays visible on small screens');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`search overflow ${width}`);
   await page.screenshot({path:path.join(evidence,`search-${width}.png`),fullPage:true});screenshots.push(`search-${width}.png`);
 }
 await page.getByRole('searchbox',{name:'전체 단원 문항 검색',exact:true}).fill('없는검색');
 await page.getByRole('button',{name:'전체 단원 검색 실행',exact:true}).click();
 await page.getByText('검색어와 일치하는 문항이 없습니다.',{exact:true}).waitFor();
 await page.reload();await page.getByRole('combobox',{name:'분석할 대단원',exact:true}).selectOption('big');
 await page.evaluate(()=>window.quizClassQa.behavior=true);
 await page.getByRole('combobox',{name:'분석할 중단원',exact:true}).selectOption('unit-a');
 await page.getByRole('combobox',{name:'분석할 학급',exact:true}).selectOption('class_1');
 await page.getByRole('button',{name:'결과 조회',exact:true}).click();
 const behaviorTable=page.getByRole('region',{name:'학급별 풀이 분류 표',exact:true});
 await behaviorTable.waitFor();
 assert.deepEqual(await behaviorTable.getByRole('columnheader').allTextContents(),['학급','찍기 추정','반복 선택','미해당','기록 부족']);
 for(const width of [390,768,1280]){
   await page.setViewportSize({width,height:900});
   await behaviorTable.screenshot({path:path.join(evidence,`behavior-summary-${width}.png`)});screenshots.push(`behavior-summary-${width}.png`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`behavior summary overflow ${width}`);
 }
 assert.equal(await page.getByText('빠른학생',{exact:true}).count(),0,'summary has no personal data');
 const classifyButton=page.getByRole('button',{name:'3학년 1반 찍기 추정 1명 보기',exact:true});
 await classifyButton.click();await detail.waitFor();
 assert.equal(await detail.getByRole('button',{name:'학생',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await detail.getByRole('combobox',{name:'학생 풀이 분류',exact:true}).inputValue(),'suspected_guessing');
 const studentTable=detail.getByRole('region',{name:'학생 분석 목록',exact:true});
 await studentTable.getByRole('button',{name:'3학년 1반 1번 빠른학생',exact:true}).click();
 const evidencePanel=detail.getByRole('region',{name:'풀이 분류 근거',exact:true});
 await evidencePanel.waitFor();
 assert.ok((await evidencePanel.innerText()).includes('2초'));
 assert.ok((await evidencePanel.innerText()).includes('48% (12/25)'));
 for(const width of [390,768,1280]){
   await page.setViewportSize({width,height:900});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`behavior detail overflow ${width}`);
   await page.screenshot({path:path.join(evidence,`behavior-${width}.png`),fullPage:true});screenshots.push(`behavior-${width}.png`);
 }
 const beforeFilters=await page.evaluate(()=>window.quizClassQa.calls.length);
 for(const [category,name] of [['repeated_choice','3학년 1반 2번 반복학생'],['unflagged','3학년 1반 3번 확인학생'],['insufficient','3학년 1반 4번 부족학생'],['no_attempt','3학년 1반 5번 미응시학생']]){
   await detail.getByRole('combobox',{name:'학생 풀이 분류',exact:true}).selectOption(category);
   assert.equal(await studentTable.locator('tbody').getByRole('button').count(),1);
   await studentTable.getByRole('button',{name,exact:true}).click();
   if(category==='insufficient'){
     assert.equal(await evidencePanel.locator('dl > div').filter({has:page.getByText('문항 시간',{exact:true})}).locator('dd').innerText(),'—');
     assert.ok(!(await evidencePanel.innerText()).includes('0초'));
   }
   if(category==='repeated_choice')assert.ok((await evidencePanel.innerText()).includes('2번 보기 · 25/25문항 (100%)'));
 }
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.length),beforeFilters,'student filters stay local');
 await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
 assert.equal(await classifyButton.evaluate(button=>document.activeElement===button),true,'classification drilldown restores count trigger');
 await page.getByRole('button',{name:'학급 비교',exact:true}).click();await page.getByRole('checkbox',{name:'3학년 전체 평균',exact:true}).check();await page.getByRole('button',{name:'선택 완료',exact:true}).click();
 await page.getByRole('button',{name:'결과 조회',exact:true}).click();await behaviorTable.getByRole('rowheader',{name:'3학년 전체',exact:true}).waitFor();
 assert.equal(await behaviorTable.getByRole('row').filter({has:page.getByRole('rowheader',{name:'3학년 전체',exact:true})}).getByRole('button').count(),0,'grade aggregates have no personal drilldown');
 await page.evaluate(()=>window.quizClassQa.behaviorNoAttempt=true);await page.getByRole('button',{name:'최신 결과 조회',exact:true}).click();
 await behaviorTable.getByRole('rowheader',{name:'3학년 1반미응시',exact:true}).waitFor();
 assert.equal(await behaviorTable.getByRole('button').count(),0,'all no-attempt values are zero without personal links');
 // Reset is a local return to the pre-query waiting screen, never an all-class query.
 await page.getByRole('button',{name:'전체 단원 검색',exact:true}).click();
 await page.getByRole('searchbox',{name:'전체 단원 문항 검색',exact:true}).fill('광해군');
 await page.getByRole('button',{name:'전체 단원 검색 실행',exact:true}).click();
 await page.getByRole('heading',{name:/전체 단원.*광해군/}).waitFor();
 const resetButton=page.getByRole('button',{name:'조회 전체 초기화',exact:true});
 const beforeReset=await page.evaluate(()=>window.quizClassQa.calls.length);
 await resetButton.click();
 const waiting=page.getByText('평가와 학급을 선택한 뒤 결과를 조회해 주세요.',{exact:true});
 await waiting.waitFor();
 for(const name of ['분석할 대단원','분석할 중단원','분석할 평가','분석할 학급'])
   assert.equal(await page.getByRole('combobox',{name,exact:true}).inputValue(),'');
 assert.equal(await page.locator('.qca-filter-count').count(),0,'class and grade comparisons are cleared');
 assert.equal(await page.getByRole('searchbox').count(),0,'search closes and clears');
 assert.equal(await page.locator('.qca-table').count(),0,'all results are cleared');
 assert.equal(await page.getByRole('button',{name:'결과 조회',exact:true}).isDisabled(),true);
 assert.equal(await page.evaluate(()=>window.quizClassQa.calls.length),beforeReset,'reset sends no server requests');
 await page.getByRole('button',{name:'전체 단원 검색',exact:true}).click();
 assert.equal(await page.getByRole('searchbox').inputValue(),'');
 await page.getByRole('searchbox').press('Escape');await waiting.waitFor();
 assert.equal(await page.locator('.qca-table').count(),0,'closing search cannot restore pre-reset results');
 for(const mode of ['summary','detail']){
   await page.getByRole('combobox',{name:'분석할 대단원',exact:true}).selectOption('big');
   await page.getByRole('combobox',{name:'분석할 중단원',exact:true}).selectOption('unit-a');
   await page.getByRole('combobox',{name:'분석할 학급',exact:true}).selectOption('class_1');
   if(mode==='detail'){
     await page.getByRole('button',{name:'결과 조회',exact:true}).click();await behaviorTable.waitFor();
   }
   await page.evaluate(()=>window.quizClassQa.hold=true);
   await page.getByRole('button',{name:mode==='summary'?'결과 조회':'문항·학생 상세 3학년 1반',exact:true}).click();
   await page.waitForFunction(expected=>window.quizClassQa.calls.at(-1).mode===expected,mode);
   const pendingCalls=await page.evaluate(()=>window.quizClassQa.calls.length);
   await resetButton.click();await waiting.waitFor();
   await page.evaluate(()=>{window.quizClassQa.hold=false;window.quizClassQa.release();});
   await page.waitForTimeout(100);
   assert.equal(await page.locator('.qca-table').count(),0,`late ${mode} must not restore data`);
   assert.equal(await page.getByRole('dialog').count(),0,`late ${mode} must not reopen detail`);
   assert.equal(await page.evaluate(()=>window.quizClassQa.calls.length),pendingCalls,'no automatic reload after reset');
 }
 await page.screenshot({path:path.join(evidence,'reset-waiting-1280.png'),fullPage:true});screenshots.push('reset-waiting-1280.png');
 assert.deepEqual(errors,[]);
 console.log('PASS catalog-only entry, class/grade comparison, explicit search, modal/focus/Escape, errors/retry, stale response discard, 320–1440px layouts, behavior filters, all-query reset without reads, cleared units/search/comparison and late summary/detail discard');
}finally{await browser.close();server.close();await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({errors,screenshots},null,2));console.log(evidence);}
