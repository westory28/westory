// Exercise the actual memo UI with delayed/failing writes and account changes.
// Synthetic data only; this browser has no Firebase or external network access.
import assert from "node:assert/strict";
import { build, transformSync } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const root = process.cwd();
const output = mkdtempSync(join(tmpdir(), "westory-memo-recovery-"));
let checks = 0;
const writes = [];
const module = { exports: {} };
runInNewContext(transformSync(readFileSync("src/lib/teacherPatchNotes.ts", "utf8"), { loader: "ts", format: "cjs" }).code, {
  module, exports: module.exports,
  require: name => name === "./firebase" ? { db: {}, auth: { currentUser: { uid: "teacher-a" } } } : name === "./commandGateway" ? {
    executeWestoryCommand: async (type, payload) => { writes.push({ type, payload }); return { result: { noteId: "note-a", noteRevision: 2 } }; },
    WestoryCommandError: Error,
  } : {},
});
await module.exports.updateTeacherPatchNote("teacher-a", "note-a", 1, {
  body: "수정한 내용", type: "bug", priority: "normal", sourcePath: "/teacher", status: "open",
});
assert.equal(writes[0].type, "updateTeacherPatchNote");
assert.equal(writes[0].payload.content.body, "수정한 내용");
assert.equal(writes[0].payload.expectedNoteRevision, 1);
assert.equal(Object.hasOwn(writes[0].payload.content, "status"), false);
await module.exports.updateTeacherPatchNoteStatus("teacher-a", { id: "note-a", noteRevision: 2 }, "done");
assert.equal(writes[1].payload.status, "done");
assert.equal(writes[1].payload.expectedNoteRevision, 2);
checks += 6;
await module.exports.createTeacherPatchNote("teacher-a", { body: "생성", type: "bug", priority: "normal", sourcePath: "/teacher" });
assert.equal(writes[2].type, "createTeacherPatchNote");
assert.equal(Object.hasOwn(writes[2].payload.content, "ownerUid"), false);
await module.exports.deleteTeacherPatchNote("teacher-a", { id: "note-a", noteRevision: 3 });
assert.equal(writes[3].payload.expectedNoteRevision, 3);
await assert.rejects(module.exports.deleteTeacherPatchNote("teacher-b", { id: "note-a", noteRevision: 3 }));
assert.equal(writes.length, 4); checks += 5;

const fixture = join(output, "fixture.tsx");
writeFileSync(fixture, `import React, {useSyncExternalStore} from '${root.replaceAll("\\", "/")}/node_modules/react/index.js';
let identity={currentUser:{uid:'teacher-a',email:'teacher-a@example.test'},userData:{role:'teacher'}};
const listeners=new Set(); const pending=[]; window.memoCalls=[]; window.memoToasts=[];
window.memoIdentity=(uid,role='teacher')=>{identity={currentUser:uid?{uid,email:uid+'@example.test'}:null,userData:{role}}; listeners.forEach(fn=>fn());};
window.memoFinish=(ok=true)=>{const next=pending.shift();if(!next)throw Error('No pending write');const error=Object.assign(Error(ok==='conflict'?'다른 화면에서 메모가 변경되었습니다.':'Synthetic connection failure'),{state:ok==='uncertain'?'retryable':ok==='conflict'?'conflict':'failed'});ok===true?next.resolve({noteRevision:2}):next.reject(error);};
export const useAuth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>identity);
const showToast=value=>window.memoToasts.push(value);export const useAppToast=()=>({showToast});
export const subscribeTeacherPatchNotes=(uid,onChange,onError)=>{window.memoSubscribeCount=(window.memoSubscribeCount||0)+1;window.memoLoadError=()=>{onError(Error('Synthetic subscription failure'));onChange([]);};window.memoEmit=(revision=1)=>onChange([{id:'note-a',ownerUid:uid,noteRevision:revision,body:'기존 메모 '+uid,type:'bug',priority:'normal',status:'open',sourcePath:'/teacher'}]);window.memoEmit();return()=>{};};
export const isPatchNoteResultUncertain=error=>error?.state==='retryable';
export const isPatchNoteResultConfirmedFailure=error=>error?.state==='conflict';
const write=(kind,args)=>{window.memoCalls.push({kind,args});return new Promise((resolve,reject)=>pending.push({resolve,reject}));};
export const createTeacherPatchNote=(...args)=>write('create',args);
export const updateTeacherPatchNote=(...args)=>write('update',args);
export const updateTeacherPatchNoteStatus=(...args)=>write('status',args);
export const deleteTeacherPatchNote=(...args)=>write('delete',args);`);
const result = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import Memo from './src/components/common/TeacherPatchMemoController';createRoot(document.getElementById('root')).render(<HashRouter><h1>패치 메모 복구 확인</h1><Memo/></HashRouter>);`, resolveDir: root, loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", metafile: true,
  define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
  plugins: [{ name: "isolated-memo-fixture", setup(api) {
    api.onResolve({ filter: /AuthContext$|AppToastProvider$|\/lib\/teacherPatchNotes$/ }, () => ({ path: fixture }));
  } }],
});
assert.ok(!Object.keys(result.metafile.inputs).some(path => path.includes("node_modules/@firebase/")));
const cssFile = readdirSync("dist/assets").find(name => /^main-.*\.css$/.test(name));
const css = readFileSync(join("dist/assets", cssFile), "utf8");
const server = createServer((req, res) => {
  res.setHeader("Content-Security-Policy", "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'");
  res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : req.url === "/app.css" ? "text/css" : "text/html");
  res.end(req.url === "/app.js" ? result.outputFiles[0].contents : req.url === "/app.css" ? css : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  for (const width of [390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}/?width=${width}#/teacher/lesson`);
    await page.screenshot({ path: join(output, `initial-${width}.png`) });
    await page.getByRole("button", { name: "패치 메모 열기", exact: true }).click();
    const body = page.getByRole("textbox", { name: "메모", exact: true });
    const draft = "연결이 끊겨도 남아야 하는 작성 중 메모";
    await body.fill(draft);
    await page.getByRole("button", { name: "패치 메모 닫기", exact: true }).first().click();
    await page.getByRole("button", { name: "패치 메모 열기", exact: true }).click();
    assert.equal(await body.inputValue(), draft); checks++;
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: /기존 메모 teacher-a/ }).click();
    assert.equal(await body.inputValue(), draft); checks++;
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "패치 메모 열기", exact: true }).click();
    assert.equal(await body.inputValue(), draft); checks++;
    await page.getByRole("button", { name: "추가", exact: true }).click();
    assert.equal(await body.isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "패치 메모 완료 처리" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "패치 메모 삭제" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: /기존 메모 teacher-a/ }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.memoCalls.length), 1); checks += 5;
    await page.evaluate(() => window.memoFinish(false));
    await page.getByRole("button", { name: "추가", exact: true }).waitFor();
    assert.equal(await body.inputValue(), draft); checks++;
    await page.getByRole("button", { name: "추가", exact: true }).click();
    await page.evaluate(() => window.memoFinish());
    await page.waitForFunction(() => document.querySelector("textarea")?.value === ""); checks++;
    await body.fill(draft);
    await page.evaluate(() => window.memoLoadError());
    await page.getByRole("alert").waitFor();
    assert.equal(await body.inputValue(), draft);
    const subscribeCount = await page.evaluate(() => window.memoSubscribeCount);
    await page.getByRole("button", { name: "목록 다시 불러오기" }).click();
    await page.getByRole("button", { name: /기존 메모 teacher-a/ }).waitFor();
    assert.equal(await page.evaluate(() => window.memoSubscribeCount), subscribeCount + 1);
    assert.equal(await body.inputValue(), draft); checks += 3;
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: /기존 메모 teacher-a/ }).click();
    await body.fill("편집 도중인 메모");
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: "새 메모", exact: true }).click();
    assert.equal(await body.inputValue(), "편집 도중인 메모"); checks++;
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "새 메모", exact: true }).click();
    assert.equal(await body.inputValue(), ""); checks++;
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); checks++;
    await page.screenshot({ path: join(output, `memo-${width}.png`) });
  }
  // A previous account's in-flight response must not erase the new account's draft.
  const body = page.getByRole("textbox", { name: "메모", exact: true });
  await body.fill("결과를 확인할 때까지 잠글 생성 메모");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  const originalCreate = await page.evaluate(() => window.memoCalls.at(-1));
  await page.evaluate(() => window.memoFinish("uncertain"));
  await page.getByRole("button", { name: "같은 요청 다시 시도" }).waitFor();
  assert.equal(await body.isDisabled(), true); checks++;
  await page.getByRole("button", { name: "패치 메모 닫기", exact: true }).first().click();
  await page.getByRole("button", { name: "패치 메모 열기", exact: true }).click();
  assert.equal(await body.isDisabled(), true); checks++;
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: join(output, "memo-uncertain-390.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); checks++;
  await page.getByRole("button", { name: "같은 요청 다시 시도" }).click();
  assert.deepEqual(await page.evaluate(() => window.memoCalls.at(-1)), originalCreate); checks++;
  await page.evaluate(() => window.memoFinish(false));
  await page.getByRole("button", { name: "같은 요청 다시 시도" }).waitFor();
  assert.equal(await body.isDisabled(), true); checks++;
  await page.getByRole("button", { name: "같은 요청 다시 시도" }).click();
  assert.deepEqual(await page.evaluate(() => window.memoCalls.at(-1)), originalCreate); checks++;
  await page.evaluate(() => window.memoFinish());
  await page.waitForFunction(() => document.querySelector("textarea")?.value === "");
  await page.getByRole("button", { name: /기존 메모 teacher-a/ }).click();
  await body.fill("상태를 바꿔도 보존할 초안");
  await page.getByRole("button", { name: "패치 메모 완료 처리" }).click();
  await page.evaluate(() => window.memoFinish());
  await page.waitForFunction(() => !document.querySelector("fieldset").disabled);
  assert.equal(await body.inputValue(), "상태를 바꿔도 보존할 초안"); checks++;
  await page.getByRole("button", { name: "수정 저장" }).click();
  assert.equal(await page.evaluate(() => window.memoCalls.at(-1).args[2]), 2); checks++;
  await page.evaluate(() => window.memoFinish());
  await page.waitForFunction(() => document.querySelector("textarea")?.value === "");
  await page.getByRole("button", { name: /기존 메모 teacher-a/ }).click();
  await body.fill("충돌해도 남겨 둘 초안");
  await page.evaluate(() => window.memoEmit(2));
  await page.getByRole("button", { name: "패치 메모 완료 처리" }).click();
  await page.evaluate(() => window.memoFinish());
  await page.waitForFunction(() => !document.querySelector("fieldset").disabled);
  await page.getByRole("button", { name: "수정 저장" }).click();
  assert.equal(await page.evaluate(() => window.memoCalls.at(-1).args[2]), 1); checks++;
  await page.evaluate(() => window.memoFinish("uncertain"));
  await page.getByRole("button", { name: "같은 요청 다시 시도" }).waitFor();
  assert.equal(await body.isDisabled(), true); checks++;
  await page.getByRole("button", { name: "같은 요청 다시 시도" }).click();
  await page.evaluate(() => window.memoFinish("conflict"));
  await page.waitForFunction(() => !document.querySelector("fieldset").disabled);
  assert.equal(await body.inputValue(), "충돌해도 남겨 둘 초안"); checks++;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: /기존 메모 teacher-a/ }).click();
  await body.fill("최신 버전을 확인한 수정");
  await page.getByRole("button", { name: "수정 저장" }).click();
  assert.equal(await page.evaluate(() => window.memoCalls.at(-1).args[2]), 2); checks++;
  await page.evaluate(() => window.memoFinish());
  await page.waitForFunction(() => document.querySelector("textarea")?.value === "");
  await body.fill("이전 계정 저장 요청");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await page.evaluate(() => window.memoIdentity("teacher-b"));
  await page.getByRole("button", { name: "패치 메모 열기", exact: true }).click();
  assert.equal(await body.inputValue(), ""); checks++;
  await body.fill("새 계정 작성 내용");
  const toastCount = await page.evaluate(() => window.memoToasts.length);
  await page.evaluate(() => window.memoFinish());
  assert.equal(await body.inputValue(), "새 계정 작성 내용");
  assert.equal(await page.evaluate(() => window.memoToasts.length), toastCount); checks += 2;
  await page.evaluate(() => window.memoIdentity("teacher-b", "student"));
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.evaluate(() => window.memoIdentity("teacher-b"));
  await page.getByRole("button", { name: "패치 메모 열기", exact: true }).click();
  assert.equal(await body.inputValue(), ""); checks++;
  await page.evaluate(() => window.memoIdentity(null));
  await page.getByRole("dialog").waitFor({ state: "detached" }); checks++;
  assert.deepEqual(errors, []);
  const receipt = { passed: true, checks, widths: [390, 768, 1280, 1440], errors, network: "blocked", productionAccess: 0, output };
  writeFileSync(join(output, "result.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
