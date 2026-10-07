/** Real student lobby and common early-exit flow; only Auth/Firebase boundaries are fixtures. */
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
  : path.join(root, '.superloopy/sessions/weplay-lobby-exit-20260929/evidence');
await fs.mkdir(evidence, { recursive: true });
const modulePath = relative => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
const lessons = [{ unitId: 'naval-qa', title: '임진왜란과 수군', isVisibleToStudents: true, words: ['이순신', '거북선', '한산도', '판옥선', '명량해전', '학익진'], wordCount: 6 }];
const catalog = lessons.flatMap(lesson => lesson.words.map(text => ({ text, unitId: lesson.unitId, lessonTitle: lesson.title, context: '수업 자료에 등록한 빈칸 정답입니다.' })));
const rankingFixtures = [
  { rank: 1, studentLabel: '1반 1번 검증학생', score: 12500, correctCount: 60, isMe: false },
  { rank: 2, studentLabel: '1반 2번 아주아주긴이름의검증학생입니다', score: 9999, correctCount: 54, isMe: true },
  { rank: 3, studentLabel: '1반 3번 검증학생', score: 8000, correctCount: 46, isMe: false },
  { rank: 4, studentLabel: '1반 4번 긴이름도빠짐없이표시하는검증학생', score: 7500, correctCount: 40, isMe: false },
];
const recordFixtures = [
  { sessionId: 'record-practice', difficulty: 'mild', mode: 'practice', correctCount: 29, totalWords: 60, score: 6000, reward: 0, cost: 0, netWis: 0, balance: 34, finishedAtMs: 1790650800000, missedWords: [] },
  { sessionId: 'record-challenge', difficulty: 'spicy', mode: 'challenge', correctCount: 60, totalWords: 60, score: 12345, reward: 10, cost: 7, netWis: 3, balance: 34, finishedAtMs: 1790737200000, missedWords: [] },
];
const service = `
const params=new URLSearchParams(location.search);
export const view=params.get('view')||'battle';
export const config={year:'2026',semester:'2'};
export const menuConfig=params.has('customTitle')||params.has('legacyTitle')?{student:[{name:'위플레이',url:'/student/weplay',icon:'',children:[{name:params.has('customTitle')?'선생님이 정한 해전':'역사가 내려와',url:'/student/weplay',gameTitleCustomized:params.has('customTitle')}]}],teacher:[]}:null;
const readonly=view==='readonly';
export const userData={uid:'naval-qa',role:view==='lobby'||readonly?'student':'teacher',teacherPortalEnabled:true,staffPermissions:readonly?['lesson_read']:[],email:'qa@example.invalid',name:'검증 교사',weplayGuideCompleted:true};
export const auth={currentUser:{uid:'naval-qa',email:'qa@example.invalid'}};
export const useAuth=()=>({config,currentUser:auth.currentUser,userData,menuConfig});
export const qa=window.navalQa={calls:[],writes:[],answers:[],completions:[],finishAttempts:[],settings:${JSON.stringify(core.DEFAULT_GAME_SETTINGS)},lessons:${JSON.stringify(lessons)},policy:{...${JSON.stringify(core.DEFAULT_POLICY)},challengeCost:7},balance:params.get('poor')==='1'?0:34,failFinish:0,fail:{},hold:{}};
qa.ranking=params.get('ranking')==='full'?${JSON.stringify(rankingFixtures)}:params.get('ranking')==='single'?${JSON.stringify(rankingFixtures.slice(0, 1))}:[];
qa.records=params.get('records')==='full'?${JSON.stringify(recordFixtures)}:[];
qa.period={id:'qa-week',startsAtMs:1791126000000,endsAtMs:1791730800000,rankingPeriod:'weekly',rankingRewards:{mild:{first:10,second:5,third:3},medium:{first:20,second:10,third:6},spicy:{first:30,second:15,third:9}},status:'open'};
const management=()=>({settings:structuredClone(qa.settings),lessons:structuredClone(qa.lessons),availableWordCount:6,previewWordCount:6});
export const getHttpsCallable=async name=>async data=>{
  qa.calls.push({name,data:structuredClone(data)});
  if(qa.fail[name]){qa.fail[name]--;throw new Error('QA 연결 오류');}
  if(qa.hold[name])await new Promise(resolve=>{qa.releaseCall=resolve});
  if(name==='getWeplayLobby')return {data:{gameEnabled:params.get('disabled')!=='1',policy:structuredClone(qa.policy),balance:qa.balance,dailyUsed:1,dailyRemaining:2,lessons:qa.lessons,wordCount:6,difficulties:qa.settings.difficulties,challengeDifficulties:qa.settings.difficulties,wordCountsByDifficulty:{mild:6,medium:6,spicy:6},challengeWordCountsByDifficulty:{mild:6,medium:6,spicy:6},activeSession:params.has('resume')&&!qa.completions.length?qa.session:null,records:[...qa.completions,...qa.records],period:qa.period,rankingByDifficulty:{mild:qa.ranking,medium:[],spicy:qa.ranking.slice(0,1)},serverNowMs:Date.now()}};
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
import {AppToastProvider} from ${modulePath('src/components/common/AppToastProvider.tsx')};
import {AppDialogProvider} from ${modulePath('src/components/common/AppDialogProvider.tsx')};
import ${modulePath('src/components/layout/teacherLayout.css')};
import {qa,view,config} from 'fixture:service';
qa.exports=weplay;
qa.simulate=simulateWeplayBattle;
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
return <MemoryRouter><AppToastProvider><AppDialogProvider>{view==='lobby'?<StudentWeplay/>:!session?<div className='teacher-layout'><ManageWeplay/></div>:<main className='weplay-page'>{!result&&<Game session={session} config={config} preview transport={qa.transport} onComplete={value=>{qa.completed=value;setResult(value);}}/>}{result?.battle&&<NavalResult result={result} preview replaying={replaying} onReplay={()=>{qa.replays=(qa.replays||0)+1;setReplaying(true);}}/>}{result&&<output hidden aria-label='QA 완료 결과'>{JSON.stringify(result)}</output>}</main>}</AppDialogProvider></AppToastProvider></MemoryRouter>}
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
async function startStudent(page, mode = 'practice') {
  await page.locator('.weplay-launch').waitFor();
  if (mode === 'challenge') await page.getByRole('button', { name: '도전하기 위스 획득·차감', exact: true }).click();
  await page.locator('.weplay-start').click();
  await page.getByRole('textbox', { name: '단어 입력' }).waitFor();
  assert.equal(await page.evaluate(() => window.navalQa.calls.filter(call => call.name === 'startWeplayGame').every(call => !Object.hasOwn(call.data, 'unitIds'))), true, 'Students always start with the full game word pool');
  await advanceTo(page, 200);
}
async function checkLobbyDialog(page, title) {
  const trigger = page.getByRole('button', { name: title, exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await dialog.waitFor();
  const geometry = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { title: element.getAttribute('aria-labelledby'), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, controls: [...element.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect(); return { label: button.textContent || button.getAttribute('aria-label'), width: r.width, height: r.height }; }), focusInside: element.contains(document.activeElement) };
  });
  assert.ok(geometry.focusInside, `${title}: focus enters dialog`);
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.top >= 0 && geometry.bottom <= geometry.height + 1, JSON.stringify(geometry));
  assert.ok(geometry.scrollWidth <= geometry.clientWidth, `${title}: no horizontal dialog overflow`);
  assert.ok(geometry.controls.every(control => control.width >= 44 && control.height >= 44), JSON.stringify(geometry));
  const heading = await dialog.getByRole('heading', { name: title, exact: true }).evaluate(element => ({ height: element.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(element).lineHeight) || parseFloat(getComputedStyle(element).fontSize) * 1.5 }));
  assert.ok(heading.height <= heading.lineHeight + 1, `${title}: short dialog heading stays on one line (${JSON.stringify(heading)})`);
  for (let index = 0; index < geometry.controls.length + 2; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, `${title}: forward focus remains inside`);
  }
  for (let index = 0; index < geometry.controls.length + 2; index++) {
    await page.keyboard.press('Shift+Tab');
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, `${title}: reverse focus remains inside`);
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.clock.runFor(30);
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true, `${title}: Escape restores trigger focus`);
  await trigger.click();
  await dialog.waitFor();
  await page.mouse.click(2, 2);
  await dialog.waitFor({ state: 'hidden' });
  await page.clock.runFor(30);
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true, `${title}: backdrop restores trigger focus`);
  await trigger.click();
  await dialog.waitFor();
  return dialog;
}
async function exitDialog(page) {
  await page.getByRole('button', { name: '나가기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '전투를 종료하시겠어요?', exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('button', { name: '계속하기', exact: true }).evaluate(element => document.activeElement === element), true);
  const geometry = await dialog.evaluate(element => {
    const r = element.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: innerWidth, height: visualViewport.height, controls: [...element.querySelectorAll('button')].map(button => { const b = button.getBoundingClientRect(); return { width: b.width, height: b.height }; }) };
  });
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.top >= 0 && geometry.bottom <= geometry.height + 1, JSON.stringify(geometry));
  assert.ok(geometry.controls.every(control => control.width >= 44 && control.height >= 44), JSON.stringify(geometry));
  return dialog;
}
let failure = null;
try {
  for (const width of [320, 390, 768, 1280]) {
    const lobby = await open('lobby', width);
    await lobby.locator('.weplay-launch').waitFor();
    assert.equal(await lobby.getByRole('heading', { level: 1 }).textContent(), '내가 충무공이라고?!');
    const practice = lobby.getByRole('button', { name: '연습하기 위스 변동 없음', exact: true });
    const challenge = lobby.getByRole('button', { name: '도전하기 위스 획득·차감', exact: true });
    assert.equal(await practice.getAttribute('aria-pressed'), 'true');
    assert.equal(await lobby.locator('.weplay-selected-mode').textContent(), '난이도');
    assert.equal(await lobby.getByLabel('수업 범위').count(), 0);
    assert.equal(await lobby.getByRole('combobox').count(), 0);
    assert.match(await lobby.locator('.weplay-wis-badge').textContent(), /내 위스\s*34/);
    assert.equal(await lobby.getByRole('dialog', { name: '우리 반 랭킹', exact: true }).count(), 0);
    assert.equal(await lobby.getByRole('dialog', { name: '내 기록', exact: true }).count(), 0);
    const help = lobby.getByRole('button', { name: '게임 안내', exact: true });
    assert.equal(await help.locator('svg').count(), 1, 'Guide icon uses a scalable, spaced SVG');
    assert.equal(await lobby.locator('.weplay-start').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(22, 60, 78)');
    assert.equal(await lobby.locator('.weplay-launch').evaluate(element => getComputedStyle(element).paddingTop), '0px');
    await lobby.locator('.weplay-launch-art img').waitFor();
    assert.equal(await lobby.locator('.weplay-launch-art img').evaluate(image => image.complete && image.naturalWidth === 1200 && image.naturalHeight === 900 && image.src.includes('lobby-turtle-ship.webp')), true);
    const geometry = await lobby.locator('.weplay-launch').evaluate(element => ({ columns: getComputedStyle(element).gridTemplateColumns.split(' ').length, controls: [...element.querySelectorAll('button,select')].map(control => { const r = control.getBoundingClientRect(); return { width: r.width, height: r.height }; }), textFits: [...element.querySelectorAll('h2,.weplay-choice-top strong,.weplay-choice-note')].every(text => text.scrollWidth <= text.clientWidth) }));
    assert.ok(geometry.textFits && geometry.controls.every(control => control.width >= 44 && control.height >= 44), JSON.stringify(geometry));
    assert.equal(geometry.columns, width < 1024 ? 1 : 2);
    layoutMeasurements.push({ width, ...geometry });
    await capture(lobby, `lobby-practice-${width}`);
    if (width === 320) {
      const emptyHistory = await checkLobbyDialog(lobby, '내 기록');
      assert.match(await emptyHistory.textContent(), /아직 게임 기록이 없습니다/);
      await capture(lobby, 'lobby-records-empty-320');
      await emptyHistory.getByRole('button', { name: '닫기', exact: true }).click();
    }
    await lobby.getByRole('group', { name: '난이도', exact: true }).getByRole('button', { name: '매운맛', exact: true }).click();
    const beforeMode = await lobby.locator('.weplay-launch').boundingBox();
    const beforeStart = await lobby.locator('.weplay-start').boundingBox();
    await challenge.click();
    const afterMode = await lobby.locator('.weplay-launch').boundingBox();
    const afterStart = await lobby.locator('.weplay-start').boundingBox();
    assert.equal(afterMode.height, beforeMode.height, 'Mode must not resize launch panel');
    assert.equal(afterStart.y, beforeStart.y, 'Mode must not move start button');
    assert.equal(await lobby.locator('.weplay-wis-coin').textContent().then(t=>t.trim()), 'Ws');
    assert.equal(await lobby.locator('.weplay-music-button').textContent(), '');

    assert.equal(await challenge.getAttribute('aria-pressed'), 'true');
    assert.equal(await practice.getAttribute('aria-pressed'), 'false');
    assert.equal(await lobby.locator('.weplay-selected-mode').textContent(), '난이도');
    assert.equal(await lobby.locator('.weplay-stakes,.weplay-rule,.weplay-rewards').count(), 0);
    assert.equal(await lobby.locator('.weplay-start').textContent(), '위스 도전 시작 · 7위스');
    await capture(lobby, `lobby-challenge-${width}`);
    await practice.click();
    assert.equal(await lobby.getByRole('combobox').count(), 0);
    assert.equal(await lobby.getByRole('group', { name: '난이도', exact: true }).getByRole('button', { name: '매운맛', exact: true }).getAttribute('aria-pressed'), 'true');
    await lobby.evaluate(() => { window.navalQa.fail.startWeplayGame = 1; });
    await lobby.locator('.weplay-start').click();
    await lobby.getByRole('alert').waitFor();
    assert.equal(await lobby.getByRole('combobox').count(), 0);
    await lobby.locator('.weplay-start').click();
    await lobby.getByRole('textbox', { name: '단어 입력' }).waitFor();
    const started = await lobby.evaluate(() => window.navalQa.calls.filter(call => call.name === 'startWeplayGame'));
    assert.equal(started.length, 2); assert.equal(started[1].data.mode, 'practice'); assert.equal(started[1].data.difficulty, 'spicy');
    assert.equal(started.every(call => !Object.hasOwn(call.data, 'unitIds')), true);
    assert.equal(started[0].data.requestKey, started[1].data.requestKey, 'Failed start retries the same idempotency key');
    await lobby.close();
  }
  checks.push('320/390/768/1280 lobby: full word pool without a student scope selector, no unitIds in start/retry payloads, Wis badge, spaced SVG help, closed secondary dialogs, mode cards, real turtle ship, responsive columns, 44px controls, retained difficulty and same-key failed-start retry');

  for (const width of [320, 390, 768, 1280]) {
    const page = await open('lobby', width, 'ranking=full&records=full');
    await page.locator('.weplay-launch').waitFor();
    let dialog = await checkLobbyDialog(page, '우리 반 랭킹');
    const rankingHelp = dialog.getByRole('button', { name: '랭킹 기준 안내', exact: true });
    await rankingHelp.hover();
    await dialog.getByRole('tooltip').waitFor();
    assert.match(await dialog.getByRole('tooltip').textContent(), /같은 점수는 먼저/);
    await page.mouse.move(2, 2);
    await dialog.getByRole('tooltip').waitFor({ state: 'hidden' });
    await rankingHelp.focus();
    await dialog.getByRole('tooltip').waitFor();
    await page.keyboard.press('Escape');
    await dialog.getByRole('tooltip').waitFor({ state: 'hidden' });
    assert.equal(await dialog.isVisible(), true, 'Escape dismisses ranking help before the dialog');
    await rankingHelp.click();
    await dialog.getByRole('tooltip').waitFor();
    await dialog.getByRole('heading', { name: '우리 반 랭킹', exact: true }).click();
    await dialog.getByRole('tooltip').waitFor({ state: 'hidden' });
    const podium = dialog.locator('.weplay-podium');
    await podium.waitFor();
    const positions = await podium.locator(':scope > *').evaluateAll(elements => elements.map(element => ({ text: element.textContent, left: element.getBoundingClientRect().left, width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })));
    assert.equal(positions.length, 3);
    assert.match(positions[0].text, /1위/); assert.match(positions[1].text, /2위/); assert.match(positions[2].text, /3위/);
    assert.ok(positions[1].left < positions[0].left && positions[0].left < positions[2].left, 'Podium visual order is 2-1-3 with semantic 1-2-3 reading order');
    assert.ok(positions.every(position => position.scrollWidth <= position.clientWidth), JSON.stringify(positions));
    assert.match(positions[1].text, /아주아주긴이름의검증학생입니다/);
    assert.match(positions[0].text, /10\s*위스/); assert.match(positions[1].text, /5\s*위스/); assert.match(positions[2].text, /3\s*위스/);
    assert.match(await dialog.textContent(), /1반 4번 긴이름도빠짐없이표시하는검증학생/);
    await capture(page, `lobby-ranking-full-${width}`);
    const rankingModes = dialog.getByRole('group', { name: '난이도별 랭킹', exact: true });
    await rankingModes.getByRole('button', { name: '중간맛', exact: true }).click();
    assert.equal(await rankingModes.getByRole('button', { name: '중간맛', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.match(await podium.textContent(), /20\s*위스/);
    assert.equal(await podium.getByText('1반 1번 검증학생', { exact: true }).count(), 0);
    await capture(page, `lobby-ranking-empty-${width}`);
    await rankingModes.getByRole('button', { name: '매운맛', exact: true }).click();
    assert.match(await podium.textContent(), /30\s*위스/);
    assert.equal(await podium.getByText('1반 1번 검증학생', { exact: true }).count(), 1);
    assert.equal(await podium.getByText('1반 2번 아주아주긴이름의검증학생입니다', { exact: true }).count(), 0);
    await capture(page, `lobby-ranking-single-${width}`);
    await dialog.getByRole('button', { name: /닫기/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.clock.runFor(30);
    assert.equal(await page.getByRole('button', { name: '우리 반 랭킹', exact: true }).evaluate(element => document.activeElement === element), true);
    assert.equal(await page.getByRole('group', { name: '난이도', exact: true }).getByRole('button', { name: '착한맛', exact: true }).getAttribute('aria-pressed'), 'true', 'Ranking difficulty does not change the chosen game difficulty');
    dialog = await checkLobbyDialog(page, '내 기록');
    assert.match(await dialog.textContent(), /29\s*\/\s*60/);
    assert.match(await dialog.textContent(), /연습/);
    assert.match(await dialog.textContent(), /도전/);
    assert.match(await dialog.textContent(), /위스 변동 없음/);
    assert.match(await dialog.textContent(), /\+3\s*위스/);
    await capture(page, `lobby-records-${width}`);
    await dialog.getByRole('button', { name: /닫기/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.clock.runFor(30);
    assert.equal(await page.getByRole('button', { name: '내 기록', exact: true }).evaluate(element => document.activeElement === element), true);
    assert.equal(await page.evaluate(() => window.navalQa.calls.length), 1, 'Opening and switching record views adds no backend calls');
    await page.getByRole('button', { name: '게임 안내', exact: true }).click();
    await page.locator('.weplay-guide[open]').waitFor();
    await capture(page, `lobby-guide-${width}`);
    await page.getByText('난이도·위스 규칙', {exact:true}).click();
    const rules = page.locator('.weplay-guide-rules');
    assert.match(await rules.textContent(), /2단어마다 화포 1회/);
    assert.match(await rules.textContent(), /최대 손실 7위스/);
    assert.match(await rules.textContent(), /반환되지 않으며/);
    await capture(page, `lobby-guide-rules-${width}`);
    await page.keyboard.press('Escape');
    await page.locator('.weplay-guide[open]').waitFor({ state: 'hidden' });
    await page.close();
  }
  checks.push('320/390/768/1280 ranking and record dialogs: keyboard activation, focus containment/return, Escape/backdrop/close, 44px controls, optional ranking help hover/focus/click/Escape, 2-1-3 naval podium, empty/single/full rankings, long names, difficulty-specific rewards, private history and working help without extra RPCs');

  for (const [query, expected] of [['customTitle=1', '선생님이 정한 해전'], ['legacyTitle=1', '내가 충무공이라고?!']]) {
    const titlePage = await open('lobby', 320, query);
    await titlePage.locator('.weplay-launch').waitFor();
    assert.equal(await titlePage.getByRole('heading', { level: 1 }).textContent(), expected);
    await capture(titlePage, `lobby-title-${query.split('=')[0]}-320`);
    await titlePage.close();
  }
  checks.push('Student title uses the teacher-defined menu title; missing or legacy default names resolve to 내가 충무공이라고?!');

  // Set WEPLAY_QA_LOBBY_ONLY=1 for a focused repeat after a lobby-only visual fix.
  if (process.env.WEPLAY_QA_LOBBY_ONLY !== '1') {
  const shimmer = await open('lobby', 1280);
  const start = shimmer.locator('.weplay-start'); await start.waitFor();
  assert.equal(await start.evaluate(element => getComputedStyle(element, '::before').animationName), 'none');
  await start.hover();
  assert.equal(await start.evaluate(element => getComputedStyle(element, '::before').animationName), 'weplay-start-shimmer');
  await shimmer.mouse.move(0, 0); await start.focus();
  assert.equal(await start.evaluate(element => getComputedStyle(element, '::before').animationName), 'weplay-start-shimmer');
  await shimmer.waitForTimeout(400); await capture(shimmer, 'lobby-start-keyboard-shimmer-1280');
  await shimmer.evaluate(() => { window.navalQa.hold.startWeplayGame = true; });
  await start.click();
  assert.equal(await start.isDisabled(), true);
  assert.equal(await start.evaluate(element => getComputedStyle(element, '::before').animationName), 'none');
  assert.equal(await shimmer.locator('.weplay-mode-choice button').evaluateAll(buttons => buttons.every(button => button.disabled)), true);
  assert.equal(await shimmer.evaluate(() => window.navalQa.calls.filter(call => call.name === 'startWeplayGame').length), 1);
  await shimmer.evaluate(() => window.navalQa.releaseCall());
  await shimmer.getByRole('textbox', { name: '단어 입력' }).waitFor(); await shimmer.close();
  const reduced = await open('lobby', 390, '', { reducedMotion: 'reduce' });
  await reduced.locator('.weplay-start').waitFor(); await reduced.locator('.weplay-start').hover();
  assert.equal(await reduced.locator('.weplay-start').evaluate(element => getComputedStyle(element, '::before').animationName), 'none');
  assert.equal(await reduced.locator('.weplay-start').evaluate(element => getComputedStyle(element).transform), 'none'); await reduced.close();
  const poor = await open('lobby', 390, 'poor=1');
  await poor.getByRole('button', { name: '도전하기 위스 획득·차감', exact: true }).click();
  assert.equal(await poor.locator('.weplay-start').isDisabled(), true); await poor.locator('.weplay-start').hover();
  assert.equal(await poor.locator('.weplay-start').evaluate(element => getComputedStyle(element, '::before').animationName), 'none');
  await capture(poor, 'lobby-disabled-challenge-390'); await poor.close();
  checks.push('Start shimmer works on hover and keyboard focus; pending/insufficient-balance buttons do not animate or double-start; OS reduced motion removes shimmer and movement');

  const practice = await open('lobby', 390); await startStudent(practice);
  let dialog = await exitDialog(practice);
  assert.match(await dialog.textContent(), /위스는 변동되지 않습니다/);
  const timeBefore = await practice.locator('.naval-hud-time').getAttribute('aria-label');
  await practice.clock.runFor(2000);
  assert.notEqual(await practice.locator('.naval-hud-time').getAttribute('aria-label'), timeBefore, 'Time continues during exit confirmation');
  await practice.keyboard.press('Escape');
  await practice.clock.runFor(40);
  assert.equal(await practice.locator('.weplay-exit-dialog[open]').count(), 0);
  assert.equal(await practice.evaluate(() => window.navalQa.finishAttempts.length), 0);
  assert.equal(await practice.getByRole('textbox', { name: '단어 입력' }).evaluate(element => document.activeElement === element), true);
  await practice.getByRole('textbox', { name: '단어 입력' }).focus(); await practice.setViewportSize({ width: 390, height: 360 }); await practice.clock.runFor(250);
  dialog = await exitDialog(practice);
  await capture(practice, 'exit-practice-keyboard-viewport-390x360');
  await dialog.getByRole('button', { name: '계속하기', exact: true }).click();
  await practice.clock.runFor(80);
  assert.equal(await practice.locator('.weplay-exit-dialog[open]').count(), 0);
  assert.equal(await practice.locator('.naval-game--compact').count(), 1);
  assert.equal(await practice.evaluate(() => ['.naval-hud','#naval-answer-input'].every(selector => { const r=document.querySelector(selector).getBoundingClientRect(); return r.top >= 0 && r.bottom <= visualViewport.height; })), true, 'Cancel restores compact HUD and input in the already-reduced keyboard viewport');
  dialog = await exitDialog(practice);
  await dialog.getByRole('button', { name: '현재 기록으로 종료', exact: true }).click(); await practice.clock.runFor(2000);
  await practice.locator('.naval-result').waitFor();
  assert.equal(await practice.evaluate(() => window.navalQa.completions[0].endedEarly), true);
  assert.equal(await practice.evaluate(() => window.navalQa.completions[0].mode), 'practice');
  assert.match(await practice.locator('.naval-result-settlement').textContent(), /위스 변동 없음/);
  assert.notEqual(await practice.locator('.naval-result h2').textContent(), '해역 방어 완료');
  await practice.setViewportSize({ width: 390, height: 950 }); await capture(practice, 'exit-practice-result-390'); await practice.close();
  checks.push('Practice exit native dialog: default continue focus, Escape/cancel restores game, clock continues, keyboard-height geometry fits, explicit early result has no Wis change');

  const pending = await open('lobby', 768); await startStudent(pending, 'challenge');
  await pending.evaluate(() => { window.navalQa.holdAnswer = 1; window.navalQa.failFinish = 1; });
  await answerVisible(pending);
  dialog = await exitDialog(pending);
  assert.match(await dialog.textContent(), /참가비는 반환되지 않으며/);
  await dialog.getByRole('button', { name: '현재 기록으로 종료', exact: true }).evaluate(button => { button.click(); button.click(); });
  await pending.clock.runFor(1000);
  assert.equal(await pending.evaluate(() => window.navalQa.finishAttempts.length), 0, 'Exit waits for the in-flight accepted answer');
  await pending.keyboard.press('Escape');
  assert.equal(await pending.locator('.weplay-exit-dialog[open]').count(), 1, 'Confirmed exit cannot be canceled while settling');
  assert.equal(await pending.getByRole('textbox', { name: '단어 입력' }).isDisabled(), true);
  await pending.evaluate(() => window.navalQa.releaseAnswer()); await pending.clock.runFor(2000);
  await dialog.getByRole('button', { name: '종료 다시 시도', exact: true }).waitFor();
  assert.equal(await pending.evaluate(() => window.navalQa.finishAttempts.length), 1);
  assert.equal(await dialog.getByRole('button', { name: '종료 다시 시도', exact: true }).evaluate(element => document.activeElement === element), true);
  assert.match(await dialog.getByRole('alert').textContent(), /결과 확인 전에는 게임을 계속할 수 없습니다/);
  await capture(pending, 'exit-challenge-failed-retry-768');
  await dialog.getByRole('button', { name: '종료 다시 시도', exact: true }).evaluate(button => { button.click(); button.click(); });
  await pending.clock.runFor(2000); await pending.locator('.naval-result').waitFor();
  const record = await pending.evaluate(() => window.navalQa.completions[0]);
  assert.equal(record.endedEarly, true); assert.equal(record.mode, 'challenge'); assert.equal(record.correctCount, 1); assert.equal(record.cost, 7);
  assert.equal(await pending.evaluate(() => window.navalQa.finishAttempts.length), 2);
  assert.equal(await pending.evaluate(() => window.navalQa.completions.length), 1);
  assert.equal(await pending.evaluate(() => window.navalQa.calls.filter(call => call.name === 'finishWeplayGame').every(call => call.data.exitEarly === true)), true);
  await pending.clock.runFor(5000); assert.equal(await pending.evaluate(() => window.navalQa.completions.length), 1);
  assert.match(await pending.locator('.naval-result-settlement').textContent(), /도전 비용 7위스/);
  await capture(pending, 'exit-challenge-result-768');
  await pending.getByRole('button', { name: '게임 메인으로', exact: true }).click();
  assert.equal(await pending.locator('.weplay-selected-mode').textContent(), '난이도');
  await pending.close();
  checks.push('Challenge exit waits pending answer, locks input, ignores duplicate confirm/Escape, focuses failed-settlement retry, retries exitEarly once and keeps correctCount1 plus challenge receipt/mode');

  const legacy = await open('lobby', 390, 'legacy=1'); await startStudent(legacy);
  assert.equal(await legacy.locator('.naval-game').count(), 0);
  await legacy.getByRole('textbox', { name: '단어 입력' }).fill(await legacy.evaluate(() => window.navalQa.session.words[0].text));
  await legacy.getByRole('textbox', { name: '단어 입력' }).press('Enter');
  await legacy.waitForFunction(() => window.navalQa.answers.length === 1);
  dialog = await exitDialog(legacy); await dialog.getByRole('button', { name: '현재 기록으로 종료', exact: true }).click(); await legacy.clock.runFor(2000);
  await legacy.waitForFunction(() => window.navalQa.completions.length === 1);
  assert.equal(await legacy.evaluate(() => window.navalQa.completions[0].endedEarly), true);
  assert.equal(await legacy.evaluate(() => window.navalQa.completions[0].correctCount), 1);
  assert.equal(await legacy.evaluate(() => window.navalQa.completions[0].battle), undefined);
  await capture(legacy, 'exit-legacy-result-390'); await legacy.close();
  checks.push('Legacy 60-second game confirms early exit and preserves its accepted answer/legacy result without naval conversion');

  const teacher = await open('management', 1280);
  await teacher.getByRole('button', { name: '체험 시작', exact: true }).click();
  await teacher.getByRole('textbox', { name: '단어 입력' }).waitFor(); await advanceTo(teacher, 200);
  dialog = await exitDialog(teacher); assert.match(await dialog.textContent(), /위스·랭킹·학생 기록에 반영되지 않습니다/);
  await capture(teacher, 'exit-teacher-confirm-1280');
  await dialog.getByRole('button', { name: '현재 기록으로 종료', exact: true }).click(); await teacher.clock.runFor(2000);
  await teacher.locator('.naval-result').waitFor();
  assert.match(await teacher.locator('.naval-result-settlement').textContent(), /교사 체험/);
  assert.notEqual(await teacher.locator('.naval-result h2').textContent(), '해역 방어 완료');
  assert.equal(await teacher.evaluate(() => window.navalQa.calls.some(call => /^(start|submit|finish)Weplay/.test(call.name))), false);
  assert.equal(await teacher.evaluate(() => window.navalQa.writes.length), 0);
  await capture(teacher, 'exit-teacher-result-1280'); await teacher.close();
  checks.push('Actual teacher preview confirms exit locally, shows early-exit result, and performs no student/settlement RPC or settings write');

  const small = await open('battle', 320);
  await small.locator('.naval-game').waitFor(); await advanceTo(small, 200); await answerVisible(small); await small.clock.runFor(100);
  const footer = await small.evaluate(() => {
    const input = document.querySelector('.naval-input-frame').getBoundingClientRect();
    const footer = document.querySelector('.naval-footer').getBoundingClientRect();
    return { inputBottom: input.bottom, footerTop: footer.top, controls: [...document.querySelectorAll('.naval-footer button,.naval-footer label')].map(element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height }; }) };
  });
  await capture(small, 'exit-teacher-footer-feedback-320');
  assert.ok(footer.footerTop >= footer.inputBottom, JSON.stringify(footer));
  assert.ok(footer.controls.every(control => control.width >= 44 && control.height >= 44), JSON.stringify(footer));
  await small.close();
  checks.push('320px teacher preview footer keeps Exit/motion/feedback at 44px without overlapping the command input');

  for (const legacyMode of [false, true]) {
    for (const openBeforeEnd of [false, true]) {
      const edge = await open('battle', 390, legacyMode ? 'legacy=1' : '');
      await edge.getByRole('textbox', { name: '단어 입력' }).waitFor(); await advanceTo(edge, 200);
      await edge.evaluate(() => { window.navalQa.failFinish = 1; });
      if (openBeforeEnd) await exitDialog(edge);
      await advanceTo(edge, legacyMode ? 62500 : 92500);
      if (!openBeforeEnd) {
        await edge.getByRole('button', { name: '정산 다시 시도', exact: true }).waitFor();
        dialog = await exitDialog(edge);
        await dialog.getByRole('button', { name: '현재 기록으로 종료', exact: true }).click();
      } else {
        dialog = edge.getByRole('dialog', { name: '전투를 종료하시겠어요?', exact: true });
        await dialog.getByRole('button', { name: '종료 다시 시도', exact: true }).waitFor();
        assert.equal(await dialog.getByRole('button', { name: '계속하기', exact: true }).count(), 0);
        await edge.keyboard.press('Escape'); assert.equal(await edge.locator('.weplay-exit-dialog[open]').count(), 1);
        await capture(edge, `exit-auto-end-dialog-failure-${legacyMode ? 'legacy' : 'naval'}-390`);
        await dialog.getByRole('button', { name: '종료 다시 시도', exact: true }).click();
      }
      await edge.clock.runFor(2000);
      await edge.waitForFunction(() => window.navalQa.completions.length === 1);
      assert.equal(await edge.evaluate(() => window.navalQa.finishAttempts.length), 2);
      assert.equal(await edge.evaluate(() => window.navalQa.completions[0].endedEarly), undefined, 'Already naturally ended battle retains its true outcome when exit is used to retry');
      await edge.close();
    }
  }
  checks.push('Naval and legacy: auto-settlement failure can be retried through Exit; a confirmation dialog open at natural game end locks and shows settlement retry instead of allowing resume');

  const fast = await open('battle', 390, 'fast=1&difficulty=spicy');
  await fast.locator('.naval-game').waitFor();
  const nextAttack = await fast.evaluate(() => window.navalQa.simulate(window.navalQa.session, Date.now()-window.navalQa.session.startsAtMs).nextEnemyAttackAtMs);
  await advanceTo(fast, nextAttack + 100);
  await fast.locator('.naval-effect--enemy').waitFor();
  dialog = await exitDialog(fast);
  const confirmedAt = await fast.evaluate(() => Date.now());
  await dialog.getByRole('button', { name: '현재 기록으로 종료', exact: true }).click();
  await fast.clock.runFor(200);
  await fast.waitForFunction(() => window.navalQa.completions.length === 1);
  assert.equal(await fast.evaluate(() => window.navalQa.completions[0].endedEarly), true);
  assert.ok(await fast.evaluate(at => window.navalQa.finishAttempts[0].at-at <= 200, confirmedAt), 'Voluntary exit must not wait on the continuously renewed effect deadline');
  await capture(fast, 'exit-fast-consecutive-attacks-result-390'); await fast.close();
  checks.push('Fast spicy [3,2,1] timing: voluntary exit during a recurring 1.2-second attack finishes within 200ms when no answer is pending, despite active effects');

  const resumed = await open('lobby', 390, 'resume=challenge');
  await resumed.getByRole('textbox', { name: '단어 입력' }).waitFor(); await advanceTo(resumed, 200);
  dialog = await exitDialog(resumed); assert.match(await dialog.textContent(), /참가비는 반환되지 않으며/);
  await dialog.getByRole('button', { name: '현재 기록으로 종료', exact: true }).click(); await resumed.clock.runFor(300);
  await resumed.locator('.naval-result').waitFor();
  await resumed.getByRole('button', { name: '게임 메인으로', exact: true }).click();
  assert.equal(await resumed.locator('.weplay-selected-mode').textContent(), '난이도');
  assert.equal(await resumed.getByRole('button', { name: '도전하기 위스 획득·차감', exact: true }).getAttribute('aria-pressed'), 'true');
  await capture(resumed, 'lobby-restored-challenge-replay-390'); await resumed.close();
  checks.push('Restored challenge session keeps challenge mode after early result and Replay returns to lobby');
  }
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
} catch (error) { failure = error.stack; process.exitCode = 1; }
finally {
  if (failure) {
    const page = browser.contexts().flatMap(context => context.pages()).at(-1);
    if (page) { await page.screenshot({path:path.join(evidence,'failure-current-viewport.png'),fullPage:false});screenshots.push('failure-current-viewport.png'); }
  }
  await fs.writeFile(path.join(evidence, 'lobby-exit-browser-results.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', failure, checks, errors, requests, screenshots, layoutMeasurements }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
if (failure) throw new Error(failure);
console.log(JSON.stringify({ checks, screenshots }, null, 2));
