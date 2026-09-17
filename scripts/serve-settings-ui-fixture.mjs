// Actual settings UI with synthetic adapters only. Never connects to Firebase.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

export async function createSettingsUiFixture() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = mkdtempSync(join(tmpdir(), "westory-settings-ui-"));
  const mock = join(output, "synthetic.tsx");
  writeFileSync(
    mock,
    `
import React from 'react';
const scenario = new URLSearchParams(location.search).get('scenario') || 'normal';
const admin = scenario !== 'teacher';
export const ADMIN_EMAIL = 'westoria28@gmail.com';
export const auth = {currentUser:{uid:'synthetic-admin',email:admin?ADMIN_EMAIL:'synthetic-teacher@example.test'}};
export const db = {};
const config = {year:'2026',semester:'2',showQuiz:true,showScore:true,showLesson:true};
const refresh = async()=>{};
const userData = {role:'teacher',name:'합성 교사'};
export const useAuth = () => ({currentUser:auth.currentUser,userData,config,configReady:true,refreshConfig:refresh,refreshInterfaceConfig:refresh});
export const isTeacherUser = ()=>true;
export const useAppToast = () => ({showToast:(value)=>{document.getElementById('fixture-toast').textContent=value.title;}});
export const PageDataLoading = () => <p role="status">불러오는 중...</p>;
export const doc = (...args)=>args.slice(1).join('/');
const stamp = {toMillis:()=>Date.now()};
let access = {enabled:true,blockedRoles:['student'],bypassUids:scenario==='bypass'?['synthetic-exception']:[],title:'학생 접속 안내',message:'선생님의 안내 후 접속해 주세요.',revision:7,startedAt:stamp,updatedAt:stamp,updatedBy:'synthetic-admin'};
const state = {synthetic:true,accessReads:0,accessWrites:0,settingsReads:0,settingsWrites:0,commands:[],closed:true};
const wait = async()=>new Promise(r=>setTimeout(r,scenario==='slow'?1500:40));
const snap = (data)=>({exists:()=>!!data,data:()=>data});
let menus = null;
export async function getDoc(path){await wait();state.settingsReads++;if(scenario==='settings-error')throw Error('Synthetic offline');return snap(path==='site_settings/config'?{...config}:path==='site_settings/menu_config'?menus:null);}
export async function setDoc(path,data){await wait();if(scenario==='save-error')throw Error('Synthetic save denied');state.settingsWrites++;if(path==='site_settings/menu_config')menus=data;}
export const serverTimestamp = ()=>stamp;
export async function getDocFromServer(path){if(path!=='site_settings/student_maintenance')throw Error('Unexpected read');state.accessReads++;await wait();if(scenario==='access-error')throw Error('Synthetic offline');return snap({...access,bypassUids:[...access.bypassUids]});}
export async function getHttpsCallable(name,options){if(name!=='updateStudentMaintenanceConfig'||options.expectedUid!==auth.currentUser.uid||!admin)throw Error('Invalid command');return async data=>{state.accessWrites++;await wait();if(scenario==='write-error')throw Error('Synthetic denied');access={...access,...data,revision:access.revision+1,startedAt:data.enabled?stamp:null};state.closed=access.enabled;if(scenario==='lost-response')throw Error('Synthetic response lost after commit');return {data:access};};}
export class StepUpReauthError extends Error {}
export const requestStepUpReauthentication = async()=>{};
export const invalidateSiteSettingDocCache = ()=>{};
export const notifySystemConfigUpdated = ()=>{};
export const notifyMenuConfigUpdated = ()=>{};
const labels=['manifest_schema','identity_unique','date_range','required_settings','status_transition','schema_version','policy_version','active_conflict','revision_freshness','blocking_issues','trusted_shell_complete','point_policy','assessment_settings','final_exam_config','grading_plans_meta','calendar_meta','notices_meta','archive_readiness','class_readiness','enrollment_readiness','assessment_readiness','grade_evidence_readiness','semester_cutover_readiness'];
const manifests = [{semesterId:'2026-2',schoolYear:'2026',term:'2',displayName:'2026학년도 2학기',status:'ACTIVE',revision:7},{semesterId:'2027-1',schoolYear:'2027',term:'1',displayName:'2027학년도 1학기',status:'READY',revision:1}];
const report = {checks:[...labels.map((checkId,index)=>({checkId,label:checkId,required:true,status:scenario==='incomplete'&&index===2?'FAIL':'PASS'})),{checkId:'semester_duration',label:'학기 운영 기간',required:false,status:'PASS'}]};
export const loadSemesterCoreSnapshot = async()=>{await wait();return {manifests:[...manifests],readinessReports:{'2026-2':report,'2027-1':report},activePointer:{semesterId:'2026-2'}}};
export const resolveSemester = (snapshot)=>({ok:true,manifest:snapshot.manifests[0]});
export const isReadinessCurrent = ()=>scenario!=='stale';
export const getServerSemesterCoreState = async(semesterId)=>{await wait();if(scenario==='reauth')throw {details:{reason:'RECENT_AUTH_REQUIRED'}};return {error:null,requested:{semesterId},readiness:{current:scenario!=='stale'}};};
export const executeWestoryCommand = async(name,payload)=>{state.commands.push(name);throw Error('학기 변경은 이 합성 화면에서 실행하지 않습니다.');};
export const subscribeTeacherPatchNotes = (uid,cb)=>{cb([],{nextCursor:null,hasNext:false});return ()=>{}};
export const createTeacherPatchNote = async()=>{throw Error('Synthetic only');};
export const deleteTeacherPatchNote=createTeacherPatchNote;
export const updateTeacherPatchNote=createTeacherPatchNote;
export const updateTeacherPatchNoteStatus=createTeacherPatchNote;
export const isPatchNoteResultConfirmedFailure=()=>false;
export const isPatchNoteResultUncertain=()=>false;
setInterval(()=>{document.getElementById('fixture-state').textContent=JSON.stringify(state);},40);
export default function Stub(){return null;}
`,
  );
  const result = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter,Routes,Route} from 'react-router-dom';import Settings from './src/pages/teacher/Settings';import Memo from './src/components/common/TeacherPatchMemoController';if(!location.hash)location.hash='/teacher/settings';createRoot(document.getElementById('root')).render(<HashRouter><Routes><Route path="/teacher/settings" element={<Settings/>}/><Route path="/teacher/students" element={<h1>학생 명단 관리</h1>}/></Routes><Memo/></HashRouter>);`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    metafile: true,
    nodePaths: [join(root, "node_modules")],
    loader: { ".svg": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "synthetic-settings-adapters",
        setup(api) {
          api.onResolve(
            {
              filter:
                /AuthContext$|\/firebase$|firebase\/firestore$|\/permissions$|\/AppToastProvider$|\/LoadingState$|\/stepUpReauth$|\/siteSettings$|\/appEvents$|\/semesterCore$|\/commandGateway$|\/teacherPatchNotes$|\/Settings(?:School|Privacy|Access|Notifications|ArchiveEnrollment)$/,
            },
            () => ({ path: mock }),
          );
        },
      },
    ],
  });
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(
    !inputs.some((p) => /node_modules\/(?:@firebase|firebase)\//u.test(p)),
  );
  for (const file of [
    "Settings.tsx",
    "SettingsGeneral.tsx",
    "SettingsStudentAccess.tsx",
    "SettingsInterface.tsx",
    "TeacherPatchMemoController.tsx",
    "studentAccessSettings.ts",
  ])
    assert.ok(
      inputs.some((p) => p.endsWith(file)),
      file,
    );
  const generated = await postcss([
    tailwindcss({
      content: [join(root, "src/**/*.{ts,tsx}")],
      theme: { extend: {} },
      plugins: [],
    }),
  ]).process("@tailwind base;@tailwind components;@tailwind utilities;", {
    from: join(root, "src/assets/tailwind.css"),
  });
  const css = [
    generated.css,
    readFileSync(join(root, "assets/css/style.css"), "utf8"),
    readFileSync(join(root, "src/assets/index.css"), "utf8"),
  ].join("\n");
  const iconCss = readFileSync(
    join(root, "node_modules/@fortawesome/fontawesome-free/css/all.min.css"),
  );
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'self';img-src 'self' data:;script-src 'self'",
    );
    if (pathname.startsWith("/webfonts/")) {
      const name = pathname.split("/").pop();
      if (!/^fa-[a-z-]+-\d+\.woff2$/.test(name)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader("Content-Type", "font/woff2");
      res.end(
        readFileSync(
          join(
            root,
            "node_modules/@fortawesome/fontawesome-free/webfonts",
            name,
          ),
        ),
      );
      return;
    }
    res.setHeader(
      "Content-Type",
      pathname === "/app.js"
        ? "text/javascript"
        : pathname.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(
      pathname === "/app.js"
        ? result.outputFiles[0].contents
        : pathname === "/app.css"
          ? css
          : pathname === "/icons.css"
            ? iconCss
            : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Westory 설정 합성 검증</title><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/icons.css"><output id="fixture-state" hidden></output><output id="fixture-toast" role="status"></output><div id="root"></div><script src="/app.js"></script></html>',
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { server, url: `http://127.0.0.1:${server.address().port}/`, output };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { url, output } = await createSettingsUiFixture();
  console.log(
    JSON.stringify({
      url,
      output,
      syntheticOnly: true,
      firebaseIncluded: false,
      scenarios: [
        "normal",
        "teacher",
        "stale",
        "incomplete",
        "reauth",
        "access-error",
        "settings-error",
        "write-error",
        "lost-response",
        "save-error",
        "slow",
        "bypass",
      ],
    }),
  );
}
