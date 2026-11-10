import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
import { gzipSync } from "node:zlib";
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
  image: "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="40"><rect width="240" height="40" fill="#e2e8f0"/><text x="12" y="26">Frozen original image</text></svg>').toString('base64'),
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
const correctFor = (studentIndex, itemIndex) =>
  studentIndex === 23
    ? [false, true, true, true, false, true][itemIndex]
    : itemIndex < 6 - (studentIndex % 7);
const makeRows = (round) =>
  students.map((student, index) => {
    const pattern = (index + round - 1) % students.length;
    const earnedPoints = questions.reduce(
      (sum, question, itemIndex) =>
        sum + (correctFor(pattern, itemIndex) ? question.points : 0),
      0,
    );
    return {
      id: `exam-${round}-${index}`,
      source: "canonical",
      raw: {
        analysisSourceVersion: "000000001793920000000000000",
        assessmentKind: "QUIZ",
        semesterId: "2026-2",
        studentUid: student.uid,
        attemptId: `exam-${round}-${index}`,
        sourceId: "unit-a",
        category: "exam_prep",
        examRound: `round_${round}`,
        submittedAtIso: `2026-11-0${5 + round}T01:00:00Z`,
        percent: (100 * earnedPoints) / 15,
        earnedPoints,
        total: 6,
        maxPoints: 15,
        learningSnapshot: questions.map((question) => ({ ...question })),
        questionSnapshotRefs: questions.map((question) => question.id),
        cutScoreQuestions: questions.map(
          ({ id, points, targetAchievementLevel, intendedDifficulty }) => ({
            id,
            points,
            targetAchievementLevel,
            intendedDifficulty,
          }),
        ),
        answers: Object.fromEntries(
          questions.map((question, itemIndex) => [
            question.id,
            correctFor(pattern, itemIndex) ? "사림" : index % 3 ? "훈구" : "",
          ]),
        ),
        answerChecks: questions.map((question, itemIndex) => ({
          id: question.id,
          correct: correctFor(pattern, itemIndex),
        })),
      },
    };
  });
const rawRows = makeRows(1);
const mockExamScoreRows = [1, 2, 3].flatMap(makeRows);
const fixture = {
  semesterId: "2026-2",
  students,
  questions: questions.map(question => ({...question, question: "현재 문제은행에서 변경된 발문"})),
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
  mockExamScoreRows,
};
const fixtures = {};
const encodedFixtures = {};
for (const round of [1, 2, 3]) for (const grade of [false, true]) for (const large of [false, true]) for (const inline of [false, true]) {
  const data = structuredClone(fixture);
  if (large) {
    for (let i = 24; i < 65; i++) {
      data.students.push({ ...data.students[i % 24], uid: `s${i}`, name: `합성학생${i + 1}`, number: String(i + 1) });
      for (const previous of mockExamScoreRows.filter(row => row.raw.studentUid === `s${i % 24}`)) {
        const row = structuredClone(previous);
        row.id = `exam-${row.raw.examRound.slice(6)}-${i}`;
        row.raw.studentUid = `s${i}`;
        row.raw.attemptId = row.id;
        data.mockExamScoreRows.push(row);
      }
    }
  }
  data.rawRows = data.mockExamScoreRows.filter((row) => row.raw.examRound === `round_${round}`);
  data.mockExamScoreRows = data.mockExamScoreRows.filter((row) => Number(row.raw.examRound.slice(6)) <= round);
  if (grade) {
    data.grade = "3";
    data.configuredClasses.push({ id: "class_2", label: "3학년 2반" });
    data.students.slice(12).forEach((student) => { student.classId = "class_2"; });
  }
  if (!inline) {
    data.analysisProjection = 'compact-v1';
    for (const row of [...data.rawRows, ...data.mockExamScoreRows]) {
      row.raw.questionSnapshots = questions.map(({ id, options, answer, points }) => ({ id, options, answer, points }));
      delete row.raw.questionSnapshotRefs;
    }
    delete data.historicalQuestionSnapshots;
    const original = data.rawRows[0];
    original.raw.questionSnapshotOmittedIds = ['q1'];
    data.rawRows.unshift({ id: original.id, source: 'legacy', raw: {
      uid: original.raw.studentUid, attemptId: original.raw.attemptId,
      analysisSourceVersion: 'legacy-older-version', semesterId: '2026-2', total: 1,
      details: [{id:'q1',correct:false}],
    }});

  }
  const key = `${round}:${grade}:${large}:${inline}`;
  fixtures[key] = data;
  const json = JSON.stringify(data);
  encodedFixtures[key] = {
    encoding: "gzip-base64", uncompressedBytes: Buffer.byteLength(json), payload: gzipSync(json).toString("base64"),
  };
}
const service = `const fixtures=${JSON.stringify(fixtures)};const originals=${JSON.stringify(questions)};const encoded=${JSON.stringify(encodedFixtures)};const query=new URLSearchParams(location.search);const round=Number(query.get('round')||1);const key=[round,Boolean(query.get('grade')),Boolean(query.get('large')),Boolean(query.get('inline'))].join(':');const data=window.fixture=fixtures[key];window.qa={calls:[],saves:[],questionMode:'ok',pending:[]};export const callWithApplicationSession=async(name,request)=>{window.qa.calls.push(request);if(request.mode==='question'){const result={semesterId:request.semesterId,sourceVersion:request.sourceVersion,question:originals.find(q=>q.id===request.questionId)||null};if(window.qa.questionMode==='error')throw new Error('문항 조회 실패');if(window.qa.questionMode==='missing'||data.rawRows.find(row=>row.id===request.resultId&&row.source===request.resultSource)?.raw.questionSnapshotOmittedIds?.includes(request.questionId)){result.question=null;result.missingReason='not-preserved';}if(window.qa.questionMode==='defer')await new Promise(resolve=>window.qa.pending.push(resolve));return {data:structuredClone(result)};}return {data:structuredClone(request.responseEncoding==='gzip-base64'?encoded[key]:data)};};export const executeLearningCommand=async(name,payload)=>{window.qa.saves.push({name,payload});throw new Error('Analysis must be read-only');};export const useAppToast=()=>({showToast:()=>{}});`;
const entry = `import React,{useEffect,useRef,useState}from'react';import{createRoot}from'react-dom/client';import View from ${imp("src/pages/teacher/components/QuizAchievementAnalysis.tsx")};import ${imp("src/pages/teacher/components/QuizClassAnalysis.css")};import ${imp("src/components/common/portalPage.css")};const query=new URLSearchParams(location.search);const grade=query.get('grade');const round=query.get('round')||'1';function App(){const ref=useRef(null);const[identity,setIdentity]=useState('fixture');const[scopeRound,setScopeRound]=useState(round);const[tick,setTick]=useState(0);window.changeIdentity=setIdentity;window.changeScope=setScopeRound;window.redraw=()=>setTick(tick+1);useEffect(()=>{ref.current.showModal()},[]);return <section className="quiz-class-analysis"><dialog ref={ref} className="qca-detail-dialog"><header className="qca-detail-header"><h2>3학년 {grade?'전체':'1반'} · 성취기준 분석</h2></header><div className="qca-detail-body"><View scope={{semesterId:'2026-2',unitId:'unit-a',category:'exam_prep',examRound:'round_'+scopeRound,classIds:grade?[]:['class_1'],...(grade?{grade}: {})}} identityKey={identity} canEdit={true}/></div></dialog></section>;}createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  outfile: path.join(evidence, "fixture.js"),
  loader: { ".woff2": "dataurl", ".woff": "dataurl", ".webp": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "isolate",
      setup(p) {
        p.onResolve(
          {
            filter:
              /(?:^|\/)(applicationSession|learningCommands|AppToastProvider|quizClassLive)$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        p.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service + "export const watchQuizClassChanges=()=>()=>{};",
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
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
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
      const large = await page.locator(".qaa-toolbar").evaluate((el) =>
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
  const initialReads = await page.evaluate(() => window.qa.calls.length);
  await page
    .getByRole("combobox", { name: "분석 보기", exact: true })
    .selectOption("4");
  const sp = page.getByRole("region", {
    name: "학생과 문항별 정오 S-P표",
    exact: true,
  });
  const counts = () =>
    sp
      .locator("tbody tr")
      .evaluateAll((rows) =>
        rows.map((row) => Number(row.querySelector("td").textContent)),
      );
  const descendingCounts = await counts();
  assert.deepEqual(
    descendingCounts,
    [...descendingCounts].sort((a, b) => b - a),
  );
  const colorCounts = await sp.locator("tbody tr").evaluateAll((rows) =>
    rows.map((row) => ({
      correct: Number(row.querySelector("td").textContent),
      filled: row.querySelectorAll(".qaa-sp-correct").length,
      wrong: row.querySelectorAll(".qaa-sp-incorrect").length,
    })),
  );
  colorCounts.forEach((row) => {
    assert.equal(row.filled, row.correct, "Every correct response is filled");
    assert.equal(
      row.wrong,
      questions.length - row.correct,
      "Wrong responses stay unfilled",
    );
  });
  const colors = await sp.evaluate((el) => ({
    correct: getComputedStyle(el.querySelector(".qaa-sp-correct"))
      .backgroundColor,
    wrong: getComputedStyle(el.querySelector(".qaa-sp-incorrect"))
      .backgroundColor,
    atypicalCorrect: getComputedStyle(
      el.querySelector(".qaa-sp-atypical.qaa-sp-correct"),
    ).backgroundColor,
  }));
  assert.notEqual(colors.correct, colors.wrong);
  assert.equal(
    colors.atypicalCorrect,
    colors.correct,
    "Atypical highlighting cannot replace correct-answer fill",
  );
  assert.ok(await sp.locator(".qaa-sp-s-boundary").count());
  await sp
    .getByRole("button", { name: "정답수 오름차순 정렬", exact: true })
    .click();
  assert.deepEqual(
    await counts(),
    [...descendingCounts].sort((a, b) => a - b),
  );
  assert.equal(
    await sp.locator(".qaa-sp-s-boundary,.qaa-sp-p-boundary").count(),
    0,
  );
  await sp
    .getByRole("button", { name: "정답수 내림차순 정렬", exact: true })
    .click();
  const responsePairs = () =>
    sp.locator("tbody tr").evaluateAll((rows) =>
      rows.map((row) => ({
        student: row.querySelector("th").textContent,
        answers: [...row.querySelectorAll(".qaa-sp-cell")]
          .map((cell) => cell.getAttribute("aria-label"))
          .sort(),
      })),
    );
  const originalPairs = await responsePairs();
  const originalColumns = await sp
    .locator("thead tr")
    .first()
    .locator("th")
    .evaluateAll((cells) =>
      cells.slice(4).map((cell) => cell.textContent.trim()),
    );
  const initialRates = await sp
    .locator("thead tr")
    .nth(1)
    .locator("th")
    .evaluateAll((cells) =>
      cells.slice(1).map((cell) => parseFloat(cell.textContent)),
    );
  assert.deepEqual(
    initialRates,
    [...initialRates].sort((a, b) => a - b),
    "S-P defaults to the hardest items on the left",
  );
  const mirroredBoundaries = await sp.locator("tbody tr").evaluateAll((rows) =>
    rows
      .filter((row) => row.querySelector(".qaa-sp-s-boundary"))
      .map((row) => ({
        correct: Number(row.querySelector("td").textContent),
        index: [...row.querySelectorAll(".qaa-sp-cell")].findIndex((cell) =>
          cell.classList.contains("qaa-sp-s-boundary--left"),
        ),
        count: row.querySelectorAll(".qaa-sp-cell").length,
      })),
  );
  mirroredBoundaries.forEach((row) =>
    assert.equal(
      row.index,
      row.count - row.correct,
      "S boundary moves to the left edge of the mirrored correct-answer region",
    ),
  );
  await sp
    .getByRole("button", { name: "문항 정답률 (%) 내림차순 정렬", exact: true })
    .click();
  assert.deepEqual(
    await sp
      .locator("thead tr")
      .first()
      .locator("th")
      .evaluateAll((cells) =>
        cells.slice(4).map((cell) => cell.textContent.trim()),
      ),
    [...originalColumns].reverse(),
    "Tied item columns also reverse exactly",
  );
  assert.deepEqual(
    await responsePairs(),
    originalPairs,
    "Reordering items keeps every student's response attached to its question",
  );
  const itemRates = await sp
    .locator("thead tr")
    .nth(1)
    .locator("th")
    .evaluateAll((cells) =>
      cells.slice(1).map((cell) => parseFloat(cell.textContent)),
    );
  assert.deepEqual(
    itemRates,
    [...itemRates].sort((a, b) => b - a),
  );
  assert.ok(
    await sp.locator(".qaa-sp-s-boundary,.qaa-sp-p-boundary").count(),
    "Mirrored and original item orders both preserve curves",
  );
  await sp
    .getByRole("button", { name: "주의지수 내림차순 정렬", exact: true })
    .click();
  assert.equal(
    await sp.locator("tbody tr").last().locator("td").nth(2).innerText(),
    "—",
    "Unavailable values stay last",
  );
  await sp
    .getByRole("button", { name: "학생 오름차순 정렬", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  assert.match(
    await sp.locator("tbody tr").first().locator("th").innerText(),
    /^합성학생1\(30101\)$/,
  );
  assert.equal(await page.evaluate(() => window.qa.calls.length), initialReads);
  await page
    .getByRole("combobox", { name: "분석 보기", exact: true })
    .selectOption("1");
  const itemTable = page.getByRole("region", {
    name: "문항별 통계와 학생 수준별 정답률",
    exact: true,
  });
  const correctRates = () =>
    itemTable
      .locator("tbody tr")
      .evaluateAll((rows) =>
        rows.map((row) =>
          parseFloat(row.querySelectorAll("td")[2].textContent),
        ),
      );
  await itemTable
    .getByRole("button", { name: "정답률 내림차순 정렬", exact: true })
    .click();
  const rates = await correctRates();
  assert.deepEqual(
    rates,
    [...rates].sort((a, b) => b - a),
  );
  await itemTable
    .getByRole("button", { name: "정답률 오름차순 정렬", exact: true })
    .click();
  assert.deepEqual(
    await correctRates(),
    [...rates].sort((a, b) => a - b),
  );
  await itemTable
    .getByRole("button", { name: "문항 오름차순 정렬", exact: true })
    .click();
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
    .getByRole("button", { name: "닫기", exact: true })
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
  assert.equal(
    await page.evaluate(() => window.qa.calls.length),
    initialReads + 1,
    "Sorting and report views do not fetch more student records",
  );
  assert.equal(
    await page.evaluate(() => window.qa.saves.length),
    0,
    "Analysis must never save levels or scores",
  );
  for (const round of [1, 2, 3]) {
    await page.goto(`${origin}/?round=${round}&grade=3`);
    await page
      .getByRole("combobox", { name: "분석 보기", exact: true })
      .selectOption("3");
    const cumulative = page.getByRole("table", {
      name: "학생별 모의고사 누적 성취수준",
      exact: true,
    });
    await cumulative.locator("tbody tr").first().waitFor();
    assert.equal(await cumulative.locator("tbody tr").count(), students.length);
    const firstStudent = cumulative.locator("tbody tr").filter({
      has: page.getByRole("rowheader", {
        name: "합성학생1(30101)",
        exact: true,
      }),
    });
    const expectedScores = mockExamScoreRows
      .filter(
        (row) =>
          row.raw.studentUid === "s0" &&
          Number(row.raw.examRound.slice(6)) <= round,
      )
      .map((row) => row.raw.percent);
    const expectedMean =
      expectedScores.reduce((sum, value) => sum + value, 0) / round;
    const values = await firstStudent.locator("td").allTextContents();
    assert.deepEqual(
      values.slice(0, round),
      expectedScores.map((value) => value.toFixed(2)),
    );
    assert.equal(
      values[round],
      expectedMean.toFixed(2),
      "Only completed rounds up to the selected round enter the mean",
    );
    const expectedLevel =
      ["A", "B", "C", "D"].find(
        (_, index) =>
          expectedMean >=
          100 / (1 + Math.exp(-(Math.log(0.65 / 0.35) + 0.8 * (2 - index)))),
      ) || "E";
    assert.equal(values[round + 1], expectedLevel);
    assert.equal(values[round + 2], `${round}/${round}회`);
    await cumulative
      .getByRole("button", { name: "누적 점수 내림차순 정렬", exact: true })
      .click();
    const cumulativeScores = await cumulative
      .locator("tbody tr")
      .evaluateAll(
        (rows, column) =>
          rows.map((row) =>
            Number(row.querySelectorAll("td")[column].textContent),
          ),
        round,
      );
    assert.deepEqual(
      cumulativeScores,
      [...cumulativeScores].sort((a, b) => b - a),
    );
    await cumulative
      .getByRole("button", { name: "누적 점수 오름차순 정렬", exact: true })
      .click();
    assert.deepEqual(
      await cumulative
        .locator("tbody tr")
        .evaluateAll(
          (rows, column) =>
            rows.map((row) =>
              Number(row.querySelectorAll("td")[column].textContent),
            ),
          round,
        ),
      [...cumulativeScores].sort((a, b) => a - b),
    );
    assert.doesNotMatch(
      await page.locator(".qaa-estimates").innerText(),
      /진단·형성|근거 보기|교사 확인|저장/,
    );
    assert.equal(await page.evaluate(() => window.qa.calls.length), 1);
    assert.equal(await page.evaluate(() => window.qa.saves.length), 0);
    await page.screenshot({
      path: path.join(evidence, `round-${round}.png`),
      fullPage: true,
    });
    await page
      .getByRole("combobox", { name: "분석 보기", exact: true })
      .selectOption("5");
    const paperCuts = page.getByRole("table", {
      name: "응시 당시 시험지별 추정 분할점수",
      exact: true,
    });
    assert.equal(
      await paperCuts.locator("tbody tr").count(),
      students.length * round,
    );
    assert.deepEqual(await paperCuts.locator("thead th").allTextContents(), [
      "학생",
      "회차",
      "점수",
      "A/B",
      "B/C",
      "C/D",
      "D/E",
    ]);
    assert.equal(await page.evaluate(() => window.qa.calls.length), 1);
  }
  // Only student rendering is windowed: all statistics and curves use all 65.
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/?round=3&grade=3&large=1`);
    const chooser = page.getByRole("combobox", { name: "분석 보기", exact: true });
    await chooser.selectOption("4");
    const grid = page.getByRole("region", { name: "학생과 문항별 정오 S-P표", exact: true });
    await grid.locator("tbody tr").first().waitFor();
    assert.equal(await grid.locator("tbody tr").count(), 30);
    assert.match(await page.locator('.qaa-scope').innerText(), /첫 제출 65명/);
    const allRates = await grid.locator('thead tr').nth(1).innerText();
    await page.getByRole('button', { name: '학생 30명 더 보기', exact: true }).click();
    assert.equal(await grid.locator('tbody tr').count(), 60);
    assert.equal(await grid.locator('thead tr').nth(1).innerText(), allRates);
    await page.getByRole('button', { name: '학생 5명 더 보기', exact: true }).click();
    assert.equal(await grid.locator('tbody tr').count(), 65);
    await grid.getByRole('button', { name: '학생 오름차순 정렬', exact: true }).click();
    assert.equal(await grid.locator('tbody tr').count(), 30);
    await chooser.selectOption('3');
    let cumulative = page.getByRole('table', { name:'학생별 모의고사 누적 성취수준', exact:true });
    assert.equal(await cumulative.locator('tbody tr').count(), 30);
    await page.getByRole('button', { name:'학생 30명 더 보기', exact:true }).click();
    assert.equal(await cumulative.locator('tbody tr').count(), 60);
    await cumulative.getByRole('button', { name:'누적 점수 내림차순 정렬', exact:true }).click();
    assert.equal(await cumulative.locator('tbody tr').count(), 30);
    await chooser.selectOption('5');
    const papers = page.getByRole('table', { name:'응시 당시 시험지별 추정 분할점수', exact:true });
    assert.equal(await cumulative.locator('tbody tr').count(), 30);
    assert.equal(await papers.locator('tbody tr').count(), 90, 'Three rounds remain grouped for each of the first 30 students');
    await page.getByRole('button', { name:'학생 30명 더 보기', exact:true }).last().click();
    assert.equal(await papers.locator('tbody tr').count(), 180);
    assert.equal(await cumulative.locator('tbody tr').count(), 30, 'Independent student lists have independent windows');
    assert.equal(await page.evaluate(() => window.qa.calls.length), 1);
    await chooser.selectOption('1');
    const trigger = page.getByRole('button', { name:'1번', exact:true }).first();
    await trigger.click();
    const popup = page.getByRole('dialog', { name:'응시 당시 문항', exact:true });
    await popup.getByText('공통 지문 원문 보존 검증', {exact:true}).waitFor();
    assert.equal(await page.locator('.quiz-achievement-analysis').count(), 1, 'Popup retains the analysis screen');
    assert.equal(await page.evaluate(() => window.qa.calls.filter(x => x.mode==='question').length), 1);
    assert.equal(await page.evaluate(() => window.qa.calls.find(x=>x.mode==='question').resultId), 'exam-3-1', 'Use a preserved copy in the same form when the first attempt omitted this original');
    assert.equal(await page.evaluate(() => window.qa.calls.find(x=>x.mode==='question').resultSource), 'canonical', 'Colliding legacy ID cannot select the wrong original source');
    assert.equal(await page.evaluate(() => window.qa.calls.find(x=>x.mode==='question').sourceVersion), '000000001793920000000000000');
    await page.evaluate(() => window.redraw());
    assert.equal(await page.evaluate(() => window.qa.calls.filter(x => x.mode==='question').length), 1, 'Open-popup rerender never refetches original');
    assert.equal(await popup.getByText('현재 문제은행에서 변경된 발문',{exact:true}).count(), 0);
    assert.ok(await popup.locator('img').evaluateAll(images=>images.length>0 && images.every(image=>image.complete && image.naturalWidth>0)), 'Frozen image is rendered');
    assert.ok(await popup.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Original question fits dialog width');
    await page.screenshot({path:path.join(evidence, `${width}-question-dialog.png`), fullPage:true});
    await page.keyboard.press('Escape');
    assert.equal(await popup.count(), 0);
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Escape returns focus to original question button');
  }
  // Error/retry, absent frozen evidence and dismissed/account-stale responses.
  await page.evaluate(() => { window.qa.questionMode='error'; });
  const questionTrigger = page.getByRole('button', {name:'1번', exact:true}).first();
  await questionTrigger.click();
  let popup = page.getByRole('dialog', {name:'응시 당시 문항',exact:true});
  await popup.getByRole('alert').waitFor();
  await page.evaluate(() => { window.qa.questionMode='ok'; });
  await popup.getByRole('button',{name:'다시 시도',exact:true}).click();
  await popup.getByText('공통 지문 원문 보존 검증',{exact:true}).waitFor();
  await page.mouse.click(1,1);
  assert.equal(await popup.count(),0,'Backdrop dismisses only outside dialog bounds');
  await page.evaluate(() => { window.qa.questionMode='missing'; });
  await questionTrigger.click();
  await popup.getByText('응시 당시 문항 원문이 보관되어 있지 않습니다.',{exact:true}).waitFor();
  assert.equal(await popup.locator('.mock-exam-question-ink').count(),0,'Never replace missing original with current bank');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.qa.questionMode='defer'; });
  await questionTrigger.click();
  await popup.getByRole('status').waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.qa.pending.splice(0).forEach(resolve=>resolve()); });
  assert.equal(await popup.count(),0,'Dismissed response cannot reopen original');
  await questionTrigger.click();
  await popup.getByRole('status').waitFor();
  await page.evaluate(() => window.changeIdentity('other-account'));
  await page.waitForFunction(() => !document.querySelector('.qaa-question-dialog'));
  await page.evaluate(() => { window.qa.pending.splice(0).forEach(resolve=>resolve()); });
  assert.equal(await popup.count(),0,'Account transition discards old original response');
  await page.getByRole('combobox',{name:'분석 보기',exact:true}).selectOption('1');
  await questionTrigger.click();
  await popup.getByRole('status').waitFor();
  await page.evaluate(() => window.changeScope('2'));
  await page.waitForFunction(() => !document.querySelector('.qaa-question-dialog'));
  await page.evaluate(() => { window.qa.pending.splice(0).forEach(resolve=>resolve()); });
  assert.equal(await popup.count(),0,'Scope transition discards old original response');
  await page.goto(`${origin}/?inline=1`);
  await page.getByRole('combobox',{name:'분석 보기',exact:true}).selectOption('1');
  await page.getByRole('button',{name:'1번',exact:true}).first().click();
  await page.getByRole('dialog',{name:'응시 당시 문항',exact:true}).getByText('공통 지문 원문 보존 검증',{exact:true}).waitFor();
  assert.equal(await page.evaluate(() => window.qa.calls.filter(x=>x.mode==='question').length),0,'Old full frozen snapshots still work without an extra read');
  await page.keyboard.press('Escape');
  // Hold only this entrance animation so start/midpoint/end geometry can be
  // inspected deterministically without slowing production motion.
  await page.addInitScript(() => {
    window.chartEntrances = [];
    document.addEventListener("animationstart", (event) => {
      if (event.animationName !== "quiz-chart-rise") return;
      const animation = event.target.getAnimations().find(
        (entry) => entry.animationName === "quiz-chart-rise",
      );
      if (!animation) return;
      animation.pause();
      animation.currentTime = 0;
      window.chartEntrances.push({ target: event.target, animation });
    });
  });
  const checkRise = async (selector) => {
    await page.waitForFunction((selector) =>
      window.chartEntrances.some(({ target }) => target.matches(selector)), selector);
    const samples = await page.evaluate(async (selector) => {
      const entry = window.chartEntrances.find(({ target }) => target.matches(selector)
        && (target.tagName.toLowerCase() === "g" || parseFloat(target.style.height) > 0));
      if (!entry) throw new Error("A plotted mark is required");
      const { target, animation } = entry;
      const duration = animation.effect.getTiming().duration;
      const values = [];
      for (const time of [0, duration / 2, duration]) {
        animation.currentTime = time;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const box = target.getBoundingClientRect();
        const matrix = new DOMMatrix(getComputedStyle(target).transform);
        values.push({ scale: matrix.m22, bottom: box.bottom, height: box.height });
      }
      for (const { animation } of window.chartEntrances) animation.finish();
      return { duration, values };
    }, selector);
    assert.equal(samples.duration, 300);
    assert.equal(samples.values[0].scale, 0);
    assert.ok(samples.values[1].scale > 0 && samples.values[1].scale < 1);
    assert.equal(samples.values[2].scale, 1);
    assert.ok(samples.values[2].height > samples.values[1].height);
    if (!selector.includes("g.")) {
      assert.ok(Math.abs(samples.values[0].bottom - samples.values[2].bottom) < 1,
        "Histogram rises from its fixed baseline without moving layout");
    }
  };
  for (const reducedMotion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ reducedMotion });
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin);
      await checkRise(".qaa-histogram-column > .qa-chart-rise");
      assert.equal(await page.evaluate(() => window.qa.calls.length), 1);
      assert.equal(await page.evaluate(() => window.qa.calls[0].responseEncoding), "gzip-base64");
      await page.reload();
      await checkRise(".qaa-histogram-column > .qa-chart-rise");
      assert.equal(await page.evaluate(() => window.qa.calls.length), 1);
      await page.evaluate(() => { window.chartEntrances = []; });
      await page.getByRole("button", { name: "최신 결과 조회", exact: true }).click();
      await checkRise(".qaa-histogram-column > .qa-chart-rise");
      assert.equal(await page.evaluate(() => window.qa.calls.length), 2);
      assert.deepEqual(await page.evaluate(() => window.qa.saves), []);
      await page.getByRole("combobox", { name: "분석 보기", exact: true }).selectOption("1");
      await checkRise("g.qa-chart-rise");
      assert.equal(await page.locator(".qaa-histogram").count(), 0,
        "Changing reports removes the previous histogram after refresh");
      assert.equal(await page.evaluate(() => window.qa.calls.length), 2);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const filename = `${width}-chart-motion-${reducedMotion}.png`;
      await page.screenshot({ path: path.join(evidence, filename), fullPage: true });
      shots.push(filename);
    }
  }
  await page.emulateMedia({ media: "print" });
  assert.ok(await page.locator("g.qa-chart-rise").evaluateAll((marks) =>
    marks.every((mark) => getComputedStyle(mark).animationName === "none")));
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
          "student windows 30/60/65; independent paper groups and sorting reset, full denominators unchanged",
          "on-demand original dialog: no fetch before click, Escape/focus, retry/missing/stale account/dismissal, old inline compatibility",
          "level choices",
          "profile graph",
          "correct-answer fill and atypical outline",
          "S-P student and item header sorts preserve response identity",
          "item statistic header sorts in both directions",
          "keyboard sorting and unavailable values last",
          "cumulative mock exam levels are read-only",
          "zero extra reads or writes for report views and sorting",
          "chart baseline rise on entry, reload and explicit refresh at 390/768/1280px",
          "same 300ms chart entrance with reduced motion; static print",
          "native browser DecompressionStream restores gzip-base64 class and grade fixtures",
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
