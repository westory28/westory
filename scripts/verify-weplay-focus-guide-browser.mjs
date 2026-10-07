/** Real focused battle and account guide UI; only Auth/Firebase boundaries are fixtures. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import http from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const core = require(path.join(root, 'functions/weplayCore.js'));
const evidence = process.env.WEPLAY_QA_EVIDENCE_DIR
  ? path.resolve(process.env.WEPLAY_QA_EVIDENCE_DIR)
  : path.join(root, '.superloopy/sessions/weplay-focus-tour-20260930/evidence');
await fs.mkdir(evidence, { recursive: true });
const modulePath = relative => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
const lessons = [{ unitId: 'naval-qa', title: '임진왜란과 수군', isVisibleToStudents: true, words: ['이순신', '거북선', '한산도', '판옥선', '명량해전', '학익진'], wordCount: 6 }];
const catalog = lessons.flatMap(lesson => lesson.words.map(text => ({ text, unitId: lesson.unitId, lessonTitle: lesson.title, context: '수업 자료에 등록한 빈칸 정답입니다.' })));
const service = `
import {useSyncExternalStore} from 'react';
const params=new URLSearchParams(location.search);
export const view=params.get('view')||'battle';
export const config={year:'2026',semester:'2'};
const readonly=view==='readonly';
const initialUid='guide-account-a';
const profile=(uid,completed)=>({uid,role:view==='lobby'||readonly?'student':'teacher',teacherPortalEnabled:true,staffPermissions:readonly?['lesson_read']:[],email:'qa@example.invalid',name:'검증 사용자',weplayGuideCompleted:completed});
const authListeners=new Set();
let authState={config,currentUser:{uid:initialUid,email:'qa@example.invalid'},userData:params.get('profile')==='loading'?null:profile(initialUid,params.get('seen')==='1'),loading:false,configReady:true};
export const auth={get currentUser(){return authState.currentUser}};
export const useAuth=()=>useSyncExternalStore(listener=>{authListeners.add(listener);return()=>authListeners.delete(listener)},()=>authState);
export const qa=window.navalQa={calls:[],writes:[],answers:[],completions:[],finishAttempts:[],settings:${JSON.stringify(core.DEFAULT_GAME_SETTINGS)},lessons:${JSON.stringify(lessons)},policy:{...${JSON.stringify(core.DEFAULT_POLICY)},challengeCost:7},balance:params.get('poor')==='1'?0:34,failFinish:0,fail:{},hold:{}};
qa.heldCalls=[];qa.guideWrites=[];qa.profiles={};
qa.setAccount=(uid,completed=false,loaded=true)=>{authState={...authState,currentUser:uid?{uid,email:'qa@example.invalid'}:null,userData:uid&&loaded?profile(uid,completed):null};for(const listener of authListeners)listener();};
qa.getAccount=()=>authState;
const management=()=>({settings:structuredClone(qa.settings),lessons:structuredClone(qa.lessons),availableWordCount:6,previewWordCount:6});
export const getHttpsCallable=async name=>async data=>{
  qa.calls.push({name,data:structuredClone(data)});
  if(qa.fail[name]){qa.fail[name]--;throw new Error('QA 연결 오류');}
  if(name==='completeWeplayGuide'){
    if(qa.hold[name])await new Promise(resolve=>qa.heldCalls.push({name,uid:data.accountUid,release:resolve}));
    qa.guideWrites.push(data.accountUid);qa.profiles[data.accountUid]=true;
    if(authState.currentUser?.uid===data.accountUid)qa.setAccount(data.accountUid,true);
    return {data:{uid:data.accountUid,guideCompleted:true}};
  }
  if(qa.hold[name])await new Promise(resolve=>{qa.releaseCall=resolve});
  if(name==='getWeplayLobby')return {data:{gameEnabled:params.get('disabled')!=='1',policy:structuredClone(qa.policy),balance:qa.balance,dailyUsed:1,dailyRemaining:2,lessons:qa.lessons,wordCount:6,difficulties:qa.settings.difficulties,challengeDifficulties:qa.settings.difficulties,wordCountsByDifficulty:{mild:6,medium:6,spicy:6},challengeWordCountsByDifficulty:{mild:6,medium:6,spicy:6},activeSession:params.has('resume')&&!qa.completions.length?qa.session:null,records:qa.completions,period:null,rankingByDifficulty:{mild:[],medium:[],spicy:[]},serverNowMs:Date.now()}};
  if(name==='startWeplayGame'){const response=await fetch('/session',{method:'POST',body:JSON.stringify({...data,now:Date.now(),legacy:params.get('legacy')==='1'})});qa.session=await response.json();qa.session.policy=structuredClone(qa.policy);qa.transport=qa.makeTransport(qa.session);return {data:qa.session};}
  if(name==='submitWeplayAnswer')return {data:await qa.transport.answer(data)};
  if(name==='finishWeplayGame')return {data:await qa.transport.finish({exitEarly:data.exitEarly===true})};
  if(name==='getWeplayManagement')return {data:management()};
  if(name==='saveWeplayGameSettings'){qa.settings={...data.settings,version:qa.settings.version+1};qa.writes.push({name,data:structuredClone(data)});return {data:management()};}
  if(name==='previewWeplayGame'){const response=await fetch('/session',{method:'POST',body:JSON.stringify({...data,now:Date.now()})});qa.session=await response.json();return {data:qa.session};}
  throw new Error('Unexpected student/Firebase callable in teacher preview: '+name);
};
export const db={};
export const getFirebaseStorage=async()=>({});
`;
const harness = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import ${modulePath('src/assets/index.css')};
import ${modulePath('src/components/common/weplay/weplay.css')};
import Game from ${modulePath('src/components/common/weplay/HistoryRainGame.tsx')};
import StudentWeplay from ${modulePath('src/pages/student/Weplay.tsx')};
import NavalResult from ${modulePath('src/components/common/weplay/NavalBattleResult.tsx')};
import ManageWeplay from ${modulePath('src/pages/teacher/ManageWeplay.tsx')};
import {createWeplayPreviewTransport} from ${modulePath('src/lib/weplayPreview.ts')};
import * as weplay from ${modulePath('src/lib/weplay.ts')};
import {simulateWeplayBattle} from ${modulePath('src/lib/weplayBattle.ts')};
import {completeWeplayGuide,getWeplayGuideStatus} from ${modulePath('src/lib/weplayGuide.ts')};
import {AppToastProvider} from ${modulePath('src/components/common/AppToastProvider.tsx')};
import {AppDialogProvider} from ${modulePath('src/components/common/AppDialogProvider.tsx')};
import ${modulePath('src/components/layout/teacherLayout.css')};
import {qa,view,config} from 'fixture:service';
qa.exports=weplay;
qa.simulate=simulateWeplayBattle;
qa.completeGuide=completeWeplayGuide;qa.guideStatus=getWeplayGuideStatus;
qa.makeTransport=session=>{
  const real=createWeplayPreviewTransport({...session,serverNowMs:session.serverNowMs+(qa.ackOffset||0)});qa.realTransport=real;
  return {...real,answer:async data=>{const result=await real.answer(data);qa.answers.push({data:structuredClone(data),result:structuredClone(result)});if(qa.holdAnswer===qa.answers.length)await new Promise(resolve=>{qa.releaseAnswer=resolve});return result;},finish:async options=>{qa.finishAttempts.push({options:structuredClone(options),at:Date.now(),answerCount:qa.answers.length});if(qa.holdFinish)await new Promise(resolve=>{qa.releaseFinish=resolve});if(qa.failFinish){qa.failFinish--;throw new Error('QA 정산 연결 오류');}let result=await real.finish(options);if(view==='lobby'){const cost=session.mode==='challenge'?session.policy.challengeCost:0;result={...result,mode:session.mode,cost,reward:0,netWis:-cost,balance:qa.balance-cost};}qa.completions.push(result);return result;}};
};
async function setup(){
  if(view==='lobby'&&new URLSearchParams(location.search).has('resume')){const response=await fetch('/session',{method:'POST',body:JSON.stringify({now:Date.now(),mode:'challenge'})});qa.session=await response.json();qa.session.policy=structuredClone(qa.policy);qa.transport=qa.makeTransport(qa.session);render(null);return;}
  if(view==='management'||view==='readonly'||view==='lobby'){render(null);return;}
  const params=new URLSearchParams(location.search);
  const response=await fetch('/session',{method:'POST',body:JSON.stringify({now:Date.now(),difficulty:params.get('difficulty')||'mild',legacy:params.get('legacy')==='1',fast:params.get('fast')==='1',long:params.get('long')==='1'})});
  qa.session=await response.json();
  qa.transport=qa.makeTransport(qa.session);
  render(qa.session);
}
function Fixture({session}){
const params=new URLSearchParams(location.search);
const[result,setResult]=useState(view==='result'?{sessionId:'result-fixture',difficulty:session.difficulty,mode:params.get('mode')==='challenge'?'challenge':'practice',correctCount:37,totalWords:60,score:12500,reward:5,cost:2,netWis:3,balance:103,finishedAtMs:Date.now(),missedWords:session.words.filter(word=>word.kind==='normal').slice(0,3),battleVersion:1,battle:{...simulateWeplayBattle(session,0),outcome:params.get('outcome')==='defeat'?'defeat':'victory',sunkShips:3,cannonShots:18,specialCount:2}}:null);
const[replaying,setReplaying]=useState(false);
return <MemoryRouter><AppToastProvider><AppDialogProvider>{view==='lobby'?<StudentWeplay/>:!session?<div className='teacher-layout'><ManageWeplay/></div>:<main className='weplay-page'>{!result&&<Game session={session} config={config} preview transport={qa.transport} onShowGuide={()=>{qa.helpRequests=(qa.helpRequests||0)+1}} onComplete={value=>{qa.completed=value;setResult(value);}}/>}{result?.battle&&<NavalResult result={result} preview replaying={replaying} onReplay={()=>{qa.replays=(qa.replays||0)+1;setReplaying(true);}}/>}{result&&<output hidden aria-label='QA 완료 결과'>{JSON.stringify(result)}</output>}</main>}</AppDialogProvider></AppToastProvider></MemoryRouter>}
function render(session){createRoot(document.getElementById('root')).render(<Fixture session={session}/>);}
setup().catch(error=>{qa.error=error.message;throw error;});
`;
const bundled = await build({
  stdin: { contents: harness, loader: 'tsx', resolveDir: root }, bundle: true, write: false,
  format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(os.tmpdir(), 'westory-naval-qa.js'), external: ['/assets/*'],
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 'naval-service-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^fixture:|(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/firebase$|^\.\/firebase$/ }, () => ({ path: 'service', namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: service, loader: 'ts', resolveDir: root }));
  } }],
});
const js = bundled.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundled.outputFiles.find(file => file.path.endsWith('.css'))?.text.replace(/@import\s+[^;]+;/g, '') || '';
const tailwind = await fs.readFile(path.join(os.tmpdir(), 'westory-qa-tailwind.js'), 'utf8');
const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/qa.css"></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>';

function createSession(data) {
  const difficulty = data.difficulty || 'mild';
  const settings = data.settings ? core.validateGameSettings(data.settings) : core.DEFAULT_GAME_SETTINGS;
  const difficultySettings = data.fast ? {...settings.difficulties[difficulty],fallSeconds:[3,2,1]} : settings.difficulties[difficulty];
  const startsAtMs = data.fast ? data.now - 30000 : data.now + 3000;
  const session = { id: 'naval-preview-qa-'+data.now, mode: data.mode||'practice', difficulty, difficultySettings, battleVersion: 1, acceptedEvents: [], status: 'active', startsAtMs, endsAtMs: startsAtMs + difficultySettings.durationSeconds * 1000, serverNowMs: data.now, words: core.buildWords(catalog, 'naval-qa', difficulty, difficultySettings), acceptedWordIds: [],correctCount:0,policy:core.DEFAULT_POLICY,result:null };
  if (data.legacy) {
    delete session.battleVersion; delete session.acceptedEvents;
    session.difficultySettings = { ...difficultySettings, durationSeconds: 60 };
    session.endsAtMs = startsAtMs + 60000;
    session.words = Array.from({ length: 20 }, (_, index) => ({ ...catalog[index % catalog.length], id: 'word-' + (index + 1), stage: index < 7 ? 1 : index < 14 ? 2 : 3, spawnAtMs: Math.floor(index * 2000), fallDurationMs: 10000 }));
  }
  if (data.long) session.words = session.words.map(word => word.kind === 'normal' ? { ...word, text: '대한민국임시정부수립과정' } : word);
  if (data.fast) { session.acceptedEvents = session.words.filter(word => word.kind === 'normal' && word.stage === 1).map(word => ({ wordId:word.id, elapsedMs:word.spawnAtMs+100 })); session.acceptedWordIds=session.acceptedEvents.map(event=>event.wordId);session.correctCount=session.acceptedEvents.length; }
  return session;
}
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/session') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const session = createSession(JSON.parse(Buffer.concat(chunks).toString()));
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(session)); return;
    }
    const files = { '/qa.js': ['text/javascript', js], '/qa.css': ['text/css', css], '/tailwind.js': ['text/javascript', tailwind] };
    if (files[pathname]) { response.setHeader('Content-Type', files[pathname][0]); response.end(files[pathname][1]); return; }
    if (/\.(png|webp|jpg|svg)$/.test(pathname)) {
      const target = path.resolve(root, 'public', '.' + pathname);
      if (!target.startsWith(path.join(root, 'public') + path.sep)) throw new Error('Invalid asset path');
      response.setHeader('Content-Type', pathname.endsWith('.svg') ? 'image/svg+xml' : pathname.endsWith('.webp') ? 'image/webp' : 'image/png');
      response.end(await fs.readFile(target)); return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
  } catch (error) { response.statusCode = 500; response.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', headless: true });
const checks = [], errors = [], requests = [], screenshots = [], layoutMeasurements = [];
async function open(view = 'battle', width = 1280, query = '', options = {}) {
  const page = await browser.newPage({ viewport: { width, height: 950 }, ...options });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (route.request().url().startsWith(origin)) return route.continue(); requests.push(route.request().url()); return route.abort(); });
  await page.clock.install({ time: new Date('2026-09-29T03:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-29T03:00:10Z'));
  await page.goto(`${origin}/?view=${view}&${query}`);
  await page.waitForFunction(() => Boolean(window.navalQa));
  return page;
}
async function capture(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: horizontal overflow`);
  await page.screenshot({ path: path.join(evidence, name + '.png'), fullPage: !name.includes('keyboard-viewport') }); screenshots.push(name + '.png');
}
async function answerVisible(page, special = false) {
  const prompt = page.locator(special ? '.naval-special > strong' : '.naval-word > strong').first();
  await prompt.waitFor();
  const text = await prompt.textContent();
  const before = await page.evaluate(() => window.navalQa.answers.length);
  await page.getByRole('textbox', { name: '단어 입력' }).fill(text);
  await page.getByRole('textbox', { name: '단어 입력' }).press('Enter');
  await page.waitForFunction(count => window.navalQa.answers.length > count, before);
  return page.evaluate(() => window.navalQa.answers.at(-1).result);
}
async function advanceTo(page, elapsed) {
  const current = await page.evaluate(() => Date.now() - window.navalQa.session.startsAtMs);
  if (elapsed > current) await page.clock.runFor(elapsed - current);
}
let failure = null;
try {
  if (process.env.WEPLAY_QA_GUIDE_ONLY !== '1') {
    for (const mode of ['practice', 'challenge']) {
      const cannon = await open('lobby', mode === 'practice' ? 390 : 1280, 'seen=1');
      if (mode === 'challenge') await cannon.locator('.weplay-mode-choice button').last().click();
      await cannon.evaluate(() => { window.navalQa.ackOffset = 2000; });
      await cannon.locator('.weplay-start').click();
      await cannon.locator('.naval-game').waitFor();
      await advanceTo(cannon, 2200);
      assert.equal((await answerVisible(cannon)).accepted, true);
      await cannon.waitForFunction(() => document.querySelector('.naval-ammo').getAttribute('aria-label') === '포탄 장전 1 / 2', null, { timeout: 2000 });
      assert.equal(await cannon.locator('.naval-effect--cannon').count(), 0);
      await cannon.evaluate(() => { window.navalQa.holdAnswer = 2; });
      assert.equal((await answerVisible(cannon)).accepted, true);
      assert.equal(await cannon.locator('.naval-effect--cannon').count(), 0, 'Pending answer cannot fire an unconfirmed shot');
      await cannon.evaluate(() => window.navalQa.releaseAnswer());
      await cannon.locator('.naval-effect--cannon').waitFor({ timeout: 2000 });
      assert.equal(await cannon.locator('.naval-effect--cannon').count(), 1, 'Second accepted normal word fires exactly once without another clock tick');
      assert.equal(await cannon.locator('.naval-ammo').getAttribute('aria-label'), '포탄 장전 0 / 2');
      await cannon.locator('.naval-effect--cannon').evaluate(element => { for (const animation of element.getAnimations({subtree:true})) { animation.pause(); animation.currentTime = 160; } });
      await capture(cannon, `normal-cannon-${mode}-second-word`);
      await cannon.clock.runFor(500);
      assert.equal(await cannon.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 88');
      await cannon.clock.runFor(1200);
      assert.equal((await answerVisible(cannon)).accepted, true);
      assert.equal(await cannon.locator('.naval-effect--cannon').count(), 0);
      assert.equal((await answerVisible(cannon)).accepted, true);
      await cannon.locator('.naval-effect--cannon').waitFor({ timeout: 2000 });
      assert.equal(await cannon.locator('.naval-effect--cannon').count(), 1, 'Fourth accepted normal word fires the next cannon');
      await cannon.clock.runFor(500);
      assert.equal(await cannon.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 76');
      assert.equal(await cannon.locator('.naval-special-attack').count(), 0);
      await cannon.close();
    }
    checks.push('Practice/challenge: server clock 2000ms ahead, first normal loads, pending second never fires, acknowledged second/fourth immediately fire one cannon each and damage at420ms');
    const reordered = await open('lobby', 768, 'seen=1');
    await reordered.evaluate(() => { window.navalQa.ackOffset = 2000; window.navalQa.holdAnswer = 1; });
    await reordered.locator('.weplay-start').click();
    await reordered.locator('.naval-game').waitFor(); await advanceTo(reordered, 2200);
    await answerVisible(reordered);
    assert.equal(await reordered.locator('.naval-effect--cannon').count(), 0);
    await answerVisible(reordered);
    await reordered.locator('.naval-effect--cannon').waitFor({ timeout: 2000 });
    const reorderedBefore = await reordered.locator('.naval-hud-time').textContent();
    await reordered.evaluate(() => window.navalQa.releaseAnswer());
    await reordered.waitForTimeout(50);
    assert.equal(await reordered.locator('.naval-hud-time').textContent(), reorderedBefore, 'Older acknowledgement cannot turn the synchronized clock backward');
    assert.equal(await reordered.locator('.naval-ammo').getAttribute('aria-label'), '포탄 장전 0 / 2');
    assert.equal(await reordered.locator('.naval-effect--cannon').count(), 1, 'Out-of-order acknowledgements never double-fire the same pair');
    await reordered.close();
    checks.push('Out-of-order normal acknowledgements preserve the current clock, accepted pair, and exactly one cannon effect');
  }
  if (process.env.WEPLAY_QA_CANNON_ONLY !== '1') {
  if (process.env.WEPLAY_QA_GUIDE_ONLY !== '1') {
  for (const width of [320, 390, 768, 1280]) {
    const battle = await open('battle', width, 'seen=1');
    await battle.locator('.naval-game').waitFor(); await advanceTo(battle, 2200);
    await battle.waitForTimeout(850);
    const metrics = await battle.evaluate(() => {
      const scene = document.querySelector('.naval-scene').getBoundingClientRect();
      const footer = document.querySelector('.naval-footer').getBoundingClientRect();
      const input = document.querySelector('.naval-input-frame').getBoundingClientRect();
      const ocean = getComputedStyle(document.querySelector('.naval-ocean'));
      return { width: innerWidth, ocean: { animation:ocean.animationName,duration:ocean.animationDuration,state:ocean.animationPlayState,filter:ocean.filter }, inputBelowWords:[...document.querySelectorAll('.naval-word strong')].every(word=>word.getBoundingClientRect().bottom<input.top),words:[...document.querySelectorAll('.naval-word strong')].map(word=>({font:parseFloat(getComputedStyle(word).fontSize),fits:word.scrollWidth<=word.clientWidth})),controls:[...document.querySelectorAll('.naval-command input,.naval-command button,.naval-footer button,.naval-footer label')].map(control=>{const r=control.getBoundingClientRect();return{width:r.width,height:r.height}}),footerFits:footer.top>=input.bottom&&footer.bottom<=scene.bottom };
    });
    assert.equal(metrics.ocean.animation, 'naval-sea-drift');assert.equal(metrics.ocean.duration, '16s');assert.equal(metrics.ocean.state, 'running');
    assert.ok(metrics.inputBelowWords&&metrics.footerFits&&metrics.words.every(word=>word.font>=16&&word.fits),JSON.stringify(metrics));
    assert.ok(metrics.controls.every(control=>control.width>=44&&control.height>=44),JSON.stringify(metrics.controls));
    assert.equal(await battle.locator('.naval-special-attack').count(),0);
    assert.equal(await battle.evaluate(()=>window.navalQa.calls.length),0);
    layoutMeasurements.push(metrics);await capture(battle,`focus-normal-${width}`);await battle.close();
  }
  checks.push('320/390/768/1280 ordinary battle: subdued raster sea, 16-second CSS drift, legible 16px water words, 44px controls, input/footer separation, no cut-in or background RPC');

  for (const {width,view} of [{width:390,view:'battle'},{width:1280,view:'battle'},{width:390,view:'lobby'}]) {
    const special = await open(view,width,'seen=1');
    if(view==='lobby') {await special.getByRole('button',{name:'도전하기 위스 획득·차감',exact:true}).click();await special.locator('.weplay-start').click();}
    await special.locator('.naval-game').waitFor();await advanceTo(special,30100);
    assert.equal(await special.locator('.naval-special').count(),1);assert.equal(await special.locator('.naval-special-attack').count(),0);
    await capture(special,`focus-${view}-special-prompt-${width}`);
    await special.getByRole('textbox',{name:'단어 입력'}).fill('오답검증');await special.getByRole('textbox',{name:'단어 입력'}).press('Enter');
    assert.equal(await special.locator('.naval-special-attack').count(),0);assert.equal(await special.evaluate(()=>window.navalQa.answers.length),0);
    await special.evaluate(()=>{window.navalQa.holdAnswer=1});assert.equal((await answerVisible(special,true)).accepted,true);
    assert.equal(await special.locator('.naval-special-attack').count(),0,'No effect until transport acknowledges the accepted special');
    const hpBefore=await special.locator('.naval-health--enemy').getAttribute('aria-label');
    await special.evaluate(()=>window.navalQa.releaseAnswer());await special.clock.runFor(50);await special.locator('.naval-special-attack:not(.is-paused)').waitFor();
    await special.waitForFunction(()=>[...document.querySelectorAll('.naval-special-attack img')].every(img=>img.complete&&img.naturalWidth>0));
    assert.equal(await special.locator('.naval-special-intro').evaluate(element=>getComputedStyle(element).animationDuration),'0.5s');
    assert.equal(await special.locator('.naval-special-trace.trace-core').count(),10);
    assert.equal(await special.locator('.naval-special-burst').count(),5);
    const layers=await special.evaluate(()=>{const attack=getComputedStyle(document.querySelector('.naval-special-attack'));return{effects:Number(getComputedStyle(document.querySelector('.naval-effects')).zIndex),words:Number(getComputedStyle(document.querySelector('.naval-prompts')).zIndex),input:Number(getComputedStyle(document.querySelector('.naval-command')).zIndex),pointer:attack.pointerEvents}});
    assert.ok(layers.words>layers.effects&&layers.input>layers.effects&&layers.pointer==='none',JSON.stringify(layers));
    await special.clock.runFor(1250);
    assert.equal(await special.locator('.naval-health--enemy').getAttribute('aria-label'),hpBefore,'Special HP stays unchanged before the 1400ms impact');
    await special.clock.runFor(150);
    assert.notEqual(await special.locator('.naval-health--enemy').getAttribute('aria-label'),hpBefore,'Special HP updates at the 1400ms impact');
    await special.locator('.naval-special-attack').evaluate(element=>{for(const animation of element.getAnimations({subtree:true})){animation.pause();animation.currentTime=1400;}});
    await capture(special,`focus-${view}-successful-special-barrage-${width}`);
    await special.clock.runFor(1100);assert.equal(await special.locator('.naval-special-attack').count(),0);assert.equal(await special.getByRole('textbox',{name:'단어 입력'}).isEnabled(),true);
    const actualCalls=await special.evaluate(()=>window.navalQa.calls.map(call=>call.name));
    assert.deepEqual(actualCalls,view==='lobby'?['getWeplayLobby','startWeplayGame','submitWeplayAnswer']:[]);
    await capture(special,`focus-${view}-after-barrage-${width}`);await special.close();
  }
  checks.push('Special prompt/wrong answer/pending response show no effect; accepted special has 500ms eyes, 10 ballistic trails and 5 bursts, HP unchanged before1400ms and updated at impact, removal at2500ms, word/input layers preserved, no extra calls');

  const paused=await open('battle',390,'seen=1');await paused.locator('.naval-game').waitFor();await advanceTo(paused,2200);
  await paused.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
  assert.equal(await paused.locator('.naval-ocean').evaluate(element=>getComputedStyle(element).animationPlayState),'paused');
  await capture(paused,'focus-hidden-sea-paused-390');
  await paused.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});
  assert.equal(await paused.locator('.naval-ocean').evaluate(element=>getComputedStyle(element).animationPlayState),'running');
  await paused.getByRole('checkbox',{name:/(움직임|효과) 줄이기/}).check();
  assert.equal(await paused.locator('.naval-ocean').evaluate(element=>getComputedStyle(element).animationPlayState),'paused');
  await advanceTo(paused,30100);await answerVisible(paused,true);await paused.clock.runFor(100);
  assert.equal(await paused.locator('.naval-special-attack.is-still').count(),1);
  assert.notEqual(await paused.locator('.naval-special-static').evaluate(element=>getComputedStyle(element).display),'none');
  assert.equal(await paused.locator('.naval-special-barrage').evaluate(element=>getComputedStyle(element).display),'none');
  await capture(paused,'focus-reduced-motion-special-390');await paused.close();
  checks.push('Document hidden state pauses CSS sea motion and visibility restores it; explicit reduced motion pauses sea and suppresses accepted-special cut-in');

  const keyboard=await open('battle',390,'seen=1');await keyboard.locator('.naval-game').waitFor();await advanceTo(keyboard,2200);
  await keyboard.getByRole('textbox',{name:'단어 입력'}).focus();await keyboard.setViewportSize({width:390,height:360});await keyboard.clock.runFor(250);
  await keyboard.locator('.naval-game--compact').waitFor();
  assert.equal(await keyboard.evaluate(()=>['.naval-hud','.naval-footer','.naval-input-frame input'].every(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return r.top>=0&&r.bottom<=visualViewport.height})),true);
  await capture(keyboard,'focus-keyboard-viewport-390x360');await keyboard.close();
  checks.push('Focused battle retains HUD, input and new help/exit footer in a simulated 390×360 keyboard viewport');

  const feedback=await open('battle',320,'seen=1');await feedback.locator('.naval-game').waitFor();await advanceTo(feedback,200);await answerVisible(feedback);await feedback.clock.runFor(100);
  assert.equal(await feedback.evaluate(()=>document.querySelector('.naval-footer').getBoundingClientRect().top>=document.querySelector('.naval-input-frame').getBoundingClientRect().bottom),true,'320px accepted-answer feedback must not expand footer over input');
  await capture(feedback,'focus-feedback-footer-320');await feedback.close();
  checks.push('320px accepted-answer feedback keeps the footer below the input');
  }

  const unknown=await open('lobby',390,'profile=loading');await unknown.locator('.weplay-launch').waitFor();
  assert.equal(await unknown.locator('.weplay-guide[open]').count(),0,'Unknown profile must not be treated as unseen');
  await unknown.evaluate(()=>window.navalQa.setAccount('guide-account-a',false));
  await unknown.locator('.weplay-guide[open]').waitFor();await capture(unknown,'guide-profile-loaded-first-entry-390');await unknown.close();
  checks.push('First-entry guide waits for matching loaded profile rather than treating unknown profile as incomplete');

  for(const width of [320,390,768,1280]){
    const guidePage=await open('lobby',width,'',{hasTouch:width<=390});const guide=guidePage.locator('.weplay-guide[open]');await guide.waitFor();
    assert.equal(await guide.locator('.naval-game--guide').count(),1);
    const input=guide.getByRole('textbox',{name:'단어 입력',exact:true});
    assert.equal(await input.isEnabled(),true);
    const baseline=await guidePage.evaluate(()=>({calls:window.navalQa.calls.length,words:[...document.querySelectorAll('.weplay-guide .naval-word strong')].map(el=>el.textContent),time:document.querySelector('.weplay-guide .naval-hud-time').textContent,hp:document.querySelector('.weplay-guide .naval-health--allied').getAttribute('aria-label')}));
    await guidePage.clock.runFor(120000);
    const after=await guidePage.evaluate(()=>({calls:window.navalQa.calls.length,words:[...document.querySelectorAll('.weplay-guide .naval-word strong')].map(el=>el.textContent),time:document.querySelector('.weplay-guide .naval-hud-time').textContent,hp:document.querySelector('.weplay-guide .naval-health--allied').getAttribute('aria-label')}));
    assert.deepEqual(after,baseline,'Guide demo stays frozen and performs no session/tick/answer/finish calls');
    assert.equal(await guide.locator('.naval-ocean').evaluate(el=>{const style=getComputedStyle(el);return style.animationName==='none'||style.animationPlayState==='paused'}),true);
    const geometry=await guide.evaluate(element=>{const r=element.getBoundingClientRect();const controls=[...element.querySelectorAll('.weplay-guide-actions button,.naval-input-frame input,.naval-input-frame button')].map(button=>{const b=button.getBoundingClientRect();return{width:b.width,height:b.height}});return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,controls}});
    assert.ok(geometry.left>=0&&geometry.right<=geometry.width&&geometry.top>=0&&geometry.bottom<=geometry.height+1,JSON.stringify(geometry));
    assert.ok(geometry.controls.every(control=>control.width>=44&&control.height>=44),JSON.stringify(geometry));
    assert.equal(await guide.locator('.weplay-guide-demo').getAttribute('data-guide-step'),'input');
    assert.equal(await guide.locator('.naval-word').evaluate(element=>getComputedStyle(element).opacity),'1','The current guide word is fully visible immediately');
    layoutMeasurements.push(await guide.evaluate(element=>({guideWidth:innerWidth,targets:[...element.querySelectorAll('.naval-scene,.naval-prompts,.naval-word,.naval-command')].map(target=>({name:target.className,opacity:getComputedStyle(target).opacity,position:getComputedStyle(target).position,zIndex:getComputedStyle(target).zIndex,filter:getComputedStyle(target).filter,animation:getComputedStyle(target).animationName}))})));
    await capture(guidePage,`guide-input-${width}`);
    await input.fill('오답검증');await input.press('Enter');
    assert.match(await guide.locator('.weplay-guide-feedback').textContent(),/다시 입력/);
    assert.equal(await input.getAttribute('aria-invalid'),'true');
    assert.equal(await guide.locator('.weplay-guide-demo').getAttribute('data-guide-step'),'input');
    await input.fill('거북선');await input.dispatchEvent('compositionstart');await input.press('Enter');
    assert.equal(await guide.locator('.weplay-guide-demo').getAttribute('data-guide-step'),'input','IME confirmation Enter does not submit');
    await input.dispatchEvent('compositionend');await input.press('Enter');
    assert.equal(await guide.locator('.weplay-guide-demo').getAttribute('data-guide-step'),'charge');
    assert.equal(await input.getAttribute('aria-invalid'),'false');
    assert.match(await guide.locator('.naval-ammo').getAttribute('aria-label'),/1 \/ 2/);
    assert.equal(await guide.locator('.naval-word strong').textContent(),'이순신');
    await capture(guidePage,`guide-loaded-${width}`);
    await input.fill('이순신');
    if(width<=390)await guide.getByRole('button',{name:'장전',exact:true}).tap();else await input.press('Enter');
    await guide.locator('.naval-effect--cannon').waitFor();
    assert.equal(await guide.locator('.weplay-guide-demo').getAttribute('data-guide-step'),'effect');
    await guidePage.clock.runFor(500);await capture(guidePage,`guide-cannon-${width}`);
    await guidePage.clock.runFor(1400);
    assert.equal(await guide.locator('.weplay-guide-demo').getAttribute('data-guide-step'),'special');
    assert.equal(await guide.locator('.naval-special strong').textContent(),'천상열차분야지도');
    assert.match(await guide.locator('.naval-special').textContent(),/시간 제한이 없어요/);
    await guidePage.clock.runFor(60000);
    assert.equal(await input.isEnabled(),true,'Guide special has no time limit');
    await capture(guidePage,`guide-special-${width}`);
    await input.fill('천상열차분야지도');await input.press('Enter');
    await guide.locator('.naval-special-attack:not(.is-paused)').waitFor();
    assert.notEqual(await guide.locator('.naval-special-trace.trace-core').first().evaluate(element=>getComputedStyle(element).animationName),'none','Interactive guide preserves the shared special animation');
    await guidePage.clock.runFor(1450);
    await guide.locator('.naval-special-attack').evaluate(element=>{for(const animation of element.getAnimations({subtree:true})){animation.pause();animation.currentTime=1400;}});
    await capture(guidePage,`guide-special-effect-${width}`);
    await guidePage.clock.runFor(1350);
    assert.equal(await guide.locator('.weplay-guide-demo').getAttribute('data-guide-step'),'complete');
    assert.equal(await guide.locator('.weplay-guide-coach h2').evaluate(el=>document.activeElement===el),true);
    const local=await guidePage.evaluate(()=>({calls:window.navalQa.calls.length,answers:window.navalQa.answers.length,finishes:window.navalQa.finishAttempts.length,balance:window.navalQa.balance}));
    assert.deepEqual(local,{calls:baseline.calls,answers:0,finishes:0,balance:34});
    for(let index=0;index<6;index++){await guidePage.keyboard.press('Tab');assert.equal(await guide.evaluate(element=>element.contains(document.activeElement)),true);}
    for(let index=0;index<6;index++){await guidePage.keyboard.press('Shift+Tab');assert.equal(await guide.evaluate(element=>element.contains(document.activeElement)),true);}
    await capture(guidePage,`guide-complete-${width}`);
    await guide.getByRole('button',{name:'안내 마치기',exact:true}).click();
    await guidePage.waitForFunction(()=>!document.querySelector('.weplay-guide[open]'));
    assert.deepEqual(await guidePage.evaluate(()=>window.navalQa.guideWrites),['guide-account-a']);
    await guidePage.getByRole('button',{name:'게임 안내',exact:true}).click();await guide.waitFor();
    await guide.getByRole('button',{name:'건너뛰기',exact:true}).click();
    await guidePage.waitForFunction(()=>!document.querySelector('.weplay-guide[open]'));
    assert.equal(await guidePage.evaluate(()=>window.navalQa.guideWrites.length),1,'Manual replay after completion must not write again');
    await guidePage.close();
  }
  checks.push('320/390/768/1280 interactive guide: frozen real arena, wrong-answer retry, IME-safe Enter, touch Load, 1/2 charge and real cannon, unlimited long-word special, completion focus/Tab trap, zero gameplay RPC/Wis change, one account completion write and manual replay without another write');

  const guideKeyboard=await open('lobby',390);let keyboardGuide=guideKeyboard.locator('.weplay-guide[open]');await keyboardGuide.waitFor();
  await keyboardGuide.getByRole('textbox',{name:'단어 입력'}).focus();await guideKeyboard.setViewportSize({width:390,height:360});await guideKeyboard.clock.runFor(300);
  await guideKeyboard.locator('.weplay-guide.is-compact').waitFor();
  const keyGeometry=await keyboardGuide.evaluate(element=>{const dialog=element.getBoundingClientRect();const input=element.querySelector('.naval-input-frame').getBoundingClientRect();const word=element.querySelector('.naval-word strong').getBoundingClientRect();return{dialogBottom:dialog.bottom,inputTop:input.top,inputBottom:input.bottom,wordTop:word.top,wordBottom:word.bottom,height:visualViewport.height}});
  assert.ok(keyGeometry.inputTop>=0&&keyGeometry.inputBottom<=keyGeometry.height&&keyGeometry.wordTop>=0&&keyGeometry.wordBottom<=keyGeometry.inputTop,JSON.stringify(keyGeometry));
  await capture(guideKeyboard,'guide-keyboard-viewport-390x360');
  await keyboardGuide.getByRole('textbox',{name:'단어 입력'}).fill('거북선');await keyboardGuide.getByRole('textbox',{name:'단어 입력'}).press('Enter');
  assert.equal(await keyboardGuide.locator('.weplay-guide-demo').getAttribute('data-guide-step'),'charge');await guideKeyboard.close();
  checks.push('390×360 keyboard viewport keeps the current word and 44px input/load controls visible and interactive');

  const reducedGuidePage=await open('lobby',390,'',{reducedMotion:'reduce'});const reducedGuide=reducedGuidePage.locator('.weplay-guide[open]');await reducedGuide.waitFor();
  const reducedInput=reducedGuide.getByRole('textbox',{name:'단어 입력'});
  await reducedInput.fill('거북선');await reducedInput.press('Enter');await reducedInput.fill('이순신');await reducedInput.press('Enter');await reducedGuidePage.clock.runFor(1900);
  await reducedInput.fill('천상열차분야지도');await reducedInput.press('Enter');
  await reducedGuide.locator('.naval-special-attack.is-still').waitFor();
  assert.notEqual(await reducedGuide.locator('.naval-special-static').evaluate(element=>getComputedStyle(element).display),'none');
  assert.equal(await reducedGuide.locator('.naval-special-barrage').evaluate(element=>getComputedStyle(element).display),'none');
  await capture(reducedGuidePage,'guide-reduced-motion-special-390');await reducedGuidePage.close();
  checks.push('OS reduced motion keeps the interactive guide usable and shows a static special result instead of animation');

  const skip=await open('lobby',390);let guide=skip.locator('.weplay-guide[open]');await guide.waitFor();
  await skip.evaluate(()=>{window.navalQa.hold.completeWeplayGuide=true});
  await guide.getByRole('button',{name:'건너뛰기',exact:true}).evaluate(button=>{button.click();button.click()});
  await skip.waitForFunction(()=>window.navalQa.heldCalls.length===1);
  assert.equal(await skip.evaluate(()=>window.navalQa.calls.filter(call=>call.name==='completeWeplayGuide').length),1);
  assert.equal(await guide.getAttribute('aria-busy'),'true');
  await skip.keyboard.press('Escape');assert.equal(await guide.count(),1);
  await skip.evaluate(()=>window.navalQa.heldCalls[0].release());await skip.waitForFunction(()=>!document.querySelector('.weplay-guide[open]'));
  assert.equal(await skip.evaluate(()=>window.navalQa.guideWrites.length),1);await skip.close();
  checks.push('Skip deduplicates double activation, prevents Escape while saving, and marks the current account completed once');

  const failed=await open('lobby',390);guide=failed.locator('.weplay-guide[open]');await guide.waitFor();
  await failed.evaluate(()=>{window.navalQa.fail.completeWeplayGuide=1});await guide.getByRole('button',{name:'건너뛰기',exact:true}).click();
  const retry=guide.getByRole('button',{name:'다시 저장',exact:true});await retry.waitFor();
  assert.equal(await retry.evaluate(el=>document.activeElement===el),true);assert.equal(await failed.evaluate(()=>window.navalQa.guideWrites.length),0);
  await capture(failed,'guide-save-error-retry-390');await retry.click();await failed.waitForFunction(()=>!document.querySelector('.weplay-guide[open]'));
  assert.equal(await failed.evaluate(()=>window.navalQa.guideWrites.length),1);await failed.close();
  const close=await open('lobby',390);guide=close.locator('.weplay-guide[open]');await guide.waitFor();
  await close.evaluate(()=>{window.navalQa.fail.completeWeplayGuide=1});await guide.getByRole('button',{name:'건너뛰기',exact:true}).click();
  await guide.getByRole('button',{name:'이번에는 닫기',exact:true}).click();
  await close.clock.runFor(1000);assert.equal(await close.locator('.weplay-guide[open]').count(),0);assert.equal(await close.evaluate(()=>window.navalQa.guideWrites.length),0);
  await close.getByRole('button',{name:'게임 안내',exact:true}).click();await close.locator('.weplay-guide[open]').waitFor();
  await close.locator('.weplay-guide[open]').getByRole('button',{name:'건너뛰기',exact:true}).click();await close.waitForFunction(()=>!document.querySelector('.weplay-guide[open]'));
  assert.equal(await close.evaluate(()=>window.navalQa.guideWrites.length),1);await close.close();
  checks.push('Guide save failure focuses retry and does not count as completion; retry succeeds, while Close for now dismisses without write and permits later manual retry');

  const account=await open('lobby',390);guide=account.locator('.weplay-guide[open]');await guide.waitFor();
  await account.evaluate(()=>{window.navalQa.hold.completeWeplayGuide=true});await guide.getByRole('button',{name:'건너뛰기',exact:true}).click();
  await account.waitForFunction(()=>window.navalQa.heldCalls.length===1);
  await account.evaluate(()=>window.navalQa.setAccount('guide-account-b',false));await account.locator('.weplay-guide[open]').waitFor();
  await account.evaluate(()=>window.navalQa.heldCalls[0].release());await account.clock.runFor(100);
  assert.equal(await account.locator('.weplay-guide[open]').count(),1,'Old account response cannot close the new account guide');
  assert.equal(await account.locator('.weplay-guide[open]').getAttribute('aria-busy'),'false');
  assert.equal(await account.locator('.weplay-guide [role=alert]').count(),0);
  assert.equal(await account.evaluate(()=>window.navalQa.getAccount().userData.weplayGuideCompleted),false);
  await account.evaluate(()=>{window.navalQa.hold.completeWeplayGuide=false});await account.locator('.weplay-guide[open]').getByRole('button',{name:'건너뛰기',exact:true}).click();
  await account.waitForFunction(()=>!document.querySelector('.weplay-guide[open]'));
  assert.deepEqual(await account.evaluate(()=>window.navalQa.guideWrites),['guide-account-a','guide-account-b']);await account.close();
  checks.push('Held completion from account A cannot close, complete, busy-lock, or show an error in account B; B requires its own completion');

  const seen=await open('management',1280,'seen=1');await seen.getByRole('button',{name:'체험 시작',exact:true}).waitFor();
  assert.equal(await seen.locator('.weplay-guide[open]').count(),0);
  await seen.getByRole('button',{name:'게임 안내',exact:true}).click();await seen.locator('.weplay-guide[open]').waitFor();
  await capture(seen,'guide-teacher-manual-1280');await seen.keyboard.press('Escape');
  await seen.waitForFunction(()=>!document.querySelector('.weplay-guide[open]'));
  assert.equal(await seen.evaluate(()=>window.navalQa.guideWrites.length),0);await seen.close();
  const resumed=await open('lobby',390,'resume=challenge');await resumed.locator('.naval-game:not(.naval-game--guide)').waitFor();
  assert.equal(await resumed.locator('.weplay-guide[open]').count(),0,'Unseen guide must not automatically interrupt a restored active game');
  await advanceTo(resumed,2200);await resumed.getByRole('button',{name:'게임 도움말',exact:true}).click();guide=resumed.locator('.weplay-guide[open]');await guide.waitFor();
  assert.match(await guide.locator('.weplay-guide-live').textContent(),/시간은 계속 흐릅니다/);
  const liveBefore=await resumed.locator('.naval-game:not(.naval-game--guide) .naval-hud-time').textContent();await resumed.clock.runFor(2000);
  assert.notEqual(await resumed.locator('.naval-game:not(.naval-game--guide) .naval-hud-time').textContent(),liveBefore);
  const ids=await resumed.locator('input[id]').evaluateAll(elements=>elements.map(element=>element.id));assert.equal(new Set(ids).size,ids.length,'Live battle and frozen demo must not duplicate input IDs');
  await capture(resumed,'guide-live-game-manual-390');await resumed.close();
  checks.push('Completed teacher account opens manual guide without another write; active restored student battle is not auto-interrupted, manual guide clearly keeps live clock running, and demo/live input IDs differ');
  }
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
} catch (error) { failure = error.stack; process.exitCode = 1; }
finally {
  if (failure) {
    const page = browser.contexts().flatMap(context => context.pages()).at(-1);
    if (page) { await page.screenshot({path:path.join(evidence,'failure-current-viewport.png'),fullPage:false});screenshots.push('failure-current-viewport.png'); }
  }
  await fs.writeFile(path.join(evidence, 'focus-guide-browser-results.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', failure, checks, errors, requests, screenshots, layoutMeasurements }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
if (failure) throw new Error(failure);
console.log(JSON.stringify({ checks, screenshots }, null, 2));
