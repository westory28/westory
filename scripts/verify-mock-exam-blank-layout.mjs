/** Real passage/editor/paper/preview layouts using synthetic text and no services. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence =
  process.env.MOCK_BLANK_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-mock-blank-")));
const entry = `
import React,{useLayoutEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import QuizPassage from './src/components/common/QuizPassage';
import MockExamPaper from './src/components/common/MockExamPaper';
import MockExamWorkspace from './src/pages/student/quiz/MockExamWorkspace';
import MockExamDraftPreview from './src/pages/teacher/components/MockExamDraftPreview';
import QuizVisualPassageEditor from './src/pages/teacher/components/QuizVisualPassageEditor';
import './src/assets/index.css';
import './src/pages/teacher/components/QuizWorkspace.css';
function Fixture(){
 const [value,setValue]=useState('자료 앞 {{blankbox:3.4|(가)}} 뒤 문장을 읽고 판단한다.');
 const mode=new URLSearchParams(location.search).get('mode');
 const q={id:1,type:'choice',question:'자료의 빈칸과 앞뒤 문장을 확인하시오.',passage:value,options:['가','나','다','라','마'],answer:'가',points:4,paperOrder:1};
 useLayoutEffect(()=>{window.blankFixture={setValue,value};},[value]);
 return <main data-mode={mode}>{mode==='editor'?<QuizVisualPassageEditor label='검증 지문' value={value} onChange={setValue}/>:mode==='paper'?<MockExamPaper questions={[q]}/>:mode==='draft'?<MockExamDraftPreview question={q}/>:mode==='zoom'?<MockExamWorkspace questions={[q]} answers={{}} currentIndex={0} round='round_1' studentLabel='합성 확인' onSelect={()=>{}} onAnswer={()=>{}}/>:<QuizPassage value={value}/>}</main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  outfile: "fixture.js",
  loader: {
    ".woff2": "dataurl",
    ".woff": "dataurl",
    ".png": "dataurl",
    ".webp": "dataurl",
    ".svg": "dataurl",
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = bundle.outputFiles
  .find((f) => f.path.endsWith(".css"))
  .text.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g, "");
let tailwind;
for (const candidate of [
  process.env.PORTAL_DESIGN_TAILWIND_PATH,
  path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  path.join(os.tmpdir(), "westory-assessment-qa-tailwind.js"),
].filter(Boolean)) {
  try {
    tailwind = await fs.readFile(candidate, "utf8");
    break;
  } catch {}
}
assert(
  tailwind,
  "Cache the official Tailwind runtime with an existing portal browser check first.",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}main{max-width:850px;margin:0 auto;padding:16px}main[data-mode="draft"] .mock-exam-draft-preview{max-height:none;overflow:visible}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer((req, res) => {
  const [type, body] = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  }[new URL(req.url, "http://localhost").pathname] || ["text/html", html];
  res.setHeader("Content-Type", type + ";charset=utf-8");
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const results = [],
  errors = [],
  external = [];
try {
  const context = await browser.newContext();
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith("data:"))
      return route.continue();
    external.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const viewport of [390, 768, 1440]) {
    await page.setViewportSize({ width: viewport, height: 900 });
    for (const mode of ["editor", "passage", "paper", "draft", "zoom"]) {
      await page.goto(origin + "/?mode=" + mode);
      await page.waitForFunction(() => window.blankFixture);
      await page.evaluate(() => document.fonts.ready);
      if (mode === "zoom")
        await page
          .locator(".mock-exam-sheet .mock-exam-question")
          .first()
          .click();
      const scope =
        mode === "editor"
          ? ".quiz-visual-content"
          : mode === "paper"
            ? ".mock-exam-sheet"
            : mode === "draft"
              ? ".mock-exam-draft-preview"
              : mode === "zoom"
                ? ".mock-exam-zoom-scroll"
                : "main";
      const token = page
        .locator(
          scope +
            " " +
            (mode === "editor"
              ? '[data-quiz-mark="blankBox"]'
              : ".quiz-passage-blank-box"),
        )
        .first();
      await token.waitFor();
      const topPositions = new Set();
      for (const prefix of [
        "",
        "앞 ",
        "앞 문장 ".repeat(5),
        "앞 문장 ".repeat(10),
        "긴 앞 문장을 읽고 내용을 살펴보자. ".repeat(12),
      ]) {
        const value = prefix + "{{blankbox:3.4|(가)}} 뒤 문장을 이어서 읽는다.";
        await page.evaluate(
          (value) => window.blankFixture.setValue(value),
          value,
        );
        await page.waitForFunction(
          (value) => window.blankFixture.value === value,
          value,
        );
        const box = await token.evaluate((el) => {
          const style = getComputedStyle(el),
            r = el.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          const textRects = [...range.getClientRects()];
          const text = range.getBoundingClientRect();
          const scale = r.width / el.offsetWidth;
          return {
            width: parseFloat(style.width),
            font: parseFloat(style.fontSize),
            lineHeight: parseFloat(style.lineHeight),
            paddingTop: parseFloat(style.paddingTop),
            paddingBottom: parseFloat(style.paddingBottom),
            paddingLeft: parseFloat(style.paddingLeft),
            paddingRight: parseFloat(style.paddingRight),
            border: parseFloat(style.borderTopWidth),
            radius: style.borderRadius,
            whiteSpace: style.whiteSpace,
            boxSizing: style.boxSizing,
            rects: el.getClientRects().length,
            textRects: textRects.length,
            top: r.top,
            centerOffset:
              Math.abs(r.left + r.right - (text.left + text.right)) / 2,
            actualWidth: el.offsetWidth,
            actualHeight: el.offsetHeight,
            scale,
          };
        });
        assert(
          Math.abs(box.width - 3.4 * box.font) < 0.05,
          JSON.stringify({ mode, viewport, box }),
        );
        assert(
          Math.abs(box.actualWidth - (4 * box.font + 2)) < 1,
          JSON.stringify({ mode, viewport, box }),
        );
        assert(
          Math.abs(box.actualHeight - (1.2 * box.font + 2)) < 1,
          JSON.stringify({ mode, viewport, box }),
        );
        assert.equal(box.border, 1);
        assert.equal(box.paddingTop + box.paddingBottom, 0);
        assert.equal(box.whiteSpace, "nowrap");
        assert.equal(box.rects, 1);
        assert.equal(box.textRects, 1);
        assert(box.centerOffset < 1.2, JSON.stringify({ mode, viewport, box }));
        topPositions.add(Math.round(box.top));
        results.push({ mode, viewport, prefixLength: prefix.length, ...box });
      }
      assert(
        topPositions.size > 1,
        `${mode} ${viewport}: prefixes exercise actual line wrapping`,
      );
      await page.evaluate(() =>
        window.blankFixture.setValue(
          "앞 문장을 읽는다. {{box:(가)}} 뒤에 이어지는 설명이다.\n{{blankbox:3.4|(나)}} 다음 줄에서도 빈칸 기호와 글자가 겹치지 않아야 한다.\n{{box:여러 단어로 된 강조문은 기존 서식을 유지한다.}}",
        ),
      );
      const legacy = page
        .locator(
          scope +
            " " +
            (mode === "editor"
              ? '[data-quiz-label-box="true"]'
              : ".quiz-passage-label-box"),
        )
        .first();
      const legacyStyle = await legacy.evaluate((el) => ({
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
        font: parseFloat(getComputedStyle(el).fontSize),
        border: parseFloat(getComputedStyle(el).borderTopWidth),
        whiteSpace: getComputedStyle(el).whiteSpace,
      }));
      assert.equal(legacyStyle.border, 1);
      assert.equal(legacyStyle.whiteSpace, "nowrap");
      assert(Math.abs(legacyStyle.lineHeight - legacyStyle.font * 1.2) < 0.05);
      await page.screenshot({
        path: path.join(evidence, `${mode}-${viewport}.png`),
        fullPage: mode !== "zoom",
      });
      if (mode === "editor") {
        const saved = await page.evaluate(() => window.blankFixture.value);
        await legacy.evaluate((el) => {
          const root = el.closest('[contenteditable="true"]');
          root.focus();
          const range = document.createRange();
          range.selectNodeContents(el);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        });
        await page.screenshot({
          path: path.join(evidence, `editor-selected-${viewport}.png`),
        });
        await legacy.evaluate((el) => {
          el.textContent = "길어진 일반 강조문";
          el.closest('[contenteditable="true"]').dispatchEvent(
            new InputEvent("input", { bubbles: true, inputType: "insertText" }),
          );
        });
        assert.equal(
          await legacy.count(),
          0,
          "typing a sentence restores ordinary box style",
        );
        await page
          .getByRole("button", { name: "검증 지문 실행 취소", exact: true })
          .click();
        assert.equal(
          await legacy.count(),
          1,
          "undo restores compact marker style",
        );
        assert.equal(
          await page.evaluate(() => window.blankFixture.value),
          saved,
        );
        await page
          .getByRole("button", { name: "검증 지문 다시 실행", exact: true })
          .click();
        assert.equal(
          await legacy.count(),
          0,
          "redo restores ordinary box style",
        );
        await page.evaluate(() => window.blankFixture.setValue(""));
        await page.waitForFunction(() => window.blankFixture.value === "");
        await page.evaluate(
          (saved) => window.blankFixture.setValue(saved),
          saved,
        );
        await legacy.waitFor();
        assert.equal(
          await legacy.count(),
          1,
          "reopening saved markup restores compact marker style",
        );
        assert.equal(await token.getAttribute("data-quiz-width"), "3.4");
        const copied = await token.evaluate((el) => {
          const root = el.closest('[contenteditable="true"]');
          root.focus();
          const range = document.createRange();
          range.selectNode(el);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          const data = new DataTransfer();
          root.dispatchEvent(
            new ClipboardEvent("copy", {
              clipboardData: data,
              bubbles: true,
              cancelable: true,
            }),
          );
          return {
            text: data.getData("text/plain"),
            html: data.getData("text/html"),
          };
        });
        assert.equal(copied.text, "(나)");
        assert.match(copied.html, /data-quiz-width="3.4"/);
        await page.evaluate(() => window.blankFixture.setValue(""));
        await page.waitForFunction(() => window.blankFixture.value === "");
        await page.locator(scope).evaluate((root, copied) => {
          root.focus();
          const range = document.createRange();
          range.selectNodeContents(root);
          range.collapse(true);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          const data = new DataTransfer();
          data.setData("text/plain", copied.text);
          data.setData("text/html", copied.html);
          root.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: data,
              bubbles: true,
              cancelable: true,
            }),
          );
        }, copied);
        await page.waitForFunction(
          () => window.blankFixture.value === "{{blankbox:3.4|(나)}}",
        );
        assert.equal(
          await token.getAttribute("data-quiz-width"),
          "3.4",
          "native copy/paste preserves stored answer width",
        );
      }
      await page.evaluate(() =>
        window.blankFixture.setValue("{{blankbox:30|(가)}}"),
      );
      const large = await token.evaluate((el) => {
        const s = getComputedStyle(el),
          parent = el.closest(".quiz-passage,.quiz-visual-content"),
          root = document.documentElement;
        return {
          width: el.offsetWidth,
          font: parseFloat(s.fontSize),
          localOverflow: getComputedStyle(parent).overflowX,
          scrollWidth: parent.scrollWidth,
          clientWidth: parent.clientWidth,
          documentWidth: root.scrollWidth,
          viewport: innerWidth,
        };
      });
      assert(
        Math.abs(large.width - (30.6 * large.font + 2)) < 1,
        JSON.stringify({ mode, viewport, large }),
      );
      assert.equal(
        large.localOverflow,
        "auto",
        JSON.stringify({ mode, viewport, large }),
      );
      assert(
        large.documentWidth <= large.viewport + 1,
        JSON.stringify({ mode, viewport, large }),
      );
      results.push({ mode, viewport, oversized: true, ...large });
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ ok: true, results, errors, external }, null, 2),
  );
  console.log(
    JSON.stringify({ ok: true, scenarios: results.length, evidence }, null, 2),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
