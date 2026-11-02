import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
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
const out = path.join(root, "output/registration-policy-20261102");
await fs.mkdir(out, { recursive: true });
const service = `
export const qa=window.policyQa={reads:0,calls:[],writes:0,toasts:[],failRead:false,loseResponse:false,holdSave:false,conflict:false,errors:[],popupStarts:0,popupFailed:false,authTime:new URLSearchParams(location.search).has('reauth')?10:Math.floor(Date.now()/1000),transitions:0,sessionRefreshes:0};
export const auth={currentUser:{uid:'teacher-fixture',email:'teacher-fixture@yongshin-ms.ms.kr',getIdTokenResult:async()=>({claims:{auth_time:qa.authTime}}),getIdToken:async()=> 'synthetic-only'}};
qa.swapAccount=()=>{auth.currentUser={...auth.currentUser,uid:'different-teacher-fixture'};};
qa.policy={schemaVersion:1,admissionYear:'2026',admissionGrade:'3',revision:0,emailPatternLabel:'263NNNN@yongshin-ms.ms.kr'};
export const useAuth=()=>({currentUser:auth.currentUser,userData:{role:new URLSearchParams(location.search).has('readonly')?'staff':'teacher',staffPermissions:['student_list_read']},config:{year:'2026',semester:'2'}});
export const useAppToast=()=>({showToast:message=>qa.toasts.push(message)});
export const ensureWestoryAppCheck=async()=>{};
export const ensureHistoryDictionarySession=async()=>{qa.sessionRefreshes++;};
export const getHistoryDictionaryCallable=async name=>async()=>{
 if(name!=='beginApplicationSessionReauthentication')throw Error('Unexpected session transport '+name);
 qa.transitions++;return {data:{expiresAt:Date.now()+60000}};
};
export class GoogleAuthProvider{setCustomParameters(){}}
export const reauthenticateWithPopup=async user=>{
 qa.popupStarts++;qa.popupHadUserActivation=navigator.userActivation.isActive;
 if(qa.popupFailed)throw Object.assign(Error('합성 Google 팝업 실패'),{code:'auth/popup-blocked'});
 qa.authTime=Math.floor(Date.now()/1000);return {user};
};
export const db={};
export const collection=()=>({}),doc=()=>({});
export const getDoc=async()=>({exists:()=>false});
export const getDocs=async()=>({docs:[],forEach(){}});
export const resetLessonCorePointProgress=async()=>{throw Error('Unexpected roster mutation');};
export const updateStudentData=async()=>{throw Error('Unexpected roster mutation');};
export const getHttpsCallable=async(name)=>async()=>{
 if(name!=='getStudentRegistrationPolicy')throw Error('Unexpected callable');
 qa.reads++;if(qa.failRead)throw Object.assign(Error('read unavailable'),{code:'functions/unavailable'});
 return {data:structuredClone(qa.policy)};
};
export const callStudentDataService=async(name,input,uid)=>{
 if(name!=='saveStudentRegistrationPolicy'||uid!==auth.currentUser.uid)throw Error('Invalid save transport');
 qa.calls.push(structuredClone(input));
 if(qa.holdSave)await new Promise(resolve=>qa.release=resolve);
 if(qa.conflict)throw Object.assign(Error('conflict'),{code:'functions/aborted'});
 if(qa.policy.revision===input.expectedRevision+1&&qa.policy.admissionYear===input.admissionYear&&qa.policy.admissionGrade===input.admissionGrade)return structuredClone(qa.policy);
 if(qa.policy.revision!==input.expectedRevision)throw Object.assign(Error('conflict'),{code:'functions/aborted'});
 qa.writes++;
 qa.policy={schemaVersion:1,admissionYear:input.admissionYear,admissionGrade:input.admissionGrade,revision:input.expectedRevision+1,emailPatternLabel:input.admissionYear.slice(-2)+input.admissionGrade+'NNNN@yongshin-ms.ms.kr'};
 if(qa.loseResponse){qa.loseResponse=false;throw Object.assign(Error('response lost'),{code:'functions/unavailable'});}
 return structuredClone(qa.policy);
};
`;
const harness = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import Modal from './src/pages/teacher/components/StudentRegistrationPolicyModal';
import StudentList from './src/pages/teacher/StudentList';
import {AppDialogProvider} from './src/components/common/AppDialogProvider';
import {SensitiveOperationController} from './src/components/common/SensitiveOperationController';
import {qa} from 'fixture:service';
function App(){const[open,setOpen]=useState(false);if(new URLSearchParams(location.search).has('list'))return <StudentList/>;return <main style={{padding:16}}><button onClick={()=>setOpen(true)}>신규 가입 기준 열기</button><Modal open={open} onClose={()=>setOpen(false)}/></main>}
createRoot(document.getElementById('root')).render(<MemoryRouter><AppDialogProvider><SensitiveOperationController/><App/></AppDialogProvider></MemoryRouter>);
window.addEventListener('error',event=>qa.errors.push(event.message));
window.addEventListener('unhandledrejection',event=>qa.errors.push(String(event.reason)));
`;
const result = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  target: "es2022",
  loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "policy-boundaries",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^fixture:|^firebase\/(auth|firestore)$|\/(?:AuthContext|AppToastProvider|firebase|studentProfileCommands|studentData|appCheck|historyDictionarySession)$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "js",
        }));
        plugin.onResolve(
          {
            filter:
              /\/(?:MoveClassModal|StudentDetailModal|StudentRosterModal)$/,
          },
          () => ({ path: "unrelated-modal", namespace: "unrelated" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "unrelated" }, () => ({
          contents: "export default()=>null;",
          loader: "js",
        }));
      },
    },
  ],
});
for (const module of [
  "src/lib/sensitiveOperation.ts",
  "src/lib/sensitiveOperationPrompt.ts",
  "src/components/common/AppDialogProvider.tsx",
  "src/components/common/SensitiveOperationController.tsx",
  "src/pages/teacher/StudentList.tsx",
  "src/pages/teacher/components/StudentRegistrationPolicyModal.tsx",
  "src/lib/studentRegistrationPolicy.ts",
])
  assert.ok(
    Object.keys(result.metafile.inputs).some((input) =>
      input.replaceAll("\\", "/").endsWith(module),
    ),
    module + " must use its actual source",
  );
const tailwind = await fs.readFile(
  path.join(os.tmpdir(), "westory-qa-tailwind.js"),
);
const html =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>';
const server = http.createServer((request, response) => {
  if (request.url === "/qa.js") {
    response.setHeader("content-type", "text/javascript");
    response.end(result.outputFiles[0].text);
  } else if (request.url === "/tailwind.js") {
    response.setHeader("content-type", "text/javascript");
    response.end(tailwind);
  } else {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(html);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const reports = [];
try {
  for (const width of [320, 390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin);
    await page.getByRole("button", { name: "신규 가입 기준 열기" }).click();
    await page.getByText("현재 기준:").waitFor();
    assert.equal(
      await page.getByRole("button", { name: "저장", exact: true }).isEnabled(),
      false,
    );
    await page.getByLabel("계정 발급 연도").fill("2027");
    await page.getByLabel("담당 학년").selectOption("2");
    assert.equal(
      await page.locator("output").textContent(),
      "272NNNN@yongshin-ms.ms.kr",
    );
    await page.evaluate(() => (window.policyQa.holdSave = true));
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.getByRole("button", { name: "저장 중…" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("dialog").evaluate((dialog) => dialog.open),
      true,
    );
    assert.equal(
      await page.getByRole("button", { name: "닫기", exact: true }).isEnabled(),
      false,
    );
    await page
      .locator("form")
      .evaluate((form) =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
    assert.equal(await page.evaluate(() => window.policyQa.calls.length), 1);
    await page.evaluate(() => {
      window.policyQa.holdSave = false;
      window.policyQa.release();
    });
    await page.waitForFunction(() => window.policyQa.toasts.length === 1);
    assert.equal(
      await page.getByText("현재 기준:").textContent(),
      "현재 기준: 272NNNN@yongshin-ms.ms.kr",
    );
    assert.equal(
      await page.getByRole("button", { name: "저장", exact: true }).isEnabled(),
      false,
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false);
    await page.screenshot({ path: path.join(out, `policy-${width}.png`) });
    await page.getByLabel("계정 발급 연도").fill("2028");
    await page.evaluate(() => (window.policyQa.conflict = true));
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "다른 곳에서 변경" })
      .waitFor();
    assert.equal(await page.getByLabel("계정 발급 연도").inputValue(), "2028");
    await page.evaluate(() => {
      window.policyQa.conflict = false;
      window.policyQa.failRead = true;
    });
    await page.getByRole("button", { name: "다시 불러오기" }).click();
    await page.getByRole("alert").filter({ hasText: "연결을 확인" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "저장", exact: true }).isEnabled(),
      false,
    );
    assert.equal(await page.getByLabel("계정 발급 연도").inputValue(), "2028");
    await page.evaluate(() => (window.policyQa.failRead = false));
    await page.getByRole("button", { name: "다시 불러오기" }).click();
    await page.waitForFunction(
      () => document.querySelector("input").value === "2027",
    );
    await page.getByLabel("계정 발급 연도").fill("2029");
    await page.evaluate(() => (window.policyQa.loseResponse = true));
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "저장 결과를 확인하지 못했습니다" })
      .waitFor();
    const failedInput = await page.evaluate(() => window.policyQa.calls.at(-1));
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.waitForFunction(() => window.policyQa.toasts.length === 2);
    const replay = await page.evaluate(() => ({
      input: window.policyQa.calls.at(-1),
      writes: window.policyQa.writes,
      errors: window.policyQa.errors,
    }));
    assert.deepEqual(replay.input, failedInput);
    assert.equal(replay.writes, 2);
    assert.deepEqual(replay.errors, []);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "신규 가입 기준 열기" })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    reports.push({
      width,
      overflow,
      focusRestored: true,
      duplicateSubmitBlocked: true,
      draftPreserved: true,
      readFailureClosed: true,
      lostResponseReplayedOnce: true,
    });
    await page.goto(origin + "?reauth");
    await page.getByRole("button", { name: "신규 가입 기준 열기" }).click();
    const policyDialog = page.getByRole("dialog", {
      name: "신규 가입 기준",
      exact: true,
    });
    const reauthentication = page.getByRole("alertdialog", {
      name: "다시 인증",
      exact: true,
    });
    const save = () =>
      policyDialog.getByRole("button", { name: "저장", exact: true });
    await page.getByLabel("계정 발급 연도").fill("2027");
    await page.getByLabel("담당 학년").selectOption("2");
    const assertTop = async () => {
      await reauthentication.waitFor();
      const button = reauthentication.getByRole("button", {
        name: "Google로 다시 인증",
        exact: true,
      });
      assert.equal(
        await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const target = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          return (
            element.closest("dialog")?.matches(":modal") &&
            Boolean(target && (target === element || element.contains(target)))
          );
        }),
        true,
        "reauthentication is the clickable top modal",
      );
      assert.equal(await page.locator("dialog:modal").count(), 2);
      return button;
    };
    for (const cancellation of ["Escape", "button"]) {
      await save().click();
      await assertTop();
      assert.equal(await page.evaluate(() => window.policyQa.calls.length), 0);
      assert.equal(await page.evaluate(() => window.policyQa.popupStarts), 0);
      if (cancellation === "Escape") await page.keyboard.press("Escape");
      else
        await reauthentication
          .getByRole("button", { name: "취소", exact: true })
          .click();
      await reauthentication.waitFor({ state: "hidden" });
      await policyDialog
        .getByRole("alert")
        .filter({ hasText: "재인증을 취소" })
        .waitFor();
      assert.equal(await save().isEnabled(), true, "cancel unlocks saving");
      assert.equal(
        await policyDialog.getByLabel("계정 발급 연도").inputValue(),
        "2027",
      );
      assert.equal(
        await policyDialog.getByLabel("담당 학년").inputValue(),
        "2",
      );
      assert.equal(await page.evaluate(() => window.policyQa.calls.length), 0);
    }
    await page.evaluate(() => (window.policyQa.popupFailed = true));
    await save().click();
    await (await assertTop()).click();
    await reauthentication.waitFor({ state: "hidden" });
    await policyDialog
      .getByRole("alert")
      .filter({ hasText: "합성 Google 팝업 실패" })
      .waitFor();
    assert.equal(
      await save().isEnabled(),
      true,
      "popup failure unlocks saving",
    );
    assert.equal(await page.evaluate(() => window.policyQa.calls.length), 0);
    assert.equal(await page.evaluate(() => window.policyQa.popupStarts), 1);
    await page.evaluate(() => (window.policyQa.popupFailed = false));
    await save().click();
    const confirmation = await assertTop();
    await page.screenshot({
      path: path.join(out, `policy-reauth-${width}.png`),
    });
    await confirmation.click();
    await page.waitForFunction(() => window.policyQa.toasts.length === 1);
    assert.equal(await page.evaluate(() => window.policyQa.calls.length), 1);
    assert.equal(await page.evaluate(() => window.policyQa.writes), 1);
    assert.equal(await page.evaluate(() => window.policyQa.popupStarts), 2);
    assert.equal(
      await page.evaluate(() => window.policyQa.popupHadUserActivation),
      true,
    );
    assert.equal(
      await page.evaluate(() => window.policyQa.sessionRefreshes),
      1,
    );
    assert.equal(await save().isEnabled(), false);
    assert.equal(
      await page.getByText("현재 기준:").textContent(),
      "현재 기준: 272NNNN@yongshin-ms.ms.kr",
    );
    assert.deepEqual(await page.evaluate(() => window.policyQa.errors), []);
    reports.push({
      width,
      actualSensitiveOperation: true,
      reauthenticationTopLayer: true,
      escapeAndClickCancelUnlock: true,
      popupFailureUnlock: true,
      popupUserActivation: true,
      saveAfterReauthenticationOnce: true,
    });
    await page.goto(origin + "?list&readonly");
    await page
      .getByText("읽기 전용 권한입니다. 학생 명단 조회만 가능합니다.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "신규 가입 기준", exact: true })
        .count(),
      0,
    );
    assert.equal(await page.locator("dialog:modal").count(), 0);
    assert.equal(
      await page.evaluate(() => window.policyQa.reads),
      0,
      "readonly roster does not load policy",
    );
    await page.goto(origin + "?list");
    await page
      .getByRole("button", { name: "신규 가입 기준", exact: true })
      .click();
    await page.getByText("현재 기준:").waitFor();
    assert.equal(await page.evaluate(() => window.policyQa.reads), 1);
    reports.push({
      width,
      actualStudentList: true,
      readOnlyHidesPolicyButton: true,
      teacherOpensPolicy: true,
    });
    await page.close();
  }
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ passed: true, reports, productionAccess: 0 }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, reports, productionAccess: 0 }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
