// Isolated Firestore emulator + actual web SDK watchers + exported callable.run.
// The loopback bridge injects synthetic auth/session fixtures, never production credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createHash, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const project = 'demo-westory-session-yut-network';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host) || process.env.GCLOUD_PROJECT !== project) throw new Error('Dedicated local Yut network emulator required.');
process.env.GOOGLE_CLOUD_PROJECT = project;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: project });
process.env.WESTORY_SESSION_IDLE_MODE = 'ENFORCE';
process.env.WESTORY_APP_CHECK_MODE = 'DISABLED';
const deployed = require('../index');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const db = getFirestore();
const root = path.resolve(__dirname, '../..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const { build } = requireRoot('esbuild');
let playwright;
try { playwright = requireRoot('playwright'); }
catch { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const evidence = path.join(root, 'output/yut-network-20261018');
const base = 'years/2026/semesters/2';
const authTime = Math.floor(Date.now() / 1000) - 10;
const proof = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'b'.repeat(64) };
const uid = label => `yut-network-${label}`;
const request = (label, data = {}) => ({ auth: { uid: uid(label), token: { email: `${label}@yongshin-ms.ms.kr`, auth_time: authTime } }, data: { year: '2026', semester: '2', _session: proof, ...data } });
const run = (name, label, data) => deployed[name].run(request(label, data));
const getRoom = async id => (await db.doc(`${base}/yut_rooms/${id}`).get()).data();
const checks = [], errors = [], calls = [];
let browser, server;
const pages=[];
const modulePath = value => JSON.stringify(path.join(root, value).replaceAll('\\', '/'));
async function seed() {
  const rules = await fetch(`http://${host}/emulator/v1/projects/${project}:securityRules`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: await fs.readFile(path.join(root, 'firestore.rules'), 'utf8') }] } }),
  });
  assert.equal(rules.status, 200, `isolated network project rules: ${await rules.text()}`);
  const records = {
    'site_settings/config': { year: '2026', semester: '2' },
    'site_settings/student_maintenance': { enabled: false, blockedRoles: ['student'], bypassUids: Array.from({ length: 20 }, (_, i) => `maintenance-bypass-${i}`), title: '점검', message: '점검 중', startedAt: null, updatedAt: Timestamp.now(), updatedBy: 'qa-admin', revision: 1 },
    'site_settings/semester_active': { semesterId: '2026-2', revision: 1 },
    'semester_manifests/2026-2': { semesterId: '2026-2', status: 'ACTIVE', revision: 1 },
    [`${base}/weplay_games/joseon-yut`]: { enabled: true, version: 1, allowSolo: true, allowMultiplayer: true, allowPrivateRooms: true, defaultPlayerCount: 4, throwSeconds: 15, moveSeconds: 60 },
  };
  for (const [index, label] of ['a', 'b', 'c', 'd', 'teacher'].entries()) {
    records[`users/${uid(label)}`] = { role: label === 'teacher' ? 'teacher' : 'student', name: `검증${label}`, registrationApprovalStatus: 'APPROVED' };
    records[`application_sessions/${uid(label)}/sessions/${authTime}`] = { status: 'active', authTime, schemaVersion: 2, authorityGeneration: proof.authorityGeneration, protocolVersion: 2, sessionRevision: proof.revision, authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000) };
    if (label === 'teacher') continue;
    const slotId = 'slot_' + createHash('sha256').update(`2026-2\n${uid(label)}`).digest('hex').slice(0, 40);
    records[`semester_enrollment_slots/${slotId}`] = { studentUid: uid(label), semesterId: '2026-2', activeEnrollmentId: `network_${label}`, status: 'ACTIVE' };
    records[`semester_enrollments/network_${label}`] = { studentUid: uid(label), semesterId: '2026-2', enrollmentStatus: 'ACTIVE', classId: `network_class_${index}`, studentName: `검증${label}` };
    records[`semester_classes/network_class_${index}`] = { semesterId: '2026-2', status: 'ACTIVE', grade: '3', classNumber: String(index + 1) };
  }
  const batch = db.batch();
  for (const [key, value] of Object.entries(records)) batch.set(db.doc(key), value);
  await batch.commit();
}
async function createHarness() {
  const firebaseModule = `
import {initializeApp} from 'firebase/app';
import {initializeFirestore,connectFirestoreEmulator,disableNetwork,enableNetwork} from 'firebase/firestore';
const label=new URLSearchParams(location.search).get('uid')||'a';
window.netQA={calls:[],snapshots:[],renderedRoom:null,delayAction:'',delayMs:0,dropAction:'',hangAction:'',hidden:false};
Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.netQA.hidden});
const app=initializeApp({projectId:${JSON.stringify(project)},apiKey:'emulator-only',authDomain:'localhost'});
export const db=initializeFirestore(app,{experimentalForceLongPolling:true});
connectFirestoreEmulator(db,'127.0.0.1',${Number(host.split(':')[1])},{mockUserToken:{sub:'yut-network-'+label,user_id:'yut-network-'+label,email:label+'@yongshin-ms.ms.kr',email_verified:true,auth_time:${authTime}}});
window.netQA.offline=()=>disableNetwork(db);window.netQA.online=()=>enableNetwork(db);
window.netQA.setHidden=value=>{window.netQA.hidden=value;document.dispatchEvent(new Event('visibilitychange'));};
`;
  const sdkPath = path.join(root, 'node_modules/firebase/firestore/dist/esm/index.esm.js');
  const firestoreFacade = `
export * from ${JSON.stringify(sdkPath.replaceAll('\\','/'))};
import {onSnapshot as realSnapshot} from ${JSON.stringify(sdkPath.replaceAll('\\','/'))};
export function onSnapshot(reference,options,next,error){return realSnapshot(reference,options,snapshot=>{window.netQA.snapshots.push(snapshot);window.netQA.injectSnapshot=index=>next(window.netQA.snapshots[index]);next(snapshot);},error);}
`;
  const sessionModule = `
export async function getHistoryDictionaryCallable(name){return async data=>{
const qa=window.netQA,action=data?.action||name,label=new URLSearchParams(location.search).get('uid')||'a';
qa.calls.push({name,data:structuredClone(data),at:Date.now()});
const delay=qa.delayAction===action?qa.delayMs:0,drop=qa.dropAction===action,hang=qa.hangAction===action;
if(delay){qa.delayAction='';qa.delayMs=0;}if(drop)qa.dropAction='';if(hang)qa.hangAction='';
const response=await fetch('/qa/'+name+'?uid='+label,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
const payload=await response.json();if(!response.ok)throw Object.assign(new Error(payload.message),{code:payload.code});
if(drop)throw Object.assign(new Error('Synthetic lost acknowledgement'),{code:'unavailable'});
if(hang)await new Promise(()=>{});if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
return {data:payload};};}
`;
  const authModule = `export const useAuth=()=>({config:{year:'2026',semester:'2'},currentUser:{uid:'yut-network-'+(new URLSearchParams(location.search).get('uid')||'a')},userData:{role:'student'}});`;
  const boardModule = `import React from 'react';import Board,{yutNodeLabel} from ${modulePath('src/components/common/weplay/yut/YutBoard.tsx')};export {yutNodeLabel};export default function ObservedBoard(props){window.netQA.renderedRoom=structuredClone(props.room);return <Board {...props}/>;}`;
  const harness = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Game from ${modulePath('src/components/common/weplay/yut/YutGame.tsx')};
import ${modulePath('src/assets/index.css')};
const music={enabled:false,failed:false,loading:false,start(){},toggle(){}};
function Harness(){const[shown,setShown]=useState(true);window.netUnmount=()=>setShown(false);return shown?<Game portal="student" music={music} onMusicActiveChange={()=>{}} onBack={()=>setShown(false)}/>:<p data-unmounted>나감</p>;}
createRoot(document.getElementById('root')).render(<Harness/>);`;
  const bundle = await build({ stdin: { contents: harness, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(os.tmpdir(),'yut-network.js'),
    loader: { '.woff2':'file','.woff':'file','.svg':'dataurl','.png':'dataurl','.webp':'dataurl' }, assetNames:'qa-assets/[name]-[hash]',
    define:{'process.env.NODE_ENV':'"production"','import.meta.env.BASE_URL':'"/"'},
    plugins:[{name:'isolated-network',setup(plugin){
      plugin.onResolve({filter:/^\/assets\//},args=>({path:args.path,external:true}));
      plugin.onResolve({filter:/(?:^|\/)contexts\/AuthContext$/},()=>({path:'auth',namespace:'fixture'}));
      plugin.onResolve({filter:/(?:^|\/)firebase$/},()=>({path:'firebase',namespace:'fixture'}));
      plugin.onResolve({filter:/(?:^|\/)historyDictionarySession$/},()=>({path:'session',namespace:'fixture'}));
      plugin.onResolve({filter:/^firebase\/firestore$/},()=>({path:'firestore',namespace:'fixture'}));
      plugin.onResolve({filter:/^\.\/YutBoard$/},()=>({path:'board',namespace:'fixture'}));
      plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:{auth:authModule,firebase:firebaseModule,session:sessionModule,firestore:firestoreFacade,board:boardModule}[args.path],loader:'tsx',resolveDir:root}));
    }}] });
  const assets = new Map(bundle.outputFiles.map(file=>[path.relative(os.tmpdir(),file.path).replaceAll('\\','/'),file.contents]));
  server = http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/qa/')){
        const name=url.pathname.slice(4),label=url.searchParams.get('uid');
        assert.ok(['getYutLobby','commandYutRoom'].includes(name)); assert.ok(['a','b','c','d'].includes(label));
        let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body||'{}');const recorded={name,label,data};calls.push(recorded);
        try{const result=await run(name,label,data);recorded.result={revision:result.room?.revision,syncRevision:result.room?.syncRevision};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));}
        catch(error){recorded.error=error.code;res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({code:error.code,message:error.message}));}return;
      }
      if(url.pathname==='/'){res.writeHead(200,{'content-type':'text/html'});res.end('<div id="root"></div><link rel="stylesheet" href="/yut-network.css"><script type="module" src="/yut-network.js"></script>');return;}
      const bundled=assets.get(url.pathname.slice(1));
      if(bundled){res.writeHead(200,{'content-type':url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'application/octet-stream'});res.end(bundled);return;}
      const file=path.resolve(root,'public','.'+url.pathname);
      if(!file.startsWith(path.join(root,'public')+path.sep)){res.writeHead(404);res.end();return;}
      const contents=await fs.readFile(file);res.writeHead(200,{'content-type':file.endsWith('.webp')?'image/webp':file.endsWith('.ttf')?'font/ttf':'application/octet-stream'});res.end(contents);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function until(fn,message,timeout=15000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(message);}
async function browserRoom(page){return page.evaluate(()=>window.netQA.renderedRoom);}
async function awaitObservedRoom(pages,room){await until(async()=> (await Promise.all(pages.map(page=>page.evaluate(({id,revision})=>window.netQA.snapshots.some(snapshot=>!snapshot.metadata.fromCache&&snapshot.id===id&&snapshot.data()?.revision>=revision),room)))).every(Boolean),'server room revision did not reach all clients');}
async function closeRoom(room){return run('commandYutRoom','teacher',{action:'close',roomId:room.id,expectedRevision:room.revision,requestKey:randomUUID()});}

(async()=>{
  await fs.mkdir(evidence,{recursive:true});await seed();const origin=await createHarness();
  browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  for(const label of ['a','b','c','d']){const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/?uid='+label);await page.getByRole('button',{name:'여럿이서 시작',exact:true}).waitFor();pages.push(page);}
  const[a,b,c,d]=pages;
  // A lost create/join response must be retried with its original identity.
  await d.evaluate(()=>window.netQA.dropAction='match');
  for(const page of pages)await page.getByRole('button',{name:'여럿이서 시작',exact:true}).click();
  await d.getByRole('button',{name:'방 상태 다시 확인',exact:true}).click();
  let room=(await run('getYutLobby','a')).room;
  await until(async()=>{room=await getRoom(room.id);return room.players.length===4;},'four participants did not join one room');
  await Promise.all(pages.map(page=>page.getByRole('heading',{name:'한 판의 인연'}).waitFor()));
  const dMatches=calls.filter(call=>call.label==='d'&&call.data.action==='match');
  assert.equal(dMatches.length,2);assert.equal(dMatches[0].data.requestKey,dMatches[1].data.requestKey);
  assert.equal(room.players.filter(player=>player.uid===uid('d')).length,1);
  checks.push('Four independent Chromium clients join one real Firestore room; lost join acknowledgement retries the identical key once without duplicate membership.');
  await awaitObservedRoom(pages,room);
  const hostStart = a.getByRole('button',{name:'게임 시작',exact:true});
  const startBox = await hostStart.boundingBox(), seatsBox = await a.locator('.yut-waiting-seats').boundingBox();
  assert.ok(startBox && seatsBox && startBox.y + startBox.height <= seatsBox.y, 'host start action is visible above the roster');
  assert.equal(await a.locator('.yut-seat-class').first().innerText(), '3학년 1반');
  await a.screenshot({path:path.join(evidence,'host-waiting-start.png')});
  // Requests really remain unresolved for 15s; only the UI timeout can recover.
  await b.evaluate(()=>window.netQA.hangAction='ready');
  await c.evaluate(()=>window.netQA.hangAction='emote');
  await b.getByRole('button',{name:'준비 완료',exact:true}).click();
  await c.getByRole('button',{name:'감정표현',exact:true}).click();
  await c.locator('.yut-emote-options button').first().click();
  await b.getByRole('button',{name:'방 상태 다시 확인',exact:true}).waitFor({timeout:20000});
  await c.locator('.yut-emote-menu [role="alert"]').waitFor({timeout:5000});
  await b.getByRole('button',{name:'방 상태 다시 확인',exact:true}).click();
  await b.getByRole('button',{name:'준비 취소',exact:true}).waitFor();
  await until(()=>calls.filter(call=>call.label==='b'&&call.data.action==='ready'&&call.result).length===2,'ready receipt recovery did not finish');
  const recoveredReady=calls.filter(call=>call.label==='b'&&call.data.action==='ready');
  assert.equal(recoveredReady.length,2);assert.equal(recoveredReady[0].data.requestKey,recoveredReady[1].data.requestKey);
  assert.equal(recoveredReady[0].result.revision,recoveredReady[1].result.revision,'recovered readiness is not applied twice');
  await c.locator('.yut-emote-options button').first().click();
  await c.locator('.yut-emote-menu').waitFor({state:'hidden'});
  checks.push('Actual 15-second command and emote timeouts release both input locks; explicit command recovery reuses the original receipt and emotes remain usable.');
  for(const page of [c,d]){room=await getRoom(room.id);await awaitObservedRoom(pages,room);await page.getByRole('button',{name:'준비 완료',exact:true}).click();await page.getByRole('button',{name:'준비 취소',exact:true}).waitFor();}
  room=await getRoom(room.id);await awaitObservedRoom(pages,room);
  await a.getByRole('button',{name:'게임 시작',exact:true}).evaluate(button=>{button.click();button.click();});
  await Promise.all(pages.map(page=>page.locator('.yut-board').waitFor()));
  assert.equal(calls.filter(call=>call.data.action==='start').length,1,'synchronous double activation sends one command');
  await until(async()=>{const states=await Promise.all(pages.map(browserRoom));return states.every(state=>state?.status==='playing'&&state.players.length===4);},'all four browser views did not converge');
  room=await getRoom(room.id);
  // Real SDK offline/online: cached snapshots cannot unlock stale actions.
  await c.evaluate(async()=>{window.netQA.setHidden(true);await window.netQA.offline();});
  const emote=await run('commandYutRoom','b',{action:'emote',kind:'hello',roomId:room.id,requestKey:randomUUID()});
  await until(async()=> (await browserRoom(a))?.syncRevision===emote.room.syncRevision,'connected observer missed live update');
  await c.evaluate(async()=>{await window.netQA.online();window.netQA.setHidden(false);});
  await until(async()=> (await browserRoom(c))?.syncRevision===emote.room.syncRevision,'offline hidden observer did not catch up');
  const latest=await browserRoom(c);
  await c.evaluate(()=>window.netQA.injectSnapshot(0));
  await c.waitForTimeout(100);
  assert.equal((await browserRoom(c)).syncRevision,latest.syncRevision,'cached/older snapshots cannot roll a room backwards');
  const count=calls.length;await c.waitForTimeout(1800);assert.equal(calls.length,count,'room state uses listeners without client request polling');
  checks.push('Real SDK disableNetwork/enableNetwork and hidden return catch up to server state; cached/reversed snapshots cannot roll back the view; room synchronization adds no polling calls.');
  // Everyone observes an expired throw; staggered client recovery advances once.
  room=await getRoom(room.id);await db.doc(`${base}/yut_rooms/${room.id}`).update({phaseStartsAtMs:Date.now()-1000,turnDeadlineMs:Date.now()+100});
  await until(async()=>{const value=await getRoom(room.id);return value.revision===room.revision+1&&value.lastEvent.kind==='skip';},'expired turn did not advance');
  const afterSkip=await getRoom(room.id);await a.waitForTimeout(900);assert.equal((await getRoom(room.id)).revision,afterSkip.revision);
  assert.equal(calls.filter(call=>call.data.action==='skip').length,1);
  // Two different requests race the same turn: only one authoritative throw wins.
  await db.doc(`${base}/yut_rooms/${room.id}`).update({phaseStartsAtMs:0,turnDeadlineMs:Date.now()+60000});
  const throwData={action:'throw',roomId:room.id,expectedRevision:afterSkip.revision,power:0.56};
  const race=await Promise.allSettled([run('commandYutRoom','b',{...throwData,requestKey:randomUUID()}),run('commandYutRoom','b',{...throwData,requestKey:randomUUID()})]);
  assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
  const thrown=await getRoom(room.id);assert.equal(thrown.revision,afterSkip.revision+1);
  await until(async()=> (await Promise.all(pages.map(browserRoom))).every(state=>state?.revision===thrown.revision),'throw race did not converge across clients');
  await c.evaluate(()=>window.netQA.injectSnapshot(1));await c.waitForTimeout(100);assert.equal((await browserRoom(c)).revision,thrown.revision);
  checks.push('Four-client expired-turn recovery advances exactly once; racing server-authoritative throws commit once and all clients converge, including reversed server snapshots.');
  await a.screenshot({path:path.join(evidence,'four-client-online.png')});
  await closeRoom(await getRoom(room.id));await Promise.all(pages.map(page=>page.getByRole('button',{name:'여럿이서 시작',exact:true}).waitFor()));
  // Delay a committed ready response until after a teacher closes the room.
  await a.getByRole('button',{name:'여럿이서 시작',exact:true}).click();await a.getByRole('heading',{name:'한 판의 인연'}).waitFor();
  await b.getByRole('button',{name:'여럿이서 시작',exact:true}).click();await b.getByRole('heading',{name:'한 판의 인연'}).waitFor();
  await b.evaluate(()=>{window.netQA.delayAction='ready';window.netQA.delayMs=2500;});
  await b.getByRole('button',{name:'준비 완료',exact:true}).click();
  room=(await run('getYutLobby','a')).room;
  await until(async()=> (await getRoom(room.id)).players.find(player=>player.uid===uid('b')).ready,'ready mutation did not commit');
  await closeRoom(await getRoom(room.id));await b.getByRole('button',{name:'여럿이서 시작',exact:true}).waitFor();
  await b.waitForTimeout(2800);assert.equal(await b.getByRole('heading',{name:'한 판의 인연'}).count(),0,'late command cannot resurrect a closed room');
  checks.push('A 2.5-second late committed command response cannot resurrect a teacher-closed room.');
  // A pending create cannot update an unmounted view.
  await d.evaluate(()=>{window.netQA.delayAction='match';window.netQA.delayMs=1500;});
  await d.getByRole('button',{name:'여럿이서 시작',exact:true}).click();await d.evaluate(()=>window.netUnmount());await d.waitForTimeout(1800);
  assert.equal(await d.locator('[data-unmounted]').count(),1);assert.equal(await d.locator('.yut-game').count(),0);
  checks.push('Unmount invalidates delayed room admission responses.');
  await c.evaluate(()=>window.netQA.dropAction='match');
  await c.getByRole('button',{name:'여럿이서 시작',exact:true}).click();
  await c.getByRole('button',{name:'방 상태 다시 확인',exact:true}).waitFor();
  const beforeRecoveryReads=calls.filter(call=>call.label==='c'&&call.name==='getYutLobby').length;
  await c.evaluate(()=>{window.netQA.delayAction='match';window.netQA.delayMs=1500;});
  await c.getByRole('button',{name:'방 상태 다시 확인',exact:true}).click();
  await until(()=>calls.filter(call=>call.label==='c'&&call.data.action==='match').length===3,'explicit recovery did not start');
  await c.evaluate(()=>window.netUnmount());await c.waitForTimeout(1800);
  assert.equal(calls.filter(call=>call.label==='c'&&call.name==='getYutLobby').length,beforeRecoveryReads,'unmounted recovery does not issue a follow-up lobby read');
  checks.push('Leaving during an explicit recovery suppresses the obsolete follow-up lobby read.');
  assert.deepEqual(errors,[]);
})().catch(async error=>{errors.push(error.stack||String(error));process.exitCode=1;for(const[index,page]of pages.entries()){await page.screenshot({path:path.join(evidence,`failure-${index}.png`)}).catch(()=>{});await fs.writeFile(path.join(evidence,`failure-${index}.txt`),await page.locator('body').innerText().catch(()=>''));}}).finally(async()=>{
  await fs.mkdir(evidence,{recursive:true});await fs.writeFile(path.join(evidence,'network-report.json'),JSON.stringify({project,recordedAt:new Date().toISOString(),checks,errors,calls,callCounts:calls.reduce((counts,call)=>{const key=call.data.action||call.name;counts[key]=(counts[key]||0)+1;return counts;},{}),limitations:['Synthetic auth/session fixtures and loopback callable.run adapter; real Firestore web SDK, rules, transactions and UI state handlers.','No production traffic, account, settings or data writes; this is not a WAN capacity/load benchmark.']},null,2));
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
  await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});await db.terminate();
  for(const check of checks)console.log('PASS '+check);if(errors.length)console.error(errors.join('\n'));
});
