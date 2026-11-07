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
  process.env.MOCK_EXAM_INTERACTION_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-paper-interaction-")));
await fs.mkdir(evidence, { recursive: true });
const questions = [
  {
    id: 1,
    type: "choice",
    question: "합성 자료에 해당하는 인물을 고르시오.",
    options: ["조준", "이방원", "이성계", "정도전", "정몽주"],
    answer: "정몽주",
    explanation: "합성 문항의 해설입니다.",
    points: 3,
    paperOrder: 1,
    examRound: "round_1",
  },
  {
    id: 2,
    type: "short",
    question: "짧은 답안을 쓰시오.",
    answer: "한양",
    points: 4,
    paperOrder: 2,
    examRound: "round_1",
  },
  {
    id: 3,
    type: "order",
    question: "순서를 선택하시오.",
    options: ["첫째", "둘째", "셋째"],
    answer: "첫째||둘째||셋째",
    points: 4,
    paperOrder: 3,
    examRound: "round_1",
  },
  {
    id: 4,
    type: "matching",
    question: "알맞게 연결하시오.",
    matchingPairs: [
      { left: "왼쪽 가", right: "오른쪽 가" },
      { left: "왼쪽 나", right: "오른쪽 나" },
    ],
    points: 4,
    paperOrder: 4,
    examRound: "round_1",
  },
  ...Array.from({ length: 12 }, (_, i) => ({
    id: i + 5,
    type: "choice",
    question: `${i + 5}번 합성 긴 자료 문항`,
    passage:
      "문항이 한 단과 다음 쪽에 걸쳐 잘리지 않는지 확인하는 합성 자료입니다.\n".repeat(
        5 + (i % 2),
      ),
    options: ["정치", "경제", "사회", "문화", "생활"],
    answer: "문화",
    points: 5,
    paperOrder: i + 5,
    examRound: "round_1",
  })),
  {
    id: 101,
    type: "choice",
    question: "다른 회차 합성 문항",
    options: ["가", "나", "다", "라", "마"],
    answer: "다",
    points: 5,
    paperOrder: 1,
    examRound: "round_2",
  },
];
// A picture question followed by five long choices reproduces the reported
// premature column break without using real student records or remote assets.
const fittingQuestions = [
  {
    ...questions[0],
    question: "(가)에 들어갈 인물로 옳은 것은?",
    image: "/qa-fitting-material.svg",
  },
  {
    ...questions[0], id: 2, paperOrder: 2,
    question: "(가) 인물이 추진한 정책으로 옳은 것은?",
    passage: "조선 건국에 참여한 (가)은/는 왕자의 난을 거치면서 정치적 실권을 장악한 뒤 왕위에 올랐다. 그는 공신과 왕자들의 세력을 견제하며 국왕 중심의 정치를 지향하였다.",
    options: [
      "집현전을 폐지하였다.",
      "훈민정음을 창제하였다.",
      "사병을 없애 군사권을 장악하였다.",
      "『경국대전』을 완성하여 반포하였다.",
      "직전법을 실시하여 토지 부족에 대응하였다.",
    ],
    answer: "사병을 없애 군사권을 장악하였다.",
  },
];
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import Preview from './src/pages/teacher/components/MockExamPreview';import Draft from './src/pages/teacher/components/MockExamDraftPreview';import Workspace from './src/pages/student/quiz/MockExamWorkspace';import './src/pages/teacher/components/QuizWorkspace.css';const questions=${JSON.stringify(questions)};const fittingQuestions=${JSON.stringify(fittingQuestions)};window.paperQa={loads:0};function App(){const [answers,setAnswers]=useState({});const [index,setIndex]=useState(0);const mode=new URLSearchParams(location.search).get('mode');const previewQuestions=mode==='fit'?fittingQuestions:questions;return mode==='student'?<Workspace questions={questions.slice(0,4)} answers={answers} round="round_1" studentLabel="가상 학생" currentIndex={index} onSelect={setIndex} onAnswer={value=>setAnswers(previous=>({...previous,[questions[index].id]:value}))} timeLeft={600}/>:mode==='draft'?<div className="quiz-authoring-surface" style={{maxWidth:720,margin:'auto'}}><Draft question={questions[0]}/></div>:<Preview entries={previewQuestions.map(q=>({id:q.id}))} loadQuestions={async()=>{window.paperQa.loads++;return previewQuestions}}/>}createRoot(document.getElementById('root')).render(<App/>);`;
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
  "Fixture contains no live Firebase boundary",
);
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const globalCss =
  (await fs.readFile(path.join(root, "assets/css/style.css"), "utf8")) +
  (await fs.readFile(path.join(root, "src/assets/index.css"), "utf8"));
const css = (
  globalCss + built.outputFiles.find((f) => f.path.endsWith(".css")).text
).replace(/@import\s+url\([^;]+;/g, "");
const js = built.outputFiles.find((f) => f.path.endsWith(".js")).text;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}body{margin:0}#root{min-height:100dvh}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/qa-fitting-material.svg") {
    res.setHeader("Content-Type", "image/svg+xml");
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect x="2" y="2" width="476" height="266" fill="white" stroke="black"/><path d="M40 240L160 70L280 240L410 100" fill="none" stroke="black" stroke-width="4"/><text x="240" y="35" text-anchor="middle" font-size="18">QA</text></svg>');
    return;
  }
  res.setHeader(
    "Content-Type",
    pathname.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : "text/html; charset=utf-8",
  );
  res.end(
    pathname === "/fixture.js"
      ? js
      : pathname === "/tailwind.js"
        ? tailwind
        : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const reports = [];
const settleAnswerMarks = (page) => page.locator('.mock-exam-answer-check').evaluateAll((marks) =>
  Promise.all(marks.flatMap((mark) => mark.getAnimations({ subtree: true })).map((animation) => animation.finished)),
);
const checkAnswerMark = async (page, radioName, motion) => {
  await page.emulateMedia({ reducedMotion: motion });
  const radio = page.getByRole("radio", { name: radioName, exact: true });
  await radio.locator("..").click();
  assert(await radio.isChecked());
  const mark = radio.locator("..").locator(".mock-exam-answer-check");
  const animation = await mark.evaluate(async (svg) => {
    const path = svg.querySelector(".mock-exam-answer-check-reveal");
    const ink = svg.querySelector(".mock-exam-answer-check-ink");
    const animations = svg.getAnimations({ subtree: true });
    const draw = path?.getAnimations()[0];
    if (!draw) return { count: animations.length, hasDraw: false };
    const timing = draw.effect.getComputedTiming();
    const duration = Number(timing.duration);
    const delay = Number(timing.delay);
    const read = async (fraction) => {
      draw.pause();
      draw.currentTime = delay + duration * fraction;
      await new Promise(requestAnimationFrame);
      return parseFloat(getComputedStyle(path).strokeDashoffset);
    };
    const start = await read(0), middle = await read(0.4), end = await read(1);
    const style = getComputedStyle(svg);
    const result = {
      count: animations.length, hasDraw: true, duration,
      iterations: timing.iterations, start, middle, end,
      widthRatio: parseFloat(style.width) / parseFloat(style.fontSize),
      strokeWidth: parseFloat(getComputedStyle(ink).strokeWidth),
      stroke: getComputedStyle(ink).stroke,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
    animations.forEach((animation) => animation.finish());
    return result;
  });
  assert(animation.hasDraw, `${motion}: selection starts a real SVG stroke animation`);
  assert(animation.duration >= 150 && animation.duration <= 1000, `${motion}: bounded visible drawing duration`);
  assert.equal(animation.iterations, 1, "Selection drawing never loops");
  assert(animation.start > animation.middle && animation.middle > animation.end, `${motion}: the check visibly draws along its path`);
  assert.equal(animation.end, 0, "Finished selection remains fully drawn");
  assert(animation.widthRatio >= 1.8, "Selected pencil check is larger than the original 1.65em mark");
  assert(animation.strokeWidth >= 3, "Selected pencil check is thicker than the original 2.2px stroke");
  assert(animation.stroke.match(/\d+/g).slice(0, 3).every((value) => Number(value) <= 55), "Selected check has dark graphite ink");
  assert.equal(animation.reduced, motion === "reduce");
  return animation;
};
const checkPreviewFooter = async (page) => {
  const footer = page.locator(".mock-exam-preview-footer");
  assert.deepEqual(await footer.getByRole("button").allTextContents(), ["시험지로 돌아가기", "이전 문제", "다음 문제"]);
  assert.equal(await page.getByRole("button", { name: "시험지로 돌아가기", exact: true }).count(), 1);
  const layout = await footer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const buttons = [...element.querySelectorAll("button")].map((button) => {
      const bounds = button.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, height: bounds.height };
    });
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, padding: parseFloat(getComputedStyle(element).paddingLeft), buttons,
      bodyBottom: document.querySelector(".quiz-composer-body").getBoundingClientRect().bottom };
  });
  assert(Math.abs(layout.buttons[0].left - layout.left - layout.padding) <= 1, "Return action stays at the footer's left edge");
  assert(layout.buttons[0].right <= layout.buttons[1].left, "Return and question navigation do not overlap");
  assert(layout.buttons[1].right <= layout.buttons[2].left, "Previous and next actions do not overlap");
  assert(layout.buttons.every((button) => Math.abs(button.top - layout.buttons[0].top) <= 1), "All footer actions stay in one row");
  assert(layout.buttons.every((button) => button.height >= 44 && button.left >= layout.left && button.right <= layout.right + 1));
  assert(layout.bodyBottom <= layout.top + 1, "Question scroll area stops above fixed actions");
  assert(layout.bottom <= (await page.viewportSize()).height + 1);
  return layout;
};
try {
  for (const width of [390, 768, 1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    const unexpected = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        unexpected.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(origin);
    await page.getByRole("button", { name: "미리보기", exact: true }).click();
    await page.locator(".mock-exam-sheet").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
      () => document.querySelectorAll(".mock-exam-sheet").length > 1,
    );
    const layout = await page.evaluate(() => {
      const sheets = [...document.querySelectorAll(".mock-exam-sheet")];
      const articles = [
        ...document.querySelectorAll(".mock-exam-sheet .mock-exam-question"),
      ];
      const title = document.querySelector(".mock-exam-title-box");
      const li = document.querySelector(
        ".mock-exam-sheet .mock-exam-options li",
      );
      return {
        pages: sheets.length,
        count: articles.length,
        titlePosition: getComputedStyle(title).position,
        titleRows: [...title.children].map((e) => e.textContent),
        titleOverflow:
          title.querySelector("h2").scrollWidth >
          title.querySelector("h2").clientWidth,
        instructions: document.querySelector(".mock-exam-instructions")
          .textContent,
        instructionSteps: document.querySelectorAll(
          ".mock-exam-instructions > ol > li",
        ).length,
        instructionsBeforeQuestion:
          document
            .querySelector(".mock-exam-instructions")
            .getBoundingClientRect().bottom <
          articles[0].getBoundingClientRect().top,
        stamps: document.querySelectorAll(".mock-exam-stamp").length,
        royalStamps: document.querySelectorAll(".mock-exam-stamp--royal")
          .length,
        toolbarHeight: document
          .querySelector(".mock-exam-preview-toolbar")
          .getBoundingClientRect().height,
        toolbarSingleRow:
          Math.abs(
            document
              .querySelector(".mock-exam-preview-round select")
              .getBoundingClientRect().top -
              document
                .querySelector(".mock-exam-preview-toolbar > button")
                .getBoundingClientRect().top,
          ) < 2,
        approval: [...document.querySelectorAll(".mock-exam-approval th")].map(
          (e) => e.textContent,
        ),
        choice: li.textContent,
        gap: getComputedStyle(li).gap,
        footers: sheets.map((s) => s.querySelector("footer").textContent),
        copyright: sheets.map((sheet) => {
          const paragraphs = [...sheet.querySelectorAll(".mock-exam-copyright p")];
          return paragraphs.map((paragraph) => {
            const range = document.createRange();
            range.selectNodeContents(paragraph);
            const lines = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
            return { text: paragraph.textContent, lines: lines.length, fits: paragraph.scrollWidth <= paragraph.clientWidth + 1 };
          });
        }),
        overlaps: sheets.flatMap((s, i) =>
          [...s.querySelectorAll(".mock-exam-question")]
            .filter(
              (q) =>
                q.getBoundingClientRect().bottom >
                s.querySelector("footer").getBoundingClientRect().top,
            )
            .map(() => i),
        ),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(layout.titlePosition, "static");
    assert.equal(await page.locator(".quiz-composer-footer").count(), 0);
    assert.equal(layout.count, 16);
    assert.deepEqual(layout.titleRows, [
      "중학교 3학년 역사과 초시(역사과 1회 모의고사)",
      "3학년　　반　　번　 이름:",
    ]);
    assert(!layout.titleOverflow);
    assert.match(layout.instructions, /총 16문항 · 총 75점/);
    assert.equal(layout.instructionSteps, 4);
    assert(
      layout.instructions.includes(
        `문제지가 총 ${layout.pages}쪽인지 확인하시오.`,
      ),
    );
    assert.match(layout.instructions, /학년, 반, 번호, 이름과 과목/);
    assert.match(layout.instructions, /선다형: 13문항 · 총 63점/);
    assert.match(layout.instructions, /단답형: 1문항 · 총 4점/);
    assert.match(layout.instructions, /답안 입력칸에 작성하시오/);
    assert(!layout.instructions.includes("논술형"));
    assert(layout.instructionsBeforeQuestion);
    assert.equal(layout.stamps, 4);
    assert.equal(layout.royalStamps, 1);
    assert(layout.toolbarSingleRow);
    assert(layout.toolbarHeight <= 64);
    assert.deepEqual(layout.approval, ["노비", "상민", "양반", "왕"]);
    assert.match(layout.choice, /^①\s+조준/);
    assert(parseFloat(layout.gap) >= 4);
    assert(!layout.overflow);
    assert.deepEqual(layout.overlaps, [], "Questions must remain above footer");
    layout.footers.forEach((text, i) => {
      assert(text.includes(`${layout.pages} - ${i + 1}`));
      assert(text.includes("이 시험문제의 저작권은 위스토리에 있습니다."));
    });
    layout.copyright.forEach((lines) => {
      assert.deepEqual(lines.map((line) => line.text), [
        "이 시험문제의 저작권은 위스토리에 있습니다.",
        "저작권법에 보호받는 저작물이므로 무단 전재 및 복제는 금지되며, 이를 어길 시 저작권법에 의거해 처벌될 수 있습니다.",
      ]);
      assert(lines.every((line) => line.lines === 1 && line.fits), "Copyright has exactly two complete physical lines");
    });
    const scroll = await page.evaluate(() => {
      const body = document.querySelector(".quiz-composer-body"),
        title = document.querySelector(".mock-exam-title-box");
      const before = title.getBoundingClientRect().top;
      body.scrollTop = 180;
      return { before };
    });
    const after = await page
      .locator(".mock-exam-title-box")
      .evaluate((e) => e.getBoundingClientRect().top);
    assert(
      Math.abs(scroll.before - after - 180) < 2,
      "Title scrolls with paper",
    );
    await page
      .locator(".quiz-composer-body")
      .evaluate((e) => (e.scrollTop = 0));
    await page.screenshot({
      path: path.join(evidence, `teacher-paper-${width}.png`),
    });
    const first = page.locator(".mock-exam-sheet .mock-exam-question").first();
    await first.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("region", { name: "1번 문제 풀이 미리보기" })
      .waitFor();
    assert.equal(
      await page.getByRole("dialog").count(),
      1,
      "No nested preview dialog",
    );
    assert.equal(await page.locator(".quiz-composer-footer").count(), 1);
    layout.previewFooter = await checkPreviewFooter(page);
    layout.compactAnswers = await page.locator('.mock-exam-answer-controls [role="radiogroup"]').evaluate((group) => {
      const labels = [...group.querySelectorAll("label")].map((label) => label.getBoundingClientRect());
      return { height: group.getBoundingClientRect().height, gap: parseFloat(getComputedStyle(group).rowGap), heights: labels.map((rect) => rect.height),
        overlaps: labels.slice(1).some((rect, index) => rect.top < labels[index].bottom - 0.5) };
    });
    assert(layout.compactAnswers.gap <= 4, "Choice rows are more compact than the old 8px gaps");
    assert(layout.compactAnswers.heights.every((height) => height >= 44 && height <= 48), "Compact choices preserve touch targets");
    assert(!layout.compactAnswers.overlaps);
    assert(layout.compactAnswers.height <= 256, "Five short choices fit in a compact vertical group");
    layout.normalAnimation = await checkAnswerMark(page, "① 조준", "no-preference");
    layout.reduceAnimation = await checkAnswerMark(page, "② 이방원", "reduce");
    await page.getByRole("radio", { name: "① 조준", exact: true }).locator("..").click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const selectedRadio = page.getByRole("radio", { name: "① 조준" });
    assert(await selectedRadio.isChecked());
    assert.equal(
      await selectedRadio.evaluate(
        (e) => getComputedStyle(e.closest("label")).outlineStyle,
      ),
      "none",
      "Pointer selection shows only the pencil check",
    );
    await settleAnswerMarks(page);
    await page.screenshot({
      path: path.join(evidence, `teacher-solve-pointer-${width}.png`),
    });
    assert.equal(
      await selectedRadio.evaluate((e) => getComputedStyle(e).clipPath),
      "inset(50%)",
    );
    assert.equal(
      await page
        .locator(".mock-exam-answer-controls .mock-exam-answer-check")
        .count(),
      1,
    );
    await selectedRadio.focus();
    await page.keyboard.press("ArrowDown");
    assert(await page.getByRole("radio", { name: "② 이방원" }).isChecked());
    assert(
      await page
        .getByRole("radio", { name: "② 이방원" })
        .evaluate(
          (e) => getComputedStyle(e.closest("label")).outlineStyle === "solid",
        ),
    );
    await page.keyboard.press("ArrowUp");
    await settleAnswerMarks(page);
    await page.screenshot({
      path: path.join(evidence, `teacher-solve-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await first.waitFor({ state: "visible" });
    assert.equal(await first.getAttribute("aria-pressed"), "true");
    assert(await first.evaluate((e) => e === document.activeElement));
    assert.notEqual(
      await first.evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(239, 246, 255)",
    );
    assert.equal(await first.locator(".mock-exam-answer-check").count(), 1);
    assert(await first.evaluate((e) => e.matches(":focus-visible")));
    await first.click();
    assert(await page.getByRole("radio", { name: "① 조준" }).isChecked());
    await page.getByRole("button", { name: "다음 문제", exact: true }).click();
    const short = page.getByRole("textbox", { name: "답안", exact: true });
    await short.fill("한양");
    assert.equal(await short.getAttribute("maxlength"), "20");
    await page.getByRole("button", { name: "다음 문제", exact: true }).click();
    await page.getByRole("button", { name: "첫째", exact: true }).click();
    await page.getByRole("button", { name: "둘째", exact: true }).click();
    await page.getByRole("button", { name: "다음 문제", exact: true }).click();
    await page.getByLabel("왼쪽 가", { exact: true }).selectOption("오른쪽 가");
    for (let step = 0; step < 4; step++)
      await page
        .getByRole("button", { name: "다음 문제", exact: true })
        .click();
    await page
      .getByRole("button", { name: "시험지로 돌아가기", exact: true })
      .click();
    assert.equal(
      await page.locator('.mock-exam-question[aria-pressed="true"]').count(),
      1,
    );
    await page.waitForFunction(() => {
      const selected = document.querySelector(
        '.mock-exam-question[aria-pressed="true"]',
      );
      if (!selected || document.activeElement !== selected) return false;
      const selectedRect = selected.getBoundingClientRect();
      const bodyRect = document
        .querySelector(".quiz-composer-body")
        .getBoundingClientRect();
      return (
        selectedRect.bottom > bodyRect.top && selectedRect.top < bodyRect.bottom
      );
    });
    assert.equal(
      await page
        .locator('.mock-exam-question[aria-pressed="true"]')
        .evaluate((e) => getComputedStyle(e).outlineStyle),
      "none",
      "Pointer return has no persistent selection rectangle",
    );
    assert.equal(await page.evaluate(() => window.paperQa.loads), 1);
    await page.getByLabel("모의고사 회차").selectOption("round_2");
    assert.equal(
      await page.locator(".mock-exam-title-box h2").innerText(),
      "중학교 3학년 역사과 복시(역사과 2회 모의고사)",
    );
    assert.match(
      await page.locator(".mock-exam-instructions").innerText(),
      /총 1문항 · 총 5점/,
    );
    assert.match(
      await page.locator(".mock-exam-instructions").innerText(),
      /단답형: 0문항 · 총 0점/,
    );
    assert.match(
      await page.locator(".mock-exam-instructions").innerText(),
      /단답형: 물음에 알맞은 답을 답안 입력칸에 작성하시오/,
    );
    assert.equal(await page.locator(".mock-exam-sheet").count(), 1);
    await page.getByLabel("모의고사 회차").selectOption("round_1");
    assert.equal(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
      0,
      "Practice does not persist responses",
    );
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("button", { name: "미리보기", exact: true }).click();
    await page.locator(".mock-exam-sheet .mock-exam-question").first().click();
    assert(
      !(await page.getByRole("radio", { name: "① 조준" }).isChecked()),
      "Close clears local practice",
    );
    await page.goto(origin + "/?mode=draft");
    await page
      .getByRole("button", { name: "문제 풀이 미리보기", exact: true })
      .click();
    await page
      .locator(".mock-exam-answer-controls label")
      .filter({ hasText: "① 조준" })
      .click();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "문제 풀이 미리보기", exact: true })
      .waitFor();
    assert.equal(
      await page.locator(".mock-exam-options .is-selected").count(),
      1,
    );
    await page.goto(origin + "/?mode=student");
    await page.locator(".mock-exam-sheet .mock-exam-question").first().click();
    await page
      .locator(".mock-exam-answer-controls label")
      .filter({ hasText: "① 조준" })
      .click();
    await page
      .getByRole("button", { name: "시험지로 돌아가기", exact: true })
      .click();
    assert.equal(
      await page.locator('.mock-exam-question[aria-pressed="true"]').count(),
      1,
    );
    assert.equal(
      await page.locator(".mock-exam-sheet .mock-exam-answer-check").count(),
      1,
    );
    assert.equal(
      await page.locator(".mock-exam-student").innerText(),
      "가상 학생",
    );
    assert.match(
      await page.locator(".mock-exam-instructions").innerText(),
      /총 4문항 · 총 15점/,
    );
    await settleAnswerMarks(page);
    await page.screenshot({
      path: path.join(evidence, `student-selected-${width}.png`),
    });
    await page.goto(origin + "/?mode=fit");
    await page.getByRole("button", { name: "미리보기", exact: true }).click();
    await page.locator(".mock-exam-sheet").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.querySelectorAll('.mock-exam-paper img')].every((image) => image.complete && image.naturalWidth > 0));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const fitting = await page.evaluate(() => {
      const sheet = document.querySelector(".mock-exam-sheet");
      const columns = [...sheet.querySelectorAll(".mock-exam-column")];
      const questions = [...sheet.querySelectorAll(".mock-exam-question")];
      const firstColumn = columns[0].getBoundingClientRect();
      const footer = sheet.querySelector("footer").getBoundingClientRect();
      const scale = sheet.getBoundingClientRect().width / sheet.offsetWidth;
      const notice = sheet.querySelector(".mock-exam-instructions");
      const noticeHeight = notice.getBoundingClientRect().height / scale + parseFloat(getComputedStyle(notice).marginBottom);
      const questionHeights = questions.map((question) => question.getBoundingClientRect().height / scale);
      const gap = parseFloat(getComputedStyle(document.querySelector('.mock-exam-measure > .mock-exam-question')).marginBottom);
      return { pages: document.querySelectorAll(".mock-exam-sheet").length,
        columnCounts: columns.map((column) => column.querySelectorAll(".mock-exam-question").length),
        room: (footer.top - firstColumn.top) / scale - 16,
        required: noticeHeight + questionHeights.reduce((sum, height) => sum + height, 0) + gap,
        noticeHeight, questionHeights, gap,
        order: questions.map((question) => question.textContent.trim().slice(0, 2)),
        overlaps: questions.some((question) => question.getBoundingClientRect().bottom > footer.top),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    await page.screenshot({ path: path.join(evidence, `teacher-two-question-fit-${width}.png`) });
    assert(fitting.required <= fitting.room + 1, `Fixture physically fits in the first column at ${width}px: ${JSON.stringify(fitting)}`);
    assert.deepEqual(fitting.columnCounts, [2, 0], "Q2 follows Q1 in the same column when both fit below the notice");
    assert.equal(fitting.pages, 1);
    assert(!fitting.overlaps && !fitting.overflow);
    assert.deepEqual(fitting.order, ["1.", "2."]);
    layout.fitting = fitting;
    await page.locator('.mock-exam-sheet .mock-exam-question').first().click();
    await checkPreviewFooter(page);
    await page.getByRole('radio', { name: '① 조준', exact: true }).locator('..').click();
    await settleAnswerMarks(page);
    await page.screenshot({ path: path.join(evidence, `teacher-picture-solve-${width}.png`) });
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    reports.push({ width, ...layout });
    await page.close();
  }
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(reports, null, 2),
  );
  console.log(
    JSON.stringify({
      pass: true,
      evidence,
      widths: reports.map((r) => r.width),
      checks:
        "teacher and draft local practice, student shared controls, compact accessible choices, larger dark pencil checks with bounded drawing under normal and reduced motion, footer return/previous/next ordering, keyboard focus, no storage/network writes, blank student fields, dynamic notices, two-question picture/long-choice fitting, exact two-line copyright, pagination without footer overlaps",
    }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
