import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

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
const helper = await build({
  entryPoints: [path.join(root, "src/lib/mockExamChoiceLayout.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const {
  getMockExamChoiceColumns: columns,
  measureMockExamChoiceWidth: widthOf,
  formatMockExamChoiceLabel: displayLabel,
} = await import(
  `data:text/javascript;base64,${Buffer.from(helper.outputFiles[0].text).toString("base64")}`
);
const repeated = (text) => Array(5).fill(text);
const boundaries = [
  ["가나", 3],
  ["가나다", 3],
  ["가나다라", 2],
  ["가나다라 마바사", 2],
  ["가나다라 마바사아", 2],
  ["가나다라마바 사아자차카타 파", 2],
  ["가나다라마바 사아자차카타 파하", 1],
  ["가나다라마바", 2],
  ["가나다라마바사", 1],
  ["가나다라마바사아", 1],
  ["가나다라마바사아자차카", 1],
  ["가나다라마바사아자차카타", 1],
  ["(가)", 5],
  ["( 가 )", 5],
  ["(   가   )", 5],
  ["가\n나", 1],
  ["가\r\n나", 1],
  ["", 1],
];
for (const [label, expected] of boundaries)
  assert.equal(columns(repeated(label)), expected, label);
assert.equal(columns(repeated("가"), [null, "image", null]), 1);
assert.equal(columns(["가", "나", "다", "라"]), 1);
assert.equal(columns(["O", "X"]), 1);
assert.equal(columns(["가", "나", "다", "라", "가".repeat(15)]), 1);
assert.equal(
  widthOf("가"),
  widthOf("가"),
  "decomposed Korean has the same width",
);
assert(widthOf("11") < widthOf("가나"));
assert(widthOf("( 가 )") < 3);
assert.equal(displayLabel("  ( 가 )  "), "(가)");
assert.equal(displayLabel("  ( 가 나 )  "), "  ( 가 나 )  ");
assert.equal(displayLabel("자료 ( 가 )"), "자료 ( 가 )");
const originalLabels = [" ( 가 ) ", "( 나 )", "( 다 )", "( 라 )", "( 마 )"];
const unchangedLabels = [...originalLabels];
columns(originalLabels);
originalLabels.map(displayLabel);
assert.deepEqual(
  originalLabels,
  unchangedLabels,
  "stored options and answer values stay unchanged",
);

const svg =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40"/></svg>',
  );
const examples = [
  "계유정난",
  "황산 대첩",
  "위화도 회군",
  "제1차 왕자의 난",
  "제2차 왕자의 난",
];
const cases = [
  { options: ["(가)", "(나)", "(다)", "(라)", "(마)"], columns: 5 },
  { options: ["( 가 )", "( 나 )", "( 다 )", "( 라 )", "( 마 )"], columns: 5 },
  { options: ["가야", "고려", "발해", "신라", "조선"], columns: 3 },
  { options: examples, columns: 2 },
  {
    options: [
      "태종이 사병을 혁파하였다",
      "세종이 집현전을 설치하였다",
      "성종이 경국대전을 완성하였다",
      "정조가 규장각을 설치하였다",
      "영조가 균역법을 시행하였다",
    ],
    columns: 2,
  },
  {
    options: examples.map(
      (text) => `${text}에 해당하는 역사적 사건의 배경을 설명하였다.`,
    ),
    columns: 1,
  },
  {
    options: examples,
    choiceOptionImages: [svg, null, null, null, null],
    columns: 1,
  },
  { options: examples.slice(0, 4), columns: 1 },
  { options: repeated("태종이\n사병을 혁파하였다"), columns: 1 },
  { options: repeated("대한민국임시정부수립과정"), columns: 1 },
  { options: ["이성계", "정몽주", "정도전", "이방원", "이성계"], columns: 3 },
  ...[4, 5, 7, 8, 11].map((length, index) => ({
    options: repeated("가".repeat(length)),
    columns: [2, 2, 1, 1, 1][index],
  })),
];
cases.forEach((test) =>
  assert.equal(
    columns(test.options, test.choiceOptionImages),
    test.columns,
    JSON.stringify(test),
  ),
);
const questions = cases.map((test, index) => ({
  id: index + 1,
  type: "choice",
  question: `합성 선지 배치 ${index + 1}`,
  options: test.options,
  choiceOptionImages: test.choiceOptionImages,
}));
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import Paper,{MockExamQuestionContent} from './src/components/common/MockExamPaper';import Preview from './src/pages/teacher/components/MockExamDraftPreview';import './src/pages/teacher/components/QuizWorkspace.css';import './src/pages/student/quiz/mockExamWorkspace.css';const questions=${JSON.stringify(questions)};createRoot(document.getElementById('root')).render(<><section data-view="paper"><Paper questions={questions}/></section><section data-view="record"><Paper questions={questions} score={100} checks={questions.map(q=>({id:q.id,correct:true}))}/></section>{questions.map((question,i)=><section key={i} data-view="preview" data-case={i}><Preview question={question}/></section>)}{questions.map((question,i)=><section key={i} data-view="zoom" data-case={i} className="mock-exam-zoom-scroll"><MockExamQuestionContent question={question} index={i}/></section>)}</>);`;
const evidence = await fs.mkdtemp(
  path.join(os.tmpdir(), "westory-choice-layout-"),
);
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  platform: "browser",
  outfile: path.join(evidence, "fixture.js"),
  write: false,
  loader: { ".woff": "dataurl", ".woff2": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = built.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = built.outputFiles.find((file) => file.path.endsWith(".css")).text;
const server = http.createServer((req, res) => {
  if (req.url === "/fixture.js") {
    res.setHeader("content-type", "text/javascript");
    res.end(js);
  } else if (req.url === "/fixture.css") {
    res.setHeader("content-type", "text/css");
    res.end(css);
  } else {
    res.setHeader("content-type", "text/html;charset=utf-8");
    res.end(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;padding:12px}section[data-view]{max-width:794px;margin:0 auto 24px}section[data-view="preview"]{max-width:600px}*{box-sizing:border-box}</style><div id="root"></div><script src="/fixture.js"></script>',
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
  headless: true,
});
const errors = [],
  external = [],
  layouts = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ||
    route.request().url().startsWith("data:")
      ? route.continue()
      : (external.push(route.request().url()), route.abort()),
  );
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    if (width === 390)
      await page.addStyleTag({
        content: 'section[data-view="preview"]{width:320px;max-width:100%}',
      });
    await page
      .locator('[data-view="paper"] .mock-exam-sheet')
      .first()
      .waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode()));
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    const lists = await page
      .locator(".mock-exam-options")
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => !node.closest(".mock-exam-measure"))
          .map((node) => {
            const section = node.closest("[data-view]");
            return {
              view: section.dataset.view,
              case:
                section.dataset.case === undefined
                  ? Number(
                      node
                        .closest("article")
                        .querySelector(".mock-exam-stem")
                        .textContent.match(/배치 (\d+)/)[1],
                    ) - 1
                  : Number(section.dataset.case),
              columns:
                getComputedStyle(node).gridTemplateColumns.split(" ").length,
              items: [...node.children].map((li) => {
                const rect = li.getBoundingClientRect();
                const text = li.querySelector(".mock-exam-option-text");
                const range = document.createRange();
                range.selectNodeContents(text);
                const wordLines = Array.from(
                  text.firstChild.textContent.matchAll(/\S+/gu),
                  (match) => {
                    const wordRange = document.createRange();
                    wordRange.setStart(text.firstChild, match.index);
                    wordRange.setEnd(
                      text.firstChild,
                      match.index + match[0].length,
                    );
                    return wordRange.getClientRects().length;
                  },
                );
                return {
                  text: li.textContent,
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  whiteSpace: getComputedStyle(text).whiteSpace,
                  wordBreak: getComputedStyle(text).wordBreak,
                  textLines: range.getClientRects().length,
                  textWidth: text.getBoundingClientRect().width,
                  font: getComputedStyle(text).font,
                  numberWidth: li
                    .querySelector(".mock-exam-option-number")
                    .getBoundingClientRect().width,
                  wordLines,
                };
              }),
            };
          }),
      );
    assert.equal(lists.length, cases.length * 4);
    console.log(
      JSON.stringify({
        width,
        words: lists
          .filter((list) => list.view === "preview" && list.case >= 11)
          .map((list) => ({
            length: cases[list.case].options[0].length,
            columns: list.columns,
            lines: list.items[0].textLines,
          })),
      }),
    );
    for (const list of lists) {
      const expected = cases[list.case];
      assert.equal(list.columns, expected.columns, JSON.stringify(list));
      const first = list.items[0];
      list.items.forEach((item, index) => {
        assert.equal(item.text[0], ["①", "②", "③", "④", "⑤"][index]);
        assert(Math.abs(item.width - first.width) < 1, JSON.stringify(list));
        assert.equal(item.whiteSpace, "pre-line");
        assert.equal(item.wordBreak, "keep-all");
        assert(
          item.wordLines.every((lines) => lines === 1),
          JSON.stringify(list),
        );
        if (expected.columns === 5 || list.case >= 10)
          assert.equal(item.textLines, 1, JSON.stringify(list));
        const rowFirst =
          list.items[Math.floor(index / expected.columns) * expected.columns];
        const columnFirst = list.items[index % expected.columns];
        assert(
          Math.abs(item.top - rowFirst.top) < 1 &&
            Math.abs(item.left - columnFirst.left) < 1,
          JSON.stringify(list),
        );
        if (index >= expected.columns)
          assert(item.top > list.items[index - expected.columns].top);
      });
      if (expected.columns >= 3)
        assert(
          Math.abs(
            list.items[1].left -
              first.left -
              (list.items[2].left - list.items[1].left),
          ) < 1,
          JSON.stringify(list),
        );
      if (list.case === 8)
        assert(
          first.text.includes("\n"),
          "explicit line break survives rendering",
        );
    }
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: path.join(evidence, `choice-paper-${width}.png`),
    });
    await page.locator('[data-view="preview"][data-case="3"]').screenshot({
      path: path.join(evidence, `choice-event-preview-${width}.png`),
    });
    layouts.push({
      width,
      checkedLists: lists.length,
      rows: [1, 2, 3, 5],
      views: [...new Set(lists.map((list) => list.view))],
    });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      { ok: true, boundaries: boundaries.length, layouts, errors, external },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ ok: true, evidence, layouts }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
