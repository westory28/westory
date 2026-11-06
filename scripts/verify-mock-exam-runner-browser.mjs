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
const learning = require("../functions/productionGateway/assessmentLearning.js");
let playwright;
try { playwright = require("playwright"); } catch {
  playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
}
const evidence = process.env.MOCK_EXAM_RUNNER_EVIDENCE_DIR || await fs.mkdtemp(path.join(os.tmpdir(), "westory-mock-runner-"));
await fs.mkdir(evidence, { recursive: true });
const tailwindPath = process.env.ASSESSMENT_QA_TAILWIND || process.env.PORTAL_DESIGN_TAILWIND_PATH || path.join(os.tmpdir(), "westory-qa-tailwind.js");
const tailwind = await fs.readFile(tailwindPath, "utf8");
const common = { unitId: "exam_prep", category: "exam_prep", examRound: "round_2", concepts: ["조선의 성립"], explanation: "저장 당시 해설: 조선은 한양을 도읍으로 삼았다." };
const questions = [
  { ...common, id: 1, type: "choice", question: "저장 당시 1번 원문: 자료에 해당하는 나라로 옳은 것은?", passage: "한양으로 도읍을 옮기고 새로운 통치 체제를 마련하였다.", options: ["가야", "고려", "발해", "신라", "조선"], answer: "조선", paperOrder: 1, points: 30 },
  { ...common, id: 2, type: "short", question: "저장 당시 2번 원문: 조선의 건국자를 쓰시오.", answer: "이성계", paperOrder: 2, points: 40 },
  { ...common, id: 3, type: "choice", question: "저장 당시 3번 원문: 조선의 수도를 고르시오.", options: ["경주", "개경", "한양", "평양", "부여"], answer: "한양", paperOrder: 3, points: 30 },
];
const frozen = learning.captureQuestionSnapshots(questions.map(question => ({ path: `questions/${question.id}`, data: question })), questions.map(question => String(question.id)));
const presentation = learning.questionPresentation(frozen.questionSnapshots);
assert.ok(presentation.every(question => question.answer === undefined && question.explanation === undefined));
const denseQuestions = Array.from({ length: 16 }, (_, index) => ({
  ...questions[0], id: index + 1, paperOrder: index + 1, points: 6.25,
  question: `${index + 1}번. 다음 자료를 읽고 당시의 정치·사회 모습에 대한 설명으로 가장 적절한 것을 고르시오.`,
  passage: index === 4
    ? "여러 제도를 정비하여 통치 체제를 마련하였다. 왕은 관리들의 의견을 듣고 나라의 중요한 일을 결정하였다.\n".repeat(16)
    : "(가) 새로운 왕조는 한양으로 도읍을 옮겼다.\n(나) 관리들은 여러 제도를 정비하고 백성들의 생활을 살폈다.",
  options: ["유교를 숭상하였다.", "수도를 한양으로 옮겼다.", "관리를 뽑는 과거제를 실시하였다.", "지방에 수령을 파견하여 통치하였다.", "왕을 보좌하는 여러 중앙 정치 기구를 두었다."],
  answer: "수도를 한양으로 옮겼다.",
}));
const denseFrozen = learning.captureQuestionSnapshots(denseQuestions.map(question => ({ path: `questions/${question.id}`, data: question })), denseQuestions.map(question => String(question.id)));
const stubs = `
const dense=location.search.includes('dense');const snapshots=dense?${JSON.stringify(denseFrozen.questionSnapshots)}:${JSON.stringify(frozen.questionSnapshots)};const presentation=dense?${JSON.stringify(learning.questionPresentation(denseFrozen.questionSnapshots))}:${JSON.stringify(presentation)};
const config={year:'2026',semester:'2'};const userData={uid:'fixture-student',name:'가상 학생',grade:3,class:1,number:1,email:'fixture@example.invalid'};const currentUser={uid:userData.uid,email:userData.email,getIdTokenResult:async()=>({claims:{email:userData.email}})};
const definitionId='quiz:2026-2:exam_prep:exam_prep:round_2';const settings={active:true,timeLimit:600,questionCount:snapshots.length,hintLimit:0,allowRetake:true};
let attempt=JSON.parse(sessionStorage.getItem('mock-runner-attempt')||'null');let failSubmit=location.search.includes('submit-error');let failSave=location.search.includes('save-error');
export const qa=window.mockRunnerQa={starts:[],saves:[],submits:[],get attempt(){return attempt},snapshotAnswerLeak:presentation.some(q=>q.answer||q.explanation)};
const persist=()=>sessionStorage.setItem('mock-runner-attempt',JSON.stringify(attempt));
export const useAuth=()=>({config,userData,currentUser});
export const getYearSemester=()=>config;
export const readStudentCurriculumTree=async()=>[];
export const buildAssessmentDefinitionId=()=>definitionId;
export const isAssessmentRevisionConflict=error=>error?.code==='aborted';
export const loadQuizScoreComparison=async()=>null;
export const getAssessmentState=async()=>({status:'READY',definition:{title:'중학교 3학년 복시 (2회 모의고사)',questionCount:snapshots.length,itemCount:snapshots.length,status:'PUBLISHED',durationSeconds:600,presentationSettings:settings,maxAttempts:3,cooldownMinutes:0},attempt:attempt?structuredClone(attempt):null,serverNowIso:new Date().toISOString()});
export const startAssessmentAttempt=async input=>{qa.starts.push(input);attempt={attemptId:'fixture-mock-attempt',definitionId,semesterId:'2026-2',assessmentKind:'QUIZ',attemptNumber:1,status:'STARTED',revision:1,answers:{},currentItemId:'1',questionIds:snapshots.map(question=>String(question.id)),startedAtIso:new Date().toISOString(),deadlineAtIso:new Date(Date.now()+600000).toISOString(),lastSavedAtIso:new Date().toISOString(),submittedAtIso:'',resultRef:'',resumed:false,learningSnapshot:[],questionPresentation:presentation,questionSnapshotOmittedIds:[]};persist();return structuredClone(attempt)};
export const saveAssessmentProgress=async input=>{qa.saves.push(structuredClone(input));if(failSave){failSave=false;throw Error('Fixture save failure')};if(input.expectedRevision!==attempt.revision)throw Error('Stale fixture revision');attempt={...attempt,status:'IN_PROGRESS',revision:attempt.revision+1,answers:input.answers,currentItemId:input.currentItemId,analytics:input.analytics,lastSavedAtIso:new Date().toISOString()};persist();return {revision:attempt.revision,savedAtIso:attempt.lastSavedAtIso}};
export const submitAssessmentAttempt=async input=>{qa.submits.push(structuredClone(input));if(failSubmit){failSubmit=false;throw Error('Fixture submit failure')};if(input.expectedRevision!==attempt.revision)throw Error('Stale submit fixture revision');const checks=snapshots.map(q=>({id:String(q.id),correct:String(input.answers[q.id]||'').trim()===q.answer}));const earnedPoints=snapshots.reduce((sum,q,i)=>sum+(checks[i].correct?q.points:0),0);attempt={...attempt,status:'SUBMITTED',revision:attempt.revision+1,answers:input.answers,submittedAtIso:new Date().toISOString()};persist();return {attemptId:attempt.attemptId,revision:attempt.revision,score:checks.filter(q=>q.correct).length,total:3,percent:earnedPoints,earnedPoints,maxPoints:100,answerChecks:checks,questionSnapshots:snapshots,learningSnapshot:[],resultRef:'semester_assessment_results/'+attempt.attemptId,reward:{status:'DISABLED'},replayedSubmission:false}};
`;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,Routes,Route} from 'react-router-dom';import QuizRunner from './src/pages/student/quiz/QuizRunner';import {AppToastProvider} from './src/components/common/AppToastProvider';import {AppDialogProvider} from './src/components/common/AppDialogProvider';import './src/components/layout/studentLayout.css';createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/student/quiz/run?unitId=exam_prep&category=exam_prep&round=round_2']}><AppToastProvider><AppDialogProvider><div className="student-layout"><Routes><Route path="/student/quiz/run" element={<QuizRunner/>}/><Route path="/student/mypage" element={<p>저장된 답안 확인 경로</p>}/></Routes></div></AppDialogProvider></AppToastProvider></MemoryRouter>);`;
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root }, bundle: true, write: false, metafile: true,
  outdir: "fixture", format: "esm", platform: "browser", jsx: "automatic", loader: { ".woff2": "dataurl", ".woff": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "mock-assessment-boundary", setup(builder) {
    builder.onResolve({ filter: /contexts\/AuthContext$|lib\/(semesterScope|assessmentLifecycle|studentLessonReadCache|quizScoreComparison)$/ }, () => ({ path: "runner-stub", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: stubs, loader: "js" }));
  } }],
});
assert.equal(Object.keys(built.metafile.inputs).some(name => /node_modules[\\/](@firebase|firebase)[\\/]/.test(name)), false, "No live Firebase runtime in browser fixture");
const js = built.outputFiles.find(file => file.path.endsWith(".js")).text;
const globalCss = (await fs.readFile(path.join(root, "assets/css/style.css"), "utf8")) + (await fs.readFile(path.join(root, "src/assets/index.css"), "utf8"));
const css = (globalCss + built.outputFiles.find(file => file.path.endsWith(".css")).text).replace(/@import\s+url\([^;]+;/g, "");
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}body{margin:0}#root{min-height:100dvh}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  response.setHeader("Content-Type", ["/fixture.js", "/tailwind.js"].includes(pathname) ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
  response.end(pathname === "/fixture.js" ? js : pathname === "/tailwind.js" ? tailwind : html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge", headless: true });
const pageErrors = [];
const open = async (width, height = 1024, touch = false, search = "") => {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/*", route => route.request().url().startsWith(origin) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
  await page.goto(origin + search);
  await page.getByRole("button", { name: "평가 시작하기", exact: true }).click();
  await page.getByRole("button", { name: "1번 문제 확대", exact: true }).waitFor();
  return page;
};
const openQuestion = async (page, index) => {
  const target = page.getByRole("button", { name: new RegExp(`^${index}번 문제 확대`) });
  await target.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `${index}번 문제 확대`, exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("button", { name: "시험지로 돌아가기" }).evaluate(element => element === document.activeElement), true);
  return dialog;
};
try {
  for (const width of [390, 768, 1280]) {
    const page = await open(width, 1024, false, "?submit-error");
    assert.equal(await page.evaluate(() => window.mockRunnerQa.snapshotAnswerLeak), false);
    assert.equal(await page.getByText("저장 당시 해설:", { exact: false }).count(), 0, "No answer explanation is rendered before submission");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(evidence, `paper-${width}.png`), fullPage: true });
    await openQuestion(page, 3);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("button", { name: "3번 문제 확대", exact: true }).evaluate(element => element === document.activeElement), true);
    const first = await openQuestion(page, 1);
    await first.getByRole("radio", { name: /조선/ }).check();
    await page.screenshot({ path: path.join(evidence, `zoom-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.mockRunnerQa.attempt.answers['1'] === '조선');
    await page.reload();
    await page.getByRole("button", { name: "이어하기", exact: true }).click();
    const restored = await openQuestion(page, 1);
    assert.equal(await restored.getByRole("radio", { name: /조선/ }).isChecked(), true);
    await page.keyboard.press("Escape");
    const second = await openQuestion(page, 2);
    const input = second.getByRole("textbox", { name: "답안", exact: true });
    await input.fill("틀린 답안");
    assert.equal(await input.getAttribute("maxlength"), "20");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "제출하기", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "평가를 제출할까요?" });
    await confirm.waitFor();
    assert.ok((await confirm.textContent()).includes("문제가 1개"));
    await confirm.getByRole("button", { name: "계속 풀기", exact: true }).click();
    assert.equal(await page.evaluate(() => window.mockRunnerQa.submits.length), 0);
    await page.getByRole("button", { name: "제출하기", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "제출하기", exact: true }).click();
    await page.getByRole("button", { name: "다시 제출", exact: true }).waitFor();
    assert.ok(await page.getByRole("button", { name: "1번 문제 확대, 답안 입력됨", exact: true }).count());
    await page.getByRole("button", { name: "다시 제출", exact: true }).click();
    await page.getByRole("button", { name: "저장된 답안·해설", exact: true }).waitFor();
    await page.locator(".mock-exam-score").waitFor();
    assert.ok((await page.locator(".mock-exam-score").textContent()).startsWith("30"), "The paper uses weighted server percent, not correct-count ratio");
    const submitted = await page.evaluate(() => window.mockRunnerQa.submits);
    assert.equal(submitted.length, 2);
    assert.deepEqual(submitted[0].answers, submitted[1].answers, "Retry preserves answers");
    assert.equal(submitted[1].answers['1'], "조선");
    assert.equal(submitted[1].answers['2'], "틀린 답안");
    assert.equal(submitted[1].answers['3'] || "", "");
    const review = await openQuestion(page, 2);
    assert.ok((await review.textContent()).includes("정답: 이성계"));
    assert.ok((await review.textContent()).includes("저장 당시 해설"));
    assert.equal(await review.getByRole("textbox").count(), 0);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: path.join(evidence, `result-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "저장된 답안·해설", exact: true }).click();
    await page.getByText("저장된 답안 확인 경로", { exact: true }).waitFor();
    await page.close();
  }
  const landscape = await open(1024, 768, true);
  await landscape.locator(".mock-exam-workspace.is-rotated").waitFor();
  assert.equal(await landscape.locator(".mock-exam-workspace").evaluate(element => getComputedStyle(element).transform !== "none"), true);
  const rotatedDialog = await openQuestion(landscape, 1);
  await rotatedDialog.getByRole("radio", { name: /조선/ }).check();
  await landscape.screenshot({ path: path.join(evidence, "landscape-zoom.png"), fullPage: true });
  await landscape.keyboard.press("Escape");
  await landscape.setViewportSize({ width: 768, height: 1024 });
  await landscape.waitForFunction(() => !document.querySelector('.mock-exam-workspace').classList.contains('is-rotated'));
  const portraitDialog = await openQuestion(landscape, 1);
  assert.equal(await portraitDialog.getByRole("radio", { name: /조선/ }).isChecked(), true);
  await landscape.keyboard.press("Escape");
  const keyboardDialog = await openQuestion(landscape, 2);
  const keyboardInput = keyboardDialog.getByRole("textbox", { name: "답안", exact: true });
  await keyboardInput.focus();
  await landscape.setViewportSize({ width: 768, height: 420 });
  assert.equal(await landscape.locator('.mock-exam-workspace.is-rotated').count(), 0, 'Keyboard-height changes must not trigger device rotation');
  await keyboardInput.fill('입력 유지');
  await landscape.setViewportSize({ width: 768, height: 1024 });
  assert.equal(await keyboardInput.inputValue(), '입력 유지');
  await landscape.close();
  const densePage = await open(1280, 1024, false, "?dense");
  await densePage.evaluate(() => document.fonts.ready);
  await densePage.waitForFunction(() => document.querySelectorAll('.mock-exam-sheet .mock-exam-question').length === 16);
  assert.ok(await densePage.locator('.mock-exam-sheet').first().locator('.mock-exam-column').nth(0).locator('.mock-exam-question').count());
  assert.ok(await densePage.locator('.mock-exam-sheet').first().locator('.mock-exam-column').nth(1).locator('.mock-exam-question').count());
  assert.equal(await densePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await densePage.screenshot({ path: path.join(evidence, 'dense-1280.png'), fullPage: true });
  const denseZoom = await openQuestion(densePage, 5);
  assert.equal(await denseZoom.locator('.mock-exam-zoom-scroll').evaluate(element => element.scrollHeight > element.clientHeight), true, 'Long material stays in the zoom scroll area');
  await densePage.screenshot({ path: path.join(evidence, 'dense-long-question.png'), fullPage: true });
  await densePage.close();
  assert.deepEqual(pageErrors, []);
  console.log(`Mock exam runner browser passed: 390/768/1280, touch rotation, keyboard zoom/focus, save/resume, incomplete confirmation, retry, weighted immutable results. Evidence: ${evidence}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
