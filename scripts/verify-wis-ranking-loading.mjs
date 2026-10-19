/** Data-only mocks around the real ranking component; browser control is through CUA. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, '.superloopy/wis-ranking-loading-20261012');
await fs.mkdir(evidence, { recursive: true });
const compile = async file => ts.transpileModule(await fs.readFile(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const load = (js, modules) => {
  const exports = {};
  vm.runInNewContext(js, { exports, require(name) { assert(name in modules, name); return modules[name]; }, console });
  return exports;
};
const calls = [];
let epoch = 1700000000;
const user = { uid: 'fixture', getIdTokenResult: async () => ({ claims: { auth_time: epoch } }) };
const auth = { currentUser: user };
const sdk = { auth, getHttpsCallable: async name => async data => {
  calls.push({ name, data });
  if (name === 'openApplicationSession') return { data: { status: 'active', authTime: epoch, authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'a'.repeat(64) } };
  return { data: { semesterId: data.semesterId, ok: true } };
} };
const applicationSession = load(await compile('src/lib/applicationSession.ts'), { './firebase': sdk, './semesterArchive': { isSemesterArchive: false } });
const session = load(await compile('src/lib/historyDictionarySession.ts'), {
  './applicationSession': applicationSession,
  './firebase': sdk, 'firebase/auth': { getIdTokenResult: async () => ({ authTime: new Date(epoch * 1000).toISOString() }) },
});
const client = load(await compile('src/lib/wisEconomyClient.ts'), {
  './firebase': sdk, './historyDictionarySession': session, './semesterArchive': { isSemesterArchive: false },
  'firebase/firestore': { Timestamp: class {} },
  './semesterScope': { getYearSemester: value => value },
  './sensitiveOperation': { ensureSensitiveOperation: async () => {} },
  './safeStorage': { readStorage() {}, writeStorage() {}, removeStorage() {} },
});
const opens = () => calls.filter(call => call.name === 'openApplicationSession').length;
await client.queryWisState({ year: '2026', semester: '2' }, 'student', 'hall-of-fame');
await client.queryWisState({ year: '2026', semester: '2' }, 'student', 'hall-of-fame');
assert.equal(opens(), 1, 'Sequential ranking reads reuse an established session proof');
assert(calls.filter(call => call.name === 'getWisEconomyState').every(call => call.data._session.revision === 'a'.repeat(64)), 'Every read still sends the server proof');
await client.callWisService('executeCommand', { commandId: 'one' });
await client.callWisService('executeCommand', { commandId: 'two' });
assert.equal(opens(), 1, 'Mutations reuse proof and retain server session validation');
await client.callWisService('getCommandStatus', { commandId: 'one' });
assert.equal(opens(), 1, 'Receipt lookup shares the same verified proof');
auth.currentUser = { ...user };
await client.queryWisState({ year: '2026', semester: '2' }, 'teacher', 'hall-of-fame');
assert.equal(opens(), 2, 'Same UID with a new login object obtains a new session proof');
epoch++;
await client.queryWisState({ year: '2026', semester: '2' }, 'teacher', 'hall-of-fame');
assert.equal(opens(), 3, 'A changed auth epoch obtains a new session proof');
auth.currentUser = null;
await assert.rejects(client.queryWisState({ year: '2026', semester: '2' }, 'student', 'hall-of-fame'));
const regressions = ['verify-history-dictionary-session.mjs', 'verify-application-session-startup.mjs'].map(file => ({
  file, output: execFileSync(process.execPath, [path.join(root, 'scripts', file)], { cwd: root, encoding: 'utf8' }).trim(),
}));
const result = { status: 'PASS', checks: ['ranking reads reuse proof', 'every read sends proof', 'mutations reuse verified proof', 'receipt lookup reuses verified proof', 'login identity isolation', 'auth epoch isolation', 'logout rejects reads'], regressions };
await fs.writeFile(path.join(evidence, 'node-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!process.argv.includes('--serve')) process.exit(0);

const imp = relative => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
const service = `
import {useSyncExternalStore} from 'react';
const listeners=new Set();
let version=0;
export const qa=window.wisRankingQa={
 auth:{currentUser:{uid:'student-a'},authGeneration:1,configReady:false},
 config:{year:'2026',semester:'2'}, audience:'student', calls:[], pending:[], results:[], active:false,
 subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
 version(){return version},
 publish(){version++;for(const fn of listeners)fn()},
 reset(){this.auth={currentUser:{uid:'student-a'},authGeneration:this.auth.authGeneration+1,configReady:false};this.config={year:'2026',semester:'2'};this.audience='student';this.calls=[];this.pending=[];this.publish()},
 ready(){this.auth={...this.auth,configReady:true};this.publish()},
 identity(){this.config={...this.config,unrelated:Math.random()};this.publish()},
 semester(){this.config={...this.config,semester:this.config.semester==='2'?'1':'2'};this.publish()},
 logout(){this.auth={...this.auth,currentUser:null,authGeneration:this.auth.authGeneration+1};this.publish()},
 login(){this.auth={...this.auth,currentUser:{uid:'student-b'},authGeneration:this.auth.authGeneration+1};this.publish()},
 teacher(){this.audience='teacher';this.publish()},
 settle(kind,fail=false,where=()=>true){const task=this.pending.find(p=>!p.settled&&p.kind===kind&&where(p));if(!task)return false;task.settled=true;fail?task.reject(new Error('Synthetic '+kind+' failure')):task.resolve(task.value);this.publish();return true},
};
export const useAuth=()=>{useSyncExternalStore(qa.subscribe,qa.version);return qa.auth};
const request=(kind,scope,audience)=>new Promise((resolve,reject)=>{
 const uid=qa.auth.currentUser?.uid, name=(uid==='student-b'?'학생B':'학생A')+' '+scope.semester+'학기';
 const value=kind==='policy'?{rankPolicy:{}}:{entries:Array.from({length:6},(_,index)=>({uid:uid+'-'+index,studentName:name+' '+(index+1),grade:'3',class:'1',number:String(index+1),cumulativeEarned:1000-index*100,currentBalance:100,rank:index+1}))};
 qa.calls.push({kind,scope:{...scope},audience,uid});qa.pending.push({kind,scope:{...scope},audience,uid,value,resolve,reject,settled:false});queueMicrotask(()=>qa.publish());
});
export const getPointPolicy=scope=>request('policy',scope);
export const getStudentPointHallOfFame=scope=>request('ranking',scope,'student');
export const getCanonicalWisHallOfFame=scope=>request('ranking',scope,'teacher');
export const getWisHallOfFameGradeLeaderboard=snapshot=>snapshot?.entries||[];
export const getPointRankDefaultEmojiValue=()=> '😀';
export const getPointRankDisplay=()=>({enabled:true,label:'선비',themeName:'조선',description:'검증 등급',badgeClass:'border-gray-200 bg-gray-50 text-gray-900'});
`;
const harness = `
import React,{useSyncExternalStore,useState} from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';
import WisRankingPanel from ${imp('src/components/common/WisRankingPanel.tsx')};
import ${imp('src/assets/index.css')};import {qa} from 'fixture:service';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(test,label)=>{for(let i=0;i<150;i++){if(test())return;await pause(20)}throw new Error(label)};
const rows=()=>document.querySelectorAll('.wis-ranking-row');
const names=()=>Array.from(document.querySelectorAll('.wis-ranking-name'),e=>e.textContent).join(' ');
const assert=(value,label)=>{if(!value)throw new Error(label)};
const step=async(label,run)=>{await run();qa.results.push('PASS '+label);qa.publish()};
const resetReady=async()=>{qa.reset();await pause(30);qa.ready();await wait(()=>qa.calls.some(c=>c.kind==='ranking'),'ranking request started')};
async function run(){qa.active=true;qa.results=[];qa.publish();try{
 await step('설정 준비 전 요청 0회',async()=>{qa.reset();await pause(60);assert(qa.calls.length===0,'Fetched before config ready')});
 await step('배지 설정 대기 중 순위 5개 표시',async()=>{qa.ready();await wait(()=>qa.calls.length===2,'Both reads start');assert(qa.calls.filter(c=>c.kind==='ranking').length===1,'One ranking read');qa.settle('ranking');await wait(()=>rows().length===5,'Ranking does not wait for policy');assert(document.querySelectorAll('.wis-ranking-rank-badge').length===0,'Badge not prematurely rendered')});
 await step('같은 학기 설정 객체 교체 시 재조회 없음',async()=>{const count=qa.calls.length;qa.identity();await pause(60);assert(qa.calls.length===count,'Identity change triggered unnecessary read');assert(rows().length===5,'Rankings disappeared')});
 await step('느린 배지 설정 완료 후 순위 유지',async()=>{qa.settle('policy');await wait(()=>document.querySelectorAll('.wis-ranking-rank-badge').length===5,'Badges appear later');assert(rows().length===5,'Rows disappear on policy completion')});
 await step('배지 설정 실패해도 순위 표시',async()=>{await resetReady();qa.settle('policy',true);qa.settle('ranking');await wait(()=>rows().length===5,'Policy failure blocked ranking')});
 await step('학기 변경 후 늦은 이전 응답 무시',async()=>{await resetReady();qa.semester();await wait(()=>qa.calls.filter(c=>c.kind==='ranking').length===2,'New semester request');qa.settle('ranking',false,p=>p.scope.semester==='1');await wait(()=>names().includes('1학기'),'New semester visible');qa.settle('ranking',false,p=>p.scope.semester==='2');qa.settle('policy',false,p=>p.scope.semester==='2');await pause(60);assert(!names().includes('2학기'),'Old ranking overwrote new semester');assert(document.querySelectorAll('.wis-ranking-rank-badge').length===0,'Old semester policy leaked')});
 await step('로그아웃 후 이전 응답 차단 및 새 계정 격리',async()=>{await resetReady();qa.logout();await pause(40);assert(rows().length===0,'Logout kept rows');const count=qa.calls.length;qa.settle('ranking');qa.settle('policy');await pause(40);assert(rows().length===0,'Logged-out stale response rendered');assert(qa.calls.length===count,'Logout fetched');qa.login();await wait(()=>qa.calls.filter(c=>c.kind==='ranking').length===2,'New account request');qa.settle('ranking',false,p=>p.uid==='student-b');await wait(()=>names().includes('학생B'),'New account ranking');assert(!names().includes('학생A'),'Previous account data leaked')});
 await step('순위 실패 후 로딩 종료',async()=>{await resetReady();qa.settle('ranking',true);await wait(()=>document.body.textContent.includes('표시할 위스 순위가 없습니다.'),'Error ends loading');assert(rows().length===0,'Error left previous rows')});
 await step('교사 경로는 교사 순위 조회 사용',async()=>{await resetReady();qa.teacher();await wait(()=>qa.calls.some(c=>c.kind==='ranking'&&c.audience==='teacher'),'Teacher endpoint');qa.settle('ranking',false,p=>p.audience==='teacher');qa.settle('policy',false,p=>!p.settled);await wait(()=>rows().length===5,'Teacher ranking visible');qa.settle('ranking',false,p=>p.audience==='student');await pause(40);assert(rows().length===5,'Old audience response affected result')});
 qa.results.push('ALL PASS');
 }catch(error){qa.results.push('FAIL '+error.stack)}finally{qa.active=false;qa.publish();await fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:qa.results.at(-1)==='ALL PASS'?'PASS':'FAIL',checks:qa.results,calls:qa.calls})})}}
function Fixture(){useSyncExternalStore(qa.subscribe,qa.version);const[width,setWidth]=useState(768);return <main style={{padding:16}}><h1>위스 순위 로딩 검증</h1><div className="qa-controls">
<button onClick={run} disabled={qa.active}>전체 자동 검증</button><button onClick={()=>qa.reset()}>초기화</button><button onClick={()=>qa.ready()}>설정 준비 완료</button><button onClick={()=>qa.identity()}>같은 학기 설정 교체</button><button onClick={()=>qa.settle('ranking')}>순위 응답 완료</button><button onClick={()=>qa.settle('policy')}>배지 설정 완료</button><button onClick={()=>qa.settle('policy',true)}>배지 설정 실패</button><button onClick={()=>qa.semester()}>학기 전환</button><button onClick={()=>qa.logout()}>로그아웃</button><button onClick={()=>qa.login()}>새 계정 로그인</button><button onClick={()=>qa.settle('ranking',true)}>순위 실패</button><button onClick={()=>qa.teacher()}>교사 경로</button>{[390,768,1280].map(w=><button key={w} onClick={()=>setWidth(w)}>패널 {w}px</button>)}</div>
<p>학기 {qa.config.semester} · 계정 {qa.auth.currentUser?.uid||'없음'} · 준비 {String(qa.auth.configReady)} · 순위 요청 {qa.calls.filter(c=>c.kind==='ranking').length} · 설정 요청 {qa.calls.filter(c=>c.kind==='policy').length}</p>
<div style={{width,maxWidth:'100%'}}><WisRankingPanel config={qa.config} hallOfFamePath={'/'+qa.audience+'/hall-of-fame'}/></div><pre id="result" aria-live="polite">{qa.results.join('\\n')||'자동 검증 대기'}</pre></main>}
createRoot(document.getElementById('root')).render(<HashRouter><Fixture/></HashRouter>);
`;
const bundle = await build({ stdin: { contents: harness, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(evidence, 'fixture.js'), loader: { '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'ranking-data-fixture', setup(plugin) {
  plugin.onResolve({ filter: /^fixture:|(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/(points|pointRanks|studentWis|pointEconomyAdapter|wisHallOfFame)$/ }, () => ({ path: 'service', namespace: 'fixture' }));
  plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: service, loader: 'ts', resolveDir: root }));
} }] });
for (const file of bundle.outputFiles) await fs.writeFile(file.path, file.text);
let tailwind = '';
try { tailwind = await fs.readFile(path.join(process.env.TEMP || '', 'westory-qa-tailwind.js'), 'utf8'); } catch {}
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>위스 순위 로딩 검증</title><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#f9fafb;font-family:sans-serif}h1{font-size:20px}.qa-controls{display:flex;flex-wrap:wrap;gap:8px}.qa-controls button{min-height:44px;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;background:white}#result{white-space:pre-wrap;font-size:14px}.wis-ranking-panel{background:white;padding:16px;border-radius:12px}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
await fs.writeFile(path.join(evidence, 'fixture.html'), html);
const files = new Map(bundle.outputFiles.map(file => ['/' + path.basename(file.path), [file.path.endsWith('.css') ? 'text/css' : 'text/javascript', file.text]]));
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'POST' && pathname === '/result') {
    let text = ''; for await (const chunk of req) text += chunk;
    await fs.writeFile(path.join(evidence, 'browser-result.json'), JSON.stringify(JSON.parse(text), null, 2));
    res.end('saved'); return;
  }
  const [type, data] = pathname === '/tailwind.js' ? ['text/javascript', tailwind] : files.get(pathname) || ['text/html', html];
  res.setHeader('Content-Type', type + ';charset=utf-8');res.end(data);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
await fs.writeFile(path.join(evidence, 'server.json'), JSON.stringify({ url, pid: process.pid }, null, 2));
console.log(`CUA_FIXTURE_URL=${url}`);
