// Native clipboard/selection regression with synthetic questions; no live services.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence = await fs.mkdtemp(
  path.join(os.tmpdir(), "westory-quiz-protection-"),
);
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Workspace from './src/pages/student/quiz/MockExamWorkspace';
import Review from './src/pages/student/quiz/QuizRelearning';
import Paper from './src/components/common/MockExamPaper';
import './src/pages/student/quiz/QuizLearning.css';
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="30"><text x="2" y="20">QA</text></svg>');
const questions=[{id:1,type:'choice',question:'합성 발문을 읽고 고르시오.',passage:'합성 지문을 읽습니다.',examplePassage:'ㄱ. 합성 보기입니다.',image,options:['첫째 선택지','둘째 선택지'],answer:'첫째 선택지',points:5,paperOrder:1},{id:2,type:'short',question:'합성 단답형 발문',answer:'정치',points:5,paperOrder:2}];
function App(){const [mode,setMode]=useState('student');const [index,setIndex]=useState(0);const [answers,setAnswers]=useState({});return <><nav><button onClick={()=>setMode('student')}>학생</button><button onClick={()=>setMode('teacher')}>교사</button><button onClick={()=>setMode('review')}>복습</button><span id="outside">다른 페이지 텍스트</span></nav>{mode==='student'?<Workspace questions={questions} round="round_1" studentLabel="가상 학생" currentIndex={index} onSelect={setIndex} answers={answers} onAnswer={value=>setAnswers({...answers,[questions[index].id]:value})} timeLeft={600}/>:mode==='teacher'?<Paper questions={questions}/>:<Review items={[{...questions[0],id:'1',concepts:[],submittedAnswer:'둘째 선택지'}]} onSave={async draft=>({revision:1,items:[draft],updatedAt:''})} onClose={()=>setMode('teacher')}/>}</>};createRoot(document.getElementById('root')).render(<App/>);`;
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd() },
  bundle: true,
  write: false,
  metafile: true,
  platform: "browser",
  outdir: "fixture",
  loader: { ".woff2": "dataurl", ".woff": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
});
assert(
  !Object.keys(built.metafile.inputs).some((name) =>
    /node_modules[\\/](@firebase|firebase)[\\/]/.test(name),
  ),
);
const js = built.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = built.outputFiles.find((file) => file.path.endsWith(".css")).text;
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const server = http.createServer((request, response) => {
  const [type, body] = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  }[request.url] || [
    "text/html",
    '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>:root{--ws-text:#111827;--ws-text-muted:#64748b;--ws-border:#e2e8f0;--ws-primary:#2563eb;--ws-surface:#fff}body{margin:0}nav{height:32px;display:flex;gap:16px}</style><div id="root"></div><script src="/fixture.js"></script></html>',
  ];
  response.setHeader("content-type", `${type};charset=utf-8`);
  response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const errors = [],
  report = [];
try {
  for (const width of [390, 768, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin) ||
      route.request().url().startsWith("data:")
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin);
    const paper = page.getByRole("region", { name: "1쪽", exact: true });
    await paper.waitFor();
    const checkGuard = async (locator, protectedContent = true) => {
      const state = await locator.evaluate((element) => ({
        selection: getComputedStyle(element).userSelect,
        callout: getComputedStyle(element).getPropertyValue(
          "-webkit-touch-callout",
        ),
        blocked: ["selectstart", "copy", "cut", "dragstart", "contextmenu"].map(
          (type) =>
            !element.dispatchEvent(
              new Event(type, { bubbles: true, cancelable: true }),
            ),
        ),
      }));
      assert.equal(state.selection === "none", protectedContent);
      assert(
        state.blocked.every((value) => value === protectedContent),
        JSON.stringify(state),
      );
    };
    await checkGuard(paper.locator(".mock-exam-stem").first());
    await checkGuard(paper.getByText("합성 지문을 읽습니다.", { exact: true }));
    await checkGuard(paper.getByText("ㄱ. 합성 보기입니다.", { exact: true }));
    await checkGuard(paper.getByText("첫째 선택지", { exact: true }));
    await checkGuard(paper.getByRole("img", { name: "1번 자료", exact: true }));
    await paper
      .getByRole("button", { name: "1번 문제 확대", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await checkGuard(
      dialog.getByText("합성 지문을 읽습니다.", { exact: true }),
    );
    const option = dialog.getByRole("radio", { name: /첫째 선택지/ });
    await option.focus();
    await page.keyboard.press("Space");
    assert.equal(await option.isChecked(), true);
    await page.keyboard.press("Space");
    assert.equal(await option.isChecked(), false);
    const passage = dialog.getByText("합성 지문을 읽습니다.", { exact: true });
    const box = await passage.boundingBox();
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 8, box.y + 12, { steps: 8 });
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => getSelection().toString()),
      "",
      "Mouse drag does not select question text",
    );
    await page.evaluate(() =>
      navigator.clipboard.writeText("clipboard-sentinel"),
    );
    await option.focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    assert.doesNotMatch(
      await page.evaluate(() => navigator.clipboard.readText()),
      /합성|선택지|고르시오/,
      "Select-all/copy can copy outside text, but cannot export questions",
    );
    assert(await passage.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      return !document.dispatchEvent(new Event('copy', { bubbles: true, cancelable: true }));
    }), "Document-targeted copy also guards a range inside a question");
    await page.evaluate(() => getSelection().removeAllRanges());
    await dialog
      .getByRole("button", { name: "다음 문제", exact: true })
      .click();
    const input = dialog.getByRole("textbox");
    await input.fill("내가 쓴 답안");
    await checkGuard(input, false);
    await input.press("Control+a");
    await input.press("Control+c");
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "내가 쓴 답안",
    );
    await input.press("Control+x");
    assert.equal(await input.inputValue(), "");
    await input.press("Control+v");
    assert.equal(await input.inputValue(), "내가 쓴 답안");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "복습", exact: true }).click();
    const notebook=page.getByRole('region',{name:'오답 복습',exact:true});
    const reviewQuestion=notebook.getByRole('article',{name:'복습할 문제',exact:true});
    await reviewQuestion.waitFor();
    assert.equal(await reviewQuestion.locator('.mock-exam-question-ink').count(),1,'notebook uses the original question renderer');
    await checkGuard(reviewQuestion.locator('.mock-exam-stem'));
    await checkGuard(reviewQuestion.getByText("합성 지문을 읽습니다.", { exact: true }));
    await checkGuard(reviewQuestion.getByText("ㄱ. 합성 보기입니다.", { exact: true }));
    await checkGuard(reviewQuestion.getByText("첫째 선택지", { exact: true }));
    await checkGuard(reviewQuestion.getByRole('img',{name:'1번 자료',exact:true}));
    await notebook.getByRole('button',{name:'해설 가리고 다시 풀기',exact:true}).click();
    const practiceOption=reviewQuestion.getByRole('radio',{name:/첫째 선택지/});
    await practiceOption.focus();await page.keyboard.press('Space');assert(await practiceOption.isChecked());
    await page.keyboard.press('Space');assert.equal(await practiceOption.isChecked(),false,'copy protection does not block practice selection or deselection');
    await checkGuard(reviewQuestion.getByText('첫째 선택지',{exact:true}));
    await page.evaluate(()=>navigator.clipboard.writeText('review-clipboard-sentinel'));
    await practiceOption.focus();await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');
    assert.doesNotMatch(await page.evaluate(()=>navigator.clipboard.readText()),/합성|선택지|고르시오/,'practice keyboard copy cannot export questions');
    const note = page.getByRole("textbox", { name: "오답 노트", exact: true });
    await note.fill("내 오답노트");
    await checkGuard(note, false);
    await note.press("Control+a");
    await note.press("Control+c");
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "내 오답노트",
    );
    await note.press('Control+x');assert.equal(await note.inputValue(),'');
    await note.press('Control+v');assert.equal(await note.inputValue(),'내 오답노트','notebook authoring retains native cut and paste');
    await page.screenshot({ path: path.join(evidence, `review-${width}.png`) });
    await page.getByRole("button", { name: "교사", exact: true }).click();
    await checkGuard(
      page
        .getByRole("region", { name: "1쪽", exact: true })
        .getByText("합성 지문을 읽습니다.", { exact: true }),
      false,
    );
    await checkGuard(page.locator("#outside"), false);
    report.push({
      width,
      paper: true,
      zoom: true,
      nativeClipboard: true,
      inputs: true,
      review: true,
      reviewOriginalRenderer: true,
      reviewPracticeRadio: true,
      reviewNativeClipboard: true,
      teacherUnaffected: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ passed: true, report, evidence }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
