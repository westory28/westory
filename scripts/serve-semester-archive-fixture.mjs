// Actual administrator archive components, synthetic data only. No browser launch.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const output = mkdtempSync(join(tmpdir(), "westory-semester-archive-"));
const mock = join(output, "synthetic-data.tsx");
const rootImport = root.replaceAll("\\", "/");
writeFileSync(mock, `
import React from '${rootImport}/node_modules/react/index.js';
import { MENUS } from '${rootImport}/src/constants/menus';
const config = {year:'2026',semester:'2'};
const profile = {role:'teacher',name:'합성 검증 관리자'};
export const useAuth = () => ({currentUser:{uid:'synthetic-admin',email:'westoria28@gmail.com'},userData:profile,loading:false,config,configReady:true,menuConfig:MENUS,menuConfigReady:true,applicationSessionAuthorityMode:'server',logout:async()=>{}});
const scenario = () => new URLSearchParams(location.search).get('scenario') || 'normal';
const delay = async () => {await new Promise(r=>setTimeout(r,scenario()==='slow'?1800:40));if(scenario()==='error')throw Error('Synthetic offline response');};
const archived = {semesterId:'2026-1',schoolYear:'2026',term:'1',displayName:'2026학년도 1학기',status:'CLOSED',startDate:'2026-03-01',endDate:'2026-08-31',schemaVersion:1,revision:4,readinessPolicyVersion:'fixture',provenance:'ARCHIVE'};
export async function loadSemesterCoreSnapshot(){await delay();return {manifests:scenario()==='empty'?[]:[{...archived,semesterId:'2026-2',term:'2',displayName:'2026학년도 2학기',status:'ACTIVE',provenance:'CURRENT'},archived,{...archived,semesterId:'2025-2',schoolYear:'2025',term:'2',displayName:'2025학년도 2학기',status:'ARCHIVED'}],readinessReports:{},activePointer:{semesterId:'2026-2',revision:1}};}
const students=Array.from({length:321},(_,i)=>({studentUid:'synthetic-student-'+(i+1),displayName:i%17===0?'긴 이름과 학급 표기 줄바꿈을 확인하는 합성 학생 '+(i+1):'합성 학생 '+(i+1),grade:'3',classNumber:String(Math.floor(i/33)+1),studentNumber:String(i%33+1),accountId:'synthetic-account-'+(i+1)}));
const context=(semesterId)=>({semesterId:scenario()==='mismatch'?'2026-2':semesterId,provenance:'ARCHIVE',readOnly:true});
const slice=(rows,cursor,limit=50)=>{const start=Number(cursor||0);return {rows:rows.slice(start,start+limit),nextCursor:start+limit<rows.length?String(start+limit):''};};
export async function getArchiveEnrollmentState(q){await delay();return {...context(q.semesterId),classes:[],enrollments:students.map((s,i)=>({enrollmentId:'synthetic-enrollment-'+i,studentUid:s.studentUid,studentNumber:s.studentNumber,enrollmentStatus:'COMPLETED',snapshot:{...s,classDisplayName:'3학년 '+s.classNumber+'반'}}))};}
export async function getWisEconomyState(q){await delay();const accounts=students.map(s=>({...s,balance:500,earnedTotal:500,spentTotal:0,rankEarnedTotal:0,adjustedTotal:0}));const account=accounts.find(s=>s.accountId===q.accountId);const page=slice(accounts,q.cursor,q.limit);return {...context(q.semesterId),accounts:q.projection==='orders'?accounts:page.rows,account,nextCursor:q.projection==='overview'?page.nextCursor:'',ledger:account?Array.from({length:3},(_,i)=>({ledgerEntryId:'synthetic-ledger-'+i,type:i===0?'INITIAL_GRANT':'REWARD',reason:'합성 학습 활동 보상',delta:i===0?500:10,balanceAfter:500+i*10,createdAt:'2026-08-31T01:00:00Z'})):[],orders:q.projection==='orders'?[{orderId:'synthetic-order',accountId:accounts[0].accountId,productName:'합성 상품',quantity:1,totalPrice:100,status:'FULFILLED',createdAt:'2026-08-30T02:00:00Z'}]:[]};}
export async function getGradeEvidenceState(q){await delay();const page=slice(students,q.cursor,50);return {...context(q.semesterId),nextCursor:page.nextCursor,records:page.rows.map(s=>({headId:'synthetic-grade-'+s.studentUid,studentName:s.displayName,enrollmentLabel:'3학년 '+s.classNumber+'반 '+s.studentNumber+'번',title:'고려의 정치 변화와 역사 자료 해석 수행평가',score:18,maxScore:20,status:'OFFICIAL',evidence:[{id:'synthetic-item',label:'역사 자료 해석',score:18,maxScore:20,studentAnswer:'합성 답안입니다. 실제 학생 자료가 아닙니다.',summary:'주장과 근거를 연결하여 설명했습니다.'}],requests:[{id:'synthetic-request',reason:'채점 근거 확인',response:'합성 확인 답변입니다.'}],attestations:[{id:'synthetic-sign',kind:'SIGNATURE',signerName:s.displayName,signedAt:'2026-08-30T02:00:00Z'}]}))};}
export async function getW8DomainState(q){await delay();return {...context(q.semesterId),scheduleEvents:[{eventId:'synthetic-event',title:'합성 학기 마무리 일정',startAt:'2026-08-31T00:00:00Z',endAt:'2026-08-31T01:00:00Z',description:'일정 내용 줄바꿈 확인용 합성 기록입니다.'}],notices:[{noticeId:'synthetic-notice',title:'합성 1학기 안내',content:'합성 공지입니다.\\n학생에게 발송되지 않습니다.',status:'ARCHIVED'}]};}
export async function getAdminSemesterLegacyRecords(q){await delay();const roster=Array.from({length:357},(_,i)=>{const s=students[i%321];return {id:'synthetic-legacy-'+i,studentUid:'synthetic-old-'+i,studentName:s.displayName,grade:'3',className:s.classNumber,number:s.studentNumber,title:'합성 보관 기록 '+(i+1),status:'완료',amount:10,balance:200,score:88,maxScore:100,occurredAt:'2026-08-25T01:00:00Z',detail:'합성 기록입니다. 실제 잔액이나 성적에는 영향을 주지 않습니다.'};});const rows=q.recordType==='grades'?Array.from({length:3},(_,i)=>({...roster[i],studentUid:q.studentUid,id:'synthetic-score-'+i,title:'합성 성적 '+(i+1),detail:'자료 해석 18 / 20점\\n역사적 설명 26 / 30점\\n보관 성적의 줄바꿈과 상세 근거를 확인합니다.'})):roster;const page=q.recordType==='grades'&&!q.cursor?{rows:[],nextCursor:'scan-next'}:slice(rows,q.cursor==='scan-next'?'0':q.cursor,50);return {...context(q.semesterId),provenance:'LEGACY',recordType:q.recordType,rows:page.rows,nextCursor:page.nextCursor||null,hasMore:!!page.nextCursor};}
export const useAppToast=()=>({showToast:()=>{}});export const inferToastFromAlertMessage=()=>({});
export const loadStudentRankPromotionSnapshot=async()=>({rank:null,policy:{rankPolicy:{}}});export const invalidateStudentRankPromotionSnapshotCache=()=>{};
export const db={};export const doc=()=>({});export const getDoc=async()=>({exists:()=>false});export const runtimeEnvironment='local';export const touchApplicationSession=async()=>({});
export const lazyWithRetry=()=>()=>null;
export default function Stub(){return null;}
`);

const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import MainLayout from './src/components/layout/MainLayout';import Settings from './src/pages/teacher/Settings';import SemesterContextBar from './src/components/common/SemesterContextBar';
if(!location.hash)location.hash='/teacher/settings?tab=archive-records&semesterId=2026-1';
createRoot(document.getElementById('root')).render(<HashRouter><MainLayout>{new URLSearchParams(location.search).get('contextBar')==='1'&&<SemesterContextBar/>}<Settings/></MainLayout></HashRouter>);`;
const result = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", metafile: true,
  loader: { ".svg": "dataurl" },
  define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
  plugins: [{ name: "synthetic-archive-only", setup(api) {
    api.onResolve({ filter: /AuthContext$|AppToastProvider$|\/firebase$|applicationSession$|lazyWithRetry$|firebase\/firestore$|StudentHistoryDictionaryController$|StudentRankPromotionController$|TeacherPatchMemoController$|NotificationBell$|pointRankPromotion$|\/semesterCore$|\/archiveEnrollment$|\/wisEconomy$|\/gradeEvidence$|\/w8Domains$|\/adminSemesterLegacyRecords$|\/Settings(?:General|School|Interface|Privacy|Access|Notifications|ArchiveEnrollment)$/ }, () => ({ path: mock }));
  } }],
});
const inputs = Object.keys(result.metafile.inputs);
assert.ok(!inputs.some((path) => /node_modules\/(?:@firebase|firebase)\//u.test(path)), "Firebase must not enter isolated fixture");
for (const component of ["SettingsArchiveRecords.tsx", "LegacyArchiveRecords.tsx", "Settings.tsx", "MainLayout.tsx", "SemesterContextBar.tsx"]) {
  assert.ok(inputs.some((path) => path.endsWith(component)), `Actual component missing: ${component}`);
}
const assets = resolve(root, "dist/assets");
const cssFile = readdirSync(assets).find((name) => /^main-.*\.css$/u.test(name));
assert.ok(cssFile, "Run the ordinary app build before starting this visual fixture");
const css = readFileSync(join(assets, cssFile), "utf8") + "\n" + readFileSync(resolve(root, "src/assets/index.css"), "utf8");
writeFileSync(join(output, "fixture-inputs.json"), JSON.stringify({ inputs, syntheticOnly: true, firebaseIncluded: false }, null, 2));
if (!process.argv.includes("--serve-only")) {
  console.log(JSON.stringify({ compiled: true, output, message: "Add --serve-only to serve for the user's westoria28 Chrome; no browser is launched." }));
} else {
  const server = createServer((request, response) => {
    const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
    response.setHeader("Content-Security-Policy", "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'");
    response.setHeader("Content-Type", path === "/app.js" ? "text/javascript" : path === "/app.css" ? "text/css" : "text/html");
    response.end(path === "/app.js" ? result.outputFiles[0].contents : path === "/app.css" ? css : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Westory 보관 기록 합성 검증</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/#/teacher/settings?tab=archive-records&semesterId=2026-1`, output, scenarios: ["normal", "slow", "empty", "error", "mismatch"], network: "connect-src none", syntheticOnly: true }));
}
