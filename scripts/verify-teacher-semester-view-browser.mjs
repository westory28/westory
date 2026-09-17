// Real provider/settings/banner in an isolated browser. Synthetic data only.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const output = mkdtempSync(join(tmpdir(), "westory-teacher-semester-"));
const mock = join(output, "synthetic-state.tsx");
const rootImport = root.replaceAll("\\", "/");
writeFileSync(
  mock,
  `
import React from '${rootImport}/node_modules/react/index.js';
import {assertTeacherSemesterWritable,assertTeacherSemesterCallable} from '${rootImport}/src/lib/teacherSemesterView';
export const AuthContext=React.createContext(null);
export const useAuth=()=>React.useContext(AuthContext);
const initial={year:'2026',semester:'2',showQuiz:true,showScore:true,showLesson:true};
let serverConfig={...initial};
export const auth={currentUser:{uid:'synthetic-admin-a',email:'admin-a@example.invalid'}};
export const db={};
export const doc=()=>({});
export const getDoc=async()=>({exists:()=>true,data:()=>({...serverConfig})});
window.fixtureCommands=[];
window.fixtureReads=[];
export function SyntheticAuthProvider({children}){
 const [uid,setUid]=React.useState('synthetic-admin-a');
 const [config,setConfig]=React.useState({...serverConfig});
 auth.currentUser={uid,email:uid+'@example.invalid'};
 const refreshConfig=React.useCallback(async()=>setConfig({...serverConfig}),[]);
 const value=React.useMemo(()=>({currentUser:{uid,email:uid+'@example.invalid'},userData:{role:'teacher',name:'검증 교사'},config,userConfig:config,loading:false,configReady:true,refreshConfig}),[uid,config,refreshConfig]);
 return <AuthContext.Provider value={value}><div className="border-b border-gray-200 bg-white p-4"><strong>Westory 합성 학기 검증</strong><button className="ml-4 rounded-lg border border-gray-300 px-4 py-3" onClick={()=>setUid(uid==='synthetic-admin-a'?'synthetic-admin-b':'synthetic-admin-a')}>검증 계정 전환</button><span data-testid="account" className="ml-3">{uid}</span></div>{children}</AuthContext.Provider>;
}
const manifests=[
 {semesterId:'2026-1',schoolYear:'2026',term:'1',displayName:'2026학년도 1학기',status:'ARCHIVED',revision:1,readinessPolicyVersion:'fixture-v1'},
 {semesterId:'2026-2',schoolYear:'2026',term:'2',displayName:'2026학년도 2학기',status:'ACTIVE',revision:1,readinessPolicyVersion:'fixture-v1'},
 {semesterId:'2027-1',schoolYear:'2027',term:'1',displayName:'2027학년도 1학기',status:'READY',revision:1,readinessPolicyVersion:'fixture-v1'}
];
let activePointer={semesterId:'2026-2'};
const report=item=>({semesterId:item.semesterId,checks:[{checkId:'curriculumTree',label:'교육과정',required:true,status:'PASS'}]});
export const loadSemesterCoreSnapshot=async()=>({manifests:manifests.map(item=>({...item})),activePointer:{...activePointer},readinessReports:Object.fromEntries(manifests.map(item=>[item.semesterId,report(item)]))});
export const resolveSemester=snapshot=>({ok:true,manifest:snapshot.manifests.find(item=>item.semesterId===snapshot.activePointer.semesterId)});
export const isReadinessCurrent=()=>true;
export const getServerSemesterCoreState=async semesterId=>({error:null,requested:{semesterId},readiness:{current:true}});
export async function getHttpsCallable(name,{expectedUid}={}){
 assertTeacherSemesterCallable(name,expectedUid);
 if(name!=='getTeacherSemesterOptions')throw Error('Unexpected callable: '+name);
 return async()=>{if(auth.currentUser.uid!==expectedUid)throw Error('Synthetic account changed');window.fixtureReads.push(name);return {data:{semesters:manifests.map(item=>({year:item.schoolYear,semester:item.term,label:item.displayName}))}};};
}
export async function executeWestoryCommand(name,payload){
 assertTeacherSemesterWritable(auth.currentUser.uid);
 if(!['updateOperationalSettings','activateSemester'].includes(name))throw Error('Unexpected synthetic write: '+name);
 window.fixtureCommands.push({name,payload});
 if(name==='updateOperationalSettings')serverConfig={...serverConfig,...payload};
 if(name==='activateSemester'){
  const item=manifests.find(item=>item.semesterId===payload.semesterId);
  if(item.status!=='READY'||payload.expectedActiveSemesterId!==activePointer.semesterId)throw Error('Synthetic activation conflict');
  manifests.forEach(row=>{if(row.status==='ACTIVE')row.status='ARCHIVED';});item.status='ACTIVE';activePointer={semesterId:item.semesterId};serverConfig={...serverConfig,year:item.schoolYear,semester:item.term};
 }
 return {result:{}};
}
export const useAppToast=()=>({showToast:({title})=>{document.getElementById('fixture-toast').textContent=title;}});
export const invalidateSiteSettingDocCache=()=>{};
export const notifySystemConfigUpdated=()=>{};
export const requestStepUpReauthentication=async()=>{};
export class StepUpReauthError extends Error{}
`,
);

const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter,Link,useLocation} from 'react-router-dom';
import {SyntheticAuthProvider,useAuth} from '${mock.replaceAll("\\", "/")}';
import {TeacherSemesterProvider} from './src/contexts/TeacherSemesterContext';
import TeacherSemesterBanner from './src/components/common/TeacherSemesterBanner';
import SettingsGeneral from './src/pages/teacher/components/SettingsGeneral';
import {AppDialogProvider} from './src/components/common/AppDialogProvider';
function ScopedPages(){
 const {config,currentUser}=useAuth();const {pathname}=useLocation();
 return <><nav aria-label="검증 메뉴" className="flex flex-wrap gap-4 border-b border-gray-200 bg-white p-4"><Link to="/teacher/settings">기본 환경 설정</Link><Link to="/teacher/lesson">수업 자료</Link><Link to="/teacher/quiz">평가 관리</Link><Link to="/student/dashboard">학생 화면</Link></nav><TeacherSemesterBanner/><main className="p-4"><p data-testid="scope" className="mb-4">{pathname} · {config.year}학년도 {config.semester}학기 · {currentUser.uid}</p>{pathname==='/teacher/settings'?<SettingsGeneral/>:<div className="rounded-xl border border-gray-200 bg-white p-6"><h1>{pathname.startsWith('/student/')?'학생':'교사'} 자료</h1><div data-testid="menu-scope">{config.year}-{config.semester}</div></div>}</main><p id="fixture-toast" role="status" className="p-4"/></>;
}
if(!location.hash)location.hash='/teacher/settings';
createRoot(document.getElementById('root')).render(<HashRouter><SyntheticAuthProvider><TeacherSemesterProvider><AppDialogProvider><ScopedPages/></AppDialogProvider></TeacherSemesterProvider></SyntheticAuthProvider></HashRouter>);
`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  outfile: join(output, "app.js"),
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  metafile: true,
  define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
  plugins: [
    {
      name: "synthetic-semester-fixture",
      setup(api) {
        api.onResolve(
          {
            filter:
              /(?:AuthContext|AppToastProvider|semesterCore|commandGateway|siteSettings|stepUpReauth|appEvents)$|\/firebase$|^firebase\/firestore$/,
          },
          () => ({ path: mock }),
        );
      },
    },
  ],
});
const inputs = Object.keys(bundle.metafile.inputs);
assert.ok(
  !inputs.some((path) => /node_modules\/(?:@firebase|firebase)\//u.test(path)),
  "Firebase must not enter the synthetic fixture",
);
for (const file of [
  "TeacherSemesterContext.tsx",
  "teacherSemesterView.ts",
  "TeacherSemesterBanner.tsx",
  "SettingsGeneral.tsx",
  "AppDialogProvider.tsx",
]) {
  assert.ok(
    inputs.some((path) => path.endsWith(file)),
    `Actual implementation missing: ${file}`,
  );
}
const assets = resolve(root, "dist/assets");
const cssFile = readdirSync(assets).find((name) =>
  /^main-.*\.css$/u.test(name),
);
assert.ok(cssFile, "Run npm run build before this browser check");
const css =
  readFileSync(join(assets, cssFile), "utf8") +
  "\n" +
  readFileSync(resolve(root, "src/assets/index.css"), "utf8");
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"));
const server = createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'",
  );
  response.setHeader(
    "Content-Type",
    pathname === "/app.js"
      ? "text/javascript"
      : pathname === "/app.css"
        ? "text/css"
        : "text/html",
  );
  response.end(
    pathname === "/app.js"
      ? js.contents
      : pathname === "/app.css"
        ? css
        : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Westory 교사 학기 합성 검증</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const results = {
  syntheticOnly: true,
  productionAccess: 0,
  network: "blocked",
  widths: [],
  checks: [],
  errors: [],
  externalRequests: [],
  inputs,
};
let browser;
try {
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
  } catch {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== url) {
      results.externalRequests.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => results.errors.push(error.message));
  const scoped = (year, semester) =>
    page.waitForFunction(
      ([y, s]) =>
        document
          .querySelector('[data-testid="scope"]')
          ?.textContent.includes(y + "학년도 " + s + "학기"),
      [year, semester],
    );
  const noOverflow = async (width) =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      `page overflow at ${width}`,
    );
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${url}/#/teacher/settings`);
    await page.getByLabel("조회 학기", { exact: true }).waitFor();
    await page.waitForFunction(
      () => !document.getElementById("teacher-view-semester").disabled,
    );
    assert.ok(
      await page
        .getByLabel("조회 학기", { exact: true })
        .locator('option[value="1"]')
        .count(),
    );
    await page.getByLabel("조회 학기", { exact: true }).selectOption("1");
    await scoped("2026", "1");
    assert.equal(
      await page
        .getByRole("button", { name: "학생 메뉴 설정 저장", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "운영 학기 전환", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByText("2026학년도 1학기 자료 조회 중 · 읽기 전용", { exact: true })
      .waitFor();
    await noOverflow(width);
    await page.screenshot({
      path: join(output, `settings-past-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("link", { name: "수업 자료", exact: true }).click();
    await scoped("2026", "1");
    assert.equal(await page.getByTestId("menu-scope").textContent(), "2026-1");
    await page.getByRole("link", { name: "평가 관리", exact: true }).click();
    await scoped("2026", "1");
    await page.reload();
    await scoped("2026", "1");
    await page.getByRole("link", { name: "학생 화면", exact: true }).click();
    await scoped("2026", "2");
    assert.equal(
      await page
        .getByText("2026학년도 1학기 자료 조회 중 · 읽기 전용", { exact: true })
        .count(),
      0,
    );
    await page.getByRole("link", { name: "수업 자료", exact: true }).click();
    await scoped("2026", "1");
    const returnButton = page.getByRole("button", {
      name: "현재 운영 학기로 돌아가기",
      exact: true,
    });
    await returnButton.focus();
    assert.equal(
      await returnButton.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
    );
    await returnButton.press("Enter");
    await scoped("2026", "2");
    await noOverflow(width);
    assert.deepEqual(await page.evaluate(() => window.fixtureCommands), []);
    results.widths.push({
      width,
      pastSelection: true,
      menuNavigation: true,
      reload: true,
      studentIsolation: true,
      keyboardReturn: true,
      noOverflow: true,
    });
  }
  await page.getByRole("link", { name: "기본 환경 설정", exact: true }).click();
  await page.getByLabel("조회 학기", { exact: true }).selectOption("1");
  await scoped("2026", "1");
  await page
    .getByRole("button", { name: "검증 계정 전환", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="account"]').textContent ===
      "synthetic-admin-b",
  );
  await scoped("2026", "2");
  assert.equal(
    await page.evaluate(() =>
      sessionStorage.getItem("westory:teacher-semester:synthetic-admin-a"),
    ),
    null,
  );
  await page
    .getByRole("button", { name: "검증 계정 전환", exact: true })
    .click();
  await scoped("2026", "2");
  results.checks.push(
    "Account change clears previous selection and does not transfer it",
  );
  await page
    .getByLabel("운영 전환 학년도", { exact: true })
    .selectOption("2027");
  await page
    .getByRole("button", { name: "학생 메뉴 설정 저장", exact: true })
    .click();
  await page.waitForFunction(() => window.fixtureCommands.length === 1);
  const saved = await page.evaluate(() => window.fixtureCommands[0]);
  assert.equal(saved.name, "updateOperationalSettings");
  assert.deepEqual(Object.keys(saved.payload).sort(), [
    "showLesson",
    "showQuiz",
    "showScore",
  ]);
  await scoped("2026", "2");
  const activate = page.getByRole("button", {
    name: "운영 학기 전환",
    exact: true,
  });
  await activate.click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixtureCommands.length), 1);
  await activate.click();
  await dialog.getByText(/모든 학생과 교사의 운영 학기가 바뀝니다/).waitFor();
  await dialog
    .getByRole("button", { name: "운영 학기 전환", exact: true })
    .click();
  await scoped("2027", "1");
  assert.deepEqual(
    await page.evaluate(() => window.fixtureCommands.map((item) => item.name)),
    ["updateOperationalSettings", "activateSemester"],
  );
  await page.getByRole("link", { name: "학생 화면", exact: true }).click();
  await scoped("2027", "1");
  results.checks.push(
    "Menu save excludes year/semester; cancel causes no activation; explicit confirmed activation changes student semester",
  );
  assert.deepEqual(results.errors, []);
  assert.deepEqual(results.externalRequests, []);
  results.passed = true;
  console.log(
    JSON.stringify({
      passed: true,
      output,
      syntheticOnly: true,
      widths: results.widths.length,
      checks: results.checks,
    }),
  );
} catch (error) {
  results.failure = error.stack || String(error);
  throw error;
} finally {
  writeFileSync(join(output, "result.json"), JSON.stringify(results, null, 2));
  await browser?.close();
  await new Promise((done) => server.close(done));
}
