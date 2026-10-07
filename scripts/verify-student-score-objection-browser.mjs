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
export const state={scenario,events:[],toasts:[],objections:[],legacy:[],hold:false,fail:false,clock:1801850500,consented:!scenario.has('noconsent')};
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
if(scenario.has('layout')){
 records[0].title='하여가와 단심가 다시 쓰기(논술형)';
 records[0].assessmentOrder=1;
 if(records[1])records[1].title='조선 시대 신분 질서와 변화의 모습을 설명하기';
 records.reverse();
}
state.records=records;state.serverRecords=new Map(records.map(record=>[record.id,structuredClone(record)]));state.confirmations=new Map();
if(scenario.has('signed'))for(const record of records)state.confirmations.set('users/qa-student/performance_scores/'+record.id+'/confirmations/qa-student',{uid:record.uid,rosterId:record.rosterId,signatureName:record.signatureName,signatureImage:record.signatureImage,scoreUpdatedAt:record.updatedAt,confirmedAt:{seconds:1801850450}});
window.studentScoreQa=state;
`,
  "qa-auth": `import{state}from'qa-state';import{MENUS}from'${root}/src/constants/menus.ts';const noop=async()=>{};const auth={currentUser:{uid:'qa-student',email:'qa-student@example.test'},userData:{uid:'qa-student',role:'student',name:'가상학생',grade:'3',class:'1',number:'1',enrollmentStatus:state.scenario.has('excluded')?'transferred':'active'},config:{year:'2026',semester:'2',showScore:true},loading:false,authPhase:'ready',authError:null,retryAuth:noop,logout:noop,configReady:true,menuConfig:MENUS,menuConfigReady:true,settingsLoadedAt:Date.now(),refreshConfig:noop,refreshMenuConfig:noop};export const useAuth=()=>auth;`,
  "qa-firebase": `export const db={};export const auth={currentUser:{uid:'qa-student'}};export const getHttpsCallable=async()=>{throw new Error('Unexpected live callable')};`,
  "qa-firestore": `import{state}from'qa-state';
export const collection=(db,...parts)=>({path:parts.join('/')});export const doc=(db,...parts)=>({path:parts.join('/'),id:parts.at(-1)});export const query=(ref)=>ref;export const orderBy=()=>({});export const where=()=>({});
const readScores=async(ref,fromServer)=>{if(ref.path!=='users/qa-student/performance_scores')throw new Error('Unexpected score collection '+ref.path);state.events.push({name:'scoreListRead',fromServer});if(state.scenario.has('loaderror')||state.failNextScoreListRead){state.failNextScoreListRead=false;throw new Error('Synthetic read failure');}return{docs:[...state.serverRecords.values()].map(record=>({id:record.id,data:()=>structuredClone(record)}))};};
export const getDocs=(ref)=>readScores(ref,false);export const getDocsFromServer=(ref)=>readScores(ref,true);
export const getDoc=async(ref)=>{state.events.push({name:'serverRead',path:ref.path});const value=ref.path.includes('/confirmations/')?state.confirmations.get(ref.path):state.serverRecords.get(ref.id);return{id:ref.id,exists:()=>Boolean(value),data:()=>value};};export const getDocFromServer=getDoc;
export const serverTimestamp=()=>({seconds:++state.clock,nanoseconds:0});export const setDoc=async()=>{throw new Error('Unexpected direct write')};
export const writeBatch=()=>{const pending=[];return{set:(ref,value)=>pending.push({ref,value}),commit:async()=>{for(const{ref,value}of pending){if(!ref.path.includes('/confirmations/'))throw new Error('Unexpected non-signature write');state.confirmations.set(ref.path,value);state.events.push({name:'signature',path:ref.path,rosterId:value.rosterId});}state.afterSignatureCommit?.();}};};`,
  "qa-scores": `export * from '${root}/src/lib/performanceScores.ts';import{normalizePerformanceScoreSettings,applyPerformanceScoreConfirmation,sortPerformanceScoreRecords,getLatestPerformanceScoreSignatureRecord}from'${root}/src/lib/performanceScores.ts';import{state}from'qa-state';
const settings=normalizePerformanceScoreSettings();
const consent=()=>state.consented?{uid:'qa-student',academicYear:'2026',semester:'2',acknowledged:true,warningVersion:settings.warningVersion,warningTextHash:settings.warningTextHash}:null;
const resolvedRecords=()=>sortPerformanceScoreRecords([...state.serverRecords.values()].map(record=>applyPerformanceScoreConfirmation(structuredClone(record),state.confirmations.get('users/qa-student/performance_scores/'+record.id+'/confirmations/qa-student')||null)));
state.latestSignature=()=>getLatestPerformanceScoreSignatureRecord(resolvedRecords());
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
  "qa-toast": `import{state}from'qa-state';const showToast=payload=>state.toasts.push(payload);export const useAppToast=()=>({showToast});export const inferToastFromAlertMessage=message=>({message:String(message)});`,
  "qa-archive": `export const isSemesterArchive=false;export const archiveScope=null;`,
  "qa-archive-boundary": `export const SemesterArchiveBanner=()=>null;export const SemesterArchiveUnavailable=()=>null;export const isArchiveUnavailableRoute=()=>false;`,
  "qa-null-component": `export default ()=>null;`,
  "qa-rank-promotion": `export const loadStudentRankPromotionSnapshot=async()=>({rank:null,wallet:{balance:0},policy:{rankPolicy:{}}});export const invalidateStudentRankPromotionSnapshotCache=()=>{};`,
  "qa-point-ranks": `export const getPointRankDefaultEmojiValue=()=>'';`,
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
  if (/SemesterArchiveBoundary$/.test(value)) return "qa-archive-boundary";
  if (
    /(StudentHistoryDictionaryController|StudentRankPromotionController|TeacherPatchMemoController|NotificationBell)$/.test(
      value,
    )
  )
    return "qa-null-component";
  if (/lib\/pointRankPromotion$/.test(value)) return "qa-rank-promotion";
  if (/lib\/pointRanks$/.test(value)) return "qa-point-ranks";
};
const bundle = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import MainLayout from'${root}/src/components/layout/MainLayout';import{ScoreConfirmationView}from'${root}/src/pages/student/score/PerformanceScoreView';import{state}from'qa-state';const root=createRoot(document.getElementById('root'));let revision=0;state.remount=()=>{const score=<ScoreConfirmationView key={++revision} scoreKind={state.scenario.has('written')?'written_exam_essay':'performance'}/>;root.render(<MemoryRouter initialEntries={['/student/score/performance']}>{state.scenario.has('layout')?<MainLayout>{score}</MainLayout>:score}</MemoryRouter>);};state.remount();`,
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
      "src/components/common/headerStudentWis.css",
      "src/components/common/Footer.css",
      "src/components/layout/teacherLayout.css",
      "src/components/layout/studentLayout.css",
      "src/pages/student/score/performance-score-view.css",
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
  layoutMetrics: [],
  screenshots: [],
  pageErrors: [],
  limitations: [
    "Actual student React, MainLayout/Header/sidebar components and score/consent/confirmation helpers; memory service responses. No real Firebase, student records, signatures or notifications were written. Header rank/notification/dictionary overlays are disabled.",
    "First school login and production caller authorization are outside this UI test.",
    "Teacher updates are injected into the memory server and followed by a component remount to exercise the actual load/confirmation-version path; this does not claim live subscription behavior.",
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
  const selectAssessment = async (page, title) => {
    const toggle = page.getByRole("button", {
      name: /수행평가 목록 메뉴 펼치기/,
    });
    if (await toggle.isVisible()) await toggle.click();
    await page
      .getByRole("navigation", { name: "수행평가 목록 메뉴", exact: true })
      .getByRole("button", {
        name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      })
      .click();
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
  };
  const selectBlankAssessment = (page) =>
    selectAssessment(page, "2차 역사적 판단 글쓰기");
  const firstTitle = "하여가와 단심가 다시 쓰기(논술형)";
  const secondTitle = "조선 시대 신분 질서와 변화의 모습을 설명하기";
  for (const width of [390, 768, 1280]) {
    const page = await createPage(width, "?layout&blank-pair&noconsent");
    const consentAction = page.getByRole("button", {
      name: "동의 저장하고 점수 확인",
      exact: true,
    });
    await consentAction.waitFor();
    assert.equal(await consentAction.isDisabled(), true);
    const consentGeometry = await consentAction.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const parent = button.parentElement.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        centeredBy: Math.abs(
          rect.x + rect.width / 2 - parent.x - parent.width / 2,
        ),
        fontSize: parseFloat(getComputedStyle(button).fontSize),
      };
    });
    assert.ok(consentGeometry.height >= 56, JSON.stringify(consentGeometry));
    assert.ok(consentGeometry.fontSize >= 18, JSON.stringify(consentGeometry));
    assert.ok(consentGeometry.centeredBy <= 2, JSON.stringify(consentGeometry));
    assert.ok(consentGeometry.width >= 270 && consentGeometry.width <= 384);
    await page.screenshot({
      path: `${out}/consent-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`consent-${width}.png`);
    await page.getByRole("checkbox").check();
    await page.getByRole("checkbox").focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await consentAction.evaluate(
        (button) => button === document.activeElement,
      ),
      true,
    );
    await page.keyboard.press("Enter");
    await page
      .getByRole("heading", { name: firstTitle, exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.studentScoreQa.consented),
      true,
    );
    const subNavigation = page.getByRole("complementary", {
      name: "수행평가 목록",
      exact: true,
    });
    const titles = subNavigation.locator(".performance-score-navigation-title");
    const navItems = subNavigation
      .getByRole("navigation", {
        name: "수행평가 목록 메뉴",
        exact: true,
        includeHidden: true,
      })
      .getByRole("button", { includeHidden: true });
    if (width < 768) {
      const toggle = subNavigation.locator(".teacher-settings-menu-toggle");
      await toggle.focus();
      await page.keyboard.press("Enter");
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    }
    assert.deepEqual(await titles.allTextContents(), [firstTitle, secondTitle]);
    assert.equal(await navItems.nth(0).getAttribute("aria-current"), "true");
    const titleGeometry = await titles.evaluateAll((nodes) =>
      nodes.map((node) => ({
        title: node.title,
        height: node.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(node).lineHeight),
        lineClamp: getComputedStyle(node).webkitLineClamp,
        border: parseFloat(
          getComputedStyle(node.closest("button")).borderBottomWidth,
        ),
      })),
    );
    for (const [index, item] of titleGeometry.entries()) {
      assert.equal(item.title, [firstTitle, secondTitle][index]);
      assert.equal(item.lineClamp, "2");
      assert.ok(item.height <= item.lineHeight * 2 + 1, JSON.stringify(item));
      assert.ok(item.border >= 1, JSON.stringify(item));
    }
    let sidebarGeometry = null;
    if (width === 1280) {
      sidebarGeometry = await page.evaluate(() => {
        const main = document
          .querySelector('[aria-label="학생 메뉴"]')
          .getBoundingClientRect();
        const sub = document
          .querySelector('[aria-label="수행평가 목록"]')
          .getBoundingClientRect();
        const content = document
          .querySelector(".performance-score-workspace > .teacher-sub-content")
          .getBoundingClientRect();
        return {
          main: { x: main.x, right: main.right },
          sub: { x: sub.x, right: sub.right, width: sub.width },
          content: { x: content.x },
        };
      });
      assert.equal(sidebarGeometry.main.x, 0);
      assert.ok(
        Math.abs(sidebarGeometry.sub.x - sidebarGeometry.main.right) <= 1,
        JSON.stringify(sidebarGeometry),
      );
      assert.ok(
        sidebarGeometry.content.x >= sidebarGeometry.sub.right - 1,
        JSON.stringify(sidebarGeometry),
      );
      assert.ok(
        titleGeometry.some((item) => item.height >= item.lineHeight * 2 - 1),
      );
    }
    await navItems.nth(1).focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("heading", { name: secondTitle, exact: true })
      .waitFor();
    assert.equal(await navItems.nth(1).getAttribute("aria-current"), "true");
    assert.equal(await navItems.nth(0).getAttribute("aria-current"), null);
    if (width < 768) {
      const toggle = subNavigation.getByRole("button", {
        name: /수행평가 목록 메뉴 펼치기/,
      });
      await toggle.click();
      await page.keyboard.press("Escape");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert.equal(
        await toggle.evaluate((button) => button === document.activeElement),
        true,
      );
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: `${out}/student-sidebar-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`student-sidebar-${width}.png`);
    report.layoutMetrics.push({
      width,
      consentGeometry,
      titleGeometry,
      sidebarGeometry,
    });
    const initialReview = await openSignatureReview(page);
    assert.equal(
      await initialReview.getByText(secondTitle, { exact: true }).count(),
      0,
    );
    await initialReview.getByText(firstTitle, { exact: true }).waitFor();
    await initialReview
      .getByRole("button", { name: "제출하기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "점수 확인 완료 1/1", exact: true })
      .waitFor();
    const firstConfirmation = await page.evaluate(() =>
      structuredClone([...window.studentScoreQa.confirmations.values()][0]),
    );
    assert.equal(
      await page.evaluate(
        () => window.studentScoreQa.latestSignature()?.rosterId,
      ),
      "qa-score",
    );
    await page.evaluate(() => {
      const state = window.studentScoreQa;
      const second = state.serverRecords.get("qa-blank");
      state.serverRecords.set("qa-blank", {
        ...second,
        totalScore: 17,
        enteredScoreCount: 1,
        items: second.items.map((item) => ({
          ...item,
          score: 17,
          scoreEntered: true,
        })),
        updatedAt: { seconds: ++state.clock },
      });
      state.remount();
    });
    await page
      .getByRole("button", { name: "점수 확인 및 서명하기", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.studentScoreQa.latestSignature()),
      null,
    );
    const secondReview = await openSignatureReview(page);
    assert.equal(
      await secondReview.getByText(firstTitle, { exact: true }).count(),
      0,
    );
    await secondReview.getByText(secondTitle, { exact: true }).waitFor();
    await secondReview
      .getByRole("button", { name: "제출하기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "점수 확인 완료 2/2", exact: true })
      .waitFor();
    assert.deepEqual(
      await page.evaluate(() =>
        window.studentScoreQa.confirmations.get(
          "users/qa-student/performance_scores/qa-score/confirmations/qa-student",
        ),
      ),
      firstConfirmation,
    );
    assert.equal(
      await page.evaluate(
        () => window.studentScoreQa.latestSignature()?.rosterId,
      ),
      "qa-blank",
    );
    const secondConfirmation = await page.evaluate(() =>
      structuredClone(
        window.studentScoreQa.confirmations.get(
          "users/qa-student/performance_scores/qa-blank/confirmations/qa-student",
        ),
      ),
    );
    await page.screenshot({
      path: `${out}/second-assessment-signed-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`second-assessment-signed-${width}.png`);
    await page.evaluate(() => {
      const state = window.studentScoreQa;
      const first = state.serverRecords.get("qa-score");
      state.serverRecords.set("qa-score", {
        ...first,
        totalScore: 16,
        items: first.items.map((item) => ({ ...item, score: 16 })),
        updatedAt: { seconds: ++state.clock },
      });
      state.remount();
    });
    await page
      .getByRole("button", { name: "점수 확인 및 서명하기", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.studentScoreQa.latestSignature()),
      null,
    );
    const revisedReview = await openSignatureReview(page);
    await revisedReview.getByText(firstTitle, { exact: true }).waitFor();
    assert.equal(
      await revisedReview.getByText(secondTitle, { exact: true }).count(),
      0,
    );
    await revisedReview
      .getByRole("button", { name: "제출하기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "점수 확인 완료 2/2", exact: true })
      .waitFor();
    const finalState = await page.evaluate(() => ({
      writes: window.studentScoreQa.events
        .filter((event) => event.name === "signature")
        .map((event) => event.rosterId),
      first: window.studentScoreQa.confirmations.get(
        "users/qa-student/performance_scores/qa-score/confirmations/qa-student",
      ),
      second: window.studentScoreQa.confirmations.get(
        "users/qa-student/performance_scores/qa-blank/confirmations/qa-student",
      ),
      latest: window.studentScoreQa.latestSignature()?.rosterId,
    }));
    assert.deepEqual(finalState.writes, ["qa-score", "qa-blank", "qa-score"]);
    assert.deepEqual(finalState.second, secondConfirmation);
    assert.equal(finalState.latest, "qa-score");
    assert.ok(
      finalState.first.confirmedAt.seconds >
        finalState.second.confirmedAt.seconds,
    );
    await page.evaluate(() => window.studentScoreQa.remount());
    await page
      .getByRole("button", { name: "점수 확인 완료 2/2", exact: true })
      .waitFor();
    await page.screenshot({
      path: `${out}/first-assessment-resigned-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`first-assessment-resigned-${width}.png`);
    await page.close();
    console.log(`PASS final-signature layout/lifecycle ${width}`);
  }
  report.checks.push(
    "390/768/1280 actual MainLayout/Header: consent CTA is centered, at least 56px high with 18px text, capped at 384px and keyboard operable; performance list shows assessment-order-sorted two-line titles, divider borders, full title tooltips and selected-state changes. Desktop secondary sidebar adjoins the main rail; mobile disclosure supports Enter/Escape and returns focus; page does not overflow.",
    "390/768/1280 actual load/signature path: sign A with B blank (1/1), register B and reload (only B pending), sign B (2/2/latest B, original A confirmation unchanged), change A and reload (only A pending; final signature withheld), re-sign A (2/2/latest A, B confirmation unchanged), reload completion preserved. Exactly A/B/A confirmation writes; no product or production data writes.",
  );
  const concurrent = await createPage(1280, "?layout");
  const concurrentReview = await openSignatureReview(concurrent);
  await concurrent.evaluate((title) => {
    const state = window.studentScoreQa;
    state.afterSignatureCommit = () => {
      state.afterSignatureCommit = undefined;
      const first = state.serverRecords.get("qa-score");
      state.serverRecords.set("qa-blank", {
        ...first,
        id: "qa-blank",
        rosterId: "qa-blank",
        title,
        assessmentOrder: 2,
        enteredScoreCount: 1,
        totalScore: 17,
        items: [
          { name: "판단 글쓰기", score: 17, maxScore: 20, scoreEntered: true },
        ],
        updatedAt: { seconds: ++state.clock },
      });
    };
  }, secondTitle);
  await concurrentReview
    .getByRole("button", { name: "제출하기", exact: true })
    .click();
  await concurrentReview.waitFor({ state: "hidden" });
  await concurrent
    .getByRole("button", { name: "점수 확인 및 서명하기", exact: true })
    .waitFor();
  assert.equal(
    await concurrent.getByRole("button", { name: /점수 확인 완료/ }).count(),
    0,
  );
  await concurrent.waitForFunction(() =>
    window.studentScoreQa.toasts.some((toast) =>
      toast.message.includes("추가되거나 변경된 점수"),
    ),
  );
  const concurrentState = await concurrent.evaluate(() => ({
    writes: window.studentScoreQa.events
      .filter((event) => event.name === "signature")
      .map((event) => event.rosterId),
    reads: window.studentScoreQa.events.filter(
      (event) => event.name === "scoreListRead",
    ),
    latest: window.studentScoreQa.latestSignature(),
    first: window.studentScoreQa.confirmations.get(
      "users/qa-student/performance_scores/qa-score/confirmations/qa-student",
    ),
  }));
  assert.deepEqual(concurrentState.writes, ["qa-score"]);
  assert.ok(
    concurrentState.reads.length >= 2 &&
      concurrentState.reads.every((event) => event.fromServer === true),
  );
  assert.equal(concurrentState.latest, null);
  await selectAssessment(concurrent, secondTitle);
  await concurrent.screenshot({
    path: `${out}/concurrent-new-assessment-pending.png`,
    fullPage: true,
  });
  report.screenshots.push("concurrent-new-assessment-pending.png");
  const discoveredReview = await openSignatureReview(concurrent);
  assert.equal(
    await discoveredReview.getByText(firstTitle, { exact: true }).count(),
    0,
  );
  await discoveredReview.getByText(secondTitle, { exact: true }).waitFor();
  await discoveredReview
    .getByRole("button", { name: "제출하기", exact: true })
    .click();
  await concurrent
    .getByRole("button", { name: "점수 확인 완료 2/2", exact: true })
    .waitFor();
  assert.deepEqual(
    await concurrent.evaluate(() =>
      window.studentScoreQa.confirmations.get(
        "users/qa-student/performance_scores/qa-score/confirmations/qa-student",
      ),
    ),
    concurrentState.first,
  );
  await concurrent.close();
  const failedRefresh = await createPage(1280, "?layout&blank-pair");
  const failureReview = await openSignatureReview(failedRefresh);
  await failedRefresh.evaluate(() => {
    const state = window.studentScoreQa;
    state.afterSignatureCommit = () => {
      state.afterSignatureCommit = undefined;
      state.failNextScoreListRead = true;
    };
  });
  await failureReview
    .getByRole("button", { name: "제출하기", exact: true })
    .click();
  await failedRefresh
    .getByRole("alert")
    .filter({
      hasText:
        "서명은 저장되었지만 최신 점수를 확인하지 못했습니다. 다시 시도해 주세요.",
    })
    .waitFor();
  assert.equal(
    await failedRefresh.getByRole("button", { name: /점수 확인 완료/ }).count(),
    0,
  );
  assert.equal(
    await failedRefresh
      .getByRole("button", { name: "점수 확인 및 서명하기", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await failedRefresh.evaluate(
      () => window.studentScoreQa.confirmations.size,
    ),
    1,
  );
  await failedRefresh.screenshot({
    path: `${out}/post-signature-refresh-error.png`,
    fullPage: true,
  });
  report.screenshots.push("post-signature-refresh-error.png");
  await failedRefresh
    .getByRole("button", { name: "다시 시도", exact: true })
    .click();
  await failedRefresh
    .getByRole("button", { name: "점수 확인 완료 1/1", exact: true })
    .waitFor();
  assert.deepEqual(
    await failedRefresh.evaluate(() =>
      window.studentScoreQa.events
        .filter((event) => event.name === "signature")
        .map((event) => event.rosterId),
    ),
    ["qa-score"],
  );
  await failedRefresh.close();
  report.checks.push(
    "A new B record published during A's signature commit is discovered by the actual fromServer full-list reload and remains unsigned; completion is withheld, additional-confirmation feedback is shown, and the next review signs only B while preserving A's confirmation.",
    "When the post-signature server list read fails, A's persisted confirmation remains, neither completion nor signing is falsely displayed, an actionable load error appears, and retry recovers 1/1 without writing another signature.",
  );
  console.log(
    "PASS concurrent assessment publication and post-signature reload failure",
  );
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
        () =>
          window.studentScoreQa.events.find(
            (event) => event.name === "objection",
          ).input.answerSheetRequested,
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
    () =>
      window.studentScoreQa.events.find((event) => event.name === "objection")
        .input,
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
} catch (error) {
  report.failure = String(error?.stack || error);
  for (const [index, page] of (
    browser?.contexts().flatMap((context) => context.pages()) || []
  ).entries()) {
    await page
      .screenshot({ path: `${out}/failure-${index}.png`, fullPage: true })
      .catch(() => {});
    await fs.writeFile(
      `${out}/failure-${index}.html`,
      await page.content().catch(() => ""),
    );
  }
  await fs.writeFile(
    out + "/student-objection-report.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
