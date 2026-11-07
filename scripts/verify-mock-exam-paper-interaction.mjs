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
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import Preview from './src/pages/teacher/components/MockExamPreview';import Draft from './src/pages/teacher/components/MockExamDraftPreview';import Workspace from './src/pages/student/quiz/MockExamWorkspace';import './src/pages/teacher/components/QuizWorkspace.css';const questions=${JSON.stringify(questions)};window.paperQa={loads:0};function App(){const [answers,setAnswers]=useState({});const [index,setIndex]=useState(0);const mode=new URLSearchParams(location.search).get('mode');return mode==='student'?<Workspace questions={questions.slice(0,4)} answers={answers} round="round_1" studentLabel="가상 학생" currentIndex={index} onSelect={setIndex} onAnswer={value=>setAnswers(previous=>({...previous,[questions[index].id]:value}))} timeLeft={600}/>:mode==='draft'?<div className="quiz-authoring-surface" style={{maxWidth:720,margin:'auto'}}><Draft question={questions[0]}/></div>:<Preview entries={questions.map(q=>({id:q.id}))} loadQuestions={async()=>{window.paperQa.loads++;return questions}}/>}createRoot(document.getElementById('root')).render(<App/>);`;
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
try {
  for (const width of [390, 768, 1440]) {
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
        approval: [...document.querySelectorAll(".mock-exam-approval th")].map(
          (e) => e.textContent,
        ),
        choice: li.textContent,
        gap: getComputedStyle(li).gap,
        footers: sheets.map((s) => s.querySelector("footer").textContent),
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
    assert.equal(layout.count, 16);
    assert.deepEqual(layout.approval, ["노비", "상민", "양반", "왕"]);
    assert.match(layout.choice, /^①\s+조준/);
    assert(parseFloat(layout.gap) >= 4);
    assert(!layout.overflow);
    assert.deepEqual(layout.overlaps, [], "Questions must remain above footer");
    layout.footers.forEach((text, i) => {
      assert(text.includes(`${layout.pages} - ${i + 1}`));
      assert(text.includes("이 시험지의 저작권은 위스토리에 있습니다."));
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
    await page.getByRole("radio", { name: "① 조준" }).check();
    await page.screenshot({
      path: path.join(evidence, `teacher-solve-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await first.waitFor({ state: "visible" });
    assert.equal(await first.getAttribute("aria-pressed"), "true");
    assert(await first.evaluate((e) => e === document.activeElement));
    assert.equal(
      await first.evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(239, 246, 255)",
    );
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
    assert.equal(await page.evaluate(() => window.paperQa.loads), 1);
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
    await page.getByRole("radio", { name: "① 조준" }).check();
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
    await page.getByRole("radio", { name: "① 조준" }).check();
    await page
      .getByRole("button", { name: "시험지로 돌아가기", exact: true })
      .click();
    assert.equal(
      await page.locator('.mock-exam-question[aria-pressed="true"]').count(),
      1,
    );
    await page.screenshot({
      path: path.join(evidence, `student-selected-${width}.png`),
    });
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
        "teacher and draft local practice, student shared controls, keyboard focus, selection fill/border, no storage/network writes, scroll-fixed-to-paper heading, approval labels, spacing, footer pagination and no overlaps",
    }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
