/** Synthetic rendering only: no Firebase, saved questions, or live users. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(),
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const cases = [
  ["다음 중 옳지 않은 것은?", ["않은"]],
  ["적절하지 않은 설명은?", ["적절하지 않은"]],
  ["해당 인물이 아닌 것은?", ["아닌"]],
  ["시행하지 않은 정책은?", ["않은"]],
  ["해당하지 않는 설명은?", ["않는"]],
  ["관련이 없는 사건은?", ["없는"]],
  ["잘못된 설명과 틀린 설명을 고르시오.", ["잘못된", "틀린"]],
  ["확인할 수 없는 내용은?", ["확인할 수 없는"]],
  ["판단할 수 없는 것과 단정할 수 없는 것은?", ["판단할 수 없는", "단정할 수 없는"]],
  ["수정해야 할 내용은?", ["수정해야 할"]],
  ["옳지\n않은 것은?", ["않은"]],
  ["‘아닌’과 [않은]을 구분하시오.", ["아닌", "않은"]],
  ["시행하지 않았다. 당시의 상황은?", []],
  ["시행하지 않았던 정책을 설명하였다.", []],
  ["이 주장은 타당한 것이 아닌가?", []],
  ["정당과 안전, 안중근의 활동을 설명하시오.", []],
  ["옳은 설명과 적절한 설명은?", []],
  ["아닌가와 아닌지는 다른 표현이다.", []],
  ["‘아닌’ 단어 다음에 않은이 붙으면?", ["아닌"]],
  ["<img src=x onerror=alert(1)> 아닌 것은?", ["아닌"]],
  ["이 국왕이 시행한 정책을 <보기>와 〈보기〉에서 고르시오.", []],
  ["그 인물의 활동으로 적절하지 않은 것은?", ["적절하지 않은"]],
];
const question = {
  id: 1, type: "choice", question: "다음 정책에 해당하는 것이 아닌 것은?",
  passage: "{{box:(가)}}의 {{u:정책}}을 확인하시오.\n{{bullet}}시행하지 않았다. {{blankbox:3.4|(나)}}",
  options: ["아닌", "않은", "없는", "않았다", "정당"], answer: "아닌",
  explanation: "아닌 것은 해당하지 않은 정책이다.", points: 4, paperOrder: 1,
};
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Text from './src/components/common/QuizQuestionText';
import Passage from './src/components/common/QuizPassage';
import Paper,{MockExamQuestionContent} from './src/components/common/MockExamPaper';
import Draft from './src/pages/teacher/components/MockExamDraftPreview';
import Editor from './src/pages/teacher/components/QuizVisualPassageEditor';
import Workspace from './src/pages/student/quiz/MockExamWorkspace';
import './src/pages/teacher/components/QuizWorkspace.css';
const q=${JSON.stringify(question)}, cases=${JSON.stringify(cases)};
window.emphasisQa={question:structuredClone(q),changes:[]};
function App(){const [answer,setAnswer]=useState('');const mode=new URLSearchParams(location.search).get('mode');
return mode==='student'?<Workspace questions={[q]} answers={{1:answer}} round='round_1' studentLabel='가상 학생' currentIndex={0} onSelect={()=>{}} onAnswer={setAnswer} timeLeft={600}/>:<>
<section data-view='lexical'>{cases.map(([value],i)=><p key={i} data-case={i}><Text value={value}/></p>)}</section>
<section data-view='plain'><Passage value='아닌 것은 시행하지 않은 정책이다.'/></section>
<section data-view='editor'><Editor value={q.passage} onChange={value=>window.emphasisQa.changes.push(value)}/></section>
<section data-view='draft'><Draft question={q}/></section>
<section data-view='paper'><Paper questions={[q]}/></section>
<section data-view='zoom' className='mock-exam-zoom-scroll'><MockExamQuestionContent question={q} index={0}/></section>
<section data-view='wrap' style={{width:'calc(100% - 32px)',maxWidth:280,fontSize:18,lineHeight:1.6,overflowWrap:'anywhere',wordBreak:'break-all'}}>
<p data-wrap='stem'><Text value='자료에서 확인한 이 국왕이 추진한 정책을 <보기>와 〈보기〉에서 고르시오. 적절하지 않은 내용은?'/></p>
<div data-wrap='passage'><Passage value='자료에서 확인한 {{u:이 국왕}}은 조선의 국왕이다.\n{{bullet}}자료에서 확인한 {{u:중앙 집권 정책}}에 관한 설명이다.'/></div>
<p data-wrap='long-word'><Text value={'가'.repeat(100)}/></p>
<div data-wrap='long-underline'><Passage value={'{{u:'+Array(12).fill('자료의 근거를 확인하는 긴 밑줄').join(' ')+'}}'}/></div>
<div data-wrap='long-underline-word'><Passage value={'{{u:'+'나'.repeat(100)+'}}'}/></div>
</section>
</>};createRoot(document.getElementById('root')).render(<App/>);`;
const evidence = process.env.QUIZ_EMPHASIS_EVIDENCE_DIR || await fs.mkdtemp(path.join(os.tmpdir(), "westory-question-emphasis-"));
await fs.mkdir(evidence, { recursive: true });
const bundle = await build({ stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, metafile: true, platform: "browser", outdir: "fixture",
  loader: { ".woff2": "dataurl", ".woff": "dataurl" }, define: { "process.env.NODE_ENV": '"production"' } });
assert(!Object.keys(bundle.metafile.inputs).some(name => /node_modules[\\/](@firebase|firebase)[\\/]/.test(name)));
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
const tailwind = await fs.readFile(process.env.PORTAL_DESIGN_TAILWIND_PATH || path.join(os.tmpdir(), "westory-qa-tailwind.js"), "utf8");
const server = http.createServer((request, response) => {
  const resources = { "/fixture.js": ["text/javascript", js], "/fixture.css": ["text/css", css], "/tailwind.js": ["text/javascript", tailwind] };
  const [type, body] = resources[request.url] || ["text/html", '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}section{max-width:760px;margin:16px auto}#root{min-width:0}</style><div id="root"></div><script src="/fixture.js"></script></html>'];
  response.setHeader("content-type", `${type};charset=utf-8`); response.end(body);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge", headless: true });
const errors = [], external = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    if (route.request().url().startsWith(origin) || route.request().url().startsWith("data:")) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.goto(origin);
  await page.locator('[data-view="lexical"] [data-case="19"]').waitFor();
  for (let index = 0; index < cases.length; index++) {
    const rendered = page.locator(`[data-case="${index}"]`);
    assert.equal(await rendered.textContent(), cases[index][0], "plain text remains byte-for-byte unchanged");
    assert.deepEqual(await rendered.locator("u").allTextContents(), cases[index][1]);
    assert.equal(await rendered.locator("img").count(), 0, "text never becomes HTML");
  }
  assert.equal(await page.locator('[data-view="plain"] u').count(), 0, "passages are not automatically emphasized");
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ["draft", "paper", "zoom"]) {
      const surface = page.locator(`[data-view="${view}"]${view === "paper" ? " .mock-exam-sheet" : ""}`);
      await surface.locator(".quiz-question-negative").first().waitFor();
      assert((await surface.locator(".quiz-question-negative").allTextContents()).every(value => value === "아닌"));
      assert.equal(await surface.locator(".mock-exam-options .quiz-question-negative").count(), 0, "choices stay unchanged");
      const styles = await surface.locator(".quiz-passage-underline").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).textDecorationThickness));
      assert(styles.length && styles.every(value => value === "1px"));
      assert(await surface.locator(".quiz-passage-label-box").count());
      assert(await surface.locator(".quiz-passage-blank-box").count());
    }
    assert.equal(await page.locator('[data-view="editor"] [data-quiz-mark="underline"]').evaluate(node => getComputedStyle(node).textDecorationThickness), "1px");
    const wrapping = await page.locator('[data-view="wrap"]').evaluate(surface => {
      const lineTops = node => {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const tops = new Set();
        let text;
        while ((text = walker.nextNode())) for (let i = 0; i < text.textContent.length; i++) {
          if (/\s/.test(text.textContent[i])) continue;
          const range = document.createRange(); range.setStart(text, i); range.setEnd(text, i + 1);
          tops.add(Math.round(range.getBoundingClientRect().top));
        }
        return tops.size;
      };
      const phrases = [...surface.querySelectorAll('[data-wrap="stem"] .quiz-question-keep, [data-wrap="passage"] .quiz-passage-underline')];
      const long = [...surface.querySelectorAll('[data-wrap^="long-"]')];
      const wordLines = [];
      const walker = document.createTreeWalker(surface.querySelector('[data-wrap="stem"]'), NodeFilter.SHOW_TEXT);
      let text;
      while ((text = walker.nextNode())) for (const match of text.textContent.matchAll(/[가-힣]+/g)) {
        const range = document.createRange(); range.setStart(text, match.index); range.setEnd(text, match.index + match[0].length);
        wordLines.push({ word: match[0], lines: new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size });
      }
      return { phrases: phrases.map(node => ({ text: node.textContent, lines: lineTops(node) })), wordLines,
        long: long.map(node => ({ kind: node.dataset.wrap, lines: lineTops(node), overflow: node.scrollWidth - node.clientWidth })),
        overflow: surface.scrollWidth - surface.clientWidth };
    });
    assert.equal(wrapping.phrases.length, 6, 'References, demonstrative phrase and underline are grouped');
    assert(wrapping.phrases.every(item => item.lines === 1), JSON.stringify(wrapping.phrases));
    assert(wrapping.wordLines.every(item => item.lines === 1), JSON.stringify(wrapping.wordLines));
    assert(wrapping.long.every(item => item.lines > 1 && item.overflow <= 1), JSON.stringify(wrapping.long));
    assert(wrapping.overflow <= 1, `No horizontal overflow at ${width}px`);
    await page.locator('[data-view="wrap"]').screenshot({ path: path.join(evidence, `word-wrap-${width}.png`) });
    await page.locator('[data-view="draft"]').screenshot({ path: path.join(evidence, `draft-${width}.png`) });
  }
  assert.deepEqual(await page.evaluate(() => window.emphasisQa.question), question);
  assert.deepEqual(await page.evaluate(() => window.emphasisQa.changes), []);
  await page.goto(origin + "/?mode=student");
  await page.locator(".mock-exam-sheet .mock-exam-question").first().click();
  assert.deepEqual(await page.locator(".mock-exam-zoom .quiz-question-negative").allTextContents(), ["아닌"]);
  assert.equal(await page.locator(".mock-exam-zoom .quiz-passage-underline").evaluate(node => getComputedStyle(node).textDecorationThickness), "1px");
  assert.equal(await page.locator(".mock-exam-answer-controls .quiz-question-negative").count(), 0);
  await page.screenshot({ path: path.join(evidence, "student-zoom.png") });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ pass: true, lexicalCases: cases.length, widths: [320, 390, 768, 1280, 1440], evidence,
    checks: "negative modifier boundaries; unchanged source/choices/passages; word-boundary wrapping; intact short references and underlined phrases; overwide text fallback; one-pixel manual underline in editor, preview, paper and student zoom; labels and blank boxes preserved; no live reads/writes" }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
