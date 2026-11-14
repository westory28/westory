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
  process.env.SCORE_QA_EVIDENCE_DIR ||
    path.join(root, "..", "evidence", "written-score-mobile"),
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
export const docs=new Map(),events=[],toasts=[];
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
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Manager from'${root}/src/pages/teacher/components/PerformanceScoreManager';import{LoadingProvider}from'${root}/src/components/common/LoadingState';import'qa-state';createRoot(document.getElementById('root')).render(<BrowserRouter><LoadingProvider><div id="qa-sidebar">주 메뉴</div><div id="qa-header">위스토리</div><main id="qa-page" className="ws-page"><Manager scoreKind={new URLSearchParams(location.search).get('kind')||'written_exam_essay'}/></main></LoadingProvider></BrowserRouter>);`,
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
async function assertLayer(page, label) {
  const geometry = await page
    .locator(".score-class-sheet--compact")
    .evaluate((section) => {
      const rect = section.getBoundingClientRect(),
        surface = section.querySelector(".ws-loading-container-overlay");
      const outer = section.parentElement;
      const sample = (x, y) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (outer === hit || outer.contains(hit));
      };
      return {
        hasSurface: !!surface,
        inside: sample(rect.left + 12, rect.top + 12),
        overSidebar: sample(20, Math.max(80, rect.top + 12)),
        overHeader: sample(innerWidth / 2, 32),
        rootIsolated: document
          .querySelector("#qa-page>div")
          ?.classList.contains("ws-loading-container"),
        height: rect.height,
      };
    });
  assert(geometry.hasSurface, `${label}: loading is in the modal`);
  assert(
    geometry.inside && geometry.overSidebar && geometry.overHeader,
    `${label}: modal above navigation ${JSON.stringify(geometry)}`,
  );
  assert(
    !geometry.rootIsolated,
    `${label}: main manager must not be isolated by popup loading`,
  );
  return geometry;
}
try {
  browser = await chromium.launch({
    channel:
      process.env.SCORE_QA_BROWSER_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
    ignoreDefaultArgs: ["--hide-scrollbars"],
  });
  for (const kind of ["written_exam_essay", "performance"])
    for (const width of [320, 390, 768, 1280, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on("pageerror", (e) => report.pageErrors.push(e.message));
      await page.route("**/*", (route) =>
        route.request().url().startsWith(origin) ||
        route.request().url().startsWith("data:")
          ? route.continue()
          : route.abort(),
      );
      await page.goto(`${origin}/?kind=${kind}`);
      const filters = page.locator(".score-manager-filters");
      await filters.waitFor();
      const grade = filters.getByLabel("학년", { exact: true }),
        klass = filters.getByLabel("반", { exact: true }),
        toggle = filters.locator(".score-manager-search-toggle"),
        search = filters.locator("input[type=search]"),
        lookup = filters.getByRole("button", { name: "조회", exact: true });
      if (width < 768) {
        const baseline = await grade.boundingBox();
        for (const control of [klass, toggle, lookup])
          assert(
            Math.abs((await control.boundingBox()).y - baseline.y) < 1,
            `${kind} ${width}: one filter row`,
          );
        const before = await filters.boundingBox();
        await toggle.focus();
        await toggle.press("Enter");
        assert(
          await search.evaluate((el) => el === document.activeElement),
          "search opens with focus",
        );
        await search.fill("가상학생");
        for (const control of [grade, klass, search, toggle, lookup])
          assert(
            Math.abs((await control.boundingBox()).y - baseline.y) < 1,
            `${kind} ${width}: expanded search stays on row`,
          );
        assert(
          Math.abs((await filters.boundingBox()).height - before.height) < 1,
          "search preserves toolbar height",
        );
        await search.press("Escape");
        assert.equal(await search.inputValue(), "");
        assert(
          await toggle.evaluate((el) => el === document.activeElement),
          "Escape restores focus",
        );
      } else assert(await search.isVisible());
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "page does not overflow horizontally",
      );
      await capture(page, `${kind}-toolbar-${width}.png`);
      await page
        .getByRole("button", {
          name: kind === "performance" ? "일람표" : "서명 현황",
          exact: true,
        })
        .click();
      const modal = page.locator(".score-class-sheet--compact");
      await modal.waitFor();
      await page.evaluate(() =>
        document.body.classList.add("qa-test-navigation"),
      );
      const refresh = modal.getByRole("button", {
        name: "현황 조회",
        exact: true,
      });
      await page.evaluate(() => {
        window.scoreQa.pause = true;
        window.scoreQa.fail = false;
      });
      await refresh.click();
      await modal.locator(".ws-loading-container-overlay").waitFor();
      const loading = await assertLayer(page, `${kind} ${width}`);
      await capture(page, `${kind}-loading-${width}.png`);
      await page.evaluate(() => {
        window.scoreQa.pause = false;
        window.scoreQa.resolvers.splice(0).forEach((resolve) => resolve());
      });
      await modal.locator(".score-class-sheet-table tbody tr").last().waitFor();
      await modal
        .locator(".ws-loading-container-overlay")
        .waitFor({ state: "hidden" });
      assert.equal(
        await modal
          .getByRole("group", { name: "서명 완료 10명", exact: true })
          .count(),
        1,
        "Known direct confirmation paths preserve signed students",
      );
      assert.equal(
        await modal
          .getByRole("group", { name: "서명 미완료 22명", exact: true })
          .count(),
        1,
      );
      if (kind === "written_exam_essay") {
        assert.equal(
          await modal
            .getByRole("group", { name: "논술형만 서명 11명", exact: true })
            .count(),
          1,
        );
        await modal.getByText("가상긴이름검증학생", { exact: true }).waitFor();
      }
      const metrics = await modal.evaluate((section) => {
        const summary = section.querySelector(".score-class-sheet-summary"),
          wrap = section.querySelector(".score-class-sheet-table"),
          table = wrap.querySelector("table");
        const cells = [...table.querySelectorAll("th,td")];
        const textOverflows = cells.flatMap((cell) => {
          const box = cell.getBoundingClientRect();
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
          let text;
          while ((text = walker.nextNode())) {
            if (!text.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(text);
            for (const r of range.getClientRects())
              if (r.left < box.left - 1 || r.right > box.right + 1)
                return [cell.textContent.trim()];
          }
          return [];
        });
        const summaryItems = [...summary.children].map((el) =>
          el.getBoundingClientRect(),
        );
        const before = wrap.scrollLeft;
        wrap.scrollLeft = 100;
        const scrolls = wrap.scrollLeft > before;
        wrap.scrollLeft = before;
        return {
          textOverflows,
          summaryClientWidth: summary.clientWidth,
          summaryScrollWidth: summary.scrollWidth,
          summaryLines: new Set(summaryItems.map((r) => Math.round(r.top)))
            .size,
          summaryHeight: summary.getBoundingClientRect().height,
          tableWidth: table.getBoundingClientRect().width,
          wrapWidth: wrap.clientWidth,
          scrolls,
          allNoWrap: cells.every(
            (el) => getComputedStyle(el).whiteSpace === "nowrap",
          ),
          rows: table.tBodies[0].rows.length,
          pageWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
        };
      });
      if (kind === "written_exam_essay" && width === 390)
        assert(
          metrics.summaryScrollWidth <= metrics.summaryClientWidth,
          "390px summary shows every counter without scrolling",
        );
      assert.equal(
        metrics.summaryLines,
        1,
        `${kind} ${width}: one summary row`,
      );
      assert.deepEqual(
        metrics.textOverflows,
        [],
        `${kind} ${width}: text stays within its table cell`,
      );
      assert(metrics.allNoWrap, `${kind} ${width}: cells don't wrap`);
      assert.equal(metrics.rows, 32);
      if (width < 1024)
        assert(
          metrics.scrolls,
          `${kind} ${width}: internal horizontal scrolling`,
        );
      assert(
        metrics.pageWidth <= width + 1,
        `${kind} ${width}: modal stays in viewport`,
      );
      await capture(page, `${kind}-status-${width}.png`);
      // A failed explicit refresh must leave the modal above navigation and permit retry.
      await page.evaluate(() => {
        window.scoreQa.pause = true;
        window.scoreQa.fail = true;
      });
      await refresh.click();
      await modal.locator(".ws-loading-container-overlay").waitFor();
      await assertLayer(page, `${kind} ${width} failure`);
      await page.evaluate(() => {
        window.scoreQa.pause = false;
        window.scoreQa.resolvers.splice(0).forEach((resolve) => resolve());
      });
      await modal
        .locator(".ws-loading-container-overlay")
        .waitFor({ state: "hidden" });
      assert(
        await page.evaluate(() =>
          window.scoreQa.toasts.some((t) => t.tone === "error"),
        ),
        "failure is reported",
      );
      await page.evaluate(() => {
        window.scoreQa.fail = false;
      });
      await refresh.click();
      await modal
        .locator(".ws-loading-container-overlay")
        .waitFor({ state: "hidden" });
      assert.equal(
        await modal.locator(".score-class-sheet-table tbody tr").count(),
        32,
        "retry preserves full roster",
      );
      const documentReads = await page.evaluate(
        () => window.scoreQa.events.filter((e) => e.op === "getDoc").length,
      );
      report.checks.push({
        documentReads,
        kind,
        width,
        loading,
        ...metrics,
        queryReads: await page.evaluate(
          () => window.scoreQa.events.filter((e) => e.op === "getDocs").length,
        ),
      });
      assert.equal(
        await page.evaluate(
          () =>
            window.scoreQa.events.filter((e) => e.op === "unexpected-write")
              .length,
        ),
        0,
        "Viewing and retrying do not attempt data writes",
      );
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
  `PASS written/performance score mobile: ${report.checks.length} viewport cases; evidence ${out}`,
);
