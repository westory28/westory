/** Component contract QA with in-memory notes, no application services. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const evidence = await fs.mkdtemp(path.join(os.tmpdir(), "westory-review-notes-"));
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Review from './src/pages/student/quiz/QuizRelearning';import './src/pages/student/quiz/QuizLearning.css';
const item={id:'q1',type:'choice',question:'다음 합성 자료의 내용으로 옳지 않은 것은?',options:['정치','경제'],answer:'정치',submittedAnswer:'경제',concepts:['자료 해석'],passage:'{{box:(가)}} {{u:정책}}의 자료',examplePassage:'ㄱ. 합성 보기',passageSet:{id:'set1',instruction:'공통 자료를 읽으시오.',passage:'공통 지문',image:null}};
const variant=new URLSearchParams(location.search).get('type');
if(variant==='order')Object.assign(item,{type:'order',options:['가','나'],answer:'가||나'});
if(variant==='matching')Object.assign(item,{type:'matching',matchingPairs:[{left:'인물1',right:'가'},{left:'인물2',right:'나'}],answer:'인물1=>가||인물2=>나'});
const qa=window.reviewQa={saved:{revision:1,updatedAt:'2026-11-08',items:[{questionId:'q1',practiceAnswer:'',reason:'',note:'기존 노트',correct:null,updatedAt:'2026-11-08'}]},requests:[],loads:0,failNext:false,conflictNext:false,hold:false};
async function save(draft,expectedRevision,saveId){qa.requests.push({draft:structuredClone(draft),expectedRevision,saveId});if(qa.hold)await new Promise(resolve=>qa.release=resolve);if(qa.failNext){qa.failNext=false;throw Error('합성 통신 실패')}if(qa.conflictNext){qa.conflictNext=false;qa.saved={...qa.saved,revision:qa.saved.revision+1,items:[{...qa.saved.items[0],note:'다른 화면의 노트'}]};throw {details:{reason:'QUIZ_REVIEW_REVISION_CONFLICT'}}}qa.saved={revision:qa.saved.revision+1,updatedAt:'2026-11-08',items:[{...draft,correct:draft.practiceAnswer?draft.practiceAnswer==='정치':null,updatedAt:'2026-11-08'}]};return structuredClone(qa.saved)}
function App(){const[open,setOpen]=useState(true);return open?<Review items={[item]} reviewNotes={qa.saved} onSave={save} onReload={async()=>{qa.loads++;return structuredClone(qa.saved)}} onClose={()=>setOpen(false)}/>:<button onClick={()=>setOpen(true)}>다시 열기</button>};createRoot(document.getElementById('root')).render(<App/>);`;
const built = await build({ stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, metafile: true,
  platform: "browser", outdir: "fixture", define: { "process.env.NODE_ENV": '"production"' }, loader: { ".woff2": "dataurl", ".woff": "dataurl" } });
assert(!Object.keys(built.metafile.inputs).some(name => /node_modules[\\/](@firebase|firebase)[\\/]/.test(name)), "Type-only note API imports keep component fixtures free of Firebase");
const js = built.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = built.outputFiles.find(file => file.path.endsWith(".css")).text;
const tailwind = await fs.readFile(process.env.PORTAL_DESIGN_TAILWIND_PATH || path.join(os.tmpdir(), "westory-qa-tailwind.js"), "utf8");
const server = http.createServer((request, response) => {
  const resources = { "/fixture.js": ["text/javascript", js], "/fixture.css": ["text/css", css], "/tailwind.js": ["text/javascript", tailwind] };
  const [type, body] = resources[request.url] || ["text/html", '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>:root{--ws-text:#111827;--ws-text-muted:#64748b;--ws-border:#e2e8f0;--ws-primary:#2563eb;--ws-surface:#fff;--ws-primary-soft:#eff6ff}body{margin:0;padding:16px}#root{max-width:900px;margin:auto}</style><div id="root"></div><script src="/fixture.js"></script></html>'];
  response.setHeader("content-type", `${type};charset=utf-8`); response.end(body);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge", headless: true });
const errors = [], external = [], dialogs = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.route("**/*", route => {
    if (route.request().url().startsWith(origin) || route.request().url().startsWith("data:")) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.goto(origin);
  const note = page.getByRole("textbox", { name: "오답 노트", exact: true });
  const save = () => page.getByRole("button", { name: "노트 저장", exact: true }).click();
  const reopen = async () => { await page.getByRole("button", { name: "결과로", exact: true }).click(); await page.getByRole("button", { name: "다시 열기", exact: true }).click(); };
  await note.waitFor(); assert.equal(await note.inputValue(), "기존 노트");
  await reopen(); assert.deepEqual(dialogs, []);
  await note.fill("임시 변경"); await note.fill("기존 노트"); await reopen(); assert.deepEqual(dialogs, []);
  assert(await page.getByText("공통 지문", { exact: true }).isVisible());
  assert(await page.getByText("ㄱ. 합성 보기", { exact: true }).isVisible());
  await note.fill("근거를 다시 확인했어요.");
  await page.getByRole("radio", { name: "자료의 근거를 놓쳤어요", exact: true }).check();
  assert.equal(await page.evaluate(() => window.reviewQa.requests.length), 0, "Editing never transmits automatically");
  await page.getByRole("button", { name: "결과로", exact: true }).click();
  assert.equal(dialogs.length, 1); assert.equal(await note.inputValue(), "근거를 다시 확인했어요.");
  await page.evaluate(() => { window.reviewQa.failNext = true; });
  await save(); await page.getByRole("alert").waitFor(); assert.equal(await note.inputValue(), "근거를 다시 확인했어요.");
  await page.getByRole("button", { name: "다시 저장", exact: true }).click();
  await page.getByText("저장했어요.", { exact: true }).waitFor();
  let requests = await page.evaluate(() => window.reviewQa.requests);
  assert.equal(requests[0].saveId, requests[1].saveId, "Unchanged retry retains the idempotency key");
  assert.equal(requests[1].draft.practiceAnswer, "", "A reflection can be saved before practice");
  await reopen(); assert.equal(await note.inputValue(), "근거를 다시 확인했어요."); assert.equal(dialogs.length, 1);
  const reason = page.getByRole("radio", { name: "자료의 근거를 놓쳤어요", exact: true });
  await reason.click(); assert.equal(await reason.isChecked(), false);
  await reason.check(); assert(await page.getByRole("button", { name: "노트 저장", exact: true }).isDisabled(), "Reverting a reason is clean");
  await page.getByRole("button", { name: "해설 가리고 다시 풀기", exact: true }).click();
  await page.getByRole("button", { name: "1. 정치", exact: true }).click();
  await save(); await page.getByText("저장했어요.", { exact: true }).waitFor();
  await reopen(); await page.getByText("연습한 답: 정치", { exact: true }).waitFor();
  await note.fill("내가 작성 중인 노트");
  await page.evaluate(() => { window.reviewQa.conflictNext = true; });
  await save(); await page.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(() => window.reviewQa.loads), 0, "Conflict does not trigger a hidden read");
  await page.getByRole("button", { name: "저장된 노트 다시 불러오기", exact: true }).click();
  await page.getByText("다른 화면의 노트", { exact: true }).waitFor();
  assert.equal(await note.inputValue(), "내가 작성 중인 노트");
  const latestRevision = await page.evaluate(() => window.reviewQa.saved.revision);
  await save(); await page.getByText("저장했어요.", { exact: true }).waitFor();
  requests = await page.evaluate(() => window.reviewQa.requests);
  assert.equal(requests.at(-1).expectedRevision, latestRevision);
  assert.notEqual(requests.at(-1).saveId, requests.at(-2).saveId);
  await note.fill("저장 요청 시점의 내용");
  await page.evaluate(() => { window.reviewQa.hold = true; });
  await save(); await page.getByRole("button", { name: "저장 중…", exact: true }).waitFor();
  await note.fill("저장 중에 추가로 쓴 내용");
  await page.evaluate(() => { window.reviewQa.hold = false; window.reviewQa.release(); });
  await page.getByText("이전 내용은 저장했어요. 변경한 내용은 다시 저장해 주세요.", { exact: true }).waitFor();
  assert.equal(await note.inputValue(), "저장 중에 추가로 쓴 내용");
  await save(); await page.getByText("저장했어요.", { exact: true }).waitFor();
  await reopen(); assert.equal(await note.inputValue(), "저장 중에 추가로 쓴 내용");
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
      heights: [...document.querySelectorAll('.student-quiz-primary-action,.student-quiz-secondary-action,.student-quiz-relearning-reflection label')].map(node => node.getBoundingClientRect().height) }));
    assert.equal(layout.overflow, false); assert(layout.heights.every(height => height >= 44));
    await note.screenshot({ path: path.join(evidence, `note-${width}.png`) });
    if (width === 390 || width === 1280) await page.screenshot({ path: path.join(evidence, `review-${width}.png`), fullPage: true });
  }
  assert.equal(await note.getAttribute("maxlength"), "1000");
  for (const type of ["order", "matching"]) {
    await page.goto(origin + "/?type=" + type);
    await page.getByRole("button", { name: "해설 가리고 다시 풀기", exact: true }).click();
    if (type === "order") await page.getByRole("button", { name: "가", exact: true }).click();
    else await page.getByRole("combobox", { name: "인물1에 연결할 답", exact: true }).selectOption("가");
    assert(await page.getByRole("button", { name: "답 확인", exact: true }).isDisabled());
    await note.fill("아직 작성 중인 근거"); await save();
    await page.getByText("저장했어요.", { exact: true }).waitFor();
    const partial = await page.evaluate(() => window.reviewQa.requests.at(-1).draft);
    assert.equal(partial.practiceAnswer, type === "order" ? "가" : "인물1=>가");
    await reopen(); await page.getByRole("button", { name: "해설 가리고 다시 풀기", exact: true }).click();
    if (type === "order") await page.getByText("선택한 순서: 가", { exact: true }).waitFor();
    else assert.equal(await page.getByRole("combobox", { name: "인물1에 연결할 답", exact: true }).inputValue(), "가");
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ pass: true, evidence, checks: "explicit save only, initial/reopened notes, clean and reverted close, dirty guard, empty answer note save, retry ID, conflict reload with draft preservation, in-flight edits, shared/example passage, 320/390/768/1280, no Firebase" }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
