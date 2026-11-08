import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    process.env.PLAYWRIGHT_MODULE_PATH ||
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
      ),
  );
}
const evidence =
  process.env.MOCK_EXAM_GRADING_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-mock-grading-")));
await fs.mkdir(evidence, { recursive: true });
const questions = [61, 12, 47, 24, 93, 36].map((id, index) => ({
  id,
  type: "choice",
  paperOrder: index + 1,
  question: `${index + 1}번 합성 검증 문항: 조선의 통치 체제에 관한 설명으로 옳은 것은?`,
  passage: "조선은 지방에 관찰사와 수령을 파견하였다.\n".repeat(13).trim(),
  passageSet:
    index === 2 || index === 3
      ? {
          id: "grading-shared-passage",
          instruction: "다음 자료를 읽고 물음에 답하시오.",
          passage:
            "조선은 지방에 관찰사와 수령을 파견하였다. 중앙에서는 의정부와 6조를 두었다.",
        }
      : undefined,
  options: ["서당", "서원", "향교", "성균관", "4부 학당"],
  answer: "성균관",
  explanation: "검증용 해설입니다.",
  points: index % 2 ? 4 : 3,
}));
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Workspace from './src/pages/student/quiz/MockExamWorkspace';
import Paper from './src/components/common/MockExamPaper';
const questions=${JSON.stringify(questions)};const params=new URLSearchParams(location.search);
const zero=params.has('zero');const checks=questions.map((question,index)=>({id:question.id,correct:zero?false:index%2===0}));
const answers=Object.fromEntries(questions.map(question=>[question.id,'성균관']));
window.gradingFixture={submits:0,selects:[],checks};
function App(){const [result,setResult]=useState(false);const [index,setIndex]=useState(0);
if(params.has('history'))return <><div style={{height:120}}>과거 기록 검증</div><Paper questions={questions} answers={answers} score={73.5} checks={checks}/></>;
return <Workspace questions={questions} answers={answers} round="round_1" studentLabel="3학년 1반 1번 가상 학생" currentIndex={index} onSelect={next=>{window.gradingFixture.selects.push(next);setIndex(next)}} onSubmit={()=>{window.gradingFixture.submits++;setResult(true)}} timeLeft={600} score={result?(zero?0:73.5):undefined} checks={result?checks:[]} />;
}createRoot(document.getElementById('root')).render(<App/>);`;
const built = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  write: false,
  metafile: true,
  outdir: "fixture",
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  loader: { ".woff2": "dataurl", ".woff": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
});
assert(
  !Object.keys(built.metafile.inputs).some((name) =>
    /node_modules[\\/](@firebase|firebase)[\\/]/.test(name),
  ),
  "Grading fixture must not include a live Firebase boundary",
);
const globalCss =
  (await fs.readFile(path.join(root, "assets/css/style.css"), "utf8")) +
  (await fs.readFile(path.join(root, "src/assets/index.css"), "utf8"));
const css = (
  globalCss + built.outputFiles.find((file) => file.path.endsWith(".css")).text
).replace(/@import\s+url\([^;]+;/g, "");
const js = built.outputFiles.find((file) => file.path.endsWith(".js")).text;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0}#root{min-height:100dvh}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  response.setHeader(
    "Content-Type",
    pathname === "/fixture.js"
      ? "text/javascript; charset=utf-8"
      : "text/html; charset=utf-8",
  );
  response.end(pathname === "/fixture.js" ? js : html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const errors = [],
  reports = [];
try {
  for (const width of [390, 768, 1280]) {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const zero = width === 1280 && reducedMotion === "reduce";
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion,
        hasTouch: width < 1280,
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        route.request().url().startsWith(origin) ||
        route.request().url().startsWith("data:")
          ? route.continue()
          : route.abort(),
      );
      await page.goto(origin + (zero ? "?zero" : ""));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(
        () => document.querySelectorAll(".mock-exam-sheet").length >= 2,
      );
      if (width === 768)
        await page
          .getByRole("button", { name: "전체 화면", exact: true })
          .click();
      assert.equal(
        await page.locator(".mock-exam-pencil").count(),
        0,
        "No grades before submission",
      );
      assert.equal(
        await page.locator(".mock-exam-score").count(),
        0,
        "No score before submission",
      );
      await page.evaluate(() => {
        window.gradeTrace = {
          starts: [],
          ends: [],
          samples: [],
          violations: [],
          complete: null,
        };
        document.addEventListener("animationstart", (event) => {
          if (event.animationName !== "mock-exam-pencil-draw") return;
          const article = event.target.closest("[data-question-index]");
          const mark = article.querySelector(".mock-exam-pencil");
          const rect = mark.getBoundingClientRect();
          const number = article
            .querySelector(".mock-exam-number")
            .getBoundingClientRect();
          window.gradeTrace.starts.push({
            index: Number(article.dataset.questionIndex),
            time: performance.now(),
            duration: getComputedStyle(event.target).animationDuration,
            correct: mark.classList.contains("is-correct"),
            page: article
              .closest(".mock-exam-sheet")
              .getAttribute("aria-label"),
            top: rect.top,
            bottom: rect.bottom,
            height: innerHeight,
            color: getComputedStyle(mark).color,
            coversNumber:
              rect.left <= number.left &&
              rect.right >= number.right &&
              rect.top <= number.top &&
              rect.bottom >= number.bottom,
          });
        });
        document.addEventListener("animationend", (event) => {
          if (event.animationName === "mock-exam-pencil-draw")
            window.gradeTrace.ends.push({
              index: Number(
                event.target.closest("[data-question-index]").dataset
                  .questionIndex,
              ),
              time: performance.now(),
            });
        });
        function observe() {
          const paper = document.querySelector(".mock-exam-paper");
          const marks = [
            ...document.querySelectorAll(".mock-exam-pencil.is-drawing"),
          ];
          const score = document.querySelector(".mock-exam-score");
          if (marks.length > 1)
            window.gradeTrace.violations.push("More than one mark drawing");
          if (paper?.dataset.gradingState === "grading" && score)
            window.gradeTrace.violations.push(
              "Score shown before grading completed",
            );
          marks.forEach((mark) => {
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
              !window.gradeTrace.samples.some(
                (sample) => sample.index === index,
              )
            )
              window.gradeTrace.samples.push({
                index,
                offset,
                time: performance.now(),
              });
          });
          if (
            paper?.dataset.gradingState === "complete" &&
            !window.gradeTrace.complete
          )
            window.gradeTrace.complete = {
              time: performance.now(),
              score: score?.textContent,
            };
          window.gradeTrace.frame = requestAnimationFrame(observe);
        }
        observe();
      });
      await page.getByRole("button", { name: "제출하기", exact: true }).click();
      await page.locator('[data-grading-state="grading"]').waitFor();
      await page.waitForFunction(() => window.gradeTrace.starts.length === 1);
      assert.equal(
        await page
          .locator('article[data-question-index="0"]')
          .getAttribute("aria-disabled"),
        "true",
        "Question zoom is locked during grading",
      );
      await page
        .locator('article[data-question-index="0"]')
        .evaluate((element) => element.click());
      assert.equal(
        await page.getByRole("dialog").count(),
        0,
        "Click cannot interrupt grading with expanded question",
      );
      if (width === 1280 && reducedMotion === "no-preference")
        await page.screenshot({
          path: path.join(evidence, "grading-in-progress.png"),
        });
      await page
        .locator('[data-grading-state="complete"]')
        .waitFor({ timeout: 20000 });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const trace = await page.evaluate(() => {
        cancelAnimationFrame(window.gradeTrace.frame);
        const first = document
          .querySelector(".mock-exam-sheet")
          .getBoundingClientRect();
        const scoreElement = document.querySelector(".mock-exam-score");
        const score = scoreElement.getBoundingClientRect();
        const scoreHit = document.elementFromPoint(
          score.x + score.width / 2,
          score.y + score.height / 2,
        );
        const toolbar = document
          .querySelector(".mock-exam-toolbar")
          .getBoundingClientRect();
        return {
          ...window.gradeTrace,
          firstTop: first.top,
          scoreTop: score.top,
          scoreBottom: score.bottom,
          scoreUncovered: scoreElement.contains(scoreHit),
          toolbarBottom: toolbar.bottom,
          viewportHeight: innerHeight,
          windowTop: scrollY,
          nestedTop: document.querySelector(".mock-exam-workspace-scroll")
            .scrollTop,
        };
      });
      const order = questions.map((_, index) => index);
      assert.deepEqual(
        trace.starts.map((event) => event.index),
        order,
        "Marks draw in paper number order, independently of question IDs",
      );
      assert.deepEqual(
        trace.ends.map((event) => event.index),
        order,
        "Every drawing must finish, including reduced motion",
      );
      assert.deepEqual(
        trace.samples.map((sample) => sample.index),
        order,
        "Every mark has a visibly partial stroke",
      );
      assert.deepEqual(trace.violations, []);
      assert(
        trace.starts.every((event) => event.duration === "0.64s"),
        "Each mark uses the full 640ms drawing duration",
      );
      assert(
        trace.starts.every((event) => event.color === "rgb(185, 28, 28)"),
        "Grading uses red pencil marks",
      );
      assert.deepEqual(
        trace.starts.map((event) => event.correct),
        order.map((index) => (zero ? false : index % 2 === 0)),
      );
      assert(
        new Set(trace.starts.map((event) => event.page)).size >= 2,
        "Grading follows multiple pages",
      );
      for (let index = 1; index < trace.starts.length; index++)
        assert(
          trace.starts[index].time >= trace.ends[index - 1].time + 100,
          "Each completed stroke has a visible pause before the next question",
        );
      assert(
        trace.complete.time >= trace.ends.at(-1).time,
        "Final score waits for the final stroke",
      );
      assert(
        trace.starts.every(
          (event) => event.top >= 0 && event.bottom <= event.height,
        ),
        "Active grading mark remains on screen",
      );
      assert(
        trace.starts.every((event) => event.coversNumber),
        "Marks surround the question number, including questions after a shared passage",
      );
      assert(
        trace.firstTop >= -1 && trace.firstTop < 120,
        `Returns to first page top: ${JSON.stringify(trace)}`,
      );
      assert(
        trace.scoreTop >= 0 && trace.scoreBottom < trace.viewportHeight,
        "Final score is visible after returning to page one",
      );
      assert(
        trace.scoreUncovered,
        `Final score must not be covered by sticky headers: ${JSON.stringify({ width, reducedMotion, scoreTop: trace.scoreTop, scoreBottom: trace.scoreBottom, toolbarBottom: trace.toolbarBottom })}`,
      );
      assert.equal(
        trace.complete.score,
        `${zero ? 0 : 73.5}/100`,
        "Displays authoritative score, including zero",
      );
      assert.equal(
        await page.locator(".mock-exam-pencil").count(),
        questions.length,
      );
      assert.equal(
        await page.locator(".mock-exam-pencil.is-drawing").count(),
        0,
        "Completed paper has no looping animations",
      );
      await page.screenshot({
        path: path.join(evidence, `result-${width}-${reducedMotion}.png`),
      });
      await page.locator('article[data-question-index="0"]').click();
      await page
        .getByRole("dialog", { name: "1번 문제 확대", exact: true })
        .waitFor();
      assert(
        (await page.getByRole("dialog").textContent()).includes("정답: 성균관"),
        "Post-grading answer review still opens",
      );
      reports.push({ width, reducedMotion, zero, trace });
      await page.close();
    }
  }
  const history = await browser.newPage({
    viewport: { width: 768, height: 900 },
    reducedMotion: "reduce",
  });
  history.on("pageerror", (error) => errors.push(error.message));
  await history.goto(origin + "?history");
  await history.evaluate(() => document.fonts.ready);
  await history.locator(".mock-exam-score").waitFor();
  assert.equal(
    await history.locator(".mock-exam-pencil").count(),
    questions.length,
    "Past results show all grades immediately",
  );
  assert.equal(
    await history.locator(".mock-exam-pencil.is-drawing").count(),
    0,
    "Past results do not replay submission grading",
  );
  await history.evaluate(() => scrollTo(0, 300));
  await history.waitForTimeout(1100);
  assert.equal(
    await history.evaluate(() => scrollY),
    300,
    "Historical paper does not take over scrolling",
  );
  await history.close();
  assert.deepEqual(errors, [], "No browser exceptions");
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ reports, history: "passed", errors }, null, 2),
  );
  console.log(
    `Mock exam grading passed: 390/768/1280px × normal/reduced motion, page order, visible strokes, final score, static history. Evidence: ${evidence}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
