// Actual ManageHistoryDictionary React UI; synthetic Auth and dictionary I/O.
// No Firebase, real students, real backend, production, or deployment acceptance.
// Baseline reproduction: --source-ref=<full git SHA> --expect-current-loss
// Default: regression expectations for the current working-tree UI.
// --prepare-only compiles the isolated fixture without starting a browser/server.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const expectLoss = args.includes("--expect-current-loss");
const prepareOnly = args.includes("--prepare-only");
const refArg = args.find((arg) => arg.startsWith("--source-ref="));
const sourceRef = refArg?.slice("--source-ref=".length) || "";
assert.ok(
  args.every(
    (arg) =>
      ["--expect-current-loss", "--prepare-only"].includes(arg) ||
      arg === refArg,
  ),
);
assert.equal(new Set(args).size, args.length);
assert.ok(!sourceRef || /^[0-9a-f]{40}$/.test(sourceRef));
const git = (...values) =>
  execFileSync("git", values, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
assert.equal(resolve(git("rev-parse", "--show-toplevel")), resolve(root));
const sourceHead = git("rev-parse", "HEAD");
const uiRelative = "src/pages/teacher/ManageHistoryDictionary.tsx";
const uiPath = resolve(root, uiRelative);
const source = sourceRef
  ? git("show", `${sourceRef}:${uiRelative}`)
  : readFileSync(uiPath, "utf8");
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const output = mkdtempSync(join(tmpdir(), "westory-dictionary-editor-"));
const fixturePath = join(output, "synthetic-io.tsx");
const studentTermId = (word) =>
  `term_${createHash("sha1").update(word.trim().replace(/\s+/g, " ").toLowerCase()).digest("hex")}`;
const canonicalStudentTermIds = Object.fromEntries(
  ["백제", "발해"].map((word) => [word, studentTermId(word)]),
);
let checks = 0;
const results = [],
  errors = [],
  blockedRequests = [];
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const ok = (actual, message) => {
  assert.ok(actual, message);
  checks++;
};

writeFileSync(
  fixturePath,
  `
import {useSyncExternalStore} from '${root.replaceAll("\\", "/")}/node_modules/react/index.js';
const clone=value=>JSON.parse(JSON.stringify(value));
let identity={currentUser:{uid:'teacher-a',email:'teacher-a@yongshin-ms.ms.kr'},userData:{role:'teacher'},config:{year:'2026',semester:'2'}};
const authListeners=new Set(),toastListeners=new Set(),termListeners=new Set(),requestListeners=new Set();
const staleTerms=[],staleRequests=[];
window.editorCalls=[];window.editorToasts=[];window.editorLoads=[];
const baseToast=toast=>window.editorToasts.push(clone(toast));let toast=baseToast;
export const useAuth=()=>useSyncExternalStore(fn=>{authListeners.add(fn);return()=>authListeners.delete(fn)},()=>identity);
export const useAppToast=()=>({showToast:useSyncExternalStore(fn=>{toastListeners.add(fn);return()=>toastListeners.delete(fn)},()=>toast)});
let data={
terms:[
{id:'term-a',word:'고려',normalizedWord:'고려',definition:'고려의 원래 역사 풀이입니다.',studentLevel:'중학생 수준',relatedUnitId:'원본단원',tags:['원본태그'],status:'published'},
{id:'term-b',word:'조선',normalizedWord:'조선',definition:'조선의 원래 역사 풀이입니다.',studentLevel:'중학생 수준',relatedUnitId:'다른단원',tags:['다른태그'],status:'published'}],
requests:[
{id:'request-a',uid:'student-a',word:'고려',normalizedWord:'고려',studentName:'합성 학생 가',grade:'2',class:'3',number:'1',memo:'첫 요청',status:'needs_approval',year:'2026',semester:'2'},
{id:'request-b',uid:'student-b',word:'조선',normalizedWord:'조선',studentName:'합성 학생 나',grade:'2',class:'3',number:'2',memo:'다른 요청',status:'needs_approval',year:'2026',semester:'2'}],
studentWords:[
{id:'student-a:term-c',uid:'student-a',termId:'term-c',requestId:'request-c',word:'백제',normalizedWord:'백제',definition:'백제의 원래 학생 풀이입니다.',tags:['학생태그'],studentName:'합성 학생 가',grade:'2',class:'3',number:'1',year:'2026',semester:'2',status:'saved',definitionSource:'student'},
{id:'student-b:term-d',uid:'student-b',termId:'term-d',requestId:'request-d',word:'발해',normalizedWord:'발해',definition:'발해의 원래 학생 풀이입니다.',tags:['다른학생태그'],studentName:'합성 학생 나',grade:'2',class:'3',number:'2',year:'2026',semester:'2',status:'saved',definitionSource:'student'}]};
if(new URLSearchParams(window.location.search).has('canonicalStudentIds'))data.studentWords=data.studentWords.map(item=>{const termId=${JSON.stringify(canonicalStudentTermIds)}[item.word];return {...item,id:item.uid+':'+termId,termId};});
let deferInitialSubscriptions=new URLSearchParams(window.location.search).has('deferInitialDictionary');
const emit=()=>{if(deferInitialSubscriptions)return;termListeners.forEach(fn=>fn(clone(data.terms)));requestListeners.forEach(fn=>fn(clone(data.requests)));};
// Student words currently use a one-shot load effect. A synthetic provider
// callback identity change re-runs that actual effect without remounting Page.
const pulseIO=()=>{toast=value=>baseToast(value);toastListeners.forEach(fn=>fn());};
export const subscribeTeacherHistoryDictionaryTerms=(fn)=>{termListeners.add(fn);if(!deferInitialSubscriptions)fn(clone(data.terms));return()=>{termListeners.delete(fn);staleTerms.push(fn);};};
export const subscribeTeacherHistoryDictionaryRequests=(fn)=>{requestListeners.add(fn);if(!deferInitialSubscriptions)fn(clone(data.requests));return()=>{requestListeners.delete(fn);staleRequests.push(fn);};};
const pendingLoads=[];window.deferEditorLoads=false;
export const loadTeacherStudentHistoryDictionaryWords=async(config)=>{window.editorLoads.push({type:'studentWords',config:clone(config),uid:identity.currentUser?.uid});const rows=clone(data.studentWords);if(window.deferEditorLoads)return new Promise(resolve=>pendingLoads.push({resolve,rows}));return rows;};
export const loadTeacherHistoryDictionaryTerms=async()=>clone(data.terms);
export const loadNotifications=async()=>[];
export const normalizeHistoryDictionaryWord=value=>String(value||'').trim().replace(/\\s+/g,' ').toLowerCase();
export const getHistoryDictionaryWriteVersion=value=>value?(value.writeVersion||'legacy'):null;
export const hasPendingHistoryDictionaryMutation=()=>false,isHistoryDictionaryMutationBusy=()=>false;
export const subscribeHistoryDictionaryMutation=()=>()=>{};
export const retryHistoryDictionaryMutation=async()=>{};
export const historyDictionaryMutationMessage=error=>error?.message||'입력 내용을 확인해 주세요.';
export const getPendingHistoryDictionaryDraft=()=>null;
const pending=[];
const mutation=(type,config,input,...options)=>{const index=window.editorCalls.length;window.editorCalls.push(clone({type,config,input,options,actor:identity.currentUser?.uid}));return new Promise((resolve,reject)=>pending.push({index,type,resolve,reject,input:clone(input)}));};
export const saveHistoryDictionaryTerm=(...args)=>mutation('save',...args);
export const updateStudentHistoryDictionaryWordByTeacher=(...args)=>mutation('student-save',...args);
export const approveHistoryDictionaryTermForRequests=(...args)=>mutation('approve',...args);
export const deleteStudentHistoryDictionaryWordByTeacher=(...args)=>mutation('delete',...args);
export const hasPendingHistoryDictionaryImport=async()=>false;
export const isHistoryDictionaryImportUncertain=()=>false,isHistoryDictionaryImportConflict=()=>false;
export const saveHistoryDictionaryTermsBulk=()=>{throw Error('Unexpected bulk import');};
export default async function readWorkbook(){throw Error('Unexpected workbook parser');}
window.editorFixture={
snapshot:()=>clone(data),
releaseInitialSubscriptions(){deferInitialSubscriptions=false;emit();},
refresh(collection,index=null,patch={}){data[collection]=clone(data[collection]);if(index!==null)data[collection][index]={...data[collection][index],...clone(patch)};if(collection==='studentWords')pulseIO();else emit();},
remove(collection,index){data[collection]=data[collection].filter((_,i)=>i!==index);if(collection==='studentWords')pulseIO();else emit();},
setIdentity(uid='teacher-b',semester='2',role='teacher'){data={terms:[],requests:[],studentWords:[]};identity={currentUser:{uid,email:uid+'@yongshin-ms.ms.kr'},userData:{role,...(role==='staff'?{staffPermissions:['lesson_read'],teacherPortalEnabled:true}:{})},config:{year:'2026',semester}};authListeners.forEach(fn=>fn());emit();},
deliverStale(rows,requests){staleTerms.forEach(fn=>fn(clone(rows)));staleRequests.forEach(fn=>fn(clone(requests)));},
pendingLoads:()=>pendingLoads.length,
finishLoads(){window.deferEditorLoads=false;for(const item of pendingLoads.splice(0))item.resolve(item.rows);},
finish(index=0,mode='success',result={}){const position=pending.findIndex(item=>item.index===index);if(position<0)throw Error('No pending mutation');const item=pending.splice(position,1)[0];if(mode==='success')item.resolve({...(item.type==='student-save'?{termId:item.input.termId,previousTermId:item.input.termId,updated:true}:{termId:item.input.termId||'term-a',resolvedCount:1}),...clone(result)});else item.reject(Error('Synthetic save failure'));},
pending:()=>pending.length
};
`,
);

const bundle = await build({
  stdin: {
    contents:
      "import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import Page from './src/pages/teacher/ManageHistoryDictionary';createRoot(document.getElementById('root')).render(<React.StrictMode><HashRouter><Page/></HashRouter></React.StrictMode>);",
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  metafile: true,
  define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
  plugins: [
    {
      name: "actual-ui-synthetic-editor-io",
      setup(api) {
        api.onResolve(
          {
            filter:
              /AuthContext$|AppToastProvider$|\/lib\/historyDictionary$|\/lib\/notifications$|^read-excel-file\/browser$/,
          },
          () => ({ path: fixturePath }),
        );
        api.onLoad({ filter: /ManageHistoryDictionary\.tsx$/ }, (args) =>
          resolve(args.path) === uiPath
            ? { contents: source, loader: "tsx", resolveDir: dirname(uiPath) }
            : null,
        );
      },
    },
  ],
});
ok(
  Object.keys(bundle.metafile.inputs).some((path) =>
    path.replaceAll("\\", "/").endsWith(uiRelative),
  ),
  "Actual management TSX must be bundled",
);
ok(
  !Object.keys(bundle.metafile.inputs).some((path) =>
    /node_modules\/(?:@firebase|firebase)\//.test(path.replaceAll("\\", "/")),
  ),
  "Firebase transport must not enter isolated browser bundle",
);
const cssName = readdirSync(join(root, "dist/assets")).find((name) =>
  /^main-.*\.css$/.test(name),
);
ok(
  cssName,
  "Existing build CSS is required; this script never builds/deploys the app",
);
const css = readFileSync(join(root, "dist/assets", cssName));
const provenance = {
  sourceHead,
  uiSourceRef: sourceRef || "working-tree",
  uiSourceSha256: sourceSha256,
  css: `dist/assets/${cssName}`,
};
const limitations = [
  "Real React management UI; Auth, subscriptions, reads and mutation completions are synthetic",
  "Student-word refresh re-runs the real load effect through a synthetic toast-provider identity change",
  "No real Firebase SDK transport, Rules, callable server, AppCheck or student data",
  "Existing dist CSS is used; this does not prove deployed source or full app integration",
];
if (prepareOnly) {
  console.log(
    JSON.stringify({
      suite: "history-dictionary-editor-recovery",
      prepared: true,
      checks,
      browserStarted: false,
      networkRequests: 0,
      provenance,
      limitations,
      output,
    }),
  );
} else {
  let browser, server, failure;
  let origin = "";
  const allowRequest = (raw) => {
    const url = new URL(raw);
    return (
      url.origin === origin &&
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      !url.username &&
      !url.password &&
      ["/", "/app.js", "/app.css", "/favicon.ico"].includes(url.pathname)
    );
  };
  try {
    server = createServer((req, res) => {
      const path = new URL(req.url, "http://127.0.0.1").pathname;
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self';worker-src 'none'",
      );
      if (
        req.method !== "GET" ||
        !["/", "/app.js", "/app.css", "/favicon.ico"].includes(path)
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (path === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }
      res.setHeader(
        "Content-Type",
        path === "/app.js"
          ? "text/javascript"
          : path === "/app.css"
            ? "text/css"
            : "text/html;charset=utf-8",
      );
      res.end(
        path === "/app.js"
          ? bundle.outputFiles[0].contents
          : path === "/app.css"
            ? css
            : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>',
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (allowRequest(url) && route.request().method() === "GET")
        return route.continue();
      const parsed = new URL(url);
      blockedRequests.push({ origin: parsed.origin, path: parsed.pathname });
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => errors.push(error.message));
    let confirmChoice = false,
      dialogs = 0,
      version = 0;
    page.on("dialog", async (dialog) => {
      dialogs++;
      if (confirmChoice) await dialog.accept();
      else await dialog.dismiss();
    });
    const fields = () => ({
      word: page.getByLabel("단어", { exact: true }),
      definition: page.getByPlaceholder(
        "학생 수준과 현재 수업 맥락에 맞게 풀이를 적어 주세요.",
      ),
      tagInput: page.getByPlaceholder("태그 입력 후 Enter"),
      related: page.getByPlaceholder("관련 단원 ID 또는 단원명"),
    });
    const button = (name) => page.getByRole("button", { name, exact: true });
    const row = (word) =>
      page
        .locator("aside")
        .getByRole("button")
        .filter({ has: page.getByText(word, { exact: true }) });
    const saveButton = () =>
      page.getByRole("button", {
        name: /^(풀이 저장 및 배포|학생 단어 수정 저장)$/,
      });
    const settle = async () => {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.waitForTimeout(35);
    };
    const panels = [
      {
        name: "terms",
        first: "고려",
        second: "조선",
        collection: "terms",
        sourceCollection: "terms",
      },
      {
        name: "requests",
        first: "고려",
        second: "조선",
        collection: "requests",
        sourceCollection: "terms",
      },
      {
        name: "studentWords",
        first: "백제",
        second: "발해",
        collection: "studentWords",
        sourceCollection: "studentWords",
      },
    ];
    const open = async (panel, query = "") => {
      confirmChoice = false;
      await page.goto(
        `${origin}/?fixture=${++version}${query}#/teacher/history-dictionary?panel=${panel.name}`,
      );
      await row(panel.first).waitFor();
      await row(panel.first).click();
      await fields().word.waitFor();
      await settle();
      eq(
        await fields().word.inputValue(),
        panel.first,
        "Selection seeds actual editor",
      );
    };
    const snapshotEditor = async () => ({
      word: await fields().word.inputValue(),
      definition: await fields().definition.inputValue(),
      tagInput: await fields().tagInput.inputValue(),
      related: await fields().related.inputValue(),
      tags: await page
        .getByRole("button", { name: / 태그 제거$/ })
        .evaluateAll((buttons) =>
          buttons.map((item) => item.getAttribute("aria-label")).sort(),
        ),
    });
    const writeDraft = async () => {
      await fields().word.fill("편집중인 역사 단어");
      await fields().definition.fill(
        "목록을 새로 받아도 보존해야 하는 교사의 편집 초안입니다.",
      );
      await fields().related.fill("편집중단원");
      await fields().tagInput.fill("완료태그");
      await fields().tagInput.press("Enter");
      await fields().tagInput.fill("아직 입력중인 태그");
      return snapshotEditor();
    };
    const refresh = async (collection, index = null, patch = {}) => {
      await page.evaluate(
        ({ collection, index, patch }) =>
          window.editorFixture.refresh(collection, index, patch),
        { collection, index, patch },
      );
      await settle();
    };
    const locked = async () => {
      const controls = page.getByRole("button", {
        name: /^(풀이 저장 및 배포|학생 단어 수정 저장|기존 풀이 승인|요청 삭제|단어 삭제)$/,
      });
      ok((await controls.count()) > 0);
      for (const control of await controls.all())
        eq(
          await control.isDisabled(),
          true,
          "Changed or removed target cannot be mutated",
        );
    };
    const noOldDraft = async (draft) => {
      if (await fields().word.count())
        ok(
          (await fields().word.inputValue()) !== draft.word,
          "Previous context draft must not remain",
        );
      ok(
        !(await page.locator("body").innerText()).includes("완료태그"),
        "Previous context tag must not remain",
      );
    };

    for (const width of [390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      for (const panel of panels) {
        await open(panel);
        const draft = await writeDraft();
        await refresh(panel.sourceCollection);
        const actual = await snapshotEditor();
        if (expectLoss) {
          ok(
            actual.word !== draft.word,
            "Baseline must reproduce actual word reset",
          );
          ok(
            actual.definition !== draft.definition,
            "Baseline must reproduce actual definition reset",
          );
          ok(
            actual.tagInput !== draft.tagInput,
            "Baseline must reproduce actual in-progress tag reset",
          );
          results.push({
            width,
            panel: panel.name,
            scenario:
              "baseline same-target equivalent source snapshot loses draft",
            reproduced: true,
            before: draft,
            after: actual,
          });
          await page.screenshot({
            path: join(output, `baseline-loss-${panel.name}-${width}.png`),
            fullPage: true,
          });
          continue;
        }
        eq(
          actual,
          draft,
          "Equivalent same-target snapshot preserves all five draft fields",
        );
        await refresh(panel.sourceCollection, 1, {
          definition: "다른 행의 새로운 풀이입니다.",
        });
        eq(
          await snapshotEditor(),
          draft,
          "Other-row update does not reset draft",
        );
        const dialogsBeforeSame = dialogs;
        await row(panel.first).click();
        await settle();
        eq(await snapshotEditor(), draft, "Same-row reclick preserves draft");
        eq(
          dialogs,
          dialogsBeforeSame,
          "Same-row reclick does not discard-confirm",
        );
        results.push({
          width,
          panel: panel.name,
          scenario: "same target and unrelated refresh preserve dirty editor",
          passed: true,
        });

        await refresh(panel.sourceCollection, 0, {
          definition: "서버에서 변경한 최신 역사 풀이입니다.",
          tags: ["서버태그"],
        });
        eq(
          await snapshotEditor(),
          draft,
          "Changed source preserves dirty editor",
        );
        await locked();
        const reload = page.getByRole("button", {
          name: /최신.*(불러오기|다시)/,
        });
        await reload.waitFor();
        confirmChoice = false;
        await reload.click();
        await settle();
        eq(await snapshotEditor(), draft, "Dismissing reload preserves draft");
        await locked();
        confirmChoice = true;
        await reload.click();
        await settle();
        eq(
          await fields().definition.inputValue(),
          "서버에서 변경한 최신 역사 풀이입니다.",
        );
        eq(await fields().tagInput.inputValue(), "");
        eq(await saveButton().isEnabled(), true);
        results.push({
          width,
          panel: panel.name,
          scenario: "changed source locks writes until confirmed reload",
          passed: true,
        });

        await writeDraft();
        const beforeOther = await snapshotEditor();
        confirmChoice = false;
        await row(panel.second).click();
        await settle();
        eq(
          await snapshotEditor(),
          beforeOther,
          "Dismissed explicit different-row selection preserves draft",
        );
        confirmChoice = true;
        await row(panel.second).click();
        await settle();
        eq(await fields().word.inputValue(), panel.second);
        eq(await fields().tagInput.inputValue(), "");
        results.push({
          width,
          panel: panel.name,
          scenario:
            "explicit different-row selection confirms draft replacement",
          passed: true,
        });

        await open(panel);
        await refresh(panel.sourceCollection, 0, {
          definition: "수정 전에는 자동 반영되는 최신 풀이입니다.",
        });
        eq(
          await fields().definition.inputValue(),
          "수정 전에는 자동 반영되는 최신 풀이입니다.",
        );
        const removedDraft = await writeDraft();
        await page.evaluate(
          ({ collection }) => window.editorFixture.remove(collection, 0),
          panel,
        );
        await settle();
        eq(
          await snapshotEditor(),
          removedDraft,
          "Deleted selected ID preserves draft instead of selecting another row",
        );
        await locked();
        await saveButton().evaluate((control) => control.click());
        eq(
          await page.evaluate(() => window.editorCalls.length),
          0,
          "Missing student target must not fall through into a global dictionary save",
        );
        results.push({
          width,
          panel: panel.name,
          scenario:
            "pristine updates; removed target keeps draft and locks writes",
          passed: true,
        });

        for (const change of [
          "account",
          "semester",
          "permission",
          "write-permission",
        ]) {
          await open(panel);
          const contextDraft = await writeDraft();
          const stale = await page.evaluate(() =>
            window.editorFixture.snapshot(),
          );
          await page.evaluate(
            (change) =>
              window.editorFixture.setIdentity(
                change === "account" ? "teacher-b" : "teacher-a",
                change === "semester" ? "1" : "2",
                change === "permission"
                  ? "student"
                  : change === "write-permission"
                    ? "staff"
                    : "teacher",
              ),
            change,
          );
          await settle();
          await noOldDraft(contextDraft);
          await page.evaluate(
            (stale) =>
              window.editorFixture.deliverStale(stale.terms, stale.requests),
            stale,
          );
          await settle();
          await noOldDraft(contextDraft);
          eq(
            await row(panel.first).count(),
            0,
            "Stale callbacks must not restore a prior context row",
          );
          eq(await page.evaluate(() => window.editorCalls.length), 0);
          if (change === "permission") eq(await saveButton().count(), 0);
          results.push({
            width,
            panel: panel.name,
            scenario: `${change} resets draft and ignores stale source callbacks`,
            passed: true,
          });
        }

        await open(panel);
        const savingDraft = await writeDraft();
        await saveButton().evaluate((control) => {
          control.click();
          control.click();
        });
        await page.waitForFunction(() => window.editorCalls.length > 0);
        eq(
          await page.evaluate(() => window.editorCalls.length),
          1,
          "Synchronous double click produces one mutation",
        );
        const call = await page.evaluate(() => window.editorCalls[0]);
        eq(call.input.word, savingDraft.word);
        eq(call.input.definition, savingDraft.definition);
        eq(call.config.semester, "2");
        eq(call.actor, "teacher-a");
        await page.evaluate(() =>
          window.editorFixture.setIdentity("teacher-b"),
        );
        await settle();
        await page.evaluate(() => window.editorFixture.finish());
        await settle();
        await noOldDraft(savingDraft);
        eq(
          await page.evaluate(
            () =>
              window.editorToasts.filter((toast) => toast.tone === "success")
                .length,
          ),
          0,
          "Late response must not notify a different owner",
        );
        results.push({
          width,
          panel: panel.name,
          scenario: "double-submit suppression and late save owner isolation",
          passed: true,
        });

        await open(panel);
        await writeDraft();
        await saveButton().click();
        await page.waitForFunction(() => window.editorCalls.length === 1);
        const editable = [];
        for (const [name, control] of Object.entries(fields()))
          if (await control.isEditable()) editable.push(name);
        for (const name of editable)
          await fields()[name].fill(
            name === "definition"
              ? "저장 응답을 기다리는 동안 새로 작성한 다음 초안입니다."
              : "저장 중 다음 입력",
          );
        const duringSave = await snapshotEditor();
        await page.evaluate(() => window.editorFixture.finish());
        await settle();
        const afterSave = await snapshotEditor();
        for (const name of editable)
          eq(
            afterSave[name],
            duringSave[name],
            "Editable input entered after submission must survive completion",
          );
        results.push({
          width,
          panel: panel.name,
          scenario: "save locks fields or preserves the newer input generation",
          fieldsLocked: editable.length === 0,
          passed: true,
        });
      }
      await page.screenshot({
        path: join(output, `editor-final-${width}.png`),
        fullPage: true,
      });
      ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        "Viewport has no page-level horizontal overflow",
      );
    }
    if (!expectLoss) {
      // The complete asynchronous mutation matrix runs once at desktop width;
      // the three editor paths and primary recovery states above run at all four.
      await page.setViewportSize({ width: 1280, height: 950 });
      confirmChoice = false;
      await page.goto(
        `${origin}/?fixture=${++version}&deferInitialDictionary=1#/teacher/history-dictionary?panel=requests&requestId=request-b`,
      );
      await page.waitForFunction(() => Boolean(window.editorFixture));
      await settle();
      eq(
        await row("조선").count(),
        0,
        "The fixed request URL initially has no delivered subscription row",
      );
      await page.evaluate(() =>
        window.editorFixture.releaseInitialSubscriptions(),
      );
      await row("조선").waitFor();
      await settle();
      eq(
        await fields().word.inputValue(),
        "조선",
        "Initial async delivery selects the URL request rather than the first request",
      );
      eq(
        await fields().definition.inputValue(),
        "조선의 원래 역사 풀이입니다.",
      );
      eq(
        await saveButton().isEnabled(),
        true,
        "Initial pending-to-loaded source is normally editable",
      );
      eq(
        await page
          .getByText("선택한 항목을 목록에서 확인할 수 없습니다.", {
            exact: true,
          })
          .count(),
        0,
      );
      eq(await page.evaluate(() => window.editorToasts), []);
      results.push({
        width: 1280,
        scenario:
          "fixed request URL with delayed initial subscriptions becomes normally editable",
        passed: true,
      });

      await open(panels[1]);
      const closedDraft = await writeDraft();
      await refresh("requests", 0, {
        status: "resolved",
        resolvedTermId: "term-a",
      });
      eq(
        await snapshotEditor(),
        closedDraft,
        "Closed request must not select the next student's request",
      );
      await locked();
      await saveButton().evaluate((control) => control.click());
      eq(await page.evaluate(() => window.editorCalls.length), 0);
      results.push({
        width: 1280,
        scenario:
          "closed request keeps selected draft without another student or mutation",
        passed: true,
      });

      await open(panels[0]);
      const tabDraft = await writeDraft();
      const requestsTab = page
        .getByRole("button", { name: /^학생 요청 단어/ })
        .first();
      confirmChoice = false;
      await requestsTab.click();
      await settle();
      eq(
        await snapshotEditor(),
        tabDraft,
        "Tab change dismissal preserves current editor",
      );
      confirmChoice = true;
      await requestsTab.click();
      await settle();
      ok((await fields().word.inputValue()) !== tabDraft.word);
      results.push({
        width: 1280,
        scenario: "explicit tab transition confirms draft replacement",
        passed: true,
      });

      for (const change of [
        "account",
        "semester",
        "permission",
        "write-permission",
      ]) {
        await open(panels[2]);
        const readDraft = await writeDraft();
        await page.evaluate(() => {
          window.deferEditorLoads = true;
          window.editorFixture.refresh("studentWords");
        });
        await page.waitForFunction(
          () => window.editorFixture.pendingLoads() > 0,
        );
        await page.evaluate(
          (change) =>
            window.editorFixture.setIdentity(
              change === "account" ? "teacher-b" : "teacher-a",
              change === "semester" ? "1" : "2",
              change === "permission"
                ? "student"
                : change === "write-permission"
                  ? "staff"
                  : "teacher",
            ),
          change,
        );
        await settle();
        await page.evaluate(() => window.editorFixture.finishLoads());
        await settle();
        await noOldDraft(readDraft);
        eq(
          await row(panels[2].first).count(),
          0,
          "Late read cannot restore prior context student words",
        );
        results.push({
          width: 1280,
          scenario: `${change} ignores a late student-word read`,
          passed: true,
        });
      }

      for (const mode of ["rename", "definition-only"]) {
        await open(panels[2], "&canonicalStudentIds=1");
        const initial = await page.evaluate(
          () => window.editorFixture.snapshot().studentWords[0],
        );
        eq(initial.termId, studentTermId("백제"));
        const finalWord = mode === "rename" ? "가야" : initial.word;
        const finalTermId = studentTermId(finalWord);
        eq(finalTermId === initial.termId, mode === "definition-only");
        const studentMetadata = () =>
          page
            .getByText(/2학년\s+3반\s+1번\s*·\s*합성 학생 가/)
            .allTextContents();
        const originalMetadata = await studentMetadata();
        ok(
          originalMetadata.length > 0,
          "The selected student's identifying metadata is visible",
        );
        await fields().word.fill(finalWord);
        await fields().definition.fill(
          "정상 저장 후 최신 조회가 와도 계속 편집할 수 있는 학생 풀이입니다.",
        );
        await fields().related.fill("저장하지 않은 단원 초안");
        await fields().tagInput.fill("저장하지 않은 태그");
        await fields().tagInput.press("Enter");
        await fields().tagInput.fill("작성 중인 태그 초안");
        let previousTermId = initial.termId;
        for (let index = 0; index < 2; index++) {
          if (index)
            await fields().definition.fill(
              "최신 응답을 확인한 뒤 이어서 저장하는 두 번째 학생 풀이입니다.",
            );
          const draft = await snapshotEditor();
          await saveButton().click();
          await page.waitForFunction(
            (count) => window.editorCalls.length === count,
            index + 1,
          );
          const call = await page.evaluate(
            (index) => window.editorCalls[index],
            index,
          );
          eq(call.type, "student-save");
          eq(call.input.uid, initial.uid);
          eq(call.input.termId, previousTermId);
          eq(call.input.year, initial.year);
          eq(call.input.semester, initial.semester);
          eq(call.actor, "teacher-a");
          eq(call.input.word, finalWord);
          eq(call.input.definition, draft.definition);
          // Real server response shape: renamed words return a new SHA1 term ID,
          // while a definition-only update returns the existing ID.
          await page.evaluate(
            ({ index, termId, previousTermId }) =>
              window.editorFixture.finish(index, "success", {
                termId,
                previousTermId,
                updated: true,
              }),
            { index, termId: finalTermId, previousTermId },
          );
          await settle();
          eq(
            await snapshotEditor(),
            draft,
            "Success must not discard unsaved tag/unit input",
          );
          const echo = {
            ...initial,
            id: `${initial.uid}:${finalTermId}`,
            termId: finalTermId,
            word: finalWord,
            normalizedWord: finalWord,
            definition: draft.definition,
            status: "saved",
            definitionSource: "teacher_reviewed",
          };
          await refresh("studentWords", 0, echo);
          eq(
            await snapshotEditor(),
            draft,
            "Matching latest echo preserves the editor and local tag drafts",
          );
          eq(
            await studentMetadata(),
            originalMetadata,
            "Rename/definition save preserves the displayed student metadata",
          );
          eq(
            await saveButton().isEnabled(),
            true,
            "A normal matching echo must allow the next student save",
          );
          eq(
            await page
              .getByRole("button", {
                name: "최신 내용 다시 불러오기",
                exact: true,
              })
              .count(),
            0,
            "A normal own echo is not a source conflict",
          );
          eq(await page.evaluate(() => window.editorCalls.length), index + 1);
          previousTermId = finalTermId;
        }
        eq(
          await page.evaluate(
            () =>
              window.editorToasts.filter((toast) => toast.tone === "success")
                .length,
          ),
          2,
        );
        results.push({
          width: 1280,
          scenario: `normal student ${mode} uses server term ID, preserves metadata/tag drafts and allows another save after latest echo`,
          passed: true,
        });
      }

      await open(panels[2]);
      const deletingDraft = await writeDraft();
      confirmChoice = true;
      await button("단어 삭제").click();
      await page.waitForFunction(() => window.editorCalls.length === 1);
      const deletingCall = await page.evaluate(() => window.editorCalls[0]);
      eq(deletingCall.type, "delete");
      eq(deletingCall.input.requestId, "request-c");
      await refresh("studentWords", 0, {
        requestId: "newer-request-c-after-delete",
        studentName: "갱신된 합성 학생 가",
        memo: "삭제 요청 이후 도착한 새 요청의 메모",
        definition: "삭제 요청 이후 같은 ID에 저장된 최신 학생 풀이입니다.",
      });
      await page.evaluate(
        (input) =>
          window.editorFixture.finish(0, "success", {
            termId: input.termId,
            requestId: input.requestId,
            deleted: true,
            reward: { reclaimed: false, amount: 0 },
          }),
        deletingCall.input,
      );
      await settle();
      eq(
        await row("백제").count(),
        1,
        "Late delete success must not remove the newer same-ID row",
      );
      ok(
        (await row("백제").innerText()).includes("갱신된 합성 학생 가"),
        "The latest same-ID row metadata remains visible",
      );
      eq(
        await snapshotEditor(),
        deletingDraft,
        "Late delete success preserves the existing edit draft",
      );
      await locked();
      const reloadAfterDelete = page.getByRole("button", {
        name: "최신 내용 다시 불러오기",
        exact: true,
      });
      eq(
        await reloadAfterDelete.isEnabled(),
        true,
        "The newer live row remains available for explicit reload",
      );
      await saveButton().evaluate((control) => control.click());
      eq(
        await page.evaluate(() => window.editorCalls.length),
        1,
        "The preserved changed target stays locked until explicit reload",
      );
      results.push({
        width: 1280,
        scenario:
          "late delete success preserves a newer same-ID student request and metadata, draft and reloadable write lock",
        passed: true,
      });

      for (const bindingChange of [
        {
          name: "request UID",
          panel: panels[1],
          collection: "requests",
          patch: { uid: "student-b" },
        },
        {
          name: "request semester",
          panel: panels[1],
          collection: "requests",
          patch: { semester: "1" },
        },
        {
          name: "student-word requestId",
          panel: panels[2],
          collection: "studentWords",
          patch: { requestId: "newer-request-c" },
        },
      ]) {
        await open(bindingChange.panel);
        const submittedDefinition =
          "저장한 본문과 같아도 요청 대상 변경은 승인하지 않아야 합니다.";
        await fields().definition.fill(submittedDefinition);
        const submittedDraft = await snapshotEditor();
        await saveButton().click();
        await page.waitForFunction(() => window.editorCalls.length === 1);
        eq(
          await page.evaluate(() => window.editorCalls[0].input.definition),
          submittedDefinition,
        );
        // Keep the live source's editable fields identical to the submitted
        // draft. Only the request/student binding changes while save is pending.
        if (bindingChange.collection === "requests") {
          await refresh("terms", 0, { definition: submittedDefinition });
          await refresh("requests", 0, bindingChange.patch);
        } else {
          await refresh("studentWords", 0, {
            ...bindingChange.patch,
            definition: submittedDefinition,
          });
        }
        await page.evaluate(() => window.editorFixture.finish());
        await settle();
        eq(
          await snapshotEditor(),
          submittedDraft,
          "Save acknowledgement must preserve the draft after binding change",
        );
        await locked();
        await saveButton().evaluate((control) => control.click());
        eq(
          await page.evaluate(() => window.editorCalls.length),
          1,
          "Matching response text must not unlock another request binding",
        );
        results.push({
          width: 1280,
          scenario: `save acknowledgement cannot accept changed ${bindingChange.name} with identical submitted text`,
          passed: true,
        });
      }

      await open(panels[1]);
      await refresh("requests", 0, { status: "requested" });
      const resolvedDefinition =
        "현재 요청의 저장 완료는 허용하되 닫힌 요청은 다시 변경하지 않습니다.";
      await fields().definition.fill(resolvedDefinition);
      await saveButton().click();
      await page.waitForFunction(() => window.editorCalls.length === 1);
      await refresh("terms", 0, { definition: resolvedDefinition });
      await refresh("requests", 0, {
        status: "resolved",
        matchedTermId: "term-a",
        resolvedTermId: "term-a",
      });
      await page.evaluate(() => window.editorFixture.finish());
      await settle();
      eq(
        await page.evaluate(
          () =>
            window.editorToasts.filter((toast) => toast.tone === "success")
              .length,
        ),
        1,
        "The same request's own resolved status may acknowledge successful save",
      );
      eq(await fields().definition.inputValue(), resolvedDefinition);
      await locked();
      await saveButton().evaluate((control) => control.click());
      eq(
        await page.evaluate(() => window.editorCalls.length),
        1,
        "Resolved request remains closed to subsequent mutation",
      );
      results.push({
        width: 1280,
        scenario:
          "own requested-to-resolved save acknowledges once and keeps closed mutations locked",
        passed: true,
      });

      const mutationSpecs = [
        {
          name: "global-save",
          panel: panels[0],
          button: "풀이 저장 및 배포",
          edit: true,
        },
        {
          name: "student-save",
          panel: panels[2],
          button: "학생 단어 수정 저장",
          edit: true,
        },
        { name: "approve", panel: panels[1], button: "기존 풀이 승인" },
        { name: "request-delete", panel: panels[1], button: "요청 삭제" },
        { name: "student-delete", panel: panels[2], button: "단어 삭제" },
      ];
      const startMutation = async (spec) => {
        await open(spec.panel);
        if (spec.edit) await writeDraft();
        confirmChoice = true;
        await button(spec.button).evaluate((control) => {
          control.click();
          control.click();
        });
        await page.waitForFunction(() => window.editorCalls.length > 0);
        eq(
          await page.evaluate(() => window.editorCalls.length),
          1,
          "Every mutation guards a same-tick second click",
        );
      };
      for (const spec of mutationSpecs) {
        for (const mode of ["success", "error"]) {
          for (const change of [
            "account",
            "semester",
            "permission",
            "write-permission",
          ]) {
            await startMutation(spec);
            await page.evaluate(
              (change) =>
                window.editorFixture.setIdentity(
                  change === "account" ? "teacher-b" : "teacher-a",
                  change === "semester" ? "1" : "2",
                  change === "permission"
                    ? "student"
                    : change === "write-permission"
                      ? "staff"
                      : "teacher",
                ),
              change,
            );
            await settle();
            const beforeWord = (await fields().word.count())
              ? await fields().word.inputValue()
              : null;
            await page.evaluate(
              (mode) => window.editorFixture.finish(0, mode),
              mode,
            );
            await settle();
            eq(
              (await fields().word.count())
                ? await fields().word.inputValue()
                : null,
              beforeWord,
              "Late completion cannot change another context editor",
            );
            eq(
              await row(spec.panel.first).count(),
              0,
              "Late mutation cannot restore its source row",
            );
            eq(
              await page.evaluate(() => window.editorToasts),
              [],
              "Late success/error cannot notify the next context",
            );
            eq(await page.evaluate(() => window.editorCalls.length), 1);
            results.push({
              width: 1280,
              mutation: spec.name,
              scenario: `late ${mode} after ${change} is ignored`,
              passed: true,
            });
          }
          await startMutation(spec);
          await page.evaluate(() =>
            window.editorFixture.setIdentity("teacher-b"),
          );
          await settle();
          confirmChoice = true;
          await page
            .getByRole("button", { name: /^등록된 단어/ })
            .first()
            .click();
          await page
            .getByRole("button", { name: /새 풀이/ })
            .first()
            .click();
          await settle();
          const newDraft = await writeDraft();
          await saveButton().click();
          await page.waitForFunction(() => window.editorCalls.length === 2);
          await page.evaluate(
            (mode) => window.editorFixture.finish(0, mode),
            mode,
          );
          await settle();
          eq(
            await snapshotEditor(),
            newDraft,
            "Old finally cannot change the new owner's draft",
          );
          eq(
            await saveButton().isDisabled(),
            true,
            "Old finally cannot release a newer in-flight mutation",
          );
          eq(await page.evaluate(() => window.editorToasts), []);
          await page.evaluate(() => window.editorFixture.finish(1));
          await settle();
          eq(
            await page.evaluate(
              () =>
                window.editorToasts.filter((toast) => toast.tone === "success")
                  .length,
            ),
            1,
          );
          results.push({
            width: 1280,
            mutation: spec.name,
            scenario: `late ${mode} finally does not unlock a newer owner save`,
            passed: true,
          });
        }
      }
    }
    eq(errors, []);
    eq(blockedRequests, []);
  } catch (error) {
    failure = { name: error.name, message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    await browser?.close();
    if (server?.listening)
      await new Promise((resolve) => server.close(resolve));
    const result = {
      suite: "history-dictionary-editor-recovery",
      passed: !failure,
      mode: expectLoss ? "baseline-loss-reproduction" : "regression",
      checks,
      results,
      errors,
      blockedRequests,
      failure,
      provenance,
      limitations,
      network: "exact ephemeral 127.0.0.1 origin only",
      realFirebaseOrServerVerified: false,
      output,
    };
    writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
}
