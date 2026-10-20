/** Network-free contract checks and an optional CUA harness for the actual panel. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, '.superloopy/wis-ranking-preview-20261020');
assert.equal(execFileSync('git', ['check-ignore', '-z', '--stdin'], { cwd: root, encoding: 'utf8', input: path.relative(root, evidence).replaceAll('\\', '/') + '\0' }).replaceAll('\0', ''), '.superloopy/wis-ranking-preview-20261020');
await fs.mkdir(evidence, { recursive: true });

const makeSnapshot = (uid, semesterId, audience = 'student') => ({
  semesterId, primaryGradeKey: '3', snapshotVersion: 6,
  gradeLeaderboardByGrade: { '3': Array.from({ length: 5 }, (_, index) => ({
    uid: `${uid}-${semesterId}-${audience}-${index}`,
    studentName: ['가나다', '라마바', '사아자', '차카타파하', '긴이름검증학생'][index],
    displayName: `${uid === 'student-b' ? '학생B' : '학생A'} ${semesterId} ${audience} ${index + 1}`,
    grade: '3', class: String(index + 1), number: String(index + 1),
    cumulativeEarned: 2500 - index * 400, currentBalance: 100, rank: index + 1,
  })) },
});
const makeState = call => ({
  semesterId: call.data.semesterId,
  hallOfFame: {
    ...makeSnapshot(call.uid, call.data.semesterId, call.data.audience),
    ...(call.data.projection === 'hall-of-fame' ? {
      classLeaderboardByClassKey: { '3-1': [{ uid: 'public-class-entry', cumulativeEarned: 500, profileIcon: '😀' }] },
    } : {}),
  },
  rankPolicy: { enabled: true, themeId: 'korean_golpum' },
});
const calls = [];
let epoch = 1700000000;
const makeUser = uid => ({ uid, getIdTokenResult: async () => ({ claims: { auth_time: epoch } }) });
const auth = { currentUser: makeUser('student-a') };
const archive = { isSemesterArchive: false, archiveScope: null };
let hold = false;
const sdk = {
  auth,
  getHttpsCallable: async name => async data => {
    const call = { name, data, uid: auth.currentUser?.uid, settled: false };
    calls.push(call);
    if (name === 'openApplicationSession') {
      call.settled = true;
      return { data: { status: 'active', authTime: epoch, authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'a'.repeat(64) } };
    }
    assert.equal(name, 'getWisRankingPreview', 'No broad economy query or additional policy call');
    if (!hold) { call.settled = true; return { data: makeState(call) }; }
    return new Promise((resolve, reject) => Object.assign(call, {
      resolve(state = makeState(call)) { call.settled = true; resolve({ data: state }); },
      reject(error = Object.assign(new Error('Fixture unavailable'), { code: 'functions/unavailable' })) { call.settled = true; reject(error); },
    }));
  },
};
const blocked = name => () => { throw new Error(`Unexpected side effect: ${name}`); };
const storage = Object.fromEntries(['readStorage', 'writeStorage', 'removeStorage', 'readLocalOnly', 'writeLocalOnly'].map(name => [name, blocked(name)]));
const moduleCache = new Map();
const loadActual = relative => {
  const filename = path.resolve(root, relative);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const module = { exports: {} };
  moduleCache.set(filename, module);
  const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const require = name => {
    if (name === './firebase') return sdk;
    if (name === './semesterArchive') return archive;
    if (name === './safeStorage') return storage;
    if (name === './sensitiveOperation') return { ensureSensitiveOperation: blocked('sensitiveOperation') };
    if (name === 'firebase/firestore') return { Timestamp: class Timestamp {
      constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
      static fromMillis(milliseconds) { return new this(milliseconds / 1000); }
    } };
    assert(name.startsWith('.'), `Unexpected dependency: ${name}`);
    return loadActual(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`)));
  };
  vm.runInNewContext(js, { module, exports: module.exports, require, console, URLSearchParams, URL, Date, setTimeout, clearTimeout }, { filename });
  return module.exports;
};
const { getWisRankingPreview, getWisHallOfFameState, getWisHallOfFameView } = loadActual('src/lib/wisRankingPreview.ts');
const { getStudentPointHallOfFame } = loadActual('src/lib/studentWis.ts');
const rankingCalls = () => calls.filter(call => call.name === 'getWisRankingPreview');
const opens = () => calls.filter(call => call.name === 'openApplicationSession').length;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (test, label) => {
  for (let i = 0; i < 100; i++) { if (test()) return; await pause(1); }
  throw new Error(`Timed out: ${label}`);
};
const pendingCalls = () => rankingCalls().filter(call => !call.settled);
const checks = [];
const step = async (name, run) => { await run(); checks.push(name); };
const config = { year: '2026', semester: '2' };
const start = (scope = config, audience = 'student') => getWisRankingPreview(scope, audience);

await step('single bounded callable includes verified session proof and rank policy', async () => {
  const result = await start();
  assert.equal(rankingCalls().length, 1);
  assert.equal(opens(), 1);
  const { data } = rankingCalls()[0];
  assert.equal(data.limit, 5);
  assert.equal(data.projection, 'ranking-preview');
  assert.equal(data.audience, 'student');
  assert.equal(data.source, 'CURRENT');
  assert.equal(data.semesterId, '2026-2');
  assert.equal(data._session.revision, 'a'.repeat(64));
  assert.equal(data._session.protocolVersion, 2);
  assert.equal(result.snapshot.gradeLeaderboardByGrade['3'].length, 5);
  assert.equal(result.rankPolicy.enabled, true);
});
await step('two concurrent mounts share exactly one pending callable', async () => {
  hold = true;
  const before = rankingCalls().length;
  const first = start(), second = start();
  await waitFor(() => pendingCalls().length === 1, 'deduplicated pending call');
  await pause(10);
  assert.equal(rankingCalls().length, before + 1);
  pendingCalls()[0].resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.snapshot.gradeLeaderboardByGrade['3'][0].uid, b.snapshot.gradeLeaderboardByGrade['3'][0].uid);
  assert.equal(opens(), 1, 'Proof is reused; the server validates each read');
});
await step('successful re-entry makes one new authorization-checked read', async () => {
  hold = false;
  const before = rankingCalls().length;
  await start();
  assert.equal(rankingCalls().length, before + 1);
  assert.equal(opens(), 1);
});
await step('full hall uses one authorized read with class data and no extra policy request', async () => {
  const before = calls.length;
  const snapshot = await getStudentPointHallOfFame(config);
  assert.equal(calls.length, before + 1);
  const call = rankingCalls().at(-1);
  assert.equal(call.data.projection, 'hall-of-fame');
  assert.equal(call.data.limit, 20);
  assert.equal(snapshot.classLeaderboardByClassKey['3-1'][0].profileIcon, '😀');
});
await step('full hall deduplicates concurrent consumers but never shares the five-entry preview', async () => {
  hold = true;
  const full = getWisHallOfFameState(config, 'teacher');
  const shared = getWisHallOfFameState(config, 'teacher');
  const preview = start(config, 'teacher');
  await waitFor(() => pendingCalls().length === 2, 'separate projections');
  assert.deepEqual(pendingCalls().map(call => call.data.projection).sort(), ['hall-of-fame', 'ranking-preview']);
  for (const call of pendingCalls()) call.resolve();
  const [state, duplicate, panel] = await Promise.all([full, shared, preview]);
  assert.equal(state, duplicate);
  assert.equal(state.hallOfFame.classLeaderboardByClassKey['3-1'].length, 1);
  assert.equal(panel.snapshot.gradeLeaderboardByGrade['3'].length, 5);
  hold = false;
});
await step('selected hall groups send one scoped request and isolate different group flights', async () => {
  hold = true;
  const first = getWisHallOfFameView(config, 'teacher', { view: 'grade', gradeKey: '3', classKey: '' });
  const duplicate = getWisHallOfFameView(config, 'teacher', { view: 'grade', gradeKey: '3', classKey: '' });
  const classView = getWisHallOfFameView(config, 'teacher', { view: 'class', gradeKey: '', classKey: '3-2' });
  await waitFor(() => pendingCalls().length === 2, 'separate selected hall groups');
  assert(pendingCalls().every(call => call.data.projection === 'hall-view'));
  assert.deepEqual(pendingCalls().map(call => [call.data.hallView, call.data.hallGradeKey, call.data.hallClassKey]),
    [['grade', '3', ''], ['class', '', '3-2']]);
  for (const call of pendingCalls()) call.resolve();
  await Promise.all([first, duplicate, classView]);
  assert.equal(pendingCalls().length, 0, 'No trailing all-class fetch');
  hold = false;
});
await step('failed shared call clears its flight without polling and permits explicit retry', async () => {
  hold = true;
  const before = rankingCalls().length;
  const first = start(), second = start();
  const settled = Promise.allSettled([first, second]);
  await waitFor(() => pendingCalls().length === 1, 'failure call');
  pendingCalls()[0].reject();
  assert((await settled).every(result => result.status === 'rejected'));
  await pause(20);
  assert.equal(rankingCalls().length, before + 1, 'No automatic retry or polling');
  hold = false;
  await start();
  assert.equal(rankingCalls().length, before + 2);
});
await step('semester and audience have separate pending flights', async () => {
  hold = true;
  const before = rankingCalls().length;
  const requests = [start(), start({ year: '2026', semester: '1' }), start(config, 'teacher')];
  await waitFor(() => pendingCalls().length === 3, 'independent scopes');
  assert.equal(rankingCalls().length, before + 3);
  for (const call of pendingCalls()) call.resolve();
  const results = await Promise.all(requests);
  assert.equal(results[0].snapshot.semesterId, '2026-2');
  assert.equal(results[1].snapshot.semesterId, '2026-1');
  assert.match(results[2].snapshot.gradeLeaderboardByGrade['3'][0].uid, /teacher/);
});
await step('archive teacher source is isolated from current teacher source', async () => {
  const current = start(config, 'teacher');
  await waitFor(() => pendingCalls().length === 1, 'current teacher call');
  archive.isSemesterArchive = true;
  archive.archiveScope = config;
  const archived = start(config, 'teacher');
  await waitFor(() => pendingCalls().length === 2, 'archive teacher call');
  assert.deepEqual(pendingCalls().map(call => call.data.source).sort(), ['CURRENT', 'EXPLICIT']);
  for (const call of pendingCalls()) call.resolve();
  await Promise.all([current, archived]);
  archive.isSemesterArchive = false;
  archive.archiveScope = null;
});
await step('new SDK user object with the same UID never shares the previous flight or proof', async () => {
  const first = start();
  const rejection = assert.rejects(first);
  await waitFor(() => pendingCalls().length === 1, 'old SDK identity call');
  const oldCall = pendingCalls()[0], beforeOpen = opens();
  auth.currentUser = makeUser('student-a');
  const second = start();
  await waitFor(() => pendingCalls().length === 2, 'new SDK identity call');
  assert.equal(opens(), beforeOpen + 1);
  const newCall = pendingCalls().find(call => call !== oldCall);
  newCall.resolve();
  await second;
  oldCall.resolve();
  await rejection;
});
await step('auth epoch change isolates flights and rejects late previous-epoch responses', async () => {
  const first = start();
  const rejection = assert.rejects(first);
  await waitFor(() => pendingCalls().length === 1, 'old auth epoch call');
  const oldCall = pendingCalls()[0], beforeOpen = opens();
  epoch++;
  const second = start();
  await waitFor(() => pendingCalls().length === 2, 'new auth epoch call');
  assert.equal(opens(), beforeOpen + 1);
  pendingCalls().find(call => call !== oldCall).resolve();
  await second;
  oldCall.resolve();
  await rejection;
});
await step('account switch rejects late response and uses new account data', async () => {
  const first = start();
  const rejection = assert.rejects(first);
  await waitFor(() => pendingCalls().length === 1, 'account A call');
  const oldCall = pendingCalls()[0];
  auth.currentUser = makeUser('student-b');
  const second = start();
  await waitFor(() => pendingCalls().length === 2, 'account B call');
  pendingCalls().find(call => call !== oldCall).resolve();
  const result = await second;
  assert.match(result.snapshot.gradeLeaderboardByGrade['3'][0].uid, /^student-b-/);
  oldCall.resolve();
  await rejection;
});
await step('wrong-semester server response is rejected and allows a fresh retry', async () => {
  const request = start();
  const rejection = assert.rejects(request);
  await waitFor(() => pendingCalls().length === 1, 'wrong semester response');
  const call = pendingCalls()[0];
  call.resolve({ ...makeState(call), semesterId: '2026-1' });
  await rejection;
  hold = false;
  assert.equal((await start()).snapshot.semesterId, '2026-2');
});
await step('logout prevents stale data and does not issue requests', async () => {
  hold = true;
  const request = start();
  const rejection = assert.rejects(request);
  await waitFor(() => pendingCalls().length === 1, 'logout pending call');
  auth.currentUser = null;
  pendingCalls()[0].resolve();
  await rejection;
  const before = calls.length;
  await assert.rejects(start());
  assert.equal(calls.length, before);
});
assert(rankingCalls().every(call => call.data._session?.revision === 'a'.repeat(64)), 'Every request carries proof');
assert.equal(pendingCalls().length, 0);
const result = { status: 'PASS', externalNetworkRequests: 0, checks, callableCount: rankingCalls().length, sessionHandshakeCount: opens() };
await fs.writeFile(path.join(evidence, 'node-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!process.argv.includes('--serve')) process.exit(0);

// Only data/auth boundaries are substituted. Sorting, policy resolution, badges,
// icons, loading states, and CSS all come from the real application modules.
const imp = relative => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
const service = `
import {useSyncExternalStore} from 'react';
import {resolvePointRankPolicy} from ${imp('src/lib/pointRanks.ts')};
const listeners=new Set();let version=0;
const makeSnapshot=${makeSnapshot.toString()};
export const qa=window.wisRankingQa={
 auth:{currentUser:{uid:'student-a'},authGeneration:1,configReady:false},config:{year:'2026',semester:'2'},audience:'student',calls:[],pending:[],results:[],measurements:[],active:false,mount:0,
 subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},version(){return version},publish(){version++;for(const fn of listeners)fn()},
 reset(){this.auth={currentUser:{uid:'student-a'},authGeneration:this.auth.authGeneration+1,configReady:false};this.config={year:'2026',semester:'2'};this.audience='student';this.calls=[];this.pending=[];this.mount++;this.publish()},
 ready(){this.auth={...this.auth,configReady:true};this.publish()},
 identity(){this.config={...this.config,unrelated:Math.random()};this.publish()},
 semester(){this.config={...this.config,semester:this.config.semester==='2'?'1':'2'};this.publish()},
 logout(){this.auth={...this.auth,currentUser:null,authGeneration:this.auth.authGeneration+1};this.publish()},
 login(uid='student-b'){this.auth={...this.auth,currentUser:{uid},authGeneration:this.auth.authGeneration+1};this.publish()},
 teacher(){this.audience=this.audience==='teacher'?'student':'teacher';this.publish()},
 remount(){this.mount++;this.publish()},
 settle(fail=false,where=()=>true){const task=this.pending.find(p=>!p.settled&&where(p));if(!task)return false;task.settled=true;fail?task.reject(new Error('Synthetic ranking failure')):task.resolve(task.value);this.publish();return true},
};
export const useAuth=()=>{useSyncExternalStore(qa.subscribe,qa.version);return qa.auth};
export const getWisRankingPreview=(scope,audience)=>new Promise((resolve,reject)=>{
 const uid=qa.auth.currentUser?.uid,semesterId=scope.year+'-'+scope.semester;
 const value={snapshot:makeSnapshot(uid,semesterId,audience),rankPolicy:resolvePointRankPolicy({enabled:true,themeId:'korean_golpum'})};
 qa.calls.push({scope:{...scope},audience,uid});qa.pending.push({scope:{...scope},audience,uid,value,resolve,reject,settled:false});queueMicrotask(()=>qa.publish());
});
`;
const harness = `
import React,{useSyncExternalStore,useState} from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';
import WisRankingPanel from ${imp('src/components/common/WisRankingPanel.tsx')};
import ${imp('src/assets/index.css')};import {qa} from 'fixture:service';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(test,label)=>{for(let i=0;i<150;i++){if(test())return;await pause(20)}throw new Error(label)};
const rows=()=>document.querySelectorAll('.wis-ranking-row'),badges=()=>document.querySelectorAll('.wis-ranking-rank-badge');
const names=()=>Array.from(document.querySelectorAll('.wis-ranking-name'),e=>e.textContent).join(' ');
const assert=(value,label)=>{if(!value)throw new Error(label)};
const step=async(label,run)=>{await run();qa.results.push('PASS '+label);qa.publish()};
const resetReady=async()=>{qa.reset();await pause(30);qa.ready();await wait(()=>qa.calls.length===1,'ranking request started')};
let resize=()=>{};
const geometry=()=>{const panel=document.querySelector('.wis-ranking-panel'),p=panel.getBoundingClientRect(),main=panel.parentElement.parentElement,s=getComputedStyle(main);return{requestedWidth:qa.width,availableWidth:main.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),panelParentWidth:panel.parentElement.clientWidth,panelWidth:p.width,panelScrollWidth:panel.scrollWidth,panelClientWidth:panel.clientWidth,pageClientWidth:document.documentElement.clientWidth,pageScrollWidth:document.documentElement.scrollWidth,rows:Array.from(rows(),row=>{const r=row.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width,scroll:row.scrollWidth,client:row.clientWidth}}),buttons:Array.from(panel.querySelectorAll('button'),b=>{const r=b.getBoundingClientRect();return{label:b.getAttribute('aria-label'),left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})}};
async function save(){await fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:qa.results.at(-1)==='ALL PASS'?'PASS':'FAIL',checks:qa.results,calls:qa.calls,measurements:qa.measurements,runtimeNotes:['The harness omits the external Google Fonts CSS import before serving local production CSS, so no font request or CSP rejection is expected.','The cached Tailwind browser runtime may emit its standard CDN development-use warning; it is a fixture preparation notice and not an application runtime failure.','Synthetic ranking failure is intentionally logged once by the real panel during the error recovery check.'],externalRequests:performance.getEntriesByType('resource').filter(e=>!e.name.startsWith(location.origin)).map(e=>e.name)})})}
async function run(){qa.active=true;qa.results=[];qa.measurements=[];qa.publish();try{
 await step('설정 준비 전 요청 0회',async()=>{qa.reset();await pause(70);assert(qa.calls.length===0,'Fetched before scope ready');qa.config={...qa.config,semester:''};qa.ready();await pause(60);assert(qa.calls.length===0,'Fetched with missing semester');qa.config={...qa.config,semester:'2'};qa.auth={...qa.auth,configReady:false};qa.publish();await pause(30)});
 await step('단일 응답으로 Top5와 실제 등급 배지 동시 표시',async()=>{qa.ready();await wait(()=>qa.calls.length===1,'One read starts');assert(rows().length===0,'Rows shown before response');qa.settle();await wait(()=>rows().length===5&&badges().length===5,'Top5 and policy badges');assert(qa.calls.length===1,'Additional policy read');assert(!document.querySelector('.wis-ranking-panel [aria-busy="true"]'),'Loading remains after success')});
 await step('같은 학기 설정 객체 교체 시 재조회 0회',async()=>{const count=qa.calls.length;qa.identity();await pause(70);assert(qa.calls.length===count,'Unrelated config identity fetched');assert(rows().length===5&&badges().length===5,'Displayed rows lost')});
 await step('학기 변경 후 늦은 이전 응답 무시',async()=>{await resetReady();qa.semester();await wait(()=>qa.calls.length===2,'New semester request');qa.settle(false,p=>p.scope.semester==='1');await wait(()=>names().includes('2026-1'),'New semester visible');qa.settle(false,p=>p.scope.semester==='2');await pause(60);assert(!names().includes('2026-2'),'Old semester overwrote latest');assert(badges().length===5,'Badges missing')});
 await step('계정 전환 후 늦은 이전 계정 응답 무시',async()=>{await resetReady();qa.login();await wait(()=>qa.calls.length===2,'Account B request');qa.settle(false,p=>p.uid==='student-b');await wait(()=>names().includes('학생B'),'Account B visible');qa.settle(false,p=>p.uid==='student-a');await pause(60);assert(!names().includes('학생A'),'Account A leaked')});
 await step('같은 UID의 새 로그인 객체도 새 요청',async()=>{await resetReady();qa.login('student-a');await wait(()=>qa.calls.length===2,'New SDK object request');const fresh=qa.pending[1];qa.settle(false,p=>p===fresh);await wait(()=>rows().length===5,'Fresh login visible');qa.settle(false,p=>p!==fresh);await pause(40);assert(rows().length===5,'Previous login affected rows')});
 await step('로그아웃 시 이전 응답 차단 및 재조회 0회',async()=>{await resetReady();qa.logout();await pause(40);assert(rows().length===0,'Logout retained rows');const count=qa.calls.length;qa.settle();await pause(50);assert(rows().length===0,'Logged-out response rendered');assert(qa.calls.length===count,'Logout fetched')});
 await step('교사 경로 전환 후 늦은 학생 응답 무시',async()=>{await resetReady();qa.teacher();await wait(()=>qa.calls.length===2,'Teacher request');qa.settle(false,p=>p.audience==='teacher');await wait(()=>names().includes('teacher'),'Teacher response visible');qa.settle(false,p=>p.audience==='student');await pause(50);assert(!names().includes('student'),'Old audience response rendered')});
 await step('오류 후 로딩 종료 및 자동 반복 조회 없음',async()=>{await resetReady();qa.settle(true);await wait(()=>document.querySelector('.wis-ranking-panel').textContent.includes('표시할 위스 순위가 없습니다.'),'Error leaves loading');assert(!document.querySelector('.wis-ranking-panel [aria-busy="true"]'),'Error remains busy');await pause(100);assert(qa.calls.length===1,'Automatic retry occurred')});
 await step('실패 후 명시적 재진입은 한 번 조회',async()=>{qa.remount();await wait(()=>qa.calls.length===2,'Manual retry');qa.settle();await wait(()=>rows().length===5&&badges().length===5,'Retry success')});
 await step('성공 후 재진입도 한 번만 새 조회',async()=>{qa.remount();await wait(()=>qa.calls.length===3,'Re-entry read');qa.settle();await wait(()=>rows().length===5&&badges().length===5,'Re-entry rows')});
 for(const width of [390,768,1280])await step(width+'px 실제 패널과 버튼 오버플로 없음',async()=>{resize(width);await pause(100);const m=geometry();qa.measurements.push(m);assert(Math.abs(m.panelWidth-Math.min(width,m.availableWidth))<=1,'Harness responsive width mismatch');assert(m.pageScrollWidth<=m.pageClientWidth+1,'Page overflow');assert(m.panelScrollWidth<=m.panelClientWidth+1,'Panel overflow');assert(m.rows.every(r=>r.scroll<=r.client+1),'Row overflow');const panel=document.querySelector('.wis-ranking-panel').getBoundingClientRect();assert(m.buttons.every(b=>b.left>=panel.left&&b.right<=panel.right),'Button outside panel');assert(m.buttons.every(b=>b.label&&b.width>0&&b.height>0),'Invisible or unnamed button')});
 qa.results.push('ALL PASS');
 }catch(error){qa.results.push('FAIL '+error.stack)}finally{qa.active=false;qa.publish();await save()}}
function Fixture(){useSyncExternalStore(qa.subscribe,qa.version);const[width,setWidth]=useState(768);qa.width=width;resize=setWidth;return <main style={{padding:16}}><h1>위스 순위 단일 조회 검증</h1><div className="qa-controls">
<button onClick={run} disabled={qa.active}>전체 자동 검증</button><button onClick={()=>qa.reset()}>초기화</button><button onClick={()=>qa.ready()}>설정 준비 완료</button><button onClick={()=>qa.identity()}>같은 학기 설정 교체</button><button onClick={()=>qa.settle()}>순위와 배지 응답 완료</button><button onClick={()=>qa.semester()}>학기 전환</button><button onClick={()=>qa.logout()}>로그아웃</button><button onClick={()=>qa.login()}>새 계정 로그인</button><button onClick={()=>qa.settle(true)}>순위 실패</button><button onClick={()=>qa.teacher()}>학생·교사 전환</button><button onClick={()=>qa.remount()}>명시적 재진입</button>{[390,768,1280].map(w=><button key={w} onClick={()=>setWidth(w)}>패널 {w}px</button>)}<button onClick={()=>{qa.measurements.push(geometry());qa.publish();save()}}>현재 화면 측정 저장</button></div>
<p>학기 {qa.config.semester} · 계정 {qa.auth.currentUser?.uid||'없음'} · 준비 {String(qa.auth.configReady)} · 요청 {qa.calls.length} · 패널 {width}px</p>
<div style={{width,maxWidth:'100%'}}><WisRankingPanel key={qa.mount} config={qa.config} hallOfFamePath={'/'+qa.audience+'/hall-of-fame'}/></div><pre id="result" aria-live="polite">{qa.results.join('\\n')||'자동 검증 대기'}</pre></main>}
createRoot(document.getElementById('root')).render(<HashRouter><Fixture/></HashRouter>);
`;
const bundle = await build({
  stdin: { contents: harness, loader: 'tsx', resolveDir: root }, bundle: true, write: false,
  format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(evidence, 'fixture.js'),
  loader: { '.svg': 'dataurl', '.webp': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'ranking-data-boundary-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^fixture:|(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/wisRankingPreview$/ }, () => ({ path: 'service', namespace: 'fixture' }));
    plugin.onResolve({ filter: /(?:^|\/)lib\/firebase$|^\.\/firebase$/ }, () => ({ path: 'firebase', namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ contents: name === 'firebase'
      ? 'export const db={};export const auth={currentUser:null};export const getHttpsCallable=()=>{throw new Error("Unexpected Firebase access in panel harness")};'
      : service, loader: 'ts', resolveDir: root }));
  } }],
});
const bundleFiles = bundle.outputFiles.map(file => ({
  path: file.path,
  text: file.path.endsWith('.css')
    ? file.text.replace(/@import\s+["']https:\/\/fonts\.googleapis\.com\/[^;]+;/g, '')
    : file.text,
}));
for (const file of bundleFiles) await fs.writeFile(file.path, file.text);
const tailwindPath = process.env.PORTAL_DESIGN_TAILWIND_PATH || path.join(process.env.TEMP || '', 'westory-qa-tailwind.js');
const tailwind = await fs.readFile(tailwindPath, 'utf8');
assert(tailwind.length > 1000, 'Use an existing local Tailwind runtime; the harness does not fetch external resources');
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'self\' data:; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; connect-src \'self\'; font-src \'self\' data:; img-src \'self\' data:"><title>위스 순위 단일 조회 검증</title><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#f9fafb;font-family:sans-serif}h1{font-size:20px}.qa-controls{display:flex;flex-wrap:wrap;gap:8px}.qa-controls button{min-height:44px;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;background:white}#result{white-space:pre-wrap;font-size:14px}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
await fs.writeFile(path.join(evidence, 'fixture.html'), html);
const files = new Map(bundleFiles.map(file => ['/' + path.basename(file.path), [file.path.endsWith('.css') ? 'text/css' : 'text/javascript', file.text]]));
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'POST' && pathname === '/result') {
      let body = ''; for await (const chunk of req) body += chunk;
      await fs.writeFile(path.join(evidence, 'browser-result.json'), JSON.stringify(JSON.parse(body), null, 2));
      res.end('saved'); return;
    }
    const [type, data] = pathname === '/tailwind.js' ? ['text/javascript', tailwind] : files.get(pathname) || ['text/html', html];
    res.setHeader('Content-Type', type + ';charset=utf-8'); res.end(data);
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
await fs.writeFile(path.join(evidence, 'server.json'), JSON.stringify({ url, pid: process.pid }, null, 2));
console.log(`CUA_FIXTURE_URL=${url}`);
