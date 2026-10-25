/** Local browser fixture: actual notice components, synthetic data, no backend access. */
import { build } from "esbuild";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mocks = {
  state: `let mode='linked';export const config={year:2026,semester:2};export const userData={grade:3,class:1};export const setMode=value=>{mode=value};export const getNotices=()=>mode==='empty'?[]:[{id:'notice-fixture',category:mode==='exam'?'exam':mode==='reopen'?'notice':'performance',content:'알림 안내',imageUrl:'/'+(mode==='exam'||mode==='reopen'?mode:'performance')+'.webp',developerLogPostId:mode==='unlinked'?'':'performance-fixture',createdAt:null}];`,
  auth: `import {config,userData} from 'fixture:state';export const useAuth=()=>({config,userData});`,
  firebase: `export const db={};`,
  firestore: `import {getNotices} from 'fixture:state';export const collection=()=>({}),limit=()=>({}),orderBy=()=>({}),query=()=>({});export const onSnapshot=(_,next)=>{next({docs:getNotices().map(n=>({id:n.id,data:()=>n}))});return()=>{}};`,
  semester: `export const getYearSemester=config=>config;`,
  visible: `import {getNotices} from 'fixture:state';export const getStudentClassKey=()=> '3-1';export const subscribeVisibleNotices=(_db,_path,_class,next)=>{next(getNotices());return()=>{}};`,
  images: `export const NOTICE_IMAGE_RECOMMENDED_WIDTH=1600;`,
  loading: `import React from 'react';export const InlineLoading=({message})=><p>{message}</p>;`,
  modal: `import React from 'react';export default function Modal({initialNotice,onClose}){return <div role="dialog" aria-label="알림장 수정 확인"><p>{initialNotice?'선택한 알림: '+initialNotice.id:'새 알림'}</p><button onClick={onClose}>닫기</button></div>}`,
};
const fixturePlugin = {
  name: "notice-fixture",
  setup(build) {
    build.onResolve({ filter: /^fixture:/ }, (args) => ({
      path: args.path.slice(8),
      namespace: "fixture",
    }));
    build.onResolve(
      {
        filter:
          /firebase\/firestore$|lib\/firebase$|contexts\/AuthContext$|lib\/semesterScope$|lib\/visibleSchedule$|lib\/noticeImages$|common\/LoadingState$|\.\/NoticeManagerModal$/,
      },
      (args) => {
        const key =
          args.path === "firebase/firestore"
            ? "firestore"
            : args.path.endsWith("/firebase")
              ? "firebase"
              : args.path.endsWith("/AuthContext")
                ? "auth"
                : args.path.endsWith("/semesterScope")
                  ? "semester"
                  : args.path.endsWith("/visibleSchedule")
                    ? "visible"
                    : args.path.endsWith("/noticeImages")
                      ? "images"
                      : args.path.endsWith("/LoadingState")
                        ? "loading"
                        : "modal";
        return { path: key, namespace: "fixture" };
      },
    );
    build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
      contents: mocks[args.path],
      loader: "tsx",
      resolveDir: root,
    }));
  },
};
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,useLocation} from 'react-router-dom';
import NoticeBoard from './src/pages/student/components/NoticeBoard';
import TeacherNoticeBoard from './src/pages/teacher/components/TeacherNoticeBoard';
import {setMode as setFixtureMode} from 'fixture:state';
function App(){const [mode,setMode]=useState('linked');const location=useLocation();return <><nav aria-label="검증 도구">{[['linked','연결된 알림'],['unlinked','연결 없는 알림'],['empty','빈 알림'],['exam','시험범위 이미지'],['reopen','재오픈 이미지']].map(([value,label])=><button key={value} onClick={()=>{setFixtureMode(value);setMode(value)}}>{label}</button>)}</nav><output aria-live="polite">현재 경로: {location.pathname}</output><main><section aria-label="학생 알림장" className="student-portal-dashboard"><NoticeBoard key={'student-'+mode}/></section><section aria-label="교사 알림장" className="teacher-weekly-dashboard"><TeacherNoticeBoard key={'teacher-'+mode}/></section></main></>}
createRoot(document.getElementById('root')).render(<MemoryRouter><App/></MemoryRouter>);`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  plugins: [fixturePlugin],
  define: { "process.env.NODE_ENV": '"production"' },
});
const sources = await Promise.all(
  [
    "src/components/common/portalPage.css",
    "src/pages/student/studentDashboard.css",
    "src/pages/teacher/teacherDashboard.css",
  ].map((file) => fs.readFile(path.join(root, file), "utf8")),
);
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>알림장 이미지·이동 검증</title><script src="https://cdn.tailwindcss.com"></script><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"><style>${sources.join("\n")}body{margin:0;background:#f9fafb;font-family:'Noto Sans KR',sans-serif;word-break:keep-all}nav{display:flex;flex-wrap:wrap;gap:16px;padding:16px}nav button{padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:white}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;max-width:1200px;margin:24px auto;padding:16px}main>section{min-width:0;height:440px}output{display:block;padding:0 16px}[role=dialog]{position:fixed;z-index:20;inset:25% 20%;padding:24px;background:white;border:2px solid #2563eb;border-radius:12px}@media(max-width:767px){main{grid-template-columns:minmax(0,1fr);padding:16px;gap:24px}main>section{height:340px}}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
if (process.argv.includes("--check")) {
  console.log("PASS notice board fixture bundle; all data services mocked.");
  process.exit(0);
}
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (["/performance.webp", "/exam.webp", "/reopen.webp"].includes(req.url)) {
    const file = path.join(root, "output/notice-20261025", req.url.slice(1));
    res.setHeader("Content-Type", "image/webp");
    res.end(await fs.readFile(file));
    return;
  }
  res.setHeader(
    "Content-Type",
    req.url === "/fixture.js"
      ? "text/javascript;charset=utf-8"
      : "text/html;charset=utf-8",
  );
  res.end(req.url === "/fixture.js" ? bundle.outputFiles[0].text : html);
});
await new Promise((resolve) => server.listen(4342, "127.0.0.1", resolve));
console.log("Notice board fixture: http://127.0.0.1:4342");
