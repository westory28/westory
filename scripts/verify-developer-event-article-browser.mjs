/** Local-only fixture for authored event articles and lossless text editing. */
import { build } from "esbuild";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = await fs.readFile(
  path.join(root, "src/pages/DeveloperLog.tsx"),
  "utf8",
);
const ast = ts.createSourceFile(
  "DeveloperLog.tsx",
  file,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const names = new Set([
  "hasEventArticleMarkup",
  "EventArticleEditor",
  "renderPostDetail",
]);
const pieces = new Map();
let listMarkup = "";
const visit = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    names.has(node.name.text)
  ) {
    pieces.set(node.name.text, `const ${node.getText(ast)};`);
  }
  if (
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(ast) === "section" &&
    node.getText(ast).includes('className="developer-log-toolbar"')
  )
    listMarkup = node.getText(ast);
  ts.forEachChild(node, visit);
};
visit(ast);
if (pieces.size !== names.size)
  throw new Error("Missing actual article/editor implementation");
const cssSource = await fs.readFile(
  path.join(root, "src/assets/index.css"),
  "utf8",
);
const cssStart = cssSource.indexOf(
  ".policy-rich-text,\n".replace(
    "\n",
    cssSource.includes("\r\n") ? "\r\n" : "\n",
  ),
);
const cssEnd = cssSource.indexOf("@media (max-width: 1023px)", cssStart);
if (cssStart < 0 || cssEnd < 0) throw new Error("Missing article styles");
const articleCss = cssSource.slice(cssStart, cssEnd);
const portalCss = await fs.readFile(
  path.join(root, "src/components/common/portalPage.css"),
  "utf8",
);
const assets = await fs.readdir(path.join(root, "dist/assets")).catch(() => []);
const builtCssFile = assets.find((name) => /^main-.*\.css$/.test(name));
const builtCss = builtCssFile
  ? await fs.readFile(path.join(root, "dist/assets", builtCssFile), "utf8")
  : "";
const actualArticles = await Promise.all(
  ["performance", "exam"].map(async (name) => [
    name,
    await fs
      .readFile(path.join(root, `output/notice-20261025/${name}.html`), "utf8")
      .then((html) => html.replaceAll("{{HERO}}", `/${name}.webp`))
      .catch(() => null),
  ]),
);
const entry = `
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
${pieces.get("hasEventArticleMarkup")}
${pieces.get("EventArticleEditor")}
const source='<article class="westory-event-article"><figure><img src="/banner.png" width="1200" height="675" alt="수행평가 안내 이미지"></figure><h2>반별 수행평가 일정</h2><p>핵심 범위 <strong>붕당 · 여씨향약</strong></p><div class="westory-event-table" role="region" aria-label="반별 수행평가 일정" tabindex="0"><table><thead><tr><th scope="col">학급</th><th scope="col">날짜</th><th scope="col">교시</th></tr></thead><tbody><tr><td>3학년 1반</td><td>10월 30일(금)</td><td>5교시</td></tr><tr><td>3학년 10반</td><td>10월 29일(목)</td><td>4교시</td></tr></tbody></table></div><h2>준비 사항</h2><ul><li>검정색 볼펜을 준비해 주세요.</li><li>위스토리 문제 많이 풀기</li></ul><blockquote><p><strong>꼭 확인해 주세요</strong></p><p>평가 일정과 핵심 범위를 확인합니다.</p></blockquote></article>';
const base={id:'fixture',title:'역사 수행평가 안내',summary:'수행평가의 일정과 준비 사항입니다.',version:'',category:'notice',images:[],isPinned:false,viewCount:0,likeCount:0,createdByName:'검증 교사'};
const activeCardImageIndex=0,liked=false,canManage=false,cardSwipeStartRef={current:null};
const renderCategoryBadge=()=>null,getDisplayTitle=p=>p.title,formatDate=()=> '2026.10.25';
const Link=({to,...props})=><a href={to} {...props}/>;
const DEVELOPER_LOG_CATEGORIES=[{value:'notice',label:'공지사항'},{value:'update',label:'업데이트'},{value:'fix',label:'수정사항'}];
const toggleLike=()=>{},navigate=()=>{},startEdit=()=>{},deletePost=()=>{},moveCardImage=()=>{},setActiveCardImageIndex=()=>{},handleCardSwipeStart=()=>{},handleCardSwipeEnd=()=>{};
${pieces.get("renderPostDetail")}
function ListFixture(){const [categoryFilter,setCategoryFilter]=useState('all'),[searchText,setSearchText]=useState(''),[sortMode,setSortMode]=useState('latest');const listLoading=false;const filteredPosts=[{...base,id:'performance',isPinned:true,title:'관심사와 연결한 나만의 붕당 정치 전개도 만들기 — 반별 수행평가 일정과 준비 사항',summary:'붕당과 여씨향약, 학급별 일정을 확인해 주세요.'},{...base,id:'exam',title:'2026학년도 2학기 2차 정기시험 — 역사와 전 교과 시험범위',summary:'위스토리 문제 많이 풀기'},{...base,id:'reopen',title:'위스토리 재오픈 안내',summary:'새롭게 만나는 위스토리'}];return ${listMarkup};}
const actualArticles=${JSON.stringify(Object.fromEntries(actualArticles))};
function App(){
 const [html,setHtml]=useState(source),[mode,setMode]=useState('preview'),[checks,setChecks]=useState('대기'),[legacy,setLegacy]=useState(false);
 const saveAndReopen=()=>{const saved=JSON.parse(JSON.stringify({bodyHtml:html})).bodyHtml;const dom=new DOMParser().parseFromString(saved,'text/html');const ok=dom.querySelector('article.westory-event-article')&&dom.querySelector('table thead th[scope="col"]')&&dom.querySelector('table tbody td')?.textContent==='3학년 1반'&&dom.querySelector('img')?.getAttribute('alt')==='수행평가 안내 이미지'&&dom.querySelector('.westory-event-table[tabindex="0"]')&&dom.querySelector('blockquote')&&saved===html;setChecks((ok?'PASS':'FAIL')+' · 저장 후 본문 구조·표·이미지·접근성 속성 보존');setHtml(saved);setMode('saved');};
 return <><nav aria-label="검증 도구"><button onClick={()=>{setMode(mode==='preview'?'edit':'preview');setLegacy(false)}}>{mode==='preview'?'본문 편집':'미리보기'}</button><button onClick={saveAndReopen}>저장 후 다시 열기</button><button onClick={()=>{setLegacy(!legacy);setMode('preview')}}>기존 글 전환</button><button onClick={()=>setMode('list')}>목록 확인</button>{Object.keys(actualArticles).map(key=><button key={key} onClick={()=>{setHtml(actualArticles[key]||source);setMode('preview');setLegacy(false)}}>{key==='exam'?'시험범위 실제 글':'수행평가 실제 글'}</button>)}</nav><p role="status">{checks}</p><main className="ws-page developer-log-page"><header className="ws-page-header"><h1>개발자 일지</h1></header>{mode==='list'?<ListFixture/>:mode==='edit'?<EventArticleEditor value={html} onChange={setHtml}/>:renderPostDetail({...base,bodyHtml:legacy?'<h2>기존 개발자 일지</h2><p>기존 글의 본문과 카드뉴스 구성을 유지합니다.</p>':html},true)}</main></>;
}
createRoot(document.getElementById('root')).render(<App/>);
`;
const result = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const fixture = result.outputFiles[0].text;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>공지 본문 편집·반응형 검증</title><script src="https://cdn.tailwindcss.com"></script><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"><style>
*{box-sizing:border-box}body{margin:0;padding:16px;font:16px/1.6 'Noto Sans KR',sans-serif;color:#1f2937;word-break:keep-all;overflow-wrap:anywhere;background:#f9fafb}main{max-width:1152px;margin:auto;background:white}nav{display:flex;flex-wrap:wrap;gap:8px}button{font:inherit;padding:8px 16px;min-height:44px}h1{font-size:28px}img{max-width:100%}[hidden]{display:none!important}.min-w-0{min-width:0}.py-8{padding-block:32px}.grid{display:grid;gap:32px}.p-5{padding:20px}.flex{display:flex}.flex-col{flex-direction:column}.gap-4{gap:16px}.gap-3{gap:12px}.gap-2{gap:8px}.flex-wrap{flex-wrap:wrap}.border-b{border-bottom:1px solid #e5e7eb}.pb-6{padding-bottom:24px}.mb-3{margin-bottom:12px}.mt-3{margin-top:12px}.mt-4{margin-top:16px}.rounded-2xl{border-radius:16px}.text-center{text-align:center}.border-dashed{border-style:dashed}.border{border-width:1px;border-color:#e5e7eb}.px-5{padding-inline:20px}.py-8{padding-block:32px}.text-gray-400{color:#9ca3af}.bg-gray-50{background:#f9fafb}.hidden{display:none}.shrink-0{flex-shrink:0}@media(min-width:1024px){.lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_minmax\\(280px\\,420px\\)\\]{grid-template-columns:minmax(0,1fr) minmax(280px,420px)}}
${builtCss}\n${portalCss}\n${articleCss}\nbody{padding:0}main{background:white}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
if (process.argv.includes("--check")) {
  console.log(
    "Event article fixture bundle PASS; no application services imported.",
  );
  process.exit(0);
}
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/banner.png") {
    res.setHeader("Content-Type", "image/png");
    res.end(
      await fs.readFile(
        path.join(root, "output/notice-20261025/performance.png"),
      ),
    );
    return;
  }
  if (req.url === "/performance.webp" || req.url === "/exam.webp") {
    res.setHeader("Content-Type", "image/webp");
    res.end(
      await fs.readFile(
        path.join(root, "output/notice-20261025", req.url.slice(1)),
      ),
    );
    return;
  }
  res.setHeader(
    "Content-Type",
    req.url === "/fixture.js"
      ? "text/javascript;charset=utf-8"
      : "text/html;charset=utf-8",
  );
  res.end(req.url === "/fixture.js" ? fixture : html);
});
await new Promise((resolve) => server.listen(4341, "127.0.0.1", resolve));
console.log("Event article fixture: http://127.0.0.1:4341");
