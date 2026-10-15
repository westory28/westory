/** Serves the real teacher assessment UI with synthetic local services only.
 * Open the printed localhost URL with CUA at 390, 768 and 1280px.
 * No browser automation or production credentials are used by this fixture.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const tailwindPath =
  process.env.ASSESSMENT_QA_TAILWIND ||
  path.join(os.tmpdir(), "westory-assessment-qa-tailwind.js");
const tailwind = await fs.readFile(tailwindPath, "utf8");
const service = `
export const tree=[{id:'big-1',title:'Ⅰ. 선사 문화와 고대 국가의 형성 및 발전',children:[{id:'mid-1',title:'삼국과 가야의 성장 및 고대 국가 체제의 정비와 문화 교류',children:[{id:'lesson-1',title:'삼국의 불교 수용과 중앙 집권 체제의 강화'}]},{id:'mid-2',title:'남북국의 발전과 통일 신라·발해의 정치 및 문화'}]}];
const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="400" height="180" fill="#eff6ff"/><text x="30" y="95" font-size="24" fill="#1e3a8a">사료 이미지 · 합성 검증 자료</text></svg>');
export const questions=Array.from({length:6},(_,index)=>({id:1001+index,unitId:'mid-1',subUnitId:'lesson-1',category:'diagnostic',type:'choice',question:index?'다음 자료를 근거로 당시 왕이 추진한 정책을 고르세요.':'다음 자료에 나타난 사상을 받아들인 목적을 고르세요.',passage:'{{box:(가)}} 왕은 새로운 사상을 받아들이고 사찰과 탑을 세웠다. 왕은 이를 통해 왕권을 강화하고 중앙 집권 체제를 정비하고자 하였다.',image:index===0?svg:null,options:['왕권 강화','지방 세력의 독립','불교의 탄압','귀족회의 폐지'],choiceOptionImages:[],answer:'왕권 강화',explanation:'불교는 왕권을 뒷받침하고 사회를 통합하는 데 이용되었습니다. 사료의 왕권 강화라는 근거를 확인합니다.',hintEnabled:true,hint:'왕권과 사회 통합의 관계를 생각해 보세요.',concepts:index<4?['왕권 강화','불교 수용']:[],cognitiveProcess:index<4?'사료 해석':'',familyId:'family-1',misconceptionTags:{'지방 세력의 독립':'중앙 집권과 지방 분권의 혼동'},reviewLessonId:'lesson-1',contentRevision:1}));
export const config={year:'2026',semester:'1',currentYear:'2026',currentSemester:'1',schoolName:'합성 검증 학교'};
export const students=[{id:'synthetic-1',data:()=>({role:'student',studentGrade:'3',studentClass:'1',studentNumber:'1',studentName:'가상학생가'})},{id:'synthetic-2',data:()=>({role:'student',studentGrade:'3',studentClass:'1',studentNumber:'2',studentName:'가상학생나'})}];
const analytics={version:1,quality:'complete',questions:Object.fromEntries(questions.map(q=>[q.id,{activeMs:22000,hiddenMs:3000,confidenceMs:2000,firstResponseMs:12000,finalResponseMs:18000,answerChangeCount:1,revisitCount:1,confidence:'sure',quality:'complete',hintViewed:q.id===1002}]))};
export const results=[{id:'synthetic-result',data:()=>({assessmentKind:'QUIZ',semesterId:'2026-1',studentUid:'synthetic-1',definitionId:'quiz:2026-1:mid-1:diagnostic',sourceId:'mid-1',category:'diagnostic',percent:25,submittedAtIso:'2026-10-15T02:00:00Z',learningSnapshot:questions.slice(0,4),answerChecks:questions.slice(0,4).map((q,i)=>({id:String(q.id),correct:i===0})),answers:Object.fromEntries(questions.slice(0,4).map((q,i)=>[q.id,i===0?'왕권 강화':'지방 세력의 독립'])),analytics})}];
export const fixtureState={writes:[],questions};window.assessmentTeacherFixture=fixtureState;
export const db={};export const useAuth=()=>({config,userData:{role:'teacher',email:'westoria28@gmail.com'},currentUser:{uid:'synthetic-teacher',email:'westoria28@gmail.com'},interfaceConfig:{}});
export const doc=(_db,...parts)=>({path:parts.join('/')});export const collection=doc;export const where=(field,op,value)=>({field,op,value});export const orderBy=()=>({});export const limit=()=>({});export const query=(ref,...constraints)=>({...ref,constraints});
export const getDoc=async(ref)=>{if(new URLSearchParams(location.search).get('scenario')==='error')throw new Error('Synthetic read failure');return {exists:()=>true,data:()=>ref.path.includes('curriculum')?{tree}:{}}};
export const getDocs=async(ref)=>{if(new URLSearchParams(location.search).get('scenario')==='error')throw new Error('Synthetic read failure');let docs=ref.path.endsWith('quiz_questions')?questions.map(q=>({id:String(q.id),data:()=>q})):ref.path==='users'?students:ref.path==='semester_assessment_results'?results:[];if(new URLSearchParams(location.search).get('scenario')==='empty')docs=[];(ref.constraints||[]).forEach(c=>{if(c.field&&c.op==='==')docs=docs.filter(d=>d.data()[c.field]===c.value)});return {docs,empty:!docs.length,size:docs.length,forEach:fn=>docs.forEach(fn)}};
export const onSnapshot=(ref,next,error)=>{let active=true;getDocs(ref).then(s=>{if(active)next(s)}).catch(e=>{if(active)error?.(e)});return()=>{active=false}};
export const getHttpsCallable=async()=>async()=>({data:{}});
export const getAssessmentSemesterId=()=> '2026-1';export const refreshPublishedQuizDefinitions=async()=>{};
export const executeAssessmentManagementCommand=async(command,payload)=>{fixtureState.writes.push({command,payload});if(command==='upsertQuizQuestion'){const q={...payload.question,contentRevision:Number(payload.expectedRevision||0)+1};const i=questions.findIndex(v=>String(v.id)===payload.questionId);if(i<0)questions.push(q);else questions[i]=q;return {contentRevision:q.contentRevision}}return {}};
`;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import ManageQuiz from './src/pages/teacher/ManageQuiz.tsx';import './src/assets/index.css';createRoot(document.getElementById('root')).render(<HashRouter><div className="teacher-layout"><ManageQuiz/></div></HashRouter>);`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "browser",
  outfile: path.join(os.tmpdir(), "assessment-teacher-fixture.js"),
  loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "assessment-local-services",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/(firebase|assessmentRelease|assessmentLifecycle)$|^firebase\/firestore$/,
          },
          (args) => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "ts",
          resolveDir: root,
        }));
        plugin.onResolve(
          {
            filter:
              /\.\/components\/QuizSettingsModal$|\.\/StudentDetailModal$|\.\/StudentWrongNoteModal$/,
          },
          () => ({ path: "modal", namespace: "empty-fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "empty-fixture" }, () => ({
          contents: "export default function Empty(){return null}",
          loader: "js",
        }));
      },
    },
  ],
});
if (
  Object.keys(bundle.metafile.inputs).some((name) =>
    /node_modules[\\/](@firebase|firebase)[\\/]/.test(name),
  )
)
  throw new Error("Live Firebase runtime was included in fixture");
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+url\([^;]+;/g, "");
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>평가 관리 · 합성 데이터 검증</title><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}.teacher-layout{padding:0!important}.teacher-sub-workspace--page{margin:0!important;min-height:100vh}#root{width:100%}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const files = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  };
  const [type, body] = files[pathname] || ["text/html", html];
  res.setHeader("Content-Type", `${type};charset=utf-8`);
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval'; font-src 'self' data:",
  );
  res.end(body);
});
await new Promise((resolve) =>
  server.listen(
    Number(process.env.ASSESSMENT_QA_PORT || 4318),
    "127.0.0.1",
    resolve,
  ),
);
console.log(
  JSON.stringify({
    origin: `http://127.0.0.1:${server.address().port}`,
    scenarios: ["/?scenario=empty", "/?scenario=error"],
    checks: [
      "390/768/1280px",
      "full unit titles",
      "bank → derived editor rich content",
      "unchanged derivative rejection",
      "metadata limits",
      "student evidence and raw observation",
      "keyboard modal focus and Escape",
    ],
    productionServices: false,
  }),
);
