/** Real MainLayout + Footer with isolated authentication and external I/O. */
import { build } from "esbuild";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const developerSource = await fs.readFile(
  path.join(root, "src/pages/DeveloperLog.tsx"),
  "utf8",
);
const developerAst = ts.createSourceFile(
  "DeveloperLog.tsx",
  developerSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const articleParts = new Map();
const visit = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    [
      "renderPostDetail",
      "hasEventArticleMarkup",
      "EventArticleEditor",
    ].includes(node.name.text)
  )
    articleParts.set(node.name.text, `const ${node.getText(developerAst)};`);
  ts.forEachChild(node, visit);
};
visit(developerAst);
if (articleParts.size !== 3)
  throw new Error("Actual DeveloperLog render/editor not found");
const articleHtml = await fs
  .readFile(path.join(root, "output/notice-20261025/exam.html"), "utf8")
  .then((html) => html.replaceAll("{{HERO}}", "/exam.webp"))
  .catch(
    () =>
      '<article class="westory-event-article"><h2>긴 공지</h2><p>본문 확인</p></article>',
  );
const mocks = {
  auth: `const teacher={uid:'fixture',role:'teacher',email:'fixture@example.invalid'},student={...teacher,role:'student'};let role='teacher';const common={currentUser:{uid:'fixture',email:'fixture@example.invalid'},loading:false,authPhase:'ready',configReady:true,menuConfigReady:true,settingsLoadedAt:Date.now(),refreshConfig:async()=>{},refreshMenuConfig:async()=>{},config:{year:2026,semester:2},menuConfig:{},interfaceConfig:{}};export const setRole=value=>role=value;export const useAuth=()=>({...common,userData:role==='teacher'?teacher:student});`,
  header: `import React from 'react';export default ()=> <header className="teacher-account-header"><div className="header-container">위스토리 검증</div></header>;`,
  firebase: `export const db={};`,
  firestore: `export const doc=()=>({}),getDoc=async()=>({exists:()=>false});`,
  toast: `export const useAppToast=()=>({showToast:()=>{}});`,
  storage: `export const readStorage=()=>null;`,
  perf: `export const markLoginPerf=()=>{},measureLoginPerf=()=>{};`,
  tasks: `export const runAfterNextPaint=callback=>{callback();return()=>{}};`,
  lazy: `export const lazyWithRetry=()=>()=>null;`,
  archive: `export const isSemesterArchive=false;`,
  boundary: `export const SemesterArchiveBanner=()=>null,SemesterArchiveUnavailable=()=>null,isArchiveUnavailableRoute=()=>false;`,
  access: `export const getStudentRouteAccess=()=>({allowed:true}),isStudentVisibilityControlledPath=()=>false;`,
  permissions: `export const canAccessTeacherPortal=user=>user?.role==='teacher',canAccessTeacherPath=()=>true,getDefaultTeacherRoute=()=>'/teacher/dashboard',isAdminUser=()=>false;`,
  empty: `export default ()=>null;export const PageLoading=()=>null,InlineLoading=()=>null;`,
};
const resolveMock = (input) =>
  input === "firebase/firestore"
    ? "firestore"
    : input.endsWith("/AuthContext")
      ? "auth"
      : input.endsWith("/Header")
        ? "header"
        : input.endsWith("/firebase")
          ? "firebase"
          : input.endsWith("/AppToastProvider")
            ? "toast"
            : input.endsWith("/safeStorage")
              ? "storage"
              : input.endsWith("/loginPerf")
                ? "perf"
                : input.endsWith("/browserTasks")
                  ? "tasks"
                  : input.endsWith("/lazyWithRetry")
                    ? "lazy"
                    : input.endsWith("/semesterArchive")
                      ? "archive"
                      : input.endsWith("/SemesterArchiveBoundary")
                        ? "boundary"
                        : input.endsWith("/studentMenuAccess")
                          ? "access"
                          : input.endsWith("/permissions")
                            ? "permissions"
                            : input.endsWith("/LoadingState") ||
                                input.endsWith("/AuthRecoveryState") ||
                                input.endsWith("Controller")
                              ? "empty"
                              : null;
const entry = `
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,useLocation,useNavigate} from 'react-router-dom';
import MainLayout from './src/components/layout/MainLayout';
import PortalWorkspace from './src/components/common/PortalWorkspace';
import {setRole} from 'fixture:auth';
${articleParts.get("hasEventArticleMarkup")}
${articleParts.get("EventArticleEditor")}
const activeCardImageIndex=0,liked=false,canManage=false,cardSwipeStartRef={current:null};
const renderCategoryBadge=()=>null,getDisplayTitle=p=>p.title,formatDate=()=> '2026.10.25';
const toggleLike=()=>{},navigate=()=>{},startEdit=()=>{},deletePost=()=>{},moveCardImage=()=>{},setActiveCardImageIndex=()=>{},handleCardSwipeStart=()=>{},handleCardSwipeEnd=()=>{};
${articleParts.get("renderPostDetail")}
const sourceHtml=${JSON.stringify(articleHtml)};
function App(){
 const[role,updateRole]=useState('teacher'),[long,setLong]=useState(true),[editing,setEditing]=useState(false),[html,setHtml]=useState(sourceHtml);
 const location=useLocation(),navigate=useNavigate();
 const workspace=location.pathname.includes('/workspace');
 const post={id:'fixture',title:'실제 시험범위 공지 검증',summary:'시험범위와 준비 사항',version:'',category:'notice',images:[],isPinned:false,viewCount:0,likeCount:0,createdByName:'검증 교사',bodyHtml:long?html.repeat(3):html};
 return <><nav className="fixture-tools">{['teacher','student'].map(value=><button key={value} onClick={()=>{setRole(value);updateRole(value);navigate('/developer-log/fixture')}}>{value==='teacher'?'교사 화면':'학생 화면'}</button>)}<button onClick={()=>navigate('/'+role+'/workspace')}>작업 화면</button><button onClick={()=>navigate('/developer-log/fixture')}>개발자 일지로 이동</button><button onClick={()=>setLong(!long)}>긴 글 전환</button><button onClick={()=>setEditing(!editing)}>{editing?'미리보기':'본문 편집'}</button><button onClick={()=>document.querySelector('footer')?.scrollIntoView({block:'end'})}>푸터로 이동</button></nav><output>{location.pathname}</output><MainLayout key={role}>{workspace?<PortalWorkspace className="teacher-sub-workspace teacher-sub-workspace--tabs"><div className="teacher-sub-workspace-content ws-page"><h1>작업 화면</h1><p>내부 푸터 등록 상태를 확인합니다.</p></div></PortalWorkspace>:<div className="ws-page developer-log-page">{editing?<EventArticleEditor value={html} onChange={setHtml}/>:renderPostDetail(post,true)}<p data-article-end>본문 끝</p></div>}</MainLayout></>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><MemoryRouter initialEntries={['/teacher/workspace']}><App/></MemoryRouter></React.StrictMode>);`;
const result = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "fixture",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          const name = args.path.startsWith("fixture:")
            ? args.path.slice(8)
            : resolveMock(args.path);
          if (name) return { path: name, namespace: "fixture" };
          if (args.path.endsWith(".css"))
            return { path: args.path, namespace: "ignore-css" };
        });
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: mocks[args.path],
          loader: "tsx",
          resolveDir: root,
        }));
        builder.onLoad({ filter: /.*/, namespace: "ignore-css" }, () => ({
          contents: "",
          loader: "js",
        }));
      },
    },
  ],
});
const css = await Promise.all(
  [
    "assets/css/style.css",
    "src/components/layout/teacherLayout.css",
    "src/components/layout/studentLayout.css",
    "src/components/common/Footer.css",
    "src/components/common/portalSubNavigation.css",
    "src/components/common/portalPage.css",
    "src/assets/index.css",
    "src/pages/developerEventArticles.css",
  ].map((file) => fs.readFile(path.join(root, file), "utf8")),
);
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>포털 긴 글 푸터 검증</title><script src="https://cdn.tailwindcss.com"></script><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"><style>${css.join("\n")}.fixture-tools{display:flex;flex-wrap:wrap;gap:8px;padding:8px}.fixture-tools button{padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:white}h1{font-size:28px;font-weight:800}h2{font-size:22px;font-weight:700}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
if (process.argv.includes("--check")) {
  console.log("PASS portal footer fixture bundle; no production data access.");
  process.exit(0);
}
http
  .createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/exam.webp") {
      res.setHeader("Content-Type", "image/webp");
      res.end(
        await fs.readFile(path.join(root, "output/notice-20261025/exam.webp")),
      );
      return;
    }
    res.setHeader(
      "Content-Type",
      req.url === "/fixture.js"
        ? "text/javascript;charset=utf-8"
        : "text/html;charset=utf-8",
    );
    res.end(req.url === "/fixture.js" ? result.outputFiles[0].text : html);
  })
  .listen(4343, "127.0.0.1", () =>
    console.log("Footer fixture: http://127.0.0.1:4343"),
  );
