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
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const state = `
export const data=[
 {id:'qa-active',role:'student',grade:'3',class:'1',number:'1',studentName:'가나다',email:'qa-active@example.test'},
 {id:'qa-excluded',role:'student',grade:'3',class:'1',number:'2',studentName:'전출예시',email:'qa-excluded@example.test',enrollmentStatus:'transferred',enrollmentReason:'합성 전출 사유'},
 {id:'qa-outside',role:'student',grade:'3',class:'1',number:'3',studentName:'정원외예시',email:'qa-outside@example.test',enrollmentStatus:'outside_quota'},
 {id:'qa-staff',role:'staff',grade:'3',class:'1',number:'4',studentName:'직원예시',email:'qa-staff@example.test'}
];
if(new URLSearchParams(location.search).has('legacy321'))data.splice(0,data.length,...Array.from({length:321},(_,index)=>({id:'qa-legacy-'+index,role:'student',grade:'3',class:String(Math.floor(index/27)+1),number:String(index%27+1),studentName:'기존학생'+String(index+1).padStart(3,'0'),email:'qa-legacy-'+index+'@example.test'})),...[
 {id:'qa-null',studentName:'미승인널',registrationApprovalStatus:null},
 {id:'qa-empty',studentName:'미승인빈값',registrationApprovalStatus:''},
 {id:'qa-undefined',studentName:'미승인미정',registrationApprovalStatus:undefined}
].map((student,index)=>({role:'student',grade:'3',class:'1',number:String(index+28),email:student.id+'@example.test',...student})));
export const events=[];
window.rosterQa={data,events,fail:false};
`;
const mocks = {
  "qa-state": state,
  "qa-auth": `export const useAuth=()=>({userData:{role:new URLSearchParams(location.search).has('readonly')?'staff':'teacher'},currentUser:{email:'qa-teacher@example.test'},config:{year:'2026',semester:'2'}});`,
  "qa-firestore": `import{data}from'qa-state';export const collection=(db,name)=>({name});export const doc=(db,...names)=>({names});export const getDoc=async()=>({exists:()=>false});export const getDocs=async()=>{if(new URLSearchParams(location.search).has('loaderror'))throw new Error('synthetic read failure');const docs=data.map(({id,...value})=>({id,data:()=>value}));return{docs,forEach:fn=>docs.forEach(fn)};};`,
  "qa-firebase": `import{data,events}from'qa-state';
export const db={};export const auth={currentUser:{uid:'qa-teacher',getIdTokenResult:async()=>({claims:{auth_time:10}})}};
export const getHttpsCallable=async(name)=>async(input)=>{
 if(name==='openApplicationSession')return{data:{status:'active',authTime:10,authorityGeneration:'w1r2-2026-08-09',protocolVersion:2,revision:'a'.repeat(64)}};
 events.push({name,input});if(window.rosterQa.fail)throw Object.assign(new Error('synthetic save failure'),{code:'unavailable'});
 if(name==='createStudentData'){data.push({id:'qa-new',role:'student',...input,studentName:input.name,enrollmentStatus:'active',registrationApprovalStatus:'PENDING'});return{data:{uid:'qa-new',registrationApprovalStatus:'PENDING',requiresFirstSignIn:true}};}
 if(name==='getStudentRegistrationApprovalState'){const student=data.find(item=>item.id===input.studentUid);return{data:{semesterId:'2026-2',manifestRevision:1,economyRevision:1,economyReady:true,classes:[{classId:'class-3-1',grade:'3',classNumber:'1',revision:1}],students:[{studentUid:student.id,status:student.registrationApprovalStatus,profileVersion:'a'.repeat(64),submittedProfile:{...student,number:String(student.number)},enrollmentId:'enr-qa',accountState:student.accountState||'NOT_PREPARED',accountRevision:1,blockedReason:''}]}};}
 if(name==='executeCommand'){if(!window.rosterQa.schoolVerified)throw Object.assign(new Error('학교 계정 확인 필요'),{code:'functions/failed-precondition',details:{reason:'REGISTRATION_SCHOOL_ACCOUNT_REQUIRED'}});const student=data.find(item=>item.id===input.payload.studentUid);const action=input.payload.action;if(action==='APPROVE')student.registrationApprovalStatus='APPROVED_PENDING_ACCOUNT';if(action==='PREPARE_ACCOUNT')student.accountState='PREPARED';if(action==='FINALIZE')student.registrationApprovalStatus='APPROVED';return{data:{status:'SUCCEEDED',result:{studentUid:student.id,semesterId:'2026-2',enrollmentId:'enr-qa',status:student.registrationApprovalStatus,action}}};}
 if(name==='updateStudentEnrollment'){Object.assign(data.find(student=>student.id===input.uid),{enrollmentStatus:input.status,enrollmentReason:input.reason});return{data:{uid:input.uid,status:input.status}};}
 return{data:{}};
};`,
  "qa-archive": `export const isSemesterArchive=false;export const archiveScope=null;`,
  "qa-detail": `export default()=>null;`,
};
const moduleFor = (request) => {
  const value = request.replaceAll("\\", "/");
  if (value in mocks) return value;
  if (value === "firebase/firestore") return "qa-firestore";
  if (/contexts\/AuthContext$/.test(value)) return "qa-auth";
  if (/lib\/firebase$/.test(value)) return "qa-firebase";
  if (/lib\/semesterArchive$/.test(value)) return "qa-archive";
  if (/StudentDetailModal$/.test(value)) return "qa-detail";
};
const result = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import StudentList from'${root}/src/pages/teacher/StudentList';import'qa-state';createRoot(document.getElementById('root')).render(<StudentList/>);`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "browser",
  loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"' },
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
    [
      "assets/css/style.css",
      "src/assets/index.css",
      "src/pages/teacher/components/teacher-list-controls.css",
    ].map((name) => fs.readFile(root + "/" + name, "utf8")),
  )
)
  .join("\n")
  .replace(/@import[^;]+;/g, "")
  .replace(/@tailwind[^;]+;/g, "");
const html = `<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const tailwind = await fs.readFile(
  process.env.SCORE_QA_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
);
const server = http.createServer((req, res) => {
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
  kind: "synthetic-real-browser-roster-qa",
  viewports: [],
  checks: [],
  screenshots: [],
  pageErrors: [],
  limitations: [
    "Local real React components with synthetic users/AuthContext/callables; no production Firebase writes or real student records.",
    "Fonts/icons use local fallback; authenticated production workflow not proven.",
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
  for (const width of [320, 390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (error) => report.pageErrors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin);
    await page.getByRole("button", { name: "가나다", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "전출예시", exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "직원예시", exact: true }).count(),
      0,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `${out}/roster-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`roster-${width}.png`);
    await page.getByRole("button", { name: "학생 등록", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
    await page.screenshot({
      path: `${out}/create-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`create-${width}.png`);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      await page
        .getByRole("button", { name: "학생 등록", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.getByLabel("학적 상태 필터").selectOption("excluded");
    await page.getByRole("button", { name: "전출예시", exact: true }).waitFor();
    await page
      .getByRole("button", { name: "전출예시 학적 상태 변경", exact: true })
      .click();
    await dialog.waitFor();
    await page.screenshot({
      path: `${out}/enrollment-${width}.png`,
      fullPage: true,
    });
    report.screenshots.push(`enrollment-${width}.png`);
    await dialog
      .getByLabel("학적 상태", { exact: true })
      .selectOption("active");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByLabel("학적 상태 필터").selectOption("active");
    await page.getByRole("button", { name: "전출예시", exact: true }).waitFor();
    report.viewports.push(width);
    await page.close();
  }
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "학생 등록", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("학년", { exact: true }).selectOption("3");
  await dialog.getByLabel("반", { exact: true }).selectOption("1");
  await dialog.getByLabel("번호", { exact: true }).fill("1");
  await dialog.getByLabel("이름", { exact: true }).fill("등록예시");
  await dialog
    .getByLabel("학교 이메일 (로그인 계정)", { exact: true })
    .fill("qa-new@example.test");
  await dialog.getByRole("button", { name: "등록", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "같은 학년" }).waitFor();
  assert.equal(await page.evaluate(() => window.rosterQa.events.length), 0);
  report.checks.push("Duplicate active class/number blocked before write.");
  await dialog.getByLabel("번호", { exact: true }).fill("5");
  await page.evaluate(() => (window.rosterQa.fail = true));
  await dialog.getByRole("button", { name: "등록", exact: true }).click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "저장 결과를 확인하지 못했습니다" })
    .waitFor();
  assert.equal(
    await dialog.getByLabel("이름", { exact: true }).inputValue(),
    "등록예시",
  );
  await page.evaluate(() => (window.rosterQa.fail = false));
  await dialog.getByRole("button", { name: "등록", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "등록예시", exact: true }).waitFor();
  const created = await page.evaluate(
    () =>
      window.rosterQa.events.find((event) => event.name === "createStudentData")
        .input,
  );
  assert.equal(created.year, "2026");
  assert.equal(created.semester, "2");
  report.checks.push(
    "Save error keeps inputs; retry creates roster student in current semester.",
  );
  await page.getByRole("status").filter({ hasText: "처음 로그인" }).waitFor();
  await page.getByLabel("학적 상태 필터").selectOption("active");
  assert.equal(
    await page.getByRole("button", { name: "등록예시", exact: true }).count(),
    0,
  );
  await page.getByLabel("학적 상태 필터").selectOption("pending");
  await page
    .getByRole("button", { name: "등록예시 등록 승인", exact: true })
    .click();
  await dialog.getByLabel("학급·번호·이름을 확인했습니다.").check();
  await dialog.getByRole("button", { name: "등록 승인", exact: true }).click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "학교 계정으로 처음 로그인" })
    .waitFor();
  assert.equal(await dialog.isVisible(), true);
  await page.screenshot({
    path: `${out}/registration-wait-1280.png`,
    fullPage: true,
  });
  report.screenshots.push("registration-wait-1280.png");
  await page.evaluate(() => (window.rosterQa.schoolVerified = true));
  await dialog.getByRole("button", { name: "등록 승인", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "등록예시", exact: true }).waitFor();
  await page
    .getByRole("status")
    .filter({ hasText: "등록 승인을 완료" })
    .waitFor();
  assert.deepEqual(
    await page.evaluate(() =>
      window.rosterQa.events
        .filter((event) => event.name === "executeCommand")
        .map((event) => event.input.payload.action),
    ),
    ["APPROVE", "APPROVE", "PREPARE_ACCOUNT", "FINALIZE"],
  );
  report.checks.push(
    "Pending registration stays out of active roster; first school login is required; approval resumes through three stages before active roster and success message.",
  );
  await page
    .getByRole("button", { name: "등록예시 학적 상태 변경", exact: true })
    .click();
  await dialog.getByLabel("학적 상태", { exact: true }).selectOption("other");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  assert.equal(await dialog.isVisible(), true);
  await dialog
    .getByLabel("제외 사유 (필수)", { exact: true })
    .fill("합성 제외");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByLabel("학적 상태 필터").selectOption("other");
  await page.getByRole("button", { name: "등록예시", exact: true }).waitFor();
  await page.getByText("합성 제외", { exact: true }).waitFor();
  report.checks.push(
    "Other exclusion requires reason and appears in managed excluded roster.",
  );
  await page.goto(origin + "?readonly");
  await page.getByText("읽기 전용 권한입니다.", { exact: false }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "학생 등록", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: /학적 상태 변경/ }).count(),
    0,
  );
  report.checks.push("Read-only viewer has no roster mutations.");
  await page.goto(origin + "?loaderror");
  await page
    .getByRole("alert")
    .filter({ hasText: "불러오지 못했습니다" })
    .waitFor();
  await page.getByRole("button", { name: "다시 시도", exact: true }).waitFor();
  report.checks.push("Load error exposes retry.");
  await page.goto(origin + "?legacy321");
  await page.getByText("(321명)", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "기존학생001", exact: true })
    .waitFor();
  await page.getByLabel("학적 상태 필터").selectOption("pending");
  await page.getByText("(3명)", { exact: true }).waitFor();
  for (const name of ["미승인널", "미승인빈값", "미승인미정"])
    await page.getByRole("button", { name, exact: true }).waitFor();
  report.checks.push(
    "321 synthetic legacy students with absent approval fields remain active; explicit null/empty/undefined approval fields appear only in pending roster.",
  );
  report.checks.push(
    "320/390/768/1280: no page overflow; native modal fits; Escape closes and focus returns; excluded → active restores student.",
  );
  assert.deepEqual(report.pageErrors, []);
  await fs.writeFile(out + "/report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
