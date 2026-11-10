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
const evidence = path.join(root, "output", "quiz-analysis-detail");
await fs.mkdir(evidence, { recursive: true });
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const questions = Array.from({ length: 24 }, (_, index) => ({
  id: String(index + 1),
  docId: String(index + 1),
  unitId: index === 1 ? "unit-b" : "unit-a",
  subUnitId: "leaf",
  category: index === 1 ? "diagnostic" : "formative",
  type: "choice",
  sourceRevision: "1",
  contentRevision: 1,
  answer: "정답",
  options: ["정답", "오답"],
  question: `${index + 1}. 붕당의 형성과 사림 세력의 정치적 성장을 설명한 내용 중 가장 적절한 것을 고르세요. 긴 한국어 문항도 원문을 확인할 수 있어야 합니다.`,
  explanation: "훈구와 사림 사이의 정치적 갈등을 확인합니다.",
  concepts: ["사림과 붕당의 형성", "조선 정치의 변화"],
}));
const students = [
  {
    uid: "a",
    classId: "class_1",
    number: "1",
    name: "가상학생 이름이아주긴학생",
  },
  { uid: "b", classId: "class_1", number: "2", name: "가상학생 둘" },
];
const records = students.map((student, index) => ({
  id: student.uid,
  source: "canonical",
  studentUid: student.uid,
  semesterId: "2026-2",
  unitId: "unit-a",
  category: "formative",
  scorePercent: 99,
  submittedAt: "2026-10-25T10:00:00Z",
  totalCount: 24,
  items: questions.map((q) => ({
    questionId: q.id,
    correct: index === 1 ? Number(q.id) % 3 !== 0 : Number(q.id) % 5 === 0,
    answer: (index === 1 ? Number(q.id) % 3 !== 0 : Number(q.id) % 5 === 0)
      ? "정답"
      : "오답",
    sourceRevision: "1",
    concepts: q.concepts,
  })),
}));
const snapshots = Object.fromEntries(
  records.map((record) => [
    `canonical:${record.id}`,
    Object.fromEntries(questions.map((q) => [q.id, q])),
  ]),
);
const mockQuestion = {
  ...questions[0], unitId: "exam_prep", category: "exam_prep", examRound: "round_1",
  paperOrder: 7, points: 4, question: "자료에 나타난 국가를 고르시오.",
  answer: "고려", options: ["고려", "조선", "신라", "백제", "발해"],
  image: "/current-material.svg", examplePassage: "ㄱ. 벽란도\nㄴ. 팔관회",
  choiceOptionImages: ["/frozen-choice.svg", null, null, null, null],
  passageSet: { id: "shared-1", instruction: "다음 자료를 읽고 답하시오.",
    passage: "벽란도에서 교역이 이루어졌다.", image: "/frozen-shared.svg" },
};
const entry = `import React,{useEffect,useRef,useState} from 'react';import{createRoot}from'react-dom/client';import View from ${imp("src/pages/teacher/components/QuizAnalysisView.tsx")};import ${imp("src/pages/teacher/components/QuizClassAnalysis.css")};import ${imp("src/components/common/portalPage.css")};
const regularQuestions=${JSON.stringify(questions)},students=${JSON.stringify(students)},regularRecords=${JSON.stringify(records)},regularSnapshots=${JSON.stringify(snapshots)},mockQuestion=${JSON.stringify(mockQuestion)};
function App(){const ref=useRef(null);const[action,setAction]=useState('');useEffect(()=>{ref.current.showModal()},[]);const keyword=new URLSearchParams(location.search).has('keyword');const empty=new URLSearchParams(location.search).has('empty');const mock=new URLSearchParams(location.search).has('mock');const questions=mock?[mockQuestion]:regularQuestions;const records=mock?regularRecords.map(record=>({...record,unitId:'exam_prep',category:'exam_prep',examRound:'round_1',totalCount:1,items:record.items.filter(item=>item.questionId==='1')})):regularRecords;const snapshots=mock?Object.fromEntries(records.map(record=>['canonical:'+record.id,{'1':{...mockQuestion,image:'/frozen-material.svg'}}])):regularSnapshots;return <><p>합성 문항 분석 검증</p><output aria-label="실행한 동작">{action}</output><dialog ref={ref} className="qca-detail-dialog" aria-labelledby="fixture-title"><header className="qca-detail-header"><div><h3 id="fixture-title">3학년 1반 · 문항·학생 상세</h3><p>{keyword?'전체 단원 · 붕당 검색':'형성평가'}</p></div><button aria-label="상세 닫기" onClick={()=>ref.current.close()}>닫기</button></header><div className="qca-detail-body"><View questions={empty?[]:questions} students={students} records={empty?[]:keyword?records:records.map(record=>({...record,totalCount:23,items:record.items.filter(item=>item.questionId!=='2')}))} tree={[{id:'big',title:'조선',children:[{id:'unit-a',title:'정치',children:[{id:'leaf',title:'붕당의 형성'}]},{id:'unit-b',title:'사회',children:[]}]}]} snapshots={snapshots} configuredClasses={[{id:'class_1',label:'3학년 1반'}]} semesterId="2026-2" loading={false} errors={[]} legacyLimited={false} canEdit={true} onEdit={q=>setAction('edit:'+q.id)} onDerive={q=>setAction('derive:'+q.id)} onReload={()=>setAction('reload')} lockedScope={{unitId:mock?'exam_prep':keyword?'irrelevant-unit':'unit-a',category:mock?'exam_prep':'formative',examRound:mock?'round_1':'',classId:'class_1',...(keyword?{keyword:'붕당',questionIds:empty?[]:['1','2']}: {})}}/></div></dialog></>;}createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  loader: { ".woff2": "dataurl", ".woff": "dataurl" },
  outfile: path.join(evidence, "fixture.js"),
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
const base =
  "body{margin:0;font-family:Arial,sans-serif;background:#f8fafc}*{box-sizing:border-box}button,input,select{font:inherit}button{border:0;background:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}";
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.endsWith(".svg")) {
    res.setHeader("Content-Type", "image/svg+xml");
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100" viewBox="0 0 240 100"><rect x="1" y="1" width="238" height="98" fill="white" stroke="black"/><path d="M20 80L70 25L120 65L165 15L220 80" fill="none" stroke="black" stroke-width="2"/></svg>');
    return;
  }
  res.setHeader(
    "Content-Type",
    url.pathname.endsWith(".js")
      ? "text/javascript"
      : url.pathname.endsWith(".css")
        ? "text/css"
        : "text/html",
  );
  res.end(
    url.pathname.endsWith(".js")
      ? js
      : url.pathname.endsWith(".css")
        ? base + css
        : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  errors = [];
try {
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route("**/*", route => route.request().url().startsWith(origin)
      || route.request().url().startsWith("data:") ? route.continue() : route.abort());
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    const dialog = page.getByRole("dialog");
    const table = dialog.locator(".qa-question-table");
    await table.locator("tbody tr").first().waitFor();
    assert.deepEqual(await table.locator("th").allTextContents(), [
      "번호",
      "핵심 개념",
      "유형",
      "정답률",
      "응답 학생",
    ]);
    assert.equal(await table.locator("tbody tr").count(), 20);
    assert.equal(
      await dialog
        .getByRole("combobox", { name: "분석 목록 정렬", exact: true })
        .count(),
      0,
    );
    const rates = () =>
      table
        .locator("tbody tr")
        .evaluateAll((rows) =>
          rows.map((row) =>
            parseFloat(row.querySelectorAll("td")[3].textContent),
          ),
        );
    await table
      .getByRole("button", { name: "정답률 내림차순 정렬", exact: true })
      .click();
    const highRates = await rates();
    assert.deepEqual(
      highRates,
      [...highRates].sort((a, b) => b - a),
    );
    await table
      .getByRole("button", { name: "정답률 오름차순 정렬", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    const lowRates = await rates();
    assert.deepEqual(
      lowRates,
      [...lowRates].sort((a, b) => a - b),
    );
    assert.equal(
      await table.locator("tbody tr").first().locator("td").first().innerText(),
      "2",
      "Stable question numbers stay attached to questions when sorted",
    );
    await table
      .getByRole("button", { name: "번호 오름차순 정렬", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("실행한 동작").innerText(),
      "",
      "Header sorting never reloads records",
    );
    assert.equal(
      await dialog.locator(".qa-distributions").getAttribute("open"),
      null,
    );
    const dimensions = await table.evaluate((table) => {
      const h = [...table.querySelectorAll("th")].map((x) =>
        x.getBoundingClientRect(),
      );
      const d = [...table.querySelector("tbody tr").children].map((x) =>
        x.getBoundingClientRect(),
      );
      return {
        columns: h.map((b, i) => ({
          x: b.x,
          bodyX: d[i].x,
          width: b.width,
          bodyWidth: d[i].width,
        })),
        numeric: [...table.querySelectorAll(".qa-numeric")].every(
          (cell) => getComputedStyle(cell).textAlign === "right",
        ),
        single:
          table.querySelector(".qa-text-button").getBoundingClientRect()
            .height <= 48,
        headVisible:
          getComputedStyle(table.querySelector("thead")).display ===
          "table-header-group",
      };
    });
    assert(
      dimensions.columns.every(
        (c) =>
          Math.abs(c.x - c.bodyX) < 1 && Math.abs(c.width - c.bodyWidth) < 1,
      ),
    );
    assert(dimensions.numeric);
    assert(dimensions.single);
    assert(dimensions.headVisible);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: path.join(evidence, `table-${width}.png`),
      fullPage: true,
    });
    const first = table.locator("tbody").getByRole("button").first();
    assert.equal(
      await first.getAttribute("title"),
      questions[0].concepts.join(" · "),
    );
    assert.equal(await first.innerText(), questions[0].concepts.join(" · "));
    assert.ok(
      !(await table.innerText()).includes("고르세요"),
      "list contains concepts, not copied prompts",
    );
    await first.focus();
    await page.keyboard.press("Enter");
    const detail = dialog.getByRole("region", {
      name: "문항 상세",
      exact: true,
    });
    await detail.waitFor();
    assert.ok(
      (await detail.innerText()).includes(questions[0].question),
      "expanded detail preserves the full prompt",
    );
    assert(
      await detail.evaluate((element) => document.activeElement === element),
    );
    assert.equal(await page.getByRole("dialog").count(), 1);
    const options = detail.getByRole("table", {
      name: "첫 제출 답안별 분석",
      exact: true,
    });
    await options
      .getByRole("button", {
        name: "나머지 문항 평균 내림차순 정렬",
        exact: true,
      })
      .click();
    const restRates = await options.getByRole("row").all();
    const highRest = await Promise.all(
      restRates
        .slice(1)
        .map((row) =>
          row.getByRole("cell").nth(2).innerText().then(parseFloat),
        ),
    );
    assert.deepEqual(
      highRest,
      [...highRest].sort((a, b) => b - a),
    );
    await options
      .getByRole("button", {
        name: "나머지 문항 평균 오름차순 정렬",
        exact: true,
      })
      .click();
    const lowRest = await Promise.all(
      (await options.getByRole("row").all())
        .slice(1)
        .map((row) =>
          row.getByRole("cell").nth(2).innerText().then(parseFloat),
        ),
    );
    assert.deepEqual(
      lowRest,
      [...highRest].sort((a, b) => a - b),
    );
    await detail.getByRole("button", { name: "수정", exact: true }).click();
    assert.equal(await page.getByLabel("실행한 동작").textContent(), "edit:1");
    await detail
      .getByRole("button", { name: "파생 문항 만들기", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("실행한 동작").textContent(),
      "derive:1",
    );
    await detail.getByRole("button", { name: "닫기", exact: true }).click();
    await page.waitForFunction(() =>
      document.activeElement?.classList.contains("qa-text-button"),
    );
    assert(
      await first.evaluate((element) => document.activeElement === element),
    );
    await dialog.getByRole("button", { name: "다음", exact: true }).click();
    assert.equal(await table.locator("tbody tr").count(), 3);
    await table
      .getByRole("button", { name: "번호 내림차순 정렬", exact: true })
      .click();
    assert.equal(
      await table.locator("tbody tr").count(),
      20,
      "Sorting returns to page one",
    );
    assert.equal(
      await table.locator("tbody tr").first().locator("td").first().innerText(),
      "23",
    );
    await dialog.getByRole("button", { name: "학생", exact: true }).click();
    await dialog.locator(".qa-student-table tbody tr").first().waitFor();
    assert.equal(await dialog.locator(".qa-student-table tbody tr").count(), 2);
    const scoreColumn =
      (
        await dialog.locator(".qa-student-table thead th").allTextContents()
      ).findIndex((label) => label.trim() === "최근 점수") + 1;
    assert.ok(scoreColumn > 0);
    assert.deepEqual(
      await dialog
        .locator(
          `.qa-student-table tbody tr td:nth-child(${scoreColumn}) strong`,
        )
        .allTextContents(),
      ["99점", "99점"],
      "Normal assessments preserve recorded official scores",
    );
    const studentTable = dialog.locator(".qa-student-table");
    await studentTable
      .getByRole("button", { name: "문항 결과 내림차순 정렬", exact: true })
      .click();
    assert.ok(
      (await studentTable.locator("tbody tr").first().innerText()).includes(
        "가상학생 둘",
      ),
    );
    await studentTable
      .getByRole("button", { name: "학생 오름차순 정렬", exact: true })
      .click();
    await page.screenshot({
      path: path.join(evidence, `students-${width}.png`),
      fullPage: true,
    });
    if (width >= 768) {
      const emptySpace = await dialog.evaluate(
        (d) =>
          d.getBoundingClientRect().bottom -
          d.querySelector(".qa-student-table").getBoundingClientRect().bottom,
      );
      assert.ok(
        emptySpace <= 40,
        `short student list has no oversized blank area: ${emptySpace}`,
      );
    }
    if (width >= 1280) {
      const behavior = await dialog
        .getByRole("combobox", { name: "학생 풀이 분류", exact: true })
        .boundingBox();
      const submission = await dialog
        .getByRole("combobox", { name: "학생 응시 상태", exact: true })
        .boundingBox();
      const search = await dialog
        .getByRole("searchbox", { name: "학생 검색", exact: true })
        .boundingBox();
      assert.ok(
        Math.abs(behavior.y - submission.y) < 1 &&
          Math.abs(behavior.y - search.y) < 1,
        "student filter controls share one baseline",
      );
      assert.ok(
        (
          await dialog
            .getByRole("combobox", { name: "분석할 소단원", exact: true })
            .boundingBox()
        ).width <= 361,
      );
    }
    await dialog.locator(".qa-student-table tbody button").first().click();
    const savedAnswers = dialog.locator(".qa-student-answers");
    assert.ok(
      (await savedAnswers.locator("summary").first().innerText()).includes(
        questions[0].concepts[0],
      ),
    );
    assert.ok(
      !(await savedAnswers.locator("summary").first().innerText()).includes(
        "고르세요",
      ),
    );
    await savedAnswers.locator("summary").first().click();
    assert.ok(
      (await savedAnswers.locator("details").first().innerText()).includes(
        questions[0].question,
      ),
    );
    await page.screenshot({
      path: path.join(evidence, `records-${width}.png`),
      fullPage: true,
    });
    await dialog.getByText("분포 보기", { exact: true }).click();
    assert.ok(
      !(await dialog.locator(".qa-rate-list").innerText()).includes("고르세요"),
    );
    assert.ok(
      (await dialog.locator(".qa-rate-list").innerText()).includes(
        questions[0].concepts[0],
      ),
    );
    await page.screenshot({
      path: path.join(evidence, `distributions-${width}.png`),
      fullPage: true,
    });
    checks.push({
      width,
      headerAlignment: true,
      oneLine: true,
      numericAlignment: true,
      inlineDetail: true,
      editAndDerive: true,
      pagination: true,
      headerSorting: true,
      readOnlySorting: true,
    });
    await page.goto(origin + "?mock");
    const mockDialog = page.getByRole("dialog");
    const mockRow = mockDialog.locator(".qa-question-table tbody tr").first();
    await mockRow.waitFor();
    await mockRow.getByRole("button").click();
    const mockDetail = mockDialog.getByRole("region", { name: "문항 상세", exact: true });
    const paper = mockDetail.locator(".mock-exam-question-ink");
    await paper.waitFor();
    assert.equal(await paper.locator(".mock-exam-number").innerText(), "7.",
      "A filtered analysis keeps the original paper number");
    assert.equal(await paper.locator(".mock-exam-set-passage").count(), 1);
    assert.ok((await paper.locator(".mock-exam-set-passage").innerText()).includes(mockQuestion.passageSet.passage));
    assert.ok((await paper.locator(".mock-exam-example").innerText()).includes("벽란도"));
    assert.equal(await paper.locator(".mock-exam-options li").count(), 5);
    assert.equal(await paper.locator('img[src="/current-material.svg"]').count(), 0,
      "Current bank image must not replace the matching frozen exam snapshot");
    for (const name of ["frozen-material", "frozen-shared", "frozen-choice"]) {
      const img = paper.locator(`img[src="/${name}.svg"]`);
      await img.waitFor({ state: "visible" });
      await img.evaluate(image => image.decode());
      assert.ok(await img.evaluate(image => image.complete && image.naturalWidth > 0));
    }
    const paperStyle = await paper.evaluate(element => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      const container = element.closest(".qa-question-content").getBoundingClientRect();
      return { font: style.fontFamily, lineHeight: style.lineHeight,
        right: bounds.right, containerRight: container.right };
    });
    assert.match(paperStyle.font, /Noto Serif KR/, "The preview uses the exam's serif typeface");
    assert.ok(paperStyle.right <= paperStyle.containerRight + 1, "Preview fits the detail width");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(await page.getByLabel("실행한 동작").textContent(), "",
      "Preview uses already loaded snapshots without reload or mutation");
    assert.equal(await page.getByRole("dialog").count(), 1);
    await page.screenshot({ path: path.join(evidence, `mock-paper-${width}.png`), fullPage: true });
    await mockDetail.getByRole("button", { name: "닫기", exact: true }).click();
    await mockDialog.getByRole("button", { name: "학생", exact: true }).click();
    await mockDialog.locator(".qa-student-table tbody button").first().click();
    await mockDialog.locator(".qa-student-answers summary").first().click();
    const savedPaper = mockDialog.locator(".qa-student-answers .mock-exam-question-ink");
    assert.equal(await savedPaper.locator('img[src="/frozen-material.svg"]').count(), 1);
    assert.equal(await savedPaper.locator(".mock-exam-number").innerText(), "7.");
    checks.push({ width, mockPaper: true, frozenImagePreferred: true, sharedMaterial: true,
      choiceImage: true, originalPaperNumber: true, noAddedServerQuery: true, studentReview: true });
    await page.close();
  }
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.goto(origin + "?keyword");
  const dialog = page.getByRole("dialog");
  await dialog.getByText("검색 문항 2개", { exact: true }).waitFor();
  assert.equal(await dialog.locator(".qa-question-table tbody tr").count(), 2);
  assert.equal(
    await dialog.getByLabel("분석할 중단원", { exact: true }).count(),
    0,
  );
  await dialog.getByText("분포 보기", { exact: true }).click();
  await dialog
    .getByRole("heading", { name: "검색 문항 정답률", exact: true })
    .waitFor();
  assert.equal(
    await dialog.locator(".qa-chart-summary strong").textContent(),
    "50%",
  );
  await dialog.getByRole("button", { name: "학생", exact: true }).click();
  const keywordScoreColumn =
    (
      await dialog.locator(".qa-student-table thead th").allTextContents()
    ).findIndex((label) => label.trim() === "검색 문항 정답률") + 1;
  assert.ok(keywordScoreColumn > 0);
  assert.deepEqual(
    await dialog
      .locator(
        `.qa-student-table tbody tr td:nth-child(${keywordScoreColumn}) strong`,
      )
      .allTextContents(),
    ["0%", "100%"],
  );
  await dialog.locator(".qa-student-table tbody button").first().click();
  await dialog
    .getByRole("heading", { name: "최근 제출에 포함된 검색 문항", exact: true })
    .waitFor();
  assert.equal(await dialog.locator(".qa-student-answers details").count(), 2);
  await page.screenshot({
    path: path.join(evidence, "keyword-detail-1280.png"),
    fullPage: true,
  });
  await page.goto(origin + "?keyword&empty");
  await page.getByText("검색 문항 0개", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByText("이 중단원에는 등록된 평가가 없습니다.", { exact: true })
      .count(),
    0,
  );
  checks.push({
    keywordIndependentScope: true,
    currentItemsAverage: 50,
    originalAttemptScoreNotUsed: true,
    emptySearch: true,
  });
  await page.close();
  assert.deepEqual(errors, []);
  console.log(
    `Quiz analysis detail: ${checks.length} responsive and independent search scenarios passed.`,
  );
} finally {
  await browser.close();
  server.close();
  await fs.writeFile(
    path.join(evidence, "checks.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(evidence);
}
