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
  const real=createWeplayPreviewTransport(session);qa.realTransport=real;
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
    assert.equal(await battle.locator('.naval-cutin').count(),0);
    assert.equal(await battle.evaluate(()=>window.navalQa.calls.length),0);
    layoutMeasurements.push(metrics);await capture(battle,`focus-normal-${width}`);await battle.close();
  }
  checks.push('320/390/768/1280 ordinary battle: subdued raster sea, 16-second CSS drift, legible 16px water words, 44px controls, input/footer separation, no cut-in or background RPC');

  for (const width of [390,1280]) {
    const special = await open('battle',width,'seen=1');await special.locator('.naval-game').waitFor();await advanceTo(special,30100);
    assert.equal(await special.locator('.naval-special').count(),1);assert.equal(await special.locator('.naval-cutin').count(),0);
    await capture(special,`focus-special-prompt-${width}`);
    await special.getByRole('textbox',{name:'단어 입력'}).fill('오답검증');await special.getByRole('textbox',{name:'단어 입력'}).press('Enter');
    assert.equal(await special.locator('.naval-cutin').count(),0);assert.equal(await special.evaluate(()=>window.navalQa.answers.length),0);
    await special.evaluate(()=>{window.navalQa.holdAnswer=1});assert.equal((await answerVisible(special,true)).accepted,true);
    assert.equal(await special.locator('.naval-cutin').count(),0,'No cut-in until server/local transport acknowledges the accepted special');
    await special.evaluate(()=>window.navalQa.releaseAnswer());await special.clock.runFor(50);await special.locator('.naval-cutin').waitFor();
    await special.waitForFunction(()=>[...document.querySelectorAll('.naval-cutin img')].every(img=>img.complete&&img.naturalWidth>0));
    assert.equal(await special.locator('.naval-cutin').evaluate(element=>getComputedStyle(element).animationDuration),'1.4s');
    const layers=await special.evaluate(()=>{const cutin=getComputedStyle(document.querySelector('.naval-cutin'));return{cutin:Number(cutin.zIndex),words:Number(getComputedStyle(document.querySelector('.naval-prompts')).zIndex),input:Number(getComputedStyle(document.querySelector('.naval-command')).zIndex),pointer:cutin.pointerEvents}});
    assert.ok(layers.words>layers.cutin&&layers.input>layers.cutin&&layers.pointer==='none',JSON.stringify(layers));
    await special.clock.runFor(400);await special.waitForTimeout(350);await capture(special,`focus-successful-special-cutin-${width}`);
    await special.clock.runFor(1100);assert.equal(await special.locator('.naval-cutin').count(),0);assert.equal(await special.getByRole('textbox',{name:'단어 입력'}).isEnabled(),true);
    assert.equal(await special.evaluate(()=>window.navalQa.calls.length),0);await capture(special,`focus-after-cutin-${width}`);await special.close();
  }
  checks.push('Special prompt/wrong answer/pending response do not show cut-in; accepted special loads two raster assets for 1.4s, preserves word/input layers, and restores ordinary play without extra calls');

  const paused=await open('battle',390,'seen=1');await paused.locator('.naval-game').waitFor();await advanceTo(paused,2200);
  await paused.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
  assert.equal(await paused.locator('.naval-ocean').evaluate(element=>getComputedStyle(element).animationPlayState),'paused');
  await capture(paused,'focus-hidden-sea-paused-390');
  await paused.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});
  assert.equal(await paused.locator('.naval-ocean').evaluate(element=>getComputedStyle(element).animationPlayState),'running');
  await paused.getByRole('checkbox',{name:/(움직임|효과) 줄이기/}).check();
  assert.equal(await paused.locator('.naval-ocean').evaluate(element=>getComputedStyle(element).animationPlayState),'paused');
  await advanceTo(paused,30100);await answerVisible(paused,true);await paused.clock.runFor(100);
  assert.equal(await paused.locator('.naval-cutin').evaluate(element=>getComputedStyle(element).display),'none');
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

  const unknown=await open('lobby',390,'profile=loading');await unknown.locator('.weplay-launch').waitFor();
  assert.equal(await unknown.locator('.weplay-guide[open]').count(),0,'Unknown profile must not be treated as unseen');
  await unknown.evaluate(()=>window.navalQa.setAccount('guide-account-a',false));
  await unknown.locator('.weplay-guide[open]').waitFor();await capture(unknown,'guide-profile-loaded-first-entry-390');await unknown.close();
  checks.push('First-entry guide waits for matching loaded profile rather than treating unknown profile as incomplete');

  for(const width of [320,390,768,1280]){
    const guidePage=await open('lobby',width);const guide=guidePage.locator('.weplay-guide[open]');await guide.waitFor();
    assert.equal(await guide.locator('.naval-game--guide').count(),1);
    assert.equal(await guide.locator('.naval-input-frame input').isDisabled(),true);
    const baseline=await guidePage.evaluate(()=>({calls:window.navalQa.calls.length,words:[...document.querySelectorAll('.weplay-guide .naval-word strong')].map(el=>el.textContent),time:document.querySelector('.weplay-guide .naval-hud-time').textContent,hp:document.querySelector('.weplay-guide .naval-health--allied').getAttribute('aria-label')}));
    await guidePage.clock.runFor(120000);
    const after=await guidePage.evaluate(()=>({calls:window.navalQa.calls.length,words:[...document.querySelectorAll('.weplay-guide .naval-word strong')].map(el=>el.textContent),time:document.querySelector('.weplay-guide .naval-hud-time').textContent,hp:document.querySelector('.weplay-guide .naval-health--allied').getAttribute('aria-label')}));
    assert.deepEqual(after,baseline,'Guide demo stays frozen and performs no session/tick/answer/finish calls');
    assert.equal(await guide.locator('.naval-ocean').evaluate(el=>{const style=getComputedStyle(el);return style.animationName==='none'||style.animationPlayState==='paused'}),true);
    for(const [index,target] of ['timeline','words','input','charge','special','health'].entries()){
      assert.equal(await guide.locator('.weplay-guide-demo').getAttribute('data-guide-step'),target);
      const geometry=await guide.evaluate(element=>{const r=element.getBoundingClientRect();const controls=[...element.querySelectorAll('.weplay-guide-actions button')].map(button=>{const b=button.getBoundingClientRect();return{width:b.width,height:b.height}});return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,controls}});
      assert.ok(geometry.left>=0&&geometry.right<=geometry.width&&geometry.top>=0&&geometry.bottom<=geometry.height+1,JSON.stringify(geometry));
      assert.ok(geometry.controls.every(control=>control.width>=44&&control.height>=44),JSON.stringify(geometry));
      await capture(guidePage,`guide-step-${index+1}-${target}-${width}`);
      if(index<5)await guide.getByRole('button',{name:'다음',exact:true}).click();
    }
    assert.equal(await guide.locator('.weplay-guide-card h2').evaluate(el=>document.activeElement===el),true);
    await guide.getByRole('button',{name:'안내 마치기',exact:true}).click();
    await guidePage.waitForFunction(()=>!document.querySelector('.weplay-guide[open]'));
    assert.deepEqual(await guidePage.evaluate(()=>window.navalQa.guideWrites),['guide-account-a']);
    await guidePage.getByRole('button',{name:'게임 안내',exact:true}).click();await guide.waitFor();
    await guide.getByRole('button',{name:'건너뛰기',exact:true}).click();
    await guidePage.waitForFunction(()=>!document.querySelector('.weplay-guide[open]'));
    assert.equal(await guidePage.evaluate(()=>window.navalQa.guideWrites.length),1,'Manual replay after completion must not write again');
    await guidePage.close();
  }
  checks.push('320/390/768/1280 six-step guide uses real frozen battle, no gameplay calls, bounded dialog/44px controls, step focus, one account completion write, manual replay without additional write');

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
