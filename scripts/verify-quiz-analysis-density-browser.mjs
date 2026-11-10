import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const root = process.cwd();
const evidence = path.join(root, "output", "quiz-analysis-density");
await fs.mkdir(evidence, { recursive: true });
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const questions = Array.from({ length: 23 }, (_, index) => ({
  id: `q${index + 1}`,
  docId: `q${index + 1}`,
  familyId: `q${index + 1}`,
  unitId: "exam_prep",
  subUnitId: "leaf",
  category: "exam_prep",
  examRound: "round_1",
  sourceRevision: "1",
  contentRevision: 1,
  curriculumVersion: "2018-162",
  achievementStandardCodes: ["9역10-02"],
  achievementMappingSource: "manual",
  targetAchievementLevel: "C",
  intendedDifficulty: "medium",
  paperOrder: index + 1,
  type: "choice",
  points: 4,
  question: `${index + 1}번 합성 문항`,
  answer: "정답",
  options: ["정답", "보기 2", "보기 3", "보기 4", "보기 5"],
}));
const students = Array.from({ length: 32 }, (_, index) => ({
  uid: `synthetic-${index + 1}`,
  name: index === 0 ? "가상이름이긴학생" : `가상학생${index + 1}`,
  number: String(index + 1),
  classId: "class_1",
}));
const rawRows = students.map((student, index) => {
  const answers = questions.map((question, q) => ({
    id: question.id,
    correct: (q * 11 + index * 7) % 32 < 31 - q,
  }));
  const correct = answers.filter((answer) => answer.correct).length;
  return {
    id: `attempt-${index}`,
    source: "canonical",
    raw: {
      assessmentKind: "QUIZ",
      studentUid: student.uid,
      semesterId: "2026-2",
      sourceId: "exam_prep",
      category: "exam_prep",
      examRound: "round_1",
      attemptId: `attempt-${index}`,
      submittedAtIso: "2026-11-08T09:00:00Z",
      startedAtIso: "2026-11-08T08:30:00Z",
      percent: (100 * correct) / 23,
      total: 23,
      earnedPoints: correct * 4,
      maxPoints: 92,
      answerChecks: answers,
      answers: Object.fromEntries(
        answers.map((answer) => [
          answer.id,
          answer.correct ? "정답" : "보기 2",
        ]),
      ),
      learningSnapshot: questions,
      questionSnapshotRefs: questions.map((question) => question.id),
      cutScoreQuestions: questions.map(
        ({ id, points, targetAchievementLevel, intendedDifficulty }) => ({
          id,
          points,
          targetAchievementLevel,
          intendedDifficulty,
        }),
      ),
    },
  };
});
const fixture = {
  semesterId: "2026-2",
  complete: true,
  students,
  questions,
  rawRows,
  mockExamScoreRows: rawRows,
  historicalQuestionSnapshots: Object.fromEntries(
    questions.map((question) => [question.id, question]),
  ),
  treeData: [],
  configuredClasses: [{ id: "class_1", label: "3학년 1반" }],
  generatedAt: "2026-11-09T09:00:00Z",
  version: "fixture",
};
const service = `window.densityQa={reads:0,writes:0};const fixture=${JSON.stringify(fixture)};if(new URLSearchParams(location.search).has('grade')){fixture.grade='3';fixture.configuredClasses.push({id:'class_2',label:'3학년 2반'});fixture.students.slice(16).forEach(student=>student.classId='class_2');}export const callWithApplicationSession=async()=>{window.densityQa.reads++;return {data:structuredClone(fixture)}};export const executeLearningCommand=async()=>{window.densityQa.writes++;throw new Error('No writes allowed')};export const useAppToast=()=>({showToast:()=>{}});`;
const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import Analysis from ${imp("src/pages/teacher/components/QuizAchievementAnalysis.tsx")};
import Navigation from ${imp("src/pages/teacher/components/TeacherSubNavigation.tsx")};
import ${imp("src/pages/teacher/components/QuizClassAnalysis.css")};
import ${imp("src/components/common/portalPage.css")};
import ${imp("src/components/layout/teacherLayout.css")};
function App(){const[collapsed,setCollapsed]=useState(false),[open,setOpen]=useState(false),[view,setView]=useState(4);return <div className={'teacher-layout density-shell'+(collapsed?' is-sidebar-collapsed':'')}><aside className={"density-primary teacher-sidebar"+(collapsed?" is-collapsed":"")}><button type="button" onClick={()=>setCollapsed(!collapsed)} aria-expanded={!collapsed}>주 메뉴 {collapsed?'펼치기':'접기'}</button></aside><div className="density-main"><div className="teacher-sub-workspace teacher-sub-workspace--page"><Navigation title="평가 목차" activeLabel="모의고사" open={open} onOpenChange={setOpen}><button type="button">모의고사</button>{['통치 체제와 대외 관계','사림 세력과 정치 변화','문화의 발달과 사회 변동','왜란·호란의 발발과 영향','조선 후기의 정치 변동'].map(label=><p key={label}>{label}</p>)}</Navigation><main className="teacher-sub-content"><h1>평가 관리</h1><section className="quiz-class-analysis"><label>분석 항목<select aria-label="분석 항목" value={view} onChange={event=>setView(Number(event.target.value))}><option value="0">전체 분포</option><option value="1">문항별 분석</option><option value="3">회차별 점수·수준</option><option value="4">S–P표</option></select></label><Analysis scope={{semesterId:'2026-2',unitId:'exam_prep',category:'exam_prep',examRound:'round_1',...(new URLSearchParams(location.search).has('grade')?{grade:'3',classIds:[]}:{classIds:['class_1']})}} identityKey="density" canEdit={false} reportView={view}/></section></main></div></div></div>};createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  outfile: path.join(evidence, "fixture.js"),
  loader: { ".woff2": "dataurl", ".woff": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "read-only-fixture",
      setup(plugin) {
        plugin.onResolve({ filter: /\/useQuizClassUpdates$/ }, () => ({
          path: "live-updates",
          namespace: "fixture-live",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "fixture-live" }, () => ({
          contents: "export const useQuizClassUpdates=()=>{};",
          loader: "ts",
        }));
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)(applicationSession|learningCommands|AppToastProvider)$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "ts",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
// Primary-navigation widths reproduce MainLayout's expanded/collapsed content
// space; the workspace, secondary navigation and report are real components.
const base = `*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#f8fafc}button,input,select{font:inherit}button{border:0;background:none}h1{font-size:24px;margin:0 0 24px}h3{font-size:16px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.density-primary{position:fixed;inset:0 auto 0 0;background:white;border-right:1px solid #e5e7eb;padding:12px}.density-primary button{min-height:44px;cursor:pointer}.density-shell .teacher-sub-workspace{min-height:100vh}.density-shell .teacher-sub-navigation p{font-size:14px;padding:12px}.density-shell .teacher-sub-navigation button{padding:16px}.density-shell .quiz-class-analysis>label{display:flex;align-items:center;gap:12px}.density-shell select{height:44px;max-width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:white}@media(max-width:1023px){.density-primary{display:none}}`;
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((request, response) => {
  const route = new URL(request.url, "http://localhost").pathname;
  response.setHeader(
    "Content-Type",
    route.endsWith(".js")
      ? "text/javascript"
      : route.endsWith(".css")
        ? "text/css"
        : "text/html",
  );
  response.end(
    route.endsWith(".js") ? js : route.endsWith(".css") ? base + css : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  errors = [],
  measurements = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await page.goto(origin);
  const select = () =>
    page.getByRole("combobox", { name: "분석 항목", exact: true });
  await page.locator(".qaa-table--sp tbody tr").first().waitFor();
  for (const width of [1920, 1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 1080 });
    for (const view of [4, 1, 3]) {
      await select().selectOption(String(view));
      for (const collapsed of width >= 1280 ? [false, true] : [false]) {
        if (width >= 1280) {
          const toggle = page.locator(".density-primary button");
          if (
            ((await toggle.getAttribute("aria-expanded")) === "false") !==
            collapsed
          )
            await toggle.click();
        }
        const measure = await page
          .locator(".qaa-table-scroll")
          .first()
          .evaluate((element) => ({
            available: element.clientWidth,
            actual: element.scrollWidth,
            table: element.querySelector("table").getBoundingClientRect().width,
            font: getComputedStyle(element.querySelector("td")).fontSize,
          }));
        measurements.push({ width, view, collapsed, ...measure });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `page overflow at ${width}/${view}`,
        );
        if (width === 1920 || (width === 1440 && collapsed))
          assert.ok(
            measure.actual <= measure.available + 1,
            `23-item report fits desktop ${view}/${collapsed}: ${JSON.stringify(measure)}`,
          );
        if (view === 3) {
          const styles = await page
            .locator(".qaa-estimates .qaa-table")
            .evaluate((table) => ({
              background: getComputedStyle(table.parentElement).backgroundColor,
              border: getComputedStyle(
                table.querySelector("tbody tr:first-child td"),
              ).borderBottomWidth,
            }));
          assert.notEqual(styles.background, "rgba(0, 0, 0, 0)");
          assert.equal(styles.border, "1px");
        }
        await page.screenshot({
          path: path.join(
            evidence,
            `${width}-view${view}-${collapsed ? "collapsed" : "expanded"}.png`,
          ),
          fullPage: true,
        });
      }
    }
  }
  for (const width of [1920, 1440, 1280]) {
    for (const view of [1, 3, 4]) {
      const pair = measurements.filter(
        (row) => row.width === width && row.view === view,
      );
      assert.ok(
        pair[1].available - pair[0].available >= 142,
        `collapsing main navigation expands report at ${width}/${view}`,
      );
    }
  }
  checks.push(
    "23-item reports fit 1920px with primary navigation expanded and collapsed; reports use gained width at 1280/1440/1920px; 390/768px scrolling stays inside tables",
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await select().selectOption("1");
  assert.equal(await page.locator(".qaa-table--items small").count(), 0);
  const labels = await page
    .locator(".qaa-table--items thead th")
    .allTextContents();
  for (const option of ["1", "2", "3", "4", "5"])
    assert.ok(labels.includes(option));
  assert.ok(!labels.some((label) => label.includes("선지 ")));
  const help = page.locator(".qaa-value-help button").first();
  await help.hover();
  await page.getByRole("tooltip").filter({ hasText: "표본 32명" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "hidden" });
  await help.focus();
  await page.getByRole("tooltip").filter({ hasText: "표본 32명" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "hidden" });
  await help.click();
  await page.getByRole("tooltip").filter({ hasText: "표본 32명" }).waitFor();
  await page.getByRole("heading", { name: "평가 관리", exact: true }).click();
  await page.getByRole("tooltip").waitFor({ state: "hidden" });
  const defaultHelp = page.getByRole("button", {
    name: "문항 통계 계산",
    exact: true,
  });
  assert.equal(
    await defaultHelp.locator("svg.ws-info-help__icon").count(),
    1,
    "Existing InfoHelp keeps its default i icon",
  );
  await defaultHelp.focus();
  await page.getByRole("tooltip").filter({ hasText: "변별도 =" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "hidden" });
  checks.push(
    "numeric sample details support hover, keyboard focus, click, Escape and outside dismissal without inline sample clutter",
  );
  await select().selectOption("0");
  for (const width of [390, 768, 1280, 1366]) {
    await page.setViewportSize({ width, height: 768 });
    for (const name of ["신뢰도 계산", "측정 표준오차 계산"]) {
      const metricHelp = page.getByRole("button", { name, exact: true });
      await metricHelp.scrollIntoViewIfNeeded();
      const placement = await metricHelp.evaluate((button) => {
        const label = button.closest(".qaa-metric-label");
        if (!label) return null;
        const range = document.createRange();
        range.selectNodeContents(label.firstChild);
        const text = range.getBoundingClientRect();
        const icon = button.getBoundingClientRect();
        return {
          gap: icon.left - text.right,
          centerOffset: Math.abs(
            icon.y + icon.height / 2 - text.y - text.height / 2,
          ),
          width: label.clientWidth,
          scrollWidth: label.scrollWidth,
        };
      });
      assert.ok(placement, `${name} belongs to its metric label`);
      assert.ok(
        placement.gap >= 0 && placement.gap <= 8,
        `${name} stays adjacent at ${width}px`,
      );
      assert.ok(
        placement.centerOffset < 5,
        `${name} aligns with its label at ${width}px`,
      );
      assert.ok(placement.scrollWidth <= placement.width + 1);
      await metricHelp.focus();
      const popup = page.getByRole("tooltip");
      await popup.waitFor();
      assert.ok((await popup.getByRole("listitem").count()) >= 5);
      assert.match(await popup.textContent(), /의미와 활용/);
      assert.match(await popup.textContent(), /계산 기준/);
      const bounds = await popup.boundingBox();
      assert.ok(bounds.x >= 15 && bounds.x + bounds.width <= width - 15);
      assert.ok(bounds.y >= 15 && bounds.y + bounds.height <= 753);
      await page.screenshot({
        path: path.join(evidence, `${width}-${name}-help.png`),
      });
      await page.keyboard.press("Escape");
      await popup.waitFor({ state: "hidden" });
      await page.mouse.move(0, 0);
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  }
  checks.push(
    "reliability and SEM help stay beside their labels with readable bullet lists and bounded popovers at 390/768/1280/1366px",
  );
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const touchPage = await touch.newPage();
  await touchPage.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await touchPage.goto(origin);
  await touchPage
    .getByRole("combobox", { name: "분석 항목", exact: true })
    .selectOption("1");
  const touchHelp = touchPage.locator(".qaa-value-help button").first();
  await touchHelp.tap();
  await touchPage
    .getByRole("tooltip")
    .filter({ hasText: "표본 32명" })
    .waitFor();
  const touchBox = await touchHelp.boundingBox();
  assert.ok(touchBox.width >= 44 && touchBox.height >= 44);
  await touchPage
    .getByRole("heading", { name: "평가 관리", exact: true })
    .tap();
  await touchPage.getByRole("tooltip").waitFor({ state: "hidden" });
  await touchPage
    .getByRole("combobox", { name: "분석 항목", exact: true })
    .selectOption("0");
  const metricTouch = touchPage.getByRole("button", {
    name: "측정 표준오차 계산",
    exact: true,
  });
  await metricTouch.tap();
  await touchPage.getByRole("tooltip").filter({ hasText: "√(1−α)" }).waitFor();
  const metricTouchBox = await metricTouch.boundingBox();
  assert.ok(metricTouchBox.width >= 44 && metricTouchBox.height >= 44);
  await touchPage
    .getByRole("heading", { name: "평가 관리", exact: true })
    .tap();
  await touchPage.getByRole("tooltip").waitFor({ state: "hidden" });
  await touch.close();
  checks.push("390px touch opens and dismisses value help with 44px targets");
  assert.deepEqual(await page.evaluate(() => window.densityQa), {
    reads: 1,
    writes: 0,
  });
  await page.goto(`${origin}/?grade=1`);
  await page.locator(".qaa-table--sp tbody tr").first().waitFor();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.locator(".density-primary button").click();
  const gradeCells = await page
    .locator(".qaa-table--sp tbody th")
    .evaluateAll((cells) =>
      cells.map((cell) => ({
        text: cell.textContent,
        width: cell.clientWidth,
        content: cell.scrollWidth,
      })),
    );
  assert.ok(
    gradeCells.some(
      (cell) =>
        cell.text.includes("3학년 1반") &&
        cell.text.includes("가상이름이긴학생"),
    ),
  );
  assert.ok(
    gradeCells.every((cell) => cell.content <= cell.width + 1),
    "Whole-grade class labels and long names wrap within their own column",
  );
  await page.screenshot({
    path: path.join(evidence, "1440-whole-grade-long-name.png"),
    fullPage: true,
  });
  checks.push(
    "default i help still works; whole-grade labels and long names wrap without colliding with scores",
  );
  assert.deepEqual(errors, []);
  console.log(`PASS ${checks.join("; ")}`);
} finally {
  await browser.close();
  server.close();
  await fs.writeFile(
    path.join(evidence, "verification.json"),
    JSON.stringify({ checks, errors, measurements }, null, 2),
  );
  console.log(evidence);
}
