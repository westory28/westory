import { build } from "esbuild";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tailwind = await fs.readFile(
  process.env.ASSESSMENT_QA_TAILWIND ||
    path.join(os.tmpdir(), "westory-assessment-qa-tailwind.js"),
  "utf8",
);
const question = {
  id: "q1",
  type: "choice",
  question:
    "자료를 읽고 조선의 중앙 정치 제도에 대한 설명으로 가장 적절한 것을 고르세요.",
  passage:
    "왕을 보좌하여 국가의 중요한 정책을 논의하였으며, 여러 관청 사이의 업무를 조정하였습니다.\n\n해당 제도가 맡았던 역할을 고려하여 각 보기의 내용과 비교해 보세요.",
  options: [
    "의정부는 높은 관직의 관리들이 모여 중요한 국가 정책을 논의하던 기관이었다.",
    "집현전은 지방의 수령을 감찰하고 군사 훈련을 지휘하는 역할을 맡았다.",
    "사헌부는 왕실 가족의 교육만을 담당하였다.",
  ],
  answer:
    "의정부는 높은 관직의 관리들이 모여 중요한 국가 정책을 논의하던 기관이었다.",
  explanation: "의정부는 국가의 주요 정책을 논의하고 왕을 보좌하던 기관입니다.",
  refBig: "big",
  refMid: "mid",
  refSmall: "leaf",
};
const results = [0, 20, 40, 60, 80, 100, null].map((score, index) => ({
  id: `attempt-${index}`,
  attemptId: `attempt-${index}`,
  studentUid: "fixture-student",
  semesterId: "2026-2",
  unitId: "mid",
  category: index === 5 ? "exam_prep" : "diagnostic",
  score,
  timestamp: { seconds: 1792033200 - index * 86400 },
  details: [
    {
      id: "q1",
      correct: score === 100,
      u: score === 100 ? question.answer : "집현전",
      questionSnapshot: index === 0 ? question : undefined,
      refBig: "big",
      refMid: "mid",
      refSmall: "leaf",
      observation:
        index === 0
          ? {
              quality: "partial",
              activeMs: 15400,
              hiddenMs: 4000,
              firstResponseMs: 4300,
              finalResponseMs: 9300,
              answerChangeCount: 1,
              revisitCount: 0,
            }
          : undefined,
    },
    { id: "q2", correct: false, u: "" },
    { id: "q3" },
  ],
}));
results.push({
  ...results[0],
  id: "legacy-mirror",
  uid: "fixture-student",
  studentUid: undefined,
});
results.push({
  ...results[0],
  id: "other-student",
  attemptId: "other-student",
  studentUid: "another-student",
});
results.push({
  ...results[0],
  id: "past-semester",
  attemptId: "past-semester",
  semesterId: "2026-1",
});
const stubs = `
import { DEFAULT_POINT_RANK_POLICY, resolvePointRankPolicy } from '${root.replaceAll("\\", "/")}/src/lib/pointRanks.ts';
const rows=${JSON.stringify(results)};
const config={year:'2026',semester:'2',showLesson:false,showQuiz:true,showScore:true};const user={uid:'fixture-student'};const userData={name:'가상 학생',grade:'3',class:'1',number:'1'};
export const useAuth=()=>({config,user,userData});
export const db={};export const collection=(...args)=>args;export const doc=(...args)=>args;export const query=(...args)=>args;export const where=(...args)=>args;export const serverTimestamp=()=>null;export const setDoc=async()=>{throw Error('Fixture writes disabled')};
export const getDoc=async(ref)=>{const key=ref.join('/');const data=key.includes('curriculum')?{tree:[{id:'big',title:'조선의 성립과 발전',children:[{id:'mid',title:'조선의 정치·사회와 문화의 발전을 자세히 살펴보는 긴 단원명',children:[{id:'leaf',title:'조선의 중앙 정치 기구와 지방 통치 제도'}]}]}]}:key==='[object Object]/users/fixture-student'?userData:null;return{exists:()=>!!data,data:()=>data}};
export const getDocs=async()=>({forEach:()=>{},docs:[],empty:true});
export const POINT_POLICY_FALLBACK={rankPolicy:resolvePointRankPolicy(DEFAULT_POINT_RANK_POLICY)};export const getPointPolicy=async()=>POINT_POLICY_FALLBACK;export const getPointRankManualAdjustEarnedPointsByUid=async()=>0;export const updateStudentProfileIcon=async()=>{throw Error('Fixture writes disabled')};export const getStudentPointWallet=async()=>null;
export const loadUserPerformanceScoreRecords=async()=>[];export const formatPerformanceScore=(value)=>String(value);export const getPerformanceScorePercent=()=>0;
let failed=false;export const loadStudentQuizResults=async()=>{await new Promise(resolve=>setTimeout(resolve,80));if(location.search.includes('error')&&!failed){failed=true;throw Error('Fixture load failure')};return location.search.includes('empty')?[]:rows};
export const loadStudentProgressSummary=async()=>({lesson:{unavailable:false,completedUnits:0,totalLessons:0,worksheetUnits:0,units:[]},quiz:{totalAttempts:7,latestScore:0,averageScore:50},historyClassroom:{totalAttempts:0,passedCount:0,averagePercent:null}});
`;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import MyPage from './src/pages/student/MyPage';import {AppToastProvider} from './src/components/common/AppToastProvider';createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/student/mypage'+(new URLSearchParams(location.search).get('attemptId')?'?menu=wrong_note&attemptId='+encodeURIComponent(new URLSearchParams(location.search).get('attemptId')):'')]}><AppToastProvider><header style={{padding:'16px',background:'white',borderBottom:'1px solid #e2e8f0'}}>위스토리 · 마이페이지 가상 기록 검증</header><MyPage/></AppToastProvider></MemoryRouter>);`;
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
      name: "no-network-mypage-fixture",
      setup(build) {
        build.onResolve(
          {
            filter:
              /firebase\/firestore$|lib\/firebase$|contexts\/AuthContext$|lib\/points$|lib\/studentWis$|lib\/performanceScores$|lib\/studentProgressSummary$/,
          },
          () => ({ path: "fixture-stubs", namespace: "fixture" }),
        );
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: stubs,
          loader: "js",
          resolveDir: root,
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
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MyPage assessment fixture</title><script src="/tailwind.js"></script><style>${safeCss}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
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
  .listen(4192, "127.0.0.1", () =>
    console.log(
      "MyPage fixture: http://127.0.0.1:4192, ?empty, ?error, ?attemptId=attempt-0 (all data local; writes disabled)",
    ),
  );
