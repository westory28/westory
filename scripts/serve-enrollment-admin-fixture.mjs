// Isolated actual administration UI. No browser automation, Firebase or real writes.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const output = mkdtempSync(join(tmpdir(), "westory-enrollment-admin-"));
const fixture = join(output, "mock.tsx");
const rootImport = root.replaceAll("\\", "/");
writeFileSync(fixture, `
import React from '${rootImport}/node_modules/react/index.js';
const scenario=new URLSearchParams(location.search).get('scenario')||'normal';
const user={uid:'synthetic-admin',email:'westoria28@gmail.com'};
const config={year:'2026',semester:'2'};
const authValue={currentUser:user,user,userData:{role:'teacher',name:'합성 관리자'},config};
export const useAuth=()=>authValue;
export const auth={currentUser:user}; export const db={};
export const doc=(_db,_collection,uid)=>({uid});
export const getDoc=async()=>({exists:()=>true,data:()=>({role:'teacher',name:'합성 담당 교사'})});
export class WestoryCommandError extends Error{constructor(state,message,options={}){super(message);this.state=state;this.outcomeConfirmed=options.outcomeConfirmed===true;this.retryable=!this.outcomeConfirmed;}}
const clone=value=>JSON.parse(JSON.stringify(value));
const wait=async()=>{await new Promise(resolve=>setTimeout(resolve,30));if(scenario==='error')throw Error('합성 연결 오류');};
const current={semesterId:'2026-2',schoolYear:'2026',term:'2',displayName:'2026학년도 2학기',status:scenario==='readOnly'?'CLOSED':'ACTIVE',startDate:'2026-09-01',endDate:'2027-02-28',revision:4};
const previous={...current,semesterId:'2026-1',term:'1',displayName:'2026학년도 1학기',status:'CLOSED',startDate:'2026-03-01',endDate:'2026-08-31'};
const preparing={...current,semesterId:'2027-1',schoolYear:'2027',term:'1',displayName:'2027학년도 1학기',status:'PREPARING',startDate:'2027-03-01',endDate:'2027-08-31'};
const manifests=[preparing,current,previous];
const classes=(id)=>[1,2].map(n=>({classId:id+'-class-'+n,semesterId:id,grade:'3',classNumber:String(n),classKey:'3::'+n,displayName:'3학년 '+n+'반',status:'ACTIVE',homeroomTeacherUid:user.uid,revision:1,provenance:'CANONICAL'}));
const sourceRows=Array.from({length:66},(_,i)=>({studentUid:'synthetic-student-'+(i+1),enrollmentId:'source-enrollment-'+i,semesterId:previous.semesterId,classId:previous.semesterId+'-class-'+(i<33?'1':'2'),studentNumber:String(i%33+1),enrollmentStatus:i===32?'TRANSFERRED':'ACTIVE',revision:1,snapshot:{displayName:i===7?'긴 이름과 번호를 확인하는 합성 학생 여덟번째':'합성 학생 '+(i+1),grade:'3',classNumber:i<33?'1':'2',classDisplayName:i<33?'3학년 1반':'3학년 2반'}}));
const states={};
for(const m of manifests)states[m.semesterId]={semesterId:m.semesterId,status:m.status,readOnly:m.status==='CLOSED',legacy:false,provenance:m.status==='CLOSED'?'ARCHIVE':m.status==='ACTIVE'?'CURRENT':'PREPARING',classes:classes(m.semesterId),enrollments:[],archive:null,rosterImports:[]};
states[previous.semesterId].enrollments=sourceRows;
states[current.semesterId].enrollments=sourceRows.slice(0,5).map((s,i)=>({...s,semesterId:current.semesterId,enrollmentId:'current-enrollment-'+i,classId:current.semesterId+'-class-1'}));
if(scenario==='duplicate'){sourceRows[5].studentNumber='6';sourceRows[6].studentNumber='6';}
if(scenario==='empty')for(const state of Object.values(states)){state.enrollments=[];state.classes=[];}
export async function loadSemesterCoreSnapshot(){await wait();return clone({manifests,activePointer:{semesterId:current.semesterId,revision:4},readinessReports:{}});}
export async function getServerSemesterCoreState(semesterId){await wait();return clone({requested:manifests.find(m=>m.semesterId===semesterId),active:current,readiness:null});}
export async function getArchiveEnrollmentState(q){await wait();return clone(states[q.semesterId||current.semesterId]);}
let attempts=0,applied=0,previewCount=0;const receipts=new Map();const tried=new Set();
const notify=(action)=>window.dispatchEvent(new CustomEvent('fixture-command',{detail:{attempts,applied,previewCount,action,realWrites:0}}));
export async function previewEnrollmentRoster(p){await wait();previewCount++;notify('명단 확인');return {semesterId:p.semesterId,rosterId:p.rosterId,passed:true,validationHash:'b'.repeat(64),writeCount:0,summary:{expectedStudentCount:p.entries.length,classCount:p.classes.length,enrollmentCount:p.entries.length,duplicateClassCount:0,duplicateStudentCount:0,duplicateStudentNumberCount:0,duplicateExpectedStudentCount:0,orphanStudentCount:0,orphanTeacherCount:0,orphanClassCount:0,missingStudentCount:0,unexpectedStudentCount:0,existingClassConflictCount:0}};}
let pending=scenario==='empty'?[]:[{studentUid:'synthetic-new-student',status:'PENDING',profileVersion:'profile-v1',submittedProfile:{name:'합성 신규 학생',grade:'3',class:'2',number:'20',email:'synthetic-student@example.invalid'},enrollmentId:'',accountState:'NOT_PREPARED',accountRevision:null,blockedReason:''}];
export async function getStudentRegistrationApprovalState(q){await wait();return clone({semesterId:q.semesterId,manifestRevision:4,economyRevision:1,economyReady:true,students:q.studentUid?pending.filter(s=>s.studentUid===q.studentUid):pending,classes:states[q.semesterId].classes,nextCursor:null});}
export async function executeWestoryCommand(type,p,options={}){
 attempts++;notify(type);await wait();
 if(receipts.has(options.commandId))return clone(receipts.get(options.commandId));
 if(scenario==='conflict')throw new WestoryCommandError('conflict','합성 동시 수정 충돌',{outcomeConfirmed:true});
 if(scenario==='uncertain'&&!tried.has(options.commandId)){tried.add(options.commandId);throw new WestoryCommandError('retryable','합성 응답 유실',{outcomeConfirmed:false});}
 const state=states[p.semesterId];if(!state)throw new WestoryCommandError('failed','합성 학기 없음',{outcomeConfirmed:true});
 if(state.readOnly&&!['prepareSemesterArchive','freezeSemesterArchive'].includes(type))throw new WestoryCommandError('failed','읽기 전용',{outcomeConfirmed:true});
 let result={};
 if(type==='importEnrollmentRoster'){
  for(const c of p.classes){if(!state.classes.some(x=>x.classKey===c.grade+'::'+c.classNumber))state.classes.push({...c,classKey:c.grade+'::'+c.classNumber,classId:p.semesterId+'-class-'+c.classNumber,status:'ACTIVE',revision:1});}
  for(const s of p.entries){const c=state.classes.find(x=>x.classKey===s.classKey);state.enrollments.push({studentUid:s.studentUid,enrollmentId:'import-'+s.studentUid,semesterId:p.semesterId,classId:c.classId,studentNumber:s.studentNumber,enrollmentStatus:'ACTIVE',revision:1,snapshot:{displayName:s.displayName,grade:c.grade,classNumber:c.classNumber,classDisplayName:c.displayName}});}
  result={createdEnrollmentCount:p.entries.length,createdIdentityCount:0};
 }else if(type==='moveEnrollment'){
  const old=state.enrollments.find(s=>s.enrollmentId===p.activeEnrollmentId);old.enrollmentStatus='TRANSFERRED';old.revision++;const c=state.classes.find(c=>c.classId===p.targetClassId);state.enrollments.push({...clone(old),enrollmentId:'moved-'+options.commandId,enrollmentStatus:'ACTIVE',classId:c.classId,studentNumber:p.studentNumber,snapshot:{...old.snapshot,classDisplayName:c.displayName,classNumber:c.classNumber},revision:1});
 }else if(type==='prepareSemesterArchive'){
  state.archive={archiveStatus:'PREPARED',integrityHash:'c'.repeat(64),unresolvedBlockingCount:0,counts:{classCount:state.classes.length,enrollmentCount:state.enrollments.length,rosterImportCount:1}};result={integrityHash:state.archive.integrityHash};
 }else if(type==='freezeSemesterArchive'){state.archive.archiveStatus='FROZEN';
 }else if(type==='approveStudentRegistration'){
  const row=pending.find(s=>s.studentUid===p.studentUid);
  if(p.action==='APPROVE'){row.status='APPROVED_PENDING_ACCOUNT';row.enrollmentId='new-approved';row.submittedProfile.name=p.displayName;state.enrollments.push({studentUid:row.studentUid,enrollmentId:row.enrollmentId,semesterId:p.semesterId,classId:p.classId,studentNumber:p.studentNumber,enrollmentStatus:'ACTIVE',revision:1,snapshot:{displayName:p.displayName,classDisplayName:'3학년 2반'}});}
  else if(p.action==='PREPARE_ACCOUNT'){row.accountState='PREPARED';row.accountRevision=1;}
  else if(p.action==='FINALIZE')pending=pending.filter(s=>s.studentUid!==p.studentUid);
 }
 applied++;notify(type+' 완료');const receipt={status:'SUCCEEDED',commandId:options.commandId,commandType:type,result};receipts.set(options.commandId,receipt);return clone(receipt);
}
export const approveStudentRegistration=(p,options)=>executeWestoryCommand('approveStudentRegistration',p,options);
`);
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import SettingsArchiveEnrollment from './src/pages/teacher/components/SettingsArchiveEnrollment';
function Fixture(){const [counter,setCounter]=React.useState({attempts:0,applied:0,previewCount:0,realWrites:0,action:'없음'});React.useEffect(()=>{const listener=e=>setCounter(e.detail);window.addEventListener('fixture-command',listener);return()=>window.removeEventListener('fixture-command',listener);},[]);return <main className='max-w-7xl mx-auto p-4 sm:p-6'><div className='mb-4 p-4 border border-gray-200 rounded-lg bg-gray-50' aria-label='합성 검증 계수'><p>합성 자료 검증 · 실제 서버 변경 {counter.realWrites}회</p><p>저장 요청 {counter.attempts}회 · 합성 반영 {counter.applied}회 · 명단 확인 {counter.previewCount}회</p><p>최근 동작: {counter.action}</p></div><SettingsArchiveEnrollment/></main>};createRoot(document.getElementById('root')).render(<HashRouter><Fixture/></HashRouter>);`;
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" }, plugins: [{ name: "local-only-enrollment", setup(api) {
  api.onResolve({ filter: /AuthContext$|\/firebase$|firebase\/firestore$|\/semesterCore$|\/archiveEnrollment$|\/commandGateway$|\/studentRegistrationApproval$/ }, () => ({ path: fixture }));
} }] });
const inputs = Object.keys(result.metafile.inputs);
assert.ok(!inputs.some((path) => /node_modules\/(?:@firebase|firebase)\//u.test(path)), "Fixture must not include Firebase SDK");
for (const name of ["SettingsArchiveEnrollment.tsx", "EnrollmentRosterImport.tsx", "EnrollmentOperations.tsx", "StudentRegistrationApprovalPanel.tsx", "enrollmentRosterForm.ts"]) assert.ok(inputs.some((path) => path.endsWith(name)), "Actual component/helper missing: " + name);
const assets = resolve(root, "dist/assets");
const cssName = readdirSync(assets).find((name) => /^main-.*\.css$/u.test(name));
assert.ok(cssName, "An existing app build CSS is required");
const css = readFileSync(join(assets, cssName), "utf8") + "\n" + readFileSync(resolve(root, "src/assets/index.css"), "utf8");
writeFileSync(join(output, "fixture-inputs.json"), JSON.stringify({ inputs, firebaseIncluded: false, realWrites: 0 }, null, 2));
if (!process.argv.includes("--serve-only")) console.log(JSON.stringify({ compiled: true, output }));
else {
  const server = createServer((req, res) => {
    const path = new URL(req.url || "/", "http://127.0.0.1").pathname;
    res.setHeader("Content-Security-Policy", "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'");
    res.setHeader("Content-Type", path === "/app.js" ? "text/javascript" : path === "/app.css" ? "text/css" : "text/html");
    res.end(path === "/app.js" ? result.outputFiles[0].contents : path === "/app.css" ? css : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Westory 학적 관리 합성 검증</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, output, scenarios: ["normal", "empty", "readOnly", "error", "duplicate", "conflict", "uncertain"], counter: "합성 검증 계수 DOM region", realWrites: 0, network: "connect-src none" }));
}
