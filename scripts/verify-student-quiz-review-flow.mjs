import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

// Real runner, history, review UI and client wrappers; only authenticated server
// boundaries are synthetic. No Firebase runtime or production data is loaded.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const learning = require("../functions/productionGateway/assessmentLearning.js");
let playwright;
try { playwright = require("playwright"); } catch {
  playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
}
const evidence = process.env.QUIZ_REVIEW_FLOW_EVIDENCE_DIR || await fs.mkdtemp(path.join(os.tmpdir(), "westory-review-flow-"));
await fs.mkdir(evidence, { recursive: true });
const questions = [
  { id: 1, type: "choice", question: "보관된 발문: 조선의 수도는?", passage: "보관된 자료: 조선은 한양을 도읍으로 삼았다.", options: ["경주", "개경", "한양", "평양", "부여"], answer: "한양", explanation: "보관된 해설: 조선의 수도는 한양이었다.", points: 30, paperOrder: 1, image: "/material.svg" },
  { id: 2, type: "short", question: "보관된 발문: 조선을 건국한 인물을 쓰시오.", answer: "이성계", explanation: "보관된 해설: 이성계는 조선을 건국하였다.", points: 40, paperOrder: 2, passageSet: { id: "s1", instruction: "다음 자료를 읽고 물음에 답하시오.", passage: "보관된 공통 지문: 1392년 새로운 왕조가 세워졌다.", image: "/set.svg" } },
  { id: 3, type: "choice", question: "보관된 발문: 조선에서 실시한 관리 선발 제도는?", options: ["과거", "골품", "화랑", "정동행성", "9서당"], answer: "과거", explanation: "보관된 해설: 조선은 과거를 실시하였다.", points: 30, paperOrder: 3, examplePassage: "ㄱ. 관리 선발\nㄴ. 유교 경전", passageSet: { id: "s1", instruction: "다음 자료를 읽고 물음에 답하시오.", passage: "보관된 공통 지문: 1392년 새로운 왕조가 세워졌다.", image: "/set.svg" } },
].map(q => ({ ...q, unitId: "exam_prep", category: "exam_prep", examRound: "round_2", concepts: ["조선의 통치 체제"], reviewLessonId: 'fixture-lesson', hintEnabled: false, hint: "" }));
const snapshots = learning.captureQuestionSnapshots(questions.map(data => ({ path: `questions/${data.id}`, data })), ["1", "2", "3"]).questionSnapshots;
const presentation = learning.questionPresentation(snapshots);
assert(presentation.every(q => !q.answer && !q.explanation));
const stubs = `
export const watchQuizResultCorrections=()=>()=>{};
const params=new URLSearchParams(location.search);const category=params.get('category')||sessionStorage.getItem('qa-category')||'exam_prep';sessionStorage.setItem('qa-category',category);
const snapshots=${JSON.stringify(snapshots)};const presentation=${JSON.stringify(presentation)};
const config={year:'2026',semester:'2'};const currentUser={uid:'synthetic-pupil',email:'fixture@example.invalid',getIdTokenResult:async()=>({claims:{}})};const userData={...currentUser,name:'가상 학생',grade:3,class:1,number:1};
const definitionId='quiz:2026-2:fixture:'+category;const key='canonical:fixture-result';
const paperHeader={paperTitle:'보관된 역사과 시험 제목',paperHeading:'보관된 시험 머리말'};
let state=JSON.parse(sessionStorage.getItem('qa-state')||'null')||{attempt:null,result:null,notes:{revision:0,items:[],updatedAt:''},receipts:{}};
const persist=()=>sessionStorage.setItem('qa-state',JSON.stringify(state));
export const qa=window.reviewQa={starts:[],submits:[],calls:[],saveCalls:[],nextFailure:'',get state(){return structuredClone(state)}};
export const auth={currentUser};export const useAuth=()=>({config,currentUser,userData});export const getYearSemester=()=>config;
export const getSemesterDocPath=(scope,...parts)=>['years',scope.year,'semesters',scope.semester,...parts].join('/');
export const readStudentCurriculumTree=async()=>[];export const buildAssessmentDefinitionId=()=>definitionId;export const loadQuizScoreComparison=async()=>null;export const isAssessmentRevisionConflict=e=>e?.code==='aborted';
export const getAssessmentState=async(input={})=>({status:state.attempt?.status==='SUBMITTED'?'SUBMITTED':'READY',definition:{title:category==='exam_prep'?'모의고사':category==='diagnostic'?'진단평가':'형성평가',questionCount:3,itemCount:3,status:'PUBLISHED',durationSeconds:600,presentationSettings:{...paperHeader,active:true,timeLimit:600,questionCount:3,hintLimit:0},maxAttempts:3,cooldownMinutes:0},attempt:state.attempt?structuredClone(state.attempt):null,serverNowIso:new Date().toISOString(),...(input.prepareAssets?{preparedAssets:{sourceHash:'fixture-v1',imageUrls:['/material.svg','/set.svg'],fontCharacters:'한양조선역사'}}:{})});
export const startAssessmentAttempt=async input=>{qa.starts.push(input);state.attempt={attemptId:'fixture-result',definitionId,semesterId:'2026-2',assessmentKind:'QUIZ',attemptNumber:1,status:'STARTED',revision:1,answers:{},currentItemId:'1',questionIds:['1','2','3'],startedAtIso:new Date().toISOString(),serverNowIso:new Date().toISOString(),deadlineAtIso:new Date(Date.now()+600000).toISOString(),lastSavedAtIso:new Date().toISOString(),submittedAtIso:'',resultRef:'',resumed:false,learningSnapshot:[],paperHeader,questionPresentation:presentation,questionSnapshotOmittedIds:[]};persist();return structuredClone(state.attempt)};
export const saveAssessmentProgress=async input=>{state.attempt={...state.attempt,answers:input.answers,currentItemId:input.currentItemId,revision:state.attempt.revision+1,lastSavedAtIso:new Date().toISOString()};persist();return{revision:state.attempt.revision,savedAtIso:state.attempt.lastSavedAtIso}};
export const submitAssessmentAttempt=async input=>{qa.submits.push(structuredClone(input));const checks=snapshots.map(q=>({id:String(q.id),correct:(input.answers[q.id]||'')===q.answer}));const percent=snapshots.reduce((sum,q,i)=>sum+(checks[i].correct?q.points:0),0);state.attempt={...state.attempt,status:'SUBMITTED',answers:input.answers,revision:state.attempt.revision+1,submittedAtIso:new Date().toISOString()};state.result={id:'fixture-result',title:'보관된 평가',unitId:'fixture',category,examRound:'round_2',score:percent,recordedAtMs:Date.now(),paperHeader,details:snapshots.map((q,i)=>({id:q.id,questionSnapshot:q,correct:checks[i].correct,u:input.answers[q.id]||'',concepts:q.concepts||[]}))};persist();return{attemptId:'fixture-result',revision:state.attempt.revision,score:checks.filter(q=>q.correct).length,total:3,percent,earnedPoints:percent,maxPoints:100,answerChecks:checks,questionSnapshots:snapshots,learningSnapshot:[],resultRef:'semester_assessment_results/fixture-result',reward:{status:'DISABLED'},replayedSubmission:false}};
export const callWithApplicationSession=async(name,input)=>{qa.calls.push({name,input:structuredClone(input)});if(name==='getMyQuizHistory'){
 if(!state.result)throw Object.assign(Error('제출 결과가 없습니다.'),{code:'not-found'});
 if(input.mode==='detail')return{data:{semesterId:input.semesterId,key:input.key,record:structuredClone(state.result),reviewNotes:structuredClone(state.notes)}};
 return{data:{semesterId:input.semesterId,rows:[{key,source:'canonical',id:'fixture-result',unitId:'fixture',category,examRound:'round_2',title:'보관된 평가',score:state.result.score,submittedAtMs:state.result.recordedAtMs,totalCount:3,wrongCount:2}],totalCount:1,nextCursor:null,generatedAt:Date.now(),version:'fixture'}};
 }if(name==='saveMyQuizReviewNote'){
 qa.saveCalls.push(structuredClone(input));if(qa.nextFailure==='unavailable'){qa.nextFailure='';throw Object.assign(Error('연결이 끊겼습니다. 다시 저장해 주세요.'),{code:'unavailable'});}
 if(qa.nextFailure==='conflict'){qa.nextFailure='';state.notes.revision++;persist();throw Object.assign(Error('다른 화면에서 노트가 바뀌었습니다.'),{code:'aborted',details:{reason:'QUIZ_REVIEW_REVISION_CONFLICT'}});}
 if(state.receipts[input.saveId])return{data:{...state.receipts[input.saveId],replayed:true}};
 if(input.expectedRevision!==state.notes.revision)throw Object.assign(Error('다른 화면에서 노트가 바뀌었습니다.'),{code:'aborted',details:{reason:'QUIZ_REVIEW_REVISION_CONFLICT'}});
 const q=snapshots.find(q=>String(q.id)===input.questionId);const item={questionId:input.questionId,practiceAnswer:input.practiceAnswer,reason:input.reason,note:input.note,correct:input.practiceAnswer?input.practiceAnswer===q.answer:null,updatedAt:new Date().toISOString()};state.notes={revision:state.notes.revision+1,items:[...state.notes.items.filter(n=>n.questionId!==item.questionId),item],updatedAt:item.updatedAt};const result={semesterId:input.semesterId,key:input.key,reviewNotes:structuredClone(state.notes),replayed:false};state.receipts[input.saveId]=result;persist();return{data:result};
 }throw Error('Unexpected server boundary '+name)};
`;
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route,useSearchParams,useNavigate}from'react-router-dom';import QuizRunner from './src/pages/student/quiz/QuizRunner';import MyQuizHistory from './src/pages/student/mypage/MyQuizHistory';import{AppToastProvider}from'./src/components/common/AppToastProvider';import{AppDialogProvider}from'./src/components/common/AppDialogProvider';import './src/components/layout/studentLayout.css';function History(){const[params]=useSearchParams();const navigate=useNavigate();return <MyQuizHistory semesterId="2026-2" active requestedAttemptId={params.get('attemptId')||''} onSelect={key=>navigate('/student/mypage?attemptId='+encodeURIComponent(key))} onClose={()=>navigate('/student/mypage')} onStart={()=>navigate('/student/quiz/run')}/>};createRoot(document.getElementById('root')).render(<BrowserRouter><AppToastProvider><AppDialogProvider><div className="student-layout"><Routes><Route path="/student/quiz/run" element={<QuizRunner/>}/><Route path="/student/mypage" element={<History/>}/></Routes></div></AppDialogProvider></AppToastProvider></BrowserRouter>);`;
const built = await build({ stdin:{contents:entry,loader:"tsx",resolveDir:root},bundle:true,write:false,metafile:true,outdir:"fixture",format:"esm",platform:"browser",jsx:"automatic",loader:{".woff2":"dataurl",".woff":"dataurl"},define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"synthetic-server-boundaries",setup(builder){
  builder.onResolve({filter:/\/QuizLessonPopup$/},()=>({path:"popup-stub",namespace:"popup-fixture"}));
  builder.onLoad({filter:/.*/,namespace:"popup-fixture"},()=>({contents:"export default function QuizLessonPopup(){return null}",loader:"js"}));
  builder.onResolve({filter:/contexts\/AuthContext$|(?:^|\/)(semesterScope|assessmentLifecycle|studentLessonReadCache|quizResultCorrections|quizScoreComparison|firebase|applicationSession)$/},()=>({path:"fixture-api",namespace:"fixture"}));
  builder.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:stubs,loader:"js"}));
}}] });
assert(!Object.keys(built.metafile.inputs).some(name=>/node_modules[\\/](@firebase|firebase)[\\/]/.test(name)),"Firebase must not enter this fixture");
const tailwind=await fs.readFile(process.env.ASSESSMENT_QA_TAILWIND||path.join(os.tmpdir(),"westory-qa-tailwind.js"),"utf8");
const css=((await fs.readFile(path.join(root,"assets/css/style.css"),"utf8"))+(await fs.readFile(path.join(root,"src/assets/index.css"),"utf8"))+built.outputFiles.find(file=>file.path.endsWith(".css")).text).replace(/@import\s+url\([^;]+;/g,"");
const js=built.outputFiles.find(file=>file.path.endsWith(".js")).text;
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}body{margin:0}#root{min-height:100dvh}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,"http://localhost").pathname;if(pathname.endsWith(".svg")){res.setHeader("Content-Type","image/svg+xml");return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="180"><rect x="2" y="2" width="476" height="176" fill="white" stroke="black"/><text x="30" y="70">Stored material</text></svg>');}res.setHeader("Content-Type",pathname.endsWith(".js")?"text/javascript; charset=utf-8":"text/html; charset=utf-8");res.end(pathname==="/fixture.js"?js:pathname==="/tailwind.js"?tailwind:html);});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||"msedge",headless:true});
const reports=[];let activePage;let failure;
try {
  const retakeOnly = process.argv.includes("--retake-only");
  for(const width of retakeOnly ? [390,1280] : [320,390,768,1280,1440])for(const category of retakeOnly ? ["diagnostic","formative"] : ["exam_prep","diagnostic","formative"]){
    const page=activePage=await browser.newPage({viewport:{width,height:1000},hasTouch:width<=768});
    const errors=[],external=[];page.on("pageerror",e=>errors.push(e.message));
    await page.route("**/*",route=>{if(route.request().url().startsWith(origin)||route.request().url().startsWith("data:"))return route.continue();external.push(route.request().url());return route.abort();});
    await page.goto(`${origin}/student/quiz/run?unitId=${category==="exam_prep"?"exam_prep":"fixture"}&category=${category}&round=round_2`);
    if(category==="exam_prep"){
      await page.getByRole("button",{name:"1번 문제 확대",exact:true}).click();
      const dialog=page.getByRole("dialog",{name:"1번 문제 확대",exact:true});
      assert(!(await dialog.innerText()).includes("보관된 해설"));
      assert.equal(await dialog.getByRole("button",{name:/힌트/}).count(),0);
      await dialog.getByRole("radio",{name:/경주/}).locator("..").click();
      await page.keyboard.press("Escape");
      await page.getByRole("button",{name:"3번 문제 확대",exact:true}).click();
      await page.getByRole("radio",{name:/과거/}).locator("..").click();
      await page.keyboard.press("Escape");
    } else {
      await page.getByRole("button",{name:/경주/}).click();
      assert.equal(await page.getByText("보관된 해설:",{exact:false}).count(),0);
      await page.getByRole("button",{name:"다음 문제",exact:true}).click();
      await page.getByRole("button",{name:"다음 문제",exact:true}).click();
      await page.getByRole("button",{name:/과거/}).click();
    }
    await page.getByRole("button",{name:"제출하기",exact:true}).click();
    await page.getByRole("alertdialog").getByRole("button",{name:"제출하기",exact:true}).click();
    if (retakeOnly) {
      await page.getByRole("button", {name:"다시 풀기",exact:true}).click();
      await page.getByRole("button", {name:/경주/}).waitFor();
      assert.equal(await page.evaluate(()=>window.reviewQa.starts.length),2,"Explicit result retry starts a new attempt directly");
      assert.equal(await page.locator(".student-quiz-intro").count(),0,"No old intro on result retry");
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
      reports.push({width,category,retake:true,passed:true});
      await page.close();activePage=null;continue;
    }
    if(category==="exam_prep"){
      await page.getByRole("button",{name:"저장된 답안·해설",exact:true}).click();
    }else await page.getByRole("button",{name:"전체 답안 및 해설 보기",exact:true}).click();
    await page.getByRole("region",{name:"평가 결과 상세",exact:true}).waitFor();
    const note=page.getByRole("textbox",{name:"오답 노트",exact:true});
    await note.waitFor();
    assert.equal(await page.locator('.quiz-notebook__paper .mock-exam-question-ink').count(),1,'History opens the familiar question and reflection directly');
    await page.getByRole('button',{name:'전체 답안 보기',exact:true}).click();
    const original=await page.evaluate(()=>JSON.stringify(window.reviewQa.state.result));
    if(category==="exam_prep"){
      assert.equal(await page.locator(".mock-exam-title-box h2").innerText(),"보관된 역사과 시험 제목");
      assert.equal(await page.locator(".mock-exam-paper-heading").innerText(),"보관된 시험 머리말");
      assert((await page.locator(".mock-exam-paper").innerText()).includes("보관된 공통 지문"));
      assert((await page.locator(".mock-exam-paper").innerText()).includes("ㄱ. 관리 선발"));
    }
    await page.getByRole("button",{name:/오답 2문제/}).click();
    await note.waitFor();
    for(const name of ['실수했어요','몰랐어요','잘못 읽었어요','찍었어요'])assert(await page.getByRole('radio',{name,exact:true}).isVisible());
    const layout=await page.evaluate(()=>{
      const paper=document.querySelector('.quiz-notebook__paper').getBoundingClientRect(),review=document.querySelector('.quiz-notebook__review').getBoundingClientRect();
      return{width:document.querySelector('.quiz-notebook').clientWidth,sideBySide:paper.right<=review.left&&Math.abs(paper.top-review.top)<2,stacked:paper.bottom<=review.top,overflow:document.documentElement.scrollWidth>innerWidth+1};
    });
    assert.equal(layout.overflow,false);
    assert.equal(layout.width>=880?layout.sideBySide:layout.stacked,true,`Notebook layout at ${width}px for ${category}`);
    await note.fill("한양으로 도읍을 옮긴 배경을 다시 확인했습니다.");
    await page.getByRole("radio",{name:"개념이 헷갈렸어요",exact:true}).check();
    await page.evaluate(()=>window.reviewQa.nextFailure="unavailable");
    await page.getByRole("button",{name:"노트 저장",exact:true}).click();
    await page.getByRole("button",{name:"다시 저장",exact:true}).waitFor();
    assert.equal(await note.inputValue(),"한양으로 도읍을 옮긴 배경을 다시 확인했습니다.");
    await page.getByRole("button",{name:"다시 저장",exact:true}).click();
    await page.getByText("저장했어요.",{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.reviewQa.saveCalls[0].saveId===window.reviewQa.saveCalls[1].saveId),true,"Transient retries keep their idempotency key");
    await note.fill("다른 기기와 충돌해도 작성한 노트가 유지됩니다.");
    await page.evaluate(()=>window.reviewQa.nextFailure="conflict");
    await page.getByRole("button",{name:"노트 저장",exact:true}).click();
    await page.getByRole("button",{name:"저장된 노트 다시 불러오기",exact:true}).click();
    assert.equal(await note.inputValue(),"다른 기기와 충돌해도 작성한 노트가 유지됩니다.");
    await page.getByRole("button",{name:/^(노트 저장|다시 저장)$/}).click();
    await page.getByText("저장했어요.",{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>JSON.stringify(window.reviewQa.state.result)),original,"Note writes never alter assessment score or immutable answers");
    await page.reload();
    await note.waitFor();
    assert.equal(await note.inputValue(),"다른 기기와 충돌해도 작성한 노트가 유지됩니다.");
    assert.equal(await page.getByRole("radio",{name:"개념이 헷갈렸어요",exact:true}).isChecked(),true);
    await page.getByRole("button",{name:"해설 가리고 다시 풀기",exact:true}).click();
    await page.getByRole("radio",{name:/한양/}).locator('..').click();
    await page.getByRole("button",{name:"답 확인",exact:true}).click();
    await page.getByRole("button",{name:"노트 저장",exact:true}).click();
    await page.getByText("저장했어요.",{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>{const item=window.reviewQa.state.notes.items.find(item=>item.questionId==='1');return{practiceAnswer:item.practiceAnswer,correct:item.correct};}),{practiceAnswer:"한양",correct:true});
    await page.getByRole("button",{name:"다음 오답",exact:true}).click();
    await page.getByText("미응답",{exact:true}).waitFor();
    assert((await page.locator('.student-quiz-relearning').innerText()).includes('보관된 공통 지문'), 'Wrong-note view restores the original shared passage');
    await note.fill("무응답 문항도 오답 노트로 저장했습니다.");
    await page.getByRole("button",{name:"노트 저장",exact:true}).click();
    await page.getByText("저장했어요.",{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.reviewQa.state.notes.items.length),2);
    assert.deepEqual(await page.evaluate(()=>{const item=window.reviewQa.state.notes.items.find(item=>item.questionId==='2');return{practiceAnswer:item.practiceAnswer,correct:item.correct};}),{practiceAnswer:"",correct:null});
    assert.equal(await page.evaluate(()=>JSON.stringify(window.reviewQa.state.result)),original);
    await page.getByRole('button',{name:'오답 노트 목록',exact:true}).click();
    await page.getByRole('heading',{name:'오답 노트',exact:true}).waitFor();
    await page.getByRole('button',{name:/보관된 평가/}).click();
    await note.waitFor();
    assert.equal(await note.inputValue(),'다른 기기와 충돌해도 작성한 노트가 유지됩니다.','List selection opens saved first-question reflection directly');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await page.screenshot({path:path.join(evidence,`${category}-${width}.png`),fullPage:true});
    reports.push({width,category,notes:await page.evaluate(()=>window.reviewQa.state.notes.items.length),network:"local fixture only",passed:true});
    await page.close();activePage=null;
  }
}catch(error){failure=error.stack||String(error);if(activePage){await activePage.screenshot({path:path.join(evidence,"failure.png"),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(evidence,"failure.html"),await activePage.content());}}
finally{await fs.writeFile(path.join(evidence,"report.json"),JSON.stringify({passed:!failure,reports,failure},null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({passed:!failure,evidence,reports,failure},null,2));if(failure)throw Error(failure);
