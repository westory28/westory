/** Real battle UI, preview transport and CSS. Only Auth/Firebase boundaries are fixtures. */
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
const finalEffectsOnly = process.env.WEPLAY_QA_FOCUS === 'final-effects';
const evidence = process.env.WEPLAY_QA_EVIDENCE_DIR
  ? path.resolve(process.env.WEPLAY_QA_EVIDENCE_DIR)
  : path.join(root, '.superloopy/sessions/weplay-naval-effects-20260929/evidence');
await fs.mkdir(evidence, { recursive: true });
const modulePath = relative => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
const lessons = [{ unitId: 'naval-qa', title: '임진왜란과 수군', isVisibleToStudents: true, words: ['이순신', '거북선', '한산도', '판옥선', '명량해전', '학익진'], wordCount: 6 }];
const catalog = lessons.flatMap(lesson => lesson.words.map(text => ({ text, unitId: lesson.unitId, lessonTitle: lesson.title, context: '수업 자료에 등록한 빈칸 정답입니다.' })));
const service = `
const params=new URLSearchParams(location.search);
export const view=params.get('view')||'battle';
export const config={year:'2026',semester:'2'};
const readonly=view==='readonly';
export const userData={uid:'naval-qa',role:readonly?'student':'teacher',teacherPortalEnabled:true,staffPermissions:readonly?['lesson_read']:[],email:'qa@example.invalid',name:'검증 교사'};
export const useAuth=()=>({config,currentUser:{uid:'naval-qa',email:'qa@example.invalid'},userData});
export const qa=window.navalQa={calls:[],writes:[],answers:[],completions:[],settings:${JSON.stringify(core.DEFAULT_GAME_SETTINGS)},lessons:${JSON.stringify(lessons)},failFinish:0};
const management=()=>({settings:structuredClone(qa.settings),lessons:structuredClone(qa.lessons),availableWordCount:6,previewWordCount:6});
export const getHttpsCallable=async name=>async data=>{
  qa.calls.push({name,data:structuredClone(data)});
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
import Game from ${modulePath('src/components/common/weplay/HistoryRainGame.tsx')};
import NavalResult from ${modulePath('src/components/common/weplay/NavalBattleResult.tsx')};
import ManageWeplay from ${modulePath('src/pages/teacher/ManageWeplay.tsx')};
import {createWeplayPreviewTransport} from ${modulePath('src/lib/weplayPreview.ts')};
import * as weplay from ${modulePath('src/lib/weplay.ts')};
import {simulateWeplayBattle} from ${modulePath('src/lib/weplayBattle.ts')};
import {AppToastProvider} from ${modulePath('src/components/common/AppToastProvider.tsx')};
import {AppDialogProvider} from ${modulePath('src/components/common/AppDialogProvider.tsx')};
import ${modulePath('src/assets/index.css')};
import ${modulePath('src/components/common/weplay/weplay.css')};
import ${modulePath('src/components/layout/teacherLayout.css')};
import {qa,view,config} from 'fixture:service';
qa.exports=weplay;
qa.simulate=simulateWeplayBattle;
async function setup(){
  if(view==='management'||view==='readonly'){render(null);return;}
  const params=new URLSearchParams(location.search);
  const response=await fetch('/session',{method:'POST',body:JSON.stringify({now:Date.now(),difficulty:params.get('difficulty')||'mild',legacy:params.get('legacy')==='1',long:params.get('long')==='1'})});
  qa.session=await response.json();
  const real=createWeplayPreviewTransport(qa.session);
  qa.realTransport=real;
  qa.transport={...real,answer:async data=>{const result=await real.answer(data);qa.answers.push({data:structuredClone(data),result:structuredClone(result)});if((qa.holdFirst&&qa.answers.length===1)||qa.holdAnswer===qa.answers.length)await new Promise(resolve=>{qa.releaseFirst=resolve});return result;},finish:async()=>{if(qa.failFinish){qa.failFinish--;throw new Error('QA 정산 연결 오류');}const result=await real.finish();qa.completions.push(result);return result;}};
  render(qa.session);
}
function Fixture({session}){
const params=new URLSearchParams(location.search);
const[result,setResult]=useState(view==='result'?{sessionId:'result-fixture',difficulty:session.difficulty,mode:params.get('mode')==='challenge'?'challenge':'practice',correctCount:37,totalWords:60,score:12500,reward:5,cost:2,netWis:3,balance:103,finishedAtMs:Date.now(),missedWords:session.words.filter(word=>word.kind==='normal').slice(0,3),battleVersion:1,battle:{...simulateWeplayBattle(session,0),outcome:params.get('outcome')==='defeat'?'defeat':'victory',sunkShips:3,cannonShots:18,specialCount:2}}:null);
const[replaying,setReplaying]=useState(false);
return <MemoryRouter><AppToastProvider><AppDialogProvider>{!session?<div className='teacher-layout'><ManageWeplay/></div>:<main className='weplay-page' style={params.has('container')?{width:Number(params.get('container')),marginLeft:480}:undefined}>{view!=='result'&&<Game session={session} config={config} preview transport={qa.transport} onComplete={value=>{qa.completed=value;setResult(value);}}/>}{result?.battle&&<NavalResult result={result} preview={view!=='result'||params.get('preview')==='1'} replaying={replaying} onReplay={()=>{qa.replays=(qa.replays||0)+1;setReplaying(true);}}/>}{result&&<output hidden aria-label='QA 완료 결과'>{JSON.stringify(result)}</output>}</main>}</AppDialogProvider></AppToastProvider></MemoryRouter>}
function render(session){createRoot(document.getElementById('root')).render(<Fixture session={session}/>);}
setup().catch(error=>{qa.error=error.message;throw error;});
`;
const bundled = await build({
  stdin: { contents: harness, loader: 'tsx', resolveDir: root }, bundle: true, write: false,
  format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(os.tmpdir(), 'westory-naval-qa.js'), external: ['/assets/*'],
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' },
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
  const difficultySettings = settings.difficulties[difficulty];
  const startsAtMs = data.now + 3000;
  const session = { id: 'naval-preview-qa', mode: 'practice', difficulty, difficultySettings, battleVersion: 1, acceptedEvents: [], status: 'active', startsAtMs, endsAtMs: startsAtMs + difficultySettings.durationSeconds * 1000, serverNowMs: data.now, words: core.buildWords(catalog, 'naval-qa', difficulty, difficultySettings), acceptedWordIds: [], correctCount: 0, policy: core.DEFAULT_POLICY, result: null };
  if (data.legacy) {
    delete session.battleVersion; delete session.acceptedEvents;
    session.difficultySettings = { ...difficultySettings, durationSeconds: 60 };
    session.endsAtMs = startsAtMs + 60000;
    session.words = Array.from({ length: 20 }, (_, index) => ({ ...catalog[index % catalog.length], id: 'word-' + (index + 1), stage: index < 7 ? 1 : index < 14 ? 2 : 3, spawnAtMs: Math.floor(index * 2000), fallDurationMs: 10000 }));
  }
  if (data.long) session.words = session.words.map(word => word.kind === 'normal' ? { ...word, text: '대한민국임시정부수립과정' } : word);
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
async function measureBattleLayout(page) {
  return page.evaluate(() => {
    const box = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
    };
    const scene = box('.naval-scene');
    const title = box('.naval-title-art'), badge = box('.naval-difficulty-badge');
    const inside = selector => {
      const bounds = box(selector);
      return !!bounds && bounds.left >= scene.left - 1 && bounds.right <= scene.right + 1 && bounds.top >= scene.top - 1 && bounds.bottom <= scene.bottom + 1;
    };
    const allShips = [...document.querySelectorAll('.naval-scene img')].filter(image => /(?:enemy|allied)-ship/.test(image.src));
    const ships = side => allShips.filter(image => image.src.includes(side + '-ship')).map(image => { const b = image.getBoundingClientRect(); return { width: b.width, height: b.height, top: b.top, bottom: b.bottom, visible: getComputedStyle(image).visibility !== 'hidden' && getComputedStyle(image).display !== 'none', loaded: image.complete && image.naturalWidth > 0 }; });
    const controls = [...document.querySelectorAll('.naval-input-frame button,.naval-input-frame input,.naval-footer label')].map(element => { const bounds = element.getBoundingClientRect(); return { tag: element.tagName, width: bounds.width, height: bounds.height }; });
    return { scene, titleBadgeSeparate: title.bottom <= badge.top || title.top >= badge.bottom || title.right <= badge.left || title.left >= badge.right, input: box('.naval-input-frame'), alliedHealth: box('.naval-health--allied'), enemyHealth: box('.naval-health--enemy'), alliedFleet: box('.naval-fleet--allied'), enemyFleet: box('.naval-fleet--enemy'), enemyShips: ships('enemy'), alliedShips: ships('allied'), controls, footerInside: inside('.naval-footer'), feedbackInside: inside('.naval-feedback'), promptsInside: inside('.naval-prompts'), words: [...document.querySelectorAll('.naval-word strong')].map(element => ({ font: parseFloat(getComputedStyle(element).fontSize), fits: element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight })), wordRise: [...document.querySelectorAll('.naval-word')].map(element => ({ animation: getComputedStyle(element).animationName, transform: getComputedStyle(element).transform, background: getComputedStyle(element).backgroundImage })) };
  });
}
function assertBattleLayout(metrics, name) {
  assert.equal(metrics.titleBadgeSeparate, true, `${name}: selected difficulty must not overlap title art`);
  assert.ok(metrics.footerInside && metrics.feedbackInside && metrics.promptsInside, `${name}: scene-contained controls/prompts ${JSON.stringify(metrics)}`);
  assert.ok(metrics.controls.every(control => control.width >= 44 && control.height >= 44), `${name}: 44px touch controls ${JSON.stringify(metrics.controls)}`);
  assert.ok(metrics.enemyShips.filter(ship => ship.visible && ship.loaded && ship.width > 10).length >= 6, `${name}: at least six actual visible enemy raster ships`);
  assert.ok(metrics.alliedShips.filter(ship => ship.visible && ship.loaded && ship.width > 10).length >= 3, `${name}: at least three actual visible allied raster ships`);
  assert.ok(metrics.enemyHealth.bottom < metrics.alliedHealth.top, `${name}: enemy health above allied health`);
  assert.ok(metrics.alliedHealth.bottom <= metrics.input.top + 1, `${name}: allied health above command input`);
  assert.ok(metrics.input.top - metrics.alliedHealth.bottom <= 120, `${name}: allied health is near the command input`);
  assert.ok(metrics.words.every(word => word.font >= 16 && word.fits), `${name}: legible and unclipped prompt text`);
  if (metrics.scene.width > 900) assert.ok(metrics.input.width <= Math.min(520, metrics.scene.width / 2) + 1, `${name}: desktop command width <= half scene and 520px`);
  if (metrics.scene.width <= 600) assert.ok(metrics.scene.height > metrics.scene.width * 1.2, `${name}: dedicated portrait mobile layout`);
  if (metrics.enemyFleet) assert.ok(metrics.enemyHealth.top < metrics.enemyFleet.top + metrics.enemyFleet.height / 2, `${name}: enemy HP visually above the enemy fleet`);
}
async function currentBattle(page) {
  return page.evaluate(() => {
    const qa = window.navalQa;
    const events = qa.answers.at(-1)?.result.acceptedEvents || [];
    return qa.simulate(qa.session, Date.now() - qa.session.startsAtMs, events);
  });
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
  if (!finalEffectsOnly) {
  assert.equal(core.DEFAULT_GAME_SETTINGS.difficulties.mild.durationSeconds, 90, 'Naval defaults must be 90 seconds');
  checks.push('90-second default contract');
  for (const width of [320, 390, 768, 1280]) {
    const layout = await open('battle', width);
    await layout.locator('.naval-game').waitFor();
    await advanceTo(layout, 2200);
    await layout.waitForFunction(() => [...document.querySelectorAll('.naval-game img')].every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await layout.locator('.naval-word').count(), 3);
    assert.equal(await layout.locator('.naval-word-splash').count(), 3);
    await layout.waitForTimeout(300);
    const metrics = await measureBattleLayout(layout);
    assertBattleLayout(metrics, `${width}px`);
    layoutMeasurements.push({ width, ...metrics });
    await capture(layout, `naval-layout-water-columns-${width}`);
    await layout.close();
  }
  checks.push('320/390/768/1280px: three raster water-column words, 6+ enemy and 3+ allied ships, enemy HP above/allied HP near input, scene-contained help and feedback, 44px controls, desktop half-width command, dedicated portrait mobile layout');
  const lane = await open('battle', 390);
  await lane.locator('.naval-game').waitFor(); await advanceTo(lane, 2200);
  await lane.waitForTimeout(700);
  const beforeLane = await lane.locator('.naval-word').evaluateAll(elements => Object.fromEntries(elements.map(element => [element.dataset.wordId, element.getBoundingClientRect().x])));
  const firstLaneId = await lane.locator('.naval-word').first().getAttribute('data-word-id');
  await answerVisible(lane);
  await lane.waitForFunction(id => !document.querySelector(`.naval-word[data-word-id="${id}"]`), firstLaneId);
  const afterLane = await lane.locator('.naval-word').evaluateAll(elements => Object.fromEntries(elements.map(element => [element.dataset.wordId, element.getBoundingClientRect().x])));
  for (const [id, x] of Object.entries(beforeLane)) if (id !== firstLaneId && id in afterLane) assert.ok(Math.abs(afterLane[id] - x) < 1, `${id} must keep its water lane after another word is answered`);
  assert.equal(Object.keys(beforeLane).filter(id => id !== firstLaneId && id in afterLane).length, 2);
  await capture(lane, 'naval-stable-water-lanes-390');
  checks.push('Answering one water word preserves the remaining two word IDs in their original horizontal lanes');
  await lane.close();
  for (const [difficulty, ammo] of [['mild', 2], ['medium', 3], ['spicy', 4]]) {
    const width = { mild: 390, medium: 768, spicy: 1280 }[difficulty];
    const page = await open('battle', width, `difficulty=${difficulty}`);
    await page.locator('.naval-game').waitFor();
    assert.equal(await page.locator('.naval-difficulty-badge').textContent(), { mild: '착한맛', medium: '중간맛', spicy: '매운맛' }[difficulty]);
    assert.equal(await page.getByRole('textbox', { name: '단어 입력' }).isDisabled(), true);
    await advanceTo(page, 200);
    assert.equal(await page.getByRole('textbox', { name: '단어 입력' }).isEnabled(), true);
    await page.waitForFunction(() => [...document.querySelectorAll('.naval-game img')].every(img => img.complete && img.naturalWidth > 0));
    await capture(page, `naval-start-${difficulty}-${width}`);
    for (let index = 0; index < ammo; index++) {
      await advanceTo(page, index * 1500 + 200);
      const response = await answerVisible(page);
      assert.equal(response.accepted, true);
      const state = await currentBattle(page);
      assert.equal(state.cannonShots, index === ammo - 1 ? 1 : 0);
      assert.equal(state.ammo, index === ammo - 1 ? 0 : index + 1);
    }
    assert.equal((await currentBattle(page)).enemyHp, 88);
    await page.locator('.naval-effect--cannon').waitFor();
    assert.equal(await page.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 100', 'Displayed enemy HP waits for cannon arrival');
    await page.clock.runFor(450);
    await page.locator('.naval-ship--enemy.is-hit').waitFor();
    assert.equal(await page.locator('.naval-health--enemy.is-hit').count(), 1);
    assert.match(await page.locator('.naval-damage--enemy').textContent(), /12/);
    assert.equal(await page.locator('.naval-ship--enemy').evaluate(element => getComputedStyle(element).animationName), 'naval-enemy-recoil');
    await page.waitForTimeout(250);
    await capture(page, `naval-cannon-${difficulty}-${width}`);
    assert.equal(await page.evaluate(() => window.navalQa.calls.length), 0);
    checks.push(`${difficulty} at ${width}px: raster assets, countdown, ${ammo} accepted words fire one cannon, ammo reset and 12 HP damage, zero preview RPCs`);
    await page.close();
  }
  const automatic = await open('battle', 390, 'difficulty=spicy');
  await automatic.locator('.naval-game').waitFor();
  await advanceTo(automatic, 5000);
  assert.equal((await currentBattle(automatic)).playerHp, 91);
  assert.equal(await automatic.locator('.naval-effect--enemy').count(), 1);
  await automatic.clock.runFor(450);
  await automatic.locator('.naval-ship--allied.is-hit').waitFor();
  assert.equal(await automatic.locator('.naval-health--allied.is-hit').count(), 1);
  assert.match(await automatic.locator('.naval-damage--allied').textContent(), /9/);
  await automatic.waitForTimeout(250);
  await capture(automatic, 'naval-enemy-attack-390');
  await advanceTo(automatic, 90000);
  await automatic.clock.runFor(1500);
  await automatic.waitForFunction(() => !!window.navalQa.completed);
  assert.equal((await automatic.evaluate(() => window.navalQa.completed.battle)).outcome, 'defeat');
  assert.equal(await automatic.getByRole('textbox', { name: '단어 입력' }).isDisabled(), true);
  assert.equal(await automatic.evaluate(() => window.navalQa.calls.length), 0);
  checks.push('Enemy automatic attacks reduce allied HP, defeat ends battle, zero frame/tick RPCs');
  await capture(automatic, 'naval-defeat-390');
  await automatic.close();

  for (const container of [600, 680]) {
    const narrow = await open('battle', 1280, `container=${container}`);
    await narrow.locator('.naval-game').waitFor(); await advanceTo(narrow, 200);
    const geometry = await narrow.evaluate(() => {
      const scene = document.querySelector('.naval-scene').getBoundingClientRect();
      return [...document.querySelectorAll('.naval-health,.naval-command,.naval-word,.naval-hud')].map(element => { const box = element.getBoundingClientRect(); return { className: element.className, fits: box.left >= scene.left - 1 && box.right <= scene.right + 1 && box.top >= scene.top - 1 && box.bottom <= scene.bottom + 1 }; });
    });
    assert.ok(geometry.every(item => item.fits), JSON.stringify(geometry));
    const metrics = await measureBattleLayout(narrow);
    assertBattleLayout(metrics, `teacher ${container}px`);
    layoutMeasurements.push({ container, ...metrics });
    await capture(narrow, `naval-teacher-container-${container}`);
    await narrow.close();
  }
  const keyboard = await open('battle', 390);
  await keyboard.locator('.naval-game').waitFor(); await advanceTo(keyboard, 2200);
  await keyboard.getByRole('textbox', { name: '단어 입력' }).focus();
  await keyboard.setViewportSize({ width: 390, height: 360 });
  await keyboard.clock.runFor(250);
  await keyboard.locator('.naval-game--compact').waitFor();
  const keyboardGeometry = await keyboard.evaluate(() => {
    const input = document.querySelector('#naval-answer-input').getBoundingClientRect();
    const prompts = [...document.querySelectorAll('.naval-word')].map(element => element.getBoundingClientRect());
    const bottom = visualViewport.offsetTop + visualViewport.height;
    const health = [...document.querySelectorAll('.naval-health')].map(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; });
    const retained = ['.naval-hud', '.naval-footer'].map(selector => { const rect = document.querySelector(selector).getBoundingClientRect(); return { selector, top: rect.top, bottom: rect.bottom }; });
    return { input: { top: input.top, bottom: input.bottom }, prompts: prompts.map(prompt => ({ top: prompt.top, bottom: prompt.bottom })), health, retained, viewportBottom: bottom };
  });
  assert.ok(keyboardGeometry.input.top >= 0 && keyboardGeometry.input.bottom <= keyboardGeometry.viewportBottom + 1, JSON.stringify(keyboardGeometry));
  assert.equal(keyboardGeometry.prompts.length, 3);
  assert.ok(keyboardGeometry.prompts.every(prompt => prompt.top >= 0 && prompt.bottom <= keyboardGeometry.viewportBottom), JSON.stringify(keyboardGeometry));
  assert.ok(keyboardGeometry.health.every(health => health.top >= 0 && health.bottom <= keyboardGeometry.viewportBottom), JSON.stringify(keyboardGeometry));
  assert.ok(keyboardGeometry.retained.every(element => element.top >= 0 && element.bottom <= keyboardGeometry.viewportBottom), JSON.stringify(keyboardGeometry));
  await keyboard.waitForTimeout(650);
  await capture(keyboard, 'naval-keyboard-viewport-390x360');
  await answerVisible(keyboard);
  await advanceTo(keyboard, 30100);
  const compactSpecial = await keyboard.evaluate(() => {
    const rect = selector => { const bounds = document.querySelector(selector).getBoundingClientRect(); return { top: bounds.top, bottom: bounds.bottom }; };
    return { special: rect('.naval-special'), input: rect('.naval-input-frame'), allied: rect('.naval-health--allied'), enemy: rect('.naval-health--enemy'), viewport: visualViewport.offsetTop + visualViewport.height };
  });
  assert.ok(compactSpecial.special.top >= 0 && compactSpecial.special.bottom <= compactSpecial.viewport, JSON.stringify(compactSpecial));
  for (const element of [compactSpecial.input, compactSpecial.allied, compactSpecial.enemy]) assert.ok(compactSpecial.special.bottom <= element.top || compactSpecial.special.top >= element.bottom, `Keyboard special overlaps HP/input: ${JSON.stringify(compactSpecial)}`);
  await capture(keyboard, 'naval-special-keyboard-viewport-390x360');
  assert.equal((await answerVisible(keyboard, true)).accepted, true);
  await keyboard.getByRole('checkbox', { name: '움직임 줄이기' }).check();
  await keyboard.setViewportSize({ width: 390, height: 950 });
  await keyboard.clock.runFor(250);
  assert.equal(await keyboard.getByRole('checkbox', { name: '움직임 줄이기' }).evaluate(element => document.activeElement === element), true, 'Closing the keyboard while changing motion settings must not refocus the answer input');
  checks.push('600/680px teacher content at 1280px viewport keeps HUD, words and input inside scene; simulated keyboard viewport shrink preserves visible prompt and usable input');
  await keyboard.close();
  for (const width of [320, 390]) {
  const longWords = await open('battle', width, 'long=1');
  await longWords.locator('.naval-game').waitFor(); await advanceTo(longWords, 2200);
  await longWords.waitForTimeout(700);
  assert.equal(await longWords.locator('.naval-word').count(), 3);
  const longGeometry = await longWords.evaluate(() => ({
    font: parseFloat(getComputedStyle(document.querySelector('.naval-word strong')).fontSize),
    promptsBottom: document.querySelector('.naval-prompts').getBoundingClientRect().bottom,
    inputTop: document.querySelector('.naval-input-frame').getBoundingClientRect().top,
    wordsFit: [...document.querySelectorAll('.naval-word strong')].every(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight),
  }));
  assert.ok(longGeometry.font >= 16 && longGeometry.wordsFit && longGeometry.promptsBottom < longGeometry.inputTop, JSON.stringify(longGeometry));
  await capture(longWords, `naval-three-long-words-${width}`);
  checks.push(`${width}px: three simultaneous 12-character mobile prompts remain at least 16px, uncut and above the input`);
  await longWords.close();
  }

  const special = await open('battle', 1280);
  await special.locator('.naval-game').waitFor();
  await advanceTo(special, 30100);
  assert.equal(await special.locator('.naval-special').count(), 1);
  await capture(special, 'naval-special-prompt-1280');
  const beforeSpecial = await currentBattle(special);
  await answerVisible(special, true);
  const afterSpecial = await currentBattle(special);
  assert.equal(afterSpecial.specialCount, 1);
  assert.equal(afterSpecial.damageDealt - beforeSpecial.damageDealt, 45);
  await special.locator('.naval-effect--special').waitFor();
  await special.clock.runFor(450);
  await special.waitForTimeout(600);
  await capture(special, 'naval-special-activation-1280');
  await advanceTo(special, 65000);
  assert.equal(await special.locator('.naval-special').count(), 0);
  const expired = await special.evaluate(async () => {
    const qa = window.navalQa; const word = qa.session.words.find(word => word.id === 'special-2');
    return qa.realTransport.answer({ sessionId: qa.session.id, eventId: 'expired-special', wordId: word.id, answer: word.text });
  });
  assert.equal(expired.accepted, false);
  checks.push('Five-second special prompt deals 45 damage and activates tactic; second prompt expires exactly at its five-second deadline without reward');
  await special.close();

  const lastStand = await open('battle', 390);
  await lastStand.locator('.naval-game').waitFor();
  await advanceTo(lastStand, 60100);
  await lastStand.waitForTimeout(500);
  const mobileSpecial = await lastStand.evaluate(() => {
    const bounds = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
    return { special: bounds('.naval-special'), words: [...document.querySelectorAll('.naval-word strong')].map(element => ({top: element.getBoundingClientRect().top})), hp: bounds('.naval-health--enemy') };
  });
  assert.ok(mobileSpecial.special.top > mobileSpecial.hp.bottom && mobileSpecial.words.every(word => mobileSpecial.special.bottom < word.top), JSON.stringify(mobileSpecial));
  await capture(lastStand, 'naval-special-prompt-390');
  await advanceTo(lastStand, 64999);
  assert.equal((await answerVisible(lastStand, true)).accepted, true);
  await lastStand.clock.runFor(50);
  await lastStand.locator('.naval-effect--special').waitFor();
  await lastStand.clock.runFor(450);
  await lastStand.waitForTimeout(600);
  await capture(lastStand, 'naval-last-stand-390');
  assert.equal((await currentBattle(lastStand)).specialCount, 1);
  checks.push('Second special tactic remains answerable at 4,999ms, activates independently in the final phase and fits mobile viewport');
  await lastStand.close();

  const effects = await open('battle', 1280, '', { reducedMotion: 'reduce' });
  await effects.locator('.naval-game').waitFor(); await advanceTo(effects, 200);
  assert.equal(await effects.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  assert.equal(await effects.getByRole('checkbox', { name: '움직임 줄이기' }).isChecked(), false);
  assert.equal(await effects.locator('.naval-game--still').count(), 0);
  const rise = await effects.locator('.naval-word').first().evaluate(element => ({ name: getComputedStyle(element).animationName, duration: getComputedStyle(element).animationDuration, splashAnimation: getComputedStyle(element.querySelector('.naval-word-splash')).animationName, splashInsideWord: element.contains(element.querySelector('.naval-word-splash')) }));
  assert.equal(rise.name, 'naval-word-rise'); assert.equal(rise.duration, '0.8s');
  assert.ok(rise.splashInsideWord && rise.splashAnimation === 'none', JSON.stringify(rise));
  await effects.waitForTimeout(350);
  await capture(effects, 'naval-synchronized-water-rise-os-reduced-1280');
  for (let index = 0; index < 18; index++) { await advanceTo(effects, index * 1500 + 200); await answerVisible(effects); }
  await effects.clock.runFor(450);
  await effects.locator('.naval-effect--sunk').waitFor();
  assert.equal((await currentBattle(effects)).sunkShips, 1);
  assert.equal(await effects.locator('.naval-sunk-label').evaluate(element => element.getBoundingClientRect().top >= document.querySelector('.naval-health--enemy').getBoundingClientRect().bottom), true, 'Sunk announcement must stay below the enemy HP panel');
  assert.equal(await effects.locator('.naval-sinking-ship').evaluate(element => getComputedStyle(element).animationName), 'naval-sink');
  assert.notEqual(await effects.locator('.naval-sinking-ship').evaluate(element => getComputedStyle(element).display), 'none');
  await effects.waitForTimeout(500);
  await capture(effects, 'naval-sunk-os-reduced-default-effects-1280');
  await effects.getByRole('checkbox', { name: '움직임 줄이기' }).check();
  assert.equal(await effects.locator('.naval-sinking-ship').evaluate(element => getComputedStyle(element).display), 'none');
  await effects.getByRole('checkbox', { name: '움직임 줄이기' }).uncheck();
  const fuse = effects.getByRole('progressbar', { name: '전투 진행 시간', exact: true });
  for (const [elapsed, phase, seconds] of [[29900, '초반', 29], [30010, '중반', 30], [59900, '중반', 59], [60010, '후반', 60]]) {
    await advanceTo(effects, elapsed);
    await effects.waitForFunction(expected => document.querySelector('.naval-fuse li[aria-current] strong')?.textContent === expected, phase);
    assert.equal(await fuse.getAttribute('aria-valuenow'), String(seconds));
  }
  assert.equal(await fuse.getAttribute('aria-valuemax'), '90');
  assert.deepEqual(await effects.locator('.naval-fuse-phases li span').allTextContents(), ['0–30초', '30–60초', '60–90초']);
  await capture(effects, 'naval-fuse-final-phase-1280');
  checks.push('OS reduced preference does not disable requested default effects; word and raster splash share one 800ms rise; enemy/allied hit recoil and damage labels, enemy sinking, explicit manual reduction and 30/60-second fuse transitions work');
  await effects.close();

  const ime = await open('battle', 768);
  await ime.locator('.naval-game').waitFor(); await advanceTo(ime, 200);
  const input = ime.getByRole('textbox', { name: '단어 입력' });
  await input.fill(await ime.locator('.naval-word > strong').first().textContent());
  await input.dispatchEvent('compositionstart'); await input.press('Enter');
  assert.equal(await ime.evaluate(() => window.navalQa.answers.length), 0);
  await input.dispatchEvent('compositionend'); await input.press('Enter');
  await ime.waitForFunction(() => window.navalQa.answers.length === 1);
  await ime.getByRole('checkbox', { name: '움직임 줄이기' }).check();
  assert.equal(await ime.locator('.naval-game--still').count(), 1);
  await advanceTo(ime, 1700);
  assert.ok(await ime.locator('.naval-word').count() > 0);
  assert.equal(await ime.locator('.naval-word,.naval-word-splash').evaluateAll(elements => elements.every(element => getComputedStyle(element).animationName === 'none')), true);
  await capture(ime, 'naval-water-words-reduced-motion-768');
  checks.push('Korean composition does not prematurely submit; completed composition submits once; reduced motion switch applies');
  await ime.close();

  const reordered = await open('battle', 768);
  await reordered.locator('.naval-game').waitFor();
  await reordered.evaluate(() => { window.navalQa.holdFirst = true; });
  await advanceTo(reordered, 200); await answerVisible(reordered);
  await advanceTo(reordered, 1700); await answerVisible(reordered);
  await reordered.locator('.naval-effect--cannon').waitFor();
  await reordered.clock.runFor(450);
  assert.equal(await reordered.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 88');
  await reordered.evaluate(() => window.navalQa.releaseFirst());
  await reordered.clock.runFor(100);
  assert.equal(await reordered.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 88');
  assert.equal(await reordered.locator('.naval-ammo').getAttribute('aria-label'), '포탄 장전 0 / 2');
  checks.push('Reversed answer responses merge accepted timestamp snapshots without losing hits or firing twice');
  await reordered.close();

  for (const releaseAt of [8200, 8450]) {
    const canceled = await open('battle', 390);
    await canceled.locator('.naval-game').waitFor();
    await advanceTo(canceled, 200); await answerVisible(canceled);
    await canceled.evaluate(() => { window.navalQa.holdAnswer = 2; });
    await advanceTo(canceled, 1700); await answerVisible(canceled);
    await advanceTo(canceled, releaseAt);
    if (releaseAt === 8450) assert.equal(await canceled.locator('.naval-health--allied').getAttribute('aria-label'), '아군 체력 92');
    await canceled.evaluate(() => window.navalQa.releaseFirst());
    await canceled.clock.runFor(500);
    assert.equal(await canceled.locator('.naval-health--allied').getAttribute('aria-label'), '아군 체력 100', 'Delayed accepted cannon cancels the enemy shot without an old impact callback lowering restored HP');
    await canceled.close();
  }
  checks.push('Delayed accepted cannon cancels enemy autoattack before/after visual arrival; canceled callback cannot overwrite restored allied HP');
  }

  const completion = await open('battle', 768);
  await completion.locator('.naval-game').waitFor();
  await advanceTo(completion, 200); await answerVisible(completion);
  await advanceTo(completion, 1700); await answerVisible(completion);
  await advanceTo(completion, 3200); await answerVisible(completion);
  await advanceTo(completion, 4700); await answerVisible(completion);
  await completion.evaluate(() => { window.navalQa.failFinish = 1; });
  await advanceTo(completion, 92100);
  const retry = completion.getByRole('button', { name: '정산 다시 시도' });
  await retry.waitFor();
  assert.equal(await completion.locator('.naval-screen-message').count(), 1, 'Settlement failure retains the retry overlay');
  await retry.click();
  await completion.waitForFunction(() => !!window.navalQa.completed);
  const completed = await completion.evaluate(() => window.navalQa.completed);
  assert.equal(completed.battle.outcome, 'victory');
  assert.equal(completed.netWis, 0);
  assert.equal(completed.cost, 0);
  assert.equal(completed.reward, 0);
  await completion.clock.runFor(3000);
  assert.equal(await completion.evaluate(() => window.navalQa.completions.length), 1);
  assert.equal(await completion.locator('.naval-result h2').textContent(), '해역 방어 완료');
  assert.match(await completion.locator('.naval-result-settlement').textContent(), /교사 체험/);
  await capture(completion, 'naval-time-complete-retry-768');
  checks.push('90-second time completion survives failed finish and manual retry, one completion, no Wis mutations');
  await completion.close();

  const delayed = await open('battle', 1280);
  await delayed.locator('.naval-game').waitFor();
  for (let index = 0; index < 17; index++) { await advanceTo(delayed, index * 1500 + 200); await answerVisible(delayed); }
  await advanceTo(delayed, 88700);
  assert.equal(await delayed.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 4');
  await delayed.evaluate(() => { window.navalQa.holdAnswer = 18; });
  assert.equal((await answerVisible(delayed)).accepted, true);
  await advanceTo(delayed, 91700);
  assert.equal(await delayed.evaluate(() => window.navalQa.completions.length), 0);
  await delayed.evaluate(() => window.navalQa.releaseFirst());
  await delayed.locator('.naval-effect--cannon').waitFor();
  assert.equal(await delayed.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 4');
  await delayed.clock.runFor(450);
  await delayed.locator('.naval-effect--sunk').waitFor();
  assert.equal(await delayed.locator('.naval-result').count(), 0, 'Delayed final response must not skip its sinking scene');
  assert.equal(await delayed.locator('.naval-screen-message').count(), 0, 'Final sinking remains visible without the time-ended overlay');
  assert.equal(await delayed.getByRole('textbox', { name: '단어 입력' }).isDisabled(), true, 'Input remains locked after time end even while final animation is visible');
  assert.equal(await delayed.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 0', 'Sunk enemy HP stays zero during its sinking animation');
  await delayed.clock.runFor(900);
  assert.equal(await delayed.locator('.naval-result').count(), 0, 'Result waits until the 1100ms sinking animation completes');
  await delayed.waitForTimeout(400);
  await capture(delayed, 'naval-final-late-response-sinking-1280');
  await delayed.clock.runFor(1800);
  await delayed.locator('.naval-result').waitFor();
  assert.equal(await delayed.evaluate(() => window.navalQa.completions.length), 1);
  assert.equal(await delayed.evaluate(() => window.navalQa.completed.battle.sunkShips), 1);
  await capture(delayed, 'naval-final-late-response-result-1280');
  checks.push('Final cannon answer received 1700ms after time end preserves pre-arrival HP, zero HP during sinking, full 420+1100ms final animation, then settles once');
  await delayed.close();

  if (!finalEffectsOnly) {
  const legacy = await open('battle', 390, 'legacy=1');
  await legacy.getByRole('textbox', { name: '단어 입력' }).waitFor();
  assert.equal(await legacy.locator('.naval-game').count(), 0);
  await advanceTo(legacy, 200);
  const legacyWord = await legacy.evaluate(() => window.navalQa.session.words[0].text);
  await legacy.getByRole('textbox', { name: '단어 입력' }).fill(legacyWord);
  await legacy.getByRole('textbox', { name: '단어 입력' }).press('Enter');
  await legacy.waitForFunction(() => window.navalQa.answers.length === 1);
  assert.equal(await legacy.evaluate(() => window.navalQa.answers[0].result.accepted), true);
  await advanceTo(legacy, 61600);
  await legacy.waitForFunction(() => !!window.navalQa.completed);
  assert.equal(await legacy.evaluate(() => window.navalQa.completed.correctCount), 1);
  assert.equal(await legacy.evaluate(() => window.navalQa.completed.battleVersion), undefined);
  checks.push('Already started legacy 60-second session retains original renderer, answer handling, and settlement');
  await legacy.close();

  const management = await open('management', 1280);
  const duration = management.getByRole('spinbutton', { name: '착한맛 전체 제한시간', exact: true });
  await duration.waitFor();
  assert.equal(await duration.inputValue(), '90');
  assert.equal(await duration.getAttribute('min'), '90');
  await duration.fill('89');
  assert.equal(await duration.getAttribute('aria-invalid'), 'true');
  const save = management.getByRole('button', { name: '게임 설정 저장', exact: true });
  assert.equal(await save.isDisabled(), true);
  await duration.fill('120');
  assert.equal(await save.isEnabled(), true);
  await save.click();
  await management.waitForFunction(() => window.navalQa.writes.length === 1);
  assert.equal(await management.evaluate(() => window.navalQa.settings.difficulties.mild.durationSeconds), 120);
  await capture(management, 'naval-teacher-settings-1280');
  checks.push('Teacher time defaults/minimum are 90; 89 disables save; 120 saves through management boundary');
  await management.getByRole('button', { name: '체험 시작', exact: true }).click();
  await management.locator('.naval-game').waitFor();
  await advanceTo(management, 122100);
  await management.locator('.naval-result').waitFor();
  assert.match(await management.locator('.naval-result-settlement').textContent(), /교사 체험/);
  await capture(management, 'naval-teacher-real-flow-result-1280');
  await management.getByRole('button', { name: '다시 체험', exact: true }).click();
  await management.locator('.naval-game').waitFor();
  assert.equal(await management.evaluate(() => window.navalQa.calls.filter(call => call.name === 'previewWeplayGame').length), 2);
  assert.equal(await management.evaluate(() => window.navalQa.calls.some(call => /^(start|answer|finish)Weplay/.test(call.name))), false);
  checks.push('Actual teacher management starts preview, renders naval result, and replays through preview-only boundary with no student or settlement RPC');
  await management.close();

  const readonly = await open('readonly', 390);
  await readonly.getByRole('spinbutton', { name: '착한맛 전체 제한시간', exact: true }).waitFor();
  assert.equal(await readonly.getByRole('spinbutton', { name: '착한맛 전체 제한시간', exact: true }).isDisabled(), true);
  const readonlySave = readonly.getByRole('button', { name: '게임 설정 저장', exact: true });
  assert.equal(await readonlySave.count() === 0 || await readonlySave.isDisabled(), true);
  assert.equal(await readonly.evaluate(() => window.navalQa.writes.length), 0);
  await capture(readonly, 'naval-readonly-teacher-390');
  checks.push('Read-only teacher staff can view difficulty settings but cannot edit or save');
  await readonly.close();

  for (const width of [320, 390, 1280]) {
    for (const [mode, preview] of [['practice', false], ['challenge', false], ['practice', true]]) {
      for (const outcome of ['victory', 'defeat']) {
        const resultPage = await open('result', width, `mode=${mode}&preview=${preview ? 1 : 0}&outcome=${outcome}&difficulty=spicy`);
        const result = resultPage.locator('.naval-result');
        await result.waitFor();
        await resultPage.waitForFunction(() => [...document.querySelectorAll('.naval-result img')].every(image => image.complete && image.naturalWidth > 0));
        assert.equal(await result.locator('h2').textContent(), outcome === 'defeat' ? '함선 침몰' : '해역 방어 완료');
        assert.ok(await result.locator('h2').evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 24), 'Outcome heading remains at least 24px after common CSS');
        assert.equal(await result.locator('h2').evaluate(element => element === document.activeElement), true, 'New battle result focuses its heading');
        assert.equal(await result.locator('.naval-result-tags strong').textContent(), '매운맛');
        assert.equal(await result.locator('.naval-result-stats > div').count(), 4);
        const receipt = await result.locator('.naval-result-settlement').textContent();
        if (preview) assert.match(receipt, /교사 체험.*위스·랭킹·학생 기록에 반영되지 않습니다/);
        else if (mode === 'practice') assert.match(receipt, /연습.*위스 변동 없음/);
        else { assert.match(receipt, /\+3위스/); assert.match(receipt, /도전 비용 2위스.*결과 지급 5위스/); }
        const replay = result.getByRole('button', { name: preview ? '다시 체험' : '다시 하기', exact: true });
        const geometry = await result.evaluate(element => {
          const box = element.getBoundingClientRect();
          const metrics = [...element.querySelectorAll('.naval-result-stats > div')].map(item => { const r = item.getBoundingClientRect(); return { x: r.x, y: r.y }; });
          const action = element.querySelector('button').getBoundingClientRect();
          return { columns: new Set(metrics.map(item => item.x)).size, action: { width: action.width, height: action.height }, fits: [...element.querySelectorAll('h2, dt, dd, .naval-result-settlement, button, summary')].every(item => { const r = item.getBoundingClientRect(); return r.left >= box.left && r.right <= box.right && item.scrollWidth <= item.clientWidth; }) };
        });
        assert.equal(geometry.columns, width < 600 ? 2 : 4, JSON.stringify(geometry));
        assert.ok(geometry.fits && geometry.action.width >= 44 && geometry.action.height >= 44, JSON.stringify(geometry));
        await result.locator('summary').click();
        assert.equal(await result.locator('.naval-result-missed li:visible').count(), 3);
        await capture(resultPage, `naval-result-${outcome}-${preview ? 'teacher' : mode}-${width}`);
        await replay.click();
        assert.equal(await result.getByRole('button', { name: '준비 중…', exact: true }).isDisabled(), true);
        assert.equal(await resultPage.evaluate(() => window.navalQa.replays), 1);
        assert.equal(await resultPage.evaluate(() => window.navalQa.calls.length), 0);
        await resultPage.close();
      }
    }
  }
  checks.push('Real naval results: victory/defeat × practice/challenge/teacher ×320/390/1280px, responsive 2/4-column stats, correct Wis receipt, raster artwork, focused outcome, expandable missed words, 44px replay and disabled preparation, zero RPCs');
  }
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
} catch (error) { failure = error.stack; process.exitCode = 1; }
finally {
  if (failure) {
    const page = browser.contexts().flatMap(context => context.pages()).at(-1);
    if (page) { await page.screenshot({ path: path.join(evidence, 'failure-current-viewport.png'), fullPage: false }); screenshots.push('failure-current-viewport.png'); }
  }
  await fs.writeFile(path.join(evidence, finalEffectsOnly ? 'naval-browser-results-final-effects.json' : 'naval-browser-results.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', failure, checks, errors, requests, screenshots, layoutMeasurements }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
if (failure) throw new Error(failure);
console.log(JSON.stringify({ checks, screenshots }, null, 2));
