import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const lesson = await fs.readFile(
  path.join(root, "src/pages/teacher/ManageLesson.tsx"),
  "utf8",
);
const panels = await fs.readFile(
  path.join(root, "src/pages/teacher/components/LessonEditorPanels.tsx"),
  "utf8",
);
const treeCard = lesson.slice(
  lesson.indexOf("  const TreeCard ="),
  lesson.indexOf("\n  return (", lesson.indexOf("  const TreeCard =")),
);
const treePanel = panels.slice(
  panels.indexOf("export function LessonTreePanel("),
  panels.indexOf("export function LessonEditorHeader("),
);
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const harness = `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import TeacherSubNavigation from ${imp("src/pages/teacher/components/TeacherSubNavigation.tsx")};
import QuizUnitTree from ${imp("src/pages/teacher/components/QuizUnitTree.tsx")};
${treePanel}
function Fixture(){
const [selectedNodeId,setSelected]=useState(''); const [expandedIds,setExpanded]=useState(new Set()); const [sidebarOpen,setOpen]=useState(false); const [quizOpen,setQuizOpen]=useState(false);const [quizLabel,setQuizLabel]=useState('단원 선택');const [action,setAction]=useState('');const canEdit=true;
const handleNodeClick=(node,level)=>{if(level<2){setExpanded(prev=>{const next=new Set(prev);next.has(node.id)?next.delete(node.id):next.add(node.id);return next;});}else{setSelected(node.id);setOpen(false);}};
const openModal=(mode,node)=>setAction(mode+':'+(node?.id||''));const handleDeleteNode=node=>setAction('delete:'+node.id);
${treeCard}
return <><div className="teacher-sub-workspace"><LessonTreePanel treeData={[{id:'big',title:'대단원',children:[{id:'mid',title:'중단원',children:[{id:'leaf',title:'긴 한국어 수업 자료 제목을 확인하는 항목',children:[]}]}]}]} sidebarOpen={sidebarOpen} onSidebarOpenChange={setOpen} activeLabel={selectedNodeId?'선택한 수업':'수업 자료 선택'} canEdit={canEdit} onOpenRootModal={()=>openModal('root')} onSaveTree={()=>setAction('save')} renderTreeNode={(node,level)=><TreeCard key={node.id} node={node} level={level}/>}/><main className="teacher-sub-content"><output data-testid="selected">{selectedNodeId}</output><output data-testid="action">{action}</output></main></div>
<div className="teacher-sub-workspace"><TeacherSubNavigation title="문제 등록" activeLabel={quizLabel} open={quizOpen} onOpenChange={setQuizOpen}><QuizUnitTree onSelect={(node)=>{setQuizLabel(node.title);setQuizOpen(false)}}/></TeacherSubNavigation><main className="teacher-sub-content"><output data-testid="quiz">{quizLabel}</output><div style={{display:"flex",minWidth:0,flexDirection:"column"}}><div style={{display:"flex",minWidth:0,flexDirection:"column"}}><div style={{display:"flex",height:"100%",minHeight:0,flexDirection:"column",overflow:"hidden"}}><header>문제 목록</header><div style={{flex:"1 1 0%",minHeight:0,overflow:"hidden",padding:24}}><div style={{height:"100%",minHeight:0,display:"flex",flexDirection:"column"}}><div style={{flex:"1 1 0%",minHeight:0,overflowY:"auto"}}>{Array.from({length:80},(_,i)=><div key={i} data-testid={i===79?"last-question":undefined} style={{padding:16}}>문제 {i+1}</div>)}</div></div></div></div></div></div></main></div></>;
}createRoot(document.getElementById('root')).render(<Fixture/>);`;
const result = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  outdir: "fixture",
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "offline-fixture",
      setup(build) {
        build.onResolve(
          {
            filter:
              /firebase\/firestore$|lib\/firebase$|contexts\/AuthContext$|lib\/semesterScope$/,
          },
          (args) => ({ path: args.path, namespace: "stub" }),
        );
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: `export const db={};export const doc=()=>({});const config={};export const useAuth=()=>({config});export const getSemesterDocPath=()=>"stub";export const getDoc=async()=>({exists:()=>true,data:()=>({tree:[{id:"quiz-big",title:"대단원",children:[{id:"quiz-mid",title:"중단원 문제"}]}]})});`,
          loader: "js",
        }));
      },
    },
  ],
});
const js = result.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = result.outputFiles.find((f) => f.path.endsWith(".css")).text;
const html = `<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}button{font:inherit}svg{width:24px;height:24px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/fixture.js" ? "text/javascript" : "text/html;charset=utf-8",
  );
  res.end(req.url === "/fixture.js" ? js : html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const evidence = path.join(os.tmpdir(), "westory-tree-navigation-evidence");
await fs.mkdir(evidence, { recursive: true });
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
try {
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const lessonNav = page.getByRole("complementary", {
      name: "수업 자료",
      exact: true,
    });
    const toggle = lessonNav.locator(".teacher-settings-menu-toggle");
    if (width < 768) await toggle.click();
    await lessonNav
      .getByRole("button", { name: "대단원", exact: true })
      .click();
    assert.equal(
      await lessonNav
        .getByRole("button", { name: "대단원 하위 항목 추가", exact: true })
        .isVisible(),
      true,
    );
    await lessonNav
      .getByRole("button", { name: "중단원", exact: true })
      .press("Enter");
    await lessonNav
      .getByRole("button", {
        name: "긴 한국어 수업 자료 제목을 확인하는 항목",
        exact: true,
      })
      .click();
    assert.equal(await page.getByTestId("selected").textContent(), "leaf");
    if (width < 768) {
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await toggle.click();
    }
    await lessonNav
      .getByRole("button", {
        name: "긴 한국어 수업 자료 제목을 확인하는 항목 이름 수정",
      })
      .click();
    assert.equal(await page.getByTestId("action").textContent(), "rename:leaf");
    await lessonNav
      .getByRole("button", {
        name: "긴 한국어 수업 자료 제목을 확인하는 항목 삭제",
      })
      .click();
    assert.equal(await page.getByTestId("action").textContent(), "delete:leaf");
    const quiz = page.getByRole("complementary", {
      name: "문제 등록",
      exact: true,
    });
    if (width < 768)
      await quiz.locator(".teacher-settings-menu-toggle").click();
    await quiz
      .getByRole("button", { name: "중단원 문제", exact: true })
      .click();
    assert.equal(await page.getByTestId("quiz").textContent(), "중단원 문제");
    if (width < 768)
      await quiz.locator(".teacher-settings-menu-toggle").click();
    await quiz
      .getByRole("button", { name: "모의고사", exact: true })
      .press("Enter");
    assert.equal(await page.getByTestId("quiz").textContent(), "모의고사");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    await page.getByTestId("last-question").scrollIntoViewIfNeeded();
    assert.equal(await page.getByTestId("last-question").isVisible(), true);
    const last = await page.getByTestId("last-question").boundingBox();
    assert.ok(last.y >= 0 && last.y + last.height <= 900);
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: path.join(evidence, `tree-${width}.png`),
      fullPage: true,
    });
    await page.close();
    console.log(
      `${width}px: tree expand/select/CRUD, quiz selection, keyboard, overflow, quiz layout-chain last-row reachability passed`,
    );
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(`Evidence: ${evidence}`);
