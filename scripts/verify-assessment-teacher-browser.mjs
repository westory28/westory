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
export const tree=[{id:'big-1',title:'Ⅰ. 선사 문화와 고대 국가의 형성 및 발전',children:[{id:'mid-1',title:'삼국과 가야의 성장 및 고대 국가 체제의 정비와 문화 교류',children:[{id:'lesson-1',title:'삼국의 불교 수용과 중앙 집권 체제의 강화'},{id:'lesson-2',title:'삼국과 가야의 문화 교류'}]},{id:'mid-2',title:'남북국의 발전과 통일 신라·발해의 정치 및 문화',children:[{id:'lesson-3',title:'통일 신라의 통치 체제'}]}]}];
const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="400" height="180" fill="#eff6ff"/><text x="30" y="95" font-size="24" fill="#1e3a8a">사료 이미지 · 합성 검증 자료</text></svg>');
export const questions=Array.from({length:6},(_,index)=>({id:1001+index,unitId:'mid-1',subUnitId:'lesson-1',category:'diagnostic',type:'choice',question:index?'다음 자료를 근거로 당시 왕이 추진한 정책을 고르세요.':'다음 자료에 나타난 사상을 받아들인 목적을 고르세요.',passage:'{{box:(가)}} 왕은 새로운 사상을 받아들이고 사찰과 탑을 세웠다. 왕은 이를 통해 왕권을 강화하고 중앙 집권 체제를 정비하고자 하였다.',image:index===0?svg:null,options:['왕권 강화','지방 세력의 독립','불교의 탄압','귀족회의 폐지'],choiceOptionImages:[],answer:'왕권 강화',explanation:'불교는 왕권을 뒷받침하고 사회를 통합하는 데 이용되었습니다. 사료의 왕권 강화라는 근거를 확인합니다.',hintEnabled:true,hint:'왕권과 사회 통합의 관계를 생각해 보세요.',concepts:index<4?['왕권 강화','불교 수용']:[],cognitiveProcess:index<4?'사료 해석':'',familyId:'family-1',misconceptionTags:{'지방 세력의 독립':'중앙 집권과 지방 분권의 혼동'},reviewLessonId:'lesson-1',contentRevision:1}));
export const config={year:'2026',semester:'1',currentYear:'2026',currentSemester:'1',schoolName:'합성 검증 학교'};
questions[4].subUnitId='lesson-2';questions[5].subUnitId=null;
questions.push(...['lesson-1','lesson-2',null].map((leaf,index)=>({...questions[0],id:2001+index,subUnitId:leaf,category:'formative',question:'형성평가 자료 '+(index+1)+'에 대한 설명으로 옳은 것은?',options:[...questions[0].options,'문화 교류 확대']})));
questions.push({...questions[0],id:3001,unitId:'mid-2',subUnitId:'lesson-3',question:'통일 신라의 통치 체제를 고르시오.'});
const fixtureScenario=new URLSearchParams(location.search).get('scenario');
// Deterministic confirmation for disposable local deletion/race checks only.
// Other fixture scenarios keep the production confirmation interaction.
if(fixtureScenario==='pagination-delete-delay')window.confirm=()=>true;
if(fixtureScenario?.startsWith('pagination'))questions.push(...Array.from({length:65},(_,index)=>({...questions[0],id:1007+index,subUnitId:index%3===0?'lesson-2':index%3===1?'lesson-1':null,image:null,question:'페이지 검증 문항 '+String(index+7).padStart(2,'0')+'의 설명으로 옳은 것은?',passage:index===64?'마지막 페이지의 자료 검색표적: PAGE_LAST_PASSAGE':'합성 자료 '+(index+7),explanation:index===63?'해설 검색표적: PAGE_LAST_EXPLANATION':'합성 해설 '+(index+7),concepts:index===62?['PAGE_LAST_CONCEPT']:[],options:[...questions[0].options,'문화 교류 확대']})));
export const students=[{id:'synthetic-1',data:()=>({role:'student',studentGrade:'3',studentClass:'1',studentNumber:'1',studentName:'가상학생가'})},{id:'synthetic-2',data:()=>({role:'student',studentGrade:'3',studentClass:'1',studentNumber:'2',studentName:'가상학생나'})}];
const analytics={version:1,quality:'complete',questions:Object.fromEntries(questions.map(q=>[q.id,{activeMs:22000,hiddenMs:3000,confidenceMs:2000,firstResponseMs:12000,finalResponseMs:18000,answerChangeCount:1,revisitCount:1,confidence:'sure',quality:'complete',hintViewed:q.id===1002}]))};
export const results=[{id:'synthetic-result',data:()=>({assessmentKind:'QUIZ',semesterId:'2026-1',studentUid:'synthetic-1',definitionId:'quiz:2026-1:mid-1:diagnostic',sourceId:'mid-1',category:'diagnostic',total:4,percent:25,submittedAtIso:'2026-10-15T02:00:00Z',learningSnapshot:questions.slice(0,4).map(q=>({...q,sourceRevision:"1"})),questionSnapshots:questions.slice(0,4),answerChecks:questions.slice(0,4).map((q,i)=>({id:String(q.id),correct:i===0})),answers:Object.fromEntries(questions.slice(0,4).map((q,i)=>[q.id,i===0?'왕권 강화':'지방 세력의 독립'])),analytics})}];
students.push({id:'synthetic-3',data:()=>({role:'student',studentGrade:'2',studentClass:'1',studentNumber:'3',studentName:'가상학생다'})});
results.push({id:'synthetic-result-grade2',data:()=>({...results[0].data(),studentUid:'synthetic-3',percent:75,submittedAtIso:'2026-10-15T03:00:00Z',answerChecks:questions.slice(0,4).map((q,i)=>({id:String(q.id),correct:i>0})),answers:Object.fromEntries(questions.slice(0,4).map((q,i)=>[q.id,i>0?'왕권 강화':'지방 세력의 독립']))})});
students.push({id:'synthetic-4',data:()=>({role:'student',studentGrade:'3',studentClass:'1',studentNumber:'4',studentName:'가상학생라'})});
results.push({id:'synthetic-result-third',data:()=>({...results[0].data(),studentUid:'synthetic-4',percent:50,submittedAtIso:'2026-10-15T04:00:00Z',answerChecks:questions.slice(0,4).map((q,i)=>({id:String(q.id),correct:i%2===0})),answers:Object.fromEntries(questions.slice(0,4).map((q,i)=>[q.id,i%2===0?'왕권 강화':'지방 세력의 독립']))})});
if(new URLSearchParams(location.search).get('scenario')==='multiple-forms')results.push({id:'synthetic-different-form',data:()=>{const base=results[0].data();return {...base,studentUid:'synthetic-2',total:3,percent:100/3,learningSnapshot:base.learningSnapshot.slice(0,3),questionSnapshots:base.questionSnapshots.slice(0,3),answerChecks:base.answerChecks.slice(0,3)}}});
export const fixtureState={writes:[],reads:[],questions,definitions:{},catalogReads:0,catalogEntries:0,bodyReads:0,bodyDocuments:0,bodyMaxBatch:0,bodyDocumentIds:[]};window.assessmentTeacherFixture=fixtureState;
export const db={};export const useAuth=()=>({config,userData:new URLSearchParams(location.search).get('scenario')==='readonly'?{role:'staff',staffPermissions:['quiz_read'],email:'synthetic-readonly@example.invalid'}:{role:'teacher',email:'westoria28@gmail.com'},currentUser:{uid:'synthetic-teacher',email:new URLSearchParams(location.search).get('scenario')==='readonly'?'synthetic-readonly@example.invalid':'westoria28@gmail.com'},interfaceConfig:{}});
export const doc=(_db,...parts)=>({path:parts.join('/')});export const collection=doc;export const documentId=()=>'__name__';export const where=(field,op,value)=>({field,op,value});export const orderBy=(field,direction='asc')=>({orderField:field,direction});export const limit=(count)=>({count});export const query=(ref,...constraints)=>({...ref,constraints});
const publishReadMetrics=()=>{const values={'fixture-read-count':fixtureState.reads.length,'fixture-catalog-read-count':fixtureState.catalogReads,'fixture-catalog-entry-count':fixtureState.catalogEntries,'fixture-body-read-count':fixtureState.bodyReads,'fixture-body-document-count':fixtureState.bodyDocuments,'fixture-body-max-batch':fixtureState.bodyMaxBatch,'fixture-body-document-ids':fixtureState.bodyDocumentIds.join(',')};Object.entries(values).forEach(([id,value])=>{const output=document.getElementById(id);if(output)output.textContent=String(value)})};
const recordRead=(path)=>{fixtureState.reads.push(path);publishReadMetrics()};
export const getDoc=async(ref)=>{recordRead(ref.path);const scenario=new URLSearchParams(location.search).get('scenario');if(scenario==='error'||scenario==='settings-load-error'&&ref.path.includes('assessment_config'))throw new Error('Synthetic read failure');const definition=fixtureState.definitions[ref.path.split('/').at(-1)];return {exists:()=>ref.path.includes('semester_assessment_definitions')?Boolean(definition):true,data:()=>ref.path.includes('curriculum')?{tree}:ref.path.includes('school_config')?{grades:[{value:'3',label:'3학년'},{value:'test',label:'테스트 학년'}],classes:Array.from({length:10},(_,i)=>({value:String(i+1),label:(i+1)+'반'}))}:ref.path.includes('semester_assessment_definitions')?definition:{}}};
export const getDocFromServer=getDoc;
export const getDocs=async(ref)=>{recordRead(ref.path);if(fixtureScenario==='error')throw new Error('Synthetic read failure');const bodyQuery=ref.path.endsWith('quiz_questions')&&(ref.constraints||[]).find(c=>c.field==='__name__'&&c.op==='in');if(bodyQuery){fixtureState.bodyReads++;fixtureState.bodyMaxBatch=Math.max(fixtureState.bodyMaxBatch,bodyQuery.value.length);publishReadMetrics();if(fixtureScenario==='pagination-retry'&&fixtureState.bodyReads===1)throw new Error('합성 검증: 첫 페이지 본문 조회 실패')}let docs=ref.path.endsWith('quiz_questions')?questions.map(q=>({id:String(q.id),data:()=>q})):ref.path==='users'?students:ref.path==='semester_assessment_results'?results:[];if(fixtureScenario==='empty')docs=[];(ref.constraints||[]).forEach(c=>{const fieldValue=d=>c.field==='__name__'?d.id:d.data()[c.field];if(c.field&&c.op==='==')docs=docs.filter(d=>fieldValue(d)===c.value);if(c.field&&c.op==='in')docs=docs.filter(d=>c.value.includes(fieldValue(d)));if(c.orderField)docs.sort((a,b)=>String(c.orderField==='__name__'?a.id:a.data()[c.orderField]).localeCompare(String(c.orderField==='__name__'?b.id:b.data()[c.orderField]))*(c.direction==='desc'?-1:1));if(c.count)docs=docs.slice(0,c.count)});if(bodyQuery){fixtureState.bodyDocuments+=docs.length;fixtureState.bodyDocumentIds.push(...docs.map(d=>d.id));publishReadMetrics();docs.reverse()}return {docs,empty:!docs.length,size:docs.length,forEach:fn=>docs.forEach(fn)}};
export const onSnapshot=(ref,next,error)=>{let active=true;getDocs(ref).then(s=>{if(active)next(s)}).catch(e=>{if(active)error?.(e)});return()=>{active=false}};
export const getHttpsCallable=async(name)=>async(payload)=>{if(name!=='getQuizEditorCatalog')return {data:{}};recordRead('callable:'+name);fixtureState.catalogReads++;publishReadMetrics();if(fixtureScenario==='error')throw new Error('Synthetic catalog failure');const entries=(fixtureScenario==='empty'?[]:questions.filter(q=>q.unitId===payload.unitId)).map(q=>({documentId:String(q.id),id:q.id,unitId:q.unitId,subUnitId:q.subUnitId??null,category:q.category,type:q.type,refBig:q.refBig||'',refMid:q.refMid||'',refSmall:q.refSmall||'',createdAt:0,updatedAt:0,contentRevision:q.contentRevision||0,searchText:[q.question,q.explanation,q.passage,...(q.concepts||[])].join(' ').toLowerCase()})).sort((a,b)=>a.id-b.id);fixtureState.catalogEntries+=entries.length;publishReadMetrics();return {data:{semesterId:payload.semesterId,unitId:payload.unitId,entries}}};
export const getHistoryDictionaryCallable=getHttpsCallable;
export const getAssessmentSemesterId=()=> '2026-1';export const refreshPublishedQuizDefinitions=async()=>{};
export const buildAssessmentDefinitionId=(semester,kind,source,category,round)=>[kind.toLowerCase(),semester,source,category,round].filter(Boolean).join(':');
export const saveQuizAssessmentSettings=async(config,source,category,round,title,key,settings,expectedRevision)=>{fixtureState.writes.push({command:'saveQuizAssessmentSettings',settings,expectedRevision});await new Promise(resolve=>setTimeout(resolve,750));if(new URLSearchParams(location.search).get('scenario')==='settings-save-error')throw Error('합성 검증: 저장에 실패했습니다. 변경 내용은 유지됩니다.');const id=buildAssessmentDefinitionId('2026-1','QUIZ',source,category,round);const revision=Number(expectedRevision||0)+1;fixtureState.definitions[id]={revision,presentationSettings:settings,status:settings.active?'PUBLISHED':'DRAFT',questionCount:settings.questionCount,durationSeconds:settings.timeLimit,maxAttempts:settings.allowRetake?20:1,cooldownMinutes:settings.cooldown,assignedClassIds:settings.visibleClassIds.map(id=>'class_'+id.replace('-','_'))};return {revision,status:settings.active?'PUBLISHED':'DRAFT'}};
export const executeAssessmentManagementCommand=async(command,payload)=>{fixtureState.writes.push({command,payload});if(command==='upsertQuizQuestion'){const q={...payload.question,contentRevision:Number(payload.expectedRevision||0)+1};const i=questions.findIndex(v=>String(v.id)===payload.questionId);if(i<0)questions.push(q);else questions[i]=q;return {contentRevision:q.contentRevision}}if(command==='deleteQuizQuestion'){if(fixtureScenario==='pagination-delete-delay')await new Promise(resolve=>setTimeout(resolve,8000));const i=questions.findIndex(v=>String(v.id)===payload.questionId);if(i>=0)questions.splice(i,1)}return {}};
`;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import ManageQuiz from './src/pages/teacher/ManageQuiz.tsx';import './src/assets/index.css';import './src/pages/teacher/teacherSettings.css';import QuizVisualEditorFixture from './scripts/fixtures/QuizVisualEditorFixture.tsx';createRoot(document.getElementById('root')).render(<HashRouter><div className="teacher-layout"><aside aria-label="합성 조회 계측" style={{position:"fixed",bottom:0,left:0,zIndex:100,fontSize:12,background:"white",padding:4,maxWidth:"100%"}}><span>합성 조회 <output id="fixture-read-count" aria-label="합성 조회 횟수">0</output></span>{new URLSearchParams(location.search).get('scenario')?.startsWith('pagination')&&<><span> · 목록 <output id="fixture-catalog-read-count" aria-label="목록 조회 횟수">0</output>회 / <output id="fixture-catalog-entry-count" aria-label="목록 문항 수">0</output>개</span><br/><span>본문 <output id="fixture-body-read-count" aria-label="본문 조회 횟수">0</output>회 / <output id="fixture-body-document-count" aria-label="본문 문항 수">0</output>개 / 최대 <output id="fixture-body-max-batch" aria-label="최대 본문 묶음 수">0</output>개</span><details><summary>읽은 본문 문항 번호</summary><output id="fixture-body-document-ids" aria-label="읽은 본문 문항 번호" style={{display:"block",maxWidth:350,overflowWrap:"anywhere",maxHeight:80,overflowY:"auto"}}/></details></>}</aside>{new URLSearchParams(location.search).has('editor') ? <QuizVisualEditorFixture/> : <ManageQuiz/>}</div></HashRouter>);`;
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
              /(?:^|\/)contexts\/AuthContext$|(?:^|\/)(?:lib\/)?(firebase|assessmentRelease|assessmentLifecycle|historyDictionarySession)$|^firebase\/firestore$/,
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
            filter: /\.\/StudentDetailModal$|\.\/StudentWrongNoteModal$/,
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
    scenarios: [
      "/?scenario=empty",
      "/?scenario=error",
      "/?scenario=readonly",
      "/?scenario=multiple-forms",
      "/?scenario=pagination",
      "/?scenario=pagination-retry",
      "/?scenario=pagination-delete-delay",
    ],
    checks: [
      "390/768/1280px",
      "full unit titles",
      "bank → derived editor rich content",
      "unchanged derivative rejection",
      "metadata limits",
      "unified filters, charts, student/question details",
      "keyboard modal focus and Escape",
      "71-question pagination: metadata/body counters, page cache, direct last page, failed-page retry",
    ],
    productionServices: false,
  }),
);
