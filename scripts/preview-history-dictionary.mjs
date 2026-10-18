/** Real dictionary UI with in-memory fixtures. No Firebase connection or live writes.
 * node scripts/preview-history-dictionary.mjs
 * ?mode=student|floating|teacher&width=390|768|1280
 * Optional: &empty=1&listError=1&saveError=1&lookupError=1&delay=1000
 * Browser interaction is intentionally left to the approved browser tool.
 */
import { build } from "esbuild";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stubs = `
const params=new URLSearchParams(location.search);
const config={year:'2026',semester:'2'};
const currentUser={uid:'dictionary-fixture',email:'fixture@example.invalid'};
export const useAuth=()=>({config,configReady:true,currentUser,userData:{uid:currentUser.uid,role:params.get('mode')==='teacher'?'teacher':'student'}});
export const canWriteLessonManagement=()=>params.get('readonly')!=='1';
export const useAppToast=()=>({showToast:(value)=>{document.getElementById('qa-feedback').textContent=value.title+' '+(value.message||'')}});
export const getHistoryDictionaryErrorMessage=(error)=>error.message||'잠시 후 다시 시도해 주세요.';
export const normalizeHistoryDictionaryWord=(value)=>value.trim().replace(/\\s+/g,' ').toLowerCase();
const saved=(word,definition,status='saved')=>({id:'word-'+word,termId:'term-'+word,word,normalizedWord:normalizeHistoryDictionaryWord(word),definition,status,uid:currentUser.uid});
let words=params.has('empty')?[]:[saved('율령','나라를 다스리기 위해 정한 법과 제도'),saved('집현전','세종 때 학문 연구와 정책 자문을 맡던 기관')];
const listeners=new Set();let listFailed=false,saveFailed=false,lookupFailed=false;
const delay=()=>new Promise(resolve=>setTimeout(resolve,Number(params.get('delay')||300)));
const notify=()=>listeners.forEach(listener=>listener([...words]));
const trace=(action,payload)=>{const output=document.getElementById('qa-calls');output.textContent=JSON.stringify({action,...payload})};
export const subscribeStudentHistoryDictionaryWords=(uid,onData,config,onError)=>{listeners.add(onData);const timer=setTimeout(()=>{if(params.has('listError')&&!listFailed){listFailed=true;onError(Error('연결을 확인하고 다시 불러와 주세요.'));return;}onData([...words])},300);return()=>{clearTimeout(timer);listeners.delete(onData)}};
export const saveStudentHistoryDictionaryEntry=async(input)=>{trace('save-own',input);await delay();if(params.has('saveError')&&!saveFailed){saveFailed=true;throw Error('저장하지 못했습니다. 입력 내용은 유지됩니다. 다시 저장해 주세요.')}words=words.filter(item=>item.normalizedWord!==normalizeHistoryDictionaryWord(input.word));words.push(saved(input.word,input.definition));notify();return {reward:{awarded:true,amount:2}}};
export const deleteStudentHistoryDictionaryWord=async(config,termId)=>{trace('delete',{termId});await delay();words=words.filter(item=>item.termId!==termId);notify();return {reward:{reclaimed:true,amount:2}}};
export const loadPublishedHistoryDictionaryTerm=async(word)=>{trace('lookup',{word});await delay();if(params.has('lookupError')&&!lookupFailed){lookupFailed=true;throw Error('뜻풀이를 불러오지 못했습니다. 다시 확인해 주세요.')}return word==='율령'?{id:'teacher-term',word,definition:'국가가 백성을 다스리기 위해 마련한 법과 행정 규정.',status:'published'}:null};
export const saveStudentHistoryDictionaryWord=async()=>{trace('save-teacher',{});await delay();words=words.filter(item=>item.word!=='율령');words.push(saved('율령','국가가 백성을 다스리기 위해 마련한 법과 행정 규정.'));notify();return {}};
export const requestHistoryDictionaryTerm=async(config,input)=>{trace('request',input);await delay();words=words.filter(item=>item.normalizedWord!==normalizeHistoryDictionaryWord(input.word));words.push(saved(input.word,'','requested'));notify();return {}};
export const subscribeTeacherHistoryDictionaryTerms=(onData,onError)=>{const timers=[setTimeout(()=>onData([{id:'term1',word:'율령',normalizedWord:'율령',definition:'국가가 백성을 다스리기 위해 마련한 법과 행정 규정.',status:'published',tags:[],studentLevel:'중학생 수준'}]),100)];if(params.has('listError')&&!listFailed){listFailed=true;timers.push(setTimeout(()=>onError(Error('연결을 확인하고 다시 불러와 주세요.')),800));}return()=>timers.forEach(clearTimeout)};
export const subscribeTeacherHistoryDictionaryRequests=(onData)=>{const timer=setTimeout(()=>onData([]),100);return()=>clearTimeout(timer)};
export const loadTeacherStudentHistoryDictionaryWords=async()=>words;
export const loadTeacherHistoryDictionaryTerms=async()=>[];
export const loadNotifications=async()=>[];
export const approveHistoryDictionaryTermForRequests=async()=>({});
export const deleteStudentHistoryDictionaryWordByTeacher=async()=>({});
export const saveHistoryDictionaryTerm=async()=>({});
export const saveHistoryDictionaryTermsBulk=async()=>({});
export const updateStudentHistoryDictionaryWordByTeacher=async()=>({});
`;
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import Student from './src/pages/student/lesson/HistoryDictionary';
import Floating from './src/components/common/StudentHistoryDictionaryController';
import Teacher from './src/pages/teacher/ManageHistoryDictionary';
import './src/components/layout/studentLayout.css';
const params=new URLSearchParams(location.search);const mode=params.get('mode')||'student';
const width=Number(params.get('width')||1280);
document.documentElement.style.setProperty('--fixture-width',width+'px');
function Fixture(){return <MemoryRouter initialEntries={[mode==='teacher'?'/teacher/lesson/history-dictionary?panel='+(params.get('panel')||'terms'):'/student/dashboard']}><div className="student-layout">{mode==='teacher'?<Teacher/>:mode==='floating'?<><h1 className="p-6 text-xl font-bold">가상 학생 학습 화면</h1><p className="px-6">오른쪽 아래 사전 버튼을 누르세요.</p><Floating/></>:<Student/>}</div></MemoryRouter>}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const compiled = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  outdir: "dictionary-fixture",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "dictionary-fixture-services",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /(AuthContext|AppToastProvider|\/lib\/historyDictionary$|\/lib\/historyDictionarySession$|\/lib\/permissions$|\/lib\/notifications$)/,
          },
          () => ({ path: "dictionary-services", namespace: "fixture" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: stubs,
          loader: "js",
        }));
      },
    },
  ],
});
const js = compiled.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css =
  compiled.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
const appCss = await fs.readFile(
  path.join(root, "src/assets/index.css"),
  "utf8",
);
const legacyCss = await fs.readFile(
  path.join(root, "assets/css/style.css"),
  "utf8",
);
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>위스토리 사전 검증</title><script src="https://cdn.tailwindcss.com"></script><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;font-family:'Noto Sans KR',sans-serif;background:#f8fafc}#root{width:min(100%,var(--fixture-width));margin:0 auto}#qa-feedback,#qa-calls{max-width:var(--fixture-width);margin:8px auto;font-size:12px;overflow-wrap:anywhere}body:has(.history-dictionary-dialog[open]) #root{width:100%}</style></head><body><div id="root"></div><output id="qa-feedback" aria-live="polite"></output><output id="qa-calls"></output><script type="module" src="/fixture.js"></script></body></html>`;
const server = http.createServer((request, response) => {
  const route = request.url?.split("?")[0];
  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Type",
    route === "/fixture.js"
      ? "text/javascript; charset=utf-8"
      : route === "/fixture.css"
        ? "text/css; charset=utf-8"
        : "text/html; charset=utf-8",
  );
  response.end(
    route === "/fixture.js"
      ? js
      : route === "/fixture.css"
        ? legacyCss + "\n" + appCss.replace(/@import[^;]+;/g, "") + "\n" + css
        : html,
  );
});
server.listen(Number(process.env.DICTIONARY_QA_PORT || 4319), "127.0.0.1", () =>
  console.log(
    `Dictionary fixture: http://127.0.0.1:${server.address().port}/?mode=student&width=390 (student/floating/teacher; in-memory only)`,
  ),
);
