/** Real quiz settings dialog and toast provider; synthetic server boundaries only. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
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
  process.env.QUIZ_SETTINGS_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-quiz-settings-")));
await fs.mkdir(evidence, { recursive: true });
const source = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const service = `
export const qa=window.quizSettingsQa={reads:[],saves:[],commits:[],forbidden:[],closes:0,failNext:0,hold:false,settings:{},definitions:{}};
export const config={year:'2026',semester:'2'};
export const auth={currentUser:{uid:'quiz-settings-fixture',email:'fixture@example.invalid'}};
export const useAuth=()=>({config,currentUser:auth.currentUser});
export const db={};
export const doc=(_db,...segments)=>({path:segments.join('/')});
export const collection=doc;
export const where=(...args)=>({where:args});
export const query=reference=>reference;
export const getDocs=async reference=>{qa.reads.push(reference.path);return {docs:[],empty:true,size:0,forEach(){}};};
export const getDoc=async reference=>{
  qa.reads.push(reference.path);
  let value;
  if(reference.path.endsWith('/assessment_config/settings'))value=qa.settings;
  else if(reference.path.endsWith('/assessment_config/status'))value=qa.legacyStatus||{};
  else if(reference.path.startsWith('semester_assessment_definitions/'))value=qa.definitions[reference.path.split('/').at(-1)];
  else throw new Error('Unexpected fixture read: '+reference.path);
  return {exists:()=>value!==undefined,data:()=>structuredClone(value)};
};
export const readSiteSettingDoc=async name=>{
  if(name!=='school_config')throw new Error('Unexpected site setting: '+name);
  return {grades:[{value:'3',label:'3학년'}],classes:[1,2,3,4].map(value=>({value:String(value),label:value+'반'}))};
};
const forbidden=(...args)=>{qa.forbidden.push(args);throw new Error('Unexpected server operation');};
export const setDoc=forbidden,updateDoc=forbidden,deleteDoc=forbidden,addDoc=forbidden,runTransaction=forbidden;
export const getHttpsCallable=forbidden,getHistoryDictionaryCallable=forbidden,ensureSensitiveOperation=forbidden,getIdTokenResult=forbidden;
export const getAssessmentSemesterId=scope=>scope.year+'-'+scope.semester;
export const saveQuizAssessmentSettings=async(scope,nodeId,category,round,title,key,payload,expectedRevision)=>{
  qa.saves.push(structuredClone({scope,nodeId,category,round,title,key,payload,expectedRevision}));
  if(qa.hold)await new Promise(resolve=>{qa.release=resolve;});
  if(qa.failNext){qa.failNext--;throw new Error('저장 서버에 연결하지 못했습니다. 다시 시도해 주세요.');}
  const status=qa.statusOverride||(payload.active?'PUBLISHED':'PAUSED');
  const result={status,revision:expectedRevision+1};
  qa.settings[key]=structuredClone(payload);
  qa.definitions[qa.definitionId(scope,nodeId,category,round)]={...result,questionCount:payload.questionCount,durationSeconds:payload.timeLimit,maxAttempts:payload.allowRetake?99:1,cooldownMinutes:payload.cooldown,presentationSettings:structuredClone(payload)};
  qa.commits.push(structuredClone(result));
  return result;
};
`;
const harness = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import Modal from ${source("src/pages/teacher/components/QuizSettingsModal.tsx")};
import {AppToastProvider} from ${source("src/components/common/AppToastProvider.tsx")};
import {getAssessmentConfigKey} from ${source("src/lib/assessmentConfig.ts")};
import {buildAssessmentDefinitionId} from ${source("src/lib/assessmentLifecycle.ts")};
import ${source("src/assets/index.css")};
import {qa} from 'fixture:service';
const params=new URLSearchParams(location.search);
const category=params.get('category')||'diagnostic';
const nodeId=category==='exam_prep'?'exam_prep':'fixture-unit';
const round=category==='exam_prep'?'round_1':'';
const key=getAssessmentConfigKey(nodeId,category,round||undefined);
qa.definitionId=(scope,nodeId,category,round)=>buildAssessmentDefinitionId(scope.year+'-'+scope.semester,'QUIZ',nodeId,category,round);
const stored={active:true,questionCount:7,questionOrder:'created',randomOrder:false,timeLimit:1380,allowRetake:true,cooldown:17,hintLimit:5,visibleClassIds:['3-2'],visibilityVersion:2};
if(params.has('stored'))qa.settings[key]=stored;
if(params.has('canonical'))qa.definitions[qa.definitionId({year:'2026',semester:'2'},nodeId,category,round)]={status:'PUBLISHED',revision:8,questionCount:7,durationSeconds:1380,maxAttempts:99,cooldownMinutes:17,presentationSettings:stored};
if(params.has('legacy-active'))qa.legacyStatus={[key]:true};
function Fixture(){
  const [open,setOpen]=useState(true);
  return <main><h1>평가 관리 검증</h1><button onClick={()=>setOpen(true)}>평가 설정 다시 열기</button><Modal isOpen={open} onClose={()=>{qa.closes++;setOpen(false);}} nodeId={nodeId} nodeTitle='긴 한글 단원명으로 확인하는 우리 역사의 전개와 변화' category={category} canEdit={!params.has('readonly')}/></main>;
}
createRoot(document.getElementById('root')).render(<AppToastProvider><Fixture/></AppToastProvider>);
`;
const bundle = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(evidence, "fixture.js"),
  loader: { ".svg": "dataurl", ".webp": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "quiz-settings-boundaries",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^fixture:|^firebase\/(firestore|auth)$|(?:^|\/)contexts\/AuthContext$|(?:^|\/)(firebase|siteSettings|assessmentRelease|historyDictionarySession|sensitiveOperation)$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "ts",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
// Fonts use the local fallback; do not request the production Google Fonts import.
const css = bundle.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+(?:url\()?['"]https?:[^;]+;/g, "");
const tailwindPath =
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
  path.join(os.tmpdir(), "westory-qa-tailwind.js");
let tailwind;
try {
  tailwind = await fs.readFile(tailwindPath, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const appHtml = await fs.readFile(path.join(root, "index.html"), "utf8");
  const tailwindUrl = Array.from(
    appHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi),
    (match) => match[1],
  ).find((url) => /^https:\/\/cdn\.tailwindcss\.com(?:\/|$)/.test(url));
  assert(
    tailwindUrl,
    "index.html must declare the official Tailwind CDN runtime",
  );
  try {
    const response = await fetch(tailwindUrl, {
      signal: AbortSignal.timeout(30000),
    });
    assert(response.ok, `Tailwind CDN returned HTTP ${response.status}`);
    assert.equal(new URL(response.url).origin, "https://cdn.tailwindcss.com");
    assert.match(
      response.headers.get("content-type") || "",
      /(?:java|ecma)script/i,
    );
    tailwind = await response.text();
    assert(tailwind.trim(), "Tailwind CDN returned an empty runtime");
  } catch (cause) {
    throw new Error(
      `Could not cache ${tailwindUrl}. Connect once, or set PORTAL_DESIGN_TAILWIND_PATH to a downloaded runtime.`,
      { cause },
    );
  }
  await fs.mkdir(path.dirname(tailwindPath), { recursive: true });
  try {
    await fs.writeFile(tailwindPath, tailwind, {
      encoding: "utf8",
      flag: "wx",
    });
    console.log(`Cached production Tailwind runtime: ${tailwindPath}`);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    tailwind = await fs.readFile(tailwindPath, "utf8");
  }
}
const html =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const asset =
    pathname === "/fixture.js"
      ? ["text/javascript", js]
      : pathname === "/tailwind.js"
        ? ["text/javascript", tailwind]
        : pathname === "/fixture.css"
          ? ["text/css", css]
          : ["text/html", html];
  response.setHeader("Content-Type", asset[0]);
  response.end(asset[1]);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  errors = [],
  externalRequests = [],
  screenshots = [],
  layouts = [];
let failure;
const saveButton = (page) =>
  page.getByRole("button", { name: "설정 저장", exact: true });
const number = (page, name) =>
  page.getByRole("spinbutton", { name, exact: true });
const publicRadio = (page) =>
  page.getByRole("radio", { name: "선택 학급 학생에게 공개", exact: true });
const privateRadio = (page) =>
  page.getByRole("radio", { name: "모든 학생에게 비공개", exact: true });
async function ready(page) {
  await page.locator('.quiz-settings-dialog[aria-busy="false"]').waitFor();
  await number(page, "출제 문항 수").waitFor();
}
async function reopen(page) {
  const previousReads = await page.evaluate(
    () =>
      window.quizSettingsQa.reads.filter((path) =>
        path.startsWith("semester_assessment_definitions/"),
      ).length,
  );
  await page.getByRole("button", { name: "평가 설정 다시 열기" }).click();
  await page.waitForFunction(
    (count) =>
      window.quizSettingsQa.reads.filter((path) =>
        path.startsWith("semester_assessment_definitions/"),
      ).length > count,
    previousReads,
  );
  await ready(page);
}
async function open(query = "", width = 1280) {
  const page = await browser.newPage({
    viewport: { width, height: width === 1366 ? 768 : 900 },
  });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${origin}/?${query}`);
  await ready(page);
  return page;
}
async function capture(page, label) {
  const file = `${label}.png`;
  await page.screenshot({ path: path.join(evidence, file), fullPage: true });
  screenshots.push(file);
}
async function closeAfterSave(page, expected) {
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.locator(".ws-toast").filter({ hasText: expected }).waitFor();
  assert.equal(await page.evaluate(() => window.quizSettingsQa.closes), 1);
}
async function readSettings(page) {
  return {
    questionCount: await number(page, "출제 문항 수").inputValue(),
    minutes: await number(page, "제한 시간 (분)").inputValue(),
    order: await page
      .getByRole("combobox", { name: "문항 출제 순서" })
      .inputValue(),
    hints: await number(page, "힌트 사용 가능 횟수").inputValue(),
    retake: await page
      .getByRole("checkbox", { name: "재응시 허용", exact: true })
      .isChecked(),
    cooldown: await number(page, "재응시 대기 시간 (분)").inputValue(),
  };
}
try {
  for (const category of ["diagnostic", "formative"]) {
    const page = await open(`category=${category}`);
    assert.deepEqual(await readSettings(page), {
      questionCount: "20",
      minutes: "15",
      order: "unit",
      hints: "3",
      retake: true,
      cooldown: "5",
    });
    assert.equal(await privateRadio(page).isChecked(), true);
    assert.equal(await saveButton(page).isEnabled(), true);
    await page
      .getByRole("checkbox", { name: "힌트 사용", exact: true })
      .uncheck();
    await page
      .getByRole("checkbox", { name: "힌트 사용", exact: true })
      .check();
    assert.equal(await number(page, "힌트 사용 가능 횟수").inputValue(), "3");
    await page
      .getByRole("checkbox", { name: "재응시 허용", exact: true })
      .uncheck();
    await page
      .getByRole("checkbox", { name: "재응시 허용", exact: true })
      .check();
    assert.equal(await number(page, "재응시 대기 시간 (분)").inputValue(), "5");
    await saveButton(page).click();
    await closeAfterSave(page, "모든 학생에게 비공개");
    assert.equal(
      await page.evaluate(
        () => window.quizSettingsQa.saves[0].payload.timeLimit,
      ),
      900,
    );
    await page.close();
  }
  checks.push(
    "New diagnostic/formative defaults, toggle restoration, and unchanged private defaults save successfully.",
  );

  for (const mode of ["stored", "canonical"]) {
    const page = await open(mode);
    assert.deepEqual(await readSettings(page), {
      questionCount: "7",
      minutes: "23",
      order: "created",
      hints: "5",
      retake: true,
      cooldown: "17",
    });
    assert.equal(await publicRadio(page).isChecked(), true);
    assert.equal(
      await page
        .getByRole("checkbox", { name: "3학년 2반 공개 대상", exact: true })
        .isChecked(),
      true,
    );
    assert.equal(await saveButton(page).isDisabled(), true);
    assert.equal(
      await page.evaluate(() => window.quizSettingsQa.saves.length),
      0,
    );
    await page.close();
  }
  checks.push(
    "Existing legacy-settings and canonical-definition values override the new defaults without writes.",
  );

  const legacy = await open("legacy-active");
  assert.deepEqual(await readSettings(legacy), {
    questionCount: "10",
    minutes: "1",
    order: "random",
    hints: "2",
    retake: true,
    cooldown: "0",
  });
  assert.equal(await publicRadio(legacy).isChecked(), true);
  assert.equal(
    await legacy.locator(".quiz-settings-classes input:checked").count(),
    4,
  );
  assert.equal(await saveButton(legacy).isDisabled(), true);
  await legacy.close();
  checks.push(
    "Legacy active-only records retain their original fallback defaults and class scope.",
  );

  const publish = await open();
  await publicRadio(publish).check();
  assert.match(
    await publish.locator(".quiz-settings-error").textContent(),
    /공개할 학급을 한 곳 이상/,
  );
  assert.equal(await saveButton(publish).isDisabled(), true);
  for (const classNumber of [1, 2])
    await publish
      .getByRole("checkbox", {
        name: `3학년 ${classNumber}반 공개 대상`,
        exact: true,
      })
      .check();
  await publish.evaluate(() => {
    window.quizSettingsQa.hold = true;
  });
  await saveButton(publish).click();
  await publish
    .getByRole("button", { name: "저장 중…", exact: true })
    .waitFor();
  assert.equal(await publish.locator(".ws-toast").count(), 0);
  assert.equal(await number(publish, "출제 문항 수").isDisabled(), true);
  await publish.locator(".quiz-authoring-primary").evaluate((button) => {
    button.click();
    button.click();
  });
  assert.equal(
    await publish.evaluate(() => window.quizSettingsQa.saves.length),
    1,
  );
  await publish.evaluate(() => {
    window.quizSettingsQa.hold = false;
    window.quizSettingsQa.release();
  });
  await closeAfterSave(publish, "선택한 2개 학급의 학생에게 공개");
  await capture(publish, "published-toast-1280");
  await reopen(publish);
  await publicRadio(publish).and(publish.locator("input:checked")).waitFor();
  assert.equal(await publicRadio(publish).isChecked(), true);
  assert.equal(
    await publish
      .getByRole("checkbox", { name: "3학년 1반 공개 대상", exact: true })
      .isChecked(),
    true,
  );
  assert.equal(await number(publish, "출제 문항 수").inputValue(), "20");
  assert.equal(await saveButton(publish).isDisabled(), true);
  await publish.close();
  checks.push(
    "Zero-class validation, no premature toast, duplicate-save prevention, published class count, automatic close, and persisted reopen.",
  );

  const retry = await open("canonical");
  await number(retry, "출제 문항 수").fill("31");
  await retry.evaluate(() => {
    window.quizSettingsQa.failNext = 1;
  });
  await saveButton(retry).click();
  await retry.locator(".ws-toast--error").waitFor();
  assert.equal(await retry.getByRole("dialog").isVisible(), true);
  assert.equal(await number(retry, "출제 문항 수").inputValue(), "31");
  assert.equal(await saveButton(retry).isEnabled(), true);
  assert.equal(await retry.evaluate(() => window.quizSettingsQa.closes), 0);
  assert.equal(
    await retry.evaluate(() => window.quizSettingsQa.commits.length),
    0,
  );
  await capture(retry, "failed-save-draft-1280");
  await retry.locator(".ws-toast--error .ws-toast__close").click();
  await saveButton(retry).click();
  await closeAfterSave(retry, "선택한 1개 학급의 학생에게 공개");
  assert.equal(
    await retry.evaluate(() => window.quizSettingsQa.saves.length),
    2,
  );
  await retry.close();
  checks.push(
    "A server failure keeps the dialog and edited values, shows the actual error toast, and allows a successful retry.",
  );

  const authoritative = await open("canonical");
  await number(authoritative, "출제 문항 수").fill("8");
  await authoritative.evaluate(() => {
    window.quizSettingsQa.statusOverride = "PAUSED";
  });
  await saveButton(authoritative).click();
  await closeAfterSave(authoritative, "모든 학생에게 비공개");
  await reopen(authoritative);
  await privateRadio(authoritative)
    .and(authoritative.locator("input:checked"))
    .waitFor();
  assert.equal(await privateRadio(authoritative).isChecked(), true);
  assert.equal(
    await authoritative
      .getByRole("checkbox", { name: "3학년 2반 공개 대상", exact: true })
      .isChecked(),
    true,
  );
  await authoritative.close();
  checks.push(
    "Success feedback follows the returned PAUSED status even when the request was public; saved class selection survives reopening.",
  );

  const discard = await open();
  await number(discard, "출제 문항 수").fill("29");
  await discard.keyboard.press("Escape");
  await discard
    .getByText("저장하지 않은 변경 사항이 있습니다.", { exact: true })
    .waitFor();
  await discard.getByRole("button", { name: "계속 편집", exact: true }).click();
  assert.equal(await number(discard, "출제 문항 수").inputValue(), "29");
  await discard
    .getByRole("button", { name: "평가 설정 닫기", exact: true })
    .click();
  await discard
    .getByRole("button", { name: "변경 취소 후 닫기", exact: true })
    .click();
  await discard.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    await discard.evaluate(() => window.quizSettingsQa.saves.length),
    0,
  );
  await reopen(discard);
  await discard.waitForFunction(
    () =>
      document.querySelector('input[aria-label="출제 문항 수"]').value === "20",
  );
  assert.equal(await number(discard, "출제 문항 수").inputValue(), "20");
  await discard.close();
  checks.push(
    "Escape/close protects unsaved edits; continue preserves the draft and confirmed discard performs no save.",
  );

  const readonly = await open("canonical&readonly", 390);
  assert.equal(await saveButton(readonly).count(), 0);
  assert.equal(await number(readonly, "출제 문항 수").isDisabled(), true);
  assert.equal(await publicRadio(readonly).isDisabled(), true);
  assert.equal(
    await readonly
      .getByRole("checkbox", { name: "3학년 1반 공개 대상", exact: true })
      .isDisabled(),
    true,
  );
  await capture(readonly, "readonly-390");
  assert.equal(
    await readonly.evaluate(() => window.quizSettingsQa.saves.length),
    0,
  );
  await readonly.close();
  checks.push(
    "Readonly users cannot alter fields, visibility or class selection and have no save action.",
  );

  const mock = await open("category=exam_prep");
  assert.equal(await number(mock, "출제 문항 수").inputValue(), "10");
  assert.equal(await number(mock, "제한 시간 (분)").inputValue(), "40");
  assert.equal(
    await mock
      .getByRole("checkbox", { name: "힌트 사용", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await mock
      .getByRole("checkbox", { name: "재응시 허용", exact: true })
      .count(),
    0,
  );
  assert.match(
    await mock.locator(".quiz-settings-body").textContent(),
    /기본 회차 · 1회만 응시 가능/,
  );
  await saveButton(mock).click();
  await closeAfterSave(mock, "모든 학생에게 비공개");
  const mockPayload = await mock.evaluate(
    () => window.quizSettingsQa.saves[0].payload,
  );
  assert.equal(mockPayload.hintLimit, 0);
  assert.equal(mockPayload.allowRetake, false);
  assert.equal(mockPayload.cooldown, 0);
  await mock.close();
  checks.push(
    "New mock exams retain 10 questions/40 minutes, no hints and one attempt for the base round.",
  );

  for (const width of [320, 390, 768, 1280, 1366]) {
    const page = await open("", width);
    const layout = await page.evaluate(() => {
      const dialog = document.querySelector(".quiz-settings-dialog");
      const body = document.querySelector(".quiz-settings-body");
      const footer = document.querySelector(".quiz-settings-footer");
      const r = dialog.getBoundingClientRect(),
        f = footer.getBoundingClientRect();
      return {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        dialogLeft: r.left,
        dialogRight: r.right,
        dialogTop: r.top,
        dialogBottom: r.bottom,
        bodyScrollWidth: body.scrollWidth,
        bodyClientWidth: body.clientWidth,
        footerBottom: f.bottom,
        separators: [
          ...document.querySelectorAll(
            ".quiz-settings-option + .quiz-settings-option",
          ),
        ].map((el) => ({
          width: getComputedStyle(el).borderTopWidth,
          style: getComputedStyle(el).borderTopStyle,
        })),
        columnBorder: getComputedStyle(
          document.querySelector(
            ".quiz-settings-columns .quiz-settings-section + .quiz-settings-section",
          ),
        )[innerWidth < 768 ? "borderTopWidth" : "borderLeftWidth"],
      };
    });
    assert.ok(
      layout.scrollWidth <= width + 1,
      `No document overflow: ${width}`,
    );
    assert.ok(
      layout.bodyScrollWidth <= layout.bodyClientWidth + 1,
      `No dialog-body overflow: ${width}`,
    );
    assert.ok(layout.dialogLeft >= 0 && layout.dialogRight <= width + 1);
    assert.ok(
      layout.dialogTop >= 0 &&
        layout.dialogBottom <= layout.height + 1 &&
        layout.footerBottom <= layout.height + 1,
    );
    assert.ok(
      layout.separators.length >= 2,
      "Each option group has a separator",
    );
    assert.ok(
      layout.separators.every(
        (border) => border.width === "1px" && border.style === "solid",
      ),
    );
    assert.equal(layout.columnBorder, "1px");
    await capture(page, `settings-${width}-top`);
    await page.locator(".quiz-settings-body").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await capture(page, `settings-${width}-options`);
    layouts.push(layout);
    assert.equal(
      await page.evaluate(() => window.quizSettingsQa.forbidden.length),
      0,
    );
    await page.close();
  }
  checks.push(
    "320/390/768/1280/1366px screenshots: no horizontal overflow, visible footer, option separators and responsive column border.",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
} catch (error) {
  failure = error.stack;
  for (const [index, page] of browser
    .contexts()
    .flatMap((context) => context.pages())
    .entries())
    await capture(page, `failure-${index}`).catch(() => {});
} finally {
  await fs.writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        status: failure ? "FAIL" : "PASS",
        checks,
        errors,
        externalRequests,
        screenshots,
        layouts,
        failure,
        limitations:
          "Synthetic identities/server responses; real dialog, normalization, focus management and toast provider. All browser external network blocked. Cached Tailwind runtime; local font fallback. No production reads or writes.",
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  JSON.stringify(
    { status: failure ? "FAIL" : "PASS", checks, evidence },
    null,
    2,
  ),
);
if (failure) throw new Error(failure);
