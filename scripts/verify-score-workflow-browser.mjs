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
const state = `
export const docs=new Map(),events=[],toasts=[];
for(let i=1;i<=32;i++)docs.set('users/qa-'+i,{role:'student',grade:'3',class:'1',number:String(i),studentName:'가상학생'+String(i).padStart(2,'0'),email:'qa-'+i+'@example.test',enrollmentStatus:'active'});
export const ref=(value)=>{const parts=value.split('/');return{path:value,id:parts.at(-1),parent:{id:parts.at(-2),path:parts.slice(0,-1).join('/')}}};
export const snap=(r)=>({...r,ref:r,exists:()=>docs.has(r.path),data:()=>docs.get(r.path)});
export const apply=(r,data,options)=>{let value=options?.merge?{...docs.get(r.path),...data}:{...data};for(const key of Object.keys(value))if(value[key]?.__delete)delete value[key];docs.set(r.path,value);events.push({op:'set',path:r.path});};
window.scoreQa={docs,events,toasts,timestampTick:0};
`;
const mocks = {
  "qa-state": state,
  "qa-auth": `export const useAuth=()=>({userData:{role:'teacher'},currentUser:{uid:'qa-teacher',displayName:'가상교사',email:'qa-teacher@example.test'},config:{year:'2026',semester:'2'}});`,
  "qa-firestore": `import{docs,ref,snap,apply,events}from'qa-state';export const collection=(db,...parts)=>ref(parts.join('/'));export const collectionGroup=(db,name)=>({group:name});export const doc=(db,...parts)=>ref(parts.join('/'));export const getDoc=async(r)=>{if(window.scoreQa.rejectConfirmationReads&&r.path.includes("/confirmations/"))throw new Error("confirmation read denied");return snap(r)};export const getDocFromServer=getDoc;export const query=(base,...filters)=>({...base,filters});export const where=(field,op,value)=>({field,op,value});export const orderBy=(...args)=>({order:args});export const limit=n=>({limit:n});export const serverTimestamp=()=>({seconds:1801850400+window.scoreQa.timestampTick++,nanoseconds:0});export const deleteField=()=>({__delete:true});export const getDocs=async(r)=>{if(window.scoreQa.rejectConfirmationReads&&r.group==="confirmations")throw new Error("confirmation query denied");let entries=[...docs].filter(([key])=>r.group?key.split('/').at(-2)===r.group:key.startsWith(r.path+'/')&&key.slice(r.path.length+1).indexOf('/')<0);for(const filter of r.filters||[])if(filter.field)entries=entries.filter(([,value])=>filter.op==='=='?value[filter.field]===filter.value:true);const result=entries.map(([key])=>snap(ref(key)));return{docs:result,empty:!result.length,size:result.length,forEach:fn=>result.forEach(fn)};};export const setDoc=async(r,data,options)=>apply(r,data,options);export const updateDoc=(r,data)=>setDoc(r,data,{merge:true});export const runTransaction=async(db,callback)=>{if(window.scoreQa.pauseTransactions)await new Promise(resolve=>{window.scoreQa.resumeTransaction=resolve});const pending=[];const value=await callback({get:getDoc,set:(...args)=>pending.push(['set',args]),update:(r,data)=>pending.push(['set',[r,data,{merge:true}]]),delete:r=>pending.push(['delete',[r]])});pending.forEach(([op,args])=>op==='delete'?docs.delete(args[0].path):apply(...args));return value;};export const writeBatch=()=>{const pending=[];return{set:(...args)=>pending.push(args),update:(r,data)=>pending.push([r,data,{merge:true}]),delete:r=>docs.delete(r.path),commit:async()=>pending.forEach(args=>apply(...args))}};`,
  "qa-firebase": `export const db={};export const auth={currentUser:{uid:"qa-teacher",getIdTokenResult:async()=>({claims:{auth_time:1801850400}})}};export const getHttpsCallable=async(name)=>async(input)=>({data:name==='getPrintClientInfo'?{maskedIp:'192.0.2.*'}:{}});`,
  "qa-student-profile-commands": `export const callStudentDataService=async(name)=>name==='getPrintClientInfo'?{maskedIp:'192.0.2.*'}:{};`,
  "qa-archive": `export const isSemesterArchive=false;export const archiveScope=null;`,
  "qa-notifications": `export const createManagedNotifications=async()=>({createdCount:0});export const reviewPerformanceScoreObjection=async()=>({});`,
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
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Manager from'${root}/src/pages/teacher/components/PerformanceScoreManager';import{AppDialogProvider}from'${root}/src/components/common/AppDialogProvider';import'qa-state';createRoot(document.getElementById('root')).render(<BrowserRouter><AppDialogProvider><Manager/></AppDialogProvider></BrowserRouter>);`,
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
    "Synthetic NEIS workbook uses 32 fictitious names and new assessment names/maxima; real attached workbook checked separately without screenshot/save.",
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
    await page.getByText("15점 만점", { exact: true }).waitFor();
    await page.getByText("35점 만점", { exact: true }).waitFor();
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
    assert.equal(await realPage.getByText(/점 만점$/).count(), 2);
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
