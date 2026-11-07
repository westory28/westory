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
try { playwright = require("playwright"); } catch {
  playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
}
const evidence = process.env.MOCK_EXAM_HISTORY_EVIDENCE_DIR || await fs.mkdtemp(path.join(os.tmpdir(), "westory-mock-history-"));
await fs.mkdir(evidence, { recursive: true });
const record = {
  id: "saved-paper", title: "중학교 3학년 복시 (2회 모의고사)", category: "exam_prep", examRound: "round_2", score: 75,
  recordedAtMs: 1793900000000,
  details: Array.from({ length: 6 }, (_, i) => ({
    id: `saved-${i}`, correct: i !== 1, u: i === 1 ? "고려" : "조선",
    questionSnapshot: {
      type: "choice", question: `${i + 1}번 저장 당시 원문: 자료에 해당하는 나라로 옳은 것은?`,
      passage: "새 왕조는 한양으로 도읍을 옮겼다.\n여러 제도를 정비하여 통치 체제를 세웠다.",
      options: ["가야", "고려", "발해", "신라", "조선"], answer: "조선",
      explanation: `${i + 1}번 저장 당시 해설`, examRound: "round_2", paperOrder: i + 1, points: i === 1 ? 5 : 3,
      paperBreakBefore: i === 4,
    },
  })),
};
const stub = `
const record=${JSON.stringify(record)};
window.historyFixtureCalls=[];
export const loadMyQuizHistory=async input=>{window.historyFixtureCalls.push({mode:'list',...input});return {semesterId:input.semesterId,rows:[],totalCount:0,nextCursor:null,version:'fixture',generatedAt:Date.now()};};
export const loadMyQuizHistoryDetail=async(semesterId,key)=>{window.historyFixtureCalls.push({mode:'detail',semesterId,key});return {semesterId,key,record:location.search.includes('legacy')?{...record,details:record.details.map((item,i)=>i===1?{id:item.id,correct:false,u:'고려'}:item)}:record};};`;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import MyQuizHistory from './src/pages/student/mypage/MyQuizHistory';import './src/components/common/portalPage.css';createRoot(document.getElementById('root')).render(<MyQuizHistory semesterId="2026-2" active requestedAttemptId="saved-paper" onSelect={()=>{}} onClose={()=>{}} onStart={()=>{}}/>);`;
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root }, bundle: true, write: false, metafile: true,
  outdir: "fixture", format: "esm", platform: "browser", jsx: "automatic", loader: { ".woff2": "dataurl", ".woff": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "saved-records-only", setup(builder) {
    builder.onResolve({ filter: /lib\/myQuizHistory$/ }, () => ({ path: "history-stub", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: stub, loader: "js" }));
  } }],
});
assert.equal(Object.keys(built.metafile.inputs).some(name => /node_modules[\\/](@firebase|firebase)[\\/]/.test(name)), false, "No live data runtime may enter this fixture");
const js = built.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = built.outputFiles.find(file => file.path.endsWith(".css")).text;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--ws-text:#172033;--ws-text-muted:#64748b;--ws-border:#dbe2ea;--ws-primary:#2563eb;--ws-surface:#fff;--ws-ring:#2563eb}*{box-sizing:border-box}body{margin:0;padding:16px;background:#f4f6fa;font-family:sans-serif}#root{max-width:1152px;margin:auto}${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/fixture.js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
  response.end(request.url === "/fixture.js" ? js : html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge", headless: true });
const errors = [];
try {
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1024 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.request().url().startsWith(origin) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
    await page.goto(origin);
    await page.getByRole("button", { name: "2번 문제 확대, 답안 입력됨", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.getByLabel("점수 75점, 100점 만점", { exact: true }).waitFor();
    assert.equal(await page.locator(".mock-exam-sheet").count(), 1, "Saved manual breaks no longer force extra pages; content is automatically placed");
    const savedQuestions = await page.locator(".mock-exam-sheet article").evaluateAll(articles => articles.map(article => {
      const box = article.getBoundingClientRect(), sheet = article.closest(".mock-exam-sheet").getBoundingClientRect();
      return { text: article.textContent, fits: box.left >= sheet.left - 1 && box.right <= sheet.right + 1 && box.bottom <= sheet.bottom + 1 };
    }));
    assert.equal(savedQuestions.length, record.details.length, "Every saved question survives automatic placement");
    assert(savedQuestions.every((question, index) => question.fits && question.text.includes(`${index + 1}번 저장 당시 원문`)), "Saved questions retain their order and fit within the paper");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `No document horizontal overflow at ${width}px`);
    await page.screenshot({ path: path.join(evidence, `paper-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "2번 문제 확대, 답안 입력됨", exact: true }).click();
    const detail = page.getByRole("article", { name: "2번 문항 상세", exact: true });
    await detail.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "2번 문항 상세");
    assert.equal(await detail.evaluate(element => document.activeElement === element), true, "Opening a saved question transfers keyboard focus");
    assert.ok((await detail.textContent()).includes("2번 저장 당시 해설"));
    assert.ok((await detail.textContent()).includes("고려"));
    assert.deepEqual(await page.evaluate(() => window.historyFixtureCalls.filter(call => call.mode === "detail").map(call => call.key)), ["canonical:saved-paper"]);
    await page.goto(`${origin}/?legacy`);
    await page.getByRole("combobox", { name: "확인할 문항", exact: true }).waitFor();
    assert.equal(await page.locator(".mock-exam-paper").count(), 0, "Missing old source text must not fabricate a complete paper");
    await page.getByRole("combobox", { name: "확인할 문항", exact: true }).selectOption("1");
    await page.waitForFunction(() => document.querySelector('.my-quiz-history__question')?.textContent.includes('문제 원문이 보관되어 있지 않습니다.'));
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Mock exam history browser passed: 390/768/1280, automatic pagination with saved score/answers, click focus, missing-snapshot fallback. Evidence: ${evidence}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
