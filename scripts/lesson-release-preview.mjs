// Local UI smoke fixture: actual lesson components, synthetic answers only.
// Does not initialize Firebase or contact a deployed site.
import { build } from "esbuild";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createServer } from "node:http";
const output = resolve(".lesson-ui-runtime");
mkdirSync(output, { recursive: true });
const css = readdirSync("dist/assets").find((name) => /^main-.*\.css$/.test(name));
if (!css) throw new Error("Build the application before UI smoke verification.");
const fixtureSource = `
import React from 'react';
const image = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="white"/><text x="60" y="80" font-size="30">Westory lesson preview</text><path d="M60 120 H740" stroke="#cbd5e1"/><text x="60" y="250" font-size="24">1. [         ]</text><text x="60" y="430" font-size="24">Find the core point</text></svg>');
export const lesson = { unitId:'unit-one', title:'수업자료 패치 검증', contentRevision:2, contentHtml:'<p>[고려] 시대의 역사 [fn:reference]</p>', isVisibleToStudents:true,
 worksheetPageImages:[{page:1,imageUrl:image,width:800,height:1000},{page:2,imageUrl:image,width:800,height:1000}],
 worksheetBlanks:[{id:'blank-one',page:1,leftRatio:.18,topRatio:.23,widthRatio:.20,heightRatio:.055,answer:'고려'},{id:'blank-two',page:2,leftRatio:.18,topRatio:.23,widthRatio:.20,heightRatio:.055,answer:'조선'}],
 worksheetExamHighlights:[{id:'core-one',page:1,leftRatio:.15,topRatio:.40,widthRatio:.35,heightRatio:.05}],
 worksheetFootnoteAnchors:[{id:'anchor-one',footnoteId:'note-one',page:1,leftRatio:.65,topRatio:.23,widthRatio:.12,heightRatio:.06}],
 footnotes:[{id:'note-one',anchorKey:'reference',title:'이미지·글·링크 각주',label:'참고',bodyHtml:'<p>설명 글이 보입니다.</p>',imageUrl:image,contentType:'image',linkUrl:'https://example.com/lesson',order:0}] };
const key='westory-local-lesson-smoke';
export const state={ fail:false, slow:false, unit:'unit-one', user:'student-smoke', saves:0 };
const saved = () => JSON.parse(localStorage.getItem(key)||'{}');
const store = value => localStorage.setItem(key,JSON.stringify(value));
export const config={year:'2026',semester:'2'};
export const auth={currentUser:{uid:'student-smoke'}};
export const db={};
export const useAuth=()=>({config,currentUser:{uid:state.user},userData:{role:'student'}});
export const useAppToast=()=>({showToast:value=>{document.getElementById('test-toast').textContent=value.title+' · '+value.message;}});
export const doc=(_db,path,...parts)=>({path:[path,...parts].join('/')});
export const collection=doc;
export const getDoc=async ref=>{const data=ref.path.endsWith('/units/unit-one')?saved():ref.path.endsWith('/units/unit-two')?{}:{corePointRewardClaimed:Boolean(saved().corePointRewardClaimed)}; return {exists:()=>Object.keys(data).length>0,data:()=>data};};
export const getDocs=async()=>({docs:[{id:'unit-one',data:saved}]});
export const readStudentLesson=async(_config,unitId)=>({...lesson,unitId,title:unitId==='unit-one'?lesson.title:'다른 단원'});
export const readStudentVisibleLessons=async()=>[lesson];
export const saveLessonAnswers=async input=>{
 state.saves++; await new Promise(resolve=>setTimeout(resolve,state.slow?1800:150));
 if(state.fail)throw new Error('검증용 저장 실패: 입력은 유지됩니다.');
 const before=saved(); if((before.answerRevision||0)!==input.expectedAnswerRevision) throw new Error('다른 창의 저장과 충돌했습니다.');
 const answers=Object.fromEntries(Object.entries(input.answers).map(([id,value])=>[id,{value,status:value===(id==='blank-two'?'조선':'고려')?'correct':'wrong'}]));
 const result={unitId:input.unitId,answerRevision:(before.answerRevision||0)+1,answers,contentRevision:2,correctCount:Object.values(answers).filter(item=>item.status==='correct').length,totalCount:Object.keys(answers).length};
 if(input.unitId==='unit-one') store({...before,...result}); return result;
};
export const recordLessonCorePointFind=async(_config,input)=>{const data=saved();store({...data,corePointFinds:['core-one']});return {result:{unitId:'unit-one',corePointId:'core-one',foundCount:1,totalCount:1,settled:true}};};
export const claimLessonCorePointReward=async()=>{store({...saved(),corePointRewardClaimed:true});return {result:{awarded:true,settled:true,totalAwarded:500,amount:500}};};
export const getFirebaseStorage=async()=>({}); export const ref=(_storage,path)=>({path}); export const getDownloadURL=async()=>image;
export const lazyWithRetry=(load)=>React.lazy(load);
`;
const fixturePath = join(output, "fixture.tsx");
writeFileSync(fixturePath, fixtureSource);
const entry = `
import React,{useState,Suspense} from 'react'; import {createRoot} from 'react-dom/client';
import LessonContent from '../src/pages/student/lesson/components/LessonContent';
import TeacherLessonPresentation from '../src/pages/teacher/components/TeacherLessonPresentation';
import {lesson,state} from './fixture';
function App(){const [teacher,setTeacher]=useState(false);const [unit,setUnit]=useState('unit-one');const [key,setKey]=useState(0);return <>
<div style={{padding:12,background:'#e0f2fe',display:'flex',gap:12,flexWrap:'wrap'}}><strong>로컬 검증 화면 · 실제 데이터 연결 없음</strong><button onClick={()=>setTeacher(!teacher)}>학생/교사 전환</button><button onClick={()=>setKey(key+1)}>다시 열기</button><button onClick={()=>setUnit(unit==='unit-one'?'unit-two':'unit-one')}>단원 전환</button><label><input type="checkbox" onChange={e=>state.fail=e.target.checked}/>저장 실패 재현</label><label><input type="checkbox" onChange={e=>state.slow=e.target.checked}/>느린 저장 재현</label></div>
<div id="test-toast" role="status" style={{padding:8}}></div><main style={{maxWidth:1200,margin:'auto'}}><Suspense fallback="불러오는 중">{teacher?<TeacherLessonPresentation lesson={lesson}/>:<LessonContent key={key} unitId={unit}/>}</Suspense></main></>};
createRoot(document.getElementById('root')).render(<App/>);
`;
writeFileSync(join(output, "entry.tsx"), entry);
const result = await build({ entryPoints: [join(output, "entry.tsx")], outfile: join(output, "bundle.js"), bundle: true, platform: "browser", format: "iife", metafile: true, define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "isolated-lesson-fixture", setup(api) { api.onResolve({ filter: /AuthContext$|AppToastProvider$|studentLessonReadCache$|lessonAnswers$|lessonCorePointReward$|lazyWithRetry$|\/lib\/firebase$|firebase\/(firestore|storage)$/ }, () => ({ path: fixturePath })); } }] });
assertNoFirebase(result.metafile);
function assertNoFirebase(metafile) { if (Object.keys(metafile.inputs).some((name) => /src\/lib\/firebase\.ts$|node_modules\/@firebase\//.test(name.replaceAll('\\','/')))) throw new Error("The local UI fixture must not include Firebase networking."); }
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><title>Westory 수업자료 로컬 검증</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;
const server = createServer((request, response) => {
  const routes = { "/": ["text/html; charset=utf-8", html], "/bundle.js": ["text/javascript", readFileSync(join(output, "bundle.js"))], "/app.css": ["text/css", readFileSync(join("dist/assets", css))] };
  const route = routes[request.url];
  response.writeHead(route ? 200 : 404, { "Content-Type": route?.[0] || "text/plain", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self' data: blob:; connect-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; frame-src 'none'" });
  response.end(route?.[1] || "Not found");
});
server.listen(4318, "127.0.0.1", () => console.log("Local synthetic lesson preview: http://127.0.0.1:4318"));
