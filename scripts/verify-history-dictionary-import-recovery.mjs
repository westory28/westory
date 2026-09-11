// Actual management UI and helper; synthetic workbook/parser and command I/O.
// This is not a real XLSX decoder or Firebase/server acceptance test.
import assert from "node:assert/strict";
import { build, transformSync } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const root = process.cwd(),
  output = mkdtempSync(join(tmpdir(), "westory-dictionary-import-"));
let checks = 0;
const module = { exports: {} },
  calls = [],
  pendingLookups = [],
  auth = { currentUser: { uid: "teacher-a" } };
class CommandError extends Error {
  constructor(reason, retryable = false, outcomeConfirmed = false) {
    super(reason);
    Object.assign(this, { reason, retryable, outcomeConfirmed });
  }
}
runInNewContext(
  transformSync(readFileSync("src/lib/historyDictionary.ts", "utf8"), {
    loader: "ts",
    format: "cjs",
  }).code,
  {
    module,
    exports: module.exports,
    TextEncoder,
    require: (name) =>
      name === "./firebase"
        ? {
            auth,
            db: {},
            getHttpsCallable: () => {
              throw Error("Retired callable used");
            },
          }
        : name === "./commandGateway"
          ? {
              executeWestoryCommand: async (type, payload, options) => {
                calls.push({ type, payload, options });
                return {
                  result: {
                    savedCount: payload.terms.length,
                    termIds: ["synthetic"],
                  },
                };
              },
              hasPendingWestoryCommand: async (type, payload, options) => {
                pendingLookups.push({ type, payload, options });
                return true;
              },
              WestoryCommandError: CommandError,
            }
          : name === "./semesterScope"
            ? {
                getYearSemester: (config) => ({
                  year: config.year,
                  semester: config.semester,
                }),
              }
            : name === "firebase/firestore"
              ? {}
              : (() => {
                  throw Error("Unmocked " + name);
                })(),
  },
);
const input = {
  terms: [
    {
      word: "고려",
      definition: "고려 시대의 설명입니다.",
      studentLevel: "중학생 수준",
      tags: ["역사"],
    },
  ],
};
assert.equal(
  (
    await module.exports.saveHistoryDictionaryTermsBulk(
      { year: "2026", semester: "2" },
      input,
      "teacher-a",
    )
  ).savedCount,
  1,
);
assert.equal(calls[0].type, "saveHistoryDictionaryTermsBulk");
assert.equal(calls[0].options.expectedUid, "teacher-a");
assert.equal(calls[0].payload.terms[0].relatedUnitId, "");
checks += 4;
assert.equal(
  await module.exports.hasPendingHistoryDictionaryImport(
    { year: "2026", semester: "2" },
    input,
    "teacher-a",
  ),
  true,
);
assert.deepEqual(pendingLookups[0], calls[0]);
assert.equal(calls.length, 1);
checks += 3;
auth.currentUser = { uid: "teacher-b" };
await assert.rejects(
  module.exports.saveHistoryDictionaryTermsBulk(
    { year: "2026", semester: "2" },
    input,
    "teacher-a",
  ),
);
assert.equal(calls.length, 1);
checks += 2;
await assert.rejects(
  module.exports.hasPendingHistoryDictionaryImport(
    { year: "2026", semester: "2" },
    input,
    "teacher-a",
  ),
);
assert.equal(pendingLookups.length, 1);
checks += 2;
await assert.rejects(
  module.exports.saveHistoryDictionaryTermsBulk(
    { year: "2026", semester: "2" },
    {
      terms: Array.from({ length: 200 }, (_, i) => ({
        word: "용어" + i,
        definition: "가".repeat(1200),
        studentLevel: "중학생 수준",
        tags: Array.from({ length: 12 }, () => "태".repeat(24)),
      })),
    },
    "teacher-b",
  ),
  /너무 큽니다/,
);
assert.equal(calls.length, 1);
checks += 2;
assert.equal(
  module.exports.isHistoryDictionaryImportUncertain(
    new CommandError("SESSION", true),
  ),
  true,
);
assert.equal(
  module.exports.isHistoryDictionaryImportConflict(
    new CommandError("HISTORY_DICTIONARY_BULK_CONFLICT", false, true),
  ),
  true,
);
assert.equal(
  module.exports.isHistoryDictionaryImportConflict(
    new CommandError("HISTORY_DICTIONARY_BULK_CONFLICT", true, false),
  ),
  false,
);
checks += 3;

const fixture = join(output, "fixture.tsx");
writeFileSync(
  fixture,
  `import {useSyncExternalStore} from '${root.replaceAll("\\", "/")}/node_modules/react/index.js';
let identity={currentUser:{uid:'teacher-a',email:'teacher-a@yongshin-ms.ms.kr'},userData:{role:'teacher'},config:{year:'2026',semester:'2'}};const listeners=new Set();
export const useAuth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>identity);
window.setIdentity=(uid,semester='2',role='teacher')=>{identity={...identity,currentUser:{uid,email:uid+'@yongshin-ms.ms.kr'},userData:{role},config:{year:'2026',semester}};listeners.forEach(fn=>fn());};
window.toasts=[];const showToast=toast=>window.toasts.push(toast);export const useAppToast=()=>({showToast});
let terms=[],termListeners=new Set();window.emitTerms=rows=>{terms=rows;termListeners.forEach(fn=>fn(terms));};
export const subscribeTeacherHistoryDictionaryTerms=cb=>{termListeners.add(cb);cb(terms);return()=>termListeners.delete(cb);};
export const subscribeTeacherHistoryDictionaryRequests=cb=>{cb([]);return()=>{};};
export const loadTeacherStudentHistoryDictionaryWords=async()=>[];export const loadNotifications=async()=>[];
window.failRefresh=false;window.refreshCalls=0;export const loadTeacherHistoryDictionaryTerms=async()=>{window.refreshCalls++;if(window.failRefresh)throw Error('Synthetic refresh failure');return terms;};
export const normalizeHistoryDictionaryWord=value=>String(value||'').trim().replace(/\\s+/g,' ').toLowerCase();
const importKey=async(config,input,uid)=>'synthetic:dictionary-pending:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({config,input,uid}))))).map(n=>n.toString(16).padStart(2,'0')).join('');
window.pendingLookupCalls=[];window.delayPendingLookup=false;const pendingLookups=[];window.pendingLookupCount=()=>pendingLookups.length;window.finishPendingLookup=()=>{const p=pendingLookups.shift();if(!p)throw Error('No pending lookup');p.resolve(p.result);};
export const hasPendingHistoryDictionaryImport=async(config,input,uid)=>{const key=await importKey(config,input,uid),result=localStorage.getItem(key)!==null;window.pendingLookupCalls.push({uid,year:config.year,semester:config.semester,result});if(window.delayPendingLookup)return new Promise(resolve=>pendingLookups.push({resolve,result}));return result;};
window.importCalls=[];const imports=[];export const saveHistoryDictionaryTermsBulk=(config,input,uid)=>{window.importCalls.push(structuredClone({config,input,uid}));return new Promise((resolve,reject)=>imports.push({resolve,reject,input,config,uid}));};
window.finishImport=async(mode='success')=>{const p=imports.shift();if(!p)throw Error('No pending import');const key=await importKey(p.config,p.input,p.uid);if(mode==='unknown')localStorage.setItem(key,JSON.stringify({uid:p.uid,year:p.config.year,semester:p.config.semester}));else localStorage.removeItem(key);if(mode==='success')p.resolve({savedCount:p.input.terms.length,termIds:['term-a']});else p.reject(Object.assign(Error('Synthetic '+mode),{uncertain:mode==='unknown',conflict:mode==='conflict'}));};
export const isHistoryDictionaryImportUncertain=e=>e?.uncertain===true;export const isHistoryDictionaryImportConflict=e=>e?.conflict===true;
const unexpected=()=>{throw Error('Unexpected non-bulk mutation')};export const saveHistoryDictionaryTerm=unexpected,approveHistoryDictionaryTermForRequests=unexpected,deleteStudentHistoryDictionaryWordByTeacher=unexpected,updateStudentHistoryDictionaryWordByTeacher=unexpected;
window.delayParse=false;const parses=[];window.pendingParses=()=>parses.length;window.finishParse=()=>{const p=parses.shift();if(!p)throw Error('No parse');p.resolve(p.rows);};
export default async function readWorkbook(file){const rows=JSON.parse(await file.text());if(window.delayParse)return new Promise(resolve=>parses.push({resolve,rows}));return rows;}
`,
);
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import Page from './src/pages/teacher/ManageHistoryDictionary';createRoot(document.getElementById('root')).render(<React.StrictMode><HashRouter><Page/></HashRouter></React.StrictMode>);`,
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
      name: "isolated-dictionary-io",
      setup(api) {
        api.onResolve(
          {
            filter:
              /AuthContext$|AppToastProvider$|\/lib\/historyDictionary$|\/lib\/notifications$|^read-excel-file\/browser$/,
          },
          () => ({ path: fixture }),
        );
      },
    },
  ],
});
assert.ok(
  !Object.keys(bundle.metafile.inputs).some((p) =>
    p.replaceAll("\\", "/").includes("node_modules/@firebase/"),
  ),
);
const css = readFileSync(
  join(
    "dist/assets",
    readdirSync("dist/assets").find((n) => /^main-.*\.css$/.test(n)),
  ),
);
const server = createServer((req, res) => {
  const p = req.url.split("?")[0];
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' data: blob:;connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'",
  );
  res.setHeader(
    "Content-Type",
    p === "/app.js"
      ? "text/javascript"
      : p === "/app.css"
        ? "text/css"
        : "text/html;charset=utf-8",
  );
  res.end(
    p === "/app.js"
      ? bundle.outputFiles[0].contents
      : p === "/app.css"
        ? css
        : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
const errors = [],
  results = [];
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  const origin = "http://127.0.0.1:" + server.address().port;
  await context.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(origin + "/")
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  let pageVersion = 0;
  const open = async () => {
    await page.goto(
      origin +
        "/?fixture=" +
        ++pageVersion +
        "#/teacher/history-dictionary?panel=upload",
    );
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage))
        if (key.startsWith("synthetic:dictionary-pending:"))
          localStorage.removeItem(key);
    });
    await button("Excel 파일 선택").waitFor();
  };
  const file = async (word = "고려") =>
    page.getByLabel("역사 사전 용어 Excel 파일 업로드").setInputFiles({
      name: "합성-검증.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(
        JSON.stringify([
          ["단어", "학생용 풀이", "관련 단원", "태그"],
          [word, "역사 사전 검증용 설명입니다.", "중세", "역사"],
        ]),
      ),
    });
  const ready = async () => {
    await page.waitForFunction(() =>
      window.toasts.some((t) => t.title === "Excel 파일을 불러왔습니다."),
    );
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some(
        (button) =>
          button.textContent.trim() === "등록하기" && !button.disabled,
      ),
    );
    assert.equal(await button("등록하기").isEnabled(), true);
    checks++;
  };
  for (const width of [390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await open();
    await file();
    await ready();
    await button("등록하기").click();
    await page.waitForFunction(() => window.importCalls.length === 1);
    await page.evaluate(() => window.finishImport("unknown"));
    await button("등록 결과 다시 확인").waitFor();
    assert.equal(await button("Excel 파일 선택").isDisabled(), true);
    assert.equal(await button("미리보기 비우기").isDisabled(), true);
    checks += 2;
    await page.evaluate(() =>
      window.emitTerms([
        {
          id: "term-a",
          word: "고려",
          normalizedWord: "고려",
          definition: "서버에 먼저 저장됨",
          status: "published",
        },
      ]),
    );
    await button("등록 결과 다시 확인").click();
    await page.waitForFunction(() => window.importCalls.length === 2);
    assert.deepEqual(
      await page.evaluate(() => window.importCalls[0]),
      await page.evaluate(() => window.importCalls[1]),
    );
    checks++;
    await page.evaluate(() => window.finishImport());
    await page.waitForFunction(() =>
      window.toasts.some((t) => t.title === "역사 사전 용어를 등록했습니다."),
    );
    assert.equal(await page.evaluate(() => window.refreshCalls), 1);
    assert.equal(
      await page.evaluate(() => window.importCalls[1].uid),
      "teacher-a",
    );
    checks += 2;
    await open();
    await file();
    await ready();
    await button("등록하기").click();
    await page.evaluate(() => window.finishImport("conflict"));
    await page.waitForFunction(
      () => window.toasts.at(-1)?.title === "중복 단어로 등록하지 않았습니다.",
    );
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some(
        (button) =>
          button.textContent.trim() === "미리보기 비우기" && !button.disabled,
      ),
    );
    assert.equal(await button("미리보기 비우기").isEnabled(), true);
    assert.equal(await button("Excel 파일 선택").isEnabled(), true);
    assert.equal(
      await page
        .getByText("일괄 등록 중 일부 항목을 저장하지 못했습니다.", {
          exact: true,
        })
        .count(),
      0,
    );
    checks += 3;
    await page.screenshot({
      path: join(output, "import-conflict-" + width + ".png"),
      fullPage: true,
    });
    await button("미리보기 비우기").click();
    assert.equal(await button("등록하기").isDisabled(), true);
    checks++;
    for (const change of ["account", "semester", "role"]) {
      await open();
      await file();
      await ready();
      await button("등록하기").click();
      await page.evaluate(
        (change) =>
          window.setIdentity(
            change === "account" ? "teacher-b" : "teacher-a",
            change === "semester" ? "1" : "2",
            change === "role" ? "student" : "teacher",
          ),
        change,
      );
      await page.evaluate(() => window.finishImport());
      await page.waitForTimeout(60);
      assert.equal(
        await page.evaluate(
          () =>
            window.toasts.filter(
              (t) => t.title === "역사 사전 용어를 등록했습니다.",
            ).length,
        ),
        0,
      );
      assert.equal(await page.evaluate(() => window.refreshCalls), 0);
      checks += 2;
      if (change !== "role") {
        await button("등록하기").waitFor();
        assert.equal(await button("등록하기").isDisabled(), true);
        checks++;
      }
    }
    await open();
    await page.evaluate(() => (window.delayParse = true));
    await file();
    await page.waitForFunction(() => window.pendingParses() === 1);
    await page.evaluate(() => window.setIdentity("teacher-b"));
    await page.evaluate(() => window.finishParse());
    await page.waitForTimeout(60);
    assert.equal(await button("등록하기").isDisabled(), true);
    assert.equal(await page.evaluate(() => window.toasts.length), 0);
    checks += 2;
    results.push({ width, passed: true });
  }

  const leaveUncertainImport = async () => {
    await open();
    await file();
    await ready();
    await button("등록하기").click();
    await page.waitForFunction(() => window.importCalls.length === 1);
    await page.evaluate(() => window.finishImport("unknown"));
    await button("등록 결과 다시 확인").waitFor();
    const retained = await page.evaluate(() =>
      Object.entries(localStorage).filter(([key]) =>
        key.startsWith("synthetic:dictionary-pending:"),
      ),
    );
    assert.equal(retained.length, 1);
    assert.ok(!JSON.stringify(retained).includes("고려"));
    checks += 2;
    await page.reload();
    await button("Excel 파일 선택").waitFor();
    await page.evaluate(() =>
      window.emitTerms([
        {
          id: "saved",
          word: "고려",
          normalizedWord: "고려",
          definition: "서버에 먼저 저장됨",
          status: "published",
        },
        {
          id: "other",
          word: "조선",
          normalizedWord: "조선",
          definition: "다른 등록 단어",
          status: "published",
        },
      ]),
    );
  };
  await leaveUncertainImport();
  await file();
  await button("등록 결과 다시 확인").waitFor();
  assert.equal(await button("등록 결과 다시 확인").isEnabled(), true);
  assert.equal(
    await page.evaluate(() => window.pendingLookupCalls.at(-1)?.result),
    true,
  );
  assert.equal(await page.evaluate(() => window.importCalls.length), 0);
  checks += 3;
  await button("등록 결과 다시 확인").click();
  await page.waitForFunction(() => window.importCalls.length === 1);
  await page.evaluate(() => window.finishImport());
  await page.waitForFunction(() =>
    window.toasts.some((t) => t.title === "역사 사전 용어를 등록했습니다."),
  );
  assert.equal(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith("synthetic:dictionary-pending:"),
        ).length,
    ),
    0,
  );
  checks++;

  for (const change of ["file", "account", "semester"]) {
    await leaveUncertainImport();
    if (change !== "file")
      await page.evaluate(
        (change) =>
          window.setIdentity(
            change === "account" ? "teacher-b" : "teacher-a",
            change === "semester" ? "1" : "2",
          ),
        change,
      );
    await file(change === "file" ? "조선" : "고려");
    await page.waitForFunction(() =>
      window.toasts.some((t) => t.title === "Excel 파일을 불러왔습니다."),
    );
    assert.equal(
      await page.evaluate(() => window.pendingLookupCalls.at(-1)?.result),
      false,
    );
    assert.equal(await button("등록하기").isDisabled(), true);
    assert.equal(await button("등록 결과 다시 확인").count(), 0);
    assert.equal(await page.evaluate(() => window.importCalls.length), 0);
    checks += 4;
  }

  await leaveUncertainImport();
  await page.evaluate(() => {
    window.delayPendingLookup = true;
  });
  await file();
  await page.waitForFunction(() => window.pendingLookupCount() === 1);
  await page.evaluate(() => window.setIdentity("teacher-b"));
  await page.evaluate(() => window.finishPendingLookup());
  await page.waitForTimeout(60);
  assert.equal(await button("등록 결과 다시 확인").count(), 0);
  assert.equal(await button("등록하기").isDisabled(), true);
  assert.equal(await page.evaluate(() => window.toasts.length), 0);
  checks += 3;

  await open();
  await file();
  await ready();
  await page.evaluate(() =>
    window.emitTerms([
      {
        id: "other",
        word: "고려",
        normalizedWord: "고려",
        status: "published",
      },
    ]),
  );
  await button("등록하기").click();
  assert.equal(await page.evaluate(() => window.importCalls.length), 0);
  checks++;
  await open();
  await file();
  await ready();
  await button("등록하기").click();
  await page.evaluate(() => {
    window.failRefresh = true;
    window.finishImport();
  });
  await page.waitForFunction(() =>
    window.toasts.some(
      (t) => t.title === "등록은 완료됐지만 목록 새로고침에 실패했습니다.",
    ),
  );
  assert.equal(await page.evaluate(() => window.importCalls.length), 1);
  checks++;
  assert.deepEqual(errors, []);
  const result = {
    suite: "history-dictionary-import-recovery",
    checks,
    results,
    errors,
    passed: true,
    network: "localhost synthetic fixture only",
    realXlsxDecoderOrFirebaseVerified: false,
    output,
  };
  writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
