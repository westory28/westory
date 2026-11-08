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
questions[1].options = ["(가) 김시민\t(나) 이순신", "(가) 이순신\t(나) 권율"];
questions[1].answer = questions[1].options[1];
questions[3].type = "short";
questions[3].options = [];
questions[3].answer = "수조권";
questions[4].points = 3.5;
// A legacy snapshot without an answer must not invent a correction.
delete questions[5].answer;
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Workspace from './src/pages/student/quiz/MockExamWorkspace';
import Paper from './src/components/common/MockExamPaper';
import PencilScore from './src/components/common/MockExamPencilScore';
const questions=${JSON.stringify(questions)};const params=new URLSearchParams(location.search);
const zero=params.has('zero');const checks=questions.map((question,index)=>({id:question.id,correct:zero?false:index%2===0}));
const answers=Object.fromEntries(questions.map((question,index)=>[question.id,checks[index].correct?question.answer:question.type==='short'?'':question.options[0]]));
const presentation=questions.map(({answer,explanation,...question})=>question);
window.gradingFixture={submits:0,selects:[],checks};
function App(){const [result,setResult]=useState(false);const [index,setIndex]=useState(0);
if(params.has('scores'))return <div style={{padding:32,display:'grid',gap:28}}>{[0,100,95.00,73.50,12.34,56.78,90.01].map(value=><div key={value} style={{display:'flex',alignItems:'center',gap:24}}><span style={{width:70}}>{value}점</span><PencilScore score={value}/></div>)}</div>;
if(params.has('earned-cases'))return <><section data-case="server"><Paper questions={questions.slice(0,1)} score={66.67} earnedPoints={7} checks={checks.slice(0,1)}/></section><section data-case="unknown"><Paper questions={[{...questions[0],points:undefined}]} score={66.67} checks={checks.slice(0,1)}/></section><section data-case="zero"><Paper questions={questions.slice(0,1)} score={0} earnedPoints={0} checks={[]}/></section></>;
if(params.has('history'))return <><div style={{height:120}}>과거 기록 검증</div><Paper questions={questions} answers={answers} score={73.5} checks={checks}/></>;
return <Workspace questions={result?questions:presentation} answers={answers} round="round_1" studentLabel="3학년 1반 1번 가상 학생" currentIndex={index} onSelect={next=>{window.gradingFixture.selects.push(next);setIndex(next)}} onSubmit={()=>{window.gradingFixture.submits++;setResult(true)}} timeLeft={600} score={result?(zero?0:73.5):undefined} checks={result?checks:[]} />;
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
      assert.equal(
        await page.locator(".mock-exam-correction").count(),
        0,
        "Correct answers are not exposed before submission",
      );
      await page.evaluate(() => {
        window.gradeTrace = {
          starts: [],
          ends: [],
          tails: [],
          tailEnds: [],
          tailSamples: [],
          corrections: [],
          correctionEnds: [],
          scoreStarts: [],
          scoreEnds: [],
          scoreSamples: [],
          samples: [],
          violations: [],
          complete: null,
        };
        document.addEventListener("animationstart", (event) => {
          const article = event.target.closest("[data-question-index]");
          const basic = {
            index: Number(article?.dataset.questionIndex),
            time: performance.now(),
          };
          if (event.animationName === "mock-exam-pencil-finish") {
            window.gradeTrace.tails.push(basic);
            return;
          }
          if (event.animationName === "mock-exam-correction-draw") {
            const correction = event.target.closest(".mock-exam-correction");
            const option = correction?.closest("li");
            window.gradeTrace.corrections.push({
              ...basic,
              option: option?.querySelector(".mock-exam-option-text")
                ?.textContent,
              color: correction ? getComputedStyle(correction).color : null,
            });
            return;
          }
          if (event.animationName === "mock-exam-score-write") {
            const score = event.target.closest(".mock-exam-score");
            const rect = score.getBoundingClientRect();
            window.gradeTrace.scoreStarts.push({
              time: performance.now(),
              stroke: [...score.querySelectorAll("path")].indexOf(event.target),
              top: rect.top,
              bottom: rect.bottom,
              height: innerHeight,
              scroll: document.querySelector(".mock-exam-workspace-scroll")
                .scrollTop,
              state:
                document.querySelector(".mock-exam-paper").dataset.gradingState,
            });
            return;
          }
          if (event.animationName !== "mock-exam-pencil-draw") return;
          const mark = article.querySelector(".mock-exam-pencil");
          const path = event.target;
          const points = Array.from({ length: 41 }, (_, i) =>
            path.getPointAtLength((path.getTotalLength() * i) / 40),
          );
          const area =
            points.reduce((sum, point, i) => {
              const next = points[(i + 1) % points.length];
              return sum + point.x * next.y - next.x * point.y;
            }, 0) / 2;
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
            start: { x: points[0].x, y: points[0].y },
            area,
            coversNumber:
              rect.left <= number.left &&
              rect.right >= number.right &&
              rect.top <= number.top &&
              rect.bottom >= number.bottom,
          });
        });
        document.addEventListener("animationend", (event) => {
          const index = Number(
            event.target.closest("[data-question-index]")?.dataset
              .questionIndex,
          );
          const item = { index, time: performance.now() };
          if (event.animationName === "mock-exam-pencil-finish")
            window.gradeTrace.tailEnds.push(item);
          if (event.animationName === "mock-exam-correction-draw")
            window.gradeTrace.correctionEnds.push(item);
          if (event.animationName === "mock-exam-score-write") {
            const score = event.target.closest(".mock-exam-score");
            window.gradeTrace.scoreEnds.push({
              time: performance.now(),
              stroke: [...score.querySelectorAll("path")].indexOf(event.target),
            });
          }
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
          if (
            score &&
            window.gradeTrace.ends.length < window.gradingFixture.checks.length
          )
            window.gradeTrace.violations.push(
              "Score shown before all question marks completed",
            );
          if (score)
            for (const path of score.querySelectorAll("path")) {
              const style = getComputedStyle(path);
              const offset = parseFloat(style.strokeDashoffset);
              const stroke = [...score.querySelectorAll("path")].indexOf(path);
              if (
                style.animationName === "mock-exam-score-write" &&
                offset > 5 &&
                offset < 95 &&
                !window.gradeTrace.scoreSamples.some(
                  (sample) => sample.stroke === stroke,
                )
              )
                window.gradeTrace.scoreSamples.push({ stroke, offset });
            }
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
            for (const path of mark.querySelectorAll(
              ".mock-exam-pencil-reveal",
            )) {
              const style = getComputedStyle(path),
                offset = parseFloat(style.strokeDashoffset);
              if (
                style.animationName === "mock-exam-pencil-finish" &&
                offset > 5 &&
                offset < 95 &&
                !window.gradeTrace.tailSamples.includes(index)
              )
                window.gradeTrace.tailSamples.push(index);
            }
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
      await fs.writeFile(
        path.join(evidence, `trace-${width}-${reducedMotion}.json`),
        JSON.stringify(trace, null, 2),
      );
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
        trace.starts.every(
          (event) => event.duration === (event.correct ? "0.28s" : "0.36s"),
        ),
        "Pencil marks use faster 280ms loop/360ms slash timing even with reduced motion",
      );
      const correctIndexes = order.filter((index) => !zero && index % 2 === 0);
      assert.deepEqual(
        trace.tails.map((item) => item.index),
        correctIndexes,
      );
      assert.deepEqual(
        trace.tailEnds.map((item) => item.index),
        correctIndexes,
      );
      assert.deepEqual(
        trace.tailSamples,
        correctIndexes,
        "The finishing tail is visibly drawn, not shown at once",
      );
      for (const index of correctIndexes) {
        const start = trace.starts[index];
        const angle =
          (Math.atan2(start.start.x - 40, 40 - start.start.y) * 180) / Math.PI;
        assert(
          angle >= 130 && angle <= 170 && start.area > 0,
          "Circle begins near five o'clock and travels clockwise",
        );
        assert(
          trace.tails.find((item) => item.index === index).time >=
            trace.ends[index].time - 20,
          "The finishing tail starts after the loop, never at its overlapping start",
        );
      }
      const correctionIndexes = order.filter(
        (index) => (zero || index % 2 === 1) && questions[index].answer != null,
      );
      assert.deepEqual(
        trace.corrections.map((item) => item.index),
        correctionIndexes,
      );
      assert.deepEqual(
        trace.correctionEnds.map((item) => item.index),
        correctionIndexes,
      );
      for (const correction of trace.corrections) {
        assert(
          correction.time >= trace.ends[correction.index].time - 20,
          "A red answer check starts only after that question's slash",
        );
        assert.equal(correction.color, "rgb(185, 28, 28)");
        if (correction.index < questions.length - 1)
          assert(
            trace.starts[correction.index + 1].time >=
              trace.correctionEnds.find(
                (item) => item.index === correction.index,
              ).time,
            "Finish the correction before moving to the next question",
          );
      }
      assert.equal(
        trace.corrections
          .find((item) => item.index === 1)
          .option.replace(/\s+/g, ""),
        questions[1].answer.replace(/\s+/g, ""),
        "The red check targets the correct multi-column row",
      );
      assert(
        (
          await page
            .locator('.mock-exam-sheet article[data-question-index="3"]')
            .innerText()
        ).includes("수조권"),
        "An unanswered short item shows the stored correct answer",
      );
      assert.equal(
        await page
          .locator(
            '.mock-exam-sheet article[data-question-index="5"] .mock-exam-correction',
          )
          .count(),
        0,
        "A missing stored answer never produces a guessed correction",
      );
      assert(
        trace.scoreStarts.length > 0 &&
          trace.scoreEnds.length === trace.scoreStarts.length,
        "The final score writes every stroke",
      );
      assert.deepEqual(
        trace.scoreSamples.map((item) => item.stroke),
        trace.scoreStarts.map((item) => item.stroke),
        "Each score stroke is visibly partial, not shown in one step",
      );
      assert(
        trace.scoreStarts.every(
          (item) =>
            item.state === "grading" &&
            item.top >= 0 &&
            item.bottom < item.height &&
            item.scroll === 0,
        ),
        "Return to page one before handwriting the score and remain busy",
      );
      for (let i = 1; i < trace.scoreStarts.length; i++)
        assert(
          trace.scoreStarts[i].time >= trace.scoreEnds[i - 1].time - 20,
          "Score strokes are written in order",
        );
      assert(
        trace.complete.time >= trace.scoreEnds.at(-1).time,
        "Grading completes only after the final score underline",
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
          trace.starts[index].time >= trace.ends[index - 1].time + 20,
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
        `${zero ? 0 : 9.5}`,
        "Displays earned question points, including zero, without a /100 denominator",
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
  assert.equal(
    await history
      .locator(
        '.mock-exam-score[data-score-state="drawing"],.mock-exam-correction[data-correction-state="drawing"]',
      )
      .count(),
    0,
    "Past corrections and score are static",
  );
  assert.equal(
    await history.locator(".mock-exam-score").textContent(),
    "9.5",
    "Past papers display earned question points",
  );
  await history.evaluate(() => scrollTo(0, 300));
  await history.waitForTimeout(1100);
  assert.equal(
    await history.evaluate(() => scrollY),
    300,
    "Historical paper does not take over scrolling",
  );
  await history.close();
  const scores = await browser.newPage({
    viewport: { width: 390, height: 800 },
  });
  await scores.goto(origin + "?scores");
  assert.deepEqual(
    await scores.locator(".mock-exam-score").allTextContents(),
    ["0", "100", "95", "73.5", "12.34", "56.78", "90.01"],
    "Integer scores omit decimals while fractional scores retain meaningful digits",
  );
  assert.equal(
    await scores.getByRole("img", { name: "점수 100점", exact: true }).count(),
    1,
  );
  await scores.screenshot({
    path: path.join(evidence, "pencil-score-numerals.png"),
  });
  await scores.close();
  const earnedCases = await browser.newPage({
    viewport: { width: 768, height: 900 },
  });
  await earnedCases.goto(origin + "?earned-cases");
  await earnedCases.locator('[data-case="server"] .mock-exam-score').waitFor();
  assert.equal(
    await earnedCases
      .locator('[data-case="server"] .mock-exam-score')
      .textContent(),
    "7",
    "Authoritative earned points survive incomplete question snapshots",
  );
  assert.equal(
    await earnedCases.locator('[data-case="unknown"] .mock-exam-score').count(),
    0,
    "Missing points cannot fall back to normalized percentage or guessed one-point values",
  );
  assert.equal(
    await earnedCases
      .locator('[data-case="zero"] .mock-exam-score')
      .textContent(),
    "0",
    "Authoritative zero earned points are preserved",
  );
  await earnedCases.close();
  assert.deepEqual(errors, [], "No browser exceptions");
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ reports, history: "passed", errors }, null, 2),
  );
  console.log(
    `Mock exam grading passed: 390/768/1280px × normal/reduced motion, clockwise circles/tails, sequential answer corrections and handwritten earned points, static history. Evidence: ${evidence}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
