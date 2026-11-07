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
const root = process.cwd(),
  evidence = path.join(root, "output", "achievement-analysis");
await fs.mkdir(evidence, { recursive: true });
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const code = "9역10-02",
  cutoff = "2026-11-06T00:00:00.000Z";
const meta = {
  curriculumVersion: "2018-162",
  achievementStandardCodes: [code],
  achievementMappingSource: "manual",
  targetAchievementLevel: "C",
  intendedDifficulty: "medium",
  unitId: "unit-a",
  subUnitId: "leaf",
};
const questions = Array.from({ length: 6 }, (_, i) => ({
  id: `q${i + 1}`,
  docId: `q${i + 1}`,
  ...meta,
  familyId: `q${i + 1}`,
  sourceRevision: "2",
  contentRevision: 2,
  category: "exam_prep",
  examRound: "round_1",
  paperOrder: i + 1,
  type: "choice",
  points: i % 2 ? 2 : 3,
  question: `조선의 정치 변화에 대한 설명으로 옳은 것은? (${i + 1})`,
  answer: "사림",
  options: ["훈구", "사림", "권문세족", "신진 사대부", "호족"],
  passage: "제시문 원문 보존 검증: 향촌 사회를 기반으로 성장하였다.",
  examplePassage: "ㄱ. 서원\nㄴ. 향약",
  explanation: "해설 원문 보존 검증: 사림은 향촌 사회에 기반을 두었다.",
  passageSet:
    i < 2
      ? {
          id: "set1",
          instruction: "공통 자료를 읽고 물음에 답하시오.",
          passage: "공통 지문 원문 보존 검증",
        }
      : null,
}));
const students = Array.from({ length: 24 }, (_, i) => ({
  uid: `s${i}`,
  name: `합성학생${i + 1}`,
  number: String(i + 1),
  classId: "class_1",
}));
const rawRows = students.map((student, i) => ({
  id: `exam${i}`,
  source: "canonical",
  raw: {
    assessmentKind: "QUIZ",
    semesterId: "2026-2",
    studentUid: student.uid,
    attemptId: `exam${i}`,
    sourceId: "unit-a",
    category: "exam_prep",
    examRound: "round_1",
    submittedAtIso: "2026-11-06T01:00:00Z",
    percent: Math.round(((6 - (i % 7)) / 6) * 100),
    total: 6,
    maxPoints: 15,
    learningSnapshot: questions.map((q) => ({ ...q })),
    questionSnapshotRefs: questions.map((q) => q.id),
    answers: Object.fromEntries(
      questions.map((q, j) => [
        q.id,
        j < 6 - (i % 7) ? "사림" : i % 3 ? "훈구" : "",
      ]),
    ),
    answerChecks: questions.map((q, j) => ({
      id: q.id,
      correct: j < 6 - (i % 7),
    })),
  },
}));
const fixture = {
  semesterId: "2026-2",
  students,
  questions,
  rawRows,
  historicalQuestionSnapshots: Object.fromEntries(
    questions.map((q) => [q.id, q]),
  ),
  treeData: [
    {
      id: "big",
      title: "조선",
      children: [
        {
          id: "unit-a",
          title: "조선의 성립과 발전",
          children: [{ id: "leaf", title: "사림 세력의 성장" }],
        },
      ],
    },
  ],
  configuredClasses: [{ id: "class_1", label: "3학년 1반" }],
  generatedAt: cutoff,
  version: "fixture1",
  complete: true,
  canReview: true,
  rubricVersion: "2018-history2-adapted-2025-v1",
  profiles: students
    .slice(0, 20)
    .map((s, i) => ({
      studentUid: s.uid,
      standardCode: code,
      curriculumVersion: "2018-162",
      level: ["A", "B", "C", "D", "E"][Math.floor(i / 4)],
      asOf: cutoff,
      reviewedAt: "2026-11-07T00:00:00Z",
      examAttemptId: `exam${i}`,
      revision: 1,
      rubricVersion: "2018-history2-adapted-2025-v1",
    })),
  achievementEvidence: {
    version: 1,
    status: "ready",
    observations: students.flatMap((s) => [
      ...Array.from({ length: 4 }, (_, i) => ({
        ...meta,
        id: `${s.uid}p${i}`,
        resultId: `prior${s.uid}${i}`,
        questionId: `p${i}`,
        studentUid: s.uid,
        semesterId: "2026-2",
        source: i % 2 ? "diagnostic" : "formative",
        itemId: `p${i}`,
        familyId: `p${i}`,
        sourceRevision: "1",
        observedAt: "2026-11-05T00:00:00Z",
        correct: i !== 3,
        filled: true,
        hintViewed: false,
        quality: "complete",
        recordSource: "canonical",
      })),
      {
        ...meta,
        id: `${s.uid}w`,
        studentUid: s.uid,
        semesterId: "2026-2",
        source: "worksheet",
        itemId: "w1",
        sourceRevision: "1",
        observedAt: "2026-11-05T00:00:00Z",
        correct: null,
        filled: false,
        hintViewed: null,
        quality: "limited",
      },
    ]),
    examCutoffs: students.map((s, i) => ({
      studentUid: s.uid,
      resultId: `exam${i}`,
      attemptId: `exam${i}`,
      startedAt: cutoff,
    })),
    exclusions: {},
  },
};
const service = `const data=window.fixture=${JSON.stringify(fixture)};if(new URLSearchParams(location.search).get('grade')){data.grade='3';data.configuredClasses.push({id:'class_2',label:'3학년 2반'});data.students.slice(12).forEach(student=>student.classId='class_2');}window.qa={calls:[],saves:[]};export const callWithApplicationSession=async(name,request)=>{window.qa.calls.push(request);return {data:structuredClone(data)};};export const executeLearningCommand=async(name,payload)=>{window.qa.saves.push({name,payload});const index=data.profiles.findIndex(p=>p.studentUid===payload.studentUid&&p.standardCode===payload.standardCode);const p={...payload,asOf:${JSON.stringify(cutoff)},reviewedAt:'2026-11-07T01:00:00Z',curriculumVersion:'2018-162',revision:payload.expectedRevision+1};if(index<0)data.profiles.push(p);else data.profiles[index]=p;return {result:p};};export const useAppToast=()=>({showToast:()=>{}});`;
const entry = `import React,{useEffect,useRef}from'react';import{createRoot}from'react-dom/client';import View from ${imp("src/pages/teacher/components/QuizAchievementAnalysis.tsx")};import ${imp("src/pages/teacher/components/QuizClassAnalysis.css")};import ${imp("src/components/common/portalPage.css")};const grade=new URLSearchParams(location.search).get('grade');function App(){const ref=useRef(null);useEffect(()=>{ref.current.showModal()},[]);return <section className="quiz-class-analysis"><dialog ref={ref} className="qca-detail-dialog"><header className="qca-detail-header"><h2>3학년 {grade?'전체':'1반'} · 성취기준 분석</h2></header><div className="qca-detail-body"><View scope={{semesterId:'2026-2',unitId:'unit-a',category:'exam_prep',examRound:'round_1',classIds:grade?[]:['class_1'],...(grade?{grade}: {})}} identityKey="fixture" canEdit={true}/></div></dialog></section>;}createRoot(document.getElementById('root')).render(<App/>);`;
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
      name: "isolate",
      setup(p) {
        p.onResolve(
          {
            filter:
              /(?:^|\/)(applicationSession|learningCommands|AppToastProvider)$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        p.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "ts",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text,
  css = bundle.outputFiles.find((f) => f.path.endsWith(".css")).text;
const base =
  "body{margin:0;font-family:Arial,sans-serif;background:#f8fafc}*{box-sizing:border-box}button,input,select{font:inherit}button{border:0;background:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}";
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((req, res) => {
  const route = new URL(req.url, "http://localhost").pathname;
  res.setHeader(
    "Content-Type",
    route.endsWith(".js")
      ? "text/javascript"
      : route.endsWith(".css")
        ? "text/css"
        : "text/html",
  );
  res.end(
    route.endsWith(".js") ? js : route.endsWith(".css") ? base + css : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const errors = [],
  shots = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await page.goto(origin);
  await page
    .getByRole("combobox", { name: "성취기준", exact: true })
    .selectOption(code);
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (let view = 0; view < 6; view++) {
      await page
        .getByRole("combobox", { name: "분석 보기", exact: true })
        .selectOption(String(view));
      await page
        .locator(".qca-detail-body")
        .evaluate((el) => (el.scrollTop = 0));
      await page.screenshot({
        path: path.join(evidence, `${width}-view${view}.png`),
        fullPage: true,
      });
      shots.push(`${width}-view${view}.png`);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `document overflow ${width} view${view}`,
      );
      const large = await page
        .locator(".qaa-toolbar")
        .evaluate((el) =>
          [...el.querySelectorAll("select,button")]
            .filter((x) => x.getBoundingClientRect().height > 36)
            .map((x) => ({
              tag: x.tagName,
              height: x.getBoundingClientRect().height,
            })),
        );
      assert.deepEqual(large, [], `compact toolbar ${width}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const readsBeforeEstimates = await page.evaluate(() => window.qa.calls.length);
  await page.getByRole("combobox", { name: "분석 보기", exact: true }).selectOption("5");
  const cutTable = page.getByRole("table", { name: "성취수준별 추정 분할점수", exact: true });
  assert.deepEqual(await cutTable.locator("thead th").allTextContents(), ["구분", "A/B", "B/C", "C/D", "D/E", "E/미분류"]);
  assert.doesNotMatch(await cutTable.innerText(), /미만/, "Each boundary displays its own model estimate");
  assert.ok((await cutTable.innerText()).includes("점"), "Estimated cuts exist with supplied question metadata");
  assert.equal(await page.getByRole("table", { name: "난도별 A–E 예상 성취율", exact: true }).locator("thead th").count(), 8);
  await page.getByText("학생별 추정 수준과 성취수준 준거", { exact: true }).click();
  const inferred = page.getByRole("table", { name: "학생별 현재 성취수준 추정", exact: true });
  await inferred.locator("tbody tr").first().waitFor();
  assert.equal(await inferred.locator("tbody tr").count(), students.length);
  assert.ok((await inferred.locator("tbody tr").first().innerText()).includes("추정"));
  assert.equal(await page.evaluate(() => window.qa.calls.length), readsBeforeEstimates, "Viewing estimates must never fetch more student records");
  assert.equal(await page.evaluate(() => window.qa.saves.length), 0, "Estimates must never save student levels or scores");
  await page
    .getByRole("combobox", { name: "분석 보기", exact: true })
    .selectOption("1");
  await page.getByRole("button", { name: "1번", exact: true }).first().click();
  await page.getByText("공통 지문 원문 보존 검증", { exact: true }).waitFor();
  await page
    .getByText("해설 원문 보존 검증: 사림은 향촌 사회에 기반을 두었다.", {
      exact: true,
    })
    .waitFor();
  await page.screenshot({
    path: path.join(evidence, "question-preview.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "분석으로 돌아가기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "1번 수준 프로필 그래프", exact: true })
    .click();
  assert.equal(await page.locator(".qaa-profile-chart").count(), 1);
  const choices = page.getByRole("region", {
    name: "성취수준별 선택 선지",
    exact: true,
  });
  assert.equal(await choices.locator("tbody tr").count(), 7);
  await page
    .getByRole("combobox", { name: "분석 보기", exact: true })
    .selectOption("3");
  await page.getByRole("button", { name: "수준 준거", exact: true }).click();
  assert.equal(await page.locator(".qaa-rubric dt").count(), 5);
  await page
    .getByRole("button", { name: "근거 보기", exact: true })
    .first()
    .click();
  await page
    .getByRole("region", { name: "선택 학생의 사전 학습 근거", exact: true })
    .waitFor();
  await page
    .getByRole("combobox", { name: "합성학생21 성취수준", exact: true })
    .selectOption("C");
  const studentRow = page
    .getByRole("row")
    .filter({
      has: page.getByRole("combobox", {
        name: "합성학생21 성취수준",
        exact: true,
      }),
    });
  await studentRow.getByRole("checkbox").check();
  await studentRow.getByRole("button", { name: "저장", exact: true }).click();
  await page.waitForFunction(
    () => window.qa.saves.length === 1 && window.qa.calls.length >= 2,
  );
  assert.equal(
    await page.evaluate(() => window.qa.saves[0].payload.expectedRubricVersion),
    fixture.rubricVersion,
  );
  await page.goto(`${origin}/?grade=3`);
  await page.getByRole('combobox',{name:'성취기준',exact:true}).selectOption(code);
  await page.getByRole('combobox',{name:'분석 보기',exact:true}).selectOption('3');
  const gradeStudent=page.getByRole('row').filter({has:page.getByRole('combobox',{name:'3학년 2반 21번 합성학생21 성취수준',exact:true})});
  await gradeStudent.getByRole('combobox').selectOption('C');
  await gradeStudent.getByRole('checkbox').check();
  await gradeStudent.getByRole('button',{name:'저장',exact:true}).click();
  await page.waitForFunction(()=>window.qa.saves.length===1&&window.qa.calls.length>=2);
  const gradeSave=await page.evaluate(()=>window.qa.saves[0].payload);
  assert.equal(gradeSave.classId,'class_2','Whole-grade review saves to the selected student actual class');
  assert.equal(gradeSave.studentUid,'s20');
  assert.equal(await page.evaluate(()=>window.qa.calls[0].grade),'3');
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, "verification.json"),
    JSON.stringify(
      {
        widths: [390, 768, 1280],
        views: 6,
        screenshots: shots,
        errors,
        checks: [
          "no document overflow",
          "compact toolbar",
          "snapshot passage and explanation",
          "level choices",
          "profile graph",
          "rubric",
          "evidence details",
          "profile save",
          "whole-grade review saves the actual student class",
          "current level and weighted cut estimates with zero extra reads or writes",
        ],
      },
      null,
      2,
    ),
  );
  console.log(`Achievement browser verified: ${evidence}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
