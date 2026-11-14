import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Exercise the real manager and LoadingProvider with synthetic read-only data.
const root = path
  .resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  .replaceAll("\\", "/");
const out = path.resolve(
  process.env.SCORE_UPLOAD_QA_EVIDENCE_DIR ||
    path.join(root, "..", "evidence", "written-score-upload"),
);
await fs.mkdir(out, { recursive: true });
const require = createRequire(root + "/package.json");
const { build } = require("esbuild");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const state = `
export const docs=new Map(),events=[],toasts=[]; for(let c=2;c<=3;c++)for(let n=1;n<=2;n++)docs.set('users/qa-'+c+'-'+n,{role:'student',grade:'3',class:String(c),number:String(n),studentName:'가상'+c+'반'+n,email:'qa-'+c+'-'+n+'@example.test',enrollmentStatus:'active'});
const timestamp={seconds:1801850400,nanoseconds:0};
const fixtureName=n=>n===1&&new URLSearchParams(location.search).get('kind')==='written_exam_essay'?'가상긴이름검증학생':'가상학생'+String(n).padStart(2,'0');
const signature='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lO0AAAAASUVORK5CYII=';
for(let i=1;i<=32;i++)docs.set('users/qa-'+i,{role:'student',grade:'3',class:'1',number:String(i),studentName:fixtureName(i),email:'qa-'+i+'@example.test',enrollmentStatus:'active'});
for(const kind of ['performance','written_exam_essay'])for(const [index,section] of ['objective','essay'].entries()){
 const id=kind+'-'+section;
 const title=kind==='performance'?(index+1)+'차 가상 수행평가':'2학기 정기시험 '+(section==='objective'?'서답형':'논술형');
 const item={name:section==='objective'?'서답형 1':'논술형 1',maxScore:20,score:18,scoreEntered:true,...(kind!=='performance'?{examSection:section}:{})};
 const rows=Array.from({length:32},(_,n)=>({rowNumber:n+1,uid:'qa-'+(n+1),grade:'3',class:'1',number:String(n+1),studentName:fixtureName(n+1),items:[item],enteredScoreCount:1,totalScore:18,totalMaxScore:20,matchStatus:'matched',matchMessage:'',feedback:''}));
 const roster={scoreKind:kind,scoreContentKind:kind==='performance'?'performance':section,title,subject:'역사',assessmentOrder:index+1,academicYear:'2026',semester:'2',targetGrade:'3',targetClass:'1',classes:['1'],items:[item],totalMaxScore:20,rowCount:32,matchedCount:32,unmatchedCount:0,rows,sourceFileName:'synthetic.xlsx',createdAt:timestamp,updatedAt:timestamp};
 docs.set('years/2026/semesters/2/performance_score_rosters/'+id,roster);
 for(const row of rows){
  docs.set('users/'+row.uid+'/performance_scores/'+id,{...roster,...row,rosterId:id,uploadedAt:timestamp});
  if(Number(row.number)%3===0||(section==='essay'&&Number(row.number)%3===1))docs.set('users/'+row.uid+'/performance_scores/'+id+'/confirmations/'+row.uid,{uid:row.uid,rosterId:id,signatureName:row.studentName,signatureImage:signature,scoreUpdatedAt:timestamp,confirmedAt:timestamp});
 }
}
window.scoreQa={docs,events,toasts,pause:false,fail:false,resolvers:[]};
export const ref=value=>{const parts=value.split('/');return{path:value,id:parts.at(-1),parent:{id:parts.at(-2),path:parts.slice(0,-1).join('/')}}};
export const snap=r=>({...r,ref:r,exists:()=>docs.has(r.path),data:()=>docs.get(r.path)});
`;
const mocks = {
  "qa-state": state,
  "qa-auth": `export const useAuth=()=>({userData:{role:'teacher'},currentUser:{uid:'qa-teacher',displayName:'가상교사'},config:{year:'2026',semester:'2'}});`,
  "qa-firestore": `import{docs,events,ref,snap}from'qa-state';
export const collection=(db,...parts)=>ref(parts.join('/')),doc=collection,collectionGroup=(db,group)=>({group}),query=(base,...filters)=>({...base,filters}),where=(field,op,value)=>({field,op,value}),orderBy=(...args)=>({order:args}),limit=n=>({limit:n});
export const getDoc=async r=>{events.push({op:'getDoc',path:r.path});return snap(r)},getDocFromServer=getDoc;
export const getDocs=async r=>{
 const qa=window.scoreQa;events.push({op:'getDocs',path:r.path||r.group});
 if(r.path==='users'){if(qa.pause)await new Promise(resolve=>qa.resolvers.push(resolve));if(qa.fail)throw new Error('synthetic unavailable');}
 let entries=[...docs].filter(([key])=>r.group?key.split('/').at(-2)===r.group:key.startsWith(r.path+'/')&&!key.slice(r.path.length+1).includes('/'));
 for(const f of r.filters||[])if(f.field)entries=entries.filter(([,v])=>f.op==='=='?v[f.field]===f.value:true);
 const result=entries.map(([key])=>snap(ref(key)));return{docs:result,empty:!result.length,size:result.length,forEach:fn=>result.forEach(fn)};
};export const getDocsFromServer=getDocs;
const deny=()=>{events.push({op:'unexpected-write'});throw new Error('Unexpected write in read-only layout QA')};
export const setDoc=deny,updateDoc=deny,deleteDoc=deny,serverTimestamp=()=>({seconds:1801850400}),deleteField=()=>({__delete:true}),writeBatch=()=>({set:deny,update:deny,delete:deny,commit:deny}),runTransaction=async(db,fn)=>fn({get:getDoc,set:deny,update:deny,delete:deny});`,
  "qa-firebase": `export const db={};export const auth={currentUser:{uid:'qa-teacher'}};export const getHttpsCallable=async()=>async()=>({data:{}});`,
  "qa-archive": `export const isSemesterArchive=false,archiveScope=null;`,
  "qa-notifications": `export const createManagedNotifications=async()=>({}),reviewPerformanceScoreObjection=async()=>({});`,
  "qa-profile": `export const callStudentDataService=async()=>({});`,
  "qa-toast": `export const useAppToast=()=>({showToast:payload=>{window.scoreQa.toasts.push(payload);document.getElementById('qa-toast').textContent=payload.title;}});`,
  "qa-dialog": `export const useAppDialog=()=>({confirm:async()=>false,prompt:async()=>null});`,
};
function moduleFor(value) {
  value = value.replaceAll("\\", "/");
  if (value in mocks) return value;
  if (value === "firebase/firestore") return "qa-firestore";
  for (const [pattern, name] of [
    [/contexts\/AuthContext$/, "qa-auth"],
    [/lib\/firebase$/, "qa-firebase"],
    [/lib\/semesterArchive$/, "qa-archive"],
    [/lib\/notifications$/, "qa-notifications"],
    [/studentProfileCommands$/, "qa-profile"],
    [/AppToastProvider$/, "qa-toast"],
    [/AppDialogProvider$/, "qa-dialog"],
  ])
    if (pattern.test(value)) return name;
}
const result = await build({
  stdin: {
    contents: `import React,{useEffect}from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Manager from'${root}/src/pages/teacher/components/PerformanceScoreManager';import{LoadingProvider}from'${root}/src/components/common/LoadingState';import'qa-state';function Materials(){useEffect(()=>{window.scoreQa.events.push({op:'materials-mount'});return()=>window.scoreQa.events.push({op:'materials-unmount'})},[]);return <div data-testid='materials-slot'><label>원안지 PDF<input type='file'/></label><button>자료 저장</button></div>}createRoot(document.getElementById('root')).render(<BrowserRouter><LoadingProvider><div id="qa-sidebar">주 메뉴</div><div id="qa-header">위스토리</div><main id="qa-page" className="ws-page"><Manager scoreKind={new URLSearchParams(location.search).get('kind')||'written_exam_essay'} navigation={<nav id='qa-subnav'>점수 등록 및 확인 · 평가 분석</nav>} writtenExamMaterials={<Materials/>}/></main></LoadingProvider></BrowserRouter>);`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "browser",
  loader: { ".css": "empty", ".webp": "dataurl" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "synthetic-read-only-services",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          const name =
            moduleFor(args.path) ||
            (args.path.startsWith(".")
              ? moduleFor(path.resolve(args.resolveDir, args.path))
              : undefined);
          return name ? { path: name, namespace: "qa" } : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "qa" }, (args) => ({
          contents: mocks[args.path],
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
assert(
  !Object.keys(result.metafile.inputs).some((file) =>
    /node_modules[\\/](firebase|@firebase)[\\/]/.test(file),
  ),
  "Production Firebase must not enter the QA bundle",
);
const css = (
  await Promise.all(
    [
      "assets/css/style.css",
      "src/assets/index.css",
      "src/components/common/portalPage.css",
      "src/components/common/InfoHelp.css",
      "src/components/common/loadingState.css",
      "src/pages/teacher/components/performance-score-list.css",
      "src/pages/teacher/components/written-score-upload.css",
    ].map((file) => fs.readFile(root + "/" + file, "utf8")),
  )
)
  .join("\n")
  .replace(/@import[^;]+;/g, "")
  .replace(/@tailwind[^;]+;/g, "");
const tailwind = await fs.readFile(
  process.env.SCORE_QA_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
);
const html = `<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}\n#qa-page{padding-top:80px}#qa-sidebar{position:fixed;left:0;top:0;width:64px;height:100vh;z-index:30;background:#cbd5e1}#qa-header{position:fixed;inset:0 0 auto;height:64px;z-index:40;background:#fff}#qa-sidebar{transform:translateX(-100%)}body.qa-test-navigation #qa-sidebar{transform:none}@media(min-width:1024px){#qa-page{padding-left:88px}#qa-sidebar{transform:none}}</style><div id="root"></div><div id="qa-toast" role="status"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((req, res) => {
  const js = req.url === "/fixture.js" || req.url === "/tailwind.js";
  res.setHeader(
    "Content-Type",
    js ? "text/javascript" : "text/html; charset=utf-8",
  );
  res.end(
    req.url === "/fixture.js"
      ? result.outputFiles[0].text
      : req.url === "/tailwind.js"
        ? tailwind
        : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = {
  checks: [],
  screenshots: [],
  pageErrors: [],
  limitations: [
    "Synthetic users and in-memory read-only Firestore; network restricted to localhost.",
    "Sidebar/header use the production z-index values with synthetic surfaces; the actual manager and LoadingProvider are bundled.",
    "External icon fonts are blocked; screenshots verify layout and text, not icon glyph artwork.",
  ],
};
let browser;
async function capture(page, name) {
  if (!name.includes("-loading-"))
    await page.locator(".ws-loading-exit-surface").waitFor({ state: "hidden" });
  await page.screenshot({ path: path.join(out, name), fullPage: false });
  report.screenshots.push(name);
}
const ExcelJS = require("exceljs");
async function makeFile(name, sheets) {
  const workbook = new ExcelJS.Workbook();
  for (const [sheetName, rows] of sheets)
    workbook.addWorksheet(sheetName).addRows(rows);
  const filename = path.join(out, name);
  await workbook.xlsx.writeFile(filename);
  return filename;
}
function objective(klass) {
  return [
    ["반/번호", "학번", "성명", 1, 2, 3, 4, 5, "총점"],
    ["정답", "", "", 1, 2, 3, 4, 5],
    ["배점", "", "", 2, 2, 2, 2, 2],
    ...[1, 2].map((n) => [
      `${klass}-${n}`,
      `3${klass}${n}`,
      klass === 1
        ? n === 1
          ? "가상긴이름검증학생"
          : "가상학생02"
        : `가상${klass}반${n}`,
      ".",
      ".",
      "",
      "-",
      1,
      4,
    ]),
  ];
}
const firstFile = await makeFile("1학급.xlsx", [
  ["1반", objective(1)],
  ["빈 시트", []],
]);
const secondFile = await makeFile("다른학급들.xlsx", [
  ["2반", objective(2)],
  ["3반", objective(3)],
]);
const badFile = await makeFile("오류파일.xlsx", [
  ["확인필요", [["알 수 없는 양식"]]],
]);
const conflictRows = objective(2);
conflictRows[1][3] = 5;
const conflictFile = await makeFile("문항충돌.xlsx", [["2반", conflictRows]]);
try {
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  for (const width of [390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    page.on("pageerror", (error) => report.pageErrors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin) ||
      route.request().url().startsWith("data:")
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin + "/?kind=written_exam_essay");
    await page.locator(".score-manager-actions").waitFor();
    const nav = await page.locator("#qa-subnav").boundingBox();
    const actions = await page.locator(".score-manager-actions").boundingBox();
    assert(actions.y >= nav.y + nav.height, "Actions are below the navigation");
    const headerStyle = await page
      .locator(".ws-page-header")
      .first()
      .evaluate((el) => ({
        background: getComputedStyle(el).backgroundColor,
        shadow: getComputedStyle(el).boxShadow,
      }));
    assert.equal(headerStyle.background, "rgba(0, 0, 0, 0)");
    assert.equal(headerStyle.shadow, "none");
    await page.getByRole("button", { name: "업로드", exact: true }).click();
    const dialog = page.locator('[aria-labelledby="score-upload-modal-title"]');
    await dialog.waitFor();
    assert.equal(
      await page.locator('[data-testid="materials-slot"]').count(),
      0,
      "Materials do not mount in score mode",
    );
    const modes = dialog.getByRole("group", { name: "정기시험 업로드 종류" });
    assert.equal(
      await modes.locator(".written-score-upload-choice").count(),
      3,
    );
    assert.equal(
      await dialog.locator(".written-score-upload-scope").count(),
      1,
    );
    const fileHeight = await dialog
      .locator(".written-score-upload-file")
      .evaluate((el) => el.getBoundingClientRect().height);
    assert(
      fileHeight >= 44 && fileHeight <= 48,
      `Compact file selector ${fileHeight}`,
    );
    if (width >= 768) {
      const positions = await dialog
        .locator(".written-score-upload-scope>label")
        .evaluateAll((labels) =>
          labels.map((el) => el.getBoundingClientRect().y),
        );
      assert(
        Math.max(...positions) - Math.min(...positions) < 1,
        "Subject, grade and class share a desktop row",
      );
    }
    assert.equal(
      await dialog
        .getByText("같은 시험의 학급별 엑셀", { exact: false })
        .count(),
      0,
      "No permanent help prose",
    );
    await dialog
      .getByRole("button", { name: "서답형 업로드 안내", exact: true })
      .focus();
    await page.getByRole("tooltip").waitFor();
    await page.keyboard.press("Escape");
    await dialog
      .getByRole("button", { name: "원안지·문항정보표", exact: true })
      .click();
    assert.equal(
      await page.locator('[data-testid="materials-slot"]').count(),
      1,
    );
    assert.equal(
      await dialog.locator(".written-score-upload-scope").count(),
      0,
    );
    assert.equal(
      await dialog.getByText("업로드 기록", { exact: true }).count(),
      0,
    );
    assert.equal(await page.getByRole("dialog").count(), 1, "No nested dialog");
    await dialog.getByRole("button", { name: "논술형", exact: true }).click();
    assert.equal(
      await page.locator('[data-testid="materials-slot"]').count(),
      0,
    );
    assert.equal(
      await dialog
        .getByRole("button", { name: "논술형 양식 다운로드" })
        .count(),
      1,
    );
    await dialog.getByRole("button", { name: "서답형", exact: true }).click();
    const input = dialog.getByLabel("서답형 엑셀 선택", { exact: true });
    assert.equal(await input.getAttribute("multiple"), "");
    await dialog
      .locator(".written-score-upload-scope select")
      .nth(0)
      .selectOption("3");
    assert(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      "Dialog has no horizontal overflow",
    );
    await capture(page, `upload-${width}.png`);
    // A failed selected file must not become a partial preview or start student reads.
    const readsBefore = await page.evaluate(
      () =>
        window.scoreQa.events.filter(
          (e) => e.op === "getDocs" && e.path === "users",
        ).length,
    );
    await input.setInputFiles([firstFile, badFile]);
    await page.waitForFunction(() =>
      window.scoreQa.toasts.some((t) => t.message?.includes("오류파일.xlsx")),
    );
    assert.equal(
      await page
        .locator('[aria-labelledby="score-upload-preview-title"]')
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.scoreQa.events.filter(
            (e) => e.op === "getDocs" && e.path === "users",
          ).length,
      ),
      readsBefore,
    );
    await input.setInputFiles([firstFile, conflictFile]);
    await page.waitForFunction(() =>
      window.scoreQa.toasts.some((t) => t.message?.includes("문항충돌.xlsx")),
    );
    await input.setInputFiles([firstFile, firstFile]);
    await page.waitForFunction(() =>
      window.scoreQa.toasts.some((t) => t.message?.includes("중복")),
    );
    await input.setInputFiles([firstFile, secondFile]);
    const preview = page.locator(
      '[aria-labelledby="score-upload-preview-title"]',
    );
    await preview.waitFor();
    assert.equal(await preview.getByText("총 6명", { exact: true }).count(), 1);
    assert.equal(
      await preview.getByText("연결 6명", { exact: true }).count(),
      1,
    );
    assert(
      await preview
        .getByRole("button", { name: "학생별 점수 저장", exact: true })
        .isEnabled(),
      "Human save remains the final step",
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.scoreQa.events.filter((e) => e.op === "unexpected-write")
            .length,
      ),
      0,
    );
    await capture(page, `preview-${width}.png`);
    report.checks.push({
      width,
      fileHeight,
      students: 6,
      sourceFiles: 2,
      nonemptySheets: 3,
      studentReads: await page.evaluate(
        () =>
          window.scoreQa.events.filter(
            (e) => e.op === "getDocs" && e.path === "users",
          ).length - 0,
      ),
      writes: 0,
    });
    await page.close();
  }
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  throw error;
} finally {
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  `PASS written score upload: compact tabs, lazy materials slot, two real XLSX files / three sheets, all-or-nothing failures, six matched students; evidence ${out}`,
);
