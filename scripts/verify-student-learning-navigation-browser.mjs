/** Real student navigation with synthetic services; no attempts, saves, or live reads. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const root = process.cwd();
const baseline = process.argv.includes("--baseline");
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence =
  process.env.STUDENT_LEARNING_NAV_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-learning-navigation-")));
await fs.mkdir(evidence, { recursive: true });
const service = `
export const qa=window.learningNavigationQa={reads:[],writes:[]};
export const db={};export const doc=()=>{throw Error('Unexpected document access')};export const getDoc=doc;
const config={year:'2026',semester:'2'};const currentUser={uid:'synthetic-student'};
export const useAuth=()=>({config,currentUser,userData:{uid:currentUser.uid,grade:3,class:1},menuConfig:{}});
export const getYearSemester=()=>({year:'2026',semester:'2'});
const tree=[{id:'big',title:'합성 대단원',children:[{id:'mid',title:'합성 중단원',children:[{id:'a',title:'합성 자료 A'},{id:'b',title:'합성 자료 B'}]}]}];
export const readStudentVisibleCurriculumTree=async()=>{qa.reads.push('lesson-tree');return tree};
export const readStudentCurriculumTree=async()=>{qa.reads.push('quiz-tree');return tree};
export const getAssessmentConfigKey=(unit,category,round)=>unit+'_'+category+(round?'__'+round:'');
export const readAssessmentConfigMap=async()=>{qa.reads.push('assessment-config');return Object.fromEntries([1,2,3].map(n=>['exam_prep_exam_prep__round_'+n,{active:true,questionCount:3,timeLimit:60}]))};
export const isAssessmentVisibleToStudent=entry=>!!entry?.active;
export const getMockExamOverview=async()=>{qa.reads.push('overview');return{semesterId:'2026-2',rounds:[1,2,3].map(n=>({examRound:'round_'+n,prerequisiteMet:true,completed:false}))}};
`;
const entry = `
import React from 'react';import{createRoot}from'react-dom/client';import{HashRouter,Routes,Route,useNavigate,useLocation}from'react-router-dom';
import QuizIndex from './src/pages/student/quiz/QuizIndex';import Note from './src/pages/student/lesson/Note';import QuizLearningResult from './src/pages/student/quiz/QuizLearningResult';
import './src/assets/index.css';import './src/components/layout/teacherLayout.css';import './src/components/layout/studentLayout.css';import './src/pages/student/quiz/QuizLearning.css';
function Probe(){const navigate=useNavigate();const location=useLocation();window.fixtureNavigate=navigate;window.fixtureRoute=location.pathname+location.search;return null}
function Headers(){return <><div className="student-quiz-learning"><header className="student-quiz-topbar"><strong>합성 평가 도구막대</strong><span>01:00</span></header></div><QuizLearningResult assessmentTitle="합성 평가 결과" unitTitle="합성 단원" score={80} correctCount={4} totalCount={5} onReview={()=>{}} onRetry={()=>{}}/></>}
createRoot(document.getElementById('root')).render(<HashRouter><Probe/><div className="student-layout"><Routes><Route path="/student/quiz" element={<QuizIndex/>}/><Route path="/student/lesson/note" element={<Note/>}/><Route path="/headers" element={<Headers/>}/><Route path="*" element={<p>합성 연결 화면</p>}/></Routes></div></HashRouter>);
`;
const baselineFiles = new Set([
  "src/pages/student/quiz/QuizIndex.tsx",
  "src/pages/student/quiz/QuizLearning.css",
  "src/pages/student/lesson/components/LessonSidebar.tsx",
]);
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  metafile: true,
  outdir: "fixture",
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  loader: {
    ".woff": "dataurl",
    ".woff2": "dataurl",
    ".webp": "dataurl",
    ".svg": "dataurl",
  },
  plugins: [
    {
      name: "synthetic-services",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /(?:^|\/)(AuthContext|studentLessonReadCache|semesterScope|assessmentConfig|assessmentLifecycle|firebase)$|^firebase\/firestore$/,
          },
          () => ({ path: "service", namespace: "offline" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
          contents: service,
          loader: "js",
        }));
        builder.onResolve(
          { filter: /(?:^|\/)(LessonContent|QuizRelearning)$/ },
          (args) => ({ path: args.path, namespace: "content-stub" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "content-stub" }, (args) => ({
          contents: args.path.endsWith("LessonContent")
            ? "import React from 'react';export default function Content({unitId}){return <p>선택 자료 {unitId}</p>}"
            : "export default function Relearning(){return null}",
          loader: "tsx",
          resolveDir: root,
        }));
        if (baseline)
          builder.onLoad({ filter: /\.(tsx|css)$/ }, (args) => {
            const relative = path
              .relative(root, args.path)
              .replaceAll("\\", "/");
            if (!baselineFiles.has(relative)) return;
            return {
              contents: execFileSync("git", ["show", `HEAD:${relative}`], {
                cwd: root,
                encoding: "utf8",
              }),
              loader: relative.endsWith("css") ? "css" : "tsx",
              resolveDir: path.dirname(args.path),
            };
          });
      },
    },
  ],
});
assert(
  !Object.keys(built.metafile.inputs).some((name) =>
    /node_modules[\\/](?:@firebase|firebase)[\\/]/.test(name),
  ),
  "Fixture must exclude live Firebase",
);
const js = built.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = built.outputFiles
  .filter((file) => file.path.endsWith(".css"))
  .map((file) => file.text)
  .join("\n")
  .replaceAll(/@import[^;]+;/g, "");
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>';
const server = http.createServer((request, response) => {
  const [type, body] = {
    "/app.js": ["text/javascript", js],
    "/app.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  }[new URL(request.url, "http://localhost").pathname] || ["text/html", html];
  response.setHeader("Content-Type", `${type};charset=utf-8`);
  response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const report = { baseline, checks: [], errors: [], external: [] };
try {
  for (const width of [390, 768, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
    });
    await context.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : (report.external.push(route.request().url()), route.abort()),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    const click = async (locator) =>
      width === 390 ? locator.tap() : locator.click();
    const observe = async (name, action) => {
      try {
        await action();
        report.checks.push({ width, name, passed: true });
      } catch (error) {
        if (!baseline) throw error;
        report.checks.push({
          width,
          name,
          passed: false,
          message: error.message,
        });
      }
    };
    await observe("quiz URL, return, history and reload", async () => {
      await page.goto(`${origin}/#/student/quiz?keep=preserved`);
      const tab = (name) => page.getByRole("tab", { name, exact: true });
      await tab("단원별 평가").waitFor();
      assert.deepEqual(await page.evaluate(() => learningNavigationQa.reads), [
        "quiz-tree",
        "assessment-config",
      ]);
      await tab("단원별 평가").press("ArrowRight");
      await page.getByRole("button", { name: /2회.*응시 가능/ }).waitFor();
      await click(page.getByRole("button", { name: /2회.*응시 가능/ }));
      assert(
        page.url().includes("tab=mock") && page.url().includes("round=round_2"),
        "Tab and round changes must update the URL",
      );
      assert(page.url().includes("keep=preserved"));
      const reads = await page.evaluate(() =>
        learningNavigationQa.reads.slice(),
      );
      assert.deepEqual(reads, ["quiz-tree", "assessment-config", "overview"]);
      await page.screenshot({
        path: path.join(evidence, `quiz-navigation-${width}.png`),
        fullPage: true,
      });
      await page.goBack();
      await page.waitForFunction(() => !location.hash.includes("round="));
      assert.equal(
        await page
          .getByRole("button", { name: /1회.*응시 가능/ })
          .getAttribute("aria-pressed"),
        "true",
      );
      await page.goForward();
      await page.waitForFunction(() => location.hash.includes("round=round_2"));
      assert.equal(
        await page
          .getByRole("button", { name: /2회.*응시 가능/ })
          .getAttribute("aria-pressed"),
        "true",
      );
      await tab("모의고사").press("Home");
      assert.equal(
        await tab("단원별 평가").getAttribute("aria-selected"),
        "true",
      );
      await tab("단원별 평가").press("End");
      assert.equal(
        await page
          .getByRole("button", { name: /2회.*응시 가능/ })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.deepEqual(
        await page.evaluate(() => learningNavigationQa.reads),
        reads,
        "Tab, round, back and forward must add no reads",
      );
      await page.reload();
      await page.getByRole("button", { name: /2회.*응시 가능/ }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: /2회.*응시 가능/ })
          .getAttribute("aria-pressed"),
        "true",
      );
      await click(page.getByRole("button", { name: "오답 노트", exact: true }));
      await page.getByText("합성 연결 화면").waitFor();
      await page.goBack();
      await page.getByRole("button", { name: /2회.*응시 가능/ }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: /2회.*응시 가능/ })
          .getAttribute("aria-pressed"),
        "true",
      );
      await page.goto(`${origin}/?case=legacy#/student/quiz?round=round_3`);
      await page.getByRole("button", { name: /3회.*응시 가능/ }).waitFor();
      assert.equal(
        await tab("모의고사").getAttribute("aria-selected"),
        "true",
        "Legacy round-only links remain valid",
      );
      await page.goto(
        `${origin}/?case=retained#/student/quiz?tab=units&round=round_3`,
      );
      await tab("단원별 평가").waitFor();
      assert.equal(
        await tab("단원별 평가").getAttribute("aria-selected"),
        "true",
      );
      assert.deepEqual(
        await page.evaluate(() => learningNavigationQa.reads),
        ["quiz-tree", "assessment-config"],
        "A retained round must not fetch mock overview on the units tab",
      );
    });
    await observe("lesson selected ancestors and manual folding", async () => {
      await page.goto(
        `${origin}/?case=lesson#/student/lesson/note?id=a&title=A`,
      );
      await page.getByText("선택 자료 a").waitFor();
      const disclosure = page.locator(".teacher-settings-menu-toggle");
      if (await disclosure.isVisible()) await click(disclosure);
      const big = page.getByRole("button", {
        name: "합성 대단원",
        exact: true,
      });
      const mid = page.getByRole("button", {
        name: "합성 중단원",
        exact: true,
      });
      const chevronCount = await big.locator("svg").count();
      await mid.press("Enter");
      await big.press("Enter");
      assert.equal(await big.getAttribute("aria-expanded"), "false");
      await page.evaluate(() =>
        fixtureNavigate("/student/lesson/note?id=b&title=B"),
      );
      await page.getByText("선택 자료 b").waitFor();
      assert.equal(await big.getAttribute("aria-expanded"), "true");
      assert.equal(await mid.getAttribute("aria-expanded"), "true");
      assert.equal(
        await page
          .getByRole("button", { name: "합성 자료 B", exact: true })
          .getAttribute("aria-current"),
        "page",
      );
      await mid.press("Enter");
      await big.press("Enter");
      await page.goBack();
      await page.getByText("선택 자료 a").waitFor();
      assert.equal(await big.getAttribute("aria-expanded"), "true");
      assert.equal(await mid.getAttribute("aria-expanded"), "true");
      await page.goForward();
      await page.getByText("선택 자료 b").waitFor();
      await big.press("Enter");
      await page.evaluate(() =>
        fixtureNavigate("/student/lesson/note?id=b&title=Changed"),
      );
      assert.equal(
        await big.getAttribute("aria-expanded"),
        "false",
        "Same selection preserves manual folding",
      );
      assert.deepEqual(
        await page.evaluate(() => learningNavigationQa.reads),
        ["lesson-tree"],
        "Navigation does not reload the curriculum",
      );
      assert.equal(
        chevronCount,
        1,
        "Every collapsible curriculum level has a chevron",
      );
      await big.press("Enter");
      await page.screenshot({
        path: path.join(evidence, `lesson-navigation-${width}.png`),
        fullPage: true,
      });
      await page.reload();
      await page.getByText("선택 자료 b").waitFor();
      if (await disclosure.isVisible()) await click(disclosure);
      assert.equal(await big.getAttribute("aria-expanded"), "true");
    });
    await observe("quiz header global reset", async () => {
      await page.goto(`${origin}/#/headers`);
      await page.getByText("합성 평가 결과", { exact: true }).waitFor();
      const styles = await page
        .locator(".student-quiz-topbar,.student-quiz-result-heading")
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const style = getComputedStyle(node);
            return {
              position: style.position,
              minHeight: style.minHeight,
              background: style.backgroundColor,
              top: style.top,
              zIndex: style.zIndex,
              shadow: style.boxShadow,
            };
          }),
        );
      for (const style of styles)
        assert.deepEqual(style, {
          position: "static",
          minHeight: "0px",
          background: "rgba(0, 0, 0, 0)",
          top: "auto",
          zIndex: "auto",
          shadow: "none",
        });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.deepEqual(
        await page.evaluate(() => learningNavigationQa?.writes || []),
        [],
      );
      await page.screenshot({
        path: path.join(evidence, `headers-${width}.png`),
        fullPage: true,
      });
    });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.external, []);
  report.passed = report.checks.every((check) => check.passed);
  if (baseline)
    assert(
      report.checks.some((check) => !check.passed),
      "Baseline must reproduce a navigation or header defect",
    );
  await fs.writeFile(
    path.join(evidence, baseline ? "baseline.json" : "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ ...report, evidence }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
