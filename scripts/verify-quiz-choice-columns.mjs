/** Real authoring and student rendering; synthetic services, no production writes. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = process.cwd();
const require = createRequire(import.meta.url);
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence = await fs.mkdtemp(
  path.join(os.tmpdir(), "westory-choice-columns-"),
);
const fixture = await fs.readFile(
  "scripts/verify-assessment-teacher-browser.mjs",
  "utf8",
);
let service = fixture.match(/const service = `([\s\S]*?)`;/)[1];
service = service.replace(
  "category:q.category,type:q.type,refBig:",
  "category:q.category,type:q.type,examRound:q.examRound,paperOrder:q.paperOrder,points:q.points,refBig:",
);
service += "\nquestions.splice(0,questions.length);";
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import QuizEditor from './src/pages/teacher/components/QuizEditor';import Workspace from './src/pages/student/quiz/MockExamWorkspace';
import Review from './src/pages/student/quiz/QuizRelearning';import * as codec from './src/lib/quizChoiceColumns';
import {historyReviewQuestion} from './src/pages/student/mypage/historyReviewData';import {tree} from 'fixture:service';
import './src/assets/index.css';import './src/pages/teacher/teacherSettings.css';import './src/pages/student/quiz/QuizLearning.css';
window.columnQa={codec,historyReviewQuestion,answers:{}};
function App(){const[index,setIndex]=useState(0),[answers,setAnswers]=useState({});const mode=new URLSearchParams(location.search).get('mode');const saved=JSON.parse(sessionStorage.getItem('column-question')||'null');return mode==='student'?<Workspace questions={[saved]} round="round_1" currentIndex={index} onSelect={setIndex} answers={answers} studentLabel="가상 학생" timeLeft={600} onAnswer={answer=>{window.columnQa.answers={[saved.id]:answer};setAnswers(window.columnQa.answers)}}/>:mode==='review'?<Review items={[{...saved,id:String(saved.id),concepts:[],submittedAnswer:saved.options[0]}]} onClose={()=>{}}/>:<QuizEditor node={{id:'exam_prep',title:'모의고사'}} type="special" treeData={tree} canEdit onOpenSettings={()=>{}}/>};createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "browser",
  outfile: "fixture.js",
  loader: {
    ".woff2": "dataurl",
    ".woff": "dataurl",
    ".webp": "dataurl",
    ".svg": "dataurl",
    ".png": "dataurl",
  },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "synthetic-services",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^fixture:service$|(?:^|\/)contexts\/AuthContext$|(?:^|\/)(?:lib\/)?(firebase|assessmentRelease|assessmentLifecycle|historyDictionarySession)$|^firebase\/firestore$/,
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
assert(
  !Object.keys(bundle.metafile.inputs).some((name) =>
    /node_modules[\\/](@firebase|firebase)[\\/]/.test(name),
  ),
  "No live Firebase in fixture",
);
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g, "");
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><body style="margin:0"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((request, response) => {
  const [type, body] = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  }[new URL(request.url, "http://localhost").pathname] || ["text/html", html];
  response.setHeader("Content-Type", `${type};charset=utf-8`);
  response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const errors = [],
  external = [],
  dialogs = [],
  report = [];
const rows = [
  ["김시민", "이순신"],
  ["김시민", "권율"],
  ["이순신", "권율"],
  ["권율", "김시민"],
  ["권율", "곽재우"],
];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.route("**/*", (route) => {
    if (
      route.request().url().startsWith(origin) ||
      route.request().url().startsWith("data:")
    )
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  let acceptRemoval = false;
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    if (dialog.type() === "confirm" && acceptRemoval) await dialog.accept();
    else await dialog.dismiss();
  });
  await page.goto(origin);
  const codec = await page.evaluate(() => {
    const c = window.columnQa.codec;
    return {
      ordinary: c.decodeQuizChoiceColumns("(가) 김시민 (나) 이순신"),
      wrongOrder: c.decodeQuizChoiceColumns("(나) 김시민\t(가) 이순신"),
      wrongCount: c.getQuizChoiceColumnCount([
        "가",
        "(가) 김시민\t(나) 이순신",
      ]),
      draft: c.decodeQuizChoiceColumns(
        c.encodeQuizChoiceColumns(["긴 이름 ", ""]),
      ),
      mixedWhite: c.decodeQuizChoiceColumns(
        c.encodeQuizChoiceColumns(["김\t시민", "이\n순신"]),
      ),
      collision: [
        c.encodeQuizChoiceColumns(["가나", "다"]),
        c.encodeQuizChoiceColumns(["가", "나다"]),
      ].map((value) => value.replace(/\s+/g, "")),
      canonical: c.normalizeQuizChoiceOption(
        c.encodeQuizChoiceColumns([" 김시민 ", " 이순신 "]),
      ),
    };
  });
  assert.equal(codec.ordinary, null);
  assert.equal(codec.wrongOrder, null);
  assert.equal(codec.wrongCount, 1);
  assert.deepEqual(
    codec.draft,
    ["긴 이름 ", ""],
    "Draft text retains typed trailing spaces",
  );
  assert.deepEqual(codec.mixedWhite, ["김 시민", "이 순신"]);
  assert.notEqual(...codec.collision);
  assert.equal(
    codec.canonical,
    "(가) 김시민\t(나) 이순신",
    "Persisted cells trim draft padding without changing their identity",
  );
  await page.getByRole("button", { name: "문제 등록", exact: true }).click();
  const compose = page.getByRole("dialog", {
    name: "새 문제 등록",
    exact: true,
  });
  await compose
    .getByLabel("발문", { exact: true })
    .fill("표의 (가), (나)에 들어갈 인물을 고르시오.");
  for (let row = 0; row < 5; row++)
    await compose
      .getByLabel(`${row + 1}번 보기`, { exact: true })
      .fill(rows[row][0]);
  const writesBefore = await page.evaluate(
    () => window.assessmentTeacherFixture.writes.length,
  );
  const readsBefore = await page.evaluate(
    () => window.assessmentTeacherFixture.reads.length,
  );
  await compose.getByRole("button", { name: "열 추가", exact: true }).click();
  for (let row = 0; row < 5; row++) {
    assert.equal(
      await compose
        .getByLabel(`${row + 1}번 보기 (가)`, { exact: true })
        .inputValue(),
      rows[row][0],
    );
    await compose
      .getByLabel(`${row + 1}번 보기 (나)`, { exact: true })
      .fill(rows[row][1]);
  }
  assert.equal(await compose.locator(".quiz-choice-column-label").count(), 2);
  await compose.getByLabel("1번 보기 (가)", { exact: true }).fill("긴");
  await compose.getByLabel("1번 보기 (가)", { exact: true }).press("End");
  await compose
    .getByLabel("1번 보기 (가)", { exact: true })
    .pressSequentially(" 이름");
  assert.equal(
    await compose.getByLabel("1번 보기 (가)", { exact: true }).inputValue(),
    "긴 이름",
  );
  await compose.getByLabel("1번 보기 (가)", { exact: true }).fill(rows[0][0]);
  await compose.getByLabel("1번 보기 (나)", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  assert(
    await compose
      .getByLabel("2번 보기 (나)", { exact: true })
      .evaluate((element) => element === document.activeElement),
    "Vertical keys retain column",
  );
  const expectChoiceFocus = async (name) =>
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-label"),
      ),
      name,
    );
  for (const [key, name] of [
    ["ArrowLeft", "2번 보기 (가)"],
    ["ArrowLeft", "2번 보기 (가)"],
    ["ArrowRight", "2번 보기 (나)"],
    ["ArrowRight", "2번 보기 (나)"],
    ["ArrowUp", "1번 보기 (나)"],
  ]) {
    await page.keyboard.press(key);
    await expectChoiceFocus(name);
  }
  for (const modifiers of [
    { isComposing: true },
    { keyCode: 229 },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
  ]) {
    const allowed = await compose
      .getByLabel("1번 보기 (나)", { exact: true })
      .evaluate(
        (element, modifiers) =>
          element.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowLeft",
              bubbles: true,
              cancelable: true,
              ...modifiers,
            }),
          ),
        modifiers,
      );
    assert(allowed, "Composition and modified arrows keep native editing");
    await expectChoiceFocus("1번 보기 (나)");
  }
  for (let row = 0; row < rows.length; row++) {
    for (const [column, label] of ["가", "나"].entries())
      assert.equal(
        await compose
          .getByLabel(`${row + 1}번 보기 (${label})`, { exact: true })
          .inputValue(),
        rows[row][column],
      );
  }
  await compose.getByRole("button", { name: "열 삭제", exact: true }).click();
  assert.equal(
    await compose.locator(".quiz-choice-column-label").count(),
    2,
    "Cancelled removal retains every cell",
  );
  await compose.getByRole("button", { name: "열 추가", exact: true }).click();
  await compose.getByRole("button", { name: "열 추가", exact: true }).click();
  await compose.getByRole("button", { name: "열 추가", exact: true }).click();
  assert.equal(await compose.locator(".quiz-choice-column-label").count(), 5);
  await compose.getByLabel("3번 보기 (나)", { exact: true }).focus();
  for (const label of ["다", "라", "마", "마"]) {
    await page.keyboard.press("ArrowRight");
    await expectChoiceFocus(`3번 보기 (${label})`);
  }
  await page.keyboard.press("ArrowDown");
  await expectChoiceFocus("4번 보기 (마)");
  for (const label of ["라", "다", "나", "가", "가"]) {
    await page.keyboard.press("ArrowLeft");
    await expectChoiceFocus(`4번 보기 (${label})`);
  }
  assert(
    await compose
      .getByRole("button", { name: "열 추가", exact: true })
      .isDisabled(),
  );
  for (let count = 5; count > 2; count--)
    await compose.getByRole("button", { name: "열 삭제", exact: true }).click();
  await compose.getByRole("button", { name: "보기 추가", exact: true }).click();
  assert.equal(
    await compose.getByLabel("6번 보기 (가)", { exact: true }).inputValue(),
    "",
  );
  assert.equal(
    await compose.getByLabel("6번 보기 (나)", { exact: true }).inputValue(),
    "",
  );
  await compose
    .getByRole("button", { name: "6번 보기 삭제", exact: true })
    .click();
  await compose
    .getByRole("button", { name: "3번 보기 정답 선택", exact: true })
    .click();
  const live = compose.locator(".mock-exam-draft-preview");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await compose
      .getByLabel("1번 보기 (가)", { exact: true })
      .press("ArrowRight");
    await expectChoiceFocus("1번 보기 (나)");
    await page.keyboard.press("ArrowLeft");
    await expectChoiceFocus("1번 보기 (가)");
    await compose
      .getByLabel("1번 보기 (가)", { exact: true })
      .scrollIntoViewIfNeeded();
    const fields = await compose
      .locator(".quiz-choice-column-inputs")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const inputs = Array.from(element.querySelectorAll("textarea"));
          return {
            count: inputs.length,
            widths: inputs.map((input) => input.getBoundingClientRect().width),
            top: inputs.map((input) => input.getBoundingClientRect().top),
            overflow: element.scrollWidth - element.clientWidth,
          };
        }),
      );
    assert.equal(fields.length, 5);
    assert(
      fields.every(
        (row) =>
          row.count === 2 &&
          row.widths.every((value) => value > 30) &&
          Math.abs(row.widths[0] - row.widths[1]) < 1 &&
          Math.abs(row.top[0] - row.top[1]) < 1 &&
          row.overflow <= 1,
      ),
      JSON.stringify({ width, fields }),
    );
    if (!(await live.isVisible()))
      await compose.getByRole("button", { name: "미리보기", exact: true }).click();
    await live.waitFor({ state: "visible" });
    assert.equal(
      await live.locator(".quiz-choice-column-headings > span").count(),
      2,
    );
    assert.equal(await live.getByRole("radio").count(), 5);
    assert.equal(await live.locator(".quiz-choice-column-cells").count(), 5);
    await page.screenshot({
      path: path.join(evidence, `authoring-${width}.png`),
    });
    const returnToEditor=compose.getByRole("button",{name:"돌아가기",exact:true});
    if (await returnToEditor.isVisible()) await returnToEditor.click();
    report.push({ width, editorFiveByTwo: true, previewFiveByTwo: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(
    await page.evaluate(() => window.assessmentTeacherFixture.reads.length),
    readsBefore,
    "Column editing and live preview do not add server reads",
  );
  await compose.getByLabel("5번 보기 (나)", { exact: true }).fill("");
  await compose.getByRole("button", { name: "등록", exact: true }).click();
  assert(dialogs.at(-1).includes("모든 열"));
  assert.equal(
    await page.evaluate(() => window.assessmentTeacherFixture.writes.length),
    writesBefore,
  );
  await compose.getByLabel("5번 보기 (나)", { exact: true }).fill(rows[4][1]);
  await compose.getByRole("button", { name: "등록", exact: true }).click();
  await compose.waitFor({ state: "hidden" });
  const saved = await page.evaluate(
    () =>
      window.assessmentTeacherFixture.writes
        .filter((write) => write.command === "upsertQuizQuestion")
        .at(-1).payload.question,
  );
  assert.equal(saved.options.length, 5);
  assert.equal(saved.answer, "(가) 이순신\t(나) 권율");
  assert.deepEqual(
    new Set(saved.options),
    new Set(rows.map((row) => `(가) ${row[0]}\t(나) ${row[1]}`)),
  );
  await page
    .getByRole("button", { name: "1번 문제 수정", exact: true })
    .click();
  const edit = page.getByRole("dialog", { name: "문제 수정", exact: true });
  for (let index = 0; index < 5; index++) {
    const parts = saved.options[index].split("\t");
    assert.equal(
      await edit
        .getByLabel(`${index + 1}번 보기 (가)`, { exact: true })
        .inputValue(),
      parts[0].slice(4),
    );
    assert.equal(
      await edit
        .getByLabel(`${index + 1}번 보기 (나)`, { exact: true })
        .inputValue(),
      parts[1].slice(4),
    );
  }
  acceptRemoval = true;
  await edit.getByRole("button", { name: "열 삭제", exact: true }).click();
  assert.equal(await edit.locator(".quiz-choice-column-label").count(), 0);
  assert.equal(
    await edit
      .locator(".mock-exam-draft-preview .quiz-choice-column-headings")
      .count(),
    0,
    "Returning to one column restores the normal option layout",
  );
  for (let index = 0; index < 5; index++)
    assert.equal(
      await edit
        .getByLabel(`${index + 1}번 보기`, { exact: true })
        .inputValue(),
      saved.options[index].split("\t")[0].slice(4),
    );
  const singleColumn = edit.getByLabel("1번 보기", { exact: true });
  await singleColumn.press("Home");
  await singleColumn.press("ArrowRight");
  await expectChoiceFocus("1번 보기");
  assert.equal(
    await singleColumn.evaluate((element) => element.selectionStart),
    1,
  );
  await singleColumn.press("ArrowLeft");
  assert.equal(
    await singleColumn.evaluate((element) => element.selectionStart),
    0,
  );
  await edit.getByRole("button", { name: "취소", exact: true }).click();
  await page.evaluate(
    (question) =>
      sessionStorage.setItem("column-question", JSON.stringify(question)),
    saved,
  );
  const {
    captureQuestionSnapshots,
    questionPresentation,
  } = require("../functions/productionGateway/assessmentLearning.js");
  const frozen = captureQuestionSnapshots(
    [{ path: `semester_quiz_questions/${saved.id}`, data: saved }],
    [String(saved.id)],
    {},
  ).questionSnapshots[0];
  assert.deepEqual(frozen.options, saved.options);
  assert.equal(frozen.answer, saved.answer);
  assert.deepEqual(
    questionPresentation([frozen], "exam_prep")[0].options,
    saved.options,
  );
  assert.equal(
    questionPresentation([frozen], "exam_prep")[0].answer,
    undefined,
  );
  const { gradePractice } = require("../functions/studentQuizReviewNotes.js");
  assert.equal(gradePractice(frozen, saved.answer), true);
  assert.equal(
    gradePractice(
      frozen,
      saved.options.find((value) => value !== saved.answer),
    ),
    false,
  );
  const history = await page.evaluate(
    (question) =>
      window.columnQa.historyReviewQuestion(
        {
          id: String(question.id),
          questionSnapshot: question,
          u: question.answer,
          correct: true,
        },
        0,
      ).snapshot,
    frozen,
  );
  assert.deepEqual(history.options, saved.options);
  assert.equal(history.submittedAnswer, saved.answer);
  await page.goto(origin + "/?mode=student");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const sheet = page.getByRole("region", { name: "1쪽", exact: true });
    await sheet.waitFor();
    assert.equal(
      await sheet.locator(".quiz-choice-column-headings > span").count(),
      2,
    );
    assert.equal(await sheet.locator(".quiz-choice-column-cells").count(), 5);
    await sheet
      .getByRole("button", { name: "1번 문제 확대", exact: true })
      .click();
    const zoom = page.getByRole("dialog");
    assert.equal(
      await zoom.locator(".quiz-choice-column-headings > span").count(),
      2,
    );
    assert.equal(await zoom.getByRole("radio").count(), 5);
    const answer = zoom
      .getByRole("radio")
      .nth(saved.options.indexOf(saved.answer));
    const row = zoom
      .locator(".mock-exam-answer-controls label")
      .nth(saved.options.indexOf(saved.answer));
    await row.click();
    assert(await answer.isChecked());
    assert.equal(
      await page.evaluate((id) => window.columnQa.answers[id], saved.id),
      saved.answer,
    );
    await row.click();
    assert.equal(
      await page.evaluate((id) => window.columnQa.answers[id], saved.id),
      "",
    );
    await page.screenshot({
      path: path.join(evidence, `student-zoom-${width}.png`),
    });
    await zoom
      .getByRole("button", { name: "시험지로 돌아가기", exact: true })
      .click();
  }
  for (const width of [390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    await page.goto(origin + "/?mode=review");
    const notebook=page.getByRole("region",{name:"오답 복습",exact:true});
    const question=notebook.getByRole("article",{name:"복습할 문제",exact:true});
    await question.waitFor();
    assert.equal(await question.locator('.mock-exam-question-ink').count(),1,"review reuses the original question renderer");
    assert.equal(await question.locator('.quiz-choice-column-headings > span').count(),2);
    assert.equal(await question.locator('.mock-exam-options > li').count(),5);
    assert.equal(await question.locator('.quiz-choice-column-cells').count(),5);
    await notebook.getByRole("button", { name: "해설 가리고 다시 풀기", exact: true }).click();
    const controls=question.locator('.mock-exam-answer-controls');
    assert.equal(await controls.locator('.quiz-choice-column-headings > span').count(),2);
    assert.equal(await controls.locator('.quiz-choice-column-cells').count(),5);
    assert.equal(await controls.getByRole('radio').count(),5,"practice retains five complete answer rows");
    const correct=controls.getByRole('radio').nth(saved.options.indexOf(saved.answer));
    const correctRow=controls.locator('label').nth(saved.options.indexOf(saved.answer));
    await correctRow.click();assert(await correct.isChecked());
    await correct.focus();await page.keyboard.press('Space');assert.equal(await correct.isChecked(),false,"keyboard can clear the selected row");
    await page.keyboard.press('Space');assert(await correct.isChecked());
    await notebook.getByRole('button',{name:'답 확인',exact:true}).click();
    await notebook.getByText('다시 맞혔어요.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`no notebook overflow at ${width}px`);
    const cells=await controls.locator('.quiz-choice-column-cells').evaluateAll(elements=>elements.map(element=>{
      const columns=[...element.children].map(column=>column.getBoundingClientRect());
      return {count:columns.length,sameRow:Math.abs(columns[0].top-columns[1].top)<1,equalWidth:Math.abs(columns[0].width-columns[1].width)<1,overflow:element.scrollWidth>element.clientWidth+1};
    }));
    assert(cells.every(row=>row.count===2&&row.sameRow&&row.equalWidth&&!row.overflow),JSON.stringify({width,cells}));
    await page.screenshot({path:path.join(evidence,`notebook-${width}.png`),fullPage:true});
    report.push({width,notebookOriginalFiveByTwo:true,notebookPracticeFiveByTwo:true,notebookKeyboardAndGrading:true});
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      {
        report,
        saved,
        checks: [
          "strict codec",
          "draft spacing",
          "no extra reads/writes",
          "add/remove/max columns",
          "save/reopen",
          "snapshot/presentation/history",
          "server practice grading",
          "whole-row selection",
          "normal and table widths",
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, evidence, report }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
