/** Exercise the real teacher preview with synthetic questions and no backend. */
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
const evidence =
  process.env.TEACHER_MOCK_GRADING_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-teacher-mock-grading-")));
await fs.mkdir(evidence, { recursive: true });
const questions = [
  {
    id: 53,
    paperOrder: 3,
    type: "choice",
    points: 5,
    question: "조선의 인물과 제도를 바르게 연결한 것은?",
    options: ["(가) 김시민\t(나) 이순신", "(가) 이순신\t(나) 권율"],
    answer: "(가) 이순신\t(나) 권율",
  },
  {
    id: 91,
    paperOrder: 1,
    type: "choice",
    points: 3,
    question: "조선의 최고 교육 기관은?",
    options: ["서당", "서원", "향교", "성균관", "4부 학당"],
    answer: "성균관",
  },
  {
    id: 7,
    paperOrder: 4,
    type: "short",
    points: 8,
    question: "검증용 미응답 문항",
    answer: "의정부",
    paperBreakBefore: true,
  },
  {
    id: 12,
    paperOrder: 2,
    type: "short",
    points: 4,
    question: "토지에서 조세를 거둘 수 있는 권리는?",
    answer: "수조권",
  },
  {
    id: 25,
    paperOrder: 1,
    type: "choice",
    points: 4,
    question: "다른 회차의 검증 문항",
    options: ["향교", "성균관"],
    answer: "성균관",
    examRound: "round_2",
  },
].map((q) => ({
  examRound: "round_1",
  unitId: "exam_prep",
  category: "exam_prep",
  explanation: "합성 문항의 채점 동작 검증용 해설입니다.",
  ...q,
}));
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import Preview from './src/pages/teacher/components/MockExamPreview';
import {quizQuestionCatalogEntry} from './src/pages/teacher/components/quizQuestionPaging';
import './src/assets/index.css';import './src/pages/teacher/components/QuizWorkspace.css';
const questions=${JSON.stringify(questions)};window.fixture={loads:0,headers:0};
const loadQuestions=async entries=>{window.fixture.loads++;return questions.filter(q=>entries.some(e=>e.id===q.id));};
const loadPaperHeader=async()=>{window.fixture.headers++;await new Promise(resolve=>setTimeout(resolve,400));if(location.search.includes('header-error'))throw Error('synthetic failure');return {paperHeading:'교사 채점 검증'};};
createRoot(document.getElementById('root')).render(<Preview entries={questions.map(q=>quizQuestionCatalogEntry(q))} loadQuestions={loadQuestions} loadPaperHeader={loadPaperHeader}/>);`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  write: false,
  metafile: true,
  outdir: "fixture",
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  loader: { ".woff2": "dataurl", ".woff": "dataurl", ".svg": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
});
assert(
  !Object.keys(bundle.metafile.inputs).some((name) =>
    /node_modules[\\/](@firebase|firebase)[\\/]/.test(name),
  ),
  "Preview grading must not add a Firebase boundary",
);
let tailwind;
for (const candidate of [
  process.env.TAILWIND_RUNTIME_PATH,
  path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  path.join(os.tmpdir(), "westory-assessment-qa-tailwind.js"),
].filter(Boolean)) {
  try {
    tailwind = await fs.readFile(candidate, "utf8");
    break;
  } catch {}
}
assert(tailwind, "The existing portal QA Tailwind cache is required");
const css = (
  (await fs.readFile("assets/css/style.css", "utf8")) +
  bundle.outputFiles.find((f) => f.path.endsWith(".css")).text
).replace(/@import\s+url\([^;]+;/g, "");
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><body style="margin:0"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((req, res) => {
  const [type, body] = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  }[new URL(req.url, "http://localhost").pathname] || ["text/html", html];
  res.setHeader("Content-Type", `${type};charset=utf-8`);
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browserName = process.env.TEACHER_MOCK_GRADING_BROWSER || "chromium";
const browser = await playwright[browserName].launch({
  ...(browserName === "chromium"
    ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge" }
    : {}),
  headless: true,
});
const reports = [],
  errors = [],
  external = [];
async function ready(page) {
  await page.getByRole("button", { name: "채점", exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".mock-exam-preview-grade").disabled,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".mock-exam-sheet article").first().waitFor();
}
async function trace(page) {
  await page.evaluate(() => {
    window.gradeTrace = {
      starts: [],
      ends: [],
      samples: [],
      earlyScore: false,
      overlap: false,
    };
    document.onanimationstart = (event) => {
      if (event.animationName !== "mock-exam-pencil-draw") return;
      const question = event.target.closest("[data-question-index]");
      window.gradeTrace.starts.push({
        index: Number(question.dataset.questionIndex),
        correct: question
          .querySelector(".mock-exam-pencil")
          .classList.contains("is-correct"),
        duration: getComputedStyle(event.target).animationDuration,
      });
    };
    document.onanimationend = (event) => {
      if (event.animationName === "mock-exam-pencil-draw")
        window.gradeTrace.ends.push(
          Number(
            event.target.closest("[data-question-index]").dataset.questionIndex,
          ),
        );
    };
    const observe = () => {
      const marks = [
        ...document.querySelectorAll(".mock-exam-pencil.is-drawing"),
      ];
      if (marks.length > 1) window.gradeTrace.overlap = true;
      if (
        document.querySelector('[data-grading-state="grading"]') &&
        document.querySelector(".mock-exam-score")
      )
        window.gradeTrace.earlyScore = true;
      for (const mark of marks) {
        const index = Number(
          mark.closest("[data-question-index]").dataset.questionIndex,
        );
        const offset = parseFloat(
          getComputedStyle(mark.querySelector(".mock-exam-pencil-reveal"))
            .strokeDashoffset,
        );
        if (
          offset > 5 &&
          offset < 95 &&
          !window.gradeTrace.samples.includes(index)
        )
          window.gradeTrace.samples.push(index);
      }
      window.traceFrame = requestAnimationFrame(observe);
    };
    observe();
  });
}
async function graded(page, expected = "35") {
  await page
    .locator('[data-grading-state="complete"]')
    .waitFor({ timeout: 15000 });
  const result = await page.evaluate(() => {
    cancelAnimationFrame(window.traceFrame);
    const score = document.querySelector(".mock-exam-score"),
      rect = score.getBoundingClientRect();
    return {
      ...window.gradeTrace,
      score: score.textContent.trim(),
      scroll: document.querySelector(".quiz-composer-body").scrollTop,
      scoreVisible: score.contains(
        document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ),
      ),
      calls: window.fixture,
    };
  });
  assert.equal(result.score, `${expected}/100`);
  assert.equal(result.scroll, 0);
  assert(result.scoreVisible, "Final score is unobscured on page one");
  assert(
    !result.earlyScore && !result.overlap,
    "Grade one question at a time before revealing score",
  );
  assert(
    result.starts.every((s) => parseFloat(s.duration) >= 0.6),
    "Full pencil animation also runs under reduced motion",
  );
  assert.deepEqual(
    result.ends,
    result.starts.map((s) => s.index),
  );
  assert.deepEqual(
    result.samples,
    result.starts.map((s) => s.index),
  );
  return result;
}
try {
  for (const width of [320, 390, 768, 1440])
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const page = await browser.newPage({
        viewport: { width, height: width < 500 ? 844 : 1000 },
        reducedMotion,
        hasTouch: width < 1000,
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(origin) || url.startsWith("data:"))
          return route.continue();
        external.push(url);
        return route.abort();
      });
      await page.goto(origin);
      await page.getByRole("button", { name: "미리보기", exact: true }).click();
      assert(
        await page
          .getByRole("button", { name: "채점", exact: true })
          .isDisabled(),
        "Wait for header loading before grading",
      );
      await ready(page);
      const layout = await page.evaluate(() => {
        const toolbar = document.querySelector(".mock-exam-preview-toolbar"),
          grade = document.querySelector(".mock-exam-preview-grade"),
          close = grade.nextElementSibling,
          round = toolbar.querySelector("select");
        const a = grade.getBoundingClientRect(),
          b = close.getBoundingClientRect(),
          c = round.getBoundingClientRect();
        return {
          sameRow:
            Math.abs(a.top + a.height / 2 - b.top - b.height / 2) < 2 &&
            Math.abs(a.top + a.height / 2 - c.top - c.height / 2) < 2,
          left: a.right <= b.left,
          width: a.width,
          height: a.height,
          background: getComputedStyle(grade).backgroundColor,
          color: getComputedStyle(grade).color,
          overflow: toolbar.scrollWidth > toolbar.clientWidth + 1,
        };
      });
      assert(
        layout.sameRow && layout.left && !layout.overflow,
        JSON.stringify({ width, layout }),
      );
      assert(layout.width >= 44 && layout.height >= 44);
      assert.equal(layout.background, "rgb(185, 28, 28)");
      assert.equal(layout.color, "rgb(255, 255, 255)");
      await page
        .getByRole("button", { name: "1번 문제 확대", exact: true })
        .click();
      await page
        .locator(".mock-exam-answer-controls label")
        .filter({ hasText: "성균관" })
        .click();
      await page
        .getByRole("button", { name: "다음 문제", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "답안", exact: true })
        .fill(" 수 조 권 ");
      await page
        .getByRole("button", { name: "다음 문제", exact: true })
        .click();
      await page.locator(".mock-exam-options label").first().click();
      // Grade directly from a zoomed question; the paper must reappear.
      await trace(page);
      await page.getByRole("button", { name: "채점", exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.locator('[data-grading-state="grading"]').waitFor();
      assert(
        await page
          .getByRole("button", { name: "채점", exact: true })
          .isDisabled(),
      );
      assert(
        await page
          .getByRole("combobox", { name: "모의고사 회차", exact: true })
          .isDisabled(),
      );
      assert.equal(
        await page.locator(".mock-exam-preview-question").count(),
        0,
      );
      const result = await graded(page);
      assert.deepEqual(
        result.starts.map((s) => s.index),
        [0, 1, 2, 3],
        "Follow paper order, not question IDs or load order",
      );
      assert.deepEqual(
        result.starts.map((s) => s.correct),
        [true, true, false, false],
        "Includes weighted short answer, table choice and unanswered marking",
      );
      assert.deepEqual(
        result.calls,
        { loads: 1, headers: 1 },
        "Grading must not request data again",
      );
      await page.screenshot({
        path: path.join(
          evidence,
          `${browserName}-${width}-${reducedMotion}.png`,
        ),
      });
      reports.push({ width, reducedMotion, layout, result });
      if (width === 390 && reducedMotion === "reduce") {
        await trace(page);
        await page.getByRole("button", { name: "채점", exact: true }).click();
        const replay = await graded(page);
        assert.equal(
          replay.starts.length,
          4,
          "Identical answers can replay grading",
        );
        await page
          .getByRole("button", {
            name: "1번 문제 확대, 답안 입력됨",
            exact: true,
          })
          .click();
        await page
          .locator(".mock-exam-answer-controls label")
          .filter({ hasText: "성균관" })
          .click();
        await page
          .getByRole("button", { name: "시험지로 돌아가기", exact: true })
          .click();
        assert.equal(
          await page.locator(".mock-exam-score,.mock-exam-pencil").count(),
          0,
          "Editing answers clears stale grades",
        );
        await page
          .getByRole("combobox", { name: "모의고사 회차", exact: true })
          .selectOption("round_2");
        await ready(page);
        await trace(page);
        await page.getByRole("button", { name: "채점", exact: true }).click();
        await graded(page, "0");
        await page
          .getByRole("button", { name: "1번 문제 확대", exact: true })
          .click();
        await page
          .locator(".mock-exam-answer-controls label")
          .filter({ hasText: "성균관" })
          .click();
        await trace(page);
        await page.getByRole("button", { name: "채점", exact: true }).click();
        await graded(page, "100");
        await page
          .getByRole("combobox", { name: "모의고사 회차", exact: true })
          .selectOption("round_1");
        await ready(page);
        assert.equal(
          await page.locator(".mock-exam-score,.mock-exam-pencil").count(),
          0,
          "Round changes reset the grade",
        );
        await page.getByRole("button", { name: "채점", exact: true }).click();
        await page.locator('[data-grading-state="grading"]').waitFor();
        await page.getByRole("button", { name: "닫기", exact: true }).click();
        assert.equal(
          await page.getByRole("dialog").count(),
          0,
          "Closing cancels grading",
        );
        await page
          .getByRole("button", { name: "미리보기", exact: true })
          .click();
        await ready(page);
        assert.equal(
          await page
            .locator(".mock-exam-pencil,.mock-exam-answer-check")
            .count(),
          0,
          "Reopening clears local answers and marks",
        );
        await page.keyboard.press("Escape");
        assert.equal(await page.getByRole("dialog").count(), 0);
        await page.waitForFunction(
          () =>
            document.activeElement?.matches("button") &&
            document.activeElement.textContent === "미리보기",
        );
        assert(
          await page
            .getByRole("button", { name: "미리보기", exact: true })
            .evaluate((el) => el === document.activeElement),
          "Focus returns to preview trigger",
        );
      }
      await page.close();
    }
  const failure = await browser.newPage();
  await failure.goto(origin + "?header-error");
  await failure.getByRole("button", { name: "미리보기", exact: true }).click();
  await failure.getByRole("alert").waitFor();
  assert(
    await failure
      .getByRole("button", { name: "채점", exact: true })
      .isDisabled(),
    "Header failure does not start invisible grading",
  );
  await failure.getByRole("button", { name: "닫기", exact: true }).click();
  await failure.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ browserName, reports, errors, external }, null, 2),
  );
  console.log(
    `Teacher preview grading passed: 320/390/768/1440px, normal/reduced motion, sequential marks, weighted scores, replay, round isolation, cancellation and no backend requests. Evidence: ${evidence}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
