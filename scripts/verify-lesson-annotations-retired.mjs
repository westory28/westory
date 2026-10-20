/** Retired annotations cannot restore, render, write, or enable tools in any worksheet mode. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence =
  process.env.LESSON_ANNOTATION_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-annotations-retired-")));
await fs.mkdir(evidence, { recursive: true });
const source = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const presentation = await fs.readFile(
  path.join(root, "src/pages/teacher/components/TeacherLessonPresentation.tsx"),
  "utf8",
);
assert.doesNotMatch(
  presentation,
  /firebase|\bgetDoc\b|\bsetDoc\b|localStorage|legacyPresentation|onAnnotationChange|annotationState|handleResetAnnotations|handleManualSave/,
);
const helpers = await fs.readFile(
  path.join(root, "src/lib/teacherPresentation.ts"),
  "utf8",
);
assert.doesNotMatch(helpers, /lesson_presentations|localStorage|Legacy|판서/);
const harness = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Stage from ${source("src/components/common/LessonWorksheetStage.tsx")};
import Presentation from ${source("src/pages/teacher/components/TeacherLessonPresentation.tsx")};
import {getLessonWorksheetStageCapabilities} from ${source("src/lib/lessonWorksheet.ts")};
import ${source("src/assets/index.css")};
const qa=window.annotationQa={changes:0,page:1,answers:{},footnotes:0,close:0,capabilities:{}};
for(const mode of ['teacher-edit','teacher-present','student-solve'])qa.capabilities[mode]=getLessonWorksheetStageCapabilities(mode);
const pages=[{page:1,imageUrl:'/worksheet.svg',width:1000,height:1400},{page:2,imageUrl:'/worksheet.svg?p=2',width:1000,height:1400}];
const blanks=[{id:'blank',page:1,leftRatio:.15,topRatio:.2,widthRatio:.18,heightRatio:.03,answer:'고조선',source:'manual'}];
const anchors=[{id:'anchor',footnoteId:'footnote',page:1,leftRatio:.2,topRatio:.1,widthRatio:.05,heightRatio:.03}];
const highlights=[{id:'highlight',page:1,leftRatio:.5,topRatio:.3,widthRatio:.1,heightRatio:.03}];
const legacy={strokes:[{id:'old-stroke',page:1,type:'pen',color:'red',width:5,points:[{x:.1,y:.1},{x:.4,y:.4}]}],boxes:[],textNotes:[{id:'old-note',page:1,text:'폐기된 판서 기록',leftRatio:.1,topRatio:.3,widthRatio:.2,heightRatio:.1,color:'red',fontSize:20}]};
const lesson={unitId:'unit',title:'수업 자료',worksheetPageImages:pages,worksheetBlanks:blanks,worksheetExamHighlights:highlights,worksheetFootnoteAnchors:anchors,footnotes:[{id:'footnote',anchorKey:'1',title:'각주 제목',bodyHtml:'<p>보존된 각주 내용</p>',order:0}]};
const mode=new URLSearchParams(location.search).get('mode')||'teacher-present';
function Fixture(){const [page,setPage]=useState(1),[answers,setAnswers]=useState({});const changePage=p=>{qa.page=p;setPage(p)};return <main style={{padding:16,maxWidth:1152,margin:'auto'}}>{mode==='presentation'?<Presentation lesson={lesson} classId='3-2' classLabel='3학년 2반' fullscreenPreview onClosePreview={()=>qa.close++}/>:<Stage mode={mode} pageImages={pages} blanks={blanks} footnoteAnchors={anchors} footnoteTitles={{footnote:'각주 제목'}} onActivateFootnoteAnchor={()=>qa.footnotes++} examHighlights={highlights} teacherCurrentPage={page} studentCurrentPage={page} onTeacherCurrentPageChange={changePage} onStudentCurrentPageChange={changePage} studentAnswers={answers} onStudentAnswerChange={(id,value)=>{qa.answers[id]=value;setAnswers(a=>({...a,[id]:{value}}))}} annotationEnabled={true} annotationState={legacy} annotationPersistenceKey='old-record' onAnnotationChange={()=>qa.changes++}/>}</main>}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const bundle = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(evidence, "fixture.js"),
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".svg": "dataurl", ".webp": "dataurl" },
  plugins: [
    {
      name: "offline",
      setup(plugin) {
        plugin.onResolve(
          { filter: /lib\/firebase$|^\.\/firebase$/ },
          (args) => ({ path: args.path, namespace: "offline" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
          contents:
            "export const getHttpsCallable=()=>{throw new Error('Unexpected server call')};export const getFirebaseStorage=()=>{throw new Error('Unexpected storage call')};",
          loader: "js",
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = bundle.outputFiles
  .find((f) => f.path.endsWith(".css"))
  .text.replace(/@import\s+(?:url\()?['"]https?:[^;]+;/g, "");
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="1000" height="1400" fill="white"/><text x="150" y="310" font-size="28">고조선</text></svg>';
const html =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((req, res) => {
  const route = new URL(req.url, "http://localhost").pathname;
  const asset =
    route === "/fixture.js"
      ? ["text/javascript", js]
      : route === "/fixture.css"
        ? ["text/css", css]
        : route === "/tailwind.js"
          ? ["text/javascript", tailwind]
          : route === "/worksheet.svg"
            ? ["image/svg+xml", svg]
            : ["text/html", html];
  res.setHeader("Content-Type", asset[0] + ";charset=utf-8");
  res.end(asset[1]);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const results = [];
try {
  for (const width of [390, 768, 1280])
    for (const mode of [
      "teacher-edit",
      "teacher-present",
      "student-solve",
      "presentation",
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [],
        external = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        if (route.request().url().startsWith(origin)) return route.continue();
        external.push(route.request().url());
        return route.abort();
      });
      await page.goto(origin + "/?mode=" + mode);
      await page.locator("img").first().waitFor();
      await page.waitForFunction(() => document.querySelector("img")?.complete);
      assert.equal(await page.locator("[data-annotation-note]").count(), 0);
      assert.equal(await page.getByText("폐기된 판서 기록").count(), 0);
      assert.equal(
        await page
          .getByRole("button", {
            name: /판서|메모 초기화|저장|펜 |형광펜|Clear all annotations/,
          })
          .count(),
        0,
      );
      const caps = await page.evaluate(() => window.annotationQa.capabilities);
      assert(
        Object.values(caps).every((c) => c.enableAnnotationTools === false),
      );
      assert(caps["teacher-edit"].enableBlankDrafting);
      assert(caps["student-solve"].enableBlankSolve);
      if (mode === "student-solve") {
        const input = page.getByRole("textbox");
        await input.fill("고조선");
        assert.equal(
          await page.evaluate(() => window.annotationQa.answers.blank),
          "고조선",
        );
      }
      if (mode === "teacher-present" || mode === "presentation") {
        const anchor = page.getByRole("button", { name: "각주 제목" });
        if (await anchor.count()) await anchor.click();
        else await page.locator("[data-footnote-anchor]").first().click();
        if (mode === "presentation") {
          await page.getByText("보존된 각주 내용").waitFor();
          await page
            .getByRole("button", { name: "닫기", exact: true })
            .last()
            .click();
        } else
          assert.equal(
            await page.evaluate(() => window.annotationQa.footnotes),
            1,
          );
      }
      const next = page.getByRole("button", {
        name: mode === "student-solve" ? "다음 페이지" : "다음",
        exact: true,
      });
      await next.click();
      await page.waitForFunction(() =>
        document.querySelector("img")?.getAttribute("src")?.includes("p=2"),
      );
      assert.equal(await page.evaluate(() => window.annotationQa.changes), 0);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      await page.screenshot({
        path: path.join(evidence, `${mode}-${width}.png`),
        fullPage: true,
      });
      results.push({
        mode,
        width,
        annotationsDisabled: true,
        pageNavigation: true,
      });
      await page.close();
    }
  await fs.writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify({ evidence, results }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
