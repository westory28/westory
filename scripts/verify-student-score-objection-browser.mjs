// Actual student components; service doubles and fictitious records only.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path
  .resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  .replaceAll("\\", "/");
const out = path.resolve(
  process.env.SCORE_QA_EVIDENCE_DIR ||
    path.join(root, "..", "evidence", "student-objection"),
);
await fs.mkdir(out, { recursive: true });
const require = createRequire(root + "/package.json");
const { build } = require("esbuild");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const mocks = {
  "qa-state": `
const scenario=new URLSearchParams(location.search);
export const state={scenario,events:[],toasts:[],objections:[],legacy:[],hold:false,fail:false,consented:!scenario.has('noconsent')};
const written=scenario.has('written');
export const records=[{id:'qa-score',rosterId:'qa-score',uid:'qa-student',scoreKind:written?'written_exam_essay':'performance',title:written?'가상 정기시험':'사료 해석과 역사적 판단을 설명하는 수행평가',subject:'역사',academicYear:'2026',semester:'2',grade:'3',class:'1',number:'1',studentName:'가상학생',items:written?[{name:'1-(1)',itemKey:'1-(1)',score:7,maxScore:10},{name:'1-(2)',itemKey:'1-(2)',score:8,maxScore:10}]:[{name:'자료 해석',score:15,maxScore:20}],totalScore:15,totalMaxScore:20,feedback:'자료를 읽고 근거를 잘 정리했습니다.',evidence:'가상 채점 근거',updatedAt:{seconds:1801850400},...(scenario.has('signed')?{signatureName:'가상학생',signatureImage:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='}:{})}];
if(scenario.has('legacy'))state.legacy.push({id:'qa-legacy',uid:'qa-student',scoreId:'qa-score',status:'pending',reason:'기존 답안지 확인 요청'});
if(scenario.has('blank-pair')||scenario.has('blank-only')){
 records[0]={...records[0],title:'1차 역사 자료 해석',assessmentOrder:1,enteredScoreCount:1,items:[{name:'자료 해석',score:15,maxScore:20,scoreEntered:true}]};
 records.push({...records[0],id:'qa-blank',rosterId:'qa-blank',title:'2차 역사적 판단 글쓰기',assessmentOrder:2,enteredScoreCount:0,totalScore:0,items:[{name:'판단 글쓰기',score:0,maxScore:20,scoreEntered:false}],feedback:'',evidence:''});
 if(scenario.has('blank-only'))records.shift();
}
if(scenario.has('real-zero'))records[0]={...records[0],enteredScoreCount:1,totalScore:0,items:[{name:'자료 해석',score:0,maxScore:20,scoreEntered:true}]};
if(scenario.has('blank-pending')||scenario.has('stale-pending')){
 const scoreId=scenario.has('blank-pending')?'qa-blank':'qa-stale';
 state.objections.push({id:'qa-blank-objection',uid:'qa-student',scoreId,scoreTitle:'2차 이전 이의',status:'pending',reason:'기존 요청'});
 state.legacy.push({id:'qa-blank-request',uid:'qa-student',scoreId,status:'pending',reason:'기존 확인 요청'});
}
state.records=records;state.serverRecords=new Map(records.map(record=>[record.id,structuredClone(record)]));state.confirmations=new Map();
window.studentScoreQa=state;
`,
  "qa-auth": `import{state}from'qa-state';export const useAuth=()=>({currentUser:{uid:'qa-student',email:'qa-student@example.test'},userData:{role:'student',name:'가상학생',grade:'3',class:'1',number:'1',enrollmentStatus:state.scenario.has('excluded')?'transferred':'active'},config:{year:'2026',semester:'2'}});`,
  "qa-firebase": `export const db={};export const auth={currentUser:{uid:'qa-student'}};export const getHttpsCallable=async()=>{throw new Error('Unexpected live callable')};`,
  "qa-firestore": `import{state}from'qa-state';
export const collection=()=>({});export const doc=(db,...parts)=>({path:parts.join('/'),id:parts.at(-1)});export const query=()=>({});export const orderBy=()=>({});export const where=()=>({});export const getDocs=async()=>({docs:[]});
export const getDoc=async(ref)=>{state.events.push({name:'serverRead',path:ref.path});const value=ref.path.includes('/confirmations/')?state.confirmations.get(ref.path):state.serverRecords.get(ref.id);return{id:ref.id,exists:()=>Boolean(value),data:()=>value};};export const getDocFromServer=getDoc;
export const serverTimestamp=()=>({seconds:1801850500,nanoseconds:0});export const setDoc=async()=>{throw new Error('Unexpected direct write')};
export const writeBatch=()=>{const pending=[];return{set:(ref,value)=>pending.push({ref,value}),commit:async()=>{for(const{ref,value}of pending){if(!ref.path.includes('/confirmations/'))throw new Error('Unexpected non-signature write');state.confirmations.set(ref.path,value);state.events.push({name:'signature',path:ref.path,rosterId:value.rosterId});}}};};`,
  "qa-scores": `export * from '${root}/src/lib/performanceScores.ts';import{normalizePerformanceScoreSettings}from'${root}/src/lib/performanceScores.ts';import{state,records}from'qa-state';
const settings=normalizePerformanceScoreSettings();
const consent=()=>state.consented?{uid:'qa-student',academicYear:'2026',semester:'2',acknowledged:true,warningVersion:settings.warningVersion,warningTextHash:settings.warningTextHash}:null;
export const loadUserPerformanceScoreRecords=async()=>{if(state.scenario.has('loaderror'))throw new Error('Synthetic read failure');return records;};
export const loadPerformanceScoreSettings=async()=>settings;
export const loadPerformanceScoreWarningConsent=async()=>consent();
export const savePerformanceScoreWarningConsent=async()=>{state.consented=true;return consent();};
export const loadUserPerformanceScoreObjections=async()=>[...state.objections];
export const loadUserPerformanceScoreAnswerSheetRequests=async()=>[...state.legacy];`,
  "qa-notifications": `import{state}from'qa-state';export const notifyPerformanceScoreObjectionRequested=async(config,input)=>{
state.events.push({name:'objection',config,input});
if(state.hold)await new Promise(resolve=>state.resume=resolve);
if(state.fail)throw Object.assign(new Error('Synthetic save failure'),{code:'functions/unavailable'});
if(state.scenario.has('processed'))return{objectionSavedCount:0,objectionSkippedProcessedCount:1,recipientCount:1,createdCount:0,skippedCount:0};
state.objections=[{id:'qa-objection',uid:'qa-student',scoreId:'qa-score',scoreTitle:'가상 평가',status:'pending',requestedAt:{seconds:1801850460},...input}];
return{objectionSavedCount:1,objectionSkippedProcessedCount:0,recipientCount:1,createdCount:1,skippedCount:0};
};`,
  "qa-toast": `import{state}from'qa-state';const showToast=payload=>state.toasts.push(payload);export const useAppToast=()=>({showToast});`,
  "qa-archive": `export const isSemesterArchive=false;export const archiveScope=null;`,
};
const moduleFor = (request) => {
  const value = request.replaceAll("\\", "/");
  if (value in mocks) return value;
  if (value === "firebase/firestore") return "qa-firestore";
  if (/contexts\/AuthContext$/.test(value)) return "qa-auth";
  if (/lib\/firebase$/.test(value)) return "qa-firebase";
  if (/performanceScores$/.test(value)) return "qa-scores";
  if (/lib\/notifications$/.test(value)) return "qa-notifications";
  if (/AppToastProvider$/.test(value)) return "qa-toast";
  if (/lib\/semesterArchive$/.test(value)) return "qa-archive";
};
const bundle = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{ScoreConfirmationView}from'${root}/src/pages/student/score/PerformanceScoreView';createRoot(document.getElementById('root')).render(<ScoreConfirmationView scoreKind={new URLSearchParams(location.search).has('written')?'written_exam_essay':'performance'}/>);`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "browser",
  loader: { ".css": "empty" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "synthetic-services",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          const id =
            moduleFor(args.path) ||
            (args.path.startsWith(".")
              ? moduleFor(path.resolve(args.resolveDir, args.path))
              : undefined);
          return id ? { path: id, namespace: "qa" } : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "qa" }, (args) => ({
          contents: mocks[args.path],
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
assert.equal(
  Object.keys(bundle.metafile.inputs).filter((file) =>
    /node_modules[\\/](firebase|@firebase)[\\/]/.test(file),
  ).length,
  0,
);
const css = (
  await Promise.all(
    [
      "assets/css/style.css",
      "src/assets/index.css",
      "src/components/common/portalSubNavigation.css",
    ].map((file) => fs.readFile(root + "/" + file, "utf8")),
  )
)
  .join("\n")
  .replace(/@import[^;]+;/g, "")
  .replace(/@tailwind[^;]+;/g, "");
const tailwind = await fs.readFile(
  process.env.SCORE_QA_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
);
const html = `<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    ["/fixture.js", "/tailwind.js"].includes(req.url)
      ? "text/javascript"
      : "text/html; charset=utf-8",
  );
  res.end(
    req.url === "/fixture.js"
      ? bundle.outputFiles[0].text
      : req.url === "/tailwind.js"
        ? tailwind
        : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = {
  kind: "synthetic-student-unified-objection",
  checks: [],
  viewports: [],
  screenshots: [],
  pageErrors: [],
  limitations: [
    "Actual student React and score/consent helpers; memory service responses. No real Firebase, student records, signatures or notifications were written.",
    "First school login and production caller authorization are outside this UI test.",
  ],
};
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.SCORE_QA_BROWSER_CHANNEL
      ? { channel: process.env.SCORE_QA_BROWSER_CHANNEL }
      : process.platform === "win32"
        ? { channel: "msedge" }
        : {}),
    headless: true,
  });
  const createPage = async (width, query = "") => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (error) => report.pageErrors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin + query);
    return page;
  };
  const openSignatureReview = async (page) => {
    await page
      .getByRole("button", { name: "점수 확인 및 서명하기", exact: true })
      .click();
    const signing = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "수행평가 점수 확인 및 서명",
        exact: true,
      }),
    });
    await signing
      .getByRole("button", { name: "동의합니다", exact: true })
      .click();
    const canvas = signing.getByLabel("점수 확인 서명 그리기 칸", {
      exact: true,
    });
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const rect = await canvas.boundingBox();
    assert.ok(rect && rect.width > 0);
    await page.mouse.move(
      rect.x + rect.width * 0.2,
      rect.y + rect.height * 0.5,
    );
    await page.mouse.down();
    for (let index = 1; index <= 8; index++)
      await page.mouse.move(
        rect.x + rect.width * (0.2 + index * 0.06),
        rect.y + rect.height * (index % 2 ? 0.3 : 0.7),
        { steps: 3 },
      );
    await page.mouse.up();
    await signing
      .getByRole("button", { name: "확인 내용 검토", exact: true })
      .click();
    await signing
      .getByRole("button", { name: "제출하기", exact: true })
      .waitFor();
    return signing;
  };
  const selectBlankAssessment = async (page) => {
    const toggle = page.getByRole("button", { name: /점수 목록 메뉴 펼치기/ });
    if (await toggle.isVisible()) await toggle.click();
    await page
      .getByRole("navigation", { name: "점수 목록 메뉴", exact: true })
      .getByRole("button", { name: /2차 역사적 판단 글쓰기/ })
      .click();
    await page
      .getByRole("heading", { name: "2차 역사적 판단 글쓰기", exact: true })
      .waitFor();
  };
  for (const width of [390, 768, 1280]) {
    const page = await createPage(width, "?blank-pair");
    await page
      .getByRole("button", { name: "이의 신청", exact: true })
      .waitFor();
    await selectBlankAssessment(page);
    const mainScore = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "2차 역사적 판단 글쓰기",
        exact: true,
      }),
    });
    await mainScore.getByText("점수 미등록", { exact: true }).waitFor();
    assert.ok((await mainScore.innerText()).includes("/ 20"));
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: `${out}/blank-student-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`blank-student-${width}.png`);
    await page.getByRole("button", { name: "이의 신청", exact: true }).click();
    const objection = page.getByRole("dialog", {
      name: "수행평가 이의 신청",
      exact: true,
    });
    assert.equal(
      await objection
        .getByText("2차 역사적 판단 글쓰기", { exact: true })
        .count(),
      0,
    );
    await objection.getByRole("button", { name: "이의 신청 창 닫기" }).click();
    const signing = await openSignatureReview(page);
    assert.equal(
      await signing
        .getByText("2차 역사적 판단 글쓰기", { exact: true })
        .count(),
      0,
    );
    await signing
      .getByRole("button", { name: "제출하기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "점수 확인 완료 1/1", exact: true })
      .waitFor();
    const signed = await page.evaluate(() => ({
      signatures: window.studentScoreQa.events.filter(
        (event) => event.name === "signature",
      ),
      confirmations: [...window.studentScoreQa.confirmations].map(
        ([path, value]) => ({
          path,
          rosterId: value.rosterId,
          hasImage: Boolean(value.signatureImage),
        }),
      ),
      blank: window.studentScoreQa.serverRecords.get("qa-blank"),
    }));
    assert.deepEqual(
      signed.signatures.map((event) => event.rosterId),
      ["qa-score"],
    );
    assert.equal(signed.confirmations.length, 1);
    assert.equal(signed.confirmations[0].hasImage, true);
    assert.equal(signed.blank.enteredScoreCount, 0);
    assert.equal(signed.blank.items[0].scoreEntered, false);
    assert.equal(signed.blank.signatureImage, undefined);
    await mainScore.getByText("점수 미등록", { exact: true }).waitFor();
    await page.screenshot({
      path: `${out}/blank-student-signed-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`blank-student-signed-${width}.png`);
    await page.close();
  }
  report.checks.push(
    "390/768/1280: both assessment titles remain available, unentered B shows 점수 미등록 and is excluded from objection/signature targets; drawing and submitting signs only scored A and completes 1/1 while B remains blank.",
  );
  for (const staleKind of ["blank-pending", "stale-pending"]) {
    const requestPage = await createPage(1280, `?blank-pair&${staleKind}`);
    const signing = await openSignatureReview(requestPage);
    await signing
      .getByRole("button", { name: "제출하기", exact: true })
      .click();
    await requestPage
      .getByRole("button", { name: "점수 확인 완료 1/1", exact: true })
      .waitFor();
    assert.equal(
      await requestPage.evaluate(
        () => window.studentScoreQa.confirmations.size,
      ),
      1,
    );
    assert.equal(
      await requestPage.evaluate(
        () =>
          window.studentScoreQa.objections.length +
          window.studentScoreQa.legacy.length,
      ),
      2,
    );
    await requestPage.close();
  }
  report.checks.push(
    "Pending objection/legacy request belonging to blank B or a record absent from the current list does not block scored A; both old request records remain preserved.",
  );
  const blankOnly = await createPage(1280, "?blank-only");
  await blankOnly
    .getByRole("heading", { name: "2차 역사적 판단 글쓰기", exact: true })
    .waitFor();
  const blankObjection = blankOnly.getByRole("button", {
    name: "이의 신청",
    exact: true,
  });
  assert.equal(
    (await blankObjection.count()) === 0 || (await blankObjection.isDisabled()),
    true,
  );
  const blankSign = blankOnly.getByRole("button", {
    name: "점수 확인 및 서명하기",
    exact: true,
  });
  assert.equal(
    (await blankSign.count()) === 0 || (await blankSign.isDisabled()),
    true,
  );
  assert.equal(
    await blankOnly.getByRole("button", { name: /점수 확인 완료/ }).count(),
    0,
  );
  assert.equal(
    await blankOnly.evaluate(
      () =>
        window.studentScoreQa.events.filter(
          (event) => event.name === "signature",
        ).length,
    ),
    0,
  );
  await blankOnly.close();
  const zero = await createPage(1280, "?real-zero");
  const zeroSigning = await openSignatureReview(zero);
  await zeroSigning
    .getByRole("button", { name: "제출하기", exact: true })
    .click();
  await zero
    .getByRole("button", { name: "점수 확인 완료 1/1", exact: true })
    .waitFor();
  assert.equal(
    await zero.evaluate(() => window.studentScoreQa.confirmations.size),
    1,
  );
  await zero.close();
  const changed = await createPage(1280, "?blank-pair");
  const changedSigning = await openSignatureReview(changed);
  await changed.evaluate(() => {
    const record = window.studentScoreQa.serverRecords.get("qa-score");
    window.studentScoreQa.serverRecords.set("qa-score", {
      ...record,
      enteredScoreCount: 0,
      totalScore: 0,
      items: record.items.map((item) => ({
        ...item,
        score: 0,
        scoreEntered: false,
      })),
    });
  });
  await changedSigning
    .getByRole("button", { name: "제출하기", exact: true })
    .click();
  await changedSigning
    .getByText(
      "점수 또는 확인 상태가 변경되었습니다. 새로고침한 뒤 점수를 확인하고 다시 서명해 주세요.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await changed.evaluate(() => window.studentScoreQa.confirmations.size),
    0,
  );
  assert.equal(await changedSigning.isVisible(), true);
  assert.ok(
    await changed.evaluate(() =>
      window.studentScoreQa.events.some(
        (event) =>
          event.name === "serverRead" &&
          event.path === "users/qa-student/performance_scores/qa-score",
      ),
    ),
  );
  await changed.close();
  report.checks.push(
    "Unentered-only records cannot sign or object; an explicitly entered real 0 signs successfully; a same-version server re-read changing A to enteredScoreCount=0 blocks submission without any confirmation write.",
  );
  for (const width of [390, 768, 1280]) {
    const page = await createPage(width);
    const trigger = page.getByRole("button", {
      name: "이의 신청",
      exact: true,
    });
    await trigger.waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "답안지 확인 요청", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "수행평가 이의 신청",
      exact: true,
    });
    await dialog.waitFor();
    assert.equal(
      await dialog.evaluate((el) => document.activeElement === el),
      true,
    );
    const submit = dialog.getByRole("button", {
      name: "이의 신청 보내기",
      exact: true,
    });
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await submit.evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await dialog
        .getByRole("button", { name: "이의 신청 창 닫기" })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      await trigger.evaluate((el) => el === document.activeElement),
      true,
    );
    await trigger.click();
    const check = dialog.getByLabel("답안지 확인도 요청", { exact: true });
    assert.equal(await check.isChecked(), false);
    await submit.click();
    await dialog.getByRole("alert").waitFor();
    await dialog
      .getByLabel("이의 신청 사유", { exact: true })
      .fill("채점 기준에 적힌 근거를 제 답안과 함께 다시 확인하고 싶습니다.");
    await check.check();
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
    await page.screenshot({
      path: out + `/student-objection-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`student-objection-${width}.png`);
    await page.evaluate(() => (window.studentScoreQa.hold = true));
    await submit.click();
    await page.waitForFunction(() => !!window.studentScoreQa.resume);
    assert.equal(await check.isDisabled(), true);
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), true);
    await page.evaluate(() => window.studentScoreQa.resume());
    const result = page.getByRole("dialog", {
      name: "수행평가 이의 결과",
      exact: true,
    });
    await result.waitFor();
    await result.getByText("답안지 확인 요청 포함", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => window.studentScoreQa.events[0].input.answerSheetRequested,
      ),
      true,
    );
    await page.screenshot({
      path: out + `/student-objection-result-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`student-objection-result-${width}.png`);
    await page.keyboard.press("Escape");
    await result.waitFor({ state: "hidden" });
    assert.equal(
      await trigger.evaluate((el) => el === document.activeElement),
      true,
    );
    await page
      .getByText("이의·답안지 확인 처리 대기", { exact: true })
      .last()
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "점수 확인 및 서명하기", exact: true })
        .isDisabled(),
      true,
    );
    report.viewports.push(width);
    await page.close();
  }
  report.checks.push(
    "390/768/1280: one request entry, optional checkbox defaults false, validation, true payload, combined result/status, pending signature block, no overflow, screenshots, focus entry/trap/restore, save-time Escape blocked.",
  );
  const page = await createPage(1280);
  await page.getByRole("button", { name: "이의 신청", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("이의 신청 사유", { exact: true })
    .fill("점수의 채점 기준을 다시 확인해 주세요.");
  await page.evaluate(() => (window.studentScoreQa.fail = true));
  await dialog
    .getByRole("button", { name: "이의 신청 보내기", exact: true })
    .click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(
    await dialog.getByLabel("이의 신청 사유", { exact: true }).inputValue(),
    "점수의 채점 기준을 다시 확인해 주세요.",
  );
  await page.evaluate(() => (window.studentScoreQa.fail = false));
  await dialog
    .getByRole("button", { name: "이의 신청 보내기", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "수행평가 이의 결과", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => window.studentScoreQa.events.at(-1).input.answerSheetRequested,
    ),
    false,
  );
  assert.equal(
    await page.getByText("답안지 확인 요청 포함", { exact: true }).count(),
    0,
  );
  report.checks.push(
    "Unchecked request sends false; failed save retains reason and checkbox for retry.",
  );
  await page.goto(origin + "?signed");
  await page.getByRole("button", { name: /점수 확인 완료/ }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "이의 신청", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "답안지 확인 요청", exact: true })
      .count(),
    0,
  );
  report.checks.push(
    "Signed scores expose neither objection creation nor independent answer-sheet bypass.",
  );
  await page.goto(origin + "?processed");
  await page.getByRole("button", { name: "이의 신청", exact: true }).click();
  dialog = page.getByRole("dialog", {
    name: "수행평가 이의 신청",
    exact: true,
  });
  await dialog
    .getByLabel("이의 신청 사유", { exact: true })
    .fill("같은 점수를 다시 확인하고 싶습니다.");
  await dialog.getByLabel("답안지 확인도 요청", { exact: true }).check();
  await dialog
    .getByRole("button", { name: "이의 신청 보내기", exact: true })
    .click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "이미 처리된 이의 제기" })
    .waitFor();
  assert.equal(await dialog.isVisible(), true);
  assert.equal(
    await page.evaluate(() => window.studentScoreQa.objections.length),
    0,
  );
  report.checks.push(
    "Processed objection response cannot be reopened via the optional answer-sheet flag; no false success or new history.",
  );
  await page.goto(origin + "?legacy");
  await page.getByRole("button", { name: "이의 신청", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "점수 확인 및 서명하기", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByText(/답안지 확인 요청 처리 대기 중인/).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "답안지 확인 요청", exact: true })
      .count(),
    0,
  );
  report.checks.push(
    "Legacy pending request remains loaded, visible and blocks signature, without new standalone request action.",
  );
  await page.goto(origin + "?noconsent");
  await page
    .getByRole("button", { name: "동의 저장하고 점수 확인", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "이의 신청", exact: true }).count(),
    0,
  );
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "동의 저장하고 점수 확인", exact: true })
    .click();
  await page.getByRole("button", { name: "이의 신청", exact: true }).waitFor();
  report.checks.push(
    "Warning consent remains required before any score request.",
  );
  await page.goto(origin + "?written");
  await page.getByRole("button", { name: "이의 신청", exact: true }).click();
  dialog = page.getByRole("dialog", {
    name: "정기시험 이의 신청",
    exact: true,
  });
  await dialog
    .getByLabel("이의 신청 사유", { exact: true })
    .fill("논술형 문항의 채점 근거와 답안을 확인하고 싶습니다.");
  await dialog.getByLabel("답안지 확인도 요청", { exact: true }).check();
  await dialog
    .getByRole("button", { name: "이의 신청 보내기", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "정기시험 이의 결과", exact: true })
    .waitFor();
  const written = await page.evaluate(
    () => window.studentScoreQa.events[0].input,
  );
  assert.equal(written.scoreKind, "written_exam_essay");
  assert.equal(written.answerSheetRequested, true);
  assert.ok(written.targetDetails.includes("(1)"));
  report.checks.push(
    "Shared written-exam view preserves selected question details and sends the same optional flag.",
  );
  await page.goto(origin + "?loaderror");
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "이의 신청", exact: true }).count(),
    0,
  );
  await page.goto(origin + "?excluded");
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "이의 신청", exact: true }).count(),
    0,
  );
  report.checks.push("Load failure and excluded roster block request UI.");
  assert.deepEqual(report.pageErrors, []);
  await fs.writeFile(
    out + "/student-objection-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
