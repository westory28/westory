import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const root = process.cwd();
const evidence = await fs.mkdtemp(path.join(os.tmpdir(), "westory-analysis-entry-"));
const imp = (file) => JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const service = `
import { useSyncExternalStore } from 'react';
const listeners = new Set();
export const qa = window.analysisEntryQa = {
  calls: [], directReads: [], writes: [], pending: [], hold: '', fail: '',
  readOnly:new URLSearchParams(new URLSearchParams(location.search).get('entry')?.split('?')[1]||location.search).has('readonly'),
  auth: { config: {year:'2026',semester:'2'}, currentUser:{uid:'teacher-fixture',email:'fixture@example.invalid'}, userData:{role:'teacher'},authGeneration:1 },
};
qa.changeIdentity = (uid, semester) => {
  qa.auth = {...qa.auth, currentUser:{uid,email:'fixture@example.invalid'},config:{year:'2026',semester},authGeneration:qa.auth.authGeneration+1};
  listeners.forEach(listener=>listener());
};
qa.release = () => { const pending=qa.pending.splice(0); pending.forEach(resolve=>resolve()); };
export const useAuth = () => useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener)},()=>qa.auth);
export const db = {};
const tree=[{id:'big',title:'조선의 성립과 발전',children:[{id:'unit-a',title:'조선의 통치 체제'},{id:'unit-b',title:'사림 세력의 성장'},{id:'unit-empty',title:'등록 전 단원'}]}];
export const doc=(_db,...parts)=>parts.join('/');
export const getDoc=async path=>{
  if(!path.endsWith('/curriculum/tree'))throw new Error('Unexpected direct read '+path);
  qa.directReads.push(path);return {exists:()=>true,data:()=>({tree})};
};
const forbidden=(...args)=>{qa.writes.push(args);throw new Error('Unexpected write or unscoped read');};
export const collection=forbidden,getDocs=forbidden,limit=forbidden,orderBy=forbidden,query=forbidden,where=forbidden;
const signals=new Map();
export const onSnapshot=(path,options,next,error)=>{if(!options.includeMetadataChanges)throw new Error('Missing metadata events');signals.set(path,{next,error});next({data:()=>({sequence:qa.sequence||0}),metadata:{fromCache:false}});return()=>signals.delete(path);};
qa.emit=()=>{qa.sequence=(qa.sequence||0)+1;for(const[path,callback]of signals)if(path.includes('/classes/'))callback.next({data:()=>({sequence:qa.sequence}),metadata:{fromCache:false}});};
qa.signalCount=()=>signals.size;
const liveFor=(data,selected)=>({contextVersion:'a'.repeat(64),statePath:'quiz_class_analysis_state/'+data.semesterId,contentCursor:0,classes:selected.map(c=>({classId:c.id,statePath:'quiz_class_analysis_state/'+data.semesterId+'/classes/'+String(classes.findIndex(item=>item.id===c.id)+1).repeat(64),cursor:qa.sequence||0}))});
export const getHttpsCallable=()=>forbidden;
export const executeLearningCommand=forbidden,executeAssessmentManagementCommand=forbidden,refreshPublishedQuizDefinitions=forbidden;
export const getAssessmentSemesterId=c=>c.year+'-'+c.semester;
export const useAppToast=()=>({showToast:()=>{}});
export const canReadQuizManagement=()=>true,canWriteQuizManagement=()=>!qa.readOnly;
const classes=[1,2,3,4,5,6].map(n=>({id:'class_'+n,label:'3학년 '+n+'반',grade:'3',classNumber:String(n)})).concat({id:'other_grade',label:'2학년 1반',grade:'2',classNumber:'1'});
const assessments=[...['unit-a','unit-b'].flatMap(unitId=>['diagnostic','formative'].map(category=>({id:unitId+'-'+category,unitId,unitTitle:unitId==='unit-a'?'조선의 통치 체제':'사림 세력의 성장',category,examRound:'',title:category==='diagnostic'?'진단평가':'형성평가',questionCount:1}))),...[1,2].map(n=>({id:'mock-'+n,unitId:'exam_prep',unitTitle:'모의고사',category:'exam_prep',examRound:'round_'+n,title:'모의고사 '+n,questionCount:2}))];
const questions=[1,2].map(n=>({id:n,docId:String(n),unitId:'exam_prep',category:'exam_prep',examRound:'round_1',type:'choice',question:n+'번 합성 문항',options:['정답','오답'],answer:'정답',paperOrder:n,points:50,sourceRevision:'1',contentRevision:1,curriculumVersion:'2018-162',achievementStandardCodes:['9역12-01'],targetAchievementLevel:'C',intendedDifficulty:'medium'}));
const attempts=(scope,paper,students)=>!qa.withAttempt?[]:students.filter((_,i)=>i%2===0).map((student,i)=>{
  const round=Number(scope.examRound.replace('round_',''))||1,percent=round===1?100:50;
  return {id:'fixture-result-'+round+'-'+i,source:'canonical',raw:{studentUid:student.uid,semesterId:scope.semesterId,sourceId:'exam_prep',category:'exam_prep',examRound:scope.examRound,attemptId:'fixture-attempt-'+round+'-'+i,submittedAtIso:'2026-11-0'+(round+5)+'T09:00:00Z',startedAtIso:'2026-11-0'+(round+5)+'T08:40:00Z',percent,total:2,earnedPoints:percent,maxPoints:100,answerChecks:paper.map((q,index)=>({id:q.id,correct:round===1||index===0})),answers:{1:'정답',2:round===1?'정답':'오답'},learningSnapshot:paper,questionSnapshots:paper}};
});
const scoreRows=(scope,paper,students)=>Array.from({length:Number(scope.examRound.replace('round_',''))||1},(_,i)=>'round_'+(i+1)).flatMap(examRound=>attempts({...scope,examRound},paper,students).map(({id,source,raw})=>({id,source,raw:{studentUid:raw.studentUid,semesterId:raw.semesterId,category:'exam_prep',examRound,attemptId:raw.attemptId,submittedAtIso:raw.submittedAtIso,percent:raw.percent,total:raw.total,maxPoints:raw.maxPoints,earnedPoints:raw.earnedPoints,cutScoreQuestions:paper.map(({id,points,targetAchievementLevel,intendedDifficulty})=>({id,points,targetAchievementLevel,intendedDifficulty}))}})));
export const callWithApplicationSession=async(name,input)=>{
  if(name!=='getQuizClassAnalysis')throw new Error('Unexpected callable '+name);
  const data=structuredClone(input);
  qa.calls.push({...data,identity:qa.auth.currentUser.uid});
  if(qa.hold===data.mode)await new Promise(resolve=>qa.pending.push(resolve));
  if(qa.fail===data.mode){qa.fail='';throw new Error('Synthetic outage');}
  if(data.mode==='catalog')return {data:{semesterId:data.semesterId,classes,assessments,treeData:tree,generatedAt:'2026-11-07T09:00:00Z'}};
  const selectedClasses=classes.filter(c=>data.grade?c.grade===data.grade:data.classIds.includes(c.id));
  const students=selectedClasses.flatMap(c=>[1,2].map(n=>({uid:'synthetic-'+c.id+'-'+n,name:'합성 미응시 '+n,number:String(n),classId:c.id})));
  if(data.mode==='changes'){
    let paper=questions.map(q=>({...q,examRound:data.examRound}));
    let rows=attempts(data,paper,students);
    if(qa.corrected){paper=paper.map(q=>({...q,sourceRevision:'2',contentRevision:2,targetAchievementLevel:'A',intendedDifficulty:'hard'}));rows=rows.map(row=>({...row,raw:{...row.raw,percent:100,earnedPoints:100,learningSnapshot:paper,answerChecks:paper.map(q=>({id:q.id,correct:true}))}}));}
    return {data:{semesterId:data.semesterId,rawRows:rows,records:[],removedKeys:rows.map(row=>row.source+':'+row.id),questionUpserts:qa.corrected?paper:[],questionRemovedIds:[],mockExamScoreRows:rows.map(row=>({...row,raw:{...row.raw,cutScoreQuestions:paper}})),live:liveFor(data,selectedClasses),hasMore:false}};
  }
  if(data.mode==='summary'){
    const rows=selectedClasses.map(c=>({classId:c.id,label:c.label,rosterCount:2,submittedCount:0,unsubmittedCount:2,scoredCount:0,averageScore:null,behaviorCounts:{suspected_guessing:0,repeated_choice:0,unflagged:0,insufficient:0,no_attempt:2},scoreHistogram:[0,20,40,60,80].map((lower,i)=>({label:'',lower,upper:i===4?101:lower+20,count:0})),questions:[],concepts:[],relearning:{repeatedStudentCount:0,wrongToCorrectCount:0,correctToWrongCount:0},generatedAt:'2026-11-07T09:00:00Z',version:'v1',complete:true,smallSample:true}));
    return {data:{...data,live:undefined,classes:rows,...(data.grade?{gradeComparison:{...rows[0],grade:data.grade,classId:'grade:'+data.grade,label:data.grade+'학년 전체',rosterCount:students.length,unsubmittedCount:students.length,classCount:rows.length,respondingClassCount:0,weighting:'scored_students'}}:{}),generatedAt:'2026-11-07T09:00:00Z'}};
  }
  if(data.mode==='achievement'||data.mode==='detail'){
    const paper=questions.map(q=>({...q,examRound:data.examRound,achievementStandardCodes:[data.examRound==='round_1'?'9역10-01':'9역10-02']}));
    return {data:{semesterId:data.semesterId,...(data.grade?{grade:qa.wrongGrade?'2':data.grade}:{}),complete:true,students,rawRows:attempts(data,paper,students),questions:paper,treeData:tree,configuredClasses:selectedClasses,generatedAt:'2026-11-07T09:00:00Z',version:'v1',...(qa.live?{live:liveFor(data,selectedClasses)}:{}),...(data.mode==='achievement'?{mockExamScoreRows:scoreRows(data,paper,students)}:{})}};
  }
  throw new Error('Unnecessary '+data.mode+' request on achievement entry');
};
`;
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import View from ${imp("src/pages/teacher/ManageQuiz.tsx")};import ${imp("src/assets/index.css")};import ${imp("src/components/common/portalPage.css")};
const initial=new URLSearchParams(location.search).get('entry');if(initial)history.replaceState(null,'',initial);else if(location.pathname==='/')history.replaceState(null,'','/teacher/quiz?tab=manage');createRoot(document.getElementById('root')).render(<BrowserRouter><View/></BrowserRouter>);`;
const bundle = await build({
  stdin: {contents:entry,resolveDir:root,loader:"tsx"}, bundle:true,write:false,format:"esm",platform:"browser",outfile:path.join(evidence,"fixture.js"),
  loader:{".svg":"dataurl",".webp":"dataurl",".woff":"dataurl",".woff2":"dataurl"},define:{"process.env.NODE_ENV":'"production"'},
  plugins:[{name:"isolated-boundaries",setup(p){
    p.onResolve({filter:/^firebase\/firestore$|(?:^|\/)contexts\/AuthContext$|(?:^|\/)(firebase|assessmentRelease|applicationSession|assessmentLifecycle|learningCommands|AppToastProvider|permissions)$/},()=>({path:"service",namespace:"fixture"}));
    p.onResolve({filter:/(?:^|\/)(QuizEditor|QuizSettingsModal|QuizVisualPassageEditor)$/},()=>({path:"unused-editor",namespace:"fixture"}));
    p.onLoad({filter:/.*/,namespace:"fixture"},({path:module})=>({contents:module==="service"?service:"export default function Editor(){return null}",loader:"tsx",resolveDir:root}));
  }}],
});
const js = bundle.outputFiles.find(f=>f.path.endsWith(".js")).text;
const css = bundle.outputFiles.find(f=>f.path.endsWith(".css")).text.replace(/@import\s+(?:url\()?['"]https?:[^;]+;/g,"");
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><div id="root" class="teacher-layout"></div><script type="module" src="/fixture.js"></script></body></html>';
const server=http.createServer((req,res)=>{const route=new URL(req.url,"http://localhost").pathname;res.setHeader("Content-Type",route.endsWith(".js")?"text/javascript":route.endsWith(".css")?"text/css":"text/html");res.end(route.endsWith(".js")?js:route.endsWith(".css")?css:html);});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||"msedge",headless:true});
const errors=[],screenshots=[],checks=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  const modes=()=>page.evaluate(()=>window.analysisEntryQa.calls.map(call=>call.mode));
  const assessment=()=>page.getByRole("combobox",{name:"분석할 평가",exact:true});
  const classSelect=()=>page.getByRole("combobox",{name:"분석할 학급",exact:true});
  const query=()=>page.getByRole("button",{name:"결과 조회",exact:true});
  const report=()=>page.getByRole("combobox",{name:"분석 항목",exact:true});
  const pending=()=>page.getByText("학년 또는 학급을 선택하고 결과를 조회해 주세요.",{exact:true});
  const analysis=()=>page.getByRole("region",{name:"성취기준 분석",exact:true});
  const assertNoOverflow=async(width)=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`no page overflow at ${width}`);
  const screenshot=async(name)=>{await page.screenshot({path:path.join(evidence,name),fullPage:true});screenshots.push(name);};
  const selectNode=async(name)=>{const button=page.locator('.quiz-navigation').getByRole('button',{name,exact:true});if(!await button.isVisible())await page.locator('.quiz-navigation .teacher-settings-menu-toggle').click();await button.click();};
  const optionLabels=()=>assessment().locator('option').evaluateAll(options=>options.filter(option=>option.value).map(option=>option.textContent.trim()));

  // Exercise the real ManageQuiz -> QuizBankTab -> QuizClassAnalysis route.
  await page.goto(origin);
  await selectNode("모의고사");
  for (const width of [768,1280,1440]) {
    await page.setViewportSize({width,height:900});
    const before = await page.locator('main.teacher-sub-content').boundingBox();
    const toggle = page.getByRole('button',{name:'평가 목차 접기',exact:true});
    await toggle.focus();await page.keyboard.press('Enter');
    const expand = page.getByRole('button',{name:'평가 목차 펼치기',exact:true});
    assert.equal(await expand.getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('.quiz-navigation-tree').isVisible(),false);
    assert.equal(await expand.evaluate(node=>document.activeElement===node),true);
    const after = await page.locator('main.teacher-sub-content').boundingBox();
    assert.ok(after.width>before.width+100,'collapsing gives the width back to the assessment');
    const buttonBox=await expand.boundingBox();
    assert.ok(buttonBox.width>=44&&buttonBox.height>=44);
    const navBox=await page.locator('.quiz-navigation').boundingBox();
    assert.ok(navBox.width<=45,'collapsed navigation reserves only its label width');
    assert.ok(buttonBox.x>=navBox.x-1&&buttonBox.x+buttonBox.width<=navBox.x+navBox.width+1,'expand label stays within the collapsed navigation');
    assert.ok(buttonBox.y+buttonBox.height<=900,'toggle remains within the viewport');
    await screenshot(`navigation-collapsed-${width}.png`);
    await page.keyboard.press('Space');
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('.quiz-navigation-tree').isVisible(),true);
    await assertNoOverflow(width);
  }
  await page.getByRole('button',{name:'평가 목차 접기',exact:true}).click();
  await page.setViewportSize({width:390,height:900});
  assert.equal(await page.locator('.quiz-navigation-collapse').isVisible(),false);
  await page.locator('.quiz-navigation .teacher-settings-menu-toggle').click();
  assert.equal(await page.locator('.quiz-navigation-tree').isVisible(),true,'mobile keeps its own disclosure after desktop collapse');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.quiz-navigation .teacher-settings-menu-toggle').evaluate(node=>document.activeElement===node),true);
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'평가 목차 펼치기',exact:true}).click();
  checks.push('assessment tree collapse/expand with a single chevron, reclaimed content width, 44px keyboard target, focus retention and independent mobile disclosure');
  const manageLayout=await page.locator("main.teacher-sub-content").boundingBox();
  await page.evaluate(()=>window.analysisEntryQa.navigation=document.querySelector(".quiz-navigation"));
  const readsBefore=await page.evaluate(()=>window.analysisEntryQa.directReads.length);
  await page.getByRole("button",{name:"평가 분석",exact:true}).click();
  await pending().waitFor();
  assert.equal(await assessment().inputValue(),"mock-1");
  assert.equal(await page.getByRole("combobox",{name:/분석할 (대단원|중단원)/}).count(),0);
  assert.deepEqual(await optionLabels(),["초시 (1회)","복시 (2회)"]);
  assert.equal(await page.locator(".quiz-navigation").count(),1);
  assert.equal(await page.evaluate(()=>window.analysisEntryQa.navigation===document.querySelector(".quiz-navigation")),true,"tab switches preserve the same table of contents");
  const analysisLayout=await page.locator("main.teacher-sub-content").boundingBox();
  assert.ok(Math.abs(manageLayout.x-analysisLayout.x)<=1&&Math.abs(manageLayout.y-analysisLayout.y)<=1,"only the right body switches position");
  assert.deepEqual(await modes(),["catalog"]);
  assert.equal(await page.evaluate(()=>window.analysisEntryQa.directReads.length),readsBefore,"analysis reuses server catalog tree without direct Firestore tree reads");
  assert.equal(await report().inputValue(),"0");
  assert.equal(await report().getByRole("option",{name:"회차별 점수·수준",exact:true}).count(),1);
  assert.equal(await page.locator(".quiz-class-analysis nav").count(),0,"the analysis body has no nested tabs");
  assert.equal(await page.getByRole("combobox",{name:"분석 보기",exact:true}).count(),0);
  assert.equal(await page.getByRole("button",{name:"최신 결과 조회",exact:true}).count(),0);
  assert.equal(await query().count(),1,"one result query action");
  assert.equal(await page.getByRole("button",{name:"학급 비교",exact:true}).count(),0,"comparison is absent from achievement reports");
  checks.push("real management navigation preserves mock exam context");

  for(const width of [320,390,768,1280,1440]){
    await page.setViewportSize({width,height:900});
    await assertNoOverflow(width);
    const actions=await page.locator(".qca-filter-actions").evaluate(element=>{
      const buttons=[...element.querySelectorAll("button")];
      return buttons.map(button=>({label:button.getAttribute("aria-label")||button.textContent.trim(),left:button.getBoundingClientRect().left,right:button.getBoundingClientRect().right,height:button.getBoundingClientRect().height}));
    });
    assert.deepEqual(actions.map(a=>a.label),["전체 단원 검색","조회 전체 초기화","결과 조회"]);
    assert.ok(Math.abs(actions[1].left-actions[0].right-8)<=1,"reset stays beside search");
    assert.ok(Math.abs(actions[2].left-actions[1].right-8)<=1,"query stays beside reset");
    assert.ok(actions.every(action=>action.height>=44));
    await screenshot(`mock-pending-${width}.png`);
  }
  for(const value of ["0","1","2","3","4","5"]){
    await report().selectOption(value);
    assert.ok(await analysis().getByRole("table").count()>0,"each pending view shows a table shell");
  }
  assert.deepEqual(await modes(),["catalog"],"changing pending analysis view never reads student records");
  await classSelect().selectOption("class_1");
  assert.deepEqual(await modes(),["catalog"],"class selection does not query automatically");
  await report().selectOption("0");
  await query().focus();await page.keyboard.press("Enter");
  await analysis().getByText("첫 제출 0명",{exact:true}).waitFor();
  assert.deepEqual(await modes(),["catalog","achievement"],"achievement skips summary and detail reads");
  const last=await page.evaluate(()=>window.analysisEntryQa.calls.at(-1));
  assert.deepEqual(last.classIds,["class_1"]);assert.equal(last.category,"exam_prep");assert.equal(last.examRound,"round_1");
  assert.ok(!Object.hasOwn(last,"comparisonGrade"));
  assert.equal(await analysis().getByRole("region",{name:"학생 성취수준별 분포",exact:true}).getByRole("row").count(),7);
  assert.equal(await analysis().getByText("평균 —",{exact:true}).isVisible(),true);
  checks.push("one scoped achievement request; zero attempts remain visible without fabricated average");
  for(const width of [320,390,768,1280,1440]){
    await page.setViewportSize({width,height:900});await assertNoOverflow(width);
    await screenshot(`mock-empty-${width}.png`);
  }
  for(const value of ["0","1","2","3","4","5"]){
    await report().selectOption(value);
    assert.equal(await analysis().isVisible(),true);
  }
  assert.deepEqual(await modes(),["catalog","achievement"]);

  // Assessment-specific criterion filters must never carry into another round.
  await report().selectOption("0");
  await page.evaluate(()=>window.analysisEntryQa.withAttempt=true);
  await query().click();await analysis().getByText("첫 제출 1명",{exact:true}).waitFor();
  const beforeScoreView=await modes();
  await report().selectOption("3");
  const cumulativeTable=()=>analysis().getByRole("table",{name:"학생별 모의고사 누적 성취수준",exact:true});
  assert.deepEqual(await cumulativeTable().getByRole("row").filter({hasText:"합성 미응시 1"}).getByRole("cell").allTextContents(),["100.00","100.00","A","1/1회"]);
  assert.deepEqual(await modes(),beforeScoreView,"viewing cumulative scores reuses the same scoped response");
  await report().selectOption("0");
  await analysis().getByRole("combobox",{name:"성취기준",exact:true}).selectOption("9역10-01");
  await assessment().selectOption("mock-2");await pending().waitFor();
  assert.equal(await analysis().getByRole("combobox",{name:"성취기준",exact:true}).inputValue(),"");
  await query().click();await analysis().getByText("첫 제출 1명",{exact:true}).waitFor();
  assert.equal(await analysis().getByRole("combobox",{name:"성취기준",exact:true}).inputValue(),"");
  assert.equal(await analysis().getByRole("option",{name:/9역10-02/}).count(),1);
  assert.equal(await analysis().getByRole("option",{name:/9역10-01/}).count(),0);
  const beforeRoundTwoScores=await modes();
  await report().selectOption("3");
  assert.deepEqual(await cumulativeTable().getByRole("row").filter({hasText:"합성 미응시 1"}).getByRole("cell").allTextContents(),["100.00","50.00","75.00","C","2/2회"]);
  assert.deepEqual(await modes(),beforeRoundTwoScores,"second-round cumulative scores require no prior-round client queries");
  await report().selectOption("0");
  await page.evaluate(()=>window.analysisEntryQa.withAttempt=false);
  await assessment().selectOption("mock-1");await query().click();
  await analysis().getByText("첫 제출 0명",{exact:true}).waitFor();
  checks.push("round change resets criterion filters and uses frozen cumulative scores: round 1 = 100/A, rounds 1–2 = 75/C, without extra queries");

  await page.evaluate(()=>window.analysisEntryQa.hold="achievement");
  await query().click();await page.waitForFunction(()=>window.analysisEntryQa.pending.length===1);
  await report().selectOption("summary");
  assert.equal(await page.getByRole("button",{name:"학급 비교",exact:true}).count(),1);
  assert.equal(await query().isEnabled(),true,"leaving pending achievement mode releases query loading state");
  await page.evaluate(()=>{window.analysisEntryQa.hold="";window.analysisEntryQa.release();});
  await report().selectOption("0");
  await pending().waitFor();
  await query().click();
  await analysis().getByText("첫 제출 0명",{exact:true}).waitFor();
  checks.push("leaving a pending analysis does not lock the result query action");

  // Failed requests preserve the controls and recover only when requested.
  await page.evaluate(()=>window.analysisEntryQa.fail="achievement");
  await query().click();await analysis().getByRole("alert").waitFor();
  assert.equal(await page.evaluate(()=>window.analysisEntryQa.calls.at(-1).forceRefresh),true,"repeat query refreshes the current result");
  assert.equal(await assessment().inputValue(),"mock-1");assert.equal(await classSelect().inputValue(),"class_1");
  await analysis().getByRole("button",{name:"다시 조회",exact:true}).click();
  await analysis().getByText("첫 제출 0명",{exact:true}).waitFor();
  checks.push("failure and explicit retry preserve selected assessment and class");

  // Slow requests cannot restore a previous class, identity, or semester.
  for(const change of ["round","class","identity","semester"]){
    await report().selectOption("0");
    await page.evaluate(()=>window.analysisEntryQa.hold="achievement");
    await query().click();await page.getByRole("button",{name:"조회 중…",exact:true}).waitFor();
    await page.waitForFunction(()=>window.analysisEntryQa.pending.length===1);
    if(change==="round")await assessment().selectOption("mock-2");
    if(change==="class")await classSelect().selectOption("class_2");
    if(change==="identity")await page.evaluate(()=>window.analysisEntryQa.changeIdentity("teacher-next","2"));
    if(change==="semester")await page.evaluate(()=>window.analysisEntryQa.changeIdentity("teacher-next","1"));
    await pending().waitFor();
    await page.evaluate(()=>{window.analysisEntryQa.hold="";window.analysisEntryQa.release();});
    await page.waitForTimeout(100);
    assert.equal(await analysis().getByText("첫 제출 0명",{exact:true}).count(),0,`late ${change} response discarded`);
    assert.equal(await pending().isVisible(),true);
    if(change!=="class")await classSelect().selectOption("class_1");
    await query().click();await analysis().getByText("첫 제출 0명",{exact:true}).waitFor();
    const latest=await page.evaluate(()=>window.analysisEntryQa.calls.at(-1));
    assert.equal(latest.semesterId,change==="semester"?"2026-1":"2026-2");
    if(change==="identity"||change==="semester")assert.equal(latest.identity,"teacher-next");
    if(change==="round"){assert.equal(latest.examRound,"round_2");await assessment().selectOption("mock-1");await query().click();await analysis().getByText("첫 제출 0명",{exact:true}).waitFor();}
  }
  checks.push("pending responses discarded on round, class, identity and semester changes");

  // Navigation remains available inside analysis and scopes the two normal assessments.
  await page.setViewportSize({width:1440,height:900});
  const catalogsBeforeNavigation=await page.evaluate(()=>window.analysisEntryQa.calls.filter(call=>call.mode==='catalog').length);
  await selectNode("조선의 통치 체제");
  await page.waitForURL(/unitId=unit-a/);
  await page.waitForFunction(()=>[...document.querySelector('[aria-label="분석할 평가"]').options].some(option=>option.value==='unit-a-diagnostic'));
  assert.deepEqual(await optionLabels(),["진단평가","형성평가"]);
  assert.equal(await report().count(),0,"normal units expose no mock report selector");
  await assessment().selectOption("unit-a-formative");await classSelect().selectOption("class_1");
  await query().click();await page.getByRole("heading",{name:"학급 결과",exact:true}).waitFor();
  const normalScope=await page.evaluate(()=>window.analysisEntryQa.calls.at(-1));
  assert.equal(normalScope.unitId,"unit-a");assert.equal(normalScope.category,"formative");
  await page.evaluate(()=>window.analysisEntryQa.hold="summary");
  await query().click();await page.waitForFunction(()=>window.analysisEntryQa.pending.length===1);
  await selectNode("사림 세력의 성장");await page.waitForURL(/unitId=unit-b/);
  await page.waitForFunction(()=>[...document.querySelector('[aria-label="분석할 평가"]').options].some(option=>option.value==='unit-b-diagnostic'));
  await page.evaluate(()=>{window.analysisEntryQa.hold="";window.analysisEntryQa.release();});
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("heading",{name:"학급 결과",exact:true}).count(),0,"a prior unit's delayed result cannot return");
  assert.deepEqual(await optionLabels(),["진단평가","형성평가"]);
  assert.equal(await page.evaluate(()=>window.analysisEntryQa.calls.filter(call=>call.mode==='catalog').length),catalogsBeforeNavigation,"unit navigation reuses the catalog");
  await page.goBack();await page.waitForURL(/unitId=unit-a/);
  await page.waitForFunction(()=>[...document.querySelector('[aria-label="분석할 평가"]').options].some(option=>option.value==='unit-a-diagnostic'));
  assert.equal(await page.locator('.quiz-navigation').getByRole("button",{name:"조선의 통치 체제",exact:true}).getAttribute("aria-current"),"page");
  await page.goForward();await page.waitForURL(/unitId=unit-b/);
  await page.reload();await page.waitForFunction(()=>document.querySelector('[aria-label="분석할 평가"] option[value="unit-b-diagnostic"]'));
  assert.equal(await page.locator('.quiz-navigation').getByRole("button",{name:"사림 세력의 성장",exact:true}).getAttribute("aria-current"),"page");
  assert.deepEqual(await optionLabels(),["진단평가","형성평가"]);
  assert.deepEqual(await modes(),["catalog"]);
  assert.equal(await page.evaluate(()=>window.analysisEntryQa.directReads.length),1);
  for(const width of [320,390,768,1280,1440]){
    await page.setViewportSize({width,height:900});await assertNoOverflow(width);
    await screenshot(`normal-analysis-${width}.png`);
    if(width<=768){
      const menuToggle=page.locator('.quiz-navigation .teacher-settings-menu-toggle');
      if(await menuToggle.isVisible()){
        await menuToggle.click();
        assert.equal(await page.locator('.quiz-navigation').getByRole("button",{name:"모의고사",exact:true}).isVisible(),true);
        await assertNoOverflow(width);await screenshot(`navigation-expanded-${width}.png`);
        await page.keyboard.press("Escape");
        assert.equal(await menuToggle.getAttribute("aria-expanded"),"false");
      }
      await selectNode("모의고사");await pending().waitFor();
      await selectNode("사림 세력의 성장");
      await page.waitForFunction(()=>document.querySelector('[aria-label="분석할 평가"] option[value="unit-b-diagnostic"]'));
      assert.deepEqual(await optionLabels(),["진단평가","형성평가"]);
    }
  }
  assert.deepEqual(await modes(),["catalog"],"mobile navigation also reuses the catalog");
  await selectNode("등록 전 단원");
  await page.getByRole("heading",{name:"등록 전 단원",exact:true}).waitFor();
  await page.getByText("등록된 평가가 없습니다.",{exact:true}).waitFor();
  assert.equal(await assessment().isDisabled(),true);
  assert.deepEqual(await optionLabels(),[]);
  assert.equal(await query().isDisabled(),true);
  assert.deepEqual(await modes(),["catalog"],"empty units never query results");
  checks.push("persistent navigation scopes normal assessments; URL back, forward and reload restore the unit without repeated catalogs");

  // Direct analysis entry must not load the editor's curriculum or submissions.
  await page.goto(`${origin}/?entry=${encodeURIComponent("/teacher/quiz?tab=analysis&unitId=exam_prep&category=exam_prep")}`);
  await pending().waitFor();
  assert.deepEqual(await modes(),["catalog"]);
  assert.equal(await page.evaluate(()=>window.analysisEntryQa.directReads.length),1,"one shared curriculum read supplies the persistent navigation");
  assert.equal(await assessment().inputValue(),"mock-1");
  await assessment().selectOption("mock-2");
  await page.getByRole("button",{name:"조회 전체 초기화",exact:true}).click();
  assert.equal(await assessment().inputValue(),"mock-2","reset preserves the selected round");
  assert.deepEqual(await optionLabels(),["초시 (1회)","복시 (2회)"]);
  assert.equal(await page.locator(".quiz-mock-exam-entry").getAttribute("aria-current"),"page","reset preserves the current unit");
  assert.deepEqual(await modes(),["catalog"],"reset is local");
  await assessment().selectOption("mock-1");await classSelect().selectOption("class_1");
  await report().selectOption("summary");
  assert.equal(await page.getByRole("button",{name:"학급 비교",exact:true}).isVisible(),true);
  await query().click();await page.getByRole("heading",{name:"학급 결과",exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"최신 결과 조회",exact:true}).count(),0,"summary also has only the top query action");
  assert.equal(await query().count(),1);
  await query().click();await page.getByRole("heading",{name:"학급 결과",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.analysisEntryQa.calls.at(-1).forceRefresh),true,"repeat summary query refreshes the current result");
  await page.getByRole("button",{name:"문항·학생 상세 3학년 1반",exact:true}).click();
  const detail=page.getByRole("dialog",{name:"3학년 1반 · 문항·학생 상세",exact:true});
  await detail.waitFor();
  assert.equal(await detail.getByRole("navigation",{name:"평가 분석 보기",exact:true}).isVisible(),true);
  await detail.getByRole("button",{name:"성취기준 분석",exact:true}).click();
  await detail.getByText("첫 제출 0명",{exact:true}).waitFor();
  assert.equal(await detail.getByRole("combobox",{name:"분석 보기",exact:true}).isVisible(),true);
  assert.equal(await detail.getByRole("button",{name:"최신 결과 조회",exact:true}).isVisible(),true);
  await detail.getByRole("button",{name:"상세 닫기",exact:true}).click();
  await detail.waitFor({state:"hidden"});
  checks.push("unit-scoped assessment and report selectors; no nested main tabs or duplicate query; detail dialog controls preserved");
  assert.deepEqual(await page.evaluate(()=>window.analysisEntryQa.writes),[]);
  checks.push("direct analysis entry shares one tree read and reset preserves its unit without writes");
  // A whole grade is one explicit server scope, not a series of class requests.
  await page.goto(`${origin}/?entry=${encodeURIComponent("/teacher/quiz?tab=analysis&unitId=exam_prep&category=exam_prep")}`);
  await pending().waitFor();
  await classSelect().selectOption({label:'3학년 전체'});
  assert.deepEqual(await modes(),['catalog']);
  await query().click();await analysis().getByText('첫 제출 0명',{exact:true}).waitFor();
  assert.deepEqual(await modes(),['catalog','achievement']);
  const gradeRequest=await page.evaluate(()=>window.analysisEntryQa.calls.at(-1));
  assert.equal(gradeRequest.grade,'3');assert.deepEqual(gradeRequest.classIds,[]);
  assert.equal(Object.hasOwn(gradeRequest,'comparisonGrade'),false);
  await page.evaluate(()=>window.analysisEntryQa.withAttempt=true);
  await query().click();await analysis().getByText('첫 제출 6명',{exact:true}).waitFor();
  await report().selectOption('4');
  await analysis().getByText('3학년 1반 1번 합성 미응시 1',{exact:true}).waitFor();
  assert.equal(await analysis().getByText('3학년 6반 1번 합성 미응시 1',{exact:true}).count(),1);
  assert.equal(await analysis().getByText(/2학년 1반/).count(),0);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});await assertNoOverflow(width);
    await screenshot(`grade-analysis-${width}.png`);
  }
  await report().selectOption('summary');await query().click();
  await page.getByRole('button',{name:'문항·학생 상세 3학년 전체',exact:true}).click();
  const gradeDetail=page.getByRole('dialog',{name:'3학년 전체 · 문항·학생 상세',exact:true});
  await gradeDetail.waitFor();
  assert.equal(await page.evaluate(()=>window.analysisEntryQa.calls.at(-1).grade),'3');
  await gradeDetail.getByRole('button',{name:'학생',exact:true}).click();
  await gradeDetail.getByText('학생 12명',{exact:true}).waitFor();
  await gradeDetail.getByRole('button',{name:'상세 닫기',exact:true}).click();
  await page.getByRole('button',{name:'문항·학생 상세 3학년 2반',exact:true}).click();
  await page.getByRole('dialog',{name:'3학년 2반 · 문항·학생 상세',exact:true}).waitFor();
  const classRequest=await page.evaluate(()=>window.analysisEntryQa.calls.at(-1));
  assert.deepEqual(classRequest.classIds,['class_2']);assert.equal(Object.hasOwn(classRequest,'grade'),false);
  await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
  await report().selectOption('0');
  await page.evaluate(()=>window.analysisEntryQa.wrongGrade=true);
  await query().click();await analysis().getByRole('alert').waitFor();
  assert.equal(await analysis().getByText('첫 제출 6명',{exact:true}).count(),0,'wrong grade responses never render');
  await page.evaluate(()=>{window.analysisEntryQa.wrongGrade=false;window.analysisEntryQa.hold='achievement';});
  await query().click();await page.waitForFunction(()=>window.analysisEntryQa.pending.length===1);
  await classSelect().selectOption('class_1');
  await page.evaluate(()=>{window.analysisEntryQa.hold='';window.analysisEntryQa.release();});
  await pending().waitFor();
  assert.equal(await analysis().getByText('첫 제출 6명',{exact:true}).count(),0,'stale grade response never repopulates a class selection');
  assert.deepEqual(await page.evaluate(()=>window.analysisEntryQa.writes),[]);
  checks.push('whole-grade achievement and student detail, six classes, class labels, explicit single request, scope rejection and delayed response isolation');
  await page.goto(`${origin}/?entry=${encodeURIComponent("/teacher/quiz?tab=analysis&unitId=exam_prep")}`);
  await pending().waitFor();await assessment().selectOption('mock-2');await classSelect().selectOption('class_1');
  await page.evaluate(()=>{window.analysisEntryQa.live=true;window.analysisEntryQa.withAttempt=false;});
  await query().click();await analysis().getByText('첫 제출 0명',{exact:true}).waitFor();
  await page.waitForFunction(()=>window.analysisEntryQa.signalCount()===2);
  await page.evaluate(()=>{window.analysisEntryQa.withAttempt=true;window.analysisEntryQa.emit();});
  await analysis().getByText('첫 제출 1명',{exact:true}).waitFor();
  await analysis().getByText('평균 50.0',{exact:true}).waitFor();
  await page.evaluate(()=>{window.analysisEntryQa.corrected=true;window.analysisEntryQa.emit();});
  await analysis().getByText('평균 100.0',{exact:true}).waitFor();
  assert.deepEqual(await modes(),['catalog','achievement','changes','changes'],'submission and correction request only deltas');
  await classSelect().selectOption('class_2');await pending().waitFor();
  assert.equal(await page.evaluate(()=>window.analysisEntryQa.signalCount()),0,'changing class releases the old listeners');
  checks.push('live submitted answer and correction update rendered mean 50→100 without another full query; changing class releases listeners');
  await page.goto(`${origin}/?entry=${encodeURIComponent("/teacher/quiz?tab=analysis&unitId=unit-a&readonly=1")}`);
  await page.waitForFunction(()=>document.querySelector('[aria-label="분석할 평가"] option[value="unit-a-diagnostic"]'));
  assert.equal(await page.getByRole("button",{name:"문제 등록",exact:true}).count(),0,"read-only teachers cannot open authoring");
  assert.equal(await page.locator('.quiz-navigation').count(),1,"read-only teachers retain the navigation");
  await selectNode("모의고사");await pending().waitFor();
  assert.deepEqual(await optionLabels(),["초시 (1회)","복시 (2회)"]);
  assert.deepEqual(await modes(),["catalog"],"read-only unit navigation does not reread the catalog");
  assert.deepEqual(await page.evaluate(()=>window.analysisEntryQa.writes),[]);
  checks.push("read-only teachers retain navigation and analysis without authoring controls");
  assert.deepEqual(errors,[]);
  console.log(`PASS ${checks.join("; ")}; 320/390/768/1280/1440px layouts`);
} finally {
  await browser.close();server.close();
  await fs.writeFile(path.join(evidence,"result.json"),JSON.stringify({checks,errors,screenshots},null,2));
  console.log(evidence);
}
