import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const learning = require("../functions/productionGateway/assessmentLearning.js");
let playwright;
try { playwright = require("playwright"); } catch {
  playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
}
const evidence = process.env.MOCK_EXAM_RUNNER_EVIDENCE_DIR || await fs.mkdtemp(path.join(os.tmpdir(), "westory-mock-runner-"));
await fs.mkdir(evidence, { recursive: true });
const tailwindPath = process.env.ASSESSMENT_QA_TAILWIND || process.env.PORTAL_DESIGN_TAILWIND_PATH || path.join(os.tmpdir(), "westory-qa-tailwind.js");
const tailwind = await fs.readFile(tailwindPath, "utf8");
const common = { unitId: "exam_prep", category: "exam_prep", examRound: "round_2", concepts: ["조선의 성립"], explanation: "저장 당시 해설: 조선은 한양을 도읍으로 삼았다.", hintEnabled: true, hint: "모의고사에서 숨겨야 하는 기존 힌트" };
const passageSet = { id: 'fixture-set', instruction: '다음 자료를 읽고 물음에 답하시오.', passage: '1392년 새로운 나라가 세워졌고, 1394년 도읍을 옮겼다.', image: '/qa-set-material.svg' };
const questions = [
  { ...common, id: 1, type: "choice", question: "저장 당시 1번 원문: 자료에 해당하는 나라로 옳은 것은?", passage: "한양으로 도읍을 옮기고 새로운 통치 체제를 마련하였다.", image: "/qa-material.svg", options: ["가야", "고려", "발해", "신라", "조선"], answer: "조선", paperOrder: 1, points: 30 },
  { ...common, id: 2, type: "short", question: "저장 당시 2번 원문: 조선의 건국자를 쓰시오.", passageSet, answer: "이성계", paperOrder: 2, points: 40 },
  { ...common, id: 3, type: "choice", question: "저장 당시 3번 원문: 조선의 수도를 고르시오.", passageSet, examplePassage: 'ㄱ. 도읍을 옮김\nㄴ. 국가의 기틀을 마련함', options: ["경주", "개경", "한양", "평양", "부여"], answer: "한양", paperOrder: 3, points: 30 },
];
const frozen = learning.captureQuestionSnapshots(questions.map(question => ({ path: `questions/${question.id}`, data: question })), questions.map(question => String(question.id)));
const presentation = learning.questionPresentation(frozen.questionSnapshots);
assert.ok(presentation.every(question => question.answer === undefined && question.explanation === undefined));
const denseQuestions = Array.from({ length: 16 }, (_, index) => ({
  ...questions[0], id: index + 1, paperOrder: index + 1, points: 6.25,
  question: `${index + 1}번. 다음 자료를 읽고 당시의 정치·사회 모습에 대한 설명으로 가장 적절한 것을 고르시오.`,
  passage: index === 4
    ? "여러 제도를 정비하여 통치 체제를 마련하였다. 왕은 관리들의 의견을 듣고 나라의 중요한 일을 결정하였다.\n".repeat(16)
    : "(가) 새로운 왕조는 한양으로 도읍을 옮겼다.\n(나) 관리들은 여러 제도를 정비하고 백성들의 생활을 살폈다.",
  options: ["유교를 숭상하였다.", "수도를 한양으로 옮겼다.", "관리를 뽑는 과거제를 실시하였다.", "지방에 수령을 파견하여 통치하였다.", "왕을 보좌하는 여러 중앙 정치 기구를 두었다."],
  answer: "수도를 한양으로 옮겼다.",
}));
const denseFrozen = learning.captureQuestionSnapshots(denseQuestions.map(question => ({ path: `questions/${question.id}`, data: question })), denseQuestions.map(question => String(question.id)));
const stubs = `
export const watchQuizResultCorrections=()=>()=>{};
export const saveMyQuizReviewNote=async()=>{throw Error('Fixture note writes disabled')};export const loadMyQuizHistoryDetail=async(semesterId,key)=>({semesterId,key,reviewNotes:{revision:0,items:[],updatedAt:''}});
const dense=location.search.includes('dense');const snapshots=dense?${JSON.stringify(denseFrozen.questionSnapshots)}:${JSON.stringify(frozen.questionSnapshots)};const presentation=dense?${JSON.stringify(learning.questionPresentation(denseFrozen.questionSnapshots))}:${JSON.stringify(presentation)};
const config={year:'2026',semester:'2'};const userData={uid:'fixture-student',name:'가상 학생',grade:3,class:1,number:1,email:'fixture@example.invalid'};const currentUser={uid:userData.uid,email:userData.email,getIdTokenResult:async()=>({claims:{email:userData.email}})};
const paperHeader={paperTitle:'2026학년도 역사 탐구 평가',paperHeading:'3학년 역사과'};
const definitionId='quiz:2026-2:exam_prep:exam_prep:round_2';const settings={...paperHeader,active:true,timeLimit:600,questionCount:snapshots.length,hintLimit:0,allowRetake:true};
let attempt=JSON.parse(sessionStorage.getItem('mock-runner-attempt')||'null');let failSubmit=location.search.includes('submit-error');let failSave=location.search.includes('save-error');
export const qa=window.mockRunnerQa={starts:[],prepares:[],reads:[],saves:[],submits:[],curriculumReads:0,comparisonReads:0,get attempt(){return attempt},snapshotAnswerLeak:presentation.some(q=>q.answer||q.explanation)};
const persist=()=>sessionStorage.setItem('mock-runner-attempt',JSON.stringify(attempt));
export const useAuth=()=>({config,userData,currentUser});
export const getYearSemester=()=>config;
export const readStudentCurriculumTree=async()=>{qa.curriculumReads++;if(location.search.includes('curriculum-error'))throw Error('Synthetic unavailable optional labels');if(location.search.includes('curriculum-pending'))return new Promise(()=>{});return []};
export const buildAssessmentDefinitionId=()=>definitionId;
export const isAssessmentRevisionConflict=error=>error?.code==='aborted';
export const loadQuizScoreComparison=async()=>{qa.comparisonReads++;return null};
export const getAssessmentState=async(input={})=>{
  qa.reads.push(input);const readNumber=qa.reads.length;
  if(location.search.includes('held-initial')&&readNumber<=2)await new Promise(resolve=>{qa.releaseInitial=resolve});
  if(location.search.includes('stale-initial')&&readNumber===1){await new Promise(r=>setTimeout(r,300));throw Error('Stale initial failure')};
  if(location.search.includes('slow-read'))await new Promise(resolve=>{qa.releaseRead=resolve});
  if(input.prepareAssets&&location.search.includes('prerequisite'))throw Object.assign(Error('Earlier round required'),{code:'functions/failed-precondition',details:{reason:'ASSESSMENT_PREREQUISITE_REQUIRED',requiredRound:'round_1'}});
  if(input.prepareAssets&&location.search.includes('prepare-forbidden'))throw Object.assign(Error('Preparation forbidden'),{code:'functions/permission-denied',details:{reason:'ASSESSMENT_ASSET_PREPARATION_FORBIDDEN'}});
  if(input.prepareAssets&&location.search.includes('attempt-limit'))throw Object.assign(Error('Attempt limit reached'),{code:'functions/failed-precondition',details:{reason:'ASSESSMENT_ATTEMPT_LIMIT_REACHED'}});
  if(input.prepareAssets)qa.prepares.push(input);
  const active=attempt&&['STARTED','IN_PROGRESS','RECOVERABLE'].includes(attempt.status);
  return {status:location.search.includes('prerequisite')?'PREREQUISITE_REQUIRED':active?'RECOVERABLE':attempt?.status==='SUBMITTED'?'SUBMITTED':location.search.includes('prepare-forbidden')?'CLOSED':'READY',requiredRound:'round_1',definition:{title:'중학교 3학년 복시 (2회 모의고사)',questionCount:snapshots.length,itemCount:snapshots.length,status:'PUBLISHED',durationSeconds:600,presentationSettings:settings,maxAttempts:3,cooldownMinutes:0},attempt:attempt?structuredClone(attempt):null,serverNowIso:new Date().toISOString(),...(input.prepareAssets?{preparedAssets:{sourceHash:'fixture-paper-'+qa.prepares.length,imageUrls:dense?[]:['/qa-material.svg','/qa-set-material.svg'],fontCharacters:[...new Set(JSON.stringify(presentation))].sort().join('')}}:{})};
};
export const startAssessmentAttempt=async input=>{qa.starts.push(input);if(attempt&&['STARTED','IN_PROGRESS'].includes(attempt.status))return {...structuredClone(attempt),resumed:true};if(location.search.includes('start-offline')&&qa.starts.length===1)throw Object.assign(Error('Synthetic offline'),{code:'functions/unavailable'});if(location.search.includes('stale-assets')&&qa.starts.length===1)throw Object.assign(Error('Changed paper'),{details:{reason:'ASSESSMENT_PREPARED_SOURCE_STALE'}});attempt={attemptId:'fixture-mock-attempt',definitionId,semesterId:'2026-2',assessmentKind:'QUIZ',attemptNumber:(attempt?.attemptNumber||0)+1,status:'STARTED',revision:1,answers:{},currentItemId:'1',questionIds:snapshots.map(question=>String(question.id)),startedAtIso:new Date().toISOString(),serverNowIso:new Date().toISOString(),deadlineAtIso:new Date(Date.now()+600000).toISOString(),lastSavedAtIso:new Date().toISOString(),submittedAtIso:'',resultRef:'',resumed:false,learningSnapshot:[],paperHeader:structuredClone(paperHeader),questionPresentation:presentation,questionSnapshotOmittedIds:[]};persist();if(location.search.includes('held-start-response'))await new Promise(resolve=>{qa.releaseStart=resolve});if(location.search.includes('lost-start-response')&&qa.starts.length===1)throw Object.assign(Error('Synthetic lost response'),{code:'functions/unavailable'});return structuredClone(attempt)};
export const saveAssessmentProgress=async input=>{qa.saves.push(structuredClone(input));if(location.search.includes('slow-save'))await new Promise(resolve=>{qa.releaseSave=resolve});if(failSave){failSave=false;throw Error('Fixture save failure')};if(input.expectedRevision!==attempt.revision)throw Error('Stale fixture revision');attempt={...attempt,status:'IN_PROGRESS',revision:attempt.revision+1,answers:input.answers,currentItemId:input.currentItemId,analytics:input.analytics,lastSavedAtIso:new Date().toISOString()};persist();return {revision:attempt.revision,savedAtIso:attempt.lastSavedAtIso}};
export const submitAssessmentAttempt=async input=>{qa.submits.push(structuredClone(input));if(location.search.includes('slow-submit'))await new Promise(resolve=>{qa.releaseSubmit=resolve});if(failSubmit){failSubmit=false;throw Error('Fixture submit failure')};if(input.expectedRevision!==attempt.revision)throw Error('Stale submit fixture revision');const checks=snapshots.map(q=>({id:String(q.id),correct:String(input.answers[q.id]||'').trim()===q.answer}));const earnedPoints=snapshots.reduce((sum,q,i)=>sum+(checks[i].correct?q.points:0),0);attempt={...attempt,status:'SUBMITTED',revision:attempt.revision+1,answers:input.answers,submittedAtIso:new Date().toISOString()};persist();return {attemptId:attempt.attemptId,revision:attempt.revision,score:checks.filter(q=>q.correct).length,total:3,percent:earnedPoints,earnedPoints,maxPoints:100,answerChecks:checks,questionSnapshots:snapshots,learningSnapshot:[],resultRef:'semester_assessment_results/'+attempt.attemptId,reward:{status:'DISABLED'},replayedSubmission:false}};
`;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,Routes,Route,useLocation} from 'react-router-dom';import QuizRunner from './src/pages/student/quiz/QuizRunner';import {AppToastProvider} from './src/components/common/AppToastProvider';import {AppDialogProvider} from './src/components/common/AppDialogProvider';import './src/components/layout/studentLayout.css';const Observer=()=>{const value=useLocation();React.useEffect(()=>{window.mockRunnerLocationState=value.state;if(value.state?.startAssessment===false)sessionStorage.setItem('mock-entry-consumed','1')},[value]);return null};const initialEntry={pathname:'/student/quiz/run',search:'?unitId=exam_prep&category=exam_prep&round=round_2',state:location.search.includes('auto-entry')&&sessionStorage.getItem('mock-entry-consumed')!=='1'?{startAssessment:true}:null};createRoot(document.getElementById('root')).render(<React.StrictMode><MemoryRouter initialEntries={[initialEntry]}><Observer/><AppToastProvider><AppDialogProvider><div className="student-layout">{location.search.includes("portal-header")&&<header style={{height:64,padding:16,boxSizing:"border-box"}}>가상 포털 머리말</header>}<Routes><Route path="/student/quiz/run" element={<QuizRunner/>}/><Route path="/student/mypage" element={<p>저장된 답안 확인 경로</p>}/><Route path="/student/quiz" element={<p>평가 목록 경로</p>}/></Routes></div></AppDialogProvider></AppToastProvider></MemoryRouter></React.StrictMode>);`;
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root }, bundle: true, write: false, metafile: true,
  outdir: "fixture", format: "esm", platform: "browser", jsx: "automatic", loader: { ".woff2": "dataurl", ".woff": "dataurl", ".webp": "dataurl" },
  define: { "process.env.NODE_ENV": JSON.stringify(process.env.MOCK_EXAM_QA_DEV || (process.argv.includes('--entry-only')||process.argv.includes('--entry-recovery-only')) ? 'development' : 'production') },
  plugins: [{ name: "mock-assessment-boundary", setup(builder) {
    builder.onResolve({ filter: /\/QuizLessonPopup$/ }, () => ({ path: "popup-stub", namespace: "popup-fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "popup-fixture" }, () => ({ contents: "export default function QuizLessonPopup(){return null}", loader: "js" }));
    builder.onResolve({ filter: /contexts\/AuthContext$|lib\/(semesterScope|assessmentLifecycle|studentLessonReadCache|quizResultCorrections|quizScoreComparison|quizReviewNotes|myQuizHistory)$/ }, () => ({ path: "runner-stub", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: stubs, loader: "js" }));
  } }],
});
assert.equal(Object.keys(built.metafile.inputs).some(name => /node_modules[\\/](@firebase|firebase)[\\/]/.test(name)), false, "No live Firebase runtime in browser fixture");
const js = built.outputFiles.find(file => file.path.endsWith(".js")).text;
const globalCss = (await fs.readFile(path.join(root, "assets/css/style.css"), "utf8")) + (await fs.readFile(path.join(root, "src/assets/index.css"), "utf8"));
const css = (globalCss + built.outputFiles.find(file => file.path.endsWith(".css")).text).replace(/@import\s+url\([^;]+;/g, "");
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}body{margin:0}#root{min-height:100dvh}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if(['/qa-material.svg','/qa-set-material.svg'].includes(pathname)) {
    response.setHeader('Content-Type','image/svg+xml');
    response.setHeader('Cache-Control','public, max-age=3600');
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="180"><rect x="2" y="2" width="476" height="176" fill="white" stroke="black"/><path d="M40 150L160 50L280 150L400 70" fill="none" stroke="black" stroke-width="4"/></svg>');
    return;
  }
  response.setHeader("Content-Type", ["/fixture.js", "/tailwind.js"].includes(pathname) ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
  response.end(pathname === "/fixture.js" ? js : pathname === "/tailwind.js" ? tailwind : html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge", headless: true });
const pageErrors = [], viewportReports = [];
const open = async (width, height = 1024, touch = false, search = "") => {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  page.on("pageerror", error => pageErrors.push(error.stack || error.message));
  await page.route("**/*", route => route.request().url().startsWith(origin) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
  await page.goto(origin + search);
  await page.getByRole("button", { name: "1번 문제 확대", exact: true }).waitFor();
  return page;
};
const openQuestion = async (page, index) => {
  const target = page.getByRole("button", { name: new RegExp(`^${index}번 문제 확대`) });
  // Result scores appear before their handwriting animation ends; wait until
  // the paper enables question interaction before sending a keyboard action.
  await page.waitForFunction(element => element?.getAttribute('aria-disabled') !== 'true', await target.elementHandle());
  await target.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `${index}번 문제 확대`, exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("button", { name: "시험지로 돌아가기" }).evaluate(element => element === document.activeElement), true);
  return dialog;
};
const checkPaperViewport = async (page, expectedFit, label) => {
  try {
    await page.waitForFunction(fit => document.querySelector('.mock-exam-paper')?.dataset.fit === fit || !document.querySelector('#root')?.childElementCount, expectedFit);
    assert(await page.locator('.mock-exam-paper').count(),'Exam workspace remains mounted after resizing');
  } catch(error) {
    console.error('Browser errors',pageErrors);
    console.error('Viewport transition failed',label,await page.evaluate(()=>({width:innerWidth,height:innerHeight,fit:document.querySelector('.mock-exam-paper')?.dataset.fit,active:document.activeElement?.outerHTML.slice(0,200),dialog:!!document.querySelector('.mock-exam-zoom'),workspace:document.querySelector('.mock-exam-workspace')?.getAttribute('style')})));
    throw error;
  }
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.mock-exam-workspace-scroll').evaluate(element => element.scrollTo({top:0,left:0,behavior:'instant'}));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const layout = await page.evaluate(() => {
    const workspace = document.querySelector('.mock-exam-workspace');
    const scroll = document.querySelector('.mock-exam-workspace-scroll');
    const sheet = document.querySelector('.mock-exam-sheet');
    const toolbar = document.querySelector('.mock-exam-toolbar');
    const footer = document.querySelector('.mock-exam-submit-bar');
    const rect = element => { const r=element.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
    const style=getComputedStyle(scroll), bounds=rect(scroll);
    return {
      fit:document.querySelector('.mock-exam-paper').dataset.fit, transform:getComputedStyle(workspace).transform,
      sheet:rect(sheet), toolbar:rect(toolbar), footer:rect(footer), viewport:{width:innerWidth,height:innerHeight},
      content:{left:bounds.left+parseFloat(style.paddingLeft),right:bounds.left+scroll.clientWidth-parseFloat(style.paddingRight),top:bounds.top+parseFloat(style.paddingTop),bottom:bounds.top+scroll.clientHeight-parseFloat(style.paddingBottom)},
      scrollHeight:scroll.scrollHeight, clientHeight:scroll.clientHeight, scrollWidth:scroll.scrollWidth, clientWidth:scroll.clientWidth,overflowX:style.overflowX,
      bodyOverflow:document.documentElement.scrollWidth>innerWidth+1,
    };
  });
  assert.equal(layout.transform,'none',`${label}: no forced rotation`);
  assert.equal(layout.fit,expectedFit);
  assert(!layout.bodyOverflow && (layout.scrollWidth<=layout.clientWidth+1 || ['hidden','clip'].includes(layout.overflowX)),`${label}: no visible horizontal overflow ${JSON.stringify(layout)}`);
  assert(layout.sheet.left>=layout.content.left-1 && layout.sheet.right<=layout.content.right+1,`${label}: sheet fits the available width`);
  assert(layout.content.top>=layout.toolbar.bottom-1 && layout.content.bottom<=layout.footer.top+1,`${label}: paper is between toolbar and footer`);
  assert(layout.footer.bottom<=layout.viewport.height+1,`${label}: submit actions remain on screen ${JSON.stringify(layout)}`);
  if(expectedFit==='page') {
    assert(layout.sheet.top>=layout.content.top-1 && layout.sheet.bottom<=layout.content.bottom+1,`${label}: entire first page is visible ${JSON.stringify(layout)}`);
    assert(layout.sheet.bottom<=layout.footer.top+1,`${label}: footer does not cover the first page`);
  } else {
    assert(Math.abs(layout.sheet.width-(layout.content.right-layout.content.left))<1,`${label}: landscape paper uses 100% available width ${JSON.stringify(layout)}`);
    assert(layout.scrollHeight>layout.clientHeight,`${label}: full-width paper scrolls vertically`);
  }
  viewportReports.push({label,...layout});
  return layout;
};
const checkRunnerToggle = async (page, dialog, touch) => {
  const radios = dialog.getByRole('radio');
  const first = radios.nth(0), second = radios.nth(1);
  const snapshot = () => page.evaluate(() => {
    const bounds = ['.mock-exam-zoom', '.mock-exam-zoom-scroll .mock-exam-question-ink', '.mock-exam-answer-controls'].flatMap(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return [rect.x, rect.y, rect.width, rect.height];
    });
    const scroll = document.querySelector('.mock-exam-zoom-scroll');
    return [...bounds, scroll.scrollTop, scroll.scrollLeft, window.scrollX, window.scrollY];
  });
  const stable = async (action, expected, label) => {
    const before = await snapshot();
    await action();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await radios.evaluateAll(inputs => inputs.findIndex(input => input.checked)), expected, label);
    const after = await snapshot();
    assert(after.every((value, index) => Math.abs(value-before[index])<=0.6), `${label}: runner bounds/scroll changed ${JSON.stringify({before,after})}`);
    assert.equal(await page.getByRole('button',{name:'답안 지우기',exact:true}).count(),0);
  };
  // Bring the first two targets into view before measuring; any subsequent
  // shift is caused by the answer update, not Playwright's target scrolling.
  await first.locator('..').evaluate(element => element.scrollIntoView({block:'center'}));
  await stable(() => first.locator('..').click(),0,'Runner click selects');
  await stable(() => first.locator('..').click(),-1,'Runner repeated click clears');
  if(touch){
    await stable(() => first.locator('..').tap(),0,'Runner tap selects');
    await stable(() => first.locator('..').tap(),-1,'Runner repeated tap clears');
  }
  await first.focus();
  await stable(() => page.keyboard.press('Space'),0,'Runner Space selects');
  await stable(() => page.keyboard.press('Space'),-1,'Runner repeated Space clears');
  await stable(() => page.keyboard.press('Space'),0,'Runner Space restores');
  await stable(() => page.keyboard.press('ArrowDown'),1,'Runner native ArrowDown selects next');
  await stable(() => page.keyboard.press('ArrowUp'),0,'Runner native ArrowUp selects previous');
  await stable(() => second.locator('..').click(),1,'Runner changes to a different answer');
  await stable(() => second.locator('..').click(),-1,'Runner clears the changed answer');
  assert.equal(await dialog.locator('details,summary').count(),0,'No student answer/explanation disclosure before submission');
  assert.equal(await page.getByText('정답·해설 확인',{exact:true}).count(),0);
  assert(!/정답:|저장 당시 해설/.test(await dialog.innerText()),'No student correct-answer label or explanation leaks');
};
try {
  if(process.argv.includes('--loading-only') || process.argv.includes('--recovery-only')) {
    for(const width of process.argv.includes('--recovery-only')?[]:[390,768,1280]) {
      const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<1000});
      page.on('pageerror',error=>pageErrors.push(error.stack||error.message));
      await page.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort());
      await page.goto(origin+'?auto-entry&slow-read&slow-save&slow-submit'+(width===768?'&submit-error':''));
      await page.waitForFunction(()=>typeof window.mockRunnerQa.releaseRead==='function');
      await page.locator('.ws-loading-page').getByRole('status',{name:'처리 중',exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.mockRunnerQa.starts.length),0);
      await page.screenshot({path:path.join(evidence,'slow-lookup-'+width+'.png')});
      await page.evaluate(()=>window.mockRunnerQa.releaseRead());
      await page.getByRole('button',{name:'1번 문제 확대',exact:true}).waitFor();
      assert.deepEqual(await page.evaluate(()=>({reads:window.mockRunnerQa.reads.length,prepares:window.mockRunnerQa.prepares.length,starts:window.mockRunnerQa.starts.length,curriculum:window.mockRunnerQa.curriculumReads})),{reads:1,prepares:1,starts:1,curriculum:0},'Initial state and preparation share one request');
      if(width===1280)await page.getByRole('button',{name:'전체 화면',exact:true}).click();
      const question=await openQuestion(page,1);
      await question.getByRole('radio',{name:/조선/}).locator('..').click();
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>window.mockRunnerQa.saves.length===1);
      await page.evaluate(()=>{window.mockRunnerQa.workspace=document.querySelector('.mock-exam-workspace')});
      await page.getByRole('button',{name:'제출하기',exact:true}).click();
      await page.getByRole('alertdialog').getByRole('button',{name:'제출하기',exact:true}).click();
      await page.locator('.ws-loading-overlay').getByRole('status',{name:'처리 중',exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('.ws-loading-overlay')!==null),true,'Loading covers the full-screen paper');
      await page.keyboard.press('Escape');await page.keyboard.press('Enter');await page.keyboard.press('Space');
      assert.equal(await page.evaluate(()=>window.mockRunnerQa.submits.length),0,'Submission waits for the existing save, without sending a stale revision');
      if(width===1280)assert.equal(await page.locator('.mock-exam-workspace.is-fixed').count(),1,'Blocked Escape keeps the full-screen paper mounted');
      await page.screenshot({path:path.join(evidence,'slow-submit-'+width+'.png')});
      await page.evaluate(()=>window.mockRunnerQa.releaseSave());
      await page.waitForFunction(()=>window.mockRunnerQa.submits.length===1);
      assert.equal(await page.evaluate(()=>window.mockRunnerQa.submits[0].expectedRevision),2);
      assert.equal(await page.evaluate(()=>window.mockRunnerQa.submits[0].answers['1']),'조선');
      assert.equal(await page.evaluate(()=>window.mockRunnerQa.workspace===document.querySelector('.mock-exam-workspace')),true,'Loading does not remount the answer paper');
      await page.evaluate(()=>window.mockRunnerQa.releaseSubmit());
      if(width===768) {
        await page.getByRole('button',{name:'다시 제출',exact:true}).waitFor();
        assert.equal(await page.locator('.ws-loading-overlay').count(),0,'Failed submit releases loading for explicit retry');
        assert.equal(await page.getByRole('button',{name:'1번 문제 확대, 답안 입력됨',exact:true}).count(),1);
        await page.getByRole('button',{name:'다시 제출',exact:true}).click();
        await page.waitForFunction(()=>window.mockRunnerQa.submits.length===2);
        await page.locator('.ws-loading-overlay').waitFor();
        await page.keyboard.press('Enter');await page.keyboard.press('Space');
        assert.equal(await page.evaluate(()=>window.mockRunnerQa.submits.length),2,'Keyboard actions cannot duplicate a pending retry');
        await page.evaluate(()=>window.mockRunnerQa.releaseSubmit());
      }
      await page.getByRole('button',{name:'저장된 답안·해설',exact:true}).waitFor();
      assert.deepEqual(await page.evaluate(()=>({reads:window.mockRunnerQa.reads.length,saves:window.mockRunnerQa.saves.length,curriculum:window.mockRunnerQa.curriculumReads,comparison:window.mockRunnerQa.comparisonReads})),{reads:1,saves:1,curriculum:0,comparison:0},'Mock results do not reread curriculum, prior scores, or assessment state');
      assert.equal(await page.locator('.ws-loading-overlay').count(),0);
      await page.close();
    }
    const recoverable=await open(768);
    const originalAttempt=await recoverable.evaluate(()=>({id:window.mockRunnerQa.attempt.attemptId,deadline:window.mockRunnerQa.attempt.deadlineAtIso}));
    await recoverable.goto(origin+'?prepare-forbidden');
    await recoverable.getByRole('button',{name:'1번 문제 확대',exact:true}).waitFor();
    assert.deepEqual(await recoverable.evaluate(()=>({id:window.mockRunnerQa.attempt.attemptId,deadline:window.mockRunnerQa.attempt.deadlineAtIso})),originalAttempt,'Closed preparation preserves the authorized active attempt and its clock');
    assert.deepEqual(await recoverable.evaluate(()=>({reads:window.mockRunnerQa.reads.length,prepares:window.mockRunnerQa.prepares.length,starts:window.mockRunnerQa.starts.length})),{reads:2,prepares:0,starts:0});
    await recoverable.evaluate(()=>{const saved=window.mockRunnerQa.attempt;saved.status='SUBMITTED';saved.attemptNumber=3;saved.submittedAtIso=new Date().toISOString();sessionStorage.setItem('mock-runner-attempt',JSON.stringify(saved))});
    await recoverable.goto(origin+'?attempt-limit');
    await recoverable.getByText('응시 가능 횟수를 모두 사용했습니다.',{exact:true}).waitFor();
    assert.equal(await recoverable.getByRole('button',{name:'평가 시작하기',exact:true}).count(),0,'Already-submitted attempt limit keeps the existing no-new-attempt outcome');
    assert.equal(await recoverable.evaluate(()=>window.mockRunnerQa.starts.length),0);
    await recoverable.close();
    const forbidden=await browser.newPage({viewport:{width:390,height:844}});
    await forbidden.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort());
    await forbidden.goto(origin+'?auto-entry&prepare-forbidden');
    await forbidden.getByText('응시 기간이 종료된 평가입니다.',{exact:true}).waitFor();
    assert.deepEqual(await forbidden.evaluate(()=>({reads:window.mockRunnerQa.reads.length,starts:window.mockRunnerQa.starts.length})),{reads:2,starts:0},'The read-only fallback cannot authorize a new attempt');
    assert.equal(await forbidden.getByRole('button',{name:'평가 시작하기',exact:true}).count(),0);
    await forbidden.close();
  } else if(process.argv.includes('--entry-recovery-only')) {
    for (const [width, search] of [[390,'held-start-response'],[768,'held-start-response'],[1280,'held-start-response'],[1280,'held-initial']]) {
      const page=await browser.newPage({viewport:{width,height:900}});
      page.on('pageerror',error=>pageErrors.push(error.message));
      await page.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort());
      await page.goto(origin+'?auto-entry&'+search);
      const retry=page.getByRole('button',{name:'응시 상태 다시 확인',exact:true});
      await retry.waitFor();
      await retry.focus(); await page.keyboard.press('Enter');
      await page.getByRole('button',{name:'1번 문제 확대',exact:true}).waitFor();
      const restored=await page.evaluate(()=>({id:window.mockRunnerQa.attempt.attemptId,deadline:window.mockRunnerQa.attempt.deadlineAtIso,starts:window.mockRunnerQa.starts.length}));
      assert.equal(restored.starts,1,'Recovery never starts the committed attempt twice');
      if(search==='held-start-response')await page.evaluate(()=>window.mockRunnerQa.releaseStart());
      else await page.evaluate(()=>window.mockRunnerQa.releaseInitial());
      await page.waitForTimeout(150);
      assert.equal(await page.locator('.mock-exam-paper').count(),1,'A late superseded phase cannot replace the recovered paper');
      assert.deepEqual(await page.evaluate(()=>({id:window.mockRunnerQa.attempt.attemptId,deadline:window.mockRunnerQa.attempt.deadlineAtIso,starts:window.mockRunnerQa.starts.length})),restored);
      await page.screenshot({path:path.join(evidence,`recovered-${search}-${width}.png`)});
      await page.close();
    }
  } else if(process.argv.includes('--entry-only')) {
    for(const [width,search] of [[390,''],[768,'direct-link'],[768,'curriculum-error'],[1280,'curriculum-pending'],[1366,'stale-initial'],[768,'start-offline'],[390,'lost-start-response']]) {
      const page=await browser.newPage({viewport:{width,height:900}});
      page.on('pageerror',error=>pageErrors.push(error.message));
      await page.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort());
      await page.goto(origin+(search==='direct-link'?'?direct-link':'?auto-entry&'+search));
      if(['start-offline','lost-start-response'].includes(search)) {
        await page.getByRole('alert').filter({hasText:'서버 연결을 확인하지 못했습니다.'}).waitFor();
        assert.equal(await page.getByRole('button',{name:'평가 시작하기',exact:true}).count(),0,'An entry failure offers a retry, not another start confirmation');
        const before=await page.evaluate(()=>({starts:window.mockRunnerQa.starts.length,id:window.mockRunnerQa.attempt?.attemptId,deadline:window.mockRunnerQa.attempt?.deadlineAtIso}));
        assert.equal(before.starts,1,'No automatic retry after a failed start');
        await page.getByRole('button',{name:'다시 시도',exact:true}).click();
        await page.getByRole('button',{name:'1번 문제 확대',exact:true}).waitFor();
        const after=await page.evaluate(()=>({starts:window.mockRunnerQa.starts.length,id:window.mockRunnerQa.attempt?.attemptId,deadline:window.mockRunnerQa.attempt?.deadlineAtIso,number:window.mockRunnerQa.attempt?.attemptNumber}));
        assert.equal(after.starts,search==='lost-start-response'?1:2,'Retry reads canonical state before sending another START');assert.equal(after.number,1);
        if(search==='lost-start-response'){assert.equal(after.id,before.id);assert.equal(after.deadline,before.deadline)}
      } else {
        await page.getByRole('button',{name:'1번 문제 확대',exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>window.mockRunnerQa.starts.length),1,'List intent starts exactly once, including StrictMode');
      }
      assert.equal(await page.locator('.student-quiz-intro').count(),0,'No repeated introduction after list entry');
      if(search!=='direct-link')assert.equal(await page.evaluate(()=>window.mockRunnerLocationState?.startAssessment),false,'The explicit navigation intent is consumed');
      assert.equal(await page.evaluate(()=>window.mockRunnerQa.attempt.attemptNumber),1);
      if(search==='stale-initial') {
        await page.waitForTimeout(350);
        assert.equal(await page.locator('.student-quiz-intro').count(),0,'A cancelled initialization cannot overwrite the paper');
      }
      if(width===390&&search==='') {
        const before=await page.evaluate(()=>({id:window.mockRunnerQa.attempt.attemptId,deadline:window.mockRunnerQa.attempt.deadlineAtIso}));
        await page.reload();
        await page.getByRole('button',{name:'1번 문제 확대',exact:true}).waitFor();
        assert.deepEqual(await page.evaluate(()=>({id:window.mockRunnerQa.attempt.attemptId,deadline:window.mockRunnerQa.attempt.deadlineAtIso})),before);
        assert.equal(await page.evaluate(()=>window.mockRunnerQa.starts.length),0,'Refresh resumes the existing paper without START');
      }
      await page.screenshot({path:path.join(evidence,'direct-entry-'+width+'-'+(search||'normal')+'.png')});
      await page.close();
    }
    const blocked=await browser.newPage({viewport:{width:768,height:900}});
    await blocked.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort());
    await blocked.goto(origin+'?auto-entry&prerequisite');
    await blocked.getByText('초시 (1회)를 제출한 뒤 응시할 수 있습니다.',{exact:true}).waitFor();
    assert.equal(await blocked.evaluate(()=>window.mockRunnerQa.starts.length),0);
    assert.equal(await blocked.evaluate(()=>window.mockRunnerQa.prepares.length),0);
    await blocked.close();
  } else if(process.argv.includes('--prerequisite-only')) {
    for(const width of [320,390,768,1280]) {
      const page=await browser.newPage({viewport:{width,height:900}});
      page.on('pageerror',error=>pageErrors.push(error.message));
      await page.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort());
      await page.goto(origin+'?prerequisite');
      await page.getByText('초시 (1회)를 제출한 뒤 응시할 수 있습니다.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'평가 시작하기',exact:true}).count(),0);
      assert.equal(await page.locator('.mock-exam-question').count(),0);
      const requests=await page.evaluate(()=>({starts:window.mockRunnerQa.starts.length,prepares:window.mockRunnerQa.prepares.length}));
      assert.deepEqual(requests,{starts:0,prepares:0});
      await page.screenshot({path:path.join(evidence,'prerequisite-'+width+'.png')});
      await page.close();
    }
  } else if(process.argv.includes('--viewport-only')) {
    for(const [width,height,touch] of [[320,568,true],[390,844,true],[768,1024,true],[844,390,true],[1024,768,true],[1280,900,false]]) {
      const page=await open(width,height,touch);
      const fit=width<=height || (touch && Math.min(width,height)<=600)?'page':'width';
      await checkPaperViewport(page,fit,`viewport-only ${width}x${height}`);
      await page.screenshot({path:path.join(evidence,`viewport-${width}x${height}.png`)});
      await page.getByRole('button',{name:'전체 화면',exact:true}).click();
      await checkPaperViewport(page,fit,`viewport-only fullscreen ${width}x${height}`);
      if(width>=844) {
        await page.getByRole('button',{name:'전체 화면 닫기',exact:true}).click();
        const dialog=await openQuestion(page,1);
        await checkRunnerToggle(page,dialog,touch);
        await dialog.getByRole('radio',{name:/조선/}).locator('..').click();
        await page.keyboard.press('Escape');
        await page.setViewportSize({width:768,height:1024});
        await checkPaperViewport(page,'page','viewport-only portrait after mobile landscape');
        const restored=await openQuestion(page,1);
        assert(await restored.getByRole('radio',{name:/조선/}).isChecked(),'Orientation changes preserve the selected answer');
        await page.keyboard.press('Escape');
        const writing=await openQuestion(page,2);
        const input=writing.getByRole('textbox',{name:'답안',exact:true});
        await input.focus();
        await page.setViewportSize({width:768,height:420});
        assert.equal(await page.locator('.mock-exam-paper').getAttribute('data-fit'),'page','Keyboard height does not change the paper fit mode');
        await input.fill('입력 유지');
        await page.setViewportSize({width:768,height:1024});
        assert.equal(await input.inputValue(),'입력 유지');
      }
      await page.close();
    }
    const portalPage=await open(768,1024,true,'?portal-header');
    const portrait=await checkPaperViewport(portalPage,'page','viewport-only portal header portrait');
    assert(portrait.toolbar.top>=64);
    await portalPage.screenshot({path:path.join(evidence,'portal-header-portrait.png')});
    await portalPage.setViewportSize({width:1024,height:768});
    await checkPaperViewport(portalPage,'width','viewport-only portal header landscape');
    await portalPage.close();
  } else {
  const preparedPage = await browser.newPage({viewport:{width:1280,height:1024}});
  let releaseImage;const imageGate=new Promise(resolve=>{releaseImage=resolve;});
  let imageRequested;const requestStarted=new Promise(resolve=>{imageRequested=resolve;});
  await preparedPage.route('**/*',async route=>{
    if(!route.request().url().startsWith(origin)&&!route.request().url().startsWith('data:'))return route.abort();
    if(route.request().url().endsWith('/qa-material.svg')){imageRequested();await imageGate;}
    return route.continue();
  });
  await preparedPage.goto(origin);
  await requestStarted;
  assert.equal(await preparedPage.evaluate(()=>window.mockRunnerQa.starts.length),0,'Slow asset preparation does not start the exam timer');
  assert.equal(await preparedPage.locator('.mock-exam-paper').count(),0,'No partial question paper is exposed while assets are pending');
  await preparedPage.locator('.ws-loading-page').getByRole('status',{name:'처리 중',exact:true}).waitFor();
  releaseImage();
  await preparedPage.getByRole('button',{name:'1번 문제 확대',exact:true}).waitFor();
  assert.equal(await preparedPage.evaluate(()=>window.mockRunnerQa.starts[0].preparedSourceHash),'fixture-paper-1');
  assert.equal(await preparedPage.evaluate(()=>window.mockRunnerQa.reads.length),1,'Direct URL entry shares initial state and preparation, without a post-start read');
  assert.equal(await preparedPage.locator('.mock-exam-paper img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0)),true);
  const stableLayout=await preparedPage.locator('.mock-exam-sheet-space').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  await preparedPage.waitForTimeout(250);
  assert.deepEqual(await preparedPage.locator('.mock-exam-sheet-space').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height)),stableLayout,'Prepared paper does not repaginate after showing');
  await preparedPage.screenshot({path:path.join(evidence,'prepared-assets-1280.png'),fullPage:true});
  await preparedPage.close();

  const brokenPage=await browser.newPage({viewport:{width:390,height:844}});let failImage=true;
  await brokenPage.route('**/*',route=>{
    if(!route.request().url().startsWith(origin)&&!route.request().url().startsWith('data:'))return route.abort();
    if(route.request().url().endsWith('/qa-material.svg')&&failImage){failImage=false;return route.fulfill({status:503,body:'unavailable'});}
    return route.continue();
  });
  await brokenPage.goto(origin);
  await brokenPage.getByRole('alert').filter({hasText:'시험지 그림을 모두 불러오지 못했습니다.'}).waitFor();
  assert.equal(await brokenPage.evaluate(()=>window.mockRunnerQa.starts.length),0,'Broken images never consume an attempt');
  await brokenPage.screenshot({path:path.join(evidence,'asset-error-390.png'),fullPage:true});
  await brokenPage.getByRole('button',{name:'자료 다시 불러오기',exact:true}).click();
  await brokenPage.getByRole('button',{name:'1번 문제 확대',exact:true}).waitFor();
  assert.equal(await brokenPage.evaluate(()=>window.mockRunnerQa.starts.length),1,'Explicit retry starts once after every image is ready');
  await brokenPage.close();

  const stalePage=await open(768,1024,false,'?stale-assets');
  assert.equal(await stalePage.evaluate(()=>window.mockRunnerQa.prepares.length),2);
  assert.equal(await stalePage.evaluate(()=>window.mockRunnerQa.starts.at(-1).preparedSourceHash),'fixture-paper-2');
  assert.equal(await stalePage.evaluate(()=>window.mockRunnerQa.attempt.attemptNumber),1,'Source changes are re-prepared before creating the attempt');
  await stalePage.close();

  const retakePage=await open(1280);
  await retakePage.evaluate(()=>{const saved=window.mockRunnerQa.attempt;saved.status='SUBMITTED';saved.submittedAtIso=new Date(Date.now()-60000).toISOString();sessionStorage.setItem('mock-runner-attempt',JSON.stringify(saved));});
  await retakePage.reload();
  await retakePage.getByText('평가 목록 경로',{exact:true}).waitFor();
  assert.equal(await retakePage.evaluate(()=>window.mockRunnerQa.starts.length),0,'Refreshing a submitted attempt does not create a retake');
  await retakePage.evaluate(()=>sessionStorage.removeItem('mock-entry-consumed'));
  await retakePage.goto(origin+'?auto-entry');
  await retakePage.getByRole('button',{name:'1번 문제 확대',exact:true}).waitFor();
  assert.equal(await retakePage.evaluate(()=>window.mockRunnerQa.attempt.attemptNumber),2,'A permitted retake prepares the next paper after SUBMITTED state');
  await retakePage.close();

  const expiredPage=await open(1280);
  await expiredPage.evaluate(()=>{const saved=window.mockRunnerQa.attempt;saved.startedAtIso=new Date(Date.now()-610000).toISOString();saved.lastSavedAtIso=saved.startedAtIso;saved.deadlineAtIso=new Date(Date.now()-10000).toISOString();sessionStorage.setItem('mock-runner-attempt',JSON.stringify(saved));});
  await expiredPage.route('**/qa-material.svg',route=>route.abort());
  expiredPage.on('dialog',dialog=>dialog.dismiss());
  await expiredPage.reload();
  await expiredPage.getByRole('button',{name:'저장된 답안·해설',exact:true}).waitFor();
  assert.equal(await expiredPage.evaluate(()=>window.mockRunnerQa.submits[0].submitReason),'TIMEOUT','Image failure cannot block submission of an already-expired attempt');
  assert.equal(await expiredPage.evaluate(()=>window.mockRunnerQa.reads.length),1,'Expired resume uses the initial state without another preparation request');
  await expiredPage.close();

  for (const [width,height] of [[320,568],[360,800],[390,844],[768,1024],[820,1180],[1280,1024],[1440,1024]]) {
    const touch=width<=820;
    const page = await open(width, height, touch, "?submit-error");
    assert.equal(await page.locator('.mock-exam-title-box h2').innerText(), '2026학년도 역사 탐구 평가');
    assert.equal(await page.locator('.mock-exam-paper-heading').innerText(), '3학년 역사과');
    assert.equal(await page.evaluate(() => window.mockRunnerQa.snapshotAnswerLeak), false);
    assert.equal(await page.getByText("저장 당시 해설:", { exact: false }).count(), 0, "No answer explanation is rendered before submission");
    assert.equal(await page.getByRole("button", { name: /힌트/ }).count(), 0);
    assert.equal(await page.getByText("모의고사에서 숨겨야 하는 기존 힌트", { exact: false }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.evaluate(() => document.fonts.ready);
    await checkPaperViewport(page,width<=height?'page':'width',`${width}x${height}`);
    await page.screenshot({ path: path.join(evidence, `paper-${width}.png`), fullPage: true });
    await openQuestion(page, 3);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("button", { name: "3번 문제 확대", exact: true }).evaluate(element => element === document.activeElement), true);
    const first = await openQuestion(page, 1);
    await checkRunnerToggle(page,first,touch);
    const controls = await first.locator('.mock-exam-answer-controls [role="radiogroup"]').evaluate(group => ({
      height: group.getBoundingClientRect().height,
      gap: parseFloat(getComputedStyle(group).rowGap),
      heights: [...group.querySelectorAll('label')].map(label => label.getBoundingClientRect().height),
    }));
    assert(controls.gap <= 4 && controls.height <= 256, 'Actual runner keeps the choice group compact');
    assert(controls.heights.every(height => height >= 44 && height <= 48), 'Actual runner preserves usable touch targets');
    const footer = first.locator('footer');
    assert.deepEqual((await footer.getByRole('button').allTextContents()).map(text => text.trim()), ['시험지로 돌아가기', '이전 문제', '다음 문제']);
    const footerLayout = await footer.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const buttons = [...element.querySelectorAll('button')].map(button => {
        const rect = button.getBoundingClientRect();
        return {left:rect.left,right:rect.right,top:rect.top,height:rect.height};
      });
      return {left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom,padding:parseFloat(getComputedStyle(element).paddingLeft),buttons,
        bodyBottom:document.querySelector('.mock-exam-zoom-scroll').getBoundingClientRect().bottom};
    });
    assert(Math.abs(footerLayout.buttons[0].left-footerLayout.left-footerLayout.padding)<=1,'Student return button stays at the left edge');
    assert(footerLayout.buttons.every(button => button.height>=44 && Math.abs(button.top-footerLayout.buttons[0].top)<=1 && button.right<=footerLayout.right+1));
    assert(footerLayout.buttons[0].right<=footerLayout.buttons[1].left && footerLayout.buttons[1].right<=footerLayout.buttons[2].left,'Student footer actions do not overlap');
    assert(footerLayout.bodyBottom<=footerLayout.top+1 && footerLayout.bottom<=height+1,'Student scroll area cannot cover footer actions');
    for (const [motion, choice] of [['no-preference','고려'], ['reduce','조선']]) {
      await page.emulateMedia({reducedMotion:motion});
      const radio=first.getByRole('radio',{name:new RegExp(choice)});
      await radio.locator('..').click();
      assert(await radio.isChecked());
      const state=await radio.locator('..').locator('.mock-exam-answer-check').evaluate(async svg => {
        const reveal=svg.querySelector('.mock-exam-answer-check-reveal');
        const animation=reveal?.getAnimations()[0];
        if(!animation)return {animated:false};
        const timing=animation.effect.getComputedTiming();
        animation.pause();animation.currentTime=timing.delay;
        await new Promise(requestAnimationFrame);
        const start=parseFloat(getComputedStyle(reveal).strokeDashoffset);
        animation.currentTime=timing.delay+Number(timing.duration)*0.5;
        await new Promise(requestAnimationFrame);
        const middle=parseFloat(getComputedStyle(reveal).strokeDashoffset);
        animation.finish();
        const end=parseFloat(getComputedStyle(reveal).strokeDashoffset);
        const ink=getComputedStyle(svg.querySelector('.mock-exam-answer-check-ink'));
        return {animated:true,start,middle,end,duration:timing.duration,iterations:timing.iterations,
          strokeWidth:parseFloat(ink.strokeWidth),widthRatio:parseFloat(getComputedStyle(svg).width)/parseFloat(getComputedStyle(svg).fontSize)};
      });
      assert(state.animated && state.start>state.middle && state.middle>state.end && state.end===0,`${width}px actual runner draws the selected check under ${motion}`);
      assert(state.duration>=150 && state.duration<=1000 && state.iterations===1);
      assert(state.strokeWidth>=3 && state.widthRatio>=1.8);
    }
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.screenshot({ path: path.join(evidence, `zoom-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.mockRunnerQa.attempt.answers['1'] === '조선');
    await page.reload();
    const restored = await openQuestion(page, 1);
    assert.equal(await restored.getByRole("radio", { name: /조선/ }).isChecked(), true);
    await page.keyboard.press("Escape");
    const second = await openQuestion(page, 2);
    const input = second.getByRole("textbox", { name: "답안", exact: true });
    await input.fill("틀린 답안");
    assert.equal(await input.getAttribute("maxlength"), "20");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "제출하기", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "평가를 제출할까요?" });
    await confirm.waitFor();
    assert.ok((await confirm.textContent()).includes("문제가 1개"));
    await confirm.getByRole("button", { name: "계속 풀기", exact: true }).click();
    assert.equal(await page.evaluate(() => window.mockRunnerQa.submits.length), 0);
    await page.getByRole("button", { name: "제출하기", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "제출하기", exact: true }).click();
    await page.getByRole("button", { name: "다시 제출", exact: true }).waitFor();
    assert.ok(await page.getByRole("button", { name: "1번 문제 확대, 답안 입력됨", exact: true }).count());
    await page.getByRole("button", { name: "다시 제출", exact: true }).click();
    await page.getByRole("button", { name: "저장된 답안·해설", exact: true }).waitFor();
    await page.locator(".mock-exam-score").waitFor();
    assert.equal(await page.locator('.mock-exam-title-box h2').innerText(), '2026학년도 역사 탐구 평가', 'Result paper preserves the started-attempt header');
    assert.ok((await page.locator(".mock-exam-score").textContent()).startsWith("30"), "The paper uses weighted server percent, not correct-count ratio");
    const submitted = await page.evaluate(() => window.mockRunnerQa.submits);
    assert.equal(submitted.length, 2);
    assert.deepEqual(submitted[0].answers, submitted[1].answers, "Retry preserves answers");
    assert.equal(submitted[1].answers['1'], "조선");
    assert.equal(submitted[1].answers['2'], "틀린 답안");
    assert.equal(submitted[1].answers['3'] || "", "");
    const review = await openQuestion(page, 2);
    assert.ok((await review.textContent()).includes("정답: 이성계"));
    assert.ok((await review.textContent()).includes("저장 당시 해설"));
    assert.equal(await review.getByRole("textbox").count(), 0);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: path.join(evidence, `result-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "저장된 답안·해설", exact: true }).click();
    await page.getByText("저장된 답안 확인 경로", { exact: true }).waitFor();
    await page.close();
  }
  for(const [landscapeWidth,landscapeHeight,touch] of [[844,390,true],[1024,768,true],[1280,900,false]]) {
  const landscape = await open(landscapeWidth, landscapeHeight, touch);
  const expectedFit=landscapeWidth===844?'page':'width';
  await checkPaperViewport(landscape,expectedFit,`landscape ${landscapeWidth}x${landscapeHeight}`);
  await landscape.screenshot({ path:path.join(evidence,`landscape-paper-${landscapeWidth}x${landscapeHeight}.png`) });
  await landscape.getByRole('button',{name:'전체 화면',exact:true}).click();
  await checkPaperViewport(landscape,expectedFit,`fullscreen ${landscapeWidth}x${landscapeHeight}`);
  await landscape.getByRole('button',{name:'전체 화면 닫기',exact:true}).click();
  const landscapeDialog = await openQuestion(landscape, 1);
  await checkRunnerToggle(landscape,landscapeDialog,touch);
  await landscapeDialog.getByRole("radio", { name: /조선/ }).locator("..").click();
  await landscape.screenshot({ path: path.join(evidence, `landscape-zoom-${landscapeWidth}x${landscapeHeight}.png`), fullPage: true });
  await landscape.keyboard.press("Escape");
  await landscape.setViewportSize({ width: 768, height: 1024 });
  await checkPaperViewport(landscape,'page',`portrait after landscape ${landscapeWidth}`);
  const portraitDialog = await openQuestion(landscape, 1);
  assert.equal(await portraitDialog.getByRole("radio", { name: /조선/ }).isChecked(), true);
  await landscape.keyboard.press("Escape");
  const keyboardDialog = await openQuestion(landscape, 2);
  const keyboardInput = keyboardDialog.getByRole("textbox", { name: "답안", exact: true });
  await keyboardInput.focus();
  await landscape.setViewportSize({ width: 768, height: 420 });
  assert.equal(await landscape.locator('.mock-exam-workspace.is-rotated').count(), 0, 'Keyboard-height changes must not trigger device rotation');
  assert.equal(await landscape.locator('.mock-exam-paper').getAttribute('data-fit'),'page','Keyboard-height changes preserve portrait paper mode');
  await keyboardInput.fill('입력 유지');
  await landscape.setViewportSize({ width: 768, height: 1024 });
  assert.equal(await keyboardInput.inputValue(), '입력 유지');
  await landscape.close();
  }
  const portalPage = await open(768,1024,true,'?portal-header');
  const portalPortrait = await checkPaperViewport(portalPage,'page','portrait below 64px portal header');
  assert(portalPortrait.toolbar.top>=64,'Portal header height is reserved before the workspace');
  await portalPage.screenshot({path:path.join(evidence,'portal-header-portrait.png')});
  await portalPage.setViewportSize({width:1024,height:768});
  await checkPaperViewport(portalPage,'width','landscape below 64px portal header');
  await portalPage.close();
  const densePage = await open(1280, 1024, false, "?dense");
  await densePage.evaluate(() => document.fonts.ready);
  await densePage.waitForFunction(() => document.querySelectorAll('.mock-exam-sheet .mock-exam-question').length === 16);
  assert.ok(await densePage.locator('.mock-exam-sheet').first().locator('.mock-exam-column').nth(0).locator('.mock-exam-question').count());
  assert.ok(await densePage.locator('.mock-exam-sheet').first().locator('.mock-exam-column').nth(1).locator('.mock-exam-question').count());
  assert.equal(await densePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await densePage.screenshot({ path: path.join(evidence, 'dense-1280.png'), fullPage: true });
  const denseZoom = await openQuestion(densePage, 5);
  assert.equal(await denseZoom.locator('.mock-exam-zoom-scroll').evaluate(element => element.scrollHeight > element.clientHeight), true, 'Long material stays in the zoom scroll area');
  await densePage.screenshot({ path: path.join(evidence, 'dense-long-question.png'), fullPage: true });
  await densePage.close();
  }
  assert.deepEqual(pageErrors, []);
  await fs.writeFile(path.join(evidence,'viewport-report.json'),JSON.stringify(viewportReports,null,2));
  console.log(process.argv.includes('--recovery-only')
    ? `Exam recovery passed: closed active attempt and deadline preserved, limited submitted attempt blocked, unavailable counts unknown, and forbidden fresh attempt blocked. Evidence: ${evidence}`
    : process.argv.includes('--loading-only')
    ? `Exam loading passed: one initial read, no optional mock reads, delayed common overlay at 390/768/1280, in-flight save revision, keyboard duplicate prevention, mounted full-screen paper, explicit submit retry, closed recovery and new-attempt gates. Evidence: ${evidence}`
    : process.argv.includes('--entry-only')
    ? `Direct exam entry passed: StrictMode, consumed intent, optional curriculum failure/pending, cancelled initialization, explicit retry, lost-response resume, deadline preservation and prerequisite block at 390/768/1280/1366. Evidence: ${evidence}`
    : process.argv.includes('--prerequisite-only')
    ? `Mock exam prerequisite browser passed: direct round-2 link blocked before asset preparation or attempt start at 320/390/768/1280. Evidence: ${evidence}`
    : process.argv.includes('--viewport-only')
    ? `Mock exam viewport browser passed: 320x568/390x844/768x1024/844x390 full-page fit, 1024x768/1280x900 full width, fullscreen variants, 64px portal header and orientation change. Evidence: ${evidence}`
    : `Mock exam runner browser passed: asset decode before timed start, broken-image retry, source-change re-prepare, touch 320x568/360x800/390x844/768x1024/820x1180 and desktop 1280/1440, portrait/mobile full-page fit, landscape 100% width with vertical scroll and no forced rotation at 844x390/1024x768/1280x900, full screen, orientation changes, click/tap/Space toggle with native Arrow navigation, stationary answer/dialog/scroll layout, no clear button or pre-submit explanation, pencil drawing under normal and reduced motion, keyboard focus, save/resume, incomplete confirmation, retry, weighted immutable results. Evidence: ${evidence}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
