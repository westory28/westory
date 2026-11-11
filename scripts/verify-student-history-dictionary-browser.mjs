/** Real student dictionary UI; synthetic session/data boundaries; no live data writes. */
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
  process.env.DICTIONARY_EVIDENCE_DIR ||
  path.join(root, "output/broad-stability-20261111/dictionary");
await fs.mkdir(evidence, { recursive: true });
const source = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const services = `
import React,{createContext,useContext} from 'react';
import {getHistoryDictionaryCatalog} from ${source("src/lib/historyDictionaryCatalog.ts")};
export const AuthContext=createContext(null);
export const useAuth=()=>useContext(AuthContext);
export const qa=window.dictionaryQa={catalogReads:[],subscriptions:[],unsubscribes:[],active:0,saves:[],lookups:[],toasts:[],delay:80,failCatalog:0,failWords:0,failLookup:0,failSave:0};
export const normalizeHistoryDictionaryWord=value=>value.trim().replace(/\\s+/g,' ').toLowerCase();
export const useAppToast=()=>({showToast:value=>qa.toasts.push(value)});
export const getHistoryDictionaryErrorMessage=error=>error.message;
export const useGongsinAvailability=()=>({enabled:true,loaded:true});
export const getGongsinQuestionUrl=source=>'/student/gongsinmoongo?sourceKind='+source.kind+'&termId='+encodeURIComponent(source.termId||'');
export const canSaveHistoryDictionaryTermToNotebook=term=>Boolean(term?.sourcePath?.startsWith('years/'));
const sleep=()=>new Promise(resolve=>setTimeout(resolve,qa.delay));
const saved=(uid,semester,word,definition,readOnly=false)=>({id:'word-'+word,termId:'term-'+word,word,normalizedWord:normalizeHistoryDictionaryWord(word),definition,status:'saved',uid,sourceYear:'2026',sourceSemester:readOnly?'1':semester,readOnly,sourcePath:'years/2026/semesters/'+(readOnly?'1':semester)+'/dictionary_students/'+uid+'/history_dictionary_words/term-'+word});
const rows=(uid,semester)=>[saved(uid,semester,'율령',uid==='student-b'?'다른 학생의 저장 내용':'나라를 다스리기 위해 정한 법과 제도'),saved(uid,semester,'집현전','세종 때 학문 연구와 정책 자문을 맡던 기관',true),saved(uid,semester,'조선왕조실록편찬과보관에관한긴한글검증항목','긴 한글 표시와 줄바꿈을 확인하는 합성 검증 자료입니다. '.repeat(12))];
const listeners=new Map();
qa.emitWordsError=()=>listeners.forEach(listener=>listener.error(Error('권한을 확인하지 못했습니다. 다시 로그인해 주세요.')));
export const loadHistoryDictionaryCatalog=async config=>{qa.catalogReads.push({...config});const fail=qa.failCatalog>0;if(fail)qa.failCatalog--;await sleep();if(fail)throw Error('사전을 불러오지 못했습니다.');return getHistoryDictionaryCatalog();};
export const subscribeStudentHistoryDictionaryWords=(uid,onData,config,onError)=>{
  const id=qa.subscriptions.length;qa.subscriptions.push({id,uid,...config});qa.active++;const value=rows(uid,config.semester);const fail=qa.failWords>0;if(fail)qa.failWords--;
  listeners.set(id,{data:onData,error:onError});
  // Deliberately deliver the outstanding response after cleanup to test stale guards.
  setTimeout(()=>{if(fail)onError(Error('연결을 확인하고 다시 불러와 주세요.'));else onData(value);},qa.delay);
  return()=>{qa.active--;qa.unsubscribes.push(id);listeners.delete(id);};
};
export const saveStudentHistoryDictionaryEntry=async input=>{qa.saves.push(input);await sleep();if(qa.failSave){qa.failSave--;throw Error('저장하지 못했습니다. 다시 저장해 주세요.');}return {reward:{awarded:false}};};
export const deleteStudentHistoryDictionaryWord=async()=>({reward:{reclaimed:false}});
export const loadPublishedHistoryDictionaryTerm=async(word,config)=>{qa.lookups.push({word,...config});await sleep();if(qa.failLookup){qa.failLookup--;throw Error('뜻풀이를 불러오지 못했습니다. 다시 확인해 주세요.');}return {id:'teacher-term',word,definition:'국가가 백성을 다스리기 위해 마련한 법과 행정 규정.',status:'published',sourceYear:'2026',sourceSemester:'2',sourcePath:'years/2026/semesters/2/history_dictionary_terms/teacher-term'};};
export const saveStudentHistoryDictionaryWord=async()=>({});
export const requestHistoryDictionaryTerm=async()=>({});
`;
const harness = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,useLocation,useNavigate} from 'react-router-dom';
import {AuthContext,qa} from 'dictionary-fixture';
import ${source("src/components/common/portalPage.css")};
import ${source("src/components/layout/studentLayout.css")};
import Student from ${source("src/pages/student/lesson/HistoryDictionary.tsx")};
import Floating from ${source("src/components/common/StudentHistoryDictionaryController.tsx")};
import {LoadingProvider} from ${source("src/components/common/LoadingState.tsx")};
function App(){const [auth,setAuth]=useState({currentUser:{uid:'student-a'},userData:{role:'student'},config:{year:'2026',semester:'2'},configReady:true});qa.setAuth=update=>setAuth(previous=>({...previous,...update}));qa.navigate=useNavigate();const location=useLocation();qa.path=location.pathname+location.search;return <AuthContext.Provider value={auth}><LoadingProvider><div className="student-layout">{location.pathname.includes('history-dictionary')?<Student/>:<><h1>합성 수업자료 화면</h1><Floating/></>}</div></LoadingProvider></AuthContext.Provider>;}
const params=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[params.has('floating')?'/student/lesson/note?id=fixture':'/student/lesson/history-dictionary'+(params.get('term')?'?term='+params.get('term'):'')]}><App/></MemoryRouter>);
`;
const compiled = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  outdir: "dictionary-qa",
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  loader: { ".webp": "dataurl", ".png": "dataurl", ".svg": "dataurl" },
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "dictionary-fixture",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /(^dictionary-fixture$|AuthContext$|AppToastProvider$|\/lib\/historyDictionary$|\/lib\/historyDictionarySession$|\/lib\/gongsinmoongo$)/,
          },
          () => ({ path: "dictionary-fixture", namespace: "fixture" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: services,
          loader: "jsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = compiled.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css =
  compiled.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
const [appCss, legacyCss, tailwind] = await Promise.all([
  fs.readFile(path.join(root, "src/assets/index.css"), "utf8"),
  fs.readFile(path.join(root, "assets/css/style.css"), "utf8"),
  fs.readFile(path.join(os.tmpdir(), "westory-qa-tailwind.js"), "utf8"),
]);
const html =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>역사사전 합성 검증</title><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((request, response) => {
  const route = request.url?.split("?")[0];
  response.setHeader(
    "Content-Type",
    route?.endsWith(".js")
      ? "text/javascript"
      : route?.endsWith(".css")
        ? "text/css"
        : "text/html",
  );
  response.end(
    route === "/fixture.js"
      ? js
      : route === "/tailwind.js"
        ? tailwind
        : route === "/fixture.css"
          ? (legacyCss + "\n" + appCss + "\n" + css).replace(
              /@import[^;]+;/g,
              "",
            )
          : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await playwright.chromium.launch({
  channel: "msedge",
  headless: true,
});
const report = { passed: [], viewports: [], errors: [], network: [] };
const context = await browser.newContext();
await context.route("**/*", (route) => {
  if (
    route.request().url().startsWith(base) ||
    route.request().url().startsWith("data:")
  )
    return route.continue();
  report.network.push(route.request().url());
  return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", (error) => report.errors.push(error.message));
const count = async () =>
  page.evaluate(() => ({
    catalog: window.dictionaryQa.catalogReads.length,
    subscriptions: window.dictionaryQa.subscriptions.length,
    active: window.dictionaryQa.active,
    saves: window.dictionaryQa.saves.length,
  }));
const ready = () =>
  page.locator(".history-dictionary-catalog-entry").first().waitFor();
const notebook = () =>
  page.getByRole("button", { name: "내 단어장", exact: true }).click();
const choose = async () => {
  await page.getByRole("searchbox", { name: "단어·지명 찾기" }).fill("율령");
  const row = page
    .locator(".history-dictionary-catalog-entry")
    .filter({ has: page.getByRole("heading", { name: "율령", exact: true }) });
  await row.getByRole("button", { name: "내 말로 정리하기" }).click();
  await page.getByRole("textbox", { name: "내가 이해한 뜻" }).waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector(".history-dictionary-editor fieldset")?.disabled,
  );
};
const layout = async (label, width) => {
  const result = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    header: [
      ...document.querySelectorAll(
        ".ws-page-header,.history-dictionary-dialog-header",
      ),
    ]
      .filter((el) => el.getClientRects().length)
      .map((el) => ({
        background: getComputedStyle(el).backgroundColor,
        shadow: getComputedStyle(el).boxShadow,
      })),
    controls: [
      ...document.querySelectorAll(
        ".history-dictionary-field input,.history-dictionary-field select,.history-dictionary-field textarea,.history-dictionary-button,.history-dictionary-dialog-close",
      ),
    ]
      .filter((el) => el.getClientRects().length)
      .map((el) => ({
        label:
          el.getAttribute("aria-label") ||
          el.textContent ||
          el.getAttribute("placeholder"),
        height: el.getBoundingClientRect().height,
        width: el.getBoundingClientRect().width,
        font: getComputedStyle(el).fontSize,
      })),
    overflows: [...document.querySelectorAll(".history-dictionary-workspace *")]
      .filter(
        (el) =>
          el.getClientRects().length &&
          getComputedStyle(el).position !== "fixed" &&
          el.getBoundingClientRect().right > innerWidth + 1,
      )
      .slice(0, 8)
      .map((el) => ({
        tag: el.tagName,
        class: el.className,
        right: el.getBoundingClientRect().right,
      })),
  }));
  assert.ok(result.scroll <= width + 1, JSON.stringify(result));
  assert.ok(result.body <= width + 1, JSON.stringify(result));
  assert.deepEqual(result.overflows, [], JSON.stringify(result));
  assert.ok(
    result.controls.every((control) => control.height >= 43),
    JSON.stringify(result.controls),
  );
  assert.ok(
    result.header.every(
      (header) =>
        header.background === "rgba(0, 0, 0, 0)" && header.shadow === "none",
    ),
    JSON.stringify(result.header),
  );
  report.viewports.push({ label, ...result });
  await page.screenshot({
    path: path.join(evidence, label + "-" + width + ".png"),
    fullPage: true,
  });
};
try {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    await ready();
    assert.deepEqual(await count(), {
      catalog: 1,
      subscriptions: 0,
      active: 0,
      saves: 0,
    });
    await layout("catalog", width);
    await page.getByRole("button", { name: /더 보기/ }).click();
    assert.equal(
      await page.locator(".history-dictionary-catalog-entry").count(),
      24,
    );
    assert.equal((await count()).catalog, 1);
    await page
      .getByRole("searchbox", { name: "단어·지명 찾기" })
      .fill("없는검증검색어");
    await page.getByText("검색 결과가 없습니다.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "전체 단어 보기" }).click();
    await choose();
    assert.equal(
      await page.getByRole("textbox", { name: "내가 이해한 뜻" }).inputValue(),
      "나라를 다스리기 위해 정한 법과 제도",
    );
    assert.equal((await count()).active, 1);
    await layout("notebook", width);
    await page
      .getByRole("textbox", { name: "내가 이해한 뜻" })
      .fill("수정 중인 뜻풀이");
    await page.getByRole("button", { name: "사전 찾기", exact: true }).click();
    await ready();
    assert.equal((await count()).active, 0);
    assert.equal(
      await page
        .getByRole("searchbox", { name: "단어·지명 찾기" })
        .inputValue(),
      "율령",
    );
    await notebook();
    await page.waitForFunction(
      () =>
        !document.querySelector(".history-dictionary-editor fieldset")
          ?.disabled,
    );
    assert.equal(
      await page.getByRole("textbox", { name: "내가 이해한 뜻" }).inputValue(),
      "수정 중인 뜻풀이",
    );
    report.passed.push(
      "responsive-" +
        width +
        " list/search/pagination/lazy-notebook/existing-definition/draft-and-filter-preservation",
    );
  }
  await page.goto(base);
  await ready();
  await page.evaluate(() => {
    window.dictionaryQa.failWords = 1;
  });
  await notebook();
  await page.getByRole("alert").filter({ hasText: "내 단어장" }).waitFor();
  assert.equal(
    await page
      .locator(".history-dictionary-editor fieldset")
      .evaluate((element) => element.disabled),
    true,
  );
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await page.locator(".history-dictionary-word").first().waitFor();
  assert.equal((await count()).subscriptions, 2);
  assert.equal((await count()).active, 1);
  await page
    .locator(".history-dictionary-word")
    .filter({ hasText: "율령" })
    .click();
  await page.evaluate(() => {
    window.dictionaryQa.failLookup = 1;
  });
  await page.getByRole("button", { name: "확인", exact: true }).click();
  await page.getByRole("button", { name: "다시 확인", exact: true }).click();
  await page
    .getByText("국가가 백성을 다스리기 위해 마련한 법과 행정 규정.", {
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("textbox", { name: "내가 이해한 뜻" })
    .fill("저장 실패 뒤에도 유지할 합성 초안");
  await page.evaluate(() => {
    window.dictionaryQa.failSave = 1;
  });
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await page.waitForFunction(() =>
    window.dictionaryQa.toasts.some((toast) => toast.title === "작업 실패"),
  );
  assert.equal(
    await page.getByRole("textbox", { name: "내가 이해한 뜻" }).inputValue(),
    "저장 실패 뒤에도 유지할 합성 초안",
  );
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await page.waitForFunction(() =>
    window.dictionaryQa.toasts.some((toast) => toast.title === "단어장 저장"),
  );
  assert.equal((await count()).saves, 2);
  await page.evaluate(() => window.dictionaryQa.emitWordsError());
  await page.getByRole("alert").filter({ hasText: "내 단어장" }).waitFor();
  assert.equal(await page.locator(".history-dictionary-word").count(), 0);
  assert.equal(
    await page
      .locator(".history-dictionary-editor fieldset")
      .evaluate((element) => element.disabled),
    true,
  );
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await page.locator(".history-dictionary-word").first().waitFor();
  report.passed.push(
    "notebook error/retry, teacher lookup retry, save error draft preservation, denied listener removes stale list",
  );
  await page.evaluate(() =>
    window.dictionaryQa.setAuth({
      currentUser: { uid: "student-b" },
      config: { year: "2026", semester: "1" },
    }),
  );
  await page.getByText("다른 학생의 저장 내용", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "단어", exact: true }).inputValue(),
    "",
  );
  assert.equal(
    await page.getByRole("textbox", { name: "내가 이해한 뜻" }).inputValue(),
    "",
  );
  assert.equal((await count()).active, 1);
  assert.ok(
    await page.evaluate(() => {
      const last = window.dictionaryQa.subscriptions.at(-1);
      return last.uid === "student-b" && last.semester === "1";
    }),
  );
  await page
    .locator(".history-dictionary-word")
    .filter({ hasText: "집현전" })
    .click();
  assert.equal(
    await page
      .locator(".history-dictionary-editor fieldset")
      .evaluate((element) => element.disabled),
    true,
  );
  await page
    .getByRole("heading", { name: "이전 학기 단어", exact: true })
    .waitFor();
  report.passed.push(
    "account/semester draft reset and scoped subscription; previous semester read-only",
  );
  await page.goto(base);
  await ready();
  await page.evaluate(() => {
    window.dictionaryQa.failCatalog = 1;
  });
  await notebook();
  await page.getByRole("button", { name: "사전 찾기", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "사전을 불러오지 못했습니다." })
    .waitFor();
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await ready();
  assert.equal((await count()).catalog, 3);
  assert.equal((await count()).active, 0);
  report.passed.push("catalog retry and server reauthorization on return");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/?floating=1");
  assert.deepEqual(await count(), {
    catalog: 0,
    subscriptions: 0,
    active: 0,
    saves: 0,
  });
  await page
    .getByRole("button", { name: "학습 도구 열기", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "역사 사전" }).click();
  await ready();
  await choose();
  await page
    .getByRole("textbox", { name: "내가 이해한 뜻" })
    .fill("팝업을 닫아도 유지되는 초안");
  await layout("floating", 390);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.dictionaryQa.active === 0);
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page
    .getByRole("button", { name: "학습 도구 열기", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "역사 사전" }).click();
  await page.waitForFunction(
    () =>
      window.dictionaryQa.active === 1 &&
      !document.querySelector(".history-dictionary-editor fieldset")?.disabled,
  );
  assert.equal(
    await page.getByRole("textbox", { name: "내가 이해한 뜻" }).inputValue(),
    "팝업을 닫아도 유지되는 초안",
  );
  assert.equal((await count()).catalog, 1);
  await page.keyboard.press("Escape");
  report.passed.push(
    "floating dialog lazy mount, Escape close/unsubscribe, reopen draft preservation, no hidden catalog read",
  );
  await page.goto(base);
  await ready();
  await page.evaluate(() => {
    window.dictionaryQa.delay = 300;
  });
  await notebook();
  await page.evaluate(() =>
    window.dictionaryQa.setAuth({
      currentUser: { uid: "student-b" },
      config: { year: "2026", semester: "1" },
    }),
  );
  await page.getByText("다른 학생의 저장 내용", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByText("나라를 다스리기 위해 정한 법과 제도", { exact: true })
      .count(),
    0,
  );
  assert.equal((await count()).active, 1);
  report.passed.push("late former-account response ignored");
  await page.goto(base);
  await ready();
  const rail = page.getByRole("navigation", { name: "사전 첫 글자" });
  await rail.locator('[data-history-initial=""]').press("End");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-history-initial="a-z"]')
        ?.getAttribute("aria-pressed") === "true",
  );
  await rail.locator('[data-history-initial="a-z"]').press("Home");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-history-initial=""]')
        ?.getAttribute("aria-pressed") === "true",
  );
  assert.equal((await count()).catalog, 1);
  await page.getByRole("searchbox", { name: "단어·지명 찾기" }).fill("율령");
  const termRow = page
    .locator(".history-dictionary-catalog-entry")
    .filter({ has: page.getByRole("heading", { name: "율령", exact: true }) });
  const questionLink = termRow.getByRole("link", {
    name: "율령 질문하기 (새 탭)",
  });
  const href = await questionLink.getAttribute("href");
  assert.ok(
    href.startsWith("/student/gongsinmoongo?sourceKind=dictionary&termId="),
  );
  assert.equal(await questionLink.getAttribute("target"), "_blank");
  const termId = new URL(href, base).searchParams.get("termId");
  await termRow.locator(".history-dictionary-sources summary").click();
  assert.ok((await termRow.locator(".history-dictionary-source").count()) > 0);
  assert.ok(
    (
      await termRow
        .locator(".history-dictionary-source a")
        .evaluateAll((links) =>
          links.map((link) => ({ target: link.target, rel: link.rel })),
        )
    ).every(
      (link) => link.target === "_blank" && link.rel.includes("noopener"),
    ),
  );
  await page.evaluate(
    (termId) =>
      window.dictionaryQa.navigate(
        "/student/lesson/history-dictionary?term=" + encodeURIComponent(termId),
      ),
    termId,
  );
  await page.evaluate(() =>
    window.dictionaryQa.navigate("/student/lesson/note?id=fixture"),
  );
  await page.getByRole("heading", { name: "합성 수업자료 화면" }).waitFor();
  await page.evaluate(() => window.dictionaryQa.navigate(-1));
  await ready();
  assert.equal(
    await page.getByRole("searchbox", { name: "단어·지명 찾기" }).inputValue(),
    "율령",
  );
  assert.equal((await count()).active, 0);
  report.passed.push(
    "initial rail Home/End keyboard; source disclosure/link safety; dictionary question context and deep link restored after route back",
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.network, []);
  report.pass = true;
} finally {
  await fs.writeFile(
    path.join(evidence, "browser-report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  JSON.stringify(
    {
      pass: report.pass,
      checks: report.passed,
      viewports: report.viewports.map((row) => ({
        label: row.label,
        width: row.width,
        scroll: row.scroll,
      })),
      evidence,
      liveWrites: 0,
    },
    null,
    2,
  ),
);
