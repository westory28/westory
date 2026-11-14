// Actual student components; service doubles and fictitious records only.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
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
let workbookScore = null;
if (process.env.SCORE_QA_WORKBOOK) {
  assert.ok(
    process.argv.includes("--serve-only"),
    "SCORE_QA_WORKBOOK is available only for the isolated --serve-only preview",
  );
  const ts = require("typescript");
  const { default: readXlsxFile } = await import("read-excel-file/node");
  const loadParserModule = async (file, dependencies) => {
    const exports = {};
    const code = ts.transpileModule(
      await fs.readFile(path.join(root, file), "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
        },
      },
    ).outputText;
    vm.runInNewContext(code, {
      exports,
      TextEncoder,
      require: (id) => {
        assert.ok(id in dependencies, `Unexpected parser dependency: ${id}`);
        return dependencies[id];
      },
    });
    return exports;
  };
  const scoreHelpers = await loadParserModule("src/lib/performanceScores.ts", {
    "firebase/firestore": {},
    "./firebase": {},
    "./semesterScope": {},
  });
  const { parseWrittenExamEssayScoreWorkbook } = await loadParserModule(
    "src/lib/writtenExamEssayScoreWorkbook.ts",
    {
      "./performanceScores": scoreHelpers,
      "./writtenExamFeedback": await loadParserModule("src/lib/writtenExamFeedback.ts", {}),
    },
  );
  const workbookPath = path.resolve(process.env.SCORE_QA_WORKBOOK);
  const workbook = await readXlsxFile(await fs.readFile(workbookPath));
  const rows = Array.isArray(workbook[0]?.data) ? workbook[0].data : workbook;
  const parsed = parseWrittenExamEssayScoreWorkbook(rows, {
    fileName: path.basename(workbookPath),
    targetGrade: "3",
    fallbackClass: "1",
    maxScore: 10,
  });
  const first = parsed.rows[0];
  assert.ok(first, "The workbook must contain a student score row");
  // Only grading content enters the fixture; real identity and roster IDs do not.
  workbookScore = {
    items: first.items,
    enteredScoreCount: first.enteredScoreCount,
    totalScore: first.totalScore,
    totalMaxScore: first.totalMaxScore,
    feedback: first.feedback,
    evidence: first.evidence,
  };
}
const mocks = {
  "qa-state": `
const scenario=new URLSearchParams(location.search);
const workbookScore=${JSON.stringify(workbookScore)};
if(workbookScore)scenario.set('written','');
export const state={scenario,workbookLoaded:Boolean(workbookScore),events:[],toasts:[],objections:[],legacy:[],hold:false,fail:false,clock:1801850500,consented:!scenario.has('noconsent')};
const written=scenario.has('written');
export const records=[{id:'qa-score',rosterId:'qa-score',uid:'qa-student',scoreKind:written?'written_exam_essay':'performance',title:written?'가상 정기시험':'사료 해석과 역사적 판단을 설명하는 수행평가',subject:'역사',academicYear:'2026',semester:'2',grade:'3',class:'1',number:'1',studentName:'가상학생',items:written?[{name:'1-(1)',itemKey:'1-(1)',score:7,maxScore:10},{name:'1-(2)',itemKey:'1-(2)',score:8,maxScore:10}]:[{name:'자료 해석',score:15,maxScore:20}],totalScore:15,totalMaxScore:20,feedback:'자료를 읽고 근거를 잘 정리했습니다.',evidence:'가상 채점 근거',updatedAt:{seconds:1801850400},...(scenario.has('signed')?{signatureName:'가상학생',signatureImage:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='}:{})}];
if(written){
 const reasons=['핵심 용어를 정확히 썼습니다.','근거를 일부 설명했습니다.\\n\\n\\n시대적 배경도 덧붙여 주세요.','제도 이름이 다릅니다. 답안의 (1) 표현을 다시 확인해 주세요.','사료와 주장을 연결해 설명해 주세요.'];
 const evidence=reasons.map((reason,index)=>'('+(index+1)+') '+reason).join('\\n\\n');
 records[0]={...records[0],items:reasons.map((feedback,index)=>({name:'1-('+(index+1)+')',shortName:'1-('+(index+1)+')',itemKey:'1-('+(index+1)+')',groupKey:'1',groupLabel:'1번',score:[1,1,0,0][index],maxScore:[1,3,1,5][index],scoreEntered:true,feedback})),enteredScoreCount:4,totalScore:2,totalMaxScore:10,feedback:evidence,evidence};
 if(scenario.has('general-note'))records[0].evidence='전체 답안에서 사료의 근거를 확인해 주세요.\\n\\n'+evidence+'\\n\\n(9) 교사의 추가 설명을 확인해 주세요.';
}
if(workbookScore)records[0]={...records[0],...workbookScore,title:'업로드 파일 검증용 가상 정기시험'};
if(scenario.has('legacy'))state.legacy.push({id:'qa-legacy',uid:'qa-student',scoreId:'qa-score',status:'pending',reason:'기존 답안지 확인 요청'});
if(scenario.has('blank-pair')||scenario.has('blank-only')||scenario.has('registered-pair')){
 records[0]={...records[0],title:'1차 역사 자료 해석',assessmentOrder:1,enteredScoreCount:1,items:[{name:'자료 해석',score:15,maxScore:20,scoreEntered:true}]};
 records.push({...records[0],id:'qa-blank',rosterId:'qa-blank',title:'2차 역사적 판단 글쓰기',assessmentOrder:2,enteredScoreCount:0,totalScore:0,items:[{name:'판단 글쓰기',score:0,maxScore:20,scoreEntered:false}],feedback:'',evidence:''});
 if(scenario.has('blank-only'))records.shift();
 if(scenario.has('registered-pair'))records[1]={...records[1],enteredScoreCount:1,items:[{...records[1].items[0],scoreEntered:true}]};
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
 if(scenario.has('legacy-order'))delete records[0].assessmentOrder;
 if(records[1])records[1].title='조선 시대 신분 질서와 변화의 모습을 설명하기';
 records.reverse();
}
state.records=records;state.serverRecords=new Map(records.map(record=>[record.id,structuredClone(record)]));state.confirmations=new Map();
if(scenario.has('added-after-signature'))state.afterSignatureCommit=()=>{state.afterSignatureCommit=undefined;const first=state.serverRecords.get('qa-score');state.serverRecords.set('qa-added',{...structuredClone(first),id:'qa-added',rosterId:'qa-added',title:'추가된 가상 시험',updatedAt:{seconds:++state.clock}});};
if(scenario.has('failed-signature-refresh'))state.afterSignatureCommit=()=>{state.afterSignatureCommit=undefined;state.failNextScoreListRead=true;};
if(scenario.has('signed'))for(const record of records)state.confirmations.set('users/qa-student/performance_scores/'+record.id+'/confirmations/qa-student',{uid:record.uid,rosterId:record.rosterId,signatureName:record.signatureName,signatureImage:record.signatureImage,scoreUpdatedAt:record.updatedAt,confirmedAt:{seconds:1801850450}});
window.studentScoreQa=state;
`,
  "qa-auth": `import{state}from'qa-state';import{MENUS}from'${root}/src/constants/menus.ts';const noop=async()=>{};const auth={currentUser:{uid:'qa-student',email:'qa-student@example.test'},userData:{uid:'qa-student',role:'student',name:'가상학생',grade:'3',class:'1',number:'1',enrollmentStatus:state.scenario.has('excluded')?'transferred':'active'},config:{year:'2026',semester:'2',showScore:true},loading:false,authPhase:'ready',authError:null,retryAuth:noop,logout:noop,configReady:true,menuConfig:MENUS,menuConfigReady:true,interfaceConfig:{},interfaceConfigReady:true,settingsLoadedAt:Date.now(),refreshConfig:noop,refreshMenuConfig:noop,refreshInterfaceConfig:noop};export const useAuth=()=>auth;`,
  "qa-firebase": `export const db={};export const auth={currentUser:{uid:'qa-student'}};export const getHttpsCallable=async()=>{throw new Error('Unexpected live callable')};`,
  "qa-firestore": `import{state}from'qa-state';
export const collection=(db,...parts)=>({path:parts.join('/')});export const doc=(db,...parts)=>({path:parts.join('/'),id:parts.at(-1)});export const query=(ref)=>ref;export const orderBy=()=>({});export const where=()=>({});
const readScores=async(ref,fromServer)=>{if(ref.path!=='users/qa-student/performance_scores')throw new Error('Unexpected score collection '+ref.path);state.events.push({name:'scoreListRead',fromServer});if(state.scenario.has('loaderror')||state.failNextScoreListRead){state.failNextScoreListRead=false;throw new Error('Synthetic read failure');}return{docs:[...state.serverRecords.values()].map(record=>({id:record.id,data:()=>structuredClone(record)}))};};
export const getDocs=(ref)=>readScores(ref,false);export const getDocsFromServer=(ref)=>readScores(ref,true);
export const onSnapshot=()=>{throw new Error('Unexpected realtime subscription');};
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
  "qa-rank-promotion": `import {resolvePointRankPolicy} from '${root}/src/lib/pointRanks.ts';export const loadStudentRankPromotionSnapshot=async()=>({rank:null,wallet:{balance:0},policy:{rankPolicy:resolvePointRankPolicy()}});export const invalidateStudentRankPromotionSnapshotCache=()=>{};`,
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
};
const bundle = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import MainLayout from'${root}/src/components/layout/MainLayout';import{ScoreConfirmationView}from'${root}/src/pages/student/score/PerformanceScoreView';import{state}from'qa-state';
const QaControls=()=>{const[snapshot,setSnapshot]=React.useState('');return <details style={{margin:24,padding:16,border:'1px solid #cbd5e1',background:'#f8fafc'}}><summary>격리 검증 도구 · {state.workbookLoaded ? '가상 신원·업로드 파일 내용' : '가상 자료만 사용'}</summary><p>운영 Firebase에 연결하지 않는 학생 화면입니다.</p><button style={{margin:8,padding:12,border:'1px solid #64748b'}} onClick={()=>state.remount()}>서버 자료 다시 불러오기</button><button style={{margin:8,padding:12,border:'1px solid #64748b'}} onClick={()=>setSnapshot(JSON.stringify({scores:[...state.serverRecords.values()].map(record=>({id:record.id,scoreKind:record.scoreKind,totalScore:record.totalScore,totalMaxScore:record.totalMaxScore,items:record.items})),confirmations:[...state.confirmations].map(([path,value])=>({path,uid:value.uid,rosterId:value.rosterId,signatureName:value.signatureName,hasSignatureImage:Boolean(value.signatureImage),scoreUpdatedAt:value.scoreUpdatedAt,confirmedAt:value.confirmedAt})),finalSignatureReady:Boolean(state.latestSignature()),events:state.events},null,2))}>저장 및 재조회 결과 보기</button><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{snapshot}</pre></details>;};
const root=createRoot(document.getElementById('root'));let revision=0;state.remount=()=>{const score=<ScoreConfirmationView key={++revision} scoreKind={state.scenario.has('written')?'written_exam_essay':'performance'}/>;root.render(<MemoryRouter initialEntries={['/student/score/performance']}>{state.scenario.has('layout')?<MainLayout>{score}</MainLayout>:score}{state.scenario.has('qa-controls')&&<QaControls/>}</MemoryRouter>);};state.remount();`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "browser",
  loader: { ".css": "empty", ".webp": "dataurl" },
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
      "src/components/common/portalPage.css",
      "src/components/common/InfoHelp.css",
      "src/components/common/headerStudentWis.css",
      "src/components/common/brandLogo.css",
      "src/components/common/Footer.css",
      "src/components/layout/teacherLayout.css",
      "src/components/layout/studentLayout.css",
      "src/pages/student/score/performance-score-view.css",
    ].map((file) => fs.readFile(root + "/" + file, "utf8")),
  )
)
  .join("\n")
  .replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g, "")
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
await new Promise((resolve) =>
  server.listen(Number(process.env.SCORE_QA_PORT) || 0, "127.0.0.1", resolve),
);
const origin = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes("--serve-only")) {
  console.log(
    JSON.stringify({
      kind: "synthetic-student-score-server",
      origin,
      scenarios: [
        "?written&qa-controls",
        "?written&general-note&qa-controls",
        "?written&added-after-signature&qa-controls",
        "?written&failed-signature-refresh&qa-controls",
      ],
      workbookPreview: workbookScore
        ? {
            sourceFileName: path.basename(process.env.SCORE_QA_WORKBOOK),
            itemCount: workbookScore.items.length,
            totalScore: workbookScore.totalScore,
            totalMaxScore: workbookScore.totalMaxScore,
            identity: "qa-student / 가상학생",
          }
        : null,
      limitations:
        "Fictitious identity and memory services only. An optional local workbook contributes grading content only. No Firebase SDK, production writes, original workbook edits or real student signatures.",
    }),
  );
  await new Promise(() => {});
}
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
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
    });
    page.on("pageerror", (error) => {
      report.pageErrors.push(error.message);
      console.error("Student score fixture:", error.message);
    });
    page.on("dialog", (dialog) => dialog.accept());
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin + query);
    return page;
  };
  const signAction = (page) =>
    page.getByRole("button", {
      name: "점수 확인 및 서명하기",
      exact: true,
    });
  const drawSignature = async (page, signing) => {
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
  };
  const openSignatureReview = async (page, ordinals = [1]) => {
    for (const ordinal of ordinals) await selectAssessment(page, ordinal);
    assert.equal(await signAction(page).isEnabled(), true);
    await signAction(page).click();
    const signing = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "수행평가 점수 확인 및 서명",
        exact: true,
      }),
    });
    const reviewAction = signing.getByRole("button", {
      name: "확인 내용 검토",
      exact: true,
    });
    assert.equal(
      await reviewAction.count(),
      0,
      "Consent and signature are required before review is shown",
    );
    assert.equal(
      await signing
        .getByRole("button", { name: "제출하기", exact: true })
        .count(),
      0,
    );
    await signing
      .getByRole("button", { name: "동의합니다", exact: true })
      .click();
    assert.equal(
      await reviewAction.count(),
      0,
      "Consent alone must not show review",
    );
    await drawSignature(page, signing);
    assert.equal(await reviewAction.isEnabled(), true);
    await signing
      .getByRole("button", { name: "확인 내용 검토", exact: true })
      .click();
    await signing
      .getByRole("button", { name: "제출하기", exact: true })
      .waitFor();
    assert.equal(
      await signing
        .getByRole("button", { name: "제출하기", exact: true })
        .isEnabled(),
      true,
    );
    return signing;
  };
  const assessmentChoice = (page, ordinal) =>
    page
      .getByRole("navigation", { name: "수행평가 목록 메뉴", exact: true })
      .getByRole("button", { name: `${ordinal}차 수행평가`, exact: true });
  const selectAssessment = async (page, ordinal) => {
    await assessmentChoice(page, ordinal).click();
  };
  const selectBlankAssessment = async (page) => {
    await selectAssessment(page, 2);
    await page
      .getByRole("heading", { name: "2차 역사적 판단 글쓰기", exact: true })
      .waitFor();
  };
  const firstTitle = "하여가와 단심가 다시 쓰기(논술형)";
  const secondTitle = "조선 시대 신분 질서와 변화의 모습을 설명하기";
  for (const width of [320, 390, 768, 1280, 1440]) {
    const page = await createPage(
      width,
      `?layout&registered-pair${width === 768 ? "&legacy-order" : ""}`,
    );
    await assessmentChoice(page, 1).waitFor();
    assert.deepEqual(
      await page.locator(".performance-score-tab > button").allTextContents(),
      ["1차 수행평가", "2차 수행평가"],
    );
    const tabStyles = await page
      .locator(".performance-score-tab > button")
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const style = getComputedStyle(button);
          return {
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            color: style.color,
            height: button.getBoundingClientRect().height,
          };
        }),
      );
    for (const style of tabStyles) {
      assert.equal(style.fontSize, "18px");
      assert.equal(style.fontWeight, "800");
      assert.equal(style.color, "rgb(30, 58, 138)");
      assert.ok(style.height >= 56);
    }
    await page.screenshot({
      path: `${out}/assessment-choices-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`assessment-choices-${width}.png`);
    const firstHeading = page.getByRole("heading", {
      name: firstTitle,
      exact: true,
    });
    await assessmentChoice(page, 1).waitFor();
    assert.equal(await firstHeading.count(), 0);
    assert.equal(await signAction(page).isDisabled(), true);
    const help = page.getByRole("button", {
      name: "2차 수행평가 전체 평가명",
      exact: true,
    });
    const tooltip = page.getByRole("tooltip").filter({ hasText: secondTitle });
    if (width === 390) {
      await help.tap();
    } else {
      await help.hover();
      await tooltip.waitFor();
      await page.mouse.move(1, 1);
      await assessmentChoice(page, 2).focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await help.evaluate((button) => document.activeElement === button),
        true,
      );
    }
    await tooltip.waitFor();
    assert.equal(await help.getAttribute("aria-expanded"), "true");
    assert.equal(await firstHeading.count(), 0);
    assert.equal(await signAction(page).isDisabled(), true);
    await page.keyboard.press("Escape");
    await tooltip.waitFor({ state: "hidden" });
    assert.equal(
      await assessmentChoice(page, 1).getAttribute("aria-current"),
      null,
    );
    await assessmentChoice(page, 2).focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("heading", { name: secondTitle, exact: true })
      .waitFor();
    assert.equal(await signAction(page).isDisabled(), true);
    await selectAssessment(page, 2);
    assert.equal(await signAction(page).isDisabled(), true);
    await selectAssessment(page, 1);
    assert.equal(await signAction(page).isEnabled(), true);
    assert.equal(
      await page.evaluate(() => window.studentScoreQa.confirmations.size),
      0,
    );
    await page.evaluate(() => window.studentScoreQa.remount());
    await firstHeading.waitFor({ state: "hidden" });
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some(
        (button) =>
          button.textContent.trim() === "점수 확인 및 서명하기" &&
          button.disabled,
      ),
    );
    await selectAssessment(page, 1);
    assert.equal(await signAction(page).isDisabled(), true);
    await selectAssessment(page, 2); // An explicitly registered zero still requires review.
    assert.equal(await signAction(page).isEnabled(), true);
    assert.equal(
      await page.evaluate(() => window.studentScoreQa.confirmations.size),
      0,
    );
    const signing = await openSignatureReview(page, [1, 2]);
    await signing
      .getByRole("button", { name: "서명 수정", exact: true })
      .click();
    const reviewAction = signing.getByRole("button", {
      name: "확인 내용 검토",
      exact: true,
    });
    assert.equal(
      await reviewAction.count(),
      0,
      "Editing requires a new signature",
    );
    await drawSignature(page, signing);
    assert.equal(await reviewAction.isEnabled(), true);
    await signing.getByRole("button", { name: "지우기", exact: true }).click();
    assert.equal(
      await reviewAction.count(),
      0,
      "Clearing a signature hides review",
    );
    await drawSignature(page, signing);
    await signing
      .getByRole("button", { name: "동의 완료", exact: true })
      .click();
    assert.equal(
      await reviewAction.count(),
      0,
      "Revoking consent hides review",
    );
    assert.equal(
      await signing
        .getByLabel("점수 확인 서명 그리기 칸", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: `${out}/signature-incomplete-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`signature-incomplete-${width}.png`);
    await signing
      .getByRole("button", { name: "동의합니다", exact: true })
      .click();
    assert.equal(
      await reviewAction.count(),
      0,
      "Re-consent must not reuse the cleared signature",
    );
    await drawSignature(page, signing);
    await reviewAction.click();
    assert.equal(
      await signing
        .getByRole("button", { name: "제출하기", exact: true })
        .isEnabled(),
      true,
    );
    assert.equal(
      await page.evaluate(() => window.studentScoreQa.confirmations.size),
      0,
    );
    await page.close();
  }
  report.checks.push(
    "320/390/768/1280/1440: prominent assessment choices, keyboard/help navigation and explicit visits to both registered assessments. Consent plus a drawn signature reveals review/submission; edit, clear and revoked consent hide it again, including after re-consent. No signature writes or document overflow.",
  );
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
    await assessmentChoice(page, 1).waitFor();
    assert.equal(
      await page.evaluate(() => window.studentScoreQa.consented),
      true,
    );
    const subNavigation = page.getByRole("navigation", {
      name: "수행평가 목록 메뉴",
      exact: true,
    });
    const navItems = subNavigation.getByRole("button", {
      name: /^\d+차 수행평가$/,
    });
    assert.equal(await navItems.count(), 2);
    assert.equal(await navItems.nth(0).getAttribute("aria-current"), null);
    const titleGeometry = await navItems.evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.getAttribute("aria-label") || node.textContent.trim(),
        height: node.getBoundingClientRect().height,
        width: node.getBoundingClientRect().width,
      })),
    );
    for (const [index, item] of titleGeometry.entries()) {
      assert.match(item.label, new RegExp(`${index + 1}차 수행평가`));
      assert.ok(item.height > 0 && item.width > 0, JSON.stringify(item));
    }
    await navItems.nth(1).focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("heading", { name: secondTitle, exact: true })
      .waitFor();
    assert.equal(await navItems.nth(1).getAttribute("aria-current"), "page");
    assert.equal(await navItems.nth(0).getAttribute("aria-current"), null);
    const tabs = await subNavigation.boundingBox();
    const details = await page
      .getByRole("heading", { name: secondTitle, exact: true })
      .boundingBox();
    assert.ok(tabs && details && tabs.y + tabs.height <= details.y + 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: `${out}/student-score-tabs-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`student-score-tabs-${width}.png`);
    report.layoutMetrics.push({
      width,
      consentGeometry,
      titleGeometry,
      tabs,
    });
    assert.equal(await signAction(page).isDisabled(), true);
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
    assert.equal(await signAction(page).isDisabled(), true);
    const secondReview = await openSignatureReview(page, [1, 2]);
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
    assert.equal(await signAction(page).isDisabled(), true);
    const revisedReview = await openSignatureReview(page, [2, 1]);
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
    "390/768/1280 actual MainLayout/Header: consent CTA is centered, at least 56px high with 18px text, capped at 384px and keyboard operable. Assessment-order tabs sit above the selected details, support keyboard activation, and do not overflow the page.",
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
  const [concurrentAlert] = await Promise.all([
    concurrent.waitForEvent("dialog"),
    concurrentReview
      .getByRole("button", { name: "제출하기", exact: true })
      .click(),
  ]);
  assert.match(concurrentAlert.message(), /추가되거나 변경된 점수/);
  await concurrentReview.waitFor({ state: "hidden" });
  await concurrent
    .getByRole("button", { name: "점수 확인 및 서명하기", exact: true })
    .waitFor();
  assert.equal(
    await concurrent.getByRole("button", { name: /점수 확인 완료/ }).count(),
    0,
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
  await selectAssessment(concurrent, 2);
  await concurrent
    .getByRole("heading", { name: secondTitle, exact: true })
    .waitFor();
  await concurrent.screenshot({
    path: `${out}/concurrent-new-assessment-pending.png`,
    fullPage: true,
  });
  report.screenshots.push("concurrent-new-assessment-pending.png");
  const discoveredReview = await openSignatureReview(concurrent, [1, 2]);
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
    await selectBlankAssessment(page);
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
  await selectAssessment(blankOnly, 2);
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
  const published = await createPage(1280, "?layout&blank-pair");
  const publishedReview = await openSignatureReview(published);
  await published.evaluate(() => {
    const state = window.studentScoreQa;
    const second = state.serverRecords.get("qa-blank");
    state.serverRecords.set(second.id, {
      ...second,
      enteredScoreCount: 1,
      totalScore: 0,
      items: second.items.map((item) => ({ ...item, scoreEntered: true })),
      updatedAt: { seconds: ++state.clock },
    });
  });
  await publishedReview
    .getByRole("button", { name: "제출하기", exact: true })
    .click();
  await publishedReview.waitFor({ state: "hidden" });
  await published.waitForFunction(() =>
    window.studentScoreQa.toasts.some(
      (toast) => toast.title === "수행평가 점수가 변경되었습니다.",
    ),
  );
  assert.equal(
    await published.evaluate(() => window.studentScoreQa.confirmations.size),
    0,
  );
  assert.equal(await signAction(published).isDisabled(), true);
  await selectAssessment(published, 1);
  assert.equal(await signAction(published).isDisabled(), true);
  const reviewedPublication = await openSignatureReview(published, [2]);
  await reviewedPublication.getByText(secondTitle, { exact: true }).waitFor();
  await reviewedPublication
    .getByRole("button", { name: "제출하기", exact: true })
    .click();
  await published
    .getByRole("button", { name: "점수 확인 완료 2/2", exact: true })
    .waitFor();
  assert.deepEqual(
    await published.evaluate(() =>
      window.studentScoreQa.events
        .filter((event) => event.name === "signature")
        .map((event) => event.rosterId)
        .sort(),
    ),
    ["qa-blank", "qa-score"],
  );
  // B is the only pending score initially. Editing already signed A while
  // this review is open must invalidate the whole review before B is written.
  const existingSignatures = await published.evaluate(() => [
    ...window.studentScoreQa.confirmations,
  ]);
  const revise = ({ id, remount }) => {
    const state = window.studentScoreQa;
    const score = state.serverRecords.get(id);
    state.serverRecords.set(id, {
      ...score,
      totalScore: score.totalScore + 1,
      items: score.items.map((item, index) =>
        index === 0 ? { ...item, score: item.score + 1 } : item,
      ),
      updatedAt: { seconds: ++state.clock },
    });
    if (remount) state.remount();
  };
  await published.evaluate(revise, { id: "qa-blank", remount: true });
  await signAction(published).waitFor();
  const revisedSibling = await openSignatureReview(published, [1, 2]);
  await published.evaluate(revise, { id: "qa-score", remount: false });
  await revisedSibling
    .getByRole("button", { name: "제출하기", exact: true })
    .click();
  await revisedSibling.waitFor({ state: "hidden" });
  assert.deepEqual(
    await published.evaluate(() => [...window.studentScoreQa.confirmations]),
    existingSignatures,
  );
  assert.equal(await signAction(published).isDisabled(), true);
  await selectAssessment(published, 2);
  assert.equal(await signAction(published).isDisabled(), true);
  await selectAssessment(published, 1);
  assert.equal(await signAction(published).isEnabled(), true);
  await published.close();
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
  await changedSigning.waitFor({ state: "hidden" });
  await changed.waitForFunction(() =>
    window.studentScoreQa.toasts.some(
      (toast) => toast.title === "수행평가 점수가 변경되었습니다.",
    ),
  );
  await changed.getByText("점수 미등록", { exact: true }).first().waitFor();
  assert.equal(
    await changed.evaluate(() => window.studentScoreQa.confirmations.size),
    0,
  );
  assert.ok(
    await changed.evaluate(
      () =>
        window.studentScoreQa.events.filter(
          (event) => event.name === "scoreListRead" && event.fromServer,
        ).length >= 2,
    ),
  );
  await changed.close();
  report.checks.push(
    "Unentered-only records cannot sign or object; an explicitly entered real 0 signs successfully. A newly registered zero at submission and a same-version change to unentered return to refreshed details before any write. Both records sign only after the new score is visited.",
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
    await selectAssessment(page, 1);
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
  await selectAssessment(page, 1);
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
  assert.equal(await signAction(page).isEnabled(), true);
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
  const openWrittenSignatureReview = async (page) => {
    await signAction(page).click();
    const signing = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "정기시험 점수 확인 및 서명",
        exact: true,
      }),
    });
    const review = signing.getByRole("button", {
      name: "확인 내용 검토",
      exact: true,
    });
    const submit = signing.getByRole("button", {
      name: "제출하기",
      exact: true,
    });
    assert.equal(await review.count(), 0);
    assert.equal(await submit.count(), 0);
    await signing
      .getByRole("button", { name: "동의합니다", exact: true })
      .click();
    assert.equal(await review.count(), 0);
    assert.equal(await submit.count(), 0);
    await drawSignature(page, signing);
    await review.click();
    assert.equal(await submit.isEnabled(), true);
    return signing;
  };
  for (const width of [390, 768, 1280]) {
    const writtenSigningPage = await createPage(width, "?written");
    await writtenSigningPage
      .getByRole("heading", {
        name: "1번 논술형 문제 문항별 점수와 피드백",
        exact: true,
      })
      .waitFor();
    const feedback = writtenSigningPage.locator(".performance-score-feedback");
    assert.equal(await feedback.count(), 4);
    assert.deepEqual(await feedback.allTextContents(), [
      "핵심 용어를 정확히 썼습니다.",
      "근거를 일부 설명했습니다.\n시대적 배경도 덧붙여 주세요.",
      "제도 이름이 다릅니다. 답안의 (1) 표현을 다시 확인해 주세요.",
      "사료와 주장을 연결해 설명해 주세요.",
    ]);
    for (const style of await feedback.evaluateAll((elements) =>
      elements.map((element) => ({
        fontSize: getComputedStyle(element).fontSize,
        lineHeight: getComputedStyle(element).lineHeight,
      })),
    )) {
      assert.deepEqual(style, { fontSize: "16px", lineHeight: "24px" });
    }
    const cards = feedback.locator("../..");
    for (const [index, expected] of [
      "1 / 1점",
      "1 / 3점",
      "0 / 1점",
      "0 / 5점",
    ].entries()) {
      assert.ok(
        (await cards.nth(index).textContent())
          .replace(/\s+/g, " ")
          .includes(expected),
      );
    }
    assert.equal(
      await writtenSigningPage
        .getByRole("heading", { name: "전체 피드백", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await writtenSigningPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    const originalScores = await writtenSigningPage.evaluate(() => [
      ...window.studentScoreQa.serverRecords.values(),
    ]);
    assert.ok(
      originalScores[0].evidence.includes("\n\n\n"),
      "Display spacing must not change stored feedback",
    );
    await writtenSigningPage.screenshot({
      path: `${out}/written-feedback-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`written-feedback-${width}.png`);
    const writtenSigning = await openWrittenSignatureReview(writtenSigningPage);
    await writtenSigning
      .getByRole("button", { name: "제출하기", exact: true })
      .click();
    await writtenSigningPage
      .getByRole("button", { name: "점수 확인 완료 1/1", exact: true })
      .waitFor();
    const saved = await writtenSigningPage.evaluate(() => ({
      scores: [...window.studentScoreQa.serverRecords.values()],
      confirmations: [...window.studentScoreQa.confirmations.values()],
      events: window.studentScoreQa.events,
      latest: window.studentScoreQa.latestSignature(),
    }));
    assert.deepEqual(saved.scores, originalScores);
    assert.equal(saved.confirmations.length, 1);
    assert.equal(saved.confirmations[0].uid, "qa-student");
    assert.equal(saved.confirmations[0].rosterId, "qa-score");
    assert.equal(saved.confirmations[0].signatureName, "가상학생");
    assert.ok(
      saved.confirmations[0].signatureImage.startsWith(
        "data:image/png;base64,",
      ),
    );
    assert.deepEqual(
      saved.confirmations[0].scoreUpdatedAt,
      originalScores[0].updatedAt,
    );
    assert.equal(saved.latest.id, "qa-score");
    const signatureEvent = saved.events.findIndex(
      (event) => event.name === "signature",
    );
    assert.ok(signatureEvent >= 0);
    // Written-exam initial loading may use the SDK cache. The safety boundary
    // is one forced-server full-list read before signing and one after commit.
    for (const events of [
      saved.events.slice(0, signatureEvent),
      saved.events.slice(signatureEvent + 1),
    ]) {
      assert.equal(
        events.filter(
          (event) => event.name === "scoreListRead" && event.fromServer,
        ).length,
        1,
      );
    }
    await writtenSigningPage.evaluate(() => window.studentScoreQa.remount());
    await writtenSigningPage
      .getByRole("button", { name: "점수 확인 완료 1/1", exact: true })
      .waitFor();
    assert.equal(
      await writtenSigningPage.evaluate(
        () =>
          window.studentScoreQa.events.filter(
            (event) => event.name === "signature",
          ).length,
      ),
      1,
    );
    await writtenSigningPage.close();
  }
  const writtenGeneral = await createPage(1280, "?written&general-note");
  await writtenGeneral
    .getByRole("heading", { name: "전체 피드백", exact: true })
    .waitFor();
  assert.equal(
    await writtenGeneral
      .locator(".performance-score-feedback")
      .last()
      .textContent(),
    "전체 답안에서 사료의 근거를 확인해 주세요.\n(9) 교사의 추가 설명을 확인해 주세요.",
  );
  await writtenGeneral.close();
  const writtenConcurrent = await createPage(
    1280,
    "?written&added-after-signature",
  );
  const writtenConcurrentReview =
    await openWrittenSignatureReview(writtenConcurrent);
  const [writtenAlert] = await Promise.all([
    writtenConcurrent.waitForEvent("dialog"),
    writtenConcurrentReview
      .getByRole("button", { name: "제출하기", exact: true })
      .click(),
  ]);
  assert.match(writtenAlert.message(), /추가되거나 변경된 점수/);
  assert.equal(
    await writtenConcurrent
      .getByRole("button", { name: /점수 확인 완료/ })
      .count(),
    0,
  );
  assert.equal(
    await writtenConcurrent.evaluate(
      () => window.studentScoreQa.confirmations.size,
    ),
    1,
  );
  assert.equal(
    await writtenConcurrent.evaluate(() =>
      window.studentScoreQa.latestSignature(),
    ),
    null,
  );
  await writtenConcurrent.close();
  const writtenFailedRefresh = await createPage(
    1280,
    "?written&failed-signature-refresh",
  );
  const writtenFailureReview =
    await openWrittenSignatureReview(writtenFailedRefresh);
  await writtenFailureReview
    .getByRole("button", { name: "제출하기", exact: true })
    .click();
  await writtenFailedRefresh
    .getByRole("alert")
    .filter({ hasText: "서명은 저장되었지만 최신 점수를 확인하지 못했습니다." })
    .waitFor();
  assert.equal(
    await writtenFailedRefresh
      .getByRole("button", { name: /점수 확인 완료/ })
      .count(),
    0,
  );
  await writtenFailedRefresh
    .getByRole("button", { name: "다시 시도", exact: true })
    .click();
  await writtenFailedRefresh
    .getByRole("button", { name: "점수 확인 완료 1/1", exact: true })
    .waitFor();
  assert.equal(
    await writtenFailedRefresh.evaluate(
      () =>
        window.studentScoreQa.events.filter(
          (event) => event.name === "signature",
        ).length,
    ),
    1,
  );
  await writtenFailedRefresh.close();
  report.checks.push(
    "Written exams at 390/768/1280 show all four scores (including zero), maxima and feedback at 16px/24px with no duplicated whole feedback, overflow or stored text/score changes. Consent plus a drawn signature reveals the review and submit actions. Synthetic submit verifies the version-bound PNG confirmation, reloads completion and never rewrites scores. New records during submission withhold completion; a post-save read failure recovers without a duplicate signature.",
  );
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
