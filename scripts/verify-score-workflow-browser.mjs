import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import os from "node:os";
const root = path
  .resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  .replaceAll("\\", "/");
const out = path.resolve(
  process.env.SCORE_QA_EVIDENCE_DIR ||
    path.join(root, "..", "evidence", "score-roster-workflow"),
);
await fs.mkdir(out, { recursive: true });
const require = createRequire(root + "/package.json");
const { build } = require("esbuild");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("수행평가");
sheet.addRow(["반", "번호", "성명", "지역사 자료 해석", "역사적 판단 글쓰기"]);
sheet.addRow(["", "", "", "만점(15)", "만점(35)"]);
sheet.addRow(["", "", "", "점수", "점수"]);
for (let i = 1; i <= 32; i++)
  sheet.addRow([
    1,
    i,
    `가상학생${String(i).padStart(2, "0")}`,
    i === 32 ? 0 : 12,
    i === 32 ? 0 : 30,
  ]);
const syntheticBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
const syntheticFile = {
  name: "수행평가 파일일괄등록 - 2026학년도 2학기 주간 3학년 역사_전체_1강의실.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: syntheticBuffer,
};
const makeFixtureFile = async (columns, maxima, rows, suffix = "1") => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("수행평가");
  worksheet.addRow(["반", "번호", "성명", ...columns]);
  worksheet.addRow(["", "", "", ...maxima.map((max) => `만점(${max})`)]);
  worksheet.addRow(["", "", "", ...columns.map(() => "점수")]);
  rows.forEach((row) => worksheet.addRow(row));
  return {
    ...syntheticFile,
    name: syntheticFile.name.replace("1강의실", `${suffix}강의실`),
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
};
const secondOnlyFile = await makeFixtureFile(
  ["역사적 판단 글쓰기"],
  [35],
  [[1, 1, "가상학생01", 30]],
);
const nextClassFile = await makeFixtureFile(
  ["지역사 자료 해석", "역사적 판단 글쓰기"],
  [15, 35],
  [
    [2, 1, "가상학생33", 14, 32],
    [2, 2, "가상학생34", 0, null],
  ],
  "2",
);
const partialBlankFile = await makeFixtureFile(
  ["지역사 자료 해석", "역사적 판단 글쓰기"],
  [15, 35],
  [[1, 2, "가상학생02", null, 0]],
);
const changedCriteriaFile = await makeFixtureFile(
  ["지역사 자료 해석", "역사적 판단 글쓰기"],
  [16, 35],
  [[1, 1, "가상학생01", 12, 30]],
);
const detailedTitle = "하여가와 단심가 다시 쓰기(논술형)";
const detailedCriteria = [
  "고려 말 조선 초의 역사적 맥락 이해하기",
  "정몽주와 이방원의 입장과 가치관 비교하기",
  "선택한 입장을 유교적 통치 이념과 국가 운영 사례로 논증하기",
  "선택한 입장을 새로운 시조로 표현하기",
  "시조의 3장 구조와 4음보 적용하기",
  "시조의 표현 의도와 역사적 의미 설명하기",
];
const detailedMaxima = [6, 6, 6, 4, 4, 4];
const detailedFeedback =
  "1. 사료 해석이 정확합니다.\n2. 두 인물의 입장을 비교했습니다.\n3. 근거를 보완해 주세요.";
const detailedWorkbook = new ExcelJS.Workbook();
const detailedSheet = detailedWorkbook.addWorksheet("채점 결과");
detailedSheet.mergeCells("A1:M1");
detailedSheet.getCell("A1").value = "3-1반 채점 결과";
detailedSheet.mergeCells("A2:M2");
detailedSheet.getCell("A2").value = "평가: " + detailedTitle;
detailedSheet.getRow(4).values = [
  "학년",
  "반",
  "번호",
  "이름",
  "총점",
  ...detailedCriteria,
  "AI 채점 수준",
  "선생님 작성 피드백",
];
for (let index = 1; index <= 32; index += 1) {
  const scores = detailedMaxima.map((max) => (index === 32 ? 0 : max));
  detailedSheet.getRow(index + 4).values = [
    3,
    1,
    index,
    `가상학생${String(index).padStart(2, "0")}`,
    scores.reduce((sum, score) => sum + score, 0),
    ...scores,
    "가상 수준",
    detailedFeedback.replace(/^(\d+)\./gm, "$1\\.").replaceAll("\n", "\\n"),
  ];
}
const detailedFile = {
  name: "채점결과_20261007.xlsx",
  mimeType: syntheticFile.mimeType,
  buffer: Buffer.from(await detailedWorkbook.xlsx.writeBuffer()),
};
const secondDetailedWorkbook = new ExcelJS.Workbook();
await secondDetailedWorkbook.xlsx.load(detailedFile.buffer);
secondDetailedWorkbook.worksheets[0].getCell("A2").value =
  "평가: 가상 두 번째 평가";
const secondDetailedFile = {
  ...detailedFile,
  name: "가상_두번째_채점결과.xlsx",
  buffer: Buffer.from(await secondDetailedWorkbook.xlsx.writeBuffer()),
};
const assertDetailedHairBorders = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const styles = await zip.file("xl/styles.xml").async("string");
  const xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const borders = [
    ...styles.matchAll(/<border\b[^>]*(?:\/>|>[\s\S]*?<\/border>)/g),
  ].map((match) => match[0]);
  const xfs = [
    ...styles
      .match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1]
      .matchAll(/<xf\b[^>]*>/g),
  ].map((match) => Number(match[0].match(/\bborderId="(\d+)"/)?.[1] || 0));
  const cells = new Map(
    [...xml.matchAll(/<c\b[^>]*>/g)].map((match) => [
      match[0].match(/\br="([A-Z]+\d+)"/)?.[1],
      Number(match[0].match(/\bs="(\d+)"/)?.[1] || 0),
    ]),
  );
  const edge = (address, side, expected) => {
    const border = borders[xfs[cells.get(address)]];
    const actual = border?.match(
      new RegExp(`<${side}\\b[^>]*\\bstyle="([^"]+)"`),
    )?.[1];
    assert.equal(actual, expected, `detailed XLSX ${address}.${side}`);
  };
  for (let row = 7; row < 38; row += 1)
    for (const column of "BCDEFGHIJKLM") {
      edge(`${column}${row}`, "bottom", "hair");
      edge(`${column}${row + 1}`, "top", "hair");
    }
  for (let row = 6; row <= 41; row += 1) {
    edge(`F${row}`, "right", "hair");
    edge(`G${row}`, "left", "hair");
    edge(`B${row}`, "left", "thin");
    edge(`M${row}`, "right", "thin");
  }
};
const state = `
export const docs=new Map(),events=[],toasts=[];
for(let i=1;i<=32;i++)docs.set('users/qa-'+i,{role:'student',grade:'3',class:'1',number:String(i),studentName:'가상학생'+String(i).padStart(2,'0'),email:'qa-'+i+'@example.test',enrollmentStatus:'active'});
export const ref=(value)=>{const parts=value.split('/');return{path:value,id:parts.at(-1),parent:{id:parts.at(-2),path:parts.slice(0,-1).join('/')}}};
export const snap=(r)=>({...r,ref:r,exists:()=>docs.has(r.path),data:()=>docs.get(r.path)});
export const apply=(r,data,options)=>{let value=options?.merge?{...docs.get(r.path),...data}:{...data};for(const key of Object.keys(value))if(value[key]?.__delete)delete value[key];docs.set(r.path,value);events.push({op:'set',path:r.path});};
for(const kind of ['performance','written_exam_essay']){
 const base={uid:'qa-1',studentName:kind==='performance'?'가상수행학생':'가상정기학생',grade:'3',class:'1',number:'1',scoreKind:kind,scoreId:'qa-score-'+kind,rosterId:'qa-score-'+kind,scoreTitle:kind==='performance'?'가상 수행평가':'가상 정기시험',subject:'역사',academicYear:'2026',semester:'2',scoreLabel:'12 / 15점',totalScore:12,totalMaxScore:15,requestedAt:{seconds:1801850000},status:'pending'};
 docs.set('years/2026/semesters/2/performance_score_objections/'+kind+'-flagged',{...base,reason:'채점 기준 확인 요청',answerSheetRequested:true});
 docs.set('years/2026/semesters/2/performance_score_objections/'+kind+'-plain',{...base,studentName:base.studentName+'일반',reason:'점수 확인 요청',answerSheetRequested:false});
 docs.set('years/2026/semesters/2/performance_score_answer_sheet_requests/'+kind+'-legacy',{...base,studentName:base.studentName+'이전',reason:'이전 답안지 확인 요청 사유'});
}
window.scoreQa={docs,events,toasts,timestampTick:0};
`;
const mocks = {
  "qa-state": state,
  "qa-auth": `export const useAuth=()=>({userData:{role:'teacher'},currentUser:{uid:'qa-teacher',displayName:'가상교사',email:'qa-teacher@example.test'},config:{year:'2026',semester:'2'}});`,
  "qa-firestore": `import{docs,ref,snap,apply,events}from'qa-state';export const collection=(db,...parts)=>ref(parts.join('/'));export const collectionGroup=(db,name)=>({group:name});export const doc=(db,...parts)=>ref(parts.join('/'));export const getDoc=async(r)=>{if(window.scoreQa.rejectConfirmationReads&&r.path.includes("/confirmations/"))throw new Error("confirmation read denied");return snap(r)};export const getDocFromServer=getDoc;export const query=(base,...filters)=>({...base,filters});export const where=(field,op,value)=>({field,op,value});export const orderBy=(...args)=>({order:args});export const limit=n=>({limit:n});export const serverTimestamp=()=>({seconds:1801850400+window.scoreQa.timestampTick++,nanoseconds:0});export const deleteField=()=>({__delete:true});export const getDocs=async(r)=>{if(window.scoreQa.rejectLegacyRequestReads&&r.path?.endsWith("/performance_score_answer_sheet_requests"))throw new Error("legacy request read denied");if(window.scoreQa.rejectConfirmationReads&&r.group==="confirmations")throw new Error("confirmation query denied");let entries=[...docs].filter(([key])=>r.group?key.split('/').at(-2)===r.group:key.startsWith(r.path+'/')&&key.slice(r.path.length+1).indexOf('/')<0);for(const filter of r.filters||[])if(filter.field)entries=entries.filter(([,value])=>filter.op==='=='?value[filter.field]===filter.value:true);const result=entries.map(([key])=>snap(ref(key)));return{docs:result,empty:!result.length,size:result.length,forEach:fn=>result.forEach(fn)};};export const setDoc=async(r,data,options)=>apply(r,data,options);export const updateDoc=async(r,data)=>{if(window.scoreQa.pauseLegacyReview&&r.path.includes("/performance_score_answer_sheet_requests/"))await new Promise(resolve=>window.scoreQa.resumeLegacyReview=resolve);return setDoc(r,data,{merge:true});};export const runTransaction=async(db,callback)=>{if(window.scoreQa.pauseTransactions)await new Promise(resolve=>{window.scoreQa.resumeTransaction=resolve});const pending=[];const value=await callback({get:getDoc,set:(...args)=>pending.push(['set',args]),update:(r,data)=>pending.push(['set',[r,data,{merge:true}]]),delete:r=>pending.push(['delete',[r]])});pending.forEach(([op,args])=>op==='delete'?docs.delete(args[0].path):apply(...args));return value;};export const writeBatch=()=>{const pending=[];return{set:(...args)=>pending.push(args),update:(r,data)=>pending.push([r,data,{merge:true}]),delete:r=>docs.delete(r.path),commit:async()=>pending.forEach(args=>apply(...args))}};`,
  "qa-firebase": `export const db={};export const auth={currentUser:{uid:"qa-teacher",getIdTokenResult:async()=>({claims:{auth_time:1801850400}})}};export const getHttpsCallable=async(name)=>async(input)=>({data:name==='getPrintClientInfo'?{maskedIp:'192.0.2.*'}:{}});`,
  "qa-student-profile-commands": `export const callStudentDataService=async(name)=>name==='getPrintClientInfo'?{maskedIp:'192.0.2.*'}:{};`,
  "qa-archive": `export const isSemesterArchive=false;export const archiveScope=null;`,
  "qa-notifications": `export const createManagedNotifications=async()=>({createdCount:0});export const reviewPerformanceScoreObjection=async(config,input)=>{const key='years/2026/semesters/2/performance_score_objections/'+input.objectionId;const value=window.scoreQa.docs.get(key);window.scoreQa.docs.set(key,{...value,...input});window.scoreQa.events.push({op:'reviewObjection',...input});return{notificationCreated:true};};`,
  "qa-toast": `import{toasts}from'qa-state';const showToast=(payload)=>{toasts.push(payload);document.getElementById('qa-toast').textContent=payload.title+' '+(payload.message||'');};export const useAppToast=()=>({showToast});`,
  "qa-dialog": `import{events}from'qa-state';const confirm=async(payload)=>{events.push({op:'confirm',title:payload.title});return true};const prompt=async()=>null;export const useAppDialog=()=>({confirm,prompt});`,
};
const moduleFor = (request) => {
  const value = request.replaceAll("\\", "/");
  if (value in mocks) return value;
  if (value === "firebase/firestore") return "qa-firestore";
  if (/contexts\/AuthContext$/.test(value)) return "qa-auth";
  if (/lib\/firebase$/.test(value)) return "qa-firebase";
  if (/lib\/semesterArchive$/.test(value)) return "qa-archive";
  if (/lib\/notifications$/.test(value)) return "qa-notifications";
  if (/studentProfileCommands$/.test(value))
    return "qa-student-profile-commands";
  if (/AppToastProvider$/.test(value)) return "qa-toast";
};
const result = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Manager from'${root}/src/pages/teacher/components/PerformanceScoreManager';import{AppDialogProvider}from'${root}/src/components/common/AppDialogProvider';import'qa-state';createRoot(document.getElementById('root')).render(<BrowserRouter><AppDialogProvider><Manager scoreKind={new URLSearchParams(window.location.search).get("scoreKind")||"performance"}/></AppDialogProvider></BrowserRouter>);`,
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
      name: "fake-services",
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
  Object.keys(result.metafile.inputs).filter((file) =>
    /node_modules[\\/](firebase|@firebase)[\\/]/.test(file),
  ).length,
  0,
);
const css = (
  await Promise.all(
    ["assets/css/style.css", "src/assets/index.css"].map((name) =>
      fs.readFile(root + "/" + name, "utf8"),
    ),
  )
)
  .join("\n")
  .replace(/@import[^;]+;/g, "")
  .replace(/@tailwind[^;]+;/g, "");
const html = `<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}</style><div id="root"></div><div id="qa-toast" role="status"></div><script type="module" src="/fixture.js"></script></html>`;
const tailwind = await fs.readFile(
  process.env.SCORE_QA_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
);
const template = await fs.readFile(
  root + "/public/templates/performance-score-class-sheet-template.xlsx",
);
const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/templates/")) {
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.end(template);
    return;
  }
  res.setHeader(
    "Content-Type",
    req.url === "/fixture.js" || req.url === "/tailwind.js"
      ? "text/javascript"
      : "text/html; charset=utf-8",
  );
  res.end(
    req.url === "/fixture.js"
      ? result.outputFiles[0].text
      : req.url === "/tailwind.js"
        ? tailwind
        : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = {
  kind: "synthetic-performance-manager-real-browser",
  checks: [],
  viewports: [],
  screenshots: [],
  pageErrors: [],
  limitations: [
    "Auth/Firestore/callables are in-memory stubs; no production student data or writes.",
    "Synthetic NEIS and detailed grading workbooks use 32 fictitious names; optional reference workbooks are read separately without screenshot/save.",
    "Class-sheet exports retain the existing requirement for two assessments; detailed import is first proven to save one assessment, then a separate synthetic second assessment is added only for export checks.",
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
  for (const scoreKind of ["performance", "written_exam_essay"]) {
    const kindLabel = scoreKind === "performance" ? "수행평가" : "정기시험";
    const studentName =
      scoreKind === "performance" ? "가상수행학생" : "가상정기학생";
    for (const width of [390, 768, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on("pageerror", (error) => report.pageErrors.push(error.message));
      await page.route("**/*", (route) =>
        route.request().url().startsWith(origin)
          ? route.continue()
          : route.abort(),
      );
      await page.goto(`${origin}/?scoreKind=${scoreKind}`);
      assert.equal(
        await page
          .getByRole("button", { name: "답안지 요청", exact: true })
          .count(),
        0,
      );
      const trigger = page.getByRole("button", {
        name: "이의제기",
        exact: true,
      });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", {
        name: `${kindLabel} 이의 목록`,
        exact: true,
      });
      await dialog.waitFor();
      const flaggedRow = dialog
        .getByRole("row")
        .filter({ hasText: "채점 기준 확인 요청" });
      const plainRow = dialog
        .getByRole("row")
        .filter({ hasText: "점수 확인 요청" });
      await flaggedRow.getByText("답안지 확인 요청", { exact: true }).waitFor();
      assert.equal(await flaggedRow.count(), 1);
      assert.equal(
        await plainRow.getByText("답안지 확인 요청", { exact: true }).count(),
        0,
      );
      assert.equal(
        await flaggedRow.getByText(studentName, { exact: true }).count(),
        1,
      );
      assert.equal(await dialog.getByRole("row").count(), 3);
      const legacy = dialog.locator("details");
      await legacy.locator("summary").click();
      await legacy.getByText(studentName + "이전", { exact: true }).waitFor();
      assert.equal(await legacy.getByRole("row").count(), 2);
      assert.equal(await page.getByRole("dialog").count(), 1);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      if (width < 1280) {
        for (const table of await dialog.getByRole("table").all()) {
          assert.equal(
            await table.evaluate((element) => {
              const container = element.parentElement;
              const before = container.scrollLeft;
              container.scrollLeft = 100;
              const scrolled = container.scrollLeft > before;
              container.scrollLeft = before;
              return (
                scrolled && getComputedStyle(container).overflowX === "auto"
              );
            }),
            true,
          );
        }
      }
      await page.screenshot({
        path: `${out}/unified-${scoreKind}-${width}.png`,
        fullPage: true,
      });
      report.screenshots.push(`unified-${scoreKind}-${width}.png`);
      // Canceling the nested memo keeps the combined dialog open and preserves the legacy record.
      await legacy
        .getByRole("button", { name: "확인 완료", exact: true })
        .click();
      const memo = page.getByRole("dialog", {
        name: "답안지 확인 요청 처리",
        exact: true,
      });
      await memo.waitFor();
      await memo.getByRole("textbox", { name: "처리 메모" }).focus();
      await page.keyboard.press("Escape");
      await memo.waitFor({ state: "hidden" });
      assert.equal(await dialog.isVisible(), true);
      assert.equal(
        await page.evaluate(
          (kind) =>
            window.scoreQa.docs.get(
              `years/2026/semesters/2/performance_score_answer_sheet_requests/${kind}-legacy`,
            ).status,
          scoreKind,
        ),
        "pending",
      );
      await legacy
        .getByRole("button", { name: "확인 완료", exact: true })
        .click();
      await memo
        .getByRole("textbox", { name: "처리 메모" })
        .fill("가상 답안지 함께 확인함");
      if (width === 1280)
        await page.evaluate(() => (window.scoreQa.pauseLegacyReview = true));
      await memo
        .getByRole("button", { name: "확인 완료", exact: true })
        .click();
      await memo.waitFor({ state: "hidden" });
      if (width === 1280) {
        await page.waitForFunction(
          () => typeof window.scoreQa.resumeLegacyReview === "function",
        );
        assert.equal(
          await dialog
            .getByRole("button", { name: "닫기", exact: true })
            .isDisabled(),
          true,
        );
        assert.equal(
          await dialog
            .getByRole("button", { name: "이의 목록 창 닫기", exact: true })
            .isDisabled(),
          true,
        );
        await dialog.focus();
        await page.keyboard.press("Escape");
        assert.equal(await dialog.isVisible(), true);
        await page.evaluate(() => {
          window.scoreQa.pauseLegacyReview = false;
          window.scoreQa.resumeLegacyReview();
        });
      }
      await legacy
        .getByText("처리 메모: 가상 답안지 함께 확인함", { exact: true })
        .waitFor();
      assert.equal(
        await legacy
          .getByRole("button", { name: "확인 완료", exact: true })
          .count(),
        0,
      );
      const record = await page.evaluate(
        (kind) =>
          window.scoreQa.docs.get(
            `years/2026/semesters/2/performance_score_answer_sheet_requests/${kind}-legacy`,
          ),
        scoreKind,
      );
      assert.equal(record.status, "reviewed");
      assert.equal(record.reviewMemo, "가상 답안지 함께 확인함");
      assert.equal(record.reason, "이전 답안지 확인 요청 사유");
      assert.equal(
        await page
          .getByRole("button", { name: "이의제기 2", exact: true })
          .count(),
        1,
      );
      if (width === 1280) {
        await plainRow
          .getByRole("button", { name: "반려", exact: true })
          .click();
        const rejection = page.getByRole("dialog", {
          name: "반려 사유 입력",
          exact: true,
        });
        await rejection.getByRole("textbox").fill("가상 채점 기준 설명");
        await rejection
          .getByRole("button", { name: "반려 사유 확인", exact: true })
          .click();
        const rejectConfirm = page.getByRole("alertdialog", {
          name: "이의 제기를 반려할까요?",
          exact: true,
        });
        await rejectConfirm
          .getByRole("button", { name: "반려 알림 보내기", exact: true })
          .click();
        await plainRow.getByText("반려", { exact: true }).waitFor();
        await flaggedRow
          .getByRole("button", { name: "수용", exact: true })
          .click();
        const scorePrompt = page.getByRole("dialog", {
          name: "변경 후 점수 입력",
          exact: true,
        });
        await scorePrompt.getByRole("textbox").fill("12");
        await scorePrompt
          .getByRole("button", { name: "점수 확인", exact: true })
          .click();
        const acceptMemo = page.getByRole("dialog", {
          name: "처리 메모 입력",
          exact: true,
        });
        await acceptMemo
          .getByRole("textbox")
          .fill("답안지를 함께 확인했습니다.");
        await acceptMemo
          .getByRole("button", { name: "메모 확인", exact: true })
          .click();
        const acceptConfirm = page.getByRole("alertdialog", {
          name: "이의 제기를 수용할까요?",
          exact: true,
        });
        await acceptConfirm
          .getByRole("button", { name: "수용 알림 보내기", exact: true })
          .click();
        await flaggedRow.getByText("수용", { exact: true }).waitFor();
        assert.equal(
          await flaggedRow
            .getByText("답안지 확인 요청", { exact: true })
            .count(),
          1,
        );
        assert.equal(
          await page.evaluate(
            (kind) =>
              window.scoreQa.docs.get(
                `years/2026/semesters/2/performance_score_objections/${kind}-flagged`,
              ).answerSheetRequested,
            scoreKind,
          ),
          true,
        );
      }
      await dialog.getByRole("button", { name: "닫기", exact: true }).focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await dialog
          .getByRole("button", { name: "새로고침", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await dialog
          .getByRole("button", { name: "닫기", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.equal(
        await page
          .getByRole("button", { name: /^이의제기/ })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await page.goto(
        `${origin}/?scoreKind=${scoreKind}&panel=answer-sheet-requests`,
      );
      await dialog.waitFor();
      await legacy.getByText(studentName + "이전", { exact: true }).waitFor();
      assert.equal(await legacy.getAttribute("open"), "");
      assert.equal(await page.getByRole("dialog").count(), 1);
      await dialog
        .getByRole("button", { name: "이의 목록 창 닫기", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(new URL(page.url()).searchParams.has("panel"), false);
      await page.goto(`${origin}/?scoreKind=${scoreKind}&panel=objections`);
      await dialog.waitFor();
      await flaggedRow.getByText("답안지 확인 요청", { exact: true }).waitFor();
      if (width === 1280) {
        await page.evaluate(
          () => (window.scoreQa.rejectLegacyRequestReads = true),
        );
        await dialog
          .getByRole("button", { name: "새로고침", exact: true })
          .click();
        await page
          .getByRole("status")
          .filter({ hasText: "답안지 확인 요청을 불러오지 못했습니다." })
          .waitFor();
        await flaggedRow
          .getByText("답안지 확인 요청", { exact: true })
          .waitFor();
        assert.equal(await plainRow.count(), 1);
        await legacy.locator("summary").click();
        await legacy
          .getByText(
            "이전 답안지 확인 요청을 불러오지 못했습니다. 새로고침해 주세요.",
            { exact: true },
          )
          .waitFor();
        await page.evaluate(
          () => (window.scoreQa.rejectLegacyRequestReads = false),
        );
        await dialog
          .getByRole("button", { name: "새로고침", exact: true })
          .click();
        await legacy.getByText(studentName + "이전", { exact: true }).waitFor();
      }
      await page.close();
    }
    report.checks.push(
      `${kindLabel}: 390/768/1280 combined objection dialog displays the new boolean flag, filters score kind, reviews legacy requests without lost fields, supports both notification panel links, keeps nested Escape scoped, and restores keyboard focus. Accept/reject stays available at 1280; pending writes block closing; failed legacy reads preserve the current objection list and recover on refresh; horizontal scroll stays inside each table.`,
    );
  }
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      acceptDownloads: true,
    });
    page.on("pageerror", (error) => report.pageErrors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin);
    await page.getByRole("button", { name: "업로드", exact: true }).click();
    const upload = page.getByRole("dialog", {
      name: "수행평가 점수표 업로드",
      exact: true,
    });
    await upload.waitFor();
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-labelledby") ===
        "score-upload-modal-title",
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await upload
        .getByRole("button", { name: "업로드 창 닫기" })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await upload
        .locator("input[type=file]")
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await upload
        .getByRole("button", { name: "업로드 창 닫기" })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("Escape");
    await upload.waitFor({ state: "hidden" });
    assert.equal(
      await page
        .getByRole("button", { name: "업로드", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.getByRole("button", { name: "업로드", exact: true }).click();
    await upload.waitFor();
    assert.equal(
      await upload.getByText("수행평가 선택", { exact: true }).count(),
      0,
    );
    assert.equal(await upload.getByText(/고조선|삼국 시대/).count(), 0);
    await page.screenshot({
      path: `${out}/performance-upload-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`performance-upload-${width}.png`);
    await upload.locator("input[type=file]").setInputFiles(syntheticFile);
    await page
      .getByRole("heading", { name: "업로드 미리보기", exact: true })
      .waitFor();
    await page.getByText("연결 32명", { exact: true }).waitFor();
    const neisCriteria = page.getByRole("list", {
      name: "평가 항목",
      exact: true,
    });
    await neisCriteria.waitFor();
    assert.equal(await neisCriteria.getByRole("listitem").count(), 2);
    assert.ok(
      (await neisCriteria.getByRole("listitem").nth(0).textContent()).includes(
        "15점",
      ),
    );
    assert.ok(
      (await neisCriteria.getByRole("listitem").nth(1).textContent()).includes(
        "35점",
      ),
    );
    const preview = page.getByRole("dialog", {
      name: "업로드 미리보기",
      exact: true,
    });
    assert.equal(await preview.getAttribute("aria-modal"), "true");
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-labelledby") ===
        "score-upload-preview-title",
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await preview
        .getByRole("button", { name: "미리보기 닫기" })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await preview
        .getByRole("button", { name: "학생별 점수 저장" })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await preview
        .getByRole("button", { name: "미리보기 닫기" })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("Escape");
    await preview.waitFor({ state: "hidden" });
    assert.equal(
      await page
        .getByRole("button", { name: "업로드", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.getByRole("button", { name: "업로드", exact: true }).click();
    await page.locator("input[type=file]").setInputFiles(syntheticFile);
    await page.getByText("연결 32명", { exact: true }).waitFor();
    report.checks.push(
      `${width}px: upload and preview focus entry, Tab/Shift+Tab wrap, Escape dismissal, original upload trigger focus restoration.`,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `${out}/performance-preview-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`performance-preview-${width}.png`);
    if (width === 390)
      await page.evaluate(() => {
        window.scoreQa.pauseTransactions = true;
      });
    await page
      .getByRole("button", { name: "학생별 점수 저장", exact: true })
      .click();
    if (width === 390) {
      await page.waitForFunction(() =>
        Boolean(window.scoreQa.resumeTransaction),
      );
      assert.equal(
        await preview
          .getByRole("button", { name: "미리보기 닫기" })
          .isDisabled(),
        true,
      );
      assert.equal(
        await preview
          .getByRole("button", { name: "취소", exact: true })
          .isDisabled(),
        true,
      );
      await preview.focus();
      await page.keyboard.press("Escape");
      assert.equal(await preview.isVisible(), true);
      await page.evaluate(() => {
        window.scoreQa.pauseTransactions = false;
        window.scoreQa.resumeTransaction();
      });
      report.checks.push(
        "Saving preview blocks Escape and both close/cancel controls until the transaction completes.",
      );
    }
    await page
      .getByRole("status")
      .filter({ hasText: "점수를 저장했습니다." })
      .waitFor();
    const saved = await page.evaluate(() =>
      [...window.scoreQa.docs]
        .filter(([key]) => key.includes("/performance_score_rosters/"))
        .map(([key, value]) => ({
          title: value.title,
          max: value.totalMaxScore,
          count: value.rows.length,
        })),
    );
    assert.deepEqual(saved, [
      { title: "지역사 자료 해석", max: 15, count: 32 },
      { title: "역사적 판단 글쓰기", max: 35, count: 32 },
    ]);
    assert.equal(
      await page.evaluate(
        () =>
          [...window.scoreQa.docs.keys()].filter((key) =>
            key.includes("/performance_scores/"),
          ).length,
      ),
      64,
    );
    report.viewports.push(width);
    if (width === 1280) {
      await page.evaluate(() => {
        for (const [key, score] of window.scoreQa.docs) {
          if (
            !key.includes("/performance_scores/") ||
            key.includes("/confirmations/") ||
            score.uid !== "qa-1"
          )
            continue;
          if (score.title === "지역사 자료 해석") {
            score.feedback = "기존 교사 피드백";
            score.evidence = "기존 평가 근거";
            score.items = score.items.map((item) => ({
              ...item,
              feedback: "기존 항목 피드백",
            }));
            for (const [rosterPath, roster] of window.scoreQa.docs) {
              if (
                !rosterPath.includes("/performance_score_rosters/") ||
                roster.title !== score.title
              )
                continue;
              const row = roster.rows.find((row) => row.uid === score.uid);
              Object.assign(row, {
                feedback: score.feedback,
                evidence: score.evidence,
                items: score.items.map((item) => ({ ...item })),
              });
            }
          }
          // Firestore map key order is not guaranteed; preserve semantic equality.
          score.items = score.items.map((item) =>
            Object.fromEntries(Object.entries(item).reverse()),
          );
        }
        const canvas = document.createElement("canvas");
        canvas.width = 240;
        canvas.height = 80;
        const ctx = canvas.getContext("2d");
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(20, 40);
        ctx.lineTo(55, 20);
        ctx.lineTo(70, 65);
        ctx.lineTo(110, 18);
        ctx.lineTo(140, 60);
        ctx.lineTo(210, 30);
        ctx.stroke();
        const signatureImage = canvas.toDataURL("image/png");
        for (const [key, score] of window.scoreQa.docs) {
          if (
            !key.includes("/performance_scores/") ||
            key.includes("/confirmations/") ||
            !["qa-1", "qa-2"].includes(score.uid)
          )
            continue;
          window.scoreQa.docs.set(key + "/confirmations/" + score.uid, {
            uid: score.uid,
            rosterId: score.rosterId,
            signatureName: score.studentName,
            signatureImage,
            confirmedAt: { seconds: 1801850460, nanoseconds: 0 },
            scoreUpdatedAt:
              score.uid === "qa-1"
                ? score.updatedAt
                : { seconds: 1700000000, nanoseconds: 0 },
          });
        }
      });
      const snapshotBeforeReupload = await page.evaluate(() => ({
        scores: [...window.scoreQa.docs]
          .filter(
            ([key, score]) =>
              key.includes("/performance_scores/") &&
              !key.includes("/confirmations/") &&
              score.uid === "qa-1",
          )
          .map(([key, score]) => ({
            key,
            updatedAt: score.updatedAt,
            order: score.assessmentOrder,
            itemKey: score.items[0].itemKey,
          })),
        eventCount: window.scoreQa.events.length,
      }));
      const uploadFixture = async (file) => {
        await page.getByRole("button", { name: "업로드", exact: true }).click();
        await page.locator("input[type=file]").setInputFiles(file);
        const preview = page.getByRole("dialog", {
          name: "업로드 미리보기",
          exact: true,
        });
        await preview.waitFor();
        await preview
          .getByRole("button", { name: "학생별 점수 저장", exact: true })
          .click();
        await preview.waitFor({ state: "hidden" });
      };
      await uploadFixture(syntheticFile);
      const afterSameReupload = await page.evaluate(
        ({ scores, eventCount }) => ({
          scores: scores.map(({ key }) => window.scoreQa.docs.get(key)),
          scoreWrites: window.scoreQa.events
            .slice(eventCount)
            .filter((event) => event.path.includes("/performance_scores/")),
        }),
        snapshotBeforeReupload,
      );
      assert.equal(afterSameReupload.scoreWrites.length, 0);
      for (let index = 0; index < snapshotBeforeReupload.scores.length; index++)
        assert.deepEqual(
          afterSameReupload.scores[index].updatedAt,
          snapshotBeforeReupload.scores[index].updatedAt,
        );
      const preservedFeedback = afterSameReupload.scores.find(
        (score) => score.title === "지역사 자료 해석",
      );
      assert.equal(preservedFeedback.feedback, "기존 교사 피드백");
      assert.equal(preservedFeedback.evidence, "기존 평가 근거");
      assert.equal(preservedFeedback.items[0].feedback, "기존 항목 피드백");
      await uploadFixture(secondOnlyFile);
      const secondReupload = await page.evaluate(
        () =>
          [...window.scoreQa.docs].find(
            ([key, score]) =>
              key.includes("/performance_scores/") &&
              !key.includes("/confirmations/") &&
              score.uid === "qa-1" &&
              score.title === "역사적 판단 글쓰기",
          )[1],
      );
      const originalSecond = snapshotBeforeReupload.scores.find(
        (score) => score.order === 2,
      );
      assert.equal(secondReupload.assessmentOrder, 2);
      assert.equal(secondReupload.items[0].itemKey, "assessment-2");
      assert.deepEqual(secondReupload.updatedAt, originalSecond.updatedAt);
      report.checks.push(
        "Same-score NEIS reupload preserves teacher feedback/evidence/item feedback, signatures and score revision despite reversed Firestore map key order; a B-only file preserves assessment order 2 and item key assessment-2.",
      );
      await page.evaluate(() => {
        for (let index = 33; index <= 34; index++)
          window.scoreQa.docs.set(`users/qa-${index}`, {
            role: "student",
            grade: "3",
            class: "2",
            number: String(index - 32),
            studentName: `가상학생${index}`,
            email: `qa-${index}@example.test`,
            enrollmentStatus: "active",
          });
      });
      await uploadFixture(nextClassFile);
      const mergedCounts = await page.evaluate(() =>
        [...window.scoreQa.docs]
          .filter(([key]) => key.includes("/performance_score_rosters/"))
          .map(([, roster]) => ({
            title: roster.title,
            count: roster.rows.length,
            firstClass: roster.rows.filter((row) => row.class === "1").length,
          })),
      );
      assert.deepEqual(mergedCounts, [
        { title: "지역사 자료 해석", count: 34, firstClass: 32 },
        { title: "역사적 판단 글쓰기", count: 33, firstClass: 32 },
      ]);
      await uploadFixture(partialBlankFile);
      const blankZero = await page.evaluate(() =>
        [...window.scoreQa.docs]
          .filter(
            ([key, score]) =>
              key.includes("/performance_scores/") &&
              !key.includes("/confirmations/") &&
              score.uid === "qa-2",
          )
          .map(([, score]) => ({
            title: score.title,
            total: score.totalScore,
          })),
      );
      assert.deepEqual(blankZero, [
        { title: "지역사 자료 해석", total: 12 },
        { title: "역사적 판단 글쓰기", total: 0 },
      ]);
      const beforeCriteriaWrites = await page.evaluate(
        () => window.scoreQa.events.length,
      );
      await page.getByRole("button", { name: "업로드", exact: true }).click();
      await page.locator("input[type=file]").setInputFiles(changedCriteriaFile);
      const invalidCriteriaPreview = page.getByRole("dialog", {
        name: "업로드 미리보기",
        exact: true,
      });
      await invalidCriteriaPreview
        .getByRole("button", { name: "학생별 점수 저장", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "기존 명단과 평가 기준이 다릅니다." })
        .waitFor();
      assert.equal(
        await page.evaluate(() => window.scoreQa.events.length),
        beforeCriteriaWrites,
      );
      await invalidCriteriaPreview
        .getByRole("button", { name: "미리보기 닫기" })
        .click();
      report.checks.push(
        "Sequential class uploads merge without removing class 1; blank scores preserve existing values and 0 overwrites intentionally; partial-roster criteria changes reject before writes.",
      );
      await page.getByRole("button", { name: "일람표", exact: true }).click();
      await page
        .getByRole("button", { name: "현황 조회", exact: true })
        .click();
      await page.getByText("학급 인원", { exact: true }).waitFor();
      await page.screenshot({
        path: `${out}/performance-sheet-dialog-${width}.png`,
        fullPage: true,
      });
      report.screenshots.push(`performance-sheet-dialog-${width}.png`);
      const downloadWait = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "일람표 다운로드", exact: true })
        .click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "그래도 다운로드" })
        .click();
      const download = await downloadWait;
      const generatedPath = out + "/synthetic-performance-class-sheet.xlsx";
      await download.saveAs(generatedPath);
      const generated = new ExcelJS.Workbook();
      await generated.xlsx.readFile(generatedPath);
      const resultSheet = generated.worksheets[0];
      assert.ok(
        String(resultSheet.getCell("E6").value).includes("지역사 자료 해석"),
      );
      assert.ok(String(resultSheet.getCell("E6").value).includes("15.00"));
      assert.ok(
        String(resultSheet.getCell("G6").value).includes("역사적 판단 글쓰기"),
      );
      assert.ok(String(resultSheet.getCell("G6").value).includes("35.00"));
      assert.equal(resultSheet.getCell("D7").text, "가상학생01");
      assert.equal(resultSheet.getCell("E7").value, 12);
      assert.equal(resultSheet.getCell("G7").value, 30);
      assert.equal(resultSheet.getCell("H7").value, 42);
      assert.equal(resultSheet.getCell("D38").text, "가상학생32");
      assert.equal(resultSheet.getCell("E38").value, 0);
      assert.equal(resultSheet.getCell("G38").value, 0);
      assert.equal(resultSheet.getImages().length, 1);
      const image = resultSheet.getImages()[0];
      assert.equal(image.range.tl.nativeRow, 6);
      assert.ok(image.range.tl.nativeCol >= 9);
      assert.equal(resultSheet.pageSetup.paperSize, 9);
      assert.equal(resultSheet.pageSetup.orientation, "portrait");
      report.checks.push(
        "Downloaded Excel: dynamic assessment headers/maxima; D7/D38 names, E/G scores incl. zero, H total; exactly one valid signature image anchored in row 7 remarks; stale score revision signature excluded.",
      );
      report.export = {
        rows: 32,
        images: resultSheet.getImages().length,
        paperSize: resultSheet.pageSetup.paperSize,
        orientation: resultSheet.pageSetup.orientation,
        filename: download.suggestedFilename(),
      };
      let failedReadDownloads = 0;
      page.on("download", () => {
        failedReadDownloads += 1;
      });
      await page.evaluate(() => {
        window.scoreQa.rejectConfirmationReads = true;
      });
      await page
        .getByRole("button", { name: "일람표 다운로드", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "일람표 다운로드에 실패했습니다." })
        .waitFor();
      assert.equal(failedReadDownloads, 0);
      assert.equal(await page.getByRole("alertdialog").count(), 0);
      report.checks.push(
        "Confirmation query and fallback read failure: download stops with an explicit error; no unsigned-student confirmation or XLSX download is produced.",
      );
    }
    await page.close();
  }
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      acceptDownloads: true,
    });
    page.on("pageerror", (error) => report.pageErrors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin);
    const openDetailedPreview = async (file = detailedFile) => {
      await page.getByRole("button", { name: "업로드", exact: true }).click();
      await page.locator("input[type=file]").setInputFiles(file);
      const preview = page.getByRole("dialog", {
        name: "업로드 미리보기",
        exact: true,
      });
      await preview.waitFor();
      await preview.getByText("연결 32명", { exact: true }).waitFor();
      return preview;
    };
    let preview = await openDetailedPreview();
    assert.equal(
      await preview.getByLabel("평가명", { exact: true }).inputValue(),
      detailedTitle,
    );
    assert.equal(
      await preview.getByLabel("과목", { exact: true }).inputValue(),
      "역사",
    );
    assert.equal(
      await preview
        .getByLabel("과목", { exact: true })
        .getAttribute("readonly"),
      "",
    );
    const criteria = preview.getByRole("list", {
      name: "평가 항목",
      exact: true,
    });
    assert.equal(await criteria.getByRole("listitem").count(), 6);
    for (let index = 0; index < 6; index += 1) {
      const item = criteria.getByRole("listitem").nth(index);
      assert.ok((await item.textContent()).includes(detailedCriteria[index]));
      assert.ok(
        (await item.textContent()).includes(String(detailedMaxima[index])),
      );
    }
    assert.equal(
      await preview.locator("tbody textarea").first().inputValue(),
      detailedFeedback,
    );
    assert.equal(
      await preview
        .getByRole("columnheader", { name: "학년", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await preview
        .getByRole("columnheader", { name: "반", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await preview
        .getByRole("columnheader", { name: "번호", exact: true })
        .count(),
      1,
    );
    await preview.getByLabel("학년", { exact: true }).selectOption("3");
    await preview.getByLabel("반", { exact: true }).selectOption("1");
    await preview.getByLabel("번호", { exact: true }).selectOption("1");
    assert.equal(await preview.locator("tbody tr").count(), 1);
    const firstIdentity = await preview
      .locator("tbody tr")
      .first()
      .locator("td")
      .allTextContents();
    assert.equal(firstIdentity[1].trim(), "3");
    assert.equal(firstIdentity[2].trim(), "1");
    assert.equal(firstIdentity[3].trim(), "1");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: out + `/detailed-preview-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`detailed-preview-${width}.png`);
    await preview.locator("tbody textarea").first().scrollIntoViewIfNeeded();
    assert.ok(
      (await preview.locator("tbody textarea").first().boundingBox()).width >=
        200,
    );
    await page.screenshot({
      path: out + `/detailed-feedback-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`detailed-feedback-${width}.png`);
    await preview
      .getByRole("button", { name: "학생별 점수 저장", exact: true })
      .click();
    await preview.waitFor({ state: "hidden" });
    const snapshot = await page.evaluate(() => ({
      rosters: [...window.scoreQa.docs]
        .filter(([key]) => key.includes("/performance_score_rosters/"))
        .map(([key, value]) => ({ key, ...value })),
      scores: [...window.scoreQa.docs]
        .filter(
          ([key]) =>
            key.includes("/performance_scores/") &&
            !key.includes("/confirmations/"),
        )
        .map(([key, value]) => ({ key, ...value })),
    }));
    assert.equal(snapshot.rosters.length, 1);
    const roster = snapshot.rosters[0];
    assert.equal(roster.title, detailedTitle);
    assert.equal(roster.subject, "역사");
    assert.equal(roster.items.length, 6);
    assert.equal(roster.rows.length, 32);
    assert.deepEqual(
      roster.items.map((item) => item.maxScore),
      detailedMaxima,
    );
    assert.equal(roster.totalMaxScore, 30);
    assert.equal(roster.assessmentOrder, 1);
    assert.equal(snapshot.scores.length, 32);
    for (const score of snapshot.scores) {
      assert.equal(score.title, detailedTitle);
      assert.equal(score.subject, "역사");
      assert.equal(score.items.length, 6);
      assert.equal(score.totalMaxScore, 30);
      assert.equal(score.feedback, detailedFeedback);
      assert.equal(score.totalScore, score.uid === "qa-32" ? 0 : 30);
    }
    if (width === 1280) {
      await page.evaluate(() => {
        const [key, score] = [...window.scoreQa.docs].find(
          ([key, score]) =>
            key.includes("/performance_scores/") && score.uid === "qa-1",
        );
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 60;
        const context = canvas.getContext("2d");
        context.lineWidth = 4;
        context.beginPath();
        context.moveTo(10, 20);
        context.lineTo(30, 45);
        context.lineTo(100, 10);
        context.stroke();
        window.scoreQa.docs.set(key + "/confirmations/" + score.uid, {
          uid: score.uid,
          rosterId: score.rosterId,
          signatureName: score.studentName,
          signatureImage: canvas.toDataURL("image/png"),
          scoreUpdatedAt: score.updatedAt,
          confirmedAt: { seconds: 1801850460 },
        });
      });
      const before = await page.evaluate(() => ({
        scores: [...window.scoreQa.docs].filter(
          ([key]) =>
            key.includes("/performance_scores/") &&
            !key.includes("/confirmations/"),
        ),
        events: window.scoreQa.events.length,
      }));
      preview = await openDetailedPreview();
      await preview
        .getByRole("button", { name: "학생별 점수 저장", exact: true })
        .click();
      await preview.waitFor({ state: "hidden" });
      const after = await page.evaluate(
        (eventStart) => ({
          scores: [...window.scoreQa.docs].filter(
            ([key]) =>
              key.includes("/performance_scores/") &&
              !key.includes("/confirmations/"),
          ),
          writes: window.scoreQa.events
            .slice(eventStart)
            .filter((event) => event.path?.includes("/performance_scores/")),
        }),
        before.events,
      );
      assert.deepEqual(after.scores, before.scores);
      assert.equal(after.writes.length, 0);
      // The unchanged class-sheet workflow requires both assessments. Verify
      // single-assessment storage above, then add a separate synthetic second.
      preview = await openDetailedPreview(secondDetailedFile);
      await preview.getByLabel("평가 순서", { exact: true }).selectOption("2");
      await preview
        .getByRole("button", { name: "학생별 점수 저장", exact: true })
        .click();
      await preview.waitFor({ state: "hidden" });
      await page.evaluate(() => {
        const first = [...window.scoreQa.docs].find(([key]) =>
          key.includes("/confirmations/"),
        )[1];
        const [key, score] = [...window.scoreQa.docs].find(
          ([key, score]) =>
            key.includes("/performance_scores/") &&
            !key.includes("/confirmations/") &&
            score.uid === "qa-1" &&
            score.title === "가상 두 번째 평가",
        );
        window.scoreQa.docs.set(key + "/confirmations/" + score.uid, {
          ...first,
          rosterId: score.rosterId,
          scoreUpdatedAt: score.updatedAt,
        });
      });
      await page.getByRole("button", { name: "일람표", exact: true }).click();
      await page
        .getByRole("button", { name: "현황 조회", exact: true })
        .click();
      await page.getByText("학급 인원", { exact: true }).waitFor();
      const downloadWait = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "일람표 다운로드", exact: true })
        .click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "그래도 다운로드" })
        .click();
      const download = await downloadWait;
      const savedPath = out + "/synthetic-detailed-class-sheet.xlsx";
      await download.saveAs(savedPath);
      const generated = new ExcelJS.Workbook();
      await generated.xlsx.readFile(savedPath);
      const worksheet = generated.worksheets[0];
      assert.ok(worksheet.getCell("E6").text.includes(detailedTitle));
      assert.ok(worksheet.getCell("E6").text.includes("30.00"));
      assert.equal(worksheet.getCell("E7").value, 30);
      assert.equal(worksheet.getCell("E38").value, 0);
      assert.equal(worksheet.getImages().length, 1);
      assert.equal(worksheet.getImages()[0].range.tl.nativeRow, 6);
      assert.ok(worksheet.getImages()[0].range.tl.nativeCol >= 9);
      await assertDetailedHairBorders(await fs.readFile(savedPath));
      report.checks.push(
        "Detailed grading: unchanged reupload writes no student score document and preserves the score revision/signature; downloaded E6 has the single assessment title and 30.00 max, E7/E38 include full/zero totals, one valid signature remains in remarks, serialized hair student/assessment separators and thin outer edges survive.",
      );
    }
    await page.close();
  }
  report.checks.push(
    "Detailed grading 390/768/1280: metadata title and fixed history subject, six compact list items, grade/class/number columns and filters, literal backslash feedback normalized into line breaks, one roster with six criteria and 32 student scores saved despite filtering preview to one student.",
  );
  const maximaPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  maximaPage.on("pageerror", (error) => report.pageErrors.push(error.message));
  await maximaPage.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await maximaPage.goto(origin);
  const openMaximaPreview = async (file) => {
    await maximaPage
      .getByRole("button", { name: "업로드", exact: true })
      .click();
    await maximaPage.locator("input[type=file]").setInputFiles(file);
    const preview = maximaPage.getByRole("dialog", {
      name: "업로드 미리보기",
      exact: true,
    });
    await preview.getByText("연결 32명", { exact: true }).waitFor();
    return preview;
  };
  let maximaPreview = await openMaximaPreview(detailedFile);
  const maximumHelp = maximaPreview.getByRole("button", {
    name: "평가 배점 도움말",
    exact: true,
  });
  await maximumHelp.click();
  await maximaPreview.getByRole("tooltip").waitFor();
  await maximaPage.keyboard.press("Escape");
  await maximaPreview.getByRole("tooltip").waitFor({ state: "hidden" });
  assert.equal(await maximaPreview.isVisible(), true);
  const maxLabel = detailedCriteria[0] + " 배점";
  await maximaPreview.getByLabel("평가명", { exact: true }).fill("");
  assert.equal(
    await maximaPreview
      .getByRole("button", { name: "학생별 점수 저장", exact: true })
      .isDisabled(),
    true,
  );
  await maximaPreview.getByLabel("평가명", { exact: true }).fill(detailedTitle);
  await maximaPreview
    .getByRole("button", { name: "배점 수정", exact: true })
    .click();
  await maximaPreview.getByLabel(maxLabel, { exact: true }).fill("5");
  await maximaPreview
    .getByRole("button", { name: "배점 적용", exact: true })
    .click();
  assert.equal(
    await maximaPreview.getByLabel(maxLabel, { exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await maximaPreview
      .getByRole("button", { name: "학생별 점수 저장", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await maximaPage.evaluate(
      () => window.scoreQa.events.filter((event) => event.op === "set").length,
    ),
    0,
  );
  await maximaPreview.getByLabel(maxLabel, { exact: true }).fill("7");
  await maximaPage.screenshot({
    path: out + "/detailed-maxima-editor-1280.png",
    fullPage: true,
  });
  report.screenshots.push("detailed-maxima-editor-1280.png");
  await maximaPreview
    .getByRole("button", { name: "배점 적용", exact: true })
    .click();
  await maximaPreview.getByText("총점 31점", { exact: true }).waitFor();
  assert.equal(
    await maximaPreview
      .getByRole("list", { name: "평가 항목", exact: true })
      .getByRole("listitem")
      .count(),
    6,
  );
  await maximaPage.screenshot({
    path: out + "/detailed-corrected-maxima-1280.png",
    fullPage: true,
  });
  report.screenshots.push("detailed-corrected-maxima-1280.png");
  await maximaPreview
    .getByRole("button", { name: "학생별 점수 저장", exact: true })
    .click();
  await maximaPreview.waitFor({ state: "hidden" });
  const corrected = await maximaPage.evaluate(() => ({
    rosters: [...window.scoreQa.docs]
      .filter(([key]) => key.includes("/performance_score_rosters/"))
      .map(([, value]) => value),
    scores: [...window.scoreQa.docs]
      .filter(
        ([key]) =>
          key.includes("/performance_scores/") &&
          !key.includes("/confirmations/"),
      )
      .map(([, value]) => value),
    events: window.scoreQa.events.length,
  }));
  assert.equal(corrected.rosters.length, 1);
  assert.equal(corrected.rosters[0].totalMaxScore, 31);
  assert.equal(corrected.rosters[0].items[0].maxScore, 7);
  assert.equal(corrected.scores.length, 32);
  for (const score of corrected.scores) {
    assert.equal(score.totalMaxScore, 31);
    assert.equal(score.items[0].maxScore, 7);
    assert.equal(score.totalScore, score.uid === "qa-32" ? 0 : 30);
  }
  maximaPreview = await openMaximaPreview(detailedFile);
  await maximaPreview.getByText("총점 31점", { exact: true }).waitFor();
  assert.ok(
    (
      await maximaPreview
        .getByRole("list", { name: "평가 항목", exact: true })
        .getByRole("listitem")
        .first()
        .textContent()
    ).includes("7점"),
  );
  await maximaPreview
    .getByRole("button", { name: "학생별 점수 저장", exact: true })
    .click();
  await maximaPreview.waitFor({ state: "hidden" });
  assert.equal(
    await maximaPage.evaluate(
      (eventStart) =>
        window.scoreQa.events
          .slice(eventStart)
          .filter((event) => event.path?.includes("/performance_scores/"))
          .length,
      corrected.events,
    ),
    0,
  );
  maximaPreview = await openMaximaPreview(secondDetailedFile);
  await maximaPreview
    .getByLabel("평가 순서", { exact: true })
    .selectOption("2");
  await maximaPreview
    .getByRole("button", { name: "학생별 점수 저장", exact: true })
    .click();
  await maximaPreview.waitFor({ state: "hidden" });
  await maximaPage.getByRole("button", { name: "일람표", exact: true }).click();
  await maximaPage
    .getByRole("button", { name: "현황 조회", exact: true })
    .click();
  await maximaPage.getByText("학급 인원", { exact: true }).waitFor();
  const maximaDownloadWait = maximaPage.waitForEvent("download");
  await maximaPage
    .getByRole("button", { name: "일람표 다운로드", exact: true })
    .click();
  await maximaPage
    .getByRole("alertdialog")
    .getByRole("button", { name: "그래도 다운로드" })
    .click();
  const maximaDownload = await maximaDownloadWait;
  const maximaPath = out + "/synthetic-corrected-maxima-class-sheet.xlsx";
  await maximaDownload.saveAs(maximaPath);
  const maximaBook = new ExcelJS.Workbook();
  await maximaBook.xlsx.readFile(maximaPath);
  assert.ok(maximaBook.worksheets[0].getCell("E6").text.includes("31.00"));
  assert.ok(
    maximaBook.worksheets[0].getCell("E6").text.includes(detailedTitle),
  );
  assert.equal(maximaBook.worksheets[0].getCell("E7").value, 30);
  await assertDetailedHairBorders(await fs.readFile(maximaPath));
  report.checks.push(
    "Manual criterion maximum 6→7 updates the single assessment maximum to 31 without changing student points; 5 below the observed 6 blocks applying/saving. Same-file reupload preserves the teacher's 7/31 maxima without score writes; XLSX E6 shows 31.00 and reference hair borders remain. Empty title cannot save.",
  );
  await maximaPage.close();
  const racePage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  racePage.on("pageerror", (error) => report.pageErrors.push(error.message));
  await racePage.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await racePage.goto(origin);
  const openRacePreview = async () => {
    await racePage.getByRole("button", { name: "업로드", exact: true }).click();
    await racePage.locator("input[type=file]").setInputFiles(detailedFile);
    const preview = racePage.getByRole("dialog", {
      name: "업로드 미리보기",
      exact: true,
    });
    await preview.getByText("연결 32명", { exact: true }).waitFor();
    return preview;
  };
  let racePreview = await openRacePreview();
  await racePreview
    .getByRole("button", { name: "학생별 점수 저장", exact: true })
    .click();
  await racePreview.waitFor({ state: "hidden" });
  racePreview = await openRacePreview();
  await racePreview.getByText("총점 30점", { exact: true }).waitFor();
  const beforeRace = await racePage.evaluate(() => {
    const reviseItems = (items) =>
      items.map((item, index) => ({
        ...item,
        ...(index === 0 ? { maxScore: 7 } : {}),
      }));
    for (const [key, value] of window.scoreQa.docs) {
      if (key.includes("/performance_score_rosters/")) {
        // Replace server snapshots, never mutate arrays held by the React cache.
        window.scoreQa.docs.set(key, {
          ...value,
          items: reviseItems(value.items),
          totalMaxScore: 31,
          rows: value.rows.map((row) => ({
            ...row,
            items: reviseItems(row.items),
            totalMaxScore: 31,
          })),
        });
      } else if (
        key.includes("/performance_scores/") &&
        !key.includes("/confirmations/")
      ) {
        const current = {
          ...value,
          items: reviseItems(value.items),
          totalMaxScore: 31,
          updatedAt: { seconds: 1801850500, nanoseconds: 0 },
        };
        window.scoreQa.docs.set(key, current);
        if (value.uid === "qa-1")
          window.scoreQa.docs.set(key + "/confirmations/qa-1", {
            uid: "qa-1",
            rosterId: value.rosterId,
            signatureName: "가상학생01",
            signatureImage: "synthetic-versioned-signature",
            scoreUpdatedAt: current.updatedAt,
          });
      }
    }
    return {
      scores: [...window.scoreQa.docs].filter(([key]) =>
        key.includes("/performance_scores/"),
      ),
      events: window.scoreQa.events.length,
    };
  });
  await racePreview.getByText("총점 30점", { exact: true }).waitFor();
  await racePreview
    .getByRole("button", { name: "학생별 점수 저장", exact: true })
    .click();
  await racePreview.waitFor({ state: "hidden" });
  const afterRace = await racePage.evaluate(
    (start) => ({
      scores: [...window.scoreQa.docs].filter(([key]) =>
        key.includes("/performance_scores/"),
      ),
      rosters: [...window.scoreQa.docs]
        .filter(([key]) => key.includes("/performance_score_rosters/"))
        .map(([, value]) => value),
      writes: window.scoreQa.events
        .slice(start)
        .filter((event) => event.path?.includes("/performance_scores/")),
    }),
    beforeRace.events,
  );
  assert.deepEqual(afterRace.scores, beforeRace.scores);
  assert.equal(afterRace.writes.length, 0);
  assert.equal(afterRace.rosters[0].items[0].maxScore, 7);
  assert.equal(afterRace.rosters[0].totalMaxScore, 31);
  assert.ok(
    afterRace.rosters[0].rows.every(
      (row) => row.items[0].maxScore === 7 && row.totalMaxScore === 31,
    ),
  );
  report.checks.push(
    "Stale-cache race: preview/cache stays at inferred 6/30 while server snapshots change to 7/31. Save uses transaction-current criteria, retains all 32 rows at 7/31, performs no student score writes and preserves the latest score-bound signature. Feedback textarea remains at least 200px wide at every tested viewport.",
  );
  await racePage.close();
  if (process.env.SCORE_QA_DETAILED_REFERENCE_XLSX) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    page.on("pageerror", (error) => report.pageErrors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin);
    await page.getByRole("button", { name: "업로드", exact: true }).click();
    await page
      .locator("input[type=file]")
      .setInputFiles(process.env.SCORE_QA_DETAILED_REFERENCE_XLSX);
    const preview = page.getByRole("dialog", {
      name: "업로드 미리보기",
      exact: true,
    });
    await preview.waitFor();
    await preview.getByText("총 32명", { exact: true }).waitFor();
    await preview.getByText("총점 30점", { exact: true }).waitFor();
    assert.equal(
      await preview
        .getByRole("list", { name: "평가 항목", exact: true })
        .getByRole("listitem")
        .count(),
      6,
    );
    assert.equal(
      await preview.getByLabel("평가명", { exact: true }).inputValue(),
      detailedTitle,
    );
    assert.equal(
      await preview.getByLabel("과목", { exact: true }).inputValue(),
      "역사",
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.scoreQa.events.filter((event) => event.op === "set").length,
      ),
      0,
    );
    report.checks.push(
      "Actual detailed grading workbook read via browser File only: metadata title/history subject, 32 rows, six criteria and total maximum 30 detected; no real-data save, screenshots, copies or cell-value logs.",
    );
    await page.close();
  }
  const nestedPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  nestedPage.on("pageerror", (error) => report.pageErrors.push(error.message));
  await nestedPage.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await nestedPage.goto(origin);
  await nestedPage.getByRole("button", { name: "업로드", exact: true }).click();
  await nestedPage.locator("input[type=file]").setInputFiles({
    ...syntheticFile,
    name: syntheticFile.name.replace("2학기", "1학기"),
  });
  const nestedPreview = nestedPage.getByRole("dialog", {
    name: "업로드 미리보기",
    exact: true,
  });
  await nestedPage.getByText("연결 32명", { exact: true }).waitFor();
  await nestedPreview.getByRole("button", { name: "학생별 점수 저장" }).click();
  const confirmation = nestedPage.getByRole("alertdialog", {
    name: "파일의 학기가 현재 학기와 다릅니다.",
  });
  await confirmation.waitFor();
  await confirmation.getByRole("button", { name: "취소", exact: true }).focus();
  await nestedPage.keyboard.press("Escape");
  await confirmation.waitFor({ state: "hidden" });
  assert.equal(await nestedPreview.isVisible(), true);
  await nestedPage.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "학생별 점수 저장",
  );
  assert.equal(
    await nestedPage.evaluate(
      () => window.scoreQa.events.filter((event) => event.op === "set").length,
    ),
    0,
  );
  await nestedPage.keyboard.press("Escape");
  await nestedPreview.waitFor({ state: "hidden" });
  assert.equal(
    await nestedPage
      .getByRole("button", { name: "업로드", exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  report.checks.push(
    "Real AppDialogProvider nested semester confirmation: Escape closes only confirmation, restores preview save focus, writes nothing, and a later Escape closes preview and restores upload trigger.",
  );
  await nestedPage.close();
  const rosterChangePage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await rosterChangePage.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await rosterChangePage.goto(origin);
  await rosterChangePage
    .getByRole("button", { name: "업로드", exact: true })
    .click();
  await rosterChangePage
    .locator("input[type=file]")
    .setInputFiles(syntheticFile);
  await rosterChangePage.getByText("연결 32명", { exact: true }).waitFor();
  await rosterChangePage.evaluate(
    () =>
      (window.scoreQa.docs.get("users/qa-32").enrollmentStatus = "transferred"),
  );
  await rosterChangePage
    .getByRole("button", { name: "학생별 점수 저장", exact: true })
    .click();
  await rosterChangePage
    .getByRole("status")
    .filter({ hasText: "학생 명단을 확인해 주세요." })
    .waitFor();
  assert.equal(
    await rosterChangePage.evaluate(
      () => window.scoreQa.events.filter((event) => event.op === "set").length,
    ),
    0,
  );
  report.checks.push(
    "Student excluded after preview: fresh roster validation blocks the whole upload before Firestore writes.",
  );
  await rosterChangePage.close();
  if (process.env.SCORE_QA_REFERENCE_XLSX) {
    const realPage = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    realPage.on("pageerror", (error) => report.pageErrors.push(error.message));
    await realPage.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    await realPage.goto(origin);
    await realPage.getByRole("button", { name: "업로드", exact: true }).click();
    await realPage
      .locator("input[type=file]")
      .setInputFiles(process.env.SCORE_QA_REFERENCE_XLSX);
    await realPage
      .getByRole("heading", { name: "업로드 미리보기", exact: true })
      .waitFor();
    await realPage.getByText("총 32명", { exact: true }).waitFor();
    assert.equal(
      await realPage
        .getByRole("list", { name: "평가 항목", exact: true })
        .getByRole("listitem")
        .count(),
      2,
    );
    report.checks.push(
      "Actual attached Hancom/NEIS XLSX accepted by browser File reader: preview detects 32 students and 2 maxima; no personal preview screenshots or file copies retained.",
    );
    await realPage.close();
  }
  report.checks.push(
    "390/768/1280: upload has no fixed assessment name; XLSX reader detects two new assessments with maxima 15/35 and all 32 roster matches.",
  );
  report.checks.push(
    "Mock Firestore transaction stores 2 roster documents and 64 student score documents including zero scores.",
  );
  assert.deepEqual(report.pageErrors, []);
  await fs.writeFile(
    out + "/performance-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
