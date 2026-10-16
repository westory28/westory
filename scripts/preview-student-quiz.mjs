import { build } from "esbuild";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const learning = createRequire(import.meta.url)(
  "../functions/productionGateway/assessmentLearning.js",
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tailwind = await fs.readFile(
  process.env.ASSESSMENT_QA_TAILWIND ||
    path.join(os.tmpdir(), "westory-assessment-qa-tailwind.js"),
  "utf8",
);
const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="400" height="180" fill="#eff6ff"/><text x="200" y="95" text-anchor="middle" font-size="24">역사 자료 예시</text></svg>',
  );
const common = {
  unitId: "mid",
  subUnitId: "leaf",
  category: "diagnostic",
  concepts: ["조선의 통치 체제"],
  reviewLessonId: "leaf",
  explanation: "제시된 자료의 왕과 제도 사이 관계를 확인합니다.",
};
const questions = [
  {
    ...common,
    id: 1,
    type: "choice",
    question:
      "다음 자료를 읽고 조선의 중앙 정치 제도에 대한 설명으로 가장 적절한 것을 고르세요.",
    passage:
      "왕을 보좌하여 국가의 중요한 정책을 논의하였으며, 여러 관청 사이의 업무를 조정하였습니다.\n\n제시된 제도가 맡았던 역할을 고려하여 각 보기의 내용과 비교해 보세요.",
    options: [
      "의정부는 높은 관직의 관리들이 모여 중요한 국가 정책을 논의하던 기관이었다.",
      "집현전은 지방의 수령을 감찰하고 군사 훈련을 지휘하는 역할을 맡았다.",
      "사헌부는 왕실 가족의 교육만을 담당하여 관리의 비리를 감찰할 수 없었다.",
      "삼사는 군사 제도를 통합하고 국경의 방어를 전담한 군사 기관이었다.",
    ],
    answer:
      "의정부는 높은 관직의 관리들이 모여 중요한 국가 정책을 논의하던 기관이었다.",
    hintEnabled: true,
    hint: "국가의 중요한 정책을 논의하던 기관입니다.",
  },
  {
    ...common,
    id: 2,
    type: "choice",
    question: "제시된 역사 자료와 관련 있는 내용을 고르세요.",
    image,
    options: [
      "첫 번째 자료는 조선의 통치 체제를 설명하는 긴 문장으로 여러 줄에 걸쳐 끝까지 모두 표시되어야 합니다.",
      "두 번째 자료 설명",
      "세 번째 자료 설명",
    ],
    choiceOptionImages: [image, image, image],
    answer: "두 번째 자료 설명",
  },
  {
    ...common,
    id: 3,
    type: "ox",
    question: "조선은 유교를 통치의 기본 이념으로 삼았다.",
    answer: "O",
  },
  {
    ...common,
    id: 4,
    type: "short",
    question: "조선의 건국자는 누구인가요?",
    answer: "이성계",
  },
  {
    ...common,
    id: 5,
    type: "order",
    question: "사건을 일어난 순서대로 선택하세요.",
    options: ["조선 건국", "훈민정음 창제", "임진왜란"],
    answer: "조선 건국||훈민정음 창제||임진왜란",
  },
  {
    ...common,
    id: 6,
    type: "matching",
    question: "왕과 관련 있는 사건을 연결하세요.",
    matchingPairs: [
      { left: "태조", right: "조선 건국" },
      { left: "세종", right: "훈민정음 창제" },
    ],
    answer: "태조=>조선 건국||세종=>훈민정음 창제",
  },
  {
    ...common,
    id: 7,
    type: "choice",
    question: "조선의 통치 이념을 고르세요.",
    options: ["유교", "불교", "도교"],
    answer: "유교",
  },
];
const frozen = learning.captureQuestionSnapshots(
  questions.map((q) => ({
    path: "questions/" + q.id,
    data: { ...q, question: "응시 원문 · " + q.question },
  })),
  questions.map((q) => String(q.id)),
);
const presentation = learning.questionPresentation(frozen.questionSnapshots);
const stubs = `
const questions=${JSON.stringify(questions)};const questionSnapshots=${JSON.stringify(frozen.questionSnapshots)};const questionPresentation=${JSON.stringify(presentation)};
const config={year:'2026',semester:'2'};const userData={uid:'fixture-student',name:'가상 학생',grade:3,class:1,number:1,email:'fixture@example.invalid'};const currentUser={uid:userData.uid,email:userData.email,getIdTokenResult:async()=>({claims:{email:userData.email}})};
export const useAuth=()=>({config,userData,currentUser});
export const db={};export const collection=(...args)=>args;export const doc=(...args)=>args;export const query=(...args)=>args;export const where=(...args)=>args;export const getDoc=async()=>({exists:()=>false});export const getDocs=async(ref)=>{const key=JSON.stringify(ref);if(key.includes('quiz_questions'))throw Error('Student preview must not read the question bank');if(key.includes('semester_assessment_results')&&location.search.includes('compare-error'))throw Error('Fixture optional comparison read failure');const rows=key.includes('semester_assessment_results')?resultRows:[];const docs=rows.map(q=>({id:String(q.attemptId||q.id),data:()=>q}));return {docs,forEach:(visit)=>docs.forEach(visit)}};
export const getYearSemester=()=>({year:'2026',semester:'2'});export const getSemesterCollectionPath=(_,name)=>'/fixture/'+name;export const getSemesterDocPath=()=>'/fixture';
export const readStudentCurriculumTree=async()=>[{id:'big',title:'조선의 성립과 발전',children:[{id:'mid',title:'조선의 정치·사회와 문화의 발전을 살펴보는 단원',children:[{id:'leaf',title:'조선의 통치 체제와 중앙 정치 기구'}]}]}];
const settings={active:true,timeLimit:600,questionCount:7,hintLimit:2,questionOrder:'created',allowRetake:true};export const createDefaultAssessmentConfigEntry=()=>settings;export const getAssessmentConfigKey=()=> 'fixture';export const getGrade3ClassIdsFromSchoolConfig=async()=>['3-1'];export const isAssessmentVisibleToStudent=()=>true;export const readAssessmentConfigMap=async()=>({fixture:settings});
const definitionId='quiz:2026-2:mid:diagnostic';export const buildAssessmentDefinitionId=()=> definitionId;export const isAssessmentRevisionConflict=()=>false;let attempt=JSON.parse(sessionStorage.getItem("flat-quiz-fixture-attempt")||"null");const resultRows=JSON.parse(sessionStorage.getItem('flat-quiz-fixture-results')||'[]');const persist=()=>{sessionStorage.setItem("flat-quiz-fixture-attempt",JSON.stringify(attempt));sessionStorage.setItem('flat-quiz-fixture-results',JSON.stringify(resultRows))};let failInitOnce=true;let failSubmitOnce=true;export const getAssessmentState=async()=>{if(location.search.includes('init-error')&&failInitOnce){failInitOnce=false;throw Error('Fixture initial load failure')};return {status:'READY',definition:{title:"조선의 중앙 정치 제도 진단평가",questionCount:7,itemCount:7,status:'PUBLISHED',durationSeconds:600,presentationSettings:settings,maxAttempts:3,cooldownMinutes:0},attempt,serverNowIso:new Date().toISOString()}};
export const startAssessmentAttempt=async()=>{attempt={attemptId:'fixture-attempt-'+(resultRows.length+1),definitionId,semesterId:'2026-2',assessmentKind:'QUIZ',attemptNumber:resultRows.length+1,status:'STARTED',revision:1,answers:{},currentItemId:'1',questionIds:questions.map(q=>String(q.id)),startedAtIso:new Date().toISOString(),deadlineAtIso:new Date(Date.now()+600000).toISOString(),lastSavedAtIso:new Date().toISOString(),submittedAtIso:'',resultRef:'',resumed:false,learningSnapshot:questions,questionPresentation,questionSnapshotOmittedIds:[]};persist();return attempt};
let failSaveOnce=true;export const saveAssessmentProgress=async(input)=>{await new Promise(resolve=>setTimeout(resolve,250));if(location.search.includes('save-error')&&failSaveOnce){failSaveOnce=false;throw Error('Fixture offline')};attempt={...attempt,revision:attempt.revision+1,answers:input.answers,currentItemId:input.currentItemId,analytics:input.analytics};persist();return {revision:attempt.revision,savedAtIso:new Date().toISOString()}};
export const submitAssessmentAttempt=async(input)=>{if(location.search.includes('submit-error')&&failSubmitOnce){failSubmitOnce=false;throw Error('Fixture submit failure')};const checks=questions.map(q=>({id:String(q.id),correct:String(input.answers[q.id]||'').trim()===String(q.answer)}));const percent=Math.round(checks.filter(q=>q.correct).length/7*100);attempt={...attempt,status:'SUBMITTED',submittedAtIso:new Date().toISOString()};resultRows.push({id:attempt.attemptId,attemptId:attempt.attemptId,studentUid:userData.uid,semesterId:'2026-2',assessmentKind:'QUIZ',definitionId,status:'SUBMITTED',submittedAtIso:attempt.submittedAtIso,percent,sourceHash:'a'.repeat(64),answerChecks:checks});persist();return {questionSnapshots,questionSnapshotOmittedIds:[],attemptId:attempt.attemptId,revision:attempt.revision+1,percent,answerChecks:checks,resultRef:'result-'+attempt.attemptId,learningSnapshot:questions,analytics:input.analytics,reward:{status:'DISABLED',blockedMessage:'가상 평가 · 실제 점수와 위스는 바뀌지 않습니다.'}}};
`;
const entry = `import React from 'react';import './src/components/layout/studentLayout.css';import {createRoot} from 'react-dom/client';import {MemoryRouter,Routes,Route} from 'react-router-dom';import QuizLearningResult from './src/pages/student/quiz/QuizLearningResult';import QuizRunner from './src/pages/student/quiz/QuizRunner';import {AppDialogProvider} from './src/components/common/AppDialogProvider';import {AppToastProvider} from './src/components/common/AppToastProvider';const variant=new URLSearchParams(location.search).get('result');const score=variant==='zero'?0:variant==='full'?100:75;const previous=variant==='down'?90:variant==='same'?score:variant==='previous-zero'?0:60;const comparison=variant==='none'?null:{previousScore:previous,delta:score-previous,direction:score===previous?'same':score>previous?'up':'down'};createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/student/quiz/run?unitId=mid&category=diagnostic&title='+encodeURIComponent('조선의 정치·사회와 문화의 발전을 살펴보는 단원')]}><AppToastProvider><AppDialogProvider><div className="student-layout" style={{height:'100dvh',display:'flex',flexDirection:'column'}}><header style={{padding:'16px',height:64,borderBottom:'1px solid #e5e7eb',background:'white',flexShrink:0}}>위스토리 · 가상 학생 평가 검증</header><main style={{display:'flex',flexDirection:'column',minHeight:0,flex:1,overflowY:'auto'}}>{variant!==null ? <QuizLearningResult assessmentTitle="조선의 중앙 정치 제도 진단평가" unitTitle="조선의 정치·사회와 문화의 발전을 살펴보는 단원" score={score} correctCount={score===0?0:score===100?20:15} totalCount={20} comparison={comparison} onReview={()=>{location.search='?review'}} onRetry={()=>{location.search=''}}/> : <Routes><Route path="/student/quiz/run" element={<QuizRunner/>}/><Route path="/student/mypage" element={<p>답안 및 해설 검증 경로</p>}/></Routes>}</main></div></AppDialogProvider></AppToastProvider></MemoryRouter>);`;
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  metafile: true,
  outdir: "fixture",
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "no-network-assessment-fixture",
      setup(build) {
        build.onResolve(
          {
            filter:
              /firebase\/firestore$|(?:lib\/|\.\/)firebase$|contexts\/AuthContext$|lib\/semesterScope$|lib\/assessmentConfig$|lib\/assessmentLifecycle$|lib\/studentLessonReadCache$/,
          },
          () => ({ path: "fixture-stubs", namespace: "fixture" }),
        );
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: stubs,
          loader: "js",
        }));
      },
    },
  ],
});
if (
  Object.keys(built.metafile.inputs).some((name) =>
    /node_modules[\\/](@firebase|firebase)[\\/]/.test(name),
  )
)
  throw new Error("Live Firebase runtime was included in fixture");
const js = built.outputFiles.find((file) => file.path.endsWith(".js")).text;
const componentCss =
  built.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
const css =
  (await fs.readFile(path.join(root, "assets/css/style.css"), "utf8")) +
  (await fs.readFile(path.join(root, "src/assets/index.css"), "utf8")).replace(
    '@import url("../../assets/css/style.css");',
    "",
  ) +
  componentCss;
const safeCss = css.replace(/@import\s+url\([^;]+;/g, "");
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Student assessment fixture</title><script src="/tailwind.js"></script><style>${safeCss}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
http
  .createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const resources = {
      "/fixture.js": ["text/javascript", js],
      "/tailwind.js": ["text/javascript", tailwind],
    };
    const [type, body] = resources[pathname] || ["text/html", html];
    response.setHeader("Content-Type", `${type};charset=utf-8`);
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval'; font-src 'self' data:",
    );
    response.end(body);
  })
  .listen(4193, "127.0.0.1", () =>
    console.log(
      "Student assessment fixture: http://127.0.0.1:4193, ?result=up|down|same|none|zero|full|previous-zero; full Runner stores synthetic attempts and uses the real comparison adapter. All data local; live Firebase runtime excluded.",
    ),
  );
